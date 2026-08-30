# Zhiju Core Domain Model v0.1

版本：v0.1
设计阶段：Project Domain + Task / Execution Domain + Artifact / Quality Domain
日期：2026-08-12
状态：`CURRENT DOMAIN BASELINE / IM-03 WI-01–WI-12 IMPLEMENTATION VERIFIED / SYNTHETIC COMPOSED CONTROLLED PERSISTENCE PASS / ISSUE #57–#68 CLOSED / ISSUE #56 EXIT GATE PENDING / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

文档角色：Aggregate、Entity、Value Object、状态机、Command、Domain Event、权限和 Domain Invariant 的唯一权威。跨 Aggregate 协作以 `05` 为准，模块所有权以 `02` 为准，验证总口径以 `08` 为准。

## 1. 文档目标

本文继续 [`02-zhiju-core-architecture.md`](./02-zhiju-core-architecture.md) 中的 Domain Model v0.1，详细设计三条核心业务链：

1. Project Domain：客户资料、客户基线、参考与法规范围、差距和交付承诺；
2. Task / Execution Domain：业务任务、执行授权、Runtime 尝试、执行结果和人工输入；
3. Artifact / Quality Domain：正式成果身份、不可变 Revision、Evidence、Quality Gate、ReviewIssue、Human Approval 和 Release。

每个概念均定义：

- 业务含义；
- Aggregate / Entity / Value Object 类型；
- Aggregate 边界与关系；
- Commands；
- Lifecycle；
- Invariants；
- Domain Events；
- 权限；
- Unit Test 与 E2E acceptance cases。

本文只定义业务语义，不映射 PostgreSQL、ORM、REST、MCP、飞书 API 或 UI。

2026-08-12，用户确认 Domain 设计基本没有大的问题并允许继续后续设计。三条 Domain 链现作为当前设计基准；仍可通过正式决定修订，但任何状态都不代表实现或测试完成。

---

## 2. 已确认的设计输入

### 2.1 业务输入

一个 Project 同时面对三个不同的业务世界：

```text
Customer Baseline
客户当前真实有什么

Zhiju Reference Baseline
制巨标准与法规依据是什么

Project Deliverables
本项目承诺交付什么
```

项目的核心推导链是：

```text
Customer Baseline
        +
Template Baseline
        +
Regulatory Profile
        +
Enterprise / Product Facts
        ↓
Gap Analysis
        ↓
Human Decision
        ↓
Approved Delivery Plan
        ↓
Delivery Items
        ↓
Tasks / WorkOrders / Artifacts
```

### 2.2 已冻结边界

1. Enterprise 是长期业务边界，Project 是阶段性工作边界。
2. 客户原始资料只读保留，不能被项目交付物覆盖。
3. “未收到资料”不等于“客户确认不存在”。
4. Template 是制巨参考，不等于法规 Evidence。
5. Agent 可以分类、分析和提出建议，但不能确认高风险事实、法规适用性、交付计划或正式发布。
6. GapAnalysis 不直接创建正式交付承诺。
7. DeliveryPlan 经授权 Human 批准后才形成项目范围基线。
8. 飞书是 MVP 的完整双向 Agent Channel，但飞书消息、话题和文件不是业务 Source of Truth。
9. QM 已弃用；Domain Model 不引用其 Scope、Task、File 或 Memory。

---

## 3. Project Domain 总体边界

### 3.1 Aggregate Map

```text
Project
│
├── SourceMaterial Aggregate *
│   └── 原始字节、来源、完整性、安全与保管链
│
├── CustomerMaterial Aggregate *
│   └── 对一个或多个 SourceMaterial 的业务识别
│
├── CustomerBaseline Aggregate 1..*
│   └── 某一时点客户现状的受控基线版本
│
├── TemplateBaseline Aggregate 0..*
│   └── 项目冻结的制巨模板版本组合
│
├── RegulatoryProfile Aggregate 0..*
│   └── 项目适用法规与 Evidence 范围的版本化判断
│
├── GapAnalysis Aggregate 0..*
│   └── 针对明确输入版本形成的不可变分析结果
│
└── DeliveryPlan Aggregate 0..*
    └── DeliveryItem Entity *
```

这些 Aggregate 都归属一个 Project，但不全部塞入 Project Root。原因是：

- 文件接收、解析、分类和安全检查可能并发；
- 客户资料数量可能很大；
- 法规确认和交付计划批准具有独立权限；
- 不同 Aggregate 具有不同生命周期；
- 高价值基线必须引用明确版本，不能读取“当前最新”后静默变化。

### 3.2 版本引用规则

后续对象必须引用明确版本：

```text
GapAnalysis
├── customerBaselineVersionId
├── templateBaselineVersionId
├── regulatoryProfileVersionId
├── enterpriseProfileSnapshotId
└── qmsConfigurationVersionId

DeliveryPlan
├── sourceGapAnalysisVersionId
└── approvedPlanVersionId
```

禁止只记录：

```text
projectId + use latest
```

否则半年后无法解释当时的分析和交付决定。

### 3.3 一致性方式

跨 Aggregate 不使用大事务隐式更新所有对象，而采用：

```text
Command
    ↓
单个 Aggregate 验证并变更
    ↓
Domain Event
    ↓
Projection / Process Manager 更新派生状态
```

例如客户基线变更后：

```text
CustomerBaselineVersionActivated
    ↓
GapAnalysisMarkedStale
    ↓
DeliveryPlanImpactReviewRequested
```

旧 GapAnalysis 和已批准 DeliveryPlan 不被删除；系统标记其输入已变化，并要求显式重新分析或变更计划。

---

## Part A：客户资料与客户现状

## 4. SourceMaterial

### 4.1 业务含义

`SourceMaterial` 表示系统实际收到的一份原始材料及其保管链。它回答：

> 我们从谁、通过什么渠道、在什么时间，实际收到了哪些原始内容？

典型来源：

- 飞书私聊、群聊或话题中的附件；
- Zhiju Workspace 上传；
- 受控目录导入；
- 邮件或外部集成导入；
- Human 手工录入的声明或备注；
- 监管或标准资料导入。

SourceMaterial 只证明“系统收到了什么”，不证明：

- 文件业务类型已经识别正确；
- 内容真实或完整；
- 内容代表客户当前有效状态；
- 它已经进入 CustomerBaseline；
- 它是正式 Evidence；
- 它可以被用于正式交付。

### 4.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

原因：

- 原始内容必须不可变；
- 需要独立处理 Hash、重复文件、权限、安全扫描和保留策略；
- 大文件接收和解析具有独立生命周期；
- 同一文件可以被识别为多个 CustomerMaterial；
- 同一 CustomerMaterial 也可能由多个 SourceMaterial 共同支持。

建议概念模型：

```text
SourceMaterial
├── id
├── enterpriseId
├── projectId
├── sourceChannel
├── sourceReference
│   ├── feishuTenantId?
│   ├── chatId?
│   ├── threadId?
│   ├── messageId?
│   └── externalRef?
├── submittedBy: HumanPrincipalId | ExternalPartyRef
├── registeredBy: PrincipalId
├── receivedAt
├── originalName
├── mediaType
├── byteLength
├── checksum
├── storageObjectRef
├── custodyStatus
├── securityStatus
├── processingStatus
├── duplicateOf?
├── retentionClass
└── metadata
```

Value Objects：

- `ContentChecksum`；
- `SourceChannelRef`；
- `StorageObjectRef`；
- `RetentionClass`；
- `SecurityScanResult`；
- `MaterialFingerprint`。

### 4.3 关系

```text
Enterprise 1 ── * SourceMaterial
Project    1 ── * SourceMaterial
SourceMaterial * ── * CustomerMaterial
SourceMaterial 1 ── 0..* ParseAttempt
```

与 CustomerMaterial 的多对多关系通过 `MaterialSourceRef` 表达，其中记录：

- 引用范围或页码；
- 该 Source 对业务识别的作用；
- 解析版本；
- Human 确认状态。

### 4.4 Commands

```text
register_source_material
complete_source_upload
record_security_scan
record_integrity_verification
mark_duplicate_source
start_material_processing
record_parse_attempt
quarantine_source_material
release_from_quarantine
archive_source_material
declare_source_unreadable
```

命令不提供：

```text
replace_source_content
edit_source_bytes
mark_as_customer_baseline_directly
```

内容变化必须注册为新的 SourceMaterial。

### 4.5 Lifecycle

使用两个正交状态，避免把安全状态和解析状态混在一起。

保管与安全状态：

```text
RECEIVING
    ↓
RECEIVED
    ↓
VERIFYING
    ├── ACCEPTED
    ├── QUARANTINED
    └── REJECTED

ACCEPTED → ARCHIVED
```

处理状态：

```text
NOT_PROCESSED
    ↓
PROCESSING
    ├── PROCESSED
    ├── PARTIALLY_PROCESSED
    └── UNREADABLE
```

### 4.6 Invariants

1. `enterpriseId` 和 `projectId` 创建后不可变。
2. 完成上传后，原始字节、Checksum、长度和原始文件名不可原地修改。
3. 未通过完整性验证或处于 QUARANTINED 的材料不得进入自动解析、Agent Context 或 CustomerBaseline。
4. 飞书消息附件必须保留 `tenant/chat/thread/message` 来源引用和提交人身份。
5. 同一 Checksum 可以被标为重复，但不能静默丢弃；不同来源的重复接收仍需保留审计关系。
6. `submittedBy` 必须是已映射并授权的 Principal；不得使用共享管理员身份代替真实用户。
7. SourceMaterial 的出现不自动生成 BusinessFact、CustomerMaterial 或 Evidence。
8. 解析失败不得改变原始材料状态或内容。
9. 被撤回的飞书消息不导致已接收材料被物理删除；应记录撤回事件并按保留策略处理。
10. 跨 Project 转发的文件必须注册新的来源关系，并重新执行权限检查。

### 4.7 Domain Events

```text
SourceMaterialRegistered
SourceMaterialUploadCompleted
SourceMaterialIntegrityVerified
SourceMaterialQuarantined
SourceMaterialRejected
SourceMaterialDuplicateDetected
SourceMaterialProcessingStarted
SourceMaterialProcessed
SourceMaterialPartiallyProcessed
SourceMaterialDeclaredUnreadable
SourceMaterialArchived
SourceMessageWithdrawn
```

### 4.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 注册本人有权提交的材料 | 允许 | 仅 WorkOrder 授权时 | 飞书/导入 Service 可代表已映射用户执行 |
| 完成上传和校验 | 不直接操作底层状态 | 不允许伪造 | Ingestion Service |
| 查看原始材料 | 按 Enterprise/Project 权限 | 仅 Execution Context 授权范围 | 按 Service Scope |
| 标记重复、不可读候选 | 可提出/确认 | 可提出 | Processing Service 可记录机器结果 |
| 解除隔离 | 特定安全角色 | 不允许 | 仅安全 Service 或授权 Human 命令 |
| 物理删除 | 按保留策略和管理员流程 | 不允许 | Retention Service，且必须审计 |

### 4.9 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| SM-U-001 | Unit | 同一 `SourceMaterialId` 完成上传后再次提交不同字节 | 拒绝 `SOURCE_CONTENT_IMMUTABLE` | NOT RUN：设计阶段 |
| SM-U-002 | Unit | QUARANTINED 材料请求创建解析任务 | 拒绝 `SOURCE_NOT_TRUSTED` | NOT RUN：设计阶段 |
| SM-U-003 | Unit | 同 Checksum 来自不同飞书消息 | 新材料保留并关联 `duplicateOf`，不静默丢弃来源 | NOT RUN：设计阶段 |
| SM-E-001 | E2E | 授权用户在已绑定项目话题上传 DOCX | 建立映射用户的 SourceMaterial，保留消息来源，校验后进入 ACCEPTED；不自动进入 CustomerBaseline | NOT RUN：设计阶段 |
| SM-E-002 | E2E | 用户撤回已上传附件消息 | 记录 SourceMessageWithdrawn；根据保留策略限制使用，但不破坏审计链 | NOT RUN：设计阶段 |

---

## 5. CustomerMaterial

### 5.1 业务含义

`CustomerMaterial` 表示对原始材料业务意义的受控识别，回答：

> 这批原始内容在客户 QMS 业务中是什么？

例如：

```text
SourceMaterial
“体系文件2025最终版.docx”
        ↓ classify
CustomerMaterial
“采购控制程序，客户版本 2025.2，部分完整”
```

一个文件可以包含多个业务材料；一个业务材料也可能由封面、正文、附件和补充说明等多个 SourceMaterial 共同组成。

### 5.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

CustomerMaterial 不是 SourceMaterial 的可编辑元数据字段，而是独立业务对象。原因是：

- 分类可能被 Agent 提出、Human 纠正；
- 业务类型、标题、版本、生效状态和完整性需要独立审查；
- 一个业务材料可引用多个原始来源；
- 它可能被多个 CustomerBaseline 版本引用；
- 重新解析不得覆盖历史分类结论。

建议概念模型：

```text
CustomerMaterial
├── id
├── enterpriseId
├── projectId
├── materialType
├── title
├── customerDocumentNumber?
├── customerVersionLabel?
├── effectiveDate?
├── declaredStatus
├── completeness
├── classificationStatus
├── sourceRefs[]
├── extractedStructureRef?
├── language
├── supersedes?
├── supersededBy?
├── proposedBy
├── confirmedBy?
└── confirmedAt?
```

Value Objects：

- `MaterialType`；
- `MaterialCompleteness`；
- `MaterialSourceRef`；
- `CustomerDocumentIdentity`；
- `ExtractionSnapshotRef`；
- `BusinessClassificationConfidence`。

### 5.3 MaterialType

v0.1 不建立无限可扩展类型系统，先支持稳定分类：

```text
PRODUCT_INFORMATION
QUALITY_MANUAL
PROCEDURE
MANAGEMENT_RULE
RECORD_FORM
ORGANIZATION_INFORMATION
PERSONNEL_INFORMATION
FACILITY_INFORMATION
EQUIPMENT_INFORMATION
SUPPLIER_INFORMATION
CERTIFICATE_OR_LICENSE
AUDIT_OR_INSPECTION_REPORT
OTHER
```

`OTHER` 必须保留 Human 可读说明，不能成为所有未知材料的永久垃圾桶。

### 5.4 关系

```text
SourceMaterial * ── * CustomerMaterial
CustomerMaterial * ── * CustomerBaselineVersion
CustomerMaterial 0..1 ── 0..1 CustomerMaterial (supersession)
CustomerMaterial 1 ── 0..* EvidenceRef
```

### 5.5 Commands

```text
propose_customer_material
attach_material_source
detach_material_source_before_confirmation
revise_material_classification
record_material_completeness
confirm_customer_material
dispute_customer_material
supersede_customer_material
mark_material_not_current
```

确认后的业务识别发生变化时，创建新的识别 Revision 或新 CustomerMaterial 并建立 supersession，而不是静默改写历史。

### 5.6 Lifecycle

```text
PROPOSED
    ↓
UNDER_REVIEW
    ├── CONFIRMED
    ├── DISPUTED
    └── REJECTED

CONFIRMED
    ├── NOT_CURRENT
    └── SUPERSEDED
```

完整性是独立维度：

```text
COMPLETE
PARTIAL
UNKNOWN
UNREADABLE
```

分类状态与内容完整性不能合并。例如分类可以 CONFIRMED，但内容仍是 PARTIAL。

### 5.7 Invariants

1. CustomerMaterial 至少引用一个已 ACCEPTED 的 SourceMaterial。
2. QUARANTINED、REJECTED 或无权限 SourceMaterial 不得成为有效来源。
3. Agent 提出的分类只能进入 PROPOSED，不能直接进入 CONFIRMED。
4. CONFIRMED 必须有授权 Human 或可审计的低风险自动确认 Policy；高风险文件不允许自动确认。
5. `customerVersionLabel` 是客户原文，不等同于 Zhiju ArtifactRevision。
6. COMPLETE 只能表示所识别业务材料内部完整，不能推导客户整体资料齐全。
7. 多个来源冲突时必须进入 DISPUTED，不能按 Agent 置信度静默选择。
8. CustomerMaterial 不可直接变成 Project Deliverable Artifact；必须使用显式创建命令并保留 origin。
9. 被 CustomerBaseline 冻结版本引用的分类不能原地修改。
10. `NOT_CURRENT` 只能表示客户声明或证据显示它不再有效，不等同于删除。

### 5.8 Domain Events

```text
CustomerMaterialProposed
CustomerMaterialSourceAttached
CustomerMaterialClassificationRevised
CustomerMaterialCompletenessRecorded
CustomerMaterialConfirmed
CustomerMaterialDisputed
CustomerMaterialRejected
CustomerMaterialMarkedNotCurrent
CustomerMaterialSuperseded
```

### 5.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 提出材料分类 | 允许 | WorkOrder 授权时允许 | Parser/Classifer 可提出 |
| 修改未确认分类 | 授权项目成员 | 可提出 Revision | 不直接确认 |
| 确认一般资料分类 | 授权项目角色 | 不允许 | 仅显式低风险 Policy |
| 确认关键证书、质量手册有效版本 | 专业授权 Human | 不允许 | 不自动确认 |
| 标记冲突 | 允许 | 允许提出 | 可基于规则自动标记 |
| 标记 superseded | 授权 Human，需来源 | 不允许最终决定 | 可执行已批准命令 |

### 5.10 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CM-U-001 | Unit | Agent 对 ACCEPTED DOCX 提出 `PROCEDURE` 分类 | 创建 PROPOSED CustomerMaterial，不是 CONFIRMED | NOT RUN：设计阶段 |
| CM-U-002 | Unit | CustomerMaterial 引用 QUARANTINED SourceMaterial | 拒绝 `INVALID_MATERIAL_SOURCE` | NOT RUN：设计阶段 |
| CM-U-003 | Unit | 两份来源对客户版本号冲突 | 状态进入 DISPUTED，不覆盖原值 | NOT RUN：设计阶段 |
| CM-E-001 | E2E | 飞书上传一份包含三份程序的合并 DOCX | 一个 SourceMaterial 可形成三个待确认 CustomerMaterial，并保留页码/章节来源 | NOT RUN：设计阶段 |
| CM-E-002 | E2E | Human 确认客户质量手册分类后 Agent 重新解析出不同标题 | 原确认记录保持不变；创建修订提议并要求 Human Review | NOT RUN：设计阶段 |

---

## 6. CustomerBaseline

### 6.1 业务含义

`CustomerBaseline` 表示 Project 在某一明确时点对“客户当前真实状态”的受控认识。它回答：

> 在这个项目阶段，我们确认客户已经有什么、缺什么、没有收到什么、哪些仍未知？

CustomerBaseline 不是文件列表。它同时包含：

- 已确认 CustomerMaterial 引用；
- 预期材料目录；
- 每项材料状态；
- 信息完整性；
- 未解决冲突；
- 客户或 Human 的缺失确认；
- 形成该结论的时间和来源。

### 6.2 类型与 Aggregate 边界

类型：`Aggregate Root`，内部产生不可变的 `CustomerBaselineVersion`。

一个 Project 可以随着客户补资料形成多个版本：

```text
CustomerBaseline CB-001
├── V1  项目启动收到 12 份资料
├── V2  客户补充组织架构和设备清单
└── V3  客户确认不存在培训程序
```

Aggregate 管理：

- Baseline 身份；
- 当前工作草稿；
- 确认与冻结；
- active version 指针；
- supersession；
- completeness summary；
- baseline item 状态。

内部 Entity：`BaselineItem`。

```text
BaselineItem
├── id
├── expectedMaterialKey
├── materialType
├── expectedTitleOrRole
├── status
├── customerMaterialRefs[]
├── reason
├── evidenceRefs[]
├── confirmedBy?
└── confirmedAt?
```

### 6.3 MaterialStatus

```text
PRESENT
PARTIAL
MISSING_CONFIRMED
NOT_PROVIDED
UNKNOWN
NOT_APPLICABLE
```

精确定义：

- `PRESENT`：存在已确认且满足该项最低完整性要求的 CustomerMaterial；
- `PARTIAL`：存在已确认材料，但内容或附件不完整；
- `MISSING_CONFIRMED`：客户或授权 Human 明确确认不存在；
- `NOT_PROVIDED`：截至 Baseline 形成时尚未收到；
- `UNKNOWN`：即使经过合理调查仍不能判断有无或适用性；
- `NOT_APPLICABLE`：经引用明确决定后确认该项不适用。

### 6.4 关系

```text
Project 1 ── 1 CustomerBaseline identity
CustomerBaseline 1 ── * CustomerBaselineVersion
CustomerBaselineVersion * ── * CustomerMaterial
CustomerBaselineVersion 1 ── * BaselineItem
CustomerBaselineVersion 1 ── * InformationRequest
```

GapAnalysis 必须引用具体 `CustomerBaselineVersionId`。

### 6.5 Commands

```text
initialize_customer_baseline
add_baseline_expectation
link_confirmed_customer_material
record_material_not_provided
confirm_material_missing
mark_baseline_item_partial
mark_baseline_item_unknown
mark_baseline_item_not_applicable
open_baseline_review
confirm_customer_baseline_version
activate_customer_baseline_version
create_customer_baseline_revision
supersede_customer_baseline_version
```

不提供：

```text
set_missing_because_no_file_uploaded
auto_activate_agent_baseline
```

### 6.6 Lifecycle

```text
DRAFT
    ↓
CAPTURING
    ↓
UNDER_REVIEW
    ├── CONFIRMED
    └── CHANGES_REQUIRED

CONFIRMED
    ↓
ACTIVE
    ↓
SUPERSEDED
```

版本一旦 CONFIRMED 即不可变。新增资料创建新版本，而不是编辑旧版本。

### 6.7 Invariants

1. 只有 CONFIRMED CustomerMaterial 可以支持 PRESENT 或 PARTIAL。
2. 没有收到文件只能得到 NOT_PROVIDED，不能自动得到 MISSING_CONFIRMED。
3. MISSING_CONFIRMED 必须记录客户声明、Human Decision 或其他授权 Evidence。
4. NOT_APPLICABLE 必须引用 QMSConfiguration 或 RegulatoryProfile 中的确认决定。
5. BaselineVersion 一旦 CONFIRMED 不可修改。
6. 一个 Project 同时只能有一个 ACTIVE CustomerBaselineVersion。
7. 激活新版本不删除旧版本，也不自动重写旧 GapAnalysis。
8. Baseline 必须包含未知项和冲突项，不能为了完整率隐藏不确定性。
9. Agent 可以形成草稿和 completeness summary，但不能确认或激活 BaselineVersion。
10. CustomerBaseline 只描述客户现状，不创建 DeliveryItem，不修改 Artifact。
11. 企业或产品关键事实冲突应引用 EnterpriseFact/ProjectFact 流程，不能只藏在 BaselineItem 备注。
12. 跨 Enterprise 的 CustomerMaterial 不得加入当前 Baseline。

### 6.8 Domain Events

```text
CustomerBaselineInitialized
BaselineExpectationAdded
ConfirmedCustomerMaterialLinked
BaselineItemMarkedNotProvided
BaselineItemMissingConfirmed
BaselineItemMarkedPartial
BaselineItemMarkedUnknown
BaselineItemMarkedNotApplicable
CustomerBaselineReviewOpened
CustomerBaselineChangesRequested
CustomerBaselineVersionConfirmed
CustomerBaselineVersionActivated
CustomerBaselineVersionSuperseded
```

重要后续反应：

```text
CustomerBaselineVersionActivated
    ↓
mark dependent GapAnalysis as STALE
    ↓
request DeliveryPlan impact review
```

### 6.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 建立 Baseline 草稿 | 项目成员 | 授权 WorkOrder 可执行 | 可从导入流程初始化 |
| 关联已确认 CustomerMaterial | 项目成员 | 可提出 | Process Manager 可执行已授权命令 |
| 标记 NOT_PROVIDED | 项目成员 | 可根据系统接收情况提出 | 可生成候选，不直接确认整体版本 |
| 确认 MISSING_CONFIRMED | 授权 Human | 不允许 | 不自动执行 |
| 确认/激活 BaselineVersion | 项目经理或指定质量角色 | 不允许 | 仅执行已认证 Human 命令 |
| 标记 STALE 依赖 | 不需手工 | 不直接 | Process Manager |

### 6.10 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| CB-U-001 | Unit | 没有任何培训程序文件，Agent 请求设为 MISSING_CONFIRMED | 拒绝；只允许 NOT_PROVIDED 或 UNKNOWN | NOT RUN：设计阶段 |
| CB-U-002 | Unit | 以 PROPOSED CustomerMaterial 支持 PRESENT | 拒绝 `MATERIAL_NOT_CONFIRMED` | NOT RUN：设计阶段 |
| CB-U-003 | Unit | 激活第二个 BaselineVersion | 新版本 ACTIVE，旧版本 SUPERSEDED，旧版本内容不变 | NOT RUN：设计阶段 |
| CB-E-001 | E2E | 项目启动收到质量手册和部分程序，客户未回答培训程序是否存在 | Baseline 显示 PRESENT、PARTIAL、NOT_PROVIDED/UNKNOWN 的真实组合，不自动创建培训程序交付项 | NOT RUN：设计阶段 |
| CB-E-002 | E2E | 客户后来通过飞书确认“没有培训程序”并补充组织架构 | 经身份和证据确认后创建新 BaselineVersion；原 GapAnalysis 标为 STALE | NOT RUN：设计阶段 |

---

## Part B：制巨参考与法规范围

## 7. TemplateBaseline

### 7.1 业务含义

`TemplateBaseline` 表示一个 Project 明确选定并冻结的制巨模板版本组合。它回答：

> 本项目比较和起草时，以制巨哪一套、哪些版本的模板为参考？

它不是“始终使用模板库 latest”，也不是一个文件夹路径。

### 7.2 类型与 Aggregate 边界

类型：`Aggregate Root`，项目拥有、版本化、冻结后不可变。

组织级模板库中的 `Template` / `TemplateVersion` 属于另一个长期 Aggregate。Project 的 TemplateBaseline 只保存受控引用和项目级选择。

建议模型：

```text
TemplateBaseline
├── id
├── enterpriseId
├── projectId
├── version
├── status
├── templateSetRef?
├── selections[]
├── selectionRationale
├── compatibleSetVersion?
├── createdBy
├── reviewedBy?
├── frozenBy?
└── frozenAt?

TemplateSelection
├── deliveryCategory
├── templateId
├── templateVersionId
├── applicabilityScope
├── selectionReason
└── replacementFor?
```

内部 Value Objects：

- `TemplateVersionRef`；
- `ApplicabilityScope`；
- `TemplateCompatibilityRef`；
- `SelectionRationale`。

### 7.3 关系

```text
Project 1 ── 0..* TemplateBaselineVersion
TemplateBaselineVersion * ── * TemplateVersion
GapAnalysis * ── 1 TemplateBaselineVersion
DeliveryPlan * ── 1 TemplateBaselineVersion
ArtifactRevision * ── * TemplateVersionRef
```

TemplateBaseline 可以没有某个交付类别的模板，这应表现为显式缺口，而不是自动选择“相近模板”。

### 7.4 Commands

```text
initialize_template_baseline
select_template_version
remove_template_selection_before_freeze
replace_template_selection_before_freeze
record_template_selection_rationale
open_template_baseline_review
freeze_template_baseline
create_template_baseline_revision
supersede_template_baseline
```

禁止：

```text
use_latest_template_implicitly
mutate_frozen_template_selection
treat_template_as_regulatory_evidence
```

### 7.5 Lifecycle

```text
DRAFT
    ↓
UNDER_REVIEW
    ├── FROZEN
    └── CHANGES_REQUIRED

FROZEN
    ↓
SUPERSEDED
```

FROZEN 后不能修改。模板更新需要创建新的 BaselineVersion，并触发影响评估。

### 7.6 Invariants

1. 所有选择必须引用不可变 TemplateVersion，而不是可变 `latest` alias。
2. FROZEN 后 selections 不可修改。
3. 同一 applicability scope 中不能存在互相不兼容且未解释的模板版本。
4. 模板适用性理由必须与 Product Scope、QMSConfiguration 或 Human Decision 关联。
5. Template 不得作为“法规要求”的唯一 Evidence。
6. Agent 可以推荐 TemplateSelection，但不能冻结 TemplateBaseline。
7. 模板库弃用版本不会自动替换进行中 Project 的 FROZEN Baseline。
8. 使用已弃用或过期模板必须有明确风险提示和 Human Decision。
9. 激活新 TemplateBaseline 不自动重写已批准 Artifact 或 DeliveryPlan。
10. 跨组织私有模板不得在无授权时被当前 Project 引用。

### 7.7 Domain Events

```text
TemplateBaselineInitialized
TemplateVersionSelected
TemplateSelectionRemoved
TemplateSelectionReplaced
TemplateSelectionRationaleRecorded
TemplateBaselineReviewOpened
TemplateBaselineChangesRequested
TemplateBaselineFrozen
TemplateBaselineSuperseded
TemplateBaselineImpactReviewRequested
```

### 7.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 推荐模板 | 允许 | 允许提出 | Recommendation Service 可提出 |
| 编辑 DRAFT selection | 授权项目角色 | WorkOrder 限定范围内可提出 | 不直接冻结 |
| 冻结 Baseline | 项目经理/专业授权角色 | 不允许 | 仅执行 Human 命令 |
| 使用弃用模板 | 必须特定 Human 决定 | 不允许最终决定 | 可阻止或告警 |
| 读取模板正文 | 按模板和项目权限 | 仅 Context 所需范围 | Rendering/Context Service |

### 7.9 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| TB-U-001 | Unit | FROZEN Baseline 中替换采购程序模板版本 | 拒绝 `TEMPLATE_BASELINE_IMMUTABLE` | NOT RUN：设计阶段 |
| TB-U-002 | Unit | TemplateSelection 使用 `latest` 而非 versionId | 拒绝 `EXPLICIT_TEMPLATE_VERSION_REQUIRED` | NOT RUN：设计阶段 |
| TB-U-003 | Unit | Agent 请求冻结 Baseline | 拒绝 `HUMAN_CONFIRMATION_REQUIRED` | NOT RUN：设计阶段 |
| TB-E-001 | E2E | 项目冻结 Template Set v3 后组织发布 v4 | 项目仍引用 v3；系统提示新版本但不自动改变项目 | NOT RUN：设计阶段 |
| TB-E-002 | E2E | Human 决定迁移到 v4 | 创建新 TemplateBaselineVersion，原 GapAnalysis 标为 STALE，已批准 Artifact 不变 | NOT RUN：设计阶段 |

---

## 8. RegulatoryProfile

### 8.1 业务含义

`RegulatoryProfile` 表示在明确 Enterprise、Product、QMSConfiguration 和 Project Scope 下，对适用法规、标准、条款和证据集合形成的版本化判断。它回答：

> 这个项目受哪些外部要求约束，哪些不适用，哪些尚未确认？

RegulatoryProfile 不是全文法规库，也不是一次 RAG 搜索结果。

### 8.2 类型与 Aggregate 边界

类型：`Aggregate Root`，项目拥有、版本化。

内部 Entity：`RegulatoryApplicabilityItem`。

```text
RegulatoryProfile
├── id
├── enterpriseId
├── projectId
├── version
├── status
├── scopeSnapshotRefs
├── items[]
├── createdBy
├── confirmedBy?
├── activatedBy?
└── activatedAt?

RegulatoryApplicabilityItem
├── id
├── authoritySourceId
├── authorityVersionId
├── clauseScope?
├── applicability
├── rationale
├── evidenceRefs[]
├── effectiveFrom?
├── effectiveTo?
├── decisionSource
└── riskLevel
```

Applicability：

```text
APPLICABLE
NOT_APPLICABLE
PARTIALLY_APPLICABLE
PENDING_DETERMINATION
SUPERSEDED
```

### 8.3 关系

```text
RegulatoryProfileVersion * ── 1 EnterpriseProfileSnapshot
RegulatoryProfileVersion * ── 1 QMSConfigurationVersion
RegulatoryProfileVersion 1 ── * RegulatoryApplicabilityItem
RegulatoryApplicabilityItem * ── * Evidence
GapAnalysis * ── 1 RegulatoryProfileVersion
QualityProfile * ── * RegulatoryApplicabilityItem
```

Enterprise 级 QMSConfiguration 可以已有适用性决定；Project RegulatoryProfile 应引用或收窄这些决定，不应无声复制成不同结论。

### 8.4 Commands

```text
initialize_regulatory_profile
propose_regulatory_applicability
attach_regulatory_evidence
revise_applicability_rationale
mark_applicability_pending
confirm_regulatory_applicability
open_regulatory_profile_review
activate_regulatory_profile
create_regulatory_profile_revision
supersede_regulatory_profile
record_authority_version_change
```

### 8.5 Lifecycle

```text
DRAFT
    ↓
UNDER_PROFESSIONAL_REVIEW
    ├── CONFIRMED
    └── CHANGES_REQUIRED

CONFIRMED
    ↓
ACTIVE
    ↓
SUPERSEDED
```

当法规来源更新、Product Scope 变化或 QMSConfiguration 变化时，ACTIVE Profile 不被改写，而是标为影响评估需要，并创建新 Revision。

### 8.6 Invariants

1. APPLICABLE、NOT_APPLICABLE 和 PARTIALLY_APPLICABLE 必须有 rationale 与 Evidence 或明确 ProfessionalDecision。
2. Agent 只能提出 applicability，不能确认高风险法规适用性。
3. PENDING_DETERMINATION 必须保持可见，不能在 Context 中被当作不适用。
4. 同一 authority/version/clause/scope 不得同时存在互相冲突的 ACTIVE 结论。
5. ACTIVE Profile 必须引用明确 EnterpriseProfileSnapshot、Product Scope 和 QMSConfigurationVersion。
6. Evidence 必须可定位到权威来源和版本；搜索摘要不能单独成为权威 Evidence。
7. 法规版本更新不自动改变历史 Profile。
8. GapAnalysis 和 Artifact 的法规判断必须引用明确 ProfileVersion。
9. 模板内容不能作为确认适用性的唯一证据。
10. 跨 Enterprise 的私有专业判断不得无授权复用；公司级通用知识需有独立治理。
11. 一个 Project 同时只能有一个 ACTIVE RegulatoryProfileVersion。
12. Profile 未 ACTIVE 时可以支持探索性分析，但不能支持正式 Approval/Release Gate。

### 8.7 Domain Events

```text
RegulatoryProfileInitialized
RegulatoryApplicabilityProposed
RegulatoryEvidenceAttached
ApplicabilityRationaleRevised
RegulatoryApplicabilityConfirmed
RegulatoryProfileReviewOpened
RegulatoryProfileChangesRequested
RegulatoryProfileConfirmed
RegulatoryProfileActivated
RegulatoryProfileSuperseded
RegulatoryAuthorityVersionChanged
RegulatoryImpactReviewRequested
```

### 8.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 检索法规和提出适用性 | 允许 | 授权 WorkOrder 可执行 | Evidence Service 可返回候选 |
| 附加 Evidence 候选 | 允许 | 允许提出 | Evidence Ingestion Service |
| 确认低/中风险适用性 | 具专业权限 Human | 不允许 | 不自动确认 |
| 确认高风险/不适用决定 | 指定法规或质量角色 | 不允许 | 不自动确认 |
| 激活 Profile | 授权 Human | 不允许 | 仅执行 Human 命令 |
| 标记来源版本变化 | 可人工 | 可报告 Finding | Authority Monitoring Service |

### 8.9 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| RP-U-001 | Unit | Agent 提出某条款 NOT_APPLICABLE 且无 Evidence | 保持 PROPOSED/PENDING，不得确认 | NOT RUN：设计阶段 |
| RP-U-002 | Unit | 激活 Profile 时存在高风险 PENDING_DETERMINATION | 按 Policy 拒绝激活或要求显式例外决定 | NOT RUN：设计阶段 |
| RP-U-003 | Unit | 同一条款添加冲突的 ACTIVE applicability | 拒绝 `CONFLICTING_APPLICABILITY` | NOT RUN：设计阶段 |
| RP-E-001 | E2E | Agent 检索法规并提出适用项，专业 Human 审查确认 | 形成 ACTIVE ProfileVersion，保留 Evidence、提议者和确认者 | NOT RUN：设计阶段 |
| RP-E-002 | E2E | 权威法规发布新版本 | 旧 Profile 不变；产生影响评估事件并创建修订任务候选 | NOT RUN：设计阶段 |

---

## Part C：差距与交付承诺

## 9. GapAnalysis

### 9.1 业务含义

`GapAnalysis` 表示针对一组明确输入版本形成的差距分析结果。它回答：

> 客户现状与目标体系之间有哪些差距，依据是什么，建议如何处理？

GapAnalysis 是分析和建议，不是批准后的项目范围，也不是自动工作流。

### 9.2 类型与 Aggregate 边界

类型：`Aggregate Root`，每个完成的分析版本不可变。

内部 Entity：`GapItem`。

```text
GapAnalysis
├── id
├── enterpriseId
├── projectId
├── version
├── status
├── inputSnapshot
├── items[]
├── summary
├── generatedBy
├── reviewedBy?
├── acceptedBy?
└── acceptedAt?

GapItem
├── id
├── subjectKey
├── subjectType
├── customerBaselineItemRefs[]
├── templateRefs[]
├── regulatoryItemRefs[]
├── gapStatus
├── severity
├── rationale
├── evidenceRefs[]
├── recommendedAction
├── informationRequestRefs[]
└── reviewDisposition?
```

GapStatus：

```text
MATCH
MINOR_GAP
MAJOR_GAP
MISSING
EXTRA
UNKNOWN
NOT_APPLICABLE
```

RecommendedAction：

```text
KEEP
REVISE
REPLACE
CREATE
REMOVE
NEED_INFORMATION
HUMAN_REVIEW
```

### 9.3 InputSnapshot

每个 GapAnalysis 必须冻结：

```text
customerBaselineVersionId
templateBaselineVersionId
regulatoryProfileVersionId
enterpriseProfileSnapshotId
qmsConfigurationVersionId
productScopeSnapshotId
analysisPolicyVersion
```

如果某项基线尚未建立，不能用隐式空值冒充“无差距”；必须产生前置阻塞或明确的 exploratory analysis。

### 9.4 关系

```text
GapAnalysisVersion * ── 1 InputSnapshot
GapAnalysisVersion 1 ── * GapItem
GapItem * ── * BaselineItem / TemplateVersion / RegulatoryItem / Evidence
DeliveryPlanVersion * ── 1 Accepted GapAnalysisVersion
GapItem 0..* ── 0..* DeliveryItem
```

### 9.5 Commands

```text
start_gap_analysis
add_gap_item
revise_draft_gap_item
record_gap_evidence
create_gap_information_request
complete_gap_analysis
open_gap_analysis_review
accept_gap_analysis
reject_gap_analysis
mark_gap_analysis_stale
supersede_gap_analysis
```

GapAnalysis 接受后仍不能直接创建 APPROVED DeliveryPlan。可由另一个显式命令生成 DeliveryPlan Draft。

### 9.6 Lifecycle

```text
DRAFT
    ↓
ANALYZING
    ↓
COMPLETED
    ↓
UNDER_REVIEW
    ├── ACCEPTED
    ├── CHANGES_REQUIRED
    └── REJECTED

ACCEPTED
    ├── STALE
    └── SUPERSEDED
```

STALE 表示输入版本已变化，但不抹除当时分析。旧计划仍可引用它，同时必须显示风险。

### 9.7 Invariants

1. 每个 Analysis 必须引用完整且不可变的 InputSnapshot。
2. UNKNOWN BaselineItem 不得被分析成 MISSING；应保持 UNKNOWN 并建议 NEED_INFORMATION。
3. NOT_PROVIDED 不得自动推导 CREATE，除非 Policy 和 Human Decision 允许。
4. NOT_APPLICABLE 必须有 RegulatoryProfile/QMSConfiguration 决定支持。
5. MAJOR_GAP 或高风险 GapItem 必须有 Evidence 或明确说明信息不足。
6. Agent 可以生成和完成分析草稿，但不能 ACCEPT。
7. ACCEPTED Analysis 不可修改；修订产生新版本。
8. 输入任一 ACTIVE Version 变化后，依赖 Analysis 必须可被标为 STALE。
9. GapAnalysis 不创建 Artifact，不改变 DeliveryItem，不确认客户事实。
10. RecommendedAction 是建议，不是授权命令。
11. 汇总数字必须从 GapItem 派生，不能与明细分叉。
12. 跨 Project 的 GapItem 不得复制为当前项目正式结论；只能作为参考并重新验证输入。

### 9.8 Domain Events

```text
GapAnalysisStarted
GapItemAdded
GapItemRevised
GapEvidenceRecorded
GapInformationRequested
GapAnalysisCompleted
GapAnalysisReviewOpened
GapAnalysisAccepted
GapAnalysisChangesRequested
GapAnalysisRejected
GapAnalysisMarkedStale
GapAnalysisSuperseded
DeliveryPlanDraftRequested
```

### 9.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 启动分析 | 项目成员 | WorkOrder 授权时 | Coordinator Process 可创建任务，不直接接受 |
| 添加/修改 DRAFT GapItem | 允许 | 允许 | 规则引擎可生成确定性 Gap |
| 完成分析 | 允许 | 允许提交 COMPLETED | 可汇总结果 |
| 接受/拒绝 | 项目经理或专业角色 | 不允许 | 仅执行 Human 命令 |
| 标记 STALE | 可人工 | 可报告输入变化 | Process Manager 自动执行 |

### 9.10 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| GA-U-001 | Unit | BaselineItem=UNKNOWN，Agent 添加 GapStatus=MISSING | 拒绝或规范为 UNKNOWN + NEED_INFORMATION | NOT RUN：设计阶段 |
| GA-U-002 | Unit | Analysis 不含 TemplateBaselineVersionId | 非探索模式下拒绝 `INCOMPLETE_ANALYSIS_INPUT` | NOT RUN：设计阶段 |
| GA-U-003 | Unit | Agent 请求 ACCEPT Analysis | 拒绝 `HUMAN_ACCEPTANCE_REQUIRED` | NOT RUN：设计阶段 |
| GA-E-001 | E2E | 对客户采购程序 PARTIAL、模板已冻结、法规已确认执行分析 | 形成带来源、GapStatus、Severity 和 RecommendedAction 的 COMPLETED 分析；Human 接受后才能生成计划草稿 | NOT RUN：设计阶段 |
| GA-E-002 | E2E | 接受分析后客户补充新程序版本 | 原 Analysis 标 STALE；原 DeliveryPlan 不自动改写，产生影响复核任务 | NOT RUN：设计阶段 |

---

## 10. DeliveryPlan

### 10.1 业务含义

`DeliveryPlan` 表示 Project 经 Human 批准的交付范围、交付项、依赖和质量要求。它回答：

> 这个项目正式承诺交付什么，以及按什么要求验收？

DeliveryPlan 不是 Agent 自动生成的 Task 列表。它是业务承诺基线。

### 10.2 类型与 Aggregate 边界

类型：`Aggregate Root`，内部包含 `DeliveryItem Entity`，计划版本不可变。

```text
DeliveryPlan
├── id
├── enterpriseId
├── projectId
├── version
├── status
├── sourceGapAnalysisVersionId
├── baselineRefs
├── items[]
├── milestones[]
├── assumptions[]
├── exclusions[]
├── planQualityPolicyRef
├── proposedBy
├── approvedBy?
├── approvedAt?
└── activatedAt?
```

Value Objects：

- `PlanAssumption`；
- `PlanExclusion`；
- `Milestone`；
- `DeliveryDependency`；
- `QualityProfileRef`；
- `DueDateConstraint`。

### 10.3 关系

```text
Project 1 ── 0..* DeliveryPlanVersion
DeliveryPlanVersion 1 ── * DeliveryItem
DeliveryPlanVersion * ── 1 Accepted GapAnalysisVersion
DeliveryItem 0..* ── * Task
DeliveryItem 0..1 ── 0..* Artifact
DeliveryItem * ── * DeliveryItem (dependencies)
```

Project 同时只能有一个 ACTIVE DeliveryPlanVersion。新计划版本批准后替代旧版本，但旧计划及其历史执行记录保留。

### 10.4 Commands

```text
create_delivery_plan_draft
add_delivery_item
revise_delivery_item_before_approval
remove_delivery_item_before_approval
record_plan_assumption
record_plan_exclusion
define_delivery_dependency
assign_quality_profile
submit_delivery_plan_for_review
approve_delivery_plan
request_delivery_plan_changes
activate_delivery_plan
start_delivery_plan_revision
approve_delivery_plan_change
cancel_delivery_plan
complete_delivery_plan
```

禁止：

```text
agent_approve_delivery_plan
mutate_active_plan_in_place
create_official_item_directly_from_gap_recommendation
```

### 10.5 Lifecycle

```text
DRAFT
    ↓
UNDER_REVIEW
    ├── APPROVED
    ├── CHANGES_REQUIRED
    └── REJECTED

APPROVED
    ↓
ACTIVE
    ├── REPLANNING
    ├── COMPLETED
    └── CANCELLED

REPLANNING
    └── 新计划版本 APPROVED / ACTIVE
        旧版本 → SUPERSEDED
```

### 10.6 Invariants

1. 正式 DeliveryPlan 必须来源于 ACCEPTED GapAnalysis 或有明确 Human Exception Decision。
2. APPROVED/ACTIVE PlanVersion 不可修改。
3. 一个 Project 同时只能有一个 ACTIVE PlanVersion。
4. 计划中高风险 DeliveryItem 必须指定 QualityProfile 和 Human Approval 要求。
5. 依赖图不得有环。
6. DeliveryItem 的 enterpriseId/projectId 由 Plan 继承，不能跨项目引用。
7. TemplateBaseline、RegulatoryProfile 或 CustomerBaseline 变化不自动修改计划；必须进入 Impact Review / REPLANNING。
8. Agent 可以生成 Draft、建议 Item、依赖和里程碑，但不能 APPROVE 或 ACTIVATE。
9. 删除已批准范围必须通过新计划版本，并保留取消/排除理由。
10. Plan COMPLETED 必须由所有非取消 DeliveryItem 的正式完成条件派生或有显式例外决定。
11. Task 完成不等于 DeliveryItem 完成；必须满足 Artifact/Approval/Release 等 CompletionCriteria。
12. DeliveryPlan 不保存 Runtime Session 或 Harness-specific 状态。

### 10.7 Domain Events

```text
DeliveryPlanDraftCreated
DeliveryItemAdded
DeliveryItemRevised
DeliveryItemRemoved
PlanAssumptionRecorded
PlanExclusionRecorded
DeliveryDependencyDefined
DeliveryQualityProfileAssigned
DeliveryPlanSubmittedForReview
DeliveryPlanApproved
DeliveryPlanChangesRequested
DeliveryPlanRejected
DeliveryPlanActivated
DeliveryPlanRevisionStarted
DeliveryPlanSuperseded
DeliveryPlanCancelled
DeliveryPlanCompleted
```

### 10.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 Draft | 项目成员 | 授权 WorkOrder 可生成 | 可由已接受 GapAnalysis 触发草稿请求 |
| 编辑 Draft Item | 授权项目成员 | 可提出/执行限定草稿命令 | 不确认范围 |
| 提交 Review | 允许 | 可提交 | 可检查完整性后提交 |
| 批准计划 | 项目经理/授权业务负责人 | 不允许 | 仅执行 Human 命令 |
| 激活计划 | 授权 Human | 不允许 | 可在批准后按 Policy 自动激活，但必须归因于 Human 决定 |
| 变更 ACTIVE Plan | 通过新版本 | 只能提出 | Process Manager 管理替代流程 |
| 完成计划 | 授权 Human 或确定性 Completion Policy | 不允许自报 | Projection/Policy 可计算候选 |

### 10.9 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| DP-U-001 | Unit | Agent 对 DRAFT Plan 执行 approve | 拒绝 `HUMAN_APPROVAL_REQUIRED` | NOT RUN：设计阶段 |
| DP-U-002 | Unit | 为两个 DeliveryItem 建立环形依赖 | 拒绝 `CYCLIC_DELIVERY_DEPENDENCY` | NOT RUN：设计阶段 |
| DP-U-003 | Unit | 修改 ACTIVE Plan 的 Item 标题 | 拒绝；要求 `start_delivery_plan_revision` | NOT RUN：设计阶段 |
| DP-E-001 | E2E | Human 接受 GapAnalysis，Agent 生成计划草稿，Human 修改并批准 | 形成 APPROVED/ACTIVE PlanVersion，保留 Agent 提议与 Human 决定 | NOT RUN：设计阶段 |
| DP-E-002 | E2E | ACTIVE Plan 后 CustomerBaseline 更新并影响三个 Item | Plan 不自动变化；进入影响复核，新版本批准后旧版本 SUPERSEDED | NOT RUN：设计阶段 |

---

## 11. DeliveryItem

### 11.1 业务含义

`DeliveryItem` 表示 DeliveryPlan 中一项明确交付承诺。它回答：

> 这个项目需要交付哪项成果、为什么需要、依赖什么，以及怎样才算完成？

例如：

```text
DI-018 《采购控制程序》
```

DeliveryItem 不是 Artifact、Task 或 WorkOrder：

```text
DeliveryItem
= 项目承诺交什么

Task
= 为实现承诺需要做什么

WorkOrder
= 某次执行具体要做什么

Artifact
= 承载正式成果的长期对象
```

### 11.2 类型与 Aggregate 边界

类型：`Entity within DeliveryPlan Aggregate`。

理由：

- Item 是计划范围的一部分；
- 添加、删除、替换和依赖变化影响整个 Plan 的业务承诺；
- 批准后 Item 定义随 PlanVersion 冻结；
- 执行进度由外部 Task/Artifact/Approval/Release 投影形成，不应频繁修改 Plan Aggregate。

建议模型：

```text
DeliveryItem
├── id                         stable across plan revisions when semantically same
├── itemKey
├── type
├── title
├── objective
├── sourceGapItemRefs[]
├── customerMaterialRefs[]
├── templateRefs[]
├── regulatoryItemRefs[]
├── dependencyItemIds[]
├── targetArtifactType
├── qualityProfileRef
├── completionCriteria
├── dueConstraint?
├── commitmentStatus
├── cancellationReason?
└── replacementRelation?
```

### 11.3 Lifecycle：承诺状态与执行状态必须分开

#### CommitmentStatus：计划内持久状态

```text
PROPOSED
APPROVED
CANCELLED
REPLACED
```

该状态随 DeliveryPlanVersion 冻结。

#### ExecutionStatus：派生投影

```text
NOT_READY
READY
IN_PROGRESS
BLOCKED
IN_REVIEW
APPROVED_OUTPUT
RELEASED
COMPLETED
```

ExecutionStatus 由依赖、Task、ArtifactRevision、Quality Gate、Approval 和 Release 派生，不由 Agent 随意写入。

例如：

```text
所有依赖完成 + 输入可用 → READY
存在 RUNNING Task → IN_PROGRESS
存在 blocking InformationRequest → BLOCKED
Revision 正在 Gate/Review → IN_REVIEW
存在 approvedRevision → APPROVED_OUTPUT
满足 required Release → RELEASED / COMPLETED
```

### 11.4 DeliveryItemType

v0.1 建议：

```text
QUALITY_MANUAL
PROCEDURE
MANAGEMENT_RULE
RECORD_FORM
REGULATORY_ASSESSMENT
GAP_REPORT
TRAINING_MATERIAL
OTHER_CONTROLLED_DOCUMENT
```

类型用于选择默认 QualityProfile，但不能替代项目级显式配置。

### 11.5 关系

```text
DeliveryPlanVersion 1 ── * DeliveryItem
DeliveryItem * ── * GapItem
DeliveryItem * ── * DeliveryItem dependency
DeliveryItem 1 ── 0..* Task
DeliveryItem 1 ── 0..* Artifact
DeliveryItem * ── 1 QualityProfile
```

默认期望一个 DeliveryItem 对应一个主要 Artifact，但 v0.1 不强制一对一，以支持一个交付项包含主文件与多个记录表、或一个 Artifact 支持多个交付义务。所有多对多情况必须显式建模并说明目的。

### 11.6 Commands

DeliveryItem 的范围命令必须通过 DeliveryPlan Aggregate：

```text
add_delivery_item
revise_delivery_item_before_approval
define_delivery_item_dependency
assign_delivery_item_quality_profile
cancel_delivery_item_in_new_plan_revision
replace_delivery_item_in_new_plan_revision
```

执行层命令作用于其他 Aggregate：

```text
create_task_for_delivery_item
create_artifact_for_delivery_item
link_artifact_to_delivery_item
request_delivery_item_completion_evaluation
```

不提供：

```text
set_delivery_item_done
agent_mark_delivery_item_approved
```

### 11.7 CompletionCriteria

CompletionCriteria 必须结构化，示例：

```text
requiredArtifactTypes[]
requiredQualityProfile
requiredApprovalRoles[]
requiredReleasePurpose?
requiredResolvedGapItems[]
requiredResolvedReviewIssues
allowOpenNonBlockingIssues
```

DeliveryItem 完成由 Core Evaluator 判断：

```text
required Artifact exists?
required Revision approved?
required GateResult passed?
required Human Approval recorded?
required Release recorded?
blocking Issue or InformationRequest exists?
    ↓
COMPLETED or not
```

### 11.8 Invariants

1. DeliveryItem 只能由 DeliveryPlan Aggregate 添加、修改、取消或替换。
2. APPROVED PlanVersion 中的 DeliveryItem 定义不可修改。
3. DeliveryItem 必须有稳定 `itemKey`，以便跨 PlanVersion 表达延续、替换和取消。
4. 依赖只能指向同一 Project 的 DeliveryItem，且不得成环。
5. 高风险 Item 必须有 QualityProfile、Human Approval 和 Evidence 要求。
6. Agent 不能直接写 ExecutionStatus 或 Completion。
7. Task COMPLETED 不自动令 DeliveryItem COMPLETED。
8. Artifact 存在不自动令 DeliveryItem 完成；必须满足 CompletionCriteria。
9. CANCELLED/REPLACED Item 必须有原因和新 PlanVersion 决定。
10. UNKNOWN Gap 不得无 Human 决定直接变成正式 CREATE Item。
11. 一个 Artifact 被多个 Item 引用时，CompletionEvaluator 必须分别检查每个 Item 的标准。
12. DeliveryItem 不保存 Harness、Model 或 Runtime Session；这些属于 WorkOrder/Run。
13. REQUIRED Release 尚未发生时，即使 Revision APPROVED 也不能显示 COMPLETED。
14. 所有进度展示必须能够回溯到 Task、Artifact、Gate、Approval 或 Release，而不是 Agent 自报百分比。

### 11.9 Domain Events

计划内事件：

```text
DeliveryItemAdded
DeliveryItemRevised
DeliveryItemDependencyDefined
DeliveryItemQualityProfileAssigned
DeliveryItemCancelled
DeliveryItemReplaced
```

执行投影事件：

```text
DeliveryItemBecameReady
DeliveryItemExecutionStarted
DeliveryItemBlocked
DeliveryItemEnteredReview
DeliveryItemApprovedOutputAvailable
DeliveryItemReleased
DeliveryItemCompletionSatisfied
DeliveryItemCompletionRevokedByPlanChange
```

后一组事件由 Process Manager / Projection 基于其他 Aggregate 事件产生，不改变已批准 PlanVersion 的定义。

### 11.10 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 建议新 Item | 允许 | 允许提出 | Gap-to-Plan Service 可生成草稿建议 |
| 修改 DRAFT Item | 授权项目成员 | WorkOrder 范围内可执行 | 不批准 |
| 批准 Item 范围 | 随 DeliveryPlan 由授权 Human 批准 | 不允许 | 仅执行 Human 决定 |
| 创建 Task/Artifact | 按项目权限 | WorkOrder 授权可执行 | Process Manager 可执行规则化创建 |
| 写入 ExecutionStatus | 不直接写 | 不允许 | Projection/Evaluator |
| 判定 Completion | Human 可请求/确认例外 | 不允许自报 | CompletionEvaluator 按标准计算 |

### 11.11 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| DI-U-001 | Unit | Task=COMPLETED，但 ArtifactRevision 未通过 Evidence Gate | DeliveryItem 仍为 IN_REVIEW/未完成 | NOT RUN：设计阶段 |
| DI-U-002 | Unit | Agent 调用 `set_delivery_item_done` | 命令不存在或拒绝 `COMPLETION_IS_DERIVED` | NOT RUN：设计阶段 |
| DI-U-003 | Unit | requiredReleasePurpose=REGULATORY_SUBMISSION，只有 APPROVED Revision | 状态为 APPROVED_OUTPUT，不是 COMPLETED | NOT RUN：设计阶段 |
| DI-E-001 | E2E | “采购控制程序”Item 经 Task、WorkOrder、Revision、Gate、Human Approval 和客户正式 Release | CompletionEvaluator 产生 DeliveryItemCompletionSatisfied，全部来源可追溯 | NOT RUN：设计阶段 |
| DI-E-002 | E2E | 已完成 Item 在新 PlanVersion 中被替换 | 历史完成状态保留；新 Item 进入独立执行生命周期，旧 Item 标记 REPLACED | NOT RUN：设计阶段 |

---

## 12. 八个概念的职责矩阵

| 概念 | 它回答的问题 | 它不负责 |
|---|---|---|
| SourceMaterial | 实际收到了什么原始内容？ | 判断业务类型、确认客户现状 |
| CustomerMaterial | 原始内容在业务上是什么？ | 表示客户整体资料是否齐全 |
| CustomerBaseline | 某一时点客户确认有什么、缺什么、未知什么？ | 决定项目交付范围 |
| TemplateBaseline | 项目使用哪套制巨模板版本？ | 证明法规要求 |
| RegulatoryProfile | 哪些法规/标准适用，依据是什么？ | 保存法规全文或替代 Evidence 库 |
| GapAnalysis | 客户现状与目标体系差在哪里？ | 批准交付承诺或直接创建正式成果 |
| DeliveryPlan | 项目正式承诺交付什么？ | 表达某次 Agent 执行或运行细节 |
| DeliveryItem | 一项交付怎样定义、依赖什么、如何完成？ | 充当 Artifact、Task、WorkOrder 或 Run |

---

## 13. 关键端到端流程

### 13.1 飞书接收客户文件

```text
飞书用户在已绑定 Project 话题上传文件
    ↓
Feishu Channel 验证 tenant/user/chat/project binding
    ↓
register_source_material
    ↓
上传、Checksum、来源、权限和安全校验
    ↓
SourceMaterial = ACCEPTED
    ↓
Parser / Agent 提出 CustomerMaterial classification
    ↓
Human 确认 CustomerMaterial
    ↓
创建 CustomerBaseline 新草稿版本
    ↓
Human 确认并激活 BaselineVersion
```

任何一步都不能从“飞书收到附件”跳到“正式 CustomerBaseline 已更新”。

### 13.2 从客户现状形成交付计划

```text
ACTIVE CustomerBaselineVersion
+ FROZEN TemplateBaselineVersion
+ ACTIVE RegulatoryProfileVersion
+ EnterpriseProfileSnapshot
+ QMSConfigurationVersion
    ↓
start_gap_analysis
    ↓
Agent + deterministic rules 形成 GapItem
    ↓
Human 接受 GapAnalysis
    ↓
create_delivery_plan_draft
    ↓
Agent/Human 编辑 DeliveryItem、依赖和 QualityProfile
    ↓
Human approve_delivery_plan
    ↓
ACTIVE DeliveryPlanVersion
```

### 13.3 客户补资料后的影响处理

```text
新 SourceMaterial
    ↓
新 CustomerMaterial confirmed
    ↓
新 CustomerBaselineVersion ACTIVE
    ↓
旧 GapAnalysis = STALE
    ↓
DeliveryPlanImpactReviewRequested
    ↓
Human 判断：
├── 无影响，记录决定
└── 有影响，创建新 GapAnalysis / DeliveryPlanVersion
```

系统不自动修改已批准范围或已批准 Artifact。

### 13.4 从 DeliveryItem 到正式成果

```text
ACTIVE DeliveryItem
    ↓
Task
    ↓
WorkOrder
    ↓
Run / AgentResult
    ↓
ArtifactRevision
    ↓
Quality Gates
    ↓
Human Approval
    ↓
Release
    ↓
DeliveryItem Completion Evaluator
```

---

## 14. Project Context Projection 要求

八个概念进入 Execution Context 时必须裁剪并保留版本：

### 14.1 CoordinatorProjection

```text
Baseline completeness summary
Open conflicts / InformationRequests
Template and Regulatory Profile versions
Gap summary
Active DeliveryPlan and Item statuses
Blockers and overdue items
```

不默认包含全部文件正文。

### 14.2 DocumentWriterProjection

```text
Relevant confirmed CustomerMaterials
Relevant CustomerBaselineItems
Selected TemplateVersion sections
Applicable RegulatoryProfile items and Evidence
Target DeliveryItem and CompletionCriteria
Current ArtifactRevision
Allowed change scope
```

### 14.3 ReviewerProjection

```text
Writer inputs and provenance
Revision diff
Relevant GapItems
Template and Regulatory requirements
Customer confirmed facts
QualityProfile
Open ReviewIssues
```

### 14.4 FeishuConversationProjection

飞书对话只获得当前用户、绑定 Project、当前 Task/WorkOrder 和必要摘要。不得因为群成员可以看到聊天，就默认授予所有群成员完整项目读取权限。

消息中需要展示敏感内容时，Channel 必须再次检查接收者、群成员变化和项目 Policy；复杂内容优先返回权限受控的 Workspace Deep Link。

---

## 15. 跨 Aggregate Process Manager

v0.1 不建设通用 Workflow Engine，但允许针对明确业务链实现小型 Process Manager。

建议的四个 Process：

### 15.1 Material Intake Process

```text
SourceMaterialAccepted
    ↓
request classification
    ↓
CustomerMaterialProposed
    ↓
request Human confirmation
```

### 15.2 Baseline Impact Process

```text
CustomerBaselineVersionActivated
    ↓
mark dependent GapAnalysis stale
    ↓
request DeliveryPlan impact review
```

### 15.3 Reference Impact Process

```text
TemplateBaselineSuperseded
or RegulatoryProfileSuperseded
    ↓
identify affected GapAnalysis / DeliveryPlan / Artifact
    ↓
create impact review proposals
```

### 15.4 Delivery Completion Process

```text
Task / Artifact / Gate / Approval / Release events
    ↓
re-evaluate DeliveryItem CompletionCriteria
    ↓
update ExecutionStatus projection
```

这些 Process 只能发出显式 Command 或 Proposal，不得绕过 Aggregate Invariant。

---

## 16. Domain Error Taxonomy

v0.1 建议稳定以下错误语义，具体编码格式以后确定：

```text
SOURCE_CONTENT_IMMUTABLE
SOURCE_NOT_TRUSTED
INVALID_MATERIAL_SOURCE
MATERIAL_NOT_CONFIRMED
MATERIAL_CLASSIFICATION_CONFLICT
BASELINE_VERSION_IMMUTABLE
MISSING_REQUIRES_CONFIRMATION
NOT_APPLICABLE_REQUIRES_DECISION
EXPLICIT_TEMPLATE_VERSION_REQUIRED
TEMPLATE_BASELINE_IMMUTABLE
TEMPLATE_NOT_EVIDENCE
REGULATORY_EVIDENCE_REQUIRED
CONFLICTING_APPLICABILITY
PROFESSIONAL_CONFIRMATION_REQUIRED
INCOMPLETE_ANALYSIS_INPUT
GAP_INPUT_STALE
HUMAN_ACCEPTANCE_REQUIRED
DELIVERY_PLAN_IMMUTABLE
CYCLIC_DELIVERY_DEPENDENCY
HUMAN_APPROVAL_REQUIRED
COMPLETION_IS_DERIVED
CROSS_PROJECT_REFERENCE_DENIED
```

错误必须对 Human/Agent 返回可操作的结构化信息：

```text
code
message
targetRef
violatedInvariant
requiredAction
informationRequestRef?
```

---

## 17. 本阶段设计取舍

### 17.1 采用的简化

- 不设计数据库表；
- 不定义完整法规知识库模型；
- 不把所有分析都建成 Knowledge Graph；
- 不设计通用材料类型插件系统；
- 不设计复杂合同、报价和商业 CRM；
- 不设计通用 BPMN/Workflow DSL；
- 不为每个状态单独创建微服务；
- 不把飞书事件直接设计成 Domain Event；Channel Event 先转换成受认证 Command。

### 17.2 有意保留的分离

- SourceMaterial 与 CustomerMaterial 分离；
- CustomerMaterial 与 CustomerBaseline 分离；
- TemplateBaseline 与 RegulatoryProfile 分离；
- GapAnalysis 与 DeliveryPlan 分离；
- DeliveryItem 与 Artifact/Task/WorkOrder 分离；
- CommitmentStatus 与 ExecutionStatus 分离；
- 飞书消息状态与 Core 业务状态分离。

这些分离不是为未来抽象而抽象，而是直接保护：

- 原始证据完整性；
- 事实确认；
- Human 决策权；
- 项目范围稳定性；
- 审计与 Replay；
- 多 Harness 一致性。

---

## Part D：任务、执行与人工输入

## 18. Task

### 18.1 业务含义

`Task` 是 Project Board 上长期存在的业务工作对象，回答：

> 为推动项目或交付项向前，还需要完成什么业务工作，当前处于什么业务状态？

例如：

```text
TASK-102
根据 Review 意见修订《采购控制程序》第 4 章
```

Task 不是：

- 一次 LLM 调用；
- 一个 Harness Session；
- 一条飞书消息；
- 一个 WorkOrder；
- 一次 Run；
- 一个 ArtifactRevision；
- Agent 的内部 Todo List。

同一个 Task 可以经历：

```text
Human 澄清范围
    ↓
WorkOrder-1 Claude Code 起草
    ↓
WorkOrder-2 Codex Review
    ↓
Human 修改
    ↓
Quality Gate
    ↓
Task Completion Evaluator
```

### 18.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

Task 需要独立 Aggregate，因为：

- 它是 Project Board 的 Source of Truth；
- 生命周期可能跨越多个 WorkOrder、Run、Agent 和 Human；
- 需要独立管理依赖、负责人、阻塞和完成标准；
- Coordinator 可以重启或替换，但 Task 必须长期存在；
- 飞书话题或 Agent Session 丢失不能导致 Task 丢失。

建议概念模型：

```text
Task
├── id
├── enterpriseId
├── projectId
├── deliveryItemId?
├── parentTaskId?
├── type
├── title
├── objective
├── status
├── priority
├── riskLevel
├── assignee?
├── dependencyTaskIds[]
├── inputRefs[]
├── expectedOutputSpec
├── completionCriteria
├── blockerRefs[]
├── informationRequestRefs[]
├── workOrderRefs[]
├── resultRefs[]
├── dueConstraint?
├── createdBy
├── createdAt
├── completedAt?
├── cancelledAt?
└── version
```

Value Objects：

- `TaskObjective`；
- `TaskPriority`；
- `TaskRiskLevel`；
- `TaskAssignee`；
- `TaskInputRef`；
- `ExpectedOutputSpec`；
- `TaskCompletionCriteria`；
- `DueConstraint`；
- `TaskDependency`。

TaskAssignee 明确区分：

```text
HUMAN
AGENT_PROFILE
UNASSIGNED
```

`AGENT_PROFILE` 表示逻辑执行角色，不等于某个固定 Harness 或模型。

### 18.3 关系

```text
Project 1 ── * Task
DeliveryItem 1 ── 0..* Task
Task 0..1 ── * ChildTask
Task * ── * Task dependency
Task 1 ── 0..* WorkOrder
Task 1 ── 0..* InformationRequest
Task * ── * BusinessOutputRef
```

规则：

- Task 可以不属于 DeliveryItem，例如项目级“确认质量负责人”；
- DeliveryItem 通常产生多个 Task；
- Task 依赖只表达业务执行顺序，不替代 Artifact 或 DeliveryItem 依赖；
- WorkOrder 必须归属一个 Task；
- 一个 WorkOrder 不能跨多个 Task 扩大范围。

### 18.4 Commands

```text
create_task
revise_task_draft
add_task_dependency
remove_task_dependency_before_start
assign_task_to_human
assign_task_to_agent_profile
unassign_task
mark_task_ready
start_task_execution
record_task_blocker
clear_task_blocker
request_task_input
submit_task_for_review
request_task_changes
evaluate_task_completion
complete_task
cancel_task
reopen_task
propose_followup_task
```

禁止：

```text
agent_mark_task_completed
set_task_status_arbitrarily
bind_task_to_runtime_session_as_identity
```

所有状态变化必须通过表达业务意图的 Command，并验证前置条件。

### 18.5 Lifecycle

建议状态机：

```text
DRAFT
    ↓
BACKLOG
    ↓
READY
    ↓
IN_PROGRESS
    ├── WAITING_INPUT
    ├── BLOCKED
    ├── IN_REVIEW
    ├── CHANGES_REQUIRED
    └── COMPLETION_PENDING
              ↓
          COMPLETED

DRAFT / BACKLOG / READY / IN_PROGRESS / WAITING_INPUT / BLOCKED
    └── CANCELLED

COMPLETED
    └── REOPENED → READY or IN_PROGRESS
```

状态语义：

- `DRAFT`：定义尚未完成；
- `BACKLOG`：任务有效但前置条件或排期未满足；
- `READY`：依赖、输入和权限满足，可以建立 WorkOrder 或由 Human 执行；
- `IN_PROGRESS`：至少存在有效执行活动，但不表示 Agent 正在持续运行；
- `WAITING_INPUT`：存在阻塞性 OPEN/DELIVERED/ANSWERED InformationRequest；
- `BLOCKED`：非输入类阻塞，例如权限、系统、依赖或 Policy；
- `IN_REVIEW`：预期输出已形成，等待 Review 或 Human 检查；
- `CHANGES_REQUIRED`：Review 或 CompletionEvaluator 要求修改；
- `COMPLETION_PENDING`：执行者已提交完成候选，等待 Core 验证；
- `COMPLETED`：所有 TaskCompletionCriteria 已由 Core 验证；
- `CANCELLED`：任务不再要求执行，但历史保留。

`REOPENED` 更适合作为事件而不是长期状态；重新打开后进入 READY 或 IN_PROGRESS。

### 18.6 Invariants

1. Task 必须属于一个 Enterprise 和 Project，创建后不可迁移。
2. Task 依赖不得跨 Enterprise，跨 Project 依赖需要显式 ExternalDependency，而不是直接 TaskId。
3. Task 依赖图不得形成环。
4. 只有依赖满足、必需输入存在、授权明确的 Task 才能进入 READY。
5. Agent、Harness、Run 或飞书用户不能直接设置 Task.status。
6. `IN_PROGRESS` 不等于存在 RUNNING Run；Human 编辑或等待 Review 时也可处于该业务阶段。
7. Task COMPLETED 必须由 CompletionEvaluator 验证 ExpectedOutputSpec、正式 BusinessOutput、Quality/Review 要求和阻塞状态。
8. AgentResult 的 `execution_outcome=COMPLETED` 不能直接完成 Task。
9. WorkOrder COMPLETED 也不能自动完成 Task；一个 Task 可以需要多个 WorkOrder。
10. 存在 blocking InformationRequest 时 Task 必须进入 WAITING_INPUT 或保持其他更高优先级阻塞状态，不能完成。
11. CANCELLED Task 不得创建新 WorkOrder；late AgentResult 只能归档审计，不能恢复任务。
12. COMPLETED Task 重新打开必须记录原因、请求人和受影响输出，不可原地抹除 completedAt。
13. 子 Task 完成状态不能凭父 Task 状态反向推断；父 Task CompletionCriteria 可要求全部必要子 Task 完成。
14. Agent 发现范围外工作只能 `propose_followup_task`，不能直接修改当前 Task Objective。
15. Task 百分比只能是基于明确定义子项的派生 Projection，不能由 Agent 自报。
16. Task 指派给 AgentProfile 不等于授权某个 Harness；具体 Harness 由 WorkOrder/Runtime Policy 决定。

### 18.7 Domain Events

```text
TaskCreated
TaskDraftRevised
TaskDependencyAdded
TaskDependencyRemoved
TaskAssignedToHuman
TaskAssignedToAgentProfile
TaskUnassigned
TaskBecameReady
TaskExecutionStarted
TaskBlocked
TaskBlockerCleared
TaskWaitingForInput
TaskSubmittedForReview
TaskChangesRequested
TaskCompletionEvaluationRequested
TaskCompletionCriteriaSatisfied
TaskCompleted
TaskCancelled
TaskReopened
FollowUpTaskProposed
```

### 18.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建普通 Task | 授权项目成员 | 只能提出 FollowUpProposal；Coordinator Profile 按能力可创建 DRAFT | Process Manager 可按规则创建 |
| 修改 DRAFT Objective | 创建人/项目经理 | 仅受控 Coordinator WorkOrder | 不自主修改 |
| 指派 Human/AgentProfile | 项目经理或 Task 管理角色 | Coordinator 可提出或按明确 Policy 执行 | Assignment Service 执行命令 |
| 创建依赖 | 授权项目成员 | 可提出 | Process Manager 可建立确定性依赖 |
| 标记 READY | 授权 Human 可请求 | 不直接设置 | ReadinessEvaluator 验证后执行 |
| 记录 Blocker | 允许 | 允许提出 Finding/Request | Runtime/Policy Service 可记录机器阻塞 |
| 提交 Review | 执行者 | WorkOrder 授权可执行 | 可在输出满足最低 Schema 后执行 |
| 完成 Task | Human 只能请求/确认例外 | 不允许自报 | CompletionEvaluator 验证并执行 |
| 取消/重开 | 项目经理或授权角色 | 不允许最终决定 | 仅执行 Human/Policy Command |

### 18.9 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| TK-U-001 | Unit | AgentResult 声明 completed，但缺少 required ArtifactRevision | Task 进入/保持 COMPLETION_PENDING 或 CHANGES_REQUIRED，不得 COMPLETED | NOT RUN：设计阶段 |
| TK-U-002 | Unit | 为 Task A 添加依赖 B，同时 B 已依赖 A | 拒绝 `CYCLIC_TASK_DEPENDENCY` | NOT RUN：设计阶段 |
| TK-U-003 | Unit | CANCELLED Task 请求创建 WorkOrder | 拒绝 `TASK_NOT_EXECUTABLE` | NOT RUN：设计阶段 |
| TK-E-001 | E2E | DeliveryItem 创建起草、Review 和 Human 确认三个 Task | Board 独立跟踪三项业务工作；多个 WorkOrder/Run 不混入 Task 身份 | NOT RUN：设计阶段 |
| TK-E-002 | E2E | Agent 在修订任务中发现质量手册也需修改 | 当前 Task 范围不变；生成 FollowUpTaskProposal，经授权后创建新 Task | NOT RUN：设计阶段 |

---

## 19. WorkOrder

### 19.1 业务含义

`WorkOrder` 是对 Human 或 Agent 执行者发布的 Harness-neutral 受控执行契约，回答：

> 在当前 Task 下，这一次被授权执行什么、可以读取和改变什么、必须产生什么、怎样判断完成？

WorkOrder 不是 Prompt。Prompt、CLAUDE.md、AGENTS.md、Skill 或飞书消息只是 Runtime Adapter 对 WorkOrder 的一种呈现形式。

示例：

```text
WO-0182
Objective:
根据 RI-22、RI-27 修订《采购控制程序》第 4 章

Allowed scope:
ART-33 / base REV-18 / section 4 only

Expected output:
one ArtifactRevision ref
```

### 19.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

WorkOrder 需要独立 Aggregate，因为：

- 其 Specification 在发布后必须冻结；
- 同一 Task 可以有多个不同 WorkOrder；
- 同一 WorkOrder 可以有多个 Run；
- 需要独立管理调度、预算、过期、取消、输入等待和完成评估；
- 它是 Capability Token、ContextSnapshot 和 Run 的授权来源。

建议概念模型：

```text
WorkOrder
├── id
├── contractVersion
├── enterpriseId
├── projectId
├── taskId
├── requestedBy
├── createdBy
├── specification
│   ├── type
│   ├── objective
│   ├── inputRefs[]
│   ├── contextProjection
│   ├── contextSnapshotId?
│   ├── constraints
│   ├── allowedCapabilities[]
│   ├── deniedCapabilities[]
│   ├── expectedOutputs[]
│   ├── completionCriteria
│   ├── riskProfile
│   ├── qualityProfileRef?
│   ├── executionPolicy
│   ├── budget
│   └── versionRefs
├── status
├── activeRunId?
├── runRefs[]
├── informationRequestRefs[]
├── completionEvaluation?
├── issuedAt?
├── expiresAt?
├── completedAt?
├── cancelledAt?
└── version
```

Value Objects：

- `WorkOrderObjective`；
- `InputRef`；
- `ContextProjectionSpec`；
- `WorkConstraint`；
- `CapabilityGrant`；
- `ExpectedBusinessOutput`；
- `WorkOrderCompletionCriteria`；
- `ExecutionPolicy`；
- `ExecutionBudget`；
- `HarnessSelectionPolicy`；
- `ModelPolicy`；
- `ContractVersionRefs`。

### 19.3 Specification 冻结边界

WorkOrder 从 DRAFT 进入 READY 时冻结：

```text
objective
inputs
target refs
base revision
context projection
constraints
capabilities
expected outputs
completion criteria
risk / quality profile
budget
policy / skill / template versions
harness requirement, if any
```

READY 后如果这些内容发生实质变化，必须：

```text
cancel / supersede old WorkOrder
    ↓
create new WorkOrder
```

只补充已存在 InformationRequest 的答案不视为修改 Specification；它产生新的 AnswerRef 和必要的新 ContextSnapshot。

### 19.4 关系

```text
Task 1 ── * WorkOrder
WorkOrder 1 ── * Run
WorkOrder 1 ── * InformationRequest
WorkOrder 1 ── 0..* ContextSnapshot
WorkOrder * ── * BusinessInputRef
WorkOrder * ── * ExpectedBusinessOutputSpec
```

限制：

- WorkOrder 必须属于一个 Task、Project 和 Enterprise；
- Run 必须属于一个 WorkOrder；
- 一个 Run 不得执行多个 WorkOrder；
- 正式输出通过 BusinessObjectRef 关联，不把 Workspace 路径作为完成依据。

### 19.5 Commands

```text
draft_work_order
revise_work_order_draft
attach_work_order_input
define_context_projection
grant_work_order_capability
deny_work_order_capability
define_expected_output
define_completion_criteria
set_execution_budget
set_harness_selection_policy
mark_work_order_ready
queue_work_order
start_work_order_run
record_work_order_input_request
pause_work_order_for_input
resume_work_order_after_input
request_work_order_completion_evaluation
complete_work_order
fail_work_order
cancel_work_order
expire_work_order
supersede_work_order
```

禁止：

```text
update_ready_work_order_specification
agent_complete_work_order
reuse_work_order_across_projects
grant_human_approval_capability_to_agent
```

### 19.6 Lifecycle

```text
DRAFT
    ↓
READY
    ↓
QUEUED
    ↓
RUNNING
    ├── WAITING_INPUT
    ├── COMPLETION_PENDING
    ├── RETRY_PENDING
    ├── FAILED
    └── CANCELLED

WAITING_INPUT
    ├── READY / QUEUED         new Run or resume policy
    ├── EXPIRED
    └── CANCELLED

COMPLETION_PENDING
    ├── COMPLETED
    ├── RETRY_PENDING
    ├── WAITING_INPUT
    └── FAILED

READY / QUEUED / WAITING_INPUT / RETRY_PENDING
    └── EXPIRED
```

状态语义：

- `READY`：Specification 已冻结且可执行；
- `QUEUED`：等待 Runtime 资源；
- `RUNNING`：存在一个 active Run；
- `WAITING_INPUT`：阻塞性 InformationRequest 尚未 RESOLVED；
- `COMPLETION_PENDING`：存在候选结果，等待 Core 验证；
- `RETRY_PENDING`：上一个 Run 未产生可接受结果且 Policy 允许重试；
- `COMPLETED`：CompletionCriteria 已由 Core 验证；
- `FAILED`：在 Policy/预算/重试范围内不能完成；
- `CANCELLED`：授权 Human/Policy 终止；
- `EXPIRED`：超过有效期，不能继续使用旧授权执行。

### 19.7 Invariants

1. WorkOrder 必须引用一个可执行且未 CANCELLED/COMPLETED 的 Task。
2. READY 后 Specification 不可修改。
3. WorkOrder 中所有输入和目标必须属于同一 Enterprise/Project，或通过显式、授权的 ExternalReference。
4. AgentPrincipal 的 CapabilityGrant 不能包含 Human-only 能力，如 approve、release 或确认高风险法规决定。
5. 同一 WorkOrder 同时最多一个 active Run，除非 ExecutionPolicy 明确允许并行竞赛；v0.1 默认禁止并行 active Run。
6. `preferredHarness` 与 `requiredHarness` 语义不同；required 不可被 Router 静默替换。
7. 用户明确指定 Harness 时，仅 Project/Compliance Policy 可以拒绝，不能静默换成其他 Harness。
8. Run 正常退出不自动完成 WorkOrder。
9. AgentResult 的 BusinessOutputs 必须满足 ExpectedOutputSpec，并经 Core 验证，才能进入 COMPLETION_PENDING。
10. WorkOrder COMPLETED 必须满足 CompletionCriteria，而不是只看 `execution_outcome`。
11. blocking InformationRequest 存在时不得进入 COMPLETED。
12. 超过预算不得继续启动新 Run；是否允许当前 Run 优雅停止由 ExecutionPolicy 决定。
13. CANCELLED/EXPIRED WorkOrder 产生的 late result 只能进入隔离审计，不得改变 Task 或 Artifact 的正式状态。
14. Retry 必须创建新 Run；不得把失败 Run 的状态改成成功。
15. 如果 Objective、允许范围或 CompletionCriteria 变化，必须创建新 WorkOrder，而不是“继续原 Session”。
16. ContextSnapshot 必须可重建当次 Run 的输入视图；只记录 ProjectId 不足够。
17. InformationRequest 的 RESOLVED Answer 可以进入新 ContextSnapshot，但不能静默改写原快照。
18. WorkOrder 不保存模型 Chain of Thought；只保存结构化契约、事件、摘要、输出和 Provenance。

### 19.8 Domain Events

```text
WorkOrderDrafted
WorkOrderDraftRevised
WorkOrderInputAttached
WorkOrderContextProjectionDefined
WorkOrderCapabilityGranted
WorkOrderCapabilityDenied
WorkOrderExpectedOutputDefined
WorkOrderCompletionCriteriaDefined
WorkOrderBudgetSet
WorkOrderHarnessPolicySet
WorkOrderBecameReady
WorkOrderQueued
WorkOrderRunStarted
WorkOrderWaitingForInput
WorkOrderResumedAfterInput
WorkOrderCompletionEvaluationRequested
WorkOrderCompleted
WorkOrderRetryScheduled
WorkOrderFailed
WorkOrderCancelled
WorkOrderExpired
WorkOrderSuperseded
```

### 19.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 DRAFT | 授权项目成员 | Coordinator Agent 仅按已授予 Capability | Process Manager 可基于 Task 创建草稿 |
| 定义 Objective/Scope | Task owner/项目经理 | Coordinator 可提出，不可突破 Task | Contract Builder 可生成候选 |
| 授予 Capability | 授权 Human/Policy | 不允许给自己加权 | Authorization Service 计算并收窄 |
| 标记 READY | 授权 Human 可请求 | 不直接 | ContractValidator 验证后执行 |
| 选择 preferred Harness | Human 可指定 | Coordinator 可提出 | Router 可在 Policy 内选择 |
| 启动 Run | Human/Coordinator 依权限 | Agent 不能自我扩张启动 | Dispatcher |
| 请求 Completion | Human/Agent 执行者 | 允许提交候选 | Result Processor |
| 完成 WorkOrder | Human 不直接绕过标准 | 不允许自报 | CompletionEvaluator |
| Cancel / Supersede | Task owner/项目经理 | 不允许最终决定 | Policy/Timeout Service 可按规则执行 |

### 19.10 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| WO-U-001 | Unit | READY WorkOrder 请求扩大 allowedSections 从 4 到 2、4 | 拒绝 `WORK_ORDER_SPEC_IMMUTABLE`，要求新 WorkOrder | NOT RUN：设计阶段 |
| WO-U-002 | Unit | Agent WorkOrder 包含 `artifact.approve` Capability | 拒绝 `HUMAN_ONLY_CAPABILITY` | NOT RUN：设计阶段 |
| WO-U-003 | Unit | 同一 WorkOrder 已有 RUNNING Run，再启动第二个 Run | 默认拒绝 `ACTIVE_RUN_EXISTS` | NOT RUN：设计阶段 |
| WO-E-001 | E2E | Claude Code Run timeout，Policy 允许 Codex fallback | 原 Run 保持 TIMED_OUT，创建新 Codex Run；同一 WorkOrder 继续，审计完整 | NOT RUN：设计阶段 |
| WO-E-002 | E2E | 用户通过飞书回答阻塞问题 | Answer 经身份/Request 校验后 RESOLVED；创建新 ContextSnapshot，WorkOrder 进入 READY/QUEUED，而非修改旧快照 | NOT RUN：设计阶段 |

---

## 20. Run

### 20.1 业务含义

`Run` 表示某个 WorkOrder 的一次具体执行尝试，回答：

> 哪个 Runtime/Harness 在什么授权和上下文下，何时开始、经历了什么执行状态、如何结束？

Run 是执行审计对象，不是业务任务，也不拥有业务完成解释权。

示例：

```text
WO-182
├── RUN-1 Claude Code → TIMED_OUT
├── RUN-2 Codex       → WAITING_INPUT
└── RUN-3 Codex       → RESULT_RECORDED
```

### 20.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

原因：

- Run 数量大、状态变化频繁，不应锁住 WorkOrder Aggregate；
- Runtime 心跳、租约、取消和 Usage 需要独立一致性；
- 同一 WorkOrder 的失败 Run 必须保留；
- AgentResult 可能迟到、重复或无效，需要独立处理。

建议概念模型：

```text
Run
├── id
├── enterpriseId
├── projectId
├── taskId
├── workOrderId
├── attemptNumber
├── status
├── runtimeBinding
│   ├── adapterType
│   ├── harness
│   ├── harnessVersion
│   ├── provider
│   ├── model
│   ├── modelConfiguration
│   └── executionNode?
├── contextSnapshotId
├── capabilityTokenRef
├── executionLease?
├── startedAt?
├── lastHeartbeatAt?
├── endedAt?
├── terminationReason?
├── continuationRef?
├── usageRecord?
├── resultRef?
├── runtimeError?
└── version
```

Value Objects：

- `RuntimeBinding`；
- `ModelBinding`；
- `ExecutionLease`；
- `OpaqueContinuationRef`；
- `RunUsageRecord`；
- `RuntimeError`；
- `TerminationReason`；
- `AttemptNumber`。

### 20.3 关系

```text
WorkOrder 1 ── * Run
Run 1 ── 0..1 final AgentResult
Run 1 ── 0..* RuntimeEventRef
Run 1 ── 1 ContextSnapshot
Run 1 ── 1 CapabilityTokenRef
Run 0..1 ── 1 OpaqueContinuationRef
```

Run 可以有增量进度事件或 checkpoint，但 v0.1 只允许一个 Final AgentResult。部分进度不是 AgentResult，不触发 CompletionEvaluator。

Runtime 可以在 Final AgentResult 之前发出结构化 `RuntimeInputRequired` 控制事件，请求创建 InformationRequest 并将 Run 安全挂起。该控制事件不是 AgentResult，也不代表本次执行结束。

### 20.4 Commands

```text
create_run
acquire_run_lease
start_run
record_run_heartbeat
record_runtime_progress
record_runtime_input_required
request_run_cancellation
acknowledge_run_cancellation
record_run_suspension
resume_suspended_run
record_run_timeout
record_runtime_failure
record_agent_result
record_run_usage
finish_run
abandon_run
invalidate_run
```

禁止：

```text
change_run_work_order
overwrite_failed_run_as_success
trust_agent_reported_usage_as_authoritative
reuse_capability_token_after_expiry
```

### 20.5 Lifecycle

```text
CREATED
    ↓
STARTING
    ↓
RUNNING
    ├── SUSPENDED
    ├── CANCELLING
    ├── RESULT_RECORDED
    ├── FAILED
    ├── TIMED_OUT
    └── ABANDONED

SUSPENDED
    ├── RUNNING              same continuation
    ├── CANCELLING
    ├── FAILED
    └── ABANDONED

CANCELLING
    ├── CANCELLED
    └── ABANDONED            runtime did not acknowledge

RESULT_RECORDED
    ├── SUCCEEDED            result accepted at execution boundary
    └── INVALID_RESULT       result rejected
```

注意：

```text
Run SUCCEEDED
≠ WorkOrder COMPLETED
≠ Task COMPLETED
```

Run SUCCEEDED 只表示该次执行产生了一个在 Schema、身份和引用层面可接受的 AgentResult。

### 20.6 Resume 与 Retry

明确区分：

```text
Resume
= 同一 Run 使用有效 continuationRef 从 SUSPENDED 恢复

Retry
= 同一 WorkOrder 创建新的 Run 和 attemptNumber
```

规则：

- Runtime 能保证同一执行连续性且 Capability Token/Context 仍有效时可 Resume；
- Context、授权、Harness、模型、预算或关键输入变化时必须 Retry，新建 Run；
- 已进入 FAILED、TIMED_OUT、CANCELLED、ABANDONED、INVALID_RESULT 的 Run 不可 Resume；
- Runtime 在 Final AgentResult 之前发出 `RuntimeInputRequired` 时，可以让 Run 进入 SUSPENDED；答案解决且原 Token/Context 安全有效时允许 Resume；
- AgentResult 以 `BLOCKED_INPUT` 作为 final outcome 时，该 Run 在结果接收边界终止；答案解决后必须 Retry 并创建新 Run，不能 Resume 原 Run；
- 无论采用哪条路径，业务 WorkOrder 都进入 WAITING_INPUT，且恢复前必须先解决正式 InformationRequest。

### 20.7 Invariants

1. Run 必须绑定一个 READY/QUEUED/RUNNING/WAITING_INPUT 可恢复的 WorkOrder。
2. enterpriseId、projectId、taskId、workOrderId 创建后不可变。
3. attemptNumber 在同一 WorkOrder 内唯一且单调增加。
4. ContextSnapshot 和 CapabilityTokenRef 在 Run 创建后不可替换。
5. Capability Token 必须绑定 Run/WorkOrder/Project/Harness/expiry，不能跨 Run 复用。
6. 一个 Run 最多一个被接受的 Final AgentResult。
7. 重复提交相同 ResultId/PayloadHash 必须幂等；不同 Payload 使用同一 ResultId 必须拒绝并记录安全事件。
8. 已终止 Run 的 late result 默认隔离为 `LATE_RESULT`，不得改变业务状态；仅在明确 Recovery Policy 下由 Human/Service 重新评估。
9. FAILED、TIMED_OUT、CANCELLED、ABANDONED 状态不可改写为 SUCCEEDED。
10. Retry 创建新 Run，不修改旧 Run。
11. Run SUCCEEDED 不自动完成 WorkOrder 或 Task。
12. Agent 自报 Usage 只能是非权威补充；权威 Usage 来自 Runtime Adapter/Provider/计量层。
13. Usage 不得出现负数；分项缺失可为 null，不能伪造为 0。
14. continuationRef 必须 opaque、加密/受控存储且不能作为业务身份或授权凭据。
15. Heartbeat 过期后只能由 Lease/Timeout Policy 标记 ABANDONED/TIMED_OUT，不能由另一个 Worker直接接管同一 Run 并改写执行历史。
16. Cancel 请求与 Runtime 确认分开记录；未确认时不能虚假显示 CANCELLED。
17. Runtime Progress 不得包含模型私有 Chain of Thought；只记录用户可理解、可审计的阶段或计数。
18. 模型或 Harness 发生实际 fallback 时必须反映在新的 Run 或明确的 RuntimeBinding Event，不能静默伪装成原配置。

### 20.8 Domain Events

```text
RunCreated
RunLeaseAcquired
RunStarted
RunHeartbeatRecorded
RunProgressRecorded
RunInputRequired
RunCancellationRequested
RunCancellationAcknowledged
RunSuspended
RunResumed
RunTimedOut
RunRuntimeFailed
RunAgentResultRecorded
RunUsageRecorded
RunSucceeded
RunResultInvalid
RunCancelled
RunAbandoned
RunInvalidated
LateAgentResultReceived
RunResultReplayDetected
```

### 20.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 Run | 可通过 UI/Task 操作请求 | 不自主创建 | Dispatcher |
| 绑定 Runtime/Harness | 可明确 required/preferred | 不可自我替换 | Runtime Router/Dispatcher |
| 心跳/进度 | 不直接 | Runtime 中的 Agent 不直接写 Core | Runtime Adapter |
| Cancel 请求 | 授权 Human | Coordinator 按能力可请求 | Timeout/Budget Policy 可请求 |
| 记录 Result | 不直接拼写 AgentResult | Runtime Agent 输出 | Result Ingestion Service 验证写入 |
| 记录权威 Usage | 可查看 | 不可信 | Runtime Adapter/Provider Metering |
| 标记 SUCCEEDED/INVALID | 不直接 | 不允许 | Result Validator |
| 重新评估 late result | 授权管理员/业务负责人 | 不允许 | Recovery Service 执行显式命令 |

### 20.10 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| RN-U-001 | Unit | TIMED_OUT Run 请求改为 SUCCEEDED | 拒绝 `TERMINAL_RUN_IMMUTABLE` | NOT RUN：设计阶段 |
| RN-U-002 | Unit | 相同 ResultId、不同 PayloadHash 重复提交 | 拒绝并产生 RunResultReplayDetected | NOT RUN：设计阶段 |
| RN-U-003 | Unit | 已有 Final AgentResult 的 Run 再提交第二个结果 | 相同结果幂等；不同结果拒绝 `FINAL_RESULT_EXISTS` | NOT RUN：设计阶段 |
| RN-E-001 | E2E | RUN-1 timeout 后创建 RUN-2 fallback Codex | RUN-1 历史不变；RUN-2 attemptNumber 递增且使用新 Token/ContextSnapshot | NOT RUN：设计阶段 |
| RN-E-002 | E2E | Human cancel，Runtime 未响应，租约到期 | 先 CANCELLING，后 ABANDONED；不虚假标记 CANCELLED，late result 被隔离 | NOT RUN：设计阶段 |

---

## 21. AgentResult

### 21.1 业务含义

`AgentResult` 是 Runtime/Harness 对一次 Run 提交的不可变执行结果收据，回答：

> 这次执行声称发生了什么，产生了哪些 Core 对象引用、发现、输入请求和后续建议？

AgentResult 不是：

- Agent 的自由文本最终回答；
- WorkOrder 完成证明；
- Task 完成证明；
- 业务事实的自动写入；
- Artifact 正文容器；
- Runtime Usage 的唯一权威来源。

### 21.2 类型与 Aggregate 边界

类型：`Immutable Aggregate Root`。

它位于不可信 Runtime 与可信 Core 的边界，独立 Aggregate 有利于：

- Schema/contract version 验证；
- 签名、身份、Run 绑定和 PayloadHash；
- 幂等与 replay 防护；
- 业务对象引用验证；
- late result 隔离；
- Agent 声明与 Runtime 权威数据分离；
- CompletionEvaluator 独立消费。

建议概念模型：

```text
AgentResult
├── id
├── contractVersion
├── enterpriseId
├── projectId
├── taskId
├── workOrderId
├── runId
├── executionOutcome
├── businessOutputs[]
├── workspaceOutputs[]
├── findings[]
├── knowledgeProposals[]
├── inputRequestProposals[]
├── followUpProposals[]
├── agentDeclaredUsage?
├── runtimeUsageRef?
├── provenance
├── continuationProposal?
├── humanSummary
├── payloadHash
├── submittedAt
├── submittedByRuntime
└── validationStatus
```

Value Objects：

- `ExecutionOutcome`；
- `BusinessOutputRef`；
- `WorkspaceOutputRef`；
- `Finding`；
- `KnowledgeProposal`；
- `InputRequestProposal`；
- `FollowUpProposal`；
- `AgentDeclaredUsage`；
- `ResultProvenance`；
- `ContinuationProposal`；
- `HumanSummary`；
- `PayloadHash`。

### 21.3 ExecutionOutcome

建议枚举：

```text
COMPLETED
PARTIAL
BLOCKED_INPUT
BLOCKED_POLICY
FAILED_EXECUTION
CANCELLED_BY_RUNTIME
```

精确定义：

- `COMPLETED`：Agent 声称本次授权工作已执行完，不代表 Core 接受业务完成；
- `PARTIAL`：形成部分输出或进展；
- `BLOCKED_INPUT`：需要 Human/客户/系统提供信息；
- `BLOCKED_POLICY`：权限、风险或 Policy 阻止继续；
- `FAILED_EXECUTION`：执行未达到可提交程度；
- `CANCELLED_BY_RUNTIME`：Runtime 停止，但仍需与 Core Cancel 状态核对。

不使用含糊的：

```text
success: true
```

### 21.4 BusinessOutputs 与 WorkspaceOutputs

正式输出只引用已通过 Core Capability 创建的业务对象：

```text
businessOutputs:
  - type: ARTIFACT_REVISION
    ref: REV-019
  - type: REVIEW_ISSUE
    ref: RI-028
```

临时文件单独记录：

```text
workspaceOutputs:
  - type: SCRATCH_FILE
    ref: runtime://opaque/output-1
    checksum: ...
```

WorkspaceOutput：

- 可用于 Debug、Human inspection 或 continuation；
- 不自动进入 Artifact Store；
- 不满足 ExpectedBusinessOutput；
- 不可作为 Release 对象；
- 必须受保留和访问 Policy 控制。

### 21.5 Finding

Finding 是 Agent 观察，不是 BusinessFact。

建议分类：

```text
MISSING_INFORMATION
CONFLICTING_INFORMATION
REGULATORY_GAP
DOCUMENT_INCONSISTENCY
VALIDATION_ISSUE
UNEXPECTED_SCOPE
RISK
OTHER
```

Severity：

```text
INFO
WARNING
BLOCKING
```

Finding 可以触发：

- ReviewIssue 候选；
- InformationRequest 候选；
- FollowUpTask 候选；
- Human Review；

但不能直接修改 Fact、Task、DeliveryPlan 或 Artifact 状态。

### 21.6 KnowledgeProposal

建议类型：

```text
FACT
MEMORY
PREFERENCE
EVIDENCE_CANDIDATE
DECISION
```

每项包含：

```text
scope
subject
content
evidenceRefs[]
confidence?
rationale
```

关键语义：

```text
Agent propose
≠ Core commit
```

Proposal 必须进入对应领域的确认流程。

### 21.7 InputRequestProposal 与 FollowUpProposal

AgentResult 可以提出：

```text
InputRequestProposal
├── question
├── expectedAnswerType
├── reason
├── evidenceRefs[]
├── blocking
├── requestedResponderRole?
└── dueConstraint?
```

Result Processor 验证后通过 `create_information_request` 创建正式对象。Proposal 本身不能让 WorkOrder WAITING_INPUT。

FollowUpProposal 可以提出新 Task，但不能扩大当前 WorkOrder：

```text
FollowUpProposal
├── objective
├── reason
├── relatedRefs[]
├── proposedPriority
└── proposedRisk
```

### 21.8 关系

```text
Run 1 ── 0..1 accepted AgentResult
AgentResult * ── * BusinessObjectRef
AgentResult 1 ── * Finding
AgentResult 1 ── * KnowledgeProposal
AgentResult 1 ── * InputRequestProposal
AgentResult 1 ── * FollowUpProposal
AgentResult 1 ── 0..1 RuntimeUsageRef
```

### 21.9 Commands

由于 AgentResult 创建后不可变，命令集中在接收和验证：

```text
submit_agent_result
validate_agent_result_identity
validate_agent_result_schema
validate_business_output_refs
validate_result_scope
attach_runtime_usage_reference
accept_agent_result
reject_agent_result
quarantine_late_agent_result
record_result_replay_attempt
process_result_proposals
request_work_order_completion_evaluation
```

禁止：

```text
edit_agent_result
replace_agent_result_outputs
agent_accept_own_result
promote_workspace_file_to_business_output_implicitly
```

### 21.10 Lifecycle

```text
RECEIVED
    ↓
VALIDATING
    ├── ACCEPTED
    ├── REJECTED
    └── QUARANTINED

ACCEPTED
    ↓
PROCESSED
```

说明：

- `ACCEPTED` 只表示身份、Schema、Scope 和引用有效；
- `PROCESSED` 表示 Proposal 已转换为正式候选对象、CompletionEvaluator 已被触发；
- 处理结果不写回 AgentResult，而是形成独立事件和对象；
- REJECTED/QUARANTINED 后不可编辑修复，Runtime 必须提交新 ResultId，是否允许同 Run 重交由 Policy 决定；v0.1 默认一个 Run 只接受一个 final submission attempt，修复需新 Run。

### 21.11 Invariants

1. AgentResult 创建后 Payload 不可修改。
2. Result 必须绑定存在且未接受其他 final result 的 Run。
3. enterpriseId/projectId/taskId/workOrderId/runId 必须与 Run 链一致。
4. `submittedByRuntime` 必须是该 Run 绑定的 Runtime Adapter 身份。
5. payloadHash 必须覆盖全部业务字段，不能只覆盖 HumanSummary。
6. BusinessOutputRef 必须存在、属于同一 Enterprise/Project，并由当前 WorkOrder 授权的 Capability/Run 创建或显式允许引用。
7. WorkspaceOutput 不得满足 ExpectedBusinessOutput。
8. Agent 自报 ExecutionOutcome=COMPLETED 不完成 WorkOrder/Task。
9. Finding 不自动成为 Fact 或 ReviewIssue。
10. KnowledgeProposal 不自动写入长期知识。
11. InputRequestProposal 必须经 Result Processor 创建正式 InformationRequest 后，才能阻塞 WorkOrder。
12. FollowUpProposal 不自动创建 Task，除非明确 Policy 允许低风险自动创建 DRAFT Task；即使自动创建也不能自动 READY。
13. AgentDeclaredUsage 不得覆盖 RuntimeUsageRecord；差异必须可审计。
14. ResultProvenance 必须引用 ContextSnapshot、WorkOrder/Policy/Skill/Template 版本以及实际 Harness/Model。
15. late result、cancelled Run result 或 scope mismatch result 不得触发业务状态变更。
16. HumanSummary 必须是用户可读摘要，不能保存隐式 Chain of Thought。
17. AgentResult 不承载 Artifact 全文；正式内容已存在 Core Object 中。
18. 相同 ResultId/PayloadHash 重放幂等；相同 ResultId 不同 PayloadHash 是安全异常。
19. ACCEPTED Result 的 BusinessOutput 被后续作废时，不修改 AgentResult；通过独立对象状态和事件反映。
20. `PARTIAL` 结果可以保存有效 BusinessOutput，但是否继续 WorkOrder 由 CompletionEvaluator/ExecutionPolicy 决定。

### 21.12 Domain Events

```text
AgentResultReceived
AgentResultValidationStarted
AgentResultAccepted
AgentResultRejected
AgentResultQuarantined
AgentResultProcessed
AgentResultReplayDetected
BusinessOutputReferenceValidated
FindingRecorded
KnowledgeProposalRecorded
InputRequestProposalRecorded
FollowUpProposalRecorded
RuntimeUsageAttachedToResult
WorkOrderCompletionEvaluationTriggered
```

### 21.13 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 提交 AgentResult | 不手工伪造 | 通过绑定 Runtime 输出 | Runtime Adapter 认证提交 |
| 校验身份/Scope/Schema | 不直接 | 不允许 | Result Validation Service |
| 接受/拒绝 Result | 不按内容喜好直接改 | 不允许 | 确定性 Validator/Policy |
| 查看 HumanSummary | 按项目权限 | 当前 WorkOrder Context 可见 | Channel/Workspace Service |
| 查看 WorkspaceOutput | 按敏感/保留 Policy | 仅 continuation 授权 | Runtime Artifact Service |
| 采纳 KnowledgeProposal | 对应领域授权 Human | 不允许自采纳 | Proposal Workflow Service |
| 创建正式 InformationRequest | Human 可直接创建 | 只能提出 | Result Processor 按规则创建 |
| 触发 CompletionEvaluator | 可请求 | 结果处理后可触发 | Result Processor |

### 21.14 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| AR-U-001 | Unit | AgentResult 只有 scratch DOCX，无 BusinessOutputRef | 可接受执行记录但不满足 ExpectedOutput，WorkOrder 不完成 | NOT RUN：设计阶段 |
| AR-U-002 | Unit | AgentResult 引用其他 Project 的 REV | 拒绝 `CROSS_PROJECT_OUTPUT_REFERENCE` 并记录安全事件 | NOT RUN：设计阶段 |
| AR-U-003 | Unit | AgentDeclaredUsage 与 RuntimeUsage 相差显著 | RuntimeUsage 保持权威，记录差异，不改写结果 Payload | NOT RUN：设计阶段 |
| AR-E-001 | E2E | Agent 返回 REV-019、blocking Finding 和输入请求建议 | 验证 REV；创建正式 InformationRequest；WorkOrder WAITING_INPUT；Finding 不自动成为 Fact | NOT RUN：设计阶段 |
| AR-E-002 | E2E | Cancelled Run 迟到提交格式正确的结果 | Result QUARANTINED/LATE；不触发 Artifact、Task 或 WorkOrder 状态变化 | NOT RUN：设计阶段 |

---

## 22. InformationRequest

### 22.1 业务含义

`InformationRequest` 是项目中正式、持久、可投递、可回答和可解决的信息请求，回答：

> 为继续某个 Task/WorkOrder 或确认某项业务判断，需要谁提供什么信息，答案是否已经被授权采纳？

典型例子：

```text
IR-102
请确认当前质量负责人是李四还是王五，并提供依据。
```

InformationRequest 解决的问题不能只藏在：

- Agent 最终回复；
- 飞书聊天滚动历史；
- Task 备注；
- Runtime Session；
- `WAITING_INPUT` 字符串原因。

### 22.2 类型与 Aggregate 边界

类型：`Aggregate Root`。

原因：

- 请求可能跨越多个 Run 和几天时间；
- 可以通过飞书、Workspace 或其他 Channel 投递；
- 可能收到多个候选回答、附件或相互冲突的回答；
- “已回答”与“答案已采纳并解决阻塞”不同；
- 需要独立权限、期限、提醒和审计；
- 一个请求可以阻塞 Task、WorkOrder、GapItem 或 ReviewIssue。

建议概念模型：

```text
InformationRequest
├── id
├── enterpriseId
├── projectId
├── taskId?
├── workOrderId?
├── runId?
├── relatedRefs[]
├── requestType
├── question
├── reason
├── expectedAnswerSpec
├── requestedResponder
├── blocking
├── status
├── deliveryRecords[]
├── answerSubmissions[]
├── acceptedAnswerRef?
├── resolution
├── dueAt?
├── expiresAt?
├── createdBy
├── createdAt
├── resolvedBy?
├── resolvedAt?
└── version
```

内部 Entity：

- `DeliveryRecord`：投递到哪个 Channel/用户/话题、是否送达；
- `AnswerSubmission`：谁、通过哪个 Channel、在何时提交了什么答案和附件；
- `RequestResolution`：哪个答案被采纳、形成什么业务对象或决定、由谁解决。

Value Objects：

- `InformationQuestion`；
- `ExpectedAnswerSpec`；
- `RequestedResponder`；
- `ChannelDeliveryRef`；
- `AnswerContent`；
- `AnswerEvidenceRef`；
- `ResolutionDisposition`；
- `DueConstraint`。

### 22.3 RequestType

建议枚举：

```text
CUSTOMER_INFORMATION
HUMAN_DECISION
FACT_CONFIRMATION
MATERIAL_REQUEST
PERMISSION_REQUEST
POLICY_EXCEPTION
REVIEW_CLARIFICATION
OTHER
```

ExpectedAnswerSpec 可以约束：

```text
TEXT
BOOLEAN_CONFIRMATION
CHOICE
STRUCTURED_VALUE
SOURCE_MATERIAL
EVIDENCE_REFERENCE
DECISION
```

“请确认质量负责人”不能用任意 emoji 或无身份群成员回复直接满足；需要符合 AnswerSpec 和 Responder Policy。

### 22.4 关系

```text
Project 1 ── * InformationRequest
Task 0..1 ── * InformationRequest
WorkOrder 0..1 ── * InformationRequest
Run 0..1 ── * InformationRequest origin
InformationRequest 1 ── * AnswerSubmission
InformationRequest 1 ── * DeliveryRecord
InformationRequest 0..1 ── 1 AcceptedAnswer
InformationRequest * ── * SourceMaterial / Evidence / Decision / FactProposal
```

一个 Request 可以由 AgentResult Proposal 产生，但正式对象由 Core 创建并分配 ID。

### 22.5 Commands

```text
create_information_request
link_information_request_to_blocker
assign_requested_responder
deliver_information_request
record_information_request_delivery
submit_information_answer
attach_answer_source_material
validate_information_answer
accept_information_answer
reject_information_answer
request_answer_clarification
resolve_information_request
cancel_information_request
expire_information_request
reopen_information_request
redeliver_information_request
```

禁止：

```text
resolve_from_unmapped_feishu_message
agent_accept_own_answer
edit_accepted_answer_in_place
delete_request_history_to_unblock_work
```

### 22.6 Lifecycle

```text
OPEN
    ↓
DELIVERY_PENDING
    ↓
DELIVERED
    ├── ANSWERED
    ├── DELIVERY_FAILED
    ├── EXPIRED
    └── CANCELLED

ANSWERED
    ├── UNDER_VALIDATION
    │       ├── RESOLVED
    │       ├── CLARIFICATION_REQUIRED
    │       └── ANSWER_REJECTED
    ├── EXPIRED
    └── CANCELLED

CLARIFICATION_REQUIRED / ANSWER_REJECTED
    └── DELIVERED / ANSWERED

RESOLVED
    └── REOPENED → OPEN or DELIVERY_PENDING
```

状态语义：

- `DELIVERED`：Channel 确认送达，不代表对方已读；
- `ANSWERED`：收到候选答案，不代表内容有效；
- `UNDER_VALIDATION`：正在验证身份、类型、证据和冲突；
- `RESOLVED`：授权角色采纳了明确答案，并完成所需领域命令或记录了 Resolution；
- `EXPIRED`：超过期限，阻塞不会自动解除；
- `DELIVERY_FAILED`：Channel 投递失败，需要重新路由或 Human 处理。

### 22.7 飞书双向 Channel 语义

通过飞书回答的完整链路：

```text
InformationRequest
    ↓ deliver_information_request
Feishu Channel Adapter
    ↓ interactive card / thread message
授权 Human 回复文字、选择或附件
    ↓ Feishu event
验证 tenant + open_id + chat/thread + request nonce + project permission
    ↓ submit_information_answer
AnswerSubmission
    ↓ validate_information_answer
Human/Domain Service accept
    ↓ resolve_information_request
    ↓
create new ContextSnapshot / resume WorkOrder
```

必须满足：

- 飞书 `messageId` 只是 ChannelDeliveryRef/AnswerSourceRef，不是 Answer ID；
- 同一个事件重复推送必须幂等；
- 群内任意成员回复不自动成为有效答案；
- 私聊转发、跨群引用和截图不自动继承原回答人身份；
- 附件答案先创建 SourceMaterial，再由 AnswerSubmission 引用；
- 消息撤回后记录撤回，已采纳答案是否失效由 Resolution Policy 决定，不能物理删除审计；
- 回答中的新企业事实仍需进入 Fact 确认流程；InformationRequest RESOLVED 不自动等于 Fact CONFIRMED，除非 resolution 命令明确完成该领域确认。

### 22.8 Invariants

1. InformationRequest 必须属于一个 Enterprise/Project。
2. blocking Request 必须至少关联一个 Task、WorkOrder、GapItem、ReviewIssue 或其他明确 BlockedRef。
3. Agent 可以提出 Request，但不能决定 requested Human 的回答已经有效。
4. AnswerSubmission 必须绑定已认证 Principal 或明确 ExternalPartyRef，并保留 Channel Provenance。
5. 未映射飞书用户、无项目权限用户或错误话题的回复不得成为有效 AnswerSubmission。
6. ANSWERED 不等于 RESOLVED。
7. RESOLVED 必须有 acceptedAnswerRef、resolver、resolution disposition 和相关领域命令/对象引用。
8. accepted Answer 创建后不可原地修改；纠正必须新增 AnswerSubmission 并 reopen/resolve。
9. 多个相互冲突的候选回答必须进入 CLARIFICATION_REQUIRED，不得按最新消息静默覆盖。
10. blocking Request 只有 RESOLVED 或显式 CANCELLED with authorized override 后才能解除阻塞。
11. EXPIRED 不自动解除 Task/WorkOrder WAITING_INPUT。
12. CANCELLED Request 必须记录原因；如果仍有业务信息缺口，应创建替代 Request 或保留 Blocker。
13. Answer 附件必须引用 ACCEPTED SourceMaterial；不能直接信任飞书临时 URL。
14. Request 投递失败不改变其业务问题；允许重投到同一或其他授权 Channel。
15. 重复 Feishu event/messageId 必须幂等；相同 nonce 被不同用户使用需要安全审计。
16. RESOLVED Request 恢复 WorkOrder 时必须创建或引用新的 ContextSnapshot，不修改原 Run 的快照。
17. 一个答案涉及高风险法规、Fact、Approval 或 Policy Exception 时，必须经过对应领域权限，不能仅由 Request creator 自己采纳。
18. InformationRequest 不保存飞书消息全文作为唯一内容；应保存规范化 AnswerContent、来源引用和必要受控附件。
19. 用户离职、群解散或 Channel 不可用不会删除 Request；进入 DELIVERY_FAILED 并重新分配。
20. Request Reopen 必须记录为什么先前 Resolution 不再充分以及受影响的 WorkOrder/Task。

### 22.9 Domain Events

```text
InformationRequestCreated
InformationRequestLinkedToBlocker
InformationResponderAssigned
InformationRequestDeliveryPending
InformationRequestDelivered
InformationRequestDeliveryFailed
InformationAnswerSubmitted
InformationAnswerSourceAttached
InformationAnswerValidationStarted
InformationAnswerAccepted
InformationAnswerRejected
InformationClarificationRequested
InformationRequestResolved
InformationRequestCancelled
InformationRequestExpired
InformationRequestReopened
InformationRequestRedeliveryRequested
InformationAnswerSourceWithdrawn
BlockedWorkResumeRequested
```

### 22.10 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 Request | 授权项目成员 | 只能提出 Proposal；有专门 Capability 时可创建 DRAFT/OPEN | Result Processor/Process Manager |
| 指定 Responder | Task owner/项目经理/专业角色 | 只能建议角色 | Routing Service 按 Policy 解析 |
| 投递飞书 | 不直接调用渠道底层 | 不允许 | Feishu Channel Service |
| 提交 Answer | 被请求或具权限 Human；外部客户按映射规则 | 不允许冒充 Human | Channel/Workspace Service 认证提交 |
| 验证格式/身份 | 可查看 | 不允许 | Answer Validator |
| 采纳普通答案 | 授权 Task owner/领域角色 | 不允许 | Domain Service 执行 Human Command |
| 采纳高风险决定 | 指定专业/审批角色 | 不允许 | 对应 Domain Policy |
| Resolve | 授权 Human 或确定性 Resolution Policy | 不允许 | InformationRequest Service |
| Cancel/Reopen | Task owner/项目经理 | 不允许最终决定 | Timeout/Policy 仅按明确规则 |

### 22.11 测试用例

| ID | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| IR-U-001 | Unit | 群内无项目权限用户回复 Request 卡片 | 拒绝 AnswerSubmission，记录授权失败 | NOT RUN：设计阶段 |
| IR-U-002 | Unit | 收到答案后直接请求 WorkOrder resume，Request 尚未 RESOLVED | 拒绝 `INFORMATION_REQUEST_UNRESOLVED` | NOT RUN：设计阶段 |
| IR-U-003 | Unit | 两个授权 Human 提交相互冲突答案 | 状态 CLARIFICATION_REQUIRED，不按时间覆盖 | NOT RUN：设计阶段 |
| IR-E-001 | E2E | Agent 发现质量负责人冲突，飞书向项目经理发送交互卡片，项目经理选择并附来源 | 创建 AnswerSubmission 和 SourceMaterial，授权 Human 采纳后 RESOLVED；新 ContextSnapshot 恢复 WorkOrder | NOT RUN：设计阶段 |
| IR-E-002 | E2E | 飞书重复投递同一回答事件三次 | 只创建一个 AnswerSubmission；幂等审计可见；不重复恢复 WorkOrder | NOT RUN：设计阶段 |

---

## 23. 五个概念的职责矩阵

| 概念 | 回答的问题 | 不负责 |
|---|---|---|
| Task | 业务上需要做什么，当前处于什么工作阶段？ | 表示一次 Harness 执行或正式成果 |
| WorkOrder | 这一次被授权执行什么，约束与完成标准是什么？ | 充当 Prompt、Session 或业务成果 |
| Run | 哪个 Runtime/Harness 进行了一次什么执行尝试？ | 判断 WorkOrder、Task 或 DeliveryItem 业务完成 |
| AgentResult | 这次 Run 声称产生了什么结果和建议？ | 自动确认 Fact、批准输出或完成业务工作 |
| InformationRequest | 为继续工作需要谁提供什么，答案是否被正式采纳？ | 把飞书消息本身当作业务事实 |

### 23.1 四层完成语义

```text
Run SUCCEEDED
= 执行边界接受了不可变 AgentResult

WorkOrder COMPLETED
= ExpectedOutput 和 WorkOrderCompletionCriteria 已满足

Task COMPLETED
= 整个业务工作及其全部必要 WorkOrder/Review/Output 已满足

DeliveryItem COMPLETED
= 正式 Artifact、Quality Gate、Human Approval 和所需 Release 已满足
```

四层不能相互替代。

---

## 24. 关键端到端流程

### 24.1 从飞书创建 Task 并执行

```text
授权用户在已绑定项目话题发送任务请求
    ↓
Feishu Channel 验证 Principal / Project binding
    ↓
创建 Task DRAFT
    ↓
Human 或 Coordinator 完成 Objective / Scope
    ↓
ReadinessEvaluator → Task READY
    ↓
创建并冻结 WorkOrder
    ↓
Dispatcher 选择符合 Policy 的 Runtime Adapter
    ↓
创建 Run + ContextSnapshot + Capability Token
    ↓
Runtime 执行并提交 AgentResult
    ↓
Result Validator
    ↓
WorkOrder / Task CompletionEvaluator
```

飞书原消息只作为 Task OriginRef，不是 Task Definition Source of Truth。Task Objective 经规范化和权限确认后保存在 Core。

### 24.2 阻塞输入与恢复

```text
Runtime 请求输入
    ├── pre-final RuntimeInputRequired → Run SUSPENDED
    └── final AgentResult BLOCKED_INPUT → Run SUCCEEDED at execution boundary
    ↓
Input signal / Result Processor 验证并创建 InformationRequest
    ↓
WorkOrder / Task → WAITING_INPUT
    ↓
Feishu Channel 投递卡片或话题消息
    ↓
授权 Human 回答
    ↓
AnswerSubmission → Validation → Resolution
    ↓
创建新 ContextSnapshot
    ↓
ExecutionPolicy 决定：
├── pre-final suspended Run + unchanged token/context → Resume same Run
└── final AgentResult or changed token/context → Retry with new Run
```

### 24.3 Runtime 失败与 Harness fallback

```text
RUN-1 Claude Code TIMED_OUT
    ↓
WorkOrder → RETRY_PENDING
    ↓
Policy 检查 budget / requiredHarness / retry limit
    ↓
RUN-2 Codex CREATED
    ↓
新 Capability Token + 新 attemptNumber
    ↓
旧 Run 保持不可变
```

如果 WorkOrder 指定 `requiredHarness=claude-code`，则不能自动 fallback 到 Codex，只能等待、失败或由 Human 创建新 WorkOrder/改变授权。

### 24.4 迟到结果

```text
Run 已 CANCELLED / TIMED_OUT / ABANDONED
    ↓
Runtime 迟到提交 AgentResult
    ↓
Quarantine as LATE_RESULT
    ↓
不触发 BusinessOutput / Completion / Proposal processing
    ↓
必要时由授权 Human 发起 recovery review
```

### 24.5 Agent 提议范围外工作

```text
当前 WorkOrder：修订采购程序第 4 章
Agent 发现质量手册也需修改
    ↓
FollowUpProposal
    ↓
Result Processor / Coordinator 创建 DRAFT Task 候选
    ↓
Human/Policy 决定是否进入 BACKLOG / READY
```

Agent 不得在当前 Run 中直接修改质量手册。

---

## 25. Context、Capability 与 Provenance

### 25.1 ContextSnapshot

每个 Run 必须引用不可变 ContextSnapshot，至少记录：

```text
projectContextVersion
enterpriseProfileSnapshotId
qmsConfigurationVersionId
customerBaselineVersionId?
templateBaselineVersionId?
regulatoryProfileVersionId?
deliveryPlanVersionId?
taskVersion
workOrderVersion
selected content refs and hashes
createdAt
builderPolicyVersion
```

InformationRequest RESOLVED 后创建新快照，旧 Run 快照保持不变。

### 25.2 Capability Token

每个 Run 的短期执行 Token 至少绑定：

```text
agentPrincipalId
actingForHumanId?
enterpriseId
projectId
taskId
workOrderId
runId
harness
capabilities[]
resource constraints
issuedAt
expiresAt
tokenId
```

Token 不继承 Human 的 approve/release 权限，不跨 Run 复用。

### 25.3 Usage

权威优先级：

```text
Provider metering
    ↓
Runtime Adapter metering
    ↓
Harness telemetry
    ↓
Agent self-report (diagnostic only)
```

字段至少包括：

```text
inputTokens
cachedInputTokens?
cacheWriteTokens?
outputTokens
reasoningTokens?
toolCalls?
estimatedCost
currency
measurementSource
```

缺失字段使用 null，不使用伪造 0。

### 25.4 Provenance

AgentResult/Run 必须可追溯：

```text
Runtime Adapter + version
Harness + version
Provider + model + model config
WorkOrder contract version
ContextSnapshot
Policy version
Skill version
TemplateBaseline
RegulatoryProfile
execution node
```

---

## 26. Task Board Projection

Board 是 Projection，不直接存储另一套状态。

建议列：

```text
BACKLOG
READY
RUNNING
WAITING_INPUT
BLOCKED
REVIEW
DONE
CANCELLED
```

映射示例：

| Task Domain Status | Board Column |
|---|---|
| DRAFT / BACKLOG | BACKLOG |
| READY | READY |
| IN_PROGRESS / COMPLETION_PENDING | RUNNING |
| WAITING_INPUT | WAITING_INPUT |
| BLOCKED | BLOCKED |
| IN_REVIEW / CHANGES_REQUIRED | REVIEW |
| COMPLETED | DONE |
| CANCELLED | CANCELLED |

Board 卡片可以显示：

- Task；
- Human/AgentProfile Assignee；
- active WorkOrder/Run；
- Harness/Model；
- InformationRequest；
- BusinessOutput；
- Usage；
- Due/priority/risk；

但这些均通过 Core 对象引用和 Projection 获取，不能直接在看板拖拽时绕过 Command/Invariant。拖拽只是发起状态变更意图。

---

## 27. Domain Error Taxonomy 补充

```text
TASK_NOT_EXECUTABLE
CYCLIC_TASK_DEPENDENCY
TASK_COMPLETION_CRITERIA_NOT_MET
TASK_HAS_BLOCKING_REQUEST
WORK_ORDER_SPEC_IMMUTABLE
WORK_ORDER_SCOPE_VIOLATION
HUMAN_ONLY_CAPABILITY
ACTIVE_RUN_EXISTS
WORK_ORDER_BUDGET_EXCEEDED
WORK_ORDER_EXPIRED
WORK_ORDER_COMPLETION_CRITERIA_NOT_MET
TERMINAL_RUN_IMMUTABLE
RUN_CONTEXT_IMMUTABLE
RUN_TOKEN_INVALID
FINAL_RESULT_EXISTS
LATE_RESULT_QUARANTINED
RESULT_REPLAY_DETECTED
AGENT_RESULT_SCHEMA_INVALID
AGENT_RESULT_SCOPE_MISMATCH
BUSINESS_OUTPUT_NOT_FOUND
CROSS_PROJECT_OUTPUT_REFERENCE
INFORMATION_REQUEST_UNRESOLVED
INFORMATION_RESPONDER_UNAUTHORIZED
INFORMATION_ANSWER_INVALID
CONFLICTING_INFORMATION_ANSWERS
CHANNEL_DELIVERY_FAILED
```

---

## 28. 本阶段设计取舍

### 28.1 采用的决定

- Task、WorkOrder、Run、AgentResult、InformationRequest 均独立建模；
- AgentResult 是不可变 Aggregate Root；
- InformationRequest 是正式 Aggregate Root；
- WorkOrder READY 后冻结 Specification；
- v0.1 默认同一 WorkOrder 只允许一个 active Run；
- Resume 与 Retry 分开；
- 一个 Run 只接受一个 final AgentResult；
- AgentResult 的正式输出使用 Core Object Reference；
- Completion 分 Run、WorkOrder、Task、DeliveryItem 四层；
- Task Board 是 Projection；
- 飞书 Answer 需要映射成正式 AnswerSubmission 和 Resolution。

### 28.2 暂不设计

- Runtime Adapter 的代码接口；
- 飞书 Event/Card JSON Schema；
- Capability Token 的具体签名格式；
- Provider 计费对账实现；
- 通用 Workflow Engine；
- 多 active Run 竞赛模式；
- 分布式租约数据库实现；
- Chain of Thought 存储；
- Coordinator 自动规划算法；
- Task 进度百分比的通用算法。

---

## Part E. Artifact / Quality Domain

Artifact / Quality Domain 回答四个不同问题：

```text
Artifact + ArtifactRevision
= 正式业务成果是什么，内容如何演进

Evidence
= 成果中的判断依据什么成立

QualityProfile + GateResult + ReviewIssue
= 机器和专业 Review 如何证明质量要求已满足

Approval + Release
= 哪位 Human 接受了哪个精确版本，以及它如何成为正式交付或有效版本
```

必须固定：

```text
生成了文件
≠ 形成 ArtifactRevision
≠ 通过 Quality Gate
≠ Human Approval
≠ Release
≠ 企业当前 Effective Version
```

飞书在 MVP 是完整双向 Agent Channel，但它只承载通知、问答、Review 和已授权发布动作。普通聊天中上传或发送文件，不能隐式完成 Approval、Release 或 Effective Version 切换。

---

## 29. Artifact

### 29.1 业务语义

`Artifact` 是一个长期存在的受控业务成果身份，例如“采购控制程序”“质量手册”“供应商审核表”或“差距分析报告”。它不是 DOCX/PDF 文件，也不是某一次内容版本。

同一个 Artifact 可以跨越多个 Revision、Review、Approval、Release 和项目周期。新 Revision 的产生不改变已经批准、发布或生效的旧 Revision。

### 29.2 类型与 Aggregate Boundary

`Artifact` 是 Aggregate Root，保持轻量，只保存身份、业务范围、分类、关系和权威指针：

```text
Artifact
├── artifactId
├── enterpriseId
├── businessScope
├── originProjectId?
├── artifactType
├── title
├── classification
├── lifecycleStatus
├── workingHeads[]
├── currentApprovedRevisionRefs[]
├── effectiveBindings[]
├── deliveryItemRefs[]
├── createdAt
├── createdBy
└── metadataVersion
```

`businessScope`：

```text
PROJECT_DELIVERABLE(projectId)
ENTERPRISE_CONTROLLED
```

项目交付成果可在受控命令下被提升为企业长期受控成果，但不能仅通过改字段改变范围；提升必须保留来源 Project、批准依据和迁移事件。

建议第一版 `artifactType`：

```text
QUALITY_MANUAL
PROCEDURE
MANAGEMENT_RULE
RECORD_FORM
REGULATORY_ASSESSMENT
GAP_REPORT
TRAINING_MATERIAL
OTHER_CONTROLLED_DOCUMENT
```

`workingHeads` 是按显式 Branch 标识的当前工作头。`currentApprovedRevisionRefs` 和 `effectiveBindings` 是可重建的权威 Projection/绑定，不代表 Revision 本身被修改。

### 29.3 关系

```text
Enterprise 1 ── * Artifact
Project 1 ── * PROJECT_DELIVERABLE Artifact
DeliveryItem * ── * Artifact
Artifact 1 ── * ArtifactRevision
Artifact 1 ── * Approval
Artifact 1 ── * Release
Artifact 1 ── * EffectiveBinding
```

`EffectiveBinding` 至少包含：

```text
purpose
revisionRef
releaseRef
effectiveFrom
effectiveTo?
supersededByReleaseRef?
```

一个 Artifact 可以因用途不同同时存在内部有效版本和客户交付版本；每个相同 `purpose` 在任一时间最多一个有效绑定。

### 29.4 Commands

```text
create_artifact
update_artifact_metadata
link_artifact_to_delivery_item
unlink_artifact_from_delivery_item
register_revision_branch
move_working_head
record_approved_revision_binding
record_effective_binding
supersede_effective_binding
promote_project_artifact_to_enterprise_controlled
archive_artifact
reactivate_artifact
cancel_artifact
```

禁止：

```text
replace_artifact_content
overwrite_revision
set_effective_revision_without_release
set_approved_revision_from_agent_result
```

### 29.5 Lifecycle

```text
ACTIVE
  ├── ARCHIVED
  └── CANCELLED

ARCHIVED
  └── ACTIVE  （授权恢复）
```

Artifact 生命周期与 Revision、Approval、Release 生命周期分离。Artifact ACTIVE 不代表其已有已批准或有效版本。

### 29.6 Invariants

1. Artifact 不保存正文或文件二进制内容。
2. 所有 Revision、Approval、Release 和 EffectiveBinding 必须属于同一 Artifact 与 Enterprise。
3. PROJECT_DELIVERABLE Artifact 的 Project 必须属于同一 Enterprise。
4. 新建 Revision 只移动对应 Branch 的 working head，不移动批准或有效绑定。
5. 多个 Branch 并存时禁止 last-write-wins；合并必须创建显式 Merge Revision。
6. currentApprovedRevisionRefs 只能由有效 Human Approval 推导或写入。
7. EffectiveBinding 只能引用已成功 Release 的精确 Revision。
8. 相同 purpose 的 EffectiveBinding 时间区间不得重叠。
9. Release 新版本时必须显式 supersede 旧绑定；新 Draft 不影响旧版本。
10. ARCHIVED/CANCELLED Artifact 不得创建新 Revision；恢复后才可继续。
11. 项目成果提升为企业受控成果必须保留 originProjectId、来源 Revision、批准和审计记录。
12. Artifact 标题或分类修改不能改变既有 Revision/Release 的历史快照。

### 29.7 Domain Events

```text
ArtifactCreated
ArtifactMetadataUpdated
ArtifactLinkedToDeliveryItem
ArtifactUnlinkedFromDeliveryItem
RevisionBranchRegistered
WorkingHeadMoved
ApprovedRevisionBindingRecorded
EffectiveBindingRecorded
EffectiveBindingSuperseded
ProjectArtifactPromoted
ArtifactArchived
ArtifactReactivated
ArtifactCancelled
```

### 29.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 Artifact | 项目授权角色可创建 | WorkOrder 授权时可提出/创建 | 校验 Scope 与幂等性 |
| 修改业务元数据 | Artifact owner/项目负责人 | 只能提出 | Policy 校验并审计 |
| 创建 Branch/Revision | 授权作者 | WorkOrder 授权时可创建 | Revision Service |
| 移动批准/有效绑定 | 不直接手工指定 | 禁止 | Approval/Release 事件驱动 |
| 提升为企业受控成果 | 指定质量角色批准 | 只能提出 | Governance Service |
| Archive/Cancel | 授权 Human | 禁止 | 执行并保留审计 |

### 29.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| AT-U-001 | Unit | 已有 approved REV-004 时创建 REV-005 Draft | approved binding 仍引用 REV-004 | NOT RUN：设计阶段 |
| AT-U-002 | Unit | 已有 active EffectiveBinding 时创建新 Revision | EffectiveBinding 不变 | NOT RUN：设计阶段 |
| AT-U-003 | Unit | 同 purpose 建立重叠时间区间的第二个 EffectiveBinding | 拒绝 `OVERLAPPING_EFFECTIVE_BINDING` | NOT RUN：设计阶段 |
| AT-E-001 | E2E | 两个 Agent Branch 并行修订后提交 | 两个 working head 均保留；必须显式 Merge，不按最后写入覆盖 | NOT RUN：设计阶段 |
| AT-E-002 | E2E | Human 将项目采购程序提升为企业受控成果 | 保留 originProject、来源 Revision、Approval 和迁移审计 | NOT RUN：设计阶段 |

---

## 30. ArtifactRevision

### 30.1 业务语义

`ArtifactRevision` 是 Artifact 在某一时点的精确、不可变内容版本。任何正文、结构、关键元数据、来源或生成上下文变化，都必须产生新 Revision。

Revision 是质量检查、ReviewIssue、Approval 和 Release 的最小绑定单位；不能批准“最新版本”这种会漂移的引用。

### 30.2 类型与 Aggregate Boundary

`ArtifactRevision` 是独立 Aggregate Root：

```text
ArtifactRevision
├── revisionId
├── artifactId
├── enterpriseId
├── revisionNumber
├── branchId
├── parentRevisionRefs[]
├── contentType
├── contentRef
├── contentHash
├── structureSchemaVersion
├── semanticMetadata
├── changedUnits[]
├── changeSummary
├── provenance
├── createdAt
├── createdBy
├── sealedAt
└── disposition
```

`contentType`：

```text
STRUCTURED_DOCUMENT
WORKBOOK_SPEC
STRUCTURED_REPORT
OPAQUE_IMPORTED_CONTENT
```

`provenance` 至少包含：

```text
principal
actingFor?
taskRef?
workOrderRef?
runRef?
agentResultRef?
contextSnapshotRef?
templateBaselineRef?
regulatoryProfileRef?
sourceMaterialRefs[]
toolchainVersions[]
```

Revision 的质量状态、Approval 状态和 Release 状态不写成可编辑字段，而从独立对象投影得到。

### 30.3 Lineage 与 Merge

```text
初始 Revision: parentRevisionRefs = []
普通 Revision: parentRevisionRefs = [one parent]
Merge Revision: parentRevisionRefs = [two or more parents]
```

Merge Revision 还必须记录：

```text
mergeStrategy
conflictSet
conflictResolutionRefs[]
resolvedBy
```

Branch 只是并行演进标识，不复制 Artifact 身份。不同 Artifact 之间不能使用 parentRevisionRefs；需要复用时使用来源引用或派生关系。

### 30.4 Commands

```text
create_and_seal_revision
create_merge_revision
validate_revision_content
withdraw_revision
supersede_revision
invalidate_revision
```

`create_and_seal_revision` 是原子动作。Core 不暴露“创建后再任意修改”的半成品正式 Revision；Runtime 的草稿工作区不是 ArtifactRevision。

禁止：

```text
edit_revision_content
replace_revision_hash
change_revision_provenance
change_revision_parent
approve_latest_revision
```

### 30.5 Lifecycle

内容创建过程：

```text
CREATING
   ↓ 原子校验与封存
SEALED
```

封存后的治理 disposition：

```text
ACTIVE
  ├── SUPERSEDED
  ├── WITHDRAWN
  └── INVALIDATED
```

Disposition 变化不改内容 Payload；以独立治理事件和原因记录。被 Superseded 不等于删除，也不使历史 Approval/Release 消失。

### 30.6 Invariants

1. SEALED 后正文、结构、关键元数据、parent、hash 和 provenance 永久不可变。
2. contentHash 必须覆盖可决定业务语义的 Canonical Content，不只覆盖渲染文件。
3. 同 Artifact 的 revisionNumber 必须唯一且单调，但不能用它替代 revisionId/hash。
4. 所有 parent 必须属于同一 Artifact 和 Enterprise。
5. 普通 Revision 必须有且仅有一个 parent；Merge Revision 至少两个 parent。
6. Lineage 必须是有向无环图。
7. 合并冲突必须显式记录并解决，禁止静默选择最后写入内容。
8. changedUnits 必须能支持 Gate 影响分析；无法证明范围时视为全文变化。
9. Agent 创建的 Revision 必须绑定授权 WorkOrder/Run；Human 手工创建也必须有来源说明。
10. OPAQUE_IMPORTED_CONTENT 必须标记可执行 Gate 的限制，不能伪装为结构化内容。
11. CustomerMaterial 导入形成 Revision 不自动获得 Approval 或 Effective 状态。
12. WITHDRAWN/INVALIDATED Revision 不得新建 Approval 或 Release。
13. 已 Release Revision 即使后来撤回或作废也不得物理删除。
14. 渲染 DOCX/PDF/XLSX 是 Representation，不是 Revision Source of Truth。

### 30.7 Domain Events

```text
ArtifactRevisionCreated
ArtifactRevisionSealed
MergeRevisionCreated
RevisionContentValidated
RevisionSuperseded
RevisionWithdrawn
RevisionInvalidated
RevisionLineageViolationDetected
```

### 30.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建 Revision | 授权作者 | 必须有 WorkOrder Capability | Revision Service 校验并封存 |
| 创建 Merge Revision | 授权作者/Reviewer | 仅明确授权 | Merge Validator |
| 修改已封存内容 | 禁止 | 禁止 | 禁止 |
| Withdraw | Artifact owner/质量角色 | 只能提出 | Governance Service |
| Invalidate | 指定质量/安全角色 | 只能提出异常 | Governance Service |
| 查看受限内容 | 按数据权限 | 仅 Context 授权范围 | Access Policy Service |

### 30.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| RV-U-001 | Unit | 对 SEALED Revision 修改正文 | 拒绝 `REVISION_IMMUTABLE` | NOT RUN：设计阶段 |
| RV-U-002 | Unit | 修改 Canonical Content | 创建新 revisionId 和 contentHash，旧 Revision 不变 | NOT RUN：设计阶段 |
| RV-U-003 | Unit | Merge Revision 有冲突但无解决记录 | 拒绝 `MERGE_CONFLICT_UNRESOLVED` | NOT RUN：设计阶段 |
| RV-E-001 | E2E | 将另一 Artifact 的 Revision 设为 parent | 拒绝 `CROSS_ARTIFACT_PARENT`，不形成 lineage | NOT RUN：设计阶段 |
| RV-E-002 | E2E | Renderer 重新生成不同 DOCX，但 Canonical Content 未变 | 生成新 Representation；不得替换 Revision Source of Truth | NOT RUN：设计阶段 |

---

## 31. Evidence

### 31.1 业务语义

`Evidence` 是可重复定位、可验证且有来源快照的证据单元，用于支持或反驳 Artifact 中的具体 Claim、Gate 判断或 Human 决策。

“参考过某文件”“Agent 认为法规要求如此”不构成 Evidence。Evidence 必须说明：来自哪里、哪个版本、具体位置、当时内容、由谁捕获、何时有效以及是否已验证。

### 31.2 类型与 Aggregate Boundary

`Evidence` 是独立 Aggregate Root：

```text
Evidence
├── evidenceId
├── enterpriseId
├── sourceType
├── sourceObjectRef
├── sourceSnapshotRef
├── sourceVersion
├── locator
├── capturedContentRef
├── capturedContentHash
├── authority
├── jurisdiction?
├── validFrom?
├── validTo?
├── accessClassification
├── capturedAt
├── capturedBy
├── verification
└── lifecycleStatus
```

`sourceType`：

```text
REGULATION
STANDARD
CUSTOMER_MATERIAL
SOURCE_MATERIAL
APPROVED_ARTIFACT_REVISION
HUMAN_DECISION
SYSTEM_RECORD
EXTERNAL_AUTHORITY
```

模板、范例和历史优秀文件可以作为写作输入或 Context，但除非其本身能够证明某个事实，否则不能标记为法规或客户事实 Evidence。

### 31.3 EvidenceLink

Evidence 与 Claim 的关系使用不可变的 `EvidenceLink`：

```text
EvidenceLink
├── evidenceLinkId
├── evidenceRef
├── targetType
├── targetRef
├── claimLocator
├── claimHash
├── relation
├── applicabilityScope
├── linkedAt
├── linkedBy
├── status
└── supersedesLinkRef?
```

`relation`：

```text
SUPPORTS
CONTRADICTS
CONTEXT_ONLY
```

EvidenceLink 是独立关联记录，不能把无限引用列表塞进 Evidence Aggregate。目标内容变化导致 claimHash 改变时，旧 Link 保留为历史，新 Revision 必须建立或验证新 Link。

### 31.4 关系

```text
Evidence 1 ── * EvidenceLink
ArtifactRevision 1 ── * Claim
Claim * ── * EvidenceLink
GateResult * ── * Evidence
ReviewIssue * ── * Evidence
Approval * ── * EvidenceSnapshotRef
```

### 31.5 Commands

```text
capture_evidence_candidate
verify_evidence
dispute_evidence
expire_evidence
supersede_evidence
revoke_evidence
create_evidence_link
invalidate_evidence_link
supersede_evidence_link
```

禁止：

```text
edit_captured_evidence_content
change_evidence_source_after_verification
link_evidence_to_latest_revision
mark_template_as_regulatory_evidence_implicitly
```

### 31.6 Lifecycle

```text
CANDIDATE
   ↓
VERIFYING
   ├── VERIFIED
   └── DISPUTED

VERIFIED
   ├── EXPIRED
   ├── SUPERSEDED
   ├── DISPUTED
   └── REVOKED
```

Evidence 的捕获 Payload 不可变；状态变化只表示其当前可依赖程度。需要修改来源或摘录时必须创建新 Evidence，并以 supersedes 关系连接。

### 31.7 Invariants

1. sourceSnapshotRef、locator、capturedContentHash、sourceVersion 和 capturedBy 不可变。
2. VERIFIED Evidence 必须有明确 verifier、verificationMethod、verifiedAt 和结果。
3. Agent 可提出 Evidence Candidate，但不能自行完成需要 Human 专业判断的验证。
4. EvidenceLink 必须绑定精确 targetRef、claimLocator 和 claimHash，禁止引用“最新版本”。
5. SUPPORTS 关系必须说明适用范围，不能用局部证据支持超出范围的结论。
6. CONTRADICTS Evidence 不能被 Gate 静默忽略。
7. CONTEXT_ONLY 不得满足“必须有支持性 Evidence”的 Gate。
8. TemplateBaseline 不是 Regulatory Evidence；示例文本不是客户现状 Evidence。
9. REVOKED/DISPUTED/EXPIRED Evidence 触发相关 Gate、Approval 和 Release 的 Impact Assessment，不修改历史结果。
10. 跨 Enterprise Evidence 复用必须通过允许的公共权威来源或脱敏知识发布流程，不能直接跨租户引用客户资料。
11. 无法稳定定位的来源只能作为 Candidate，不得冒充 VERIFIED。
12. Evidence 内容物理删除必须受法定保留与已发布成果追溯约束。

### 31.8 Domain Events

```text
EvidenceCandidateCaptured
EvidenceVerificationStarted
EvidenceVerified
EvidenceDisputed
EvidenceExpired
EvidenceSuperseded
EvidenceRevoked
EvidenceLinkCreated
EvidenceLinkInvalidated
EvidenceImpactAssessmentRequested
```

### 31.9 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 捕获 Candidate | 可创建 | WorkOrder 授权时可创建 | Evidence Service 校验快照 |
| 验证法规/客户事实 | 指定专业/项目角色 | 不能替代 Human | 可执行确定性来源验证 |
| 建立 Link | 授权作者/Reviewer | 可提出或在授权范围创建 | 校验 Claim 与 Scope |
| Dispute/Revoke | 指定质量/法规角色 | 只能提出风险 | Governance Service |
| 跨企业复用 | 公共知识管理员 | 禁止直接复用客户资料 | Tenant Policy Service |

### 31.10 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| EV-U-001 | Unit | Candidate 缺少来源快照、locator 或 Hash，请求 VERIFIED | 拒绝 `EVIDENCE_SOURCE_INCOMPLETE` | NOT RUN：设计阶段 |
| EV-U-002 | Unit | Claim 内容变化导致 claimHash 更新 | 旧 EvidenceLink 保留历史但不迁移到新 Claim | NOT RUN：设计阶段 |
| EV-U-003 | Unit | 仅有 CONTEXT_ONLY Link，执行支持性 Evidence Gate | Gate 不满足，不得 PASS | NOT RUN：设计阶段 |
| EV-E-001 | E2E | 已批准成果依赖的法规 Evidence 被撤销 | 触发相关 Gate、Approval、Release Impact Assessment，历史不删除 | NOT RUN：设计阶段 |
| EV-E-002 | E2E | Project A 请求引用 Project B 企业私有客户 Evidence | 拒绝 `CROSS_ENTERPRISE_EVIDENCE` | NOT RUN：设计阶段 |

---

## 32. QualityProfile

### 32.1 业务语义

`QualityProfile` 是版本化、可审计的质量验收政策，定义某类 ArtifactRevision 必须执行哪些 Gate、Gate 的依赖顺序、何时可复用结果、哪些 Issue 会阻塞、需要哪些 Human Approval，以及 Release 前置条件。

QualityProfile 属于 Zhiju Core。Prompt、Skill、Harness 或 Agent 不能临时降低验收标准。

### 32.2 类型与 Aggregate Boundary

`QualityProfile` 是 Enterprise 级 Aggregate Root，可由 Project/Artifact 通过受控 Binding 选择精确版本：

```text
QualityProfile
├── qualityProfileId
├── enterpriseId
├── name
├── profileVersion
├── applicableArtifactTypes[]
├── riskApplicability
├── gateSpecs[]
├── gateDependencies[]
├── rerunPolicy
├── issuePolicy
├── separationOfDutiesPolicy
├── approvalRequirements[]
├── releaseRequirements[]
├── status
├── createdBy
├── reviewedBy?
├── activatedBy?
└── activatedAt?
```

Gate 类型第一版：

```text
STRUCTURAL_SCHEMA
BUSINESS_RULE
EVIDENCE_EXISTENCE
EVIDENCE_ENTAILMENT
SEMANTIC_REVIEW
CROSS_ARTIFACT_CONSISTENCY
RENDER_VALIDATION
```

Human Approval 是 `approvalRequirements`，不是伪装成 MANUAL_GATE 的 GateResult。

### 32.3 GateSpec 与依赖图

每个 GateSpec 至少包含：

```text
gateSpecId
gateType
gateVersion
evaluationStage
applicabilityRule
inputContract
evaluatorPolicy
passCriteria
failureSeverity
blockingRule
dependencyGateSpecIds[]
rerunRule
resultRetentionRule
```

`evaluationStage`：

```text
REVISION_ACCEPTANCE
RELEASE_READINESS
```

`REVISION_ACCEPTANCE` Gate 针对 Canonical Revision，决定 Revision 是否可以进入 Human Approval。`RELEASE_READINESS` Gate 针对已冻结或待冻结的 Representation/Package，决定具体 Release 是否可以 Authorize。两类 Gate 不能用同一个模糊的“全部通过”状态合并。

依赖图是 DAG。例如：

```text
REVISION_ACCEPTANCE:
STRUCTURAL_SCHEMA
      ↓
BUSINESS_RULE
      ↓
EVIDENCE_EXISTENCE
      ↓
EVIDENCE_ENTAILMENT
      ↓
SEMANTIC_REVIEW

RELEASE_READINESS:
RENDER_VALIDATION
```

RENDER_VALIDATION 可以依赖 Revision Acceptance 已满足，但其输入还必须包含精确 Representation checksum、rendererVersion 和必要的 packageHash。实际顺序由 Profile 定义，不硬编码在 Runtime。Profile 必须明确 ERROR/SKIPPED/NOT_APPLICABLE 对下游 Gate 的影响。

### 32.4 Commands

```text
create_quality_profile_draft
add_gate_spec
update_gate_spec
define_gate_dependency
define_rerun_policy
define_issue_policy
define_separation_of_duties
add_approval_requirement
add_release_requirement
submit_quality_profile_for_review
activate_quality_profile
retire_quality_profile
supersede_quality_profile
bind_quality_profile_version
```

禁止：

```text
edit_active_quality_profile
agent_activate_quality_profile
skip_mandatory_gate_from_prompt
replace_human_approval_with_agent_gate
```

### 32.5 Lifecycle

```text
DRAFT
  ↓
UNDER_REVIEW
  ├── DRAFT
  └── ACTIVE

ACTIVE
  ├── SUPERSEDED
  └── RETIRED
```

ACTIVE 版本不可编辑。变更必须创建新 profileVersion。旧 Revision 的历史 Gate/Approval 仍引用当时的精确版本。

### 32.6 Invariants

1. ACTIVE Profile 的 GateSpec、依赖、Policy 和 Requirement 不可修改。
2. Gate 依赖必须无环，且所有依赖引用同一 Profile Version 内的 GateSpec。
3. 必须明确每个 Gate 的输入、Evaluator 版本和判定标准。
4. Profile 必须明确强制 Gate；Prompt/Agent/Runtime 不能跳过。
5. 高风险 Artifact 必须配置符合 Risk Policy 的 Human Approval Requirement。
6. Agent Reviewer 不得被配置为 Human Approver。
7. 同一 Principal 是否可“作者兼 Reviewer/Approver”必须由 separationOfDutiesPolicy 明确，禁止默认为允许。
8. RerunPolicy 必须明确 FULL、INCREMENTAL 和 REUSE 的条件；未定义时默认 FULL。
9. GateResult 复用必须产生新结果引用，不得复制或改写旧结果。
10. NOT_APPLICABLE 必须由 applicabilityRule 得出；Agent 自报不适用无效。
11. ApprovalRequirement 必须定义角色、数量、顺序/并行规则和授权强度。
12. ReleaseRequirement 必须定义用途、表示格式、收件范围、有效时间和回执要求。
13. Project/Artifact Binding 必须引用 ACTIVE 的精确 profileVersion。
14. 新 Profile Version 不自动让历史 Approval 失效；由明确的变更影响 Policy 决定。
15. Profile 不能允许 FAIL 的 Mandatory Gate 仅凭普通 Human Approval 被忽略；例外必须走独立 PolicyException 流程。
16. GateSpec 必须明确 evaluationStage；Approval Readiness 只计算适用的 REVISION_ACCEPTANCE Gate，Release Readiness 还必须计算适用的 RELEASE_READINESS Gate。

### 32.7 Domain Events

```text
QualityProfileDraftCreated
GateSpecAdded
GateDependencyDefined
QualityProfileSubmittedForReview
QualityProfileActivated
QualityProfileRetired
QualityProfileSuperseded
QualityProfileVersionBound
QualityEvaluationRequested
```

### 32.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建/编辑 Draft | 质量架构授权角色 | 只能提出建议 | Profile Service 校验结构 |
| 提交 Review | Profile owner | 禁止 | Workflow Service |
| Activate | 指定质量治理角色 | 禁止 | 校验依赖与 Policy 完整性 |
| 绑定精确版本 | 项目/质量授权角色 | 只能提出 | Applicability Service |
| 执行 Gate | 可作为明确 Human Evaluator | 可按 GateSpec 执行语义 Review | Gate Orchestrator |
| 修改 Active | 禁止 | 禁止 | 禁止；创建新版本 |

### 32.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| QP-U-001 | Unit | 修改 ACTIVE Profile 的 GateSpec | 拒绝 `QUALITY_PROFILE_IMMUTABLE`，要求新版本 | NOT RUN：设计阶段 |
| QP-U-002 | Unit | Gate dependency A → B → A | 不能 Activate，返回 `QUALITY_PROFILE_DEPENDENCY_CYCLE` | NOT RUN：设计阶段 |
| QP-U-003 | Unit | 高风险 Profile 无 Human Approval Requirement | 不能 Activate | NOT RUN：设计阶段 |
| QP-E-001 | E2E | Agent Prompt 请求跳过 Mandatory Evidence Gate | Core 仍按 Profile 创建 Gate Plan 并拒绝跳过 | NOT RUN：设计阶段 |
| QP-E-002 | E2E | 新 Revision 产生且 Profile 未定义复用策略 | 创建 FULL Evaluation Plan，不沿用旧结果 | NOT RUN：设计阶段 |

---

## 33. GateResult

### 33.1 业务语义

`GateResult` 是某个 GateSpec 对一个精确 GateTarget、QualityProfile Version 和输入快照执行一次质量评估后形成的不可变结果。GateTarget 至少绑定 ArtifactRevision；Release 阶段的 Gate 还必须绑定精确 Representation 或 Release Package。

它证明“谁/哪个服务，以哪个版本的规则，在什么输入上，得到什么结论”。它不表示整个 Revision 已获批准，更不能被后续执行原地覆盖。

### 33.2 类型与 Aggregate Boundary

`GateResult` 是独立 Aggregate Root：

```text
GateResult
├── gateResultId
├── enterpriseId
├── artifactRef
├── revisionRef
├── revisionContentHash
├── evaluationStage
├── gateTarget
├── qualityProfileRef
├── profileVersion
├── gateSpecId
├── gateVersion
├── evaluationAttempt
├── executionMode
├── evaluatedScope
├── inputSnapshotRef
├── evaluator
├── outcome
├── findings[]
├── evidenceRefs[]
├── reviewIssueRefs[]
├── reuseSourceGateResultRef?
├── changeImpactRef?
├── startedAt
├── completedAt
├── payloadHash
└── validityStatus
```

`gateTarget`：

```text
REVISION
  revisionRef + revisionContentHash

REPRESENTATION
  revisionRef + representationRef + checksum + rendererVersion

RELEASE_PACKAGE
  releaseRef + packageHash
```

所有 GateResult 都保留 revisionRef；REPRESENTATION/RELEASE_PACKAGE Target 额外证明具体输出文件或冻结 Package，而不能只证明 Canonical Revision。

`outcome`：

```text
PASS
FAIL
ERROR
SKIPPED
NOT_APPLICABLE
```

`NOT_RUN` 不是结果；没有符合要求的 GateResult 才表示未执行。

`executionMode`：

```text
EXECUTED
REUSED_BY_IMPACT_ANALYSIS
```

`evaluatedScope`：

```text
FULL
INCREMENTAL(changedUnits, coveredUnits)
```

### 33.3 结果复用语义

复用旧结果时必须新建 GateResult：

```text
new GateResult
├── executionMode = REUSED_BY_IMPACT_ANALYSIS
├── reuseSourceGateResultRef = old result
├── changeImpactRef = exact impact analysis
├── revisionRef = new revision
└── outcome = derived outcome
```

禁止把旧 Result 的 revisionRef 改成新 Revision，也禁止仅在 Projection 中显示为“已通过”。无法证明未受影响时必须重新执行。

### 33.4 Commands

```text
request_gate_evaluation
record_executed_gate_result
record_reused_gate_result
validate_gate_result
accept_gate_result
reject_gate_result_payload
invalidate_gate_result
supersede_gate_result
```

禁止：

```text
edit_gate_outcome
turn_fail_into_pass
copy_gate_result_to_new_revision
agent_mark_gate_not_applicable
```

### 33.5 Lifecycle

接收生命周期：

```text
RECEIVED
   ↓
VALIDATING
   ├── VALID
   └── REJECTED
```

有效性生命周期：

```text
VALID
  ├── INVALIDATED
  └── SUPERSEDED
```

Outcome 永不修改。重跑产生新 GateResult，旧结果可被标记为 SUPERSEDED 但继续保留。

### 33.6 Invariants

1. Result 必须绑定精确 gateTarget、revisionId、contentHash、profileVersion、gateSpecId、gateVersion 和 evaluationStage。
2. inputSnapshotRef 必须覆盖 Gate 判定实际使用的全部输入和工具版本。
3. PASS/FAIL/ERROR 等 outcome 创建后不可修改。
4. FAIL 不能通过 Human 编辑转成 PASS；修订或重跑必须创建新 Result。
5. SKIPPED 必须有 Profile 允许的原因；Mandatory Gate 不得任意 SKIPPED。
6. NOT_APPLICABLE 必须由 GateSpec applicabilityRule 确定性或授权评估得出。
7. ERROR 不等于 FAIL，也不等于 PASS；是否阻塞由 Profile 定义，默认阻塞。
8. REUSED_BY_IMPACT_ANALYSIS 必须引用旧 Result、ChangeImpact 和 Profile 允许的 RerunPolicy。
9. 复用时旧 Result 必须仍为 VALID，Evaluator/Gate/Input 版本未发生会影响结论的变化。
10. INCREMENTAL 必须记录 changedUnits 与 coveredUnits；无法证明覆盖时拒绝接受。
11. 下游 Gate 只能在依赖 Gate 满足 Profile 条件时运行。
12. Finding 不自动成为 ReviewIssue；需要按 Profile 创建正式 Issue。
13. Agent 语义 Review 的 Result 必须标明 AgentProfile、模型、Skill、Context 和 Runtime 版本。
14. GateResult 不得声称 Human Approval。
15. 跨 Enterprise 的 Result 不可复用。
16. RENDER_VALIDATION Result 必须绑定精确 Representation checksum 与 rendererVersion；Profile 要求时还必须绑定 packageHash。
17. REVISION_ACCEPTANCE Result 不能冒充 RELEASE_READINESS Result，反之亦然。

### 33.7 Domain Events

```text
GateEvaluationRequested
GateEvaluationStarted
GateResultReceived
GateResultValidated
GateResultRejected
GateResultRecorded
GateResultReused
GateResultInvalidated
GateResultSuperseded
GateFindingRecorded
BlockingGateFailed
```

### 33.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 请求评估 | 授权作者/Reviewer | WorkOrder 范围内可请求 | Gate Orchestrator |
| 执行确定性 Gate | 不手工伪造 | 不替代 Validator | 指定 Evaluator Service |
| 执行语义 Review | Profile 指定时可执行 | Profile 授权的 Reviewer Agent | 记录完整 Provenance |
| 接受 Result Payload | 不按喜好改结论 | 禁止 | Result Validator |
| Invalidate | 授权质量角色提出/确认 | 只能报告异常 | Governance Service |
| 复用结果 | 不直接复制 | 禁止自行声明 | Impact Analysis Service |

### 33.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| GR-U-001 | Unit | 对 outcome=FAIL 的 Result 请求改为 PASS | 拒绝 `GATE_RESULT_IMMUTABLE` | NOT RUN：设计阶段 |
| GR-U-002 | Unit | Result 的 revisionId 正确但 contentHash 错误 | 拒绝 `GATE_INPUT_MISMATCH` | NOT RUN：设计阶段 |
| GR-U-003 | Unit | Mandatory Gate 无合法理由返回 SKIPPED | Result 无效，对应 evaluationStage 的 Readiness 被阻止 | NOT RUN：设计阶段 |
| GR-E-001 | E2E | 新 Revision 请求复用旧 PASS，但无 ChangeImpact | 拒绝 `GATE_REUSE_NOT_ALLOWED` 并安排重跑 | NOT RUN：设计阶段 |
| GR-E-002 | E2E | Incremental Result 未覆盖一个 changed unit | 拒绝 `INCREMENTAL_COVERAGE_INSUFFICIENT` | NOT RUN：设计阶段 |

---

## 34. ReviewIssue

### 34.1 业务语义

`ReviewIssue` 是对 ArtifactRevision 中一个可定位质量问题的长期跟踪对象。它从发现问题开始，跨越修订、整改、独立验证和关闭，不随某个 GateResult 或 Revision 消失。

新建 Revision 不等于问题已解决；作者声称“已修改”也不等于已经验证。

### 34.2 类型与 Aggregate Boundary

`ReviewIssue` 是独立 Aggregate Root：

```text
ReviewIssue
├── reviewIssueId
├── enterpriseId
├── artifactRef
├── originRevisionRef
├── originGateResultRef?
├── issueType
├── severity
├── blockingClassification
├── statement
├── locator
├── evidenceRefs[]
├── raisedBy
├── raisedAt
├── ownerRef?
├── resolutionProposals[]
├── verificationRecords[]
├── dispositionReason?
└── status
```

`severity`：

```text
CRITICAL
MAJOR
MINOR
INFO
```

是否阻塞不是仅由严重度猜测，而由 QualityProfile 的 issuePolicy 基于类型、严重度、风险和 Artifact 用途决定。

### 34.3 Resolution 与 Verification

```text
ResolutionProposal
├── targetRevisionRef
├── changedClaimRefs[]
├── explanation
├── proposedBy
└── proposedAt

VerificationRecord
├── targetRevisionRef
├── verifier
├── verificationMethod
├── supportingGateResultRefs[]
├── outcome
└── verifiedAt
```

Issue 原始 statement、origin Revision 和 locator 不可修改。发现描述错误时创建 superseding Issue 或授权 Dismissal，不改写历史。

### 34.4 Commands

```text
raise_review_issue
acknowledge_review_issue
assign_review_issue
propose_issue_resolution
request_issue_verification
verify_issue_resolution
reject_issue_resolution
close_verified_issue
dismiss_review_issue
mark_duplicate_issue
reopen_review_issue
supersede_review_issue
```

禁止：

```text
edit_issue_statement_after_creation
close_issue_on_new_revision_creation
author_verify_own_fix_when_separation_required
agent_dismiss_blocking_issue
```

### 34.5 Lifecycle

```text
OPEN
  ↓
ACKNOWLEDGED
  ↓
RESOLUTION_PROPOSED
  ↓
VERIFICATION_PENDING
  ├── VERIFIED
  │      ↓
  │    CLOSED
  └── ACKNOWLEDGED  （验证失败）

OPEN / ACKNOWLEDGED
  ├── DISMISSED
  ├── DUPLICATE
  └── SUPERSEDED

CLOSED / DISMISSED
  └── REOPENED → ACKNOWLEDGED
```

### 34.6 Invariants

1. Issue 必须绑定精确 originRevisionRef 和稳定 locator。
2. 原始 statement、severity、evidence snapshot 和 raisedBy 不可编辑；纠正采用 superseding 记录。
3. 新 Revision 不自动改变 Issue 状态。
4. ResolutionProposal 必须引用同 Artifact 的新 Revision 或明确无内容变更的治理处理。
5. 作者提出修复不等于 VERIFIED。
6. separationOfDutiesPolicy 要求独立验证时，修订者不得验证自己的修复。
7. Blocking Issue 在 VERIFIED/CLOSED 或授权 DISMISSED 前阻止 Approval。
8. Dismissal 必须记录授权 Human、理由、适用 Policy 和 Evidence；Approval 本身不能充当 Dismissal。
9. DUPLICATE 必须引用主 Issue。
10. Verification 失败必须保留历史并回到待整改状态，不能删除失败记录。
11. GateResult 失效或 Evidence 撤销可触发已关闭 Issue 重开评估。
12. Agent 可 Raise Issue，但不能关闭、Dismiss 或完成 Human-only Verification。
13. Issue 跨 Revision 跟踪必须保持每次修复与验证的精确引用。

### 34.7 Domain Events

```text
ReviewIssueRaised
ReviewIssueAcknowledged
ReviewIssueAssigned
IssueResolutionProposed
IssueVerificationRequested
IssueResolutionVerified
IssueResolutionRejected
ReviewIssueClosed
ReviewIssueDismissed
ReviewIssueMarkedDuplicate
ReviewIssueReopened
ReviewIssueSuperseded
```

### 34.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| Raise | 作者/Reviewer 可创建 | Gate/Review 授权时可创建 | Finding Processor |
| 提出整改 | 授权作者 | WorkOrder 授权时可提出 | 校验 Revision 引用 |
| Verify | Profile 指定 Reviewer | 仅非 Human-only 且满足职责分离 | Verification Service |
| Close | 授权 Reviewer/质量角色 | 禁止 | 校验 VERIFIED 与 Policy |
| Dismiss | 指定质量角色 | 禁止 | Governance Service |
| Reopen | 授权 Reviewer | 可提出新 Evidence | Impact Service 可触发评估 |

### 34.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| RI-U-001 | Unit | Blocking Issue OPEN 时创建新 Revision | Issue 仍未解决，等待 ResolutionProposal/Verification | NOT RUN：设计阶段 |
| RI-U-002 | Unit | 修订作者在职责分离要求下验证自己的修复 | 拒绝 `SEPARATION_OF_DUTIES_VIOLATION` | NOT RUN：设计阶段 |
| RI-U-003 | Unit | 未 VERIFIED 的 Issue 请求 CLOSED | 拒绝 `ISSUE_VERIFICATION_REQUIRED` | NOT RUN：设计阶段 |
| RI-E-001 | E2E | Revision Gate PASS，但仍有 Blocking Issue | Revision 不能 fully approved | NOT RUN：设计阶段 |
| RI-E-002 | E2E | 已关闭 Issue 的支持 Evidence 被撤销 | 触发 Issue Reopen Assessment，保留原验证历史 | NOT RUN：设计阶段 |

---

## 35. Approval

### 35.1 业务语义

`Approval` 是一个具备授权角色的 Human 对精确 ArtifactRevision 作出的不可变正式决定。它绑定 Revision Hash、QualityProfile、Gate Bundle、Issue Snapshot、审批要求槽位和当时授权上下文。

Approval 不是聊天中的“可以”“没问题”，也不是 Agent 的 Review 结论。它表示业务接受，但不自动执行 Release 或改变企业有效版本。

### 35.2 类型与 Aggregate Boundary

`Approval` 是独立 Aggregate Root：

```text
Approval
├── approvalId
├── enterpriseId
├── artifactRef
├── revisionRef
├── revisionContentHash
├── qualityProfileRef
├── profileVersion
├── approvalRequirementId
├── gateBundleSnapshotRef
├── issueSnapshotRef
├── evidenceSnapshotRefs[]
├── decision
├── decisionComment
├── approverHumanPrincipalRef
├── approverRoleSnapshot
├── authorizationAssurance
├── separationCheckRef
├── decidedAt
├── payloadHash
└── validityStatus
```

`decision`：

```text
APPROVED
CHANGES_REQUESTED
REJECTED
```

v0.1 不采用含糊的“有条件批准”。条件尚未满足时使用 CHANGES_REQUESTED，并在新 Revision/Gate 完成后形成新的 Approval。

### 35.3 多人审批

QualityProfile 用 `approvalRequirementId` 定义一个或多个审批槽位：

```text
QUALITY_OWNER_APPROVAL
REGULATORY_APPROVAL
PROJECT_OWNER_APPROVAL
CUSTOMER_CONFIRMATION
```

每个 Approval 只满足一个精确 Requirement。整个批准状态由 Approval Evaluator 根据数量、顺序、角色、职责分离和有效性计算，不能写一个可随意切换的 `artifact.approved=true`。

### 35.4 Commands

```text
request_approval
submit_approval_decision
validate_approval_decision
accept_approval
reject_invalid_approval
revoke_approval
supersede_approval
evaluate_revision_approval_status
```

禁止：

```text
agent_approve_revision
approve_latest_revision
edit_approval_decision
approve_without_required_gate_bundle
use_approval_as_policy_exception
```

### 35.5 Lifecycle

```text
RECEIVED
   ↓
VALIDATING
   ├── EFFECTIVE
   └── INVALID

EFFECTIVE
   ├── REVOKED
   └── SUPERSEDED
```

Decision Payload 永不修改。Human 改变决定时创建新 Approval；旧记录转为 SUPERSEDED 或仍作为历史有效期记录。

### 35.6 Invariants

1. Approval 必须由 HumanPrincipal 作出；AgentPrincipal 即使 actingFor Human 也不得批准。
2. 必须绑定精确 revisionId 和 contentHash，禁止批准“最新版本”或 Branch。
3. Approver 必须在 decidedAt 具备 Requirement 所需角色与授权范围。
4. GateBundleSnapshot 必须包含所有适用于 Approval 的 Mandatory REVISION_ACCEPTANCE Gate 有效结果，且符合 Profile。
5. 未关闭 Blocking Issue 必须阻止 APPROVED Decision 生效。
6. Human Approval 不能把 Mandatory REVISION_ACCEPTANCE Gate FAIL/ERROR 变成通过；它也不能替代后续 RELEASE_READINESS Gate。
7. Policy 例外必须是独立 `PolicyException` 记录且 Profile 明确允许；Approval 本身不是豁免。
8. separationCheck 必须证明作者、Reviewer、Approver 关系符合 Profile。
9. decision、comment、principal、role snapshot、timestamp 和 PayloadHash 不可修改。
10. 新 Revision 不继承旧 Approval。
11. 新 QualityProfile Version 是否要求重批由 Impact Policy 判断，不得静默迁移。
12. Approval 被撤销不删除既有 Release 外部事实，但必须触发 Release Impact/Recall Assessment。
13. 飞书按钮可作为提交 Approval 的 Channel UI，但必须完成身份、角色、Revision Hash 和防重放验证。
14. 普通飞书文字回复不得被模糊解析成正式 APPROVED。
15. 多审批 Requirement 未全部满足时，Revision 不能投影为 fully approved。

### 35.7 Domain Events

```text
ApprovalRequested
ApprovalDecisionReceived
ApprovalValidated
ApprovalRejectedAsInvalid
ApprovalBecameEffective
ApprovalRevoked
ApprovalSuperseded
RevisionApprovalStatusEvaluated
RevisionFullyApproved
RevisionApprovalLost
```

### 35.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 请求 Approval | 授权作者/Reviewer | 可提出，不可决定 | Approval Workflow Service |
| 作出决定 | 符合 Requirement 的 Human | 永久禁止 | 身份与授权校验 |
| 校验 Gate/Issue Bundle | 不手工绕过 | 禁止 | Approval Validator |
| Revoke | 原 Approver或治理授权 Human | 禁止 | 保留影响链 |
| 计算 fully approved | 不直接改布尔值 | 禁止 | Approval Evaluator |
| 飞书交互 | 身份确认后点击/签署 | 仅发送卡片与摘要 | Channel Adapter + Core Command |

### 35.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| AP-U-001 | Unit | actingFor Approver 的 AgentPrincipal 提交 APPROVED | 拒绝 `AGENT_APPROVAL_FORBIDDEN` | NOT RUN：设计阶段 |
| AP-U-002 | Unit | Approval 引用 latest 或错误 contentHash | 拒绝 `APPROVAL_REVISION_MISMATCH` | NOT RUN：设计阶段 |
| AP-U-003 | Unit | Mandatory REVISION_ACCEPTANCE Gate FAIL 或存在 Blocking Issue | APPROVED Decision 不生效 | NOT RUN：设计阶段 |
| AP-E-001 | E2E | REV-004 已批准后创建 REV-005 | REV-005 无 Approval；REV-004 历史 Approval 不变 | NOT RUN：设计阶段 |
| AP-E-002 | E2E | 飞书群中用户普通回复“可以” | 只保存 Channel Message；不创建正式 Approval | NOT RUN：设计阶段 |

---

## 36. Release

### 36.1 业务语义

`Release` 是将一个已完整批准的精确 ArtifactRevision，以冻结的 Representation Package，按明确用途、收件范围、渠道和生效规则正式发布的受控业务动作。

Approval 回答“是否接受这个版本”；Release 回答“是否把这个已接受版本正式交付/发布到哪里”。Release 成功也不总是等于企业内部生效，是否建立 EffectiveBinding 由 Release Purpose 和 Policy 决定。

### 36.2 类型与 Aggregate Boundary

`Release` 是独立 Aggregate Root：

```text
Release
├── releaseId
├── enterpriseId
├── artifactRef
├── revisionRef
├── revisionContentHash
├── releaseNumber
├── purpose
├── recipientScope
├── destinationRefs[]
├── representationPackage
├── qualitySnapshotRef
├── approvalBundleSnapshotRef
├── requestedEffectiveAt?
├── authorizedByHumanPrincipalRef?
├── authorizedAt?
├── publicationAttempts[]
├── releaseReceipts[]
├── supersedesReleaseRef?
├── recallRecord?
└── status
```

`purpose`：

```text
CUSTOMER_DELIVERY
REGULATORY_SUBMISSION
INTERNAL_EFFECTIVE_USE
FEISHU_PUBLICATION
CONTROLLED_EXPORT
```

`representationPackage`：

```text
canonicalRevisionRef
representations[]
  ├── format
  ├── objectRef
  ├── checksum
  ├── rendererVersion
  └── renderValidationGateResultRef
packageHash
```

### 36.3 PublicationAttempt 与回执

每个外部副作用使用 Release 内的 `PublicationAttempt` Entity：

```text
PublicationAttempt
├── attemptId
├── destinationRef
├── idempotencyKey
├── packageHash
├── startedAt
├── completedAt?
├── outcome
├── externalReceiptRef?
└── error?
```

同一冻结 Package 可以安全重试，但每次尝试都要保留。不能在重试时替换文件或收件人；若 Package/Recipient 变化，创建新 Release。

### 36.4 Commands

```text
create_release_draft
select_release_representations
set_release_destinations
prepare_release
validate_release_readiness
authorize_release
start_publication_attempt
record_publication_receipt
record_publication_failure
complete_release
supersede_release
recall_release
cancel_release
```

禁止：

```text
release_unapproved_revision
agent_authorize_release
replace_package_after_authorization
mark_released_without_receipt
treat_feishu_file_send_as_release
delete_recalled_release_history
```

### 36.5 Lifecycle

```text
DRAFT
  ↓
PREPARED  （Package/Recipient/Destination 冻结）
  ↓
VALIDATING
  ├── FAILED
  └── AUTHORIZED
          ↓
      PUBLISHING
        ├── RELEASED
        ├── PARTIALLY_RELEASED
        └── FAILED

DRAFT → CANCELLED
RELEASED / PARTIALLY_RELEASED → RECALLED
RELEASED → SUPERSEDED
```

FAILED 后如果仅是相同冻结 Package 的瞬时渠道故障，可以新建 PublicationAttempt；若 Package、收件人或 Revision 改变，必须新建 Release。

### 36.6 Invariants

1. Release 必须绑定精确 revisionId、contentHash、QualityProfile Snapshot 和完整有效 Approval Bundle。
2. Revision 必须在授权时 fully approved，适用的 REVISION_ACCEPTANCE 与 RELEASE_READINESS Gate 均有效，且没有重新打开的 Blocking Issue。
3. DRAFT 可编辑；进入 PREPARED 后 Package、Recipient、Destination 和 Revision 冻结。
4. Release Authorization 必须由符合 ReleaseRequirement 的 HumanPrincipal 作出；Agent 不得授权。
5. Publishing Service 只能执行已 AUTHORIZED 的冻结 Release。
6. Representation checksum 和 packageHash 必须在发布前确定；回执必须对应相同 Hash。
7. 需要 Render Validation 的格式没有绑定精确 Representation checksum、rendererVersion 以及 Profile 所需 packageHash 的 RELEASE_READINESS PASS GateResult 时不得发布。
8. 对外成功必须有可验证回执；无回执不能直接标记 RELEASED。
9. 多 Destination 部分成功时必须标记 PARTIALLY_RELEASED，并逐一保存结果；不能假装整体成功。
10. 幂等重试必须使用相同 releaseId、destination、packageHash 和稳定 idempotencyKey。
11. 普通飞书文件上传/消息发送不是 Release；只有由授权 Release 触发并返回回执的发布才是正式动作。
12. 新 Draft、新 Revision 或新 Approval 不改变既有 Release 和 EffectiveBinding。
13. INTERNAL_EFFECTIVE_USE 成功后是否建立 EffectiveBinding 必须满足生效日期和 Policy，不由上传动作决定。
14. 同 purpose 新 Release 生效时必须显式 supersede 旧 EffectiveBinding。
15. Recall 不能撤销已经发生的外部事实；必须保留回执、原因、范围和通知尝试。
16. Approval/Gate/Evidence 后续失效必须触发 Impact Assessment，不得静默删除 Release。
17. 客户交付与法规提交可使用不同 Release，即使 Revision 相同。
18. ReleaseNumber 在指定编号范围内唯一，不能替代 releaseId。

### 36.7 Domain Events

```text
ReleaseDraftCreated
ReleasePrepared
ReleaseValidationStarted
ReleaseValidationFailed
ReleaseAuthorized
PublicationAttemptStarted
PublicationSucceeded
PublicationFailed
ReleasePartiallyCompleted
ReleaseCompleted
ReleaseSuperseded
ReleaseRecallRequested
ReleaseRecalled
RecallNotificationAttempted
ReleaseCancelled
```

### 36.8 权限

| 动作 | Human | Agent | Service |
|---|---|---|---|
| 创建/准备 Draft | 授权交付角色 | WorkOrder 授权时可准备 | Release Service 校验 Package |
| Authorize | ReleaseRequirement 指定 Human | 永久禁止 | Authorization Validator |
| 执行发布 | 不手工伪造回执 | 禁止直接调用外部渠道 | Publishing Service |
| 飞书发布 | Human 授权 Release | Agent 可展示/通知，不可越权发布 | Feishu Channel Adapter |
| 建立 EffectiveBinding | 不直接改 Artifact 指针 | 禁止 | ReleaseCompleted 后由 Artifact 模块的 Effective Policy Command 处理 |
| Recall | 指定治理 Human | 只能提出风险 | Recall Service 与 Channel Adapter |

### 36.9 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| RL-U-001 | Unit | Revision 未 fully approved，请求 AUTHORIZED | 拒绝 `RELEASE_NOT_READY` | NOT RUN：设计阶段 |
| RL-U-002 | Unit | PREPARED 后替换 Representation 或 Recipient | 拒绝 `RELEASE_PACKAGE_FROZEN` | NOT RUN：设计阶段 |
| RL-U-003 | Unit | 飞书普通文件发送成功 | 不创建 Release、Receipt 或 EffectiveBinding | NOT RUN：设计阶段 |
| RL-E-001 | E2E | 三个 Destination 中两个成功、一个失败 | 保存逐项回执，状态为 PARTIALLY_RELEASED | NOT RUN：设计阶段 |
| RL-E-002 | E2E | REV-004 已发布生效后创建 REV-005 Draft | 旧 Release 和 EffectiveBinding 保持不变 | NOT RUN：设计阶段 |

---

## 37. Artifact / Quality 责任边界矩阵

| 对象 | 核心问题 | 内容是否可变 | Agent 能否最终决定 | Human 最终责任 |
|---|---|---|---|---|
| Artifact | 长期成果身份是什么 | 仅受控元数据可变 | 否 | 范围、归属、治理 |
| ArtifactRevision | 精确内容版本是什么 | SEALED 后不可变 | 可授权创建，不可自批 | 作者责任与内容接受 |
| Evidence | 结论依据是什么 | 捕获内容不可变 | 可提出，专业验证受限 | 权威性与适用性确认 |
| QualityProfile | 验收政策是什么 | ACTIVE 后不可变 | 只能建议 | 质量治理与激活 |
| GateResult | 某项检查结果是什么 | 不可变 | 可执行授权语义 Gate | 不替代 Approval |
| ReviewIssue | 问题如何整改和验证 | 原始问题不可变 | 可 Raise/提案 | Dismiss/关闭/独立验证 |
| Approval | Human 是否接受精确版本 | 不可变 | 永久不能批准 | 授权决定 |
| Release | 批准版本是否正式发布 | PREPARED 后冻结 | 可准备，不可授权 | 发布授权、召回责任 |

---

## 38. 正式成果验收链

```text
ArtifactRevision SEALED
        ↓
解析精确 QualityProfile Version
        ↓
生成 Gate Evaluation Plan
        ↓
执行/合法复用 REVISION_ACCEPTANCE GateResult
        ↓
FAIL/Finding → ReviewIssue
        ↓
新 Revision → 修复验证 → Issue CLOSED
        ↓
Mandatory REVISION_ACCEPTANCE Gates 全部满足 + 无 Blocking Issue
        ↓
Human Approval Requirements 全部满足
        ↓
Revision fully approved
        ↓
准备并冻结 Release Package
        ↓
执行 RELEASE_READINESS Gate（如 Render Validation）
        ↓
Human Release Authorization
        ↓
Publishing Service 外部发布并记录 Receipt
        ↓
Release 完成
        ↓ Policy 要求时
EffectiveBinding 建立/切换
```

关键 Completion 语义继续分层：

```text
GateResult PASS
≠ ReviewIssue CLOSED
≠ Revision fully approved
≠ Release RELEASED
≠ Artifact purpose 下 EFFECTIVE
≠ DeliveryItem COMPLETED
```

DeliveryItem 的完成标准引用这些业务事实，而不重复保存一套状态。例如：

```text
内部草案交付：Revision SEALED + 指定 Gate PASS
正式客户交付：Revision fully approved + CUSTOMER_DELIVERY Release RELEASED
企业制度生效：INTERNAL_EFFECTIVE_USE Release RELEASED + EffectiveBinding active
```

---

## 39. Incremental Gate Safety

### 39.1 ChangeImpact

任何增量检查或结果复用必须先形成不可变 `ChangeImpact`：

```text
ChangeImpact
├── baseRevisionRef
├── targetRevisionRef
├── changedUnits[]
├── unchangedUnits[]
├── affectedClaimRefs[]
├── affectedEvidenceLinkRefs[]
├── affectedGateSpecIds[]
├── toolchainChanges[]
├── profileChanges[]
├── analysisMethod
├── analyzedBy
├── analyzedAt
└── payloadHash
```

### 39.2 允许复用的必要条件

只有同时满足以下条件，Gate Orchestrator 才能记录 REUSED GateResult：

1. QualityProfile 的 RerunPolicy 明确允许该 Gate 复用；
2. base Result 仍然 VALID；
3. GateSpec、Evaluator、输入契约和相关外部权威版本未发生影响性变化；
4. ChangeImpact 证明 Gate 覆盖单元和其依赖均未变化；
5. 关联 Evidence 未 Disputed/Expired/Revoked；
6. 没有跨 Artifact 依赖变化；
7. 新 Result 明确引用 base Result 与 ChangeImpact；
8. 无法证明时默认重新执行。

禁止：

```text
把旧 PASS 复制到新 Revision
只看文件名或章节编号判断未变化
忽略 Template/Regulation/Renderer 版本变化
由 Agent 自行声称“无需重跑”
```

---

## 40. 失效与影响传播

历史对象不可改写，因此上游失效通过事件和新评估向下传播：

| 触发 | 不允许的做法 | 必须触发 |
|---|---|---|
| Evidence Revoked/Disputed | 删除旧 GateResult | Evidence Impact Assessment、相关 Gate 重评估 |
| GateResult Invalidated | 把旧 PASS 改 FAIL | Revision Approval Status 重算、相关 Issue Review |
| ReviewIssue Reopened | 修改历史 Approval | Approval Validity/Release Impact Assessment |
| Approval Revoked | 删除 Release | Release Impact 与 Recall Assessment |
| Release Recalled | 删除回执或 Effective 历史 | EffectiveBinding 切换/终止、通知与纠正行动 |
| QualityProfile Superseded | 所有旧 Approval 自动失效 | 按 Profile Change Policy 做范围化 Impact Analysis |

核心规则：

```text
历史事实永久保留
当前有效性通过新对象、新状态和 Projection 表达
```

---

## 41. Domain Error Taxonomy 补充

```text
ARTIFACT_SCOPE_INVALID
ARTIFACT_NOT_ACTIVE
OVERLAPPING_EFFECTIVE_BINDING
REVISION_IMMUTABLE
REVISION_HASH_MISMATCH
REVISION_LINEAGE_INVALID
MERGE_CONFLICT_UNRESOLVED
CROSS_ARTIFACT_PARENT
EVIDENCE_SOURCE_INCOMPLETE
EVIDENCE_LINK_STALE
EVIDENCE_NOT_VERIFIED
CROSS_ENTERPRISE_EVIDENCE
QUALITY_PROFILE_IMMUTABLE
QUALITY_PROFILE_DEPENDENCY_CYCLE
MANDATORY_GATE_MISSING
GATE_RESULT_IMMUTABLE
GATE_INPUT_MISMATCH
GATE_REUSE_NOT_ALLOWED
INCREMENTAL_COVERAGE_INSUFFICIENT
BLOCKING_REVIEW_ISSUE_EXISTS
ISSUE_VERIFICATION_REQUIRED
SEPARATION_OF_DUTIES_VIOLATION
AGENT_APPROVAL_FORBIDDEN
APPROVER_UNAUTHORIZED
APPROVAL_REVISION_MISMATCH
APPROVAL_REQUIREMENT_NOT_MET
RELEASE_NOT_READY
RELEASE_PACKAGE_FROZEN
RELEASE_AUTHORIZATION_REQUIRED
RELEASE_RECEIPT_MISSING
RELEASE_PARTIAL_FAILURE
RELEASE_RECALL_REQUIRED
```

---

## 42. 本阶段设计取舍

### 42.1 采用的决定

- Artifact 是长期业务身份，ArtifactRevision 是不可变精确版本；
- Revision 使用显式 Branch 与 Merge Lineage，不采用 last-write-wins；
- Canonical Content 是 Source of Truth，DOCX/PDF/XLSX 是 Representation；
- Evidence 使用不可变来源快照和精确 Claim Link；
- Template/范例不自动构成法规或客户事实 Evidence；
- QualityProfile 是 Core 内版本化政策，Active 版本不可修改；
- GateResult、ReviewIssue、Approval 均独立于 Revision；
- GateResult FAIL 不可改写，重跑产生新 Result；
- Result 复用必须新建 Result 并绑定 ChangeImpact；
- Agent 可以参与起草、证据候选、语义 Review 和问题发现，但不能 Human Approval 或 Release Authorization；
- Approval 绑定精确 Revision Hash，不批准“最新版本”；
- Approval 与 Release 分离，Release 与 EffectiveBinding 分离；
- 飞书正式发布必须由 Core Release 驱动并记录回执；普通文件发送不是 Release；
- 上游失效通过 Impact Assessment 传播，不篡改历史事实。

### 42.2 暂不设计

- Canonical Document AST 的具体 Schema；
- DOCX/PDF/XLSX Renderer 实现；
- Gate Evaluator 插件接口与调度代码；
- PolicyException Aggregate 的完整模型；
- 电子签名和证书协议细节；
- 法规提交网关的具体 API；
- 飞书卡片 JSON 与事件 Schema；
- 外部 DMS/EDMS 连接器；
- Recall 的跨系统补偿编排实现；
- 数据库表、索引与事务隔离级别。

---

## 43. 基准形成顺序与后续路由

Project、Task / Execution、Artifact / Quality 三个主域按以下顺序完成跨域一致性收敛和逻辑持久化映射：

1. 用一个“采购控制程序”Reference Project 串联全部 Aggregate；
2. 校验 Project、Task、Artifact 三条状态链的 Completion 规则；
3. 冻结跨 Aggregate Command、Domain Event 与幂等边界；
4. 划分 Module Boundary，明确同步事务与异步 Saga；
5. 整理 Architecture Decision Log 与四个 Core Contract；
6. 冻结 MVP 中必须实现和明确延后的能力；
7. 完成上述设计 Gate 后，形成 PostgreSQL Logical Model；
8. 在当前基准之上继续设计 Command/Query/Event API、飞书 Channel 和 Runtime Adapter Contract。

上述 Cross-Aggregate、Core Contract 与 PostgreSQL Logical Model 已分别形成：

```text
05-cross-aggregate-consistency-module-boundary-v0.1.md
03-core-contracts.md
06-typed-references-contract-catalog-v0.1.md
07-postgresql-logical-model-v0.1.md
```

---

## 44. Project Domain 实现前待确认

以下不是对既有原则的反复询问，而是下一阶段实现前需要冻结的业务细节：

1. `CustomerBaseline` 是否由项目经理确认，还是需要质量专业角色共同确认；
2. 哪些 CustomerMaterial 类型可以依据低风险 Policy 自动确认；
3. `RegulatoryProfile` 的正式确认角色和 L1—L4 映射；
4. DeliveryPlan 是否需要项目经理单人批准，还是业务负责人共同批准；
5. 一个 DeliveryItem 默认对应一个 Artifact，是否符合大多数实际项目；
6. 正式交付物的 Completion 是否通常要求 Release，还是批准后即可视为项目完成；
7. 客户通过飞书文字确认“资料不存在”时，什么情况下足以支持 MISSING_CONFIRMED；
8. 飞书消息撤回后，已接收 SourceMaterial 的保存和使用 Policy；
9. TemplateBaseline 变更是否默认要求重跑全部 GapAnalysis，还是允许 Human 先做 Impact Triage；
10. RegulatoryProfile 中高风险 PENDING 项是否一律阻止 DeliveryPlan 批准。

---

## 45. Task / Execution Domain 实现前待确认

1. Task 的业务类型第一版是否只需“分析、起草、修订、Review、确认、发布准备、资料请求”，还是需要可配置类型目录；
2. Task 是否允许由 Coordinator 在低风险 Policy 下自动从 DRAFT 进入 BACKLOG，还是任何新 Task 都需 Human 接受；
3. WorkOrder 的默认有效期、最大重试次数和 Budget Exception 权限；
4. 用户明确指定 Harness 后，Runtime 不可用时是等待、失败，还是允许向用户请求 fallback 授权；
5. WAITING_INPUT 默认采用同 Run Resume 还是新 Run Retry；本文建议依据 Runtime 能力和 Context/Token 是否变化决定；
6. Run 的权威 Usage 从哪些 Provider/Runtime 渠道获取，以及成本币种与内部计价规则；
7. 外部客户是否拥有可映射的 ExternalPartyPrincipal，还是第一版所有客户答案均由制巨员工代录；
8. InformationRequest 的哪些普通答案允许 Task owner 采纳，哪些必须指定质量/法规角色；
9. 飞书消息撤回是否会使尚未采纳的 AnswerSubmission 自动失效；
10. late result 是否一律隔离，还是允许管理员在特定故障恢复场景重新导入 BusinessOutput；
11. WorkOrder 一个 final AgentResult 的限制是否满足所有 Harness，还是需要将“partial result stream”和“final result”进一步建模；
12. Coordinator 自动创建 Follow-up DRAFT Task 的风险等级上限。

---

## 46. Artifact / Quality Domain 实现前待确认

以下问题不影响本轮核心边界成立，但在进入实现规格前需要冻结：

1. 项目交付 Artifact 提升为 ENTERPRISE_CONTROLLED 的批准角色与触发时机；
2. 第一版是否允许多个长期 Branch，还是仅允许短期 Review Branch 与显式 Merge；
3. Revision 的业务粒度是每次 Agent 提交、每次 Human 保存，还是只在提交 Review 时封存；
4. 哪些 Evidence 类型可由确定性 Service 自动 VERIFIED，哪些必须 Human 专业验证；
5. QualityProfile 是企业统一模板加项目 Binding，还是允许项目创建受控派生版本；
6. CRITICAL/MAJOR Issue 的 Blocking 规则与授权 Dismiss 角色；
7. 第一版各 ArtifactType 的 Approval Requirement、人数、顺序和职责分离规则；
8. 哪些 Release Purpose 会自动建立 EffectiveBinding，生效时间由谁确认；
9. 客户交付成功但内部尚未生效时，DeliveryItem 的 Completion 如何定义；
10. Approval 撤销或 Evidence 失效后，哪些情况必须自动阻止后续 Release，哪些情况进入 Recall Assessment；
11. 飞书发布的正式 Destination 粒度是群、话题、文档、文件夹还是组合对象；
12. 飞书回执最少需要保存 messageId、fileKey、threadId、recipient scope 和 packageHash 中哪些字段；
13. Renderer Validation 是否对 DOCX、PDF、XLSX 全部强制，以及人工视觉 QA 的触发条件；
14. 是否允许同一 Revision 面向不同客户/监管用途形成多个 Release Package；本文建议允许；
15. Recall 后 EffectiveBinding 是立即终止、回退上一版本，还是必须由 Human 选择替代版本；
16. PolicyException 是否进入 v0.1；本文建议 Core 保留引用边界，但 MVP 不实现通用豁免引擎。

---

## 47. 结论

Project Domain 的核心不是一组文件表，而是一条受控推导链：

```text
原始材料
    ↓ SourceMaterial
业务识别
    ↓ CustomerMaterial
客户现状基线
    ↓ CustomerBaseline
制巨参考与法规范围
    ↓ TemplateBaseline + RegulatoryProfile
差距分析
    ↓ GapAnalysis
Human 批准的项目承诺
    ↓ DeliveryPlan + DeliveryItem
正式执行与成果
    ↓ Task / WorkOrder / Artifact / Quality / Release
```

这条链确保飞书、Claude Code、Codex、OpenClaw 或未来任何 Runtime 都可以参与工作，但都不能通过聊天、文件或 Agent 自报跳过客户事实确认、专业判断、交付范围批准和正式成果质量门。

Task / Execution Domain 在这条业务链之上进一步固定了执行责任：

```text
Task
业务需要做什么
    ↓
WorkOrder
这一次允许做什么
    ↓
Run
哪个 Runtime 实际尝试了什么
    ↓
AgentResult
执行边界收到了什么不可变结果
    ↓
Core Completion Evaluators
业务标准是否真正满足
```

当信息不足时，`InformationRequest` 将阻塞原因转化为可经飞书投递、授权回答、正式解决和安全恢复的业务对象。这样即使更换 Harness、重启 Coordinator、飞书话题中断或 Run 失败，项目仍可以从 Core 中恢复，而不是依赖 Agent 记忆猜测下一步。

Artifact / Quality Domain 则固定了成果从内容到正式生效的责任链：

```text
Artifact
长期成果身份
    ↓
ArtifactRevision
不可变精确内容
    ↓
Evidence + QualityProfile
依据与验收政策
    ↓
GateResult + ReviewIssue
检查、整改与验证
    ↓
Approval
授权 Human 接受精确版本
    ↓
Release
冻结 Package 的正式发布
    ↓
EffectiveBinding
指定用途下的当前有效版本
```

因此，飞书在 MVP 中可以完整承担 Agent 对话、资料收集、状态通知、Review 交互、Approval UI 和受控发布 Channel，但飞书自身不是业务 Source of Truth。任何聊天答复、卡片点击或文件发送，只有被映射为经过身份、权限、版本、幂等和 Policy 校验的 Core Command 后，才能改变正式业务状态。

至此 Domain Model v0.1 已覆盖三条核心链：

```text
客户与项目事实链
Project → Baseline → Gap → DeliveryPlan

任务与执行责任链
Task → WorkOrder → Run → AgentResult

成果与质量接受链
Artifact → Revision → Evidence/Gates/Issues → Approval → Release
```

三条链的跨 Aggregate 一致性、Reference Project、事务/Saga 和并发幂等基准见 [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](./05-cross-aggregate-consistency-module-boundary-v0.1.md)。Typed Reference、四个核心 Contract 和模块公开 Catalog 分别见 [`03-core-contracts.md`](./03-core-contracts.md) 与 [`06-typed-references-contract-catalog-v0.1.md`](./06-typed-references-contract-catalog-v0.1.md)；PostgreSQL Schema 所有权、逻辑表、事务、RLS、Outbox/Inbox 和对象存储边界见 [`07-postgresql-logical-model-v0.1.md`](./07-postgresql-logical-model-v0.1.md)。当前实现入口由 IM-03 WI-01 决策矩阵补充；WI-03 至 WI-12 的本地业务实现和运行结果以 Module-Test-002 及各 Verification-Record 为准，统一跨 Aggregate E2E 与独立人工验收仍未运行。

## 48. IM-03 WI-01 前置对象决策补充

Issue #57 的 [`Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md) 冻结了本 Domain 开始实现前的四组前置对象：

1. Product Root 只保存稳定身份和 current version pointer；ProductVersion 至少包含 ProductType、DisplayName、IntendedUse、结构化 ProductScope、SourceRefs 和 payload Hash。版本只追加，激活与回滚只移动精确指针。
2. QMSConfiguration Revision 必须同时表达 ApplicabilityDecision、ManagementChoice 和 ProfessionalDecision；Human-only 激活/回滚指向既有精确 Revision，不能改写历史。
3. EnterpriseProfileSnapshot 和 ProductScopeSnapshot 都由 Application 层从精确输入生成，调用者不得提交任意 Profile/Scope Payload。ProjectStartSnapshot 必须绑定同一 Enterprise 的 Profile Snapshot、QMS Version 和 Product Scope Snapshot。
4. Platform Template/Regulatory Reference 由独立 Platform Reference 入口导入/发布；Project 只能选用已发布的精确 ContentAddressedRef，模板不等于 Regulatory Evidence。

输入版本、Hash、有效期或适用范围变化时，旧 GapAnalysis 进入 `STALE` 并追加 Impact Review；旧 Gap、Context、Plan 和 Artifact 不原地改写。`NOT_PROVIDED`、`UNKNOWN` 和 `MISSING_CONFIRMED` 不互相推导。QualityProfile/Evidence 等 IM-05 Ref 只做强引用和 Scope/Hash/lifecycle/purpose 验证，不通过跨 Schema Join 或测试假数据取得正文。

本节是设计决策，不替代业务实现证据；WI-03 至 WI-12 的 DDL、Repository、Handler、Evaluator 和受控 PostgreSQL 结果已记录在 Module-Test-002。统一跨 Aggregate runtime chain、真实业务适用性和人工 Reference Project 仍为 `NOT RUN`。

## 48.2 IM-05 WI-02 Evidence/Profile 实现边界

WI-02 将本 Domain 已冻结的 Evidence 与 QualityProfile 语义收敛为可执行的最小业务切片：Evidence source snapshot、locator、captured content ref/hash 和 candidate payload hash 创建后不可变；verification、revocation、EvidenceLink 只追加事实；`SUPPORTS` 依赖当前 VERIFIED 且未 revoked/disputed 的 Evidence，`CONTEXT_ONLY` 不可满足 supporting gate。QualityProfile 以 root/version 保存 GateSpec、闭合 DAG、职责分离、Human approval 和 release requirement；ACTIVE version 只读，策略变化必须创建新 exact version。

Handler 只使用公开精确 Ref 和可信 Context，错误 Scope/hash/target、source substitution、Agent verifier、环依赖、缺失 mandatory/approval/release requirement 与 self-review 均 fail-closed。此实现不宣称 GateResult、ReviewIssue、Approval、Release、Renderer、Provider、公开 HTTP、生产、跨模块 E2E 或真实客户业务验收已运行；Module-Test-005 WI-02 将这些范围保留为 `NOT RUN`。

本切片本地验证已通过：validation Unit 8/8，pinned PostgreSQL/Flyway persistence gate 30 files/298 tests；Evidence/Profile synthetic technical fixture 的 Provider、公开 HTTP、跨模块业务 E2E、生产和独立人工验收仍为 `NOT RUN`。

## 51. IM-03 合成 Reference Project 技术验收边界

用户已确认在没有真实业务场景时采用 `SYNTHETIC / TECHNICAL ONLY` Fixture。现有 WI focused fixtures 已在固定 PostgreSQL 18.6 / Flyway 11.20.3 上组成受控技术 Gate，`21` 个 persistence 测试文件、`256` 个测试通过；该结果只证明精确引用、生命周期、权限、Scope、Replay、CAS、RLS、immutable、stale/impact 和 Completion 技术边界，不证明真实业务适用性。

`EP-API-E-001/E-002` 的统一跨 Aggregate runtime execution、`EP-API-M-001` 的独立人工逐项审阅、Provider、公开 HTTP、生产和真实跨模块 Event Bus/Process Manager 继续为 `NOT RUN`。详细执行记录见 [`Verification-Record.md`](../im-03-synthetic-reference-fixture/Verification-Record.md)。

## 48.1 IM-03 WI-09 可执行 GapAnalysis 边界

WI-09 保留本章既有 GapAnalysis 生命周期和三态认识论，并将最小实现收敛为一个可审计的受控 evaluator 入口：`requestedScope` 只能携带确定性 canonical finding fixture，finding 的 `UNKNOWN`、`MISSING`、`NOT_PROVIDED` 和 `NOT_APPLICABLE` 不由 Handler 互相推导；summary 必须从不可变 finding 派生。七个 `GapInputSnapshot` ref 必须逐项绑定当前 Project/Enterprise 的精确版本、snapshot id、Scope、生命周期和 hash，不能使用 `latest` 或隐式 current。

InputSnapshot、GapAnalysisVersion、GapItem 和 Decision 都是追加事实。只有可信 Human 可以 ACCEPT；Agent、Service、`actingFor` 和伪造 actor 不能取得 Human 权限。`GapAnalysisAccepted` Event 只发布 exact Gap/Project/InputSnapshot/Decision refs，不能复制 finding 或客户原文。新 Baseline/Profile 只追加 stale/impact 事实并保留旧 Gap、Finding、Decision、Context、Plan 和 Artifact；新分析需要显式 start command。

## 49. IM-03 WI-08 实现对既有 Domain 语义的收敛

Issue #64 的实现保留本 Domain 对 TemplateBaseline/RegulatoryProfile 的版本化、精确引用、Human Gate 与历史不可变语义，并补齐以下可执行边界：Platform Template/Regulatory Reference 没有业务 Enterprise Scope；Project 只接受已发布精确 ContentAddressedRef；`RegulatoryApplicability` 使用当前 Contract 已冻结的 `APPLICABLE`、`NOT_APPLICABLE`、`PENDING_DETERMINATION` 三值闭集；EvidenceRef 与模板/法规版本严格分离。项目 Root pointer 由 CAS 推进，当前 Platform pointer 改变不会改写旧 Project Version。上述业务 DDL、Handler 与真实 PostgreSQL 结果以本轮 Module Test 的实际记录为准，未执行前保持 `NOT RUN`。
## 50. IM-03 WI-12 Completion 与 Impact 历史语义

DeliveryItem Completion 是由 EnterpriseProject owning Evaluator 根据冻结 `completionCriteria`、精确事实集合和 evaluator 版本派生的历史结果。Task/Run/Agent 自报、Release 的临时状态或任何 caller 布尔值都不能取得 Completion 权威性。WI-12 v1 的 criteria 只允许由 `allOf` 组成的正式 event type 条件；事实必须先经过受控 Inbox/Process Manager 记录并带有 payload hash、exact TypedReference、SourceWatermark 和 lifecycle。

`TaskCompleted` 单独存在而 criteria 要求 `ReleaseCompleted` 时只能形成 UNSATISFIED Evaluation；只有完整 ACTIVE fact set 才产生 `DeliveryItemCompletionSatisfied`。late、upstream new Version/Hash、RevisionApprovalLost 或 ReleaseRecalled 只追加新的 Fact/Evaluation/Impact Review，历史 Evaluation、已批准 Plan Version、Approval Decision 与旧 Fact 不改写。DeliveryItem Root 只保存 CAS 维护的 `current_completion_evaluation_id`，不复制 outcome 或事实正文；Projection 延迟不改变 Completion 结论。
