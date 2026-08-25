# IM-03 WI-03 Task Plan

对应 Issue: #59

## 目标

实现 Enterprise、EnterpriseFact、EnterpriseProfileSnapshot、Product 与 QMSConfiguration 的最小纵向切片。

## 硬依赖

- #57 (WI-01 决策矩阵) — 已 CLOSED
- #58 (WI-02 Application/Persistence 基础) — 已 CLOSED

## Stages（PR #72 审查修正）

1. 复核 PR #72 精确 head、Issue 关联、实际 diff 与原始 CI 证据。`PASS`
2. 修订 HL-Spec、Module-Spec、Module-Test 与 WI-03 交付记录，使其反映真实契约和审查边界。`PASS`
3. 修正公开 Handler 契约、principalKind 绑定、强引用、Aggregate/Event 版本、QMS 初始状态、重复码事务和 Profile Payload。`PASS`
4. 增补 focused PostgreSQL 正负用例：错误 objectId/hash、缺失 principalKind、重复 Product 码、QMS 非 ACTIVE、Reference Edge 和连续 event version。`PASS`
5. 先 build workspace 包，再执行 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm architecture`、`pnpm contracts:check`、`pnpm persistence:gate`。`PASS`
6. 形成 `.vibe/codex-pr-72-review/Review-Record.md`，记录原始 findings、修正、精确 head、验证和 `NOT RUN`。`PASS`

## Non-goals

- Project、Material、Baseline、Gap、DeliveryPlan；
- 跨模块跨 Schema Join；
- HTTP 适配 / Feishu / 真实 Provider；
- 公开 Catalog 扩展；
- IdentityPolicy 业务模型复制。

## 关键决策

- 业务 Aggregate Root 拥有自己的 `aggregate_version` 列；不与 `process_instance.aggregate_version` 共享 CAS。
- 受控 Capability 不进入 200 项 Catalog；Module Spec §8.1 已声明。
- Human-only 边界通过受信 transaction context 与 Command Envelope 中一致且必填的 `principalKind` 判定；缺失或任何非 HUMAN 路径均抛 `PROJECT_HUMAN_ONLY_DENIED`。
- 跨 Enterprise Ref 在 Profile Snapshot Handler 解析时拒绝。
- 本地 Git 交付边界仍待用户确认；确认前不执行 Commit、Push、PR Merge 或 Issue Close。
