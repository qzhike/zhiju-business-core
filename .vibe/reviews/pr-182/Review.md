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

---

## 第二轮复审（2026-09-12）

- Outcome: `REQUEST_CHANGES`
- Reviewed SHA: `5567eff2b7fcd54927cda6baaaeed5e166fbd1d9`
- 已独立核对最新 Issue #181、完整变更范围、本轮修订 diff、共享 CanonicalJson 契约、现有 Guard 与验证评论。
- 上轮 R1 的核心问题已修复：单串上限现明确独立于字节预算，且增加了 16384/16385 场景。R2 的 JSON-value 编码模型已修正，但普遍读回保证的证明仍未完成。

### R2（仍未解决）— P2：最大请求包装不能界定所有可写入文档

位置：`Module-Spec-001-IdentityPolicy.md:385–391`；关联共享 API #181 方案和 `IP-181-C-002`。

当前从最大请求包装 2388 推出所有通过请求的文档都满足 `|D| <= 259756`，再宣称至少 1001 字节读回余量。这个推导方向不成立：请求包装越小，允许写入的文档越大。即使完全接受当前表格数值，省略可选 `supersedesRef` 时请求包装为 2098，文档预算为 `262144 - 2098 = 260046`，已比所称最大文档大 290；该版本以后被其他版本取代时，结果可以含 `supersededAt`，按结果包装 1387 算，结果为 261433，余量只有 `2098 - 1387 = 711`，不是至少 1001。

这不是实际 API 读回失败的复现，也不说明必须增大参数；它直接反驳当前证明及测试采用的最大文档和最小余量。请对同一版本的最小合法请求包装和最大合法结果包装进行配对推导，或逐字段消去双方相同项，覆盖 Enterprise/Project Scope、可选请求字段、schema refs 和生命周期字段的差异。提供完整样本或可复算字段公式，修正共享 API 与 C-002，并保留结果自身恰等于上限/超 1 的独立场景。仅检查双方最大固定项的大小不能作为所有合法输入的安全不变量。

### R3（新增）— P2：计量方法存在一字节偏差，精确边界证据需要重核

位置：`Module-Spec-001-IdentityPolicy.md:397`，影响 §13.3.2 固定项、样本尺寸及边界计量。

文档规定二分求“Guard 接受的最小字节上限”，再减 1 得到字节总数。但 inclusive 语义下，最小通过上限本身就是字节总数；减 1 得到的是最大拒绝上限。独立调用当前 `payloadGuardErrors` 并二分搜索：`{}` 的 UTF-8 字节数为 2，最小通过上限为 2，上限 1 返回 `maxEnvelopeBytes`；40 字节和 16426 字节对照也分别在 40/16426 通过、39/16425 拒绝。当前描述会将三者误算为 1/39/16425。

请纠正计量算法，并用 `Buffer.byteLength(JSON.stringify(sample), 'utf8')` 与 Guard 的 B 通过、B−1 拒绝逐项交叉核对完整样本，确保其他维度未触发。若该段仅是描述错误，应给出能复核实际计算的样本或逐字段算式；若实际程序确实减了 1，需重算所有受影响数字和 262144/262145 边界结论。当前没有保留完整样本，不能独立断言表内每个数字都错了一字节，但其所声明的统一计量方法已被反例证伪。

### 本轮验证、交付与剩余门槛

- 最新 PR 评论提供 `5567eff` 的 `vibe verify full --json` PASS（静态与 Docker/PostgreSQL persistence gate）证据；本轮未重复完整目标。当前实现的完整目标 PASS 不证明上述设计计算正确。
- 发布前回读 head 仍为 `5567eff2b7fcd54927cda6baaaeed5e166fbd1d9`；GitHub CI `verify` 已于 2026-09-12T14:47:17Z 完成，结论 `SUCCESS`。
- 本轮实际执行现有 Guard 的二分最小上限、直接 UTF-8 计量与 B/B−1 对照；R2 算式使用 PR 自身给出的包装数值，不冒充新增 API 的合法运行 fixture。
- 两个新增 API 的 Schema/Registry/Handler/授权/持久化、IP-181 运行验收、外部链与人工验收仍为 `NOT RUN`；参数人类批准尚未完成。
- PR 正文仍含已被本轮修订删除的旧编码/恒定差额论证，修订后应同步摘要，避免与最终设计冲突。
- 本轮只追加正式审查记录，保留上轮历史，未修复产品代码或 owning 设计，未 commit/push/merge。发布形式为 PR comment，不是 GitHub 正式 REQUEST_CHANGES review。

---

## 第三轮复审（2026-09-12）

- Outcome: `REQUEST_CHANGES`
- Reviewed SHA: `639e859140174e30e6bff6dfc9c84185afc71d91`
- 已核对当前 head、修订 diff、最新 Issue 评论、PR 摘要、Spec/Test、共享标量与 Envelope 定义及现有 Guard。
- R1 保持已修复；R3 的核心计量错误已修复，独立重建 Project Scope 的 `{policyVersionRef}` 结果为 446 字节，Guard 在 446 通过、445 以 `maxResultBytes` 拒绝。R2 已改正最大/最小请求包装方向，但普遍读回保证仍缺少真实的结果包装上界。

### R2（仍未解决）— P2：结果生命周期字段没有被已声明的固定包装上界覆盖

位置：`Module-Spec-001-IdentityPolicy.md:386–392`，关联 §13.3.2、共享 API #181 方案与 `IP-181-C-002`。

当前把含 `supersededAt` 的结果包装 1387 字节当作最大合法值，并由此保证所有版本至少有 711 字节余量。但共享 API 将 `UtcInstant` 定义为带显式精度的 UTC RFC 3339 timestamp，现有 `common.schema.ts` 的小数部分为 `(?:\.\d+)?`，没有固定为毫秒。§13.4 又规定 `supersededAt` 等于唯一后继的 `effectiveFrom`，因此该字段不属于原版本写入时能抵消的相同输入。

直接反例：`2026-09-13T00:00:00.` 后接 1000 个 `0` 再接 `Z`，长度为 1021。本轮用 Ajv 编译实际共享 `utcInstant` Schema，验证结果为 true；现有 Guard 对承载该值的对象也通过（未触发 16384 code point 等限制）。相比文档样本采用的 24 字符时间戳，该值增加 997 字节。即使接受 PR 的其余尺寸，结果会从 261433 增至 `261433 + 997 = 262430 > 262144`。一个正文很小的后继版本可携带该精度的 effectiveFrom，而它派生到大正文前驱的读回结果时，新增长度并未被前驱写入预算覆盖。

这是共享字段 Schema/Guard 的直接验证及基于 PR 尺寸的计算反例，不冒充尚未实现 Handler/数据库链的运行失败。如果计划在输出或持久化时规范化时间精度，需要在 owning 设计中明确该约束及与 effectiveFrom 相等语义的关系；不能默认存在未声明的固定长度序列化。

此外，新“逐字段消项”称剩余差异只有 Envelope 必填字段和 supersedesRef 对 supersededAt，但结果专有的必填 `policyVersionRef`、`contentHash`、`useStatus`、`checkedAt` 并未消失。`useStatus` 也不是固定长度：USABLE 为 6 字符，NOT_YET_EFFECTIVE 为 17，SUPERSEDED 为 10。现有四组合只切换两个可选字段，不能独自证明其余合法结果的最大包装。

请在同一版本的请求/结果字段矩阵中保留全部未抵消字段，为时间戳精度、状态、Scope 和引用包装给出实际约束与上下界，并提供可复算的完整样本或字段公式。若需要输出规范化或新增字段限制，明确呈现所需设计决定；否则按实际允许的最长结果重算预算。同步共享 API、Spec 与 C-002，增加“短正文后继取代大正文前驱”的精度边界场景。在该问题解决前，不能维持当前“711 为普遍下界、无需任何 Spec Delta”的保证。

### 非阻塞说明

§13.3.2 的“除 resolve 请求外均减 2，因为包含空文档”仍误覆盖 `{policyVersionRef}` 结果；该结果不含 policyDocument，应同样排除在减 2 规则之外。446 的表值本轮已独立验证正确，此处是方法描述需同步，不另列阻塞项。

### 验证与交付

- 该 head 的 PR 评论提供 `vibe verify full --json` PASS，含 Docker/PostgreSQL persistence gate；发布前回读 head 未变，GitHub CI `verify` 已于 2026-09-12T14:58:40Z 完成，结论 SUCCESS。本轮未重复完整目标。
- 本轮独立执行共享 UtcInstant Schema 的 Ajv 校验、Guard 单值探针、结果引用的 446/445 边界以及生命周期字符串长度计量；没有将局部探针声明为新增 API 的运行验收。
- 两个新增 API 的 Schema/Registry/Handler/授权/持久化、外部链及人工验收仍为 NOT RUN；参数人类批准仍待完成。
- 本轮只追加正式审查记录，保留前两轮历史；未修改产品代码或 owning 设计，未 commit/push/merge。发布为 PR comment，不是 GitHub 正式 REQUEST_CHANGES review。

---

## 第四轮复审（2026-09-12）

- Outcome: `REQUEST_CHANGES`
- Reviewed SHA: `5c538638441062c13a5f34fbc921a2f8825e3568`
- 已核对最新 head、修订 diff、Issue 评论、Spec/Test、共享字段定义及当前验证证据。
- R1/R3 保持已修复。SD-181-1 已明确呈现为待批准的局部字段约束，覆盖上轮变长时间戳反例；结果专有字段现已列入矩阵。独立以共享 UtcInstant Schema 叠加 maxLength=24 验证：无小数与三位小数通过，四位小数拒绝。此探针验证提案机制，不代表新操作已注册。

### R2（剩余问题）— P2：2098 仍是样本包装，不能作为最小合法请求包装

位置：Spec 001 §13.3.1 的字段矩阵、固定项及“最弱合法组合”推导；同步影响共享 API #181 方案、决定 §12.9 和 IP-181-C-002。

当前新增的时刻与 canonical objectType 上界解决了结果侧的变长风险，但证明仍直接把“24 长度时刻”的 Project 样本包装 2098 当作最小合法请求包装，继而保证全部合法输入至少有 700 字节余量。请求侧的下界与结果侧的上界必须分别证明；矩阵将 Envelope 必填字段统称为“固定形状（UUIDv7 / canonical ref / 闭集）”并不成立，其中 idempotencyKey 是 NonEmptyString，requestedAt 也允许不同长度。

无需重建全部样本即可反驳 2098/700 的普遍下界：在该样本中只把请求 Envelope 的 `requestedAt` 从 `2026-09-12T00:00:00.000Z` 改成 `2026-09-12T00:00:00Z`。两者都是相同时刻的合法共享 UtcInstant，也都满足提案的至多毫秒精度；本轮实际共享 Schema 校验均通过，紧凑 JSON 成员从 42 字节减至 38 字节。该字段不在 PolicyVersionResolutionView 中回显，因此请求包装减 4，结果包装不变。按 PR 其余数字，请求包装成为 2094，字节维度的文档预算成为 260050，相应结果为 261448，余量为 696，而非至少 700。idempotencyKey 的合法短值、actor 的可选字段和 Enterprise Scope 仍需要各自的最小值分析，不能继续把某组样本称为全体下界。

这不是新发现的实际 API 读回失败，696 仍为正；本项也不要求再次更改 SD-181-1 或直接提高结果预算。阻塞点是 Issue #181 的普遍读回保证及精确边界验收仍建立在错误的最小值上。请用每个请求专有字段的合法最小编码、每个结果专有字段的合法最大编码，加上共同字段/Scope 的配对消项，给出保守且可复算的正余量下界。引用/hash 使用精确编码长度，不以“≈350 / ≈100”作为精确边界依据；明确区分样本数字和适用于所有合法输入的不变量。同步修正 C-002 的“最大文档”表述，并覆盖短 requestedAt/idempotencyKey 与两种 Scope。可以保留现有样本作代表性计量，无需声称它们是全局极值。

### 验证、批准与交付

- 当前 SHA 的 GitHub CI verify 已 SUCCESS（2026-09-12T15:19:24Z）；PR 提供同 revision 的 `vibe verify full --json` PASS，含 Docker/PostgreSQL persistence gate。本轮未重复完整目标。
- 本轮独立验证 SD-181-1 的共享 Schema + 长度限制，以及请求时间字段的 4 字节编码差异。另按 owning 字段定义构造样本检查包装变化，仅用于诊断，不作为未注册操作的端到端验收。
- 两个新增操作的 Schema/Registry/Handler/授权/持久化、外部链与人工验收仍 NOT RUN；参数和 SD-181-1 仍需人类批准。
- 只追加本轮正式审查记录，保留历史；未修改产品代码或 owning 设计，未 commit/push/merge。发布形式为 PR comment，不是正式 GitHub REQUEST_CHANGES review。
