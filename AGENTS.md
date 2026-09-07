# Project Agent Instructions

Use `vibe-development` and the role appropriate to the current request. Read
[project configuration](.vibe/project.yaml) before implementation or verification.

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

## Project boundaries

- Preserve module ownership and public contracts. Update affected authority
  documents and failure scenarios before implementation changes.
- Use `vibe repo --json` for repository identity and revision.
- Run the configured full verification with `vibe verify full --json`.
  It includes a clean build and the Docker/PostgreSQL persistence gate.
  Focused diagnostics do not replace this gate.
- Preserve distinct design, local, persistence, external, and manual evidence.
  Unexecuted acceptance remains `NOT RUN`.
- Do not commit without explicit user authorization. Push and merge also require
  authorization; keep unrelated changes and worktrees intact.
- Preserve required HL-Spec, Module-Spec, Module-Test, and pre-close review
  documents under `.vibe`. Put execution/acceptance evidence in GitHub Issue/PR;
  do not create parallel task plans, verification logs, or delivery reports for
  ordinary work. Find historical records through `.vibe/README.md`; preserve their evidence and
  reconcile unique constraints before treating them as obsolete. New formal review
  records belong in `.vibe/reviews/pr-<number>/Review.md`.
- After authorized merge, read back remote state and update durable documents
  only where their truth or forward intent changed.
