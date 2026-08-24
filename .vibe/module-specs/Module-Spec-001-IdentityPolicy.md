# Module-Spec-001-IdentityPolicy

版本：v0.1
日期：2026-08-13
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / WI-05 PERSISTENCE AUTOMATED PASS / EXTERNAL NOT RUN`

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

授权拒绝默认只写安全审计，不作为公开跨模块业务事件；任何 Event 均不得携带 Role 条件全文、Capability Token、External ID 原值或个人联系方式。

## 6. 模块错误码

```text
IDENTITY_PRINCIPAL_KIND_IMMUTABLE
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

## 8. 可人工验收的模块产出

里程碑 `API-IP-01` 的人工产出是：用一组脱敏 Fixture 展示同一飞书用户被解析为 HumanPrincipal、仅获 Project A 权限、访问 Project B 被拒绝；同一 Agent 带 actingFor 仍无法获得 Approval/Release Authorization。审核只验证 Contract 设计，不代表真实飞书、RLS 或权限实现通过。

## 9. 当前状态

- 20 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核；
- 20 个字段级 Schema/Registry 已落地；WI-05 PostgreSQL 关系模型、低层 Repository 与 focused persistence tests 已在 PR #45 集成 head 自动验证通过；
- 公开 Handler、真实 OpenBao/Keycloak/飞书 Adapter、业务 E2E 与人工验收仍为 `NOT RUN`。

## 10. IM-02 WI-04 持久化切片

IdentityPolicy owning Schema 拥有八张 Enterprise 技术表，并额外以三张独立 Platform 技术表隔离全局事实。Enterprise 表的非空 Project Scope 必须经过 Project Context 校验；Process Step 与父 Process Scope 一致；Reference Edge 判重包含 owner version；audit_reader 仅能读取可实际返回已提交行的 masked surface。Canonical payload↔hash 强校验归属 #33/#34 Repository Gate；#33 的 IdentityPolicy 低层 Repository 已用共享 canonical JSON v1 计算并验证，#34 Command Transaction 仍为 `NOT RUN`。业务 Handler 与真实身份 Provider不在本切片。
