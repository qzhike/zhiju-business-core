> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-73-project-scope-review/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-73-project-scope-review/Task-Plan.md).

# PR #73 Project Scope 修复与交付计划

## 目标

修复 `qzhike/zhiju-business-core` PR #73 中经验证的错误，将修复记录写入原 PR comment；完成精确 head 验证后合并 PR，关闭关联 Issue，并删除对应远端分支。代码、规格、测试和交付记录必须保持一致。

## 当前证据（2026-08-26）

- 工作树：`/Users/galendai/orca/workspaces/zhiju-business-core/60-im-03-wi-04-project-scope`
- 分支：`galendai/60-im-03-wi-04-project-scope`
- 本地/远端分支共同 head：`412b14a`
- `origin/main`：`fd3a429`，当前 PR 分支基于已合并的 PR #72
- 工作树已有未跟踪目录 `tmp/`，在确认来源前不删除、不纳入本次提交
- 远端 PR #73 当前为 OPEN，head 为 `412b14af1213b481e8229d9f671ee1fe57522373`，未自动关联 Issue #60；精确 head 的 CI `verify` 因两处 Prettier 失败。
- Disposable PostgreSQL 复现 Project 新建时 `ON CONFLICT` 触发 `42501`：新 Project 尚未进入 allowed project 集合，不能满足冲突 arbiter 的 RLS 可见性要求。
- 静态复核发现对象验证查询对多个不含 `object_id` 的表使用通用列，且忽略 `objectType`；数据库 INSERT policy 也未绑定 `context_allows_enterprise(enterprise_id)`。
- 第一轮修复后的 gate 证明 V2004 的跨 Enterprise INSERT 拒绝已生效；正常路径仍因 `RETURNING` 受 Project SELECT RLS 约束，最终实现必须完全移除该返回读取。
- 第二轮 gate 证明 Project INSERT、保存点去重和 canonical payload 已通过；V2003 binding scope mirror trigger 的 `jsonb ->> text ->> field` 错误需要以 V2005 forward-only migration 修复。
- 第三轮 gate 证明 V2005 trigger 已生效；剩余失败是新 Project Event payload 与 Enterprise-only Command Envelope 的 `projectId` scope mirror 不一致，需把 Handler 生成的 Project ID绑定到本次受信事务。

## 验收边界

1. 读取并对齐 `HL-Spec.md`、`Module-Spec-002-EnterpriseProject.md` 与 `Module-Test-002-EnterpriseProject.md`。
2. 以 PR #73 的最新远端 head 为准，形成可复现、带文件/行号的错误证据。
3. 在修改代码前先更新规格和模块测试文档；测试包含输入、预期输出、实际输出及结果。
4. 修复后执行与 Project Scope、快照、对象引用、RLS/事务边界相关的聚焦测试，并按可用性执行完整验证；明确记录 `PASS` 与 `NOT RUN`。
5. 提交前完成 staged diff 审查；修复、规格、测试和 `.vibe` 交付记录一起进入可追溯 commit。
6. 非强制推送后重新读取 PR 精确 head、CI、comment；只在 head 未变化且检查满足要求时合并。
7. 合并后验证 PR、关联 Issue、远端 branch、`origin/main` ancestry 和工作树状态。

## 待完成

- [x] 读取规格与 PR/Issue 精确元数据
- [x] 定位并复现错误
- [x] 先更新规格/测试文档，再实施修复
- [x] 完成回归验证并记录结果
- [ ] 提交、推送、评论、合并、Issue/branch 收尾

## 修复后证据（2026-08-26）

- `pnpm verify`：PASS；Unit `21 passed / 13 skipped`、`348 passed / 201 skipped`；Architecture PASS；Contracts `200/200`；Format/Lint/Typecheck PASS。
- `pnpm persistence:gate`：PASS；PostgreSQL 18.6 / Flyway 11.20.3；Persistence `15 files / 214 tests passed`；V2004、V2005 应用成功；second migrate `No migration necessary`；容器已清理。
- 待交付边界：将本修复和 `.vibe` 记录 commit，非强制 push 到 PR #73 的 head，发表评论并回读 comment/head/checks，然后使用 exact-head merge；合并后关闭 Issue #60、删除远端 branch，并验证 main ancestry。
