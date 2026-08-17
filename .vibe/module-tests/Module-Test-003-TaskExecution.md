# Module-Test-003-TaskExecution

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md)。

Runtime 原始协议与 TaskExecution API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项定义 32 个场景；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个保持 `NOT RUN`。6 个 additive Command proposal 在用户审核前不改变本文件 19 个 Command 的 Design Gate 基准。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| TE-API-D-001 | Design | TaskExecution Module Spec 与 Catalog | 19 Command、7 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=19 queries=7 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| TE-API-U-001 | Unit | READY WorkOrder 请求扩大 target scope | 拒绝 `EXECUTION_WORK_ORDER_SPEC_IMMUTABLE`，要求新 WorkOrder | 无实现 | `NOT RUN` |
| TE-API-U-002 | Unit | 两个 Dispatcher 竞争同 WorkOrder active Run | 只有一个 claim/fencing token 生效，另一个返回 active conflict | 无并发实现 | `NOT RUN` |
| TE-API-U-003 | Unit | terminal Run 提交第二个不同 Hash final Result | Quarantine/replay conflict；不处理 BusinessOutput | 无实现 | `NOT RUN` |
| TE-API-C-001 | Contract | WorkOrder Contract 缺 base Revision Hash 或含 Human-only Agent Capability | Contract Validation 拒绝，不能 freeze/queue | 无 Schema/Fixture | `NOT RUN` |
| TE-API-C-002 | Contract | AgentResult 只有 scratch DOCX | Result 可记录但 ExpectedOutput 未满足；WorkspaceOutput 不提升 | 无 Handler/Evaluator | `NOT RUN` |
| TE-API-E-001 | E2E | final BLOCKED_INPUT→飞书答案→恢复 | 创建新 Answer/Context/Run；旧 Run 不 Resume、不改写 | 无 Runtime/飞书实现 | `NOT RUN` |
| TE-API-E-002 | E2E | Run timeout 后按 Policy fallback 到另一 Runtime | 新 attempt/Run/Token/Context 绑定；旧 Usage/Provenance 保留 | 无 Runtime 实现 | `NOT RUN` |
| TE-API-M-001 | Manual | CTX→WO→Run→Result Fixture | 审核者能区分 Run 成功、WorkOrder 完成与 Task 完成，并验证缺输入恢复链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Unit/Contract/E2E/Manual：`NOT RUN`，原因是实现、Schema 与 Fixture 尚不存在。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 API proposal 尚未进入 Catalog。
- 测试遗留：未创建临时脚本或测试文件。
