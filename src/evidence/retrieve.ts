import { parseHistoricalLibrary } from "./parser.ts";
import type { HistoricalRecord } from "./parser.ts";
import type { EvidenceItem, EvidenceResult, LocationQuery } from "../core/types.internal.ts";

/** Exact entity identity always precedes any lexical relevance ranking. */
type IdentityMatch = "exact" | "related" | "partial" | "none";
interface Candidate { record: HistoricalRecord; identity: IdentityMatch }

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s\u3000]+/gu, "").trim();
function city(value: string): string {
  const normal = normalize(value);
  return normal === "上海" ? "上海市" : normal;
}
function district(value: string): string {
  const normal = normalize(value);
  if (normal === "浦东") return "浦东新区";
  return normal && !/(区|县|市)$/.test(normal) ? normal + "区" : normal;
}
function identityFor(record: HistoricalRecord, name: string): IdentityMatch {
  const meta = record.metadata;
  const canonical = [meta.entity_name, ...meta.entity_aliases].map(normalize);
  // Omitting a terminal "小区" is a limited name variant, not fuzzy identity.
  const sameNamedSite = (item: string) => item === name ||
    (item.endsWith("小区") && item.slice(0, -2) === name && name.length >= 3);
  if (canonical.some(sameNamedSite)) return "exact";
  if (meta.entity_members.map(normalize).some(sameNamedSite)) return "related";
  // Substring matches are candidates ONLY; never silently turn them into identity.
  if (name.length >= 3 && canonical.some(item => item.includes(name) || name.includes(item))) return "partial";
  return "none";
}
function addressConsistent(record: HistoricalRecord, hint?: string): boolean {
  if (!hint || !record.metadata.address) return true;
  const asked = normalize(hint);
  const known = normalize(record.metadata.address);
  return asked.length >= 3 && (known.includes(asked) || asked.includes(known));
}

function safeExcerpt(text: string, max = 200): string {
  // Core's evidence validator disallows HTML/control characters and embedded secrets.
  return text.replace(/<[^>]*>/g, " ").replace(/[<>\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
function fullDate(record: HistoricalRecord): string | null {
  // A month such as "2022-10" must not be fabricated into a precise day.
  for (const value of [record.metadata.published_at, record.metadata.issued_at, record.metadata.record_date]) {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}
function evidenceItem(candidate: Candidate, certainty: "confirmed" | "possible", query: LocationQuery): EvidenceItem {
  const record = candidate.record;
  const meta = record.metadata;
  const summary = [
    "历史资料，非当前隐患证明。资料编号：" + meta.id + "。",
    "涉及范围：" + safeExcerpt(record.affectedScope, 150) + "。",
    "历史问题：" + safeExcerpt(record.overview, 190) + "。",
    "原文当时处理进展：" + safeExcerpt(record.handling, 220) + "。",
    "使用限制：" + safeExcerpt(record.limitations, 180) + "。",
    candidate.identity === "related" ? "仅关联联合项目成员，不代表该小区单独存在全部问题。" : "",
    "当前现场状态未独立核验，不得推断特定楼栋或房间。"
  ].filter(Boolean).join(" ").slice(0, 980);
  return {
    id: meta.id, communityName: certainty === "confirmed" ? (query.communityName || meta.entity_name) : meta.entity_name, sourceType: "public",
    title: "历史公开记录 " + meta.id + "｜" + meta.entity_name,
    publisher: safeExcerpt(meta.source_name, 120),
    url: meta.source_url,
    date: fullDate(record),
    summary, matchStatus: certainty,
  };
}

export interface HistoricalRag {
  /** Full original records for downstream LLM context, not for prompt instructions. */
  getConfirmedRecords(query: LocationQuery): HistoricalRecord[];
  /** B's frozen public interface, compatible with D's report validator. */
  retrieveEvidence(query: LocationQuery): Promise<EvidenceResult>;
  recordCount: number;
}

/** No network, embeddings, server, or hidden API key. Index is built once. */
export function createHistoricalRag(markdown: string): HistoricalRag {
  const records = parseHistoricalLibrary(markdown);
  const candidatesFor = (query: LocationQuery): Candidate[] => {
    const name = normalize(query.communityName || "");
    if (!name) return [];
    return records.filter(record =>
      (!query.city || city(query.city) === city(record.metadata.city)) &&
      (!query.district || district(query.district) === district(record.metadata.district))
    ).map(record => ({ record, identity: identityFor(record, name) }))
      .filter(candidate => candidate.identity !== "none");
  };
  const confirmedFor = (query: LocationQuery, candidates: Candidate[]): Candidate[] => {
    if (!query.city || !query.district || !query.communityName) return [];
    const exact = candidates.filter(candidate =>
      candidate.identity === "exact" && addressConsistent(candidate.record, query.addressHint));
    // Several historical events for the SAME entity are fine; several entities aren't.
    const unique = new Set(exact.map(row =>
      [city(row.record.metadata.city), district(row.record.metadata.district),
        normalize(row.record.metadata.entity_name)].join("|")));
    return unique.size === 1 ? exact : [];
  };
  const lookup = (query: LocationQuery) => {
    const candidates = candidatesFor(query);
    const confirmed = confirmedFor(query, candidates);
    const chosen = confirmed.length ? confirmed : candidates;
    const status: EvidenceResult["status"] = !candidates.length ? "no_match"
      : confirmed.length && confirmed.length === candidates.length ? "matched" : "ambiguous";
    const ordered = [...chosen].sort((a, b) => a.record.metadata.id.localeCompare(b.record.metadata.id, undefined, { numeric: true }));
    const seen = new Set<string>();
    const unique = ordered.filter(row => {
      if (seen.has(row.record.metadata.id)) return false;
      seen.add(row.record.metadata.id);
      return true;
    }).slice(0, 20);
    return { status, unique, confirmed };
  };
  return {
    recordCount: records.length,
    getConfirmedRecords(query) {
      const result = lookup(query);
      return result.status === "matched" ? result.confirmed.map(row => row.record) : [];
    },
    async retrieveEvidence(query) {
      const result = lookup(query);
      const items = result.unique.map(row => evidenceItem(row,
        result.status === "matched" ? "confirmed" : "possible", query));
      return { status: result.status, query: { ...query }, items };
    },
  };
}
