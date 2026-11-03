import { CoreError, throwIfAborted } from "../errors.ts";
import type { CorePorts } from "../ports.ts";
import { REPORT_CATEGORIES } from "../report-rules.ts";
import type { PhotoObservation } from "../types.internal.ts";

export interface MockOptions {
  scenario?: "standard" | "unknown" | "ambiguous" | "no_sources" | "synthetic";
  states?: readonly PhotoObservation["state"][];
  failAt?: "observing" | "retrieving";
  /** Test gate: may resolve/reject later. Caller owns any gate resources. No timers here. */
  waitFor?: (stage: "observing" | "retrieving") => Promise<void>;
  ignoreObserverAbort?: boolean;
}
/** Deterministic/offline. No key/config reads, real URLs, timers or global state. */
export function createMockPorts(options: MockOptions = {}): CorePorts {
  const scenario = options.scenario ?? "standard";
  if (!["standard", "unknown", "ambiguous", "no_sources", "synthetic"].includes(scenario)) throw new CoreError("INVALID_OPTIONS");
  const states: PhotoObservation["state"][] = [...(options.states ?? ["present", "absent", "absent", "present"])];
  if (states.length !== 4 || states.some(state => !["present", "absent", "unknown"].includes(state))) throw new CoreError("INVALID_OPTIONS");
  return {
    async observePhotos(input) {
      if (!options.ignoreObserverAbort) throwIfAborted(input.signal);
      await options.waitFor?.("observing");
      if (!options.ignoreObserverAbort) throwIfAborted(input.signal);
      if (options.failAt === "observing") throw new CoreError("MOCK_FAILURE");
      return { schema_version: 1, observations: input.photos.flatMap(photo => REPORT_CATEGORIES.map((category, index) => ({
        photoId: photo.id, category, state: scenario === "unknown" ? "unknown" : states[index],
        evidence: [`合成演示：${category} 的 ${scenario === "unknown" ? "unknown" : states[index]} 观察，不代表真实住房结果`],
      }))) };
    },
    async retrieveEvidence(query) {
      await options.waitFor?.("retrieving");
      if (options.failAt === "retrieving") throw new CoreError("MOCK_FAILURE");
      if (scenario === "no_sources") return { status: "no_match", query: { ...query }, items: [] };
      const ambiguous = scenario === "ambiguous";
      return { status: ambiguous ? "ambiguous" : "matched", query: { ...query }, items: [{
        id: "synthetic-e1", communityName: query.communityName || "合成演示小区", sourceType: "synthetic",
        title: "合成演示资料", publisher: "D 模块离线演示", url: null, date: null,
        summary: "虚构演示条目，不是公开记录或真实住房证据", matchStatus: ambiguous ? "possible" : "confirmed",
      }] };
    },
  };
}
