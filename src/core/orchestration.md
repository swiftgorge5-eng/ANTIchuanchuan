# D3 浏览器内任务调度

本模块只调度本地函数，不创建服务器、task_id、轮询或持久化队列。唯一公共数据契约是 docs/interfaces.md；现阶段 A 尚无正式 contracts，类型暂置于 types.internal.ts。不调用真实模型、不抓取网页，不实现 D4 导出。

## E 的调用方式

```ts
import { runAnalysis } from "./orchestrator.ts";
import { toSafeError } from "./errors.ts";

const controller = new AbortController();
try {
  const report = await runAnalysis({
    photos: selectedFiles, apiKey: "", provider: "gemini", mode: "mock",
    location: { city: "示例城市", communityName: "合成演示小区" }, rentalMode: "unknown",
  }, stage => updateStage(stage), controller.signal);
  // report.status="success"，默认演示 risk.score=null、level="insufficient"。
  showReport(report);
} catch (error) {
  const safe = toSafeError(error);
  showMessage(safe.message); // 不输出原 Error、stack、输入或 signal.reason。
}
// 取消按钮/离开当前分析流程：controller.abort();
```

签名保持三个参数：`runAnalysis(input: AnalysisInput, onStage: (stage: AnalysisStage) => void, signal: AbortSignal): Promise<FinalReport>`。Mock 无需真实 Key，但 apiKey 字段仍按接口传空字符串。回调参数只有阶段名；idle 是 E 的初始页面状态，本函数不额外发送 idle。

E 应为每次调用新建 AbortController。并发运行相互独立；若页面只展示最新任务，由 E 取消旧调用并防止旧 UI 回调覆盖新页面。D 不缓存 Key 或跨任务可变状态。

## 阶段与终态

正常顺序为 preparing → observing → retrieving → composing → success。分别复用 D1 preprocessPhotos、C 端口、B 端口、D2 composeReport。B/C 顺序执行，不并发触发模型和检索。

输入错误或适配器缺失在 preparing 前发送 error 并拒绝 Promise。运行阶段失败发送唯一 error；用户取消发送唯一 cancelled 并拒绝 CANCELLED；超时发送 error 并拒绝 TIMEOUT。没有部分成功报告。risk.score=null 的合法不足报告仍走 success，不是调度失败。

每次阶段回调后重新检查取消和时限，因此在 preparing/observing/retrieving/composing 回调里取消不会再进入下一阶段。回调是通知观察者：同步抛错或返回拒绝的 Promise 均被隔离，不重试、不记日志、不改变分析结果。

成功提交点在 success 回调前：最后检查取消/期限，结束计时和取消监听，再发送 success。success 回调中或之后的取消视为任务完成后的取消，不撤销已提交结果。失败终态回调同样不能改变已选定的终态。不要依靠回调异常取消任务，应调用 controller.abort()。

## 内部依赖注入

```ts
import { createAnalysisRunner } from "./orchestrator.ts";
import { createMockPorts } from "./adapters/mock.ts";

const runner = createAnalysisRunner({ mock: createMockPorts({ scenario: "unknown" }) });
const report = await runner(input, onStage, signal);
```

工厂参数为 `{ mock: CorePorts; real?: CorePorts }`，第二个可选参数 RunnerOptions 提供 preprocess、timeouts、clock 测试替身；返回的 runner 仍是相同三个参数接口。工厂配置不属于公共 AnalysisInput，不新增团队约定字段。

CorePorts.retrieveEvidence(LocationQuery) 返回 EvidenceResult；observePhotos(PhotoInput) 返回 PhotoObservationResult。C 获得本次组合取消信号及处理后的副本；B 的正式接口不含 signal，调用签名不擅自扩展。

默认公开 runAnalysis 仅装配 D 自有 Mock，没有导入不存在的 B/C 文件。real 无适配器时返回 ADAPTER_UNAVAILABLE，不自动回退模拟数据。未来 A 在应用装配处通过工厂注入 B/C real 端口，并将配置后的相同签名 runner 交给 E；无需新增全局可变注册器或 Key 缓存。真实端口存在时仍要求本次 Key 非空，默认不重试。

## Mock 场景

createMockPorts 支持 standard、unknown、ambiguous、no_sources、synthetic。states 可指定四类观察的 present/absent/unknown 组合；所有观察均标注合成演示，全部证据严格使用 synthetic、url=null，不伪造 public。默认场景具备完整流程，但因不具备真实公开来源而为 insufficient。

failAt 可指定 observing/retrieving 模拟失败，返回受控 MOCK_FAILURE。waitFor(stage) 是可注入异步闸门，可由测试手动 resolve/reject，模拟延迟或迟到结果；ignoreObserverAbort 仅用于模拟不合作的 C。Mock 不读取真实模型配置、Key、网络或存储，也不创建定时器。闸门若由调用方自己创建定时器，其生命周期由调用方负责。

## 超时、取消与资源

参数集中在 orchestration-config.ts，均为 V0.1 暂定：

| 预算 | 默认值 |
| --- | --- |
| preparing | 15 秒 |
| observing | 30 秒 |
| retrieving | 10 秒 |
| 整个任务 | 60 秒 |
| 自动重试 | 0 次 |

内部工厂可调整四个正数时限（最多 300 秒）；不提供无限等待或真实模型自动重试。总预算在输入、端口和 Key 验证完成后开始，包含阶段回调、等待和 composing；分阶段预算包含对应阶段回调。输入验证是同步且有规模上限的操作。使用单调时钟，并在工作完成/成功前检查绝对截止时间，防止后台页面计时器延迟导致过期成功。

取消/超时中首先生效的事件固定原因，不被之后事件覆盖。停止等待后不会启动下一阶段；C/预处理收到内部 AbortSignal，原始用户 reason 不转发。用户取消与 TIMEOUT 明确区分。原生解码/编码或任意第三方 Promise 无法保证真正中断；D1 会在迟到位图完成后 close。

B 不接收 signal，所以取消只停止等待并忽略迟到结果，不能宣称已经中断 B 的内部工作。所有工作 Promise 在启动前即建立成功/失败处理，取消或超时后迟到拒绝被消费，避免 unhandled rejection。第三方端口必须自己释放其内部资源；调度器无法清理不合作端口隐藏的网络/定时器。

调度器每条完成路径均清理自身总计时器、阶段计时器和用户 abort 监听器；失败时也 abort 内部信号。没有 Object URL 或图片持久化。返回字符串和未完成第三方任务所持引用不能可靠清零，不能把 JS 垃圾回收当作秘密擦除机制。

同步图片处理和报告合成不能被事件循环强制抢占；在回到调度器时检查截止时间。页面冻结/浏览器暂停期间不承诺实时终态通知。若上游永远不响应取消，其 Promise 的内部工作可能继续，但本任务已结束且不启动重试或新并行任务。

## 数据验证与安全

AnalysisInput 只接受约定字段、普通数据对象和本页面 File[]；复用 D1 图片校验及 D2 地点安全规则。预处理交接检查数量、ID 唯一性、MIME、纯 Base64 和体积。C 结果在进入 B 前由 D2 校验，photoId 必须属于本次预处理；B 返回的已有查询字段必须与本次地点一致。给端口的照片元数据/地点对象采用副本，避免端口修改调用方数据绕过关联检查。

Key 只在当前调用链中使用，Mock 传给 C 的 Key 始终为空。受控错误不携带输入、照片、路径或 provider 原始消息。对经过结构验证的 B/C/报告，额外拒绝包含本次已知 Key 或照片完整 Base64 的字符串；非常短的 Key 可能造成保守误拒，真实供应商 Key 应按正式规则使用。D2 的敏感文本校验仍生效，不能依赖关键词识别所有未知秘密。

不保存 localStorage/sessionStorage/IndexedDB，不在阶段回调、日志、URL 或报告附加 Key/照片。E 必须在未来真实模型调用前独立显示第三方图片发送告知；有 Key 不等于用户已同意发送。

## 测试与待验证项

Node 单元测试用手动时钟、延迟闸门和浏览器 API 替身，无网络或长时间等待。覆盖全部阶段、取消/超时、迟到成功/失败、输入与 B/C 结构异常、跨照片/地点关联、并发隔离、回调异常、已知秘密泄露及清理。D1 集成测试检查调度超时后迟到位图释放。测试结果不代表真实浏览器或真实模型/CORS 已验证。

仍待 F/A/B/C/E 联调：正式公共类型与模块入口、真实 C 的 AbortSignal 和资源释放行为、B 的不可中断限制、页面生命周期/移动端后台计时、真实图片处理质量、供应商 CORS 与授权告知。超时预算、回调隔离和成功提交语义需 A 评审。本次没有实现 D4 JSON 导出。
