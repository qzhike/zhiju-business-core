> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/remote-branch-audit-2026-08-28/Audit-Report.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/remote-branch-audit-2026-08-28/Audit-Report.md).

# Remote Branch 审计报告

日期：2026-08-28

仓库：`qzhike/zhiju-business-core`

范围：除 `main` 外的全部远端分支

结论：`REMOTE BRANCH CLEANUP COMPLETE / REMOTE ONLY MAIN`

## 1. 结论摘要

GitHub 当前只有两个非 `main` 远端分支。两个分支均无 OPEN PR、无 `main` 未包含的独有提交、无净文件差异，tip 均已是当前 `main@89073aba62f26e291adb23f6b1c6cf652a285c4e` 的祖先；关联 PR 已 MERGED，exact-head `verify` 为 SUCCESS，Branch API 返回 `protected=false`，也没有本地 worktree 占用。

因此，两个分支均可安全删除：

| 远端分支 | Tip | 相对 `main` | 关联 PR | CI | 结论 |
|---|---|---:|---|---|---|
| `galendai/im-03-enterpriseproject-reference-foundation` | `1c49bf565487bc8a2edadb16581655f4c6c647e7` | behind 3 / ahead 0 | #88 MERGED | `verify` SUCCESS | `可安全删除` |
| `galendai/im-03-im04-authority-sync` | `200891fb825ccf2b9cef60aae96aa6544e178c8b` | behind 1 / ahead 0 | #99 MERGED | `verify` SUCCESS | `可安全删除` |

仓库设置 `delete_branch_on_merge=false`，所以它们在 PR 合并后残留；这不是未交付证据。

## 2. 分支证据

### 2.1 `galendai/im-03-enterpriseproject-reference-foundation`

- GitHub tip：`1c49bf565487bc8a2edadb16581655f4c6c647e7`。
- GitHub Compare `main...branch`：`status=behind`、`behind_by=3`、`ahead_by=0`、`total_commits=0`、`files=[]`。
- 本地独立 Git 验证：tip 是当前 `HEAD/main` 的祖先；`HEAD...tip` 为 `3 0`，即主线独有 3 个提交、分支独有 0 个提交。
- 关联 PR [#88](https://github.com/qzhike/zhiju-business-core/pull/88)：`MERGED`，head 精确等于该 branch tip，merge commit 为 `4f2eba2b3f6c64c52b35019e56ccbd57c0fed0f0`。
- PR #88 exact-head `verify`：`COMPLETED / SUCCESS`。
- PR #88 关联的 IM-03 Exit Gate [Issue #56](https://github.com/qzhike/zhiju-business-core/issues/56)：`CLOSED / COMPLETED`。
- OPEN PR：0；Branch API：`protected=false`；本地 worktree 占用：无。

结论：没有需要保留或再合并的分支独有交付，可安全删除远端 branch。

### 2.2 `galendai/im-03-im04-authority-sync`

- GitHub tip：`200891fb825ccf2b9cef60aae96aa6544e178c8b`。
- GitHub Compare `main...branch`：`status=behind`、`behind_by=1`、`ahead_by=0`、`total_commits=0`、`files=[]`。
- 本地独立 Git 验证：tip 是当前 `HEAD/main` 的祖先；`HEAD...tip` 为 `1 0`，即主线独有 1 个提交、分支独有 0 个提交。
- 关联 PR [#99](https://github.com/qzhike/zhiju-business-core/pull/99)：`MERGED`，head 精确等于该 branch tip，merge commit 即当前 `main@89073aba62f26e291adb23f6b1c6cf652a285c4e`。
- PR #99 exact-head `verify`：`COMPLETED / SUCCESS`。
- PR #99 明确不自动关闭既有 Issue；IM-04 Exit Gate [Issue #89](https://github.com/qzhike/zhiju-business-core/issues/89) 仍为 OPEN，但其计划/权威文档已经通过 PR #99 合入 `main`。Issue #89 的开放状态不要求保留这个已合入且 ahead 0 的文档分支。
- OPEN PR：0；Branch API：`protected=false`；本地 worktree 占用：无。

结论：没有需要保留或再合并的分支独有交付，可安全删除远端 branch。后续 IM-04 实现应使用对应 Work Item 分支，不应继续复用已合入的 authority-sync branch。

## 3. 仓库级核对

- 默认分支：`main`。
- 当前 GitHub heads：上述两个分支与 `main`，无其他远端分支。
- GitHub OPEN PR：0。
- 两个候选分支均 `protected=false`。
- Repository Rulesets API 对当前私有仓库套餐返回 HTTP 403；因此没有把 ruleset 详情声明为已验证。Branch API 的最终分支保护状态仍明确返回 `protected=false`。
- 当前本地仅一个 worktree，位于 `/Users/galendai/repo/zhiju-business-core`，检出 `main@89073aba62f26e291adb23f6b1c6cf652a285c4e`；没有候选分支被 worktree 占用。
- 本轮 SSH `git fetch origin --prune` 遇到连接中断；审计改用 GitHub Branch/Compare/PR/Check API 获取当前远端状态，并使用本地已有 commit object 对 API 返回的 exact SHA 独立执行 ancestry/ahead-behind 验证。当前本地 `HEAD` 与 GitHub `main` SHA 一致。

## 4. 清理执行结果

用户随后明确授权清理，已执行并验证：

- 删除远端 `refs/heads/galendai/im-03-enterpriseproject-reference-foundation`；
- 删除远端 `refs/heads/galendai/im-03-im04-authority-sync`；
- GitHub `matching-refs/heads/` 与 Branch API 回读均只剩 `main@89073aba62f26e291adb23f6b1c6cf652a285c4e`；
- GitHub OPEN PR 仍为 0；PR #88、#99 仍为 `MERGED`，历史 head/merge commit 记录未受影响；
- 删除本地两个对应的 stale `origin/...` remote-tracking refs；本地仅保留 `origin/main` 远端跟踪引用。

本次授权范围是 remote 侧分支清理，因此没有删除本地普通 branch。当前本地仍存在同名历史 branch 以及既有 `ls` branch，但均未被 worktree 检出；它们不再对应 GitHub remote refs。

## 5. 操作边界

Git branch 在 GitHub 上没有独立的 Closed 状态，“关闭”实际是删除远端 ref。清理已严格限定为两个经审计的 remote refs。本轮没有执行：

- 本地 branch 删除；
- PR/Issue 关闭或修改；
- Commit、Push 或 Merge。

本地审计文档仍未 Commit；是否提交由用户另行确认。
