import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisRunner, runAnalysis } from "./orchestrator.ts";
import { createMockPorts } from "./adapters/mock.ts";
import { ANALYSIS_POLICY } from "./orchestration-config.ts";
import { preprocessPhotos } from "./preprocess.ts";
import { CoreError, toSafeError } from "./errors.ts";
import { fixtures } from "./test-fixtures.mjs";
import { installBrowser, expectReleased, replaceGlobal } from "./test-browser.mjs";

const STAGES = ["preparing", "observing", "retrieving", "composing", "success"];
const input = (extra = {}) => ({ photos: [new File([Buffer.from(fixtures["image/png"], "base64")], "synthetic.png", { type: "image/png" })],
  apiKey: "", provider: "gemini", mode: "mock", location: { city: "测试城市", communityName: "合成小区" }, ...extra });
const prepared = async files => files.map((_, index) => ({ id: `p${index + 1}`, mimeType: "image/png", data: "QUFB" }));
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Clock {
  time = 0; next = 0; timers = new Map();
  now = () => this.time;
  setTimeout = (callback, ms) => { const id = ++this.next; this.timers.set(id, { callback, at: this.time + ms }); return id; };
  clearTimeout = id => this.timers.delete(id);
  advance(ms) {
    const target = this.time + ms;
    while (true) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.time = due[1].at; this.timers.delete(due[0]); due[1].callback();
    }
    this.time = target;
  }
}
function setup(t, opts = {}) {
  const clock = new Clock(), controller = new AbortController(), stages = [], listeners = new Set();
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  t.mock.method(controller.signal, "addEventListener", (type, callback, options) => { if (type === "abort") listeners.add(callback); return add(type, callback, options); });
  t.mock.method(controller.signal, "removeEventListener", (type, callback, options) => { if (type === "abort") listeners.delete(callback); return remove(type, callback, options); });
  const ports = opts.ports ?? createMockPorts(opts.mock);
  const runner = createAnalysisRunner({ mock: ports, ...(opts.real ? { real: opts.real } : {}) }, {
    preprocess: opts.preprocess ?? prepared, clock, timeouts: { preparingMs: 100, observingMs: 100, retrievingMs: 100, totalMs: 1000, ...opts.timeouts },
  });
  t.after(() => { assert.equal(clock.timers.size, 0, "all runner timers cleared"); assert.equal(listeners.size, 0, "all user abort listeners removed"); });
  const run = (value = input(), callback = stage => stages.push(stage)) => runner(value, callback, controller.signal);
  return { clock, controller, stages, runner, run, ports };
}
async function rejects(promise, code) {
  await assert.rejects(promise, error => { assert.equal(toSafeError(error).code, code); return true; });
}

test("public three-argument entry uses D1, D2 and offline Mock with exact stages", async t => {
  const { events } = installBrowser(t);
  const stages = [];
  const report = await runAnalysis(input(), stage => stages.push(stage), new AbortController().signal);
  assert.deepEqual(stages, STAGES);
  assert.equal(report.status, "success"); assert.equal(report.risk.score, null);
  assert.equal(report.risk.level, "insufficient"); assert.equal(report.risk.calibrated, false);
  assert.equal(report.evidence.items[0].sourceType, "synthetic");
  assert.ok(expectReleased(events));
});

test("mock passes empty Key and real adapter/config is never read", async t => {
  let observed;
  const base = createMockPorts();
  const ports = { ...base, observePhotos: value => { observed = value; return base.observePhotos(value); } };
  const clock = new Clock();
  const runner = createAnalysisRunner({ mock: ports, get real() { throw new Error("must not inspect real configuration"); } }, { clock, preprocess: prepared });
  await runner(input({ apiKey: "should-never-forward" }), () => {}, new AbortController().signal);
  assert.equal(observed.apiKey, ""); assert.ok(observed.signal instanceof AbortSignal);
  assert.equal(clock.timers.size, 0);
});

test("mock does not touch network, browser storage, location or logs", async t => {
  const fail = () => { throw new Error("forbidden side effect"); };
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) replaceGlobal(t, name, fail);
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "location"]) replaceGlobal(t, name, new Proxy({}, { get: fail, set: fail }));
  replaceGlobal(t, "console", { log: fail, warn: fail, error: fail, debug: fail });
  const ctx = setup(t);
  assert.equal((await ctx.run()).status, "success");
});

for (const scenario of ["standard", "unknown", "ambiguous", "no_sources", "synthetic"]) {
  test(`Mock scenario ${scenario} yields a legitimate insufficient SUCCESS`, async t => {
    const ctx = setup(t, { mock: { scenario } });
    const result = await ctx.run();
    assert.equal(result.risk.score, null); assert.equal(result.risk.level, "insufficient");
    assert.deepEqual(ctx.stages, STAGES);
    if (scenario === "unknown") assert.ok(result.observations.every(row => row.state === "unknown"));
    if (scenario === "ambiguous") assert.equal(result.evidence.status, "ambiguous");
    if (scenario === "no_sources") assert.deepEqual(result.evidence.items, []);
    assert.ok(result.evidence.items.every(row => row.sourceType === "synthetic"));
  });
}

test("four-category state combinations are deterministic and preserve prepared photo IDs", async t => {
  const ctx = setup(t, { mock: { states: ["absent", "present", "unknown", "absent"] } });
  const result = await ctx.run();
  assert.deepEqual(result.observations.map(row => row.state), ["absent", "present", "unknown", "absent"]);
  assert.ok(result.observations.every(row => row.photoId === "p1"));
});

for (const [label, value] of [["empty input", null], ["empty photos", input({ photos: [] })], ["bad provider", input({ provider: "custom" })], ["extra key", { ...input(), internalSecret: "private" }]]) {
  test(`invalid ${label} emits only error`, async t => {
    const ctx = setup(t);
    await rejects(ctx.run(value), label === "empty photos" ? "NO_PHOTOS" : "INVALID_ANALYSIS_INPUT");
    assert.deepEqual(ctx.stages, ["error"]);
  });
}

test("preprocess error stops before C and is sanitized", async t => {
  const ctx = setup(t, { preprocess: async () => { throw new CoreError("INVALID_IMAGE"); } });
  await rejects(ctx.run(), "INVALID_IMAGE"); assert.deepEqual(ctx.stages, ["preparing", "error"]);
});

for (const failAt of ["observing", "retrieving"]) {
  test(`${failAt} failure does not retry or emit success`, async t => {
    const ctx = setup(t, { mock: { failAt } });
    await rejects(ctx.run(), "MOCK_FAILURE");
    assert.deepEqual(ctx.stages, failAt === "observing" ? ["preparing", "observing", "error"] : ["preparing", "observing", "retrieving", "error"]);
  });
}

test("C malformed schema and unrelated photo IDs fail BEFORE B starts", async t => {
  for (const output of [{ schema_version: 2, observations: [] }, { schema_version: 1, observations: [
    { photoId: "unrelated", category: "moisture_trace", state: "present", evidence: ["测试迹象"] },
  ] }]) {
    let calls = 0;
    const ports = { observePhotos: async () => output, retrieveEvidence: async () => { calls++; throw new Error(); } };
    const ctx = setup(t, { ports }); await rejects(ctx.run(), "INVALID_REPORT_INPUT");
    assert.equal(calls, 0); assert.deepEqual(ctx.stages, ["preparing", "observing", "error"]);
  }
});

test("B malformed schema and prepared-photo shape errors are blocked", async t => {
  const base = createMockPorts();
  const ctx = setup(t, { ports: { ...base, retrieveEvidence: async () => ({ status: "verified", query: {}, items: [] }) } });
  await rejects(ctx.run(), "INVALID_REPORT_INPUT");
  const prep = setup(t, { preprocess: async () => [{ id: "p1", mimeType: "image/png", data: "data:image/png;base64,QUFB" }] });
  await rejects(prep.run(), "INVALID_PREPARED_PHOTOS"); assert.deepEqual(prep.stages, ["preparing", "error"]);
});

test("real unavailable never falls back to Mock; available real requires key", async t => {
  const ctx = setup(t); await rejects(ctx.run(input({ mode: "real", apiKey: "test-key" })), "ADAPTER_UNAVAILABLE");
  assert.deepEqual(ctx.stages, ["error"]);
  const configured = setup(t, { real: createMockPorts() });
  await rejects(configured.run(input({ mode: "real" })), "KEY_REQUIRED");
});

test("already cancelled abort reason is not propagated", async t => {
  const ctx = setup(t); ctx.controller.abort("private key/path");
  await rejects(ctx.run(), "CANCELLED"); assert.deepEqual(ctx.stages, ["cancelled"]);
});

for (const stage of ["preparing", "observing", "retrieving"]) {
  for (const late of ["success", "failure"]) {
    test(`cancel during ${stage}, ignore late ${late}, clear timers/listeners`, async t => {
      const gate = deferred(), base = createMockPorts();
      let childSignal;
      const ctx = setup(t, {
        preprocess: stage === "preparing" ? (_, opts) => { childSignal = opts.signal; return gate.promise; } : prepared,
        ports: { ...base,
          observePhotos: stage === "observing" ? value => { childSignal = value.signal; return gate.promise; } : base.observePhotos,
          retrieveEvidence: stage === "retrieving" ? () => gate.promise : base.retrieveEvidence },
      });
      const promise = ctx.run(), checked = rejects(promise, "CANCELLED");
      await flush(); assert.equal(ctx.stages.at(-1), stage);
      ctx.controller.abort("secret cancellation reason"); await checked;
      if (childSignal) { assert.equal(childSignal.aborted, true); assert.notEqual(childSignal.reason, "secret cancellation reason"); }
      const before = [...ctx.stages];
      if (late === "success") gate.resolve(stage === "preparing" ? await prepared(input().photos) : stage === "observing"
        ? { schema_version: 1, observations: [] } : { status: "no_match", query: {}, items: [] });
      else gate.reject(new Error("late sensitive rejection"));
      await flush(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(ctx.stages, before); assert.equal(ctx.stages.at(-1), "cancelled");
      assert.equal(ctx.stages.includes("success"), false);
    });
  }
}

test("abort inside composing callback prevents composition success", async t => {
  const ctx = setup(t);
  await rejects(ctx.run(input(), stage => { ctx.stages.push(stage); if (stage === "composing") ctx.controller.abort(); }), "CANCELLED");
  assert.deepEqual(ctx.stages, ["preparing", "observing", "retrieving", "composing", "cancelled"]);
});

for (const stage of ["preparing", "observing", "retrieving"]) {
  test(`${stage} timeout is TIMEOUT/error and signals downstream cleanup`, async t => {
    const gate = deferred(), base = createMockPorts(); let child;
    const ctx = setup(t, {
      preprocess: stage === "preparing" ? (_, options) => { child = options.signal; return gate.promise; } : prepared,
      ports: { ...base, observePhotos: stage === "observing" ? value => { child = value.signal; return gate.promise; } : base.observePhotos,
        retrieveEvidence: stage === "retrieving" ? () => gate.promise : base.retrieveEvidence },
    });
    const promise = ctx.run(), checked = rejects(promise, "TIMEOUT");
    await flush(); ctx.clock.advance(100); await checked;
    assert.equal(ctx.stages.at(-1), "error"); assert.equal(ctx.stages.includes("cancelled"), false);
    if (child) assert.equal(child.aborted, true);
    gate.reject(new Error("late timeout failure")); await flush();
  });
}

test("total timeout spans stages and wins over later cancellation", async t => {
  const gate = deferred();
  const ctx = setup(t, { mock: { waitFor: stage => stage === "observing" ? gate.promise : Promise.resolve() }, timeouts: { totalMs: 30 } });
  const promise = ctx.run(), checked = rejects(promise, "TIMEOUT");
  await flush(); ctx.clock.advance(30); ctx.controller.abort("later cancel"); await checked;
  assert.equal(ctx.stages.at(-1), "error"); gate.resolve(); await flush();
});

test("deadline exceeded during synchronous composing callback cannot succeed", async t => {
  const ctx = setup(t, { timeouts: { totalMs: 50 } });
  await rejects(ctx.run(input(), stage => { ctx.stages.push(stage); if (stage === "composing") ctx.clock.advance(50); }), "TIMEOUT");
  assert.equal(ctx.stages.at(-1), "error");
});

test("callbacks throwing synchronously or rejecting asynchronously do not change analysis", async t => {
  const ctx = setup(t);
  const report = await ctx.run(input(), stage => { ctx.stages.push(stage); throw new Error("secret callback error"); });
  assert.equal(report.status, "success"); assert.deepEqual(ctx.stages, STAGES);
  const second = await ctx.run(input(), async () => { throw new Error("async callback failure"); });
  assert.equal(second.status, "success"); await new Promise(resolve => setImmediate(resolve));
});

test("abort at preparing callback starts no work; abort after success commit is inert", async t => {
  let preparedCalls = 0;
  const ctx = setup(t, { preprocess: async files => { preparedCalls++; return prepared(files); } });
  await rejects(ctx.run(input(), stage => { ctx.stages.push(stage); if (stage === "preparing") ctx.controller.abort(); }), "CANCELLED");
  assert.equal(preparedCalls, 0);
  const second = setup(t);
  assert.equal((await second.run(input(), stage => { second.stages.push(stage); if (stage === "success") second.controller.abort(); })).status, "success");
  assert.deepEqual(second.stages, STAGES);
});

test("repeated/concurrent runs have independent signals, stages and secrets", async t => {
  const base = createMockPorts(), gate = deferred(); let calls = 0;
  const ctx = setup(t, { ports: { ...base, observePhotos: async value => { if (++calls === 1) await gate.promise; return base.observePhotos(value); } } });
  const other = new AbortController(), otherStages = [];
  const first = ctx.run(), cancelled = rejects(first, "CANCELLED");
  await flush();
  const second = ctx.runner(input(), stage => otherStages.push(stage), other.signal);
  ctx.controller.abort(); await cancelled; assert.equal((await second).status, "success");
  assert.deepEqual(otherStages, STAGES);
  gate.resolve(); await flush();
  assert.equal((await ctx.runner(input(), () => {}, new AbortController().signal)).status, "success");
});

test("provider errors and known secret/base64 echoed in valid fields are rejected safely", async t => {
  const secret = "test-only-sensitive-model-key";
  const base = createMockPorts();
  const bad = setup(t, { real: { ...base, observePhotos: async () => { throw new Error(`${secret} data:image/png;base64,QUFB C:\\private`); } } });
  await assert.rejects(bad.run(input({ mode: "real", apiKey: secret })), error => {
    assert.equal(JSON.stringify(error).includes(secret), false); assert.equal(error.code, "UNKNOWN_ERROR"); return true;
  });
  for (const echo of [secret, "QUFB"]) {
    const ctx = setup(t, { ports: { ...base, observePhotos: async () => ({ schema_version: 1, observations: [{
      photoId: "p1", category: "moisture_trace", state: "unknown", evidence: [echo],
    }] }) } });
    await rejects(ctx.run(input({ apiKey: secret })), "INVALID_REPORT_INPUT");
  }
});

test("invalid timeout policy fails without scheduling timers or retries", () => {
  for (const value of [0, -1, Infinity, 300001]) assert.throws(() => createAnalysisRunner({ mock: createMockPorts() }, { timeouts: { totalMs: value } }), error => error.code === "INVALID_OPTIONS");
  assert.equal(ANALYSIS_POLICY.retries, 0);
});

test("B query substitution and C mutating prepared IDs cannot bypass association checks", async t => {
  const base = createMockPorts();
  const c = setup(t, { ports: { ...base, observePhotos: async value => {
    value.photos[0].id = "substituted";
    return base.observePhotos(value);
  } } });
  await rejects(c.run(), "INVALID_REPORT_INPUT");
  const b = setup(t, { ports: { ...base, retrieveEvidence: async query => {
    query.communityName = "其他小区"; return base.retrieveEvidence(query);
  } } });
  await rejects(b.run(), "INVALID_REPORT_INPUT");
});

test("D1 integration: scheduler timeout closes an ImageBitmap that decodes late", async t => {
  const gate = deferred();
  installBrowser(t, { decode: () => gate.promise });
  const ctx = setup(t, { preprocess: preprocessPhotos });
  const promise = ctx.run(), checked = rejects(promise, "TIMEOUT");
  await flush(); ctx.clock.advance(100); await checked;
  const bitmap = { width: 4, height: 2, closed: 0, close() { this.closed++; } };
  gate.resolve(bitmap); await flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(bitmap.closed, 1); assert.deepEqual(ctx.stages, ["preparing", "error"]);
});

test("first user cancellation remains CANCELLED even if timers would expire next", async t => {
  const gate = deferred(); const ctx = setup(t, { preprocess: () => gate.promise });
  const promise = ctx.run(), checked = rejects(promise, "CANCELLED");
  await flush(); ctx.controller.abort(); ctx.clock.advance(1000); await checked;
  assert.deepEqual(ctx.stages, ["preparing", "cancelled"]); gate.reject(new Error("late")); await flush();
});

test("late gated Mock observation may resolve after cancellation without changing terminal stage", async t => {
  const gate = deferred();
  const ctx = setup(t, { mock: { waitFor: stage => stage === "observing" ? gate.promise : Promise.resolve(), ignoreObserverAbort: true } });
  const promise = ctx.run(), checked = rejects(promise, "CANCELLED");
  await flush(); ctx.controller.abort(); await checked;
  gate.resolve(); await flush(); assert.deepEqual(ctx.stages, ["preparing", "observing", "cancelled"]);
});

test("spontaneous adapter CANCELLED is an error, not a fabricated user cancellation", async t => {
  const base = createMockPorts();
  const ctx = setup(t, { ports: { ...base, observePhotos: async () => { throw new CoreError("CANCELLED"); } } });
  await rejects(ctx.run(), "UNKNOWN_ERROR"); assert.equal(ctx.stages.at(-1), "error");
});

test("invalid signal, callback and null location are controlled input failures", async t => {
  const ctx = setup(t);
  await rejects(ctx.runner(input(), () => {}, {}), "INVALID_ANALYSIS_INPUT");
  await rejects(ctx.runner(input(), null, new AbortController().signal), "INVALID_ANALYSIS_INPUT");
  await rejects(ctx.run(input({ location: null })), "INVALID_ANALYSIS_INPUT");
});
