import { downloadReport, runAnalysis, toSafeError } from "../core/index.ts";
import type { AnalysisInput, AnalysisStage, FinalReport } from "../core/index.ts";

export type EvidenceSource = "demo" | "history";

export async function runPageAnalysis(
  source: EvidenceSource,
  input: AnalysisInput,
  onStage: (stage: AnalysisStage) => void,
  signal: AbortSignal,
): Promise<FinalReport> {
  if (source === "history") {
    const { runAnalysisWithRag } = await import("../evidence/browser.ts");
    return runAnalysisWithRag(input, onStage, signal);
  }
  return runAnalysis(input, onStage, signal);
}

export function safeMessage(error: unknown, mode: AnalysisInput["mode"]): string {
  const safe = toSafeError(error);
  if (safe.code === "CANCELLED") return "分析已取消。";
  if (safe.code === "ADAPTER_UNAVAILABLE" && mode === "real") {
    return `${safe.message}。照片没有被读取，也没有发往第三方。`;
  }
  if (safe.code === "KEY_REQUIRED") return `${safe.message}。照片没有被读取。`;
  return safe.message;
}

export function errorCode(error: unknown): string {
  return toSafeError(error).code;
}

export function saveReport(report: FinalReport): void {
  downloadReport(report);
}

export function downloadFailure(error: unknown): string {
  return toSafeError(error).message;
}
