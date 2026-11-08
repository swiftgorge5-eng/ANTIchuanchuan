/**
 * Prompt for the photo observer.
 *
 * 注意：提示词里刻意不出现 report-validation 的敏感词表（串串房/甲醛/承重墙/产权/
 * 违法/违规/结构安全），避免模型照抄进 evidence 字段而被 D 的校验直接判废。
 */
export const OBSERVATION_CATEGORIES = [
  "renovation_trace",
  "partition_trace",
  "moisture_trace",
  "daylight_cue",
] as const;

export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<ObservationCategory, string>> = Object.freeze({
  renovation_trace: "装修或翻新痕迹",
  partition_trace: "疑似隔断、拼接或加建",
  moisture_trace: "潮湿、水渍或霉斑",
  daylight_cue: "自然采光线索",
});

export const PROMPT_VERSION = "photo-c1";

export function buildPrompt(photoCount: number): string {
  const lines = [
    "你是房屋照片的观察记录员，只记录画面里看得见的像素事实。",
    `本次共 ${photoCount} 张照片，每张照片前面都会标明它的 photoId。`,
    "",
    "对每张照片的下面 4 个类别分别给出结论：",
    ...OBSERVATION_CATEGORIES.map((category, index) => `${index + 1}. ${category}：${CATEGORY_LABELS[category]}`),
    "",
    "state 只能取三个值：",
    "present：画面里清楚可见该现象；",
    "absent：对应部位被完整拍到，且没有看到该现象；",
    "unknown：没拍到、被遮挡、光线不足或看不清楚。拿不准时必须用 unknown，不许猜成 absent。",
    "",
    "evidence 是 1-3 条简短中文描述，每条不超过 60 字，必须写清：位置（如画面右下、窗台下方）、颜色或纹理、可见范围。",
    "evidence 里不要出现换行、尖括号、网址、文件路径或任何密钥。",
    "",
    "绝对不要输出：任何安全或鉴定结论、任何含量或浓度数值、任何合法性与权属判断、任何疾病或空气质量的推断。",
    "也不要推测拍摄者身份、住址或照片之外的信息。",
    "",
    "只返回一个 JSON 对象，不要 Markdown 代码块，不要解释文字。格式：",
    '{"schema_version":1,"observations":[{"photoId":"照片的id","category":"renovation_trace","state":"unknown","evidence":["画面整体偏暗，墙面细节看不清"]}]}',
    "",
    `observations 必须覆盖每一张照片的这 4 个类别，共 ${photoCount * 4} 条。`,
  ];
  return lines.join("\n");
}
