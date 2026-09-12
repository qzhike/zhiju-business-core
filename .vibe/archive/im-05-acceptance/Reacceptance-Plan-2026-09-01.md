# IM-05 修复后重新验收计划

日期：2026-09-01

## 目标

在用户确认 Issue #22、#23、#24 均已修复后，基于最新 `origin/main` 重新审核 IM-05 父 Issue #120，判断父 Gate 是否达到可验收状态。

## 权威范围

- GitHub Issue #120、子 Work Item #121–#128，以及独立修复 Issue #22、#23、#24 的最新正文、评论、PR、CI 与关闭状态。
- `.vibe/high-level-docs/HL-Spec.md`、相关 Module-Spec 与 Module-Test。
- QualityGovernance、Artifact/Renderer、ReleasePublication、IntegrationGateway 的当前公开 Port、实现、迁移和测试。
- 最新 `origin/main` 精确 head 与所有有效修复 head 的祖先关系。

## 验收步骤

1. 远端状态复核：读取 #120、#121–#128、#22–#24 及其最新评论/关联 PR，确认不是仅由 PR 文案自动关闭。
2. 权威文档复核：逐项核对父 Gate、HL-Spec、Module-Spec/Test 的状态、输入、预期输出、实际输出和 `NOT RUN` 边界。
3. 语义反例复核：重新执行 Recall 当前 Decision/ActorSnapshot、Provider Result PII、Formal Adapter Attempt provenance、stale/withdrawn RRS 等此前阻断反例。
4. 全量技术验证：在最新精确 head 上执行 focused tests、`pnpm clean && pnpm verify`、真实 disposable PostgreSQL/Flyway migration/no-op 和必要的直接探针。
5. 父 Gate 判定：只有所有父级退出条件都有直接证据且权威记录一致时才给出 `APPROVED`；真实 Provider、生产、公开 HTTP、统一跨模块业务 E2E 和独立人工验收若未执行，继续明确标记 `NOT RUN`。

## Git 与 GitHub 边界

- 本轮是验收审查，不自动执行 Issue #120 关闭、Git commit、push、merge 或分支删除。
- 现有 2026-08-31 `NOT APPROVED` 文档保留为历史证据；本轮另建新报告，不改写历史结论。
- 如需提交验收文档或关闭父 Issue，先向用户报告精确结论并取得相应授权。
