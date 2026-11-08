/**
 * 手机端地图选点 / 位置回看。
 *
 * 三个入口共用一套高德逻辑：
 *   - 「定位找小区」：open()
 *   - 小区标签「在地图上选点」：open()
 *   - 报告里的「在地图上看位置」：openViewer() / openViewerByName()
 *   - 小区标签「使用当前位置」：locate()（不开地图，直接返回坐标 + 最近小区）
 *
 * 交互约定：
 *   - 拖动地图，准星固定在屏幕中央，松手后才识别（不边拖边闪）
 *   - 「定位」把画面拉回自己所在位置，蓝点代表本人位置，拖动不会改变它
 *   - 回看时只显示标记与标签，不提供改点按钮
 */
import {
  isAmapConfigured,
  loadAmap,
  type AmapGeocoder,
  type AmapMap,
  type AmapNamespace,
  type AmapPlaceSearch,
  type RegeocodeResult,
} from "../ui/map/amap.ts";
import { collectPosition, combineSamples } from "../ui/map/geolocate.ts";
import { hasUsablePlace, resolvePlace, type PickedPlace, type ResidentialPoi } from "../ui/map/reverse.ts";
import { searchNearbyCommunities, type NearbyCommunityHit } from "./amap-nearby.ts";
import { toAmapPosition } from "./community-service.ts";

/** 上海市人民广场：没有历史输入时的初始视野。 */
const DEFAULT_CENTER: [number, number] = [121.4737, 31.2304];
/** 松手后等这么久再识别，避免惯性滑动的中间帧被当成目标点。 */
const SETTLE_MS = 700;

export interface PickedLocation {
  name: string;
  address: string;
  city: string;
  district: string;
  lng: number;
  lat: number;
}

export interface LocatedPlace extends PickedLocation {
  accuracy: number;
  candidates: NearbyCommunityHit[];
}

export interface OpenLocationPickerOptions {
  initial?: string;
  onPick: (place: PickedLocation) => void;
}

export interface LocationViewerOptions {
  label: string;
  address?: string;
  lng: number;
  lat: number;
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

const VIEWER_MARKUP = `
<div class="mv-head">
  <button type="button" class="mp-close" data-mv="close" aria-label="关闭位置">×</button>
  <h2>小区位置</h2>
  <span></span>
</div>
<div class="mv-body"><div class="mv-canvas" id="mv-canvas"></div></div>
<div class="mv-sheet">
  <p class="mp-eyebrow">小区标签</p>
  <strong class="mp-name" id="mv-label"></strong>
  <p class="mp-address" id="mv-address"></p>
  <p class="mp-note">这是你给这套房打的标签和位置，报告会一起保留，方便回看。</p>
  <button type="button" class="mp-use" data-mv="close">关闭</button>
</div>
`;

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function escapeText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
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
  const nameEl = document.getElementById("mp-name") as HTMLElement | null;
  const addressEl = document.getElementById("mp-address") as HTMLElement | null;
  const metaEl = document.getElementById("mp-meta") as HTMLElement | null;
  const use = document.querySelector<HTMLButtonElement>('[data-mp="use"]');
  if (!nameEl || !addressEl || !metaEl) return;
  const place = picked && hasUsablePlace(picked) ? picked : null;
  if (place) {
    nameEl.textContent = place.communityName || place.address || "已识别位置";
    addressEl.textContent = [place.city, place.district, place.address].filter(Boolean).join(" · ");
    const how = place.precision === "area" ? "命中小区的面" : place.precision === "nearby" ? "附近住宅点" : "只有门牌地址";
    metaEl.textContent = place.distance != null ? `识别方式：${how} · 距离准星约 ${place.distance} 米` : `识别方式：${how}`;
    if (use) use.disabled = false;
  } else {
    nameEl.textContent = "还没有识别到小区";
    addressEl.textContent = "";
    metaEl.textContent = "";
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

function searchResidentialPois(center: [number, number], done: (pois: ResidentialPoi[]) => void): void {
  const namespace = namespaceRef;
  if (!namespace) {
    done([]);
    return;
  }
  void searchNearbyCommunities(namespace, center, 300, 10).then((hits) => {
    done(
      hits.map((hit) => ({
        name: hit.name,
        distance: hit.distance ?? Number.POSITIVE_INFINITY,
        type: hit.type,
      })),
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
    const position = await toAmapPosition(namespace, merged);
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
      const center = map?.getCenter();
      const place: PickedLocation = {
        name: picked.communityName || picked.address,
        address: picked.address,
        city: picked.city,
        district: picked.district,
        lng: center?.lng ?? DEFAULT_CENTER[0],
        lat: center?.lat ?? DEFAULT_CENTER[1],
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

/**
 * 只做一次定位，不打开地图：给小区标签的「使用当前位置」用。
 * 返回坐标、精度和附近小区候选，由界面决定怎么填名字。
 */
export async function locateCurrent(): Promise<LocatedPlace> {
  const namespace = await loadAmap();
  const { samples, errorCode } = await collectPosition({ maxSamples: 3, maxWaitMs: 3_500 });
  if (samples.length === 0) {
    const error = new Error(errorCode === 1 ? "浏览器拒绝了定位权限" : "拿不到当前位置");
    (error as Error & { code?: number }).code = errorCode;
    throw error;
  }
  const merged = combineSamples(samples);
  if (!merged) throw new Error("定位结果不可用");
  const center = await toAmapPosition(namespace, merged);
  const candidates = await searchNearbyCommunities(namespace, center, 2_000, 5);
  const geocoder = new namespace.Geocoder({ extensions: "all", radius: 200 });
  const regeocode = await new Promise<RegeocodeResult | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 5_000);
    geocoder.getAddress(center, (status, result) => {
      window.clearTimeout(timer);
      resolve(status === "complete" ? result.regeocode ?? null : null);
    });
  });
  const pois: ResidentialPoi[] = candidates.map((item) => ({
    name: item.name,
    distance: item.distance ?? Number.POSITIVE_INFINITY,
    type: item.type,
  }));
  const place = resolvePlace(regeocode, pois);
  return {
    name: place?.communityName || candidates[0]?.name || place?.address || "",
    address: place?.address || candidates[0]?.address || "",
    city: place?.city || "",
    district: place?.district || "",
    lng: center[0],
    lat: center[1],
    accuracy: merged.accuracy,
    candidates,
  };
}

/* ---------------- 位置回看 ---------------- */

let viewer: HTMLDialogElement | null = null;
let viewerMap: AmapMap | null = null;

function ensureViewer(): HTMLDialogElement {
  if (viewer) return viewer;
  const element = document.createElement("dialog");
  element.className = "mv-dialog";
  element.setAttribute("aria-label", "小区位置");
  element.innerHTML = VIEWER_MARKUP;
  document.body.appendChild(element);
  element.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest('[data-mv="close"]')) element.close();
  });
  element.addEventListener("close", () => {
    viewerMap?.destroy();
    viewerMap = null;
  });
  viewer = element;
  return element;
}

export async function openLocationViewer(options: LocationViewerOptions): Promise<void> {
  const element = ensureViewer();
  const labelEl = document.getElementById("mv-label");
  const addressEl = document.getElementById("mv-address");
  if (labelEl) labelEl.textContent = options.label || "未命名标签";
  if (addressEl) addressEl.textContent = options.address || "";
  if (!element.open) element.showModal();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const canvas = document.getElementById("mv-canvas");
  if (!canvas) return;
  try {
    const namespace = await loadAmap();
    const instance = new namespace.Map(canvas, {
      zoom: 17,
      center: [options.lng, options.lat],
      viewMode: "2D",
      resizeEnable: true,
    });
    viewerMap = instance;
    const marker = new namespace.Marker({
      position: [options.lng, options.lat],
      anchor: "bottom-center",
      zIndex: 200,
      bubble: false,
      content: `<div class="mv-marker"><span class="mv-marker-label">${escapeText(options.label || "我的标签")}</span><span class="mv-marker-dot"></span></div>`,
    });
    instance.add(marker);
    instance.resize();
  } catch (error) {
    const addressEl2 = document.getElementById("mv-address");
    if (addressEl2) addressEl2.textContent = error instanceof Error ? error.message : "地图加载失败";
  }
}

/** 报告里只有小区名、没有坐标时，用名称反查一个位置再展示。 */
export async function openLocationViewerByName(name: string, address?: string): Promise<boolean> {
  const namespace = await loadAmap();
  const geocoder = new namespace.Geocoder({ extensions: "all", radius: 200 });
  const location = await new Promise<{ lng: number; lat: number } | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 6_000);
    geocoder.getLocation(name, (status, result) => {
      window.clearTimeout(timer);
      const item = status === "complete" ? result.geocodes?.[0]?.location : undefined;
      resolve(item && Number.isFinite(item.lng) && Number.isFinite(item.lat) ? item : null);
    });
  });
  if (!location) return false;
  await openLocationViewer({ label: name, address, lng: location.lng, lat: location.lat });
  return true;
}

export function installLocationPicker(): void {
  const scope = window as unknown as {
    HomeSafeLocationPicker?: {
      open: typeof openLocationPicker;
      locate: typeof locateCurrent;
      openViewer: typeof openLocationViewer;
      openViewerByName: typeof openLocationViewerByName;
    };
  };
  scope.HomeSafeLocationPicker = {
    open: openLocationPicker,
    locate: locateCurrent,
    openViewer: openLocationViewer,
    openViewerByName: openLocationViewerByName,
  };
}

export { phase };
