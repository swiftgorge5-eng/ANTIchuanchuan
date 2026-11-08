/**
 * 手机端地图选点弹层：把仓库里已经验证过的「高德地图 + 逆地理编码 + 住宅 POI 交叉验证」
 * 搬到队友新版前端的样式里。
 *
 * 交互和上一版一致：
 *   - 拖动地图，准星固定在屏幕中央，松手后才识别（不边拖边闪）
 *   - 「定位」把画面拉回自己所在位置，蓝点代表本人位置，拖动不会改变它
 *   - 「搜索」按小区名定位；确认后把小区名带回上一页
 */
import {
  isAmapConfigured,
  loadAmap,
  type AmapGeocoder,
  type AmapMap,
  type AmapNamespace,
  type AmapPlaceSearch,
} from "../ui/map/amap.ts";
import { collectPosition, combineSamples } from "../ui/map/geolocate.ts";
import { hasUsablePlace, resolvePlace, type PickedPlace, type ResidentialPoi } from "../ui/map/reverse.ts";

/** 上海市人民广场：没有历史输入时的初始视野。 */
const DEFAULT_CENTER: [number, number] = [121.4737, 31.2304];
/** 松手后等这么久再识别，避免惯性滑动的中间帧被当成目标点。 */
const SETTLE_MS = 700;

export interface PickedLocation {
  name: string;
  address: string;
  city: string;
  district: string;
}

export interface OpenLocationPickerOptions {
  initial?: string;
  onPick: (place: PickedLocation) => void;
}

type Phase = "opening" | "ready" | "resolving" | "failed";

let dialog: HTMLDialogElement | null = null;
let map: AmapMap | null = null;
let namespaceRef: AmapNamespace | null = null;
let geocoderRef: AmapGeocoder | null = null;
let searcherRef: AmapPlaceSearch | null = null;
let myMarker: { setPosition?(position: [number, number]): void } | null = null;
let accuracyRing: { setCenter?(position: [number, number]): void; setRadius?(radius: number): void } | null = null;
let pinnedMarker: { setPosition?(position: [number, number]): void } | null = null;
let debounce = 0;
let resolveToken = 0;
let locateController: AbortController | null = null;
let picked: PickedPlace | null = null;
let onPickHandler: ((place: PickedLocation) => void) | null = null;
let phase: Phase = "opening";

const MARKUP = `
<div class="mp-head">
  <button type="button" class="mp-close" data-mp="close" aria-label="关闭地图">×</button>
  <form class="mp-search" data-mp="form" role="search">
    <span class="mp-search-icon" aria-hidden="true">⌕</span>
    <input id="mp-query" name="query" placeholder="搜索小区名称" autocomplete="off" maxlength="60" aria-label="搜索小区名称">
    <button type="submit">搜索</button>
  </form>
</div>
<div class="mp-body">
  <div class="mp-canvas" id="mp-canvas"></div>
  <div class="mp-cross" aria-hidden="true"><span></span></div>
  <div class="mp-tip" id="mp-tip">拖动地图，把准星对准小区</div>
  <button type="button" class="mp-locate" data-mp="locate" aria-label="定位到我的位置">
    <span class="mp-locate-icon" aria-hidden="true">◎</span><span>定位</span>
  </button>
</div>
<div class="mp-sheet">
  <p class="mp-eyebrow">小区位置</p>
  <strong class="mp-name" id="mp-name">正在准备地图…</strong>
  <p class="mp-address" id="mp-address"></p>
  <p class="mp-meta" id="mp-meta"></p>
  <button type="button" class="mp-use" data-mp="use" disabled>使用这个位置</button>
  <p class="mp-note">定位结果只用于确认小区，不是风险证据。照片和位置都不会自动上传。</p>
</div>
`;

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function setPhase(next: Phase): void {
  phase = next;
  const tip = document.getElementById("mp-tip");
  if (!tip) return;
  tip.hidden = next !== "ready" && next !== "resolving";
}

function setMessage(text: string, tone: "hint" | "error" = "hint"): void {
  const tip = document.getElementById("mp-tip");
  if (!tip) return;
  tip.textContent = text;
  tip.dataset.tone = tone;
}

function renderPlace(): void {
  const name = $("mp-name");
  const address = $("mp-address");
  const meta = $("mp-meta");
  const use = document.querySelector<HTMLButtonElement>('[data-mp="use"]');
  const place = picked && hasUsablePlace(picked) ? picked : null;
  if (place) {
    name.textContent = place.communityName || place.address || "已识别位置";
    address.textContent = [place.city, place.district, place.address].filter(Boolean).join(" · ");
    const how = place.precision === "area" ? "命中小区的面" : place.precision === "nearby" ? "附近住宅点" : "只有门牌地址";
    meta.textContent = place.distance != null ? `识别方式：${how} · 距离准星约 ${place.distance} 米` : `识别方式：${how}`;
    if (use) use.disabled = false;
  } else {
    name.textContent = "还没有识别到小区";
    address.textContent = "";
    meta.textContent = "";
    if (use) use.disabled = true;
  }
}

function destroyMap(): void {
  window.clearTimeout(debounce);
  locateController?.abort();
  locateController = null;
  map?.destroy();
  map = null;
  namespaceRef = null;
  geocoderRef = null;
  searcherRef = null;
  myMarker = null;
  accuracyRing = null;
  pinnedMarker = null;
  resolveToken += 1;
}

function toAmapPosition(sample: { lng: number; lat: number }): Promise<[number, number]> {
  const namespace = namespaceRef;
  if (!namespace?.convertFrom) return Promise.resolve([sample.lng, sample.lat]);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("坐标转换超时"));
      }
    }, 5_000);
    namespace.convertFrom([sample.lng, sample.lat], "gps", (status, result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const location = status === "complete" ? result.locations?.[0] : undefined;
      if (location && Number.isFinite(location.lng) && Number.isFinite(location.lat)) {
        resolve([location.lng, location.lat]);
      } else {
        reject(new Error("坐标转换失败"));
      }
    });
  });
}

function searchResidentialPois(center: [number, number], done: (pois: ResidentialPoi[]) => void): void {
  const search = searcherRef;
  if (!search) {
    done([]);
    return;
  }
  let settled = false;
  const finish = (items: ResidentialPoi[]) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    done(items);
  };
  const timer = window.setTimeout(() => finish([]), 4_000);
  search.searchNearBy("住宅区", center, 300, (status, result) => {
    if (status !== "complete") {
      finish([]);
      return;
    }
    finish(
      (result.poiList?.pois ?? [])
        .map((poi) => {
          const raw = poi.distance;
          const distance = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
          return {
            name: typeof poi.name === "string" ? poi.name : "",
            distance: Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY,
            type: typeof poi.type === "string" ? poi.type : undefined,
          };
        })
        .filter((poi) => poi.name && Number.isFinite(poi.distance))
        .sort((left, right) => left.distance - right.distance),
    );
  });
}

function resolveAt(lng: number, lat: number): void {
  const geocoder = geocoderRef;
  if (!geocoder) return;
  const token = ++resolveToken;
  setPhase("resolving");
  setMessage("正在识别这个位置…");
  geocoder.getAddress([lng, lat], (status, result) => {
    if (token !== resolveToken) return;
    if (status !== "complete") {
      picked = null;
      renderPlace();
      setPhase("ready");
      setMessage("这个点没有查到地名，请拖动到小区内部再试。", "error");
      return;
    }
    searchResidentialPois([lng, lat], (pois) => {
      if (token !== resolveToken) return;
      const place = resolvePlace(result.regeocode, pois);
      picked = place && hasUsablePlace(place) ? place : null;
      renderPlace();
      setPhase("ready");
      if (picked) setMessage("确认无误后点下方按钮");
      else setMessage("这个位置附近没有采集到小区，请放大后把准星拖进小区内部。", "error");
    });
  });
}

async function locateMe(): Promise<void> {
  const namespace = namespaceRef;
  const current = map;
  if (!namespace || !current) return;
  locateController?.abort();
  const controller = new AbortController();
  locateController = controller;
  setMessage("正在定位…");
  try {
    const { samples, errorCode } = await collectPosition({ maxSamples: 3, maxWaitMs: 3_500 }, controller.signal);
    if (samples.length === 0) {
      setPhase("ready");
      setMessage(
        errorCode === 1
          ? "浏览器拒绝了定位权限。请在地址栏的锁形图标里允许定位，或直接搜索小区名。"
          : "拿不到当前位置。也可以直接搜索小区名。",
        "error",
      );
      return;
    }
    const merged = combineSamples(samples);
    if (!merged) {
      setPhase("ready");
      setMessage("定位结果不可用，请直接搜索小区名。", "error");
      return;
    }
    const position = await toAmapPosition(merged);
    if (myMarker) {
      myMarker.setPosition?.(position);
    } else {
      const dot = new namespace.Marker({
        position,
        anchor: "center",
        zIndex: 220,
        bubble: false,
        content: '<div class="mp-dot" title="我的位置"></div>',
      });
      current.add(dot);
      myMarker = dot;
    }
    if (merged.accuracy >= 5) {
      if (accuracyRing) {
        accuracyRing.setCenter?.(position);
        accuracyRing.setRadius?.(merged.accuracy);
      } else {
        const ring = new namespace.Circle({
          center: position,
          radius: merged.accuracy,
          strokeColor: "#1a6ee0",
          strokeWeight: 1,
          strokeOpacity: 0.5,
          fillColor: "#1a6ee0",
          fillOpacity: 0.08,
          zIndex: 210,
          bubble: false,
        });
        current.add(ring);
        accuracyRing = ring;
      }
    }
    current.setCenter(position);
    current.setZoom(17);
    current.resize();
    setPhase("ready");
    setMessage(
      merged.accuracy > 100
        ? "定位偏差较大（超过 100 米），画面已移到蓝点，请用准星或搜索小区名核对。"
        : `已定位到你的位置（误差约 ${merged.accuracy} 米）。蓝点是你本人，拖动地图不会移动它。`,
    );
  } catch (error) {
    setPhase("ready");
    setMessage(error instanceof Error ? error.message : "定位失败，请直接搜索小区名。", "error");
  } finally {
    if (locateController === controller) locateController = null;
  }
}

function pinSearchPoint(position: [number, number]): void {
  const namespace = namespaceRef;
  const current = map;
  if (!namespace || !current) return;
  if (pinnedMarker) {
    pinnedMarker.setPosition?.(position);
    return;
  }
  const pin = new namespace.Marker({
    position,
    anchor: "bottom-center",
    zIndex: 230,
    bubble: false,
    content: '<div class="mp-pin" title="搜索到的位置"></div>',
  });
  current.add(pin);
  pinnedMarker = pin;
}

function runSearch(keyword: string): void {
  const search = searcherRef;
  const current = map;
  if (!search || !current) return;
  const query = keyword.trim();
  if (!query) return;
  setPhase("resolving");
  setMessage(`正在搜索「${query}」…`);
  search.search(query, (status, result) => {
    const poi = status === "complete" ? result.poiList?.pois?.[0] : undefined;
    if (!poi?.location) {
      setPhase("ready");
      setMessage("没有搜到这个小区，换个关键词或直接拖动地图。", "error");
      return;
    }
    current.setCenter([poi.location.lng, poi.location.lat]);
    current.setZoom(17);
    pinSearchPoint([poi.location.lng, poi.location.lat]);
    resolveAt(poi.location.lng, poi.location.lat);
  });
}

function onMoved(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    const current = map;
    if (!current) return;
    const center = current.getCenter();
    resolveAt(center.lng, center.lat);
  }, SETTLE_MS);
}

async function initMap(initial?: string): Promise<void> {
  setPhase("opening");
  setMessage("正在准备地图…");
  if (!isAmapConfigured()) {
    setPhase("failed");
    setMessage("尚未配置高德地图 Key。请先按 docs/map-setup.md 填好 .env.local，或直接搜索小区名。", "error");
    return;
  }
  try {
    const namespace = await loadAmap();
    namespaceRef = namespace;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const canvas = $("mp-canvas");
    if (!canvas) throw new Error("地图容器没有就绪，请重试");
    const instance = new namespace.Map(canvas, {
      zoom: 16,
      center: DEFAULT_CENTER,
      viewMode: "2D",
      resizeEnable: true,
    });
    map = instance;
    geocoderRef = new namespace.Geocoder({ extensions: "all", radius: 200 });
    searcherRef = new namespace.PlaceSearch({ type: "住宅区", pageSize: 10, extensions: "base" });
    instance.on("movestart", () => {
      window.clearTimeout(debounce);
      resolveToken += 1;
      setPhase("ready");
      setMessage("松开手后才识别小区");
    });
    instance.on("moveend", onMoved);
    setPhase("ready");
    instance.resize();
    if (initial?.trim()) {
      const geocoder = geocoderRef;
      geocoder.getLocation(initial.trim(), (status, result) => {
        const location = status === "complete" ? result.geocodes?.[0]?.location : undefined;
        if (location) {
          instance.setCenter([location.lng, location.lat]);
          instance.setZoom(17);
          pinSearchPoint([location.lng, location.lat]);
          resolveAt(location.lng, location.lat);
        } else {
          resolveAt(instance.getCenter().lng, instance.getCenter().lat);
        }
      });
    } else {
      resolveAt(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
      // 有定位权限时直接把画面移到本人位置。
      if (typeof navigator !== "undefined" && navigator.geolocation) void locateMe();
    }
  } catch (error) {
    setPhase("failed");
    setMessage(error instanceof Error ? error.message : "地图加载失败", "error");
  }
}

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  const element = document.createElement("dialog");
  element.className = "mp-dialog";
  element.setAttribute("aria-label", "选择小区位置");
  element.innerHTML = MARKUP;
  document.body.appendChild(element);

  element.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-mp]")?.dataset.mp;
    if (action === "close") element.close();
    if (action === "locate") void locateMe();
    if (action === "use") {
      if (!picked || !hasUsablePlace(picked)) return;
      const place: PickedLocation = {
        name: picked.communityName || picked.address,
        address: picked.address,
        city: picked.city,
        district: picked.district,
      };
      const handler = onPickHandler;
      element.close();
      handler?.(place);
    }
  });
  element.querySelector('[data-mp="form"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("mp-query") as HTMLInputElement | null;
    runSearch(input?.value ?? "");
  });
  element.addEventListener("close", () => {
    destroyMap();
    phase = "opening";
    picked = null;
  });
  dialog = element;
  return element;
}

export function openLocationPicker(options: OpenLocationPickerOptions): void {
  const element = ensureDialog();
  onPickHandler = options.onPick;
  picked = null;
  renderPlace();
  if (!element.open) element.showModal();
  const input = document.getElementById("mp-query") as HTMLInputElement | null;
  if (input) input.value = options.initial?.trim() ?? "";
  // 每次重新打开都重建地图，避免旧容器尺寸被缓存。
  destroyMap();
  void initMap(options.initial);
}

export function installLocationPicker(): void {
  (window as unknown as { HomeSafeLocationPicker?: { open: typeof openLocationPicker } }).HomeSafeLocationPicker = {
    open: openLocationPicker,
  };
}

export { phase };
