> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-06-customermaterial/Task-Execution.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-06-customermaterial/Task-Execution.md).

# IM-03 WI-06 CustomerMaterial 执行记录

## 目标

完成 GitHub Issue #62：实现 CustomerMaterial 提议、版本化确认与来源选择，保留 Project 边界、SourceMaterial 接受状态、Human/Agent 权限、证据与决定可追溯性，并完成文档、测试和 GitHub Issue/分支交付核验。

## 当前边界

- Issue：[#62](https://github.com/qzhike/zhiju-business-core/issues/62)
- 实现分支：`galendai/im-03-wi-06-customermaterial`（已删除）
- 最终默认分支：`main`，merge commit=`e7cfee1`
- 当前状态：实现、验证、exact-head PR、合并、Issue 关闭、远端/本地 feature branch 删除和默认分支同步均已完成。

## 执行计划

1. 读取 HL-Spec、EnterpriseProject Module Spec/Test、相关数据库迁移与现有 SourceMaterial 实现，建立可验证契约矩阵。
2. 先补齐本模块设计与测试文档，再以最小改动实现 Migration、Repository、Handler、Registry/API 与测试。
3. 运行静态、契约、模块及真实 PostgreSQL 分层验证，记录 PASS 与 NOT RUN 边界。
4. 用户确认变更后，提交、推送并创建/核验 exact-head PR；CI 通过后关闭 Issue、删除已合并分支并同步默认分支。`PASS`

## 证据记录

| 项目 | 状态 | 证据 |
|---|---|---|
| Worktree/分支基线 | PASS | 2026-08-26：实现 commit=`3141928`，merge commit=`e7cfee1`；最终 `main` 与 `origin/main` 同步 |
| Issue #62 | CLOSED | GitHub API：Issue #62 已读取为 `closed`；closeout comment 已读回 |
| 权威设计同步 | PASS | 2026-08-26：HL-Spec、Module-Spec-002、Module-Test-002 已写入 WI-06 版本/状态/字段/场景边界；详见 `Design-Notes.md` |
| 实现与测试 | PASS | 2026-08-26：V2007、Repository、Handler、类型导出和 `customer-material.test.ts` 已落地；`pnpm test` 为 22 个文件通过、13 个文件跳过，`349 passed / 211 skipped` |
| 静态/契约/架构检查 | PASS | 2026-08-26：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check` 全部通过；公共 Catalog/Registry 保持 `200/200` |
| 真实 PostgreSQL 验证 | PASS | 2026-08-26：`pnpm persistence:gate` 使用 PostgreSQL 18.6/Flyway 11.20.3；空库迁移、二次 no-op、16 个文件 `225 passed`、容器清理通过；覆盖 RLS、CAS、不可变、幂等、冲突和回滚边界 |
| PR #75 exact-head CI/合并 | PASS | head=`3141928df48b3be097ff554bc7b96ee933d727c1`；GitHub Actions `verify` 通过；merge commit=`e7cfee14b699b0574abf6899a0291bc9ea706f90` |
| Branch 与默认分支 | PASS | 远端/本地 `galendai/im-03-wi-06-customermaterial` 已删除；`main` 已 fast-forward 到 `e7cfee1`；实现 commit 是 `main` ancestor |

## 交付约束

- 业务设计、开发、测试文档使用中文；代码注释、Commit Message 和外部 GitHub 文档使用英文。
- 每次代码变更前同步 HL-Spec、Module Spec 与 Module Test 文档。
- 不把静态检查、Disposable PostgreSQL 或 Agent 探针冒充 Provider、生产、HTTP/E2E 或人工验收；未执行项保留 `NOT RUN`。
- Issue 关闭、PR 合并、远端分支删除和默认分支同步分别核验，不从一个状态推断另一个状态。

## 2026-08-26 实现与验证摘要

- `migrations/enterprise_project/V2007__customer_material_proposal_confirmation.sql` 新增 CustomerMaterial Root、不可变 Version/Decision、受控 Root CAS、复合 Scope FK、FORCE RLS 和 app-role 最小写权限。
- `customer-material-handlers.ts` 实现 SourceMaterial 精确 ContentAddressedRef 校验、接受状态/hash 校验、Human-only 确认、冲突拒绝、v2 追加确认、Reference Edge、Receipt/Audit 和最小 `CustomerMaterialConfirmed` Outbox。
- 真实 PostgreSQL 场景已验证：合法 Proposal → Human Confirm、Agent/`actingFor` 拒绝、跨 Project/错误 hash/伪造 immutable version 拒绝、共享 Source 冲突、RLS 隔离、stale CAS、Version/Decision UPDATE/DELETE 拒绝、Proposal/Confirm 幂等 Replay 与 payload conflict。
- 执行后无测试遗留脚本、临时数据或 gate 容器；真实 Provider、外部对象存储、安全扫描、公开 HTTP、跨模块 E2E、生产和人工验收仍为 `NOT RUN`。

## 2026-08-26 GitHub 交付结果

- PR [#75](https://github.com/qzhike/zhiju-business-core/pull/75) 已以 exact head `3141928df48b3be097ff554bc7b96ee933d727c1` 合并到 `main`，merge commit 为 `e7cfee14b699b0574abf6899a0291bc9ea706f90`。
- Issue [#62](https://github.com/qzhike/zhiju-business-core/issues/62) 已关闭，closeout comment 为 [issuecomment-5420158225](https://github.com/qzhike/zhiju-business-core/issues/62#issuecomment-5420158225)。
- 远端和本地 Work Item feature branch 已删除；默认分支已同步。此执行记录中的 `OPEN`、`尚未创建 PR` 和“等待用户确认”的描述均仅属于提交前快照，不再代表当前状态。
