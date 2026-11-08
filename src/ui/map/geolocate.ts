/**
 * 浏览器定位的采样与合并。
 *
 * 为什么要自己采样：
 * - `navigator.geolocation` 一次结果抖动很大，桌面端靠 WiFi 数据库，误差几十米很正常；
 * - 浏览器允许返回"上一次的定位结果"，如果用户走动了就会系统性偏移；
 *   我们自己传 `maximumAge: 0` 才能保证拿到的是新鲜坐标。
 *
 * 合并策略：先剔除精度明显更差的离群点，再按 1/accuracy² 加权平均。
 */

export interface PositionSample {
  lng: number;
  lat: number;
  /** 设备声称的误差半径（米） */
  accuracy: number;
}

export interface CollectOptions {
  /** 最多采几个样本，默认 3 */
  maxSamples?: number;
  /** 最长等多久（毫秒），默认 3500 */
  maxWaitMs?: number;
  /** 每采到一个样本回调一次，用于界面显示进度 */
  onProgress?: (samples: PositionSample[]) => void;
}

export const MIN_SAMPLES = 1;
export const DEFAULT_MAX_SAMPLES = 3;
export const DEFAULT_MAX_WAIT_MS = 3_500;

/** 球面距离（米），用于估算样本之间的离散程度。 */
export function distanceMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function usable(sample: PositionSample): boolean {
  return Number.isFinite(sample.lng) && Number.isFinite(sample.lat)
    && Number.isFinite(sample.accuracy) && sample.accuracy > 0;
}

/**
 * 合并多个样本。返回 null 表示没有任何可用样本。
 * accuracy 取「设备声称的最优精度」与「样本实际离散度」中较大的一个，
 * 避免几次结果互相矛盾时仍然报一个漂亮的小数字。
 */
export function combineSamples(samples: readonly PositionSample[]): PositionSample | null {
  const valid = samples.filter(usable);
  if (valid.length === 0) return null;
  if (valid.length === 1) return { ...valid[0], accuracy: Math.round(valid[0].accuracy) };

  const best = Math.min(...valid.map((sample) => sample.accuracy));
  // 精度是最优值两倍以上的样本视为离群点，直接丢弃。
  const kept = valid.filter((sample) => sample.accuracy <= best * 2);

  let weightSum = 0;
  let lngSum = 0;
  let latSum = 0;
  for (const sample of kept) {
    const weight = 1 / (sample.accuracy * sample.accuracy);
    weightSum += weight;
    lngSum += sample.lng * weight;
    latSum += sample.lat * weight;
  }
  if (weightSum === 0) return { ...valid[0], accuracy: Math.round(valid[0].accuracy) };

  const lng = lngSum / weightSum;
  const lat = latSum / weightSum;
  const spread = Math.max(...kept.map((sample) => distanceMeters(sample.lng, sample.lat, lng, lat)));
  return { lng, lat, accuracy: Math.round(Math.max(best, spread)) };
}

/** 只为了界面显示：采样进度和当前最佳精度。 */
export function bestAccuracy(samples: readonly PositionSample[]): number | null {
  const valid = samples.filter(usable);
  if (valid.length === 0) return null;
  return Math.round(Math.min(...valid.map((sample) => sample.accuracy)));
}

interface BrowserGeolocation {
  watchPosition(
    success: (position: { coords: { longitude: number; latitude: number; accuracy: number } }) => void,
    error: (error: { code?: number; message?: string }) => void,
    options: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}

export interface CollectResult {
  samples: PositionSample[];
  /** 浏览器返回的错误码：1=拒绝授权，2=拿不到，3=超时 */
  errorCode?: number;
}

/**
 * 连续采样，直到采满 maxSamples 或超时。
 * 不抛异常：拿不到就返回空数组 + errorCode，由调用方决定怎么提示。
 */
export function collectPosition(
  options: CollectOptions = {},
  signal?: AbortSignal,
  geolocation?: BrowserGeolocation,
): Promise<CollectResult> {
  const source = geolocation ?? (typeof navigator !== "undefined" ? (navigator.geolocation as unknown as BrowserGeolocation) : undefined);
  if (!source) return Promise.resolve({ samples: [] });

  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const samples: PositionSample[] = [];

  return new Promise<CollectResult>((resolve) => {
    let finished = false;
    let watchId: number | null = null;
    let errorCode: number | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timer);
      if (watchId !== null) {
        try {
          source.clearWatch(watchId);
        } catch {
          /* 浏览器可能已经自己清掉了 */
        }
      }
      signal?.removeEventListener("abort", onAbort);
      resolve({ samples, errorCode });
    };

    const timer = globalThis.setTimeout(finish, maxWaitMs);
    const onAbort = () => finish();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      watchId = source.watchPosition(
        (position) => {
          if (finished) return;
          const { longitude, latitude, accuracy } = position.coords;
          samples.push({ lng: longitude, lat: latitude, accuracy });
          options.onProgress?.([...samples]);
          if (samples.length >= maxSamples) finish();
        },
        (error) => {
          errorCode = error?.code;
          finish();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
      );
      // 极端情况下浏览器同步回调并提前结束，此时 watchId 刚拿到，需要补一次清理。
      if (finished && watchId !== null) {
        try {
          source.clearWatch(watchId);
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      errorCode = (error as { code?: number })?.code;
      finish();
    }
  });
}

