> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/implementation-milestone-plan-v0.1/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/implementation-milestone-plan-v0.1/Task-Plan.md).

# Implementation Milestone Plan v0.1 工作计划

状态：`BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-UI-01 MILESTONE ADDED 2026-08-28`
日期：2026-08-28（初版 2026-08-17；Issue #9 退出 Gate与 IM-UI-01 增量同步）
执行者：Grok（Issue #9）/ 历史切片由既有 Agent 完成

## 1. 前提与范围

- 用户已于 2026-08-17 要求提交 Runtime Adapter 文档并继续下一阶段；基线提交为 `c3e379c`。
- `HL-Spec` 指定下一阶段为 Implementation Milestone Plan，之后才进入 DDL/Migration/Repository/Application Code。
- 用户已确认 IM-DG-001 至 005；IM-00、IM-01、IM-02 与 IM-03 scoped technical acceptance 已完成，IM-04 已建档但尚未实现；本次只新增 IM-UI-01 规划，不提前创建 UI/BFF 工程。
- 200 项 Catalog 保持不变；Runtime Contract 中 6 个 additive Command 继续隔离为 proposal。

## 2. 权威输入

1. `HL-Spec.md` 与 `02-zhiju-core-architecture.md` 第 18 节；
2. `05-cross-aggregate-consistency-module-boundary-v0.1.md` 的模块依赖和物理约束；
3. `07-postgresql-logical-model-v0.1.md` 第 24 节物理参数；
4. `08-verification-baseline.md` 第 7 节实施 Gate；
5. API v0.1、七份 Business Core Module Spec/Test、IM-01 Core Contracts Spec/Test 与 Workspace UI Experience Spec/Test；
6. Feishu Channel 与 Runtime Adapter Contract/Test。

## 3. 交付物

1. `Implementation-Milestone-Plan-v0.1.md`：决策 Gate、目标边界、IM-00 至 IM-09、IM-UI-01、Definition of Done；
2. `Technology-Baseline-v0.1.md`：Node.js/TypeScript/NestJS/Fastify/PostgreSQL/Kysely/Flyway/Test 基线；
3. `Deployment-Security-Baseline-v0.1.md`：Ubuntu 私有化、MicroCeph/Ceph RGW、OpenBao、Keycloak OIDC 与 UI 边界；
4. `Verification-Report.md`：来源、静态一致性、未执行项和剩余风险；
5. 同步 HL 路由、Runtime 阶段状态与 Verification Baseline。

## 4. 执行步骤

1. 确认 Runtime 文档提交与工作树入口。
2. 提取已冻结实施原则、PostgreSQL 物理参数和模块依赖。
3. 将技术选择隔离为 IM-DG-001 至 IM-DG-006。
4. 定义 IM-00 至 IM-09 与 IM-UI-01 的范围、前置条件和退出 Gate。
5. 复用既有 Test Spec，不重复发明功能测试计数。
6. 同步高层导航、当前状态和下一步说明。
7. 执行 Markdown、链接、Catalog、测试 ID、diff 和 Git 状态检查。

## 5. 阶段 Gate

| Gate | 预期 | 当前状态 |
|---|---|---|
| IMP-D-001 | 下一阶段与 HL 路线图一致 | `DESIGN VERIFIED` |
| IMP-D-002 | 10 个既有里程碑 + 1 个独立 UI 里程碑依赖无反向业务依赖；IM-09 汇合 UI/Feishu/CLI | `DESIGN VERIFIED` |
| IMP-D-003 | 6 个技术/策略决策逐项记录；已批准与待决状态分开 | `DESIGN VERIFIED` |
| IMP-D-004 | 200 项 Catalog 与 6 个 proposal 保持隔离 | `DESIGN VERIFIED` |
| IMP-D-005 | 每个里程碑有退出 Gate，外部验证不冒充 PASS | `DESIGN VERIFIED` |
| IMP-D-006 | 文档、链接、Markdown、diff 静态一致 | `DESIGN VERIFIED` |

## 6. 阶段退出记录

- 用户于 2026-08-17 确认 Ubuntu 私有本地服务器与 API-first，IM-DG-003/004 已冻结，IM-00 完成。
- MinIO 初始建议因官方仓库已归档被否决；不会进入生产、开发 Conformance 或 CI 基准。
- 用户已授权 IM-01 依赖安装；精确 `pnpm-lock.yaml`、workspace、API skeleton、共享内核、Core 字段级 Schema 与 200 个 Envelope Registry 已创建。
- IM-01 退出时尚未创建 DDL、Migration 或模块业务 Handler；这些后续实现以各自里程碑证据为准，Runtime proposal 仍未混入已批准 Catalog。
- 2026-08-28 用户批准新增 IM-UI-01；只完成里程碑、Experience Module Spec/Test 和验证基线建档，未选择前端框架，未创建 UI/BFF 实现，全部 Browser/Manual 场景为 `NOT RUN`。
- 七模块 200 个公开操作已全部提升为字段级 `FULL` Schema；Registry 精确 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。
- Schema-derived Type（Issue #7 / PR #18）与 v1.0 compatibility baseline（Issue #8 / PR #19）已合入并接入 `contracts:check`。
- Issue #9 干净 verify：13 files / 287 tests PASS；架构负向自测与 breaking compatibility 负向证据齐全。
- #5 字段 Schema 由 PR #14 合入并完成；#15 已完成重复/迟到 Runtime，#22–#24 承接其余 ReleasePublication Runtime 边界；#17 追踪 IntegrationGateway Runtime 缺口。
- IM-01 正式 `COMPLETE` 已由 PR #20 原子更新；证据见 [Issue #9 Verification Report](../im-01-exit-gate-issue-9/Verification-Report.md)。
