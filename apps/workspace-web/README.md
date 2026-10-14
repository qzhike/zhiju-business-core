# Workspace Web engineering shell

This independent React SPA implements the approved first-use layouts. The
production entry is the **trusted Human workspace**: it probes `GET /bff/session`
on boot and, only for an `ALLOWED` session, reads the authorized project
directory and the per-project boards through the BFF query routes. Without a
valid session it renders the recoverable sign-in entry or the fixed safe
"no accessible workspace" state; no business action, token or fabricated
identity is ever produced in the browser. Protected reads carry the BFF session
cookie (same-origin), the in-memory CSRF token and the exact operation/version
in both the path and the frozen Envelope projection body — never an
`Authorization` header, an actor/decision field or an upstream URL.

Install from the repository root with `pnpm install --frozen-lockfile`.
Build independently with `pnpm --filter @zhiju/workspace-web build`.
`pnpm --filter @zhiju/workspace-web start` serves the static artifact on loopback
port 3100 and forwards `/bff/*` to the fixed `BFF_URL` (default
`http://127.0.0.1:3101`). Use an HTTPS reverse proxy for production. The server
allows only declared SPA page routes; API requests and missing assets stay errors.

Trusted-journey view state lives in `src/trusted`: the boot session probe and
safe return routes (`session.ts`), the frozen Envelope projection and result
parsers (`protocol.ts`), the bound-cursor page accumulator with its
LOADING/READY/EMPTY/ERROR gate (`pagination.ts`), and the
session-generation/principal/scope guard that drops late responses and
cross-tab invalidation signals (`guard.ts`). A legal directory page may be
`items=[]` with a bound `nextCursor`; that page stays LOADING until the same
cursor chain completes, and an empty terminal page never clears shown cards.
Local page counts are never presented as global totals, and capabilities without
a registered public operation (ZIP intake, D14 preparation, Runner progress,
original-byte downloads) stay visibly unavailable. Real Keycloak, Core HTTP,
Runner and manual acceptance remain `NOT RUN`.

The shared workbench page lives in `src/workbench`. Both trusted reads and the
isolated development adapter supply typed presentation inputs to the same page.
Project selection is a safe URL identifier; work filters, disclosure state,
scroll positions and recent navigation remain in live-session memory. Returning
from a work card restores its board context. Recent access opens an exact page
without resuming execution. Task, report, request and candidate identifiers are
kept distinct, and unavailable file review, delivery and task pages retain an
explicit route boundary. The three active groups are independently scrollable
on desktop and selectable on narrow screens; completed work starts collapsed.

The production view reads only the selected project's independently authorized
EP/TE boards. It labels each source's completeness and freshness, and never
manufactures cross-project totals, candidate counts or completion percentages.
`src/fixtures/workbench.tsx` supplies multi-project, negative-state and delayed
candidate/report scenarios in the development build only. Its board updates are
memory-only and reset on reload; no business operation or draft save occurs.

For an **explicit development demonstration**, run:

```sh
pnpm --filter @zhiju/workspace-bff build
pnpm --filter @zhiju/workspace-bff start
# In another terminal:
pnpm --filter @zhiju/workspace-web build:fixture
NODE_ENV=development pnpm --filter @zhiju/workspace-web start
```

Open `http://127.0.0.1:3100/workbench`. Alternatively use
`pnpm --filter @zhiju/workspace-web dev:fixture` for Vite development.
Fixture builds are marked as development artifacts and the static server refuses
them unless `NODE_ENV=development`. Production builds prune the fixture adapter,
reports and simulated execution adapters, including when a development environment switch or
fixture mode is supplied with `NODE_ENV=production`.

The anonymous JSON/Markdown materials in `src/fixtures` originate from the
approved `.vibe/prototypes/workspace-mvp` baseline. They remain development/test
materials and are not production wire contracts. Local ZIP bytes are never read,
uploaded or unpacked. The reusable creation and intake pages live in `src/intake`. Production uses
only the authorized directory and explains unavailable creation/upload operations.
`src/fixtures/intake.tsx` supplies isolated in-memory presentation actions. Only
explicitly importing the fixed ZIP scenario into `DEMO-PROJECT-01` can return
its fixed report; arbitrary ZIP selections and newly created demonstration
projects stop at a synthetic waiting receipt. Inputs freeze on submission,
UNKNOWN never resubmits, and status updates never navigate automatically.
Creation requires explicit existing-customer ID selection or NEW mode; names
never establish identity. This onboarding state resets on reload and does not
claim saved drafts or real creation/upload success. Demo selections and exact request references
use a separate, validated tab-local sessionStorage key; this is not server-backed
personal draft or business persistence. Clearing the key clears only demo state.

The configured `full` gate includes independent builds, production rejection and
controlled Chromium tests. `pnpm exec playwright install chromium` installs the
pinned test browser; CI installs it with system dependencies. Browser screenshots
are synthetic and remain local under ignored `test-results/`. These tests do not
certify real OIDC, public business HTTP, Runner, Chrome/Edge platform support or
independent human business acceptance.

## Exact Markdown review

`MarkdownReviewPage` is the shared, typed presentation component for #279 and
continued #286 page work. It owns navigation and the single unsaved opinion area;
`MarkdownReview` supplies authorized content, paged changes and download actions.
The page has no transport or credential dependency. Development adapters must use
this component rather than creating a second review page.

The authenticated `/projects/:projectId/artifacts/:artifactId/revisions/:revisionId`
route reads a sealed Revision through the four finite ART review/download queries.
The server-side `markdownReviewLink` helper encodes exact references read back from
lawful owning setup, including an optional explicit baseline and registered
Representation. A link supplies identity only; Core rechecks scope, content hashes,
current Human authorization and stored bytes. It never supplies a storage URL or
an authorization ticket.

Configure `createWorkspaceCoreFromEnv(env, { markdown })` with owning
`MarkdownReviewService`, `MarkdownRepresentationService` and the explicit
operation-to-capability map. Their storage, renderer digest, 256-bit token keys,
current IdentityPolicy authority and server-only `MarkdownRenderService` must be
provided by trusted composition. Missing dependencies return 503. Rendering and
registration are not browser routes. Existing lawful Human ART handlers establish
the sealed content; this slice adds no generation or TE directory producer.

The download query grants a ticket valid for at most 60 seconds. The browser sends
it in `x-markdown-download-ticket` with CSRF to the fixed same-origin
`/api/markdown-representations/:representationId/content` GET. Core and BFF enforce
current authorization/session, metadata, byte limits and stream cancellation.
The browser verifies complete length and SHA-256 before offering the attachment.
Tickets and content are not stored in browser persistence.

`workspace-built-browser.test.ts` includes the controlled #279 journey through
real PostgreSQL, synthetic OIDC HTTP, Core/BFF and the production SPA. It traverses
36 changes in 9 chapters, retains one unsaved note, inspects all 12 table columns,
and downloads the same registered bytes twice. Feedback submission, durable drafts
and approval remain unavailable. Production integrations, the full Windows/macOS
Chrome/Edge matrix and independent Human content acceptance remain NOT RUN.

The shared analysis experience lives in `src/analysis`: exact report presentation,
four overview summaries, routed detail views, deduplicated request selection and
editable clipboard/manual-copy preview. One contextual composer retains separate
customer, consultant and single-file plan drafts in page-session memory. Explicit
submission freezes a snapshot while subsequent edits remain unsent. History is
read-only; a newer report requires an explicit switch, preserves old drafts and
asks for context rechecking. Narrow screens switch the same page between report
reading and the single composer, retaining both contexts. Scope eligibility is supplied separately, never
derived from report prose.

`src/fixtures/analysis.tsx` is a development-only adapter for the checked-in report
examples. Only its explicitly imported fixed supplement may offer the fixed
follow-up report. Arbitrary attachment names/text cannot produce a conclusion.
Failure, unavailable, UNKNOWN and mismatched receipt scenarios stay beside the
composer. Plan-opinion pending presentation affects only its identified file.
The production report route remains unavailable until the owning public read and
command capabilities exist; fixture data and simulated receipts are pruned from
production. No browser customer-data storage or server-draft claim is added.

The shared file-progress page lives in `src/execution`. It displays only confirmed
scope members and supplied file states, validates exact candidate context, and
keeps each round's search, filter, scroll and disclosures in session memory.
Allowed single-file retries lock one intent before submission; pending or UNKNOWN
receipts cannot create a duplicate. Readback uses that same intent and does not
claim execution. Existing candidates and failure history remain independent.
Production progress reads and retries remain unavailable until owning operations
are registered and authorized; the page never falls back to fixtures.

`src/fixtures/execution.tsx` supplies explicit memory-only events with no timers:
open `/projects/DEMO-PROJECT-01/executions/WB-SCOPE-01` in a fixture build, then
expand the development controls. Exercise mixed results, an independently waiting
later round, long-list scrolling, delayed retry receipts, mismatched receipts,
read errors and expired access. Candidate entries preserve exact version routes;
the development candidate view reuses the existing Markdown review page. It
keeps immutable synthetic versions and an unsaved local note; feedback, approval
and real file-review integration remain separate page work. Reload clears these event
fixtures, without resubmitting a business request. Real Runner progress, retry
authorization, persistence, cross-device drafts and human acceptance remain NOT RUN.
