# IM-03 WI-02 Task Plan

## Goal

Deliver the EnterpriseProject Application/Persistence foundation for issue #58: one owning-module transaction over IM-02 technical tables, without business DDL or IdentityPolicy repository sharing.

## Hard dependency

Issue #57 / branch `galendai/57-im-03-wi-01-enterpriseproject` (merged into this worktree).

## Assumptions

- Authorization is a trusted snapshot binding. This module does not import `@zhiju/identity-policy`; the composition layer must call IdentityPolicy public Decision/Query ports first.
- CAS is proven on the existing `process_instance` technical table. No Enterprise/Project business tables are created.
- Empty-database migration evidence remains the IM-02 Flyway gate; this work item adds focused PostgreSQL tests and a five-step probe.

## Stages

1. Module DB port, RLS transaction helper, canonical digest.
2. Command runner: receipt claim, envelope binding, audit/outbox/reference-edge, CAS, rollback.
3. Real PostgreSQL tests (enterprise + project fixtures) and manual probe/runbook.
4. Spec/Test/HL document sync.
5. `pnpm verify` and PR against the WI-01 base.

## Non-goals

Business handlers, business DDL, shared repositories, Inbox dispatcher, HTTP adapters.
