# PR #198 独立审查

## 当前结论（第 1 轮）

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
