## Status

`IN PROGRESS / WI-01 IMPLEMENTATION COMPLETE / PARENT EXIT GATE OPEN`

## Goal

Deliver and accept IM-05 Quality + Release + Renderer as a scoped engineering milestone on top of the completed IM-04 Artifact + Canonical Content baseline. This parent gate must prove immutable quality, Human approval, render binding, frozen release package, formal publication provenance, partial outcome, and recall behavior without expanding local or synthetic evidence into production or external acceptance.

## Authority

- Implementation Milestone Plan v0.1 — IM-05 Quality + Release + Renderer
- Module-Spec/Test-005 QualityGovernance
- Module-Spec/Test-006 ReleasePublication
- Module-Spec/Test-007 IntegrationGateway renderer boundary
- Module-Spec/Test-004 Artifact Representation and exact query boundary
- IM-04 parent #89 and PR #119
- IM-DG-003 and IM-DG-005 approved decisions

## Entry evidence

- IM-04 parent #89 and children #90–#98 are closed.
- PR #119 is merged at exact verified head `28e3c51e569c414f6bbe29a2a501f8abcf91b16a` into `origin/main@ad1822a3656ed1af7e8471bd83d32f3637868779`.
- Effective IM-04 implementation heads are ancestors of `origin/main`.
- Catalog/Registry is 201/201 FULL; frozen v1.0 compatibility baseline remains 200 operations.
- Real Ceph/OpenBao, external Renderer/Publisher, public HTTP, production, real customer applicability, and independent manual business acceptance remain `NOT RUN` and are not entry blockers for scoped local engineering.

## Work items

- [x] #121 — QualityGovernance application and persistence foundation
- [ ] #122 — Evidence, EvidenceLink, and QualityProfile lifecycle
- [ ] #123 — Gate results, impact reuse, and readiness snapshots
- [ ] #124 — ReviewIssue remediation, Human Approval, and approval bundle snapshots
- [ ] #125 — minimal DOCX/XLSX Renderer and authoritative Representation loop
- [ ] #126 — ReleasePublication persistence and frozen package lifecycle
- [ ] #127 — release readiness, authorization, publication, receipt, partial completion, and recall
- [ ] #128 — synthetic QMS/REL-801 exit evidence and parent review
- [ ] #22 — Release Authorization actor provenance at runtime
- [ ] #23 — Formal Receipt providerResult PII minimization
- [ ] #24 — Formal Release provenance against ordinary Feishu sends

Issue #27 remains the broader IntegrationGateway handler/adapter/persistence umbrella. Only its IM-05 Renderer slice is in #125; IM-05 does not claim all Feishu or CLI adapter scope from #27.

## Exit acceptance

- [ ] All new IM-05 work items and carried runtime items #22/#23/#24 are closed with their effective heads on `main`.
- [ ] Required HL-Spec, Module Spec, Module Test, migration, runbook, and review records match the delivered exact head.
- [ ] QualityGovernance proves immutable Evidence/Profile/Gate/Issue/Approval/RAS/ABS/RRS history, Human-only decisions, separation of duties, stale impact, and exact Artifact/Representation binding.
- [ ] The minimal Renderer produces deterministic DOCX/XLSX outputs from exact canonical revisions and registers immutable Representations only through authoritative RenderAttempt binding.
- [ ] ReleasePublication proves frozen Package/Destination, latest readiness revalidation, Human-only authorization, stable publication idempotency, Raw-to-Formal Receipt provenance, partial success, failure/UNKNOWN, completion, and append-only recall.
- [ ] Clean migration, second no-op migration, focused tests, full repository gates, disposable PostgreSQL negative probes, and test cleanup pass on the exact delivery head.
- [ ] Reviewer-readable synthetic QMS/REL-801 evidence includes exact refs, hashes, checksums, actors, snapshots, attempts, receipts, expected/actual output, and cleanup.
- [ ] Generated DOCX/XLSX files are independently opened and inspected with sanitized evidence; unsupported layout fidelity remains explicit.

## Manual output

Provide one sanitized procurement-procedure review package containing the source revision, Evidence chain, QualityProfile, GateResults, ReviewIssue remediation, RAS, Human Approval/ABS, DOCX/XLSX Representation checksums, RRS, frozen ReleasePackage hash, two-destination publication timeline, Formal Receipts, partial/final state, recall impact, commands, environment, expected versus actual output, and cleanup. Label synthetic portions `SYNTHETIC / TECHNICAL ONLY`.

## Non-goals and preserved NOT RUN

- No Workspace UI, Feishu channel product flow, CLI runtime automation, or IM-09 integrated reference project.
- No production deployment, HA, load, backup/restore, or production data migration.
- Real Ceph RGW/OpenBao conformance, real external Publisher/Provider, public HTTP E2E, and real customer applicability remain `NOT RUN` unless direct evidence is attached.
- Controlled browser/agent/manual file inspection does not become independent customer acceptance.
- This issue does not authorize implementation, branch creation, PR creation, merge, closure, or cleanup by itself.
