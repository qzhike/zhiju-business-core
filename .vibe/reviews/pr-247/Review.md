# PR #247 独立实现审查

## 最新复审（2026-10-04，修复 head 6f8cac5）

**REQUEST_CHANGES**。上轮 F2-R1 的 binding/RawReceipt hash 反例已修复；F3-R1/R2 已补测试与屏障握手，但当前精确提交的 persistence CI 尚未完成。本轮独立反例确认 F2 的完整 TypedRef 绑定仍有剩余阻断 F2-R2，不因等待 CI 而扩大审查或重复 full。

- Reviewed head：`6f8cac584d44a2700556c8d5df9de30d7489c85a`；base：`e1b201ef85f0e75d3f816d94600f9810116b22ab`。
- 独立核对最新 Issue/PR、`dd8fc115` 至本 head 的 9 文件 diff、owning Spec/Test、实际新测试与当前 CI。Issue 验收未变；F1 修复及公开兼容未改。
- 本次只修改本正式审查记录并发布授权内 PR comment，没有实现修复、commit、push 或 merge。

| 上轮 finding | 当前判断 | 依据 |
| --- | --- | --- |
| F2-R1：ack binding/RawReceipt hash | CLOSED | owning ack 校验接收已验证 attempt.binding_hash，比较 canonical bindingHash 和完整 RawReceipt Ref；独立复跑两个自洽错 hash 反例，Binding/final 均拒绝，intact 正对照通过。 |
| F3-R1：历史保留与 expiry 证据 | 测试已补，精确 revision persistence 结果 PENDING | 新增 terminal 后 conflicting resubmission 及 DENIED/EXECUTION_FINAL_CONFLICT audit 断言、独立当前读权越过旧 execution 期限的历史读取、首次 Run SELECT 后 Decision 到期拒绝；owning IP/TE/IG 矩阵已同步。新执行证据尚待独立核对，不能用实现者的 full PASS 摘要替代。 |
| F3-R2：确定性 snapshot handshake | 调度实现已修复，精确 revision persistence 结果 PENDING | 首次 Run SELECT 的 result hook 解析 reached；两个 writer hook 都 await reached，再允许 Acceptance/isolation 提交，然后 release/await paused Query，下一查询检查新 child。不再依赖启动异步 Query 后立即写入的时序。 |

### F2-R2 / P2：canonical Attempt/Adapter TypedRef 仍只按 id 与 Scope 关联

位置：`modules/integration-gateway/src/runtime/controlled-runtime-dispatch.ts:1088–1093`、`:1284–1286`。

ack 的 canonicalAttemptRef 校验仅比较 objectId/Scope；final 的 canonical runtimeAdapterIdentityRef 同样仅比较 objectId/Scope。两处都未关联完整 TypedRef 的 kind/objectType，而返回 DTO 用受信信息重建正确类型的引用。这会把来源 canonical 中错误类型的 Ref 隐藏为可信返回，而 final Observation contentHash 仍绑定那份错误的 canonical 来源。

两项独立单字段纯反例从 intact 当前 fixture 开始，替换一份独立 Ref 对象，避免 fixture 共享引用造成输入或 body 被连带改变：

1. 仅把 ack observation_payload.attemptRef.objectType 从 `integration.runtime_attempt` 改为 `execution.run`，id/Scope/原 bindingHash/RawReceipt/session 均不改，重算 ack observation_hash。Binding read 仍返回成功 acknowledgement，final read 也成功，返回 Attempt Ref 为原正确类型。
2. 仅把 final canonical_payload.runtimeAdapterIdentityRef.objectType 从 `zhiju.runtime.runtime` 改为 `execution.run`，id/Scope/实际 Adapter/body/各列均不改，重算 canonical Observation payload_hash。final read 成功，返回 Adapter Ref 为正确类型，Observation contentHash 却绑定错误类型的 canonical Ref。

这不是新增风格要求。Spec 003 §13.4 要求精确关联完整原引用，Spec 007 IM06-USAGE 要求 stored canonical Observation 与返回来源 mirrors 一致；Issue Acceptance 6 要求错误 Attempt/实例来源不得成为可信证据。相同 UUID/Scope 不使不同 objectType 成为同一个 TypedRef。

修复：ack 将完整 canonicalAttemptRef 与本次已授权 exact Attempt Ref 比较；final 将完整 canonical runtimeAdapterIdentityRef 与已验证 identity.instance_id/Scope 构成的实际 Adapter Ref 比较（含 kind/objectType），并补单字段 kind/objectType 的正负对照。保留 owning integrity error/no data，与 not-found 分开。以上反例只证明应用读取边界，不声称 PostgreSQL guard 可绕过或正常调用者可改库。

### 本轮验证与交付边界

- [CI run 37205223902](https://github.com/qzhike/zhiju-business-core/actions/runs/37205223902) 的 headSha 精确等于 reviewed head；截至本轮取证 select/checks SUCCESS，persistence IN_PROGRESS，verify 尚无完成结果。因此 required full 的本轮独立 CI 证据为 PENDING，不能复用前一 head 的成功结果批准新 head。
- 修复者 comment 声明本地 full PASS（46 files / 580 tests、1699 unit/contract），但本轮未获取其原始 revision-bound 执行输出，未据该摘要认定当前 persistence PASS。已存在确定的 F2-R2 来源完整性阻断，按 Reviewer 规则停止扩大取证，没有重跑本地 full，也不把正常进行中的 CI 作为新的实现缺陷。
- 独立 focused diagnostic 6 tests PASS：两个既有安全正例、intact Binding/final 正对照、F2-R1 两个自洽错 hash 的拒绝、F2-R2 两项错 objectType 仍成功的复现断言。首版 probe 原地修改共享 Ref，连带改变输入/body，两个测试因无关错误失败；已改为独立替换 Ref 对象并确认实际输入/body不变后重跑，全 PASS。仅修正临时诊断，未改产品代码。
- 临时仓库 probe 已移除；副本 `/private/tmp/pr247-third-review-probe.test.ts`，相对 imports 基于原 `modules/integration-gateway/src/runtime/`。PostgreSQL 损坏注入/guard、外部 Provider/CLI/飞书、public HTTP/UI、transport wrapper、生产/负载与独立人工验收本轮 NOT RUN。
- 适用的人类实现技术审查与交付门禁继续独立存在，设计批准不替代实现批准。修复 F2-R2 后复审新 head，并核对其 required full 结果与尚未运行的契约验收边界。

[本轮复审 comment 已发布](https://github.com/qzhike/zhiju-business-core/pull/247#issuecomment-5980467965)，读回正文与发布稿一致；发布后 head 仍为 `6f8cac584d44a2700556c8d5df9de30d7489c85a`，PR OPEN。这是普通 comment，不是 GitHub 正式 REQUEST_CHANGES Review；正式记录本轮修改未提交。

## 上轮复审（2026-10-04，历史 head dd8fc115）

**REQUEST_CHANGES**。F1 关闭；F2 两个原始反例已修复，但 ack 的完整来源绑定仍有缺口；F3 有新增执行证据，但尚未满足全部明确验收。下方首轮记录保留为历史，不代表当前 head 的全部判断。

- Reviewed head：`dd8fc1150d3c986d4af83fac67d6ce922e4ab692`；base 仍为 `e1b201ef85f0e75d3f816d94600f9810116b22ab`。
- 独立读取最新 Issue/PR、上轮 `69bc935` 到当前 head 的 12 文件修复 diff、owning 规格、测试实现和当前提交 CI。Issue 验收没有修改；PR 原 Verification 摘要仍描述首轮范围，不能用其旧文字判断新证据。
- 用户授权本轮复审及 PR comment 发布。本轮只修改正式审查记录，没有修复实现、commit、push 或 merge。

| 首轮 finding | 当前判断 | 依据 |
| --- | --- | --- |
| F1 / P1：原 final 与 TE Result/Claim 关联 | CLOSED | `finalBindsCommittedFacts` 在 evidence 构造前关联原 final、Run/冻结 Contract、实际 Context、Capability、runtime/session/time 及 Result/Claim 的身份、body Hash、提交引用和 fencing；对应 intact 正对照与逐项负例已进入当前 CI。原不同 body Hash 的声明不再可达 PRESENT 分支。 |
| F2 / P2：canonical 与返回镜像 | PARTIALLY FIXED / BLOCKING | 新增 final/ack mirror 校验，独立复跑两个原始反例均返回 owning integrity error；完整 RawReceipt Ref/hash 与 ack bindingHash 仍未绑定，见 F2-R1。 |
| F3 / P2：明确验收缺口 | PARTIALLY FIXED / BLOCKING | 当前 CI 执行 7 个 Usage PostgreSQL 测试，新增 Run-2、ABANDONED、首次 Run SELECT 后撤 Human Grant；已接纳历史保留仍 NOT RUN，快照调度缺少到达屏障的等待，见 F3-R1/R2。 |

### F2-R1 / P2：ack 自身 Hash 正确但原调用/RawReceipt 来源错误仍通过

位置：`modules/integration-gateway/src/runtime/controlled-runtime-dispatch.ts:1254–1288`。

新增检查对 canonical ack 的 Attempt/RawReceipt 只比较 objectId 和 Scope，没有将 canonical `bindingHash` 关联到原 runtime_attempt 的 binding_hash，也没有将 canonical `rawReceiptRef` 的完整 kind/objectType/contentHash 与真实 RawReceipt 完整 Ref 比较。后续独立重算 receipt 自身 Hash 不能替代 ack→receipt 的精确来源绑定。

两项独立纯反例均以当前 intact fixture 为基线，只改 ack canonical 的一项来源引用并重算 ack 自身 observation_hash，其他行和 mirrors 保持原值：

1. 将 ack payload.bindingHash 换成另一合法 SHA-256。`getUsageRuntimeBinding` 仍返回成功 acknowledgement，返回 bindingHash 与 ack payload.bindingHash 不同；`getUsageFinalObservation` 也成功。
2. 将 ack payload.rawReceiptRef.contentHash 换成另一合法 SHA-256。Binding read 仍返回成功并重建真实 receipt hash，该值与 ack 内引用 hash 不同；final read 也成功。

这证明严格读取仍接受“自洽但来源错误”的 ack。不是要求普通调用者能改库，也没有执行 PostgreSQL guard/注入诊断；Spec 007 IM06-USAGE 与 Issue Acceptance 6 明确要求验证原 Binding/ack/Receipt 关系，不能只验证各对象自己的 Hash。

修复：把预期原 invocation bindingHash 传入 ack 校验，并比较完整 Attempt Ref、完整 RawReceipt Ref（含 kind/objectType/Scope/contentHash）与已验证 owning 事实；补上述自洽错源负例及 intact 正对照。损坏继续 no data/owning integrity error，不降级 not-found。

### F3-R1 / P2：已接纳历史到期/拒绝重交的验收仍未执行

位置：Module-Test-003 USAGE-D-004（第 637 行）与 `tests/persistence/usage-provenance.test.ts`。

新增 ABANDONED 和 submit-only 对照已有当前证据，但 owning 矩阵仍明确记录“原已接纳历史在到期/迟到重交后不被抹除仍未执行”。Issue Acceptance 4 要求保留早先 ACCEPTED Result/Acceptance 与声明；Acceptance 5 要求旧执行资格失效后以新当前读权读取合法历史。没有获授权放宽验收，故首轮 F3 的这一部分仍阻断。补合法 owning 历史、实际到期/后续拒绝重交与新 read authority 的读回，不能直接写业务表制造正例。

另须纠正当前证据表述：`expireAfterIssue` 在进入 composition 前将 fixture clock 增加一天，并断言 protectedReads=[]，证明入口前 Decision 到期拒绝，不证明“返回检查点到期”。若要声称读取中到期的 checkpoint 覆盖，应在实际 protected-read 屏障后使 Decision 到期并断言无 data。新测试实际已执行的到期/读取后 Human 撤权、Run-2 与 ABANDONED 证据，应同步 owning IP/IG 矩阵；其当前部分 NOT RUN 文字仍落后于真实执行。

### F3-R2 / P2：快照竞争没有等待旧 snapshot 到达屏障

位置：`tests/persistence/usage-provenance.test.ts:220–229`、`:448–458`、`:707–718`。

两处 hook 均 `armGate(); paused = h.runUsage(runRef); return;`，随后 scenario 开始 owning Acceptance/isolation 写入。runUsage 在业务 SELECT 前仍需异步签发 Human/source Decision 和多次当前授权检查；`armGate` 只创建 release Promise，没有“Run SELECT 已完成”的 reached Promise。写入侧没有 await reached，因此不保证 snapshot 已建立再提交 child。调度可先提交 child，再释放尚未到达的 gate；Query 随后看到新事实，预期 UNKNOWN 断言取决于运行时序。

当前 CI 确实跑过且断言通过，但这不能支持 Issue Acceptance 7 / Module-Test-003 所声称的确定性两连接安排。修复：从首次 Run SELECT 的 transformResult 发出独立 reached 信号，writer 在提交 child 前等待该信号，再 commit→release→await Query；失败路径保证 release/drain，随后新 Query 确认新 fact。不用延时或增加测试预算代替屏障。

### 本轮证据与边界

- [CI run 37197255379](https://github.com/qzhike/zhiju-business-core/actions/runs/37197255379) headSha 精确等于本轮 reviewed head；select/checks/persistence/verify 均 SUCCESS。沿用已核对的 full workflow；本轮不重复运行本地 full。
- 持久化：46 files / 580 tests PASS；Usage 文件 7 tests PASS，实际包含 normal、CANCELLING、ABANDONED、BLOCKED_INPUT recovery、late-audit snapshot、权限、allowlist；second migrate no-op。语义与调度问题不被绿色 gate 消除。
- 独立 focused diagnostic：本地 Vitest 临时 probe 7 tests PASS，包括 intact 正对照、两个原始 mirror 反例的拒绝，以及 F2-R1 两项错源仍通过的复现断言；另外两个既有安全正例保留。PASS 表示这些断言被执行，不提升为 PostgreSQL guard 证据。仓库 probe 已移除，副本保留 `/private/tmp/pr247-rereview-probe.test.ts`（相对 imports 基于原 `modules/integration-gateway/src/runtime/`）。
- 公共 Schema/metadata/fixture/registry/migration 与授权 composition 本轮修复未改，首轮兼容字段矩阵继续有效。外部 Provider/CLI/飞书、public HTTP/UI、transport wrapper、生产/负载及独立人工验收保持 NOT RUN。
- 适用的人类实现技术审查与交付门禁仍独立存在；先修复当前已知阻断，再复审新 head，不以设计批准代替实现批准。

[本轮复审 comment 已发布](https://github.com/qzhike/zhiju-business-core/pull/247#issuecomment-5979989775)，读回正文与发布稿一致；发布后 head 仍为 `dd8fc1150d3c986d4af83fac67d6ce922e4ab692`，PR OPEN。这是普通 comment，不是 GitHub 正式 REQUEST_CHANGES Review；正式记录本轮修改未提交。

## 首轮审查（历史 head 69bc935）

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
