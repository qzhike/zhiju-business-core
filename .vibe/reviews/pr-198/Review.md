# PR #198 独立审查

## 当前结论（第 3 轮：人类安全技术审查确认）

- 结论：`APPROVE`
- Reviewed SHA：`9704ee35fed8631d34ad14307c6d23e99cbff308`
- Base SHA：`9033a677fa4c28aa53920f7038dfa8d16795eb4f`
- PR：[#198](https://github.com/qzhike/zhiju-business-core/pull/198)
- Work item：[#192](https://github.com/qzhike/zhiju-business-core/issues/192)（T2）
- 确认日期：2026-09-14

当前会话中的人类审查者已针对远端仍精确指向 `9704ee35fed8631d34ad14307c6d23e99cbff308` 的 PR #198 明确确认“审核通过”，完成 Issue #192 要求的安全人类技术审查。该确认与第 2 轮独立复审共同关闭全部已知门禁：R1、R2 已在该 SHA 修复且没有发现新的实现、契约、范围或验证阻断；精确 SHA 的 required CI 已通过。因此 Reviewer 最终结论更新为 `APPROVE`。

TE Completion 消费、跨模块完整业务链、公开 HTTP、外部 Provider、生产和独立人工业务验收仍保持 `NOT RUN`，不扩大本次 Producer 侧审查范围。本结论不授权 merge 或 deploy。此第 3 轮记录属于被审 SHA 之后产生的 review evidence；将其提交到 PR 会形成仅含审查文档的新 head，该最终 head 仍须通过 required CI，且不得包含业务代码变化。

## 第 2 轮：修复复审

- 结论：`HUMAN_REVIEW_REQUIRED`
- Reviewed SHA：`9704ee35fed8631d34ad14307c6d23e99cbff308`
- Base SHA：`9033a677fa4c28aa53920f7038dfa8d16795eb4f`
- PR：[#198](https://github.com/qzhike/zhiju-business-core/pull/198)
- Work item：[#192](https://github.com/qzhike/zhiju-business-core/issues/192)（T2）
- 复审日期：2026-09-14

本轮重新读取了 Issue #192、精确 PR head、`a5f8fc0..9704ee3` 修复 diff、受影响的 QualityGovernance Spec/Test 与共享 API/Catalog 条款、Approval/RAS/ABS owning 实现、新增 PostgreSQL 回归和 revision-bound GitHub Actions 证据。本地 `HEAD` 与 PR head 均为上述 SHA，进入复审时工作树干净。

第 1 轮 R1 已关闭。ABS 构建现在只计入 `revision_acceptance_snapshot_ref` 与该 bundle 自身 RAS 完整相等的 Approval；资格复核也要求 Approval anchor 与 bundle 的 `revisionAcceptanceSnapshotRef` 在身份、Scope 和 payload hash 上精确一致。QG-TD-006 通过正常 Handler 证明 RAS-1 的 Approval 不会使 RAS-2 的 bundle 成为 `FULLY_APPROVED`，并通过修复前形态的历史 bundle 证明 Query 自身仍会 fail-closed。

第 1 轮 R2 已关闭。组合入口在验证 exact Decision/Purpose/Scope/payload/current grant 后，对受信 `principal_kind` 执行 `HUMAN | SERVICE` allowlist；owning Handler 以同一 allowlist 做第二层拒绝。QG-TD-007 使用真实 IdentityPolicy Principal、ActorSnapshot、active grant 和 ALLOW Decision 证明 AGENT/RUNTIME 仍在组合入口被拒绝，SERVICE 正向保持通过，并覆盖 owning Handler 对 EXTERNAL_PARTY 的拒绝。

修复增量没有改变静态 payload/result Contract、Catalog/Registry 计数、历史 Snapshot Query 或 `get_release_readiness_snapshot(requireCurrentForAuthorization)` 的行为；没有发现新的实现、契约、范围或验证阻断。精确 reviewed SHA 的 GitHub Actions [run 34845429025](https://github.com/qzhike/zhiju-business-core/actions/runs/34845429025) 为 `completed / success`，`headSha=9704ee35fed8631d34ad14307c6d23e99cbff308`；verify job [103980094778](https://github.com/qzhike/zhiju-business-core/actions/runs/34845429025/job/103980094778) 的 `pnpm verify` 成功。交付证据记录普通测试 922 passed / 373 skipped、persistence 388/388、PostgreSQL 18.6 / Flyway 11.20.3 空库迁移和二次 no-op 通过；`git diff --check` 对修复增量通过。

TE Completion 消费、跨模块完整业务链、公开 HTTP、外部 Provider、生产和独立人工业务验收继续为 `NOT RUN`，与 Producer 侧已验证范围保持分层。

Issue #192 将“安全的人类技术审查”列为独立项目门禁；当前 GitHub 记录明确说明本次修复与 agent 复审不构成该人类审查，也没有可读取的人类确认。因此实现缺陷已关闭后，剩余结论为 `HUMAN_REVIEW_REQUIRED`，不能提前写成 `APPROVE`。该人类 Gate 完成并记录 exact SHA 后，才能更新最终 Reviewer 结论；本结论不授权 merge。此第 2 轮记录是在被审 SHA 之后生成的 review evidence，只能作为后续文档提交，不能声称已包含在 `9704ee3` 中。

## 第 1 轮

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`a5f8fc0b4625388627072f5e44e50b2d49fe8184`
- Base SHA：`9033a677fa4c28aa53920f7038dfa8d16795eb4f`
- PR：[#198](https://github.com/qzhike/zhiju-business-core/pull/198)
- Work item：[#192](https://github.com/qzhike/zhiju-business-core/issues/192)（T2）
- 审查日期：2026-09-14

本轮独立读取了 Issue #192 正文与评论、精确 PR head/diff、QualityGovernance Module Spec/Test、共享 Query/Registry/Typed Reference 契约、TaskExecution TD-03 下游边界、授权组合入口、Quality owning Handler、Approval/RAS/ABS 既有实现以及精确 revision 的 GitHub Actions 证据。未采用实现者摘要作为正确性依据，未修改业务代码或测试。

本文件按项目正式 pre-close review 要求保存，记录实际被审 SHA。它没有预填包含本文件的未来提交；修复与本文件进入 PR 后，应对新的 final head 重新复审。

## 阻断发现

### R1 / P1：新 RAS 的 ABS 可复用旧 RAS Approval，导致当前批准资格误报 `true`

`handleSubmitApprovalDecision` 在 `quality-review-approval-handlers.ts:1547–1553` 为新 ABS 收集 Approval 时，只按 Enterprise/Project、Revision 和 QualityProfile 过滤，没有要求 Approval 的 `revision_acceptance_snapshot_ref` 等于本次构建 ABS 的 RAS。`buildApprovalBundleSnapshot` 在 `:637–646` 又会把这些跨 RAS 的旧 `EFFECTIVE + APPROVED` Approval 一并计数并据此产生 `FULLY_APPROVED`。

新 Query 的复核没有关闭该缺口：`approvalBundleEligibility` 在 `quality-gate-handlers.ts:2535–2545` 只要求每个 Approval 锚定的历史 RAS 仍保存为 `READY`，没有要求它等于 bundle 的 `revisionAcceptanceSnapshotRef`，也没有要求该 anchor 仍是 Revision/Profile 的最新 RAS。

因此可以通过公开 owning Handler 形成正常反例：RAS-1 READY 并有 Approval-1；随后同 Revision/Profile 产生更新的 RAS-2；再对 RAS-2 提交一个 `CHANGES_REQUESTED`/`REJECTED` 决定。新 ABS 仍会用 Approval-1 满足 required count，绑定 RAS-2 并标成 `FULLY_APPROVED`；资格 Query 对 bundle 的 RAS-2 当前性检查通过，对 Approval-1 的 RAS-1 只检查历史 `READY`，最终可能返回 `approvalBundleUsable={presence:'PRESENT',value:true}`。这违反 Issue #192 要求的“当前批准集合”以及 Approval 与精确 RAS/Gate/Review 链关联，可能让后续 TE Completion 在没有针对当前 RAS 的有效批准时获得执行资格。

请在资格复核中要求每个计入 bundle 的 Approval 精确锚定 bundle 自身的当前 `revisionAcceptanceSnapshotRef`（完整 ref/hash/scope/identity），并同步修正 ABS 构建时跨 RAS 汇总 Approval 的行为；增加真实 PostgreSQL 回归覆盖“RAS-1 approved → RAS-2 → RAS-2 rejection/changes requested”，断言新 bundle 不能 `FULLY_APPROVED`，Query 不能返回 approval usable。

### R2 / P1：授权入口没有限制为 TE Evaluator Service 或授权 Human

Issue #192 的 Acceptance 明确限定该 Query 只允许目标 Scope 内的 TE Evaluator Service 或授权 Human。当前入口在 `revision-eligibility-entry.ts:232–241` 只验证精确 Purpose 和由配置传入的 capability grant；owning Handler 在 `quality-gate-handlers.ts:2306–2312` 也只检查 `authorizationPurposes`，从未检查受信 Decision 的 `principal_kind`。

IdentityPolicy 的通用授权路径只会在 requested capability 属于静态 Human-only 集合时拒绝非 Human；该集合只有 `quality.approval.decide`、`release.authorize` 和 probe，不含 `quality.revision.execution_eligibility.read`。因此 AGENT、RUNTIME 或 EXTERNAL_PARTY 只要被授予同 Scope 的该 capability，就会取得 ALLOW Decision、通过 `checkProjectAccess` 并进入 Quality Handler。现有 QG-TD-003 只验证错误 Purpose/Session/Scope，没有覆盖非法 principal kind。

请在受信组合边界显式执行本操作的 principal-kind allowlist（`HUMAN | SERVICE`），并确保 Service 通过专用 evaluator capability 而不是通用/通配路径；增加真实 IdentityPolicy negative cases，至少证明带精确 Purpose、Scope、payload 和 active grant 的 AGENT 与 RUNTIME 仍被拒绝。仅依赖部署时“不发 grant”不足以满足该公开安全契约。

## 其余核对结果

- Query 静态注册的 type/version、Owner、AUTHORITATIVE consistency、Purpose、classification、payload/result 字段与批准设计一致；Catalog/Registry 从 212 增至 213，历史 200 项 compatibility baseline 未改写。
- `ValueEnvelope<boolean>` 正确区分 `PRESENT` 与 `NOT_APPLICABLE`；未请求 ABS 时省略 `approvalBundleRef`，没有伪造布尔值。
- exact Revision/RAS/ABS 的 hash、Scope、Revision/Profile 绑定、Gate invalidation、Approval revocation、旧历史 Query 保留和只读行数检查均有对应实现与 PostgreSQL 测试；R1/R2 之外，本轮未发现需要新规划或 scope 扩展的阻断。
- TE Completion 消费、跨模块完整业务链、公开 HTTP、外部 Provider、生产和独立人工业务验收继续为 `NOT RUN`，本审查不把 Producer 侧 PostgreSQL 覆盖解释为这些层级已通过。

## 验证证据

精确 reviewed SHA 的 GitHub Actions [run 34833432260](https://github.com/qzhike/zhiju-business-core/actions/runs/34833432260) 为 `completed / success`，`headSha=a5f8fc0b4625388627072f5e44e50b2d49fe8184`；verify job [103941796370](https://github.com/qzhike/zhiju-business-core/actions/runs/34833432260/job/103941796370) 的 `pnpm verify` 成功。PR 交付记录给出普通测试 922 passed / 371 skipped、persistence 386/386、PostgreSQL 18.6 / Flyway 11.20.3 空库迁移与二次 no-op 通过；`git diff --check` 对完整 PR diff 通过。

绿色 gate 不关闭 R1/R2：当前套件没有覆盖跨 RAS 的 Approval 复用，也没有证明持有精确 grant 的非法 principal kind 被拒绝。

## 交接

修复 R1、R2 并在新 PR head 上取得 required verification 后，需要重新读取新 SHA、diff、契约和新增回归再给出 Reviewer 结论。Issue 要求的独立人类安全技术审查仍是后续合并前门槛；应先关闭已知实现缺陷，再进入该人类 Gate。本审查不授权修复、merge 或 deploy。
