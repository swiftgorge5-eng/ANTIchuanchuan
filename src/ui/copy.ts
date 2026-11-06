import type { AnalysisInput, FinalReport } from "../core/index.ts";

export const PHOTO_LIMIT = "1–10 张，JPEG、PNG 或 WebP，单张不超过 10MB。";

export const CATEGORY_LABEL = {
  renovation_trace: "装修迹象",
  partition_trace: "分隔迹象",
  moisture_trace: "潮湿迹象",
  daylight_cue: "采光线索",
} as const;

export const STATE_LABEL = {
  present: "可见迹象",
  absent: "相关区域可见，未见该迹象",
  unknown: "无法判断",
} as const;

export const LEVEL_LABEL = {
  low: "规则提示强度：低",
  medium: "规则提示强度：中",
  high: "规则提示强度：高",
  insufficient: "证据不足",
} as const;

export const RENTAL_LABEL = {
  whole: "整租",
  shared: "合租",
  unknown: "未说明",
} as const;

export const STEPS = [
  ["preparing", "准备照片"],
  ["observing", "AI 观察"],
  ["retrieving", "搜索已收录公开资料"],
  ["composing", "报告整理"],
] as const;

export type StepId = (typeof STEPS)[number][0];
export type ReportObservation = FinalReport["observations"][number];
export type ReportEvidence = FinalReport["evidence"];

export function evidenceIntro(evidence: ReportEvidence): string {
  if (evidence.status === "no_match" || evidence.items.length === 0) {
    return "暂无可核验证据。没有匹配记录，不能据此认为没有风险。";
  }
  if (evidence.status === "ambiguous") {
    return "地点存在歧义。下面的条目不能当作已经确认的同一小区证据。";
  }
  if (evidence.items.every((item) => item.sourceType === "synthetic")) {
    return "下面是合成演示数据，不是公开记录。";
  }
  return "下面是资料模块返回的记录。公开来源和演示数据已分开标记。";
}

export function buildAnalysisInput(options: {
  photos: File[];
  apiKey: string;
  mode: AnalysisInput["mode"];
  rentalMode: NonNullable<AnalysisInput["rentalMode"]>;
  city: string;
  district: string;
  communityName: string;
  addressHint: string;
}): { input?: AnalysisInput; error?: string } {
  const location: NonNullable<AnalysisInput["location"]> = {};
  const fields = [
    ["city", options.city],
    ["district", options.district],
    ["communityName", options.communityName],
    ["addressHint", options.addressHint],
  ] as const;
  for (const [key, raw] of fields) {
    const value = raw.trim();
    if (!value) continue;
    if (value.length > 120 || /[<>\u0000-\u001f\u007f]/u.test(value)) {
      return { error: "地点每项不超过 120 字，且不能包含尖括号或控制字符。" };
    }
    location[key] = value;
  }
  const input: AnalysisInput = {
    photos: options.photos,
    apiKey: options.mode === "mock" ? "" : options.apiKey,
    provider: "gemini",
    mode: options.mode,
    rentalMode: options.rentalMode,
  };
  if (Object.keys(location).length > 0) input.location = location;
  return { input };
}
