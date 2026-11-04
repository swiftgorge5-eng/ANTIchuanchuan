/** V0.1 provisional limits. No automatic retries, including real model calls. */
export const ANALYSIS_POLICY = Object.freeze({ preparingMs: 15_000, observingMs: 30_000, retrievingMs: 10_000, totalMs: 60_000, retries: 0 });
export interface AnalysisTimeouts { preparingMs: number; observingMs: number; retrievingMs: number; totalMs: number }
export interface AnalysisClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const BROWSER_CLOCK: AnalysisClock = Object.freeze({
  now: () => performance.now(),
  setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
});
