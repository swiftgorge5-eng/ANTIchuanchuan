/**
 * 回归测试：RAG 库无论以 LF 还是 CRLF 检出，都必须解析出同样数量的记录。
 *
 * Windows 的 core.autocrlf=true 会把 Markdown 检出成 CRLF；早期的 section()
 * 只按 "\n" 查找标题，导致 retrieve.test.mjs 在 Windows 上整组失败。
 * 资料库会持续增补（v8 已到 983 条），所以这里不写死条数，而是与标题数量对齐。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHistoricalLibrary } from "./parser.ts";

const source = readFileSync(new URL("../../RAG/小区历史问题.md", import.meta.url), "utf8");
const lf = source.replace(/\r\n?/g, "\n");
/** 每条记录都以 `## SHxxx｜` 开头，标题数就是期望条数。 */
const headingCount = (lf.match(/^## SH\d{3,}｜/gm) ?? []).length;

test("资料库至少有记录，且标题数与解析结果一致", () => {
  assert.ok(headingCount > 0, "资料库里没有找到任何记录标题");
  const records = parseHistoricalLibrary(lf);
  assert.equal(records.length, headingCount);
});

test("CRLF 检出的历史库得到完全相同的记录", () => {
  const crlf = lf.replace(/\n/g, "\r\n");
  const fromLf = parseHistoricalLibrary(lf);
  const fromCrlf = parseHistoricalLibrary(crlf);
  assert.equal(fromCrlf.length, fromLf.length);
  assert.deepEqual(fromCrlf.map((record) => record.metadata.id), fromLf.map((record) => record.metadata.id));
  for (const record of fromCrlf) {
    assert.ok(record.overview.length > 0, `${record.metadata.id} 缺少历史问题概括`);
    assert.ok(record.affectedScope.length > 0, `${record.metadata.id} 缺少涉及范围`);
    assert.ok(record.handling.length > 0, `${record.metadata.id} 缺少当时处理进展`);
    assert.ok(record.limitations.length > 0, `${record.metadata.id} 缺少使用限制`);
  }
});

test("混合行尾不会破坏切分", () => {
  const mixed = lf.split("\n").map((line, index) => (index % 2 ? line + "\r" : line)).join("\n");
  assert.equal(parseHistoricalLibrary(mixed).length, headingCount);
});
