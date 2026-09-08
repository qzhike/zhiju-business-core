> Historical record. Related Issue: [5](https://github.com/qzhike/zhiju-business-core/issues/5). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-01 ReleasePublication 25 操作字段级契约 - 实施计划

版本：v0.1
日期：2026-08-18
任务：完成 GitHub issue #5

## 1. 目标

把 `contracts/registry/public-api.v1.json` 中 release-publication 模块下的 25 个 ENVELOPE_ONLY 操作升级为 FULL，并提供：
- 12 个 Command Payload Schema
- 5 个 Query Payload Schema + 5 个 Query Result Schema
- 8 个 Event Payload Schema

覆盖的字段域：Release / ReleasePackage / RecipientScopeSnapshot / Destination / PublicationAttempt / Receipt / Recall / Readiness。

## 2. 核心不变量与负向约束

1. ReleaseDraftDefinition 绑定精确 Revision（ContentAddressedRef）+ ApprovalBundleSnapshot（SnapshotRef）+ QualityProfileRef（VersionedRef）+ RevisionAcceptanceSnapshotRef（SnapshotRef）。
2. Agent / actingFor 永远不能 Authorize / Recall — `authorizingHumanRef` 使用 `principalKind: const 'HUMAN'`。
3. PublicationAttemptDefinition 携带 stableIdempotencyKey，attemptNumber 唯一。
4. Raw Receipt 经 release/destination/package/attempt 验证才成为 FormalReceipt；不能携带 Secret / 临时 URL / 接收方明细 / 文件正文。
5. ReleaseStatus / PublicationOutcome / ReleasePurpose 用 Closed<...> enum。
6. 公开 Event 不得携带 Secret、临时签名 URL、接收方敏感明细、文件正文 — strict `additionalProperties: false`。
7. Package 是 ContentAddressed，release/destinationId 强制。

## 3. 公共类型与本地定义（命名规范）

参考 quality-governance 模式。命名以模块内 `$defs/<name>` 暴露；命名映射：

```
releaseDraftDefinition        -> ReleaseDraftDefinition
releaseRepresentationSelection -> ReleaseRepresentationSelection
releaseDestinationDefinition  -> ReleaseDestinationDefinition
releasePackageDefinition      -> ReleasePackageDefinition
publicationAttemptDefinition  -> PublicationAttemptDefinition
formalReceiptSubmission       -> FormalReceiptSubmission
publicationFailureSubmission  -> PublicationFailureSubmission

releaseView                   -> ReleaseView
frozenPackageView             -> FrozenPackageView
publicationAttemptView        -> PublicationAttemptView
releaseImpactView             -> ReleaseImpactView
```

Enum：
- releasePurpose: CUSTOMER_DELIVERY | REGULATORY_SUBMISSION | INTERNAL_EFFECTIVE_USE | FEISHU_PUBLICATION | CONTROLLED_EXPORT
- releaseStatus: DRAFT | PREPARED | VALIDATING | AUTHORIZED | PUBLISHING | RELEASED | PARTIALLY_RELEASED | FAILED | CANCELLED | RECALLED | SUPERSEDED
- publicationOutcome: PENDING | SUCCEEDED | FAILED | UNKNOWN
- publicationFailureOutcome: FAILED | UNKNOWN
- frozenPackageView / releaseView / publicationAttemptView 内部字段使用上面 enums

## 4. OperationPayload 字段约束

### 4.1 Command Payload

| Operation | Required Payload Fields |
|---|---|
| create_release_draft | definition: ReleaseDraftDefinition |
| select_representations | selections: NonEmptySet<ReleaseRepresentationSelection>; selectionReason: Justification |
| set_destinations | destinations: NonEmptySet<ReleaseDestinationDefinition>; recipientScopeSnapshotRef: SnapshotRef<RecipientScope> |
| prepare_release | package: ReleasePackageDefinition; preparationValidationRef: ContentAddressedRef<ValidationResult> |
| validate_release_readiness | releaseReadinessSnapshotRef: SnapshotRef<ReleaseReadiness>; validatedPackageRef: ReleasePackageRef; validatedAt: UtcInstant |
| authorize_release | releaseReadinessSnapshotRef; authorizingHumanRef (principalKind=HUMAN); actorSnapshotRef; authorizationDecisionRef; authorizedAt |
| start_publication_attempt | attempt: PublicationAttemptDefinition |
| record_publication_receipt | receipt: FormalReceiptSubmission |
| record_publication_failure | failure: PublicationFailureSubmission |
| complete_release | completionPolicyRef; destinationOutcomeRefs: NonEmptySet<TypedReference>; evaluatedAt |
| recall_release | recallScope: CanonicalJson; recallReason: Justification; authorizingHumanRef (HUMAN); authorizationDecisionRef; notificationPolicyRef; recalledAt |
| cancel_release | cancelReason: Justification; cancelledAt |

### 4.2 Query Payload / Result

| Operation | Payload | Result |
|---|---|---|
| get_release | releaseRef: ObjectRef | ReleaseView |
| get_frozen_package | packageRef: ReleasePackageRef | FrozenPackageView |
| get_publication_attempts | releaseRef; destinationIds; outcomes (Set<PublicationOutcome>); page: PageRequest | Page<PublicationAttemptView> |
| get_release_receipts | releaseRef; packageRef?; destinationIds; page | Page<ContentAddressedRef<PublicationReceipt>> |
| get_release_impact | releaseRef; triggeringRef? | ReleaseImpactView |

### 4.3 Event Payload

| Event | Payload |
|---|---|
| ReleasePrepared | releaseRef; packageRef; revisionRef; approvalBundleSnapshotRef; destinationIds: NonEmptySet<UuidV7> |
| ReleaseAuthorized | releaseRef; packageRef; releaseReadinessSnapshotRef; authorizationRef; authorizedAt |
| PublicationAttemptRequested | releaseRef; packageRef; attemptRef; destinationId; externalDeliveryRequestRef |
| PublicationSucceeded | releaseRef; packageRef; attemptRef; destinationId; receiptRef; occurredAt |
| PublicationFailed | releaseRef; packageRef; attemptRef; destinationId; outcome: FAILED\|UNKNOWN; failureRef |
| ReleasePartiallyCompleted | releaseRef; packageRef; succeededDestinationIds; pendingOrFailedDestinationIds: NonEmptySet; evaluatedAt |
| ReleaseCompleted | releaseRef; packageRef; purpose: ReleasePurpose; revisionRef; receiptRefs: NonEmptySet; completedAt |
| ReleaseRecalled | releaseRef; packageRef; recallRef; affectedDestinationIds: NonEmptySet; recalledAt |

## 5. 修改清单

1. 新建 `contracts/src/operations/release-publication.schema.ts`
2. 新建 `contracts/src/operations/release-publication.schema.test.ts`
3. 修改 `contracts/src/operations/index.ts`：导入并导出新 schema，加入 `executableOperationSchemas`
4. 修改 `contracts/registry/public-api.v1.json`：25 个 release-publication 操作 schemaStatus → FULL
5. 修改 `contracts/src/registry.test.ts`：更新 FULL 数量断言（152 → 177）、新增 release-publication 模块分布断言、把 "does not claim executable result schemas for unfinished modules" 测试用例改成 integration-gateway
6. 新建 tests/fixtures/contracts/ 下 16 个 release-publication fixtures（覆盖成功/失败/UNKNOWN/Recall/Agent 拒绝/敏感字段拒绝等）
7. 更新 `.vibe/module-specs/Module-Spec-006-ReleasePublication.md` 状态为 FULL
8. 更新 `.vibe/module-tests/Module-Test-006-ReleasePublication.md` 状态与新增测试 ID
9. 更新 `.vibe/high-level-docs/HL-Spec.md` 中 IM-01 字段契约章节（如有）

## 6. 测试用例计划（release-publication.schema.test.ts）

- 注册 25 个 FULL release-publication 操作，kind 分布 Command=12, Query=5, Event=8
- 每个 Query 都有 resultSchemaRef
- 成功 CreateReleaseDraft / SelectRepresentations / SetDestinations / PrepareRelease / ValidateReadiness / AuthorizeRelease (Human) / StartPublicationAttempt / RecordPublicationReceipt (Succeeded) / RecordPublicationFailure (Failed) / CompleteRelease / RecallRelease / CancelRelease
- 成功 GetRelease / GetFrozenPackage / GetPublicationAttempts (Page) / GetReleaseReceipts (Page) / GetReleaseImpact
- 成功 8 个 Event payload
- 失败：AuthorizeRelease principalKind=AGENT 拒绝
- 失败：RecallRelease principalKind=AGENT 拒绝
- 失败：RecordPublicationFailure outcome=PENDING 拒绝（只允许 FAILED|UNKNOWN）
- 失败：ReleaseSucceeded 携带 rawReceiptSecret 拒绝（敏感字段）
- 失败：PublicationAttemptRequested 携带 presignedUrl 拒绝
- 失败：PublicationFailed outcome=PENDING 拒绝
- 失败：Unknown payload field 在 Event 中被拒（additionalProperties）
- 安全负向：RawReceipt 携带 recipientEmail 等敏感字段拒绝