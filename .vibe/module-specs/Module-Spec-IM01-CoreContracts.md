# Module-Spec-IM01-CoreContracts

版本：v0.1
日期：2026-08-17
状态：`CURRENT CORE CONTRACT FIELD-LEVEL SCHEMA BASELINE / IMPLEMENTATION VERIFIED`

## 1. 模块责任

本文件不是新业务模块，而是 `03-core-contracts.md` 四个 Core Contract 加上 Quality/Release 家族补充 Snapshot 的机器可执行字段级 Schema 的实现基准。它把 03 中的 IDL 落到 Ajv 2020 strict mode 编译通过的 JSON Schema，并约束六个 Core Contract 在顶级 `header` 之外的全部嵌套结构。

- 业务权威：`03-core-contracts.md`、`06-typed-references-contract-catalog-v0.1.md`、`API-Contract-v0.1.md §4`。
- 实现入口：`contracts/src/common.schema.ts`、`contracts/src/core.schema.ts`。
- 测试入口：`contracts/src/core.schema.test.ts` 与 `tests/fixtures/contracts/core/<contract>-valid.json`。

## 2. 共享值对象（统一从 common 引用）

本轮统一抽取并在 `common.schema.ts` 注册，避免六个 Core Contract 重复维护：

```text
EvidenceRef                  = Evidence contentAddressedRef + relation + targetClaimRef? + applicabilityScopeRef?
Justification                = reasonCode + summary + evidenceRefs + policyRef?
EffectivePeriod              = validFrom? + validTo?
SourceWatermark              = sourceModule + partition? + sequence + observedAt
Page<T>                      = items (open JSON) + nextCursor? + snapshotAt + sourceWatermarks
ValueEnvelope<T>             = presence + value (open JSON) + reasonCode? + evidenceRefs + lastVerifiedAt?
PrincipalRef                 = principalKind (closed) + principalId
ActorSnapshotRef             = principalRef + roleSnapshotRef? + actingForRef?
RepresentationRef            = representationId + revision + format + mediaType + objectStorageRef + checksum + renderer + createdAt
ReleasePackageRef            = releaseRef + packageSnapshotRef + packageHash
```

Closed enums 同步在 `common.schema.ts` 注册，供 Core Contract 直接引用：

```text
referenceStrength              = OBJECT | VERSIONED | CONTENT_ADDRESSED | SNAPSHOT
projectionType                 = COORDINATOR | DOCUMENT_WRITER | REVIEWER | RECORD_FORM_BUILDER | FEISHU_SUMMARY | HUMAN_WORKSPACE
contextItemKind                = FACT | DECISION | MATERIAL | REQUIREMENT | EVIDENCE | DELIVERY_COMMITMENT | BLOCKER | MEMORY
epistemicState                 = CONFIRMED | INFERRED | UNKNOWN | DISPUTED | SUPERSEDED
coverageCompleteness           = COMPLETE_FOR_PURPOSE | PARTIAL | BLOCKED
inputContentAccessMode         = REFERENCE_ONLY | INLINE_FRAGMENT | AUTHORIZED_FETCH
outputCardinality              = EXACTLY_ONE | ZERO_OR_ONE | AT_LEAST_ONE | ANY
executionOutcome               = COMPLETED | PARTIAL | BLOCKED_INPUT | BLOCKED_POLICY | FAILED_EXECUTION | CANCELLED_BY_RUNTIME
findingSeverity                = INFO | LOW | MEDIUM | HIGH | CRITICAL
findingDisposition             = ACCEPT | INVESTIGATE | DEFER | REJECT
readinessStatus                = READY | NOT_READY | STALE
approvalCompletenessStatus     = FULLY_APPROVED | PARTIALLY_APPROVED | NOT_APPROVED | STALE
releaseReadinessStatus         = READY_FOR_AUTHORIZATION | NOT_READY | STALE
evaluationStage                = REVISION_ACCEPTANCE | APPROVAL | RELEASE_READINESS
separationOfDutiesOutcome      = SATISFIED | VIOLATED | INDETERMINATE
```

## 3. ProjectContextContract 字段级实现

来源：`03 §3`。

| 顶层字段 | 类型 / shape | 备注 |
|---|---|---|
| `header` | `common.contractHeader` | 强制 contractHeader |
| `contextSnapshotId` | `common.uuidV7` | |
| `projectRef`, `enterpriseRef` | `common.objectRef` | 强制 ObjectRef（不允许 latest） |
| `projection` | `{projectionType, purpose, audience, builderPolicyRef, requestedByWorkOrderRef?}` | projectionType 是 closed enum |
| `asOf` | `common.utcInstant` | |
| `sourceManifest` | `{enterpriseProfileSnapshotRef, qmsConfigurationRef, customerBaselineRef?, templateBaselineRef?, regulatoryProfileRef?, gapAnalysisRef?, deliveryPlanRef?, policyRefs[], schemaRefs[], externalAuthoritySnapshotRefs[]}` | policyRefs/schemaRefs/externalAuthoritySnapshotRefs 强制 Set 唯一性 |
| `contextItems[]` | ordered list of `ContextItem` | 见 §3.6 |
| `artifactContext[]` | ordered list of `ArtifactContext` | 见 §3.7 |
| `workContext` | `WorkContext` | 见 §3.8 |
| `unresolvedItems[]` | ordered list of `UnresolvedItem` | 见 §3 末尾 |
| `omissions[]` | ordered list of `Omission` | 见 §3.9 |
| `redactions[]` | ordered list of `Redaction` | 见 §3.9 |
| `coverage` | `{requestedScopes[], includedScopes[], excludedScopes[], completeness}` | completeness closed enum |
| `sourceWatermarks[]` | NonEmptySet(`SourceWatermark`) | |

`ContextItem.value` 采用 tagged union：`ValueEnvelope` 或 `ContentAddressedRef`，后者用于只暴露内容指纹的场景（受权限保护）。`ContextItem.kind` 与 `ContextItem.epistemicState` 都是 closed enum。

## 4. WorkOrderContract 字段级实现

来源：`03 §4`。

| 顶层字段 | 类型 / shape | 备注 |
|---|---|---|
| `header` | common.contractHeader | |
| `workOrderRef` | `common.objectRef` | |
| `taskRef`, `projectRef` | `common.objectRef` | |
| `requestedBy` | `common.principalRef` | |
| `objective` | `{objectiveType, humanReadableStatement, successIntent, relatedIssueRefs[], deliveryItemRefs[], outOfScopeStatement?}` | |
| `targetScope` | `{targetObjectRefs[], baseContentRefs[], allowedUnitRefs[], forbiddenUnitRefs[], allowedCreateTypes[], crossObjectReferencesAllowed[], scopePolicyRef}` | `baseContentRefs` 强制 `ContentAddressedRef`，从 Schema 层拒绝 Object/Versioned/Latest |
| `inputRefs` | NonEmptySet of `InputRef` | `InputRef.contentAccessMode` closed enum |
| `contextSnapshotRef` | `common.snapshotRef` | |
| `constraints` | NonEmptySet of open JSON（`Constraint`） | 03 §4.3 仅给出名称而未冻结结构，文档明确以 `CanonicalJson` 表达 |
| `allowedCapabilities[]` | NonEmptySet of `CapabilityGrant` | Human-only capability（如 `quality.approval.decide`、`release.authorize`）在 Authoring 期被禁止授予 Agent |
| `deniedCapabilities[]` | NonEmptySet of `CapabilityGrant` | |
| `expectedOutputs[]` | NonEmptySet of `ExpectedOutput` | `cardinality`、`requiredReferenceStrength` 都是 closed enum |
| `completionCriteria[]` | NonEmptySet of `CompletionCriterion` | `criterionType` closed enum |
| `riskAndQuality` | `{riskProfileRef, qualityProfileRef?, dataHandlingPolicyRef, humanReviewRequired, escalationPolicyRef}` | |
| `executionPolicy` | `{maxAttempts, retryableOutcomes[], resumePolicy, fallbackPolicy, leasePolicyRef, cancellationPolicyRef}` | `retryableOutcomes` 引用 `executionOutcome` enum |
| `budget` | `ExecutionBudget` | `monetaryLimit.{amountDecimal,currency}` 强制 DecimalString + CurrencyCode |
| `harnessPolicy` | `HarnessPolicy` | `fallbackAllowed`/`fallbackRequiresHuman` boolean |
| `modelPolicy` | `ModelPolicy` | `prohibitedDataClasses` closed enum |
| `versionPins` | `VersionPins` | 全部 profile/policy/skill/template 用 VersionedRef，保证唯一引用 |
| `issuedAt`, `expiresAt?` | `common.utcInstant` | |
| `specificationHash` | `common.contentHash` | 只覆盖 Objective 到 VersionPins |

## 5. AgentResultContract 字段级实现

来源：`03 §5`。

| 顶层字段 | 类型 / shape | 备注 |
|---|---|---|
| `header` | `common.contractHeader` | |
| `agentResultId` | `common.uuidV7` | |
| `runRef`, `workOrderRef`, `taskRef`, `projectRef` | `common.objectRef` | |
| `submissionKind` | `const 'FINAL'` | |
| `executionOutcome` | closed enum | |
| `businessOutputs[]` | `BusinessOutput[]` | `ref` TypedReference，objectType 与 requiredReferenceStrength 由 Acceptance Snapshot 校验 |
| `workspaceOutputs[]` | `WorkspaceOutput[]` | `diagnosticOnly` 强制 `true`；externalRef 走 ExternalRef 体系 |
| `findings[]` | `Finding[]` | `severity`、`suggestedDisposition` closed enum |
| `knowledgeProposals[]` | `KnowledgeProposal[]` | |
| `inputRequestProposals[]` | `InputRequestProposal[]` | `expectedAnswerSpec` 走 CanonicalJson |
| `followUpProposals[]` | `FollowUpProposal[]` | |
| `agentDeclaredUsage?` | `AgentDeclaredUsage` | `measurementSource = 'AGENT_DECLARED'` |
| `runtimeUsageRef?` | `common.contentAddressedRef` | |
| `provenance` | `ResultProvenance` | `harness`、`model` 是嵌套对象 |
| `continuationProposal?` | `ContinuationProposal` | |
| `humanSummary` | `common.safeSummary` | 不允许 Chain-of-Thought/Secret |
| `submittedAt` | `common.utcInstant` | |
| `submittedByRuntime` | `common.objectRef` | |

## 6. Quality / Release Family 字段级实现

来源：`03 §6.3–§6.5`。

| 顶层字段 | RevisionAcceptance | ApprovalBundle | ReleaseReadiness |
|---|---|---|---|
| `evaluationStage` | `const 'REVISION_ACCEPTANCE'` | n/a | n/a |
| `requiredGateSpecs[]` | NonEmptySet(`GateSpecRef`) | n/a | NonEmptySet(`GateSpecRef`) |
| `gateResultRefs[]` | NonEmptySet(`GateResultRef`) 含 `revisionContentHash` | n/a | NonEmptySet(`GateResultRef`) |
| `reviewIssueSnapshot` | `{openBlockingIssueRefs, openNonBlockingIssueRefs, closedIssueRefs, dismissedIssueRefs}` | n/a | n/a |
| `approvalRequirements[]` | n/a | NonEmptySet(`ApprovalRequirement`) | n/a |
| `approvalRefs[]` | n/a | NonEmptySet of `contentAddressedRef`（强制 ContentAddressedRef，不允许 ObjectRef） | n/a |
| `separationOfDutiesResult` | n/a | `{outcome, violatedRules[], checkedAt}` | n/a |
| `completeness` / `readiness` | `Readiness {status, reasons}` | `ApprovalCompleteness {status, reasons}` | `ReleaseReadiness {status, reasons}` |
| `releasePackageRef` | n/a | n/a | `common.releasePackageRef`（包含 `packageSnapshotRef` + `packageHash`） |
| `recipientScopeSnapshotRef` / `destinationRefs[]` / `releaseRequirements[]` | n/a | n/a | 按 §6.5 |

三个 Snapshot 共享 `readiness.{status, reasons}` 的形态：`status` 引用各自 closed enum（ReadinessStatus、ApprovalCompletenessStatus、ReleaseReadinessStatus），`reasons` 是 NonEmptySet of NonEmptyString。

## 7. 仍开放的 CanonicalJson 节点

只有以下位置允许 Open JSON；其余业务对象一律 `additionalProperties: false` 并精确 required 字段：

| 位置 | 开放理由 | 替代强制约束 |
|---|---|---|
| `common.valueEnvelope.value` | `ValueEnvelope<T>` 通用 T 必须为 CanonicalJson；`presence=PRESENT` 与否的语义由应用层 Validator 强制 | 由 Validator 在 presence=PRESENT 时要求 value 非空、其他状态要求为空（06 §6.2） |
| `common.page.items` | `Page<T>` 中 T 由外围 schema 决定；Schema 2020 不支持 `$ref` 参数化 | 模块级 Result schema 自行复用 `Page<T>` 时将 T 替换为具体 `$defs` |
| `common.extension.payload` | 06 §7 Header.extensions.payload 留给注册的 Extension Type schema 决定 | Extension Type 注册表强制结构 |
| `workOrder.constraints[]` items | 03 §4.3 仅声明 `constraints: CanonicalJson[]` 而未冻结结构 | 应用层按 Policy 注册 |
| `agentResult.inputRequestProposals[].expectedAnswerSpec` | 03 §5.7 明确写出 `expectedAnswerSpec: CanonicalJson` | Runtime InformationRequest Schema 补充 |

## 8. 同步更新清单

- 顶级 `$id`：`https://schemas.zhiju.local/core/<contract>/1.0`
- `$schema`：`https://json-schema.org/draft/2020-12/schema`
- 所有顶层对象：`additionalProperties: false`
- 集合（policyRefs、schemaRefs、sourceWatermarks、approvalRequirements、requiredGateSpecs 等）使用 `uniqueItems: true`

## 9. 实现与验证

- Ajv 2020 strict mode 编译通过：6 个 Core Contract schema + common + envelope + module schemas。
- 6 个正向 fixture + 24 个负向 fixture 覆盖未知字段、缺 required、非法 enum、非法 ReferenceStrength、object ↔ contentAddressed 误用。
- Persistence、E2E、Renderer、Runtime 与 Operational Batch 测试：`NOT RUN`，仅 schema/contract 字段级。
