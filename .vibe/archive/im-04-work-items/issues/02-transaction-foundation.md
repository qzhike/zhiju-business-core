> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/02-transaction-foundation.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/02-transaction-foundation.md).
> Published Issue: [#91](https://github.com/qzhike/zhiju-business-core/issues/91); this file is a historical draft, not its current body.

## Status

`PLANNED / NOT STARTED`

Parent exit gate: #89.

## Goal

Establish the Artifact Application/Persistence transaction foundation on top of the existing V4000 technical tables, without prematurely creating Artifact business aggregates.

## Authority

- Artifact Module Spec command invariants and persistence boundary
- PostgreSQL logical model Artifact schema
- IM-02 standard transaction, Receipt, Outbox, Inbox, Reference Edge, RLS, and audit patterns
- #90 executable contract foundation

## Dependencies

- #90 merged and closed
- #89 parent exit gate

## Deliverables

- Artifact transaction context and command runner with authoritative actor/scope propagation
- atomic idempotency claim/replay/conflict handling bound to canonical payload hash
- expected aggregate version CAS primitive without JavaScript integer truncation
- Receipt, Outbox, Reference Edge, audit, and rollback composition for Artifact-owned transactions
- Enterprise/Project double RLS and direct privilege-denial probes
- focused Persistence tests and a disposable PostgreSQL runbook record

## Acceptance

- [ ] Same idempotency key and same payload hash replays the first committed result; a different hash returns a stable conflict and does not leak `unique_violation`.
- [ ] Concurrent expected-version writers produce one success and one stable concurrency conflict.
- [ ] Receipt, business callback placeholder, Outbox, Reference Edge, and audit writes commit or roll back atomically.
- [ ] Cross-Enterprise/Project access and direct untrusted writes fail under real PostgreSQL roles/RLS.
- [ ] Process scope mirrors the parent Project scope; owner-version reference uniqueness is preserved.
- [ ] Clean migration, second no-op migration, focused Persistence tests, and the full repository gate pass; test containers and generated build output are cleaned.

## Manual output

Provide a local, secret-free PostgreSQL probe report showing exact command IDs, payload hashes, actor/scope context, aggregate versions, replay/conflict results, SQLSTATE for denied operations, row counts before/after rollback, and cleanup.

## Non-goals and NOT RUN

- No Artifact, Branch, Revision, Content Object, Representation, or Binding business table in this work item.
- No object storage, renderer, public HTTP handler, provider, production database, cross-module business E2E, or real business acceptance.
- Existing V4000 remains immutable; any required DDL uses a forward-only migration.
