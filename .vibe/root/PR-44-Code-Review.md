# PR #44 Code Review

## 审查目标

- 对 PR #44 的最新精确 head 执行规范驱动的语义审查。
- 复现并修复所有影响合并的错误，先更新规范与测试文档，再修改实现。
- 在原 PR comments 中记录可复现的审查发现、修复与最终验证结果。
- 仅在最新 head 的语义复审和 CI 均通过后合并 PR，并核验原始 Issue #32 的关闭状态。

## 初始状态

- PR：`qzhike/zhiju-business-core#44`
- 初始精确 head：`3a48a76f39fec015c4fb08f64b1bf7b4934bd89f`
- 基线分支：`galendai/31-im-02-wi-03-rls-transaction-context`
- 初始 CI：`verify=SUCCESS`
- 初始工作树：干净

## 执行计划

1. 核对 HL-Spec、七个 Module Spec/Test、PostgreSQL 逻辑模型、WI-04 权威 Issue 文档、迁移、测试、runbook 与实际 diff。
2. 在一次性 PostgreSQL 18.6 环境中验证表集合、约束、RLS、权限、触发器、并发唯一性、append-only 与 Dispatcher 列级授权的正反例。
3. 对发现的问题先补充权威文档和失败回归，再实施最小修复。
4. 运行聚焦测试、`pnpm verify`、`git diff --check`，并保留生产/外部/业务 Handler 验收的 `NOT RUN` 边界。
5. 将本审查记录纳入提交，非强制推送，等待精确 head CI，发布最终 review comment，并用精确 head 合并。
6. 获取最终 `main`，验证祖先关系、PR 状态及 Issue #32 状态。

## 初始审查发现

初始精确 head `3a48a76f39fec015c4fb08f64b1bf7b4934bd89f` 的 `pnpm persistence:gate` 为 `6 files / 110 tests PASS`，但直接 PostgreSQL 18.6 反例确认以下合并阻断问题：

1. 七模块技术表的 RLS 只校验 Enterprise；Context 仅允许 Project A1 时，同 Enterprise 的 Project A2 行仍可读写。
2. `audit_reader` 可以查询 masked view，但 `FORCE RLS` 使 view owner 看不到底表，已提交 1 行时 view 返回 0 行；原测试只断言不报错。
3. `process_step` FK 只绑定 `process_id`，允许 A2 Step 指向 A1 Process。
4. `reference_edge` 唯一约束遗漏 `owner_version_id`，不同不可变 owner version 的同路径/同 target Edge 错误返回 `23505`。
5. PR base 是已合并的 PR #43 功能分支；直接合并不能把改动交付到 `main`。PR 也没有同步 HL-Spec、七个 Module Spec/Test 和 WI-04 权威验收状态。

初始 review 已发布到原 PR：`5003634659`，状态为 `COMMENTED / NOT APPROVED`，绑定上述初始 SHA 并包含 4 条行级 finding。

## 修复

- 先更新 HL-Spec、PostgreSQL 逻辑模型、WI-04 Issue/Runbook、七个 Module Spec/Test，并新增 5 个会在旧实现上失败的真实 PostgreSQL 回归。
- nullable Project Scope 改为逐行裁决：NULL 走 Enterprise helper，非 NULL 走 Project helper；七模块 catalog 逐策略对账。
- 七模块增加 Process Step 父子 Enterprise/Project Scope trigger，错误稳定为 `23514 process step scope mismatch`。
- `reference_edge_unique` 纳入 `owner_version_id`，允许不同版本共存并继续拒绝精确重复。
- masked view 使用受控 NOLOGIN module owner 的只读 RLS 策略；`audit_reader` 只获 view 权限，已提交行可见，而底表 `count(*)`、敏感列、写入仍为 `42501`。
- 普通 merge 集成 `origin/main` 的 PR #43 最终安全加固；WI-04 测试通过 `platform_context_establisher` 建立 Context 后再切换 Runtime Role，没有恢复 App 直接 establish 权限。
- Canonical payload↔hash 强校验明确由 #33/#34 owning Repository Gate 承接；WI-04 只证明 Scope 镜像、hash 形状与不可变写面，该强校验当前仍为 `NOT RUN`。

## 验证结果

- 修复前新增回归：`5 failed / 109 passed`，五个失败与审查反例一致。
- `pnpm persistence:gate`（最新 `main` 集成后）：`6 files / 115 tests PASS`；PostgreSQL `18.6`，Flyway `11.20.3`；空库 Migration PASS；第二次 Migration 输出 `No migration necessary`。
- `pnpm verify`：Prettier、ESLint、TypeScript、Vitest、Architecture、Public API/Types/Catalog/Compatibility、Persistence 全部 PASS。
- 普通 Vitest：`18 passed / 4 skipped`，`334 passed / 102 skipped`。
- Catalog：`FULL:200 / registry:200`；Compatibility findings：0。
- `git diff --check`：PASS。

首次完整 `pnpm verify` 在 Prettier 检查阶段因本次测试文件格式失败；仅对该文件执行 Prettier 后，最终完整命令重新运行并通过。

## 证据边界与最终结论

- 自动化：`PASS`。
- 一次性真实 PostgreSQL 18.6：`PASS`。
- 生产 Credential/连接池、业务 Handler、Outbox/Inbox 循环、真实 Provider、负载、用户手动 Runbook：`NOT RUN`。
- #33/#34 Canonical payload↔hash Repository 强校验：`NOT RUN`。

当前本地修复在语义审查范围内无剩余阻断问题。只有在修复提交推送、PR base 改为 `main`、精确 head CI 成功并复审 head 未变化后，结论才升级为最终 `PASS / APPROVED FOR MERGE`。
