import { CoreError } from "./errors.ts";
import { REPORT_CATEGORIES, REPORT_RULES } from "./report-rules.ts";
import type { EvidenceItem, EvidenceResult, LocationQuery, PhotoObservation, PhotoObservationResult } from "./types.internal.ts";

export function invalidReport(): never { throw new CoreError("INVALID_REPORT_INPUT"); }

function object(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidReport();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidReport();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) invalidReport();
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor) || !keys.includes(key)) invalidReport();
  }
  if (required.some(key => !Object.hasOwn(descriptors, key))) invalidReport();
  return value as Record<string, unknown>;
}

function array(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalidReport();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) invalidReport(); // Reject sparse arrays/extra fields.
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) invalidReport();
  }
  return value;
}

// Reject obvious accidental credential/image/path transport. No raw text in errors.
const UNSAFE = /(?:data:[^,\s]*base64|file:\/\/|\b[a-z]:[\\/]|(?:^|\s)\/(?:Users|home|tmp|private|mnt)\/|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]|\bBearer\s+\S+|\bAIza[\w-]{20,}|\bsk-(?:proj-)?[\w-]{15,}|\b(?:gh[pousr]_|github_pat_)[\w]{15,}|[A-Za-z0-9+/]{80,}={0,2})/i;
export function text(value: unknown, max: number = REPORT_RULES.maxTextLength): string {
  if (typeof value !== "string" || value.length > max || UNSAFE.test(value)
      || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(value)) invalidReport();
  return value.trim();
}
function identifier(value: unknown): string {
  const id = text(value, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) invalidReport();
  return id;
}
function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalidReport();
  return value as T;
}
function httpsURL(value: unknown, required: boolean): string | null {
  if (value === null && !required) return null;
  const original = text(value, 2048);
  try {
    // No relative URLs, credentials, fragments, local endpoints or query-carried secrets.
    const url = new URL(original);
    if (!original.startsWith("https://") || url.protocol !== "https:" || url.username || url.password || url.hash
        || url.hostname === "localhost" || !url.hostname.includes(".") || /[\[\]:]/.test(url.hostname)
        || /^\d+(?:\.\d+){3}$/.test(url.hostname) || /\.(?:local|localhost|internal)$/i.test(url.hostname)) invalidReport();
    const decoded = decodeURIComponent(url.pathname + url.search);
    text(decoded, 2048);
    url.searchParams.forEach((val, key) => {
      if (/(?:key|token|auth|secret|password|credential|signature)/i.test(key)) invalidReport();
      text(val, 500);
    });
    return original;
  } catch { return invalidReport(); }
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(result);
  if (!match || !Number.isFinite(Date.parse(result))) invalidReport();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) invalidReport();
  return result;
}

export function validatePhotos(value: unknown): PhotoObservationResult {
  const root = object(value, ["schema_version", "observations"]);
  if (root.schema_version !== 1) invalidReport();
  const observations: PhotoObservation[] = [];
  for (const entry of array(root.observations, REPORT_RULES.maxObservations)) {
    const row = object(entry, ["photoId", "category", "state", "evidence"]);
    const reasons = array(row.evidence, REPORT_RULES.maxReasons).map(value => text(value));
    if (reasons.some(reason => !reason)) invalidReport();
    // C may state visible facts, not diagnostic/legal conclusions.
    if (reasons.some(reason => /串串房|甲醛|承重墙|产权|合同真实|违法|违规|结构安全/.test(reason))) invalidReport();
    observations.push({ photoId: identifier(row.photoId), category: member(row.category, REPORT_CATEGORIES),
      state: member(row.state, ["present", "absent", "unknown"]), evidence: [...new Set(reasons)].sort() });
  }
  return { schema_version: 1, observations };
}

export function validateEvidence(value: unknown): EvidenceResult {
  const root = object(value, ["status", "query", "items"]);
  const queryValue = object(root.query, ["city", "district", "communityName", "addressHint"], []);
  const query: LocationQuery = {};
  for (const key of ["city", "district", "communityName", "addressHint"] as const) {
    if (Object.hasOwn(queryValue, key)) query[key] = text(queryValue[key], 120);
  }
  const items: EvidenceItem[] = [];
  for (const entry of array(root.items, REPORT_RULES.maxEvidenceItems)) {
    const row = object(entry, ["id", "communityName", "sourceType", "title", "publisher", "url", "date", "summary", "matchStatus"]);
    const sourceType = member(row.sourceType, ["public", "synthetic"]);
    items.push({ id: identifier(row.id), communityName: text(row.communityName, 120), sourceType,
      title: text(row.title), publisher: text(row.publisher), url: httpsURL(row.url, sourceType === "public"),
      date: date(row.date), summary: text(row.summary), matchStatus: member(row.matchStatus, ["confirmed", "possible"]) });
  }
  const status = member(root.status, ["matched", "ambiguous", "no_match"]);
  if (status === "no_match" && items.length) invalidReport();
  return { status, query, items };
}

// Internal shared validators; not exported by the stable core entry.
export { object as validateDataObject, array as validateDataArray };
