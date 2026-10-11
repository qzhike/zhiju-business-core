# Module-Spec-004-Artifact

版本：v0.1
日期：2026-08-30
状态：`CURRENT MODULE CONTRACT BASELINE / IM-04 WI-01–WI-09 IMPLEMENTATION, PERSISTENCE AND GIT DELIVERY COMPLETE / ISSUE #90–#98 CLOSED / PARENT SCOPED TECHNICAL ACCEPTANCE COMPLETE 2026-08-30 / IM-05 WI-05 CONTROLLED RENDERER COMPOSITION AND GIT DELIVERY COMPLETE 2026-08-30 / PR #135 MERGED / ISSUE #125 CLOSED / INDEPENDENT MANUAL AND EXTERNAL BOUNDARIES NOT RUN`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

Artifact 模块是 Artifact、Branch/Head、ArtifactRevision、Lineage、Representation、ApprovedRevisionBinding 和 EffectiveBinding 的唯一写入 Owner。它拥有成果身份与不可变内容版本，不拥有 Evidence、Gate、Approval Decision、Release Attempt 或 Renderer 实现。

同步依赖 IdentityPolicy 和 EnterpriseProject 的授权/Scope Validation；QualityGovernance、ReleasePublication 和 TaskExecution 只能通过公开 Ref/Query 使用本模块。测试规格：[`Module-Test-004-Artifact.md`](../module-tests/Module-Test-004-Artifact.md)。

## 2. 模块类型

```text
ArtifactScope = Closed<PROJECT_DELIVERABLE | ENTERPRISE_CONTROLLED>
ArtifactLifecycle = Closed<ACTIVE | ARCHIVED | CANCELLED>
RevisionDisposition = Closed<ACTIVE | SUPERSEDED | WITHDRAWN | INVALIDATED>
ContentType = Closed<STRUCTURED_DOCUMENT | WORKBOOK_SPEC | STRUCTURED_REPORT | OPAQUE_IMPORTED_CONTENT>

ArtifactDefinition
├── businessScope: ArtifactScope
├── originProjectRef?: ObjectRef<Project>
├── artifactType: NamespaceCode
├── title: NonEmptyString
├── classification: NamespaceCode
├── deliveryItemRefs: Set<VersionedRef<DeliveryItem>>
└── metadata: CanonicalJson

RevisionProvenance
├── principal: PrincipalRef
├── actingForRef?: PrincipalRef
├── taskRef?: ObjectRef<Task>
├── workOrderRef?: ObjectRef<WorkOrder>
├── runRef?: ObjectRef<Run>
├── agentResultRef?: ContentAddressedRef<AgentResult>
├── contextSnapshotRef?: SnapshotRef<ProjectContext>
├── templateBaselineRef?: VersionedRef<TemplateBaseline>
├── regulatoryProfileRef?: VersionedRef<RegulatoryProfile>
├── sourceMaterialRefs: ContentAddressedRef<SourceMaterial>[]
└── toolchainVersions: CanonicalJson[]

RevisionContent
├── artifactRef: ObjectRef<Artifact>
├── branchId: UuidV7
├── parentRevisionRefs: Set<ContentAddressedRef<ArtifactRevision>>  # Initial=0; ordinary=1; merge>=2
├── contentType: ContentType
├── contentRef: ObjectLocator
├── contentHash: ContentHash
├── structureSchemaRef: SchemaRef
├── semanticMetadata: CanonicalJson
├── changedUnits: NonEmptySet<NonEmptyString>
├── changeSummary: SafeSummary
└── provenance: RevisionProvenance

CanonicalContentPayload
├── schemaRef: SchemaRef
├── contentType: STRUCTURED_DOCUMENT | WORKBOOK_SPEC
├── canonicalizationVersion: NonEmptyString
└── body: CanonicalDocument | WorkbookSpec

CanonicalContentManifest
├── contentObjectId: UuidV7
├── payloadSchemaRef: SchemaRef
├── contentType: STRUCTURED_DOCUMENT | WORKBOOK_SPEC
├── canonicalizationVersion: NonEmptyString
├── contentHash: ContentHash
├── byteSize: NonNegativeInt
├── mediaType: MediaType
├── objectRef: ObjectLocator
└── storageState: Closed<STAGING | LINKED | FROZEN | QUARANTINED>

CanonicalDocument
├── documentId: UuidV7
├── title: NonEmptyString
├── units: CanonicalDocumentUnit[]
└── documentMetadata?: CanonicalJson

CanonicalDocumentUnit
├── unitId: NonEmptyString                 # stable within the Artifact lineage
├── parentUnitId?: NonEmptyString
├── unitType: Closed<SECTION | PARAGRAPH | TABLE | TABLE_ROW | TABLE_CELL>
├── ordinal: NonNegativeInt
├── text?: NonEmptyString
├── childUnitIds: NonEmptyString[]
├── semanticMetadata?: CanonicalJson
└── evidenceRefs?: ContentAddressedRef<Evidence>[]

WorkbookSpec
├── workbookId: UuidV7
├── sheets: WorkbookSheet[]
└── workbookMetadata?: CanonicalJson

WorkbookSheet
├── sheetId: NonEmptyString                 # stable within the WorkbookSpec
├── name: NonEmptyString
├── ordinal: NonNegativeInt
├── columns: WorkbookColumn[]
├── rows: WorkbookRow[]
├── validationRules?: CanonicalJson[]
└── crossRecordRules?: CanonicalJson[]

WorkbookColumn
├── columnId: NonEmptyString
├── name: NonEmptyString
├── ordinal: NonNegativeInt
└── valueType: NamespaceCode

WorkbookRow
├── rowId: NonEmptyString
├── ordinal: NonNegativeInt
└── cells: WorkbookCell[]

WorkbookCell
├── cellId: NonEmptyString
├── columnId: NonEmptyString
├── value?: CanonicalJson
├── valueType: NamespaceCode
└── formula?: NonEmptyString

MergeDefinition
├── revision: RevisionContent
├── mergeStrategy: NamespaceCode
├── conflictSet: CanonicalJson[]
├── conflictResolutionRefs: TypedReference[]
└── resolvedBy: PrincipalRef

RepresentationRegistration
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── format: NamespaceCode
├── mediaType: MediaType
├── objectRef: ObjectLocator
├── checksum: ContentHash
├── rendererId: NamespaceCode
├── rendererVersion: NonEmptyString
├── renderAttemptRef: ObjectRef<RenderAttempt>
└── createdAt: UtcInstant

EffectiveBindingDefinition
├── purpose: NamespaceCode
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── releaseRef: ObjectRef<Release>
├── releaseReceiptRefs: NonEmptySet<ContentAddressedRef<PublicationReceipt>>
├── effectiveFrom: UtcInstant
└── effectiveTo?: UtcInstant
```

IM-DG-005 已于 2026-08-27 获用户批准。本模块在 IM-04 只实现 `STRUCTURED_DOCUMENT` 与 `WORKBOOK_SPEC` 的 Canonical Content 最小范围；`STRUCTURED_REPORT` 保留为既有 ContentType，暂不纳入本轮结构化实现，`OPAQUE_IMPORTED_CONTENT` 只表示未结构化导入内容。

Canonical body 使用现有 Canonical JSON 规则写入受控对象存储。Hash 输入被唯一冻结为 `CanonicalContentPayload={schemaRef, contentType, canonicalizationVersion, body}`，并按 `contentHash = SHA-256(canonicalize(CanonicalContentPayload))` 计算；`contentHash` 自身、Content Object ID、locator、大小、媒体类型和 storage state 不进入 Hash 域。Canonical body 不包含 Prompt、Chain of Thought、临时 workspace 路径或渲染后的二进制。

`CanonicalContentManifest` 是 Artifact-owned、独立于 Revision 的对象生命周期记录。对象先以 `STAGING` 建立并完成 Schema、大小、媒体类型与 Hash 复验，随后进入 `LINKED`，最终冻结为 `FROZEN`；SEALED Revision 只能引用精确的 `FROZEN` Manifest，并复制不可变的 locator/content type/SchemaRef/Canonicalization Version/content Hash/大小/媒体类型作为审计快照。Revision 不承载可变 storage state，Manifest 冻结后也不得改写内容身份；失败事务和未链接对象进入受审计 Orphan Cleanup。

Document Unit、Workbook Sheet/Column/Row/Cell 的稳定身份用于 Scope 校验和基本 Diff；Excel 坐标以及 DOCX/OOXML 的字体、页眉页脚和私有版式只属于 Representation 层。IM-04 的基础 Diff 是 Workspace/Application 内部基于两个精确 RevisionRef 的可重建结果，不修改 Revision 或产生 Quality/Approval 事实。公共 Catalog 继续只通过 `artifact.get_revision_diff_inputs@1.0` 返回精确输入；本里程碑不新增公共 Diff Result Operation。

WI-07 的 Workbook application validation 在 WI-01 executable shape/invariant 之上增加业务语义，不改写已发布 Schema：Sheet ID 在 Workbook 内唯一，Column/Row 在 Sheet 内唯一，Cell 在 Row 内唯一，且 Sheet/Column/Row ordinal 在各自父级内唯一；Cell 必须引用同 Sheet Column，`cell.valueType` 必须与 Column 声明一致。内建 value type 最小闭集为 `text`、`number`、`boolean`、`date`、`datetime`、`json`；除 `json` 外，value 必须满足对应 JSON/ISO 8601 形状。公式允许可选 cached value，但只保存声明语义，不执行计算；必须以 `=` 开头、括号和字符串引号平衡，只可引用同 Sheet Column ID，并拒绝 Excel 坐标、`!`、`[]` 外部或跨 Sheet 语法。

Validation Rule 的内置形状为 `{rule:"required",columnId}`、`{rule:"range",columnId,min?,max?}`（至少一个界且 min <= max）和 `{rule:"pattern",columnId,pattern}`；Cross-record Rule 的内置形状为 `{rule:"unique",columnId}` 与 `{rule:"compare",leftColumnId,operator,rightColumnId}`，其中 operator 闭合为 `EQ/NE/LT/LTE/GT/GTE`。扩展规则形状为 `{rule:"extension",extensionId,required,config?}`；调用方必须提供已知 extension IDs，未知 `required=true` fail-closed，未知 optional extension 只保留 canonical 配置且不执行。所有规则字段闭合，Column 引用只允许同 Sheet。

Workbook Human Edit 内部 payload 固定为 `{baseRevisionRef, allowedRefs, workbook, changeSummary}`；`allowedRefs` 是分层稳定引用：`SHEET(sheetId)`、`ROW(sheetId,rowId)` 或 `CELL(sheetId,rowId,cellId)`，不接受 `A1` 坐标、裸 row/cell ID 或重复引用。候选不得改变 `workbookId`、Workbook metadata 或 Column 定义；Sheet/Row/Cell 的 Added/Removed/Changed/Moved 必须由相同引用或显式祖先引用覆盖。服务只接受可信 Human 与当前 Branch Head 的精确 ACTIVE base，先完成 Scope/hash/schema/authoritative bytes/权限/候选/Diff/no-op 校验，再创建新 FROZEN Content Object 和以 base 为唯一 Parent 的不可变 Revision。拒绝路径不得创建新 Revision；合法 replay 使用确定性派生 ID 复用首个结果。

内部 Workbook Diff 以 Sheet/Column/Row/Cell stable path 建立索引；相同 ID 只因 ordinal/父级位置变化时报告 `MOVED`，语义字段变化报告 `CHANGED`，出现/消失报告 `ADDED/REMOVED`。输出按 entity kind、UTF-8 stable path、diff kind 固定排序；读取只接受两个精确 RevisionRef 和 authoritative FROZEN bytes，结果可重建、不持久化、不产生公开 Event 或 Quality/Approval 事实。物理数组重排但 ordinal 与内容不变时，canonicalization 与 Diff 均保持不变。

Renderer 不属于本模块的实现所有权。IM-04/IM-05 通过 IntegrationGateway 的 `integration.request_render@1.0`、RenderAttempt、版本化 Renderer Adapter、`integration.RenderSucceeded@1.0`/`integration.RenderFailed@1.0` 和 `artifact.register_representation@1.0` 协作。现有 `integration.get_render_attempt@1.0` 只返回通用 `AdapterAttemptView`，没有原始 RenderRequest 与成功结果，不能证明完整绑定；因此 Representation Handler 开发前必须先以 additive `integration.get_render_attempt_binding@1.0` 冻结只读 `RenderAttemptBindingView`。Artifact 随后按 `renderAttemptRef` 权威读取成功 Binding，并核验精确 Revision、canonical content ref/input Hash、Renderer 身份、输出 locator/checksum 与 Raw Receipt 后登记 Representation，不能跨模块读库或只信任调用方 Registration。

`RenderAttemptBindingView` 包含 `attemptRef`、`status`、原始 `RenderRequest`、`requestPayloadHash`、成功 `RenderSucceededPayload` 与 `rawReceiptRef`。该 Query 是 IM-04 的 Contract Gate；WI-01 已以 additive 方式把当前公开 Operation 从 200 项增至 201 项，冻结 v1.0 历史 Compatibility Baseline 仍保持 200 项，Handler 与业务实现仍为 `NOT RUN`。

WI-01 的可执行边界包含以下 Contract 级验证：Canonical Content Payload 仅允许 `STRUCTURED_DOCUMENT`/`WORKBOOK_SPEC` 与 `canonicalizationVersion=1`；Document 校验 Unit ID 唯一、父子引用双向一致、无环和同父级 ordinal 唯一；Workbook 校验 Sheet/Column/Row/Cell 在所属父对象内唯一、Cell 的 `columnId` 属于同一 Sheet，并拒绝缺失等号或括号不平衡的公式。Schema 与这些结构不变量在 `ContractRegistry.validateCanonicalContent` 入口统一执行。

可执行 Schema 必须按 Command 区分 `RevisionContent.parentRevisionRefs` 的数量：`create_and_seal_revision` 仅允许 0 或 1 个 parent，`create_merge_revision` 必须至少 2 个 parent。当 `MergeDefinition.conflictSet` 非空时，`conflictResolutionRefs` 必须非空；否则必须在 Contract 层拒绝，不得等待 Handler 猜测或补全。

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `artifact.create_artifact@1.0` | `Artifact / CREATE` | `enterpriseRef: ObjectRef<Enterprise>; definition: ArtifactDefinition` | `artifact.artifact.create`；Project Scope 与 Enterprise 一致；不接收正文/文件 bytes |
| `artifact.update_artifact_metadata@1.0` | `Artifact / MUTATE` | `title?: NonEmptyString; classification?: NamespaceCode; metadataPatch?: CanonicalJson; changeReason: Justification` | `artifact.artifact.metadata.update`；不改变业务 Scope、Revision/Approval/Release 历史 |
| `artifact.create_and_seal_revision@1.0` | `ArtifactRevision / CREATE` | `revision: RevisionContent; creationCommandRef?: ContentAddressedRef<CommandReceipt>` | `artifact.revision.create`；原子校验/封存；普通 Revision 0 或 1 parent；contentHash 精确 |
| `artifact.create_merge_revision@1.0` | `ArtifactRevision / CREATE` | `merge: MergeDefinition` | `artifact.revision.merge`；至少两个同 Artifact parent；冲突必须显式解决；DAG 无环 |
| `artifact.move_working_head@1.0` | `Artifact / MUTATE` | `branchId: UuidV7; expectedHeadRef?: ContentAddressedRef<ArtifactRevision>; newHeadRef: ContentAddressedRef<ArtifactRevision>; moveReason: Justification` | `artifact.branch.move_head`；CAS；并发失败不 last-write-wins |
| `artifact.register_representation@1.0` | `Representation / CREATE` | `registration: RepresentationRegistration` | `artifact.representation.register`；Render Success 只形成候选，Hash/Revision/Attempt 验证后登记 |
| `artifact.withdraw_revision@1.0` | `ArtifactRevision / MUTATE` | `withdrawalReason: Justification; impactAssessmentRef?: ContentAddressedRef<ImpactAssessment>` | `artifact.revision.withdraw`；不改内容；已发布历史保留 |
| `artifact.invalidate_revision@1.0` | `ArtifactRevision / MUTATE` | `invalidationReason: Justification; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; invalidatedAt: UtcInstant` | `artifact.revision.invalidate`；治理权限；触发质量/发布影响，不删除历史 |
| `artifact.record_approved_revision_binding@1.0` | `Artifact / MUTATE` | `revisionRef: ContentAddressedRef<ArtifactRevision>; approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; boundAt: UtcInstant` | `artifact.approved_binding.record`；仅消费 fully-approved 精确事实；AgentResult 不能驱动 |
| `artifact.record_effective_binding@1.0` | `Artifact / MUTATE` | `binding: EffectiveBindingDefinition; releaseCompletionEventRef: ContentAddressedRef<DomainEvent>` | `artifact.effective_binding.record`；Release Purpose/Policy 必须允许；相同 purpose 不重叠 |
| `artifact.supersede_effective_binding@1.0` | `Artifact / MUTATE` | `purpose: NamespaceCode; currentBindingRef: ObjectRef<EffectiveBinding>; supersedingReleaseRef: ObjectRef<Release>; effectiveAt: UtcInstant; justification: Justification` | `artifact.effective_binding.supersede`；旧区间闭合，新绑定另行精确记录；CAS |
| `artifact.archive_artifact@1.0` | `Artifact / MUTATE` | `archivedAt: UtcInstant; archiveReason: Justification; retentionPolicyRef: VersionedRef<Policy>` | `artifact.artifact.archive`；不删除 Revision/Representation/Binding；Archive 后禁止新 Revision |

## 4. Query Payload 与 Result Contract

```text
ArtifactView
├── artifactRef: ObjectRef<Artifact>
├── aggregateVersion: NonNegativeInt
├── definition: ArtifactDefinition
├── lifecycleStatus: ArtifactLifecycle
├── workingHeads: CanonicalJson[]
├── approvedRevisionRefs: ContentAddressedRef<ArtifactRevision>[]
└── effectiveBindingRefs: ObjectRef<EffectiveBinding>[]

RevisionSnapshot
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── revisionNumber: PositiveInt
├── disposition: RevisionDisposition
├── contentType: ContentType
├── contentRef: ObjectLocator
├── parentRevisionRefs: ContentAddressedRef<ArtifactRevision>[]
├── changedUnits: NonEmptyString[]
├── semanticMetadata: CanonicalJson
└── provenance: RevisionProvenance

RevisionLineage
├── artifactRef: ObjectRef<Artifact>
├── rootRefs: ContentAddressedRef<ArtifactRevision>[]
├── nodes: RevisionSnapshot[]
├── edges: CanonicalJson[]
└── lineageHash: PayloadHash

RevisionValidation
├── valid: boolean
├── exactRef: ContentAddressedRef<ArtifactRevision>
├── authoritativeScopeRef?: ScopeRef
├── disposition?: RevisionDisposition
├── contentAvailable: boolean
└── reasons: ReasonCode[]

RepresentationView
├── representationRef: RepresentationRef
├── status: NamespaceCode
├── registrationRef: ContentAddressedRef<RepresentationRegistration>
└── supersededByRef?: RepresentationRef

EffectiveBindingView
├── artifactRef: ObjectRef<Artifact>
├── purpose: NamespaceCode
├── bindingRef?: ObjectRef<EffectiveBinding>
├── revisionRef?: ContentAddressedRef<ArtifactRevision>
├── releaseRef?: ObjectRef<Release>
├── effectivePeriod?: EffectivePeriod
└── asOf: UtcInstant
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `artifact.get_artifact@1.0` | A | `artifactRef: ObjectRef<Artifact>` | `ArtifactView` |
| `artifact.get_revision_snapshot@1.0` | A | `revisionRef: ContentAddressedRef<ArtifactRevision>` | `RevisionSnapshot`；ID/Hash 不匹配即拒绝，不读取 current 替代 |
| `artifact.get_revision_lineage@1.0` | S | `artifactRef: ObjectRef<Artifact>; headRef?: ContentAddressedRef<ArtifactRevision>; maxDepth?: PositiveInt` | `RevisionLineage` |
| `artifact.get_revision_diff_inputs@1.0` | A | `leftRef: ContentAddressedRef<ArtifactRevision>; rightRef: ContentAddressedRef<ArtifactRevision>` | `{ left: RevisionSnapshot; right: RevisionSnapshot; commonAncestorRef?: ContentAddressedRef<ArtifactRevision>; comparisonSchemaRef: SchemaRef }`；本 Query 不计算/保存 Diff |
| `artifact.validate_revision_ref@1.0` | A | `revisionRef: ContentAddressedRef<ArtifactRevision>; expectedScopeRef: ScopeRef; purpose: NamespaceCode; allowedDispositions: Set<RevisionDisposition>` | `RevisionValidation` |
| `artifact.get_representation@1.0` | A | `representationRef: RepresentationRef` | `RepresentationView` |
| `artifact.get_effective_binding@1.0` | A | `artifactRef: ObjectRef<Artifact>; purpose: NamespaceCode; asOf: UtcInstant` | `EffectiveBindingView` |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `artifact.ArtifactCreated@1.0` | `artifactRef: ObjectRef<Artifact>; businessScope: ArtifactScope; artifactType: NamespaceCode; originProjectRef?: ObjectRef<Project>` |
| `artifact.ArtifactRevisionSealed@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; branchId: UuidV7; parentRevisionRefs: Set<ContentAddressedRef<ArtifactRevision>>; changedUnits: NonEmptySet<NonEmptyString>` |
| `artifact.MergeRevisionCreated@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; parentRevisionRefs: NonEmptySet<ContentAddressedRef<ArtifactRevision>>; mergeStrategy: NamespaceCode` |
| `artifact.RevisionInvalidated@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; impactAssessmentRef: ContentAddressedRef<ImpactAssessment>; reasonCode: ReasonCode; invalidatedAt: UtcInstant` |
| `artifact.RepresentationRegistered@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; representationRef: RepresentationRef; renderAttemptRef: ObjectRef<RenderAttempt>` |
| `artifact.ApprovedRevisionBindingRecorded@1.0` | `artifactRef: ObjectRef<Artifact>; revisionRef: ContentAddressedRef<ArtifactRevision>; approvalBundleSnapshotRef: SnapshotRef<ApprovalBundle>; boundAt: UtcInstant` |
| `artifact.EffectiveBindingChanged@1.0` | `artifactRef: ObjectRef<Artifact>; purpose: NamespaceCode; priorBindingRef?: ObjectRef<EffectiveBinding>; newBindingRef?: ObjectRef<EffectiveBinding>; revisionRef: ContentAddressedRef<ArtifactRevision>; releaseRef: ObjectRef<Release>; effectiveAt: UtcInstant` |

## 6. 模块错误码

```text
ARTIFACT_SCOPE_INVALID
ARTIFACT_NOT_ACTIVE
ARTIFACT_METADATA_FIELD_FORBIDDEN
ARTIFACT_REVISION_IMMUTABLE
ARTIFACT_CONTENT_HASH_MISMATCH
ARTIFACT_STRUCTURE_SCHEMA_INVALID
ARTIFACT_PARENT_REQUIRED
ARTIFACT_CROSS_ARTIFACT_PARENT
ARTIFACT_LINEAGE_CYCLE
ARTIFACT_MERGE_CONFLICT_UNRESOLVED
ARTIFACT_BRANCH_HEAD_CONFLICT
ARTIFACT_REPRESENTATION_REVISION_MISMATCH
ARTIFACT_REPRESENTATION_CHECKSUM_MISMATCH
ARTIFACT_APPROVAL_BINDING_INVALID
ARTIFACT_EFFECTIVE_RELEASE_REQUIRED
ARTIFACT_EFFECTIVE_PURPOSE_INVALID
ARTIFACT_EFFECTIVE_BINDING_OVERLAP
ARTIFACT_IDENTITY_CONFLICT
ARTIFACT_EXPECTED_VERSION_REQUIRED
ARTIFACT_QUERY_NOT_FOUND
ARTIFACT_QUERY_SCOPE_MISMATCH
ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID
ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE
ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE
ARTIFACT_STRUCTURED_DOCUMENT_NOOP
ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH
```

## 7. 不变量与持久化边界

1. Artifact 不保存正文或二进制；Canonical Content/Representation 在受控对象存储，数据库保存不可变 locator/hash/checksum。
2. Revision SEALED 后内容、Hash、Parent、Provenance 永久不可变；治理 disposition 不改内容。
3. Lineage 只在同 Artifact 内形成 DAG；并行 Branch 不使用 last-write-wins。
4. 新 Draft/Revision 不改变已批准、已发布或当前 EffectiveBinding。
5. Representation 是精确 Revision 的渲染结果，不替代 Canonical Revision。
6. ApprovedBinding 只由 Quality 完整批准事实驱动；EffectiveBinding 只由符合 Purpose 的 Release 完成事实驱动。
7. CUSTOMER_DELIVERY 默认不创建 INTERNAL_EFFECTIVE_USE Binding。
8. 本模块不读取 Quality/Release Schema，不共享 Repository，不通过跨 Schema 外键建立关系。
9. `STRUCTURED_DOCUMENT` 和 `WORKBOOK_SPEC` 必须分别通过对应 Canonical Schema；不能使用 opaque JSON 绕过 closed content type、稳定身份或 Scope 校验。
10. Canonical Content Hash 只覆盖规范化后的 `{schemaRef, contentType, canonicalizationVersion, body}` Payload；Hash 自身与 Manifest 元数据不进入 Hash 域，Representation checksum 和 Release packageHash 属于不同 Hash 域。
11. SEALED Revision 只能引用 `FROZEN` Content Object Manifest；Revision 保存的 Canonical locator、content type、SchemaRef、Hash、大小、媒体类型和 Provenance 不可更新，内容变化必须创建新对象和新 Revision。
12. Canonical object 只有在 Schema、大小、媒体类型和 Hash 验证成功后才能从 `STAGING` 进入 `LINKED/FROZEN`；storage state 属于独立 Manifest 而非 SEALED Revision，数据库事务失败时不得产生业务 Link。
13. Renderer 只能使用精确 RevisionRef 和 input Hash；在 additive RenderAttempt Binding Query 落地前不得开发 Representation Handler。Artifact 必须通过公共权威边界读取成功 Attempt 并验证完整绑定，Renderer 成功本身不等于 Representation 已登记、Quality 已通过或 Release 已完成。
14. Document Unit 的 ID 在同一 Artifact lineage 内唯一，父子引用必须双向一致且无环；同一父级下的 ordinal 必须确定顺序。
15. Workbook 的 Sheet/Column/Row/Cell ID 只在所属父对象内唯一；Cell 的 `columnId` 必须指向同一 Sheet 的 Column，坐标不能替代业务 ID。

## 7.1 IM-04 WI-03 根实体、Branch 与生命周期实现约束

1. `V4001` 是新增的、forward-only 的 Artifact business migration；`V4000` 技术表不得原地修改。Root 至少保存 `artifact_id`、`enterprise_id`、可选 `project_id`、`business_scope`、`origin_project_ref`、`artifact_type`、`title`、`classification`、`delivery_item_refs`、`metadata`、`lifecycle_status`、`aggregate_version`、`metadata_version`、`default_branch_id`、空的 `approved_revision_refs`/`effective_binding_refs`、创建/更新归因和 `identity_hash`。
2. 当前公开创建 Contract 没有独立业务键；Handler 以 `businessScope + exact scope + artifactType + initial title` 的 canonical digest 作为创建身份 `identity_hash`，并由 `(enterprise_id, identity_hash)` 唯一约束把同 Scope 的重复身份转换为 `ARTIFACT_IDENTITY_CONFLICT`。标题可被元数据 Command 更新，但不得重算或覆盖已持久化的创建身份。
3. 创建时固定一个 UUIDv7 `main` Branch，并将 Root 的 `default_branch_id` 指向该 Branch。Branch 保存 `artifact_id`、`branch_id`、`branch_name`、可空 `working_head_ref`、`head_version=0`、状态和创建归因；本切片不创建 Revision，也不实现 `move_working_head`，但 Branch 名称唯一和 head 占位结构必须先冻结。
4. Project Deliverable 的 `originProjectRef` 必须是与 `enterpriseRef` 同 Enterprise、与 `scope.projectId` 一致且在 trusted Context allow-list 内的 exact Project ObjectRef；其 Root `project_id` 镜像该 Project，且 V4001 数据库约束拒绝空 Origin。Enterprise Controlled Root 的 Root `project_id` 必须为空；可选 Origin Project Ref 若存在仍需通过同样的 Scope 校验，省略时 Repository 必须写入 SQL `NULL`，不能写入 JSONB `null`。DeliveryItem Ref 只做 exact shape、Enterprise/Project Scope 和 trusted Context 校验，不查询其他 owning Schema。
5. `artifact_app` 对 Root/Branch 只开放 SELECT；创建、Metadata CAS 和 Archive 由 Artifact-owned security-definer 函数执行，函数必须重新检查 trusted Context、Scope 和主体归因。Root/Branch 不授予 `UPDATE/DELETE`，Root Trigger 与函数共同保证直接 SQL 不能改变 Scope、身份指纹、历史 Ref、Approved/Effective 占位、生命周期或聚合版本。
6. Metadata Update 要求 Envelope 携带正整数 expected aggregate version；CAS 失败返回 `CONCURRENCY_CONFLICT` 与当前版本，不能静默 reload 或 last-write-wins。Root 处于 `ARCHIVED`/`CANCELLED` 时禁止元数据、Branch/head 和后续 Revision 写入；当前切片只实现 `ACTIVE -> ARCHIVED`，不实现恢复。
7. `artifact.ArtifactCreated@1.0` 是当前唯一公开 Artifact lifecycle event。MetadataUpdated/Archived 是 owning outbox 内部事件，不改变当前公开 Catalog；若未来成为跨模块 Contract，必须 additive 更新 Schema、生成类型、Registry 和负向 Fixture。
8. Query 必须以 exact Artifact ObjectRef 读取 Root 和全部 Branch；无效 Ref 返回 `ARTIFACT_SCOPE_INVALID`，不存在或不可见行统一返回 `ARTIFACT_QUERY_NOT_FOUND`，不得通过错误差异枚举其他 Enterprise/Project 的 Artifact。

## 7.2 IM-04 WI-04 Canonical Content Object 实现约束

1. `V4002` 是新增的、forward-only 的 Artifact business migration；它只新增 `artifact_content_object`、精确 owner link、quarantine 和 orphan cleanup 记录，不修改 `V4000`/`V4001`，不创建 `artifact_revision` 或公开 Artifact Operation。
2. Content Object Manifest 的 `storage_state` 固定为 `STAGING -> LINKED -> FROZEN`；`STAGING/LINKED -> QUARANTINED` 仅用于验证失败、篡改或安全处置；`FROZEN` 的 Content identity、SchemaRef、Hash、大小、媒体类型、locator、version 和 Scope 不可更新。
3. Object Storage 只能通过可替换 `ObjectStoragePort` 写入 staging。应用生成 `staging/canonical/<contentObjectId>` locator；上传后必须 authoritative readback bytes、media type、size、provider/version 和 locator，并重新运行 executable Canonical Schema、Canonical JSON 与 SHA-256 验证。Caller hash、filename、path 和 storage metadata 不能替代 readback 事实。
4. Link Commit 和 external finalize 是两个事务边界。DB link 成功后才允许 finalize；`STAGING` 上直接调用 finalization owner function 必须拒绝。finalize 成功前 Manifest 保持 `LINKED`，finalize unknown/error 使用独立 finalization state 可重试，不能 freeze。DB 事务在对象上传后失败时不得留下业务 link，必须在独立事务写入 masked Orphan 记录。
5. 本 WI 的 link 只保存未来 `ArtifactRevision` 的精确 owner ref 形状；link 与 `LINKED` 状态迁移在同一 Artifact-owned security-definer transaction 完成；同一精确 owner link 的重放不得重复写 Outbox 或 Reference Edge。未来 SEALED Revision 只能引用同 Scope 且仍为同一 immutable Content Object 的 `FROZEN` Manifest。
6. Orphan cleanup 使用 24 小时 grace、5 分钟 lease、fencing token、指数重试（5 分钟起、24 小时封顶）和幂等 `DELETED/NOT_FOUND` terminal outcome。存在 reverse link、retention 未到期、legal hold 或 `QUARANTINED` 时禁止删除；claim、fence、retry、unknown、hold/retention 拒绝和 deletion outcome 均写 masked Audit。Quarantine reason code/summary 必须是有界、安全摘要，不能携带原始 payload、URL、locator 或秘密。
7. `artifact_app` 对新表只保留 Scope-filtered SELECT；所有业务写入和 cleanup state transition 经过 owner function。实现只承诺 local/CI in-memory adapter 与 disposable PostgreSQL；真实 Ceph RGW/OpenBao、生产加密/Object Lock、scheduler、公开 HTTP、跨模块 E2E 和独立人工验收保持 `NOT RUN`。

## 7.3 IM-04 WI-05 Revision、Lineage、Branch CAS 与 Merge 实现约束

1. `V4003` 是 forward-only migration，只新增 `artifact_revision`、`revision_parent`、`revision_conflict`、`revision_withdrawal` 和 `revision_invalidation`；不得修改已应用的 `V4000`/`V4001`/`V4002`，不得把 Canonical body 写入 Artifact 数据库。
2. `artifact_revision` 必须以精确 `content_object_id` 绑定同 Scope 的 `FROZEN` Manifest，并保存其 locator、content type、SchemaRef、canonicalization version、Hash、byte size、media type 和 Provenance 快照。`artifact_app` 对 Revision 与所有关系/治理事实只读；Revision identity/snapshot、Parent 和 Provenance 的 `UPDATE/DELETE` 必须由 ACL、Trigger 和 owner function 共同拒绝。
3. Initial Revision 的 Parent 数为 0；普通 Revision 恰为 1；Merge Revision 至少为 2。所有 Parent Ref 必须是同一 Artifact、同 Enterprise/Project Scope、ID 与 contentHash 精确匹配且不重复；递归 CTE 必须在插入前拒绝 self/cycle。Revision 创建按 Artifact 锁定分配单调 `revision_no`，不自动移动 Branch Head。
4. `artifact_branch.head_version` 是不透明 CAS token，现有初始值 0 合法。`move_working_head` 必须原子比较 expected version 与 expected head ref，再写入 new exact RevisionRef；一个竞争者成功，其他竞争者返回稳定 `ARTIFACT_BRANCH_HEAD_CONFLICT`，保留候选 Revision 并追加 `revision_conflict`，不得 last-write-wins。
5. Merge Command 必须携带至少两个有效 Parent、显式 conflict set 和 `resolvedBy`。当 conflict set 非空时 resolution refs 不能为空；`resolvedBy` 必须是当前可信 Context 的 Human。Conflict/Resolution 只通过不可变事实和 Reference Edge 追踪，不能更新旧 Revision。
6. Withdrawal/Invalidation 是 append-only governance facts。Revision Snapshot 查询根据治理事实派生 disposition，但不改变内容、Parent、Provenance、Canonical Manifest 或历史 Hash；同一精确 Query 在后续 Draft、Withdrawal、Invalidation 后仍返回原始 Revision Snapshot。同一 Revision 上两类治理事实的 Reference Edge 必须分别使用 `/governance/withdrawal/artifactRef` 与 `/governance/invalidation/artifactRef` 等不同路径，不能触发技术 Edge 唯一约束或覆盖前一事实。
7. Snapshot、Lineage、Diff Inputs、Validation 的所有 RevisionRef 都必须验证 object type、UUID、Scope 和 32-byte contentHash；Project Artifact 不得接受仅含 Enterprise 的宽 Scope，`validate_revision_ref.expectedScopeRef` 必须与事实行的 Project Scope 完全一致；`latest`、`current`、路径或文件名不能作为历史定位。Lineage 以递归查询生成 exact nodes、edges、root refs 和 canonical `lineageHash`，Diff Query 只返回输入，不计算/保存 Diff。
8. WI-05 不新增公共 Operation；既有 `artifact.create_and_seal_revision`、`artifact.create_merge_revision`、`artifact.move_working_head`、治理 Command 和四个 Revision Query 是唯一入口。公共 Catalog 仍保持当前 201 项与历史 200-operation compatibility baseline 的关系。
9. Branch CAS 的 expected version 只信任 Envelope 的 `expectedAggregateVersion`，payload 不得重复声明或覆盖该值；结构 Schema Version 可以使用同 Enterprise 的 Enterprise Scope，即使 Artifact 本身是 Project Scope。Reference Edge 的 owner version 使用 UUID identity，不能把数值 `head_version` 强制转换为 UUID；Merge 的 conflict set、resolution refs 和 Human `resolvedBy` 必须在任何 Revision/Parent/Conflict 写入前完成校验，校验失败必须整体回滚。
10. V4003 每个 owner function 的 `REVOKE/GRANT EXECUTE` 必须与定义的完整参数个数和类型一致；任何授权签名不匹配都应使空库迁移失败并回滚全部 WI-05 DDL。Withdrawal 的治理事实与其 Outbox 事件必须复用同一已记录时间值。

## 7.4 IM-04 WI-06 Structured Document Human Edit 与内部 Diff 实现约束

1. WI-06 只在 `modules/artifact/src/business/structured-document-service.ts` 提供 Artifact-owned 内部服务；复用现有 Canonical Schema、Content Object、Revision 和 Command runner，不新增数据库迁移，不在数据库保存 Canonical body，不新增公共 Catalog Operation。
2. Structured Document Canonicalization 的输入是 `CanonicalDocument` 与权威 `schemaRef`。服务必须先调用现有 executable Canonical Content 校验，再将 roots/siblings 按 `ordinal`、`unitId` 排序，将 `childUnitIds` 按被引用 Unit 的 `ordinal`、`unitId` 排序，并以确定性的层级遍历顺序输出 `units`。所有 Unit 的 `unitId` 必须在同一 Artifact lineage 内唯一；Unit type 必须是闭合集合；父子引用必须双向一致、同父级 ordinal 不重复且 parent graph 无环。
3. `evidenceRefs` 若存在，必须是合法的精确 Reference/Snapshot 形状，并且 Enterprise/Project Scope 与可信 Command Context 一致；未知 evidence 类型、跨 Scope evidence、宽 Project Scope 和无法验证的引用必须在 canonical bytes 生成前拒绝。Canonical Hash 只覆盖 `{schemaRef, contentType, canonicalizationVersion, body}`，与 WI-01 的 Hash 定义一致。
4. 内部 Human Edit Payload 固定包含 `baseRevisionRef`、非空且无重复的 `allowedUnitRefs`、候选 `document` 和非空 `changeSummary`。Target Artifact 从 exact base Revision 推导，不信任 payload 中重复的 Artifact/Branch/current/latest 定位字段。base 必须是可见的、同 Scope 的、结构类型为 `STRUCTURED_DOCUMENT` 的 exact sealed Revision；若 Branch 已有不同 exact head，则返回 `ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE`。
5. Human Edit 的 principal 必须是可信 Context 中的 Human，并且 Envelope principal 与 Context 一致。候选 Document 必须保持 base 的 `documentId`、title、document metadata 和 structure SchemaRef；候选 Canonical Content 必须重新计算 bytes/Hash。Diff 产生的每个 Unit 变化必须命中 `allowedUnitRefs`，否则返回 `ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE`；无变化返回 `ARTIFACT_STRUCTURED_DOCUMENT_NOOP`。这些拒绝必须先于 `stageCanonicalContent`，因此不创建新 Content Object、Link 或 Revision。
6. 成功 Edit 按 `stage -> readback -> link -> finalize -> freeze -> create_and_seal_revision` 的既有边界提交新 Canonical Content Object 与新 Revision，Parent 只有 exact base Revision，`changedUnits` 是 Diff Unit ID 去重后的确定性排序集合。base Revision 的数据库行、Content Object、Canonical bytes、Hash 和治理事实均不可变；外部 finalize 不确认时不得创建 SEALED Revision。
7. 内部 Diff 只能由现有 `artifact.get_revision_diff_inputs@1.0` 的两个 exact Revision Ref 驱动，然后从各自 FROZEN Content Object authoritative readback 重建 Document。Diff 结果是内存中的可重建值，不写入数据库、Outbox、Receipt、Approval、Quality 或 Release 事实；不添加公开 `artifact.get_revision_diff@1.0` 或其他 Diff Result Operation。结果按 `unitId`、kind 固定排序，Added/Removed/Changed/Moved 使用稳定 Unit identity；位置变化比较 `parentUnitId + ordinal`，内容变化比较 Unit 的非位置字段，必要时同一 Unit 可同时产生 Changed 与 Moved。
8. WI-06 允许使用 local Object Storage 与 disposable PostgreSQL 做自动验证，必须保留 Unit/Contract、Persistence、Rollback、History Replay、Hash Golden、manual synthetic fixture 和 `NOT RUN` 边界；真实 Provider、生产数据库、公开 HTTP、跨模块 E2E、Renderer、Quality/Approval/Release 和独立人工业务验收不因本 WI 自动变为 `PASS`。

当前实现与自动验收已重新核验：聚焦 Unit 为 1 文件/4 passed；全量静态门禁、Contract、全量 Unit（30 个文件/380 passed/265 skipped）和 Persistence（26 个文件/280 passed）均通过，pinned PostgreSQL/Flyway 空库迁移与第二次 migrate no-op 均通过；synthetic procurement-procedure 复核材料见 [`Manual-ART-024.md`](../archive/issue-95-delivery/Manual-ART-024.md)。组合流程中途故障注入仍为 `PARTIAL PASS / INJECTION NOT RUN`，独立人工业务验收及外部边界保持 `NOT RUN`；PR #113 已合入 `main`，Issue #95 已关闭。

## 7.5 IM-04 WI-08 Representation 与 RenderAttempt Binding 实现约束

1. WI-08 以 forward-only `V4004` 创建 `artifact.representation` 与 `artifact.representation_validation`。Representation 保存 Artifact/Revision/Enterprise/Project、format/media type、opaque object locator、output checksum、renderer identity、render attempt ref、request payload hash、input hash、raw receipt ref、created time 和 attribution；Validation Fact 保存 Binding Query/validator version、outcome 与精确 request/result/receipt 摘要。两者都不得保存文件 bytes、Canonical body、Provider credentials、Presigned URL 或未脱敏 payload。
2. Artifact 通过 `RenderAttemptBindingQueryPort` 调用公开 `integration.get_render_attempt_binding@1.0`；Port 输入只有 exact `attemptRef` 与可信 Scope，返回值必须先通过 `ContractRegistry.validateOperationResult`。业务代码不得依赖 `@zhiju/integration-gateway` 实现包、IntegrationGateway 表或共享 Repository；通用 Attempt Query 不得作为降级来源。
3. Binding 的 `attemptRef`、`succeededResult.attemptRef` 与 Registration `renderAttemptRef` 必须 exact equality；公共 Attempt/Raw Receipt `objectType` 分别固定为 `integration.render_attempt` 与 `integration.raw_external_receipt`，Raw Receipt 还必须携带规范 SHA-256 ContentHash。Attempt 必须为 `SUCCEEDED`，并同时包含 `succeededResult`、顶层 `rawReceiptRef`，两处 Raw Receipt 必须 exact equality。`FAILED`、`UNKNOWN`、`CANCELLED`、`QUARANTINED`、缺失、Contract-invalid 或 Port failure 返回稳定拒绝，且不得开始 Artifact success transaction。
4. Request `revisionRef`、Success `revisionRef` 与 Registration `revisionRef` 必须逐字段相等，并与 Artifact Repository 查得的 immutable Revision ID/Scope/content hash 精确匹配。公开 Revision Ref 的 `objectType` 固定为符合 NamespaceCode 的 `artifact.artifact_revision`；内部 Command target/owner label 可以继续兼容历史 `ArtifactRevision`，但不得把该大写内部标签输出到公共 Query/Event Ref。Request `canonicalContentRef` 必须等于 Revision snapshot locator，`inputHash` 必须等于 Revision Canonical content SHA-256；Withdrawal/Invalidation 的 Revision 或归档 Artifact 不允许新增 Representation。
5. Request `outputFormat` 必须逐字等于 Registration `format`；Request/Success/Registration 的 renderer ID/version 必须一致；Success output locator/checksum 必须分别等于 Registration objectRef/checksum。Binding Contract 没有 media type，因此 Artifact 以 NamespaceCode 最后一段使用闭合映射：`*.pdf=application/pdf`、`*.docx=application/vnd.openxmlformats-officedocument.wordprocessingml.document`、`*.xlsx=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`。未知格式或 media type 不匹配 fail-closed，完整 format 本身不得被截断后用于 Binding 相等比较。
6. Representation checksum 只证明渲染输出，与 Canonical input hash、Revision content hash、request payload hash、Raw Receipt content hash 和 Release package hash 分域；任何代码和测试都不得用一个 Hash 补齐另一个 Hash。Render Success 只是候选事实，Representation commit 也不产生 Quality PASS、Human Approval、Release Authorization、Release Completion 或 EffectiveBinding。
7. Representation identity 以 Command target UUIDv7 固定；同一个 `render_attempt_id` 在数据库内唯一。Owner function 必须先按 Attempt identity 取得 transaction-scoped advisory lock，再对已存在 Attempt 比较所有 immutable 字段：完全一致返回 `ALREADY` 和首个 representation ID；任一字段不一致返回 `CONFLICT`。因此并发或顺序的不同 Idempotency Key exact replay 都不重复业务行、Validation Fact、Reference Edge 或公开成功 Event；新 input hash、renderer version、output checksum/object 或 format 必须来自新的权威 RenderAttempt 并使用新的 Representation ID。
8. `artifact_app` 对两表只有 RLS-filtered SELECT；INSERT 只能经 `artifact_owner` security-definer function，UPDATE/DELETE 由 ACL 与 immutable trigger 双重拒绝。Owner function 重新检查可信 Context、Artifact/Revision Scope、active lifecycle、exact content hash、RenderAttempt/Raw Receipt Scope 和 attribution；Application 预校验不能替代数据库边界。
9. `artifact.RepresentationRegistered@1.0` 只在首个 Representation commit 时追加一次；同事务写入 Validation Fact、Revision/RenderAttempt/RawReceipt Reference Edge、Command Receipt、Audit 和 Outbox。任何注入故障必须整体回滚。`artifact.get_representation@1.0` 只接受完整 RepresentationRef，逐字段对照 immutable 行并返回 `RepresentationView(status=REGISTERED, registrationRef=ContentAddressedRef<RepresentationRegistration>)`；错 ID/Scope/checksum/renderer/object 等均返回不可枚举的 not found。
10. 自动验收仅可把 synthetic Binding Port、local code、disposable PostgreSQL、Migration/no-op、RLS/ACL、rollback 与 event minimality 记为 `PASS`。真实 IntegrationGateway Handler/DB readback、Renderer/Provider/object store、文件打开与版式、公开 HTTP、部署后的跨模块 E2E、生产和独立人工业务验收必须保留 `NOT RUN`。

## 8. 可人工验收的模块产出

里程碑 `API-AF-01` 的人工产出是 ART-023 Fixture：REV-001 后两个并行 Branch 产生 REV-002/REV-003，不互相覆盖；显式 Merge 形成新 Revision；同名 PDF checksum 改变只形成新 Representation；旧批准和 EffectiveBinding 保持不变。该审核不代表 Renderer、对象存储或并发数据库约束已运行。

## 8.1 IM-04 WI-09 权威 Query 与退出证据约束

1. WI-09 复用六个已落地 Query Handler：`get_artifact`、`get_revision_snapshot`、`get_revision_lineage`、`get_revision_diff_inputs`、`validate_revision_ref` 与 `get_representation`。不得增加 `get_latest_revision`、公共 Diff Result、跨 Schema Repository 或 Query Projection fallback。
2. Query 输入必须在数据库访问前验证公开 Ref shape、UUIDv7、Scope 与 Hash；数据库读取仍受可信 transaction Context 与 RLS 约束。错误 Scope 的 Artifact/Representation 返回不可枚举 not found；需要表达校验结论的 `validate_revision_ref` 返回稳定的 `valid=false + reasons`，不能用当前 Head 替代错误 Ref。
3. Revision Snapshot 仅从 immutable Revision 行、Parent 与 append-only governance facts 构造。后续 Revision、Branch Head、Representation 不得改写旧 Revision identity；Withdrawal/Invalidation 只改变 disposition。Lineage 节点/边按 revision number、child ID 与 parent order 确定性输出，Diff Inputs 只返回两个精确 Snapshot、共同祖先与 comparison Schema。
4. Content Object 只有 `FROZEN` 才能创建 Revision；`STAGING`、`LINKED`、`QUARANTINED` 或 readback/hash 不一致均在写入边界拒绝，所以公共 Revision Query 不暴露这些对象的 locator。调用方 locator、文件名、URL 或声明 hash 不形成 Query identity。
5. Representation Query 必须逐字段匹配完整 RepresentationRef，并只返回经 `integration.get_render_attempt_binding@1.0` 权威校验后登记的 immutable View。登记新 Representation 不改变 Revision Snapshot、Lineage 或 Diff Inputs。
6. `artifact.get_effective_binding@1.0` 只在后续正式 Release/EffectiveBinding 写模型落地后实现；IM-04 仅证明新 Draft/Revision/Representation 不产生该事实。该 Query 与独立人工跨模块场景继续记录为 `NOT RUN`。
7. WI-09 本地自动验证已通过：focused Artifact Unit/Contract 为 6 files/69 passed；普通全量 Vitest 为 32 passed/24 skipped files、390 passed/269 skipped tests；Architecture 与 201-operation FULL Contract/200-operation frozen compatibility baseline 通过；pinned PostgreSQL 18.6/Flyway 11.20.3 Persistence 为 28 files/284 passed，空库 V4000–V4004、第二次 migrate no-op 和容器清理通过。`ZJU_ART023_REPORT=1` 可重复输出 exact Query/DAG/Representation UUID、Hash、checksum 与错误码；汇总见 [`../issue-98-delivery/Manual-ART-023.md`](../archive/issue-98-delivery/Manual-ART-023.md)。
8. WI-09 实现 head `8e58fa18ee50726252ca38542b6de1afdfbb4310` 已通过 PR #117 exact-head CI，并以 merge commit `f4b8704ba766d49c12c4433884d94bce91d50792` 合入 `main`；Issue #98 已关闭，实现 head 是 `origin/main` ancestor。父 Issue #89 必须由独立父 Gate 复核后关闭。

## 8.2 IM-04 父退出门槛约束

1. #90–#98 必须全部为 `CLOSED / COMPLETED`，有效实现 PR #100、#102、#104、#106、#110、#113、#114、#116、#117 及最终权威同步 PR #118 必须为 `MERGED`，对应 head 必须为 `origin/main` 祖先。
2. 父 Gate 必须重新运行完整 `pnpm clean && pnpm verify`，并在 pinned PostgreSQL 18.6/Flyway 11.20.3 上证明空库 `V4000`–`V4004`、第二次 no-op、28 个 Persistence 文件、所有负向断言和容器清理；历史成功记录不能替代本轮执行。
3. `ZJU_ART023_REPORT=1 pnpm persistence:gate` 必须产生可重复、无 Secret 的 Root/Branch/Manifest/Revision/DAG/CAS/Diff/Binding/Representation 与拒绝输出；自动合成技术证据不升级为真实业务或独立人工验收。
4. 公共 Catalog 固定为 201 项，冻结 v1.0 baseline 固定为 200 项，不增加公共 Diff Result；Required HL-Spec、Module Spec/Test 必须与最终 `main` 一致。
5. 真实 IntegrationGateway 部署读回、Ceph RGW/OpenBao、Renderer/Provider、Office 文件版式/可打开性、公开 HTTP、生产、后续模块业务 E2E、真实客户适用性和独立人工业务验收保持 `NOT RUN`。
6. 2026-08-30 父 Gate 已按上述边界重验：focused 6 files/59 tests、完整 Unit 390 passed/269 skipped、Architecture、201/201 FULL Contract、200-operation compatibility baseline、PostgreSQL/Flyway 28 files/284 tests、空库 31 migrations、second no-op 和清理均通过；ART-023 exact report 也在同一 digest-pinned 本地镜像上独立通过 28/284。Docker Hub 鉴权连续三次 `EOF` 仅阻断报告重跑前的远端 manifest 查询，未启动数据库；远端 tag↔digest 已由同轮完整 Gate 先行验证。

## 9. 当前状态

- 26 个 Artifact 既有公开 Contract 已定义字段级 payload/result/event 结构，并实现可执行 JSON Schema；WI-01 另行提供 Canonical Content/Manifest 可执行 Schema，不新增 Artifact 业务 Operation；
- API v0.1 已于 2026-08-13 通过用户审核；
- PR #12 Review 确认的 parent 数量与未解决 Merge 冲突缺口已修复，两条 Contract 回归已 `PASS`；
- IM-DG-005 的 Canonical Document/Workbook 最小 Schema 与 Renderer 路线已于 2026-08-27 获用户批准；WI-01–WI-09 已完成 Canonical Schema/Hash/Binding Query、事务基础、Artifact Root/Branch、Content Object、Revision/DAG/CAS/Merge、Structured Document 与 WorkbookSpec Human Edit/内部 Diff、Representation Binding、权威 Query 和合成 ART-023 的实现、自动验证与 Git 交付。真实 IntegrationGateway 部署读回、Renderer、对象存储、跨模块 E2E、生产与独立人工验收仍为 `NOT RUN`；
- Artifact Root/Branch 与 WI-04 Content Object 的业务 Unit、Persistence、RLS、幂等、CAS、Rollback、E2E 与人工验收按测试文档逐项记录，不得用技术表 PASS 代替业务 PASS。WI-04 的纯本地 adapter 回归与真实数据库行为已分别写入对应测试证据；测试必须显式收窄 CommandResult 联合类型并保持注入故障回调的返回类型闭合。实现必须在边界处显式收窄 Scope 类型，在公开 Typed Reference 与 canonical JSON hash 输入之间使用显式转换，对 JSON.parse 的动态值先经过 unknown 边界，并通过 canonical JSON 转换读取 JSONB，避免把存储形状或未知值直接当作公开 Typed Reference。
- 首轮 PostgreSQL Gate 已验证 V4001 空库迁移和既有 Persistence 回归；新增业务夹具发现并记录了公开 View 与 Command result 扩展字段的比较边界，以及 Outbox scope mirror 必须与 Envelope Project 精确一致，修正后才可将业务 Gate 记为 PASS。
- 第二轮 Gate 进一步确认幂等重放返回 `DUPLICATE` 并复用首个结果；失败点是测试辅助函数只收窄到 `COMMITTED`，不属于业务实现失败，修正后必须保留对 `DUPLICATE` 首个结果的精确比较。
- 第三轮 Gate 已执行到 Metadata CAS；发现并修正结果扩展字段的 PostgreSQL `bigint` 字符串/公开数值不一致，`metadataVersion` 必须与创建结果及读模型保持安全整数表示。
- 最终 Persistence Gate 已完成 23 个文件/272 个测试，Project 与 Enterprise Controlled Root/Branch 的 V4001/no-op、business write boundary、RLS、幂等、CAS、Archive、Rollback、直接写 ACL 和 Project Root 空 Origin 的 owner-boundary 拒绝均已在 pinned PostgreSQL/Flyway 上验证；实现提交 `5cb4d1b4e97c4062de99ff66d5d357c0d47209e6` 已通过 PR #104 合并，merge commit 为 `9d7cb06128680bc141548115f347884aee813412`，Issue #92 已关闭，远端和本地 feature branch 已删除。
- 完整 `pnpm verify` 的静态、类型、全量 Unit（27 files、371 passed、257 skipped）、Architecture、201 项 Contract 均通过；其最后 Persistence 子阶段因 Docker Hub token 请求 `EOF` 未启动，不能与最终独立 Persistence Gate 的真实 PASS 混写。
- WI-04 的最终本地 Gate 为 `pnpm lint`、`pnpm typecheck`、`pnpm --filter @zhiju/artifact build`、新增 Object Storage Unit 及 Artifact 回归、以及 pinned PostgreSQL 18.6/Flyway 11.20.3 `pnpm persistence:gate`；后者通过 24 个 Persistence 文件/277 个测试，空库 V4002 成功、第二次 migrate 为 `No migration necessary`，并清理测试容器。真实 Ceph RGW/OpenBao、生产对象安全、Revision/Renderer、跨模块 E2E、公开 HTTP 和人工验收仍按测试矩阵保持 `NOT RUN`。

## 10. IM-02 WI-04 持久化切片

Artifact owning Schema 独立拥有八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。WI-02 在这些既有技术表之上实现单连接事务协调、可信 Context 传播、Receipt 幂等、技术 Process CAS、Audit/Outbox/Reference Edge 原子提交与回滚；不修改 V4000、不增加业务表。2026-08-28 的 `pnpm clean && pnpm verify` 在 PostgreSQL 18.6/Flyway 11.20.3 上通过，Persistence 为 22 个文件、268 个测试，空库迁移、二次 no-op 和容器清理均通过；此前的 2 个测试 ESLint 规则问题已修复并复验。实现 commit `76c48f01e1a7c53ca9d2485be34290b4436310fa` 已由 PR #102 合入 `main`，Issue #91 已关闭，远端 feature branch 保留。Canonical Content Repository、对象存储、Renderer 与业务 Handler 仍为 `NOT RUN`。

## 11. IM-05 WI-05 Renderer/Representation 组合边界（Issue #125）

WI-05 复用已经交付的 `artifact.register_representation@1.0` Handler、`RenderAttemptBindingQueryPort` 和 V4004，不修改 Artifact Migration 或公开 Contract。Artifact 只接受由 IntegrationGateway 公开 Binding Query 返回并经 ContractRegistry 校验的 `RenderAttemptBindingView`；不得依赖 IntegrationGateway package 内部 Repository、直接 SQL 或 `latest/current`。

成功组合仍要求 exact Revision/canonical locator/input hash/format/media type/renderer ID/version/output locator/checksum/Raw Receipt/Scope/时间全部一致，且 Attempt 为 `SUCCEEDED`。`FAILED`、`UNKNOWN`、quarantined、缺 Receipt、契约无效或任一替换都必须 fail closed。登记 Representation 只形成 Artifact 自有 immutable Representation、validation、reference edges 与最小事件；不得推进 Quality、Approval、Release 或 EffectiveBinding。

当前状态：`CONTROLLED PUBLIC-PORT COMPOSITION, PERSISTENCE AND GIT DELIVERY COMPLETE / PR #135 MERGED / ISSUE #125 CLOSED`。实现 head `d3a1394663d3f953e4c686385b0ef9d8d280aefb` 已由 merge commit `1ef1303be233901c73a0bcc8f97bce8edf7e93a7` 纳入 `main`；真实外部 Provider、公开 HTTP、生产、真实客户适用性和独立人工业务验收仍为 `NOT RUN`。


## 12. IM-06 正式执行输出的 owning 创建与精确事实（已批准设计 #233；实施 #235）

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-30 / IMPLEMENTATION MERGED (#235 / PR #236) / VERIFICATION AND REVIEW EVIDENCE IN PR #236 / HUMAN TECHNICAL APPROVAL APPROVED`。阻塞 finding 的修订复验、独立复审及人类技术批准以 PR 及正式审查记录为准；未执行子项、外部和独立人工业务验收仍为 NOT RUN。消费 [Spec 003 §25](Module-Spec-003-TaskExecution.md#25-正式输出与独立-completion-spec-delta233)。普通既有create_and_seal_revision与历史provenance语义不变；它们没有TE来源验证，不能冒充本路径新输出。

新增 `artifact.create_execution_revision@1.0`，COMMAND/CREATE、target OBJECT/artifact.artifact_revision，Project Scope，expectedAggregateVersion省略。closed payload `{runRef:OBJECT/execution.run,revision:ExecutionRevisionContent}`；ExecutionRevisionContent恰RevisionContent除provenance外的字段，contentType固定STRUCTURED_DOCUMENT，parentRevisionRefs=[]，semanticMetadata={}，changedUnits非空。canonical body在既有Content Object staging/link/freeze流程提供；该Command不接收bytes、caller principal、WorkOrder/Task/Context/Result或completion结论。Revision依赖的Artifact root必须经实际create_artifact创建、Project businessScope/originProject正确且ACTIVE；content manifest必须为同Artifact FROZEN，hash/body/schema三者精确一致。无需移动Branch head、不写TE表。

唯一调用方是当前授权HUMAN；owning context以认证principal生成provenance.principal，不使用actingFor。Artifact SERVICE凭自己独立读取授权调用TE get_output_creation_binding，核对Run/Project/有效新profile/所需schema与当前时效；只有该binding中的Task/WorkOrder/Context Ref能进入provenance，agentResultRef缺省，sourceMaterialRefs=[]、toolchainVersions=[]（本有限路径无其它来源声明）。从真实Content manifest取得创建内容；Ref不能在冻结input/base/parent refs中出现，不能复用Revision identity。Query observation只证明Run在观测时RUNNING，无跨Schema FK/双Root事务；创建后Run若过期或已有其他final，输出保留，但TE不得据此成功。

closed CommandResult.data `{revisionRef:CONTENT_ADDRESSED/artifact.artifact_revision,creationCommandRef:CONTENT_ADDRESSED/zhiju.artifact.command_receipt}`。Revision UUID来自Envelope target；creation Receipt immutable规范材料的objectId为该实际commandId。Receipt payload恰 `{commandId,commandType:"artifact.create_execution_revision",commandVersion:"1.0",targetRef,scopeRef,requestPayloadHash,outcome:"COMMITTED",revisionRef,actorRef,actorSnapshotRef,authorizationDecisionRef,committedAt}`；Hash为完整canonical payload、与command_receipt实际COMMITTED结果/请求/actor强绑定。Receipt payload不含自身Ref/Hash，Revision payload不含Receipt Ref，二者在同一Artifact事务提交，避免循环Hash；不能用resultPayloadHash当ReceiptHash。Creation binding独立附属immutable payload恰 `{revisionRef,creationCommandRef,taskRef,workOrderRef,runRef,workOrderContractRef,contextSnapshotRef,controlsPolicyRef,observedRunVersion,startedAt,bindingObservedAt,bindingValidUntil,bindingObservationHash,createdAt}`，Hash覆盖全字段。服务端createdAt必须在受信binding有效窗口且strictly早于bindingValidUntil；后续Result.submittedAt不早于createdAt。Receipt/source rows只在owning source command事务写入，不接受caller“已提交”声明。

新增 `artifact.get_execution_output_fact@1.0`，AUTHORITATIVE/CUSTOMER_CONFIDENTIAL Query，closed payload `{revisionRef:CONTENT_ADDRESSED/artifact.artifact_revision}`；closed data `{revision:RevisionSnapshot,artifactRef:OBJECT/artifact.artifact,artifactAggregateVersion:NonNegativeInt,artifactLifecycle:ArtifactLifecycle,businessScope:ArtifactScope,originProjectRef:OBJECT/zhiju.project.project,contentState:"FROZEN",canonicalContent:CanonicalContentPayload,creationBinding:ExecutionRevisionCreationBinding,creationBindingHash:PayloadHash,creationReceipt:ExecutionRevisionCreationReceipt,observedAt:UtcInstant,useStatus:"USABLE"|"STALE"|"REVOKED",reasonCodes:ReasonCode[]}`。RevisionSnapshot原shape；RevisionRef.contentHash沿用§4.1的CanonicalContentPayload域 `{schemaRef,contentType,canonicalizationVersion,body}`，不把含自身Ref的完整snapshot纳入该Hash域。完整RevisionSnapshot的owning source镜像、CreationBinding Hash与Creation Receipt Hash分别精确复验，不能互相替代；canonicalContent只返回有权的canonical body，不返回object storage凭证。Query重新计算binding/Receipt/source镜像与contentHash、Schema、id/Hash/Scope；ACTIVE Revision+ACTIVE Artifact+完整FROZEN内容为USABLE，归档/superseded为STALE，withdrawn/invalidated为REVOKED。历史完整payload不改写，返回current字段；缺/错hash/Scope、普通Revision无creationBinding统一masked NOT_FOUND。current useStatus解释码限 `ARTIFACT_EXECUTION_OUTPUT_STALE`、`ARTIFACT_EXECUTION_OUTPUT_REVOKED`。

相同command键重放须当前creation授权，但已提交历史Receipt不要求Run重新ACTIVE；返回原Ref，不能重新创建。新键要求有效新binding/新target，重复target按既有Artifact conflict拒绝。自身与TE依赖Decision在受保护读取前及提交/Receipt返回前重验；错误公开映射为既有AUTHORIZATION_DECISION_INVALID、ARTIFACT_STRUCTURE_SCHEMA_INVALID、ARTIFACT_CONTENT_HASH_MISMATCH、ARTIFACT_SCOPE_INVALID；binding无效/过期新稳定码 `ARTIFACT_EXECUTION_BINDING_INVALID`，不泄露Run是否存在。immutable Row/Hash/Receipt/Edges/既有RevisionSealed Event原子提交，失败无部分正式事实。Module-Test 004 新矩阵分别记录 #235 的实际 owning/受控 PostgreSQL 证据与未执行子项；不改变历史 Artifact/Renderer 证据。

## D12 / Q11 精确 Markdown 表示与导出读取提案（#260）

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。集合由 [REL §14](Module-Spec-006-ReleasePublication.md#14-d12--q11-项目交付批次与受控导出提案260) 拥有；本节不改变 CanonicalContentPayload Hash、Revision immutable/lineage、旧Representation或批准/EffectiveBinding契约。

1. 当前 §7.5 的媒体映射仅PDF/DOCX/XLSX；IG现有Renderer闭集仅最小DOCX/XLSX。提出 additive `document.markdown` + `text/markdown`（UTF-8）的格式映射，完整 format/rendererId/rendererVersion仍逐字匹配RenderRequest/Binding/Registration。旧format接受集合与已登记checksum不改；未知格式拒绝，不把 .md 文件名当证明。
2. Markdown由登记的版本化Renderer从exact SEALED/ACTIVE Canonical Document生成，沿已批准 request_render →成功Binding→register_representation 链，权威读取input Hash、output bytes/checksum/media type/opaque locator/存储version。首版仅支持该Renderer能完整表达的STRUCTURED_DOCUMENT；WORKBOOK_SPEC/opaque/未知required结构阻断，不将Canonical JSON字符串、浏览器预览或上传改稿假充受控Markdown。完整格式语义由该Renderer profile检验，本提案不改变canonical source或选择生成Runtime。
3. 批次 entry 的artifactRef/revisionRef必须与 get_artifact.definition.deliveryItemRefs、get_revision_snapshot的immutable provenance及EP当前计划关联相符；approvedRevisionRefs只用于发现候选，仍须Quality当前证明。多个可用批准版本显式列出，不以workingHeads/new candidate/文件名选“最新”；Human-only来源保留原principal，不伪造Run/AgentResult/报告。
4. 拟内部 ControlledRepresentationBytesPort独立授权：输入 `{representationRef:RepresentationRef,purpose:artifact.representation.controlled_export.read}`；仅当前Scope有权HUMAN或显式登记Release export SERVICE。先从自有登记事实确认exact Revision/Scope/checksum/renderer/registration与合法对象version，返回受控stream及 `{representationRef,registrationRef,storageVersion,byteSize,mediaType,checkedAt}`；每次readback bytes重算checksum。公开metadata Query不是bytes授权，locator不自动变URL；旧API/Port仍保持原用途。
5. 包装原始已登记bytes不能替换内容、补客户签名、填空白业务表单或重渲染成新版本。源表示checksum不同、对象不可读/被隔离或Revision withdrawn/invalidated/Artifact archived时拒绝；旧批次及历史原文保留，新副作用停止。ZIP为REL集合对象，不登记为任一Artifact的Representation；下载不新增ApprovedBinding/EffectiveBinding。

### 项目候选的只读发现来源

拟内部 `ProjectDeliveryArtifactDiscoveryPort` 由ART拥有，AUTHORITATIVE纯读取；输入不要求已知Artifact/Revision/Release，也不接受客户端成果清单：

```text
ProjectDeliveryArtifactDiscoveryRequest
  projectRef: ObjectRef<Project>
  page: PageRequest

ProjectDeliveryArtifactDiscoveryItem
  artifact: ArtifactView
  markdownRepresentations: Set<RepresentationView>

ProjectDeliveryArtifactDiscoveryResult
  projectRef: ObjectRef<Project>
  artifacts: Page<ProjectDeliveryArtifactDiscoveryItem>
```

独立当前授权的HUMAN或显式登记Release Reader SERVICE消费，拟purpose为`artifact.project_delivery.discovery.read`；服务调用的结果还须在发起HUMAN当前可读范围内。只从ART自有成果、ApprovedRevisionBinding、Representation登记事实发现同enterpriseId+projectId的PROJECT_DELIVERABLE；不把Enterprise-owned成果补projectId混入。本Port无Plan/章节/质量/发布资格裁决，REL按EP owning事实核对所属exact Plan。跨执行轮次、无Run来源、尚无CONTROLLED_EXPORT Release或没有获批版本的可读成果均不因缺Release被过滤；ArtifactView完整字段沿§4，approvedRevisionRefs仍只是候选指针，不替代QG当前Proof。

markdownRepresentations为该Artifact的approvedRevisionRefs对应、当前获准读取且已登记的精确Markdown RepresentationView集合，按完整representationRef稳定排序；没有登记则为空，不造RepresentationRef。它提供调用既有get_representation所需的完整identity，不以Release存在为前提，不返回bytes/凭证/公共URL。ART索引即使用于定位也须逐项从owning事实读回ArtifactView及完整登记绑定；REL随后重验get_artifact/get_revision_snapshot/get_representation与当前QG/EP/REL事实，不能将发现页当eligibility、Snapshot或授权。一个Artifact在枚举中出现一次，共享Item关联由其实际definition.deliveryItemRefs保存，不按Item或Run复制；多个获批Revision/表示保留完整exact选择，不选“最新”。超有限Page/结果/集合Guard则拒绝，不静默漏掉版本或截断单个成果。

artifacts沿共享Page，显式items、可选nextCursor、snapshotAt/sourceWatermarks，按完整ArtifactRef稳定排序。ART游标绑定Port版本、Project Scope、requester/purpose、固定Project筛选、已扫描位置、真实ART源水位和有效期；源读切面覆盖definition/获批绑定/表示登记，Scope/主体/purpose/筛选不符或过期拒绝，当前授权范围/相关源变化或固定读切面不可恢复时拒绝续页，不能拼接新旧源。每页仍验当前权限；无权成果/表示不携带名称、占位或隐藏总数。权限裁剪可产生items=[]且有nextCursor的中间页，游标须前进，REL继续读取而不判定项目无成果。SourceWatermark仅用真实owning来源，不能以页数/扫描计数制造sequence。

## 13. Markdown 候选、定位与表示提案（#259）

状态：T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED。跨步骤选择与 trace 见 [Spec Delta](../decisions/markdown-file-feedback.md)；本节拥有内容、范围、定位、候选及 Markdown 表示字段。§7.4 内部 Human Edit、§12 初始 execution revision、IM-DG-005 和旧 Renderer 接受集保持原样。

### 13.1 基线映射与完整约束

ART内部prepareFileSourceMapping和prepareFileConstraintProposal Ports只接受受信TE的当前SERVICE授权，以及同Project的preparationRequestRef、workScopeRef、fileId、exact reportRef/planRef、完整change/KEEP IDs、精确主来源/模板refs+bytes hashes、可选baseRevisionRef、Quality verified protection Evidence/claims、EP启动绑定及已确认fileIdentity（ArtifactRef/documentId/title/metadata）；后者还须exact baselineMappingRef和rangeProposal。preparationRequestRef必须是TE §28.0已提交的准备意图，不能引用尚需constraints的生成intent。先独立解析TE/EP/QG/ART owning refs，后读取对象；不接受Browser locator、自由正文、模型给出的未确认allowedUnitRefs或任意Evidence alias。前者只建立映射，后者验证完整范围后建立提案；二者不创建Artifact Root/Branch/Revision，不确认约束。

rangeProposal是对原plan每个change/KEEP/protected项的具体source locator→Unit/新锚对应，closed {planRef,fileId,baselineMappingRef,items,proposalSourceRef}，items每项changeId/完整sourceLocators/候选unitIds或newAnchor。它可来自顾问明确位置或另行授权的Runner诊断，但均仅提案，不能作为已确认范围；ART只验证同plan/源/结构/ID全覆盖、KEEP/保护关系，不分析自然语言来猜可修改范围。旧D14报告没有该字段时不能自动补成整文件通配；先显示MAPPING_REQUIRED，由Human在已有整份计划检查中确认完整有界提案，缺合格提案则该文件等待。未修改EP旧报告Schema/Hash，也不因本Port存在声称Runtime已能产映射。

主基线已有 Revision 时沿用其稳定身份；新文件来源通过本节固定 parser 形成不可变 SNAPSHOT/artifact.markdown_source_mapping。payload 闭集为 mappingId、preparationRequestRef、projectRef、workScopeRef、fileId、sourceRefs（每项 exact ref/role/rawBytesSha256/可选 derivedSourceRef+derivedBytesSha256）、parserProfileRef、structureSchemaRef、canonicalPayload、canonicalContentHash、nodeMap、readLimits、createdAt。nodeMap 每项为 sourceRef、sourceLocator（已验证的段落/表/row/cell 身份及原 excerpt hash）、unitId、unitType、parentUnitId、ordinal；源行号仅 displayHint。canonicalPayload 不含 mapping 自身 Ref/hash；Hash 按 cv1 覆盖上述完整 payload。原件完整性不证明结构无损；存在未读/有损/不支持必要结构则 proposal=BLOCKED，不给可确认映射。

约束提案为 SNAPSHOT/artifact.file_constraint_proposal，payload 闭集：proposalId、preparationRequestRef、scopeRef/workScopeRef/fileId/reportRef/planRef、baselineMappingRef、baseRevisionRef?、artifactIdentity（artifactRef、branchMode:EXISTING或NEW_OWNING_MAIN；仅EXISTING有真实branchId）、documentIdentity（documentId/title/metadata）、allChangeIds、keepChangeIds、allowedChanges、protectedBindings、templateRefs、sourceWatermarks、profileRef、createdAt/validUntil。allowedChanges 每项为 changeId、allowedKinds 非空集合 ADDED/REMOVED/CHANGED/MOVED、existingUnitIds、newContentAnchors（parentUnitId+beforeUnitId?/afterUnitId?；空根仅首次 CREATE）、subtreeCoverage 显式布尔值。每个整份计划 change 必须出现一次；KEEP 仅冻结其完整 Unit/subtree 不变，不进入写集合。REORGANIZE/CREATE 也必须有具体锚，不能把“整份同意”扩大为任意修改。

protectedBindings 每项为 protectedFactId、exact EvidenceRef/必要 Fact/Product/QMS version refs、sourceSnapshotRef/locator/capturedContentHash、claimUnitIds、claimHash、relationshipBindings（父子/字段角色/客户职责关系的精确 stable IDs+hash）、requiredUnchanged=true。方针、目标、组织职责、既有流程及产品要求保留完整原文和关系；结构化依据不转换为 TEXT Fact。任何 protectedImpact/exception/conflict 未解决、claimed unit缺失、同名映射歧义或必要 Evidence 当前不可用均 BLOCKED。旧源→新结构无法严格校验时先人工核对映射，不用 Runner “无影响”声明替代保护证据。

确认前Human公开入口为[TE §28.0](Module-Spec-003-TaskExecution.md#280-确认前的提案准备与公开读回)的prepare Command和get Query组合。ART producer/read Port经TE内部readFileConstraintReviewRequest与自身当前SERVICE binding-read权限核验真实准备意图/Receipt，不能调用Human-only公开Query或仅信caller payload。ART内部readFileConstraintReview Port只接受专用TE SERVICE的当前artifact.file_constraint_review.read权限及本request真实mapping/proposal refs，返回完整上述payload/精确Ref/cv1 Hash、currentEligibility/sourceWatermarks；逐项核TE原准备意图、同Scope/file/plan和当前源/保护读权，缺Root/Revision不影响新文件读取。新的range请求可显式引用前一准备请求仍有效的exact mapping，proposal.preparationRequestRef指新请求、mapping.preparationRequestRef保留原来源，TE/ART核两个请求同file/plan/源水位而不改旧hash。读回及Browser均不触发producer；无完整提案不能confirm，来源/CAS变动提交时拒STALE。

以下操作均为拟 @1.0、共享 Envelope、同 Project：

| 操作 / target mode | closed payload | closed data / purpose |
|---|---|---|
| artifact.confirm_file_edit_constraints / CREATE，OBJECT/artifact.file_edit_constraints | proposalRef:SNAPSHOT/artifact.file_constraint_proposal | constraintsRef:SNAPSHOT/artifact.file_edit_constraints、receiptRef；artifact.file_constraints.confirm / HUMAN_ONLY；完整提案逐字段确认、当前 source/plan/CAS eligibility 重验，不接正文/子集/保护例外 |
| artifact.get_file_edit_constraints / AUTHORITATIVE Query | constraintsRef | payload（原proposalRef、完整已确认约束、ActorSnapshot/Decision/Receipt/confirmedAt）、currentUsability:USABLE/STALE/REVOKED、reasonCodes、sourceWatermarks；artifact.file_constraints.read |

Constraints Hash 按 cv1 覆盖独立完整确认 payload，排除自身 Ref/hash；确认不改 proposal，不启动 Run。映射/提案的 exact 内容由 constraints Query 一并受权返回给 TE，不新增 Browser 私有 SQL 或跨 Schema Repository。

constraints的baseRevision/sourceMapping与branchMode是确认时的起点，不是随Head变化的pointer。同一plan后续反馈可沿同Artifact已接纳lineage复用原stable范围和保护约束，TE每次另捕获真实current/Branch；NEW_OWNING_MAIN起点已产生Root后不得再创建新Root。ART必须证明current属于该起点的合法lineage，范围/KEEP/protected stable IDs仍可唯一解析且原保护完整；删除/重建锚、无法覆盖新增身份或范围语义变化则STALE/MAPPING_REQUIRED，在同整份核对中显式确认新约束快照。原constraints/Location不改，不把复用stable授权范围当迁移用户旧意见。

### 13.2 Markdown 到 STRUCTURED_DOCUMENT

拟 artifact.markdown_document@1.0 与 artifact.markdown_document.schema@1.0 为独立 registered selector 接受集，SchemaRef 为 VERSIONED/artifact.canonical_document_schema、Enterprise Scope；注册时分配精确 objectId/versionId，不复用 §12 selector 或 synthetic 默认 Ref。生成冻结时必须拿到实际 selector 与 tool digests；未注册/未知 selector fail closed。

CanonicalDocument/Unit 五种类型、父子双向关系、唯一 unitId/同父 ordinal、无环、现行排序与 CanonicalContentPayload Hash 不变。documentMetadata 的本 profile 闭集为 fileKind:PROCEDURE/MANUAL/POLICY/BLANK_FORM/FILLED_RECORD、fileCode、templateVersionText?；不接客户业务结论或 execution status。原客户编号/目录标题/维护记录都作为正文保留；删除模板维护历史必须是显式获准的 change，不将模板维护人/日期当客户修订活动。

Unit.semanticMetadata 只允许一个 markdown 对象，按 unitType 采用下表闭集。未列出的 key/结构拒绝，不向旧 Schema 偷加 required 字段。Evidence refs 仍按现有精确引用规则由 owning 服务核验，不从 Markdown 文字造 refs。

| Unit | markdown 元数据 / text 规则 |
|---|---|
| SECTION | headingLevel:1..6、inlineSpans；text 是完整逻辑标题；两个 H1 是两个独立 SECTION，document title 由已确认 documentIdentity 指定；标题层级栈只决定实际结构，不合并同名标题 |
| PARAGRAPH | blockKind:TEXT/LIST_ITEM/THEMATIC_BREAK；TEXT/LIST_ITEM 的 inlineSpans 见下段；LIST_ITEM 必填 listId/listKind:ORDERED或UNORDERED/listOrdinal/listDepth:1..6/orderedMarker?，ordinal marker 原编号字符串保留；THEMATIC_BREAK text省略且无inlineSpans |
| TABLE | columns 非空数组，每项 columnId、ordinal、alignment:NONE/LEFT/CENTER/RIGHT；headerRowUnitId 必须引用本表真实首行；captionUnitId? 仅指真实同章节正文 |
| TABLE_ROW | rowRole:HEADER/DATA；实际 header 与每一空行都有稳定身份；所有行 cell 数等于 columns，列序固定，无跨行/跨列合并 |
| TABLE_CELL | columnId、valueState:BLANK/TEXT、inlineSpans；BLANK 的 text省略且spans=[]；TEXT 的 text为非空逻辑文字，“0”保留TEXT，不根据数字/签名栏解析成确认事实 |

inlineSpans 是闭合非嵌套有序数组，每项 start/end（逻辑 Unicode code point 的半开区间）及 kind:STRONG/EMPHASIS/CODE/HARD_BREAK；STRONG/EMPHASIS 可同区间组合，其余重叠/交叉拒绝。HARD_BREAK 覆盖 text 中一个 LF code point。inline code 内只按文字处理，其他位置允许反斜线转义 punctuation、强/斜体 marker；无法按封闭规则配对的 marker 按 literal text 保留，不猜格式。软换行映射一个空格；正文内部空格不压缩。列表支持独立 item 与缩进续行/子列表，目录中的 5.1 等原文不解析成章节身份。引用块/代码块/链接/图片/脚注/HTML（除三种纯 br token）/front matter/HTML注释/未知syntax被识别后返回 UNSUPPORTED，不落为已接受的“纯文本替代”。

pipe tables 仅未转义竖线分列，首尾边界 pipe 不生成额外 cell；分隔行每列至少一个连字符、两端可带 alignment colon，采购申请单的两连字符分隔cell合法，renderer固定三连字符不改变语义。只去每 cell 外围语法 padding，保留转义后内部文字；相邻空 cell、全空 DATA row 均保留。列数不等拒绝；不能对采购程序表1自动填空列、合并 header 或裁尾列。br allowlist 只在正文/单元格中产生 HARD_BREAK，带属性/大小写变体/其他HTML拒绝。CRLF/BOM 的派生规范化、限制和危险结构见 Delta §3。

Canonical text、spans、list marker、table alignment、row/cell状态与原编号均进入 contentHash。render 使用 LF、固定 escape/marker/column padding；每个完整 canonical tree 必须满足 parse(render(tree), authoritativeIdentityMap)=tree（按现行Canonical排序比较）且 Hash相等。Markdown原始 bytes 的hash始终独立；byte formatting不等价不代表内容变化，无法证明语义等价则 ART_MARKDOWN_LOSSY。

身份映射 sidecar 不嵌入 Markdown 注释：closed {profileRef,artifactRef,documentId,baseRevisionRef?,baselineMappingRef?,candidateOutputId,markdownBytesSha256,nodes,columns}，nodes 每项 sourceNodePath/unitId/type/parentUnitId/ordinal，columns绑定tableUnitId/columnId/ordinal。现有身份仅从受信基线/map继承；sidecar caller声明须与本次绑定复验。新 ID 由 ART 从 originalIntentRef+candidateOutputId+newNodePath 派生，不从标题/行号/文字hash生成，不得借新ID绕过 REMOVED/ADDED 的scope检查。任意跨Artifact、重复ID、错type/parent/bytes或不完整映射拒绝。

### 13.3 候选接纳与来源

| 拟 @1.0 操作 / target | closed payload | data / purpose |
|---|---|---|
| artifact.accept_file_candidate / CREATE，OBJECT/artifact.artifact_revision | acceptedFileResultRef、candidateOutputId | revisionRef、candidateAcceptanceRef:CONTENT_ADDRESSED/artifact.file_candidate_acceptance、creationReceiptRef；artifact.file_candidate.accept，仅受信专用 SERVICE |
| artifact.get_file_candidate / AUTHORITATIVE Query | candidateAcceptanceRef | immutable acceptancePayload、revisionSnapshot、currentUsability、reasonCodes、sourceWatermarks；artifact.file_candidate.read |

先自身写权、独立 TE candidate-binding/source读权，再受权 readback 原 Markdown/sidecar/报告 bytes。TE 返回 Result/Acceptance/Run/Contract/Context/IG observation、fileSourceBinding、原intent、current eligibility与受信acceptedAt；TE当前查询不因Run已terminal而否认合法历史，但新接纳必须尚在binding有效期限、同current base/plan且没有取消/迟到/隔离事实。ART不接受free revision payload/自报完成，不复用旧 create_execution_revision。

范围校验的全文Diff：首次以完整baselineMapping.canonicalPayload→candidate比较，后续以submittedCurrent Canonical→candidate比较；原constraints始终另外核完整KEEP/protected起点。首次公开EMPTY_INITIAL→Revision的“全部新增”是阅读事实，不能替代sourceMapping→candidate的范围检查。每个新/删/改/移Unit（包括父关系、metadata、标题/编号/表列）均检查完整allowedChanges；documentId/title/metadata修改在后续edit首版拒绝，新增文件严格等于确认的documentIdentity。KEEP与protected完整值/关系不变；改动影响保护上下文而无确定覆盖时拒绝人工复核。报告location/Evidence claim与Canonical实际位置不符拒绝。后续NOOP不创建Revision；首次无业务变化但有合法完整CREATE计划可建立首份Revision，不能因与模板内容相等而把文件错误当已存在。部分意见候选仅在所有内容检查成功且未处理项显式保留时接纳，不以报告HANDLED作为质量验证。

新Root先由TE专用步骤通过既有create_artifact创建/读回真实main Branch；ART核actualArtifactCreationFact与自身Root/Branch事实，对NEW_OWNING_MAIN要求同确认identity且空Head，不能用预分配branchId或title猜测。封存沿既有 Content Object 生命周期；finalize UNKNOWN 无FROZEN/Revision。SEALED Revision和acceptance/creationReceipt/来源Edges/Audit/RevisionSealed在同一ART事务提交或回滚。acceptancePayload闭集为 requestRef/submittedIntentRef/fileSourceBindingRef/constraintsRef、fileId、artifactRef/revisionRef/parentRevisionRefs、resultRef/resultAcceptanceRef/validationRef、runRef/contractRef/contextRef/observationRef、rawMarkdownRef/rawBytesSha256/identityMapRef/identityMapBytesSha256/processingReportRef/processingReportBytesSha256、canonicalContentHash/structureSchemaRef/parserProfileRef、creationReceiptRef、actorSnapshotRef/authorizationDecisionRef、acceptedAt。payloadHash按cv1，不含自身Ref/hash；revisionRef.contentHash只覆盖CanonicalContentPayload，不覆盖含自身Ref的snapshot。creationReceipt材料闭集为commandId/type/version、targetRef/scopeRef、requestPayloadHash、revisionRef、actorSnapshotRef/authorizationDecisionRef、committedAt，绑定真实accept_file_candidate提交；不含未来acceptanceRef或自身hash，避免循环Hash，CommandResult中的acceptanceRef另按resultHash证明。

新版本不自动Head前进；既有move_working_head在独立当前授权/CAS成功后才选为当前候选。竞争失败保留sealed Revision与历史acceptance，TE展示STALE而不覆盖current。已接纳来源/内容变无效时追加currentUsability/impact，不改原payload。相同键/相同payload且当前有权返回原Ref；新键同target不得复制候选。

### 13.4 公共变化目录与 stable location

| 拟 @1.0 Query / purpose | closed payload | closed data |
|---|---|---|
| artifact.get_file_review_content / artifact.file_review.read | revisionRef、location? | revisionRef/canonicalContentHash/profileRef、完整受权CanonicalDocument或location上下文、authoritativeIdentityMap、currentUsability/sourceWatermarks；不返回storage locator或批准结论 |
| artifact.get_file_change_directory / artifact.file_diff.read | toRevisionRef、fromRevisionRef?、baselineKind:REVISION/EMPTY_INITIAL、filter:{chapterUnitId?,text?}、page:{limit:1..100,cursor?} | exact inputs、algorithmRef、diffHash、totalChanges、filteredChanges、chapterGroups、entries、nextCursor?、sourceWatermarks；EMPTY_INITIAL仅无Parent初始Revision |
| artifact.resolve_file_review_locations / artifact.file_locations.read | fromRevisionRef、toRevisionRef、locations:1..100 | 每项 originalLocation、resolution:UNCHANGED/MOVED/CHANGED/REMOVED/AMBIGUOUS/UNSUPPORTED、suggestedLocation?、reasonCodes；只给建议不改绑定 |

Location closed {revisionRef,unitId,unitType,path,claimHash}；path为按root→unit的完整稳定unitId数组；TABLE_CELL另必填tableUnitId/rowUnitId/columnId。claimHash=SHA256(cv1({unit自身所有Canonical字段,按结构顺序的完整子树}))；不会把raw行号/DOM offset/summary当claim。字段组合与实际Canonical图逐项精确校验；权限/hash/Scope/对象不可见统一安全错误。新旧Location不会有相同version，迁移必须显式引用新Location。

entry closed {changeId,unitId,kind:ADDED/REMOVED/CHANGED/MOVED,beforeLocation?,afterLocation?,beforeValue?,afterValue?,chapterUnitIds,contextUnitIds}；changeId=SHA256(cv1({exactInputs,algorithmRef,unitId,kind}))。ADDED无before，REMOVED无after；MOVED保留两端；值含全部Canonical语义字段，宽表完整列及text入口可受权按location读取。同Unit CHANGED+MOVED分两entry；totalChanges数的是entry，changedUnitCount按unit去重，不混用。排序按to树序（deleted用from树序）、unitId UTF-8、kind，章节组只导航，不能合并独立真实change。

cursor为server opaque/authenticated token，绑定input refs/hash、algorithm/filter/sort、权限watermark、lastStableKey和到期；任一变化拒绝，不用browser顺序或offset猜身份。完整diffHash不受filter/page/浏览影响。返回authoritative输入与当前可读性，Diff自身仍可重建、无持久化Gate/Approval/Receipt事实。

### 13.5 Markdown Representation 与下载

| 拟 @1.0 操作 | closed payload | closed data / purpose |
|---|---|---|
| artifact.register_markdown_representation / CREATE，OBJECT/artifact.representation | revisionRef、renderAttemptRef | representationRef、registrationRef、receiptRef；artifact.markdown_representation.register，专用SERVICE；依IG Markdown binding真实成功登记 |
| artifact.get_markdown_download / AUTHORITATIVE Query | representationRef | representationRef/revisionRef、checksum、byteLength、mediaType、safeFilename、downloadTicket、expiresAt；artifact.markdown_download.read |

format固定zhiju.markdown，mediaType固定text/markdown; charset=utf-8。注册先核原Attempt确由integration.request_markdown_render@1.0提交，不接旧request_render@1.0或自报operation；再核IG精确Request/Revision/Canonical inputHash、structure/profile/renderer版本与digest、identityMapHash、实际输出checksum/length、rawReceipt、roundTrip验证；canonical内容与render回读Hash一致。仍由IG提交Attempt后render、ART单Root登记；旧register_representation@1.0的pdf/docx/xlsx映射不放宽。同Attempt唯一、所有identity/bytes相同才幂等；渲染失败不登记，不以Runner原md为Representation。

downloadTicket有效≤60秒、只绑定当前principal、完整Scope/exactRepresentation+Revision+checksum+format和bytes-read purpose；无任意URL/路径，Browser使用same-origin GET /api/markdown-representations/{representationId}/content，ticket放专用header。沿用完整shared RepresentationRef（包括opaque objectStorageRef作为identity），不能删字段变简化Ref或将opaque locator变URL/读权。server重新验当前Session/权限、exact绑定、REGISTERED/current可用性及对象实际checksum后stream；长流撤权/故障停止，不伪成功。返回Content-Disposition attachment安全文件名、nosniff/no-store；不额外返回宿主路径/storage secret，不执行内容，不把ticket存草稿/日志。下载是审阅/修改交换，不证明Approval/Release/客户送达，多文件发布包另行合同。

拟稳定内容错误：ART_MARKDOWN_UNSUPPORTED、ART_MARKDOWN_UNSAFE、ART_MARKDOWN_LIMIT、ART_MARKDOWN_LOSSY、ART_MARKDOWN_IDENTITY_INVALID、ART_FILE_CONSTRAINTS_INVALID、ART_FILE_PROTECTION_CHANGED、ART_FILE_CANDIDATE_BINDING_INVALID、ART_FILE_LOCATION_INVALID；stale/CAS/noop沿既有语义。公开不可见错Scope/hash/locator统一masked，详细原因只在受权安全Audit。相关运行/人工结果全部NOT RUN。

### 13.6 已实现的技术管线与证据（#270）

状态：`T2 / IMPLEMENTED (#270) / SCOPE: 解析、canonical graph 与元数据、身份 sidecar、round-trip`。本节只记录 #270 实际交付的封闭技术管线；§13.1、§13.3–§13.5 的公开操作、Handler、持久化、真实原输出、Representation 与下载仍为 `NOT IMPLEMENTED / NOT RUN`。

- 已注册 selector/profile：`artifact.markdown_document@1.0`（profile）与 `artifact.markdown_document.schema@1.0`（selector），`SchemaRef` 为 VERSIONED/`artifact.canonical_document_schema`、Enterprise Scope。注册事实唯一来源是 `contracts/registry/artifact-markdown-schemas.v1.json`（objectId `0199b600-0000-7000-8000-000000000402`、versionId `0199b600-0000-7000-8000-000000000412`），`schemaId` 为 `https://schemas.zhiju.local/modules/artifact/1.0#/$defs/markdownDocumentContent`；与已批准字面量不一致的注册 payload、未知 selector/version 均 fail closed（`loadArtifactMarkdownSchema`）。不复用 §12 selector 或 synthetic 默认 Ref。
- 已注册 limits：`artifact.markdown_limits@1.0`（单文件 10 MiB、100000 Units、标题/列表深度 ≤6、单表 ≤128 列/10000 行、单逻辑文本 ≤65536 Unicode code points、解析 ≤10 秒）。256 MiB heap 为声明预算，实际由已执行的字节/节点/表规模上限约束；总 Unit 预算对段落、列表、表格及其行/单元格在 materialization 之前统一计数。
- 封闭机器 Schema/类型：`$defs` `markdownDocumentContent`、`markdownDocument`、`markdownDocumentUnit`（五类 Unit 的 closed oneOf）、`markdownDocumentMetadata`、`markdownInlineSpan`、`markdownTableColumn`、`markdownIdentityMap` 等；`ContractRegistry.validateMarkdownDocumentContent` 与 `validateMarkdownIdentityMap` 是唯一校验入口，跨单元/跨表不变量与 inline span 规则由 `markdownContentInvariantErrors`、`markdownIdentityMapInvariantErrors` 补充。内容 `schemaRef` 必须是已注册 selector 的精确 kind/objectType/objectId/versionId 与 Enterprise-only Scope（`isRegisteredMarkdownDocumentSchema`），未知 selector/version fail closed；`headerRowUnitId` 必须指向表格真实首行（`childUnitIds[0]`，最低行 ordinal）且为 HEADER。
- 已实现解析与身份：`parseMarkdownDocument`（UTF-8 与可选 BOM、CRLF→LF 派生规范化、ATX 标题层级栈含重复 H1、段落与软换行、分隔线、有序/无序列表与缩进续行/子列表且保留 marker 行硬换行并在标题/分隔线/表格/不支持块处终止列表、rectangular pipe table 与 alignment、`**`/`*`/inline code、三种 `<br>` 允许项、limits 与 setext/indented code/HTML/链接/脚注/围栏/引用块/ragged table/`~~` 删除线/task-list 扩展的 fail-closed 拒绝；危险语法按解析上下文判定，inline code 内容只按 literal 文本处理）。setext 下划线与分隔线按「上一块是否同层段落 + 当前行是否纯 `-`/`=` 序列」判定：紧邻列表、标题、表格或空行的 `***`/`___`/`- - -` 保持 THEMATIC_BREAK，只有紧邻段落的 `---`/`===` 视为 setext 并整文件拒绝，列表项内部的缩进 setext 同样拒绝。身份 sidecar 绑定校验与 `deriveMarkdownUnitId`、`deriveMarkdownColumnId`、`markdownListId` 派生（新 Unit/column 身份仅由 originalIntentRef+candidateOutputId+nodePath 派生，现有身份只从受信 base/source mapping 继承）。继承身份需要 owning caller 提供精确 `MarkdownIdentityBinding`（Artifact 全 Scope、baseRevisionRef、baselineMappingRef），并与 sidecar 的 Artifact/Project/candidateOutputId/base/mapping/profile/document/raw bytes 逐项相等；materialized sourceNodes/sourceColumns 与 sidecar 逐项完整对账（精确 path/type/身份/parent/ordinal 与每表列覆盖），缺项、额外项或错绑定一律 `ARTIFACT_MARKDOWN_IDENTITY_INVALID`。
- `buildMarkdownIdentityMap` 与 `verifyMarkdownRoundTrip`（`parse(render(tree), authoritativeIdentityMap, identityBinding) = tree` 且 cv1 contentHash 相等，出错返回整文件 `ARTIFACT_MARKDOWN_LOSSY`）。
- 稳定错误码：`ARTIFACT_MARKDOWN_UNSUPPORTED`、`ARTIFACT_MARKDOWN_UNSAFE`、`ARTIFACT_MARKDOWN_LIMIT`、`ARTIFACT_MARKDOWN_LOSSY`、`ARTIFACT_MARKDOWN_IDENTITY_INVALID`。
- 未改动：旧 STRUCTURED_DOCUMENT/schema 与 Hash、§7.4 Human Edit、§12 execution revision、旧 `request_render@1.0` 接受集、Representation 媒体映射、synthetic Runtime 与历史兼容基线；Markdown 新字段不成为旧请求或旧内容的必填项，也不新增 MARKDOWN `contentType`。
- 已执行证据：fixture、子用例与结果见 [Module-Test-004 已实现子用例](../module-tests/Module-Test-004-Artifact.md#已实现的-markdown-技术子用例270)；配置验证目标（`code`、含 Docker/PostgreSQL 门禁的 `full`）的实际结果记录在 [PR #275](https://github.com/qzhike/zhiju-business-core/pull/275)。`request_markdown_render@1.0`、真实 Binding/Representation/公开下载、真实 Host/Runner、OIDC/HTTP、Browser/平台与独立人工内容验收保持 `NOT RUN`。
