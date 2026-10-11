# Module-Spec-002-EnterpriseProject

版本：v0.8
日期：2026-08-27
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IM-03 COMPLETE (SCOPED TECHNICAL ACCEPTANCE) / SYNTHETIC COMPOSED CONTROLLED PERSISTENCE PASS / ISSUE #56–#68 CLOSED / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / #176 CAPTURE POLICY RESOLUTION APPROVED 2026-09-12 DESIGN VERIFIED / IM-06 (#188) CAPTURE AND READ IMPLEMENTED LOCAL PERSISTENCE PASS / IM-06 (#191) RESOLUTION RECEIPT ATTESTATION IMPLEMENTED LOCAL PERSISTENCE PASS / #202 TASK CREATION PROJECT SCOPE PORT APPROVED 2026-09-15 DESIGN VERIFIED NOT IMPLEMENTED / EXTERNAL NOT RUN`

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
PROJECT_CAPTURE_POLICY_UNSUPPORTED
PROJECT_CAPTURE_POLICY_NOT_USABLE
PROJECT_CAPTURE_PURPOSE_FORBIDDEN
PROJECT_CAPTURE_VALIDITY_INVALID
PROJECT_CAPTURE_RESULT_INVALID
PROJECT_CAPTURE_SLICE_ALREADY_EXISTS
```

IM-06 Source Slice capture/read 另复用 `PROJECT_QUERY_REF_INVALID`、`PROJECT_QUERY_SCOPE_MISMATCH`、`PROJECT_QUERY_AUDIENCE_INVALID`、`PROJECT_QUERY_PURPOSE_FORBIDDEN`、`PROJECT_QUERY_CONTEXT_EXPIRED`、`PROJECT_QUERY_NOT_FOUND` 与共享 `AUTHORIZATION_DECISION_INVALID` / `DEPENDENCY_UNAVAILABLE`，不新增平行生命周期或第二套引用码。完整的 WI-11/WI-12 稳定码面见 §20.7、§21.4 与 IM-06 一节。

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

Issue #57 的字段/语义决策见 [EnterpriseProject Capability 决策](../decisions/enterprise-project-capabilities.md)。EnterpriseProject 除本文件第 3—5 节的 32 个公开 Contract 外，还必须由 Application 层提供受控入口：Product 根/版本/激活与 ProductScopeSnapshot、QMSConfiguration Revision/激活与回滚、EnterpriseProfileSnapshot，以及 Platform Template/Regulatory Reference 的导入/发布。

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

### 13.1 Task 创建期的 Project/DeliveryItem 校验 Port（#202 提案）

状态：`T2 / APPROVED 2026-09-15 / INDEPENDENT DESIGN REVIEW APPROVE / HUMAN DESIGN APPROVAL RECORDED / IMPLEMENTED (#204)`。本节是 [Issue #202](https://github.com/qzhike/zhiju-business-core/issues/202) 对 WI-04 边界的 additive 设计增量，方案、备选与批准记录见[决定 §15](../decisions/task-execution-human-operated.md#15-task-draft-创建引用与持久化边界提案202)，消费方字段与时机由 [Spec 003 §16](../module-specs/Module-Spec-003-TaskExecution.md#16-task-draft-创建引用与持久化边界202-设计)。本节**不改变** §13 已交付的 `project.validate_object_scope@1.0` 接受集、错误外观、RLS 与任何公开 Schema。实现入口为 `createTaskExecutionCreationProjectScopePort`（`business/task-execution-creation-scope-port.ts`）：只读证明在 EP 自己的 RLS 事务内执行，对外只返回 `VALID`/`INVALID`，内部原因类写 EP `audit_record`（`TASK_CREATION_SCOPE_KIND_MISMATCH`、`TASK_CREATION_SCOPE_IDENTITY_MISMATCH`、`TASK_CREATION_SCOPE_SCOPE_MISMATCH`、`TASK_CREATION_SCOPE_NOT_VISIBLE`、`TASK_CREATION_SCOPE_LIFECYCLE_INVALID`），不写业务表。消费侧的引用拒绝与真实 PostgreSQL 验证见 [Spec 003 §16.9](../module-specs/Module-Spec-003-TaskExecution.md#169-实现事实与验证边界2042026-09-15) 与 Module-Test-003 `TE-P202-*`；该 Port 的 `CANCELLED`/`REPLACED` DeliveryItem 分支在 v1 事实边界内无合法生产路径（`delivery_item_commitment_closed` 与 `delivery_item_initial_commitment` 把该列固定为 `PROPOSED`，且 `V2013` 的 immutable guard 拒绝其 UPDATE），保持 `NOT RUN`。

**归属与形态**：EnterpriseProject 拥有内部只读 Port `TaskExecutionCreationProjectScopePort`。它不是公开 Command/Query，不进 Catalog，不新增公开 operation 或 objectType；TaskExecution 只消费其结果，不读 EP Repository、表或跨 Schema Join。

**输入**：`(commandType, commandVersion, projectRef, deliveryItemRef?)`。两个 Ref 必须与消费方已接受的 payload 逐字节相同；期望的 `objectType`/kind/表/列由 Port 内部按 `commandType@commandVersion` 取值，**不接受调用者传入**。受信上下文（`enterpriseId`、`allowedProjectIds`、principal、AuthorizationDecision id/hash/expiry、correlation）由组合层从已验证 Decision 行构造，Port 在自己的 RLS 事务内执行。

**闭集键表**（Port 自有，与公开 Query 的键表分离）：

| `commandType@commandVersion` | `projectRef.objectType` | `deliveryItemRef.objectType` | 目标表 |
|---|---|---|---|
| `execution.create_task@1.0` | `project.project` | `project.delivery_item` | `enterprise_project.project` / `enterprise_project.delivery_item` |
| `execution.create_task@2.0` | `zhiju.project.project` | `zhiju.project.delivery_item` | 同上 |

键表只用于创建边界；Port 复用与 `project.validate_object_scope@1.0` 相同的 SELECT 与 RLS helper 语义（`context_allows_enterprise` / `context_allows_project`，RLS 为最终权威），不复制第二份查询实现，也不把 canonical 拼写或 `DeliveryItem` 加入公开 Query 的接受集合。

**证明谓词**（EP 权威）：

- Project identity：`projectRef.objectId == projectRef.scope.projectId == 受信 projectId`，且 `projectRef.scope.enterpriseId == 受信 enterpriseId`。两个 `create_task` Schema 只能约束 Ref 形状（v2 另有 objectType `const`），无法表达这些 UUID 的跨字段相等，因此该相等必须在 Port 内强制；不得用“受信 projectId 上存在任意 ACTIVE Project 行”代替。
- Project existence/lifecycle：在受信 `(enterpriseId, projectId)` 内存在已提交 `enterprise_project.project` 行，且 `status = 'ACTIVE'`；身份不符、不存在、跨 Enterprise、跨 Project、`SUSPENDED`、`ARCHIVED` 一律拒绝，外观一致，不区分“不存在”与“不可见”。
- DeliveryItem identity：`deliveryItemRef` 的 `objectId`/`versionId`/`scope.enterpriseId`/`scope.projectId` 必须与行 `(delivery_item_id, version_id, enterprise_id, project_id)` 逐字段相等，且 `commitment_status NOT IN ('CANCELLED','REPLACED')`；不允许只比较对象 id，也不允许用受信 Project 内的任意 DeliveryItem 行代替。

**失败映射**：Port 返回闭集稳定结果（`VALID` / `INVALID`）；identity/kind/scope/existence/lifecycle 的内部原因写入受权限控制的 Audit，不进入公开错误，也不泄露其他 Scope 对象是否存在。消费方把业务拒绝收敛为自己的稳定码；Port 不可用或超时**不得**被解释为空结果或默认通过，消费方 fail closed 并映射共享 `DEPENDENCY_UNAVAILABLE`。

**事务与历史行为**：Port 是只读调用，不授予 TaskExecution 任何 EP 写权限，也不建立跨 Schema 事务或 FK；历史 `project.validate_object_scope@1.0` 调用、其 13 个裸本地名接受集与其结果/错误语义完全不变。若未来需要公开接受 canonical 拼写，必须作为独立 additive 契约提案批准。

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
- TemplateBaseline 首次 Root 创建竞争中，相同或不同候选 baselineId 的两个合法命令均只能提交一个；输家返回 `REJECTED / CONCURRENCY_CONFLICT`，不得泄露 Root 主键唯一约束异常。冲突处理必须保持 Command Runner 事务可用，保存拒绝 Receipt/Audit，不产生 Version、Selection、pointer、Reference Edge 或成功 Outbox 的部分写入；无关唯一约束、Scope/授权和其他数据库错误保留原有失败语义。
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

接受命令执行前后均以受信事务 Context 的 `principalKind` 为准：Agent、Service、`actingFor`、伪造 request actor 和跨 Project Context 均拒绝。接受命令必须对 Root 使用事务内的行锁并以最新行重新判断 expected aggregate version；并发输家不得因已提交 Version 状态先可见而返回 Decision conflict，必须返回 `CONCURRENCY_CONFLICT`。`ACCEPT` 在同一事务中追加不可变 Decision、更新 Version/Root 状态和 accepted pointer，并写入公共 `project.GapAnalysisAccepted@1.0`；Event 只包含精确 Gap、Project、InputSnapshot 和 Decision refs，不复制 finding 或客户正文。`REJECT` 与 `CHANGES_REQUIRED` 追加 Decision 并更新状态，但 accepted pointer 必须保持 NULL。

### 18.4 stale 与 Impact 语义

CustomerBaseline、TemplateBaseline 或 RegulatoryProfile 的新激活版本提交后，EnterpriseProject 内的受控 Impact 过程按 InputSnapshot 的精确 normalized ref 找到依赖 Gap，将旧 Version 标记为 `STALE`，并在 Version 的 stale metadata 与对应 Impact Review/Reference Edge 事实中保存触发对象、旧版本和新版本的安全精确引用。旧 finding、input snapshot、decision、Context、Plan 和 Artifact 不被修改或删除；新分析必须由显式 `start_gap_analysis` 创建。QMS、ProductScope、EnterpriseProfile 和 Policy 的更新遵循同一规则，Provider/跨模块 Process Manager 尚不在本切片范围。

### 18.5 WI-09 稳定错误与测试边界

除既有公共错误外，本切片至少使用以下稳定错误：`PROJECT_GAP_INPUT_INCOMPLETE`、`PROJECT_GAP_EPISTEMIC_CONFLICT`、`PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED`、`PROJECT_GAP_VERSION_NOT_FOUND`、`PROJECT_GAP_VERSION_IMMUTABLE`、`PROJECT_GAP_SCOPE_MISMATCH`、`PROJECT_GAP_INPUT_HASH_MISMATCH`、`PROJECT_GAP_STATUS_INVALID`、`PROJECT_GAP_FINDING_IMMUTABLE`、`PROJECT_GAP_DECISION_CONFLICT`。Unit/Contract、Disposable PostgreSQL 和受控本地 E2E 需要覆盖缺输入/latest/scope/hash、UNKNOWN、Finding 不可变、Human/Agent/actingFor、Accepted Event exact refs、REJECT/CHANGES_REQUIRED、幂等、并发 CAS、回滚和新 Baseline 后旧 Gap stale。真实 Provider、公开 HTTP、生产和独立人工验收保持 `NOT RUN`。

Persistence gate 使用 `tag@manifest digest` 的 immutable image reference；除检查容器实际 RepoDigest 外，还必须验证 registry 当前 tag 解析到同一 manifest digest。发现 tag 漂移时，只能更新受核验的 pin 并重新完成本地与远端 exact-head gate，不能删除或放宽一致性检查。

### 18.6 WI-09 exact-head closeout

WI-09 已通过 [PR #81](https://github.com/qzhike/zhiju-business-core/pull/81) 的 corrected exact head `6de5c96c4ba4fe0938b422606d4632048ac19932` 合并，merge commit 为 `2d6afd0cc2889cf0fa6350c0599d514d5917b071`；GitHub Actions [run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309) 的 `verify` 为 `PASS`。Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已显式关闭；远端和本地 WI-09 feature branch 均已删除，`origin/main` 已验证包含实现 head。真实 Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工验收仍为 `NOT RUN`。
## 19. IM-03 WI-10 DeliveryPlan/DeliveryItem Human 批准与激活

Issue #66 在已接受的 GapAnalysis 和精确 Baseline/Policy 引用之上，落地 DeliveryPlan/DeliveryItem 的最小纵向切片。公共 `project.create_delivery_plan_draft@1.0`、`project.approve_delivery_plan@1.0`、`project.activate_delivery_plan@1.0`、`project.get_delivery_item_criteria@1.0`、`project.DeliveryPlanActivated@1.0` 和 `project.DeliveryItemActivated@1.0` 的字段不扩展；本模块补齐 owning Schema、Repository、Handler、真实 PostgreSQL 约束和回归测试。

### 19.1 输入与起草

`create_delivery_plan_draft` 允许可信 Agent/Human/Service 起草，但所有引用必须是显式、完整且可解析的 typed ref：

| 输入 | Handler 约束 |
|---|---|
| `acceptedGapAnalysisRef` | `VERSIONED<GapAnalysis>`；同一 Project；精确 Version 状态为 `ACCEPTED`；不得用 latest/current 或其他 Gap 替代 |
| `baselineRefs` | 必须恰好覆盖 Accepted Gap InputSnapshot 的五个 normalized baseline refs，且无重复；只接受同一 Scope 的已激活 CustomerBaseline、TemplateBaseline、RegulatoryProfile，以及 Enterprise Scope 的精确 QMS/Product snapshot refs；逐项校验 object/version/hash/status |
| `items[].sourceGapItemRefs` | 非空；所有 `GapItem` 属于同一 accepted Gap Version、同一 Project；未知、跨 Scope 或未接受 Gap 一律拒绝 |
| `items[].qualityProfileRef` | 精确 `VERSIONED<QualityProfile>`，Scope 与 Item/Project 一致；高风险 Item 不得缺失或降级为 label |
| `items[].dependencyItemIds` | 只能引用同一 Plan Version 的 item；拒绝 self、unknown、duplicate 和有向环 |
| `planQualityPolicyRef` | 精确 `VERSIONED<Policy>`；Scope、version id 和 canonical ref 逐项验证 |

Item 的 `itemId`、`itemKey`、title、objective、source Gap refs、target artifact types、commitment status、completion criteria 和可选 due constraint 在创建时规范化；同一 Plan Version 内 item id/key 必须唯一，`commitmentStatus` 初始只能是 `PROPOSED`。每个 target artifact type 生成一个不可变 `DeliveryItemArtifactRequirement`，本切片只登记要求，不创建 Artifact、Task 或 Release。

### 19.2 事实模型与不可变边界

EnterpriseProject owning Schema 新增 `delivery_plan`、`delivery_plan_version`、`delivery_item`、`delivery_item_artifact_requirement`、`delivery_item_dependency` 和 `delivery_plan_decision`。Plan Root 保存 current/approved/active pointer 与 aggregate version；Plan Version 保存精确 Gap/Baseline/Policy refs、assumptions/exclusions、规范化 payload/hash 和状态；Item 保存 criteria 与 `criteriaHash`。Version、Item、Requirement、Dependency 和 Decision 均为 INSERT-only 事实，Approved/Active 内容不可原地修改。任何 Scope、criteria、依赖或 artifact requirement 变化都必须创建新的 Plan Version/identity，旧版本及其 hash 保留。

Root 通过 expected aggregate version CAS 更新状态和 pointer；同一 Project 只允许一个 ACTIVE Plan。激活旧 Plan 时旧 Root/Version 仅转为 `SUPERSEDED` 并清除 active/approved pointer，旧 Item、Dependency、Requirement、Decision 和引用边不删除。Root pointer/status deferred guard 必须保证 pointer、Version、Scope 和状态相互一致；组合 FK 和 FORCE RLS 必须阻断跨 Enterprise/Project 读写。

### 19.3 Human Decision、Command 和 Event

`approve_delivery_plan` 必须由可信 Human 执行，并拒绝 Agent、Service、`actingFor`、伪造 request actor 和跨 Project context。`APPROVE` 才设置 approved pointer；`CHANGES_REQUIRED`/`REJECT` 仍追加不可变 Decision，但 approved pointer 必须保持 NULL。Decision ref 绑定精确 Plan Version、Review Snapshot、Justification、Human actor 和 payload hash。

`activate_delivery_plan` 只接受可信 Human，或携带精确且已持久化的 Human `APPROVE` Decision 的受控 Service 执行。Plan Version、approval Decision、Impact Policy、activatedAt 和 expected aggregate version 必须精确匹配；Agent 不能通过 `actingFor` 或 payload actor 提权。激活在同一事务中完成旧 active 收敛、目标 Version/Root CAS、Reference Edge、Receipt、Audit 和最小 Event 写入：`DeliveryPlanActivated` 只携带 Project/Plan/item refs 与 previous active ref；每个 `DeliveryItemActivated` 只携带 Plan/Item ref、criteria hash 和 QualityProfile ref，不复制 Gap finding、客户材料、baseline 正文或 criteria JSON。

### 19.4 查询、稳定错误和验证边界

`project.get_delivery_item_criteria` 只接受精确 Plan Version ref 与 item id，返回 definition、criteriaHash、`NOT_READY` execution projection 和可选 current evaluation ref；不提供 latest/current 模糊解析，也不把 completion 当作 Item 自报状态。

WI-10 至少使用以下稳定错误：`PROJECT_DELIVERY_GAP_NOT_ACCEPTED`、`PROJECT_DELIVERY_REFERENCE_INVALID`、`PROJECT_DELIVERY_ITEM_INVALID`、`PROJECT_DELIVERY_ITEM_KEY_CONFLICT`、`PROJECT_DELIVERY_DEPENDENCY_CYCLE`、`PROJECT_DELIVERY_VERSION_NOT_FOUND`、`PROJECT_DELIVERY_PLAN_IMMUTABLE`、`PROJECT_DELIVERY_APPROVAL_DECISION_INVALID`、`PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED` 和既有 `CONCURRENCY_CONFLICT`。Unit/Contract、真实 PostgreSQL DDL/RLS/CHECK/CAS/幂等/回滚和受控本地 E2E 必须覆盖输入无副作用、Agent/actingFor、非 APPROVE pointer、精确 Decision、单 active 并发、Event 最小性和 criteria/hash 冻结。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收保持 `NOT RUN`。

### 19.5 WI-10 本地验证结果（2026-08-27）

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm architecture` 和 `pnpm contracts:check` 全部通过；公共 Contract 保持 `operations=200`，未新增公共操作或字段。
- `pnpm test`：`22 test files passed / 17 skipped`，`351 passed / 230 skipped`。
- `pnpm persistence:gate`：pinned PostgreSQL `18.6`（server `180006`）与 Flyway `11.20.3`；空库迁移成功，`20 files / 244 passed / 0 failed`；V2011 成功应用，二次 migrate 输出 `Schema "public" is up to date. No migration necessary.`，容器已清理。
- Gate 实际覆盖 accepted Gap 与五个 baseline normalized refs 的完整/混用校验、DAG/duplicate key、Agent/Service/actingFor、三态 Human Decision、精确 approval hash、CAS 并发、幂等、单 active 收敛、RLS/immutable guards、最小事件和 criteria/hash 查询。
- WI-10 专用 rollback fault injection、Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收未运行，继续标记为 `NOT RUN`。

### 19.6 WI-10 exact-head closeout（2026-08-27）

- 实现 head `054480ebac29cd820e7893df5844ad23a6940f3b` 已通过 [PR #83](https://github.com/qzhike/zhiju-business-core/pull/83) 的 [GitHub Actions verify run 33029833203](https://github.com/qzhike/zhiju-business-core/actions/runs/33029833203)，并以 merge commit `71e527b110b7c65d6a73ba16aca4ed1b334bf89d` 合入 `main`。
- PR verification comment 已写入并通过 API 读回：[issuecomment-5433162589](https://github.com/qzhike/zhiju-business-core/pull/83#issuecomment-5433162589)。Issue [#66](https://github.com/qzhike/zhiju-business-core/issues/66) 已读回为 `closed`；原始远端和本地 feature branch 均已删除，`origin/main` 已验证包含实现 head。
- Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

## 20. IM-03 WI-11 权威 Query、Source Slice 与 Board Projection

### 20.1 Query 入口与 Scope

本 Work Item 复用现有四个 Query Contract，不新增公共 Operation：

| Query | 数据来源 | 一致性 | 本轮边界 |
|---|---|---|---|
| `project.get_project_context_source` | EnterpriseProject owning Schema | `AUTHORITATIVE` | 按 purpose/audience/requestedKinds 生成最小 Source Slice |
| `project.get_active_baseline_refs` | Project Root active/accepted pointers | `AUTHORITATIVE` | 只返回精确 active refs，不解析 latest/current |
| `project.get_delivery_item_criteria` | 精确 DeliveryPlan Version/Item | `AUTHORITATIVE` | 返回冻结 definition/hash，execution 保持 `NOT_READY` |
| `project.get_project_board_slice` | Projection Schema read alias | `PROJECTION` | 稳定 cursor、lag/status、可重建读模型 |

四个入口均要求 Query ProjectRef 为 `OBJECT/Project`、UUIDv7、与可信事务 Context 的 Enterprise 和唯一 allowed Project 完全一致。Audience 必须是同一 Enterprise 的精确 Principal ObjectRef，并且若携带 Project Scope 必须与 Query Project 相同；purpose 使用闭集值，未知 purpose 和未支持 requestedKinds 均 fail-closed。所有 scope、audience、过期授权决策和 cursor 错误只返回稳定 code 与安全 message，不回显敏感 payload。

### 20.2 ProjectContextSourceSlice

`get_project_context_source` 必须先用存在性与 Scope 谓词确认 Project 和 `PROJECT_START` ProjectSnapshotBinding，并在读取字段前完成 binding 的类型收窄，再从 binding 返回 EnterpriseProfile、QMSConfiguration、ProductScope 的精确 Snapshot/Versioned Ref；返回 Ref 必须由 allow-list 重建，不能回显 binding JSON 的额外字段；active baseline 只通过 Project-owned Root 的 active/accepted pointer 读取。返回的 Fact 仅限 `factType`、风险/生命周期元数据和精确 Fact VersionedRef；即使权威 Fact 含敏感 value/source refs，也必须进入 REDACTED 元数据，不得进入结果，客户材料正文和未被 purpose 授权的字段必须进入 `redactions` 或 `omissions`，不得以空值伪装已返回。Fact 的通配 `redactions` 只有在 `ENTERPRISE_FACTS` 被请求且 purpose 允许 Fact 元数据时才加入；未请求或 purpose 禁止时只记录 omission。结果必须携带 SourceWatermark，watermark 是当前权威读取的观测点，不把 Outbox 宣称为完整 Event Sourcing 日志。Project 或 `PROJECT_START` binding 缺失、Scope 不一致或 exact ref mirror 不可验证时必须 fail-closed 返回稳定错误，不能解引用缺失行或继续读取其他事实；Contract 可选字段没有值时省略，不写入显式 `undefined`。

本轮 purpose 最小闭集为 `context.snapshot.read`、`document.write`、`review.read` 和 `record.form.read`。前三级可请求安全 Fact 元数据但不返回原始 value；`record.form.read` 只返回 Project/Enterprise/Profile/QMS/Product 与 active baseline refs。requestedKinds 必须从 `PROJECT`、`ENTERPRISE_PROFILE`、`QMS_CONFIGURATION`、`PRODUCT_SCOPE`、`ACTIVE_BASELINES`、`ENTERPRISE_FACTS` 中选择；未请求的已知 kind 记录 omission，未知 kind 拒绝。

### 20.3 Active Baseline 与 Criteria 精确性

`get_active_baseline_refs` 必须逐项检查 CustomerBaseline、TemplateBaseline、RegulatoryProfile、GapAnalysis accepted version 和 DeliveryPlan active version（存在时）的 Root pointer、Scope、Version 状态和 object/version id；状态分别必须为 `CONFIRMED`、`FROZEN`、`FROZEN`、`ACCEPTED` 和 `ACTIVE`。即使 owning repository 的静态状态类型已闭合，Handler 仍须对数据库读回值执行防御性生命周期校验。Root 没有 active/accepted pointer 时省略该 ref；不得查询“最新版本”替代。`get_delivery_item_criteria` 的 Plan Version ref 和 item id 仍是唯一定位条件，criteriaHash 必须来自持久化的冻结 criteria，projection 或 item 自报状态不能改变 criteria 结果。

### 20.4 Projection 事实模型

V2012 新增 Projection Schema 表：

| 表 | 作用 | 可变边界 |
|---|---|---|
| `project_board_projection_version` | 一次构建的版本、source watermark、row count、domain checksum | 只允许构建状态向 READY/FAILED 的受控迁移 |
| `project_board` | 带 projection version 的安全 Board 行 | INSERT-only；禁止 UPDATE/DELETE |
| `project_board_read_alias` | 每个 Enterprise/Project 当前读版本 | 仅同一重建事务原子切换 |
| `projection_source_state` | 权威 source 最新 event/sequence 观测 | 只接受单调推进 |
| `projection_checkpoint` | consumer/partition 的 last 与 target watermark、状态 | 受控更新；PAUSED/REBUILDING/FAILED 可观测 |
| `projection_failure` | 安全失败 code、event/partition 和时间 | INSERT-only |

表均保存 Enterprise/Project Scope mirror，checkpoint/failure 的 partition 必须等于其 Project，启用并强制 FORCE RLS；`projection_app` 只获得所需 SELECT/INSERT/UPDATE 权限，source state/checkpoint watermark 由数据库 guard 保证单调；Board 行和失败事实不授予 DELETE。Projection writer 只接收上游已经规范化的 Snapshot Export/Event Delta，source module 固定为 `enterprise_project` namespace 且 Event Delta sequence 从 1 开始，禁止从 EnterpriseProject 表做跨 Schema Join。failure fact 只能写入 event/partition、稳定错误码和安全摘要。

### 20.5 Rebuild、消费与 Alias

Rebuild 在同一 Projection 事务内创建 BUILDING version，将 authoritative Snapshot Export 按固定 UTF-8 字节序的 `itemKey ASC, deliveryItemId ASC` 规范化写入，按 source sequence 严格递增应用 Event Delta，计算 row count 与 domain checksum，并把版本置为 READY。随后更新 source state/checkpoint 并切换 read alias；任何校验、Scope、顺序、重复 item、checksum 或写入失败都不得切换 alias。Snapshot/Result 的可选 event id 等字段无值时省略，不写入显式 `null` 或 `undefined`。旧版本保留，以便审计和故障定位。

正常消费要求事件 Scope、event id、sequence、partition 和 item ref 精确匹配；同一已提交 Event 重放返回 `DUPLICATE`，低于 checkpoint 的消费返回稳定 checkpoint conflict，其他重复或乱序事件不能静默跳过。暂停时 checkpoint 状态为 `PAUSED`，新事件只推进 target watermark，不更新读 alias；恢复消费或完整 rebuild 后才推进 last watermark。单个事件消费的 Projection Version/Board 行记录本次已消费 watermark，只推进 last，不得覆盖已经记录的更高 target watermark 或 source state，直到 target 对应事件也被消费或 rebuild 覆盖。Projection 查询计算 `max(targetSequence-lastSequence, 0)`，返回 `READY`、`STALE`、`REBUILDING` 或 `FAILED` 状态和两个 watermark；任何状态都不改变 authoritative Command、Delivery criteria 或 Completion 的语义。

### 20.6 Board Query 与稳定 Cursor

Board Query 只读取当前 alias 指向的版本，按固定 UTF-8 字节序键分页，不使用 offset；写入、读取和 cursor 使用同一比较规则。Cursor 为带 HMAC 的最小 JSON，绑定 Query Project、Enterprise、Filter Hash、Projection Version、最后一行 `(itemKey, deliveryItemId)`、授权决策 hash 和 expiry；解码失败、过期、Scope/Filter/Version 不匹配统一返回 `PROJECT_QUERY_CURSOR_INVALID`。结果在已有 `ProjectBoardPage` 上以可选字段暴露 `consistency`、`asOfEventId`、`asOfRecordedAt`、`projectionLag` 和 `projectionStatus`，实现始终填充这些诊断，旧 v1.0 fixture 可继续通过兼容性检查。

### 20.7 稳定错误与验证边界

WI-11 至少使用：`PROJECT_QUERY_REF_INVALID`、`PROJECT_QUERY_SCOPE_MISMATCH`、`PROJECT_QUERY_AUDIENCE_INVALID`、`PROJECT_QUERY_PURPOSE_FORBIDDEN`、`PROJECT_QUERY_NOT_FOUND`、`PROJECT_QUERY_CURSOR_INVALID`、`PROJECT_PROJECTION_EVENT_INVALID`、`PROJECT_PROJECTION_CHECKPOINT_CONFLICT`、`PROJECT_PROJECTION_REBUILD_INVALID` 和既有 `CONCURRENCY_CONFLICT`。Unit/Contract 与真实 PostgreSQL 需要覆盖 Source Slice omission/redaction、active exact refs、cross scope/expired auth、stable cursor、RLS/immutable、pause/lag、Snapshot + Delta checksum、atomic alias、乱序/重复事件和 projection 不影响 authoritative criteria。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 继续 `NOT RUN`。

### 20.8 WI-11 exact-head closeout（2026-08-27）

实现 commit `c8f1a2cc6291ff65824a04e437a99b660fd926aa` 已通过 [PR #85](https://github.com/qzhike/zhiju-business-core/pull/85) 的 [GitHub Actions verify run 33039239177](https://github.com/qzhike/zhiju-business-core/actions/runs/33039239177)，并以 merge commit `43a2f4fcf074e565c10f3db54bd1be9134ef471d` 合入 `main`；PR verification comment 已读回：[issuecomment-5434378070](https://github.com/qzhike/zhiju-business-core/pull/85#issuecomment-5434378070)。Issue [#67](https://github.com/qzhike/zhiju-business-core/issues/67) 已读回为 `closed`，closeout comment 已读回：[issuecomment-5434387709](https://github.com/qzhike/zhiju-business-core/issues/67#issuecomment-5434387709)。`origin/main` 已验证包含 implementation head 与 merge commit；原始远端和本地 WI-11 feature branch 均已删除。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

## 21. IM-03 WI-12 DeliveryItem Completion 与 Impact Process

Issue #68 复用现有 `project.evaluate_delivery_item_completion@1.0`、`project.DeliveryItemCompletionSatisfied@1.0` 和 `project.DeliveryItemImpactReviewRequested@1.0`，不扩展公共 Operation Catalog。EnterpriseProject 只实现自己的 Completion Evaluator、受控正式事实 Consumer、Inbox/Process Manager 持久化和 Impact Review；TaskExecution、QualityGovernance、ReleasePublication 的上游业务 Handler 不属于本轮。

### 21.1 Criteria 与 Evaluation

DeliveryItem 的 `completionCriteria` 在不可变 DeliveryItem 行中冻结，WI-12 v1 的可执行 grammar 为：

```json
{
  "allOf": [
    { "eventType": "execution.TaskCompleted" },
    { "eventType": "release.ReleaseCompleted" }
  ]
}
```

每个 criterion 必须是对象，`eventType` 必须属于已注册正式事件；可选 `factRef` 必须是同一 Project 的 exact `TypedReference`。Evaluator 只使用输入 `CompletionEvaluationInput.factRefs` 指定的事实集合，不读取 `latest`/`current`，也不接受 `submittedCompletion`、caller outcome 或直接 `execution_status='COMPLETED'`。输入 `criteriaHash` 必须与持久化 `completion_criteria` 的 canonical SHA-256 相等；不匹配、未知 grammar、空/重复 fact ref、跨 Scope 或未消费事实都在业务写入前稳定拒绝。

每个 Evaluation 保存 immutable `criteria_hash`、精确 DeliveryPlan/Item identity、exact fact set/ref hash、source watermark set、`zhiju.quality.evaluator` 的 evaluator VersionedRef、evaluator payload/version hash、派生 outcome、recorded time、source command/event 和 payload hash。相同 input fingerprint 不产生第二个 Evaluation；不同的 exact fact set、watermark、evaluator version 或上游版本产生新的历史 Evaluation。

### 21.2 Formal Fact Inbox 与 Process Manager

受控 Consumer 的输入是已注册 Event Envelope 加一个受信 `SourceWatermark`，且 Event Consumer Context 必须绑定同一 `sourceEventId`。允许事件和 producer/source module 为：

| Event | producerModule / watermark sourceModule | Lifecycle | 用途 |
|---|---|---|---|
| `execution.TaskCompleted@1.0` | `task-execution` / `task_execution` | `ACTIVE` | Task formal completion fact |
| `release.ReleaseCompleted@1.0` | `release-publication` / `release_publication` | `ACTIVE` | Release formal completion fact |
| `quality.RevisionFullyApproved@1.0` | `quality-governance` / `quality_governance` | `ACTIVE` | exact approved revision fact |
| `quality.RevisionApprovalLost@1.0` | `quality-governance` / `quality_governance` | `REVOKED` | revoke matching revision approval |
| `release.ReleaseRecalled@1.0` | `release-publication` / `release_publication` | `REVOKED` | revoke matching release completion |

Consumer 必须检查 event id/type/version、producer module、Envelope scope 与可信事务 Context、payload contract shape、`integrity.payloadHash`、SourceWatermark module/partition/sequence/instant，以及每个 embedded TypedReference 的 Scope 和 exact kind。Source watermark 允许 late event，但不能被静默改写或覆盖。

`inbox_message` 使用固定 consumer name 和 `(consumer_name,event_id)` 主键；相同 event id + payload hash + watermark 返回 `DUPLICATE`，hash 或 watermark 冲突写入 `contract_violation(INBOX_HASH_CONFLICT)` 并返回 `QUARANTINED`，不 UPDATE 原 Inbox、fact 或已提交业务结果。成功消费在同一 EnterpriseProject 事务中 INSERT Inbox `PROCESSED`、immutable `delivery_item_completion_fact`、ProcessInstance 和 immutable ProcessStep；所有写入使用 `principalKind=SERVICE` 的受信 Event Consumer Context。

Fact ledger 至少保存 event identity/type/version、normalized source module、aggregate identity/version、project Scope、synthetic exact fact ref、payload-derived fact refs、payload hash、source watermark、ACTIVE/REVOKED lifecycle、revocation subject refs、canonical payload/hash、causation/correlation 和 source event id。旧 fact 不允许 UPDATE/DELETE；revocation 只追加新 fact。Evaluator 在选择 ACTIVE fact 时排除与当前 project 中 REVOKED subject ref 相交的旧事实。

### 21.3 Root Pointer、Impact 与 Event

V2013 给既有 `delivery_item` 增加 nullable `current_completion_evaluation_id`，并将独立 Completion aggregate version 初始化为 `1`。原有 item content/criteria 继续 immutable；只有该列与受控时间/aggregate version 可由 `enterprise_project_app` 通过 CAS 更新，直接修改 item 内容或把 `execution_status` 写成 `COMPLETED` 仍由 ACL/trigger 拒绝。Pointer 只能指向同一 `(enterprise, project, plan, version, item)` 的 Evaluation；Root 不复制 outcome、criteria 或 fact 正文。

当 Evaluation 因新 fact、late fact、upstream new Version/Hash 或 revoke 而改变 current result 时，追加 `delivery_item_impact_review`，保存 exact triggering ref、prior Evaluation Ref、new Evaluation Ref、reason code、affected fact refs、watermarks 和 payload hash，并只发布最小 `project.DeliveryItemImpactReviewRequested@1.0`。旧 Evaluation、旧 Plan Version、approval decision 和旧 Impact Review 不重写。仅当当前 Evaluation 从非 `SATISFIED` 转为 `SATISFIED` 时发布 `DeliveryItemCompletionSatisfied`；撤销后重新满足允许再次发布，已满足状态下的 late fact 不重复发布。重复 command/event 不产生第二个 business fact/event。

### 21.4 WI-12 稳定错误与验证边界

WI-12 使用既有 `PROJECT_DELIVERY_REFERENCE_INVALID`、`PROJECT_DELIVERY_ITEM_INVALID`、`PROJECT_DELIVERY_PLAN_IMMUTABLE`，并新增：

```text
PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED
PROJECT_COMPLETION_IS_DERIVED
PROJECT_DELIVERY_COMPLETION_EVENT_INVALID
PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT
PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND
PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID
PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID
```

Focused Unit/Contract 覆盖 criteria grammar/hash、typed ref/lifecycle、event envelope/payload hash、sourceEventId 绑定和 safe rejection；真实 PostgreSQL 覆盖 V2013 空库迁移、二次 no-op、RLS、Inbox replay/conflict/quarantine、Process Step、immutable fact/evaluation/impact、root pointer CAS、direct COMPLETED denial、Task-only unsatisfied、Release-complete satisfied、late/revoke/new-version history 和事务回滚，已由 `pnpm verify` 通过。Provider、公共 HTTP/Event Bus、真实跨模块 Process Manager、生产和人工 Reference Project 仍保持 `NOT RUN`。

### 21.5 WI-12 文档与实现状态

本节与 `.vibe/high-level-docs/HL-Spec.md`、`.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md` 和 `.vibe/module-tests/Module-Test-002-EnterpriseProject.md` 同步；主消费/评估链及 revoke/new-version、late fact、ACL/RLS、故障回滚、状态转移与 sourceEventId 的真实断言已由 `pnpm verify` 通过，故 WI-12 的本地实现验证完成。该状态不把 Contract 已存在或 V2011/V2012 既有结果冒充本次 Completion 实现，也不提升 Provider、公共 HTTP/Event Bus、真实跨模块 Process Manager、生产和人工 Reference Project 的状态。

新增 `tests/business` 必须拥有独立的 composite `tsconfig.json` 并由根 `tsconfig.json` 引用，使 Unit/Contract 夹具同时接受 TypeScript build、ESLint project service 和 Vitest 执行。

ACL/RLS 断言必须区分层次：Fact/Evaluation/Impact 的应用角色 `UPDATE/DELETE` 在表 ACL 处直接拒绝并返回 `42501`；跨 Project `SELECT` 则验证 FORCE RLS 不泄漏其他 Project 行。测试不得把 ACL 拒绝误报成 RLS 零行更新。

## 22. 合成 Reference Project 的技术验证边界

在没有真实业务场景时，EnterpriseProject 可以使用 `SYNTHETIC / TECHNICAL ONLY` Fixture 进行受控验证。该 Fixture 可以复用本模块各 owning Handler、Repository、Migration 和 Disposable PostgreSQL fixture，但必须保持以下边界：

- 合成 Enterprise、Project、Material、Baseline、Gap、Plan 和 Item 只用于验证精确 ID/Version/Hash/Scope、生命周期、Human/Agent 权限、CAS、Replay、RLS、immutable、SourceWatermark、Projection 和 Completion 派生语义；不表达真实客户业务规则。
- 任何跨 Aggregate 组合结果必须标记为 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不能写成一个已运行的 integrated E2E；若要标记 integrated E2E，必须另有统一 runtime Fixture Runner 和逐步可回读的对象链证据。
- `EP-API-E-001`、`EP-API-E-002` 的统一跨 Aggregate runtime chain 和 `EP-API-M-001` 的独立人工审阅不因 focused fixture 通过而变为 `PASS`。
- 真实 Provider、公开 HTTP、生产数据库、真实跨模块 Event Bus/Process Manager、Artifact/QualityGovernance/ReleasePublication 业务 Handler 和独立业务适用性继续为 `NOT RUN`。

本次执行记录见 [`Verification-Record.md`](../archive/im-03-synthetic-reference-fixture/Verification-Record.md)，不扩展公共 Operation Catalog，也不改变各 Command/Query/Event 的 Owner 或 payload contract。

## IM-06 Source Slice 与 Resolution Receipt 设计

状态：`TECHNICAL DESIGN APPROVED 2026-09-08`；capture/read 的 Schema/Registry/Guard 已交付，`project.capture_context_source_slice@1.0` 与 `project.get_context_source_slice@1.0` 的业务 Handler、授权接线、Policy 解析消费（#176）与不可变持久化（`V2014`）已由 #188 实现；`project.get_resolution_receipt@1.0` 的静态注册、Handler、授权接线、规范 Receipt 材料（`V2015`）与精确可重算 backfill 已由 #191 实现，实际字段形状与验证边界见下方「#191 实现事实」；关联 #152/#154、[TD-01/04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。#176 的 capture policy 解析与 `validUntil` 绑定为 `TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / IMPLEMENTED (#188)`（见下方「#176 Capture Policy 解析与 validUntil 推导（提案）」）。本节只拥有 EnterpriseProject 的输入事实捕获和窄化证明，不把 ContextSnapshot/InformationRequest 的业务所有权移入本模块。现有 `get_project_context_source@1.0` 保持动态 View，不能由调用者生成任意 ContentAddressedRef…

| 设计操作 | 模式/一致性 | Payload | Result.data / Purpose |
|---|---|---|---|
| `project.capture_context_source_slice@1.0` | ContextSourceSlice / CREATE | `projectRef; purpose: NamespaceCode; audience: PrincipalRef; requestedKinds: Set<NamespaceCode>; capturePolicyRef: VersionedRef<Policy>` | `{sourceSliceRef: Exact<ContextSourceSlice>}`；`project.context_source.capture`，受授权 ContextBuilder Service |
| `project.get_context_source_slice@1.0` | A | `sourceSliceRef: Exact<ContextSourceSlice>` | `{slice: ContextSourceSlice, useStatus: Closed<USABLE\|EXPIRED\|REVOKED>, checkedAt}`；`project.context_source.read`，受授权 ContextBuilder Service |
| `project.get_resolution_receipt@1.0` | A | `commandReceiptRef: Exact<CommandReceipt>` | `ResolutionReceiptAttestation`；`project.resolution_receipt.read`，受授权 TE Resolver Service |

ContextSourceSlice payload：`sliceId, scopeRef, projectRef, purpose, audience, capturePolicyRef, capturedAt, validUntil, source: ProjectContextSourceSlice`。所有字段 required。capture 复用 owning Source Query 的事实装配与裁剪逻辑，在一个 EP 只读依赖 + 新 Slice Aggregate 事务中持久化；不存其他模块事实或 Token。validUntil由显式版本化 Policy 与 Decision时效推导，不接受 caller任意期限。查询按 exact id/hash 读取并重验当前 Action/Scope/audience/purpose授权；源内容变化不改旧 Slice，当前授权/Policy失效则不允许新 Context消费。每次 capture同幂等键原结果重放，新来源需要新键/新 Slice，不能把旧 ContentHash当 latest。

ResolutionReceiptAttestation payload：`commandReceiptRef, commandType, commandVersion, targetRef, scopeRef, requestPayloadHash, outcome: COMMITTED, candidateVersionRef, confirmedVersionRef, sourceMaterialRefs, decisionRef, actorRef, actorSnapshotRef, authorizationDecisionRef, committedAt`。首版只返回 `project.confirm_customer_material@1.0`；其他命令、REJECTED/PENDING/UNKNOWN、错 Hash/Scope或不存在统一返回不可用。数据从 owning Receipt 与实际 confirmed version/decision/source selections联合验证得到；不把该联接开放成通用 SQL/Repository Port。Human身份、Decision用途和不可变设计→确认版本关系来自现有 confirmation事实，不依赖本次查询调用方提供。

Receipt Ref 的 Hash 对应持久化规范 Receipt payload（command identity/type/version、完整 Scope/target、request hash、结果引用、outcome、actor/decision、committedAt），不使用原命令 requestHash冒充 Receipt Hash。若现有 Receipt未存该规范投影，后续实现须 forward migration/backfill精确可重算材料，不能凭 current Root猜历史结果；无法恢复时 fail closed。Query可以返回脱敏 typed projection，但 Hash验证基于完整受控 canonical receipt。TE仅消费允许字段。

新增 Slice表、Receipt canonical material的存储要求由 PostgreSQL技术设计附录拥有；不修改旧 V2007/历史Receipt，不创建跨 Schema FK。此设计不自动支持 Fact/Approval/Policy Exception答案采纳。

### #157 注册元数据绑定

状态：`APPROVED 2026-09-09 / SCHEMA AND GUARD IMPLEMENTED / HANDLER IMPLEMENTED (#188)`；仅补充 #157 的技术注册声明，原 TD-01 字段设计已批准。技术 Guard 参数和机制唯一见[共享 API 补充](../api-contract-v0.1/API-Contract-v0.1.md#157-payloadguard-注册补充方案)。

| 操作 | Owner | Target / Mode / Consistency | authorizationPurpose | dataClassification | payloadGuardPolicyRef |
|---|---|---|---|---|---|
| project.capture_context_source_slice@1.0 | enterprise-project | ContextSourceSlice / CREATE；expectedAggregateVersion 必须省略 | project.context_source.capture | CUSTOMER_CONFIDENTIAL | ep.context_source_slice@1.0 |
| project.get_context_source_slice@1.0 | enterprise-project | AUTHORITATIVE only | project.context_source.read | CUSTOMER_CONFIDENTIAL | ep.context_source_slice@1.0 |

Ref 注册与 Schema 约束：capture.targetRef 为 OBJECT/ContextSourceSlice；capture.payload.projectRef 与 Result.slice.projectRef 为 OBJECT/Project；capture.payload.audience 与 Result.slice.audience 复用共享 PrincipalRef（{principalKind, principalId}，不是 ObjectRef）；capture.payload.capturePolicyRef 与 Result.slice.capturePolicyRef 为 VERSIONED/Policy；Query.payload.sourceSliceRef 为 CONTENT_ADDRESSED/ContextSourceSlice，Hash 必填。Slice.scopeRef 继续使用共享 ScopeRef，scope 相等/存在性由业务校验负责。source 直接引用现有 ProjectContextSourceSlice，其内部 Ref/SourceWatermark 和 CanonicalJson 叶字段沿用既有定义，不借本次注册改变其形状。

授权声明只标识受授权 ContextBuilder Service 的目的；不创建 Service Principal、CapabilityGrant 或业务 capturePolicy，不规定 TTL。Schema 能拒绝错误 Ref kind/objectType、缺 Hash 或形状不合法，但不能证明 Hash 与内容匹配、对象存在或当前权限；#188 在 owning Handler 中补齐了这两项的运行期授权、Scope、Purpose、Policy 与时效校验（见下方「#188 实现事实」）。本模块当前公开 Contract 共 34 项，新增两项未改变公共接受集合。

新操作的公开 Ref objectType 映射由 [Catalog #157](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#157-contextsourceslice-注册) 注册：Project → zhiju.project.project，Policy → zhiju.identity.policy，ContextSourceSlice → zhiju.project.context_source_slice。PrincipalRef 沿用共享类型；旧操作的历史字段形状不因本次映射被改写。

新 Source Slice Query 的可选 Envelope.pagination 引用共享 PageRequest：提供时 pageSize 为必填正整数，cursor 可选且使用共享 OpaqueCursor，不接受未知分页字段；省略 pagination 合法。此结构约束仅应用于新 Query，旧 201 项 Envelope 的接受集合不变。

### #176 Capture Policy 解析与 validUntil 推导（提案）

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / IMPLEMENTED (#188)`；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 已交付本模块 capture profile 的静态注册与纯校验：`ep.context_source_slice_capture.policy@1.0` 的 canonical typed ref、closed 字段 Schema 与 `validateCapturePolicy`（必需 profile key + closed 字段；空集、重复项、非法整数与未知字段拒绝）；#188 在此基础上交付 capture Handler、`validUntil` 推导、`identity.resolve_policy@1.0` 消费 Port、Slice 持久化与授权的真实运行路径，证据见「#188 实现事实」。依据 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176)、[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖) 与 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计)。本节只补齐 capture 的 Policy 解析输入与 `validUntil` 来源，不改变已批准的 capture/read 字段、Purpose 声明、PayloadGuard 技术 Policy 或 Slice 公开 payload。

1. `capturePolicyRef` 继续是 Schema 已固定的 `VersionedRef<zhiju.identity.policy>`；capture 必须在提交事务内通过 `identity.resolve_policy@1.0` 取得当次解析观察（`policyVersionRef`、`contentHash`、`effectiveFrom`、`supersededAt` 与 `policyDocument`），不得由调用者自报 Hash/有效期，也不得由 `objectId/versionId` 推导。
2. 首版 profile 为 `ep.context_source_slice_capture.policy@1.0`（本模块拥有，规则字段 closed；registry key 与 canonical typed ref 由 [Spec 001 §13.5](../module-specs/Module-Spec-001-IdentityPolicy.md#135-授权profile-schema-注册与失败审计) 注册）：`maxSliceValiditySeconds: PositiveInt`（必填，无默认）与 `allowedPurposeCodes: NonEmptySet<NamespaceCode>`（必填，请求 `purpose` 必须是成员）。`validUntil = min(capturedAt + maxSliceValiditySeconds, authorizationDecision.expiresAt)`；不接受调用者提供的期限，不引入默认 TTL，不把缺失字段解释为无限制。
3. Slice 提交事务在同一事务内保存该次解析观察（policy `contentHash`/`effectiveFrom`/可选 `supersededAt` 与当次 `policy_version_ref`）作为不可变附属 metadata，与 Slice 事实、Receipt/Audit/Outbox 一起提交；**不改变 Slice 公开 payload 字段与既有 required 集合**，metadata 不进入 payload Hash 之外的重复定义。
4. `get_context_source_slice@1.0` 读取时以受信服务端当前时间重验 Slice `validUntil`、capture policy 的 `supersededAt`/有效性以及当前 Action/Scope/audience/purpose 授权；capture policy 被取代或不可解析导致不可用时，必须以既有 `useStatus` 闭集返回 `EXPIRED` 或 `REVOKED`，不得继续返回 `USABLE`。
5. 未知 profile 版本、未注册规则字段、`policySchemaRefs` 不含 `ep.context_source_slice_capture.policy@1.0` 的 canonical ref 时拒绝；提案新增稳定错误码 `PROJECT_CAPTURE_POLICY_UNSUPPORTED`（命名与登记以本模块 §6 为准，实现时同步）。
6. capture 的授权沿用已注册 Purpose `project.context_source.capture`；解析 capture policy 需要 `identity.policy.resolve_policy` 的独立 AuthorizationDecision。capture 的授权不转让给 Builder，Builder 也不得代替 EP 解释 capture policy 语义。
7. 不改变 `get_project_context_source@1.0` 的动态 View 语义；不得给其返回结果补算 Hash 冒充已提交 Slice。

### #188 实现事实（Context Source Slice capture/read）

状态：`HANDLER, COMPOSITION AUTHORIZATION WIRING, POLICY CONSUMPTION AND SCOPED PERSISTENCE IMPLEMENTED / REAL POSTGRESQL 18.6 PASS / TE CONSUMPTION AND EXTERNAL ACCEPTANCE NOT RUN`。实现入口为 `handleCaptureContextSourceSlice` 与 `handleGetContextSourceSlice`（`modules/enterprise-project/src/business/context-source-slice-handlers.ts`），运行期授权/Envelope/Policy Port 适配为 `createContextSourceSliceEntry`（`apps/api/src/composition/context-source-slice-entry.ts`，导出 `@zhiju/api/composition`），持久化为 `V2014__context_source_slice_capture.sql`。

1. **单一装配实现**：capture 与 `get_project_context_source@1.0` 共用 `assembleProjectContextSourceSlice`（`business/source-slice-assembly.ts`）：同一 Project/`PROJECT_START` binding 存在性与 Scope 收窄、同一 allow-list Ref 重建、同一 active/accepted pointer 读取、同一 Fact 元数据脱敏与 omission/redaction 记录。缺 Project 或 binding 时 capture 拒绝并返回既有 `PROJECT_QUERY_NOT_FOUND`，不产生空壳 Slice；purpose 仍取 §20.2 的闭集，`record.form.read` 不返回 Fact 元数据，Policy 不能扩大来源披露。
2. **公开拼写**：captured `source` 的 schema 受约束引用（`projectRef`、`enterpriseProfileSnapshotRef`、`qmsConfigurationRef`、`productScopeSnapshotRef`、`activeBaselineRefs[]`）使用 Core Project Context 与 #157 fixture 已确立的 canonical 名称（`zhiju.project.*`）；capture payload 的 `requestedKinds` 使用 #157 fixture 的 canonical 闭集（`project`、`enterprise_profile`、`qms_configuration`、`product_scope`、`active_baselines`、`enterprise_facts`），由组成层映射到 owning 装配的 kind 标识，未注册 kind 拒绝。`factItems`/`omissions`/`redactions` 是 CanonicalJson 叶字段，保留 owning 装配的既有取值。旧 `get_project_context_source@1.0` 动态 View 的既有拼写与 kind 词表不变。
3. **授权接线（组成层，`apps/api` 的 `@zhiju/api/composition`）**：运行期适配由 `createContextSourceSliceEntry` 交付，EP 自身不读 IdentityPolicy。该入口 (a) 先用公共 `ContractRegistry` 校验完整注册 Envelope（结构 + PayloadGuard），(b) 校验 `integrity.payloadHash` 与 `scopeRef`/`targetRef` 形状，(c) 经 owning IdentityPolicy Port 读取并复验被呈现的 AuthorizationDecision：`withIdentityTransaction` + `getAuthorizationDecisionByIdAndHash` + `validateAuthorizationDecision`（精确 hash、command type/version、Scope、purpose、command payload hash、authentication context hash、expiry、ALLOW），(d) 校验被呈现 Actor 与 Decision 的 `actor_snapshot_id` + ActorSnapshot payload hash（或 `principal_id`）逐字段一致，(e) 用 `checkProjectAccess` 对该 Principal 与注册 Purpose 在请求时刻重新求值当前 capability grant，撤销即拒绝，(f) 由已验证 Decision 行派生受信 EP Context（principal/kind、actor snapshot、Decision id/hash/expiry、Policy snapshot、`authorizationPurposes = [Decision.purpose]`）。受信 Session 的 `authenticationContextHash` 形状在入口先校验，并作为传给 owning validator 的唯一 expected Hash；capture 与 read 都不得用请求自报值替代它。read 另要求 Envelope `authenticationContextRef.contentHash`、受信 Session Hash 与该 Decision 行的 `authentication_context_hash` 三者一致，仅变更 Session 或仅变更 Envelope 的认证 Hash 都被拒绝；Policy 解析的独立 Decision 也使用同一会话绑定。EP 入口仍要求该 Purpose 存在（缺失 → 共享 `AUTHORIZATION_DECISION_INVALID`），但不再接受调用方自报的 Purpose 数组；不因 `principalKind=SERVICE` 放行。capture 的 `audience` 必须是该受信 Principal 的精确 `PrincipalRef`。
4. **Policy 解析 Port**：EP 不 import IdentityPolicy、不读其表。`CapturePolicyResolutionPort`（`business/context-source-slice-policy.ts`）由组成层适配到 `identity.resolve_policy@1.0`：入口以会话提供的 `policyResolutionActorSnapshotRef`（同一 Principal 的 ActorSnapshot）与验证过的 Session authentication context 为每次解析签发独立的 `identity.policy.resolve_policy` Decision（`authorizeCommand`），再调用 owning 解析入口；错操作、错 Scope 或他人 ActorSnapshot 由 owning 入口拒绝并回落为 fail-closed。`resolveCapturePolicy` 只接受与本次请求逐字段绑定（version key、Scope、`policyVersionRef`、`contentHash`、`checkedAt === asOf`）且 lifecycle 为 `USABLE` 的观察，再应用 `validateCapturePolicy` 的 closed 字段；未知/未绑定/错 Scope → `PROJECT_CAPTURE_POLICY_UNSUPPORTED`，非 `USABLE` → `PROJECT_CAPTURE_POLICY_NOT_USABLE`，Port 抛错或返回 `UNAVAILABLE` → 共享 `DEPENDENCY_UNAVAILABLE` fail closed。需求 purpose 不在 `allowedPurposeCodes` → `PROJECT_CAPTURE_PURPOSE_FORBIDDEN`。
5. **期限与提交**：`validUntil = min(capturedAt + maxSliceValiditySeconds, authorizationDecision.expiresAt)`，`capturedAt`/`checkedAt` 取受信时钟；无默认 TTL、无 caller 期限。`validUntil` 在组装前与写入前各重验一次：任一时刻不为严格正 → `PROJECT_CAPTURE_VALIDITY_INVALID`，且该分支发生在任何业务写入之前，不发布半成品。
6. **持久化与重放**：`enterprise_project.context_source_slice` 保存公开 payload、content-address Hash、Scope/purpose/audience/policy 提升列与当次解析观察（`policy_version_ref`、`policy_set_version`、`policy_content_hash`、`policy_effective_from`、可空 `policy_superseded_at`、`policy_checked_at`）作为附属 metadata；Payload 与提升列的 mirror 由 trigger 校验，app 角色 `REVOKE UPDATE, DELETE`，FORCE RLS 使用 `context_allows_project`。Capture 是注册的 `ContextSourceSlice / CREATE`：Slice identity 取自已校验 Envelope 的 `targetRef.objectId`（请求目标 = 提交行 = 返回 `objectId`），`expectedAggregateVersion` 必须省略，类型/Scope 不符以 `COMMAND_TARGET_MISMATCH`/`SCOPE_MISMATCH` 拒绝而不重写；同一 identity 的第二次提交经 savepoint 回滚为稳定 `PROJECT_CAPTURE_SLICE_ALREADY_EXISTS`（并发同样只剩一个提交）。Receipt/Audit 与两条 `reference_edge`（capture policy key 与 exact policy version fact）在同一 EP owning 事务提交；同键同输入重放返回原 `sourceSliceRef` 且不刷新 `valid_until`，同键异输入为 `IDEMPOTENCY_PAYLOAD_CONFLICT`。写入前还必须以注册 read Result Schema/Guard 校验完整候选结果（`{slice, useStatus: USABLE, checkedAt}`）：装配结果超出已注册数组/字节预算时返回 `PROJECT_CAPTURE_RESULT_INVALID` 且不写任何 Slice，避免提交不可解引用的 Slice。
7. **读取语义**：按 exact `sourceSliceRef` 读取（id + payload Hash + Scope + audience + purpose），重算存储 payload 的 canonical Hash 并逐项核对提升列；未知/错 Hash → `PROJECT_QUERY_REF_INVALID`，不可见/跨 Project → `PROJECT_QUERY_NOT_FOUND`，Scope 越界 → `PROJECT_QUERY_SCOPE_MISMATCH`，非本 Principal audience → `PROJECT_QUERY_AUDIENCE_INVALID`。随后以受信时间重新解析 capture policy：解析依赖不可用 → `DEPENDENCY_UNAVAILABLE`（不得用旧观察回退）；Policy 不再可解析、内容 Hash 与存储观察不一致或 purpose 不再被允许 → `REVOKED`；仅 `validUntil` 已过 → `EXPIRED`；否则 `USABLE`。源内容后续变化不重写旧 Slice，新内容必须新键新 Slice；历史 Receipt 重放不恢复消费资格。
8. **未运行边界**：TE Context 消费、`get_resolution_receipt@1.0`、跨模块完整业务链、真实 Provider、公开 HTTP 与人工业务验收保持 `NOT RUN`。acceptance 证据见 [`Module-Test-002`](../module-tests/Module-Test-002-EnterpriseProject.md#im-06-188-contextsourceslice-captureread-用例) 与对应 Issue/PR 记录。
9. **#214 设计的 additive objectType 注册（已由 #216 交付，2026-09-19）**：TaskExecution TD-01 设计 Delta（#214，见 [Spec 003 §19.9](../module-specs/Module-Spec-003-TaskExecution.md) 与 [HL-Doc 06 #214 段](../high-level-docs/06-typed-references-contract-catalog-v0.1.md)）设计 additive 注册 EP-owned canonical objectType `zhiju.project.enterprise_fact`（VERSIONED；Enterprise Scope；即本节 Enterprise Fact 的既有版本身份），供 TE 把 Slice `factItems[].factRef` 规范化为 Core-valid `subjectRef`。只注册 canonical 拼写，不改变生命周期、不改写既有 `EnterpriseFact` legacy 拼写的既有接受集合、不新增公开 operation（Catalog 215 不变）；executable 注册已由 [Issue #216](https://github.com/qzhike/zhiju-business-core/issues/216) 交付（contracts 注册与构建期断言；本地/持久化证据完成，`vibe verify full --json` 已 PASS 2026-09-19，独立审查待完成），本节其余事实不变。

### #191 实现事实（Resolution Receipt material 与 attestation Query）

状态：`SCHEMA, REGISTRY, GENERATED TYPES, FIXTURES, HANDLER, AUTHORIZATION WIRING, V2015 SCOPED PERSISTENCE AND EXACT BACKFILL IMPLEMENTED / REAL POSTGRESQL 18.6 PASS / TE RESOLVER CONSUMPTION AND EXTERNAL ACCEPTANCE NOT RUN`。实现入口为 `handleGetResolutionReceipt`（`modules/enterprise-project/src/business/resolution-receipt-handlers.ts`）与确认命令的规范材料接线（`business/customer-material-handlers.ts` 的 `resolutionReceiptPayload`），运行期授权适配为 `createResolutionReceiptEntry`（`apps/api/src/composition/resolution-receipt-entry.ts`，与 #188 的入口共用 `decision-boundary.ts` 的 Decision 复验边界），持久化为 `V2015__resolution_receipt_material.sql`。

1. **公开契约**：`project.get_resolution_receipt@1.0` 是只读 AUTHORITATIVE Query，Owner=enterprise-project，Purpose `project.resolution_receipt.read`，`dataClassification=CUSTOMER_CONFIDENTIAL`；payload 固定 `{commandReceiptRef}`（CONTENT_ADDRESSED/`zhiju.project.command_receipt`，Exact id + 完整 ContentHash + Project Scope），Result 固定 `ResolutionReceiptAttestation`：`commandReceiptRef, commandType: 'project.confirm_customer_material', commandVersion: '1.0', targetRef, scopeRef, requestPayloadHash, outcome: 'COMMITTED', candidateVersionRef, confirmedVersionRef, sourceMaterialRefs, decisionRef, actorRef, actorSnapshotRef, authorizationDecisionRef, committedAt`。`sourceMaterialRefs` 为非空去重集合（按 exact `SourceMaterialRef` 去重并保留首次出现顺序：`sourceSelections` 的集合唯一性作用于完整 selection，同一 exact source 以不同 role/locator 重复出现时只投影一次；live 构造、读取重建与 `V2015` backfill 使用同一规则），`targetRef`/`candidateVersionRef`/`confirmedVersionRef` 固定 `zhiju.project.customer_material`，`decisionRef` 固定 `zhiju.project.business_decision`，`actorRef` 为共享 PrincipalRef。本项不改变批准的 attestation 字段，也不新增构建期 PayloadGuard 技术 Policy；Catalog 由 211 增至 212 项，本模块公开条目由 34 增至 35，历史 200 项 Compatibility Baseline 与旧操作接受集合不变。
2. **规范 Receipt material**：`enterprise_project.resolution_receipt_material` 每命令一行不可变事实，保存 `receipt_payload`（规范 payload）与其规范 Hash、命令 identity/type/version、Project Scope、`target_ref`、`request_payload_hash`、`candidate_version_ref`/`confirmed_version_ref`/`source_material_refs`/`decision_ref`/`actor_ref`/`actor_snapshot_ref`/`authorization_decision_ref` 投影、`committed_at` 以及创建主体/Decision/来源命令。`commandReceiptRef.contentHash` 即该规范 payload 的 Hash，**不是**原命令 request payload Hash。
3. **字段来源边界**：规范 payload 只包含 EnterpriseProject 自己以不可变记录保存的事实；`actorRef.principalKind` 精确为 `HUMAN`（确认命令为 Human-only，SQL CHECK 固定），`actorSnapshotRef`/`authorizationDecisionRef` 只声明精确身份（id + Project Scope），不声明 IdentityPolicy 拥有的内容 Hash。ActorSnapshot/AuthorizationDecision 的 payload Hash 不属于 EP 的不可变记录，声明它会同时破坏「历史材料可由真实不可变记录精确重算」的可实现性，因此本模块 fail closed 而非伪造跨模块 Hash。
4. **同事务提交与故障语义**：确认命令在 owning 事务内通过命令执行器提供的 commit 事实（`committedAt` = owning `command_receipt.completed_at`，`requestPayloadHash`）构造规范 payload，并在 Receipt finalize 之后、提交之前写入材料与其投影；材料写入失败使整个事务回滚，不留下部分确认、Receipt 或伪 attestation，同幂等键重试可从零开始。响应丢失后的重放由 owning Receipt 的幂等结果返回，不重写材料、不延长期限。旧 `command_receipt`/版本/Decision 事实不被覆盖。
5. **SQL 守卫**：`V2015` 的 mirror guard 逐项核对 payload↔投影列（含 Scope、actor/Decision 身份、`committedAt`）、拒绝自身 payload 中重复 exact source ref 的 Receipt（公开 Result 要求唯一集合，重复 ref 的 Receipt 永远不可读取），并核对 `receipt_payload_hash = sha256(canonical_jsonb_text(receipt_payload))`，从数据库侧独立证明规范 payload 与其内容地址一致；该函数镜像共享 canonicalization v1（NFC、UTF-8 字节序 key 排序、安全整数），因此 JS 与 SQL 的规范 Hash 必须相等，任何漂移都会使写入失败。canonicalizer 为 owner-only，guard 因此以 `SECURITY DEFINER` 属主身份执行（嵌套函数调用的 EXECUTE 按写入角色检查），app 角色保留写入路径而不获得该函数的执行权限。表为 INSERT-only（app 角色撤销 UPDATE/DELETE）、FORCE RLS 使用 `context_allows_project`、immutable trigger 拒绝 UPDATE、并绑定 `project(enterprise_id, project_id)` 组合外键。
6. **读取语义**：按 exact `commandReceiptRef` 读取（id + payload Hash + Scope），重算存储 payload 的规范 Hash 并逐项核对投影；随后联合核验 owning `command_receipt`（命令类型/版本、COMMITTED、Scope、target、request hash、actor/Decision/完成时刻）、真实 confirmed version（CONFIRMED、同 Root/Scope、`source_command_id`、`previous_version_id` = candidate）、真实 confirmation Decision（CONFIRMED、同 version、actor/Decision 归因）与真实 confirmed source selections（按 live/backfill 同一 exact-ref 去重规则重建后逐项规范 Hash 相等且 SourceMaterial 仍为 ACCEPTED 同 Scope）。caller 自报的 outcome/candidate/result/actor 一律不被回显或信任。
7. **拒绝面**：结构或 Scope 非法 → `PROJECT_QUERY_REF_INVALID`/`PROJECT_QUERY_SCOPE_MISMATCH`；非 `project.confirm_customer_material@1.0`、REJECTED/PENDING、未知、错 Hash、同 correlation 的其他材料、被篡改的 payload、无法重算的历史统一不可用（`PROJECT_QUERY_NOT_FOUND`，不泄露客户正文或命令是否存在）；授权上下文过期沿用 `PROJECT_QUERY_CONTEXT_EXPIRED`，缺少注册 Purpose 沿用共享 `AUTHORIZATION_DECISION_INVALID`。查询只读，不修改业务状态、不提交答案、不清 blocker。
8. **历史 backfill**：`enterprise_project.backfill_resolution_receipt_material()` 只在规范 payload 的每个字段都能由真实不可变记录（COMMITTED `command_receipt`、其创建的 CONFIRMED version、对应 CONFIRMED Decision 及其 actor/Decision 归因）精确重算时插入材料，并保持幂等（一命令一份）；材料不足的历史保持无材料并 fail closed，绝不用 current Root/当前版本猜测历史确认。`canonical_jsonb_text` 与该函数为迁移/维护辅助（两者均显式 `REVOKE EXECUTE ... FROM enterprise_project_app`，因为 V0002 的 default privileges 会向 owner 新建函数授予 app EXECUTE；仅 schema owner/admin 可执行），不构成通用 Receipt/SQL/Repository Port；backfill 的 source refs 投影使用与 live 构造、读取重建相同的 exact-ref 去重规则，因此重算结果与被覆盖材料逐字节相等。
9. **授权接线**：`createResolutionReceiptEntry` 先经公共 `ContractRegistry` 校验完整注册 Envelope，再校验 `commandReceiptRef` 与 Envelope `scopeRef` 的完整 Project Scope 一致、Envelope 认证上下文等于受信 session，然后经共享 Decision 边界复验 AuthorizationDecision（精确 operation/payload hash/Scope/purpose/Session/期限）并用 `checkProjectAccess` 在请求时刻重新求值 capability grant；撤销、过期、他人 session、其他操作或 payload 的 Decision 全部 fail closed。#188 的 Source Slice 入口与本入口共用同一 `decision-boundary.ts` 实现，避免两份授权语义。
10. **未运行边界**：TE 的 InformationRequest/答案/resolver 消费链（Spec 003 §11.7）、跨模块完整业务链、真实 Provider、公开 HTTP 与人工业务验收保持 `NOT RUN`。acceptance 证据见 [`Module-Test-002`](../module-tests/Module-Test-002-EnterpriseProject.md#im-06-191-resolution-receipt-用例) 与对应 Issue/PR 记录。

### #229 确认 Receipt Ref 的授权发现与复用边界（实现契约）

状态：`T2 / DESIGN APPROVED / HUMAN DESIGN APPROVED 2026-09-27 / IMPLEMENTATION PRESENT (#231) / EXACT REVISION VERIFICATION AND REVIEW EVIDENCE IN PR #232`。#191 Receipt Query已实现；本段只闭合 [Spec003 §24.4](Module-Spec-003-TaskExecution.md#244-human-答案验证receipt-与-resolution) 所需Human实际取得其Ref的缺口：现行confirmation通用CommandResult不能被当作已返回规范content-addressed Receipt，commandId/request hash不能推导Receipt hash。

已交付 EP 内部 `readConfirmationReceiptRef(commandId)`，受信输入closed `{commandId:UuidV7,scopeRef:ProjectScope}`，result closed `{commandReceiptRef:CONTENT_ADDRESSED/zhiju.project.command_receipt}`。认证HUMAN必须等于该confirmation的actor，持有当前本Project Receipt-read权限；受信SERVICE使用自身独立consumer-read权限读取时不得冒用Humansession。动作 `project.confirmation_receipt.ref.read.v1`，Purpose `project.resolution_receipt.read`，target是该命令Receipt OBJECT镜像身份，config `confirmationReceiptRefReadV1`，完整scope/payload/session/Decision在protected read前与返回前复验。实现复用 `resolution_receipt_material` 与#191 exact canonical重算/owning联核，只对COMMITTED `project.confirm_customer_material@1.0`返回真实Ref，其他/未知/无法证明统一 `PROJECT_QUERY_NOT_FOUND`；授权错误沿用共享码。组成层将结果交给Human后仍通过已注册 `project.get_resolution_receipt@1.0`读取证明；不改公开confirmation/query结果，不提供SQL/Repository。

恢复只复用既有register/accept/propose/confirm材料、capture/read Source Slice与Receipt Query：Sources必须当前ACCEPTED，candidate→confirmed为真实previousVersion/source_command/BusinessDecision链。Slice的registered requestedKinds集合不增加customer_material，不向现有factItems注入未定义材料shape；TE从attestation构建reference-only MATERIAL item，EP不宣称该item具备正文/文件读取能力。本段无EP schema/migration/public-operation增量，V2015/旧fixture完全保留。跨Scope、相同correlation不同材料、伪Receipt/未提交/错误Hash以及撤销/过期读权限仍拒绝；TE消费不会修改EP对象、Source或confirmation历史。运行边界见 `EP-REC-D-001/002`。

已交付可供 TE 验证 PROPOSED candidate/current Source 的权限裁剪 owning 读路径；Receipt仅对已确认命令可用，不能在Run-1 final前充当candidate证明。内部 `readCustomerMaterialRecoveryReferences`：closed输入 `{candidateMaterialRef:VERSIONED/zhiju.project.customer_material,requiredSourceRefs:NonEmptySet<CONTENT_ADDRESSED/zhiju.project.source_material>,confirmedMaterialRef?:VERSIONED/zhiju.project.customer_material}`；closed结果 `{candidateMaterialRef,candidateStatus:PROPOSED|CONFIRMED,candidateSourceRefs:NonEmptySet<SourceMaterialRef>,sourceStatuses:NonEmptySet<{sourceMaterialRef,status:ACCEPTED}>,checkedAt:UtcInstant}`，带confirmedRef时结果另必填 `{confirmedMaterialRef,confirmedStatus:'CONFIRMED'}` 并证明同Root previousVersion关系。candidateStatus表述当前Root分类状态，candidate本身仍是不可变PROPOSED version；不把确认后的Root状态写回该旧版本。Port从现有CustomerMaterial/Version/Source的owning读取及精确ref校验逻辑组合，不新增表/Schema；不返回正文、storage locator或任意查询条件。Purpose `project.customer_material.recovery_refs.read`、SERVICE actor、action按Spec001 §15.14逐consumer配置，target=候选material OBJECT身份，完整VERSIONED/Source refs在Decision payload固定；先授权后读及返回前重验，错Hash/Scope/Source非ACCEPTED或版本链不可证按既有 `PROJECT_MATERIAL_SOURCE_INVALID` / `PROJECT_MATERIAL_VERSION_NOT_FOUND` 的安全外观拒绝，依赖暂不可读为共享DEPENDENCY_UNAVAILABLE。该 internal Port 与 Receipt Ref Port 均为 #231 交付的 EP 内部增量；无新增 public operation。


## 23. 精确 TaskCompleted 关联与 DeliveryItem Completion 设计（#237）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-01 / DESIGN REVIEW PASSED / IMPLEMENTED IN #239 PROPOSED REVISION / RUNTIME EVIDENCE IN MODULE-TEST`。本节是[设计决定](../decisions/task-completed-delivery-completion.md)的 EP 唯一字段权威。§21现有grammar、v1与历史Plan/Evaluation不改写。新增profile与Major Command明确隔离新的精确语义；只有内部有权限的composition支持首版，公开HTTP/UI不在范围。

### 23.1 新冻结标准与精确关联

新 DeliveryItem `completionCriteria` 为 closed `{profile:"ep.delivery_item.exact_task_completion@1.0",allOf:NonEmptySet<criterion>}`。首版恰一 Task criterion：closed `{eventType:"execution.TaskCompleted",taskRef:ObjectRef<zhiju.execution.task>}`，可再含恰一 Release criterion：closed `{eventType:"release.ReleaseCompleted",factRef:ObjectRef<release.release>}`（`release.release`沿用Release owning实现自身Ref拼写，不引入别名）；同Project Scope、预分配真实UUIDv7，未知profile/criterion、重复/额外字段拒绝。Task UUID在Plan起草前预分配，Human批准/激活的是该具体标准；随后TE用该UUID创建Task，definition指向这个 exact Item/version。Plan不要求尚未创建的Task存在，不制造反向同步Query。旧 `allOf` grammar不能自动变新profile，@1.0原unknown-key检查会拒绝新profile，无法覆盖此Item新pointer；@2.0拒绝旧grammar。

TE的immutable sidecar定义唯一见Spec003 §26.1。EP受信消费入口先证明composition所持材料由TE owning readClaimed取得，拒绝caller传入任意JSON/自报SERVICE/Producer字符串。它不由EP回查TE；受信composition依次调用Owner Port、验证结果并建立私有调用上下文。Dispatcher自身身份和EP Consumer SERVICE身份可不同，各持自己的Decision/Actor，不转让producer Command的授权。

EP在自身事务从sidecar exact Item `(objectId,versionId,enterpriseId,projectId)`查行，取得该版本所属 `delivery_plan_id`，构造规范 VERSIONED/zhiju.project.delivery_plan；不查询activeVersion来替代请求Version。核对event.taskRef、aggregateType/id、taskEvaluationRef、Scope和完整bindingHash；只接受首版canonical Task。一个成功消费追加与 Fact 一对一 immutable `delivery_completion_task_association`，保存原Task/definition/Evaluation/Item refs、EP解析的Plan Ref、event/public/stored/envelope/binding Hash和watermark Hash。它保存历史归属，不要求该版本此刻仍active，也不直接改变Item。后续评估要求 exact Plan仍active。

选中 Task Fact 必须同时满足：TaskRef全等冻结criterion.taskRef；association Item/Version/Plan/Scope全等本次目标；Event taskRef/evaluationRef及aggregate镜像一致；非空satisfiedFactRefs为Event中原正式refs。另一Task、同Task另一个Item、同Item另一Version或Plan不能替代；只有Project-wide eventType或UUID相等不够。无binding的旧合成Fact可继续旧§21技术测试，但不能经新入口满足标准。

### 23.2 Inbox、完整性与并发

沿用consumer=`enterprise-project.delivery-item-completion`和既有Fact Ref objectType=`DeliveryItemCompletionFact`；其Hash继续是**源public Event payload Hash**（不是整个Fact Row/sidecar Hash），Ref objectId与immutableVersionId均为factId。新增association Hash独立覆盖关联；readback不能凭FactRef Hash断言关联完整。

同consumer/eventId并发必须先用数据库唯一claim或等价串行锁裁决，输家等winner提交后读取原结果；winner回滚则允许重新claim，不泄漏23505。相同event public payload/envelope/binding/watermark全部Hash和Scope全等→DUPLICATE，返回原factRef；任一身份/Hash/水位冲突→QUARANTINED和append-only `INBOX_HASH_CONFLICT` violation，保留原PROCESSED Inbox/Fact/Association/Process不变。不能把合法原Inbox改成QUARANTINED，也不能用同payload掩盖另一aggregate/actor/binding。

成功事务原子写Inbox PROCESSED、immutable Fact、Association、消费Process/Step及安全Audit。提交前任一点故障全部回滚；此事务不写Item pointer、不发布DeliveryItemCompletionSatisfied。无权拒绝发生在protected repository读取前；bad contract/Hash/scope不存客户payload至violation，使用受信Scope的安全码。合法但未绑定Task的Event不被新consumer假称PROCESSED。

低/迟到watermark仍追加历史Fact，不覆盖已有事实。最新选择按**同一 exact PlanVersion/Item/Task关联**的source sequence（同源同partition），不按Project全局max丢弃别的Item事实。v2选集含本关联较旧的Task Fact且已有较新同关联Fact时返回PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID，0新Evaluation/pointer/Event；新高序Fact可新评估。不同partition/source水位不可比，observedAt和completedAt不是版本序。EP拥有本Project Completion ledger串行锁，消费与v2评估都按 ledger→Item 的固定锁序，锁后重读关联最高水位与revocation集；避免消费已提交而评估漏看新事实。分区最大observed序号只作诊断，不声明完整checkpoint。

### 23.3 新公开 Command 与不可变评估

新增 `project.evaluate_delivery_item_completion@2.0`，COMMAND/EVALUATE，target为OBJECT/zhiju.project.delivery_item，expectedAggregateVersion必填（独立completion_aggregate_version）；Purpose沿用`project.delivery_item.evaluate_completion`。closed payload：

```text
{deliveryPlanRef:VersionedRef<zhiju.project.delivery_plan>,
 deliveryItemRef:VersionedRef<zhiju.project.delivery_item>,
 factRefs:NonEmptySet<ContentAddressedRef<DeliveryItemCompletionFact>>}
```

Item.versionId必须等Plan.versionId，target.objectId/Scope等Item，Plan与实际行全等且版本为ACTIVE/Root.active_version_id等该exactVersion（此处只作eligibility检查，不做目标选择）。事实选集由caller给exact EP ledger refs，服务端从EP读取并完整验证，不能提交外部输出ref、TE Evaluationref或假Fact；选集只能包含这个Task关联的TaskCompleted，及新criteria指定精确ReleaseRef的ReleaseCompleted，其他Task/Item/事件或额外事实拒绝。缺Release允许合法只选Task Fact并派生UNSATISFIED，不强制提交不存在的Release Fact。Fact集合非空，未知/不可见/错Hash统一安全拒绝。

criteriaHash沿用既有域 `SHA256(cv1({criteria: storedCompletionCriteria}))`；sourceWatermarks从selected ledger派生并去重，evaluatedAt/recordedAt来自受信服务端clock（数据库记录时间不冒充caller时间）。server evaluator固定为构建期`ep.delivery_item_completion.evaluator@2.0`，VERSIONED/zhiju.project.evaluator_profile、scope={}、objectId=`0199b700-0000-7000-8000-000000000201`、versionId=`0199b700-0000-7000-8000-000000000211`；Profile code/版本绑定由EP构建期registry精确解析，不是IP业务Policy或客户自报Evaluator。其算法只应用本节冻结criteria，不引入通用Policy Engine。

Evaluation沿用owning `delivery_item_completion_evaluation`/CONTENT_ADDRESSED `CompletionEvaluation`。v2 closed canonical payload=`{enterpriseId,projectId,deliveryPlanRef,deliveryItemRef,criteriaHash,evaluatorRef,factRefs,associationHashes,sourceWatermarks,revocationFactRefs,outcome,satisfiedFactRefs,evaluatedAt,taskFactSemantics:"HISTORICAL_COMPLETION"}`，不含自身ref/hash。集合按cv1 UTF-8字节序稳定排序，重复拒绝；associationHashes按对应factRef顺序。input fingerprint覆盖上述除outcome/satisfiedFactRefs/evaluatedAt外的全部字段（其中revocationFactRefs是当前与selectedsubjects精确相交的已消费撤销事实），不使用localeCompare；fact/source/evaluator/ref/hash逐层校验。相同fingerprint复用immutable Evaluation；若它已不是current pointer，返回历史ref但不把pointer回退，Result另给本次实际aggregateVersion。

新判断、pointer CAS、Receipt/Audit/Edges、必要Impact和已注册Completion Event保持一个EP事务；UNSATISFIED也保存Evaluation并推进pointer，satisfiedFactRefs=[]，不发CompletionSatisfied。非SATISFIED→SATISFIED才发1条；相同事实重放0条、已SATISFIED的新历史评估不再发，撤销后再次满足沿用§21。Release-required永不因Task完成跳过Release；existingRelease/Quality REVOKED排除规则保留。fingerprint含相关撤销集，避免沿用旧v1遗漏撤销的缓存结果。Evaluation事务回滚不撤回先前Inbox/TE事实。直接execution_status=COMPLETED仍拒绝。

Result.data closed `{evaluationRef:ContentAddressedRef<CompletionEvaluation>,outcome:SATISFIED|UNSATISFIED,satisfiedFactRefs:ContentAddressedRef<DeliveryItemCompletionFact>[],aggregateVersion:PositiveInt,impactReviewRef?:ContentAddressedRef<DeliveryItemImpactReview>}`；合法command沿用共享CommandResult/Receipt语义，同键同输入DUPLICATE返回原精确结果，同键异输入IDEMPOTENCY_PAYLOAD_CONFLICT。当前授权先于原Receipt读取/返回，replay不要求历史Plan仍active或重造事实；新键重新检查当前active/criteria/ledger/CAS。

### 23.4 EP owning authoritative readback

新增**内部** `DeliveryItemCompletionReadbackPort.readExact`，非公开Query、不进Catalog。独立HUMAN或明确EP Reader SERVICE授权；closed输入 `{deliveryPlanRef,deliveryItemRef,factRefs,evaluationRef?:ContentAddressedRef<CompletionEvaluation>}`，前两Ref沿用v2类型，factRefs为非空exactFact集合；evaluationRef省略时只读取该exactItem pointer，提供时读取该immutable历史Evaluation。不接受latest/current作为身份、不把optional省略当跨版本选择。

closed结果：`{deliveryPlanRef,deliveryItemRef,criteriaHash,facts,evaluation?,currentEvaluationRef?,completionAggregateVersion,derivedStatus:NOT_EVALUATED|SATISFIED|UNSATISFIED,selectedEvaluationIsCurrent,taskFactSemantics:HISTORICAL_COMPLETION,taskCurrentUseStatus:UNKNOWN,checkedAt}`。facts只含请求的精确事实：每项`{factRef,eventId,eventType,eventVersion,taskRef?,taskEvaluationRef?,deliveryPlanRef?,deliveryItemRef?,bindingHash?,payloadHash,sourceWatermark,lifecycle}`；Task项的optional关联成员全部必需，Release项无Task关联；evaluation若有为`{evaluationRef,deliveryPlanRef,deliveryItemRef,criteriaHash,evaluatorRef,factRefs,satisfiedFactRefs,sourceWatermarks,revocationFactRefs,outcome,evaluatedAt}`。Ref与返回EvaluationHash都基于完整存储payload重算，安全投影不另造Hash。事实Ref的原payload Hash与关联/镜像单独复验，pointer必须同Plan/Version/Item；当前pointer Evaluation的所有源refs也在本次独立read授权下核验，不只校验caller给的facts。

derivedStatus由本Item当前pointer和已消费revocation的独立重算给出，不能直接用caller选择的历史Evaluation.outcome；无pointer=NOT_EVALUATED，有历史SATISFIED而当前所需fact已被消费撤销=UNSATISFIED，可返回历史outcome供追溯但不改写它。若新Fact尚未评估且会改变当前解释，读回重新计算当前pointer的精确criteria/事实集（不自动添加未被pointer选择的新Task/Release），不能把待评估新Fact直接升格为SATISFIED。脱离activePlan/Project可保留授权后的历史Evaluation，当前derivedStatus按冻结支持资格返回UNSATISFIED，selectedEvaluationIsCurrent只表示pointer identity。此Port只断言EP ledger观测时点，TE current usability未知；Projection freshness不构成证据。

### 23.5 兼容、安全外观与交付

新profile、新staticselector和@2.0已在本修订实现；不改已发布@1.0/TaskCompleted/200基线。Schema包含closed请求/Result、全部typedRef paths、CUSTOMER_CONFIDENTIAL分类、EVALUATE concurrency与operation-specific resultSchemaRef，无新PayloadGuard参数。

错误复用：注册/Envelope错误→共享API；unknown profile/grammar/缺条件→PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED；wrong exact Task/Item/Plan/association/fact/hash→PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND或PROJECT_DELIVERY_REFERENCE_INVALID，跨Scope/不可见对象统一NOT_FOUND/授权拒绝；水位旧选集→PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID；CAS→CONCURRENCY_CONFLICT；暂不可用→DEPENDENCY_UNAVAILABLE；Decision/Actor/session/撤权/过期→AUTHORIZATION_DECISION_INVALID；同event冲突→既有QUARANTINED结果。不得在safeSummary区分其他Scope对象存在性、返回客户正文或TE内部状态。

当前taskDefinition不可变关联保证历史一致性，不证明TE当前USABLE；没有Task invalidation事件时不虚称失效闭环。Module-Test 002 #237定义上述正反例、late/replay与事务effects；实现入口为 `createExactDeliveryCompletionConsumer`、`handleEvaluateExactDeliveryItemCompletion`、`createDeliveryItemCompletionReadbackPort`，持久化为 `V7012__exact_delivery_completion.sql`；具体运行层级见该矩阵，未执行子项保持 NOT RUN。

## D14 / RD-01 准备、报告与启动字段提案

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。方案与选择见 [Spec Delta](../decisions/d14-rd01-first-customer-flow.md)。本节拥有 EP 字段；不修改上文已发布 @1.0、13 个 scope Query 接受名或旧 PROJECT_START 创建条件。

以下 Ref 均使用共享 wire shape：OBJECT `zhiju.project.project`（objectId=scope.projectId）、`zhiju.project.enterprise`；SNAPSHOT `zhiju.project.preparation_source`、`zhiju.project.preparation_report`、`zhiju.project.startup_candidate_set`、`zhiju.project.preparation_file_plan`；OBJECT `zhiju.project.preparation_request`、`zhiju.project.startup_request`；CONTENT_ADDRESSED `zhiju.project.startup_decision`。新增类型全部是提案；EnterpriseRef 仅 Enterprise Scope，其余同一 Project Scope。UUIDv7、exact snapshotId/contentHash、生命周期/来源水位和当前授权必须均可解析；legacy 拼写只能在明确调用旧操作时使用，不能把 wire alias 随意互换。

### EP 操作、输入和结果

所有 Command 沿用 Envelope targetRef、idempotencyKey、payloadHash、Actor/Decision、CREATE 或 CAS；敏感原名/正文不进入 Event/普通错误。Query 都是 AUTHORITATIVE，按当前身份裁剪并返回 sourceWatermarks；不存在或不可见同一外观。

| 拟操作@1.0 / mode | 封闭 payload | Result data / purpose |
|---|---|---|
| `project.find_preparation_enterprises` / Query | `searchText: Sensitive<string>; page:{limit:1..50,cursor?}` | `Page<{enterpriseRef,displayName,displayCode}>`，cursor 绑定身份/查询水位；`project.enterprise.select`；只搜当次许可企业，不按名称确立身份 |
| `project.request_project_preparation` / CREATE preparation_request | `customer: {mode:EXISTING,enterpriseRef}或{mode:NEW,displayName}; projectTitle; preparationPresetRef:VERSIONED` | requestRef + per-step Enterprise/Project receipts + disposition；`project.preparation.request`；NEW 企业创建与项目创建独立，预分配 ID/显示编号/默认 objective/memberPolicy 来自锁定预设 |
| `project.get_project_preparation_request` / Query | `requestRef; originalKey` | 原 request binding + step facts/current permitted action；`project.preparation.read`；恢复使用 request_project_preparation 原键原 payload，无新企业 |
| `project.create_preparing_project` / CREATE project | `enterpriseRef; displayCode; title; objective; memberPolicyRef; preparationPresetRef` | projectRef + aggregateVersion=1 + creationMode=PREPARATION/status=PREPARING + receiptRef；`project.project.prepare.create`；单 Project 事务创建 Root/Claim/最小 Event，无 start refs |
| `project.capture_preparation_source` / CREATE snapshot | `projectRef; intakeManifestRef; templateRefs:NonEmptySet<CONTENT_ADDRESSED>; ruleBundleRef; previousReportRef?; trustedDecisionRefs:Set; purpose:preparation.analysis; audience:PrincipalRef` | preparationSourceRef + bytes manifest binding + coverage/omissions/redactions + validUntil；`project.preparation.source.capture`；只纳当前 ACCEPTED 源与 published refs |
| `project.get_preparation_source` / Query | `preparationSourceRef; purpose:preparation.analysis; audience:PrincipalRef` | 原不可变 source payload + currentUsability/reasons/validUntil；`project.preparation.source.read` |
| `project.accept_preparation_report` / CREATE report snapshot | `projectRef; expectedPreparationVersion; analysisResultRef:CONTENT_ADDRESSED; analysisResultAcceptanceRef:CONTENT_ADDRESSED; preparationSourceRef; expectedPreviousReportRef?; outputProfileRef:VERSIONED` | reportRef + candidateSetRef + planRef + becameCurrent + receiptRef；`project.preparation.report.accept`；EP Validator SERVICE，经 TE result Query 取真实 outputs，不接 caller JSON |
| `project.get_startup_review` / Query | `projectRef; reportRef?` | binding + informationGroups + candidateReviews/evidenceViews + required/confirmationCandidateIds + plannedFiles/blockers + allowedActions + currentUsability；`project.startup.review.read` |
| `project.request_startup_confirmation` / CREATE startup_request | `binding:StartupBinding; confirmationCandidateIds:NonEmptySet; selectedFileIds:NonEmptySet` | requestRef + immutableIntentHash + per-step refs/disposition + permittedRecoveryActions；`project.startup.confirm`，Human-only；客户端不提交批准人、值修改或 start refs |
| `project.start_preparing_project` / MUTATE project | `startupRequestRef; informationDecisionRef; startSnapshot:既有完整ProjectStartSnapshot` | projectRef + aggregateVersion + startBindingRef + 三个真实 start refs + receiptRef；`project.project.start`，Human-only，Process 只执行精确 Human 决定，并取得独立当前授权，expectedAggregateVersion 必填 |
| `project.get_startup_request` / Query | `requestRef; originalKey` | 原 binding/选择 + 每步状态/真实 refs/receiptRef + disposition + currentUsability/reasons；`project.startup.request.read` |
| `project.resume_startup_request` / MUTATE startup_request | `requestRef; originalKey; action:READBACK或CONTINUE_PENDING_STEP` | 同一请求回执，键/payload 不可改；`project.startup.request.resume`；续写 Human-only、每步独立授权/CAS |

StartupBinding 必填：projectRef、expectedProjectAggregateVersion、expectedPreparationVersion、reportRef、reportJsonBytesSha256、candidateSetRef、planRef、preparationSourceRef、inputManifestBytesSha256、ruleBundleRef、startupRulesRef、vocabularyRef。输入指针变化必须推进 preparationVersion，不能只用 Project CAS；确认提交必须在 EP request 事务锁定该 preparationVersion/current report，并与 source refs/hash/规则当前有效性一致。信息决定记录 candidate ID→确认值/来源/EvidenceRef、ActorSnapshot/AuthorizationDecision、rule refs、原意图 hash，永远不可改。适用性/保护例外/最终批准各自独立，普通确认不具备其授权。

报告 snapshot、候选集合及计划字段/hash 域见 [报告交接提案](../decisions/runner-analysis-report-v0.2.md#d14--rd-01-正式交接提案)。startup Query 使用 [DTO 映射](../decisions/workspace-startup-review-v0.1.md#d14--rd-01-公开操作映射提案)，不是直接采用 design.* fixture。候选 ID 按 UTF-8 排序形成集合 canonical hash；plannedFile 的完整 change/dependency/protection refs 均绑定报告。新报告不能改同 ID 历史内容；需新 snapshot 并明确 supersession/影响。

### 前置对象、决定与一次 start

Human-only `request_startup_confirmation` 先提交不可变意图/认证决定；专用 EP Process 逐步建立既有 propose/confirm_enterprise_fact、Product create/version/activate、QMS create_revision/activate、Profile/ProductScope snapshot 的真实 facts。既有 Capability 的输入/错误/非公开边界继续见 [前置矩阵 §4–6](../decisions/enterprise-project-capabilities.md)。它们由 EP owning Process 调用，不暴露成 BFF 内部业务 API；每个 Aggregate 独立 Receipt/idempotency/CAS，当前撤权不能靠保存旧 Decision 继续写。管理选择 BusinessDecision 由 EP 在真实 Human 决定事务形成，不从 Runner 引用解析。Evidence 使用既有 Quality owning capture/verify/get，不创造 EP Evidence 副本。

同一 Project start 事务：重验当前身份、ScopeClaim、PREPARING、两个版本、原 request/decision、report/source/rule 当前性，验证真实 Fact/Product/QMS 来源及三 start refs 同 Enterprise，插入唯一 PROJECT_START、转 ACTIVE、写 Receipt/Audit/Event，任一失败全回滚。启动后来源/企业版本变化仅产生影响事实，不替换 start binding。start 事件拟 `project.PreparingProjectStarted@1.0`：projectRef、startBindingRef、informationDecisionRef、startedAt；准备创建拟 `project.PreparingProjectCreated@1.0`：projectRef、enterpriseRef、creationMode、createdAt。不复用旧 ProjectCreated 来暗示已经 start。

### 拟错误与安全外观

`PROJECT_PREPARATION_INPUT_STALE`（pointer/水位变化）、`PROJECT_PREPARATION_REPORT_INVALID`（binding/hash/alias/profile）、`PROJECT_STARTUP_INFORMATION_INCOMPLETE`（必要值/代码/结构不足）、`PROJECT_STARTUP_HUMAN_REQUIRED`、`PROJECT_STARTUP_INTENT_CONFLICT`、`PROJECT_START_ALREADY_BOUND`、`PROJECT_WORK_SCOPE_BLOCKED`。Scope/不可见统一 NOT_FOUND/授权拒绝；CAS→CONCURRENCY_CONFLICT；同键异内容→IDEMPOTENCY_PAYLOAD_CONFLICT；owner Port 不可用→DEPENDENCY_UNAVAILABLE。安全 reasons 不回显客户正文、路径、其他 Scope 对象状态。

### EP 正常与恢复 trace

新客户：preparation request→Enterprise Receipt→PREPARING Project→ZIP manifest→source→accepted report→Human decision→Fact/Product/QMS/Profile/ProductScope 独立 receipts→唯一 start→TE scope Receipt。已有客户显式选择 ID 和精确版本走同一链。任一步失败按 [转换表](../decisions/d14-rd01-first-customer-flow.md#5-转换原意图与恢复) 保留成功事实；晚报告不覆盖 current、UNKNOWN 先读原键、撤权不续写。首版范围接收不激活 DeliveryPlan，不以 GapAnalysis 的 ACCEPTED/模板数量代替范围。

### ACTIVE 首轮范围重核对与精确 Human scope 决定

本分支只覆盖同一 Project 已 start 但**从未成功接收初轮 workScope** 的恢复，不开放后续生成/反馈/普通批次，也不重复确认或激活 Fact/Product/QMS。EP/TE 各自拥有资格事实：EP 唯一 PROJECT_START，TE 当前初轮 scope 接收证明；无 TE 权威证明或依赖不可用 fail closed。第一次 startup request 的 Human 信息决定与范围决定是两个不同不可变对象，服务端在同一原 Human 显式确认事务分别产生：informationDecisionRef 指向 startup_decision；humanScopeDecisionRef 指向 CONTENT_ADDRESSED `zhiju.project.initial_work_scope_decision`，后者绑定 decisionId、projectRef、originalRequestRef、immutableIntentHash、projectStartBindingRef（初次 start 完成后由不可变 request→start 事实关联，不改写决定 payload）、reportRef、planRef、完整 selectedFileIds/fullChangeIds/dependency/protection refs、ActorSnapshot/AuthorizationDecision、scopeDecisionPolicyRef 与 recordedAt。首次决定在 start 前不填写不存在的 start ref，明确 `startBindingMode:START_FROM_SAME_REQUEST`；ACTIVE 恢复固定 `startBindingMode:EXISTING_FROZEN_START` 与真实 binding ref。TE 必须验证该分支及实际 owning request→start 链，禁止自洽伪造。

| 拟操作@1.0 / mode | 封闭 payload | result / purpose |
|---|---|---|
| `project.request_initial_scope_confirmation` / CREATE OBJECT `zhiju.project.initial_scope_request` | `binding:{projectRef,expectedProjectAggregateVersion,expectedPreparationVersion,projectStartBindingRef,reportRef,reportJsonBytesSha256,preparationSourceRef,inputManifestBytesSha256,planRef,ruleBundleRef}; selectedFileIds:NonEmptySet` | requestRef + immutableIntentHash + humanScopeDecisionRef + information:NOT_APPLICABLE/start:EXISTING + scope step state/Receipt + disposition；`project.initial_scope.confirm`，Human-only，ACTIVE、creationMode=PREPARATION 且未收到首轮 scope |
| `project.get_initial_scope_request` / Query A | `requestRef; originalKey` | 原 binding/选择、真实 Human scope decision/TE scope Receipt、currentUsability/permittedRecoveryActions；`project.initial_scope.request.read` |
| `project.resume_initial_scope_request` / MUTATE | `requestRef; originalKey; action:READBACK或CONTINUE_PENDING_STEP` | 相同 request/decision/scope refs；`project.initial_scope.request.resume`，续写重验当前授权；不允许换文件/report/key |

原 startup 或 initial-scope 请求 STALE/阻塞时保留全部历史；读当前 EP review 后，Human 显式提交新的 initial-scope intent，可只选择独立 eligible 子集。旧 request 不改，旧 info/start 仅引用真实已提交事实；新的 scope decision 不重新启动/激活企业版本。GET startup_review 对该 ACTIVE 恢复分支返回既有 start refs、`confirmationMode:INITIAL_SCOPE_ONLY`、当前 report/plan/阻塞和 allowedActions，不把新 startupCandidates 设成待再次确认启动字段。

若首轮接收前补料使旧 report stale，EP 新 source capture/accept report 与 TE preparation profile 有界允许 `PREPARING` 或 `ACTIVE + creationMode=PREPARATION + 初轮scope未接收 + 精确已有start binding`。ACTIVE source/Context/报告附 `phase:INITIAL_SCOPE_RECOVERY` 和 `projectStartBindingRef`，冻结 start 作为只读参考，不重新生成信息版本。报告必须结合该冻结 start 保留已确认客户保护事实，候选冲突由 owning eligibility 显式阻相应整文件；任何变化使必要启动依据失效，则报告可审阅但初轮范围不能接收，须 owning impact review，不用这条恢复替换 start。已成功接收初轮范围后，该分析/确认入口拒绝；后续分析/批次由另行设计合同承担。

TE 拟权威 Query `execution.get_initial_work_scope_state@1.0` 输入 `{projectRef,projectStartBindingRef}`，result `{initialScopeState:NOT_RECEIVED或RECEIVED,workScopeRef?,receiptRef?,sourceWatermarks,currentUsability}`。EP 专用 source/eligibility Port 用它与现有 start 证明生成上述允许分支，Query 本身不是保留资格。TE receive 在自己的最终提交事务以 `(enterprise_id,project_id,initial_scope_purpose)` 唯一约束裁决多个新/旧请求，只允许一份首轮 scope；同 request/hash 返回原 Receipt，不同请求输家 `INITIAL_SCOPE_ALREADY_RECEIVED` 且不把自己的决定伪装为已接纳。分析 dispatch/final/report 接纳也重验该窗口的 TE owning 状态；窗口关闭后已合法 Run 终结结果可留历史但不能覆盖可操作 current report，后继当前范围变化走 impact 而不重接首轮。

## Workspace 授权项目目录提案（#258）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / REGISTERED (240th public operation; frozen 200-operation v1.0 baseline unchanged) / IMPLEMENTED (#266) / EXECUTION EVIDENCE IN ISSUE-PR / CONTROLLED KEYCLOAK JOURNEY AND BUILT-BROWSER JOURNEY EXECUTED IN THE EXACT-HEAD PERSISTENCE GATE (ISOLATED REALM/CLIENT/USER, PINNED 26.7.0) / PRODUCTION DEPLOYMENT, PLATFORM MATRIX AND MANUAL ACCEPTANCE NOT RUN`。这是首个 Human 工作台必需的有限 additive Query，不修改既有 project board、D14 request/Receipt、Project状态机或业务 Schema 所有权。技术入口见 [Session Delta](../decisions/workspace-trusted-session-public-access.md#4-授权目录与工作台来源)。

| 拟 operation / consistency / Scope | 封闭 payload | result data / Purpose |
|---|---|---|
| `project.find_workspace_projects@1.0` / AUTHORITATIVE / 专用 self-discovery `scopeRef={}` | `enterpriseRef?:ObjectRef<Enterprise>; searchText?:Sensitive<NonEmptyString>; page:PageRequest`，pageSize=1..50；不接 requester/Principal列表/自由Scope集合 | `Page<WorkspaceProjectSummary>`；`project.workspace.discover`，实际 requester由Core验证；空Scope只用于自身目录、不授业务权 |

`WorkspaceProjectSummary={enterpriseRef:ObjectRef<Enterprise>,projectRef:ObjectRef<Project>,enterpriseDisplayName:SafeSummary,displayCode:NonEmptyString,title:SafeSummary,status:owning已注册Project状态,aggregateVersion:AggregateVersion}`。D14 PREPARING 仅在其状态/Schema 已注册后可返回；新目录不扩大旧 operation 的闭集。结果保留 owning ProjectRef 完整类型/Scope，不按名称或前缀改身份；无正文、源材料、外部Subject、权限条款、其他项目计数或“已完成”推断。显示名称仍仅在当次 Project discovery 许可下读取。

执行顺序：Core verified self requester → IP 内部 self候选 Port → 每个候选取得 IP 当前 `project.workspace.discover@1.0` scoped Decision → 本模块在该精确 Enterprise+Project RLS Context 读自己的 Project/必要企业显示摘要 → 返回前当前权限重验。IP Port 字段/mapping 唯一见 [Spec001 #258](Module-Spec-001-IdentityPolicy.md#workspace-可信-human-入口与目录授权提案258)；候选不是 ALLOW，不能以目录空 Scope 扫 EP 全库或跨 Schema join Role/Grant。企业名称只作该已授权 Project 的最小显示字段，不授予企业正文读取权限。

稳定排序 `(enterpriseId,projectId)`；仅对受权摘要执行规范化 search/enterprise filter。目录 Cursor 绑定 query/version、实际 Principal、稳定登录sessionBindingHash/代次（非每次validatedAt）、过滤Hash、IP授权集合指纹、EP/IP sourceWatermarks、last sort key与5分钟期限；不含可读Subject/secret。（下段为 #266 审查 R5 的 owner 决定实现事实：）为在每次续读时复验整条链已返回的摘要，本 Query 的 cursor 声明扩展的封闭信封 `^[A-Za-z0-9_-]{16,8192}$`（字母表与共享 OpaqueCursor 相同，仅长度上界按本 Query 声明提高；其他 Board/Query cursor 仍为 16..512），并携带按序的已返回摘要身份与观测 `{enterpriseId,projectId,aggregateVersion,status}`：每次续读逐项在该 Exact Enterprise+Project Scope 下重读并比对，任一变化/缺失/不再受权使该页拒绝 `QUERY_CURSOR_INVALID`（授权集合/会话/过滤变化仍为 `QUERY_CURSOR_SCOPE_MISMATCH`，过期仍为 `QUERY_CURSOR_EXPIRED`）。已返回集合超出声明 cursor 容量时 fail closed 返回 `QUERY_CURSOR_INVALID`，客户端按既有规则从第一页重取；不静默丢失已返回项、不伪称已复验。实现细节（#266 已实现）：每个条目按 42 字节编码（含该摘要被返回时的**原样 Project 身份拼写**，续读按同拼写重新构造候选与 Decision，禁止规范化互转），8192 字符容量约容纳 140 个已返回摘要；每条续读会在其 Exact Enterprise+Project Scope 下重新取得当次 Decision 并重读比对 `aggregateVersion`/`status`，语义等价于“整条链在每次续读时被完整复验”。每页重验当前权限；授权集合/Session/过滤变更拒绝 `QUERY_CURSOR_SCOPE_MISMATCH`，过期 `QUERY_CURSOR_EXPIRED`，前端从第一页重新读取。内部候选扫描单请求最多200项/5秒，输出≤pageSize；尚有候选则返回绑定nextCursor，即使本页过滤为空也不能宣称全目录空。各 Scope 在自己的 Context 下读取，无全局事务/权限；返回 PAGE 的 snapshotAt/watermarks 是读取观察，不是跨 Enterprise 原子快照。

翻页的snapshotAt/asOf与sourceWatermarks固定为首屏观察，不能按翻页时刻漂移。EP/IP相关源水位在逐项读取前后及最终返回检查点变化则拒绝该页 `QUERY_CURSOR_INVALID` 并从首屏重取，不新建目录Snapshot或技术Session业务cache；当前权限仍独立重验，不能以首屏asOf恢复已撤Grant。水位范围只覆盖候选来源和已许可摘要，不暴露未授权项目变化计数。

合法页均返回 `OK + data:Page<WorkspaceProjectSummary>`，包括 `items=[] + nextCursor` 的空中间页；Page 与 QueryResult 的 nextCursor 同值，枚举未完必须返回绑定游标，完整末页才省略。客户端按游标继续分页，不为得到非空页突破200项/5秒扫描预算；只有同一有效游标链枚举完整、末页无nextCursor且累计可见项为零才显示完整EMPTY，空末页不清空之前的非空项。IP/EP依赖失败为 DEPENDENCY_UNAVAILABLE、无部分数据伪装完整目录。不返回未授权项目存在性或全局总数。新准备项目若尚无真实 current discovery Grant 不进入目录，owning preparation request 页面仍按其当前 read权回读，不补权限或伪造卡片。无该 Query 的 handler/注册时工作台目录不可用，BFF不能从旧缓存、匿名原型、Repository或per-project board推导项目集合。

选中项目后的 `project.get_project_board_slice@1.0` 仍只读指定 Project 的 DeliveryItem，`execution.get_task_board_slice@1.0` 仍由 TE 独立拥有；两者各验自身当前权限和consistency。目录项不作为board/data资格、不扩大分页分母。跨项目工作台首版只用本目录的项目卡片和受控单项目看板，不新增跨项目任务Projection/完成判据。

实现事实（#266）：目录 Query 已注册为第 240 个公开 operation（冻结的 200-operation v1.0 baseline 保持不变，属 `operation-added-as-minor`）；EP 侧逐项目摘要在精确 Enterprise+Project RLS Context 内经 `readWorkspaceProjectSummary` 读取，只返回本节的 `WorkspaceProjectSummary` 最小字段。目录页的 `enterprise_project` 水位是**读取观察**：`servedObservationDigest` 对首屏已返回摘要的 `{enterpriseId,projectId,aggregateVersion,status}` 取 cv1 摘要，`enterpriseProjectWatermarkSequence` 只取该摘要的 48 位投影并沿游标链保持不变，不是 owning EP 源 sequence，也不代表全库或未授权项目的任何计数；`identity_policy` 水位取当次 IP 候选集的覆盖 Grant 事实计数，翻页间变化即拒绝该页。`project.get_project_board_slice@1.0` 的 owning Handler 原先只接受遗留内部拼写 `Project`，与其已注册 payload（共享 `objectRef`，`objectType` 为小写点分 namespace）不一致；#266 修正为同时接受 `project.project`、`zhiju.project.project`（注册契约的两种原形）与遗留 `Project`，未改变 payload/result/consistency/cursor/水位语义。

## #257 公司启动规则与词表字段提案

状态：`T2 / DESIGN APPROVED / HUMAN BUSINESS CONFIRMED 2026-10-09 / INDEPENDENT DESIGN REVIEW PASSED 2026-10-09 / HUMAN TECHNICAL APPROVED 2026-10-09 / INTERNAL FOUNDATION IMPLEMENTED (#267) / D14 CONSUMER NOT IMPLEMENTED / IMPLEMENTATION REVIEW APPROVE / HUMAN IMPLEMENTATION TECHNICAL APPROVED 2026-10-10 / PRODUCTION NOT RUN`。实现批准绑定 `b834f072cd3b199693723131096abd8f2a8d4266`，见 [PR #268 正式记录](../reviews/pr-268/Review.md)。公司清单、范围、来源、理由和支持集选择唯一维护在 [公司规则 Delta §1–2](../decisions/company-startup-rules-v0.1.md#2-提交确认的必需清单与词表)；本节拥有字段及确定性业务校验，IP 拥有政策身份、发布事实/当前性与授权。现有 Product/QMS/Fact/Profile、完整 create_project、D14 技术批准与生产 Catalog 接受集不因本内部基础改变。

### 规则、词表和精确 requirement

三个 profile 的 policyDocument 都是封闭结构；代码全集/文字含义引用上述 Delta，不在此复制第二套业务清单。业务清单已逐项确认，精确修订已完成独立复审及人类技术批准；#267 已注册共享内部接受集；生产来源发布、部署 allowlist 和实现修订审批须分别取得。IP owning 的 [独立 Platform registry/producer/resolver](Module-Spec-001-IdentityPolicy.md#独立-platform-profile-registryproducer-与-exact-resolver) 定义外层 canonical snapshot payload；EP 定义下表正文和消费所需 selector，不使用历史 @1.0 保存/读取路径。

| profile / 对象 | 必填字段与约束 |
|---|---|
| `ep.company_startup_bundle@1.0` / IP Platform PolicySnapshot.policyDocument | `bundleCode; bundleVersion; supportedRange:{rangeCode,productTypeCodes,marketCodes,standardTargets,upgradeTargetRef,targetImplementationDate}; startupRulesRef; vocabularyRef; templateBindings:NonEmptySet<{templateCode,templateRef,sourceBytesSha256}>; requirementBindings:NonEmptySet<{requirementCode,requirementRef}>; compatibility:{reportProfile,ruleProfile,vocabularyProfile,requiredFactValueTypes}; supersedesBundleRef?`；业务身份首版 `zhiju.startup.cn_active_device_qms_upgrade / 1.0.0`，目标施行日期 `2026-11-01`；standardTargets/upgradeTargetRef 是 PUBLISHED RegulatoryReferenceVersion 精确 refs，不是裸标准名称 |
| `ep.company_startup_rules@1.0` / IP Platform PolicySnapshot.policyDocument | `rulesCode; rulesVersion; mandatoryFactTypes:NonEmptySet; requiredProductFields:NonEmptySet; minimumProductVersions:PositiveInt; protectionEvidenceRequirements:NonEmptySet; mandatoryRequirementCodes:NonEmptySet; mandatoryChoiceKeys:NonEmptySet; mandatoryDecisionTypes:NonEmptySet; allowedStartupOutcomes; supportSet`；首版分别为 Delta 的1类 TEXT Fact、全部 Product 字段/至少1版、4类保护依据、12/2/3组及当前 TEXT/Product/QMS 支持集；任何条目缺失、重复或自由通配均拒绝 |
| `ep.company_startup_vocabulary@1.0` / IP Platform PolicySnapshot.policyDocument | `vocabularyCode; vocabularyVersion; entries:NonEmptySet<{domain,code,label,meaning,sourceBindings,ownerMapping}>`；domain 闭集 `fact_type/product_type/market/risk_level/requirement/choice/choice_option/decision/decision_outcome`；同 domain+code 唯一，代码/含义/映射随精确版本冻结；Product 原名、用途、产品族及型号不是受控代码 |
| `CONTENT_ADDRESSED / zhiju.project.company_startup_requirement` / Platform | `requirementCode; definitionVersion; text; applicabilityConditions; templateSourceBindings:NonEmptySet<{templateRef,locator,sourceBytesSha256}>; normativeReferenceRefs:Set<RegulatoryReferenceVersion>`；涉及标准/法规判断时 normativeReferenceRefs 必须非空、PUBLISHED、含核验/有效期；由 EP Platform Reference Owner 的受控 import/publish Capability 形成，不能直接用 TEMPLATE/evidence alias 或整文件 Ref 代替条款身份 |

上述三个 Rule/Vocabulary/Bundle Ref 只复用 IP 原生 `SNAPSHOT / identity.policy_snapshot / Platform scope` wire shape；由新 CompanyRuleSnapshotProducer 与 CompanyRuleSnapshotResolver 和独立 `im-ui-company-startup-v1` registry 保存/读回。EP 为 bundle/rules/vocabulary 分别固定同名 profileKey 与 IP 表内唯一 canonical `VERSIONED identity.contract_schema` Ref；按完整 registryVersion/key/SchemaRef 校验，共享已批准构建期制品，不能用 generic identity.PolicySnapshot、historical registry 或 scoped VersionedRef 替代。旧 `record_policy_snapshot/get_policy_snapshot@1.0` 保持 `im02-static-v1`，不因注册新制品而扩大接受集。

每个 requirement payload 和新 IP snapshot 完整 payload 使用 `SHA-256(cv1(payload))`；后者包含 registryVersion/profileKey/policySetVersion/唯一 policySchemaRefs/effectiveFrom/policyDocument，不能仅 hash 正文或省略 selector。返回 view 为 `{policySnapshotRef,payload}`，业务字段从 payload.policyDocument 取得。所有业务字段/精确来源参加 hash；本对象的 Ref/hash、snapshotId、发布证明与可变 current status 不参与自己的 snapshot payload。发布证明在后续 IP 不可变事实中引用已确定的 bundle，避免 hash 循环。集合按 code（词表按 domain+code）稳定排序；相同 code/version 异 payload 拒绝，未知 alias 不猜测。

`protectionEvidenceRequirements` 的四个域固定为 `quality_objectives / organization_responsibilities / operational_processes / product_processes`，分别引用报告既有 QUALITY_OBJECTIVE、ORGANIZATION+RESPONSIBILITY、PROCESS、PROCESS+PRODUCT_RULE 分类及原始 Evidence。报告摘要不是完整保护内容；专业 Human 决定与 Quality Evidence verification 证明本项目所需原条款/关系已覆盖，服务器只校验真实 refs/状态和集合。复杂数据不能转成 TEXT Fact；若规则需要结构化 Fact，按 Delta §5 明确 unsupported blocker。

### 发布校验与读取边界

内部 `CompanyStartupDefinitionValidationPort` 由 EP 执行确定性校验：完整 `im-ui-company-startup-v1` registry/profile/canonical SchemaRef 与 closed policyDocument、精确词表映射、§1范围条件、9份模板和12项 requirement 绑定、必需集合及完整 Product/QMS、source locator 唯一性、标准/法规引用状态。它返回绑定完整 snapshot payloadHash/profile/SchemaRef/child refs 的校验结果；producer 保存前校验各 profile，Publisher 发布前再次校验 outer/child 的完整定义，不修改 IP facts，不证明客户适用性。child refs 只通过新 IP resolver 在自身当前授权下精确读取；IP Publisher 保存该结果与真实 Human 批准后才能生成发布证明，不存在结果/证明则不可用于 startup。

后续尚未实现的 EP 准备 source、报告接纳、startup review/confirmation/start 拟通过 IP CompanyRuleResolutionPort 取得三个 snapshots、publicationRef 和当前 useStatus；该 Port 使用独立 CompanyRuleSnapshotResolver，并按各角色传入上述受信 exact selector，不调用旧 get_policy_snapshot 或 scoped resolve_policy。EP 的 Platform reference resolver 另校验 template/requirement/normative refs；不共享 Repository。历史可读与当前可用分开。公司发布材料不含客户正文、Evidence 或人员名单；客户来源和所有正式 Fact/Product/QMS 引用必须另行在本 Enterprise/Project 的许可范围解析。

拟 `capture_preparation_source` 输入与保存的准备来源绑定增加必填 `companyRulePublicationRef`；服务器核对它与 ruleBundleRef、child refs 和同一 template/requirement 集合，不让浏览器传入自由定义。后续 Context/Run/report 使用该精确 source，不因 current pointer 变化偷换输入；对应新 producer/validator 接受集留待注册实现。旧操作/旧 Source shape 不获得新字段。PROJECT_START 的三引用形状不增加规则字段，规则历史从同一原 request→informationDecision→source/report 的不可变 provenance 链追溯。

`project.get_startup_review@1.0` 在既有拟 result 中返回以下细化（仍未注册）：`binding` 保留全部 D14 字段并增加 `companyRulePublicationRef`；`companyRequirements` 返回当前许可的范围/目标、四类保护依据要求、各必需 code→requirementRef→候选/证据的精确映射；`startupEligibility:{eligible,blockers}` 与每个 plannedFile 的 eligibility 分开；`currentUsability` 含规则/模板发布当前性及 sourceWatermarks。缺候选时用必需 requirement/code 的 blocker 表示，不能因无 candidateId 从必需集合消失。`requiredCandidateIds` 为已映射的必要候选，`confirmationCandidateIds` 包含全部本次需确认的有依据候选；12项适用性、2项 Human 管理选择、3项 Human 专业决定不得省略。

Runner sourceId+requirementLocator 只能通过 bundle 的 sourceBindings 唯一映射到该 requirementRef；Host 验证别名、客户依据和词表，不作第二次业务推断。已有 Enterprise 精确版本复用也须匹配当前 bundle 必需语义、项目范围与真实 Human 核对，不能只检查 QMS 三数组非空。普通 startup confirm 不授予保护例外。

### 当前性、错误与转换

公司发布 profile 尚不可解析、未发布/撤回、错 code/hash/ref/locator 时 fail closed：结构/来源违反报告绑定使用 `PROJECT_PREPARATION_REPORT_INVALID`；可审阅但必要值/证据/支持缺口使用 `PROJECT_STARTUP_INFORMATION_INCOMPLETE` 并返回对应 owner 的安全 reason；已绑定 source/report 的规则或模板失效使用 `PROJECT_PREPARATION_INPUT_STALE`；IP 读取/授权不可用沿用 `DEPENDENCY_UNAVAILABLE`/安全授权外观，不输出其他 Scope 或客户正文。

同一准备意图锁定 `ruleBundleRef + startupRulesRef + vocabularyRef + companyRulePublicationRef + template/requirement set`。部署允许集/真实 supersession 生效、模板变更或必需信息变化推进 preparationVersion；原 request 不改，重新 capture/analysis/显式 Human 新意图。新发布无真实取代/撤回不会自动使旧版 stale。start 事务继续重验当前权限、所有真实三 start refs 与唯一 PROJECT_START，保持 PREPARING→ACTIVE 原子性。

已 start 后任何公司更新只形成 impact，旧绑定/Hash/current 企业版本不自动改。INITIAL_SCOPE_RECOVERY 的必要启动依据失效则范围待 impact；纯 file-only 保护冲突阻整份受影响文件，独立文件须 lawful start 和自己的全部条件后才可接收。后续生成/修改仍属另行批准的执行合同。owner traces 见 [EP-257 场景](../module-tests/Module-Test-002-EnterpriseProject.md#257-公司启动规则与词表设计场景)。


### #267 公司前置定义实现边界

EP 新增内部公司 requirement import/publish/exact-read 与 CompanyStartupDefinitionValidationPort，复用已有 Template/Regulatory import/publish 和精确 Platform refs，不创建 Evidence、客户 Fact/Product/QMS 或启动记录。requirement canonical payload 使用上述封闭六字段，来源绑定按模板 code/locator 排序，requirementCode+definitionVersion 唯一；发布追加不可变事实，原定义不 UPDATE。每次保护读取/提交/返回通过 IP owning 当前授权 Port，模板与规范引用只从 EP 自身 Repository 读取。

三份 policyDocument 的 NonEmptySet 使用按 code 稳定排序的数组；rules 中完整必需代码和 Product 字段、四个 protection 域不得弱化；allowedStartupOutcomes 按三个专业 decision code 映射允许继续检查启动的 outcome 集合，supportSet 固定 TEXT/Product/QMS。vocabulary sourceBindings 复用 templateRef/locator/sourceBytesSha256 结构；ownerMapping 封闭为 owner/field/value，逐条匹配正式 EP 类型/字段和已确认业务释义，不通过中文近似名推断。未知字段、额外代码、重复/漂移映射均拒绝。

源字节通过受信内容读取 Port 取得，分别核对实际 SHA-256、TemplateVersion 的精确内容 hash、公司 source pin/页内版本与 locator；定位符必须唯一且存在。生产 pin 使用公司 Delta S1–S9；受控测试可在显式 CONTROLLED_TEST 配置中使用有 test provenance 的独立源字节和对应 pins，保持全部已确认业务代码/范围/强制集合，不把测试材料标为生产公司来源。正式规范必须 PUBLISHED、含 verification/authority/jurisdiction/effectivePeriod，过期或未取得拒绝；未来升级目标可保留其正式施行日期，不冒充当前已生效要求。

已保存 snapshot 不等于发布。outer 校验通过受权 IP resolver 精确读回两 child，并逐项核对九模板、十二 requirement、标准/升级目标与词表来源/映射，返回绑定完整 payloadHash/profile/SchemaRef/child refs 的语义结果；IP Publisher 发布前再执行此校验。后续 D14 source/report/start/STALE/impact 转换仍 NOT IMPLEMENTED。

## D12 / Q11 项目交付关联只读提案（#260）

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。批次由 [REL §14](Module-Spec-006-ReleasePublication.md#14-d12--q11-项目交付批次与受控导出提案260) 拥有，EP只提供计划/交付项及依赖来源，不新建Batch/Release/Completion能力。

拟内部 ProjectDeliveryAssociationPort：独立当前授权的HUMAN或显式登记Release Reader SERVICE；服务调用还须限制在发起HUMAN的当前可读范围内。Ref必须exact同Project。两个分支为closed tagged union，不再以省略必填集合区分模式：

```text
ProjectDeliveryAssociationRequest =
  {mode: ENUMERATE, projectRef: ObjectRef<Project>,
   deliveryPlanRef: VersionedRef<DeliveryPlan>, page: PageRequest}
  | {mode: VERIFY, projectRef: ObjectRef<Project>,
     deliveryPlanRef: VersionedRef<DeliveryPlan>,
     deliveryItemRefs: Set<VersionedRef<DeliveryItem>>}

ProjectDeliveryAssociationItem
  deliveryItemRef: VersionedRef<DeliveryItem>
  criteriaHash: PayloadHash; qualityProfileRef: VersionedRef<QualityProfile>
  targetArtifactTypes: NonEmptySet<NamespaceCode>; dependencyItemIds: Set<UuidV7>
  chapterBindings: NonEmptySet<{chapterCode: NamespaceCode, ordinal: NonNegativeInt}>

ProjectDeliveryAssociationContext
  projectRef: ObjectRef<Project>; deliveryPlanRef: VersionedRef<DeliveryPlan>
  planUsable: boolean; chapterMappingRef: VersionedRef<Policy>
  planQualityPolicyRef: VersionedRef<Policy>
  checkedAt: UtcInstant; sourceWatermarks: SourceWatermark[]

ProjectDeliveryAssociationResult =
  {mode: ENUMERATE, context: ProjectDeliveryAssociationContext,
   page: Page<ProjectDeliveryAssociationItem>, pageAssociationHash: PayloadHash}
  | {mode: VERIFY, context: ProjectDeliveryAssociationContext,
     items: ProjectDeliveryAssociationItem[], associationSetHash: PayloadHash}
```

ENUMERATE必填共享PageRequest（pageSize及可选cursor），禁止deliveryItemRefs；VERIFY必填deliveryItemRefs，禁止page/cursor，不分页、不扩大集合。VERIFY成功的items与输入完整Ref集合一一对应，错Scope/版本/Hash或不可读项安全拒绝整个验证，不返回可误认为完整的部分集合。合法空VERIFY集合返回items=[]及该空集合的Hash，仍重验Project/Plan/Policy；它不枚举任何Item。输入Artifact关联来自REL受权读取的ART.definition.deliveryItemRefs，EP不提供artifactRef、不读取ART Repository、不因caller声称“文件属于计划”认定成功。

只从EP已提交当前ACTIVE、经Human批准的exact Plan与owning Item/Requirement/Dependency、Project/QMS与计划QualityPolicy版本读回。chapterMappingRef必须是被批准的同Plan适用有限章节映射（QualityPolicy关联的完整版本，不是Runner报告或标准号字符串），缺失时安全返回不可用，不制造required Ref。枚举的page显式包含items、可选nextCursor、snapshotAt、sourceWatermarks；水位与context一致，snapshotAt在同次枚举固定，checkedAt为当次当前权限/计划重验时间。本首版无额外枚举filters字段，固定筛选为Project/精确Plan及当前可读范围；游标按共享§6.2绑定mode/Port版本、Scope、requester/purpose、规范化Project/Plan筛选、稳定完整ItemRef排序位置、源水位和有效期。Scope/Plan/筛选/主体或purpose不符、过期、当前授权范围/Plan当前性或相关EP源水位变化均拒绝续页；不能漂移到新权威版本或拼接两个读切面。没有真实水位或无法恢复固定读切面时不能伪造sequence/完整性。items=[]但有nextCursor是合法中间页，须推进已扫描位置并继续；无nextCursor仅说明当前授权枚举结束，不返回隐藏项名称/数量。

pageAssociationHash仅覆盖本页；associationSetHash仅由VERIFY证明所请求的完整exact集合。两Hash各覆盖mode、context中的项目/计划/两Policy完整Ref、planUsable与规范排序的items（枚举取page.items），排除自身Hash、checkedAt、snapshotAt、水位和cursor。REL不能拿一页Hash、最后页Hash或分页Hash拼接冒充完整集合Proof；它从枚举读回所需Item/依赖的真实Ref后，对ART实际关联和配套闭包的完整所需集合执行VERIFY。超共享Guard预算拒绝，不截断或按部分验证宣称闭包成立。每文件associationProofHash使用其exact关联集合的VERIFY.associationSetHash与ART实际关联/Revision provenance；这些Hash是只读观测，不伪造已提交Snapshot。

依赖取真实dependencyItemIds和targetArtifact requirements；交付配套/optional/execution-only分类由版本化Plan/Quality release规则给出，不能把所有共用事项机械阻断或将全部依赖视为可省略。共享文件须逐个满足所关联项Artifact类型/质量pin；无合法关联、错计划版本/Item Hash、unknown分类、章节缺失/Plan被替代时阻断。计划改变产生新Version与影响事实，不重写已确认Batch；本首版要求当前ACTIVE版本，新候选本身不改计划。初轮workScope Receipt或Runner拟交付清单不等于ACTIVE DeliveryPlan，无合法计划保持不可用，不要求先实现另一新设计Issue。

批次确认/生成/下载不调用evaluate_delivery_item_completion，不新增“已交付”或“已发送”字段，也不消耗下载观察作为现有ReleaseCompleted事实。首版允许独立未就绪项继续执行，配套闭包之外的项目项不进入本批分母。
