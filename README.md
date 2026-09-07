# Zhiju Business Core

Zhiju Business Core is a modular monolith for enterprise delivery, quality
governance, and controlled publication. Seven business modules own their domain
rules and persistence boundaries; Workspace UI/BFF is an experience layer.

## Start here

- [Current roadmap](.vibe/product/roadmap.md): near-term direction and unresolved decisions.
- [HL-Spec](.vibe/high-level-docs/HL-Spec.md): frozen rules, authority, and topic routing.
- [Agent instructions](AGENTS.md): Planner, Implementer, and Reviewer entry points.
- [Milestone design](.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md): scope, dependencies, and exit criteria.
- [Module specifications](.vibe/module-specs/) and [test specifications](.vibe/module-tests/): affected-module contracts and acceptance scenarios.

GitHub Issues and PRs hold execution and acceptance evidence. Historical files
under `.vibe` remain available during documentation cleanup; their snapshots do
not replace current issue state or the roadmap.

## Development

Use the Node.js and pnpm versions pinned in `package.json` and `.nvmrc`.
Install dependencies from the lockfile:

```shell
pnpm install --frozen-lockfile
```

Start the API composition application:

```shell
pnpm --filter @zhiju/api start
```

The health endpoint is `GET http://127.0.0.1:3000/health`.

## Verification

With the Vibe CLI installed, run the configured full gate:

```shell
vibe verify full --json
```

The [project configuration](.vibe/project.yaml) resolves `full` to
`pnpm clean && pnpm verify`. It checks formatting, lint, types, tests, architecture,
Catalog/generated contracts, compatibility, and real PostgreSQL persistence.
Docker is required for the PostgreSQL/Flyway gate. See the existing
[database runbook](.vibe/im-02-workitem-issues/runbook-wi-01.md) for prerequisites
and diagnostics; its historical test counts are not current acceptance evidence.

If Vibe is unavailable, the manual equivalent is:

```shell
pnpm clean && pnpm verify
```

A failed Vibe gate must be reported and resolved; the manual command is not a
fallback for bypassing a failed result. Local or synthetic checks do not establish
production, external-provider, or independent business acceptance.
