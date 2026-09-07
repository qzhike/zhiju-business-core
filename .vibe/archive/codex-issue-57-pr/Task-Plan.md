> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/codex-issue-57-pr/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/codex-issue-57-pr/Task-Plan.md).

# Issue #57 PR 交付计划

当前状态：`PR #69 OPEN / REVIEW PATCH CONFIRMED / COMMIT AUTHORIZED / BUSINESS IMPLEMENTATION NOT STARTED`

## 目标

围绕 GitHub Issue #57（IM-03 WI-01 EnterpriseProject）核对当前分支实现与项目规格，补齐必要的实现、规格/测试文档和回归验证，并在获得用户对变更的确认后提交、推送和创建 PR。

## 当前假设与边界

- 以当前工作树、当前分支和远端 GitHub 状态为准，不把历史记录或 README 意图当作完成证据。
- 先读取 `.vibe/high-level-docs/HL-Spec.md`、EnterpriseProject Module Spec、对应 Module Test，以及 Issue/PR 交付记录。
- 若本轮产生代码或项目文档变更，先同步相关规格和测试文档；测试遗留文件在验证后清理。
- 评估、实现、测试、提交、推送和创建 PR 分开记录；在用户确认变更前不执行 commit。
- 自动化测试只证明其实际覆盖范围；真实数据库、外部服务和人工验收按 `PASS`、`NOT RUN` 或 `PARTIAL` 分开报告。

## 执行步骤

1. 核对工作树、分支、远端、Issue #57、现有 PR 和规格/测试文档。
2. 对照 EnterpriseProject 的契约、模块设计和验收条件审查实际实现与测试缺口。
3. 如有缺口，先更新 `.vibe` 规格/测试文档，再进行最小范围实现和回归测试。
4. 运行与需求范围匹配的验证，记录输入、预期输出、实际输出和未运行边界。
5. 形成 PR 交付记录，向用户报告待确认变更；用户确认后再 commit、push 和更新既有 PR。
6. 更新既有 PR 后核验精确 head、检查状态、Issue 关联和 PR 描述是否与证据一致，再合并并关闭原始 Issue。

## 验收证据

- 规格：`.vibe/high-level-docs/HL-Spec.md`、`.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`。
- 测试：`.vibe/module-tests/Module-Test-002-EnterpriseProject.md` 及仓库内对应测试。
- 交付：本目录下的审查、验证和 PR 记录，以及 GitHub PR 的精确 head 和 checks。

## 本轮验证结果

- `pnpm format:check`：通过。
- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：20 个测试文件通过、10 个跳过；341 个测试通过、164 个跳过。
- `pnpm architecture`：`architecture_boundaries=PASS source_roots=10`。
- `pnpm contracts:check`：200 项公开 Operation、200 个 Registry、200 个完整 Schema、v1.0 compatibility baseline 均通过，`findings=0`。
- PR #69 exact-head CI run `32795729365`：`verify=success`，head 为 `9c02ac80491b3d60c59685c2ea1ac33ce875981c`。
- 当前本地 `pnpm verify`：format/lint/typecheck/test/architecture/contracts 通过；persistence gate 因 Docker Hub manifest 查询 `EOF` 阻塞，当前结果为 `BLOCKED`。
- `.vibe` Markdown 相对链接检查：142 个文件、195 条相对链接通过；`git diff --check` 通过。

## 当前等待

PR #69 已存在且 exact-head CI 通过；本次审查修订已获用户确认，当前尚未 commit/push。下一步是提交、推送、写入 PR comment、合并 PR、同步/关闭 Issue #57，并逐项回读远端状态。
