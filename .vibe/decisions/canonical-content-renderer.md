# Canonical Content 与 Renderer 决策（IM-DG-005）

批准日期：2026-08-27。本文从原始审查记录第 3–5 节保留已批准路线、替代方案与兼容边界；不作新设计决定。

[完整批准及实施历史](../archive/im-04-startup/Review-Record.md)保留原始第 8 节批准记录。实现状态由 [Artifact Spec](../module-specs/Module-Spec-004-Artifact.md)、[IntegrationGateway Spec](../module-specs/Module-Spec-007-IntegrationGateway.md)及各自 Module Test 维护；执行验收见 [#89](https://github.com/qzhike/zhiju-business-core/issues/89)、[#90](https://github.com/qzhike/zhiju-business-core/issues/90) 和 [#125](https://github.com/qzhike/zhiju-business-core/issues/125)。

下面保留原章节编号便于追溯。有关“先实现”“需要新增”等时态描述属于批准时的实施顺序，不表示当前仍未实现；当前 Catalog 已包含 Binding Query。归档不撤销既有冻结约束，也不把历史预期或 NOT RUN 提升为当前 PASS。

## 3. IM-DG-005 推荐冻结内容

用户已批准以下最小路线，作为 IM-04/IM-05 的共同兼容边界：

### 3.1 Canonical Content 共用封装

Canonical 内容使用一个不可变、可寻址的共用封装，正文按 `contentType` 分流：

```text
CanonicalContentPayload
├── schemaRef: SchemaRef
├── contentType: STRUCTURED_DOCUMENT | WORKBOOK_SPEC
├── canonicalizationVersion: 1
└── body: typed document/workbook payload

contentHash = SHA-256(canonicalize(CanonicalContentPayload))

CanonicalContentManifest
├── objectRef
├── contentHash
├── byteSize
├── mediaType: application/json
└── storageState: STAGING | LINKED | FROZEN | QUARANTINED
```

约束如下：

- Canonical bytes 是 `schemaRef`、`contentType`、`canonicalizationVersion` 与 typed `body` 组成的 `CanonicalContentPayload` 经现有 Canonical JSON 规则序列化后的 bytes；`contentHash`、locator、大小、媒体类型和 storage state 不进入自身 Hash 域。
- `contentHash = SHA-256(canonicalize(CanonicalContentPayload))`；Revision contentHash 必须等于该值，Representation checksum 和 Release packageHash 属于其他 Hash 域，不能互相替代。
- `schemaRef` 必须精确指向已注册的 Schema 版本；未知 Major 或未知 Required Extension 拒绝写入。
- Body 只保存业务内容和必要语义元数据，不保存 Prompt、Chain of Thought、临时 workspace 路径或渲染后的二进制。
- 大对象进入受控对象存储；Artifact-owned Content Object Manifest 单独保存 locator、Hash、大小、媒体类型、storage state、加密/保留状态等索引字段。只有 Manifest 已验证为 `FROZEN` 后，SEALED Revision 才能引用它。
- `STRUCTURED_DOCUMENT` 与 `WORKBOOK_SPEC` 共享封装和 Hash 规则，但保持各自的业务 Schema，不强行合并为一种万能 AST。

### 3.2 Structured Document 最小 Schema

第一版只覆盖可定位、可排序、可 Diff、可进行最小 DOCX/PDF 渲染的结构：

```text
Document
├── documentId
├── title
├── units[]
│   ├── unitId                 # stable within the Artifact lineage
│   ├── parentUnitId?
│   ├── unitType               # SECTION | PARAGRAPH | TABLE | TABLE_ROW | TABLE_CELL
│   ├── ordinal
│   ├── text?
│   ├── childUnitIds[]
│   ├── semanticMetadata?
│   └── evidenceRefs[]?
└── documentMetadata?
```

`unitId` 是结构化 Diff 和 Scope 校验的稳定定位键；顺序变化不应把未修改正文误判为整篇新内容。版式、字体、页眉页脚和 OOXML 私有细节不进入 v0.1 Canonical Source of Truth。

### 3.3 WorkbookSpec 最小 Schema

第一版只覆盖可定位、可校验、可进行最小 XLSX 渲染的表格语义：

```text
WorkbookSpec
├── workbookId
├── sheets[]
│   ├── sheetId
│   ├── name
│   ├── ordinal
│   ├── columns[]
│   │   ├── columnId
│   │   ├── name
│   │   ├── ordinal
│   │   └── valueType
│   ├── rows[]
│   │   ├── rowId
│   │   ├── ordinal
│   │   └── cells[]
│   │       ├── cellId
│   │       ├── columnId
│   │       ├── value?
│   │       ├── valueType
│   │       └── formula?
│   ├── validationRules[]?
│   └── crossRecordRules[]?
└── workbookMetadata?
```

表、列、行和单元格均需要稳定 ID；Excel 坐标只是 Representation 层映射。v0.1 不承诺完整 Excel 特性、宏、外部链接、计算引擎或复杂版式可逆还原。

### 3.4 Diff 与 Human Edit

- Diff 只接受两个精确的 `ContentAddressedRef<ArtifactRevision>`，读取双方已封存 Canonical Content。
- 基本结果按稳定 Unit/Sheet/Row/Cell 身份报告 Added、Removed、Changed 和 Moved；Diff 是可重建查询结果，不改写 Revision，也不冒充 Quality Gate 或 Approval 事实。
- IM-04 的基础 Diff 是 Workspace/Application 内部派生能力；公共边界继续使用既有 `artifact.get_revision_diff_inputs@1.0` 获取双方精确快照与共同祖先，该 Query 不计算或保存 Diff。若未来需要对外公开 Diff Result，必须另行作出 additive Contract 决策，不在 IM-DG-005 中隐式扩展 Catalog。
- Human Edit 以 base Revision Hash 和明确 `allowedUnitRefs` 提交；成功后生成新 Draft/Revision，不能原地修改 SEALED Revision。
- Merge 仍是 Artifact 内显式多 Parent DAG；冲突必须记录并由 Human/授权主体显式解决，不使用 last-write-wins。

### 3.5 Renderer 技术路线

Renderer 采用“Core 提交后 Attempt + 适配器 + 精确回写”的路线：

```text
Artifact exact Revision + Canonical Content Hash
    ↓
integration.request_render@1.0
    ↓
RenderAttempt (IntegrationGateway)
    ↓
versioned format adapter / renderer process
    ↓
staging object + output checksum + raw receipt
    ↓
integration.RenderSucceeded@1.0 or RenderFailed@1.0
    ↓
Artifact.register_representation@1.0
```

冻结原则：

1. Renderer 只能读取精确 Canonical Revision，不读取 `latest`，不直接读写 Artifact 业务表。
2. 输入身份至少绑定 `revisionRef`、Canonical `inputHash`、`outputFormat`、`rendererId` 和 `rendererVersion`。
3. 成功只报告输出对象 locator/checksum 和 Renderer 事实；Artifact 验证 Revision/Attempt/Checksum 后登记不可变 Representation。
4. 同一精确 render identity 可幂等复用；任何输入 Hash、Renderer 版本或输出 checksum 变化都形成新 Attempt/Representation。
5. IM-04 先冻结 RenderAttempt Binding Query，再实现 Canonical Object/Revision/Repository、Diff、Human Edit 和 Staging/Link/Orphan Cleanup；DOCX/XLSX Renderer 的可打开性与版式人工验收放在 IM-05。
6. 本阶段采用本地/CI 可替换的 Renderer Port 和合成 Fixture；真实 Ceph RGW、生产部署、Provider Conformance 和人工业务适用性不因测试通过而自动变为 `PASS`。

## 4. 被拒绝的替代路线

| 替代路线                                                       | 拒绝理由                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 先把 Canonical Content 做成 opaque JSON/纯文本，之后再定义结构 | 无法稳定实现 Unit Diff、Scope 校验和确定性质量 Gate；后续迁移会改变 Revision Hash 语义。                  |
| 直接以 DOCX/XLSX/OOXML 作为 Source of Truth                    | 格式细节会反向决定业务模型；难以跨格式保持语义、稳定 Unit 身份和可重放 Hash。                             |
| Document 与 Workbook 共用一套万能 AST                          | 会混淆章节/段落与 Sheet/Row/Formula 语义，扩大 v0.1 Schema 和 Renderer 复杂度。                           |
| Artifact 直接调用 Renderer 并同步写 Representation             | 越过 IntegrationGateway 的 Attempt/UNKNOWN/Receipt 边界，也无法满足外部副作用在业务提交后执行的架构约束。 |
| 在 IM-04 同时实现完整 Office 编辑器、Excel 计算引擎和生产 Ceph | 超出里程碑范围，不能由当前没有真实业务场景的条件证明必要性。                                              |

## 5. 兼容边界与迁移成本

- 现有 `ContentType` 中的 `STRUCTURED_DOCUMENT`、`WORKBOOK_SPEC` 保留；`OPAQUE_IMPORTED_CONTENT` 继续只表示客户原件/未结构化输入，不宣称可参与结构化 Diff 或 Renderer。
- 现有 `RevisionContent.contentRef`、`contentHash`、`structureSchemaRef`、`RepresentationRegistration` 和 Integration Render Command/Event 可以承载内容与渲染身份；但现有 `integration.get_render_attempt@1.0` 只返回通用 `AdapterAttemptView`，不足以让 Artifact 权威核验完整 RenderRequest/Success Binding。IM-04 必须先以 additive `integration.get_render_attempt_binding@1.0` 冻结只读 Binding View，不能跨模块读库或仅信任 Registration；这不是重复的 Render 执行 Operation。
- 需要新增的是 Artifact Module 内部的 Canonical payload 类型、Schema fixture、对象清单与业务表/Repository，以及 additive `integration.get_render_attempt_binding@1.0`；后者必须作为首个独立 Contract Gate 审阅并落地，不能偷偷修改既有 Query Result 或跨模块读库。
- 如果以后扩展公式计算、复杂版式或更多格式，应以新的 Schema Minor/Major、Renderer Version 和新 Revision/Representation 记录，不重写已封存历史。
- 主要迁移成本集中在 Schema Fixture、Canonical Hash Fixture、对象 Manifest 与 Renderer Adapter；采用共用封装加双领域 Schema 可以把未来格式扩展限制在对应 adapter，不迁移既有 Artifact 身份。
