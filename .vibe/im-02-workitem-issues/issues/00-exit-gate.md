## 目标

这是 IM-02 `PostgreSQL Foundation + IdentityPolicy` 的汇总与退出 Gate，不承载新的业务语义。只有全部 IM-02 Work Item 合入默认分支、真实 PostgreSQL 证据可复现且用户完成手动验收后，才能把 IM-02 标记为 `COMPLETE` 并进入 IM-03。

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

- [ ] 所有前置 Work Item 均已关闭，且对应 PR 已合入默认分支。
- [ ] 从干净 checkout 使用锁定 Node.js/pnpm/PostgreSQL/Flyway 版本完成依赖恢复、空库 Migration、重复 Migration 和全量验证。
- [ ] IM-02 适用的 PostgreSQL 用例至少覆盖 PG-U-001/002/004/005/006/007/009/010/011/012、PG-E-004/005。
- [ ] IdentityPolicy 的 IP-API-U-001/002/003、IP-API-C-001/002 和受控 PostgreSQL E2E 实际通过。
- [ ] `pnpm clean && pnpm verify` 与独立真实 PostgreSQL Gate 均通过；报告明确测试数据库版本、镜像 digest、Migration 版本和命令。
- [ ] 用户按 Runbook 执行最小权限、RLS 隔离、幂等重放和脱敏授权 Fixture，实际输出与预期一致。
- [ ] HL-Spec、Implementation Milestone Plan、PostgreSQL Logical Model、IdentityPolicy Module Spec/Test 与 Verification Baseline 状态一致，无过期的“Schema 不存在”或虚假 `PASS`。
- [ ] 数据库、IdentityPolicy 和手动验收以外未执行的 Keycloak、OpenBao、Ceph、飞书、Renderer、真实 Provider 与生产负载仍准确标为 `NOT RUN`。
- [ ] 用户审核证据后，才把 IM-02 标为 `COMPLETE`；本 Issue 不因子 Issue 自动关闭而提前完成。

## 手动验收产出

提供一个不含生产 Secret 的 Runbook 和脱敏 Fixture。用户可在全新本地数据库中一条命令执行：Migration → 权限负向探测 → Enterprise/Project RLS 探测 → 幂等/CAS/replay → Principal/Role/Capability/Authorization 链路，并看到逐项 `PASS` 或准确失败。

## 非目标与协调边界

- 不实现 IM-03 以后的 EnterpriseProject、Artifact、Quality、Release、TaskExecution 业务纵向切片。
- 不把 Keycloak/OIDC、OpenBao Transit、真实飞书/邮件、Renderer、对象存储或生产部署作为本 Gate 的伪前置；未运行项保持 `NOT RUN`。
- #27 继续拥有 IntegrationGateway 的 23 个业务 Handler、Adapter、模块 Repository 与外部验收；IM-02 仅提供其可复用的数据库基础和 `integration_gateway` 技术表。
- #22–#24 继续拥有 ReleasePublication 的 Actor provenance、PII 最小化和正式发布来源链，不因 IdentityPolicy 最小切片完成而自动关闭。
