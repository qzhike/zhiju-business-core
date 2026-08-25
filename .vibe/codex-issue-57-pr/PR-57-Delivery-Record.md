# Issue #57 PR 交付记录

日期：2026-08-25
状态：`PR #69 OPEN / EXACT-HEAD REVIEW IN PROGRESS / BUSINESS IMPLEMENTATION NOT STARTED`

## 1. 当前 Git 边界

- Issue：`#57 [IM-03][WI-01] 冻结 EnterpriseProject 公共能力与实施决策`。
- 分支：`galendai/57-im-03-wi-01-enterpriseproject`。
- PR #69 当前本地/远端 HEAD：`9c02ac80491b3d60c59685c2ea1ac33ce875981c`。
- PR base 当前远端 `origin/main`：`fde4d8bbd3a8fbacb8f452072d93aeb4e1a14ba7`。
- 原始 PR 提交已完成 push；当前 review 工作树另有未提交的 `.vibe` 审查/证据修订，尚未执行本轮 merge 或 Issue #57 关闭。
- 当前 HEAD 包含用户此前在本地 `main` 上的 `df0809e docs: add IM-03 work item issue plan`，以及 `9c02ac8 docs(im-03): freeze EnterpriseProject prerequisite capabilities`；本轮不重写或删除既有提交。

## 2. 本轮决策交付

1. 保持现有 32 个 EnterpriseProject `@1.0` Contract 和全局 200 项公开 Catalog 不变。
2. 将 Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot、Platform Template/Regulatory Reference 的写入定义为 EnterpriseProject Owner 的受控 Application Capability；不允许测试、Migration、跨 Schema Join 或直接业务表写入充当入口。
3. 冻结 ProductVersion 追加与精确版本激活/回滚、QMS Revision 人工激活/回滚、Profile Snapshot 生成、ProjectStartSnapshot 三个必需 Ref、平台 Reference 导入/发布和 Gap `STALE`/Impact Review 最小规则。
4. 明确 QualityProfile/EvidenceRef 仅保留 IM-05 的强引用形状和版本/hash/lifecycle/purpose 校验边界。
5. 业务 DDL、Repository、Handler、Evaluator、真实业务 PostgreSQL 链和人工验收不在本 Work Item 实现，继续标记为 `NOT RUN`。

决策正文见 [`Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md)。

## 3. 变更范围

- 更新 HL-Spec、Architecture、Domain Model、Typed Reference/Catalog、Logical Model、Verification Baseline、API Contract、EnterpriseProject Module Spec、Module Test 和 IM-03 实施计划，使它们共享同一决策边界。
- 在 `.vibe/issue-57-enterpriseproject/` 新增决策矩阵和受控 Capability 逻辑示例。
- 在 `.vibe/codex-issue-57-pr/` 保存本轮任务计划和交付记录。
- 未修改 `contracts/` 生成源、Schema、生成 TypeScript 类型、Catalog、Registry、Compatibility Baseline 或业务运行时代码。

## 4. 验证记录

| 检查 | 输入/范围 | 实际输出 | 结果 |
|---|---|---|---|
| `pnpm format:check` | 全仓库 | All matched files use Prettier code style | `PASS` |
| `pnpm lint` | 全仓库 | ESLint 退出码 0 | `PASS` |
| `pnpm typecheck` | TypeScript project references | `tsc -b --pretty false` 退出码 0 | `PASS` |
| `pnpm test` | 现有 Vitest suite | 20 files passed / 10 skipped；341 tests passed / 164 skipped | `PASS` |
| `pnpm architecture` | source boundary | `architecture_boundaries=PASS source_roots=10` | `PASS` |
| `pnpm contracts:check` | 公开 Contract 生成、Catalog、Registry、compatibility | operations=200；catalog=200；registry=200；schema `FULL=200`；baseline findings=0 | `PASS` |
| Markdown link gate | `.vibe` 142 份 Markdown、195 条相对链接 | `markdown_links=PASS` | `PASS` |
| `git diff --check` | 本轮工作树差异 | 无输出 | `PASS` |
| `pnpm verify` | 项目完整 Gate，包括 persistence | PostgreSQL 18.6/Flyway 11.20.3；第二次 migrate 无需迁移；177 个 persistence 测试通过；`persistence-gate=PASS` | `PASS` |

上述自动化结果只证明现有代码和技术基础的实际覆盖范围；它们没有将业务切片、业务 Handler、业务 DDL 或人工审阅标记为完成。

本次 exact-head 复核：GitHub Actions run `32795729365` 在 head `9c02ac80491b3d60c59685c2ea1ac33ce875981c` 上 `verify=success`。当前本地复跑已完成 format/lint/typecheck/test/architecture/contracts，但 persistence gate 在 Docker Hub manifest 查询处因 `EOF` 阻塞；该环境结果不替代 exact-head CI，也不改变业务实现 `NOT RUN`。

## 5. 用户确认项

用户需要确认以下设计选择后，才允许进入 commit：

- 受控 Application Capability 作为本 Issue 的入口，不在本轮新增公开 Contract。
- Product/QMS/Profile/ProjectStartSnapshot/Platform Reference/Gap 的版本和失败边界。
- 接受业务实现、真实业务 PostgreSQL、E2E 和人工审阅继续保持 `NOT RUN`，由后续 WI 实现。
- 接受当前分支已有的 IM-03 Work Item 计划提交随本分支进入 PR，不对既有历史做重写。

确认后流程为：只暂存本次审查范围文件 → 检查 staged diff → 使用英文 commit message 提交 → 非强制 push → 按精确 head 复核 PR #69 和 checks → 合并 PR → 同步并复核 Issue #57 body → 关闭并回读 Issue #57。
