# Project Agent Instructions

Use `vibe-development` and the role appropriate to the current request. Read
[project configuration](.vibe/project.yaml) before implementation or verification.

## Short requests

Recognize intent from ordinary language; the user does not need to name the
skill or paste a template. For the requests below, load `vibe-development` and
the selected role, then follow the existing project reading and evidence rules.
Examples are intent cues, not exact-string commands; substitute the milestone,
Issue, or PR the user actually named.

| User request              | Role and default scope                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “开始 IM-06 的项目规划”   | Planner: check milestone prerequisites, current implementation and contracts; identify gaps, decisions, exit criteria and the first NOW + READY candidates. Update durable planning documents only where their truth changes. Do not create Issues or write business code.                     |
| “按确认的规划创建任务”    | Planner: resolve the confirmed plan, check existing Issues, publish only the selected NOW + READY Issues and read them back. This authorizes Issue creation, not implementation or Git delivery.                                                                                               |
| “实现 #151”               | Implementer: read the latest Issue and comments, resolve readiness, implement the stated scope locally and verify. Do not commit, push or create a PR without applicable authorization.                                                                                                        |
| “审核 PR #152”            | Reviewer: independently review the latest head, Issue, contracts, diff and evidence. Report the role outcome and reviewed SHA; do not repair product code or merge. Preserve any required formal review document.                                                                              |
| “修复 PR #152 的审查问题” | Implementer: confirm findings against the current head and authority, make in-scope fixes and verify locally. Git delivery requires applicable authorization.                                                                                                                                  |
| “合并 PR #152”            | Delivery, then Planner reconciliation: this authorizes merging the named PR after final-head review, required checks and review-document requirements pass. Read back remote state and update changed durable facts or forward intent. It does not waive gates or authorize unrelated cleanup. |

Use current conversation context to resolve “the confirmed plan” or “this PR”.
If the target or material decision cannot be resolved, ask one concise question;
do not invent an identifier, approval or product requirement. Existing scoped
authorization persists: do not ask again for an action already authorized.
“继续” continues the current scope; it does not by itself expand Git or external
write authorization. Explicit user limits such as “只分析，不修改文档” override
these defaults.

“提交” authorizes the identified local changes to be committed; “推送” authorizes
the identified commits to be pushed. Neither alone authorizes merge. Planning
and local implementation do not implicitly authorize Issue/PR publication.
When the skill is unavailable, report the missing dependency rather than claim
it was loaded. Do not implement this routing as a runner, state file, or automatic
model launch, and do not repeat the full routing template in every response.

## Read by role

- Planner: read the [roadmap](.vibe/product/roadmap.md), the user goal, and relevant
  authority sections. Create GitHub Issues only for NOW + READY work.
- Implementer: read the latest Issue and comments, affected Module Spec/Test, and
  referenced contracts. Do not preload milestone history or unrelated modules.
- Reviewer: independently read the latest PR head, Issue, diff, affected contracts,
  and verification evidence. Review the new head after fixes.

The [HL-Spec](.vibe/high-level-docs/HL-Spec.md) defines authority precedence,
frozen rules, and topic routing. On first entry or when changing frozen rules,
read sections 1–6 and 8–11. Otherwise locate relevant rules and authority sections.
Historical sections retain useful constraints but do not define current execution
status. Never silently resolve a conflict between an Issue and a contract.

## Delivery planning

Apply the shared Planner's independent delivery goal and first-version acceptance
principles using the [project acceptance policy](.vibe/high-level-docs/08-verification-baseline.md#28-首版可用验收与任务粒度).
Planner, Implementer, and Reviewer use the agreed scope and acceptance consistently.

The approved [batch delivery design](.vibe/decisions/batch-integration-ci.md)
defines staged acceptance. Phase one is prepared locally; remote activation and
platform acceptance are separate. Until `VIBE_BATCH_DELIVERY_ENABLED` is exactly
`true` in repository variables after required protections are verified, retain
the existing risk routing below. A branch name, design approval, or local setting
does not establish remote activation.

Once activated, ordinary business, UI, and urgent PRs first enter a same-repository
`batch/<goal>` branch; a batch may contain one PR. Children require `docs` or `code`,
their declared focused behavior checks, and independent review. Engineering,
verification-policy, and unknown paths retain `full`. Direct business PRs to main
are rejected even if their full run passes. Strict independent documentation may
go directly to main; bootstrap engineering PRs use the existing full route before
activation. Freeze the batch, reconcile current main, and review the cumulative
candidate with full before main delivery. Phase one retains post-merge main full,
including documentation-only batches; same-code-tree evidence reuse is deferred.
Use [the verification policy](.vibe/high-level-docs/08-verification-baseline.md#212-批次交付第一阶段)
for activation, failure recovery, and evidence boundaries.

## Project boundaries

- Preserve module ownership and public contracts. Update affected authority
  documents and failure scenarios before implementation changes.
- Use `vibe repo --json` for repository identity and revision.
- Use the smallest sufficient target named by the work item and run it only
  through `vibe verify <target> --json`:
  - `environment` is a read-only Docker capability and pinned-image baseline
    probe. Run it once before the first local `full` target in a new or materially
    changed container runtime, or after a container/registry failure; reuse a
    successful result. It does not replace `code`, `full`, CI or persistence
    evidence;
  - `docs` for a strict documentation-only change limited to Markdown under
    `.vibe/` or the repository README;
  - `delivery` for focused CI routing and admission regression checks; this does
    not replace the required `full` for verification-policy changes;
  - before batch activation, `code` for Draft or ready Pull Requests whose complete diff contains only
    the explicit low-risk UI allowlist and optional strict documentation; see
    [verification routing](.vibe/high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由).
    This still includes the workspace build and browser checks;
  - before batch activation, `full` for non-document main pushes, Core/business/security/contract or
    persistence changes, dependency/build/verification-policy changes, and
    unknown or mixed scope. Draft status does not exempt high-risk changes.
    The `full` target includes a clean build and the Docker/PostgreSQL persistence
    gate. Focused diagnostics do not replace the required configured target.
    The persistence tooling respects an explicit `DOCKER_HOST` and otherwise
    derives the active Docker context endpoint on macOS before Testcontainers is
    loaded; it does not force OrbStack or rewrite global Docker configuration.
- Prefer trustworthy current exact-revision CI evidence. Do not rerun the same
  configured target locally merely to duplicate it; use a focused counterexample
  when independent semantic review requires evidence beyond the configured gate.
- CI cancels superseded runs only within the same Pull Request. Main runs remain
  independent; cancellation is not passing evidence for the latest revision.
- Preserve distinct design, local, persistence, external, and manual evidence.
  Unexecuted acceptance remains `NOT RUN`.
- Do not commit without explicit user authorization. Push and merge also require
  authorization; keep unrelated changes and worktrees intact.
- Preserve required HL-Spec, Module-Spec, Module-Test, and pre-close review
  documents under `.vibe`. Put execution/acceptance evidence in GitHub Issue/PR;
  do not create parallel task plans, verification logs, or delivery reports for
  ordinary work. Find historical records through `.vibe/archive/issue-index.md`; preserve their evidence and
  reconcile unique constraints before treating them as obsolete. New formal review
  records belong in `.vibe/reviews/pr-<number>/Review.md`.
- For staged delivery, formal Review documents record semantic findings,
  dispositions, and the stage/target before freezing the final candidate. Confirm
  the final SHA and checks in PR review/comments; do not create a new commit only
  to copy CI success into Review.md. Substantive findings, scope changes, and
  fixes still require document updates and renewed affected review/verification.
  Integration approval does not close the batch product goal; reconcile delivery
  only after authorized main merge and its required post-merge checks.
- After authorized merge, read back remote state and update durable documents
  only where their truth or forward intent changed.
