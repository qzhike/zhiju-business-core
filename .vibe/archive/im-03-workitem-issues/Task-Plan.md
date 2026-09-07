> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/Task-Plan.md).

# IM-03 Work Item Issue 拆解计划

## 目标

依据当前 `main` 上已批准的 IM-03、EnterpriseProject、PostgreSQL 与跨模块基准，将 IM-03 拆解为边界明确、可独立评审、依赖可追踪且有用户可手测产出的 GitHub Work Item Issues，并写入 `qzhike/zhiju-business-core`。

## 权威输入

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md`
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`
- `.vibe/module-tests/Module-Test-002-EnterpriseProject.md`
- `.vibe/high-level-docs/02-zhiju-core-architecture.md`
- `.vibe/high-level-docs/04-domain-model-v0.1.md`
- `.vibe/high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md`
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
- `.vibe/high-level-docs/08-verification-baseline.md`
- GitHub 当前 Issue、Label、Milestone 与默认分支状态

## 拆解原则

1. 先关闭契约缺口，再实现业务切片；不得通过测试直写数据库伪造 Product、QMSConfiguration、Profile Snapshot 或平台参考输入。
2. 每个业务切片同时包含必要的 Spec/Test 同步、Migration、Domain/Application、Repository 和真实 PostgreSQL 验证。
3. 32 个现有 EnterpriseProject Contract 全部可追溯；新增公共能力必须经过兼容性基线和用户审核。
4. Human-only、精确 Version/Snapshot Ref、Scope、不可变历史、三态缺失语义与派生 Completion 为硬约束。
5. 真实 Ceph/OpenBao/飞书、IM-04+ 下游模块、跨模块 HTTP/E2E、生产负载与人工验收未执行时保持 `NOT RUN`。

## 已发现的阻塞契约缺口

- IM-03 要求交付 Product、QMSConfiguration、EnterpriseProfileSnapshot，且 `project.create_project@1.0` 依赖这些精确引用，但当前 18 个公开 Command 没有相应创建/版本化入口。
- Platform Template/Regulatory Reference 只有逻辑表所有权，没有冻结的导入/发布入口。
- Product 结构、QMSConfiguration 激活/回滚、Project 启动必需 Snapshot、Gap stale Policy 等仍列在未冻结参数中。
- Module Spec 的“DDL 不存在”状态已与 IM-02 落地的 EnterpriseProject 标准技术表不一致，需要在实施前对齐，但不得把技术表 `PASS` 写成业务模型已实现。

## 执行步骤与验证

1. 核对 IM-03 范围、契约缺口和 GitHub 去重 → 验证：没有现有 IM-03 Work Item，IM-02 #28 已关闭。
2. 形成 Exit Gate、依赖图和 Work Item 草案 → 验证：覆盖 IM-03 产出、32 个现有 Contract、失败场景与手工产出。
3. 创建 GitHub Issues 并补齐交叉链接 → 验证：回读标题、正文、状态、Label 和依赖。
4. 记录发布结果 → 验证：本目录草案与 GitHub 正文一致。

## 约束

- 本次只创建规划文档与 GitHub Issues，不修改业务代码，不创建 Git Commit，不关闭或改写既有 Issue。
- 不创建 GitHub-native Milestone；仓库当前没有已配置的 Milestone，IM-03 由 Exit Gate Issue 聚合。
- 后续 Commit/Push 需要用户另行确认。

## 状态

`COMPLETE`

## GitHub 创建结果

| 类型 | Issue | Work Item |
|---|---|---|
| Exit Gate | [#56](https://github.com/qzhike/zhiju-business-core/issues/56) | 汇总验收并关闭 EnterpriseProject Reference Foundation 里程碑 |
| WI-01 | [#57](https://github.com/qzhike/zhiju-business-core/issues/57) | 冻结 EnterpriseProject 公共能力与实施决策 |
| WI-02 | [#58](https://github.com/qzhike/zhiju-business-core/issues/58) | 建立 EnterpriseProject Application/Persistence 事务基础 |
| WI-03 | [#59](https://github.com/qzhike/zhiju-business-core/issues/59) | 实现 Enterprise、Fact、Profile、Product 与 QMS 纵向切片 |
| WI-04 | [#60](https://github.com/qzhike/zhiju-business-core/issues/60) | 实现 Project 启动快照、Scope 与对象验证 |
| WI-05 | [#61](https://github.com/qzhike/zhiju-business-core/issues/61) | 实现 SourceMaterial 登记、验证与接受链 |
| WI-06 | [#62](https://github.com/qzhike/zhiju-business-core/issues/62) | 实现 CustomerMaterial 提议、确认与不可变版本 |
| WI-07 | [#63](https://github.com/qzhike/zhiju-business-core/issues/63) | 实现 CustomerBaseline 三态缺失与影响评审 |
| WI-08 | [#64](https://github.com/qzhike/zhiju-business-core/issues/64) | 实现 TemplateBaseline 与 RegulatoryProfile 精确冻结 |
| WI-09 | [#65](https://github.com/qzhike/zhiju-business-core/issues/65) | 实现 GapAnalysis 冻结输入、Human 接受与 stale 语义 |
| WI-10 | [#66](https://github.com/qzhike/zhiju-business-core/issues/66) | 实现 DeliveryPlan/Item Human 批准与激活 |
| WI-11 | [#67](https://github.com/qzhike/zhiju-business-core/issues/67) | 实现权威 Query、Source Slice 与 Board Projection |
| WI-12 | [#68](https://github.com/qzhike/zhiju-business-core/issues/68) | 实现 DeliveryItem Completion 与 Impact Process |

## 依赖关系

```text
WI-01 → WI-02 → WI-03 → WI-04 → WI-05 → WI-06 → WI-07
                  └────→ WI-08 ───────────────┘
WI-07 + WI-08 → WI-09 → WI-10
WI-04/06/07/08/10 → WI-11
WI-02/07/08/10/11 → WI-12
全部 WI → Exit Gate #56
```

## 回读验证

- 2026-08-25 创建 #56–#68：1 个 Exit Gate、12 个 Work Item。
- 全部新 Issue 初始状态为 `OPEN`，均带 `enhancement` Label，未创建 GitHub-native Milestone 或 Assignee。
- 每个 Work Item 均包含父追踪、硬依赖、验收条件、用户可手测产出或可执行 probe，以及准确的非目标/`NOT RUN` 边界。
- 本次未修改或关闭既有 Issue；未创建 Git Commit 或 Push。
