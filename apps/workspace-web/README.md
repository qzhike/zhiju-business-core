# Workspace Web engineering shell

This independent React SPA implements the approved first-use layouts. Business
authentication and public HTTP integration are not registered in this shell.
The production app shows a safe configuration error and enables no business action.

Install from the repository root with `pnpm install --frozen-lockfile`.
Build independently with `pnpm --filter @zhiju/workspace-web build`.
`pnpm --filter @zhiju/workspace-web start` serves the static artifact on loopback
port 3100 and forwards `/bff/*` to the fixed `BFF_URL` (default
`http://127.0.0.1:3101`). Use an HTTPS reverse proxy for production. The server
allows only declared SPA page routes; API requests and missing assets stay errors.

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
