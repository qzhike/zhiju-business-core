# Zhiju Core 架构基准 v0.2

版本：v0.2
重建日期：2026-08-12
状态：`CURRENT ARCHITECTURE BASELINE / MODULE DESIGN CONSOLIDATED / IM-03 SCOPED TECHNICAL ACCEPTANCE COMPLETE / IM-UI-01 MILESTONE USER APPROVED 2026-08-28 / UI IMPLEMENTATION NOT STARTED`

文档角色：总体架构与七个逻辑模块的唯一权威。模块职责、所有权、非职责、公开端口类别、依赖和持久化边界只在本文维护；公开 Contract 精确名称以 `06` 为准，逻辑表以 `07` 为准。

## 文档说明

本文根据此前“Zhiju Business Core Planning”对话中已经形成的架构决策、核心 Contract 和 Domain Model v0.1 第一部分归纳重建。

当前项目目录中没有历史版文件，因此本文不是原文逐字恢复。2026-08-12，用户确认本文的现有架构原则，并补充冻结“飞书在 MVP 是完整双向 Agent Channel”和“QM 弃用”两项决定。本文将决定分为三类：

- **已冻结**：在对话中已经反复确认，不应由后续 Agent 随意推翻；
- **当前基准**：Coding Agent 必须遵守，仍可通过正式架构决定变更；
- **待确认 / 待设计**：只说明已知边界，不得由 Agent 擅自补成正式事实。

业务依据见 [`01-customer-field-findings.md`](01-customer-field-findings.md)。

---

## 1. 产品定位

### 1.1 Zhiju Core 是什么

Zhiju Core 是：

> 面向医疗器械企业质量管理体系服务的 Harness-neutral Business Backend / Domain Platform。

它拥有并控制：

- Enterprise、Product 和 Project；
- 企业事实和 QMS 配置；
- 客户资料、模板基线、法规档案和差距分析；
- Task、WorkOrder、Run 和 AgentResult；
- Artifact、Revision、Evidence、Review、Approval 和 Release；
- Business Policy、Quality Gate、权限和审计；
- Usage、Provenance 和长期业务历史。

### 1.2 Zhiju Core 不是什么

Zhiju Core 不是：

- Claude Code、Codex、OpenClaw 或 Pi 的封装；
- 通用 Agent Framework；
- LLM 推理循环；
- Prompt、Skill 或 Session 管理器；
- 单纯的 MCP Server；
- RAGFlow 的中间件；
- DOCX/XLSX 文件管理器；
- 飞书机器人；
- 一个依赖聊天历史才能工作的“超级 Agent”。

### 1.3 最重要的架构测试

没有 Agent 时，Zhiju Core 仍应支持 Human：

- 创建 Enterprise 和 Project；
- 维护已确认事实；
- 建立交付计划；
- 创建和修改受控 Artifact；
- 创建新 Revision；
- Review、Approve 和 Release；
- 查看 Evidence、Diff、History 和 Audit。

没有 Web UI 时，同一能力也应可以通过 API、CLI、集成测试或 Agent 调用。

如果去掉 Agent 后业务系统完全无法工作，说明业务规则被错误地放进了 Agent。

---

## 2. 总体分层

```text
Zhiju Platform
│
├── Experience Layer
│   ├── Zhiju Workspace
│   ├── Feishu
│   ├── CLI
│   └── Future Client / Portal
│
├── Agentic Applications
│   ├── Zhiju Coordinator
│   ├── Document Agent Profile
│   ├── Review Agent Profile
│   └── Record Agent Profile
│
├── Zhiju Core
│   ├── Domain Model
│   ├── Business Capabilities
│   ├── Policy & Quality Gates
│   ├── Identity & Authorization
│   ├── Usage & Audit
│   └── API / SDK / Events / MCP
│
├── Runtime Adapters
│   ├── Claude Code
│   ├── Codex
│   ├── OpenClaw
│   ├── Lightweight Runtime Adapter
│   └── Future Runtime
│
└── Infrastructure Adapters
    ├── PostgreSQL
    ├── Object Storage / NAS
    ├── RAGFlow / MinerU
    ├── Web Search
    ├── DOCX / XLSX / PDF Renderer
    └── Feishu API
```

边界原则：

```text
Experience 不拥有业务规则
Agent Runtime 不拥有正式业务状态
Infrastructure 不定义领域语义
Zhiju Core 不理解 Harness 内部 Session
```

---

## 3. 已冻结的架构决定

以下决定是 v0.2 的基线。后续若要修改，应记录正式 Architecture Decision，而不是由 Agent 在实现时默默改变。

| ID | 决定 |
|---|---|
| AD-001 | Zhiju Core 是 Business Domain Platform，不是 Agent Harness。 |
| AD-002 | 整体设计 Harness-neutral；Claude Code、Codex、OpenClaw 和未来 Runtime 均通过薄 Adapter 接入。 |
| AD-003 | QM 已弃用：不作为目标架构组件、实现依赖、Runtime Adapter 或后续评估候选。 |
| AD-004 | `Project.id` 不等于任何 Harness 的 Scope、Session、Thread 或 Workspace ID。 |
| AD-005 | Enterprise 是长期业务边界；Project 是阶段性工作边界。 |
| AD-006 | Harness Memory 不等于 Business Memory。 |
| AD-007 | Agent 可以 propose Fact、Memory、Evidence 和 Decision，但不能默认 commit 为已确认业务事实。 |
| AD-008 | AgentPrincipal 与 HumanPrincipal 不同；`acting_for` 不代表继承 Human 全部权限。 |
| AD-009 | Agent 不能执行 Human Approval 或 Release Authorization；外部 Publication 只能由已授权 Release 驱动的 Service 执行。 |
| AD-010 | Task、WorkOrder 和 Run 是三个不同概念。 |
| AD-011 | Artifact 是长期业务成果；ArtifactRevision 不可变。 |
| AD-012 | DOCX/XLSX 是渲染或交换格式，不是唯一 Source of Truth。 |
| AD-013 | Customer Baseline、Zhiju Reference Baseline 和 Project Deliverables 必须分开。 |
| AD-014 | Quality Gate 属于 Core，不属于 Prompt、Skill 或 Reviewer Agent。 |
| AD-015 | Deterministic Validation 优先于 LLM Review。 |
| AD-016 | AgentResult 只陈述执行结果；WorkOrder 是否业务完成由 Core 判断。 |
| AD-017 | Coordinator 是 Project Board 的 AI 操作者，不是另一个业务事实来源。 |
| AD-018 | v0.1 不优先建设完整 Knowledge Graph、通用 Workflow Engine 或自研 Agent Harness。 |
| AD-019 | MVP 必须实现完整双向飞书 Agent Channel；飞书只拥有渠道适配职责，正式业务状态仍由 Core 控制。 |
| AD-020 | GateResult、ReviewIssue、Human Approval、Release 和 EffectiveBinding 是不同业务事实，不能合并为一个状态。 |
| AD-021 | Human Approval 绑定精确 ArtifactRevision Hash；它不能覆盖 Mandatory REVISION_ACCEPTANCE Gate 失败，也不自动触发 Release。 |
| AD-022 | Release 使用冻结 Representation Package 和外部回执；飞书普通文件发送不是正式 Release。 |
| AD-023 | 上游 Evidence、Gate 或 Approval 失效通过 Impact Assessment 传播，不能改写或删除历史事实。 |
| AD-024 | 默认一个 Aggregate Root 一个同步事务；跨 Aggregate 不使用共享事务直接推进状态。 |
| AD-025 | 跨模块流程通过已提交 Domain Event、公开 Command Port 和特定 Process Manager 协作，不建设通用 Workflow Engine。 |
| AD-026 | v0.1 采用模块化单体；逻辑模块边界不等于微服务拆分。 |
| AD-027 | 每个 Command 只有一个模块写入所有者；模块不得共享 Repository 或直接更新他方 Aggregate。 |
| AD-028 | Domain Event 至少一次投递，Consumer 必须使用 Inbox/Command Idempotency 保证 Replay 安全。 |
| AD-029 | 飞书、Runtime、Renderer 等外部副作用必须在业务提交后执行，以 Attempt、稳定幂等键和真实 Receipt 记录。 |
| AD-030 | CUSTOMER_DELIVERY Release 可完成 DeliveryItem，但不自动建立 INTERNAL_EFFECTIVE_USE Binding。 |
| AD-031 | `aggregateVersion` 只用于 optimistic concurrency；业务历史使用独立 versionId/revisionId/snapshotId。 |
| AD-032 | 可重放、审批和发布 Contract 禁止 `latest`；按用途使用 ObjectRef、VersionedRef、ContentAddressedRef 或 SnapshotRef。 |
| AD-033 | 四个 Core Contract 是版本化、不可变、带 Canonical Payload Hash 的业务规范，不等于 Prompt、DTO 或数据库模型。 |
| AD-034 | Project Context 是按 Purpose/Audience 裁剪且显式记录 Omission/Redaction/Coverage 的 Snapshot，不是巨大 Prompt。 |
| AD-035 | WorkOrder READY 时冻结结构化 Specification；Prompt/Skill/AGENTS.md 只是 Runtime Materialization。 |
| AD-036 | AgentResult 是精确 Run 的不可变收据；Acceptance 与 WorkOrder Completion 使用独立记录和 Evaluator。 |
| AD-037 | Artifact + Quality Gate Contract 分为 RevisionAcceptance、ApprovalBundle、ReleaseReadiness 三个不可变 Snapshot。 |
| AD-038 | 公开 Command、Query、Event 使用独立 type/version、统一 Envelope 和唯一模块所有权。 |
| AD-039 | 未知 Major、未知 Required Extension、Hash/Scope 不匹配必须拒绝或 Quarantine，Consumer 不猜测兼容。 |
| AD-040 | v0.1 使用一个 PostgreSQL Database；七个业务模块各有独立权威 Schema，Projection 使用独立可重建 Schema。 |
| AD-041 | Core 使用状态模型加不可变 Version/Fact/Audit，不采用 Event Sourcing 作为完整重建源。 |
| AD-042 | Core ID 使用应用生成的 UUIDv7；业务 versionId/revisionId/snapshotId 与 aggregateVersion 分离。 |
| AD-043 | Enterprise 是 MVP 数据隔离边界，不为持久化提前引入 CustomerAccount/Tenant Aggregate；Platform Reference 与 Enterprise Data 分表。 |
| AD-044 | 所有 Project Row 显式保存 enterpriseId + projectId；跨模块关系使用 Typed Reference，不建立跨 Schema 外键或直接 Join。 |
| AD-045 | 查询/约束字段关系化，不可变 Contract 使用 Canonical JSONB + Hash，大内容与二进制进入受控对象存储。 |
| AD-046 | 每个模块拥有自己的 Command Receipt、Outbox、Inbox、Process Manager、Audit 和 Reference Index；不建设共享写入超级表。 |
| AD-047 | Enterprise 数据强制 RLS；模块使用独立 Owner/Runtime Role，RLS 只做纵深防御，IdentityPolicy 仍是授权 Source of Truth。 |
| AD-048 | 对象存储与 PostgreSQL 不使用分布式事务；采用 Staging、完整性验证、Link Commit 和受审计 Orphan Cleanup。 |
| AD-049 | 受控历史不级联删除；撤销、失效、替换、召回和归档使用状态或追加事实。 |
| AD-050 | v0.1 Canonical Hash 使用 SHA-256 并保存算法/Canonicalization Version；高风险 Contract 暂不强制服务端数字签名。 |
| AD-051 | Object/Contract/Capability Registry 由构建期静态声明发布；业务状态使用 closed text constraint，不提供在线动态改语义。 |
| AD-052 | Projection 只能消费已提交事实并可重建；Projection 延迟或失败不能作为 Command、Approval、Release 或 Completion 成功判据。 |
| AD-053 | Product 在 v0.1 是 EnterpriseProject 拥有的独立版本化 Aggregate，可跨 Project 精确引用；不作为 Enterprise 内必须同事务更新的 Entity。 |
| AD-054 | IM-DG-005 已批准：Canonical Document 与 Workbook 使用共用不可变封装和独立最小 Schema；结构化内容使用稳定 Unit/Sheet/Row/Cell 身份与 Canonical JSON + SHA-256；Renderer 通过 IntegrationGateway 的精确 Revision Attempt/Adapter/Receipt 路由，成功后由 Artifact 登记 Representation。 |

---

## 4. Domain 全景

```text
Enterprise
├── EnterpriseFact
├── EnterpriseProfile                 projection
├── EnterpriseProfileSnapshot         immutable
├── Product
├── QMSConfiguration                  versioned aggregate
│   ├── ApplicabilityDecision
│   ├── ManagementChoice
│   └── ProfessionalDecision
├── EffectiveArtifact / Release
└── Project
    ├── ProjectSnapshotRefs
    ├── CustomerBaseline
    │   ├── SourceMaterial
    │   └── CustomerMaterial
    ├── ZhijuReferenceBaseline
    │   ├── TemplateBaseline
    │   └── RegulatoryProfile
    ├── GapAnalysis
    ├── DeliveryPlan
    │   └── DeliveryItem
    ├── Task Board
    │   ├── Task
    │   ├── WorkOrder
    │   ├── Run
    │   └── AgentResult
    └── Artifact
        └── ArtifactRevision
            ├── EvidenceRef
            ├── GateResult
            ├── ReviewIssue
            ├── Approval
            └── Release
```

该图描述业务关系，不代表数据库表或代码目录。

---

## 5. Enterprise Layer

覆盖层级：`CURRENT BASELINE / DETAIL IN 04`

### 5.1 Enterprise

Enterprise 是接受制巨 QMS 服务、实际运行质量体系、长期存在的企业业务主体，也是最高长期业务边界。

Enterprise Aggregate Root 保持轻量：

```text
Enterprise
├── id
├── displayName
├── status: ACTIVE | SUSPENDED | ARCHIVED
├── createdAt
└── createdBy
```

企业名称、注册地址、生产地址、法定代表人、质量负责人、员工人数等可变化且需要证据和历史的信息，不应直接堆入 Enterprise Root。

### 5.2 EnterpriseFact

EnterpriseFact 表示一个可追溯、可确认、有有效期和历史的企业事实。

核心属性：

```text
EnterpriseFact
├── id
├── enterpriseId
├── type
├── value
├── status: PROPOSED | CONFIRMED | DISPUTED | SUPERSEDED
├── sourceRefs[]
├── validFrom?
├── validTo?
├── confirmedBy?
└── confirmedAt?
```

不变量：

- Agent 可以创建 Proposal，但不能以 Human 身份确认高风险 Fact；
- CONFIRMED Fact 必须有来源或明确 Human Decision；
- 历史事实通过 SUPERSEDED 和有效期保留，不原地抹除；
- 冲突来源不能被静默覆盖；
- Project 使用的关键事实必须可定位到具体版本或快照。

### 5.3 EnterpriseProfile

EnterpriseProfile 是从 EnterpriseFact、Product、QMSConfiguration 和有效成果生成的可读投影，回答：

> 我们目前对这家企业知道什么？

它不是另一个独立事实库，也不应允许直接写入导致与 Fact 分叉。

### 5.4 EnterpriseProfileSnapshot

Project 启动和高风险 WorkOrder 执行时，需要冻结当时看到的企业状态。

EnterpriseProfileSnapshot：

- 创建后不可变；
- 记录基于哪些 Fact、Product 和 QMSConfiguration 版本；
- 用于 Replay、Audit 和后续差异解释；
- 防止半年后用新事实解释旧决策。

### 5.5 Product

Product 属于 Enterprise 的长期业务对象。产品信息参与：

- 法规和标准适用性；
- QMSConfiguration；
- Project Scope；
- Template Baseline 选择；
- Delivery Plan；
- Evidence 和受控文档内容。

Product 的 v0.1 最小结构已由 Issue #57 冻结为结构化 ProductVersion：ProductType、DisplayName、IntendedUse、ProductScope、SourceRefs 和内容 Hash；更细的行业字段仍由后续业务切片追加，不得把 Root 简化为单个自由文本字段。

### 5.6 QMSConfiguration

QMSConfiguration 是版本化 Aggregate，表达企业当前质量管理体系为何这样设计，而不是简单列出有哪些文件。

它至少聚合：

```text
ApplicabilityDecision
哪些法规、标准、条款或体系要求适用，为什么

ManagementChoice
企业管理层在可选路径中作出的选择

ProfessionalDecision
由质量、法规或专业人员形成的判断
```

不变量：

- 配置版本不可原地重写；
- 关键决定必须有 Evidence 或 Human Decision；
- Agent 可以提议，但不能自行确认高风险适用性和管理决定；
- Project 应引用明确的配置版本或快照；
- 新配置生效不能改变历史 Project 当时看到的上下文。
- `ACTIVATE` 和 `ROLLBACK` 都只移动 current pointer 到同一 Enterprise 的已存在精确 Revision；回滚不复制或修改历史版本。

### 5.7 Project

Project 表示围绕某个 Enterprise、产品范围和服务目标，在有限时间内完成的一组工作与交付。

Project 不是：

- 一个聊天；
- 一个 Harness Session；
- 任意 Harness Scope、Session 或飞书话题；
- 一个文件夹；
- Enterprise 的别名。

Project 启动时应至少冻结：

- EnterpriseProfileSnapshot；
- QMSConfiguration 版本；
- Product Scope；
- Project Identity、成员、目标和权限；
- 初始 Customer Baseline、Template Baseline 和 Regulatory Profile 状态。

---

## 6. Project Domain

覆盖层级：`CURRENT BASELINE / DETAIL IN 04`

详细对象、命令、状态机、不变量、事件、权限和测试用例见 [`04-domain-model-v0.1.md`](04-domain-model-v0.1.md)。本节保留架构级摘要，详细设计以该文档为准。

### 6.1 三个文档世界

每个 Project 必须分开保存三个业务世界：

```text
A. Customer Baseline
客户当前真实有什么

B. Zhiju Reference Baseline
制巨标准和法规依据是什么

C. Project Deliverables
本项目最终准备交付什么
```

核心业务推导：

```text
Customer Baseline
        +
Zhiju Reference Baseline
        +
Product / Enterprise Facts
        +
Human Decisions
        ↓
Gap Analysis
        ↓
Delivery Plan
        ↓
Project Deliverables
```

### 6.2 CustomerBaseline

CustomerBaseline 是客户现状的只读业务基线。客户原始资料不得被 Agent 或 Human 直接覆盖为交付物。

材料状态建议包含：

```text
PRESENT
PARTIAL
MISSING_CONFIRMED
NOT_PROVIDED
UNKNOWN
NOT_APPLICABLE
```

`NOT_PROVIDED` 与 `MISSING_CONFIRMED` 必须严格区分。

### 6.3 SourceMaterial 与 CustomerMaterial

```text
SourceMaterial
= 客户上传或系统接收的原始文件及其完整性、Hash、来源和时间

CustomerMaterial
= 对 SourceMaterial 业务意义的结构化识别
```

例如，“体系文件2025最终版.docx”是 SourceMaterial；经识别为“采购控制程序、版本 2025.2、部分缺失”后形成 CustomerMaterial。

重新解析或重新分类不能破坏原始文件和历史判断。

### 6.4 TemplateBaseline

制巨内部标准不是一个任意模板文件夹，而应形成版本化、彼此兼容的 Template Set。

Project 启动或 Delivery Plan 批准时需要冻结 TemplateBaseline。模板库以后升级，不应让进行中项目的一部分文件自动切换到新版本。

Template 不是 Regulatory Evidence。模板可以体现制巨经验，但声称“法规要求”时必须引用真正 Evidence。

### 6.5 RegulatoryProfile

RegulatoryProfile 表达当前 Enterprise、Product 和 Project Scope 下适用的法规、标准和证据范围。

它需要区分：

- 已确认适用；
- 已确认不适用及理由；
- 待判断；
- Agent 推断；
- 已失效或被替代；
- 生效版本与时间。

### 6.6 GapAnalysis

GapAnalysis 比较 Customer Baseline 与目标体系。

Gap 状态建议：

```text
MATCH
MINOR_GAP
MAJOR_GAP
MISSING
EXTRA
UNKNOWN
NOT_APPLICABLE
```

建议动作：

```text
KEEP
REVISE
REPLACE
CREATE
REMOVE
NEED_INFORMATION
HUMAN_REVIEW
```

Gap 结果必须保留依据，不应只是 Agent 的自然语言意见。

### 6.7 DeliveryPlan 与 DeliveryItem

DeliveryPlan 是由 GapAnalysis、Project Scope 和 Human Decision 形成的项目交付计划。

DeliveryItem 表示“项目需要交什么”，不等同于具体 Artifact。

```text
DeliveryItem
= 交付义务、目标和状态

Artifact
= 承载该交付成果的长期受控对象
```

一个 DeliveryItem 可以尚未创建 Artifact；也可以因为返工、拆分或合并与多个 Artifact 发生关系。v0.1 允许显式多对多关系，默认期望一个 DeliveryItem 对应一个主要 Artifact；精确规则以 `04` 为准。

---

## 7. Project Context Contract

覆盖层级：`CURRENT BASELINE / DETAIL IN 03`

Project Context 回答：

> What do we know?

完整 execution ContextSnapshot 由 TaskExecution 的 Context Builder 按 WorkOrder Purpose 组装；EnterpriseProject、Artifact、QualityGovernance 和 ReleasePublication 分别提供权限裁剪的权威 Source Slice。该组装服务不拥有来源 Aggregate，也不能反向修改任何模块。

### 7.1 Canonical Project Context

Canonical Project Context 是 Core 中完整的项目世界模型，包括：

- Project Identity；
- Enterprise/Profile/QMSConfiguration Snapshot；
- Customer Baseline；
- Template Baseline；
- Regulatory Profile；
- GapAnalysis；
- DeliveryPlan 和 DeliveryItem；
- 已确认 Fact、Decision、Memory 和 Evidence；
- Artifact、Review、Approval 和 Release 状态；
- Task Board、Blocker 和 InformationRequest。

它是项目地图，不是一个巨大 Prompt，不默认包含所有文档全文。

### 7.2 Execution Context

Execution Context 是根据 WorkOrder 从 Canonical Project Context 生成的最小投影。

```text
Canonical Project Context
        │
        ├── CoordinatorProjection
        ├── DocumentWriterProjection
        ├── ReviewerProjection
        └── RecordFormProjection
```

例如，“修改采购控制程序第 4 章”的 Context 只应包含：

- 项目摘要；
- 相关 Product 和已确认 Fact；
- 当前 ArtifactRevision 与允许修改章节；
- 相关客户文件；
- 对应模板章节；
- 相关 Regulatory Evidence；
- 未解决 Review Issue；
- WorkOrder Constraints。

### 7.3 Epistemic State

Context 中的信息必须表达确定性：

```text
CONFIRMED
INFERRED
UNKNOWN
DISPUTED
SUPERSEDED
```

Agent 不能把 INFERRED 或 UNKNOWN 当成 CONFIRMED 使用。

### 7.4 Context Snapshot

每次高价值 Run 必须引用不可变 ContextSnapshot。只记录 `project_id` 不足以支持 Replay，因为项目状态会变化。

详细 Contract、SourceManifest、ContextItem、Omission、Redaction、Coverage 和验证规则见 [`03-core-contracts.md`](03-core-contracts.md)。Typed Reference 见 [`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md)。

---

## 8. Task、WorkOrder、Run 与 AgentResult

覆盖层级：`CURRENT BASELINE / DETAIL IN 03 AND 04`

详细对象、Commands、Lifecycle、Invariants、Events、权限和测试用例见 [`04-domain-model-v0.1.md`](04-domain-model-v0.1.md) Part D。本节保留核心 Contract 摘要。

WorkOrder 与 AgentResult 的 canonical Contract v1.0 见 [`03-core-contracts.md`](03-core-contracts.md)。Runtime Adapter、Prompt 或飞书展示必须从该 Contract 映射，不得另建不同语义。

### 8.1 Task

Task 是业务看板上的工作对象，回答：

> 业务上还需要做什么，当前做到哪里？

Task 可以由 Human 或 Coordinator 创建，可以由 Human 或 Agent 执行，也可以产生多个 WorkOrder。

### 8.2 WorkOrder

WorkOrder 是 Harness-neutral 执行契约，回答：

> What should be done?

建议结构：

```text
Identity
├── workOrderId
├── projectId
├── taskId
├── requestedBy
└── contractVersion

Objective
Inputs / References
ContextSnapshot / Projection
Constraints
AllowedCapabilities
ExpectedOutputs
CompletionCriteria
Risk / QualityProfile
Harness Preference or Requirement
Model Policy
Token / Cost / Runtime Budget
Policy / Skill / Template Versions
```

WorkOrder 不应只是自然语言 Prompt，也不应给 Agent 通用写权限。

状态机建议保持简单：

```text
DRAFT
READY
QUEUED
RUNNING
WAITING_INPUT
COMPLETED
FAILED
CANCELLED
```

是否需要 `EXPIRED` 待后续确认。

### 8.3 Run

Run 表示一次具体执行尝试。同一个 WorkOrder 可以有多个 Run：

```text
WO-182
├── Run-1 Claude Code → timeout
├── Run-2 Claude Code → waiting input
└── Run-3 Codex       → produced revision
```

Run 负责绑定：

- Harness、Model 和 Runtime；
- 开始、结束、超时、取消和重试；
- Usage；
- ContextSnapshot；
- Runtime Continuation；
- AgentResult。

### 8.4 AgentResult

AgentResult 回答：

> What happened?

AgentResult 对应一次 Run，不直接拥有 WorkOrder 的业务完成解释权。

建议结构：

```text
Identity
ExecutionOutcome
BusinessOutputs[]
WorkspaceOutputs[]
Findings[]
KnowledgeProposals[]
InputRequests[]
FollowUpProposals[]
Usage
Provenance
RuntimeContinuation
HumanSummary
```

关键规则：

- `execution_outcome = completed` 只表示 Harness 正常结束；
- BusinessOutputs 应优先引用 Core Object，如 `ArtifactRevision REV-019`；
- Workspace 文件不是正式成果；
- Finding 是观察，不自动成为 BusinessFact；
- Agent 可以提出后续任务，但不能擅自扩大当前 WorkOrder；
- Usage 应优先由 Runtime Adapter 或 Provider 数据生成，不依赖 Agent 自报；
- Core 根据 CompletionCriteria 和正式对象状态决定 WorkOrder 是否完成。

### 8.5 InformationRequest

InformationRequest 是正式、持久、可投递、可回答和可解决的 Aggregate，不是 Agent 聊天中的问题文本。

```text
AgentResult InputRequestProposal
    ↓ Result Processor
InformationRequest
    ↓ Feishu delivery
Authorized Human AnswerSubmission
    ↓ validation and acceptance
InformationRequest RESOLVED
    ↓
new ContextSnapshot + WorkOrder resume/retry
```

`ANSWERED` 不等于 `RESOLVED`。飞书消息 ID 只是 Channel 来源引用；只有通过身份、项目权限、AnswerSpec 和领域权限验证的 AnswerSubmission 才能被采纳。blocking Request 未 RESOLVED 时，WorkOrder 与 Task 不得完成。

如果 Runtime 在 final AgentResult 前发出受控 `RuntimeInputRequired` 并安全挂起，Request 解决后可以在 Token/Context 仍有效时 Resume 同一 Run；如果 `BLOCKED_INPUT` 已作为 final AgentResult 提交，该 Run 已终止，Request 解决后必须创建新 Run Retry。

### 8.6 四层完成语义

```text
Run SUCCEEDED
= 执行边界接受 AgentResult

WorkOrder COMPLETED
= WorkOrder ExpectedOutput / CompletionCriteria 满足

Task COMPLETED
= 整个业务工作标准满足

DeliveryItem COMPLETED
= 正式成果、Quality Gate、Human Approval 和所需 Release 满足
```

Harness 正常退出、Agent 自报 completed 或飞书卡片显示完成都不能跨越这些边界。

---

## 9. Artifact 与 Revision

覆盖层级：`CURRENT BASELINE / DETAIL IN 04`

### 9.1 Artifact

Artifact 是长期业务成果对象，例如：

```text
ART-023 《采购控制程序》
```

Artifact 不是某个 DOCX 文件，也不是某次 Agent 输出文本。

Artifact 可以维护按用途区分的权威绑定和 Projection：

```text
workingHeads[]
currentApprovedRevisionRefs[]
effectiveBindings[]
```

三者可以不同。例如 REV-004 已批准并在内部生效，REV-005 正在 Branch 上修订。新 Draft 不改变已批准、已发布或已生效版本。

### 9.2 ArtifactRevision

ArtifactRevision 是某一时刻的具体受控内容，创建后不可修改。

任何 Human 或 Agent 修改都产生新 Revision：

```text
REV-018
   ↓ Human edit
REV-019
   ↓ Codex revision
REV-020
```

Revision 至少需要记录：

- parentRevision；
- authorPrincipal；
- Human 或 Agent；
- actingFor；
- WorkOrder 和 Run；
- changedSections；
- changeSummary；
- ContextSnapshot；
- CustomerMaterial、Template 和 Evidence 引用；
- Policy、Skill、Model 和 Runtime Provenance；
- Canonical Content 与 Rendered Outputs。

Revision lineage 是显式 DAG：普通 Revision 有一个 parent，Merge Revision 有两个或更多 parent 并记录冲突解决。不同 Branch 不采用 last-write-wins。

### 9.3 Canonical Artifact Model

文档内部应尽量保存为结构化内容：

```text
Document
└── Sections
    ├── sectionId
    ├── title
    ├── content blocks
    └── evidenceRefs
```

记录表格内部应保存 WorkbookSpec：

```text
WorkbookSpec
├── sheets
├── columns
├── cell types
├── formulas
├── validation rules
└── cross-record rules
```

然后由 Renderer 生成 DOCX、XLSX 或 PDF。

IM-DG-005 已批准的 v0.1 最小范围如下：

- `STRUCTURED_DOCUMENT` 使用带稳定 `unitId` 的 Section、Paragraph、Table、Table Row 和 Table Cell 结构；
- `WORKBOOK_SPEC` 使用带稳定 ID 的 Sheet、Column、Row 和 Cell 结构，并承载 value type、formula、validation rule 等表格语义；
- 两种正文共享 Canonical JSON、SchemaRef、Canonicalization Version、SHA-256 Content Hash 和受控对象存储边界，但不合并为万能 AST；Hash 唯一覆盖 `{schemaRef, contentType, canonicalizationVersion, body}` 的 Canonical JSON bytes，Manifest 元数据不进入 Hash 域；
- Artifact-owned Content Object Manifest 管理 `STAGING -> LINKED -> FROZEN`，SEALED Revision 只能引用并快照精确 FROZEN Manifest，Revision 自身不承载可变 storage state；
- Diff 读取两个精确的 ContentAddressed Revision，基于稳定结构身份产生 Workspace/Application 内部可重建的 Added、Removed、Changed、Moved 结果，不修改业务事实；公开边界继续使用 `artifact.get_revision_diff_inputs@1.0`，不在 IM-04 隐式新增公共 Diff Operation；
- Renderer 只读取精确 Revision，不能读取 `latest` 或直接写 Artifact 业务表；现有通用 RenderAttempt Query 不返回原始请求与成功结果，IM-04 必须先 additive 冻结只读 RenderAttempt Binding Query。该公共边界落地后，Artifact 才能权威核验 Revision、canonical content ref/input Hash、Renderer、输出 locator/checksum 和 Raw Receipt 并登记 Representation。DOCX/XLSX 的实际可打开性和版式人工验收属于 IM-05。

### 9.4 客户原文件导入

CustomerMaterial 是只读输入。可通过显式命令从客户资料创建 Artifact 初始 Revision，但必须保留 origin：

```text
CustomerMaterial CM-33
        ↓ create artifact from baseline
Artifact ART-023
        ↓
REV-001 origin = customer baseline
```

客户原件不能因该操作被覆盖，也不能自动被视为已通过制巨 Quality Gate。

---

## 10. Quality Gate、Approval 与 Release

覆盖层级：`CURRENT BASELINE / DETAIL IN 03 AND 04`

Artifact + Quality Gate 回答：

> What do we accept as official?

### 10.1 QualityProfile

不同 Artifact 类型和风险等级由 QualityProfile 决定 Gate 组合，而不是每次写进 Prompt。

例如：

```text
QMS_PROCEDURE_HIGH
├── Structural / Schema Gate
├── Business Rule Gate
├── Evidence Gate
├── Semantic Review Gate
├── Render Validation Gate
└── Human Approval Requirements
```

Human Approval 不是 GateResult 类型。QualityProfile 分别定义 GateSpec DAG、Issue Policy、职责分离、Approval Requirements、Release Requirements 和增量重跑规则。

GateSpec 还必须区分 `REVISION_ACCEPTANCE` 与 `RELEASE_READINESS`：前者针对 Canonical Revision 并决定是否可进入 Human Approval；后者针对精确 Representation/Package，并在 Release Authorization 前验证 checksum、rendererVersion 和需要时的 packageHash。

### 10.2 Gate 类型

#### Structural / Schema Gate

确定性检查：

- 必需章节；
- 编号和元数据；
- 内容结构；
- 交叉引用存在性；
- WorkbookSpec 结构。

#### Business Rule Gate

尽量确定性检查：

- 负责人存在且角色匹配；
- 日期先后关系；
- 文件、记录、设备、供应商和人员引用存在；
- 程序与记录表规则一致；
- 不允许越过 WorkOrder 修改范围。

#### Evidence Gate

检查：

- 法规性主张是否附 Evidence；
- Evidence 是否存在；
- 是否属于适用 RegulatoryProfile；
- 是否仍然有效；
- Evidence 是否真正支持内容。

其中“是否存在和适用”可确定性验证，“是否语义支持”可以使用受控 Reviewer。

#### Semantic Review Gate

使用 LLM 或专业 Human 检查：

- 法规意图覆盖；
- 内部完整性；
- 跨文件一致性；
- 职责合理性；
- 术语一致性；
- 遗漏和矛盾。

Reviewer 只能产生 ReviewResult 或 ReviewIssue，不能直接 Approve。

#### Human Approval

Human Approval 是独立对象，记录：

- revisionId；
- decision；
- approver HumanPrincipal；
- role；
- comment；
- timestamp；
- policy/version。

AgentPrincipal 即使 `acting_for` 某个 Approver，也不能执行该操作。

Approval 必须绑定精确 revisionId、contentHash、QualityProfile Version、Gate Bundle 和 Issue Snapshot。Mandatory REVISION_ACCEPTANCE Gate 失败或存在 Blocking ReviewIssue 时，Human Approval 不能作为绕过手段；Release 阶段的 Render Gate 则必须针对冻结的精确 Representation/Package 另行通过。

### 10.3 GateResult 不可变

GateResult 必须针对具体 Revision；Release 阶段 Gate 还必须针对精确 Representation/Package。任何 Result 都不可从 FAIL 原地改为 PASS。

```text
REV-020 → Semantic Review FAIL → GR-102
REV-021 → Semantic Review PASS → GR-103
```

新 Revision 产生后，由 ChangeImpact 决定需要重新运行哪些 Gate。

结果复用也必须为新 Revision 创建新的 GateResult，引用旧 Result 与不可变 ChangeImpact；不得复制旧 PASS 或修改其 revisionRef。

### 10.4 Incremental Quality Gate

结构化 Section 和变更范围可以支持：

```text
Revision Diff
    ↓
ChangeImpact
    ↓
Affected Rules / Evidence / Documents
    ↓
Targeted Re-gating
```

这样可以避免因一个错别字重新进行全文强模型 Review，也能降低 Token 成本。

### 10.5 Release / Publication

Approval 与 Release 必须分开。

一个 Revision 可以已批准但尚未交付；同一批准版本也可能有不同 Release Purpose：

- 客户正式交付；
- 监管提交；
- 内部试运行；
- 飞书发布；
- 导出到指定目录。

Release 至少记录：

- revisionId；
- purpose；
- recipient；
- releasedBy HumanPrincipal；
- releasedAt；
- renderedFile；
- checksum；
- destination or external reference。

Release 在 PREPARED 后冻结 Revision、Representation Package、Recipient 和 Destination，由符合要求的 Human 授权，再由 Publishing Service 执行外部副作用并记录逐项回执。Release 与 EffectiveBinding 继续分离；新 Draft 或新 Revision 不改变当前有效版本。

Revision Acceptance、Approval Bundle 和 Release Readiness 的完整 Contract Family 见 [`03-core-contracts.md`](03-core-contracts.md)。

---

## 11. Evidence、Traceability 与 Business Memory

覆盖层级：`EVIDENCE BASELINE / BROADER TRACEABILITY DETAIL PENDING`

### 11.1 概念分离

```text
Fact
= 可结构化、可确认、有状态和有效期的业务事实

Memory
= 对未来工作有帮助但不一定适合结构化为 Fact 的上下文

Evidence
= 支持 Fact、Decision、Artifact Content 或 Review Issue 的依据

Decision
= 经过授权形成的业务选择或专业判断
```

### 11.2 Agent 提议，Core 接受或拒绝

AgentResult 可以返回：

```text
FactProposal
MemoryProposal
PreferenceProposal
EvidenceCandidate
DecisionProposal
```

Core 根据类型、风险和 Policy 决定：

- 自动接受低风险内容；
- 等待 Human 确认；
- 标记冲突；
- 拒绝；
- 限期或替代。

### 11.3 Traceability 目标

系统最终应支持：

```text
Regulation / Standard / Customer Evidence
        ↓
Applicability or Professional Decision
        ↓
QMSConfiguration
        ↓
DeliveryItem
        ↓
Artifact Section / Record Rule
        ↓
ArtifactRevision
        ↓
GateResult / Approval
        ↓
Release
```

v0.1 不先建设通用 Knowledge Graph；优先使用清晰的 typed reference 和索引满足关键追溯查询。

---

## 12. Identity、Authorization 与安全边界

### 12.1 Principal

至少区分：

```text
HumanPrincipal
AgentPrincipal
ServicePrincipal
```

AgentPrincipal 可以记录：

```text
actingForHumanId
harness
runtime
workOrderId
projectId
capabilities
expiry
```

### 12.2 Capability-based Access

正式 WorkOrder 应只授予所需 Capability，例如 Writer：

```text
project.read_context
artifact.read
evidence.search
artifact.create_revision
review.submit
```

不授予：

```text
artifact.approve
artifact.release
project.delete
qms_configuration.confirm
```

### 12.3 Core 内部再次检查

即使 Agent 有 `artifact.create_revision`，Core 仍需检查：

- Principal 是否属于 Enterprise/Project；
- WorkOrder 是否允许目标 Artifact；
- baseRevision 是否仍有效；
- changedSections 是否在允许范围；
- ContextSnapshot 和 Policy 是否匹配；
- Evidence 引用是否有效；
- Schema 是否通过；
- 是否存在并发修改。

Prompt、AGENTS.md、CLAUDE.md 或 Skill 只是行为引导，不是安全边界。

### 12.4 数据隔离

- 所有业务访问必须有 Enterprise 和 Project Scope；
- Agent Runtime 不获得整个 NAS 或全部客户库；
- 不使用共享 Human 管理员 Token；
- 敏感客户资料的外部模型传输必须可配置、可审计；
- Runtime Continuation 作为 opaque reference 保存，不能被当成授权凭据。

---

## 13. Business Capabilities

覆盖层级：`CURRENT HIGH-LEVEL BASELINE / PAYLOAD DETAIL PENDING`

Core 应先定义意图型 Capability，再决定用 REST、SDK、MCP 或 Event 暴露。

### 13.1 Enterprise

```text
create_enterprise
propose_enterprise_fact
confirm_enterprise_fact
dispute_enterprise_fact
supersede_enterprise_fact
get_enterprise_profile
create_enterprise_profile_snapshot
```

### 13.2 QMS Configuration

```text
propose_applicability_decision
record_management_choice
record_professional_decision
create_qms_configuration_revision
activate_qms_configuration
```

### 13.3 Project

```text
create_project
capture_project_baseline
classify_customer_material
freeze_template_baseline
build_regulatory_profile
propose_gap_analysis
approve_delivery_plan
get_project_context
create_context_snapshot
```

### 13.4 Task / WorkOrder

```text
create_task
create_work_order
dispatch_work_order
record_run_result
request_information
resume_work_order
complete_work_order
```

### 13.5 Artifact

```text
create_artifact
create_artifact_from_customer_material
create_artifact_revision
compare_revisions
submit_revision_for_review
```

### 13.6 Quality / Approval / Release

```text
run_quality_gate
record_review_issue
resolve_review_issue
request_human_approval
approve_revision
reject_revision
release_approved_revision
```

禁止设计为：

```text
update_artifact({ status: "APPROVED" })
update_fact({ status: "CONFIRMED" })
```

正式状态只能通过表达业务意图的 Command 改变。

---

## 14. Runtime Boundary

### 14.1 Runtime Adapter 接口

Runtime Adapter 的职责是：

- 把 WorkOrder 和 Execution Context 转换成 Harness 可消费形式；
- 启动、继续、取消或查询 Run；
- 收集模型、Token、成本、工具调用和错误信息；
- 将输出转为 AgentResult；
- 保存 opaque continuation reference。

Runtime Adapter 不负责：

- 定义 Project；
- 确认企业事实；
- 判断 Artifact 是否批准；
- 保存唯一业务历史；
- 决定 Release 是否有效。

### 14.2 Runtime 实施边界

QM 已弃用，不再进入实现选型。Runtime 层采用 Zhiju 自己定义的最小 Adapter Contract，只封装 WorkOrder 投递、Run 生命周期、Usage/Provenance 收集和 AgentResult 回传。目标用户或服务器预先安装三个客户端；Zhiju 通过受控本地进程调用 CLI，不引入 SDK、App Server 或 Provider API 直连。

```text
Zhiju Core
    ↓ Runtime Interface
CLI Runtime Adapter Host
    ├── ClaudeCodeCliDriver ──> installed `claude`
    ├── CodexCliDriver       ──> installed `codex`
    ├── OpenClawCliDriver    ──> installed `openclaw`
    └── Future Runtime
```

不得为了替代 QM 而自研一套通用 Agent Harness。对 Session、Sandbox、模型调用、上下文压缩等能力，优先使用具体 Harness 的原生能力；Zhiju 只实现维持业务 Contract 所需的适配和运行控制。

禁止把任意 Runtime 对象映射为业务对象：

```text
Zhiju Project ≠ Runtime Scope / Session
Zhiju Task ≠ Runtime Task
Zhiju Artifact ≠ Runtime File
Zhiju Business Memory ≠ Runtime Memory
```

### 14.3 Harness Kit

正式 Managed Project Mode 可以提供统一 Harness Kit：

```text
Zhiju Execution Package
├── work-order.json
├── context snapshot / references
├── policy bundle
├── capabilities
└── evidence index
```

再通过薄适配生成：

- Claude Code 的项目指令；
- Codex 的项目指令；
- OpenClaw 的 Managed Skill/Plugin 配置；
- 统一 Zhiju API/MCP 连接。

即使用户删除本地指令，Core 的权限与质量门仍不可绕过。

---

## 15. Human Workspace 与 Feishu

### 15.1 Zhiju Workspace

Human UI 是一等产品组成部分，但不属于 Core Domain 内部。

Workspace 至少需要：

- Enterprise 和 Project Overview；
- Agent-native Task Board；
- Customer Baseline 与资料完整性；
- GapAnalysis 和 DeliveryPlan；
- Artifact 列表、Revision、Diff；
- Evidence 与 ReviewIssue；
- 表格规则和错误定位；
- Human Edit、Review、Approval 和 Release；
- Run、Usage、Blocker 和 InformationRequest；
- Audit Timeline。

Human 编辑也必须创建新 Revision，不能直接覆盖正式内容。

#### 15.1.1 Workspace UI 实施边界

`IM-UI-01 Workspace UI MVP` 在 IM-06 Human-operated Core 完成后进入实现，可与 IM-07 Feishu Channel、IM-08 CLI Runtime Automation 的交付时间窗并行，并作为 IM-09 Reference Project E2E 的前置。该顺序确保 UI 消费稳定的 Human-operated Command/Query/Projection，而不是以 Mock 或页面状态提前发明业务语义。

```text
Browser
    → Workspace BFF（OIDC Session / CSRF / public API composition）
        → Public HTTP API / Projection Query
            → owning Application Port
                → Business Core
```

边界：

1. Workspace UI 是 Experience Module，不是第八个 Business Core 模块；不新增 owning Schema、Repository 或公开业务 Contract Owner。
2. BFF 不是第二套业务 API；它只建立受信认证上下文、调用已批准公开 API、组合权限裁剪的 ViewModel，并传播 correlation/causation。
3. UI 不重新计算 AuthorizationDecision、Approval/Release Readiness、Task/Delivery Completion 或 EffectiveBinding；必须展示权威结果和精确 Ref/Hash/Version。
4. Projection `STALE/PAUSED/REBUILDING/FAILED`、外部副作用 `UNKNOWN`、部分成功和未确认 Command 必须真实显示，不能用乐观页面状态冒充成功。
5. Human-only 操作必须由服务器端 ActorSnapshot/AuthorizationDecision 再验证；隐藏按钮不是授权边界，Agent/Service/`actingFor` 请求仍须被 Core 拒绝。
6. Browser/BFF 不直接连接 PostgreSQL、OpenBao、Ceph、Renderer 或 Provider SDK；短期下载 URL 由授权 API 即时签发，不进入持久状态、日志或 telemetry。
7. Human Edit 只能提交创建新 Revision 的公开 Command；浏览器草稿、编辑器 buffer、local cache 或 autosave 不得成为正式 Revision。

具体产品范围、Work Item 和 Exit Gate 见 [`../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)；Experience 规格见 [`../module-specs/Module-Spec-UI01-WorkspaceUI.md`](../module-specs/Module-Spec-UI01-WorkspaceUI.md)。

### 15.2 完整双向 Feishu Agent Channel

完整双向飞书 Agent Channel 是 MVP 的必选组成部分，不是后续可选集成。

MVP 至少支持：

- 飞书用户与 Zhiju HumanPrincipal 的可靠映射；
- 私聊、群聊和话题消息双向收发；
- 飞书群/话题与 Enterprise、Project、Task、WorkOrder 或 Agent Session Reference 的显式绑定；
- 用户在飞书中发起任务、补充输入、继续、取消和查询状态；
- 文件接收、完整性校验、病毒/安全检查接口和 SourceMaterial 候选创建；
- Agent 进度、InformationRequest、Review 待办、失败和完成状态回传；
- 交互卡片、幂等回调和 Deep Link；
- 必要时从 Workspace 将结果、摘要或正式 Release 回传原会话；
- 消息撤回、重复投递、乱序和重试的可审计处理；
- Channel 与 Core 之间的身份、权限和项目边界校验。

完整双向不表示飞书消息成为业务 Source of Truth。职责分工为：

```text
Feishu Channel
= 身份入口、消息、话题、文件传输、交互与通知

Zhiju Core
= Project、Task、WorkOrder、Context、Artifact、Approval、Release 与 Audit

Zhiju Workspace
= 复杂 Diff、Evidence、表格校验、Human Edit 和信息充分的正式审批
```

群聊或话题不能自动成为 Project。绑定必须是显式命令，并经过当前 HumanPrincipal 的权限检查。未绑定消息默认停留在个人或待分类上下文，不得读取任意客户项目。

文件出现在飞书中只表示收到 SourceMaterial Candidate，不表示它已成为 CustomerMaterial、CustomerBaseline、Artifact 或正式 Evidence。必须经过校验、分类和授权命令。

Channel Adapter 不得拥有 Project、Artifact、Approval 或 Release 业务规则，也不得使用共享管理员身份代表所有用户调用 Core。

---

## 16. Usage、Provenance 与 Audit

每次 Run 至少需要记录：

```text
requestedBy
initiatedBy
projectId
taskId
workOrderId
runId
harness
runtime
provider
model
inputTokens
cachedInputTokens
cacheWriteTokens?
outputTokens
reasoningTokens?
toolCalls
estimatedCost
startedAt
finishedAt
outcome
```

Provenance 至少需要：

```text
harnessVersion
model
workOrderVersion
policyVersion
skillVersion
contextSnapshotId
templateBaselineId
regulatoryProfileVersion
executionNode
```

正式审计链应能回答：

- 谁请求了任务；
- 谁或哪个 Agent 实际执行；
- 当时看到了什么 Context；
- 使用什么模板、证据、Policy、Skill 和模型；
- 产生了哪些正式对象；
- 哪些 Gate 通过或失败；
- 哪个 Human 批准；
- 最终向谁发布了哪个版本。

---

## 17. 状态与不变量摘要

### 17.1 必须跨模块成立的不变量

1. 未授权 Principal 不得读取其他 Enterprise 或 Project 数据。
2. Agent 不能执行 Human Approval 或 Release Authorization；外部发布只能由已授权 Release 驱动的 Publishing Service 执行。
3. 任何正式内容修改都产生新 ArtifactRevision。
4. Customer Baseline 原始资料不可被交付物覆盖。
5. `NOT_PROVIDED` 不能自动推导为 `MISSING_CONFIRMED`。
6. INFERRED 或 UNKNOWN Fact 不能被静默当成 CONFIRMED 使用。
7. WorkOrder 范围外的修改必须被 Core 拒绝或形成 FollowUpProposal。
8. Harness 自报完成不等于 WorkOrder 完成。
9. GateResult 针对具体 Revision 且不可变。
10. 未通过所需 Quality Gate 的 Revision 不得批准或发布。
11. Approved 与 Released 必须分开记录。
12. 历史 Project 必须能够引用当时的 Profile、QMSConfiguration 和 Context Snapshot。
13. Runtime Session、Workspace 文件或聊天回复不能自动成为正式业务对象。
14. 真实质量记录不得由 Agent 虚构。
15. 新 Draft/New Revision 不得改变已批准、已 Release 或当前 EffectiveBinding。
16. Evidence、Gate、Approval 失效不得删除历史 Release，必须触发 Impact/Recall Assessment。
17. 飞书普通消息、卡片回复或文件发送不得隐式形成 Approval、Release 或 EffectiveBinding。

---

## 18. v0.1 实施策略

### 18.1 原则

- 先 Domain、Contract 和 Invariant，后 PostgreSQL、API 和 UI；
- 先 Human-operated Core，后 Agent automation；
- Workspace UI 在 IM-06 后以独立 IM-UI-01 进入，可与 Feishu/CLI Experience Adapter 的后续交付并行，但必须在 IM-09 完整 E2E 前完成适用 Gate；
- 先关键 Traceability reference，后完整 Knowledge Graph；
- 先确定性规则，后语义 Review 优化；
- 先一个完整 Reference Project，后通用化；
- 不把所有未来可能性提前抽象进 v0.1。

### 18.2 建议里程碑

#### M1：Enterprise 与 Project Foundation

设计并实现：

- Enterprise；
- EnterpriseFact；
- EnterpriseProfileSnapshot；
- Product；
- QMSConfiguration 基础版本；
- Project 创建和 Snapshot 引用。

手动验收：创建一家脱敏企业，记录有来源的质量负责人和生产地址，创建 QMS 配置版本并启动一个 Project；后续修改企业事实不改变项目启动快照。

#### M2：Project Baseline 与 Delivery Plan

设计并实现：

- SourceMaterial；
- CustomerMaterial；
- CustomerBaseline；
- TemplateBaseline；
- RegulatoryProfile；
- GapAnalysis；
- DeliveryPlan / DeliveryItem。

手动验收：导入一套不完整客户资料，正确区分未提供与确认缺失，冻结模板版本，形成可由 Human 审阅的差距分析和交付计划。

#### M3：Artifact 与 Human Workflow

设计并实现：

- Artifact；
- ArtifactRevision；
- 基础 Diff；
- Human Edit；
- ReviewIssue；
- Approval；
- Release；
- Canonical Content、基础 Diff、Human Edit、Renderer Port/Attempt 边界；DOCX/XLSX Renderer 最小输出和版式验收属于 IM-05。

手动验收：从客户“采购控制程序”或制巨模板创建 Artifact，Human 修改产生新 Revision，查看 Diff、批准并导出，能定位正式发布版本。

#### M4：Task / WorkOrder / AgentResult

设计并实现：

- Task Board；
- WorkOrder；
- ContextSnapshot 和 Projection；
- Run；
- AgentResult；
- InformationRequest；
- AgentPrincipal；
- 一个 CLI Runtime Adapter Host 与三个 Driver Profile。

手动验收：同一个采购程序修订任务可由 Human 发起，经 Agent 产生 REV；Run、Usage、Context 和输出引用完整可查；缺少输入时通过飞书 InformationRequest 闭环后恢复；Agent 不能完成 Human Approval。

#### M5：Quality Gate

设计并实现：

- Structural Gate；
- Business Rule Gate；
- Evidence Gate；
- Semantic Review Gate；
- QualityProfile；
- ChangeImpact；
- ReviewIssue 验证闭环；
- Human Approval Requirements 与 Release Readiness。

手动验收：一份包含缺失章节、无 Evidence 法规主张和日期逻辑错误的成果不能进入批准；修复后新 Revision 可通过并发布。

### 18.3 暂不实施

- 通用 Workflow DSL；
- 完整 Knowledge Graph；
- 自研通用 Agent Harness；
- 自动自主运行的复杂 Coordinator；
- 全面 SaaS 多租户抽象；
- 全功能在线 Office 编辑器；
- 同时深度适配所有 Harness；
- 在飞书消息内实现完整文档编辑器或复杂 Diff；这些能力通过 Workspace Deep Link 完成。

---

## 19. 当前基准覆盖

### 已纳入基准

- Enterprise；
- EnterpriseFact；
- EnterpriseProfile；
- EnterpriseProfileSnapshot；
- Product 高层边界；
- QMSConfiguration；
- ApplicabilityDecision；
- ManagementChoice；
- ProfessionalDecision；
- Project 基础边界；
- Project Context Contract；
- WorkOrder Contract；
- AgentResult Contract；
- Artifact + Quality Gate Contract。

### Project Domain 已完成详细设计

- CustomerBaseline；
- SourceMaterial；
- CustomerMaterial；
- TemplateBaseline；
- RegulatoryProfile；
- GapAnalysis；
- DeliveryPlan；
- DeliveryItem。

以上对象已在 Domain Model v0.1 中定义 business meaning、类型、关系、Commands、Lifecycle、Invariants、Domain Events、权限以及 Unit/E2E acceptance cases。

Project Domain 的核心原则已由用户于 2026-08-12 确认；实现前细节问题保留在 Domain Model 待确认清单中。

### Task / Execution Domain 已完成详细设计

- Task；
- WorkOrder；
- Run；
- AgentResult；
- InformationRequest。

以上对象已在 Domain Model v0.1 中定义九项必需设计元素，并明确 Run、WorkOrder、Task 与 DeliveryItem 四层完成语义。

### Artifact / Quality Domain 已完成详细设计

- Artifact；
- ArtifactRevision；
- Evidence 与 EvidenceLink；
- QualityProfile；
- GateResult；
- ReviewIssue；
- Approval；
- Release。

以上对象已在 Domain Model v0.1 中定义九项必需设计元素，并明确不可变 Revision、Gate/Issue 整改、Human Approval、Release、EffectiveBinding 五层语义，以及 Incremental Gate 的安全复用条件。

### 跨 Aggregate 一致性与模块边界

- 使用“采购控制程序”Reference Project 串联 Project、Task / Execution、Artifact / Quality 三条链；
- 定义 Command Owner、Event Envelope、单 Aggregate 事务、Process Manager、补偿和 Human Intervention；
- 定义 optimistic concurrency、Run Lease/fencing token、Command/Event/外部副作用幂等；
- 冻结 IdentityPolicy、EnterpriseProject、TaskExecution、Artifact、QualityGovernance、ReleasePublication、IntegrationGateway 七个逻辑模块；
- 冻结模块化单体作为 v0.1 部署基线；
- 冻结 MVP 必须实现、可简化和明确延后范围。

详细设计见 [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](05-cross-aggregate-consistency-module-boundary-v0.1.md)。

### Typed Reference 与 Core Contracts

- 冻结 ObjectRef、VersionedRef、ContentAddressedRef、SnapshotRef、EvidenceRef、RepresentationRef、PrincipalRef 和 ExternalRef；
- 区分业务版本身份与 aggregateVersion 并发 token；
- 抽取 Project Context、WorkOrder、AgentResult、Artifact + Quality Gate Contract v1.0；
- Artifact + Quality Gate Contract 分为 Revision Acceptance、Approval Bundle、Release Readiness 三个阶段 Snapshot；
- 冻结 Command、Query、QueryResult、Domain Event Envelope；
- 定义 Major/Minor 兼容、Canonicalization、Payload Hash、安全和未知版本处理；
- 建立七个模块的公开 Command/Query/Event Catalog。

详细设计见 [`03-core-contracts.md`](03-core-contracts.md) 和 [`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md)。

### PostgreSQL Logical Model

- 冻结一个 Database、七个权威模块 Schema 和一个可重建 Projection Schema；
- 冻结 UUIDv7、Scope Key、业务版本、aggregateVersion、Hash、时间与不可变记录约定；
- 定义关系数据、Canonical JSONB 和对象存储边界；
- 将 Typed Reference 与四个 Core Contract 映射为可验证持久化记录；
- 定义每模块 Command Receipt、Outbox、Inbox、Process Manager、Audit 和 Reference Index；
- 定义 optimistic concurrency、Run Lease、Branch Head、Approval、Release Package、Receipt 与 EffectiveBinding 约束；
- 定义 Enterprise/Project RLS、模块数据库角色、敏感 ExternalId 和保留/删除边界；
- 用采购控制程序 Reference Project 验证从 Context 到正式 Receipt/Completion 的数据链。

详细设计见 [`07-postgresql-logical-model-v0.1.md`](07-postgresql-logical-model-v0.1.md)。

### 建议的下一步设计

- 审阅 PostgreSQL Logical Model 的拓扑、持久化边界和安全决策；
- 设计 Command/Query/Event API Contract；
- 随后设计飞书 Channel Contract 和 Runtime Adapter Contract；
- 最后形成 DDL/Migration/Repository 的实施里程碑计划。

---

## 20. Cross-Aggregate 与模块边界摘要

### 20.1 Reference Project

采购控制程序案例验证以下完整链：

```text
Feishu SourceMaterial
    ↓ CustomerMaterial / CustomerBaseline
GapAnalysis / Approved DeliveryItem
    ↓ Task / WorkOrder / Run
InformationRequest → Feishu Answer → new ContextSnapshot / new Run
    ↓ ArtifactRevision
Gate FAIL → ReviewIssue → new Revision → Verification
    ↓ Human Approvals
Frozen Release Package → Feishu Receipt
    ↓
DeliveryItem COMPLETED
Internal EffectiveBinding UNCHANGED
```

### 20.2 一致性边界

```text
one Command
    → one owning module
    → one target Aggregate
    → one synchronous transaction
    → Aggregate state + Outbox committed atomically

cross-Aggregate progress
    → committed Domain Event
    → idempotent Consumer / Process Manager
    → target module public Command
```

跨 Aggregate 失败不删除历史，通过 Retry、显式补偿、Impact Assessment、Recall 或 Human Intervention 处理。

### 20.3 模块边界规则

```text
BusinessCore
├── IdentityPolicy
├── EnterpriseProject
├── TaskExecution
├── Artifact
├── QualityGovernance
├── ReleasePublication
└── IntegrationGateway
```

`BusinessCore` 是上述模块共同构成的业务内核，不是第八个持有业务数据的超级模块。它定义稳定业务语言和共享执行规则，但不拥有 Agent 推理循环、模型调用、Renderer、飞书 SDK 或第二套共享 Repository。

模块在 v0.1 中属于同一可部署应用，但必须遵守：

1. 每个 Aggregate、公开写 Command 和权威表只有一个 Owner；
2. 模块只能通过自己的 Repository Role 写自己的 Schema；
3. 跨模块读取使用公开 Query/Decision Port；
4. 跨模块写入使用目标模块公开 Command；
5. 状态传播使用版本化、已提交 Domain Event；
6. 不共享业务 Repository、不跨 Schema 直接写表、不以直接 Join 绕过授权与生命周期；
7. IntegrationGateway 是最外层 Anti-Corruption Layer，不拥有任何 Domain Completion；
8. Projection 是可重建读模型，不是业务模块，也不能反向写权威状态。

### 20.4 模块所有权总表

| 模块 | 核心职责 | 权威对象/Process | 明确不拥有 | PostgreSQL Schema |
|---|---|---|---|---|
| IdentityPolicy | 身份、角色、Capability、授权和 Policy Snapshot | Principal、ExternalIdentityLink、RoleAssignment、CapabilityGrant、ActorSnapshot、AuthorizationDecision、PolicySnapshot | Project 内容、Task、Artifact、Approval、Release、Provider Token | `identity_policy` |
| EnterpriseProject | 长期企业事实、客户现状、项目范围、参考输入、差距与批准交付承诺 | Enterprise、Product、QMSConfiguration、Project、Material、Baseline、RegulatoryProfile、GapAnalysis、DeliveryPlan/Item、相关 Impact/Completion Process | Run、Revision、Gate、Approval、Release、飞书消息 | `enterprise_project` |
| TaskExecution | 业务工作、执行授权、Runtime 尝试、执行收据、输入恢复与 Context Assembly | Task、ContextSnapshot、WorkOrder、Run、AgentResult、InformationRequest、Usage、Completion/Recovery Process | Project Fact、Revision 内容、Gate、Approval、Release、Harness Session 内部状态 | `task_execution` |
| Artifact | 长期成果身份、不可变内容版本、Lineage、Representation 与 EffectiveBinding | Artifact、Branch/Head、ArtifactRevision、RevisionParent/Conflict、Representation、Approved/Effective Binding | Evidence、Gate、Approval、Release Attempt、Renderer 实现 | `artifact` |
| QualityGovernance | Evidence、质量政策、Gate、Issue 整改验证、Human Approval 与质量快照 | Evidence/Link、QualityProfile、ChangeImpact、GateResult、ReviewIssue、Approval、RAS/ABS/RRS、质量 Impact Process | Revision 内容、外部发布、Delivery Completion、Agent/Renderer 实现 | `quality_governance` |
| ReleasePublication | 将已批准 Revision 以冻结 Package 正式发布并保留 Attempt/Receipt/Recall | Release、ReleasePackage/Item/Destination、PublicationAttempt、FormalReceipt、Recall、Release Impact Process | Revision 内容、Gate/Approval 决策、飞书 SDK、EffectiveBinding | `release_publication` |
| IntegrationGateway | 飞书、Runtime、Renderer 等外部协议与 Core Contract 的转换和真实外部观测 | InboundEnvelope、ChannelBinding、AdapterAttempt、RawExternalReceipt、Quarantine、AdapterHealth | Project/Task/Artifact/Quality/Release 规则、Human Approval、业务完成 | `integration_gateway` |

### 20.5 IdentityPolicy

职责：统一表达 Human、Agent、Service、Runtime 与 ExternalParty 的身份、角色、授权范围和快照。所有写命令都必须携带可审计 Authorization Decision。

公开能力类别：

- Command：注册 Principal、关联外部身份、授予/撤销 Role 或 Capability、记录 Policy Snapshot；
- Query/Decision：解析 Principal、授权 Command、检查 Enterprise/Project Access 与 Human-only Capability；
- Event：Principal/ExternalIdentity/Role/Capability/Policy 的已提交变化；授权拒绝默认只进入安全审计。

核心不变量：

- AgentPrincipal 与 HumanPrincipal 永不合并；
- `actingFor` 不继承 Human Approval、Release Authorization 或其他 Human-only Capability；
- 授权绑定 Enterprise、Project、对象、时间和 Command Purpose；
- 角色撤销不删除历史 Actor/Authorization/Policy Snapshot；
- 外部身份必须显式映射，不能用共享管理员身份代表所有用户；
- 跨 Enterprise 访问默认拒绝。

依赖：不依赖其他业务模块；其他模块只能调用其 Decision/Query Port。Principal 可以跨 Enterprise 使用，但 Role、Capability 和 Decision 必须保存精确 Scope。外部身份使用加密原值和密钥化 Lookup Hash，不保存长期 Credential。

验收锚点：同一飞书用户能映射为 HumanPrincipal；有 Project A 权限但无 Project B 权限；actingFor Agent 可以起草 Revision，但审批和发布授权均被拒绝，历史 Policy Snapshot 可解释拒绝。

### 20.6 EnterpriseProject

职责：拥有企业长期知识和项目承诺，从客户材料形成确认现状，冻结模板/法规输入，产生 GapAnalysis，再由 Human 批准 DeliveryPlan。

公开能力类别：

- Command：材料接收/验证/确认、Baseline/Profile 激活、Gap 创建/接受、DeliveryPlan 创建/批准/激活、Completion/Impact 重算；
- Query：Project Context Source Slice、Enterprise/Profile Snapshot、Active Baseline/Profile/Plan、对象 Scope、Delivery Criteria；
- Event：材料/基线/Gap/Plan/DeliveryItem 的已提交状态和影响请求。

核心不变量：

- 原始 SourceMaterial 只读保留；附件不自动成为 CustomerMaterial 或 Baseline；
- `NOT_PROVIDED` 不自动变成 `MISSING_CONFIRMED`；
- TemplateBaseline 不等于 Regulatory Evidence；
- GapAnalysis 不直接形成项目承诺；
- DeliveryPlan 必须由授权 Human 批准后激活；
- DeliveryItem Completion 是精确 Criteria 的派生事实，不能直接设置；
- 新 Baseline/Profile 不改写旧 Gap、Plan 或 Artifact。

依赖：同步只依赖 IdentityPolicy 和自身模型；不反向同步查询下游决定状态。通过事件消费 TaskExecution、Artifact、QualityGovernance、ReleasePublication 的精确完成事实。Project Context 的完整 Assembly 由 TaskExecution 负责，本模块只提供权限裁剪的 Source Slice。

持久化边界：Platform Template/Regulatory Reference 与 Enterprise Data 分表；不可变 Baseline/Gap/Plan Version 不覆盖；SourceMaterial 二进制进入对象存储；下游 Ref 不使用跨模块外键。

验收锚点：上传不完整采购程序后，形成确认客户基线、冻结参考/法规输入和批准 DeliveryItem；后续补资料只触发 Impact Review，不改变旧计划和成果。

### 20.7 TaskExecution

职责：拥有业务工作、一次授权执行、Runtime 尝试、不可变执行结果、人工输入请求、ContextSnapshot、Usage 和恢复。

公开能力类别：

- Command：Task 生命周期、ContextSnapshot 构建、WorkOrder 创建/冻结/排队、Run 创建/取消/重试、AgentResult 提交/接受、InformationRequest 投递/回答/解决；
- Query：Task Board 权威切片、WorkOrder Contract、Run/Usage/Provenance、InformationRequest、ContextSnapshot；
- Event：Task/WorkOrder/Run/AgentResult/InformationRequest 的已提交事实。

核心不变量：

- Task、WorkOrder、Run、AgentResult 分层完成；
- WorkOrder READY 后 Specification 不可变；
- 默认一个 WorkOrder 只有一个 active Run Claim；
- Run 的 Context、Capability Binding 和 fencing token 创建后不可替换；
- 一个 Run 只接受一个 final AgentResult；
- final `BLOCKED_INPUT` 解决后创建新 ContextSnapshot 和新 Run；
- Usage 的受信 Runtime/Provider 记录优先于 Agent 自报；
- AgentResult 只能用 Core Typed Ref 表达正式业务输出，scratch file 不是成果。

依赖：同步读取 IdentityPolicy 和 EnterpriseProject/Artifact/QualityGovernance/ReleasePublication 的权限裁剪 Source Slice；Runtime 调用只通过 IntegrationGateway Port；跨模块结果通过事件传播。

持久化边界：Context、READY WorkOrder 和 AgentResult 使用不可变 Canonical JSONB + Hash；active Run、Lease/fencing 与 final Result 使用数据库 Claim；InformationRequest、Delivery、Answer、Resolution 分开保存。

验收锚点：采购程序 WorkOrder 因缺信息终结为 BLOCKED_INPUT，经飞书获得授权答案后产生新 ContextSnapshot 和新 Run；原 Run、Usage、Provenance 和 Result 不变且可查。

### 20.8 Artifact

职责：拥有长期成果身份、不可变内容版本、Branch/Lineage、Canonical Content 引用、Representation Metadata 与特定 Purpose 的 EffectiveBinding。

公开能力类别：

- Command：创建 Artifact/Revision/Merge、移动 Branch Head、Withdraw/Invalidate、登记 Representation、建立/替换 Binding；
- Query：Artifact、精确 Revision/Hash、Lineage/Diff Input、Representation、EffectiveBinding；
- Event：Artifact/Revision/Merge/Representation/Binding 的已提交事实。

核心不变量：

- Revision SEALED 后内容、Hash、Parent 和 Provenance 不可变；
- Lineage 是同 Artifact 内 DAG，跨 Artifact Parent 被拒绝；
- Branch 冲突不使用 last-write-wins；
- 新 Draft 不改变 Approval、Release 或 EffectiveBinding；
- 同 Artifact/Purpose 的 EffectiveBinding 有效期不重叠；
- EffectiveBinding 只能由满足 Policy 的正式 Release 事实驱动；
- Rendered File 不是 Canonical Content Source of Truth。

依赖：同步使用 IdentityPolicy 与 EnterpriseProject 的 Scope/Reference Validation；异步消费 ReleaseCompleted/Recalled；其他模块只能通过公开 Revision/Representation/Binding Port 使用本模块。

持久化边界：Canonical Content 与 Representation 进入对象存储；数据库保存不可变 Locator/Hash/Checksum；Parent 使用模块内复合关系；Branch Head 使用 CAS；Binding 不通过删除旧记录替换。

验收锚点：ART-023 经 REV-001/002/003 演进；并行 Branch 不覆盖，Merge 可追溯；CUSTOMER_DELIVERY Release 不改变 INTERNAL_EFFECTIVE_USE。

### 20.9 QualityGovernance

职责：回答一个精确 Revision 为什么可以或不可以被接受、批准和发布；拥有 Evidence、质量政策、Gate、Issue 闭环、Human Approval 和三类质量快照。

公开能力类别：

- Command：Evidence 验证/撤销、Profile 激活、GateResult 记录/复用/失效、Issue Raise/Resolve/Verify/Close、Approval 请求/决定/撤销、Readiness 评估；
- Query：Evidence、QualityProfile/Gate Plan、Gate Result、Blocking Issue、RAS/ABS/RRS；
- Event：Evidence/Profile/Gate/Issue/Approval/Readiness 的已提交变化。

核心不变量：

- Active QualityProfile Version 不可修改；
- GateResult outcome/target 不可改写，复用也产生新 Result；
- ReviewIssue 跨 Revision 保留原发现、修复提议和独立验证；
- Agent 和 actingFor Agent 永远不能执行 Human Approval；
- Mandatory REVISION_ACCEPTANCE Gate 或 Blocking Issue 阻止 Approval；
- Mandatory RELEASE_READINESS Gate 阻止 Release Authorization；
- Approval 绑定精确 Revision Hash、Quality Snapshot、Human Actor 和 Authorization；
- Render Gate 绑定精确 Representation Checksum、Renderer Version 和 Package Hash。

依赖：同步使用 IdentityPolicy、Artifact immutable Revision Query 和 EnterpriseProject Evidence Source Validation；异步消费 RevisionSealed、ReleasePrepared 和上游失效事件；不写 Artifact 或 Release。

持久化边界：Evidence/Gate/ChangeImpact/Approval/Revocation/Snapshot 都是不可变事实；ReviewIssue Header 可推进，Resolution/Verification 追加；三个 Quality Snapshot 分表保存。

验收锚点：REV-002 的规则/Evidence Gate 失败产生 Issue；REV-003 修复后重跑或合法复用、独立验证、完成 Human Approval；全部历史仍可解释。

### 20.10 ReleasePublication

职责：把 fully approved 的精确 Revision 以冻结 Package 正式发布到明确 Destination，并保存授权、尝试、正式回执、部分失败和召回。

公开能力类别：

- Command：创建/准备/验证/授权 Release、开始 Attempt、记录正式 Receipt/Failure、完成/部分完成、Recall；
- Query：Release、Frozen Package、Attempt、Formal Receipt、Impact；
- Event：Prepared/Authorized/AttemptRequested/Succeeded/Failed/Completed/PartiallyCompleted/Recalled。

核心不变量：

- 只有 fully approved 的精确 Revision 可以授权；
- PREPARED 后 Revision、Package、Representation、Recipient 和 Destination 冻结；
- Agent 不得 Release Authorization；
- 无可验证正式 Receipt 不得标记 Destination 成功；
- 部分成功保留真实外部事实，不伪造回滚；
- Recall 不删除发布历史；
- CUSTOMER_DELIVERY 不自动建立 INTERNAL_EFFECTIVE_USE；
- Release Readiness 必须绑定精确 Package/Representation，Revision Acceptance 不能替代。

依赖：同步使用 IdentityPolicy、Artifact Revision/Representation Query、QualityGovernance Approval/Readiness Query；所有外部发布通过 IntegrationGateway Port；通过事件向 Quality、Project 和 Artifact 传播结果。

持久化边界：一个 Release 一个冻结 Package；Attempt 使用稳定外部幂等键；Raw Receipt 经本模块验证后才形成 Formal PublicationReceipt；Authorize 使用 expectedVersion 重新验证撤销竞态。

验收锚点：REL-801 冻结 DOCX/PDF 和飞书 Destination，经 Human 授权；逐项 Receipt 可查，部分失败可重试，客户交付不切换内部有效版本。

### 20.11 IntegrationGateway

职责：把飞书、Runtime、Renderer 和未来外部系统协议转换为已认证 Core Command 或可审计 Attempt/Raw Receipt；它是 Anti-Corruption Layer。

公开能力类别：

- Inbound：认证、验证、去重外部事件，解析 External Identity/Channel Binding，再调用目标模块 Command；
- Outbound：投递飞书消息/文件、WorkOrder、Cancel/Resume、Render Request，并记录 Attempt 和 Raw Receipt；
- Event：Inbound 接受/拒绝、Channel/Runtime/Render Attempt 的成功、失败或 UNKNOWN。

核心不变量：

- 所有入站事件先认证、授权和去重，再转换为 Command；
- 同 externalEventId 不同 Payload Hash 必须 Quarantine；
- 群/话题 Binding 不授予群成员业务权限；
- 普通飞书文本/文件不能自动成为 Approval、Release 或 Artifact；
- 外部成功必须有真实 Receipt，Timeout 保持 UNKNOWN；
- Adapter 不保存长期 Capability Token 或共享 Human Credential；
- Replay 不得重复不可控外部副作用。

依赖：位于最外层，只调用业务模块公开 Application Port 和 IdentityPolicy；业务模块不能依赖其 SDK/DTO。它只保存外部协议事实与目标 Core CommandRef，不复制业务权威状态。

持久化边界：Inbound 使用 adapter/account/externalEvent Lookup Hash Claim；敏感标识加密；大 Payload/附件进入对象存储；外部副作用先提交 Attempt/Outbox，再以稳定幂等键执行。

验收锚点：同一飞书附件或卡片回调重复三次只形成一个业务 Command；未绑定用户被拒绝；InformationRequest 可双向闭环；普通文件发送不产生 Formal PublicationReceipt。

### 20.12 同步依赖方向

```text
IdentityPolicy
    ← all business modules use Decision/Query

EnterpriseProject ── Source Slice ──→ TaskExecution
Artifact ────────── immutable Query ─→ TaskExecution / Quality / Release
QualityGovernance ─ readiness Query ─→ TaskExecution / Release
ReleasePublication ─ source Query ───→ TaskExecution

Business Ports ──────────────────────→ IntegrationGateway implementation
```

允许的同步读取不等于允许跨 Schema Join。EnterpriseProject 不同步依赖下游模块来决定状态；它只消费已提交完成事件。IntegrationGateway 可以依赖业务 Port，业务 Domain 不能依赖 IntegrationGateway 内部 DTO。

### 20.13 公开 Contract 与持久化路由

- 完整 Command/Query/Event 名称、版本和唯一 Owner：[`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md)；
- 每模块逻辑表、技术表、RLS 和对象存储边界：[`07-postgresql-logical-model-v0.1.md`](07-postgresql-logical-model-v0.1.md)；
- 跨模块事务、Process Manager、并发、幂等和补偿：[`05-cross-aggregate-consistency-module-boundary-v0.1.md`](05-cross-aggregate-consistency-module-boundary-v0.1.md)；
- 模块级验收和失败场景：[`08-verification-baseline.md`](08-verification-baseline.md)。

---

## 21. Typed Reference 与 Core Contract 摘要

### 21.1 引用强度

```text
ObjectRef
    身份引用

VersionedRef
    精确业务版本

ContentAddressedRef
    精确不可变内容

SnapshotRef
    精确复合视图

EvidenceRef / RepresentationRef / ReleasePackageRef
    特定业务目的的强引用
```

Scope Hint 不作为权限依据；目标模块按 Object Type Registry、存在性、权威 Scope、Hash、Lifecycle、Authorization 和 Purpose 依次验证。

### 21.2 四个 Contract

```text
ProjectContextContract
    ↓ SnapshotRef
WorkOrderContract
    ↓ exact Run binding
AgentResultContract
    ↓ ContentAddressed BusinessOutput
RevisionAcceptanceSnapshot
    ↓
ApprovalBundleSnapshot
    ↓ frozen Release Package
ReleaseReadinessSnapshot
```

每个 Contract 独立版本、不可变并有 Canonical Payload Hash。Contract 校验通过不自动推进下一层业务状态。

### 21.3 公开 Envelope 与 Catalog

七个模块公开 Command、Query 和 Event 使用统一 Envelope，但各自 Contract Version 与 Aggregate Version 完全分离。未知 Major 或 Hash/Scope 冲突必须拒绝/隔离。Catalog 冻结业务名称与唯一所有权，不规定 HTTP Route、Topic 或数据库表。

---

## 22. PostgreSQL Logical Model 摘要

### 22.1 拓扑

```text
one PostgreSQL Database
├── identity_policy
├── enterprise_project
├── task_execution
├── artifact
├── quality_governance
├── release_publication
├── integration_gateway
└── projection              rebuildable, non-authoritative
```

每个权威 Schema 有独立 Repository 和数据库 Role。模块内使用外键和数据库约束；跨模块只保存 Typed Reference 并通过公开 Port 验证。

### 22.2 存储边界

```text
Relational columns
    Scope / State / Version / Concurrency / Hash / Access Path

Canonical JSONB
    immutable Contract payload

Object Storage
    source binary / canonical large content / representation / large diagnostics

Projection
    rebuildable board / trace / search / conversation view
```

Core 采用状态模型加不可变版本/事实，不把 Outbox Event 当成完整 Event Sourcing 源。

### 22.3 一致性与安全

- Aggregate、Command Receipt、Audit、Reference Index 和 Outbox 在同一 owning module 事务提交；
- Inbox + idempotent Command 承担至少一次投递 Replay；
- Enterprise/Project Scope 显式保存并强制 RLS；
- RLS 不替代 Human-only Capability、职责分离和 Aggregate Invariant；
- 受控历史不级联删除；对象存储使用 Staging/Link/Orphan Cleanup；
- Projection 失败不改变权威业务结果。

---

## 23. 未冻结参数与后续业务选择

1. v0.1 已冻结 Enterprise 作为隔离边界；未来出现集团商业账户/多法人需求时，何时引入 CustomerAccount/Tenant；
2. 已冻结：Product 在 v0.1 是 EnterpriseProject 拥有的独立版本化 Aggregate；
3. EnterpriseFact 的类型系统和 Value Schema 如何治理；
4. Issue #57 已冻结 QMSConfiguration 的版本激活和回滚语义；实现前仍需冻结物理字段与事务细节；
5. Issue #57 已冻结 Project 启动必须包含 EnterpriseProfileSnapshot、QMSConfigurationVersion 和 ProductScopeSnapshot；初始 Baseline/Profile 是否存在仍由后续切片决定；
6. CustomerBaseline 的确认角色和哪些低风险材料允许自动确认；
7. Issue #57 已冻结 Template/Regulatory 输入变化先形成精确 Impact Review，不自动全量重跑；具体 Triage UI/算法仍由 WI-08/WI-09 冻结；
8. Issue #57 已冻结 RegulatoryProfile 只能使用精确 Platform Regulatory Reference 和 EvidenceRef，正式确认角色与验证 Provider 由 WI-08 冻结；
9. Issue #57 已冻结 GapAnalysis 的最小 Stale/Impact Policy；分析算法和影响排序仍由 WI-09 冻结；
10. DeliveryItem 与 Artifact 默认一对一是否符合主要业务，以及拆分/合并例外规则；
11. Task、WorkOrder、Run 已完成重试、恢复、取消、超时和过期的模型设计；实现前需冻结默认预算、有效期和重试 Policy；
12. InformationRequest 已确定为正式 Aggregate；实现前需冻结 ExternalParty 身份和各类答案采纳角色；
13. QualityProfile 与 L1—L4 RiskProfile 的映射；
14. Human Approval 已确定为独立 Human 决策；后续需冻结各 ArtifactType 的单人、多角色、多级与职责分离规则；
15. ChangeImpact 已确定为增量 Gate 的强制不可变输入；后续需冻结确定性算法边界；
16. 已解决（2026-08-27）：IM-DG-005 的 Canonical Document/Workbook v0.1 最小范围与 Renderer 路线已批准；具体代码、对象存储参数和人工版式验收仍待对应里程碑实现。
17. 三种 CLI 的最低兼容版本、认证健康探测和默认路由顺序；
18. 飞书群、话题、Task、WorkOrder 和 Runtime Session 的默认绑定策略；
19. 飞书消息撤回、用户离职、群解散和跨项目转发的保留与审计规则；
20. 企业敏感信息进入外部模型的策略；
21. Project Artifact 提升为 Enterprise Controlled Artifact 的角色与时机；
22. 各 Release Purpose 与 EffectiveBinding 的生效、替换和 Recall 规则；
23. 飞书正式 Release 的 Destination 与 Receipt 最小字段；
24. 哪些 Evidence 可由 Service 自动验证，哪些必须专业 Human 验证；
25. PolicyException 是否进入 v0.1；当前建议保留引用边界但不实现通用豁免引擎。
26. UUIDv7、Canonicalization v1 的具体实现库和跨语言 Hash Fixture；
27. 构建期 Contract Schema Registry 的制品发布方式与 Major 并行窗口；
28. Project Context 各 ProjectionType 的字段白名单、内容预算和脱敏规则；
29. Capability namespace 与 Human-only 默认注册表；
30. 哪些 Query 强制 AUTHORITATIVE，哪些允许 Projection；
31. v0.1 不强制服务端数字签名；后续哪些监管/客户场景需要独立签名扩展；
32. Contract Payload Guard、数组上限和 Snapshot 正式保留期限；
33. 已冻结：PostgreSQL 18.6、`btree_gist`/`pg_stat_statements`、Flyway CLI 手写 SQL；RLS Context 具体实现仍待 IM-02 spike；
34. 已冻结 MicroCeph/Ceph RGW + OpenBao、独立 HMAC Lookup Key；精确 Bucket、Legal Hold 和 Orphan Cleanup 参数在 IM-04 冻结；
35. Outbox Transport、分区阈值、PITR/归档与真实性能基准。

---

## 24. 结论

Zhiju Core 的核心价值不是让某个 Agent 更聪明，而是建立一个任何 Human、Agent、模型和 Harness 都必须遵守的业务世界：

```text
我们知道什么
    ↓ Project Context
应该做什么
    ↓ WorkOrder
实际发生了什么
    ↓ Run + AgentResult
什么可以成为正式成果
    ↓ Artifact + Quality Gate + Human Approval + Release
```

这个业务世界必须独立于聊天、文件夹、Harness Memory 和模型选择，并通过模块所有权、一致性边界和可重放事件保持完整。只有这样，制巨才能在保留员工使用习惯的同时，实现客户隔离、长期企业知识、受控文档、法规追溯、多模型协作、成本治理和持续 QMS 服务。

## 25. IM-03 WI-01 前置对象入口决策

Issue #57 的 [`Contract-Decision-Matrix.md`](../decisions/enterprise-project-capabilities.md) 进一步冻结了 EnterpriseProject 在进入业务实现前的入口边界：

- Product、QMSConfiguration、EnterpriseProfileSnapshot 和 ProductScopeSnapshot 由 EnterpriseProject Application 层产生；Root、Revision、Version 和 Snapshot 通过精确引用关联，不能由测试/Migration 直接写业务表。
- Platform Template/Regulatory Reference 属于独立 Platform Reference 数据面，无 Enterprise Scope；只允许 Reference Admin/Publisher 导入和发布，Enterprise Runtime 只能读取已发布的精确 ContentAddressedRef。
- ProjectStartSnapshot 必须包含同一 Enterprise 的 EnterpriseProfileSnapshot、QMSConfigurationVersion 和 ProductScopeSnapshot；不得使用 `latest`、display label 或隐式 current pointer 代替业务版本。
- Gap 输入变化只产生 `STALE` 与 Impact Review 事实，不覆盖旧 Gap、Context、Plan 或 Artifact。QualityProfile/Evidence 等 IM-05 对象只通过强引用验证，EnterpriseProject 不跨 Schema Join 或拥有其正文。
- 这些入口是受控 Application Capability，暂不增加当前 200 项公开 Catalog；公共化需要单独的 Contract 兼容性和用户审核 Gate。本文的架构决策不等于业务 DDL、Repository 或 Handler 已实现。

## 26. IM-03 WI-08 受控 Platform Reference 与 Project Freeze 边界

WI-08 将 Issue #57 中的 Platform Reference 入口具体化为 EnterpriseProject 内的受控 Application Capability：Reference Admin/Publisher 通过独立 writer role 导入和发布无 Enterprise Scope 的模板/法规版本；Enterprise Runtime 只能读取已发布的精确 hash ref。writer 所使用的保留技术 Scope 仅服务于 RLS Context、Receipt、Audit、Outbox 和 Reference Edge，不代表任何业务 Enterprise。

TemplateBaseline 和 RegulatoryProfile 是 Project-owned immutable version chains。Human 请求必须在可信事务 Context 中完成，Root expected aggregate version CAS 是唯一指针推进机制；新 Platform 版本不会隐式改变旧 Project。模板只能作为 TemplateSelection，不能作为 Regulatory Evidence；监管适用性项目的 Evidence 必须是独立受控引用。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工验收不随本实现自动提升为 `PASS`。

## #229 有限恢复的 owning Port 路由（提案）

状态：`T2 DESIGN ONLY / DESIGN APPROVED / HUMAN DESIGN APPROVED 2026-09-27 / NOT IMPLEMENTED`。[决定§23](../decisions/task-execution-human-operated.md#23-blocked_input-恢复设计闭合提案229)仅细化已有TaskExecution→IdentityPolicy/EnterpriseProject/IntegrationGateway授权读取及受控Runtime路径，不改变七模块职责/数据所有权。TE拥有Request/Answer/Resolution、新Context/Run及独立Task/WorkOrder协调；EP以窄candidate/Source和confirmation Receipt Ref内部Port补齐当前读取缺口，正式证明继续使用已发布Receipt Query；IP拥有历史Decision证明/当前Human资格与新Bundle；IG拥有两次真实invocation/ack/final来源。新增公开读取仅为TE owning state，完整边界见Spec003§24.7；不读Board作执行资格，不共享Repository、跨Schema写或新建工作流引擎。实施和独立审批状态仍分开。


## #237 TaskCompleted 派发与 DeliveryItem 的 owning 路由（提案）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-01 / DESIGN REVIEW PASSED / IMPLEMENTED IN #239 PROPOSED REVISION / RUNTIME EVIDENCE IN MODULE-TEST`。TE拥有已提交TaskCompleted的窄Dispatcher、Project游标/immutable binding/lease与确认；EP拥有Inbox/FormalFact/精确Task-Item-Version关联、新profile/@2.0独立Evaluation及内部authoritative Readback；IP提供分别授权的静态composition映射。字段唯一见Spec003 §26、Spec002 §23、Spec001 §15.16和PostgreSQL §41；概要见[决定](../decisions/task-completed-delivery-completion.md)。

应用composition顺序调用TE owning已提交材料Port和EP owningConsumer，不共享Repository/事务、不令EP同步回查TE。sidecar不成为公共TaskCompleted字段，不建立新反向同步依赖。EP结论是已消费历史Task完成满足其冻结标准，TE当前USABLE未知；没有Task invalidation事件闭环时禁止把此结论提升为执行/审批/发布资格。Release要求仍独立满足。首版使用真实controlledDriver的owning链，不新增Runtime交付目标/通用Workflow/Event框架；七模块所有权不变。

## D14 / RD-01 模块协作提案

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`，见 [Delta](../decisions/d14-rd01-first-customer-flow.md)。EP 拥有 PREPARING Project/ScopeClaim、SourceMaterial、准备来源切片、accepted report/候选/计划和 Human 决定/一次 start；IP 拥有当次授权；TE 拥有独立 PreparationContext、分析 Task/WO/Run/Result 与初轮 scope 事实；IG/Runtime 拥有 ZIP 传输/安全解包、受控物化、原 invocation/raw observations；UI/BFF 只调用公开能力和呈现。Quality 的真实 Evidence capture/verify/get 按既有合同复用，原 source alias 不伪装 EvidenceRef。七模块不变，EP Process 协调多 Root 而不共享 Repository/跨 Schema Join；原件/模板只读、commit 后副作用、权限分离和 owner Completion 保持。
