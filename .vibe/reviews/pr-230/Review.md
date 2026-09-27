# PR #230 独立设计审查

## 审查对象与结论

- 日期：2026-09-27。
- PR：[PR #230](https://github.com/qzhike/zhiju-business-core/pull/230)，Draft；工作项：[Issue #229](https://github.com/qzhike/zhiju-business-core/issues/229)。
- Reviewed SHA：`fe7d8389e9ae738592d251302083fafe4d91c59d`。
- 对账基线：`9d00d01db5abe024e333cbc72f435ef284665e5c`。
- Role outcome：**HUMAN_REVIEW_REQUIRED**。独立设计检查未发现阻塞性 finding；新增 Spec Delta 的显式人类设计批准仍 PENDING，不以本审查代替批准。依赖实现仍 NOT READY。
- 范围：18 份 `.vibe/` Markdown 的 347 行追加；没有产品代码、Registry、Schema、fixture、migration 或配置修改。

## 独立判据

从 Issue Acceptance、HL-Spec 的执行/不可变/模块边界、已批准 TD-01–04 与 owning Spec 建立以下判据，再对照实际 diff 和当前契约、实现：

1. 实际 Driver 产生 BLOCKED_INPUT，IG 保存原调用来源，TE 独立验证和接纳；Request 副作用等待匹配 terminal 裁决，之前保守阻塞。
2. Human 答案必须绑定精确 candidate、confirmed version、Sources、COMMITTED Receipt 和身份归因；历史确认有效性与当前恢复权限分别判断。
3. 新 Context/Run 保留原 frozen Contract、Context-1、Run-1、Result 和 Acceptance；旧单次计划不能升级，terminal Run 不恢复。
4. schedule、Bundle、Run、Task/WorkOrder reconcile 各有独立授权和事务；次数、预算、ACTIVE Claim、fencing 和恢复幂等不能被新命令键绕过。
5. 所需公开新增操作明确提案身份；设计检查、运行验收、人类批准分别记录。

## 契约与当前实现对照

| 对象 | 字段与边界核对 | 判断 |
|---|---|---|
| 当前执行限制 | `controlled-final-result.ts` 的空 COMPLETED；`work-order-validation-plan.ts` 的 maxAttempts=1/空 retryableOutcomes；`controlled-first-run.ts` 的 attempt 1/initial Context | §24.1 正确区分当前实现与未来增量。 |
| ContextBuildRequest | 必填 workOrderRef、workOrderContractRef、projectionType、purpose、audience、sourceSlices、answeredInformationRefs、builderPolicyRef；可选 expiresAt | 与既有 Schema 一致。sourceSlices 为非空集合，answeredInformationRefs 为普通数组；有限 Handler 的单 Resolution 支持集不改旧 Schema。新增 @1.1 明确 canonical CREATE target 和 Snapshot result。 |
| InputRequestProposal | proposalId、requestType、question、reason、targetRefs、expectedAnswerSpec、blocking；可选 requestedResponderRole | Core shape 不变，单 proposal/customer-material 限制明确属于受控 profile；无新 Core 字段。 |
| Request / Answer / Resolve | definition 字段；Answer 的 answerId/responder/answerContent/sourceRefs/channelSourceRef?/submittedAt/payloadHash；Resolve 的 acceptedAnswerRef/resolutionDisposition/domainCommandRefs/resolvedBy/resolvedAt/justification | 复用既有注册请求；Answer 自 hash 与完整持久事实 hash 分离。Request View 已有 answerRefs、acceptedAnswerRef?、resolutionRef?，可承载设计读回，无需假设旧 Query 返回不存在字段。 |
| Retry | previousRunRef、retryReason、nextAttemptNumber、retryPolicyRef；可选 notBefore、selectedRuntimeBinding | 设计正确识别 payload 没有 ContextRef；intent 绑定 Resolution 集合，由 create_run 校验 exact Context。 |
| EP Receipt | commandReceiptRef、commandType、commandVersion、targetRef、scopeRef、requestPayloadHash、outcome、candidateVersionRef、confirmedVersionRef、sourceMaterialRefs、decisionRef、actorRef、actorSnapshotRef、authorizationDecisionRef、committedAt | 与注册的 16 字段 attestation 对照；不从 commandId/requestHash 伪造 Receipt hash，不给 OBJECT ActorSnapshot/Decision ref 编造 contentHash。 |
| 新增 Task reconcile / state | triggerRef；taskRef/status；TaskStateView 的 definitionRef、状态、依赖/child/blocker 集合和 completionUseStatus | canonical Task 与 legacy 类型区分；Completion 不在本次支持集。 |
| 新增 WorkOrder state | workOrderRef、aggregateVersion、status、workOrderContractRef、runRefs、informationRequestRefs、blockerRefs、retryEligibility、checkedAt；可选 activeRunRef | 当前资格与历史状态分离，owning 读取不依赖 Board；不以空 blocker 数组宣称业务完成。 |
| 引用、Purpose 与兼容 | 既有注册 `task.execution.*` Purpose、EP confirmation/Receipt Purpose；新 Answer/Resolution、Controls @1.1、新四项操作 | 显式保留 legacy/canonical 拼写边界；提案不冒充已注册操作，不改历史 200 baseline。 |

上述是静态语义对照，不是执行新 Schema、Handler 或跨模块链路。

## 恢复与失败边界

- §24.3 从 final reservation 起保守阻塞，仅精确 ACCEPTED + SUCCEEDED 后形成一条 source→Request；不同 target/key 不得创建第二 Request。
- §24.4 同一 HUMAN confirmer/responder/resolver 与当前角色、动作权限分别检查。EP/IP 新内部读取被如实列为实现缺口；历史 Decision 在确认时有效不等于当前有恢复权限。
- §24.5 新 Context 使用当前 Slice、精确 Resolution/Answer/Receipt 和 reference-only MATERIAL item，不把 Slice 当作 CustomerMaterial 正文；原 Contract 两处 Context-1 pin 不变。
- retry intent 消费和新 Run/Claim/budget reservation 同事务；Task、WorkOrder 状态分别 reconcile。累计 wall-clock 余额、单次恢复、单调 fencing、未释放 Claim 与历史不可变边界明确。
- §24.6/SQL §39 保留固定源/step/命令 bytes 的重放、目标提交与进度提交分离、stale Context 新身份、长期失权 SUSPENDED；Human answer/resolve/schedule 不由 Process 代办。
- TE 11 行、IP 3 行、EP 2 行、IG 3 行设计矩阵涵盖正链、伪 Receipt、权限/期限、未解决阻塞、并发/幂等、事务故障与升级；所有新增运行场景仍 NOT RUN。

## 非阻塞澄清

1. Spec 001 §15.14 的 consumer“闭集”列表未列 `result_record`、`result_accept`、`run_finalize`，后文又明确按同一模板展开这三项。后文已表达所需独立权限，没有据此认定存在授权旁路；建议把闭集列表与后文统一，避免未来配置生成只读取列表。
2. Spec 003 §24.7 说两个 state Query 均输出 `aggregateVersion/checkedAt`，但 TaskStateView 的 closed 必填列表没有 `checkedAt`。建议明确该时间是否属于共享 Query Envelope，或同步 owning result 列表；当前没有可执行新 Schema，因此未将此文字差异视为已发生的运行缺陷。

## 验证证据与未运行边界

- [CI run 36313301793](https://github.com/qzhike/zhiju-business-core/actions/runs/36313301793) 由 Reviewer 读回：headSha 精确等于被审 SHA；select/checks/verify SUCCESS，checks 的 Verify documentation 成功，persistence 为 docs 路由预期 SKIPPED。
- 复用当前 SHA 的可信 docs CI，不重复运行同一远端 revision 的配置目标；配置目标不能证明设计语义或替代人类批准。
- 新增本审查记录后的本地 `vibe verify docs --json`：PASS、exit 0、19 个 Markdown 文件，文档与格式检查通过。首次默认 pnpm 路径执行无输出并中断（exit 130）；只读 preflight 确认已安装 pinned pnpm 11.19.0 后，以该版本 PATH 执行成功。此本地证据覆盖审查工作树，不冒充远端 SHA 的新增 CI。
- 产品/持久化/controlled recovery 新场景，以及真实 Provider、CLI、Feishu、HTTP、部署和独立人工业务验收均 NOT RUN。
- #224 的 20 tiered PASS / 3 PARTIAL 和实际 grant PolicySnapshot 生命周期延后保留，不提升为完整 PASS。

本记录仅审查上述 SHA。记录自身为审查后新增的本地文档，不在该 SHA 或其 CI 内；需要纳入后续 Git 交付并核对最终 head。Reviewer 未修改产品实现或设计规格，未执行 commit、push、merge 或 Issue closure。用户已授权将审查结论发布为 PR comment；该 comment 不等于 GitHub APPROVE review 或人类设计批准。


## 人类批准后的交付复核（2026-09-27）

用户在本审查后明确“批准，可合并PR并关闭issue及local/remote branch”，已解除原 HUMAN_REVIEW_REQUIRED 的唯一剩余门禁。设计内容仍为被审 `fe7d8389e9ae738592d251302083fafe4d91c59d`；后续交付增量仅归档本记录、同步 #229 批准状态和 roadmap 推进意图，没有修改 Contract 字段、授权或恢复算法。最终提交的 SHA、检查与合并事实由 PR comments 记录，不能从本段预先推定。两个非阻塞澄清建议保留，不在交付阶段自行选择新的字段语义。
