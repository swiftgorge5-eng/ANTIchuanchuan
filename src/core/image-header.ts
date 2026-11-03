import { CoreError } from "./errors.ts";

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";
export interface ImageHeader { mime: PhotoMime; width: number; height: number; sensitiveMetadata: boolean }
const ascii = (bytes: Uint8Array, offset: number, size: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + size));

function invalid(): never { throw new CoreError("INVALID_IMAGE"); }

/** Bounded container inspection before browser decoding; not a replacement decoder. */
export function inspectImage(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(bytes, 1, 7) === "PNG\r\n\x1a\n") {
    let width = 0, height = 0, pixels = false, metadata = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
      const end = offset + 12 + size;
      if (end > bytes.length) invalid();
      if (offset === 8 && (type !== "IHDR" || size !== 13)) invalid();
      if (type === "IHDR") {
        if (offset !== 8 || size !== 13) invalid();
        width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      }
      if (type === "acTL") throw new CoreError("ANIMATED_IMAGE");
      if (["eXIf", "tEXt", "zTXt", "iTXt"].includes(type)) metadata = true;
      if (type === "IDAT") pixels = true;
      if (type === "IEND") {
        if (size || end !== bytes.length || !pixels || !width || !height) invalid();
        return { mime: "image/png", width, height, sensitiveMetadata: metadata };
      }
      offset = end;
    }
    invalid();
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid();
    let width = 0, height = 0, metadata = false, offset = 2;
    const frames = new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) break;
      if (offset + 2 > bytes.length) invalid();
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) invalid();
      if (marker === 225 || marker === 237 || marker === 254) metadata = true;
      if (frames.has(marker)) {
        if (size < 8 || width) invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      if (marker === 218) {
        if (!width || !height) invalid();
        return { mime: "image/jpeg", width, height, sensitiveMetadata: metadata };
      }
      offset += size;
    }
    invalid();
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let width = 0, height = 0, pixels = false, metadata = false;
    let extended: { width: number; height: number } | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
      const end = start + size + size % 2;
      if (end > bytes.length) invalid();
      if (["ANIM", "ANMF"].includes(type)) throw new CoreError("ANIMATED_IMAGE");
      if (["EXIF", "XMP "].includes(type)) metadata = true;
      if (type === "VP8X") {
        if (size !== 10) invalid();
        if (bytes[start] & 2) throw new CoreError("ANIMATED_IMAGE");
        if (bytes[start] & 12) metadata = true; // EXIF/XMP flags, even if chunks are missing.
        const u24 = (at: number) => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
        extended = { width: 1 + u24(start + 4), height: 1 + u24(start + 7) };
      }
      if (type === "VP8 ") {
        if (size < 10 || ascii(bytes, start + 3, 3) !== "\x9d\x01\x2a" || pixels) invalid();
        width = view.getUint16(start + 6, true) & 16383;
        height = view.getUint16(start + 8, true) & 16383; pixels = true;
      }
      if (type === "VP8L") {
        if (size < 5 || bytes[start] !== 47 || pixels) invalid();
        const packed = view.getUint32(start + 1, true);
        width = 1 + (packed & 16383); height = 1 + ((packed >>> 14) & 16383); pixels = true;
      }
      offset = end;
      if (offset === bytes.length && pixels && width && height) {
        if (extended && (extended.width !== width || extended.height !== height)) invalid();
        return { mime: "image/webp", width, height, sensitiveMetadata: metadata };
      }
    }
    invalid();
  }
  throw new CoreError("UNSUPPORTED_FORMAT");
}
