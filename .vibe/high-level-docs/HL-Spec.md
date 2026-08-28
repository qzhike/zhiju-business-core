# Zhiju Business Core 基准规格与 Agent 入口

版本：v0.1
日期：2026-08-27
状态：`CURRENT DESIGN BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-02 COMPLETE / IM-03 COMPLETE (SCOPED TECHNICAL ACCEPTANCE) / ISSUE #56–#68 CLOSED / IM-DG-005 APPROVED 2026-08-27 / IM-04 WI-01 IMPLEMENTATION COMPLETE 2026-08-28 / IM-04 WI-01 PERSISTENCE VERIFIED 2026-08-28 / GIT DELIVERY PENDING USER REVIEW / IM-04 WI-02–WI-09 PLANNED / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

本文固定存放于 `.vibe/high-level-docs/HL-Spec.md`，是 Codex、Claude Code 及其他 Coding Agent 进入本项目时必须首先读取的文档。它负责说明当前目标、冻结规则、文档权威关系、阅读路径和变更纪律，不重复展开各领域的详细 Schema。

---

## 1. Agent 启动协议

任何设计或实现任务开始前，Agent 必须：

1. 先完整读取本文；
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

`.vibe/high-level-docs/` 下的以下文档构成已经用户审核通过的高层设计基准：

| 顺序 | 文档                                                                                                                 | 唯一权威范围                                                              | 典型读取者                                 |
| ---: | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
|    0 | `HL-Spec.md`                                                                                                         | 产品目标、冻结规则、文档路由、当前阶段、变更纪律                          | 所有 Agent，必读                           |
|    1 | [`01-customer-field-findings.md`](./01-customer-field-findings.md)                                                   | 客户现场证据、业务动因、风险原则、MVP 业务约束                            | 产品、业务、UX、Channel 任务               |
|    2 | [`02-zhiju-core-architecture.md`](./02-zhiju-core-architecture.md)                                                   | 总体架构、七模块职责/所有权/端口/依赖、权限边界、ADR、实施边界            | 所有跨模块或实现任务                       |
|    3 | [`03-core-contracts.md`](./03-core-contracts.md)                                                                     | Project Context、WorkOrder、AgentResult、Artifact + Quality Gate Contract | Runtime、执行、Artifact、Quality、API 任务 |
|    4 | [`04-domain-model-v0.1.md`](./04-domain-model-v0.1.md)                                                               | Aggregate、Entity、Value Object、状态机、命令、事件、不变量               | 领域实现与业务规则任务                     |
|    5 | [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](./05-cross-aggregate-consistency-module-boundary-v0.1.md) | Reference Project、跨 Aggregate 流程、事务/Saga、并发、幂等、补偿         | Application Service、流程和可靠消息任务    |
|    6 | [`06-typed-references-contract-catalog-v0.1.md`](./06-typed-references-contract-catalog-v0.1.md)                     | Typed Reference、Envelope、兼容性、201 个公开 Command/Query/Event 名称    | API、事件、跨模块集成任务                  |
|    7 | [`07-postgresql-logical-model-v0.1.md`](./07-postgresql-logical-model-v0.1.md)                                       | Schema 所有权、逻辑表、约束、RLS、Outbox/Inbox、对象存储边界              | 数据库、Repository、Migration 任务         |
|    8 | [`08-verification-baseline.md`](./08-verification-baseline.md)                                                       | 验证策略、跨模块验收场景、文档/实现/人工 Gate、测试结果口径               | 所有修改和审查任务                         |

Issue #57 的前置对象入口和未冻结参数决策记录在 [`../issue-57-enterpriseproject/Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md)。该文件是本 Work Item 的决策记录，不扩展当前 201 项公开 Catalog，也不替代 `06`、`Module-Spec` 或 `07` 的既有唯一权威范围。

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
| [`../module-specs/`](../module-specs/) 下七份 `Module-Spec-[ID]-[ModuleName].md` | 对应模块公开操作的 payload/result/event 字段、授权和模块错误 |
| [`../module-tests/`](../module-tests/) 下七份 `Module-Test-[ID]-[ModuleName].md` | 对应模块 Unit/Contract/E2E/Manual 用例、输入、预期、实际和结果 |
| [`../api-contract-v0.1/Task-Plan.md`](../api-contract-v0.1/Task-Plan.md) | 本阶段里程碑、任务分配、执行状态和人工审核 Gate |
| [`../api-contract-v0.1/Verification-Report.md`](../api-contract-v0.1/Verification-Report.md) | API 阶段 Catalog、字段、测试文档、Markdown 和 diff 静态验证证据 |

### 2.3 Feishu Channel Contract 阶段文档

Feishu Channel v0.1 的专项协议固定维护在 `.vibe/feishu-channel-contract-v0.1/`；该目录只拥有飞书原始事件/API 到现有 Core Contract 的 Anti-Corruption 映射，不创建第八个业务模块，也不改变 201 项公开 Catalog 的 Owner。

| 文档 | 唯一权威范围 |
|---|---|
| [`../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md) | 飞书事件接收、身份/Binding、消息/文件/卡片、出站投递、回执、撤回、重试、安全和 Core API 映射 |
| [`../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md) | Feishu Channel Unit/Contract/E2E/Manual 场景、输入、预期、实际和结果 |
| [`../feishu-channel-contract-v0.1/Task-Plan.md`](../feishu-channel-contract-v0.1/Task-Plan.md) | 本阶段里程碑、执行顺序、人工审核 Gate 与状态 |
| [`../feishu-channel-contract-v0.1/Verification-Report.md`](../feishu-channel-contract-v0.1/Verification-Report.md) | 官方协议证据、映射覆盖、安全边界、Markdown 和 diff 静态验证结果 |

### 2.4 Runtime Adapter Contract 阶段文档

Runtime Adapter v0.1 的专项协议固定维护在 `.vibe/runtime-adapter-contract-v0.1/`；该目录只拥有 WorkOrder/Run/AgentResult 与外部 Harness 协议之间的 Anti-Corruption 映射，不拥有 TaskExecution 业务状态，也不把 Runtime Session、文件或自报完成提升为 Core 事实。

| 文档 | 唯一权威范围 |
|---|---|
| [`../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md) | Execution Package、Adapter Port、本地 CLI Process Driver、标准事件、Lease/Fencing、Result/Usage、Resume/Retry、CLI Profile 与安全边界 |
| [`../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md) | Runtime Adapter Unit/Contract/E2E/Manual 场景、输入、预期、实际和结果 |
| [`../runtime-adapter-contract-v0.1/Task-Plan.md`](../runtime-adapter-contract-v0.1/Task-Plan.md) | 本阶段范围、里程碑、执行顺序、审核与提交 Gate |
| [`../runtime-adapter-contract-v0.1/Verification-Report.md`](../runtime-adapter-contract-v0.1/Verification-Report.md) | Provider 资料、API 映射、proposal、安全、Markdown 和 diff 静态证据 |

### 2.5 Implementation Milestone Plan 阶段文档

实施里程碑计划固定维护在 `.vibe/implementation-milestone-plan-v0.1/`；它只定义实施顺序、决策 Gate、交付物和退出条件，不拥有 Domain、API、数据库或 Adapter 语义。

| 文档 | 唯一权威范围 |
|---|---|
| [`../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md) | IM-DG-001 至 006、IM-00 至 09、目标代码边界与 Definition of Done |
| [`../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md`](../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md) | 已批准 Node.js/TypeScript/NestJS/Fastify/PostgreSQL/Kysely/Flyway/Test 技术基线与升级边界 |
| [`../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md`](../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md) | 已批准 Ubuntu 私有化、MicroCeph/Ceph RGW、OpenBao、Keycloak OIDC 与 Workspace UI 边界 |
| [`../implementation-milestone-plan-v0.1/Task-Plan.md`](../implementation-milestone-plan-v0.1/Task-Plan.md) | 本阶段范围、输入、步骤和提交 Gate |
| [`../implementation-milestone-plan-v0.1/Verification-Report.md`](../implementation-milestone-plan-v0.1/Verification-Report.md) | 路线、依赖、决策隔离、静态验证和剩余风险 |
| [`../im-01-exit-gate-issue-9/Task-Plan.md`](../im-01-exit-gate-issue-9/Task-Plan.md) | Issue #9 IM-01 退出 Gate 范围、#5/#9 修订口径与阶段 |
| [`../im-01-exit-gate-issue-9/Verification-Report.md`](../im-01-exit-gate-issue-9/Verification-Report.md) | Issue #9 干净 verify、数量对账、负向证据与 NOT RUN 清单 |

模块职责仍只由 `02` 冻结，公开名称/Owner 仍只由 `06` 冻结；Module Spec 不得重新划分所有权。API 阶段文档已于 2026-08-13 通过用户审核并构成当前字段级 API 基准，但不能覆盖已审核高层基准。

---

## 3. 按任务读取

Agent 应使用最小充分上下文，避免每次把全部约 1.5 万行文档注入 Prompt。

| 任务                              | 必读                                    | 需要时追加         |
| --------------------------------- | --------------------------------------- | ------------------ |
| 产品原则、范围或路线              | `HL-Spec`、`01`、`02`                   | `08`               |
| Aggregate/状态机/业务规则         | `HL-Spec`、`02`、`04`、`08`             | `05`、`03`         |
| 跨模块流程、Saga、幂等            | `HL-Spec`、`02`、`05`、`06`、`08`       | `04`、`07`         |
| Command/Query/Event API           | `HL-Spec`、`02`、`03`、`06`、`08`       | `04`、`05`、`07`   |
| PostgreSQL/Repository/Migration   | `HL-Spec`、`02`、`04`、`07`、`08`       | `03`、`05`、`06`   |
| 飞书 Channel                      | `HL-Spec`、`01`、`02`、`03`、`06`、`08` | `05`、`07`         |
| Runtime Adapter                   | `HL-Spec`、`02`、`03`、`06`、`08`       | `04`、`05`、`07`   |
| Implementation Milestone/代码脚手架 | `HL-Spec`、`02`、`05`、`07`、`08`、Implementation Plan | API、Module、Feishu、Runtime 专项 |
| Artifact/Quality/Approval/Release | `HL-Spec`、`02`、`03`、`04`、`05`、`08` | `06`、`07`         |
| 安全、权限、客户隔离              | `HL-Spec`、`02`、`06`、`07`、`08`       | `03`、`04`         |
| 架构或代码 Review                 | `HL-Spec`、`02`、`08`、实际代码/差异    | 所有受影响专题文档 |
| 字段级 Command/Query/Event API    | `HL-Spec`、`02`、`03`、`06`、`08`、共享 API Contract、对应 Module Spec/Test | `04`、`05`、`07` |

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
```

模块不是部署单元承诺，而是业务所有权、Repository、Schema 和公开 Contract 的边界。详细职责、非职责、端口、依赖和持久化要求只在 `02-zhiju-core-architecture.md` 中维护；完整公开 Contract 名称只在 `06-typed-references-contract-catalog-v0.1.md` 中维护；逻辑表只在 `07-postgresql-logical-model-v0.1.md` 中维护。

---

## 7. 当前基准状态

### 7.1 IM-02 WI-08 实现审查基线（2026-08-24）

IdentityPolicy 的 WI-08 代码已进入实现与审查阶段，当前涉及 RoleAssignment、CapabilityGrant、PolicySnapshot、首角色 bootstrap、真实 PostgreSQL persistence gate 及其 Command Handler。PR #48 的 R1-R6 修复已在当前工作区验证通过，但在最新精确 PR head 完成 review、合并及 Issue #36 状态核验前，本实现尚不代表 IM-02 完成，也不能把尚未接入的 ActorSnapshot、AuthorizationDecision、真实外部身份/Keycloak、业务 Approval/Release Handler 或人工验收标记为 `PASS`。

本阶段强制保持以下失败场景可验证：命令请求 Hash 覆盖全部业务输入；Project-owned 行同时受 Enterprise 与允许 Project scope 约束；并发唯一冲突返回稳定业务结果；bootstrap claim 原子且只产生一个首角色事实；撤销审计主体来自受信事务 Context；过期有效期被拒绝；正式 Role/Capability 变化产生完整的脱敏 Outbox Event。

当前实现验证证据：`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上执行 10 个 persistence 测试文件、156 个测试并通过；空库迁移包含 V1003 bootstrap claim 与 V1004 Project scope/RLS 增量，第二次 migrate 为 no-op；旧库形状的非空 V1004 升级探针也已确认保留 Project Revocation scope。真实 Provider、Keycloak、跨业务模块 Approval/Release、外部 E2E 和人工验收仍为 `NOT RUN`。

### 7.2 IM-02 WI-09 ActorSnapshot 与 AuthorizationDecision 审查基线（2026-08-24）

PR #49 的审查必须以当前 `galendai/36-im-02-wi-08-roles-capabilities-policy-snapshots` 分支为 base，并在集成该 base 后重新检查精确 PR head。WI-09 只有在以下事实均由实现和失败回归证明后，才能把相应子 Gate 标记为 `PASS`：ActorSnapshot 与 AuthorizationDecision 的 Enterprise/Project Scope shape 闭合；Project 必须属于受信事务 Context 的允许集合；ActorSnapshot Scope 必须与 Command Intent Scope 精确一致；ActorSnapshot 与 PolicySnapshot 均按精确 `id + payloadHash` 绑定；canonical payload 保留并覆盖完整的 actor、authentication context 和 Command Intent 事实；每个 AuthorizationDecision 都经唯一 Decision Port 持久化，包含 ALLOW/DENY、Purpose、Scope、command type/version、payload hash、认证上下文和过期时间。

WI-09 的公开 Query 输入、`AccessDecision`、`AuthorizationDecisionView` 与 `PolicySnapshotView` 必须直接遵循 IdentityPolicy Module Spec、生成 Schema 和 `ContractRegistry`，不得用只在内部成立的扁平引用冒充 Typed Reference。真实 PostgreSQL persistence gate、公开 Handler/HTTP、真实 Keycloak/Feishu Provider、跨模块 Runtime、外部 E2E 和人工脱敏追踪仍分别记录为 `PASS` 或 `NOT RUN`；静态 Registry 通过不等同于业务运行时验收。

WI-09 的授权覆盖必须按请求 Intent 的完整 Scope 精确匹配：Enterprise Scope 的 Role/Capability Grant 只能覆盖 Enterprise Intent，不能因 enterprise_id 相同而覆盖任意 Project Intent；Project Intent 必须由同一 Project 的 Grant/Role 事实覆盖。Project A/B 的隔离回归必须包含“仅有 Enterprise Grant、请求 Project Intent”的负例。

2026-08-24 审查修复基线已完成：以 base `0a3349eed0e4bb943a7a39b86f58a69888d8201a` 集成原 PR head `31c9c1061029b57722cae80c7b4b8da45496d522` 后，WI-09 的 Scope shape/allow-list、Actor/Intent Scope 精确一致、Actor/Policy/Decision 引用元数据与 `id + payloadHash`、完整 canonical facts、公开结果和 Registry 正负边界均有回归。静态/类型/架构/Catalog/兼容性检查通过；独立 `pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上为 `11 files / 166 tests PASS`，含双角色事务登录、二次迁移 no-op 和容器清理。最新 `pnpm verify` 编排在静态阶段全部通过后，因 Docker Hub 未认证拉取限流 `429` 未进入 Gate；不能把该次编排记为完整 PASS。公开 HTTP/Handler adapter、真实 Provider、跨模块 Runtime、外部 E2E 和人工验收仍为 `NOT RUN`。

已纳入当前基准：

- 产品与现场业务约束；
- 总体架构和七模块边界；
- Enterprise/Project、Task/Execution、Artifact/Quality 三条 Domain 链；
- 跨 Aggregate Reference Project、一致性、Saga、并发和幂等；
- 四个 Core Contract；
- Typed Reference、统一 Envelope、兼容性和 200 个公开 Catalog 条目；
- PostgreSQL Logical Model、Schema 所有权、RLS、Outbox/Inbox 和对象存储边界；
- 设计验证场景与统一验证口径。

高层基准审核状态：

- 用户已于 2026-08-12 确认当前高层文档包审核通过；
- 产品目标、架构规则、七模块所有权、核心 Contract、Typed Reference、Catalog 与 PostgreSQL 逻辑边界保持冻结；
- API 阶段不得静默改变上述决定。

已审核并纳入当前 API v0.1 基准：

- Command / Query / Event API Contract v0.1；
- 七个 Module Spec 与七个 Module Test；
- 200 个公开 Catalog 条目的字段级覆盖；用户于 2026-08-13 确认审核通过，静态 Gate 已 `DESIGN VERIFIED`，不代表实现或运行时验收通过。

已审核并授权进入下一阶段：

- Feishu Channel Contract v0.1；
- Feishu Channel Test v0.1 的 32 个场景；
- 8 个允许入站事件、6 个核心 Provider API 和 11 类 Channel Intent 映射；
- 4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个运行/真实飞书/人工场景仍为 `NOT RUN`；用户于 2026-08-16 指示继续下一阶段，四个向后兼容 optional minor 字段纳入 API v0.1 基准。

已获用户推进确认：

- Runtime Adapter Contract v0.1，已完成静态 `DESIGN VERIFIED` 并提交为 `c3e379c`；
- Runtime Adapter Test v0.1 的 32 个场景；
- Codex CLI、Claude Code CLI、OpenClaw CLI Capability Profile；
- 用户于 2026-08-17 要求提交当前文档并进入 Implementation Milestone Plan；该推进不自动批准 6 个 additive TaskExecution Command proposal。

已完成实施入口决策：

- Implementation Milestone Plan v0.1 与 IM-00；
- IM-DG-001 至 IM-DG-004 已于 2026-08-17 获用户批准；生产目标为 Ubuntu 私有单服务器，首期 API-first；
- 对象存储采用 MicroCeph/Ceph RGW，Secret/KMS 采用 OpenBao，认证入口采用 Keycloak OIDC；MinIO 因官方仓库归档被否决；
- IM-DG-005 已于 2026-08-27 获用户批准：Canonical Document/Workbook 使用共用不可变封装、Document/Workbook 双领域最小 Schema、稳定 Unit/Sheet/Row/Cell 身份、Canonical JSON + SHA-256，以及经 IntegrationGateway Attempt/Adapter/Receipt 的 Renderer 路线；2026-08-27 复审进一步确认现有通用 RenderAttempt Query 不足，IM-04 WI-01 以 additive 方式冻结只读 RenderAttempt Binding Query，当前 Catalog 由 200 项增至 201 项；详细记录见 [`../im-04-startup/Review-Record.md`](../im-04-startup/Review-Record.md)；
- IM-DG-006 仍待决，不阻塞 IM-01，但阻塞 IM-08。

当前 IM-01 TaskExecution 修复 Gate：

- PR #10 已把 37 个 TaskExecution 操作注册为 `FULL`，但代码审查发现 Core Contract 引用、WorkOrder 子结构、SourceWatermark、分页、ValueEnvelope、公开 Event 最小化、终态枚举和 optional 字段共 8 类 Schema 偏差；
- 修复必须以已审核的 `03-core-contracts.md`、共享 API Contract 和 `Module-Spec-003-TaskExecution.md` 为准，不得通过修改 Fixture 迁就错误 Schema；
- 8 类偏差已修复并于 2026-08-17 获用户确认；修复已提交并推送。与 `main` 中 PR #11 Core Schema 集成后，`TE-API-S-009` 至 `TE-API-S-017`、全量 106 个自动测试、架构与 Catalog Gate 均为 `PASS`；这不代表 Handler、数据库、Runtime 或人工验收通过。

尚未完成：

- RenderAttempt Binding Query、Canonical Document/Workbook 可执行 Schema、Fixture 与 Hash Gate（IM-04 WI-01 已完成本地实现与回归，Git 交付待用户检查）；
- 可执行 DDL、Migration、Repository 和业务代码；
- Renderer、部署、监控和运行手册；
- 未覆盖模块的自动测试、外部服务验证和人工验收。

### 2.2 IM-04 WI-01 实现边界（2026-08-28）

- WI-01 只新增 `CanonicalContentPayload`、`CanonicalDocument`、`WorkbookSpec`、独立 `CanonicalContentManifest` 的可执行 Schema、确定性 Canonical JSON/SHA-256 helper、生成类型和负向 Contract Fixture；不新增 Artifact 业务表、Repository 或 Handler。
- Canonical Document 在 Contract 边界拒绝重复 Unit ID、孤儿/不对称父子引用、环和同父级重复 ordinal；Workbook 在 Contract 边界拒绝重复局部身份、跨 Sheet Column 引用和畸形公式。
- `integration.get_render_attempt_binding@1.0` 是唯一新增公开 Operation，返回原始 RenderRequest、request payload hash、成功结果和 raw receipt ref；Binding Result 不允许 Provider 凭证、Presigned URL 或其他秘密字段。
- `contracts/baselines/v1.0/` 继续作为不可改写的历史 200-operation 基线；当前 201-operation Catalog 中新增的独立 1.0 Contract 由 compatibility gate 记录为 `COMPATIBLE_MINOR`，不伪造新的历史基线。
- WI-01 自动 Contract/Schema/类型/静态 Gate 可执行；对象存储、Renderer、业务 Persistence、公开 HTTP、Provider、跨模块 E2E、生产和独立人工业务验收仍为 `NOT RUN`。

建议的下一阶段：

```text
Command / Query / Event API Contract v0.1  （BASELINE / USER REVIEWED 2026-08-13）
    ↓
Feishu Channel Contract v0.1  （BASELINE / USER PROGRESSION CONFIRMED 2026-08-16）
    ↓
Runtime Adapter Contract v0.1  （BASELINE / USER PROGRESSION CONFIRMED 2026-08-17）
    ↓
Implementation Milestone Plan v0.1  （BASELINE / IM-00 COMPLETE）
    ↓
IM-01 Repository + Executable Contracts  （COMPLETE / FULL 200 + ENVELOPE_ONLY 0 / FIELD-LEVEL SCHEMAS + SCHEMA-DERIVED TYPES + V1.0 COMPATIBILITY BASELINE LANDED / ISSUE #9 CLOSED BY PR #20 / ISSUE #5 FIELD-SCHEMA SCOPE COMPLETE VIA PR #14 / RELEASE RUNTIME GAPS TRACKED BY #22–#24 / ISSUE #17 LOCAL IG RUNTIME SLICE LANDED / HANDLER + ADAPTER + DB TRACKED BY #27 / HANDLER + DB + EXTERNAL GATES REMAIN NOT RUN）
    ↓
    IM-02 PostgreSQL Foundation + IdentityPolicy  （COMPLETE / ISSUE #28 CLOSED / PR #51+#52+#53+#54+#55 MERGED / WI-01–WI-10 CORE GATES + AGENT-EXECUTED LOCAL RUNBOOK PASS / EXTERNAL PROVIDER NOT RUN）
    ↓
IM-03 EnterpriseProject Reference Foundation  （IN PROGRESS / WI-01 DESIGN DECISION RECORDED / WI-02 APPLICATION+PERSISTENCE FOUNDATION / WI-03 BUSINESS VERTICAL SLICE LANDED / WI-04 PROJECT START SNAPSHOT LANDED / USER CONFIRMATION REQUIRED）
```

IM-02 的 RLS Context 物理机制已经进入 WI-03：上下文存放于
`platform_security.tx_context`，以 backend pid 与事务 ID 键控，不使用可由调用方任意
`SET` 的自定义 GUC。普通七模块 Runtime Role 与 `projection_app` 只能调用只读 RLS
helper，不能建立或清理 Context；唯一写入口只授予 NOLOGIN 的
`platform_context_establisher`，由受信事务协调器先建立 Context、再切换到目标 Runtime
Role。详细威胁模型与测试边界以
[`../im-02-workitem-issues/rls-context-design-wi-03.md`](../im-02-workitem-issues/rls-context-design-wi-03.md)
为准。IdentityPolicy 对 AuthorizationDecision 业务真实性、Scope、Purpose 与 Intent 的完整
校验仍由 WI-09 负责，不能因 WI-03 数据库 Gate 通过而声明授权链完成。

---

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

截至 2026-08-27 的前置基线已完成 IM-00 与 IM-01 Repository + Executable Contracts（Issue #9 / PR #20）。工程骨架、共享内核、Core 字段级 Schema、200 个 API Envelope、自动测试、架构/Catalog Gate、Schema-derived Type、v1.0 compatibility baseline 与 HTTP health smoke 已通过；IdentityPolicy 20 个、EnterpriseProject 32 个、TaskExecution 37 个、Artifact 26 个、QualityGovernance 37 个、ReleasePublication 25 个与 IntegrationGateway 23 个操作均已具有字段级 Payload/Event Schema 和 Query Result Schema；Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。干净 checkout 证据见 [`.vibe/im-01-exit-gate-issue-9/Verification-Report.md`](../im-01-exit-gate-issue-9/Verification-Report.md)。Schema 衍生类型见 `.vibe/im-01-executable-schema-typescript/`；兼容性基线见 `.vibe/im-01-v1.0-schema-fixtures/`。PR #10–#14、#16、#18、#19 的 Schema/类型/兼容性实现与 review 修复均已保留。2026-08-21 用户批准修订 Issue #9：硬依赖改为 #1–#8 的 Schema 子切片均已合入，#5 的 Runtime 状态不阻塞本 Gate；随后用户批准将 #5 收敛为字段 Schema 边界。Issue #5 的字段级目标已由 PR #14 完成，重复 / 迟到回执由已关闭的 #15 完成；未实现的 Release Authorization ActorSnapshot/actingFor、`providerResult` PII 最小化、普通飞书发送 Formal Release 来源链分别由 #22、#23、#24 承接，不能因 #5 关闭而视为 Runtime `PASS`。#17 的本地 IntegrationGateway Runtime 切片已在 `modules/integration-gateway` 落地：幂等、Quarantine、UNKNOWN、协议/完整 Revision 绑定、撤回 Origin（adapter/account/message）、显式授权和 Audit/Masking focused tests 全部通过；timeout 后迟到的 Adapter rejection 不得改写 `UNKNOWN`，也不得成为 unhandled rejection。真实 Provider、数据库、HTTP Handler、外部和人工验收仍保持 `NOT RUN`，改由 [Issue #27](https://github.com/qzhike/zhiju-business-core/issues/27) 追踪。IM-02 已完成代码、数据库和文档验收：PR #51/#52/#53/#54/#55 已合入 `main@47d1b57`，最终 main 完整 verify、Persistence `12/177`、Migration/no-op、Runbook 和 Probe 证据均通过，Issue #28 已关闭。真实 Provider、数据库外部 Adapter、HTTP Handler、跨模块业务 E2E 和生产人工验收仍保持 `NOT RUN`；IM-02 scoped 目标已完成。IM-RP-001（Issue #15）在 `modules/release-publication` 落地 Runtime Receipt Validator（重复 / 迟到回执检测、RawExternalReceipt outcome/payload/time provenance、package↔release 与完整 scope 绑定、Ledger `compareAndSaveAttempt` / `compareAndSaveReceipt` 原子落账）；持久化载体仍为 In-Memory Ledger。数据库 DDL/真实 Repository、IntegrationGateway 飞书/邮件 Provider 注入（#27）与 HTTP Handler 仍 `NOT RUN`，不得冒充业务 E2E。6 个 Runtime additive proposal、IM-DG-006 仍待独立审核；IM-DG-005 已于 2026-08-27 独立批准，但其代码、数据库、外部和人工运行验证仍为 `NOT RUN`，不得冒充业务 E2E。

## IM-04 WI-01 Canonical Schema 与 Binding Query 当前交付状态（2026-08-28）

Issue #90 的本地实现已完成：Artifact 提供 `CanonicalContentPayload`、`CanonicalDocument`、`CanonicalWorkbookSpec`、独立 `CanonicalContentManifest` 的 executable Schema 与结构不变量校验；shared-kernel 提供严格四字段 Canonical JSON/SHA-256 helper；IntegrationGateway 新增唯一的 `integration.get_render_attempt_binding@1.0` Query，并生成 201-operation/45-query-result 类型与 Catalog 元数据。当前 Catalog/Registry 为 `FULL:201 / ENVELOPE_ONLY:0`（Command=95、Query=45、Event=61），`contracts/baselines/v1.0/` 仍不可改写并保持历史 200-operation 快照。

本地证据为：`pnpm build`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check` 全部 `PASS`；`pnpm test` 为 `25 个测试文件 PASS / 17 个 skipped`、`363 passed / 241 skipped`；`pnpm verify` 完整通过，PostgreSQL/Flyway persistence 为 `21 个测试文件 / 256 个测试 PASS`，空库迁移、二次 migrate no-op 和容器清理均通过。

本 WI 不实现 Artifact 业务表、Repository、Handler、Object Storage Link、Renderer、Provider、公开 HTTP、跨模块 E2E、生产或独立人工业务验收；这些边界继续为 `NOT RUN`。Git commit、push、PR exact-head CI、merge、Issue #90 close、远端/local branch 清理和最终 main ancestry 仍须在用户检查当前变更后分别执行和回读。

IM-02 WI-06 的 IdentityPolicy Command transaction runner 必须以数据库唯一约束执行原子幂等 Claim；并发同 key/hash 的 loser 必须返回首个已提交结果，不能泄漏 `unique_violation`。受信事务上下文的 Principal、ActorSnapshot、AuthorizationDecision、Enterprise、Project 与 Correlation 必须和待持久化 Envelope 一致；CAS 只能操作 Envelope 指定的 target 与 expected version，并保持 PostgreSQL `bigint` 精度。业务拒绝的稳定结果必须包含 `currentAggregateVersion`。已应用的 Flyway 版本化 Migration 不得原地改写，新增列只能由后续 forward-only Migration 追加。

PR #11 的 Core Contract 字段级 Schema review 修复已合并至 `main`：该切片恢复既有 `required`、Typed Reference 强度、Set 基数和 `ValueEnvelope` 条件约束，不改变冻结的 Core Contract 业务语义，也不扩大 IM-01 范围。修复记录见 [`../im-01-core-contract-review-fix/Task-Plan.md`](../im-01-core-contract-review-fix/Task-Plan.md)。TaskExecution 直接复用该权威 WorkOrder Schema 的共享 `$defs`，不得维护第二套 WorkOrder 子结构。QualityGovernance PR #13 的 review 修复同样要求 Result Schema 直接引用已注册的 Core Contract ID（`revision-acceptance/1.0`、`approval-bundle/1.0`、`release-readiness/1.0`），不得维护第二套截断视图。

### IM-02 WI-07 实现审查约束（2026-08-24）

IdentityPolicy 的 WI-07 实现必须继续服从已经审核通过的字段级 Contract，不得用内部简化对象替代公开 Schema：公开 Event/Query Result 中的 `ObjectRef`、`ContentAddressedRef` 和 `ValueEnvelope` 必须保留完整结构；ExternalIdentity 的 account 与 subject 两个组成部分必须共同参与幂等摘要和事件引用；bootstrap claim 的消费必须在数据库事务内锁定并由条件更新裁决，同一 claim 的并发争用只能产生一个成功结果；非法闭集值和业务拒绝必须经过 Command receipt/audit 边界。WI-07 的 bootstrap claim 表必须使用不与 WI-06 冲突的后续 forward-only Migration（当前为 `V1003`），不得复用 `V1002`。真实 Keycloak/OIDC、飞书 Adapter、OpenBao 生产加密和人工验收仍保持 `NOT RUN`，不得因本地实现或测试替身而升级状态。

本轮 PR #47 修复已通过完整 `pnpm verify`、ContractRegistry 直接探针和真实 PostgreSQL persistence gate；上述外部 Provider、生产密钥、跨系统 E2E 与人工验收边界仍保持 `NOT RUN`。

WI-07 本地手工 Probe 的 AES-256-GCM 测试 Port 必须先完成 `cipher.update()` 与 `cipher.final()`，再调用 `getAuthTag()` 并组装脱敏 Fixture；测试替身的调用顺序错误不得被记录为生产加密或 IdentityPolicy Repository 失败。修订后的 Probe 结果仍只能证明本地脱敏 Fixture，不能升级真实 OpenBao、Keycloak/OIDC、飞书 Adapter 或人工验收状态。

## IM-03 WI-01 当前决策状态（2026-08-25）

- Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和 Platform Template/Regulatory Reference 的唯一 Owner 均为 EnterpriseProject；其入口已冻结为受控 Application Capability，不允许测试、Migration 或跨 Schema Join 直接造业务前置数据。
- 现有 32 个 EnterpriseProject `@1.0` Contract 和全局 200 项 Catalog 保持不变。受控 Capability 暂不进入公共 Registry；若未来需要跨模块公开，必须另行完成 Schema、生成类型、Catalog、兼容性 baseline 和负向 Fixture 同步。
- `project.create_project@1.0` 必须接收同一 Enterprise Scope 下的 EnterpriseProfileSnapshot、QMSConfigurationVersion 和 ProductScopeSnapshot；`latest`、Scope 替代和隐式数据库补齐均被拒绝。
- Gap 输入版本变化只产生 `STALE`/Impact Review 事实，不改写旧 Gap、Context、Plan 或 Artifact；`NOT_PROVIDED`、`UNKNOWN` 和 `MISSING_CONFIRMED` 保持区分。
- 本决策仍需用户审核；后续业务 DDL、Repository、Handler、真实 PostgreSQL 业务链和“采购控制程序”人工验收保持 `NOT RUN`。

## PR #69 审查状态（2026-08-25）

- 审查基准为精确 head `9c02ac80491b3d60c59685c2ea1ac33ce875981c`；该 head 没有业务运行时代码差异，exact-head CI 的 `verify` 已通过。
- 当前本地复跑 persistence gate 因 Docker Hub manifest 查询返回 `EOF` 被环境阻塞；这不构成业务测试失败，也不能把业务实现从 `NOT RUN` 提升为 `PASS`。

## PR #72 审查修正状态（2026-08-25）

- 审查基准为精确 head `9037185967329c7e024bdef9b75f99f1653c8554`，base 为 `a34c72503c842f0d81d7bded28a3fa344dd886ca`；PR 仍为 OPEN，Issue #59 未由 GitHub 自动关联关闭。
- 已发现并进入修正范围：业务公开 Handler 与生成 Contract 的 Typed Reference/ValueEnvelope/SnapshotResult 不一致；Human-only 不能把缺失 `principalKind` 当作 HUMAN；Fact 首次 Root CAS 造成聚合版本与 Outbox 版本错位；Product/QMS/Profile 多处精确引用只校验 versionId 而忽略 objectId；重复 Product displayCode 的异常路径会在 PostgreSQL 事务中止后继续写 Receipt/Audit；QMS 初始指针使用伪造 UUID 且未验证 Enterprise ACTIVE；Product/QMS 后续版本创建未推进 Root aggregate version；Profile 未保存完整 Product/QMS 精确版本内容。
- 本地第一次 `pnpm persistence:gate` 已完成 PostgreSQL 18.6 / Flyway 11.20.3 空库迁移，但 Vitest 因 workspace 包尚未先 build 而出现 8 个包入口解析失败；该次只作为基线失败证据，不能记为业务 PASS。修正后先完成 workspace build，门禁复跑为 `14` 个 Persistence 文件、`202` 个测试通过，二次 migrate 为 no-op，容器已清理。
- 修正后的本地 `pnpm verify` 已通过：Format、Lint、Typecheck、Unit Test（`21 passed / 12 skipped`，`348 passed / 189 skipped`）、Architecture、Contracts（200 operations）和 PostgreSQL Persistence Gate 均通过。业务实现仅证明上述本地自动化边界；真实 Provider、HTTP、跨模块 E2E 和人工业务验收继续保持 `NOT RUN`。
- 修正文件仍需用户检查；在用户确认前不宣称已 Commit、Push、PR Merge 或 Issue Close。

## IM-03 WI-04 Project 启动快照、Scope 与对象验证（2026-08-25）

Issue #60 在 WI-02 事务基础和 WI-03 业务纵向切片之上落地 Project Aggregate、ProjectScopeClaim 与 ProjectSnapshotBinding 三张业务表，并落地 `project.create_project` Handler 与 `project.validate_object_scope` 权威 Query。该切片为所有 Project-owned 切片建立不可迁移的 Enterprise/Project 边界。

- V2003 migration 新增 `enterprise_project.project`、`project_scope_claim`、`project_snapshot_binding` 三表。Project Root 的 `(enterprise_id, project_id)` 与 `member_policy_*` 列通过 BEFORE UPDATE trigger 双层保护，跨 Enterprise / 跨 Project / 跨 MemberPolicyRef 变更均拒绝。ProjectSnapshotBinding 表 `REVOKE UPDATE, DELETE` 给 app role；`(project_id, binding_purpose)` `UNIQUE` 保证同 Project 不被替换 binding。后续 forward-only V2004 把三张表的 INSERT RLS 与 `context_allows_enterprise(enterprise_id)` 绑定，V2005 修正 binding scope mirror 的 JSONB 访问路径。
- 所有 Project-owned 表启用 RLS FORCE：`project` 与 `project_snapshot_binding` 通过 `context_allows_project(enterprise_id, project_id)`；`project_scope_claim` 同时校验 Enterprise 与 Project helper。Enterprise-only Context 不能读取 Project-owned 行；Project 行不能跨 Project 枚举。新 Project 不能依赖 `ON CONFLICT` 或 `RETURNING` 的 RLS 读取路径，因为尚未进入 allowed project 集合；重复 `display_code` 必须使用受保存点保护的唯一约束回滚路径，Project ID 直接使用应用已生成的 UUIDv7。
- `project.create_project` Handler 在同一事务内：(1) 校验 `ProjectStartSnapshot` 三必填 ref（Profile/QMS/ProductScope）与可选 ref 的 shape、scope、contentHash；(2) 拒绝 `latest` / `current` 与跨 Enterprise scope；(3) Handler 生成 Project UUIDv7 后，把它同时绑定到 Command Envelope 的 `projectId` 和本次事务的 allowed-project 集合，保证 Receipt/Outbox/Reference Edge 与 Project Root 使用同一精确 Scope；(4) 重新读取持久化快照行二次校验 hash；(5) 写入 Project Root、ScopeClaim、SnapshotBinding，canonical payload 省略未提供的可选 ref，不写入 `undefined`；(6) 写 Outbox `Enterprise.ProjectCreated`；(7) 写 Reference Edge 链接 StartSnapshot 与 memberPolicy。`VersionedRef` 合约本身不携带 `contentHash`，因此不能写入伪造的全零 hash；没有可用 digest 时持久化 NULL。失败码：`PROJECT_PROJECT_DISPLAY_CODE_CONFLICT`、`PROJECT_START_SNAPSHOT_INCOMPLETE`、`PROJECT_START_SNAPSHOT_SCOPE_MISMATCH`、`PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN`、`PROJECT_MEMBER_POLICY_REF_INVALID`。
- `project.validate_object_scope` 权威 Query 仅接受 `OBJECT` / `VERSIONED` / `CONTENT_ADDRESSED` / `SNAPSHOT` 类型 Ref；必须按 `objectType` 使用已知表与真实主键列，并同时匹配对应的 object/version/snapshot identity，再按 `expectedScopeRef` 走 RLS helper 查 `(enterprise_id, project_id)`。不得使用不存在的通用 `object_id` 列，也不得在 Enterprise/Project 间搜索替代对象。失败码：`PROJECT_OBJECT_SCOPE_MISMATCH`。
- Repository 与 Handler 已扩展：`EnterpriseBusinessRepository` 新增 `insertProject / getProjectById / casProject / insertProjectScopeClaim / getProjectScopeClaimByProjectId / insertProjectSnapshotBinding / getProjectSnapshotBinding`；WI-04 共 6 个业务失败码（含对象范围验证）。
- 本切片的 PR #73 修复必须先完成规格、测试和 forward-only migration，再以 exact-head 的 Disposable PostgreSQL 证据复验；真实 Provider、HTTP、跨模块 E2E 和人工业务验收仍为 `NOT RUN`。

## PR #73 修复基线（2026-08-26）

- PR #73 原始 head `412b14af1213b481e8229d9f671ee1fe57522373` 的远端 `verify` 因 `enterprise-business-handlers.ts` 与 `enterprise-project-scope.test.ts` 格式失败而失败；本地 persistence gate 进一步复现 Project 新建路径的 `42501 new row violates row-level security policy for table "project"`。
- 复核确认 `insertProject` 使用 `(enterprise_id, display_code) ON CONFLICT DO NOTHING RETURNING project_id`，而 PostgreSQL RLS 的 arbiter/RETURNING 路径需要新 Project 已可见；这与“新 Project 尚未加入 allowed project 集合”的安全边界冲突。修复采用固定保存点 + 无 RETURNING 的唯一约束冲突识别，不放宽 Project SELECT policy。
- 复核确认对象验证使用了不存在且未按 `objectType` 分派的 `object_id` 查询。修复采用代码内闭集表/列映射，并精确绑定 objectId、versionId 或 snapshotId。
- gate 在修复 RLS 与 canonical payload 后继续暴露 V2003 binding scope mirror trigger 的 JSON 路径错误：`jsonb->>'scope'` 已返回 text，不能再使用 `->>'enterpriseId'`。修复通过 forward-only V2005 重建 trigger，使用 `jsonb->'scope'->>'enterpriseId'`。
- 复核确认 `VersionedRef` 没有 `contentHash` 字段；修复不扩大公共 Contract，而是允许 member policy payload hash 为 NULL，禁止用全零 hash 伪造摘要。`P-005` 的测试也改为断言 Command Result 的业务拒绝，而不是错误地等待 Handler 抛异常。

## PR #73 修复结果（2026-08-26）

- 修复后 `pnpm verify` 全部通过：Format、Lint、Typecheck、Unit（21 个文件通过 / 13 个 skipped，348 passed / 201 skipped）、Architecture、Contract（200 operations）和 PostgreSQL Persistence（15 个文件、214 passed）均为 `PASS`。
- Persistence 使用 pinned PostgreSQL 18.6 / Flyway 11.20.3；空库迁移包含 V2004、V2005，二次 migrate 为 no-op，gate 容器已清理。WI-04 的 Project 创建、保存点去重、跨 Enterprise RLS 负向、对象精确 Scope、binding 不可更新和 member policy NULL hash 均有真实 PostgreSQL 证据。
- 以上只证明当前工作区和 Disposable PostgreSQL 边界；真实 Provider、公开 HTTP、跨模块 E2E、生产环境和人工 Reference Project 验收继续保持 `NOT RUN`。PR comment、commit、push、merge、Issue #60 close、远端 branch 删除和 main ancestry 尚待 exact-head 交付步骤完成。

## IM-03 WI-05 SourceMaterial 实现边界（2026-08-26）

Issue #61 的实现必须继续服从 EnterpriseProject 唯一 Owner 和现有公共 Contract，不扩展 200 项 Catalog。SourceMaterial Root 是 Project-owned 原始材料身份；`source_material_origin` 保留每次 ExternalRef 来源；`source_material_validation` 追加 Security/Integrity 通过或失败事实。登记后的原始 ContentHash、ByteLength、MediaType、OriginalName、Staged ObjectLocator、Scope 和 Origin 历史不可原地修改；相同 Hash 的不同来源保留独立 Root，不静默合并。

`project.accept_source_material` 只能消费精确 `expectedAggregateVersion`、Project Scope、ContentHash/长度/ObjectLocator 一致且均为 `PASSED` 的 Security/Integrity Validation Ref。缺失、失败、跨 Project、错误 id/hash 或 Locator 不匹配均安全拒绝且不写 `SourceMaterialAccepted`。接受成功在同一 EnterpriseProject 事务内 CAS Root、写 Audit/Receipt/Reference Edge 与最小 Outbox 事实；Event 不携带 `originalName`、客户原文、bytes、Staged ObjectLocator 或完整 Validation payload，也不自动创建 CustomerMaterial、Baseline、Fact 或 Evidence。

WI-05 的 Module Spec/Test 已同步写入上述不变量、Failure Code、Disposable PostgreSQL 用例和人工验收边界；当前代码、迁移与 Disposable PostgreSQL gate 已通过 221 个测试，Unit/Persistence 为 `PASS`。真实 Feishu 下载、恶意文件扫描、Ceph/OpenBao、Object Staging/Link/Orphan Cleanup、公开 HTTP、跨模块流程和生产验收不因本切片变为 `PASS`，人工 Reference Project 验收仍为 `NOT RUN`。

## IM-03 WI-02 审查修正约束（2026-08-25）

- Command write boundary 必须执行 target/reference/scope/purpose 校验：Outbox 的 `aggregateType + aggregateId` 必须与当前 Command Envelope target 完全一致；Reference Edge 的 owner 必须与同一 target 完全一致。
- Outbox 的 `aggregateVersion` 必须是当前 Command 产生的精确版本：CREATE/无 expected version 使用 `1`，CAS 使用 `expectedAggregateVersion + 1`；所有 PostgreSQL `bigint` 版本保持字符串/BigInt 精度，禁止写入任意版本制造事件间隙。
- 技术 Repository 的 `created_by_principal_id` 必须绑定当前受信事务 Context 的 Principal；调用者提供不一致的主体必须在事务内以稳定错误拒绝，不能让 RLS 只保护 Scope 而留下审计主体漂移。
- 以上拒绝必须发生在 Receipt/业务技术表/Outbox/Reference Edge 提交前，并由回归测试证明失败事务不遗留行；真实 Provider、公开 HTTP、业务 Handler 和人工 Reference Project 仍保持 `NOT RUN`。

## IM-02 远端交付快照（2026-08-24）

PR #51 的实现复审基准为 `47a2a9d`，PR #51 已合并；PR #52 的 Gate 隔离修复、PR #53 的 Runbook/验收文档修订、PR #54 的 COMPLETE 状态同步和 PR #55 的关闭状态同步均已 exact-head review、CI 验证并合并。最终 main@47d1b57 的完整 `pnpm clean && pnpm verify` 证据已由前一主线提交复核，Persistence 为 `12 files / 177 tests`，14 个 Migration 成功且二次 migrate no-op；WI-02/03/04/09 Agent-executed local Runbook 和 WI-06/07/10 Probe 均有证据。真实 Provider、跨模块 E2E、生产环境和外部人工业务验收仍保持 `NOT RUN`；Issue #28 已关闭。

## 14. IM-02 合并后干净 main 最终复验（2026-08-24）

PR #51 已使用 `--match-head-commit` 合并，合并提交为 `8f5c0701ace93ce88ec55acde753e5abcd07fa2c`；PR #52 的 Gate 隔离修复以精确 head 合并为 `64e3040b58093548a477021595d3c2f554b07e45`，PR #53 的文档跟进以精确 head `89673bb` 合并为 `36825118c6b2483dd365879179b390205549dab7`，PR #54 的 COMPLETE 状态同步以精确 head `cdf2cb7` 合并为 `47d1b57a2a51e2d4c458406de8af0eecd0a2ed8a`。Issue #28 已关闭；PR #55 只同步 CLOSED 状态。Runbook 级本地探测记录见 [Runbook-Manual-Acceptance-2026-08-24.md](../im-02-acceptance-issue-28/Runbook-Manual-Acceptance-2026-08-24.md)。真实 Provider、生产环境和外部人工业务验收保持 `NOT RUN`；IM-02 已完成。

## 12. IM-02 WI-04 标准事务技术表边界

七个 owning Schema 分别拥有 `command_receipt`、`outbox_event`、`inbox_message`、`process_instance`、`process_step`、`audit_record`、`reference_edge`、`contract_violation`，不得建立跨模块共享写入的超级技术 Schema。IdentityPolicy 的 Platform 事实使用独立表，不与 Enterprise 数据通过 nullable Scope 混表。

- nullable `project_id` 的 RLS 必须按行裁决：NULL 行校验 Enterprise Context，非 NULL 行同时校验 Enterprise 与允许的 Project 集合；同 Enterprise 不代表可访问任意 Project。
- `process_step` 的 Enterprise/Project Scope 必须与父 `process_instance` 完全一致，不能仅凭 `process_id` 建立跨 Scope 事实。
- `reference_edge` 的 owner 精确身份包含可选 `owner_version_id`；不同不可变 owner version 可以保存同路径到同 target 的 Edge，同一精确 owner/path/target 才判重。
- `audit_reader` 只能读取 masked 列，但 masked view 必须返回已提交的权威 Audit 行；底表整体读取、敏感列、UPDATE 与 DELETE 仍拒绝。
- 数据库层负责 promoted Scope 镜像、hash 长度与不可变写面；Canonical Payload 与 SHA-256 的强一致性由 WI-05/WI-06 owning Repository 在同一事务写入路径完成。在对应 Repository Gate 通过前，该项保持 `NOT RUN`，不能作为 WI-04 数据库 PASS。

## 13. IM-02 WI-10 Outbox/Inbox 实现约束

WI-10 在 IdentityPolicy owning schema 内提供受限 Outbox Dispatcher 与 Inbox Consumer 的持久化切片。它遵循至少一次投递：不能生成新 EventId 掩盖重试，也不能宣称 exactly-once。

- Outbox Dispatcher 只能更新 delivery metadata；业务 payload、EventId、Event 类型/版本、Aggregate 标识和 Aggregate Version 不可由 Dispatcher 改写。
- Dispatcher 使用 `owner + lease_until + fencing token`。`PENDING/UNKNOWN` 到期事件和已过期 `LEASED` 事件都可 claim；同 Aggregate（`aggregate_type + aggregate_id`）的 earliest unpublished event 阻塞后续版本，不同 Aggregate Type 即使 ID 相同也不得互相阻塞。旧 token 的 ACK/失败回写必须拒绝。
- retry/dead-letter 的状态转移依据数据库 `attempt_count` 原子决定，调用方不得通过自报 attempt 绕过阈值。超时保留原 EventId，进入 `UNKNOWN` 和指数退避；超过策略阈值进入 `DEAD`。
- Inbox 的目标状态、目标 Outbox、Audit、Command Receipt 与 `PROCESSED` 标记在同一 owning-module transaction 中提交。输入 payload 必须按 canonicalization v1 重新计算 SHA-256；Enterprise/Project Scope 必须与 Event mirror 和 transaction context 精确一致。
- 同 consumer + EventId + 同 payload hash 重放读取原结果并返回 `DUPLICATE`；同 EventId 不同 hash、Hash 校验失败、未知 Major、缺少 Required Extension 或 Scope 冲突必须 Quarantine/Violation，不能执行 target Command。
- 并发 Inbox claim 的唯一键竞态必须在应用边界内 adjudicate，胜者结果提交后败者读取原结果，不得把 PostgreSQL 唯一键异常暴露为业务失败。
- 真实 PostgreSQL 的事务协调器 fixture 必须使用 `NOINHERIT` 登录，并以 `INHERIT FALSE, SET TRUE` 同时持有 `platform_context_establisher` 与目标 module app role；事务内必须按 `establisher → establish context → app role` 顺序切换。仅持有 app role 的 fixture 不得被记录为 WI-10 persistence PASS。
- WI-09 Decision Port 产生 `DENY` 时，必须在保存不可变 AuthorizationDecision 的同一 IdentityPolicy 事务中写入安全 `AuditRecord`；Audit 只能保存 reason code、hash 和脱敏摘要，不得写入原始命令 Payload 或 External Identity。
- Scope conflict 的 Quarantine 不能把未经验证的 Event Scope 放入 Command Envelope 或 RLS 行 Scope；持久化时只使用受信 transaction Context 的 Enterprise，只有在 Event Enterprise 与 Context Enterprise 相同且 Project 属于 `allowedProjectIds` 时才保留 Project，否则以 `NULL` 作为当前 Enterprise 下的安全 Quarantine Scope，并保留 Violation 类型/摘要用于调查。
- 2026-08-24 Runbook 可复现性修订：WI-02 排除 PostgreSQL `pg_` 预定义角色；WI-03 的 SHA-256 fixture 使用 32 字节输入并在 `COMMIT` 后重新切回 app role；WI-04 的 migration walker 在容器内执行，并补充 privileged audit seed 后的 masked-view 验收。上述修订只改善本地人工验收命令，不扩大生产权限或外部系统验收范围。
- DEAD 人工 resume 必须记录不可变、脱敏且包含 operator reason 的 Audit；生产 broker、Provider、外部副作用和人工业务验收不因本地 PostgreSQL gate 自动变成 `PASS`。
- WI-10 本地 ACK-loss Probe 的初始 Principal Fixture 必须显式写入 `status='ACTIVE'`；Probe 不得依赖技术表存在未定义的 status 默认值，也不得用放宽数据库约束掩盖 Fixture 错误。

WI-10 初始修正已提交并推送至 PR #50；最新 base 集成暴露的 messaging fixture ACL、Enterprise Grant 覆盖 Project Intent、typed Aggregate ordering 与未经验证 Event Scope 回归已在提交 `47a2a9d` 修复，并由跟进 [PR #51](https://github.com/qzhike/zhiju-business-core/pull/51) 交付到 `main`。重新编译 workspace 包后，真实 PostgreSQL gate 为 `12 files / 177 tests PASS`，空库迁移、二次 migrate no-op 和容器清理通过；最终 `pnpm clean && pnpm verify` 亦通过：Vitest `20 passed | 10 skipped`、`341 passed | 164 skipped`，architecture、Public API、generated types、Catalog/Registry 与 compatibility 全部通过。PR #51 的 exact-head CI/语义复审、生产 Broker、Provider、外部副作用和人工业务验收仍未完成，本节不将这些边界写成完成状态。

## IM-03 WI-06 CustomerMaterial 设计基线（2026-08-26）

Issue #62 在 WI-05 SourceMaterial 接受边界之上实现 CustomerMaterial 的提议与确认闭环。该切片复用既有 `project.propose_customer_material@1.0`、`project.confirm_customer_material@1.0` 和 `project.CustomerMaterialConfirmed@1.0`，不扩展公共 Catalog。

- 每次提议创建独立 CustomerMaterial Root 与 v1 `PROPOSED` Version；同一已接受 SourceMaterial 可以被多个提议引用，以保留不同解析/分类候选。
- 确认不原地改变候选 Version，而是追加 v2 `CONFIRMED` Version，Root 以 CAS 推进 aggregate version 并指向 v2；候选和确认版本均不可修改。
- 所有确认在当前没有低风险自动确认 Policy 输入的前提下执行 Human-only 检查。Agent 或 `actingFor` 不能确认关键材料；可信事务 Context 的 `principalKind` 是唯一权限依据。
- SourceMaterial Selection 必须是当前 Project 下 `ACCEPTED` SourceMaterial 的精确 ContentAddressedRef，Scope、object id、ContentHash 和 canonicalization version 均需匹配；对当前没有业务 immutable version 的 SourceMaterial，额外携带 `immutableVersionId` 也必须拒绝。Selection 的 `locator` 仅表示源内页码/章节等位置，不冒充受控对象存储 locator；Evidence/Justification 只保存精确 Ref、Hash 和脱敏摘要，不复制客户原文。
- 确认前发现同一 Project 中共享 SourceMaterial 且分类指纹不同的其他 `PROPOSED` 候选时，返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`，不修改任何候选、不使用 last-write-wins、不产生确认 Event。
- `customer_material`、`customer_material_version`、`customer_material_decision` 由 EnterpriseProject 唯一拥有；三表 FORCE RLS，Version/Decision 为 INSERT-only，Root 只开放受控状态、指针和 aggregate version 更新。
- 本切片不实现 OCR/LLM/Provider、Evidence 外部验证、CustomerBaseline、公开 HTTP、真实 Feishu/Ceph/OpenBao 或生产/人工 Reference Project 验收；这些边界保持 `NOT RUN`，具体字段/测试以 Module Spec/Test 和 `.vibe/im-03-wi-06-customermaterial/` 执行记录为准。

WI-06 已通过 [PR #75](https://github.com/qzhike/zhiju-business-core/pull/75) 合并到 `main`。实现 commit `3141928df48b3be097ff554bc7b96ee933d727c1` 已由 merge commit `e7cfee14b699b0574abf6899a0291bc9ea706f90` 纳入默认分支；Issue [#62](https://github.com/qzhike/zhiju-business-core/issues/62) 已关闭，远端和本地 Work Item feature branch 已删除。真实 Provider、生产、公开 HTTP、跨模块 E2E 和独立人工验收仍保持 `NOT RUN`。

## IM-03 WI-07 CustomerBaseline 实现边界（2026-08-26）

Issue #63 在已确认 CustomerMaterial 之上实现 CustomerBaseline 草稿、不可变版本条目、Human-only 激活和 Baseline Impact Review，不扩展公共 Catalog。Issue 文字中的 `KNOWN` 按当前领域闭集解释为 `PRESENT/PARTIAL`；`UNKNOWN`、`NOT_PROVIDED` 和 `MISSING_CONFIRMED` 仍保持三个不可互相推导的认知状态。

- `customer_baseline` 是 Project-owned Root，每个 Project 只有一个 identity；`customer_baseline_version` 保存不可变版本内容和精确 `previousVersionRef`；`customer_baseline_item` 保存每个期望材料的状态、精确已确认 CustomerMaterial refs、Decision Ref 和 Justification。
- `PRESENT/PARTIAL` 必须引用同一 Project 的已确认 CustomerMaterial Version；`NOT_PROVIDED/UNKNOWN` 不得携带材料或缺失确认 Decision；`MISSING_CONFIRMED/NOT_APPLICABLE` 必须携带精确 Decision Ref。冻结的 v1.0 Contract 负责闭集枚举、引用形状和字段类型；Handler 的精确 Ref 查询与 PostgreSQL CHECK 共同裁决跨字段组合，不静默改写公共兼容基线。
- Agent 可以创建包含 `NOT_PROVIDED/UNKNOWN` 的草稿，但 Agent 请求 `MISSING_CONFIRMED` 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；只有可信 Context 中的 Human 可以激活版本。Root CAS 保证并发激活只有一个成功，Event 保存精确 previous active ref。
- 激活新版本只移动 Root 的 active pointer，并追加不可变 `customer_baseline_impact_review` 事实。Impact Review 从旧版本的 Reference Edge 快照出发记录受影响的精确 Context/Gap/Plan refs；本切片不原地修改下游对象，也不自动创建 Gap、DeliveryItem、Artifact 或 InformationRequest。
- V2008 业务表均 FORCE RLS；Root 只开放受控 pointer/CAS 列更新，Version 只开放 DRAFT→CONFIRMED 的受控状态事实，Item/Impact Review 为 INSERT-only。真实 Gap/Plan Process Manager、Provider、公开 HTTP、跨模块 E2E、生产和独立人工 Reference Project 验收继续保持 `NOT RUN`。

WI-07 已通过 [PR #77](https://github.com/qzhike/zhiju-business-core/pull/77) 以实现 head `e71300055fdd40051dc24d1e8d76003c3f32ccc1` 合并到 `main`，merge commit 为 `f63ae2a373c312790c550957ac3aa51c0cf603dd`；Issue [#63](https://github.com/qzhike/zhiju-business-core/issues/63) 已显式关闭，closeout comment 已写入并读回：[issuecomment-5420896539](https://github.com/qzhike/zhiju-business-core/issues/63#issuecomment-5420896539)，实现 head 已证明是 `origin/main` ancestor，远端和本地 WI-07 feature branch 均已删除。Contract/Registry、Handler/Repository、V2008、Disposable PostgreSQL 和本地 probe 均按上文结果通过；真实下游 Process Manager、Provider、公开 HTTP、跨模块 E2E、生产和独立人工 Reference Project 验收仍保持 `NOT RUN`。

## IM-03 WI-08 TemplateBaseline 与 RegulatoryProfile 实现边界（2026-08-26）

Issue #64 在现有 Project、ProductScopeSnapshot 与 Platform Reference 决策之上落地两个受控业务入口，不扩展公共 Catalog：

- Platform Template/Regulatory Reference 表不携带 Enterprise/Project 业务 Scope；导入只产生 `DRAFT`，发布只把一个精确版本变成 `PUBLISHED`，已发布内容不可修改，Runtime 只能读取精确已发布引用。
- 平台写入口使用独立 Reference Writer 数据库角色、Reference Admin/Publisher 能力和仅用于技术审计/Outbox/RLS 的保留技术 Scope；该 Scope 不是业务 Enterprise，不进入平台业务表。
- TemplateBaseline 与 RegulatoryProfile 都由 Project-owned Root、不可变 `FROZEN` Version 和精确条目组成；Root 指针通过 expected aggregate version CAS 推进，同一 Project 不能产生两个 active identity。
- TemplateSelection 必须引用精确已发布 Platform Template ContentAddressedRef；RegulatoryApplicability 必须引用精确已发布 Platform Regulatory ContentAddressedRef。所有引用校验 object/version/hash/canonicalization/scope，禁止 `latest`、label-only 或跨 Scope 替代。
- Regulatory EvidenceRef 必须是独立证据对象，模板和法规版本不能冒充 Evidence；非 `PENDING_DETERMINATION` 的适用性项目必须有证据，风险与适用性组合按闭集规则拒绝。
- 本轮保留现有公共 Catalog `200` 项，不新增公开 Contract；Platform Provider、公开 HTTP、真实外部法规来源、跨模块 Process Manager、生产和独立人工 Reference Project 验收在实现完成后仍需单独标记 `NOT RUN`。

WI-08 的实现收敛还要求既有 `project.get_active_baseline_refs` 复用同一受信 Project 事务读取 TemplateBaseline 与 RegulatoryProfile 的 active exact VersionedRef；该查询只追加已存在的可选字段，不改变公共 Contract 形状，也不把未激活的 draft/current pointer 暴露为 active。

本轮并发语义还要求在旧版本状态被另一事务先提交、但本事务持有的 Root 快照尚未刷新时，重新读取 Root 并优先报告 `CONCURRENCY_CONFLICT`；不能把并发激活误报成历史版本不可变错误。

WI-08 Disposable PostgreSQL fixture 对每个测试使用唯一的 Platform reference identity，避免跨用例唯一键冲突掩盖业务路径；同一 root 的多版本导入仍复用同一 identity 以验证版本链。

Reference Edge 只在输入引用携带合法 ContentHash 时写入 target payload hash；合法的 Object/Versioned ref 可以没有 ContentHash，不能因可选字段缺失触发运行时异常。

WI-08 交付门禁还包括 Prettier、ESLint、TypeScript、架构边界和 Contract baseline；任一静态门禁未通过时不得进入 Git 提交或远端 closeout。

当前静态门禁已全部通过；最终 PostgreSQL 复核还需覆盖后续 Platform 版本的内容/来源 Reference Edge，以及首次 Project Root 并发创建的冲突安全性。两项均属于 Issue #64 的可追溯与 CAS 交付边界。

最终验证矩阵还补充事务前输入拒绝（缺 source/hash、缺平台 capability）和 Project Service principal 的 Human-only 拒绝，确保这些负向边界不依赖数据库副作用。

最终本地验证已完成：静态门禁 `format/lint/typecheck/architecture/contracts=PASS`；Contract 保持 `200 operations`。`pnpm persistence:gate` 在 PostgreSQL `18.6` / Flyway `11.20.3` 上为 `18 files / 234 passed / 0 failed`，空库迁移、V2009、二次 migrate no-op、平台 v2 后旧 Project exact ref/hash、Reference Edge、首次 Root race 和事务前负向用例均通过。Git commit、push、PR、Issue #64 close、远端/本地 branch 删除和 main ancestry 尚待用户检查确认后的 exact-head 交付。

## IM-03 WI-09 GapAnalysis 冻结输入、Human 接受与 stale 实现边界（2026-08-26）

Issue #65 在既有 CustomerBaseline、TemplateBaseline、RegulatoryProfile、EnterpriseProfileSnapshot、QMSConfiguration、ProductScopeSnapshot 和 Policy 精确引用边界之上落地 GapAnalysis 的最小纵向切片，不扩展公共 Catalog。公共 `project.start_gap_analysis@1.0`、`project.accept_gap_analysis@1.0` 与 `project.GapAnalysisAccepted@1.0` 的字段保持现有 Contract 不变。

- `start_gap_analysis` 必须逐项验证七个冻结输入的 object/version/snapshot id、Scope、生命周期和 Snapshot content hash；`FORMAL` 缺任何输入、使用 `latest`、Scope 不一致或 hash 不一致都在业务写入前返回稳定错误。`EXPLORATORY` 仍使用完整的 v1.0 `GapInputSnapshot`，只允许分析结果保留 `UNKNOWN`，不得把未知推导成 `MISSING`。
- 本轮只提供受控、确定性的 evaluator fixture：`requestedScope` 可携带闭合的 finding 集合；Handler 规范化该集合、从 finding 明细派生 summary 并保存 payload hash。没有通用 AI 算法、外部法规 Provider 或测试 seed 代替业务输入。
- `gap_analysis`、`gap_analysis_version`、`gap_analysis_input_snapshot`、`gap_finding` 和 `gap_analysis_decision` 由 EnterpriseProject owning Schema 保存。InputSnapshot、Version、Finding、Decision 都是追加事实；Finding 与已完成 Version 不允许 UPDATE/DELETE。Root 只以 expected aggregate version CAS 移动 current/accepted pointer 和状态。
- 只有可信 `principalKind=HUMAN` 可以执行接受命令；Agent、Service、`actingFor` 和伪造 payload actor 都不能改变可信主体。接受命令必须在同一事务中锁定并重新读取 GapAnalysis Root 后再判断 expected aggregate version，确保任何并发输家统一返回 `CONCURRENCY_CONFLICT`。`ACCEPT` 才设置 accepted pointer 并写入精确 `GapAnalysisAccepted` Event；`REJECT`/`CHANGES_REQUIRED` 只保存 Decision，不设置 accepted pointer。
- 新 Customer/Template/Regulatory Baseline/Profile 版本激活时，只追加受影响 Gap 的 stale/impact fact，将旧 Version 标记 `STALE`；不修改旧 Finding、InputSnapshot、Decision、Context、Plan 或 Artifact。新分析必须通过显式 start command 产生。
- WI-09 的自动验证范围是 Unit/Contract、真实 PostgreSQL DDL/RLS/CHECK/CAS/幂等/不可变/回滚和受控本地 E2E。真实 Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍分别标记 `NOT RUN`，不得由本地 Gate 推断为通过。
- PostgreSQL persistence gate 的物理 baseline 必须同时固定镜像 tag 与 manifest digest，并独立核对当前 tag 解析结果；若 registry tag 漂移，必须更新 immutable pin 后重新执行本地与 exact-head Gate，不能绕过 tag-digest 一致性检查。

### IM-03 WI-09 exact-head closeout（2026-08-27）

实现 commits `de7d54dfba76eca563a561c2d4e4b23a4fd4e0f9`、`08e783f89d29f8566f74ec16f554883e07e55dad` 和 `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 [PR #81](https://github.com/qzhike/zhiju-business-core/pull/81) 合并；PR #81 的 base 为 `main@8c1165dbf7ff32ea26a4ea64799a695a8beb4c05`，merge commit 为 `2d6afd0cc2889cf0fa6350c0599d514d5917b071`。corrected exact head 的 GitHub Actions [run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309) 已通过，PR verification comment 已读回：[issuecomment-5432252760](https://github.com/qzhike/zhiju-business-core/pull/81#issuecomment-5432252760)。因旧 head 无检查而创建的 PR #80 已保持 CLOSED，未自动关闭 Issue。

Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已显式关闭，closeout comment 已读回：[issuecomment-5432258964](https://github.com/qzhike/zhiju-business-core/issues/65#issuecomment-5432258964)。`origin/main=2d6afd0cc2889cf0fa6350c0599d514d5917b071` 已确认包含 corrected implementation head；`galendai/im-03-wi-09-gapanalysis-human-stale` 的远端 ref 与本地 branch 均已删除。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍为 `NOT RUN`。
## IM-03 WI-10 DeliveryPlan/DeliveryItem Human 批准与激活实现边界（2026-08-27）

Issue #66 在已接受 GapAnalysis 和精确 Baseline/Policy 引用的基础上，落地 DeliveryPlan/DeliveryItem 的最小纵向切片。公共 `project.create_delivery_plan_draft@1.0`、`project.approve_delivery_plan@1.0`、`project.activate_delivery_plan@1.0`、`project.get_delivery_item_criteria@1.0` 以及两个 Delivery Event 的字段不扩展；实现只补齐 EnterpriseProject owning Schema、Repository、Handler、真实 PostgreSQL 约束和测试。

- `create_delivery_plan_draft` 接受可信 Agent/Human/Service 的起草请求，但必须引用同一 Project 的精确 `ACCEPTED` GapAnalysis Version、恰好覆盖该 Gap InputSnapshot 五个 normalized baseline refs 的已激活 Customer/Template/Regulatory baseline refs、Enterprise QMS/Product snapshot refs 和精确 Policy/QualityProfile refs。任何 `latest`/`current`/label-only、缺失、hash 不匹配、跨 Scope、混用或省略 active baseline、未接受 Gap、未确认 baseline 或未知 GapItem 均在业务写入前返回稳定错误。
- Plan Root、Plan Version、DeliveryItem、ArtifactRequirement、Dependency 和 BusinessDecision 均属于 EnterpriseProject owning Schema。Plan Version v1 和 Item 内容在创建时计算 canonical payload/hash；Approved/Active 版本以及其 Item、Dependency、ArtifactRequirement 和 Decision 是不可变事实。Scope 或 criteria 变化只能创建新的 Plan Version/Plan identity，不能原地覆盖旧计划。
- 依赖只允许引用同一 Plan Version 内的 DeliveryItem；禁止自依赖、未知 item 和有向环。每个 Item 保留精确 `sourceGapItemRefs`、`targetArtifactTypes`、`qualityProfileRef`、`completionCriteria` 和 `criteriaHash`。本切片只冻结完成条件并返回 `NOT_READY` execution projection，不实现 Completion、Task、Artifact 或 Release。
- `approve_delivery_plan` 是 Human-only；`APPROVE` 才能设置 approved pointer，`CHANGES_REQUIRED`/`REJECT` 只追加不可变 Decision，不形成 approved pointer。`actingFor`、伪造 request actor、Agent/Service 直接批准都拒绝。
- `activate_delivery_plan` 只接受可信 Human，或携带精确且已持久化的 Human `APPROVE` Decision 的受控 Service 执行。Decision ref、Plan Version ref、Impact Policy ref 和 expected aggregate version 必须精确匹配；一次激活最多保留同一 Project 一个 ACTIVE Plan，旧 Active 计划转为历史 `SUPERSEDED`，不删除或改写其 Item/criteria。
- 激活事件只携带 Project、精确 Plan/Item refs、previous active ref、criteria hash 和 QualityProfile ref，不复制计划正文、Gap finding 或 criteria JSON。`project.DeliveryPlanActivated` 与每个 `project.DeliveryItemActivated` 和 Root CAS、Audit、Receipt、Reference Edge 同一事务提交；任一失败全部回滚。
- PostgreSQL 物理边界包括组合 Scope mirror/FK、FORCE RLS、Root pointer/status deferred guard、CAS、唯一 active plan、版本/Decision/Item/Dependency/Requirement immutable guards 和事务内幂等。并发激活输家统一返回 `CONCURRENCY_CONFLICT`；Agent probe、跨 Project probe、rollback 和 event-minimal probe 必须读取真实数据库结果。
- WI-10 自动验证覆盖 Unit/Contract、真实 PostgreSQL DDL/RLS/CHECK/CAS/幂等/回滚和受控本地 E2E。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍为 `NOT RUN`，不得由本地 Gate 推断为通过。

WI-10 本地验证结果（2026-08-27）：`pnpm verify` 整体编排通过；普通测试为 `22 test files passed / 17 skipped`、`351 passed / 230 skipped`，PostgreSQL gate 为 `20 files / 244 passed / 0 failed`，空库迁移、V2011、二次 migrate no-op 和容器清理均通过。WI-10 专用 rollback fault injection、Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍为 `NOT RUN`。

WI-10 exact-head closeout（2026-08-27）：实现 head `054480ebac29cd820e7893df5844ad23a6940f3b` 通过 [PR #83](https://github.com/qzhike/zhiju-business-core/pull/83) 的 [GitHub Actions verify run 33029833203](https://github.com/qzhike/zhiju-business-core/actions/runs/33029833203)，并以 merge commit `71e527b110b7c65d6a73ba16aca4ed1b334bf89d` 合入 `main`；PR verification comment 已读回：[issuecomment-5433162589](https://github.com/qzhike/zhiju-business-core/pull/83#issuecomment-5433162589)。Issue [#66](https://github.com/qzhike/zhiju-business-core/issues/66) 已由合并关联自动关闭并通过 GitHub API 读回为 `closed`；原始远端和本地 feature branch 均已删除，`origin/main` 已验证包含实现 head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

## IM-03 WI-11 权威 Query、Source Slice 与 Board Projection 设计边界（2026-08-27）

Issue #67 复用现有六个 EnterpriseProject Query 名称，不扩展公开 Operation Catalog。四个本轮实现入口分别是 `project.get_project_context_source`、`project.get_active_baseline_refs`、`project.get_delivery_item_criteria` 和 `project.get_project_board_slice`；其中前两个和 criteria Query 读取权威 owning Schema，Board Query 读取独立、可重建的 Projection Schema。

- Query 的 ProjectRef、Audience 和受信事务 Context 必须共同落在同一 Enterprise/Project；跨 Project、跨 Enterprise、未知 ObjectRef、过期 Context 和不匹配的授权决策均在读取前返回稳定错误。Query 不通过跨 Schema Join 拼装事实，必须从 EnterpriseProject 公开的精确引用/Port 读取。
- `get_project_context_source` 按闭集 `purpose` 和 `requestedKinds` 进行 fail-closed 裁剪。结果只返回调用目的所需的精确 Snapshot/Versioned Ref、可安全公开的 Fact 元数据、明确的 `omissions`、`redactions` 和 SourceWatermark；Ref 由 allow-list 重建，不能回显绑定 JSON 的额外字段；即使权威 Fact 含敏感原始 value/source refs，也永不进入结果，必须返回 REDACTED 元数据。缺失字段不能用空字符串伪装。
- Fact 的通配 `redactions` 只在 `ENTERPRISE_FACTS` 被请求且当前 purpose 允许 Fact 元数据时出现；未请求或 purpose 禁止时只记录对应 `omission`，不声明不存在的 Fact 行已被脱敏。
- `get_project_context_source` 必须先用存在性与 Scope 谓词确认 Project 和 `PROJECT_START` ProjectSnapshotBinding，并在读取字段前完成 binding 的类型收窄；缺失、Scope 不一致或 exact ref mirror 不可验证时返回稳定的 `PROJECT_QUERY_NOT_FOUND`/`PROJECT_QUERY_REF_INVALID`，不得在 fail-closed 分支中解引用缺失行或继续读取其他事实。Contract 的可选字段在没有值时必须省略，不能写入显式 `undefined`。
- `get_active_baseline_refs` 只读取 Project Root 的 active/accepted 精确 pointer，并逐项校验 Project、Enterprise、Version 和生命周期（TemplateBaseline/RegulatoryProfile 必须为 `FROZEN`，CustomerBaseline 必须为 `CONFIRMED`，GapAnalysis 必须为 `ACCEPTED`，DeliveryPlan 必须为 `ACTIVE`）；即使 owning repository 的静态状态类型已闭合，运行时仍对读回值执行防御性生命周期校验。不解析 `latest`、`current`、label 或其他替代版本。criteria Query 只读取精确 DeliveryPlan Version/Item，并继续返回 `NOT_READY` execution projection。
- Board Projection 的事实模型为带版本的 `project_board`、read alias、source state、consumer checkpoint 和 failure 记录。Projection writer 只接收规范化的 authoritative Snapshot Export 与有序 Event Delta，不读取 EnterpriseProject 表，不执行跨 Schema Join；旧版本保留，alias 在同一事务中原子切换。
- Board 行按固定 UTF-8 字节序的 `itemKey ASC, deliveryItemId ASC` 排序，写入、读取和 cursor 使用同一比较规则；cursor 绑定 Enterprise、Project、Filter Hash、Projection Version、授权决策 hash 和过期时间；cursor Scope/Filter/Version 不匹配一律拒绝，禁止 offset 分页。查询结果追加可选的 `consistency=PROJECTION`、as-of watermark、lag 和 status 诊断，现有旧 result fixture 仍保持兼容。
- Projection `READY` 只表示当前 Projection 已消费到 source watermark；`PAUSED`、`REBUILDING`、`FAILED` 或 target sequence 大于 checkpoint 时返回明确 stale/lag 状态。Projection 延迟、重建失败或 alias 切换不能阻断、回滚或改写 authoritative Command、criteria 或 Completion 判据。Snapshot/Result 的可选 event id 等字段无值时省略，不写入显式 `null` 或 `undefined`。
- 增量消费只推进本次事件的 `last`；Projection Version/Board 行记录本次已消费 watermark，若更高 source event 已被记录为 target，source state/checkpoint 不得被低序事件覆盖，必须保留可观测 lag，直到对应事件被消费或 rebuild 覆盖。同一已提交 Event 重放必须返回 `DUPLICATE`，低于 checkpoint 的消费必须返回稳定冲突，不能以静默成功掩盖 watermark 顺序错误。
- V2012 只建立 Projection owning tables、Project/partition scope mirror、FORCE RLS、immutable row guard、watermark 单调 guard 和 `projection_app` 最小权限。Projection 输入的 source module 使用 `enterprise_project` namespace，Event Delta sequence 从 1 开始；Projection 不是完整 Event Sourcing 日志；重建必须由受控 Snapshot Export + Event Delta 完成，并核对 checkpoint、row count 和 domain checksum；failure fact 只能通过带安全摘要的受控写入口追加。

WI-11 自动验证覆盖 Contract/Registry、真实 PostgreSQL migration、Scope/RLS/immutable guard、Source Slice 脱敏、active exact refs、稳定 cursor、Projection pause/lag、Snapshot + Delta rebuild、atomic alias、checkpoint conflict 和“Projection 暂停但权威 criteria 不变”。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收保持 `NOT RUN`；“同一 Project 权威 Query 与人为暂停 Projection 的业务对照”提供本地自动化输出，但人工操作仍须单独验收。

### IM-03 WI-11 exact-head closeout（2026-08-27）

实现 commit `c8f1a2cc6291ff65824a04e437a99b660fd926aa` 已通过 [PR #85](https://github.com/qzhike/zhiju-business-core/pull/85) 的 [GitHub Actions verify run 33039239177](https://github.com/qzhike/zhiju-business-core/actions/runs/33039239177)，并以 merge commit `43a2f4fcf074e565c10f3db54bd1be9134ef471d` 合入 `main`。PR verification comment 已读回：[issuecomment-5434378070](https://github.com/qzhike/zhiju-business-core/pull/85#issuecomment-5434378070)。

Issue [#67](https://github.com/qzhike/zhiju-business-core/issues/67) 已由合并关联自动关闭，并通过 GitHub API 读回为 `closed`；Issue closeout comment 已读回：[issuecomment-5434387709](https://github.com/qzhike/zhiju-business-core/issues/67#issuecomment-5434387709)。`origin/main=43a2f4fcf074e565c10f3db54bd1be9134ef471d` 已验证包含 implementation head 与 merge commit；`galendai/im-03-wi-11-query-source-slice-board-projection` 的远端和本地 branch 均已删除，执行 worktree 已 detach 到 `origin/main`。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

### IM-03 WI-12 DeliveryItem Completion 与 Impact Process 实现边界（2026-08-27）

Issue #68 在既有 DeliveryPlan/DeliveryItem 精确版本之上实现 Completion Evaluator、正式上游事实 Inbox/Process Manager、不可变 Evaluation/Impact Review 历史和受控 current pointer。Completion 只能由冻结 criteria、精确事实引用、source watermark 与受信 evaluator 派生；Task-only 保持 `UNSATISFIED`，补齐 ReleaseCompleted 才能产生最小 `DeliveryItemCompletionSatisfied`。迟到、撤销和上游新版本只追加事实、Evaluation 与 Impact，不改写旧 Plan/Approval/历史。

V2013 的真实 PostgreSQL 主消费/评估链、revoke/new-version、late fact、ACL/RLS、CAS 与故障回滚均已通过本地 Gate；Unit/Contract 也已纳入 TypeScript project service，并通过“非 SATISFIED→SATISFIED”事件状态转移与 Event Consumer `sourceEventId` 绑定断言。`pnpm verify` 最终通过，精确结果记录在 `.vibe/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md`。TaskExecution、QualityGovernance、ReleasePublication 的真实业务 Handler、公共 HTTP/Event Bus、生产和独立人工 Reference Project 仍保持 `NOT RUN`。

WI-12 的应用角色对完成历史表不授予 `UPDATE/DELETE`；直接历史写入已在 PostgreSQL 表 ACL 层以 `42501` fail-closed，Project RLS 读隔离也已通过受控 Context 验证。

### IM-03 合成 Reference Project 技术验收边界（2026-08-27）

用户已确认在没有真实业务场景时采用 `SYNTHETIC / TECHNICAL ONLY` Fixture。合成数据、流程和测试矩阵见 [`Synthetic-Reference-Project-Fixture.md`](../im-03-synthetic-reference-fixture/Synthetic-Reference-Project-Fixture.md) 与 [`Test-Matrix.md`](../im-03-synthetic-reference-fixture/Test-Matrix.md)。本次 `pnpm persistence:gate` 在固定 PostgreSQL 18.6 / Flyway 11.20.3 上通过 `21` 个 persistence 测试文件、`256` 个测试，空库迁移、V2013、二次 no-op 和容器清理均通过。

该结果是现有 WI focused fixtures 的 composed controlled persistence evidence，不是一个统一的跨 Aggregate Reference Project runtime runner。`EP-API-U-001/U-002/U-003`、`EP-API-C-001/C-002` 和各 WI focused 技术场景可记录为受控本地证据；`EP-API-E-001/E-002` 的 integrated cross-aggregate execution、`EP-API-M-001` 的实际人工逐项审阅、真实业务适用性、Provider、公开 HTTP、生产和真实跨模块 Event Bus/Process Manager 继续保持 `NOT RUN`。详见 [`Verification-Record.md`](../im-03-synthetic-reference-fixture/Verification-Record.md)。
