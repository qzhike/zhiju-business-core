# IM-03 WI-03 Task Plan

对应 Issue: #59

## 目标

实现 Enterprise、EnterpriseFact、EnterpriseProfileSnapshot、Product 与 QMSConfiguration 的最小纵向切片。

## 硬依赖

- #57 (WI-01 决策矩阵) — 已 CLOSED
- #58 (WI-02 Application/Persistence 基础) — 已 CLOSED

## Stages

1. V2001 Migration 业务表与 RLS / 不可变 trigger。`PASS`
2. Kysely 业务类型 + EnterpriseBusinessRepository。`PASS`
3. 4 个公开 Contract Handler + 7 个受控 Capability Handler。`PASS`
4. 11 个 focused PostgreSQL 测试覆盖 Issue #59 验收条件 §1–§5。`PASS`
5. `pnpm verify` 全量 Gate。`PASS`
6. 文档同步：Module-Spec / Module-Test 状态字段、Design/Task/Verification 报告。`PASS`

## Non-goals

- Project、Material、Baseline、Gap、DeliveryPlan；
- 跨模块跨 Schema Join；
- HTTP 适配 / Feishu / 真实 Provider；
- 公开 Catalog 扩展；
- IdentityPolicy 业务模型复制。

## 关键决策

- 业务 Aggregate Root 拥有自己的 `aggregate_version` 列；不与 `process_instance.aggregate_version` 共享 CAS。
- 受控 Capability 不进入 200 项 Catalog；Module Spec §8.1 已声明。
- Human-only 边界通过 envelope 上的 `principalKind` 标志判定；任何非 HUMAN 路径抛 `PROJECT_HUMAN_ONLY_DENIED`。
- 跨 Enterprise Ref 在 Profile Snapshot Handler 解析时拒绝。