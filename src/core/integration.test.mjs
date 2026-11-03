import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runAnalysis, serializeReport, toSafeError } from "./index.ts";
import { createAnalysisRunner } from "./orchestrator.ts";
import { createMockPorts } from "./adapters/mock.ts";
import { fixtures } from "./test-fixtures.mjs";
import { installBrowser, expectReleased, replaceGlobal } from "./test-browser.mjs";

const input = () => ({ photos: [new File([Buffer.from(fixtures["image/png"], "base64")], "synthetic.png", { type: "image/png" })],
  apiKey: "test-only-never-forwarded-key", provider: "gemini", mode: "mock", location: { city: "测试城市", communityName: "合成小区" } });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Clock {
  time = 0; next = 0; pending = new Map();
  now = () => this.time;
  setTimeout = (callback, ms) => { const id = ++this.next; this.pending.set(id, { callback, at: this.time + ms }); return id; };
  clearTimeout = id => this.pending.delete(id);
  advance(ms) { this.time += ms; for (const [id, timer] of [...this.pending]) if (timer.at <= this.time) { this.pending.delete(id); timer.callback(); } }
}

for (const scenario of ["standard", "unknown", "synthetic", "no_sources", "ambiguous"]) {
  test(`D1 -> C/B Mock -> D2 -> D4 round-trip: ${scenario}`, async t => {
    const { events } = installBrowser(t);
    const mock = createMockPorts({ scenario }); let preparedCopy;
    const runner = createAnalysisRunner({ mock: { ...mock, observePhotos: async value => {
      assert.equal(value.apiKey, ""); preparedCopy = structuredClone(value.photos);
      return mock.observePhotos(value);
    } } });
    const stages = [], source = input();
    const report = await runner(source, stage => stages.push(stage), new AbortController().signal);
    const json = serializeReport(report), parsed = JSON.parse(json);
    assert.deepEqual(parsed, report);
    assert.equal(parsed.status, "success"); assert.equal(parsed.risk.score, null);
    assert.equal(parsed.risk.level, "insufficient"); assert.equal(parsed.risk.calibrated, false);
    assert.deepEqual(stages, ["preparing", "observing", "retrieving", "composing", "success"]);
    assert.equal(preparedCopy.length, 1);
    assert.ok(preparedCopy[0].data.length > 0); assert.equal(preparedCopy[0].data.includes("data:"), false);
    assert.ok(report.observations.every(row => row.photoId === preparedCopy[0].id));
    assert.ok(report.evidence.items.every(row => row.sourceType === "synthetic"));
    assert.equal(json.includes(preparedCopy[0].data), false); assert.equal(json.includes(source.apiKey), false);
    if (scenario === "unknown") assert.ok(report.observations.every(row => row.state === "unknown"));
    if (scenario === "no_sources") assert.equal(report.evidence.status, "no_match");
    if (scenario === "ambiguous") assert.equal(report.evidence.status, "ambiguous");
    assert.ok(expectReleased(events));
  });
}

test("production entry Mock chain performs no network/persistence or automatic download", async t => {
  installBrowser(t);
  const fail = () => { throw Error("unauthorized side effect"); };
  for (const key of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) replaceGlobal(t, key, fail);
  for (const key of ["localStorage", "sessionStorage", "indexedDB", "document"]) replaceGlobal(t, key, new Proxy({}, { get: fail, set: fail }));
  t.mock.method(URL, "createObjectURL", fail);
  const source = input(); source.apiKey = "";
  const result = await runAnalysis(source, () => {}, new AbortController().signal);
  assert.equal(JSON.parse(serializeReport(result)).status, "success");
});

test("invalid C schema is blocked and cannot produce an exportable partial report", async t => {
  const { events } = installBrowser(t); let bCalls = 0;
  const runner = createAnalysisRunner({ mock: { observePhotos: async () => ({ schema_version: 99, observations: [] }),
    retrieveEvidence: async () => { bCalls++; throw Error(); } } });
  const stages = [];
  await assert.rejects(runner(input(), stage => stages.push(stage), new AbortController().signal), error => error.code === "INVALID_REPORT_INPUT");
  assert.equal(bCalls, 0); assert.deepEqual(stages, ["preparing", "observing", "error"]);
  assert.throws(() => serializeReport(undefined), error => error.code === "INVALID_REPORT_INPUT");
  assert.ok(expectReleased(events));
});

for (const stage of ["preparing", "observing", "retrieving"]) {
  test(`core chain timeout at ${stage}, no partial JSON or lingering owned timers`, async t => {
    const gate = deferred();
    const { events } = installBrowser(t, stage === "preparing" ? { decode: () => gate.promise } : {});
    const mock = createMockPorts({ waitFor: current => current === stage ? gate.promise : Promise.resolve() });
    const clock = new Clock();
    const runner = createAnalysisRunner({ mock }, { clock, timeouts: { preparingMs: 20, observingMs: 20, retrievingMs: 20, totalMs: 100 } });
    const stages = [];
    const promise = runner(input(), value => stages.push(value), new AbortController().signal);
    const checked = assert.rejects(promise, error => error.code === "TIMEOUT");
    await flush(); assert.equal(stages.at(-1), stage);
    clock.advance(20); await checked;
    assert.equal(stages.at(-1), "error"); assert.equal(stages.includes("success"), false);
    assert.equal(clock.pending.size, 0);
    if (stage === "preparing") {
      const bitmap = { width: 4, height: 2, closed: 0, close() { this.closed++; } };
      gate.resolve(bitmap); await flush(); assert.equal(bitmap.closed, 1);
    } else { gate.reject(new Error("late test rejection")); await flush(); }
    assert.ok(expectReleased(events));
  });
}

test("cancelled task ignores delayed B rejection and does not create JSON output", async t => {
  const { events } = installBrowser(t), gate = deferred(), controller = new AbortController(), clock = new Clock();
  const mock = createMockPorts({ waitFor: stage => stage === "retrieving" ? gate.promise : Promise.resolve() });
  const runner = createAnalysisRunner({ mock }, { clock });
  const stages = [];
  const promise = runner(input(), stage => stages.push(stage), controller.signal);
  const checked = assert.rejects(promise, error => toSafeError(error).code === "CANCELLED");
  await flush(); assert.equal(stages.at(-1), "retrieving"); controller.abort("do-not-expose"); await checked;
  gate.reject(new Error("late-sensitive-rejection")); await flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stages.at(-1), "cancelled"); assert.equal(stages.includes("success"), false);
  assert.equal(clock.pending.size, 0); assert.ok(expectReleased(events));
});

test("default real unavailable, repeated Mock runs retain no report/input state", async t => {
  const { events } = installBrowser(t);
  await assert.rejects(runAnalysis({ ...input(), mode: "real" }, () => {}, new AbortController().signal), error => error.code === "ADAPTER_UNAVAILABLE");
  const first = await runAnalysis(input(), () => {}, new AbortController().signal);
  first.evidence.query.city = "修改第一份输出";
  const second = await runAnalysis(input(), () => {}, new AbortController().signal);
  assert.equal(second.evidence.query.city, "测试城市");
  assert.notEqual(first.observations[0].photoId, second.observations[0].photoId);
  assert.deepEqual(JSON.parse(serializeReport(second)), second);
  assert.ok(expectReleased(events));
});

test("production barrel exports only stable API and never imports test helpers", async () => {
  const api = await import("./index.ts");
  assert.deepEqual(Object.keys(api).sort(), ["createReportBlob", "downloadReport", "runAnalysis", "serializeReport", "toSafeError"]);
  const seen = new Set();
  function walk(path) {
    if (seen.has(path)) return; seen.add(path);
    const text = fs.readFileSync(path, "utf8");
    for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
      assert.equal(/test-|\.mjs$|\.test\./.test(match[1]), false, "test helper in production graph");
      walk(new URL(match[1], path));
    }
  }
  walk(new URL("./index.ts", import.meta.url));
});
