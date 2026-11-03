const MESSAGES = Object.freeze({
  INVALID_OPTIONS: "图片处理配置无效",
  NO_PHOTOS: "请选择至少一张照片",
  TOO_MANY_PHOTOS: "照片数量超过限制",
  EMPTY_PHOTO: "照片文件为空",
  PHOTO_TOO_LARGE: "照片文件超过大小限制",
  UNSUPPORTED_FORMAT: "仅支持 JPEG、PNG 和 WebP 照片",
  TYPE_MISMATCH: "照片声明类型与实际格式不符",
  INVALID_IMAGE: "照片损坏或无法解码",
  IMAGE_TOO_LARGE: "照片像素或尺寸超过限制",
  ANIMATED_IMAGE: "暂不支持动画或多帧照片",
  ENCODE_FAILED: "无法生成处理后的照片",
  OUTPUT_TOO_LARGE: "处理后的照片超过大小限制",
  METADATA_RETAINED: "无法确认处理副本已清理附带元数据",
  BROWSER_UNSUPPORTED: "当前浏览器缺少所需的图片处理能力",
  CANCELLED: "图片处理已取消",
  KEY_REQUIRED: "真实模式需要本次使用的模型密钥",
  ADAPTER_UNAVAILABLE: "当前模式的模块尚未接入",
  INVALID_REPORT_INPUT: "报告输入不符合接口或安全要求",
  INVALID_ANALYSIS_INPUT: "分析输入不符合接口或安全要求",
  INVALID_PREPARED_PHOTOS: "预处理照片不符合交接要求",
  TIMEOUT: "分析任务超过时间限制",
  MOCK_FAILURE: "演示适配器模拟失败",
  DOWNLOAD_UNAVAILABLE: "当前环境不支持报告下载",
  DOWNLOAD_FAILED: "报告下载未能完成，请重试",
  UNKNOWN_ERROR: "处理失败，请重试或更换照片",
});
export type CoreErrorCode = keyof typeof MESSAGES;
export interface SafeCoreError { code: CoreErrorCode; message: string }

function known(code: unknown): code is CoreErrorCode {
  return typeof code === "string" && Object.hasOwn(MESSAGES, code);
}

/** Never takes raw provider errors, filenames, keys, paths or exception causes. */
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  constructor(code: CoreErrorCode) {
    const safe = known(code) ? code : "UNKNOWN_ERROR";
    super(MESSAGES[safe]);
    this.name = "CoreError";
    this.code = safe;
  }
  toJSON(): SafeCoreError { return toSafeError(this); }
}

/** Allowlist projection, not regex redaction: no untrusted message/stack is copied. */
export function toSafeError(error: unknown): SafeCoreError {
  try {
    if (error instanceof CoreError && known(error.code)) {
      return { code: error.code, message: MESSAGES[error.code] };
    }
  } catch { /* Defensive against proxies/getters supplied by external modules. */ }
  return { code: "UNKNOWN_ERROR", message: MESSAGES.UNKNOWN_ERROR };
}

export function throwIfAborted(signal?: AbortSignal): void {
  // Do not expose signal.reason: it may contain caller data or credentials.
  if (signal?.aborted) throw new CoreError("CANCELLED");
}
