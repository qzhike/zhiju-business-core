# IM-05 WI-02 交付任务计划

## 目标

交付 GitHub Issue #122 对应的 IM-05 WI-02：实现 Evidence、EvidenceLink、QualityProfile 生命周期，并在实现、测试、代码审查和远端 exact-head 证据完整后，关闭关联 Issue/PR，删除明确的本地及远端交付分支。

## 工作边界

- 以 `.vibe/high-level-docs/HL-Spec.md`、`.vibe/module-specs/Module-Spec-005-QualityGovernance.md`、`.vibe/module-tests/Module-Test-005-QualityGovernance.md` 及 Issue #122 为权威输入。
- 保留现有工作树中与本任务无关的改动；当前已知工作树为干净状态。
- 交付证据区分静态检查、单元测试、真实 PostgreSQL/迁移验证、CI、Provider/生产/人工验收等边界，不以未运行项目冒充 PASS。

## 验收步骤

1. 读取并对齐 HL-Spec、QualityGovernance Module-Spec/Module-Test、IM-05 计划及 Issue #122。
2. 在实现前更新受影响的权威 Spec 与测试文档，明确本 WI-02 的合同、测试输入、预期结果和边界。
3. 实现 Evidence、EvidenceLink、QualityProfile 生命周期及其持久化/公开端口边界。
4. 编写并运行最小充分的单元、类型/静态、迁移和真实 PostgreSQL 语义测试；清理临时测试产物。
5. 形成审查与验证记录，检查 staged 文件、`git diff --cached --check`，并在用户确认后提交。
6. 非强制 push 后，以 exact head 核对 CI、PR head/status、Issue 关联和远端回读；按确认的交付闭环合并/关闭，并删除明确的本地及远端分支。

## 当前状态

- 计划创建：2026-08-30。
- 起始 HEAD：`d7fb591a789d7c2f77a2c1aaec79031a5114b0c6`。
- 起始工作树：干净。
- 实现与本地验证：2026-08-30 完成；validation Unit 8/8，pinned PostgreSQL/Flyway persistence gate 30 files/298 tests，完整静态/类型/普通测试/架构/Contract 检查通过。
- 交付结果：用户于 2026-08-30 确认提交；commit `f0269ddfac1d16dd3f627818606e8546254f8ef1` 已非强制 push，并由 PR #130 通过 exact-head CI 后合入 `main`，merge commit 为 `7f04f8acea7b32a456316801aa0b5ed75c7230a7`。PR #130 已为 `MERGED`，Issue #122 已为 `CLOSED`，本地及远端 feature branch 已删除；任务 worktree 已安全切换到 `origin/main`，主 worktree 与本地 `main` 保持未改动。
