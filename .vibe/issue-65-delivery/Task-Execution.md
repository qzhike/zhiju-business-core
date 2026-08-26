# Issue #65 WI-09 执行说明

日期：2026-08-26

## 目标

在现有 EnterpriseProject 事务基础、CustomerBaseline、TemplateBaseline 和 RegulatoryProfile 精确引用之上，完成 Issue #65 的最小可运行 GapAnalysis 纵向切片，并留下可复核的实现、测试和 GitHub closeout 证据。

## 实现边界

1. 读取并遵循 `HL-Spec.md`、`Module-Spec-002-EnterpriseProject.md`、EnterpriseProject Domain/Consistency/PostgreSQL 文档和现有 Contract/Registry；公共 Catalog 保持 `200 operations`，不新增公共操作。
2. 新增 GapAnalysis Root、InputSnapshot、Version、Finding、Decision 的业务表、类型、Repository 和 Handler；写入必须复用现有 Command Receipt、Audit、Reference Edge、Outbox 和事务 Context。
3. `start_gap_analysis` 必须验证七个冻结输入的 exact object/version/snapshot id、Scope、生命周期和 content hash，并在运行时闭合 `FORMAL`/`EXPLORATORY` mode。v1 evaluator 只接受 `requestedScope.findings` 中的确定性 fixture；summary 从 finding 派生。
4. `accept_gap_analysis` 只允许可信 Human；Agent、Service、`actingFor`、伪造 actor 和跨 Project Context 均拒绝。ACCEPT 才能移动 accepted pointer 和发布公共 Accepted Event；REJECT/CHANGES_REQUIRED 不得形成 accepted pointer。
5. Finding、InputSnapshot、完成 Version 和 Decision 只能追加；新 Baseline/Profile 激活后旧 Gap 标记 `STALE` 并保留 stale/impact trigger ref，不覆盖旧 finding、Decision、Context、Plan 或 Artifact。
6. 增加 focused Unit/Contract 与 Disposable PostgreSQL persistence/E2E 用例；E-001 必须通过现有 CustomerBaseline 激活 handler 验证 stale/Impact 链路，覆盖缺输入/latest/scope/hash、UNKNOWN、immutable、Human-only、Accepted Event exact refs、reject/changes、replay、CAS、rollback 和 stale。

## 证据边界

| 层级 | 本轮目标 | 未经独立证据不得声明 |
|---|---|---|
| Static | format、lint、typecheck、architecture、contracts | 业务运行时已验收 |
| Persistence | PostgreSQL 18.6/Flyway 空库、RLS、ACL、CHECK、CAS、幂等、回滚 | 生产数据库已验收 |
| Local E2E | 受控 fixture 的旧 Gap 接受和新 Baseline stale | 真实下游 Process Manager 已运行 |
| External/Manual | 记录 `NOT RUN` | Provider、公开 HTTP、生产或人工 Reference Project PASS |

## Git 交付门

实现和验证后先向用户展示精确变更集、测试结果和未运行边界；用户确认后才执行 commit。随后需要分别取得并读回：非 force push、PR exact head、CI、评论、PR merge、`origin/main` ancestry、Issue #65 显式 CLOSED、远端/本地功能分支删除和权威 `.vibe` 文档无旧的“未完成”状态。Issue/branch/main 的任一状态没有读回证据都不能写成完成。

当前阶段：规格、实现、PostgreSQL pin 修复、并发接受修复、corrected exact-head CI、PR 合并、Issue 关闭、远端/本地分支删除和 `origin/main` 同步均已完成；用户已于 2026-08-27 确认检查并授权提交，当前仅保留本 docs-only closeout 的主线同步动作。

## 远端 Gate 漂移处理

历史记录：2026-08-27 的 GitHub `pull_request` runs `33021401819` 与 `33021517085` 均在 `pnpm persistence:gate` 处发现 PostgreSQL `18.6` tag 的当前 manifest digest 为 `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`，而仓库 pin 仍为 `sha256:1957b2ff3137e4ef7f3bc813e74fff50b1e1ffddc85c8b9d6f14ade972be8687`。两次 run 的其余静态、Unit、Architecture、Contract 阶段已通过；这证明了 Gate 的漂移拒绝逻辑正在生效。经核对的 pin 已更新，本地完整 `pnpm verify` 和 corrected exact-head CI `33022900309` 均已取得 PASS。

同一修复 head 的远端 run `33022308826` 暴露了 GapAnalysis 并发接受的竞争窗口：输家在 Root 旧版本可见、Version 新状态已可见时返回 `PROJECT_GAP_DECISION_CONFLICT`，未满足并发输家统一返回 `CONCURRENCY_CONFLICT` 的规格。接受入口已改为事务内锁定并重新读取 Root；本地连续两次 Persistence Gate 和完整 `pnpm verify` 均通过，corrected exact-head run `33022900309` 也已通过。

## 最终 exact-head closeout（2026-08-27）

- 实现 head `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 [PR #81](https://github.com/qzhike/zhiju-business-core/pull/81) 合并，merge commit 为 `2d6afd0cc2889cf0fa6350c0599d514d5917b071`；corrected exact-head [GitHub Actions run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309) 的 `verify` 为 `PASS`。
- Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已显式 `CLOSED`，closeout comment 已读回：[issuecomment-5432258964](https://github.com/qzhike/zhiju-business-core/issues/65#issuecomment-5432258964)。旧 PR #80 因 corrected head 无检查而关闭；PR #81 的 `closingIssuesReferences` 为空，Issue 关闭没有依赖自动关联。
- `origin/main=2d6afd0cc2889cf0fa6350c0599d514d5917b071` 已确认包含实现 head；`galendai/im-03-wi-09-gapanalysis-human-stale` 远端 ref 为空，本地 branch 已删除。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍为 `NOT RUN`。
