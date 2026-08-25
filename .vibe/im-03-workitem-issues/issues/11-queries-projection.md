## 目标

实现 EnterpriseProject 权威 Query、权限裁剪 Source Slice 与可重建 Project Board Projection，且 Projection 延迟永远不能成为 Command 或 Completion 判据。

父追踪：#56

硬依赖：#60、#62、#63、#64、#66

## 范围

- `project.get_project_context_source`、`project.get_active_baseline_refs`、`project.get_delivery_item_criteria`、`project.get_project_board_slice`；`get_enterprise_profile_snapshot` 和 `validate_object_scope` 分别由 WI-03/WI-04 交付。
- AUTHORITATIVE/PERSISTENT consistency、稳定 cursor、权限裁剪、omission/redaction 与 source watermark。
- Projection consumer/checkpoint/rebuild/swap 最小路径；读取别名与 stale/lag 可观测性。
- 不在 Query 中跨 Schema Join；精确 Ref 经公开 Port 解析。

## 验收条件

- [ ] Source Slice 只返回调用 purpose/audience 可见字段，并显式输出 omissions/redactions/watermark。
- [ ] Active refs 和 criteria 只返回 Root 明确 active/current 指针，不查询 `latest` 替代精确版本。
- [ ] Project Board 的分页稳定；Projection lag/rebuild 不改变权威 Command 或 Completion 结果。
- [ ] 跨 Project 查询、cursor scope/shape mismatch、过期授权与敏感值泄漏被拒绝。
- [ ] 从权威 Snapshot Export + Event Delta 重建后，checkpoint、行数和领域校验和一致。
- [ ] 用户可对同一 Project 比较权威 Query 与故意暂停的 Projection，看到 lag 被标记且业务状态未被误判。

## 非目标与 `NOT RUN` 边界

- 不实现完整 TaskExecution ContextSnapshot 或跨模块 Workspace 聚合。
- 不把 Outbox 当永久完整 Event Sourcing 日志。
