# PR #182 独立设计审查

- Outcome: `REQUEST_CHANGES`
- Reviewed SHA: `d7c72b76c7527dc76ea923cdd098f01057a3c233`
- 日期：2026-09-12
- 范围：Issue #181、PR 的五份设计文档、共享 CanonicalJson/Envelope 契约与现有 PayloadGuard 实现。未修改产品代码或参数。

## R1 — P2：字符串上限的依据与实际拒绝边界不符

位置：`Module-Spec-001-IdentityPolicy.md:350`（并影响参数表与字符串边界场景）。

262144 字节上限不能推出任一字符串小于 16384 code point。直接调用当前 `payloadGuardErrors`，使用提案七项参数，输入 `{payload:{policyDocument:{text:'a'.repeat(n)}}}`：n=16384 时总计 16426 字节、Guard 通过；n=16385 时总计 16427 字节、Guard 在 `/payload/policyDocument/text` 返回 `maxStringCodePoints=16384`。两者都远低于字节预算，且仅改变字符串长度。此探针只验证 Guard，不冒充尚未注册操作或 consumer profile 的合法业务 fixture。

因此“该维度不会成为实际拒绝原因、只在缺失字节预算时兜底”的依据不成立。IdentityPolicy 不负责 consumer 的 closed profile 字段语义，不能用四个小样本代替该资源边界的论证。请明确这是独立且可能先触发的限制，说明保留该数值的设计依据，补充 16384/16385 的单变量场景，并同步修正所有“不影响预算内文档”的承诺；不要求直接增大参数。

## R2 — P2：读回保证依赖错误的编码模型和未经覆盖的固定开销

位置：`Module-Spec-001-IdentityPolicy.md:403`，关联 §13.3.1、共享 API #181 方案及 `IP-181-C-002`。

共享 API §2 定义 CanonicalJson 为 JSON value；§13.3 的写入和结果都使用该类型。相同文档在请求和结果中均内联为 JSON 值，不存在“请求为转义 JSON 字符串、结果为解析值”的编码差别。当前 Guard 逐节点计量，两边的同一字符串叶子使用相同 JSON 编码。含引号、反斜杠和换行的直接计量对照也表明，相同文档贡献相同字节数，增加转义字符不会单独扩大请求端。

2388/1387 是所选包装的样本，不能直接成为所有合法请求/结果的固定项：`supersedesRef`、Envelope 可选字段、Enterprise/Project Scope、`policySchemaRefs` 集合和结果生命周期观察均须纳入推导。特别是省略请求的可选 `supersedesRef` 就会改变差额；现有文字未给出完整样本或逐字段算式来复算固定项。`maxResultBytes >= maxEnvelopeBytes` 本身也不能证明任意两种包装之间的大小关系。

请按同一 JSON-value 编码模型，给出完整可复核样本或逐字段计算，比较最小合法请求包装与最大合法结果包装（包括后续出现的 supersededAt/useStatus），证明所有合法输入的安全差额，再修正恒定/至少 1001 字节的断言及测试预期。此发现不声称已复现实际 API“写得进读不回”；它指出 Issue #181 要求的普遍读回保证尚未被当前推导证明。无需预先假定必须改变参数或引入分页。

## 验证与未运行边界

- 已读取该 SHA 的 PR 验证评论：配置目标 `vibe verify full --json` PASS，含静态检查和 Docker/PostgreSQL persistence gate；该证据覆盖既有实现。本轮不重复运行已提供当前 revision 证据的完整目标。
- 发布前再次读取 PR head，仍为上述 SHA；GitHub `verify` 为 `IN_PROGRESS`。
- 本轮独立执行现有 Guard 的字符串边界正反向探针与 JSON-value 编码计量对照，结果如上。未将局部诊断作为完整验证替代。
- 两个新增操作的 Schema/Registry/Handler/授权/持久化、IP-181 运行场景、真实外部链和人工验收均保持 `NOT RUN`。人类参数批准尚未完成。
- 修正以上设计论证后应复审新 head，再取得人类参数批准；现有 full PASS 不消除设计缺陷。

本文件按项目 AGENTS.md 和 Issue #181 的显式要求保留；审查发布到 PR comment，不代表 GitHub 正式 REQUEST_CHANGES review，也不授权合并。
