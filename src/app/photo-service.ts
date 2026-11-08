/**
 * HomeSafePhotoService：把仓库里的 C 模块（照片观察）接到队友新版前端的
 * `window.HomeSafePhotoService` 接缝上。
 *
 * 队友的 app.js 约定：
 *   service.run({ photos:[{id,name,mimeType,dataUrl,room}], signal })
 *     -> { observations:[{title,phenomenon,limitation,advice,photoIndex}], visible:[{title,text}], summary, overallScore }
 *
 * 这里多做三件事：把 dataUrl 还原成裸 base64 交给观察器、按类别翻译成人能读的
 * 风险/可见项、并且**不给分数**（我们的分数规则未校准，宁可不给，也不编一个）。
 */
import { CoreError } from "../core/errors.ts";
import { createPhotoObserver } from "../photo/index.ts";

interface ServicePhoto {
  id: string;
  name?: string;
  mimeType?: string;
  dataUrl: string;
  room?: string;
}

interface ServiceInput {
  photos: ServicePhoto[];
  signal?: AbortSignal;
}

interface ReportObservation {
  type: "risk";
  title: string;
  phenomenon: string;
  limitation: string;
  advice: string;
  photoIndex: number;
}

interface ReportVisible {
  title: string;
  text: string;
  photoIndex: number;
}

const CATEGORY_COPY = {
  renovation_trace: {
    label: "装修或翻新痕迹",
    limitation: "只能看到表面材质与做工，不能判断材料环保性或施工质量。",
    advice: "到现场确认装修完成时间与通风情况，并查看同位置墙面、柜体的收边工艺。",
  },
  partition_trace: {
    label: "隔断、拼接或加建",
    limitation: "照片不能判断墙体是否承重，也不能确认是否属于原始户型。",
    advice: "对照户型图确认这处隔断是否为后期加建；涉及墙体改动时向物业核实。",
  },
  moisture_trace: {
    label: "潮湿、水渍或霉斑",
    limitation: "照片无法验证是否仍在渗水，也无法判断渗漏原因。",
    advice: "到现场摸墙面是否返潮、看水印范围，并询问近一年是否漏水或做过维修。",
  },
  daylight_cue: {
    label: "自然采光线索",
    limitation: "照片只能说明拍摄当时的光线，不代表全天采光。",
    advice: "在不同时段再看一次，并结合朝向、楼层与窗外遮挡判断。",
  },
} as const;

type Category = keyof typeof CATEGORY_COPY;

const CATEGORIES = Object.keys(CATEGORY_COPY) as Category[];
const isCategory = (value: string): value is Category => CATEGORIES.includes(value as Category);

const MAX_SIDE = 1600;

/** 把 dataUrl 拆成裸 base64 与 mimeType；顺带压到观察器能接受的大小。 */
function toPrepared(photo: ServicePhoto): { id: string; mimeType: string; data: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/u.exec(photo.dataUrl ?? "");
  if (!match) return null;
  return { id: photo.id, mimeType: match[1], data: match[2] };
}

let apiKey = "";

function friendlyError(error: unknown): Error {
  if (error instanceof CoreError) {
    if (error.code === "KEY_REQUIRED") return new Error("模型服务商拒绝了这个 Key（无效或权限不足）。");
    if (error.code === "TIMEOUT") return new Error("模型响应超时，照片已发送但没有拿到结果。");
    if (error.code === "CANCELLED") return new Error("分析已取消。");
    if (error.code === "INVALID_PREPARED_PHOTOS") return new Error("没有可分析的照片。");
    return new Error("模型没有返回可用的结果，请稍后重试。");
  }
  return error instanceof Error ? error : new Error("分析未完成");
}

function buildReport(photos: ServicePhoto[], result: Awaited<ReturnType<ReturnType<typeof createPhotoObserver>>>) {
  const indexById = new Map(photos.map((photo, index) => [photo.id, index]));
  const observations: ReportObservation[] = [];
  const visible: ReportVisible[] = [];

  for (const row of result.observations) {
    if (!isCategory(row.category)) continue;
    const photoIndex = indexById.get(row.photoId);
    if (photoIndex === undefined) continue;
    const copy = CATEGORY_COPY[row.category];
    const where = photos[photoIndex]?.room?.trim() || photos[photoIndex]?.name?.trim() || `照片 ${photoIndex + 1}`;
    const evidence = row.evidence.filter(Boolean).join("；") || "画面中看不到足以判断这一项的内容。";

    if (row.state === "present") {
      // 采光项即使“可见”也不是风险，只作为可见事实记录。
      if (row.category === "daylight_cue") {
        visible.push({ title: `${where} · ${copy.label}`, text: evidence, photoIndex });
        continue;
      }
      observations.push({
        type: "risk",
        title: `${where} · ${copy.label}`,
        phenomenon: evidence,
        limitation: copy.limitation,
        advice: copy.advice,
        photoIndex,
      });
      continue;
    }

    if (row.state === "absent") {
      visible.push({
        title: `${where} · 未见${copy.label}`,
        text: `${evidence}（只代表这张照片的画面，不等于现场不存在。）`,
        photoIndex,
      });
      continue;
    }

    visible.push({ title: `${where} · ${copy.label}无法判断`, text: evidence, photoIndex });
  }

  const summary = photos.length
    ? `已记录 ${photos.length} 张照片的可见现象，其中 ${observations.length} 项需要到现场核实。风险指数未做校准，因此不给出数字分数。`
    : "本次没有可分析的照片。";

  return {
    observations,
    visible,
    summary,
    // 我们的规则分数未经数据校准，界面上的“风险指数”宁可不给。
    overallScore: null as number | null,
  };
}

export interface HomeSafePhotoService {
  label: string;
  getKey(): string;
  setKey(value: string): void;
  run(input: ServiceInput): Promise<ReturnType<typeof buildReport>>;
}

export function installPhotoService(): HomeSafePhotoService {
  const observer = createPhotoObserver({ provider: "deepseek", timeoutMs: 120_000 });
  const service: HomeSafePhotoService = {
    label: "DeepSeek（deepseek-flash，使用你自己的 Key）",
    getKey: () => apiKey,
    setKey: (value: string) => {
      apiKey = value.trim();
    },
    async run({ photos, signal }) {
      if (!apiKey) throw new Error("还没有填入模型 Key。");
      const prepared = photos.map(toPrepared);
      if (prepared.some((photo) => photo === null) || prepared.length === 0) {
        throw new Error("照片读取失败，请重新选择后再试。");
      }
      try {
        const result = await observer({
          photos: prepared as { id: string; mimeType: string; data: string }[],
          apiKey,
          // 契约里的字面量字段；观察器按自己的 provider 配置走。
          provider: "gemini",
          signal: signal ?? new AbortController().signal,
        });
        return buildReport(photos, result);
      } catch (error) {
        throw friendlyError(error);
      }
    },
  };
  const scope = window as unknown as { HomeSafePhotoService?: HomeSafePhotoService };
  scope.HomeSafePhotoService = service;
  return service;
}

export { MAX_SIDE };
