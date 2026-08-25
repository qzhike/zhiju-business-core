# PR #69 Code Review 记录

日期：2026-08-25
审查对象：`https://github.com/qzhike/zhiju-business-core/pull/69`
审查 head：`9c02ac80491b3d60c59685c2ea1ac33ce875981c`
审查 base：`fde4d8bbd3a8fbacb8f452072d93aeb4e1a14ba7`
关联 Issue：`#57`
状态：`REVIEW PATCH CONFIRMED / COMMIT IN PROGRESS / BUSINESS IMPLEMENTATION NOT STARTED`

## 1. 审查结论

PR #69 的实际差异全部位于 `.vibe` 规格、模块测试、实施计划、Work Item 计划和交付记录，没有业务运行时代码、Migration、可执行 Schema、生成类型或公开 Catalog 变更。公开 EnterpriseProject `@1.0` Contract 仍为 32 项，全局 Catalog/Registry 仍为 200 项。

未发现需要修改业务源代码的语义缺陷。发现并修订了交付证据边界：两份 Issue #57 交付文档保留了 PR 创建前的旧 HEAD/未 push 状态；本地 WI-01 Issue 草案比远端 Issue #57 多出本分支决策记录。前者已在本地文档修订，后者必须在合并前同步到远端 Issue body，才能准确关闭原始 Issue。

## 2. 已核对的契约边界

- `HL-Spec.md`、Architecture、Domain Model、PostgreSQL Logical Model、Typed Reference/Catalog、API Contract、Module Spec/Test 均将受控 Capability 与公开 Catalog 分开。
- `project.create_project@1.0` 的 `startSnapshot` 在可执行 Schema 中继续要求 `enterpriseProfileSnapshotRef`、`qmsConfigurationRef` 和 `productScopeSnapshotRef` 三个字段；未发现 `latest` 或数据库隐式补齐路径。
- 决策矩阵冻结了 Product/QMS/Profile/ProductScope/Platform Reference 的 Owner、受控入口、授权 purpose、版本/Hash 语义、Human-only 边界、失败码和 `STALE`/Impact Review 规则；业务 Handler、Repository、业务 DDL 和真实业务 PostgreSQL 仍标记为 `NOT RUN`。
- GitHub PR #69 的 exact-head CI run `32795729365` 对 head `9c02ac80491b3d60c59685c2ea1ac33ce875981c` 返回 `verify=success`。

## 3. 发现与修订

### Finding 1 — 交付记录使用已过期的提交/PR 状态

原 `.vibe/codex-issue-57-pr/PR-57-Delivery-Record.md` 把 `df0809e` 写成当前 HEAD，并写成尚未 push、尚未创建 PR；原 `Task-Plan.md` 也写成尚未创建 PR。这与实际开放 PR #69、head `9c02ac8` 和 exact-head CI 状态冲突，会使后续 review/merge/Issue closeout 无法据此复现。

修订：两份交付文档已更新为 PR #69 的实际 head/base、已存在 PR、exact-head CI 证据、本地 persistence gate 环境阻塞和后续 merge/Issue closeout 流程。

### Finding 2 — 本地 Issue #57 草案与远端 body 漂移

对 `.vibe/im-03-workitem-issues/issues/00-exit-gate.md` 至 `12-completion-impact.md` 与 GitHub #56–#68 body 做标准化比较：#56、#58–#68 一致；#57 不一致。差异是本地 #57 草案额外包含“本分支交付记录”一节，其中明确选择受控 Application Capability、不扩展当前 200 项 Catalog；远端 Issue #57 尚未包含该决策段。

影响：如果直接关闭 Issue #57，Issue 的远端 Source of Truth 会遗漏本 PR 的最终入口决策。

修订计划：先将本地 #57 body 中的决策矩阵链接改为合并后可访问的稳定 GitHub `main` 链接，再使用已审阅 body 同步远端 Issue #57；随后再次比较 body、确认 PR 已合入默认分支，再关闭并回读 Issue #57。Issue 的关闭不会依赖 `Refs #57` 或 `Closes #57` 文本自动推断。

### Finding 3 — 当前工作区 persistence gate 受外部镜像查询阻塞

本地 `pnpm verify` 的 format、lint、typecheck、Vitest、architecture 和 contracts 阶段通过；persistence gate 在 Docker Hub PostgreSQL manifest 查询处返回 `EOF`，当前工作区没有本地缓存的精确镜像。该结果是环境 `BLOCKED`，不是业务测试 `FAIL`。

边界：exact-head GitHub Actions 已对同一 PR head 给出 `verify=success`；本地阻塞不覆盖该远端证据，也不把未实现的 IM-03 业务能力提升为 `PASS`。

## 4. 验证记录

| 检查 | 实际结果 | 状态 |
|---|---|---|
| `git diff --check origin/main...HEAD` | 无输出 | `PASS` |
| `pnpm format:check` | All matched files use Prettier code style | `PASS` |
| `pnpm lint` | 退出码 0 | `PASS` |
| `pnpm typecheck` | `tsc -b --pretty false` 退出码 0 | `PASS` |
| `pnpm test` | 20 个文件通过、10 个跳过；341 个测试通过、164 个跳过 | `PASS` |
| `pnpm architecture` | `architecture_boundaries=PASS source_roots=10` | `PASS` |
| `pnpm contracts:check` | operations/catalog/registry 均为 200；Schema `FULL=200`；compatibility findings=0 | `PASS` |
| `.vibe` Markdown link check | 144 个文件、195 个相对链接、缺失目标 0（包含本审查工作记录） | `PASS` |
| PR #69 exact-head CI | run `32795729365`，head `9c02ac8`，`verify=success` | `PASS` |
| 当前本地 `pnpm verify` | persistence gate 在 Docker Hub manifest 查询处 `EOF` | `BLOCKED` |
| Issue #56–#68 local-vs-remote body comparison | #56、#58–#68 一致；#57 在同步前多一个本地决策段 | `REMEDIATION REQUIRED` |

## 5. 未运行与不变边界

- Product/QMS/Profile/ProductScope/Platform Reference 的业务 Handler、Repository、业务 DDL、真实业务 PostgreSQL、RLS/CAS/幂等/Audit/Outbox 运行验证：`NOT RUN`。
- 从空库创建 Enterprise/Product/QMS/Profile/ProductScope/Project 并重放旧 Snapshot 的业务 E2E：`NOT RUN`。
- Platform Reference 导入/发布、TemplateBaseline/RegulatoryProfile 精确引用、Gap stale/Impact Process：`NOT RUN`。
- 对象存储、外部 Provider、真实飞书/Runtime/Renderer 和人工“采购控制程序”验收：`NOT RUN`。

## 6. 后续收尾顺序

1. 用户检查本记录、三份规格/测试同步和两份交付记录。
2. 用户确认后，暂存本次审查范围，执行 staged diff/check 并使用英文 commit message 提交。
3. 非强制 push 后，以 `--match-head-commit` 语义复核 PR #69 的新 head 和 CI。
4. 在 PR comment 写入本记录对应的修订、验证和边界。
5. 合并 PR #69，fetch 默认分支并验证 PR head 是默认分支祖先。
6. 用 `.vibe/im-03-workitem-issues/issues/01-contract-decision-gate.md` 同步 Issue #57 body，再比较远端 body，最后关闭 Issue #57 并回读 state。
