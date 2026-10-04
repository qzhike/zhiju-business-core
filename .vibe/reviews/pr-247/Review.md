# PR #247 独立实现审查

日期：2026-10-04。结果：**REQUEST_CHANGES**。

- PR：[Human Run Usage and Provenance readback](https://github.com/qzhike/zhiju-business-core/pull/247)，关联 [Issue #246](https://github.com/qzhike/zhiju-business-core/issues/246)。
- Reviewed head：`69bc9357f5eeaeb83bddc4d05069a87ab66d74a6`。
- Base：`e1b201ef85f0e75d3f816d94600f9810116b22ab`。
- 用户授权独立审查并提交 PR comments；本次没有修复业务代码，没有 commit、push 或 merge。正式记录依项目规则保存在本路径，当前未提交。

## 审查依据与成功判据

独立读取最新 Issue/PR、实际 base-to-head diff、Spec 003 §13、Spec 001 §15.18、Spec 007 IM06-USAGE、对应 Module-Test 与 PostgreSQL §43、共享 API 的本次兼容说明。设计批准已由 Issue 与决定 §5–§6 绑定；不将设计批准或实现者总结作为运行验证。

成功判据：Human 与五项 SERVICE 当前权限按独立 mapping 成立；仅从 Run 固定引用关联 owning 来源；已接纳声明必须与原 IG final 的身份、body Hash 和来源逐项一致；canonical Hash 与返回镜像必须闭合；TE Root/children 来自一个快照而 IP 当前撤权不受旧快照遮蔽；Issue 明确要求的恢复、迟到与两连接验收有实际证据。未提交 start 不读 IG，Query 不产生业务写入或 Driver 活动。

## 阻断 findings

### F1 / P1：未关联原 final 与 TE Result/Claim，即返回可信声明

位置：`modules/task-execution/src/business/usage-provenance-read.ts:484–498`、`:553–597`、`:629–637`。

`readFinal` 返回后仅以存在性设置 `finalObserved`。代码没有将 final 的 Observation、Attempt、Adapter identity、runtimeSubmissionRef、fencing、body Hash 与 TE Claim/Result 逐项比较，也未完成 Spec 003 §13.4 第 5 步的冻结 Contract、实际 Context、Capability、Task/Project/WorkOrder、adapter/harness/provider/model 与提交时间关联。`accepted` 只依赖本地 Result 和 Acceptance 存在，随后从本地 body 返回声明，并将 IG Observation Ref 拼入 resultEvidence。

独立纯反例：使用现有 IG fixture，经三个真实 owning read 方法得到完整且通过校验的 Binding/identity/final；TE 本地 body 增加 `AGENT_DECLARED / inputTokens=17` 并同步自身 Header/body Hash、Claim 和 Acceptance，Run/Scope/Attempt/实例保持一致。IG 原 final 不含该声明，其 body Hash 与 TE 明确不同。未改 Handler，使用内存查询替身提供 TE snapshot，仍返回 `PRESENT / AGENT_DECLARED / inputTokens=17`；resultEvidence 同时引用原 IG Observation 和不同 body Hash 的 TE Result。

该反例证明应用读取缺少规定的来源关联，不声称真实数据库允许制造这一组损坏事实。Issue Acceptance 6 与 Spec 003 §13.4 第 5–6 步明确要求读取时识别冲突，不能以写入时 guard 代替。

修复：在构建 evidence/声明前完成 final 与 Run/Contract/Claim/Result 的完整关联；有来源冲突时禁止 PRESENT 声明或 resultEvidence，并覆盖合法同源正例与单字段关联负例。本地损坏继续按 owning 规则无 data 拒绝。

### F2 / P2：IG canonical Hash 与返回镜像未闭合

位置：`modules/integration-gateway/src/runtime/controlled-runtime-dispatch.ts:1085–1090`、`:1160–1187`、`:1224–1238`。

final read 重算 stored canonical observation 自身 Hash，却不将 canonical 的 `observationId/attemptId/runtimeAdapterIdentityRef/runtimeSubmissionRef/resultPayloadHash/bindingHash/observedAt/source` 与用于返回的列/引用完整比较。ack read 同样只验证 observation payload 自身 Hash，未完整比较原 payload 的 Observation/RawReceipt/session/time/source 镜像。

独立单字段纯反例，均保留原 canonical payload 和 Hash：

1. 仅把 final 行 `runtime_submission_ref.externalId` 改为另一个合法值，`getUsageFinalObservation` 成功并返回新 submission，Observation Ref 的 contentHash 仍是原 canonical Hash。
2. 仅把 ack 行 `acknowledged_at` 改为 `2026-10-03T00:00:00.000Z`，`getUsageRuntimeBinding` 成功并返回新时间，原 observation payload/hash 不变。

完整 fixture 正对照也通过。以上是应用层存储读取反例，没有执行 PostgreSQL 注入或证明 SQL guard 可绕过。Spec 007 IM06-USAGE、Issue Acceptance 6 要求 owning read 验证 canonical 与 mirrors，本缺口使返回事实未受返回 Hash 绑定。

修复：按拥有的 canonical 形状逐字段关联 ack/final 所有返回镜像和原 Receipt/调用源；损坏返回 owning integrity error、无 data，不转为 not-found。增加每类镜像的单字段回归并按要求分别记录纯负例和 PostgreSQL guard/注入证据。

### F3 / P2：明确约定的恢复、当前权限与快照验收仍缺失

位置：`tests/persistence/usage-provenance.test.ts:368–613`；Module-Test-003 `USAGE-D-003/004/005/007` 当前 PARTIAL 行。

CI 实际执行本文件四个用例；正常首 Run、多阶段读取、CANCELLING late-final、入口前撤权/缺 Grant 和 allowlist 已有证据。但以下 Issue 明确要求的结果仍被正文和 owning 矩阵标为 NOT RUN：

- Acceptance 3：normal formal 与 BLOCKED_INPUT recovery 的按 Run 读取，特别是 Context-2/Run-2 独立来源和保留 Run-1 历史。
- Acceptance 4：ABANDONED/submit-only 对照，以及已接纳历史在到期/后续拒绝重交后仍保留声明。
- Acceptance 5：读取屏障后的真实当前撤权和 Decision 到期，证明返回前无 data；当前测试只证明建立 TE 读取前撤权。
- Acceptance 7：两连接确定性安排在 TE snapshot 的首次业务读取之后提交 Acceptance/late Audit；旧查询不得混读，下一查询必须看到新事实。串行重复查询不能替代这一验收。

这些是当前 Issue 的既定验收，不是扩大到 Provider、HTTP/UI、任意 Runtime 或未来 TD-05/TD-07。如无法走合法 owning producer，需由有权决策者明确修订验收并遵循设计门禁；不能仅以 PARTIAL 标签或绿色 full 视为完成。

## 字段与兼容核对

公共 Schema/metadata/fixture、registry 与 migration 在 actual diff 中均未改动，公开兼容没有新增变更。对现有字段和新安全解释的核对如下；shape 合法不替代 F1/F2 所需来源真实性。

| Contract / 字段全集 | 必需性与实际边界 |
| --- | --- |
| Query payload `runRef` | 唯一必填字段，closed；composition 校验注册 Envelope、AUTHORITATIVE 与完整 Project Scope/Decision target |
| UsageAndProvenanceView `runRef, agentDeclaredUsage, authoritativeSource, provenance, reconciliationStatus`；可选 `runtimeUsageRef` | 五项必填；Handler 最终校验公共 result data Schema，本支持集省略 runtimeUsageRef |
| Core declaration `measurementSource`；可选 `inputTokens, outputTokens, reasoningTokens, toolCalls, estimatedCost`；cost `amountDecimal,currency` | measurementSource 必填且 AGENT_DECLARED；现有正整数/cost Schema 不变，measurementSource-only 不构成 PRESENT；不计算或补零；运行组合证据仍有缺口 |
| Profile `profile, runRef, aggregateVersion, runStatus, snapshotAt, workOrderContractRef, contextSnapshotRef, capabilityGrantRef, runtimeBinding, attemptEvidence, resultEvidence` | 十一项必填且顶层闭合；aggregateVersion 超出安全整数时拒绝；snapshotAt 来自 TE 事务 |
| RuntimeBinding `adapterCode, adapterVersion, harnessId, harnessVersion, provider, modelId, modelConfigHash` | 七字段闭合；与支持 profile 比较 |
| attemptEvidence PRESENT value `attemptRef, bindingHash, ackObservationId, runtimeAdapterIdentityRef, source`；可选 `observationRef,resultPayloadHash` | 五项必填且闭合，可选两项同时存在/省略；关联真实性受 F1/F2 阻断 |
| resultEvidence PRESENT value `agentResultRef, acceptanceRecordRef,resultPayloadHash` | 三项必需；本地引用拼接存在，原 IG final 关联缺失，见 F1 |
| ValueEnvelope `presence,value,reasonCode,evidenceRefs,lastVerifiedAt` | PRESENT 有 value；本安全解释 UNKNOWN/UNAVAILABLE 无 value；顶层声明通过公共 envelope Schema；evidenceRefs 去重，保持既有集合语义 |

Human/source/Contract/Binding/identity/final 六项 operation/version/Purpose/action/config key/target/principal 映射与 Spec 001 表一致。TE snapshot helper 仅新增查询专用 REPEATABLE READ，不改变 command helper，没有 SQL READ ONLY 阻止 platform Context 建立。API composition 在对应读取前与返回前重验，现有批准/已通过证据不消除 F3 的运行验收要求。

## 验证与限制

- [CI run 37177557996](https://github.com/qzhike/zhiju-business-core/actions/runs/37177557996) 的 `headSha` 精确等于 reviewed head；select/checks/persistence/verify 均 SUCCESS。核对 workflow：clean/code、独立 clean build/PostgreSQL persistence、最终汇总覆盖 required full；没有重复运行本地 full。
- 持久化日志：46 files / 577 tests PASS；Usage 文件四个用例 PASS；second migrate no-op。Module-Test 保留的 PARTIAL/NOT RUN 与这些日志相符，不能提升未运行的场景。
- 独立 focused diagnostic：临时 `pr247-independent-probe.test.ts` 复用现有 IG fixture 与真实 owning read/TE Handler，6 tests PASS，包含原两个安全正例、完整 final 正对照和上述三个缺陷复现断言。断言 PASS 表示缺陷被复现，不表示实现满足 acceptance。通过本地 Vitest binary 运行；最初 pnpm exec 未输出，已取消，未作为证据。临时仓库文件已移除；诊断副本保留 `/private/tmp/pr247-independent-probe.test.ts`，其相对 imports 以原位置 `modules/integration-gateway/src/runtime/` 为准。
- PostgreSQL 损坏注入、F3 中缺失的新验收本轮没有执行；不把内存查询替身提升为 persistence 或 SQL guard PASS。
- Provider/CLI/飞书、public HTTP/UI、transport QueryResult wrapper、生产/负载与独立人工验收仍 NOT RUN；不关闭 IM-06。已批准设计不等于实际授权/RLS/persistence 的人类技术审查。已知缺陷应先由 Implementer 修复，再复审新 head 并处理适用人类门禁。

## 发布状态

[审查 comment 已发布](https://github.com/qzhike/zhiju-business-core/pull/247#issuecomment-5977513921)，读回正文与发布稿一致；发布后 head 仍为 `69bc9357f5eeaeb83bddc4d05069a87ab66d74a6`，PR OPEN。上述结论是 Reviewer outcome；普通 comment 不等于 GitHub 正式 REQUEST_CHANGES Review。正式记录仍为本地未提交交付物。
