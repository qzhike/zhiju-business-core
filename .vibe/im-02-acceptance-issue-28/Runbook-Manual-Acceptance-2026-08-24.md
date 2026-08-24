# IM-02 本地 Runbook 人工探测记录

日期：2026-08-24
验收对象：PR #52 合并后的代码基准 `main@64e3040b58093548a477021595d3c2f554b07e45`；PR #53 为文档-only 跟进，最终主线 merge 为 `36825118c6b2483dd365879179b390205549dab7`
执行方式：用户已明确授权 Codex 继续操作至 IM-02 关闭；以下为 Agent 在一次性本地 PostgreSQL 容器中执行的 Runbook 级探测，不冒充生产或外部系统验收。
结果：`PASS (AGENT-EXECUTED LOCAL) / EXTERNAL NOT RUN`

## 1. 环境与清理

- PostgreSQL：18.6，镜像 `docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941`。
- Flyway：11.20.3，镜像 `docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`。
- 空库 Migration：14 个版本应用至 `v7000`，全部 `Success`。
- 末尾再次 migrate：`Schema "public" is up to date. No migration necessary.`。
- 运行结束：临时容器、临时 detached worktree 均已清理；既有 `qm-dev-postgres` 未触碰。

由于 Docker Registry 的 tag-digest 在线解析在本机间歇性返回 `EOF`，本记录的交互式探测使用了前序 Gate 已验证并缓存的上述精确 digest；GitHub exact-head `verify` 已对同一提交完成完整编排验证。

## 2. WI-02 Schema/Role/ACL

| 探测 | 实际输出 | 结果 |
|---|---|---|
| 基线 Role 数量与属性 | `baseline_roles=24`；`all_baseline_roles_hardened=t` | `PASS` |
| 扩展 | `btree_gist, pg_stat_statements, plpgsql`；`pgcrypto_absent=t` | `PASS` |
| 统计与公共创建面 | app 读取 `pg_stat_statements=f`；`pg_read_all_stats=t`；public/database CREATE 均为 `f` | `PASS` |
| Runtime App | INSERT/SELECT/UPDATE `ALLOW`；DELETE、DROP、DDL、Schema CREATE、跨 Schema 读写均为 `DENY 42501` | `PASS` |
| Dispatcher | Outbox 读取和 delivery metadata 更新 `ALLOW`；payload 更新、INSERT、业务表读取均为 `DENY 42501` | `PASS` |
| Audit Reader | masked view `ALLOW`；底表 payload、external_id 和底表直接读取均为 `DENY 42501` | `PASS` |
| 非 superuser 角色切换 | app probe 切换 owner `DENY 42501`；migration probe 切换 owner `ALLOW` | `PASS` |

Runbook 已同步 PostgreSQL 默认 `plpgsql` 的实际存在状态，并把 outbox payload 负向 SQL 改为合法 JSON，避免类型解析错误遮蔽 ACL 结论。

## 3. WI-03 RLS Context/Scope

| 探测 | 实际输出 | 结果 |
|---|---|---|
| 无 Context | `no_context_rows=0` | `PASS` |
| 伪造 GUC | `forged_guc_rows=0` | `PASS` |
| 直接读取/写入 `platform_security.tx_context` | `42501` | `PASS` |
| 普通 App 直接建立 Context | `permission denied for function establish_transaction_context` | `PASS` |
| 受控 Context | `ENT-A-ROW` 可见；未授权 Enterprise/Project 不可见 | `PASS` |
| Commit 后连接复用 | `post_commit_rows=0` | `PASS` |

## 4. WI-04 技术表 Catalog/Masked Audit

- 技术表目录：`technical_table_count=59`，即七模块 `7×8` 加 IdentityPolicy 三张 Platform 表。
- RLS：`forced_rls_table_count=59`。
- masked audit：返回目标 `audit_id=12345678-1234-7123-8123-444444444442`；`audit_reader` 直接读取底表为 `DENY 42501`。
- 使用合法 JSON 重新执行 outbox payload 更新后，输出 `wi04_update_outbox_payload=DENY SQLSTATE=42501`。

## 5. WI-09 Decision 脱敏追踪

在同一 clean-main disposable database 运行 `tests/persistence/identity-policy-decisions.test.ts --no-file-parallelism`：

```text
Test Files  1 passed (1)
Tests       10 passed (10)
```

随后以管理员只读查询核对：

- `release.authorize`：`principal_kind=AGENT`、`acting_for_kind=HUMAN`、`outcome=DENY`、`reason_codes={CAPABILITY_HUMAN_ONLY}`。
- Project A：存在 `outcome=ALLOW`、`reason_codes={ALLOWED_BY_GRANT}`。
- Project A2：`outcome=DENY`、`reason_codes={NO_ACTIVE_GRANT}`，不通过 `actingFor` 升权。
- `wi09.demo.command` 的 DENY Audit 计数为 `5`，与 Decision 同事务落账并保留脱敏 reason code。

## 6. 已完成的 WI-06/WI-07/WI-10 local Probe

- WI-06：`COMMITTED → DUPLICATE → IDEMPOTENCY_PAYLOAD_CONFLICT`；Receipt、Audit、Outbox 各保持预期单份事实。
- WI-07：HUMAN/AGENT/SERVICE 注册、External Identity Link/Resolve 通过；`raw identifiers leaked: false`。
- WI-10：`PROCESSED → DUPLICATE → QUARANTINED`；target outbox、command receipt、contract violation 各为 1，业务事实只执行一次。

## 7. 外部边界

Keycloak/OIDC、OpenBao、Ceph、飞书、生产 Broker/Provider、跨模块生产 E2E、Renderer、生产负载和真实生产 Credential 仍为 `NOT RUN`。本记录只证明本地 PostgreSQL、Migration、Role/ACL、RLS、IdentityPolicy Decision、幂等和脱敏边界。
