# PR #265 独立实现审查

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
