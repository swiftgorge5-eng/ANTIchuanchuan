/**
 * Provider adapters for photo observation.
 *
 * 结构参照团队那份单文件应用的 PROVIDERS 表：浏览器直连厂商接口，Key 由用户提供。
 * 两家接口形态不同，所以请求构造与响应解析都按 provider 分支。
 */
import type { PreparedPhoto } from "../core/types.internal.ts";

export type PhotoProvider = "deepseek" | "gemini";

export interface ProviderConfig {
  label: string;
  endpoint: string;
  model: string;
}

export const PROVIDERS: Readonly<Record<PhotoProvider, ProviderConfig>> = Object.freeze({
  deepseek: Object.freeze({
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-flash",
  }),
  gemini: Object.freeze({
    label: "Google Gemini",
    endpoint:
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    model: "gemini-3.5-flash",
  }),
});

export interface BuiltRequest {
  headers: Record<string, string>;
  body: unknown;
}

export function isPhotoProvider(value: unknown): value is PhotoProvider {
  return value === "deepseek" || value === "gemini";
}

/** Photos arrive as bare base64; providers want a full data URL or inline bytes. */
function dataUrl(photo: PreparedPhoto): string {
  return `data:${photo.mimeType};base64,${photo.data}`;
}

export function buildRequest(
  provider: PhotoProvider,
  photos: readonly PreparedPhoto[],
  prompt: string,
  apiKey: string,
): BuiltRequest {
  if (provider === "deepseek") {
    const content: unknown[] = [{ type: "text", text: prompt }];
    for (const photo of photos) {
      content.push(
        { type: "text", text: `下一张照片的 photoId：${photo.id}` },
        { type: "image_url", image_url: { url: dataUrl(photo) } },
      );
    }
    return {
      headers: { Authorization: `Bearer ${apiKey}` },
      body: {
        model: PROVIDERS.deepseek.model,
        messages: [{ role: "user", content }],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 4096,
      },
    };
  }

  const parts: unknown[] = [{ text: prompt }];
  for (const photo of photos) {
    parts.push(
      { text: `下一张照片的 photoId：${photo.id}` },
      { inlineData: { mimeType: photo.mimeType, data: photo.data } },
    );
  }
  return {
    headers: { "x-goog-api-key": apiKey },
    body: {
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
    },
  };
}

/** Pull the model text out of either provider's envelope. Never throws on odd shapes. */
export function extractText(provider: PhotoProvider, payload: unknown): string {
  try {
    if (provider === "deepseek") {
      const choice = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0];
      const content = choice?.message?.content;
      return typeof content === "string" ? content : "";
    }
    const candidate = (payload as { candidates?: { content?: { parts?: unknown[] } }[] } | null)?.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((part) => {
        const row = part as { text?: unknown; thought?: unknown };
        return row?.thought ? "" : typeof row?.text === "string" ? row.text : "";
      })
      .join("");
  } catch {
    return "";
  }
}

/** Providers sometimes wrap JSON in prose or fences; take the outermost object. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner !== undefined) return inner;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1));
    if (sliced !== undefined) return sliced;
  }
  return null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
