# PR #41 代码审查记录

## 审查范围

- 审查对象：PR #41 的最新精确 head。
- 权限边界：只读检查实现、合同、测试与 GitHub 状态；允许将可复现且影响合并的 findings 发布到原 PR。
- 不在本次任务中执行修复、提交、推送或合并。

## 假设

- `.vibe/im-02-workitem-issues/issues/02-schema-roles.md` 是 WI-02 的直接验收合同。
- 高层 Spec、持久化逻辑模型、退出门、Issue #30 与 PR 描述共同限定权限基线；若相互冲突，以当前主干中的权威文档和明确验收条件为准，并把冲突作为审查结果说明。
- CI 成功仅作为基线证据，不能替代真实 PostgreSQL 权限矩阵、重放安全性和失败场景检查。

## 成功标准

1. 固定并核对 PR 最新 head、base、实际 diff、已有 review/comment 与 CI 状态。
2. 阅读 HL-Spec、WI-02 合同、相关逻辑模型/退出门、迁移说明、实现和测试。
3. 对每项验收条件构造最小可复现检查，运行聚焦测试及适当的完整验证。
4. 只发布位置明确、可复现、影响合并的 findings；若无错误，在原 PR 留下明确的审查通过结论。
5. 记录自动化 `PASS`、设计检查、真实数据库检查及未运行边界，不把静态证据表述为运行时通过。

## 执行计划

1. 合同与 GitHub 状态核对 → 验证：head SHA、Issue/PR 元数据及权威验收条件一致。
2. 逐行审查迁移与测试 → 验证：每个角色、schema、默认权限、PUBLIC/跨 schema/扩展约束均有正反例覆盖。
3. PostgreSQL 聚焦验证与全量门禁 → 验证：服务端拒绝返回预期 SQLSTATE，完整门禁结果与精确 head 对齐。
4. 发布原 PR comments → 验证：回查 review/comment ID、状态、正文与目标行。

## 结果

审查 head：`28a87121f2b6fddb15f3fdaad0af319bc94e4a6e`。

### 自动化基线

- `pnpm verify`：`PASS`。
- 普通测试：18 个测试文件通过、2 个跳过；334 个测试通过、65 个跳过。
- 持久化 Gate：4 个测试文件、78 个测试全部通过；空库 Migration 与第二次 no-op Migration 通过。
- 合同 Catalog：`FULL: 200`。

### 直接 PostgreSQL 反例

1. `migration_runner` 继承 owner 权限：`FAIL`。
   - 在 PostgreSQL 18.6 空库应用 V0001、V0002。
   - 创建非 superuser LOGIN，并只执行 `GRANT migration_runner TO <login>`，未执行任何 `SET ROLE`。
   - `has_schema_privilege(<login>, 'identity_policy', 'CREATE') = true`，且 `<login>` 继承 `identity_policy_owner`。
   - 该登录可直接创建表；实际 `tableowner` 是登录角色，不是 `identity_policy_owner`，因此 owner 的 default privileges 不生效。
2. `pg_stat_statements` 运维边界：`FAIL`。
   - `has_table_privilege('identity_policy_app', 'public.pg_stat_statements', 'SELECT') = true`。
   - `pg_stat_statements` 与 `pg_stat_statements_info` 的 ACL 均含 `PUBLIC=SELECT`。
3. 手动 Runbook 启动命令：`FAIL`。
   - `docker exec -v ...` 以状态码 125 退出：`unknown shorthand flag: 'v' in -v`。

### 审查结论

`NOT APPROVED`。上述三个 finding 均可复现，其中 owner 权限继承会绕过显式 `SET ROLE` 边界并破坏对象 owner/default ACL，不应在修复前合并。

### 原 PR 发布记录

- Review：`5002213518`，状态 `COMMENTED`，绑定 head `28a87121f2b6fddb15f3fdaad0af319bc94e4a6e`。
- Review 链接：`https://github.com/qzhike/zhiju-business-core/pull/41#pullrequestreview-5002213518`。
- Inline comment：`3838317075`，migration runner 权限继承。
- Inline comment：`3838317078`，`pg_stat_statements` PUBLIC 权限。
- Inline comment：`3838317080`，Runbook 的无效 `docker exec -v`。
- 发布后回查：三条评论均绑定上述精确 commit 和目标 diff position；PR 仍为 `OPEN`，head 未变化。

## 第二轮复审计划

- 目标：检查 PR #41 最新精确 head、新提交与三条 inline comments 的处理结果。
- 权限边界：若仍有问题，先更新权威文档和回归测试，再执行最小实现修复与完整验证；未经用户检查确认不 commit、不 push。若没有问题，则核对精确 head CI、PR closing association 与 Issue #30 验收状态后执行用户要求的关闭流程。
- 成功标准：
  1. `migration_runner` 登录在显式 `SET ROLE` 前不能执行 owner DDL，切换后对象 owner 与 default ACL 正确。
  2. Runtime、Dispatcher、Audit、Projection Role 均不能读取或执行 `pg_stat_statements` 运维对象。
  3. Runbook 从零启动命令可以实际执行。
  4. 聚焦 PostgreSQL 反例与 `pnpm verify` 均通过，并绑定最新未变化 head。

## 第二轮复审结果

复审 PR head：`14ec8ec630dfb1decf882e921cd0c561cf3ff75c`。

### 已确认修复

- `migration_runner` 到七个 owner 的成员关系均为 `inherit_option=false / set_option=true`。
- 非 superuser migration 登录在 owner 切换前执行 DDL 返回 `42501`；显式切换后对象 owner 为对应 `<module>_owner`，owner default ACL 生效。
- PUBLIC 与业务基线 Role 已失去 `pg_stat_statements` View/函数权限。
- Runbook 已把 migrations volume 移到 `docker run`。

### 仍存在的问题

1. Runbook 在 `docker run -d` 后立即执行 `psql`，没有等待 PostgreSQL ready。按文档原样从零运行时返回 socket 不存在，状态码为 2。
2. V0002 撤销全部 `pg_stat_statements*` 函数的 PUBLIC EXECUTE 后，只给 `pg_read_all_stats` 授予 View SELECT。启用 preload 后，该观测角色查询 View 返回 `permission denied for function pg_stat_statements`，只读运维入口不可用。

### 本地修复

- HL-Spec、PostgreSQL Logical Model 与 WI-02 合同明确：`pg_read_all_stats` 只拥有 View 和两个只读查询函数权限，统计重置函数保持拒绝。
- V0002 向 `pg_read_all_stats` 授予 `pg_stat_statements(boolean)` 与 `pg_stat_statements_info()` EXECUTE，不授予 `pg_stat_statements_reset(...)`。
- 权限回归扩展到全部 24 个基线 Role 的 View/函数拒绝，并断言运维只读函数允许、reset 拒绝。
- Runbook 在执行 migration 前最多等待 30 次 `pg_isready`，只有 ready 后才运行 `psql`。

### 验证结果

- 修订后的 Runbook 从零执行：`PASS`；实际等待期间先出现两次 `no response`，随后 ready 并成功应用 V0001/V0002。
- 启用 `shared_preload_libraries=pg_stat_statements` 的 PostgreSQL 18.6：运维 View 查询 `PASS`；reset 实际返回 `permission denied`。
- `pnpm persistence:gate`：4 个测试文件、80 个测试全部通过；第二次 migrate no-op。
- `pnpm clean && pnpm verify`：`PASS`；普通测试 334 passed / 67 skipped，Catalog `FULL:200`，compatibility findings 0，持久化 80/80。
- 首次完整门禁在 Docker Hub tag-digest 在线查询处遇到一次瞬时 `EOF`；单独重跑 persistence gate 与随后再次完整运行均通过。
- `git diff --check`：`PASS`。

### 当前结论

问题已在本地工作树修复并验证，但尚未 commit/push，PR #41 和 Issue #30 均不应在修复进入远端并完成新 head 复审前关闭。状态：`AWAITING USER REVIEW`。

## 最终交付记录

- 用户已确认复审并授权提交、关闭 PR/Issue。
- Commit：`e5c1357fec9403d1fb6a257df6f16c828ce1ff0f`，仅包含 6 个已确认的产品范围文件。
- 非强制 push：远端 PR head 从 `14ec8ec` 前进到 `e5c1357`。
- 提交后本地 `pnpm verify`：`PASS`；远端精确-head CI `verify`：`SUCCESS`。
- 最新精确-head Review：`5002454334`，状态 `COMMENTED`，正文明确 `PASS`；三条旧 review thread 均已 resolved。
- PR #41：`MERGED`，merge commit `4ce0ff624c5d0c2e91890170171fc87215553e40`，时间 `2026-08-23T13:14:07Z`。
- `origin/main`：`4ce0ff624c5d0c2e91890170171fc87215553e40`；已验证 `e5c1357` 是其祖先。
- Issue #30：`CLOSED / COMPLETED`，由 PR #41 于 `2026-08-23T13:14:08Z` 自动关闭。

最终状态：`COMPLETE`。
