# PR #218 独立设计审查

## 第 1 轮：`REQUEST_CHANGES`

- PR：[#218](https://github.com/qzhike/zhiju-business-core/pull/218)
- Reviewed SHA：`033b3c7520245d0a687765a4a2e8d74fbf047c21`
- Base SHA：`002c3c8368edfde60e7410f046f60b9102ddba5a`
- 日期：2026-09-21
- GitHub handoff：[#issuecomment-5757754168](https://github.com/qzhike/zhiju-business-core/pull/218#issuecomment-5757754168)（同账号 PR 评论，不是 GitHub formal review）

独立审查读取了该 head 的七份设计文档 diff、Core §4.12、TaskExecution 已批准的 §11.9、相关 Contract/Registry 与确切 revision 的验证证据。结论不基于设计作者的摘要。

### 阻断项：Validator Policy/Evaluator 与 candidate pin 混同

Spec 003 §21.2 要求本次请求的 `policyRef`/`evaluatorRef` 与 candidate 的“适用 pin/profile”一致，但 Core §4.12 的 WorkOrderContract VersionPins 不含 Validation Policy 或 Evaluator pin；Spec 003 §11.9 则规定 Validator 按本次请求独立解析 Policy 和构建期静态 Evaluator selector。按 §21.2 字面实现会拒绝合法的 `@1.1` candidate，或错用 Context Builder/Capability Policy。

修正要求：分别固定 Validator 本次 Policy/Evaluator 的独立来源及当前解析，和 candidate 已有 VersionPins 对 Draft、Context、受信观察的精确绑定；在 `TE-VAL-D-004/005` 加正例及单变量错配反例。`get_execution_judgment` 尚未注册，本轮首版结果是 READY 和 frozen Contract 的权威读回，因此公开判断读回未作为阻断项。

### 验证证据与未运行边界

Reviewer 在该 SHA 独立执行 `vibe verify full --json`，结果 `PASS`：单元/契约 72 个文件、1313 项测试通过，Catalog/Registry 均为 216；真实 PostgreSQL 18.6 持久化 44 个文件、493 项测试通过，第二次 Flyway migrate no-op。GitHub CI `verify` 在该 head 为 `SUCCESS`。文档语义的反例不由现行自动测试覆盖。Validation、Freeze、READY 的运行时行为以及外部和人工业务验收均 `NOT RUN`。

## 第 2 轮：`APPROVE`

- Reviewed SHA：`1acdf34c1cddaf1f1346c707925b8a7f0459ae70`
- 日期：2026-09-21
- GitHub handoff：[#issuecomment-5757895877](https://github.com/qzhike/zhiju-business-core/pull/218#issuecomment-5757895877)（同账号 PR 评论，不是 GitHub formal review）
- 人类修订批准：用户在第 1 轮具体阻断和拟议修正呈现后明确回复“批准”；范围与记录见[决定 §20.3](../../decisions/task-execution-human-operated.md#203-人类设计批准记录)。

独立复审核对了新 head 相对第 1 轮的增量、Core §4.12、Spec 003 §11.9 与现行 Registry。Spec 003 §21.2 现在将 candidate 已有 VersionPins 的 Draft/Context/受信观察绑定，与本次 Validation Policy 及静态 Evaluator 的独立解析分开；`TE-VAL-D-004/005` 增加了两侧正例及错配反例。第 1 轮阻断已解除，本轮未发现新的设计阻断。

该 head 的 GitHub CI `verify` 为 `SUCCESS`，Reviewer 独立执行 `vibe verify full --json` 为 `PASS`：普通测试 72 个文件、1313 项通过，Catalog/Registry 均为 216；PostgreSQL 18.6 持久化 44 个文件、493 项通过，二次 Flyway migrate no-op；`git diff --check` 通过。设计只定义后续实现边界，Validation、Freeze、READY 运行时行为和外部/人工业务验收仍 `NOT RUN`。本记录及状态事实增补后，合并前仍需核对最终 PR head 的差异、检查和合并条件。
