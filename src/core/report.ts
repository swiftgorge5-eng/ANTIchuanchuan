import { CoreError } from "./errors.ts";
import { REPORT_CATEGORIES, REPORT_RULES } from "./report-rules.ts";
import { invalidReport, validateEvidence, validatePhotos } from "./report-validation.ts";
import type { EvidenceItem, FinalReport, PhotoObservation, PhotoObservationResult, EvidenceResult } from "./types.internal.ts";

const BASE_LIMITATIONS = Object.freeze([
  "照片无法判断甲醛浓度。", "照片不能独立判断结构安全。", "照片不能核实房屋产权和合同真实性。",
  "未找到公开资料不代表没有风险。", "当前分数未经真实样本校准，不是真实风险概率或安全鉴定。",
  "公开来源类型、URL 和匹配状态仅为 B 的上游声明；D 未联网访问或独立核验网页真实性。",
]);
const sameName = (left: string, right: string) => left.normalize("NFKC") === right.normalize("NFKC");
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function observationsUnique(rows: PhotoObservation[]): PhotoObservation[] {
  const grouped = new Map<string, PhotoObservation>();
  for (const row of rows) {
    const key = `${row.photoId}:${row.category}`;
    const previous = grouped.get(key);
    if (previous && previous.state !== row.state) invalidReport();
    const reasons = [...new Set([...(previous?.evidence ?? []), ...row.evidence])].sort();
    if (reasons.length > REPORT_RULES.maxReasons) invalidReport();
    grouped.set(key, { ...row, evidence: reasons });
  }
  return [...grouped.values()].sort((a, b) => order(a.photoId, b.photoId) || REPORT_CATEGORIES.indexOf(a.category) - REPORT_CATEGORIES.indexOf(b.category));
}
function evidenceUnique(rows: EvidenceItem[]): EvidenceItem[] {
  const grouped = new Map<string, EvidenceItem>();
  for (const row of rows) {
    const previous = grouped.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) invalidReport();
    grouped.set(row.id, row);
  }
  return [...grouped.values()].sort((a, b) => order(a.id, b.id));
}

/** Pure, offline composition. Runtime validation runs even when TS types match. */
export function composeReport(photoResult: PhotoObservationResult, evidenceResult: EvidenceResult,
                              rentalMode: "whole" | "shared" | "unknown" = "unknown"): FinalReport {
  try {
    if (!["whole", "shared", "unknown"].includes(rentalMode)) invalidReport();
    const observations = observationsUnique(validatePhotos(photoResult).observations);
    const evidence = validateEvidence(evidenceResult);
    evidence.items = evidenceUnique(evidence.items);
    const limitations: string[] = [...BASE_LIMITATIONS];
    const missing: string[] = [];
    if (!observations.length) missing.push("缺少照片观察结果");
    else if (observations.every(row => row.state === "unknown")) missing.push("所有照片观察均为 unknown");
    else if (observations.some(row => row.state === "unknown")) missing.push("仍存在 unknown 观察");
    if (REPORT_CATEGORIES.some(category => !observations.some(row => row.category === category && row.state !== "unknown" && row.evidence.length))) {
      missing.push("四类有效观察覆盖不足");
    }
    if (observations.some(row => row.state !== "unknown" && !row.evidence.length)) missing.push("明确观察缺少具体可见理由");
    if (evidence.status === "ambiguous") missing.push("小区匹配存在歧义");
    if (evidence.status === "no_match" || !evidence.items.length) missing.push("没有可采用的公开资料");
    if (!evidence.query.city || !evidence.query.communityName) missing.push("地点信息不完整");
    const publicItems = evidence.items.filter(item => item.sourceType === "public");
    const confirmed = publicItems.filter(item => item.matchStatus === "confirmed");
    if (!publicItems.length) missing.push("缺少上游声明的公开来源");
    else if (!confirmed.length) missing.push("公开来源仅为 possible 匹配");
    const community = evidence.query.communityName ?? "";
    if (confirmed.some(item => !sameName(item.communityName, community))) missing.push("已确认条目与查询小区不一致");
    if (!confirmed.some(item => sameName(item.communityName, community) && item.title && item.publisher && item.summary && item.date)) {
      missing.push("没有信息完整且与小区一致的 confirmed 公开条目");
    }
    if (evidence.items.some(item => item.sourceType === "synthetic")) limitations.push("包含 synthetic 合成演示数据；演示数据不构成真实公开证据，不参与评分门槛。");
    limitations.push("daylight_cue 未定义正负方向，暂不计分；租住方式不改变评分。不同 photoId 是否属于同一原图无法由本接口判断。");
    if (missing.length) {
      return { status: "success", risk: { score: null, level: "insufficient", calibrated: false,
        explanation: `证据不足：${missing.join("；")}。unknown 不按 absent 处理，不能据此判断房屋安全。D 未独立核验网页。` },
        observations, evidence, limitations, rentalMode };
    }
    const contributions = REPORT_CATEGORIES.map(category => ({ category,
      units: observations.some(row => row.category === category && row.state === "present") ? REPORT_RULES.weights[category] : 0 }));
    const score = contributions.reduce((sum, row) => sum + row.units, 0) / 100;
    const level = score >= REPORT_RULES.highAt ? "high" : score >= REPORT_RULES.mediumAt ? "medium" : "low";
    const detail = contributions.map(row => `${REPORT_RULES.labels[row.category]} ${row.units}/100`).join("，");
    return { status: "success", risk: { score, level, calibrated: false,
      explanation: `V0.1 暂定规则符合度：${detail}，合计 ${score}；low < ${REPORT_RULES.mediumAt}，medium < ${REPORT_RULES.highAt}，high >= ${REPORT_RULES.highAt}。四类观察均有明确理由，B 声明的匹配与来源信息满足原型门槛；D 未独立核验网页。present 仅为可见迹象，absent 仅为可见区域未见迹象；low/medium/high 是规则提示强度，不是危险或安全等级，0 也不表示零风险。` },
      observations, evidence, limitations, rentalMode };
  } catch {
    // Never echo raw objects, getters, schema-library errors or provider messages.
    throw new CoreError("INVALID_REPORT_INPUT");
  }
}
