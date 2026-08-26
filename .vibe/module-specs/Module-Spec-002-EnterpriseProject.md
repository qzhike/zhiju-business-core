# Module-Spec-002-EnterpriseProject

版本：v0.5
日期：2026-08-26
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 DECISION RECORDED / IM-03 WI-02 APPLICATION PERSISTENCE FOUNDATION / IM-03 WI-03 PR #72 REVIEW REPAIRED / IM-03 WI-04 PROJECT START SNAPSHOT LANDED / IM-03 WI-05 SOURCE MATERIAL IMPLEMENTATION LANDED / IM-03 WI-06 CUSTOMER MATERIAL PERSISTENCE VERIFIED / IM-03 WI-07 CUSTOMER BASELINE LANDED / IM-03 WI-08 TEMPLATE REGULATORY IMPLEMENTATION VERIFIED / IM-03 WI-09 GAP ANALYSIS IMPLEMENTATION VERIFIED / ISSUE #64 CLOSEOUT PENDING / ISSUE #65 CLOSEOUT PENDING / PR #75 MERGED / PR #77 MERGED / ISSUE #62 CLOSED / ISSUE #63 CLOSED`

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
- IM-02 标准技术表已落地并有独立验证；IM-03 WI-02 已提供模块内 Application/Persistence 事务基础，PR #72 已在其上落地并完成本次审查修正；业务 DDL、Repository、Handler 的本地自动化边界已由 `pnpm verify` 证明。
- 真实 Provider、HTTP、跨模块业务 E2E 与人工验收仍为 `NOT RUN`；用户确认修正工作区前，不宣称 PR/Issue 已完成 Git 交付。
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

WI-03 业务失败码（含审查修正新增的冲突与 QMS NOOP 码，共 19 个）：

```
PROJECT_ENTERPRISE_NOT_ACTIVE
PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT
PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT
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
PROJECT_QMS_ACTIVATION_NOOP
PROJECT_HUMAN_ONLY_DENIED
```

Human-only 边界由受信 transaction context 与 Command Envelope 中一致且必填的 `principalKind` 决定；缺失或非 HUMAN 主体均走 `PROJECT_HUMAN_ONLY_DENIED` 短路。Product 与 QMS 重复激活分别返回 `PROJECT_PRODUCT_ACTIVATION_NOOP` / `PROJECT_QMS_ACTIVATION_NOOP`，再叠加 V2001 partial unique index 的 DB 防御。所有 `ObjectRef`、`VersionedRef`、`SnapshotRef` 必须校验 objectType、objectId、version/snapshotId、Scope 和 contentHash；不能只使用 versionId。

`enterprise.display_code` `UNIQUE`、CAS 跨 Enterprise Ref 拒绝、hash mismatch、旧 expectedVersion 等负向路径由 `tests/persistence/enterprise-project-business-aggregates.test.ts` 在真实 PostgreSQL 上覆盖；用户手动 Probe 在 WI-04 补齐之前保持 `NOT RUN`。

## 13. IM-03 WI-04 Project 启动快照、Scope 与对象验证

Issue #60 在 WI-02 事务基础和 WI-03 业务纵向切片之上落地 Project Aggregate、ProjectScopeClaim 和 ProjectSnapshotBinding 三张业务表，并落地 `project.create_project` Handler 与 `project.validate_object_scope` 权威 Query。该切片为所有 Project-owned 切片建立不可迁移的 Enterprise/Project 边界。

1. Project Aggregate Root 写入 V2003 `enterprise_project.project`：`(enterprise_id, project_id)` 为复合不可变 Scope；`memberPolicyRef` 在创建时固化，后续更新路径无法 rebind；`display_code` 在同一 Enterprise 内 `UNIQUE`，跨 Enterprise 允许相同字符串。V2004 必须把 Project INSERT RLS 与 `context_allows_enterprise(enterprise_id)` 绑定。
2. ProjectScopeClaim（V2003 `enterprise_project.project_scope_claim`）是其他模块查询 `(enterprise_id, project_id)` 复合关系的唯一权威；`(project_id)` 与 `(enterprise_id, project_id)` 双唯一约束，scope mirror trigger 在写入前拒绝 payload 与列不一致。V2005 修正 ProjectSnapshotBinding 的 JSON scope mirror，必须从 jsonb object 使用 `->'scope'->>'enterpriseId'` 读取，不能先用 `->>` 转成 text 再继续取字段。
3. ProjectSnapshotBinding（V2003 `enterprise_project.project_snapshot_binding`）是 Project 启动时冻结的精确 `ProjectStartSnapshot`：EnterpriseProfileSnapshotRef、QMSConfigurationRef、ProductScopeSnapshotRef、可选 CustomerBaseline/TemplateBaseline/RegulatoryProfile refs，以及 memberPolicyRef 全部固化；binding purpose 封闭为 `PROJECT_START`，整表 `REVOKE UPDATE, DELETE` 给 app role；`(project_id, binding_purpose)` `UNIQUE` 保证同 Project 不会被替换 binding。
4. RLS 三表均 `FORCE ROW LEVEL SECURITY`：project 与 binding 使用 `context_allows_project(enterprise_id, project_id)`；Scope Claim 同时校验 Enterprise 与 Project helper。三张表的 INSERT policy 还必须绑定当前受信 Principal 与 `context_allows_enterprise(enterprise_id)`；Enterprise-only Context 不能看到 Project-owned 行；Project 行不能跨 Project 枚举。
5. `project.create_project` Handler 在同一事务内执行：(a) 校验 StartSnapshot 三必填 ref 与可选 ref 的 shape（objectType/scope/contentHash），拒绝 `latest` / `current` 与跨 Enterprise Scope；(b) Handler 生成 Project UUIDv7 后，把它同时绑定到 Command Envelope 的 `projectId` 和本次事务的 allowed-project 集合，使 Receipt/Outbox/Reference Edge 与 Project Root 使用同一精确 Scope；(c) 重新读取持久化快照行二次校验 hash；(d) 通过固定保存点和 `(enterprise_id, display_code)` 唯一约束处理重复 Project，不使用会触发新行 RLS 可见性要求的 `ON CONFLICT` 或 `RETURNING`，Project ID 直接使用应用已生成的 UUIDv7；(e) 写入 Project Root、ProjectScopeClaim、ProjectSnapshotBinding，canonical payload 对未提供的可选 ref 直接省略，不得写入 `undefined`；(f) 写一条 Outbox `Enterprise.ProjectCreated` 事件；(g) 写 Reference Edge 链接 StartSnapshot 与 memberPolicy。`VersionedRef` 不含 `contentHash`，member policy 没有 digest 时持久化 NULL，不得写入伪造全零 hash。失败码见下方。
6. `project.validate_object_scope` Query 是权威 scope 校验：仅接受 `OBJECT`/`VERSIONED`/`CONTENT_ADDRESSED`/`SNAPSHOT` 类型 Ref；按 `objectType` 使用闭集表/列映射，精确匹配 objectId 与对应的 versionId/snapshotId，再按 `expectedScopeRef` 走 RLS helper 在数据库内查 `(enterprise_id, project_id)`；不允许使用通用 `object_id`，也不允许在 Enterprise/Project 间搜索替代对象。

WI-04 失败码（6 个）：

```
PROJECT_PROJECT_DISPLAY_CODE_CONFLICT
PROJECT_START_SNAPSHOT_INCOMPLETE
PROJECT_START_SNAPSHOT_SCOPE_MISMATCH
PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN
PROJECT_MEMBER_POLICY_REF_INVALID
PROJECT_OBJECT_SCOPE_MISMATCH
```

`Project` 表通过 BEFORE UPDATE trigger 阻止任何对 `enterprise_id` / `project_id` / `member_policy_*` 列的写；`ProjectSnapshotBinding` 通过 `REVOKE UPDATE, DELETE` 给 app role 实现不可写。Project Aggregate CAS 通过 `casProject` 仅作用 `aggregate_version`，不接受任何对 Scope 列的"迁移"语义。WI-04 业务 DDL、Repository、Handler 由 `tests/persistence/enterprise-project-scope.test.ts` 在真实 PostgreSQL 上覆盖；用户手动 Probe 在 WI-05/06 之前保持 `NOT RUN`，业务实现可由 Issue #60 评审决定进入下一步 PR。

## 14. IM-03 WI-05 SourceMaterial 登记、验证与接受

Issue #61 在 WI-04 的 Project Scope 基础上落地 SourceMaterial 的最小业务闭环。该切片不新增公共 Catalog Contract；复用第 3、5 节已经冻结的 `project.register_source_material@1.0`、`project.accept_source_material@1.0` 和 `project.SourceMaterialAccepted@1.0`。

### 14.1 状态与持久化形态

- 登记命令创建一个 Project-owned `source_material` Root，初始 `custody_status=RECEIVED`、`processing_status=NOT_PROCESSED`、`aggregate_version=1`；它只表示系统收到了一份原始材料，不表示业务分类或客户事实已经确认。
- Root 保存 `enterprise_id + project_id`、`original_name`、`media_type`、`byte_length`、原始 bytes 的 `content_hash`、`staged_object_ref`、`retention_class` 和不可变 descriptor payload hash。`original_name` 只留在受控持久化记录中，不进入普通 Result/Event。
- `source_material_origin` 是每次来源关系的 INSERT-only 历史，保存完整 `ExternalRef`、来源引用的 canonical hash、Project Scope 和接收时间。来源撤回不物理删除该记录或 SourceMaterial。
- `source_material_validation` 是每次 Security/Integrity 检验的 INSERT-only 事实，保存 `validation_id`、`validation_kind`、`outcome`、被检 ObjectLocator、被检 bytes 的 ContentHash/长度、validator 版本、脱敏 canonical payload 和 payload hash。它不保存客户原文或 bytes。
- 同一 Project 内相同 `content_hash` 的新登记保留新的 Root 和 Origin；Root 可记录 `duplicate_of_source_material_id` 作为追溯提示，但不合并、覆盖或删除原来源。

### 14.2 接受边界

`project.accept_source_material` 必须携带精确 `expectedAggregateVersion`，并在一个 EnterpriseProject 事务中完成：读取受 RLS 保护的 Root；校验非空 Security Validation Ref 集合和 Integrity Validation Ref；逐一验证 `CONTENT_ADDRESSED<ValidationResult>` Ref 的 object id、Project/Enterprise Scope、SHA-256/1 payload hash；再确认持久化 Validation 属于该 SourceMaterial、结果为 `PASSED`、被检 ObjectLocator 等于 `acceptedObjectRef`、被检 ContentHash/长度等于 Root。只有全部条件满足时才执行 Root CAS 到 `ACCEPTED`，否则返回 `PROJECT_SOURCE_NOT_TRUSTED`/`PROJECT_MATERIAL_SOURCE_INVALID` 的安全拒绝，不能写接受 Event。

已 `ACCEPTED` 的 Root 再次使用新的幂等键接受时返回 `PROJECT_SOURCE_ALREADY_ACCEPTED`；同一幂等键和相同请求 hash 重放由 WI-02 Receipt 返回 `DUPLICATE`，同一幂等键和不同请求 hash 仍返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`。CAS 失败不使用 last-write-wins。

### 14.3 不可变与安全边界

- Root 的 Scope、Origin 关系、原始文件名、MediaType、ByteLength、ContentHash、StagedObjectLocator、RetentionClass 和 Duplicate 关系在登记后不可原地修改；Root 仅开放受控状态/Accepted Locator/AcceptedAt/aggregate version 更新。
- Origin 与 Validation 表对 `enterprise_project_app` 撤销 UPDATE/DELETE，并由触发器/约束保护 Scope、Hash 长度和枚举值；Root 撤销 DELETE，避免接受链破坏审计历史。
- 三张业务表均启用 FORCE RLS，所有读写使用 `context_allows_project(enterprise_id, project_id)`；跨 Project Ref、Validation Scope、SourceMaterial Scope 和 RLS 可见性不一致时不得搜索或替代另一个对象。
- `SourceMaterialAccepted` Outbox payload 仅包含 `sourceMaterialRef`（原始 ContentHash）、`projectRef`、`originRef` 和 `acceptedAt`，另带技术表要求的 promoted Scope；不得包含 `originalName`、客户原文、bytes、Staged ObjectLocator 或完整 Validation payload。该 Event 只触发后续分类，不自动创建 CustomerMaterial、Baseline、Fact 或 Evidence。

### 14.4 WI-05 失败码

本切片复用 `PROJECT_SOURCE_CONTENT_IMMUTABLE`、`PROJECT_SOURCE_NOT_TRUSTED`、`PROJECT_MATERIAL_SOURCE_INVALID`，并新增 `PROJECT_SOURCE_ALREADY_ACCEPTED`。新增错误只用于稳定业务拒绝，不携带原始 payload、ObjectLocator 或敏感文件名。

## 15. IM-03 WI-06 CustomerMaterial 提议、确认与不可变版本

Issue #62 在已接受 SourceMaterial 之上落地 CustomerMaterial 的最小业务闭环。该切片复用第 3、5 节已经冻结的 `project.propose_customer_material@1.0`、`project.confirm_customer_material@1.0` 和 `project.CustomerMaterialConfirmed@1.0`，不新增公共 Catalog Contract。

### 15.1 Root、Version 与 Decision

- `project.propose_customer_material` 必须接收同一 Project Scope 的 `projectRef`，并逐一验证 `proposal.sourceSelections`：引用必须是精确 `CONTENT_ADDRESSED<SourceMaterial>`，Enterprise/Project Scope 与事务 Context 一致，ContentHash 为 SHA-256/1 且与数据库 SourceMaterial 完全一致，SourceMaterial 状态必须为 `ACCEPTED`；SourceMaterial 当前不发布业务 `immutableVersionId`，因此携带该可选字段也必须拒绝。Selection 的 `locator` 只表示源内页码/章节等内部位置，不能替代受控 accepted object locator。
- 提议成功创建 `customer_material` Root 和 v1 `customer_material_version`。Root 的 `classification_status=PROPOSED`、`aggregate_version=1`、`current_version_id=v1`；Version 保存完整分类字段、完整性、Source Selection、语言、理由和 payload hash。多个 Root 可以引用同一个已接受 SourceMaterial，以保留不同解析/分类候选。
- `project.confirm_customer_material` 必须接收精确 `VERSIONED<CustomerMaterial>` 候选，并确认它仍是 Root 的当前 `PROPOSED` Version。确认不更新 v1，而是追加 v2 `CONFIRMED` Version，Root 使用 CAS 从 1 推进到 2 并指向 v2；v1/v2 的分类、来源和 payload 均不可覆盖。
- 确认决定写入不可变 `customer_material_decision`，以精确 Decision ContentAddressedRef 进入 `CustomerMaterialConfirmed` Event。Decision 保存 Human actor、Authorization Decision、Evidence Ref、Justification 和 canonical payload hash，不保存客户原文。
- 当前没有低风险自动确认 Policy 输入，因此所有确认均为 Human-only。Agent 可提议但不能确认；`actingFor` 不能改变可信 Context 中的 `principalKind`。

### 15.2 冲突、证据与失败码

- 确认前必须检查当前 Project 内其他 `PROPOSED` CustomerMaterial 当前 Version。若共享任一 SourceMaterial 且分类指纹（materialType、title、customerDocumentNumber、customerVersionLabel、effectiveDate、completeness、language 及规范化 Source Selection）不同，则返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`；不修改任何候选、不选择 last-write-wins、不产生确认 Event。
- `evidenceRefs` 以及 `justification.evidenceRefs` 可以为空但若存在必须是当前 Enterprise/Project Scope 的合法精确 Ref；每一条证据通过 Reference Edge 保存 target object/version/hash，理由和决定通过 Decision 行保存。结果和 Event 不复制标题、客户版本号、客户原文、ObjectLocator 或完整 Evidence Payload。
- 稳定失败码：`PROJECT_MATERIAL_SOURCE_INVALID`（Source 缺失、未接受、跨 Scope、Hash/Ref 不匹配）、`PROJECT_MATERIAL_VERSION_NOT_FOUND`（候选不是精确 CustomerMaterial Version）、`PROJECT_MATERIAL_CONFIRMATION_CONFLICT`（候选不是当前可确认状态或 CAS 目标不一致）、`PROJECT_MATERIAL_CONFLICT_UNRESOLVED`（冲突分类待处理）；Agent/Human-only 拒绝复用 `PROJECT_HUMAN_ONLY_DENIED`。

### 15.3 持久化与事务边界

- `V2007__customer_material_proposal_confirmation.sql` 新增 `customer_material`、`customer_material_version` 和 `customer_material_decision` 三张 Project-owned 表。Root Scope/创建字段由 trigger 保护；Version/Decision 对 `enterprise_project_app` 撤销 UPDATE、DELETE；三表均 FORCE RLS 并使用 `context_allows_project(enterprise_id, project_id)`。
- 提议事务按“校验 Project 与已接受 Source → Claim Receipt → Root + v1 → Source/Project Reference Edge → Audit/Receipt → Commit”执行；确认事务按“Human-only/精确候选/冲突检查 → Claim Receipt → v2 + Decision → Root CAS → Reference Edge → 最小 CustomerMaterialConfirmed Outbox → Audit/Receipt → Commit”执行。
- Command Runner 的同 Key/同 Hash Replay 返回原 Result；同 Key/不同 Hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`。业务拒绝不写业务版本或确认 Event，CAS 冲突不使用 last-write-wins。

### 15.4 WI-06 可人工验收产出与边界

脱敏 Fixture 必须支持：一份 `ACCEPTED` SourceMaterial 产生 CustomerMaterial `PROPOSED`；Human 确认后只新增不可变确认 Version 并出现最小 `CustomerMaterialConfirmed` Event；尝试 UPDATE/DELETE 确认 Version 或重放旧候选时得到拒绝；Agent 确认得到 Human-only 拒绝；跨 Project/未接受/错误 Hash Source Ref 不泄漏客户数据。真实 Feishu、OCR/LLM、Evidence 验证、对象存储、公开 HTTP、跨模块 E2E 和人工 Reference Project 验收保持 `NOT RUN`。

### 15.5 WI-06 交付闭环

- [PR #75](https://github.com/qzhike/zhiju-business-core/pull/75) 以 commit `3141928df48b3be097ff554bc7b96ee933d727c1` 为 exact head，目标为 `main`；GitHub Actions `verify` 通过后，以 merge commit `e7cfee14b699b0574abf6899a0291bc9ea706f90` 合并。
- Issue [#62](https://github.com/qzhike/zhiju-business-core/issues/62) 已由合并动作关闭，并已通过 GitHub API 读取为 `closed`；远端 feature branch 和本地已合并 feature branch 均已删除，`main` 已同步到 merge commit。
- WI-06 的自动化、Disposable PostgreSQL、Provider/生产/公开 HTTP/跨模块 E2E/独立人工 Reference Project 验收边界仍按本节和 Module-Test 的 `PASS`/`NOT RUN` 记录执行。

## 16. IM-03 WI-07 CustomerBaseline 三态缺失与影响评审

Issue #63 在 CustomerMaterial 确认版本之上落地 CustomerBaseline 的最小可交付闭环，复用已冻结的 `project.create_customer_baseline_draft@1.0`、`project.activate_customer_baseline_version@1.0`、`project.get_active_baseline_refs@1.0` 和 `project.CustomerBaselineVersionActivated@1.0`，不新增公共 Catalog Contract。Issue 验收文字中的 `KNOWN` 不是本模块闭集值；实现将其按领域规范映射为 `PRESENT/PARTIAL`，并保留 `UNKNOWN` 的未知语义。

### 16.1 Root、Version、Item 与 Impact Review

- `customer_baseline` 是 Project-owned Aggregate Root。一个 Project 只能有一个 CustomerBaseline identity；Root 保存 `current_version_id`、可空 `active_version_id` 和字符串化 PostgreSQL `bigint aggregate_version`。Root CAS 只允许推进版本和指针，不允许迁移 Enterprise/Project Scope。
- `customer_baseline_version` 是不可变版本载体。草稿创建 `DRAFT` 版本；Human 激活在同一事务中把当前版本转为 `CONFIRMED`，不修改 payload、policy ref、previous ref 或任何条目内容。旧 active 版本保留为历史事实，新的 active 状态只由 Root pointer 表达。
- `customer_baseline_item` 使用 `expectation_id` 作为不可变 Item 身份，保存 `status`、`customer_material_refs`、可选 `decision_ref`、`reason` 和条目 payload hash。`PRESENT/PARTIAL` 需要至少一个同 Project、`CONFIRMED` 的 CustomerMaterial Version；`NOT_PROVIDED/UNKNOWN` 需要空材料 refs 且不带 Decision；`MISSING_CONFIRMED/NOT_APPLICABLE` 需要空材料 refs 和精确 Decision Ref。
- `customer_baseline_impact_review` 是激活产生的 INSERT-only 事实，保存触发的新版本、旧 active 版本、review snapshot、impact policy、受影响 Reference Edge 的脱敏精确快照、`STALE` 影响标记和 payload hash。它不更新 Gap/Plan/Context，也不伪造尚未实现的下游 Process Manager。

### 16.2 Command、权限与幂等

- `project.create_customer_baseline_draft` 必须携带同 Project Scope 的 `projectRef`、非空且 expectation key 唯一的条目集合和精确 `baselinePolicyRef`。首次创建生成 Root/v1；后续创建必须携带当前 active 的精确 `previousVersionRef` 和 Root expected version。Agent 可创建 `NOT_PROVIDED/UNKNOWN` 草稿。
- Agent 在任何条目请求 `MISSING_CONFIRMED` 时返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`，不得通过 `actingFor` 改变可信主体；Human 才能提交此状态。Handler 仍要求 `decisionRef`，以免仅凭“没有上传文件”制造确认缺失。
- `project.activate_customer_baseline_version` 必须携带精确当前 DRAFT Version、Review Snapshot、Impact Policy 和 Justification；只接受可信 `principalKind=HUMAN`。Root CAS 失败返回 `CONCURRENCY_CONFLICT`，不使用 last-write-wins；成功 Event 的 `previousActiveRef` 只在存在旧 active 时出现。
- `project.get_active_baseline_refs` 只返回 Root 的精确 active VersionedRef 和 aggregate version；没有 active 版本时省略 CustomerBaseline ref，不把 draft/current 候选冒充 active。

### 16.3 Contract、数据库与事务防线

- 冻结的 `enterprise-project@1.0` Contract 对 BaselineExpectation 负责闭集状态枚举、引用形状、字段类型和 `additionalProperties=false`；跨字段的状态/refs/Decision 组合由 Handler 的精确校验与数据库 CHECK 共同执行，不在本 Issue 中静默重写兼容基线。后续若升级公共 Contract 版本，必须单独记录兼容性审批。
- `V2008__customer_baseline_impact_review.sql` 新增四张业务表并为 Root/Version/Item/Impact Review 配置 Scope mirror、组合外键、不可变触发器、FORCE RLS 和最小 app-role grants。Version/Item/Impact Review 不允许应用删除历史；Root 不允许删除 identity。
- Draft/Activation 的 Receipt、Audit、Reference Edge、Root/Version/Item/Impact Review 和 `CustomerBaselineVersionActivated` Outbox Event 在一个 EnterpriseProject 事务中提交。Outbox/Event aggregate version 与 Root CAS 精确一致；旧 Version/旧 Reference Edge 不被重写。

### 16.4 失败码与验收边界

WI-07 复用 `PROJECT_HUMAN_ONLY_DENIED`、`CONCURRENCY_CONFLICT`，并使用以下稳定业务错误：

```text
PROJECT_BASELINE_STATUS_INVALID
PROJECT_MISSING_CONFIRMATION_REQUIRED
PROJECT_BASELINE_VERSION_IMMUTABLE
PROJECT_MULTIPLE_ACTIVE_BASELINES
PROJECT_BASELINE_VERSION_NOT_FOUND
```

自动化必须实际覆盖 EP-API-U-001（Agent 缺失确认）、EP-API-C-002（Activated Event 精确 refs/无正文）、EP-API-E-002（CB-004 激活后 CB-003 旧 refs 保留且只追加 stale/impact 事实），并在真实 PostgreSQL 中覆盖 RLS、CHECK、CAS 并发、幂等、不可变和回滚。真实 Gap/Plan/Context Process Manager、Provider、HTTP、跨模块业务 E2E、生产和独立人工 Reference Project 验收仍为 `NOT RUN`。

### 16.5 WI-07 实际验证结果（2026-08-26）

- `pnpm test`：22 个测试文件通过、14 个 PostgreSQL 条件文件在无数据库 URL 时跳过；`351 passed / 215 skipped`。
- `pnpm persistence:gate`：PostgreSQL `18.6` / Flyway `11.20.3`；17 个 Persistence 文件、`229 passed / 0 failed`；空库迁移、二次 migrate no-op、V2008 应用和容器清理通过。
- 独立 disposable probe：Agent `MISSING_CONFIRMED` 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；CB-003 输出 `PRESENT/UNKNOWN/NOT_PROVIDED`；CB-004 激活后旧引用 `5` 条保留，Impact Review 输出 `STALE/3`，active version 切换到 CB-004。
- `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check` 均为 `PASS`；公共 Contract 仍为 `200` operations，未扩展公共 Catalog。

### 16.6 WI-07 exact-head closeout（2026-08-26）

- PR [#77](https://github.com/qzhike/zhiju-business-core/pull/77) 以 exact head `e71300055fdd40051dc24d1e8d76003c3f32ccc1` 通过 GitHub `verify` CI，并以 merge commit `f63ae2a373c312790c550957ac3aa51c0cf603dd` 合并到 `main`。
- PR review comment [#5420888555](https://github.com/qzhike/zhiju-business-core/pull/77#issuecomment-5420888555) 和 Issue closeout comment [#5420896539](https://github.com/qzhike/zhiju-business-core/issues/63#issuecomment-5420896539) 均已通过 API 读回。
- Issue [#63](https://github.com/qzhike/zhiju-business-core/issues/63) 已读取为 `CLOSED`；`e713000...` 已验证为 `origin/main=f63ae2a...` 的 ancestor；`galendai/im-03-wi-07-customerbaseline` 远端和本地 branch 均已删除。

## 17. IM-03 WI-08 TemplateBaseline 与 RegulatoryProfile

Issue #64 的实现边界如下，受控 Capability 不加入公共 Catalog：

- Platform Template/Regulatory Reference 由 `enterprise_project_platform_reference_writer` 写入；普通 `enterprise_project_app` 只读已发布版本。平台业务表没有 `enterprise_id` 或 `project_id`，保留技术 Scope 只用于事务 Context、Audit、Receipt、Outbox 和 RLS。
- TemplateBaseline 与 RegulatoryProfile 都使用 Project-owned Root、不可变 `FROZEN` Version 和 INSERT-only 条目。Root 仅以 expected aggregate version CAS 推进 current/active pointer；同一 Project 的 identity 唯一。
- Template Selection 必须是已发布 Platform Template 的精确 `CONTENT_ADDRESSED` ref；Regulatory Profile Item 必须是已发布 Platform Regulatory Reference 的精确 ref。ref 的 object id、immutable/version id、SHA-256、canonicalization 和 scope 必须与数据库事实逐项一致，禁止 `latest`、display label 或跨 Project 替代。
- Regulatory EvidenceRef 必须引用独立证据对象；`TemplateVersion`、`ReferenceTemplateVersion`、`RegulatoryReferenceVersion` 不能作为 Evidence。非 `PENDING_DETERMINATION` 的 applicability 必须带证据，`PENDING_DETERMINATION` 与高风险组合按稳定错误拒绝。
- 两个 Project command 都要求可信 Human Context，写入 Version、条目、Reference Edge、Audit、Receipt、Outbox 必须同事务提交；失败必须回滚全部业务事实。
- 平台导入只创建或追加 `DRAFT`，平台发布只允许精确 DRAFT→PUBLISHED；PUBLISHED 的内容与引用字段不可更新。平台发布和项目冻结/激活均不读取“当前最新”作为业务输入。
- `PROJECT_TEMPLATE_LATEST_FORBIDDEN`、`PROJECT_TEMPLATE_BASELINE_IMMUTABLE`、`PROJECT_REGULATORY_EVIDENCE_REQUIRED`、`PROJECT_REGULATORY_APPLICABILITY_CONFLICT`、`PROJECT_PLATFORM_REFERENCE_UNPUBLISHED`、`PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH`、`PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED`、`PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED`、`PROJECT_PLATFORM_REFERENCE_INVALID`、`PROJECT_TEMPLATE_VERSION_NOT_FOUND`、`PROJECT_REGULATORY_PROFILE_VERSION_NOT_FOUND`、`PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH` 为本切片稳定错误。

### 17.1 Active baseline refs convergence

既有 `project.get_active_baseline_refs@1.0` 继续作为读取入口。实现使用同一 `enterprise_project_app` Project Context 事务，读取 CustomerBaseline、TemplateBaseline 和 RegulatoryProfile 的 active pointer，并只返回精确的 `VERSIONED` refs 与 aggregate versions。缺少某个 root 或 active pointer 时省略该可选 ref；不得读取 latest、draft 或仅由平台 root current pointer 推导的替代版本。该收敛不新增 Catalog operation。

并发激活的错误优先级固定为：若目标 Version 状态检查发现已被另一事务改变，必须重新读取 Root；Root aggregate version 已变化时返回 `CONCURRENCY_CONFLICT`，只有 Root 仍为期望版本时才报告目标历史不可变。

本地 PostgreSQL 验收 fixture 为每个测试生成唯一的 Platform Template/Regulatory identity；同一 identity 内的 v1/v2 导入才允许共享 reference code，确保唯一性约束不会造成跨用例假失败。

Reference Edge 的 target payload hash 是可选派生字段：Object/Versioned ref 未携带 ContentHash 时跳过该列；只有格式正确的 SHA-256/1 digest 才可落库。

交付前必须重新通过格式、Lint、类型、架构边界和 Contract baseline 静态检查；静态检查失败时仅记录为未完成，不得宣称 Issue 可关闭。当前静态门禁已全部通过；最终 PostgreSQL 复核必须覆盖每个 Platform 版本的内容/来源 Reference Edge，以及首次 Project Root 并发创建的冲突安全性。

最终测试还必须覆盖事务前的 Platform source/hash/capability 拒绝，以及非 Human Project principal 的 Human-only 拒绝；这些用例不得创建 Receipt、Root 或 Version 副作用。

最终实现验证：Platform Template/Regulatory 的 DRAFT→PUBLISHED、Project TemplateBaseline/RegulatoryProfile 的 exact frozen chain、Root CAS/首次 Root race、FORCE RLS、ACL/immutable guards、Receipt/Audit/Outbox/Reference Edge 和既有 active refs query 均由 disposable PostgreSQL 覆盖。静态门禁全部通过；`pnpm persistence:gate` 为 `18 files / 234 passed / 0 failed`。该状态代表实现已验证，仍不代表外部 Provider、公开 HTTP、生产或人工验收已运行。

当前自动化目标是 Unit/Contract、真实 PostgreSQL DDL/RLS/CHECK/CAS/幂等/不可变/回滚和受控本地 E2E；Provider、公开 HTTP、真实法规来源、跨模块 Process Manager、生产和独立人工 Reference Project 继续保持 `NOT RUN`，直到有独立证据。

## 18. IM-03 WI-09 GapAnalysis 冻结输入、Human 接受与 stale

Issue #65 复用当前已冻结的两个 Command 和一个 Accepted Event，不新增公共 Contract。实现必须把 GapAnalysis 作为建议性 Aggregate，不把 finding 或推荐动作直接写成 DeliveryPlan、DeliveryItem 或其他项目承诺。

### 18.1 输入与受控 evaluator

`project.start_gap_analysis@1.0` 的 `inputSnapshot` 必须包含以下七个精确引用：

| 引用 | 业务 Scope | Handler 必须验证的事实 |
|---|---|---|
| `customerBaselineRef` | Enterprise + Project | Root/version 精确匹配；Version 为 `CONFIRMED`；不得使用 `latest` |
| `templateBaselineRef` | Enterprise + Project | Root/version 精确匹配；Version 为 `FROZEN`；不得使用 `latest` |
| `regulatoryProfileRef` | Enterprise + Project | Root/version 精确匹配；Version 为 `FROZEN`；不得使用 `latest` |
| `enterpriseProfileSnapshotRef` | Enterprise | `objectId == snapshotId`，且 Snapshot id 和 `contentHash` 与数据库事实一致 |
| `qmsConfigurationRef` | Enterprise | QMS root/revision 精确匹配；不得用 current/latest 替代显式 version |
| `productScopeSnapshotRef` | Enterprise | Snapshot id 和 `contentHash` 与数据库事实一致 |
| `analysisPolicyRef` | Enterprise + Project | `Policy` 的 typed version ref、Scope 和 version id 形状合法 |

输入引用缺失、携带 `latest`/current label、Scope 错误、Snapshot hash 错误、引用对象不属于目标 Project 或冻结版本状态不正确时，必须在创建任何 Gap 事实前拒绝。`mode` 只能取 `FORMAL` 或 `EXPLORATORY`，其他运行时值必须以稳定 `PROJECT_GAP_STATUS_INVALID` 拒绝。`EXPLORATORY` 不代表可以省略 v1.0 Contract 的必填输入；它只允许受控 evaluator 将证据不足的结果保留为 `UNKNOWN`。

v1 evaluator 只接受 `requestedScope` 中的确定性 canonical fixture：可选 `findings` 数组的每个元素必须有稳定 `findingId`、`subjectKey`、`subjectType`、闭集 `gapStatus`、`severity`、`rationale` 和 `recommendedAction`，引用数组必须使用当前 Scope 的合法 Typed Reference。`UNKNOWN` 必须保持 `UNKNOWN`；`MISSING` 不能用来替代未确认的未知事实；高风险或 `MAJOR_GAP` finding 必须携带 Evidence 或明确的信息请求。summary 只能由规范化的 finding 集合派生，不能由调用方提交的数字覆盖。

### 18.2 物理事实与不可变边界

WI-09 新增以下 Project-owned 表：

| 表 | 事实 | 可变边界 |
|---|---|---|
| `gap_analysis` | Root、current/accepted pointer、aggregate version、当前状态 | 仅受控 CAS 更新 pointer、状态、审计时间和 last command |
| `gap_analysis_input_snapshot` | 七个精确输入、规范化引用和 snapshot payload hash | INSERT-only |
| `gap_analysis_version` | mode、requested scope、派生 summary、version payload/hash、状态 | 内容 INSERT-only；只允许受控状态迁移及 `STALE` impact metadata |
| `gap_finding` | 不可变 finding 明细、引用集合、状态、严重度、建议 | INSERT-only；禁止 UPDATE/DELETE |
| `gap_analysis_decision` | review snapshot、disposition、justification、Human actor、decision hash | INSERT-only；禁止 UPDATE/DELETE |

所有表使用 FORCE RLS、Enterprise/Project Scope mirror、组合外键和 deferred Root pointer guard。Version、Finding、InputSnapshot 和 Decision 不得通过 SQL 或 Repository 原地改写；完成版本的任何内容修订都必须产生新 Version。Root CAS 失败返回 `CONCURRENCY_CONFLICT`，不得采用 last-write-wins。

### 18.3 Command、Decision 与 Event

`start_gap_analysis` 在同一事务中写入 Root/v1、InputSnapshot、Finding、Reference Edge、Receipt、Audit 和内部 `GapAnalysisCompleted` outbox fact。`accept_gap_analysis` 必须携带精确 `VERSIONED<GapAnalysis>`、`SNAPSHOT<GapReview>`、disposition 和 Justification，并绑定当前 Root aggregate version。

接受命令执行前后均以受信事务 Context 的 `principalKind` 为准：Agent、Service、`actingFor`、伪造 request actor 和跨 Project Context 均拒绝。`ACCEPT` 在同一事务中追加不可变 Decision、更新 Version/Root 状态和 accepted pointer，并写入公共 `project.GapAnalysisAccepted@1.0`；Event 只包含精确 Gap、Project、InputSnapshot 和 Decision refs，不复制 finding 或客户正文。`REJECT` 与 `CHANGES_REQUIRED` 追加 Decision 并更新状态，但 accepted pointer 必须保持 NULL。

### 18.4 stale 与 Impact 语义

CustomerBaseline、TemplateBaseline 或 RegulatoryProfile 的新激活版本提交后，EnterpriseProject 内的受控 Impact 过程按 InputSnapshot 的精确 normalized ref 找到依赖 Gap，将旧 Version 标记为 `STALE`，并在 Version 的 stale metadata 与对应 Impact Review/Reference Edge 事实中保存触发对象、旧版本和新版本的安全精确引用。旧 finding、input snapshot、decision、Context、Plan 和 Artifact 不被修改或删除；新分析必须由显式 `start_gap_analysis` 创建。QMS、ProductScope、EnterpriseProfile 和 Policy 的更新遵循同一规则，Provider/跨模块 Process Manager 尚不在本切片范围。

### 18.5 WI-09 稳定错误与测试边界

除既有公共错误外，本切片至少使用以下稳定错误：`PROJECT_GAP_INPUT_INCOMPLETE`、`PROJECT_GAP_EPISTEMIC_CONFLICT`、`PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED`、`PROJECT_GAP_VERSION_NOT_FOUND`、`PROJECT_GAP_VERSION_IMMUTABLE`、`PROJECT_GAP_SCOPE_MISMATCH`、`PROJECT_GAP_INPUT_HASH_MISMATCH`、`PROJECT_GAP_STATUS_INVALID`、`PROJECT_GAP_FINDING_IMMUTABLE`、`PROJECT_GAP_DECISION_CONFLICT`。Unit/Contract、Disposable PostgreSQL 和受控本地 E2E 需要覆盖缺输入/latest/scope/hash、UNKNOWN、Finding 不可变、Human/Agent/actingFor、Accepted Event exact refs、REJECT/CHANGES_REQUIRED、幂等、并发 CAS、回滚和新 Baseline 后旧 Gap stale。真实 Provider、公开 HTTP、生产和独立人工验收保持 `NOT RUN`。

Persistence gate 使用 `tag@manifest digest` 的 immutable image reference；除检查容器实际 RepoDigest 外，还必须验证 registry 当前 tag 解析到同一 manifest digest。发现 tag 漂移时，只能更新受核验的 pin 并重新完成本地与远端 exact-head gate，不能删除或放宽一致性检查。
