# PR #236 独立实施审查

- Issue：[#235](https://github.com/qzhike/zhiju-business-core/issues/235)；PR：[#236](https://github.com/qzhike/zhiju-business-core/pull/236)。
- 审查日期：2026-09-30。
- 初轮 Reviewed SHA：`3b88120cf6ca505c33e3bfb40089fc3ae566b203`。
- 初次交付最终 Reviewed SHA：`cf2c5da2f72148becb75057d6e24b95b4679536c`。
- R1–R3 修订 Reviewed SHA：`e5443de8442110f5d0c64ce40d892107b4edb88b`；最新结论见末节。
- Base SHA：`04d0d7e84bb1327730553dfb4b575d178ac1fa14`。
- 角色：独立 Reviewer `/root/formal_completion_review`。Reviewer 只读检查，未修改产品代码、提交、推送或发布 GitHub 评论；本文件由交付方依据其实际返回落地。
- 初轮独立角色结论：`REQUEST_CHANGES`。初轮没有新的、有代码证据的安全或正确性阻塞；当时尚缺修正后最终 revision 的配置 `full` 通过证据。后续实际失败与限定修正复核见下文。
- 最终独立角色结论：`HUMAN_REVIEW_REQUIRED`。完整配置验证的阻塞已解除，无未解决代码、契约或安全 finding；适用人类实施技术批准仍为 PENDING。
- 适用人类技术批准：`PENDING`。会话中的设计限定修正及提交 PR 批准不替代人类实施技术审查。

## 范围与独立预期

按最新 Issue 正文与 owning 契约检查 Artifact 执行 Revision 创建/绑定/Receipt、原 invocation 的正式 final、独立 Result 验证和 Acceptance、两个单 Root Completion、历史及 current 读取、Quality 精确选择和 Readiness 消费。实现需保留 237 / 62 / 200 注册及兼容边界、冻结 Hash、完整 source 集合、真实 owning 授权与 Task → WorkOrder → Run → Request 锁协议。仅到达 COMPLETION_PENDING 或定义 fixture 不构成正常与恢复链验收。

审查覆盖 production composition、owning business/persistence、forward migrations、生成契约、standalone fixtures 及对应 Module Spec/Test；独立上下文先前提出的实现修正已由 Implementer 处理并逐轮读回。本轮重点复核最终 Request producer 边界、Hash 域批准范围、当前授权/读取语义和分层证据，不把 Implementer 的诊断当作 Reviewer 自行运行。

## 当前技术判断

1. **Request 负边界没有冒充正向 phantom race。** 新测试先由 owning reconcile 将真实 BLOCKED_INPUT 来源的 Task 置为 WAITING_INPUT，再以两种顺序执行独立授权的 Completion 与真实 Request Open。Completion 拒绝 `EXECUTION_COMPLETION_STATE_CONFLICT`，Request/Origin 实际提交，Completion 无 Receipt/Evaluation，Task status/version 不变且完成事件为零。测试在此 `return`，避免错误进入 recovered 正链的后续 Process replay。
2. **不可达正向 Request 子项保持 NOT RUN。** COMPLETION_PENDING 父 Task 下新建的 DRAFT child 无法通过现有 validate/freeze producer；已处理来源再次 Open 仅返回 Origin replay。Module-Test D013 和适用边界说明准确保留这一限制，没有扩大生命周期来制造测试正例。
3. **Hash 限定修正与 owning 实现一致。** Artifact §12 沿用 CanonicalContentPayload 的 RevisionRef Hash，独立重算 CreationBinding / CreationReceipt Hash 并复验完整 Snapshot 来源镜像。应用 canonical 重算及 SQL source/commit guards 一致，没有把包含自身 Ref 的完整 Snapshot 改为 RevisionRef Hash 域，没有重写已发布历史。
4. **当前消费状态与权限边界保持。** Readiness build 对最初已观察到的不可用 Completion 可合法产生 ready=false；复验要求观察状态未变，并独立复验 own/dependency 授权。最初 USABLE 后变为 STALE/REVOKED 仍拒绝，不因支持 ready=false 绕过当前授权或 mark 屏障。
5. **未逐项执行的场景仍可定位。** Request/Run/Resolution 不可达正向竞态、中间状态 Completion 的部分独立调用、部分 Artifact archive/invalidate/置换、Quality 新消费层部分负例、首次过期 release、自动 Completion Process 及外部/人工验收均保留 NOT RUN。D018 空库、升级及第二次 no-op 依赖最终 full，没有提前升级整行 PASS。

Reviewer 同时读回工作树唯一未提交修正：`initial-context.test.ts` 将旧 `query LIKE '%work_order%'` 锁识别改为 `blocker.processID` / `pg_blocking_pids` 实际阻塞关系。新增父级锁后的 SQL 别名使文本匹配失效；该修正保留跨越判断有效期后必须拒绝 Freeze 的原断言，未改变产品语义。

## 验证证据与门禁

交付方旧快照 full：82 unit files / 1,611 tests、格式/lint/type/build/architecture/contracts PASS；持久化 540 PASS / 3 FAIL。两个 Request harness 后续已修正；实际锁诊断修正与两种 Request 顺序的 focused PostgreSQL 回归为 3 PASS / 86 SKIPPED。上述是交付方执行证据，focused diagnostics 不替代最终配置 full。

最终修正需纳入提交，取得最终代码 revision 的 full PASS，再由独立 Reviewer 读回最终 head、证据与差异。最终 CI、验收与独立复审结果保存在 PR；本正式记录保留本次实际 reviewed SHA 与当时结论，不伪造提前批准。

人类技术批准仍待取得；无合并授权。真实 Provider/CLI/Feishu、public HTTP/UI、部署、生产/负载、独立人工验收及 TE-COMP-D-020 继续 NOT RUN。本实施交付不关闭 IM-06，不升级旧 #224/#231 的有限证据，不证明 EnterpriseProject Inbox dispatch 或 DeliveryItem COMPLETED。

## 确认签发时间限定修正复核

独立 Reviewer 读回 `aa9f2cee1cd32adb6dff35a61fc4a4e28fb10318` 的实际配置 full 原始结果：代码 82 files / 1,611 tests PASS，持久化 546 PASS / 1 FAIL（547）。失败为 recovered 正链 `EXECUTION_RESOLUTION_RECEIPT_INVALID` / `INVALID_PROVENANCE`，是真实验收失败；不能继续描述为仅缺执行证据。两次该 head 的 CI persistence 因官方 30 分钟执行预算取消，也不是 full PASS。

Reviewer 随后独立复核基于该 head 的限定代码 diff：仅 customerMaterialConfirmV1 新 canonical Decision 记录 owning 受信 requestedAt，并与 expiry 同次采样；历史 reader 比较、旧 created_at 回退、来源身份/Hash/Scope/Purpose/权限和已发布 Registry 不变。未发现新增语义或安全问题。真实 owning 确认与恢复回归为 2 PASS / 87 SKIPPED，新增插件只模拟技术 created_at 领先，保留真实 canonical/Actor/Receipt/Hash，并保留签发前和过期后拒绝。

该反例证明双时间域结构缺口，但未从已清理的旧失败容器取得具体失败 predicate 或时间值；不能声称原 full 已证实因某个毫秒偏差失败。此轮角色结论为 `REQUEST_CHANGES`，当时修复后完整代码 revision 的配置 full 尚待通过及独立最终复审。

## 最终完整验证与独立复审

独立 Reviewer 核对本地 HEAD、PR 远端 head 和 `vibe repo --json` 保存证据，均为 `cf2c5da2f72148becb75057d6e24b95b4679536c`，工作树干净。直接读取交付方保留的 CLI 原生完整输出，末尾结果为 `status=PASS,target=full,exit_code=0`。Reviewer 未代称自己执行了该验证。

完整验证为 82 files / 1,611 普通测试以及 43 files / 547 PostgreSQL 测试全部通过。547 个持久化结束标记均为 passed，零 failed、零 skipped，无名称过滤或 focused 标记；此前失败的 recovered 正链实际通过（22,115ms）。V7008/V7009/V7010 均迁移成功；第二次 migrate 无需迁移，未发生 checksum drift；Persistence gate 通过，容器清理完成。限定确认时间修正没有放宽身份、来源、Hash、Scope、Purpose、当前权限或历史时间比较。

最终产品 revision 配置 full 要求已满足，无未解决语义 finding，独立角色结论为 `HUMAN_REVIEW_REQUIRED`。人类实施技术批准仍 PENDING；会话中的限定设计修正和发布 PR 批准不替代该批准，无合并授权。复审当时 [CI run 36733859219](https://github.com/qzhike/zhiju-business-core/actions/runs/36733859219) 的 select/checks 为 success，persistence 为 in_progress；本地 full PASS 不把远端 required checks 改写为通过，最新状态继续在 PR 记录。

此后若严格只提交本 Review.md 的实际复审记录，Reviewer 允许复用上述产品 revision 的完整配置验证，并独立核对单文件差异及相应文档检查；不为审查 metadata 重复 PostgreSQL。整个 PR 仍保持原完整风险路由，未降为 docs。所有前述 NOT RUN 边界继续保留，本交付不关闭 IM-06。

## 2026-10-01 最新 head 独立审查

- Reviewer：本次用户请求的独立 Reviewer `/root`；未沿用前轮审查结论作为批准依据。
- Reviewed SHA：`0e2c35356cf52999017ca7720188238e83a1461b`，本地 `vibe repo --json` 与 GitHub PR head 一致。
- 本轮结论：`REQUEST_CHANGES`。下列契约反例推翻前轮“无未解决契约 finding”的当前结论；前文保留为历史审查事实。
- 审查依据：最新 Issue #235 正文/评论、Spec 003 §§11.3、25、Spec 004 §12、Spec 001 §15.15、Spec 005 #233、实际 PR diff、Completion owning 实现/SQL guards、Schema/Registry/fixtures 与直接 CI 读回。
- 独立预期：新 Completion 只能消费真实精确输出及完整 owning 来源；历史与 current 资格分离；公开字段校验保持批准的 required/optional、类型、集合基数与数组语义。既有 SQL guard 不替代公开 ContractRegistry 边界的正确性。

### 阻塞 findings

1. **R1 / P2：CompletionEvaluation 接受空 subjectRefs，违反 NonEmptySet 与本 profile 的 subject 锚定契约。** `contracts/src/operations/task-execution.schema.ts:480–486` 只有 `uniqueItems: true`，缺少非空/本 profile 基数约束。Spec 003 §11.3 定义 `NonEmptySet<TypedReference>`，§25.3 进一步规定恰 target + definition。直接将既有合法 judgment result fixture 的 `evaluation.subjectRefs` 改为 `[]`，`ContractRegistry.validateOperationResult('execution.get_execution_judgment', '1.0', value)` 仍返回 `valid=true`。因此公开 validator 能把没有 subject 锚点的 Evaluation 认作合法完整结果。owning SQL 的精确 subject 检查不能补齐这一独立验收边界。修复 schema 的非空及有限 profile 基数校验，增加干净的空/错误基数反例，并同步生成产物。
2. **R2 / P2：sourceWatermarks 普通数组被静默收窄为 Set。** 同文件 `:547–552` 与 `:2680–2685` 给 Evaluation 和 Judgment readback 的 `SourceWatermark[]` 增加 `uniqueItems: true`。Spec 003 §§11.3、25.6 没有把这两个字段改为 Set；§25.3 的 Ref 集合去重规则不适用于 SourceWatermark。对合法基线仅添加两份相同合法 watermark，两个位置分别因 `uniqueItems` 被拒绝，错误路径明确为 `/evaluation/sourceWatermarks` 与 `/sourceWatermarks`。去掉未经批准的唯一性限制，保留逐元素 SourceWatermark 校验，并增加重复合法元素的正例。producer 自行输出去重数据不构成收窄公开接受集合的依据。
3. **R3 / P2：Artifact 当前实现状态仍错误标为 NOT IMPLEMENTED。** `Module-Spec-004-Artifact.md:429` 仍宣称 §12 未实现，但本 PR 已交付 create_execution_revision、output-fact、来源事实持久化及 production composition；同节末尾也已更新为 #235 实际 owning/受控 PostgreSQL 证据。该 owning 权威的当前状态与实现及 Module-Test 相互矛盾，违反 Issue Handoff 与项目 durable-current-state 要求。更新为准确的 implementation-present 状态，保留尚待修正/复审/人类批准的门禁，不提前宣称整体验收通过。

### 字段矩阵

逐项对照 Spec 003 §25 / Spec 004 §12 的公开字段与实际 properties/required；下表中的字段均为必填，括号中明确列出的 optional 除外。所有新对象均检查 closed shape；TypedRef kind/type、Hash、时间、枚举和嵌套契约另外核对，矩阵不代表 PostgreSQL 或人工验收。

| Named contract / boundary | 字段逐项对应 | 基数/嵌套核对与 finding |
|---|---|---|
| Completion @2.0 input（WO/Task 共用） | policyRef、evaluatorRef | VERSIONED Policy/Evaluator；不接受 caller facts/time |
| Completion @2.0 result（WO/Task 共用） | evaluationRef、outcome、transitioned、completionUseStatus | CONTENT_ADDRESSED Evaluation；SATISFIED/UNSATISFIED；boolean；USABLE/STALE/REVOKED |
| OutputCreationBinding | runRef、runAggregateVersion、taskRef、workOrderRef、workOrderContractRef、contextSnapshotRef、outputSpec、controlsPolicyRef、capabilityGrantRef、startedAt、validUntil | OBJECT Run/Task/WO；exact Contract/Context/Bundle；ExpectedOutput 复用；版本与时限 |
| WorkOrderState | workOrderRef、aggregateVersion、contractRef、status、runRefs、blockerRefs、completionUseStatus；optional completionEvaluationRef | Run/Ref 集合与状态枚举；historical/current 分离 |
| Judgment result | judgmentRef、evaluation、useStatus、reasonCodes、checkedAt、sourceWatermarks | 完整 Evaluation 顶层嵌套；SourceWatermark 元素正确，但数组唯一性错误（R2） |
| ExecutionRevisionContent | artifactRef、branchId、parentRevisionRefs、contentType、contentRef、contentHash、structureSchemaRef、semanticMetadata、changedUnits、changeSummary | STRUCTURED_DOCUMENT；parents 恰空；metadata 恰空；changedUnits 非空；无 caller provenance |
| ExecutionRevisionCreationReceipt | commandId、commandType、commandVersion、targetRef、scopeRef、requestPayloadHash、outcome、revisionRef、actorRef、actorSnapshotRef、authorizationDecisionRef、committedAt | 既定 creation command/version、COMMITTED、exact Revision/Actor/Decision |
| ExecutionRevisionCreationBinding | revisionRef、creationCommandRef、taskRef、workOrderRef、runRef、workOrderContractRef、contextSnapshotRef、controlsPolicyRef、observedRunVersion、startedAt、bindingObservedAt、bindingValidUntil、bindingObservationHash、createdAt | TypedRef 类型、来源窗口、观察/Receipt 独立 Hash 域 |
| ExecutionOutputFact | revision、artifactRef、artifactAggregateVersion、artifactLifecycle、businessScope、originProjectRef、contentState、canonicalContent、creationBinding、creationBindingHash、creationReceipt、observedAt、useStatus、reasonCodes | 完整 RevisionSnapshot/CanonicalContentPayload；FROZEN；USABLE/STALE/REVOKED |
| CompletionEvaluation header | judgmentId、judgmentKind、scopeRef、subjectRefs、inputHash、policyRef、evaluatorRef、producedBy、actorSnapshotRef、authorizationDecisionRef、evaluatedAt、validUntil、sourceWatermarks、checks | COMPLETION_EVALUATION；subject 非空约束遗漏（R1）；watermark 数组收窄（R2） |
| CompletionEvaluation body | targetRef、targetKind、definitionRef、criteriaHash、observedTargetVersion、committedTargetVersion、collectionHash、observedLocalSources、policyObservation、sourceFacts、factRefs、blockerRefs、criterionResults、outcome、completionTransition；optional qualitySelection | Target union、版本/Hash、结果枚举；nested fields 见下两行 |
| Evaluation nested source/criterion/check | local source：ref，optional aggregateVersion/payloadHash；Policy：policyRef/contentHash/effectiveFrom，optional supersededAt；source fact：ref/owner/observationHash/observedAt；criterion：criterionId/criterionType/required/outcome/factRefs/reasonCodes；check：checkCode/outcome/factRefs/reasonCodes | 对应必填/optional 均存在；required=true；闭集条件与解释码；Ref 集合遵守本 profile 去重规则 |
| Evaluation optional qualitySelection | qualityProfileRef、selectionHash、outputSnapshots；每个 output snapshot：revisionRef，optional revisionAcceptanceRef/approvalBundleRef | 固定 Profile、exact Revision/RAS/ABS；不把 SourceWatermark 当 Ref 集合 |
| 七项 operation payload | 两 Completion：policyRef/evaluatorRef；binding：runRef；WO state：workOrderRef；judgment：judgmentRef；creation：runRef/revision；output fact：revisionRef | closed request、相应 kind/type/Project scope；Completion 的 CAS 在 Envelope 必填，creation 不要求 CAS |
| Creation command result | revisionRef、creationCommandRef | 两个 Project-scope CONTENT_ADDRESSED Ref；Receipt Hash 域独立 |

### 本轮直接证据与边界

公开 validator 定向探针使用仓库当前构建的 ContractRegistry 与 `judgment-result-valid.json`。合法原 fixture 为 `valid=true`；仅空 subject 仍 `true`；仅在 Evaluation 或结果顶层加入重复合法 watermark 均 `false`，只报相应 `uniqueItems` 错误。该探针没有写产品代码或测试文件；它证明 schema 反例，不声称重跑完整配置验证。

直接从 GitHub 读回产品 revision `cf2c5da2f72148becb75057d6e24b95b4679536c` 的 [CI run 36733859219](https://github.com/qzhike/zhiju-business-core/actions/runs/36733859219)：select/checks/persistence/verify 全部 SUCCESS。本次独立检查该 revision 到 Reviewed SHA 的完整路径差异，只含本 Review.md，因此可复用其产品验证证据；无需为文档 metadata 重跑 PostgreSQL。

最新 head 的 [CI run 36737725574](https://github.com/qzhike/zhiju-business-core/actions/runs/36737725574) 已结束：select/checks SUCCESS，persistence CANCELLED，verify FAILURE。persistence job 在 Verify persistence 步骤约 30 分钟后取消；不是持久化测试 assertion failure 或 full PASS 的证据。PR body 中“最新 CI IN PROGRESS”已过时，应在后续交付更新。绿色产品 CI 不能消除本轮独立成立的契约 findings；最新 required checks 也未全部通过。

本轮未重跑 environment/full，未执行新的 owning/PG/controlled-runtime 验收；沿用既有已执行证据的分层与全部 NOT RUN 子项。真实 Provider/CLI/Feishu、public HTTP/UI、生产/部署/负载、独立人工业务验收仍 NOT RUN。人类实施技术批准继续 PENDING；用户本次审查/发布 comments 请求不构成该批准或合并授权。修正后必须审查新 head，并取得适用的最终验证和人类门禁证据。

## 2026-10-01 R1–R3 修订最终独立复审

- Reviewer：独立 Reviewer `/root/formal_completion_review`。本轮只读核对，不修改产品代码或测试，不代交付方运行完整 verifier，不发布 GitHub 评论。本节由 Implementer 按其实际返回落地。
- Reviewed SHA：`e5443de8442110f5d0c64ce40d892107b4edb88b`。Reviewer 独立核对本地 HEAD、PR 远端 head 和保存的 `vibe repo --json` 证据一致，工作树干净。
- 角色结论：`HUMAN_REVIEW_REQUIRED`。R1–R3 均已解决，本轮没有新的未解决 finding；修订后产品 revision 的完整配置 `full` 已通过。适用人类实施技术批准仍为 `PENDING`。
- 前节 `0e2c353…` 的 `REQUEST_CHANGES` 与反例保留为历史事实，不因旧绿色验证而撤销；本节结论仅适用于实际读回的修订 revision。

### 修订与独立正负控制

**R1 已解决。** 公开 CompletionEvaluation Schema 的 `subjectRefs` 增加 `minItems: 2`、`maxItems: 2`，保留 `uniqueItems: true`。独立公开 ContractRegistry 探针确认合法基线接受，空/单项只报 `minItems`，三个不同合法 Ref 只报 `maxItems`，重复双项只报 `uniqueItems`，路径均为 `/evaluation/subjectRefs`。精确 target/definition 成员关系仍由 owning producer 与 SQL guard 绑定，不把静态基数校验写成动态成员关系的全部证明。

**R2 已解决。** 仅移除 Evaluation 和 Judgment readback 两处 `sourceWatermarks` 的未经批准唯一性限制。两处空数组及三份重复合法元素均接受；两处畸形 `observedAt` 与未知元素字段分别在正确元素路径被 `type`、`additionalProperties` 拒绝，逐元素契约保持。owning producer 和持久化完整性守卫未改动。

**R3 已解决。** Artifact Spec §12 准确记录 `IMPLEMENTATION PRESENT (#235 / PR #236)`，验证和审查证据指向 PR，保留人类技术批准 `PENDING`；没有提前宣称外部/人工或全部未执行子项完成。

Reviewer 共执行 **13 个独立公开 validator 正负控制**。七个新增 standalone fixture 的差异仅落在预期 collection 路径；负例断言精确错误路径和 keyword，没有夹带其他缺陷。交付方 focused contract 回归修订前 5 FAIL / 37 PASS，修订后 **42 PASS**；这些是公开契约/单元证据，不冒充 owning 或 PostgreSQL 验收。两项 contract generator 已执行，生成产物无字节差异，237 / 62 / 200 注册及兼容边界不变。

### 精确 revision 完整验证与后续记录边界

交付方在上述干净 revision 通过原生 `vibe verify full --json` 执行完整配置链，保留完整原始输出。Reviewer 直接读取并核对末尾原生结果 `status=PASS,target=full,command=pnpm clean && pnpm verify,exit_code=0`；不声称该执行来自 Reviewer。

- 普通测试 **82 files / 1,618 tests** 全部通过。
- PostgreSQL **43 files / 547 tests** 全部通过；547 个结束标记均为 passed，0 failed / 0 skipped，无名称过滤或 focused 运行标记。
- V7008/V7009/V7010 均迁移成功；第二次 migrate 明确 `No migration necessary`，没有 checksum drift；Persistence gate 通过，容器清理完成。
- 格式、lint、TypeScript、architecture、生成契约与 compatibility 检查均包含在正常完成的配置链。成功的 PostgreSQL 18.6 / Flyway 11.20.3 环境基线在未变更 runtime 下复用。

复审读回时，同一产品 SHA 的 [CI run 36779594467](https://github.com/qzhike/zhiju-business-core/actions/runs/36779594467) 为 select/checks SUCCESS、persistence IN PROGRESS。本地 full PASS 不将远端 required checks 改写为全绿；最新终态与执行证据继续在 PR 记录。

Reviewer 明确允许后续严格只提交本 Review.md 的实际复审记录，复用 `e5443de…` 产品 revision 的完整配置验证；须独立读回最终单文件 delta，并完成相应文档检查，不为审查 metadata 重复 PostgreSQL。整个 PR 的完整风险路由保持，不能按 docs-only 降级。设计及发布批准不替代人类实施技术批准，本轮不授权合并。前述所有外部、人工和明确未执行子项继续 `NOT RUN`，不关闭 IM-06。

## 2026-10-01 最新发布 head 复审（87e2e76）

- Reviewer：本次用户复审请求的 `/root`。Reviewed SHA：`87e2e767d573f64cc749c987e86b9776c85c283d`，通过本轮 `vibe repo --json` 与 GitHub 最新 head 独立核对，进入复审时工作树干净。
- 角色结论：`HUMAN_REVIEW_REQUIRED`。上轮 R1–R3 均已解决；本轮限定修订复审未发现新的阻塞 finding。适用人类实施技术批准仍 PENDING，最新远端 required checks 也未全部通过。
- 范围：完整读取 `0e2c353…` 到最新 head 的 12 个变更路径，核对实际 schema/test/fixture/authority 修订；另读回 `e5443de…` 到最新 head 的完整差异，仅为本 Review.md。业务 handler、SQL、注册版本与其他公开字段未在该修订中改变。

本轮先按 Spec 003 §§11.3、25.3、25.6 重建预期：subject 恰两个唯一 Ref；watermarks 为允许重复的普通数组，逐元素闭合校验保持；再对照实际四行 schema delta、测试错误断言和七份新增 fixture。前轮完整字段矩阵仍适用，以下矩阵更新本轮受影响边界：

| Named boundary | 本轮逐字段/约束核对 | 结果 |
|---|---|---|
| CompletionEvaluation | 原 header/body 的 properties、required/optional、Ref/Hash/时间/枚举及嵌套结构保持；subjectRefs 增加 minItems=2/maxItems=2，保留 uniqueItems；sourceWatermarks 保留 SourceWatermark 元素 $ref，只移除 uniqueItems | R1/R2 resolved；owning target+definition 精确成员校验仍独立存在 |
| Judgment result | judgmentRef、evaluation、useStatus、reasonCodes、checkedAt、sourceWatermarks 全部必填、closed shape 保持；顶层 watermarks 仅移除 uniqueItems，完整 Evaluation 仍直接嵌套 | R2 resolved，无 wrapper/元素契约回退 |
| Artifact Spec §12 | IMPLEMENTATION PRESENT、证据归 PR #236、human technical approval PENDING；没有改动批准的业务字段/Hash 域 | R3 resolved，未升级外部/人工证据 |

本轮实际执行 **13 项公开 ContractRegistry 正负控制，全部符合预期**：合法基线；空/单项/三项/重复双项 subject；两处空 watermark 数组、三份重复合法元素、畸形 observedAt、未知元素字段。负例只报预期的 collection/element 路径及 minItems/maxItems/uniqueItems/type/additionalProperties。另逐份对比七份新增 fixture 与原合法基线，差异仅为预期 subject 或 watermark 字段，没有其他非法字段污染反例。该证据属于公开契约层，不宣称新增 owning/PG 执行。

独立读取保存的 `/private/tmp/pr236-r1-r3-verification-head.json`，绑定产品修订 `e5443de8442110f5d0c64ce40d892107b4edb88b`；直接读取 `/private/tmp/pr236-r1-r3-full.raw.log` 的原始完整输出，核对配置链、测试结束标记、迁移和原生结果。结果为 `status=PASS,target=full,command=pnpm clean && pnpm verify,exit_code=0`；普通测试 82 files / 1,618 tests，PostgreSQL 43 files / 547 tests 全部通过，547 个 persistence 结束标记为 passed，零 failed/skipped。normal 与 recovered formal Completion 正链均有实际 passed 标记；V7008–V7010 成功、second migrate no-op、gate passed、container cleanup 完成。上述为交付方实际执行、Reviewer 本轮直接核验的证据；没有代称本轮重新执行 full。最终 head 仅增加正式审查文档，因此复用该产品验证，不为 metadata 重跑 PostgreSQL。

本轮直接从 GitHub 读回最新 head 的 [CI run 36782941324](https://github.com/qzhike/zhiju-business-core/actions/runs/36782941324)：select/checks SUCCESS，persistence CANCELLED，verify FAILURE；persistence 从 22:00:19 至 22:30:38 UTC，工作流该 job 配置 timeout-minutes=30。取消与时间预算一致，不能据此声称产品 assertion failure，也不代表 full PASS。PR body/comment 中该 run 的 IN PROGRESS 描述已过时；本轮交接 comment 记录当前终态，不代写历史审查时刻。精确产品本地 full PASS 与远端 required-check 状态保持分开；合并前仍须满足 checks 和人类技术批准门禁。

本轮仅追加正式审查记录并按既有授权发布 PR comment；不改产品代码、不 commit/push、不合并。原有 NOT RUN 子项、外部/人工边界、IM-06 未关闭事实不变。后续若修改产品代码，需重新核对新 head 和适用验证。

## 2026-10-01 人类实施技术批准

- 批准来源：会话用户在上述最新 head 复审结论后明确回复“批准”。按该上下文记录为人类实施技术批准，不推定为 commit、push 或 merge 授权。
- 批准对象：PR #236，Reviewed SHA `87e2e767d573f64cc749c987e86b9776c85c283d`；记录前重新读取本地 `vibe repo --json` 与远端 PR head，均仍为该修订。
- 人类实施技术批准：`APPROVED`。结合上节独立复审、R1–R3 resolved 和精确产品修订的配置 full PASS，审查结论更新为 `APPROVE`；前文 PENDING/HUMAN_REVIEW_REQUIRED 保留为当时的历史事实。
- 交付门禁保持：最新 CI run 36782941324 仍为 select/checks SUCCESS、persistence CANCELLED、verify FAILURE，required checks 未全部通过；该批准不豁免 checks 或代替合并授权。PR 保持 OPEN/Draft，未合并。
- 本地正式审查/批准记录尚未 commit/push；GitHub 通过 PR comment 记录该批准事实，不声称已提交 GitHub formal approval review。既有 NOT RUN 子项与 IM-06 未关闭边界不变。

## 2026-10-01 合并前 CI 执行预算限定修正

- 用户先授权合并 PR #236、关闭 #235 并清理任务分支；在明确提出将 persistence 预算由 30 改为 60 分钟、提交推送正式记录及该修正后继续交付的方案后，用户明确回复“授权修改CI的执行预算”。该限定授权不豁免完整验证或合并门禁。
- 代码 delta 仅为 `.github/workflows/ci.yml` 的 persistence job `timeout-minutes: 30 → 60`；其命令、测试收集、固定镜像、文件串行、失败/取消处理以及汇总 gate 均未变。验证基准 §2.1.1 同步记录 checks=30 / persistence=60。已有 T2 产品范围与分类保留，未新增产品/契约/数据库语义。
- 产品独立审查与人类技术批准绑定 `87e2e76…`；本段是该精确产品修订之后的已明确授权执行预算 delta，不伪称另一个 Reviewer 已独立审查此修改。交付时须核对最终 head 与上述唯一预算修改、批准/复审记录及权威文字同步一致，并使用最终 head 的完整 CI 结果；旧 revision 的绿色证据不替代新 CI 执行预算的实际验证。
- 修正前各次 CANCELLED / verify FAILURE 保留为实际历史结果；修正后 CI 尚未运行，不能提前记 PASS。实际修订 SHA 与执行终态进入 PR。合并、Issue 关闭及分支删除只在最终 Gate 满足后执行。
