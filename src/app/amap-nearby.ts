/**
 * 高德「住宅区」周边搜索：定位和地图选点共用一份逻辑。
 *
 * 只保留看起来是小区、带距离的点；商场、写字楼、门牌号一律丢掉。
 */
import type { AmapNamespace, NearbyPoi } from "../ui/map/amap.ts";
import { cleanName, isResidentialPoi, type ResidentialPoi } from "../ui/map/reverse.ts";

export interface NearbyCommunityHit {
  name: string;
  address?: string;
  distance?: number;
  type?: string;
}

function addressText(poi: NearbyPoi): string | undefined {
  const raw = poi.address;
  const text = Array.isArray(raw) ? raw.join("") : typeof raw === "string" ? raw : "";
  return text.trim() || undefined;
}

function toDistance(raw: string | number | undefined): number {
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function searchNearbyCommunities(
  namespace: AmapNamespace,
  center: [number, number],
  radius = 1_500,
  limit = 5,
): Promise<NearbyCommunityHit[]> {
  const search = new namespace.PlaceSearch({ type: "住宅区", pageSize: 20, extensions: "base" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (items: NearbyCommunityHit[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(items);
    };
    const timer = window.setTimeout(() => finish([]), 6_000);
    search.searchNearBy("住宅区", center, radius, (status, result) => {
      if (status !== "complete") {
        finish([]);
        return;
      }
      const pois = result.poiList?.pois ?? [];
      const seen = new Set<string>();
      const items: NearbyCommunityHit[] = [];
      for (const poi of pois) {
        const name = cleanName(typeof poi.name === "string" ? poi.name : "");
        if (!name) continue;
        const candidate: ResidentialPoi = {
          name,
          distance: toDistance(poi.distance),
          type: typeof poi.type === "string" ? poi.type : undefined,
        };
        if (!isResidentialPoi(candidate)) continue;
        const key = name.replace(/[\s（(].*$/u, "");
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          name,
          address: addressText(poi),
          distance: Number.isFinite(candidate.distance) ? Math.round(candidate.distance) : undefined,
          type: candidate.type,
        });
      }
      items.sort((left, right) => (left.distance ?? Infinity) - (right.distance ?? Infinity));
      finish(items.slice(0, limit));
    });
  });
}
