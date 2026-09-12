## Post-fix re-verification — REOPENED / acceptance incomplete

PR #141 merged into exact `main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d` and automatically closed this issue. A post-merge review found that the Persistence Recall Handler still does not bind the current Recall decision to its own exact ActorSnapshot, so the issue's Recall acceptance scope is not complete.

### Evidence

- `handleRecallRelease` still passes `actorSnapshotRefForRecall(row)` into `validateHumanAuthorizationChain`:
  https://github.com/qzhike/zhiju-business-core/blob/737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d/modules/release-publication/src/release-publication-handlers.ts#L2302-L2317
- `actorSnapshotRefForRecall(row)` loads `authorization_actor_snapshot_ref` retained on the Release from the original authorization:
  https://github.com/qzhike/zhiju-business-core/blob/737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d/modules/release-publication/src/release-publication-handlers.ts#L2636-L2655
- PR #141 did not modify this Persistence Handler path. The focused suite covers authority validation with the existing fixture chain, but it does not contain a positive case where a different currently authorized Human performs Recall using the current Recall AuthorizationDecision and that decision's own ActorSnapshot.

This can reject a legitimate emergency Recall by a different authorized Human because the current envelope/context snapshot is compared against the original Release authorization snapshot. The original snapshot is valid historical evidence, but it must not substitute for the current Recall actor provenance.

### Required before re-closing

- Resolve the current Recall AuthorizationDecision through the authoritative IdentityPolicy port and load the exact ActorSnapshot referenced by that decision.
- Compare the current Envelope actor, Context actorSnapshotId, ActorSnapshot principal, `authorizingHumanRef`, AuthorizationDecision principal, Scope, Purpose, command type/version, payload hash, expiry, and revocation state.
- Retain the original Authorize ActorSnapshot as history only.
- Add Handler/Persistence regressions for:
  - a distinct authorized Human with a valid current Recall decision — must succeed;
  - ActorSnapshot/Decision principal mismatch;
  - Scope/Purpose/payload-hash mismatch;
  - expired or revoked decision;
  - Agent and Agent `actingFor` Human;
  - all rejection paths produce no Recall, ImpactReview, Event, or Release-state side effect.
- Synchronize HL-Spec, Module Spec, Module Test, and verification records, then rerun focused tests and fresh exact-head `pnpm clean && pnpm verify`.

Parent review evidence: https://github.com/qzhike/zhiju-business-core/issues/120#issuecomment-5475844746

Real Identity Provider, production, public HTTP, unified cross-module business E2E, and independent manual acceptance remain `NOT RUN`.
