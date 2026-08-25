# Module-Spec-002-EnterpriseProject

版本：v0.1
日期：2026-08-25
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 DECISION RECORDED / IM-03 WI-02 APPLICATION PERSISTENCE FOUNDATION / IM-03 WI-03 BUSINESS VERTICAL SLICE LANDED / USER REVIEW REQUIRED`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

EnterpriseProject 是 Enterprise、EnterpriseFact、Product、QMSConfiguration、Project、Source/Customer Material、Baseline、RegulatoryProfile、GapAnalysis、DeliveryPlan/Item 及其 Impact/Completion Evaluation 的唯一写入 Owner。它拥有“长期企业事实与项目承诺”，不拥有 Run、Revision 内容、Gate、Approval、Release 或飞书消息。

同步只依赖 IdentityPolicy；下游完成事实通过已提交 Event 和本模块 Process Manager 进入 Completion Evaluation。完整 Project Context 由 TaskExecution 组装，本模块只提供权限裁剪的 Source Slice。

测试规格：[`Module-Test-002-EnterpriseProject.md`](../module-tests/Module-Test-002-EnterpriseProject.md)。共享 API 规则：[`API-Contract-v0.1.md`](../api-contract-v0.1/API-Contract-v0.1.md)。

## 2. 模块类型

```text
EnterpriseStatus = Closed<ACTIVE | SUSPENDED | ARCHIVED>
FactStatus = Closed<PROPOSED | CONFIRMED | DISPUTED | SUPERSEDED>
MaterialCompleteness = Closed<COMPLETE | PARTIAL | UNKNOWN | UNREADABLE>
MaterialStatus = Closed<PRESENT | PARTIAL | MISSING_CONFIRMED | NOT_PROVIDED | UNKNOWN | NOT_APPLICABLE>
GapStatus = Closed<MATCH | MINOR_GAP | MAJOR_GAP | MISSING | EXTRA | UNKNOWN | NOT_APPLICABLE>
RecommendedAction = Closed<KEEP | REVISE | REPLACE | CREATE | REMOVE | NEED_INFORMATION | HUMAN_REVIEW>
DeliveryCommitmentStatus = Closed<PROPOSED | APPROVED | CANCELLED | REPLACED>
DeliveryExecutionStatus = Closed<NOT_READY | READY | IN_PROGRESS | BLOCKED | IN_REVIEW | APPROVED_OUTPUT | RELEASED | COMPLETED>

FactProposal
├── factType: NamespaceCode
├── value: ValueEnvelope<CanonicalJson>
├── sourceRefs: NonEmptySet<TypedReference>
├── validPeriod?: EffectivePeriod
├── riskLevel: NamespaceCode
└── proposalReason: Justification

ProjectStartSnapshot
├── enterpriseProfileSnapshotRef: SnapshotRef<EnterpriseProfile>
├── qmsConfigurationRef: VersionedRef<QMSConfiguration>
├── productScopeSnapshotRef: SnapshotRef<ProductScope>
├── initialCustomerBaselineRef?: VersionedRef<CustomerBaseline>
├── templateBaselineRef?: VersionedRef<TemplateBaseline>
└── regulatoryProfileRef?: VersionedRef<RegulatoryProfile>

SourceMaterialDescriptor
├── originRef: ExternalRef
├── submittedBy: PrincipalRef
├── receivedAt: UtcInstant
├── originalName: Sensitive<NonEmptyString>
├── mediaType: MediaType
├── byteLength: NonNegativeInt
├── checksum: ContentHash
├── stagedObjectRef: ObjectLocator
└── retentionClass: NamespaceCode

MaterialSourceSelection
├── sourceMaterialRef: ContentAddressedRef<SourceMaterial>
├── locator?: NonEmptyString
├── role: NamespaceCode
└── extractionSnapshotRef?: SnapshotRef<Extraction>

CustomerMaterialProposal
├── materialType: NamespaceCode
├── title: NonEmptyString
├── customerDocumentNumber?: NonEmptyString
├── customerVersionLabel?: NonEmptyString
├── effectiveDate?: LocalDate
├── completeness: MaterialCompleteness
├── sourceSelections: NonEmptySet<MaterialSourceSelection>
├── language: LocaleTag
└── classificationRationale: Justification

BaselineExpectation
├── expectationId: UuidV7
├── expectedMaterialKey: NonEmptyString
├── materialType: NamespaceCode
├── expectedTitleOrRole: NonEmptyString
├── status: MaterialStatus
├── customerMaterialRefs: VersionedRef<CustomerMaterial>[]
├── reason: Justification
└── decisionRef?: ContentAddressedRef<BusinessDecision>

TemplateSelection
├── deliveryCategory: NamespaceCode
├── templateRef: ContentAddressedRef<TemplateVersion>
├── applicabilityScope: CanonicalJson
├── selectionReason: Justification
└── replacementFor?: ContentAddressedRef<TemplateVersion>

RegulatoryApplicability
├── regulatoryReferenceRef: ContentAddressedRef<RegulatoryReferenceVersion>
├── applicability: Closed<APPLICABLE | NOT_APPLICABLE | PENDING_DETERMINATION>
├── rationale: Justification
├── evidenceRefs: EvidenceRef[]
└── riskLevel: NamespaceCode

GapInputSnapshot
├── customerBaselineRef: VersionedRef<CustomerBaseline>
├── templateBaselineRef: VersionedRef<TemplateBaseline>
├── regulatoryProfileRef: VersionedRef<RegulatoryProfile>
├── enterpriseProfileSnapshotRef: SnapshotRef<EnterpriseProfile>
├── qmsConfigurationRef: VersionedRef<QMSConfiguration>
├── productScopeSnapshotRef: SnapshotRef<ProductScope>
└── analysisPolicyRef: VersionedRef<Policy>

DeliveryItemDefinition
├── itemId: UuidV7
├── itemKey: NonEmptyString
├── itemType: NamespaceCode
├── title: NonEmptyString
├── objective: NonEmptyString
├── sourceGapItemRefs: NonEmptySet<VersionedRef<GapItem>>
├── dependencyItemIds: Set<UuidV7>
├── targetArtifactTypes: NonEmptySet<NamespaceCode>
├── qualityProfileRef: VersionedRef<QualityProfile>
├── completionCriteria: CanonicalJson
├── dueConstraint?: CanonicalJson
└── commitmentStatus: DeliveryCommitmentStatus

CompletionEvaluationInput
├── deliveryPlanRef: VersionedRef<DeliveryPlan>
├── deliveryItemId: UuidV7
├── criteriaHash: PayloadHash
├── factRefs: NonEmptySet<TypedReference>
├── sourceWatermarks: SourceWatermark[]
├── evaluatorRef: VersionedRef<Evaluator>
└── evaluatedAt: UtcInstant
```

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `project.create_enterprise@1.0` | `Enterprise / CREATE` | `displayCode: NonEmptyString; displayName: NonEmptyString; initialStatus: ACTIVE` | `project.enterprise.create`；Enterprise 是隔离边界，ID 不从名称派生 |
| `project.propose_enterprise_fact@1.0` | `EnterpriseFact / CREATE` | `enterpriseRef: ObjectRef<Enterprise>; proposal: FactProposal` | `project.enterprise_fact.propose`；Agent 只能创建 PROPOSED |
| `project.confirm_enterprise_fact@1.0` | `EnterpriseFact / MUTATE` | `proposalVersionRef: VersionedRef<EnterpriseFact>; confirmedValue: ValueEnvelope<CanonicalJson>; evidenceRefs: NonEmptySet<EvidenceRef>; effectivePeriod?: EffectivePeriod; justification: Justification` | `project.enterprise_fact.confirm`；高风险为 `HUMAN_ONLY`；冲突来源不得覆盖 |
| `project.create_project@1.0` | `Project / CREATE` | `enterpriseRef: ObjectRef<Enterprise>; displayCode: NonEmptyString; title: NonEmptyString; objective: NonEmptyString; startSnapshot: ProjectStartSnapshot; memberPolicyRef: VersionedRef<Policy>` | `project.project.create`；所有 Snapshot/Version 属于同一 Enterprise |
| `project.register_source_material@1.0` | `SourceMaterial / CREATE` | `projectRef: ObjectRef<Project>; descriptor: SourceMaterialDescriptor` | `project.source_material.register`；普通附件只形成原始材料；相同 Hash 不删除不同来源 |
| `project.accept_source_material@1.0` | `SourceMaterial / MUTATE` | `securityValidationRefs: NonEmptySet<ContentAddressedRef<ValidationResult>>; integrityValidationRef: ContentAddressedRef<ValidationResult>; acceptedObjectRef: ObjectLocator; acceptedAt: UtcInstant` | `project.source_material.accept`；需完整性/安全验证；bytes/hash 不可变 |
| `project.propose_customer_material@1.0` | `CustomerMaterial / CREATE` | `projectRef: ObjectRef<Project>; proposal: CustomerMaterialProposal` | `project.customer_material.propose`；至少一个 ACCEPTED Source；状态只能 PROPOSED |
| `project.confirm_customer_material@1.0` | `CustomerMaterial / MUTATE` | `candidateVersionRef: VersionedRef<CustomerMaterial>; completeness: MaterialCompleteness; declaredStatus: NamespaceCode; evidenceRefs: EvidenceRef[]; justification: Justification` | `project.customer_material.confirm`；关键材料 `HUMAN_ONLY`；确认版本不可改 |
| `project.create_customer_baseline_draft@1.0` | `CustomerBaseline / CREATE` | `projectRef: ObjectRef<Project>; previousVersionRef?: VersionedRef<CustomerBaseline>; expectations: NonEmptySet<BaselineExpectation>; baselinePolicyRef: VersionedRef<Policy>` | `project.customer_baseline.create_draft`；NOT_PROVIDED 不得编码为 MISSING_CONFIRMED |
| `project.activate_customer_baseline_version@1.0` | `CustomerBaseline / MUTATE` | `baselineVersionRef: VersionedRef<CustomerBaseline>; reviewSnapshotRef: SnapshotRef<BaselineReview>; impactPolicyRef: VersionedRef<Policy>; justification: Justification` | `project.customer_baseline.activate`；`HUMAN_ONLY`；精确版本且同项目只一个 ACTIVE |
| `project.freeze_template_baseline@1.0` | `TemplateBaseline / MUTATE` | `templateBaselineVersionRef: VersionedRef<TemplateBaseline>; selections: NonEmptySet<TemplateSelection>; reviewSnapshotRef: SnapshotRef<TemplateReview>; selectionRationale: Justification` | `project.template_baseline.freeze`；`HUMAN_ONLY`；禁止 latest，冻结后不可改 |
| `project.activate_regulatory_profile@1.0` | `RegulatoryProfile / MUTATE` | `regulatoryProfileVersionRef: VersionedRef<RegulatoryProfile>; jurisdiction: NamespaceCode; productScopeSnapshotRef: SnapshotRef<ProductScope>; applicabilityItems: NonEmptySet<RegulatoryApplicability>; reviewSnapshotRef: SnapshotRef<RegulatoryReview>` | `project.regulatory_profile.activate`；`HUMAN_ONLY`；模板不能冒充 Evidence |
| `project.start_gap_analysis@1.0` | `GapAnalysis / CREATE` | `projectRef: ObjectRef<Project>; inputSnapshot: GapInputSnapshot; mode: Closed<FORMAL \| EXPLORATORY>; requestedScope: CanonicalJson` | `project.gap_analysis.start`；FORMAL 必须完整版本输入；UNKNOWN 不得变 MISSING |
| `project.accept_gap_analysis@1.0` | `GapAnalysis / MUTATE` | `gapAnalysisVersionRef: VersionedRef<GapAnalysis>; reviewSnapshotRef: SnapshotRef<GapReview>; disposition: Closed<ACCEPT \| REJECT \| CHANGES_REQUIRED>; justification: Justification` | `project.gap_analysis.accept`；`HUMAN_ONLY`；只有 ACCEPT 形成 accepted pointer |
| `project.create_delivery_plan_draft@1.0` | `DeliveryPlan / CREATE` | `projectRef: ObjectRef<Project>; acceptedGapAnalysisRef: VersionedRef<GapAnalysis>; baselineRefs: NonEmptySet<TypedReference>; items: NonEmptySet<DeliveryItemDefinition>; assumptions: SafeSummary[]; exclusions: SafeSummary[]; planQualityPolicyRef: VersionedRef<Policy>` | `project.delivery_plan.create_draft`；baselineRefs 只允许精确 Customer/Template/Regulatory/QMS/Product 版本或快照；Gap 必须 ACCEPTED 或携带独立 Human ExceptionRef |
| `project.approve_delivery_plan@1.0` | `DeliveryPlan / MUTATE` | `deliveryPlanVersionRef: VersionedRef<DeliveryPlan>; reviewSnapshotRef: SnapshotRef<DeliveryPlanReview>; decision: Closed<APPROVE \| CHANGES_REQUIRED \| REJECT>; justification: Justification` | `project.delivery_plan.approve`；`HUMAN_ONLY`；依赖图无环，高风险项有 QualityProfile |
| `project.activate_delivery_plan@1.0` | `DeliveryPlan / MUTATE` | `deliveryPlanVersionRef: VersionedRef<DeliveryPlan>; approvalDecisionRef: ContentAddressedRef<BusinessDecision>; activatedAt: UtcInstant; impactPolicyRef: VersionedRef<Policy>` | `project.delivery_plan.activate`；`HUMAN_ONLY` 或执行精确 Human Decision；同项目只一 ACTIVE |
| `project.evaluate_delivery_item_completion@1.0` | `DeliveryPlan / EVALUATE` | `input: CompletionEvaluationInput` | `project.delivery_item.evaluate_completion`；只接受事实 Ref，不接受调用者 submittedCompletion；输出不可变 Evaluation |

## 4. Query Payload 与 Result Contract

```text
ProjectContextSourceSlice
├── projectRef: ObjectRef<Project>
├── enterpriseProfileSnapshotRef: SnapshotRef<EnterpriseProfile>
├── qmsConfigurationRef: VersionedRef<QMSConfiguration>
├── productScopeSnapshotRef: SnapshotRef<ProductScope>
├── activeBaselineRefs: TypedReference[]
├── factItems: CanonicalJson[]
├── omissions: CanonicalJson[]
├── redactions: CanonicalJson[]
└── sourceWatermark: SourceWatermark

ActiveBaselineRefsView
├── customerBaselineRef?: VersionedRef<CustomerBaseline>
├── templateBaselineRef?: VersionedRef<TemplateBaseline>
├── regulatoryProfileRef?: VersionedRef<RegulatoryProfile>
├── gapAnalysisRef?: VersionedRef<GapAnalysis>
├── deliveryPlanRef?: VersionedRef<DeliveryPlan>
└── aggregateVersions: CanonicalJson

DeliveryItemCriteriaView
├── deliveryPlanRef: VersionedRef<DeliveryPlan>
├── deliveryItemId: UuidV7
├── definition: DeliveryItemDefinition
├── criteriaHash: PayloadHash
├── currentEvaluationRef?: ContentAddressedRef<CompletionEvaluation>
└── executionStatus: DeliveryExecutionStatus

ObjectScopeValidation
├── valid: boolean
├── authoritativeScopeRef?: ScopeRef
├── resolvedRef?: TypedReference
├── lifecycle?: NamespaceCode
└── reasons: ReasonCode[]

ProjectBoardSliceItem
├── deliveryItemId: UuidV7
├── itemKey: NonEmptyString
├── title: NonEmptyString
├── commitmentStatus: DeliveryCommitmentStatus
├── executionStatus: DeliveryExecutionStatus
├── completionEvaluationRef?: ContentAddressedRef<CompletionEvaluation>
└── blockerRefs: TypedReference[]
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `project.get_project_context_source@1.0` | S | `projectRef: ObjectRef<Project>; purpose: NamespaceCode; audience: PrincipalRef; requestedKinds: Set<NamespaceCode>; asOf?: UtcInstant` | `ProjectContextSourceSlice`；只返回本模块 Source Slice |
| `project.get_enterprise_profile_snapshot@1.0` | A | `enterpriseProfileSnapshotRef: SnapshotRef<EnterpriseProfile>` | `CanonicalJson` + exact SnapshotRef；不得 current/latest |
| `project.get_active_baseline_refs@1.0` | A | `projectRef: ObjectRef<Project>` | `ActiveBaselineRefsView` |
| `project.get_delivery_item_criteria@1.0` | A | `deliveryPlanRef: VersionedRef<DeliveryPlan>; deliveryItemId: UuidV7` | `DeliveryItemCriteriaView` |
| `project.validate_object_scope@1.0` | A | `objectRef: TypedReference; expectedScopeRef: ScopeRef; purpose: NamespaceCode` | `ObjectScopeValidation`；不得跨企业搜索替代对象 |
| `project.get_project_board_slice@1.0` | P | `projectRef: ObjectRef<Project>; statuses: Set<DeliveryExecutionStatus>; itemTypes: Set<NamespaceCode>; page: PageRequest` | `Page<ProjectBoardSliceItem>`；Projection 延迟不得用于 Completion Command |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `project.SourceMaterialAccepted@1.0` | `sourceMaterialRef: ContentAddressedRef<SourceMaterial>; projectRef: ObjectRef<Project>; originRef: ExternalRef; acceptedAt: UtcInstant` |
| `project.CustomerMaterialConfirmed@1.0` | `customerMaterialRef: VersionedRef<CustomerMaterial>; projectRef: ObjectRef<Project>; materialType: NamespaceCode; completeness: MaterialCompleteness; confirmationDecisionRef: ContentAddressedRef<BusinessDecision>` |
| `project.CustomerBaselineVersionActivated@1.0` | `customerBaselineRef: VersionedRef<CustomerBaseline>; previousActiveRef?: VersionedRef<CustomerBaseline>; projectRef: ObjectRef<Project>; impactPolicyRef: VersionedRef<Policy>` |
| `project.GapAnalysisAccepted@1.0` | `gapAnalysisRef: VersionedRef<GapAnalysis>; projectRef: ObjectRef<Project>; inputSnapshotRef: SnapshotRef<GapInput>; acceptanceDecisionRef: ContentAddressedRef<BusinessDecision>` |
| `project.DeliveryPlanActivated@1.0` | `deliveryPlanRef: VersionedRef<DeliveryPlan>; previousActiveRef?: VersionedRef<DeliveryPlan>; projectRef: ObjectRef<Project>; itemRefs: NonEmptySet<VersionedRef<DeliveryItem>>` |
| `project.DeliveryItemActivated@1.0` | `deliveryPlanRef: VersionedRef<DeliveryPlan>; deliveryItemRef: VersionedRef<DeliveryItem>; criteriaHash: PayloadHash; qualityProfileRef: VersionedRef<QualityProfile>` |
| `project.DeliveryItemCompletionSatisfied@1.0` | `deliveryItemRef: VersionedRef<DeliveryItem>; evaluationRef: ContentAddressedRef<CompletionEvaluation>; satisfiedFactRefs: NonEmptySet<TypedReference>; satisfiedAt: UtcInstant` |
| `project.DeliveryItemImpactReviewRequested@1.0` | `deliveryItemRef: VersionedRef<DeliveryItem>; triggeringRef: TypedReference; priorEvaluationRef?: ContentAddressedRef<CompletionEvaluation>; impactReason: ReasonCode` |

Event 不复制客户原文、Enterprise Fact value 或完整 DeliveryPlan；Consumer 按权限解析精确 Ref。

## 6. 模块错误码

```text
PROJECT_ENTERPRISE_NOT_ACTIVE
PROJECT_FACT_SOURCE_REQUIRED
PROJECT_FACT_CONFIRMATION_FORBIDDEN
PROJECT_FACT_CONFLICT_UNRESOLVED
PROJECT_START_SNAPSHOT_INCOMPLETE
PROJECT_SOURCE_CONTENT_IMMUTABLE
PROJECT_SOURCE_NOT_TRUSTED
PROJECT_MATERIAL_SOURCE_INVALID
PROJECT_MATERIAL_NOT_CONFIRMED
PROJECT_BASELINE_STATUS_INVALID
PROJECT_MISSING_CONFIRMATION_REQUIRED
PROJECT_BASELINE_VERSION_IMMUTABLE
PROJECT_MULTIPLE_ACTIVE_BASELINES
PROJECT_TEMPLATE_LATEST_FORBIDDEN
PROJECT_TEMPLATE_BASELINE_IMMUTABLE
PROJECT_REGULATORY_EVIDENCE_REQUIRED
PROJECT_REGULATORY_APPLICABILITY_CONFLICT
PROJECT_GAP_INPUT_INCOMPLETE
PROJECT_GAP_EPISTEMIC_CONFLICT
PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED
PROJECT_DELIVERY_DEPENDENCY_CYCLE
PROJECT_DELIVERY_PLAN_IMMUTABLE
PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED
PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED
PROJECT_COMPLETION_IS_DERIVED
```

## 7. 不变量与持久化边界

1. Enterprise 是隔离边界；Project、Material、Baseline、Gap、Plan 和 Item 不可迁移 Scope。
2. SourceMaterial bytes/hash 只读；Attachment 不自动确认 CustomerMaterial、Fact 或 Evidence。
3. `NOT_PROVIDED != MISSING_CONFIRMED`；UNKNOWN 不得被自动解释为 MISSING。
4. 冻结 Version/Snapshot 不改写；新 Baseline/Profile/Plan 不改变旧 Context、Gap、Artifact 或 Release。
5. GapAnalysis 是建议；只有授权 Human 决定才能成为 accepted input。
6. DeliveryPlan/Item 范围由 Human 批准；Agent 只能起草或提议。
7. Delivery Completion 只由精确 criteria + fact refs + evaluator 产生，Task/Run/Agent 自报不能直接完成。
8. 下游状态通过 Event/Process Manager 进入本模块，不允许跨 Schema Join 或 Repository 写入。

## 8. 可人工验收的模块产出

里程碑 `API-EP-01` 的人工产出是脱敏“采购控制程序”Fixture：上传不完整资料后分别形成 SourceMaterial、CustomerMaterial、CustomerBaseline；未收到培训程序保持 NOT_PROVIDED/UNKNOWN；Human 接受 Gap 并批准 DeliveryPlan 后才出现交付承诺；后续新 Baseline 不改写旧版本。该审核不代表对象存储、PostgreSQL、飞书或真实业务流程已运行。

## 8.1 IM-03 WI-01 受控前置 Capability

Issue #57 的字段/语义决策见 [`../issue-57-enterpriseproject/Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md)。EnterpriseProject 除本文件第 3—5 节的 32 个公开 Contract 外，还必须由 Application 层提供受控入口：Product 根/版本/激活与 ProductScopeSnapshot、QMSConfiguration Revision/激活与回滚、EnterpriseProfileSnapshot，以及 Platform Template/Regulatory Reference 的导入/发布。

这些入口必须保留唯一 Owner、授权 purpose、Human-only 边界、精确 Version/Snapshot/Content Hash、Scope 校验、失败码、Audit 和后续 Outbox 事实；不得由测试 Fixture、Migration seed 或跨 Schema Join 代替。它们暂不进入 200 项公开 Catalog，因此不在本 Module Spec 的公开操作表中增加 `@1.0` 名称；若要公共化，必须先通过用户审核和兼容性同步 Gate。

ProjectStartSnapshot 的三个必需输入是同一 Enterprise Scope 下的 `EnterpriseProfileSnapshotRef`、`QMSConfigurationVersionRef` 和 `ProductScopeSnapshotRef`。输入变化只使旧 Gap 进入 `STALE`/Impact Review，不覆盖旧 Gap、Context、Plan 或 Artifact；QualityProfile/Evidence 等 IM-05 Ref 只验证强引用边界，不跨 Schema Join。

## 9. 当前状态

- 32 个公开 Contract 已定义字段级 payload/result/event 结构；Issue #57 另行冻结受控前置 Capability，但没有扩展公共 Registry；
- API v0.1 已于 2026-08-13 通过用户审核；
- IM-02 标准技术表已落地并有独立验证；IM-03 WI-02 已提供模块内 Application/Persistence 事务基础（Command Receipt、Audit、Outbox、Reference Edge、RLS Context 绑定与 CAS），但仍不存在业务 DDL、业务 Handler、Evaluator、Projection 与受控 Capability 实现；
- 对应业务 Unit、Contract、E2E 与人工验收均为 `NOT RUN`；本 Issue 的决策矩阵为 `DESIGN VERIFIED / USER REVIEW REQUIRED`。
- PR #69 的精确审查 head 为 `9c02ac80491b3d60c59685c2ea1ac33ce875981c`，未包含业务运行时代码；该 head 的 exact-head CI `verify` 已通过。当前本地 persistence gate 复跑受 Docker Hub manifest 查询 EOF 阻塞，不能替代 CI 证据或提升业务实现状态。

## 10. IM-02 WI-04 持久化切片

EnterpriseProject owning Schema 独立拥有八张标准事务技术表。nullable Project Scope 按行选择 Enterprise/Project RLS；Process Step 不得跨 Project 关联父 Process；Reference Edge 的 owner version 属于唯一身份；masked audit surface 必须可读已提交行且不暴露底表敏感列。

## 11. IM-03 WI-02 Application/Persistence 事务基础

Issue #58 在模块内建立最小写入事务路径，供后续业务切片复用，且不创建业务表：

1. `withEnterpriseProjectTransaction` 在同一连接上先以 `platform_context_establisher` 建立 WI-03 RLS Context，再切换 `enterprise_project_app`。Context 随事务提交/回滚消失，连接池不得泄漏。
2. Command Envelope 必须绑定可信 `principalId`、`actorSnapshotId`、`authorizationDecisionId` 与 `policySnapshotId`。本模块不 import IdentityPolicy，也不复制其 Repository；组成层必须先走 IdentityPolicy 公开 Decision/Query Port。
3. `(idempotency_scope, idempotency_key)` 由数据库裁决：相同 Hash 返回稳定结果；不同 Hash 拒绝且不改写首个 Receipt。
4. 一个 Aggregate Root 一个事务：Receipt、技术 CAS、Audit、Outbox 与 Reference Edge 同事务提交；body 失败则全部回滚。
5. Canonical JSONB ↔ SHA-256 Hash 与提升 `enterpriseId`/`projectId` 列必须一致，否则写入边界拒绝。
6. CAS 目前作用在已有 `process_instance.aggregate_version` 技术表；WI-03 业务 Aggregate 落地前不得把该 CAS 写成业务状态机 `PASS`。
7. Outbox Event 的 `aggregateType + aggregateId` 必须等于 Command Envelope target；CREATE/无 expected version 的事件版本必须为 `1`，CAS 事件版本必须为 `expectedAggregateVersion + 1`，否则拒绝 `COMMAND_TARGET_MISMATCH`。
8. Reference Edge 的 owner type/id 必须等于 Command Envelope target；不能借同一事务为另一个 Aggregate 建立派生引用索引。
9. technical Repository 写入的 `created_by_principal_id` 必须等于受信事务 Context Principal；主体漂移以稳定持久化错误拒绝，且不提交 Receipt 或技术行。

失败码：`IDEMPOTENCY_PAYLOAD_CONFLICT`、`CONCURRENCY_CONFLICT`、`COMMAND_CONTEXT_MISMATCH`、`COMMAND_CONTEXT_EXPIRED`、`COMMAND_CONTEXT_REJECTED`、`COMMAND_TARGET_MISMATCH`、`PAYLOAD_HASH_MISMATCH`。模块业务 Handler、Evaluator 与 Projection 不在本切片。

## 12. IM-03 WI-03 业务纵向切片

Issue #59 在 WI-02 Application/Persistence 事务基础上落地业务 Aggregate：Enterprise、EnterpriseFact（含不可变 Version）、EnterpriseProfileSnapshot、Product（含不可变 ProductVersion 与 ProductScopeSnapshot）、QMSConfiguration（含不可变 QMSConfigurationRevision）。Migration 文件 `V2001__enterprise_project_business_aggregates.sql`，所有业务表启用 RLS FORCE 并使用与 V2000 相同的 `platform_security.context_allows_enterprise(...)` Policy；不可变 version/snapshot 行通过 `REVOKE UPDATE` + BEFORE UPDATE trigger 双层保护。

业务 Aggregate Root 自带 `aggregate_version` 列；CAS 直接作用在 Root，不再借道 `process_instance.aggregate_version`。`product_version.lifecycle ∈ {CURRENT, HISTORICAL}` 与 `qms_configuration_revision.lifecycle` 配合 partial unique index `(product_id) WHERE lifecycle='CURRENT'` 实现 "同根只有一个 CURRENT 指针"；Profile Snapshot / Product Scope Snapshot 没有 active 指针，由 Project 启动引用精确 ID。

新增 14 个业务失败码：

```
PROJECT_ENTERPRISE_NOT_ACTIVE
PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT
PROJECT_FACT_SOURCE_REQUIRED
PROJECT_FACT_CONFIRMATION_FORBIDDEN
PROJECT_FACT_CONFLICT_UNRESOLVED
PROJECT_PROFILE_SOURCE_MISMATCH
PROJECT_PROFILE_SNAPSHOT_IMMUTABLE
PROJECT_PRODUCT_VERSION_NOT_FOUND
PROJECT_PRODUCT_VERSION_IMMUTABLE
PROJECT_PRODUCT_ACTIVATION_HUMAN_REQUIRED
PROJECT_PRODUCT_ACTIVATION_NOOP
PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID
PROJECT_QMS_DECISION_SOURCE_REQUIRED
PROJECT_QMS_REVISION_IMMUTABLE
PROJECT_QMS_ACTIVATION_HUMAN_REQUIRED
PROJECT_QMS_VERSION_NOT_FOUND
PROJECT_HUMAN_ONLY_DENIED
```

Human-only 边界由 Handler 入口的 `principalKind` 决定；非 HUMAN 主体走 `PROJECT_HUMAN_ONLY_DENIED` 短路。重复激活同 version 在 Application 层返回 `PROJECT_PRODUCT_ACTIVATION_NOOP`/`PROJECT_PRODUCT_ACTIVATION_NOOP`，再叠加 V2001 partial unique index 的 DB 防御。

`enterprise.display_code` `UNIQUE`、CAS 跨 Enterprise Ref 拒绝、hash mismatch、旧 expectedVersion 等负向路径由 `tests/persistence/enterprise-project-business-aggregates.test.ts` 在真实 PostgreSQL 上覆盖；用户手动 Probe 在 WI-04 补齐之前保持 `NOT RUN`。
