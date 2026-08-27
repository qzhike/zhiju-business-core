## Summary

- re-review and repair the approved IM-04 Artifact and Canonical Content specification
- define a non-self-referential canonical hash domain and separate content-object lifecycle from immutable revisions
- preserve the existing public diff boundary and record the required additive RenderAttempt binding query as the first IM-04 contract gate
- record the user-authorized scoped technical acceptance for IM-03 while retaining all integrated E2E, manual, external, and production `NOT RUN` boundaries

No IM-04 implementation, executable contract, migration, repository, handler, fixture, renderer, development branch, or worktree is introduced by this pull request.

## Verification

- `pnpm clean && pnpm verify`
- Vitest: `24 passed / 17 skipped`; `356 passed / 241 skipped`
- Public API / Catalog / Registry / compatibility: `200 / 200`, all `FULL`
- Disposable PostgreSQL: `21 files / 256 tests`; clean migration; second migration no-op; container removed
- `git diff --check`

Refs #56. The issue will be closed explicitly only after this exact head is merged into `main` and the scoped acceptance amendment is read back from GitHub.
