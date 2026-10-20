# 收敛后的 MVP 文档

本目录集中维护 2026-10-20 确认的 MVP 可用闭环、Core 缩编重构方案及交付计划。产品范围及“先订正 UI、确认流程，再补后端”的详细交付计划已经确认；后端技术方案仍为提案，业务实现尚未开始，UI 流程、运行与人工业务验收尚未执行。

## 阅读顺序

| 顺序 | 文档 | 用途 |
|---|---|---|
| 1 | [MVP 可用闭环](usable-loop.md) | 产品范围、用户操作、三阶段定稿、意见与版本、失败恢复、验收条件及非目标 |
| 2 | [MVP 交付计划](delivery-plan.md) | UI 订正与流程确认、后端准备、真实交付批次、依赖和分层验收 |
| 3 | [Core 缩编重构方案](core-refactoring-plan.md) | 目标结构、Core 数据、独立 Runner 接入、现有代码处置及必要设计增量 |
| 4 | [当前路线图](../product/roadmap.md) | 唯一的 Current/Next/Later 推进意图，继续在原位置维护 |

## 按问题定位

| 问题 | 阅读位置 |
|---|---|
| 用户如何从 ZIP 上传走到最终交付？ | [用户操作](usable-loop.md#4-从上传到交付的用户操作)、[三阶段](usable-loop.md#3-三个业务阶段) |
| 什么时候确认范围、阶段和交付？ | [人工决定、讨论和版本](usable-loop.md#5-人工决定讨论和版本) |
| 上游返工或执行失败后如何恢复？ | [上游改变与必要恢复](usable-loop.md#6-上游改变与必要恢复) |
| Core 保存什么，Runner 接收和返回什么？ | [数据与一致性](core-refactoring-plan.md#3-数据与一致性最小方案)、[独立 Runner 接入](core-refactoring-plan.md#4-独立-runner-接入边界) |
| 哪些代码复用、改造、重写或退出？ | [现有代码处置](core-refactoring-plan.md#5-现有代码处置) |
| 先订正哪些 UI，什么时候可以补后端？ | [UI 订正与流程确认](delivery-plan.md#3-第一阶段ui-订正与流程确认)、[后端设计出口](delivery-plan.md#4-第二阶段从确认的-ui-反推最小后端设计) |
| 后端按什么结果交付，怎样判断闭环可用？ | [真实业务交付批次](delivery-plan.md#5-第三阶段逐段接通真实业务能力)、[验收条件](usable-loop.md#7-验收条件) |

## 文档边界

- 产品范围与验收要求以本目录的可用闭环为唯一仓库内详细定义；架构取舍和重构策略由重构方案维护，不再在原 `product/` 和 `decisions/` 目录保留副本。
- 交付计划拥有阶段顺序、批次依赖和验收安排，不注册业务字段或改写当前实现；roadmap 只维护 Current/Next/Later，执行状态仍以 GitHub 为准。
- 外部 [MVP PRD确定版](</Users/galendai/Local/my-knowledge-base-v2/03_Projects/zhiju-business-core/MVP/MVP_PRD确定版.md>)由用户维护，本目录承接已确认要求，不复制维护另一份 PRD。
- 权威关系及新旧设计适用边界见 [HL-Spec](../high-level-docs/HL-Spec.md)；正式模板和验证要求见 [验证基准 §2.9](../high-level-docs/08-verification-baseline.md#29-缩编-mvp-正式模板与闭环验收)。
- 既有模块规格、历史决策和工程证据保留原位置。执行与验收证据仍进入对应 Issue/PR，本目录不另建任务状态表或逐轮验证日志。
