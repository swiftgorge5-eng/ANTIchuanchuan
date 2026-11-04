import test from "node:test";
import assert from "node:assert/strict";
import { composeReport } from "./report.ts";
import { serializeReport, createReportBlob, downloadReport, REPORT_FILENAME } from "./export.ts";
import { toSafeError } from "./errors.ts";
import { replaceGlobal } from "./test-browser.mjs";

const report = () => composeReport({ schema_version: 1, observations: [] }, { status: "no_match", query: { city: "测试城市", addressHint: "用户自填位置线索" }, items: [] });
function rejects(value) {
  assert.throws(() => serializeReport(value), error => {
    assert.deepEqual(toSafeError(error), { code: "INVALID_REPORT_INPUT", message: "报告输入不符合接口或安全要求" }); return true;
  });
}
function browser(t, failure) {
  const events = { created: [], revoked: [], nodes: [], attached: [], clicks: 0, timers: [] };
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { if (failure === "url") throw Error("private URL error"); events.created.push(blob); return "blob:synthetic-export-url"; };
  URL.revokeObjectURL = url => events.revoked.push(url);
  t.after(() => { URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL; });
  replaceGlobal(t, "document", {
    body: { appendChild(node) { if (failure === "append") throw Error("private DOM path"); events.attached.push(node); } },
    createElement(tag) {
      assert.equal(tag, "a"); if (failure === "create") throw Error("private DOM error");
      const anchor = { click() { if (failure === "click") throw Error("private click error"); events.clicks++; },
        remove() { events.attached = events.attached.filter(node => node !== anchor); } };
      events.nodes.push(anchor); return anchor;
    },
  });
  replaceGlobal(t, "setTimeout", (callback, ms) => {
    if (failure === "timer") throw Error("timer failure"); events.timers.push({ callback, ms }); return events.timers.length;
  });
  return events;
}

test("serialize round-trip exactly preserves null, false, UTF-8 text and location privacy fields", async () => {
  const source = report(), before = structuredClone(source);
  const json = serializeReport(source);
  assert.deepEqual(JSON.parse(json), source); assert.deepEqual(source, before);
  const blob = createReportBlob(source);
  assert.equal(blob.type, "application/json;charset=utf-8");
  assert.equal(await blob.text(), json);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new TextEncoder().encode(json));
  assert.ok(json.includes("用户自填位置线索")); // Export is not anonymous.
});

test("synthetic source labels retained and no diagnostic fields added", () => {
  const source = composeReport({ schema_version: 1, observations: [] }, {
    status: "matched", query: {}, items: [{ id: "synthetic-e1", communityName: "合成小区", sourceType: "synthetic", title: "演示",
      publisher: "演示", url: null, date: null, summary: "合成演示记录", matchStatus: "possible" }],
  });
  const parsed = JSON.parse(serializeReport(source));
  assert.equal(parsed.evidence.items[0].sourceType, "synthetic");
  assert.equal(parsed.risk.score, null); assert.equal(parsed.risk.calibrated, false);
  assert.deepEqual(Object.keys(parsed).sort(), ["evidence", "limitations", "observations", "rentalMode", "risk", "status"]);
});

test("numeric D2 reports remain exportable without changing score or limitations", () => {
  const categories = ["renovation_trace", "partition_trace", "moisture_trace", "daylight_cue"];
  const source = composeReport({ schema_version: 1, observations: categories.map(category => ({ photoId: "synthetic-p1", category, state: "present", evidence: ["合成可见迹象"] })) }, {
    status: "matched", query: { city: "测试城市", communityName: "合成小区" }, items: [{ id: "e1", communityName: "合成小区", sourceType: "public", title: "测试声明",
      publisher: "测试", url: "https://records.example.test/1", date: "2026-11-01", summary: "仅用于测试的来源声明", matchStatus: "confirmed" }],
  });
  assert.equal(source.risk.score, 1);
  assert.deepEqual(JSON.parse(serializeReport(source)), source);
});

for (const [name, mutate] of [
  ["extra API key", r => r.apiKey = "test-private-key"],
  ["nested debug", r => r.risk.debug = "private"],
  ["calibrated true", r => r.risk.calibrated = true],
  ["NaN", r => r.risk.score = NaN],
  ["Infinity", r => r.risk.score = Infinity],
  ["out of range", r => r.risk.score = 2],
  ["wrong null level", r => r.risk.level = "low"],
  ["fabricated score", r => { r.risk.score = 0; r.risk.level = "low"; }],
  ["missing limitation", r => r.limitations.pop()],
  ["wrong status", r => r.status = "error"],
  ["raw path", r => r.risk.explanation = "C:\\Users\\private\\report.json"],
  ["Base64 image", r => r.limitations.push("data:image/png;base64,QUFB")],
  ["secret marker", r => r.risk.explanation = "apiKey=private-value"],
]) test(`unsafe or inconsistent report rejected: ${name}`, () => { const source = report(); mutate(source); rejects(source); });

test("does not execute arbitrary toJSON or accessor hooks", () => {
  let called = 0;
  const source = report(); source.toJSON = () => { called++; return { apiKey: "secret" }; };
  rejects(source);
  const accessor = report(); Object.defineProperty(accessor, "risk", { enumerable: true, get() { called++; throw Error("secret"); } });
  rejects(accessor); assert.equal(called, 0);
  rejects(null); rejects(new Error("private internal error"));
});

test("serialization alone touches no DOM, network, storage or Object URL APIs", t => {
  const fail = () => { throw Error("forbidden side effect"); };
  for (const key of ["document", "localStorage", "sessionStorage", "indexedDB", "fetch"]) replaceGlobal(t, key, new Proxy(fail, { get: fail, apply: fail }));
  t.mock.method(URL, "createObjectURL", fail);
  assert.equal(JSON.parse(serializeReport(report())).status, "success");
});

test("explicit download uses fixed basename, removes anchor, revokes URL after bounded delay", t => {
  const events = browser(t);
  const source = report(); source.evidence.query.addressHint = "../../用户输入不是文件名";
  downloadReport(source);
  assert.equal(events.clicks, 1); assert.equal(events.nodes[0].download, REPORT_FILENAME);
  assert.match(REPORT_FILENAME, /^[a-z-]+\.json$/);
  assert.equal(events.nodes[0].href, "blob:synthetic-export-url");
  assert.equal(events.attached.length, 0); assert.equal(events.revoked.length, 0);
  assert.equal(events.timers.length, 1); assert.equal(events.timers[0].ms, 1000);
  events.timers[0].callback(); assert.deepEqual(events.revoked, ["blob:synthetic-export-url"]);
});

for (const failure of ["url", "create", "append", "click"]) test(`download ${failure} failure releases resources immediately with safe error`, t => {
  const events = browser(t, failure);
  assert.throws(() => downloadReport(report()), error => { assert.equal(error.code, "DOWNLOAD_FAILED"); assert.equal(error.message.includes("private"), false); return true; });
  assert.equal(events.attached.length, 0); assert.equal(events.timers.length, 0);
  assert.equal(events.revoked.length, failure === "url" ? 0 : 1);
});

test("timer setup failure revokes immediately; invalid report creates no resources", t => {
  const events = browser(t, "timer"); downloadReport(report());
  assert.equal(events.revoked.length, 1); assert.equal(events.timers.length, 0);
  const source = report(); source.apiKey = "test-secret";
  assert.throws(() => downloadReport(source), error => error.code === "INVALID_REPORT_INPUT");
  assert.equal(events.created.length, 1);
});

test("unsupported browser download environment is controlled", t => {
  replaceGlobal(t, "document", undefined);
  assert.throws(() => downloadReport(report()), error => error.code === "DOWNLOAD_UNAVAILABLE");
});

test("raw photo fields and nested serialization hooks are never projected", () => {
  const photos = report(); photos.photos = [{ data: "QUFB" }]; rejects(photos);
  let calls = 0;
  const nested = report(); nested.limitations.toJSON = () => { calls++; return ["private"]; };
  rejects(nested); assert.equal(calls, 0);
  const markup = report(); markup.risk.explanation = "<img src=x onerror=alert(1)>"; rejects(markup);
});

test("missing Blob and throwing DOM capability getters remain controlled", t => {
  replaceGlobal(t, "Blob", undefined);
  assert.throws(() => createReportBlob(report()), error => error.code === "DOWNLOAD_UNAVAILABLE");
});

test("DOM capability exception never exposes internal browser message", t => {
  replaceGlobal(t, "document", { get body() { throw Error("private browser internals"); } });
  assert.throws(() => downloadReport(report()), error => {
    assert.equal(error.code, "DOWNLOAD_UNAVAILABLE"); assert.equal(error.message.includes("private"), false); return true;
  });
});
