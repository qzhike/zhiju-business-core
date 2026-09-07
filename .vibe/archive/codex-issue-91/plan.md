> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/codex-issue-91/plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/codex-issue-91/plan.md).

# Issue 91 实施记录

## 目标

实现 GitHub Issue 91 的要求，并在实现、验证、Git 交付及远端状态回读均完成后关闭对应 Issue、PR 和工作分支。

## 当前假设

- 以当前工作区检出的仓库和 Issue 91 的最新远端内容为需求权威。
- 先确认 Issue 91 是否已有对应 PR、分支和既有实现，再决定是补实现还是修复现有实现。
- 遵循项目 HL-Spec、模块 Spec、测试文档及仓库现有交付约束；不覆盖与本任务无关的用户改动。

## 成功标准

- Issue 91 的验收条件在代码、Spec 和测试文档中保持一致。
- 相关单元测试、集成/数据库测试或可执行的替代验证有明确 PASS/NOT RUN 边界。
- 形成 `.vibe` 审查/验证记录，提交前工作区差异可解释且通过检查。
- 经用户检查确认后完成 commit、push、PR 合并、Issue/PR/远端分支状态回读与必要的本地清理。

## 执行阶段

1. 调查 Issue、PR、分支、Spec 和现有代码，确认范围与验收条件。
2. 先修订相关 Spec/测试文档，再实施最小代码变更和回归测试。
3. 代码审查、分层验证并记录证据，保留未运行的外部/人工验证边界。
4. 实现、代码审查、自动化验证、GitHub exact-head 交付和 Issue/PR 状态回读已完成；最终 `.vibe` 状态同步由独立文档收口 PR 完成。
