# Run 取消请求与迟到 final 隔离的 Spec Delta

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-03 / INDEPENDENT DESIGN REVIEW APPROVE 2026-10-03 / IMPLEMENTED IN #244 PROPOSED REVISION / RUNTIME EVIDENCE IN THE PULL REQUEST`。

本提案基于 2026-10-03 只读核对的 `main@1fb64357660f2fbceaf60344c544e6ac3558dd21`；本地工作树为 `06e87d9991c87f143120322b5d0117b4066389b0`。两者唯一差异为 PR #243 的测试分组与相应验证文档，无产品、注册或 migration 变化。用户已明确批准此 Spec Delta；本轮将同一语义同步至 owning 设计章节及失败场景，不改变当前实现事实。首轮审查与 F1/F2 修订见 §6，独立复审已通过且实现候选 NOW + READY，绑定见 §7。

## 1. 一个交付目标与现有依据

让拥有当前取消权限的 Human 对一个实际 RUNNING 的受控 Run 发起取消，读回 CANCELLING；Runtime 未确认停止时，在原有限租约到期后由独立 LeaseMonitor 终结为 ABANDONED。该 Run 的迟到 final 保留来源和隔离审计，不能获得可用 Result、Acceptance、正式输出或 Completion。受控 Driver 必须实际调用、实际延迟原 final；不是直接写状态或制造 Cancel ACK。

这是 IM-06 既有退出义务，依据 [里程碑 IM-06](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md#im-06-taskexecution-human-operated-core)、[Spec 003 §11.4](../module-specs/Module-Spec-003-TaskExecution.md#114-run-控制的精确状态和幂等)、[TD-02 的 IM-DG-006 适用性](task-execution-human-operated.md#92-控制入口与-im-dg-006-适用性)、Domain §20.7–§20.10 与 [Runtime 受控调度](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#受控-driver-输入输出与调度)。取消 Intent 不证明外部执行停止；Run ABANDONED 不等于 WorkOrder/Task 已取消或完成。

正常正式输出、一次 BLOCKED_INPUT 恢复及 TaskCompleted→EP 独立 Completion 前置已交付。本文不重开其批准，也不将 #239 的 HISTORICAL_COMPLETION 扩大为当前执行资格。

| 现有真实事实 | 必需 Delta / owning 位置 |
|---|---|
| `request_run_cancel@1.0` 已注册，payload 为 closed `{reason: Justification, requestedAt: UtcInstant, cancellationPolicyRef: VersionedRef}`，Purpose 为 `task.execution.request_run_cancel`；无正链 Handler | 实现该版本的受限 Human Intent；不改旧 Schema 或 Purpose。TE Spec/Test 与 IP 授权组成 |
| `expire_run@1.0` payload 有两种 reason，但 result.status 固定 TIMED_OUT，Handler 只支持 DEADLINE_EXCEEDED | 新增 additive `expire_run@2.0`；旧 @1.0 不变。Catalog / shared API / Registry / standalone fixtures |
| `get_run_state@1.0` 与 `RunTerminated@1.0` 已允许 CANCELLING / ABANDONED 对应状态，前者已有可选 terminationReason | 零 Schema 变化，复用权威读回与既有 terminal Event；不发布未注册的 Domain cancellation Event |
| V3007 的 Run 状态/transition 与 Claim terminal guard 不接受 CANCELLING / ABANDONED；预算终结只在成功或超时写入 | 新 forward migration 扩展合法形状、source Receipt 绑定、Claim 与预算消费原子性；不改 applied migration |
| final 入口要求 live Run/current execution Bundle；拒绝只写一般脱敏 DENIED Audit；final worker 只识别 TIMED_OUT 的停止边界 | 独立的历史来源隔离审计路径与取消后的 Process 挂起；不要求到期 Bundle 重新获得执行资格 |

分类为 T2：公开版本增量、当前授权、持久化与 Run/final 的一致性竞争。预期 Owner 为 TaskExecution、IdentityPolicy；IntegrationGateway 仅以自有已提交 Attempt/final Observation 提供真实历史来源，composition 组织顺序，不跨 Schema Repository/FK。

## 2. 已批准选择与权威路由

用户批准原提案中的以下具体选择；本次同步不扩大语义：Human-only RUNNING→CANCELLING，沿原有限 lease 等待；审查修订将新取消/expiry/隔离支持集限定为已有 reservation 的两次执行 profile；expire_run@2.0 独立 Major 承载 ABANDONED；IG 原不可变 Observation + TE LATE_RESULT Audit；cancel/record 同 Run 锁裁决；Human state read、expiry 与 late source 各自独立授权。Runtime ACK、WorkOrder/Task cancel、取消后 retry、默认 grace/续租与 TD-05–07/IM-DG-006 不扩张。

字段级唯一维护位置：

- [TE Spec §27](../module-specs/Module-Spec-003-TaskExecution.md#27-run-取消请求与迟到-final-隔离已批准设计)：请求/结果、支持集、状态/CAS/重放、隔离与 Process 停止。
- [IP Spec §15.17](../module-specs/Module-Spec-001-IdentityPolicy.md#1517-im06-cancel-独立授权组成已批准设计)：九项当前授权映射与历史完整性 cleanup。
- [IG Spec 取消增量](../module-specs/Module-Spec-007-IntegrationGateway.md#im06-cancel-原-invocation-的迟到-final-历史观察已批准设计)：原实际 invocation/final 的历史来源。
- [PostgreSQL §42](../high-level-docs/07-postgresql-logical-model-v0.1.md#42-run-取消-intentabandoned-与隔离-audit-前向设计)：同 Owner Intent、Run/Claim/预算/source guards、RLS/ACL 与审计持久化。
- Catalog / Shared API 的 IM06-CANCEL 段：新增 Major 与旧版本兼容；当前 Registry 仍 238/62/200。

## 3. 验收路由

原提案八项 CANCEL-D-001–008 及 fixture 约束已原义转入 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md#run-取消与迟到-final-隔离验收矩阵)；IP/IG 的对应 CANCEL-D 场景只拆出各 Owner 的授权/来源验收，未增加独立交付目标或改变原条件。所有新 runtime 场景 NOT RUN；首轮审查 PLANNING_REQUIRED，F1/F2 修订处置见 §6，修订后独立复审已 APPROVE，绑定见 §7。

## 4. 取舍、实现门禁与验证

选择沿原租约等待，无新增 grace/续租/默认 Policy；代价是取消显示 CANCELLING 直到原 bound。选择 @2.0 是因为原结果常量不能承载 ABANDONED；直接修改 @1.0 会违背兼容基线。选择原 IG Observation + 脱敏 Audit 的隔离方式以保留来源，避免创建可被消费的失败 Result；新 quarantine aggregate/query 和持久正文副本不是当前交付必需。Runtime cancellation acknowledgement 的替代方案留在 IM-DG-006，不以 synthetic ACK 代替人类决定。

实施应为一个完整结果，包含授权/组成入口、取消 Intent、forward guards、@2.0 契约与生成物、expiry/预算原子性、隔离审计与 worker 停止、真实 PostgreSQL fixture。migration 具体编号按届时布局规则分配；#239 的 V7011/V7012 有限例外不授权下一项沿用编号例外。人类设计批准已取得，affected authority 和 failure scenarios 已按同一语义同步；独立设计复审与 NOW + READY 已确认，见 §7；当前授权覆盖完整实现 Issue 草稿，发布仍需适用授权。设计批准不授权业务实现或 Git/外部交付。Issue 发布、commit/push/PR 与 merge 各遵循已有项目授权边界。

本轮为 Markdown 设计/路线变化，required target 为 `vibe verify docs --json`；该 PASS 只证明文档完整性与格式。实现 required target 为 `vibe verify full --json`，新/变化容器先按项目规则 `environment`，可复用 trustworthy exact-revision full CI；独立实现审查与授权/RLS/persistence 人类技术审查仍需真实 revision。外部 Provider/CLI/飞书、公开 HTTP/UI、部署/负载与独立人工业务验收保持 NOT RUN。Query/Board、Usage/Provenance、TD-05–07 和整个 IM-06 退出仍须独立对账，不因本切片完成而自动通过。

## 5. 人类设计批准与修订绑定（2026-10-03）

用户在收到本提案的具体结果、版本/授权/竞态/隔离取舍及 docs PASS 后明确回复：

> 批准设计提案

批准绑定本地未提交提案 `.vibe/decisions/task-execution-cancellation.md` 的原始完整 bytes SHA-256 `0c8942c515937dbd41867b00ce58cc92fb32a15cb346fc7e1ccf5b9fe9eaa15f`，base HEAD `06e87d9991c87f143120322b5d0117b4066389b0`，对账 main `1fb64357660f2fbceaf60344c544e6ac3558dd21`；记录前重算 Hash 与上一轮实际呈现文件一致。该原文件只有一个完整设计提案，本批准覆盖其 §1–§4 的取消切片及 eight-case acceptance。

本轮状态/批准记录与 owning 文档同步没有新语义选择；原字段定义按 owning 位置维护，不将同步后的文件新 Hash 当成原批准 revision。人类批准不等于独立设计审查，不授权 Issue 发布、业务实现、commit/push/PR 或 merge；本会话此前也没有该切片的这些授权。本次原始批准时独立设计审查为 NOT RUN，后续审查与修订见 §6；各轮需绑定 base + 完整变更文件 Hash manifest；审查若提出实质性语义变化，先说明相对本批准的 Delta。无需对同一已批准语义重复索取批准。

## 6. 审查阻断与人类批准的修订（2026-10-03）

首轮设计审查结论 PLANNING_REQUIRED，绑定 base `06e87d9991c87f143120322b5d0117b4066389b0` + 12文件完整 Hash manifest SHA-256 `6ff859be3534c4d9863c4344fe475f3675643a0fc6b8709372b76c0ff3cf05b8`。F1：旧 request_run_cancel@1.0 的实际 metadata Purpose 是 `task.execution.request_run_cancel`，原设计误写为 `execution.run.cancel.request`，与“旧 metadata 不变”冲突。F2：原设计要求唯一预算 consumption，但 maxAttempts=1 不创建 reservation，V7006 预算 guard 仅允许 maxAttempts=2，首版支持集未闭合。

用户在获知两项 finding 与先闭合支持范围再复审的建议后明确回复：

> 批准，立即修订

本轮执行该修订授权：F1 保留已发布 Purpose 并区分内部 .v1 action；F2 选择有限首版，不扩展预算模型——新 cancel Handler、expire_run@2.0 与 late-isolation 只消费 §24.2 Controls @1.1 / §25.1 Controls @2.0 recovery 分支真实创建已有 reservation 的 maxAttempts=2 Run。maxAttempts=1/无历史 reservation 不补事实，新入口安全拒绝；原 @1.0 expiry 与其他既有路径保持原支持集。该选择明确写入 Spec/Test、IP 映射与数据库约束；不是静默删掉 consumption 验收。上一轮 §5 的批准保留原修订与事实错误，不追溯改写成已批准修正版。

F1/F2 作者提出修订时独立复审仍 PENDING；后续独立复审结论与绑定见 §7，不把作者修订或 docs PASS 当 APPROVE。用户此前授权的“审查通过后撰写实现issue”继续适用，指通过后撰写完整 Issue 草稿；不由此推导 GitHub 发布、commit/push/PR/merge 或业务实现授权。实质性新的范围变化仍须明确处理。


## 7. 修订后设计复审与实现候选（2026-10-03）

独立 Reviewer 结论 **APPROVE**，F1/F2 关闭，无新增阻断项。复审从冻结 metadata/Schema、真实 create_run reservation 分支和 V7006 的预算 guard 重新建立判据，再检查 12 份设计变更、授权/时间/竞态与失败验收；上下文已包含作者修订，不声称盲审。审查绑定 base `06e87d9991c87f143120322b5d0117b4066389b0` + 完整 12 文件 Hash manifest SHA-256 `08679ceb4adc7696827e54f8ae25912b157941d8476695ad67cc54061b400614`，该快照为写入本次结论前的设计修订；后续仅记录本结论与前向状态，不改变业务语义。该修订的 `vibe verify docs --json` PASS（12 文件），并不证明新 Handler、migration 或受控 runtime 已执行。

NOW + READY：完整结果、支持集、可观察验收、Owner 与版本边界、required full 均已明确；原设计批准与本次 F1/F2 修订授权已取得。一个实现 Issue 覆盖 Human 取消→有限到期 ABANDONED→原 final 隔离审计→独立状态读回，不拆出无独立结果的层次任务。完整草稿随后经用户明确指令“将issue发布到github”授权，于 2026-10-03 发布为 [Issue #244](https://github.com/qzhike/zhiju-business-core/issues/244)；标题、OPEN 状态与完整正文已读回核对一致。Issue 保留本次审查与最终设计 manifest，并明确引用尚未 Git 交付的本地 authority。业务代码尚未实现，也不自动关闭 IM-06。独立实现审查、授权/RLS/persistence 人类技术审查仍是未来实际实现修订的门禁；新 runtime、外部与人工证据保持 NOT RUN。

## 8. 实现交付（2026-10-03，#244）

已批准语义在一个完整结果中实现：`execution.expire_run@2.0` 注册（Registry 239 / TE 63 / baseline 200，@1.0 与 `task.execution.request_run_cancel` Purpose 逐字节保留）、`execution.request_run_cancel@1.0` 与 @2.0 expiry Handler、immutable `task_execution.run_cancellation_intent`、late-final `LATE_RESULT` 隔离 Audit、final worker 的 CANCELLING/ABANDONED 挂起，以及 IP 的九项独立授权映射与 composition 入口；`V7013__run_cancellation_isolation.sql` 是该切片的 forward migration，未修改任何 applied migration。原始批准 revision 与 §5 绑定不改写；实现运行证据记录在对应 Issue/PR，不由本文替代。PR #245 的独立实现审查 finding（首轮 F1/F2/F3 与复审 F2-R1）已在同一范围内全部修复并复审关闭：隔离提交前连同依赖 Decision 复验自身权限、Intent guard 重建并绑定完整请求 Hash 且 ActorSnapshot 同时绑定真实 Receipt 与受信 Context、late isolation 校验支持 profile 与原 reservation；对应真实 PostgreSQL 负例与合法 Human 正对照通过。实现 head `f6060b1a9904258c118c69997574245aa81194f1` 的 required full CI 成功；用户于 2026-10-04 在获知复审和剩余人类门禁后明确批准实际实现，并授权合并 PR #245、关闭 Issue #244 及清理任务分支，批准绑定和历史审查见 `.vibe/reviews/pr-245/Review.md`。外部与人工业务验收边界仍保持原 NOT RUN，IM-06 不因本切片自动关闭。
