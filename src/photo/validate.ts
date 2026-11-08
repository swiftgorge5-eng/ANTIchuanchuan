/**
 * Turns whatever the model returned into something D will accept.
 *
 * D 的校验是白名单式的：只能有 photoId/category/state/evidence 四个键、只能是四个类别、
 * evidence 命中敏感词表整份报告就作废。所以这里做三件事：
 *   1. 补全缺失类别（unknown）
 *   2. 清洗文本（去控制字符/尖括号、限长、去重）
 *   3. 命中敏感词的原因直接丢弃，若全被丢弃则把该类别降级为 unknown
 */
import { OBSERVATION_CATEGORIES, type ObservationCategory } from "./prompt.ts";
import type { PhotoObservation, PhotoObservationResult } from "../core/types.internal.ts";

const STATES = ["present", "absent", "unknown"] as const;
type State = (typeof STATES)[number];

/** 与 core/report-validation.ts 完全一致；命中即整条作废。 */
const FORBIDDEN = /串串房|甲醛|承重墙|产权|合同真实|违法|违规|结构安全/u;
/** 与 core/report-validation.ts 的 UNSAFE 同源，防止把密钥或图片流写进说明。 */
const UNSAFE = /(?:data:[^,\s]*base64|file:\/\/|\b[a-z]:[\\/]|(?:^|\s)\/(?:Users|home|tmp|private|mnt)\/|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]|\bBearer\s+\S+|\bAIza[\w-]{20,}|\bsk-(?:proj-)?[\w-]{15,}|\b(?:gh[pousr]_|github_pat_)[\w]{15,}|[A-Za-z0-9+/]{80,}={0,2})/iu;
const CONTROL = /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/gu;

const MAX_REASONS = 3;
const MAX_REASON_LENGTH = 120;
const FALLBACK_REASON = "照片中看不到足以判断这一项的画面";

export const SAFE_UNKNOWN_REASON = FALLBACK_REASON;

function clean(value: unknown, secrets: readonly string[]): string {
  if (typeof value !== "string") return "";
  let text = value.replace(CONTROL, " ").replace(/\s+/gu, " ").trim();
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && text.includes(secret)) return "";
  }
  if (!text) return "";
  if (FORBIDDEN.test(text)) return "";
  if (UNSAFE.test(text)) return "";
  if (text.length > MAX_REASON_LENGTH) text = text.slice(0, MAX_REASON_LENGTH);
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

const isCategory = (value: unknown): value is ObservationCategory =>
  typeof value === "string" && (OBSERVATION_CATEGORIES as readonly string[]).includes(value);
const isState = (value: unknown): value is State =>
  typeof value === "string" && (STATES as readonly string[]).includes(value);

/**
 * @param parsed  model output, already JSON.parsed
 * @param photos  本次提交的 photoId 列表
 * @param secrets 需要确保不回显的字符串（apiKey）
 */
export function normalizeObservations(
  parsed: unknown,
  photos: readonly string[],
  secrets: readonly string[] = [],
): PhotoObservationResult {
  const root = asRecord(parsed);
  const rawRows = Array.isArray(root?.observations) ? root.observations : [];
  const allowed = new Set(photos);
  const collected = new Map<string, { state: State; reasons: string[] }>();

  for (const row of rawRows) {
    const record = asRecord(row);
    if (!record) continue;
    const photoId = typeof record.photoId === "string" ? record.photoId : "";
    if (!allowed.has(photoId)) continue;
    if (!isCategory(record.category) || !isState(record.state)) continue;

    const key = `${photoId}:${record.category}`;
    const reasons = (Array.isArray(record.evidence) ? record.evidence : [])
      .map((value) => clean(value, secrets))
      .filter(Boolean);
    const unique = [...new Set(reasons)].slice(0, MAX_REASONS);

    // 同一 photoId+category 出现多次时以先到的非 unknown 结论为准。
    const previous = collected.get(key);
    if (previous && previous.state !== "unknown" && record.state === "unknown") continue;
    collected.set(key, { state: record.state, reasons: unique });
  }

  const observations: PhotoObservation[] = [];
  for (const photoId of photos) {
    for (const category of OBSERVATION_CATEGORIES) {
      const hit = collected.get(`${photoId}:${category}`);
      let state: State = hit?.state ?? "unknown";
      let reasons = hit?.reasons ?? [];
      // 没给理由的非 unknown 结论不可采信；整个类别降级，避免"下了结论却说不清依据"。
      if (state !== "unknown" && reasons.length === 0) {
        state = "unknown";
        reasons = [];
      }
      if (state === "unknown" && reasons.length === 0) reasons = [FALLBACK_REASON];
      observations.push({ photoId, category, state, evidence: [...new Set(reasons)].sort() });
    }
  }

  return { schema_version: 1, observations };
}

/** 模型完全不可用时，返回一份"全部无法判断"的合法结果。 */
export function fallbackObservations(
  photos: readonly string[],
  reason: string = FALLBACK_REASON,
): PhotoObservationResult {
  const observations: PhotoObservation[] = [];
  for (const photoId of photos) {
    for (const category of OBSERVATION_CATEGORIES) {
      observations.push({ photoId, category, state: "unknown", evidence: [reason] });
    }
  }
  return { schema_version: 1, observations };
}
