> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-70-review/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-70-review/Task-Plan.md).

# PR #70 审核与交付计划

## 目标

对 GitHub PR #70 进行基于实际精确 head 的代码审核；对可复现的契约、数据完整性、权限或测试缺陷实施最小修正；将审核与修正证据记录到 `.vibe` 并发布到原始 PR comments；在提交、推送、检查和合并边界明确的前提下合并 PR，并验证其原始 Issue 已关闭。

## 当前假设与待确认事实

- 当前工作树位于 PR #70 对应的 EnterpriseProject WI-02 分支，但 PR 的远端 head、base、关联 Issue 和可合并状态必须以 GitHub 查询为准。
- 规格权威来自仓库中的 `HL-Spec.md`（如存在）以及 `.vibe/high-level-docs/HL-Spec.md`、EnterpriseProject Module Spec 和对应测试文档；若仓库结构与约定不一致，先记录并以实际权威文档为准。
- 用户已明确授权本次 PR 的修复、提交、推送、PR comments、合并以及原始 Issue 关闭；仍需使用 exact-head 和非强制推送保护远端历史。
- Provider、生产、HTTP/E2E 或人工验收若未实际执行，交付记录中标记为 `NOT RUN`，不以本地测试替代。

## 成功标准

1. 规格、PR 精确 head/base、实际 diff、测试和远端检查状态均有可复核证据。
2. 每个修复都能对应一个明确的规格不变量、可复现反例和回归测试；不扩大无关范围。
3. HL-Spec、EnterpriseProject Module-Spec、对应测试文档与实现保持一致，并随交付记录进入版本控制。
4. 修复记录写入原始 PR comments，内容包含问题、修复、验证边界和未运行的验收项。
5. 在验证 exact head 与 required checks 后合并 PR；fetch 后证明合并提交属于 `origin/main`，并回读 PR 与命名 Issue 的最终状态。

## 工作阶段

- [ ] 读取规格、模块实现、测试和 PR 元数据。
- [ ] 从规格不变量构造负向语义反例并记录审核结论。
- [ ] 先更新规格和测试文档，再实施最小代码/测试修复。
- [ ] 执行聚焦测试及适用的完整验证，清理临时测试遗留物。
- [ ] 完成 `.vibe` 审核/交付记录，提交并推送修复。
- [ ] 发布原始 PR comments，等待并核对精确 head checks。
- [ ] 使用 `--match-head-commit` 合并，验证 main ancestry、PR 和原始 Issue 状态。
