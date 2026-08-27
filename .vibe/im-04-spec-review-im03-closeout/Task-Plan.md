# IM-04 规格复审与 IM-03 关闭交付计划

- 日期：2026-08-27
- 当前工作树：`galendai/im-03-enterpriseproject-reference-foundation`
- 当前状态：`REVIEW PASS / PR #88 MERGED / ISSUE #56 CLOSED / ISSUES #89–#98 CREATED / FINAL AUTHORITY SYNC RECORDED / NO IM-04 IMPLEMENTATION`

## 目标

1. 再次复审 IM-04 与 IM-DG-005 规格同步，确认无阻断性错误、冲突或虚假 `PASS`。
2. 核对 Issue #56、当前分支、远端 `main`、未提交文档和验证边界。
3. 仅在复审通过后，提交当前文档、推送、通过 PR 合入 `main`，并在读回默认分支祖先关系后关闭 Issue #56。
4. 在 GitHub 建立可独立审阅的 IM-04 开发 Work Item，记录依赖、验收产出、非目标和 `NOT RUN` 边界。

## 禁止范围

- 不创建 IM-04 工作树或实现分支。
- 不修改 IM-04 业务代码、公共 Contract、Migration、Repository、Fixture 或 Renderer。
- 不运行会写入生产、真实 Provider 或外部业务系统的验收。
- 不把规格批准、静态审阅、现有 Contract 测试或 IM-03 PostgreSQL Gate 解释为 IM-04 实现 `PASS`。
- 不在 PR 合入与默认分支祖先关系验证前关闭 Issue #56。

## 成功条件

- 复审结论和位置级证据写入本目录的 Review/Verification 记录。
- 文档格式、差异检查和适当的仓库 Gate 通过，未执行边界明确。
- 交付 Commit、PR exact head、CI、merge commit、`origin/main` 祖先关系、Issue #56 状态均被 API/本地读回。
- IM-04 Work Item 已在 GitHub 创建并读回，且只表达开发计划，不声称已开始实现。
