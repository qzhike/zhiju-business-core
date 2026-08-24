## 背景

IM-02 的最小纵向切片必须由 IdentityPolicy 唯一生成不可变 AuthorizationDecision，并让其他模块通过 Decision/Query Port 获取结果，而不是读取 `identity_policy` Schema 或自行解释 Role/Capability。ActorSnapshot 中的 `actingFor` 不得改变真实 actor kind。

父追踪 Issue：#28（WI-09）。硬依赖：WI-03、WI-08。

## 工作范围

- 实现 ActorSnapshot 的受控创建/校验边界，以及 `identity.authorize_command@1.0` 唯一 Decision Port。
- 实现 `check_enterprise_access`、`check_project_access`、`check_human_only_capability`、`get_policy_snapshot` 四个 Query；连同 WI-07 的 resolve query 覆盖全部 6 个公开 Query。
- Decision 绑定 exact actor snapshot、authentication context、command intent、Scope/Purpose、payload hash、PolicySnapshot、outcome/reasons 与 expiresAt。
- 非 ACTIVE Principal、过期/撤销 Role/Grant、Scope/Purpose 不匹配和 Agent `actingFor` Human 的 Human-only 请求都产生不可变 DENY Decision 与安全审计。
- `DENY` Decision 与安全 Audit 必须在同一 IdentityPolicy 事务提交；Audit 只保留 reason code、hash 和脱敏摘要，不得包含原始 Command Payload 或 External Identity。
- ALLOW 也不能变成长期 token；业务 Handler 后续必须校验 Decision hash、时效、scope 与 intent。

## 验收条件

- [ ] IP-API-U-001：Agent `actingFor` Human 请求 Human-only Capability 固定 DENY，并保留 Agent kind。
- [ ] 同一 Human 在 Project A 得到 ALLOW，在 Project B 得到安全 DENY；Enterprise A 不能探测 Enterprise B 对象存在性。
- [ ] Decision/ActorSnapshot payload 或 hash、Scope、Purpose、command type/version、authentication context 任一不匹配均拒绝。
- [ ] Decision 与 Snapshot 不可更新/删除；Role/Capability 撤销后历史 Decision 可解释，但新 Decision 为 DENY。
- [ ] 其他业务模块无法直接导入 IdentityPolicy internal Repository，Database Role 也无法直接读取其权威表进行授权判断。
- [ ] 6 Query 的 Handler/Contract/persistence tests 和真实 PostgreSQL 受控 E2E 通过。

## 手动验收产出

提供 Principal → Role/Capability → PolicySnapshot → ActorSnapshot → AuthorizationDecision 的脱敏追踪视图；用户可比较 Project A ALLOW、Project B DENY 与 Agent `actingFor` DENY 三条链。

## 非目标

- 不实现 Keycloak token/JWKS 验证或真实飞书身份解析。
- 不自动完成 #22–#24；这些 Issue 仍需在各自 Runtime Handler 验证 Decision provenance。

## PR #49 审查补充约束（2026-08-24）

本工作项的实现交付必须以当前 WI-08 base 为准，并在最终精确 PR head 上完成语义 review。除原验收条件外，入口与 Query Result 还必须满足：

- Enterprise/Project Scope shape 闭合；Project 必须属于受信事务 Context 的允许集合；ActorSnapshot Scope 与 Command Intent Scope 必须精确一致；
- 授权覆盖必须按完整 Intent Scope 精确匹配：Enterprise Grant 不得覆盖 Project Intent；Project Intent 只能由同一 Project 的 Grant/Role 事实覆盖，并有真实 PostgreSQL 负例回归；
- ActorSnapshot、PolicySnapshot 和 AuthorizationDecision 使用精确 `id + payloadHash` 绑定，canonical payload 不得丢失认证上下文、Scope、Purpose 或 Command Intent；
- 公开 Query 输入与结果直接通过生成的 IdentityPolicy Schema/`ContractRegistry`，不得用内部扁平引用替代 `ScopeRef`、`ObjectRef`、`SnapshotRef` 或 `ContentAddressedRef`；
- 真实 PostgreSQL persistence gate、公开 Handler/HTTP、真实身份 Provider、跨业务模块 Runtime、外部 E2E 和人工脱敏追踪分别记录实际结果；未执行项保持 `NOT RUN`。

在上述证据完成前，本 Issue 不得因旧 head 的绿色 CI、静态 Catalog Gate 或数据库触发器通过而标记完成。

## PR #49 审查修复结果（2026-08-24）

- 已在当前 WI-08 base `0a3349eed0e4bb943a7a39b86f58a69888d8201a` 上复审原 PR head `31c9c1061029b57722cae80c7b4b8da45496d522`，补齐 Scope shape/allow-list、Actor/Intent Scope 精确一致、引用元数据、完整 canonical facts、Command version/time 校验和公开 Contract 正负回归。
- 独立真实 PostgreSQL gate：PostgreSQL 18.6 / Flyway 11.20.3，`11 files / 166 tests PASS`；包含 Project A ALLOW、Project B DENY、Agent actingFor Human-only DENY、撤销后新 DENY、历史 Decision 可读、app role 不可更新/删除、NOINHERIT 双 membership、空库迁移和第二次 migrate no-op。
- 静态/类型/架构/Catalog/兼容性与 Vitest 均通过：`20 passed | 9 skipped`、`341 passed | 153 skipped`、Catalog/Registry `200/200`、compatibility `findings=0`。最新 `pnpm verify` 编排的静态阶段通过，但 Docker Hub 未认证限流 `EOF/429` 阻止其再次进入 persistence gate；独立 gate 的结果单独记录，不把该编排记为完整 PASS。
- `ContractRegistry` 直接验证公开 authorize envelope 正例、Decision/Access/Policy Result，旧扁平引用与错误引用元数据负例被拒绝。公开 HTTP/Handler adapter、真实身份 Provider、跨业务模块 Runtime、外部 E2E 和人工脱敏追踪仍为 `NOT RUN`，属于后续 Runtime 责任边界；不以本次 scoped core gate 冒充完成。
