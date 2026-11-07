import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHistoricalRag } from "./retrieve.ts";
import { parseHistoricalLibrary } from "./parser.ts";
import { validateEvidence } from "../core/report-validation.ts";

const markdown = readFileSync(new URL("../../RAG/小区历史问题.md", import.meta.url), "utf8");
const rag = createHistoricalRag(markdown);

async function query(city, district, communityName, addressHint) {
  return rag.retrieveEvidence({ city, district, communityName, ...(addressHint ? { addressHint } : {}) });
}

test("parses all 1057 complete records, including four-digit IDs, with no duplicates", () => {
  const records = parseHistoricalLibrary(markdown);
  assert.equal(rag.recordCount, 1057);
  assert.equal(new Set(records.map(row => row.metadata.id)).size, 1057);
  assert.equal(records.at(-1).metadata.id, "SH1073");
  assert.ok(records.every(row => row.text.includes("### 当时处理进展")));
  assert.ok(records.every(row => row.text.includes("### 使用限制")));
  assert.ok(records.every(row => row.metadata.current_status_verified === false));
});

test("retrieves a four-digit record with the original source and scope", async () => {
  const result = await query("上海", "浦东新区", "文化馨苑");
  assert.equal(result.status, "matched");
  const item = result.items.find(row => row.id === "SH1073");
  assert.ok(item);
  assert.match(item.url, /www\.pudong\.gov\.cn/);
  assert.match(item.summary, /拟改造范围/);
  assert.deepEqual(validateEvidence(result), result);
});

test("exact location resolves published SH044 source and keeps current status unverified", async () => {
  const result = await query("上海", "普陀区", "金纺苑");
  assert.equal(result.status, "matched");
  assert.ok(result.items.some(row => row.id === "SH044" && row.matchStatus === "confirmed"));
  assert.ok(result.items.every(row => row.sourceType === "public" && row.url.startsWith("https://")));
  assert.ok(result.items.every(row => row.summary.includes("当前现场状态未独立核验")));
  assert.deepEqual(validateEvidence(result), result);
});

test("wrong district never matches another district's named site", async () => {
  const result = await query("上海", "徐汇区", "金纺苑");
  assert.equal(result.status, "no_match");
  assert.deepEqual(result.items, []);
});

test("a district is required before any record is confirmed", async () => {
  const result = await rag.retrieveEvidence({ city: "上海", communityName: "金纺苑" });
  assert.equal(result.status, "ambiguous");
  assert.ok(result.items.every(row => row.matchStatus === "possible"));
});

test("a city is required before any record is confirmed", async () => {
  const result = await rag.retrieveEvidence({ district: "普陀区", communityName: "金纺苑" });
  assert.equal(result.status, "ambiguous");
});

test("wrong city does not leak Shanghai record into the result", async () => {
  const result = await query("杭州", "普陀区", "金纺苑");
  assert.equal(result.status, "no_match");
});

test("unknown community means lack of recorded source, not safety", async () => {
  const result = await query("上海", "普陀区", "不存在的楼盘");
  assert.equal(result.status, "no_match");
  assert.deepEqual(result.items, []);
});

test("ambiguous substring cannot be promoted into identity", async () => {
  const result = await query("上海", "普陀区", "中远两湾");
  assert.equal(result.status, "ambiguous");
  assert.ok(result.items.every(row => row.matchStatus === "possible"));
});

test("joint-project members cannot inherit all of the joint project's issues", async () => {
  const result = await query("上海", "浦东新区", "浦海小区");
  assert.equal(result.status, "ambiguous");
  assert.ok(result.items.every(row => row.matchStatus === "possible"));
});

test("keeps handling details, not just alleged issue", async () => {
  const results = rag.getConfirmedRecords({ city: "上海市", district: "长宁区", communityName: "虹城公寓" });
  assert.ok(results.some(row => row.metadata.id === "SH049"));
  assert.ok(results[0].text.includes("### 当时处理进展"));
  assert.ok(results[0].text.includes("### 原文短引文"));
});

test("source caveats survive retrieval, including misleading structural allegation", async () => {
  const result = await query("上海", "虹口区", "海泰苑");
  assert.equal(result.status, "matched");
  assert.ok(result.items.some(row => row.id === "SH068"));
  const text = rag.getConfirmedRecords({ city: "上海", district: "虹口区", communityName: "海泰苑" })[0].text;
  assert.ok(text.includes("承重"));
  assert.ok(text.includes("### 使用限制"));
});

test("multiple lookup calls keep unique IDs and original user query", async () => {
  const result = await rag.retrieveEvidence({ city: "上海", district: "普陀区", communityName: "中远两湾城" });
  assert.equal(result.status, "matched");
  assert.equal(result.items.length, new Set(result.items.map(item => item.id)).size);
  assert.equal(result.query.city, "上海");
  assert.ok(result.items.some(item => item.id === "SH043"));
});

test("month-only dates are not fabricated into a complete ISO day", async () => {
  const result = await query("上海", "浦东新区", "浦海、海二小区联合项目");
  assert.equal(result.status, "matched");
  assert.ok(result.items.some(item => item.id === "SH018" && item.date === null));
  assert.deepEqual(validateEvidence(result), result);
});
