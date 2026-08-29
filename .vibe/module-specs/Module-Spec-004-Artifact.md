# Module-Spec-004-Artifact

版本：v0.1
日期：2026-08-30
状态：`CURRENT MODULE CONTRACT BASELINE / IM-04 WI-01–WI-09 IMPLEMENTATION, PERSISTENCE AND GIT DELIVERY COMPLETE / ISSUE #90–#98 CLOSED / PARENT SCOPED TECHNICAL ACCEPTANCE COMPLETE 2026-08-30 / INDEPENDENT MANUAL AND EXTERNAL BOUNDARIES NOT RUN`

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

当前实现与自动验收已重新核验：聚焦 Unit 为 1 文件/4 passed；全量静态门禁、Contract、全量 Unit（30 个文件/380 passed/265 skipped）和 Persistence（26 个文件/280 passed）均通过，pinned PostgreSQL/Flyway 空库迁移与第二次 migrate no-op 均通过；synthetic procurement-procedure 复核材料见 [`Manual-ART-024.md`](../issue-95-delivery/Manual-ART-024.md)。组合流程中途故障注入仍为 `PARTIAL PASS / INJECTION NOT RUN`，独立人工业务验收及外部边界保持 `NOT RUN`；PR #113 已合入 `main`，Issue #95 已关闭。

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
7. WI-09 本地自动验证已通过：focused Artifact Unit/Contract 为 6 files/69 passed；普通全量 Vitest 为 32 passed/24 skipped files、390 passed/269 skipped tests；Architecture 与 201-operation FULL Contract/200-operation frozen compatibility baseline 通过；pinned PostgreSQL 18.6/Flyway 11.20.3 Persistence 为 28 files/284 passed，空库 V4000–V4004、第二次 migrate no-op 和容器清理通过。`ZJU_ART023_REPORT=1` 可重复输出 exact Query/DAG/Representation UUID、Hash、checksum 与错误码；汇总见 [`../issue-98-delivery/Manual-ART-023.md`](../issue-98-delivery/Manual-ART-023.md)。
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
