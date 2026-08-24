# IM-02 Issue #28 退出与关闭计划

日期：2026-08-24
授权：用户明确授权继续远端操作，直至 IM-02 完成并关闭 Issue #28
交付入口：[PR #51](https://github.com/qzhike/zhiju-business-core/pull/51)

## 目标

在不扩大 IM-02 业务边界、不伪造外部系统证据的前提下，完成 PR #51 的默认分支交付、合并后干净 `main` 验证、可执行 Runbook/Probe 验收、文档同步和 Issue #28 关闭。

## 退出步骤

1. 核对 PR #51 最新 head、CI、mergeability 和 `main` ancestor，使用 `--match-head-commit` 合并 PR。
2. 从合并后的 `main` 创建临时干净 checkout，执行锁定依赖恢复、`pnpm clean && pnpm verify`、独立 PostgreSQL/Flyway Gate 和可执行 WI Runbook/Probe。
3. 将结果写回 Issue #28 验收报告、HL-Spec、Implementation Milestone Plan、Verification Baseline、IdentityPolicy Module Spec/Test 和 Exit Gate 文档。
4. 在 GitHub PR、Issue #28 和相关 Work Item 记录最终状态；确认 PR 已 MERGED、#28 的退出条件已满足后关闭 Issue #28。
5. 回读最终 GitHub 状态、默认分支祖先关系、工作树和容器清理结果。

## 状态边界

- 本地真实 PostgreSQL、自动化 Gate 和脱敏 Probe 的实际输出可以记录为 `PASS`。
- Keycloak/OIDC、OpenBao、Ceph、飞书、生产 Broker/Provider、跨模块生产 E2E、生产负载和真实用户外部环境继续记录为 `NOT RUN`，它们不是本次 IM-02 scoped closeout 的伪前置。
- 只有在合并后默认分支和退出证据回读完成后，才允许关闭 Issue #28。
