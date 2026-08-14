# Zhiju Core 跨 Aggregate 一致性与协作基准 v0.1

版本：v0.1
日期：2026-08-12
状态：`CURRENT CONSISTENCY BASELINE / IMPLEMENTATION NOT STARTED`

文档角色：Reference Project、跨 Aggregate 事务、Process Manager、并发、幂等、Replay、补偿和 Read Model 一致性的唯一权威。模块职责和所有权只在 `02` 维护，本文只描述模块如何协作。

## 1. 文档目标

本文承接 [`04-domain-model-v0.1.md`](./04-domain-model-v0.1.md)，使用完整业务案例验证三个主域之间的一致性，并冻结跨 Aggregate 命令、事件、事务、Process Manager、并发、幂等和逻辑模块协作边界。

本文不映射数据库、ORM、REST、MCP Tool、飞书事件 JSON、Renderer 或 Runtime Adapter 代码。

---

## 2. 当前基准原则

### 2.1 一致性原则

1. 一个 Command 只能有一个 Aggregate Root 写入所有者。
2. 默认一个 Aggregate Root 对应一个同步事务边界。
3. 事务内只维护该 Aggregate 自身 Invariant，不在事务中直接修改其他 Aggregate。
4. 跨 Aggregate 推进通过已提交 Domain Event、显式 Command 和 Process Manager 完成。
5. Process Manager 可以决定下一步，但不能绕过目标 Aggregate 的权限和 Invariant。
6. 跨模块流程不依赖分布式事务；失败通过重试、补偿、影响评估或 Human Intervention 处理。
7. Projection、Task Board、飞书消息状态和 Agent 自报状态都没有业务写入权。
8. 历史业务事实不可回滚删除；补偿通过新 Command、新状态和关联事件表达。
9. 所有跨模块引用使用精确 ID、Version 和必要 Hash，不使用 `latest`。
10. 外部副作用必须在业务事务提交后执行，且具备稳定幂等键、逐次尝试和真实回执。

### 2.2 部署原则

v0.1 采用模块化单体：

```text
One deployable application
One coherent authorization boundary
Logical module ownership
Module-local write models
Public application ports
Versioned domain events
Shared infrastructure, not shared domain ownership
```

逻辑模块不是微服务。第一版不引入：

- 网络内部分布式调用；
- 跨服务分布式事务；
- 每个 Aggregate 独立部署；
- 通用 Workflow Engine；
- 事件溯源作为全系统强制持久化方式。

模块划分的目的，是先冻结所有权、依赖方向和测试边界，为后续实现保持清晰，而不是增加运维复杂度。

---

## 3. Reference Project：采购控制程序修订与交付

### 3.1 业务场景

Enterprise `ENT-001` 委托制巨在 Project `PRJ-2026-014` 中修订《采购控制程序》。客户通过已绑定项目群上传现行 PDF，但资料中没有明确供应商风险分类和复评频率。项目需要：

1. 识别并确认客户当前程序；
2. 对照冻结的制巨模板与适用法规形成 GapAnalysis；
3. 批准“修订采购控制程序”的 DeliveryItem；
4. 由 Agent 起草，但在信息不足时通过飞书向授权 Human 请求输入；
5. 对 Revision 执行结构、业务规则、Evidence、语义与渲染检查；
6. 整改 ReviewIssue 并由独立 Reviewer 验证；
7. 由 Human 完成质量和项目审批；
8. 通过正式 Release 将 DOCX/PDF 交付到客户飞书项目群；
9. 客户交付完成不自动将该 Revision 设为企业内部有效版本。

### 3.2 参与者

```text
Customer Quality Manager
    外部回答者；仅能回答被授权的 InformationRequest

Zhiju Project Owner
    确认材料、批准 DeliveryPlan、完成项目审批

Zhiju Quality Reviewer
    验证 Evidence、ReviewIssue 和质量审批要求

Zhiju Quality Owner
    满足 Quality Owner Approval Requirement；不参与该 Revision 的起草

Writer Agent
    在 WorkOrder Capability 内起草 Revision

Reviewer Agent
    执行 Profile 允许的 Semantic Review；不能 Human Approval

Feishu Channel Adapter
    身份和消息转换、文件收取、卡片投递、正式发布执行

Runtime Adapter
    投递 WorkOrder、维护 Run、收集 Usage/Provenance、提交 AgentResult

Zhiju Core Modules
    拥有全部正式业务状态与规则
```

### 3.3 精确对象链

```text
ENT-001
└── PRJ-2026-014
    ├── SM-001    customer-procurement-procedure.pdf
    ├── CM-001    CUSTOMER_PROCEDURE / PROCUREMENT
    ├── CB-003    active CustomerBaseline version
    ├── TB-002    frozen TemplateBaseline version
    ├── RP-004    active RegulatoryProfile version
    ├── GA-005    accepted GapAnalysis
    ├── DP-002    active DeliveryPlan version
    └── DI-017    修订并正式交付《采购控制程序》

DI-017
├── TASK-101 / WO-201 / RUN-301
├── IR-401 / AnswerSubmission AS-402 / Resolution IRR-403
├── RUN-302 / AgentResult AR-303
├── ART-023
│   ├── REV-001 imported baseline
│   ├── REV-002 agent draft
│   └── REV-003 remediated revision
├── GateResults GR-501..GR-510
├── ReviewIssues RI-601 / RI-602
├── Approvals AP-701 / AP-702
└── Release REL-801 CUSTOMER_DELIVERY
```

这些 ID 只用于验证关系，不规定最终编号格式。

---

## 4. Phase A：飞书资料接收与客户基线

### 4.1 正常流程

```text
Feishu Inbound Event
    ↓ IntegrationGateway
authenticate_channel_principal
resolve_project_binding
deduplicate_inbound_event
    ↓ EnterpriseProject Command
register_source_material
    ↓
SourceMaterialRegistered
    ↓ 文件安全、Checksum、保管链校验
accept_source_material
    ↓
SourceMaterialAccepted
    ↓ MaterialIntakeProcess
request_customer_material_classification
    ↓ Parser/Agent proposal
propose_customer_material
    ↓ Human confirmation
confirm_customer_material
    ↓
CustomerMaterialConfirmed
    ↓
create_customer_baseline_draft
confirm_customer_baseline_version
activate_customer_baseline_version
```

### 4.2 一致性检查点

| 检查点 | 权威对象 | 不允许的跳跃 |
|---|---|---|
| 飞书附件已接收 | Integration InboundEnvelope + SourceMaterial | 不自动创建 CustomerMaterial |
| 文件安全并完整 | SourceMaterial | 不自动确认业务分类 |
| 业务类型已识别 | CustomerMaterial | 不表示客户资料齐全 |
| 客户现状已确认 | CustomerBaselineVersion | 不自动创建 Gap 或 DeliveryItem |

### 4.3 重复和冲突

- 相同飞书消息重复投递：`im.message.receive_v1` 按 `app + tenant + messageId` Claim，IntegrationGateway 只发起一次 `register_source_material`；`eventId` 只保留为投递观察，不作为该消息事件的业务去重键。
- 相同字节来自不同消息：保留不同 SourceMaterial 来源，使用 `duplicateOf` 关联，不吞掉保管链。
- 同一客户文件被提出两个冲突分类：CustomerMaterial 进入 DISPUTED，等待 Human 解决。
- 文件消息撤回：记录来源撤回，不物理删除已接收内容；是否继续使用由保留 Policy 决定。
- Baseline 激活后新材料到达：创建新 Draft Baseline，不修改 CB-003。

---

## 5. Phase B：GapAnalysis、DeliveryPlan 与交付承诺

### 5.1 输入冻结

GapAnalysis `GA-005` 必须绑定：

```text
EnterpriseProfileSnapshot EPS-001
QMSConfigurationVersion QMS-004
CustomerBaselineVersion CB-003
TemplateBaselineVersion TB-002
RegulatoryProfileVersion RP-004
AnalysisPolicyVersion GAP-POL-001
```

任何输入更新都不会修改 GA-005，只会使其进入 STALE 或触发 Impact Review。

### 5.2 正常流程

```text
all required snapshots ready
    ↓
start_gap_analysis
    ↓
GapAnalysisCompleted
    ↓ Human
accept_gap_analysis
    ↓
GapAnalysisAccepted
    ↓ DeliveryPlanningProcess
create_delivery_plan_draft
add_delivery_item DI-017
submit_delivery_plan_for_approval
    ↓ Human
approve_delivery_plan
activate_delivery_plan
    ↓
DeliveryItemActivated
```

DI-017 的 CompletionCriteria 示例：

```text
requiredArtifactType = PROCEDURE
requiredQualityProfile = QMS_PROCEDURE_HIGH@3
requiredApprovalRequirements = [QUALITY_OWNER, PROJECT_OWNER]
requiredReleasePurpose = CUSTOMER_DELIVERY
requiredRepresentations = [DOCX, PDF]
```

### 5.3 跨 Aggregate 规则

1. GapAnalysisAccepted 只能触发 DeliveryPlan Draft Proposal，不能自动批准计划。
2. DeliveryPlan 激活后，DeliveryItem 才可进入 Task 规划。
3. DeliveryItem 只保存 CompletionCriteria 和正式对象引用，不嵌入 Task/Artifact/Release 状态副本。
4. 新 Baseline 使 GA-005 STALE 时，DP-002 不被自动撤销；创建 `DeliveryPlanImpactReviewRequested`。
5. 已批准范围的修改必须形成新 DeliveryPlanVersion。

---

## 6. Phase C：Task、WorkOrder、Run 与 InformationRequest

### 6.1 创建执行工作

```text
DeliveryItemActivated DI-017
    ↓ DeliveryExecutionProcess
propose_task
    ↓ Policy/Human accepts
create_task TASK-101
prepare_task
mark_task_ready
    ↓
create_work_order WO-201
freeze_work_order_specification
queue_work_order
    ↓ WorkExecutionProcess
create_run RUN-301
build_context_snapshot CTX-301
issue_run_capability
dispatch_run
```

WO-201 只能授权：

```text
artifact.create_or_revise ART-023
artifact.allowedSections = [supplier classification, evaluation, re-evaluation]
evidence.propose
information_request.propose
review_issue.propose
```

明确禁止：

```text
artifact.approve
release.authorize
customer_baseline.confirm
delivery_plan.approve
```

### 6.2 信息不足

RUN-301 在起草时发现客户供应商风险分类与复评频率未知。Runtime 提交 final AgentResult：

```text
outcome = BLOCKED_INPUT
inputRequestProposal =
  question: 供应商是否按风险分级，复评频率分别是什么？
  expectedResponderRole: CUSTOMER_QUALITY_MANAGER
  blocking: true
```

处理链：

```text
AgentResultAccepted AR-301
    ↓ ResultProcessor
create_information_request IR-401
    ↓
InformationRequestOpened
    ↓ IntegrationGateway
deliver_information_request_to_feishu
    ↓ Customer Quality Manager
submit_answer AS-402
    ↓ IdentityPolicy + TaskExecution
validate_answer_authority
resolve_information_request IRR-403
    ↓
InformationRequestResolved
    ↓
build_context_snapshot CTX-302
evaluate_execution_recovery
```

因为 RUN-301 已提交 final AgentResult，不能恢复同一个 Run。Process Manager 必须：

```text
create_run RUN-302
attemptNumber = 2
new ContextSnapshot = CTX-302
new Capability Token
same frozen WorkOrder specification
```

### 6.3 执行完成边界

RUN-302 返回 AgentResult AR-303，并引用正式业务输出 `ART-023/REV-002`：

```text
Run SUCCEEDED
= AR-303 的身份、Schema、Scope 和引用被接受

WorkOrder COMPLETED
= REV-002 存在且满足 WO-201 ExpectedOutput

Task COMPLETED
= “形成可进入质量 Review 的采购程序 Revision”这一业务目标满足

DeliveryItem NOT COMPLETED
= 尚无 Gate、Issue Verification、Approval 和 CUSTOMER_DELIVERY Release
```

执行成功不能跨越质量和交付边界。

---

## 7. Phase D：Revision、Quality Gate 与 ReviewIssue

### 7.1 Revision 创建

ART-023 的版本链：

```text
REV-001
origin = CM-001 / customer baseline
contentType = OPAQUE_IMPORTED_CONTENT or normalized initial structure
approved = false

REV-002
parent = REV-001
origin = WO-201 / RUN-302 / AR-303
contentHash = HASH-REV-002
status = SEALED
```

Artifact 模块提交 `ArtifactRevisionSealed` 后，QualityGovernance 才开始正式评估。AgentResult 中出现临时 DOCX 不能替代这个事件。

### 7.2 Gate Plan

QualityProfile `QMS_PROCEDURE_HIGH@3` 解析为：

```text
REVISION_ACCEPTANCE:
G1 STRUCTURAL_SCHEMA
G2 BUSINESS_RULE              depends on G1
G3 EVIDENCE_EXISTENCE         depends on G1
G4 EVIDENCE_ENTAILMENT        depends on G3
G5 SEMANTIC_REVIEW            depends on G1, G2, G4

RELEASE_READINESS:
G6 RENDER_VALIDATION          targets exact Representation/Package
```

REV-002 第一轮结果：

```text
G1 PASS
G2 FAIL  → RI-601：复评周期逻辑与客户确认答案不一致
G3 FAIL  → RI-602：法规性主张缺少精确 EvidenceLink
G4 SKIPPED (reason=DEPENDENCY_NOT_SATISFIED)
G5 SKIPPED (reason=DEPENDENCY_NOT_SATISFIED)
```

G6 尚未进入适用阶段，因此没有 GateResult，即 `NOT RUN`。SKIPPED 必须按 Profile 记录合法 Result 和原因，不能只在 UI 中省略。

### 7.3 整改

```text
BlockingReviewIssueRaised RI-601 / RI-602
    ↓ IssueRemediationProcess
propose_remediation_task
    ↓ Human/Policy accepts
TASK-102 → WO-202 → RUN-303
    ↓
create_and_seal_revision REV-003
parent = REV-002
    ↓
propose_issue_resolution
request_issue_verification
```

REV-003 不自动关闭 RI-601/RI-602。

### 7.4 重跑与增量复用

ChangeImpact `CI-003` 必须证明：

```text
baseRevision = REV-002
targetRevision = REV-003
changedUnits = [supplier re-evaluation clause, evidence link block]
affectedRevisionAcceptanceGates = [G2, G3, G4, G5]
```

G1 是否复用由 Profile 决定。即使允许复用，也必须为 REV-003 创建新 GateResult，并引用 REV-002 的 G1 Result 与 CI-003。G2-G5 按影响重新执行。G6 在 Release 准备出精确 Representation 后单独执行，不参与 Revision 内容审批前的 Readiness。

当全部 Mandatory `REVISION_ACCEPTANCE` Gate PASS 后：

```text
verify_issue_resolution RI-601 against REV-003
verify_issue_resolution RI-602 against REV-003
close_review_issue
    ↓
RevisionQualityReady
```

`RevisionQualityReady` 是可重算 Readiness 事实，不等于 Human Approval。

---

## 8. Phase E：Human Approval、Release 与 Delivery Completion

### 8.1 Approval

Profile 要求两个审批槽位：

```text
QUALITY_OWNER_APPROVAL
PROJECT_OWNER_APPROVAL
```

审批链：

```text
RevisionQualityReady REV-003
    ↓ ApprovalReadinessProcess
request_approval QUALITY_OWNER
request_approval PROJECT_OWNER
    ↓ Human decisions
AP-701 APPROVED by Quality Owner
AP-702 APPROVED by Project Owner
    ↓ ApprovalEvaluator
RevisionFullyApproved REV-003
```

两个 Approval 均绑定：

```text
revisionId = REV-003
contentHash = HASH-REV-003
qualityProfile = QMS_PROCEDURE_HIGH@3
gateBundleSnapshot = exact valid results
issueSnapshot = no open blocking issue
approver role and authorization snapshot
```

### 8.2 Release

```text
RevisionFullyApproved REV-003
    ↓ ReleaseReadinessProcess
create_release_draft REL-801
purpose = CUSTOMER_DELIVERY
representations = [DOCX, PDF]
destinations = [customer project Feishu group, controlled Workspace link]
    ↓ Renderer
register exact representation checksum + rendererVersion
prepare_release
freeze packageHash / recipient / destination
    ↓ ReleasePrepared
G6 RENDER_VALIDATION
Target = exact representation checksum + rendererVersion + packageHash
    ↓ ReleaseGateReady
validate_release_readiness
    ↓ Human Project Owner
authorize_release
    ↓ PublicationProcess
publish frozen package
record destination receipts
complete_release
```

飞书发布必须由 REL-801 驱动，回执至少能证明：

```text
releaseId
destinationRef
recipientScopeSnapshot
message/file reference
packageHash
representation checksums
publishedAt
attemptId
```

### 8.3 DeliveryItem Completion

`ReleaseCompleted(REL-801)` 触发 EnterpriseProject 的 DeliveryCompletionProcess 重算 DI-017：

```text
requiredArtifactType satisfied by ART-023
requiredQualityProfile satisfied for REV-003
requiredApprovals satisfied by AP-701/AP-702
requiredReleasePurpose satisfied by REL-801
requiredRepresentations and receipts present
    ↓
DeliveryItemCompletionSatisfied
```

### 8.4 不自动生效

REL-801 的 purpose 是 CUSTOMER_DELIVERY，因此：

```text
DeliveryItem COMPLETED
Revision RELEASED to customer
Artifact internal EffectiveBinding UNCHANGED
```

如果客户后来正式批准内部生效，必须形成新的授权业务输入，并创建独立 `INTERNAL_EFFECTIVE_USE` Release。不能把客户收件回执解释成其内部 QMS 已生效。

---

## 9. 跨域状态与 Completion 一致性

### 9.1 权威状态矩阵

| 层级 | 权威对象 | “完成/有效”的精确定义 | 不能由什么替代 |
|---|---|---|---|
| Channel delivery | DeliveryAttempt/Receipt | 渠道真实接收或发布成功 | Domain Command 成功 |
| Run | Run + accepted AgentResult | 一次 Runtime 尝试终结且结果被接受 | Harness exit code、自然语言 summary |
| WorkOrder | WorkOrder CompletionEvaluator | 冻结 ExpectedOutput/Criteria 满足 | Run SUCCEEDED |
| Task | Task CompletionEvaluator | 业务 Objective 和必要工作满足 | WorkOrder COMPLETED、看板拖到 DONE |
| DeliveryItem | DeliveryItem CompletionEvaluator | 计划要求的 Artifact、Gate、Approval、Release 满足 | Task COMPLETED、Artifact 存在 |
| Revision quality | Quality Readiness Projection | Mandatory REVISION_ACCEPTANCE Gate 有效且无 Blocking Issue | Agent 自评、单个 Gate PASS、Render Gate |
| Revision approval | Approval Evaluator | 所有 Approval Requirement 有效 | Human 聊天回复、QualityReady |
| Release | Release Aggregate | 冻结 Package 在目标 Destination 获得要求回执 | 导出文件、飞书普通上传 |
| Effective version | Artifact EffectiveBinding | 指定 purpose 的已授权 Release 在有效期内 | Approved、Released、latest Revision |

### 9.2 派生状态规则

1. CompletionEvaluator 只读取正式对象和精确版本引用。
2. 派生状态可重算，不允许 Human/Agent 直接设置 `completed=true`。
3. 依赖事实失效时，当前 Readiness/Completion Projection 可以变化，但历史事件不被删除。
4. DeliveryItem 已完成后上游失效不会抹去历史完成事实；系统创建 Impact Review、Recall 或 Corrective Task，并显示当前风险状态。
5. Projection 延迟不能改变写入真相；UI 必须能显示“处理中/尚未投影”，不能猜测成功。

### 9.3 Reference Project 状态时间线

| 时点 | Run | WorkOrder | Task | Revision | Approval | Release | DeliveryItem |
|---|---|---|---|---|---|---|---|
| RUN-301 blocked input | SUCCEEDED at execution boundary | WAITING_INPUT | WAITING_INPUT | 无新正式 Revision | 无 | 无 | IN_PROGRESS |
| IR-401 resolved | 历史不变 | READY/RETRY_PENDING | IN_PROGRESS | 无新正式 Revision | 无 | 无 | IN_PROGRESS |
| REV-002 sealed | RUN-302 SUCCEEDED | COMPLETED | COMPLETED or REVIEW transition per Task type | DRAFT/UNDER_REVIEW | 无 | 无 | IN_REVIEW |
| Gate FAIL | 历史不变 | 历史不变 | Remediation Task active | CHANGES_REQUIRED projection | 无 | 无 | IN_REVIEW |
| REV-003 gates pass/issues close | Remediation Run complete | Remediation WO complete | Remediation Task complete | QUALITY_READY | 待审批 | 无 | IN_REVIEW |
| AP-701/AP-702 effective | 历史不变 | 历史不变 | Release Task ready | FULLY_APPROVED | 有效 | Draft/Prepared | APPROVED_OUTPUT |
| REL-801 completed | 历史不变 | 历史不变 | Release Task complete | APPROVED | 有效 | RELEASED | COMPLETED |
| 新 REV-004 Draft | 新任务可开始 | 新 WO 可开始 | 新 Task active | REV-004 DRAFT；REV-003 不变 | REV-003 Approval 保留 | REL-801 保留 | 历史 Completion 保留 |

---

## 10. Command 所有权

### 10.1 规则

Command 名称表达业务意图，不表达数据库更新。每个 Command 必须包含：

```text
commandId
commandType
commandVersion
targetAggregateId
expectedAggregateVersion?
enterpriseId
projectId?
actorPrincipal
authorizationContextRef
correlationId
causationId?
idempotencyKey
payload
requestedAt
```

Command Handler 只能写入目标 Aggregate 和同一事务内的 Outbox Record。其他模块状态必须等待已提交 Event 后再推进。

### 10.2 核心 Command Owner 矩阵

| Command 组 | 唯一所有模块 | 目标 Aggregate | 主要触发方 |
|---|---|---|---|
| authenticate/authorize/issue capability | IdentityPolicy | Principal/Grant/PolicySnapshot | 所有 Application Service |
| create/update Enterprise facts/profile/QMS | EnterpriseProject | Enterprise 相关 Aggregate | Human/Core Service |
| register/accept SourceMaterial | EnterpriseProject | SourceMaterial | IntegrationGateway/Material Service |
| propose/confirm CustomerMaterial | EnterpriseProject | CustomerMaterial | Agent/Human |
| draft/activate CustomerBaseline | EnterpriseProject | CustomerBaseline | Human/Process Manager |
| freeze TemplateBaseline/activate RegulatoryProfile | EnterpriseProject | 对应 Aggregate | 专业 Human |
| start/accept GapAnalysis | EnterpriseProject | GapAnalysis | Human/Agent Service |
| draft/approve/activate DeliveryPlan | EnterpriseProject | DeliveryPlan | Human |
| create/transition Task | TaskExecution | Task | Human/Coordinator/Process Manager |
| create/freeze/queue WorkOrder | TaskExecution | WorkOrder | Human/Coordinator |
| create/start/cancel/retry Run | TaskExecution | Run | Dispatcher/ExecutionPolicy |
| submit/process AgentResult | TaskExecution | AgentResult | Runtime Adapter/Result Processor |
| open/accept answer/resolve InformationRequest | TaskExecution | InformationRequest | Runtime/Human/Integration |
| create Artifact/move working head | Artifact | Artifact | Human/authorized Agent |
| create/seal/merge/withdraw Revision | Artifact | ArtifactRevision | Human/authorized Agent |
| establish/supersede EffectiveBinding | Artifact | Artifact | Release policy event handler |
| capture/verify/revoke Evidence | QualityGovernance | Evidence | Agent/Human/Service |
| create/activate QualityProfile | QualityGovernance | QualityProfile | Quality Human |
| record/invalidate GateResult | QualityGovernance | GateResult | Gate Orchestrator/Governance Human |
| raise/resolve/verify/close ReviewIssue | QualityGovernance | ReviewIssue | Reviewer/Writer/Human |
| submit/revoke Approval | QualityGovernance | Approval | authorized Human |
| create/prepare/authorize Release | ReleasePublication | Release | Human/Release Service |
| record PublicationAttempt/Receipt/Recall | ReleasePublication | Release | IntegrationGateway/Publishing Service |
| receive/deduplicate Channel/Runtime event | IntegrationGateway | InboundEnvelope | Feishu/Runtime |
| deliver message/file/work order | IntegrationGateway | DeliveryAttempt | Domain Process Manager |
| record InformationRequest delivery outcome | TaskExecution | InformationRequest DeliveryRecord | Integration Receipt Handler |

### 10.3 禁止的写入路径

```text
IntegrationGateway → direct UPDATE Task/Approval/Release
TaskExecution → direct UPDATE ArtifactRevision
QualityGovernance → direct UPDATE Artifact/DeliveryItem
ReleasePublication → direct UPDATE Approval/GateResult
EnterpriseProject → direct UPDATE Task/Release
Projection → any Domain Aggregate write
Agent/Runtime → any storage write bypassing Core Command
```

跨模块业务动作必须调用目标模块公开 Command Port；调用者不持有目标 Repository。

---

## 11. Domain Event Contract

### 11.1 Event Envelope

所有跨 Aggregate/模块事件使用统一 Envelope：

```text
eventId
eventType
eventVersion
occurredAt
producerModule
aggregateType
aggregateId
aggregateVersion
enterpriseId
projectId?
correlationId
causationId
commandId
actorRef
dataClassification
payloadHash
traceId
payload
```

约束：

1. Event 表示已经提交的事实，名称使用过去式。
2. Event Payload 创建后不可修改。
3. Event 至少一次投递，Consumer 必须幂等。
4. 只保证同一 Aggregate 的版本顺序，不承诺跨 Aggregate 全局顺序。
5. Consumer 遇到版本间隙时暂停该 Aggregate 的消费并请求重放/修复，不猜测中间状态。
6. Event 不携带大文件、完整敏感文档、Capability Token 或不必要个人信息；使用受权限保护的精确引用。
7. Schema 变化通过 eventVersion 和兼容策略管理，不复用旧语义名称。

### 11.2 跨模块关键事件

| Producer | Event | 主要 Consumer | 业务用途 |
|---|---|---|---|
| EnterpriseProject | SourceMaterialAccepted | MaterialIntakeProcess | 发起分类 |
| EnterpriseProject | CustomerBaselineVersionActivated | BaselineImpactProcess、ContextProjection | 影响分析和新 Context |
| EnterpriseProject | DeliveryItemActivated | DeliveryExecutionProcess | 提议/创建 Task |
| TaskExecution | InformationRequestOpened | IntegrationGateway | 飞书投递 |
| IntegrationGateway | ChannelAnswerReceived | TaskExecution | 创建 AnswerSubmission |
| TaskExecution | InformationRequestResolved | WorkExecutionProcess | 新 Context 与 Resume/Retry 决策 |
| TaskExecution | AgentResultAccepted | ResultProcessor | 验证 BusinessOutput 与 Proposal |
| Artifact | ArtifactRevisionSealed | QualityEvaluationProcess、TaskCompletionEvaluator | 开始 Gate、判断 ExpectedOutput |
| QualityGovernance | BlockingReviewIssueRaised | IssueRemediationProcess、Task Board | 创建整改工作候选 |
| QualityGovernance | RevisionQualityReady | ApprovalReadinessProcess | 发起 Human Approval |
| QualityGovernance | RevisionFullyApproved | ReleaseReadinessProcess、DeliveryCompletionProcess | 允许准备 Release |
| QualityGovernance | RevisionApprovalLost | ReleaseImpactProcess | 阻止未授权发布/评估 Recall |
| ReleasePublication | ReleasePrepared | ReleaseGateEvaluationProcess | 对冻结 Package 执行 RELEASE_READINESS Gate |
| QualityGovernance | ReleaseGateReady | ReleaseReadinessProcess | 允许进入 Release Authorization 校验 |
| ReleasePublication | ReleaseAuthorized | PublicationProcess | 执行外部发布 |
| ReleasePublication | ReleaseCompleted | DeliveryCompletionProcess、EffectiveBindingProcess | 完成交付/按 purpose 生效 |
| ReleasePublication | ReleaseRecalled | DeliveryImpactProcess、EffectiveBindingProcess | 终止/替换有效绑定和纠正行动 |
| Artifact | EffectiveBindingChanged | EnterpriseProfileProjection、Traceability | 更新企业有效成果视图 |

### 11.3 Event 与通知分离

Domain Event 不是用户通知。示例：

```text
InformationRequestOpened
    ↓ Notification Policy
OutboundMessageRequested
    ↓ IntegrationGateway
Feishu DeliveryAttempt
```

飞书投递失败只产生 `ChannelDeliveryFailed`，不能把 `InformationRequestOpened` 回滚为不存在。Process Manager 根据重试 Policy 或 Human Intervention 处理。

---

## 12. 事务边界

### 12.1 单 Aggregate 同步事务

每个 Command 的基本事务：

```text
load one target Aggregate at expectedVersion
authorize command
validate invariant
apply state transition
append domain event(s)
persist Aggregate + Outbox atomically
commit
```

可在同一事务内写入：

- 目标 Aggregate 的 Entity/Value Object；
- 目标 Aggregate 的版本；
- 与该状态变化同源的 Domain Event/Outbox；
- 必要的唯一性 Claim，前提是它属于同一模块并由该 Aggregate 负责。

不得在同一业务事务内写入：

- 其他模块的 Aggregate；
- 飞书、Runtime、Renderer 或外部存储状态；
- Projection 作为成功判据；
- 多个独立 Aggregate 以模拟跨域原子性。

### 12.2 Aggregate 内需要承载的强一致性

| Invariant | 承载位置 |
|---|---|
| 同 WorkOrder 默认最多一个 active Run | WorkOrder 的 activeRun reservation 或 TaskExecution 模块内受该规则控制的 Lease Aggregate |
| 一个 Run 只有一个 final AgentResult | Run finalResultRef / submission claim |
| Artifact 相同 Branch 只有一个 working head | Artifact Aggregate |
| 同 purpose EffectiveBinding 不重叠 | Artifact Aggregate |
| Active QualityProfile Version 不可修改 | QualityProfile Aggregate |
| Approval Decision Payload 不可变 | Approval Aggregate |
| Release PREPARED 后 Package 冻结 | Release Aggregate |
| 相同 Destination/Package 发布幂等 | Release PublicationAttempt Entity |

如果 Invariant 无法在一个 Aggregate 内可靠维护，应调整 Aggregate 边界或引入显式 Reservation/Claim，而不是依赖“先查后写”。

### 12.3 跨 Aggregate 最终一致性

以下事实允许短暂传播延迟：

- DeliveryItem 对 Task/Artifact/Release 的 Completion Projection；
- Task Board 状态；
- Revision Quality Readiness；
- Revision Fully Approved Projection；
- EnterpriseProfile 中的 Effective Artifact 视图；
- 审计检索和 Traceability Graph；
- 飞书通知状态。

UI 必须区分：

```text
AUTHORITATIVE
PROCESSING
STALE_PROJECTION
FAILED_TO_PROPAGATE
```

不能在 Projection 尚未更新时自行推断成功。

---

## 13. Process Manager 与 Saga

### 13.1 定义

v0.1 的 Process Manager 是特定业务流程状态机，不是通用 Workflow DSL。它保存：

```text
processId
processType
processVersion
enterpriseId
projectId?
correlationId
currentState
trackedObjectRefs[]
lastProcessedEventIds[]
pendingCommands[]
retryPolicy
deadline?
failureReason?
humanInterventionRef?
```

Process Manager 只发 Command，不直接写目标 Aggregate。

### 13.2 核心 Process Manager

| Process | Owner Module | Trigger | 成功条件 | 失败/补偿 |
|---|---|---|---|---|
| MaterialIntakeProcess | EnterpriseProject | SourceMaterialAccepted | CustomerMaterial 已确认或明确拒绝 | 分类冲突转 Human Review；不删除 SourceMaterial |
| BaselineImpactProcess | EnterpriseProject | Baseline/Profile/Template 更新 | 受影响对象完成 Impact Triage | 标记 STALE、创建 Review；不改写旧 Plan/Artifact |
| DeliveryExecutionProcess | EnterpriseProject | DeliveryItemActivated | Task 创建或 Human 决定无需 Task | 创建失败可重试；范围冲突转项目负责人 |
| WorkExecutionProcess | TaskExecution | WorkOrderQueued/RequestResolved/RunFailed | WorkOrder Completion 或终止 | 新 Run Retry；不修改旧 Run |
| InformationRecoveryProcess | TaskExecution | InformationRequestOpened | Request RESOLVED 且执行恢复决策完成 | 渠道重试/换授权 responder；超时转 Human |
| QualityEvaluationProcess | QualityGovernance | ArtifactRevisionSealed | Mandatory REVISION_ACCEPTANCE Gate 有结果，Issue/Readiness 已投影 | Gate ERROR 重试；FAIL 创建 Issue；不改 Revision |
| ReleaseGateEvaluationProcess | QualityGovernance | ReleasePrepared | 适用的 RELEASE_READINESS Gate 对冻结 Package 有有效结果 | Gate FAIL/ERROR 阻止授权；Package 改变必须新 Release/重新准备 |
| IssueRemediationProcess | QualityGovernance | BlockingReviewIssueRaised | Issue VERIFIED/CLOSED 或授权 Dismissed | 创建整改 Task 候选；长期未解转 Human |
| ApprovalReadinessProcess | QualityGovernance | RevisionQualityReady | Approval Requirements 全部满足或拒绝终止 | 过期/撤销重算；不自动批准 |
| ReleaseReadinessProcess | ReleasePublication | RevisionFullyApproved | Release Prepared/Authorized 或明确不发布 | Readiness 失效时阻止授权；已授权则 Impact Review |
| PublicationProcess | ReleasePublication | ReleaseAuthorized | Required Destination 均有有效 Receipt | 幂等重试；部分成功标记 PARTIAL；不伪造回滚 |
| DeliveryCompletionProcess | EnterpriseProject | Task/Revision/Approval/Release events | CompletionCriteria 满足并记录派生事件 | 缺事实保持未完成；Projection 失败可重放 |
| UpstreamInvalidationProcess | QualityGovernance/ReleasePublication | Evidence/Gate/Approval invalidated | Impact 分级、阻止后续动作或 Recall 决策 | 高风险进入 Human Governance，不删除历史 |

### 13.3 Saga 不采用业务回滚

例如正式发布到两个 Destination：

```text
Destination A success
Destination B failure
```

系统不能“回滚”已经发送给 A 的文件。正确处理是：

1. REL 状态为 PARTIALLY_RELEASED；
2. 保留 A 的真实 Receipt；
3. 对 B 使用相同冻结 Package 和幂等键重试；
4. 如 Package 必须改变，终止当前 Release 并创建新 Release；
5. 如果已发送版本必须撤回，创建 Recall/Notification 流程；
6. Human 决定是否继续、召回或接受部分发布风险。

### 13.4 Human Intervention 条件

以下情况不得无限自动重试：

- 授权或角色不满足；
- 数据分类阻止外部模型/渠道使用；
- 相互冲突的 Human Answers；
- Mandatory Gate 持续 ERROR；
- Blocking Issue 无法自动整改；
- Release 部分成功且重试上限耗尽；
- Approval 在 Release 前或发布中撤销；
- Evidence 撤销影响已发布高风险成果；
- 幂等键相同但 PayloadHash 不同；
- Aggregate Version 持续冲突并表明真实业务竞争。

Process Manager 必须进入 `HUMAN_INTERVENTION_REQUIRED`，创建明确 Task/InformationRequest，而不是静默停止。

---

## 14. 并发控制

### 14.1 Optimistic Concurrency

所有可变 Aggregate 使用单调 `aggregateVersion`。写 Command 默认携带 `expectedAggregateVersion`：

```text
expected = 7
actual = 8
    ↓
reject AGGREGATE_VERSION_CONFLICT
```

冲突后调用者必须重新读取、重新评估业务意图。禁止自动覆盖或无条件重放 Human 编辑。

### 14.2 Revision 并发

Revision 不可变，因此冲突发生在 Artifact working head：

```text
Agent A reads head REV-010
Agent B reads head REV-010
Agent A creates REV-011 and moves branch head
Agent B creates REV-012 from REV-010
```

REV-012 可以作为新 Branch Revision 保存，但不能无条件替换当前 head。后续必须显式：

- 放弃该 Branch；
- 人工选择；
- 创建 Merge Revision。

### 14.3 WorkOrder 与 Run Lease

v0.1 默认同一 WorkOrder 只有一个 active Run。Dispatcher 获取带到期时间的执行 Lease：

```text
leaseId
workOrderId
runId
holderRuntime
issuedAt
expiresAt
fencingToken
```

旧 Runtime 即使恢复，也不能凭过期 Lease 提交可接受结果。fencingToken 小于当前值的结果进入 Quarantine。

### 14.4 Approval 并发

多个审批槽位可并行，但每个 Decision 绑定同一个 Approval Bundle Snapshot。如果等待期间发生：

- 新 Revision；
- GateResult Invalidated；
- Blocking Issue Reopened；
- Profile Binding 改变；

尚未提交的 Approval Request 必须标记 STALE；已提交 Approval 由 Evaluator 判断是否仍有效，不能迁移到新 Snapshot。

### 14.5 Release 并发

同 Artifact/purpose 是否允许多个 Release Draft 可以由 Policy 决定，但：

- 同一个 releaseId 只能有一个冻结 packageHash；
- 同一 destination/packageHash 的 PublicationAttempt 使用稳定幂等键；
- EffectiveBinding 切换使用 Artifact expectedVersion；
- 两个 Release 竞争同 purpose 生效时，只能一个成功，另一个进入冲突复核。

---

## 15. 幂等、去重与 Replay

### 15.1 三层标识

```text
commandId
= 一次业务命令身份

idempotencyKey
= 调用者对同一业务意图的稳定去重键

payloadHash
= 检测相同身份是否被篡改或错误复用
```

相同 idempotencyKey + 相同 payloadHash：返回原 Command Result。
相同 idempotencyKey + 不同 payloadHash：拒绝并记录安全/一致性异常。

### 15.2 关键幂等键

| 场景 | 建议稳定键 |
|---|---|
| 飞书消息接收 | `feishu:message:{app}:{tenant}:{messageId}` |
| 飞书其他入站事件 | `feishu:event:{app}:{tenant}:{eventId}` |
| 飞书卡片动作 | `feishu:card:{app}:{tenant}:{eventId}`；operator/nonce/target 继续参与 payloadHash 与授权校验 |
| SourceMaterial 注册 | `{channelSourceRef}:{attachmentRef}:{checksum}` |
| Human Command | `{principalId}:{clientRequestId}` |
| WorkOrder Dispatch | `{workOrderId}:{attemptNumber}` |
| Run final AgentResult | `{runId}:{resultId}` + payloadHash |
| Information Answer | `{requestId}:{channelEventId}:{responderId}` |
| Revision 创建 | `{artifactId}:{workOrderId}:{runId}:{outputSlot}` |
| Gate execution | `{revisionId}:{profileVersion}:{gateSpecId}:{inputHash}:{attempt}` |
| Approval decision | `{approvalRequestId}:{approverId}:{decisionNonce}` |
| Release publication | `{releaseId}:{destinationRef}:{packageHash}` |
| Event Consumer | `{consumerName}:{eventId}` |

### 15.3 Inbox/Outbox 语义

概念上要求：

```text
Domain transaction
  ├── Aggregate state
  └── Outbox event
commit atomically

Consumer
  ├── check Inbox(eventId, consumer)
  ├── handle event / issue command
  └── record Inbox completion atomically with local state
```

本文只冻结语义，不决定表结构或消息中间件。

### 15.4 Replay 安全

- Domain Event Replay 可以重建 Projection 或重新驱动幂等 Consumer。
- Replay 不得重新发送外部消息，除非 Publication/Notification Attempt 明确处于可重试状态并使用相同幂等键。
- Approval、Release Authorization 等 Human 决定不能因事件 Replay 被重新创建。
- PayloadHash 冲突、版本间隙或未知 eventVersion 必须隔离，不猜测处理。

---

## 16. 外部副作用与失败语义

### 16.1 外部副作用列表

```text
飞书消息/卡片/文件发送
Runtime WorkOrder dispatch/cancel/resume
Renderer DOCX/PDF/XLSX generation
外部对象存储写入
法规/权威来源抓取
Provider 模型调用
未来监管提交或 DMS 发布
```

这些都不能与 Domain Aggregate 状态共享一个假想原子事务。

### 16.2 执行规则

1. 先提交业务意图，再执行外部副作用。
2. 每次外部调用创建 Attempt，记录请求 Hash、幂等键、时间、Outcome 和 Receipt/Error。
3. 超时表示 UNKNOWN，不能立即当作失败或成功；先按外部幂等能力查询/重试。
4. 只有可验证 Receipt 才能形成成功业务事实。
5. 外部成功、Core 记录失败时，通过相同幂等键查询并补记 Receipt，不能盲目重发。
6. Core 成功、外部失败时，Aggregate 保持准备/发布中/失败等真实状态，并按 Policy 重试或人工处理。
7. 不可补偿的副作用使用 Recall、纠正通知或新 Release，而不是删除历史。

### 16.3 Feishu 特殊规则

- 入站消息必须先映射 Feishu Identity 到 HumanPrincipal/ExternalPartyPrincipal。
- 群或话题 Binding 是显式对象，群成员可见性不等于 Project 数据权限。
- 普通附件只触发 SourceMaterial Candidate。
- 普通文本只触发 Task/Answer/Decision Candidate，不能模糊转换为正式批准。
- 正式 Release 发布必须携带 releaseId、packageHash 和 Destination Snapshot。
- 消息撤回、群解散、用户离职不删除 Core 历史；触发访问、保留和通知影响评估。

### 16.4 Runtime 特殊规则

- Runtime Adapter 不持有长期 Human 权限。
- 每个 Run 使用短期 Capability Token、ContextSnapshot 和 fencingToken。
- Runtime 失败不回滚 WorkOrder；ExecutionPolicy 决定 Retry、Fallback 或 Human Intervention。
- late result、重复 final result 和 scope mismatch 必须 Quarantine。
- Provider Usage 缺失使用 null，不伪造 0。

---

## 17. 模块交互约束

### 17.1 权威来源

七个逻辑模块的职责、所有权、非职责、端口、依赖和持久化边界只在 [`02-zhiju-core-architecture.md`](./02-zhiju-core-architecture.md) 第 20 节维护。本文不再复制模块规格；以下内容只解释边界形成原因、允许的协作和禁止的耦合。

### 17.2 为什么这样划分

`EnterpriseProject` 拥有“我们服务哪家企业、项目承诺什么”；`TaskExecution` 拥有“谁被授权尝试做什么”；`Artifact` 拥有“正式内容身份和版本”；`QualityGovernance` 拥有“为什么可以接受”；`ReleasePublication` 拥有“向哪里正式发布”；`IntegrationGateway` 只适配外部世界；`IdentityPolicy` 为所有写路径提供统一身份和权限决策。

Artifact 与 QualityGovernance 分开，是为了避免 Revision 作者通过同一写模型控制检查和批准；QualityGovernance 与 ReleasePublication 分开，是为了避免“批准”自动变成外部发布。

### 17.3 Shared Kernel 限制

允许共享的仅是稳定技术/语义 Value Object：

```text
EnterpriseId / ProjectId / PrincipalId
ObjectRef(type, id, version?, hash?)
Money / DateTime / Hash
CommandEnvelope / EventEnvelope
AuthorizationContextRef
DataClassification
DomainError base shape
```

禁止共享：

- Aggregate Entity；
- Repository；
- 可变状态对象；
- 模块内部枚举而无版本契约；
- ORM Model；
- 允许另一模块直接写入的 Service。

### 17.4 模块化单体物理约束

实现时即使使用同一进程和数据库，也必须遵守：

1. 每个模块只访问自己的 Repository/Schema Namespace；
2. 跨模块读取使用公开 Query Port 或订阅 Projection；
3. 跨模块写入使用公开 Command Port；
4. 不通过数据库外键级联跨模块修改；
5. 不在 Integration 层复制 Domain Rule；
6. 构建/静态检查应阻止非法内部包依赖；
7. 以后是否拆服务是独立架构决定，不由当前目录结构自动决定。

---

## 18. 模块依赖方向

### 18.1 允许的同步依赖

```text
IntegrationGateway
    ↓ public application ports
IdentityPolicy / EnterpriseProject / TaskExecution / Artifact / QualityGovernance / ReleasePublication

EnterpriseProject
    ↓ authorization decisions
IdentityPolicy

TaskExecution
    ↓ read/query contracts
IdentityPolicy / EnterpriseProject / Artifact / QualityGovernance / ReleasePublication

Artifact
    ↓ authorization/reference validation contracts
IdentityPolicy / EnterpriseProject

QualityGovernance
    ↓ immutable revision and reference query contracts
IdentityPolicy / EnterpriseProject / Artifact

ReleasePublication
    ↓ release readiness query contracts
IdentityPolicy / Artifact / QualityGovernance
```

EnterpriseProject 不同步调用 TaskExecution、Artifact、QualityGovernance 或 ReleasePublication 来计算 Completion；它消费正式事件并维护自己的 Completion Projection。Artifact 对 Project/DeliveryItem 引用的归属验证是 `Artifact → EnterpriseProject` 单向 Query，EnterpriseProject 不反向查询 Artifact。这样避免同步依赖环。

完整 Project Context 的 execution Snapshot 由 TaskExecution Context Builder 按 WorkOrder 目的组装；EnterpriseProject、Artifact、QualityGovernance 和 ReleasePublication 各自只提供权限裁剪的 Source Slice。QualityGovernance/ReleasePublication 不同步依赖 TaskExecution，因此该读取方向不形成循环。Human Workspace 和 Feishu Summary 优先使用跨模块 Projection；高风险 Command 仍回到权威模块验证。

### 18.2 禁止的循环写依赖

```text
EnterpriseProject ↔ TaskExecution direct repository access
TaskExecution ↔ Artifact direct repository access
Artifact ↔ QualityGovernance shared transaction
QualityGovernance ↔ ReleasePublication shared mutable approval state
IntegrationGateway ↔ Domain bidirectional state ownership
```

需要双向业务反馈时使用事件：

```text
DeliveryItemActivated → Task proposal
TaskCompleted → Delivery completion re-evaluation
ArtifactRevisionSealed → Quality evaluation
RevisionFullyApproved → Release readiness
ReleaseCompleted → Delivery completion / Effective binding
```

### 18.3 Query Contract

同步 Query 只能返回：

- 精确版本 Snapshot；
- 权限裁剪后的 Read Model；
- Readiness Decision 与原因；
- 存在性/归属验证；
- 不可变内容引用。

Query 不得产生隐藏写入、自动状态推进或外部副作用。

---

## 19. 跨模块 Read Model

### 19.1 Project Board Projection

组合：

```text
EnterpriseProject DeliveryItem
TaskExecution Task/WorkOrder/Run/InformationRequest summary
Artifact current working/approved/released refs
QualityGovernance Gate/Issue/Approval readiness
ReleasePublication publication status
```

Board 只提供导航和 Command Intent，不拥有任何状态。

### 19.2 Artifact Trace View

```text
Artifact → Revision lineage
Revision → Task/WorkOrder/Run/AgentResult provenance
Revision Claim → EvidenceLink → Evidence source
Revision → GateResults → ReviewIssues
Revision → Approvals → Release → Receipt
Release → DeliveryItem / Enterprise EffectiveBinding
```

### 19.3 Feishu Conversation Projection

只包含当前 Channel Binding、Principal 权限和业务上下文所需摘要：

```text
Project/Task identity
current blocker or InformationRequest
allowed actions
status summary
Deep Link
outbound message correlation
```

不默认注入整个客户资料、全部 Evidence 或其他项目对象。

### 19.4 Staleness

所有跨模块 Projection 记录：

```text
sourceEventId
sourceAggregateVersion
projectedAt
projectionVersion
stalenessStatus
```

需要做高风险 Command 时，Handler 必须回到权威模块重新验证，不能仅依据 Projection。

---

## 20. MVP 范围冻结

### 20.1 MVP 必须实现

| 范围 | 最小能力 |
|---|---|
| IdentityPolicy | Human/Agent/Service Principal、项目权限、Human-only Capability、防跨企业访问 |
| EnterpriseProject | Enterprise/Project 基础、SourceMaterial、CustomerMaterial、Baseline、Gap、DeliveryPlan/Item 最小闭环 |
| TaskExecution | Task、WorkOrder、Run、AgentResult、InformationRequest、Retry/Cancel/Usage/Provenance |
| Artifact | Artifact、不可变 Revision、线性 lineage + 显式 Merge 边界、Canonical Content 引用、基本 Diff |
| QualityGovernance | 基础 QualityProfile、Revision Acceptance Gate、Release Readiness Render Gate、Issue、Human Approval |
| ReleasePublication | Customer Delivery Release、冻结 Package、飞书发布、逐项 Receipt、基本 Recall 标记 |
| IntegrationGateway | 完整双向飞书 Channel、一个 Runtime Adapter、Renderer Adapter 最小闭环 |
| Consistency | Optimistic concurrency、Command/Event 幂等、Outbox/Inbox 语义、Process Manager 状态与审计 |
| Workspace | Human 查看 Context、Diff、Issue、Gate、Approval、Release；复杂操作使用 Deep Link |

### 20.2 MVP 可简化但不能破坏边界

- 部署为单进程模块化单体；
- 使用一个关系数据库与对象存储，但保持模块 Repository 所有权；
- 第一版只支持一个 active Run；
- 第一版只深度适配一个 Agent Runtime；
- 第一版 Gate 类型固定，不做插件市场；
- 第一版 Approval 顺序可先支持串行/并行的有限组合；
- 第一版 Release Destination 先支持飞书与受控 Workspace；
- 第一版 Branch UI 可以简单，但不能用覆盖代替 Merge；
- 第一版 Impact Analysis 在无法证明安全时全量重跑。

### 20.3 明确延后

- 通用 Workflow DSL/BPMN；
- 通用 Agent Harness；
- 完整 Knowledge Graph；
- 多 active Run 竞赛；
- 全功能 Office 在线协作编辑；
- 任意第三方 DMS/监管网关；
- 通用 PolicyException 引擎；
- 自动法规抓取和自动高风险适用性确认；
- 复杂多法人 CustomerAccount/Tenant 商业层；
- 微服务拆分和跨区域部署；
- 事件溯源作为全系统持久化模型；
- 在飞书消息内实现复杂文档 Diff/编辑器。

### 20.4 禁止提前实现

- 绕过 Core 的 Runtime 文件直发客户；
- 用飞书消息状态代替 Task/Approval/Release；
- 用一个 `status` 字段合并 Draft、Approved、Released、Effective；
- 用共享管理员身份代表所有飞书用户；
- Agent 获得 Human Approval 或 Release Authorization Capability；
- 模块之间共享 Repository 或直接更新表；
- 以补偿删除历史发布/审批事实；
- 为“未来灵活性”先建通用 Workflow/Agent Framework。

---

## 21. Cross-Aggregate 设计测试

| 用例 | 类型 | 输入 | 预期输出 | 实际输出 |
|---|---|---|---|---|
| XA-U-001 | Unit | Process Manager 收到重复 Domain Event | 只发出一次等价 Command；Inbox 记录幂等完成 | NOT RUN：设计阶段 |
| XA-U-002 | Unit | Command expectedVersion 落后于 Aggregate 实际版本 | 拒绝版本冲突，不覆盖并发修改 | NOT RUN：设计阶段 |
| XA-U-003 | Unit | 相同 idempotencyKey 携带不同 payloadHash | 拒绝并记录一致性/安全异常 | NOT RUN：设计阶段 |
| XA-U-004 | Unit | Projection 显示 Gate PASS，但权威 Result 已 Invalidated | Approval Handler 重新验证并拒绝，不信任过期 Projection | NOT RUN：设计阶段 |
| XA-U-005 | Unit | 非所有者模块请求直接修改他方 Aggregate | 架构/API 边界拒绝；只能调用公开 Command Port | NOT RUN：设计阶段 |
| XA-U-006 | Unit | 同 WorkOrder 两个 Dispatcher 竞争 Run Lease | 仅一个获得最新 fencingToken，另一个失败 | NOT RUN：设计阶段 |
| XA-E-001 | E2E | 飞书重复投递同一客户附件事件 | 只处理一次业务意图；保留正确 SourceMaterial 来源链 | NOT RUN：设计阶段 |
| XA-E-002 | E2E | final BLOCKED_INPUT 后 Human 回答 | 创建新 ContextSnapshot 和新 Run，不恢复已终结 Run | NOT RUN：设计阶段 |
| XA-E-003 | E2E | REV-002 Gate FAIL，整改形成 REV-003 | 旧 Result/Issue 历史保留；新 Result 和 Verification 绑定 REV-003 | NOT RUN：设计阶段 |
| XA-E-004 | E2E | REV-003 fully approved 后飞书普通上传同名文件 | 普通上传不生成 Release；只有授权 REL-801 可正式发布 | NOT RUN：设计阶段 |
| XA-E-005 | E2E | Release 两个 Destination 一成功一失败 | PARTIALLY_RELEASED，成功 Receipt 保留，失败目标幂等重试 | NOT RUN：设计阶段 |
| XA-E-006 | E2E | CUSTOMER_DELIVERY Release 完成 | DeliveryItem 可完成，但内部 EffectiveBinding 不改变 | NOT RUN：设计阶段 |
| XA-E-007 | E2E | Approval 在 Release Prepared 后、Authorize 前撤销 | Release Readiness 失效，不能 Authorize | NOT RUN：设计阶段 |
| XA-E-008 | E2E | Approval 在部分发布后撤销 | 不删除 Receipt；触发 Release Impact/Recall Human Review | NOT RUN：设计阶段 |
| XA-E-009 | E2E | Consumer 在事件处理后、记录 Inbox 前崩溃并重放 | 目标 Command 幂等，不重复创建业务对象或外部副作用 | NOT RUN：设计阶段 |
| XA-E-010 | E2E | 新 REV-004 Draft 与两个并行 Branch 出现 | REV-003 Approval/Release 保留；Branch 不覆盖；要求显式 Merge | NOT RUN：设计阶段 |
| XA-E-011 | E2E | Revision 已批准但冻结 Release Package 尚无 G6 PASS | 可以保持 approved，但 Release 不能 Authorize；精确 Package Render Gate PASS 后才可继续 | NOT RUN：设计阶段 |

---

## 22. 实现前待确认

以下问题不推翻当前基准，但必须在对应专题 Contract 或实施任务中冻结：

1. ExternalPartyPrincipal 第一版是否允许客户质量负责人直接完成 Answer 和客户确认；
2. SourceMaterial 二进制保留、消息撤回和客户删除请求的具体 Policy；
3. DeliveryItem 激活后由 Coordinator 自动创建 DRAFT Task 的风险上限；
4. WorkOrder Run Lease 默认期限、Heartbeat 和 fencingToken 续期规则；
5. 第一版唯一 Runtime Adapter 选择 Claude Code、Codex 或 OpenClaw 中哪一个；
6. Canonical Document 最小 Schema 和 Revision 封存时机；
7. Branch 是否在 MVP UI 暴露，还是只在冲突时由 Workspace 展示；
8. QualityProfile `QMS_PROCEDURE_HIGH` 的真实 GateSpec、角色和职责分离配置；
9. 哪些 Gate ERROR 可以自动重试，重试次数和模型/工具 fallback 是否需要 Human 授权；
10. Approval Request 在等待期间的默认过期时间；
11. Feishu Release Destination 的精确对象：群、话题、文件夹、云文档或组合；
12. 飞书 Receipt 可获得并必须持久化的真实字段；
13. CUSTOMER_DELIVERY Release 对 DeliveryItem Completion 是否需要客户 Receipt，还是仅渠道 Receipt；
14. INTERNAL_EFFECTIVE_USE 的 Human 角色、有效日期和旧版本替换规则；
15. Release 部分成功后的最大自动重试和 Human Intervention 时限；
16. Audit/Event 保留期限与敏感 Payload 脱敏规则；
17. 已冻结：v0.1 使用一个 PostgreSQL Database，七个模块各有独立权威 Schema/Repository Role，跨模块不设外键；
18. Process Manager 状态的运维查看、人工重试和死信处理界面最小范围。

---

## 23. 下一阶段 Gate

PostgreSQL Logical Model 已纳入当前基准。进入 API Contract 前应完成以下审阅：

1. Reference Project 的业务顺序和责任分离没有重大问题；
2. 七个逻辑模块的所有权与依赖方向成立；
3. 模块化单体是 v0.1 部署基线；
4. 一个 Aggregate 一个事务、跨模块 Process Manager 的一致性策略可接受；
5. MVP 必须实现/延后范围符合产品优先级；
6. [`07-postgresql-logical-model-v0.1.md`](./07-postgresql-logical-model-v0.1.md) 中一个 Database、七个权威 Schema、Typed Reference、RLS 和对象存储边界可接受；
7. 仍未冻结的 Policy 数值不影响 API 业务语义，或在对应 API Contract / 实施任务中有明确占位。

Gate 通过后的推荐顺序：

```text
Typed Reference + Contract v0.1  （当前基准）
    ↓
PostgreSQL Logical Model v0.1    （当前基准）
    ↓ 基准审阅
Command / Query / Event API Contract
    ↓
Feishu Channel Contract
    ↓
Runtime Adapter Contract
    ↓
Implementation Milestone Plan
```

---

## 24. 结论

三条领域链现在通过明确的 Command Owner、Domain Event 和 Process Manager 连接：

```text
EnterpriseProject
客户事实与项目承诺
    ↓ DeliveryItemActivated

TaskExecution
执行授权、尝试、输入恢复与结果
    ↓ ArtifactRevisionSealed

Artifact + QualityGovernance
不可变内容、依据、检查、整改与 Human 接受
    ↓ RevisionFullyApproved

ReleasePublication
冻结 Package、Human 授权、外部发布与回执
    ↓ ReleaseCompleted

EnterpriseProject / Artifact
交付完成与特定用途 EffectiveBinding
```

这条链允许飞书、Agent、Runtime、Renderer 和未来外部系统完整参与工作，但任何外部系统都不能拥有正式业务状态。跨 Aggregate 失败也不通过删除历史或伪造回滚处理，而通过幂等重试、显式补偿、影响评估和 Human Intervention 收口。
