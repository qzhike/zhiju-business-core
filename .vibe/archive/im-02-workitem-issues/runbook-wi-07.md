> Historical record. Related Issue: [35](https://github.com/qzhike/zhiju-business-core/issues/35). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-02 WI-07 本地 Runbook：脱敏身份 Fixture 与安全解析

对应 Issue #35。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/identity-policy-commands.test.ts` + `modules/identity-policy/src/commands/events.test.ts`）。WI-06 已占用 `V1002` 增加平台 Receipt expected version；WI-07 的 `bootstrap_claim` 使用后续 forward-only `V1003`，不得复用已定义版本。

## 手动验收

启动一次性容器并应用全部 migration（同 runbook-wi-04，容器名 `zju-wi07-probe`），然后：

```bash
ZJU_DATABASE_URL='postgres://postgres:zhiju-gate-test@127.0.0.1:PORT/zhiju_core' \
  node --experimental-strip-types tests/manual/wi07-probe.mts
```

输出依次为：

```text
[register HUMAN]  COMMITTED   （一次性 bootstrap claim 被消费）
[register AGENT]  COMMITTED
[register SERVICE] COMMITTED
[link]            COMMITTED
[resolve]         { objectType: 'Principal', objectId: ... } ExternalIdentityLink
[events] count:   4
[events] raw identifiers leaked: false
```

用户随后可用 psql 复核安全视图（无法从任何输出恢复原始标识）：

```sql
-- 事件只含 lookup hash 引用,不含 open_id/email/phone
SELECT payload->'externalIdentityLookupHashRef' FROM identity_policy.platform_outbox_event
WHERE event_type = 'identity.ExternalIdentityLinked' LIMIT 1;

-- bootstrap claim 的受审计消费证据
SELECT purpose, consumed_at IS NOT NULL AS consumed, closed_at FROM identity_policy.bootstrap_claim;

-- 原始标识在数据库中不存在明文
SELECT count(*) FROM identity_policy.external_identity_link
WHERE encode(account_ciphertext, 'hex') LIKE '%wi07-manual%';  -- 0
```

## NOT RUN 声明

真实 Keycloak/OIDC、飞书身份 Adapter、OpenBao 生产加密：`NOT RUN`；Role/Capability 授予与首个业务 Role bootstrap 收口：`NOT RUN`（WI-08）。
