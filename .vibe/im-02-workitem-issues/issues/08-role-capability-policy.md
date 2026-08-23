## 背景

IdentityPolicy 必须在精确 Enterprise/Project Scope 和有效期下拥有 RoleAssignment、CapabilityGrant 与 PolicySnapshot。Role/Capability 不能通过 `actingFor` 隐式继承，AGENT/RUNTIME 永远不能获得 Human-only Capability，撤销也不能改写历史授权证据。

父追踪 Issue：#28（WI-08）。硬依赖：WI-06、WI-07。

## 工作范围

- 实现 assign/revoke Role、grant/revoke Capability、record PolicySnapshot 共 5 个 Command Handler。
- 校验 Scope 存在性、effective period、重复 active assignment/grant、expected version、justification 与静态 Human-only Capability Registry。
- PolicySnapshot 必须 immutable、hash 精确且引用的 Schema Registry 可解析；不提供 `current/latest` 替代精确 ref。
- 撤销创建追加事实，不删除 Assignment/Grant，也不改写历史 ActorSnapshot/AuthorizationDecision。
- 完成首个业务 Principal + 最小管理 Role 的受审计 bootstrap；完成后永久关闭 bootstrap claim，后续授权走普通 Command。

## 验收条件

- [ ] 同 Principal/Role/Scope 的重复 active assignment 和同 Capability/Scope 的重复 active grant 被确定性拒绝。
- [ ] AGENT/RUNTIME 请求 Human-only Capability 返回 `IDENTITY_CAPABILITY_HUMAN_ONLY`；`actingFor` 不改变主体 kind。
- [ ] 无效/跨 Enterprise Scope、过期 effective period、未知 Policy schema/version 和 expected version 冲突被拒绝。
- [ ] 撤销后历史 Assignment/Grant/Policy 与旧 Decision 仍可按精确 ref/hash 读取；新授权检查不再使用已撤销项。
- [ ] IP-API-U-003 的 Assignment/Grant 撤销子场景与 IP-API-C-002 幂等冲突在真实 PostgreSQL 通过。
- [ ] 公开 Event 不包含 Role constraints 全文、Capability token、External ID 或个人联系方式。

## 手动验收产出

为测试 Human 授予仅限 Enterprise A / Project A 的 Role/Capability；撤销后展示历史事实仍在但新访问失败。对 Agent 执行同一 Human-only grant，用户可见稳定拒绝和安全审计。

## 非目标

- 不把 Keycloak Realm Role 映射成内部 Role/Capability。
- 不实现 Release/Approval 业务模块的 Human-only Handler；#22 仍单独追踪 Release provenance。
