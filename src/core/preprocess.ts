import { CoreError, throwIfAborted, toSafeError } from "./errors.ts";
import { inspectImage } from "./image-header.ts";
import type { PhotoMime } from "./image-header.ts";
import type { PreparedPhoto } from "./types.internal.ts";

export interface PreprocessOptions {
  signal?: AbortSignal;
  maxFiles?: number;
  maxInputBytes?: number;
  maxPixels?: number;
  maxDimension?: number;
  maxOutputBytes?: number;
  maxEdge?: number;
  outputMimeType?: PhotoMime;
  quality?: number;
}
export const DEFAULT_PHOTO_LIMITS = Object.freeze({
  maxFiles: 10, maxInputBytes: 10 * 1024 * 1024, maxPixels: 25_000_000,
  maxDimension: 32768, maxOutputBytes: 3 * 1024 * 1024, maxEdge: 2048,
  outputMimeType: "image/webp" as PhotoMime, quality: 0.85,
});
const MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** The browser decoder/encoder itself cannot be interrupted. Late bitmaps close. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const cancel = () => {
      if (!done) { done = true; cleanup(); reject(new CoreError("CANCELLED")); }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    promise.then(value => {
      if (done) {
        try { disposeLate?.(value); } catch { /* Never leak a late decoder error. */ }
        return;
      }
      done = true; cleanup(); resolve(value);
    }, error => {
      if (!done) { done = true; cleanup(); reject(error); }
    });
    if (signal?.aborted) cancel();
  });
}

function dimensions(width: number, height: number, limits: Pick<Required<PreprocessOptions>, "maxDimension" | "maxPixels">): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new CoreError("INVALID_IMAGE");
  }
  if (width > limits.maxDimension || height > limits.maxDimension || width * height > limits.maxPixels) {
    throw new CoreError("IMAGE_TOO_LARGE");
  }
}

async function encode(bitmap: ImageBitmap, width: number, height: number, mime: PhotoMime,
                      quality: number, signal?: AbortSignal): Promise<Blob> {
  let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
  try {
    if (typeof globalThis.OffscreenCanvas === "function") canvas = new OffscreenCanvas(width, height);
    else if (typeof document !== "undefined") {
      canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    } else throw new CoreError("BROWSER_UNSUPPORTED");
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new CoreError("BROWSER_UNSUPPORTED");
    // JPEG cannot represent alpha; explicitly use white instead of implicit black.
    if (mime === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); }
    context.drawImage(bitmap, 0, 0, width, height);
    throwIfAborted(signal);
    const pending = "convertToBlob" in canvas
      ? canvas.convertToBlob({ type: mime, quality })
      : new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob(
        blob => blob ? resolve(blob) : reject(new CoreError("ENCODE_FAILED")), mime, quality,
      ));
    return await abortable(pending, signal);
  } catch (error) {
    if (error instanceof CoreError) throw new CoreError(toSafeError(error).code);
    throw new CoreError("ENCODE_FAILED");
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

function base64(bytes: Uint8Array, signal?: AbortSignal): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    throwIfAborted(signal);
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** Offline, sequential, all-or-nothing batch. No key, URL, storage or network IO. */
export async function preprocessPhotos(files: File[], options: PreprocessOptions = {}): Promise<PreparedPhoto[]> {
  let signal: AbortSignal | undefined;
  try {
    if (!options || typeof options !== "object") throw new CoreError("INVALID_OPTIONS");
    const candidate = options.signal;
    if (candidate !== undefined && !(candidate instanceof AbortSignal)) throw new CoreError("INVALID_OPTIONS");
    signal = candidate;
    throwIfAborted(signal);
    const limits = { ...DEFAULT_PHOTO_LIMITS, ...options };
    for (const name of ["maxFiles", "maxInputBytes", "maxPixels", "maxDimension", "maxOutputBytes", "maxEdge"] as const) {
      if (!Number.isSafeInteger(limits[name]) || limits[name] <= 0) throw new CoreError("INVALID_OPTIONS");
    }
    if (!MIME_TYPES.includes(limits.outputMimeType) || !Number.isFinite(limits.quality) || limits.quality <= 0 || limits.quality > 1) {
      throw new CoreError("INVALID_OPTIONS");
    }
    if (!Array.isArray(files) || !files.length) throw new CoreError("NO_PHOTOS");
    if (files.length > limits.maxFiles) throw new CoreError("TOO_MANY_PHOTOS");
    for (const file of files) {
      if (!(file instanceof File) || !file.size) throw new CoreError("EMPTY_PHOTO");
      if (file.size > limits.maxInputBytes) throw new CoreError("PHOTO_TOO_LARGE");
      if (!MIME_TYPES.includes(file.type)) throw new CoreError("UNSUPPORTED_FORMAT");
    }
    if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.crypto?.randomUUID !== "function") {
      throw new CoreError("BROWSER_UNSUPPORTED");
    }
    const output: PreparedPhoto[] = [];
    for (const file of files) {
      throwIfAborted(signal);
      const source = new Uint8Array(await abortable(file.arrayBuffer(), signal));
      const header = inspectImage(source);
      if (header.mime !== file.type) throw new CoreError("TYPE_MISMATCH");
      dimensions(header.width, header.height, limits);
      let bitmap: ImageBitmap | undefined;
      try {
        try {
          bitmap = await abortable(createImageBitmap(new Blob([source], { type: header.mime }), {
            imageOrientation: "from-image",
          }), signal, late => late.close());
        } catch (error) {
          throwIfAborted(signal);
          if (error instanceof CoreError) throw new CoreError(toSafeError(error).code);
          throw new CoreError("INVALID_IMAGE");
        }
        throwIfAborted(signal);
        dimensions(bitmap.width, bitmap.height, limits);
        const same = bitmap.width === header.width && bitmap.height === header.height;
        // from-image may rotate JPEG, PNG eXIf or WebP EXIF, depending on browser.
        const rotated = bitmap.width === header.height && bitmap.height === header.width;
        if (!same && !rotated) throw new CoreError("INVALID_IMAGE");
        const ratio = Math.min(1, limits.maxEdge / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        const blob = await encode(bitmap, width, height, limits.outputMimeType, limits.quality, signal);
        throwIfAborted(signal);
        if (!blob.size) throw new CoreError("ENCODE_FAILED");
        if (blob.size > limits.maxOutputBytes) throw new CoreError("OUTPUT_TOO_LARGE");
        // Unsupported canvas encoders may fall back to PNG. Report its REAL type.
        if (!MIME_TYPES.includes(blob.type)) throw new CoreError("ENCODE_FAILED");
        const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
        const encoded = inspectImage(bytes);
        if (encoded.mime !== blob.type || encoded.width !== width || encoded.height !== height) throw new CoreError("ENCODE_FAILED");
        if (encoded.sensitiveMetadata) throw new CoreError("METADATA_RETAINED");
        const data = base64(bytes, signal);
        throwIfAborted(signal);
        output.push({ id: crypto.randomUUID(), mimeType: encoded.mime, data });
      } finally {
        bitmap?.close();
      }
    }
    return output;
  } catch (error) {
    // Throw a fresh error without raw causes/filename/provider data.
    throwIfAborted(signal);
    throw new CoreError(toSafeError(error).code);
  }
}
