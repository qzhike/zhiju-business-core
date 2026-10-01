# PR #238 — TaskCompleted / DeliveryItem Completion 正式设计审查

当前：`INDEPENDENT SEMANTIC DESIGN REVIEW PASSED / HUMAN DESIGN APPROVED 2026-10-01 / FINAL DELIVERY-HEAD REVIEW AND CHECKS PENDING / NOT IMPLEMENTED / NEW RUNTIME CASES NOT RUN`。本文保存历史REQUEST_CHANGES与人类批准；历史PENDING是当时事实，不覆盖第8节当前批准。

REQUEST_CHANGES

# Issue #237 独立设计审查准备记录

审查日期：2026-10-01。角色：Reviewer。工作项：[Issue #237](https://github.com/qzhike/zhiju-business-core/issues/237)，OPEN，最新正文及评论通过 `gh issue view 237 --json title,body,state,comments,url` 独立读取；评论为空。本记录仅针对设计，不构成产品实现审查、人类设计批准或 GitHub publication。尚无真实 PR 编号，因此暂存于 `/tmp/issue237-independent-review.md`；未来获得真实 PR 后，必须保存于 `.vibe/reviews/pr-<number>/Review.md`，不得编造编号。

## 1. 精确审查修订与独立性

`vibe repo --json` 返回 PASS，repository=`qzhike/zhiju-business-core`，branch=`galendai/issue-237-taskcompleted-design`，HEAD/base=`cd2a249cff5e8bc0406321863b39b8cbe5141a2e`。本设计为未提交树：14 个 tracked Markdown 修改和 1 个新 decision，共 15 文件，全部在 `.vibe/`。

第一轮审查绑定 `第一轮manifest（本记录附录A）`（原 `批准manifest（本记录附录B）` 的留存副本），SHA256=`d2f049a708666650021f2c563483e3164542ac561624ad9eb5b3749632ab29d7`。Reviewer 独立重算 manifest 和全部 15 文件 SHA256，均 MATCH；独立读取 Git diff、untracked decision，审查结束时未修改任何设计或产品文件。manifest 是审查对象的一部分；base 单独不足以代表此设计树。

按顺序读取 vibe-development SKILL.md、roles/reviewer.md、contract-review.md、项目配置、最新 Issue；随后先读 base 的 HL-Spec §§1–6/8–11、TE §25、EP §21 和已批准 TE→EP 原则，建立下节期望后才阅读实际设计 diff 和代码。本审查未把作者摘要作为语义批准或运行验证依据；作者提供的实际代码定位经 Reviewer 直接复核。

## 2. 独立建立的设计期望

工作项交付设计与可执行验收合同，不交付 runtime。目标是精确 Task 所属 DeliveryItem 在只需 Task 时可 SATISFIED；另需 Release 时必须 UNSATISFIED。必须保留 TaskCompleted 四字段、TE/EP 独立事务及 EP criteria/evaluation 所有权，不通过 Project-wide eventType、另一 Task、latest Plan/Item 或直接写 COMPLETED 替代。

最关键的失败边界：真实 source Completion/Outbox 必须能生成完整合法 Event；源储存 Hash 与 public payload Hash 分域；事件、payload、sidecar 和水印首次绑定后不可变；并发 worker 以 lease/fencing 控制 TE metadata；EP 已 commit 但 TE 未确认时原字节重放得到一份事实；晚提交低键不能被扫描高水位漏掉；低/晚水位只能在同 exact 关联内解释；EP consume、evaluate 与 readback 分别持当前授权，不能借 producer/consumer 历史 Decision；historical completion 与 TE current usability 必须诚实区分；旧 profile/操作/200 compatibility 必须保留。

正常与一次真实 BLOCKED_INPUT 恢复的 positive chain 只能替换外部 Runtime 为实际调用 controlled Driver，其他 Event/Decision/Receipt/业务事实必须由 owning 入口提交。设计必须给出独立 Evaluation、authoritative readback 与持久化/故障效果；所有新 runtime 仍 NOT RUN。

## 3. Blocking findings

### F1 — TaskDefinitionSnapshot sidecar 的引用 kind 违反既有 owning identity

位置：`.vibe/module-specs/Module-Spec-003-TaskExecution.md:2263`（§26.1），将 `taskDefinitionSnapshotRef` 声明为 `exact SNAPSHOT/zhiju.execution.task_definition_snapshot`。

既有 owning 权威 §16.7、§17.2 的 identity 矩阵明确该类型为 CONTENT_ADDRESSED，按 objectId（数据库 snapshot_id）+ 完整 canonical payload Hash 解引用，既不以 SNAPSHOT kind 寻址，也没有可由 dispatcher 另造的 snapshotId。实际 `formal-completion.ts:108` 的 reference helper 对有 digest 的 Ref 返回 CONTENT_ADDRESSED；`:202`–`:208` 直接把 Task snapshot id/payload hash 写成 Evaluation.definitionRef。因此一份合法 #235 Evaluation 不能满足新 sidecar 的 SNAPSHOT 要求。转换 kind 或制造 snapshotId 会破坏来源绑定，且 Issue 没有批准该 public identity Delta。

所需修正：sidecar 原样绑定事件对应原 Evaluation.definitionRef 的 CONTENT_ADDRESSED kind/objectType/objectId/contentHash/Scope，并在 owning readClaimed 复验该不可变 snapshot 完整 canonical payload、Hash 与 Task 归属。保留该 Ref，不创造别名或更弱身份。补充正例与 wrong kind/id/Hash/Scope、另一 Evaluation definition 的拒绝验收。

分类：可在当前设计 scope 内修正的 owning contract mismatch；blocking，REQUEST_CHANGES。

### F2 — 缺少真实 Outbox nullable causation 到必填 EventEnvelope 的确定性 codec

位置：`.vibe/module-specs/Module-Spec-003-TaskExecution.md:2262`（§26.1），仅要求“使用原 … correlation/causation、sourceCommandId”，未闭合 NULL causation 的现有合法来源。

直接代码证据：`formal-completion.ts:833`–`:846` 构造并验证的瞬时 Event 将 causationId 设成 commandId，但 `:850` 的 appendOutbox 输入没有传该值。`command-runner.ts:941` 持久化为 `event.causationId ?? envelope.causationId ?? null`；V3000.outbox_event.causation_id 允许 NULL。正常 Completion Command 没有 caller causationId 时，已提交真实 Outbox 就保存 NULL。注册 EventEnvelope 的 `contracts/src/envelopes.schema.ts:178` 将 causationId 列为 required，`:196` 要求 UUIDv7；共享 Catalog §8.5 同样必填。现 EP consumer `delivery-item-completion-handlers.ts:483` 首先经真实 Registry 校验。复制 NULL 或省略该字段均不能通过真实 normal chain。

所需修正：在 TE owning codec 明确规定 sourceCommandId→Event.commandId 的 exact mirror；规定 stored causation 为 NULL 时如何从同一已提交 source command/Receipt 确定合法 causationId（采用 source_command_id fallback 是与 producer normal 现状一致的有限方案），非 NULL 时如何保留并核验其 owning mirror。不能采用 worker caller UUID、随机测试值或重试临时值。首次 allocation 封存完整 Envelope bytes/hash，之后 replay 全等。正常/恢复 fixture 明确覆盖 NULL 合法来源、非 NULL 合法来源及错误/不相关 causation 拒绝，不修改旧业务 Outbox payload 或重写已提交列。

此 finding 要求文档 codec 闭合；不要求在 #237 修 producer 代码，也不扩展为另一个产品目标。

分类：工作项 current-baseline reconciliation 与可执行 positive chain 尚有可修设计缺口；blocking，REQUEST_CHANGES。

## 4. 其余设计语义审查结果

除 F1/F2 外，本次检查未发现其他 blocking mismatch；以下结论是静态设计审查，不是 runtime PASS：

| Acceptance 边界 | 实际设计与独立核对 |
|---|---|
| current baseline | decision 区分 #235 producer 已交付、EP synthetic consumer/evaluator 已交付、IP dispatcher 仅操作 identity_policy、TE dispatcher/游标缺失。EP producer 连字符与水印下划线纠正与当前 EVENT_RULES 一致。 |
| 双 Hash/稳定来源 | TE §26.1 分开 stored scope-mirror Hash/public四字段Hash；固定 event codec、sidecar及完整Envelope Hash；EP FactRef 保留既有 public payload Hash，association另Hash，没有把 Row/sidecar Hash塞回旧Ref。F1/F2需修正以令该链完整。 |
| 精确关联 | 新 profile预分配 Task UUID并经 Human批准/激活 Plan；之后 Task definition反向绑定 exact Item/version。TE取原Evaluation所引用definition；EP依自身Item行解析Plan，不回查TE。v2严格核对Task/Item/PlanVersion/Scope，没有Project-wide替代。 |
| legacy隔离 | EP旧 criteriaFromValue 实际拒绝allOf以外key；新增profile不能经v1改新pointer；v2拒绝旧grammar，旧Plan/Facts/Evaluations不backfill。新公开Major仅一项、237→238，TE62/历史200不变；所有schema/generated/migration仍未来工作。 |
| 水印/visibility | cursor串行分配已可见committed事件的观察序；扫描不截断UUID/timestamp，晚commit低键仍发现；claim后释放锁允许发送乱序。EP低序append history，只同 exact association比较优先，不把Project最大水位当checkpoint。 |
| fencing/retry | 当前owner+token+lease+授权才confirm/failure；实际锁后clock判断；lease过期不能回写，EP已commit不可撤销。窗口5次自动尝试、UNKNOWN/backoff、DEAD、authorized manual resume审计与状态原子，token/累计attempt/原水印不重置。 |
| EP幂等/partial progress | 唯一Inbox claim串行裁决、rollback后可再claim；duplicate全Hash/Scope匹配；冲突append violation保留原PROCESSED记录。Inbox/Fact/association/Process/Audit原子；独立Evaluation失败保留已合法消费/TE事实。 |
| 评估/撤销 | v2服务端criteriaHash/evaluator/时间、水位来自ledger，精确nonempty FactRef选集；缺Release合法UNSATISFIED；revocation fingerprint包含相关已消费撤销集；ledger→Item固定锁序覆盖consumer/v2/legacy consumer，pointer CAS与Evaluation/Receipt/Impact/Event同事务。 |
| 授权 | IP §15.16逐步精确operation/version/action/purpose/target/payloadHash/Scope/principal/Actor/session绑定；claim的source read另Decision；来源使用TE owning material私有handle，不能由任意JSON/SERVICE字符串建立；protected read、锁后commit与历史success/duplicate返回前重验。 |
| readback | EP内部authoritative readExact，无公开Query扩张。重算payloadHash/association/mirror/完整EvaluationHash；安全投影不自造Hash。指定历史outcome与当前pointer-derivedStatus分开；当前source/revocation独立授权复验，不以Board freshness判定。 |
| historical边界 | 明确HISTORICAL_COMPLETION/taskCurrentUseStatus UNKNOWN；TE TTL/质量/输出变化无Task invalidation producer follow-up，不声称同步当前USABLE，也不能把EP SATISFIED用作执行/审批/发布授权。 |
| first-version可执行性 | 未来normal/recovered named fixtures从真实IP/EP/TE owning入口进入；另起合法Task+Release Item；只controlled Driver替换外部Runtime。当前 #235 fixture刻意不绑定Item，不能原样直接充当本正链，设计已明确新fixtures。所有新正反/故障/并发/ACL/RLS/upgrade矩阵标NOT RUN。 |

受影响 named contract逐字段检查：TaskCompleted public payload四项零变；sidecar八项，发现F1；新增EP@2.0三项closedpayload及五项Result（Impact optional）、精确typed refs/expectedAggregateVersion；v2Evaluation完整payload与fingerprint域；readExact四项request（Evaluation optional）与safe result/history/current字段；授权映射每项closedpayload。集合区分NonEmptySet与plain array，selected fact集合非空、返回satisfiedFactRefs允许合法UNSATISFIED为空。没有注册schema被更改，因此不存在本设计已经通过可执行validator/schema负fixture的结论。

## 5. 证据与未运行边界

- 当前 revision 身份：`vibe repo --json` PASS；Git status/diff及新decision直接检查；manifest/base/15文件SHA256独立全部MATCH。
- 配置 docs gate：复用 `第一轮原生docs证据（本记录附录C）`（第一轮留存副本）的 manifest-bound 原生完成证据：`vibe verify docs --json`，`status=PASS,target=docs,command=pnpm verify:docs,exit_code=0`，`[docs-verification] PASS files=15`、Prettier通过。父任务已保存native completion出处；Reviewer未重复运行同一充分docs证据。该证据只涵盖Markdown结构/format，不证明语义正确，F1/F2即docs PASS未捕获的反例。
- 静态源核对：TE formal-completion.ts/command-runner.ts/task-draft-creation.ts，EP completion handlers/repository、delivery-plan handlers，IP messaging/dispatcher.ts，EventEnvelope schema，V3000/V2013，#235 formal normal/recovered fixtures及initial-context persistence harness。
- NOT RUN：本设计的新schema/contractfixtures、TE dispatch、EP exact association/v2Evaluation/readback、正常/恢复真实TE→EP链、并发fencing/水位/commit faults、grant revocation、forward migration/upgrade/RLS/ACL、full/environment。没有以旧#235/EP synthetic PASS补齐本新能力。
- NOT RUN：真实Provider/CLI/Feishu/publicHTTP/UI、部署/生产/负载、独立人工业务验收；实际Grant PolicySnapshot生命周期仍原已批准延后；Cancel/late-result/IM-06退出不豁免。
- PENDING：显式绑定具体设计修订的人类T2设计批准；本记录不是该批准。Git commit/push/PR publication/merge/dependent Issue publication均未经授权、未执行。

## 6. Outcome 与下一步

REQUEST_CHANGES：先由设计作者修正 F1/F2 owning规格及必要验收，再生成新的完整manifest和当前docs PASS证据，Reviewer只针对新修订复审。已评估的其余语义可复用，变化若影响相关边界再扩展核对。

即使复审无blocking finding，Reviewer剩余outcome应按显式T2人类设计gate报告 HUMAN_REVIEW_REQUIRED，而不能因普通agent语义审查通过就声称Issue已完成或设计已获人类批准。真实PR取得后保存required formal Review记录；publication与Git交付需要适用授权。设计交付不自动使dependent implementation NOW+READY，也不关闭IM-06。


## 7. 第二轮独立复审与 finding closure（2026-10-01）

**当前最终 Reviewer outcome：HUMAN_REVIEW_REQUIRED。独立语义设计审查已通过，F1/F2 均 CLOSED，无新增 blocking finding；显式人类 T2 详细设计批准仍未取得。** 本结论取代第一轮 REQUEST_CHANGES 对当前修订的状态，不删除第一轮问题与证据。

本轮 reviewed base 仍为 `cd2a249cff5e8bc0406321863b39b8cbe5141a2e`。`vibe repo --json` 再次核对 repository/branch/head。新未提交树绑定 `批准manifest（本记录附录B）`，SHA256=`fdc8dac48d6f993599203fcdb054b388ec8e301c588d33d068c89bed741b67a7`。Reviewer 独立重算 manifest 与全部 15 文件 Hash，均 MATCH；比较第一轮完整 manifest，只有下列三文件发生变化，其余十二文件逐项 Hash 一致，因此复用第一轮其余边界审查，不重复搜索或运行充分的 gate。

| 本轮文件 | reviewed SHA256 | 变化与独立结论 |
|---|---|---|
| `.vibe/module-specs/Module-Spec-003-TaskExecution.md` | `09aacbe7113513ddeae106f76e4df4da21a5daae1ff6f4b921eb29eb1d56434d` | §26.1明确definition为CONTENT_ADDRESSED，原样保留原Evaluation.definitionRef的kind/objectId/optional immutableVersionId/Scope/contentHash，不造snapshotId、不转换kind。与现有注册identity及producer一致，F1 CLOSED。 |
| `.vibe/module-tests/Module-Test-003-TaskExecution.md` | `9665d34a99c1be79af61f24edf588f271e4b8b6619c6ef19f59bf624bc876779` | D001/D002分别覆盖正常/恢复真实NULL causation fallback与原CONTENT_ADDRESSED Ref；D002另要求合法nonNULL原Receipt causation保留；D010涵盖causation tamper、Outbox/Receipt mirror冲突及SNAPSHOT转换拒绝。全部仍NOT RUN。 |
| `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md` | `0305978cd0148f2577fa4202bacda27b877c5dbb86fe9110970215f365419ec1` | §41.1将binding持久化路由到Spec003 owning codec，并明确CONTENT_ADDRESSED保留，无平行Hash/引用规则。 |

F2 CLOSED：新codec先核对Outbox.source_command_id等于同一COMMITTED Receipt.command_id，且Outbox.causation_id与Receipt.causation_id含NULL相等；公共causationId为原nonNULL值，否则为原source_command_id。nonNULL必须是Receipt记录的UUIDv7，不由worker提供，不得换成另一Command。规则生成合法必填EventEnvelope字段，同时保留来源证明；首次封存后bytes/Hash在retry/resume/newowner均不变，不回填/改写原Outbox或Receipt。该有限重建规则不改变TaskCompleted payload、公开版本或旧不可变业务行，所需正反验收已同步。

本轮 docs evidence：复用 `第二轮原生docs证据（本记录附录C）` 的新manifest-bound native session22538 completion，`status=PASS,target=docs,command=pnpm verify:docs,exit_code=0`、`[docs-verification] PASS files=15`、Prettier通过。Reviewer没有重复docs。第一轮manifest SHA256=`d2f049a708666650021f2c563483e3164542ac561624ad9eb5b3749632ab29d7`的副本已再次核对留存在`第一轮manifest（本记录附录A）`，第一轮docs留存`第一轮原生docs证据（本记录附录C）`。

范围与证据没有升级：本轮只读检查设计树，仅更新本临时审查准备记录；没有产品代码、可执行Schema或migration变化。新runtime/normal-recovered owning chains/dispatch/persistence/concurrency/fault/授权撤销仍NOT RUN。配置docs PASS和独立语义review PASS是设计层证据，不能当作runtime/full/人工批准。

剩余显式Gate：要求人类T2详细设计批准绑定当前base+完整manifest（或未来内容相同且可核验的提交SHA），记录批准人/决定/具体revision；Review授权和Agent语义通过都不提供该批准。真实PR获得后须将完整本记录归档至`.vibe/reviews/pr-<number>/Review.md`，当前没有PR号码，不编造路径。Git commit/push/PR publication/merge及dependent Issue publication仍待适用授权；设计不会自动成为implementation NOW+READY，也不会完成Issue或关闭IM-06。


## 8. 人类详细设计批准与Git修订等价证明（2026-10-01）

批准来源：会话用户在收到本记录第二轮结果、docs PASS和具体15文件manifest后明确回复“批准设计，合并PR并更新issue”。人类详细设计批准为APPROVED；同时授权本设计的必要Git/PR交付、门禁通过后的合并以及Issue #237更新。

批准与独立review绑定base `cd2a249cff5e8bc0406321863b39b8cbe5141a2e`、manifest SHA256 `fdc8dac48d6f993599203fcdb054b388ec8e301c588d33d068c89bed741b67a7`。批准后设计提交 `a38e66f2df60d45079a093f08fed4e4f12732ef1` 的全部15文件Git blob SHA256逐项与manifest相等；它是本设计的确切reviewed/approved Git revision，没有借用旧设计或实现批准。F1/F2已CLOSED，agent技术语义审查无剩余finding；人类批准解除此前HUMAN_REVIEW_REQUIRED，但final-head metadata/正式记录及required checks仍须核对。

后续状态修订只记录批准/审查事实与已确定forward intent，不改field/Hash/lease/association/auth/criteria/readback/acceptance语义。没有runtime/schema/migration变化，所有新运行案例继续NOT RUN。普通GitHubcomment不是formalGitHubapprovalreview；本文与实际人类批准来源分别保存。

## 附录A：第一轮完整文件manifest

```json
{
  "base": "cd2a249cff5e8bc0406321863b39b8cbe5141a2e",
  "files": {
    ".vibe/api-contract-v0.1/API-Contract-v0.1.md": "014cb83cc450d753b236f2a932438f841f444d994f4717c1452d9f2b680ecb20",
    ".vibe/decisions/task-completed-delivery-completion.md": "d6ff109357f573b8a0fcaa6c674bea3f28e188bfadfd381764a1bcc835f2c39f",
    ".vibe/decisions/task-execution-human-operated.md": "66ec8b1cbcb23b7ab3e2ae62495d5d797239950145ba27b0b34c819916f6d1f4",
    ".vibe/high-level-docs/02-zhiju-core-architecture.md": "e3c6cb06243945e47309ce408960e9350127fe1dce5fdbb00421a600b9eb2579",
    ".vibe/high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md": "ad7be0fdb89716c4e0c9d031088b629d41f0e142f8a562de46b018e3b73a916a",
    ".vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md": "23c781bfca8e4e78e1934db2e029af480fcb4e6b49ebfb0f755b87369b1b3f8f",
    ".vibe/high-level-docs/07-postgresql-logical-model-v0.1.md": "23d5586f9c401db54a908d2f5b11e1cd2da92e8c9416d06682d2286d90a06d07",
    ".vibe/high-level-docs/08-verification-baseline.md": "82fb2e13221bfb0ab909119bb34ffc0d23b046ac60322583f185fea5ee3c093b",
    ".vibe/module-specs/Module-Spec-001-IdentityPolicy.md": "2348979065423aa9b30abb803285eff78eeaacff649d5d87c242889f9732efc9",
    ".vibe/module-specs/Module-Spec-002-EnterpriseProject.md": "eb9cd5e025a13aaa363923ed532d2a17533b9d7ee26e600ec0bc93d3afcc3332",
    ".vibe/module-specs/Module-Spec-003-TaskExecution.md": "07a4083a9dd1c9d2ca3c5d5c5152eb266e0044fadadccdc60472a004c74f807a",
    ".vibe/module-tests/Module-Test-001-IdentityPolicy.md": "f51df9f9b1725ad3c7650f87ad3c8e075ffee20fd437e0e927e1dcaab3c64853",
    ".vibe/module-tests/Module-Test-002-EnterpriseProject.md": "f484934af02dfb0c8323c5eda4f96509f991f0ab7f68990f2ac1608de138ae64",
    ".vibe/module-tests/Module-Test-003-TaskExecution.md": "7044a97d8dcf66c43a477b07e8a2190dc4aa0fbb8c6fe641664aa7537153c321",
    ".vibe/product/roadmap.md": "96e5d70137bc86706f5b64d19a39ac27a53cf231da3bbfbde6b5e56ea1bbe7b2"
  }
}
```

## 附录B：第二轮独立复审与人类批准manifest

```json
{
  "base": "cd2a249cff5e8bc0406321863b39b8cbe5141a2e",
  "files": {
    ".vibe/api-contract-v0.1/API-Contract-v0.1.md": "014cb83cc450d753b236f2a932438f841f444d994f4717c1452d9f2b680ecb20",
    ".vibe/decisions/task-completed-delivery-completion.md": "d6ff109357f573b8a0fcaa6c674bea3f28e188bfadfd381764a1bcc835f2c39f",
    ".vibe/decisions/task-execution-human-operated.md": "66ec8b1cbcb23b7ab3e2ae62495d5d797239950145ba27b0b34c819916f6d1f4",
    ".vibe/high-level-docs/02-zhiju-core-architecture.md": "e3c6cb06243945e47309ce408960e9350127fe1dce5fdbb00421a600b9eb2579",
    ".vibe/high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md": "ad7be0fdb89716c4e0c9d031088b629d41f0e142f8a562de46b018e3b73a916a",
    ".vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md": "23c781bfca8e4e78e1934db2e029af480fcb4e6b49ebfb0f755b87369b1b3f8f",
    ".vibe/high-level-docs/07-postgresql-logical-model-v0.1.md": "0305978cd0148f2577fa4202bacda27b877c5dbb86fe9110970215f365419ec1",
    ".vibe/high-level-docs/08-verification-baseline.md": "82fb2e13221bfb0ab909119bb34ffc0d23b046ac60322583f185fea5ee3c093b",
    ".vibe/module-specs/Module-Spec-001-IdentityPolicy.md": "2348979065423aa9b30abb803285eff78eeaacff649d5d87c242889f9732efc9",
    ".vibe/module-specs/Module-Spec-002-EnterpriseProject.md": "eb9cd5e025a13aaa363923ed532d2a17533b9d7ee26e600ec0bc93d3afcc3332",
    ".vibe/module-specs/Module-Spec-003-TaskExecution.md": "09aacbe7113513ddeae106f76e4df4da21a5daae1ff6f4b921eb29eb1d56434d",
    ".vibe/module-tests/Module-Test-001-IdentityPolicy.md": "f51df9f9b1725ad3c7650f87ad3c8e075ffee20fd437e0e927e1dcaab3c64853",
    ".vibe/module-tests/Module-Test-002-EnterpriseProject.md": "f484934af02dfb0c8323c5eda4f96509f991f0ab7f68990f2ac1608de138ae64",
    ".vibe/module-tests/Module-Test-003-TaskExecution.md": "9665d34a99c1be79af61f24edf588f271e4b8b6619c6ef19f59bf624bc876779",
    ".vibe/product/roadmap.md": "96e5d70137bc86706f5b64d19a39ac27a53cf231da3bbfbde6b5e56ea1bbe7b2"
  }
}
```

## 附录C：原生docs验证证据

第一轮：native exec session61827，第二轮修订后：native exec session22538；均直接执行配置target，不重写verifier。固定pnpm11.19.0，第二轮Invocation=`CI=true PATH=/Users/galendai/Library/pnpm/.tools/pnpm/11.19.0/bin:$PATH vibe verify docs --json`。原生完成输出（两轮相同）：

```text
[docs-verification] PASS files=15
Checking formatting...
All matched files use Prettier code style!
$ node --experimental-strip-types tools/verification/check-docs.mts && pnpm format:check
$ prettier --check .
{"status":"PASS","target":"docs","command":"pnpm verify:docs","exit_code":0}
```

初始sandbox命令在pnpm自动依赖同步阶段失败，未进入docs；只读pnpm固定版本预检通过。offline install缺@types/pg缓存，随后按原frozen lockfile恢复依赖、在获准环境执行原target通过。没有锁文件/验证脚本改动，没有把环境失败写成业务assertion failure或抹除。最终metadata/正式记录修订的验证和审查由后续章节与PR exact-head CI记录，不将上述15文件设计验证夸大为未核验的最终head。

## 9. 真实 PR final-head 独立审查（2026-10-01）

APPROVE

Reviewed SHA：`8299bd72dbc8d2e39a15dc94922bd80ea7ce2047`；base=`cd2a249cff5e8bc0406321863b39b8cbe5141a2e`；真实PR=[#238](https://github.com/qzhike/zhiju-business-core/pull/238)。Reviewer重新执行`vibe repo --json`核对本地repository/branch/head，并通过`gh pr view 238 --json title,body,state,isDraft,headRefOid,baseRefOid,comments,reviews,statusCheckRollup,url`独立读回远端同一head/base：OPEN、Draft，尚无评论或正式GitHubreview；审查时CI select为QUEUED。此APPROVE是独立Reviewer技术结论，不伪称已经提交GitHubformal approval，也不把queuedCI写成PASS。合并前Delivery仍需核对最终实际head、requiredchecks和已授权范围。

批准来源为第8节记录的当前会话用户明确“批准设计，合并PR并更新issue”；该决定实际解除T2human设计gate，不沿用第7节历史HUMAN_REVIEW_REQUIRED作为当前阻塞。Reviewer独立重算`a38e66f2df60d45079a093f08fed4e4f12732ef1`的15文件Gitblob SHA256，全部与附录B批准manifest匹配；同时逐字段比对内联附录A/B与原完整manifest，均相等。因此批准覆盖的语义修订可从仓库与本文自包含定位，不依赖临时文件存活。

独立检查批准设计commit→reviewedhead的全部16文件差异：15设计/权威文件仅更新真实人类批准/独立审查状态、decision新增具体批准及scope记录、roadmap记录基于获批设计重新评估一个完整实现候选的forwardintent；第16文件为本正式Review记录。没有变更field/Hash/codec/association/lease/fencing/retry/auth/criteria/readback语义或normal/recovered验收，也没有新增runtime/schema/generated/migration/lockfile或无关模块变化。原F1/F2仍CLOSED；其余第4/7节语义结论可复用，没有新增blockingfinding。Issue#237的独立设计review、人类批准和真实PR正式记录要求在此head已满足；配置docs已具当前本地证据，GitHub合并/Issue关闭仍由Delivery读回实际结果。

当前reviewedhead验证复用：native exec session24143，exacttree随后未改内容提交为`8299bd72dbc8d2e39a15dc94922bd80ea7ce2047`；直接调用原配置`CI=true PATH=/Users/galendai/Library/pnpm/.tools/pnpm/11.19.0/bin:$PATH vibe verify docs --json`，原生完成exit0。完整16文件PR的输出为：

```text
[docs-verification] PASS files=16
Checking formatting...
All matched files use Prettier code style!
$ node --experimental-strip-types tools/verification/check-docs.mts && pnpm format:check
$ prettier --check .
{"status":"PASS","target":"docs","command":"pnpm verify:docs","exit_code":0}
```

Reviewer复用该exacttree原生docs证据，没有重复执行同一充分target，也没有因docs-onlyscope要求full/environment。本文本节是reviewrecord-only追加，不自动宣称其未来提交head已经取得CI；追加交付后Reviewer应只读确认最终record-onlydiff，Delivery核对新head当前docs/checks后再合并。不得为了把本文件自身最终SHA写入自身而制造无穷reviewcommit循环；最新review结论可通过授权PRcomment精确绑定最终head，随后读回。

未执行边界保持：全部新TaskCompleteddispatch、EPexactassociation/v2Evaluation/readback、normal/recovered真实owning链、persistence/concurrency/fault、授权撤销与迁移RLS/ACL均NOT RUN；Provider/CLI/Feishu/publicHTTP/UI、部署/生产/负载、独立人工业务验收仍NOT RUN。旧GrantPolicySnapshot延后、Cancel/late-result及IM-06整体退出要求保留。APPROVE不批准runtime实现或依赖Issuepublication，不关闭IM-06；用户对本设计PRmerge及Issue#237更新的授权由Delivery在requiredgates通过后执行。
