import { downloadReport, runAnalysis, toSafeError } from "../core/index.ts";
import type { AnalysisInput, AnalysisStage, FinalReport } from "../core/index.ts";

export type EvidenceSource = "demo" | "history";

/**
 * 真实模式：照片观察走 C 的浏览器直连适配器，证据仍来自本地历史资料库。
 * 这两个模块都是按需加载的，避免把模型适配器和 178KB 资料库塞进首屏包。
 */
async function runRealAnalysis(
  input: AnalysisInput,
  onStage: (stage: AnalysisStage) => void,
  signal: AbortSignal,
): Promise<FinalReport> {
  const [{ createAnalysisRunner }, { createMockPorts }, { retrieveEvidence }, { createPhotoObserver }] = await Promise.all([
    import("../core/orchestrator.ts"),
    import("../core/adapters/mock.ts"),
    import("../evidence/browser.ts"),
    import("../photo/index.ts"),
  ]);
  const runner = createAnalysisRunner(
    {
      mock: createMockPorts({ scenario: "unknown" }),
      real: { observePhotos: createPhotoObserver({ provider: "deepseek", timeoutMs: 90_000 }), retrieveEvidence },
    },
    // 真实模型比 Mock 慢得多：给观察阶段留足时间，但总时长仍然封顶。
    { timeouts: { observingMs: 95_000, retrievingMs: 20_000, totalMs: 120_000 } },
  );
  return runner(input, onStage, signal);
}

export async function runPageAnalysis(
  source: EvidenceSource,
  input: AnalysisInput,
  onStage: (stage: AnalysisStage) => void,
  signal: AbortSignal,
): Promise<FinalReport> {
  if (input.mode === "real") return runRealAnalysis(input, onStage, signal);
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
  // 真实模式下走到这里，说明请求已经发出去了：不要再说"照片没有被读取"。
  if (safe.code === "KEY_REQUIRED" && mode === "real") {
    return "模型服务商拒绝了这个密钥（无效或权限不足）。本次照片已经发送，请更换 Key 后重试。";
  }
  if (safe.code === "KEY_REQUIRED") return `${safe.message}。照片没有被读取。`;
  if (safe.code === "TIMEOUT" && mode === "real") return "模型响应超时。照片已发送，但没有拿到结果，请稍后重试。";
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
