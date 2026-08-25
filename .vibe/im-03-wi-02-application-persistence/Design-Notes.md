# IM-03 WI-02 Design Notes

## Transaction coordinator

`withEnterpriseProjectTransaction`:

1. Pin one pooled connection.
2. `SET LOCAL ROLE platform_context_establisher`.
3. `platform_security.establish_transaction_context(...)`.
4. `SET LOCAL ROLE enterprise_project_app`.
5. Run the command body. Commit or rollback drops the RLS context with the transaction.

## Trusted snapshots

`CommandEnvelope` must match the trusted context on principal, actor snapshot, authorization decision, policy snapshot, enterprise, correlation, and allowed project list. Policy snapshot is an application-level pin: the SQL context function does not store it, and this module never reads `identity_policy` tables.

## Write boundary

- Receipt uniqueness is `(idempotency_scope, idempotency_key)`.
- Same key + same hash returns the saved result.
- Same key + different hash writes a `DENIED` audit, leaves the original receipt untouched, then throws `IDEMPOTENCY_PAYLOAD_CONFLICT`.
- Outbox payload must embed `enterpriseId` / `projectId` mirrors and a canonical SHA-256 hash.
- CAS uses `process_instance.aggregate_version` as the technical stand-in until WI-03 business aggregates exist.
- Body exceptions roll back receipt, audit, outbox, reference edge, and process rows together.
