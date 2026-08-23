# RLS 事务上下文与 Scope 防伪设计（IM-02 WI-03 / Issue #31）

版本：v1.1
日期：2026-08-24
状态：`CURRENT AUTHORITATIVE DESIGN / IMPLEMENTATION IN THIS WORK ITEM`
上游权威：[`07-postgresql-logical-model-v0.1.md` §19](../high-level-docs/07-postgresql-logical-model-v0.1.md)。本文固定 §19.2 遗留的"事务安全上下文具体机制"，是 RLS 物理机制与威胁模型的唯一权威；实现（`migrations/bootstrap/V0003__platform_rls_context.sql`）与测试（`tests/persistence/rls-context.test.ts`）必须与本文件一致。

## 1. 目标与不变量

1. Enterprise A 的事务上下文无法读写 Enterprise B 的行；同 Enterprise 内 Project A 上下文无法读写 Project B 的 Project-owned 行（PG-U-002、PG-E-005 的 RLS 子场景）。
2. 无上下文默认零行 / 拒绝写入；错误结果不泄漏对象是否存在（统一返回空集，而非区分 NOT FOUND）。
3. 上下文是 transaction-scoped：commit、rollback、异常之后，同一连接的下一个事务看不到上一个事务的上下文（连接池复用不泄漏）。
4. 上下文不可被普通 Runtime Role 伪造：七模块 `<module>_app` 与 `projection_app` 不能调用写入口，也不能直接写入上下文状态；唯一写入口只授予 NOLOGIN 的 `platform_context_establisher`。
5. RLS 是 IdentityPolicy Authorization 之外的纵深防御（PG-019），不替代 AuthorizationDecision；Human-only、职责分离、Contract Hash、业务状态一概不由 RLS 判断。
6. Runtime Role 不是 Owner、无 `BYPASSRLS`；业务表启用 `FORCE ROW LEVEL SECURITY`，Owner 之外的业务访问（含 Owner 自身的 DML）都受策略约束。

## 2. 威胁模型

| 威胁 | 结论 |
|---|---|
| 调用方任意 `SET app.*` / `set_config` 伪造上下文 | 机制不使用自定义 GUC 承载上下文，`SET` 无处生效 |
| Runtime Role 直接 INSERT/UPDATE 上下文状态行 | 上下文表对 Runtime Role 零授权（无 SELECT/INSERT/UPDATE/DELETE），写入只存在于 `SECURITY DEFINER` 函数内 |
| Runtime Role 调用 establish 函数伪造任意 Enterprise | 七模块 `<module>_app` 与 `projection_app` 没有 establish/clear EXECUTE；唯一写入口仅授予 NOLOGIN 的 `platform_context_establisher`。受信事务协调器显式切换到该角色建立 Context，再切换到目标 Runtime Role；审计行记录有效调用角色与 session login。生产协调器 Credential/Decision Port 接入不在 WI-03 内，保持 `NOT RUN` |
| 过期 / 不匹配 AuthorizationDecision | establish 以真实墙钟拒绝 `expires_at <= clock_timestamp()`；上下文行保存 decision id/hash/expires_at，读取函数以 `statement_timestamp()` 在同一长事务的每条后续 SQL 重新检查过期，不能使用固定于事务开始时刻的 `now()`；同一事务内重复 establish 不同 decision 被拒绝（冲突），相同参数幂等 |
| 事务结束 / 异常 / 连接归还后残留 | 上下文行以 `(pg_backend_pid(), txid_current())` 为主键维度；新事务 txid 必然不同，旧上下文逻辑上不可见；同 backend 下一次 establish 物理清理过期行 |
| 并发连接互相污染 | 上下文按 backend pid + txid 隔离；两个连接各自 establish 互不可见 |
| Owner / BYPASSRLS 逃逸 | Runtime Role 均无 BYPASSRLS（V0002 固定）；`FORCE ROW LEVEL SECURITY` 让 Owner 的 DML 也走策略；superuser 仍可绕过，但 superuser 仅存在于部署 Job（迁移），不发给应用 |
| Background Consumer 提权 | EVENT_CONSUMER 上下文必须来自已验证 Event Scope：必须携带 `source_event_id` 且 `cardinality(allowed_project_ids) >= 1`；空数组不能利用 `CHECK` 的 UNKNOWN 语义通过，数组元素也不能为 NULL。普通 REQUEST 上下文不能通过 consumer 路径扩大 project 集合（集合在 establish 时一次性冻结） |
| break-glass 走普通 Runtime Role | 明确禁止：break-glass 使用独立短期角色与人工审计（本文只保留语义边界，不实现生产 break-glass） |

自定义 GUC 的反面结论：PostgreSQL 无法按角色收回 `SET <custom GUC>` 权限，因此任何"GUC + 校验函数"方案中调用方都能把 GUC 设成任意值，只能靠值内签名补救。本设计直接不使用 GUC 作为凭证，伪造面为空。

## 3. 物理机制

### 3.1 对象清单（V0003）

```text
role   platform_security            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                                      NOINHERIT NOREPLICATION NOBYPASSRLS
role   platform_context_establisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                                      NOINHERIT NOREPLICATION NOBYPASSRLS；
                                      唯一持有 establish/clear EXECUTE
schema platform_security            OWNER platform_security；
                                     PUBLIC 无任何权限；USAGE 授予 platform_context_establisher、
                                     7 个 <module>_app + projection_app
                                     + 7 个 <module>_owner（Owner 需要 USAGE 才能在自身 migration 中
                                     编写引用 helper 的 CREATE POLICY；FORCE RLS 下 Owner 的 DML
                                     也会执行策略表达式）
table  platform_security.tx_context  上下文事实表（见 3.2），RLS=on（默认拒绝、无策略），
                                     仅 platform_security 可读写；无序列、无业务数据
fn     platform_security.establish_transaction_context(...)   SECURITY DEFINER，唯一写入口；
                                     EXECUTE 仅授予 platform_context_establisher，
                                     不授予 App、Projection、Dispatcher 或 Owner
fn     platform_security.clear_transaction_context()          SECURITY DEFINER，主动清理当前连接；
                                     EXECUTE 同 establish
fn     platform_security.current_context()      STABLE SECURITY DEFINER，读取当前事务上下文
fn     platform_security.context_enterprise_id()
fn     platform_security.context_allows_enterprise(uuid)
fn     platform_security.context_allows_project(uuid, uuid)
fn     platform_security.context_principal_id()
fn     platform_security.context_actor_snapshot_id()
fn     platform_security.context_authorization_decision_ref()  -> (id, hash) 组合
fn     platform_security.context_correlation_id()
fn     platform_security.context_kind()          REQUEST | EVENT_CONSUMER
fn     platform_security.context_is_valid()      bool：存在未过期上下文
（只读 helper 的 EXECUTE 授予 7 个 App、projection_app 与 7 个 Owner；PUBLIC/Dispatcher/
audit_reader/migration_runner 无任何权限）
```

`SECURITY DEFINER` 函数属主为 `platform_security`（非 superuser、非任何模块 Owner），函数体全部为静态 SQL、固定 `SET search_path = pg_catalog`，无动态 SQL、无外部输入拼接。`current_context` 系列读取函数返回标量/组合值，供各模块 RLS 策略表达式直接调用。

### 3.2 上下文事实行

```text
backend_pid        int       pg_backend_pid()
xact_id            bigint    txid_current()
context_kind       text      REQUEST | EVENT_CONSUMER
principal_id       uuid      NOT NULL
actor_snapshot_id  uuid      NOT NULL
authorization_decision_id    uuid NOT NULL
authorization_decision_hash  bytea NOT NULL (32 bytes)
authorization_decision_expires_at timestamptz NOT NULL
enterprise_id      uuid      NOT NULL
allowed_project_ids uuid[]   NOT NULL（EVENT_CONSUMER 至少 1 个）
correlation_id     uuid      NOT NULL
source_event_id    uuid      NULL（EVENT_CONSUMER NOT NULL）
established_at     timestamptz NOT NULL DEFAULT now()
established_by     text      NOT NULL  current_setting('role') at establish time
session_user_name  text      NOT NULL
PRIMARY KEY (backend_pid, xact_id)
```

清理路径：a) 事务天然隔离（新 txid 不可见旧行）；b) 同 backend 的下一次 establish 先删除本 pid 的全部旧事务行；c) `clear_transaction_context()` 删除本 pid 当前事务之外的行。表本身可由部署侧按 `established_at` 归档清理（IM-02 不实现自动任务）。

### 3.3 establish 契约

```text
establish_transaction_context(
    context_kind, principal_id, actor_snapshot_id,
    authorization_decision_id, authorization_decision_hash,
    authorization_decision_expires_at,
    enterprise_id, allowed_project_ids, correlation_id, source_event_id)
```

逐条校验（任一失败即异常回滚，安全失败、不部分写入）：

1. 调用方有效角色必须持有 `platform_context_establisher` 的 EXECUTE；普通 `<module>_app` / `projection_app` 直接调用由 ACL 以 `42501` 拒绝。函数记录 `current_setting('role')` 与 `session_user`，用于追踪有效调用角色和数据库登录。
2. `authorization_decision_expires_at > clock_timestamp()`（防止长事务用固定的 transaction timestamp 接受已过期 decision）。
3. `authorization_decision_hash` 长度恰为 32 字节。
4. `allowed_project_ids` 不含 NULL；`context_kind = 'EVENT_CONSUMER'` 时 `source_event_id IS NOT NULL` 且 `cardinality(allowed_project_ids) >= 1`；`REQUEST` 时 `source_event_id IS NULL`。
5. 同一 `(backend_pid, xact_id)` 已存在上下文：参数完全一致 → 幂等返回；不一致 → `platform_context_conflict` 异常（不覆盖，不并存）。
6. 写入前清理同 backend 的历史事务行（连接池归还复用场景）。

AuthorizationDecision 的存在性/hash 与 `identity_policy.authorization_decision` 的比对在 WI-05/WI-09 落表后接入（应用层 Decision Port 先行校验 + establish 记录引用）；本 WI 的数据库边界先固定：上下文行必须携带 decision id + hash + expires_at，且读取侧复查过期。普通 App Role 无权把任意引用写成 Context，只有独立的 establisher 权限可调用写入口。该权限不是 Decision 真实性证明：生产 Credential、Decision 的 Scope/Purpose/Intent 及持久化事实比对在 WI-09 完成前均保持 `NOT RUN`。

### 3.4 RLS Policy 模式（各模块表在自身 migration 中套用）

```text
-- Enterprise-owned
CREATE POLICY ctx_select ON <module>.<table> FOR SELECT TO <module>_app
  USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY ctx_write  ON <module>.<table> FOR INSERT TO <module>_app
  WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY ctx_update ON <module>.<table> FOR UPDATE TO <module>_app
  USING (platform_security.context_allows_enterprise(enterprise_id))
  WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
ALTER TABLE <module>.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <module>.<table> FORCE ROW LEVEL SECURITY;

-- Project-owned：enterprise + project 同时校验
  USING (platform_security.context_allows_project(enterprise_id, project_id))

-- Projection 行：同 Enterprise 模式，授予 projection_app 的策略使用同一函数
```

要点：策略显式 `TO <role>`（不给 PUBLIC）；DELETE 不授予策略（Runtime Role 本就无 DELETE 权限）；无上下文时函数返回 false/NULL → 零行、写入被 WITH CHECK 拒绝；错误统一为空结果，不泄漏存在性。各模块 Outbox 的 dispatcher 策略由 WI-04 定义（只放行 delivery metadata 列级更新，不依赖本上下文）。

## 4. 明确不做（非目标对齐）

- 不用 RLS 判断 Human-only、职责分离、Contract Hash、业务状态；
- 不实现生产 break-glass、Keycloak token 验证或完整 IdentityPolicy Decision Port；
- 不把 `SET app.*` 的值当作授权输入；
- Background Consumer 的 Event Scope 数据源校验（outbox/inbox 存在后由 WI-04/WI-10 补齐），本 WI 固定其上下文形状与限制。

## 5. 验证映射

| 验收条件 | 测试（tests/persistence/rls-context.test.ts） |
|---|---|
| 伪造值、跨 Scope | app 角色无 establish/clear EXECUTE、无 tx_context 表权限（42501）；GUC SET 后零行；跨 Enterprise/Project 零行与写入拒绝 |
| 无 Context / 过期 decision / 伪造 | 无 establish 零行；普通 App Role 直接 establish 42501；establisher 提交过期 decision 异常；同一长事务中 Decision 到期后的下一条 SQL 返回零行；直接写表 42501 |
| EVENT_CONSUMER 形状 | 缺少 source event、Project Scope 为空或含 NULL 均以 22023 拒绝；合法受限 Scope 可建立 |
| 事务回滚 / 异常 / 池复用 | ROLLBACK 后新事务零行；COMMIT 后同连接新事务零行；同 backend 残留行被下次 establish 清理 |
| 并发连接隔离 | 两连接各自 establish，互相零行 |
| FORCE RLS 对 Owner 生效 | SET ROLE owner 后无上下文零行 |
| PG-U-001 适用子场景 | Project-owned 行 enterprise/project 与上下文不一致时 INSERT 被 WITH CHECK 拒绝 |
| PG-U-002 / PG-E-005 子场景 | A/B Enterprise、A1/A2 Project 探测 |
