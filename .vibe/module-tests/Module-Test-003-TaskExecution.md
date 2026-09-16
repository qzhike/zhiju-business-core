# Module-Test-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / PR #12 INTEGRATION GATE PASSED / IM-06 WI-01 APPLICATION & PERSISTENCE FOUNDATION PASSED 2026-09-08 / #158 CONTRACT SCHEMA REGISTERED 2026-09-10 / #159 ANSWEREDINFORMATIONREFS ARRAY COMPATIBILITY FIXED 2026-09-10 / #165 DRAFT VERSION PINS @1.1 CONTRACT VERIFIED 2026-09-11 / #167 INITIAL CONTEXT RESULT AND CANONICAL SNAPSHOTREF VERIFIED 2026-09-12 / #175 TASK V2 CREATION CONTRACT VERIFIED 2026-09-12 / #176 POLICY/EVALUATOR RESOLUTION SCENARIOS APPROVED 2026-09-12 DESIGN VERIFIED / #202 TASK DRAFT CREATION BOUNDARY APPROVED 2026-09-15 DESIGN STATIC CHECKS VERIFIED / #204 TASK DRAFT CREATION HANDLER, PORT, V3001 PERSISTENCE AND COMPOSITION ENTRY IMPLEMENTED 2026-09-15 REAL POSTGRESQL PASS / TASK READY AND OTHER IM-06 BEHAVIOR NOT RUN`

对应规格：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md)。

Runtime 原始协议与 TaskExecution API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项定义 32 个场景；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个保持 `NOT RUN`。6 个 additive Command proposal 在用户审核前不改变本文件当前 20 个 Command 的 Design Gate 基准。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| TE-API-D-001 | Design | TaskExecution Module Spec 与 Catalog | 20 Command、8 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=20 queries=8 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| TE-API-S-001 | Schema | 43 个 FULL 操作 Payload/Result Schema 注册到 `ContractRegistry` | Registry `operationCount=211`，本模块 43 项 `FULL`，已覆盖的 Payload/Result 正反向 Fixture 通过 `validateOperation`/`validateOperationResult` | Registry operationCount=211（#183 追加两个 IdentityPolicy PolicyVersion 操作），task-execution FULL=43；#158/#165/#175 专项正反向回归见 TE-API-S-019/021/022 | `PASSED` |
| TE-API-S-002 | Schema | `execution.create_task` 命令携带未知字段 `skipPolicyCheck` | Registry 拒绝 `/payload/definition/skipPolicyCheck` | `additionalProperties` keyword 触发 `/payload/definition` 错误 | `PASSED` |
| TE-API-S-003 | Schema | `execution.start_run` 携带负数 `fencingToken` | Registry 拒绝 `/payload/fencingToken` | `minimum` keyword 触发错误 | `PASSED` |
| TE-API-S-004 | Schema | `execution.accept_agent_result` 用 `objectRef` 而非 `contentAddressedRef` | Registry 拒绝 `/payload/agentResultRef` | `const` keyword 触发错误（`kind` 必须是 `CONTENT_ADDRESSED`） | `PASSED` |
| TE-API-S-005 | Schema | `execution.RunStarted` Event payload 包含 `leaseId`/`sessionToken` | Registry 拒绝 `/payload` | `additionalProperties` keyword 触发错误 | `PASSED` |
| TE-API-S-006 | Schema | `execution.RunTerminated` Event 使用不在 `RunStatus` 枚举内的状态 | Registry 拒绝 `/payload/terminalStatus` | `enum` keyword 触发错误 | `PASSED` |
| TE-API-S-007 | Schema | `execution.get_run_state` Result 包含未知嵌套字段 `executionSecret` | Registry 拒绝 `/runtimeBinding` | `additionalProperties` keyword 触发错误 | `PASSED` |
| TE-API-S-008 | Schema | `execution.get_usage_and_provenance` Result 表示 UNKNOWN usage | Registry 接受（UNKNOWN 是允许的 `presence`） | `validateOperationResult` 返回 `valid: true` | `PASSED` |
| TE-API-S-009 | Schema | freeze/submit/query 中的 WorkOrder、ProjectContext、AgentResult 使用无效字符串或空对象 | 复用已注册 Core Contract Schema 并拒绝无效 Contract；合法 Core Contract 通过 | 合法 WorkOrder Contract 通过；字符串/空对象在 5 个入口全部被拒绝 | `PASSED` |
| TE-API-S-010 | Schema | `create_work_order` 使用 `03-core-contracts.md` 的 Objective/TargetScope/Input/Capability/Output/Criterion/Policy/Budget/VersionPins | 权威结构通过；旧的 `summary` 等非基准字段被拒绝 | Core 共享 `$defs` 的权威结构通过；`objective.summary` 被拒绝 | `PASSED` |
| TE-API-S-011 | Schema | Completion Evaluation 使用合法 `SourceWatermark[]`，以及错误的 ObjectRef[] | 合法 Watermark 通过；ObjectRef 被拒绝 | 合法 Watermark 返回 `valid=true`；ObjectRef 返回 `valid=false` | `PASSED` |
| TE-API-S-012 | Schema | Task Board Result 缺 `snapshotAt`/`sourceWatermarks`，或携带完整 `Page<TaskBoardItem>` | 不完整 Page 被拒绝；完整 Page 通过 | `{items:[]}` 被拒绝；完整 Page 返回 `valid=true` | `PASSED` |
| TE-API-S-013 | Schema | Usage ValueEnvelope 为 UNKNOWN+value、PRESENT 无 value，以及合法 UNKNOWN/PRESENT | 两个非法组合被拒绝；两个合法组合通过 | 非法组合均返回 `valid=false`；合法组合均返回 `valid=true` | `PASSED` |
| TE-API-S-014 | Schema | `RunStarted.runtimeBindingSummary` 嵌套 `sessionToken`/`stdout`，以及合法安全摘要 | 敏感/未知字段被拒绝；安全摘要通过 | 安全摘要通过；嵌套 `sessionToken` 触发 `additionalProperties` | `PASSED` |
| TE-API-S-015 | Schema | `RunTerminated.terminalStatus` 为 RUNNING 与 SUCCEEDED | RUNNING 被拒绝；SUCCEEDED 通过 | `RUNNING` 返回 `valid=false`；`SUCCEEDED` 返回 `valid=true` | `PASSED` |
| TE-API-S-016 | Schema | `create_task.definition` 省略可选 `deliveryItemRef` | Registry 接受，且仍拒绝未知字段 | 省略后返回 `valid=true`；TE-API-S-002 继续拒绝未知字段 | `PASSED` |
| TE-API-S-017 | Schema Integration | 合并 PR #11 后，以其权威 Core WorkOrder fixture 验证 `freeze_work_order` 与 `create_work_order` | TaskExecution 直接复用 `core/work-order/1.0#/$defs/*`；合法 Core fixture 通过，既有 8 个非法反例继续被拒绝 | 初次 Gate 识别旧 builder 偏差；改为权威 fixture 并将 `requestedBy` 对齐 `PrincipalRef` 后，focused 35/35、全仓 106/106 通过 | `PASSED` |
| TE-API-S-018 | Schema Integration | 合并 PR #12 的 Artifact 26 个 FULL 操作与 TaskExecution 37 个 FULL 操作 | 聚合 Registry 同时注册两个模块；FULL=115、ENVELOPE_ONLY=85；两个模块的正反向回归全部通过 | 5 个 Test Files、118/118；Architecture、Public API generation、Catalog Registry 全部通过 | `PASSED` |
| TE-API-S-019 | Schema | #158 的 `get_work_order_draft@1.0` 与 `build_initial_context_snapshot@1.0`，包括精确 Ref、闭集字段、期限可选性、Draft/Result 结构与旧 `build_context_snapshot@1.0` 兼容边界 | 新 Query/Command 正向 Envelope、Query Result 与负向错分支/空 Slice/重复 Slice/非法期限/非法 CAS/旧字段输入按 Spec 通过或拒绝；旧合法 Contract 保持通过 | `task-execution.schema.test.ts` 6/6；与 `registry.test.ts` 合并 55/55；生成、目录计数与 TypeScript 类型检查通过 | `PASSED` |
| TE-API-S-020 | Schema/Compatibility | #159 的完整 frozen build Envelope 覆盖 `answeredInformationRefs=[]/[R]/[R,R]`，并以同一合法输入控制非数组、畸形 Ref、缺 `workOrderContractRef`、空/重复 `sourceSlices` | `[]`、单项和重复合法 Ref 均通过；非数组/畸形 Ref 仍在 intended 字段拒绝；ContractRef 仍 required，Source Slice 仍 minItems+uniqueItems；输入顺序、内容和 Envelope Hash 不被改变 | 修改前重复 fixture 仅因 `/payload/request/answeredInformationRefs` 的 `uniqueItems` 拒绝；修改后 `task-execution.schema.test.ts` 8/8 通过，重复输入保持长度 2 且未被 validator 改写；历史 baseline 不重写 | `PASSED` |
| TE-API-S-021 | Schema/Compatibility | #165 的 `create_work_order@1.1`、`get_work_order_draft@1.1`、`build_initial_context_snapshot@1.1` 与 `DraftVersionPins`/`InitialWorkOrderDraft` | @1.1 DRAFT 拒绝 `projectContextContractRef` 和 frozen Contract Ref；CREATE Envelope 固定 WorkOrder target 且拒绝 `expectedAggregateVersion`；合法 @1.1 链通过；旧 @1.0 create/draft/build 合法调用继续通过；生成类型与 Registry 计数同步 | `task-execution.schema.test.ts` 与 `work-order-context-binding.test.ts` 覆盖正反向契约，新增错误 target 与 CREATE CAS 反例；TE-WI02-D-013 覆盖 Context Ref 全字段相等与缺失/错误 Hash/Scope | `PASSED` |
| TE-API-S-022 | Schema/Compatibility | #175 的 `execution.create_task@2.0`、`TaskDefinitionV2` 与五类 `TaskCriterionV1`：错误 bindings 分支、未知字段、五类之外的 criterionType、任意 `expectedCondition` 表达式、重复 `criterionId`/`outputSlot`、未解析 output-slot 绑定、`inputRefs` 为 `[]`/`[R]`/`[R,R]` 与非法元素；对照 `create_task@1.0` 合法 fixture | @2.0 正向 Envelope 经正常 Registry 路径通过且固定 Task target/CREATE/Purpose；§2 的 `TypedReference[]` 允许重复引用且列表不被改写，非数组/畸形 Ref 仍在定点拒绝，`dependencyTaskRefs` 仍为 Set；上述其余负例分别由注册 Schema 或纯契约校验拒绝；`create_task@1.0` Schema（含历史 `inputRefs` `uniqueItems`）、合法调用与历史 fixture 不变；生成类型、Catalog/Registry 计数同步 | `task-execution.schema.test.ts` 覆盖正反向契约（Schema 与 `validateTaskDefinitionBinding`），`registry.test.ts`、生成检查与目录计数同步；Evaluator/Policy 真实存在与支持版本、READINESS 与业务 Handler 仍无实现 | `PASSED` |
| TE-API-U-001 | Unit | READY WorkOrder 请求扩大 target scope | 拒绝 `EXECUTION_WORK_ORDER_SPEC_IMMUTABLE`，要求新 WorkOrder | 无实现 | `NOT RUN` |
| TE-API-U-002 | Unit | 两个 Dispatcher 竞争同 WorkOrder active Run | 只有一个 claim/fencing token 生效，另一个返回 active conflict | 无并发实现 | `NOT RUN` |
| TE-API-U-003 | Unit | terminal Run 提交第二个不同 Hash final Result | Quarantine/replay conflict；不处理 BusinessOutput | 无实现 | `NOT RUN` |
| TE-API-C-001 | Contract | WorkOrder Contract 缺 base Revision Hash 或含 Human-only Agent Capability | Contract Validation 拒绝，不能 freeze/queue | 无 Schema/Fixture | `NOT RUN` |
| TE-API-C-002 | Contract | AgentResult 只有 scratch DOCX | Result 可记录但 ExpectedOutput 未满足；WorkspaceOutput 不提升 | 无 Handler/Evaluator | `NOT RUN` |
| TE-API-E-001 | E2E | final BLOCKED_INPUT→飞书答案→恢复 | 创建新 Answer/Context/Run；旧 Run 不 Resume、不改写 | 无 Runtime/飞书实现 | `NOT RUN` |
| TE-API-E-002 | E2E | Run timeout 后按 Policy fallback 到另一 Runtime | 新 attempt/Run/Token/Context 绑定；旧 Usage/Provenance 保留 | 无 Runtime 实现 | `NOT RUN` |
| TE-API-M-001 | Manual | CTX→WO→Run→Result Fixture | 审核者能区分 Run 成功、WorkOrder 完成与 Task 完成，并验证缺输入恢复链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 层 Contract（TE-API-S-001 ~ TE-API-S-022）均为 `PASSED`；TE-API-S-018 保留 PR #12 时的 200 项聚合基线证据；当前 Registry operationCount=211、FULL=211、ENVELOPE_ONLY=0、task-execution FULL=43，#158/#165/#175 的操作增量与 #159 数组兼容修复的 focused 与聚合回归均通过。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Context Builder、Dispatcher、Runtime、Evaluator、Persistence、Projection 与 Handler 实现均不存在；本阶段未声明 CLI 或 DB E2E 已运行。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 API proposal 尚未进入 Catalog 与本模块 Schema。
- 测试遗留：未创建临时脚本或临时测试文件；#158/#159/#165 的永久 Contract 回归位于 `contracts/src/operations/task-execution.schema.test.ts` 与 `contracts/src/work-order-context-binding.test.ts`，复用 `tests/fixtures/contracts/` 中的权威 WorkOrder、initial Context 和完整 frozen build fixture，与生产代码同源管理。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| TE-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| TE-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

Task Runtime、Dispatcher 循环、业务 Repository 与 payload↔hash Gate 仍为 `NOT RUN`。

## IM-06 技术设计验证矩阵

状态：已批准设计，关联 #152–#154 / TD-01–04。下表定义可执行回归的输入与预期；当前均未实现，不能因文档评审/现有full通过改为PASS。新增Schema/Handler/持久化测试在相应API与业务切片中落实。

| ID | 层级 | 输入/竞争/故障 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| TE-TD-001 | Contract/Persistence | 空业务库经owning入口创建Task/WO Draft、捕获Slice、首次Context、Validation、Freeze | DS-1→SS-1→CTX-1→Contract精确链，无占位Hash/悬空Ref，无跨Root写事务 | NOT RUN |
| TE-TD-002 | Contract | 旧build_context_snapshot缺ContractRef；新initial请求含旧ContractRef/未知字段 | 旧Schema仍拒绝；initial闭集拒绝错分支；旧合法fixture不变 | Schema boundary 已由 TE-API-S-019 覆盖；业务 Handler/Persistence 仍 NOT RUN |
| TE-TD-003 | Persistence | Builder查询Draft后并发Freeze或未来合法Draft换代；提交前故障 | stale请求拒绝，无成功Context；原Snapshot/Hash保留 | NOT RUN |
| TE-TD-004 | Unit/Persistence | Builder提交后Draft变化，再用旧Context冻结 | Freeze拒绝；旧Context只历史可读，不能create_run | NOT RUN |
| TE-TD-005 | Contract/Persistence | Slice错id/hash/Scope/Purpose/Audience/Policy，或伪造动态View Hash | 统一不可用，内部Audit原因准确；无Context发布 | NOT RUN |
| TE-TD-006 | Persistence | 同键重放capture/build/validation；同键异payload | 原事实原结果；无重复成功效果；异Hash冲突 | NOT RUN |
| TE-TD-007 | Unit/Contract | 伪造valid=true、五个不同Bundle验证Ref、kind/subject错配 | Judgment/Acceptance拒绝，不推进Run或Completion | NOT RUN |
| TE-TD-008 | Unit/Persistence | Judgment/Decision过期、输入版本变化；同一长事务中到期 | consumer重验失败；旧判断不可变，新判断新identity | NOT RUN |
| TE-TD-009 | Contract | Task v2错误criterion分支/重复ID/未知Policy/任意表达式；v1合法payload | v2拒绝且不READY；v1Schema不变，不回写旧定义 | Schema/纯绑定层已由 TE-API-S-022 覆盖（错误分支、未知字段、五类之外的 criterionType、任意表达式、重复 criterionId/outputSlot、未解析 output-slot 绑定均拒绝，`create_task@1.0` 合法 payload 与历史 fixture 不变）；Evaluator/Policy 真实存在与支持版本、READINESS 判定及业务 Handler 仍 NOT RUN | `NOT RUN` |
| TE-TD-010 | Persistence | 两Dispatcher同WO创建Run；不同attemptNumber抢ACTIVE | 仅一个ACTIVE，失败无孤立Run；fencing精确单调 | NOT RUN |
| TE-TD-011 | Controlled integration | 正常synthetic Driver ack；未调用Driver直造Receipt；Attempt绑定替换 | 仅真实合成调用可SUCCEEDED；TE拒绝伪造/错绑定；不声称Provider通过 | NOT RUN |
| TE-TD-012 | Controlled integration | dispatch timeout→same-key replay→真实readback | UNKNOWN不二次调用；调和不替换原request/binding | NOT RUN |
| TE-TD-013 | Persistence | final submit后进程崩溃，record前cancel/expiry | 只保留Result/隔离，不能业务输出；恢复调用owning Command | NOT RUN |
| TE-TD-014 | Persistence | record_run_result与cancel双连接竞争 | 一个状态转换获胜；CANCELLING不能接收可用Result；RESULT_RECORDED不能伪造取消确认 | NOT RUN |
| TE-TD-015 | Persistence | finalize与expire竞争；旧fencing；相同/不同Acceptance重放 | 单terminal+单RunTerminated+Claim释放；冲突不改旧结果 | NOT RUN |
| TE-TD-016 | Persistence | deadline未到期调用expire；CANCELLING无ACK到期 | 前者拒绝；后者ABANDONED非CANCELLED，旧Run不能Resume | NOT RUN |
| TE-TD-017 | Unit/Contract | final BLOCKED_INPUT且合法空业务输出；scratch DOCX | 可在执行边界ACCEPTED/SUCCEEDED；WO/Task仍未完成，scratch不满足ExpectedOutput | NOT RUN |
| TE-TD-018 | Unit/Persistence | Result已BLOCKED_INPUT但Request尚未创建；caller传blockingRefs=[] | 保守阻塞，不能利用异步窗口提前完成 | NOT RUN |
| TE-TD-019 | Controlled integration | Human确认CustomerMaterial，Answer引用精确candidate/confirmed/Source，resolve | EP attestation与实际Receipt/Decision匹配，RESOLVED；新Context/Run，旧hash不变 | NOT RUN |
| TE-TD-020 | Security | 未授权答案、Agent自采纳、别的CommandReceipt、同correlation但不同材料、未确认来源 | 拒绝，不清blocker；不把文本/投递成功当采纳 | NOT RUN |
| TE-TD-021 | Unit | 七类WO Criterion逐个缺事实/错Scope/provenance/未支持适配器 | 必要条件失败或UNSUPPORTED，无COMPLETED；显式保留解释 | NOT RUN |
| TE-TD-022 | Controlled integration | 历史RAS/ABS为READY/FULLY_APPROVED但已失效/撤销 | 当前eligibility false；新Task Completion/Readiness不通过 | NOT RUN |
| TE-TD-023 | Persistence | Task completion并发创建child WO/Request；WO/Task reconcile重放 | 固定parent锁顺序重读集合，单Root事务；无重复事件，不互写Root | NOT RUN |
| TE-TD-024 | Controlled cross-module | 实际TaskCompleted Outbox→Dispatcher watermark→EP Inbox；重复/乱序/异Hash/错Producer/Scope | 正确Producer链持久读回；重复幂等、异Hash隔离、低watermark不覆盖；Task-only不保证Delivery完成 | NOT RUN |
| TE-TD-025 | Security/Persistence | 各新表直接SQL、无Context、池复用、Scope镜像错、异常注入 | RLS/ACL/hash/immutable guard拒绝；技术事实原子回滚；池不继承上下文 | NOT RUN |
| TE-TD-026 | Query | Task历史COMPLETED而事实撤销；读取TaskState与依赖Readiness | 历史保持，completionUseStatus不可用，依赖不能仅凭status通过 | NOT RUN |

### WI-03 控制入口与拒绝反例

本表细化已批准 TD-02 / #153，不新增业务语义或 Runtime 控制能力。前置为合法同 Scope 的 Human Intent、各 Service 自身授权、已提交 frozen Contract/Context/Capability/Run/Attempt 和未过期有限 Policy；负例只改变列出的维度，所有未列字段均合法。完整 Driver 输入与观察来源见 [Runtime profile](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#受控-driver-输入输出与调度)，状态依据 Spec 003 §11.4/§11.5，API/Gate 对账见设计决定 §9.2。各行定义设计验收输入和预期，实际业务执行均 NOT RUN；不得用当前仓库回归替代。

| ID | 输入 / owning 入口 / 次序 | 预期读回与拒绝效果 | 当前结果 |
|---|---|---|---|
| TE-WI03-D-001 | 正常 Driver ack → IG exact binding → start → 合法 FINAL BLOCKED_INPUT/空输出 → submit/record → #154 validation/accept → finalize | Run SUCCEEDED 且单 terminal/Claim 释放；Result/Acceptance 精确关联；WO WAITING_INPUT，Task 不完成；Driver 不能提供 valid/accepted 布尔结论 | NOT RUN |
| TE-WI03-D-002 | 正常 ack，但 start_run 使用同 Scope 另一真实 Attempt；或任一 Contract/Context/Capability/RuntimeBinding 与原 Run 不符 | binding 校验拒绝，Run 不启动；不是“Attempt 存在且 SUCCEEDED”即可通过 | NOT RUN |
| TE-WI03-D-003 | 所有身份/Hash 正确，start 或 submit 到达时 lease 已过期；另对照未过期输入 | 过期分支拒绝/隔离，无可用 Result；未过期对照可继续；ACTIVE Claim 不因时间流逝被直接绕过，先由 expire_run 释放 | NOT RUN |
| TE-WI03-D-004 | 同 Run/Attempt/Scope 的 final payload，唯一变化为 runFencingToken 小于该 invocation token | 旧 fencing 拒绝/隔离，不创建可用 final reservation，不推进 Run/Completion | NOT RUN |
| TE-WI03-D-005 | R1 和 R2 都真实、同 Scope 且有效，R1 的 submission/ack 绑定引用 R2；保持其余结构/Hash 自洽 | 跨 Run callback 拒绝/隔离；两 Run 原事实不覆盖，不能靠重新计算 payload Hash 合法化绑定 | NOT RUN |
| TE-WI03-D-006 | 相同 Result identity/hash 重放 submit；分别使用同 identity 异 Hash、不同 identity 同 Hash 的冲突输入 | 相同事实重放原 Receipt，无第二 final；另外两项隔离/冲突，首个 Result 与 reservation 不替换 | NOT RUN |
| TE-WI03-D-007 | ack/start 后先 request_run_cancel 提交，再释放原 final 到 submit/record；对照为 record 先提交再 cancel | cancel 先到：CANCELLING，final 仅隔离；record 先到：RESULT_RECORDED，cancel 状态冲突。两者均不产生虚假 Cancel ACK/CANCELLED | NOT RUN |
| TE-WI03-D-008 | 显式 deadline 已到且 lease 未到、非 CANCELLING，expire_run(DEADLINE_EXCEEDED) 提交后才释放 final | TIMED_OUT + Claim 释放；late final 无业务输出/Completion。另用 reason 尚未成立的调用作反例，拒绝且不改变状态 | NOT RUN |
| TE-WI03-D-009 | CANCELLING 无 ack，等待实际 lease 到期后 expire_run(LEASE_EXPIRED)；再提交旧 final | ABANDONED，不是 CANCELLED；旧 Result 只隔离，旧 Run 禁止 Resume；恢复须新 Context/Run | NOT RUN |
| TE-WI03-D-010 | RESULT_RECORDED 与已提交 Acceptance；两个 owning 调用竞争 finalize/expire，再以相同与冲突 Acceptance 重放 finalize | Run 锁/CAS 只允许一个 terminal，Claim 原子释放、单 RunTerminated；旧 Acceptance 不能覆盖 expiry，重放不生成新版本/事件 | NOT RUN |
| TE-WI03-D-011 | final submit 提交后 record 前崩溃；以及目标 finalize 提交后 Process 进度保存前崩溃；相同 sourceFactId/hash/step 重试 | 扫描已提交事实并调用 owning Command/原 Receipt，最终单次效果；在空隙内取消/到期获胜时不提升 Result 资格；Process 不直接写 Root | NOT RUN |
| TE-WI03-D-012 | Human 直接冒用 create_run/validate/finalize 的 Service Purpose；Driver 回传 caller valid=true/desiredStatus；调用未批准 heartbeat/resume/usage/cancel-ack | 授权/契约边界拒绝，不执行控制写入；合法 Human queue/cancel Intent 与 Service 各自授权作正对照；UNKNOWN Usage 不填 0 | NOT RUN |

### WI-02 首次构建与冻结的细化场景

以下场景细化 TE-TD-001–008 和 TE-TD-019，唯一行为来源是 [Spec 003 §11.2](../module-specs/Module-Spec-003-TaskExecution.md#112-首次-context-的精确输入)。设计审阅逐项对照输入、预期及拒绝反例；业务 Handler、真实授权和 PostgreSQL 业务链不执行，保持 NOT RUN；本次新增的纯契约绑定校验单独标记实际结果。`TE-WI02-D-017`–`TE-WI02-D-020` 由 [Spec 003 §11.9](../module-specs/Module-Spec-003-TaskExecution.md#119-首批-policyevaluator-解析与消费时重验176-提案) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)（#176 已批准设计）拥有行为语义。[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 只交付三个 profile 的静态 registry/Schema 与纯校验，故 `TE-WI02-D-018`、`TE-WI02-D-020` 的 profile 注册与 closed 字段子集单独标记 `PASS`；`TE-WI02-D-017`、`TE-WI02-D-019` 与剩余部分保持 NOT RUN。

| ID | 层级 | 可审阅输入 / 拒绝反例 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| TE-WI02-D-001 | Contract/Persistence | 空业务库通过 owning 入口建立 Identity/EP 必需来源、Task、Draft，再 capture→build→validate→freeze；分别移除必需来源或用未来 ID/占位 Hash | 合法链逐步读回每个 exact Ref；缺输入拒绝，不要求历史 Context/Contract，不以直写伪造初始事实 | NOT RUN |
| TE-WI02-D-002 | Contract | 固定完整 candidate，包括签发时间；验证后仅改变 issuedAt、requestedBy、Context Ref 或 specificationHash；Freeze 使用当前 Query 的 CAS 版本 | 原 candidate 可继续 Freeze；任一绑定/Hash/归因不符均拒绝，不混淆 payloadHash 与 specificationHash，不硬编码 Root version | NOT RUN |
| TE-WI02-D-003 | Security/Persistence | Draft 不存在、错 Hash、错 Task/Scope；合法 Draft pointer 换代；Slice 分别错 Purpose/Audience/Policy；Builder 使用无权来源 | 按 Spec 失败矩阵拒绝；无成功 Snapshot/Validation，不泄露其他 Scope 对象存在性；安全 Audit 保留内部原因 | NOT RUN |
| TE-WI02-D-004 | Persistence | 双连接控制 Builder 发布前与 Freeze 的锁顺序；另测 Builder 提交后输入失配、两个 Freeze 同版本 | 前者按持锁顺序只使用有效 DRAFT；后者旧 Snapshot 仅保留历史；Freeze 只有一个 frozen binding，失败事务不写其他 Root | NOT RUN |
| TE-WI02-D-005 | Persistence | 依次在 Slice 提交后、Context 写入后提交前、Context 提交后响应前、Validation 提交后、Freeze 写入后提交前/提交后响应前注入异常 | 未提交目标整体回滚，已提交上游事实保留；同键重试返回原成功 Ref/Receipt 或安全继续，无重复成功 Outbox/Contract；同键异 Hash 冲突 | NOT RUN |
| TE-WI02-D-006 | Contract/Persistence | INITIAL metadata 同时带 Contract/Draft 或无输入分支；FROZEN 指向其他 WO Contract；成功 Snapshot 缺 metadata；payload 与 normalized ref 不一致 | 闭集/完整性 guard 拒绝，无可读成功 Snapshot 缺绑定；合法两分支仍产生同 ProjectContext v1.0 和旧事件形状 | NOT RUN |
| TE-WI02-D-007 | Controlled integration | final BLOCKED_INPUT→合法答案/Receipt→Context-2/Run-2；对照到期 Contract、改 Scope、直接复用 initial 入口及任意其他 Context | 新 Run 使用新 Context 与原 Contract；原 Contract/Context-1/Run-1 精确 Ref/Hash 不变；反例不能启动新 Run，不 Resume 旧终态 | NOT RUN |
| TE-WI02-D-008 | Contract/Security | 旧合法 frozen 请求、旧请求缺 ContractRef、新请求含旧字段/空 Slice/未知 projection；成功 build 重放时输入已过期；检查实际 Manifest 与 omission/redaction | 保留旧合法 @1.0；错误分支拒绝；重放返回原结果但新消费拒绝；不补充未用来源、不扩大 Audience 权限，裁剪不足由 owning Validation 阻止可执行冻结 | NOT RUN |

期限补充场景已于 2026-09-09 获用户批准，行为来源为 [Spec 003 §11.2.4](../module-specs/Module-Spec-003-TaskExecution.md#1124-创建期限与冻结期限)。这些是未来 Contract/Persistence/受控集成的验收输入，不把设计批准或仓库回归写成新业务测试 PASS。

| ID | 输入 / 边界 | 预期输出与禁止效果 | 运行状态 |
|---|---|---|---|
| TE-WI02-D-009 | 创建带未来 T0；Query/Root/Snapshot 期限存在性或值不一致、JSON null 冒充缺省；candidate 分别为 T0、缺省、T0之前、T0之后 | 仅精确一致且未到期的链可冻结；读绑定错误拒绝，完整 Snapshot Hash 覆盖存在性/值；candidate 期限不符不能取得有效判断/READY，成功 Ready Event 期限与 Contract 一致 | NOT RUN |
| TE-WI02-D-010 | 创建不提供期限；candidate 分别缺省或提供 T1；其他 Decision/Policy/Context 过期 | 仅缺省映射一致；无 WorkOrder 期限仍不能绕过其他期限或缺失 Policy | NOT RUN |
| TE-WI02-D-011 | 创建时 now 等于/晚于 T0；Builder/Validator/Freeze 在查询后或长事务内跨过 T0 | 创建直接拒绝；后续步骤在消费/提交前重新判断，不发布可执行成功事实；历史 Snapshot/判断不删除，可用 Validation.validUntil 不晚于 T0 | NOT RUN |
| TE-WI02-D-012 | Root status 仍 READY/QUEUED 但 now>=T0；Contract 期限被伪造为 T1；Run 已创建但尚未 start；到期后同键重放原 build/freeze | 新构建/排队/create/start 被拒绝；错期限绑定拒绝；原 Receipt 可重放但不授权新动作；不强改已运行 Run | NOT RUN |
| TE-WI02-D-013 | @1.1 DRAFT 使用独立 `DraftVersionPins`；正向 candidate 绑定顶层 `contextSnapshotRef` 与嵌套 `versionPins.projectContextContractRef`；分别改变 canonical objectType、objectId、snapshotId、Scope、contentHash，或删除/伪造 Hash | 合法冻结候选的两处 Snapshot Ref 必须逐字段完全相等；DRAFT 拒绝 Context Ref；缺失、错误 Hash/Scope 和 stale 输入 fail closed；不生成部分成功 Context/Contract | Schema/跨字段纯契约校验通过；Handler、真实 PostgreSQL 业务链与运行验收保持 NOT RUN | PASS |
| TE-WI02-D-014 | 固定同一 canonical `zhiju.identity.policy` ref，分别放入 InitialContextBuildRequest、ProjectContext projection、Context build metadata 与 Frozen WorkOrder VersionPins；对照缺失 ref、`zhiju.context.policy`/任意 namespace、错 objectId/versionId/Scope、同 key 异 contentHash、metadata/Policy 有效期不一致、未生效和已过期 | 合法四点绑定通过；候选组装、Validator、Freeze 均可复用同一校验；所有反例 fail closed，不生成部分 Snapshot/Validation/Contract，不接受 legacy 或 caller Hash | PASS（纯契约校验）；Handler/真实 IdentityPolicy/PG 仍 NOT RUN |
| TE-WI02-D-015 | 正向：`build_initial_context_snapshot@1.0/@1.1` 返回 canonical `zhiju.execution.context_snapshot` 的 `data.contextSnapshotRef`，`targetRef.objectId` 与返回 Ref 一致，`get_context_snapshot@1.0` 请求/结果 Ref 逐字段相等。反例：未注册 Result Schema 的命令（`build_context_snapshot@1.0`）、缺 `contextSnapshotRef`、缺 `snapshotId`、`kind` 非 SNAPSHOT、`objectType` 为 `zhiju.project.context_snapshot`/任意 namespace、错误 Hash、`scope` 为 `{}`/仅 `enterpriseId`/仅 `projectId`（前两者同时替换 target 与结果 Scope）、`targetRef.objectId` 或 Scope 不等、Query 返回与请求不同的 objectId/snapshotId/contentHash/scope；同一合法 Ref 在过期/撤销后重放 | 两个入口版本都注册真实 `resultSchemaRef` 且 `validateOperationResult` 通过；Result Schema 固定 canonical objectType、完整 SnapshotRef 字段与 Project Scope 必填（`enterpriseId` + `projectId`）；跨字段绑定拒绝只按 objectId、legacy namespace 或双方同缺 projectId 的混用；Query 绑定要求逐字段相等，且历史 namespace 与 enterprise-only Scope 的读回接受集合不变；旧 `build_context_snapshot@1.0` 仍无 operation-specific Result Schema 且 ContractRef 语义不变；未提交 Snapshot、幂等与同 key 异 Hash 由 Handler 拒绝，不生成部分成功事实 | PASS（Schema/Registry/生成类型/纯契约校验）；Handler、真实 PostgreSQL 业务链、授权运行与人工验收仍 NOT RUN |
| TE-WI02-D-016 | 首次 Context 期限组合。正向：请求期限不晚于全部上界，以及请求缺省时取 WorkOrder 期限/Slice `validUntil`/Builder Policy 有限上界的最小值。反例：请求期限分别晚于 WorkOrder、两个 Source Slice 与 Builder Policy 上界；请求期限与上界仅相差亚秒；请求缺省但 metadata 记了请求上界；有请求期限却省略或改写该记录；effective 被截断为最小值或事后放宽；ProjectContext `expiresAt` 与 effective 不一致或缺失；`now` 等于/晚于 effective；`now` 非法；metadata/上界为 JSON null、空 Slice 列表或畸形 instant（含 `2026-02-30`/`2026-04-31` 等不存在日期与非闰年 `2026-02-29`，正例为闰日 `2024-02-29` 与世纪闰日 `2000-02-29`）；所有来源均无有限上界 | 合法组合通过且 metadata 与 ProjectContext `expiresAt` 逐字符等于 effective，Builder/Validator/Freeze 可复用同一校验；超过任一上界立即拒绝并保留被违反路径，不静默截断；缺省与无限授权分离，无有限上界时 effective 保持缺省且额外写入仍被拒绝；`now >= effective` 与非法消费时间均 fail closed；历史 Snapshot/Receipt 重放不重新授权 | PASS（仅限 Schema/Registry/生成类型/纯契约校验覆盖的组合、镜像、精度与 fail-closed 反例）；到期重放、长事务、期限 Handler、真实 PostgreSQL 业务链与授权运行验收仍 NOT RUN |
| TE-WI02-D-017 | Builder Policy 解析来源（#176）。正向：`builderPolicyRef` 经 `identity.resolve_policy@1.0` 取得当次观察后逐字段填入请求、ProjectContext projection、Context build metadata 与候选 `versionPins`。反例：caller 自报 `contentHash`/`effectiveFrom`/`supersededAt`；用 `objectId/versionId` 推导 `SnapshotRef`；用 fixture 值或历史 Receipt 充当当次观察；解析返回 `NOT_YET_EFFECTIVE`/`SUPERSEDED` | 正向四点绑定通过且 metadata Hash/有效期与当次解析逐项相等；自报值按 #166 返回 `POLICY_CONTENT_HASH_MISMATCH`/`POLICY_VALIDITY_MISMATCH`；推导/拼造按统一不可用 `REFERENCE_INVALID` 拒绝；未生效/已取代按 `POLICY_NOT_EFFECTIVE`/`POLICY_EXPIRED` fail closed；不发布成功 Snapshot | 设计已固定（[Spec 003 §11.9](../module-specs/Module-Spec-003-TaskExecution.md#119-首批-policyevaluator-解析与消费时重验176-提案)）；解析 Port、Handler 与业务持久化 NOT RUN |
| TE-WI02-D-018 | Builder profile 支持边界（#176）。正向：`projectionType` 落在 `execution.context_builder.policy@1.0` 的 `allowedProjectionTypes` 内，且该 profile 的 canonical typed ref 在 `policySchemaRefs` 中。反例：`projectionType` 不在该集合、`policySchemaRefs` 不含 `execution.context_builder.policy@1.0`（含只带旧 `im02-static-v1` 条目）、policyDocument 含未注册字段或未知 profile 版本 | 正向继续组装；反例在组装前拒绝且不发布成功 Snapshot，不静默忽略未知字段，不把缺失字段解释为无限制，不用旧 registry 条目代替 | profile 注册与 closed 字段部分 `PASS`（#179，仅静态 registry/Schema/纯校验）：`modules/task-execution/src/business/policy-profiles.test.ts` 覆盖合法 fixture、缺失 profile ref、只带旧 `im02-static-v1` 条目、另一 profile 的 ref、空/重复/未注册投影类型与未知字段拒绝；`projectionType` 落在集合内的组装判定、Snapshot 发布与 Handler 仍 `NOT RUN` |
| TE-WI02-D-019 | 跨消费边界失效（#176）。Context 已提交后 Builder Policy 被后续版本取代、capture policy 失效或 Decision 过期，再分别尝试 Validation、Freeze、queue、create_run；增加等待目标 Root 锁期间 Decision 到期、取得锁后提交点重验的单变量反例 | 已提交 Context/Slice/判断保留不可变历史；新消费在各自边界重新解析并按 §11.2.4/§11.2.5.4 拒绝（`POLICY_EXPIRED`/`EXECUTION_JUDGMENT_STALE`/`AGGREGATE_STATE_NOT_ALLOWED`）；历史成功 Receipt 重放不重新赋予执行资格 | NOT RUN |
| TE-WI02-D-020 | Readiness/Validation 的 Policy/Evaluator 支持边界（#176）。正向：`build_task_readiness@1.0` 与 `validate_work_order_draft@1.0` 使用已注册 profile 与 Evaluator 版本，`validUntil` 分别取 `min(evaluatedAt + T, Decision 期限)` 与不得晚于 WorkOrder 期限。反例：未知 Evaluator objectType/版本、未注册 profile 字段、`mandatoryCriterionTypes` 含 Core §4.9 七类之外的值 | 正向判断可解释；反例返回 `EXECUTION_CRITERION_UNSUPPORTED` 且不产生可用判断，不跳过判据、不解释自由文本规则 | profile 注册与 closed 字段部分 `PASS`（#179，仅静态 registry/Schema/纯校验）：`policy-profiles.test.ts` 与 `contracts/src/policy-profiles.test.ts` 覆盖两个 profile 的 canonical ref 必需性、缺失/未知字段、非法整数拒绝，`mandatoryCriterionTypes` 缺省与空 Set 接受、七类之外的值拒绝，且其枚举与 Core v1.0 Criterion Type 集合逐项一致；Evaluator 选择器注册与纯解析部分 `PASS`（#189，仅静态 registry/纯解析，无 Evaluator 实现）：`contracts/src/evaluator-profiles.test.ts` 与 `modules/task-execution/src/business/evaluator-profiles.test.ts` 覆盖两个选择器的 canonical ref 唯一性与 Platform Scope、生成副本字节一致，重复 key/身份、缺条目、错误 owner、未知 registry 版本、非 canonical/非 Platform 条目与漂移的确定性拒绝，以及只按全字段精确匹配（非空 Scope、错 kind/objectType/objectId/versionId、形近伪造与其他消费者选择器均不解析，无 latest/回退）；Evaluator 确定性实现、`validUntil` 推导、`EXECUTION_CRITERION_UNSUPPORTED` 映射与判断产出仍 `NOT RUN` |
| TE-WI02-D-021 | 精确操作版本与独立读取授权：合法 @1.1 Draft/Builder 请求持有各自 Registry Purpose 的 Decision；反例为 create_work_order@1.1 只持与当前注册 Purpose 不同的旧 Purpose Decision，或有 Builder capability 但无 Draft/Context/Policy Query 权限。各版本字符串从 public-api 与 compatibility metadata 取值 | 按当前 operation/version/Intent 分别授权；不匹配当前注册值的旧 Purpose 不替代当前 Purpose；Builder 权限不隐含读取权限，不通过 Service 身份通配放行；不为本测试重命名任何既有 Purpose | NOT RUN |
| TE-WI02-D-022 | 原 Context/Validation/Receipt 已提交后 Policy 被取代或授权失效，重放原命令；再尝试覆盖原 Draft pins、Context Hash 以恢复资格。正向恢复使用现有 owning 入口创建所需新事实 | 重放仅返回原历史结果，不恢复 Policy/授权的当前资格；旧 Snapshot/Hash 与 Draft pins 不覆盖，缺少合法编辑入口时不得发明更新路径；新工作仍须通过当前 Policy 解析、独立授权和完整依赖检查 | NOT RUN |

独立设计审查应核对 TD-01–04、新操作清单、所有具体失败矩阵与单Aggregate/兼容边界；#176 提案另需核对 Policy 版本键与生命周期对应、统一不可用与内部审计边界、profile/Evaluator 支持边界及新增 Major 的兼容代价。人类对具体技术设计的批准不等于上述运行结果。真实Feishu/CLI Runtime、公开HTTP、生产和独立人工业务验收继续独立NOT RUN。

## IM-06 WI-01 application/persistence 基础用例（Issue #151）

下表覆盖 Issue #151 的 9 项 Acceptance 项及两个 reviewer 反馈的持久化/Scope guard 验证项 (TE-WI-01-010/011)；用例在 `tests/persistence/task-execution-command-runner.test.ts` 中以 disposable PostgreSQL 真实执行，不使用内存替身；除 `TE-WI-01-009`（连接复用与 Context 隔离）外，其余每项在同一测试进程内只运行一次以避免幂等键重叠。其它 TE-TD-* 用例在本切片中保持 `NOT RUN`；本表只标记本次实现实际验证通过的部分，不将 WI-01 的通过扩大为 IM-06 业务闭环已 READY。

| ID | 层级 | 输入/竞争/故障 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| TE-WI-01-001 | Persistence | 同 envelope 首次提交，含 process_instance/audit/outbox/reference_edge | Receipt/Process/Audit/Outbox/Ref Edge 同事务提交；Aggregate version=1，Outbox aggregate_version 与本次创建一致 | PASS |
| TE-WI-01-002 | Persistence | 同 scope/key/Hash 顺序重放与并发重复 | 仅 1 条 Receipt；并发重复返回 `DUPLICATE` 持久化原结果，不重复 Process/Audit/Outbox；新连接/新 runner 重放仍得到原结果 | PASS |
| TE-WI-01-003 | Persistence | 同 scope/key 携带不同 request Hash | 抛 `IDEMPOTENCY_PAYLOAD_CONFLICT`；原 Receipt outcome 保持 `COMMITTED`；新增 1 条 `DENIED` 审计；不写第二条 Receipt/Audit/Outbox | PASS |
| TE-WI-01-004 | Persistence | 两不同 idempotency key 同 `expectedAggregateVersion='1'` 更新同一 `process_instance` | 恰一事务 `aggregate_version=2, state=SUSPENDED`；另一事务抛 `CONCURRENCY_CONFLICT`；版本仅增一次；`aggregate_version` 通过 SQL 文本读回与提交值一致 | PASS |
| TE-WI-01-005 | Persistence | 在技术写入后、提交前调用 `execution.failAfterOutbox()`；原 idempotency_key/request_payload 重放同一成功 body；再次重放 | Receipt/Process/Audit/Outbox/Ref Edge 全部零残留；原 key 第二次提交返回 `COMMITTED` 且仅产生一次成功效果（1 条 Process/Ref Edge/Outbox 与 1 条 `COMMITTED` Audit/Receipt）；第三次重放返回 `DUPLICATE` 不再增加任何事实 | PASS |
| TE-WI-01-006 | Persistence | body 返回 `{kind:'REJECTED'}`；同 envelope 重放 | 第一次返回 `REJECTED` + 稳定 errorCode/safeSummary + `REJECTED` 审计；目标 `process_instance.aggregate_version` 不变；第二次返回 `DUPLICATE` 原 `REJECTED` 结果 | PASS |
| TE-WI-01-007 | Security | envelope 错 principalId/actorSnapshotId/authorizationDecisionId/policySnapshotId/enterpriseId/projectId/correlationId | 7 项探测全部 `COMMAND_CONTEXT_MISMATCH`，不写 Receipt | PASS |
| TE-WI-01-008 | Persistence | outbox `declaredHash` 与 canonical payload 不一致 | `PAYLOAD_HASH_MISMATCH`，Receipt/Outbox 均未写入 | PASS |
| TE-WI-01-009 | Persistence/Security | COMMIT/ROLLBACK 后同连接新事务；不同连接建立各自 Context；Decision 在长事务中过期；同 backend 残留行被下次 establish 清理 | 同连接新事务零行；不同 enterprise/project Context 读对方行零行；过期 Decision 在 `statement_timestamp()` 重验返回零行 | PASS |
| TE-WI-01-010 | Security/Persistence | Process creator 与受信 `platform_security.context_principal_id` 不一致 | 抛 `TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH`；process_instance 零写入；Receipt 零写入（不在故障态遗留 PENDING） | PASS |
| TE-WI-01-011 | Persistence | CAS 目标行 enterprise_id 与 envelope.enterpriseId 不一致；Context 同时允许目标项目和命令项目但 envelope projectId 与目标行 project_id 不同；envelope targetType 不是 ProcessInstance；附合法正向控制 | 跨 Enterprise 行由 RLS 隐藏,body 抛 `CROSS_ENTERPRISE_HIDDEN` 标记 `NOT_FOUND`(不暴露 scope);Project case `Context=[P1,P2]` 隔离精确 guard,body 在 OK/CONFLICT 时显式抛 `LEAKED`/`CONCURRENCY_CONFLICT`,最终抛 `COMMAND_TARGET_MISMATCH`;Wrong-target-type case 抛 `COMMAND_TARGET_MISMATCH`;每个 case 独立断言 Receipt/Audit 零残留,正向控制使 `aggregate_version=2, state=SUSPENDED` | PASS |
| TE-WI-01-012 | Security/Persistence | 每 case 用独立全新 Process ID 与匹配目标事实验证正向可提交,再用隔离的新数据只变更一个目标字段验证拒绝:Context 允许 P1/P2 但 envelope 声明 X/P1 时 body 试图 X/P2;envelope targetId = X 但 body 试图 Y;envelope targetType ≠ ProcessInstance | 正向 case 提交并写入 1 条 Process + Receipt;三个反例均抛 `TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH`;对应全新 Process ID 零写入;每个反例独立断言 Receipt/Audit/Outbox 零残留,不依赖前一测试的行 | PASS |
| TE-WI-01-013 | Security/Persistence | 每个 helper 独立 mutation 反例:body 保留原 envelope 引用后 mutate `input.targetId / input.projectId`,再分别调用 `casProcessInstance` / `appendOutbox` / `appendReferenceEdge` / `appendProcessStep`;`expectedAggregateVersion` 匹配;另配 Context 同时允许目标项目和命令项目,使“原 envelope CAS 会成功”的反例在去掉 snapshot 绑定时会失败而非因版本缺失偶然失败 | `execution.insertProcessInstance` 是唯一 insert 入口;body mutate 后 `process_instance` 仍以原始 target/project 落库;四个 helper mutation 反例各自独立执行并因 snapshot target/Scope 不匹配抛 `COMMAND_TARGET_MISMATCH`,对应 commandId 的 Receipt/Audit 零残留 | PASS |

聚焦单元覆盖：CAS/Idempotency/Hash/Scope mirror guard 已分别嵌入 `executeTaskExecutionCommand`、`CommandExecution` 与 Kysely insert 中；不存在脱离真实 PostgreSQL 的内存替身版本。`vibe verify full --json` 的 disposable PostgreSQL gate 完整运行以上 9 项；`pnpm test` 中跳过 gate 时仅占位 skip，未声明 PASS。


## TD-05–07 剩余设计回归矩阵

状态：`PROPOSED / REVIEW PENDING`。下表对应 Spec 003 §12–14；批准前不是已冻结执行契约，当前全部 NOT RUN。已有 Schema/full 通过不能替代新增 Handler 与受控业务链验收。

| ID | 层级 | 输入/故障 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| TE-TD-027 | Contract/Query | Board v1 的严格 data Schema 与共享 QueryResult 分别校验 | 不往 data 塞 freshness 字段；两层 snapshotAt/watermarks/cursor 一致；旧合法 fixture 保留 | NOT RUN |
| TE-TD-028 | Persistence | 翻页间 Task 更新、alias 切换、generation 清理 | 原 cursor 仍读原 generation、无重复漏项/混页；超 TTL 明确过期，不跳到最新页 | NOT RUN |
| TE-TD-029 | Security | cursor 篡改、换 Scope/filter/Purpose/主体；第一页后授权撤销 | 返回安全错误，不泄露旧 generation 行或计数；当前授权先于返回数据 | NOT RUN |
| TE-TD-030 | Persistence | 暂停刷新，mutable 权威状态已变；无 alias；source health 查询失败 | STALE/FAILED/REBUILDING 真实表达；无可用数据时省略 data，不返回 OK 空页；权威状态仍独立正确 | NOT RUN |
| TE-TD-031 | Persistence | 导出/重建错行数/Hash、事务中断；切 alias 后未确认 dirty 即崩溃 | 失败不切 alias；重放不丢 marker，旧 generation 不变，完成判据不依赖刷新 | NOT RUN |
| TE-TD-032 | Persistence | 低序号事务晚提交、高序号先提交；export lease 过期后旧 worker 返回 | coveredDirtyIds 仅确认快照可见集合；晚提交触发新刷新，旧 fencing 不能覆盖新 alias | NOT RUN |
| TE-TD-033 | Contract/Security | 未调用 Driver 的来源声明、跨 Run Observation、Usage 缺失、Result隔离 | provenance 不能提升为可信 Invocation；UNKNOWN 无 value，不造 0/runtimeUsageRef；Run 间不覆盖 | NOT RUN |
| TE-TD-034 | Security | Provenance 注入 Prompt/token/stdout/客户正文；synthetic 伪装 Provider | 安全 profile 拒绝/裁剪，不持久化或返回敏感源；明确 synthetic 身份，无 Provider 验收声称 | NOT RUN |
| TE-TD-035 | Controlled cross-module | 空 TE 业务库、合法 owning 初始输入→正常正式 Revision 输出→四层判断 | 实际 Receipt/Hash 链；TaskCompleted 由 TE 真实生产并进入 EP；需额外 Release 的 Item 仍未完成 | NOT RUN |
| TE-TD-036 | Controlled cross-module | BLOCKED_INPUT→授权 CustomerMaterial Answer/Receipt→CTX-2/Run-2 | 新事实推进，旧 Contract/CTX-1/Run-1/Result 哈希不变；Request未建立窗口也阻塞，无假 Resume | NOT RUN |
| TE-TD-037 | Persistence/Recovery | Result/Acceptance/finalize/resolve/TaskCompleted 各提交后、确认前崩溃 | 重放原幂等键、单业务效果；原成功 Receipt 可查，不为重试造新 Attempt | NOT RUN |
| TE-TD-038 | Unit/Recovery | 临时故障持续到 retry budget；未知 Policy、过期授权或异 Hash | 有限重试或立即失败，待处理源/错误可追溯；无清 blocker/假成功；新合法输入用新 fingerprint | NOT RUN |
| TE-TD-039 | Security/Persistence | 内部 Snapshot Export 越权/跨 Scope，Projection app 直读 TE 表 | Port拒绝与ACL/RLS拒绝；导出只读且无状态推进，manifest 仅含安全 item 与限定的内部筛选字段 | NOT RUN |
| TE-TD-040 | Query/Contract | 同一 DeliveryItem 的 v1/v2、其他 Item 与未绑定 Task；带/不带过滤器 | 精确版本仅命中对应行；未绑定行只在无该过滤器时可返回；先过滤后分页，不回查最新 Task；公开结果不含 filterKeys | NOT RUN |
| TE-TD-041 | Persistence/Query | G1 翻页期间来源关联合法变化并发布 G2；或切换 cursor 的 DeliveryItem 版本过滤器 | 原 cursor 的行归属按 G1 保持；新查询使用 G2；修改过滤器拒绝 cursor，不混入新关系 | NOT RUN |
| TE-TD-042 | Persistence/Integrity | item 不变而内部 Ref 换版本/Scope、由缺失变存在；保留旧 rowsHash 或篡改索引镜像 | 完整行 Hash 随变更改变，错误 Hash/镜像拒绝发布且保留旧 alias；内部字段不能漏出 TaskBoardItem v1 | NOT RUN |

独立审查须覆盖共享 Envelope 与 data Schema 边界、export dirty 集合的提交可见性、cursor 生命周期、Usage 证据来源以及正常/阻塞链的四层完成反例。独立审查和人类设计批准分别记录；本次自检不替代独立审查。

## 创建 Purpose 兼容性（#190 APPROVED）

对应 [Spec 003 §15](../module-specs/Module-Spec-003-TaskExecution.md#15-创建-purpose-兼容性-spec-delta190)。以下是于 2026-09-14 随 P-190-1 方案 A 获批、可转为 Handler/Contract/Persistence 测试的场景，不修改既有结果。每个负例从对应版本的独立合法基线开始，仅改变表列维度。合法基线须先由 owning 入口创建真实 Project/Task、ActorSnapshot、精确版本 Policy/grant/Decision，使用服务端当前时间和未到期期限；不能把旧 Schema fixture 中的虚构 Ref/固定历史时间直接当运行授权基线。每项拒绝均断言无新 Root、成功 Receipt 或业务 Outbox，历史事实/Hash 不变，安全 Audit 可追踪。

| ID | 层级 | 输入/单一变化 | 预期输出 | 当前实际 / 结果 |
|---|---|---|---|---|
| TE-P190-001 | Contract + Persistence | 分别运行 Task v1/v2、WorkOrder v1/v1.1 的原合法字段与各自 Purpose；授权 Human | 四个入口各只创建 DRAFT；旧开放字段与 v2 closed shape、两种 versionPins 各守原契约 | 未实现 / `NOT RUN` |
| TE-P190-002 | Authorization | 对每版本替换 Purpose 为另一操作的值；另测 Task v1/v2 互换、WorkOrder 使用未注册 `execution.work_order.create` | 拒绝 Purpose 不匹配，不采用别名 | 精确映射与纯解析已实现（#196）；授权组成层未实现 / `NOT RUN` |
| TE-P190-003 | Authorization | 保留正确 Purpose，WorkOrder v1 Decision 提交 v1.1；另测 Task v1 Decision 提交 v2 | 拒绝 commandVersion 不匹配；同 Purpose 不免除版本绑定 | 解析保留精确版本已实现（#196）；Decision 版本绑定未实现 / `NOT RUN` |
| TE-P190-004 | Authorization | 分别改变 commandType、target、payloadHash、Actor、认证上下文或 Intent Scope；其余均合法 | 拒绝精确 Intent/身份绑定错误，不借他人 Decision | 未实现 / `NOT RUN` |
| TE-P190-005 | Business + Persistence | 使用自身合法 Decision，但 WorkOrder targetScope 超出 Task；另测 Task projectRef 与目标 Scope 不闭合 | 拒绝业务 Scope，不以授权 ALLOW 替代业务校验；无跨 Scope 存在性泄露 | 未实现 / `NOT RUN` |
| TE-P190-006 | Authorization | Human、Coordinator Agent、规则化 Process Manager 分别使用自己的合法授权；普通 Agent 及无对应规则的 Service 为独立负例 | 三种受约束角色各只创建 DRAFT；普通 Agent/任意 Service 拒绝 | 未实现 / `NOT RUN` |
| TE-P190-007 | Security | 合法 Coordinator 创建请求仅加入 Human-only capability；另测把他人 Decision、requestedBy Human、actingFor Human 当作提权依据 | 拒绝；无 grant 新增，不 READY/freeze/queue/Run/Approval/Release | 未实现 / `NOT RUN` |
| TE-P190-008 | Persistence | 首次成功后合法同版本同 key 同输入重试；分别测同键异输入、换版本重试、原 grant 撤销后重试 | 合法重试返回原结果且不增 Root/Event；异输入幂等冲突；跨版本不取原 Receipt；撤销拒绝且原历史保留 | 未实现 / `NOT RUN` |
| TE-P190-009 | Authorization | Decision 已过期、grant 撤销/到期、Policy 不可用、IP 依赖不可用分别作为单独负例 | 按现有授权/依赖错误 fail closed，不生成默认授权 | 未实现 / `NOT RUN` |
| TE-P190-010 | Compatibility | 旧客户端原版本请求 + 当前真实合法授权；持 Task v1 能力但未获 v2 授权；WorkOrder 明确覆盖两个版本的能力分别请求新 Decision | 旧合法请求通过；无 v2 覆盖拒绝；WorkOrder 两个精确版本独立通过，不共享 Decision | 未实现 / `NOT RUN` |
| TE-P190-011 | Replay | 授权读取旧 Receipt/回放历史；再以该 Receipt 请求新创建/READY | 历史原 Purpose/version/hash 不变；新动作必须独立授权，历史成功不提升资格 | 未实现 / `NOT RUN` |

## Task DRAFT 创建引用与持久化边界（#202 APPROVED DESIGN）

状态：`APPROVED 2026-09-15 / INDEPENDENT DESIGN REVIEW APPROVE / HUMAN DESIGN APPROVAL RECORDED / TE-P202-001–015 EXECUTED ON REAL POSTGRESQL 2026-09-15（#204）/ PR-205 REVIEW FIXES EXECUTED 2026-09-16（schema_version 身份绑定、NULL-safe shape CHECK、canonicalizer NFC 键碰撞）/ CANCELLED-REPLACED DELIVERY ITEM BRANCH NOT RUN`。对应 [Spec 003 §16](../module-specs/Module-Spec-003-TaskExecution.md#16-task-draft-创建引用与持久化边界202-设计)，依据与精确批准记录见 [决定 §15](../decisions/task-execution-human-operated.md#15-task-draft-创建引用与持久化边界提案202)。本表把本次可核对的设计/静态分量与未来 Handler 切片才可执行的行为分开：`TE-P202-D-*` 只对账版本身份、归属选择、时机表、创建事实与事件边界，不等于 Handler、授权接线或业务链已运行；其余各项在实现前保持 `NOT RUN`，不因本次 `full`、#151/#200 既有回归或设计批准而改变。每个运行时用例从对应版本的独立合法基线开始，只改变表列维度。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| TE-P202-D-001 | Design | Spec §16.1 逐版本字段身份表（`targetRef`、`projectRef`、`deliveryItemRef`、`parentTaskRef`、`dependencyTaskRefs[]`）vs `contracts/registry/public-api.v1.json`、v1 冻结 fixture、v2 fixture 与 `TASK_EXECUTION_CREATION_BINDINGS` | v1 = `execution.task`/`project.project`/`project.delivery_item`，v2 = `zhiju.execution.task`/`zhiju.project.project`/`zhiju.project.delivery_item`；Task 引用在两侧都固定同一 Task 拼写；Catalog 213、Baseline 200、v1 fixture 字节不变 | 四处来源逐项一致；v1 fixture 无 `zhiju.` 前缀，v2 fixture 全部 `zhiju.` 前缀，v2 registry `references` 声明两个 canonical 对象；`parentTaskRef`/`dependencyTaskRefs` 在两侧 Schema 均为通用 `ObjectRef`，其身份只能由 Handler 闭合 | `DESIGN VERIFIED` |
| TE-P202-D-002 | Design | Spec §16.2 归属选择与公开接受集边界 | 选定 EnterpriseProject owning 内部 Port；`project.validate_object_scope@1.0` 的 13 个裸本地名接受集与错误外观不变，且不存在 `@2.0` | Port 方案与未采用方案 B/C 的拒绝理由已记录；该公开 Query 的键表未新增 canonical 或 `DeliveryItem` 键 | `DESIGN VERIFIED` |
| TE-P202-D-003 | Design | Spec §16.3 时机表覆盖 `projectRef`、`deliveryItemRef`、`parentTaskRef`、`dependencyTaskRefs`、`inputRefs`（含 `ExternalRef` 分支）、output/criterion 引用、`initialAssignee`、`dueConstraint`，并按引用形态闭合 Scope 规则 | 每个字段都有唯一 DRAFT 义务或明确推迟边界；不把语法有效 Ref 当作已提交事实；Scope 规则只允许 Platform `{}`/Enterprise/Project 三形态，Project 锚定字段要求 Envelope 相等，其余字段要求落在 Envelope Scope 内（同 Enterprise、同 Project）；`ExternalRef` 按有无 `tenantOrAccountRef` 两分支闭合，且不得因缺少顶层 `scope` 被拒绝或被跳过校验 | 8 个维度均有归属；统一 Project Scope 规则已由逐形态规则取代；跨 Enterprise/Project 输入（含 `tenantOrAccountRef`）与 policy/evaluator 引用在 DRAFT 拒绝；Platform selector 与同企业 Enterprise-scope `evaluatorRef` 在 DRAFT 合法；无租户绑定的 `ExternalRef` 只作来源意图 | `DESIGN VERIFIED` |
| TE-P202-D-004 | Design | Spec §16.4 创建事实与幂等规则 | Root/Snapshot/Receipt/Audit/Reference Edge/无 Outbox 六类事实闭合；跨版本 Receipt 不可互换；`aggregate_version` 不被当作 `snapshot_id`；快照 identity 独立于 CAS 版本 | 六类事实与五条幂等规则齐备；相对 #151 runner 现状（`(scope,key)` 唯一、仅比较 request hash）的补强要求已显式写出 | `DESIGN VERIFIED` |
| TE-P202-D-005 | Design | Spec §16.5 事件边界 vs 当前 Registry | 无 `TaskCreated` 注册；DRAFT 事务不写 Outbox；未来 additive 事件需单独批准并同步计数 | `public-api.v1.json` 的 `execution.*` Event 恰 11 项且无 `TaskCreated`；Domain §18.7 词汇不作为发布依据 | `DESIGN VERIFIED` |
| TE-P202-001 | Contract/Persistence | 使用 v1 冻结正例输入经 owning 入口创建 DRAFT（合法 Human Decision、合法 Project） | Root `DRAFT`/`aggregate_version=1`；Snapshot `schema_version=1.0`、规范 payload 与原 payload 逐字段相等、hash 可重算；Receipt/Audit 已提交；无 Outbox | `task-draft-creation.test.ts`：v1 冻结 payload 经组合入口提交；Root `DRAFT`/`aggregate_version=1`/Scope 与 DeliveryItem 镜像一致；Snapshot `schema_version=1.0`、`canonical_payload` 与命令 payload 逐字段相等、`payload_hash` 可重算且等于 Root 指针 hash；Receipt `COMMITTED` + Audit `COMMITTED`；恰 `/projectRef`、`/definition/deliveryItemRef` 两条 Edge；事务 Outbox 0 行 | `PASS` |
| TE-P202-002 | Contract/Persistence | 使用 v2 合法输入，分别覆盖无 `deliveryItemRef`、有 `deliveryItemRef`、有 `parentTaskRef` 三个单变量分支 | 三支均提交 DRAFT；closed `expectedOutputSpec`/`completionCriteria` 原样进入快照；`delivery_item_id`/`version_id` 镜像与 payload 一致 | `task-draft-creation.test.ts`：v2 三支均 `COMMITTED`；无 `deliveryItemRef` 时 Root 镜像为 NULL；有 ref 时镜像与 payload 一致；`parentTaskRef` 追加 `/definition/parentTaskRef` Edge；closed `expectedOutputSpec`/`completionCriteria` 原样进入快照 | `PASS` |
| TE-P202-003 | Security | Project 身份变体：v1 提交 `zhiju.project.project`；v2 提交 `project.project`、裸 `Project`、大小写或前缀变体、错误 kind；另单变量只改变 `projectRef.objectId`（改用同 Scope 内不存在的 Project id）而不改 `scope.projectId`/受信 projectId | 全部 `EXECUTION_PROJECT_REF_INVALID`；`objectId == scope.projectId == 受信 projectId` 与 `scope.enterpriseId == 受信 enterpriseId` 必须逐项满足，不能以“受信 projectId 上存在 ACTIVE 行”代替；不做规范化或别名回退；两个版本互不接受对方拼写 | `task-draft-creation.test.ts`：v1 的 `zhiju.project.project`、v1 DeliveryItem 拼写、两个版本的 `objectId≠scope.projectId`、scope 变体均 `EXECUTION_PROJECT_REF_INVALID` 且无 Root/Snapshot；v2 的 `const` 拼写、裸 `Project`、大小写、错误 kind 由注册 Schema 先行拒绝（`API_VALUE_INVALID`）；绕过注册层直驱 owning Handler 时仍以 `EXECUTION_PROJECT_REF_INVALID` 拒绝 | `PASS` |
| TE-P202-004 | Persistence/Security | Project/DeliveryItem 存在性变体：不存在、其他 Enterprise、其他 Project、`SUSPENDED`/`ARCHIVED`、`CANCELLED`/`REPLACED` 的 DeliveryItem 版本；另单变量改变 `deliveryItemRef` 的 `objectId`/`versionId`/`scope` 之一，使受信 Project 内存在其他合法 DeliveryItem 行；附合法对照 | 全部拒绝且安全外观一致（不区分“不存在”与“不可见”），无跨 Scope 存在性泄露；只比较对象 id 或用受信 Project 内任意行代替的实现不能通过；合法对照提交成功 | `task-draft-creation.test.ts`：无 Project 行 → `EXECUTION_PROJECT_REF_INVALID` + EP Audit `TASK_CREATION_SCOPE_NOT_VISIBLE`；`SUSPENDED` → `TASK_CREATION_SCOPE_LIFECYCLE_INVALID`；DeliveryItem 未知 id、未知 version、精确 id+错误 version、跨 Project、跨 Enterprise → `EXECUTION_DELIVERY_ITEM_REF_INVALID`；错 kind 由 Schema 拒绝、Handler 直驱返回 `EXECUTION_DELIVERY_ITEM_REF_INVALID`；合法对照 `COMMITTED`。`CANCELLED`/`REPLACED` 子项 `NOT RUN`（当前 EP 约束把 `commitment_status` 固定为 `PROPOSED` 且拒绝其 UPDATE，无合法事实可产生） | `PASS`（CANCELLED/REPLACED 子项 `NOT RUN`） |
| TE-P202-005 | Contract | Task 引用身份与依赖时机：`parentTaskRef`/`dependencyTaskRefs` 的 objectType 分别为错误模块类型（如 `zhiju.execution.work_order`）、另一版本 Task 拼写、大小写变体；依赖指向同 Scope 但尚未提交的 Task；对照跨 Project ref、自引用 ref | 身份变体分别拒绝 `EXECUTION_PARENT_TASK_REF_INVALID` / `EXECUTION_DEFINITION_REF_INVALID`；未提交依赖 DRAFT 接受并原样进入快照，READY 不通过；跨 Project 或自引用在 DRAFT 拒绝 | `task-draft-creation.test.ts`：`parentTaskRef` 错误模块类型、另一版本拼写、未知 Task、跨 Project、自引用 → `EXECUTION_PARENT_TASK_REF_INVALID`；`dependencyTaskRefs` 错误模块/另一版本拼写/跨 Project/自引用 → `EXECUTION_DEFINITION_REF_INVALID`；大小写变体由 Handler 直驱拒绝；同 Scope 未提交依赖 `COMMITTED` 且原样进入快照、不写 Edge | `PASS` |
| TE-P202-006 | Contract | 输入与判据的 Scope 包含关系：`inputRefs` 分别为 Envelope 的 Project 形态、同企业 Enterprise 形态、Platform `{}`、跨 Enterprise（`{enterpriseId:E2}`）、跨 Project（`{enterpriseId:E1, projectId:P2}`），以及 `ExternalRef` 四支（携带同企业 `tenantOrAccountRef`、携带 `E2`、携带 `E1/P2`、不携带 `tenantOrAccountRef`），均未提交；v2 `acceptancePolicyRef`（Project 形态）与 `evaluatorRef`（Platform selector、同企业 Enterprise `zhiju.quality.evaluator`、跨 Enterprise `E2`、跨 Project `E1/P2`、未注册版本）各一支 | Project/同企业 Enterprise/Platform 形态与携带同企业 `tenantOrAccountRef` 的 `ExternalRef` 在 DRAFT 接受，未提交不构成 DRAFT 拒绝理由；跨 Enterprise 与跨 Project 的输入、`tenantOrAccountRef`、policy/evaluator 引用在 DRAFT 拒绝 `EXECUTION_DEFINITION_REF_INVALID`，不进入不可变快照；未携带 `tenantOrAccountRef` 的 `ExternalRef` 接受但只是来源意图，不得作为输入存在性/Readiness/blocker/完成条件的依据，须先经 owning 授权 Adapter/Domain Command 形成正式对象；未注册或不受支持的 Policy/Evaluator 版本在 READY/Validation 返回 `EXECUTION_CRITERION_UNSUPPORTED` | `task-draft-creation.test.ts`：`inputRefs` 的 Project、同企业 Enterprise、Platform `{}`、同企业 `tenantOrAccountRef` 与无租户 `ExternalRef` 接受；跨 Enterprise/Project 输入与 `tenantOrAccountRef` 拒绝 `EXECUTION_DEFINITION_REF_INVALID` 且无 Root；v2 `acceptancePolicyRef`/`evaluatorRef` 的 Platform selector 与同企业 Enterprise Scope 接受，跨租户拒绝 | `PASS` |
| TE-P202-007 | Security/Persistence | Scope 隔离逐变量：Envelope Scope 与 Project 锚定字段（`projectRef`/`deliveryItemRef`/`parentTaskRef`/`dependencyTaskRefs`）之一的 `enterpriseId` 或 `projectId` 不同；`inputRefs`/`acceptancePolicyRef`/`evaluatorRef` 分别取跨 Enterprise（`E2` 或 `E2/P2`）与跨 Project（`E1/P2`）；`ExternalRef.tenantOrAccountRef.scope` 分别取跨 Enterprise 与跨 Project；RLS 探针用其他 Project Context 读取 Root/Snapshot | 每个单变量反例在 DRAFT 拒绝且无跨 Project/Enterprise 泄露；落在 Envelope 内的 Enterprise/Platform 形态与无租户绑定的 `ExternalRef` 不得被误拒；RLS 探针返回零行；`FORCE RLS`、最小角色权限、不加跨 Schema FK | `task-draft-creation.test.ts`：以另一 Project Context 读取 Root/Snapshot 与 DeliveryItem 均为 0 行；各 Project 锚定字段的跨 Scope 单变量反例在 DRAFT 拒绝；`FORCE RLS` 与最小角色权限由 `technical-tables.test.ts` 的既有断言覆盖 | `PASS` |
| TE-P202-008 | Authorization | 首次成功后撤销/替换 Grant、Decision 过期、capability 配置漂移、target 或版本替换，再以原幂等键重放；再以历史 Receipt 请求新创建 | 全部 fail closed；证明 Port 在幂等 Claim 与历史 Receipt 返回**之前**执行；无新 Root/Snapshot；历史 Receipt 仍可读但不授予新资格 | `task-draft-creation.test.ts`：撤销 Grant 后同键/新键均 `AUTHORIZATION_REVOKED` 且新键无 Receipt（证明重验先于 Claim 与历史 Receipt 返回）；恢复覆盖后重放 `DUPLICATE` 且不新增事实；过期 → `AUTHORIZATION_EXPIRED`；capability 配置漂移 → `AUTHORIZATION_REVOKED`；target 替换 → `IDENTITY_CREATION_TARGET_INVALID`；target objectId 或 payload 替换 → `AUTHORIZATION_DECISION_INVALID`；他人 Actor → `AUTHORIZATION_DECISION_INVALID` 且无 Receipt | `PASS` |
| TE-P202-009 | Persistence/Integrity | 单变量篡改 `canonical_payload` 与提升列：Scope 镜像、`schema_version`、`delivery_item_*`、`payload_hash`、Root 指针的 `snapshot_id` 或 `definition_hash`；另与共享内核对照的 canonicalization 正/负例（NFC 归一化键值、字节序键、转义、安全整数、空容器、NFC 键碰撞） | 镜像 guard 与 Hash 重算拒绝，事务回滚；只比较 `snapshot_id` 或只校验 Hash 长度的实现不能通过；`schema_version` 必须与产生该 payload 的 CREATE major 一致；SQL 重算必须与共享内核 canonicalization v1 逐字节一致，NFC 键碰撞两处都必须拒绝 | `task-draft-creation.test.ts`：delivery item 镜像、payload hash、payload Scope 镜像、Root 指针 hash 分别被 mirror guard 与组合 FK 拒绝；v2 payload 改写为 `schema_version='1.0'` 被 creation-identity guard 拒绝（Receipt 版本不符），不存在/他人 target 的 Receipt 同样拒绝；v1 payload 改写为 `'2.0'` 被 NULL-safe shape CHECK 拒绝；5 组含 NFC 归一化、字节序、转义、安全整数（含 `-0`）、空容器与嵌套的 v1 payload 经 owning 入口提交后 SQL 重算 hash 与应用 hash 相等；NFC 键碰撞 payload 在共享内核与应用两侧均被拒绝（SQL guard 报 `collide after NFC normalization`）。快照 UPDATE/DELETE 与跨 Project 插入由 ACL/RLS 拒绝（详见 013） | `PASS` |
| TE-P202-010 | Persistence | 幂等与跨版本：同键同输入重放；同键异 payload；v1 与 v2 使用同 `idempotency_scope`+key 且规范 payload 逐字节相同 | 重放返回原结果且不新增 Root/Edge/Event；异 payload 为 `IDEMPOTENCY_PAYLOAD_CONFLICT`；跨版本不返回对方版本 Receipt，写 DENIED Audit | `task-draft-creation.test.ts`：同键同输入重放 `DUPLICATE`，Snapshot/Edge 计数不变；同键异 payload（各持自身合法 Decision）→ `IDEMPOTENCY_PAYLOAD_CONFLICT` + DENIED Audit；同 `idempotency_scope`+key+v1/v2 逐字节相同 payload → 不返回对方 Receipt，写 DENIED Audit 且无 Root | `PASS` |
| TE-P202-011 | Persistence | 并发：两连接同 key 同输入创建；两连接不同 key 同 target 创建 | 前者单 Root/单 Receipt 且一次成功效果；后者恰一成功、另一 `EXECUTION_TASK_ALREADY_EXISTS`，均无部分事实 | `task-draft-creation.test.ts`：并发同 key → 恰一次 `COMMITTED`（另一连接 `DUPLICATE` 或 `COMMAND_IN_PROGRESS`），单 Snapshot/单 `COMMITTED` Receipt；并发不同 key 同 target → 恰一 `COMMITTED`、一 `REJECTED EXECUTION_TASK_ALREADY_EXISTS`，单 Root | `PASS` |
| TE-P202-012 | Persistence/Recovery | 在 Snapshot 写入后、finalize 前注入故障；EP Port 不可用或超时；随后同键重放 | 故障与依赖不可用均全量回滚（Receipt 无 `PENDING` 残留、无 Root/Snapshot/Edge）；`DEPENDENCY_UNAVAILABLE` 不被当作通过；重放能正常完成首次提交 | `task-draft-creation.test.ts`：EP Port 不可用 → `DEPENDENCY_UNAVAILABLE`，无 Receipt（含无 `PENDING`）/Root/Snapshot，同键随后 `COMMITTED`；Snapshot 写入后注入故障 → 整体回滚、无残留、同键随后 `COMMITTED` | `PASS` |
| TE-P202-013 | Security/Persistence | owner 直写 SQL：改写快照 payload/hash 或提升列、UPDATE/DELETE 不可变行、跨 Project 插入 Root | 分别被 mirror guard、ACL（`42501`）与 RLS 拒绝；无成功副作用 | `task-draft-creation.test.ts`：app 角色 UPDATE/DELETE 快照与 DELETE Root → `42501`；改写 Scope 列 → immutable guard；跨 Project Root 插入 → RLS 拒绝；owner 直写快照 payload → immutable guard 拒绝且原 hash 不变 | `PASS` |
| TE-P202-014 | Compatibility | v1 冻结 fixture 与其 sha256、v2 Schema 与 `references`、`project.validate_object_scope@1.0` 接受集、Catalog 213 与 Baseline 200 | 全部不变；`TaskDefinitionSnapshot` 未注册新 objectType；DRAFT 创建不返回该 Ref | `task-draft-creation.test.ts`：v1 fixture 与历史 baseline 文件逐字节相等且经 Registry 校验；`project.validate_object_scope@1.0` 仍拒绝 `zhiju.project.project`/`zhiju.project.delivery_item`/`DeliveryItem` 且无 `@2.0`；Catalog 213、Baseline 200；无 `TaskDefinitionSnapshot` objectType；创建 Result 只含 `taskRef`/`status`/`aggregateVersion`。v2 Schema/`references` 未改动由 `contracts` 既有回归覆盖 | `PASS` |
| TE-P202-015 | Contract/Event | DRAFT 创建事务的 Outbox 行数与事件发布路径；尝试发布 `TaskCreated` 或任意未注册事件 | Outbox 为 0 行；未注册事件被拒绝，不进入 Dispatcher/EP Inbox | `task-draft-creation.test.ts`：创建事务对该 aggregate 的 Outbox 为 0 行且总数不变；`public-api.v1.json` 为 213 项、`execution.*` Event 恰 11 项且无 `TaskCreated` | `PASS` |

独立设计审查与人类批准分别记录。`TE-P202-001`–`015` 的实现切片已由 [Issue #204](https://github.com/qzhike/zhiju-business-core/issues/204) 交付并在真实 PostgreSQL 18.6 执行通过（实现入口见 [Spec 003 §16.9](../module-specs/Module-Spec-003-TaskExecution.md#169-实现事实与验证边界2042026-09-15)）；唯一未执行子项是 TE-P202-004 的 `CANCELLED`/`REPLACED` DeliveryItem 分支，原因见该行。本表的通过不扩大到 Task READY、WorkOrder、Run/Attempt/Result、Completion 或人工业务验收。
