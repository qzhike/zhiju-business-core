## Status

`PLANNED / NOT STARTED`

Parent exit gate: #89.

## Goal

Freeze and implement the executable contract foundation required before any IM-04 business handler: Canonical Document and WorkbookSpec schemas, deterministic hash fixtures, and an additive authoritative RenderAttempt Binding Query.

## Authority

- Artifact Module Spec sections 2, 7, and 9
- Artifact Module Test AF-API-D-002 through D-005 and AF-IM04-C-001 through C-005
- IntegrationGateway Module Spec query boundary
- IM-04 specification review findings IM04-SR-001 through IM04-SR-005

## Dependencies

- #56 closed
- #89 parent exit gate
- IM-DG-005 approved

## Deliverables

- versioned executable schemas for `CanonicalContentPayload`, `CanonicalDocument`, and `WorkbookSpec`
- exact formula `contentHash = SHA-256(canonicalize({schemaRef, contentType, canonicalizationVersion, body}))`
- positive and negative cross-language golden fixtures proving that self-hash and Manifest metadata are outside the hash domain
- additive `integration.get_render_attempt_binding@1.0` payload/result schema with authoritative request and successful-result binding
- generated types, Registry/Catalog metadata, compatibility baseline, and location-specific contract tests
- a `.vibe` exact-head review record before closure

## Acceptance

- [ ] Unknown major, unknown required extension, open content type, duplicate stable IDs, invalid hierarchy, invalid Workbook references, and malformed formulas/types are rejected at the contract boundary.
- [ ] Changing `schemaRef`, `contentType`, `canonicalizationVersion`, or body changes the hash; changing locator, storage state, byte size, media type, or the hash field itself does not alter the hash input.
- [ ] The new Binding Query returns the original RenderRequest, request payload hash, authoritative successful result, and raw receipt reference without credentials or presigned URLs.
- [ ] Existing `integration.get_render_attempt@1.0` compatibility is preserved; no cross-module repository access is introduced.
- [ ] No public Diff Result operation is added.
- [ ] Focused contract tests and full repository gates pass on the exact PR head.

## Manual output

Provide a reviewer-readable table containing each golden payload, canonical bytes, exact SHA-256 digest, expected schema result, actual result, and the Binding Query positive/negative fixture outputs.

## Non-goals and NOT RUN

- No Artifact business tables, repositories, or handlers in this work item.
- No renderer process, Office file generation, production object storage, external provider, public HTTP E2E, or real business acceptance.
- All business runtime, persistence, E2E, external, and manual-business outcomes remain `NOT RUN` unless this issue records direct evidence.
