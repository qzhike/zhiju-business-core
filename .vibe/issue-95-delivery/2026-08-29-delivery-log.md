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

### 当前 Git / GitHub 边界

- 当前 worktree `HEAD=813dc53`，与 `origin/main` 和本地 `main` 一致；Issue #95 当前仍为 `OPEN`，当前没有已发现的 WI-06 远端分支或 PR。
- 当前变更均未 commit；按照项目约束，等待用户检查工作区变更并明确确认后，才执行 commit。push、PR、exact-head CI、merge、Issue 关闭、分支/worktree 清理仍分别等待授权。
