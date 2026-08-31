# Module-Spec-006-ReleasePublication

版本：v1.3
日期：2026-08-31
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA IMPLEMENTATION COMPLETE 2026-08-18 / RUNTIME RECEIPT VALIDATOR IMPLEMENTED 2026-08-21 (#15) / IM-05 WI-06 PERSISTENCE AND GITHUB DELIVERY COMPLETE / IM-05 WI-07 IMPLEMENTATION, PERSISTENCE AND GITHUB DELIVERY COMPLETE 2026-08-31 / PR #138 MERGED / ISSUE #127 CLOSED / DISPATCH EXACT-REFERENCE GUARD VERIFIED / OBSERVATION HASH READBACK REGRESSION ADDED / IM-05 WI-08 SYNTHETIC REL-801 EXIT REVIEW DELIVERED PR #139 / EXACT-HEAD CI PASS 2026-08-31 / ISSUE #128 CLOSED / UNIFIED CROSS-MODULE E2E NOT RUN`

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
- Runtime Receipt Validator 已于 2026-08-21（Issue #15 / IM-RP-001）在 `modules/release-publication/src/receipt-validator.ts` 落地，并经 PR #21 review remediation 补强：按 `attemptRef` + `rawReceiptRef.contentHash` + `stableIdempotencyKey` 维护稳定键索引；Attempt / Formal Receipt 分别仅经 `compareAndSaveAttempt` / `compareAndSaveReceipt` 原子落账；同 stable key 不同 packageHash 拒绝 `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT` 且不覆盖原 Receipt；同 `rawReceiptRef` 重复提交拒绝 `RELEASE_RECEIPT_ALREADY_RECORDED`；迟到窗口使用 Raw Receipt 的权威发生时间并拒绝 `RELEASE_RECEIPT_STALE`；attempt 不存在、destination/package 不匹配、`packageRef.releaseRef` 与当前 Release / 冻结 Package 不一致、或 `rawReceiptRef` 非已加载且成功的 `RawExternalReceipt`（objectType / 溯源字段 / payload hash / 权威时间不匹配）均拒绝 `RELEASE_RECEIPT_TARGET_MISMATCH`。该段是 #15 的 In-Memory Validator 边界；WI-07 另行提供 Handler/Repository 与 V6002 业务持久化，Integration Provider 注入仍不存在（后者归属 #17）；
- Issue #5 仅负责上述 25 个字段级 Contract；其余 Runtime Owner 已明确迁移：授权主体 ActorSnapshot/actingFor 与 Envelope 一致性归属 #22，`providerResult` PII 最小化归属 #23，普通飞书发送与 Formal Release 来源链归属 #24。三项均未因 Owner 迁移而变为 `PASS`；
- Package Hash 计算、Release/Package/Frozen Package Persistence 已由 IM-05 WI-06（Issue #126）实现并通过本地 Unit/真实 PostgreSQL Persistence Gate；WI-07 的 Readiness、Human Authorization、Publication Attempt、Formal Receipt、Failure、Completion、Recall 及对应 Handler/Repository/V6002 已在本切片实现，Provider/公开 HTTP/人工客户验收仍不在本切片范围；
- 对应 Unit / Contract / E2E / Manual 验收结果见 [`Module-Test-006-ReleasePublication.md`](../module-tests/Module-Test-006-ReleasePublication.md)。

## 10. IM-02 WI-04 持久化切片

历史 IM-02 WI-04 基线只覆盖 ReleasePublication owning Schema 的八张标准事务技术表、Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和 masked audit surface。当时 Runtime Receipt Validator 仍使用 In-Memory Ledger；WI-07 的真实 PostgreSQL Repository/Handler 已在 §12 和 V6002 中单独落地，Provider 注入仍为 `NOT RUN`。

## 11. IM-05 WI-06 Release/Package 持久化设计

### 11.1 负责范围

WI-06 只负责 `release.create_release_draft@1.0`、`release.select_representations@1.0`、`release.set_destinations@1.0`、`release.prepare_release@1.0`、`release.cancel_release@1.0`，以及 `release.get_release@1.0`、`release.get_frozen_package@1.0` 的 Application/Persistence 实现。DRAFT 允许替换 Representation Selection、Destination 和 Recipient Scope；Prepare 成功后进入 PREPARED，Package、Revision、ABS、Representation、Recipient Scope、Destination 和 exact Hash 全部冻结；PREPARED 仅允许转为 CANCELLED，且不得删除已冻结 Package 历史。

Application 层只依赖公开 Authority Query Port：Artifact `validate_revision_ref` 与 `get_representation`、Quality `get_revision_acceptance_snapshot` 与 `get_approval_bundle_snapshot`。ReleasePublication 不导入其他业务模块，不读取其他 Schema/Repository；所有强引用按 kind/objectType/objectId/完整 scope 以及 snapshot/content hash 比较。Authority Port 返回的 Revision 必须为 exact、content available、`ACTIVE`；RAS/ABS 必须精确绑定 Artifact、Revision、QualityProfile 和对方 SnapshotRef，Representation 必须精确绑定 Revision、checksum、renderer 和 scope。

### 11.2 Canonical Package Hash

`release-package-manifest/1.0` 是 Package Hash 的固定 canonicalization domain。Manifest 只包含以下结构，不包含 `preparedAt`、`preparationValidationRef` 或调用方声明的 Hash：

```text
{
  manifestVersion,
  releaseRef,
  canonicalRevisionRef,
  approvalBundleSnapshotRef,
  recipientScopeSnapshotRef,
  representations: selections sorted by (ordinal, representationId, representation.checksum),
  destinations: definitions sorted by destinationId
}
```

Manifest 以 shared-kernel `canonicalize` 后计算 SHA-256，结果必须与 `package.packageHash` 完全相等；排序后的 Representation/Destination 数组同时写入冻结 Package。`packagePayloadHash` 是排序后的完整 `ReleasePackageDefinition`（含 computed packageHash）canonical JSON 的 SHA-256，用于 FrozenPackageView 的 payload identity。一个 Package 只允许一个 Release identity；`ReleasePackageRef.packageSnapshotRef` 的 `objectType` 为 `release.release_package`，其 contentHash 必须等于 packageHash。

### 11.3 Persistence/Transaction 约束

新增且只新增 forward-only `V6001__release_publication_release_package_lifecycle.sql`，不改写 `V6000`。四张业务表：`release_record`（可变 DRAFT aggregate）、`release_package`（immutable package）、`release_package_item`（immutable Representation item）和 `release_destination`（immutable frozen Destination）。业务表保留 scope、actor、authorization、source command 与 canonical hash attribution；`release_number` 在 Enterprise 内唯一；Package/Item/Destination 的 owner trigger 拒绝 UPDATE/DELETE；Release trigger 只允许 DRAFT 内 CAS 更新、DRAFT→PREPARED/CANCELLED、PREPARED→CANCELLED，并拒绝 PREPARED 后任意冻结字段改变。

业务写入必须经 owner SECURITY DEFINER function，app role 不得直接 INSERT/UPDATE/DELETE 业务表。Application transaction 先建立 trusted platform Context，再切到 `release_publication_app`；Receipt Claim、业务 owner function、`ReleasePrepared` Outbox、Reference Edge 和 Audit 在同一个数据库事务中执行。Release aggregate 与冻结 Package 使用分离的 Reference Edge path 前缀，避免同一精确引用在两个事实层重复占用唯一路径。若业务、技术或 Hash/Reference 校验失败，所有写入回滚；CAS 冲突在锁后事务视图回读当前 version。业务 Query 只从 ReleasePublication 自有表读取并返回契约定义的精确 `ReleaseView`/`FrozenPackageView`。

### 11.4 WI-06 输出与边界

技术人工材料为 REL-801 preparation-only：Release/Revision/ABS/Representation/recipient/destination ref、canonical manifest bytes、expected/actual packageHash、packagePayloadHash、freeze/cancel 和 SQLSTATE/错误结果。该材料不执行 Human Authorization、RRS、Publisher、真实 Feishu/Email、对象存储、生产、公开 HTTP、跨模块业务 E2E 或独立人工客户验收。

2026-08-31 本地验证已完成：新增 Unit 测试 2 files/5 tests PASS；固定 PostgreSQL 18.6/Flyway 11.20.3 的 persistence gate 为 34 files/313 tests PASS，覆盖 V6001 空库迁移、二次 no-op、CAS/idempotency、canonical hash、RLS/ACL、immutable guard、Reference Edge path separation、技术事实同事务与 rollback。用户检查和 Git 交付仍是独立边界。

## 12. IM-05 WI-07 Release Authorization、Publication、Receipt 与 Recall

### 12.1 Application 与 Authority Port

WI-07 在不改变既有 25 项公开 Contract 的前提下实现 Release Readiness、Human Authorization、Publication Attempt、Formal Receipt、Failure、Completion 和 Recall。Application 只依赖窄化的公开 Authority Query Port：Artifact exact Revision/Representation、Quality exact RAS/ABS/RRS、Identity exact ActorSnapshot/AuthorizationDecision，以及 Integration exact RawExternalReceipt。ReleasePublication 不导入其他模块的 Repository、Schema 或内部实现。

`validate_release_readiness` 和 `authorize_release` 必须在事务内重新读取并逐项比较 Release、冻结 Package、Package Item、Recipient Scope、Destination、RAS、ABS、RRS、Revision、Representation 和上游有效性。RRS 必须绑定当前 Release、冻结 Package、purpose、recipient/destination 集合并处于可授权状态；任何 stale、withdrawn、revoked、scope、purpose、hash、version 或 upstream impact 不一致都在 publisher/attempt 副作用前 fail-closed。

授权链必须同时满足：Envelope actor 是可信 Human；ActorSnapshot principal kind 是 `HUMAN`；不存在 Agent/Service/Runtime actingFor Human 代授权；authorizing principal、ActorSnapshot、AuthorizationDecision、scope、purpose、command type/version、payload hash、authentication context、expiry 和 revocation 完全一致；AuthorizationDecision 的 outcome 为允许且仍在有效期内。授权失败不得追加 Attempt、Raw/Formal Receipt、PublicationSucceeded 或 Completion。

### 12.2 Attempt、Failure、Completion 与 Recall

每个 Destination 以 `releaseId + frozenPackageHash + destinationId` 生成稳定 Attempt key，并以 Attempt number/CAS 处理重放和竞争。业务事务先追加 Attempt、Outbox 和审计事实，提交成功后才允许 Worker 调用 Adapter/Provider。稳定 key 在同一 Release/Package/Destination 绑定，后续 retry 可以复用该 key 生成新的 Attempt number；`release + package + destination + attempt number` 才是 Attempt 行的唯一身份。相同 Attempt key、相同 payload 的重放返回权威已有 Attempt；不同 package、destination、payload 或 scope 不得覆盖旧事实。Worker 在调用 Adapter 前必须再次比较传入 Attempt Ref 的 `objectType`、`objectId` 和完整 Scope 与已提交 Attempt identity；不匹配时必须在副作用前 fail-closed。Provider timeout 只能记录 `UNKNOWN`，Reconciliation 必须读取同一 Attempt 的权威状态/Raw Receipt，不得根据未知状态盲目重发。

RawExternalReceipt 必须精确绑定 Release、Package、Destination、PublicationAttempt、Adapter Attempt、success outcome、payload hash 和权威发生时间；仅此事实可以晋升 Formal Receipt。`providerResult` 在持久化、Event、Error 和日志边界前使用 allowlist/redaction，任何 email、phone、personal name、地址、credential、token 或原始消息正文不得泄漏。普通 Feishu/file send、provider message ID、伪造或不完整 Raw Receipt 不能产生 Formal Receipt、PublicationSucceeded 或 Completion。

Completion 按 Destination 保存 Attempt identity、Receipt、Failure、Observation 历史和受控 Attempt outcome projection：每个 Attempt 创建、Receipt 成功和 Failure/UNKNOWN 结果都追加不可变 Observation，不能以终态 projection 取代历史；Attempt identity、Receipt、Failure、Observation 均不可变；Attempt 的 outcome/raw/formal/failure projection 只能由 owner function 按合法状态迁移更新。成功 Receipt 必须保留；FAILED/UNKNOWN 目标独立重试；全部 purpose-specific required receipt 成功后才允许 `RELEASED`，存在成功与终态失败/未知时为 `PARTIALLY_RELEASED`，全失败时为 `FAILED`。Receipt projection 已达到 `RELEASED` 时，公开 Complete 命令仍可基于 exact outcome refs 幂等记录最终收尾事实，不得重复创建业务 Receipt。Recall 只能追加 Recall、ImpactReview、affected destinations、reason、actions、impact 和外部事实，不能删除或改写历史，不自动创建替代 Release 或 EffectiveBinding。Release 进入 `RECALLED` 后，Attempt、Receipt、Failure、Completion、Recall 和任何外部 Adapter/Provider 调度路径都必须 fail-closed，不能再追加事实、改变投影或产生副作用。

### 12.3 Persistence、事务与验证边界

WI-07 只新增 forward-only `V6002__release_publication_authorization_publication_receipt_recall.sql`，不得修改已应用的 `V6000`/`V6001`。新增业务事实表为 `publication_attempt`、`publication_observation`、`publication_receipt`、`publication_failure`、`release_recall` 和 `release_impact_review`；表均保留 Enterprise/Project Scope、canonical payload/hash、actor/authorization/source-command attribution 和 immutable history。所有 Observation 的 `observation_payload_hash` 必须由应用层对 canonical observation payload 计算 SHA-256 后传入 owner function，数据库至少校验其 32-byte 长度，不得写入任意长度或占位哈希。`publication_attempt` 的 identity 列和稳定 key 不可变；同一 stable key 的重试由 owner function 校验 Release/Package/Destination 绑定并递增 Attempt number，不能依赖 stable key 单列唯一约束；outcome/raw/formal/failure 仅可由 owner function 受控更新，Receipt/Failure/Observation/Recall/ImpactReview 仍为 append-only。`release_record` 另外保存由授权命令稳定生成的 `release.release_authorization` ContentAddressedRef，并仅通过 owner SECURITY DEFINER function 扩展授权、Attempt、Completion、Recall 状态，app role 不得直接 DML；RLS/ACL、scope mirror、CAS、stable-key binding、append-only trigger 和 rollback 必须由真实 PostgreSQL 验证。

业务状态写入、Command Receipt、Audit、Outbox、Reference Edge、Attempt/Receipt/Failure/Recall 和必要的 ImpactReview 必须同事务提交或整体回滚。Reference Edge 为 append-only；同一 Release 在不同命令中再次引用同一权威事实时必须使用包含具体事实 ID 的语义独立 reference path，不能重复占用同一 owner/path 或改写已有 Edge。已知业务校验错误才可转换为稳定业务拒绝；数据库约束、连接和其他技术异常必须继续冒泡，让整个事务回滚，不能在 aborted transaction 中继续 finalize Receipt/Audit。稳定重试、并发授权、并发 Attempt、重复/迟到 Receipt、Recall 后终态写保护、RLS、直接 DML、跨 Scope、PII、普通发送来源链和 rollback 都必须有 Unit/Contract/Persistence/E2E 回归；Persistence readback 还必须对每一条 Observation 的 canonical `observation_payload` 重新计算 SHA-256，并与持久化的 32-byte `observation_payload_hash` 精确相等。Persistence Gate 中既有 Artifact direct-Context expiry probe 使用 500ms 建立窗口并等待 800ms 后验证过期，确保验证的是“已建立 Context 后过期”而不是数据库往返竞态；这不改变 Context 的生产 expiry contract。REL-801 手工时间线为合成技术输出，不升级真实 Provider、生产、公开 HTTP、跨模块业务 E2E、外部收件人确认或独立人工业务验收；#22/#23/#24 的 Issue 状态与独立证据不由本切片静默关闭。

2026-08-31 实现与本地技术验收结果：精确 `pnpm verify` 全部通过，包含 Format、Lint、Typecheck、普通 Vitest（42 个文件通过、30 个受控跳过；432 passed、299 skipped）、Architecture、201 项 Public API/Catalog 全部 `FULL`、v1.0 compatibility baseline 200 项，以及 PostgreSQL/Flyway Persistence Gate（34 个文件、314 个测试；V6002、二次 no-op、tag→digest、容器清理）。WI-07 focused suite 为 6 个文件、33 个测试通过；PostgreSQL Handler 路径读回 3 个 Attempt、6 条 Observation、2 个 Formal Receipt、1 个 Failure、1 个 Recall 和 1 个 ImpactReview，并逐条重算 Observation SHA-256 与持久化 32-byte hash 相等；RLS/ACL、append-only、CAS、rollback、跨 Scope 和 dispatch exact `objectType`/`objectId`/Scope guard 均有回归。该结果仅证明本地、合成和 disposable PostgreSQL 技术边界；真实 Provider、公开 HTTP、生产、跨模块业务 E2E、外部收件人和独立人工验收仍为 `NOT RUN`。

### 12.4 Issue #22–#24 Runtime 修复契约（2026-08-31，IMPLEMENTED / CONTROLLED TECHNICAL VERIFIED）

本节是对 §12.1–§12.3 的收紧，已由实现、聚焦回归和仓库级完整 Gate 落实；外部边界不因本地证据升级：

- **#22 授权主体**：`authorizeRelease`/对应 Handler 只接受 `REQUEST` Context。Context 的 Human principal、ActorSnapshot ID、AuthorizationDecision ID/hash、Enterprise、允许 Project、Decision expiry 必须与请求和权威 Identity facts 完全一致；Release Scope/Project、command type/version、purpose、payload hash、authentication context、outcome、expiry 和 revocation 也必须逐项一致。ActorSnapshot 的 principal kind 必须是 `HUMAN`；任何 Agent/Service/Runtime principal 或其 `actingFor` 代授权都必须拒绝，且拒绝前不得写入授权、Attempt、Receipt、Event 或状态变化。Runtime 派生的 `authorizationRef` 也必须先与调用方声明精确比较，再允许任何 Release 状态写入。
- **#23 Provider Result**：Formal Receipt 的 `providerResult` 只允许模块定义的安全 provider identifier/status/attempt 字段及其安全标量格式；根值必须是对象，数组/标量根值直接 fail-closed。未知字段、PII/Secret-like key、嵌套对象/数组中的未知或敏感字段、以及允许 key 下不安全的字符串值必须在进入持久化、Event、Error 或日志前不可逆去除/替换。安全标识符可以保留，但不得以宽泛 key 名或直接 provider payload 代替白名单。
- **#24 来源链**：`RawExternalReceiptFact` 必须保存并通过精确比较绑定 Attempt 的 `externalDeliveryRequestRef`；Adapter Attempt 必须为 `integration.adapter_attempt` 且与 Release Scope 一致。即使 Provider 返回成功或 `messageId`，没有有效 Human Authorization、已登记 Publication Attempt、精确 External Delivery Request、成功 Raw Receipt、payload hash 和权威时间，也不得铸造 Formal Receipt、`PublicationSucceeded` 或 Completion。
- **验证边界**：本节的独立回归使用受控 Runtime/Authority Port/合成 Raw Receipt；真实 Provider、真实 Feishu、公开 HTTP、统一跨模块业务 E2E、生产和独立人工验收仍明确标记 `NOT RUN`，不由本地技术 PASS 替代。

聚焦验证命令 `pnpm exec vitest run provider-result.test.ts receipt-validator.test.ts release-publication-authorization.test.ts release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot` 已通过 `4 files / 34 tests`。随后 `pnpm clean && pnpm verify` 完整通过：Format、Lint、Typecheck、全量 Vitest `42 files passed / 30 skipped`（`438 passed / 299 skipped`）、Architecture、Contract/Catalog `201/201 FULL`、v1.0 compatibility baseline 200 operations，以及 PostgreSQL/Flyway `34 files / 314 tests`；二次 migrate 返回 `Schema "public" is up to date. No migration necessary.`，容器已清理。

## 13. IM-05 WI-08 合成 REL-801 退出复核边界

WI-08 不新增 ReleasePublication Contract、业务表或 Migration；它复用 V6001/V6002 和已验证的 Release Authority Query Port，整理 Release Readiness、frozen Package、Human Authorization、两 Destination Attempt/Receipt/Failure/Partial/Completion/Recall 的 exact ref/hash/history。`tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 提供固定的受控迟到回执时间线；WI-07 PostgreSQL Handler 主流程提供完整授权、失败重试、Formal Receipt、final completion 与 Recall 事实。

报告模式只输出合成技术事实，不连接真实 Feishu/email/对象存储/Provider，也不将 `messageId`、PII、token 或原始 Provider 结果当作 Formal Receipt 依据。统一 Quality→Renderer→Release 编排器、公开 HTTP、生产数据库、真实外部收件人、部署后验证和独立人工业务验收继续为 `NOT RUN`。

2026-08-31 GitHub 交付状态：WI-08 报告与测试变化已随 [PR #139](https://github.com/qzhike/zhiju-business-core/pull/139) 合入 `main`；最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 的 GitHub Actions `verify` run `33355948473` 通过，merge commit 为 `07fc6a083897c01924f842d12dffe06fd6068261`，Issue #128 已关闭。真实 Provider、公开 HTTP、生产和独立人工验收仍为 `NOT RUN`。
