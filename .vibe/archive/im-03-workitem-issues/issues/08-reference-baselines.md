> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/08-reference-baselines.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/08-reference-baselines.md).
> Published Issue: [#64](https://github.com/qzhike/zhiju-business-core/issues/64); this file is a historical draft, not its current body.

## 目标

实现受控 Platform Template/Regulatory Reference 输入、Project TemplateBaseline 与 RegulatoryProfile 的冻结/激活链，确保项目引用精确版本且模板不冒充法规 Evidence。

父追踪：#56

硬依赖：#57、#59、#60

## 范围

- Platform reference 与 project baseline/profile 业务表、Repository、授权边界和测试。
- WI-01 冻结的受控参考输入入口、`project.freeze_template_baseline`、`project.activate_regulatory_profile`。
- ContentAddressedRef 的 id/hash/lifecycle/applicability 验证，禁止 `latest`。
- Template selection、Regulatory applicability/evidence、ProductScope 与 Review Snapshot 的精确绑定和 Human-only Gate。

## 验收条件

- [ ] 平台参考写入只允许明确平台角色，Enterprise Runtime Role 不能修改平台表。
- [ ] 冻结 TemplateBaseline 后平台 current version 变化不影响项目旧选择。
- [ ] RegulatoryProfile 的法规版本/hash、适用性、evidence 与 product scope 可追溯；模板 Ref 不能代替 EvidenceRef。
- [ ] `latest`、跨 Enterprise/Project、hash mismatch、未发布/错误生命周期 Ref 被拒绝。
- [ ] Human-only、唯一 active pointer、CAS、RLS 与不可变约束在真实 PostgreSQL 通过。
- [ ] 用户可冻结模板/法规快照，再发布平台新版本并确认旧 Project 仍解析原精确 Ref。

## 非目标与 `NOT RUN` 边界

- 不实现外部法规抓取、真实性 Provider 或生产模板库运营。
- 不实现 IM-05 QualityProfile 业务；只保存 WI-01 已冻结的强引用边界。
