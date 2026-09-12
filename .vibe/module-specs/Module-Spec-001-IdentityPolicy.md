# Module-Spec-001-IdentityPolicy

版本：v0.3
日期：2026-08-24
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / WI-09 SCOPE+DENY-AUDIT REGRESSION VERIFIED 2026-08-24 / WI-10 TYPED-ORDER+SCOPE REGRESSION VERIFIED 2026-08-24 / PR #51+#52+#53+#54+#55 MERGED / FINAL MAIN VERIFY PASS / IM-02 COMPLETE / ISSUE #28 CLOSED / #176 POLICY VERSION RESOLUTION DESIGN APPROVED 2026-09-12 DESIGN VERIFIED / #181 PAYLOADGUARD PARAMETERS + SD-181-1 APPROVED 2026-09-13 DESIGN VERIFIED / EXTERNAL NOT RUN`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

IdentityPolicy 是 Principal、ExternalIdentityLink、RoleAssignment、CapabilityGrant、ActorSnapshot、AuthorizationDecision 和 PolicySnapshot 的唯一写入 Owner。它回答“谁在行动、代表关系是什么、在精确 Scope 和 Purpose 下是否允许”，但不拥有 Project 内容、Task、Artifact、Approval、Release 或 Provider Credential。

同步依赖：无其他业务模块。其他模块只能调用本模块 Decision/Query Port，不得读取本 Schema 或自行解释 Role/Capability。

测试规格：[`Module-Test-001-IdentityPolicy.md`](../module-tests/Module-Test-001-IdentityPolicy.md)。共享 API 规则：[`API-Contract-v0.1.md`](../api-contract-v0.1/API-Contract-v0.1.md)。

## 2. 模块类型

```text
PrincipalKind = Closed<HUMAN | AGENT | SERVICE | RUNTIME | EXTERNAL_PARTY>
PrincipalStatus = Closed<ACTIVE | SUSPENDED | REVOKED | ARCHIVED>
AuthorizationOutcome = Closed<ALLOW | DENY>
ScopeKind = Closed<PLATFORM | ENTERPRISE | PROJECT | OBJECT>

ExternalIdentityKey
├── providerCode: NamespaceCode
├── accountExternalId: Sensitive<NonEmptyString>
└── subjectExternalId: Sensitive<NonEmptyString>

ScopedRole
├── roleCode: NamespaceCode
├── scopeRef: ScopeRef
├── objectRef?: ObjectRef<RegisteredObject>
├── effectivePeriod: EffectivePeriod
└── constraints: CanonicalJson

ScopedCapability
├── capabilityCode: NamespaceCode
├── scopeRef: ScopeRef
├── resourceSelectors: CanonicalJson[]
├── actions: NonEmptySet<NamespaceCode>
├── constraints: CanonicalJson
├── effectivePeriod: EffectivePeriod
├── maxUses?: PositiveInt
└── grantPolicyRef: VersionedRef<Policy>

CommandIntent
├── commandType: NamespaceCode
├── commandVersion: NonEmptyString
├── scopeRef: ScopeRef
├── targetRef: ObjectRef<RegisteredObject>
├── requestedCapability: NamespaceCode
├── payloadHash: PayloadHash
├── requestedAt: UtcInstant
└── highRiskAction: boolean

AuthorizationDecisionView
├── authorizationDecisionRef: ContentAddressedRef<AuthorizationDecision>
├── outcome: AuthorizationOutcome
├── reasons: ReasonCode[]
├── policySnapshotRef: SnapshotRef<PolicySnapshot>
├── effectiveScopeRef: ScopeRef
└── expiresAt: UtcInstant
```

Sensitive External Identity 字段只允许安全传输，不得进入普通日志、错误消息或 Event；持久化使用加密原值与密钥化 Lookup Hash。

## 3. Command Payload Contract

除 `?` 字段外均为 required。Target 和并发模式使用共享 API 定义。

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `identity.register_principal@1.0` | `Principal / CREATE` | `principalKind: PrincipalKind; displayName: NonEmptyString; initialStatus: ACTIVE` | `identity.principal.register`；targetRef 是预分配 PrincipalRef；PrincipalKind 创建后不可互换 |
| `identity.link_external_identity@1.0` | `ExternalIdentityLink / CREATE` | `principalRef: ObjectRef<Principal>; identityKey: ExternalIdentityKey; verifiedAt: UtcInstant; verificationMethod: NamespaceCode; evidenceRefs: EvidenceRef[]; displayHint?: SafeSummary` | `identity.external_identity.link`；provider/account/subject 唯一；冲突不得覆盖；不接收 Credential |
| `identity.assign_role@1.0` | `RoleAssignment / CREATE` | `principalRef: ObjectRef<Principal>; role: ScopedRole; justification: Justification` | `identity.role.assign`；Scope 必须存在；角色不能通过 actingFor 隐式继承 |
| `identity.revoke_role@1.0` | `RoleAssignment / MUTATE` | `effectiveAt: UtcInstant; justification: Justification` | `identity.role.revoke`；撤销追加不可变事实，不删除 Assignment；expected version 必填 |
| `identity.grant_capability@1.0` | `CapabilityGrant / CREATE` | `principalRef: ObjectRef<Principal>; capability: ScopedCapability; justification: Justification` | `identity.capability.grant`；AGENT/RUNTIME 永远不能获 Human-only Capability；Grant 不携带 Secret Token |
| `identity.revoke_capability@1.0` | `CapabilityGrant / MUTATE` | `effectiveAt: UtcInstant; justification: Justification` | `identity.capability.revoke`；撤销不改写历史 Decision；expected version 必填 |
| `identity.record_policy_snapshot@1.0` | `PolicySnapshot / CREATE` | `policySetVersion: NonEmptyString; policySchemaRefs: NonEmptySet<SchemaRef>; policyDocument: CanonicalJson; effectiveFrom: UtcInstant; sourceRefs: TypedReference[]` | `identity.policy_snapshot.record`；Snapshot 不可变且必须由构建期 Registry 可解析 |

## 4. Query Payload 与 Result Contract

```text
PrincipalLookup =
  { kind: PRINCIPAL_REF; principalRef: ObjectRef<Principal> }
| { kind: EXTERNAL_IDENTITY; identityKey: ExternalIdentityKey }

PrincipalResolutionView
├── principalRef: ObjectRef<Principal>
├── principalKind: PrincipalKind
├── status: PrincipalStatus
├── displayName: ValueEnvelope<NonEmptyString>
└── resolvedByLinkRef?: ObjectRef<ExternalIdentityLink>

AccessCheck
├── principalRef: ObjectRef<Principal>
├── scopeRef: ScopeRef
├── action: NamespaceCode
├── resourceRef?: ObjectRef<RegisteredObject>
├── purpose: NamespaceCode
└── asOf: UtcInstant

AccessDecision
├── outcome: AuthorizationOutcome
├── authorizationDecisionRef: ContentAddressedRef<AuthorizationDecision>
├── reasons: ReasonCode[]
├── effectiveRoles: ObjectRef<RoleAssignment>[]
├── effectiveCapabilities: ObjectRef<CapabilityGrant>[]
└── expiresAt: UtcInstant

PolicySnapshotView
├── policySnapshotRef: SnapshotRef<PolicySnapshot>
├── policySetVersion: NonEmptyString
├── policySchemaRefs: SchemaRef[]
├── effectiveFrom: UtcInstant
├── supersededAt?: UtcInstant
└── payload: CanonicalJson
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `identity.resolve_principal@1.0` | A | `lookup: PrincipalLookup; requiredScopeRef?: ScopeRef; purpose: NamespaceCode` | `PrincipalResolutionView`；无目录枚举能力 |
| `identity.authorize_command@1.0` | A | `actorSnapshotRef: SnapshotRef<ActorSnapshot>; intent: CommandIntent; authenticationContextRef: ContentAddressedRef<AuthenticationContext>` | `AuthorizationDecisionView`；本 Query 是创建 AuthorizationDecision 的唯一 Decision Port |
| `identity.check_enterprise_access@1.0` | A | `check: AccessCheck`，其中 `scopeRef.enterpriseRef` required 且 `projectRef` absent | `AccessDecision` |
| `identity.check_project_access@1.0` | A | `check: AccessCheck`，其中 `scopeRef.projectRef` required | `AccessDecision` |
| `identity.check_human_only_capability@1.0` | A | `principalRef: ObjectRef<Principal>; capabilityCode: NamespaceCode; scopeRef: ScopeRef; actionAt: UtcInstant` | `AccessDecision`；非 HUMAN 固定 DENY，但仍保存可审计 Decision |
| `identity.get_policy_snapshot@1.0` | A | `policySnapshotRef: SnapshotRef<PolicySnapshot>` | `PolicySnapshotView`；必须精确 Hash，不允许 current/latest |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `identity.PrincipalRegistered@1.0` | `principalRef: ObjectRef<Principal>; principalKind: PrincipalKind; status: PrincipalStatus` |
| `identity.ExternalIdentityLinked@1.0` | `externalIdentityLinkRef: ObjectRef<ExternalIdentityLink>; principalRef: ObjectRef<Principal>; providerCode: NamespaceCode; externalIdentityLookupHashRef: ContentAddressedRef<ExternalIdentityLookup>`；不含原始 External ID |
| `identity.RoleAssigned@1.0` | `roleAssignmentRef: ObjectRef<RoleAssignment>; principalRef: ObjectRef<Principal>; roleCode: NamespaceCode; assignedScopeRef: ScopeRef; effectivePeriod: EffectivePeriod` |
| `identity.RoleRevoked@1.0` | `roleAssignmentRef: ObjectRef<RoleAssignment>; principalRef: ObjectRef<Principal>; revokedAt: UtcInstant; reasonCode: ReasonCode` |
| `identity.CapabilityGranted@1.0` | `capabilityGrantRef: ObjectRef<CapabilityGrant>; principalRef: ObjectRef<Principal>; capabilityCode: NamespaceCode; grantedScopeRef: ScopeRef; effectivePeriod: EffectivePeriod` |
| `identity.CapabilityRevoked@1.0` | `capabilityGrantRef: ObjectRef<CapabilityGrant>; principalRef: ObjectRef<Principal>; revokedAt: UtcInstant; reasonCode: ReasonCode` |
| `identity.PolicySnapshotRecorded@1.0` | `policySnapshotRef: SnapshotRef<PolicySnapshot>; policySetVersion: NonEmptyString; effectiveFrom: UtcInstant` |

授权拒绝默认只写安全审计，不作为公开跨模块业务事件；Decision Port 的 `DENY` 必须与安全 `AuditRecord` 在同一事务内提交；Audit 只保存 reason code、hash 和脱敏摘要。任何 Event/Audit 均不得携带 Role 条件全文、Capability Token、External ID 原值或个人联系方式。

## 6. 模块错误码

```text
IDENTITY_PRINCIPAL_KIND_IMMUTABLE
IDENTITY_PRINCIPAL_INVALID_KIND
IDENTITY_PRINCIPAL_NOT_ACTIVE
IDENTITY_EXTERNAL_LINK_CONFLICT
IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED
IDENTITY_ROLE_SCOPE_INVALID
IDENTITY_ROLE_ALREADY_ACTIVE
IDENTITY_ROLE_NOT_ACTIVE
IDENTITY_CAPABILITY_HUMAN_ONLY
IDENTITY_CAPABILITY_SCOPE_INVALID
IDENTITY_CAPABILITY_ALREADY_ACTIVE
IDENTITY_CAPABILITY_NOT_ACTIVE
IDENTITY_POLICY_SNAPSHOT_INVALID
IDENTITY_POLICY_VERSION_UNKNOWN
IDENTITY_ACTING_FOR_ESCALATION_FORBIDDEN
IDENTITY_DIRECTORY_ENUMERATION_FORBIDDEN
```

## 7. 不变量与持久化边界

1. Principal Kind 不可互换；Agent actingFor Human 后仍是 Agent。
2. Principal 可跨 Enterprise 存在，但 Assignment、Grant、Snapshot 和 Decision 必须绑定精确 Scope。
3. Human-only Capability 对 AGENT/RUNTIME 永久拒绝，不能由 Role、actingFor 或 Service 透传绕过。
4. External Identity 映射冲突进入安全处理，不采用最后写入覆盖。
5. Role/Capability 撤销不删除历史 ActorSnapshot、Decision 或 Approval 证据。
6. AuthorizationDecision 是不可变 Contract；所有业务 Handler 重新验证其完整性和时效。
7. 本模块不存 Provider Token、共享 Human Credential 或长期 Runtime Capability Token。
8. 其他模块只保存 PrincipalRef、ActorSnapshotRef、AuthorizationDecisionRef，不建立跨 Schema 外键。
9. Enterprise Scope 不携带 Project；Project Scope 必须携带 Project，且数据库 RLS 同时校验事务上下文允许的 Enterprise 与 Project。
10. Role/Capability 撤销事实保存父记录的完整 Scope 镜像；CapabilityGrant 与 AuthorizationDecision 分别按精确 PolicySnapshot/ActorSnapshot id + payload hash 绑定，并拒绝引用对象的 Principal、Kind、认证上下文或 Scope 不一致。
11. 每个 Command 的 canonical request Hash 必须覆盖所有会改变结果的 payload 字段；同一 idempotency key 的不同 Hash 必须拒绝，不能返回原结果。
12. Project-owned RoleAssignment、CapabilityGrant 及其技术记录必须同时满足 Enterprise 与允许 Project scope；撤销不得仅凭 target ID 绕过 Project scope。
13. 并发 active Assignment/Grant 的数据库唯一裁决必须转换为稳定模块错误；原始 PostgreSQL unique violation 不得穿透公开 Handler。
14. 首角色 bootstrap claim 只能原子消费一次，并且产生与普通 RoleAssignment 相同的脱敏 `identity.RoleAssigned` Event。
15. 撤销事实的执行主体必须来自受信事务 Context；调用者输入不得伪造 `revoked_by_principal_id`。
16. 已过期的 EffectivePeriod 不得创建 ACTIVE Assignment 或 Grant。
17. `V1004` 迁移/补强既有数据时必须保留 Role/Capability Revocation 的 Project scope；迁移阶段不得因 RLS 使历史 scope 回填静默失效。

WI-07 实现补充约束：公开 Event 与 Query Result 必须直接满足本模块对应的可执行 Schema；ExternalIdentity 的 account/subject lookup hash 共同构成幂等和内容寻址身份；bootstrap claim 的消费必须由同一事务中的行锁或等价条件更新保护；闭集值、验证失败和其他业务拒绝仍需落入 Command receipt/audit 事务边界。WI-07 的 bootstrap claim 表使用不与 WI-06 冲突的后续 forward-only Migration（当前为 `V1003`），不得复用 `V1002`。

WI-09 实现补充约束：ActorSnapshot 和 AuthorizationDecision 的 Scope 必须先通过 Enterprise/Project shape 及受信事务 Context 的 Project allow-list 校验；Decision 的 ActorSnapshot Scope 必须与 Intent 精确一致；ActorSnapshot、PolicySnapshot 和 Decision 必须按精确 `id + payloadHash` 绑定；canonical payload 必须保留认证上下文、Scope、Purpose、Command Intent 和 promoted facts；公开 Query 输入与结果必须使用本节定义的 `ScopeRef`、`ObjectRef`、`SnapshotRef` 和 `ContentAddressedRef`，由 `ContractRegistry` 直接验证。Capability/Role 的授权覆盖也必须与 Intent 的 `scopeKind + enterpriseId + projectId` 精确匹配：Enterprise Grant 不得覆盖 Project Intent，Project Intent 只能由同一 Project 的事实覆盖。Agent 的 `actingFor` 只能记录关系，不能改变权威 PrincipalKind。

WI-09 Decision Port 的每个业务性 `DENY` 必须在同一事务写入当前受信 Enterprise/Project Scope 的安全 Audit；Audit 的 `command_id` 与 Decision 的 source command 绑定，`request_payload_hash` 只能保存已验证的 hash，`safe_summary` 只能保存稳定 reason code，不得回显原始输入。

## 8.1 IM-02 WI-10 Persistence Slice

IdentityPolicy owning schema 的 WI-10 实现只负责本模块技术表上的 Outbox/Inbox 持久化切片，不能替代其他业务模块的 Command Owner，也不能接入生产 Broker/Provider。

### Outbox Dispatcher

- `claimOutboxEvents` 只读取已提交 Outbox，并按 typed Aggregate identity（`aggregate_type + aggregate_id`）的 `aggregate_version` 保持 earliest-unpublished 顺序；不同 Aggregate Type 即使复用同一 UUID 也不互相阻塞；`PENDING/UNKNOWN` 到期行和已过期 `LEASED` 行可被新 owner 回收。
- claim 写入 `lease_owner`、`lease_until`、单调 fencing token 和服务端 `attempt_count`。`confirmPublished` 与失败回写必须验证当前 token；业务 payload/hash/事件身份列不属于 Dispatcher 写权限。
- `markDeliveryFailure` 使用持久化 `attempt_count` 决定 `UNKNOWN`/`DEAD` 与 backoff；外部调用方不能传入一个伪造 attempt 改写阈值。`resumeDeadLetterEvent` 必须保留 EventId、写带 reason 的不可变 Audit，并避免成功恢复没有 Audit。
- WI-10 本地 ACK-loss Probe 的 Principal Fixture 必须显式使用 `status='ACTIVE'`，以真实验证 Inbox 逻辑而不是依赖不存在的数据库默认值。

### Inbox Consumer

- 消费事务按 `claim → canonical hash 校验 → Major/Required Extension 校验 → Enterprise/Project Scope 校验 → idempotent target Command → target state/outbox/audit → PROCESSED` 执行。
- canonical payload hash 必须使用共享 canonicalization v1 + SHA-256；Enterprise 与 payload/Event 的 Project mirror 必须精确匹配，Project 还必须属于 transaction context 的允许集合。
- 同 consumer/EventId/同 hash 重放返回原结果；不同 hash、canonical hash mismatch、未知 Major、缺少 Required Extension 或 Scope conflict 写 Quarantine/Violation，不执行 target。并发唯一键竞态返回已提交结果或明确的可重试状态，不泄漏数据库异常。
- 真实 PostgreSQL fixture 必须使用 `NOINHERIT` 登录，并以 `INHERIT FALSE, SET TRUE` 同时持有 `platform_context_establisher` 与 `identity_policy_app`；`withIdentityTransaction` 依次 `SET LOCAL ROLE platform_context_establisher`、建立 Context、再 `SET LOCAL ROLE identity_policy_app`。缺少 establisher membership 的 fixture 属于测试配置错误，不得作为实现通过证据。
- Scope conflict 的 Quarantine 不得把未经验证的 Event `projectId` 作为 Command Envelope 或 RLS Scope；持久化的 Enterprise 使用受信 Context，只有 Event Enterprise 与 Context Enterprise 一致且 Project 属于 `allowedProjectIds` 时才保留，否则存为 `NULL`，并通过 Violation 类型与安全摘要保留调查信号。

本节不新增公开 API Catalog 条目；导出的 Dispatcher/Inbox 函数是实现端口，业务 Command 仍由各 owning module 的公开 Contract 和 AuthorizationDecision 约束。

## 8. 可人工验收的模块产出

里程碑 `API-IP-01` 的人工产出是：用一组脱敏 Fixture 展示同一飞书用户被解析为 HumanPrincipal、仅获 Project A 权限、访问 Project B 被拒绝；同一 Agent 带 actingFor 仍无法获得 Approval/Release Authorization。审核只验证 Contract 设计，不代表真实飞书、RLS 或权限实现通过。

## 9. 当前状态

- 20 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核；
- WI-08 已有 Schema、Registry、Handler、Persistence 和真实 PostgreSQL gate 测试；PR #48 的 R1-R6 语义修复与回归测试已在本工作区验证，等待最新精确 head 的最终 review；
- WI-09 已有 ActorSnapshot、AuthorizationDecision、四个访问 Query 与 PolicySnapshot Query 的实现入口；PR #49 review 已以最新 WI-08 base 为准补齐 Scope、精确内容寻址引用、完整 canonical facts、引用元数据和公开 Contract 正负边界，当前 scoped core 为 `REVIEW REPAIR VERIFIED`；
- WI-09 最终本地证据：静态/类型/架构/Catalog/兼容性检查通过；独立 PostgreSQL 18.6 / Flyway 11.20.3 gate 为 `11 files / 166 tests PASS`，包含双角色事务 fixture 与二次迁移 no-op。最新 `pnpm verify` 编排在静态阶段通过后受 Docker Hub 未认证拉取 `429` 阻断，不能记为该次编排完整 `PASS`；公开 Handler/HTTP adapter、真实 Provider、跨模块 Runtime、外部 E2E 和人工验收保持 `NOT RUN`；
- WI-08 focused persistence gate 已在 PostgreSQL 18.6 上执行通过，包含 V1004 Project scope 迁移、第二次 no-op、幂等冲突、Project RLS、并发唯一裁决、bootstrap 原子消费、撤销事实和 Event 脱敏回归；本模块的真实 Provider、Keycloak、跨业务模块 Approval/Release、外部 E2E 与人工验收仍为 `NOT RUN`；
- scoped WI-09 core 已完成最新精确 PR head 的 semantic review 和失败回归；当前本地集成又补齐 Enterprise Grant/Project Intent 精确 Scope 与 DENY Audit 同事务回归；不能用静态设计 Gate 或低层 Gate 冒充尚未执行的公开 Handler、外部运行时或人工验收。
- Schema、Registry 与公开 Catalog 已存在；WI-05 PostgreSQL 关系模型、低层 Repository 与 focused persistence tests 已自动验证通过；
- WI-06 真实 PostgreSQL Command transaction runner 的原子 Claim、Context 绑定、精确 CAS、REJECTED current version 与 Reference Edge/Outbox 回滚已自动验证通过；
- WI-07 Handler、Persistence 和回归测试已按本规格接入，并通过完整静态/契约/真实 PostgreSQL gate；本地手工 Probe 的 AES-256-GCM 测试 Port 必须在 `cipher.final()` 后读取 authentication tag，避免测试替身自身的状态错误混入生产实现结论；
- 公开 Handler 的外部 Provider 接入、真实 OpenBao/Keycloak/飞书 Adapter、业务 E2E 与人工验收仍为 `NOT RUN`；WI-10 初始 Outbox/Inbox 持久化切片已在 PR #50 提交并推送。最新 base `0fc8e464…` 已正常合并；messaging fixture 的 `platform_context_establisher` membership、Enterprise Grant 覆盖 Project Intent、typed Aggregate ordering 与未经验证 Event Scope 回归均已在提交 `47a2a9d` 修复，重新编译后真实 PostgreSQL gate 为 `12 files / 177 tests PASS`，空库迁移与二次 migrate no-op 通过，容器已清理；最终 `pnpm clean && pnpm verify` 通过，Vitest 为 `20 passed | 10 skipped`、`341 passed | 164 skipped`，架构、Catalog/Registry 与兼容性检查通过；WI-06/WI-07/WI-10 disposable local Probe 也全部通过。修复已由跟进 [PR #51](https://github.com/qzhike/zhiju-business-core/pull/51) 推送到远端；exact-head CI 已 `SUCCESS`，复审无新增语义发现，外部 Provider 与人工验收仍待完成。

## 10. IM-02 WI-04 持久化切片

IdentityPolicy owning Schema 拥有八张 Enterprise 技术表，并额外以三张独立 Platform 技术表隔离全局事实。Enterprise 表的非空 Project Scope 必须经过 Project Context 校验；Process Step 与父 Process Scope 一致；Reference Edge 判重包含 owner version；audit_reader 仅能读取可实际返回已提交行的 masked surface。Canonical payload↔hash 强校验归属 #33/#34 Repository Gate；#33 的 IdentityPolicy 低层 Repository已用共享 canonical JSON v1 计算并验证，#34 Command Transaction 已完成同事务写入与回滚 Gate。业务 Handler 与真实身份 Provider 不在本切片。

## 11. IM-02 Command 事务持久化约束

1. `idempotency_scope + idempotency_key` 必须通过数据库唯一约束原子 Claim；并发同 key/hash 请求只执行一次 body，loser 等待 winner 提交后返回稳定 `DUPLICATE` 结果。
2. 同 key/不同 hash 必须拒绝 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并在独立可提交边界保存安全审计，不得回显任一原始 Payload。
3. Envelope 的 Principal、ActorSnapshot、AuthorizationDecision、Enterprise、Project 与 Correlation 必须和受信事务上下文完全一致；不一致时在任何 Receipt/Audit/Aggregate 写入前拒绝。
4. CAS 只能使用 Envelope 的 `targetId` 与 `expectedAggregateVersion`；版本计算必须保持 PostgreSQL `bigint` 精度，不得通过 `Number` 转换。
5. REJECTED receipt 的 canonical result 必须保存稳定错误码、安全摘要与 `currentAggregateVersion`，重放返回同一结果。
6. 已应用的 Flyway Migration 不得修改；平台 Receipt 新列通过后续 forward-only IdentityPolicy Migration 增加。

## 12. 合并后 Persistence Gate 的测试隔离约束（2026-08-24）

IdentityPolicy 的业务与审计权限边界保持不变：`identity_policy_app` 必须能够在有效 Context 中追加 `audit_record`，但不能 UPDATE/DELETE；RLS 仍必须拒绝越界 Scope。测试不得通过永久修改生产角色 ACL 来制造失败证据。

WI-10 的 `Audit INSERT` 失败场景需要临时撤销共享角色权限，而 WI-09 的 DENY Decision 也会在同一表写 Audit。因此，运行 `tests/persistence` 的 Gate 必须隔离文件级执行，避免全局 ACL 撤销窗口与其他事务测试重叠。该约束只修复测试编排，不新增角色权限、不修改已应用 Migration，也不改变运行时事务语义。

PR #52 合并后的默认分支已通过直接锁定 digest 的 `12 files / 177 tests` Persistence 运行、二次 migrate no-op 和 WI-02/03/04/09 Runbook 级本地探测；PR #53 已收口 Runbook 文档口径，合并后的 main 完整 verify 仍为 PASS。

最终默认分支的 WI-09 Decision 脱敏追踪和本地 Runbook 角色/RLS/技术表探测已记录于 [`Runbook-Manual-Acceptance-2026-08-24.md`](../archive/im-02-acceptance-issue-28/Runbook-Manual-Acceptance-2026-08-24.md)；外部 Provider、生产环境和真实用户外部验收仍为 `NOT RUN`，不影响本地 scoped IM-02 COMPLETE。

## 13. #176 Policy 版本身份与解析 Port 设计

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED`（PayloadGuard 参数另见 §13.3.1，`#181 已批准 2026-09-13 / 未实现`，不由本节批准覆盖）；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 已交付**构建期 profile registry `im06-static-v1`**（`contracts/registry/policy-profiles.v1.json` 与其生成副本）、四个 profile 的 canonical typed ref 与 closed 字段 Schema，以及本模块的精确注册性检查（`policy-profiles.ts`、`policy-profile-documents.ts`、`commands/static-registry.ts`）；`record_policy_version`/`resolve_policy` 的 Envelope、Handler、生成类型、Purpose 注册、migration 与 PolicyVersion 事实存在性、授权、生命周期和真实业务链仍 `NOT IMPLEMENTED / NOT RUN`。依据 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。本节提案是 `VersionedRef<zhiju.identity.policy>` 定位已提交版本事实的唯一权威来源（2026-09-12 按 [PR #178](https://github.com/qzhike/zhiju-business-core/pull/178) 两轮独立设计审查修订：隔离归属、profile registry 注册路径、取代关系基数，以及后继唯一性只作用于真实取代边）；已完成独立设计审查并获人类批准；可执行 Schema、Registry 条目、Handler 与 migration 仍须按后续实现 Issue 的明确 Scope 交付。§2–§12 的既有类型、20 项公开 Contract、历史 Compatibility Baseline 与现有实现行为不因本节改变；本文档 §5–§11 记录的历史执行结果继续按原文成立。

### 13.1 当前事实与缺口

1. `identity.record_policy_snapshot@1.0`（§3）的载荷只有 `policySetVersion/policySchemaRefs/policyDocument/effectiveFrom/sourceRefs`，**不含 Policy 的 objectId/versionId/Scope**；`policy_snapshot` 行不可变（`REVOKE UPDATE`），`policy_set_version` 唯一。
2. `identity.get_policy_snapshot@1.0`（§4）只接受 `SnapshotRef<PolicySnapshot>`，实现要求 `objectType=identity.policy_snapshot` 且 Scope 为空；该 Query 的接受集合与历史语义保持不变。
3. 因此"某个 `zhiju.identity.policy` 版本对应哪个已提交事实"没有事实来源，也不存在解析 Port；Core §4 与 #166 所述 "IdentityPolicy exact snapshot 解析" 目前无 owning 入口。三个消费模块的纯绑定 helper 只比较调用者传入的观察，不提供存在性、Hash 或生命周期证明。
4. `policy_snapshot` 的 `policy_snapshot_select`/`policy_snapshot_insert` 只校验 `platform_security.context_is_valid()`，不含 enterprise/project 条件：它适合承载 Platform 事实，但**不能承载企业级版本绑定与企业策略正文**，否则任何有效 Context 都能经直接 SQL 读取（13.2、13.6）。

### 13.2 版本键、版本事实、隔离归属与生命周期对应关系

| 概念 | 固定取值 | 约束 |
|---|---|---|
| Policy 版本键 | `VersionedRef<Policy>`：`kind=VERSIONED`、`objectType=zhiju.identity.policy`、`objectId`/`versionId` 为 UuidV7、`scope.enterpriseId` 必填、`scope.projectId` 可选 | 首版不接受空 Scope/Platform Scope 的 Policy 版本；该收紧只作用于新增入口，不改变既有 Schema/helper 的接受集合 |
| 已提交事实 | PolicyVersion 快照：`SnapshotRef<PolicyVersion>`，canonical `objectType=zhiju.identity.policy_version`，`objectId==snapshotId`，Scope 与版本键 Scope 逐字段相等（`enterpriseId` 必填、`projectId` 按版本键有无），`contentHash` = 该事实 canonical payload 的 SHA-256/规范化版本 1 | 事实只存在于本节新增的 scoped 表；**不写入 Platform `policy_snapshot`**，不得伪装成 Platform Snapshot；既有 AuthorizationDecision 的 `policySnapshotRef` 语义不变 |
| 绑定 | 同一 IdentityPolicy 事务内提交版本事实与唯一版本绑定 `(objectType, objectId, versionId, enterpriseId, project_id)` | 一个版本键只能绑定一个已提交事实；无覆盖路径；重复提交返回稳定业务错误，不穿透数据库唯一冲突 |
| 生命周期 | `effectiveFrom`（必填）与派生的 `supersededAt`（由**唯一后继**的取代边派生，等于后继 `effectiveFrom`） | 无默认 TTL；`supersededAt` 不可由调用者直接指定；一个版本至多一个后继（13.4）；首版无版本级撤销入口 |

**隔离归属（为什么不在 Platform 表）**：新版本事实与其 `policyDocument` 落在本模块新增的 scoped 表；旧 `policy_snapshot` 是 Platform 事实，其 RLS 只校验 `context_is_valid()`，**不承载任何企业级版本或正文**。因此"旧 exact Snapshot 入口读取新行"在本设计中不存在：两套事实位于不同表，读取路径互不交叉，也不得互相转换。

| 读取场景 | 归属与结果 | 依据 |
|---|---|---|
| 同 Enterprise（或同 Project）合法读取 | 经 `identity.resolve_policy@1.0` 的 Purpose + Scope 授权返回观察与正文；RLS 同时放行 | 授权为主，RLS 为纵深防御 |
| 另一 Enterprise 的 Context | 授权 Query 统一不可用（`IDENTITY_POLICY_VERSION_UNKNOWN`）；直接 SQL 返回零行或 `42501` | 新表使用与既有 scoped 表一致的 `context_allows_enterprise` / `context_allows_project` 分支与 Scope shape 约束 |
| 同 Enterprise 的另一 Project | 同上；`scope_kind=PROJECT` 行必须同时满足 `context_allows_project`，不得因同 Enterprise 放行 | 沿用既有 Project Scope 规则（§7 不变量 9） |
| 旧 Platform `policy_snapshot` 兼容读回 | 完全不变：仍按 `get_policy_snapshot@1.0` 的 exact id+hash、空 Scope 规则读取既有行；不因本项产生新行 | 历史 baseline 与既有授权链不改写 |

IdentityPolicy 只拥有事实、绑定、Hash 与生命周期，以及"`policySchemaRefs` 是否为构建期注册条目"；policy 文档的 profile 字段语义由消费模块拥有（决定 §12.4），本节不解释他方规则。RLS 与 Scope 校验都不替代授权：解析仍是带 Purpose 的受授权 Query。

### 13.3 新增操作 Spec Delta（提案，未注册）

| Contract | Target / mode | Payload | Result.data / Purpose |
|---|---|---|---|
| `identity.record_policy_version@1.0` | `PolicyVersion / CREATE`（省略 `expectedAggregateVersion`） | `policyRef: VersionedRef<Policy>; policySetVersion: NonEmptyString; policySchemaRefs: NonEmptySet<TypedReference>; policyDocument: CanonicalJson; effectiveFrom: UtcInstant; supersedesRef?: VersionedRef<Policy>` | `{policyVersionRef: SnapshotRef<PolicyVersion>}`；Purpose `identity.policy.record_policy_version`（新增） |
| `identity.resolve_policy@1.0` | AUTHORITATIVE Query | `policyRef: VersionedRef<Policy>`（objectType 固定 canonical） | `PolicyVersionResolutionView`；Purpose `identity.policy.resolve_policy`（新增） |

```text
PolicyVersionResolutionView
├── policyRef: VersionedRef<Policy>                    // 与输入逐字段相等的已核验回显
├── policyVersionRef: SnapshotRef<PolicyVersion>       // canonical zhiju.identity.policy_version；objectId==snapshotId
├── policySetVersion: NonEmptyString
├── policySchemaRefs: TypedReference[]
├── policyDocument: CanonicalJson                      // 与 contentHash 同一 canonical payload
├── contentHash: ContentHash                           // == policyVersionRef.contentHash
├── scopeRef: ScopeRef                                 // 与 policyRef.scope 逐字段相等
├── effectiveFrom: UtcInstant
├── supersededAt?: UtcInstant
├── useStatus: Closed<USABLE | NOT_YET_EFFECTIVE | SUPERSEDED | REVOKED>
└── checkedAt: UtcInstant                              // 受信服务端时间
```

1. `identity.record_policy_snapshot@1.0` 保持合法且不变：其 Platform 行、RLS、读回与授权链不受影响，但不获得版本绑定或解析能力；本项不发布新 Major，不修改其 payload、行结构、历史 fixture 或 200 项 Compatibility Baseline。
2. `policySchemaRefs` 必须是构建期 profile Registry 的已注册 canonical 条目（13.5）；profile 字段语义由消费模块校验，IdentityPolicy 只校验注册性与 canonical 形状。
3. 两个新操作在实现时必须按完整 Envelope 注册（共享 API §9.2），并声明有限额的构建期 PayloadGuard 技术 Policy；`dataClassification=INTERNAL`，若某 profile 将来允许承载客户材料必须重新分类；Catalog 净增 2 项（209 → 211，本模块 20 → 22）。技术 Policy、参数与适用边界见 §13.3.1。
4. 结果 Schema 是 operation-specific CommandResult data，按 #167 的既有纪律注册 `resultSchemaRef`；只声明 `resultReferences` 不构成可验证返回路径。
5. `resolve_policy` 不解析 latest/current、不回退同 objectId 的其他版本、不执行任何写入；正文由本次解析一并返回，因此 WI-02 新链不依赖 `get_policy_snapshot@1.0`。

### 13.3.1 PayloadGuard 技术 Policy、参数与适用边界（#181 提案）

状态：`TECHNICAL DESIGN APPROVED 2026-09-13 / DESIGN VERIFIED / NOT IMPLEMENTED`。本方案与 SD-181-1 已于 2026-09-13 完成独立技术审查并获人类设计验收批准（[人类批准记录](https://github.com/qzhike/zhiju-business-core/pull/182#issuecomment-5647186487)），对应设计 revision `0f596d1f74d9d306bf8a7884ca8adf1f5203d26d`；这是已批准设计基准，不代表操作、参数或业务能力已经实现。本节由 [Issue #181](https://github.com/qzhike/zhiju-business-core/issues/181) 呈现两个新操作的完整请求 Envelope、CommandResult.data、Query Result.data 与有限技术参数，并附带一项字段约束 **SD-181-1**（见"与文件可用性的关系"）；参数值与 SD-181-1 已批准但尚未实现，不得在实现 Issue 中另行替换。计量与依据见本节表与 §13.3.2；Registry 登记随后续明确 Scope 的两个操作实现一并交付。

#### 技术 Policy 与注册映射

采用**共享**技术 Policy（而非分别注册），理由有二：其一，两个操作唯一的可变规模载体是同一份 `policyDocument`，分别注册会让"写入端放行、读取端拒绝"在参数漂移时静默成立；共享条目使该关系成为单点不变量。其二，Guard 算法、错误形状与生成机制全部复用既有实现（§157 方案：`contracts/registry/payload-guard-policies.v1.json`、`loadPayloadGuardPolicies`、`payloadGuardKeyword`、`pnpm contracts:generate` 的字节镜像），本次不新增算法、错误码或校验器。

```json
{
  "type": "identity.policy_version",
  "version": "1.0",
  "maxEnvelopeBytes": 262144,
  "maxResultBytes": 266240,
  "maxStringCodePoints": 16384,
  "maxArrayItems": 1024,
  "maxObjectProperties": 256,
  "maxDepth": 32,
  "maxRequestedKinds": 64
}
```

该 JSON 是与参数表、读回不变量一致的**具体构建期条目定义**（`maxResultBytes` 必须等于 `maxEnvelopeBytes + 4096`，不得取等值）；`payloadGuardPolicyRef` 只引用 `{type, version}`，数值本身由本条目的注册内容决定。

两个操作的 `payloadGuardPolicyRef` 都精确映射为 `{type: "identity.policy_version", version: "1.0"}`：`identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 各在自己的 operation 条目中声明该引用。这是**技术 Registry 引用**，不是业务 `TypedReference`；它不进入 `references`/`resultReferences` 声明，不需要数据库行、授权 Decision 或 `contentHash`，也不得被当作已提交业务事实。既有 `ep.context_source_slice@1.0` 的条目、参数与两项已注册 Source Slice 操作的引用不受本项影响；本项不引入全局默认，未声明 `payloadGuardPolicyRef` 的既有操作行为不变。

#### 参数表与依据

| 参数 | 提案值 | 适用输入/输出与计量单位 | 合法边界 | 依据类别 |
|---|---:|---|---|---|
| maxEnvelopeBytes | 262144（256 KiB） | `record_policy_version` **完整请求 Envelope**（含 `commandId`/`scopeRef`/`targetRef`/`actor`/`authorizationDecisionRef`/`idempotencyKey`/`correlationId`/`requestedAt`/`integrity`、payload 与 `policyDocument`）与 `resolve_policy` 完整请求 Envelope；紧凑 JSON 的 UTF-8 字节 | ≤ 262144 通过；> 262144 拒绝 | 复用 #157 已批准的 Command Envelope 技术预算（PostgreSQL 逻辑模型 §5.5 的 256 KiB 建议） |
| maxResultBytes | 266240 = `maxEnvelopeBytes` + 4096 | `record_policy_version` 的 `CommandResult.data`（`{policyVersionRef}`）与 `resolve_policy` 的 `QueryResult.data`（`PolicyVersionResolutionView`，含内联 `policyDocument`）；同一字节口径 | **≤ 266240 通过；> 266240 拒绝**（不等于上一行：这是请求预算加 4096 余量，**必须以"请求预算 + 固定余量"的形式声明**，不能取等值） | 余量 4096 ≥ 结果侧增量上界 `R_only = 820`（§13.3.1），后者全部由有界形状构成；等值预算下 Project Scope 的实测反例为读回 262153 被拒绝（§13.3.2） |
| maxStringCodePoints | 16384 | 每一个字符串值**与每一个对象键**，按 Unicode code point 计数 | 单串 ≤ 16384 通过；**该上限独立于字节预算，可能先触发** | 复用 #157 已批准的同名技术值（非由字节预算推导）；实测边界 16384 通过 / 16385 拒绝 |
| maxArrayItems | 1024 | 每一个 JSON 数组的元素个数；不改变普通数组顺序或重复语义，也不把 `Set`/`NonEmptySet` 变成可有重复的数组 | 单数组 ≤ 1024 通过 | 复用 #157 已批准的结构预算 |
| maxObjectProperties | 256 | 每一个 JSON object 的成员数（含 `policyDocument` 内对象） | 单对象 ≤ 256 通过 | 同上 |
| maxDepth | 32 | 每个容器（object/array）深度；根容器为 1，每进入一层子容器加 1，标量不增加容器深度 | 最深容器 ≤ 32 通过 | 同上；两个操作的实际最大嵌套为 Envelope→payload→document→profile 字段→数组元素（≤ 6） |
| maxRequestedKinds | 64 | **本项不作用于这两个操作**：二者 payload 均无 `requestedKinds` 字段，该维度是构建期 Registry 形状对条目齐全的要求，不是对本文档的约束 | 该维度不参与裁决 | 显式非适用维度，理由见下 |

**未采用维度与理由**：`maxRequestedKinds` 是 #157 为 `capture.payload.requestedKinds` 增加的**字段专属**上限。PolicyVersion 的两个操作没有同形字段，因此该值对二者不构成任何接受/拒绝判断；之所以仍保留一个有限正整数而非省略，是因为 `loadPayloadGuardPolicies` 要求每个条目恰好声明七项限值——省略会让构建失败，声明一个"无限额"值又违反共享 API §4 的"不允许实现以无限制作为默认值"。因此保留与既有条目一致的值并在此显式声明其非适用性；若将来这两个操作新增任何可枚举集合字段，必须按 §157 的方式为新字段单独定义专属上限，不得让该值自动生效。本项不新增 `Set`/`NonEmptySet` 专属维度：集合语义由结构 Schema 裁决，Guard 只限制元素个数，不改变 `policySchemaRefs` 的 `NonEmptySet`（非空、唯一）契约。

**`maxStringCodePoints` 是独立上限，可能先于字节预算触发**：该维度按 Unicode code point 限制**单个字符串值与对象键**，与总字节预算是两个独立判据，**不得**假定总字节预算蕴含单值上限。实测（§13.3.2）：在提案参数下，`{"payload":{"policyDocument":{"text":"a"×n}}}` 在 n=16384 时总计 16426 字节、Guard 通过；n=16385 时总计 16427 字节、Guard 在 `/payload/policyDocument/text` 返回 `maxStringCodePoints=16384`。两次都远低于 262144 字节，且只改变了字符串长度——即一个总字节数远未超限的合法形状 `policyDocument` 仍会被该维度拒绝。因此：

1. 该维度的实际接受边界是**单串 ≤ 16384 code point**，超出即拒绝，不截断、不按字节预算回退；
2. 保留 16384 的依据是复用 #157 已批准的同名技术值，使两个操作与既有条目使用同一技术层级；它不是由 262144 字节推导出的值，本项不为 PolicyVersion 单独提高或降低它；
3. 若后续需要放宽单串上限，必须按 §157 的方式对共享条目做一次显式参数变更并重新审查；不得在实现中以"能装入 16384 字节预算"为由放宽或绕过该判据。

**依据类别声明**：上表数值全部来自两类可复核依据——既有技术基线（#157 已批准预算、PostgreSQL 逻辑模型 §5.5 的 256 KiB/4 MiB 建议）与**本次实测**（§13.3.2，使用已交付的 Guard 实现与四个已注册 profile 的真实 canonical typed ref）；它们**不是**代表性业务负载的测量结论，也不表示业务最大策略规模。为避免歧义：本项不复用 #157 的 `maxResultBytes`（4 MiB），该参数方案已于 2026-09-13 完成独立技术审查并获人类批准，成为后续实现的设计依据，尚未注册。数值全部为有限正整数，未知字段、重复身份或缺失引用使构建失败；超限一律拒绝，不截断、不自动对象化、不返回部分成功事实。

#### 执行位置与错误形状

`resolve_policy` 与 `record_policy_version` 的 Guard 都在公共 `ContractRegistry` 中执行，且都在结构 Schema 之前：`validateOperation(type, version, input)` 先按显式静态 Policy 做**有界迭代** JSON 树检查（同一棵树在解析大对象或执行授权查询之前被拒绝），再进入 Envelope 结构 Schema；`validateOperationResult(type, version, input)` 以 result 口径对 `CommandResult.data` / `QueryResult.data` 执行同一算法。Guard 不读取授权、数据库或对象存储，也不产生业务副作用；Handler 的固定顺序（共享 API §5.3）把它放在第 1 步，早于授权、幂等与 CAS。

失败沿用既有形状：`ContractValidationResult` 的 `keyword='payloadGuard'`，`instancePath` 为正确转义的 JSON Pointer，`params` 含 `rule` 与 `limit`，总字节超限定位根 `''`；错误不携带原始内容，也不得回显被拒绝的字符串、键名或文档片段。操作层对外错误统一为共享 `API_PAYLOAD_LIMIT_EXCEEDED`（category `VALIDATION`）；本项不新增业务错误码，也不改变既有错误语义。

**外部 Schema 使用方注意**：Guard 是项目自定义断言 keyword，使用方必须加载与构建期相同的实现（未知 Policy 或未加载 Guard 的校验器必须拒绝编译，而不是忽略该 keyword 后宣告有效）。两个操作注册后，结果数据形状的 `$defs` 必须挂 `payloadGuard`；自行解析模块 Schema 的校验器还必须直接调用 `ContractRegistry.validateOperationResult`，否则会绕过本次的读回预算。该绑定语义与 #157 的 read Result 相同，不新增模式。

#### 与文件可用性的关系：写入预算不会让合法版本读不回

`resolve_policy` 返回的 `policyDocument` 必须与写入时通过 Envelope 预算的是**同一份 canonical payload**。若读取侧的包装开销小于写入侧，则通过写入预算的文档必然仍能通过结果预算；若读取侧开销更大，"按本参数合法写入、却因包装开销读不回"就会成立。本节按同一 JSON-value 编码模型给出可复核推导（实测见 §13.3.2）。

**编码模型**：`policyDocument` 在请求 Envelope 与 `QueryResult.data` 中都是 `CanonicalJson` **JSON 值**（共享 API §2/§13.3），不是被二次编码的字符串；Guard 逐节点计量，两侧的同一字符串叶子使用相同的 JSON 编码。实测对照（§13.3.2 `R2`）确认：同一文档无论嵌套在哪种包装里，贡献的字节数相同，文档内容本身不产生请求/结果方向的差异。差异只来自**包装的固定项**。

**结果侧增量的上界**（这是读回保证唯一需要的量；`D` = `policyDocument`）：

读回关系不需要论证请求侧能有多小，只需要结果侧比请求侧**多出**的部分有上界。记：

- `C_req` = 请求 Envelope 去掉 `D` 后的字节；`C_res` = 结果去掉 `D` 后的字节；
- 两侧共有且必须**逐字节相同**的字段——`policyRef`、`policySetVersion`、`policySchemaRefs`、`effectiveFrom`——在 `C_res − C_req` 中抵消；
- 余下的 `R_only = C_res − C_req ≤ 结果专有字段总量`（因为请求专有部分 `W_only ≥ 0`）。

`R_only` 的每个成员都是有界形状，逐个取合法最大编码：

| 结果专有字段 | 合法最大取值 | 实测字节 |
|---|---|---:|
| `scopeRef` | 版本 Scope，含 `enterpriseId` 与 `projectId` | 117 |
| `policyVersionRef` | canonical `SnapshotRef`：`const` objectType + 两个 UuidV7 + Scope + `contentHash` | 444 |
| `contentHash` | `SHA-256` + 64 位 hex + 规范化版本 | 143 |
| `useStatus` | 闭集四值，最长 `NOT_YET_EFFECTIVE` | 31 |
| `checkedAt` | **≤ 24**（SD-181-1） | 38 |
| `supersededAt` | **≤ 24**（SD-181-1；= 唯一后继的 `effectiveFrom`） | 41 |
| **合计 `R_only ≤`** | — | **820** |

`policyRef`/`policyVersionRef` 的 `objectType` 是两个 UuidV7 之外的主要变长部分；§13.2 已把它们固定为 canonical 名称，因此两个新操作（含请求与结果）的 Schema 必须以 `const` 编码该取值，使其按形状有界，而不是仅靠 `maxStringCodePoints` 兜底。

**读回不变量（本次采用的定式）**：两个操作共享的技术条目把结果预算声明为**请求预算加固定余量**，而不是两个独立数值：

```text
maxResultBytes = maxEnvelopeBytes + 4096 = 266240
```

对任意合法写入：`C_req + |D| ≤ 262144`，故读取帧为

```text
C_res + |D| = (C_req + |D|) + (C_res − C_req) ≤ 262144 + R_only ≤ 262144 + 820 = 262964 ≤ 266240
```

**该推导不依赖任何请求侧样本或其最小编码**：请求侧只用到"写入已通过 262144"这一事实，`W_only ≥ 0` 恒成立；唯一需要证明的量是结果侧增量 820 < 4096，而它的每个成员都是有界形状（`const`、闭集、UuidV7、`contentHash`，以及 SD-181-1 限定到 24 的两个时刻）。余量 4096 是 `R_only` 的约 5 倍，因此对字段级细节不再敏感。

**SD-181-1（已于 2026-09-13 一并批准的 Spec Delta）**：两个操作的 payload 与结果中每一个 `UtcInstant`（`effectiveFrom`、`supersededAt`、`checkedAt`）都必须序列化为**至多毫秒精度**的 canonical UTC 时刻，即 `YYYY-MM-DDTHH:mm:ss[.SSS]Z`、至多 24 code point，由这两个操作自己的字段 Schema 以长度上界执行。**不改变**共享 `UtcInstant` 定义、既有操作接受集合与 `compareUtcInstants` 的变长小数比较能力：亚毫秒输入在新操作写入边界被**拒绝**，不截断、不静默降低精度；`supersededAt = 唯一后继的 effectiveFrom` 的相等语义不受影响，因为两侧受同一约束（§13.4 第 4 条继续成立）。

> 为什么该约束不可省：共享 `UtcInstant` 的小数部分为变长（`common.schema.ts` 的 `(?:\d+)?`，且 `contracts/src/utc-instant.ts` 明确按不同长度小数比较），因此**不存在**默认的固定长度序列化。不约束时 `checkedAt` 与 `supersededAt` 各可达 16384 code point，`R_only` 变为约 `820 + 2 × (16384 − 24) = 33540`，**远超 4096 余量**，读回保证不成立——实测：一个 260046 字节正文的前驱合法写入（请求恰好 262144、通过），被一个正文仅 90 字节、`effectiveFrom` 取 1021 code point 的后继取代后，读回为 262441 字节（该数值是**当时等值结果预算 262144** 下的反例；在现行 266240 下其拒绝依据是 SD-181-1 的写入边界时刻长度约束，而非结果预算）。

> 已评估但**不采纳**的替代方案：保留变长时刻并把 `maxResultBytes` 提到能吸收它。按上式需把余量提到约 33 KiB（读取预算约 296 KiB）；该方案让单个时刻字段可占约 16 KiB，且任何将来新增的变长结果字段都会再次打破保证。SD-181-1 把 `R_only` 压到 820，使余量与字段级细节解耦。

**适用范围与维护规则**：本次采用的定式是"结果预算 = 请求预算 + 固定余量，且余量不小于结果侧增量 `R_only` 的上界"。因此：

1. `maxResultBytes > maxEnvelopeBytes` 必须保持，且差值不小于 `R_only` 的实际上界；
2. 结果侧新增任何字段、或放宽 SD-181-1，都必须重新计算 `R_only` 并相应地重选余量；
3. 请求侧字段变化（新增可选字段、放宽 `idempotencyKey` 等）**不影响**该推导，只要写入仍受 `maxEnvelopeBytes` 约束；
4. 两侧共有字段必须继续满足"逐字段相等回显"，否则 `C_res − C_req` 不再有 820 的上界。

§13.3.2 的 2098/1398 等数值是**代表性样本计量**，用于实现期 fixture 与回归对照，不参与本推导。读取无需分页、截断或额外 Result 通道，`get_policy_snapshot@1.0` 也不参与该路径。

### 13.3.2 样本计量与尺寸依据（#181）

以下计量使用**已交付的 Guard 实现**（`payloadGuardErrors`，`contracts/src/payload-guard.ts`）与 `im06-static-v1` 的四个已注册 profile 真实 canonical typed ref（#179 交付），并按 PR #182 审查意见 R1/R2 的发现重做：单值上限被当作字节预算的推论（R1），以及两侧编码模型与固定项的推导不完整（R2）。三项结论都已由本次实测替换或补全。

**计量程序**：构造完整样本后，用二分查找求"Guard 接受的最小字节上限" `B`，该值**就是**样本的字节总数——边界 inclusive（等于上限通过、超过 1 拒绝），故 `B − 1` 是最大的被拒上限，而不是字节数。同一程序对所有样本一致执行，因此请求侧与结果侧的数值可直接比较。

**方法交叉核对（审查意见 R3）**：下方每个数值都与独立计算的紧凑 JSON UTF-8 字节数逐项核对，并同时验证 `B` 通过、`B − 1` 以字节规则拒绝：

| 样本 | 紧凑 JSON 字节 | 最小通过上限 `B` | `B − 1` 的规则 |
|---|---:|---:|---|
| `{}` | 2 | 2 | `maxEnvelopeBytes` |
| `recordResult`（`{policyVersionRef}`） | 446 | 446 | `maxResultBytes` |
| `resolve_policy` 请求 Envelope | 1373 | 1373 | `maxEnvelopeBytes` |
| `{"payload":{"policyDocument":{"text":"a"×40}}}` | 82 | 82 | `maxEnvelopeBytes` |
| `{"payload":{"policyDocument":{"text":"a"×16384}}}` | 16426 | 16426 | `maxEnvelopeBytes` |

字节口径为紧凑 JSON 的 UTF-8 字节数（不带额外空白、不做 Unicode 正规化）；所有样本同时满足其他维度（对象成员数、深度、单串 code point）未触发。

**单值上限的实际边界（审查发现 R1）**：

| 输入（只改变字符串长度） | 总计字节 | Guard 结果 |
|---|---:|---|
| `{"payload":{"policyDocument":{"text":"a"×16384}}}` | 16426 | 通过 |
| `{"payload":{"policyDocument":{"text":"a"×16385}}}` | 16427 | 拒绝：`rule=maxStringCodePoints`、`limit=16384`、`instancePath=/payload/policyDocument/text` |

两次都远低于 262144 字节预算。`maxStringCodePoints` 是**独立的、可能先于字节预算触发**的上限（§13.3.1），不能用字节预算推导。

**编码对照（审查发现 R2）**：同一文档分别内联为请求侧与结果侧的 JSON 值。实测确认文档贡献的字节数不随包装方向变化；请求/结果的差额完全由包装固定项决定（下表）。此前把两侧差异归因于"请求是转义字符串、结果是解析值"的说明**不成立**，已删除。

**时刻长度反例与 SD-181-1**：共享 `UtcInstant` 的小数部分为变长，因此 `supersededAt`（= 唯一后继的 `effectiveFrom`）与 `checkedAt` 不受本版本写入预算约束。实测反例：

| 步骤 | 数值 | Guard |
|---|---:|---|
| 前驱正文按最小请求包装写满 | 文档 260046，请求 Envelope 262144 | 通过 |
| 一个正文仅 90 字节的后继取代它，`effectiveFrom` 取 `2026-09-13T00:00:00.` + 1000 个 `0` + `Z`（1021 code point，Ajv 校验共享 `utcInstant` 为 true） | 后继请求 2478 | 通过 |
| 读回前驱（`supersededAt` 等于该后继 `effectiveFrom`，`useStatus=NOT_YET_EFFECTIVE`） | 262441 | 在**等值预算**下被 `maxResultBytes` 拒绝 |

即**不约束时刻长度时，"写得进读不回"真实成立**。两个结果专有变长时刻各可达 16384，`R_only` 因此约为 33540，远超 4096 余量（§13.3.1）。SD-181-1 把这两个时刻限制到 24 code point 后，`R_only` 落到 820，由余量覆盖。

**固定项**（单位字节；样本取 Project Scope、UUIDv7 引用、64 位 hex `contentHash` 与 24 长度时刻；**含空文档 `{}` 的样本取"最小通过上限减 2"**，因为该样本内嵌一个占 2 字节的空 `policyDocument`）：

| 结构 | 组成 | 字节 |
|---|---|---:|
| `record_policy_version` 请求 Envelope（`supersedesRef` 缺省） | 全部 Envelope 字段 + payload 的 `policyRef`/`policySetVersion`/`policySchemaRefs`/`effectiveFrom` | 2098 |
| `record_policy_version` 请求 Envelope（含 `supersedesRef`） | 追加一个 `VersionedRef<Policy>` | 2388 |
| `resolve_policy` 请求 Envelope | 固定：payload 只有 `policyRef`，**不含文档**（直接用最小通过上限） | 1373 |
| `resolve_policy` 结果数据（`useStatus=USABLE`、`supersededAt` 缺省） | `PolicyVersionResolutionView` 除 `policyDocument` 外全部字段 | 1345 |
| `resolve_policy` 结果数据（`useStatus=NOT_YET_EFFECTIVE`、`supersededAt` 缺省） | 状态取最长闭集值 | 1356 |
| `resolve_policy` 结果数据（`useStatus=USABLE`、含 `supersededAt`） | 追加一个 24 长度 `UtcInstant` | 1387 |
| `resolve_policy` 结果数据**包装上界**（`useStatus=NOT_YET_EFFECTIVE` 且含 `supersededAt`） | 结果侧最大合法形态 | **1398** |
| `record_policy_version` 结果数据 | `{policyVersionRef}`，**不含文档**（直接用最小通过上限） | 446 |

**结果侧增量 `R_only` 与余量的实测（审查意见 R2 的定式修订）**：本提案不再用"请求侧能多小 × 结果侧能多大"的极值配对来论证读回，而是采用 §13.3.1 的定式——**结果预算 = 请求预算 + 固定余量**，只需证明结果侧增量有上界。逐项实测（合法最大编码）：

| 结果专有字段 | 实测字节 |
|---|---:|
| `scopeRef` | 117 |
| `policyVersionRef` | 444 |
| `contentHash` | 143 |
| `useStatus`（`NOT_YET_EFFECTIVE`） | 31 |
| `checkedAt`（24） | 38 |
| `supersededAt`（24） | 41 |
| **`R_only` 合计** | **820** |

820 < 4096，因此对任意合法写入，读取帧 ≤ `262144 + 820 = 262964 ≤ 266240`。

**等值预算的反例（说明为什么余量必需）**：取 `maxResultBytes = maxEnvelopeBytes = 262144` 时，一个按最小请求编码写满的 Project 版本（文档 260772、请求恰好 262144、通过）读回为 **262153**，被 `maxResultBytes` 拒绝。该反例只说明"相等"不成立，不再用于推导具体余量——余量来自 `R_only` 的上界。

**边界复核（加入 4096 余量后）**：

| Scope | 写入 | 读取 | 上限 | 结果 |
|---|---:|---:|---:|---|
| Project | 262144 通过 / 262145 拒绝 `maxEnvelopeBytes`（`instancePath=''`） | 262157 | 266240 | 通过 |
| 结果恰等于上限 | — | 266240 通过 | 266240 | 通过 |
| 结果多 1 字节 | — | 266241 | 266240 | 拒绝 `maxResultBytes` |

**时刻长度项（SD-181-1）**：放宽该约束后 `checkedAt` 与 `supersededAt` 各可达 16384 code point，`R_only` 变为约 `820 + 2 × (16384 − 24) = 33540`（约 33 KiB），远超 4096 余量，读回保证不成立。实测反例：一个 260046 字节正文的前驱合法写入（请求恰好 262144、通过），被一个正文仅 90 字节、`effectiveFrom` 取 1021 code point 的后继取代后，读回为 262441 字节（在**当时等值的结果预算 262144** 下被拒绝；现行 266240 下该规模的拒绝依据是时刻长度约束本身）。

### 13.4 不变量

1. Policy 版本键在其有效期内唯一确定一个已提交版本事实；`contentHash` 与 `snapshotId` 不因重放或并发改变。
2. 同一版本键的第二次提交必须稳定拒绝；不得覆盖、不得返回原结果、不得留下部分绑定或成功 Outbox。
3. `supersedesRef` 必须指向同 objectType/objectId/Scope 的另一已提交版本，且其 `effectiveFrom` 严格早于本次 `effectiveFrom`；自引用、倒序、跨 Scope、不存在一律拒绝，不产生"自我取代"。
4. **一个版本至多有一个后继**：取代边只对真实边唯一（部分唯一索引），由数据库裁决并发；第二个竞争提交稳定拒绝且不改写首个后继。该唯一性**不约束无前驱的初始版本**：同一 Scope 下不同 Policy 各自的首版、同一 identity 的多个未互相取代的版本都必须能共存。被取代版本的 `supersededAt` 等于其唯一后继的 `effectiveFrom`，只由已提交取代边派生，任何重放/重试/后续提交都不得延长。
5. 首版不支持分叉取代、跨 identity 取代或指向 Platform Snapshot 的取代边；连锁取代逐条独立校验。首版也不强制"同一 identity 同时只有一个可用版本"：未声明取代的版本保持无有限终止，该性质必须显式可见。
6. 已被取代的版本保留历史可读，但其 `useStatus` 不再为 `USABLE`；历史重放不重新赋予执行资格；首版无版本级撤销入口，任何 `REVOKED` 观察都不得当作可用。
7. `policySchemaRefs` 必须是构建期 Registry 的已注册 canonical typed ref，逐字段相等比较；未注册 schema 返回 `IDENTITY_POLICY_VERSION_UNKNOWN`。本项以新 registry 版本承载四个 profile 条目，既有条目与旧命令接受集合都不放宽、不收窄。
8. 解析是只读观察，不是授权：Scope 授权、profile 字段校验、业务条件与当前有效性判断由各消费边界独立执行。
9. 通用 `VersionedRef` 继续不携带 `contentHash`；`SnapshotRef` 的 `contentHash` 是唯一 Hash 载体；企业级版本事实与正文只存在于 scoped 表，不进入 Platform `policy_snapshot`。

### 13.5 授权、profile schema 注册与失败审计

**profile schema Registry 边界**（写入与消费两端的注册路径）：四个首版 profile 是构建期注册的 policy schema，公开身份为 `VersionedRef`（`objectType=identity.contract_schema`、固定 UuidV7 `objectId`/`versionId`、`scope={}`），与既有 `POLICY_SCHEMA_TYPED_REFS` 同形；registry key 与 typed ref 一一对应，运行期不解析 latest、不创建数据库行、不虚构 Hash。

| registry key | Owner | 首次消费方 |
|---|---|---|
| `ep.context_source_slice_capture.policy@1.0` | enterprise-project | EP Source Slice capture |
| `execution.context_builder.policy@1.0` | task-execution | TE Initial Context Builder |
| `execution.task_readiness.policy@1.0` | task-execution | TE TaskReadinessBuilder |
| `execution.work_order_validation.policy@1.0` | task-execution | TE WorkOrderValidator |

- 注册方式：新增 registry 版本（提案 `im06-static-v1`）= 既有 `im02-static-v1` 三项 ∪ 上表四项；作为构建期制品与生成检查覆盖，由本模块与 owning 模块共同加载（提案置于 `contracts/registry/`），使任一模块都不内置他方语义。`identity.record_policy_snapshot@1.0` 保持历史 `im02-static-v1` 接受集合不变；`identity.record_policy_version@1.0` 只接受新版本集合。
- 校验分工：本模块判定"是否为已注册 canonical 条目"；EP/TE 判定"文档是否符合本模块 profile 的 closed 字段与语义、所需 key 是否在集合内"。
- 实现状态（#179，仅静态注册与纯校验）：registry 版本、七个条目（历史三项 ∪ 四个 profile）、canonical typed ref 与 closed 字段 Schema 已作为构建期制品交付，重复 key/重复身份、缺失映射与生成物漂移在加载与 `pnpm contracts:check` 处确定性拒绝；本模块只提供精确注册性检查（`registeredPolicySchemaKey(registryVersion, reference)`，未知版本 fail closed），不解释任何 profile 规则字段。写入 Handler 与对外 `IDENTITY_POLICY_VERSION_UNKNOWN` 映射仍随 `identity.record_policy_version@1.0` 交付，不因本次注册而建立。

**PayloadGuard 技术 Policy 注册边界**：`identity.policy_version@1.0` 是构建期技术条目（§13.3.1），与 profile registry 是**两条互不从属的注册路径**：profile registry 判定"这个 `policySchemaRefs` 条目是否是已注册 canonical schema"，PayloadGuard registry 判定"这个操作允许的请求/结果规模上限是多少"。二者都不创建数据库行、不虚构 Hash、不参与授权，也不得互为替代。未知技术 Policy 或未加载 Guard 的校验器必须拒绝编译或拒绝校验，不得降级为"无限制"。参数与边界已获批准，后续按明确实现 Scope 交付（§13.3.1 状态）。

**授权与失败**：

- 解析 Query 与写入 Command 都走既有 Envelope 与精确 Purpose；请求 `policyRef.scope` 必须落在调用者当前授权 Scope 内；`DENY` 与 Scope 不符按 §7 WI-09 规则写同事务脱敏 Audit，不泄露跨 Scope 对象是否存在。RLS 只作纵深防御。
- 对外统一不可用：`IDENTITY_POLICY_VERSION_UNKNOWN` 覆盖"身份/版本未知、未绑定、Scope 不符"；内部分类（unknown-identity / unknown-version / not-bound / scope-mismatch）只进受权限控制的 Audit。
- 事实存在但完整性失败（mirror/Hash/payload 不一致）为 `IDENTITY_POLICY_SNAPSHOT_INVALID`；同一版本键重复绑定为新增 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`；取代边非法为新增 `IDENTITY_POLICY_SUPERSEDE_INVALID`；前驱已有唯一后继时为新增 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`。
- 存储或依赖暂时不可用返回共享 `DEPENDENCY_UNAVAILABLE`；不得当作空 Policy、默认 Policy 或"无限制"继续。
- 上述四个新增错误码与两个新增 Purpose 在实现时一并登记到 §6 与两个 registry；现有运行时已抛出但 §6 尚未列出的 `IDENTITY_POLICY_SNAPSHOT_NOT_FOUND` 与 `IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH` 也应在该次收敛，本项不改变其现有语义。

### 13.6 持久化边界（提案）

1. **新增 scoped 不可变事实表**（本模块 owning，提案名 `identity_policy.policy_version`）：`policy_version_fact_id`（PK，同时是 `SnapshotRef` 的 `objectId`/`snapshotId`）、`policy_object_id`、`policy_key_version_id`、`scope_kind`（`ENTERPRISE|PROJECT`）、`enterprise_id`、`project_id`、`policy_set_version`、`policy_schema_refs`、`effective_from`、`policy_document`（canonical payload 内）、`payload_hash`、`canonical_payload`、`supersedes_object_id`/`supersedes_version_id`（成对，可为 NULL）以及既有技术列（contract type/version、registry/canonicalization version、created_at/created_by/actor_snapshot_id/source_command_id、data_classification、retention_class）。
2. **约束**：`UNIQUE (policy_object_id, policy_key_version_id, enterprise_id, project_id) NULLS NOT DISTINCT` 保证版本键唯一绑定，**覆盖全部行**；后继唯一性只作用于**真实取代边**：部分唯一索引 `UNIQUE (supersedes_object_id, supersedes_version_id, enterprise_id, project_id) NULLS NOT DISTINCT WHERE supersedes_object_id IS NOT NULL AND supersedes_version_id IS NOT NULL`。`supersedesRef` 是可选的，无前驱的初始版本两列均为 NULL；若把后继唯一约束无条件施加于全部行，同一 Scope 下不同 Policy 的首版会全部折叠为同一个键 `(NULL, NULL, E, [P])` 而互相冲突，因此必须使用该部分索引（且两条唯一对象都必须 `NULLS NOT DISTINCT`，否则 Enterprise 行 `project_id IS NULL` 会使比较失效）。`supersedes` 两列另以 `CHECK` 约束同时为空或同时非空，使部分谓词良定义；`CHECK` 固定 Scope shape（Enterprise 行 `project_id IS NULL`、Project 行 `project_id NOT NULL` 且 `enterprise_id` 非空）；`CHECK (octet_length(payload_hash) = 32)`；`REVOKE UPDATE, DELETE` + trigger 镜像校验（`effective_from`、`policy_set_version`、`policy_schema_refs`、Scope 镜像与 canonical payload 逐项一致）。非法 shape、镜像不一致、重复版本键与重复后继都在写入前拒绝并转换为稳定模块错误，不穿透 `23505`。
3. **RLS 分支**：新表启用 FORCE RLS，SELECT/INSERT 使用与既有 scoped 表相同的分支——`(scope_kind='ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id)) OR (scope_kind='PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))`；**不采用 Platform 表的 `context_is_valid()`-only 分支**。授权仍以 Purpose + Scope 的 Query 判定为主，RLS 只作纵深防御。
4. **访问路径**：`(policy_object_id, policy_key_version_id, enterprise_id, project_id)` → 唯一已提交版本事实；`supersedes` 边唯一索引 → 前驱（派生 `supersededAt`）。首版**不提供"列出全部版本/当前版本"的访问路径**，避免引入 latest 语义；需要正文时由 `resolve_policy` 在同一次授权读取中返回。
5. **旧 Platform `policy_snapshot` 完全不变**：表、`policy_snapshot_select`/`policy_snapshot_insert`、`REVOKE UPDATE`、`policy_snapshot_set_unique` 与 `get_policy_snapshot@1.0` 的读回语义均不改写；新表不与旧表建立 FK/join，也不把 scoped 行写入旧表。
6. 新增迁移必须 forward-only 并在实际分支分配编号，不修改已应用的 V1000–V1004；迁移验证须覆盖空库、升级、二次 no-op、角色 ACL/RLS、镜像与 Hash、immutable/direct SQL、并发版本键与并发后继竞争。业务 Handler、迁移、真实 PostgreSQL 业务链、授权运行与外部验收在批准与实现前保持 `NOT RUN`。
