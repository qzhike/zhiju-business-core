> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/01-contract-decision-gate.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/01-contract-decision-gate.md).
> Published Issue: [#57](https://github.com/qzhike/zhiju-business-core/issues/57); this file is a historical draft, not its current body.

## 目标

在实现 IM-03 前关闭 EnterpriseProject 的公共能力与未冻结参数缺口，使 Product、QMSConfiguration、EnterpriseProfileSnapshot 和 Platform Template/Regulatory Reference 都能通过明确、可审计的应用入口产生，而不是由测试或 Migration 直接伪造业务前置数据。

父追踪：#56

## 范围

- 订正 HL-Spec、Architecture、Domain Model、Module Spec/Test、Implementation Plan 与 Verification Baseline 的当前状态和唯一权威路由。
- 冻结 Product v0.1 最小结构、QMSConfiguration 版本激活/回滚、EnterpriseProfileSnapshot 创建、Project 启动必需 Snapshot、平台参考输入导入/发布、Gap stale/impact 最小 Policy。
- 明确 QualityProfile/Evidence 等 IM-05 Ref 在 IM-03 的强引用与验证边界，不通过跨 Schema Join 或假数据绕过。
- 决定新增 Command/Query/Event 或受控种子/管理入口；如新增公共 Contract，同步字段级 Schema、生成类型、Catalog、兼容性 baseline 与负向 Fixture。
- 修正“业务 DDL 不存在”与 IM-02 标准技术表已落地之间的状态漂移，但不把技术表验证写成业务实现 `PASS`。

## 验收条件

- [ ] 每个 IM-03 必需前置对象都有唯一 Owner、公开/受控写入口、授权 purpose、版本语义、失败码和测试场景。
- [ ] 不再需要 E2E 直接写业务表来创建 Product/QMS/Profile/Reference 前置数据。
- [ ] 新增 Contract 为兼容性允许的 additive 变更；v1.0 baseline、生成类型和 Catalog 集合一致。
- [ ] 未冻结参数被明确决定或从 IM-03 范围中经用户审核移出，不在代码中静默事实化。
- [ ] `pnpm contracts:check`、相关文档 Gate 与 `git diff --check` 通过。
- [ ] 用户审核设计选项、拒绝的替代项和最终公共入口。

## 手动验收产出

提供一份决策矩阵和一组 Contract 示例。用户可从干净 checkout 运行 Contract Gate，并确认每个 ProjectStartSnapshot 必需 Ref 都有可追溯的产生路径。

## 非目标与 `NOT RUN` 边界

- 本 Work Item 不实现业务 DDL、Repository 或 Handler。
- PostgreSQL 业务链、对象存储、外部系统和人工 Reference Project 仍为 `NOT RUN`。

## 本分支交付记录

Issue #57 的决策矩阵见 [`Contract-Decision-Matrix.md`](https://github.com/qzhike/zhiju-business-core/blob/main/.vibe/decisions/enterprise-project-capabilities.md)。本分支选择先冻结 EnterpriseProject Owner 的受控 Application Capability，不把未经过用户审核的新增入口加入当前 200 项公共 Contract Catalog。
