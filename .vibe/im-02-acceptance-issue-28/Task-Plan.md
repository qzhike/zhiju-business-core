# IM-02 Issue #28 验收与阻塞修复计划

## 目标

依据 GitHub Issue #28，对 IM-02 PostgreSQL Foundation + IdentityPolicy 的当前集成工作树执行可复核验收；定位并修复阻塞 WI-06 至 WI-10 核心验收的最小代码/测试问题，保留默认分支交付、exact-head review、外部系统和用户人工验收的独立边界。

本轮已获得用户对远端交付和进度同步的明确授权；允许非 force push、创建跟进 PR 和更新 PR/Issue/进度文档，但不自动 merge PR 或关闭 Issue #28。

## 验收原则

- 以 Issue #28、#29–#38、关联 PR、当前工作树、`HL-Spec.md`、Implementation Milestone Plan、PostgreSQL Logical Model、IdentityPolicy Module Spec/Test、Technology/Deployment Baseline 和 WI Runbook 为输入。
- 逐项区分设计/静态检查、自动化测试、真实 PostgreSQL、disposable local Probe、用户人工验收和外部系统/生产验收。
- 只有实际执行并保留输出的检查才能标记为 `PASS`；未执行或仅由文档推断的项目标记为 `NOT RUN` 或 `PARTIAL`。
- 真实 PostgreSQL 检查记录数据库版本、镜像 digest、Migration 版本、角色/ACL、RLS/Scope 负向探测和重复 Migration 结果；不能用 happy-path 测试替代安全/完整性反例。
- 测试产生的临时容器、数据库和脚本在执行后清理；不删除与本任务无关的既有 Docker volume 或容器。
- 每次代码改动前先同步 HL-Spec、Module-Spec、Module-Test/Runbook；代码、测试和文档均不在本任务内自动提交。

## 已执行步骤

1. **GitHub 与默认分支核对**：确认 #29–#38 为 CLOSED，PR #39/#41/#43/#44/#45 已进入 `main`；PR #46–#50 虽显示 MERGED，但仍是连续 stacked feature branch，相关提交不在 `origin/main`。
2. **本地集成**：在当前工作树执行 no-commit/no-ff 集成，保留 WI-06–WI-10 代码、Migration、Review、Runbook 和 Persistence 测试；随后由用户确认并提交为 `47a2a9d`。
3. **语义修复**：
   - 授权 Grant 覆盖改为精确匹配 Intent 的 `scopeKind + enterpriseId + projectId`；Enterprise Grant 不再覆盖 Project Intent，Access effective lists 同步采用精确 Scope。
   - Decision Port 的业务性 `DENY` 与同 Scope 安全 Audit 在同一事务内提交，Audit 只保存 reason code、hash 和脱敏摘要。
   - Outbox earliest-unpublished 判断改为 typed Aggregate identity：`aggregate_type + aggregate_id`。
   - Inbox Quarantine 仅在 Event Enterprise 等于受信 Context Enterprise 且 Project 在 allow-list 时保留 Project，否则写当前 Context Enterprise 的 `project_id=NULL`。
   - 修复 WI-07 AES-GCM Probe 的 `getAuthTag()` 调用顺序，修复 WI-10 Probe 的显式 `status='ACTIVE'` Fixture。
4. **回归验证**：新增并执行 WI-09 Enterprise Grant/Project Intent、WI-10 typed Aggregate ordering、WI-10 foreign Enterprise Project UUID Quarantine 回归。
5. **自动化与真实数据库验证**：`pnpm clean && pnpm verify` 和独立 `pnpm typecheck && pnpm persistence:gate` 均通过；PG 使用 PostgreSQL 18.6 / Flyway 11.20.3、锁定 digest、空库迁移与二次 migrate no-op。
6. **本地 Probe 验证**：WI-06、WI-07、WI-10 disposable local Probe 全部通过，容器已删除；真实 Provider、生产 Broker 和用户人工业务验收不由这些 Probe 代替。

## 成功标准与当前结果

- WI-06–WI-10 的本地核心实现、迁移、Persistence 回归、Scope/ACL 负例和可重复 Probe 均有实际输出：已满足。
- 规格、模块测试、WI Runbook 和 Issue #28 验收报告反映当前本地工作树实际结果：已同步。
- Issue #28 的默认分支交付、PR exact-head semantic review/CI、外部 Provider/Broker/跨模块 E2E 和用户最终人工验收：尚未满足，保持 `PARTIAL`，不能关闭 Issue。

## 交付边界

- 当前远端跟踪分支 `galendai/28-im-02-postgresql-foundation-identitypolicy` 指向 `47a2a9d`，`origin/main` 仍为 `505a702`；PR #51 负责将集成结果带入 `main`，不能把 PR 创建或本地结果写成默认分支已经完成。
- 本轮已完成 commit/push 和 PR/Issue/进度文档同步；PR #51 的 exact-head review/CI、外部系统和用户人工验收仍需独立完成，Issue #28 保持 `PARTIAL / OPEN`。
