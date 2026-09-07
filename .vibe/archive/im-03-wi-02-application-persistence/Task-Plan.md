> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-02-application-persistence/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-02-application-persistence/Task-Plan.md).

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

1. Module DB port, RLS transaction helper, canonical digest. `PASS`
2. Command runner: receipt claim, envelope binding, audit/outbox/reference-edge, CAS, rollback. `PASS`；本轮 review 另补 target/version/owner/principal 负向约束。
3. Real PostgreSQL tests (enterprise + project fixtures) and manual probe/runbook. PostgreSQL focused gate `PASS`；用户亲自运行 probe `NOT RUN`。
4. Spec/Test/HL document sync. `PASS`
5. `pnpm verify` and PR against the WI-01 base. 本地集成 base 后 `PASS`；远端 exact-head checks、PR comment、合并和 Issue 收尾待完成。

## Non-goals

Business handlers, business DDL, shared repositories, Inbox dispatcher, HTTP adapters.
