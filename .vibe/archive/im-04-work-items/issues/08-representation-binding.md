> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/08-representation-binding.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/08-representation-binding.md).
> Published Issue: [#97](https://github.com/qzhike/zhiju-business-core/issues/97); this file is a historical draft, not its current body.

## Status

`IMPLEMENTATION COMPLETE / PERSISTENCE VERIFIED`

Parent exit gate: #89.

## Goal

Implement immutable Representation registration only after authoritative verification of a successful IntegrationGateway RenderAttempt binding.

## Authority

- Artifact Module Spec RepresentationRegistration and renderer boundary
- IntegrationGateway RenderRequest, RenderSucceeded, and the additive Binding Query from #90
- Artifact Module Test AF-API-D-004, AF-API-C-002, and AF-IM04-C-004/C-005
- #93 Content Object Manifest and #94 exact sealed revisions

## Dependencies

- #90 merged and closed
- #93 merged and closed
- #94 merged and closed
- #89 parent exit gate

## Deliverables

- forward-only Representation and validation-fact migration/repository
- `artifact.register_representation@1.0` handler using only the public authoritative RenderAttempt Binding Query
- exact verification of revision, canonical content ref/input hash, output format/media type, renderer ID/version, output locator/checksum, successful status, and raw receipt
- idempotent exact-render-identity handling and immutable Representation query
- mismatch, replay, substitution, UNKNOWN/failure, RLS, rollback, and event-minimality tests

## Acceptance

- [x] Representation registration is blocked until #90 provides the authoritative Binding Query; no cross-module database read is used.
- [x] Caller Registration mismatching any authoritative request/result field is rejected without a Representation row or success event.
- [x] Failed, UNKNOWN, missing, quarantined, or wrong-scope attempts cannot register a Representation.
- [x] Same exact render identity replays idempotently; changed input hash, renderer version, output checksum, or object creates a distinct attempt/representation path.
- [x] Representation checksum never substitutes for Canonical content hash or Release package hash.
- [x] Render success is only a candidate fact and cannot imply Quality PASS, Approval, Release, or effective binding.
- [x] Real PostgreSQL negative/rollback/RLS probes, focused tests, full gates, and cleanup pass.

## Manual output

Provide a synthetic successful Binding View and Registration table, followed by wrong revision, wrong input hash, wrong renderer, wrong checksum, UNKNOWN, and cross-project attempts. Record exact expected/actual error codes, persisted rows/events, and cleanup.

## Non-goals and NOT RUN

- No renderer adapter/process, DOCX/XLSX/PDF generation, file openability/layout acceptance, real object store/provider, Quality/Approval/Release, public HTTP E2E, production, or real business acceptance.
