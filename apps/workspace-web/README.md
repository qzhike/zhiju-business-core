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
reports and execution code, including when a development environment switch or
fixture mode is supplied with `NODE_ENV=production`.

The anonymous JSON/Markdown materials in `src/fixtures` originate from the
approved `.vibe/prototypes/workspace-mvp` baseline. They remain development/test
materials and are not production wire contracts. Local ZIP bytes are never read,
uploaded or unpacked. The next report is always the fixed anonymous fixture,
independent of the selected filename. Demo selections and exact request references
use a separate, validated tab-local sessionStorage key; this is not server-backed
personal draft or business persistence. Clearing the key clears only demo state.

The configured `full` gate includes independent builds, production rejection and
controlled Chromium tests. `pnpm exec playwright install chromium` installs the
pinned test browser; CI installs it with system dependencies. Browser screenshots
are synthetic and remain local under ignored `test-results/`. These tests do not
certify real OIDC, public business HTTP, Runner, Chrome/Edge platform support or
independent human business acceptance.
