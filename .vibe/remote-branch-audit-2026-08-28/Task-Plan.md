# Remote Branch 审计计划

## 目标

只读检查 `qzhike/zhiju-business-core` 除 `main` 外的所有远端分支，判断其是否可以安全关闭（删除），并为每个结论提供可复现证据。本任务不执行分支删除、PR 关闭、Issue 关闭、Merge、Commit 或 Push。

## 判断标准

每个远端非 `main` 分支至少核对：

1. 是否存在关联的 OPEN PR；
2. 分支 tip 是否已是 `origin/main` 的祖先；
3. 相对 `origin/main` 的 ahead/behind；
4. 若存在独有提交，merge-base 至 tip 是否仍有净文件差异；
5. 独有提交是否已通过 squash/rebase/merge 等方式等价落入 `main`；
6. 是否被 GitHub branch protection/ruleset 或本地 worktree 占用；
7. 关联 PR、Issue 和 CI 的当前状态。

## 分类

- `可安全删除`：无 OPEN PR，交付已合入/等价进入 `main`，无未承接净差异。
- `暂不应删除`：仍有 OPEN PR、未合入净差异、活跃交付或保护规则。
- `需人工确认`：Git 历史无法证明等价落地主线，或分支用途/Owner 不清楚。

## 验证步骤

1. 同步远端引用并读取 GitHub branches/PR/ruleset 状态。
2. 对每个分支计算 ancestry、ahead/behind、unique commits 和 net diff。
3. 检查本地 worktree/branch 占用与工作树状态。
4. 汇总结论并回读远端，确保审计期间未发生分支漂移。

## 状态

`COMPLETE / REMOTE BRANCHES DELETED / REMOTE ONLY MAIN`

## 结果

- `galendai/im-03-enterpriseproject-reference-foundation`：可安全删除。
- `galendai/im-03-im04-authority-sync`：可安全删除。
- 用户明确授权后，两个 GitHub remote refs 均已删除并回读确认；远端只剩 `main`。
- 两个本地 stale `origin/...` remote-tracking refs 已清理；本地普通 branch 未在本次 remote 清理授权范围内，未删除。
- 详见 [`Audit-Report.md`](./Audit-Report.md)。
