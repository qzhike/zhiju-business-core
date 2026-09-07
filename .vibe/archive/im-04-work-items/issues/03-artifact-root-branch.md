> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/03-artifact-root-branch.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/03-artifact-root-branch.md).
> Published Issue: [#92](https://github.com/qzhike/zhiju-business-core/issues/92); this file is a historical draft, not its current body.

## Status

`IMPLEMENTATION COMPLETE / PERSISTENCE VERIFIED 2026-08-28 / TEST PLAN FROZEN 2026-08-28 / GIT DELIVERY COMPLETE PR #104 MERGED 2026-08-28 / ISSUE #92 CLOSED 2026-08-28 / FEATURE BRANCH DELETED`

Parent exit gate: #89.

## Goal

Implement the Artifact long-lived identity, metadata lifecycle, branch identity, approved/effective pointer placeholders, and archive boundary without introducing revision content yet.

## Authority

- Artifact Module Spec commands for create, metadata update, head movement prerequisites, and archive
- Artifact logical model `artifact`, `artifact_branch`, and binding identity rules
- #91 transaction foundation

## Dependencies

- #91 merged and closed
- #89 parent exit gate

## Deliverables

- forward-only Artifact business-root migration and repository
- create Artifact and metadata-update handlers using the public contract and authoritative scope validation
- stable default branch identity and branch-name uniqueness
- archive lifecycle that preserves history and blocks prohibited future mutations
- exact query/read model for Artifact metadata and aggregate version
- Unit, Contract, Persistence, RLS, idempotency, CAS, and rollback evidence

## Acceptance

- [x] Artifact identity is distinct from files, revisions, representations, agent outputs, and release packages.
- [x] Enterprise/Project scope is immutable and cross-scope references are rejected without enumeration leakage.
- [x] Duplicate create replay is idempotent; same key/different payload and duplicate scoped identity produce stable conflicts.
- [x] Metadata updates require expected aggregate version and cannot alter scope or historical references.
- [x] Archive preserves all rows and facts, prevents new mutable work, and does not delete or rewrite history.
- [x] RLS, rollback, direct-write denial, clean migration, no-op migration, focused tests, and standalone Persistence Gate pass.

## Manual output

Automated Persistence evidence provides a synthetic ART-023 root walkthrough showing create, exact metadata read, successful CAS update, stale CAS rejection, cross-project rejection, archive, prohibited post-archive mutation, exact versions, and database cleanup. Independent manual acceptance of the walkthrough remains `NOT RUN`.

## Non-goals and NOT RUN

- No Canonical Content Object, sealed Revision, merge, Diff, Representation, Quality, Approval, Release, or renderer implementation.
- No production object storage, provider, public HTTP E2E, production database, or real business acceptance.

## WI-03 implementation decisions

- 当前公开创建 Contract 没有独立 `displayCode` 或业务键；实现使用 `businessScope + exact scope + artifactType + initial title` 的 canonical `identity_hash` 作为创建时的 scoped identity。标题后续可更新，但不重算已持久化的 identity hash。
- 默认 Branch 名称固定为 `main`，创建时一次生成 UUIDv7；没有 Revision 时工作头为空、`head_version=0`。本切片不实现 Revision 或工作头移动。
- Project Deliverable 必须携带 trusted Context 允许的 exact Project ObjectRef；Enterprise Controlled Root 的 `project_id` 为空。Artifact 不跨 Schema 读取 EnterpriseProject，DeliveryItem/Origin Ref 只做 Scope 与 shape 校验。
- Artifact Root/Branch 的业务写权限通过 owning security-definer boundary 收口；`artifact_app` 不直接拥有 UPDATE/DELETE。Metadata Update 与 Archive 均要求 expected aggregate version，Archive 保留所有历史行并阻止后续 mutable work。
- 当前只使用已注册的 `artifact.ArtifactCreated@1.0` 公开事件；MetadataUpdated/Archived 先作为 owning outbox 内部事件，不扩展公开 Catalog。

## Verification boundary

- 最终独立 `pnpm persistence:gate` 已在 PostgreSQL 18.6 / Flyway 11.20.3 上通过 23 个 Persistence 文件、272 个测试；V4001 空库迁移、二次 no-op、Project/Enterprise Controlled Root/Branch、RLS、幂等、CAS、Archive、Rollback、ACL 和 Project Root 空 Origin owner-boundary 拒绝证据均通过，容器已清理。
- 完整 `pnpm verify` 的 Format、Lint、Typecheck、Unit（27 files / 371 passed / 257 skipped）、Architecture 和 Contracts（201/201 FULL）通过；末尾 Persistence 阶段因 Docker Hub token 请求 `EOF` 未启动，该次不记为完整 PASS，但独立 Persistence Gate 已真实通过。
- 实现提交 `5cb4d1b4e97c4062de99ff66d5d357c0d47209e6` 已 non-force push，并通过 PR #104 以 merge commit `9d7cb06128680bc141548115f347884aee813412` 合并到 `main`；Issue #92 已关闭，远端和本地 feature branch 已删除。Parent #89 Exit Gate 仍是独立后续边界，尚未执行。
