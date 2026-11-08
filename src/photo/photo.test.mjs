/**
 * C 模块单元测试：全离线，用 fetch 替身，不发真实请求、不需要 Key。
 * 关键一条：任何输出都必须能过 D 的 validatePhotos（契约兼容性）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildRequest, extractText, parseJsonObject } from "./providers.ts";
import { normalizeObservations } from "./validate.ts";
import { createPhotoObserver } from "./observer.ts";
import { validatePhotos } from "../core/report-validation.ts";
import { toSafeError } from "../core/errors.ts";

const photos = [
  { id: "p1", mimeType: "image/webp", data: "AAAA" },
  { id: "p2", mimeType: "image/png", data: "BBBB" },
];

function okResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("DeepSeek 请求：Bearer 头 + data URL 图片 + json_object", () => {
  const { headers, body } = buildRequest("deepseek", photos, "提示词", "sk-demo");
  assert.equal(headers.Authorization, "Bearer sk-demo");
  assert.equal(body.response_format.type, "json_object");
  const content = body.messages[0].content;
  assert.equal(content[1].text, "下一张照片的 photoId：p1");
  assert.equal(content[2].image_url.url, "data:image/webp;base64,AAAA");
  assert.equal(content[0].text, "提示词");
});

test("Gemini 请求：x-goog-api-key 头 + inlineData + JSON 输出", () => {
  const { headers, body } = buildRequest("gemini", photos, "提示词", "g-demo");
  assert.equal(headers["x-goog-api-key"], "g-demo");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  const parts = body.contents[0].parts;
  assert.equal(parts[0].text, "提示词");
  assert.deepEqual(parts[1], { text: "下一张照片的 photoId：p1" });
  assert.deepEqual(parts[2], { inlineData: { mimeType: "image/webp", data: "AAAA" } });
});

test("响应解析：两家的外层结构都能取到文本", () => {
  assert.equal(
    extractText("deepseek", { choices: [{ message: { content: '{"a":1}' } }] }),
    '{"a":1}',
  );
  assert.equal(
    extractText("gemini", { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }] }),
    '{"a":1}',
  );
  assert.equal(extractText("gemini", {}), "");
  assert.equal(extractText("deepseek", null), "");
});

test("JSON 提取：纯 JSON、代码块包裹、带前后说明都能解析", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('好的，结果如下：{"a":1} 以上。'), { a: 1 });
  assert.equal(parseJsonObject("完全不是 JSON"), null);
});

test("归一化：补齐缺失类别，并且能过 D 的白名单校验", () => {
  const parsed = {
    observations: [
      { photoId: "p1", category: "moisture_trace", state: "present", evidence: ["画面右下角墙脚有大片深褐色水渍"] },
    ],
  };
  const result = normalizeObservations(parsed, ["p1", "p2"]);
  assert.equal(result.observations.length, 8);
  const validated = validatePhotos(result);
  assert.equal(validated.observations.length, 8);
  const present = validated.observations.find((row) => row.photoId === "p1" && row.category === "moisture_trace");
  assert.equal(present.state, "present");
  assert.deepEqual(present.evidence, ["画面右下角墙脚有大片深褐色水渍"]);
  const missing = validated.observations.find((row) => row.photoId === "p2" && row.category === "moisture_trace");
  assert.equal(missing.state, "unknown");
  assert.ok(missing.evidence.length > 0);
});

test("敏感词命中时丢弃该理由；理由全丢则降级为 unknown", () => {
  const parsed = {
    observations: [
      { photoId: "p1", category: "moisture_trace", state: "present", evidence: ["这里可能有甲醛问题"] },
      { photoId: "p1", category: "renovation_trace", state: "present", evidence: ["墙面是新刷的乳胶漆"] },
    ],
  };
  const result = normalizeObservations(parsed, ["p1"]);
  assert.equal(validatePhotos(result).observations.length, 4);
  const moisture = result.observations.find((row) => row.category === "moisture_trace");
  assert.equal(moisture.state, "unknown");
  assert.ok(!moisture.evidence.some((reason) => reason.includes("甲醛")));
  const renovation = result.observations.find((row) => row.category === "renovation_trace");
  assert.equal(renovation.state, "present");
});

test("控制字符、尖括号、超长文本都会被清洗", () => {
  const parsed = {
    observations: [
      { photoId: "p1", category: "daylight_cue", state: "present", evidence: ["窗边光线很亮<b>\n窗台有阳光".repeat(20)] },
    ],
  };
  const result = normalizeObservations(parsed, ["p1"]);
  const row = result.observations.find((item) => item.category === "daylight_cue");
  assert.equal(row.state, "present");
  for (const reason of row.evidence) {
    assert.ok(reason.length <= 120);
    assert.ok(!/[<>\n]/.test(reason));
  }
  assert.equal(validatePhotos(result).observations.length, 4);
});

test("重复理由去重，未知 photoId 被丢弃", () => {
  const parsed = {
    observations: [
      { photoId: "p1", category: "partition_trace", state: "present", evidence: ["画面中间有一道隔断", "画面中间有一道隔断"] },
      { photoId: "ghost", category: "moisture_trace", state: "present", evidence: ["不该出现"] },
    ],
  };
  const result = normalizeObservations(parsed, ["p1"]);
  const row = result.observations.find((item) => item.category === "partition_trace");
  assert.deepEqual(row.evidence, ["画面中间有一道隔断"]);
  assert.equal(result.observations.length, 4);
});

test("观察器：正常返回并过契约校验", async () => {
  const observer = createPhotoObserver({
    fetchImpl: async () =>
      okResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                observations: [
                  { photoId: "p1", category: "moisture_trace", state: "present", evidence: ["窗台下缘有浅褐色水渍"] },
                ],
              }),
            },
          },
        ],
      }),
  });
  const result = await observer({ photos, apiKey: "sk-demo-key", provider: "gemini", signal: new AbortController().signal });
  assert.equal(validatePhotos(result).observations.length, 8);
});

test("观察器：Key 为空直接拒绝，且不发请求", async () => {
  let called = false;
  const observer = createPhotoObserver({ fetchImpl: async () => { called = true; return okResponse({}); } });
  await assert.rejects(
    () => observer({ photos, apiKey: "  ", provider: "gemini", signal: new AbortController().signal }),
    (error) => toSafeError(error).code === "KEY_REQUIRED",
  );
  assert.equal(called, false);
});

test("观察器：401 映射成 KEY_REQUIRED", async () => {
  const observer = createPhotoObserver({ fetchImpl: async () => new Response("nope", { status: 401 }) });
  await assert.rejects(
    () => observer({ photos, apiKey: "sk-bad", provider: "gemini", signal: new AbortController().signal }),
    (error) => toSafeError(error).code === "KEY_REQUIRED",
  );
});

test("观察器：模型返回非 JSON 时抛受控错误", async () => {
  const observer = createPhotoObserver({
    fetchImpl: async () => okResponse({ choices: [{ message: { content: "抱歉，我看不出内容" } }] }),
  });
  await assert.rejects(
    () => observer({ photos, apiKey: "sk-demo-key", provider: "gemini", signal: new AbortController().signal }),
    (error) => toSafeError(error).code === "UNKNOWN_ERROR",
  );
});

test("观察器：已取消的 signal 直接抛 CANCELLED", async () => {
  const controller = new AbortController();
  controller.abort();
  const observer = createPhotoObserver({ fetchImpl: async () => okResponse({}) });
  await assert.rejects(
    () => observer({ photos, apiKey: "sk-demo-key", provider: "gemini", signal: controller.signal }),
    (error) => toSafeError(error).code === "CANCELLED",
  );
});

test("观察器：超时映射成 TIMEOUT", async () => {
  const observer = createPhotoObserver({
    timeoutMs: 30,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  await assert.rejects(
    () => observer({ photos, apiKey: "sk-demo-key", provider: "gemini", signal: new AbortController().signal }),
    (error) => toSafeError(error).code === "TIMEOUT",
  );
});

test("观察器：不把 Key 或图片写进错误信息", async () => {
  const observer = createPhotoObserver({
    fetchImpl: async () => {
      throw new Error("network down for sk-demo-key and AAAA");
    },
  });
  try {
    await observer({ photos, apiKey: "sk-demo-key", provider: "gemini", signal: new AbortController().signal });
    assert.fail("应当抛错");
  } catch (error) {
    const safe = toSafeError(error);
    assert.equal(safe.code, "UNKNOWN_ERROR");
    assert.ok(!safe.message.includes("sk-demo-key"));
    assert.ok(!safe.message.includes("AAAA"));
  }
});
