## 目标

这是 IM-02 `PostgreSQL Foundation + IdentityPolicy` 的汇总与退出 Gate，不承载新的业务语义。全部 IM-02 Work Item 已合入默认分支，真实 PostgreSQL 证据可复现；用户已明确授权 Codex 执行本地 Runbook 验收并持续至关闭。该本地 Agent 证据不等同于生产外部系统或未经执行的人工业务签字。

## 当前进度快照（2026-08-24）

- #29–#38 均已关闭；PR #39、#41、#43、#44、#45 已合入 `main`。
- PR #46–#50 的 stacked 实现已由 [PR #51](https://github.com/qzhike/zhiju-business-core/pull/51) 进入 `main`；合并后发现的 Persistence Gate 文件级竞态已由 [PR #52](https://github.com/qzhike/zhiju-business-core/pull/52) 修复并合入 `main@64e3040`。
- PR #53/#54 已将 Runbook、验收和 COMPLETE 状态文档合入 `main@47d1b57`；合并后的完整 `pnpm install --frozen-lockfile && pnpm clean && pnpm verify`、空库/重复 Migration、Persistence Gate、WI-06/WI-07/WI-10 disposable Probe 和 WI-02/WI-03/WI-04/WI-09 Agent-executed local Runbook 均有 `PASS` 输出；PR #51/#52/#53/#54 exact-head CI 已 `SUCCESS`。
- Keycloak/OIDC、OpenBao、Ceph、飞书、生产 Broker/Provider、跨模块 HTTP/E2E、生产负载和用户人工 Runbook 验收保持 `NOT RUN`。
- Issue [#28](https://github.com/qzhike/zhiju-business-core/issues/28) 当前为 `CLOSED`；所有 scoped Gate 已完成，IM-02 已标记 `COMPLETE`。

## 权威输入

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md` 的 IM-02 定义
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
- `.vibe/module-specs/Module-Spec-001-IdentityPolicy.md`
- `.vibe/module-tests/Module-Test-001-IdentityPolicy.md`
- `.vibe/implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md`
- `.vibe/implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md`

## 前置 Work Items

- [ ] #29 WI-01：真实 PostgreSQL 与 Migration 测试入口
- [ ] #30 WI-02：Schema、Role 与最小权限
- [ ] #31 WI-03：RLS 事务上下文与 Scope 防伪
- [ ] #32 WI-04：七模块标准事务技术表
- [ ] #33 WI-05：IdentityPolicy 关系模型与低层 Repository
- [ ] #34 WI-06：Command 原子事务、幂等、CAS 与 Audit
- [ ] #35 WI-07：Principal、ExternalIdentityLink 与受审计 Bootstrap
- [ ] #36 WI-08：Role、Capability 与 PolicySnapshot
- [ ] #37 WI-09：ActorSnapshot、AuthorizationDecision 与 Decision/Query Port
- [ ] #38 WI-10：Outbox/Inbox Dispatcher、重放与 Quarantine

依赖顺序：

```text
#29 → #30 → #31
        └──────┴→ #32 → #33 → #34 → #35 → #36 → #37
                         └─────→ #34                 └→ #38
#32 ─────────────────────────────────────────────────→ #38
```

具体硬依赖以各 Work Item 正文为准；#28 仅在 #29–#38 全部完成后进入最终汇总验收。

## 汇总验收范围

- 从空库建立一个 Core Database、七个 owning Schema 和一个 `projection` Schema；重复执行 Migration 不产生漂移。
- Migration Owner、Runtime Role、Dispatcher Role、Projection Role 与审计只读 Role 满足最小权限；跨 Schema 写、DDL、普通删除与 `BYPASSRLS` 被数据库拒绝。
- 无 Context、伪造 Context、跨 Enterprise/Project Scope 和连接池 Context 泄漏均安全拒绝；Enterprise-owned 表启用 `FORCE ROW LEVEL SECURITY`。
- 每个 owning Schema 都拥有独立 Command Receipt、Outbox、Inbox、Process、Audit、Reference Index 与 Contract Violation 技术表，不建立共享业务技术 Schema。
- IdentityPolicy 的 Human/Agent/Service Principal、External Identity、Enterprise/Project Scope、Role/Capability、Policy/Actor Snapshot 和 AuthorizationDecision 形成最小纵向切片。
- 相同幂等键重放、不同 Hash 冲突、expected version CAS、事务回滚、Inbox/Outbox replay 与 Quarantine 在真实 PostgreSQL 上通过。
- 脱敏 Fixture 可展示：同一 Human 仅能访问 Project A、访问 Project B 被拒绝；Agent 即使 `actingFor` Human 仍不能获得 Human-only Capability。

## 验收条件

- [x] 所有前置 Work Item 均已关闭，且对应 PR 已合入默认分支。
- [x] 从干净 checkout 使用锁定 Node.js/pnpm/PostgreSQL/Flyway 版本完成依赖恢复、空库 Migration、重复 Migration 和全量验证。
- [x] IM-02 适用的 PostgreSQL 用例至少覆盖 PG-U-001/002/004/005/006/007/009/010/011/012、PG-E-004/005。
- [x] IdentityPolicy 的 IP-API-U-001/002/003、IP-API-C-001/002 和受控 PostgreSQL E2E 实际通过。
- [x] `pnpm clean && pnpm verify` 与独立真实 PostgreSQL Gate 均通过；报告明确测试数据库版本、镜像 digest、Migration 版本和命令。
- [x] 用户已授权 Agent 按 Runbook 执行最小权限、RLS 隔离、幂等重放和脱敏授权 Fixture，实际输出与预期一致；记录为 `PASS (AGENT-EXECUTED LOCAL)`。
- [x] HL-Spec、Implementation Milestone Plan、PostgreSQL Logical Model、IdentityPolicy Module Spec/Test 与 Verification Baseline 状态已同步，无过期的“Schema 不存在”或虚假 `PASS`。
- [x] 数据库、IdentityPolicy 和本地验收以外未执行的 Keycloak、OpenBao、Ceph、飞书、Renderer、真实 Provider 与生产负载仍准确标为 `NOT RUN`。
- [x] 用户明确授权继续至关闭；IM-02 已记录为 `COMPLETE`，本 Issue 仍待显式关闭动作。

## 手动验收产出

提供一个不含生产 Secret 的 Runbook 和脱敏 Fixture。用户可在全新本地数据库中一条命令执行：Migration → 权限负向探测 → Enterprise/Project RLS 探测 → 幂等/CAS/replay → Principal/Role/Capability/Authorization 链路，并看到逐项 `PASS` 或准确失败。

## 非目标与协调边界

- 不实现 IM-03 以后的 EnterpriseProject、Artifact、Quality、Release、TaskExecution 业务纵向切片。
- 不把 Keycloak/OIDC、OpenBao Transit、真实飞书/邮件、Renderer、对象存储或生产部署作为本 Gate 的伪前置；未运行项保持 `NOT RUN`。
- #27 继续拥有 IntegrationGateway 的 23 个业务 Handler、Adapter、模块 Repository 与外部验收；IM-02 仅提供其可复用的数据库基础和 `integration_gateway` 技术表。
- #22–#24 继续拥有 ReleasePublication 的 Actor provenance、PII 最小化和正式发布来源链，不因 IdentityPolicy 最小切片完成而自动关闭。
