# PR #269 独立设计审查

## 审查对象与结论

- Issue：[#259](https://github.com/qzhike/zhiju-business-core/issues/259)，T2 / design only。
- PR：[#269](https://github.com/qzhike/zhiju-business-core/pull/269)，Draft。
- Reviewed SHA：`86f966a6e3a8faecaa0c79f08ab689fd70d52e97`。
- Base SHA：`134dffec23a3ff87b378edcafd723f759110a991`。
- 审查日期：2026-10-10。
- Reviewer outcome：`REQUEST_CHANGES`。
- 人类技术批准：`PENDING / NOT PROVIDED`；本记录不批准设计冻结、依赖实现 READY、合并或部署。

#259 是 Issue，当前任务分支的关联 PR 是 #269。审查基于最新 Issue、已批准产品交互与 IM-DG-005、owning Spec、完整 base-to-head 差异及该 SHA 的 CI；未采用实现者的完成声明作为验证证据。差异为 27 份 `.vibe/` Markdown，589 行增加、3 行删除；未修改 Registry、代码、SQL 或已注册接受集。Reviewer 未修复提案或实现；本记录是项目要求的正式审查交付物。

## 独立验收基准

本次预期链路是：已接收的整份计划及精确来源 → 可核对且获 Human 确认的完整修改约束 → TE 原意图和有限执行步骤 → IG 原输出 → TE 独立 Result/Acceptance → ART 完整范围、保护及无损验证后封存候选 → 独立 Head CAS 与 Markdown Representation。任何一个中间事实都不能代替 Quality、Human Approval、Release 或 Completion。

重点反例是首次文件尚无 Root/Revision/constraints 时的确认入口、blank/0 和真实模板不规则表、旧基准 B/M/S、当前 Head 或授权变化、UNKNOWN 原键恢复、两设备草稿 CAS，以及旧公开 payload 的版本兼容。支持集与另行批准的生成 lock 可以保持有界；本次不要求执行未来 Runtime 或人工用例。

## 阻塞发现

### R1 / P1：首次生成前缺少完整约束提案的公开读回边界

位置：[ART §13.1](../../module-specs/Module-Spec-004-Artifact.md#131-基线映射与完整约束)，尤其第 447–464 行；相关消费者为 [TE §28.2](../../module-specs/Module-Spec-003-TaskExecution.md#282-原意图与公共操作) 和 [公开传输](../../api-contract-v0.1/API-Contract-v0.1.md#markdown-单文件提案的-envelope-与公开传输259)。

MF-01 的合法起点是 scope 已收到，但首份文件尚无 Root、Revision 和已确认 constraints。`prepareFileConstraintProposal` 仅为 TE SERVICE 内部 Port；`confirm_file_edit_constraints` 要求顾问先取得精确 `proposalRef` 并逐字段确认完整映射。当前唯一约束 Query `get_file_edit_constraints` 却要求已经存在的 `constraintsRef`，并只描述确认后的 payload。`get_file_review_basis` 也必需已有 constraints、Branch 和 current Revision；文件目录没有 proposal 字段。原 D14 `get_startup_review` 没有此提案的范围映射字段，ART 又明确不扩展旧报告 Schema。

因此，按本提案的有限公开接口，Browser/BFF 无法在确认前取得 proposalRef、完整 proposal 和 baseline mapping 供顾问核对。仅声明“在已有整份计划检查中确认”没有闭合传输与读取权限；直接把 SERVICE producer 暴露给 BFF，或盲目提交看不到的快照，都违反本提案自身的边界。即使内部已经产生合格提案，这个问题仍存在。

修正要求：在 owning 契约内闭合确认前的提案产生/取得顺序、Human 可读取的公开 Query 或明确 composition、完整 mapping/proposal 的精确 refs/hash/Scope/当前可用性和权限。它必须在尚无 Root/Revision/已确认 constraints 时可用，并保留整份确认、不扩范围、不自动 dispatch 的规则；同步 Catalog、IP、UI 和 MF-01 的完整正链。这里不指定必须采用哪个新操作名称。

### R2 / P2：不兼容的 Markdown render payload 被声明为 Minor

位置：[IG #259](../../module-specs/Module-Spec-007-IntegrationGateway.md#markdown-建议生成原输出与渲染提案259)，第 427 行；适用权威是 [共享 API §9.1](../../api-contract-v0.1/API-Contract-v0.1.md#91-version)。

既有 `integration.request_render@1.0` 的 payload 为 `{request: RenderRequest}`，其中包含 `renderPolicyRef`、`stableIdempotencyKey` 和 `requestedAt`。拟 `@1.1` 表格将其替换为扁平 closed payload，新增必填 `markdownProfileRef`、`structureSchemaRef`、`rendererDigest`、`identityMapHash`，并仅支持 `outputFormat:zhiju.markdown`；没有保留旧合法请求的兼容分支。

一个合法旧 `{request: RenderRequest}` 即可作为静态契约反例：将 Envelope version 升至 `1.1` 后，它不满足新 closed payload。§9.1 明确规定必填字段新增、删除/改名、权限收窄或语义变化须新 Major 或新操作，Minor 仅允许 absent 不改变旧消费者语义的 optional 增量。继续保留可调用的 `@1.0` 不能证明 `@1.1` 兼容。

修正要求：使用新 Major/新操作，或明确保留原请求 shape、默认行为和旧合法接受集的兼容扩展；同时对齐 IG、Catalog、ART 消费和 IG-MF-004 等验证场景。旧合法请求、新 Markdown 请求及错误 profile/hash 应分别有预期，不能把兼容规则留给实现阶段猜测。

## 字段、Owner 与转换核对

本次无新可执行 Schema。以下是设计字段闭集、条件字段、Ref/Hash 域与消费关系的核对，不是 JSON Schema、持久化或 Runtime PASS；R1/R2 保持阻塞。

| owning 合同 / 值对象 | 核对边界与结果 |
|---|---|
| ART `markdown_source_mapping` | source/derived bytes、parser/schema、Canonical payload/hash、nodeMap 与 readLimits 分开；原行号不作 Unit 身份。确认前公开读回缺口见 R1。 |
| ART `file_constraint_proposal` | 完整 change/KEEP、具体锚、完整 protected claim/relationship、精确来源及有效期；NEW 分支不预造 Branch。Human 获取提案的路径缺失，见 R1。 |
| ART `file_edit_constraints` | 独立 Human 确认、原 proposal 与 Actor/Decision/Receipt；同 lineage 复用不改原快照。Query 只能读已确认对象，不能补 R1。 |
| ART `markdown_document` / Canonical Unit metadata | 五类 Unit、文档用途、标题/列表/span、rectangular table、blank/TEXT/0、稳定身份与语义 round-trip；旧 STRUCTURED_DOCUMENT/Hash 规则保持。 |
| ART identity sidecar | profile/Artifact/document/base 或 source mapping、output ID、原 md hash、nodes/columns 精确绑定；新 ID 不按标题/文字 hash 赋权。 |
| ART `file_candidate_acceptance` / creation receipt | 原 request、TE 接纳和 IG 来源、raw hashes、Canonical hash、实际 Revision/Receipt/Actor 分域；receipt 不含未来 acceptanceRef。 |
| ART `Location` / diff entry / directory | 精确 Revision、完整 path/subtree claim、CELL 的 table/row/column 条件字段；新增/删除/移动两端、全量 diffHash 与 cursor 绑定分开。 |
| ART Markdown Representation / download | 真实 render binding、完整 shared RepresentationRef、即时 bytes 权限及短时 ticket；登记与下载不产生批准。上游版本违规见 R2。 |
| TE `file_source_binding` | start/Profile/QMS/ProductScope、来源/模板/保护/完整依赖、constraints/current 与生成 lock；NEW 无假 Branch，EXISTING 捕获真实 Head。 |
| TE `FileGenerationContext` | 精确 request/binding、受权 inputs/coverage/omissions、有效期、selector/lock；不补旧 Context。 |
| TE `file_review_basis` | 当前 constraints/Branch/Revision、既有 Quality refs、active request 与当前性；不支持尚无 Revision 的提案读取，见 R1。 |
| TE `file_submitted_intent` | 原 transport payload/hash/key、独立 intent hash、提交时版本、B/M/S、稳定 item 和真实 Human；新输入不回填。 |
| TE file request / fixed step facts | 原意图与唯一文件占用同事务；每步真实 Receipt、稳定键、UNKNOWN/PARTIAL/STALE 历史；terminal 不 resume/second invoke。 |
| TE `file_candidate_result` / acceptance binding | 单份 candidate、原三份 bytes、Run/Context/Acceptance/observation、实际 Root/Branch 与当前资格；TE 来源接纳不等于 ART 候选。 |
| TE `processingReport` / `CandidateLocation` | 全 submitted item 覆盖、未处理项、原文范围及 candidate node/claim；无未来 RevisionRef，seal 后视图不改 raw Hash。 |
| TE private draft / snapshot / `pendingSubmission` | 同 trusted Human/Scope/base、完整 content、CAS/editId、原 target/key/public payload/hash 和累计查询预算；保存不执行，loser fork 不覆盖 winner。 |
| IG suggestion intake / `markdown_suggestion` | 单 file/B/S/作者与真实 bytes/security intake；READY 不证明 Canonical 无损，旧声明基准不改绑。 |
| IG `file_generation_observation` | 原 Attempt/session/lease/fencing、Run/Contract/Context/Package/lock、三份原 outputs、Provider Receipt；late 仅历史。 |
| IG Markdown render binding / `markdownValidation` | 原 request/hash、实际成功 Receipt、renderer/profile/schema/digest、input/round-trip/output hashes；Minor 接受集冲突见 R2。 |
| QG / IP / Runtime / UI consumers | 普通反馈与 Issue、Evidence/专业判断/Approval、独立当前授权、本人私稿、生成 lock 与页面主动换版各自保持；不从导航、HANDLED、自检或下载推业务完成。 |

## 验证证据与未执行边界

- [CI run 38019956414](https://github.com/qzhike/zhiju-business-core/actions/runs/38019956414) 的 `headSha` 精确等于 reviewed SHA：`select`、`checks`、`verify` 为 SUCCESS；`persistence` 为文档路由预期 SKIPPED。
- 独立读回 `checks / Verify documentation` 日志：`BASE_SHA=134dffec23a3ff87b378edcafd723f759110a991`，`[docs-verification] PASS files=27`，Prettier 全部匹配文件通过。复用当前配置文档目标的 CI，不重复运行相同 PR 检查。
- 独立 `git diff <base>...<head> --check`：PASS。
- 定向只读静态检查：24 个 future operation 名称唯一（TE 11、ART 9、IG 4）；45 个 owning MF 场景行 ID 唯一且全部 `NOT RUN`（IP 4、TE 10、ART 12、QG 3、IG 4、UI 7、RA 5）。数字不是运行测试通过数。
- 三份 procurement 源 bytes 的 SHA-256 与检入 `procurement-fixtures.js` 一致；procedure 确有两个 H1、首表 3 列 header/5 列数据行。不规则表的有界拒绝与原件保留是已声明限制，没有作为新缺陷。
- 真实 PostgreSQL/full、OIDC/public HTTP、生成可行性/Host/Runner、公开下载、批准 Chrome/Edge 支持矩阵、独立 Human 内容验收：全部 `NOT RUN`。

本记录新增到工作区后另执行配置 `docs` 检查，仅验证正式 Review 文档的当前工作集；它不替代上述 reviewed SHA 的 CI，也不改变两个语义发现。

## 交付与后续门禁

审查授权包括发布 PR comment 和保存正式 Review；不包含修复提案、commit、push 或 merge。本记录保存在 `.vibe/reviews/pr-269/Review.md`，尚未提交到远端；GitHub comment 与本地文件交付分别报告，不把 comment 声称为正式 GitHub REQUEST_CHANGES review。

R1/R2 修正后需重新审查新 head，再取得精确修订的人类技术批准；生成 profile/部署锁及后续执行证据仍独立判断。当前结论返回 Implementer，不以已知有缺陷的修订消耗人类冻结批准。

## 后续结论（记录指针）

本文件是首次审查的原始正式记录（reviewed SHA `86f966a`）。R1/R2 修正后的独立复审与绑定精确修订的人类技术批准记录在 [PR #269 的公开评论](https://github.com/qzhike/zhiju-business-core/pull/269#issuecomment-6093658565) 与[最新批准](https://github.com/qzhike/zhiju-business-core/pull/269#issuecomment-6093748821)中，批准 SHA 为 `d5ff5f0be1a492233f7ff3f0fac51b68a740a9de`，并以该批准取代本文的 `REQUEST_CHANGES` 结论。本指针不修改上述原始审查内容。
