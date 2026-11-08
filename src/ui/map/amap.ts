/**
 * Minimal AMap (高德) JS API 2.0 loader.
 *
 * - Reads VITE_AMAP_KEY / VITE_AMAP_SECURITY from .env.local; nothing is hard-coded.
 * - Loads the SDK lazily: only when the user opens the map picker, so the first
 *   paint of the page stays small and the rest of the app never depends on it.
 * - Every failure resolves to a Chinese message the UI can show; the page keeps
 *   working with manual text input.
 */

export interface AmapLngLat {
  lng: number;
  lat: number;
}

export interface AmapMap {
  on(event: "movestart" | "moveend" | "zoomstart" | "complete" | "click", handler: () => void): void;
  off(event: string, handler?: () => void): void;
  setCenter(position: [number, number]): void;
  setZoom(zoom: number): void;
  getCenter(): AmapLngLat;
  add(overlay: unknown): void;
  remove(overlay: unknown): void;
  resize(): void;
  destroy(): void;
}

export interface AmapCircle {
  setCenter?(position: [number, number]): void;
  setRadius?(radius: number): void;
}

export interface AmapMarker {
  setPosition?(position: [number, number]): void;
}

export interface RegeocodeAoi {
  name?: string;
  distance?: string | number;
  type?: string;
  area?: string;
}

export interface RegeocodePoi {
  name?: string;
  distance?: string | number;
  type?: string;
}

export interface RegeocodeResult {
  formattedAddress?: string;
  addressComponent?: {
    province?: string;
    city?: string;
    district?: string;
    township?: string;
    adcode?: string;
    citycode?: string;
  };
  aois?: RegeocodeAoi[];
  pois?: RegeocodePoi[];
}

export interface GeocodeItem {
  location?: AmapLngLat;
}

export interface AmapGeocoder {
  getAddress(
    position: [number, number],
    callback: (status: string, result: { regeocode?: RegeocodeResult }) => void,
  ): void;
  getLocation(
    address: string,
    callback: (status: string, result: { geocodes?: GeocodeItem[] }) => void,
  ): void;
}

export interface AmapGeolocation {
  getCurrentPosition(
    callback: (
      status: string,
      result: {
        position?: AmapLngLat;
        /** 定位精度（米）：浏览器定位通常 20-100，IP 兜底会很大 */
        accuracy?: number;
        /** html5=浏览器定位；ip=IP 兜底；sdk=高德定位 SDK */
        location_type?: string;
        message?: string;
        info?: string;
      },
    ) => void,
  ): void;
}

export interface NearbyPoi {
  name?: string;
  distance?: string | number;
  address?: string | string[];
  type?: string;
  location?: AmapLngLat;
}

export interface AmapPlaceSearch {
  /** 关键字搜索，用于「输入小区名直接定位」 */
  search(
    keyword: string,
    callback: (status: string, result: { poiList?: { pois?: NearbyPoi[] } }) => void,
  ): void;
  searchNearBy(
    keyword: string,
    center: [number, number],
    radius: number,
    callback: (status: string, result: { poiList?: { pois?: NearbyPoi[] } }) => void,
  ): void;
}

export interface AmapNamespace {
  Map: new (container: HTMLElement, options?: Record<string, unknown>) => AmapMap;
  Circle: new (options?: Record<string, unknown>) => AmapCircle;
  Marker: new (options?: Record<string, unknown>) => AmapMarker;
  Geocoder: new (options?: Record<string, unknown>) => AmapGeocoder;
  PlaceSearch: new (options?: Record<string, unknown>) => AmapPlaceSearch;
  /** WGS-84（浏览器定位）转 GCJ-02（高德底图） */
  convertFrom(
    position: [number, number],
    type: "gps",
    callback: (status: string, result: { locations?: AmapLngLat[] }) => void,
  ): void;
}

type AmapWindow = {
  AMap?: AmapNamespace;
  _AMapSecurityConfig?: { securityJsCode: string };
};

const SCRIPT_ID = "antichuanchuan-amap-2";
const SCRIPT_BASE = "https://webapi.amap.com/maps?v=2.0&plugin=AMap.Geocoder,AMap.PlaceSearch";
const LOAD_TIMEOUT_MS = 15_000;

export const AMAP_MISSING_KEY = "尚未配置高德地图 Key";

function envValue(name: "VITE_AMAP_KEY" | "VITE_AMAP_SECURITY"): string {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function amapKey(): string {
  return envValue("VITE_AMAP_KEY");
}

export function isAmapConfigured(): boolean {
  return amapKey().length > 0;
}

let pending: Promise<AmapNamespace> | null = null;

function inject(key: string, resolve: (namespace: AmapNamespace) => void, reject: (error: Error) => void): void {
  const scope = window as unknown as AmapWindow;
  const security = envValue("VITE_AMAP_SECURITY");
  // Must be assigned before the SDK script parses, otherwise the security code is ignored.
  if (security) scope._AMapSecurityConfig = { securityJsCode: security };

  if (scope.AMap) {
    resolve(scope.AMap);
    return;
  }

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `${SCRIPT_BASE}&key=${encodeURIComponent(key)}`;

  // A previous attempt may have left a failed script behind; replace it so a
  // retry after fixing the Key reads the new value instead of a cached failure.
  document.getElementById(SCRIPT_ID)?.remove();

  const timer = window.setTimeout(() => {
    script.onload = null;
    script.onerror = null;
    reject(new Error("高德地图加载超时，请检查网络后重试"));
  }, LOAD_TIMEOUT_MS);

  const finish = (error: Error | null) => {
    window.clearTimeout(timer);
    script.onload = null;
    script.onerror = null;
    if (error) {
      reject(error);
      return;
    }
    if (scope.AMap) resolve(scope.AMap);
    else reject(new Error("高德地图初始化失败，请检查 Key 与安全密钥是否正确"));
  };

  script.onload = () => finish(null);
  script.onerror = () => finish(new Error("高德地图脚本加载失败，请检查网络或域名白名单"));
  document.head.appendChild(script);
}

export function loadAmap(): Promise<AmapNamespace> {
  if (pending) return pending;
  pending = new Promise<AmapNamespace>((resolve, reject) => {
    const key = amapKey();
    if (!key) {
      reject(new Error(AMAP_MISSING_KEY));
      return;
    }
    inject(key, resolve, reject);
  });
  // Allow a later click to retry after a network or configuration failure.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
