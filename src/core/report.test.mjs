import test from "node:test";
import assert from "node:assert/strict";
import { composeReport } from "./report.ts";
import { REPORT_RULES, REPORT_CATEGORIES } from "./report-rules.ts";
import { toSafeError } from "./errors.ts";

// Synthetic test statements, never fetched or represented as verified public facts.
function photos(states = ["present", "absent", "absent", "absent"]) {
  return { schema_version: 1, observations: REPORT_CATEGORIES.map((category, index) => ({
    photoId: "synthetic-p1", category, state: states[index], evidence: [`测试可见理由 ${index + 1}`],
  })) };
}
function sources() {
  return { status: "matched", query: { city: "测试城市", communityName: "合成测试小区" }, items: [{
    id: "test-e1", communityName: "合成测试小区", sourceType: "public", title: "测试来源声明",
    publisher: "合成测试发布者", url: "https://records.example.test/notice/1", date: "2026-11-01",
    summary: "仅用于验证类型和原型门槛，不是真实住房资料", matchStatus: "confirmed",
  }] };
}
function insufficient(report) {
  assert.equal(report.status, "success");
  assert.deepEqual([report.risk.score, report.risk.level, report.risk.calibrated], [null, "insufficient", false]);
}
function invalid(photo = photos(), evidence = sources(), rentalMode) {
  assert.throws(() => composeReport(photo, evidence, rentalMode), error => {
    assert.deepEqual(toSafeError(error), { code: "INVALID_REPORT_INPUT", message: "报告输入不符合接口或安全要求" });
    return true;
  });
}
function freezeDeep(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") freezeDeep(child);
  return value;
}

test("exact FinalReport shape and explicit upstream-only source statement", () => {
  const result = composeReport(photos(), sources());
  assert.deepEqual(Object.keys(result).sort(), ["evidence", "limitations", "observations", "rentalMode", "risk", "status"]);
  assert.deepEqual(Object.keys(result.risk).sort(), ["calibrated", "explanation", "level", "score"]);
  assert.equal(result.rentalMode, "unknown");
  assert.equal(result.risk.score, 0.35); assert.equal(result.risk.level, "medium");
  assert.equal(result.risk.calibrated, false);
  assert.match(result.risk.explanation, /D 未独立核验网页/);
  for (const text of ["甲醛", "结构安全", "产权", "合同", "未找到", "校准"]) {
    assert.ok(result.limitations.some(line => line.includes(text)));
  }
});

for (const [index, score] of [0.35, 0.40, 0.25, 0].entries()) {
  test(`category ${REPORT_CATEGORIES[index]} contributes once with documented weight`, () => {
    const states = ["absent", "absent", "absent", "absent"]; states[index] = "present";
    assert.equal(composeReport(photos(states), sources()).risk.score, score);
  });
}

test("no observations, all unknown, partial unknown and missing category are insufficient", () => {
  insufficient(composeReport({ schema_version: 1, observations: [] }, sources()));
  insufficient(composeReport(photos(Array(4).fill("unknown")), sources()));
  insufficient(composeReport(photos(["present", "absent", "unknown", "absent"]), sources()));
  const partial = photos(); partial.observations.pop();
  insufficient(composeReport(partial, sources()));
  const noReason = photos(); noReason.observations[0].evidence = [];
  insufficient(composeReport(noReason, sources()));
});

test("no public evidence is not low risk", () => {
  const evidence = sources(); evidence.status = "no_match"; evidence.items = [];
  insufficient(composeReport(photos(Array(4).fill("absent")), evidence));
});

test("ambiguous community and possible-only records are insufficient", () => {
  const ambiguous = sources(); ambiguous.status = "ambiguous";
  insufficient(composeReport(photos(), ambiguous));
  const possible = sources(); possible.items[0].matchStatus = "possible";
  insufficient(composeReport(photos(), possible));
});

test("synthetic records explicitly marked and cannot qualify as public sources", () => {
  const evidence = sources(); evidence.items[0].sourceType = "synthetic"; evidence.items[0].url = null;
  const result = composeReport(photos(), evidence);
  insufficient(result);
  assert.equal(result.evidence.items[0].sourceType, "synthetic");
  assert.ok(result.limitations.some(text => text.includes("合成演示数据")));
});

for (const field of ["title", "publisher", "summary", "communityName", "date"]) {
  test(`incomplete ${field} prevents numeric scoring`, () => {
    const evidence = sources(); evidence.items[0][field] = field === "date" ? null : "";
    insufficient(composeReport(photos(), evidence));
  });
}

test("query missing city/community or contradictory confirmed names prevents scoring", () => {
  for (const key of ["city", "communityName"]) {
    const evidence = sources(); delete evidence.query[key];
    insufficient(composeReport(photos(), evidence));
  }
  const evidence = sources(); evidence.items[0].communityName = "另一合成小区";
  insufficient(composeReport(photos(), evidence));
});

for (const url of [null, "", "http://example.test/a", "javascript:alert(1)", "data:text/plain;base64,QUFB",
  "https://user:pass@example.test/a", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a",
  "https://example.test/a?apiKey=secret", "https://example.test/a#secret"]) {
  test(`public URL invalid case ${String(url).split(":")[0]}`, () => {
    const evidence = sources(); evidence.items[0].url = url;
    invalid(photos(), evidence);
  });
}

test("syntactically valid HTTPS query URL accepted without accessing it", () => {
  const evidence = sources(); evidence.items[0].url = "https://records.example.test/notice?id=12";
  assert.equal(composeReport(photos(), evidence).risk.score, 0.35);
});

test("score boundaries and thresholds across all four category combinations", () => {
  for (let mask = 0; mask < 16; mask++) {
    const states = REPORT_CATEGORIES.map((_, index) => mask & (1 << index) ? "present" : "absent");
    const result = composeReport(photos(states), sources());
    const expected = REPORT_CATEGORIES.reduce((sum, category, index) => sum + (states[index] === "present" ? REPORT_RULES.weights[category] : 0), 0) / 100;
    assert.equal(result.risk.score, expected);
    assert.ok(result.risk.score >= 0 && result.risk.score <= 1);
    assert.equal(result.risk.calibrated, false);
    assert.equal(result.risk.level, expected >= 0.65 ? "high" : expected >= 0.35 ? "medium" : "low");
  }
  assert.equal(composeReport(photos(Array(4).fill("present")), sources()).risk.score, 1);
  assert.equal(composeReport(photos(Array(4).fill("absent")), sources()).risk.score, 0);
});

test("repeated photo/category observations, reasons and extra photo IDs do not add weight", () => {
  const input = photos(), baseline = composeReport(input, sources());
  input.observations.push(...structuredClone(input.observations));
  input.observations[0].evidence.push(input.observations[0].evidence[0]);
  assert.deepEqual(composeReport(input, sources()), baseline);
  input.observations.push({ ...input.observations[0], photoId: "synthetic-p2" });
  assert.equal(composeReport(input, sources()).risk.score, baseline.risk.score);
});

test("contradictory duplicate observation or evidence IDs are rejected", () => {
  const input = photos(); input.observations.push({ ...input.observations[0], state: "absent" }); invalid(input);
  const evidence = sources(); evidence.items.push({ ...evidence.items[0], title: "冲突标题" }); invalid(photos(), evidence);
});

test("duplicate public records never increase the score", () => {
  const evidence = sources(), baseline = composeReport(photos(), evidence);
  evidence.items.push(structuredClone(evidence.items[0]));
  assert.deepEqual(composeReport(photos(), evidence), baseline);
  evidence.items.push({ ...evidence.items[0], id: "test-e2" });
  assert.equal(composeReport(photos(), evidence).risk.score, baseline.risk.score);
});

test("function does not mutate input or share output object references", () => {
  const input = freezeDeep(photos()), evidence = freezeDeep(sources());
  const before = JSON.stringify([input, evidence]);
  const result = composeReport(input, evidence, "shared");
  assert.equal(JSON.stringify([input, evidence]), before);
  result.observations[0].evidence.push("新的展示文本"); result.evidence.items[0].title = "修改输出";
  assert.equal(JSON.stringify([input, evidence]), before);
  assert.equal(result.rentalMode, "shared");
});

test("same data and different input ordering produce deterministic output", () => {
  const input = photos(), evidence = sources();
  assert.deepEqual(composeReport(input, evidence), composeReport(input, evidence));
  input.observations.reverse();
  assert.deepEqual(composeReport(input, evidence), composeReport(photos(), sources()));
});

const invalidMutations = [
  p => p.schema_version = 2,
  p => p.schema_version = NaN,
  p => p.observations[0].category = "illegal_partition",
  p => p.observations[0].state = "safe",
  p => p.observations[0].photoId = "",
  p => p.observations[0].photoId = 7,
  p => p.observations[0].evidence = "bad",
  p => p.observations[0].evidence = [Infinity],
  p => p.observations[0].evidence = [""],
  p => p.observations = new Array(4),
  p => p.observations[0].apiKey = "test-secret",
  p => p.observations[0].evidence = ["甲醛超标"],
];
for (const [index, mutation] of invalidMutations.entries()) {
  test(`reject invalid observation shape ${index}`, () => { const input = photos(); mutation(input); invalid(input); });
}

test("reject unknown root fields, wrong B enums, bad dates and unexpected rental mode", () => {
  invalid({ ...photos(), apiKey: "test-secret" });
  for (const [key, value] of [["status", "verified"], ["query", null], ["items", null]]) {
    invalid(photos(), { ...sources(), [key]: value });
  }
  for (const [key, value] of [["sourceType", "trusted"], ["matchStatus", "verified"], ["date", "2026-02-30"], ["summary", NaN]]) {
    const evidence = sources(); evidence.items[0][key] = value; invalid(photos(), evidence);
  }
  invalid(photos(), sources(), "custom-mode");
});

test("accessor inputs rejected without invoking their secret-bearing getters", () => {
  let read = 0;
  const input = photos(); Object.defineProperty(input, "schema_version", { enumerable: true, get() { read++; throw new Error("secret"); } });
  invalid(input); assert.equal(read, 0);
});

test("reject key-like strings, Base64 blobs and local paths in allowed text fields", () => {
  for (const value of ["apiKey=do-not-expose", "data:image/png;base64,QUFB", "C:\\Users\\private\\photo.png",
    "file:///private/photo.png", "/home/user/photo.png", "A".repeat(100), "sk-proj-" + "a".repeat(30)]) {
    const evidence = sources(); evidence.items[0].summary = value;
    invalid(photos(), evidence);
  }
  const result = JSON.stringify(composeReport(photos(), sources()));
  for (const forbidden of ["apiKey", "base64", "stored_filename", "C:\\", "file://"]) assert.equal(result.includes(forbidden), false);
});

test("composition has no fetch, logging, persistence or Date.now side effects", t => {
  const saved = [];
  const fail = () => { throw new Error("Unexpected side effect"); };
  for (const key of ["fetch", "localStorage", "sessionStorage", "indexedDB"]) {
    saved.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    Object.defineProperty(globalThis, key, { configurable: true, get: fail });
  }
  t.after(() => { for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  t.mock.method(console, "log", fail); t.mock.method(console, "error", fail); t.mock.method(Date, "now", fail);
  assert.equal(composeReport(photos(), sources()).status, "success");
});

test("mixed public and synthetic remains disclosed and does not change numeric contributions", () => {
  const evidence = sources();
  evidence.items.push({ ...evidence.items[0], id: "synthetic-e2", sourceType: "synthetic", url: null });
  const report = composeReport(photos(), evidence);
  assert.equal(report.risk.score, 0.35);
  assert.ok(report.limitations.some(line => line.includes("合成演示数据")));
});

test("runtime limits, nested extras, inherited and non-finite data fail safely", () => {
  const input = photos(); input.observations = Array.from({ length: 201 }, () => input.observations[0]); invalid(input);
  const extra = sources(); extra.query.apiKey = "test-only-secret"; invalid(photos(), extra);
  const nested = sources(); nested.items[0].rawPhoto = "QUFB"; invalid(photos(), nested);
  const inherited = photos(); Object.setPrototypeOf(inherited, { unexpected: true }); invalid(inherited);
  const version = photos(); version.schema_version = Infinity; invalid(version);
  const text = sources(); text.items[0].summary = "测".repeat(1001); invalid(photos(), text);
  invalid(null, sources()); invalid(photos(), null);
});

test("every incomplete branch remains uncalibrated and never auto-low", () => {
  const candidates = [];
  for (const status of ["ambiguous", "no_match"]) {
    const evidence = sources(); evidence.status = status;
    if (status === "no_match") evidence.items = [];
    candidates.push(composeReport(photos(Array(4).fill("absent")), evidence));
  }
  candidates.push(composeReport(photos(Array(4).fill("unknown")), sources()));
  for (const result of candidates) insufficient(result);
});
