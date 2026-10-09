# PR #262 独立设计审查

## 审查对象与结论

- Issue：[#257](https://github.com/qzhike/zhiju-business-core/issues/257)，`T2 / design only`。
- PR：[#262](https://github.com/qzhike/zhiju-business-core/pull/262)，Draft。
- Reviewed SHA：`268ebe93307c32387aef45d04e70dd5fd4e8294e`。
- Base SHA：`15c085354056ab327e03352c32020010cc11285b`。
- 独立审查日期：2026-10-09。
- Reviewer outcome：`REQUEST_CHANGES`。
- Human 技术批准：`PENDING / NOT PROVIDED`。业务清单确认与技术批准、平台发布、真实客户适用性验收各自独立。

本次从最新 Issue、冻结规则、D14 及 owning EP/IP 契约建立预期，再检查七份 Markdown 的实际差异、被引用模板和精确修订 CI。独立验收预期为：具体非空必需清单有来源；客户事实、保护 Evidence 与 Human 决定分离；公司定义有可执行的发布/精确解析路径；取代不改写冻结 PROJECT_START；必要缺失或冲突阻启动，文件保护冲突按整文件处理。未修复提案或产品代码。本审查记录不属于 reviewed SHA。

## 阻塞发现

### R1 / P1：三个新 profile 没有兼容冻结接受集的 Platform snapshot 保存与读取路径

定位：[IP #257 提案](../../module-specs/Module-Spec-001-IdentityPolicy.md#257-公司规则发布与精确读取提案)，reviewed SHA 第 1041 行；[EP #257 字段](../../module-specs/Module-Spec-002-EnterpriseProject.md#257-公司启动规则与词表字段提案)，第 1003–1008 行；[公司 Delta §3](../../decisions/company-startup-rules-v0.1.md#3-不可变公司-bundle发布与精确引用)，第 95–100 行。

提案把 `ep.company_startup_bundle@1.0`、`ep.company_startup_rules@1.0` 和 `ep.company_startup_vocabulary@1.0` 声明为三个精确、注册后才可用的 EP profile，同时要求通过当前 `record_policy_snapshot/get_policy_snapshot@1.0` 路径保存与读取 Platform PolicySnapshot。

但既有 [IP §13.5](../../module-specs/Module-Spec-001-IdentityPolicy.md#135-授权profile-schema-注册与失败审计) 明确冻结：`identity.record_policy_snapshot@1.0` 保持历史 `im02-static-v1` 接受集合；扩展 profile registry 的路径是独立的 scoped `record_policy_version`，不能用历史 schema 冒充消费方所需 profile。当前代码与该契约一致：

- [static-registry.ts](https://github.com/qzhike/zhiju-business-core/blob/268ebe93307c32387aef45d04e70dd5fd4e8294e/modules/identity-policy/src/commands/static-registry.ts#L30) 的历史集合只含 `identity.PolicySnapshot@1.0`、`identity.RolePolicy@1.0`、`identity.CapabilityPolicy@1.0`；三个新 key 都无法解析。
- [recordPolicySnapshot](https://github.com/qzhike/zhiju-business-core/blob/268ebe93307c32387aef45d04e70dd5fd4e8294e/modules/identity-policy/src/commands/role-capability-handlers.ts#L792) 在进入事务前对每项执行上述历史解析检查，未知 profile 返回 `IDENTITY_POLICY_VERSION_UNKNOWN`。
- [getPolicySnapshot](https://github.com/qzhike/zhiju-business-core/blob/268ebe93307c32387aef45d04e70dd5fd4e8294e/modules/identity-policy/src/commands/queries.ts#L233) 也只通过历史 `policySchemaReference` 转换保存的 schema key；仅增加另一个 registry 的注册项不能闭合这个读取分支。

直接反例：公司业务清单已确认、九份模板和十二项 requirement 均已合法发布，随后以任一上述新 profile 创建 Platform snapshot。按提案指定的现有路径，写入仍被历史 registry 拒绝，无法形成真实 outer/child refs，发布证明及 `EP-257-001` 正链不能继续。若仅在新 profile registry 注册条目，原路径不会因此接受它；若将条目直接加入旧集合，或以 `identity.PolicySnapshot@1.0` 代替真实 profile，则违反保留旧接受集或精确 profile 校验的契约。这是设计路径冲突，不是要求本次文档 PR 实现 registry 或数据库。

修复要求：在本次 owning 设计中明确三个新 Platform profile 的独立 producer/validator 和 exact resolver 接受集，包括 registry version、profile selector、canonical SchemaRef、snapshot 写入/读取及授权绑定。可以定义新的受控内部能力，不必新增管理页面或公开 API；但须清楚区分其与冻结的 `record_policy_snapshot/get_policy_snapshot@1.0` 路径，不能靠后续实现隐式扩大旧集合。同步 EP/IP、Delta/Catalog 和正负 trace；将“新 profile 合法保存、精确读回并发布”与“旧 @1.0 仍拒绝新 profile、历史引用与 Hash 不变”作为对应设计验证条件，再审最终 head 并取得显式人类技术批准。

## 字段与边界核对

本 PR 未提供或修改生产 Schema，以下是提案字段和 owning 契约的设计对账，不是 schema/runtime PASS。

| 对象 / 接口 | 本次对账的完整字段边界 | 结论 |
|---|---|---|
| `ep.company_startup_bundle@1.0` | bundleCode、bundleVersion、supportedRange 的 rangeCode/productTypeCodes/marketCodes/standardTargets/upgradeTargetRef/targetImplementationDate、startupRulesRef、vocabularyRef、templateBindings、requirementBindings、compatibility 的 reportProfile/ruleProfile/vocabularyProfile/requiredFactValueTypes、可选 supersedesBundleRef | 业务范围、精确 refs、非空绑定、版本及取代约束已声明；生产/解析路径受 R1 阻塞。 |
| `ep.company_startup_rules@1.0` | rulesCode、rulesVersion、mandatoryFactTypes、requiredProductFields、minimumProductVersions、protectionEvidenceRequirements、mandatoryRequirementCodes、mandatoryChoiceKeys、mandatoryDecisionTypes、allowedStartupOutcomes、supportSet | 1 类 TEXT Fact、至少一个完整 ProductVersion 且覆盖所有纳入产品、四类保护 Evidence、12/2/3 组有具体含义；不把三数组非空当完整条件。R1 待闭合。 |
| `ep.company_startup_vocabulary@1.0` | vocabularyCode、vocabularyVersion、entries 的 domain/code/label/meaning/sourceBindings/ownerMapping | domain 闭集、domain+code 唯一、业务原值与代码分开；来源/含义变更产生新版本。R1 待闭合。 |
| 公司 requirement | requirementCode、definitionVersion、text、applicabilityConditions、templateSourceBindings 的 templateRef/locator/sourceBytesSha256、normativeReferenceRefs | 模板源集合非空；涉及规范判断时正式规范引用非空且 PUBLISHED；定位及 bytes hash 与 canonical hash 分域。 |
| 公司 publication | bundleCode、bundleVersion、outer/child refs、approvedDefinitionHash、approvedRangeHash、semanticValidation 的 validatorProfileRef/validatedPayloadHash/validatedChildRefs/validatedAt、actorSnapshotRef、authorizationDecisionRef、effectiveFrom、recordedAt、可选 supersedesPublicationRef | 批准范围与整个 outer payload 绑定；发布不参与其引用的 bundle hash；显式生效/撤回/取代与历史读取分开。其输入 snapshots 受 R1 阻塞。 |
| 精确解析 Port | 输入 outer/child/publication refs；结果 snapshots/publication/currentUseStatus/checkedAt/sourceWatermarks/reasons | USABLE、NOT_YET_EFFECTIVE、SUPERSEDED、WITHDRAWN 分开；拒绝错误 Hash、profile、无发布与不可见引用；新 snapshot 解析入口受 R1 阻塞。 |
| D14 source / review / intent | source 增加 publicationRef；review binding 保留原 D14 字段并绑定 publication；companyRequirements、startupEligibility、文件 eligibility、当前性及水位分别返回 | 缺候选也保留必需 code 的 blocker；固定完整引用集合、两个 CAS 版本、原 request；规则更新只追加 STALE/impact。 |

集合语义按提案中的 `Set`/`NonEmptySet` 及 code 唯一性核对；未要求普通数组额外去重，也未以未实现 Schema 宣称已执行合同校验。

## 已核对的其他边界

- 本次范围为七份 `.vibe/` Markdown；没有 Registry/Schema、实现、迁移、工具或无关模块代码改动。
- 来源 S1–S9 的本地原件 bytes hash 全部与文档和来源库 `0bb6976f27051e4abab8c45596e74f6903dad293` 对应 Git blob 匹配；已定向读取产品范围、目标、职责、软件、生产/外协及污染控制相关原文。模板示例与签批栏不能证明客户事实；S6/S7 的拟版仍须取得正式发布决定。
- 按实际标题边界截取 §1–2，UTF-8 bytes SHA-256 与记录的 `8cabe2e26d2402660f92e3fec7b59daa595e6d5ae26df7af2560f4b080b5f64b` 相符。此检查验证被记录的确认内容定位，不是对原用户答复、平台批准事实或客户适用性的独立认证。
- [中国政府网的第107号公告](https://app.www.gov.cn/govdata/gov/202511/06/539701/article.html) 支持文档注明的公告日期及 2026-11-01 施行日期；此次仅核对该公告，不声称已审定全部标准或具体客户的法规适用性。
- 保护 Evidence 与结构化 EnterpriseFact 分开，SD257-SUPPORT 明确未选择、未批准；未把保护材料扁平化成 TEXT Fact。
- 十二项适用性、两项管理选择、三项专业决定均为具体非重复代码；Human 决定、Quality Evidence 与公司模板要求分开。
- 未提供、明确不存在、读取受限、unsupported、UNKNOWN 和 CONFLICT 仍有不同原因；必需不足阻启动，file-only 保护冲突按整文件等待；初次阻塞选择拒绝原集合，Human 可用新意图选择合法独立文件。
- 显式取代或撤回才改变当前使用资格；新发布或发布者后来撤权不改写历史；ACTIVE/FULL_START、旧三启动引用及有界 INITIAL_SCOPE_RECOVERY 保持冻结与 impact 规则。
- EP 九项、IP 五项设计 trace 已声明，全部仍为 `NOT RUN`。它们不替代已执行的授权、发布或客户启动证据。

## 验证证据及未执行边界

| 证据 | 结果 / 范围 |
|---|---|
| `vibe repo --json` | repository、branch 和本地 head 与 PR reviewed SHA 匹配；审查开始时工作区干净。 |
| [CI run 37913918253](https://github.com/qzhike/zhiju-business-core/actions/runs/37913918253) | GitHub readback 的 headSha 为 reviewed SHA，select/checks/verify SUCCESS；checks 的 Verify documentation 步骤 SUCCESS；Verify code 和 persistence 按纯文档路由 SKIPPED。复用当前证据，未重复运行同一配置目标。 |
| 本地 `vibe verify docs --json` | PASS，exit 0，files=8，格式检查通过；用于新增本正式审查记录后的工作区。只读 preflight 找到已安装的精确 `pnpm@11.19.0`，在 PATH 选择该 bin 后运行原配置目标；首次默认 launcher 调用在无输出等待期间取消（exit 130），不计 PASS。没有关闭签名校验或修改版本/验证配置。 |
| `git diff <base>..<reviewed SHA> --check` | PASS；只覆盖被审查的七文件差异。 |
| 独立定向静态诊断 | PASS：九份源文件的两处 bytes hash、确认章节 hash、七文件 Markdown 范围、12/2/3 唯一代码集合；逐项字段/来源/转换对账已完成。历史 registry 的纯静态反例确认三个新 profile 均不在旧接受集，形成 R1。 |
| 运行实现 / 外部 / 人工 | OIDC/HTTP、PostgreSQL、Host/Runner、浏览器/平台发布和独立人工客户验收均 `NOT RUN`；此次没有运行新设计 trace。 |

补充 CI 原始日志获取曾遇到 GitHub 网络连接失败；已读取的精确 head/job/step 状态是 CI 证据，不将无法取得的原始日志称为已复核。

下一责任方为设计修订者：先闭合 R1，重新审查最终 head。业务清单确认不能替代显式人类技术批准。本记录不授权实现、Git commit/push、合并或部署。

---

## 第二轮复审（2026-10-09）

- Reviewed SHA：`4bd1f0100a9ea4ddb2db071f153454557ac223cd`。
- Current base SHA：`79c1d55ceb491bb455dc00d1ff6b518d2f313194`。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。
- 第一轮 R1：`CLOSED IN DESIGN`；本轮未发现新增阻塞设计缺陷。
- Human 技术批准：`PENDING / NOT PROVIDED`。

本轮重新读取最新 Issue/PR、当前 base-to-head 的八份 Markdown 差异、新 producer/resolver 字段与 owner traces，以及精确 head CI；没有把修订者的修复说明作为接受证据。第一轮记录及其 reviewed SHA 保留，上述结论只作用于本轮修订。当前未执行的注册、实现与外部验收不成为这份 design-only PR 的新增实现要求。

### R1 闭合证据

[IP 独立 Platform 路径](../../module-specs/Module-Spec-001-IdentityPolicy.md#独立-platform-profile-registryproducer-与-exact-resolver) 已明确：

1. `im-ui-company-startup-v1` 是独立的三项构建期 Registry，分别对应 bundle、rules、vocabulary；每项有唯一拟 canonical SchemaRef，不能并入历史 im02/im06 集合或使用 generic/scoped schema 替代。Schema 的固定拟身份与运行时已发布事实分开。
2. `CompanyRuleSnapshotProducer@1.0` 与 `CompanyRuleSnapshotResolver@1.0` 使用新的 IP owning Platform 不可变存储，明确不写旧 `policy_snapshot`/scoped `policy_version`，也不使用旧 Handler。生产、读取请求与结果是封闭结构，包含完整 selector、native Ref、Hash 和受信 target。
3. Hash 覆盖完整 registry/profile/schema 身份、派生 policySetVersion、effectiveFrom 及正文；快照自身 Ref、snapshotId、publication 和可变当前性不进入自己的 payload。业务引用仍由独立发布事实绑定，不产生自引用循环。
4. record/read 具有独立 operation/version/purpose/action、完整请求 Hash、target 和当前主体 Decision/Grant。EP 在写入前校验 profile/业务语义，IP 在受保护读取前及提交/返回前重验；snapshot 保存成功仍不代表 PUBLISHED/USABLE。
5. EP producer 校验、公司发布/解析和准备 source/review/confirmation/start 明确消费新 resolver 的结果，业务字段统一从 `payload.policyDocument` 读取。Delta、Catalog 和 owner traces 与新路径一致。
6. `IP-257-006`、`IP-257-007` 和 `EP-257-010` 覆盖合法新路径、错误 key/SchemaRef/version/角色、旧 writer 继续拒绝新 profile、旧 reader 不路由新存储、新 resolver 不接受历史/generic/scoped 输入及历史 refs/hashes 保留。

上述设计修订直接消除了第一轮“新 profile 依赖冻结旧接受集”的反例。新路径尚未实现是声明的后续工作，不将未来 trace 或静态对账写为生产/持久化 PASS。

### 本轮完整字段对账

| 新边界 | 全部声明字段 / 约束 | 复审结果 |
|---|---|---|
| 构建期 Registry entry | registryKey、owner、reference、documentSchema；唯一三项；SchemaRef 的 kind/objectType/objectId/versionId/scope 精确匹配且无 contentHash | 与 EP 三个 profile 及 Catalog 相符；六个拟 UUIDv7 身份唯一；未注册状态明确。 |
| 新 snapshot payload | registryVersion、profileKey、policySetVersion、policySchemaRefs、effectiveFrom、policyDocument；schema 数组恰一项；code/version 派生 policySetVersion；完整 cv1 Hash | 三个角色与各自 closed policyDocument 一致，Hash 域在 Delta/EP/IP 中统一。 |
| Producer | 请求 snapshotId/payload；结果 policySnapshotRef/payload；预分配 ID；snapshotId 及业务版本唯一；同键重放与异内容拒绝 | 独立存储、语义校验、当前 record 授权、不可变 provenance 和 Receipt/整体回滚均已声明。 |
| Resolver | 请求 policySnapshotRef/registryVersion/profileKey/policySchemaRef；结果 policySnapshotRef/payload；objectId=snapshotId、scope={}、精确 id+hash、完整 selector、mirror/hash 校验 | 独立读取、当前 read 授权、原样返回与依赖错误/无 fallback 闭合；不从历史库或 scoped 版本取代。 |
| Publication / resolution | 原 outer/child refs、definition/range/semantic validation Hash、Human Actor/Decision、生效/取代/撤回和当前性字段 | 明确依赖新 resolver；正文位置已改为 payload.policyDocument；发布与保存、历史可读与当前可用继续分开。 |
| D14 消费与失败 trace | source/review/intent 的精确 publication/rule/template 集合、启动条件、文件条件和原意图恢复 | R1 修订没有削弱 1 类 TEXT Fact、完整 Product、四类保护 Evidence、12/2/3 必需集合或冻结 PROJECT_START；17 项设计 trace 均保持 NOT RUN。 |

### 本轮证据与剩余门禁

| 证据 | 实际结果 / 边界 |
|---|---|
| 最新 Issue/PR 与 `vibe repo --json` | Issue #257 仍为 T2 design-only；本地与远端 head 均为本轮 reviewed SHA；当前 base 已读回，复审开始时工作区干净。 |
| [CI run 37933759152](https://github.com/qzhike/zhiju-business-core/actions/runs/37933759152) | GitHub readback headSha 与本轮 SHA 相同；select/checks/Verify documentation/verify SUCCESS；Verify code 与 persistence 按纯文档路由 SKIPPED。复用该 revision-bound 配置目标证据。 |
| 定向静态诊断 | 八文件 Markdown 范围、base-to-head whitespace、三项 profile/six UUIDv7 唯一性、旧 registry/writer/reader 与当前 base 字节一致、IP 七项/EP 十项 trace 唯一且全部 NOT RUN 均通过。 |
| 业务确认与历史来源证据 | §1–2 与第一轮修订逐字节相同，确认范围 Hash 仍为 `8cabe2e26d2402660f92e3fec7b59daa595e6d5ae26df7af2560f4b080b5f64b`。因此保留第一轮实际模板读取/Hash 证据，不将其重新标为本轮客户、发布或运行验收。 |
| 运行 / 外部 / 人工 | 十七项行为 trace、真实 OIDC/HTTP、PostgreSQL、Host/Runner、浏览器/平台发布和独立人工客户验收全部 NOT RUN。 |

本轮 agent 设计对账没有剩余阻塞缺陷，但 [Issue #257 Verify](https://github.com/qzhike/zhiju-business-core/issues/257) 明确要求“Independent design review and explicit human technical approval”完成后才可冻结语义或宣布依赖实现 READY；当前 PR/owning Spec 仍注明 HUMAN TECHNICAL APPROVAL PENDING。因此角色结论为 HUMAN_REVIEW_REQUIRED，下一责任方是人类技术审查者，须明确批准本轮最终 SHA 的新 Platform 存储/registry/授权/发布与兼容边界。它不要求本设计 PR 提前实现这些后续能力，也不把业务清单确认或其他 PR 的批准继承为 #257 的技术批准。

第二轮记录是本地新增复审内容，不属于本轮 reviewed SHA；第一轮 REQUEST_CHANGES 记录继续仅描述原 SHA。本次仅更新正式审查记录并按用户授权提交复审 comment。

---

## 人类技术批准与最终审查结论（2026-10-09）

- Approved / reviewed SHA：`4bd1f0100a9ea4ddb2db071f153454557ac223cd`。
- Current base SHA：`79c1d55ceb491bb455dc00d1ff6b518d2f313194`。
- 批准来源：本次请求的用户在第二轮复审及剩余技术批准门禁已明确后，于当前对话回复“批准”。
- 独立复审：[PR #262 第二轮 comment](https://github.com/qzhike/zhiju-business-core/pull/262#issuecomment-6081763567)；R1 CLOSED IN DESIGN，本轮没有新增阻塞设计缺陷。
- Human 技术批准：`APPROVED 2026-10-09`。
- 最终 Reviewer outcome：`APPROVE`，作用于上述 design-only 修订；第一轮 REQUEST_CHANGES 与第二轮 HUMAN_REVIEW_REQUIRED 保留为各自时点记录。

记录批准前，已通过 `vibe repo --json` 和 GitHub PR readback 确认本地及远端仍为同一 approved SHA。本次批准覆盖该修订的新 Platform registry、canonical SchemaRef、producer/resolver、不可变存储、完整 Hash 域、当前授权、公司发布/解析与兼容/取代设计及 owner traces。§1–2 业务确认范围继续由原 bytes Hash 单独标识；SD257-SUPPORT 未选择、未批准。其他 PR 的批准不在本记录中继承或扩展。

本次已同步公司 Delta、D14 导航、Catalog 及 EP/IP Spec/Test 的真实设计批准状态；未改变 approved SHA 的业务清单、字段、Schema 身份、授权、Hash、转换或场景预期。新增复审/批准记录和这些状态元数据是尚未提交的本地改动，不属于 approved SHA。该设计的独立审查与人类技术批准门禁现已闭合，后续实现仍需其自身 NOW + READY、注册/持久化/执行接线和适用验证证据。

生产 Registry/Schema 未注册、能力未实现、实际公司 bundle/template/requirement/publication 未由本次批准形成；十七项行为 trace、真实 OIDC/HTTP、PostgreSQL、Host/Runner、浏览器/平台发布与独立人工客户验收仍为 NOT RUN。本次批准的动作范围为已复审技术设计及其批准记录。
