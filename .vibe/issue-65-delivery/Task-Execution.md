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

当前阶段：规格、实现和 `pnpm verify` 自动化验证已完成；用户已于 2026-08-27 确认检查并授权提交，当前进入 exact-head commit/push/PR/Issue/branch/main closeout。
