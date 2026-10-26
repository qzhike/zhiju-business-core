# Project Documentation

Start with the [mvp-v1-release plan and checklist](mvp/mvp-v1-release.md) for the current release. The [roadmap](product/roadmap.md) provides Current / Next / Later direction; it does not duplicate checklist state.

| Purpose | Entry point |
|---|---|
| Release milestones and human/agent tracking | [Release plan](mvp/mvp-v1-release.md) |
| Product scope and preservation/recovery requirements | [Usable loop](mvp/usable-loop.md) |
| Implement or review a specific change | [HL-Spec](high-level-docs/HL-Spec.md), then the affected [Module Spec](module-specs/) and [Module Test](module-tests/) |
| Verification and local operation | [Verification baseline](high-level-docs/08-verification-baseline.md), [runbooks](runbooks/) and [project configuration](project.yaml) |
| Existing technical constraints | [Decisions](decisions/README.md), [API contract](api-contract-v0.1/), [Runtime contract](runtime-adapter-contract-v0.1/), [technology/security baselines](implementation-milestone-plan-v0.1/) |
| Historical evidence | GitHub Issue/PR, [formal reviews](reviews/README.md) and [archive index](archive/README.md) |

Superseded release/refactoring plans and previous roadmap history have moved out of the active reading path. Their unique constraints and evidence are preserved. Specifications, test inputs, workflow configuration, and formal review records must not be removed merely because the current release does not require every old feature.

The release checklist is explicitly requested by the user. Detailed execution evidence remains in the relevant Issue/PR or controlled local evidence until publication is authorized; do not create duplicate task logs or another tracking platform.
