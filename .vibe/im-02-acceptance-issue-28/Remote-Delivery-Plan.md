# IM-02 Issue #28 远端交付计划

日期：2026-08-24
对象：`main`；历史集成分支为 `galendai/28-im-02-postgresql-foundation-identitypolicy`
当前默认分支提交：`64e3040b58093548a477021595d3c2f554b07e45`（PR #52 merge）

## 目标

将已经完成本地确认的 WI-06–WI-10 集成代码、验收修复、测试、Runbook、Review 记录和 `.vibe` 文档交付到远端，并同步 GitHub PR、Issue #28 与整体里程碑进度。远端状态必须继续区分：

- 本地真实 PostgreSQL/自动化/脱敏 Probe 的 `PASS`；
- 新 PR 在 `main` 上的 exact-head review 与 CI；
- 真实外部 Provider、跨模块 E2E、生产环境和用户人工验收的 `NOT RUN`。

## 交付边界

1. 非 force push 当前本地分支，保留历史并建立远端跟踪分支。
2. 已通过 PR #51 将 PR #46–#50 stacked branch 的集成结果带入 `main`，再通过 PR #52 修复合并后暴露的 Persistence Gate ACL 竞态。
3. 在已合并的 PR #46–#50 上补充指向新交付 PR、验收报告和当前验证边界的评论；不改写已合并历史。
4. 更新 Issue #28 的当前状态记录；在 Runbook 文档口径修订、最终状态回读和用户审核边界确认前保持 Issue OPEN。
5. 更新 Implementation Milestone Plan、其验证报告、IM-02 Exit Gate 文档和 Issue #28 验收报告，记录新的远端提交、PR 和边界。

## 完成判据

- PR #51/#52 的 base/head、merge commit、checks 和审查边界均可回读；
- Issue #28 已记录合并后竞态与 PR #52 修复证据，当前仍为 `PARTIAL / OPEN`；
- 项目进度文档记录 IM-01 `COMPLETE`、IM-02 默认分支数据库与 Runbook 证据，后续里程碑未开始；
- 当前文档修订 PR 合并、最终状态回读和 Issue 关闭动作均需保留可复核证据。
