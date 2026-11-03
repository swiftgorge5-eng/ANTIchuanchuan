# D 核心模块交付与团队对接

2026-11-03，D1–D4。唯一公共字段规范为 docs/interfaces.md。本目录实现浏览器预处理、纯规则报告、任务调度、Mock 和 JSON 导出，没有服务器、数据库、任务轮询、真实模型请求或网页检索。现阶段 main 尚无根目录工程和公共 contracts，不能据此宣称网页已可运行或部署。

## 稳定入口

E 从 src/core/index.ts 导入：runAnalysis、toSafeError、serializeReport、createReportBlob、downloadReport；类型导出 AnalysisInput、AnalysisStage、FinalReport、RiskAssessment。不从该入口导出工厂、Mock 或任何 test-browser/test-fixtures 辅助代码。

```ts
import { runAnalysis, toSafeError, downloadReport } from "./core/index.ts";
import type { FinalReport } from "./core/index.ts";

let displayedReport: FinalReport | undefined; // 页面持有，离开流程时释放。
const controller = new AbortController();
try {
  displayedReport = await runAnalysis({
    photos: selectedFiles, apiKey: "", provider: "gemini", mode: "mock",
    location: { city: "示例城市", communityName: "合成演示小区" }, rentalMode: "unknown",
  }, stage => updateStage(stage), controller.signal);
  renderReport(displayedReport); // 使用文本渲染，不将上游文本写入 innerHTML。
} catch (error) {
  const safe = toSafeError(error);
  showMessage(safe.message);
}

// E 将下列函数绑定到真实的“下载 JSON”按钮，而不是分析完成自动调用。
function onDownloadClick() {
  if (!displayedReport) return;
  // 在调用前显示隐私提醒/必要确认：文件可能含城市、小区、用户地址线索。
  try { downloadReport(displayedReport); }
  catch (error) { showMessage(toSafeError(error).message); }
}
// 用户取消/离开当前流程：controller.abort(); displayedReport = undefined;
```

页面应用保留报告是 E 的短期 UI 状态，不是 D 的模块级缓存。E 不应将 Key/照片/报告自动写入浏览器持久存储。JS 字符串不能保证安全清零。

## A：公共类型与应用装配

types.internal.ts 当前明确为 D 私有过渡类型，字段与 docs/interfaces.md 对齐；A 建立公共 contracts 后，替换 D 的类型导入并加入团队类型检查，不修改字段名称。index.ts 的类型导出也随之改为正式来源。不要把临时类型视作 A 已批准的新规范。

真实模块的装配仅在 A 确认接口和用户告知流程后进行。以下是内部集成方式，不是新增的 E 公开参数：

```ts
import { createAnalysisRunner } from "./core/orchestrator.ts";
import { createMockPorts } from "./core/adapters/mock.ts";

const configuredRunAnalysis = createAnalysisRunner({
  mock: createMockPorts(),
  real: { retrieveEvidence: bRetrieveEvidence, observePhotos: cObservePhotos },
});
// 仍以 (input, onStage, signal) 调用；应用通过显式导入提供给 E。
// 默认 core/index.ts 的 runAnalysis 不会自动探测、导入或启用这些真实模块。
```

createAnalysisRunner、Mock 与注入时钟是内部/测试扩展点，不能在 AnalysisInput 增加 ports、timeout 或测试标记。默认入口 real 未接入时明确返回 ADAPTER_UNAVAILABLE。

待 A 评审：35/40/25/0 权重、0.35/0.65 阈值、daylight_cue 的正负方向、禁止任何 unknown 的保守评分门槛、日期必需性、ID/URL/文本限制、受控错误码、15/30/10/60 秒时限、回调异常隔离和成功提交语义。详见 report-rules.md 与 orchestration.md。

## B：公开证据端口

retrieveEvidence(LocationQuery): Promise<EvidenceResult>。查询包括可选 city/district/communityName/addressHint；结果必须携带 query，D 会检查原本非空的字段未被替换。不得将同名不同地点资料静默合并。

status 仅 matched/ambiguous/no_match；sourceType 仅 public/synthetic；matchStatus 仅 confirmed/possible。no_match 的 items 必须为空。public 必须有通过 D 安全校验的绝对 HTTPS URL；synthetic 可为 null，必须明确合成演示性质。unknown 日期可以为 null，但不能满足 D 当前数字分数门槛。

ambiguous、无资料、仅 possible 或仅 synthetic 会得到不足报告，不等于系统故障或安全结论。D 不访问 URL，不把 B 的 public/confirmed 声明视作 D 已独立核实网页。来源合法性、真实性与地点消歧仍由 B/F 实际验证。

B 的现有接口没有 AbortSignal。任务取消/超时后 D 停止等待并消费迟到结果/拒绝，不能声称已中断 B 内部操作。若需真实中断，先由 A 审核兼容扩展。

## C：照片观察端口

observePhotos(PhotoInput): Promise<PhotoObservationResult>。PreparedPhoto 仅含 id/mimeType/data；data 是纯 Base64，不带 data URL 前缀。不要假定输出总是原图 MIME：D1 默认请求 WebP，浏览器可能回退 PNG。服务器文件路径、原始文件名、Key 均不在 PreparedPhoto 中。

C 接收本次 signal、provider="gemini" 和本次调用 Key；Mock Key 恒为空。必须复用输入 photoId，schema_version=1，四类合法 category，present/absent/unknown 及具体可见理由数组。不能把照片无法判断的情况标 absent，不能给分或输出甲醛/违法/产权诊断。

C 应把 signal 传给实际模型请求并清理自身资源，不应记录 PhotoInput、Key、Base64 或供应商原始错误。D 不自动重试真实模型请求，避免重复费用/图片发送。C 内部忽略 signal 的工作无法由 D 强制结束，但迟到结果不会改变任务终态。

## E：状态、报告和隐私

正常阶段为 preparing → observing → retrieving → composing → success。idle 是页面初态。onStage 只传阶段字符串；回调抛错/异步拒绝被隔离。取消通过 AbortController，不通过抛 UI 异常。

任务成功表示完成报告合成。score=null、level=insufficient 是正常 success，必须展示“证据不足”，不能显示零风险。calibrated=false 表明未校准；synthetic 要显著标记“演示数据”。照片观察、上游公开声明、规则解释应分层展示，不把规则强度说成房屋安全等级。

取消对应 cancelled/CANCELLED；超时为 error/TIMEOUT；适配器缺失为 ADAPTER_UNAVAILABLE；未知异常通过 toSafeError 固定输出。不得输出原 Error.stack/cause、AbortSignal.reason 或完整输入对象。用户在 success 提交后取消不撤销已完成结果。取消后不返回部分成功报告。

真实模型发送前必须告知照片将直接发送选定第三方，并由 E 完成适当授权/确认；有 Key 不等于已同意发送。当前 Mock 从不发送图片，真实供应商/CORS 尚未验证。

## JSON 导出

serializeReport(report: FinalReport): string 为纯函数，输出格式化 JSON 文本。createReportBlob(report) 编码为 application/json;charset=utf-8 的 UTF-8 Blob，不创建 URL、不下载。downloadReport(report) 仅由 E 的用户下载动作调用；分析完成、模块导入或 serializeReport 均不会自动下载。

导出先校验完整 FinalReport，拒绝未知字段、toJSON/访问器、非法数值、校准标记、常见秘密/图片/本地路径标记等。复用 D2 B/C 校验器，并复核当前 D2 规则的 score/level 与必要 limitations；不重写原分数或解释，不把缺失警示静默补回。导出当前不是通用的任意历史/外部报告迁移器；未来规则版本变更须由 A 调整兼容策略。数学阈值说明中的 < 和 >= 可以保留，HTML 标签不能借此透传。

只投影规范字段，保留 null、false、sourceType 和合法的地点信息。不接收 Key/照片参数，也不读取任何全局 Key。普通短文本是否秘密无法靠类型或关键词完整判定；调用方不得将凭据放入合法的说明字段。D3 对本次已知 Key 和原图 Base64 还有额外回显检查。

下载名固定为 antochuanchuan-report.json，不使用用户照片名称、小区、地址或任意路径。辅助函数创建短期 Blob URL，点击后移除临时 anchor，并在 1 秒后尽力 revoke；创建/点击失败立即回收，计时器创建失败则立即回收。该延迟需 F 在真实浏览器，尤其 Safari/移动端，验证是否足够；系统或浏览器仍可阻止下载。URL 回收并不撤销已经保存的本地文件。

导出文件可能包含城市、小区、addressHint 和 B/C 文本，**不是完全匿名文件**。E 应在下载前说明文件的隐私属性和分享风险，不应默认导出或自动上传；导出文件由用户自行保管。没有服务器传输和 localStorage/sessionStorage/IndexedDB 写入。

## 集成验证与交付边界

本目录的 integration.test.mjs 使用程序生成照片、真实 D1/D2/D3/D4 代码以及 Node 浏览器 API 替身和 D Mock。验证链路为 File[] → PreparedPhoto[] → C Mock → B Mock → FinalReport → JSON → 反序列化等值，包括不足报告、unknown、synthetic、no_match、ambiguous、非法 C、取消、各阶段超时和多次运行隔离。export.test.mjs 检查 UTF-8、字段校验、固定文件名、点击失败与 Blob URL 回收。测试从不调用真实模型或网络。

这属于 D 核心集成验证，不是 F 的真实浏览器前端 E2E。仍待验证：真实图片解码/压缩和 EXIF/GPS、跨浏览器下载/Blob URL 时机、页面后台与取消响应、真实 B/C 模块、模型鉴权/CORS、E 移动端展示与用户告知、完整静态工程测试和构建。A 提供根目录工程后再接入统一命令；目前未创建根工程，也未声称网页可运行。

代码达到提交 D 模块供 A 审查的范围；接口参数、规则原型和上述浏览器/真实模块验收仍需团队确认，不代表整个项目可上线。本次未自动提交、推送或创建 PR。
