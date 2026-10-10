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
