# Workspace BFF engineering shell

This independent NestJS/Fastify process owns the Experience transport boundary.
It imports no business packages, repositories, database or provider clients.

The BFF explicitly passes its approved Fastify 5.12.0 instance to Nest 11.2.1.
Nest's adapter declares against its older transitive Fastify 5.11.3, so a narrow
constructor type bridge stays at that boundary. Native request hooks retain the
5.12 types; built-application checks verify the actual version and HTTP behavior.
Existing Core transport dependencies are unchanged.

```sh
pnpm install --frozen-lockfile
pnpm --filter @zhiju/workspace-bff build
pnpm --filter @zhiju/workspace-bff start
```

`PORT` defaults to 3101; the server listens on loopback for a same-origin reverse
proxy. `GET /bff/health` reports process health and whether the trusted session
integration is configured. `GET /bff/bootstrap` reports reauthentication required
and business actions disabled; it returns no identity, tokens or credentials.

With a valid `ZHIJU_WORKSPACE_TRUST_CONFIG` deployment document the BFF is the
trusted Human session boundary: OIDC Authorization Code + PKCE sign-in with the
closed callback acceptance set, separate ID/access-token validation, bounded
single-process sessions with CSRF/Origin/Host protection, single-flight refresh,
logout and the finite allowlisted query proxy to the fixed Core origin. Without
that configuration it keeps the shell contract: every business request returns a
safe 503 JSON error, no session or identity is produced and development switches
cannot enable a fixture execution route. Missing production values are startup
rejections, never guessed defaults.

The BFF never uploads files, accepts reports or fabricates Runner receipts, and it
holds no business drafts, original intents or receipts. Request logging is
disabled and error responses use a fixed safe message with a random correlation
id; tokens, cookies, the external subject and customer content are never logged
or echoed. Real Keycloak, Core HTTP and manual acceptance remain `NOT RUN`.

Three session invariants are enforced structurally:

- `X-Forwarded-Proto`/`X-Forwarded-Host` are accepted only as a single
  well-formed pair from an allowlisted proxy peer, and they resolve the served
  destination's Host alone. The request's own `Origin` header is never replaced;
  a missing, `null` or foreign Origin is rejected with 403 and zero Core calls
  even through an allowlisted proxy.
- Each login transaction carries the generation of its browser binding. A
  callback completes that generation by compare-and-set, so concurrent callbacks
  issued under one browser binding elect exactly one winner; the winner advances
  the generation and invalidates the session it replaces, so the superseded
  session cookie never resolves to `ALLOWED` again. Distinct browser bindings and
  principals stay independent.
- Every awaited protected read rechecks the exact session record's identity,
  generation and expiry after the Core call and before any body is written; a
  logout completing mid-flight turns the response into a safe `401`
  `UI_REAUTH_REQUIRED` with no payload.
