# Module-Spec-001-IdentityPolicy

版本：v0.3
日期：2026-08-24
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / WI-09 SCOPE+DENY-AUDIT REGRESSION VERIFIED 2026-08-24 / WI-10 TYPED-ORDER+SCOPE REGRESSION VERIFIED 2026-08-24 / PR #51+#52+#53+#54+#55 MERGED / FINAL MAIN VERIFY PASS / IM-02 COMPLETE / ISSUE #28 CLOSED / #176 POLICY VERSION RESOLUTION DESIGN APPROVED 2026-09-12 DESIGN VERIFIED / #181 PAYLOADGUARD PARAMETERS + SD-181-1 APPROVED 2026-09-13 DESIGN VERIFIED / #206 TASK READINESS PRODUCTION AND READY TRANSITION AUTHORIZATION COMPOSITION MERGED 2026-09-16 (PR #207, §15.5, TWO INDEPENDENT ENTRIES) / #208 TASK EXECUTION READINESS AUTHORIZATION PORT AND BOTH ENTRIES IMPLEMENTED 2026-09-16 (REVALIDATION BEFORE IDEMPOTENCY CLAIM, EXECUTED ON REAL PostgreSQL) / EXTERNAL NOT RUN`

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
IDENTITY_POLICY_VERSION_ALREADY_BOUND
IDENTITY_POLICY_SUPERSEDE_INVALID
IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED
IDENTITY_POLICY_SNAPSHOT_NOT_FOUND
IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH
IDENTITY_ACTING_FOR_ESCALATION_FORBIDDEN
IDENTITY_DIRECTORY_ENUMERATION_FORBIDDEN
```

`IDENTITY_POLICY_VERSION_ALREADY_BOUND`、`IDENTITY_POLICY_SUPERSEDE_INVALID`、`IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED` 是 #176/#181 已批准设计的新增错误名，随 #183 与两个新 Purpose 一并登记；两个 PolicyVersion 操作尚无 Handler，因此这些名称目前只是**声明**，运行映射仍 `NOT RUN`。`IDENTITY_POLICY_VERSION_UNKNOWN` 对外统一覆盖“身份/版本未知、未绑定、Scope 不符”（§13.5），内部分类只进受权限控制的 Audit；存储或依赖暂时不可用沿用共享 `DEPENDENCY_UNAVAILABLE`，不得当作空 Policy、默认 Policy 或“无限制”继续。`IDENTITY_POLICY_SNAPSHOT_NOT_FOUND` 与 `IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH` 是既有 `get_policy_snapshot@1.0` 运行时已抛出但本节此前未列出的名称，本次只补齐文档，不改变其现有语义与接受集合。

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

- 22 个公开 Contract 已定义字段级 payload/result/event 结构；其中 `identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 的静态契约由 #183 注册（Schema/Registry/Catalog/PayloadGuard/生成类型/fixture），Handler、精确 Purpose 授权、`identity_policy.policy_version` scoped 持久化（V1005）与真实 PostgreSQL 写入/读回由 #186 交付，详见 §13.7；四个创建版本的版本绑定授权组成层（内部 `TaskExecutionCreationAuthorizationPort`、single covering Grant 判定与 V1006 target 绑定，见 §15）由 #200 交付，TaskExecution 消费仍 `NOT RUN`；下游 Builder/Validator/Freeze 消费与 EP/TE 业务链仍 `NOT RUN`；
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

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / STATIC CONTRACT REGISTERED 2026-09-13 (#183) / HANDLER, AUTHORIZATION AND SCOPED PERSISTENCE IMPLEMENTED 2026-09-13 (#186)`（PayloadGuard 参数另见 §13.3.1，已随 #183 注册）；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 已交付**构建期 profile registry `im06-static-v1`**（`contracts/registry/policy-profiles.v1.json` 与其生成副本）、四个 profile 的 canonical typed ref 与 closed 字段 Schema，以及本模块的精确注册性检查（`policy-profiles.ts`、`policy-profile-documents.ts`、`commands/static-registry.ts`）；[Issue #183](https://github.com/qzhike/zhiju-business-core/issues/183) 已交付两个操作的静态可执行契约：完整 Envelope/Payload/Result Schema、public-api 与 operation-compatibility-metadata 两个 Registry 条目、Catalog/Registry 209 → 211（本模块 20 → 22）、共享 PayloadGuard 技术条目 `identity.policy_version@1.0`、生成类型与契约 fixture；`record_policy_version`/`resolve_policy` 的 Handler、migration 与 PolicyVersion 事实存在性、Purpose 的真实授权路径、生命周期和真实业务链仍 `NOT IMPLEMENTED / NOT RUN`。依据 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。本节提案是 `VersionedRef<zhiju.identity.policy>` 定位已提交版本事实的唯一权威来源（2026-09-12 按 [PR #178](https://github.com/qzhike/zhiju-business-core/pull/178) 两轮独立设计审查修订：隔离归属、profile registry 注册路径、取代关系基数，以及后继唯一性只作用于真实取代边）；已完成独立设计审查并获人类批准；可执行 Schema 与 Registry 条目已由 [Issue #183](https://github.com/qzhike/zhiju-business-core/issues/183) 交付（Catalog/Registry 209 → 211、共享 PayloadGuard 条目、生成类型与 fixture），Handler 与 migration 仍须按后续实现 Issue 的明确 Scope 交付。§2–§12 的既有类型、20 项公开 Contract、历史 Compatibility Baseline 与现有实现行为不因本节改变；本文档 §5–§11 记录的历史执行结果继续按原文成立。

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

### 13.3 新增操作 Spec Delta（#183 已静态注册，#186 已实现 Handler）

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
3. 两个新操作已由 #183 按完整 Envelope 注册（共享 API §9.2），并声明共享的有限额构建期 PayloadGuard 技术 Policy；`dataClassification=INTERNAL`，若某 profile 将来允许承载客户材料必须重新分类；Catalog 净增 2 项（209 → 211，本模块 20 → 22）。技术 Policy、参数与适用边界见 §13.3.1。
4. 结果 Schema 是 operation-specific CommandResult data，按 #167 的既有纪律注册 `resultSchemaRef`；只声明 `resultReferences` 不构成可验证返回路径。
5. `resolve_policy` 不解析 latest/current、不回退同 objectId 的其他版本、不执行任何写入；正文由本次解析一并返回，因此 WI-02 新链不依赖 `get_policy_snapshot@1.0`。

### 13.3.1 PayloadGuard 技术 Policy、参数与适用边界（#181 已批准，#183 已注册）

状态：`TECHNICAL DESIGN APPROVED 2026-09-13 / DESIGN VERIFIED / PARAMETERS REGISTERED 2026-09-13 (#183) / HANDLER IMPLEMENTED 2026-09-13 (#186)`。本方案与 SD-181-1 已于 2026-09-13 完成独立技术审查并获人类设计验收批准（[人类批准记录](https://github.com/qzhike/zhiju-business-core/pull/182#issuecomment-5647186487)），对应设计 revision `0f596d1f74d9d306bf8a7884ca8adf1f5203d26d`；这是已批准设计基准；参数与字段约束已随 #183 静态注册，但不代表 Handler、授权或业务能力已经实现。本节由 [Issue #181](https://github.com/qzhike/zhiju-business-core/issues/181) 呈现两个新操作的完整请求 Envelope、CommandResult.data、Query Result.data 与有限技术参数，并附带一项字段约束 **SD-181-1**（见"与文件可用性的关系"）；参数值与 SD-181-1 已批准并已由 #183 注册为共享条目 `identity.policy_version@1.0`，实现中不得另行替换或取等值。计量与依据见本节表与 §13.3.2；Registry 登记、两个操作的 Schema 与 SD-181-1 的字段上界已随该次静态契约交付，Handler 与运行期授权映射仍未实现。

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

该 JSON 是与参数表、读回不变量一致的**具体构建期条目定义**（`maxResultBytes` 必须等于 `maxEnvelopeBytes + 4096`，不得取等值）；`payloadGuardPolicyRef` 只引用 `{type, version}`，数值本身由本条目的注册内容决定。该条目已由 #183 按本节数值写入 `contracts/registry/payload-guard-policies.v1.json`（与生成副本字节一致），两个操作各在自己的 operation 条目中声明该引用；注册检查用例断言七项参数与差值，签名 fixture 复现 §13.3.2 的结果侧计量。

两个操作的 `payloadGuardPolicyRef` 都精确映射为 `{type: "identity.policy_version", version: "1.0"}`：`identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 各在自己的 operation 条目中声明该引用。这是**技术 Registry 引用**，不是业务 `TypedReference`；它不进入 `references`/`resultReferences` 声明，不需要数据库行、授权 Decision 或 `contentHash`，也不得被当作已提交业务事实。既有 `ep.context_source_slice@1.0` 的条目、参数与两项已注册 Source Slice 操作的引用不受本项影响；本项不引入全局默认，未声明 `payloadGuardPolicyRef` 的既有操作行为不变。

#### 参数表与依据

| 参数 | 提案值 | 适用输入/输出与计量单位 | 合法边界 | 依据类别 |
|---|---:|---|---|---|
| maxEnvelopeBytes | 262144（256 KiB） | `record_policy_version` **完整请求 Envelope**（含 `commandId`/`scopeRef`/`targetRef`/`actor`/`authorizationDecisionRef`/`idempotencyKey`/`correlationId`/`requestedAt`/`integrity`、payload 与 `policyDocument`）与 `resolve_policy` 完整请求 Envelope；紧凑 JSON 的 UTF-8 字节 | ≤ 262144 通过；> 262144 拒绝 | 复用 #157 已批准的 Command Envelope 技术预算（PostgreSQL 逻辑模型 §5.5 的 256 KiB 建议） |
| maxResultBytes | 266240 = `maxEnvelopeBytes` + 4096 | `record_policy_version` 的 `CommandResult.data`（`{policyVersionRef}`）与 `resolve_policy` 的 `QueryResult.data`（`PolicyVersionResolutionView`，含内联 `policyDocument`）；同一字节口径 | **≤ 266240 通过；> 266240 拒绝**（不等于上一行：这是请求预算加 4096 余量，**必须以"请求预算 + 固定余量"的形式声明**，不能取等值） | 余量 4096 ≥ 结果专有字段总量上界 `R_only ≤ 820`（§13.3.1），后者全部由有界形状构成；当前契约下满足回显与绑定约束的合法写入在等值预算对照中也能通过，4096 作为已批准的固定余量保留（§13.3.2，2026-09-13 事实更正） |
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

**依据类别声明**：上表数值全部来自两类可复核依据——既有技术基线（#157 已批准预算、PostgreSQL 逻辑模型 §5.5 的 256 KiB/4 MiB 建议）与**本次实测**（§13.3.2，使用已交付的 Guard 实现与四个已注册 profile 的真实 canonical typed ref）；它们**不是**代表性业务负载的测量结论，也不表示业务最大策略规模。为避免歧义：本项不复用 #157 的 `maxResultBytes`（4 MiB），该参数方案已于 2026-09-13 完成独立技术审查并获人类批准，成为后续实现的设计依据，并已由 #183 注册为共享条目 `identity.policy_version@1.0`。数值全部为有限正整数，未知字段、重复身份或缺失引用使构建失败；超限一律拒绝，不截断、不自动对象化、不返回部分成功事实。

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
- 余下的增量满足 `C_res − C_req ≤ R_only`：`R_only` 是**结果专有字段总量**，`W_only ≥ 0` 是请求专有部分。两者不是同一个量，`R_only` 不等于 `C_res − C_req`。

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

**等值预算对照（2026-09-13 事实更正）**：当前 Envelope、canonical 引用与 SD-181-1 下，满足逐字段回显及绑定约束的合法写入，其读回在等值预算对照中也能通过；此前记录的"一个按最小请求编码写满的 Project 版本（文档 260772、请求恰好 262144、通过）读回为 **262153**、在等值预算 262144 下被拒"**不适用于当前契约**，撤回其作为有效反例的结论。正式注册参数仍保持 `maxResultBytes = maxEnvelopeBytes + 4096 = 266240`；4096 是已批准的固定余量，读回保证继续使用不依赖请求最小编码的充分条件 `C_res − C_req ≤ R_only ≤ 820 < 4096`；本次事实纠正不改变公开接受集合或参数。推导与实测见下方边界复核与 Module-Test 001 `IP-181-C-002`。

**边界复核（加入 4096 余量后）**：

| Scope | 写入 | 读取 | 上限 | 结果 |
|---|---:|---:|---:|---|
| Project | 262144 通过 / 262145 拒绝 `maxEnvelopeBytes`（`instancePath=''`） | 262067（最小合法请求包装 × 最大结果包装） | 266240 | 通过 |
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
- 实现状态（#179，仅静态注册与纯校验）：registry 版本、七个条目（历史三项 ∪ 四个 profile）、canonical typed ref 与 closed 字段 Schema 已作为构建期制品交付，重复 key/重复身份、缺失映射与生成物漂移在加载与 `pnpm contracts:check` 处确定性拒绝；本模块只提供精确注册性检查（`registeredPolicySchemaKey(registryVersion, reference)`，未知版本 fail closed），不解释任何 profile 规则字段。写入 Handler 与对外 `IDENTITY_POLICY_VERSION_UNKNOWN` 映射已由 #186 随 `identity.record_policy_version@1.0` 交付并写入 §13.7。

**PayloadGuard 技术 Policy 注册边界**：`identity.policy_version@1.0` 是构建期技术条目（§13.3.1），与 profile registry 是**两条互不从属的注册路径**：profile registry 判定"这个 `policySchemaRefs` 条目是否是已注册 canonical schema"，PayloadGuard registry 判定"这个操作允许的请求/结果规模上限是多少"。二者都不创建数据库行、不虚构 Hash、不参与授权，也不得互为替代。未知技术 Policy 或未加载 Guard 的校验器必须拒绝编译或拒绝校验，不得降级为"无限制"。参数与边界已获批准，并已由 #183 完成静态注册（§13.3.1 状态）：条目、两个操作的引用与确定性生成检查均已交付，运行期仍只有 `ContractRegistry` 的既有 Guard 执行点，不新增算法或错误码。

**授权与失败**：

- 解析 Query 与写入 Command 都走既有 Envelope 与精确 Purpose；请求 `policyRef.scope` 必须落在调用者当前授权 Scope 内；`DENY` 与 Scope 不符按 §7 WI-09 规则写同事务脱敏 Audit，不泄露跨 Scope 对象是否存在。RLS 只作纵深防御。
- 对外统一不可用：`IDENTITY_POLICY_VERSION_UNKNOWN` 覆盖"身份/版本未知、未绑定、Scope 不符"；内部分类（unknown-identity / unknown-version / not-bound / scope-mismatch）只进受权限控制的 Audit。
- 事实存在但完整性失败（mirror/Hash/payload 不一致）为 `IDENTITY_POLICY_SNAPSHOT_INVALID`；同一版本键重复绑定为新增 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`；取代边非法为新增 `IDENTITY_POLICY_SUPERSEDE_INVALID`；前驱已有唯一后继时为新增 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`。
- 存储或依赖暂时不可用返回共享 `DEPENDENCY_UNAVAILABLE`；不得当作空 Policy、默认 Policy 或"无限制"继续。
- 上述四个新增错误码与两个新增 Purpose 在实现时一并登记到 §6 与两个 registry；现有运行时已抛出但 §6 尚未列出的 `IDENTITY_POLICY_SNAPSHOT_NOT_FOUND` 与 `IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH` 也应在该次收敛，本项不改变其现有语义。
- **实现（#186）**：两个入口都先执行注册契约（Envelope 结构 + 共享 PayloadGuard，§5.3 第 1 步）与请求绑定（envelope `scopeRef`/`targetRef` 与 `payload.policyRef.scope` 逐字段一致、`integrity.payloadHash` 等于 canonical payload Hash、`authorizationDecisionRef` 与事务 Context 固定的 Decision id+hash 一致、actor/requester 解析到受信 Context 的 principal 或 ActorSnapshot），再在 owning 事务内重新校验该 AuthorizationDecision（精确 id+hash、ALLOW、command type/version、Purpose、Scope、request payload hash、principal/actor 绑定与未过期）并复查覆盖该精确 Scope 的当前 ACTIVE grant：登记权限不自动授予解析权限，覆盖 grant 被撤销后既有 ALLOW 立即失效。
- **重放边界（#186）**：授权与 Scope 重验发生在幂等 Claim/读取之前（§5.3 第 3 步早于第 4 步），因此历史成功 Receipt 不会绕过当前授权：覆盖 grant 已撤销、或重放时固定一个 Purpose/Intent 不匹配 Decision，均稳定拒绝并写脱敏 Audit，且不为该次被拒请求 Claim 新的 Receipt；有效授权重放仍返回原 `DUPLICATE` 结果与原 Ref/Hash。
- **引用绑定边界（#186）**：`scopeRef`/`targetRef`/`integrity` 属于请求结构，违反时在数据库访问前以 `SCOPE_MISMATCH` / `API_PAYLOAD_HASH_MISMATCH` 短路、不写业务 Audit；`authorizationDecisionRef` 与 actor/requester 属于授权完整性，违反时写脱敏 Audit 并按授权失败返回，不记录未验证的 Scope 或正文。
- **失败映射（#186）**：授权类失败分别映射共享 `AUTHORIZATION_DECISION_INVALID` / `AUTHORIZATION_EXPIRED` / `AUTHORIZATION_REVOKED`；写入请求 `policyRef.scope` 不在授权集合时统一 `IDENTITY_POLICY_VERSION_UNKNOWN`，且未验证 Project 不进入 Command Envelope 或 RLS 写入 Scope；解析失败写同事务脱敏 Audit（内部分类只进 Audit）；连接级存储不可用映射 `DEPENDENCY_UNAVAILABLE`，不返回空 Policy。

### 13.6 持久化边界（已实现：`V1005`，2026-09-13）

1. **新增 scoped 不可变事实表**（本模块 owning，实现名 `identity_policy.policy_version`，migration `V1005__identity_policy_policy_version.sql`）：`policy_version_fact_id`（PK，同时是 `SnapshotRef` 的 `objectId`/`snapshotId`）、`policy_object_id`、`policy_key_version_id`、`scope_kind`（`ENTERPRISE|PROJECT`）、`enterprise_id`、`project_id`、`policy_set_version`、`policy_schema_refs`、`effective_from`、`policy_document`（canonical payload 内）、`payload_hash`、`canonical_payload`、`supersedes_object_id`/`supersedes_version_id`（成对，可为 NULL）以及既有技术列（contract type/version、registry/canonicalization version、created_at/created_by/actor_snapshot_id/source_command_id、data_classification、retention_class）。
2. **约束**：`UNIQUE (policy_object_id, policy_key_version_id, enterprise_id, project_id) NULLS NOT DISTINCT` 保证版本键唯一绑定，**覆盖全部行**；后继唯一性只作用于**真实取代边**：部分唯一索引 `UNIQUE (supersedes_object_id, supersedes_version_id, enterprise_id, project_id) NULLS NOT DISTINCT WHERE supersedes_object_id IS NOT NULL AND supersedes_version_id IS NOT NULL`。`supersedesRef` 是可选的，无前驱的初始版本两列均为 NULL；若把后继唯一约束无条件施加于全部行，同一 Scope 下不同 Policy 的首版会全部折叠为同一个键 `(NULL, NULL, E, [P])` 而互相冲突，因此必须使用该部分索引（且两条唯一对象都必须 `NULLS NOT DISTINCT`，否则 Enterprise 行 `project_id IS NULL` 会使比较失效）。`supersedes` 两列另以 `CHECK` 约束同时为空或同时非空，使部分谓词良定义；`CHECK` 固定 Scope shape（Enterprise 行 `project_id IS NULL`、Project 行 `project_id NOT NULL` 且 `enterprise_id` 非空）；`CHECK (octet_length(payload_hash) = 32)`；`REVOKE UPDATE, DELETE` + trigger 镜像校验（`effective_from`、`policy_set_version`、`policy_schema_refs`、Scope 镜像与 canonical payload 逐项一致）。非法 shape、镜像不一致、重复版本键与重复后继都在写入前拒绝并转换为稳定模块错误，不穿透 `23505`。实现补充：mirror guard 同时覆盖 INSERT 与 UPDATE，所有者或 superuser 直接 SQL 改写 promoted 列返回 `22023`；Handler 以 savepoint 隔离并映射 `policy_version_binding_unique` / `policy_version_supersede_unique` / PK 冲突为 `IDENTITY_POLICY_VERSION_ALREADY_BOUND` / `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED` / `IDENTITY_POLICY_SNAPSHOT_INVALID`。
3. **RLS 分支**：新表启用 FORCE RLS，SELECT/INSERT 使用与既有 scoped 表相同的分支——`(scope_kind='ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id)) OR (scope_kind='PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))`；**不采用 Platform 表的 `context_is_valid()`-only 分支**。授权仍以 Purpose + Scope 的 Query 判定为主，RLS 只作纵深防御。
4. **访问路径**：`(policy_object_id, policy_key_version_id, enterprise_id, project_id)` → 唯一已提交版本事实；`supersedes` 边唯一索引 → 前驱（派生 `supersededAt`）。首版**不提供"列出全部版本/当前版本"的访问路径**，避免引入 latest 语义；需要正文时由 `resolve_policy` 在同一次授权读取中返回。
5. **旧 Platform `policy_snapshot` 完全不变**：表、`policy_snapshot_select`/`policy_snapshot_insert`、`REVOKE UPDATE`、`policy_snapshot_set_unique` 与 `get_policy_snapshot@1.0` 的读回语义均不改写；新表不与旧表建立 FK/join，也不把 scoped 行写入旧表。
6. 新增迁移为 forward-only 的 `V1005`，未修改已应用的 V1000–V1004；空库迁移、二次 migrate no-op、角色 ACL/RLS、镜像与 Hash、immutable/direct SQL（含 superuser 改写与读取完整性边界）、并发版本键与并发后继竞争均已在真实 PostgreSQL 18.6 / Flyway 11.20.3 上取得证据（§13.7）。两个入口的 Handler、精确 Purpose 授权、Scope 隔离与真实读回已由 #186 交付；外部 Provider、跨模块业务链与人工验收保持 `NOT RUN`。

### 13.7 #186 实现事实（2026-09-13）

状态：`HANDLER, AUTHORIZATION AND SCOPED PERSISTENCE IMPLEMENTED / REAL POSTGRESQL 18.6 GATE PASS / DOWNSTREAM CONSUMERS NOT RUN`。

1. **存储**：`migrations/identity_policy/V1005__identity_policy_policy_version.sql` 建立 scoped 不可变事实表 `identity_policy.policy_version`（§13.6 的形状、约束、镜像 trigger、`REVOKE UPDATE, DELETE`、FORCE RLS 双分支）；Kysely 表类型与 Repository 读写原语（`insertPolicyVersion`、`getPolicyVersionByKey`、`getPolicyVersionSuccessor`、`policyVersionIntegrityHolds`）都在本模块内。
2. **Handler 与入口契约**：`modules/identity-policy/src/commands/policy-version.ts` 的两个入口都接收**完整注册 Envelope**（`{ envelope }`），用 `ContractRegistry.validateOperation` 执行 Envelope 结构 + 共享 PayloadGuard（超限以 `API_PAYLOAD_LIMIT_EXCEEDED` 在任何授权、幂等或写入前短路），并校验请求结构（`scopeRef`/`targetRef` 与 `payload.policyRef.scope` 的 `SCOPE_MISMATCH`、`integrity.payloadHash` 的 `API_PAYLOAD_HASH_MISMATCH`），再在 owning 事务内校验**完整授权引用**：Decision 引用必须为允许的 object type（`identity.authorization_decision` 或其 `zhiju.` 前缀形式）、精确 id+hash 与请求 Scope；actor/requester 必须是受信 principal 的 ObjectRef（允许的 principal object type）或 ActorSnapshot 的 SnapshotRef（允许的 object type、`objectId == snapshotId == Context.actorSnapshotId`、请求 Scope，且 `contentHash` 等于该快照已提交的 `payload_hash`，经 Repository 精确读回）。引用绑定失败写受信 Context Scope 的脱敏 Audit（`safe_summary=reference-binding`）并按授权失败返回（写入路径不 Claim Receipt）。写入在幂等 Claim 前完成 Scope、引用与当前授权/grant 重验，结果 `{policyVersionRef}` 在提交前用 `validateOperationResult` 校验（失败抛 `INTERNAL_CONTRACT_VIOLATION` 并回滚事实、取代边与成功 Receipt）；注册契约实现是接线级依赖（`deps.contracts`，缺省用共享构建期 Registry），受控回归用它强制结果校验失败以证明该回滚边界。解析入口在同一事务内校验 `PolicyVersionResolutionView`（结果超限或不符合注册 schema 以失败路径返回并写 Audit），`asOf` 是解析观察与 Decision 时效共用的受信时间，`checkedAt` 取该时间；`useStatus` 边界为 inclusive（`now >= supersededAt` 即 `SUPERSEDED`）。
3. **SD-181-1 写入边界**：注册 schema 以 `policyInstant`（`≤ 24` code point）执行至多毫秒精度的 canonical UTC 时刻要求，更长或亚毫秒 `effectiveFrom` 在写入前以 `API_VALUE_INVALID` 拒绝，不截断；共享 `UtcInstant` 定义不变，Handler 另有同规则的防御性读取。
4. **Event 边界**：本项**不新增 Event 契约**（Catalog 保持 211），因此 `record_policy_version` 不产生 Outbox 行；版本事实与既有 `command_receipt`/`audit_record` 在同一 owning 事务提交，失败回滚不留下部分事实。
5. **证据**：真实 PostgreSQL 18.6 / Flyway 11.20.3 的 persistence gate（14 个本项用例）覆盖 §13.4 不变量、§13.5 授权与失败矩阵（含重放重验与完整授权引用绑定）、§13.6 持久化边界、并发裁决、入口契约（超限/结构/NonEmptySet 唯一性/完整性 Hash）、写入结果校验失败的回滚边界、结果契约与**两种 Scope 的完整 262144 字节 Envelope 写入与逐字段读回**、以及边界加一的拒绝对照（Module-Test 001 `IP-176-D-002`–`D-004`、`D-006`、`D-008`–`D-011`、`IP-181-C-007`、`IP-181-E-001`）；下游消费位置、EP/TE 业务链、外部 Provider 与人工验收仍 `NOT RUN`。

## 14. TaskExecution 创建授权（#190 APPROVED）

状态：`APPROVED 2026-09-14 / EXACT MAPPING AND PURE RESOLUTION IMPLEMENTED 2026-09-14（#196）/ CREATION AUTHORIZATION PORT AND TARGET MIGRATION IMPLEMENTED 2026-09-15（#200）/ TASKEXECUTION HANDLER NOT RUN`。批准依据见[决定 §13.3](../decisions/task-execution-human-operated.md#133-决定与交付边界)。本节固定四个创建版本的授权接线边界，不更改当前 Decision Port 的实现行为，也不扩大现行 Role/Capability。逐版本唯一 Purpose 由 [Spec 003 §15.1](Module-Spec-003-TaskExecution.md#151-推荐的逐版本-canonical-映射)拥有。

已实现的静态分量（#196，仅解析）：`contracts` 从两份现有 Registry 投影并发布四行精确映射（`contracts/src/task-execution-creation-purpose.ts`，生成副本与漂移检查见 [Spec 003 §15.1](Module-Spec-003-TaskExecution.md#151-推荐的逐版本-canonical-映射)），IdentityPolicy 模块公开导出 `resolveTaskExecutionCreationPurpose(commandType, commandVersion)`：只接受精确键，未知 operation/版本、缺失或非精确版本、`*`、别名、大小写变体与前缀一律返回 `UNSUPPORTED_OPERATION`/`UNSUPPORTED_VERSION`，无最新版本或默认 `@1.0` 回退，结果保留精确 type/version 且不按 Purpose 合并 WorkOrder 两个版本。该入口是纯函数：不读数据库、不读源码目录 JSON、不跨模块访问 Repository，输出不是 ALLOW、CapabilityGrant、AuthorizationDecision 或当前资格。本节其余接线（版本化 Capability/Policy 对应、Decision 签发、当前 grant 重验、按精确 Intent 的组合校验与 TE 入口）仍未实现；`authorizeCommand` 继续硬性拒绝非 `1.0` commandVersion，本节的运行验收（IP-P190-001–006）仍为 `NOT RUN`。

已批准映射键为精确 `(commandType, commandVersion, purpose)`；四行分别注册，不能把 Purpose 当 operation/version 的替代键。每行绑定既有、明确授权的创建 Capability 与允许动作/资源范围，不能由 Purpose 字符串自动产生 grant，不能接受 `*`、前缀匹配、名称别名或“所有 execution 操作”。`requestedCapability` 必须是该行明确允许且当前覆盖本请求的能力，不能使用同 Scope 的任意其他 grant。Coordinator 不是新 capabilityCode；本设计不发明或批量重命名既有 capabilityCode，不迁移授权数据。实际接线须显式配置受支持的版本化 Policy/Capability 对应；映射缺失或条件无法解释则 DENY，不把未实现条件当满足。

旧合法 Capability 不因本设计被吊销：在其原先明确覆盖的 operation/version、动作、资源和 Scope 内仍可申请自己的新 Decision；这不保证历史 ALLOW 永久有效。Task v1 grant 不自动覆盖 v2，必须有对 v2 的明确授权事实；WorkOrder 两版本虽同 Purpose，只有既有能力/Policy 明确覆盖两个版本时，才可分别生成两个版本的 Decision。不通过重写旧 Grant/PolicySnapshot/Decision 或添加别名迁移权限。

接线必须组合以下独立检查：精确 ActorSnapshot/Decision id + hash、实际 Principal 与认证绑定、type/version/Purpose/payloadHash、target 与资源约束、精确 Scope、ALLOW、受信当前时间及当前有效 grant/Policy。现有通用 `authorizeCommand` 主要检查 capabilityCode 与精确 Scope；通用 `validateAuthorizationDecision` 检查绑定和期限，不能据此宣称已经检查所有版本化动作/资源条件、目标绑定或当前 grant 撤销。当前 `authorizeCommand` 还硬性拒绝非 `1.0` commandVersion，Task v2/WorkOrder v1.1 无真实签发路径；已批准 Delta 要求按四条精确映射扩展支持，而非去掉版本检查后接受任意版本。后续实现须在 IdentityPolicy owning 授权组成层补齐缺失检查，并为 TaskExecution 暴露受约束 Port；不由 TaskExecution 读他方表或自行解释 Role/Capability。

Human/Coordinator Agent/Process Manager 的适用边界见 Spec 003 §15.2；非 HUMAN 永远不能获得 Human-only capability，`actingFor`、Human 的 requestedBy、转交 Human Decision 均不改变该限制。当前 grant 撤销或到期后，即使旧 Decision 尚未过期，也拒绝新创建及通过 Command 重取成功 Receipt；历史事实不改写。使用同版本的新合法授权重试同一业务输入时，仍遵守既有幂等 Hash 规则，不通过换 Decision 改写原 Receipt。撤销、错误映射或依赖失败的拒绝须保留安全 Audit，失败不得生成成功业务事实/Outbox。矩阵见 [Module Test 001](../module-tests/Module-Test-001-IdentityPolicy.md#taskexecution-创建授权190-approved)。

## 15. IM06-AUTH-01 Task/WorkOrder 创建授权组成提案

状态：`APPROVED 2026-09-15 / PORT AND MIGRATION IMPLEMENTED 2026-09-15（#200）/ TASKEXECUTION DRAFT HANDLER CONSUMPTION NOT RUN`。本节不改 P-190-1 已批准的四个 Purpose，而是收敛 §14 所说“显式配置版本化 Policy/Capability 对应、目标绑定与当前资格重验”的实现前语义。用户于 2026-09-15 明确批准本 Delta；决策理由、备选与 readiness 见[IM-06 设计提案 §14](../decisions/task-execution-human-operated.md#14-im06-auth-01-taskworkorder-创建授权组成补充提案)。

### 15.1 Owning Port 与精确映射

IdentityPolicy 提供内部 `TaskExecutionCreationAuthorizationPort`：一个能力从受信组成配置、ActorSnapshot、精确 targetRef 和请求事实签发 Decision；另一个能力在 owning Handler 提交或返回幂等结果前重验 Decision 与当前 Grant/Policy。本 Port 不是公开 operation，不改变 `identity.authorize_command@1.0` 的 Schema 或历史行为，不允许 TaskExecution 读 IdentityPolicy Repository。

| operation/version | Purpose | required Grant action | exact target objectType | trusted capability config key |
|---|---|---|---|---|
| `execution.create_task@1.0` | `task.execution.create_task` | `execution.task.create.v1` | `execution.task` | `taskV1` |
| `execution.create_task@2.0` | `execution.task.create` | `execution.task.create.v2` | `zhiju.execution.task` | `taskV2` |
| `execution.create_work_order@1.0` | `task.execution.create_work_order` | `execution.work_order.create.v1` | `execution.work_order` | `workOrderV1` |
| `execution.create_work_order@1.1` | `task.execution.create_work_order` | `execution.work_order.create.v1_1` | `zhiju.execution.work_order` | `workOrderV11` |

Purpose 必须来自已交付的精确解析器，不接受 caller 覆盖。capabilityCode 来自受信组成配置的当前版本键，不来自 Envelope；本提案不创建新 capabilityCode。action 是 Grant 中的 `NamespaceCode`，使用上表无 `@` 的精确 token；相同 capabilityCode 覆盖多版时仍须分别列出每个 action。

### 15.2 Grant/Policy 覆盖规则

一个 covering Grant 必须同时满足：

1. principal 为当前受信 Actor 的真实 principal；capabilityCode 与当前版本的受信配置全等；Scope 为当前精确 Project，Enterprise Grant 不覆盖 Project Intent。
2. 状态为 ACTIVE，受信当前时间位于 `[validFrom, validTo)`；`actions` 含 §15.1 的精确 token。
3. `resourceSelectors` 的每项均是闭集 `{selectorType: "CREATE_TARGET_TYPE", objectType: NamespaceCode}`，且至少一项 objectType 与当前版本 targetRef 全等。未知字段、通配符、大小写变体、前缀或别名不匹配。
4. `constraints` 严格为空对象，`maxUses` 缺省。首版不默认忽略未实现的约束或计数语义。
5. Grant 的 `grant_policy_snapshot_id/hash` 与 Decision 精确 Policy Snapshot 一致；Snapshot 的 Hash/镜像完整，且 `effectiveFrom <= now < supersededAt`（无 `supersededAt` 时只要已生效）。

多个 Grant 中任一个完整覆盖即可；不得把不同 Grant 的 capability/action/selector/policy 分段拼成一个覆盖结论。非 HUMAN 仍受 Human-only Registry 约束；`actingFor`、`requestedBy` 或转交 Human Decision 不改变 PrincipalKind。

### 15.3 Decision 与重验边界

该 Port 签发的 AuthorizationDecision canonical payload 必须包含精确 targetRef（objectType/objectId/Project Scope）。物理表通过 forward-only 迁移增加可空 `target_object_type` / `target_object_id` 镜像；新 Port 产生的行必须非空且与 canonical payload/Scope 一致。历史行保留 NULL 并可读，但无目标绑定的 Decision 不能用于本 Port 的四个创建版本。

签发与重验均比较精确 Actor/实际 Principal、认证上下文、type/version/Purpose、payload Hash、targetRef、Project Scope、ALLOW 和期限。Actor 必须是当前受信事务 context 的 ActorSnapshot 与 principal：同 Project 的其他 Human、Agent 或 actingFor 快照都不能替代该绑定，也不能在另一主体的 context 中重验他人 Decision。读取端必须从 canonical payload 重算 Decision 与 Grant Policy Snapshot 的 hash/algorithm/canonicalization version/size 并校验提升列镜像：Decision 侧至少覆盖 Decision id、reason codes、意图/Scope 列，以及 `targetRef` 的 `kind: OBJECT` 与 objectType/objectId/Scope 闭集；只比较存储 hash 列、promoted target 列或 Grant 的 policy hash 引用不构成完整性证明（#200 审查 R2/R3/R4 修复）。重验另在当次受信时间重读完整 covering Grant/Policy；撤销、到期、Policy 取代、配置变更、target 改变、版本串用或依赖不可用都 fail closed。TaskExecution 必须在幂等 Claim/历史 Receipt 读取前重验；历史 ALLOW/Receipt 不是当前资格。

### 15.4 范围与兼容

本提案不新增公开 Command/Query/Event，不改公开 `authorize_command@1.0` 的 CommandIntent `commandVersion=1.0` 接受集，不改四个创建 operation 的 Envelope/Schema/Purpose，不改历史 Decision 内容或 Hash，不新建/迁移 Capability Grant 或业务 Policy。首个实现切片只属 IdentityPolicy 与必要的组成层；Task/WorkOrder 业务 Handler 和表在其交付后另做 readiness 复核。

### 15.5 IM06-READY-01 Task Readiness 生产与 READY 转换授权组成提案（#206）

状态：`T2 / DESIGN MERGED 2026-09-16（PR #207）/ INDEPENDENT DESIGN REVIEW APPROVE 2026-09-16（reviewed revision 2155d4dd89437694632c0e35ca65b7d6d46d720f）/ IMPLEMENTED 2026-09-16 BY Issue #208（Port、两条授权条目、组成层接线与真实 PostgreSQL 回归）/ MERGED 2026-09-16（PR #209，merge commit `0dc1bcef9a9f1e21219a015ac0f8b5d6768fe250`）/ INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW RECORDED`。本节回应 [Issue #206](https://github.com/qzhike/zhiju-business-core/issues/206) 对 Readiness **生产者**与 `execution.mark_task_ready@1.0` **消费者**“独立当前授权”的要求，为 [Spec 003 §17.4/§17.5](Module-Spec-003-TaskExecution.md#174-readiness-生产操作的-contractregistry-delta)（生产者）与 [Spec 003 §17.8](Module-Spec-003-TaskExecution.md#178-executionmark_task_ready10-消费边界)（消费者）提供 owning 授权边界。依据见[设计提案 §16.2/§16.4/§16.6](../decisions/task-execution-human-operated.md#162-p-206-2-task-寻址规则)。本节不改 §15.1–§15.4 的四个创建版本、不改公开操作与 Catalog、不新建 capabilityCode 之外的业务 Policy。

**为什么需要新的 Port 条目**：`identity.authorize_command@1.0` 产生的历史 Decision 没有 `target_object_type`/`target_object_id` 镜像（V1006 只允许新 Port 写入非空 target 列，且裸 payload 带 `targetRef` 的行会被 mirror guard 拒绝）。因此调用者持有的通用 Decision 无法表达“对这一个将被创建的 readiness 判断执行 build”或“对这一个 Task 执行 READY”的目标绑定；无目标绑定的 Decision 不能用于本节任何一个动作（同 §15.3 对四个创建版本的结论）。

**Owning Port 与两条精确映射**：IdentityPolicy 在既有内部 Port 家族中新增 `TaskExecutionReadinessAuthorizationPort`，提供与 §15.1 同形的签发与重验两个能力；其闭集键是精确 `(type, version)`，两个入口各占一行、互不替代：

| operation/version | 角色 / 模式 | Purpose | required Grant action | target kind / objectType | Grant selector 类型 | trusted capability config key |
|---|---|---|---|---|---|---|
| `execution.build_task_readiness@1.0` | 生产者 / CREATE | `execution.task.readiness.build` | `execution.task.readiness.build` | `OBJECT` / `zhiju.execution.task_readiness`（单值，由该操作的注册 Schema 与 `targetObjectType` 固定） | `CREATE_TARGET_TYPE` | `taskReadinessBuildV1` |
| `execution.mark_task_ready@1.0` | 消费者 / MUTATE | `task.execution.mark_task_ready` | `execution.task.mark_ready` | `OBJECT` / `execution.task`、`zhiju.execution.task`（闭集） | `TARGET_TYPE` | `taskReadyV1` |

1. **签发与重验**：与 §15.3 同形——签发时绑定精确 `targetRef`（objectType/objectId/Project Scope），重验时比较精确 Decision id/hash、Actor/实际 principal、认证上下文、type/version/Purpose、payload Hash、`targetRef`、Project Scope、ALLOW 与期限，并以当次受信时间重读完整 covering Grant/Policy；撤销、到期、Policy 取代、配置漂移、target 或版本替换、依赖不可用一律 fail closed。TaskExecution 必须在幂等 Claim 与历史 Receipt 读取**之前**重验（生产者见 Spec 003 §17.5 第 1 步，消费者见 §17.8 第 1 步）；历史 ALLOW/Receipt 不是当前资格。拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision（[决定 §14.5](../decisions/task-execution-human-operated.md#145-200-实现事实2026-09-15) 同一决定）。
2. **两个入口互相独立**：Purpose、Grant action、Grant selector 类型、capability config key 与 Decision 各自独立；生产者持有的 Decision 及其提交的 readiness 判断**不**授权 READY 转换，消费者的 Decision 也**不**授权 build；不存在共同 entry、继承、Purpose 近似匹配、别名或“同一动作的两种叫法”。两者的 target objectType 集合不重叠：生产者的是被创建的 readiness identity（`targetRef.objectId` = 本次判断 id），消费者的是既有 Task 的两个已发布拼写。组成层为每个操作使用其自己的 entry，不得把一个入口的 Decision、Grant 或受信配置结果用于另一个入口。
3. **Grant selector**：生产者是 CREATE，`resourceSelectors` 使用 `{selectorType: "CREATE_TARGET_TYPE", objectType}`，至少一项必须与该操作固定的 CREATE target objectType 全等（沿用 §15.2 第 3 条）；消费者是 MUTATE，使用 `{selectorType: "TARGET_TYPE", objectType}`（新增 selector 类型），至少一项必须与请求声明的 target objectType 全等。用错 selector 类型、通配符、大小写变体、前缀或别名一律不匹配。其余覆盖规则（ACTIVE、`[validFrom, validTo)`、actions 含精确 token、constraints 为空、Grant Policy Snapshot 与 Decision 一致且当前有效、多 Grant 不得分段拼接）沿用 §15.2。
4. **消费者两个可接受拼写不是别名**：`execution.task` 与 `zhiju.execution.task` 是两个已发布创建路径各自的唯一身份（Spec 003 §16.1）。本 Port 的消费者行只声明“该动作可以作用于这两个已发布 Task 身份”，不决定哪一个对某个 Task 正确：请求声明的 objectType 必须与 covering Grant 的 `TARGET_TYPE` selector 逐字符相等，且必须由 owning TaskExecution Handler 按 Task 的不可变创建事实判定为唯一正确拼写（Spec 003 §17.3 的 R-206-1）。因此调用者无法通过声明另一拼写取得业务成功，也无法用另一 target 的 Grant 提权。这与 §15.2 对创建路径“期望拼写由 Port 内部按 `(type@version)` 取值”的区别在于：CREATE 的目标身份由操作版本自身决定，MUTATE 的目标是既有对象，其身份由该对象自己的创建事实决定，IdentityPolicy 依边界不读 TaskExecution 事实。
5. **范围与兼容**：不新增公开 Command/Query/Event，不改 `authorize_command@1.0` 的接受集，不改 `execution.build_task_readiness@1.0` 与 `mark_task_ready@1.0` 的注册 Envelope/Schema/Purpose/metadata，不改历史 Decision 内容或 Hash，不新建业务 Policy。物理表沿用 V1006 已增加的 target 列（生产者的 target 是被创建的 readiness identity，消费者的是既有 Task），**不需要**新的 IdentityPolicy 迁移；两个 entry 的 capabilityCode/action 由受信组成配置持有，不从 Envelope 读取。

### 15.6 IM06-WODRAFT-01 WorkOrder DRAFT 读取授权组成提案（#210）

状态：`T2 / DESIGN APPROVED 2026-09-17（Issue #210）/ IMPLEMENTED 2026-09-18 BY Issue #212（Port、两条读取授权条目 / 分类边界；组成层接线与真实 PostgreSQL 回归）/ MERGED 2026-09-18（PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213)，merge commit `f0dccc9601316752dca15b393ef24f31199929f8`，Issue #212 已关闭 `COMPLETED`）/ INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW RECORDED ON `4deffa472bfb5f96f85224d3ec930b43a0e61ba8``。本节回应 [Issue #210](https://github.com/qzhike/zhiju-business-core/issues/210) 的“权威 draft-read”要求：`execution.get_work_order_draft@1.0`/`@1.1` 已注册并携带 Purpose `execution.work_order.draft.read`，但 §15.4 的既有内部 Port 只覆盖 Task/WorkOrder **创建**，而 `identity.authorize_command@1.0` 的签发路径硬性拒绝非 `1.0` 的 `commandVersion`（`modules/identity-policy/src/commands/actor-snapshot.ts` 的 `command intent version must be 1.0`）。因此 @1.1 与 [Spec 003 §18.8](Module-Spec-003-TaskExecution.md#188-精确-draft-读取与授权组成) 新增设计的 `@2.0` 读取当前**不存在可路由、可签发、可重验的授权路径**。本节只固定补齐该路径的最小 Delta；字段级读取语义与接受集归 [Spec 003 §18](../module-specs/Module-Spec-003-TaskExecution.md#18-workorder-draft-创建与精确-draft-读取边界210-设计)。本节不注册任何条目、不新增 capability code、不改 `authorize_command@1.0` 的接受集、不新增迁移。

| operation/version | Purpose | Grant action | selector 类型与 target 闭集 | 受信 capability config key |
|---|---|---|---|---|
| `execution.get_work_order_draft@1.1` | `execution.work_order.draft.read` | `execution.work_order.draft.read.v1_1` | `TARGET_TYPE` / {`zhiju.execution.work_order`} | `workOrderDraftReadV11` |
| `execution.get_work_order_draft@2.0`（Spec 003 §18.8 新增设计） | `execution.work_order.draft.read` | `execution.work_order.draft.read.v2` | `TARGET_TYPE` / {`execution.work_order`} | `workOrderDraftReadV2` |

1. **Port 形态复用**：与 §15.3/§15.5 同形——“签发精确 Decision”与“读取前重验当前资格”两个能力，由 TaskExecution 组成层在返回任何读取事实或历史结果**之前**调用。它不是公开 Command/Query、不进 Catalog；TaskExecution 不直读本模块 Repository。
2. **两条条目互相独立**：Purpose 共用 `execution.work_order.draft.read`，但 Grant action、selector target 闭集与 capability config key 各自独立；**同 Purpose 不表示 Decision 可以跨版本使用**（沿用 §15.1 对两个 `create_work_order` 版本的处理）。用某一版本的 Decision、Grant 或受信配置结果去满足另一版本一律 fail closed。
3. **target 闭集就是业务唯一拼写**：每版本的闭集只有一个值（[Spec 003 §18.2](Module-Spec-003-TaskExecution.md#182-r-210-1-workorder-寻址与读取版本绑定) 的版本-拼写绑定），请求声明的 target objectType 必须与 covering Grant 的 `TARGET_TYPE` selector 逐字符相等；因此这里不存在“先接受两种拼写、再由 Handler 决定”的分层，另一拼写在授权层即不能取得 Decision。
4. **重验内容**：比较精确 Decision id 与 hash、Actor/实际 principal、认证上下文、type/version/Purpose、payload Hash、精确 target 与 Project Scope、ALLOW 与未过期，并以当次受信时间重读完整 covering Grant/Policy；撤销、到期、Policy 取代、配置漂移、target 或版本替换、依赖不可用一律 fail closed；读取不得凭缓存或历史结果跳过该步。拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision。
5. **范围与兼容**：不新增公开 Command/Query/Event，不改任何既有注册 Schema/Purpose/metadata，不改 `authorize_command@1.0` 的接受集，不创建 capability code，不新增 IdentityPolicy 迁移（复用 V1006 的既有 target 列）。`execution.get_work_order_draft@1.0` 保留既有通用路径，其接受集与 Handler 状态见 Spec 003 §18.2。
6. **同类缺口**：`execution.build_initial_context_snapshot@1.1` 读取/构建所需的非 `1.0` 授权路径由 TD-01 的 Context 切片拥有，本节不顺带关闭（#214 的闭合提案见 [§15.8](#158-im06-ctxbuild-01-首次-context-构建与权威快照读取授权组成提案214)，待独立审查与人类设计批准）；`execution.create_work_order@1.0`/`@1.1` 的创建授权已由 §14 交付，本节不重复。

**实现事实（#212，2026-09-18）**：`modules/identity-policy/src/commands/work-order-draft-read-authorization.ts` 交付 `createWorkOrderDraftReadAuthorizationPort`、闭集键表 `WORK_ORDER_DRAFT_READ_BINDINGS` 与读取前重验 `revalidateWorkOrderDraftRead`。两条条目即上表：`execution.get_work_order_draft@1.1`（Purpose `execution.work_order.draft.read`、action `execution.work_order.draft.read.v1_1`、`TARGET_TYPE` 闭集 `{zhiju.execution.work_order}`、config key `workOrderDraftReadV11`）与 `execution.get_work_order_draft@2.0`（同 Purpose、action `execution.work_order.draft.read.v2`、`TARGET_TYPE` 闭集 `{execution.work_order}`、config key `workOrderDraftReadV2`），互不替代；`@1.0` 仍走既有通用路径。本切片**没有**新增公开 Command/Query、capability code、Catalog 条目、registry/metadata 变更或 IdentityPolicy 迁移；组成层接线与真实 PostgreSQL 回归见 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md#workorder-draft-创建与精确-draft-读取210-设计)。

### 15.7 IM06-WODRAFT-02 WorkOrder DRAFT 声明能力的 Human-only 分类边界（#210）

状态：`T2 / DESIGN APPROVED 2026-09-17（Issue #210）/ IMPLEMENTED 2026-09-18 BY Issue #212（Port、两条读取授权条目 / 分类边界；组成层接线与真实 PostgreSQL 回归）/ MERGED 2026-09-18（PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213)，merge commit `f0dccc9601316752dca15b393ef24f31199929f8`，Issue #212 已关闭 `COMPLETED`）/ INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW RECORDED ON `4deffa472bfb5f96f85224d3ec930b43a0e61ba8``。本节补齐 [Spec 003 §18.5](Module-Spec-003-TaskExecution.md#185-actorrequester-与-human-only-归属) 的 Human-only 归属：TaskExecution 必须判定 `WorkOrderDraft.allowedCapabilities[]`/`deniedCapabilities[]` 声明的 capability code 是否属于 Human-only 集合，但**不能**读取 IdentityPolicy 的模块内部集合，也不能用 `identity.check_human_only_capability@1.0` 代替分类。

**为什么不用既有公开 Query 代替。** `identity.check_human_only_capability@1.0` 的 Handler（`checkHumanOnlyCapability` → `evaluateAccess`）最终调用 `authorizeCommand(requestedCapability = capabilityCode)`：它回答的是“该 principal 在该 Scope 是否**持有**该 capability 的覆盖 Grant”，对非 HUMAN principal 再叠加 `CAPABILITY_HUMAN_ONLY` 原因（`modules/identity-policy/src/commands/actor-snapshot.ts`）。DRAFT 声明的 capability code 是将来 Run 的执行集合，起草者通常并不持有对应 Grant，因此该 Query 的 DENY 无法区分“未持有 Grant”与“Human-only”，把它当分类器会错误拒绝合法草案。

**决定（方案 A）**：新增 IdentityPolicy owning 内部只读 Port `TaskExecutionCreationCapabilityBoundaryPort`，与 `TaskExecutionCreationProjectScopePort` 同构——不是公开 Command/Query、不进 Catalog、不改变任何公开接受集、不新增 capability code。

| 项 | 固定值 |
|---|---|
| 输入 | `(commandType, commandVersion, principalRef, declaredCapabilityTypes, scopeRef, actionAt)`（`commandType`/`commandVersion` 参与键表选择；`principalRef` 必须是认证 principal，不接受 payload 自报；`scopeRef` 必须是受信 Project Scope；`actionAt` 为受信当前时间） |
| 检查单元 | **恰好是**声明的 capability code：Core §4.7 `CapabilityGrant.capabilityType`。`actions[]`、`resourceSelectors[]`、`constraints[]`、`expiresAt`、`grantPolicyRef` **不参与** Human-only 分类，也不被本 Port 用作覆盖判定；`capabilityType` 逐项去重后按 canonical 字节序稳定处理 |
| 分类集合 | IdentityPolicy 自己的版本化静态集合 `HUMAN_ONLY_CAPABILITIES`（registry version `im02-static-v1`，`modules/identity-policy/src/commands/static-registry.ts`）；分类按**精确字符串**成员判断，大小写敏感、无规范化、无前缀/别名 |
| 外部结果 | `{outcome: 'VALID' / 'INVALID', classificationRegistryVersion: <string>}`：`outcome` 是闭集；`classificationRegistryVersion` 是本次判定**实际使用**的分类集合版本（当前为 `im02-static-v1`），由 owning 侧返回，使调用方可直接归因而无需硬编码或读取 owning 模块常量。`INVALID` 的内部分类（`CAPABILITY_HUMAN_ONLY` 等）与集合内容只写入 IdentityPolicy 受权限控制的 Audit，不随返回值泄露 |
| 语义 | principal 为 HUMAN 时返回 `VALID`（该 Port 不判断 Grant、不签发 Capability、不评估行动级别的可用性）；principal 非 HUMAN 且任一声明 `capabilityType` 属于 Human-only 集合时返回 `INVALID` |
| 授权与事务 | Port 是只读调用，在 IdentityPolicy 自己的 RLS 事务内执行；TaskExecution 不因此获得 IdentityPolicy 表权限；Port 不可用或超时不得被解释为空结果，调用方 fail closed 并映射共享 `DEPENDENCY_UNAVAILABLE` |
| 版本与兼容 | 不新增公开 Command/Query/Event、不改任何既有注册 Schema/Purpose/metadata、不改 `authorize_command@1.0`、不新增 IdentityPolicy 迁移；分类集合版本变化是 Policy/版本事件：IdentityPolicy 以自己的 Audit 记录返回值中的 `classificationRegistryVersion`，TaskExecution 原样记录**同一个**返回值（不进入不可变 DRAFT payload，因为已注册的 Snapshot 形状不含该字段），从而两侧归因都不需要硬编码或跨边界读取 owning 常量 |

TaskExecution 把 `INVALID` 收敛为公开共享码 `HUMAN_ONLY_CAPABILITY`（[共享 API §8](../api-contract-v0.1/API-Contract-v0.1.md) 的共享错误码列表；Domain §19.10 的 `WO-U-002` 同码），并把 Port 返回的 `{outcome, classificationRegistryVersion}` 原样记入自己的 Audit，使通过与拒绝都可归因到确切的分类集合版本；版本事实不进入不可变 DRAFT payload（已注册的 Snapshot 形状不含该字段），也不从 owning 模块常量读取。`IDENTITY_CAPABILITY_HUMAN_ONLY` 是 `identity.grant_capability` 的模块码，`CAPABILITY_HUMAN_ONLY` 是 IdentityPolicy 的 Decision/Audit reason——两者都不是本操作的公开错误码，也不得被复制成 TaskExecution 的模块码。

**实现事实（#212，2026-09-18）**：`modules/identity-policy/src/commands/task-execution-capability-boundary.ts` 交付 `createTaskExecutionCreationCapabilityBoundaryPort`；`classifyDeclaredCapabilities` 按上表输入只以精确 `capabilityType` 字符串对 `HUMAN_ONLY_CAPABILITIES`（registry version `im02-static-v1`）判成员，返回闭集 `{outcome: 'VALID' | 'INVALID', classificationRegistryVersion}`，TaskExecution 把该返回值原样记入自己的 Audit 并收敛公开码 `HUMAN_ONLY_CAPABILITY`。本切片**没有**新增公开 Command/Query、capability code、Catalog 条目、registry/metadata 变更或 IdentityPolicy 迁移；可执行验收（含分类边界不可用与版本归因）见 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md#workorder-draft-创建与精确-draft-读取210-设计)。

### 15.8 IM06-CTXBUILD-01 首次 Context 构建与权威快照读取授权组成提案（#214）

状态：`T2 / DESIGN APPROVED 2026-09-18（Issue #214；exact design revision `d0d060fbacb98a6e9fdac1d098792a6222de4cff` 经七轮独立审查并获显式人类设计批准，PR [#215](https://github.com/qzhike/zhiju-business-core/pull/215) 已合并；正式记录见 [reviews/pr-215/Review.md](../reviews/pr-215/Review.md)）/ IMPLEMENTED 2026-09-19 BY Issue #216（Port、两条授权条目、错误三联与 DENIED Audit；38 项单元测试、模块 178/178 通过；组成层接线完成）/ vibe verify full PASS 2026-09-19 / PR #217 CORRECTION IMPLEMENTED 2026-09-20 BY §15.9（新 verify full PASS 2026-09-20；新 head 独立复审与 HUMAN TECHNICAL REVIEW PENDING）`。本节保留 #214 的历史授权设计；PR #217 证明其中“构建期依赖读取独立授权”没有对 WorkOrder DRAFT snapshot 形成可执行的 exact-target Port，该阻断已由 §15.9 修正实现（2026-09-20）。字段级语义、版本绑定与可满足性判定见 [Spec 003 §19](../module-specs/Module-Spec-003-TaskExecution.md#19-首次-context-构建与精确快照读取边界闭合214-设计)；本节与 §15.9 共同构成当前 build 路径授权证据，PR #217 新 head 复审完成前不作为已审查事实。

| operation/version | Purpose | Grant action | selector 类型与 target 闭集 | 受信 capability config key |
|---|---|---|---|---|
| `execution.build_initial_context_snapshot@1.1` | `execution.context.build.initial`（已注册） | `execution.context.build.initial.v1_1` | `CREATE_TARGET_TYPE` / {`zhiju.execution.context_snapshot`} | `contextSnapshotBuildV11` |
| `execution.get_context_snapshot@1.0` | `task.execution.get_context_snapshot`（逐字符复用已发布 compatibility metadata 值，零改动） | `execution.context.snapshot.read` | `TARGET_TYPE` / {`zhiju.execution.context_snapshot`, `zhiju.project.context_snapshot`} | `contextSnapshotRead` |

1. **Port 形态复用**：与 §15.1/§15.3/§15.6 同形——“按 `(type@version)` 从受信组成配置 + ActorSnapshot + 精确 targetRef 签发 Decision”与“在幂等 Claim、历史 Receipt 返回或读取事实返回之前重验当前资格”两个能力，由 TaskExecution 组成层调用；不是公开 Command/Query、不进 Catalog；TaskExecution 不直读本模块 Repository。
2. **build @1.1 单一条目**：CREATE，target 闭集只有一个值（注册的 canonical objectType）；Decision 签发绑定精确 targetRef（objectType/objectId/Project Scope），复用 V1006 的 target 镜像列；重验先于幂等 Claim 与历史 Receipt 返回。`build_initial_context_snapshot@1.0` **不建路径**：按 Spec 003 §19.1 它无可满足 IM-06 输入，保持注册冻结、不实现；任何 @1.0 构建尝试因无可路由授权在授权层 fail closed。
3. **同 Purpose 不跨版本**：`execution.context.build.initial` 的 Grant action、selector、capability config key 与 Decision 按版本各自独立；@1.0 的 Decision（若历史存在）不得因 Purpose 与 target 类型相同而授权 @1.1，串用一律 fail closed（`AUTHORIZATION_DECISION_INVALID`）。
4. **Snapshot 读取单一条目**：两个 objectType 是同一次读取允许闭集中的现行身份与 Core v1.0 历史读回身份，**不是别名**：请求声明的 objectType 必须与 covering Grant 的 `TARGET_TYPE` selector 逐字符相等；canonical 与 legacy 各自的可读性由 owning Handler 按已提交事实裁决（Spec 003 §11.2.5.3），授权层不判定语义版本、不接受通配符/大小写变体/前缀。**Purpose 逐字符复用已发布值**：本条目的 Purpose 取自 `operation-compatibility-metadata.v1.json` 对 `execution.get_context_snapshot@1.0` 已发布的 `authorizationPurpose`（`task.execution.get_context_snapshot`），不新增、不改写 metadata，保持该 Query 的 `v1.0-baseline` 接受集零改动；携带任何其他 Purpose 字符串（包括 Grant action 同名字符串单独作为 Purpose 出现）的 Decision 无法与 operation/version/Purpose 闭合，一律 fail closed。Grant action `execution.context.snapshot.read` 只是本节新声明的内部配置 token，不进公开 Catalog、不写入任何已发布 metadata。
5. **依赖读取互相独立、不经构建能力隐含**：精确 WorkOrder DRAFT 读复用 §15.6 的 `workOrderDraftReadV11` 条目；每片 Source Slice 读经 EnterpriseProject owning 边界（`project.context_source.read`，每次现签 Decision）；PolicyVersion 精确解析经 `identity.policy.resolve_policy`（每次现签，沿用 `resolvePolicyView` 先例）。构建 Decision 不隐含上述任一能力；无 Service 通配授权、无 caller 提供 principal 替换、无转移 Decision。
6. **重验与拒绝**：比较精确 Decision id/hash、Actor/实际 principal、认证上下文、type/version/Purpose、payload Hash、target 与 Project Scope、ALLOW 与未过期，并以当次受信时间重读完整 covering Grant/Policy；撤销、到期、Policy 取代、配置漂移、target 或版本替换、依赖不可用一律 fail closed；读取不得凭缓存或历史结果跳过该步。拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision。
7. **范围与兼容**：不新增公开 Command/Query/Event，不改任何既有注册 Schema/Purpose/metadata，不改 `authorize_command@1.0` 的接受集，不创建 capability code，不新增 IdentityPolicy 迁移（复用 V1006 的既有 target 列）；两个 entry 的 capabilityCode/action 由受信组成配置持有，不从 Envelope 读取。

**实现事实（#216，2026-09-19）**：`modules/identity-policy/src/commands/context-snapshot-authorization.ts` 交付 `createTaskExecutionContextSnapshotAuthorizationPort` 与闭集键表 `TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS`。两条条目即上表：`execution.build_initial_context_snapshot@1.1`（Purpose `execution.context.build.initial`、action `execution.context.build.initial.v1_1`、`CREATE_TARGET_TYPE` 闭集 `{zhiju.execution.context_snapshot}`、config key `contextSnapshotBuildV11`，Decision 签发绑定精确 targetRef）与 `execution.get_context_snapshot@1.0`（Purpose 逐字符复用已发布值 `task.execution.get_context_snapshot`、内部 action `execution.context.snapshot.read`、`TARGET_TYPE` 闭集 `{zhiju.execution.context_snapshot, zhiju.project.context_snapshot}`、config key `contextSnapshotRead`），互不替代；`build_initial_context_snapshot@1.0` 不建路径，任何 @1.0 构建尝试因无可路由授权 fail closed。失败面为错误三联 `IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED`/`IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID`/`IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID`；拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision；重验先于幂等 Claim、历史 Receipt 返回与任何读取事实返回。本切片**没有**新增公开 Command/Query、capability code、Catalog 条目、registry/metadata 变更或 IdentityPolicy 迁移（复用 V1006 的既有 target 列）；单元测试 38 项、IdentityPolicy 模块 178/178 通过；组成层接线与真实 PostgreSQL 验收（含授权分离、非已发布 Purpose 与过期分层）见 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md) 的 `TE-214-D-*`；`vibe verify full --json` 已 PASS（2026-09-19，门禁细节见 Spec 003 §19.10），独立审查与人类技术批准待完成。

### 15.9 IM06-CTXBUILD-02 DRAFT Snapshot 依赖读取授权修正提案（#217）

状态：`T2 / DESIGN APPROVED 2026-09-19（PR #217 REVIEW = PLANNING_REQUIRED；显式人类设计批准 2026-09-19；独立设计复审于 PR #217 第 3 轮确认一致性）/ IMPLEMENTED 2026-09-20（Port、绑定表、Decision 完整 ref 绑定与组成层 fail-closed 顺序；IdentityPolicy 模块 216/216、组成层 23/23 通过）/ vibe verify full PASS 2026-09-20 / PR #217 新 head 独立复审与 HUMAN TECHNICAL REVIEW PENDING（不声称审查结论或合并）`。本节精确修正 §15.8 第 5 条“复用 `workOrderDraftReadV11`”的不可执行部分；公开 `execution.get_work_order_draft@1.1` 的现有条目、Schema、Purpose 与 target 闭集不变。

| consumer / dependency | Purpose | Grant action | selector 与 target 闭集 | 受信 capability config key |
|---|---|---|---|---|
| `execution.build_initial_context_snapshot@1.1` 的 DRAFT dependency read | `execution.work_order.draft.read` | `execution.work_order.draft_snapshot.read.for_context_build.v1_1` | `TARGET_TYPE` / {`zhiju.execution.work_order_draft_snapshot`} | `contextSnapshotDraftReadV11` |

1. **Port 输入**：实际 principal/ActorSnapshot/authentication context、consumer operation/version、完整 `draftSnapshotRef`、build request payload hash、Project Scope 与受信当前时间。target 是请求已声明的 ContentAddressedRef；组成层不得先查 TaskExecution 表来发现 WorkOrder id。
2. **Decision 绑定**：canonical Decision payload 保存完整 target ref（kind/objectType/objectId、`immutableVersionId` 的存在性与值、Scope、完整 contentHash）；V1006 promoted target 列继续镜像 objectType/objectId。签发与重验均比较完整 target、consumer/version、Purpose、payload hash、principal/session、ALLOW、期限以及当前 covering Grant/Policy，不能只比较 promoted id。
3. **顺序**：build Decision 当前重验 → DRAFT dependency Decision 签发并立即重验 → TaskExecution DRAFT fact read/lock → Slice/Policy 各自授权读取 → 幂等 Claim/历史 Receipt 处理与 owning transaction。任何缺失、撤销、过期、配置漂移、target/hash/Scope 替换或依赖不可用都必须在 DRAFT fact 读取前 fail closed，只写脱敏 `DENIED` Audit，不签发可用 Decision。
4. **能力隔离**：`contextSnapshotBuildV11` 不覆盖本条目；调用方过去持有的 `workOrderDraftReadV11` Decision 或曾成功取得 ref 不覆盖本次依赖读；本条目也不授权公开 `get_work_order_draft` Query、Slice、Policy 或 Snapshot read。
5. **范围**：不新增公开 operation、capability code 或 IdentityPolicy migration；新增受信 config key/action 与 owning internal Port。若部署未配置该 key，构建 fail closed `IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID`，不得回退到 build capability 或历史 Decision。
验收至少覆盖：独立 ALLOW；build ALLOW + DRAFT Grant 缺失；Grant 在签发后撤销；Decision 过期；配置漂移；ref objectId/hash/Scope 替换；合法 DRAFT Decision 不覆盖另一 snapshot；在全部拒绝分支中 TaskExecution DRAFT repository 调用计数为 0、Receipt/Snapshot/metadata/Edge/Outbox 为 0。

**实现事实（#217 修正，2026-09-20）**：`modules/identity-policy/src/commands/context-snapshot-draft-read-authorization.ts` 交付 `createContextSnapshotDraftReadAuthorizationPort` 与闭集绑定表 `CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS`（Purpose `execution.work_order.draft.read`、action `execution.work_order.draft_snapshot.read.for_context_build.v1_1`、`TARGET_TYPE` 闭集 `{zhiju.execution.work_order_draft_snapshot}`、config key `contextSnapshotDraftReadV11`）。**解释决定**：canonical Decision payload 把完整 `draftSnapshotRef` ContentAddressedRef 作为独立成员保存；V1006 promoted targetRef 列保持 OBJECT 镜像形状——应用层 `validateAuthorizationDecisionMirror` 要求 `kind==='OBJECT'`，故不把 ContentAddressedRef 写入 promoted 列。组成层顺序按本节第 3 条：build Decision 当前重验 → DRAFT dependency Decision 签发并立即重验 → Handler（DRAFT 读/锁、Slice/Policy 现签、幂等）；Handler 要求出示证明（`InitialContextDraftReadDecision`），缺失/替换/过期时在任何 repository 读取前 fail closed。公开 `execution.get_work_order_draft@1.1` 的条目、Schema、Purpose 与 target 闭集不变；无公开 operation、capability code 或 IdentityPolicy migration。IdentityPolicy 模块测试 216/216；组成层测试 23/23（含 deny 分支 DRAFT repository 调用数为 0）；真实 PostgreSQL 验收见 Module-Test 003 `TE-217-D-002`。`vibe verify full --json` 已 PASS（2026-09-20，门禁细节见 Spec 003 §20.6）；PR #217 新 head 独立复审与人类技术批准待完成。


### 15.10 IM06-WOVALIDATION 与 Freeze 授权组成提案

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-21（决定 §20.3）/ PR #218 ROUND 2 INDEPENDENT DESIGN REVIEW APPROVE 2026-09-21（reviewed 1acdf34） / PORT NOT IMPLEMENTED`。字段和业务顺序见 [Spec 003 §21](Module-Spec-003-TaskExecution.md#21-workorder-validation-与-freezeready-设计提案)。本节使用既有 ActorSnapshot、Decision、当前 covering Grant/Policy 与 V1006 target 镜像；不增加公开授权 API、Capability code 或 IdentityPolicy migration。

| 消费边界 | Purpose | 内部 Grant action / selector / target 闭集 | 受信 config key |
|---|---|---|---|
| `execution.validate_work_order_draft@1.0` 自身 CREATE | `execution.work_order.draft.validate`（随新 operation 注册） | `execution.work_order.validation.create.v1` / `CREATE_TARGET_TYPE` / {`zhiju.execution.work_order_validation`} | `workOrderValidationBuildV1` |
| `execution.freeze_work_order@1.0` 自身 MUTATE | `task.execution.freeze_work_order`（逐字符复用已发布 compatibility metadata） | `execution.work_order.freeze.v1` / `TARGET_TYPE` / {`zhiju.execution.work_order`} | `workOrderFreezeV1` |
| `execution.get_work_order_contract@1.0` 权威读取 | `task.execution.get_work_order_contract`（逐字符复用已发布 compatibility metadata） | `execution.work_order.contract.read.v1` / `TARGET_TYPE` / {`zhiju.execution.work_order`} | `workOrderContractReadV1` |
| Validation 的 DRAFT dependency read | `execution.work_order.draft.read` | `execution.work_order.draft_snapshot.read.for_validation.v1` / `TARGET_TYPE` / {`zhiju.execution.work_order_draft_snapshot`} | `workOrderValidationDraftReadV1` |
| Freeze 的 DRAFT dependency read | `execution.work_order.draft.read` | `execution.work_order.draft_snapshot.read.for_freeze.v1` / `TARGET_TYPE` / {`zhiju.execution.work_order_draft_snapshot`} | `workOrderFreezeDraftReadV1` |
| Validation 的 Context dependency read | `execution.context.snapshot.read` | `execution.context.snapshot.read.for_validation.v1` / `TARGET_TYPE` / {`zhiju.execution.context_snapshot`} | `workOrderValidationContextReadV1` |
| Freeze 的 Context dependency read | `execution.context.snapshot.read` | `execution.context.snapshot.read.for_freeze.v1` / `TARGET_TYPE` / {`zhiju.execution.context_snapshot`} | `workOrderFreezeContextReadV1` |

这七条是互不替代的内部映射。自身 Decision 绑定受信认证 principal、ActorSnapshot、operation/version、Purpose、payload hash、精确 target 身份与 Project Scope；Validator Service 和 Freeze Service 必须各持自己的覆盖 Grant。依赖 Decision 在 canonical payload 保存完整 `draftSnapshotRef` ContentAddressedRef 或 `contextSnapshotRef` SnapshotRef（含 kind、objectType、objectId、snapshotId/immutableVersionId 的存在性、Scope、hash 全字段），V1006 promoted target 列仍使用 OBJECT 镜像；因此不能只比较 promoted id，也不能把 SNAPSHOT/CONTENT_ADDRESSED ref 塞入要求 OBJECT 的 promoted 列。#217 build 专用 `contextSnapshotDraftReadV11`、公开 DRAFT/Context Query 的 Decision、历史 Receipt、相同 Purpose 或相同 principal 都不覆盖这些条目。

组成层顺序为：自身 Decision 当前重验 → 对请求已声明的 Draft/Context refs 分别签发并立即重验对应消费专用 dependency Decision → TaskExecution Draft/Context 依赖 repository read/锁 → IdentityPolicy owning `identity.resolve_policy@1.0` 在其自身独立授权下读取 Policy → owning Handler 的候选/判断或冻结事务。Freeze 的既有 payload 不含 Draft Ref，因此在自身 Decision 当前重验后，允许先按请求的完整 `validationSnapshotRef` 只读精确判断并取得其 `draftSnapshotRef`；该预读必须绑定同一 WorkOrder、Project Scope 与判断 Hash，不得读取 Draft/Context、建立幂等 Claim 或执行业务写入。取得 Draft Ref 后再签发并立即重验 Freeze 专用 Draft/Context dependency Decision，随后才能进入 Claim 和业务事务。该顺序由用户于 2026-09-22 在 #219 实现会话明确批准，不改变公开 Schema；判断预读不授予后续依赖读取权限。Freeze 在持锁提交点再次重验自身和依赖 Decision、Policy/Grant 与受信当前时间；历史成功 Receipt 返回前也须完成当前授权重验。缺失、撤销、过期、配置漂移、principal/Scope/完整 ref/hash/版本替换和 dependency 不可用均在读取对应事实或幂等 Claim 前 fail closed，只写脱敏 DENIED Audit；不得使用 Service 通配、caller 指定代理 principal、已有 build/validator Decision 或缓存替代。依赖授权通过只允许读取指定精确事实，不自动证明 Root DRAFT、Context 可执行或 candidate 匹配。

首版仅 canonical `@1.1` WorkOrder 与 INITIAL Context；legacy WorkOrder/Context target 不进入本条目闭集。`get_work_order_contract@1.0` 读取条目还须在返回已提交 Contract 之前重验当前 Decision，并按请求 WorkOrder ref 绑定 Root 的唯一 frozen pointer；Freeze Decision/Event 或持有 ContractRef 均不授予读取。验收须分别证明七条正向覆盖、缺少任一独立 Grant、撤销/到期/配置漂移/完整 ref 置换的拒绝及零业务成功事实；对依赖和权威 Query 的读取拒绝，还须断言对应 repository 调用数为 0。七条 Port、受信配置与组成层已由 #219 实现；授权单测与真实 PostgreSQL 消费覆盖见 Module-Test-003，独立实现审查待完成。


### 15.11 #219 Controls Policy 与执行能力分类补充（待审）

状态：`HUMAN DESIGN APPROVED 2026-09-22 / IMPLEMENTED 2026-09-22 / INDEPENDENT REVIEW PENDING`。配套 [Spec 003 §21.5–§21.9](Module-Spec-003-TaskExecution.md#issue-219-ready-support)。IdentityPolicy 继续只拥有版本化 Policy 事实、授权、生命周期和 Human-only 分类；Controls document 的字段及比较语义由 TaskExecution 拥有。

- 新 `execution.work_order_controls.policy@1.0` 的 profile selector 加入现有 Policy Schema registry，经既有 `identity.record_policy_version@1.0` 在独立当前授权下登记。消费侧使用 `identity.resolve_policy@1.0` 对确切同 Project `zhiju.identity.policy` 版本键解析，保留返回的 `policyVersionRef: SnapshotRef`、contentHash、effectiveFrom、supersededAt 与 useStatus；不增加另一套 Policy 存储、公开操作或 capability code。
- Validation、Builder、Controls 三个 Policy role 分别作 exact 解析；同一动作的一次解析可供该 Controls Ref 的多个字段角色共享，但不得跨动作或使用过期缓存。解析每次独立授权且在提交前重验当前 Grant/Policy；缺少 resolve Grant 在 Policy repository 读前拒绝。两种静态 registry（Evaluator 与 READY selector）不需要伪造 PolicyVersion 或 Policy resolve Decision。
- 复用 §15.7 owning Human-only 分类逻辑，增加内部方法 `classifyWorkOrderExecutionCapabilities`，只服务 `validate_work_order_draft@1.0` 与 `freeze_work_order@1.0`；输入与现有分类 Port 同结构，但调用主体必须为当前授权的 SERVICE principal，不能使用 requestedBy Human 绕过分类。既有 creation 方法与 HUMAN 创建允许集不变；不得向外导出 Human-only 集合或签发 Runtime Grant。INVALID 对应有解释的能力不满足；身份错误/Port unavailable 仍拒绝整次消费。
- §15.10 七条当前授权映射不变。Freeze 的已批准判断预读只解出受当前自身授权保护的 exact judgment，不把该判断的 producer Decision 当权限。Builder/Validator/Freeze 使用相同 Service principal 只是为了满足 EP Slice audience 的现有约束，不允许动作之间共享 Decision/Grant。

消费者测试必须涵盖真实 Controls Policy 登记/解析、无 resolve Grant 的零读、取代/到期/跨 Project、Human 创建却包含 Human-only 声明、相同 principal 但缺独立动作 Grant，以及依赖权限在入口后丢失的提交/返回拒绝。各场景按实际层级记录在 Module-Test-001/003，外部与人工验收仍 NOT RUN。

### 15.12 IM06-RUN-START 执行能力 Bundle 与独立授权提案

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-22 / LOCAL IMPLEMENTATION 2026-09-23 / PR #222 CI FULL PASS 2026-09-23（6a41b41）/ REVIEW APPROVE ON 6a41b41`。服务 [Spec 003 §22](Module-Spec-003-TaskExecution.md#22-ready--queued--受控-run-启动增量设计提案)；本节只拥有 Grant/Decision/Policy 与 Bundle 的签发、当前重验和授权映射，不接管 WorkOrder、Run 或 RuntimeAttempt 状态。

新增 `identity.issue_execution_capability_bundle@1.0`，`COMMAND/CREATE`，target `zhiju.identity.execution_capability_bundle`、Purpose `identity.execution_capability_bundle.issue`。闭集 payload 为 `{runRef:ObjectRef<execution.run>,workOrderRef:ObjectRef<zhiju.execution.work_order>,workOrderContractRef:ContentAddressedRef<zhiju.contract.work_order>,contextSnapshotRef:SnapshotRef<zhiju.execution.context_snapshot>,servicePrincipalRef:PrincipalRef,requestedCapabilities:NonEmptySet<CapabilityGrant>}`；Result.data 只有 `bundleRef:ContentAddressedRef<zhiju.identity.execution_capability_bundle>`。签发前以本次主体的两条独立消费授权调用 TE `get_work_order_contract@1.0` 和 `get_context_snapshot@1.0`，核对 Root frozen pointer、Context/Contract 精确绑定、Scope/Hash/当前期限；缺任一授权时对应 TE repository 读数为 0。`requestedCapabilities` 使用 Core §4 的完整声明形状，但不得包含任意新权利：逐项精确包含于冻结 Contract 的 allow 集、与 deny 集不重叠，Scope/action/resource selector 被当前同 Project covering Grant/Policy 完整覆盖，且经 owning Human-only 分类拒绝受保留能力。命令只能由受信 Dispatcher SERVICE 以自身 ActorSnapshot/Decision 调用；`servicePrincipalRef` 必须等于认证主体，`runRef` 为本次预分配目标，不能用 WorkOrder requestedBy、actingFor 或任意代理主体签发。

Bundle canonical payload 闭集为 `{runRef,workOrderRef,workOrderContractRef,contextSnapshotRef,servicePrincipalRef,capabilities,grantObservations,issuedDecisionRef,issuedAt,validUntil}`。每个 Core CapabilityGrant 的 `capabilityType` 必须等于一个当前 ScopedCapability 的 `capabilityCode`，其每个 action/resourceSelector 都由**同一个**当前 covering Grant 精确覆盖；Core 的 `constraints=[]`、`maxUses` 缺省，对应 IdentityPolicy Grant 的可执行 `constraints={}`、`maxUses` 缺省，不能把两个 Grant 的动作/资源拼成一次覆盖。Core `grantPolicyRef` 按已批准 §21.5 等于冻结 Controls Policy Ref，须独立解析并保持当前有效；IdentityPolicy Grant 自己绑定的 PolicySnapshot 是另一项来源观察，二者不得假定为同一种 Ref 或互相替代。`grantObservations` 对每个实际 covering Grant 保存完整 Grant Ref、PolicySnapshot Ref/hash、Grant/Policy 有效时间和精确覆盖的 capability；按 capability/action/resource/Grant ID 稳定排序，无重复。`validUntil` 为签发 Decision、所有参与 Grant/Policy、所有声明 capability 期限及冻结 Contract/Context 期限的有限最小值，必须严格晚于受信 `issuedAt`；无可验证有限上界拒绝。Bundle identity 独立 UUIDv7，内容地址 Hash 为完整 canonical payload 的 SHA-256，不含自身 Ref/Hash。写入与源命令 Receipt/Audit/Reference Edges 同一 IdentityPolicy 事务；app 角色不得 UPDATE/DELETE，Scope mirror、来源 Receipt、Hash 与 typed refs 在数据库守卫中闭合。签发不创建新 CapabilityGrant，也不允许 Bundle 被后续修改为更多权限。

提供 owning 内部 `ExecutionCapabilityBundlePort` 的 `readExactForRun`、`revalidateForDispatch`、`revalidateForStart` 三个消费边界；返回最小完整 payload 与当前 useStatus，不提供跨模块 Repository。每次重新读取当前 Grant/Policy/撤销事实、签发主体、Scope、Run/Contract binding 与受信时间；历史 Bundle 存在不等于仍可用。TE create_run、IG dispatch、TE start_run 各须在自己的独立 Decision 下调用，且返回或提交前重验；任何 dependency read 权限缺失时在 Bundle repository 读前拒绝。跨模块观测只保证调用时点，不宣称分布式原子性；Run/Attempt/start 各次重新授权。

| 消费边界 | Purpose / Actor | 独立 action / selector / target | 受信 config key |
|---|---|---|---|
| Bundle CREATE | `identity.execution_capability_bundle.issue` / Dispatcher SERVICE | `identity.execution_bundle.issue.v1` / `CREATE_TARGET_TYPE` / `zhiju.identity.execution_capability_bundle` | `executionBundleIssueV1` |
| Queue | 已发布 `task.execution.queue_work_order` / HUMAN | `execution.work_order.queue.v1` / `TARGET_TYPE` / `zhiju.execution.work_order` | `workOrderQueueV1` |
| Run CREATE | 已发布 `task.execution.create_run` / Dispatcher SERVICE | `execution.run.create.v1` / `CREATE_TARGET_TYPE` / `execution.run` | `runCreateV1` |
| Dispatch Binding Query | `execution.run.dispatch_binding.read` / IG SERVICE | `execution.run.dispatch_binding.read.v1` / `TARGET_TYPE` / `execution.run` | `runDispatchBindingReadV1` |
| Runtime dispatch | 已发布 `integration.gateway.request_runtime_dispatch` / IG SERVICE | `integration.runtime.dispatch.request.v1` / `CREATE_TARGET_TYPE` / `integration.runtime_attempt` | `runtimeDispatchV1` |
| Runtime Raw Receipt CREATE | 已发布 `integration.gateway.record_external_receipt` / IG SERVICE | `integration.runtime.receipt.record.v1` / `CREATE_TARGET_TYPE` / `integration.raw_external_receipt` | `runtimeReceiptRecordV1` |
| Attempt Binding Query | `integration.runtime.binding.read` / TE SERVICE | `integration.runtime.binding.read.v1` / `TARGET_TYPE` / `integration.runtime_attempt` | `runtimeAttemptBindingReadV1` |
| Run start | 已发布 `task.execution.start_run` / TE SERVICE | `execution.run.start.v1` / `TARGET_TYPE` / `execution.run` | `runStartV1` |
| WorkOrder reconcile | `execution.work_order.reconcile` / Process SERVICE | `execution.work_order.reconcile.v1` / `TARGET_TYPE` / `zhiju.execution.work_order` | `workOrderReconcileV1` |

以下 dependency read 也须逐消费方单独授权；完整 ContentAddressed/Snapshot Ref 保存在 Decision payload，V1006 target 镜像只保存其 OBJECT 身份，不能丢弃 Hash 或把内容寻址 Ref 当成 OBJECT target。所列 action 与 config key 均为提案的新受信映射，不增加公开授权 Command。

| 消费方 → 依赖 | Purpose / target | 独立 action / config key |
|---|---|---|
| Bundle issue → TE Contract | 已发布 `task.execution.get_work_order_contract` / `zhiju.execution.work_order` | `execution.work_order.contract.read.for_bundle_issue.v1` / `bundleIssueContractReadV1` |
| Bundle issue → TE INITIAL Context | 已发布 `task.execution.get_context_snapshot` / `zhiju.execution.context_snapshot` | `execution.context.snapshot.read.for_bundle_issue.v1` / `bundleIssueContextReadV1` |
| Queue → TE Contract/Context | 对应上述两条已发布 Query Purpose / canonical WorkOrder、Context | `execution.work_order.contract.read.for_queue.v1` / `queueContractReadV1`；`execution.context.snapshot.read.for_queue.v1` / `queueContextReadV1` |
| Run CREATE → TE Contract/Context | 对应上述两条已发布 Query Purpose / canonical WorkOrder、Context | `execution.work_order.contract.read.for_run_create.v1` / `runCreateContractReadV1`；`execution.context.snapshot.read.for_run_create.v1` / `runCreateContextReadV1` |
| Run CREATE → IP Bundle | `identity.execution_capability_bundle.read` / `zhiju.identity.execution_capability_bundle` | `identity.execution_bundle.read.for_run_create.v1` / `runCreateBundleReadV1` |
| Runtime dispatch → IP Bundle | `identity.execution_capability_bundle.read` / 同上 | `identity.execution_bundle.read.for_dispatch.v1` / `runtimeDispatchBundleReadV1` |
| Run start → IP Bundle、IG Attempt | `identity.execution_capability_bundle.read` / 同上；`integration.runtime.binding.read` / `integration.runtime_attempt` | `identity.execution_bundle.read.for_run_start.v1` / `runStartBundleReadV1`；`integration.runtime.binding.read.for_run_start.v1` / `runStartAttemptReadV1` |
| WorkOrder reconcile → TE Run | 已发布 `task.execution.get_run_state` / `execution.run` | `execution.run.state.read.for_work_order_reconcile.v1` / `workOrderReconcileRunReadV1` |

Queue、Run CREATE、Run start 读取各自拥有的 WorkOrder/Run Root 仍先重验自身命令 Decision；表中依赖读取不授权另一命令。每次 `identity.resolve_policy@1.0` 也使用该消费动作自身的当前 Policy-read Decision，不跨 Queue/Run/Start 或 Bundle issue 共享查询结果/历史 Decision。已有 TE/IG public Query 若在组成层被调用，必须同时满足该 Query 的注册 Purpose 与上述消费专用 action，不能只凭其中之一。

Purpose 值以现行 compatibility metadata 的逐字符值为准；上表中新操作 Purpose 随其注册固定，既有操作若 metadata 与本设计文字冲突，须在设计审查中先调和而不得静默改写已发布值。Queue/Run/Start/IG 各自的 Contract、Context、Bundle、Policy/Grant 和跨模块 Query 读取使用**消费专用** Decision，不能由上述命令 Decision、相同 principal、Freeze Decision 或 Service 通配授权替代。自身与依赖 Decision 均绑定完整 operation/version、payload hash、target、Project Scope、ActorSnapshot；在目标 protected read/Claim 前重验，在持锁提交及历史 Receipt/Query 返回前再次重验。缺失、撤销、过期或配置漂移只留下脱敏 DENIED Audit，不产生成功业务事实。完整映射和零读负例见 Module-Test-001/003；不得修改现有 `authorize_command@1.0` 的公开接受集或已应用 V1006。

### 15.13 IM06-FINAL Result 与 terminal 的独立授权提案

状态：`T2 / DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / IMPLEMENTED IN DRAFT PR #226 / LOCAL FULL PASS 2026-09-24 / EXACT HEAD EVIDENCE IN PR #226 / IMPLEMENTATION REVIEW PENDING`。服务 [Spec 003 §23](Module-Spec-003-TaskExecution.md#23-受控-final-agentresult-接纳与-run-终结增量设计提案)和 Spec 007 final 观察。沿用 §15.12 的 ActorSnapshot、完整 target、Purpose、当前 covering Grant/Policy、签发及持锁/返回前重验；不改变既有公开授权 API、V1006 或 §15.12 的 action。相同 SERVICE 主体不得使各步共享 Decision。

| 消费边界 | 注册 Purpose / Actor | 新受信 action / target / config key |
|---|---|---|
| Run start → IG 原 Adapter 实例身份 | 内部 owning read / TE Start SERVICE | `integration.runtime.adapter_identity.read.for_run_start.v1` / `integration.runtime_attempt` / `runStartAdapterIdentityReadV1` |
| TE final 候选扫描 | 内部 Process read / TE Process SERVICE | `execution.run.final_candidate.scan.v1` / 本 Project `zhiju.project.project` / `runFinalCandidateScanV1` |
| TE final Process 进度 | 内部 Process read/write / TE Process SERVICE | `execution.process.final_progress.v1` / 本 Project `zhiju.project.project` / `runFinalProcessProgressV1` |
| IG 原调用 final 观察的内部写入 | 内部 owning action / IG Worker SERVICE | `integration.runtime.final.observe.v1` / `integration.runtime_attempt` / `runtimeFinalObserveV1` |
| IG final Query | `integration.runtime.final_observation.read` / TE SERVICE | `integration.runtime.final.read.v1` / `integration.runtime_attempt` / `runtimeFinalReadV1` |
| Result submit | 已发布 `task.execution.submit_agent_result` / Ingestion SERVICE | `execution.agent_result.submit.v1` / CREATE `execution.agent_result` / `agentResultSubmitV1` |
| Run record | `execution.run.result.record` / Ingestion SERVICE | `execution.run.result.record.v1` / `execution.run` / `runResultRecordV1` |
| Result validate | `execution.agent_result.validate` / Validator SERVICE | `execution.agent_result.validate.v1` / CREATE `zhiju.execution.agent_result_validation_bundle` / `agentResultValidateV1` |
| Result accept | 已发布 `task.execution.accept_agent_result` / Validator SERVICE | `execution.agent_result.accept.v1` / CREATE `execution.agent_result_acceptance` / `agentResultAcceptV1` |
| Run finalize | `execution.run.finalize` / Validator SERVICE | `execution.run.finalize.v1` / `execution.run` / `runFinalizeV1` |
| Run expire | `execution.run.expire` / LeaseMonitor SERVICE | `execution.run.expire.v1` / `execution.run` / `runExpireV1` |
| Result authoritative read | 已发布 `task.execution.get_agent_result` / 独立授权消费者 | `execution.agent_result.read.v1` / `execution.agent_result` / `agentResultReadV1` |
| Run authoritative read | 已发布 `task.execution.get_run_state` / 独立授权消费者 | `execution.run.state.read.v1` / `execution.run` / `runStateReadV1` |

Run start 的 Adapter 身份 Port 与候选扫描均为受信内部能力，不新增公开 operation；前者仍须先满足已发布 start 自身 Decision 与原 IG Binding Query 的独立当前授权，后者只按 Project Scope 读取未到期 RUNNING/ACTIVE、尚无 final reservation 的 Run/Attempt Ref，不返回 Result body。已批准的独立 Process 进度 action 也不新增公开 operation：它仅按本 Project 读取/创建/以版本 CAS 更新 `controlled-final@1` 的 `process_instance` 与对应 `process_step`，不得借此查询 Run、Result、Bundle、Acceptance 或 CommandReceipt 业务/技术事实，不能替代候选扫描或 owning Command/Query 的 Decision。目标 Command 以原稳定键重放时仍由自身独立授权和既有 Command runner 精确读取原 Receipt。Process 建立前须经原候选扫描及独立 IG final Query；所需当前 Run 状态和冻结 WorkOrder Contract 分别经其既有独立读取授权取得。两项内部 action 的 Decision 均绑定 Project target、TE Process SERVICE ActorSnapshot、完整 operation/version/payload Hash 与 Scope，缺失或失效时各自 protected repository 读取和进度写入为 0。IG 原 ack 事务建立身份行沿用本次受信 Worker/dispatch 授权，不由 caller 传入 Adapter Ref。新增操作的 Purpose 随 Catalog 注册；旧四项 Purpose 必须逐字符复用当前 compatibility metadata，不能因本设计改动。Query 拒绝和任何 dependency read 拒绝均发生在 protected repository 读取之前。IG Worker 的内部观察 action 只授权读取原 Attempt 与写自身 final Observation，不成为 caller 可调用的 final 写入口。

每个 TE 步骤按其消费关系分别取得以下**依赖**资格。下表每格为受信 action / config key；目标与 Purpose 分别沿用已注册 IG Binding Query 的 `integration.runtime.binding.read`、本项新 IG final Query 的 `integration.runtime.final_observation.read`、IP Bundle owning read 的 `identity.execution_capability_bundle.read`、已注册 `identity.resolve_policy@1.0` 的 `identity.policy.resolve_policy`。各自绑定完整 Attempt、Bundle 或 Policy Ref 和 Project Scope，两个 IG Query 不能合并为一次授权。五个步骤的 static Evaluator 由 exact 构建期 registry 解析，不把静态 selector 伪称为 Policy/Grant。

| TE 消费步骤 | IG 原 Binding read | IG final read | IP Bundle current read | Controls Policy current resolve |
|---|---|---|---|---|
| submit | `integration.runtime.binding.read.for_result_submit.v1` / `resultSubmitBindingReadV1` | `integration.runtime.final.read.for_result_submit.v1` / `resultSubmitFinalReadV1` | `identity.execution_bundle.read.for_result_submit.v1` / `resultSubmitBundleReadV1` | `identity.policy.resolve.for_result_submit.v1` / `resultSubmitPolicyReadV1` |
| record | `integration.runtime.binding.read.for_result_record.v1` / `resultRecordBindingReadV1` | `integration.runtime.final.read.for_result_record.v1` / `resultRecordFinalReadV1` | `identity.execution_bundle.read.for_result_record.v1` / `resultRecordBundleReadV1` | `identity.policy.resolve.for_result_record.v1` / `resultRecordPolicyReadV1` |
| validate | `integration.runtime.binding.read.for_result_validate.v1` / `resultValidateBindingReadV1` | `integration.runtime.final.read.for_result_validate.v1` / `resultValidateFinalReadV1` | `identity.execution_bundle.read.for_result_validate.v1` / `resultValidateBundleReadV1` | `identity.policy.resolve.for_result_validate.v1` / `resultValidatePolicyReadV1` |
| accept | `integration.runtime.binding.read.for_result_accept.v1` / `resultAcceptBindingReadV1` | `integration.runtime.final.read.for_result_accept.v1` / `resultAcceptFinalReadV1` | `identity.execution_bundle.read.for_result_accept.v1` / `resultAcceptBundleReadV1` | `identity.policy.resolve.for_result_accept.v1` / `resultAcceptPolicyReadV1` |
| finalize | `integration.runtime.binding.read.for_run_finalize.v1` / `runFinalizeBindingReadV1` | `integration.runtime.final.read.for_run_finalize.v1` / `runFinalizeFinalReadV1` | `identity.execution_bundle.read.for_run_finalize.v1` / `runFinalizeBundleReadV1` | `identity.policy.resolve.for_run_finalize.v1` / `runFinalizePolicyReadV1` |

Bundle Port 消费动作对应 `revalidateForResultSubmit/Record/Validate/Accept/Finalize`；expire 只用 `readIntegrityForExpiry` 和独立 `identity.execution_bundle.inspect.for_run_expire.v1` / `runExpireBundleInspectV1` 验证历史绑定，不重获执行能力。record/validate/accept/finalize 对上游 TE Result、判断 Bundle 或 Acceptance 的读取采用独立内部 source-read Decision，固定 action 分别为 `execution.agent_result.source.read.for_record.v1`、`execution.agent_result.source.read.for_validate.v1`、`execution.result_validation.source.read.for_accept.v1`、`execution.agent_result_acceptance.source.read.for_finalize.v1`，config key 为对应 `resultRecordSourceReadV1`、`resultValidateSourceReadV1`、`resultAcceptSourceReadV1`、`runFinalizeSourceReadV1`；这些 Port 不调用需要 Acceptance 的公开 `get_agent_result@1.0` 来读取半成品。各步自己的 Run Root 读取须先通过该步自身命令 Decision。缺任一源读取授权时不进入该源 repository；查询 IG 的 Attempt target 可从已授权 Run/Result 中取得，不先做无权发现。不能用 start Decision、历史 Receipt、Result Ref、Agent 自报 Usage 或 Event 代替任何一项。
授权顺序：自身 Decision 和全部必需依赖 Decision 当前重验 → 各 Owner 权威读 → TE Run/Result/Claim 锁与比较 → 提交/历史 Receipt 返回前再次重验。Policy 取代、Grant 撤销、Bundle/Decision 到期或 Scope/ref/hash/actor 换绑，均不产生新 Result、Validation、Acceptance 或 terminal 成功事实；对已到期 Run 的 `expire_run`，不能要求已失效的执行 Bundle 重新获得**执行**资格，监控服务只需独立的 expiry/Run 读取授权和历史 Bundle 完整性证明，否则会使到期资源永久无法释放。历史事实保留审计，拒绝只产生脱敏 Audit。独立映射与零 protected read、持锁后撤权以及到期清理回归见 `IP-FINAL-D-*`；当前全部 `NOT RUN`。

### 15.14 IM06-RECOVERY 有限恢复授权组成实现契约（#229）

状态：`T2 / DESIGN APPROVED / INDEPENDENT DESIGN REVIEW PASSED 2026-09-27 / HUMAN DESIGN APPROVED 2026-09-27 / IMPLEMENTATION PRESENT (#231) / EXACT REVISION VERIFICATION AND REVIEW EVIDENCE IN PR #232`。仅服务 [Spec 003 §24](Module-Spec-003-TaskExecution.md#24-blocked_input--customermaterial--context-2--run-2-spec-delta229)。已交付 §15.12/15.13 当前权限、完整Ref/Scope/hash/session/ActorSnapshot/Decision、锁后与Receipt返回前重验规则不变。新增映射是受信组成配置，不是公开authorize API变化；主动作和每项依赖均先通过自己的Decision，缺任一时对应protected read为0。不能由Process进度权限读取业务表。

| 主动作 | 精确注册Purpose / Actor | action / target / config key |
|---|---|---|
| Open Request | `task.execution.open_information_request` / Processor SERVICE | `execution.information_request.open.v1` / CREATE `execution.information_request` / `informationRequestOpenV1` |
| Request Query | `task.execution.get_information_request` / 同Project role HUMAN或授权SERVICE | `execution.information_request.read.v1` / `execution.information_request` / `informationRequestReadV1` |
| Answer submit | `task.execution.submit_information_answer` / HUMAN=responder | `execution.information_request.answer.submit.v1` / `execution.information_request` / `informationAnswerSubmitV1` |
| Resolve | `task.execution.resolve_information_request` / HUMAN=resolver=responder=confirmer | `execution.information_request.resolve.v1` / `execution.information_request` / `informationRequestResolveV1` |
| Frozen Context CREATE @1.1 | `task.execution.build_context_snapshot` / Builder SERVICE | `execution.context.frozen.build.v1_1` / CREATE `zhiju.execution.context_snapshot` / `frozenContextBuildV1_1` |
| Retry schedule | `task.execution.schedule_work_order_retry` / HUMAN | `execution.work_order.retry.schedule.v1` / `zhiju.execution.work_order` / `workOrderRetryScheduleV1` |
| Task reconcile | `execution.task.reconcile` / Process SERVICE | `execution.task.reconcile.v1` / `zhiju.execution.task` / `taskReconcileV1` |
| Task state | `execution.task.read` / 授权HUMAN或SERVICE | `execution.task.state.read.v1` / `zhiju.execution.task` / `taskStateReadV1` |
| WorkOrder state | `execution.work_order.execution_state.read` / 授权HUMAN或SERVICE | `execution.work_order.execution_state.read.v1` / `zhiju.execution.work_order` / `workOrderExecutionStateReadV1` |
| recovery候选扫描 | 内部 / Process SERVICE | `execution.recovery.candidate.scan.v1` / Project `zhiju.project.project` / `recoveryCandidateScanV1` |
| recovery进度CAS | 内部 / Process SERVICE | `execution.process.recovery_progress.v1` / 同Project target / `recoveryProcessProgressV1` |

EP propose/confirm逐字符复用metadata：`enterprise.project.propose_customer_material`、`enterprise.project.confirm_customer_material`，Actor HUMAN、完整 `zhiju.project.customer_material` target、EP自身covering Grant/CAS；不得使用Spec设计期短Purpose替换已发布值。EP Receipt Query继续 `project.resolution_receipt.read`。roleCode精确 `project.customer_material.confirmer`，是已有RoleAssignment机制的一项受控配置，不新增Role管理API；Runtime不能决定角色拥有者。Human retry也须当前显式 `execution.work_order.retry.schedule.v1` grant，不因confirmer role存在默认赋予retry。Agent和actingFor不代替上述Human动作；Service承载Resolver依赖读取不得替换Human的业务归因。

以下表格定义每个consumer独立的完整依赖映射，避免跨步共享Decision。`<c>` 取值闭集为 `request_open`、`answer_submit`、`request_resolve`、`frozen_context_build`、`retry_schedule`、`work_order_reconcile`、`task_reconcile`、`work_order_state`、`task_state`、`bundle_issue`、`run_create`、`runtime_dispatch`、`run_start`、`result_submit`、`result_record`、`result_validate`、`result_accept`、`run_finalize`、`driver_template`；config key=`recovery.<c>.<d>.v1`，action=表中模板替换值。每个组合仅授权所列Port的窄返回，不授权相同Root的其他读写；本设计要求配置文件逐条展开，不引入动态通配Grant/Policy解释器。

| dependency `<d>` / Purpose、精确target | 必需consumer `<c>` | 独立action模板 |
|---|---|---|
| `material` / EP内部 `project.customer_material.recovery_refs.read`，candidate/confirmed VERSIONED的OBJECT target，payload保留完整版本/Source refs | driver_template；request_open；answer_submit；result_submit；result_validate | `project.customer_material.recovery_refs.read.for_<c>.v1` |
| `source` / owning TE source read，Result/Acceptance/terminal Run完整refs，target为对应OBJECT身份 | request_open；work_order_reconcile；task_reconcile；retry_schedule | `execution.recovery.source.read.for_<c>.v1` |
| `answer` / owning TE immutable Answer+Resolution+Request状态读，target=`execution.information_request`，payload保留完整Answer/Resolution refs | request_resolve；frozen_context_build；retry_schedule；work_order_reconcile；task_reconcile；work_order_state；task_state；bundle_issue；run_create；runtime_dispatch；run_start | `execution.recovery.answer.read.for_<c>.v1` |
| `receipt` / EP `project.resolution_receipt.read`，OBJECT镜像`zhiju.project.command_receipt`，payload完整CA Ref | request_resolve；frozen_context_build；retry_schedule；bundle_issue；run_create；runtime_dispatch；run_start；work_order_reconcile；task_reconcile；work_order_state；task_state | `project.resolution_receipt.read.for_<c>.v1` |
| `human` / owning IP `identity.recovery.human_eligibility.read`，target=`zhiju.identity.principal` | answer_submit；request_resolve；frozen_context_build；retry_schedule；bundle_issue；run_create；runtime_dispatch；run_start；work_order_reconcile；task_reconcile；work_order_state；task_state | `identity.recovery.human.read.for_<c>.v1` |
| `contract` / TE `task.execution.get_work_order_contract`，canonical WorkOrder | request_open；frozen_context_build；retry_schedule；work_order_state | `execution.work_order.contract.read.for_<c>.v1` |
| `context` / TE `task.execution.get_context_snapshot`，canonical Context | frozen_context_build（Context-1）；bundle_issue/run_create/runtime_dispatch/run_start（Context-2，沿用各自既有Context-read动作，再增frozen eligibility） | `execution.context.snapshot.read.for_<c>.v1` |
| `frozen_eligibility` / owning TE `execution.context.frozen_eligibility.read`，Context target，payload保留原Contract/Resolution refs | bundle_issue；run_create；runtime_dispatch；run_start | `execution.context.frozen_eligibility.read.for_<c>.v1` |
| `controls` / IP `identity.policy.resolve_policy`，VERSIONED业务Policy（target为已注册PolicyVersion的OBJECT身份） | request_open；frozen_context_build；retry_schedule；work_order_reconcile；task_reconcile；work_order_state；task_state；answer_submit；request_resolve | `identity.policy.resolve.for_<c>.v1` |

Frozen Context的Builder Policy resolve与EP capture/read继续Spec001 §15.8/15.9的独立动作；扩展Frozen consumer配置，不能拿INITIAL的Draft-read替代frozen Contract/Answer-read。Run/Bundle/dispatch/start的现有Controls/Bundle读取动作仍逐步执行；final submit/record/validate/accept/finalize沿用 §15.13，增加消费Run已绑定的FROZEN eligibility及当前Answer/Receipt/Human重验，其独立action/config依同一模板分别展开consumer `result_submit/result_record/result_validate/result_accept/run_finalize`；它们不借Validator身份共用Decision。到期清理仍只需独立expiry授权和历史完整性，不要求已撤销的执行资格重新有效。

IP内部 `readRecoveryHumanEligibility` payload closed `{principalRef,scopeRef,roleCode,confirmationActorSnapshotRef?,confirmationAuthorizationDecisionRef?,confirmationTargetRef?,confirmationRequestPayloadHash?,confirmationCommittedAt?}`：submit只用前三项；其他consumer历史五项全部存在。result closed `{principalRef,roleCode,roleAssignmentRef,grantRefs,checkedAt,validUntil,confirmationProvenanceValid:boolean,useStatus:USABLE|REVOKED|EXPIRED}`，refs为真实完整已提交身份，validUntil取当前读取Decision/参与RoleAssignment/Grant/Policy最小期限。历史证明复用owning AuthorizationDecision/ActorSnapshot读取Port，检查confirm operation@1.0/Purpose/target/Scope/payloadHash/认证主体在committedAt确实有效；历史事实必须能从 owning 已提交 ActorSnapshot/AuthorizationDecision 与其固定 proof 读回，当前 grant 是否撤销只参与当前资格，不能根据当前 grant 状态重写当时决定；`confirmationProvenanceValid`由Owner计算，submit未带历史项时为false，不当作正式确认。当前covering role/答复/采纳/来源读取权限必须仍有效；historical Decision期满本身不抹去当时COMMITTED，不等于当下Human仍有权。不可证明/权限失效fail closed，不从同principal/correlation推断。该Port复用既有IP读授权入口而不新增公开历史Decision Query；PrincipalRef、RoleAssignment/Grant refs均为各Owner实际已提交完整类型，RoleAssignment用OBJECT/identity.role_assignment，Grant用OBJECT/identity.capability_grant，grantRefs非空去重，任何Scope不同或依赖失效不返回USABLE。真实grant PolicySnapshot取代仍缺owning写入能力，保留§22.8的NOT RUN；当前可达Grant撤销/Controls取代/期限/锁后复验必须验收。

当前 Human Grant 覆盖必须对每个受信 binding 独立检查完整 capabilityCode、action 和 TARGET_TYPE/objectType，以及同 Project Scope、constraints/maxUses、当前状态/期限和 Policy 完整性。多个动作允许复用同一 capabilityCode，但仅 code 相同不证明另一 action 或 target 已授权；同一 Grant 可以覆盖多个 binding，仅当它分别完整满足各项。缺失、撤销或 target selector 不匹配的任一必需项都拒绝 USABLE；已有历史确认、Resolution、Context 或 Bundle 不跳过新 Context/Bundle/Run 消费时的当前资格重验。

Bundle issue的新Context分支只接受Spec003 §24.5的FROZEN eligibility Port，读取仍从TE owning边界；新的Bundle canonical payload不增字段，Run-2的ContextRef、original ContractRef、预分配RunRef、SERVICE subject与当前covering Grants精确一致。validUntil同时受原Contract/Context/Resolution当前资格、Policy/Decision和Capability期限约束；旧Bundle/Grant不因Human答案获得新权限。由本profile选中的控制Policy @1.1必须真实登记且当前精确有效，不由旧@1.0或历史freeze授权回退。

历史IP证明的实现缺口须明确作为内部增量交付：EP只保存Decision/ActorSnapshot identity，而现行 `validateAuthorizationDecision` 入口要求caller提供contentHash且按当前now检查expiry，不能直接拿它消费无Hash的EP attestation或在其中加历史放行开关。`readRecoveryHumanEligibility` 在自身当前授权下由IP新增窄 identity+ProjectScope 定位读取，先对真实Decision row执行 `authorizationDecisionIntegrityHolds` 的canonical hash/列镜像校验，再按该已验证row保存的actor_snapshot_id+payload_hash调用owning ActorSnapshot exact读取，核对EP的ActorSnapshot identity/Scope和Human归因；时间比较使用真实committedAt与持久决定的签发/expiry，不更改旧current validator。新确认 Decision 的 canonical `requestedAt` 由 owning 签发入口的受信应用时钟记录，与 expiry 使用同一次时钟观察；它作为历史签发起点，避免将数据库插入时间 `created_at` 与应用提交时间混作同一时钟。旧无该字段的已发布 Decision 保留既有 `created_at` 回退，提交早于签发或达到 expiry 仍拒绝。其当前Role/Grant部分继续调用现有IP current access/分类边界，不能因历史ALLOW跳过。任何身份不可查、storedhash不符、operation/version/target/Scope/session/requestHash错配均返回内部INVALID_PROVENANCE，TE映射EXECUTION_RESOLUTION_RECEIPT_INVALID；当前读取无权/到期沿用共享授权拒绝。无新IP public Query、无跨SchemaSQL、无Caller自报Policy状态，也不把新增内部读取说成已存在功能。


### 15.15 IM06-COMPLETION 独立授权组成（提案，#233）

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-30 / IMPLEMENTATION MERGED (#235 / PR #236) / VERIFICATION AND REVIEW EVIDENCE IN PR #236 / HUMAN TECHNICAL APPROVAL APPROVED`。服务 [Spec 003 §25](Module-Spec-003-TaskExecution.md#25-正式输出与独立-completion-spec-delta233) / Spec 004 §12；没有IdentityPolicy新增公开操作/Grant/PolicySnapshot lifecycle。本节所有映射已实现为受信composition配置；不采用自由purpose/action通配，不能从caller配置生成授权。

| 自身边界 | Principal allowlist | 精确Purpose | action / config key | target selector |
|---|---|---|---|---|
| evaluate_work_order_completion@2.0 | HUMAN或TE Evaluator SERVICE | `execution.work_order.evaluate_completion` | `execution.work_order.completion.evaluate.v2` / `workOrderCompletionEvaluateV2` | TARGET_TYPE/zhiju.execution.work_order |
| evaluate_task_completion@2.0 | HUMAN或TE Evaluator SERVICE | `execution.task.evaluate_completion` | `execution.task.completion.evaluate.v2` / `taskCompletionEvaluateV2` | TARGET_TYPE/zhiju.execution.task |
| get_output_creation_binding@1.0 | Artifact SERVICE | `execution.run.output_creation_binding.read` | `execution.run.output_creation_binding.read.v1` / `outputCreationBindingReadV1` | TARGET_TYPE/execution.run |
| create_execution_revision@1.0 | HUMAN | `artifact.execution_revision.create` | `artifact.execution_revision.create.v1` / `executionRevisionCreateV1` | CREATE_TARGET_TYPE/artifact.artifact_revision |
| get_execution_output_fact@1.0 | HUMAN或明确TE Evaluator/Validator或受控Driver SERVICE | `artifact.execution_output.read` | `artifact.execution_output.read.v1` / `executionOutputReadV1` | TARGET_TYPE/artifact.artifact_revision |
| get_work_order_state@1.0 | HUMAN或明确TE SERVICE | `execution.work_order.state.read` | `execution.work_order.state.read.v1` / `workOrderStateReadV1` | TARGET_TYPE/zhiju.execution.work_order |
| get_execution_judgment@1.0 | HUMAN或明确TE SERVICE | `execution.judgment.read` | `execution.completion_judgment.read.v1` / `completionJudgmentReadV1` | TARGET_TYPE/zhiju.execution.completion_evaluation |
| get_task_state@1.0 | 既有Human/Service allowlist | 既有 `execution.task.read` | 既有TaskState配置不变；其Completion依赖读取用下表task_state | 既有Task creation身份 |
| Driver releaseFormalOutput 内部入口 | HUMAN | `integration.runtime.formal_output.release` | `integration.runtime.formal_output.release.v1` / `formalOutputReleaseV1` | TARGET_TYPE/integration.runtime_attempt（绑定真实原invocation） |
| Completion Process候选扫描 / 进度 | TE Process SERVICE | `execution.completion.candidates.scan` / `execution.completion.process.progress` | `execution.completion.candidates.scan.v1` / `completionCandidatesScanV1`；`execution.completion.process.progress.v1` / `completionProcessProgressV1` | TARGET_TYPE/zhiju.project.project |

Policy/Evaluator静态selectors不授予权利。服务身份allowlist按受信servicePrincipalRef配置精确比对，不能因为kind=SERVICE就通行；HUMAN-only creation/release不允许Agent/Runtime/External、actingFor或SERVICE代理。completion SERVICE使用自己的ActorSnapshot/Decision，不转述WorkOrder.requestedBy或Human creation Decision。每个自身Decision绑定operation/version、完整payloadHash、target identity/Scope、认证session、ALLOW/expiry和当前covering Grant/PolicySnapshot；完整content-addressed Ref进入Decision payload，V1006 target mirror仅存OBJECT身份。

依赖读取集合是有限的。以下consumer token/configStem闭集：`output_creation/outputCreation`、`result_validate/resultValidate`、`result_accept/resultAccept`、`run_finalize/runFinalize`、`work_order_completion/workOrderCompletion`、`task_completion/taskCompletion`、`work_order_state/workOrderState`、`task_state/taskState`、`judgment_read/judgmentRead`、`readiness_build/readinessBuild`、`readiness_consume/readinessConsume`、`driver_release/driverRelease`、`work_order_validation/workOrderValidation`、`work_order_freeze/workOrderFreeze`。每个**实际需要的**依赖都由消费方自身principal单独取得Decision；相同purpose也不合并不同target/Ref。下表action中C及config中S仅由上述构建期闭集展开，不接受外部插值。

| owning依赖 / Purpose | 精确action / config key | target及适用consumer |
|---|---|---|
| Artifact output-fact / `artifact.execution_output.read` | `artifact.execution_output.read.for_C.v1` / `SExecutionOutputReadV1` | artifact.artifact_revision完整exact Ref；除output_creation外所有上述consumer（有Completion来源时） |
| business Policy resolve / 既有 `identity.policy.resolve_policy` | `identity.policy.resolve.for_C.v1` / `SCompletionPolicyReadV1` | zhiju.identity.policy完整VersionedRef；Completion生产/读取/Readiness；output_creation解析Controls用`identity.policy.resolve.for_output_creation.v1` / `outputCreationControlsReadV1` |
| Profile exact Query / 既有 `quality.governance.get_quality_profile` | `quality.profile.read.for_C.v1` / `SQualityProfileReadV1` | quality.quality_profile完整VersionedRef；仅work_order_validation/work_order_freeze新profile且Task有质量criterion |
| Quality snapshot发现内部Port / `quality.completion_selection.read` | `quality.completion_selection.read.for_C.v1` / `SCompletionQualitySelectionReadV1` | OBJECT/artifact.artifact_revision，exact Revision+冻结Profile+requireApproval在payload；task_completion首次/显式refresh，不适用于旧Evaluation current读回 |
| RAS / 既有 `quality.governance.get_revision_acceptance_snapshot` | `quality.ras.read.for_C.v1` / `SRevisionAcceptanceReadV1` | 完整RAS Snapshot identity/Hash/Scope；Task Completion/所有current Completion消费仅在criteria适用时 |
| ABS / 既有 `quality.governance.get_approval_bundle_snapshot` | `quality.abs.read.for_C.v1` / `SApprovalBundleReadV1` | 完整ABS Snapshot identity/Hash/Scope；仅FULLY_APPROVED适用时 |
| current Quality eligibility / `quality.revision.execution_eligibility.read` | `quality.execution_eligibility.read.for_C.v1` / `SRevisionEligibilityReadV1` | exact Revision+RAS/ABS在payload，OBJECT target为Revision身份；仅质量criteria适用时 |
| TE Completion本地源集内部Port / `execution.completion.sources.read` | `execution.completion.sources.read.for_C.v1` / `SCompletionSourcesReadV1` | target Task或WO OBJECT，完整criteria/definition/Scope在payload；Completion生产/WOState/TaskState/Judgment/Readiness；protected child/Run/Result/Acceptance/Request/Resolution读前 |
| IP terminal执行历史完整性内部Port / `identity.execution_capability_bundle.inspect` | `identity.execution_bundle.inspect.for_C.v1` / `SCompletionBundleInspectV1` | 完整Bundle Ref；WO Completion生产/current WO消费，不要求terminal Bundle新execution资格 |

new planning Validator/Freeze对Task定义独立内部read映射：Purpose=`execution.task.definition.read`、action=`execution.task.definition.read.for_work_order_validation.v1` / `execution.task.definition.read.for_work_order_freeze.v1`，config=`workOrderValidationTaskDefinitionReadV1` / `workOrderFreezeTaskDefinitionReadV1`，target=OBJECT/zhiju.execution.task，完整definition Ref/pointer在授权后取得并受parent锁重验；它仅为质量criteria/Profile pin检查，不隐含完成或扩张Task读取。

Artifact创建的TE Query使用自身`outputCreationBindingReadV1`，Artifact protected root/content来源读取由该creation自身Decision与其owningScope覆盖；Driver release须Driver SERVICE独立`driver_release` output-fact读取，不借HUMAN release Decision。TE binding Query内部Bundle当前read沿用§15.12独立Purpose，新增 `identity.execution_bundle.read.for_output_creation.v1` / `outputCreationBundleReadV1`；它读当前Run/Contract/Context归本Query自身授权，Source读取先授权再访问。Result submit/record不检查output current来源（IG bytes与Run绑定沿用原映射），validate/accept/finalize使用本表相应consumer独立output read；其既有Policy/Bundle/IG/TE source映射§15.13仍全部required。

Task Completion及其Query/Readiness消费以自身授权读全体child来源再调用同一内部CompletionUsePort，**相同consumer**独立展开各child output/Policy/Quality/Bundle Decision；不能把child历史Evaluation.producedBy Decision当授权。自身与全部dependency Decision在protected读前、锁后提交前及历史Receipt返回前按受信now/current Grant/Policy重验，缺任何必需授权protected repository读取/写入为0。source dependency不可达返回DEPENDENCY_UNAVAILABLE；缺权/错误actor/hash/Scope/过期统一AUTHORIZATION_DECISION_INVALID或既有Human-only码，不提供私有来源详情。

Receipt replay只重验当前**读取原命令结果**资格与自身Decision，不能重新要求已完成Run ACTIVE；不执行新的owning source查询来重造结果。新键refresh重新取得全部dependency资格，不把历史Decision/TTL传递给新判断。实际Grant撤销和Controls/Completion Policy真实后继必须验收；Grant PolicySnapshot取代仍遵守#224已批准无owning写入者的延后，不宣称本次交付。


### 15.16 IM06-DELIVERY-COMPLETION 授权组成提案（#237）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-01 / INDEPENDENT DESIGN REVIEW PASSED / NOT IMPLEMENTED / NOT RUN`。服务Spec003 §26 / Spec002 §23；复用owning Decision签发、完整性校验、ActorSnapshot/session绑定、target mirror和当前covering Grant/Policy检查，不新增IP公开API/业务Policy Engine，不改变实际Grant PolicySnapshot lifecycle的原延后。

新增owning内部 `TaskCompletedDeliveryAuthorizationPort`，静态有限映射如下。所有内部operation version为`1.0`、type为表中Purpose；@2.0公开命令使用真实operation/version。target全部OBJECT；Project target=`zhiju.project.project`（objectId=projectId），Task target=`zhiju.execution.task`（objectId=event aggregateId），Item target=`zhiju.project.delivery_item`（objectId=exactItemId）。完整Version/Hash/关联保留在授权payload，不能只依赖V1006 OBJECT mirror。

| 边界 / Purpose | principal allowlist | action / config key | target / closed authorization payload |
|---|---|---|---|
| `execution.task_completed.dispatch.scan` | 配置的TE Dispatcher SERVICE | `execution.task_completed.dispatch.scan.v1` / `taskCompletedScanV1` | Project / `{projectRef}`，只返回candidate EventId |
| `execution.task_completed.dispatch.claim` | 同上 | `execution.task_completed.dispatch.claim.v1` / `taskCompletedClaimV1` | Project / `{projectRef,eventId,workerOwner}`，event来源检查发生在owningScope内 |
| `execution.task_completed.dispatch.read` | 同上 | `execution.task_completed.dispatch.read.v1` / `taskCompletedReadV1` | Task / `{taskRef,eventId,workerOwner,leaseToken}`，保护Outbox/Receipt/Evaluation/definition与stable binding读取 |
| `execution.task_completed.dispatch.confirm` | 同上 | `execution.task_completed.dispatch.confirm.v1` / `taskCompletedConfirmV1` | Task / `{taskRef,eventId,workerOwner,leaseToken,bindingHash,sourceWatermark,consumerResult}` |
| `execution.task_completed.dispatch.failure` | 同上 | `execution.task_completed.dispatch.failure.v1` / `taskCompletedFailureV1` | Task / `{taskRef,eventId,workerOwner,leaseToken,errorCode}`，attempt/budget来自存储 |
| `execution.task_completed.dispatch.resume` | HUMAN operator | `execution.task_completed.dispatch.resume.v1` / `taskCompletedResumeV1` | Task / `{taskRef,eventId,reason}`，审计+resume原子 |
| `project.delivery_completion.consume` | 配置的EP Consumer SERVICE | `project.delivery_completion.consume.v1` / `deliveryCompletionConsumeV1` | Project / `{event,sidecar,bindingHash,sourceWatermark}`完整bytes及Hash；sourceEventId/correlation从已验证材料派生 |
| `project.evaluate_delivery_item_completion@2.0` / 既有Purpose `project.delivery_item.evaluate_completion` | HUMAN或配置的EP Evaluator SERVICE | `project.delivery_item.completion.evaluate.v2` / `deliveryItemCompletionEvaluateV2` | Item / 完整公开payload，targetVersion包含在payload；expectedAggregateVersion另进入command binding |
| `project.delivery_completion.read_exact` | HUMAN或配置的EP Reader SERVICE | `project.delivery_completion.read_exact.v1` / `deliveryCompletionReadExactV1` | Item / Spec002 §23.4完整request，fact/evaluation/Plan/Version均进入Hash |

claim只允许project-scoped候选检查及TE附属binding生成，不借Project权限开放任意Task正文；read自身再次授权Task来源，不与claim共用Decision。claim内部读取最小Task Evaluation/definition关联时也需以同Dispatcher另签发`dispatch.read`，payload使用被claim锁定的event/owner/token；缺其权限claim事务不得提交lease/binding/cursor。confirm/failure/resume只改本event metadata/ack，不开放其他业务Root。Consumer和Evaluator对自己的EP Facts/criteria/关联/撤销集的有限读取由各自自身Decision覆盖；不查询其他Owner。Readback授权覆盖精确目标的历史/current ledger证明，必须在protected repository读取前核对fullScope，不是全Project任意body权限。

composition先校验注册Event/公开Command的真实Registry形状、内部closed输入、canonical Hash与Scope，再调用IP owning签发/validate；校验ALLOW、operation/version、Purpose/action/config、精确target、完整request payloadHash、ActorSnapshot Ref/hash、principalId/kind、认证session Hash、有限expiry及single covering当前Grant/PolicySnapshot。角色名和SERVICE kind不构成授权，allowlist为受信配置中的exact PrincipalRef，Human actingFor不能供给Service权限；workerOwner从认证Worker实例派生且绑定该principal，不由请求任意覆盖。

Consumer会话只由受信composition获得TE owning readClaimed后的私有材料handle；EP配置仅接受该handle并比对event/binding/watermark完整Hash，不能调用通用EventConsumer context factory把任意JSON提升为来源事实。此handle不是公开可序列化token，也不持有跨模块Repository；TE producer历史Decision仅用于事件来源校验，EP Consumer仍用自己的当前Decision/Actor。跨事务observer不宣称分布式同一时刻授权原子性。

每一步自身Decision在protected读前、数据库锁等待后提交前、历史成功/重复返回前按受信current clock/current Grant重验；claim的独立read也在上述点重验。禁止只在组成入口检查一次或在事务中持有过期Decision。缺/错操作/错Actor/认证Hash/Scope/target/payload/过期/撤权统一AUTHORIZATION_DECISION_INVALID、protected读/写为0（已合法完成的前一步不回滚）。Readback返回前重验；Evaluation replay先重验原结果读取资格再查Receipt，不重新要求terminal执行或原Planactive。临时IP依赖不可达DEPENDENCY_UNAVAILABLE，不把旧ALLOW当缓存fallback。

v1既有授权/接受集不改，v1不能解释新profile；本节新增SERVICE动作不能被Agent/Runtime直接调用。真实Role/Grant撤销、锁后expiry、错service/跨Scope/session及replay撤权证据见Module-Test001 #237；实际PolicySnapshot lifecycle依旧不宣称PASS。
