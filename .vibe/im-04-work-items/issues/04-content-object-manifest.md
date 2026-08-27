## Status

`PLANNED / NOT STARTED`

Parent exit gate: #89.

## Goal

Implement the Artifact-owned Canonical Content Object Manifest lifecycle and the staging, validation, link, freeze, quarantine, and orphan-cleanup transaction boundary.

## Authority

- Artifact Module Spec `CanonicalContentPayload` and `CanonicalContentManifest`
- PostgreSQL logical model `artifact_content_object`
- Deployment security baseline for object storage, retention, legal hold, and encryption boundaries
- #90 executable schemas/hash fixtures and #91 transaction foundation

## Dependencies

- #90 merged and closed
- #91 merged and closed
- #89 parent exit gate

## Deliverables

- forward-only Content Object Manifest migration and repository
- replaceable local/CI Object Storage Port with staging upload and authoritative readback
- schema, media type, size, canonical bytes, and SHA-256 verification before link/freeze
- atomic business-link commit and audited orphan/quarantine records
- leased orphan cleanup with grace period, retry, retention, legal-hold, and idempotency safeguards
- direct negative Persistence tests for rollback, substitution, tampering, races, and RLS

## Acceptance

- [ ] Manifest state follows the allowed `STAGING -> LINKED -> FROZEN` path; quarantine and orphan outcomes are audited and cannot be used by a sealed revision.
- [ ] Hash is recomputed from canonical payload bytes; locator, filename, object path, caller hash, and storage metadata cannot substitute for content identity.
- [ ] A database failure after object upload creates no business link and leaves only a reclaimable audited orphan.
- [ ] A sealed consumer can reference only a same-scope `FROZEN` Manifest; frozen content identity cannot be updated.
- [ ] Cleanup respects lease/fencing, grace period, retention, legal hold, concurrent workers, replay, and unknown deletion outcome.
- [ ] Real PostgreSQL rollback/RLS/race probes, clean/no-op migration, full gates, and cleanup pass.

## Manual output

Provide a synthetic object-lifecycle walkthrough with payload bytes, expected and actual hash, object locator redaction, Manifest state transitions, transaction IDs, forced rollback, orphan inventory, cleanup decision, denied legal-hold deletion, and final cleanup.

## Non-goals and NOT RUN

- Real Ceph RGW/OpenBao conformance, production encryption, Object Lock, backup/restore, and production cleanup scheduling remain `NOT RUN`.
- No sealed Revision, Diff, Representation, renderer, Quality, Approval, Release, public HTTP E2E, or real business acceptance.
