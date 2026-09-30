# IM-06 正式输出与独立 Completion Spec Delta（#233）

状态：`T2 / PROPOSED / HUMAN DESIGN APPROVAL PENDING / IMPLEMENTATION NOT STARTED`。基线为执行时读回的 `main@8d15943f4c28a6a7b4c177571d04c773f74d5238`。本设计只交付一个可用结果的详细语义：授权 Human 经 Artifact owning 入口创建正式输出，受控 Run 真实报告该输出，TE 独立完成 WorkOrder/Task，并提供历史 Evaluation 与当前可用性权威读回。设计审查、明确人类设计批准、未来实现与业务验收是不同门禁；发布本 PR 不关闭 #233 或 IM-06。

## 1. 对账与变更分类

当前 Registry 230 项、TaskExecution 57 项，历史 compatibility baseline 200 项不变。对账来源为 `contracts/src/operations/{task-execution,artifact}.schema.ts`、`contracts/registry/{public-api,evaluator-profiles,policy-profiles}.v1.json` 及 owning 实现，不能从设计清单推断 Handler 已交付。

| 当前事实 / 证据位置 | 本轮拟议 Delta | 分类 |
|---|---|---|
| `controlled-final-result.ts` 与 `recovery-final-profile.ts` 只支持空业务输出；#231 两次执行停在 COMPLETION_PENDING | 新冻结 profile 支持一个真实新建 Revision；五项 Validation、Acceptance 独立重验 | 内部支持集增量；新 Policy/Evaluator selector，不改变旧 profile |
| `work-order-validation-plan.ts` 固定 `zhiju.artifact.artifact_revision`；Artifact `revision-service.ts` 正式 Ref 为 `artifact.artifact_revision` | 新 Controls/Validator profile 明确使用 owning 拼写，要求新 Task definition、新 WorkOrder/Context/Contract/Run | 显式兼容设计变化；不提供别名、不改旧 Hash/fixture |
| Artifact 普通 creation 的 provenance 只验证 shape/Scope/principal，不能证明 Run owning 关联 | 新 execution-revision owning creation 与 exact output-fact Query；创建时绑定已存在 Run，Result 通过后向引用建立关联 | additive 公开契约及 Artifact/TE 内部授权读边界 |
| 两项 `evaluate_*_completion@1.0` 已注册但未实现，输入含 caller fact/blocker/time 且缺 Policy | 保留 v1；新增 @2.0 闭集请求，服务端派生所有事实、集合与时间，返回精确 Evaluation | 显式 Major 操作增量，既有 200 契约保持原样 |
| `recovery-root-state.ts` TaskState 仅返回 NOT_EVALUATED；`task-readiness-plan.ts` 将 COMPLETED dependency 视为 STALE | WorkOrderState、Judgment exact Query；TaskState 沿用已注册形状；Readiness 实际消费当前 Completion | 已有契约实现 + additive Query；不批准 Board/Usage |
| #192 已交付 quality current eligibility，但没有提供初次Completion的RAS/ABS来源选择 | 新冻结Profile pin、Quality owning内部exact snapshot发现，然后消费已有current eligibility | 既有契约消费 + 有限内部read增量，无Quality新公开操作/表 |

## 2. 提案与支持边界

1. 选择 Artifact owning `artifact.artifact` / `artifact.artifact_revision` 作为**新正式输出路径**的公开身份。旧 `zhiju.artifact.*` 冻结计划只可审计和继续其原空输出支持集；无法取得本路径 Completion，需重新创建/冻结。旧成功 Run、历史 Result/Acceptance/Request/Resolution 不改写、不补造输出。已有 `create_task@2.0` 的 closed definition 可用于新路径，无需改 Task CREATE schema。
2. 首版恰一个 `EXACTLY_ONE / CONTENT_ADDRESSED / creationRequired=true` 的 STRUCTURED_DOCUMENT Revision，TargetScope 限同 Project，冻结 registered structure schema，无 workspace/ExternalRef、复用输入、合成 Receipt、latest 或跨项目输出。Human 在 Run RUNNING 且仍有有效执行绑定时创建，IG 原 invocation 在创建 owning 提交后才释放含该 exact Ref/Receipt 的 final。恢复路径 Run-1 BLOCKED_INPUT，真实答案/Resolution、Context-2、Run-2 后创建输出；terminal Run-1 不恢复。
3. Revision 创建时不要求尚不存在的 AgentResult。provenance 的 agentResultRef 缺省；Artifact 的 immutable creation binding 证明 Run/WorkOrder/Task/Context/Command Receipt；真实 Result 回指 exact Revision 和 Receipt，TE 在 Validation/Completion independently join。这是对旧 §11.6 “provenance 的 Result Ref 相同”文字的明确细化，不允许补写 SEALED provenance，也不放宽新建要求。
4. WorkOrder Completion 要求全部五类输出条件和无 blocker；required proposal 只支持已交付 CustomerMaterial 恢复映射，其他类型显式拒绝。Task Completion 要求输出、无 blocker、非空全部 child WorkOrder Completion，支持可选 RAS/ABS 质量条件。所需条件不能因 required=false、人类审核、caller 空集合或 Policy 内容而豁免。有限 selector、字段、期限、授权与并发由 owning 规格定义。
5. Completion 事务只写目标 Root、附属 immutable Evaluation 与 Receipt/Audit/Edges/唯一已注册 Completion Event。Task 不写 WorkOrder，WorkOrder 不写 Run。TE→EP dispatch/DeliveryItem 完成仍为下一独立结果；保持 EP 对真实、非空正式 satisfiedFactRefs 的消费约束。

## 3. 权威路由与验收

| 唯一权威 | 本轮内容 |
|---|---|
| [Spec 003 §25](../module-specs/Module-Spec-003-TaskExecution.md#25-正式输出与独立-completion-spec-delta233) | frozen profile、selectors、两项 Completion v2、Evaluation 字段/Hash、集合锁/CAS、Readback/Readiness、错误与 replay |
| [Spec 004 §12](../module-specs/Module-Spec-004-Artifact.md#12-im-06-正式执行输出的-owning-创建与精确事实提案233) | execution Revision 创建、不可变来源关联、exact Query 与 current lifecycle |
| [Spec 001 §15.15](../module-specs/Module-Spec-001-IdentityPolicy.md#1515-im06-completion-独立授权组成提案233) | operation/principal/action/purpose/target 与依赖读取、重放当前授权 |
| [Spec 007 #233](../module-specs/Module-Spec-007-IntegrationGateway.md#233-非空正式输出的受控-final-profile提案) / [Runtime #233](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#233-正式输出-final-的有限协议提案) | 原 invocation 的后提交输出释放、正常与恢复模板；IG 不作业务结论 |
| [Catalog #233](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#233-正式输出与-completion-契约提案) / [API #233](../api-contract-v0.1/API-Contract-v0.1.md#233-completion-兼容与读回提案) | 新操作/typed identity、兼容集合、字段与统一错误外观 |
| [PostgreSQL §40](../high-level-docs/07-postgresql-logical-model-v0.1.md#40-正式输出与-completion-前向持久化提案233) | local collection serialization、Evaluation/Receipt/Event 原子性、来源镜像、RLS 与不改历史 |
| [Module-Test 003 #233](../module-tests/Module-Test-003-TaskExecution.md#233-正式输出与-completion-设计验收矩阵) 与 owning 001/004/005/007、Runtime Test | owning 正常/恢复、wrong source/hash/Scope、撤权、late/unprocessed blocker、并发、回滚/replay、immutable history |

设计成功标准是上述每个字段/失败语义可定位到唯一 Owner、200 compatibility baseline 无修改、docs Gate 与独立语义审查通过。未来实现用生产 composition/owning Command/Query + 真实 PostgreSQL，不以直接写表、伪造授权/Receipt/Evaluation 或 inline Ref 替代 named fixture。正常与恢复各需独立 fixture、exact readback 和故障证据，全部初始 `NOT RUN`。

执行策略：先审查本提案及 owning future-semantics；批准后 Planner 基于届时 main 重验 NOW + READY，为完整输出→Completion→权威读取/依赖消费创建一个 coherent 实现结果。后续 Issue 必须整体包含注册/生成/正负 fixture、授权组成、forward migrations、Handler/Process/Query 与 `full`（含 PostgreSQL）；不能只交付注册而称结果可用。本次不创建后续 Issue，不实现产品代码。

## 4. 批准与未决状态

本提案不存在交给 Implementer 自行选择的业务分支。公开兼容变化、新 profile、后向 Result 关联与观察时点一致性界限均是本次须批准的具体设计决定。**独立设计审查与明确人类设计批准待取得**；Review 记录必须绑定具体 design revision，批准前不得生成依赖实现 Issue或启动其 T2 实现。#224 的 20 tiered PASS / 3 PARTIAL、实际 Grant PolicySnapshot lifecycle 延后和 TD-05–07 未批准边界均保留；Cancel/late-result 的 IM-06 退出要求不因本设计被关闭。
