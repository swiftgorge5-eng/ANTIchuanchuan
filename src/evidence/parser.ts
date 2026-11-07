/**
 * Parses the human-maintained RAG/小区历史问题.md library without breaking an
 * event into fragments. The Markdown file is authoritative; this is an index.
 */
export interface HistoricalMetadata {
  id: string;
  city: string;
  district: string;
  entity_name: string;
  entity_aliases: string[];
  entity_members: string[];
  address: string | null;
  building: string | null;
  scope: string;
  published_at: string | null;
  issued_at: string | null;
  record_date: string | null;
  historical_handling_status: string;
  current_status_verified: boolean;
  source_name: string;
  source_type: string;
  source_url: string;
  tags: string[];
}

export interface HistoricalRecord {
  metadata: HistoricalMetadata;
  /** Entire original record, including handling, limitations and citations. */
  text: string;
  overview: string;
  affectedScope: string;
  handling: string;
  limitations: string;
}

function section(block: string, heading: string): string {
  const prefix = "### " + heading;
  const index = block.indexOf(prefix + "\n");
  if (index < 0) throw new Error("RAG record is missing a required section");
  const start = index + prefix.length + 1;
  const next = block.indexOf("\n### ", start);
  return block.slice(start, next < 0 ? undefined : next).trim();
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(requiredString);
}

export function parseHistoricalLibrary(markdown: string): HistoricalRecord[] {
  if (typeof markdown !== "string") throw new Error("RAG source must be Markdown text");
  const records: HistoricalRecord[] = [];
  const ids = new Set<string>();
  for (const block of markdown.replace(/\r\n/g, "\n").split(/(?=^## SH\d{3,}｜)/m)) {
    const match = /^## (SH\d{3,})｜/m.exec(block);
    if (!match || match.index !== 0) continue;
    const json = /^\x60{3}json[ \t]*\r?\n([\s\S]*?)\r?\n\x60{3}/m.exec(block);
    if (!json) throw new Error("RAG record has no JSON metadata");
    const value: unknown = JSON.parse(json[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid RAG metadata");
    const metadata = value as HistoricalMetadata;
    if (metadata.id !== match[1]
        || ids.has(metadata.id) || !requiredString(metadata.city)
        || !requiredString(metadata.district) || !requiredString(metadata.entity_name)
        || !requiredString(metadata.scope) || !requiredString(metadata.source_name)
        || !requiredString(metadata.source_url) || !/^https:\/\//.test(metadata.source_url)
        || !stringArray(metadata.entity_aliases) || !stringArray(metadata.entity_members)
        || !stringArray(metadata.tags) || metadata.current_status_verified !== false) {
      throw new Error("Invalid or duplicate RAG record metadata");
    }
    ids.add(metadata.id);
    records.push({
      metadata,
      text: block.trim(),
      overview: section(block, "历史问题概括（整理者归纳）"),
      affectedScope: section(block, "涉及范围"),
      handling: section(block, "当时处理进展"),
      limitations: section(block, "使用限制"),
    });
  }
  if (!records.length) throw new Error("RAG source has no records");
  return records;
}
