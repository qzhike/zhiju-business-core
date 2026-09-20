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

## Project boundaries

- Preserve module ownership and public contracts. Update affected authority
  documents and failure scenarios before implementation changes.
- Use `vibe repo --json` for repository identity and revision.
- Use the smallest sufficient target named by the work item and run it only
  through `vibe verify <target> --json`:
  - `docs` for a strict documentation-only change limited to Markdown under
    `.vibe/` or the repository README;
  - `code` for non-persistence implementation while a Pull Request remains Draft;
  - `full` for ready non-document Pull Requests, migrations, SQL, persistence
    tests or tooling, module persistence code, verification-policy changes, and
    unknown or mixed high-risk scope.
    The `full` target includes a clean build and the Docker/PostgreSQL persistence
    gate. Focused diagnostics do not replace the required configured target.
- Prefer trustworthy current exact-revision CI evidence. Do not rerun the same
  configured target locally merely to duplicate it; use a focused counterexample
  when independent semantic review requires evidence beyond the configured gate.
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
- After authorized merge, read back remote state and update durable documents
  only where their truth or forward intent changed.
