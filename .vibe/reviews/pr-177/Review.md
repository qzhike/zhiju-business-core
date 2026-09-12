APPROVE

复审 PR #177 / Issue #175，reviewed SHA：`dfd1861689004848eecd9288bd54872e160b21c0`。

上次 `903f23a` 的 [P2] `TaskDefinitionV2.inputRefs` 数组收窄问题已修复。本次独立审查修复增量、最新 Issue/comments、owning Spec/Test 与契约证据，未发现新的阻塞问题。

- v2 显式使用 `inputRefs: array(typedReference)`，没有修改 v1 的共享属性表；`dependencyTaskRefs` 仍为 Set。
- 独立调用当前构建的正常 Registry 路径，`inputRefs=[]/[R]/[R,R]` 全部 PASS，完整请求序列化结果保持不变。
- 新增回归对非数组、畸形 Ref、重复 dependencyTaskRefs 分别断言预期字段与 Schema keyword；v1 单项通过/重复项拒绝的对照继续成立。
- Spec/Test/Catalog/API Contract 已同步记录 v2 普通数组与 v1 历史实现偏差；无历史 Compatibility Baseline 改写或业务范围扩张。
- 原审查字段矩阵中 `TaskDefinitionV2.inputRefs` 本次转为 PASS；其他字段结构、required/optional、Criterion 分支、注册元数据与纯绑定校验没有在修复中改变。

验证：

- Reviewer：`pnpm exec vitest run contracts/src/operations/task-execution.schema.test.ts contracts/src/registry.test.ts` → 68/68 PASS。
- Reviewer：`pnpm contracts:check` → 生成 PASS；Catalog/Registry=209；compatibility=PASS，历史 baseline=200。
- 当前 SHA 的 [CI verify](https://github.com/qzhike/zhiju-business-core/actions/runs/34670766407/job/103491566561) 为 SUCCESS：普通测试 760 passed / 321 skipped，PostgreSQL gate 336 passed，日志明确输出 `gate passed`。采用该 revision 绑定的完整 CI 证据，本轮不重复运行本地完整目标。

Task Handler、业务持久化链、Readiness/Completion、业务 E2E、真实 Runtime/Feishu 与人工验收仍为 NOT IMPLEMENTED / NOT RUN。Schema/纯绑定 PASS 不证明 Policy/Evaluator 的真实存在、版本支持、有效性或授权。

本条是 PR comment 中的独立 Reviewer 结论，不是 GitHub formal APPROVE review，也不授权 merge。正式复审记录同步保存在 `.vibe/reviews/pr-177/Review.md`，保留此前 REQUEST_CHANGES 的历史证据。


## 历史审查：903f23a

REQUEST_CHANGES

审查 PR #177 / Issue #175，reviewed SHA：`903f23ae4a97a0a04a52a5b4006d0aedb6bd1c6a`。

### 阻塞问题

**[P2] TaskDefinitionV2.inputRefs 将已批准的数组契约收窄为 Set**

位置：[task-execution.schema.ts:325](https://github.com/qzhike/zhiju-business-core/blob/903f23ae4a97a0a04a52a5b4006d0aedb6bd1c6a/contracts/src/operations/task-execution.schema.ts#L325)，由第 369 行的共享属性展开进入新 v2 Schema。

Spec 003 §2 明确 `inputRefs: TypedReference[]`，相邻的 `dependencyTaskRefs` 才是 `Set<ObjectRef<Task>>`；§11.6 规定 TaskDefinitionV2 仅替换 expectedOutputSpec/completionCriteria。因此新 v2 的 inputRefs 应允许重复引用。当前复用旧 Schema 的 `array(typedReference, { unique: true })`，将旧实现偏差带入了新 Major。保持 v1 实现不变不能作为新 v2 偏离已批准字段契约的依据。

独立复现：读取本 PR 的 `tests/fixtures/contracts/task-v2/create-task-v2-command-valid.json`，取其合法 `payload.projectRef` 为 R，仅改变 `payload.definition.inputRefs`，调用正常 `ContractRegistry.validateOperation('execution.create_task', '2.0', command)`：

| inputRefs | Registry 结果 | 纯绑定结果 |
|---|---|---|
| `[]` | PASS | PASS |
| `[R]` | PASS | PASS |
| `[R,R]` | FAIL，仅 `/payload/definition/inputRefs` 的 `uniqueItems` | PASS |

这会拒绝按 Spec 构造的合法 v2 请求。请让 **v2** 的 inputRefs 使用普通 TypedReference 数组，保留 v1 当前 Schema/历史 Compatibility Baseline，补充上述三组正向对照及非数组/畸形 Ref 的定点负例。请勿通过去重改写用户输入，也不要把本修复扩展成未授权的 v1 契约调整。

### 审查覆盖

独立读取了 Issue、当前 owning Spec/Test、Core ExpectedOutput、实际 diff、Registry/注册元数据、生成类型和正反向测试。Target=`zhiju.execution.task`、CREATE、Owner、Purpose、projectRef canonical 类型、新版本正常解析、五类 Criterion 与三类 bindings、重复 criterionId/未解析 slot 的纯绑定拒绝均已核对。未把 Evaluator/Policy 的存在性或真实授权归入 Schema PASS。

### 验证证据与边界

- 当前 SHA 的 [CI verify](https://github.com/qzhike/zhiju-business-core/actions/runs/34670161617/job/103489903276) 为 SUCCESS；实际日志显示普通测试 758 passed / 321 skipped，PostgreSQL gate 测试 336 passed，并输出 `gate passed`。
- Reviewer 执行 `vibe verify full --json`，普通沙箱与提升权限重试均完成 clean、格式、lint、typecheck、758 项测试、架构、生成与兼容性检查；均在容器启动阶段因 `Could not find a working container runtime strategy` 返回 VERIFY_FAIL。故不声明 Reviewer 本地完整目标 PASS，也不将此环境问题归因于产品实现；持久化通过证据取自上述同 SHA CI。
- Catalog/Registry=209；历史 Compatibility Baseline=200，compatibility=PASS。
- 上述 inputRefs 反例通过当前构建的公开 Registry 独立运行，证明绿色回归未覆盖该契约缺口。
- Task Handler、业务持久化链、Readiness/Completion、业务 E2E、真实 Runtime/Feishu 和人工验收：NOT IMPLEMENTED / NOT RUN。

本次发布为 PR comment，不是 GitHub formal review。结论交回 Implementer 修复，修订后需重新审查最新 SHA。


### 字段矩阵

| 契约 | 字段与必填性 | 核对结果 |
|---|---|---|
| CreateTask v2 payload | projectRef、definition 必填；initialAssignee 可选 | canonical Project Ref；V2 引用；开放 assignee，与设计一致 |
| TaskDefinitionV2 | taskType/title/objective/priority/riskLevel 必填 | NamespaceCode/NonEmptyString，与设计一致 |
| TaskDefinitionV2 | deliveryItemRef/parentTaskRef/dueConstraint 可选 | VersionedRef/ObjectRef/CanonicalJson，保留既有结构 |
| TaskDefinitionV2 | dependencyTaskRefs 必填 | 可空且 unique，与 Set 一致 |
| TaskDefinitionV2 | inputRefs 必填 | **FAIL：普通数组错误附加 uniqueItems** |
| TaskDefinitionV2 | expectedOutputSpec/completionCriteria 必填 | 引用新 closed shape |
| TaskExpectedOutputSpec | schemaVersion/outputs 必填 | 1.0；ExpectedOutput[] 可空，Schema 无 uniqueItems |
| Core ExpectedOutput | outputSlot/allowedObjectTypes/cardinality/requiredReferenceStrength/creationRequired/acceptancePolicyRef 必填 | 复用 Core Schema，六项均在 required 中 |
| Core ExpectedOutput | requiredTargetRelation/schemaRef/qualityStageRequired 可选 | Core 对应字段存在且非 required |
| TaskCompletionCriteria | schemaVersion/criteria 必填 | 1.0；非空 unique criterion 集合 |
| TaskCriterionV1 | criterionId/criterionType/required/evaluatorRef/bindings/expectedCondition/failureDisposition 全部必填 | 七项均存在；五类枚举；boolean；VersionedRef；三个 closed 分支按类型约束；satisfied=true；BLOCK/REQUIRE_HUMAN_REVIEW |
| bindings | outputSlots 或 scope 必填 | NonEmptySet<NamespaceCode>；两类 scope 分别 const，未知字段关闭 |

正式记录依 AGENTS.md 与 Issue #175 的关闭前审查要求保存在此；未修改实现，未 commit/push/merge。
