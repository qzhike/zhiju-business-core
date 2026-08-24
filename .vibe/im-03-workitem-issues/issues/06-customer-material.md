## 目标

实现 CustomerMaterial 提议、版本化确认与来源选择，使客户业务材料与原始附件分层，并保留 Human/Agent 权限和不可变历史。

父追踪：#56

硬依赖：#61

## 范围

- `customer_material`、`customer_material_version`、`customer_material_decision` Migration、Repository 与 Handler。
- `project.propose_customer_material`、`project.confirm_customer_material`、`project.CustomerMaterialConfirmed`。
- 至少一个同 Project ACCEPTED Source；MaterialSourceSelection 精确定位；确认版本不可改。
- 关键材料 Human-only；Agent 只能提议；evidence/justification 与确认决定可追溯。

## 验收条件

- [ ] 未接受、跨 Project、hash/locator 不匹配的 Source Ref 被拒绝。
- [ ] 同一 Source 可形成受控的不同解析/分类版本，但已 CONFIRMED 版本不可覆盖。
- [ ] Agent/actingFor 不能确认 Human-only 材料；冲突确认不 last-write-wins。
- [ ] Event 只暴露精确 Material Ref、type、completeness 与 decision ref，不复制客户原文。
- [ ] 幂等、CAS、RLS、不可变约束和回滚在真实 PostgreSQL 通过。
- [ ] 用户可从一份 SourceMaterial 提议并确认 CustomerMaterial，再尝试改写确认版本并看到拒绝。

## 非目标与 `NOT RUN` 边界

- 不实现 OCR/LLM 抽取 Provider 或真实 Evidence 验证。
- CustomerMaterial 确认不自动修改 EnterpriseFact 或 CustomerBaseline。
