import { CoreError, toSafeError } from "./errors.ts";
import { modelKeyForCall } from "./security.ts";
import type { ExecutionMode } from "./security.ts";
import type { EvidenceResult, LocationQuery, PhotoInput, PhotoObservationResult, PreparedPhoto } from "./types.internal.ts";

export interface CorePorts {
  retrieveEvidence(input: LocationQuery): Promise<EvidenceResult>;
  observePhotos(input: PhotoInput): Promise<PhotoObservationResult>;
}

/** Selection only, not D2 orchestration. Mock selection never reads real ports. */
export function selectPorts(mode: ExecutionMode, ports: { mock: CorePorts; real?: CorePorts }): CorePorts {
  try {
    const selected = mode === "mock" ? ports.mock : mode === "real" ? ports.real : undefined;
    if (!selected || typeof selected.observePhotos !== "function" || typeof selected.retrieveEvidence !== "function") {
      throw new CoreError("ADAPTER_UNAVAILABLE");
    }
    return selected;
  } catch (error) {
    throw new CoreError(toSafeError(error).code);
  }
}

export function createPhotoInput(photos: PreparedPhoto[], mode: ExecutionMode, apiKey: string, signal: AbortSignal): PhotoInput {
  return { photos, apiKey: modelKeyForCall(mode, apiKey), provider: "gemini", signal };
}
