# Module-Spec-006-ReleasePublication

版本：v1.10
日期：2026-09-01
状态：`CURRENT MODULE CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA IMPLEMENTATION COMPLETE 2026-08-18 / RUNTIME RECEIPT VALIDATOR IMPLEMENTED 2026-08-21 (#15) / IM-05 WI-06 PERSISTENCE AND GITHUB DELIVERY COMPLETE / IM-05 WI-07 IMPLEMENTATION, PERSISTENCE AND GITHUB DELIVERY COMPLETE 2026-08-31 / PR #138 MERGED / ISSUE #127 CLOSED / IM-05 WI-08 SYNTHETIC QMS/REL-801 EXIT REVIEW DELIVERED PR #139 / EXACT-HEAD CI PASS 2026-08-31 / ISSUE #128 CLOSED / #22/#23/#24 MERGED AND CLOSED / CURRENT RRS AUTHORIZATION REVALIDATION LOCAL RUNTIME AND POSTGRESQL PASS 2026-09-01 / USER REVIEW AND GIT DELIVERY PENDING / UNIFIED CROSS-MODULE E2E NOT RUN`

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

### 2.1 Provider Result Runtime Boundary（Issue #23）

`FormalReceiptSubmission.providerResult` 为兼容现有公共 Contract 仍保留 `CanonicalJson` 外形，但该类型不是安全边界。ReleasePublication 在 Receipt 入库前必须执行确定性的 Provider Result 归一化：

- 只有代码内显式登记的 Publisher/Provider Adapter Result Mapping 才能把外部 `status`、`providerStatus`、`outcome`、`errorCode` 和 `reasonCode` 映射为模块闭集值；不受信输入中的已知闭集别名也必须经过同一规范化，未知 Adapter、未知字段、未登记值、嵌套对象和数组内容必须 fail-closed 为安全替换或移除，不能把原始值写入 Receipt、Event、ApiError 或日志。
- `messageId`、`deliveryId`、`providerAttemptId`、`providerMessageId`、`providerRequestId`、`requestId`、`traceId` 等原始标识一律省略，不生成可猜测或可关联的摘要；普通 Command/调用方自带的同名字段以及任何自声明 `*Hash` 必须删除，不能替代 Adapter 结果。
- Runtime `PublicationAdapterResult` 是 Adapter/Port 的唯一正向入口：Adapter 提交 `ProviderResultAdapterExtraction`，Runtime 在 dispatch/reconcile 入口调用登记 mapping。输出必须是普通可 JSON 序列化的闭集对象，JSON round trip 后仍可安全 readback，不依赖 `WeakSet`、对象身份或隐藏信任标记。
- 当前只登记 `feishu.channel` 的受控 mapping 作为 Adapter 边界测试入口；这只是内部映射契约，不代表真实 Feishu Provider 已接入或完成外部验收。新增 Provider 必须先增加评审过的 closed mapping 和对应反例回归，禁止恢复通用 token 正则。映射失败只返回稳定错误代码和固定字段路径，不得把不受信 key/value 回显到 ApiError 或日志。
- Handler 与 Runtime Validator 必须使用同一归一化结果计算 Receipt fact、写入数据库和构造后续事实。公开 `PublicationSucceeded` Event 本身不携带 `providerResult`；业务错误和日志只允许稳定错误码、字段路径、Hash 与 opaque 引用。Sanitizer 的未知 key 只能记录固定路径 `/providerResult/unknown`，不得将原始 key 写入诊断。
- PostgreSQL owner function 与 `publication_receipt` 新写入边界必须使用同一安全形状校验，拒绝直接传入姓名式闭集外值、原始标识、任何 `*Hash`、未知 key、嵌套对象或数组；该数据库防线只能通过新增 forward-only migration 增加，不得修改已应用的 V6002。新增 V6004 必须在 owner 维护窗口内扫描并修复 V6002 已存 Receipt 与 Observation，重新计算被修复 Observation 的 canonical SHA-256 hash，并在事务结束后恢复 append-only/guard。V6004 只清理 Receipt `provider_result` 安全投影及 Observation 中的重复投影，不得改写 Receipt ID、`formalReceiptRef`、Attempt、Raw Receipt 或其他历史身份链；`formalReceiptRef` 继续标识原始已接受的 sealed submission，只有实际被改写的 Observation payload hash 需要重算。

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
- Issue #5 仅负责上述 25 个字段级 Contract；其余 Runtime Owner 已明确迁移：授权主体 ActorSnapshot/actingFor 与 Envelope 一致性归属 #22，`providerResult` PII 最小化归属 #23，普通飞书发送与 Formal Release 来源链归属 #24。三项仍独立维护；#24 的本地受控技术验证已通过，但不等价于真实 Provider、生产或独立人工验收；
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

WI-07 在不改变既有 25 项公开 Contract 的前提下实现 Release Readiness、Human Authorization、Publication Attempt、Formal Receipt、Failure、Completion 和 Recall。Application 只依赖窄化的公开 Authority Query Port：Artifact exact Revision/Representation、Quality exact RAS/ABS/RRS、Identity exact ActorSnapshot/AuthorizationDecision、Integration exact RawExternalReceipt，以及 Integration exact formal Adapter Attempt binding。ReleasePublication 不导入其他模块的 Repository、Schema 或内部实现。

`validate_release_readiness` 和 `authorize_release` 必须在事务内重新读取并逐项比较 Release、冻结 Package、Package Item、Recipient Scope、Destination、RAS、ABS、RRS、Revision、Representation 和上游有效性。两条路径调用 Quality RRS Authority Query 时必须设置 `requireCurrentForAuthorization=true`；该查询不仅回放 exact snapshot，还必须证明它仍是同 Release + frozen Package 的最新 RRS，且 Gate、ABS、RAS、Approval 没有后续 invalidation/revocation/stale replacement。RRS 必须绑定当前 Release、冻结 Package、purpose、recipient/destination 集合并处于可授权状态；任何 stale、withdrawn、revoked、scope、purpose、hash、version 或 upstream impact 不一致都在 Authorization、publisher/attempt 和 Outbox 副作用前 fail-closed。Query 缺失、返回 `undefined`、异常或忽略 current 标志均不得回退到历史 RRS 内部状态。

授权链必须同时满足：Envelope actor 是可信 Human；ActorSnapshot principal kind 是 `HUMAN`；不存在 Agent/Service/Runtime actingFor Human 代授权；authorizing principal、ActorSnapshot、AuthorizationDecision、scope、purpose、command type/version、payload hash、authentication context、expiry 和 revocation 完全一致；AuthorizationDecision 的 outcome 为允许且仍在有效期内。授权失败不得追加 Attempt、Raw/Formal Receipt、PublicationSucceeded 或 Completion。

### 12.2 Attempt、Failure、Completion 与 Recall

每个 Destination 以 `releaseId + frozenPackageHash + destinationId` 生成稳定 Attempt key，并以 Attempt number/CAS 处理重放和竞争。业务事务先追加 Attempt、Outbox 和审计事实，提交成功后才允许 Worker 调用 Adapter/Provider。稳定 key 在同一 Release/Package/Destination 绑定，后续 retry 可以复用该 key 生成新的 Attempt number；`release + package + destination + attempt number` 才是 Attempt 行的唯一身份。相同 Attempt key、相同 payload 的重放返回权威已有 Attempt；不同 package、destination、payload 或 scope 不得覆盖旧事实。Worker 在调用 Adapter 前必须再次比较传入 Attempt Ref 的 `objectType`、`objectId` 和完整 Scope 与已提交 Attempt identity；不匹配时必须在副作用前 fail-closed。Provider timeout 只能记录 `UNKNOWN`，Reconciliation 必须读取同一 Attempt 的权威状态/Raw Receipt，不得根据未知状态盲目重发。

RawExternalReceipt 必须精确绑定 Release、Package、Destination、PublicationAttempt、Adapter Attempt、success outcome、payload hash 和权威发生时间；仅此事实可以晋升 Formal Receipt。Adapter Attempt 的 exact objectType/objectId/完整 Scope 必须先经 IntegrationGateway formal Adapter Attempt Query 解析为已登记事实，并且其 `SUCCEEDED` 状态和 `externalDeliveryRequestRef` 必须同时与 PublicationAttempt 精确一致；Query 缺失、返回 undefined、异常或任何绑定不一致都必须 fail-closed。`providerResult` 在进入持久化、Event、Error 和日志边界前必须通过 Adapter-owned closed mapping：只有登记 Adapter 的闭集状态/结果/错误/原因值可以保留，普通调用方输入中的未知值、原始 Provider 标识和任何自声明 `*Hash` 必须移除或用固定安全 marker 替换；原始标识不生成摘要，直接省略。Runtime Adapter/Port 的 extraction 在 JSON round trip 后仍必须经过同一登记 mapping，不能依赖 `WeakSet` 或对象身份。任何 email、phone、personal name、地址、credential、token、URL 或原始消息正文不得泄漏。普通 Feishu/file send、provider message ID、伪造或不完整 Raw Receipt 不能产生 Formal Receipt、PublicationSucceeded 或 Completion。

Completion 按 Destination 保存 Attempt identity、Receipt、Failure、Observation 历史和受控 Attempt outcome projection：每个 Attempt 创建、Receipt 成功和 Failure/UNKNOWN 结果都追加不可变 Observation，不能以终态 projection 取代历史；Attempt identity、Receipt、Failure、Observation 均不可变；Attempt 的 outcome/raw/formal/failure projection 只能由 owner function 按合法状态迁移更新。成功 Receipt 必须保留；FAILED/UNKNOWN 目标独立重试；全部 purpose-specific required receipt 成功后才允许 `RELEASED`，存在成功与终态失败/未知时为 `PARTIALLY_RELEASED`，全失败时为 `FAILED`。Receipt projection 已达到 `RELEASED` 时，公开 Complete 命令仍可基于 exact outcome refs 幂等记录最终收尾事实，不得重复创建业务 Receipt。Recall 只能追加 Recall、ImpactReview、affected destinations、reason、actions、impact 和外部事实，不能删除或改写历史，不自动创建替代 Release 或 EffectiveBinding。Release 进入 `RECALLED` 后，Attempt、Receipt、Failure、Completion、Recall 和任何外部 Adapter/Provider 调度路径都必须 fail-closed，不能再追加事实、改变投影或产生副作用。

### 12.3 Persistence、事务与验证边界

WI-07 只新增 forward-only `V6002__release_publication_authorization_publication_receipt_recall.sql`、`V6003__release_publication_provider_result_safety.sql` 和 `V6004__release_publication_provider_result_data_upgrade.sql`，不得修改已应用的 `V6000`/`V6001`/`V6002`。新增业务事实表为 `publication_attempt`、`publication_observation`、`publication_receipt`、`publication_failure`、`release_recall` 和 `release_impact_review`；表均保留 Enterprise/Project Scope、canonical payload/hash、actor/authorization/source-command attribution 和 immutable history。所有 Observation 的 `observation_payload_hash` 必须由应用层对 canonical observation payload 计算 SHA-256 后传入 owner function，数据库至少校验其 32-byte 长度，不得写入任意长度或占位哈希。`publication_attempt` 的 identity 列和稳定 key 不可变；同一 stable key 的重试由 owner function 校验 Release/Package/Destination 绑定并递增 Attempt number，不能依赖 stable key 单列唯一约束；outcome/raw/formal/failure 仅可由 owner function 受控更新，Receipt/Failure/Observation/Recall/ImpactReview 仍为 append-only。`release_record` 另外保存由授权命令稳定生成的 `release.release_authorization` ContentAddressedRef，并仅通过 owner SECURITY DEFINER function 扩展授权、Attempt、Completion、Recall 状态，app role 不得直接 DML；RLS/ACL、scope mirror、CAS、stable-key binding、append-only trigger 和 rollback 必须由真实 PostgreSQL 验证。V6003 增加 `publication_receipt.provider_result` 的 immutable safe-shape helper 和 owner/security-definer BEFORE INSERT/UPDATE guard，直接写入姓名式状态、原始标识、任何 `*Hash`、未知 key、嵌套对象或数组以 SQLSTATE `23514` fail-closed；应用层合法 marker 和闭集 Adapter output 通过该边界。V6004 在同一迁移事务内以 owner 维护窗口扫描 V6002 已存 Receipt `provider_result` 和 Observation `observation_payload->providerResult`，省略原始数据、保留 Receipt/Attempt/Raw Receipt 的历史身份引用、重算修复后 Observation 的 canonical SHA-256 hash，并在提交前恢复 immutable triggers。

业务状态写入、Command Receipt、Audit、Outbox、Reference Edge、Attempt/Receipt/Failure/Recall 和必要的 ImpactReview 必须同事务提交或整体回滚。Reference Edge 为 append-only；同一 Release 在不同命令中再次引用同一权威事实时必须使用包含具体事实 ID 的语义独立 reference path，不能重复占用同一 owner/path 或改写已有 Edge。已知业务校验错误才可转换为稳定业务拒绝；数据库约束、连接和其他技术异常必须继续冒泡，让整个事务回滚，不能在 aborted transaction 中继续 finalize Receipt/Audit。稳定重试、并发授权、并发 Attempt、重复/迟到 Receipt、Recall 后终态写保护、RLS、直接 DML、跨 Scope、PII、普通发送来源链和 rollback 都必须有 Unit/Contract/Persistence/E2E 回归；Persistence readback 还必须对每一条 Observation 的 canonical `observation_payload` 重新计算 SHA-256，并与持久化的 32-byte `observation_payload_hash` 精确相等。Persistence Gate 中既有 Artifact direct-Context expiry probe 使用 500ms 建立窗口并等待 800ms 后验证过期，确保验证的是“已建立 Context 后过期”而不是数据库往返竞态；这不改变 Context 的生产 expiry contract。REL-801 手工时间线为合成技术输出，不升级真实 Provider、生产、公开 HTTP、跨模块业务 E2E、外部收件人确认或独立人工业务验收；#22/#23/#24 的 Issue 状态与独立证据不由本切片静默关闭。

2026-08-31 实现与本地技术验收结果：精确 `pnpm clean && pnpm verify` 全部通过，包含 Format、Lint、Typecheck、普通 Vitest（42 个文件通过、30 个受控跳过；445 passed、300 skipped）、Architecture、201 项 Public API/Catalog 全部 `FULL`、v1.0 compatibility baseline 200 项，以及 PostgreSQL/Flyway Persistence Gate（34 个文件、315 个测试；先 V6002 seed 历史 unsafe Receipt/Observation，再执行 V6003/V6004，二次 no-op、tag→digest、容器清理均通过）。Issue #23 focused suite 为 3 个文件、37 个测试通过，覆盖直接反例、未信任原始标识和自声明摘要、固定诊断路径、登记 Adapter mapping、JSON round trip、Runtime Adapter/Port、Receipt readback、Publication Event、ApiError/日志边界及 owner 直接写入防线；V6004 两表 readback 清理原始值并逐条重算 Observation SHA-256，与持久化 32-byte hash 相等；RLS/ACL、append-only、CAS、rollback、跨 Scope 和 dispatch exact `objectType`/`objectId`/Scope guard 均有回归。该结果仅证明本地、合成和 disposable PostgreSQL 技术边界；真实 Provider、公开 HTTP、生产、跨模块业务 E2E、外部收件人和独立人工验收仍为 `NOT RUN`。

### 12.4 Issue #22–#24 Runtime 修复契约（2026-09-01，#22/#23/#24 MERGED AND CLOSED）

本节是对 §12.1–§12.3 的收紧。#22 Authorize/Recall 当前 ActorSnapshot 绑定已有实现与本地技术证据；#23 Provider Result 的直接反例、历史数据升级和 Runtime Adapter/Port 复验已在本分支完成本地技术验证；#24 Formal Receipt provenance 的 PR #147 已将审核发现的 Raw Receipt→Query 循环信任改为独立登记/查询组合回归，focused、完整验证、persistence gate 和 exact-head CI 均通过；修复 Head `9c9a4fc74c291d92e144d5dcb2e7c10609c9e928` 已由 PR #147 merge commit `cd2391b0e8abb3c0b0da081323ba0fadd4f239ec` 合入 `main`，Issue #24 已关闭；外部边界也不因本地证据升级：

- **#22 授权主体**：`authorizeRelease`/对应 Handler 只接受 `REQUEST` Context。Context 的 Human principal、ActorSnapshot ID、AuthorizationDecision ID/hash、Enterprise、允许 Project、Decision expiry 必须与请求和权威 Identity facts 完全一致；Release Scope/Project、command type/version、purpose、payload hash、authentication context、outcome、expiry 和 revocation 也必须逐项一致。ActorSnapshot 的 principal kind 必须是 `HUMAN`；任何 Agent/Service/Runtime principal 或其 `actingFor` 代授权都必须拒绝，且拒绝前不得写入授权、Attempt、Receipt、Event 或状态变化。Runtime 派生的 `authorizationRef` 也必须先与调用方声明精确比较，再允许任何 Release 状态写入。Recall 没有复用 Release 原始授权主体的特权：Handler 必须先通过 Identity Authority 解析当前 Recall `AuthorizationDecision`，加载该 Decision 引用的 exact ActorSnapshot，并将它与当前 Envelope/Context 的 actor、`actorSnapshotId`、Human principal、Scope、Purpose、command type/version、payload hash、authentication context、expiry 和 revocation 逐项比较；原始 `authorization_actor_snapshot_ref` 仅为历史事实。
- **#23 Provider Result**：Formal Receipt 的 `providerResult` 只允许 Adapter/Port 边界输出的模块闭集值和受控 attempt/retry 字段；根值必须是对象，数组/标量根值直接 fail-closed。只有当前登记 `feishu.channel` mapping 的状态、结果、错误和原因别名可以归一化到闭集；未知字段、PII/Secret-like key、嵌套对象/数组中的未知或敏感字段、允许 key 下的姓名式/客户标识式值、原始标识和调用方自声明 `*Hash` 都在进入持久化、Event、Error 或日志前不可逆去除或替换，原始标识不生成摘要。Runtime dispatch/reconcile 必须在 Adapter result 进入 Validator 前调用 mapping，JSON round trip 不改变安全结果；映射失败和 sanitizer 只返回稳定错误码与固定字段路径 `/providerResult/unknown`，不回显 raw key/value。V6004 必须扫描并修复 V6002 已落库的 Receipt 与 Observation，并重新计算被修复 Observation 的 canonical hash。
- 上一轮 `4 files / 40 tests` 与 `34 files / 314 tests` 是复审前基线；#23 已完成 V6004 历史数据升级、Runtime Adapter/Port JSON round trip、省略标识、数据库拒绝 `*Hash` 和固定诊断路径复验，并已通过 PR #144 exact-head CI、合并与 Issue #23 关闭回读。
- **#24 来源链**：`RawExternalReceiptFact` 必须保存并通过精确比较绑定 Attempt 的 `externalDeliveryRequestRef`；Adapter Attempt 必须通过 IntegrationGateway 权威 Query 按 exact `objectId` 读取为已登记的 `integration.adapter_attempt`，且其 Scope、`SUCCEEDED` 状态和 External Delivery Request 与 Release/Publication Attempt 逐项一致。受控 Runtime E2E 必须先在独立登记的 Adapter Attempt Authority fixture 中建立事实，再将其 Query Port 注入 ReleasePublication；不得用 `RawExternalReceiptFact` 本身或其投影作为 Query authority。IntegrationGatewayRuntime 的实际登记/查询行为保持由其模块单测独立证明，ReleasePublication 不导入 IntegrationGateway Repository 或实现。通用 Runtime/Renderer Attempt 可以继续使用原有通用入口，但正式 Adapter Attempt 缺少 External Delivery Request 时必须拒绝。即使 Provider 返回成功或 `messageId`，没有有效 Human Authorization、已登记 Publication Attempt、已登记且精确绑定的 Adapter Attempt、成功 Raw Receipt、payload hash 和权威时间，也不得铸造 Formal Receipt、`PublicationSucceeded` 或 Completion。
- **验证边界**：本节的独立回归使用受控 Runtime/Authority Port/合成 Raw Receipt；真实 Provider、真实 Feishu、公开 HTTP、统一跨模块业务 E2E、生产和独立人工验收仍明确标记 `NOT RUN`，不由本地技术 PASS 替代。

PR #141 合并后的复核发现 Recall Persistence Handler 曾把 Release 原始授权行中的 ActorSnapshot 传给授权校验，导致当前由不同 Human 持有的有效 Recall Decision 可能被错误拒绝。follow-up PR #142 已改为先解析当次 AuthorizationDecision，再使用该 Decision 引用的 exact ActorSnapshot；Handler/Persistence 回归覆盖不同 Human、主体/范围/用途/command type/payload hash、过期/撤销、Agent/`actingFor` 和无业务副作用，并已通过新鲜本地验证。Release 原始授权 ActorSnapshot 仍只作为历史事实；文档对齐 head `87704a35838f2db529cc2b992eb3f5e33675fe05` 的 GitHub `verify` run `33391359556` 成功，PR #142 已以 merge commit `e9590a9ec9dbc706b42233ed76068c0fdd6fd729` 合入 `main`，Issue #22 已关闭。commandVersion mismatch、Decision/ActorSnapshot authentication-context mismatch 和 Identity Authority Port 异常不泄漏回归尚未单独执行。

聚焦验证命令 `pnpm exec vitest run modules/release-publication/src/provider-result.test.ts modules/release-publication/src/receipt-validator.test.ts modules/release-publication/src/release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot` 已通过 `3 files / 37 tests`，直接 Issue #23 反例输出仅保留固定 redacted marker，且验证登记 Adapter mapping、JSON round trip、原始标识/自声明摘要省略、Receipt readback、Publication Event、ApiError/日志边界和 Runtime Adapter/Port 正向入口；Issue #24 独立 focused 命令 `pnpm exec vitest run modules/release-publication/src/receipt-validator.test.ts modules/release-publication/src/release-publication-runtime.e2e.test.ts modules/integration-gateway/src/integration-gateway-runtime.test.ts --no-file-parallelism --reporter=dot` 通过 `3 files / 49 tests`，覆盖 exact Adapter Attempt Query、未登记 ID、错误类型/Scope、缺失/非成功 authority、正式绑定和拒绝后的业务状态边界。新鲜 `pnpm clean && pnpm verify` 通过 Format、Lint、Typecheck、全量 Vitest `42 files passed / 30 skipped`（`450 passed / 300 skipped`）、Architecture、Contract/Catalog `201/201 FULL`、compatibility baseline 200 operations，以及 PostgreSQL/Flyway Gate `34 files / 315 tests`。Gate 先迁移到 V6002 并注入历史 unsafe Receipt/Observation，再应用 V6003/V6004；两表 readback、canonical Observation hash、owner direct-write 与 caller-declared `*Hash` rejection、二次 migrate `Schema "public" is up to date. No migration necessary.`、tag→digest 和容器清理均通过。PR #147 的 exact Head CI `33477404474` 已成功，PR 已合并且 Issue #24 已关闭。该证据是本地、受控 Runtime 和 disposable PostgreSQL 技术证据，不替代真实 Provider、公开 HTTP、生产、统一跨模块业务 E2E 或独立人工验收；#23/#24 的真实 Provider/Feishu 验收仍为 `NOT RUN`。

## 13. IM-05 WI-08 合成 REL-801 退出复核边界

WI-08 不新增 ReleasePublication Contract、业务表或 Migration；它复用 V6001/V6002 和已验证的 Release Authority Query Port，整理 Release Readiness、frozen Package、Human Authorization、两 Destination Attempt/Receipt/Failure/Partial/Completion/Recall 的 exact ref/hash/history。`tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 提供固定的受控迟到回执时间线；WI-07 PostgreSQL Handler 主流程提供完整授权、失败重试、Formal Receipt、final completion 与 Recall 事实。

报告模式只输出合成技术事实，不连接真实 Feishu/email/对象存储/Provider，也不将 `messageId`、PII、token 或原始 Provider 结果当作 Formal Receipt 依据。统一 Quality→Renderer→Release 编排器、公开 HTTP、生产数据库、真实外部收件人、部署后验证和独立人工业务验收继续为 `NOT RUN`。

2026-08-31 GitHub 交付状态：WI-08 报告与测试变化已随 [PR #139](https://github.com/qzhike/zhiju-business-core/pull/139) 合入 `main`；最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 的 GitHub Actions `verify` run `33355948473` 通过，merge commit 为 `07fc6a083897c01924f842d12dffe06fd6068261`，Issue #128 已关闭。真实 Provider、公开 HTTP、生产和独立人工验收仍为 `NOT RUN`。

## 14. D12 / Q11 项目交付批次与受控导出提案（#260）

状态：`T2 / DESIGN APPROVED / INDEPENDENT DESIGN REVIEW PASSED / HUMAN DESIGN APPROVED / §14.2 封闭类型与 §14.4 Hash 域已注册并实现（#272）/ 8 个公开操作 NOT REGISTERED / 运行链路 NOT IMPLEMENTED`。目标、所有权选择与跨模块 trace 见 [Spec Delta](../decisions/project-delivery-controlled-export.md)。本节只定义拟增量，不改 §2–§12 现行 Release/Package/授权/PublicationReceipt/Completion，不使依赖实现 READY。

### 14.1 单文件授权链与批次边界

拟 ProjectDeliveryBatch 由 ReleasePublication 拥有，保存一次 HUMAN 明确确认的同 Project 文件集合；确认后内容不可变，包生成/下载请求和观察为独立 append-only 事实。Batch 不是 Release、DeliveryPlan 或 BFF Aggregate，不接受调用者完成状态。

每个 entry 必须引用独立、已提交的 CONTROLLED_EXPORT Release、唯一旧 ReleasePackageRef、同 Revision 的 FULLY_APPROVED ABS、当前 RRS 和 ReleaseAuthorization。各 Release 按原 DRAFT → PREPARED → validate_readiness → HUMAN authorize 顺序完成；未授权项不可确认，Batch 不替它调用批准或授权。原子确认只写本模块 Batch；其他模块只经独立受权 owning Query/Port读取，不能读他方 Repository/Schema。

拟版本化受控导出 Profile 明确允许对指定 HUMAN 下载人导出这组接收范围的内容，保留 QualityProfile 中适用的客户/传播限制和 mandatory Release Gate。每份 Package 的 recipientScopeSnapshotRef、Destination/DeliveryPolicy 必须与 Batch 配置精确一致；Destination 为受控导出 opaque 目标，不是任意 URL。Policy 仍要求未满足的客户批准/正式回执才能导出则拒绝；客户端不能声明豁免。Package 的 requiredReceiptKind/required 字段原样保留，下载观察不满足旧 complete_release 所需 Formal Receipt，也不将旧 Release 推进 RELEASED/PARTIALLY_RELEASED。

### 14.2 拟闭合类型与完整引用

以下 Ref 均沿用 Common 的完整引用结构，不能以 digest、UUID 或标题代替：Project/Artifact/Release 用 OBJECT；Revision/ReleaseAuthorization 用 CONTENT_ADDRESSED；DeliveryPlan/QualityProfile/Policy 用 VERSIONED；RAS/ABS/RRS/RecipientScope 用 SNAPSHOT；RepresentationRef 和 ReleasePackageRef 沿用原完整复合结构。所有 Project-owned Ref 必须同 enterpriseId + projectId；Enterprise-owned Profile/Policy 只有 enterpriseId，平台配置采用其合法 Scope，不能硬填 projectId。

```text
ProjectDeliveryEntry
  artifactRef, revisionRef, representationRef
  deliveryItemIds: NonEmptySet<UuidV7>
  associationProofHash: PayloadHash
  chapterBindings: NonEmptySet<{chapterCode: NamespaceCode, ordinal: NonNegativeInt}>
  provenance: {revisionProvenance: RevisionProvenance,
               sourceReportRefs: SnapshotRef<AcceptedAnalysisReport>[]}
  qualityProfileRef, revisionAcceptanceSnapshotRef, approvalBundleSnapshotRef
  releaseRef, releasePackageRef, releaseReadinessSnapshotRef, releaseAuthorizationRef
  archivePath: NonEmptyString

ProjectDeliveryManifest
  manifestVersion = project-delivery-batch-manifest/1.0
  batchRef: ObjectRef<release.project_delivery_batch>
  projectRef, deliveryPlanRef
  recipientScopeSnapshotRef, destinations: NonEmptySet<ReleaseDestinationDefinition>
  exportPolicyRef: VersionedRef<Policy>
  dependencyProof: {ruleRefs: NonEmptySet<VersionedRef<Policy>>,
                    requiredItemIds: Set<UuidV7>, coveredItemIds: Set<UuidV7>,
                    associationSetHash: PayloadHash, requirementSetHash: PayloadHash}
  entries: NonEmptySet<ProjectDeliveryEntry>

ProjectDeliveryBatchRef
  kind = CONTENT_ADDRESSED; objectType = release.project_delivery_batch
  objectId, scope, contentHash = batchManifestHash

ProjectDeliveryBatchView
  batchRef: ProjectDeliveryBatchRef; manifest: ProjectDeliveryManifest
  status = CONFIRMED; confirmedAt: UtcInstant
  confirmingActorSnapshotRef, confirmingAuthorizationDecisionRef, confirmationReceiptRef
  generationRequestRefs: ObjectRef<release.project_delivery_package_request>[]
  currentUse: {status: USABLE | BLOCKED | UNKNOWN, reasonCodes: ReasonCode[],
               checkedAt: UtcInstant, sourceWatermarks: SourceWatermark[]}

ProjectDeliveryArchiveRef
  kind = CONTENT_ADDRESSED; objectType = release.project_delivery_archive
  objectId, scope, contentHash = archiveDescriptorHash

ProjectDeliveryArchiveDescriptor
  descriptorVersion = project-delivery-archive/1.0
  archiveRef: ObjectRef<release.project_delivery_archive>; batchRef: ProjectDeliveryBatchRef
  batchManifestHash, manifestMarkdownChecksum, zipChecksum: ContentHash
  entryChecksums: NonEmptySet<{archivePath: NonEmptyString, checksum: ContentHash}>
  zipByteSize: NonNegativeInt; mediaType = application/zip
  objectRef: ObjectLocator; storageVersion: NonEmptyString
  archiveProfileVersion = project-delivery-zip/1.0
  validationFactRef: ContentAddressedRef<release.project_delivery_archive_validation>
  linkedAt: UtcInstant; availableAt: UtcInstant

ProjectDeliveryArchiveValidation
  attemptRef: ObjectRef<release.project_delivery_export_attempt>
  batchRef: ProjectDeliveryBatchRef
  objectRef: ObjectLocator; storageVersion: NonEmptyString
  archiveProfileVersion, entryChecksums, manifestMarkdownChecksum, zipChecksum, zipByteSize
  outcome = VERIFIED; validatorVersion: NonEmptyString; validatedAt: UtcInstant
```

批次 OBJECT target 与返回 CONTENT_ADDRESSED batchRef 的 type/id/Scope 必须相等；archiveDescriptor 同样使用 OBJECT identity，不能把自身 CONTENT_ADDRESSED ref/hash放入 Hash 输入。确认 Actor/Decision/Receipt 是归因，不重复塞入 Manifest；正常过期的历史命令 Decision 不改写确认事实，新的当前读取/下载必须另有有效 Decision。

associationProofHash由REL对受权ART/EP实际结果计算：SHA-256(cv1({artifactRef,revisionRef,revisionProvenance,deliveryItemRefs,epAssociationSetHash}))，deliveryItemRefs为ART真实完整关联中本Plan适用集合，epAssociationSetHash为EP D12 VERIFY对此exact集合返回的associationSetHash，不能用ENUMERATE的pageAssociationHash；不得信任客户端声明。dependencyProof.ruleRefs只容纳真实Policy版本（含PlanQualityPolicy与exportPolicy），不把QualityProfile伪装成Policy；requirementSetHash覆盖这些Policy及各entry.qualityProfileRef解析出的完整交付配套规则，associationSetHash覆盖本批所用EP关联与各entry.associationProofHash。依赖证明的Hash均不含自身Hash/观测时间。

ArchiveValidation Hash只覆盖上述完整校验payload，不含自身Ref/Hash或最终Descriptor；entry/checksum/大小字段类型与Descriptor相同。因此依赖图为Manifest →清单/文件bytes→ZIP→Validation→Descriptor，不能让Validation反向引用待生成的Descriptor Hash。exportPolicyRef须解析为明确允许本首版导出的真实版本，且与所有Destination.deliveryPolicyRef一致；未有受审查受控导出配置、不能解析Policy或目标不绑定指定Human/接收范围则阻断，不能由fixture或浏览器默认值填补。

每个 Artifact 恰有一个 entry/Revision/Markdown；shared Artifact 的 deliveryItemIds 合并，集合重复拒绝。章节来自 EP exact 关联证明，不用 Runner report 字段、文件名或原型章节推断；chapterBindings 只分组展示，不能增加副本或分母。provenance 从 ART immutable Revision 与 EP 关联读回：有 workOrderRef/runRef/agentResultRef/sourceReportRef 时保存完整 Ref；sourceReportRefs仅接受EP owning已接纳的精确报告Snapshot，D14来源的拟objectType为zhiju.project.preparation_report，须实际注册/可解析才可消费；不把原始Runner JSON Hash当报告Ref。HUMAN-only来源可无执行轮次/报告，以空report数组表达无报告而不造Run；其他来源无报告也不能伪造。轮次不进入包拆分规则。首版安全路径按 Artifact UUID + Revision UUID 派生为 files/<artifactId>/<revisionId>.md；禁止绝对路径、..、重复路径、symlink、任意附件和以客户文件名替代身份。

### 14.3 选择 Query 与确认判据

拟项目候选 Query 仅需projectRef + exact ACTIVE deliveryPlanRef、filters与PageRequest，不要求调用方先知道Artifact refs。合法发现链如下，各模块只读自己的Repository或受权owning Query/Port：

1. EP ProjectDeliveryAssociationPort的ENUMERATE分支返回当前计划的可读Item/章节/配套映射及共享Page；EP不返回文件identity。依nextCursor续页，所需依赖从真实ItemRef解析；读切面或Plan变化拒绝，不能拿一页当整个计划。
2. ART [ProjectDeliveryArtifactDiscoveryPort](Module-Spec-004-Artifact.md#项目候选的只读发现来源)按Project分页发现ArtifactView及精确Markdown登记View。REL以get_artifact实际deliveryItemRefs与EP枚举的Plan Item身份匹配，并由EP VERIFY验证适用exact关联；同ID而版本/Hash不同阻断，不替换Ref。某实际关联是否适用本Plan无法证明、或所需关联/依赖不可读时该候选BLOCKED/UNKNOWN，不以可见子集宣称完整。发现页与当前get_artifact.aggregateVersion/登记事实不一致则STALE，不消费过时索引。无Release的获批成果也须进入此链，不能仅枚举REL已有Release或接受客户端任意清单补足文件来源。
3. 对实际approvedRevisionRefs逐个读取get_revision_snapshot/provenance及QG D12当前Proof；Markdown refs来自ART发现结果，再经get_representation逐项权威重验。REL按精确Artifact/Revision在自有Release/Package事实中关联逐文件CONTROLLED_EXPORT及RRS/授权；无该Release仍显示可读文件、已知exact批准版本与等待发布授权原因，不伪造Package/RRS/AUTH。缺RAS/ABS/Markdown等也只返回真实已知字段及等待原因，Query不自动render/prepare/authorize。
4. 多个仍可用获批版本逐个显式列出，默认不选；每个Artifact最多选一个，不暗用最大revisionNumber。ART共享文件只发现一次，REL合并同Plan的实际Item/章节关联；跨轮次不拆查询或复制文件。候选条目的artifactRef必填，其余exact entry字段仅在真实可解析时提供，未知Ref省略，不把未就绪候选假充完整ProjectDeliveryEntry。`eligibility=INTERNALLY_APPROVED|EXPORT_ELIGIBLE|BLOCKED|UNKNOWN`及安全reasonCodes、checkedAt/sourceWatermarks按当前证明返回；只有EXPORT_ELIGIBLE可确认。

REL返回共享Page<候选条目>并拥有自己的opaque cursor，不能把内部EP/ART的cursor直接当外层续页。外层游标按共享规则绑定Query版本、Project Scope、requester/purpose、exact Plan、规范化filters、稳定Artifact/Revision位置、内部续页位置与各Owner实际观测的水位/读切面；技术续页状态须有有限预算，不形成业务Aggregate。EP/ART页边界不等于候选页边界，多个版本/共享文件经过稳定排序后不得漏项或跨页重复。内部空页有nextCursor继续，外层空页有nextCursor也不表示项目无成果；仅当前授权扫描结束才省略nextCursor，不能泄漏隐藏名称/数量。Scope/Plan/筛选/权限或源读切面变化时安全拒绝旧cursor并要求从首请求刷新，不拼接不一致页面，不改既有选择或Batch。

核对 Query 输入为 projectRef、deliveryPlanRef、接收/目标/Policy 配置与显式 exact entry 集合，输出 `{selectionHash, dependencyProof, entries, eligible, reasonCodes, checkedAt, sourceWatermarks}`。selectionHash 覆盖上述 manifestVersion/项目/计划/接收/目标/Policy/依赖/entry 的规范化语义字段，但不含尚未分配的 batchRef、自身 Hash、checkedAt、水位时刻或当前展示状态；所有实际关联证明和精确 Quality/Release refs 均参与。Query 是纯读取，selectionHash 是观测证据而非已提交 SnapshotRef。

核对/确认须对ART实际关联与全部所需配套闭包执行EP VERIFY，要求返回集合与请求exact集合一致；逐文件证明和完整依赖证明消费该分支的associationSetHash。枚举的pageAssociationHash、最后页或空页不能证明完整闭包；枚举仅提供真实Ref来源。Guard超限或隐藏/失效的required关联不能通过分批验证、忽略空页或省略条目放宽确认条件。

确认以预分配 Batch UUID、原 idempotency key、expectedSelectionHash 和全部 exact 输入提交；服务端重新证明当次 HUMAN/Scope/purpose/payload，重读同一集合并比较 selectionHash。逐项 ART ACTIVE/可读内容/Representation、RAS/ABS current eligibility、独立角色、RRS requireCurrentForAuthorization=true、Release AUTHORIZED/未 Recall/授权仍可用、EP ACTIVE Plan/关联/依赖及每个 Hash 全部成立才生成 Manifest。新 Snapshot 即使 READY 也不能静默替换传入 ref。所有强制交付配套传递闭合且各项 EXPORT_ELIGIBLE；execution-only/optional 依赖按已版本化规则区分，无法分类则阻断。首版不接受先前包/下载作为配套替代，不要求无关项目项完成。

本模块事务只提交一次 immutable Manifest/Batch、归因、Command Receipt、Audit、Reference Edge；一项失败则无新 Batch。上游 Query 观测分别保存 checkedAt/sourceWatermarks，不声称跨模块全局事务；确认前重观测指纹，变化即拒绝。确认后每个新副作用边界再次观测；迟到失效只追加影响/阻断，不重写历史或撤回已传输数据。

### 14.4 Hash 域与固定 ZIP

所有 JSON Hash 用 shared-kernel canonicalize（canonicalizationVersion=1）后 SHA-256；字符串/集合顺序使用 UTF-8 字节序，不使用 localeCompare。entries 按 archivePath；deliveryItemIds、chapterBindings、report refs、ruleRefs、dependency IDs 与 entryChecksums 各按完整 canonical identity 排序；destinations 沿旧 destinationId 排序。重复 identity/path 拒绝，不能用排序隐式消重。

| Hash | 唯一输入 | 排除项 |
|---|---|---|
| 旧 packageHash / packagePayloadHash | §11.2 原 manifest / 完整旧 PackageDefinition | Batch、ZIP、下载事实不能进入旧域 |
| batchManifestHash | 完整 ProjectDeliveryManifest（包含 OBJECT batchRef） | 自身 CONTENT_ADDRESSED Ref/Hash、确认时间/Actor、生成/下载事实、URL |
| Manifest Markdown checksum | 从固定 Manifest 派生的 UTF-8 清单 bytes；清单可显示 batchManifestHash | 清单自身 checksum、ZIP checksum、Descriptor、下载观察不能反向写入清单 |
| 文件 checksum | 已登记 Markdown Representation 原始 bytes | Canonical Revision Hash不能代替；不按新候选渲染或包装修改 |
| zipChecksum | 固定 ZIP 完整 bytes | 归档自身 Hash/Descriptor、下载时刻不能写入 ZIP |
| archiveDescriptorHash | 完整 ProjectDeliveryArchiveDescriptor | 自身 CONTENT_ADDRESSED archiveRef/Hash、短期许可/URL、下载观察 |

拟 project-delivery-zip/1.0：UTF-8 路径排序、store-only ZIP、固定 1980-01-01 ZIP timestamp、固定权限、无 extra/comment；不支持ZIP64，entry数量/大小/累计大小超非ZIP64表示范围或部署已批准的更小预算则拒绝。唯一额外 entry 为 manifest.md，其行尾 LF、UTF-8 无 BOM，列名/转义/输出顺序由该版本化清单模板固定。文件 bytes 原样保存；ZIP 外 Descriptor 保存 zipChecksum，杜绝 ZIP 自 Hash 环。源 checksum、清单完整列与 entry 路径集合/数量/大小/CRC 必须全部复验，不能只校验 ZIP magic。首次 AVAILABLE 后再次下载原对象/version；新 renderer/bytes/路径/refs 必须新批次，不覆盖原归档。

### 14.5 导出请求、Staging/Link 与 UNKNOWN

拟 PackageRequest 为独立 CREATE target，closed业务intent `{batchRef, archiveProfileVersion}`，保存original key/payloadHash/Receipt；请求主体/ActorSnapshot/AuthorizationDecision从当次trusted Envelope取得并单独永久归因，不由caller填入业务intent。Server控制Attempt identity、lease/fence与时间；可读View返回 `{requestRef,batchRef,status,attemptRefs,archiveRef?,reasonCodes}`，status为REQUESTED/BUILDING/LINKED/AVAILABLE/FAILED/UNKNOWN，AVAILABLE才有可下载archiveRef。

export Attempt为REL拥有的技术执行事实，绑定requestRef/batchRef/archiveProfileVersion，稳定key域为完整Project Scope + batchManifestHash + archiveProfileVersion；attemptNumber/lease/fencingToken由服务器控制，immutable身份与append-only观察分离。原UNKNOWN先reconcile同Attempt，只有可证明原Attempt终结/无待确认副作用且同固定输入仍合法才显式后继Attempt；不能在未知副作用下换identity。IG/存储Adapter不拥有Batch状态，也不能以其通用Attempt替代本REL绑定。

1. CREATE 事务仅保存原请求/Receipt/Audit/已提交工作意图，提交后技术 Worker 才处理；同 batch/profile 同时生成只允许一个活跃归档 identity，其他合法请求引用既有结果，不创建不同 ZIP。
2. Worker 重验当前资格并从 ART 受权精确 bytes Port读取。Staging 上传/权威 readback 验证在数据库事务外；对象 locator由已提交 Attempt 派生，不信客户端路径/metadata/checksum。
3. Link Commit 在本模块事务内保存 immutable 校验事实、Descriptor 的冻结输入及对象关联，推进 LINKED；外部 finalize 成功、原 storage version readback、再次资格重验后才以 CAS/fence 发布 immutable 最终 Descriptor 与 AVAILABLE。失败不能留下可下载引用。
4. DB rollback 后对象成为可审计 orphan；无 committed reverse Link/retention/legal hold 才按既有受控清理 Policy 处理。finalize timeout 保持 UNKNOWN 与原 Link，重读同 Attempt/object，不猜成功或直接删有 Link 的对象。
5. FAILED/UNKNOWN 恢复只继续原 batch/profile/Attempt 输入；已可验证对象复用，lease/fence 过期 Worker不能发布 AVAILABLE。原请求重放返回原事实，当前资格不足只阻断新副作用，不能自动换 revision/新请求。原 manifest不可用需 HUMAN重新选择新 Batch。

### 14.6 受权下载与观察

拟 DownloadRequest 为独立CREATE target，closed业务intent `{batchRef,archiveRef}`，当前trusted Envelope的HUMAN/ActorSnapshot/AuthorizationDecision另存为原请求归因。服务器在当前HUMAN/Project/逐文件资格通过后保存request/Receipt/Audit，生成仅用于该请求的短期opaque流许可；许可绑定原request的principal、当次Session、batchManifestHash、archiveDescriptorHash、zipChecksum与exact Scope，返回安全transport投影 `{requestRef,batchRef,archiveRef,opaqueToken,expiresAt}`。Token不进入业务持久事实。expiry为Session/当次Decision/签发后5分钟最早者；实际流预算还须在受审查transport配置中显式给出，无配置则不可用，不选择默认公网对象URL。

不提供绕过 Core 的可直接访问对象存储 URL；技术流入口无业务 route 在本提案注册，必须消费该许可且流前重验权利、资格、Hash/version。BFF仅传流和 backpressure，无 Ceph client/业务 ZIP。许可重放不产生另一个下载事实；重复主动下载用新的 request UUID/key，短期链接不得缓存、写公开 Event/错误/日志、发给其他主体。过期后允许当前仍有权的 Human 新请求同一 archive；新认证不改变原批次或历史 Actor。

每个请求的 append-only ResponseObservation 精确绑定 requestRef/batchRef/archiveRef/principal/Scope/streamAttemptId，字段为 `{outcome: STARTED|RESPONSE_SENT|FAILED|UNKNOWN, bytesWritten: NonNegativeInt, expectedBytes: NonNegativeInt, observedAt: UtcInstant, reasonCodes: ReasonCode[]}`。RESPONSE_SENT 仅当本服务器实际写完该 exact ZIP 且长度匹配，并成功持久化观察；这不是本地文件保存或外部 Receipt。断线/日志写入失败只能留 FAILED/UNKNOWN/已有 STARTED，不伪造发送成功；多次连接使用独立 streamAttemptId，不能合计 Range/部分响应充当成功。首版不支持 Range/resume。

流前撤权拒绝零 bytes；已开始流出现明确撤权/失效时停止后续服务并保存可证明字节，无法撤回此前已复制数据。不得承诺撤权与跨模块读取的全局原子性；每次新许可/流均重验，服务器可见的撤销须 fail-closed。历史 AUTHORIZE Decision 的正常到期仅约束原命令时点；已提交 ReleaseAuthorization 保留历史，但 Recall/授权撤销/上游失效使新消费不可用，下载另需当前 Decision，不复用原授权当长期访问票据。

### 14.7 拟 owning 操作、目的与恢复

下列只是 additive 候选名，均未注册；公开 HTTP/stream route 另受审查，不创建 BFF 私有 Command。操作使用共享 Envelope/CommandResult；CREATE target预分配 UUID，稳定 key为 operation:version:targetUuid；payloadHash保持原意图。

| 候选 @1.0 | kind / Owner | purpose | Payload / 返回 |
|---|---|---|---|
| release.find_project_delivery_candidates | A Query / ReleasePublication | release.project_delivery.read | projectRef, deliveryPlanRef, filters, PageRequest → Page<候选条目> |
| release.inspect_project_delivery_selection | A Query / ReleasePublication | release.project_delivery.read | §14.3 exact集合/配置 → selection observation |
| release.confirm_project_delivery_batch | CREATE / ReleasePublication | release.project_delivery.confirm（HUMAN_ONLY） | §14.3集合/配置/expectedSelectionHash → batchRef；Actor/Decision由trusted Envelope归因 |
| release.get_project_delivery_batch | A Query / ReleasePublication | release.project_delivery.read | exact batchRef → ProjectDeliveryBatchView |
| release.request_project_delivery_package | CREATE / ReleasePublication | release.project_delivery.package.create | §14.5 intent → requestRef/status |
| release.get_project_delivery_package_request | A Query / ReleasePublication | release.project_delivery.read | exact requestRef → §14.5 View及可用Descriptor |
| release.request_project_delivery_download | CREATE / ReleasePublication | release.project_delivery.download（HUMAN_ONLY） | §14.6 intent → requestRef；短期流许可只在安全 transport 返回 |
| release.get_project_delivery_download_request | A Query / ReleasePublication | release.project_delivery.read | exact requestRef → 原intent与ResponseObservation[]安全投影 |

查询/确认/请求/Worker/流分别证明当前权限；Package Worker仅受信固定技术SERVICE，不能作Human Approval/Release Authorization/批次确认或下载人。相同key同业务payload在当前读取权限下返回原提交结果，异payload为IDEMPOTENCY_PAYLOAD_CONFLICT；未知CREATE回读原target/key与Command Receipt，NOT_FOUND不证明先前无执行，原键可在许可条件下重放，不能自动新建意图。重认证只能为同一原请求主体提供新Envelope授权，不改target/key/业务payloadHash、Manifest或首次提交Actor/Decision；若原请求已提交，只读其历史Receipt并另验当前使用资格，不重复业务提交。DownloadRequest重放只返回原请求/观察，不续签已过期或丢失Token；仍有权时由Human明确新建下载请求，不能把恢复读取变成下载副作用。

拟稳定拒绝：PROJECT_DELIVERY_SELECTION_STALE、PROJECT_DELIVERY_COMPANION_MISSING、PROJECT_DELIVERY_NOT_ELIGIBLE、PROJECT_DELIVERY_HASH_MISMATCH、PROJECT_DELIVERY_PACKAGE_UNAVAILABLE、PROJECT_DELIVERY_DOWNLOAD_EXPIRED；Scope/无权安全折叠沿共享 Contract，不回显隐藏项或 Provider 诊断。它们也是提案，不视为已注册错误。

CONFIRMED/AVAILABLE 只标各自已完成事实；新候选仅刷新准备页。现行引用撤销/计划替代时追加 BLOCKED observation；复用不能换引用，同 Hash当前仍可用才能继续。所有边界失败均保留旧 Batch/Package/ResponseObservation，与 Task/Run/个人草稿隔离；不新增 sent/received/accepted/completed flag、PublicationSucceeded/ReleaseCompleted Event 或 Completion 事实。

### 14.8 #272 已注册的封闭类型、结构校验与 Hash 域

状态：`T2 / 封闭类型与 Hash 域已注册并实现 / 8 个公开操作 NOT REGISTERED / 运行链路 NOT IMPLEMENTED / 真实材料与外部边界 NOT RUN / ISSUE #272 CLOSED / PR #276 MERGED main@dfce224d16db24e9823ce52b4ce1e6dbcb21fde9`。Issue #272 只实现 §14.2 的封闭类型、§14.4 的分域 Hash 与纯结构校验；不注册任何公开 operation、不新增 HTTP/stream route、不写业务事实，也不因此产生 Batch、Snapshot、Receipt、eligibility、AUTHORIZED/AVAILABLE 状态、FormalReceipt、EffectiveBinding 或 Completion。§14.5–§14.7 的请求/生成/下载链路继续未实现。

已注册类型（Owner ReleasePublication，closed `$defs`，均带完整 Project Scope；定义于 `contracts/src/operations/release-publication.schema.ts`，生成类型见 `contracts/src/generated/types/release-publication.ts`）：`ProjectDeliveryEntry`、`ProjectDeliveryManifest`、`ProjectDeliveryBatchRef`/`ProjectDeliveryBatchView`、`ProjectDeliveryArchiveRef`/`ProjectDeliveryArchiveDescriptor`/`ProjectDeliveryArchiveValidation`，以及辅助闭合类型 `ProjectDeliveryChapterBinding`、`ProjectDeliveryEntryChecksum`、`ProjectDeliveryProvenance`、`ProjectDeliveryDependencyProof`、`ProjectDeliveryCurrentUse` 与 `manifestVersion`/`descriptorVersion`/`archiveProfileVersion`/`mediaType` 常量、`status`/`currentUse.status`/`outcome` 闭集。Entry/Manifest 内的既有引用继续复用 `Common` 的 `objectRef`/`versionedRef`/`contentAddressedRef`/`snapshotRef`/`representationRef`/`releasePackageRef`，并按各 Owner 的注册拼写与合法 Scope 收窄：Project-owned 引用要求 `enterpriseId`+`projectId`（`zhiju.project.project`、`zhiju.project.delivery_plan`、`artifact.artifact`、`artifact.artifact_revision`、`release.release`、`release.release_package`、`quality.revision_acceptance_snapshot`、`quality.approval_bundle_snapshot`、`quality.release_readiness_snapshot`、`release.release_authorization`）；`quality.quality_profile` 与 `zhiju.identity.policy` 使用各自的企业 Scope（前者禁止 `projectId`，后者保留可选 `projectId`）。`ProjectDeliveryProvenance.revisionProvenance` 直接 `$ref` Artifact 已注册的 `revisionProvenance`（跨模块引用，生成类型为 `Artifact.RevisionProvenance`），不复制其十一个字段。`recipientScopeSnapshotRef` 固定引用种类与完整 Project Scope，其 `objectType` 在仓库内存在两个竞争拼写且无注册 `const`，仍留给 owning 解析；`sourceReportRefs` 的 D14 已接纳报告 `objectType` 也仍只是提案，须实际注册后才可消费，但已声明的报告 Snapshot 必须是完整 Project Scope；合法空集合不因此被阻断，也不伪造 Run/报告引用。

已实现的 Hash 域（`modules/release-publication/src/project-delivery-hash.ts`）：`batchManifestHash`（完整 Manifest 含 OBJECT `batchRef`，cv1 SHA-256）、`archiveValidationHash`（完整校验 payload，不含自身 CONTENT_ADDRESSED 身份与最终 Descriptor）、`archiveDescriptorHash`（完整 Descriptor，`archiveRef` 保持 OBJECT 身份）、以及 `projectDeliveryBytesChecksum` 覆盖清单 Markdown bytes、每份 Markdown 表示原始 bytes 与固定 ZIP bytes。集合按 §14.4 的稳定 UTF-8 语义序（entries 按 `archivePath`，`deliveryItemIds`/`chapterBindings`/report refs/`ruleRefs`/dependency IDs/`entryChecksums` 按完整 canonical identity，destinations 按 `destinationId`）规范化，重复 identity/path 显式拒绝而不靠排序消重。`sameContentAddressedIdentity` 比较完整 CONTENT_ADDRESSED 身份（kind/objectType/objectId/完整 Scope/`contentHash` 全部成员/出现的 `immutableVersionId`），因此同一 Revision identity 下两份不同内容声明不会被视为一致。§11.2 的旧 `packageHash`/`packagePayloadHash` 域不变，批次/归档域也不吸收旧域。

已实现的结构校验（`modules/release-publication/src/project-delivery-validation.ts`，本地稳定码 `PROJECT_DELIVERY_MANIFEST_INVALID`、`PROJECT_DELIVERY_ARCHIVE_INVALID`、`PROJECT_DELIVERY_HASH_MISMATCH`，它们是纯校验函数的本地码，不是已注册 operation 错误）：单 Project 与精确 Plan、Manifest/Entry 内所有 Project-owned 引用必须同 `enterpriseId`+`projectId`（按 registered owning objectType 判定）、Enterprise-owned Profile/Policy 不伪造 Project Scope、每个 Artifact 恰一个 entry、`deliveryItemIds`/`chapterBindings`/report refs/`ruleRefs` 等声明身份集不得重复、`archivePath` 必须由 Artifact UUID + Revision UUID 派生且唯一安全、Representation 必须是该 entry 的 Markdown 表示（`document.markdown` + `text/markdown`）且与 `revisionRef` 完整 exact（含 `contentHash`/`immutableVersionId`）、Package 必须属于该 entry 的 Release、依赖证明只含真实 Policy 版本且包含 `exportPolicyRef`、`requiredItemIds ⊆ coveredItemIds`、entry 的 DeliveryItem 全部被覆盖、Destination 的 `deliveryPolicyRef` 与 `exportPolicyRef` 完全一致，以及材料齐备时的 OBJECT 目标与 CONTENT_ADDRESSED 身份、两处 BatchRef 与 `descriptor.batchManifestHash` 均绑定本次 Manifest 完整 Hash、Manifest/Descriptor/Validation Hash、entry 路径与 checksum、清单 Markdown/ZIP bytes 的 checksum 与字节长度绑定和跨域互异。来源引用按 owning 类型区分：Task、WorkOrder、Run、AgentResult、ContextSnapshot 与 project source material 等 Project-owned 执行来源必须携带完整 Project Scope 且等于本批 Enterprise/Project（缺成员或空 Scope 均拒绝），判定表按 owning 语义完整覆盖各对象的现行与历史接受身份——既包括 registry namespace 形式与 owning 公开 Contract 实际使用的形式（例如 `execution.record_run_result@1.0` 的 `execution.run` / `execution.agent_result`、IntegrationGateway 引用的 `execution.task` / `execution.work_order`），也包括 `RevisionProvenance.contextSnapshotRef` 的 `SnapshotRef<ProjectContext>` 历史读回身份 `zhiju.project.context_snapshot`（Core v1.0 历史 fixture 值，不得仅凭 `objectId` 改写为 canonical `zhiju.execution.context_snapshot`）；Identity-owned principal 与合法 Enterprise/Platform 配置（例如 template baseline、regulatory profile）只要求已声明的 Scope 成员与本批一致，不强行补 `projectId`；EnterpriseProject-owned 已接纳报告 Snapshot 必须是完整 Project Scope；Profile 与 Policy 引用的 `enterpriseId` 必须等于本批 Enterprise，Policy 携带 `projectId` 时须等于本批 Project。

封闭 Schema 同步收紧（`contracts/src/operations/release-publication.schema.ts`）：D12 Representation 固定 `format=document.markdown`、`mediaType=text/markdown`（不支持 DOCX/XLSX/PDF），`ProjectDeliveryProvenance` 依赖规则固定为已注册 `zhiju.identity.policy`（`ruleRefs` 不再沿用开放 objectType），`recipientScopeSnapshotRef` 固定必填 `enterpriseId`+`projectId`（`objectType` 仍留给 owning 解析）。Common 与旧 ReleasePackage 接受集不变。

可复现材料：`tests/fixtures/contracts/project-delivery/` 提供跨轮次三文件 Manifest（含共享 Item 合并与 Human-only provenance 的合法空集合）、集合重排后又一个 Manifest、绑定 Descriptor/Validation/清单 Markdown/ZIP bytes 的材料、旧单 Revision Package golden（保留其历史 DOCX 接受集），以及 schema/结构/材料三类反例集（36/48/21 项，含上述收紧边界、Project-owned 来源完整 Scope、registry/owning 公开拼写与历史 `zhiju.project.context_snapshot` 的缺成员/空 Scope、报告 wrong/missing Project 两类与仅重算外层 Hash 后的 Batch/大小绑定反例），以及 `provenance-source-spellings.json`（owning 公开拼写与历史 ProjectContext 身份正例，含经 `execution.record_run_result@1.0` 与 `execution.get_context_snapshot@1.0` 注册 Schema 校验的完整 Ref）；执行证据见 [Module-Test-006 D12 子用例](../module-tests/Module-Test-006-ReleasePublication.md#d12--q11-批次与受控下载设计场景260)。

仍未执行：8 个公开操作的注册与 Handler、ART/EP/QG 当前读取与 VERIFY 闭包、有限导出 Policy/Renderer profile、批次/Attempt/归档业务持久化与迁移、真实 ZIP/清单 Markdown 生产、对象存储与受控 stream transport、OIDC/公开 HTTP、UI/BFF、客户发送与人工验收；`vibe verify full` 的 PostgreSQL 门禁只证明既有仓库 Gate，不升级上述任何外部边界。
