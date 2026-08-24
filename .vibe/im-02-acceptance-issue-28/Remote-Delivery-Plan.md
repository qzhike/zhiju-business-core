# IM-02 Issue #28 远端交付计划

日期：2026-08-24
对象：`galendai/28-im-02-postgresql-foundation-identitypolicy`
当前本地提交：`47a2a9d fix: repair IM-02 PostgreSQL and IdentityPolicy acceptance gates`

## 目标

将已经完成本地确认的 WI-06–WI-10 集成代码、验收修复、测试、Runbook、Review 记录和 `.vibe` 文档交付到远端，并同步 GitHub PR、Issue #28 与整体里程碑进度。远端状态必须继续区分：

- 本地真实 PostgreSQL/自动化/脱敏 Probe 的 `PASS`；
- 新 PR 在 `main` 上的 exact-head review 与 CI；
- 真实外部 Provider、跨模块 E2E、生产环境和用户人工验收的 `NOT RUN`。

## 交付边界

1. 非 force push 当前本地分支，保留历史并建立远端跟踪分支。
2. 创建一个以 `main` 为 base 的跟进 PR，承载 PR #46–#50 stacked branch 尚未进入默认分支的集成结果及本轮修复。
3. 在已合并的 PR #46–#50 上补充指向新交付 PR、验收报告和当前验证边界的评论；不改写已合并历史。
4. 更新 Issue #28 的当前状态记录，但不在默认分支交付、exact-head 复审、CI 和用户人工验收完成前关闭 Issue。
5. 更新 Implementation Milestone Plan、其验证报告、IM-02 Exit Gate 文档和 Issue #28 验收报告，记录新的远端提交、PR 和边界。

## 完成判据

- 远端分支指向本地已确认提交及后续仅文档同步提交；
- 新 PR 的 base/head、commit、checks 和审查边界可回读；
- Issue #28 评论明确当前为 `PARTIAL / OPEN`，不把 stacked PR 合并误报为 `main` 已交付；
- 项目进度文档明确 IM-01 `COMPLETE`、IM-02 `PARTIAL`、后续里程碑未开始或按原状态记录；
- 本地工作树干净，未执行未经授权的 merge、force push 或 Issue close。
