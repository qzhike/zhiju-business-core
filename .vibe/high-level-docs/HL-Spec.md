# Zhiju Business Core 基准规格与 Agent 入口

版本：v0.1
日期：2026-08-17
状态：`CURRENT DESIGN BASELINE / IM-00 COMPLETE / IM-01 COMPLETE`

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
|    6 | [`06-typed-references-contract-catalog-v0.1.md`](./06-typed-references-contract-catalog-v0.1.md)                     | Typed Reference、Envelope、兼容性、200 个公开 Command/Query/Event 名称    | API、事件、跨模块集成任务                  |
|    7 | [`07-postgresql-logical-model-v0.1.md`](./07-postgresql-logical-model-v0.1.md)                                       | Schema 所有权、逻辑表、约束、RLS、Outbox/Inbox、对象存储边界              | 数据库、Repository、Migration 任务         |
|    8 | [`08-verification-baseline.md`](./08-verification-baseline.md)                                                       | 验证策略、跨模块验收场景、文档/实现/人工 Gate、测试结果口径               | 所有修改和审查任务                         |

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

Feishu Channel v0.1 的专项协议固定维护在 `.vibe/feishu-channel-contract-v0.1/`；该目录只拥有飞书原始事件/API 到现有 Core Contract 的 Anti-Corruption 映射，不创建第八个业务模块，也不改变 200 项公开 Catalog 的 Owner。

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
- 模块内使用强外键/唯一/检查约束，跨模块使用 Typed Reference，不建立跨 Schema 外键；
- Enterprise-owned Row 显式保存 `enterprise_id`；Project-owned Row同时保存 `enterprise_id + project_id`；
- Enterprise 数据强制 RLS，但 RLS 不替代 IdentityPolicy；
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
- IM-DG-005、IM-DG-006 仍待决，不阻塞 IM-01。

当前 IM-01 TaskExecution 修复 Gate：

- PR #10 已把 37 个 TaskExecution 操作注册为 `FULL`，但代码审查发现 Core Contract 引用、WorkOrder 子结构、SourceWatermark、分页、ValueEnvelope、公开 Event 最小化、终态枚举和 optional 字段共 8 类 Schema 偏差；
- 修复必须以已审核的 `03-core-contracts.md`、共享 API Contract 和 `Module-Spec-003-TaskExecution.md` 为准，不得通过修改 Fixture 迁就错误 Schema；
- 8 类偏差已修复并于 2026-08-17 获用户确认；修复已提交并推送。与 `main` 中 PR #11 Core Schema 集成后，`TE-API-S-009` 至 `TE-API-S-017`、全量 106 个自动测试、架构与 Catalog Gate 均为 `PASS`；这不代表 Handler、数据库、Runtime 或人工验收通过。

尚未完成：

- Canonical Document/Workbook 最小实现 Schema；
- 可执行 DDL、Migration、Repository 和业务代码；
- Renderer、部署、监控和运行手册；
- 未覆盖模块的自动测试、外部服务验证和人工验收。

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
IM-01 Repository + Executable Contracts  （COMPLETE / FULL 200 + ENVELOPE_ONLY 0 / FIELD-LEVEL SCHEMAS + SCHEMA-DERIVED TYPES + V1.0 COMPATIBILITY BASELINE LANDED / ISSUE #9 CLOSED BY PR #20 / ISSUE #5 FIELD-SCHEMA SCOPE COMPLETE VIA PR #14 / RELEASE RUNTIME GAPS TRACKED BY #22–#24 / ISSUE #17 TRACKS IG RUNTIME GAPS / HANDLER + DB + EXTERNAL GATES REMAIN NOT RUN）
    ↓
IM-02 PostgreSQL Foundation + IdentityPolicy  （NEXT）
```

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

本项目已完成 IM-00 与 IM-01 Repository + Executable Contracts（Issue #9 / PR #20）。工程骨架、共享内核、Core 字段级 Schema、200 个 API Envelope、自动测试、架构/Catalog Gate、Schema-derived Type、v1.0 compatibility baseline 与 HTTP health smoke 已通过；IdentityPolicy 20 个、EnterpriseProject 32 个、TaskExecution 37 个、Artifact 26 个、QualityGovernance 37 个、ReleasePublication 25 个与 IntegrationGateway 23 个操作均已具有字段级 Payload/Event Schema 和 Query Result Schema；Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。干净 checkout 证据见 [`.vibe/im-01-exit-gate-issue-9/Verification-Report.md`](../im-01-exit-gate-issue-9/Verification-Report.md)。Schema 衍生类型见 `.vibe/im-01-executable-schema-typescript/`；兼容性基线见 `.vibe/im-01-v1.0-schema-fixtures/`。PR #10–#14、#16、#18、#19 的 Schema/类型/兼容性实现与 review 修复均已保留。2026-08-21 用户批准修订 Issue #9：硬依赖改为 #1–#8 的 Schema 子切片均已合入，#5 的 Runtime 状态不阻塞本 Gate；随后用户批准将 #5 收敛为字段 Schema 边界。Issue #5 的字段级目标已由 PR #14 完成，重复 / 迟到回执由已关闭的 #15 完成；未实现的 Release Authorization ActorSnapshot/actingFor、`providerResult` PII 最小化、普通飞书发送 Formal Release 来源链分别由 #22、#23、#24 承接，不能因 #5 关闭而视为 Runtime `PASS`。#17 继续追踪 IntegrationGateway Runtime 缺口。下一阶段为 IM-02。IM-RP-001（Issue #15）在 `modules/release-publication` 落地 Runtime Receipt Validator（重复 / 迟到回执检测、RawExternalReceipt outcome/payload/time provenance、package↔release 与完整 scope 绑定、Ledger `compareAndSaveAttempt` / `compareAndSaveReceipt` 原子落账）；持久化载体仍为 In-Memory Ledger。数据库 DDL/真实 Repository、IntegrationGateway 飞书/邮件 Provider 注入（#17）与 HTTP Handler 仍 `NOT RUN`，不得冒充业务 E2E。6 个 Runtime additive proposal、IM-DG-005/006 仍待独立审核；数据库、外部和人工运行验证均为 `NOT RUN`，不得冒充业务 E2E。

PR #11 的 Core Contract 字段级 Schema review 修复已合并至 `main`：该切片恢复既有 `required`、Typed Reference 强度、Set 基数和 `ValueEnvelope` 条件约束，不改变冻结的 Core Contract 业务语义，也不扩大 IM-01 范围。修复记录见 [`../im-01-core-contract-review-fix/Task-Plan.md`](../im-01-core-contract-review-fix/Task-Plan.md)。TaskExecution 直接复用该权威 WorkOrder Schema 的共享 `$defs`，不得维护第二套 WorkOrder 子结构。QualityGovernance PR #13 的 review 修复同样要求 Result Schema 直接引用已注册的 Core Contract ID（`revision-acceptance/1.0`、`approval-bundle/1.0`、`release-readiness/1.0`），不得维护第二套截断视图。
