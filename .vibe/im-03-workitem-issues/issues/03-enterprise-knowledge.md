## 目标

实现 Enterprise、EnterpriseFact、EnterpriseProfileSnapshot、Product 与 QMSConfiguration 的最小纵向切片，为 Project 启动提供精确且不可变的企业知识引用。

父追踪：#56

硬依赖：#57、#58

## 范围

- 业务 Migration、Aggregate/Version/Snapshot 模型、模块 Repository、Command/Query Handler、Event/Audit/Outbox。
- `project.create_enterprise`、`project.propose_enterprise_fact`、`project.confirm_enterprise_fact`、`project.get_enterprise_profile_snapshot` 以及 WI-01 审核通过的 Product/QMS/Profile 公共能力。
- Agent 只提议；高风险 Fact、QMS 激活和 Profile 冻结遵守 Human-only；冲突来源并存，不 last-write-wins。
- Snapshot 精确记录 Fact/Product/QMS 版本和 payload hash，后续变化不改写旧 Snapshot。

## 验收条件

- [ ] Enterprise ID 不从名称派生，Scope 不可迁移；display code 唯一性与 CAS 在数据库约束中成立。
- [ ] Fact value/source 创建后不覆盖；PROPOSED/CONFIRMED/DISPUTED/SUPERSEDED 历史可追溯。
- [ ] Agent/actingFor 不能执行 Human-only 确认或激活。
- [ ] Product/QMS Version 和 Profile Snapshot 不可变，active/current 指针只能指向同 Enterprise 的精确版本。
- [ ] 跨 Enterprise Ref、hash mismatch、旧 expectedVersion 和重复激活有真实 PostgreSQL 负向证据。
- [ ] 用户可创建脱敏企业、提出/确认互相冲突的事实并重放旧 Profile Snapshot，看到历史未被改写。

## 非目标与 `NOT RUN` 边界

- 不实现 Project、材料、Baseline、Gap 或 DeliveryPlan。
- 不实现自由写 EnterpriseProfile；Profile 仍由权威事实和精确版本派生后冻结。
