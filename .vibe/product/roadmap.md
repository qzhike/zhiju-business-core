# Zhiju Business Core 当前路线

本文件是当前推进意图的唯一入口，不保存逐轮执行日志或完整 Issue 正文。
阶段范围、依赖与退出标准见 [Implementation Milestone Plan](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)；产品和工程冻结规则见 [HL-Spec](../high-level-docs/HL-Spec.md)。

## 已接受的前置基线

截至 2026-09-07 的远端核对，IM-05 已由 [父 Issue #120](https://github.com/qzhike/zhiju-business-core/issues/120) 接受并关闭。最终阻断修复 [PR #149](https://github.com/qzhike/zhiju-business-core/pull/149) 已合并至 `76079a770f3a64e94435256c87c66db1e2b8acf4`，其 `verify` 检查成功。此处引用交付证据，不宣称本次文档整理重跑了业务验收。

接受范围为 scoped engineering；真实 Provider/Feishu、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人确认和独立人工业务验收仍为 `NOT RUN`。不得用 Issue 关闭扩大验收范围。

## 近期方向

下一阶段按已批准依赖顺序进入 **IM-06 TaskExecution Human-operated Core 的规划与 readiness 检查**。目标是 Human-operated Task/WorkOrder/Run/Result/InformationRequest 流程，不提前引入真实 Agent 自动化。

开始实现前：

1. 对账当前 TaskExecution Module Spec/Test、现有实现与 IM-06 退出标准。
2. 处理实质性契约缺口；只有 NOW + READY 的独立切片才发布 Issue。
3. Issue 明确权威章节、可观察验收、非目标及 `full` 验证目标。

本路线不授权创建 Issue 或开始 IM-06 编码。仓库文档整理是当前维护工作，不新增业务 milestone。

## 剩余工作与后续顺序

- [Issue #27](https://github.com/qzhike/zhiju-business-core/issues/27) 仍开放，承接 IntegrationGateway 的剩余 Handler/Adapter/Persistence 与外部验收。其旧正文包含早期 23-operation 与 Renderer 未实现描述，不能直接作为下一项完整实现任务；需先与已交付 Renderer slice 和当前 Module-Spec-007 对账，再按所属阶段收敛验收范围。
- IM-06 后可启动 IM-UI-01；IM-07 Feishu → IM-08 CLI Runtime 保持既有依赖。IM-UI-01 可与该窗口并行，IM-09 等待三者适用 Gate。
- UI-DG-001/002 及 UI-DG-003 具体设计、IM-DG-006 仍须按 [阶段决策 Gate](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md#4-开始编码前的决策-gate) 获得明确决定。整理不选择技术栈或批准未决方案。

## 维护规则

Planner 在阶段启动/关闭或优先级变化时协调本文件；普通实现不重复抄写进度。GitHub Issue/PR 与 Git 是执行状态来源。旧 Task-Plan、Issue 草稿和报告是历史材料，不能覆盖本文件的推进方向或最新 GitHub 事实。
