/**
 * HomeSafeCommunityService：给队友新版前端的「使用当前位置」接上真实的高德定位。
 *
 * 队友的 app.js 约定：
 *   service.nearby({ signal }) -> [{ name, address?, distance? }]
 *
 * 流程：浏览器多次采样 -> 合并 -> WGS-84 转 GCJ-02 -> 高德「住宅区」周边搜索
 * -> 只保留像小区的点，按距离升序。拿不到就抛错，由界面提示手动填写。
 */
import { loadAmap, type AmapNamespace, type NearbyPoi } from "../ui/map/amap.ts";
import { collectPosition, combineSamples, type PositionSample } from "../ui/map/geolocate.ts";
import { cleanName, isResidentialPoi, type ResidentialPoi } from "../ui/map/reverse.ts";

export interface NearbyCommunity {
  name: string;
  address?: string;
  distance?: number;
}

const SEARCH_RADIUS_M = 2_000;
const MAX_CANDIDATES = 5;

function toAmapPosition(namespace: AmapNamespace, sample: PositionSample): Promise<[number, number]> {
  if (!namespace.convertFrom) return Promise.resolve([sample.lng, sample.lat]);
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

function addressText(poi: NearbyPoi): string | undefined {
  const raw = poi.address;
  const text = Array.isArray(raw) ? raw.join("") : typeof raw === "string" ? raw : "";
  return text.trim() || undefined;
}

function searchResidential(namespace: AmapNamespace, center: [number, number]): Promise<NearbyCommunity[]> {
  const search = new namespace.PlaceSearch({ type: "住宅区", pageSize: 20, extensions: "base" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (items: NearbyCommunity[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(items);
    };
    const timer = window.setTimeout(() => finish([]), 6_000);
    search.searchNearBy("住宅区", center, SEARCH_RADIUS_M, (status, result) => {
      if (status !== "complete") {
        finish([]);
        return;
      }
      const pois: ResidentialPoi[] = (result.poiList?.pois ?? []).map((poi) => {
        const raw = poi.distance;
        const distance = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
        return {
          name: typeof poi.name === "string" ? poi.name : "",
          distance: Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY,
          type: typeof poi.type === "string" ? poi.type : undefined,
        };
      });
      const seen = new Set<string>();
      const items = pois
        .filter((poi) => isResidentialPoi(poi))
        .sort((left, right) => left.distance - right.distance)
        .flatMap((poi) => {
          const name = cleanName(poi.name);
          const key = name.replace(/[\s（(].*$/u, "");
          if (!name || seen.has(key)) return [];
          seen.add(key);
          const source = (result.poiList?.pois ?? []).find((item) => item.name === poi.name);
          return [{ name, address: source ? addressText(source) : undefined, distance: Math.round(poi.distance) }];
        })
        .slice(0, MAX_CANDIDATES);
      finish(items);
    });
  });
}

async function nearby(signal?: AbortSignal): Promise<NearbyCommunity[]> {
  const namespace = await loadAmap();
  const { samples, errorCode } = await collectPosition({ maxSamples: 3, maxWaitMs: 3_500 }, signal);
  if (samples.length === 0) {
    const error = new Error(errorCode === 1 ? "浏览器拒绝了定位权限" : "拿不到当前位置");
    (error as Error & { code?: number }).code = errorCode;
    throw error;
  }
  const merged = combineSamples(samples);
  if (!merged) throw new Error("定位结果不可用");
  const center = await toAmapPosition(namespace, merged);
  return searchResidential(namespace, center);
}

export interface HomeSafeCommunityService {
  label: string;
  nearby(input?: { signal?: AbortSignal }): Promise<NearbyCommunity[]>;
}

export function installCommunityService(): HomeSafeCommunityService {
  const service: HomeSafeCommunityService = {
    label: "高德地图",
    nearby: ({ signal } = {}) => nearby(signal),
  };
  (window as unknown as { HomeSafeCommunityService?: HomeSafeCommunityService }).HomeSafeCommunityService = service;
  return service;
}
