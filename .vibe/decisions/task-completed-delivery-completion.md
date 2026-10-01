# TaskCompleted 派发与精确 DeliveryItem Completion 设计（#237）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-01 / INDEPENDENT DESIGN REVIEW PASSED / NOT IMPLEMENTED / NEW RUNTIME CASES NOT RUN`。对账基线：`main@cd2a249cff5e8bc0406321863b39b8cbe5141a2e`（2026-10-01 远端读回）。本轮只交付设计；目标是一个后续完整实现结果：真实 TE TaskCompleted Outbox → EP Inbox/关联事实 → 独立 Evaluation → EP 权威读回。正常和一次 BLOCKED_INPUT 恢复链都必须实际调用 controlled Driver；Task-only Item 可 SATISFIED，另需 Release 的 Item 保持 UNSATISFIED。

## 1. 当前事实、缺口与 Spec Delta

| 当前已交付事实 | 缺口 / 本次提案 | 分类与唯一权威 |
|---|---|---|
| #235 / PR #236 已交付正式输出及独立 Task Completion，Task CAS/immutable Evaluation/Receipt/Audit/TaskCompleted 同事务；Registry/TE/历史 Baseline = 237/62/200 | 只派发已提交的 TaskCompleted；不重做 producer、不以运行成功代替完成 | TE 内部边界；[Spec 003 §26](../module-specs/Module-Spec-003-TaskExecution.md#26-taskcompleted-受限派发设计237) |
| IP `messaging/dispatcher.ts` 只操作 identity_policy；TE V3000 有 delivery metadata、dispatcher role 和宽读取 RLS，没有 TE worker/游标 | TE 自有窄 claim/lease/fencing、稳定投递材料、Project 分区游标、成功/UNKNOWN/DEAD/恢复 | 内部持久化和安全增量；[PostgreSQL §41](../high-level-docs/07-postgresql-logical-model-v0.1.md#41-taskcompleted-派发与精确-delivery-completion-持久化提案237) |
| `TaskCompleted@1.0` 四字段不含 Item；Task definition 已冻结 exact VERSIONED Item，Root 有 item/version mirror | 从事件对应 Evaluation 的 definition 获取 immutable sidecar，EP 自行定位 Item 所属 Plan Version；不改 Event、不查询 latest | TE/EP 内部关联增量；Spec 003 §26、[Spec 002 §23](../module-specs/Module-Spec-002-EnterpriseProject.md#23-精确-taskcompleted-关联与-deliveryitem-completion-设计237) |
| EP §21 / V2013 的 Inbox、Fact、Evaluation/pointer/Impact 已交付；旧 grammar 可按 Project-wide eventType 匹配，v1 caller 提供时间/水位/evaluator | 新冻结 exact-task profile + `evaluate_delivery_item_completion@2.0`，服务端选取算法与来源时间；v1 保留且拒绝新 profile | 显式 Major 版本增量，旧 Plan 不迁移；Spec 002 §23、Catalog/API #237 |
| 旧 EP Fact Ref Hash 对应源 Event payload；没有 exact Fact/Evaluation 的可用组成层 readback | 新 EP owning 内部 Readback Port 复验 ledger、association、Evaluation 和 pointer；Hash 域按原 Ref 保留 | 内部 Port，无公开 Query；Spec 002 §23 / API #237 |
| IP 已有 target-bound Decision、Actor/认证绑定与当前 Grant 重验；SERVICE kind 本身不授予权限 | 逐步单独授权 Dispatcher、Consumer、Evaluator、Readback/历史 Receipt；收窄数据库角色 | IP 内部 composition 增量；[Spec 001 §15.16](../module-specs/Module-Spec-001-IdentityPolicy.md#1516-im06-delivery-completion-授权组成提案237) |

#236 的最终 full CI（fe7ef7b，82 files / 1618 普通 tests、43 files / 547 PostgreSQL tests）及 main 文档 CI 是已有分层证据，不是本轮 dispatch PASS。既有 WI-12 合成 Event persistence 也不等于真实 TE→EP 链。Producer `producerModule` 使用连字符（`task-execution`），watermark `sourceModule` 使用下划线（`task_execution`）；纠正 EP §21.2 的列名/取值混淆，不改 Event 合同。

## 2. 决定与支持边界

1. 只支持 #235 的 canonical Task（create_task@2.0、正式输出 profile）。新 Plan 在 Human 批准之前冻结一个预分配 Task UUID 的 exact criterion；之后按该 UUID 创建 Task 并引用该确切 Item Version。Task-only 与 Task+Release 是两个独立合法 Plan/Task fixture，不让一个 Task 同时归属两个 Item。不补写旧 Plan criteria、不改旧 Task definition。
2. 保留 TaskCompleted@1.0 字段；Dispatcher 从 TE 的已提交 Outbox、source Receipt、原 Task Evaluation 及该 Evaluation 引用的 immutable definition 推导 sidecar。EP 没有 TE 同步依赖。来源完整性、两个 payload Hash 域及关联校验见 Spec 003 §26；EP 的 ledger/association/readback 由 Spec 002 §23 拥有。
3. SourceWatermark 是受信分配事务观察已提交事件的顺序，**不是 producer 全局提交顺序、事件时间顺序或完整消费 checkpoint**。晚提交的低 UUID/旧 recorded_at 行仍须扫描并分配新 sequence，不能用 high-water-id 跳过；投递乱序不覆盖同一精确关联的较新事实，也不丢弃别的 Item 的低序事实。
4. 新 EP @2.0 只接受新 profile，@1.0 仍处理旧 grammar，因其现行 unknown-key 拒绝规则不能修改新 profile 的 pointer。不得向新入口提交 outcome、时间、watermark 或 evaluator。公开 Registry 在未来实现时 237→238，TE 62 不变，历史 200 不变；没有新增公开 Query/Event。内部 Port 不伪装公开 API。
5. EP 判定的是**已消费历史正式 Task 完成事实**满足本 Item 冻结标准，不证明 TE Completion 当前 USABLE。TE Policy 到期/输出或质量失效不由本链自动同步；没有 TaskCompletionInvalidated producer/consumer，首版不承诺该 follow-up。EP readback 明确 `taskFactSemantics=HISTORICAL_COMPLETION`、`taskCurrentUseStatus=UNKNOWN`；不得用 SATISFIED 授权新的执行、审批或发布。已有 Release/Quality revoke ledger 规则仍适用，所需 Release 无事实时绝不豁免。
6. 保持每个 Owner 独立事务。Outbox 投递成功只确认 Inbox Fact，不意味着 Evaluation 成功；Evaluation 失败保留合法先前进度。公开 HTTP/UI、真实 Provider/CLI/飞书、部署/负载、独立人工业务验收、Board/Usage、Cancel/late-result、Grant PolicySnapshot lifecycle 和 IM-06 整体退出均不扩大。

## 3. 验收与后续策略

可验证交付：两个 standalone owning fixture 从空 TE 业务库开始，经真实 owning Human/Service 创建 Policy、Grant、Project/Plan/Task/WorkOrder、真实 Driver/输出/Completion 到 EP exact readback；禁止直接写业务表或伪造 Event/Receipt/Decision。Task-only SATISFIED 与 Release-required UNSATISFIED、commit-before-confirm replay、两 Worker/stale token、晚提交/低 watermark、wrong Task/Item/Version/Producer/Scope/Hash、当前撤权及事务故障必须执行。唯一权威矩阵在 Module-Test 003/002/001 的 #237 章节；全部新 runtime 案例 NOT RUN。已有 evidence 不升级。

本轮 `docs — vibe verify docs --json`；独立设计语义审查及人类详细设计批准另行绑定实际文档修订（已提交 SHA，或未提交树的 base SHA + 完整文件 hash manifest）。审查记录在 PR 取得真实编号后保存于 `.vibe/reviews/pr-<number>/Review.md`，不得发明编号或把作者自检当独立审查。

设计获批并成为后续任务可访问的权威版本后，Planner 再复核 NOW + READY；一个 coherent 实现候选须包含新 @2.0 注册/生成/正负 fixtures、两 Owner forward migrations、IP 授权/Composition、TE dispatch、EP Inbox/关联/独立评估/readback、正常及一次恢复全链和故障矩阵。实现 Verify 为 `full`，新/变化容器运行时先 `environment`；不在此 Issue 实现、不预先发布依赖 Issue、不自动关闭 IM-06。


## 4. 明确人类设计批准与修订绑定（2026-10-01）

用户在收到两轮独立审查、F1/F2关闭、新docs PASS及具体base+15文件Hash manifest后，明确回复“批准设计，合并PR并更新issue”。本次批准对应manifest SHA256 `fdc8dac48d6f993599203fcdb054b388ec8e301c588d33d068c89bed741b67a7`、base `cd2a249cff5e8bc0406321863b39b8cbe5141a2e`；批准后提交为 `a38e66f2df60d45079a093f08fed4e4f12732ef1`，15文件Git blob SHA256均与批准manifest逐项相等。完整manifest、独立审查和本批准事实归档于[PR #238正式记录](../reviews/pr-238/Review.md)。

批准涵盖本设计的TE窄dispatch/两个Hash域/NULL causation codec/原CONTENT_ADDRESSED definition关联、EP exact profile与Major @2.0/内部readback、IP独立授权及未来normal/recovered/fault矩阵。用户同时授权该设计PR的提交、推送、PR交付、门禁通过后的合并和Issue #237更新；这不是产品实现、依赖Issue发布或IM-06退出批准。除记录批准/审查状态外不改变已复审语义，新增运行仍NOT RUN。
