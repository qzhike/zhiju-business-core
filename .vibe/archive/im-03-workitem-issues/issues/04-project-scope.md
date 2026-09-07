> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/04-project-scope.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/04-project-scope.md).
> Published Issue: [#60](https://github.com/qzhike/zhiju-business-core/issues/60); this file is a historical draft, not its current body.

## 目标

实现 Project Aggregate、启动快照绑定、Scope Claim 与权威对象 Scope 验证，为所有 Project-owned 切片建立不可迁移的 Enterprise/Project 边界。

父追踪：#56

硬依赖：#59

## 范围

- `project`、`project_scope_claim`、`project_snapshot_binding` 业务 Migration、Repository 与 `project.create_project` Handler。
- ProjectStartSnapshot 与 memberPolicyRef 的精确 ID/version/hash、生命周期和同 Enterprise 校验。
- `project.validate_object_scope` 权威 Query；无跨企业/项目搜索替代对象。
- Enterprise/Project RLS、复合唯一/外键与 Scope 不可移动约束。

## 验收条件

- [ ] Project 只接受同 Enterprise 且满足 WI-01 冻结规则的 Profile/QMS/Product/Policy Ref。
- [ ] Optional Baseline/Profile Ref 缺失与错误 Ref 可区分；不得解析 `latest`。
- [ ] Project 的 enterprise_id/project_id、Scope Claim 和 Snapshot Binding 不能被后续更新迁移。
- [ ] Project A Command 引用 Project B 对象返回稳定 Scope 错误，且不跨项目枚举候选对象。
- [ ] RLS、复合约束、CAS、幂等与事务回滚在真实 PostgreSQL 通过。
- [ ] 用户可创建同 Enterprise 的 Project A/B，并看到跨 Project 引用 probe 被拒绝。

## 非目标与 `NOT RUN` 边界

- 不实现完整 ContextSnapshot；TaskExecution 仍是完整 Context Assembly Owner。
- 不实现 Project Board Projection 或下游 Artifact/Task 行为。
