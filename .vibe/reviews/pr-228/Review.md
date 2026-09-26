# PR #228 独立审查

## 1. 审查对象与结论

- PR：[qzhike/zhiju-business-core#228](https://github.com/qzhike/zhiju-business-core/pull/228)，Draft。
- Work Item：[Issue #224](https://github.com/qzhike/zhiju-business-core/issues/224)。
- Base：`facef11e4bc87224d52a6c5816785c65f6bd62f1`。
- Reviewed head：`3421c5c5c0fb82c972cc5835acb107f806abe5fb`。
- 仓库与修订由本地 `vibe repo --json` 和远端 PR readback 独立确认。
- Role outcome：**HUMAN_REVIEW_REQUIRED**。
- 当前代码、迁移、契约和测试的独立语义检查：**未发现阻塞 finding**。
- 剩余门禁：该精确 head 的远端 `full` CI 尚在执行；决定 §22.8 所保留的人类技术批准尚未完成。本结论不表示 GitHub APPROVE review，不授权 ready、merge、部署或关闭 #224。

本次作为独立 Reviewer，从 Issue、权威规格、实际 diff 和验证记录建立判断；未使用 Implementer 聊天、推理或失败调试过程作为审批依据。Reviewer 未修改产品代码、测试或迁移，也未重跑已有配置化验证目标。

## 2. 依据与独立预期

已读取根 AGENTS.md、`.vibe/project.yaml`、`vibe-development` Reviewer 与 contract-review 规则、HL-Spec 第 1–6 和 8–11 节，以及以下相关权威章节：

- 决定 `task-execution-human-operated.md` §22，尤其 §22.7–22.8；
- Spec 001 §15.13、Spec 003 §23、Spec 007 的受控 final 观察增量；
- Runtime Adapter Contract 的 final read-back 增量；
- PostgreSQL logical model §38；
- 三个 owning Module-Test 的 `IP-FINAL-D-*`、`IG-FINAL-D-*`、`TE-FINAL-D-*` 矩阵；
- verification baseline §1–2 与 §2.8。

在检查实现细节前，按这些约束建立以下验收预期：

1. 成功事实只能来自原 synthetic invocation 的真实 ack/final 读回；Attempt 与 Adapter 实例不同，重放或恢复不得再次 invoke 或换绑身份。
2. IG 保存唯一不可变观察；TE 必须通过独立授权的 owning Query/Port 比较完整 Scope、Ref、Hash、session、fencing 和冻结的 Contract/Context/Bundle。Caller 自报结果不能制造来源事实。
3. submit、record、五项同 Bundle validation、独立 Acceptance、finalize 保持各自 owning 事务；失败不得遗留 Receipt 或半套成功事实，冲突只能追加脱敏记录。
4. 当前授权在 protected read 之前和锁后/返回前重验。服务端期限获胜时只能形成 TIMED_OUT/EXPIRED，不能以已保存 Result 或 Acceptance 恢复成功资格。
5. 历史公开契约与应用过的迁移保持兼容；Run/Result 的事实不意味着 WorkOrder、Task 或 DeliveryItem 完成。

## 3. 适用范围

采用 Issue 最新正文与 §22.8 的明确决定，没有扩大未批准的未来能力：

- 实际 Grant 撤销、Controls Policy 后继、期限跨越、锁后重验、历史 Receipt/Query 拒绝属于本次可执行范围。
- 实际 grant PolicySnapshot supersession 缺 owning writer，仍为 **NOT RUN**；其 UNIT 反例不被当作真实生命周期验收。
- 首 Run factory 保持 lease expiry 与 execution deadline 相等；不将独立 lease 跨越虚构为合法支持状态。
- 独立 Runtime Usage、WorkOrder/Task/DeliveryItem Completion Query、Provider/CLI/Feishu、公开 HTTP、外部和人工业务验收仍为非目标与 **NOT RUN**。
- 三个矩阵保留 23 行完整预期与证据层级：20 行 PASS、3 行 PARTIAL；未将后者整体改为 PASS。

## 4. 实现与持久化检查

| 检查面 | 独立判断 |
|---|---|
| ACK 事务回滚恢复 | `CREATED` 同键重放只读原 Driver `readBack`；无 ack 不补成功。存在原 ack 时使用已封存 planned ID。Attempt 行锁内的 SUCCEEDED 路径核对原 session、ack 时间、Raw Receipt 内容、binding Hash 与身份；并发恢复不新增第二身份、ack 或成功 Event。 |
| IG final 来源 | 事务内读原 ack，比较完整 session；V7004 保留旧来源/Hash/不可变 guard 并增加原 Run、fencing、Header Scope 与 session 镜像。原实际观察只由原 invocation 读回形成；冲突追加固定摘要 DENIED Audit 后抛错，原观察不变。 |
| TE 完整镜像 | V3009 对 observation Scope、Run 的完整 Result/Acceptance Ref、Judgment 的 Evaluator/validUntil 增加本 Schema guard；没有跨模块 FK 或跨 Schema 写入。 |
| Request/CAS 来源 | V3010 从本 Schema 原事实重建公开 command payload，对在途 Receipt 的 request Hash、command version 和 Run CAS expectation 做精确比较；原 V3007 来源主体、Scope、Decision 和命令类型约束保留。 |
| 五项完整提交 | 子事实与父 Bundle 共用完整 subject/Policy/Evaluator/validUntil 与完整 Ref；deferred trigger 闭合 ExecutionJudgment、Bundle 和恰五个不同子事实。缺一项或全缺在 commit 拒绝，事务整体回滚。 |
| 拒绝审计 | `executeFinalCommand` 仅在目标业务事务回滚后，以同一当前命令授权重新建立事务，追加固定脱敏 DENIED Audit，再抛原业务错误。记录定位信息和 request Hash，不保存 Result 正文。 |
| 授权与恢复 | 检查组合层每步独立 action、依赖 mint/proof、锁后重验及原 Receipt 返回的当前授权。Process 目标提交与进度 CAS 分为两个事务，稳定 source/ref/hash/step key 允许目标先提交后的原键恢复。 |
| 升级与兼容 | 新增 V7004/V3009/V3010 为 forward-only；历史备份测试以历史列投影恢复 disposable database，逐列比较升级前后，并通过 owning Query 读回。没有把备份触发器抑制声称为历史业务授权证明。 |

未发现需要修改权威工作项语义的冲突、未声明模块扩张或不相关产品重构。

## 5. 契约字段核对

五个新增命名操作逐项对比了 owning Spec 与实际 Schema 的 properties、required、closed shape、Ref kind/objectType/Scope/Hash 和结果形状；这些 Schema 本次没有修改。

| 操作 | 必填 payload 字段 | 必填 result 字段 | 约束核对 |
|---|---|---|---|
| `record_run_result@1.0` | `agentResultRef` | `runRef,status,agentResultRef` | Result Ref 为 `CONTENT_ADDRESSED execution.agent_result`；Run 为 `OBJECT execution.run`；status 为 RESULT_RECORDED。 |
| `validate_agent_result@1.0` | `agentResultRef,runRef,runtimeAttemptRef,policyRef,evaluatorRef` | `bundleRef,schemaValidationRef,identityValidationRef,runBindingValidationRef,scopeValidationRef,businessOutputValidationRef` | Result/Bundle/Validation 的 exact content-addressed types；Run/Attempt exact object types；Policy/Evaluator exact versioned types；五项分别必填。 |
| `finalize_run_from_acceptance@1.0` | `acceptanceRecordRef` | `runRef,status,acceptanceRecordRef` | Acceptance 为 `CONTENT_ADDRESSED execution.agent_result_acceptance`；status 为 SUCCEEDED。 |
| `expire_run@1.0` | `reason` | `runRef,status,endedAt` | Schema 保留 LEASE_EXPIRED/DEADLINE_EXCEEDED；Handler 的批准支持集只接受后者；status 为 TIMED_OUT，endedAt 为 UTC instant。 |
| `get_runtime_final_observation@1.0` | `attemptRef` | `observationRef,attemptRef,runRef,runtimeSubmissionRef,resultPayloadHash,bindingHash,runFencingToken,ackObservationId,runtimeAdapterIdentityRef,agentResultContract,observedAt,source` | Attempt-only 查询；完整 Core AgentResult 顶层字段；精确 observation/Attempt/Run/Adapter types；fencing 非负，ack 为 UUIDv7，Hash 与 UTC instant 使用共享类型，source 为 SYNTHETIC_DRIVER。 |

同时核对本次 submit/accept/read/Event 的正反测试增量与既有 Schema，未增加包装层、改变集合含义、增加未经授权的唯一性约束或改写历史 schema/fixture。普通 verifier 的 226 FULL Registry 与历史 200 项 compatibility 门禁通过。

## 6. 验证证据与限制

| 层级 | 证据 | 结果与适用性 |
|---|---|---|
| Local full | `/private/tmp/issue224-full-final-536.log`，本地 `vibe verify full --json` | 日志末尾 PASS/exit 0；普通 76 files、1474 passed、521 normal skips；真实 PostgreSQL 45 files、536 passed、无 persistence skips；PostgreSQL 18.6、空库迁移、历史升级与二次 no-op通过。该运行早于 commit，不声称为远端 exact-head CI。 |
| Exact-head local code | 主代理执行并交付当前 `3421c5c5…` 的 `vibe verify code --json` PASS/exit 0；[PR 当前证据](https://github.com/qzhike/zhiju-business-core/pull/228) | 当前普通构建、格式、lint/types、1474 tests、架构和契约门禁通过。仅此结果不能替代当前 full/persistence 门禁。 |
| Exact-head remote full | [CI run 36252070486](https://github.com/qzhike/zhiju-business-core/actions/runs/36252070486) | Reviewer 远端 readback 确认 head 为 `3421c5c5…`，已选择 full；截至 2026-09-26 15:32 UTC 仍 IN_PROGRESS。**未记为 PASS**。 |
| Static review | Base-to-head actual diff、相关当前代码和测试、`git diff --check` | whitespace检查通过；语义与来源链未发现阻塞 finding。没有将静态检查记为独立运行验收。 |
| Human/external | §22.8 与三个 owning matrices | 人类技术批准待完成；外部/人工业务验收以及明确延期边界保持 NOT RUN。 |

已检查测试的合法对照与拒绝观测点：IG 原 actual ack 的 PENDING source 基线、TE 各 owning command 的完整 PENDING Receipt 基线，先证明基线可达，再逐字段篡改；Core-valid unsupported finals 先检查 Core validator；错 Header/Provenance/时间与不支持输出分别保留对应拒绝层。恢复涵盖五个目标 commit-before-progress 窗口、Receipt/Outbox 故障回滚、定时 worker 和两个实际 Process；并发涵盖两个 Acceptance target、finalize/expire 的 deadline 裁决与异 Run Acceptance 冲突。未发现使用无关错误充当目标拒绝证据的阻塞问题。

## 7. 后续门禁

当前无需 Implementer 修复代码。本轮交接给人类技术审查，并保留以下完成条件：

1. 读回最终精确 head 的配置化 `full` CI 成功；若 CI 暴露实现失败，必须返回 Implementer 并复审新 head。
2. 本正式记录纳入 PR 后，Reviewer 核对新增文档与最终 head，不能把当前 SHA 自动当作后续 SHA 的审查结果。
3. 获得 applicable 人类技术批准；ready、merge 和 #224 closure 仍依各自授权与门禁执行。

本记录和 PR 结论均只描述被审 SHA；没有执行 commit、push、merge 或 Issue closure。
