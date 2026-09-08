> Historical record. Related Issue: [30](https://github.com/qzhike/zhiju-business-core/issues/30). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-02 WI-02 本地 Runbook：Schema/Role 最小权限矩阵手动验收

对应 Issue #30。自动验收入口仍是 `pnpm persistence:gate`（见 `runbook-wi-01.md`）；本文提供权限矩阵的人工探测命令：以各类 Role 依次执行允许/禁止 SQL，并核对实际 `ALLOW`/`DENY` 与 SQLSTATE。全程只使用 Gate 的本地测试容器，用户无需接触生产 Secret。

## 权威角色清单（V0002）

- 每个 owning Schema `<module>`（7 个）：
  - `<module>_owner` — NOLOGIN、NOINHERIT；Schema 内唯一可 DDL 的角色。
  - `<module>_app` — Runtime Role；仅本 Schema 明确授权对象的 SELECT/INSERT/UPDATE，无 DELETE、无 DDL、非 Owner、无 BYPASSRLS。
  - `<module>_dispatcher` — 仅本模块 Outbox delivery metadata 的 SELECT + 列级 UPDATE（列级授权随 WI-04 的 outbox 表落地，bootstrap 只给 Schema USAGE）。
- `projection_app` — projection Schema USAGE。
- `audit_reader` — 仅可读后续显式授权的脱敏 View。
- `migration_runner` — 唯一可以 `SET ROLE <module>_owner` 的角色；对 owner 的成员关系为 SET-only（`WITH INHERIT FALSE SET TRUE`），不显式切换就没有任何 owner DDL 权限。
- 扩展：业务扩展集合仅为 `btree_gist`、`pg_stat_statements`（运维观测）；PostgreSQL 默认的 `plpgsql` 保留，不把它作为新增业务扩展；`pg_stat_statements` 的视图/函数已显式 REVOKE PUBLIC，预定义 `pg_read_all_stats` 只获得 View 与只读查询函数权限，不能执行统计重置；`pgcrypto` 不启用。
- `public` Schema 与 Database 的 CREATE 对 PUBLIC 与所有基线 Role 均为 REVOKE。

## 启动探测环境

```bash
pnpm install
pnpm persistence:gate   # 会先空库 migrate + 跑完自动化矩阵，再复跑 no-op migrate
```

如需交互式探测，手动起一个一次性容器（与 Gate 等价，仅本地；migrations 在 `docker run` 时挂载，`docker exec` 不支持 `-v`）：

```bash
docker run --rm -d --name zju-wi02-probe \
  -e POSTGRES_DB=zhiju_core -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=zhiju-gate-test \
  -v "$PWD/migrations:/sql:ro" \
  docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941
docker exec zju-wi02-probe sh -c '
  attempts=0
  until pg_isready -U postgres -d zhiju_core; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 30 ] || exit 1
    sleep 1
  done
' && docker exec -i zju-wi02-probe \
  psql -U postgres -d zhiju_core -v ON_ERROR_STOP=1 \
  -f /sql/bootstrap/V0001__platform_bootstrap.sql \
  -f /sql/bootstrap/V0002__schema_roles_baseline.sql
```

## 探测模板

所有角色均为 NOLOGIN，因此从 superuser 会话内用 `SET ROLE` 切换（这与生产“Migration Owner 只在受控流程切换”的边界一致：应用连接从不持有 superuser/owner credential）。psql 里每条语句的 `ALLOW`/`DENY` 直接由 psql 输出呈现，`DENY` 时附 SQLSTATE（权限类拒绝为 `42501`，角色切换拒绝亦为 `42501`）。

```bash
docker exec -it zju-wi02-probe psql -U postgres -d zhiju_core
```

### 1. 角色属性与成员关系（应全部 ALLOW 且值为预期）

```sql
-- 全部 24 个基线 Role 均 NOLOGIN、非 superuser、无 BYPASSRLS/CREATEDB/CREATEROLE
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname !~ '^pg_' AND (rolname LIKE '%\_owner' OR rolname LIKE '%\_app'
   OR rolname LIKE '%\_dispatcher' OR rolname IN ('projection_app','audit_reader','migration_runner'))
ORDER BY rolname;

-- owner 成员只有 migration_runner 且为 SET-only（inherit_option=false, set_option=true）；app 角色没有任何成员关系
SELECT member.rolname AS member, owner_role.rolname AS owner,
       am.inherit_option, am.set_option
FROM pg_auth_members am
JOIN pg_roles member ON member.oid = am.member
JOIN pg_roles owner_role ON owner_role.oid = am.roleid
WHERE owner_role.rolname LIKE '%\_owner';

-- 业务扩展集合精确等于 btree_gist + pg_stat_statements；默认 plpgsql 保留，pgcrypto 不在
SELECT extname FROM pg_extension ORDER BY extname;

-- pg_stat_statements 对基线 Role 全部 DENY；pg_read_all_stats 可读 View/调用只读函数，但不可 reset
SELECT has_table_privilege('identity_policy_app', 'public.pg_stat_statements', 'SELECT') AS app_can_read,
       has_table_privilege('pg_read_all_stats', 'public.pg_stat_statements', 'SELECT') AS ops_can_read,
       has_function_privilege('pg_read_all_stats', 'public.pg_stat_statements(boolean)', 'EXECUTE') AS ops_can_query,
       has_function_privilege('pg_read_all_stats', 'public.pg_stat_statements_info()', 'EXECUTE') AS ops_can_read_info,
       has_function_privilege('pg_read_all_stats', 'public.pg_stat_statements_reset(oid,oid,bigint,boolean)', 'EXECUTE') AS ops_can_reset;

-- public Schema / Database 无 CREATE
SELECT has_schema_privilege('identity_policy_app', 'public', 'CREATE') AS public_create,
       has_database_privilege('identity_policy_app', current_database(), 'CREATE') AS db_create;
```

### 2. App Role 矩阵（以 identity_policy 为例；其余模块同形）

先以 owner 建探针（模拟 WI-04 的 owner 建表，default privileges 生效）：

```sql
SET ROLE identity_policy_owner;
CREATE TABLE identity_policy.business_probe (id uuid PRIMARY KEY, payload text NOT NULL, external_id text NOT NULL);
CREATE TABLE identity_policy.outbox_probe (id uuid PRIMARY KEY, payload text NOT NULL, delivered_at timestamptz, delivery_attempts int NOT NULL DEFAULT 0);
GRANT SELECT ON identity_policy.outbox_probe TO identity_policy_dispatcher;
GRANT UPDATE (delivered_at, delivery_attempts) ON identity_policy.outbox_probe TO identity_policy_dispatcher;
RESET ROLE;
```

以 Runtime Role 执行（每条后括号为预期）：

```sql
SET ROLE identity_policy_app;
INSERT INTO identity_policy.business_probe VALUES (uuidv7(), 'p', 'e'); -- ALLOW
SELECT count(*) FROM identity_policy.business_probe;                    -- ALLOW
UPDATE identity_policy.business_probe SET payload = 'p2' WHERE false;   -- ALLOW
DELETE FROM identity_policy.business_probe;                             -- DENY 42501
DROP TABLE identity_policy.business_probe;                              -- DENY 42501
ALTER TABLE identity_policy.business_probe ADD COLUMN x int;            -- DENY 42501
CREATE TABLE identity_policy.app_created (id int);                      -- DENY 42501（Schema 无 CREATE）
INSERT INTO enterprise_project.business_probe VALUES (uuidv7(),'p','e');-- DENY 42501（跨 Schema）
SELECT count(*) FROM enterprise_project.business_probe;                 -- DENY 42501（无 USAGE）
RESET ROLE;
```

> 注意：`SET ROLE <owner>` 的拒绝不能从 superuser 会话演示（superuser 恒可切换任何角色），见下面第 5 节的非 superuser 探测。

### 3. Dispatcher Role 矩阵

```sql
SET ROLE identity_policy_dispatcher;
SELECT count(*) FROM identity_policy.outbox_probe;                                   -- ALLOW
UPDATE identity_policy.outbox_probe SET delivered_at = now(),
       delivery_attempts = delivery_attempts + 1 WHERE false;                        -- ALLOW
UPDATE identity_policy.outbox_probe SET payload = 'tampered';                        -- DENY 42501（payload 无列级授权）
INSERT INTO identity_policy.outbox_probe (id, payload) VALUES (uuidv7(), 'p');       -- DENY 42501
SELECT count(*) FROM identity_policy.business_probe;                                 -- DENY 42501
UPDATE identity_policy.business_probe SET payload = 'x' WHERE false;                 -- DENY 42501
RESET ROLE;
```

### 4. audit_reader 矩阵

```sql
SET ROLE identity_policy_owner;
CREATE VIEW identity_policy.business_probe_masked AS SELECT id FROM identity_policy.business_probe;
RESET ROLE;
GRANT USAGE ON SCHEMA identity_policy TO audit_reader;
GRANT SELECT ON identity_policy.business_probe_masked TO audit_reader;

SET ROLE audit_reader;
SELECT id FROM identity_policy.business_probe_masked;                 -- ALLOW
SELECT payload FROM identity_policy.business_probe;                   -- DENY 42501（Canonical Payload）
SELECT external_id FROM identity_policy.business_probe;               -- DENY 42501（敏感 External ID）
RESET ROLE;
```

### 5. Migration Owner 边界（必须用非 superuser 登录演示）

superuser 会话恒可 `SET ROLE` 任何角色，因此该边界要用一次性 LOGIN 探测角色证明（与测试 `wi02_app_probe`/`wi02_migration_probe` 同构；生产 credential 由 WI-03 签发）：

```sql
-- superuser 会话内准备（仅本地探测容器）
CREATE ROLE manual_app_probe LOGIN PASSWORD 'probe' NOSUPERUSER;
CREATE ROLE manual_migration_probe LOGIN PASSWORD 'probe' NOSUPERUSER;
GRANT identity_policy_app TO manual_app_probe;
GRANT migration_runner TO manual_migration_probe;
```

然后分别以两个探测登录连接（`psql -U manual_app_probe` / `-U manual_migration_probe`，容器内 `docker exec -it zju-wi02-probe psql -U manual_app_probe -d zhiju_core`）：

```sql
-- manual_app_probe 会话：
SET ROLE identity_policy_app;    -- ALLOW（成员）
SET ROLE identity_policy_owner;  -- DENY 42501（应用进程无法获得 Owner 身份）

-- manual_migration_probe 会话：
SET ROLE identity_policy_owner;  -- ALLOW（唯一允许切换到 owner 的角色）
```

## 清理

```bash
docker rm -f zju-wi02-probe
```

## NOT RUN 声明

本矩阵只在本地测试容器证明数据库层拒绝。生产角色 credential 的签发与轮换（WI-03）、outbox/业务表与列级授权（WI-04）、RLS（WI-05）均为 `NOT RUN`。
