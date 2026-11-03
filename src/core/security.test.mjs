import test from "node:test";
import assert from "node:assert/strict";
import { CoreError, toSafeError } from "./errors.ts";
import { modelKeyForCall } from "./security.ts";
import { selectPorts, createPhotoInput } from "./ports.ts";
import { preprocessPhotos } from "./preprocess.ts";
import { installBrowser, replaceGlobal } from "./test-browser.mjs";
import { fixtures } from "./test-fixtures.mjs";

test("unknown exceptions, paths, Base64, abort reasons and keys are not serialized", () => {
  const secret = "fake-sensitive-key-for-testing";
  for (const value of [new Error(`${secret} C:\\Users\\private data:image/png;base64,AAAA`),
    { message: secret, stack: secret, cause: secret }, secret, null, new Proxy({}, { get() { throw new Error(secret); } })]) {
    const result = toSafeError(value);
    assert.deepEqual(result, { code: "UNKNOWN_ERROR", message: "处理失败，请重试或更换照片" });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal("stack" in result || "cause" in result, false);
  }
});

test("controlled errors use allowlisted messages even after tampering", () => {
  const error = new CoreError("INVALID_IMAGE");
  error.message = "sensitive base64 key filename";
  error.stack = "C:\\private-path";
  assert.deepEqual(JSON.parse(JSON.stringify(error)), { code: "INVALID_IMAGE", message: "照片损坏或无法解码" });
  const unknown = new CoreError("not_a_valid_code");
  assert.equal(toSafeError(unknown).code, "UNKNOWN_ERROR");
});

test("per-call key does not become cached and mock needs no key", () => {
  assert.equal(modelKeyForCall("mock", "should-not-pass-to-C"), "");
  assert.equal(modelKeyForCall("real", " test-only-secret "), "test-only-secret");
  assert.throws(() => modelKeyForCall("real", ""), error => error.code === "KEY_REQUIRED");
  assert.equal(modelKeyForCall("mock", ""), "");
});

test("D1 mock preparation and injected B/C calls have no network/storage/log/URL access", async t => {
  let forbidden = 0;
  const fail = () => { forbidden++; throw new Error("Forbidden side effect"); };
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) replaceGlobal(t, name, fail);
  const guarded = new Proxy({}, { get: fail, set: fail });
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "location"]) replaceGlobal(t, name, guarded);
  replaceGlobal(t, "console", { log: fail, error: fail, warn: fail, info: fail, debug: fail });
  replaceGlobal(t, "URL", new Proxy(URL, { construct: fail, get: fail }));
  installBrowser(t);
  const input = new File([Buffer.from(fixtures["image/png"], "base64")], "synthetic.png", { type: "image/png" });
  const photos = await preprocessPhotos([input]);
  const mock = {
    async retrieveEvidence(query) { return { status: "no_match", query, items: [] }; },
    async observePhotos(input) {
      assert.equal(input.apiKey, ""); assert.equal(input.provider, "gemini");
      return { schema_version: 1, observations: [] };
    },
  };
  const ports = selectPorts("mock", { mock, get real() { return fail(); } });
  const signal = new AbortController().signal;
  const [evidence, observed] = await Promise.all([
    ports.retrieveEvidence({}), ports.observePhotos(createPhotoInput(photos, "mock", "test-key-never-forwarded", signal)),
  ]);
  assert.equal(evidence.status, "no_match"); assert.equal(observed.schema_version, 1);
  assert.equal(forbidden, 0);
});

test("no real adapter is invented or used when it is unavailable", () => {
  const mock = { retrieveEvidence() {}, observePhotos() {} };
  assert.throws(() => selectPorts("real", { mock }), error => error.code === "ADAPTER_UNAVAILABLE");
  assert.equal(selectPorts("real", { mock, real: mock }), mock);
});
