## IM-05 post-fix re-verification — NOT APPROVED / gate remains OPEN

Re-reviewed exact `origin/main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d` after PR #141. The PR is merged, its exact-head `verify` check passed, and it automatically closed #22/#23/#24. The repository gates are green, but direct semantic counterexamples still violate those issues' acceptance criteria.

### Green verification, accurately bounded

- PR #141 focused tests: 4 files / 34 tests PASS.
- Fresh `pnpm clean && pnpm verify`: PASS.
  - ordinary Vitest: 42 passed / 30 skipped files; 438 passed / 299 skipped tests
  - Catalog/Registry: 201/201 FULL; frozen compatibility baseline: 200 operations
  - disposable PostgreSQL 18.6 / Flyway 11.20.3: 34 files / 314 tests PASS
  - empty-database migration, second `No migration necessary` run, and container cleanup: PASS

### Remaining acceptance blockers

1. **P1 — a fabricated Adapter Attempt ID still mints a Formal Receipt (#24).**
   - PR #141 checks `adapterAttemptRef.objectType=integration.adapter_attempt`, Scope, and the External Delivery Request, but it does not resolve an authoritative Adapter Attempt or bind its `objectId` to the formal Publication Attempt/delivery chain.
   - Direct post-fix probe: the registered Publication Attempt ID was `018f22e2-7c15-7b2e-8d86-2de956a9d820`; the RawExternalReceipt used an unregistered fabricated `integration.adapter_attempt` ID `018f22e2-7c15-7b2e-8d86-2de956a9d899` while keeping the other fields self-consistent.
   - Actual result: `recordFormalReceipt(...)` returned `ok: true` and minted the Formal Receipt.
   - The new regression matrix covers the wrong Adapter type, wrong Scope, and wrong External Delivery Request, but not the wrong Adapter Attempt `objectId` required by #24 R3.

2. **P1 — allowlisted provider-result keys can still carry equivalent PII (#23).**
   - Direct post-fix input: `{ messageId: "AliceCustomer", providerStatus: "AliceCustomer", reasonCode: "BobBuyer", status: "CustomerName" }`.
   - Actual sanitizer result preserves every value unchanged and returns `redactedPaths=[]`.
   - The key allowlist removes unknown/nested fields, but generic token regexes do not establish provider-specific safe semantics. Closed status/error mappings and authoritative identifier extraction or irreversible mapping are still required.

3. **P2 — the Persistence Recall Handler still reuses the original Authorize ActorSnapshot (#22).**
   - PR #141 did not change `release-publication-handlers.ts` for Recall.
   - `handleRecallRelease` still passes `actorSnapshotRefForRecall(row)`, which loads `authorization_actor_snapshot_ref` retained from the original Release authorization instead of the exact ActorSnapshot for the current Recall decision.
   - A distinct currently authorized Human can therefore be rejected. The suite still lacks a distinct-Human/current-Recall-decision positive regression.

4. **The parent latest-readiness exit criterion is still not fully executed.**
   - `Module-Test-006-ReleasePublication.md` still marks the independent stale/withdrawn RRS negative as `NOT RUN` in RP-API-U-001 and RP-API-WI07-U-002.

### Required before parent acceptance

- Reopen #22/#23/#24 and attach these counterexamples to the corresponding issue records.
- Add an authoritative IntegrationGateway query/binding for the exact formal Adapter Attempt and reject wrong/missing Adapter Attempt IDs before Receipt/Event/Completion writes.
- Map raw provider results into a closed, provider-reviewed internal result; add allowlisted-key/name-like-value and full Receipt/Event/Error/Log non-leakage regressions.
- Bind Recall to the current Recall AuthorizationDecision and its exact ActorSnapshot; add a distinct authorized Human positive case plus mismatch/expiry/revocation negatives at Handler/Persistence level.
- Execute stale/withdrawn RRS negatives before Publisher/Attempt side effects.
- Correct HL/Module Spec/Test and the PR #141 verification records, which still report #22/#23/#24 as OPEN and currently overstate controlled PASS evidence.
- Re-run focused counterexamples and fresh exact-head `pnpm clean && pnpm verify`; then close #22/#23/#24 only after semantic readback, update the #120 checklist, and perform a new parent review.

Issue #120 remains OPEN. Real Provider/Feishu, production, public HTTP, unified cross-module business E2E, external-recipient confirmation, and independent customer/manual acceptance remain `NOT RUN`.
