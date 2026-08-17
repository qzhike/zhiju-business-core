# Module-Test-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / SCHEMA-LEVEL CONTRACT FIXTURES PASSED 2026-08-17 / HANDLER E2E NOT RUN`

对应规格：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md)。

Runtime 原始协议与 TaskExecution API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项定义 32 个场景；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个保持 `NOT RUN`。6 个 additive Command proposal 在用户审核前不改变本文件 19 个 Command 的 Design Gate 基准。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| TE-API-D-001 | Design | TaskExecution Module Spec 与 Catalog | 19 Command、7 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=19 queries=7 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| TE-API-S-001 | Schema | 37 个 FULL 操作 Payload/Result Schema 注册到 `ContractRegistry` | Registry `operationCount=200`，本模块 37 项 `FULL`，所有 Payload/Result 通过 `validateOperation`/`validateOperationResult` | `contract_registry` 测试套件新增 11 个 TaskExecution 用例全部 `PASS`；Registry operationCount=200，task-execution FULL=37 | `PASSED` |
| TE-API-S-002 | Schema | `execution.create_task` 命令携带未知字段 `skipPolicyCheck` | Registry 拒绝 `/payload/definition/skipPolicyCheck` | `additionalProperties` keyword 触发 `/payload/definition` 错误 | `PASSED` |
| TE-API-S-003 | Schema | `execution.start_run` 携带负数 `fencingToken` | Registry 拒绝 `/payload/fencingToken` | `minimum` keyword 触发错误 | `PASSED` |
| TE-API-S-004 | Schema | `execution.accept_agent_result` 用 `objectRef` 而非 `contentAddressedRef` | Registry 拒绝 `/payload/agentResultRef` | `const` keyword 触发错误（`kind` 必须是 `CONTENT_ADDRESSED`） | `PASSED` |
| TE-API-S-005 | Schema | `execution.RunStarted` Event payload 包含 `leaseId`/`sessionToken` | Registry 拒绝 `/payload` | `additionalProperties` keyword 触发错误 | `PASSED` |
| TE-API-S-006 | Schema | `execution.RunTerminated` Event 使用不在 `RunStatus` 枚举内的状态 | Registry 拒绝 `/payload/terminalStatus` | `enum` keyword 触发错误 | `PASSED` |
| TE-API-S-007 | Schema | `execution.get_run_state` Result 包含未知嵌套字段 `executionSecret` | Registry 拒绝 `/runtimeBinding` | `additionalProperties` keyword 触发错误 | `PASSED` |
| TE-API-S-008 | Schema | `execution.get_usage_and_provenance` Result 表示 UNKNOWN usage | Registry 接受（UNKNOWN 是允许的 `presence`） | `validateOperationResult` 返回 `valid: true` | `PASSED` |
| TE-API-U-001 | Unit | READY WorkOrder 请求扩大 target scope | 拒绝 `EXECUTION_WORK_ORDER_SPEC_IMMUTABLE`，要求新 WorkOrder | 无实现 | `NOT RUN` |
| TE-API-U-002 | Unit | 两个 Dispatcher 竞争同 WorkOrder active Run | 只有一个 claim/fencing token 生效，另一个返回 active conflict | 无并发实现 | `NOT RUN` |
| TE-API-U-003 | Unit | terminal Run 提交第二个不同 Hash final Result | Quarantine/replay conflict；不处理 BusinessOutput | 无实现 | `NOT RUN` |
| TE-API-C-001 | Contract | WorkOrder Contract 缺 base Revision Hash 或含 Human-only Agent Capability | Contract Validation 拒绝，不能 freeze/queue | 无 Schema/Fixture | `NOT RUN` |
| TE-API-C-002 | Contract | AgentResult 只有 scratch DOCX | Result 可记录但 ExpectedOutput 未满足；WorkspaceOutput 不提升 | 无 Handler/Evaluator | `NOT RUN` |
| TE-API-E-001 | E2E | final BLOCKED_INPUT→飞书答案→恢复 | 创建新 Answer/Context/Run；旧 Run 不 Resume、不改写 | 无 Runtime/飞书实现 | `NOT RUN` |
| TE-API-E-002 | E2E | Run timeout 后按 Policy fallback 到另一 Runtime | 新 attempt/Run/Token/Context 绑定；旧 Usage/Provenance 保留 | 无 Runtime 实现 | `NOT RUN` |
| TE-API-M-001 | Manual | CTX→WO→Run→Result Fixture | 审核者能区分 Run 成功、WorkOrder 完成与 Task 完成，并验证缺输入恢复链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 层 Contract（TE-API-S-001 ~ TE-API-S-008）：`PASSED`，新增 11 个 fixture、8 个 Schema 用例全部 `PASS`，Registry operationCount=200、task-execution FULL=37。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Context Builder、Dispatcher、Runtime、Evaluator、Persistence、Projection 与 Handler 实现均不存在；本阶段未声明 CLI 或 DB E2E 已运行。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 API proposal 尚未进入 Catalog 与本模块 Schema。
- 测试遗留：未创建临时脚本或测试文件；新增 8 个正向与负向 fixture 全部位于 `tests/fixtures/contracts/`，与生产代码同源管理。
