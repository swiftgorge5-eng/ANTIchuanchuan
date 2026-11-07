import type { AnalysisStage } from "../core/index.ts";
import { STEPS, type StepId } from "./copy.ts";

type Phase = "idle" | "running" | "success" | "error" | "cancelled";

interface StageRailProps {
  stages: readonly AnalysisStage[];
  phase: Phase;
  sourceNote: string;
}

function mark(id: StepId, stages: readonly AnalysisStage[], phase: Phase): "wait" | "now" | "done" | "bad" {
  const seen = STEPS.map(([step]) => step).filter((step) => stages.includes(step));
  const last = seen[seen.length - 1];
  const lastIndex = last ? STEPS.findIndex(([step]) => step === last) : -1;
  const index = STEPS.findIndex(([step]) => step === id);
  if (phase === "success") return "done";
  if (index < lastIndex) return "done";
  if (index === lastIndex && phase === "running") return "now";
  if (index === lastIndex && (phase === "error" || phase === "cancelled")) return "bad";
  return "wait";
}

export function StageRail({ stages, phase, sourceNote }: StageRailProps) {
  const current = STEPS.find(([id]) => mark(id, stages, phase) === "now");
  return (
    <section className="stages" aria-label="分析进度">
      <div className="section-head">
        <h2>进度</h2>
        <p aria-live="polite">
          {current
            ? `当前：${current[1]}`
            : phase === "success"
              ? "报告已整理"
              : phase === "running"
                ? "正在开始"
                : phase === "error"
                  ? "分析中断"
                  : phase === "cancelled"
                    ? "已取消"
                    : "尚未开始"}
        </p>
      </div>
      <ol className="rail">
        {STEPS.map(([id, label], index) => {
          const state = mark(id, stages, phase);
          return (
            <li key={id} className={`rail-step is-${state}`}>
              <span className="rail-index">{index + 1}</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="note">{sourceNote}</p>
    </section>
  );
}
