> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/01-contract-schema-hash.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/01-contract-schema-hash.md).
> Published Issue: [#90](https://github.com/qzhike/zhiju-business-core/issues/90); this file is a historical draft, not its current body.

## Status

`IMPLEMENTATION COMPLETE / CONTRACT AND HASH REGRESSION PASS / PR #100 MERGED / ISSUE #90 CLOSED / FEATURE BRANCH DELETED`

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

- [x] Unknown major, unknown required extension, open content type, duplicate stable IDs, invalid hierarchy, invalid Workbook references, and malformed formulas/types are rejected at the contract boundary.
- [x] Changing `schemaRef`, `contentType`, `canonicalizationVersion`, or body changes the hash; changing locator, storage state, byte size, media type, or the hash field itself does not alter the hash input.
- [x] The new Binding Query returns the original RenderRequest, request payload hash, authoritative successful result, and raw receipt reference without credentials or presigned URLs.
- [x] Existing `integration.get_render_attempt@1.0` compatibility is preserved; no cross-module repository access is introduced.
- [x] No public Diff Result operation is added.
- [x] Focused contract tests and repository `pnpm verify` gates pass locally, including PostgreSQL/Flyway persistence (`21 files / 256 tests`, empty migration, second-migrate no-op, and container cleanup).

## Manual output

Reviewer-readable output is recorded in [Verification-Record.md](../../issue-90/Verification-Record.md), including each golden payload, canonical bytes, exact SHA-256 digest, expected/actual schema result, and Binding Query positive/negative fixture outputs.

## Non-goals and NOT RUN

- No Artifact business tables, repositories, or handlers in this work item.
- No renderer process, Office file generation, production object storage, external provider, public HTTP E2E, or real business acceptance.
- All business runtime, persistence, E2E, external, and manual-business outcomes remain `NOT RUN` unless this issue records direct evidence.

## Git 交付收口

PR [#100](https://github.com/qzhike/zhiju-business-core/pull/100) 的最终精确 head 为 `2fb49e243f6aac3e604190c5f655c0b1980fef69`，GitHub Actions `ci/verify` 已成功，并以 merge commit `bc8c772e2c222d6db59de3872c8f03f39f3541db` 合入 `main`。Issue [#90](https://github.com/qzhike/zhiju-business-core/issues/90) 已关闭；远端和本地 `galendai/im-04-wi-01-freeze-executable-canonical-schemas` branch 已删除，最终 `origin/main` 已确认包含实现 HEAD。
