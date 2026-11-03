import { CoreError, toSafeError } from "./errors.ts";
import { preprocessPhotos } from "./preprocess.ts";
import { composeReport } from "./report.ts";
import { validateEvidence, validatePhotos } from "./report-validation.ts";
import { createPhotoInput, selectPorts } from "./ports.ts";
import type { CorePorts } from "./ports.ts";
import { modelKeyForCall } from "./security.ts";
import { createMockPorts } from "./adapters/mock.ts";
import { rejectKnownSecrets, validateAnalysisInput, validatePreparedPhotos } from "./analysis-validation.ts";
import { ANALYSIS_POLICY, BROWSER_CLOCK } from "./orchestration-config.ts";
import type { AnalysisClock, AnalysisTimeouts } from "./orchestration-config.ts";
import type { AnalysisInput, AnalysisStage, FinalReport } from "./types.internal.ts";

export type AnalysisRunner = (input: AnalysisInput, onStage: (stage: AnalysisStage) => void, signal: AbortSignal) => Promise<FinalReport>;
export interface RunnerOptions {
  preprocess?: typeof preprocessPhotos;
  timeouts?: Partial<AnalysisTimeouts>;
  clock?: AnalysisClock;
}

/** Internal/test integration factory. Public runAnalysis retains exactly 3 args. */
export function createAnalysisRunner(portGroup: { mock: CorePorts; real?: CorePorts }, options: RunnerOptions = {}): AnalysisRunner {
  const limits = { ...ANALYSIS_POLICY, ...options.timeouts };
  for (const key of ["preparingMs", "observingMs", "retrievingMs", "totalMs"] as const) {
    if (!Number.isFinite(limits[key]) || limits[key] <= 0 || limits[key] > 300_000) throw new CoreError("INVALID_OPTIONS");
  }
  const clock = options.clock ?? BROWSER_CLOCK;
  const prepare = options.preprocess ?? preprocessPhotos;
  return async (rawInput, onStage, userSignal) => {
    const controller = new AbortController();
    let stopped: "CANCELLED" | "TIMEOUT" | undefined;
    let ended = false;
    let totalTimer: unknown;
    let totalDeadline = Infinity;
    let activeReject: ((error: CoreError) => void) | undefined;
    let attached = false;
    const emit = (stage: AnalysisStage) => {
      try {
        // UI observer errors (sync or async) are isolated, never logged or exposed.
        const result: unknown = typeof onStage === "function" ? onStage(stage) : undefined;
        if (result && (typeof result === "object" || typeof result === "function")) void Promise.resolve(result).catch(() => {});
      } catch { /* A presentation failure does not change analysis semantics. */ }
    };
    const stop = (code: "CANCELLED" | "TIMEOUT") => {
      if (ended || stopped) return;
      stopped = code;
      activeReject?.(new CoreError(code));
      controller.abort(); // Never pass userSignal.reason to a downstream adapter.
    };
    const cancelled = () => stop("CANCELLED");
    const check = (stageDeadline = Infinity) => {
      if (!stopped && userSignal.aborted) stop("CANCELLED");
      if (!stopped && clock.now() >= Math.min(totalDeadline, stageDeadline)) stop("TIMEOUT");
      if (stopped) throw new CoreError(stopped);
    };
    const cleanup = () => {
      if (totalTimer !== undefined) clock.clearTimeout(totalTimer);
      if (attached) userSignal.removeEventListener("abort", cancelled);
      activeReject = undefined;
    };
    async function phase<T>(stage: AnalysisStage, ms: number, work: () => Promise<T>): Promise<T> {
      check();
      const deadline = clock.now() + ms;
      const timer = clock.setTimeout(() => stop("TIMEOUT"), ms);
      try {
        emit(stage); check(deadline);
        return await new Promise<T>((resolve, reject) => {
          let done = false;
          const fail = (error: unknown) => { if (!done) { done = true; reject(error); } };
          activeReject = fail;
          // Install handlers before invoking untrusted work; late rejection is consumed.
          void Promise.resolve().then(() => { check(deadline); return work(); }).then(value => {
            if (done) return;
            try { check(deadline); done = true; resolve(value); } catch (error) { fail(error); }
          }, fail);
        });
      } finally {
        activeReject = undefined;
        clock.clearTimeout(timer);
      }
    }
    try {
      if (!(userSignal instanceof AbortSignal) || typeof onStage !== "function") throw new CoreError("INVALID_ANALYSIS_INPUT");
      if (userSignal.aborted) throw new CoreError("CANCELLED");
      const input = validateAnalysisInput(rawInput);
      const ports = selectPorts(input.mode, portGroup);
      modelKeyForCall(input.mode, input.apiKey); // Validate real key BEFORE preprocessing.
      totalDeadline = clock.now() + limits.totalMs;
      userSignal.addEventListener("abort", cancelled, { once: true }); attached = true;
      totalTimer = clock.setTimeout(() => stop("TIMEOUT"), limits.totalMs);
      check();
      const prepared = validatePreparedPhotos(await phase("preparing", limits.preparingMs,
        () => prepare(input.photos, { signal: controller.signal })), input.photos.length);
      check();
      const secrets = [input.apiKey.trim(), ...prepared.map(photo => photo.data)].filter(Boolean);
      const photoIds = new Set(prepared.map(photo => photo.id));
      const observed = validatePhotos(await phase("observing", limits.observingMs,
        () => ports.observePhotos(createPhotoInput(prepared.map(photo => ({ ...photo })), input.mode, input.apiKey, controller.signal))));
      if (observed.observations.some(row => !photoIds.has(row.photoId))) throw new CoreError("INVALID_REPORT_INPUT");
      rejectKnownSecrets(observed, secrets); check();
      const requested = { ...input.location };
      const evidence = validateEvidence(await phase("retrieving", limits.retrievingMs,
        () => ports.retrieveEvidence({ ...requested })));
      for (const field of ["city", "district", "communityName", "addressHint"] as const) {
        if (requested[field] && requested[field].normalize("NFKC") !== (evidence.query[field] ?? "").normalize("NFKC")) {
          throw new CoreError("INVALID_REPORT_INPUT");
        }
      }
      rejectKnownSecrets(evidence, secrets); check();
      emit("composing"); check();
      const report = composeReport(observed, evidence, input.rentalMode);
      rejectKnownSecrets(report, secrets); check();
      // Commit point: timers/listeners end BEFORE success callback. Later abort is inert.
      ended = true; cleanup(); emit("success");
      return report;
    } catch (error) {
      if (!stopped && userSignal instanceof AbortSignal && userSignal.aborted) stopped = "CANCELLED";
      const code = stopped ?? toSafeError(error).code;
      const safeCode = code === "CANCELLED" && !stopped && !(userSignal instanceof AbortSignal && userSignal.aborted) ? "UNKNOWN_ERROR" : code;
      ended = true; cleanup(); controller.abort();
      emit(safeCode === "CANCELLED" ? "cancelled" : "error");
      throw new CoreError(safeCode);
    }
  };
}

const defaultRunner = createAnalysisRunner({ mock: createMockPorts() });
export const runAnalysis: AnalysisRunner = (input, onStage, signal) => defaultRunner(input, onStage, signal);
