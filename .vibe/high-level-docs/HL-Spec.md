# Zhiju Business Core 基准规格与 Agent 入口

版本：v0.1
日期：2026-09-07
状态：`CURRENT DESIGN BASELINE`；当前推进方向见 [roadmap](../product/roadmap.md)，执行与验收事实以最新 GitHub Issue/PR 为准。

本文固定存放于 `.vibe/high-level-docs/HL-Spec.md`，是本项目的产品与工程冻结基准。Agent 从根目录 `AGENTS.md` 进入，按角色与任务读取本文相关章节；本文负责说明产品目标、冻结规则、文档权威关系、阅读路径和变更纪律，不重复展开各领域的详细 Schema。

---

## 1. Agent 启动协议

任何设计或实现任务开始前，Agent 必须：

1. 读取根目录 `AGENTS.md` 与 `.vibe/project.yaml`；首次进入项目或涉及冻结规则时读取本文第 1–6、8–11 节；普通任务定位并读取相关冻结规则和权威章节，不默认读取历史快照；
2. 根据第 3 节选择任务所需的最小权威文档集；
3. 检查用户请求是否改变冻结决定、模块所有权、Contract 或持久化边界；
4. 检查工作区实际文件、Git 状态和已有改动，不假设对话中的结果已经落盘；
5. 在修改实现前同步更新受影响的基准文档和验证场景；
6. 只修改与当前任务直接相关的内容；
7. 明确区分“设计验证通过”“自动测试通过”“外部集成通过”和“人工验收通过”；
8. 未经用户明确要求，不执行 Git Commit。

如果用户请求与本文或其他权威文档冲突，Agent 不得静默选择一方。应指出冲突、影响和建议的正式变更位置；用户的新明确指令优先，并应同步更新基准。

---

## 2. 基准文档包

下表的正式规格在其声明范围内拥有权威；Task-Plan 与 Verification-Report 链接仅用于追溯历史计划、审核 Gate 和验证证据。最新执行状态以 GitHub 为准，历史记录中的独有约束须核对后才能迁移。

`.vibe/high-level-docs/` 下的以下文档构成已经用户审核通过的高层设计基准：

| 顺序 | 文档                                                                                                                 | 唯一权威范围                                                              | 典型读取者                                 |
| ---: | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
|    0 | `HL-Spec.md`                                                                                                         | 产品目标、冻结规则、文档路由、变更纪律                          | 所有 Agent，按启动协议读取                           |
|    1 | [`01-customer-field-findings.md`](01-customer-field-findings.md)                                                   | 客户现场证据、业务动因、风险原则、MVP 业务约束                            | 产品、业务、UX、Channel 任务               |
|    2 | [`02-zhiju-core-architecture.md`](02-zhiju-core-architecture.md)                                                   | 总体架构、七模块职责/所有权/端口/依赖、权限边界、ADR、实施边界            | 所有跨模块或实现任务                       |
|    3 | [`03-core-contracts.md`](03-core-contracts.md)                                                                     | Project Context、WorkOrder、AgentResult、Artifact + Quality Gate Contract | Runtime、执行、Artifact、Quality、API 任务 |
|    4 | [`04-domain-model-v0.1.md`](04-domain-model-v0.1.md)                                                               | Aggregate、Entity、Value Object、状态机、命令、事件、不变量               | 领域实现与业务规则任务                     |
|    5 | [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](05-cross-aggregate-consistency-module-boundary-v0.1.md) | Reference Project、跨 Aggregate 流程、事务/Saga、并发、幂等、补偿         | Application Service、流程和可靠消息任务    |
|    6 | [`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md)                     | Typed Reference、Envelope、兼容性、201 个公开 Command/Query/Event 名称    | API、事件、跨模块集成任务                  |
|    7 | [`07-postgresql-logical-model-v0.1.md`](07-postgresql-logical-model-v0.1.md)                                       | Schema 所有权、逻辑表、约束、RLS、Outbox/Inbox、对象存储边界              | 数据库、Repository、Migration 任务         |
|    8 | [`08-verification-baseline.md`](08-verification-baseline.md)                                                       | 验证策略、跨模块验收场景、文档/实现/人工 Gate、测试结果口径               | 所有修改和审查任务                         |

Issue #57 的前置对象入口和未冻结参数决策记录在 [`../decisions/enterprise-project-capabilities.md`](../decisions/enterprise-project-capabilities.md)。该文件是本 Work Item 的决策记录，不扩展当前 201 项公开 Catalog，也不替代 `06`、`Module-Spec` 或 `07` 的既有唯一权威范围。

### 2.1 文档优先级

同一问题出现差异时，按以下规则处理：

1. 用户最新明确决定；
2. 本文中的产品和工程冻结规则；
3. `02-zhiju-core-architecture.md` 中的架构决定与模块所有权；
4. 专题文档在其“唯一权威范围”内的详细定义；
5. 示例、历史说明和待确认问题。

专题文档之间不存在整体高低关系。例如，Command 名称以 `06` 为准，数据库表归属以 `07` 为准，Aggregate 不变量以 `04` 为准。Agent 不得用数据库便利性覆盖 Domain 不变量，也不得用示例覆盖 Contract。

### 2.2 API Contract 阶段文档

高层基准通过后，字段级 API 设计在以下位置持续维护：

| 文档 | 唯一权威范围 |
|---|---|
| [`../api-contract-v0.1/API-Contract-v0.1.md`](../api-contract-v0.1/API-Contract-v0.1.md) | Command/Query/Event 共享类型、执行语义、错误、兼容、安全与 Registry |
| [`../module-specs`](../module-specs) 下七份 `Module-Spec-[ID]-[ModuleName].md` | 对应模块公开操作的 payload/result/event 字段、授权和模块错误 |
| [`../module-tests`](../module-tests) 下七份 `Module-Test-[ID]-[ModuleName].md` | 对应模块 Unit/Contract/E2E/Manual 用例、输入、预期、实际和结果 |
| [`../archive/api-contract-v0.1/Task-Plan.md`](../archive/api-contract-v0.1/Task-Plan.md) | 历史阶段记录：本阶段里程碑、任务分配、执行状态和人工审核 Gate（非最新执行状态；独有 Gate 仍须核对） |
| [`../archive/api-contract-v0.1/Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md) | 历史阶段记录：API 阶段 Catalog、字段、测试文档、Markdown 和 diff 静态验证证据（非最新执行状态；独有 Gate 仍须核对） |

### 2.3 Feishu Channel Contract 阶段文档

Feishu Channel v0.1 的专项协议固定维护在 `.vibe/feishu-channel-contract-v0.1/`；该目录只拥有飞书原始事件/API 到现有 Core Contract 的 Anti-Corruption 映射，不创建第八个业务模块，也不改变 201 项公开 Catalog 的 Owner。

| 文档 | 唯一权威范围 |
|---|---|
| [`../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md) | 飞书事件接收、身份/Binding、消息/文件/卡片、出站投递、回执、撤回、重试、安全和 Core API 映射 |
| [`../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md) | Feishu Channel Unit/Contract/E2E/Manual 场景、输入、预期、实际和结果 |
| [`../archive/feishu-channel-contract-v0.1/Task-Plan.md`](../archive/feishu-channel-contract-v0.1/Task-Plan.md) | 历史阶段记录：本阶段里程碑、执行顺序、人工审核 Gate 与状态（非最新执行状态；独有 Gate 仍须核对） |
| [`../archive/feishu-channel-contract-v0.1/Verification-Report.md`](../archive/feishu-channel-contract-v0.1/Verification-Report.md) | 历史阶段记录：官方协议证据、映射覆盖、安全边界、Markdown 和 diff 静态验证结果（非最新执行状态；独有 Gate 仍须核对） |

### 2.4 Runtime Adapter Contract 阶段文档

Runtime Adapter v0.1 的专项协议固定维护在 `.vibe/runtime-adapter-contract-v0.1/`；该目录只拥有 WorkOrder/Run/AgentResult 与外部 Harness 协议之间的 Anti-Corruption 映射，不拥有 TaskExecution 业务状态，也不把 Runtime Session、文件或自报完成提升为 Core 事实。

| 文档 | 唯一权威范围 |
|---|---|
| [`../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md) | Execution Package、Adapter Port、本地 CLI Process Driver、标准事件、Lease/Fencing、Result/Usage、Resume/Retry、CLI Profile 与安全边界 |
| [`../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md) | Runtime Adapter Unit/Contract/E2E/Manual 场景、输入、预期、实际和结果 |
| [`../archive/runtime-adapter-contract-v0.1/Task-Plan.md`](../archive/runtime-adapter-contract-v0.1/Task-Plan.md) | 历史阶段记录：本阶段范围、里程碑、执行顺序、审核与提交 Gate（非最新执行状态；独有 Gate 仍须核对） |
| [`../archive/runtime-adapter-contract-v0.1/Verification-Report.md`](../archive/runtime-adapter-contract-v0.1/Verification-Report.md) | 历史阶段记录：Provider 资料、API 映射、proposal、安全、Markdown 和 diff 静态证据（非最新执行状态；独有 Gate 仍须核对） |

### 2.5 Implementation Milestone Plan 阶段文档

实施里程碑计划固定维护在 `.vibe/implementation-milestone-plan-v0.1/`；它只定义实施顺序、决策 Gate、交付物和退出条件，不拥有 Domain、API、数据库或 Adapter 语义。

| 文档 | 唯一权威范围 |
|---|---|
| [`../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md) | IM-DG-001 至 006、IM-00 至 09、IM-UI-01、目标代码边界与 Definition of Done |
| [`../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md`](../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md) | 已批准 Node.js/TypeScript/NestJS/Fastify/PostgreSQL/Kysely/Flyway/Test 技术基线与升级边界 |
| [`../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md`](../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md) | 已批准 Ubuntu 私有化、MicroCeph/Ceph RGW、OpenBao、Keycloak OIDC 与 Workspace UI 边界 |
| [`../archive/implementation-milestone-plan-v0.1/Task-Plan.md`](../archive/implementation-milestone-plan-v0.1/Task-Plan.md) | 历史阶段记录：本阶段范围、输入、步骤和提交 Gate（非最新执行状态；独有 Gate 仍须核对） |
| [`../archive/implementation-milestone-plan-v0.1/Verification-Report.md`](../archive/implementation-milestone-plan-v0.1/Verification-Report.md) | 历史阶段记录：路线、依赖、决策隔离、静态验证和剩余风险（非最新执行状态；独有 Gate 仍须核对） |
| [`../module-specs/Module-Spec-UI01-WorkspaceUI.md`](../module-specs/Module-Spec-UI01-WorkspaceUI.md) | Workspace UI Experience Module 的页面能力、BFF/API、状态真实性、安全和非所有权边界 |
| [`../module-tests/Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md) | Workspace UI Unit/Contract/Browser E2E/Security/Accessibility/Manual 用例和真实结果 |

模块职责仍只由 `02` 冻结，公开名称/Owner 仍只由 `06` 冻结；Module Spec 不得重新划分所有权。API 阶段文档已于 2026-08-13 通过用户审核并构成当前字段级 API 基准，但不能覆盖已审核高层基准。

---

## 3. 按任务读取

先按角色选择入口，再按主题定位权威章节；表中的文档名称是查找范围，不要求整份加载。

| 角色 | 必需上下文 | 按需追加 |
|---|---|---|
| Planner | 用户目标、roadmap、相关 HL/Module Spec | 阶段定义、未决 Gate、最新 Issue/PR |
| Implementer | 最新 Issue、受影响 Module Spec/Test、相关冻结规则 | 共享 Contract、具体架构/数据库章节 |
| Reviewer | 最新 PR head/diff、Issue、受影响契约与测试证据 | 相关跨模块约束、具体失败场景 |

| 主题 | 权威定位 |
|---|---|
| 产品与范围 | 本文第 4–6 节、01 客户约束、02 架构中受影响部分 |
| 领域与状态机 | 对应 Module Spec、04 中对应 Aggregate；跨模块时追加 05 |
| API 与字段 | 对应 Module Spec/Test、共享 API Contract；03 的被引用 Core 类型、06 的 Reference/Envelope/操作条目 |
| 数据库与事务 | 07 对应 Schema、Migration/事务约束；对应模块及 05 相关一致性规则 |
| 飞书或 Runtime | 对应专项 Contract/Test、所使用 Core 类型和接口 |
| 验证与审查 | 08 第 1–2 节、对应 Module-Test 场景、当前 PR 检查 |
| 里程碑规划 | roadmap、Implementation Milestone Plan 对应阶段及依赖/Gate |

只在当前证据不能解决具体问题时扩大阅读范围。第 7 节链接到保留历史记录及尚待提取实施约束的补充文档；不将旧状态、旧命令或旧分支要求作为当前执行指令。涉及其中独有技术约束时仍须读取并与 owning 规格核对，不能因标记历史就忽略约束。

---

## 4. 产品目标

Zhiju Business Core 是制巨质量管理体系服务的业务内核。它要把咨询工作的长期企业知识、项目承诺、受控成果、证据、审查、批准、发布和审计变成独立于任何模型、Agent Harness、聊天会话和办公文件格式的正式业务世界。

成功标准：

- 企业知识可以跨项目、员工、Agent、模型和 Harness 长期继承；
- 客户数据严格隔离，正式业务状态只能通过 Core 规则改变；
- Agent 生成内容不等于正式成果；
- Human 最终批准和发布授权不可被 Agent、Prompt 或 `actingFor` 绕过；
- 法规、企业事实、项目输入、文件版本、Evidence、Gate、Approval 和 Release 可精确追溯；
- 没有 Agent 时，Human 仍可通过相同业务能力完成工作；
- MVP 通过完整双向飞书 Agent Channel 支持消息、文件、会话、任务状态和交互回传；
- 飞书、Runtime、Renderer 和对象存储只承担适配/基础设施职责，不拥有业务完成解释权。

---

## 5. 已冻结的产品与架构规则

### 5.1 产品边界

- Zhiju Core 是 Business Domain Platform，不是通用 Agent Framework；
- QM 已弃用，不属于目标架构、实现依赖、Runtime Adapter 或评估候选；
- 架构必须 Harness-neutral；
- MVP 必须实现完整双向飞书 Agent Channel；
- v0.1 是模块化单体，不提前拆微服务；
- v0.1 不建设通用 Workflow Engine、完整 Knowledge Graph 或自研通用 Agent Harness；
- Enterprise 是长期业务边界，也是 MVP 客户数据隔离边界；
- Project 是 Enterprise 下的阶段性工作边界，不等于 Session、Thread、Workspace 或文件夹；
- Product 是 EnterpriseProject 拥有的独立版本化 Aggregate；
- 不为数据库便利提前引入 CustomerAccount/Tenant 业务 Aggregate。

### 5.2 事实与版本

- Harness Memory、飞书消息和文件系统不是 Business Memory；
- DOCX/XLSX/PDF 是 Representation 或交换格式，不是唯一 Source of Truth；
- Agent 可以提议 Fact、Evidence、Decision 和内容，不能默认确认为正式事实；
- Artifact 是长期成果身份，ArtifactRevision 是不可变内容版本；
- `aggregateVersion` 只用于 optimistic concurrency；
- 业务历史使用独立 versionId/revisionId/snapshotId 和必要 Hash；
- 审批、发布和可重放 Contract 禁止 `latest`；
- 历史失效通过 Revocation、Invalidation、Supersession、Recall 或 Impact Assessment 表达，不改写过去。

### 5.3 执行与完成

- Task、WorkOrder、Run、AgentResult 和 InformationRequest 是不同概念；
- WorkOrder READY 后 Specification 冻结；Prompt/Skill/AGENTS.md/CLAUDE.md 只是 Runtime Materialization；
- AgentResult 是不可变执行收据，不拥有 WorkOrder/Task/DeliveryItem 完成解释权；
- 一个 Run 只接受一个 final AgentResult；
- final `BLOCKED_INPUT` 解决后创建新 ContextSnapshot 和新 Run，不恢复 terminal Run；
- Completion 只能由 owning Core Evaluator 根据精确标准和引用派生；
- Runtime/Provider Usage 优先于 Agent 自报。

### 5.4 Artifact、质量与发布

- Artifact、Revision、Evidence、QualityProfile、GateResult、ReviewIssue、Approval、Release 和 EffectiveBinding 分别建模；
- Revision SEALED 后内容、Hash、Parent 和 Provenance 不可修改；
- GateResult 不可从 FAIL 原地改为 PASS；重跑或复用产生新 Result；
- AgentPrincipal 永远不能执行 Human Approval 或 Release Authorization；
- Human Approval 不能覆盖 Mandatory Gate 失败；
- Revision Acceptance、Approval Bundle、Release Readiness 是三个不可变阶段 Snapshot；
- Render Gate 属于精确冻结 Package 的 Release Readiness；
- `DRAFT != APPROVED != RELEASED != EFFECTIVE`；
- 飞书普通文件发送不是正式 Release；
- CUSTOMER_DELIVERY Release 不自动建立 INTERNAL_EFFECTIVE_USE Binding。

### 5.5 模块与一致性

- 七个逻辑模块及其所有权以架构基准为唯一权威；
- 一个公开写 Command 只有一个 owning module；
- 默认一个 Aggregate Root 一个同步事务；
- 跨模块流程通过已提交 Domain Event、Inbox、幂等 Command 和特定 Process Manager；
- 模块不得共享 Repository 或直接修改他方 Aggregate；
- 外部副作用只能在业务提交后执行，并保存 Attempt、稳定幂等键和真实 Receipt；
- 至少一次投递不等于 exactly-once；Replay 安全由 Inbox、Command Receipt 和业务幂等共同实现；
- Projection 可以延迟或重建，不能作为 Command 成功、Approval、Release 或 Completion 的判据。

### 5.6 持久化与安全

- v0.1 使用一个 PostgreSQL Database、七个权威 Schema 和一个可重建 Projection Schema；
- `pg_stat_statements` 只向预定义 `pg_read_all_stats` 暴露只读 View 与查询函数；Runtime/Dispatcher/Audit/Projection Role 无权访问，统计重置函数不授予观测角色；
- 模块内使用强外键/唯一/检查约束，跨模块使用 Typed Reference，不建立跨 Schema 外键；
- Enterprise-owned Row 显式保存 `enterprise_id`；Project-owned Row同时保存 `enterprise_id + project_id`；
- Enterprise 数据强制 RLS，但 RLS 不替代 IdentityPolicy；
- IdentityPolicy 的 Enterprise/Project Scope 必须闭合：Enterprise 行不得携带 `project_id`，Project 行必须携带 `project_id`；Project 行的 RLS 必须同时验证 Enterprise 与事务上下文允许的 Project，不能只按 Enterprise 放行；
- Role/Capability 撤销事实必须与父 Assignment/Grant 的完整 Scope 一致；CapabilityGrant、AuthorizationDecision 对 PolicySnapshot/ActorSnapshot 的引用必须校验精确 id + payload hash 及 promoted identity/scope，不能只依赖 id 外键；
- Canonical Contract 使用 JSONB + Hash，大内容和二进制进入受控对象存储；
- 对象存储与 PostgreSQL 不使用分布式事务，采用 Staging、Link Commit 和受审计 Orphan Cleanup；
- 受控历史不级联删除；
- 数据库不保存长期 Provider Token、共享 Human Credential、模型密钥或 Chain of Thought。

---

## 6. 逻辑模块全景

```text
BusinessCore
├── IdentityPolicy
├── EnterpriseProject
├── TaskExecution
├── Artifact
├── QualityGovernance
├── ReleasePublication
└── IntegrationGateway

ExperienceLayer
├── WorkspaceUI（IM-UI-01；Browser client）
└── WorkspaceBFF（OIDC Session / public API composition）
```

七个 Business Core 模块不是部署单元承诺，而是业务所有权、Repository、Schema 和公开 Contract 的边界。Workspace UI/BFF 是 Experience Module，不成为第八个 Business Core、不拥有 Schema/Repository/公开业务 Contract。详细职责、非职责、端口、依赖和持久化要求只在 `02-zhiju-core-architecture.md` 中维护；完整公开 Contract 名称只在 `06-typed-references-contract-catalog-v0.1.md` 中维护；逻辑表只在 `07-postgresql-logical-model-v0.1.md` 中维护。

---

## 7. 当前方向与历史基线

当前推进意图只在 [roadmap](../product/roadmap.md) 维护。执行状态、审查与每次验证证据从最新 GitHub Issue/PR 读取；原有记录通过下方补充文档保留，不作为最新任务状态。


相关历史记录与未归位约束见 [实施基线补充](../decisions/implementation-baseline-notes.md)。


## 8. 变更纪律

### 8.1 修改前

- 找到唯一权威文档，不在非权威摘要中发明新语义；
- 列出受影响的 Aggregate、Module、Contract、Schema、Event 和验证场景；
- 确认是向后兼容 Minor 变化、破坏性 Major 变化，还是仅实现细节；
- 对安全、审批、发布、隔离、不可变性和幂等变化优先写失败场景。

### 8.2 修改时

- 文档、Contract、验证场景先于实现同步；
- 不复制完整定义到第二份文档；使用链接和明确所有权；
- 新 Command/Query/Event 必须进入公开 Catalog并指定唯一 Owner；
- 新表必须进入 owning Schema，不创建共享业务表；
- 新跨模块引用必须选择明确 Typed Reference 强度；
- 新外部副作用必须具备 Attempt、稳定幂等键、UNKNOWN 和真实 Receipt 语义；
- 新 Human 高风险动作必须保存 ActorSnapshot 与 AuthorizationDecision。

### 8.3 修改后

- 执行 `08-verification-baseline.md` 中适用 Gate；
- 运行受影响的 Unit、Contract、Persistence 和 E2E 测试；
- 再运行全项目静态检查和回归；
- 未执行的真实飞书、Runtime、Renderer、数据库负载或人工业务验收必须列为剩余风险；
- 向用户报告变更文件、验证证据、未验证项和 Git 状态；
- 用户确认后才提交。

---

## 9. 决策变更位置

| 变化                    | 必须更新                                  |
| ----------------------- | ----------------------------------------- |
| 产品目标、MVP、冻结原则 | `HL-Spec`、`01`、`02`、`08`               |
| 模块职责/所有权/依赖    | `02`、`05`、`06`、`07`、`08`              |
| Aggregate/状态/不变量   | `04`、`02`、`05`、`08`                    |
| Core Contract 字段/语义 | `03`、`06`、`07`、`08`                    |
| Command/Query/Event     | `06`、对应 Domain/Architecture、`08`      |
| 字段级 API Payload/Result/Event | 共享 API Contract、对应 Module Spec/Test、`06`、`08` |
| 事务、Saga、幂等、补偿  | `05`、`02`、`07`、`08`                    |
| Schema/表/约束/RLS      | `07`、`02`、`08`                          |
| 飞书或 Runtime 映射     | `02`、`03`、`06`、未来专项 Contract、`08` |
| Workspace UI/BFF 范围、页面状态或安全边界 | `HL-Spec`、`02`、Deployment/Security Baseline、Workspace UI Spec/Test、`08` |
| 测试策略或验收口径      | `08` 和对应专题文档中的设计场景           |

---

## 10. 事实状态标签

Agent 的文档和报告必须使用以下含义：

```text
BASELINE
    当前设计 Source of Truth；仍可经正式决定修改

DESIGN VERIFIED
    文档结构和语义一致性已检查；不代表实现存在

NOT RUN
    测试/外部验证/人工验收未执行

PASS
    已执行并有当前证据

BLOCKED
    已达到明确阻塞条件，不能继续取得有意义进展
```

不得把“文档中存在测试用例”写成“测试通过”，不得把静态检索写成运行时安全验证，也不得把 Agent 自报成功写成业务完成。

---

## 11. Coding Agent 最小交付格式

完成一次任务时至少报告：

1. 结果和用户可见影响；
2. 修改的权威文档与实现文件；
3. 冻结决定是否发生变化；
4. 执行的验证命令和结果；
5. 未执行的外部/人工验证；
6. 工作区与 Commit 状态；
7. 下一步只在确有价值时给出。

## 历史补充记录（第一阶段保留）

原文已保存在实施基线补充中；历史状态不覆盖 roadmap 或最新 GitHub 事实，独有技术约束仍须核对。


相关历史记录与未归位约束见 [实施基线补充](../decisions/implementation-baseline-notes.md)。


<!-- Compatibility anchors for relocated historical sections. -->
<a id="历史基准状态"></a>
<a id="71-im-02-wi-08-实现审查基线2026-08-24"></a>
<a id="72-im-02-wi-09-actorsnapshot-与-authorizationdecision-审查基线2026-08-24"></a>
<a id="22-im-04-wi-01-实现边界2026-08-28"></a>
<a id="23-im-04-wi-02-applicationpersistence-实现边界2026-08-28"></a>
<a id="24-im-04-wi-03-artifact-根元数据与归档实现边界2026-08-28"></a>
<a id="25-im-04-wi-04-canonical-content-object-staginglinkfreeze-与-orphan-cleanup-实现边界2026-08-28"></a>
<a id="26-im-04-wi-05-immutable-revisionlineage-dagbranch-cas-与显式-merge-实现边界2026-08-28"></a>
<a id="27-im-04-wi-06-structured-document-human-edit-与-deterministic-internal-diff-设计边界2026-08-29"></a>
<a id="28-im-04-wi-07-workbookspec-human-edit-与确定性内部-diff-实现边界2026-08-29"></a>
<a id="29-im-04-wi-08-representation-权威-renderattempt-binding-实现边界2026-08-29"></a>
<a id="210-im-04-wi-09-权威-query合成-art-023-与退出证据边界2026-08-29"></a>
<a id="211-im-04-父退出门槛issue-89"></a>
<a id="212-im-05-wi-01-qualitygovernance-applicationpersistence-实现边界2026-08-30"></a>
<a id="213-im-05-wi-02-evidenceevidencelinkqualityprofile-生命周期issue-122"></a>
<a id="214-im-05-wi-03-gateresultchangeimpact-与-readiness-snapshotissue-123"></a>
<a id="215-im-05-wi-04-reviewissue-remediation-与-human-approval-snapshotissue-124"></a>
<a id="216-im-05-wi-05-最小-docxxlsx-renderer-与-representation-闭环issue-125"></a>
<a id="217-im-05-wi-06-releasepublication-持久化与冻结-packageissue-126"></a>
<a id="218-im-05-wi-07-release-authorizationpublicationreceipt-与-recallissue-127"></a>
<a id="issue-2224-runtime-修复契约2026-09-0122-controlled-technical-verified-and-github-closed--23-review-remediation-locally-verified--24-local-technical-verification-pass--issue-24-open"></a>
<a id="219-im-05-wi-08-合成-qmsrel-801-退出证据与父级复核issue-128"></a>
<a id="im-04-wi-01-canonical-schema-与-binding-query-当前交付状态2026-08-28"></a>
<a id="im-02-wi-07-实现审查约束2026-08-24"></a>
<a id="im-03-wi-01-当前决策状态2026-08-25"></a>
<a id="pr-69-审查状态2026-08-25"></a>
<a id="pr-72-审查修正状态2026-08-25"></a>
<a id="im-03-wi-04-project-启动快照scope-与对象验证2026-08-25"></a>
<a id="pr-73-修复基线2026-08-26"></a>
<a id="pr-73-修复结果2026-08-26"></a>
<a id="im-03-wi-05-sourcematerial-实现边界2026-08-26"></a>
<a id="im-03-wi-02-审查修正约束2026-08-25"></a>
<a id="im-02-远端交付快照2026-08-24"></a>
<a id="14-im-02-合并后干净-main-最终复验2026-08-24"></a>
<a id="12-im-02-wi-04-标准事务技术表边界"></a>
<a id="13-im-02-wi-10-outboxinbox-实现约束"></a>
<a id="im-03-wi-06-customermaterial-设计基线2026-08-26"></a>
<a id="im-03-wi-07-customerbaseline-实现边界2026-08-26"></a>
<a id="im-03-wi-08-templatebaseline-与-regulatoryprofile-实现边界2026-08-26"></a>
<a id="im-03-wi-09-gapanalysis-冻结输入human-接受与-stale-实现边界2026-08-26"></a>
<a id="im-03-wi-09-exact-head-closeout2026-08-27"></a>
<a id="im-03-wi-10-deliveryplandeliveryitem-human-批准与激活实现边界2026-08-27"></a>
<a id="im-03-wi-11-权威-querysource-slice-与-board-projection-设计边界2026-08-27"></a>
<a id="im-03-wi-11-exact-head-closeout2026-08-27"></a>
<a id="im-03-wi-12-deliveryitem-completion-与-impact-process-实现边界2026-08-27"></a>
<a id="im-03-合成-reference-project-技术验收边界2026-08-27"></a>

历史锚点的内容见 [实施基线补充](../decisions/implementation-baseline-notes.md)。
