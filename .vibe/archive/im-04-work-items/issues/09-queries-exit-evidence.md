> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/09-queries-exit-evidence.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/09-queries-exit-evidence.md).
> Published Issue: [#98](https://github.com/qzhike/zhiju-business-core/issues/98); this file is a historical draft, not its current body.

## Status

`GIT DELIVERY COMPLETE / PR #117 MERGED / ISSUE #98 CLOSED`

Parent exit gate: #89.

## Goal

Complete authoritative Artifact queries, assemble the synthetic ART-023 technical walkthrough, verify all IM-04 invariants on exact delivered heads, and prepare the parent exit-gate evidence without starting later milestones.

## Authority

- Artifact Module Spec public Query contracts and manual output
- Artifact Module Test complete IM-04 matrix
- IM-04 parent exit gate #89
- delivered behavior from #92 through #97

## Dependencies

- #92, #93, #94, #95, #96, and #97 merged and closed；对应有效 PR head 均已验证为 `origin/main` ancestor
- #89 parent exit gate

## Deliverables

- authoritative Artifact, exact Revision, lineage, diff-input, Representation, and applicable binding queries
- fail-closed scope/hash/disposition validation and deterministic pagination where applicable
- a secret-free synthetic ART-023 Document/Workbook fixture and repeatable runbook
- parent-level Unit/Contract/Persistence/scoped-E2E mapping with actual output and cleanup
- exact-head review, default-branch ancestry, migration/no-op, full-gate, and residual-risk records under `.vibe`
- a truthful parent #89 closeout recommendation; this WI must not auto-close the parent

## Acceptance

- [x] Queries never resolve `latest/current`, bypass scope, trust caller hashes, expose quarantined object locators, or read another module repository.
- [x] Lineage and exact revision replay remain stable after later branches, merge, withdrawal, invalidation, or new representations；治理后的派生 disposition 可改变 `lineageHash`，但 node/edge/content identity 不变。
- [x] Diff input query returns only exact snapshots/common ancestor/schema input; internal Diff output is separately computed and never persisted as approval/quality fact.
- [x] ART-023 shows root, frozen object manifests, divergent revisions, stale-head rejection, explicit merge, Document and Workbook edits/diffs, authoritative RenderAttempt binding, Representation, expected negatives, and cleanup.
- [x] Clean/no-op migration, focused Unit/Contract/Persistence tests, scoped local E2E, `pnpm clean && pnpm verify`, exact-head CI, and `.vibe` review records pass.
- [x] Parent #89 is closed only after all child PR heads are ancestors of `main` and authority documents match remote state.

本地 Gate 已完成：focused Artifact Unit/Contract 为 6 files/69 passed；普通 Vitest 为 32 passed/24 skipped files、390 passed/269 skipped tests；Architecture PASS；公开 Contract `FULL=201`、frozen v1.0 baseline=200；pinned PostgreSQL 18.6/Flyway 11.20.3 Persistence 为 28 files/284 passed，空库迁移、第二次 no-op 与容器 cleanup 通过。实现 head `8e58fa18ee50726252ca38542b6de1afdfbb4310` 已通过 PR #117 exact-head `ci/verify`，并以 merge commit `f4b8704ba766d49c12c4433884d94bce91d50792` 合入 `main`；Issue #98 已关闭，实现 head 是 `origin/main` ancestor。父 Issue #89 保持开放，本工作项不自动关闭它。

## Manual output

Provide one reviewer-readable ART-023 report with exact object/revision/branch/attempt/representation IDs, versions and hashes; expected versus actual output for every step; stable negative error codes; environment; commands; timestamps; and cleanup. Clearly label it `SYNTHETIC / TECHNICAL ONLY`.

本次 automated exact output 已汇总至 [`../../../issue-98-delivery/Manual-ART-023.md`](../../issue-98-delivery/Manual-ART-023.md)；独立人工业务复核保持 `NOT RUN`。

## Non-goals and NOT RUN

- No renderer implementation or Office layout/openability acceptance; those belong to IM-05.
- No Quality Gate, Human Approval, Release, formal publication, Feishu, CLI runtime, or later-module integrated business flow.
- Real Ceph RGW/OpenBao, providers, public HTTP E2E, production deployment, real customer applicability, and independent business acceptance remain `NOT RUN` unless separately authorized and evidenced.
