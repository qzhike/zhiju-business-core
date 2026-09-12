# Workspace MVP Interaction Prototype

A standalone HTML/CSS/JavaScript design artifact. It does not choose the production frontend framework and does not connect to business APIs, models, or runtime processes.

## Preview

From this directory:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/`. Use another local port if 8766 is occupied.

## Scenarios

- Filter the board and open the procurement review work page.
- Approve an exact synthetic revision and advance to the next file.
- Submit per-file feedback without navigation.
- Simulate approval rejection or an unknown result without advancing.
- Simulate related-file impact and explicit scope confirmation.
- Simulate a new revision while editing; retain the current view and version-specific drafts.
- Inspect prior feedback alongside fixed example changes when a new revision is selected.

Client identity, candidate revisions, before-text omissions, progress and quality results are synthetic and stored only in this tab's sessionStorage. Reload preserves them; the board's reset button clears the demo state. Procurement content uses three real Markdown template snapshots bundled under `templates/`, with source names, template versions and SHA-256 hashes in `procurement-fixtures.js`. Source downloads are available in the source tab. Candidate previews substitute the synthetic company identity and omit template maintenance history; returned candidates append a clearly labeled review note. MVP records, manuals, procedures and policies use Markdown for data entry and delivery. Excel conversion and workbook-template design are deferred. These previews are not evidence of customer activity or a production content pipeline. This content refresh uses a new storage key so old fictional scenarios cannot carry over. Mobile supports viewing and feedback; approval controls are desktop-only.

The manual scenario controls are intentionally labeled as demonstrations. They are not proposed production controls. Static checks and browser walkthroughs are not evidence of real business authorization, quality gates, runtime execution, or approval integration.

## Inspection context prototype

The work page identifies the template edition, synthetic candidate revision, blank-form purpose, applicability and explicit cross-document references. References outside the current three-file scope are not opened or modified. Chapter/table locators insert a version-bound quotation into the existing feedback field; their source-line identifiers are local preview positions, not production canonical IDs. Wide tables scroll within a keyboard-focusable region.

The purchase application starts with a synthetic unresolved applicability question and cannot be approved. The bottom demo control simulates confirmation of both production and R&D uses for the current revision only. A new revision requires a new confirmation. This is a UI state example, not a newly implemented business command or an approved production workflow. Feedback submission does not resolve that question automatically.

The review page opens on changes, including after file switching and version updates. File identity is a single secondary line. Summary and prior feedback remain available in a collapsed disclosure below the document changes. Applicability and reference details follow the main document area; unresolved applicability retains a compact alert and the same approval guard. Existing session drafts are preserved during the layout migration.

## Contextual changes exploration

Initial candidates show two curated changes per file, restoring synthetic omissions to real template content. Tables preserve original rows and columns and highlight the affected value; paragraph changes retain neighboring text. Previous/next navigation selects a change within the current file and revision. Quotes enter the existing version-specific feedback field. Returned demo revisions show only the appended review note, matching their full candidate preview. This is not an automatic Markdown or Excel diff engine. Source snapshots remain unchanged.

## Alternative bounded review layout

Desktop uses a viewport-height file list, independently scrolling document pane, and feedback rail. Only the selected change is rendered; previous/next replaces the selection instead of accumulating sections. Summary and related context have their own reading tab. At 900px and below, document and feedback use mutually exclusive panes with a visible switch; quoting a change opens the existing feedback pane. Status and demo controls remain available in the feedback rail. The user accepted this bounded layout as the UI direction. It supersedes the earlier vertically stacked review layout; typography, spacing and copy may be refined after launch. Business authorization, version protection and reliable feedback still require pre-launch validation.

## Markdown filling scenario

The purchase application now demonstrates synthetic record data filled into a real Markdown template. Quantity and required date remain missing in candidate 2. The single feedback field accepts a fixed sample reply, submitted through the existing workflow. The demo return action applies only the exact supported reply (or that reply with the generated missing-field quote), producing a separate candidate; arbitrary feedback is retained but does not imply successful interpretation. An unrelated incoming revision preserves missing values. Switching versions is explicit and old-version content remains unchanged. Full-content download exports the currently viewed Markdown candidate. Customer signatures remain blank. Other files retain the earlier template-adaptation scenarios.

The missing-field approval block is a bounded design simulation, not an implemented business validation rule. Storage is isolated with the `zhiju-review-demo-fill-v7` key. No business API, execution agent, or automatic diff engine is connected.

The changes view uses a fixed-size navigator above the scrolling document, with total count, current location and previous/next controls. An on-demand searchable directory has bounded height and its own scrolling, so dozens of locations do not expand the page. Missing-data counts are shown on the relevant directory entries. Selection is navigation only; it does not mark a location reviewed or change approval status. The document still displays one location at a time.

Returned purchase-application candidates include an immutable, per-revision synthetic feedback receipt. Supported fixed replies report the two fields written, unsupported text is explicitly unhandled, and unrelated incoming versions do not claim a feedback result. A compact link in the changes view opens the result in the existing summary/context tab; the same feedback field remains the only business input. Old snapshots without receipts make no reconstructed execution claims.
