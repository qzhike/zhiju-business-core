# IM-02 WI-03 本地 Runbook：RLS 事务上下文与 Scope 防伪手动验收

对应 Issue #31。自动验收入口是 `pnpm persistence:gate`（新增 `tests/persistence/rls-context.test.ts`）；本文提供脱敏数据的人工探测：A/B Enterprise 与 A1/A2 Project，用户切换受控 Context 后可直接观察允许行集合，无 Context/伪造 Context 探测明确失败。机制与威胁模型见 [`rls-context-design-wi-03.md`](../decisions/rls-transaction-context.md)。

## 启动探测环境

```bash
pnpm install
pnpm persistence:gate   # 空库 migrate + 自动化矩阵 + 复跑 no-op migrate
```

交互式探测（与 Gate 同构，仅本地一次性容器；migrations 在 docker run 时挂载）：

```bash
docker run --rm -d --name zju-wi03-probe \
  -e POSTGRES_DB=zhiju_core -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=zhiju-gate-test \
  -v "$PWD/migrations:/sql:ro" \
  docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941
docker exec zju-wi03-probe sh -c '
  attempts=0
  until pg_isready -U postgres -d zhiju_core; do
    attempts=$((attempts + 1)); [ "$attempts" -lt 30 ] || exit 1; sleep 1
  done
' && docker exec -i zju-wi03-probe psql -U postgres -d zhiju_core -v ON_ERROR_STOP=1 \
  -f /sql/bootstrap/V0001__platform_bootstrap.sql \
  -f /sql/bootstrap/V0002__schema_roles_baseline.sql \
  -f /sql/bootstrap/V0003__platform_rls_context.sql
```

## 一次性准备（superuser 会话内）

```sql
-- 受信应用登录（生产中 credential 由部署侧签发，这里仅本地探测）
CREATE ROLE wi03_manual_app LOGIN PASSWORD 'probe' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT platform_context_establisher, enterprise_project_app TO wi03_manual_app;

-- 按 WI-03 Policy 模式建立 Enterprise-owned 探针表并灌入 A/B 数据
SET ROLE enterprise_project_owner;
CREATE TABLE enterprise_project.manual_enterprise_probe (
  id uuid PRIMARY KEY, enterprise_id uuid NOT NULL, display_code text NOT NULL);
CREATE POLICY m_ent_sel ON enterprise_project.manual_enterprise_probe FOR SELECT TO enterprise_project_app
  USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY m_ent_ins ON enterprise_project.manual_enterprise_probe FOR INSERT TO enterprise_project_app
  WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
ALTER TABLE enterprise_project.manual_enterprise_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.manual_enterprise_probe FORCE ROW LEVEL SECURITY;
RESET ROLE;

INSERT INTO enterprise_project.manual_enterprise_probe VALUES
  ('00000000-0000-7000-8000-0000000000a1', '11111111-1111-7111-8111-1111111111a1', 'ENT-A-ROW'),
  ('00000000-0000-7000-8000-0000000000b2', '22222222-2222-7222-8222-2222222222b2', 'ENT-B-ROW');
```

## 探测 1：无 Context 与伪造 Context（预期全部零行/拒绝）

```bash
docker exec -it zju-wi03-probe psql -U wi03_manual_app -d zhiju_core
```

```sql
SET ROLE enterprise_project_app;
SELECT count(*) FROM enterprise_project.manual_enterprise_probe;   -- 0 行（无 Context）

SET app.zju.enterprise_id = '22222222-2222-7222-8222-2222222222b2';
SELECT count(*) FROM enterprise_project.manual_enterprise_probe;   -- 仍 0 行（GUC 不是凭证）

SELECT count(*) FROM platform_security.tx_context;                 -- DENY 42501（直接伪造表行）
INSERT INTO platform_security.tx_context DEFAULT VALUES;           -- DENY 42501

SELECT platform_security.establish_transaction_context(
  'REQUEST', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  decode(repeat('ab', 32), 'hex'), now() + interval '1 hour',
  '22222222-2222-7222-8222-2222222222b2', ARRAY[]::uuid[], gen_random_uuid(), NULL);
-- DENY 42501（普通 App Role 没有 establish EXECUTE）
```

## 探测 2：受控 Context 下观察允许行集合

同一 `wi03_manual_app` 会话内：

```sql
BEGIN;
SET LOCAL ROLE platform_context_establisher;
SELECT platform_security.establish_transaction_context(
  'REQUEST',
  '55555555-5555-7555-8555-5555555555e1',            -- principal_id
  '66666666-6666-7666-8666-6666666666f1',            -- actor_snapshot_id
  '77777777-7777-7777-8777-7777777777a1',            -- authorization_decision_id
  decode(repeat('ab', 32), 'hex'),                   -- decision payload hash (32B)
  now() + interval '1 hour',                         -- decision expires_at
  '11111111-1111-7111-8111-1111111111a1',            -- Enterprise A
  ARRAY['33333333-3333-7333-8333-3333333333c1']::uuid[], -- 允许 Project A1
  '88888888-8888-7888-8888-8888888888a1',            -- correlation_id
  NULL);
SET LOCAL ROLE enterprise_project_app;
SELECT display_code FROM enterprise_project.manual_enterprise_probe;  -- 只见 ENT-A-ROW
COMMIT;
SET ROLE enterprise_project_app;
SELECT count(*) FROM enterprise_project.manual_enterprise_probe;      -- COMMIT 后回到 0 行（池复用不泄漏）
RESET ROLE;
```

把 enterprise 参数换成 B 重复一次，则只见 `ENT-B-ROW`。换成过期 `expires_at`（`now() - interval '1 minute'`）则 establish 直接异常，不产生任何可见行。

## 探测 3：过期/不匹配 AuthorizationDecision

```sql
BEGIN;
SET LOCAL ROLE platform_context_establisher;
SELECT platform_security.establish_transaction_context(
  'REQUEST', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  decode(repeat('ab', 32), 'hex'), now() - interval '1 minute',
  '11111111-1111-7111-8111-1111111111a1', ARRAY[]::uuid[], gen_random_uuid(), NULL);
-- ERROR: authorization decision is expired or has no expiry（事务内无 Context 产生）

-- 同事务重复 establish 不同 decision：
-- ERROR: platform_context_conflict ...
```

## 清理

```bash
docker rm -f zju-wi03-probe
```

## NOT RUN 声明

- 生产 break-glass、Keycloak token 验证、真实 OpenBao HMAC/加密与 IdentityPolicy Decision Port 落表比对均为 `NOT RUN`（WI-05/WI-09 接入）；
- `platform_context_establisher` 的生产 Login/Credential、连接池与事务协调器接入为 `NOT RUN`；本地 probe 只验证数据库角色边界；
- Background Consumer 的 Event Scope 数据源交叉校验（outbox/inbox 落表后由 WI-04/WI-10 补齐）为 `NOT RUN`；
- 本 Runbook 只证明数据库层拒绝，不宣称应用层授权链完成。
