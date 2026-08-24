# IM-02 WI-08 本地 Runbook：Role/Capability/PolicySnapshot 手动验收

对应 Issue #36。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/identity-policy-roles.test.ts`：重复 active 拒绝、Human-only Registry、Scope/有效期/policy 精确引用、expectedVersion 撤销追加事实、首角色 bootstrap 永久关闭、事件脱敏、Project RLS、并发唯一裁决和幂等冲突）。迁移必须包含 V1003 Project scope RLS，并在第二次 migrate 中保持 no-op。

## 手动验收（复用 gate 数据面）

启动一次性容器并应用全部 migration（同 runbook-wi-04,容器名 `zju-wi08-probe`）。自动化矩阵已覆盖行为;人工复核用以下 psql 视图：

```sql
-- 1) 测试 Human 在 Enterprise A / Project A 的 Role/Capability(精确 Scope + 有效期)
SELECT principal_id, role_code, scope_kind, enterprise_id, project_id, status
FROM identity_policy.role_assignment ORDER BY created_at;

SELECT capability_code, scope_kind, enterprise_id, project_id, status,
       grant_policy_snapshot_id
FROM identity_policy.capability_grant ORDER BY created_at;

-- 2) 撤销后:历史事实仍在(assignment/grant 行 + 追加的 revocation fact),不改写
SELECT r.role_assignment_id, r.reason_code, r.effective_at, r.recorded_at
FROM identity_policy.role_revocation r;
SELECT status FROM identity_policy.role_assignment WHERE status = 'REVOKED'; -- 历史仍在

-- 2a) Revocation 的 promoted Project scope 与目标 Assignment/Grant 一致
SELECT r.role_assignment_id, r.project_id, a.project_id AS assignment_project_id
FROM identity_policy.role_revocation r
JOIN identity_policy.role_assignment a ON a.id = r.role_assignment_id;
SELECT r.capability_grant_id, r.project_id, g.project_id AS grant_project_id
FROM identity_policy.capability_revocation r
JOIN identity_policy.capability_grant g ON g.id = r.capability_grant_id;

-- 3) Agent 的 Human-only grant:稳定拒绝 + 安全审计(kind 保持 AGENT)
SELECT error_code, safe_summary FROM identity_policy.audit_record
WHERE error_code = 'IDENTITY_CAPABILITY_HUMAN_ONLY' ORDER BY recorded_at DESC;

-- 4) 首角色 bootstrap:claim 一次性消费且永久关闭
SELECT purpose, consumed_at IS NOT NULL AS consumed, closed_at IS NOT NULL AS closed
FROM identity_policy.bootstrap_claim WHERE purpose = 'FIRST_ADMIN_ROLE';

-- 5) 公开事件不含 constraints 全文/资源选择器/token
SELECT event_type, payload::text FROM identity_policy.outbox_event
WHERE event_type LIKE 'identity.%';
```

## NOT RUN 声明

Keycloak Realm Role 映射、Release/Approval 业务模块 Human-only Handler(#22–#24)保持 `NOT RUN`。从包含既有 Project Revocation 的旧库升级至 V1003 的非空迁移探针已在一次性 PostgreSQL 容器中执行通过；临时探针已清理。
