> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-04-work-items/issues/06-structured-document-edit-diff.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-04-work-items/issues/06-structured-document-edit-diff.md).
> Published Issue: [#95](https://github.com/qzhike/zhiju-business-core/issues/95); this file is a historical draft, not its current body.

## Status

`IMPLEMENTATION COMPLETE / PERSISTENCE VERIFIED / GIT DELIVERY COMPLETE PR #113 MERGED / ISSUE #95 CLOSED`

Parent exit gate: #89.

## Goal

Implement the minimum Structured Document canonical model, scoped Human Edit, stable-unit validation, and deterministic internal Diff over two exact sealed revisions.

## Authority

- IM-DG-005 Structured Document route
- Artifact Module Spec CanonicalDocument and CanonicalDocumentUnit
- Artifact Module Test AF-API-D-002, AF-IM04-U-001 through U-003, and AF-IM04-M-001
- #90 executable schema/hash foundation and #94 immutable revision DAG

## Dependencies

- #90 merged and closed
- #94 merged and closed
- #89 parent exit gate

## Deliverables

- Structured Document validation and canonicalization service
- stable unit identity, parent/child consistency, acyclic hierarchy, deterministic ordinal, scope, and evidence-reference checks
- Human Edit command/service bound to exact base revision hash and explicit allowed unit references
- deterministic internal Added/Removed/Changed/Moved Diff result from `artifact.get_revision_diff_inputs@1.0` inputs
- positive, negative, history-replay, and hash golden fixtures

## Acceptance

- [ ] Closed unit types, unique lineage-stable `unitId`, bidirectional hierarchy, acyclic parent graph, and deterministic sibling order are enforced.
- [ ] An edit outside allowed units, against a stale/wrong base hash, or by a prohibited actor is rejected without creating a revision.
- [ ] Successful Human Edit creates a new canonical payload/object/revision and never mutates the base revision.
- [ ] Diff accepts only two exact revision refs and reports stable Added/Removed/Changed/Moved units deterministically.
- [ ] Reordering an unchanged unit is not misreported as whole-document replacement.
- [ ] Diff is rebuildable, persists no approval/quality fact, and introduces no public Diff Result operation.
- [ ] Focused tests, full gates, and test-artifact cleanup pass.

## Manual output

Provide a synthetic procurement-procedure document with exact canonical bytes/hash, unit tree, allowed-unit edit, denied out-of-scope edit, before/after revisions, deterministic diff table, replay result, and cleanup. The text is technical fixture data, not a real customer policy.

## Non-goals and NOT RUN

- No rich-text editor, DOCX/OOXML fidelity, pagination, fonts, headers/footers, PDF rendering, Quality/Approval/Release, provider, public HTTP E2E, or real business acceptance.
