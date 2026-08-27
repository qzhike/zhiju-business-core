# IM-04 启动规格审阅与 IM-DG-005 决策材料

版本：v0.1

日期：2026-08-27

状态：`SPEC REVIEW COMPLETE / IM-DG-005 APPROVED 2026-08-27 / USER CONFIRMED DOCUMENT DELIVERY / NO CODE CHANGE`

工作树：`galendai/im-03-enterpriseproject-reference-foundation`

## 1. 审阅范围

本记录用于 IM-04 `Artifact + Canonical Content` 的启动前核对，已对照以下权威材料：

- `.vibe/high-level-docs/HL-Spec.md`；
- `.vibe/high-level-docs/02-zhiju-core-architecture.md`；
- `.vibe/high-level-docs/03-core-contracts.md`；
- `.vibe/high-level-docs/04-domain-model-v0.1.md`；
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`；
- `.vibe/high-level-docs/08-verification-baseline.md`；
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`；
- `.vibe/module-specs/Module-Spec-004-Artifact.md` 与 `.vibe/module-tests/Module-Test-004-Artifact.md`；
- `.vibe/module-specs/Module-Spec-007-IntegrationGateway.md`；
- 当前 `contracts/`、`modules/artifact/` 和 `migrations/artifact/` 实际文件。

## 2. 当前基线与阻塞边界

### 2.1 已冻结的约束

1. Artifact 是长期业务成果身份，不等于 DOCX、XLSX、PDF 或一次 Agent 输出。
2. ArtifactRevision 是不可变内容版本；正式修改必须创建新 Revision。
3. DOCX/XLSX/PDF 是 Representation 或交换格式，不是唯一 Source of Truth。
4. Revision 内容与 Representation 使用不同 Hash 域；Representation 必须绑定精确 Revision、Renderer 身份和输出 checksum。
5. 对象存储与 PostgreSQL 不使用分布式事务，采用 Staging、完整性验证、Link Commit 和受审计 Orphan Cleanup。
6. Renderer 属于 IntegrationGateway 的适配边界；渲染成功仍需由 Artifact 登记 Representation，不能直接形成 Quality、Approval 或 Release 事实。
7. 已有 Render Command/Event 必须复用：`integration.request_render@1.0`、`integration.RenderSucceeded@1.0` 和 `integration.RenderFailed@1.0`；通用 `integration.get_render_attempt@1.0` 可用于状态查询，但不能替代 IM-04 所需的完整 Binding Query。

### 2.2 尚未实现的事实

1. `modules/artifact/src/index.ts` 仍是 Skeleton。
2. `migrations/artifact/V4000__artifact_technical_tables.sql` 只包含 IM-02 标准技术表，不包含 Artifact、Branch、Revision、Representation 或 Binding 业务表。
3. Canonical Document/Workbook 的最小字段、稳定 Unit 身份和 Hash 路线已在规格冻结；可执行版本化 Schema 与 Fixture 尚未实现。
4. Artifact 业务 Repository、Application Handler、Canonical payload/hash 强校验、Diff、对象 Link 和 Orphan Cleanup 尚未实现。
5. Renderer Adapter、真实对象存储、DOCX/XLSX 可打开性与版式人工审阅仍为 `NOT RUN`。

因此，不能把现有 Schema Contract 回归、`V4000` 技术表或 IntegrationGateway 内存运行时切片解释为 IM-04 已完成。

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

| 替代路线 | 拒绝理由 |
|---|---|
| 先把 Canonical Content 做成 opaque JSON/纯文本，之后再定义结构 | 无法稳定实现 Unit Diff、Scope 校验和确定性质量 Gate；后续迁移会改变 Revision Hash 语义。 |
| 直接以 DOCX/XLSX/OOXML 作为 Source of Truth | 格式细节会反向决定业务模型；难以跨格式保持语义、稳定 Unit 身份和可重放 Hash。 |
| Document 与 Workbook 共用一套万能 AST | 会混淆章节/段落与 Sheet/Row/Formula 语义，扩大 v0.1 Schema 和 Renderer 复杂度。 |
| Artifact 直接调用 Renderer 并同步写 Representation | 越过 IntegrationGateway 的 Attempt/UNKNOWN/Receipt 边界，也无法满足外部副作用在业务提交后执行的架构约束。 |
| 在 IM-04 同时实现完整 Office 编辑器、Excel 计算引擎和生产 Ceph | 超出里程碑范围，不能由当前没有真实业务场景的条件证明必要性。 |

## 5. 兼容边界与迁移成本

- 现有 `ContentType` 中的 `STRUCTURED_DOCUMENT`、`WORKBOOK_SPEC` 保留；`OPAQUE_IMPORTED_CONTENT` 继续只表示客户原件/未结构化输入，不宣称可参与结构化 Diff 或 Renderer。
- 现有 `RevisionContent.contentRef`、`contentHash`、`structureSchemaRef`、`RepresentationRegistration` 和 Integration Render Command/Event 可以承载内容与渲染身份；但现有 `integration.get_render_attempt@1.0` 只返回通用 `AdapterAttemptView`，不足以让 Artifact 权威核验完整 RenderRequest/Success Binding。IM-04 必须先以 additive `integration.get_render_attempt_binding@1.0` 冻结只读 Binding View，不能跨模块读库或仅信任 Registration；这不是重复的 Render 执行 Operation。
- 需要新增的是 Artifact Module 内部的 Canonical payload 类型、Schema fixture、对象清单与业务表/Repository，以及 additive `integration.get_render_attempt_binding@1.0`；后者必须作为首个独立 Contract Gate 审阅并落地，不能偷偷修改既有 Query Result 或跨模块读库。
- 如果以后扩展公式计算、复杂版式或更多格式，应以新的 Schema Minor/Major、Renderer Version 和新 Revision/Representation 记录，不重写已封存历史。
- 主要迁移成本集中在 Schema Fixture、Canonical Hash Fixture、对象 Manifest 与 Renderer Adapter；采用共用封装加双领域 Schema 可以把未来格式扩展限制在对应 adapter，不迁移既有 Artifact 身份。

## 6. 决策后的实施顺序

### 已完成的无代码准备

1. 用户已审阅并批准本记录中的 IM-DG-005 推荐路线。
2. 已同步 `HL-Spec.md`、`Module-Spec-004-Artifact.md`、`Module-Test-004-Artifact.md` 和必要的高层 PostgreSQL 逻辑模型。
3. 已形成合成 `ART-023` Document/Workbook Fixture、Canonical Hash Fixture、负向 Fixture 和手动验收表的任务矩阵，但尚未生成可执行 Fixture。

### 用户后续明确启动实现后才可执行

1. 先完成 additive RenderAttempt Binding Query 的 Contract Gate，再建立独立 IM-04 工作树/分支；当前指令明确禁止启动实现。
2. 固定合成 Fixture、Schema Fixture 和跨语言 Hash Fixture，并在测试后清理临时文件。
3. 用户确认文档变更后，才开始第一批 Canonical Schema/Artifact Repository 代码实现。

### 决策冻结后才可写代码

1. Canonical Document/Workbook Schema、类型和校验器。
2. Artifact、Branch、Revision、Parent/Conflict、Representation 的业务 Migration、Repository 和 Application Handler。
3. 对象 Staging、完整性验证、Link Commit、Orphan Cleanup 和 payload/hash 一致性 Gate。
4. 基于精确 Revision 的 Diff 与 Human Edit。
5. IntegrationGateway Renderer Port/适配器以及 IM-05 的 DOCX/XLSX 最小输出验证；Representation Handler 必须晚于 Binding Query。

## 7. IM-04 验收矩阵草案

| 用例 | 输入 | 预期输出 | 当前实际输出 | 当前状态 |
|---|---|---|---|---|
| AF-IM04-D-001 | 版本化 Document/Workbook Schema Fixture | 字段闭合、稳定 Unit 身份、未知 Required Extension 拒绝 | 路线已批准；可执行 Schema 尚未实现 | `NOT RUN` |
| AF-IM04-U-001 | 修改 SEALED Revision 的正文、Hash 或 Parent | 拒绝 `ARTIFACT_REVISION_IMMUTABLE` | 尚无业务实现 | `NOT RUN` |
| AF-IM04-U-002 | 跨 Artifact 或跨 Project Parent/Content Ref | 拒绝 Scope/Lineage 不一致 | 尚无业务实现 | `NOT RUN` |
| AF-IM04-U-003 | 两个精确 Revision 的稳定 Unit/Sheet/Cell 差异 | 只报告 Added/Removed/Changed/Moved，不写入业务事实 | 尚无 Diff 实现 | `NOT RUN` |
| AF-IM04-P-001 | Staging 对象 Hash/Schema 校验后 Link | DB 保存精确 locator/hash/checksum；失败不提交业务 Link | 尚无业务 Repository | `NOT RUN` |
| AF-IM04-P-002 | 对象上传成功后 DB 事务失败 | 业务对象不出现；对象进入可审计 Orphan 流程 | 尚无对象适配器 | `NOT RUN` |
| AF-IM04-E-001 | 同一 Head 的两个 Branch 创建 Revision 并显式 Merge | 两个 Branch 保留；Merge 多 Parent；冲突有显式解决记录 | 尚无 Artifact E2E | `NOT RUN` |
| AF-IM04-E-002 | 已批准/已生效 Revision 后创建新 Draft | 旧 Approval/EffectiveBinding 不变化 | 尚无跨模块 E2E | `NOT RUN` |
| AF-IM04-M-001 | 合成 ART-023 Document/Workbook Fixture | 审核者可定位 Revision Hash、Unit Diff、Branch、Representation 和 Binding | 尚未准备可执行 Fixture | `NOT RUN` |
| AF-IM05-R-001 | 精确 Revision 请求 DOCX/XLSX Render | Attempt、输入 Hash、Renderer 版本、输出 checksum 全链一致 | Renderer 尚未实现 | `DEFERRED TO IM-05` |

## 8. 决策结果

用户于 2026-08-27 批准本记录第 3 节的 IM-DG-005 推荐路线。批准范围包括：

- Canonical Document 与 Workbook 共用不可变封装，但分别使用独立的最小业务 Schema；
- Document Unit、Workbook Sheet/Column/Row/Cell 使用稳定身份；
- Canonical JSON、SchemaRef、Canonicalization Version 和 SHA-256 Content Hash 形成不可变内容寻址边界；
- Diff 使用精确 RevisionRef，结果可重建且不产生新的 Quality/Approval 事实；
- Renderer 复用现有 IntegrationGateway Render Command/Event，通过 Attempt/Adapter/Receipt 回写；Artifact 登记 Representation 前必须先由 additive Binding Query 提供权威完整绑定；
- IM-04 聚焦 Canonical Object/Revision/Repository、Diff、Human Edit 和 Staging/Link/Orphan Cleanup，DOCX/XLSX 实际可打开性和版式验收放到 IM-05。

## 9. 当前交付与下一步

本轮已同步以下文档，记录批准结果但没有写入业务代码：

1. `Implementation-Milestone-Plan-v0.1.md`：IM-DG-005 状态更新为 `USER APPROVED 2026-08-27`；
2. `Deployment-Security-Baseline-v0.1.md`：移除 IM-DG-005 的待批准状态；
3. `HL-Spec.md`：更新当前基线、未完成项与批准路线；
4. `02-zhiju-core-architecture.md`：增加 AD-054 与 Canonical Artifact Model 的批准约束；
5. `07-postgresql-logical-model-v0.1.md`：补充 Artifact Revision Canonical Manifest 和对象 Link 边界；
6. `Module-Spec-004-Artifact.md`：补充 CanonicalContentManifest、Document、WorkbookSpec 和 Renderer 责任边界；
7. `Module-Test-004-Artifact.md`：补充 Schema、Hash、对象事务、Diff 和 Renderer 验收矩阵。

用户已确认提交本轮文档，并要求本次只在 GitHub 建立 IM-04 Work Item，不开始任何 IM-04 开发。因此下一步只执行文档交付、Issue #56 scoped closeout 和 Work Item 建档；不建立 IM-04 工作树或实现分支。真实业务场景、真实 Provider、生产对象存储、公开 HTTP/E2E 和人工版式验收继续保持明确的 `NOT RUN`。
