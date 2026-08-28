# Zhiju Core Typed References 与 Contract Catalog v0.1

版本：v0.1
日期：2026-08-12
状态：`CURRENT CONTRACT CATALOG BASELINE / IM-04 WI-01 ADDITIVE CONTRACT VERIFIED 2026-08-28 / GIT DELIVERY PENDING USER REVIEW`

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
| `zhiju.execution.*` | TaskExecution | task、work_order、run、agent_result、information_request、context_snapshot、usage_record |
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
```

Queries：

```text
identity.resolve_principal@1.0
identity.authorize_command@1.0
identity.check_enterprise_access@1.0
identity.check_project_access@1.0
identity.check_human_only_capability@1.0
identity.get_policy_snapshot@1.0
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
```

Queries：

```text
project.get_project_context_source@1.0
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
execution.mark_task_ready@1.0
execution.create_work_order@1.0
execution.freeze_work_order@1.0
execution.queue_work_order@1.0
execution.build_context_snapshot@1.0
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

Issue #57 已为 Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和 Platform Template/Regulatory Reference 冻结 EnterpriseProject Owner 的受控 Application Capability；逻辑名称、输入/输出、授权目的和错误码见 [`../issue-57-enterpriseproject/Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md)。

这些 Capability 目前不是本 Catalog 的 `name@1.0` 条目；当前 Catalog 已因 IM-04 WI-01 的独立 `integration.get_render_attempt_binding@1.0` 增量变更为 201 个公开 Contract，Module Spec/Registry/生成类型集合必须保持同步。它们不得被测试、Migration 或跨 Schema Join 当作隐式公共入口。只有用户另行批准公共化后，才可按 API Contract 的兼容性流程新增公开名称并同步所有生成与负向验证产物。
