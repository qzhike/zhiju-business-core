# 决策与实施约束索引

本目录保留持久设计理由，不作为任务执行日志。权威优先级遵循 [HL-Spec](../high-level-docs/HL-Spec.md)。Issue 已关闭不撤销既有约束；历史数字、实现进度和当时授权不提供当前指令。

| 主题                          | 文档                                                       | 执行关联 / 状态                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human + Agent 工作台 MVP | [正式设计提案](workspace-mvp-human-agent.md) | 产品理念、技术栈、草稿/改稿策略、DOCX/ZIP 输入、四类服务器 Runtime、Runner 先分析与缺口索取复制已确认；跨模块 Spec Delta 待审查；独立前端分支，不变更 IM-06 当前执行范围 |
| UI 首版工程收口 | [工程决策提案](workspace-ui-engineering-baseline.md) | 用户于 2026-10-08 批准工程方案；首装版本、组件/BFF/会话与验收方向冻结；独立审查与正式实现尚未完成 |
| Runner 分析报告 | [Schema v0.1 设计](runner-analysis-report-v0.1.md) | 基于独立测试报告形成 T2 待审草案、JSON Schema 与匿名示例；尚未注册或实现 Core/Runtime 接纳 |
| Runner 启动候选字段 | [报告 v0.2 草案](runner-analysis-report-v0.2.md) | D14 字段细化；保留 v0.1；未注册、未接入生产 Runner |
| 启动核对数据与回执 | [DTO v0.1 草案](workspace-startup-review-v0.1.md) | 保留已批准布局；合成样例与设计检查，不代表 Core/API 实现 |
| IM-06 Human-operated          | [设计提案](task-execution-human-operated.md)               | TD-01–04 APPROVED 2026-09-08；TD-05–07 PROPOSED，实现未开始                                                                                                                                                      |
| Canonical Content / Renderer  | [IM-DG-005 决策](canonical-content-renderer.md)            | 用户批准路线；[#89](https://github.com/qzhike/zhiju-business-core/issues/89)、[#90](https://github.com/qzhike/zhiju-business-core/issues/90)、[#125](https://github.com/qzhike/zhiju-business-core/issues/125) |
| EnterpriseProject 能力        | [Capability 决策](enterprise-project-capabilities.md)      | [#57](https://github.com/qzhike/zhiju-business-core/issues/57)                                                                                                                                                 |
| RLS 与事务 Context            | [安全边界](rls-transaction-context.md)                     | [#31](https://github.com/qzhike/zhiju-business-core/issues/31)                                                                                                                                                 |
| 跨模块实施补充                | [实施基线](implementation-baseline-notes.md)               | 按模块定位，历史进度不替代当前 Spec/Test                                                                                                                                                                       |
| EnterpriseProject 事务基础    | [设计补充](enterprise-project/transaction-foundation.md)   | [#58](https://github.com/qzhike/zhiju-business-core/issues/58)                                                                                                                                                 |
| Fact/Profile/Product/QMS      | [设计补充](enterprise-project/fact-profile-product-qms.md) | [#59](https://github.com/qzhike/zhiju-business-core/issues/59)                                                                                                                                                 |
| CustomerMaterial              | [设计补充](enterprise-project/customer-material.md)        | [#62](https://github.com/qzhike/zhiju-business-core/issues/62)                                                                                                                                                 |
| Query/Source Slice/Projection | [设计补充](enterprise-project/query-source-projection.md)  | [#67](https://github.com/qzhike/zhiju-business-core/issues/67)                                                                                                                                                 |

Workspace UI 的未来 UI-DG-001～003 继续在 [Technology Baseline §6.1](../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md#61-im-ui-01-技术选型边界) 与 [Module Spec UI01](../module-specs/Module-Spec-UI01-WorkspaceUI.md) 维护；旧建档 Task-Plan 归档不代表技术栈或实现已批准。
