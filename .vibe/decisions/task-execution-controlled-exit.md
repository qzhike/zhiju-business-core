# IM-06 TD-07 统一受控退出与恢复 Spec Delta

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-07 / INDEPENDENT DESIGN REVIEW NOT RUN / IMPLEMENTATION PRESENT (#250) / REVISION-BOUND VERIFICATION IN ISSUE/PR`。

基线为 `main@b243ce850d9927af3fa1ca8e93158fddc59d89d0`。本决定详细化 [Human-operated 决定 §11](task-execution-human-operated.md#11-剩余设计增量-td-0507) 的 TD-07，不追认旧提案，不改变既有批准的业务支持集。Fixture 的执行规则由 [Spec 003 §14](../module-specs/Module-Spec-003-TaskExecution.md#14-td-07-受控退出-fixture-与恢复设计) 拥有，验收由 Module-Test 003 的 `EXIT-D-*` 拥有；IM-06 退出条件仍由 Implementation Milestone Plan 和 roadmap 拥有。

## 1. 一个独立交付目标

维护者能在真实 PostgreSQL 上复现 Human-operated Core 的正常正式完成、一次 BLOCKED_INPUT 恢复和有限取消，逐阶段看到真实 owning 状态、来源和失败恢复结果，判断当前有限支持集是否满足 IM-06 的工程退出条件。

这是工程验收交付，不是 HTTP/UI 或真实 Agent 可用性声明。不建设统一 Workflow Engine、生产总编排服务或新报告系统。范围为现有 TaskExecution、IdentityPolicy、EnterpriseProject、Artifact、IntegrationGateway 与 API composition 的受控集成测试；适用 Quality owning 证据继续复用已交付矩阵。必要业务缺陷须另行核对 owning 权威和范围，不能通过 Fixture 替代真实业务逻辑。

## 2. 当前实现与缺口

下表是对当前源码、owning 矩阵和交付证据的规划对账，不是本轮运行结果。

| 当前来源                                                     | 已有能力                                                                                                                                        | TD-07 尚需证明的同一目标                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial-context-delivery-cases.ts`；`TE-DEL-D-001–003`      | normal/recovered 分别从空 TE 业务库到正式输出、WO/Task Completion、真实 TaskCompleted 派发、EP Evaluation/readExact；各自另建 Task+Release 负例 | 同一链的阶段读回同时关联 Usage、Board 与故障恢复，保留完整来源身份；现有 PASS 不自动成为 EXIT-D PASS                                         |
| `initial-context-verify-process-recovery.ts`；`TE-REC-D-010` | final 各目标提交后进度丢失、有限输入恢复各目标/Process handoff 重放                                                                             | 把 Result、Acceptance、Run terminal、Resolution、EP consume 五个提交边界的恢复结果连到最终正式输出与独立 EP 读回，不新增跨 owning 总 Process |
| `run-cancellation.test.ts`；`CANCEL-D-*`                     | 两次执行 profile 的取消、无 ACK 到期 ABANDONED、迟到 final 隔离、原进度停止                                                                     | 同一取消来源的权威层级、Usage 和 Board 读回，不把取消或隔离误解为完成                                                                        |
| `usage-provenance.test.ts`；`USAGE-D-*`                      | 独立 Run 历史、当前读权、UNKNOWN/声明来源、有限取消来源                                                                                         | normal/recovered 正式交付链中每个 Run 的精确来源，以及只读查询不改变业务事实或 Driver 调用次数                                               |
| `task-board-entry.test.ts`；`BOARD-D-*`                      | owning 状态链、独立权限、分页/freshness 与发布恢复                                                                                              | 本 Fixture 的阶段 owning 预期与 Board 逐字段对照；刷新暂停时业务成功仍独立成立                                                               |

PR #249 已合并；最终实现 head `2e08125c5f38798a03179c628e327d2e06f76569` 的 select/checks/persistence/verify 均 SUCCESS。该证据支持前置能力可用，不替代新 Fixture 的运行与审查。当前开放 Issue 无 IM-06 同目标任务。

## 3. 拟议决定

### X-01 复用 owning 入口，保留各自恢复职责

复用 named normal/recovered delivery fixtures、实际 `LocalSyntheticRuntimeDriver`、正式输出创建和已交付 composition。Policy/Grant/Decision、Project/Plan、Task/WorkOrder/Context、CustomerMaterial/Receipt、Run/Attempt/final、Artifact/Completion、Outbox/Inbox 均由其正常 owning 入口产生。空 TE 业务库是每条正常/恢复链开始的可验证前置，不以截断共享数据库或直写业务表准备状态。

final Process、blocked-input recovery Process、TaskCompleted dispatcher 分别按 Spec 003 §23、§24、§26 恢复。Human 的答复、采纳和 retry 调度仍是独立授权动作；测试驱动器只保存原请求以模拟响应丢失后的显式重试，不自动代替 Human 决定。WO/Task Completion、EP Evaluation 分别调用 owning Command，不由测试控制器的 step 或 Query 推进。

旧 §14 所称通用 retry Policy、统一 source fingerprint 和总 Process 在本详细化中不新增；各 owning 既有命令身份、进度、source、retry budget 和安全错误为唯一依据。遇到未知结果，保留原 target、commandId、幂等键及 payload bytes，沿既有授权 Receipt/同键重放路径确认；不换键重做、不编辑历史来源。临时不可用、权限/Hash 错误和预算耗尽分别按 owning 规则停止或有限重试，不能由一个通用重试循环覆盖。

### X-02 一条链内保留阶段身份与独立读回

normal 与 recovered 各保留实际产生的完整 Ref、canonical bytes/hash、CommandReceipt、Observation、Evaluation、Outbox/Inbox 关联；静态 Fixture 只写合法输入和预期，不预写可信来源。Run SUCCEEDED、WO COMPLETED、Task COMPLETED、DeliveryItem Evaluation SATISFIED 为独立观察，不声称四个 owning 查询具有跨模块原子快照。TE/EP 历史完成事实也不等于当前 Evaluation USABLE。

恢复链必须显示 final reservation→Request OPEN→ANSWERED→RESOLVED→Context-2→Human retry→Run-2→正式 Completion，保留 Request 尚未建立、仅 RESOLVED/尚无成功后继 Run 时的保守 blocker。原 Contract/Context-1/Run-1/Result-1/Acceptance-1 bytes/hash 不变；Run-2 的 Context/Attempt/fencing/Bundle 精确独立，累计预算不重置。每条链的 Task-only Item 成功，另建合法 Task+Release Item 在无 Release 时 UNSATISFIED。

Usage 按各 Run 精确查询：仅原已接纳声明可为 PRESENT/AGENT_DECLARED，缺声明为 UNKNOWN，无虚构零值、Provider 计量或 runtimeUsageRef。Board AUTHORITATIVE 对照同阶段独立 owning 预期；PROJECTION_OK 在合法首次发布后暂停刷新、推进真实业务，展示 STALE，显式 owning export/publish 后核对新 generation。最终返回的身份、状态、activeWorkOrderRefs、blockerRefs、completionEvaluationRef 与该阶段预期一致；Board/Usage 不承担授权、补偿或完成判定。

### X-03 五个真实提交边界与有限失败

至少各一次：Result submit、Acceptance、Run finalize、Request Resolution、EP TaskCompleted consume 的 owning 事务已成功提交，而响应或 owning 进度确认丢失。故障 hook 必须确认目标已 COMMITTED 后才抛错；与提交前全事务回滚分开。重建相应 worker/entry，使用原命令或原事件材料重试，以生产 Receipt/读回及 scoped SQL 数量、bytes/hash 比较证明单业务效果。允许真实重试 attempt/Audit/IP Decision/技术进度增加，不要求技术记录全部静止。

Result/Acceptance/finalize 故障嵌入 normal 正式链，Resolution 故障嵌入 recovered 正式链，EP consume 后确认丢失嵌入至少一条完整尾链。原 Driver 不因这些重放再次 invoke，正常链一次、恢复链两次实际 invocation；Outbox、Result/Acceptance、Resolution、EP Inbox/Fact/Association 和 Completion 事件按各 owning 唯一性保持单事实。一个 mock Process 抛错不能替代五个已提交边界。

预算耗尽及错误来源的既有可执行反例可复用：final/恢复进度 SUSPENDED 和 dispatch DEAD 仍分别解释；新 worker 不无限调用，不清 blocker、不写成功。保留待处理源和安全错误。输入/授权修复只沿 owning 当前合法动作推进；需要新 identity 的过期 Context 使用新快照，原快照不改。既有双 Worker/并发唯一和 ACL/RLS 矩阵无需复制全排列，但须确认仍被最终 full 收集执行。

### X-04 取消采用已批准的有限支持集

单独使用创建时已有 reservation 的两次执行 profile；真实 Driver ack/start 后延迟原 final，Human cancel 到 CANCELLING，等待原 lease 实际到期后 `expire_run@2.0` 到 ABANDONED，再释放并隔离原 final。保留原 Attempt/Observation/LATE_RESULT Audit 身份与 Hash，无 Cancel ACK/CANCELLED 声称；无新可用 Acceptance、正式输出或 Completion，原 final Process 停止且不再次 invoke。权威 Query、Usage 的 UNKNOWN/LATE_RESULT 与 Board 的实际 activeWorkOrderRefs/blockerRefs 对同一 Run 读回；不从取消状态推造 Request 或非空 blocker。旧单次/无 reservation 支持集仍拒绝，不做取消后 retry。

### X-05 验收和交付边界

这是既有受控工程退出条件的具体化，不降低 Implementation Milestone Plan 的退出 Gate，也不要求所有历史 PARTIAL 行全量升级。新 `EXIT-D-*` 仅按其实际层级记录；既有每个 owning 矩阵的 PARTIAL/NOT RUN 及已接受延后保留。真实 Grant PolicySnapshot lifecycle 无 owning writer 的边界、HTTP/UI/CLI/Provider/Feishu、生产/性能和独立人工业务验收仍分别 NOT RUN。

本设计不增加公开 API、Schema、Purpose、Policy/Evaluator/Controls profile、表/migration、Module 所有权或生产恢复机制；239/63/200 当前注册/兼容基线保留。未来实现以现有测试/helper 和必要测试 composition 接线为主。若完整链发现必须改变业务契约、持久化或批准支持集，应先形成相应 owning Delta 和必要批准，不能在 Fixture 中绕过。

## 4. 执行与批准条件

本轮仅交付决定、Spec/Test 和 roadmap 的具体规划；文档验证目标 `vibe verify docs --json`，不运行业务 Fixture。未来一个实现工作项交付 `EXIT-D-001–006` 的同一工程结果，required target 为 `vibe verify full --json`；新/变化容器环境先按项目要求执行 `environment`，可信 exact-revision CI 可按政策复用。

本确切 Delta 的人类设计批准已于 2026-10-07 取得，见 §5；独立设计审查仍 NOT RUN。用户在批准设计与要求撰写实施 Issue 后，进一步明确要求“立即发布”；已据此发布 [实施 Issue #250](https://github.com/qzhike/zhiju-business-core/issues/250)。该最新指令授权本次发布，不将独立设计审查或权威增量远端可访问性追认为已完成；二者当前状态已写入 Issue Scope。发布当时未授权业务实现或 commit/push/merge；用户后续明确要求“实施Issue#250并提交PR”，本次实现与 Git 交付据此执行，merge 不在授权内。实现证据放实际 Issue/PR，逐链记录 revision、命令、身份/Hash/Receipt/事件关联、故障和结果层级，不新建执行报告或平行任务计划。IM-06 是否退出须在交付后另行按原 Gate 对账，不能由文档通过或 PR 合并自动推出。

## 5. 人类设计批准绑定（2026-10-07）

用户在本任务会话明确回复“批准设计，撰写实施issue”。批准对象是基于 `main@b243ce850d9927af3fa1ca8e93158fddc59d89d0` 呈现的本决定 X-01–X-05、Spec 003 §14.1–14.4、Module-Test 003 `EXIT-D-001–006` 及对应 roadmap 推进意图。批准前本决定文件 UTF-8 bytes 的 SHA-256 为 `0becf8b91018edf089102da86157a4d26c8f3b524d484279e55b6ced1e6a5539`；本轮只记录批准与任务授权，不改设计行为或验收。

该批准满足人类设计门禁，不等于独立设计审查或运行验收 PASS；批准当时独立审查仍 NOT RUN，新 EXIT 场景仍 NOT RUN，IM-06 仍 Current；实施后的实际运行证据见 #250 PR，独立设计审查仍 NOT RUN。实施 Issue 正文已获本次撰写授权；原发布前置包括独立设计审查与可访问权威版本；用户随后明确要求立即发布，具体最新决定见 §6。该设计批准回复本身不授权 commit/push/PR/merge 或业务实现；后续用户实施与 PR 授权见 §4，实质设计变更须核对本批准适用性。

## 6. 明确立即发布决定（2026-10-07）

用户在已获知独立设计审查仍 NOT RUN、权威增量尚未进入远端可访问版本后，明确回复“立即发布”。该最新指令覆盖本任务的发布时序限制，已发布 [实施 Issue #250](https://github.com/qzhike/zhiju-business-core/issues/250)；它不改变 X-01–X-05 或 EXIT-D 验收，不把未执行审查/验证记为 PASS，不授权业务实现或 Git commit/push/PR/merge。Issue Scope 如实注明这两项当前状态，后续执行引用当前已批准增量并保留审查与证据要求。

## 7. 实施组成与证据边界（#250）

统一入口为 `tests/persistence/controlled-exit.test.ts`，分别为 normal、recovered、cancel 启动独立迁移数据库，复用 owning 场景和真实 synthetic Driver。`controlled-exit-queries.ts` 只负责独立授权 Query、同来源读回、业务全行/版本不变与技术记录分层；Board 的独立预期与原 owning 矩阵共用 `controlled-exit-board-expectation.ts`。原 owning 场景仅增加可选观察/提交后响应丢失接线，未增加生产总 Process、公开契约、Policy/profile 或 migration。

正常链提交 Result 的既有重建入口也经过故障接线。Result/Acceptance/finalize/Resolution 在真实 COMMITTED 后读 Receipt，模拟响应丢失，再由重建入口以原命令 bytes/身份/键重放；EP consume 的真实提交后丢响应沿原 dispatcher 有限重试，重建 entry 后核对原事件/binding/hash/watermark 与唯一业务事实，再独立 Evaluation/readExact。正常链合法原 Agent 声明为 AGENT_DECLARED，恢复链缺声明为 UNKNOWN，各 Run 分开查询。取消复用现有 final Progress 来源，暂停原 final 的后续消费；真实 cancel/原 lease 到期/ABANDONED/隔离后再次执行恢复 tick，原进度停止且 Driver 不重新 invoke。

运行证据、精确 revision、动态 Ref/Hash/Receipt/事件、命令和实际结果维护在 Issue/PR 与 CI；本文件不保存平行执行日志。独立设计/实现审查、适用人类技术审查和 IM-06 原退出 Gate 仍分别成立，未执行的外部/人工及已接受延后维持原边界。
