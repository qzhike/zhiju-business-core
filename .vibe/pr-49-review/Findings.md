# PR #49 初始审查发现

审查对象：`31c9c1061029b57722cae80c7b4b8da45496d522`。

## 已确认的审查方向

1. **Base 漂移导致当前 PR dirty**：PR 的 GitHub base 仍是旧 WI-08 提交 `7bf9f62`，base 分支已前进到 `0a3349e`。必须把最新 base 集成后重新验证，不能用旧 head 的绿色 CI 直接合并。
2. **Actor/Decision Scope 必须闭合**：WI-09 新增入口需要同时验证 Enterprise/Project shape、事务 Context 允许的 Project，以及 ActorSnapshot Scope 与 Command Intent Scope 的精确一致性。旧实现只检查 Enterprise 相等，不能把 Project scope 当作普通字符串。
3. **内容寻址必须覆盖完整事实**：ActorSnapshot 的 canonical payload/hash 必须包含认证上下文和全部 promoted actor facts；AuthorizationDecision 必须绑定 ActorSnapshot 精确 `id + payloadHash`、PolicySnapshot 精确 `id + payloadHash` 以及完整 Command Intent。忽略正文或遗漏绑定字段会让返回的 hash 不能代表实际授权事实。
4. **公开 Query/Result 必须对齐权威 Contract**：四个 WI-09 Query 的输入 shape、Scope、Typed Reference 和返回的 ContentAddressed/SnapshotRef 不能只满足内部 TypeScript 结构；必须对照生成 Schema/Registry 做直接正负验证。
5. **测试与文档状态不能冒充完成**：原 Module Spec/Test 仍写着 `IMPLEMENTATION NOT STARTED`/`NOT RUN`，需要在修复前先同步为本次实现的准确状态，并逐项记录真实 PostgreSQL、外部身份、跨模块 Runtime 和人工验收边界。
6. **最新 base 的事务角色 fixture 未随 PR #49 更新**：首次真实 gate 在 WI-09 probe setup 处以 `permission denied to set role platform_context_establisher` 失败；WI-03 的受信事务路径要求 probe 同时具有 `platform_context_establisher` 与 `identity_policy_app` membership，必须补齐后才能判断 WI-09 业务断言。
7. **公开 authorize Query 需要正负输入回归**：除结果对象外，必须直接用 `ContractRegistry` 验证 `identity.authorize_command@1.0` 的完整公开 envelope，并证明旧的扁平 ActorSnapshot 引用被拒绝；该回归不冒充尚未接入的 HTTP Handler/transport adapter。
8. **内部 Decision Port 仍需验证引用元数据**：仅使用 `snapshotId`/`objectId` 和 digest 会让错误的 `kind`、`objectType` 或引用 Scope 绕过边界；内部入口也必须校验这些字段，再执行数据库的精确 id + hash 查询。
9. **时间与版本输入必须保持可验证**：无效 `requestedAt`/`now` 或非 `1.0` 的内部 Command Intent 不能落成 Decision，否则会绕过过期和版本绑定语义。

## 处理原则

- 先集成最新 base，再为每个确认缺陷补失败回归。
- 修复只覆盖本 PR 的 WI-09 语义；已经由最新 base 修复的 WI-05/WI-08 问题不重复改写。
- 所有项目文档使用中文；代码注释和提交消息使用英文。

## 修复与验证结果（2026-08-24）

- R1 Scope：`ActorSnapshot` 与 Command Intent 均校验 Enterprise/Project shape、事务 Context 的 Project allow-list 和精确 Scope；Enterprise Grant 不能绕过 Project Scope。
- R2 内容寻址与完整事实：Actor/Policy/Decision 均使用精确 public reference 元数据和 `id + payloadHash`；canonical payload 保留 actor、认证上下文、Scope、Purpose、Command type/version、Command payload、Policy 绑定、reasons、expiry 等事实；无效时间、版本、hash、引用和 TTL 在写入前拒绝。
- R3 公开 Contract：结果的 `SnapshotRef`、`ContentAddressedRef`、`ObjectRef`、`TypedReference` 与生成 Schema 对齐；`ContractRegistry` 直接覆盖公开 authorize envelope 正例、旧扁平 ActorSnapshot 引用负例和 Decision/Access/Policy Result。
- R4 最新 base/权限 fixture：已集成当前 WI-08 base，并为 NOINHERIT probe 补齐 `platform_context_establisher` 与 `identity_policy_app` 的 `INHERIT FALSE, SET TRUE` membership；真实 gate 不再被 setup 阻断。
- 验证：`prettier`、ESLint、TypeScript、Vitest、architecture、public API、generated Type、Catalog/Registry、compatibility 均通过；Vitest `20 passed | 9 skipped`、`341 passed | 153 skipped`；独立 `pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上 `11 files / 166 tests PASS`，二次 migrate no-op，容器清理。
- 编排边界：最新 `pnpm verify` 的静态阶段通过，但 Docker Hub 未认证 registry 分别返回 `EOF`/`429`，未能由该编排取得最后 persistence gate 结果；不能记录为完整 `pnpm verify PASS`。同一最终代码的独立 persistence gate 已 PASS。
- 未运行：公开 HTTP/Handler adapter、真实 Keycloak/Feishu/OpenBao Provider、跨业务模块 Runtime、外部 E2E、Outbox/Inbox 发布消费和人工脱敏验收。该边界不阻止本次 scoped WI-09 core review，但已同步到 Module Spec/Test 和最终 review document。
