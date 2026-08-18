# Module-Spec-005-QualityGovernance

版本：v0.3
日期：2026-08-18
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA IMPLEMENTED 2026-08-18 / PR #13 REVIEW REMEDIATION APPLIED 2026-08-18`

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

## 8. 可人工验收的模块产出

里程碑 `API-QG-01` 的人工产出是 REV-002/REV-003 Fixture：REV-002 Gate FAIL 并产生 Blocking Issue；新 Revision 不自动关闭 Issue；独立验证后 REV-003 形成 RAS，再由真实 Human 决定形成 ABS；同名替换的 PDF 令旧 RRS 失效。该审核不代表 Gate、Renderer、身份或人工审批已经运行。

## 9. 当前状态

- 37 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核；
- 字段级 Payload / Result Schema 已于 2026-08-18 实现并注册到 `contracts/src/operations/quality-governance.schema.ts`；18 Command、8 Query 与 11 Event 全部由 `ENVELOPE_ONLY` 升级为 `FULL`；8 Query Result Schema 均载入 Registry；
- Schema Contract 用例（`quality-governance.schema.test.ts`）已 PASSED：覆盖 Human Approval、Agent 冒充、Target hash、Evaluation Stage、敏感字段泄漏、Gate vs Approval 形态差异等正反例；
- PR #13 Code Review 修复已于 2026-08-18 完成：REPRESENTATION GateTarget 改用 Common `representationRef`；三个 Snapshot Query Result 改为 `$ref` Core Contract ID（不再维护截断视图）；`evidenceVerification.verifier` / `issueVerification.verifier` / `blockingIssueView.ownerRef` / `propose_issue_resolution.proposedBy` 改用 Common `principalRef`；`revoke_evidence` / `invalidate_gate_result` / `revoke_approval` 三个 Command 去除未授权 `revocation`/`invalidation` 包装，恢复 Module Spec 第 3 节直接字段；`QualityProfileDefinition.releaseRequirements` 由 optional 改为 required；`get_gate_results` 复用 Common `pageRequest` / `opaqueCursor`；
- Gate Evaluator、Profile Registry、Readiness Evaluator、Persistence 与测试实现均不存在；
- 字段级以上的 Unit、Contract、E2E 与人工验收仍为 `NOT RUN`，与 Handler/State/Evaluator/E2E 缺失对应。
