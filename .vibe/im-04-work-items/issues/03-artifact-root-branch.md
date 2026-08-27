## Status

`PLANNED / NOT STARTED`

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

- [ ] Artifact identity is distinct from files, revisions, representations, agent outputs, and release packages.
- [ ] Enterprise/Project scope is immutable and cross-scope references are rejected without enumeration leakage.
- [ ] Duplicate create replay is idempotent; same key/different payload and duplicate scoped identity produce stable conflicts.
- [ ] Metadata updates require expected aggregate version and cannot alter scope or historical references.
- [ ] Archive preserves all rows and facts, prevents new mutable work, and does not delete or rewrite history.
- [ ] RLS, rollback, direct-write denial, clean migration, no-op migration, focused tests, and full gates pass.

## Manual output

Provide a synthetic ART-023 root walkthrough showing create, exact metadata read, successful CAS update, stale CAS rejection, cross-project rejection, archive, prohibited post-archive mutation, exact IDs/versions, and database cleanup.

## Non-goals and NOT RUN

- No Canonical Content Object, sealed Revision, merge, Diff, Representation, Quality, Approval, Release, or renderer implementation.
- No production object storage, provider, public HTTP E2E, production database, or real business acceptance.
