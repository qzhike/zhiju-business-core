> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/12-completion-impact.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/12-completion-impact.md).
> Published Issue: [#68](https://github.com/qzhike/zhiju-business-core/issues/68); this file is a historical draft, not its current body.

## 目标

实现 DeliveryItem Completion Evaluator、下游事实 Inbox/Process Manager 与 Impact Review，使完成状态只由精确 criteria 和正式事实派生，并在 replay/上游变化时保留历史。

父追踪：#56

硬依赖：#58、#63、#64、#66、#67

## 范围

- `delivery_item_completion_evaluation`、`delivery_item_impact_review` 业务模型与 Repository。
- `project.evaluate_delivery_item_completion`、`project.DeliveryItemCompletionSatisfied`、`project.DeliveryItemImpactReviewRequested`。
- 受控 Task/Revision/Approval/Release 等正式事件 Fixture 的 Inbox replay、watermark、fact ref/hash/lifecycle 验证。
- criteriaHash、Evaluator version/hash、事实集合和 outcome 的不可变记录；Root 只显式指向 current evaluation。

## 验收条件

- [ ] TaskCompleted 存在但 criteria 要求的 ReleaseCompleted 不存在时 evaluation 为 unsatisfied，且不发 CompletionSatisfied。
- [ ] 调用者 submittedCompletion 或直接 SQL 设置 COMPLETED 路径不存在/被拒绝。
- [ ] 同 event/command 相同 Hash replay 幂等；不同 Hash 冲突进入审计/Quarantine，不生成第二业务事实。
- [ ] 迟到、撤销或上游新版本只产生新 Evaluation/Impact Review，不改写旧 Evaluation 或已批准 Plan Version。
- [ ] EP-API-U-003、EP-E-002 等适用场景有 focused Unit/Persistence/受控 E2E 证据。
- [ ] 用户可依次注入 TaskCompleted 与 ReleaseCompleted Fixture，看到只有精确 criteria 完整时才产生 CompletionSatisfied。

## 非目标与 `NOT RUN` 边界

- 不实现 TaskExecution、Artifact、QualityGovernance 或 ReleasePublication 的业务 Handler。
- 真实跨模块 HTTP/E2E 与外部发布在下游里程碑完成前保持 `NOT RUN`；本项只证明 EnterpriseProject 消费边界与派生语义。
