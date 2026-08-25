## 目标

这是 IM-03 `EnterpriseProject Reference Foundation` 的汇总与退出 Gate。只有全部 Work Item 合入默认分支、真实 PostgreSQL 证据可复现且用户完成脱敏“采购控制程序”手工验收后，才能把 IM-03 标记为 `COMPLETE` 并进入 IM-04。

## 权威输入

- `.vibe/implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md` 的 IM-03 定义
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`
- `.vibe/module-tests/Module-Test-002-EnterpriseProject.md`
- `.vibe/high-level-docs/04-domain-model-v0.1.md`
- `.vibe/high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md`
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md` 的 `enterprise_project` 逻辑模型
- `.vibe/high-level-docs/08-verification-baseline.md`

## 前置状态

- [x] #28 IM-02 PostgreSQL Foundation + IdentityPolicy 已关闭。

## 前置 Work Items

- [ ] #57 WI-01：冻结 EnterpriseProject 公共能力与实施决策
- [ ] #58 WI-02：建立 EnterpriseProject Application/Persistence 事务基础
- [ ] #59 WI-03：实现 Enterprise、Fact、Profile、Product 与 QMS 纵向切片
- [ ] #60 WI-04：实现 Project 启动快照、Scope 与对象验证
- [ ] #61 WI-05：实现 SourceMaterial 登记、验证与接受链
- [ ] #62 WI-06：实现 CustomerMaterial 提议、确认与不可变版本
- [ ] #63 WI-07：实现 CustomerBaseline 三态缺失与影响评审
- [ ] #64 WI-08：实现 TemplateBaseline 与 RegulatoryProfile 精确冻结
- [ ] #65 WI-09：实现 GapAnalysis 冻结输入、Human 接受与 stale 语义
- [ ] #66 WI-10：实现 DeliveryPlan/Item Human 批准与激活
- [ ] #67 WI-11：实现权威 Query、Source Slice 与 Board Projection
- [ ] #68 WI-12：实现 DeliveryItem Completion 与 Impact Process

具体硬依赖以各 Work Item 正文为准；本 Issue 仅在全部 Work Item 完成后进入汇总验收。

## 汇总验收范围

- 从公开 Application Capability 创建 Enterprise、确认 EnterpriseFact，并冻结可追溯的 EnterpriseProfileSnapshot、ProductVersion 与 QMSConfigurationVersion。
- 创建 Project，全部启动 Snapshot/Version Ref 属于同一 Enterprise，Project Scope 不可迁移。
- SourceMaterial 与 CustomerMaterial 分层成立：原始 bytes/hash 不可改，附件不自动成为客户事实、Baseline 或 Evidence。
- CustomerBaseline、TemplateBaseline、RegulatoryProfile、GapAnalysis 与 DeliveryPlan/Item 使用精确不可变版本；禁止 `latest`。
- `NOT_PROVIDED`、`UNKNOWN`、`MISSING_CONFIRMED` 保持不同；系统和 Agent 不能把“没有收到”自动解释为“确认缺失”。
- Gap 只有 Human 接受后才能成为计划输入；DeliveryPlan 只有 Human 批准后激活；依赖图无环。
- DeliveryItem Completion 只由精确 criteria、事实引用和版本化 Evaluator 派生，Task/Run/Agent 自报不能直接完成。
- 新 Baseline/Profile/Plan 不改写旧 Context、Gap、Plan、Artifact 或 Release，只产生 stale/impact 事实和显式 Review。
- 18 Command、6 Query、8 Event 以及 WI-01 经审核新增的公共能力均有 Handler/Query/Event、持久化、授权、幂等、CAS、RLS 和失败场景证据。

## 验收条件

- [ ] 所有前置 Work Item 均已关闭，对应 PR 已合入默认分支并完成 exact-head 语义 review。
- [ ] 权威 Spec/Test、API Catalog、兼容性基线、逻辑模型与实现状态一致，不保留过期的“业务 DDL 不存在”或虚假 `PASS`。
- [ ] 从空库执行 Migration、二次 no-op Migration、focused Unit/Contract/Persistence/E2E 和 `pnpm clean && pnpm verify` 全部通过。
- [ ] 真实 PostgreSQL 验证跨 Enterprise/Project 引用拒绝、RLS、CAS、唯一 active pointer、不可变版本、幂等 replay 和事务回滚。
- [ ] EP-API-U-001/002/003、EP-API-C-001/002、EP-API-E-001/002 与 EP-API-M-001 有实际输出；适用的 EP-U/E 与 PostgreSQL 场景可追溯。
- [ ] 用户按 Runbook 创建脱敏“采购控制程序”Reference Project，并逐项审核事实、材料、Baseline、Gap、Plan/Item、Human Gate 与旧版本重放。
- [ ] 只有上述证据经用户审核后才把 IM-03 标为 `COMPLETE`；子 Issue 自动关闭不等于本 Gate 自动完成。

## 手动验收产出

提供一条可重复运行、无生产 Secret 的 Runbook：创建脱敏 Enterprise → 冻结 Profile/Product/QMS → 创建 Project → 登记并确认不完整材料 → 激活三类 Baseline/Profile → 接受 Gap → 批准/激活 DeliveryPlan → 查询 Source Slice/Board → 激活新 CustomerBaseline 后重放旧版本。输出必须逐项显示精确 ID/Version/Hash、Human 决定与预期拒绝。

## 非目标与 `NOT RUN` 边界

- 不实现 IM-04+ 的 Artifact 内容、Renderer、Quality/Release、TaskExecution Human Core、飞书 Channel 或 CLI Runtime。
- SourceMaterial 本里程碑验证元数据、Hash、Validation Ref 和 ObjectLocator 绑定；真实 Ceph RGW/OpenBao、Staging/Link/Orphan Cleanup 外部联调属于后续里程碑，保持 `NOT RUN`。
- Completion/Impact 使用受控下游事件 Fixture 验证；真实 Task/Artifact/Quality/Release 跨模块 E2E 在相应模块落地前保持 `NOT RUN`。
- #22–#24 与 #27 继续拥有其 ReleasePublication/IntegrationGateway 剩余范围，不因 IM-03 完成而自动关闭。
