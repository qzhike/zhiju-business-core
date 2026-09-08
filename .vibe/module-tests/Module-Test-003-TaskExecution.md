# Module-Test-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / PR #12 INTEGRATION GATE PASSED / HANDLER E2E NOT RUN`

对应规格：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md)。

Runtime 原始协议与 TaskExecution API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项定义 32 个场景；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个保持 `NOT RUN`。6 个 additive Command proposal 在用户审核前不改变本文件 19 个 Command 的 Design Gate 基准。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| TE-API-D-001 | Design | TaskExecution Module Spec 与 Catalog | 19 Command、7 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=19 queries=7 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| TE-API-S-001 | Schema | 37 个 FULL 操作 Payload/Result Schema 注册到 `ContractRegistry` | Registry `operationCount=200`，本模块 37 项 `FULL`，已覆盖的 Payload/Result 正反向 Fixture 通过 `validateOperation`/`validateOperationResult` | `registry.test.ts` 共 35 个用例全部 `PASS`；Registry operationCount=200，task-execution FULL=37 | `PASSED` |
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
| TE-API-U-001 | Unit | READY WorkOrder 请求扩大 target scope | 拒绝 `EXECUTION_WORK_ORDER_SPEC_IMMUTABLE`，要求新 WorkOrder | 无实现 | `NOT RUN` |
| TE-API-U-002 | Unit | 两个 Dispatcher 竞争同 WorkOrder active Run | 只有一个 claim/fencing token 生效，另一个返回 active conflict | 无并发实现 | `NOT RUN` |
| TE-API-U-003 | Unit | terminal Run 提交第二个不同 Hash final Result | Quarantine/replay conflict；不处理 BusinessOutput | 无实现 | `NOT RUN` |
| TE-API-C-001 | Contract | WorkOrder Contract 缺 base Revision Hash 或含 Human-only Agent Capability | Contract Validation 拒绝，不能 freeze/queue | 无 Schema/Fixture | `NOT RUN` |
| TE-API-C-002 | Contract | AgentResult 只有 scratch DOCX | Result 可记录但 ExpectedOutput 未满足；WorkspaceOutput 不提升 | 无 Handler/Evaluator | `NOT RUN` |
| TE-API-E-001 | E2E | final BLOCKED_INPUT→飞书答案→恢复 | 创建新 Answer/Context/Run；旧 Run 不 Resume、不改写 | 无 Runtime/飞书实现 | `NOT RUN` |
| TE-API-E-002 | E2E | Run timeout 后按 Policy fallback 到另一 Runtime | 新 attempt/Run/Token/Context 绑定；旧 Usage/Provenance 保留 | 无 Runtime 实现 | `NOT RUN` |
| TE-API-M-001 | Manual | CTX→WO→Run→Result Fixture | 审核者能区分 Run 成功、WorkOrder 完成与 Task 完成，并验证缺输入恢复链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 层 Contract（TE-API-S-001 ~ TE-API-S-018）均为 `PASSED`；合并 PR #12 后全项目为 118/118；Registry operationCount=200、FULL=115、ENVELOPE_ONLY=85、task-execution FULL=37。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Context Builder、Dispatcher、Runtime、Evaluator、Persistence、Projection 与 Handler 实现均不存在；本阶段未声明 CLI 或 DB E2E 已运行。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 API proposal 尚未进入 Catalog 与本模块 Schema。
- 测试遗留：未创建临时脚本或临时测试文件；永久 Fixture 位于 `tests/fixtures/contracts/`，与生产代码同源管理。

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
| TE-TD-002 | Contract | 旧build_context_snapshot缺ContractRef；新initial请求含旧ContractRef/未知字段 | 旧Schema仍拒绝；initial闭集拒绝错分支；旧合法fixture不变 | NOT RUN |
| TE-TD-003 | Persistence | Builder查询Draft后并发Freeze或未来合法Draft换代；提交前故障 | stale请求拒绝，无成功Context；原Snapshot/Hash保留 | NOT RUN |
| TE-TD-004 | Unit/Persistence | Builder提交后Draft变化，再用旧Context冻结 | Freeze拒绝；旧Context只历史可读，不能create_run | NOT RUN |
| TE-TD-005 | Contract/Persistence | Slice错id/hash/Scope/Purpose/Audience/Policy，或伪造动态View Hash | 统一不可用，内部Audit原因准确；无Context发布 | NOT RUN |
| TE-TD-006 | Persistence | 同键重放capture/build/validation；同键异payload | 原事实原结果；无重复成功效果；异Hash冲突 | NOT RUN |
| TE-TD-007 | Unit/Contract | 伪造valid=true、五个不同Bundle验证Ref、kind/subject错配 | Judgment/Acceptance拒绝，不推进Run或Completion | NOT RUN |
| TE-TD-008 | Unit/Persistence | Judgment/Decision过期、输入版本变化；同一长事务中到期 | consumer重验失败；旧判断不可变，新判断新identity | NOT RUN |
| TE-TD-009 | Contract | Task v2错误criterion分支/重复ID/未知Policy/任意表达式；v1合法payload | v2拒绝且不READY；v1Schema不变，不回写旧定义 | NOT RUN |
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

独立设计审查应核对 TD-01–04、新操作清单、所有具体失败矩阵与单Aggregate/兼容边界。人类对具体技术设计的批准不等于上述运行结果。真实Feishu/CLI Runtime、公开HTTP、生产和独立人工业务验收继续独立NOT RUN。
