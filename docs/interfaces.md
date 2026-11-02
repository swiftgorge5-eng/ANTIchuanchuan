# antochuanchuan · v1 模块交接接口

> 只供 B–F 五个模块共同遵守。A 为项目负责人、负责接口评审与合并，不单独占一个 Issue。
>
> **网站架构**：纯静态 React + Vite；浏览器内完成检索、文件处理、状态、评分、报告导出；**不自建服务器**。真实多模态模型只允许浏览器直接调用经实测支持跨域的第三方服务商。用户上传图片需在调用前告知会发送第三方；API Key 默认只保存在当前页面运行内存。

## 1. 共用基础类型

```ts
export type ObservationState = "present" | "absent" | "unknown";
export type EvidenceSourceType = "public" | "synthetic";

export interface LocationQuery {
  city?: string;
  district?: string;
  communityName?: string;
  addressHint?: string;
}

export interface PreparedPhoto {
  id: string;          // 例如 "p1"，D 产生
  mimeType: string;    // image/jpeg、image/png、image/webp 等
  data: string;        // 无 data URL 前缀的 base64 内容
}
```

## 2. B：地点公开证据检索

`retrieveEvidence(input: LocationQuery): Promise<EvidenceResult>`

```ts
export interface EvidenceItem {
  id: string;
  communityName: string;
  sourceType: EvidenceSourceType;  // public: 可核验；synthetic: 演示数据
  title: string;
  publisher: string;
  url: string | null;              // public 必有真实 URL
  date: string | null;             // 已知时 ISO 8601 日期
  summary: string;
  matchStatus: "confirmed" | "possible";
}
export interface EvidenceResult {
  status: "matched" | "ambiguous" | "no_match";
  query: LocationQuery;
  items: EvidenceItem[];
}
```

- 同名小区必须按城市、区、地址交叉核实。无足够信息返回 `ambiguous`，不能把不同小区证据混用。
- 合成数据不得冒充真实记录；无公开资料不是“安全”或“零风险”。
- MVP 可检索本地合法公开资料索引或明确合成的目录，**不能承诺全网实时覆盖**。

## 3. C：照片可见事实

`observePhotos(input: PhotoInput): Promise<PhotoObservationResult>`

```ts
export type ObservationCategory =
  | "renovation_trace" | "partition_trace"
  | "moisture_trace" | "daylight_cue";

export interface PhotoInput {
  photos: PreparedPhoto[];
  apiKey: string;
  provider: "gemini";
  signal: AbortSignal;
}
export interface PhotoObservation {
  photoId: string;
  category: ObservationCategory;
  state: ObservationState;
  evidence: string[];             // 照片里能看到的具体理由
}
export interface PhotoObservationResult {
  schema_version: 1;
  observations: PhotoObservation[];
}
```

- `absent` 只用于**相关区域清楚可见但未见所述迹象**的情况；其他场景用 `unknown`。
- 不能输出“串串房”“甲醛超标”“违规隔断”作视觉事实；这些需要额外核验。
- C 只输出上面的特征 JSON 或结构化错误，不负责打分。

## 4. D：报告与流程

`runAnalysis(input: AnalysisInput, onStage: (stage: AnalysisStage) => void, signal: AbortSignal): Promise<FinalReport>`

```ts
export interface AnalysisInput {
  photos: File[];
  apiKey: string;
  provider: "gemini";
  location?: LocationQuery;
  rentalMode?: "whole" | "shared" | "unknown";
  mode: "mock" | "real";
}

export type AnalysisStage =
  | "idle" | "preparing" | "observing" | "retrieving"
  | "composing" | "success" | "error" | "cancelled";

export interface RiskAssessment {
  score: number | null;           // 0~1 未校准规则符合度，不是客观概率
  level: "low" | "medium" | "high" | "insufficient";
  calibrated: false;              // 真实验证校准前一律 false
  explanation: string;
}

export interface FinalReport {
  status: "success";
  risk: RiskAssessment;
  observations: PhotoObservation[];
  evidence: EvidenceResult;
  limitations: string[];
  rentalMode: "whole" | "shared" | "unknown";
}
```

- D 负责合成 B/C 输出、决定 score 与解释；B 不打分、C 不下结论、E 不计算。
- 有效视觉证据不足、地名无法消歧、来源不可核实时，必须披露不确定性；不能以 `0` 表示“没有风险”。评分是否可用由 D 的规则明确决定，并配测试。
- 无服务器 `task_id`、`POST /api`、`GET /status` 和轮询。
- Key 不得出现在报告、URL、LocalStorage、控制台或日志；第三方模型调用与来源 URL 是仅有的允许的外部网络行为（外部请求必须是设计允许且可审计的）。

## 5. E：页面

E 将照片、用户 Key、可选位置传给 D。只消费 D 的 `onStage` 和 `FinalReport`：
- PC：左侧照片主视觉、右侧风险与证据；移动端纵向。
- 证据分层：照片观察（C）、公开记录（B）、最终结论/局限（D）。
- `sourceType=synthetic` 显著标识“演示数据”；`score=null` 展示“证据不足”。
- 报告预览和浏览器导出；不自行调用 B/C，也不自拟评分。

## 6. F：验收

F 以真实浏览器检查：Mock 无 Key 演示、真实模型 CORS 可行性、同名消歧、照片 4 类观察、无法确定/全 unknown、断网/401/429/模型坏 JSON、取消、数据隐私、移动端、报告预览导出、静态部署。

**数据量要求**：B ≥15 条合法有出处资料或显著标注合成条目；C ≥30 张合法有标注样例或合成图；F 复核来源许可和性能统计，**不能虚构准确率或真实风险标签**。

## 7. 目录归属

| 路径 | 唯一负责人 |
|---|---|
| `src/evidence/` | B |
| `src/photo/` | C |
| `src/core/` | D |
| `src/ui/`, `src/styles/` | E |
| `tests/e2e/`, `.github/workflows/`, `docs/test-report.md` | F |
| `src/contracts/`, `docs/interfaces.md` | A（统一接口审查，不另设 Issue） |

单元测试放在各自模块下，主干 PR 由 A 审核，F 做回归。所有角色都参加最终 Demo 彩排与异常回归。
