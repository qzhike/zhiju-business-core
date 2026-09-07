> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/root/PR-43-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/root/PR-43-Code-Review.md).

# PR #43 Code Review 记录

日期：2026-08-24
状态：`REMEDIATED / AUTOMATED PASS / MANUAL NOT RUN`

## 范围与成功条件

- 审查 PR #43 最新 head `422bd4f70900ae614698745c88c4ad5244812fc5`，对照 Issue #31、`HL-Spec.md`、PostgreSQL 逻辑模型、WI-03 设计和手动验收 Runbook。
- 审计 transaction-scoped Context 的不可伪造性、事务/连接池隔离、AuthorizationDecision 引用约束、RLS 默认拒绝、Enterprise/Project Scope、角色授权和 `SECURITY DEFINER` 安全性。
- 对确认的问题先修订权威规格和测试场景，再修实现；记录输入、预期输出、实际输出及回归结果。
- 运行聚焦测试和完整 `pnpm verify`，并区分自动化 PostgreSQL Gate、生产集成和人工验收边界。
- 将修复记录发布至 PR comments；仅在最新 exact head 语义审查无阻塞问题且 CI 成功后合并，并核验 PR #43 与 Issue #31 的最终状态。

## 执行计划

1. 读取权威规格、PR diff、Issue 验收条件和测试实现；验证点：逐条建立验收映射。
2. 运行当前 head 基线与直接负向探针；验证点：测试能够拒绝伪造、越权和上下文泄漏。
3. 若发现问题，先更新规格/测试文档与回归用例，再最小修复 SQL；验证点：问题在旧实现可复现、修复后通过。
4. 运行聚焦测试、完整验证和 diff 检查；验证点：自动化 Gate 全绿且 `NOT RUN` 边界准确。
5. 提交并非强制推送修复，等待 exact-head CI；验证点：远端 PR head 与已验证 SHA 一致。
6. 发布修复记录，使用 `--match-head-commit` 合并，随后核验 `origin/main` 祖先关系、PR 和 Issue 状态。

## 审查发现与验证记录

### F-001（阻塞）：普通 App Role 可直接伪造任意 Scope Context

- 输入：以 `enterprise_project_app` Runtime 权限直接调用 `establish_transaction_context`，传入自选 Enterprise、Project、Decision ID/hash 和未来过期时间。
- 预期：数据库以 `42501` 拒绝；普通 App Role 只能读取已由受信事务协调器建立的 Context。
- 修复前实际：函数授予七模块 App Role 与 `projection_app`，调用成功并可读取自选 Scope 行；原测试把该路径误当作受信入口。
- 修复：唯一写权限已移至 NOLOGIN 的 `platform_context_establisher`；App/Projection 仅保留只读 helper；直接伪造回归以 `42501` 拒绝。

### F-002（阻塞）：空 Project Scope 的 EVENT_CONSUMER 可绕过形状约束

- 输入：`context_kind=EVENT_CONSUMER`、合法 `source_event_id`、`allowed_project_ids='{}'`。
- 预期：`22023`，consumer 至少绑定一个 Project。
- 修复前实际：`array_length('{}', 1)` 返回 `NULL`，表 `CHECK` 的 UNKNOWN 被接受，函数也没有非空数组检查，Context 建立成功。
- 修复：函数与表约束统一改用 `cardinality(...) >= 1`，并拒绝 NULL Project 元素；空/NULL 数组回归均通过。

### F-003（阻塞）：权威文档仍将已实现机制标记为待确定

- 输入：对照 `HL-Spec.md`、PostgreSQL 逻辑模型 §19.2 与 PR 的 WI-03 设计/DDL。
- 预期：高层入口、逻辑模型、专项设计和实现采用同一角色/事务边界，并保留 WI-09 `NOT RUN`。
- 修复前实际：`HL-Spec` 仍将 IM-02 标为 NEXT，§19.2 仍称具体机制待 DDL/API 阶段确定。
- 修复：已先于 SQL 修订高层入口、§19.2、WI-03 设计、Runbook 与本记录。

### F-004（阻塞）：长事务内过期 Decision 继续有效

- 输入：事务开始后建立一个短期有效 Context，等待其墙钟过期，再在同一事务执行下一条受 RLS 保护的查询。
- 预期：下一条 SQL 返回零行，过期 Decision 不再授权。
- 修复前实际：helper 使用固定于事务开始时刻的 `now()`；事务内时间不推进，Context 继续有效。原测试只注入事务开始前已过期行，未覆盖该路径。
- 修复：establish 使用 `clock_timestamp()`；只读 helper 使用每条语句更新的 `statement_timestamp()`；同事务时间推进回归通过。

## 基线结果

- 修复前 `pnpm persistence:gate`：`PASS`，5 个文件 / 96 个测试；该结果未覆盖 F-001、F-002。
- 新失败场景先于实现：加入独立 establisher 角色回归后，旧实现因角色不存在失败；加入同事务到期回归后，旧 helper 实际返回 `1`，预期 `0`。

## 修复后验证

- `pnpm verify`：`PASS`。
- Unit：18 个文件通过、3 个文件按环境跳过；334 passed / 84 skipped。
- PostgreSQL persistence Gate：PostgreSQL 18.6；5 个文件 / 97 passed；空库 migrate 与二次 no-op migrate 均通过。
- Architecture：`PASS`，10 个 source roots。
- Public API / TypeScript / Catalog / Compatibility：`PASS`，200 项操作、`FULL=200`、`ENVELOPE_ONLY=0`。
- `git diff --check`：`PASS`。
- 首次修复后 persistence launcher 与第一次全量验证末步各遇到一次 Docker Registry `EOF`；重试后的独立 persistence Gate 与完整 `pnpm verify` 均成功。

## 验收边界

- `PASS`：本地固定镜像的真实 PostgreSQL 角色、RLS、事务、并发与 Migration 自动化 Gate。
- `NOT RUN`：生产 `platform_context_establisher` Login/Credential/连接池接入、IdentityPolicy Decision 持久化事实比对、真实 OpenBao/Keycloak、break-glass 与用户手动 Runbook。
