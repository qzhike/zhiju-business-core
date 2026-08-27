# Zhiju Business Core Implementation Milestone Plan v0.1

版本：v0.1
日期：2026-08-24
状态：`BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-02 COMPLETE / IM-03 WI-01–WI-12 IMPLEMENTATION VERIFIED / SYNTHETIC COMPOSED CONTROLLED PERSISTENCE PASS / ISSUE #57–#68 CLOSED / ISSUE #56 EXIT GATE PENDING / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

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

- 高层设计、PostgreSQL Logical Model、API v0.1、七份 Module Spec/Test；
- Feishu Channel Contract v0.1；
- CLI-first Runtime Adapter Contract v0.1；
- 当前公开 Catalog 为 200 项，API 与 Module Spec 集合一致；
- v0.1 为单进程模块化单体、一个 PostgreSQL Database、七个权威 Schema、一个可重建 Projection Schema；
- 目标环境预安装 Codex CLI、Claude Code CLI、OpenClaw CLI，智举只通过本地 Process Driver 调用。
- 生产部署为客户私有 Ubuntu 单服务器；首期 API-first；对象存储、Secret/KMS 与 OIDC 认证基准见 [`Deployment-Security-Baseline-v0.1.md`](./Deployment-Security-Baseline-v0.1.md)。

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

---

## 4. 开始编码前的决策 Gate

| Gate | 必须冻结 | 阻塞范围 | 当前状态 |
|---|---|---|---|
| IM-DG-001 | 后端语言、运行时、构建工具、模块边界检查和测试框架 | IM-01 及以后 | `USER APPROVED 2026-08-17` |
| IM-DG-002 | PostgreSQL 精确版本、允许扩展、Migration Tool、Expand/Contract 规则 | IM-02 及以后 | `USER APPROVED 2026-08-17` |
| IM-DG-003 | 对象存储、Secret/KMS、开发环境替身和生产边界 | 涉及二进制、加密和 Release 的里程碑 | `USER APPROVED 2026-08-17` |
| IM-DG-004 | 首个交付 API Transport、认证入口和 Workspace UI 边界 | 首个可操作应用入口 | `USER APPROVED 2026-08-17` |
| IM-DG-005 | Canonical Document/Workbook 最小 Schema 与 Renderer 技术路线 | IM-04/IM-05 | `USER DECISION REQUIRED` |
| IM-DG-006 | 6 个 Runtime Command 与 Runtime 默认 Policy | IM-08 | `USER DECISION REQUIRED` |

IM-DG-001/002 的精确记录见 [`Technology-Baseline-v0.1.md`](./Technology-Baseline-v0.1.md)，IM-DG-003/004 见 [`Deployment-Security-Baseline-v0.1.md`](./Deployment-Security-Baseline-v0.1.md)。IM-DG-005/006 仍必须记录选项、理由、兼容边界、迁移成本、拒绝的替代项和验证方式。选择具体库不会改变已冻结 Domain/API 语义。

---

## 5. 目标代码边界（技术中立）

```text
repository
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
  ↓
IM-07 Feishu Channel
  ↓
IM-08 CLI Runtime Automation
  ↓
IM-09 Reference Project E2E + Operations Hardening
```

后续可以在保持依赖和 Gate 的前提下并行工作，但不得用并行化绕过前置决策、业务所有权或测试失败。

---

## 7. 里程碑定义

### IM-00 Decision Baseline

产出：

- 完成 IM-DG-001 至 IM-DG-004 的最小选择；
- 记录本地开发、CI、测试容器和生产部署的差异；
- 固定版本锁定、依赖升级和安全扫描策略。

退出 Gate：技术决策可复现且不会引入共享业务模型；未决 IM-DG-005/006 有明确最晚决策点。`COMPLETE 2026-08-17`。

### IM-01 Repository + Executable Contracts

产出：

- 构建、格式化、静态分析、单元测试、依赖边界检查和 CI 骨架；
- 六个 Core Contract 与已批准公开 API 的机器可执行字段级 Schema；
- Canonical JSON/Hash、UUIDv7、Typed Reference 和 ApiError 的跨模块共享 Value Type；
- 200 个 operation 的 Schema-derived TypeScript 类型与 v1.0 compatibility baseline；
- 正向、未知字段、未知 Major、Hash 冲突、Reference Scope 与 breaking-change 负向 Fixture。

退出 Gate：空仓库可一条命令完成 build/test；Catalog 与可执行 Schema 可自动比对；禁止的跨模块依赖会让构建失败；`FULL=200`、`ENVELOPE_ONLY=0`；类型生成与兼容性 Gate 无漂移。

当前状态：`COMPLETE`（Issue #9 / PR #20；证据见 [`../im-01-exit-gate-issue-9/Verification-Report.md`](../im-01-exit-gate-issue-9/Verification-Report.md)）。IM-02 已完成 scoped 交付并仅待 Issue #28 关闭，详见下方状态快照。

### IM-02 PostgreSQL Foundation + IdentityPolicy

产出：

- 一个 Database、七个 owning Schema、Projection Schema、Migration Owner/Runtime Role；
- RLS Transaction Context、Command Receipt、Outbox/Inbox、Audit、Reference Index 基础设施；
- IdentityPolicy 的 Human/Agent/Service Principal、Enterprise Scope 和 AuthorizationDecision 最小纵向切片。

退出 Gate：空库迁移、重复迁移、最小权限、跨 Schema 写拒绝、无/伪造 RLS Context、CAS 和 Inbox/Outbox replay 在真实 PostgreSQL 通过。

当前状态：`COMPLETE`（2026-08-24）。#29–#38 子 Issue 均已关闭；PR #39、#41、#43、#44、#45 已合入 `main`；PR #46–#50 的 stacked 实现由 PR #51 进入 `main`，Gate 修复由 PR #52 合入，Runbook/验收文档和 COMPLETE 状态由 PR #53/#54/#55 合入 `main@47d1b57`。合并后的完整 `pnpm install --frozen-lockfile && pnpm clean && pnpm verify` 通过：Persistence `12/177`、14 个 Migration `Success`、二次 migrate no-op、Runbook 和 Probe 证据均已记录。真实 Provider、跨模块 HTTP/E2E、生产环境和外部系统验收仍为 `NOT RUN`；IM-02 已完成，Issue #28 已关闭。

### IM-03 EnterpriseProject Reference Foundation

前置：Issue #57（WI-01）先冻结 Product/QMS/Profile/Platform Reference 的受控 Application Capability、ProjectStartSnapshot 必需 Ref 和 Gap stale/impact Policy；决策记录见 [`../issue-57-enterpriseproject/Contract-Decision-Matrix.md`](../issue-57-enterpriseproject/Contract-Decision-Matrix.md)。

产出：Enterprise、EnterpriseFact、Profile Snapshot、Product、QMSConfiguration、Project、Source/Customer Material、Baseline、Gap、DeliveryPlan/Item 的最小链；所有业务前置对象必须通过唯一 Owner 的 Application 入口创建，不能由测试或 Migration 直写。

退出 Gate：先由用户审核 WI-01 决策矩阵和被拒绝的公共 Catalog 扩展方案；WI-02 交付模块内 Application/Persistence 事务基础（Receipt/CAS/RLS/hash），不创建业务表；后续实现阶段再验证脱敏企业与“采购控制程序”Reference Project 可创建、新事实不改写旧 Snapshot、NOT_PROVIDED/UNKNOWN/确认缺失保持区分。WI-01 本身不报告业务 DDL 或运行时 `PASS`。

### IM-04 Artifact + Canonical Content

前置：IM-DG-003 与 IM-DG-005 至少冻结本里程碑所需范围。

产出：Artifact、不可变 Revision、Content Object Link、基本 Diff、Human Edit、对象 Staging/Link/Orphan Cleanup。

退出 Gate：Revision 不可变；跨 Project 引用、Hash 冲突、路径/对象替换被拒绝；对象成功而 DB 失败不会产生业务对象。

### IM-05 Quality + Release + Renderer

产出：QualityProfile、GateResult、ReviewIssue、Human Approval、ReleasePackage、PublicationAttempt/Receipt/Recall，以及 DOCX/XLSX 最小 Renderer。

退出 Gate：针对精确 Revision 的 Gate/Approval/Render/Release Hash 链完整；未批准 Revision、普通文件发送或 Agent 行为不能形成 Formal Release。

### IM-06 TaskExecution Human-operated Core

产出：Task、WorkOrder、ContextSnapshot、Run、AgentResult、InformationRequest、Usage/Provenance 的 Human-operated 流程；只实现 200 项已批准 Catalog 能力。

退出 Gate：WorkOrder 范围、Run/Result/Completion 四层状态不混淆；BLOCKED_INPUT、新 Run Retry、Cancel request 和 late result 语义可测试；不依赖真实 Agent。

### IM-07 Feishu Channel

产出：Webhook/Callback 验证、Identity/Binding、Inbound Envelope、Outbound Intent、Attempt/Receipt、文件与卡片最小闭环。

退出 Gate：32 个 Feishu 专项场景中可自动执行部分通过；真实环境验证单独记录；重复、撤回、权限失败和 UNKNOWN 不制造第二业务事实。

### IM-08 CLI Runtime Automation

前置：IM-DG-006 已决；Codex CLI、Claude Code CLI、OpenClaw CLI 版本与认证探测策略已冻结。

产出：公共 Process Driver、三个 CLI Profile、Execution Package、事件/Result/Usage Mapper、Cancel/Resume/Retry/Reconciliation。

退出 Gate：Runtime 专项自动测试通过；真实 CLI 最小 E2E 分别记录版本、身份与证据；CLI session、stdout 或退出码不能直接冒充业务完成。

### IM-09 Reference Project E2E + Operations Hardening

产出：从飞书/Workspace 输入到 Project、Artifact、Gate、Approval、Renderer、Release、Runtime 辅助修订的完整脱敏链；监控、备份恢复、故障演练、运行手册和人工验收记录。

退出 Gate：适用自动回归全绿；真实 PostgreSQL/对象存储/飞书/CLI/Renderer 证据齐全；剩余风险、容量边界、RPO/RTO 和回滚路径已审核。

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

---

## 9. 当前结论

- IM-DG-001 至 IM-DG-004 已完成用户确认，IM-00 已退出；MinIO 因官方仓库归档被否决，私有化基准采用 MicroCeph/Ceph RGW、OpenBao 与 Keycloak OIDC。
- IM-01 已 `COMPLETE`：七模块 200 个公开操作全部为字段级 `FULL` Schema；Registry 精确 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。
- Schema-derived Type（200 payload + 44 query result + 6 Core Contract）与 v1.0 compatibility baseline 已接入 `contracts:check`；当前 `pnpm verify` 的仓库测试为 20 个文件通过、10 个跳过，341 个测试通过、164 个跳过。
- #5 字段 Schema 已由 PR #14 合入并完成；重复/迟到 Runtime 由已关闭的 #15 完成，剩余 Runtime 分别由 #22–#24 跟踪。#17 追踪 IntegrationGateway Runtime 缺口。这些 Runtime Issue 不阻塞 IM-01 Schema 退出，也不构成外部 E2E PASS。
- Runtime 自动化位于 IM-08，明确晚于 Human-operated Core 和 Feishu 基础闭环；IM-DG-005/006 仍待决。
- IM-02 当前为 `COMPLETE`：PR #51/#52/#53/#54/#55 已合入 `main@47d1b57`，最终 main 完整 verify 为 PASS，Persistence `12/177`、Migration/no-op、Runbook/Probe 证据和 exact-head CI 均通过。真实 Provider、跨模块 HTTP/E2E、生产负载和外部系统验收仍为 `NOT RUN`。Issue #28 已关闭；IM-03 WI-01 至 WI-12 的实现已合入默认分支，并由 Module-Test-002 及各 Verification-Record 记录本地受控验证。统一跨 Aggregate E2E、独立人工 Reference Project 和真实外部链路仍为 `NOT RUN`。

### IM-03 合成 Reference Project 当前验证状态（2026-08-27）

用户已确认采用 `SYNTHETIC / TECHNICAL ONLY` Fixture。`pnpm persistence:gate` 已通过 `21` 个 persistence 测试文件、`256` 个测试，空库迁移、V2013、二次 no-op 和容器清理均通过。该结果是 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不是统一跨 Aggregate runtime E2E；`EP-API-E-001/E-002` 集成链和 `EP-API-M-001` 人工验收继续为 `NOT RUN`。
