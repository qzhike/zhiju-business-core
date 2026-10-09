# Zhiju Core Typed References 与 Contract Catalog v0.1

版本：v0.1
日期：2026-08-12
状态：`CURRENT CONTRACT CATALOG BASELINE / IM-04 WI-01 ADDITIVE CONTRACT VERIFIED 2026-08-28 / PR #100 MERGED / ISSUE #90 CLOSED / IM-06 #157/#158 CONTRACT REGISTRATION VERIFIED 2026-09-10`

文档角色：Typed Reference、统一 Envelope、Contract 兼容性与公开 Command/Query/Event 名称的唯一权威。模块职责以 `02` 为准，Payload 业务语义以 `03/04` 为准，持久化以 `07` 为准。

## 1. 文档目标

本文冻结跨模块引用类型、统一 Command/Query/Event Envelope、Contract 版本与兼容性规则，并建立七个逻辑模块的公开 Contract Catalog。

本文不定义数据库结构、编程语言类型、HTTP Route、MCP Tool、消息中间件 Topic 或飞书事件 JSON。

---

## 2. 基础语义

### 2.1 ID、业务版本与并发版本

三个概念必须分离：

```text
objectId
= 一个业务对象的稳定身份

versionId / revisionId / snapshotId
= 一个不可变业务版本或快照的稳定身份

aggregateVersion
= 可变 Aggregate 的 optimistic concurrency token
```

示例：

```text
CustomerBaseline objectId = CB-ROOT-001
CustomerBaseline versionId = CB-003
current aggregateVersion = 8
```

`aggregateVersion=8` 不能被写入 WorkOrder 作为客户基线历史引用。它只用于：

```text
expectedAggregateVersion = 8
```

下一次成功写入后变成 9。真正可重放的 Context 必须引用 `CB-003`，必要时再绑定 Payload Hash。

### 2.2 ID 规则

- ID 是 opaque identifier，Consumer 不解析前缀获得业务语义；
- ID 一旦发布不得复用；
- 删除/归档对象的 ID 仍不得重新分配；
- 用户可读编号、标题、文件名和 ReleaseNumber 不是对象 ID；
- 飞书 messageId、Harness sessionId、文件路径和 Provider requestId 是 ExternalRef，不是 Core ObjectId；
- ID 的具体 UUID/ULID/前缀格式留到实现设计。

### 2.3 Reference 使用原则

1. Reference 只定位对象，不复制对象可变状态。
2. 可重放 Contract 必须引用不可变版本或 Snapshot。
3. Approval、Gate、Release 必须使用 ContentAddressedRef 或更强引用。
4. `latest`、`current`、标题搜索结果不能出现在冻结 Contract Payload 中。
5. Scope Hint 不是授权依据；Validator 必须解析权威对象归属。
6. 外部引用必须先经过 Adapter 和 Domain Command，不能直接满足正式业务条件。

---

## 3. Typed Reference Family

### 3.1 ScopeRef

```text
ScopeRef
├── enterpriseRef: ObjectRef<Enterprise>
└── projectRef?: ObjectRef<Project>
```

所有 Command、Query、Event 和 Core Contract 顶层必须有 ScopeRef。跨企业公共权威数据通过明确 `PUBLIC_AUTHORITY` Scope 或授权发布对象表达，不省略 Scope。

### 3.2 ObjectRef

```text
ObjectRef<T>
├── objectType
└── objectId
```

用途：定位长期对象身份，如 Enterprise、Project、Task、Artifact。

允许场景：

- 对当前 Aggregate 发 Command；
- 导航和用户界面；
- 需要在 Handler 中重新读取当前状态的 Query。

禁止场景：

- 重放历史 Run；
- 绑定 Approval/Gate/Release；
- 表达“当时使用的 Baseline/Profile/Content”。

### 3.3 VersionedRef

```text
VersionedRef<T>
├── objectType
├── objectId
└── versionId
```

用途：定位某个 Aggregate 的不可变业务版本，如：

```text
CustomerBaselineVersion
TemplateBaselineVersion
RegulatoryProfileVersion
DeliveryPlanVersion
QMSConfigurationVersion
QualityProfileVersion
```

`versionId` 必须是正式、不可变的业务版本身份。显示用 `versionLabel` 不进入引用相等性。

### 3.4 ContentAddressedRef

```text
ContentAddressedRef<T>
├── objectType
├── objectId
├── immutableVersionId?
└── contentAddress
    ├── algorithm
    ├── digest
    └── canonicalizationVersion
```

v0.1 默认 `algorithm=SHA-256`。用于：

- ArtifactRevision；
- AgentResult；
- Approval Target；
- Gate Target；
- immutable Contract Payload；
- Canonical Document/Workbook 内容。

相同 objectId/versionId 但 digest 不同是完整性异常，不能按“较新内容”接受。

### 3.5 SnapshotRef

```text
SnapshotRef<T>
├── snapshotType
├── snapshotId
├── payloadHash
├── canonicalizationVersion
└── createdAt
```

Snapshot 是多个对象、版本和裁剪规则形成的不可变复合视图，例如：

- EnterpriseProfileSnapshot；
- ProjectContextSnapshot；
- GateBundleSnapshot；
- IssueSnapshot；
- ApprovalBundleSnapshot；
- RecipientScopeSnapshot；
- ReleasePackageSnapshot。

SnapshotRef 只证明当时的复合 Payload，不代表其来源对象现在仍有效。

### 3.6 EvidenceRef

```text
EvidenceRef
├── evidence: ContentAddressedRef<Evidence>
├── evidenceLinkRef?: ObjectRef<EvidenceLink>
├── relation: SUPPORTS | CONTRADICTS | CONTEXT_ONLY
├── targetClaimRef?
│   ├── target: ContentAddressedRef
│   ├── claimLocator
│   └── claimHash
└── applicabilityScopeRef?
```

EvidenceRef 不能只保存自然语言书名或 URL。用于证明某个 Claim 时必须带 EvidenceLink/Claim 的精确引用。

### 3.7 RepresentationRef

```text
RepresentationRef
├── representationId
├── revision: ContentAddressedRef<ArtifactRevision>
├── format
├── mediaType
├── objectStorageRef
├── checksum
├── renderer
│   ├── rendererId
│   └── rendererVersion
└── createdAt
```

RepresentationRef 证明一个具体 DOCX/PDF/XLSX 等输出。它不替代 Canonical Revision。Release Readiness Gate 必须引用精确 RepresentationRef；文件名不能充当引用。

### 3.8 ReleasePackageRef

```text
ReleasePackageRef
├── releaseRef: ObjectRef<Release>
├── packageSnapshotRef: SnapshotRef<ReleasePackage>
└── packageHash
```

进入 PREPARED 后 packageHash 冻结。相同 releaseId 不允许出现第二个 packageHash。

### 3.9 PrincipalRef 与 ActorSnapshotRef

```text
PrincipalRef
├── principalKind: HUMAN | AGENT | SERVICE | RUNTIME | EXTERNAL_PARTY
└── principalId

ActorSnapshotRef
├── principalRef
├── roleSnapshotRef?
└── actingForRef?
```

PrincipalRef 表示身份；ActorSnapshotRef 表示一次行为发生时的身份与角色快照。AuthorizationDecision 使用独立引用，避免 ActorSnapshot 和 CommandEnvelope 重复保存两份可能不一致的决定。`actingForRef` 不改变 principalKind，也不获得 Human-only Capability。

### 3.10 ExternalRef

```text
ExternalRef
├── system
├── tenantOrAccountRef?
├── resourceType
├── externalId
├── observedAt
├── payloadHash?
└── adapterVersion?
```

适用：飞书消息/文件/群/话题、Runtime Session、Provider Request、对象存储 Key、外部法规 URL。ExternalRef 只提供来源/回执定位；必须由业务模块验证后才能形成 SourceMaterial、AnswerSubmission、Receipt 等正式对象。

### 3.11 Typed Alias

以下名称是对上述基础 Reference 的语义约束，不创建另一套无关结构：

```text
PolicyRef             = VersionedRef<Policy>
SchemaRef             = VersionedRef<ContractSchema>
ContextSnapshotRef    = SnapshotRef<ProjectContext>
BusinessOutputRef     = ObjectRef or ContentAddressedRef of allowed output type
RuntimeUsageRef       = ContentAddressedRef<RuntimeUsageRecord>
QualityProfileRef     = VersionedRef<QualityProfile>
ArtifactRevisionRef   = ContentAddressedRef<ArtifactRevision>
```

---

## 4. Object Type Registry

### 4.1 注册规则

每个 `objectType` 必须：

- 全局唯一；
- 由一个模块拥有；
- 一旦发布不改变语义；
- 使用稳定小写 namespace；
- 声明允许的 Reference 强度和 Scope；
- 声明是否不可变、是否版本化、是否允许作为 BusinessOutput。

命名格式：

```text
zhiju.<module>.<object>
```

### 4.2 v0.1 核心注册表

| Namespace | Owner | 代表对象 |
|---|---|---|
| `zhiju.identity.*` | IdentityPolicy | principal、role_assignment、authorization_decision、policy_snapshot |
| `zhiju.project.*` | EnterpriseProject | enterprise、project、source_material、customer_material、baseline_version、gap_analysis、delivery_item |
| `zhiju.execution.*` | TaskExecution | task、work_order、work_order_draft_snapshot、run、agent_result、information_request、context_snapshot、usage_record |
| `zhiju.artifact.*` | Artifact | artifact、artifact_revision、representation、effective_binding |
| `zhiju.quality.*` | QualityGovernance | evidence、evidence_link、quality_profile_version、gate_result、review_issue、approval |
| `zhiju.release.*` | ReleasePublication | release、release_package、publication_attempt、receipt、recall |
| `zhiju.integration.*` | IntegrationGateway | inbound_envelope、delivery_attempt、runtime_attempt、render_attempt、channel_binding |

`objectType` 注册表是 Contract Source of Truth，不从 ORM 类名或数据库表名自动生成。

---

## 5. Reference Validation Pipeline

引用验证按以下顺序执行：

```text
1. SYNTAX
   required fields / type shape / hash format
        ↓
2. TYPE REGISTRY
   objectType known + owning module
        ↓
3. RESOLUTION
   exact object/version/snapshot exists
        ↓
4. SCOPE
   authoritative Enterprise/Project ownership matches envelope
        ↓
5. INTEGRITY
   version immutability + content/payload hash match
        ↓
6. LIFECYCLE/APPLICABILITY
   target state allowed for stated purpose
        ↓
7. AUTHORIZATION
   requester may use/read/act on target
        ↓
8. CONTRACT PURPOSE
   reference type allowed in this exact field
```

Resolver 返回结构化结果：

```text
ReferenceValidationResult
├── status: VALID | INVALID | STALE | UNAVAILABLE
├── resolvedType?
├── authoritativeScopeRef?
├── immutableVersionRef?
├── verifiedHash?
├── currentLifecycle?
├── reasons[]
└── checkedAt
```

### 5.1 失败语义

```text
REFERENCE_TYPE_UNKNOWN
REFERENCE_NOT_FOUND
REFERENCE_VERSION_REQUIRED
REFERENCE_VERSION_NOT_FOUND
REFERENCE_HASH_REQUIRED
REFERENCE_HASH_MISMATCH
REFERENCE_SCOPE_MISMATCH
REFERENCE_PROJECT_MISMATCH
REFERENCE_NOT_AUTHORIZED
REFERENCE_STATE_NOT_ALLOWED
REFERENCE_PURPOSE_NOT_ALLOWED
REFERENCE_LATEST_SELECTOR_FORBIDDEN
REFERENCE_EXTERNAL_NOT_PROMOTED
REFERENCE_TARGET_STALE
```

Validator 不自动把错误引用替换为“当前版本”，也不跨企业搜索相似对象。

---

## 6. Presence、Null 与不确定性

### 6.1 Required 与 Optional

- Required 字段缺失：Contract 无效；
- Optional 字段不存在：字段应省略，不使用无意义空字符串；
- `null` 不承担 UNKNOWN、REDACTED、NOT_APPLICABLE 等多个语义；
- 空数组表示“已知集合为空”，不是“未加载”。

### 6.2 ValuePresence

需要表达不确定性或裁剪时使用：

```text
ValueEnvelope<T>
├── presence
│   ├── PRESENT
│   ├── UNKNOWN
│   ├── REDACTED
│   ├── NOT_APPLICABLE
│   └── UNAVAILABLE
├── value?: T
├── reasonCode?
├── evidenceRefs[]
└── lastVerifiedAt?
```

规则：

- PRESENT 必须有 value；
- 其他 Presence 不得偷偷携带可用 value；
- REDACTED 必须说明 Policy reason，但不能泄露被隐藏内容；
- UNKNOWN 不得被 Consumer 当作 false、0 或空集合；
- UNAVAILABLE 表示理论存在但本次无法解析/读取，应触发显式风险处理。

---

## 7. Contract Header 与完整性

所有独立 Snapshot/Contract Payload 顶层包含：

```text
ContractHeader
├── contractId
├── contractType
├── contractVersion
├── schemaRef
├── scopeRef
├── issuedAt
├── issuedBy: PrincipalRef
├── correlationId
├── causationId?
├── dataClassification
├── canonicalizationVersion
├── payloadHash
└── extensions?
```

`extensions` 每项包含：

```text
extensionType
extensionVersion
required
payload
```

未知 `required=true` Extension 必须拒绝；未知 Optional Extension 可以保留/忽略，但不能改变核心 Contract 语义。

### 7.1 Canonicalization v1

逻辑要求：

- UTF-8；
- Unicode NFC；
- 字段名称使用稳定 lowerCamelCase；
- 时间为 UTC RFC 3339，保留明确精度；
- Decimal/Money 使用十进制定点字符串，不使用二进制浮点；
- Map key 按字节序排序；
- 有业务顺序的数组保留顺序；
- 声明为 Set 的数组按稳定语义键排序并去重；
- Optional absent 字段省略；
- 顶层 `header.payloadHash` 本身不参与 Payload Hash；Contract 不允许在 Payload 内嵌指向自身的 SnapshotRef/ContentAddressedRef；
- 不包含传输层 Header、签名和压缩差异。

具体 Canonical JSON/CBOR 库留到实现，但任何实现必须对官方 Contract Fixtures 产生相同 Hash。

### 7.2 完整性与签名

v0.1 强制 Payload Hash。业务内容中引用其他对象的 Hash 正常参与计算，只有当前 Contract 顶层自有 `header.payloadHash` 被排除。数字签名/电子签名协议留到安全与持久化设计。即使后续增加签名，签名也覆盖 `contractType + contractVersion + canonical payloadHash + scopeRef`，不能只签显示文件。

---

## 8. Command、Query 与 Event Envelope

### 8.1 CommandEnvelope

```text
CommandEnvelope<P>
├── commandId
├── commandType
├── commandVersion
├── scopeRef
├── targetRef: ObjectRef
├── expectedAggregateVersion?
├── actor: ActorSnapshotRef
├── authorizationDecisionRef
├── idempotencyKey
├── correlationId
├── causationId?
├── requestedAt
├── deadline?
├── payload: P
└── integrity
    ├── canonicalizationVersion
    └── payloadHash
```

规则：

1. `commandVersion` 是 Command Schema 版本，不是 Aggregate Version。
2. 可变既有 Aggregate 的 Command 默认要求 expectedAggregateVersion。
3. 创建类 Command 的 targetRef 使用预分配 objectId 或明确 CreationTarget。
4. Handler 必须重新授权，不信任 Channel 已授权声明。
5. Command 成功表示目标 Aggregate 已提交，不表示异步副作用完成。

### 8.2 CommandResult

```text
CommandResult
├── commandId
├── status: COMMITTED | REJECTED | DUPLICATE
├── targetRef
├── resultingAggregateVersion?
├── emittedEventRefs[]
├── error?
├── completedAt
└── resultHash
```

`COMMITTED` 只表示目标 Aggregate 与 Outbox 已提交，不表示 Process Manager、Projection 或飞书投递已完成。

### 8.3 QueryEnvelope

```text
QueryEnvelope<P>
├── queryId
├── queryType
├── queryVersion
├── scopeRef
├── requester: PrincipalRef
├── authenticationContextRef
├── authorizationDecisionRef?
├── consistencyRequirement
│   ├── AUTHORITATIVE
│   ├── SNAPSHOT_AT_LEAST
│   └── PROJECTION_OK
├── minimumWatermark?
├── asOf?
├── pagination?
├── correlationId
├── requestedAt
└── payload: P
```

Query 不能隐藏写入或触发外部副作用。高风险 Command 的前置验证必须使用 AUTHORITATIVE Query/Decision，而不是陈旧 Projection。

`identity.authorize_command` Query 尚未产生 AuthorizationDecision，因此使用 authenticationContextRef 和 proposed command intent；其他 Query 可以携带已形成的 authorizationDecisionRef。Handler 仍必须按 Query Purpose 验证权限。

### 8.4 QueryResult

```text
QueryResult<T>
├── queryId
├── status: OK | NOT_FOUND | FORBIDDEN | STALE | ERROR
├── data?: T
├── snapshotAt
├── sourceWatermarks[]
├── stalenessStatus
├── redactions[]
├── nextCursor?
└── resultHash
```

`FORBIDDEN` 不得通过差异化错误泄露对象是否存在。对外 API 的具体错误折叠策略留到安全设计。

### 8.5 DomainEventEnvelope

```text
DomainEventEnvelope<P>
├── eventId
├── eventType
├── eventVersion
├── producerModule
├── aggregateType
├── aggregateId
├── aggregateVersion
├── scopeRef
├── correlationId
├── causationId
├── commandId
├── actorRef
├── occurredAt
├── dataClassification
├── payload: P
└── integrity
    ├── canonicalizationVersion
    └── payloadHash
```

规则：

- Event 名称使用已经发生的过去式；
- Event 与 Aggregate/Outbox 原子提交；
- 至少一次投递；
- 同一 Aggregate 按 aggregateVersion 有序；
- 跨 Aggregate 无全局顺序保证；
- Event Replay 不得重新创建 Human Decision 或重复外部副作用；
- Event Payload 不携带完整大文档、Secret 或 Capability Token。

---

## 9. Contract Version 与兼容性

### 9.1 版本格式

公开 Contract 使用：

```text
<major>.<minor>
```

- Major：不兼容语义或结构变化；
- Minor：向后兼容的 Optional 字段、非约束性 Metadata 或新独立 Contract Type；
- 文档勘误不改变机器 Contract Version，但要保留文档修订记录。

### 9.2 兼容性矩阵

| 变化 | Minor 允许 | Major 必须 |
|---|---:|---:|
| 新增 Optional 字段 | 是 | 否 |
| 新增 Required 字段 | 否 | 是 |
| 删除/重命名字段 | 否 | 是 |
| 改变字段语义/单位 | 否 | 是 |
| 收窄允许值或权限 | 否 | 是或新 Command |
| 新增 closed enum 值 | 否 | 是 |
| 新增声明为 open enum 的值 | 是，Consumer 必须 UNKNOWN 分支 | 否 |
| 改变 Hash/Canonicalization | 否 | 是或新 canonicalizationVersion |
| 新增独立 Event Type | 是 | 否 |
| 修改既有 Event 已发生事实语义 | 否 | 新 Event Type/Major |

### 9.3 Consumer 行为

Consumer 必须声明：

```text
supportedContractTypes
supportedMajorVersions
maximumTestedMinorVersion
openEnumCapabilities
requiredExtensions[]
```

- 未知 Major：拒绝或 Quarantine；
- 更高 Minor：只有所有新增内容为 Optional 且无未知 Required Extension 时可接受；
- 未知 Required Extension：拒绝；
- 未知 Optional Extension：保留或忽略，但不得改变核心语义；
- 不兼容 Event：停止该 Consumer 的相关流并告警，不能猜测处理。

### 9.4 Deprecation

废弃必须：

1. 发布替代 Contract Type/Version；
2. 明确 Producer 切换窗口；
3. 保留历史 Reader；
4. 提供 Contract Fixture 和迁移测试；
5. 不重写已保存的历史 Payload；
6. 完成 Consumer 兼容审计后才停止新生产。

---

## 10. 数据分类与 Contract 安全

`dataClassification` 至少支持：

```text
PUBLIC_AUTHORITY
INTERNAL
CUSTOMER_CONFIDENTIAL
RESTRICTED_PERSONAL
REGULATED
```

规则：

1. Contract 只包含完成目的所需最少数据。
2. Project Context 使用引用和裁剪内容，不默认嵌入所有客户原文。
3. AgentResult 不保存 Chain of Thought、长期 Credential 或未授权 Workspace 内容。
4. Event 不复制大文档正文；Consumer 按权限解析引用。
5. REDACTED 使用 ValuePresence，不把敏感内容放在 reason 中。
6. Payload Hash 不等于加密；敏感 Payload 仍必须使用访问控制和存储/传输保护。
7. 日志只记录 Contract ID、Type、Version、Hash 和安全摘要，不默认记录完整 Payload。
8. ExternalRef 中的 URL/ID 可能包含敏感信息，展示前仍需脱敏。

---

## 11. 七个模块的公开 Contract Catalog

Catalog 只定义业务名称与所有权；字段级 Payload 由对应 Module Contract 在 API 设计阶段从本 Catalog 派生，不得重新发明语义。

Catalog 中的 `name@1.0` 只是文档简写。Envelope 中必须分开保存：

```text
commandType / queryType / eventType = name
commandVersion / queryVersion / eventVersion = 1.0
```

不得把 `@1.0` 拼入 Aggregate ID 或数据库主键。

### 11.1 IdentityPolicy

Commands：

```text
identity.register_principal@1.0
identity.link_external_identity@1.0
identity.assign_role@1.0
identity.revoke_role@1.0
identity.grant_capability@1.0
identity.revoke_capability@1.0
identity.record_policy_snapshot@1.0
identity.record_policy_version@1.0
```

Queries：

```text
identity.resolve_principal@1.0
identity.authorize_command@1.0
identity.check_enterprise_access@1.0
identity.check_project_access@1.0
identity.check_human_only_capability@1.0
identity.get_policy_snapshot@1.0
identity.resolve_policy@1.0
```

Events：

```text
identity.PrincipalRegistered@1.0
identity.ExternalIdentityLinked@1.0
identity.RoleAssigned@1.0
identity.RoleRevoked@1.0
identity.CapabilityGranted@1.0
identity.CapabilityRevoked@1.0
identity.PolicySnapshotRecorded@1.0
```

`AuthorizationDenied` 默认是安全审计事件，不作为跨模块业务流程触发器。

### 11.2 EnterpriseProject

Commands：

```text
project.create_enterprise@1.0
project.propose_enterprise_fact@1.0
project.confirm_enterprise_fact@1.0
project.create_project@1.0
project.register_source_material@1.0
project.accept_source_material@1.0
project.propose_customer_material@1.0
project.confirm_customer_material@1.0
project.create_customer_baseline_draft@1.0
project.activate_customer_baseline_version@1.0
project.freeze_template_baseline@1.0
project.activate_regulatory_profile@1.0
project.start_gap_analysis@1.0
project.accept_gap_analysis@1.0
project.create_delivery_plan_draft@1.0
project.approve_delivery_plan@1.0
project.activate_delivery_plan@1.0
project.evaluate_delivery_item_completion@1.0
project.capture_context_source_slice@1.0
```

Queries：

```text
project.get_project_context_source@1.0
project.get_context_source_slice@1.0
project.get_resolution_receipt@1.0
project.get_enterprise_profile_snapshot@1.0
project.get_active_baseline_refs@1.0
project.get_delivery_item_criteria@1.0
project.validate_object_scope@1.0
project.get_project_board_slice@1.0
```

Events：

```text
project.SourceMaterialAccepted@1.0
project.CustomerMaterialConfirmed@1.0
project.CustomerBaselineVersionActivated@1.0
project.GapAnalysisAccepted@1.0
project.DeliveryPlanActivated@1.0
project.DeliveryItemActivated@1.0
project.DeliveryItemCompletionSatisfied@1.0
project.DeliveryItemImpactReviewRequested@1.0
```

### 11.3 TaskExecution

Commands：

```text
execution.create_task@1.0
execution.create_task@2.0
execution.mark_task_ready@1.0
execution.build_task_readiness@1.0
execution.validate_work_order_draft@1.0
execution.create_work_order@1.0
execution.create_work_order@1.1
execution.freeze_work_order@1.0
execution.queue_work_order@1.0
execution.build_context_snapshot@1.0
execution.build_initial_context_snapshot@1.0
execution.build_initial_context_snapshot@1.1
execution.create_run@1.0
execution.start_run@1.0
execution.request_run_cancel@1.0
execution.record_runtime_input_required@1.0
execution.submit_agent_result@1.0
execution.accept_agent_result@1.0
execution.open_information_request@1.0
execution.record_information_delivery@1.0
execution.submit_information_answer@1.0
execution.resolve_information_request@1.0
execution.schedule_work_order_retry@1.0
execution.evaluate_work_order_completion@1.0
execution.evaluate_task_completion@1.0
```

Queries：

```text
execution.get_work_order_contract@1.0
execution.get_work_order_draft@1.0
execution.get_work_order_draft@1.1
execution.get_work_order_draft@2.0
execution.get_context_snapshot@1.0
execution.get_run_state@1.0
execution.get_agent_result@1.0
execution.get_information_request@1.0
execution.get_usage_and_provenance@1.0
execution.get_task_board_slice@1.0
```

Events：

```text
execution.TaskReady@1.0
execution.WorkOrderBecameReady@1.0
execution.WorkOrderQueued@1.0
execution.ContextSnapshotBuilt@1.0
execution.ContextSnapshotBuilt@1.1
execution.RunStarted@1.0
execution.RunTerminated@1.0
execution.AgentResultAccepted@1.0
execution.InformationRequestOpened@1.0
execution.InformationRequestResolved@1.0
execution.WorkOrderCompleted@1.0
execution.TaskCompleted@1.0
```

### 11.4 Artifact

Commands：

```text
artifact.create_artifact@1.0
artifact.update_artifact_metadata@1.0
artifact.create_and_seal_revision@1.0
artifact.create_merge_revision@1.0
artifact.move_working_head@1.0
artifact.register_representation@1.0
artifact.withdraw_revision@1.0
artifact.invalidate_revision@1.0
artifact.record_approved_revision_binding@1.0
artifact.record_effective_binding@1.0
artifact.supersede_effective_binding@1.0
artifact.archive_artifact@1.0
```

Queries：

```text
artifact.get_artifact@1.0
artifact.get_revision_snapshot@1.0
artifact.get_revision_lineage@1.0
artifact.get_revision_diff_inputs@1.0
artifact.validate_revision_ref@1.0
artifact.get_representation@1.0
artifact.get_effective_binding@1.0
```

Events：

```text
artifact.ArtifactCreated@1.0
artifact.ArtifactRevisionSealed@1.0
artifact.MergeRevisionCreated@1.0
artifact.RevisionInvalidated@1.0
artifact.RepresentationRegistered@1.0
artifact.ApprovedRevisionBindingRecorded@1.0
artifact.EffectiveBindingChanged@1.0
```

### 11.5 QualityGovernance

Commands：

```text
quality.capture_evidence_candidate@1.0
quality.verify_evidence@1.0
quality.revoke_evidence@1.0
quality.create_evidence_link@1.0
quality.create_quality_profile_draft@1.0
quality.activate_quality_profile@1.0
quality.record_gate_result@1.0
quality.record_reused_gate_result@1.0
quality.invalidate_gate_result@1.0
quality.raise_review_issue@1.0
quality.propose_issue_resolution@1.0
quality.verify_issue_resolution@1.0
quality.close_review_issue@1.0
quality.request_approval@1.0
quality.submit_approval_decision@1.0
quality.revoke_approval@1.0
quality.evaluate_revision_readiness@1.0
quality.evaluate_release_gate_readiness@1.0
```

Queries：

```text
quality.get_evidence@1.0
quality.get_quality_profile@1.0
quality.get_gate_plan@1.0
quality.get_gate_results@1.0
quality.get_open_blocking_issues@1.0
quality.get_revision_acceptance_snapshot@1.0
quality.get_approval_bundle_snapshot@1.0
quality.get_release_readiness_snapshot@1.0
quality.get_revision_execution_eligibility@1.0
```

Events：

```text
quality.EvidenceVerified@1.0
quality.EvidenceRevoked@1.0
quality.QualityProfileActivated@1.0
quality.GateResultRecorded@1.0
quality.BlockingReviewIssueRaised@1.0
quality.ReviewIssueClosed@1.0
quality.RevisionQualityReady@1.0
quality.RevisionFullyApproved@1.0
quality.RevisionApprovalLost@1.0
quality.ReleaseGateReady@1.0
quality.ReleaseGateReadinessLost@1.0
```

### 11.6 ReleasePublication

Commands：

```text
release.create_release_draft@1.0
release.select_representations@1.0
release.set_destinations@1.0
release.prepare_release@1.0
release.validate_release_readiness@1.0
release.authorize_release@1.0
release.start_publication_attempt@1.0
release.record_publication_receipt@1.0
release.record_publication_failure@1.0
release.complete_release@1.0
release.recall_release@1.0
release.cancel_release@1.0
```

Queries：

```text
release.get_release@1.0
release.get_frozen_package@1.0
release.get_publication_attempts@1.0
release.get_release_receipts@1.0
release.get_release_impact@1.0
```

Events：

```text
release.ReleasePrepared@1.0
release.ReleaseAuthorized@1.0
release.PublicationAttemptRequested@1.0
release.PublicationSucceeded@1.0
release.PublicationFailed@1.0
release.ReleasePartiallyCompleted@1.0
release.ReleaseCompleted@1.0
release.ReleaseRecalled@1.0
```

### 11.7 IntegrationGateway

Commands：

```text
integration.accept_inbound_envelope@1.0
integration.bind_channel_context@1.0
integration.request_feishu_delivery@1.0
integration.request_runtime_dispatch@1.0
integration.request_runtime_cancel@1.0
integration.request_runtime_resume@1.0
integration.request_render@1.0
integration.record_external_receipt@1.0
integration.quarantine_external_event@1.0
```

Queries：

```text
integration.get_channel_binding@1.0
integration.get_delivery_attempt@1.0
integration.get_runtime_attempt@1.0
integration.get_render_attempt@1.0
integration.get_render_attempt_binding@1.0
integration.get_adapter_health@1.0
```

Events：

```text
integration.InboundEnvelopeAccepted@1.0
integration.InboundEnvelopeRejected@1.0
integration.ChannelAnswerReceived@1.0
integration.ChannelDeliverySucceeded@1.0
integration.ChannelDeliveryFailed@1.0
integration.RuntimeDispatchSucceeded@1.0
integration.RuntimeDispatchFailed@1.0
integration.RenderSucceeded@1.0
integration.RenderFailed@1.0
```

Integration Event 只能报告外部事实或适配结果；它不能发布 `TaskCompleted`、`ApprovalBecameEffective` 或 `ReleaseCompleted`。

`integration.record_external_receipt` 只保存 Adapter 观察到的原始外部回执；它不能满足 Release。ReleasePublication 必须验证 releaseId、destination、packageHash 和 Attempt 后，再通过 `release.record_publication_receipt` 创建正式发布事实。

---

## 12. Catalog 所有权与依赖检查

### 12.1 唯一写所有权

| 业务状态 | 唯一 Command Owner |
|---|---|
| Principal/Role/Capability | IdentityPolicy |
| Enterprise/Project/Baseline/Plan/DeliveryItem | EnterpriseProject |
| Task/WorkOrder/Run/Result/InformationRequest | TaskExecution |
| Artifact/Revision/Representation/EffectiveBinding | Artifact |
| Evidence/Gate/Issue/Approval | QualityGovernance |
| Release/Publication/Receipt/Recall | ReleasePublication |
| External Envelope/Attempt/Adapter Binding | IntegrationGateway |

Catalog 中如果未来出现两个模块拥有同一状态写 Command，必须先通过 Architecture Decision 调整所有权，不能让两个 Handler 竞争更新。

### 12.2 跨模块调用示例

```text
release.ReleasePrepared
    ↓ QualityGovernance Consumer
quality.evaluate_release_gate_readiness
    ↓
quality.ReleaseGateReady
    ↓ ReleasePublication Consumer
release.validate_release_readiness
```

```text
execution.InformationRequestOpened
    ↓ IntegrationGateway Consumer
integration.request_feishu_delivery
    ↓
integration.ChannelDeliverySucceeded
    ↓ TaskExecution Consumer
execution.record_information_delivery
```

Consumer 不能因为收到 Event 就直接写本模块以外的 Repository。

---

## 13. Typed Reference 与 Envelope 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| TR-U-001 | Unit | WorkOrder 输入使用 `latest` CustomerBaseline | 拒绝 `REFERENCE_LATEST_SELECTOR_FORBIDDEN` | NOT RUN：设计阶段 |
| TR-U-002 | Unit | 把 aggregateVersion=8 当作 baseline versionId | Schema/Type 验证拒绝 | NOT RUN：设计阶段 |
| TR-U-003 | Unit | ContentAddressedRef ID 相同但 digest 不同 | 拒绝 `REFERENCE_HASH_MISMATCH` | NOT RUN：设计阶段 |
| TR-U-004 | Unit | Project A Contract 引用 Project B 私有 Revision | 拒绝 `REFERENCE_PROJECT_MISMATCH` | NOT RUN：设计阶段 |
| TR-U-005 | Unit | UNKNOWN ValueEnvelope 携带可用 value | Contract 无效 | NOT RUN：设计阶段 |
| TR-U-006 | Unit | 相同 Command idempotencyKey、不同 payloadHash | 拒绝并产生一致性安全事件 | NOT RUN：设计阶段 |
| TR-U-007 | Unit | Consumer 收到未知 Contract Major | 拒绝/Quarantine，不猜测执行 | NOT RUN：设计阶段 |
| TR-U-008 | Unit | Query 声明 PROJECTION_OK 用于高风险 Approval 前置验证 | Approval Handler 仍要求 AUTHORITATIVE Decision | NOT RUN：设计阶段 |
| TR-E-001 | E2E | Project Context 引用 CB-003，随后 CB-004 激活 | 旧 Context 仍解析 CB-003 并保持 payloadHash | NOT RUN：设计阶段 |
| TR-E-002 | E2E | Release Package 的 PDF 被替换但文件名相同 | checksum/packageHash 不匹配，Render/Release Readiness 失效 | NOT RUN：设计阶段 |
| TR-E-003 | E2E | Event Consumer 崩溃后重放同一 eventId | Inbox/Command 幂等，不重复业务写入或外部副作用 | NOT RUN：设计阶段 |
| TR-E-004 | E2E | 飞书 messageId 被直接作为 ApprovalRef | 类型注册/目的验证拒绝；必须经正式 Approval Command | NOT RUN：设计阶段 |

---

## 14. 实现前待确认（历史基准决策项）

1. Core ID 第一版使用 UUIDv7、ULID 还是带前缀的 opaque ID；
2. Canonicalization v1 的具体标准库和跨语言 Fixture；
3. SHA-256 是否满足全部客户/监管场景，是否预留算法升级字段；
4. Contract Schema Registry 存储和发布方式；
5. 支持的 Major Version 并行窗口与弃用周期；
6. 哪些 enum 声明为 open enum；默认建议全部业务状态 enum 为 closed；
7. Query Pagination Cursor 的签名、防篡改和有效期；
8. AuthorizationDecisionRef 的保留期限与离线验证能力；
9. ExternalRef 中 URL、飞书 ID 和 Provider ID 的脱敏规则；
10. Contract 最大 Payload、数组上限和 Context 内容预算；
11. 是否在 v0.1 对高风险 Approval/Release Contract 增加服务端数字签名；
12. Schema/API 阶段对哪些 Query 强制 AUTHORITATIVE，哪些允许 Projection；
13. Catalog 中哪些低层内部 Domain Event 不对模块外公开；本文只列跨模块核心事件；
14. Object Type Registry 是否由构建期代码生成校验，还是由静态声明文件驱动。

---

## 15. 结论

Typed Reference 将“某个对象”拆成可验证的引用强度：

```text
ObjectRef
    身份

VersionedRef
    精确业务版本

ContentAddressedRef
    精确不可变内容

SnapshotRef
    精确复合视图

Evidence/Representation/Package Ref
    特定业务目的下的强引用
```

统一 Envelope 和公开 Catalog 则保证 Human、Agent、飞书、Runtime、模块内服务和未来 API 使用同一个业务语言，同时不把传输协议、数据库模型或 Harness Session 泄漏进 Domain Contract。

## 16. Issue #57 受控 Capability 不进入 Catalog

Issue #57 已为 Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和 Platform Template/Regulatory Reference 冻结 EnterpriseProject Owner 的受控 Application Capability；逻辑名称、输入/输出、授权目的和错误码见 [EnterpriseProject Capability 决策](../decisions/enterprise-project-capabilities.md)。

这些 Capability 目前不是本 Catalog 的 `name@1.0` 条目；本历史段落记录 IM-04 WI-01 的独立 `integration.get_render_attempt_binding@1.0` 增量曾将 Catalog 变更为 201 个公开 Contract，当前 Catalog 已为 216 项，Module Spec/Registry/生成类型集合必须保持同步。它们不得被测试、Migration 或跨 Schema Join 当作隐式公共入口。只有用户另行批准公共化后，才可按 API Contract 的兼容性流程新增公开名称并同步所有生成与负向验证产物。

## IM-06 注册与未注册设计路由

当前 Catalog 为 217 项：#157 注册 Source Slice capture/read 两项，#158 注册 WorkOrder Draft read 与 initial Context build 两项，#165 在旧 @1.0 合法调用之外新增三个 @1.1 兼容操作，#175 注册 `execution.create_task@2.0`，#176 的 Policy 版本解析两项（`identity.record_policy_version@1.0`、`identity.resolve_policy@1.0`）已由 #183 完成静态契约注册（Schema/Registry/PayloadGuard/生成类型；Handler、授权与持久化仍 NOT RUN），#189 完成两个首版 Evaluator profile 选择器的构建期静态注册与纯解析（不新增公开 operation，计数不变），#191 注册 `project.get_resolution_receipt@1.0`（静态契约、Handler、授权、V2015 持久化与精确可重算 backfill 由 #191 交付；TE 消费仍 NOT RUN），#192 注册 `quality.get_revision_execution_eligibility@1.0`（静态契约、Handler、Purpose 授权边界与真实 PostgreSQL 正反例由 #192 交付；本模块条目由 37 增至 38，TE Completion 消费与跨模块业务链仍 NOT RUN），#208 注册 `execution.build_task_readiness@1.0`（静态契约、Registry 条目、生成类型与构建期注册断言，以及 `zhiju.execution.task_readiness`、`zhiju.execution.task_definition_snapshot`、`zhiju.execution.evaluator_profile` 三个 objectType 由 #208 交付；本模块条目由 43 增至 44，`execution.mark_task_ready@1.0` 零改动），#210 注册 `execution.get_work_order_draft@2.0`（静态契约、Registry 条目、生成类型与构建期注册断言由 #212 交付；本模块条目由 44 增至 45，`execution.create_work_order@1.0`/`@1.1` 与 `execution.get_work_order_draft@1.0`/`@1.1` 零改动），#217 注册 additive `execution.ContextSnapshotBuilt@1.1`（冻结 `@1.0`、修正路径独占发布 `@1.1`；本模块条目由 45 增至 46，compatibility minor findings 由 80 增至 82，Baseline 200 不变），#219 注册 `execution.validate_work_order_draft@1.0`（静态契约、Registry 条目、生成类型与构建期注册断言，以及 `zhiju.execution.work_order_validation`、`zhiju.contract.work_order` 两个 objectType 由 #219 交付；本模块条目由 46 增至 47，compatibility minor findings 由 82 增至 86，Baseline 200 不变，Freeze/get/READY Event 零改动），其余未交付设计继续不计入 Registry。#152–#154技术增量的精确字段与名称在[TaskExecution Spec §11](../module-specs/Module-Spec-003-TaskExecution.md#11-im-06-技术设计)、[IntegrationGateway Runtime Binding](../module-specs/Module-Spec-007-IntegrationGateway.md#im-06-runtime-binding-query-设计)、[EnterpriseProject Source/Receipt](../module-specs/Module-Spec-002-EnterpriseProject.md#im-06-source-slice-与-resolution-receipt-设计)、[Quality当前资格](../module-specs/Module-Spec-005-QualityGovernance.md#im-06-revision-当前执行资格-query-设计)。TD-01–04已获批准；其余选定 operation type/version/Owner 与新增 Ref 类型将在对应实现修订纳入可执行 Catalog 并生成 Schema，批准设计与运行时注册状态分别记录。Runtime专项六项提案保持独立未注册状态，不能混入本轮设计计数。

### #214 初始 Context 组装的 objectType 注册

#214（TD-01 设计 Delta，见 [Spec 003 §19](../module-specs/Module-Spec-003-TaskExecution.md#19-首次-context-构建与精确快照读取边界闭合214-设计)）additive 注册以下 objectType，供 TaskExecution 组装 ProjectContext v1.0 时把 #188 Source Slice 内已发布的 Enterprise Fact VERSIONED 身份规范化为 Core-valid `subjectRef`。本项不新增公开 operation、不改写既有 `EnterpriseFact` legacy 拼写的既有接受集合，Catalog 215、TaskExecution 45 与历史 200 项 Compatibility Baseline 不变；executable 注册已由 [Issue #216](https://github.com/qzhike/zhiju-business-core/issues/216) 于 2026-09-19 交付（`contracts/src/operation-registration.ts` 注册增量、`assertInitialContextEnterpriseFactRegistration()` 构建期断言接入 `ContractRegistry` 构造与 `tools/contracts/generate-public-api.mjs`、回归 `contracts/src/enterprise-fact-registration.test.ts`；裸 objectType 注册无 Schema/生成类型产物），本地/持久化证据完成，`vibe verify full --json` 已 PASS（2026-09-19）。PR #217 的独立实现审查曾得出 `PLANNING_REQUIRED`；Event 契约阻断已由文末 #217 小节的 additive 修正实现（2026-09-20 注册并发布 `@1.1`；verify full 已 PASS 2026-09-20，新 head 复审待完成），本 objectType 注册事实不变。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| zhiju.project.enterprise_fact | enterprise-project | VERSIONED；Enterprise Scope | 既有 Enterprise Fact 版本身份（`project.propose_enterprise_fact@1.0`/`project.confirm_enterprise_fact@1.0` 创建）；本项只注册 canonical 拼写供跨模块规范化引用，不改变生命周期、不新增 operation；否 |

### #157 ContextSourceSlice 注册

Owner 为 EnterpriseProject；两项操作完整注册 Envelope/Payload、read Result、生成类型和技术 Guard。具体字段与授权声明见 [Spec 002](../module-specs/Module-Spec-002-EnterpriseProject.md#157-注册元数据绑定)，资源约束见 [共享 API](../api-contract-v0.1/API-Contract-v0.1.md#157-payloadguard-注册补充方案)。#157 阶段在原 201 项上净增 2，历史 200 项 Compatibility Baseline 不改写；Handler、授权和持久化验收仍为 NOT RUN。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| zhiju.project.context_source_slice | enterprise-project | OBJECT（CREATE target）、CONTENT_ADDRESSED（已提交输入）；Project Scope | 不可变；不另建可变版本；否 |
| zhiju.project.project | enterprise-project | OBJECT；Project Scope | 既有 Project 身份；本项不改变生命周期；否 |
| zhiju.identity.policy | identity-policy | VERSIONED；按既有 Policy Scope | 既有 Policy 版本身份；不创建业务 Policy；否 |

PrincipalRef 复用 §3.9 的 `{principalKind,principalId}`，元数据归属标识 zhiju.identity.principal 不作为额外 payload 字段。Source View 内部引用继续沿用既有定义；此表不改写旧 Schema 已接受的内部/历史名称。

### #158 WorkOrder Draft 与首次 Context 注册

Owner 为 TaskExecution；`execution.get_work_order_draft@1.0` 是 AUTHORITATIVE Query，读取精确 `WorkOrderDraftSnapshot`；`execution.build_initial_context_snapshot@1.0` 是 CREATE Command，目标为 `ContextSnapshot`。两项操作使用显式 Purpose、Typed Ref objectType 和完整 Payload/Result Schema，当前没有额外获批的 PayloadGuard 技术 Policy；Handler、期限继承、引用存在性、授权和持久化验收仍为 NOT RUN。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| zhiju.execution.work_order_draft_snapshot | task-execution | CONTENT_ADDRESSED；Project Scope | 不可变；不另建可变版本；否 |
| zhiju.execution.context_snapshot | task-execution | OBJECT（CREATE target）、SNAPSHOT（结果）；Project Scope | 不可变；Snapshot；否 |

### #165 DRAFT VersionPins 与首次 Context 的 @1.1 注册

Owner 仍为 TaskExecution；新增三个与旧 @1.0 并存的 @1.1 operation。`InitialWorkOrderDraft` 复用旧 Draft 的业务字段，但使用独立 `DraftVersionPins`，必填 `contextBuilderPolicyRef`、`workOrderSchemaRef`、`skillRefs`、`templateRefs`、`capabilityPolicyRef`、`runtimeAdapterContractRef`，可选 `regulatoryProfileRef` 与 `qualityProfileRef`，且明确不包含 `projectContextContractRef`。只有 CTX-1 成功提交后，候选 Frozen WorkOrder Contract 才补入完整 Context Ref；顶层 `contextSnapshotRef` 与嵌套 `versionPins.projectContextContractRef` 必须在 object type、object/snapshot identity、Scope 和 contentHash 全字段上完全相等。旧 @1.0 操作与历史 Core WorkOrder 形状保持兼容；本项的 Handler、migration、真实 PostgreSQL 业务链与运行验收仍为 NOT RUN。

### #166 Context Builder Policy binding

本项不新增 objectType 或公开 operation；复用已注册的 `zhiju.identity.policy`：Owner 为 IdentityPolicy，Reference 为 `VersionedRef<Policy>`，Scope 遵循 Policy 权威 Scope。WI-02 新入口、ProjectContext projection、Context build metadata 与 Frozen WorkOrder VersionPins 必须绑定同一对象类型、对象 ID、`versionId` 和 Scope。

通用 `VersionedRef` 不内嵌 `contentHash`。`context_snapshot_build` metadata 保存 IdentityPolicy exact snapshot 的 `contentHash`、`effectiveFrom` 和可选 `supersededAt`，消费端将其与当前 Policy 解析逐项比较；这不是另一个 Policy namespace，也不创建业务 Policy。`zhiju.context.policy` 仅是历史 Core fixture/兼容读回边界，`identity.policy` 等未注册名称不得由新 WI-02 入口产生。

### #167 Initial Context Result 与 canonical SnapshotRef

本项不新增 objectType 或公开 operation；`execution.build_initial_context_snapshot@1.0` 与 `@1.1` 新增显式 `resultSchemaRef`，用于返回 operation-specific CommandResult data。返回的 `data.contextSnapshotRef` 是 `SnapshotRef<ProjectContextContract>`，唯一使用已注册的 `zhiju.execution.context_snapshot`（Owner 为 TaskExecution，Project Scope，不可变 Snapshot 身份），不接受任何未注册 namespace。

SnapshotRef 的全部字段（`kind`、`objectType`、`objectId`、`snapshotId`、`scope`、`contentHash`）都进入 Result Schema 与跨字段绑定比较；`targetRef` 与返回 Ref 必须按 canonical objectType、objectId 和 Scope 相等，不能只按 objectId 关联。`zhiju.execution.context_snapshot` 的 Project Scope 是必填成员：新增 Result Ref Schema 要求 `enterpriseId` 与 `projectId` 同时存在，canonical 绑定同样拒绝空 Scope 或 enterprise-only Scope；共享 `ScopeRef` 与既有 Query 的接受集合不因此改变。`zhiju.project.context_snapshot` 仅是 Core v1.0 历史读回身份与历史 fixture 值，不由新入口产生，也不与 canonical 名称互换。`execution.get_context_snapshot@1.0` 的既有 Schema/接受集合不变，其请求 Ref 与结果 Ref 必须逐字段相等；返回引用指向未提交 Snapshot 或重放异 Hash 由 Handler 拒绝，保持 `NOT RUN`。

### #176 Policy 版本解析注册

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / CONTRACT REGISTERED 2026-09-13 / HANDLER NOT IMPLEMENTED`。Owner 为 IdentityPolicy；本项按 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖) 新增两个入口：`identity.record_policy_version@1.0`（企业级版本事实，注册 operation-specific Result Schema 返回 `{policyVersionRef}`）与只读 AUTHORITATIVE Query `identity.resolve_policy@1.0`（Purpose `identity.policy.resolve_policy`）。两者已由 #183 按完整 Envelope、Payload/Result Schema、两个 Registry 与共享 `identity.policy_version@1.0` PayloadGuard 静态注册：Catalog 由 209 增至 211 项，本模块公开条目由 20 增至 22；历史 200 项 Compatibility Baseline 与旧 `record_policy_snapshot@1.0` 条目均未重写。Handler、授权路径、scoped 事实表与真实 PostgreSQL 业务链仍为 `NOT IMPLEMENTED / NOT RUN`，因此本节的静态注册不构成公开 HTTP 或业务链可用。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| `zhiju.identity.policy` | identity-policy | VERSIONED；企业 Scope（`enterpriseId` 必填，`projectId` 可选） | 既有 Policy 版本身份；新入口把该版本键与已提交的 scoped 版本事实建立唯一绑定；仍不创建业务 Policy；否 |
| `zhiju.identity.policy_version` | identity-policy | OBJECT（CREATE target）、SNAPSHOT（解析结果与正文）；Enterprise/Project Scope（与版本键 Scope 逐字段相等） | 新增不可变版本事实；`objectId==snapshotId`；只存在于带 Scope 的 FORCE RLS 新表；否 |

`resolve_policy` 的 payload 固定 VERSIONED/`zhiju.identity.policy`，结果固定 SNAPSHOT/`zhiju.identity.policy_version`，并在同一次授权读取中返回 `policyDocument`。既有 Platform `identity.policy_snapshot` 身份、其 `get_policy_snapshot@1.0` 读回路径与 RLS 不变，也不被新入口写入；Core fixture 中出现的历史拼写 `zhiju.identity.policy_snapshot` 只作兼容读回材料，不由新入口产生，也不在解析实现中被静默改写。首版 profile 的 registry key 与 canonical typed ref（`ep.context_source_slice_capture.policy@1.0`、`execution.context_builder.policy@1.0`、`execution.task_readiness.policy@1.0`、`execution.work_order_validation.policy@1.0`）以新的构建期 registry 版本承载，既有 `im02-static-v1` 条目与旧命令接受集合不变。两个新操作按 #157 规则声明共享的有限额构建期 PayloadGuard 技术 Policy `identity.policy_version@1.0`；完整七项参数按 #181 已批准值注册（`maxEnvelopeBytes=262144`、`maxResultBytes=266240`、`maxStringCodePoints=16384`、`maxArrayItems=1024`、`maxObjectProperties=256`、`maxDepth=32`、`maxRequestedKinds=64` 并对两个操作不适用），SD-181-1 的时刻长度约束由这两个操作自己的 Schema 执行。TD-01–04 的既有边界、`zhiju.execution.*`/`zhiju.project.*` 已有映射与旧操作接受集合不因本项改变。

### #189 首批 Evaluator profile 注册

状态：`#176 TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / BUILD-TIME REGISTRATION IMPLEMENTED 2026-09-14 (#189) / EVALUATOR NOT IMPLEMENTED`。Owner 为 TaskExecution；本项**不新增公开 operation**，Catalog 保持该增量前的 211 项，`operationCount` 不因选择器增加。两个首版 profile 选择器以新的构建期 registry 版本 `im06-evaluator-static-v1`（`contracts/registry/evaluator-profiles.v1.json`；生成副本 `contracts/src/generated/evaluator-profiles.json` 与注册源字节一致，漂移使构建失败）承载：`te.task_readiness.evaluator@1.0`、`te.work_order_validation.evaluator@1.0`。

registry key 与 canonical typed ref 一一对应：未知 key/objectType/objectId/versionId、非空 Scope、错 kind、重复 key/身份、缺条目、错误 owner 与未知 registry 版本一律 fail closed；纯解析只做 `kind`/`objectType`/`objectId`/`versionId`/`scope` 全字段精确匹配，不做 latest/回退，也不只比较字符串尾缀或 `versionId`。既有 `im02-static-v1`、`im06-static-v1`、旧命令接受集合与 200 项历史 Compatibility Baseline 均不改变。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| `zhiju.execution.evaluator_profile` | task-execution | VERSIONED；Platform Scope（`scope={}`，不携带 `contentHash`） | 构建期静态身份，无数据库行、不参与 Policy 版本生命周期；否 |

Evaluator 确定性实现、解析调用点、`validUntil` 推导、判断产出与 `EXECUTION_CRITERION_UNSUPPORTED` 映射仍 `NOT IMPLEMENTED / NOT RUN`：纯解析的空结果只是后续 owning Handler 的输入，本项不据此产生任何判断、冻结或 READY 事实。

### #175 Task v2 create 注册

Owner 为 TaskExecution；新增一个与旧 @1.0 并存的 `execution.create_task@2.0` Command，Target 固定 `zhiju.execution.task`（OBJECT、CREATE），Purpose 为 `execution.task.create`。本项不新增 objectType：复用已注册的 `zhiju.execution.task` 与 `zhiju.project.project`，payload 的 `projectRef` 固定为 canonical `zhiju.project.project`；`initialAssignee` 沿用既有开放形状，`evaluatorRef` 沿用通用 `VersionedRef`（与 Core `completionCriterion.evaluatorRef` 一致），故上表无新增行。

`TaskDefinitionV2` 的字段集合与历史 `TaskDefinition` 相同：`expectedOutputSpec` 与 `completionCriteria` 两个开放 `CanonicalJson` 成员替换为注册的 closed shape（`ExpectedOutput[]`，复用 Core `ExpectedOutput`；非空 criterion 集合），`inputRefs` 按 §2 的已批准 `TypedReference[]` 注册为普通数组而不复用 @1.0 payload 的 `uniqueItems` 历史偏差（`dependencyTaskRefs` 仍为 Set）。五类 `TaskCriterionV1` 的 closed Schema、criterionType 与三个 bindings 分支的一一对应、未知字段与任意 `expectedCondition` 表达式由注册 Schema 拒绝；重复 criterionId、重复 outputSlot 与未解析的 output-slot 绑定由纯契约校验 `validateTaskDefinitionBinding` 拒绝。`create_task@1.0` 的 Schema、历史 fixture 与接受集合不变，历史 200 项 Compatibility Baseline 不重写；Evaluator 存在性/支持版本、Policy 有效性、真实授权以及 Task Handler、业务持久化、Readiness/Completion 与业务 E2E 仍为 `NOT IMPLEMENTED / NOT RUN`。

### #191 Resolution Receipt 注册

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 (TD-04) / SCHEMA, REGISTRY, GENERATED TYPES, FIXTURES, HANDLER, AUTHORIZATION, V2015 PERSISTENCE AND EXACT BACKFILL IMPLEMENTED 2026-09-14 (#191) / TE CONSUMPTION NOT RUN`。Owner 为 EnterpriseProject；新增一个只读 AUTHORITATIVE Query `project.get_resolution_receipt@1.0`（Purpose `project.resolution_receipt.read`，`dataClassification=CUSTOMER_CONFIDENTIAL`，无独立构建期 PayloadGuard 技术 Policy），Catalog 由 211 增至 212 项，本模块公开条目由 34 增至 35。历史 200 项 Compatibility Baseline 与旧 `project.*` 条目均未重写。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| `zhiju.project.command_receipt` | enterprise-project | CONTENT_ADDRESSED；Project Scope | 每命令一份不可变规范 Receipt 材料的事实身份；不另建可变版本；否 |
| `zhiju.project.customer_material` | enterprise-project | OBJECT（确认目标）、VERSIONED（candidate/confirmed version）；Project Scope | 既有 CustomerMaterial Root/不可变版本身份；本项不改变其生命周期；否 |
| `zhiju.project.source_material` | enterprise-project | CONTENT_ADDRESSED；Project Scope | 既有已接受 SourceMaterial 身份；selection 的 Hash 为原始 bytes 内容 Hash；否 |
| `zhiju.project.business_decision` | enterprise-project | CONTENT_ADDRESSED；Project Scope | 既有 CustomerMaterial confirmation Decision 事实；Hash 为 Decision payload 的规范 Hash；否 |
| `zhiju.identity.actor_snapshot` | identity-policy | OBJECT；Project Scope | 既有 ActorSnapshot 身份；EP 只记录并返回其精确身份，不声明其内容 Hash；否 |
| `zhiju.identity.authorization_decision` | identity-policy | OBJECT；Project Scope | 既有 AuthorizationDecision 身份；EP 只记录并返回其精确身份，不声明其内容 Hash；否 |
| `zhiju.identity.principal` | identity-policy | PRINCIPAL（`actorRef`）；无独立 Scope | 既有 PrincipalRef 形状；confirmation 为 Human-only，`principalKind` 精确为 `HUMAN`；否 |

Query payload 固定 `{commandReceiptRef}`（CONTENT_ADDRESSED/`zhiju.project.command_receipt`，id + 完整 ContentHash + Project Scope）；Result 固定 `ResolutionReceiptAttestation`：`commandReceiptRef, commandType: 'project.confirm_customer_material', commandVersion: '1.0', targetRef, scopeRef, requestPayloadHash, outcome: 'COMMITTED', candidateVersionRef, confirmedVersionRef, sourceMaterialRefs, decisionRef, actorRef, actorSnapshotRef, authorizationDecisionRef, committedAt`，`sourceMaterialRefs` 为非空去重集合。

`commandReceiptRef.contentHash` 是**持久化规范 Receipt payload 的规范 Hash**（command identity、完整 Scope/target、request hash、candidate/confirmed/decision/source 引用、outcome、actor、committedAt），不是原命令 request payload Hash；actor 与 AuthorizationDecision 只按精确身份绑定，因为其 payload Hash 由 IdentityPolicy 拥有、不属于 EnterpriseProject 的不可变记录，且历史确认必须能仅由 EP owning 事实精确重算。ActorSnapshot/AuthorizationDecision 的 Hash 不在本项声明，也不由 EP 伪造。

正负 fixture、Schema/Guard 一致性与 Registry 元数据校验由 `contracts/src/operations/enterprise-project.schema.test.ts` 与 `tests/fixtures/contracts/resolution-receipt/` 覆盖；Handler/授权/持久化与真实 PostgreSQL 证据见 [Spec 002](../module-specs/Module-Spec-002-EnterpriseProject.md#191-实现事实resolution-receipt-material-与-attestation-query) 与 [Module Test 002](../module-tests/Module-Test-002-EnterpriseProject.md#im-06-191-resolution-receipt-用例)。TE 的答案采纳与 resolver 消费链仍为 `NOT RUN`。

### #192 Revision 执行资格 Query 注册

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 (TD-03) / SCHEMA, REGISTRY, GENERATED TYPES, FIXTURES, HANDLER, AUTHORIZATION BOUNDARY AND REAL POSTGRESQL EVIDENCE IMPLEMENTED 2026-09-14 (#192) / TE COMPLETION CONSUMPTION NOT RUN`。Owner 为 QualityGovernance；新增一个只读 AUTHORITATIVE Query `quality.get_revision_execution_eligibility@1.0`（Purpose `quality.revision.execution_eligibility.read`，`dataClassification=INTERNAL`，无独立构建期 PayloadGuard 技术 Policy，`allowedConsistency` 固定 `AUTHORITATIVE`），Catalog 由 212 增至 213 项，本模块公开条目由 37 增至 38（18 Command / 9 Query / 11 Event）。历史 200 项 Compatibility Baseline、旧 `quality.*` 条目与旧 Envelope/Result 接受集合均未重写。

本项**不新增 objectType**：payload 复用已注册的 `artifact.artifact_revision`（CONTENT_ADDRESSED）与 Quality 自有的 `quality.revision_acceptance_snapshot`、`quality.approval_bundle_snapshot`（SNAPSHOT）引用形状，Result 不引入新引用类型，故本 Catalog 的 Object Type Registry 无新增行，`references`/`resultReferences` 声明保持为空。

Query payload 固定 `{revisionRef: Exact<ArtifactRevision>; revisionAcceptanceRef: Snap<RevisionAcceptance>; approvalBundleRef?: Snap<ApprovalBundle>}`；Result 固定 `RevisionExecutionEligibilityResult`：`revisionRef, revisionAcceptanceRef, approvalBundleRef?, revisionAcceptanceUsable: boolean, approvalBundleUsable: ValueEnvelope<boolean>, reasonCodes: ReasonCode[], observedAt, sourceWatermarks`。`approvalBundleUsable` 是本地收窄的 `ValueEnvelope<boolean>`：`PRESENT` 必须携带布尔值，未请求 ABS 时为 `NOT_APPLICABLE` 且不得携带 `value`，因此不可读作 `false`；`reasonCodes` 为已注册 upper-snake 解释码，全部为 `false` 时为空数组；`sourceWatermarks` 只描述本次观测的模块、Revision 分区、已验证 Quality 事实数与受信观测时点。

输入 `revisionRef` 的 objectType、Scope 与完整 ContentHash，以及两个 SnapshotRef 的 hash/Scope/snapshotId 必须是精确且同一 Revision/Scope/Profile 的事实；错 Hash、错 Scope、异 Revision 绑定与未覆盖的 Purpose 一律 fail-closed（`QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND`、`QUALITY_APPROVAL_QUERY_NOT_FOUND`、`QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED`），不泄露他方事实。`revisionAcceptanceUsable` 复用 owning 当前有效性检查：所请求 RAS 仍是该 Revision/Profile 的最新快照、状态仍为 READY、记录的 Gate Result 仍精确存在且未被 GateInvalidation 失效、当前适用 mandatory Gate 仍存在且为 PASS。请求 ABS 时另核验该 bundle 仍是最新且 `FULLY_APPROVED`、其中每个 Approval 仍 `EFFECTIVE` 且精确绑定同一 Revision/Profile 与该 bundle 自身的 READY RevisionAcceptanceSnapshot；锚定同 Revision/Profile 其他（含已被取代的）RAS 的 Approval 既不计入新 ABS，也不构成当前批准集合，因此不产生可用的批准资格。该 Query 只允许目标 Scope 内的 TE Evaluator Service 或授权 Human：组合入口与 owning Handler 都对受信 Decision 的 principal kind 执行 `HUMAN | SERVICE` allowlist，持有精确 capability 的 AGENT/RUNTIME/EXTERNAL_PARTY 一律拒绝。历史 READY/FULLY_APPROVED 在上游失效/撤销后返回 `false` 与原因，Query 不重算 Gate、不创建 Approval、不写回任何 Snapshot，也不改变 `get_release_readiness_snapshot(requireCurrentForAuthorization)` 与旧历史 Snapshot Query 的语义。

正负 fixture、Schema 与 Registry 元数据断言由 `contracts/src/operations/quality-governance.schema.test.ts` 与 `tests/fixtures/contracts/revision-eligibility/` 覆盖；构建期注册断言 `assertRevisionEligibilityOperationRegistrations` 固定 owner/kind/consistency/purpose/classification 并拒绝该操作声明 target、Guard、reference surface 或显式 result schema。Handler、Purpose 授权边界与真实 PostgreSQL 证据见 [Spec 005](../module-specs/Module-Spec-005-QualityGovernance.md#im-06-revision-当前执行资格-query-设计) 与 [Module Test 005](../module-tests/Module-Test-005-QualityGovernance.md#im-06-revision-eligibility-用例)。TE Evaluator 的 Completion 消费、跨模块业务链、外部与人工业务验收仍为 `NOT RUN`。

### #202 Task DRAFT 创建引用身份与 Project 校验边界

状态：`T2 / APPROVED 2026-09-15 / INDEPENDENT DESIGN REVIEW APPROVE / HUMAN DESIGN APPROVAL RECORDED / OWNING HANDLER, ENTERPRISE-PROJECT PORT AND V3001 SCOPED PERSISTENCE IMPLEMENTED (#204, PR #205) / NO CATALOG CHANGE`。本节记录 [Issue #202](https://github.com/qzhike/zhiju-business-core/issues/202) 的引用身份路由：字段级权威见 [Spec 003 §16](../module-specs/Module-Spec-003-TaskExecution.md#16-task-draft-创建引用与持久化边界202-设计)，Project 侧边界见 [Spec 002 §13.1](../module-specs/Module-Spec-002-EnterpriseProject.md#131-task-创建期的-projectdeliveryitem-校验-port202-提案)。本项**不新增公开 operation、不新增 objectType**：Catalog 保持 213 项，历史 200 项 Compatibility Baseline、v1 冻结 fixture 与全部 registry 元数据不变。

`execution.create_task` 两个 Major 各自只有一套已发布身份，逐版本精确、大小写敏感、不互为别名：

| operation/version | CREATE target | `projectRef.objectType` | `deliveryItemRef.objectType`（可选） |
|---|---|---|---|
| `execution.create_task@1.0` | `execution.task` | `project.project` | `project.delivery_item` |
| `execution.create_task@2.0` | `zhiju.execution.task` | `zhiju.project.project` | `zhiju.project.delivery_item` |

上表是**创建路径**的接受集：v1 的 legacy 拼写由 owning Handler 与 EnterpriseProject 内部 Port 闭合（v1 registry Schema 使用通用 `objectRef`/`versionedRef`，Schema 本身不约束拼写），v2 的 `projectRef` 由注册 Schema 的 `const` 与 `references` 声明固定。两个版本的 `parentTaskRef`/`dependencyTaskRefs[]` 同样使用各自版本的 Task 拼写（v1 `execution.task`、v2 `zhiju.execution.task`），因为它们在两侧 Schema 中都是通用 `ObjectRef`，身份只能由 owning Handler 闭合；错误模块类型、另一版本拼写或大小写变体不得进入 parent 查询或被固化为 dependency 事实。两套拼写都是已发布历史身份：既不重写 v1 payload/fixture，也不在任一版本内接受对方拼写或裸本地名，避免为跨模块消费者制造可互换别名。

公开 `project.validate_object_scope@1.0` 的接受集（13 个裸本地名）与其错误外观保持不变：`zhiju.project.project`、`project.project`、`zhiju.project.delivery_item` 与 `DeliveryItem` 仍不是它的合法输入；创建期的 Project/DeliveryItem 证明走 EnterpriseProject owning 内部 Port，而不是扩大该公开 Query 的接受集。未来若需要公开接受 canonical 拼写，必须作为独立 additive 契约提案批准。

`TaskDefinitionSnapshot` 的公开引用身份**在本 revision 不注册**：`execution.create_task` 两个版本都没有 operation-specific Result Schema，DRAFT 创建不返回该 Ref。未来需要返回或消费它的切片必须先取得 additive 批准并注册 `zhiju.execution.task_definition_snapshot`（Owner `task-execution`、kind `CONTENT_ADDRESSED`、Project Scope、不可变、不另建可变版本、不可作为 BusinessOutput），Ref 按 exact `objectId` + 完整 canonical payload Hash 解引用；不允许以“实现需要”为由静默发明名称或改写 v1 payload。

### #206 Task Readiness 引用身份与 READY 转换注册（设计）

状态：`T2 / MERGED 2026-09-16（PR #207）/ INDEPENDENT DESIGN REVIEW APPROVE 2026-09-16（reviewed revision 2155d4dd89437694632c0e35ca65b7d6d46d720f）/ CATALOG 213 → 214 / HISTORICAL 200-ENTRY COMPATIBILITY BASELINE UNCHANGED (#208 IMPLEMENTED AND MERGED, PR #209, merge commit 0dc1bcef9a9f1e21219a015ac0f8b5d6768fe250)`。本节记录 [Issue #206](https://github.com/qzhike/zhiju-business-core/issues/206) 的引用身份与操作路由；字段级权威见 [Spec 003 §17](../module-specs/Module-Spec-003-TaskExecution.md#17-task-readiness-生产与-ready-转换边界206-设计)，依据与被否方案见[设计提案 §16](../decisions/task-execution-human-operated.md#16-task-readiness-生产与-ready-转换边界提案206)，生产者与 READY 动作各自的授权组成（两个互相独立的条目）见 [Spec 001 §15.5](../module-specs/Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206)。#208 已注册该 operation 与下列全部 objectType，本节的设计事实保持不变。

| objectType | Owner | Reference / Scope | 不可变 / 版本 / BusinessOutput |
|---|---|---|---|
| `zhiju.execution.task_definition_snapshot` | task-execution | CONTENT_ADDRESSED；Project Scope（两成员必填，等于该 Task 的 Scope） | 不可变；不另建可变版本；否；按 exact `objectId` + 完整 payload Hash 解引用 |
| `zhiju.execution.task_readiness` | task-execution | SNAPSHOT（生产者 CREATE target 与 Result Ref 共用）；Project Scope（两成员必填） | 不可变判断事实；无可变 Root、无 CAS 版本、无 current pointer；否；`objectId == snapshotId`，按完整 canonical payload Hash 解引用 |

`execution.build_task_readiness@1.0`（新增，Catalog 213 → 214）：Owner `task-execution`、`COMMAND`、`Target=zhiju.execution.task_readiness`、mode `CREATE`、Purpose `execution.task.readiness.build`、`dataClassification=INTERNAL`、operation-specific Result Schema、无专用构建期 PayloadGuard 技术 Policy；`references` 声明 `/targetRef`（OBJECT/`zhiju.execution.task_readiness`）、`/payload/taskDefinitionRef`（CONTENT_ADDRESSED/`zhiju.execution.task_definition_snapshot`）、`/payload/policyRef`（VERSIONED/`zhiju.identity.policy`）、`/payload/evaluatorRef`（VERSIONED/`zhiju.execution.evaluator_profile`），`resultReferences` 声明 `/data/readinessSnapshotRef`（SNAPSHOT/`zhiju.execution.task_readiness`）。`/payload/taskRef` **有意不声明**：它的合法取值随该 Task 的创建 Major 而定（v1 `execution.task`、v2 `zhiju.execution.task`），Schema 与 `references` 都无法表达，收窄由 owning Handler 完成（与 `create_task@2.0` 不声明两版本 `parentTaskRef`/`dependencyTaskRefs` 同理）。

Task 寻址规则（Spec 003 §17.3 的 R-206-1）：两个 Readiness 操作的 Task 引用拼写必须恰好等于该 Task **创建事实**对应的拼写——创建定义快照的 `schema_version='1.0'` → `execution.task`、`'2.0'` → `zhiju.execution.task`，大小写敏感、无规范化、无 latest 回退，另一版本拼写与裸本地名一律 `EXECUTION_TASK_REF_INVALID`。两种拼写是两条已发布创建路径各自的唯一身份，不是同一操作的两个别名。

`execution.mark_task_ready@1.0` **零改动**：本项不改它的注册 Schema（通用 `snapshotRef`）、Catalog 条目或 compat metadata Purpose（`task.execution.mark_task_ready`），也不新增 `targetObjectType`；接受集与授权由 owning Handler 与 Spec 001 §15.5 的内部 Port 闭合。生产者**不发布任何公开 Event**（本 Catalog 无 `TaskReadinessBuilt`），消费者恰好发布一条已注册的 `execution.TaskReady@1.0`。

历史 200 项 Compatibility Baseline 不变（additive 追加）；#208 将本 Catalog 由 213 增至 214 项，v1/v2 冻结 fixture、两个 `create_task` Major 的接受集与全部既有 registry 元数据逐字节不变。

### #210 WorkOrder DRAFT 创建与精确读取的寻址路由（契约已注册并实现 #212，PR #213 已合并）

状态：`DESIGN APPROVED（Issue #210）/ CONTRACT REGISTERED AND HANDLER IMPLEMENTED（#212）/ MERGED 2026-09-18（PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213)，merge commit `f0dccc9601316752dca15b393ef24f31199929f8`）/ TE-P210-001–023 EXECUTED ON REAL PostgreSQL 18.6（CATALOG 214 → 215）/ TE-P210-006 AND TE-P210-020 SUB-BRANCHES NOT RUN`，字段级权威见 [Spec 003 §18](../module-specs/Module-Spec-003-TaskExecution.md#18-workorder-draft-创建与精确-draft-读取边界210-设计)，依据与被否方案见 [决定 §17](../decisions/task-execution-human-operated.md#17-workorder-draft-创建与精确-draft-读取边界提案210)，读取授权组成见 [Spec 001 §15.6](../module-specs/Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210)。

- **WorkOrder 寻址规则（R-210-1）**：WorkOrder 的公开拼写由不可变创建事实派生——由 `execution.create_work_order@1.0` 创建者为 `execution.work_order`，由 `@1.1` 创建者为 `zhiju.execution.work_order`。每个 WorkOrder 恰好一个被接受的拼写，且该拼写绑定唯一读取版本：`@1.1` 创建者由 `execution.get_work_order_draft@1.1` 读取，`@1.0` 创建者由本项新增设计的 `execution.get_work_order_draft@2.0` 读取。两个拼写不是别名：另一拼写在授权 Port 的 target 闭集与 owning Handler 的业务闭合两侧都不能取得业务成功，且不存在规范化、大小写回退或 latest 取值。
- **Task 寻址规则**：WorkOrder 的 `taskRef` 拼写必须等于被绑定 Task 的创建事实拼写（R-206-1），不得由 WorkOrder 版本、Task 的 `aggregate_version` 或 objectId 推断；两个 WorkOrder 创建路径都接受两个 Task 创建路径。
- **不新增 objectType**：`execution.work_order` 与 `execution.task` 都不是本 Catalog 的 objectType 键，本项不把 legacy 拼写注册为公开对象名；`get_work_order_draft@2.0` 的 `/payload/workOrderRef` **有意不声明**，接受集由 owning Handler 闭合（与 §17.4 对 `/payload/taskRef` 的处理同理）。DRAFT 声明能力的 Human-only 分类经 [Spec 001 §15.7](../module-specs/Module-Spec-001-IdentityPolicy.md#157-im06-wodraft-02-workorder-draft-声明能力的-human-only-分类边界210) 的 owning 内部只读边界，不新增公开 Query 或 objectType。
- **发生层与稳定码**：创建 target 的错拼写在注册 Envelope（@1.1 的 `targetRef` `const` → `API_VALUE_INVALID`）或 `TaskExecutionCreationAuthorizationPort`（@1.0 → `IDENTITY_CREATION_TARGET_INVALID`）被拒；新增的 `EXECUTION_WORK_ORDER_REF_INVALID` 只属于读取路径，`EXECUTION_WORK_ORDER_ALREADY_EXISTS` 是同一 target 已存在/并发的唯一稳定码；Human-only 拒绝沿用共享码 `HUMAN_ONLY_CAPABILITY`，不新增 Catalog 条目。
- **注册面增量（#212 已注册）**：新增 `execution.get_work_order_draft@2.0`，本 Catalog 由 214 增至 215；`execution.create_work_order@1.0`/`@1.1` 与 `execution.get_work_order_draft@1.0`/`@1.1` 的条目、注册 Schema 与 metadata 逐字节不变。`execution.get_work_order_draft@1.0` 的固定接受集（canonical 拼写 + `WorkOrderDraft` 结果形状）无法表示 `@1.0` 创建 Major 的对象，因此保留不改、本切片不实现其 Handler，也不改写为 legacy。`$defs.workOrderDraftSnapshot`/`initialWorkOrderDraftSnapshot` 的拼写固定改为创建 Major 派生、`taskRef` 通用化：这两个 def 无任何注册引用调用点且不在历史 Baseline 中，因此不改变任何已注册接受集、计数或 metadata。
- 历史 200 项 Compatibility Baseline 不变（additive 追加）；本项不新增 PayloadGuard 技术 Policy，不新增错误码注册以外的任何公开名。

### #217 `ContextSnapshotBuilt` additive Event 修正提案

状态：`REGISTERED 2026-09-20（`execution.ContextSnapshotBuilt@1.1`，Owner `task-execution`、`EVENT`、`dataClassification=INTERNAL`）/ DESIGN APPROVED 2026-09-19（显式人类设计批准；独立设计复审于 PR #217 第 3 轮确认一致性）/ IMPLEMENTED 2026-09-20（修正路径只发布 `@1.1`，成功 envelope 先经真实 ContractRegistry 校验再写 Outbox）/ vibe verify full PASS 2026-09-20 / ROUND-4 FINDINGS IMPLEMENTED 2026-09-21 / NEW vibe verify full PASS 2026-09-21（persistence gate 44/44 files、493/493 tests）/ ROUND-5 FINDING IMPLEMENTED 2026-09-21 / NEW vibe verify full PASS 2026-09-21（persistence gate 44/44 files、493/493 tests）/ PR #217 新 head 独立复审与人类技术审查 PENDING（不声称审查结论或合并）`。本节回应 PR #217 对 `execution.ContextSnapshotBuilt@1.0` 实际 payload 与注册 Schema 不一致的阻断发现；`@1.1` 已注册并落地，设计约束与计数如下。

- 已发布的 `execution.ContextSnapshotBuilt@1.0` **冻结不改**；不得修改其 Schema、metadata、fixture 或接受集来适配当前实现。
- additive 新增候选 `execution.ContextSnapshotBuilt@1.1`，Owner `task-execution`、`EVENT`、`dataClassification=INTERNAL`。修正后的首次 Context 构建成功路径只发出 `@1.1`；`@1.0` 仅保留为历史已发布版本，不由该修正路径继续产生。
- Event envelope 的 `scopeRef` 是企业 / 项目作用域的唯一权威来源；payload 不重复携带 `enterpriseId` 或 `projectId`。
- payload 为 closed object（`additionalProperties: false`），恰含下列四个 required 字段：

| 字段 | 类型 / 约束 | 语义 |
|---|---|---|
| `contextSnapshotRef` | `SnapshotRef`，`objectType = zhiju.execution.context_snapshot` | 本次构建产生的 canonical Context Snapshot |
| `workOrderRef` | `ObjectRef`，objectType 必须等于该 WorkOrder 的不可变创建拼写 | 触发构建的 WorkOrder |
| `projectionType` | Common `ProjectionType` enum | 复用 Core 已发布大小写与取值，不定义局部替代类型 |
| `coverageStatus` | Common `CoverageCompleteness` enum | 复用 Core 已发布大小写与取值，不定义局部替代类型 |

- 注册后计数（已实现）：Catalog `215 → 216`、TaskExecution `45 → 46`；历史 `200` 项 Compatibility Baseline 不变；compatibility minor findings `80 → 82`（新 operation 与 envelope 两条 additive finding，baseline 无 finding）。新增 Event 不新增 objectType，也不改变 `execution.build_initial_context_snapshot@1.0/@1.1`、`execution.get_context_snapshot@1.0` 或任何 v1 fixture 的既有接受集。
- 最小契约门禁：完整实际 envelope 必须通过 `ContractRegistry`；额外字段、Common enum 表外值、用任意 `NamespaceCode` 替代强类型 enum、错误 ref objectType 与跨 Scope 必须 fail closed；目录计数、生成类型、兼容 fixture 和冻结 `@1.0` 必须独立回归。

### IM-06 WorkOrder Validation → Freeze/READY 注册提案

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-21（决定 §20.3）/ REGISTERED 2026-09-22 / PR #218 ROUND 2 INDEPENDENT DESIGN REVIEW APPROVE 2026-09-21（reviewed 1acdf34）/ CONTRACTS REGISTRATION IMPLEMENTED 2026-09-22（#219：Handler、七条授权映射与 V3005 同时实现；独立实现审查待完成）`。字段和业务语义见 [Spec 003 §21](../module-specs/Module-Spec-003-TaskExecution.md#21-workorder-validation-与-freezeready-设计提案)，授权见 Spec 001 §15.10。Catalog/Registry 由 `216` 增至 `217`，TaskExecution 由 `46` 增至 `47`，历史 Baseline `200` 不变，compatibility minor findings 由 `82` 增至 `86`（新 operation、payload/result 两个新 `$defs` 与 `validateWorkOrderDraftCommandResult` 结果 def 四条 additive finding）。

| 待实施的 additive 注册 | 唯一 Owner 与引用声明 |
|---|---|
| `execution.validate_work_order_draft@1.0` | `task-execution` / `COMMAND` / `CREATE` / `INTERNAL`，target 固定 `zhiju.execution.work_order_validation`，Purpose `execution.work_order.draft.validate`。Payload closed，引用 `/payload/draftSnapshotRef` 为 `CONTENT_ADDRESSED/zhiju.execution.work_order_draft_snapshot`、`/payload/policyRef` 为 `VERSIONED/zhiju.identity.policy`、`/payload/evaluatorRef` 为 `VERSIONED/zhiju.execution.evaluator_profile`；完整 `candidateContract` 复用 Core WorkOrderContract Schema，不退化为开放 CanonicalJson。Result.data 只有 `validationSnapshotRef`，固定 `SNAPSHOT/zhiju.execution.work_order_validation`，完整 Project Scope/hash 与 target id 绑定。|
| `zhiju.execution.work_order_validation` | `task-execution` owning objectType，允许 `OBJECT` 与 `SNAPSHOT`；不作为 `zhiju.execution.task_readiness` 的别名。|
| `zhiju.contract.work_order` | WorkOrderContract 的 `CONTENT_ADDRESSED` identity，Owner `task-execution`；Freeze 成功 Event 的 `workOrderContractRef` 与 frozen pointer 使用该唯一拼写和精确 Scope/hash。 |

本提案已获明确人类设计批准；注册切片只新增一项公开 operation，Catalog/Registry `216→217`、TaskExecution `46→47`，历史 200 项 Baseline 不变。`execution.freeze_work_order@1.0`、`execution.get_work_order_contract@1.0`、`execution.WorkOrderBecameReady@1.0`、既有两个 `create_work_order` Major、DRAFT/Context 读取操作的注册 Schema、compat metadata 与 fixtures 不因本提案改动；Freeze Purpose 仍为已发布的 `task.execution.freeze_work_order`。实现前用真实 ContractRegistry 校验将发布的完整 `WorkOrderBecameReady@1.0` envelope。`execution.validate_work_order_draft@1.0` 的真实 Schema/Registry、生成类型、兼容性检查与正负契约测试已于 2026-09-22 通过（#219）；Validator、Freeze、权威 Contract Query、授权与持久化已由 #219 实现；真实 PostgreSQL 与未运行边界见 Module-Test-003。


## #219 READY 首版静态引用与 Controls profile 补充提案

状态：`HUMAN DESIGN APPROVED 2026-09-22 / INDEPENDENT REVIEW PENDING / NOT REGISTERED`。字段与固定身份由 [Spec 003 §21.6–§21.7](../module-specs/Module-Spec-003-TaskExecution.md#issue-219-ready-selectors) 定义；本段固定引用登记边界，不复制业务规则。

| 引用 | Owner | kind / Scope | 含义 |
|---|---|---|---|
| `zhiju.contract.work_order_schema` | contracts（共享 Contract Schema） | VERSIONED / Platform | exact Core WorkOrder 1.0 Schema selector |
| `zhiju.runtime.adapter_contract` | IntegrationGateway | VERSIONED / Platform | exact Human-operated synthetic 技术协议描述，不证明 Driver 已可用 |
| `zhiju.execution.work_order_risk_profile` | TaskExecution | VERSIONED / Platform | 首版 execution 风险控制 descriptor，不是 QualityGovernance 的 Risk/QualityProfile |
| `execution.work_order_controls.policy@1.0` profile selector | TaskExecution 语义 / contracts 静态 registry | VERSIONED `identity.contract_schema` / Platform | 声明 closed Controls document Schema；业务版本仍经 `zhiju.identity.policy` + owning PolicyVersion 解析 |

拟新增 READY 静态 registry `im06-work-order-ready-static-v1`（三项），Policy profile registry 则 additive 增加一项。所有 selector 要按完整 kind/objectType/objectId/versionId/Scope 精确匹配，拒绝未知版本、extra member、别名和 Project Scope 冒充；静态 descriptor 的内容 hash 不成为虚构的业务 SnapshotRef。保留既有 namespace/fixture 接受集，消费首版范围不扩大其运行时有效性。

不新增公开 Command/Query/Event；#219 实现的 Catalog/Registry 217、TaskExecution 47、历史 Baseline 200 保持原目标。既有 Freeze、Contract Query、WorkOrderBecameReady@1.0 的版本、Schema、Purpose 与 compatibility metadata 不变。静态 registry 源文件、生成副本、exact resolver 与 Controls profile 已由 #219 注册；descriptor 不代表实际 Runtime 调用。

## IM-06 READY Run 启动注册增量提案（2026-09-22）

identity.issue_execution_capability_bundle@1.0
execution.get_run_dispatch_binding@1.0
integration.get_runtime_attempt_binding@1.0
execution.reconcile_work_order_execution@1.0

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-22 / CONTRACT REGISTERED 2026-09-23 / PR #222 CI FULL PASS 2026-09-23（6a41b41）/ REVIEW APPROVE ON 6a41b41`。业务字段由 Spec 001 §15.12、Spec 003 §22、Spec 007 Runtime Binding 增量分别拥有；本节只固定公开名称、Owner、Ref 与兼容边界。

| 新增 operation | Owner / kind / Purpose | Target / payload 与 result 的精确引用 |
|---|---|---|
| `identity.issue_execution_capability_bundle@1.0` | identity-policy / COMMAND / `identity.execution_capability_bundle.issue` | CREATE target `zhiju.identity.execution_capability_bundle` OBJECT；payload 的 Run、WorkOrder、Contract、INITIAL Context refs 及 Result.data 的 `bundleRef` CONTENT_ADDRESSED/同 objectType 均声明；Result 用专用 closed Schema |
| `execution.get_run_dispatch_binding@1.0` | task-execution / AUTHORITATIVE QUERY / `execution.run.dispatch_binding.read` | payload `/runRef` OBJECT/`execution.run`；专用 closed Result.data 含 exact Contract/Context/Bundle、lease/fencing 与当前状态；不声明公开 bearer token |
| `integration.get_runtime_attempt_binding@1.0` | integration-gateway / AUTHORITATIVE QUERY / `integration.runtime.binding.read` | payload `/attemptRef` OBJECT/`integration.runtime_attempt`；专用 closed Result.data 含原 request/hash、invocation/hash 与条件性 ack；不复用通用 AdapterAttemptView |
| `execution.reconcile_work_order_execution@1.0` | task-execution / COMMAND / `execution.work_order.reconcile` | MUTATE target `zhiju.execution.work_order`；payload `/triggerRef` 本波次只接受同 Scope `OBJECT/execution.run`，目标状态由 owning 事实推导，专用 Result.data 含 WorkOrder Ref/status |

新增 objectType `zhiju.identity.execution_capability_bundle`：Owner identity-policy；CREATE target 为 OBJECT、已提交 Bundle Ref 为 CONTENT_ADDRESSED，Project Scope 必填且完整 Enterprise/Project 镜像；不把旧 `CapabilityGrant` OBJECT 当作 Bundle。Queue 和 Lease 均逐字段复用冻结 Contract 已绑定的同一 `execution.work_order_controls.policy@1.0` 真实版本；不新增 Policy profile selector，也不改变其已注册 closed Schema。有限租约取该 Policy 的显式 `budget.wallClockLimit` 与其它真实上界，不从静态 selector、未注册默认值或 fixture 推断。

当前计数为 Catalog/Registry 217→221，identity-policy 22→23、task-execution 47→49、integration-gateway 24→25；历史 200-operation Baseline 不变。现有 `queue_work_order@1.0`、`create_run@1.0`、`start_run@1.0`、`request_runtime_dispatch@1.0`、`get_run_state@1.0`、`WorkOrderQueued@1.0`、`RunStarted@1.0` 的注册 Schema/metadata 和 compatibility fixtures 保持逐字节不变；新查询/命令是 additive。现有 @1.0 公开 payload 允许的较宽输入仍由本次首版 Handler 明确拒绝 unsupported 子集，不能通过改旧 Schema 缩窄历史接受集。字段级新增 Schema/Result、引用声明、source/generated/fixtures/compatibility 正反例已随本次实现登记；PR #222 的精确修订 `8b4dfc0` 已通过 CI full 门禁。

## IM-06 final Result → terminal Run additive 注册提案（2026-09-23）

integration.get_runtime_final_observation@1.0
execution.record_run_result@1.0
execution.validate_agent_result@1.0
execution.finalize_run_from_acceptance@1.0
execution.expire_run@1.0

状态：`T2 / DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / REGISTERED IN DRAFT PR #226 2026-09-24 / LOCAL FULL PASS 2026-09-24 / EXACT HEAD EVIDENCE IN PR #226 / IMPLEMENTATION REVIEW PENDING`。唯一字段与行为权威是 Spec 003 §23、Spec 007 final 增量；本表固定新增公开名称和引用边界。当前分支的 Catalog/Registry 已由 `221→226`：TaskExecution `49→53`、IntegrationGateway `25→26`，历史 `200` 项 Compatibility Baseline 不变。

| 新增 operation | Owner / kind / Purpose | Target、引用和结果约束 |
|---|---|---|
| `integration.get_runtime_final_observation@1.0` | integration-gateway / AUTHORITATIVE QUERY / `integration.runtime.final_observation.read` | payload exact `attemptRef:OBJECT/integration.runtime_attempt`；同 Attempt 最多一份已提交 final，Result.data 才返回 `runtimeSubmissionRef:ExternalRef`、`runtimeAdapterIdentityRef:OBJECT/zhiju.runtime.runtime`、`observationRef:CONTENT_ADDRESSED/zhiju.integration.runtime_final_observation`、Run/Attempt、原 ack observation ID、bindingHash/fencing/resultPayloadHash 与完整受控 `agentResultContract`，均使用 Spec 007 的专用 closed Schema |
| `execution.record_run_result@1.0` | task-execution / COMMAND / `execution.run.result.record` | MUTATE target `execution.run`；payload `agentResultRef:CONTENT_ADDRESSED/execution.agent_result`；专用 closed Result.data 含 Run/RESULT_RECORDED/Result Ref |
| `execution.validate_agent_result@1.0` | task-execution / COMMAND / `execution.agent_result.validate` | CREATE target `zhiju.execution.agent_result_validation_bundle`；payload Result、Run、Attempt、Controls Policy、静态 Evaluator exact refs；专用 closed Result.data 返回 Bundle 和五种 Validation 的 CONTENT_ADDRESSED refs |
| `execution.finalize_run_from_acceptance@1.0` | task-execution / COMMAND / `execution.run.finalize` | MUTATE target `execution.run`；payload `acceptanceRecordRef:CONTENT_ADDRESSED/execution.agent_result_acceptance`；专用 closed Result.data 含 Run/SUCCEEDED/Acceptance Ref |
| `execution.expire_run@1.0` | task-execution / COMMAND / `execution.run.expire` | MUTATE target `execution.run`；payload reason 保留已批准 `LEASE_EXPIRED\|DEADLINE_EXCEEDED` 闭集，本切片 Handler 只支持后者；专用 closed Result.data 含 Run/TIMED_OUT/endedAt |

新增 public objectType：`zhiju.runtime.runtime`（IG，OBJECT，Project Scope；原实际 invocation 的 Adapter 实例身份，与 Attempt 分离）、`zhiju.integration.runtime_final_observation`（IG，CONTENT_ADDRESSED）、`zhiju.execution.agent_result_validation_bundle`（TE，CREATE OBJECT 与已提交 CONTENT_ADDRESSED）、`zhiju.execution.validation_result`（TE，CONTENT_ADDRESSED）。前者在原真实 ack 后由 IG owning 事实确认，不能以预分配 ID、Attempt Ref 或静态 `zhiju.runtime.adapter_contract` selector 代替；TE Run start 通过内部独立授权 Port 保存其精确 Ref，已发布 `start_run@1.0`/`get_runtime_attempt_binding@1.0` Schema 不变。既有 v1 Result/Acceptance 身份精确拼写仍为 `execution.agent_result` 和 `execution.agent_result_acceptance`；注册引用声明时按此拼写，不用 `zhiju.*` 替换或把两者互当别名。每个 Ref 必须保留完整 kind/objectType/objectId/Scope 和适用 Hash；新 Result Schema 均 closed、Project Scope 必填。新静态 Evaluator 条目只加入既有 `im06-evaluator-static-v1` registry：`te.agent_result_validation.evaluator@1.0`，Owner task-execution、`VERSIONED/zhiju.execution.evaluator_profile`、Platform Scope `{}`，固定 objectId `018f22e2-7c15-7b2e-8d86-2de956a9d4a3`、versionId `018f22e2-7c15-7b2e-8d86-2de956a9d4b3`；不得改变原两项 selector，登记只证明本地静态版本而非已执行的判断。

已注册 `submit_agent_result@1.0`、`accept_agent_result@1.0`、`get_agent_result@1.0`、`get_run_state@1.0`、`AgentResultAccepted@1.0`、`RunTerminated@1.0` 与 `get_runtime_attempt_binding@1.0` 的 Schema、metadata、fixture 和历史接受集逐字节不变。首版仅支持合法空 business output 的 synthetic FINAL/COMPLETED 正链，是 Handler 支持范围，不是旧 Contract Schema 缩窄；旧操作若传其它 Core-valid 内容返回稳定 unsupported/拒绝。当前分支已通过真实 ContractRegistry 的生成、计数与兼容门禁；完整正反矩阵仍按 Module-Test 003/007 的逐项证据判定，本设计表不替代独立实现审查。

## #229 BLOCKED_INPUT 恢复的 additive 注册

状态：`T2 / DESIGN APPROVED / HUMAN DESIGN APPROVED 2026-09-27 / REGISTERED (#231) / RUNTIME ACCEPTANCE PENDING`。本 revision 已注册四个 additive 操作；全仓230/TaskExecution57/历史Baseline200。完整字段/结果/错误只由 [Spec003 §24.7](../module-specs/Module-Spec-003-TaskExecution.md#247-public-requestresultref-delta-与权威读回)拥有。

新增四项，Owner task-execution：`execution.build_context_snapshot@1.1`（CREATE canonical Context，已发布Purpose `task.execution.build_context_snapshot`，请求不变、新专用canonical Snapshot Result）；`execution.reconcile_task_execution@1.0`（MUTATE canonical Task，Purpose `execution.task.reconcile`）；`execution.get_task_state@1.0`（AUTHORITATIVE，Purpose `execution.task.read`，复用TD-01–04 TaskStateView，非TD-05 Board）；`execution.get_work_order_execution_state@1.0`（AUTHORITATIVE，Purpose `execution.work_order.execution_state.read`，frozen Root状态与当前有限retry资格）。当前计数为230/57/200；TD-05–07不在本实现支持集。

显式owning注册 `execution.information_request`：OBJECT；新增 `execution.information_answer`、`execution.information_request_resolution`：CONTENT_ADDRESSED；均TaskExecution-owned/Project Scope、独立UUIDv7。既有v1Request拼写保持，不能登记 `zhiju.*`别名替代；Resolution、Answer、Request、EP `zhiju.project.command_receipt`不同kind/type/id/hash/purpose不能混用。canonical Context/Task/WorkOrder与既有 `execution.run/agent_result/agent_result_acceptance`拼写继续分开；@1.0 SourceSlice/Receipt查询/AgentResult本体/旧操作Schema和200baseline全部保留。

Controls Policy profile新增 `execution.work_order_controls.policy@1.1` 与Platform `VERSIONED/identity.contract_schema` selector（完整identity/closeddocument见Spec003 §24.2）；@1.0版本和历史单次计划不原地升级。其它静态Schema/Evaluator/Runtime adapter selector不变，不增加Runtime六项控制Command。注册交付应同步source/generated/types、Result/ref path metadata、正负独立fixtures与旧版本兼容counterexample；任一语义或引用不匹配必须在设计Gate解决，不能修改旧fixture让其冒充新profile。

本实现 revision 的新增 Catalog 条目（历史 200 baseline 不变）：

```text
execution.build_context_snapshot@1.1
execution.reconcile_task_execution@1.0
execution.get_task_state@1.0
execution.get_work_order_execution_state@1.0
```


### #233 正式输出与 Completion 契约（提案）

状态：`HUMAN DESIGN APPROVED 2026-09-30 / REGISTERED IN #235`。设计前基线为 **230 / 57 / 200**；#235 新增 7 项后的当前 Registry / TE / 历史 compatibility 为 **237 / 62 / 200**。operation-specific closed payload/data、错误与selectors唯一维护于 [Spec 003 §25](../module-specs/Module-Spec-003-TaskExecution.md#25-正式输出与独立-completion-spec-delta233)、Spec 004 §12；本表拥有精确名称/Owner/target/Ref注册路由。Query无Command target/concurrency metadata，target仅表示授权资源；所有新Command除Artifact CREATE外为EVALUATE且必填expectedAggregateVersion。

| operation/version | Owner / kind | target或Query授权资源 | Purpose / Classification |
|---|---|---|---|
| `execution.evaluate_work_order_completion@2.0` | task-execution / COMMAND EVALUATE | OBJECT/zhiju.execution.work_order | execution.work_order.evaluate_completion / INTERNAL |
| `execution.evaluate_task_completion@2.0` | task-execution / COMMAND EVALUATE | OBJECT/zhiju.execution.task | execution.task.evaluate_completion / INTERNAL |
| `execution.get_output_creation_binding@1.0` | task-execution / QUERY AUTHORITATIVE | execution.run | execution.run.output_creation_binding.read / INTERNAL |
| `execution.get_work_order_state@1.0` | task-execution / QUERY AUTHORITATIVE | zhiju.execution.work_order | execution.work_order.state.read / CUSTOMER_CONFIDENTIAL |
| `execution.get_execution_judgment@1.0` | task-execution / QUERY AUTHORITATIVE | zhiju.execution.completion_evaluation | execution.judgment.read / INTERNAL |
| `artifact.create_execution_revision@1.0` | artifact / COMMAND CREATE | OBJECT/artifact.artifact_revision | artifact.execution_revision.create / CUSTOMER_CONFIDENTIAL |
| `artifact.get_execution_output_fact@1.0` | artifact / QUERY AUTHORITATIVE | artifact.artifact_revision | artifact.execution_output.read / CUSTOMER_CONFIDENTIAL |

新owning类型：`zhiju.execution.completion_evaluation`（TE、CONTENT_ADDRESSED/Project、独立UUIDv7）；`zhiju.artifact.command_receipt`（Artifact、CONTENT_ADDRESSED/Project、objectId=实际commandId）。creation binding仅Artifact内部附属事实，非公共TypedRef；其Hash与Receipt规范Hash不同。Artifact root/revision仍用已实现owning `artifact.artifact` / `artifact.artifact_revision`，Run/Result/Acceptance分别 `execution.run/agent_result/agent_result_acceptance`；Task/WO/Contract/Context仍用各已批准canonical类型。所有Exact/Snapshot Ref带完整SHA-256 ContentHash和Project Scope，错误kind/type/spelling不能用别名解析。

Spec 003 §25.1的8项新静态selector须在未来相应policy/evaluator/runtime/schema registry登记：Controls @2.0、Completion Policy profile、两个新Validator、两个Completion Evaluator、正式Runtime adapter与Artifact document schema。static selector不是业务事实，不计operation，不伪造contentHash。Artifact schema selector用Enterprise Scope；其他Platform Scope。IdentityPolicy仍实际解析独立业务Policy version、当前lifecycle/hash；未登记selector不可执行。

旧两项Completion@1.0、200 baseline bytes/metadata/fixtures、旧Artifact generic创建/读取、旧empty-outputprofile完全保留；v1 Completion Handler仍未交付，不借此设计虚构旧入口支持。旧WorkOrder frozen `zhiju.artifact.*`输出要求不变，只在新冻结profile采用owning spelling。TaskState@1.0的当前字段/身份/Classification原样，新增实现真实current Completion。两个Completed@1.0与Artifact RevisionSealed@1.0不改shape/owner，正式fact集合保持非空，新增Evaluator必须按Registry校验Event。TE→EP派发不在本结果中。

#235可执行注册增量（保留既有版本与200 compatibility baseline）：

```text
execution.evaluate_work_order_completion@2.0
execution.evaluate_task_completion@2.0
execution.get_output_creation_binding@1.0
execution.get_work_order_state@1.0
execution.get_execution_judgment@1.0
artifact.create_execution_revision@1.0
artifact.get_execution_output_fact@1.0
```


## #237 精确 DeliveryItem Completion 契约提案

状态：`HUMAN DESIGN APPROVED 2026-10-01 / DESIGN REVIEW PASSED / REGISTERED AND IMPLEMENTED IN #239 PROPOSED REVISION / RUNTIME EVIDENCE IN MODULE-TEST`；字段唯一见Spec002 §23。[设计决定](../decisions/task-completed-delivery-completion.md)保留设计冻结基线237/62/200；#239本修订只新增下列公开版本，当前Registry238、EP36、TE62与历史200不变。

| 操作 | Owner / kind / target | Purpose / 兼容 |
|---|---|---|---|
| `project.evaluate_delivery_item_completion@2.0` | enterprise-project / COMMAND EVALUATE / OBJECT zhiju.project.delivery_item；expectedAggregateVersion必填 | `project.delivery_item.evaluate_completion`；显式Major版本并存，COMPATIBLE_MINOR的operation-added-as-minor不等于新旧payload可互换 |

引用：新payload Plan=`VERSIONED/zhiju.project.delivery_plan`、Item=`VERSIONED/zhiju.project.delivery_item`，Scope均Project且version一致；Fact=`CONTENT_ADDRESSED/DeliveryItemCompletionFact`、Evaluation=`CONTENT_ADDRESSED/CompletionEvaluation`、Impact=`CONTENT_ADDRESSED/DeliveryItemImpactReview`沿用EP既有内部/事件拼写，不添加相互可交换别名。唯一新增typedidentity为构建期selector`zhiju.project.evaluator_profile`（VERSIONED、Platform Scope，静态值见Spec002 §23.3）；不是业务Policy。新closedcriteria profile pin exact Task=`OBJECT/zhiju.execution.task`、Release=`OBJECT/release.release`；不向旧validate_object_scope@1.0接受集加入这些拼写。

TaskCompleted@1.0完整合同/四字段零变；TE sidecar、dispatch函数、IP authorization port、EP Consumer/Readback都是内部边界，不新增公开Query/Event/Command。本修订已同步@2.0 Schema/IDL/generated metadata/Result Schema、reference paths、compatibility metadata和standalone正负fixtures；构建期Evaluator registry新增一个EP selector，原七个TE selector及TaskCompleted@1.0字段不变。有限EP历史Ref拼写在新domain schema闭集定义，不放宽共享namespace grammar。

```text
project.evaluate_delivery_item_completion@2.0
```

## IM06-CANCEL expire_run Major 2 契约设计

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-03 / INDEPENDENT DESIGN REVIEW APPROVE 2026-10-03 / IMPLEMENTED IN #244 PROPOSED REVISION / RUNTIME EVIDENCE IN THE PULL REQUEST`。

请求/结果与支持集唯一见 [Spec 003 §27](../module-specs/Module-Spec-003-TaskExecution.md#27-run-取消请求与迟到-final-隔离已批准设计)；批准绑定见取消设计决定 §5。

| 新版本 | Owner / kind / target | Purpose / 兼容 |
|---|---|---|
| `execution.expire_run@2.0` | task-execution / COMMAND MUTATE / OBJECT `execution.run`，expectedAggregateVersion 必填 | `execution.run.expire`；closed Result 从 TIMED_OUT 常量改为 TIMED_OUT/ABANDONED 需独立 Major；@1.0 保留 |

```text
execution.expire_run@2.0
```

请求 closed {reason: LEASE_EXPIRED|DEADLINE_EXCEEDED}；Result.data closed {runRef:ObjectRef<execution.run>,status:TIMED_OUT|ABANDONED,endedAt:UtcInstant}。引用路径为 /targetRef（OBJECT execution.run）与 /data/runRef（OBJECT execution.run）；reason/status/endedAt 不是 Ref。不新增 public objectType、Query/Event 或 IP/IG 操作。request_run_cancel@1.0、get_run_state@1.0、RunTerminated@1.0 及 expire_run@1.0 的 Schema/metadata/fixtures 接受集逐字节保留。

cancel@1.0 的公开 Purpose 精确保留 metadata 中的 `task.execution.request_run_cancel`，内部 Grant action `execution.run.cancel.request.v1` 不作为别名；new expire@2.0、cancel Handler 与 late-isolation 的首版支持集唯一见 Spec 003 §27.1，仅包含真实创建已有 reservation 的两次执行 profile。上述限制不改旧 Schema 或 @1.0 expiry 支持集。

本设计已随 #244 注册 `execution.expire_run@2.0`；当前计数 239/63/200，historical baseline 保持 200。注册、生成产物、version metadata、Result validation 与 standalone 正负 fixtures 必须同修订交付；Intent 与 late isolation/Audit 为内部边界，不能当成已注册操作。IM-DG-006 与六个 Runtime Command/ACK 不因本项获得批准。

## D14 / RD-01 拟议名称与类型（未注册）

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。下表只是 name/Owner proposal，不计入现有 Catalog/Registry/200 compatibility baseline；字段只在对应 owning Spec D14。后续人类批准后才注册 schemas/types/metadata/compatibility fixtures，不以本表存在宣称可调用。

| 拟议 @1.0 操作 | 唯一 Owner / fields |
|---|---|
| project.find_preparation_enterprises、project.request_project_preparation、project.get_project_preparation_request、project.create_preparing_project | EnterpriseProject / [Spec 002 D14](../module-specs/Module-Spec-002-EnterpriseProject.md#d14--rd-01-准备报告与启动字段提案) |
| project.capture_preparation_source、project.get_preparation_source、project.accept_preparation_report、project.get_startup_review | EnterpriseProject / Spec 002 D14 |
| project.request_startup_confirmation、project.start_preparing_project、project.get_startup_request、project.resume_startup_request | EnterpriseProject / Spec 002 D14 |
| execution.create_preparation_analysis_task、execution.build_preparation_context、execution.request_preparation_analysis、execution.get_preparation_analysis_result | TaskExecution / [Spec 003 D14](../module-specs/Module-Spec-003-TaskExecution.md#d14--rd-01-preparationcontext分析与初轮范围提案) |
| execution.receive_initial_work_scope、execution.get_work_scope_progress | TaskExecution / Spec 003 D14 |
| integration.request_customer_zip_intake、integration.get_customer_zip_intake | IntegrationGateway / [Spec 007 D14](../module-specs/Module-Spec-007-IntegrationGateway.md#d14--rd-01-zip-intake-与真实报告观察提案) |
| project.PreparingProjectCreated、project.PreparingProjectStarted | EnterpriseProject / Spec 002 D14，最小新 lifecycle facts，不改变旧 ProjectCreated |
| execution.InitialWorkScopeReceived | TaskExecution / Spec 003 D14，scope receipt 不承诺 Task/DeliveryItem 完成 |

拟新增类型：OBJECT `zhiju.project.preparation_request`、`zhiju.project.startup_request`、`zhiju.execution.preparation_analysis_request`、`zhiju.execution.work_scope`、`zhiju.integration.customer_zip_intake`；SNAPSHOT `zhiju.project.preparation_source`、`zhiju.project.preparation_report`、`zhiju.project.startup_candidate_set`、`zhiju.project.preparation_file_plan`、`zhiju.project.project_start_binding`、`zhiju.execution.preparation_context`、`zhiju.integration.customer_input_manifest`；CONTENT_ADDRESSED `zhiju.project.startup_decision`。均 Project Scope，只有明确 Enterprise/Platform 输入类型可例外；snapshotId+cv1 contentHash 必须精确解析，内部 raw locator 不是 TypedReference。Project/Enterprise 本体用 canonical zhiju.project.*；调用旧操作时依各自旧 identity，禁止通用 alias 互换。

新增 `PreparationContext@1.0`、`WorkOrderContract@1.1` preparation 分支、`RuntimeExecutionPackage@1.1` 与 `d14.analysis@1` 是待批准 producer/validator selectors，接受集分别见 Core03/TE/Runtime owning sections。旧操作不接新 profile；本首版 public request→owning internal handlers 是封闭入口，若将新 profile 公开到旧 Run/Result 操作须明确新版本/接受集审批，不能暗改已发布 grammar。

首轮恢复 additive 提案补充（均 @1.0、未注册）：EP `project.request_initial_scope_confirmation`、`project.get_initial_scope_request`、`project.resume_initial_scope_request`；TE `execution.get_initial_work_scope_state`。新增 OBJECT `zhiju.project.initial_scope_request`、CONTENT_ADDRESSED `zhiju.project.initial_work_scope_decision`，均同 Project；producer/field/startBindingMode 与授权唯一维护于 Spec002 ACTIVE 首轮恢复，消费者与唯一 INITIAL scope 约束维护于 Spec003。旧 catalog 计数/bytes 不改。
