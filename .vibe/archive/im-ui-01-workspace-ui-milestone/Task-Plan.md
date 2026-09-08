> Historical record. Related Issue: 未创建专属 Issue；未来 UI 决策仍由 Module Spec/Test UI01 和技术基线维护. Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-UI-01 Workspace UI MVP 里程碑建档计划

## 目标

在现有 IM-00～IM-09 实施计划中新增独立的 `IM-UI-01 Workspace UI MVP` 里程碑，使 Human Workspace 的开发时点、依赖、范围、安全边界、手动验收产出和测试 Gate 可执行、可追踪。

## 计划假设

1. 不重编号既有 IM-07、IM-08、IM-09，避免破坏现有 Issue、PR 和权威文档引用。
2. `IM-UI-01` 硬依赖 IM-06 Human-operated Core。
3. `IM-UI-01` 可与 IM-07 Feishu Channel、IM-08 CLI Runtime Automation 并行。
4. IM-09 必须等待 IM-UI-01、IM-07、IM-08 的适用 Gate 完成后再做完整 Reference Project E2E。
5. 本次只批准里程碑和产品/安全/测试边界；前端框架、设计系统、浏览器支持矩阵和部署载体必须在实现前通过独立决策 Gate，不在本文档变更中静默选择。

## 受影响文档

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/high-level-docs/02-zhiju-core-architecture.md`
- `.vibe/high-level-docs/08-verification-baseline.md`
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md`
- `.vibe/module-specs/Module-Spec-UI01-WorkspaceUI.md`（新增）
- `.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md`（新增）

## 执行步骤与验证

1. 核对现有 UI、BFF、OIDC、Projection 与 Human-only 约束 → 验证：不在第二处发明业务语义。
2. 更新里程碑依赖、产出、退出 Gate 和手测产出 → 验证：IM-09 依赖关系闭合，既有编号不漂移。
3. 新建 Workspace UI Module/Test Spec → 验证：Unit、Contract、Browser E2E、Security、Accessibility、Manual 用例均有输入、预期输出、当前实际输出。
4. 更新高层状态和 Verification Baseline → 验证：文档只声明 `DESIGN VERIFIED`，实现与浏览器测试均为 `NOT RUN`。
5. 执行 Markdown/引用/一致性检查 → 验证：无断链、无尾随空白、无旧“UI 未排期”矛盾表述。

## 非目标

- 不创建前端工程、BFF、页面、组件、路由或浏览器测试代码。
- 不选择 React、Vue、Svelte、Next.js 或其他具体框架。
- 不创建 GitHub Issue、开发分支、PR、Commit 或 Push。
- 不把飞书卡片、CLI 或 IM-09 的 Workspace 输入误写成 Web UI 实现。

## 状态

`COMPLETE 2026-08-28`

验证结果：

- 11 份本次新增/修改文档通过 Prettier 检查；
- 11 份文档的本地 Markdown 链接全部可解析；
- Workspace UI 测试矩阵精确为 15 项：1 项 `DESIGN VERIFIED`、14 项 `NOT RUN`；
- `git diff --check` 通过，未发现尾随空白或 Patch 格式问题；
- 本次没有代码、依赖或运行环境变更，因此未执行 Unit、Persistence、Browser E2E、Security、Accessibility 或 Manual Test，且未创建临时测试制品。
