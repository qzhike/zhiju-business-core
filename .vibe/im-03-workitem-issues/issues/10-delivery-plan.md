## 目标

实现 DeliveryPlan/DeliveryItem 草案、Human 批准、激活和依赖/criteria 冻结，使 Gap 建议只在明确 Human 决定后成为项目交付承诺。

父追踪：#56

硬依赖：#65

## 范围

- `delivery_plan`、version/item、artifact requirement、dependency Migration、Repository、Handler 与激活事件。
- `project.create_delivery_plan_draft`、`project.approve_delivery_plan`、`project.activate_delivery_plan`、`project.DeliveryPlanActivated`、`project.DeliveryItemActivated`。
- accepted Gap 与精确 baseline refs；assumption/exclusion；高风险 QualityProfileRef；Human-only 审批/激活。
- 同 Plan Version 依赖图无环、同项目唯一 active plan、Approved/Active 版本不可变。

## 验收条件

- [ ] 未接受 Gap、模糊/跨 Scope baseline ref、缺 QualityProfileRef、依赖环或重复 item key 被拒绝。
- [ ] Agent 可起草但不能批准/激活；actingFor 不提权。
- [ ] APPROVE 以外决定不形成 approved pointer；激活必须引用精确 Human decision。
- [ ] Plan/Item criteria 与 hash 冻结；范围变化要求新 Plan Version，旧计划不改写。
- [ ] 并发激活、CAS、RLS、幂等、事件最小化和事务回滚在真实 PostgreSQL 通过。
- [ ] 用户可从 accepted Gap 创建含依赖 Item 的计划，先验证环被拒绝，再由 Human 批准/激活并查看精确 item refs。

## 非目标与 `NOT RUN` 边界

- 不自动创建 Task、Artifact 或 Release；这些属于 IM-04+。
- 不实现 DeliveryItem Completion 或跨模块执行链。
