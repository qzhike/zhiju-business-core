## Status

`DELIVERED / PR #114 MERGED / ISSUE #96 CLOSED / FEATURE BRANCH DELETED`

Parent exit gate: #89.

## Goal

Implement the minimum WorkbookSpec canonical model, scoped Human Edit, stable sheet/column/row/cell validation, and deterministic internal Diff over two exact sealed revisions.

## Authority

- IM-DG-005 WorkbookSpec route
- Artifact Module Spec WorkbookSpec, WorkbookSheet, WorkbookColumn, WorkbookRow, and WorkbookCell
- Artifact Module Test AF-API-D-003, AF-IM04-U-001 through U-003, and AF-IM04-M-001
- #90 executable schema/hash foundation and #94 immutable revision DAG

## Dependencies

- #90 merged and closed
- #94 merged and closed
- #89 parent exit gate

## Deliverables

- WorkbookSpec validation and canonicalization service
- stable identity and deterministic ordering for sheets, columns, rows, and cells
- same-sheet column references, value-type/formula boundary, validation-rule, and cross-record-rule checks
- Human Edit command/service bound to exact base revision and explicit allowed cell/row/sheet references
- deterministic internal Added/Removed/Changed/Moved Diff and hash fixtures

## Acceptance

- [x] Duplicate IDs, duplicate ordinals, cross-sheet column references, invalid value types/formulas, unknown required extensions, and malformed rules are rejected.
- [x] Excel coordinates are Representation-only and cannot replace stable business IDs.
- [x] An out-of-scope or stale-base edit creates no new revision; a valid Human Edit creates a new immutable payload/object/revision.
- [x] Diff uses exact refs and stable IDs, reports deterministic cell/row/sheet changes, and preserves unchanged identities across reorder.
- [x] Formula text is stored as declared semantics only; the Core does not pretend to be an Excel calculation engine.
- [x] No public Diff Result operation is added; focused tests, full gates, and cleanup pass.

## Manual output

Provide a synthetic WorkbookSpec with exact canonical bytes/hash, stable ID map, allowed cell edit, rejected cross-sheet reference, before/after revisions, deterministic diff table, replay output, and cleanup. The data is a technical fixture, not a customer workbook.

Automated synthetic output: [`../../issue-96-delivery/Manual-Workbook-Fixture.md`](../../issue-96-delivery/Manual-Workbook-Fixture.md). Independent Human review remains `NOT RUN`.

## Non-goals and NOT RUN

- No Excel calculation engine, macros, external links, pivot tables, XLSX layout fidelity, renderer, Quality/Approval/Release, provider, public HTTP E2E, or real business acceptance.
