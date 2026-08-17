# PR #12 Code Review 与修复任务计划

日期：2026-08-17
状态：`REVIEW SUBMITTED / REMEDIATION VERIFIED / USER REVIEW PENDING`

## 1. 范围

本任务审查并修复 PR #12 中 Artifact Revision lineage 的可执行 Contract Schema，不改变已审核的 Artifact 业务语义、公开操作数量或模块所有权。

GitHub Review：`https://github.com/qzhike/zhiju-business-core/pull/12#pullrequestreview-4952410160`

## 2. 已确认问题

1. `artifact.create_and_seal_revision@1.0` 可接收两个及以上 parent，绕过 Merge 所需的策略、冲突与解决记录；`artifact.create_merge_revision@1.0` 也可接收不足两个 parent。
2. `artifact.create_merge_revision@1.0` 在 `conflictSet` 非空且 `conflictResolutionRefs` 为空时仍被 Registry 接收。

## 3. 执行顺序与验证

1. 同步 HL-Spec、Module Spec 与 Module Test，记录失败输入和预期结果。
2. 增加失败回归用例，证明修复前输入被错误接收。
3. 为普通 Revision 与 Merge Revision 分别施加 parent 数量约束，并为非空冲突施加非空解决引用约束。
4. 运行 focused Contract tests、全量 `pnpm verify` 与 `git diff --check`。
5. 用户检查修改后再决定是否 commit；本任务不自动 commit 或 push。

## 4. 人工可验收产出

用户可检查 GitHub Review、对应 Schema diff 和回归测试，确认普通 Revision 无法伪装为 Merge、未解决冲突无法进入 `FULL` Contract。

## 5. 验证结果

- 修复前 focused regression：25 通过、2 失败，证明两项 Review 问题可复现。
- 修复后 focused regression：27/27 通过。
- 全量 `pnpm verify`：4 个测试文件、35/35 测试通过；format、lint、typecheck、architecture 与 Catalog Gate 通过。
- `git diff --check`：通过。
- 当前 Node.js 为 `v24.13.0`，低于仓库锁定的 `24.19.0`；pnpm 为 `11.19.0`。Node engine 警告保留为验证边界。
