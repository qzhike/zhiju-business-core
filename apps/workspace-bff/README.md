# Workspace BFF engineering shell

This independent NestJS/Fastify process owns the Experience transport boundary.
It imports no business packages, repositories, database or provider clients.

```sh
pnpm install --frozen-lockfile
pnpm --filter @zhiju/workspace-bff build
pnpm --filter @zhiju/workspace-bff start
```

`PORT` defaults to 3101; the server listens on loopback for a same-origin reverse
proxy. `GET /bff/health` reports process health and unconfigured business integration.
`GET /bff/bootstrap` reports reauthentication required and business actions disabled;
it returns no identity, tokens or credentials. All other requests return a safe
503 JSON error. Development switches cannot enable a fixture execution route.

OIDC certification, sessions, CSRF-protected writes and allowlisted public business
proxies require later integration work. Merely providing environment URLs or a
client secret does not activate them. The shell does not upload files, accept
reports or fabricate Runner receipts. Request logging is disabled and error
responses use a fixed safe message.
