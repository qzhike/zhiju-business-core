## Status

`PLANNED / NOT STARTED`

Issue creation is planning only. No IM-04 development branch, worktree, contract, migration, repository, handler, fixture, or renderer is created by this issue.

## Goal

This is the IM-04 Artifact + Canonical Content parent exit gate. It closes only after every child work item is merged into `main`, reviewed on its exact head, and verified against the authoritative specifications and executable evidence.

## Authority

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/high-level-docs/02-zhiju-core-architecture.md`
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`
- `.vibe/module-specs/Module-Spec-004-Artifact.md`
- `.vibe/module-tests/Module-Test-004-Artifact.md`
- `.vibe/im-04-startup/Review-Record.md`
- `.vibe/im-04-spec-review-im03-closeout/Review-Report.md`

## Preconditions

- [x] #56 is closed with scoped technical acceptance; its preserved `NOT RUN` boundaries remain in force.
- [x] IM-DG-005 is user-approved.
- [x] The IM-04 specification re-review is `PASS AFTER DOCUMENT REPAIR`.
- [ ] All child work items below are closed and their effective PR heads are ancestors of `main`.

## Child work items

- [ ] #90 — WI-01 Freeze executable Canonical schemas, hash fixtures, and RenderAttempt binding contract
- [ ] #91 — WI-02 Establish Artifact Application/Persistence transaction foundation
- [ ] #92 — WI-03 Implement Artifact root, metadata, branch identity, and archive lifecycle
- [ ] #93 — WI-04 Implement Canonical content-object staging, link, freeze, and orphan cleanup
- [ ] #94 — WI-05 Implement immutable revisions, lineage DAG, branch CAS, and explicit merge
- [ ] #95 — WI-06 Implement Structured Document Human Edit and deterministic internal Diff
- [ ] #96 — WI-07 Implement WorkbookSpec Human Edit and deterministic internal Diff
- [ ] #97 — WI-08 Implement Representation registration with authoritative RenderAttempt binding
- [ ] #98 — WI-09 Deliver authoritative queries, synthetic ART-023 evidence, and exit-gate review

## Milestone scope

- additive RenderAttempt Binding Query contract gate
- Canonical Document and WorkbookSpec executable schemas and cross-language hash fixtures
- Artifact root, branch identity, immutable revisions, lineage, merge, and CAS head movement
- Artifact-owned Content Object Manifest with staging, validation, link, freeze, quarantine, and orphan cleanup
- Structured Document and WorkbookSpec Human Edit with deterministic internal Diff
- Representation registration bound to an authoritative successful RenderAttempt
- authoritative Artifact queries and a synthetic ART-023 technical acceptance fixture

## Exit acceptance

- [ ] Every child issue is closed after exact-head review and CI success.
- [ ] Clean migration and second no-op migration pass; applied migrations are never edited in place.
- [ ] Unit, Contract, Persistence, and scoped E2E tests record input, expected output, actual output, and cleanup.
- [ ] Canonical hash, immutable revision, same-Artifact DAG, project scope, RLS, idempotency, rollback, CAS race, and orphan behavior have direct negative evidence.
- [ ] Public Catalog changes are limited to the explicitly reviewed additive RenderAttempt Binding Query; no public Diff Result operation is introduced implicitly.
- [ ] The synthetic ART-023 walkthrough exposes exact IDs, versions, hashes, branch heads, diffs, attempts, checksums, and expected rejections without claiming real business applicability.
- [ ] Authority documents and `.vibe` closeout records match the final `main` state before this issue is closed.

## Manual output

Provide a repeatable, secret-free ART-023 walkthrough using synthetic Structured Document and WorkbookSpec content. A reviewer must be able to inspect immutable revision hashes, branch divergence, explicit merge, stable-unit diff, object-manifest lifecycle, Representation binding, expected rejection outputs, and cleanup.

## Non-goals and NOT RUN

- DOCX/XLSX/PDF renderer implementation and layout/openability acceptance belong to IM-05.
- Quality Gate, Approval, Release, formal publication, Feishu channel, and CLI runtime are not implemented here.
- Real Ceph RGW/OpenBao, production deployment, real providers, public HTTP E2E, integrated later-module business E2E, real customer applicability, and independent business acceptance remain `NOT RUN` unless separately evidenced.
- Closing child issues does not automatically close this parent exit gate.
