import { CoreError } from "./errors.ts";
import { validateEvidence } from "./report-validation.ts";
import type { AnalysisInput, PreparedPhoto } from "./types.internal.ts";

function plain(value: unknown, allowed: string[], required: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new CoreError("INVALID_ANALYSIS_INPUT");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !allowed.includes(key))
      || Object.values(descriptors).some(d => !("value" in d) || !d.enumerable)
      || required.some(key => !Object.hasOwn(descriptors, key))) throw new CoreError("INVALID_ANALYSIS_INPUT");
  return value as Record<string, unknown>;
}
function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10 || Reflect.ownKeys(value).length !== value.length + 1) throw new CoreError("INVALID_ANALYSIS_INPUT");
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index)) ?? {}, "value")) throw new CoreError("INVALID_ANALYSIS_INPUT");
  }
  return value;
}
export function validateAnalysisInput(value: unknown): AnalysisInput {
  try {
    const input = plain(value, ["photos", "apiKey", "provider", "location", "rentalMode", "mode"], ["photos", "apiKey", "provider", "mode"]);
    if (typeof input.apiKey !== "string" || input.provider !== "gemini" || !["mock", "real"].includes(input.mode as string)
        || (input.rentalMode !== undefined && !["whole", "shared", "unknown"].includes(input.rentalMode as string))) throw new CoreError("INVALID_ANALYSIS_INPUT");
    const photos = denseArray(input.photos);
    if (!photos.length) throw new CoreError("NO_PHOTOS");
    if (photos.some(photo => !(photo instanceof File))) throw new CoreError("INVALID_ANALYSIS_INPUT");
    const location = validateEvidence({ status: "no_match", query: input.location === undefined ? {} : input.location, items: [] }).query;
    return { photos: [...photos] as File[], apiKey: input.apiKey, provider: "gemini", mode: input.mode as AnalysisInput["mode"],
      location, rentalMode: input.rentalMode as AnalysisInput["rentalMode"] };
  } catch (error) {
    if (error instanceof CoreError && error.code === "NO_PHOTOS") throw error;
    throw new CoreError("INVALID_ANALYSIS_INPUT");
  }
}
export function validatePreparedPhotos(value: unknown, count: number): PreparedPhoto[] {
  try {
    const rows = denseArray(value);
    if (rows.length !== count) throw new Error();
    const ids = new Set<string>();
    return rows.map(row => {
      const photo = plain(row, ["id", "mimeType", "data"], ["id", "mimeType", "data"]);
      if (typeof photo.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(photo.id) || ids.has(photo.id)
          || !["image/jpeg", "image/png", "image/webp"].includes(photo.mimeType as string)
          || typeof photo.data !== "string" || !photo.data || photo.data.length > 4 * 1024 * 1024
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photo.data)) throw new Error();
      ids.add(photo.id);
      return { id: photo.id, mimeType: photo.mimeType as string, data: photo.data };
    });
  } catch { throw new CoreError("INVALID_PREPARED_PHOTOS"); }
}
/** Only called on validated plain B/C/report values. Known secrets never go to D2. */
export function rejectKnownSecrets(value: unknown, secrets: readonly string[]): void {
  if (typeof value === "string" && secrets.some(secret => secret && value.includes(secret))) throw new CoreError("INVALID_REPORT_INPUT");
  if (Array.isArray(value)) { for (const item of value) rejectKnownSecrets(item, secrets); }
  else if (value && typeof value === "object") { for (const item of Object.values(value)) rejectKnownSecrets(item, secrets); }
}
