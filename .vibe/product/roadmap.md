# Zhiju Business Core 当前路线

本文件是当前推进意图的唯一入口，不保存逐轮执行日志或完整 Issue 正文。
阶段范围、依赖与退出标准见 [Implementation Milestone Plan](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)；产品和工程冻结规则见 [HL-Spec](../high-level-docs/HL-Spec.md)。

## 已接受的前置基线

截至 2026-09-07 的远端核对，IM-05 已由 [父 Issue #120](https://github.com/qzhike/zhiju-business-core/issues/120) 接受并关闭。最终阻断修复 [PR #149](https://github.com/qzhike/zhiju-business-core/pull/149) 已合并至 `76079a770f3a64e94435256c87c66db1e2b8acf4`，其 `verify` 检查成功。此处引用交付证据，不宣称本次文档整理重跑了业务验收。

接受范围为 scoped engineering；真实 Provider/Feishu、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人确认和独立人工业务验收仍为 `NOT RUN`。不得用 Issue 关闭扩大验收范围。

## Current — IM-06 TaskExecution Human-operated Core

当前 IM-06 技术基础已交付，继续推进业务切片的 readiness 检查。目标是 Human 发起、owning Service 执行的 Task/WorkOrder/Context/Run/Result/InformationRequest 流程，以及独立 Completion 与 Usage/Provenance；不提前引入真实 Agent 自动化。

开始实现前：

1. 对账当前 TaskExecution Module Spec/Test、现有实现与 IM-06 退出标准。
2. 处理实质性契约缺口；只有 NOW + READY 的独立切片才发布 Issue。
3. Issue 明确权威章节、可观察验收、非目标及 `full` 验证目标。

已识别的首次 Context/Contract 构建、Human-operated Driver/Attempt 与控制入口、Readiness/Validation/Completion 判断事实来源，见 [IM-06 设计提案](../decisions/task-execution-human-operated.md)。第 2–4 节方向与约束已获用户批准；具体技术增量 TD-01–04（新增 API、Task v2、持久化与首版范围）已获用户批准，作为未来实现的设计基准；其中 [Issue #157](https://github.com/qzhike/zhiju-business-core/issues/157) 的 Source Slice capture/read Schema、Catalog 和技术 Guard 已实现，其 owning 字段与边界见 Module-Spec-002；其余可执行契约及业务能力继续按切片交付。[#188](https://github.com/qzhike/zhiju-business-core/issues/188) 已实现 Source Slice capture/read Handler、不可变持久化、真实授权组成层与 Policy 消费，并通过受控 PostgreSQL 验证；[#191](https://github.com/qzhike/zhiju-business-core/issues/191) 已实现 TD-04 的 `project.get_resolution_receipt@1.0` 窄权威 Query、规范 Receipt 材料（V2015）、真实授权组成层与精确可重算 backfill，并通过受控 PostgreSQL 验证；TE 的 answer/resolver 消费与完整首次 Context 业务链仍为 NOT RUN。

首个技术基础切片已通过 [PR #155](https://github.com/qzhike/zhiju-business-core/pull/155) 合入 main，[Issue #151](https://github.com/qzhike/zhiju-business-core/issues/151) 已关闭。当前具备基于既有 V3000 技术表的模块事务、持久化幂等、精确 bigint CAS、Hash/Scope guard 与失败恢复能力；命令目标由闭包绑定及 envelope 顶层快照固定。具体行为与验证场景见 Module-Spec-003 §10.1 和 Module-Test-003，不将技术 Foundation 的通过扩大为业务 Handler 或 IM-06 整体完成。

后续按依赖滚动收敛：Task/WorkOrder 与首次 Context → Run/Attempt/Result Acceptance → InformationRequest 与新 Context/Run Retry → Completion、Query/Projection 和受控退出 Fixture。Context/Run 等依赖设计决定与技术基础；跨模块 Completion 依赖真实 Producer 和 owning Consumer。此处是顺序意图，不提前拆出完整 Issue backlog。

当前已交付 [#175 Task v2 契约](https://github.com/qzhike/zhiju-business-core/issues/175)、[#179 构建期 profile registry 与纯校验](https://github.com/qzhike/zhiju-business-core/issues/179)，、[#183 两个 PolicyVersion 操作的静态契约与 PayloadGuard 注册](https://github.com/qzhike/zhiju-business-core/issues/183)（注册时为 Catalog/Registry 211 项，现为 213 项），以及 [#186 PolicyVersion Handler、精确 Purpose 授权与 scoped 持久化](https://github.com/qzhike/zhiju-business-core/issues/186)（V1005；Enterprise/Project Scope 的登记、exact 解析、取代基数与授权重验已在真实 PostgreSQL 验证）；[#200 版本绑定 Task/WorkOrder 创建授权前置](https://github.com/qzhike/zhiju-business-core/issues/200) 已交付 IdentityPolicy owning 内部 `TaskExecutionCreationAuthorizationPort`（四个精确版本映射与受信 capability 配置、single covering Grant、target 绑定 Decision 签发与当前 Grant/Policy 重验）与 `V1006` target 镜像迁移，`IP-TAUTH-001`–`008` 已在真实 PostgreSQL 执行；TaskExecution DRAFT Handler 消费与业务链仍 `NOT RUN`。[#176](https://github.com/qzhike/zhiju-business-core/issues/176) 的 Policy/Evaluator 设计与 [#181](https://github.com/qzhike/zhiju-business-core/issues/181) 的有限参数、4096 字节结果余量及 SD-181-1 已分别获批，现行设计见 [决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。EP Source Slice capture/read 与 capture Policy 解析已由 #188 实现。[#189](https://github.com/qzhike/zhiju-business-core/issues/189) 已注册首版 TaskExecution Evaluator 的两个静态选择器并提供纯精确解析；Evaluator 算法、判断事实与 Readiness/Validation Handler 仍为 NOT RUN。[#192](https://github.com/qzhike/zhiju-business-core/issues/192) 已交付 Quality 的权威 Revision 执行资格 Query、精确 Purpose 授权边界与真实 PostgreSQL 正反例（Catalog/Registry 212→213、QualityGovernance 37→38）；TE Completion 消费与跨模块业务链仍为 NOT RUN。本次 readiness 对账确认：不应把 IdentityPolicy 授权组成与 TaskExecution DRAFT Handler 捆成一个跨所有权 Issue。[IM06-AUTH-01](../decisions/task-execution-human-operated.md#14-im06-auth-01-taskworkorder-创建授权组成补充提案) 已于 2026-09-15 通过独立的人类设计审查并获得明确批准，版本 action/resource selector、Decision target 绑定及当前 Grant/Policy 重验语义已解析，IdentityPolicy owning 前置切片现为 `NOW + READY`，并已发布为 [#200](https://github.com/qzhike/zhiju-business-core/issues/200)。该前置实现交付并经验证后，再复核 Task/WorkOrder DRAFT 创建与 Context Builder/ReadinessBuilder/Validator/Freeze 的滚动切片。其余 EP/TE 业务切片、TE 消费侧重验与完整业务链仍待交付，本项交付不使完整 IM-06 自动 READY。TD-05–07 仍为待批准提案，不作为已批准实现范围。

退出时须证明：冻结 Scope/Hash 不变，active Run/final Result 并发唯一，正常完成与 BLOCKED_INPUT→授权答案→新 Context/Run 两条链，Cancel request/late result 失败语义，Run/WorkOrder/Task/DeliveryItem 分层完成，Usage 未知与声明来源可区分，权威 Query 与 Projection freshness 分离。完整验证使用 `vibe verify full --json`；真实飞书/Runtime 与人工业务验收独立列为 `NOT RUN`，不得被受控 Fixture 替代。Issue #151 的技术 Foundation 通过不替代 IM-06 业务闭环验收。

首次构建、Runtime/状态协调、判断事实与跨模块读取边界的 TD-01–04 已批准,由 owning 规格与测试附录维护。剩余的 Query/Projection 快照与重建、Usage/安全来源、正常与阻塞恢复退出链已形成 TD-05–07 提案,见设计 §11 和 Spec 003 §12–14;尚待人类批准与独立审查,不改变首版来源/答案/质量条件范围。业务实现仍按实际依赖与 NOW + READY 滚动发布,Git 交付按用户授权范围推进。

## Next / Later — 后续顺序

- [Issue #27](https://github.com/qzhike/zhiju-business-core/issues/27) 仍开放，承接 IntegrationGateway 的剩余 Handler/Adapter/Persistence 与外部验收。其旧正文包含早期 23-operation 与 Renderer 未实现描述，不能直接作为下一项完整实现任务；需先与已交付 Renderer slice 和当前 Module-Spec-007 对账，再按所属阶段收敛验收范围。
- IM-06 后可启动 IM-UI-01；IM-07 Feishu → IM-08 CLI Runtime 保持既有依赖。IM-UI-01 可与该窗口并行，IM-09 等待三者适用 Gate。
- UI-DG-001/002 及 UI-DG-003 具体设计、IM-DG-006 仍须按 [阶段决策 Gate](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md#4-开始编码前的决策-gate) 获得明确决定。本规划不选择 UI 技术栈或批准未决 Runtime 方案。

## 维护规则

Planner 在阶段启动/关闭或优先级变化时协调本文件；普通实现不重复抄写进度。GitHub Issue/PR 与 Git 是执行状态来源。旧 Task-Plan、Issue 草稿和报告是历史材料，不能覆盖本文件的推进方向或最新 GitHub 事实。
