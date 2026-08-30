# Issue-95 交付工作记录

## 目标

完成 GitHub Issue-95 的实现验收与交付；是否执行提交、推送、合并、关闭 Issue/PR、删除分支和清理 worktree，按当前授权与实际状态分别确认。

## 约束

- 先以 HL-Spec.md 和相关 Module-Spec 为设计权威。
- 变更必须同步相关规格与测试文档。
- 验证必须区分本地/静态/数据库与 Provider、生产、人工验收等未运行边界。
- 只处理 Issue-95 范围，保留无关工作树改动。
- Git 操作采用 exact-head、非强制推送和可回读证据。

## 验收记录

### 设计冻结

- 复用 WI-01 Canonical Document Schema、Canonical JSON/SHA-256，以及 WI-04 Content Object 和 WI-05 exact Revision boundary。
- 不新增数据库迁移、不在数据库保存 Canonical body、不新增公共 Diff Result Operation。
- 内部服务负责 Document canonicalization、Human Edit 编排和基于两个 exact Revision Ref 的可重建 Diff；所有编辑变化必须命中 `allowedUnitRefs`。
- 设计同步位置：`HL-Spec.md`、`Module-Spec-004-Artifact.md`、`Module-Test-004-Artifact.md`。

### 交付状态

实现与验证已完成；首轮真实 PostgreSQL gate 暴露出 stale-base 夹具将 head 移到同一 Revision 的问题，以及全量 persistence gate 未先构建其他 workspace 包的前置问题，均已修复并重新通过。提交、推送、合并、Issue/PR 关闭、分支和 worktree 清理均未授权执行。

### 自动验证结果

- `pnpm build`：PASS。
- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check`：PASS；Contract 为 `201 operations / 201 FULL`，compatibility baseline 为 `200 operations`。
- `pnpm test -- --reporter=dot`：PASS，`30 files / 380 passed / 265 skipped`。
- `pnpm persistence:gate`：PASS，pinned PostgreSQL `18.6`、Flyway `11.20.3`，`26 files / 280 passed`；空库 migrate、第二次 `No migration necessary`、应用 migration 对账和容器清理均通过。
- Issue-95 synthetic procurement fixture：[`Manual-ART-024.md`](./Manual-ART-024.md) 已生成，记录 exact base/after Canonical bytes、SHA-256、Unit tree、allow-list、拒绝矩阵、Diff、replay 与 cleanup；独立人工业务验收保持 `NOT RUN`。

### 首轮交付时的 Git / GitHub 边界（历史记录，后续已完成重新交付）

- 首轮记录建立时的历史快照为：worktree `HEAD=813dc53`，与当时的 `origin/main` 和本地 `main` 一致；Issue #95 当时为 `OPEN`，尚未发现 WI-06 远端分支或 PR。
- 首轮记录建立时的变更均未 commit；按照项目约束，当时等待用户检查并明确确认。该阶段未执行的 push、PR、exact-head CI、merge、Issue 关闭和分支/worktree 清理，已由后续重新交付流程分别完成。

## 后续重新验证记录（2026-08-29）

- 首轮 PR #112 已按用户授权关闭且未合并；实现提交 `a62332061856eb4457501d4efe93f4fd8241420f` 保留并以该精确提交重新验证。
- 聚焦 Unit 为 1 文件/4 passed；`pnpm verify` 的 format、lint、typecheck、全量 Unit、architecture、contracts 和 persistence gate 均通过；全量 Unit 为 30 文件/380 passed/265 skipped，Persistence 为 26 文件/280 passed，pinned PostgreSQL 18.6/Flyway 11.20.3 空库迁移、第二次 migrate no-op 和容器清理通过。
- WI-06 的 Artifact 内部实现关闭条件已满足，重新交付分支为 `galendai/im-04-wi-06-redelivery`。组合流程中途故障注入保持 `PARTIAL PASS / INJECTION NOT RUN`；独立人工、Provider、生产、公开 HTTP、跨模块、Renderer、Quality、Approval 和 Release 仍为 `NOT RUN`。

## 最终交付状态（2026-08-29）

- PR [#113](https://github.com/qzhike/zhiju-business-core/pull/113) 已以 exact head `3128e120167ee3b85fccdab5b2254bcb855988fb` 通过 `verify` 并合并，merge commit 为 `435b3b438122de7e8f053708c5cc1bcb49e7494f`。
- Issue [#95](https://github.com/qzhike/zhiju-business-core/issues/95) 已关闭；关闭时间为 `2026-08-29T07:18:27Z`。
- 重新交付分支 `galendai/im-04-wi-06-redelivery` 的本地和远端引用均已删除；`origin/main` 已包含合并提交。
- WI-06 已完成实现、验证和 Git 交付；组合流程中途故障注入仍为 `PARTIAL PASS / INJECTION NOT RUN`，独立人工业务验收及 Provider、生产数据库、公开 HTTP、跨模块 E2E、Renderer、Quality、Approval、Release 仍为 `NOT RUN`。
