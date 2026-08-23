# Module-Spec-006-ReleasePublication

版本：v0.3
日期：2026-08-21
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA IMPLEMENTATION COMPLETE 2026-08-18 / RUNTIME RECEIPT VALIDATOR IMPLEMENTED 2026-08-21 (#15)`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

ReleasePublication 是 Release、ReleasePackage/Item/Destination、PublicationAttempt、Formal PublicationReceipt、Recall 和 Release Impact Process 的唯一写入 Owner。它拥有“把哪个已批准精确 Revision 的冻结 Package 正式发布到哪里”，不拥有 Revision 内容、Gate/Approval 决定、飞书 SDK 或 EffectiveBinding。

同步依赖 IdentityPolicy、Artifact 的 Revision/Representation Query 与 QualityGovernance 的 Approval/Readiness Query；所有外部副作用通过 IntegrationGateway Attempt。测试规格：[`Module-Test-006-ReleasePublication.md`](../module-tests/Module-Test-006-ReleasePublication.md)。

## 2. 模块类型

```text
ReleasePurpose = Closed<CUSTOMER_DELIVERY | REGULATORY_SUBMISSION | INTERNAL_EFFECTIVE_USE | FEISHU_PUBLICATION | CONTROLLED_EXPORT>
ReleaseStatus = Closed<DRAFT | PREPARED | VALIDATING | AUTHORIZED | PUBLISHING | RELEASED | PARTIALLY_RELEASED | FAILED | CANCELLED | RECALLED | SUPERSEDED>
PublicationOutcome = Closed<PENDING | SUCCEEDED | FAILED | UNKNOWN>

ReleaseDraftDefinition
├── artifactRef: ObjectRef<Artifact>
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── releaseNumber: NonEmptyString
├── purpose: ReleasePurpose
├── requestedEffectiveAt?: UtcInstant
├── qualityProfileRef: VersionedRef<QualityProfile>
├── revisionAcceptanceSnapshotRef: SnapshotRef<RevisionAcceptance>
├── approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>
└── supersedesReleaseRef?: ObjectRef<Release>

ReleaseRepresentationSelection
├── representationRef: RepresentationRef
├── ordinal: NonNegativeInt
├── displayName: Sensitive<NonEmptyString>
├── required: boolean
└── releaseRole: NamespaceCode

ReleaseDestinationDefinition
├── destinationId: UuidV7
├── destinationType: NamespaceCode
├── destinationRef: ExternalRef
├── recipientScopeRef: SnapshotRef<RecipientScope>
├── purpose: NamespaceCode
├── required: boolean
├── requiredReceiptKind: NamespaceCode
└── deliveryPolicyRef: VersionedRef<Policy>

ReleasePackageDefinition
├── releaseRef: ObjectRef<Release>
├── canonicalRevisionRef: ContentAddressedRef<ArtifactRevision>
├── representations: NonEmptySet<ReleaseRepresentationSelection>
├── destinations: NonEmptySet<ReleaseDestinationDefinition>
├── recipientScopeSnapshotRef: SnapshotRef<RecipientScope>
├── approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>
├── preparedAt: UtcInstant
└── packageHash: ContentHash

PublicationAttemptDefinition
├── destinationId: UuidV7
├── packageRef: ReleasePackageRef
├── attemptNumber: PositiveInt
├── stableIdempotencyKey: NonEmptyString
├── requestedAt: UtcInstant
└── externalDeliveryRequestRef: ContentAddressedRef<ExternalDeliveryRequest>

FormalReceiptSubmission
├── attemptRef: ObjectRef<PublicationAttempt>
├── destinationId: UuidV7
├── packageRef: ReleasePackageRef
├── rawReceiptRef: ContentAddressedRef<RawExternalReceipt>
├── providerResult: CanonicalJson
├── occurredAt: UtcInstant
└── receiptPayloadHash: PayloadHash

PublicationFailureSubmission
├── attemptRef: ObjectRef<PublicationAttempt>
├── destinationId: UuidV7
├── packageRef: ReleasePackageRef
├── classification: ReasonCode
├── retryable: boolean
├── outcome: Closed<FAILED | UNKNOWN>
├── providerRef?: ExternalRef
├── diagnosticRef?: ExternalRef
└── occurredAt: UtcInstant  *(required — fixed in v0.2; field-level schema required list)*
```

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `release.create_release_draft@1.0` | `Release / CREATE` | `definition: ReleaseDraftDefinition` | `release.release.create_draft`；Revision 必须精确且 Approval Bundle 属于同 Revision；Draft 不等于已准备 |
| `release.select_representations@1.0` | `Release / MUTATE` | `selections: NonEmptySet<ReleaseRepresentationSelection>; selectionReason: Justification` | `release.package.select_representations`；仅 DRAFT；Representation checksum/revision 匹配 |
| `release.set_destinations@1.0` | `Release / MUTATE` | `destinations: NonEmptySet<ReleaseDestinationDefinition>; recipientScopeSnapshotRef: SnapshotRef<RecipientScope>` | `release.package.set_destinations`；仅 DRAFT；Destination/Recipient 参与 packageHash |
| `release.prepare_release@1.0` | `Release / MUTATE` | `package: ReleasePackageDefinition; preparationValidationRef: ContentAddressedRef<ValidationResult>` | `release.release.prepare`；进入 PREPARED 后 Revision/Package/Recipient/Destination 冻结；一个 Release 一个 Hash |
| `release.validate_release_readiness@1.0` | `Release / MUTATE` | `releaseReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; validatedPackageRef: ReleasePackageRef; validatedAt: UtcInstant` | `release.release.validate_readiness`；必须 AUTHORITATIVE 验证 RRS、ABS 和 packageHash；READY 不等于授权 |
| `release.authorize_release@1.0` | `Release / MUTATE` | `releaseReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; authorizingHumanRef: PrincipalRef; actorSnapshotRef: SnapshotRef<ActorSnapshot>; authorizationDecisionRef: ContentAddressedRef<AuthorizationDecision>; authorizedAt: UtcInstant` | `release.release.authorize`；永久 `HUMAN_ONLY`；事务内重验撤销/失效/Hash；Agent/actingFor 永久拒绝 |
| `release.start_publication_attempt@1.0` | `Release / APPEND` | `attempt: PublicationAttemptDefinition` | `release.publication_attempt.start`；仅 AUTHORIZED/PUBLISHING；每 destination/package 稳定 key；网络调用在提交后 |
| `release.record_publication_receipt@1.0` | `Release / APPEND` | `receipt: FormalReceiptSubmission` | `release.publication_receipt.record`；Raw Receipt 经 release/destination/package/attempt 验证后才是正式事实 |
| `release.record_publication_failure@1.0` | `Release / APPEND` | `failure: PublicationFailureSubmission` | `release.publication_failure.record`；TIMEOUT=UNKNOWN；失败不删除此前成功 Receipt |
| `release.complete_release@1.0` | `Release / EVALUATE` | `completionPolicyRef: VersionedRef<Policy>; destinationOutcomeRefs: NonEmptySet<TypedReference>; evaluatedAt: UtcInstant` | `release.release.complete`；逐项 required destination/receipt 判定 RELEASED/PARTIAL/FAILED；不接受调用者状态 |
| `release.recall_release@1.0` | `Release / MUTATE` | `recallScope: CanonicalJson; recallReason: Justification; authorizingHumanRef: PrincipalRef; authorizationDecisionRef: ContentAddressedRef<AuthorizationDecision>; notificationPolicyRef: VersionedRef<Policy>; recalledAt: UtcInstant` | `release.release.recall`；`HUMAN_ONLY`；不删除 Receipt，触发纠正通知/影响流程 |
| `release.cancel_release@1.0` | `Release / MUTATE` | `cancelReason: Justification; cancelledAt: UtcInstant` | `release.release.cancel`；只允许 DRAFT/PREPARED 且无不可逆成功事实；保留历史 |

## 4. Query Payload 与 Result Contract

```text
ReleaseView
├── releaseRef: ObjectRef<Release>
├── aggregateVersion: NonNegativeInt
├── definition: ReleaseDraftDefinition
├── status: ReleaseStatus
├── packageRef?: ReleasePackageRef
├── releaseReadinessSnapshotRef?: SnapshotRef<ReleaseReadiness>
├── authorizationRef?: ContentAddressedRef<ReleaseAuthorization>
├── attemptRefs: ObjectRef<PublicationAttempt>[]
├── receiptRefs: ContentAddressedRef<PublicationReceipt>[]
└── recallRef?: ContentAddressedRef<Recall>

FrozenPackageView
├── packageRef: ReleasePackageRef
├── definition: ReleasePackageDefinition
├── packagePayloadHash: PayloadHash
└── frozenAt: UtcInstant

PublicationAttemptView
├── attemptRef: ObjectRef<PublicationAttempt>
├── definition: PublicationAttemptDefinition
├── outcome: PublicationOutcome
├── rawReceiptRef?: ContentAddressedRef<RawExternalReceipt>
├── formalReceiptRef?: ContentAddressedRef<PublicationReceipt>
└── failureRef?: ContentAddressedRef<PublicationFailure>

ReleaseImpactView
├── releaseRef: ObjectRef<Release>
├── triggeringRefs: TypedReference[]
├── affectedDestinations: UuidV7[]
├── riskClassification: NamespaceCode
├── requiredActions: NamespaceCode[]
└── humanInterventionRequired: boolean
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `release.get_release@1.0` | A | `releaseRef: ObjectRef<Release>` | `ReleaseView` |
| `release.get_frozen_package@1.0` | A | `packageRef: ReleasePackageRef` | `FrozenPackageView`；相同 releaseId 不接受不同 packageHash |
| `release.get_publication_attempts@1.0` | S | `releaseRef: ObjectRef<Release>; destinationIds: Set<UuidV7>; outcomes: Set<PublicationOutcome>; page: PageRequest` | `Page<PublicationAttemptView>` |
| `release.get_release_receipts@1.0` | A | `releaseRef: ObjectRef<Release>; packageRef?: ReleasePackageRef; destinationIds: Set<UuidV7>; page: PageRequest` | `Page<ContentAddressedRef<PublicationReceipt>>` |
| `release.get_release_impact@1.0` | A | `releaseRef: ObjectRef<Release>; triggeringRef?: TypedReference` | `ReleaseImpactView` |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `release.ReleasePrepared@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; revisionRef: ContentAddressedRef<ArtifactRevision>; approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; destinationIds: NonEmptySet<UuidV7>` |
| `release.ReleaseAuthorized@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; releaseReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; authorizationRef: ContentAddressedRef<ReleaseAuthorization>; authorizedAt: UtcInstant` |
| `release.PublicationAttemptRequested@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; attemptRef: ObjectRef<PublicationAttempt>; destinationId: UuidV7; externalDeliveryRequestRef: ContentAddressedRef<ExternalDeliveryRequest>` |
| `release.PublicationSucceeded@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; attemptRef: ObjectRef<PublicationAttempt>; destinationId: UuidV7; receiptRef: ContentAddressedRef<PublicationReceipt>; occurredAt: UtcInstant` |
| `release.PublicationFailed@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; attemptRef: ObjectRef<PublicationAttempt>; destinationId: UuidV7; outcome: Closed<FAILED \| UNKNOWN>; failureRef: ContentAddressedRef<PublicationFailure>` |
| `release.ReleasePartiallyCompleted@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; succeededDestinationIds: Set<UuidV7>; pendingOrFailedDestinationIds: NonEmptySet<UuidV7>; evaluatedAt: UtcInstant` |
| `release.ReleaseCompleted@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; purpose: ReleasePurpose; revisionRef: ContentAddressedRef<ArtifactRevision>; receiptRefs: NonEmptySet<ContentAddressedRef<PublicationReceipt>>; completedAt: UtcInstant` |
| `release.ReleaseRecalled@1.0` | `releaseRef: ObjectRef<Release>; packageRef: ReleasePackageRef; recallRef: ContentAddressedRef<Recall>; affectedDestinationIds: NonEmptySet<UuidV7>; recalledAt: UtcInstant` |

## 6. 模块错误码

```text
RELEASE_REVISION_NOT_APPROVED
RELEASE_APPROVAL_BUNDLE_INVALID
RELEASE_REPRESENTATION_INVALID
RELEASE_DESTINATION_INVALID
RELEASE_PACKAGE_EMPTY
RELEASE_PACKAGE_HASH_MISMATCH
RELEASE_PACKAGE_FROZEN
RELEASE_MULTIPLE_PACKAGE_HASHES
RELEASE_READINESS_NOT_READY
RELEASE_READINESS_STALE
RELEASE_AGENT_AUTHORIZATION_FORBIDDEN
RELEASE_AUTHORIZATION_INVALID
RELEASE_NOT_AUTHORIZED
RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT
RELEASE_RECEIPT_TARGET_MISMATCH
RELEASE_RECEIPT_ALREADY_RECORDED
RELEASE_RECEIPT_STALE
RELEASE_REQUIRED_RECEIPT_MISSING
RELEASE_COMPLETION_CRITERIA_UNSATISFIED
RELEASE_RECALL_NOT_AUTHORIZED
RELEASE_CANCEL_NOT_ALLOWED
```

## 7. 不变量与持久化边界

1. Release 绑定精确 revision/contentHash、ABS、RRS、Package、Recipient 和 Destination。
2. PREPARED 后 Package 全冻结；任何内容、收件人或 Destination 变化必须新建 Release。
3. Agent/actingFor 永远不能 Release Authorization；授权事务重验所有上游有效性。
4. 外部发布只由已提交 Authorization 驱动；网络调用不在业务事务内。
5. Raw Receipt 是外部观测；本模块必须先经 `RawExternalReceiptRepository` 加载事实，校验 `rawReceiptRef.objectType = integration.raw_external_receipt` 以及 releaseId / destinationId / packageHash / publicationAttemptId 与 Attempt/Submission 一致后，才可形成 Formal PublicationReceipt（RP-API-C-002）。只有 `observedOutcome = SUCCEEDED` 的 Raw Receipt 可升级为 Formal Receipt；Formal `receiptPayloadHash` 必须等于 Raw Receipt 的 payload hash；权威发生时间取 Raw Receipt 的 `occurredAt ?? recordedAt`，Formal submission 不得改写该时间。
6. Timeout/不确定外部状态保持 UNKNOWN；相同稳定幂等键查询/补记，不盲目重发。Formal Receipt 的迟到窗口由 Runtime Receipt Validator 使用上一条定义的权威发生时间判定：该时间晚于 `attempt.requestedAt + deliveryTimeout` 即拒绝 `RELEASE_RECEIPT_STALE`；`deliveryTimeout` 取值来自 Destination 的 DeliveryPolicy，由调用方注入 Validator（Policy 域字段扩展待 Policy 域所有者确认，见 Issue #15 依赖项）。Publication Attempt 与 Formal Receipt 写入分别必须经 Ledger `compareAndSaveAttempt` / `compareAndSaveReceipt`（或等价唯一约束事务），禁止非原子的 validate-then-save。
7. 多 Destination 部分成功保留真实 Receipt，不伪造业务回滚。Release / Publication Attempt / Raw Receipt / Formal Receipt 的强引用相等性必须比较 `objectType`、`objectId`、完整 `scope` 及适用的 snapshot/content hash；不得只按 objectId 或 digest 跨 Project 命中。Publication Attempt / Formal Receipt 的 `packageRef` 必须绑定当前 Release，并与该 Release 冻结的 `ReleasePackageRef` 完全一致。
8. Recall 不删除外部事实；CUSTOMER_DELIVERY Completion 不自动建立 INTERNAL_EFFECTIVE_USE。

## 8. 可人工验收的模块产出

里程碑 `API-RP-01` 的人工产出是 REL-801 Fixture：精确 REV 与 DOCX/PDF checksum 形成冻结 Package；Human 授权后两个 Destination 一成功一失败，状态 PARTIALLY_RELEASED；重试复用同 Package/key；普通飞书文件发送没有 Formal Receipt；Recall 保留全部历史。该审核不代表真实飞书、对象存储或发布已运行。

## 9. 当前状态

- 25 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核；
- 25 个操作的字段级 Schema 已落地，详见 `contracts/src/operations/release-publication.schema.ts`；
- `contracts/registry/public-api.v1.json` 中 25 个 `release.*` 操作 `schemaStatus` 已切换为 `FULL`；
- `tools/contracts/check-catalog.mjs` 已把 `release-publication` 加入 `implementedOwners`；
- 字段级 Payload / Result Schema 与 `Module-Spec-006` §2–§5 完全一致：Release / ReleasePackage / RecipientScopeSnapshot / Destination / PublicationAttempt / Receipt / Recall / Readiness 引用精确、状态枚举闭合、`authorizingHumanRef` 强制 `principalKind: HUMAN`、`publicationFailureSubmission.outcome` 仅允许 `FAILED|UNKNOWN`、事件 payload 严格闭合；
- Unit / Contract 级 Schema 测试已在 `contracts/src/operations/release-publication.schema.test.ts` 中实现并通过；
- Runtime Receipt Validator 已于 2026-08-21（Issue #15 / IM-RP-001）在 `modules/release-publication/src/receipt-validator.ts` 落地，并经 PR #21 review remediation 补强：按 `attemptRef` + `rawReceiptRef.contentHash` + `stableIdempotencyKey` 维护稳定键索引；Attempt / Formal Receipt 分别仅经 `compareAndSaveAttempt` / `compareAndSaveReceipt` 原子落账；同 stable key 不同 packageHash 拒绝 `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT` 且不覆盖原 Receipt；同 `rawReceiptRef` 重复提交拒绝 `RELEASE_RECEIPT_ALREADY_RECORDED`；迟到窗口使用 Raw Receipt 的权威发生时间并拒绝 `RELEASE_RECEIPT_STALE`；attempt 不存在、destination/package 不匹配、`packageRef.releaseRef` 与当前 Release / 冻结 Package 不一致、或 `rawReceiptRef` 非已加载且成功的 `RawExternalReceipt`（objectType / 溯源字段 / payload hash / 权威时间不匹配）均拒绝 `RELEASE_RECEIPT_TARGET_MISMATCH`。持久化载体为 `ReleaseReceiptLedger` + `RawExternalReceiptRepository` 接口与 In-Memory 实现，DDL / 真实 Repository / Integration Provider 注入仍不存在（后者归属 #17）；
- Issue #5 仅负责上述 25 个字段级 Contract；其余 Runtime Owner 已明确迁移：授权主体 ActorSnapshot/actingFor 与 Envelope 一致性归属 #22，`providerResult` PII 最小化归属 #23，普通飞书发送与 Formal Release 来源链归属 #24。三项均未因 Owner 迁移而变为 `PASS`；
- Package Hash 计算、Publisher、完整 Persistence 与人工验收实现仍不存在；
- 对应 Unit / Contract / E2E / Manual 验收结果见 [`Module-Test-006-ReleasePublication.md`](../module-tests/Module-Test-006-ReleasePublication.md)。

## 10. IM-02 WI-04 持久化切片

ReleasePublication owning Schema 独立拥有八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。当前 Runtime Receipt Validator 仍使用 In-Memory Ledger；Canonical payload↔hash 强校验、真实 PostgreSQL Repository、Publisher 与 Provider 注入均为 `NOT RUN`。
