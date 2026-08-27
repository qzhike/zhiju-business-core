## Status

`PLANNED / NOT STARTED`

Parent exit gate: #89.

## Goal

Implement immutable Artifact revisions, same-Artifact lineage DAGs, branch-head CAS, explicit merge revisions, conflict records, and governance disposition without rewriting sealed content.

## Authority

- Artifact Module Spec RevisionContent, MergeDefinition, command contracts, and invariants
- Artifact logical model revision, parent, conflict, and invalidation relations
- #92 Artifact root/branch lifecycle and #93 frozen Content Object Manifest

## Dependencies

- #92 merged and closed
- #93 merged and closed
- #89 parent exit gate

## Deliverables

- forward-only Revision, parent, conflict, invalidation, withdrawal, and branch-head migration/repositories
- create-and-seal and explicit merge handlers using only same-scope FROZEN Manifest inputs
- recursive DAG validation and parent-count enforcement
- branch-head expected-ref/version CAS with deterministic concurrency conflicts
- immutable revision snapshot and lineage queries
- Unit, Contract, Persistence, race, RLS, idempotency, rollback, and history-replay tests

## Acceptance

- [ ] Initial revisions have zero parents, ordinary revisions have exactly one, and merge revisions have at least two same-Artifact parents.
- [ ] Cross-Artifact/Project parent, `latest/current`, wrong hash, non-FROZEN content, duplicate parent, cycle, and unresolved conflict inputs are rejected.
- [ ] SEALED content identity, parents, provenance, and semantic metadata cannot be updated; withdrawal/invalidation append governance facts only.
- [ ] Two writers using one expected branch head produce one success and one stable conflict; neither branch history is lost.
- [ ] Merge conflicts and Human resolutions are explicit; no last-write-wins path exists.
- [ ] Exact revision and lineage queries replay historical hashes and parents after later drafts, withdrawal, or invalidation.
- [ ] Clean/no-op migration, real PostgreSQL negative/race probes, full gates, and cleanup pass.

## Manual output

Provide a synthetic ART-023 DAG: REV-001, two divergent branch revisions, stale-head rejection, explicit conflict set and Human resolution, merge revision, exact parent/hash table, immutable-update rejection, and cleanup.

## Non-goals and NOT RUN

- No Structured Document/Workbook editing semantics, Diff computation, Representation, renderer, Quality, Approval, Release, public HTTP E2E, production database, or real business acceptance.
