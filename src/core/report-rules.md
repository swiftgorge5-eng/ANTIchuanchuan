# D2 V0.1 确定性报告规则

2026-11-03。该版本是待 A 评审的原型，不是住房安全鉴定、违法认定或真实风险概率模型。唯一公共字段规范仍为 docs/interfaces.md；未增加公共字段，未修改 A/B/C/E/F 模块。

## 入口

```ts
composeReport(
  photoResult: PhotoObservationResult,
  evidenceResult: EvidenceResult,
  rentalMode?: "whole" | "shared" | "unknown"
): FinalReport
```

同步纯函数；不调用模型、网络、浏览器存储、日志或当前时钟。仅使用参数，生成深度独立的新对象；既不修改输入，也不把额外字段透传到报告。同样数据得到同样报告，观察及条目按稳定顺序展示。

返回且仅返回 status/risk/observations/evidence/limitations/rentalMode；risk 仅含 score/level/calibrated/explanation。status="success" 表示成功完成报告合成，不表示完成真实模型执行或来源核验。无效结构抛出 CoreError(INVALID_REPORT_INPUT)，由 toSafeError 转为固定安全信息，不复制原始输入或校验堆栈。

## 类型和运行时校验

当前 main 尚无 src/contracts/，继续在 types.internal.ts 添加与规范一致的 RiskAssessment、FinalReport，等待 A 公共类型替换。

检查对象必填/未知字段、C schema_version=1、四个观察类别、三种状态、非空规范 ID、字符串 evidence 数组、B 的状态/来源/匹配枚举及日期。拒绝数值冒充文本、NaN/Infinity、稀疏数组、访问器和非普通 JSON 对象。可选 query 字段可省略，不接受显式 undefined；字段文本裁剪首尾空白。

单次最多 200 条观察、100 条来源、每条 20 个理由；通常文本最多 1000 字符，query 字段 120 字符，ID 80 字符。ID 采用字母数字开头，随后仅字母数字、下划线和连字符。Date 接受合法 YYYY-MM-DD 或有时区的 ISO 时间。所有这些为 D 的暂定防御性校验边界，需与 A/B/C 联调。

public URL 必须是绝对 HTTPS URL；缺失、HTTP、含凭据/fragment、本地/数字 IP 目标、敏感查询参数及明显携带密钥/图片/路径的字符串会拒绝。合法普通查询参数允许。不请求 URL、不解析 DNS、不核验发布者或网页内容，合法 URL 不等于真实可信网页。synthetic URL 可以为 null；非 null 时采用相同 URL 校验。

敏感字符串检查拦截常见 Key 标识、data URL/长 Base64、控制/标记字符和常见本地路径。它不能识别任意短字符串是否是秘密；调用方仍不得将 Key 或个人材料放入任何 B/C 文本字段。未知字段直接拒绝，绝不静默复制 apiKey、data、file 等额外属性。

C 的理由必须描述可见事实；含甲醛、产权、承重墙、违法/违规等超出视觉事实范围的受限术语会被拒绝，避免把推断当作视觉结论。该保守词表不是完整语义事实核验；E 必须按来源分层展示 B 的上游摘要，不将其作为 D 的独立证实或自行生成住房风险指控。

## 数字分数门槛

以下条件必须全部满足：

1. C 至少返回观察；四个类别全部有非 unknown 状态和至少一条非空具体理由。
2. 去重后的所有观察均非 unknown，所有明确观察均有理由。即使其他照片覆盖完整，仍有 unknown 时也返回 null，此为保守原型策略。
3. B status=matched；query.city 和 query.communityName 非空。
4. 至少一个 public、confirmed 条目与 query.communityName 一致，并且 title/publisher/summary/date 信息完整，URL 通过结构校验。
5. 没有 confirmed public 条目指向其他小区。名称比较采用 NFKC 后精确比较，不模糊匹配或自行消歧。

这些是“上游声明和输入完整性门槛”，不是 D 已验证真实来源。B 的 EvidenceItem 没有独立 city/district 字段，D 无法再次核实地址对应；也无法由 photoId 判断是否真的来自不同原图。本函数不要求多张照片，以免靠复制并重命名 photoId 增加所谓覆盖度；也不证明单张照片能覆盖整套住房。

## score=null 的条件

无观察、全部 unknown、任何部分 unknown、缺少类别、明确观察缺少理由、小区 ambiguous、无匹配/无条目、缺少城市或小区、无 public 条目、仅 synthetic、公开条目仅 possible、confirmed 小区不一致，或没有信息完整的 confirmed public 条目时，输出 score=null、level=insufficient、calibrated=false。

日期在接口中允许 null，但本原型将未知日期视为来源信息不足，不能满足数字门槛。title/publisher/summary 的空字符串是信息不足，不假装完整。非法结构（例如 public URL 缺失/非法、日期格式错、枚举错）返回受控错误，而不是伪造不足报告。no_match 却带条目视为结构语义冲突并拒绝。

## 计分、类别语义和阈值

配置集中于 report-rules.ts，冻结对象防止运行中修改。仅在上述门槛满足后计算：

| 类别 | present 的分值（满分 100） | 理由与边界 |
| --- | --- | --- |
| renovation_trace | 35 | 装修痕迹值得进一步询问，但可能完全正常 |
| partition_trace | 40 | 分隔痕迹作为核查提示，不证明违法或承重性质 |
| moisture_trace | 25 | 潮湿可见痕迹需要核查，不证明漏点、健康影响或责任 |
| daylight_cue | 0 | 规范未说明“采光线索”的正负方向，不能把 present 自动解释为采光差 |

每类最多贡献一次，score = 各类 present 分值之和 / 100，范围 0–1。absent 贡献 0，仅表示相关区域清晰可见但未见迹象；unknown 不进入数值计算。daylight_cue 虽暂不加分，仍要求有明确观察以满足四类覆盖门槛。

low: score < 0.35；medium: 0.35 ≤ score < 0.65；high: score ≥ 0.65。这是规则提示强度，不是房屋危险/安全等级。权重和阈值是人工原型参数，没有训练、标注统计或概率校准依据；所有输出 calibrated=false。即使 score=0、level=low，也不表示零风险或房屋安全。公开条目不按数量、文本情绪或主张额外加分；rentalMode 仅原样保留，不改变分数。

## 去重与冲突

同一 photoId/category/state 合并并去重理由；同一 photoId/category 有不同 state 则拒绝输入。不同照片有 present/absent 可以并存，present 表示至少一处有迹象，并不否定另一张照片的局部 absent。复制照片或新增重复观察不增加某类分值。

同 evidence.id 的完全一致条目去重；同 ID 内容冲突则拒绝。不同 ID 但相同 URL 不增加分数，因为来源只作为门槛，不按数量计算。无法检测更换 ID 后是否同一原图或同一资料，报告不会声称做了图像/网页内容去重。

## 说明与演示边界

explanation 列出实际类别贡献、合计和阈值；不足时给出所有适用的固定原因。不引用任意输入文本生成诊断或指控。

limitations 始终覆盖甲醛、结构安全、产权/合同、无资料不代表无风险、未校准、来源未独立核验。出现 synthetic 时额外明确标注“合成演示数据”，保留 sourceType，不计作公开门槛。混合存在合格 public 与 synthetic 时可计算，但合成条目仍显著披露。

测试中使用 example.test 域名、合成小区和 sourceType=public 仅模拟 B 的声明以验证规则分支，绝不表示真实公开记录。测试不联网，也不虚构真实住房标签或准确率。

## 待 A 确认

权重 35/40/25/0、阈值 0.35/0.65、daylight_cue 方向、四类完整覆盖且禁止任何 unknown 的门槛、日期必需性、名称比较、文本长度/ID/URL 约束、C 受限术语和冲突拒绝策略。未来通过兼容扩展和显式版本评审调整，不修改现有公共字段。本次未实现 D3 调度、模型/网络调用或报告导出。
