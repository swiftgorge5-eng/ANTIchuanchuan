import { CoreError } from "./errors.ts";
import { composeReport } from "./report.ts";
import { text, validateDataArray, validateDataObject, validateEvidence, validatePhotos } from "./report-validation.ts";
import type { FinalReport, RiskAssessment } from "./types.internal.ts";

/** Fixed basename: never derive a download path/name from user input or report text. */
export const REPORT_FILENAME = "antochuanchuan-report.json";
const URL_REVOKE_DELAY_MS = 1000;

function validatedReport(value: unknown): FinalReport {
  const root = validateDataObject(value, ["status", "risk", "observations", "evidence", "limitations", "rentalMode"]);
  if (root.status !== "success" || !["whole", "shared", "unknown"].includes(root.rentalMode as string)) throw new CoreError("INVALID_REPORT_INPUT");
  const rawRisk = validateDataObject(root.risk, ["score", "level", "calibrated", "explanation"]);
  if (rawRisk.calibrated !== false || (rawRisk.score !== null && (typeof rawRisk.score !== "number"
      || !Number.isFinite(rawRisk.score) || rawRisk.score < 0 || rawRisk.score > 1))
      || !["low", "medium", "high", "insufficient"].includes(rawRisk.level as string)
      || (rawRisk.score === null) !== (rawRisk.level === "insufficient")) throw new CoreError("INVALID_REPORT_INPUT");
  // D2's fixed threshold prose contains mathematical < and >=, not HTML tags.
  if (typeof rawRisk.explanation !== "string") throw new CoreError("INVALID_REPORT_INPUT");
  text(rawRisk.explanation.replace(/< (?=\d)/g, "小于 ").replace(/>= (?=\d)/g, "大于等于 "), 4000);
  const explanation = rawRisk.explanation.trim();
  if (!explanation) throw new CoreError("INVALID_REPORT_INPUT");
  const observations = validatePhotos({ schema_version: 1, observations: root.observations }).observations;
  const evidence = validateEvidence(root.evidence);
  const limitations = validateDataArray(root.limitations, 32).map(value => text(value, 2000));
  if (!limitations.length || limitations.some(line => !line)) throw new CoreError("INVALID_REPORT_INPUT");
  const rentalMode = root.rentalMode as FinalReport["rentalMode"];
  // Recheck the current D2 policy, without rewriting the caller's explanation/report.
  const expected = composeReport({ schema_version: 1, observations }, evidence, rentalMode);
  if (rawRisk.score !== expected.risk.score || rawRisk.level !== expected.risk.level) throw new CoreError("INVALID_REPORT_INPUT");
  for (const required of expected.limitations) {
    if (!limitations.includes(required)) throw new CoreError("INVALID_REPORT_INPUT");
  }
  return { status: "success", risk: { score: rawRisk.score as number | null, level: rawRisk.level as RiskAssessment["level"],
    calibrated: false, explanation }, observations, evidence, limitations, rentalMode };
}

/** Pure serialization. No toJSON hooks, storage, URL creation or download side effects. */
export function serializeReport(report: FinalReport): string {
  try {
    return JSON.stringify(validatedReport(report), null, 2);
  } catch {
    throw new CoreError("INVALID_REPORT_INPUT");
  }
}

/** Blob encodes the JSON string as UTF-8; does not create a URL or initiate download. */
export function createReportBlob(report: FinalReport): Blob {
  const json = serializeReport(report);
  try { return new Blob([json], { type: "application/json;charset=utf-8" }); }
  catch { throw new CoreError("DOWNLOAD_UNAVAILABLE"); }
}

/** E must call only from an explicit user download action, after privacy notice.
 * Module import, runAnalysis and serializeReport never invoke this function.
 */
export function downloadReport(report: FinalReport): void {
  const blob = createReportBlob(report); // Validate before creating any DOM/URL resources.
  try {
    if (typeof document === "undefined" || !document.body || typeof document.createElement !== "function"
        || typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
      throw new CoreError("DOWNLOAD_UNAVAILABLE");
    }
  } catch { throw new CoreError("DOWNLOAD_UNAVAILABLE"); }
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  let clicked = false;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.hidden = true;
    anchor.href = url;
    anchor.download = REPORT_FILENAME;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    clicked = true;
  } catch {
    throw new CoreError("DOWNLOAD_FAILED");
  } finally {
    try { anchor?.remove(); } catch { /* Avoid leaking DOM exception text. */ }
    if (url !== undefined) {
      const ownedURL = url;
      const revoke = () => { try { URL.revokeObjectURL(ownedURL); } catch { /* No raw browser errors in logs. */ } };
      // Let the browser consume the click before revoking. Failure paths revoke now.
      if (clicked) { try { globalThis.setTimeout(revoke, URL_REVOKE_DELAY_MS); } catch { revoke(); } }
      else revoke();
    }
  }
}
