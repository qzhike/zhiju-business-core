# Issue #93 交付计划

日期：2026-08-28
Issue：`[IM-04][WI-04] Implement Canonical content-object staging, link, freeze, and orphan cleanup`
工作区：`im-04-wi-04-implement-canonical-content-object-s`

## 目标

在不提前实现 Revision、Representation、Renderer、Provider 或公开 HTTP E2E 的前提下，完成 Artifact-owned Canonical Content Object Manifest 的 staging、校验、业务 link、finalize/freeze、quarantine 与 orphan cleanup 持久化边界，并用真实 PostgreSQL 负向证据覆盖 Issue #93 的验收条件。

## 冻结边界

- 使用 forward-only `V4002`；不修改已应用的 `V4000`/`V4001`。
- `artifact_content_object` 的生命周期为 `STAGING -> LINKED -> FROZEN`；`STAGING/LINKED -> QUARANTINED`；`FROZEN` 不可变。
- 本 WI 只建立未来 `ArtifactRevision` 所需的精确 link 记录，不创建 Revision 表或 Revision Handler。
- Object Storage 通过可替换 Port 接入；本地与 CI 使用 deterministic in-memory adapter，不声明真实 Ceph RGW/OpenBao/生产加密符合性。
- Canonical bytes、Schema、媒体类型、大小与 SHA-256 必须以 authoritative readback 重算/校验；caller locator、caller hash 与 storage metadata 不具权威性。
- PostgreSQL 事务提交与对象存储 finalize 分离：DB link 成功后才允许 finalize；finalize 未确认时保持 `LINKED`，不得 freeze。
- orphan cleanup 使用 24 小时 grace、5 分钟 lease、指数重试（5 分钟起、24 小时封顶）、retention/legal-hold/reverse-link 检查、fencing token 和审计。
- 日志、Audit、Outbox 与测试输出不泄漏原始 payload、对象 locator 或秘密。

## 交付步骤与证据

1. 同步 `HL-Spec.md`、Artifact Module Spec、Module Test、PostgreSQL logical model、Deployment Security Baseline，并冻结 Issue #93 的实现与手工验收矩阵。
2. 实现 Artifact persistence types/repository、Object Storage Port/local adapter、Content Object service、`V4002` migration 与最小导出面。
3. 增加 Unit/Contract 与真实 PostgreSQL Persistence 用例：生命周期、hash/readback tamper、Scope/RLS/ACL、rollback orphan、finalize gate、cleanup lease/fencing/retry/legal-hold/idempotency。
4. 顺序执行 format/lint/typecheck/test、pinned PostgreSQL persistence gate、`git diff --check`，并记录每项 PASS 或 NOT RUN。已完成：`pnpm lint`、`pnpm typecheck`、Artifact build、focused Unit 回归、`pnpm persistence:gate` 和 `git diff --check` 均通过。
5. 已创建 `.vibe/issue-93-delivery/Verification-Report.md`；实现提交 `bd414cec...` 已推送并由 PR #106 以 exact head 合入 `main`。
6. 已读回 PR #106 `MERGED`、Issue #93 `CLOSED/COMPLETED`、merge commit `599e59d...`、`origin/main` ancestry，以及远端/本地 feature branch 删除结果；当前文档状态通过本 docs-only follow-up 同步，不改写已发布历史。

## 明确不在本次自动验收范围

真实 Ceph RGW/OpenBao conformance、生产对象加密/Object Lock、生产 cleanup scheduler、备份恢复、Revision/Representation/Renderer、Quality/Approval/Release、公开 HTTP、跨模块 E2E、生产数据库和独立人工业务验收均保持 `NOT RUN`，除非后续另有明确授权与环境证据。
