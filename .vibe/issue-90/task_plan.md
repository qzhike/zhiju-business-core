# Issue #90 执行计划

## 目标

完成 GitHub Issue #90「Freeze executable canonical schemas」的实际实现、回归验证、提交、推送、合并，并在确认 `main` 已包含精确修复提交后关闭 Issue #90 和本工作分支。

## 当前边界

- 工作目录：`im-04-wi-01-freeze-executable-canonical-schemas`
- 初始本地分支：`galendai/im-04-wi-01-freeze-executable-canonical-schemas`
- 初始工作树：读取时干净
- 设计与实现依据：`HL-Spec.md`、相关 `Module-Spec-*`、相关 `Module-Test-*`、Issue #90 及其当前 PR 元数据
- 交付原则：实现、测试、提交、推送、合并、Issue 关闭和 branch 删除分别核验；未执行的 Provider/生产/人工验收不得记为 PASS

## 验收步骤

1. 读取 Issue #90 与实际 authority 文档，确定模块、Schema、Registry、测试和非目标。
2. 先同步本次任务文档与测试记录，再修改实现和回归测试。
3. 执行聚焦测试、完整验证、差异审查，并记录精确命令、结果和 `NOT RUN` 边界。
4. 仅提交本任务范围内的文件；推送后以当前 PR 精确 head 等待 CI，并使用精确 head 约束合并。
5. 合并后回读 PR、`origin/main` 祖先关系、Issue #90、远端及本地 branch/worktree，并确认权威文档无陈旧开放状态。

## 状态

`IMPLEMENTATION AND CONTRACT REGRESSION COMPLETE / READY FOR USER REVIEW BEFORE GIT DELIVERY`

- [x] Issue/Spec/现有 PR 读取完成
- [x] 实现与回归完成
- [x] 聚焦测试与完整验证完成（静态/普通全量 PASS；PostgreSQL/Flyway persistence gate `21 files / 256 tests` PASS）
- [x] `.vibe` 交付记录已创建，待用户确认后纳入最终提交
- [ ] PR 已按精确 head 合并到 `main`
- [ ] Issue #90 已关闭
- [ ] 远端和本地 branch 已清理并完成最终回读
