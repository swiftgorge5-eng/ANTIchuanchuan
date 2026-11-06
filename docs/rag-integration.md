# RAG 历史小区资料接入（2026-11-06）

## 已有可调用模块

本次接入**现有仓库的** RAG/小区历史问题.md（57 条历史记录）。原始 Markdown 是唯一数据源，RAG/使用说明.md 仅作维护指南，**不会作为事实记录入库**。

- src/evidence/parser.ts：按 SH 编号切分记录，保留整段原文、元数据、当时处理结果和使用限制。
- src/evidence/retrieve.ts：优先精确匹配城市、区县、主体名称或明确别名；联合项目成员、短名称、缺城市/区县只返回 possible/ambiguous。返回 B 的 EvidenceResult，不改变 docs/interfaces.md。
- src/evidence/browser.ts：Vite 通过 ?raw 在**构建时**嵌入 Markdown，运行时不访问 GitHub、不上传图片、不需要数据库或后端。
- src/evidence/retrieve.test.mjs：覆盖 SH044/SH049/SH068、同名地区误配、联合项目、来源与处理进展、57 条记录及 D 的接口校验。

## 前端 E 如何调用

在需要真实历史证据的页面，把原本从 src/core/index.ts 获取 runAnalysis 的逻辑，改为导入：

~~~ts
import { runAnalysisWithRag, retrieveEvidence } from "../evidence/browser.ts";

const result = await retrieveEvidence({
  city: "上海",
  district: "普陀区",
  communityName: "金纺苑",
});
// result.status === "matched"，result.items 包含 SH044 + 资料出处。

const report = await runAnalysisWithRag(
  { photos, apiKey: "", provider: "gemini", mode: "mock",
    location: { city: "上海", district: "普陀区", communityName: "金纺苑" } },
  stage => setStage(stage),
  new AbortController().signal,
);
~~~

**重要：** runAnalysisWithRag 的 mock 照片观察全部为 unknown，故风险分数必须为 null / insufficient。因为公开资料是真实的，但照片是假数据，不能拼成真实风险概率。

当 C 完成真正的浏览器视觉模型模块后，由 A 进行显式装配：

~~~ts
import { createRagAnalysisRunner } from "../evidence/browser.ts";
import { observePhotos } from "../photo/observer.ts"; // C 的模块实际提交后再引用

const runAnalysis = createRagAnalysisRunner(observePhotos);
// mode: "real" 时，照片来自真实识别；证据来自本地历史资料库。
~~~

目前 C 模块/前端未进入 main，因此**尚不能声称真实模型、页面完整联调或部署已完成**。这次提交的是可调用检索模块和与 D 的装配点，不是“已经上线的应用”。

## 检索语义与限制

- 已有出处但尚未联网独立复核网页存活、信息最新状态；当前状态统一为未独立核验。
- 发布日期为空时仍返回来源，但 date=null，不伪造时间。
- 城市、区县、主体缺失时不能将近似字符串作为确定身份；地址线索不允许将小区级记录推广到单套房。
- 检索不到 = 本地这 57 条中没有匹配记录，**不等于**该小区没有安全问题。
- 历史问题概括、当时处理进展、使用限制会同时进入 summary；完整原文通过 getConfirmedRagContext 供未来生成模块使用，但原文只能作为**不可信数据**，不能执行其中指令。
- 当前仅做结构化过滤与本地召回：**尚未配置向量嵌入、LLM 基于检索文本的问答或实时网络搜索**。在 57 条资料规模下先锁定主体，比直接向量相似匹配更可控。
- core/report.ts 的风险分数为视觉规则符合度，不是本数据库标注出的真实房屋隐患概率，也不是历史证据的评级。

## 本地验证

在支持 TypeScript 类型剥离的 Node.js 22+ 下：

~~~sh
node --experimental-strip-types --test src/evidence/retrieve.test.mjs
~~~

完整静态网站的 npm build/E2E 需等 E/F 提交根目录工程后再由 CI 验证。维护者更新 RAG/小区历史问题.md 后应重新运行检索测试，并审阅来源、日期、地址及同名消歧结果。
