import { useRef, useState } from "react";
import {
  AMAP_MISSING_KEY,
  isAmapConfigured,
  loadAmap,
  type AmapGeocoder,
  type AmapGeolocation,
  type AmapMap,
  type AmapNamespace,
  type AmapMarker,
  type AmapPlaceSearch,
  type AmapCircle,
} from "./amap.ts";
import { hasUsablePlace, resolvePlace, type PickedPlace, type ResidentialPoi } from "./reverse.ts";

/** 上海市人民广场：没有历史输入时的初始视野。 */
const DEFAULT_CENTER: [number, number] = [121.4737, 31.2304];
const MOVE_DEBOUNCE_MS = 260;

type Phase = "closed" | "opening" | "ready" | "resolving" | "failed" | "unconfigured";

export interface PlaceMapValue {
  city: string;
  district: string;
  communityName: string;
  addressHint: string;
}

interface PlaceMapCardProps {
  value: PlaceMapValue;
  disabled: boolean;
  onApply: (place: PickedPlace) => void;
}

function describePrecision(place: PickedPlace): string {
  if (place.precision === "area") {
    return place.distance === null ? "命中小区边界" : `命中小区边界 · 距准星约 ${place.distance} 米`;
  }
  if (place.precision === "nearby") {
    return place.distance === null
      ? "附近兴趣点，未确认是小区"
      : `附近住宅，约 ${place.distance} 米 · 请确认是不是这个小区`;
  }
  return "只拿到门牌地址，未识别到小区";
}

/** 把定位来源和误差摊开说，避免"看着像在我家"就被当成准确。 */
function describeLocate(info: { accuracy: number | null; kind: string }): string {
  const source =
    info.kind === "ip"
      ? "IP 定位"
      : info.kind === "html5"
        ? "浏览器定位"
        : info.kind === "sdk"
          ? "高德定位"
          : "定位来源未知";
  const parts = [source];
  if (info.accuracy !== null) parts.push(`误差约 ±${info.accuracy} 米`);
  if (info.kind === "ip") {
    parts.push("IP 定位只能到城市或区一级，不能用来确认小区，请手动拖准星");
  } else if (info.accuracy !== null && info.accuracy >= 100) {
    parts.push("误差偏大，多半是靠 WiFi 粗略定位，请拖准星核对");
  } else if (info.accuracy !== null && info.accuracy >= 30) {
    parts.push("有几十米误差，请看蓝点是否落在目标小区内");
  }
  return parts.join(" · ");
}

export function PlaceMapCard({ value, disabled, onApply }: PlaceMapCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const namespaceRef = useRef<AmapNamespace | null>(null);
  const geocoderRef = useRef<AmapGeocoder | null>(null);
  const geolocationRef = useRef<AmapGeolocation | null>(null);
  const placeSearchRef = useRef<AmapPlaceSearch | null>(null);
  const myDotRef = useRef<AmapMarker | null>(null);
  const accuracyRef = useRef<AmapCircle | null>(null);
  const debounceRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("closed");
  const [message, setMessage] = useState("");
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateInfo, setLocateInfo] = useState<{ accuracy: number | null; kind: string } | null>(null);

  function resolveAt(lng: number, lat: number): void {
    const geocoder = geocoderRef.current;
    if (!geocoder) return;
    setPhase("resolving");
    geocoder.getAddress([lng, lat], (status, result) => {
      if (status !== "complete") {
        setPicked(null);
        setPhase("ready");
        setMessage("这个点没有查到地名，请拖动到小区内部再试。");
        return;
      }
      // AOI 只说明点落在哪个面里，可能是商场；用住宅 POI 交叉验证后再定稿。
      searchResidentialPois([lng, lat], (residentialPois) => {
        const place = resolvePlace(result.regeocode, residentialPois);
        setPicked(hasUsablePlace(place) ? place : null);
        setPhase("ready");
        setMessage(place && hasUsablePlace(place) ? "" : "这个位置附近没有采集到小区，请放大后把准星拖进小区内部。");
      });
    });
  }

  function searchResidentialPois(center: [number, number], done: (pois: ResidentialPoi[]) => void): void {
    const search = placeSearchRef.current;
    if (!search) {
      done([]);
      return;
    }
    let settled = false;
    const finish = (pois: ResidentialPoi[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      done(pois);
    };
    // POI 搜索失败不应该挡住主流程，超时就当作没搜到。
    const timer = window.setTimeout(() => finish([]), 4000);
    search.searchNearBy("住宅区", center, 300, (status, result) => {
      if (status !== "complete") {
        finish([]);
        return;
      }
      const pois = (result.poiList?.pois ?? [])
        .map((poi) => {
          const raw = poi?.distance;
          const distance = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
          return {
            name: typeof poi?.name === "string" ? poi.name : "",
            distance,
            type: typeof poi?.type === "string" ? poi.type : undefined,
          };
        })
        .filter((poi) => poi.name.length > 0 && Number.isFinite(poi.distance))
        .sort((left, right) => left.distance - right.distance);
      finish(pois);
    });
  }

  function onMapMoved(): void {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      const center = map.getCenter();
      resolveAt(center.lng, center.lat);
    }, MOVE_DEBOUNCE_MS);
  }

  function destroyMap(): void {
    window.clearTimeout(debounceRef.current);
    mapRef.current?.destroy();
    mapRef.current = null;
    namespaceRef.current = null;
    geocoderRef.current = null;
    geolocationRef.current = null;
    placeSearchRef.current = null;
    myDotRef.current = null;
    accuracyRef.current = null;
  }

  async function openMap(): Promise<void> {
    setPicked(null);
    setMessage("");
    setPhase("opening");
    if (!dialogRef.current?.open) dialogRef.current?.showModal();

    if (!isAmapConfigured()) {
      setPhase("unconfigured");
      return;
    }
    try {
      const namespace = await loadAmap();
      namespaceRef.current = namespace;
      // The dialog must be laid out before AMap measures the container.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("地图容器没有就绪，请重试");

      const map = new namespace.Map(canvas, {
        zoom: 17,
        center: DEFAULT_CENTER,
        viewMode: "2D",
        resizeEnable: true,
      });
      mapRef.current = map;
      // extensions: "all" 才会返回 aois（小区面）与周边 POI；radius 收小让结果更贴近准星。
      const geocoder = new namespace.Geocoder({ extensions: "all", radius: 200 });
      geocoderRef.current = geocoder;
      // 住宅 POI 用于交叉验证 AOI，并在 AOI 缺失时兜底。
      placeSearchRef.current = new namespace.PlaceSearch({ type: "住宅区", pageSize: 10, extensions: "base" });
      // useNative：用浏览器原生 Geolocation，不把 IP 交给高德的定位服务；
      // convert：浏览器给的是 WGS-84，需要由高德转成 GCJ-02 才能和底图对齐。
      geolocationRef.current = new namespace.Geolocation({
        useNative: true,
        convert: true,
        enableHighAccuracy: true,
        timeout: 8000,
        noIpLocate: 1,
      });
      map.on("moveend", onMapMoved);
      setPhase("ready");

      const seed = [value.city, value.district, value.communityName].filter(Boolean).join(" ");
      if (seed) {
        geocoder.getLocation(seed, (status, result) => {
          const location = status === "complete" ? result.geocodes?.[0]?.location : undefined;
          if (location) map.setCenter([location.lng, location.lat]);
          else resolveAt(map.getCenter().lng, map.getCenter().lat);
        });
      } else {
        resolveAt(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
      }
    } catch (error) {
      setPhase("failed");
      setMessage(error instanceof Error ? error.message : "地图加载失败");
    }
  }

  function closeMap(): void {
    dialogRef.current?.close();
  }

  function handleClosed(): void {
    destroyMap();
    setPhase("closed");
    setMessage("");
    setPicked(null);
    setLocating(false);
    setLocateInfo(null);
  }

  function locateMe(): void {
    const namespace = namespaceRef.current;
    const geolocation = geolocationRef.current;
    const map = mapRef.current;
    if (!namespace || !geolocation || !map) return;

    setLocating(true);
    setMessage("");
    geolocation.getCurrentPosition((status, result) => {
      setLocating(false);
      if (status !== "complete" || !result.position) {
        setMessage("拿不到当前位置。请允许浏览器定位，并确认页面是用 https 或 localhost 打开的。");
        return;
      }
      const position = result.position;
      const accuracy = typeof result.accuracy === "number" && Number.isFinite(result.accuracy) && result.accuracy > 0
        ? Math.round(result.accuracy)
        : null;
      const kind = typeof result.location_type === "string" ? result.location_type : "";
      setLocateInfo({ accuracy, kind });
      // The blue dot is the user's real position: it is written once and never
      // moved by dragging the map. Only an explicit click here updates it.
      if (myDotRef.current) {
        myDotRef.current.setPosition?.([position.lng, position.lat]);
      } else {
        // 自定义 HTML 图标：在任意缩放级别都能看清，不会被中心准星遮住。
        const dot = new namespace.Marker({
          position: [position.lng, position.lat],
          anchor: "center",
          zIndex: 220,
          bubble: false,
          content: '<div class="my-location-dot" title="我的位置"></div>',
        });
        map.add(dot);
        myDotRef.current = dot;
      }
      // 把精度画成一个圈：50 米误差就是 50 米半径，肉眼可判断"够不够准"。
      if (accuracy !== null && accuracy >= 5) {
        if (accuracyRef.current) {
          accuracyRef.current.setCenter?.([position.lng, position.lat]);
          accuracyRef.current.setRadius?.(accuracy);
        } else {
          const ring = new namespace.Circle({
            center: [position.lng, position.lat],
            radius: accuracy,
            strokeColor: "#1a6ee0",
            strokeWeight: 1,
            strokeOpacity: 0.5,
            fillColor: "#1a6ee0",
            fillOpacity: 0.08,
            zIndex: 210,
            bubble: false,
          });
          map.add(ring);
          accuracyRef.current = ring;
        }
      }
      map.setCenter([position.lng, position.lat]);
      map.setZoom(17);
      map.resize();
    });
  }

  function applyPicked(): void {
    if (!picked) return;
    onApply(picked);
    closeMap();
  }

  const busy = phase === "opening" || phase === "resolving";
  const summary = [value.city, value.district, value.communityName].filter(Boolean).join(" · ");

  return (
    <section className="map-pick no-print" aria-label="地点定位">
      <div className="map-pick-head">
        <span>地点定位</span>
        <button type="button" className="text-btn" disabled={disabled} onClick={() => void openMap()}>
          在地图上选点
        </button>
      </div>
      <p className="note">
        {summary ? `当前填写：${summary}` : "拖动地图把准星对准小区，系统会识别出这是哪个小区。"}
      </p>

      <dialog ref={dialogRef} className="map-dialog" onClose={handleClosed} aria-label="地图选点">
        <div className="map-dialog-head">
          <h2>选择小区位置</h2>
          <button type="button" className="text-btn" onClick={closeMap}>关闭</button>
        </div>

        {phase === "unconfigured" ? (
          <div className="map-config">
            <h3>{AMAP_MISSING_KEY}</h3>
            <p>这个功能需要高德地图 Key，申请后填进项目根目录的 <code>.env.local</code>：</p>
            <pre>{`VITE_AMAP_KEY=你的Key
VITE_AMAP_SECURITY=你的安全密钥`}</pre>
            <p className="note">
              申请入口：高德开放平台控制台 → 应用管理 → 创建应用 → 添加 Key（服务平台选「Web端(JS API)」）。
              详细步骤见 docs/map-setup.md。没有 Key 时，上面的城市/区/小区仍可手动填写，其它功能不受影响。
            </p>
          </div>
        ) : phase === "failed" ? (
          <div className="map-config" role="alert">
            <h3>地图没有加载成功</h3>
            <p>{message}</p>
            <p className="note">
              常见原因：Key 填错、服务平台没选「Web端(JS API)」、域名白名单缺当前地址、安全密钥不匹配，或网络不通。
              修好后重启 npm run dev 再点重试。步骤见 docs/map-setup.md。
            </p>
            <div className="map-actions">
              <button type="button" className="btn secondary" onClick={() => void openMap()}>重试</button>
              <button type="button" className="btn secondary" onClick={closeMap}>手动填写</button>
            </div>
          </div>
        ) : (
          <>
            <div className="map-canvas-wrap">
              <div className="map-canvas" ref={canvasRef} />
              <div className="map-crosshair" aria-hidden="true"><span /></div>
              {busy && (
                <div className="map-veil">{phase === "opening" ? "正在加载地图…" : "正在识别这个点…"}</div>
              )}
            </div>

            <div className="map-result" aria-live="polite">
              {picked ? (
                <>
                  <p className="map-place">{picked.communityName || picked.address || "未命名地点"}</p>
                  <p className="note">{[picked.city, picked.district].filter(Boolean).join(" · ") || "行政区未知"}</p>
                  {picked.address && <p className="note">{picked.address}</p>}
                  <p className="note">识别方式：高德逆地理编码 · {describePrecision(picked)}</p>
                </>
              ) : (
                <p className="note">{message || "把地图拖到目标小区，松手后会显示这里是什么地方。"}</p>
              )}
              {picked && message && <p className="note">{message}</p>}
            </div>

            <div className="map-actions">
              <button type="button" className="btn secondary" onClick={locateMe} disabled={locating || phase !== "ready"}>
                {locating ? "定位中…" : "定位我的位置"}
              </button>
              <button type="button" className="btn" onClick={applyPicked} disabled={!picked}>
                使用这个位置
              </button>
            </div>
            {locateInfo && <p className="note map-locate">{describeLocate(locateInfo)}</p>}
            <p className="note">
              蓝点是你当前的位置，拖动地图不会改变它。定位结果只用于确认地点，不是风险证据，也不能代替同名小区的人工核对。
            </p>
          </>
        )}
      </dialog>
    </section>
  );
}
