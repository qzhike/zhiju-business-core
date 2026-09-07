> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-02-workitem-issues/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-02-workitem-issues/Task-Plan.md).

# IM-02 Work Item Issue 拆解计划

## 目标

依据仓库内已批准的 IM-02、IdentityPolicy、PostgreSQL、部署与安全基线，将 IM-02 拆解为边界明确、可独立验收且依赖关系可追踪的 GitHub Work Item Issues，并写入 `qzhike/zhiju-business-core`。

## 权威输入

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`
- `.vibe/module-specs/Module-Spec-001-IdentityPolicy.md`
- `.vibe/module-tests/Module-Test-001-IdentityPolicy.md`
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md`
- GitHub 当前 Issue、Label 与 Milestone 状态

## 执行步骤与验证

1. 核对 IM-02 契约、范围边界与现有 Issue → 验证：不存在重复 Work Item。
2. 形成 Work Item 清单、依赖图和每项验收标准 → 验证：覆盖 IM-02 全部 Exit Gate，且每项均有用户可手测产出。
3. 创建 GitHub Issues 并补齐交叉链接 → 验证：回读每个 Issue 的标题、正文、状态、Label、Milestone 与依赖关系。
4. 记录创建结果 → 验证：本文件中的 Issue 链接与 GitHub 实际状态一致。

## 约束

- 不修改业务代码，不提交 Git Commit，不关闭或改写既有 Issue。
- 不把未运行的 PostgreSQL、Keycloak、OpenBao、外部集成或人工验收声明为 `PASS`。
- Work Item 只覆盖 IM-02；后续里程碑能力明确标为非目标。

## 状态

`COMPLETE`

## GitHub 创建结果

| 类型 | Issue | Work Item |
|---|---|---|
| Exit Gate | [#28](https://github.com/qzhike/zhiju-business-core/issues/28) | 汇总验收并关闭 PostgreSQL Foundation + IdentityPolicy 里程碑 |
| WI-01 | [#29](https://github.com/qzhike/zhiju-business-core/issues/29) | 真实 PostgreSQL 与 Migration 测试入口 |
| WI-02 | [#30](https://github.com/qzhike/zhiju-business-core/issues/30) | Schema、Role 与最小权限基线 |
| WI-03 | [#31](https://github.com/qzhike/zhiju-business-core/issues/31) | RLS 事务上下文与 Scope 防伪 |
| WI-04 | [#32](https://github.com/qzhike/zhiju-business-core/issues/32) | 七模块标准事务技术表与约束 |
| WI-05 | [#33](https://github.com/qzhike/zhiju-business-core/issues/33) | IdentityPolicy 关系模型与低层 Repository |
| WI-06 | [#34](https://github.com/qzhike/zhiju-business-core/issues/34) | Command 原子事务、幂等、CAS 与 Audit |
| WI-07 | [#35](https://github.com/qzhike/zhiju-business-core/issues/35) | Principal、ExternalIdentityLink 与受审计 Bootstrap |
| WI-08 | [#36](https://github.com/qzhike/zhiju-business-core/issues/36) | Role、Capability 与 PolicySnapshot |
| WI-09 | [#37](https://github.com/qzhike/zhiju-business-core/issues/37) | ActorSnapshot、AuthorizationDecision 与 Decision Port |
| WI-10 | [#38](https://github.com/qzhike/zhiju-business-core/issues/38) | Outbox/Inbox 重放、Dispatcher 与 Quarantine |

## 依赖关系

```text
WI-01 → WI-02 → WI-03
          └──────┴→ WI-04 → WI-05 → WI-06 → WI-07 → WI-08 → WI-09
                              └─────→ WI-06                    └→ WI-10
WI-04 ─────────────────────────────────────────────────────────→ WI-10
```

#28 仅在 WI-01 至 WI-10 全部完成后进入最终汇总验收。#27 的 IntegrationGateway 业务 Handler/Adapter/持久化以及 #22–#24 的 ReleasePublication Runtime 工作不是本 Gate 的硬依赖，也不会因 IM-02 Work Item 创建而自动关闭。

## 回读验证

- 2026-08-23 回读 #28–#38：共 11 个 Issue，全部为 `OPEN`。
- #28–#38 均带 `enhancement` Label。
- #29–#38 正文均包含父追踪 #28、验收条件和用户可手测产出。
- #28 的前置清单完整且唯一覆盖 #29–#38。
- 本次未创建 GitHub Milestone、未分配 Assignee、未修改或关闭既有 Issue。
