# Issue #94 交付计划

日期：2026-08-29

## 目标

在不修改已应用迁移和不扩展公共 Catalog 的前提下，交付 IM-04 WI-05：Immutable Artifact Revision、同 Artifact Lineage DAG、Branch Head CAS、显式 Merge/Conflict、Withdrawal/Invalidation 治理事实、精确历史 Query，以及可重复的 ART-023 手工输出。完成后按用户授权继续执行 PR、Issue 和本地/远端 feature branch 的独立收口。

## 已冻结假设

1. 现有 `artifact.create_and_seal_revision`、`artifact.create_merge_revision`、`artifact.move_working_head`、治理 Command 和 Revision Query Contract 已覆盖 Issue #94，不新增公开 Operation 或修改历史 compatibility baseline。
2. `ContentAddressedRef.objectId` 使用 Revision UUIDv7，`contentHash` 是数据库保存的 32-byte SHA-256；不引入 `latest/current` 兼容路径。
3. Branch 创建继续复用 WI-03 已存在的 Branch owning boundary；并发测试用同一 Artifact 的共同祖先和两个候选 Revision 证明分叉与 stale-head 冲突，不新增公共创建分支 API。
4. Revision 只能消费 WI-04 已进入 `FROZEN` 的 Canonical Content Object Manifest；数据库只保存不可变身份快照，不保存 Canonical body。

## 执行顺序与可验证产出

1. 同步 HL-Spec、Artifact Module Spec、Module Test、PostgreSQL logical model 和本计划。产出：实现边界、错误语义、测试输入/预期输出和 `NOT RUN` 边界可审查。
2. 新增 forward-only `V4003` 与 owner-boundary Repository：Revision/Parent/Conflict/Governance Fact、FROZEN 门禁、DAG 校验、immutable ACL/trigger、Branch CAS。产出：空库迁移、二次 no-op、真实 PostgreSQL 负向/竞态证据。
3. 实现 create/seal、merge、head move、withdraw/invalidate Handler 和精确 Snapshot/Lineage/Diff Inputs/Validation Query。产出：同 Scope Revision DAG、稳定错误码、幂等/rollback/outbox/reference evidence。
4. 增加 Unit、Contract、Persistence、race、RLS、idempotency、rollback、history replay 和 ART-023 fixture/test。产出：测试文档中的输入、预期、实际输出和命令证据。
5. 执行 focused gate、`pnpm verify`、`pnpm persistence:gate`、`git diff --check`，清理本次生成的临时测试脚本/容器/文件。产出：`.vibe/issue-94-delivery/Verification-Report.md` 与可供人工检查的 `Manual-ART-023.md`。
6. 代码与文档完成后暂停，请用户检查变更；收到确认后才 commit。随后独立核验 exact PR head、CI、merge、Issue close、`origin/main` ancestry、本地 branch 删除、远端 branch 删除和 worktree 清理，并把状态回读写入交付记录。

## 当前状态

实现、规格/测试文档和本地自动验证已完成；`Verification-Report.md` 已记录 `pnpm verify`、`pnpm build` 和 pinned PostgreSQL/Flyway Gate 的结果，`Manual-ART-023.md` 已准备人工检查表。用户已确认，PR #110 已合并、Issue #94 已关闭、原 feature branch 已删除；本文件的最终状态通过不关联 Issue #94 的 docs-only follow-up 同步。

## 非目标

Structured Document/Workbook 编辑语义、Diff 计算、Representation、Renderer、Quality、Approval、Release、公开 HTTP、生产数据库、真实 Provider、跨模块 E2E 和独立人工业务验收不因本 Issue 变为 PASS；缺少直接证据时继续记录 `NOT RUN`。
