# [IM-04][WI-02] Establish Artifact application and persistence foundation

Closes #91

## Summary

- Add the Artifact owning-schema Kysely database types and a single-connection transaction wrapper.
- Bind command envelopes to the trusted PostgreSQL transaction context before claiming a receipt.
- Implement same-hash idempotent replay, stable different-hash conflict handling, rejected-result replay, and atomic rollback.
- Add a technical `process_instance` CAS stand-in that preserves PostgreSQL `bigint` precision with string/BigInt arithmetic.
- Compose technical Process, Receipt, Audit, Outbox, and Reference Edge writes in one transaction with target/scope/hash guards.
- Add real PostgreSQL persistence coverage for RLS, ACL, Context expiry, Project scope mirrors, and owner-version uniqueness.
- Keep `V4000__artifact_technical_tables.sql` immutable and do not create Artifact business tables in this work item.

## Verification

```text
pnpm clean && pnpm verify
Format, lint, typecheck, full Vitest, architecture, contracts, and persistence gate: PASS
Full Vitest: 26 passed | 18 skipped; 368 passed | 253 skipped
Persistence gate: 22 files / 268 tests passed
PostgreSQL: 18.6; Flyway: 11.20.3
Second migration: No migration necessary
Disposable PostgreSQL container: removed
```

## Explicit non-goals

This change does not add Artifact, Branch, Revision, Content Object, Representation, or Binding business tables. Public HTTP handlers, object storage, renderer/provider integrations, cross-module business E2E, production database validation, and independent manual business acceptance remain out of scope and are not claimed as verified.
