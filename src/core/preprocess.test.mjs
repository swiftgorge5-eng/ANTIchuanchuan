import test from "node:test";
import assert from "node:assert/strict";
import { preprocessPhotos, DEFAULT_PHOTO_LIMITS } from "./preprocess.ts";
import { inspectImage } from "./image-header.ts";
import { toSafeError } from "./errors.ts";
import { fixtures, exifJpeg } from "./test-fixtures.mjs";
import { installBrowser, replaceGlobal, png, pngChunk, expectReleased } from "./test-browser.mjs";

const file = (mime = "image/png", data = Buffer.from(fixtures[mime], "base64")) =>
  new File([data], "../../private/user-location.photo", { type: mime });
const rejected = (promise, code) => assert.rejects(promise, error => {
  assert.equal(toSafeError(error).code, code); return true;
});

for (const mime of Object.keys(fixtures)) {
  test(`synthetic ${mime} header + mocked decoder pipeline`, async t => {
    const { events } = installBrowser(t);
    const [result] = await preprocessPhotos([file(mime)]);
    assert.deepEqual(Object.keys(result).sort(), ["data", "id", "mimeType"]);
    assert.match(result.id, /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/);
    assert.equal(result.mimeType, "image/png");
    assert.match(result.data, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    assert.equal(Buffer.from(result.data, "base64").toString("base64"), result.data);
    assert.equal(result.data.includes("data:"), false);
    assert.deepEqual(inspectImage(Buffer.from(result.data, "base64")), {
      mime: "image/png", width: 4, height: 2, sensitiveMetadata: false,
    });
    assert.ok(expectReleased(events));
  });
}

test("defaults, empty batch, empty file, count, size and unsupported MIME", async t => {
  installBrowser(t);
  assert.equal(DEFAULT_PHOTO_LIMITS.maxFiles, 10);
  assert.equal(DEFAULT_PHOTO_LIMITS.maxInputBytes, 10 * 1024 * 1024);
  await rejected(preprocessPhotos([]), "NO_PHOTOS");
  await rejected(preprocessPhotos([file("image/png", Buffer.alloc(0))]), "EMPTY_PHOTO");
  await rejected(preprocessPhotos(Array.from({ length: 11 }, () => file())), "TOO_MANY_PHOTOS");
  await rejected(preprocessPhotos([file()], { maxInputBytes: 5 }), "PHOTO_TOO_LARGE");
  await rejected(preprocessPhotos([file("image/svg+xml", Buffer.from("<svg/>"))]), "UNSUPPORTED_FORMAT");
});

test("rejects MIME spoofing and malformed containers before decode", async t => {
  const { events } = installBrowser(t);
  await rejected(preprocessPhotos([file("image/jpeg", Buffer.from(fixtures["image/png"], "base64"))]), "TYPE_MISMATCH");
  await rejected(preprocessPhotos([file("image/png", Buffer.from("not an image"))]), "UNSUPPORTED_FORMAT");
  await rejected(preprocessPhotos([file("image/png", Buffer.from(fixtures["image/png"], "base64").subarray(0, 30))]), "INVALID_IMAGE");
  assert.equal(events.bitmaps.length, 0);
});

test("safe error when simulated browser decoder rejects plausible content", async t => {
  installBrowser(t, { decode: async () => { throw new Error("key=PRIVATE data:image/png;base64,AAAA C:\\users\\private"); } });
  await rejected(preprocessPhotos([file()]), "INVALID_IMAGE");
});

test("header pixel and edge limits checked before decode", async t => {
  const { events } = installBrowser(t);
  await rejected(preprocessPhotos([file()], { maxPixels: 7 }), "IMAGE_TOO_LARGE");
  await rejected(preprocessPhotos([file()], { maxDimension: 3 }), "IMAGE_TOO_LARGE");
  assert.equal(events.bitmaps.length, 0);
});

test("resizes keeping aspect ratio and never upscales", async t => {
  const { events } = installBrowser(t);
  await preprocessPhotos([file()], { maxEdge: 2 });
  assert.deepEqual(events.draws[0].slice(1), [0, 0, 2, 1]);
  await preprocessPhotos([file()], { maxEdge: 100 });
  assert.deepEqual(events.draws[1].slice(1), [0, 0, 4, 2]);
  assert.equal(events.requests[0].quality, 0.85);
  assert.ok(expectReleased(events));
});

test("orientation swap accepted for JPEG and ID remains independent of filename", async t => {
  const { events } = installBrowser(t, { decode: async (_, options, events) => {
    assert.equal(options.imageOrientation, "from-image");
    const bitmap = { width: 2, height: 4, closed: 0, close() { this.closed++; } };
    events.bitmaps.push(bitmap); return bitmap;
  } });
  const result = await preprocessPhotos([file("image/jpeg", Buffer.from(exifJpeg, "base64"))]);
  const encoded = inspectImage(Buffer.from(result[0].data, "base64"));
  assert.equal(encoded.width, 2); assert.equal(encoded.height, 4);
  assert.ok(expectReleased(events));
});

test("decoder dimension mismatch rejected and bitmap closed", async t => {
  const { events } = installBrowser(t, { decode: async (_, __, events) => {
    const bitmap = { width: 1, height: 1, closed: 0, close() { this.closed++; } };
    events.bitmaps.push(bitmap); return bitmap;
  } });
  await rejected(preprocessPhotos([file()]), "INVALID_IMAGE");
  assert.ok(expectReleased(events));
});

test("output size, empty encoder output and encoder errors release resources", async t => {
  const { events } = installBrowser(t);
  await rejected(preprocessPhotos([file()], { maxOutputBytes: 10 }), "OUTPUT_TOO_LARGE");
  assert.ok(expectReleased(events));
});

for (const [label, encoder] of [
  ["empty", async () => new Blob([], { type: "image/png" })],
  ["throws", async () => { throw new Error("secret internal encoder failure"); }],
  ["bad MIME", async () => new Blob([png()], { type: "image/jpeg" })],
]) {
  test(`encoder ${label} is controlled and closes bitmap/canvas`, async t => {
    const { events } = installBrowser(t, { encode: encoder });
    await rejected(preprocessPhotos([file()]), "ENCODE_FAILED");
    assert.ok(expectReleased(events));
  });
}

test("metadata cleared on new canvas path; leaked text chunk is rejected", async t => {
  const { events } = installBrowser(t);
  const result = await preprocessPhotos([file("image/jpeg", Buffer.from(exifJpeg, "base64"))]);
  assert.equal(inspectImage(Buffer.from(result[0].data, "base64")).sensitiveMetadata, false);
  assert.ok(expectReleased(events));
});

test("fails closed when encoder retains common metadata", async t => {
  const { events } = installBrowser(t, { encode: async c => new Blob([png(c.width, c.height, true)], { type: "image/png" }) });
  await rejected(preprocessPhotos([file()]), "METADATA_RETAINED");
  assert.ok(expectReleased(events));
});

test("already cancelled and arbitrary abort reason is never disclosed", async t => {
  const { events } = installBrowser(t);
  const controller = new AbortController(); controller.abort("private key and location");
  await rejected(preprocessPhotos([file()], { signal: controller.signal }), "CANCELLED");
  assert.equal(events.bitmaps.length, 0);
});

test("cancellation during decode returns promptly and closes late bitmap", async t => {
  let resolveDecode, announceDecode;
  const ready = new Promise(resolve => announceDecode = resolve);
  installBrowser(t, { decode: () => { announceDecode(); return new Promise(resolve => resolveDecode = resolve); } });
  const controller = new AbortController();
  const result = preprocessPhotos([file()], { signal: controller.signal });
  const checked = rejected(result, "CANCELLED");
  await ready; controller.abort("do not leak this reason"); await checked;
  const bitmap = { width: 4, height: 2, count: 0, close() { this.count++; } };
  resolveDecode(bitmap); await new Promise(resolve => setImmediate(resolve));
  assert.equal(bitmap.count, 1);
});

test("cancellation during encoding releases bitmap/canvas and ignores late blob", async t => {
  let resolveEncode, announceEncode;
  const ready = new Promise(resolve => announceEncode = resolve);
  const { events } = installBrowser(t, { encode: () => { announceEncode(); return new Promise(resolve => resolveEncode = resolve); } });
  const controller = new AbortController();
  const result = preprocessPhotos([file()], { signal: controller.signal });
  const checked = rejected(result, "CANCELLED");
  await ready; controller.abort(); await checked;
  assert.ok(expectReleased(events));
  resolveEncode(new Blob([png()], { type: "image/png" }));
  await new Promise(resolve => setImmediate(resolve));
});

test("cancellation after draw and batch failures clean all created resources", async t => {
  const controller = new AbortController();
  const { events } = installBrowser(t, { draw: () => controller.abort() });
  await rejected(preprocessPhotos([file(), file()], { signal: controller.signal }), "CANCELLED");
  assert.equal(events.bitmaps.length, 1);
  assert.ok(expectReleased(events));
});

test("IDs unique and earlier successful batch members released when later member fails", async t => {
  const { events } = installBrowser(t);
  const result = await preprocessPhotos([file(), file()]);
  assert.notEqual(result[0].id, result[1].id);
  await rejected(preprocessPhotos([file(), file("image/png", Buffer.from("bad"))]), "UNSUPPORTED_FORMAT");
  assert.ok(expectReleased(events));
});

test("HTML canvas fallback and JPEG white alpha background", async t => {
  const { events } = installBrowser(t);
  replaceGlobal(t, "OffscreenCanvas", undefined);
  replaceGlobal(t, "document", { createElement: name => {
    assert.equal(name, "canvas");
    const canvas = { width: 0, height: 0, getContext() { return {
      drawImage: (...args) => events.draws.push(args), fillRect: (...args) => events.fill.push(args),
    }; }, toBlob(callback) { callback(new Blob([png(this.width, this.height)], { type: "image/png" })); } };
    events.canvases.push(canvas); return canvas;
  } });
  await preprocessPhotos([file()], { outputMimeType: "image/jpeg" });
  assert.equal(events.fill.length, 1);
  assert.ok(expectReleased(events));
});

test("missing decoder or canvas/context fails with controlled compatibility error", async t => {
  const { events } = installBrowser(t, { noContext: true });
  await rejected(preprocessPhotos([file()]), "BROWSER_UNSUPPORTED");
  assert.ok(expectReleased(events));
  replaceGlobal(t, "createImageBitmap", undefined);
  await rejected(preprocessPhotos([file()]), "BROWSER_UNSUPPORTED");
});

test("invalid configuration rejected", async t => {
  installBrowser(t);
  for (const options of [null, { signal: { aborted: true } }, { maxFiles: 0 }, { maxEdge: Infinity }, { maxPixels: -1 }, { quality: 2 }, { outputMimeType: "image/gif" }]) {
    await rejected(preprocessPhotos([file()], options), "INVALID_OPTIONS");
  }
});

test("PNG animation and truncated WebP/JPEG are rejected structurally", async t => {
  installBrowser(t);
  const regular = png();
  const animated = Buffer.concat([regular.subarray(0, 33), pngChunk("acTL", Buffer.alloc(8)), regular.subarray(33)]);
  await rejected(preprocessPhotos([file("image/png", animated)]), "ANIMATED_IMAGE");
  for (const mime of ["image/webp", "image/jpeg"]) {
    await rejected(preprocessPhotos([file(mime, Buffer.from(fixtures[mime], "base64").subarray(0, 20))]), "INVALID_IMAGE");
  }
});

test("cancellation while reading a file does not start browser decoding", async t => {
  const { events } = installBrowser(t);
  let resolveRead;
  const source = file();
  source.arrayBuffer = () => new Promise(resolve => resolveRead = resolve);
  const controller = new AbortController();
  const result = preprocessPhotos([source], { signal: controller.signal });
  const checked = rejected(result, "CANCELLED");
  controller.abort(); await checked;
  resolveRead(Buffer.from(fixtures["image/png"], "base64").buffer);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.bitmaps.length, 0);
});

test("abort listeners are removed after success", async t => {
  installBrowser(t);
  const controller = new AbortController(), listeners = new Set();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  t.mock.method(signal, "addEventListener", (event, listener, options) => {
    if (event === "abort") listeners.add(listener);
    return add(event, listener, options);
  });
  t.mock.method(signal, "removeEventListener", (event, listener, options) => {
    if (event === "abort") listeners.delete(listener);
    return remove(event, listener, options);
  });
  const prepared = await preprocessPhotos(Array.from({ length: 10 }, () => file()), { signal });
  assert.equal(prepared.length, 10);
  assert.equal(new Set(prepared.map(photo => photo.id)).size, 10);
  assert.equal(listeners.size, 0);
});

test("source PNG text metadata is not copied to the mocked canvas output", async t => {
  installBrowser(t);
  const result = await preprocessPhotos([file("image/png", png(4, 2, true))]);
  assert.equal(inspectImage(Buffer.from(result[0].data, "base64")).sensitiveMetadata, false);
});

test("JPEG EXIF and WebP EXIF/XMP container markers are recognized", () => {
  assert.equal(inspectImage(Buffer.from(exifJpeg, "base64")).sensitiveMetadata, true);
  const regular = Buffer.from(fixtures["image/webp"], "base64");
  const chunk = Buffer.concat([Buffer.from("EXIF"), Buffer.from([4,0,0,0]), Buffer.from("TEST")]);
  const withExif = Buffer.concat([regular, chunk]);
  withExif.writeUInt32LE(withExif.length - 8, 4);
  assert.equal(inspectImage(withExif).sensitiveMetadata, true);
});

test("unexpected IO errors and thrown option getters return safe DTOs", async t => {
  installBrowser(t);
  const source = file();
  source.arrayBuffer = async () => { throw new Error("SECRET_KEY C:\\private data:image/png;base64,AAAA"); };
  await rejected(preprocessPhotos([source]), "UNKNOWN_ERROR");
  await rejected(preprocessPhotos([file()], { get signal() { throw new Error("SECRET_KEY"); } }), "UNKNOWN_ERROR");
});

test("JPEG encoder metadata retention fails closed", async t => {
  const { events } = installBrowser(t, { encode: async () => new Blob([Buffer.from(exifJpeg, "base64")], { type: "image/jpeg" }) });
  await rejected(preprocessPhotos([file()]), "METADATA_RETAINED");
  assert.ok(expectReleased(events));
});

test("browser orientation dimension swaps are accepted for PNG and WebP too", async t => {
  const { events } = installBrowser(t, { decode: async (_, __, events) => {
    const bitmap = { width: 2, height: 4, closed: 0, close() { this.closed++; } };
    events.bitmaps.push(bitmap); return bitmap;
  } });
  const prepared = await preprocessPhotos([file("image/png"), file("image/webp")]);
  assert.equal(prepared.length, 2);
  for (const photo of prepared) {
    const header = inspectImage(Buffer.from(photo.data, "base64"));
    assert.equal(header.width, 2); assert.equal(header.height, 4);
  }
  assert.ok(expectReleased(events));
});
