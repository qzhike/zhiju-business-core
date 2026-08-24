# IM-02 WI-09 本地 Runbook：Decision 链脱敏追踪视图

对应 Issue #37。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/identity-policy-decisions.test.ts`）。

## 手动验收（脱敏追踪视图）

启动一次性容器并应用全部 migration（同 runbook-wi-04,容器名 `zju-wi09-probe`）。自动化矩阵已建好 Principal → Role/Capability → PolicySnapshot → ActorSnapshot → AuthorizationDecision 全链;人工对比三条链（Project A ALLOW、Project B DENY、Agent actingFor DENY）：

```sql
-- 1) 脱敏链:Principal → Grant → ActorSnapshot → Decision
SELECT p.id AS principal, p.principal_kind, g.capability_code, g.project_id,
       a.actor_snapshot_id, a.principal_kind AS actor_kind, a.acting_for_kind,
       d.outcome, d.reason_codes, d.project_id, d.expires_at
FROM identity_policy.authorization_decision d
JOIN identity_policy.actor_snapshot a ON a.actor_snapshot_id = d.actor_snapshot_id
JOIN identity_policy.principal p ON p.id = d.principal_id
LEFT JOIN identity_policy.capability_grant g
  ON g.principal_id = p.id AND g.capability_code = d.requested_capability
ORDER BY d.created_at;

-- 2) 三条链对比要点
--    Project A1 请求 → outcome=ALLOW, reasons={ALLOWED_BY_GRANT}
--    Project A2 请求 → outcome=DENY,  reasons={NO_ACTIVE_GRANT}(不泄漏对象存在性)
--    Agent actingFor Human 的 Human-only → principal_kind 保持 AGENT,
--                                           reasons={CAPABILITY_HUMAN_ONLY}
SELECT principal_kind, acting_for_kind, outcome, reason_codes
FROM identity_policy.authorization_decision d
JOIN identity_policy.actor_snapshot a ON a.actor_snapshot_id = d.actor_snapshot_id
WHERE d.requested_capability = 'release.authorize';

-- 3) Decision/Snapshot 不可变
SET ROLE identity_policy_app;
UPDATE identity_policy.authorization_decision SET outcome='ALLOW';  -- DENY 42501
DELETE FROM identity_policy.actor_snapshot;                        -- DENY 42501
RESET ROLE;
```

## NOT RUN 声明

Keycloak token/JWKS 验证、真实飞书身份解析、#22–#24 各 Runtime Handler 的 Decision provenance 验证保持 `NOT RUN`。
