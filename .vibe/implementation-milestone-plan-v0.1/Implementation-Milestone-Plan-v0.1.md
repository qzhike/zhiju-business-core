# Zhiju Business Core Implementation Milestone Plan v0.1

版本：v0.1
日期：2026-08-24
状态：`MILESTONE DESIGN BASELINE`；当前推进方向见 [roadmap](../product/roadmap.md)。下文完成情况与测试数量为历史快照，不作为最新执行状态。

文档职责：只维护阶段范围、依赖、决策 Gate 与退出标准；当前工作选择由 roadmap 维护，执行结果由 GitHub Issue/PR 维护。历史快照暂不搬迁，不再追加逐轮进度。

2026-10-26：新版 MVP 的目标与验收见 [可用闭环](../mvp/usable-loop.md)，当前交付次序见 [mvp-v1-release](../mvp/mvp-v1-release.md)，[旧 Core 重构提案](../archive/mvp-pre-v1-release/core-refactoring-plan.md)仅保留历史设计约束。本文旧 IM-07 Feishu → IM-08 CLI 等产品次序不再作为新 MVP 前置；已实现能力、历史证据和适用的技术审查/验证要求保留，不因新规划自动宣称完成或关闭。

文档角色：把已冻结的高层、API、Module、PostgreSQL、Feishu Channel 与 Runtime Adapter 基准转换为可执行实施顺序、依赖和退出 Gate。本文不重新定义业务语义，也不以里程碑计划替代 owning Contract、Module Spec、Logical Model 或专项测试。

---

## 1. 阶段目标与非目标

本阶段形成：

1. 技术决策 Gate 与开始编码的前置条件；
2. 从仓库骨架到 Reference Project E2E 的实施里程碑；
3. 每个里程碑的范围、依赖、验证、退出条件和明确非目标；
4. DDL、Migration、Repository、Application、Adapter、Renderer 和 Operations 的统一顺序；
5. 已批准基准与待审核 proposal 的隔离方式。

里程碑计划本身不重新创建或定义：

- 未经 Module Spec 授权的业务语义；
- 未经决策 Gate 选择的语言、框架或部署组件；
- 6 个尚未批准的 TaskExecution Command；
- 真实飞书、CLI Runtime、Renderer、数据库或对象存储资源；
- 第二套业务模型、共享 Repository 或跨 Schema 业务外键。

---

## 2. 阶段入口

已确认输入：

- 高层设计、PostgreSQL Logical Model、API v0.1、七份 Business Core Module Spec/Test；
- Workspace UI Experience Module Spec/Test；该 Experience Module 不拥有 Business Core Contract、Schema 或 Repository；
- Feishu Channel Contract v0.1；
- CLI-first Runtime Adapter Contract v0.1；
- 当前公开 Catalog 为 200 项，API 与 Module Spec 集合一致；
- v0.1 为单进程模块化单体、一个 PostgreSQL Database、七个权威 Schema、一个可重建 Projection Schema；
- 目标环境预安装 Codex CLI、Claude Code CLI、OpenClaw CLI，智举只通过本地 Process Driver 调用。
- 生产部署为客户私有 Ubuntu 单服务器；首期 API-first；对象存储、Secret/KMS 与 OIDC 认证基准见 [`Deployment-Security-Baseline-v0.1.md`](Deployment-Security-Baseline-v0.1.md)。

仍未确认的 proposal 不得被“先写代码”事实化：

- 6 个 Runtime 控制 Command；
- Run Lease/Heartbeat/Cancel/Reconciliation 默认时长；
- same-Run Resume Policy；
- Raw transcript 保留 Policy；
- 三种 CLI 的预配置身份与默认路由顺序。

---

## 3. 实施原则

1. 先 Human-operated Core，后飞书与 Agent automation。
2. 先一个“采购控制程序”Reference Project 纵向闭环，后通用化。
3. 每个业务模块同时交付 Domain、Application Port、Repository、Migration 和测试，不采用“先写全库 DDL、再补业务”的大爆炸方式。
4. Contract/Schema/Fixture 先于 Handler；失败场景先于实现。
5. 跨模块同步写入只走公开 Command Port，读取走 Query Port 或 Projection；静态依赖检查必须能阻止违规包引用。
6. PostgreSQL 约束、RLS、Role、CAS、Lease/Fencing、Inbox/Outbox 必须用真实 PostgreSQL 验证，不能由内存替身宣布通过。
7. 外部副作用必须有 Attempt、稳定幂等键、UNKNOWN、reconciliation 和真实 Receipt。
8. 一次实施变更只跨越一个里程碑内的必要文件；每个里程碑独立可回退、可验证、可审核。
9. Workspace UI 在 IM-06 Human-operated Core 后进入实现，只消费公开 API/Projection；不得在 BFF、ViewModel 或浏览器状态中复制业务授权、状态机或完成判据。

---

## 4. 开始编码前的决策 Gate

| Gate | 必须冻结 | 阻塞范围 | 当前状态 |
|---|---|---|---|
| IM-DG-001 | 后端语言、运行时、构建工具、模块边界检查和测试框架 | IM-01 及以后 | `USER APPROVED 2026-08-17` |
| IM-DG-002 | PostgreSQL 精确版本、允许扩展、Migration Tool、Expand/Contract 规则 | IM-02 及以后 | `USER APPROVED 2026-08-17` |
| IM-DG-003 | 对象存储、Secret/KMS、开发环境替身和生产边界 | 涉及二进制、加密和 Release 的里程碑 | `USER APPROVED 2026-08-17` |
| IM-DG-004 | 首个交付 API Transport、认证入口和 Workspace UI 边界 | 首个可操作应用入口 | `USER APPROVED 2026-08-17` |
| IM-DG-005 | Canonical Document/Workbook 最小 Schema 与 Renderer 技术路线 | IM-04/IM-05 | `USER APPROVED 2026-08-27` |
| IM-DG-006 | 6 个 Runtime Command 与 Runtime 默认 Policy | IM-08 | `USER DECISION REQUIRED` |

IM-DG-001/002 的精确记录见 [`Technology-Baseline-v0.1.md`](Technology-Baseline-v0.1.md)，IM-DG-003/004 见 [`Deployment-Security-Baseline-v0.1.md`](Deployment-Security-Baseline-v0.1.md)。IM-DG-005 已于 2026-08-27 获用户批准，决策记录见 [IM-DG-005 决策](../decisions/canonical-content-renderer.md)；IM-DG-006 仍必须记录选项、理由、兼容边界、迁移成本、拒绝的替代项和验证方式。选择具体库不会改变已冻结 Domain/API 语义。

`IM-UI-01` 里程碑已于 2026-08-28 获用户批准，但开始写 UI 代码前仍须完成以下 Experience 层决策，不得用默认脚手架静默事实化：

| Gate | 必须冻结 | 当前状态 |
|---|---|---|
| UI-DG-001 | 前端框架、构建/包管理、SSR/SPA 边界、版本与升级策略 | `USER APPROVED 2026-10-08 / INDEPENDENT REVIEW NOT RUN`：SPA、路由/读取库、首装版本与升级策略见[工程基线](../decisions/workspace-ui-engineering-baseline.md)；尚未安装/实现/验证 |
| UI-DG-002 | Design System、支持浏览器/视口、可访问性目标、国际化与视觉验收方法 | `USER APPROVED 2026-10-08 / INDEPENDENT REVIEW NOT RUN`：基础组件、Chrome/Edge 窗口/视口、中文与可访问性/视觉验收见[工程基线](../decisions/workspace-ui-engineering-baseline.md)；尚未安装/实现/验证 |
| UI-DG-003 | BFF 部署拓扑、OIDC Session、CSRF/CSP、API 代理和前端可观测性 | `USER APPROVED 2026-10-08 / INDEPENDENT REVIEW NOT RUN`：独立同源 BFF、技术 Session/重启、OIDC/CSRF/CSP/代理/日志见[工程基线](../decisions/workspace-ui-engineering-baseline.md)；尚未安装/实现/验证 |

---

## 5. 目标代码边界（技术中立）

```text
repository
├── apps/
│   ├── workspace-web/          # Experience-only browser client; no Domain ownership
│   └── workspace-bff/          # OIDC/session/API composition; no second business API
├── contracts/                  # versioned schema, fixtures, compatibility
├── modules/
│   ├── identity-policy/
│   ├── enterprise-project/
│   ├── task-execution/
│   ├── artifact/
│   ├── quality-governance/
│   ├── release-publication/
│   └── integration-gateway/
├── adapters/
│   ├── feishu/
│   ├── runtime-cli/
│   ├── renderer/
│   ├── object-storage/
│   └── persistence/
├── migrations/                 # 按 owning schema 隔离
├── tests/
│   ├── fixtures/
│   ├── contract/
│   ├── persistence/
│   └── e2e/
└── operations/                 # local env, CI, runbook, observability
```

这是责任布局，不是最终语言目录名。技术栈冻结后可映射为对应构建系统的模块，但不得合并七个业务模块的内部包或 Repository。

---

## 6. 里程碑依赖

```text
IM-00 Decision Baseline
  ↓
IM-01 Repository + Executable Contracts
  ↓
IM-02 PostgreSQL Foundation + IdentityPolicy
  ↓
IM-03 EnterpriseProject Reference Foundation
  ↓
IM-04 Artifact + Canonical Content
  ↓
IM-05 Quality + Release + Renderer
  ↓
IM-06 TaskExecution Human-operated Core
  ├────────────→ IM-UI-01 Workspace UI MVP ────────┐
  └→ IM-07 Feishu Channel → IM-08 CLI Runtime Automation ─┤
                                                         ↓
                       IM-09 Reference Project E2E + Operations Hardening
```

IM-UI-01 可在 IM-06 完成后启动，并与 IM-07/IM-08 的交付时间窗并行；IM-07 与 IM-08 自身仍保持既有先后依赖。IM-09 必须同时等待 IM-UI-01、IM-07 和 IM-08 的适用 Gate。任何并行化都不得绕过前置决策、业务所有权或测试失败。

---

## 7. 里程碑定义

### IM-00 Decision Baseline

产出：

- 完成 IM-DG-001 至 IM-DG-004 的最小选择；
- 记录本地开发、CI、测试容器和生产部署的差异；
- 固定版本锁定、依赖升级和安全扫描策略。

退出 Gate：技术决策可复现且不会引入共享业务模型；未决 IM-DG-006 有明确最晚决策点。`COMPLETE 2026-08-17`。

### IM-01 Repository + Executable Contracts

产出：

- 构建、格式化、静态分析、单元测试、依赖边界检查和 CI 骨架；
- 六个 Core Contract 与已批准公开 API 的机器可执行字段级 Schema；
- Canonical JSON/Hash、UUIDv7、Typed Reference 和 ApiError 的跨模块共享 Value Type；
- 200 个 operation 的 Schema-derived TypeScript 类型与 v1.0 compatibility baseline；
- 正向、未知字段、未知 Major、Hash 冲突、Reference Scope 与 breaking-change 负向 Fixture。

退出 Gate：空仓库可一条命令完成 build/test；Catalog 与可执行 Schema 可自动比对；禁止的跨模块依赖会让构建失败；`FULL=200`、`ENVELOPE_ONLY=0`；类型生成与兼容性 Gate 无漂移。

历史状态快照：`COMPLETE`（Issue #9 / PR #20；证据见 [`../im-01-exit-gate-issue-9/Verification-Report.md`](../archive/im-01-exit-gate-issue-9/Verification-Report.md)）。IM-02 已完成 scoped 交付并仅待 Issue #28 关闭，详见下方状态快照。

### IM-02 PostgreSQL Foundation + IdentityPolicy

产出：

- 一个 Database、七个 owning Schema、Projection Schema、Migration Owner/Runtime Role；
- RLS Transaction Context、Command Receipt、Outbox/Inbox、Audit、Reference Index 基础设施；
- IdentityPolicy 的 Human/Agent/Service Principal、Enterprise Scope 和 AuthorizationDecision 最小纵向切片。

退出 Gate：空库迁移、重复迁移、最小权限、跨 Schema 写拒绝、无/伪造 RLS Context、CAS 和 Inbox/Outbox replay 在真实 PostgreSQL 通过。

历史状态快照：`COMPLETE`（2026-08-24）。#29–#38 子 Issue 均已关闭；PR #39、#41、#43、#44、#45 已合入 `main`；PR #46–#50 的 stacked 实现由 PR #51 进入 `main`，Gate 修复由 PR #52 合入，Runbook/验收文档和 COMPLETE 状态由 PR #53/#54/#55 合入 `main@47d1b57`。合并后的完整 `pnpm install --frozen-lockfile && pnpm clean && pnpm verify` 通过：Persistence `12/177`、14 个 Migration `Success`、二次 migrate no-op、Runbook 和 Probe 证据均已记录。真实 Provider、跨模块 HTTP/E2E、生产环境和外部系统验收仍为 `NOT RUN`；IM-02 已完成，Issue #28 已关闭。

### IM-03 EnterpriseProject Reference Foundation

前置：Issue #57（WI-01）先冻结 Product/QMS/Profile/Platform Reference 的受控 Application Capability、ProjectStartSnapshot 必需 Ref 和 Gap stale/impact Policy；决策记录见 [EnterpriseProject Capability 决策](../decisions/enterprise-project-capabilities.md)。

产出：Enterprise、EnterpriseFact、Profile Snapshot、Product、QMSConfiguration、Project、Source/Customer Material、Baseline、Gap、DeliveryPlan/Item 的最小链；所有业务前置对象必须通过唯一 Owner 的 Application 入口创建，不能由测试或 Migration 直写。

退出 Gate：先由用户审核 WI-01 决策矩阵和被拒绝的公共 Catalog 扩展方案；WI-02 交付模块内 Application/Persistence 事务基础（Receipt/CAS/RLS/hash），不创建业务表；后续实现阶段再验证脱敏企业与“采购控制程序”Reference Project 可创建、新事实不改写旧 Snapshot、NOT_PROVIDED/UNKNOWN/确认缺失保持区分。WI-01 本身不报告业务 DDL 或运行时 `PASS`。

### IM-04 Artifact + Canonical Content

前置：IM-DG-003 与 IM-DG-005 至少冻结本里程碑所需范围。

产出：先 additive 冻结只读 RenderAttempt Binding Query，再交付 Artifact Application/Persistence 事务基础、Artifact、不可变 Revision、Content Object Link、Workspace/Application 内部基本 Diff、Human Edit、对象 Staging/Link/Orphan Cleanup。

退出 Gate：Representation Handler 不得在 Binding Query 落地前实现；Revision 不可变；跨 Project 引用、Hash 冲突、路径/对象替换被拒绝；对象成功而 DB 失败不会产生业务对象；不隐式新增公共 Diff Result Operation。

GitHub 任务基线：Parent Exit Gate [#89](https://github.com/qzhike/zhiju-business-core/issues/89)，开发 Work Item [#90](https://github.com/qzhike/zhiju-business-core/issues/90)–[#98](https://github.com/qzhike/zhiju-business-core/issues/98)。#90 已完成并关闭；#91 的事务基础实现、本地验证和 PR #102 交付已完成，Issue #91 已关闭；#92–#98 仍为 `PLANNED / NOT STARTED`。建档或单个 WI 完成不代表整个 IM-04 的业务表、Renderer、Provider、跨模块 E2E 或人工验收完成。

### IM-05 Quality + Release + Renderer

产出：QualityProfile、GateResult、ReviewIssue、Human Approval、ReleasePackage、PublicationAttempt/Receipt/Recall，以及 DOCX/XLSX 最小 Renderer。

退出 Gate：针对精确 Revision 的 Gate/Approval/Render/Release Hash 链完整；未批准 Revision、普通文件发送或 Agent 行为不能形成 Formal Release。

GitHub 任务基线：Parent Exit Gate [#120](https://github.com/qzhike/zhiju-business-core/issues/120)，开发 Work Item [#121](https://github.com/qzhike/zhiju-business-core/issues/121)–[#128](https://github.com/qzhike/zhiju-business-core/issues/128)。WI-01 的 Application/Persistence 本地实现与完整 Gate 已通过；其远端交付状态以 #121 及关联 PR 为准。WI-02 已依据 #122 完成本地实现、验证与 exact-head 交付（validation 8/8；pinned PostgreSQL/Flyway persistence 30 files/298 tests；PR #130 已合入 `main`，Issue #122 已关闭，本地及远端 feature branch 已删除）；其后续 WI-03–WI-08 不因 WI-01 或 WI-02 的技术实现而自动开始或完成。

### IM-06 TaskExecution Human-operated Core

验收状态：`SCOPED ENGINEERING ACCEPTANCE COMPLETE / USER CONFIRMED 2026-10-07`。已批准有限支持集通过原工程退出 Gate，用户已确认 IM-06 完成验收；复核依据与边界见 [roadmap](../archive/mvp-pre-v1-release/roadmap-before-v1.md#completed--im-06-taskexecution-human-operated-core)。外部/公开 HTTP/UI/生产/性能/独立人工验收及既有 PARTIAL/NOT RUN、真实 Grant PolicySnapshot lifecycle 延后保持原边界。

产出：Task、WorkOrder、ContextSnapshot、Run、AgentResult、InformationRequest、Usage/Provenance 的 Human-operated 流程。阶段启动基线的 TaskExecution 范围为 19 Command、7 Query、11 Event，当时全仓 Catalog 为 201 项；原 200 项兼容基线保持不变，验收基线的全仓 Catalog/Registry 为 239 项，实时模块范围见 owning Module Spec 与 roadmap。IM-06 不自动批准 Runtime 专项的 6 个新增 Command；任何必要 API Delta 必须先经正式设计决定。

退出 Gate：WorkOrder 范围、Run/Result/Completion 四层状态不混淆；BLOCKED_INPUT、新 Run Retry、Cancel request 和 late result 语义可测试；不依赖真实 Agent。

规划设计见 [Human-operated 设计提案](../decisions/task-execution-human-operated.md)，当前波次见 [roadmap](../product/roadmap.md)。受控 Driver/答案 Fixture 的证据与真实 Runtime/飞书 E2E 分开；Cancel request 不代表 Cancel ACK，未知 Usage 不代表零。首次 Context、控制入口与判断事实的 TD-01–04 技术设计已于 2026-09-08 获用户批准，包含具体新 API、Task v2、持久化与首版范围；实现须遵循 owning Contract/Module Spec/Test，不能通过直接写表或伪造可信 Ref 绕过。

### IM-UI-01 Workspace UI MVP

前置：IM-06 已完成；UI-DG-001 至 UI-DG-003 已批准并完成适用审查；各真实页面接入时所需 owning 公开能力、Projection freshness 和错误语义稳定可用。工程外壳可在审查及当前 Core 基线满足后先交付，边界与退出条件见 [UI01 首个工程交付目标](../module-specs/Module-Spec-UI01-WorkspaceUI.md#首个工程交付目标)；该阶段不代替 UI-WI-02 的真实会话/授权验收。

产出：

- BFF + Browser Shell 的 OIDC 登录、Session、登出、过期和重新认证闭环；
- Enterprise/Project Overview、Customer Baseline 完整性、GapAnalysis 与 DeliveryPlan；
- Artifact、Revision、基本 Diff、Human Edit 与不可变新 Revision；
- Evidence、ReviewIssue、Human Review/Approval、Release 状态与安全确认；
- Task Board、WorkOrder/Run、Blocker、InformationRequest、Usage 与 Audit Timeline；
- 对 `UNKNOWN`、`NOT_PROVIDED`、`MISSING_CONFIRMED`、Projection `STALE/REBUILDING/FAILED`、外部 `UNKNOWN` 和部分成功的真实显示；
- Browser Unit/Contract/E2E、安全、可访问性和人工验收记录。

Work Item 与手动可测产出：

| Work Item | 范围 | 用户可手动测试的产出 |
|---|---|---|
| UI-WI-01 | UI-DG 决策、Information Architecture、Route/Capability Matrix、低保真交互稿 | 审核导航、页面状态、角色可见性和关键确认流程，不启动业务写入 |
| UI-WI-02 | BFF、OIDC Session、App Shell、Enterprise/Project Context | 使用测试 Human 登录、切换授权 Project、登出并验证 Session 过期；跨 Project 访问被安全拒绝 |
| UI-WI-03 | Project/Baseline/Gap/Delivery 工作区 | 查看 PRESENT/UNKNOWN/NOT_PROVIDED，Human 接受 Gap、批准 DeliveryPlan，Agent/actingFor 操作被拒绝 |
| UI-WI-04 | Artifact/Revision/Diff/Human Edit | 从精确 Revision 创建新 Revision、查看 Diff；旧 Revision 与已 Release 历史保持不变 |
| UI-WI-05 | Evidence/Review/Approval/Release | 查看精确 Hash 链，以真实 Human 完成适用 Review/Approval；普通附件发送不能显示为 Formal Release |
| UI-WI-06 | Task/Run/InformationRequest/Audit | 查看 Task 四层状态、BLOCKED_INPUT、Answer 后新 Run、Usage 和 Audit；Projection 延迟不显示成功完成 |
| UI-WI-07 | Browser E2E、安全、可访问性和运维交接 | 执行脱敏 Reference Project 浏览器流程、键盘/焦点检查、Session/CSRF/XSS/越权负向场景和故障降级 |

退出 Gate：脱敏 Human 可经浏览器完成授权 Project 的核心 Human-operated 流程；所有写操作只调用公开 API 并携带精确 Ref/expectedVersion；Human-only、跨 Scope、过期 Session、CSRF/XSS 和敏感信息泄漏负向场景通过；Projection/Provider 延迟不会被 UI 冒充成功；适用浏览器 E2E、可访问性检查和用户人工验收有真实证据。

非目标：UI/BFF 不拥有授权、Aggregate 状态机、Approval、Release、Completion、Repository 或跨模块业务事务；不直接连接 PostgreSQL、OpenBao、Ceph 或 Provider SDK；不因页面缓存或乐观更新制造业务事实。

历史状态快照：`MILESTONE USER APPROVED 2026-08-28 / DESIGN BASELINE / IMPLEMENTATION NOT STARTED / ALL RUNTIME AND MANUAL TESTS NOT RUN`。权威 Experience 规格见 [`../module-specs/Module-Spec-UI01-WorkspaceUI.md`](../module-specs/Module-Spec-UI01-WorkspaceUI.md)，测试基线见 [`../module-tests/Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md)。

### IM-07 Feishu Channel

产出：Webhook/Callback 验证、Identity/Binding、Inbound Envelope、Outbound Intent、Attempt/Receipt、文件与卡片最小闭环。

退出 Gate：32 个 Feishu 专项场景中可自动执行部分通过；真实环境验证单独记录；重复、撤回、权限失败和 UNKNOWN 不制造第二业务事实。

### IM-08 CLI Runtime Automation

前置：IM-DG-006 已决；Codex CLI、Claude Code CLI、OpenClaw CLI 版本与认证探测策略已冻结。

产出：公共 Process Driver、三个 CLI Profile、Execution Package、事件/Result/Usage Mapper、Cancel/Resume/Retry/Reconciliation。

退出 Gate：Runtime 专项自动测试通过；真实 CLI 最小 E2E 分别记录版本、身份与证据；CLI session、stdout 或退出码不能直接冒充业务完成。

### IM-09 Reference Project E2E + Operations Hardening

前置：IM-UI-01、IM-07、IM-08 的适用 Exit Gate 已完成；不能在 IM-09 中一边首次实现整套 UI，一边宣称最终 Reference Project E2E。

产出：从飞书/Workspace UI 输入到 Project、Artifact、Gate、Approval、Renderer、Release、Runtime 辅助修订的完整脱敏链；监控、备份恢复、故障演练、运行手册和人工验收记录。

退出 Gate：适用自动回归全绿；真实 PostgreSQL/对象存储/Workspace UI/飞书/CLI/Renderer 证据齐全；剩余风险、容量边界、RPO/RTO 和回滚路径已审核。

---

## 8. 每个里程碑的 Definition of Done

1. owning 文档与失败场景先同步；
2. Migration、Domain、Application、Adapter 依赖方向符合模块边界；
3. Focused Unit/Contract/Persistence/E2E 通过；
4. 全项目 format/lint/type/build/test 与 `git diff --check` 通过；
5. 真实外部或人工项未运行时明确标记 `NOT RUN`，不写成 PASS；
6. Migration 有空库、升级、失败恢复与 Expand/Contract 证据；
7. 安全敏感变更覆盖跨企业、无 Context、伪造身份、Secret 泄漏和越权负向测试；
8. 变更可从单一 Commit/PR 说明中定位范围、证据、回退和剩余风险；
9. 用户确认后才提交并进入下一个里程碑。
10. Experience 层变更还必须通过适用 Browser E2E、Session/CSRF/XSS/Scope 安全、可访问性和用户手动验收；未运行项保持 `NOT RUN`。

---

## 9. 历史阶段结论（保留快照）

- IM-DG-001 至 IM-DG-004 已完成用户确认，IM-00 已退出；MinIO 因官方仓库归档被否决，私有化基准采用 MicroCeph/Ceph RGW、OpenBao 与 Keycloak OIDC。
- IM-01 已 `COMPLETE`：七模块 200 个公开操作全部为字段级 `FULL` Schema；Registry 精确 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。
- Schema-derived Type（200 payload + 44 query result + 6 Core Contract）与 v1.0 compatibility baseline 已接入 `contracts:check`；当前 `pnpm verify` 的仓库测试为 20 个文件通过、10 个跳过，341 个测试通过、164 个跳过。
- #5 字段 Schema 已由 PR #14 合入并完成；重复/迟到 Runtime 由已关闭的 #15 完成，剩余 Runtime 分别由 #22–#24 跟踪。#17 追踪 IntegrationGateway Runtime 缺口。这些 Runtime Issue 不阻塞 IM-01 Schema 退出，也不构成外部 E2E PASS。
- Runtime 自动化位于 IM-08，明确晚于 Human-operated Core 和 Feishu 基础闭环；IM-DG-005 已批准，IM-DG-006 仍待决。
- IM-UI-01 已于 2026-08-28 作为独立 Workspace UI MVP 里程碑获用户批准：硬依赖 IM-06，可与 IM-07/IM-08 时间窗并行，并成为 IM-09 的前置；具体 UI 技术栈仍须通过 UI-DG-001 至 UI-DG-003，当前实现与 Browser/Manual 验收均为 `NOT RUN`。
- IM-02 当前为 `COMPLETE`：PR #51/#52/#53/#54/#55 已合入 `main@47d1b57`，最终 main 完整 verify 为 PASS，Persistence `12/177`、Migration/no-op、Runbook/Probe 证据和 exact-head CI 均通过。真实 Provider、跨模块 HTTP/E2E、生产负载和外部系统验收仍为 `NOT RUN`。Issue #28 已关闭；IM-03 WI-01 至 WI-12 的实现已合入默认分支，并由 Module-Test-002 及各 Verification-Record 记录本地受控验证。统一跨 Aggregate E2E、独立人工 Reference Project 和真实外部链路仍为 `NOT RUN`。

### IM-03 合成 Reference Project 历史验证状态（2026-08-27）

用户已确认采用 `SYNTHETIC / TECHNICAL ONLY` Fixture。`pnpm persistence:gate` 已通过 `21` 个 persistence 测试文件、`256` 个测试，空库迁移、V2013、二次 no-op 和容器清理均通过。该结果是 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不是统一跨 Aggregate runtime E2E；`EP-API-E-001/E-002` 集成链和 `EP-API-M-001` 人工验收继续为 `NOT RUN`。
