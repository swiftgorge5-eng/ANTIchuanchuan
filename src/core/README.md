# D1–D4 浏览器核心模块

已实现 D1、D2、D3 和 D4，无真实模型调用。唯一规范为根目录 docs/interfaces.md。本目录之外的项目配置、A 的 src/contracts/ 和 B/C 实现均未创建或修改。D2 规则见 [报告规则](report-rules.md)，调度见 [调度说明](orchestration.md)，统一入口、JSON 导出和 A/B/C/E 接入见 [交付说明](integration.md)。

## 函数与接入

```ts
import { preprocessPhotos } from "./preprocess.ts";
import { toSafeError } from "./errors.ts";

const controller = new AbortController();
try {
  const prepared = await preprocessPhotos(files, { signal: controller.signal });
  // PreparedPhoto[]: { id, mimeType, data }，data 为无 data URL 前缀的 Base64。
  // 此处只交接数据，不会向第三方发送图片。
} catch (error) {
  const safe = toSafeError(error);
  // UI 只展示 safe.message；不要输出原异常、stack、请求对象或输入。
}
// 离开页面流程或用户取消时：controller.abort();
```

签名：`preprocessPhotos(files: File[], options?: PreprocessOptions): Promise<PreparedPhoto[]>`。数组不能为空；全部成功才返回整个批次，失败或取消不返回部分结果。逐张处理以控制峰值资源量。

ports.ts 仅定义与 B/C 文档完全相同的依赖函数，不调用模型、不启动调度：

```ts
import { selectPorts, createPhotoInput } from "./ports.ts";
const ports = selectPorts("mock", { mock: mockPorts });
const cInput = createPhotoInput(prepared, "mock", "", controller.signal);
// mock 选择不读取 real 端口，cInput.apiKey 始终为空。
// D2 提供纯报告合成；D3 已负责调用端口与流程调度。
```

types.internal.ts 是 D 私有过渡类型，字段复制自规范；不代表正式公共契约。A 初始化公共类型后，应替换这些导入，不在 B/C/E 复制另一份类型。

## D2 报告合成

```ts
import { composeReport } from "./report.ts";
const report = composeReport(photoResult, evidenceResult, "unknown");
```

同步纯函数，按运行时严格校验 B/C 输出，仅返回规范 FinalReport。无效结构通过 toSafeError 输出 INVALID_REPORT_INPUT；信息不足返回 score=null、level=insufficient。权重和阈值集中在 report-rules.ts，任何分数均为未校准的规则符合度，不是真实概率。函数不请求来源 URL、不调用模型，也不声称独立核验网页。

## 统一入口与 JSON 导出

E 从 src/core/index.ts 导入 runAnalysis、toSafeError、serializeReport、createReportBlob、downloadReport。内部工厂与 Mock 仍从对应内部模块导入，不通过生产 barrel 暴露测试辅助文件。

serializeReport 严格校验并只输出规范 FinalReport；createReportBlob 返回 UTF-8 JSON Blob；downloadReport 只在用户点击下载时显式调用，使用固定文件名和短期 Blob URL。不得在分析完成后自动下载。报告可能保留用户地点输入，不应声称完全匿名；下载前由 E 告知隐私属性。见 integration.md 的完整示例与限制。

## 默认规则

| 项目 | 默认值 |
| --- | --- |
| 输入 | JPEG、PNG、WebP；不使用文件名推断格式 |
| 数量 | 1–10 张 |
| 单张输入 | 最多 10 MiB |
| 解码前像素 | 最多 2500 万，单边最多 32768 |
| 输出长边 | 最多 2048，不放大原图，保持比例并四舍五入到整数像素 |
| 输出格式 | 请求 WebP，quality=0.85；不支持时允许 Canvas 实际回退 PNG |
| 单张输出 | 最多 3 MiB，按二进制 Blob 大小检查；Base64 还会增大约三分之一 |
| ID | crypto.randomUUID，与名称、路径无关 |

调用方可以用 PreprocessOptions 调整限额、输出格式和质量。整数限额必须为正整数，质量为 (0,1]。默认支持透明度；请求 JPEG 时明确铺白底。Canvas 是常规浏览器颜色/位深管线，不是原始图像保真或鉴定副本。

## 校验与元数据边界

文件 MIME 必须在白名单，并与实际文件头一致。先检查 PNG chunk/JPEG segment/WebP RIFF 边界和尺寸，再交给 createImageBitmap 真实解码，检查解码尺寸及像素数。允许浏览器按 EXIF 等方向信息解码后宽高交换。动画 PNG/WebP 明确拒绝，避免静默选取首帧。

文件头检查不是完整格式解码器：不负责 PNG 全部 CRC/压缩流校验、JPEG 熵编码验证或 WebP bitstream 验证。真正解码由浏览器完成；不同浏览器可能容忍部分损坏图片，因此不能承诺拒绝所有可被浏览器修复的损坏文件。解码前的尺寸限制用于降低风险，不能作为浏览器解码器的安全隔离。

输出只来自新建 Canvas 的像素重新编码，原文件不直接交付。额外拒绝输出中检测到的常见 PNG EXIF/文本、JPEG EXIF/IPTC/注释、WebP EXIF/XMP 元数据标志。该检查并非任意元数据清除的形式化保证（例如厂商私有字段、色彩描述信息或 JPEG 非典型扫描后段），也无法移除照片画面中可见的地址、人脸或水印。

EXIF 方向、颜色空间、透明度、ICC 和浏览器编码器行为仍需真实浏览器核验。当前不承诺跨浏览器完全一致的像素或体积，也不宣称恢复或保留原图全部细节。若输出仍超过限额，返回受控错误，不无限重试或静默提高压缩强度。

## 取消与资源

支持文件读取、解码、编码和批次之间取消。不反射 AbortSignal.reason。原生 arrayBuffer/createImageBitmap/Canvas 编码操作通常无法真正中断；本函数停止等待并丢弃结果，迟到的 ImageBitmap 会 close。成功、失败和取消均关闭已取得的位图，并将 Canvas 尺寸归零；移除注册的 abort 监听器。

不使用 Object URL，因此没有原图 URL 的创建与回收。不写磁盘、浏览器存储或全局图片缓存。返回的 Base64 和调用方原 File 引用由调用方释放；JavaScript GC 和不可变字符串不提供可靠清零保证。同步容器检查、Canvas 绘制等会短暂占用线程，取消只能在事件循环有机会处理后生效。

## Key 与错误

security.ts 的 modelKeyForCall 只返回本次调用值，不缓存。mock 模式始终返回空 Key，且 selectPorts 不访问 real 端口。D1 不包含任何模型适配器或联网代码；注入的第三方端口代码仍需独立审查，不能通过类型约束阻止恶意端口自行联网。

Key 不得写入 localStorage、sessionStorage、IndexedDB、URL、console、报告或仓库。不要 stringify PhotoInput/AnalysisInput。CoreError 只接受受控错误码，toSafeError 只输出固定 code/message，不复制异常文本、cause、stack、文件名、路径或 Base64。未知异常统一为 UNKNOWN_ERROR。原 Error.stack 是调试对象，不可作为 UI/日志响应使用。

真实模式的图片发送告知由 E 在调用模型前完成；本模块不发送图片，也不把调用方“有 Key”视为用户已同意发送。

## 轻量测试

无需安装依赖或根目录工程，使用 Node 24 原生 TypeScript 类型擦除和 node:test：

```powershell
node --test src/core/*.test.mjs
```

Node 的类型擦除不进行类型检查。可独立运行下列只读检查（npm exec 的工具位于 npm 缓存，不创建本项目 package.json/node_modules）：

```powershell
$sources = @(Get-ChildItem -LiteralPath src/core -Filter *.ts -File | ForEach-Object { $_.FullName }) + @(Get-ChildItem -LiteralPath src/core/adapters -Filter *.ts -File | ForEach-Object { $_.FullName })
npm.cmd exec --yes --package typescript@7.0.2 -- tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --allowImportingTsExtensions @sources
```

test-fixtures.mjs 是一次性生成的 4×2 JPEG/PNG/WebP 合成小图和带测试 EXIF 的 JPEG，无真实用户数据；生成器使用环境自带 Pillow，不是运行或测试依赖。test-browser.mjs 中的替身只模拟位图尺寸、Canvas 输出和释放行为，不实际解码输入或渲染像素。Node 测试通过不能代表浏览器图片解码、压缩质量、EXIF/GPS 清理或内存回收已实测通过。

2026-11-03 实测：Node v24.19.0，37 项测试通过、0 失败、0 跳过；TypeScript 7.0.2 使用上述 strict/noEmit 参数检查通过。没有运行真实浏览器测试。

D2 完成后全量复测：D1 37 项 + D2 52 项，共 89 项通过、0 失败、0 跳过；包含 report 源码的 TypeScript 7.0.2 strict/noEmit 检查通过。D2 测试为离线纯规则与运行时校验测试，不代表进行了真实来源或住房风险核验。

D3 完成后全量复测：D1+D2 89 项 + D3 43 项，共 132 项通过、0 失败、0 跳过；全部源码（含 adapters）TypeScript 7.0.2 strict/noEmit 检查通过。D3 使用手动时钟和 Node 浏览器替身，无真实模型/网络/浏览器测试。

D4 完成后全量复测：既有 132 项 + D4/核心集成 41 项，共 173 项通过、0 失败、0 跳过；全部 15 个生产 TypeScript 文件 strict/noEmit 检查通过。JSON 往返、UTF-8 Blob、固定文件名及 URL 回收均为 Node/DOM 替身验证，真实浏览器下载仍待联调；未执行不存在的根目录网页构建。

真实浏览器待验证：Chrome/Edge/Firefox/Safari 和移动端的 createImageBitmap/Canvas 编码支持，EXIF 八种方向、透明 WebP/PNG、色彩与位深、输出副本元数据实查、大图峰值内存、页面取消响应，以及静态 HTTPS 环境下 crypto.randomUUID。缺少 createImageBitmap、可用 Canvas 或 randomUUID 时返回 BROWSER_UNSUPPORTED；不采用会联网的降级方案。

## A 初始化工程后的接入

将本目录的临时类型改为 A 公共 contracts 导入；把单元测试接入团队统一脚本，并处理 .ts 导入后缀与正式 TypeScript/Vite 配置。保持测试专用 .mjs helper 不进入生产入口。再由 F 加入真实浏览器用例。默认 runAnalysis 只接 D 自有 Mock，A 后续通过 createAnalysisRunner 注入 B/C real 端口，E 继续消费相同三参数入口，并从统一入口调用 D4 导出。根目录工程尚不存在，不能宣称项目网页或构建已通过。
