> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/worktree-consolidation-2026-08-30/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/worktree-consolidation-2026-08-30/Task-Plan.md).

# Worktree 合并与清理计划

日期：2026-08-30

状态：`COMPLETE / LOCAL AND REMOTE ONLY MAIN`

## 目标

将所有本地 Zhiju 任务 worktree 中尚有价值且未进入 `main` 的修改精确合并到当前主线；验证后提交并同步远端，随后移除所有非主 worktree、本地非 `main` branch 和远端非 `main` branch，最终只保留干净且同步的 `main`。

## 合并原则

1. 每个 worktree 的 HEAD 必须先证明为 `origin/main` 祖先或对独有提交单独处理。
2. 已被后续主线覆盖的旧文件不得反向覆盖 `main`。
3. 批量文件缺失、构建产物和测试残留不得作为业务修改合并。
4. 未提交文档只提取当前 `main` 仍缺少的事实；`NOT RUN`、`PARTIAL` 和人工/外部边界不得升级为 `PASS`。
5. 移除 worktree 前，必须确认其没有未承接的独有内容；移除后回读 Git、Orca 与 GitHub 状态。

## 当前分类

- 8 个任务 worktree 的 HEAD 均已进入 `origin/main`，没有独有提交。
- 6 个 detached worktree 干净，可在主线同步后移除。
- IM-04 父验收 worktree 的 315 个变化全部是已跟踪文件缺失，不合入主线。
- Issue #95 worktree 有 8 个文档修改；其中高层/Module Spec/Test 已被后续主线覆盖，只同步当前主线仍过时的 WI-06 和交付记录状态。

## 验证与手动产出

1. 文档 whitespace、格式和链接检查。
2. 完整项目 Gate；若外部环境阻塞，必须记录准确边界。
3. 用户可检查最终 `git worktree list`、`git branch`、`git ls-remote --heads origin`、GitHub OPEN PR 和工作树状态。
4. 最终应只有主工作树、`main` 本地 branch 和 `main` 远端 branch。

## 执行结果

- 本地 `main` 已以 fast-forward 同步至执行时的 `origin/main@494734d92356d8584e32578b8c3c527fd7f807b8`。
- Issue #95 worktree 的收尾状态经 GitHub 实时回读后，已精确同步到 WI-06 状态与四份交付记录；后续 HL-Spec、Module Spec/Test 保留 `main` 上更完整的 WI-07～WI-09/IM-05 状态，未被旧 worktree 覆盖。
- IM-04 父验收 worktree 的 315 个批量删除全部判定为文件缺失残留，没有合入主线。
- 8 个任务 worktree 均已通过 Orca 移除；所有任务 HEAD 在移除前均已证明是 `origin/main` 祖先。
- Orca/Git 最终只保留 `/Users/galendai/repo/zhiju-business-core` 主工作树。
- 本地普通 branch 与 GitHub remote branch 最终都只保留 `main`；GitHub OPEN PR 为 0。
- 完整 `pnpm verify` 通过：普通 Vitest `34 passed / 25 skipped` 文件、`395 passed / 278 skipped` 用例；Contract `201 operations / 201 FULL`；Persistence `29 files / 293 tests`，PostgreSQL 18.6、Flyway 11.20.3 空库迁移、第二次 no-op 和容器清理均通过。
