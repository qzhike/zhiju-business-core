# Zhiju Core 四个核心 Contract v0.1

版本：v0.1
日期：2026-08-12
状态：`CURRENT CONTRACT BASELINE / IMPLEMENTATION NOT STARTED`

文档角色：四个核心业务 Contract 的唯一权威。模块所有权以 `02` 为准，Typed Reference/Envelope 以 `06` 为准，持久化映射以 `07` 为准，验证口径以 `08` 为准。

## 1. 文档目标

本文将四个 Harness-neutral 核心 Contract 抽成独立 Source of Truth：

```text
Project Context Contract
= What do we know?

WorkOrder Contract
= What should be done?

AgentResult Contract
= What happened?

Artifact + Quality Gate Contract
= What can be accepted, approved and released?
```

本文只冻结业务 Schema 与验证语义，不指定 JSON/Protobuf 实现、数据库表、HTTP/MCP 接口或 Runtime Prompt 格式。Typed Reference、Envelope 和模块 Catalog 见 [`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md)。

---

## 2. 四个 Contract 的共同规则

### 2.1 Contract 不是传输 DTO

Core Contract 是稳定业务语义。未来可以映射为：

- 内部语言类型；
- JSON/Protobuf；
- REST/MCP 请求；
- Runtime Prompt/Workspace 文件；
- 飞书卡片摘要。

映射不得改变 Contract 含义。Prompt、飞书消息、数据库行和 UI ViewModel 不是 Contract Source of Truth。

### 2.2 共同 Header

四个 Contract 都使用统一 `ContractHeader`：

```text
contractId
contractType
contractVersion
schemaRef
scopeRef
issuedAt
issuedBy
correlationId
causationId?
dataClassification
canonicalizationVersion
payloadHash
extensions?
```

### 2.3 冻结语义

1. Contract 形成后 Payload 不可修改。
2. 内容变化必须创建新 Contract ID 和 Payload Hash。
3. Contract 不引用 `latest` 或隐式当前对象。
4. 所有历史输入使用 VersionedRef、ContentAddressedRef 或 SnapshotRef。
5. `aggregateVersion` 不作为业务版本引用。
6. Contract 只包含所需最少内容，正文优先使用受权限保护的引用。
7. Contract 不保存 Chain of Thought、Secret 或长期 Credential。
8. Contract 校验通过只表示结构、引用、Scope 和 Policy 满足，不自动完成下一层业务状态。
9. 当 Contract 本身就是 Domain Snapshot/Receipt 的 Payload 时，domainObjectId 与 contractId 必须一对一绑定；同一 domainObjectId 不得对应不同 contractId 或 payloadHash。

### 2.4 Presence 与不确定性

Contract 中不使用 `null` 混合表达未知、脱敏和不适用。需要时使用：

```text
PRESENT
UNKNOWN
REDACTED
NOT_APPLICABLE
UNAVAILABLE
```

Project Context 的 Epistemic State 进一步表达：

```text
CONFIRMED
INFERRED
UNKNOWN
DISPUTED
SUPERSEDED
```

### 2.5 Contract 验证层级

```text
Schema Validation
    ↓
Typed Reference Validation
    ↓
Scope / Tenant Validation
    ↓
Authorization Validation
    ↓
Cross-field Invariant Validation
    ↓
Payload Hash Validation
    ↓
Purpose-specific Readiness Validation
```

失败必须返回结构化错误和字段路径，不允许自动修复到“最接近”的当前版本。

---

## 3. Project Context Contract v1.0

### 3.1 业务问题

```text
What do we know for this exact purpose, at this exact point in time?
```

Project Context Contract 是从 Canonical Project World 按目的和权限生成的不可变最小投影。它不是整个项目数据库，也不是一个巨大 Prompt。

### 3.2 Contract Identity

```text
contractType = zhiju.contract.project_context
contractVersion = 1.0
```

### 3.3 顶层结构

```text
ProjectContextContract
├── header
├── contextSnapshotId
├── projectRef: ObjectRef<Project>
├── enterpriseRef: ObjectRef<Enterprise>
├── projection
│   ├── projectionType
│   ├── purpose
│   ├── audience
│   ├── requestedByWorkOrderRef?
│   └── builderPolicyRef
├── asOf
├── sourceManifest
├── contextItems[]
├── artifactContext[]
├── workContext
├── unresolvedItems[]
├── omissions[]
├── redactions[]
├── coverage
├── sourceWatermarks[]
└── expiresAt?
```

### 3.4 ProjectionType

v1.0 closed enum：

```text
COORDINATOR
DOCUMENT_WRITER
REVIEWER
RECORD_FORM_BUILDER
FEISHU_SUMMARY
HUMAN_WORKSPACE
```

新 ProjectionType 可能改变数据最小化和权限语义，因此默认需要 Contract Minor/配置注册；Consumer 未声明支持时不得回退到 COORDINATOR。

### 3.5 SourceManifest

```text
SourceManifest
├── enterpriseProfileSnapshotRef
├── qmsConfigurationRef: VersionedRef
├── customerBaselineRef?: VersionedRef
├── templateBaselineRef?: VersionedRef
├── regulatoryProfileRef?: VersionedRef
├── gapAnalysisRef?: VersionedRef
├── deliveryPlanRef?: VersionedRef
├── policyRefs[]
├── schemaRefs[]
└── externalAuthoritySnapshotRefs[]
```

每项必须是本次 Snapshot 实际使用的精确版本。没有使用的来源不得为了“看起来完整”随意加入。

### 3.6 ContextItem

```text
ContextItem
├── contextItemId
├── kind
│   ├── FACT
│   ├── DECISION
│   ├── MATERIAL
│   ├── REQUIREMENT
│   ├── EVIDENCE
│   ├── DELIVERY_COMMITMENT
│   ├── BLOCKER
│   └── MEMORY
├── subjectRef
├── epistemicState
├── value: ValueEnvelope | contentFragmentRef
├── evidenceRefs[]
├── provenanceRefs[]
├── validTime?
├── recordedTime
├── permittedUses[]
└── sensitivity
```

关键规则：

- INFERRED/UNKNOWN/DISPUTED 不得以 CONFIRMED 的语气物化给 Runtime；
- SUPERSEDED 默认仅在任务需要历史比较时包含；
- MEMORY 不自动成为 Fact；
- 受限内容可以只暴露 ContentAddressedRef 和授权 Deep Link；
- Evidence 必须保留 relation 和 Claim Scope。

### 3.7 ArtifactContext

```text
ArtifactContext
├── artifactRef
├── baseRevisionRef?: ContentAddressedRef
├── branchRef?
├── allowedSectionRefs[]
├── relevantEvidenceRefs[]
├── openReviewIssueRefs[]
├── acceptanceSnapshotRef?
├── currentEffectiveBindingRef?
└── representationRefs[]
```

`baseRevisionRef` 必须有 content hash。`currentEffectiveBindingRef` 只供理解当前有效状态，不能让 Agent 修改或替代 WorkOrder Target。

### 3.8 WorkContext

```text
WorkContext
├── deliveryItemRefs[]
├── taskRef?
├── workOrderRef?
├── informationRequestRefs[]
├── blockers[]
└── relatedCompletionCriteriaRefs[]
```

Context 不复制 Task/WorkOrder 全部可变状态，而引用权威对象和必要 Snapshot。

### 3.9 Omission、Redaction 与 Coverage

```text
Omission
├── category
├── reasonCode
├── sourceRef?
└── effectOnTask

Redaction
├── fieldPath
├── policyRef
├── reasonCode
└── substituteSummary?

Coverage
├── requestedScopes[]
├── includedScopes[]
├── excludedScopes[]
└── completeness: COMPLETE_FOR_PURPOSE | PARTIAL | BLOCKED
```

`PARTIAL` Context 可以用于探索，但如果缺失内容影响 WorkOrder Completion，Contract Builder 必须阻止 READY 或明确创建 InformationRequest；不能静默省略。

### 3.10 Invariants

1. Context 封存后形成 `SnapshotRef(contextSnapshotId, header.payloadHash)`；Contract 内不保存指向自身的 SnapshotRef，避免 Hash 自引用。
2. 所有来源属于同一 Enterprise；Project 私有项属于同一 Project。
3. SourceManifest 不含 `latest`。
4. ContextItem 的 Epistemic State、Evidence 和 ValuePresence 不互相矛盾。
5. Projection 只能包含 Audience 有权读取且 Purpose 必需的内容。
6. Redaction/Omission 必须显式，不允许用空字符串伪装。
7. Context 创建后来源对象变化不修改该 Snapshot。
8. expiresAt 到期不删除 Snapshot，只阻止新 Run 使用过期授权上下文。
9. FEISHU_SUMMARY 不得包含完整受限正文，复杂内容使用 Deep Link。
10. Context 不携带 Runtime Credential、Capability Token 或隐藏 Prompt 指令。

### 3.11 Validation Result

```text
ProjectContextValidation
├── valid
├── scopeValid
├── referencesValid
├── authorizationValid
├── coverageStatus
├── epistemicConflicts[]
├── blockingOmissions[]
└── validatedAt
```

---

## 4. WorkOrder Contract v1.0

### 4.1 业务问题

```text
What exactly is authorized to be done this time?
```

WorkOrder Contract 是 READY 时冻结的执行 Specification。Prompt/AGENTS.md/CLAUDE.md/Skill 是其 Runtime Materialization，不是权威 Contract。

### 4.2 Contract Identity

```text
contractType = zhiju.contract.work_order
contractVersion = 1.0
```

### 4.3 顶层结构

```text
WorkOrderContract
├── header
├── workOrderRef
├── taskRef
├── projectRef
├── requestedBy
├── objective
├── targetScope
├── inputRefs[]
├── contextSnapshotRef
├── constraints[]
├── allowedCapabilities[]
├── deniedCapabilities[]
├── expectedOutputs[]
├── completionCriteria[]
├── riskAndQuality
├── executionPolicy
├── budget
├── harnessPolicy
├── modelPolicy
├── versionPins
├── issuedAt
├── expiresAt?
└── specificationHash
```

`header.payloadHash` 覆盖完整 Contract，包括 Identity、Scope 和时间；`specificationHash` 只覆盖 Objective 至 VersionPins 的冻结执行规范，排除 Contract ID、Correlation 和签发时间。两者用途不同，不得互换。

### 4.4 Objective

```text
Objective
├── objectiveType
├── humanReadableStatement
├── successIntent
├── relatedIssueRefs[]
├── deliveryItemRefs[]
└── outOfScopeStatement?
```

自然语言用于 Human/Agent 理解；真正的授权边界由 targetScope、Capabilities、ExpectedOutputs 和 CompletionCriteria 共同定义。

### 4.5 TargetScope

```text
TargetScope
├── targetObjectRefs[]
├── baseContentRefs[]
├── allowedUnitRefs[]
├── forbiddenUnitRefs[]
├── allowedCreateTypes[]
├── crossObjectReferencesAllowed[]
└── scopePolicyRef
```

修改 Artifact 时 `baseContentRefs` 必须使用 ContentAddressedRef。仅提供 ArtifactId 而没有 base Revision 时，不允许解释为“修改最新版本”。

### 4.6 InputRef

每个 Input 声明用途与信任级别：

```text
InputRef
├── inputRole
├── ref: TypedReference
├── required
├── permittedUse
├── epistemicExpectation?
├── contentAccessMode
└── integrityRequired
```

`contentAccessMode`：

```text
REFERENCE_ONLY
INLINE_FRAGMENT
AUTHORIZED_FETCH
```

### 4.7 CapabilityGrant

```text
CapabilityGrant
├── capabilityType
├── actions[]
├── resourceSelectors[]
├── constraints[]
├── expiresAt
├── maxUses?
└── grantPolicyRef
```

能力名称使用注册 namespace，例如：

```text
artifact.revision.create
artifact.revision.read
quality.evidence.propose
execution.information_request.propose
```

Agent Contract 永远不能包含：

```text
quality.approval.decide
release.authorize
project.high_risk_fact.confirm
identity.capability.grant
```

### 4.8 ExpectedOutput

```text
ExpectedOutput
├── outputSlot
├── allowedObjectTypes[]
├── cardinality
├── requiredReferenceStrength
├── creationRequired
├── requiredTargetRelation?
├── schemaRef?
├── qualityStageRequired?
└── acceptancePolicyRef
```

示例：

```text
outputSlot = revisedProcedure
allowedObjectTypes = [zhiju.artifact.artifact_revision]
cardinality = EXACTLY_ONE
requiredReferenceStrength = CONTENT_ADDRESSED
creationRequired = true
```

Workspace 文件不能满足 ExpectedOutput。

### 4.9 CompletionCriterion

v1.0 不引入通用表达式语言。使用注册的 Criterion Type：

```text
CompletionCriterion
├── criterionId
├── criterionType
├── evaluatorRef
├── required
├── inputBindings[]
├── expectedCondition
└── failureDisposition
```

第一版 Criterion Type：

```text
EXPECTED_OUTPUT_PRESENT
OUTPUT_REF_VALID
OUTPUT_CREATED_BY_WORK_ORDER
NO_BLOCKING_INFORMATION_REQUEST
OUTPUT_SCHEMA_VALID
OUTPUT_WITHIN_TARGET_SCOPE
REQUIRED_PROPOSAL_PROCESSED
```

是否要求 Revision QualityReady/Approved/Released 应由 Task/DeliveryItem Criterion 表达，除非本 WorkOrder 的明确 Objective 就是质量或发布工作。

### 4.10 Risk、Quality 与 Execution Policy

```text
RiskAndQuality
├── riskProfileRef
├── qualityProfileRef?
├── dataHandlingPolicyRef
├── humanReviewRequired
└── escalationPolicyRef

ExecutionPolicy
├── maxAttempts
├── retryableOutcomes[]
├── resumePolicy
├── fallbackPolicy
├── leasePolicyRef
└── cancellationPolicyRef
```

```text
HarnessPolicy
├── requiredHarness?
├── preferredHarnesses[]
├── fallbackAllowed
├── fallbackRequiresHuman
└── selectionPolicyRef

ModelPolicy
├── allowedProviders[]
├── allowedModels[]
├── prohibitedDataClasses[]
├── minimumCapabilities[]
└── selectionPolicyRef
```

requiredHarness 不得被 Router 静默替换。Fallback 只能在明确 Policy 和预算内执行。

### 4.11 Budget

```text
ExecutionBudget
├── tokenLimit?
├── monetaryLimit?
│   ├── amountDecimal
│   └── currency
├── wallClockLimit?
├── toolCallLimit?
└── budgetPolicyRef
```

未知 Usage 不得用 0 替代。预算单位必须明确。

### 4.12 VersionPins

至少包括实际适用项：

```text
projectContextContractRef
contextBuilderPolicyRef
workOrderSchemaRef
skillRefs[]
templateRefs[]
regulatoryProfileRef?
qualityProfileRef?
capabilityPolicyRef
runtimeAdapterContractRef
```

### 4.13 Invariants

1. specificationHash 覆盖 Objective 至 VersionPins 的全部冻结内容。
2. READY 后 Contract 不可修改。
3. target/input/context/output refs 通过 Scope 和 Purpose 验证。
4. base Revision 必须 Content-addressed。
5. Agent Capability 不包含 Human-only Action。
6. ExpectedOutput 必须可由注册 Evaluator 机械验证。
7. CompletionCriteria 不读取 Harness 自报 `success=true`。
8. blocking InformationRequest 未解决时不能满足 Completion。
9. Budget、Harness、Model、Policy 和版本 Pin 不得只藏在 Prompt。
10. Contract 到期后不能启动新 Run。
11. 实质 Scope/Objective/Completion 改变必须新建 WorkOrder。
12. InformationRequest Resolution 只产生新 ContextSnapshot/Run，不修改本 Contract。
13. riskAndQuality 与 versionPins 中重复出现的 ProfileRef 必须完全相同；不得存在两个“当前 QualityProfile”。

### 4.14 Validation Result

```text
WorkOrderValidation
├── valid
├── referencesValid
├── specificationHashValid
├── capabilityValid
├── executable
├── budgetValid
├── contextCoverageValid
├── violations[]
└── validatedAt
```

---

## 5. AgentResult Contract v1.0

### 5.1 业务问题

```text
What did this exact Run submit at the execution boundary?
```

AgentResult 是不可信 Runtime 到可信 Core 的不可变收据。它不拥有 WorkOrder、Task 或 DeliveryItem 的完成解释权。

### 5.2 Contract Identity

```text
contractType = zhiju.contract.agent_result
contractVersion = 1.0
```

### 5.3 顶层结构

```text
AgentResultContract
├── header
├── agentResultId
├── runRef
├── workOrderRef
├── taskRef
├── projectRef
├── submissionKind: FINAL
├── executionOutcome
├── businessOutputs[]
├── workspaceOutputs[]
├── findings[]
├── knowledgeProposals[]
├── inputRequestProposals[]
├── followUpProposals[]
├── agentDeclaredUsage?
├── runtimeUsageRef?
├── provenance
├── continuationProposal?
├── humanSummary
├── submittedAt
└── submittedByRuntime
```

封存后由 Core 形成 `ContentAddressedRef(agentResultId, header.payloadHash)`。Contract 内不嵌入指向自身的 ContentAddressedRef。

v1.0 一个 Run 只有一个 final AgentResult。流式进度、RuntimeInputRequired 和工具事件使用独立 Runtime Event，不伪装成多个 final Result。

### 5.4 ExecutionOutcome

```text
COMPLETED
PARTIAL
BLOCKED_INPUT
BLOCKED_POLICY
FAILED_EXECUTION
CANCELLED_BY_RUNTIME
```

Outcome 是 Runtime 声明，不是 Core Completion：

```text
executionOutcome = COMPLETED
≠ WorkOrder COMPLETED
```

### 5.5 BusinessOutput

```text
BusinessOutput
├── outputSlot
├── ref: TypedReference
├── objectType
├── creationCommandRef?
├── createdByRunRef?
├── relationToTarget
└── declaredPurpose
```

验证：

1. outputSlot 存在于 WorkOrder ExpectedOutput；
2. objectType 和 Reference Strength 匹配；
3. 对象存在且 Scope 相同；
4. creationRequired 时必须由当前 WorkOrder/Run 授权 Command 创建；
5. Revision 必须 Content-addressed；
6. 输出被接受不代表内容通过 Quality Gate。

### 5.6 WorkspaceOutput

```text
WorkspaceOutput
├── outputType
├── externalRef
├── checksum?
├── mediaType?
├── retentionClass
└── diagnosticOnly = true
```

WorkspaceOutput：

- 不满足 ExpectedOutput；
- 不自动进入 Artifact Store；
- 不可直接 Release；
- 不因文件名与正式 Artifact 相同而提升；
- 只能按保留和权限 Policy 查看。

### 5.7 Finding 与 Proposals

```text
Finding
├── findingId
├── type
├── severity
├── statement
├── targetRefs[]
├── evidenceRefs[]
└── suggestedDisposition?
```

```text
KnowledgeProposal
InputRequestProposal
FollowUpProposal
```

Proposal 只表达建议。Result Processor 必须通过对应模块 Command 创建正式 Evidence Candidate、InformationRequest 或 DRAFT Task。

### 5.8 Usage

```text
AgentDeclaredUsage
├── inputTokens?
├── outputTokens?
├── reasoningTokens?
├── toolCalls?
├── estimatedCost?
└── measurementSource = AGENT_DECLARED
```

权威 Usage 使用 RuntimeUsageRef：

```text
Provider metering
    > Runtime Adapter
    > Harness telemetry
    > AgentDeclaredUsage
```

缺失字段是 UNKNOWN/UNAVAILABLE，不是 0。

### 5.9 Provenance

```text
ResultProvenance
├── contextSnapshotRef
├── workOrderContractRef
├── capabilityGrantRef
├── runtimeAdapterRef
├── harness
│   ├── harnessId
│   └── harnessVersion
├── provider
├── model
│   ├── modelId
│   └── modelConfigHash
├── skillRefs[]
├── policyRefs[]
├── templateRefs[]
├── regulatoryProfileRef?
├── executionNodeRef?
└── runtimeSessionExternalRef?
```

runtimeSessionExternalRef 仅用于诊断，不能成为业务恢复的唯一依据。

### 5.10 HumanSummary

HumanSummary 是简洁、可展示的执行摘要，应包括：

- 做了什么；
- 产生哪些正式输出；
- 哪些内容未完成；
- 是否需要输入/Review；
- 下一步建议。

禁止保存隐藏 Chain of Thought、系统 Prompt 或无关敏感内容。

### 5.11 Acceptance Record

AgentResult Contract 自身不可写入 `accepted=true`。Core 创建独立：

```text
AgentResultAcceptanceRecord
├── agentResultRef
├── schemaValidation
├── identityValidation
├── runBindingValidation
├── scopeValidation
├── businessOutputValidation
├── replayValidation
├── disposition: ACCEPTED | REJECTED | QUARANTINED
├── reasons[]
├── validatedBy
└── validatedAt
```

ACCEPTED 仍不代表 WorkOrder 完成。

### 5.12 Invariants

1. Result Payload 和 header.payloadHash 创建后不可变。
2. enterprise/project/task/workOrder/run 链必须一致。
3. submittedByRuntime 必须匹配 Run 绑定 Runtime。
4. Terminal/expired fencingToken 的 Result 进入 Quarantine。
5. 一个 Run 只接受一个 final Result Identity。
6. 相同 Result ID/相同 Hash 幂等；不同 Hash 是安全异常。
7. BusinessOutput 不得跨 Project/Enterprise。
8. WorkspaceOutput 不得满足业务完成。
9. Finding/Proposal 不自动改变正式对象。
10. AgentDeclaredUsage 不覆盖 RuntimeUsageRecord。
11. HumanSummary 不参与业务输出完整性判定。
12. late/cancelled/scope mismatch Result 不触发 Proposal 或 Completion。

---

## 6. Artifact + Quality Gate Contract v1.0

### 6.1 业务问题

```text
What exact content is being evaluated?
Why is it acceptable?
Who approved it?
Is this exact release package ready to publish?
```

Artifact + Quality Gate Contract 不是一个 `qualityPassed=true` 对象。v1.0 使用三个不可变阶段 Snapshot：

```text
RevisionAcceptanceSnapshot
    ↓
ApprovalBundleSnapshot
    ↓
ReleaseReadinessSnapshot
```

### 6.2 Contract Identity

```text
zhiju.contract.revision_acceptance@1.0
zhiju.contract.approval_bundle@1.0
zhiju.contract.release_readiness@1.0
```

三者共同构成 Artifact + Quality Gate Contract Family。

### 6.3 RevisionAcceptanceSnapshot

```text
RevisionAcceptanceSnapshot
├── header
├── snapshotId
├── artifactRef
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── qualityProfileRef: VersionedRef<QualityProfile>
├── riskProfileRef
├── evaluationStage = REVISION_ACCEPTANCE
├── requiredGateSpecs[]
├── gateResultRefs[]
├── evidenceStatusSnapshotRef
├── reviewIssueSnapshot
│   ├── openBlockingIssueRefs[]
│   ├── openNonBlockingIssueRefs[]
│   ├── closedIssueRefs[]
│   └── dismissedIssueRefs[]
├── evaluatorVersions[]
├── readiness
│   ├── status: READY | NOT_READY | STALE
│   └── reasons[]
└── evaluatedAt
```

GateSpecRef 至少绑定：

```text
qualityProfileVersionId
gateSpecId
gateVersion
evaluationStage
```

GateResultRef 必须 Content-addressed，并绑定相同 revision hash。

RevisionAcceptance READY 必须满足：

1. 全部适用 Mandatory REVISION_ACCEPTANCE Gate 有有效 PASS/合法结果；
2. 无未处理 ERROR；
3. 无 Open Blocking ReviewIssue；
4. Evidence 未处于会阻断的 Disputed/Expired/Revoked；
5. Profile/Revision/Result Hash 全部匹配；
6. 职责分离的 Reviewer 条件满足。

它不要求 Render Gate，也不表示 Human 已批准。

### 6.4 ApprovalBundleSnapshot

```text
ApprovalBundleSnapshot
├── header
├── snapshotId
├── artifactRef
├── revisionRef: ContentAddressedRef
├── revisionAcceptanceSnapshotRef
├── qualityProfileRef
├── approvalRequirements[]
├── approvalRefs: ContentAddressedRef<Approval>[]
├── separationOfDutiesResult
├── authorizationSnapshotRefs[]
├── completeness
│   ├── status: FULLY_APPROVED | PARTIALLY_APPROVED | NOT_APPROVED | STALE
│   └── reasons[]
└── evaluatedAt
```

每个 ApprovalRequirement：

```text
requirementId
requiredRole
requiredCount
ordering
authorizationAssurance
separationRules
```

每个 ApprovalRef 必须绑定同一个 revision content hash 和 RevisionAcceptanceSnapshot。Agent、actingFor Agent 或角色不满足的 Human Decision 不能进入有效 Bundle。

### 6.5 ReleaseReadinessSnapshot

```text
ReleaseReadinessSnapshot
├── header
├── snapshotId
├── releaseRef
├── artifactRef
├── revisionRef: ContentAddressedRef
├── approvalBundleSnapshotRef
├── releasePackageRef
├── purpose
├── recipientScopeSnapshotRef
├── destinationRefs[]
├── releaseRequirements[]
├── requiredReleaseGateSpecs[]
├── releaseGateResultRefs[]
├── readiness
│   ├── status: READY_FOR_AUTHORIZATION | NOT_READY | STALE
│   └── reasons[]
└── evaluatedAt
```

Render Gate 的 GateTarget 必须包含：

```text
revision content hash
representationId
representation checksum
rendererVersion
packageHash（Profile 要求时）
```

ReleaseReadiness READY 必须满足：

1. ApprovalBundle FULLY_APPROVED 且仍有效；
2. Release Package 已 PREPARED 并冻结；
3. Representation、Recipient 和 Destination 与 Package Snapshot 一致；
4. 全部适用 RELEASE_READINESS Gate 有效；
5. Release Purpose/格式/Receipt Policy 满足 Profile；
6. 没有 Approval Lost、Evidence/Gate invalidation 或高风险 Recall Blocker。

READY_FOR_AUTHORIZATION 不等于 Release 已授权或已发布。

### 6.6 失效与新 Snapshot

上游变化不会修改旧 Snapshot：

```text
EvidenceRevoked
GateResultInvalidated
ReviewIssueReopened
ApprovalRevoked
PackageHashChanged
    ↓
创建新的 NOT_READY/STALE Snapshot
    ↓
旧 Snapshot 保留为历史依据
```

Release Authorization Handler 必须使用 AUTHORITATIVE Query 验证最新有效 Snapshot，不能只看旧 Projection 中的 READY。

### 6.7 Invariants

1. 三类 Snapshot 均不可变并有 Payload Hash。
2. 所有 Target 使用相同 Enterprise/Artifact/Revision content hash。
3. Revision Acceptance 只计算其阶段 Gate。
4. Approval Bundle 不能包含 Agent Decision。
5. Human Approval 不能弥补 Mandatory Gate FAIL/ERROR。
6. Release Readiness 不能只引用 Revision；必须绑定冻结 Package。
7. Render Gate 不能提前对尚未冻结的文件名执行。
8. READY Snapshot 不自动修改 Artifact/Approval/Release 状态。
9. Package 内容、Recipient 或 Destination 改变必须重新准备并产生新 Snapshot。
10. CUSTOMER_DELIVERY Ready/Released 不自动建立 INTERNAL_EFFECTIVE_USE Binding。

---

## 7. 四个 Contract 的关系

```text
ProjectContextContract CTX-302
    ↓ exact SnapshotRef
WorkOrderContract WO-201 / specificationHash
    ↓ Run binds both
AgentResultContract AR-303 / payloadHash
    ↓ BusinessOutput
ArtifactRevision REV-003 / contentHash
    ↓
RevisionAcceptanceSnapshot RAS-501
    ↓
ApprovalBundleSnapshot ABS-701
    ↓ Release prepared package
ReleaseReadinessSnapshot RRS-801
    ↓ Human Release Authorization
Release + Publication Receipts
```

任一箭头都必须使用 Typed Reference，而不是按名称或 `latest` 查询。

---

## 8. 采购控制程序 Contract 实例

### 8.1 Project Context

```text
contractId = CTX-CONTRACT-302
contextSnapshotId = CTX-302
projectRef = PRJ-2026-014
sourceManifest =
  EPS-001
  QMS-004
  CB-003
  TB-002
  RP-004
  DP-002
projectionType = DOCUMENT_WRITER
coverage = COMPLETE_FOR_PURPOSE
```

### 8.2 WorkOrder

```text
workOrderRef = WO-201
contextSnapshotRef = CTX-302 + payloadHash
target = ART-023 / base REV-001 + contentHash
allowedUnits = supplier classification, evaluation, re-evaluation
expectedOutput = EXACTLY_ONE ContentAddressed ArtifactRevision
forbiddenCapabilities = approval + release authorization
specificationHash = HASH-WO-201
```

### 8.3 AgentResult

```text
agentResultRef = AR-303 + payloadHash
runRef = RUN-302
workOrderRef = WO-201
executionOutcome = COMPLETED
businessOutput.revisedProcedure = REV-002 + contentHash
provenance.context = CTX-302
provenance.workOrder = HASH-WO-201
```

Core 接受 AR-303 后，WorkOrder 可以完成；DeliveryItem 仍未完成。

### 8.4 Artifact Quality

```text
REV-002 → RAS NOT_READY + RI-601/RI-602
REV-003 → RAS-501 READY
REV-003 → ABS-701 FULLY_APPROVED
REL-801 package → RRS-801 READY_FOR_AUTHORIZATION
```

RRS-801 的 Render Result 精确绑定 DOCX/PDF checksums 和 packageHash。REL-801 发布回执不写回 RRS-801，而保存于 Release Aggregate。

---

## 9. Contract 错误语义

```text
CONTRACT_TYPE_UNKNOWN
CONTRACT_MAJOR_UNSUPPORTED
CONTRACT_REQUIRED_FIELD_MISSING
CONTRACT_REQUIRED_EXTENSION_UNKNOWN
CONTRACT_PAYLOAD_HASH_MISMATCH
CONTRACT_SCOPE_MISMATCH
CONTRACT_REFERENCE_INVALID
CONTRACT_REFERENCE_LATEST_FORBIDDEN
CONTRACT_PRESENCE_INVALID
CONTEXT_COVERAGE_INSUFFICIENT
CONTEXT_EPISTEMIC_CONFLICT
WORK_ORDER_SPECIFICATION_HASH_MISMATCH
WORK_ORDER_CAPABILITY_FORBIDDEN
WORK_ORDER_EXPECTED_OUTPUT_INVALID
AGENT_RESULT_RUN_BINDING_MISMATCH
AGENT_RESULT_OUTPUT_SLOT_INVALID
AGENT_RESULT_REPLAY_CONFLICT
REVISION_ACCEPTANCE_NOT_READY
APPROVAL_BUNDLE_INCOMPLETE
RELEASE_PACKAGE_TARGET_MISMATCH
RELEASE_READINESS_NOT_READY
```

错误返回必须包含：

```text
code
contractId
fieldPath?
targetRef?
violatedRule
requiredAction
correlationId
```

---

## 10. Core Contract 设计测试

### 10.1 Project Context

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CC-PC-U-001 | Unit | Context SourceManifest 含 `latest` Template | Contract Validation 拒绝 | NOT RUN：设计阶段 |
| CC-PC-U-002 | Unit | UNKNOWN Fact 被编码为 CONFIRMED/PRESENT | 拒绝 Epistemic Conflict | NOT RUN：设计阶段 |
| CC-PC-U-003 | Unit | REDACTED 字段没有 reason/policy | Contract 无效 | NOT RUN：设计阶段 |
| CC-PC-E-001 | E2E | CB-004 激活后重放 CTX-302 | 仍解析 CB-003，Hash 不变 | NOT RUN：设计阶段 |
| CC-PC-E-002 | E2E | 飞书摘要请求完整受限客户正文 | 输出 Redaction/Deep Link，不泄露正文 | NOT RUN：设计阶段 |

### 10.2 WorkOrder

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CC-WO-U-001 | Unit | Artifact Target 无 base Revision Hash | WorkOrder 不能 READY | NOT RUN：设计阶段 |
| CC-WO-U-002 | Unit | Agent Capability 包含 release.authorize | 拒绝 Human-only Capability | NOT RUN：设计阶段 |
| CC-WO-U-003 | Unit | ExpectedOutput 只有文件路径 | 拒绝，要求 Typed BusinessOutput | NOT RUN：设计阶段 |
| CC-WO-E-001 | E2E | READY 后扩大 allowedUnits | 旧 Contract 不变，必须创建新 WorkOrder | NOT RUN：设计阶段 |
| CC-WO-E-002 | E2E | InformationRequest 解决 | WorkOrder Hash 不变，创建新 ContextSnapshot/Run | NOT RUN：设计阶段 |

### 10.3 AgentResult

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CC-AR-U-001 | Unit | BusinessOutput 使用未注册 objectType | Result 被拒绝 | NOT RUN：设计阶段 |
| CC-AR-U-002 | Unit | outputSlot 不在 WorkOrder | Result Output 无效 | NOT RUN：设计阶段 |
| CC-AR-U-003 | Unit | Workspace DOCX 声称满足 Revision Output | WorkOrder 不完成 | NOT RUN：设计阶段 |
| CC-AR-E-001 | E2E | same resultId/different payloadHash | Quarantine 并记录 Replay Conflict | NOT RUN：设计阶段 |
| CC-AR-E-002 | E2E | late Result 带合法 REV | 保留隔离审计，不处理 Output/Proposal | NOT RUN：设计阶段 |

### 10.4 Artifact + Quality Gate

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CC-AQ-U-001 | Unit | Revision Acceptance 混入 Release Render Gate | 阶段验证拒绝 | NOT RUN：设计阶段 |
| CC-AQ-U-002 | Unit | Approval 引用不同 revision contentHash | Approval Bundle 无效 | NOT RUN：设计阶段 |
| CC-AQ-U-003 | Unit | Release Readiness 未绑定 packageHash | NOT_READY | NOT RUN：设计阶段 |
| CC-AQ-E-001 | E2E | Approved Revision 的 PDF 被同名替换 | checksum 变化，旧 Readiness 不可用于授权 | NOT RUN：设计阶段 |
| CC-AQ-E-002 | E2E | Approval 撤销发生在 Release Authorize 前 | 新 Snapshot STALE/NOT_READY，Authorization 被拒绝 | NOT RUN：设计阶段 |

---

## 11. 实现前待确认

1. Project Context 各 ProjectionType 的字段白名单和内容预算；
2. FEISHU_SUMMARY 可内联的最大敏感等级与摘要长度；
3. WorkOrder Criterion Type v1.0 的最终最小集合；
4. Capability namespace 的注册和 Human-only 默认表；
5. WorkOrder 到期后是否允许只读重放和 Runtime 诊断；
6. AgentResult final submission 是否需要 Runtime Adapter 服务签名；
7. WorkspaceOutput 的默认保留期限；
8. Runtime Usage 与 AgentResult 的最终对账时间窗口；
9. ApprovalBundle 对并行审批的 Snapshot 刷新频率；
10. Renderer/Render Gate 在 PREPARED 前后的自动重试次数；相同冻结 Package 可重试验证，任何 Representation checksum 或 packageHash 改变都必须创建新 Release；
11. ReleaseReadiness AUTHORITATIVE Query 的最大允许缓存时间；
12. Contract Fixture 使用脱敏真实案例还是纯合成数据；建议两者都保留，真实案例必须严格脱敏。

---

## 12. 结论

四个 Contract 形成一条不可漂移的责任链：

```text
Project Context
精确知道什么
    ↓
WorkOrder
精确授权做什么
    ↓
AgentResult
精确收到什么执行结果
    ↓
Artifact + Quality Gate Snapshots
精确证明什么内容可接受、由谁批准、哪个 Package 可发布
```

Human、Agent、飞书、Runtime 和未来 API 可以使用不同呈现方式，但必须回到同一个 Contract ID、Version、Typed Reference 和 Payload Hash。


## IM-06 Core Contract 技术增量

状态：TECHNICAL DESIGN APPROVED 2026-09-08。#152–#154 的已批准选择见 [TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。本轮保持 ProjectContext/WorkOrder/AgentResult v1.0 本体、Hash规则和七类WorkOrder Criterion名称不变。首次Context的Draft Snapshot与build metadata位于Core本体外，Context不反向引用未来frozen Contract；旧build_context_snapshot仍需要精确ContractRef。

TD-01 对 §3.3/3.8/3.10 与 §4.3/4.13 的衔接：先提交 DRAFT WorkOrder 及不可变 Draft Snapshot，再构建只引用已存在 Root 的 Context，最后把已提交 Context 的 exact Ref 纳入完整 candidate 并验证/冻结。不能预写缺 Context 的 frozen Contract，或预分配未来 Hash 以消除依赖。Snapshot 创建不等于 WorkOrder READY；冻结时必须重新核验 Draft pointer、Context 输入绑定和 Validation 对完整 candidate 的 Hash。首次与冻结后请求字段、候选映射和拒绝矩阵由 [Spec 003 §11.2](../module-specs/Module-Spec-003-TaskExecution.md#112-首次-context-的精确输入) 拥有。

Retry 的 Context-2 可以记录新来源，但必须在本体外绑定原 frozen Contract；新 Run 独立引用 Context-2，原 Contract.contextSnapshotRef 仍为 Context-1。不得为了容纳新输入重算原 Contract 的 payloadHash/specificationHash，也不得改写 Context-1 或 Run-1 的固定引用。原 Contract 到期、Scope/Objective/Completion 发生实质变化的既有拒绝规则继续适用。

TD-01 期限补充已于 2026-09-09 获用户批准，尚未实现：§4.3 的可选 expiresAt 原样继承创建 WorkOrder 时的期限，包括是否提供；不允许 Freeze 补值、删值、提前或延后，变更期限须新 WorkOrder。expiresAt 仍位于完整 payloadHash 的覆盖范围内，不进入既有 Objective 至 VersionPins 的 specificationHash 范围；两个 Hash 相同与否均不能替代期限映射和当前有效性检查。Draft Snapshot/Query 的精确输入及 Builder/Validator/Freeze/Run 拒绝规则由 [Spec 003 §11.2.4](../module-specs/Module-Spec-003-TaskExecution.md#1124-创建期限与冻结期限) 拥有。该补充不改变 Core v1.0 字段或历史 Schema；未提供 WorkOrder 期限不能绕过其他授权和 Policy 时限。

TaskDefinition的开放CanonicalJson若收敛为首版typed criteria，采用execution.create_task@2.0，不能收窄旧@1.0。Core §4.9 的inputBindings/expectedCondition/profile机械形状设计在[Spec 003 §11.6](../module-specs/Module-Spec-003-TaskExecution.md#116-workorder-criterion-与-task-v2)，作为已批准的注册Evaluator适配器设计，不改写本Core当前Schema。Readiness/Validation的新事实外壳引用精确Core输入，不能用bool替代Core验证或用bundleHash形成循环引用。新增字段与首版类型限制已获批准，运行验收NOT RUN。
