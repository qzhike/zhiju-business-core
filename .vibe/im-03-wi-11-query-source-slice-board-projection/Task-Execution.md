# IM-03 WI-11：权威 Query、Source Slice 与 Board Projection 执行记录

## 目标

完成 GitHub Issue #67：实现 EnterpriseProject 权威 Query、按调用 purpose/audience 裁剪的 Source Slice，以及可重建的 Project Board Projection；验证 Projection 延迟不会成为 Command 或 Completion 判据，并完成精确 HEAD 的 PR、Issue 与分支交付闭环。

## 当前基线

- 工作目录：`im-03-wi-11-query-source-slice-board-projection`
- 当前分支：`galendai/im-03-wi-11-query-source-slice-board-projection`
- 当前 HEAD：`b4982ed`（与 `origin/main` 同头）
- Issue #67：OPEN，尚未发现关联 PR
- 已先补齐 WI-11 的 HL-Spec、Module-Spec、Module-Test 基线和 `Design-Notes.md`；实现、回归测试和本地 PostgreSQL gate 已完成，当前仍未提交或推送

## 执行边界

- 以 `.vibe/high-level-docs/HL-Spec.md`、EnterpriseProject Module Spec、Module Test 文档、WI-11 Issue 设计稿和公开 Contract 为权威来源。
- Query 不跨 Schema Join；精确 Ref 通过公开 Port 解析。
- 仅将本地/Disposable PostgreSQL、静态检查和 CI 结果作为相应范围的证据；Provider、生产、公共 HTTP、跨模块 E2E、真实外部系统和独立人工验收未执行时保持 `NOT RUN`。
- 所有实现和文档改动完成后先展示变更与验证结果，获得用户确认后才执行 commit；push、merge、Issue 关闭和 branch 删除分别核验，不从 commit 授权推断其他 GitHub 写操作。

## 阶段记录

| 阶段 | 状态 | 证据/备注 |
|---|---|---|
| 读取权威规格、现有实现和远端状态 | 已完成 | Issue #67 OPEN；当前 HEAD `b4982ed` 与 `origin/main` 同头；无关联 PR/远端 Work Item branch |
| 实现 WI-11 最小纵向切片并同步规格/测试文档 | 已完成 | Contract 可选诊断字段、V2012 Projection 表、Query/Source Slice、active pointer reader、Projection Repository/Handler 和 PostgreSQL 回归用例已完成 |
| 本地验证与 PostgreSQL 语义负向探针 | 已完成 | 静态门禁、普通测试和 disposable PostgreSQL/Flyway gate 均通过；具体结果见 `Verification-Report.md` |
| `.vibe` 交付记录与精确 HEAD 审查 | 已完成 | `Verification-Report.md`、`Review-Record.md` 已建立；当前工作树仍等待用户检查 |
| 用户确认后的 commit/push/merge/Issue close/branch cleanup | 未开始 | 各边界独立回读 |
