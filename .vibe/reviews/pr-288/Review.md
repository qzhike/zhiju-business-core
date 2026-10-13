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
