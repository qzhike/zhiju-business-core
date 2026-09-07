> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-12-deliveryitem-completion-impact-process/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-12-deliveryitem-completion-impact-process/Task-Plan.md).

# IM-03 WI-12 DeliveryItem Completion 与 Impact Process 执行计划

## 目标

完成 GitHub Issue #68：实现 DeliveryItem Completion Evaluator、下游事实 Inbox/Process Manager 与 Impact Review，使完成状态只能由精确 criteria 和正式事实派生，并在 replay、迟到/撤销及上游新版本场景保留历史；完成验证、PR 交付、Issue 关闭和 branch 清理。

## 当前基线

- 工作目录：`im-03-wi-12-deliveryitem-completion-impact-proce`
- 工作分支：`galendai/im-03-wi-12-deliveryitem-completion-impact-proce`
- 初始 HEAD：`a8eb515`，与 `main`、`origin/main` 一致
- Issue：`https://github.com/qzhike/zhiju-business-core/issues/68`，当前 OPEN
- 对应实现 PR：当前未发现

## 实施边界

- 只在 EnterpriseProject 模块实现本 Issue 所需的模型、Repository、Evaluator、Inbox/Process Manager、Impact Review 和受控 Fixture/验证。
- 不实现 TaskExecution、Artifact、QualityGovernance、ReleasePublication 的业务 Handler；这些模块只通过正式事实契约被消费。
- 真实跨模块 HTTP/E2E、外部发布、生产消息 broker 和 Human Reference Project 验收保持明确的 `NOT RUN` 边界。
- 所有新增/修改的项目文档使用中文；代码注释、commit message 与外部 GitHub 文本使用英文。

## 验收证据

1. 精确 criteria 缺少 ReleaseCompleted 时保持 `unsatisfied` 且不产生 CompletionSatisfied。
2. 调用者提交完成结果或直接 SQL 设置 COMPLETED 的路径不存在或被拒绝。
3. 同 event/command 与相同 hash replay 幂等；同标识不同 hash 进入 Quarantine/Audit，不能产生第二业务事实。
4. 迟到、撤销和上游新版本只追加 Evaluation/Impact Review，不改写旧 Evaluation 或已批准 Plan Version。
5. EP-API-U-003、EP-E-002 及适用 Unit/Persistence/受控 E2E 有输入、预期输出、实际输出记录。
6. 可按顺序注入 TaskCompleted 与 ReleaseCompleted Fixture，观察精确 criteria 完整后才产生 CompletionSatisfied。

## 执行步骤

1. 读取 HL-Spec、EnterpriseProject Module-Spec、Module-Test 和现有 WI-10/WI-11 实现，建立契约映射。
2. 先同步规格与测试文档，再进行最小范围代码实现。
3. 添加回归测试和受控数据库/Fixture 验证；主链、revoke/new-version、ACL/RLS、事务回滚、晚到事实、SATISFIED 状态转移与 `sourceEventId` 绑定断言已写入，Unit 目录已纳入 `tsc`/ESLint project service；最终 `pnpm verify` 已通过，按证据边界报告 `PASS`/`NOT RUN`。
4. 已复核 diff、运行项目 Gate，并生成本目录下的验证记录；commit、PR、Issue close 和 branch 清理仍保留为独立后续边界。
5. 展示变更范围并等待用户确认后，执行独立 commit/push；随后 exact-head review、merge、Issue close 和 branch 清理均逐项 API/readback 验证。
