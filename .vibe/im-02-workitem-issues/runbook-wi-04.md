# IM-02 WI-04 本地 Runbook：七模块技术表 Schema Catalog 报告

对应 Issue #32。自动验收入口是 `pnpm persistence:gate`（新增 `tests/persistence/technical-tables.test.ts`：catalog 对账 + 唯一约束/不可变/镜像/列级授权行为矩阵）。本文提供按 owning module 展示技术表、主键/唯一约束、RLS/`FORCE RLS`、Owner 与实际 Grant 的一键报告命令，用户可一眼识别漏项或越权。

## 启动环境

```bash
pnpm install
pnpm persistence:gate
```

交互式容器（与 Gate 同构）：

```bash
docker run --rm -d --name zju-wi04-probe \
  -e POSTGRES_DB=zhiju_core -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=zhiju-gate-test \
  -v "$PWD/migrations:/sql:ro" \
  docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941
docker exec zju-wi04-probe sh -c '
  attempts=0
  until pg_isready -U postgres -d zhiju_core; do
    attempts=$((attempts + 1)); [ "$attempts" -lt 30 ] || exit 1; sleep 1
  done
' && for f in /sql/bootstrap/*.sql /sql/identity_policy/*.sql /sql/enterprise_project/*.sql \
            /sql/task_execution/*.sql /sql/artifact/*.sql /sql/quality_governance/*.sql \
            /sql/release_publication/*.sql /sql/integration_gateway/*.sql; do
  docker exec -i zju-wi04-probe psql -U postgres -d zhiju_core -v ON_ERROR_STOP=1 -f "$f" >/dev/null || exit 1
done
```

## Catalog 报告（每个 owning module 一行一表）

```bash
docker exec -it zju-wi04-probe psql -U postgres -d zhiju_core
```

```sql
-- 1. 技术表清单 + Owner + RLS/FORCE（7×8 + identity_policy 3 张 platform 表）
SELECT n.nspname AS module, c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname IN (
  'identity_policy','enterprise_project','task_execution','artifact',
  'quality_governance','release_publication','integration_gateway')
  AND c.relname IN ('command_receipt','outbox_event','inbox_message','process_instance',
                    'process_step','audit_record','reference_edge','contract_violation',
                    'platform_command_receipt','platform_outbox_event','platform_audit_record')
ORDER BY 1, 2;

-- 2. 主键/唯一约束（含 partial unique 的定义）
SELECT n.nspname AS module, t.relname AS table_name, c.relname AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.contype IN ('p','u') AND n.nspname IN (
  'identity_policy','enterprise_project','task_execution','artifact',
  'quality_governance','release_publication','integration_gateway')
ORDER BY 1, 2;
-- partial unique 另见 pg_index：
SELECT n.nspname, t.relname, i.relname AS index_name,
       pg_get_indexdef(i.indexrelid)
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE i.relname = 'process_instance_active_unique';

-- 3. 每个 module 的实际 Grant（app：SELECT/INSERT/UPDATE(受限)；
--    dispatcher：outbox SELECT + 列级 UPDATE；audit_reader：仅 masked view）
SELECT table_schema, table_name, grantee, string_agg(DISTINCT privilege_type, ',') AS privileges
FROM information_schema.role_table_grants
WHERE table_schema IN (
  'identity_policy','enterprise_project','task_execution','artifact',
  'quality_governance','release_publication','integration_gateway')
  AND grantee IN (SELECT rolname FROM pg_roles WHERE rolname LIKE '%\_app'
                  OR rolname LIKE '%\_dispatcher' OR rolname = 'audit_reader')
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- dispatcher 的列级面（只应看到 delivery metadata 列）
SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'enterprise_project' AND table_name = 'outbox_event'
  AND grantee = 'enterprise_project_dispatcher';
```

## 快速越权抽查

```sql
-- 任意模块：app 不得 DELETE/改 outbox payload；dispatcher 不得读业务表
SET ROLE enterprise_project_app;
DELETE FROM enterprise_project.audit_record;          -- DENY 42501
UPDATE enterprise_project.outbox_event SET payload='x';-- DENY 42501
RESET ROLE;
SET ROLE enterprise_project_dispatcher;
SELECT count(*) FROM enterprise_project.command_receipt; -- DENY 42501
RESET ROLE;
```

## 清理

```bash
docker rm -f zju-wi04-probe
```

## NOT RUN 声明

- Canonical payload↔hash 的强校验在应用写入路径（Kysely Repository，WI-05/WI-06）落地并测试；数据库层无法在禁用 pgcrypto 的情况下重算 SHA-256，本 WI 只固化 scope 镜像 trigger 与 hash 长度/字节约束；
- 各模块业务 Handler、Outbox 发布/Inbox 消费循环（WI-10）、IntegrationGateway 业务 Migration（#27）均 `NOT RUN`。
