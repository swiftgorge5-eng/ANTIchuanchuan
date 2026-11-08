/**
 * PhotoObserver：浏览器直连厂商视觉接口，把照片变成契约要求的 4 类观察。
 *
 * 与团队那份单文件应用同构（PROVIDERS 表 + 按 provider 构造请求 + JSON 输出），
 * 但这里额外做三件它们没做的事：
 *   - 输出必须过 D 的白名单校验（4 键 / 4 类 / 敏感词过滤）
 *   - 自带超时与取消，绝不把 D 的 30-60 秒阶段计时拖爆
 *   - 任何错误都映射成受控 CoreError，不泄露 Key、图片或厂商原文
 */
import { CoreError, throwIfAborted } from "../core/errors.ts";
import type { PhotoInput, PhotoObservationResult } from "../core/types.internal.ts";
import { buildPrompt } from "./prompt.ts";
import {
  PROVIDERS,
  buildRequest,
  extractText,
  isPhotoProvider,
  parseJsonObject,
  type PhotoProvider,
} from "./providers.ts";
import { normalizeObservations } from "./validate.ts";

export interface PhotoObserverOptions {
  /** 默认 deepseek；契约里的 provider 字段是固定字面量，这里刻意不读它。 */
  provider?: PhotoProvider;
  /** 默认 55 秒；调用方还可以通过 createAnalysisRunner 的 timeouts 放宽。 */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type PhotoObserver = (input: PhotoInput) => Promise<PhotoObservationResult>;

const MAX_RESPONSE_CHARS = 1_000_000;

export function createPhotoObserver(options: PhotoObserverOptions = {}): PhotoObserver {
  const provider: PhotoProvider = options.provider ?? "deepseek";
  if (!isPhotoProvider(provider)) throw new CoreError("INVALID_OPTIONS");
  const timeoutMs = options.timeoutMs ?? 55_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new CoreError("INVALID_OPTIONS");
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  return async function observePhotos(input: PhotoInput): Promise<PhotoObservationResult> {
    throwIfAborted(input.signal);
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (!apiKey) throw new CoreError("KEY_REQUIRED");
    const photos = Array.isArray(input.photos) ? input.photos : [];
    if (photos.length === 0) throw new CoreError("INVALID_PREPARED_PHOTOS");

    const prompt = buildPrompt(photos.length);
    const request = buildRequest(provider, photos, prompt, apiKey);

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    input.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await doFetch(PROVIDERS[provider].endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...request.headers },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        body: JSON.stringify(request.body),
      });

      if (!response.ok) {
        // 不读取正文：厂商错误里可能带请求细节，只按状态码映射。
        void response.body?.cancel().catch(() => {});
        throw new CoreError(mapStatus(response.status));
      }

      const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
      const payload = parseJsonObject(text);
      if (payload === null) throw new CoreError("UNKNOWN_ERROR");

      const output = extractText(provider, payload);
      const parsed = parseJsonObject(output);
      if (parsed === null) throw new CoreError("UNKNOWN_ERROR");

      const photoIds = photos.map((photo) => photo.id);
      return normalizeObservations(parsed, photoIds, [apiKey]);
    } catch (error) {
      if (error instanceof CoreError) throw error;
      if (input.signal.aborted) throw new CoreError("CANCELLED");
      if (timedOut) throw new CoreError("TIMEOUT");
      throw new CoreError("UNKNOWN_ERROR");
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", onAbort);
    }
  };
}

/** 只按状态码映射，不解析厂商正文。 */
function mapStatus(status: number): "KEY_REQUIRED" | "UNKNOWN_ERROR" {
  if (status === 401 || status === 403) return "KEY_REQUIRED";
  return "UNKNOWN_ERROR";
}
