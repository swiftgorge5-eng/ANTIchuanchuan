/**
 * Turns an AMap reverse-geocode payload (plus nearby residential POIs) into the
 * four text fields the page uses. Pure functions: no DOM, no network, testable.
 *
 * 为什么要两路数据：
 * - 逆地理编码的 `aois` 只说明「这个点落在哪个面里」，它可能是小区，也可能是商场；
 *   而且 aois 没有 distance 字段，无法排序。
 * - `PlaceSearch` 按住宅类型搜出来的 POI 带准确距离，可以用来交叉验证。
 * 两者都指向同一个小区才认定为 area；否则退到 nearby（带距离）。
 */
import type { RegeocodeResult } from "./amap.ts";

export interface ResidentialPoi {
  name: string;
  distance: number;
  /** 高德分类，形如「商务住宅;住宅区;住宅小区」 */
  type?: string;
}

export interface PickedPlace {
  city: string;
  district: string;
  /** 小区名称；只取清洗后的核心名，可能为空 */
  communityName: string;
  address: string;
  /** 距离准星多少米；AOI 自带距离缺失时可能为 null */
  distance: number | null;
  /**
   * area   ：命中小区的面，可信度最高
   * nearby ：只有附近的住宅点，按距离提示
   * address：只拿到门牌地址，无法确认小区
   */
  precision: "area" | "nearby" | "address";
}

export const MAX_FIELD_LENGTH = 120;
/** 命中 AOI 时，住宅 POI 在这个距离内才算交叉验证通过 */
export const AREA_MATCH_RADIUS_M = 120;
/** 兜底用附近住宅 POI 时允许的最远距离；再远就不猜了 */
export const NEARBY_RADIUS_M = 200;

/** Strip entry/exit suffixes and characters that the input validator rejects. */
export function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[（(][^）)]{0,24}[）)]/gu, " ")
    .replace(/[<>\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

const COMMUNITY_SUFFIX = /(小区|花园|家园|公寓|新村|雅苑|苑|园|湾|里|庭|府|坊|村)$/u;

/** AOI 是否像住宅：用来在拿不到住宅 POI 时，挡掉商场、写字楼一类的面。 */
export function looksResidential(name: string): boolean {
  return COMMUNITY_SUFFIX.test(cleanName(name));
}

function overlapRatio(left: string, right: string): number {
  const a = new Set([...left]);
  const b = new Set([...right]);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const char of a) if (b.has(char)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

/**
 * 两个名字是否在说同一个小区（只用于交叉验证，不是模糊搜索）。
 * 不裁掉「苑/家园/花园」这类词：那会把「曹杨雅苑」和「曹杨家园」误并成一个。
 */
export function sameCommunity(left: string, right: string): boolean {
  const a = cleanName(left);
  const b = cleanName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  return overlapRatio(a, b) >= 0.6;
}

/** 高德的「住宅区」分类里混着商场、KTV、门牌号，靠名字再筛一遍。 */
const COMMERCIAL_HINT = /(广场|大厦|写字楼|商务|酒店|旅馆|青旅|宾馆|超市|便利店|商场|购物|影城|影院|餐厅|咖啡|银行|医院|学校|学院|大学|地铁|车站|停车场|俱乐部|会所|KTV|酒吧|美容|健身|中心|club)/iu;
/** 形如「潮州路536号」「礼尚路88弄」的是地址，不是小区。 */
const STREET_ADDRESS = /(路|街|道|弄|巷)\s*\d/u;
/** 只有「住宅区 / 住宅小区」才算住宅；「商务住宅相关」是写字楼那类。 */
const RESIDENTIAL_TYPE = /住宅小区|住宅区/u;

export function isResidentialPoi(poi: ResidentialPoi): boolean {
  const name = cleanName(poi.name);
  if (!name) return false;
  if (poi.type && !RESIDENTIAL_TYPE.test(poi.type)) return false;
  if (COMMERCIAL_HINT.test(name)) return false;
  if (STREET_ADDRESS.test(name)) return false;
  return true;
}

function distanceOf(item: { distance?: string | number }): number {
  const raw = item.distance;
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function nearestByDistance<T extends { distance?: string | number }>(items: readonly T[] | undefined): T | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return [...items].sort((left, right) => distanceOf(left) - distanceOf(right))[0];
}

function nearestAoi(result: RegeocodeResult): string {
  const aois = Array.isArray(result.aois) ? result.aois : [];
  // aois 没有 distance，且中心点通常只落在一个面里；取第一个非空名字。
  for (const aoi of aois) {
    const name = cleanName(aoi?.name);
    if (name) return name;
  }
  return "";
}

/**
 * @param result           逆地理编码结果（extensions: "all"）
 * @param residentialPois  PlaceSearch 按「住宅区」搜出来的点，已按距离升序
 */
export function resolvePlace(
  result: RegeocodeResult | null | undefined,
  residentialPois: readonly ResidentialPoi[] = [],
): PickedPlace | null {
  if (!result || typeof result !== "object") return null;

  const component = result.addressComponent ?? {};
  // 直辖市里 province 与 city 同名，优先城市字段，缺失时退回省份。
  const city = cleanName(component.city || component.province);
  const district = cleanName(component.district);
  const township = cleanName(component.township);
  const street = cleanName(result.formattedAddress);
  // formattedAddress 已含省市区与街道，再拼 township 会重复。
  const address = (street || township).slice(0, MAX_FIELD_LENGTH);

  const residential = [...residentialPois]
    .filter(isResidentialPoi)
    .sort((left, right) => left.distance - right.distance)[0];
  const aoiName = nearestAoi(result);
  const geocodePoiName = cleanName(nearestByDistance(result.pois)?.name);

  const base = { city, district, address };

  // 1) AOI 可信：要么和附近住宅 POI 同名，要么本身像住宅且没有 POI 可对照。
  const aoiTrusted = aoiName !== "" && (
    residential
      ? sameCommunity(aoiName, residential.name) && residential.distance <= AREA_MATCH_RADIUS_M
      : looksResidential(aoiName)
  );
  if (aoiTrusted) {
    return { ...base, communityName: aoiName, distance: residential?.distance ?? null, precision: "area" };
  }

  // 2) 兜底：附近的住宅点足够近才采用，并保留距离让用户自己判断。
  if (residential && residential.distance <= NEARBY_RADIUS_M) {
    return {
      ...base,
      communityName: cleanName(residential.name),
      distance: Math.round(residential.distance),
      precision: "nearby",
    };
  }

  // 3) 只有逆地理编码自带的兴趣点，没有距离信息，只作弱提示。
  if (!aoiName && !residential && geocodePoiName) {
    return { ...base, communityName: geocodePoiName, distance: null, precision: "nearby" };
  }

  // 什么都没拿到时不要伪造一个空地点。
  if (!city && !district && !address) return null;
  return { ...base, communityName: "", distance: null, precision: "address" };
}

/** Backwards-compatible single-argument form. */
export function placeFromRegeocode(result: RegeocodeResult | null | undefined): PickedPlace | null {
  return resolvePlace(result, []);
}

/** Filled only when the picker found something usable; never invents a value. */
export function hasUsablePlace(place: PickedPlace | null): place is PickedPlace {
  return Boolean(place && (place.communityName || place.district));
}
