APPROVE

当前批准 SHA：`b834f072cd3b199693723131096abd8f2a8d4266`；R1/R2/R3 均已关闭，exact-head CI 全部通过，独立实现复审无新的阻塞问题。用户于 2026-10-10 在第三轮复审后明确回复「批准」，本实现精确修订人类技术批准 gate 已闭合。前两轮 REQUEST_CHANGES、第三轮 HUMAN_REVIEW_REQUIRED 及各自验证证据完整保留；当前结论见末尾的人类技术批准补录。

---

REQUEST_CHANGES

# PR #268 独立实现审查

- 日期：2026-10-10。
- Issue：[#267](https://github.com/qzhike/zhiju-business-core/issues/267)。
- PR：[#268](https://github.com/qzhike/zhiju-business-core/pull/268)，Draft。
- Reviewed SHA：`97a79b27767f5cd7c5f2d89a766803e1b3e48bf5`。
- Base SHA：`5ddf79d4940fd3d049e5d86c0ac4692e0e587b90`。
- Reviewer outcome：`REQUEST_CHANGES`；两项 P2 阻塞实现问题。
- 实现修订的人类技术批准：`PENDING / NOT PROVIDED`；PR #262 的设计批准不能继承为实现批准。

从 Issue 的 Goal/Acceptance/Scope/Verify、已批准公司 Delta、EP/IP owning Spec/Test 和共享引用/持久化规则建立预期，再对照实际 42 文件差异、当前源码和测试。此次仅审查公司前置定义、受控授权、保存/发布/撤回/精确解析与兼容性；D14 客户消费者不在本切片内。没有修复产品代码，本正式记录不属于 reviewed SHA。

验收预期是：独立三项 registry 与完整 canonical payload 精确匹配；九模板、十二 requirement、完整必需规则/词表和实际来源均可验证；保存不等于发布；真实 Human 批准与 SERVICE 自身当前权限分别绑定完整请求；失败无部分 publication/Receipt/Audit；历史 payload 保持不变，当前并存/生效/取代/撤回独立解析；依赖错误保留安全、可判定的 owning 外观。

## 阻塞发现

### R1 / P2：requirement 来源集合按 UUID 校验，拒绝规格允许的 code/locator 顺序

定位：[company-startup-handlers.ts:291](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/modules/enterprise-project/src/business/company-startup-handlers.ts#L291)。

[EP Spec 的 canonical 规则](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/.vibe/module-specs/Module-Spec-002-EnterpriseProject.md#L1030)要求集合按 code 稳定排序；[#267 requirement 规则](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/.vibe/module-specs/Module-Spec-002-EnterpriseProject.md#L1057)明确来源绑定按模板 code/locator 排序。实现却在解析模板 code 之前要求数组与 `templateRef.objectId + ':' + locator` 的 UUID 顺序一致。

直接反例：通过既有 owning import/publish 合法发布全部九模板，但先导入 S4、后导入 S1，使 `S4.objectId < S1.objectId`。`zhiju.requirement.qms.design_development` 的完整来源为 `S1:7.3` 和 `S4:1-2`；按规格的 code 顺序提交 S1、S4 时，当前有权的 `importRequirement` 返回 `COMPANY_RULE_DEFINITION_INVALID`。同样的正式 refs、源字节、文本、适用条件、规范引用和当前权限，以 UUID 顺序 S4、S1 提交则成功。探针为正负对照使用不同新 definitionVersion，排除了业务唯一性冲突；其余输入均通过真实来源校验。

影响：合法公司定义能否导入取决于此前模板的创建顺序，按 owning 契约构造的完整定义被拒绝，九模板/十二 requirement 的真实生产入口不能保证闭合。既有测试按 S1 至 S9 创建模板，并用相同 UUID 排序生成输入，因此没有覆盖这个契约反例。

修复要求：在当前授权下精确解析来源模板后，按 owning code/locator 规则验证 canonical 来源集合，并继续绑定完整请求和 payload Hash；补充模板导入顺序与 code 顺序不同的 owning PostgreSQL 对照。不要静默改写已批准的排序语义来适配实现。

### R2 / P2：精确解析的依赖 session 异常没有转换为安全 owning 错误

定位：[company-rule-handlers.ts:653](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/modules/identity-policy/src/commands/company-rule-handlers.ts#L653)，调用链为 [readOwn:244](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/modules/identity-policy/src/commands/company-rule-handlers.ts#L244) → [composition dependencySession:57](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/apps/api/src/composition/company-rule-entry.ts#L57)。`validateDefinition` 也在 IP 事务异常转换边界之前调用。

Issue Acceptance 和 [IP 解析契约](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/.vibe/module-specs/Module-Spec-001-IdentityPolicy.md#L1120)要求依赖不可用沿用安全错误语义，不伪装缺失。[EP 错误规则](https://github.com/qzhike/zhiju-business-core/blob/97a79b27767f5cd7c5f2d89a766803e1b3e48bf5/.vibe/module-specs/Module-Spec-002-EnterpriseProject.md#L1048)明确使用 `DEPENDENCY_UNAVAILABLE`/安全授权外观。

直接反例：实际发布完整合法 bundle，并取得当前 `identity.company_rule.read` Decision；正常 composition 对完全相同的请求返回 `USABLE`。只把受信 `dependencySession()` 改为拒绝一个普通 `Error('PRIVATE_COMPANY_DEPENDENCY_SESSION_DETAIL')`，`identity.resolve()` 即原样抛出该 Error，`code` 为 undefined，message 为原始依赖细节。此时来源读取为零；这不是 ref/hash 错误、权限拒绝或不存在的 publication。

影响：依赖认证/session 服务故障不能由消费者按约定识别为依赖不可用，而且原始下层异常文本越过 owning Port 的安全边界。已有 source、verifySession 和数据库故障测试分别位于有异常转换的路径，不能证明此处安全。

修复要求：覆盖精确解析的 `readAuthorization`、`validateDefinition` 等外部依赖调用，保留已有 `CompanyStartupError` 的 owning code，把未分类异常转换为无下层 message 的 `DEPENDENCY_UNAVAILABLE`；补充合法同请求成功与 dependencySession 普通异常失败的对照，不返回 payload 或启用 fallback。

## 完整字段与契约对账

| 边界 | 已逐项对照的字段与约束 | 结果 |
|---|---|---|
| registry | registryVersion；三项 profiles 的 registryKey/owner/reference/documentSchema；reference 的 kind/objectType/objectId/versionId/scope；六个批准 UUIDv7 身份、唯一项和逐字节 generated mirror | 接受集独立且封闭；没有扩大历史 im02/im06 registry。 |
| snapshot payload | registryVersion/profileKey/policySetVersion/policySchemaRefs/effectiveFrom/policyDocument；恰一个 canonical SchemaRef、派生 code/version identity、毫秒 UTC、完整 cv1 Hash | 共享字段 validator 与 owning writer/reader 对应。 |
| bundle policyDocument | bundleCode/bundleVersion；supportedRange 的 rangeCode/productTypeCodes/marketCodes/standardTargets/upgradeTargetRef/targetImplementationDate；startupRulesRef/vocabularyRef；templateBindings 的 templateCode/templateRef/sourceBytesSha256；requirementBindings 的 requirementCode/requirementRef；compatibility 的 reportProfile/ruleProfile/vocabularyProfile/requiredFactValueTypes；可选 supersedesBundleRef | 完整九模板/十二 requirement、批准范围/目标与 child refs 均检查。 |
| rules policyDocument | rulesCode/rulesVersion/mandatoryFactTypes/requiredProductFields/minimumProductVersions/protectionEvidenceRequirements/mandatoryRequirementCodes/mandatoryChoiceKeys/mandatoryDecisionTypes/allowedStartupOutcomes/supportSet | owning validator 对照完整已确认集合，未选择的结构化 Fact 支持集被拒绝。 |
| vocabulary policyDocument | vocabularyCode/vocabularyVersion/entries；entry 的 domain/code/label/meaning/sourceBindings/ownerMapping；sourceBindings 的 templateRef/locator/sourceBytesSha256；ownerMapping 的 owner/field/value | 检查封闭 domain、完整 domain+code 集合、正式映射与实际来源，不推断客户事实。 |
| requirement | requirementCode/definitionVersion/text/applicabilityConditions/templateSourceBindings/normativeReferenceRefs；sourceBinding 三字段、NonEmptySet 与规范 Set；完整批准文本/条件/定位及 published 来源 | R1：canonical 集合排序的接受集与 owning Spec 不符。 |
| producer | 请求 snapshotId/payload；结果 policySnapshotRef/payload；Ref 的 kind/objectType/objectId/snapshotId/scope/contentHash，objectId=snapshotId；完整请求 Hash 与预分配 target | 独立不可变 storage、唯一性、成功 Receipt 和结果失败回滚路径存在。 |
| resolver | 请求 policySnapshotRef/registryVersion/profileKey/policySchemaRef；结果 policySnapshotRef/payload；完整 selector/native Ref/Hash/promoted 镜像 | 不路由历史/scoped 存储，不使用 latest 或 generic fallback。 |
| semantic validation | validatorProfileRef/validatedPayloadHash/validatedChildRefs/validatedAt；outer 两 child，child 无 child；完整 payloadHash 和 schema identity | IP 重新核对 EP 结果；没有以 caller 相同字符串代替实际 owning 校验。 |
| publication request/proof | 请求 publicationId/outer 与两 child refs/approvedDefinitionHash/approvedRangeHash/effectiveFrom/可选 supersedesPublicationRef；proof payload 的 bundleCode/bundleVersion/outer 与两 child refs/两批准 Hash/semanticValidation/actorSnapshotRef/authorizationDecisionRef/effectiveFrom/recordedAt/可选 supersedesPublicationRef | 完整 Human intent 与 SERVICE 自身 Decision 分开；proof 在 bundle 之后形成，无 hash 自引用。 |
| withdrawal | 请求 withdrawalId/publicationRef/reason/effectiveFrom；结果 withdrawalRef/payload；payload 的 publicationRef/reason/effectiveFrom/recordedAt/actorSnapshotRef/authorizationDecisionRef | 追加独立事实；不 UPDATE 历史 snapshot/publication。 |
| resolution | 请求 outer 与两 child refs/publicationRef；结果 snapshots/publication/currentUseStatus/checkedAt/sourceWatermarks/reasons；watermark 的 owner/sourceRef/checkedAt/可选 effectiveFrom；四种 current status | 并存、future/实际 successor、撤回分开；R2：事务前依赖异常越过安全边界。 |
| authorization proof/session | proof 的 session/actorSnapshotRef/authorizationDecisionRef；session 的 principalId/authenticationContextHash/expiresAt；完整 Platform refs、当前 verified HUMAN/SERVICE、九项 operation@1.0/purpose/action、完整 target/requestHash | AGENT/RUNTIME/actingFor、普通 Enterprise 权限及借用其他 action 均被拒绝；当前撤权检查与历史 lawful publication 分开。 |
| authority payload | Actor 的 kind/principalId/principalKind/scope/authenticationContextHash/expiresAt；Grant 的 kind/principalId/operation/version/purpose/action/target/policySnapshotRef/validFrom/validUntil/issuedByPrincipalId/authenticationContextHash；Decision 的 kind/principalId/principalKind/actorSnapshotRef/grantRef/operation/version/purpose/action/target/requestHash/outcome/issuedAt/expiresAt/可选 humanIntent | 当前 Principal、Grant/Policy、认证摘要、期限、独立 Human intent 按精确操作重验；专用 immutable provenance 与技术角色边界可定位。 |

所有声明的 Set/NonEmptySet 与普通数组分别核对；未把 semantic child refs、sourceWatermarks 或 reasons 的普通数组擅自提升为 Set。结果检查不能替代 R1/R2 所需的语义与依赖边界修复。

## 验证证据与边界

| 证据 | 本轮实际结果 |
|---|---|
| `vibe repo --json` 与 GitHub head readback | repository/branch/head 与 reviewed SHA 一致；审查开始时工作区干净。 |
| base-to-head `git diff --check` | PASS，覆盖实际 PR 差异；新增正式记录另有 focused Markdown integrity 与 Prettier check PASS。 |
| `vibe verify environment --json` | PASS，exit 0；当前 Docker context、PostgreSQL 18.6/Flyway 11.20.3 固定 tag/digest 均匹配。首次只读 Docker probe 受沙箱 socket 权限限制；相同只读 probe 的获准执行已通过。 |
| `vibe verify full --json` | NOT COMPLETED：clean、格式/lint/typecheck、普通测试 94 files / 1,842 tests、workspace、architecture、contracts 阶段通过；完整 Persistence 回归在两项阻塞反例确认后由 Reviewer 主动停止。仅向该 Vibe 进程树的 persistence Vitest 发送 SIGINT（Vitest exit 130），原 gate 的 finally 已移除容器；Vibe 返回 VERIFY_FAIL（configured command exit 1，Vibe CLI exit 21）。这是主动取消证据，不推断产品测试失败，也不能称 full PASS。PR 作者此前的 full 摘要未作为本轮独立证据。 |
| 独立 PostgreSQL 反例 | 已确认 R1/R2；1 file、2 probes passed、15 原测试按显式 name filter skipped，exit 0。这里的 PASS 表示复现与对照断言成功，不表示两个缺陷已修复，也不替代 full。全部 72 migrations 至 V7017 成功，第二迁移 no-op，临时数据库已移除。 |
| [CI run 37965808799](https://github.com/qzhike/zhiju-business-core/actions/runs/37965808799) | exact head；select/verify FAILURE，checks/persistence SKIPPED。读取 CheckRun annotation 确认为账户付款/额度限制；失败 job 无 runner、无执行 steps。远端 CI verification `NOT RUN`，不是已执行的代码测试失败。 |
| 外部/人工 | 实际公司发布/客户适用性、D14 preparation/report/start/initial-scope 消费、OIDC/public HTTP、Host/Runner、公司流程 browser/platform、生产与独立人工业务验收均 `NOT RUN`。 |

反例位于仓库外 `/private/tmp/pr268-independent-review/tests/persistence/company-rule-review.test.ts`，复用本 head 的实际构建 owning libraries 和控制来源，仅改变模板合法导入顺序及受信 dependencySession 的失败行为。命令为在该临时目录运行原 `tools/persistence/gate.mjs --test-file=tests/persistence/company-rule-review.test.ts --test-name-pattern=PR268`，使用已核验的 pinned pnpm 与 Docker host；临时 workspace 明确复用既有依赖，不进行安装。首次 focused attempt 在临时 workspace 的 pnpm dependency 同步检查阶段退出，测试未运行且容器已清理；修正临时 workspace 设置后才得到上述证据，项目配置、锁文件、实现和 tracked tests 未修改。

下一责任方为 Implementer：修复 R1/R2，补齐相应回归，再对最终 head 独立复审；精确修订的人类技术批准和远端 CI delivery gate 仍须分别闭合。本轮只按用户授权提交 PR comment，并保留本地正式审查记录；不 commit/push、修复产品代码或 merge。

## 第二轮：修复后的独立实现复审

- 日期：2026-10-10。
- Reviewed SHA：`357141642d888f0e8156b0d2de5b888c3d35e0b4`。
- Base SHA：`5ddf79d4940fd3d049e5d86c0ac4692e0e587b90`。
- 上轮 reviewed SHA：`97a79b27767f5cd7c5f2d89a766803e1b3e48bf5`。
- Reviewer outcome：`REQUEST_CHANGES`；R1/R2 产品修复均关闭，新增 R3 / P2 验证阻塞。
- 当前实现修订的人类技术批准：`PENDING / NOT PROVIDED`。

依据最新 Issue #267 的 Goal/Acceptance/Scope/Verify 和 EP/IP owning Spec 重新建立预期，独立检查新 head 的修复差异、调用边界和回归对照，并将其对照到第一轮已审查的完整 PR 范围及字段矩阵。修复提交仅改变两处 owning 实现、对应 PostgreSQL 回归与两份 Module-Test 的证据描述，未改变 registry、SchemaRef、closed 字段、授权接受集、迁移或公共契约。既有实现已在上下文中，本轮不声称是 blind review。

### R1 关闭：按实际模板 code/locator 校验完整来源顺序

[EP 实现:289–295](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/modules/enterprise-project/src/business/company-startup-handlers.ts#L289) 在当前授权与精确 published 模板/字节/locator 校验之后，按调用方原顺序取得实际 `code:locator`，与批准的 canonical 序列逐项比较。移除了 UUID 排序前提，也不再先排序实际绑定后掩盖错序；没有改写请求或 payload。

独立 PostgreSQL 对照继续使用九模板合法逆序创建、S4 UUID 小于 S1 UUID 的原反例：完整 `zhiju.requirement.qms.design_development` 按 S1:7.3、S4:1-2 顺序 import/publish/read 成功，返回原 payload 与完整 cv1 Hash；UUID 顺序 S4、S1 以独立新 definitionVersion 提交被拒绝，requirement 和 Receipt 均为零，输入保持原值。tracked 回归还检查完整 request Hash 的 Receipt 与不变性；逆序 fixture 同时用于其余公司规则场景。

### R2 关闭：事务外回调保留 owning 错误并转换未分类异常

[IP dependency:89–95](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/modules/identity-policy/src/commands/company-rule-handlers.ts#L89)、[readOwn:252](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/modules/identity-policy/src/commands/company-rule-handlers.ts#L252) 和 [resolve:667](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/modules/identity-policy/src/commands/company-rule-handlers.ts#L667) 覆盖读取授权与定义校验回调，record/publish 的同类调用也使用同一转换。已有 `CompanyStartupError` 原对象/code 保留；其他异常转换成 message 与 code 均为 `DEPENDENCY_UNAVAILABLE`、不含原 message/cause 的安全错误。授权前后重验、完整 selector/hash、精确 payload 返回和无 fallback 行为保持。

独立 PostgreSQL 对照先合法保存并发布完整 bundle，同一当前有权请求得到 `USABLE` 和原 snapshots。分别在 snapshot 读授权与 EP 校验 session 边界注入同步 throw、异步 rejection，各覆盖普通 Error、原始字符串异常和已有 owning 错误，共十二个失败组合；普通异常安全转换、owning 错误保持原对象，全部 EP source-byte reads=0。恢复后同一请求返回与成功对照完全相同的结果。

### R3 / P2：新增 R2 owning PostgreSQL 回归未声明完整链路所需的有界 timeout

定位：[company-rule.test.ts:913–967](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/tests/persistence/company-rule.test.ts#L913)，[失败 CI job](https://github.com/qzhike/zhiju-business-core/actions/runs/38008679887/job/114083403259)。

该用例在 test body 内创建完整新 bundle、实际发布、建立读 Decision、执行两次成功 exact resolution，以及两处 session 边界的四个 owning 失败对照；这些都经过真实 PostgreSQL 与独立当前授权检查。它在第 967 行以无 timeout 参数的 `});` 结束，persistence config 也没有覆盖默认 testTimeout。CI 实际报告 `Test timed out in 5000ms`，这是本 run 唯一失败的 test，导致 mandatory full 的 persistence 和 verify 失败。同文件较长 owning 场景已有 `120_000` 的显式预算。

独立十二组合对照使用显式 120,000ms budget 成功，R2 probe 的实际用时 4,955ms，支持产品异常转换修复的语义闭合，同时说明这个完整 owning trace 对默认 5 秒余量很小。当前 CI 超时没有报告安全错误/Hash/授权断言失败，不能据此把 R2 产品缺陷重新打开；但新增必需回归没有稳定通过配置的 gate 仍是阻塞。

修复要求：为此用例分配与同类完整 owning trace 相称的显式、有界 timeout，保留全部成功/失败、原 owning 错误和安全外观、当前授权与源字节读取对照；重跑所需 `vibe verify full --json` 并取得新 head 的通过证据，再对新 head 独立复审。无需放宽生产 authorization/error 契约或全局测试策略。

### 本轮字段与契约对账

第一轮完整字段矩阵中的 registry/schema/payload、producer/resolver、publication/withdrawal/resolution、授权与 provenance 字段在修复提交中没有变化，仍按完整 accepted/rejected 边界逐项对照；第一轮 R1/R2 结果属于旧 SHA。以下是本轮受影响边界的更新结果：

| 边界 | 字段及约束 | 本轮结果 |
|---|---|---|
| requirement | requirementCode/definitionVersion/text/applicabilityConditions/templateSourceBindings/normativeReferenceRefs；sourceBinding 的 templateRef/locator/sourceBytesSha256；完整 NonEmptySet、exact published 来源、code/locator 顺序与完整请求/payload Hash | R1 CLOSED；code 顺序与创建顺序独立，错序拒绝且没有成功事实。 |
| snapshot read 依赖 | policySnapshotRef/registryVersion/profileKey/policySchemaRef；当前独立读权和完整 selector/hash | R2 CLOSED；读取授权普通失败转换，原 owning 错误保留，未放宽输入/输出。 |
| EP semantic 依赖 | 请求 snapshotId/payload；结果 validatorProfileRef/validatedPayloadHash/validatedChildRefs/validatedAt | R2 CLOSED；回调失败转换，完整 payload/schema/child refs 的结果校验保留。 |
| publication/current-use | 完整 outer/child refs、批准两 Hash、真实 Human Actor/Decision、生效时间与四种状态、sourceWatermarks/reasons | 请求和返回契约不变；独立探针恢复后返回原 snapshots 和同一当前性。 |

没有把普通数组改为 Set，也没有增加 required/optional 字段或缩小既有授权接受集。IP-257-003 和 EP-257-005 的记录只增加定义/解析回归子迹；较大客户消费者场景仍保留 NOT RUN。

### 本轮验证证据

- [当前 exact-head CI run 38008679887](https://github.com/qzhike/zhiju-business-core/actions/runs/38008679887)：`select / checks PASS`，`persistence / verify FAILURE`；run 已完成，head_sha 精确为本轮 reviewed SHA。这是实际测试失败，不是此前观察命令的网络超时或第一轮账户限制。
- 已读取 checks 原始日志：checkout 为将 reviewed head 合入上述未变 base 的 PR merge revision；实际执行 `pnpm clean && pnpm verify:code`，94 files / 1,842 tests、workspace/browser 工程外壳、architecture、registry/type/catalog 和 compatibility baseline 均 PASS。
- 已读取 persistence 原始日志：[新 R2 用例](https://github.com/qzhike/zhiju-business-core/blob/357141642d888f0e8156b0d2de5b888c3d35e0b4/tests/persistence/company-rule.test.ts#L913) 报告 `Test timed out in 5000ms`。完整结果为 49 files passed / 1 failed、656 tests passed / 1 failed，总耗时 2,410.76s；Vitest 与 gate exit 1，gate finally 已移除临时容器。测试失败后的 second migrate/no-op 检查未执行，不能把 focused probe 的结果算作本次 CI full PASS。
- 所需 full 证据采用上述当前 CI 的 code + 独立 clean build/persistence + verify 汇总；本轮没有重跑同一完整目标。当前 full gate 为 FAIL，作者的本地 PASS 摘要不能覆盖 exact-head CI 的这项失败。

- 独立 focused PostgreSQL diagnostic：`1 file / 2 probes passed / 17 tracked cases explicitly skipped`，exit 0；这里的 PASS 表示 R1/R2 修复及成功/失败对照成立。九模板/十二 requirement 的 setup 经真实 owning import/publish 形成，全部 72 forward migrations 至 V7017 成功，第二次 migrate no-op，临时容器已清理。此探针不替代 full。
- 探针位于仓库外 `/private/tmp/pr268-independent-review/tests/persistence/company-rule-rereview.test.ts`。对新 head 的 owning modules/composition 执行 focused TypeScript build 后，复用当前受控 fixture，只增加独立反例及回调失败对照；未修改产品实现或 tracked tests。
- 复用相同 Docker runtime 的既有 `vibe verify environment --json` PASS；本轮 diagnostic 再次实际核验固定 PostgreSQL 18.6/Flyway 11.20.3 镜像与服务器版本。
- base-to-head whitespace check PASS；正式记录的 focused Markdown integrity/formatting 检查 PASS。
- 实际公司发布/客户适用性、D14 preparation/report/start/initial-scope 消费、OIDC/public HTTP、Host/Runner、公司流程 browser/platform、生产和独立人工业务验收仍为 `NOT RUN`。受控测试的 Human/session/源字节/批准事实没有被当成真实公司或客户发布。

### 当前责任方与交付状态

[Issue #267 Verify](https://github.com/qzhike/zhiju-business-core/issues/267) 明确要求独立 exact-revision implementation review 和适用的人类技术批准；IP/EP owning Spec 同样要求为实现修订另行取得批准。当前 PR 没有对 `357141642d888f0e8156b0d2de5b888c3d35e0b4` 的人类技术批准。PR #262 批准的是 design-only 修订，不能继承为本实现批准。当前先由 Implementer 修复 R3 的验证阻塞并重跑 full，再对新 head 独立复审；适用的人类技术审查与精确修订批准仍须随后取得。因此本轮结论为 `REQUEST_CHANGES`，先处理已知验证失败，保留人类批准 gate。

本轮按用户授权提交了 [新 PR comment](https://github.com/qzhike/zhiju-business-core/pull/268#issuecomment-6092001288)，并读回核对全文、角色结果和 reviewed SHA 完全一致；发布后 PR head 仍为本轮 reviewed SHA。第一轮 comment 与正式记录保留。正式记录在 reviewed commit 外，本地未 commit/push；没有产品修复、Git 提交/推送或 merge。comment 是角色审查结论的发布，不是 GitHub 的正式 APPROVE review。

## 第三轮：R3 修复后的独立实现复审

- 日期：2026-10-10。
- Reviewed SHA：`b834f072cd3b199693723131096abd8f2a8d4266`。
- Base SHA：`5ddf79d4940fd3d049e5d86c0ac4692e0e587b90`。
- 上轮 reviewed SHA：`357141642d888f0e8156b0d2de5b888c3d35e0b4`。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`；R1/R2/R3 全部关闭，未发现新的阻塞问题。
- 本实现精确修订人类技术批准：`PENDING / NOT PROVIDED`。

本轮重新读取最新 PR/Issue、EP/IP owning #257 权威章节和当前验证证据，按原批准契约确认预期：code/locator 来源顺序独立于 UUID 创建顺序；解析依赖错误保持安全 owning 外观；真实当前授权、完整成功/失败对照和必需 full gate 不因修复被弱化；本实现修订需要另行人类技术批准。完整实现及前两轮独立反例已有上下文，本轮不声称 blind review。

### R3 关闭：完整 owning 回归采用显式有界 timeout

从上轮到本轮的完整 diff 仅为 [company-rule.test.ts:967](https://github.com/qzhike/zhiju-business-core/blob/b834f072cd3b199693723131096abd8f2a8d4266/tests/persistence/company-rule.test.ts#L967) 的 `});` 改为 `}, 120_000);`。预算与同文件较长 owning 场景一致，未改全局配置、产品实现或断言。逐项检查仍保留：完整 bundle 实际保存/发布、当前独立读 Decision、同一 request 的 `USABLE`/原 snapshots 成功对照、两处 session 边界各自普通/typed error 对照、普通异常的 sanitized code/message 与无 cause、原 owning error 对象保持、零 EP 源字节读取，以及恢复后的原结果相等。

[当前 exact-head persistence job](https://github.com/qzhike/zhiju-business-core/actions/runs/38013215918/job/114097729882) 原始日志明确记录该 R2 回归 `state=passed; elapsedMs=9603`；完整 company-rule 文件 17 个用例均 PASS。9,603ms 已超过先前默认 5,000ms，证实原验证阻塞的修复有效。没有跳过用例或通过减少断言取得结果。

### 既有修复与字段契约对账

R1/R2 的 owning 代码和前两轮字段矩阵在此一行测试修复中均未变化。第二轮独立 PostgreSQL 成功/失败对照归属其 reviewed SHA，不声称本轮重新执行；本轮通过实际完整 delta 和当前 CI 对照确认它们继续适用于相同实现。当前 CI 中 R1 逆序九模板创建/code-locator 正序回归 PASS（354ms），R2 安全依赖错误回归 PASS（9,603ms）。

| 边界 | 本轮 diff 与字段/接受集核对 | 结果 |
|---|---|---|
| requirement 与 EP validation | requirementCode/definitionVersion/text/applicabilityConditions/templateSourceBindings/normativeReferenceRefs、实际 code/locator 顺序、九模板/十二 requirement、完整 payload/request Hash 均未变化 | R1 CLOSED；完整 owning 回归 PASS。 |
| snapshot producer/resolver 与 IP dependency | snapshotId/payload、完整 native Ref/registry/profile/SchemaRef selectors、封闭结果与安全错误均未变化 | R2 CLOSED；当前授权及所有原错误/源字节读取对照保留并 PASS。 |
| publication/withdrawal/resolution | outer/child refs、批准 Hash、Human Actor/Decision、独立当前授权、四种状态与 sourceWatermarks/reasons 均未变化 | 第二轮契约结论继续有效；当前 17 项公司 owning 场景全部 PASS。 |
| registry/schema/collections/persistence | closed 字段及 required/optional、Set/NonEmptySet/array、历史公开接受集、独立 storage/ACL/RLS、V7016/V7017 均未变化 | 第一轮完整字段矩阵保留；本轮未引入契约扩展。 |

没有新的阻塞性代码、契约、范围或 durable knowledge 问题。旧轮次的 R1/R2/R3 发现及失败/取消证据作为历史保留，不代表当前 head 仍有这些缺陷。

### 当前修订验证证据

- [Actions run 38013215918](https://github.com/qzhike/zhiju-business-core/actions/runs/38013215918)：head_sha 精确为本轮 reviewed SHA，`COMPLETED / SUCCESS`；`select / checks / persistence / verify` 全部 SUCCESS。原始 checkout 日志为将此 head 合入未变 base `5ddf79d` 的 PR merge revision `5777b76`。
- 当前 `.github/workflows/ci.yml` 与 package scripts 对照：checks 执行 `pnpm clean && pnpm verify:code`；独立 persistence runner 执行 `pnpm clean && pnpm build` 后运行原 persistence gate；verify 必须收齐所选结果。该组合覆盖 Issue 要求的 configured full gate，当前 full CI 为 PASS。
- checks 原始日志确认普通测试 `94 files / 1,842 tests PASS`，格式/lint/typecheck、workspace 工程外壳、architecture、registry/type/catalog generation 和 historical compatibility PASS。工程外壳 browser fixture PASS 不代表公司业务流程人工或 browser/platform 验收。
- persistence 原始日志确认 `50 files / 657 tests PASS`，公司规则 17 项均实际执行并通过。服务器为 PostgreSQL 18.6，Flyway 11.20.3；应用迁移至 V7017，第二次 migrate 报 `No migration necessary`，容器已移除。完整测试耗时 2,414.40s，job 成功结束。
- 作者的本地 full/focused PASS 摘要保持为作者报告；本轮独立结论采用上述当前 CI 原始结果。没有仅为重复可信当前 CI 而重跑配置 full，也没有重跑未变 owning 代码的独立诊断。
- base-to-head `git diff --check` PASS；本地正式审查记录另执行 focused Markdown integrity 与 Prettier check。
- 实际公司发布/客户适用性、D14 preparation/report/start/initial-scope 消费、OIDC/public HTTP、Host/Runner、公司流程 browser/platform、生产和独立人工业务验收均继续 `NOT RUN`。

### 剩余人类技术审查 gate 与交付状态

[Issue #267 Verify](https://github.com/qzhike/zhiju-business-core/issues/267) 及 IP/EP owning Spec 明确要求独立精确修订实现审查及适用人类技术批准。读取当前全部 PR comments 和 reviews：只有前两轮 agent comment，reviews 为空，没有对本轮 SHA 的明确 Human 技术批准。PR #262 的设计批准不批准本实现。

独立 agent 实现复审已完成且无新阻塞发现；下一责任方是适用的人类技术审查者，评估 Platform storage/registry、当前授权、不可变发布/当前性、迁移与兼容边界，并把明确结论绑定到 `b834f072cd3b199693723131096abd8f2a8d4266`。因此为 `HUMAN_REVIEW_REQUIRED`，不能以 agent comment 代替该批准。本轮只按用户授权发布 comment、保留正式审查记录；正式记录在 reviewed SHA 外且本地未 commit/push，未修复产品代码或 merge。

本轮 [PR comment](https://github.com/qzhike/zhiju-business-core/pull/268#issuecomment-6092675840) 已成功发布，读回全文与准备内容一致，包含正确角色结果和 reviewed SHA；发布后 PR head 仍为本轮 SHA，PR 维持 OPEN / Draft。正式审查记录 focused Markdown integrity 与 Prettier check 均 PASS。

## 人类技术批准补录

- 日期：2026-10-10。
- 批准来源：本会话用户在第三轮独立复审结论、精确 reviewed SHA 和待人类技术批准 gate 已明确说明后，回复「批准」。
- 批准的实现 SHA：`b834f072cd3b199693723131096abd8f2a8d4266`。
- Base SHA：`5ddf79d4940fd3d049e5d86c0ac4692e0e587b90`。
- Human technical approval：`APPROVED`。
- 人类批准后的 Reviewer outcome：`APPROVE`。

记录批准前重新读取 PR 当前状态，head 与已复审修订一致；当前 exact-head [CI run 38013215918](https://github.com/qzhike/zhiju-business-core/actions/runs/38013215918) 的 select/checks/persistence/verify 均 SUCCESS。复用第三轮独立语义复审及完整当前 CI 证据，没有产品、测试或契约修改，也没有重复运行 full。历史第三轮结论记录当时尚未取得批准的事实，当前人类批准在此追加，不改写旧证据。

批准针对 #267 这一有界内部公司规则发布/精确解析实现及已审查的 storage/registry、当前授权、不可变发布/当前性、迁移和兼容边界。来源为用户明确批准，由 agent 代为记录；不把此记录当成新执行的独立人工业务验收。实际公司发布、D14 客户消费者、OIDC/public HTTP、Host/Runner、公司流程 browser/platform、生产及独立人工业务验收的 `NOT RUN` 边界保持。

本次批准闭合实现人类技术 gate；正式审查记录仍在批准 SHA 外、为本地未提交文件。PR 仍为 OPEN / Draft。此次授权不包含 Git commit/push、merge、部署或迁移执行。

已发布 [人类批准记录 comment](https://github.com/qzhike/zhiju-business-core/pull/268#issuecomment-6092705484)，读回全文与准备内容一致；发布后 PR head 仍为批准 SHA。正式记录的 focused Markdown integrity 与 Prettier check PASS。该 comment 记录用户批准来源与当前 APPROVE 结论，不是 GitHub 正式 APPROVE review。
