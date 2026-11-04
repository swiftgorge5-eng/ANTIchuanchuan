import { CoreError } from "./errors.ts";

export type ExecutionMode = "mock" | "real";

/** Per-call value only. No module/global key cache, storage, logging or URL access. */
export function modelKeyForCall(mode: ExecutionMode, apiKey: string): string {
  if (mode === "mock") return "";
  if (mode !== "real" || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new CoreError("KEY_REQUIRED");
  }
  return apiKey.trim();
}

/** Data minimization: only an explicit, non-sensitive error DTO may leave core.
 * Error serialization lives in errors.ts; never stringify AnalysisInput/PhotoInput.
 * JS immutable strings cannot be reliably zeroized. Caller must release references.
 */
