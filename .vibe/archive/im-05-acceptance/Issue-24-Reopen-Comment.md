## Post-fix re-verification — REOPENED / direct provenance counterexample still mints a Formal Receipt

PR #141 merged into exact `main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d` and automatically closed this issue. The patch added Adapter Attempt type/Scope checks and exact External Delivery Request equality, but it still does not resolve or bind the Adapter Attempt's `objectId` through an authoritative IntegrationGateway source.

### Direct post-fix counterexample

- Registered formal Publication Attempt ID: `018f22e2-7c15-7b2e-8d86-2de956a9d820`.
- RawExternalReceipt Adapter reference:
  - `objectType=integration.adapter_attempt`
  - fabricated, unregistered `objectId=018f22e2-7c15-7b2e-8d86-2de956a9d899`
- Release, Package, Destination, External Delivery Request, payload hash, outcome, and time fields were otherwise self-consistent.

Actual result:

```text
registrationOk: true
publicationAttemptId: 018f22e2-7c15-7b2e-8d86-2de956a9d820
fabricatedAdapterAttemptId: 018f22e2-7c15-7b2e-8d86-2de956a9d899
recordFormalReceipt resultOk: true
```

The current validator checks Adapter type and Scope, then compares the External Delivery Request, but it does not validate the Adapter Attempt ID or an authoritative formal-delivery binding:
https://github.com/qzhike/zhiju-business-core/blob/737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d/modules/release-publication/src/receipt-validator.ts#L648-L679

The new regression matrix covers the wrong Adapter type, wrong Scope, and wrong External Delivery Request. It does not cover the wrong Adapter Attempt `objectId` explicitly required by this issue's R3 acceptance scenario.

### Required before re-closing

- Add an authoritative IntegrationGateway Query/Port that resolves the exact formal Adapter Attempt binding; do not accept a caller-constructed self-consistent in-memory reference as provenance.
- Validate complete Adapter Attempt identity — object type, object ID, and Scope — against the exact External Delivery Request, Publication Attempt, Release, Package, and Destination.
- Add Runtime/Handler/Persistence regressions for wrong Adapter type, wrong Adapter ID, missing Adapter Attempt, ordinary-send Adapter Attempt, foreign External Delivery Request/Release/Package/Destination, and a valid formal path.
- Prove that every rejection path writes no Formal Receipt, `PublicationSucceeded`, Completion, or other business side effect.
- Synchronize HL-Spec, Module Spec, Module Test, and verification records, then rerun the direct counterexample, focused tests, and fresh exact-head `pnpm clean && pnpm verify`.

The existing repository gates are green — focused 4 files/34 tests, ordinary 42 passed/30 skipped files and 438 passed/299 skipped tests, PostgreSQL 34 files/314 tests — but this counterexample still returns `ok: true` on the same exact head.

Parent review evidence: https://github.com/qzhike/zhiju-business-core/issues/120#issuecomment-5475844746

Real Feishu/Provider, production, public HTTP, unified cross-module business E2E, and independent manual acceptance remain `NOT RUN`.
