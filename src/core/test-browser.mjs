// Node-only test support. This models ownership/lifecycle, NOT browser decoding.
import { deflateSync } from "node:zlib";
import { inspectImage } from "./image-header.ts";

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function pngChunk(type, data) {
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(payload));
  return Buffer.concat([size, payload, checksum]);
}
export function png(width = 4, height = 2, text = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", header),
    ...(text ? [pngChunk("tEXt", Buffer.from("location\0SYNTHETIC ONLY"))] : []),
    pngChunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
export function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}
export function installBrowser(t, hooks = {}) {
  const events = { bitmaps: [], canvases: [], draws: [], fill: [], requests: [] };
  replaceGlobal(t, "createImageBitmap", async (blob, options) => {
    if (hooks.decode) return hooks.decode(blob, options, events);
    const header = inspectImage(new Uint8Array(await blob.arrayBuffer()));
    const bitmap = { width: header.width, height: header.height, closed: 0, close() { this.closed++; } };
    events.bitmaps.push(bitmap);
    return bitmap;
  });
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; events.canvases.push(this); }
    getContext() {
      if (hooks.noContext) return null;
      return { drawImage: (...args) => { events.draws.push(args); hooks.draw?.(...args); },
        fillRect: (...args) => events.fill.push(args), fillStyle: "" };
    }
    async convertToBlob(options) {
      events.requests.push(options);
      if (hooks.encode) return hooks.encode(this, options, events);
      return new Blob([png(this.width, this.height)], { type: "image/png" });
    }
  }
  replaceGlobal(t, "OffscreenCanvas", Canvas);
  return { events, Canvas };
}
export function expectReleased(events) {
  return events.bitmaps.every(bitmap => bitmap.closed === 1)
    && events.canvases.every(canvas => canvas.width === 0 && canvas.height === 0);
}
