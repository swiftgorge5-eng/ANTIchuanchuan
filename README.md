# 房小查（antochuanchuan）

**无需自建服务器的租房看房辅助网页：照片分析 + 小区历史问题查询 + 地图定位选点。**

打开网页 → 上传房源照片（可选小区标签）→ 浏览器直接调用用户自己的 DeepSeek Key（BYOK）做 4 类可见事实观察 → 也可以不出门先查小区历史记录、用高德地图确认小区位置。

照片不能证明甲醛含量、承重墙性质、房产所有权和合同真实性。本项目输出的是**可见现象与待核实事项**，不给可验证的“串串房概率”；风险指数未做校准，界面宁可留空。公开资料未匹配也不等于没有风险。

## 界面与集成方式

界面是队友 2026-11-08 交付的单文件前端（`房小查`），在本仓库拆成 `index.html` + `src/app/app.{css,js}` 维护，团队能力通过三个接缝接入：

| 接缝 | 实现 | 作用 |
|---|---|---|
| `window.HomeSafePhotoService` | [src/app/photo-service.ts](src/app/photo-service.ts) | 把照片交给仓库里的 C 模块（DeepSeek 视觉观察），转成报告页需要的“待核实事项 / 照片可见” |
| `window.HomeSafeCommunityService` | [src/app/community-service.ts](src/app/community-service.ts) | 「使用当前位置」：浏览器采样定位 → 坐标转换 → 高德周边住宅 POI，返回附近小区 |
| `window.HomeSafeLocationPicker` | [src/app/location-picker.ts](src/app/location-picker.ts) | 「定位找小区」「在地图上选点」：拖动地图、准星识别、定位回中、搜索小区 |

小区查询使用内置知识库 v8（1057 条具名历史记录，2026-11-07 整理），按名称与别名匹配，描述原文当时的情况。

## 五个开发任务（B–F）

| 岗位 | 负责人任务 | 输入 | 输出 | Issue |
|---|---|---|---|---|
| B 公开证据/RAG | 小区资料目录、同名消歧、来源管理 | 城市/区/小区名/地址线索 | EvidenceRetriever / EvidenceResult | [#3](../../issues/3) |
| C 照片分析 | 视觉模型、4 类观察、严格 JSON、错误处理 | D 预处理照片 + 用户模型 Key | PhotoObserver / PhotoObservationResult | [#4](../../issues/4) |
| D 流程与数据安全 | 图片处理、B/C 调度、未校准风险评分、报告合成 | E 的照片/Key/地点 + B/C 结果 | runAnalysis / FinalReport | [#5](../../issues/5) |
| E 前端与报告 | 上传、进度、证据分层、照片主视觉、报告导出 | 用户输入 + D 的进度/报告 | 响应式 H5 网站 | [#6](../../issues/6) |
| F 测试与交付 | 合法测试集、自动化测试、Bad Case、静态部署、Demo | B–E 的模块与样例 | 测试报告、说明书、Demo、ZIP | [#7](../../issues/7) |

**A 不单独占一个 Issue**，作为项目负责人统一维护接口、验收和 PR 审核。唯一数据结构规范：[docs/interfaces.md](docs/interfaces.md)。

## 关键边界

- **零自建服务器**：不允许 FastAPI、SQLite、云函数、图片中转上传、后台任务轮询。图片处理、证据检索在浏览器内完成。
- **模型联网**：真实照片分析会把图片发往 DeepSeek；需用户知情，并使用自己的 Key。页面内的 Key 只在本次打开期间保留在内存，不写入 localStorage、URL、日志或仓库。
- **定位联网**：只有用户主动点「定位」「在地图上选点」时才请求高德；照片、Key、地址线索不会发给高德。地图 Key 通过 `.env.local` 注入，靠域名白名单限制滥用。
- **公开证据**：资料要有来源；合成记录仅作显著标注的演示，不得假装真实。
- **不强行判断**：无法看到或来源不明时显示「无法判断」「未检索到」；风险指数未校准，默认不显示数字分数。

## 代码目录

```
index.html            # 新版单页入口（内嵌知识库 v8）
src/
  main.ts             # 启动：装好三个接缝再加载界面脚本
  app/
    app.js            # 队友的界面逻辑（渲染、路由、本机记录）
    app.css           # 队友的样式
    photo-service.ts  # C 模块 → 报告页
    community-service.ts
    location-picker.ts
    location-picker.css
  photo/              # C：观察器、provider、提示词、校验
  core/               # D：编排、预处理、报告规则与校验
  evidence/           # B：本地资料解析与检索
  ui/map/             # 高德加载、定位采样、逆地理编码
public/samples/       # 示例报告用图（从队友单文件里抽出来的）
docs/
  interfaces.md
  map-setup.md
```

## 本地运行

```powershell
npm install
npm run dev
```

浏览器打开终端给出的地址。`npm run build` 生成 `dist/` 静态文件。

- **照片分析**：点「上传房源照片分析」→ 选照片 →「开始分析」→ 在弹窗里填入自己的 DeepSeek Key。不填 Key 只会停在确认弹窗，不会读取照片。
- **小区标签**：可以手写任何文字（例如「仁美里 · 三楼朝南」），不要求是真实小区名；也可以点「使用当前位置」让最近的小区名自动填进标签，或「在地图上选点」用准星选一个位置。只要用过后两种方式，报告就会保存标签 + 坐标，之后从「看过的房」打开报告，点标签卡片就能在地图上回看这个位置与你写的标记。
- **地图**：复制 `.env.example` 为 `.env.local` 并填入 `VITE_AMAP_KEY` / `VITE_AMAP_SECURITY`，重启 `npm run dev`。Key 申请与白名单见 [docs/map-setup.md](docs/map-setup.md)。
- **没有 Key 也能演示**：示例报告（松庭里 / 巴黎花园）和小区历史查询都不需要任何 Key。

线上演示地址：https://swiftgorge5-eng.github.io/ANTIchuanchuan/ （`gh-pages` 分支，域名已加入高德白名单）。

## 进度说明

E 的新版界面、C 的真实视觉观察、B 的 v8 资料库、定位与地图选点均已接入；D 的编排与校验仍作为底层模块保留。端到端自动化测试与正式评测集仍在补。每个岗位在独立分支提交 PR，A 审核接口，F 负责回归。
