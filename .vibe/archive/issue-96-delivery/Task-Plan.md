> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-96-delivery/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-96-delivery/Task-Plan.md).

# Issue #96 交付计划

状态：`DELIVERED / PR #114 MERGED / ISSUE #96 CLOSED / FEATURE BRANCH DELETED`

## 目标与边界

交付 IM-04 WI-07 的最小 WorkbookSpec 业务切片：稳定 Sheet/Column/Row/Cell 身份与顺序校验、基于精确 SEALED Revision 的受限 Human Edit，以及两个精确 Revision 间可重建的确定性内部 Diff。

本切片不新增公开 Diff Result Operation，不实现 Excel 计算引擎、宏、外部链接、透视表、XLSX 版式保真、Renderer、Quality/Approval/Release、Provider、公开 HTTP E2E、生产或真实业务验收。

## 权威输入

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/module-specs/Module-Spec-004-Artifact.md`
- `.vibe/module-tests/Module-Test-004-Artifact.md`
- `.vibe/archive/im-04-work-items/issues/07-workbook-edit-diff.md`
- GitHub Issue #96
- 已合并的 Issue #90 Canonical Schema/Hash 基础与 Issue #94 Revision DAG/CAS 基础

## 假设与取舍

- Workbook Human Edit 是 Artifact 内部应用服务，不扩展当前 201 项公开 Catalog。
- Human Edit 必须以精确 base Revision Ref、可信 Scope 和显式 allowed stable IDs 授权；Excel 坐标不是业务身份。
- 成功编辑创建新的 Canonical Content Object 和不可变 Revision，并以 Branch Head CAS 防止 stale base；拒绝路径不得留下对象、Revision、Receipt、Outbox 或孤立业务链接。
- Diff 只读取两个精确 Revision 的已冻结 Workbook 内容，按稳定 ID 报告 `ADDED`、`REMOVED`、`CHANGED`、`MOVED`，结果可重建且不持久化为业务事实。

## 执行与验证

1. 订正 HL-Spec、Artifact Module Spec 与 Module Test，冻结 WI-07 的输入、输出、错误语义和测试矩阵。
   - 验证：文档明确 stable IDs、规则边界、Human Edit 原子性、Diff 确定性和 `NOT RUN`。
2. 先新增失败回归，再实现最小 Workbook validation/canonicalization、Human Edit 与 Diff 服务。
   - 验证：重复 ID/ordinal、跨 Sheet 引用、value/formula、未知 required extension、畸形规则、Excel 坐标替代、越权 stable ID、stale base 和 exact-ref mismatch 均稳定拒绝。
3. 复用现有 V4000-V4003 Persistence、Artifact 事务、Content Object、Revision 与 Branch CAS，不为应用层 Workbook 规则新增业务表或 Migration。
   - 验证：空库 migration 成功、第二次 migration 明确 no-op；合法 edit 原子创建新 Object/Revision，拒绝路径无新 Revision；既有 RLS/ACL 回归通过。
4. 生成合成 Workbook 手工输出与 Verification Report。
   - 验证：记录 canonical bytes/hash、stable ID map、允许编辑、跨 Sheet 拒绝、before/after exact refs、确定性 Diff、replay 与 cleanup；数据标注为技术夹具。
5. 执行 focused tests、`pnpm clean && pnpm verify`、`git diff --check`，审查全部任务相关变更。
   - 验证：自动 Gate 全部通过；外部/生产/人工边界保持 `NOT RUN`。
6. 提交 `.vibe` 交付记录与实现，非强制推送；创建关联并关闭 #96 的 PR，等待精确 HEAD CI 后以 `--match-head-commit` 合并。
   - 验证：PR/Issue 状态回读、实现 HEAD 为 `origin/main` 祖先、远端和本地任务分支安全清理、无陈旧交付状态文案。

## 手工可检查产出

- 一份合成 Workbook fixture 的 canonical bytes 与 SHA-256。
- Sheet/Column/Row/Cell stable ID 对照表。
- 合法 Cell Edit 与非法 cross-sheet reference 的输入和实际输出。
- before/after Revision 精确引用与确定性 Diff 表。
- 幂等 replay 与测试环境 cleanup 结果。
