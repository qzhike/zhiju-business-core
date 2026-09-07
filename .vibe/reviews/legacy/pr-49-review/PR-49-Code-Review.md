> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-49-review/PR-49-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-49-review/PR-49-Code-Review.md).

# PR #49 Code Review

审查对象：`https://github.com/qzhike/zhiju-business-core/pull/49`
工作项：IM-02 WI-09，原始 Issue：#37
原始审查 head：`31c9c1061029b57722cae80c7b4b8da45496d522`
审查 base 分支：`galendai/36-im-02-wi-08-roles-capabilities-policy-snapshots`
集成后的 base：`0a3349eed0e4bb943a7a39b86f58a69888d8201a`

## 审查结论

原始 PR head 不能直接合并。它在旧 base 上的绿色 CI 未覆盖最新 WI-08 base 的类型/持久化契约，也没有闭合 WI-09 的 Project Scope、Actor/Intent Scope、完整内容寻址和公开 Reference Contract。

本地已完成 scoped WI-09 core 的修复、失败回归和最新 base 复审，当前没有发现仍属于本 PR 范围的语义阻断项。结论仅适用于本模块现有的低层 Decision/Query Port 与真实 PostgreSQL persistence gate；公开 HTTP/Handler adapter、真实身份 Provider、跨模块 Runtime、外部 E2E 和人工验收仍为 `NOT RUN`，不因本次修复而标记为完成。

## 原始发现与定位

### R1 — Blocker：Scope 边界不闭合

原始 `createActorSnapshot` 和 `authorizeCommand` 只将 Enterprise 与事务上下文比较，没有要求 `scopeKind` 的 Enterprise/Project shape，也没有验证 Project 是否属于受信 Context 的 allow-list；Authorize 还没有比较 ActorSnapshot Scope 与 Command Intent Scope。因此 Enterprise Grant 可能在错误 Project Intent 下被解释，Project A/B 隔离不能由入口保证。

### R2 — Blocker：内容寻址和 canonical facts 不完整

原始实现没有随最新 base 的 ActorSnapshot `scopeKind` / `actorSnapshotPayloadHash` 要求写入；ActorSnapshot 正文也没有完整保留认证上下文和 promoted actor facts。AuthorizationDecision 未把 ActorSnapshot hash、PolicySnapshot hash、认证上下文和完整 Command Intent 事实写入 canonical payload，返回的 hash 不能代表实际授权绑定。集成最新 base 后，原始实现首先在 `pnpm typecheck` 暴露这些接口漂移。

### R3 — Major：公开 Reference/Result 与权威 Schema 不一致

原始返回值使用 `snapshotType`、`decisionId`、`payloadHash` 等内部扁平引用，日期仍为 `Date`，`policySchemaRefs` 仍为字符串；这不满足生成的 `SnapshotRef`、`ContentAddressedRef`、`ObjectRef`、`TypedReference` 和 `UtcInstant`。原始 PR 没有用 `ContractRegistry` 对真实结果做正负验证。

### R4 — Major：真实 gate 的受信事务 fixture 失效

最新 base 的 `withIdentityTransaction` 需要 NOINHERIT probe 先以 `platform_context_establisher` 建立 Context，再切换 `identity_policy_app` 执行 SQL。原始 WI-09 probe 只授予 app role，首次 gate 在 suite setup 以 `permission denied to set role platform_context_establisher` 失败，不能据此判断业务断言。

### R5 — Process：文档和完成状态过度声明风险

原始 Module Spec/Test 仍把 WI-09 记为未开始/未运行，且 PR 正文的 `Closes #37` 没有形成 GitHub `closingIssuesReferences`。必须同时更新项目 `.vibe` 文档、保留 PASS/NOT RUN 边界，并在最终 exact head 上单独处理 Issue #37。

## 已完成的修复

- 在 [`actor-snapshot.ts`](../../../../modules/identity-policy/src/commands/actor-snapshot.ts) 中加入 Enterprise/Project Scope shape、Context Project allow-list、Actor/Intent Scope 精确一致、Actor/Policy/Decision Reference 元数据校验、完整 canonical payload、Command version/time/TTL/hash 校验，以及 immutable Decision 的 public content-addressed result。
- 在 [`queries.ts`](../../../../modules/identity-policy/src/commands/queries.ts) 中使四个访问 Query 和 Policy Snapshot Query 输出完整 public references、Scope、UTC 时间和 Typed schema references；Access effective lists 不再返回内部扁平对象。
- 在 [`static-registry.ts`](../../../../modules/identity-policy/src/commands/static-registry.ts) 中把已持久化的静态 schema registry key 映射为公开 `VersionedRef`，保持存储兼容并满足 `PolicySnapshotView` Contract。
- 在 [`identity-policy-decisions.test.ts`](../../../../tests/persistence/identity-policy-decisions.test.ts) 中补齐 Project A/B、Enterprise 反例、Agent `actingFor`、撤销历史、canonical/hash/auth/引用精确性、invalid time/version、公开 Registry 正负 envelope、双角色事务登录和 app role deny-side 回归。
- 已同步 [`HL-Spec.md`](../../../high-level-docs/HL-Spec.md)、IdentityPolicy Module Spec/Test、WI-09 Issue 文档和本目录的 Findings/Task Plan；所有未运行的外部与人工边界均保留为 `NOT RUN`。

## 验证证据

| 检查 | 结果 |
|---|---|
| Prettier / ESLint / TypeScript | `PASS` |
| Vitest | `20 passed | 9 skipped`；`341 passed | 153 skipped` |
| Architecture | `PASS source_roots=10` |
| Public API / generated types | `PASS operations=200`；`payloads=200 query_results=44 core_contracts=6` |
| Catalog / Registry | `PASS catalog=200 registry=200 schema_status={"FULL":200}` |
| Compatibility | `PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=0 findings=0` |
| 独立 `pnpm persistence:gate` | PostgreSQL 18.6 / Flyway 11.20.3，`11 files / 166 tests PASS`；空库迁移、二次 no-op、双角色 fixture、容器清理均通过 |
| 最新 `pnpm verify` 编排 | 静态阶段全部通过；Docker Hub 未认证 registry 在 persistence 阶段返回 `EOF`/`429`，因此该次编排不能记为完整 PASS |

## 未运行边界

公开 HTTP/Handler adapter、Keycloak/OIDC、Feishu Provider、OpenBao 生产密钥、跨模块 Approval/Release Runtime、Outbox/Inbox 发布消费、外部 E2E 和人工 Principal→Decision 脱敏追踪均为 `NOT RUN`。`ContractRegistry` 正例只证明公开 envelope/result shape，不能替代尚未接入的 transport adapter 运行验收。

## 交付状态

本文件是关闭 PR 前必须提交到 `.vibe` 的 Git review artifact。当前仍需用户检查工作树并确认，然后才能创建提交、推送、在最终 head 发布 review comment、使用 exact-head 合并 PR #49，并在 GitHub 上核验后关闭 Issue #37。
