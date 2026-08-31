# Module-Spec-005-QualityGovernance

版本：v1.0
日期：2026-08-31
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / FIELD-LEVEL SCHEMA IMPLEMENTED / IM-05 WI-01–WI-04 IMPLEMENTATION AND GITHUB DELIVERY COMPLETE / ISSUE #121–#124 CLOSED / IM-05 WI-08 SYNTHETIC QMS EXIT REVIEW SUBMITTED PR #139 / EXACT-HEAD CI PASS 2026-08-31 / ISSUE #128 PENDING MERGE / QMS COMPONENT TECHNICAL EVIDENCE PASS / UNIFIED CROSS-MODULE E2E NOT RUN`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

QualityGovernance 是 Evidence/Link、QualityProfile、ChangeImpact、GateResult、ReviewIssue、Approval、RevisionAcceptanceSnapshot、ApprovalBundleSnapshot 和 ReleaseReadinessSnapshot 的唯一写入 Owner。它回答“精确内容为什么可接受、由谁批准、冻结 Package 是否达到授权前条件”，但不拥有 Revision 内容、外部发布、Delivery Completion、Agent 或 Renderer 实现。

同步依赖 IdentityPolicy、EnterpriseProject 的 Evidence/Scope Validation 和 Artifact 的 immutable Revision/Representation Query；ReleasePrepared 与上游失效通过 Event 进入质量 Process。测试规格：[`Module-Test-005-QualityGovernance.md`](../module-tests/Module-Test-005-QualityGovernance.md)。

## 2. 模块类型

```text
EvidenceStatus = Closed<CANDIDATE | VERIFYING | VERIFIED | DISPUTED | EXPIRED | SUPERSEDED | REVOKED>
GateOutcome = Closed<PASS | FAIL | ERROR | SKIPPED | NOT_APPLICABLE>
EvaluationStage = Closed<REVISION_ACCEPTANCE | RELEASE_READINESS>
GateExecutionMode = Closed<EXECUTED | REUSED_BY_IMPACT_ANALYSIS>
IssueStatus = Closed<OPEN | ACKNOWLEDGED | RESOLUTION_PROPOSED | VERIFICATION_PENDING | VERIFIED | CLOSED | DISMISSED | DUPLICATE | SUPERSEDED>
ApprovalDecision = Closed<APPROVED | CHANGES_REQUESTED | REJECTED>

EvidenceCandidate
├── sourceType: NamespaceCode
├── sourceObjectRef: TypedReference
├── sourceSnapshotRef: SnapshotRef<EvidenceSource>
├── sourceVersion: NonEmptyString
├── locator: NonEmptyString
├── capturedContentRef: ObjectLocator
├── capturedContentHash: ContentHash
├── authority: NamespaceCode
├── jurisdiction?: NamespaceCode
├── validPeriod?: EffectivePeriod
├── accessClassification: NamespaceCode
└── capturedAt: UtcInstant

EvidenceVerification
├── method: NamespaceCode
├── verifier: PrincipalRef
├── verificationPolicyRef: VersionedRef<Policy>
├── outcome: Closed<VERIFIED | DISPUTED>
├── evidenceRefs: EvidenceRef[]
├── reasons: ReasonCode[]
└── verifiedAt: UtcInstant

EvidenceLinkDefinition
├── evidenceRef: ContentAddressedRef<Evidence>
├── targetRef: ContentAddressedRef<ClaimTarget>
├── claimLocator: NonEmptyString
├── claimHash: ContentHash
├── relation: Closed<SUPPORTS | CONTRADICTS | CONTEXT_ONLY>
├── applicabilityScope: CanonicalJson
└── linkedAt: UtcInstant

QualityProfileDefinition
├── name: NonEmptyString
├── profileVersion: NonEmptyString
├── applicableArtifactTypes: NonEmptySet<NamespaceCode>
├── riskApplicability: CanonicalJson
├── gateSpecs: NonEmptySet<CanonicalJson>
├── gateDependencies: Set<CanonicalJson>
├── rerunPolicy: CanonicalJson
├── issuePolicy: CanonicalJson
├── separationOfDutiesPolicy: CanonicalJson
├── approvalRequirements: NonEmptySet<CanonicalJson>
└── releaseRequirements: CanonicalJson[]

GateTarget =
  { kind: REVISION; revisionRef: ContentAddressedRef<ArtifactRevision> }
| { kind: REPRESENTATION; revisionRef: ContentAddressedRef<ArtifactRevision>; representationRef: RepresentationRef }
| { kind: RELEASE_PACKAGE; revisionRef: ContentAddressedRef<ArtifactRevision>; releasePackageRef: ReleasePackageRef }

GateResultSubmission
├── artifactRef: ObjectRef<Artifact>
├── gateTarget: GateTarget
├── evaluationStage: EvaluationStage
├── qualityProfileRef: VersionedRef<QualityProfile>
├── gateSpecId: UuidV7
├── gateVersion: NonEmptyString
├── evaluationAttempt: PositiveInt
├── evaluatedScope: CanonicalJson
├── inputSnapshotRef: SnapshotRef<GateInput>
├── evaluator: CanonicalJson
├── outcome: GateOutcome
├── findings: CanonicalJson[]
├── evidenceRefs: EvidenceRef[]
├── startedAt: UtcInstant
└── completedAt: UtcInstant

GateReuseSubmission
├── newTarget: GateTarget
├── sourceGateResultRef: ContentAddressedRef<GateResult>
├── changeImpactRef: ContentAddressedRef<ChangeImpact>
├── qualityProfileRef: VersionedRef<QualityProfile>
├── gateSpecId: UuidV7
├── derivedOutcome: GateOutcome
└── evaluatedAt: UtcInstant

ReviewIssueDefinition
├── artifactRef: ObjectRef<Artifact>
├── originRevisionRef: ContentAddressedRef<ArtifactRevision>
├── originGateResultRef?: ContentAddressedRef<GateResult>
├── issueType: NamespaceCode
├── severity: Closed<CRITICAL | MAJOR | MINOR | INFO>
├── blockingClassification: NamespaceCode
├── statement: NonEmptyString
├── locator: NonEmptyString
├── evidenceRefs: EvidenceRef[]
└── raisedAt: UtcInstant

IssueResolution
├── targetRevisionRef: ContentAddressedRef<ArtifactRevision>
├── changedClaimRefs: ContentAddressedRef<Claim>[]
├── explanation: NonEmptyString
└── proposedAt: UtcInstant

IssueVerification
├── targetRevisionRef: ContentAddressedRef<ArtifactRevision>
├── verifier: PrincipalRef
├── verificationMethod: NamespaceCode
├── supportingGateResultRefs: ContentAddressedRef<GateResult>[]
├── outcome: Closed<VERIFIED | REJECTED>
└── verifiedAt: UtcInstant

ApprovalRequestDefinition
├── artifactRef: ObjectRef<Artifact>
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── revisionAcceptanceSnapshotRef: SnapshotRef<RevisionAcceptance>
├── qualityProfileRef: VersionedRef<QualityProfile>
├── approvalRequirementId: UuidV7
├── requestedApproverRole: NamespaceCode
├── expiresAt?: UtcInstant
└── requestNonceHash: ContentHash

ApprovalSubmission
├── requestRef: ObjectRef<ApprovalRequest>
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── revisionAcceptanceSnapshotRef: SnapshotRef<RevisionAcceptance>
├── approvalRequirementId: UuidV7
├── decision: ApprovalDecision
├── decisionComment: SafeSummary
├── approverHumanPrincipalRef: PrincipalRef
├── approverRoleSnapshotRef: SnapshotRef<RoleAssignment>
├── authorizationDecisionRef: ContentAddressedRef<AuthorizationDecision>
├── separationCheckRef: ContentAddressedRef<SeparationCheck>
└── decidedAt: UtcInstant
```

三类 Readiness Snapshot 的完整字段以 `03-core-contracts.md` 为唯一权威。

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `quality.capture_evidence_candidate@1.0` | `Evidence / CREATE` | `candidate: EvidenceCandidate` | `quality.evidence.capture`；Agent 可创建 Candidate；来源快照/locator/hash 不可变 |
| `quality.verify_evidence@1.0` | `Evidence / MUTATE` | `verification: EvidenceVerification` | `quality.evidence.verify`；专业判断按 Policy 为 `HUMAN_ONLY`，确定性来源可由受信 Service 执行 |
| `quality.revoke_evidence@1.0` | `Evidence / MUTATE` | `revocationReason: Justification; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; revokedAt: UtcInstant` | `quality.evidence.revoke`；治理 Human/Service；触发 Gate/Approval/Release Impact |
| `quality.create_evidence_link@1.0` | `EvidenceLink / CREATE` | `definition: EvidenceLinkDefinition` | `quality.evidence_link.create`；精确 claimHash；CONTEXT_ONLY 不满足支持性 Gate |
| `quality.create_quality_profile_draft@1.0` | `QualityProfile / CREATE` | `definition: QualityProfileDefinition` | `quality.profile.create_draft`；Draft 可编辑，依赖与 Requirements 字段完整 |
| `quality.activate_quality_profile@1.0` | `QualityProfile / MUTATE` | `profileVersionRef: VersionedRef<QualityProfile>; reviewSnapshotRef: SnapshotRef<QualityProfileReview>; validationSnapshotRef: SnapshotRef<QualityProfileValidation>; activatedAt: UtcInstant` | `quality.profile.activate`；`HUMAN_ONLY`；Gate DAG 无环，高风险有 Human Approval Requirement |
| `quality.record_gate_result@1.0` | `GateResult / CREATE` | `submission: GateResultSubmission` | `quality.gate_result.record`；Evaluator/Validator Service；outcome/target/hash 创建后不可变 |
| `quality.record_reused_gate_result@1.0` | `GateResult / CREATE` | `reuse: GateReuseSubmission` | `quality.gate_result.reuse`；必须有精确 ChangeImpact、允许的 RerunPolicy 和仍有效源 Result |
| `quality.invalidate_gate_result@1.0` | `GateResult / MUTATE` | `invalidationReason: Justification; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; invalidatedAt: UtcInstant` | `quality.gate_result.invalidate`；不修改 outcome；触发 Readiness 重算 |
| `quality.raise_review_issue@1.0` | `ReviewIssue / CREATE` | `definition: ReviewIssueDefinition` | `quality.review_issue.raise`；Agent/Gate 可 Raise；原 statement/locator 不可改 |
| `quality.propose_issue_resolution@1.0` | `ReviewIssue / APPEND` | `resolution: IssueResolution; proposedBy: PrincipalRef` | `quality.review_issue.resolve.propose`；新 Revision 不自动解决 Issue |
| `quality.verify_issue_resolution@1.0` | `ReviewIssue / APPEND` | `verification: IssueVerification` | `quality.review_issue.verify`；职责分离必须满足；作者不得在 Policy 禁止时自验 |
| `quality.close_review_issue@1.0` | `ReviewIssue / MUTATE` | `verificationRef: ContentAddressedRef<IssueVerification>; closeReason: Justification; closedAt: UtcInstant` | `quality.review_issue.close`；`HUMAN_ONLY` 或受信 Governance Service；必须 VERIFIED |
| `quality.request_approval@1.0` | `ApprovalRequest / CREATE` | `definition: ApprovalRequestDefinition` | `quality.approval.request`；Mandatory Revision Gate/Blocking Issue 必须满足，Request 绑定精确 Snapshot |
| `quality.submit_approval_decision@1.0` | `Approval / CREATE` | `submission: ApprovalSubmission` | `quality.approval.decide`；永久 `HUMAN_ONLY`；AGENT/actingFor 永久拒绝；普通聊天不成立 |
| `quality.revoke_approval@1.0` | `Approval / MUTATE` | `revocationReason: Justification; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; revokedAt: UtcInstant` | `quality.approval.revoke`；`HUMAN_ONLY`；Decision Payload 保留，触发 Release Impact |
| `quality.evaluate_revision_readiness@1.0` | `RevisionAcceptanceSnapshot / CREATE` | `revisionRef: ContentAddressedRef<ArtifactRevision>; qualityProfileRef: VersionedRef<QualityProfile>; gateResultRefs: Set<ContentAddressedRef<GateResult>>; evidenceStatusSnapshotRef: SnapshotRef<EvidenceStatus>; issueSnapshotRef: SnapshotRef<ReviewIssueSet>; evaluatorVersions: CanonicalJson[]; evaluatedAt: UtcInstant` | `quality.revision_readiness.evaluate`；只计算 REVISION_ACCEPTANCE；输出 RAS，不写 Artifact 状态 |
| `quality.evaluate_release_gate_readiness@1.0` | `ReleaseReadinessSnapshot / CREATE` | `releasePackageRef: ReleasePackageRef; approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; recipientScopeSnapshotRef: SnapshotRef<RecipientScope>; destinationRefs: NonEmptySet<ExternalRef>; releaseGateResultRefs: Set<ContentAddressedRef<GateResult>>; evaluatedAt: UtcInstant` | `quality.release_readiness.evaluate`；绑定冻结 package/representation/checksum；READY 仍不等于授权 |

## 4. Query Payload 与 Result Contract

```text
EvidenceView
├── evidenceRef: ContentAddressedRef<Evidence>
├── status: EvidenceStatus
├── candidate: EvidenceCandidate
├── latestVerificationRef?: ContentAddressedRef<EvidenceVerification>
└── impactStatus: NamespaceCode

QualityProfileView
├── qualityProfileRef: VersionedRef<QualityProfile>
├── status: NamespaceCode
├── definition: QualityProfileDefinition
└── payloadHash: PayloadHash

GatePlan
├── target: GateTarget
├── qualityProfileRef: VersionedRef<QualityProfile>
├── applicableGateSpecs: CanonicalJson[]
├── dependencyOrder: UuidV7[]
├── reuseDecisions: CanonicalJson[]
└── planHash: PayloadHash

GateResultView
├── gateResultRef: ContentAddressedRef<GateResult>
├── target: GateTarget
├── evaluationStage: EvaluationStage
├── outcome: GateOutcome
├── validityStatus: NamespaceCode
├── evidenceRefs: EvidenceRef[]
└── reviewIssueRefs: ObjectRef<ReviewIssue>[]

BlockingIssueView
├── reviewIssueRef: ObjectRef<ReviewIssue>
├── originRevisionRef: ContentAddressedRef<ArtifactRevision>
├── severity: NamespaceCode
├── blockingClassification: NamespaceCode
├── status: IssueStatus
└── ownerRef?: PrincipalRef
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `quality.get_evidence@1.0` | A | `evidenceRef: ContentAddressedRef<Evidence>` | `EvidenceView` |
| `quality.get_quality_profile@1.0` | A | `qualityProfileRef: VersionedRef<QualityProfile>` | `QualityProfileView`；不得 current/latest |
| `quality.get_gate_plan@1.0` | A | `target: GateTarget; qualityProfileRef: VersionedRef<QualityProfile>; changeImpactRef?: ContentAddressedRef<ChangeImpact>` | `GatePlan` |
| `quality.get_gate_results@1.0` | S | `target: GateTarget; qualityProfileRef?: VersionedRef<QualityProfile>; gateSpecIds: Set<UuidV7>; outcomes: Set<GateOutcome>; validOnly: boolean; page: PageRequest` | `Page<GateResultView>` |
| `quality.get_open_blocking_issues@1.0` | A | `revisionRef: ContentAddressedRef<ArtifactRevision>; qualityProfileRef: VersionedRef<QualityProfile>` | `BlockingIssueView[]` |
| `quality.get_revision_acceptance_snapshot@1.0` | A | `snapshotRef: SnapshotRef<RevisionAcceptance>` | `RevisionAcceptanceSnapshot` |
| `quality.get_approval_bundle_snapshot@1.0` | A | `snapshotRef: SnapshotRef<ApprovalBundle>` | `ApprovalBundleSnapshot` |
| `quality.get_release_readiness_snapshot@1.0` | A | `snapshotRef: SnapshotRef<ReleaseReadiness>` | `ReleaseReadinessSnapshot`；Release Authorize 必须再验证最新有效性 |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `quality.EvidenceVerified@1.0` | `evidenceRef: ContentAddressedRef<Evidence>; verificationRef: ContentAddressedRef<EvidenceVerification>; authority: NamespaceCode; verifiedAt: UtcInstant` |
| `quality.EvidenceRevoked@1.0` | `evidenceRef: ContentAddressedRef<Evidence>; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; reasonCode: ReasonCode; revokedAt: UtcInstant` |
| `quality.QualityProfileActivated@1.0` | `qualityProfileRef: VersionedRef<QualityProfile>; applicableArtifactTypes: NonEmptySet<NamespaceCode>; activatedAt: UtcInstant` |
| `quality.GateResultRecorded@1.0` | `gateResultRef: ContentAddressedRef<GateResult>; target: GateTarget; evaluationStage: EvaluationStage; gateSpecId: UuidV7; outcome: GateOutcome; validityStatus: VALID` |
| `quality.BlockingReviewIssueRaised@1.0` | `reviewIssueRef: ObjectRef<ReviewIssue>; artifactRef: ObjectRef<Artifact>; originRevisionRef: ContentAddressedRef<ArtifactRevision>; blockingClassification: NamespaceCode; severity: NamespaceCode` |
| `quality.ReviewIssueClosed@1.0` | `reviewIssueRef: ObjectRef<ReviewIssue>; verifiedRevisionRef: ContentAddressedRef<ArtifactRevision>; verificationRef: ContentAddressedRef<IssueVerification>; closedAt: UtcInstant` |
| `quality.RevisionQualityReady@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; revisionAcceptanceSnapshotRef: SnapshotRef<RevisionAcceptance>; qualityProfileRef: VersionedRef<QualityProfile>` |
| `quality.RevisionFullyApproved@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; approvalRefs: NonEmptySet<ContentAddressedRef<Approval>>` |
| `quality.RevisionApprovalLost@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; priorApprovalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; triggeringRef: TypedReference; reasonCode: ReasonCode` |
| `quality.ReleaseGateReady@1.0` | `releaseRef: ObjectRef<Release>; releasePackageRef: ReleasePackageRef; releaseReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; readyAt: UtcInstant` |
| `quality.ReleaseGateReadinessLost@1.0` | `releaseRef: ObjectRef<Release>; releasePackageRef: ReleasePackageRef; priorReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; triggeringRef: TypedReference; reasonCode: ReasonCode` |

## 6. 模块错误码

```text
QUALITY_EVIDENCE_SOURCE_INCOMPLETE
QUALITY_EVIDENCE_SCOPE_INVALID
QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED
QUALITY_EVIDENCE_NOT_VERIFIED
QUALITY_EVIDENCE_LINK_TARGET_MISMATCH
QUALITY_PROFILE_IMMUTABLE
QUALITY_PROFILE_DEPENDENCY_CYCLE
QUALITY_PROFILE_REQUIREMENT_INCOMPLETE
QUALITY_GATE_INPUT_MISMATCH
QUALITY_GATE_STAGE_MISMATCH
QUALITY_GATE_RESULT_IMMUTABLE
QUALITY_GATE_RESULT_INVALID
QUALITY_GATE_REUSE_NOT_ALLOWED
QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT
QUALITY_ISSUE_VERIFICATION_REQUIRED
QUALITY_SEPARATION_OF_DUTIES_VIOLATION
QUALITY_AGENT_DISMISSAL_FORBIDDEN
QUALITY_APPROVAL_AGENT_FORBIDDEN
QUALITY_APPROVAL_REVISION_MISMATCH
QUALITY_APPROVAL_GATE_BUNDLE_INVALID
QUALITY_APPROVAL_BLOCKING_ISSUE_OPEN
QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE
QUALITY_REVISION_ACCEPTANCE_NOT_READY
QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH
QUALITY_RELEASE_READINESS_NOT_READY
```

## 7. 不变量与持久化边界

1. Evidence 内容/来源快照不可变；状态变化不删除历史，撤销触发影响评估。
2. ACTIVE QualityProfile 不可编辑；Gate DAG、阶段、复用、Issue、职责分离、Approval/Release Requirement 精确版本化。
3. GateResult 的 target/outcome/input/evaluator/hash 不可改；重跑或复用产生新 Result。
4. REVISION_ACCEPTANCE 与 RELEASE_READINESS Gate 不混用；Render Gate 绑定 Representation checksum/rendererVersion/packageHash。
5. 新 Revision 不自动解决 ReviewIssue；修复提议与独立验证分别追加。
6. Agent 和 actingFor Agent 永远不能作 Human Approval，也不能 Dismiss Blocking Issue。
7. Human Approval 不能覆盖 Mandatory Gate FAIL/ERROR；Approval、Release Authorization 和 EffectiveBinding 分层。
8. RAS/ABS/RRS 均不可变；READY Snapshot 不自动写 Artifact/Release 状态，上游失效产生新 STALE/NOT_READY Snapshot。

## 8.1 IM-05 WI-03 GateResult、ChangeImpact 与 Readiness Snapshot 实现约束

1. **GateResult identity 与 stage**：每个 Result 必须绑定 exact Artifact/Revision target、QualityProfile version、GateSpec/version、evaluation stage、input snapshot、evaluated scope、evaluator、outcome、findings 和 Evidence refs，并保存 canonical payload/hash。`REVISION_ACCEPTANCE` 只能写 Revision target；`RELEASE_READINESS` 只能写 Representation 或 frozen ReleasePackage target。Result 的 immutable facts 不允许更新或删除，重跑必须使用新 Result id/attempt。
2. **ChangeImpact 与复用**：ChangeImpact 必须绑定 exact base/candidate Revision content hashes、分析策略/版本和 changed/affected facts；coverage 必须是闭合、可审计的 unchanged coverage。复用只能引用同 Profile version、GateSpec/version、stage、有效 source Result 和 exact ChangeImpact，且 source outcome 允许由 rerun policy 复用、source 未失效、coverage 足够；成功复用追加新 GateResult 和 reuse fact，不能冒充一次新的 evaluator execution。
3. **失效与影响处理**：GateInvalidation 是 append-only fact，保留 Result 原始 outcome/hash，并通过 impact status/trigger reference 使依赖 Result 和 Readiness 进入 stale/re-evaluation 路径。Evidence、GateResult、Approval、Representation、Package 或 destination 的变化不得改写旧 RAS/RRS；必须追加带 exact upstream refs 的 `STALE`/`NOT_READY` Snapshot。
4. **RAS 评估**：RevisionAcceptanceSnapshot 必须完整符合 Core `revision-acceptance/1.0` Contract，只读取 REVISION_ACCEPTANCE Gate。所有适用 mandatory Gate 必须存在 exact valid PASS；FAIL/ERROR、无效或缺失 Result、阻断 Evidence 状态、open blocking issue、profile/revision/hash/scope mismatch 或职责分离失败都使结果 `NOT_READY`。RAS 不要求 Render Gate，不写 Artifact 状态。
5. **RRS 评估**：ReleaseReadinessSnapshot 必须完整符合 Core `release-readiness/1.0` Contract，绑定 exact ReleasePackageRef、package snapshot/hash、Representation checksum/renderer、ApprovalBundle snapshot、recipient scope、destination 和 RELEASE_READINESS Gate。Package/Representation/renderer/recipient/destination 任一不一致、Approval Bundle 非 FULLY_APPROVED 或 stale、缺 mandatory release Gate、FAIL/ERROR/invalid/stale Result、未满足 release requirement 或 Recall Blocker 存在时返回 `NOT_READY`/`STALE`；READY 只代表 authorization 前置条件，不代表授权或发布。
6. **Storage and access**：WI-03 仅在 `quality_governance` Schema 新增 GateResult、ChangeImpact、reuse、invalidation、RAS、RRS 及对应影响/状态事实表；每行保留 Enterprise/Project scope mirror、actor/authorization/source command attribution 和 hash。六张业务表及 owner 写入口统一沿用既有 QualityGovernance 物理列 `created_authorization_decision_id`，不得引入 `created_by_authorization_decision_id` 变体；空库迁移后的首次真实业务写入必须验证表列、函数参数、Repository 和类型保持一致。业务写入只能经 owner `SECURITY DEFINER` function，app role 只读 RLS；append-only history 的 owner UPDATE/DELETE 也必须拒绝，直接 app write、跨 scope read/write、错误 exact hash 和错误 stage fail-closed。业务行与 Receipt、Audit、Outbox、Reference Edge 必须在同一事务中提交或回滚。独立测试场景必须使用唯一 Profile identity/name，不得依赖数据库清理顺序或放宽同 Enterprise name 唯一约束。
7. **Public query**：GatePlan/Results/RAS/RRS 查询只接受 exact target/profile/snapshot refs；禁止 `latest`、`current`、name-only、path fallback、caller hash fallback 和跨 Scope enumeration。不存在或不匹配统一使用稳定业务错误。RAS/RRS 产出还必须经过 `ContractRegistry` 字段级验证，Contract 失败需保留可定位的 AJV path，不能只断言 readiness status；evaluator 和其他 namespace code 必须遵守 Core 的小写点号/下划线命名规则。

## 8.2 IM-05 WI-04 ReviewIssue remediation 与 Human Approval 实现约束

1. **ReviewIssue 原始事实**：Issue root 必须绑定 exact `artifactRef`、`originRevisionRef`、可选 `originGateResultRef`、issue type/severity/blocking classification、statement、locator、Evidence refs、raised actor 和时间。原始 identity、statement、locator、severity、blocking classification、origin refs 与 raised provenance 创建后不可更新或删除；纠正只能通过新的 superseding/dismissal fact。
2. **整改与验证分离**：Resolution Proposal 必须追加 exact target Revision、changed Claim refs、explanation、proposer 和时间；新 Revision 不自动改变 Issue 状态。Verification 必须绑定 exact target Revision、verifier、method、supporting Gate refs、outcome 和时间；当 Profile 的职责分离禁止自验时，proposal author 与 verifier 不得相同。失败 Verification 保留历史并回到待整改状态，Close 必须引用 exact VERIFIED verification。
3. **Approval request/decision exactness**：Approval Request 必须绑定同 Enterprise 的 exact Revision content hash、RAS snapshot、QualityProfile version、Approval Requirement、requested role、expiry 和 nonce hash。Decision 必须逐项绑定 request、Revision/RAS、Requirement、Human principal、role snapshot、AuthorizationDecision、SeparationCheck、decision/comment/time 和 canonical payload/hash；任何 latest/current、hash/RAS/role/scope 不一致都 fail-closed。
4. **Human-only 与职责分离**：`principalKind=AGENT`、Service、Runtime 或 Agent `actingFor` Human 永久不得提交 Human Approval；payload 中声明的 principal/role 不能覆盖 trusted Context。未满足 mandatory REVISION_ACCEPTANCE Gate、存在 Open Blocking Issue、RAS 非 exact/有效、Requirement 不匹配或 SeparationCheck 失败时，APPROVED 决定不得生效。
5. **撤销与 ABS**：Approval Revocation 为 immutable fact，保留原 Decision/Request/ABS；旧 ABS 不重写。Approval 被撤销、上游 Evidence/Gate/Issue/RAS 失效时仅追加 Impact/状态事实并阻止旧 Bundle 继续满足 Approval；新 Revision/Profile 不继承旧 Approval。ABS 必须完整符合 Core `approval-bundle/1.0`，并经 `ContractRegistry` 字段级校验。
6. **Storage and access**：WI-04 只在 `quality_governance` Schema 新增 ReviewIssue root/observation/resolution/verification/state-transition、Approval root/request/decision/revocation 和 ApprovalBundleSnapshot 事实表及 owner 写函数；全部业务表沿用 `created_authorization_decision_id`，保留 scope mirror、canonical hash、actor/authorization/source-command attribution。app role 只读 RLS，owner 直接 UPDATE/DELETE 的 immutable facts 也拒绝；业务行与 Receipt、Audit、Outbox、Reference Edge 必须原子提交或回滚。
7. **Public query/negative boundaries**：Approval Bundle Query 只接受 exact SnapshotRef；Issue/Approval 的错误 objectId/hash/scope、latest/current、Agent/actingFor Agent、作者自验、未 VERIFIED close、过期/撤销 Request 或 RAS mismatch 均统一 fail-closed，不泄漏隐藏 Scope。Provider、Workspace UI、Feishu、真实组织审批、Release Authorization/Publication、生产和独立人工验收保持 `NOT RUN`。
8. **Common scalar 与并发边界**：所有 namespace 字段必须遵守 Common 的小写点号/下划线格式，`Justification.reasonCode` 必须遵守 upper-snake ReasonCode 格式；同一 Approval Request 的同一 Human 不得重复占用 `requiredCount`，重复身份与 stale aggregate version 必须返回不同稳定错误码；并发 append 必须以 aggregate version CAS 只提交一个 winner，loser 返回当前版本且不产生部分业务事实。

## 8.3 IM-05 WI-04 验证状态与边界

- `modules/quality-governance/src/business/quality-review-approval-validation.test.ts` 为 1 file/7 tests `PASS`，覆盖 exact Typed Reference、Scope、hash、Common namespace/ReasonCode、Human-only Approval、错误 Request/Separation ref 和 revocation 输入；Persistence 测试覆盖实际 Handler 的 ReviewIssue→Resolution→Verification→Close、Approval→ABS→Revocation、AGENT/Service/Runtime trusted-context 拒绝（payload 声明 Human 也不能升级权限）、CAS、重复 Human、RLS/ACL、immutable guard、事件和 rollback。
- 正式 `node tools/persistence/gate.mjs` 使用 PostgreSQL 18.6 digest `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` 与 Flyway 11.20.3 digest `sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`，完成 tag→digest 校验、`server_version=180006`、空库 35 migrations、32 files/305 tests、二次迁移 no-op 与容器清理，结果为 `PASS`。
- PR #133 的首轮 exact-head CI 在同一业务测试中因 Vitest 默认 `5000ms` 测试时限失败：WI-04 主场景运行 `5211ms`，此前静态检查、普通全量测试和 persistence 的其余 31 个文件均通过，rollback 场景也通过。该结果是 CI runner 时限边界，不是业务断言失败；为长 PostgreSQL 场景设置显式 `15000ms` 测试时限后，exact-head CI run `33313267439` 已通过。
- 校验边界包括：原始 ReviewIssue 与历史事实不可变；作者自验返回职责分离错误；新 Revision 不关闭旧 Issue；Approval 只能由 trusted Human 以 exact Revision/RAS/Profile/Requirement/role/AuthorizationDecision/SeparationCheck 生效；重复 Human 返回 `QUALITY_APPROVAL_IDENTITY_CONFLICT`；撤销追加 stale ABS/impact 并保留旧 Decision/ABS；并发仅一个 CAS winner；app 直接写入、跨 Enterprise 读取和 owner immutable UPDATE/DELETE 均 fail-closed。
- 本地和正式 Gate 仅证明合成技术场景；Provider、Workspace UI、Feishu、公开 HTTP、跨模块业务 E2E、生产数据库、真实组织审批和独立人工客户验收继续为 `NOT RUN`。实现 exact head `e409849443626f91e9bd0064ba3df0b0a7e38897` 已通过 PR #133 的 exact-head CI，并以 merge commit `698f9482bd95843df03e01e630545a34564d6bc0` 合入 `main`；Issue #124 已关闭，验收证据见 [Issue #124 comment](https://github.com/qzhike/zhiju-business-core/issues/124#issuecomment-5468884714)。

## 8. 可人工验收的模块产出

里程碑 `API-QG-01` 的人工产出是 REV-002/REV-003 Fixture：REV-002 Gate FAIL 并产生 Blocking Issue；新 Revision 不自动关闭 Issue；独立验证后 REV-003 形成 RAS，再由真实 Human 决定形成 ABS；同名替换的 PDF 令旧 RRS 失效。该审核不代表 Gate、Renderer、身份或人工审批已经运行。

## 9. 当前状态

- 37 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核；
- 字段级 Payload / Result Schema 已于 2026-08-18 实现并注册到 `contracts/src/operations/quality-governance.schema.ts`；18 Command、8 Query 与 11 Event 全部由 `ENVELOPE_ONLY` 升级为 `FULL`；8 Query Result Schema 均载入 Registry；
- Schema Contract 用例（`quality-governance.schema.test.ts`）已 PASSED：覆盖 Human Approval、Agent 冒充、Target hash、Evaluation Stage、敏感字段泄漏、Gate vs Approval 形态差异等正反例；
- PR #13 Code Review 修复已于 2026-08-18 完成：REPRESENTATION GateTarget 改用 Common `representationRef`；三个 Snapshot Query Result 改为 `$ref` Core Contract ID（不再维护截断视图）；`evidenceVerification.verifier` / `issueVerification.verifier` / `blockingIssueView.ownerRef` / `propose_issue_resolution.proposedBy` 改用 Common `principalRef`；`revoke_evidence` / `invalidate_gate_result` / `revoke_approval` 三个 Command 去除未授权 `revocation`/`invalidation` 包装，恢复 Module Spec 第 3 节直接字段；`QualityProfileDefinition.releaseRequirements` 由 optional 改为 required；`get_gate_results` 复用 Common `pageRequest` / `opaqueCursor`；
- PR #13 第二轮 Code Review 修复已于 2026-08-18 完成：`GateResultSubmission` 删除未授权 `executionMode` 字段；`record_reused_gate_result` 路径独立为 `GateReuseSubmission`，`sourceGateResultRef` / `changeImpactRef` 强制 required；数组类型按 Module Spec `Set<T>` / `NonEmptySet<T>` / `T[]` 精确分类 — 仅 NonEmptySet 保留 `minItems: 1`，Set 仅保留 `uniqueItems`，普通 `T[]` 不附加额外约束；空过滤集合与无内容变更 IssueResolution 接受正向回归。
- WI-03 的 GateResult、ChangeImpact、Readiness Evaluator、Repository、Handler 与 Persistence 实现已完成；WI-04 的 ReviewIssue、Approval、ApprovalBundleSnapshot、Repository、Handler 与 Persistence 实现也已完成，结果见第 8.3 节及 Module-Test-005；Renderer、ReleasePackage 与外部 Provider 仍由后续 Work Item 负责；WI-02 的 Evidence/Profile Repository、Handler、Persistence 和 validation Unit 已实现并在本地验证；
- WI-02、WI-03、WI-04 的 Unit/Contract/Persistence 结果见对应章节及 Module-Test-005；跨模块 E2E、Provider、公开 HTTP、生产和独立人工业务验收仍为 `NOT RUN` 或表格中的 `PARTIAL`。

## 10. IM-02 WI-04 持久化切片

QualityGovernance owning Schema 独立拥有八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。WI-04 技术基础的历史验证不等同于后续业务 Handler；WI-02 的 Canonical payload↔hash、Profile definition 校验、业务 Repository 与 Handler 结果见第 12 节。

## 11. IM-05 WI-01 Application/Persistence 基础

Issue #121 在既有 `V5000__quality_governance_technical_tables.sql` 与 owning roles 上实现模块自有的 Application/Persistence 事务边界，不修改已经应用的 Migration，也不创建质量业务表。首轮真实 PostgreSQL 负向探针发现两个 trigger guard function 对 app role 仍可解析执行并返回 `0A000`；forward-only `V5001` 必须撤销 PUBLIC、app、dispatcher 与 audit reader 的直接 EXECUTE，只保留 owner 管理边界，且不得影响 trigger 正常执行。

1. 同一连接和事务内先由 `platform_context_establisher` 建立可信 Actor、Authorization、Enterprise/Project Scope、Correlation 与可选 Source Event Context，再切换到 `quality_governance_app`；任何 Envelope attribution 或 Scope 不一致均须在 Claim Receipt 前拒绝。
2. `(idempotency_scope, idempotency_key)` 是数据库仲裁的唯一幂等键。same key/same canonical SHA-256 必须重放首个 `COMMITTED`/`REJECTED` 结果；different hash 返回稳定 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不得泄漏 `unique_violation`。
3. 技术 `process_instance.aggregate_version` 使用字符串/BigInt 精确 CAS。相同 expected version 的并发写只允许一个提交，失败方返回稳定 `CONCURRENCY_CONFLICT`，不得丢失更新。
4. Receipt、业务 callback、Inbox、Process/Step、Audit、Outbox 与 Reference Edge 在同一事务组合；任一后置故障必须回滚全部写入。Canonical JSONB、Payload Hash、Event/Edge owner、Scope mirror 与 actor attribution 在 Application 与 PostgreSQL 两层校验。
5. QualityGovernance 只依赖三个公开 Query Port：IdentityPolicy 的 Actor/Authorization 精确校验、EnterpriseProject 的 `project.validate_object_scope`、Artifact 的 `artifact.validate_revision_ref`。Port 返回必须精确匹配输入 Ref、Enterprise/Project Scope、版本/内容 Hash 和请求目的；不得使用 `latest/current`、跨 Enterprise 搜索、caller-provided fallback 或跨 Schema Repository。
6. 本切片只证明技术事务与受控 Query Port 组合；Evidence/Profile/Gate/Issue/Approval/Readiness 业务 Repository/Handler、Renderer、ReleasePublication、外部 Provider、公开 HTTP、生产与独立人工业务验收保持 `NOT RUN`。

当前状态：`IMPLEMENTATION COMPLETE / LOCAL VERIFICATION PASS`。Unit 2 files/5 tests、普通全量 34 passed/25 skipped files（395 passed/278 skipped tests）、Architecture、201/201 FULL Contract、冻结 200-operation compatibility baseline 均通过；disposable PostgreSQL 18.6/Flyway 11.20.3 为 29 files/293 tests，空库应用 32 条 Migration（含 V5001）、第二次 no-op 与容器清理通过。GitHub 交付状态以 Issue #121 及其 PR 为准。

## 12. IM-05 WI-02 Evidence、EvidenceLink 与 QualityProfile 实现约束

本节在实现前冻结 WI-02 的持久化和 Handler 解释，代码与测试必须保持逐项一致。

1. **Evidence identity 与事实历史**：Evidence root 的 `ContentAddressedRef.contentHash` 由 `EvidenceCandidate` canonical payload 计算；`capturedContentHash` 只描述 source snapshot 捕获内容。`sourceSnapshotRef`、`sourceVersion`、`locator`、`capturedContentRef`、`capturedContentHash`、authority 和 Scope 创建后不可更新。Verification 与 revocation 追加 immutable fact，并由 root 的 CAS version 推进当前 status；任何历史行不得被删除或覆盖。错误 exact hash 或 source substitution 必须 fail-closed，且不得通过 not-found 响应泄露其他 Scope 是否存在。
2. **Evidence command boundary**：capture 只能写入完整 Candidate 和可信 Context；verify 必须由符合验证策略的 Human 或 method 以 `deterministic.` 开头且与可信 Context 一致的 trusted service 执行，并精确保存 verifier、policy、evidence refs、reason 和 outcome；revoke 追加 `revocationReason`、`impactAssessmentRef` 和时间。已 revoked Evidence 不得再次 verify 或取得 supporting 资格。
3. **EvidenceLink exactness**：link 的 Evidence ref 必须逐项匹配 root identity、Scope 和 payload hash；target ref、target Scope、claim locator、claim hash、relation 和 applicability scope 是不可变关系。`SUPPORTS` 仅接受当前 `VERIFIED` 且未 revoked/disputed 的 Evidence；`CONTEXT_ONLY` 可以保留上下文关系，但永远不能满足 supporting Evidence；跨 Scope、hash substitution、缺失 target 或重复不可变关系 fail-closed。真实 persistence probe 必须同时证明 DISPUTED/REVOKED 的 SUPPORTS 被拒绝而 REVOKED 的 CONTEXT_ONLY 可保留。
4. **QualityProfile version shape**：draft validation 要求至少一个 GateSpec、至少一个 mandatory Gate、封闭的 gate/dependency ID 集合、无环依赖、完整 evaluation/input/evaluator/pass/failure/blocking/rerun/retention shape、完整 separation-of-duties policy 和结构化 approval/release requirements。高风险 profile 必须存在 Human approval requirement，Agent/actingFor Agent 不得作为 Human approver。
5. **Activation and immutability**：activation 只接受 Enterprise-scoped exact `profileVersionRef`、类型分别为 `quality.quality_profile_review` 与 `quality.quality_profile_validation` 且同 Enterprise 的 review/validation snapshot ref、Human Context 和 CAS expected version；Handler 必须在锁定的事务内重新读取并校验已持久化 definition 与 version 的 Enterprise/Project scope mirror，且 `releaseRequirements` 不得为空。active version 的 GateSpec、dependency、approval/release requirement、review/validation snapshot 不能原地编辑。已 ACTIVE profile 的策略变更必须创建新的 exact DRAFT version，再独立 review、validation 和 activation；旧 ACTIVE version 变为历史 `SUPERSEDED`，其 identity/hash 不变。任何 CAS 冲突都必须在锁等待后回读当前 aggregate version，再返回冲突结果。
6. **Storage and access**：`V5002` 新增 Evidence root/validation/revocation/link 与 QualityProfile root/version/gate/dependency/approval/release tables。所有业务行保留 Enterprise/Project scope mirror。业务写入只能经 `quality_governance_owner` SECURITY DEFINER mutation function，app role 只能通过 RLS 读取授权 Enterprise/Project scope；context/trigger guard helper 必须显式撤销 app `EXECUTE`，`RETURNS TABLE` owner function 的输出列与内部表列必须使用无歧义的限定引用，Evidence/Profile root 直接 DELETE 必须明确拒绝，append-only history 的 owner 直接 UPDATE/DELETE 也必须明确拒绝，直接 app write、跨 scope write/read 和 owner-only helper 调用必须拒绝。业务写入后若技术事务失败，business row 与技术 Receipt/Audit/Outbox/Reference Edge 必须整体回滚。实现提交前必须通过 TypeScript format/lint/typecheck。真实语义探针位于 `tests/persistence/quality-governance-business.test.ts`，由 persistence gate 注入 disposable PostgreSQL 连接；裸测试无连接时只记录 `NOT RUN`。
7. **Public query**：`quality.get_evidence@1.0` 只接受 exact content-addressed Evidence ref；`quality.get_quality_profile@1.0` 只接受 exact versioned profile ref。禁止 `latest`、`current`、name-only、path fallback、caller hash fallback 和跨 Scope enumeration；找不到或不匹配统一走稳定 fail-closed business error。
8. **Out of scope**：本 WI 不实现 GateResult evaluator、ReviewIssue、Human Approval decision、Readiness Snapshot、ReleasePackage、Renderer、Provider、公开 HTTP、生产或跨模块业务 E2E。上述项在 Module-Test-005 中继续标为 `NOT RUN`。

WI-02 实现、验证与交付结果（2026-08-30）：`IMPLEMENTATION COMPLETE / UNIT AND PERSISTENCE LOCALLY VERIFIED / GITHUB EXACT-HEAD DELIVERY COMPLETE PR #130 MERGED / ISSUE #122 CLOSED / LOCAL AND REMOTE FEATURE BRANCHES DELETED`。`modules/quality-governance/src/business/quality-business-validation.test.ts` 为 8/8 PASS；`tests/persistence/quality-governance-business.test.ts` 纳入 pinned PostgreSQL/Flyway gate，覆盖 Evidence capture/verify/dispute/revoke/history、exact hash/query、support/context、QualityProfile activation/new version、CAS、RLS/ACL、owner immutable guard、idempotency replay 和 post-write rollback。全 persistence gate 为 30 files/298 tests PASS，V5002 空库迁移和 second-run no-op 通过并清理容器。实现 commit `f0269ddfac1d16dd3f627818606e8546254f8ef1` 已由 PR #130 合入 `main`，merge commit 为 `7f04f8acea7b32a456316801aa0b5ed75c7230a7`。存储 definition 的 activation 重校验由 Handler 实现，因数据库 immutable guard 不允许篡改存储行，专门篡改后的运行时分支保持 `NOT RUN`；Provider、公开 HTTP、跨模块 E2E、生产和独立人工业务验收保持 `NOT RUN`。

WI-03 实现与本地验证结果（2026-08-30）：`modules/quality-governance/src/business/quality-gate-validation.test.ts` 为 1 file/6 tests `PASS`；`tests/persistence/quality-governance-gate-results.test.ts` 为 5/5 `PASS`。正式 `pnpm persistence:gate` 在 PostgreSQL 18.6/Flyway 11.20.3 上为 31 files/303 tests `PASS`，V5003 空库迁移、tag→digest 校验、RLS/ACL、owner append-only guard、exact reference、reused Result、RAS/RRS stale/not-ready、rollback、second migrate no-op 与容器清理均通过。全量静态/普通测试为 Format、Lint、Typecheck、Build、36 passed/27 skipped files（409 passed/288 skipped tests）、Architecture、201/201 Contract/Catalog/Compatibility `PASS`。唯一修复的运行时缺陷是 V5003 与既有 V5002 通用 trigger guard 的授权归因列命名不一致，已统一沿用 `created_authorization_decision_id`；独立场景 profile name 也已改为唯一 fixture。当前实现尚未 commit/push，需用户先检查工作树后再进入 Git 交付阶段。Provider、实际 Renderer、ReleasePublication、公开 HTTP、跨模块业务 E2E、生产和独立人工验收保持 `NOT RUN`。

## 13. IM-05 WI-08 合成 QMS 退出复核边界

WI-08 不新增 QualityGovernance 公共 Contract、业务表或 Migration；它冻结并复核既有 Evidence/Profile、GateResult/ChangeImpact/RAS/RRS、ReviewIssue/Resolution/Verification、Approval/ABS 的精确引用和历史语义。复核主流程必须显式使用一条合成 `REV-002 / FAIL` GateResult，随后追加 Blocking ReviewIssue、Resolution Proposal、作者自验拒绝、独立 Human Verification、`REV-003` exact Gate/RAS、Approval Request/Decision 和 ABS；新事实不得覆盖或删除 REV-002、旧 Issue、旧 Gate 或旧 Approval。

所有跨模块 Revision、Representation、ReleasePackage 和 Identity 事实只通过 QualityGovernance 的公开 Authority Query Port 或已验证的 Typed Reference 进入复核。报告中的 UUID、Hash 和 Snapshot 不代表生产数据；报告模式必须无 Secret，并在输出中区分 `PASS (LOCAL)`、`PASS (PERSISTENCE)`、`PARTIAL` 和 `NOT RUN`。统一 Quality→Renderer→Release 业务编排器、公开 HTTP、真实身份/审批系统、生产数据库、Provider 和独立人工客户验收仍为 `NOT RUN`。

2026-08-31 GitHub 交付状态：WI-08 报告与回归测试已随 [PR #139](https://github.com/qzhike/zhiju-business-core/pull/139) 提交；实现 head `290d28758d04d6be225d8587e8314ed2f46830de` 的 GitHub Actions `verify` run `33355081899` 第二次执行通过。PR 合并前 Issue #128 保持 OPEN，QualityGovernance 的统一跨模块编排和独立业务验收仍为 `NOT RUN`。
