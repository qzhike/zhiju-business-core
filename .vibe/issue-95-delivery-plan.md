# Issue #95 交付工作记录

状态：WI-06 重新交付完成，PR #113 已合并，Issue #95 已关闭

## 目标

基于 Issue #95、项目规范、当前工作树和远端状态，完成可审计的实现/验证交付，并明确 Git 与 Issue 生命周期的完成边界。

## 约束

- 遵循仓库中的 `AGENTS.md`、`HL-Spec.md` 和相关 Module Spec。
- 仅修改与 Issue #95 直接相关的内容，保留已有无关改动。
- 测试后清理临时测试脚本和文件，并记录实际运行结果与未运行边界。
- 提交前先向用户报告变更，等待确认后再执行 `git commit`。

## 验收记录

### Issue 与代码基线

- Issue #95：`CLOSED`（2026-08-29），标题为 `[IM-04][WI-06] Implement Structured Document Human Edit and deterministic internal Diff`。
- 依赖 #90、#94 已在 `main` 上完成；本切片实现提交为 `a62332061856eb4457501d4efe93f4fd8241420f`。
- 首轮实现分支及 PR #112 已按授权关闭并删除；实现提交 `a62332061856eb4457501d4efe93f4fd8241420f` 仍保留在当前 detached worktree。
- 本次重新交付分支：`galendai/im-04-wi-06-redelivery`，从精确实现提交创建并已通过 PR #113 合并；合并提交为 `435b3b438122de7e8f053708c5cc1bcb49e7494f`，本地和远端分支均已删除。

### 实现与验证

- Structured Document canonicalization：闭合 Unit 类型、稳定 Unit identity、双向父子引用、无环、同级 ordinal、evidence Scope 和确定性排序。
- Human Edit：精确 sealed base Revision、可信 `HUMAN` principal、显式 `allowedUnitRefs`、新 Content Object/FROZEN Manifest/单 Parent Revision，base 历史不可变。
- Internal Diff：由两个 exact `artifact.get_revision_diff_inputs@1.0` Revision Ref 重建，稳定产生 `ADDED/REMOVED/CHANGED/MOVED`，不新增公共 Diff Result Operation 或持久化 Diff 事实。
- 本地 `pnpm verify`：PASS；Unit `30 files / 380 passed / 265 skipped`；Contract `201 operations / 201 FULL`；Persistence `26 files / 280 passed`；pinned PostgreSQL 18.6/Flyway 11.20.3 空库迁移、第二次 `No migration necessary` 和容器清理通过。
- 组合编排中途故障注入仍按 Module Test 记录为 `PARTIAL PASS / INJECTION NOT RUN`，不升级为完整 rollback 证明。
- Provider、生产数据库、公开 HTTP、跨模块 E2E、Renderer、Quality、Approval、Release 和独立人工业务验收保持 `NOT RUN`。

### 首轮 GitHub 交付状态（历史记录）

- 首轮已非强制推送远端分支，远端 head 为 `a62332061856eb4457501d4efe93f4fd8241420f`。
- PR [#112](https://github.com/qzhike/zhiju-business-core/pull/112) 已按授权关闭且未合并；其远端和本地分支已删除。
- 首轮 PR #112 的 exact-head `verify` 曾成功；实现提交保留在 detached worktree，供本次重新交付复核。
- 聚焦 Unit、完整 `pnpm verify` 和真实 PostgreSQL persistence gate 已重新通过；重新交付 commit `3128e120167ee3b85fccdab5b2254bcb855988fb` 已推送，PR #113 的 exact-head CI 已通过并合并，Issue #95 已关闭，分支已删除；`origin/main` 的合并提交为 `435b3b438122de7e8f053708c5cc1bcb49e7494f`。
