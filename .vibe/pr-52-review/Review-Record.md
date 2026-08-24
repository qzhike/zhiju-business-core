# PR #52 精确 head 复审记录

日期：2026-08-24  
仓库：`qzhike/zhiju-business-core`  
PR：[ #52 ](https://github.com/qzhike/zhiju-business-core/pull/52)  
审查 head：`70ad21c59d6580c37e6ef0a5032d3fb24a88fb62`  
审查 base：`main`，base head `8f5c0701ace93ce88ec55acde753e5abcd07fa2c`  
结论：`PASS / NO NEW SEMANTIC FINDINGS / MERGE-READY AFTER DOCUMENTATION COMMIT`

## 1. 审查范围

本次复审直接针对 PR #52 的最新精确 head，确认变更只覆盖：

- `tools/persistence/gate.mjs`：Persistence Gate 启动 Vitest 时增加 `--no-file-parallelism`。
- `.vibe` 验收、模块规格/测试、整体里程碑与合并后失败记录：同步根因、结果和退出边界。

没有修改 Migration、IdentityPolicy 运行时代码、角色/ACL 定义、RLS Policy、公开 API、测试断言逻辑或外部 Provider。

## 2. 语义检查

| 检查项 | 实际结果 |
|---|---|
| 根因是否与失败证据一致 | `PASS`；WI-10 的共享 `identity_policy_app` ACL 撤销与 WI-09 DENY Audit 写入存在文件级并行竞态 |
| 修复是否改变生产权限 | `PASS`；只改变 Gate 测试文件执行调度，不新增授权、不编辑已应用 Migration |
| WI-10 失败反例是否保留 | `PASS`；`messaging.test.ts` 仍临时撤销 INSERT 并验证 resume 失败后事件保持 `DEAD` |
| WI-09 DENY Audit 语义是否保留 | `PASS`；Decision Port 和同事务 `audit_record` 写入未改动 |
| 关闭边界是否准确 | `PASS`；PR #52 不自动关闭 Issue #28，合并后仍要求干净 `main` 复验；外部/生产/人工项保持 `NOT RUN` |
| 文档是否记录失败而非覆盖历史 | `PASS`；新增 `Main-Closeout-Failure-2026-08-24.md`，并同步 HL-Spec、Module Spec/Test、整体进度和验收报告 |

## 3. 验证证据

- GitHub Actions exact-head `verify`：`SUCCESS`，run `32741887152`，耗时 `2m08s`。
- 修复分支独立 `pnpm persistence:gate`：连续两次 `12 files / 177 tests PASS`；二次 migrate no-op；迁移全部 `Success`；容器清理。
- 修复分支静态与常规验证：format、lint、typecheck、Vitest `20 passed | 10 skipped` / `341 passed | 164 skipped`、architecture、Public API、generated types、Catalog/Registry、compatibility 均通过。
- Local Probe：WI-06、WI-07、WI-10 在锁定 PostgreSQL 18.6/Flyway 11.20.3 临时容器中串行通过，容器已删除。
- 曾有额外本地完整编排在 Docker Registry tag-digest 网络校验处被 `EOF` 阻断；该次未进入测试，不记为 PASS。GitHub exact-head `verify` 已补足远端完整编排证据。

## 4. 复审结论

未发现新的代码或语义问题。PR #52 可使用 `--match-head-commit 70ad21c59d6580c37e6ef0a5032d3fb24a88fb62` 合并。合并后必须从新的 `main` checkout 重跑 `pnpm install --frozen-lockfile`、`pnpm clean && pnpm verify`、独立 Persistence Gate 和必要的 local Probe；在这些证据完成前不得关闭 Issue #28。
