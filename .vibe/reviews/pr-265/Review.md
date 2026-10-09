# PR #265 独立实现审查

本文件保留两轮审查的独立证据。以下第一轮记录对应 `f42ca47`，已由修复提交纳入 `a7dfd3b`；其中当时的工作区与交付状态是历史事实。当前结论见文末[第二轮复审](#第二轮复审a7dfd3b)：`REQUEST_CHANGES`，R1/R3/R5 已关闭，R2/R4 尚未完整关闭。

## 审查对象与结论

- Issue：[#264](https://github.com/qzhike/zhiju-business-core/issues/264)，T2 有界工程实现。
- PR：[#265](https://github.com/qzhike/zhiju-business-core/pull/265)，OPEN / Draft。
- Reviewed SHA：`f42ca47b6546bab896f1df9e4bfd3bbabbe68b82`。
- Base SHA：`e8d05d6dccfe6034b241a8d0c4b8b49e255e4029`，PR 为一个提交。
- 审查日期：2026-10-09。
- Reviewer role outcome：`REQUEST_CHANGES`。
- 阻塞发现：R1–R5。独立反例直接调用该修订的源码，两个对照成立，十个契约预期断言失败。
- 人类门禁：既有设计批准绑定 `8e8d2715b815179e92a18f444fb0eca13d58d466`，见 [PR #261 正式记录](../pr-261/Review.md#人类技术设计批准8e8d271)。本次实现不能由该设计批准自动取得精确修订的实现技术批准。

本次先从最新 Issue、获批锁合同和 IP/TE/IG/Deployment owning 约束建立预期，再检查实际差异、producer/validator/preflight 和测试。浏览器读回的 PR head 与 `vibe repo --json` 及本地 HEAD 相同；没有修复产品代码。评审范围是内部描述符及拒绝边界，不要求本任务交付 OMP Driver、发布公司业务规则或真实运行链。

本正式记录是审查后新增的本地文件，不属于 reviewed SHA 或其 CI；未 commit/push。GitHub 评论的交付与本记录的 Git 交付分别记录。

## 独立预期与验收

预期成立的核心不变量：配置选择、安装观察、可物化锁分别验证；锁绑定获批精确证据和完整同 Scope 的 Run/Attempt/Package/lease/fencing；物化时刻须在锁的有效窗口内；canonical/hash 与实际 bytes/hash 分域；必需 owning 发布和部署事实缺失或漂移时拒绝；旧 synthetic/public 支持集保持原样。

| Issue 验收 | 独立判断 |
|---|---|
| 闭合 Schema、类型、producer/validator，拒绝未知字段/版本及非法引用 | 结构 Schema 为闭集；引用验证未限制 owning 类型及完整 Project Scope，且允许相互矛盾的双重 hash，见 R2。 |
| 三证据层、review/approval、Scope/Run/Attempt/Package/lease/fencing/validity 完整绑定 | producer 检查三层 hash 和生成时窗口；preflight 未重验锁窗口，approval 只比较 digest，fencing 类型不一致，见 R1/R3/R5。 |
| cv1 及 bytes 两个 hash 域、确定性与不可变旧输入 | 自身 hash 排除和 hash 形状分域存在；producer 返回深冻结锁。重新计算合法 lockHash 不能代替 owning 来源及审批身份校验，见 R2–R4。 |
| OMP + DeepSeek、工具闭集、空 Skill/MCP 与禁用能力、有界控制 | 显式常量、required 字段及工具/控制集合拒绝已实现；本次没有把这些声明当成部署隔离或真实 conformance。 |
| 发布规则/词表、输入输出、证据工具及部署事实的 preflight | 部分来源只有 digest 比较，startupRules 和工具依赖等必需 pins 缺少可信读回比较，见 R4。 |
| 完整 controlled fixture 与正负覆盖、兼容性 | 既有 CI 通过；新的独立反例暴露当前测试遗漏。差异未注册公开操作、selector 或新 TypedReference，也未放宽现有 dispatch/persistence。 |

## 受影响机器合同字段矩阵

以下覆盖新增三个证据层及 lock payload 的 declared 字段和 required/optional。闭合形状通过不代表其 owning 语义已满足。

| 合同 / 字段组 | Schema 字段与必填关系 | 独立结果 |
|---|---|---|
| ApprovedConfiguration 身份/证据 | 必填 configurationVersion、profileCode、selectionEvidence、designReview、technicalApproval、reviewedRevision、configurationHash | shape 与层 hash 生成成立；具体证据 Ref 的三层匹配存在 R3。 |
| ApprovedConfiguration runtime/model | runtime 必填 runtimeCode/productName/invocationMode/interactive；model 必填 provider/modelId/approvedModelVersion/effort/maxOutputTokens/maxContextTokens/maxTurns/costBudgetUsdMax | 固定 OMP/DeepSeek 身份和参数声明存在；形状不证明实际模型或设置已经生效。 |
| ApprovedConfiguration 工具/隔离/数据 | toolSurface 必填 allowedTools/uriOrSchemeToolArguments/rootPlainFilesOnly/permissionRules；skillAllowlist、mcpAllowlist、disabledCapabilities、isolationPolicy 必填；后两项全部已声明机制必填。dataPolicy 必填 customerMaterialEgress/requiresCustomerDataApproval/policy | 空和缺失名单区分，禁止额外工具/能力；实际部署仍需受信事实。 |
| ApprovedConfiguration 控制 | controlPolicy 必填 wallClockSecondsMax/workOrderSecondsMax/maxAttempts/dispatchObservationWindowSeconds/hostHeartbeatSeconds/runLeaseSeconds/stopGraceSeconds/runCostBudgetUsdMax/totalCostBudgetUsdMax/memoryBytesMax/pidsMax/outputBytesMax/supportedControls/unsupportedControls | 数值为获批闭集，支持和拒绝控制分别校验。 |
| InstallationObservation | 必填 observationId/observationVersion/observedAt/platform/cli/adapter/harness/observedCapabilities/unprobedItems/observationHash。platform 必填 osFamily/osRelease/kernelVersion/architecture；cli 必填 executableCode/resolvedExecutablePath/observedCliVersion/cliBinarySha256；adapter 必填 adapterCode/adapterVersion/sourceSha256/buildSha256；harness 必填 harnessId/harnessVersion | 分层验证存在；producer 拒绝 Darwin 替代 Linux 部署观察；preflight 部署 source 未覆盖所有运行 pins，见 R4。 |
| MaterializedLock 根与 identity | 必填 lockId/lockVersion/profileCode/identity/runtime/model/promptTools/templates/outputTools/boundary/lockHash；identity 必填 approvedConfigurationVersion/approvedConfigurationHash/installationObservationId/installationObservationHash/reviewedRevision/selectionEvidence/designReview/technicalApproval | lockPayload 同形但无自身 lockHash；自身 hash 排除正确。R3 的证据身份替换仍会产生可接受新锁。 |
| MaterializedLock runtime | 必填 executableCode/resolvedExecutablePath/observedCliVersion/cliBinarySha256/cliBuildSha256/cliDependencyLockBytesSha256/adapterCode/adapterVersion/adapterSourceSha256/adapterBuildSha256/harnessId/harnessVersion/hostImageDigest/hostOsRelease/hostKernelVersion/hostArchitecture/launcherVersion/launcherDigest/parserVersion/parserDigest | presence 不等于逐件部署核验；preflight deployment 只保存部分字段。 |
| MaterializedLock model | 必填 provider/modelId/approvedModelVersion/modelConfigHash/fixedVersionBinding/perInvocationVerificationRule/identityBindingPolicy/apiTransport/apiEndpoint/networkPolicy/dataPolicy | 固定版本证据存在性及部分 digest 比较存在；不是所有 pin 都有对应可信来源，见 R4。 |
| MaterializedLock promptTools/templates | promptTools 必填 systemPrompt/taskPrompt/effectiveSettingsHash/toolPermissionRules/toolAllowlist/skillAllowlist/mcpAllowlist/disabledCapabilities；templates 必填 templateRefs/ruleBundle/startupRules/vocabulary，templateRefs 非空 | 必需 prompt/vocabulary/template bytes 有语义检查；template/ruleBundle 要求 publicationReceiptRef。startupRules 未进入 preflight sources/匹配，见 R4。 |
| MaterializedLock outputTools | 必填 inputAliasManifest/preparationSource/preparationContext/outputProfile/outputSchema/reader/validator/renderer；manifest 必填 schemaRef/schemaVersion/bytesSha256；每个 ToolPin 必填 toolCode/toolVersion/codeRef/codeBytesSha256/runtime/dependencyLockBytesSha256/buildSha256/commandTemplate，runtime 必填 runtimeCode/runtimeVersion | preflight tool 匹配只检查 toolCode/version/codeBytes/build，未核 codeRef/runtime/dependency/command，见 R4。 |
| MaterializedLock boundary | 必填 policies/scope/analysisRequestKey/inputManifestBytesSha256/leaseId/fencingToken/issuedAt/validUntil/phase/outputRoot；policies 的 filesystem/network/tool/data/resource/control/retention/cleanup 全必填；scope 的 enterprise/project/task/workOrder/workOrderContract/run/attempt/package 全必填。frozenStartRef 是条件字段：INITIAL_SCOPE_RECOVERY 必有，PREPARING 不得有 | phase 条件检查存在；锁时刻重验、Scope Ref 精度和 fencing 类型分别存在 R1/R2/R5。 |
| 公共内部 pin/ref 结构 | PinnedRef 必填 ref/contentHash，bytesSha256/publicationReceiptRef 按用途条件必需；PublishedObject 两者均必填。四个 Ref kind 的结构字段分别声明，ScopeRef 中 enterpriseId/projectId 均非 required | 对需 Project Scope 的 owning 引用没有单独 required/type 限制；嵌套 Ref.contentHash 与 pin.contentHash 未比对，见 R2。 |

## 阻塞发现

### R1 — P1：preflight 没有重验锁自己的有效期

位置：[preflight 548–566](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L548)。

preflight 末尾只比较 trustedNow 与 customerDataAuthorization.validUntil；validateMaterializedLock 仅检查 issuedAt < validUntil，不接收当前时刻。使用原有效 fixture（issuedAt=2026-10-09T10:00:00Z、validUntil=2026-10-10T00:00:00Z）和完整来源，trustedNow 在 2026-10-09T00:00:00Z 或恰为 2026-10-10T00:00:00Z 时，均返回 admissible=true。既有 preflight 正例本身也在 issuedAt 之前。

生成时校验不能保证后续物化仍有资格。这违反 Issue 对过期 eligibility 不得产生可接纳锁及锁合同的当前许可要求。物化入口必须独立重验 [issuedAt, validUntil)，保留客户授权期限检查，并覆盖窗口前、起点、终点及窗口后。

### R2 — P1：引用验证允许未知类型、缺 Scope 与矛盾 hash

位置：[referenceErrors](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/contracts/src/d14-runner-execution-lock.ts#L1258)及 [PinnedRef Schema](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/contracts/src/d14-runner-execution-lock.ts#L545)。

独立从有效 producer 输入只改变一项，以下各自都被 producer 接受：

- boundary.scope.run.ref.objectType 改为 unregistered.foreign；
- boundary.scope.run.ref.scope 改为 {}；
- boundary.scope.package.ref.contentHash.digest 改为另一个有效 digest，外层 package.contentHash 仍保留原值。

命名 regex 不证明类型属于批准支持集；仅在 scope 字段存在时比较不能保证 owning Run/Task/Package 的完整 Project Scope；同一 pin 不能声明两个不同 canonical hash。应按 owning slot 校验支持的 kind/type、必需 Scope、精确版本/快照字段和嵌套/外层 hash 一致性，并拒绝非法引用。不要因此注册本任务的内部锁为公开 TypedReference。

### R3 — P1：审批/审查绑定只比较 digest，允许替换精确证据身份

位置：[producer 1677–1684](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/contracts/src/d14-runner-execution-lock.ts#L1677)。

将 payload.identity.technicalApproval.ref.objectId 改为另一合法 UUIDv7，保留原 contentHash，且 ApprovedConfiguration 完全不变，producer 仍生成有效锁。selectionEvidence/designReview 共用相同 digest-only 比较。

这不满足配置/锁之间的精确选择、独立审查及技术批准证据绑定，也会把未解析的新审批身份包装成 admissible。应比较完整被批准 pin/ref（kind/type/id/version/snapshot/Scope/hash 及适用 receipt），让任一证据身份替换失败，并补充 digest 相同但引用不同的负例。

### R4 — P1：preflight 的可信来源匹配没有覆盖必需 pins

位置：[D14MaterializationSources](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L111)、[matchToolPin](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L317)及 [policy matching](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L461)。

保持原完整可信 sources 不变、当前时刻在锁窗口内，独立反例分别修改 startupRules 的内外层 hash，或 reader.dependencyLockBytesSha256，并按公开 hash helper 重算合法 lockHash；两者均返回 admissible=true。startupRules 根本没有对应 source 字段或比较，tool 读回没有 dependency/runtime/command/codeRef 字段。另将 network policy source 的 registryKey/version 改为 unregistered.foreign/99.0.0，保留其 digest，也仍被放行。

因此当前入口不能实现必需规则/证据工具和精确 owning 来源缺失或漂移时拒绝。应为锁合同要求的 pins 建立完整可信读回映射，比较身份、版本、Scope、内容/实际 bytes 及适用发布关系；无法解析的必需 pin 必须明确拒绝。来自调用方的可信事实仍由调用方提供，不能以重新计算 lockHash 或来源标签替代实际来源匹配。

### R5 — P2：fencingToken 的类型与 owning TE/IG 不兼容

位置：[fencingToken Schema](https://github.com/qzhike/zhiju-business-core/blob/f42ca47b6546bab896f1df9e4bfd3bbabbe68b82/contracts/src/d14-runner-execution-lock.ts#L1104)及 TypeScript 类型第 391 行。

新锁将 fencingToken 定义为 SAFE_TOKEN 字符串，有效 fixture 使用 fence-0001；将其改为 owning Core 合法值 1 时 producer 抛 D14_LOCK_SCHEMA_INVALID。获批 [TE 控制接口](../../module-specs/Module-Spec-003-TaskExecution.md#d14-runner-首发六项控制提案256)明确为 NonNegativeInt；既有生成 [TE 类型](../../../contracts/src/generated/types/task-execution.ts)和 [IG 类型](../../../contracts/src/generated/types/integration-gateway.ts)也使用 Common.NonNegativeInteger。

这是同一 lease/fencing binding 的类型断裂；任意字符串不是现有 fencing 事实。应沿用 owning 非负整数类型及校验，覆盖合法整数和非法负值/小数/字符串，不通过修改既有公开合同放宽接受集。

## 独立验证证据

- `vibe repo --json`：PASS，repository=qzhike/zhiju-business-core，HEAD 精确等于 reviewed SHA。
- 浏览器独立读取最新 PR、Issue 和 [CI run 37928997997](https://github.com/qzhike/zhiju-business-core/actions/runs/37928997997)：run 绑定 f42ca47；select/checks/verify 成功、persistence 预期 skipped；summary 为 94 个测试文件、1899 个测试全部通过。结合实际改动范围、Draft 状态和未修改的 CI 配置，适用目标为 code。没有为重复现有证据重跑配置目标。
- `git diff --check f42ca47^ f42ca47`：PASS。
- 独立源码 focused diagnostic：`node node_modules/vitest/vitest.mjs run --config /private/tmp/pr265-review.config.mts --reporter verbose`，Node 24.19.0 / Vitest 4.1.10；临时文件 `/private/tmp/pr265-review-probe.test.ts` 与配置均在仓库外。alias 将 contracts/shared-kernel 指向源码，直接调用 reviewed revision 的 producer/preflight。结果：正例 producer+窗口内物化及错 policy digest 拒绝两个对照通过；R1 两例、R2 三例、R3 一例、R4 三例、R5 一例，共十个契约预期断言失败，进程 exit 1。
- focused 反例预期均来自既定合同；这是当前实现的失败证据，不是环境失败，也不是新的全项目 Gate。
- 正式记录只做 Markdown 格式、相对链接和工作区范围的 focused 检查；不把它宣称为 reviewed SHA 的内容或配置验证结果。

配置目标和语义反例分别保留：绿色 CI 不消除已复现的契约违反。修复需要转回 Implementer；新 head 应再次独立审查并提交适用 code/full 的当前证据。

## 未运行边界与交付

真实 OMP/DeepSeek 调用、Ubuntu/CLI/adapter/Host 部署及进程隔离、PostgreSQL、OIDC/public HTTP、IG→TE→EP 接纳链、RA-LOCK-001–014/IG-LOCK-001–005、Browser/platform 与独立人工业务验收全部 NOT RUN。这些事实不由本次 controlled 合同反例或原 CI补齐。

本次用户明确授权 PR comment，评论包含 reviewed SHA、REQUEST_CHANGES、R1–R5、CI 与独立失败证据以及 NOT RUN 范围；发布后须读回。该评论是普通 PR comment，不是 GitHub 原生 REQUEST_CHANGES review。本地正式记录未 commit/push；没有修改业务实现、合并、部署或关闭 Issue。

GitHub comment 已发布并独立读回：[审查评论 issuecomment-6081118264](https://github.com/qzhike/zhiju-business-core/pull/265#issuecomment-6081118264)。读回正文包含 REQUEST_CHANGES、精确 reviewed SHA、R1–R5、配置 CI 与十个独立失败断言、正式记录状态及 NOT RUN 边界；评论提交后输入框已清空。发布前再次读回 PR，仍为 Draft、一个提交且 commit 链接指向 f42ca47b6546bab896f1df9e4bfd3bbabbe68b82。

## 第二轮复审：a7dfd3b

### 审查对象与独立结论

- 用户授权：复审 PR #265 并提交 comments；没有产品修复、commit、push 或 merge 授权。
- Reviewed SHA：`a7dfd3b02e87f200a8883932a884e0f64d8239f9`。
- 上轮 SHA：`f42ca47b6546bab896f1df9e4bfd3bbabbe68b82`；本轮同时核对整个 PR 对 base `e8d05d6dccfe6034b241a8d0c4b8b49e255e4029` 的最终差异。
- 审查日期：2026-10-09；远程 PR 仍为 OPEN / Draft，两个提交。本地 `vibe repo --json` 为 PASS，repository 与 head 精确一致；开始复审时工作区干净。
- Reviewer role outcome：`REQUEST_CHANGES`。
- 剩余阻塞：R2、R4，均为 P1。21 项独立 focused diagnostic 中 14 项通过、7 项契约预期失败；不是环境失败。

独立读回最新 Issue、PR head、修复评论与 CI，并先按既有 Catalog、TE owning Contract 及锁合同建立预期。修复评论称 WorkOrderContract 尚无 canonical 拼写，这与既有权威和可执行注册冲突；修复提交新写入锁决策的 namespace 例外不能消除该冲突。本轮没有要求实现真实 OMP dispatch 或增加运行支持集。

### R1–R5 关闭状态

| 原发现                     | 当前判断         | 独立证据                                                                                                                                                                |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1：物化时未重验锁有效期   | 已关闭原发现     | preflight 新增自身窗口检查；窗口前与恰到 validUntil 均拒绝，恰到 issuedAt 接纳，客户授权期限仍单独检查。                                                                |
| R2：类型、Scope、双 hash   | 部分修复，仍阻塞 | 原未知 Run、缺 Project Scope、内外 Package hash 不同均拒绝；WorkOrderContract 白名单拒绝已注册合法类型，Contract/Package 的 namespace fallback 仍接受未知类型，见下文。 |
| R3：审批 pin 只比 digest   | 已关闭原发现     | producer 按完整 canonical pin 比较三类证据；保留原 digest 而替换 technicalApproval.objectId 已拒绝。                                                                    |
| R4：必需 pins 缺读回或比较 | 部分修复，仍阻塞 | 原 startupRules hash、reader dependency lock、错 policy registryKey 反例均拒绝；精确引用身份及发布回执仍未完整匹配，见下文。                                            |
| R5：字符串 fencingToken    | 已关闭原发现     | Schema 为 integer / minimum 0；合法 1 接纳，-1、1.5、字符串 "1" 均拒绝；既有公开 Core 合同没有改动。                                                                    |

### 字段矩阵复审增量

第一轮矩阵继续覆盖三个层与 payload 的 required/optional 字段；本轮核对修复后的形状和语义差异如下。

| 字段组                                                     | 当前修复与剩余限制                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity.selectionEvidence/designReview/technicalApproval  | 配置与 payload 的完整 pin 比较已实现；层 hash、reviewedRevision 和不可变生成保持。                                                                                                                                                                             |
| boundary.scope / outputTools preparation pins / outputRoot | 新增 per-slot kind/type/完整 Scope 与所有节点 pin hash 一致性；WorkOrderContract/Package 的前缀分支不构成类型闭集，合法 Contract fixture 仍使用错误拼写。                                                                                                      |
| boundary.fencingToken / issuedAt / validUntil              | owning 整数类型已恢复；preflight 独立重验锁窗口，且未移除客户授权期限。                                                                                                                                                                                        |
| sources.promptTools / startupRules                         | 新增必需来源及缺失拒绝；system/task prompt、有效 settings、permission rules 和 startupRules 有读回入口。拥有来源字段不证明完整 Ref 身份已核验。                                                                                                                |
| PUBLISHED template/ruleBundle/startupRules/vocabulary      | matching 仍只比较 digest、适用 bytes 和 receipt.objectId，不比 registryKey；读回类型没有完整 Ref/Scope/版本身份或完整 publicationReceiptRef。                                                                                                                  |
| OWNING input/output/prompt 与 boundary policies            | matching 新增 type/Scope/digest/适用 bytes；读回没有 objectId、kind、versionId/snapshotId/immutableVersionId，不能核对锁内完整引用。content-addressed pin 不含独立版本字段，不把来源 version-only 变化作为本轮新阻塞依据。                                     |
| tools.codeRef/runtime/dependency/command                   | reader/validator/renderer 的 code kind/type/id/Scope/digest、runtime、dependency、command 已进入比较；codeRef source 仍不能表达 applicable version/snapshot identity。                                                                                         |
| deployment/provider/data sources                           | 新增 CLI/build/dependency、Host/launcher/parser 与模型配置/策略 digests；deployment source 未表达 adapterCode/version、harnessId/version，provider/data 仍主要是 digest readback。它们不构成真实部署、公司身份或逐源发送许可证据；本轮 R4 以四个直接反例阻塞。 |

### R2 — P1：错误的 WorkOrderContract 白名单及开放 namespace 分支

位置：[anchor rules 1341–1371](https://github.com/qzhike/zhiju-business-core/blob/a7dfd3b02e87f200a8883932a884e0f64d8239f9/contracts/src/d14-runner-execution-lock.ts#L1341)。

[Catalog 唯一名称](../../high-level-docs/06-typed-references-contract-catalog-v0.1.md#im-06-workorder-validation--freezeready-注册提案)、[TE §21](../../module-specs/Module-Spec-003-TaskExecution.md#21-workorder-validation-与-freezeready-设计提案)及 [operation-registration.ts](../../../contracts/src/operation-registration.ts)均已定义并注册 `CONTENT_ADDRESSED / zhiju.contract.work_order`，Owner 为 task-execution；这不是尚待发明的拼写。新规则却只接受 `zhiju.execution.` / `execution.`，且多接受 VERSIONED kind，valid fixture 继续声明 `zhiju.execution.work_order_contract`。

从完整 valid producer 输入只改变 objectType，独立复现：

| 改动                                                                                    | 契约预期                     | 实际                  |
| --------------------------------------------------------------------------------------- | ---------------------------- | --------------------- |
| workOrderContract → zhiju.contract.work_order，保留 CONTENT_ADDRESSED 与完整 Scope/hash | 接纳已有合法 owning identity | producer 拒绝         |
| workOrderContract → zhiju.execution.unregistered_contract                               | 拒绝未注册类型               | producer 接纳并生成锁 |
| package → zhiju.runtime.unregistered_package                                            | 拒绝未支持类型               | producer 接纳并生成锁 |

实际合法 TE frozen Contract 无法进入此锁，而未知同命名空间身份可冒充 Contract/Package。这仍违反 Issue 的非法/未注册引用拒绝及精确 owning binding。使用已有 Catalog 的 Contract type/kind，修正 valid fixture 和错误的“尚无 canonical 拼写”说明；Package 必须使用获批有界类型支持集，不能把尚未确定的引用放宽为整个 namespace，也不因此注册内部锁为公开 TypedReference。覆盖上述合法对照与同 namespace 未知类型负例。

### R4 — P1：必需来源仍不能证明完整 Ref 与发布关系

位置：[templateRefMatchesFact 375–380](https://github.com/qzhike/zhiju-business-core/blob/a7dfd3b02e87f200a8883932a884e0f64d8239f9/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L375)、[matchOwningObject 418–432](https://github.com/qzhike/zhiju-business-core/blob/a7dfd3b02e87f200a8883932a884e0f64d8239f9/modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts#L418)及可信来源 interfaces。

当前 matching 不比较 PUBLISHED registryKey，publicationReceiptRef 仅核 objectId；OWNING source 缺 objectId 和完整 Ref。保持完整原来源与窗口内时刻，以下四项独立契约预期均失败：

1. 只将 sources.startupRules.registryKey/version 改为 unregistered.foreign/99.0.0，保留原 digest；preflight 接纳。
2. 只替换 templates.templateRefs[0].ref.objectId 为另一合法 UUIDv7，保留原内容、bytes 与原 receipt；preflight 接纳。
3. 只替换 outputTools.preparationSource.ref.objectId，保留原 type/Scope/hash；preflight 接纳。
4. 只替换模板 publicationReceiptRef.contentHash.digest，保留原 receipt objectId；preflight 接纳。

后三项均重算自身 lockHash，并先断言 validateMaterializedLock.valid=true，所以失败不是 tamper/hash 校验跳过导致。来源保持不变，仍然只解析过原身份及原发布关系；这些新引用没有对应精确 owning 事实。相同内容不证明另一个 PreparationSource 或发布回执已存在/已发布，也不证明另一个 Ref 已获许可。新文档对 content-addressed version-only 情况的说明不解决这四个身份替换。

必需 readback 要能表达完整适用 Ref（kind/type/id/version/snapshot/Scope/hash）与发布回执，并在 admission 前核对精确身份、内容/bytes 和发布关联；保留本轮已增加的缺失/漂移拒绝。不能用 provenance 字符串、同 digest 或重新计算 lockHash 代替解析。补充同 digest、不同完整 Ref/receipt 及错误 published registryKey 的负例。

### 当前证据与未运行边界

- [CI run 37935252981](https://github.com/qzhike/zhiju-business-core/actions/runs/37935252981)独立读回：页面与 PR commit 绑定 a7dfd3b，select/checks/verify 成功，persistence 为预期 skipped；94 个测试文件、1932 个测试通过。实际 diff 没有持久化/验证策略变化，PR 仍 Draft，适用 code；复用当前 CI，没有重复执行配置目标。修复评论的本地 vibe verify code PASS 与 focused 95 passed 是 Implementer 提供的另一份证据，不冒称本 Reviewer 重跑。
- `git diff --check e8d05d6dccfe6034b241a8d0c4b8b49e255e4029 a7dfd3b02e87f200a8883932a884e0f64d8239f9`：PASS。
- 独立源码 diagnostic：`node node_modules/vitest/vitest.mjs run --config /private/tmp/pr265-rereview.config.mts --reporter verbose`，Node 24.19.0 / Vitest 4.1.10；临时完整输入来源 helper 与断言位于 `/private/tmp/pr265-rereview-probe.test.ts`。直接导入 current source，contracts/shared-kernel alias 指向源码；21 项中 14 通过、7 失败（R2 三项、R4 四项），exit 1。两个对照、第一轮十个反例的修复预期、issuedAt 起点及非法 fencing 组均通过。失败保留为实现缺陷证据，不替代配置 Gate。
- 本轮只修改正式 Review.md，保留第一轮历史；新增复审正文不属于 reviewed SHA/CI，未 commit/push，做 focused Markdown 格式与链接检查。
- 真实 OMP/DeepSeek、Ubuntu/CLI/adapter/Host 部署及隔离、PostgreSQL、OIDC/public HTTP、IG→TE→EP、RA-LOCK-001–014/IG-LOCK-001–005、Browser/platform 和独立人工业务验收仍全部 NOT RUN。绿色 code CI 和 controlled fixture 不补齐这些事实。
- 人类技术设计批准仍绑定既有设计修订；没有把设计批准解释为当前实现修订批准，也未合并 PR。

本轮结论和证据通过用户已授权的普通 PR comment 发布，并在发布后读回。它不等于 GitHub 原生 REQUEST_CHANGES review；本地复审文档的 Git 交付尚未授权。R2/R4 返回 Implementer，在修复后的新 head 再独立审查。

第二轮 comment 已发布并刷新远程页面读回：[复审评论 issuecomment-6082458439](https://github.com/qzhike/zhiju-business-core/pull/265#issuecomment-6082458439)。永久链接点击后的地址栏确认该 ID；正文保留精确 reviewed SHA、R1/R3/R5 关闭、R2/R4 两项 P1、21 项诊断的 14 通过/7 失败、当前 CI 与 NOT RUN。Conversation 为四条评论，输入框清空；PR 仍 Draft、两个提交，最新 commit 仍是 a7dfd3b02e87f200a8883932a884e0f64d8239f9。本轮工作区只有此正式记录新增复审正文，未 commit/push。
