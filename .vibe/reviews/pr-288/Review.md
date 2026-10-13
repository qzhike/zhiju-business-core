# PR #288 独立设计审查

## 审查对象与结论

- Issue：[#277](https://github.com/qzhike/zhiju-business-core/issues/277)。
- PR：[Draft #288](https://github.com/qzhike/zhiju-business-core/pull/288)，base `main`。
- Reviewed SHA：`45aee27c1915ccefc2512dc60260169f6b76f74f`。
- Reviewer outcome：`REQUEST_CHANGES`。
- 阻塞发现：R1–R3，均可在本 Issue 的字段闭合与兼容范围内修复。
- Human 技术批准：`PENDING / NOT PROVIDED`。现有 #253/#258/#257 批准不覆盖本次新增接受集；本记录不授权实现、合并或部署。

本次独立读取 Issue 及评论、PR/head/diff、项目规则、相关 EP/IP/IG/UI/TE 与共享/持久化 authority、既有批准和精确修订 CI。从 Issue 验收推导的期望是：受权 Human 在 NEW/EXISTING 两条路径均能取得真实准备 Project 与独立 Project Grants；浏览器仅通过允许的公开结果构造全部必填字段；原 ZIP/note/ANALYZE 与每一步真实回执可恢复；UNKNOWN 不创建第二事实或 invocation。实际差异为 20 份 `.vibe/` Markdown，没有业务代码、Registry、SQL 或 migration。未采用 Implementer 自报语义完成作为审查依据，未修复设计或产品文件。本记录本身不属于上述 reviewed SHA。

## 阻塞发现

### R1：首次 ZIP Command 的必填 intake policy 没有浏览器可读取的生产结果

定位：[EP #277 技术预设与请求结果](../../module-specs/Module-Spec-002-EnterpriseProject.md#277-准备入口预设与原请求交接提案)，本 reviewed SHA 第 947、955、965 行；[IG #277 公开字段](../../module-specs/Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案)，第 396、402 行；[UI #277](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#277-两字段创建与单次提交交接提案)，第 275、279 行。

`integration.request_customer_zip_intake` 必填 `intakePolicyRef` 与 `intakePolicyHash`，服务端还必须与原 preset 比对。EP 确实在内部 preset 的 `intakePolicy` 中拥有这对值，但公开 `find_preparation_enterprises.entryBinding` 只返回 presetRef/hash/publicationRef，准备请求 result/query 的闭集也没有 intake policy；内部 preset resolver 不在有限 Browser route 集合。UI 所述“服务器指定 policy/preset bindings”因此缺少公开 producer。

最小反例：NEW 或 EXISTING 的创建流程全部成功，浏览器只拥有本设计允许的 entry/result/query 字段，进入 ZIP 页准备第一次提交；它无法构造必填 policy tuple。猜配置、从 hash 反解、在 BFF 增加私有解析调用或提交后注入默认值均不满足既有边界。即使首次页面临时获得值，重新登录的原请求结果仍不能恢复该 tuple。

要求：在已有 owning 公开结果中明确返回由**该原请求绑定的精确 preset**解析出的 intake policy ref/hash，并说明首次进入与重登恢复如何消费、与提交 payload 如何逐字段比较；补充 UI/IG 正向场景证明仅靠公开结果即可构造完整首次提交。无需新浏览器私有 API 或员工配置项。

### R2：上传恢复 Query 没有提供 restart 必需的当前 aggregateVersion

定位：[IG #277 公开字段及 uploadState](../../module-specs/Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案)，第 397–398、414–416 行；[共享 API §6.3](../../api-contract-v0.1/API-Contract-v0.1.md#63-queryresult)；[共享 QueryResult](../../high-level-docs/06-typed-references-contract-catalog-v0.1.md#84-queryresult)。

`integration.restart_customer_zip_upload` 是 MUTATE，必需 Envelope `expectedAggregateVersion`。其前置 `get_customer_zip_intake` 结果闭集没有 `aggregateVersion`，闭合 `uploadState` 也只有 generation/state/restartsUsed/expiry/reasons；共享 QueryResult 不另带 Aggregate CAS 版本。`originalCommand` 是原 CREATE 输入，不包含当前版本；generation 不能替代独立 Aggregate 版本。

最小反例：原 CREATE 响应丢失后重新登录，owner 已确认第一代 `CLOSED_NO_OBJECT` 并在 Query 中允许 RESTART。浏览器能取得 generation 和原 hash，却没有当前 `expectedAggregateVersion`，无法安全构造首次 restart。此前 CommandResult 的创建版本即使曾收到，也不能证明上传状态变化后的当前版本。原 restart 已提交后返回 `restartCommand` 只解决该命令重放，不解决此首次恢复前置条件。

要求：由 IG 原 intake 的受权 AUTHORITATIVE Query 返回本次观察对应的当前 Aggregate 版本，明确该版本与 uploadState/RESTART 资格的同一观察关系，浏览器原样放入 restart Envelope；保留提交时 CAS 竞态拒绝。补充“CREATE 响应丢失→重登→Query→首次 restart”和查询后版本变化的接受/拒绝场景。

### R3：NEW/EXISTING 复用的旧创建操作 Purpose 与冻结元数据不一致

定位：[IP #277 scoped binding registry](../../module-specs/Module-Spec-001-IdentityPolicy.md#277-准备入口准入与显式项目授权提案)，第 1021、1025、1045、1049 行；冻结 [`operation-compatibility-metadata.v1.json`](../../../contracts/registry/operation-compatibility-metadata.v1.json)，第 169–172、190–193 行。

新“逐字映射”把 `project.create_enterprise@1.0` 的 Purpose 写作 `project.enterprise.create`，把 `project.create_project@1.0` 写作 `project.project.create`，并声称复用已有 Purpose。当前冻结注册值分别是 `enterprise.project.create_enterprise` 与 `enterprise.project.create_project`。Purpose、内部 action 与配置 capabilityCode 是不同字段；旧 Module Spec 早期短拼写不能替代现有注册 operation/version 的精确 Purpose。

最小反例：EXISTING 顾问持有按当前旧创建操作映射的合法 Enterprise 创建资格，新的 admission 却查另一 Purpose；NEW 的 scoped bootstrap Decision 同样不能作为原 `project.create_enterprise@1.0` 的精确授权证明。若实现为了兼容而把二者当作别名，则违背本提案保留旧契约、逐字段授权和不自动互换的约束。

要求：修正本提案中复用既有操作的 Purpose，逐项区分 operation/version、注册 Purpose、内部 action、实际配置 capabilityCode；仅新 preparation 操作保留其显式新增映射。不要改写冻结旧 Registry/compatibility bytes。补充原生 Purpose 正例及短拼写/别名拒绝反例。

## 逐合同交接矩阵（设计层）

本表检查拟议字段的生产、消费与当前授权路径；当前没有新 Schema/Handler，不能把字段对账写为运行验证。

| 合同 / 字段边界 | producer → consumer / 绑定检查 | 结论 |
|---|---|---|
| `PreparationPreset` / profile、code/version、creation、memberPolicyTemplate、intakePolicy、companyRules、analysisHandoff | EP publisher/resolver → 安装选择、IP admission、EP 创建/来源与 IG policy；VERSIONED 与独立 cv1 hash、真实发布/撤回/取代分别保存 | 内部 owner 闭合；公开 intake policy 出口见 R1 |
| preset publication / withdrawal / resolver / `PreparationEntrySelection` | exact presetRef/hash、effectiveFrom、Actor/Decision、可选 supersession；resolver 核验原发布与当前可用性，无生产默认值 | 无独立阻塞发现 |
| `PreparationEnrollmentGrant` / grant/revoke | 显式管理员 → exact Human/modes/preset/template/Policy/期限/maxUses；独立 Platform provenance，不借公司发布权或登录 | 无独立阻塞发现；Human 批准仍待完成 |
| entry discover / reserve / revalidate admission | verified Human + 原 request/command/key/hash + mode/E/P/preset → IP reservation/Receipt/bootstrap Grants/currentUseStatus；maxUses 原子占额、ID 唯一、当前撤权 | 预创建 Scope 路径显式；旧操作 Purpose 见 R3 |
| membership template publish/withdraw/read / materialize/read / creator provisioning | exact template/hash/admission → scoped memberPolicy/hash → EP Project Receipt/Claim → 每个独立 Grant slot/Receipt；原创建事实不产生隐含权限 | 无独立阻塞发现；真实部署配置仍缺失 |
| `find_preparation_enterprises` | searchText/page → 本人当前许可 Enterprise Page + entryBinding/newCustomerAllowed；preset/session/filter/水位绑定 cursor | 无隐含全局目录；policy 公开出口见 R1 |
| preparation request CREATE / get / create_preparing_project / board preparationEntry | 原 customer/title/preset/hash 与 Envelope E/P/request/key → immutable originalCommand、reservation、逐步 refs/receipts/access；memberPolicyHash/requestRef 等由真实 owner 提供 | NEW/EXISTING 与部分成功恢复明确；ZIP 前置字段见 R1 |
| `request_customer_zip_intake` | project/request/key/preset/hash/name/length/ZIP hash/policy/hash/note?/ANALYZE → IG 原 Command、两份 Human Decision、Root/Receipt/ticket | note、原请求、分析意图不丢；首次 policy 来源见 R1 |
| `get_customer_zip_intake` / 两种 selector | intakeRef 或原 preparation request/key → 同一唯一 intake、originalCommand/restartCommand?/note?/uploadState/custody/analysis/actions/水位 | 当前读取与原意图恢复明确；当前 CAS 版本见 R2 |
| restart / upload ticket / uploadState | 原 intake/key/hash/generation + Envelope CAS → 同 intake 第二代、同 bytes、同 token/expiry 授权 replay；仅确认无完整对象/link/manifest后一次 byte-0 重传 | 次数/UNKNOWN/迟到流边界明确；首次恢复的版本输入见 R2 |
| `CustomerZipPolicyRegistry/Resolver` | 受审构建 artifact 的 ref/hash、D14 限额/格式/extractor profile → EP 发布与 IG intake 校验 | owner 和精确解析明确；不把 fixture 当生产实例 |
| `customer_input_manifest` / `CustomerZipManifestCommitted` | 原 intake/request/key/hash、Project、ZIP、policy/extractor、逐 entry、note?、ANALYZE、preset、真实 source receipts → immutable manifest + 同事务 Outbox | bytes/canonical hash 分域、note 限制、安全拒绝、至少一个合法 ZIP entry 明确 |
| `ReadCustomerZipSubmission` / EP binding read | intake/manifest/submission hash → 原 intent/manifest/Receipt/currentUsability；EP request/key/Project/intake/hash → 当前 preset/rule/creator eligibility | 固定 SERVICE 独立权限；Event 自报不替代 owner readback |
| `PreparationAnalysisHandoff` read/continue / SOURCE、TASK、ANALYSIS_REQUEST | 原 manifest/note/ANALYZE → EP source → TE task/definition → 原 TE request；profile/objective/source refs 与原 preset/真实 Receipt 对齐，Task CAS 取 CommandResult 的真实 resultingAggregateVersion | 无第二 Browser 编排；原 step key、Inbox/Process 唯一性和 UNKNOWN readback 明确 |
| Workspace transport / UI 组合 | 仅有限 EP/IG 候选与新增 restart、原 PUT；Session/CSRF/current IP，每次保留原 payload/hash；custody/handoff/Run 各层只展示真实事实 | 边界保留；R1/R2 修复后须重新检查完整正链 |

既有 #253/#258/#257 接受集与批准没有被替代；新 23 个未来场景均保留 `NOT RUN`。跨模块无共享 Repository/Schema 写入；ProjectScopeClaim 与 IP Grants、manifest 与分析调度、TE request 与真实 Run 均保留独立含义。unsafe ZIP、零可分析条目、缺能力、撤权和已链接材料不清理的边界未发现独立阻塞。一次完整重传及耗尽后受权运维处理属于明确待批准的有界首版选择，不因缺少自动化续传升级为发现。

## 验证证据与后续门禁

- 独立执行 `vibe repo --json`，确认 repository、branch 与 reviewed SHA；本次开始时工作区干净。
- 本轮独立 GitHub 只读探针成功，已读回 Issue 无评论、PR 无既有 Review/评论及上述 head。
- 独立读回 [CI run 38347821952](https://github.com/qzhike/zhiju-business-core/actions/runs/38347821952)：`headSha` 精确相等，`select`、`checks`、`verify` 均 `SUCCESS`，`Verify documentation` step `SUCCESS`；`persistence` 为严格 Markdown 路由的预期 `SKIPPED`。复用该配置目标证据，没有重复运行该已检查修订。
- 新增本正式记录后，通过已安装 pinned pnpm 11.19.0 执行配置目标 `vibe verify docs --json`，结果 `PASS files=21`；`git diff --check` 通过。此结果覆盖包含本记录的本地文档树，不冒充 reviewed SHA 的新 CI。
- 本次审查只产生本正式 Review.md。业务实现、Registry、迁移/持久化、对象存储/上传、生产发布、公开 HTTP/Browser、TE/Runner 和独立人工业务验收全部 `NOT RUN`。

R1–R3 修复后须提交新精确 head 供独立复审；当前结论不覆盖后续修订。修复与独立复审通过后，仍须精确修订的显式 Human 技术批准，依赖实现才可重新判断 READY。Reviewer 未 commit、push、merge、发布 GitHub 评论或正式 review；GitHub 审查交付由主线程在适用授权内完成。

## 新修订独立复审：f7c828fa

- Reviewed SHA：`f7c828fa85353c84d8865d9440d3c530442751d7`，本轮 `vibe repo --json` 与 GitHub PR head 均精确匹配。
- 前次 reviewed SHA：`45aee27c1915ccefc2512dc60260169f6b76f74f`；上方 R1–R3 和 `REQUEST_CHANGES` 保留为该历史修订的结论。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。
- 独立 agent 设计审查：R1–R3 已在 owning 设计与未来接受场景中闭合，本轮未发现新的阻塞项。
- 精确修订 Human 技术批准：`PENDING / NOT PROVIDED`。

本轮重新执行 GitHub 只读探针并读取最新 Issue/评论、PR/head/状态、初审以来的实际差异和相关 authority。Issue 的 Goal/Acceptance/Scope 未变；PR 仍 Draft。初审以来修改恰为 8 份 EP/IP/IG/UI Spec/Test，另纳入原正式审查记录；完整 PR 为 21 份 `.vibe/` Markdown。没有业务代码、Registry/compatibility metadata、SQL、迁移或无关模块改动。本复审依据实际字段/场景重新核对，不将 Implementer 的修复说明作为正确性证明；以下追加本身尚不属于本次 reviewed SHA。

### R1–R3 原反例复核

| 初审问题 | 本修订 producer → consumer 与拒绝边界 | 复审结论 |
|---|---|---|
| R1：首次 intake policy 无公开来源 | EP `find_preparation_enterprises.entryBinding` 增加 `intakePolicyRef/intakePolicyHash`；原 preparation request result/query 也必填同一形状，来源为原请求锁定 exact preset 的 `intakePolicy`，不能随当前全局选择换值。UI 首次进入/重登均消费该原请求结果；IG 的现有 binding read 校验原 preset/policy tuple。撤回仍可受权读历史 tuple，但不许可新 intake。EP-277-001、IG-277-001、UI-277-002/003 增加公开结果独立构造、换全局选择与伪造 tuple 的场景。 | 已闭合。浏览器可仅靠允许的公开结果填齐必填字段，没有新增配置 API、默认注入或员工设置。 |
| R2：首次 restart 无当前 CAS | IG 两种原 intake Query selector 的 result 必填真实 `aggregateVersion`，与 uploadState 及本 intake 许可条件来自同次 AUTHORITATIVE 观察。UI 分别把该版本与 generation 放入 Envelope CAS / payload generation；提交仍当前授权、readback 与双重比较。已提交 restart 继续原样 replay 保存的 restartCommand，不以新查询版本改原命令。IG-277-002/003、UI-277-005 明确 CREATE 响应丢失→重登→首次 restart 及查询后版本变化的反例。 | 已闭合。共享 API §6.3 的可变 Query 版本要求得到满足，generation 不充当 CAS，查询未承诺跨 Owner 原子资格。 |
| R3：旧创建 Purpose 不匹配 | IP 新段落分别使用 `enterprise.project.create_enterprise` / `enterprise.project.create_project`；本轮再次逐字核对冻结 metadata，两者一致。operation/version、注册 Purpose、内部 action、配置 capabilityCode 明确分列语义；旧短拼写仅出现在拒绝说明/负例。IP-277-001/002 保留原生 Purpose 正例及别名/action 冒充拒绝。 | 已闭合。仅修正本提案复用映射，旧契约和历史兼容 bytes 未变。 |

已复核修改没有扩大登录/空 Scope 的权限、没有令 Enterprise Grant 覆盖 Project、没有跳过创建后逐项 provisioning，也未改变原 note/ANALYZE、一次重传、UNKNOWN readback、manifest→EP→TE 的所有权与真实回执边界。23 个未来场景继续 `NOT RUN`；文档中的正向路径没有被标为运行 PASS。此次无新增设计选择超出 #277，四项待 Human 批准的预设、准入、handoff 与有界重传选择继续保持提案状态。

### 本修订验证与剩余门禁

本轮 required target 仍为 `docs`。已独立读回 [CI run 38348685065](https://github.com/qzhike/zhiju-business-core/actions/runs/38348685065)：headSha 为本次 reviewed SHA，整体 `SUCCESS`；`select/checks/verify` 与 `Verify documentation` step 均成功，`persistence` 为文档路由的预期 `SKIPPED`。复用该精确修订的配置目标证据；本节追加后的本地文档检查另行执行，不以 Markdown 检查代替语义审查或运行证据。

Issue #277 明确要求独立设计审查与最终修订的显式 Human 技术批准。R1–R3 已解决，但尚无该 Human 决定，因此角色结论为 `HUMAN_REVIEW_REQUIRED`；不升级为 `APPROVE` 或依赖实现 READY。部署中的真实 preset/membership/Policy/公司规则发布及服务权限、上传/持久化、公开 HTTP/Browser、TE/Runner 与独立人工业务验收仍无本任务执行证据。Reviewer 仅追加正式记录，未 commit、push、merge 或发布 GitHub 消息。

## 最终设计修订独立确认：98f60b3

- Final reviewed SHA：`98f60b3a81c10c23173482c31162371dfcecfc27`。
- 独立 Reviewer 已核对该 head 相对 `f7c828fa85353c84d8865d9440d3c530442751d7` 的完整差异：仅纳入复审记录、更新主 Delta 与四份 owning Spec 状态头、增加正式 Review 链接。
- 字段、授权、恢复、handoff 与接受场景语义没有变化，R1–R3 保持闭合，未发现新的阻塞项。
- 当时 Reviewer outcome：`HUMAN_REVIEW_REQUIRED`；该结果保留为下方 Human 批准前的历史结论。
- 精确修订 [CI run 38348940481](https://github.com/qzhike/zhiju-business-core/actions/runs/38348940481) 已读回：`select/checks/verify` 均 `SUCCESS`，`persistence` 按文档路由预期 `SKIPPED`；本地配置 `docs` 为 `PASS files=21`。

最终独立确认来源为本次 Reviewer 的精确 head 复核结果；[PR #288](https://github.com/qzhike/zhiju-business-core/pull/288) 描述已记录该 reviewed SHA 与结论。本节在批准记录纳入时保存既有事实，本身不属于该 reviewed SHA。

## 人类技术设计批准：98f60b3

- 批准日期：2026-10-13。
- Approved SHA：`98f60b3a81c10c23173482c31162371dfcecfc27`；本轮批准记录前读回的本地 head 与 PR head 均一致。
- 批准来源：用户在收到最终独立审查结论、该精确修订及四项技术选择的批准问题后，明确回复“批准”。这是本次会话中的真实 Human 决定，不伪装为 GitHub 原生 APPROVED review。
- Human 技术设计批准：`APPROVED`，覆盖 `SD277-PRESET`、`SD277-ADMISSION`、`SD277-HANDOFF`、`SD277-RECOVERY` 及该修订的 owning Spec/Test。

四项选择分别为 EP 独立技术预设、IP 显式准入与创建后独立 Project Grants、manifest 驱动 EP 分析交接、同 intake 最多一次完整重传。上述初审/复审及 `PENDING`、`HUMAN_REVIEW_REQUIRED` 保留其历史时点；本次明确批准完成该补充的独立审查与精确修订 Human 技术设计门禁。

本次同步仅纳入批准事实与更新受影响文档的设计状态，没有改变获批字段或业务语义。真实管理员/Policy/预设及公司规则发布/部署权限值仍是显式输入；Registry、业务实现、迁移、上传、TE/Runner、公开 HTTP/Browser、生产与独立人工业务验收继续 `NOT RUN`。后续贯通实现可据此准备执行工作项，不由技术设计批准制造已部署能力、Issue 发布授权或合并授权。
