# PR #234 独立设计审查

状态：`TECHNICAL DESIGN REVIEW PASS / HUMAN DESIGN APPROVED 2026-09-30 / RUNTIME NOT RUN`。此前各轮角色结论与待批准状态按当时事实保留，当前批准见下文。

- Issue：[#233](https://github.com/qzhike/zhiju-business-core/issues/233)；设计 PR：[#234](https://github.com/qzhike/zhiju-business-core/pull/234)，Draft。
- 审查日期：2026-09-30。
- 最新 Reviewed SHA：`f7d9406b6640e3aea4e86be77d6c0d3a53430eea`；首轮 SHA：`d10927d3531ea8f284cb96aee6b1bb8d55dba497`；第二轮 SHA：`beff2668a33903eaf72abc3a55280302f14df32a`。
- Base SHA：`8d15943f4c28a6a7b4c177571d04c773f74d5238`。
- 角色：独立 Reviewer；未修改产品代码或 owning 设计文档，未提交、推送或发布 GitHub 评论。

## 审查范围与独立预期

依据最新 Issue 正文（无评论）、原 TaskExecution §11.3–11.6/§21/§23–24、Artifact 不可变 Revision/创建与精确读取、Quality #192 以及现行注册契约建立预期，再核对 19 文件设计差异和必要 owning 实现。此交付应允许实现者在不自行发明业务语义的情况下完成正常及恢复正链：真实 Human Artifact 创建、原 invocation 非空 final、独立 BUSINESS_OUTPUT/Acceptance、两个单 Root Completion、精确历史及当前可用性读取、完成依赖 Readiness。历史冻结身份、200 compatibility baseline、非空正式事实、权限及完整 blocker 集合不能被替换或豁免。

重点核对新 selector/公开身份、创建与 Result 依赖及 Hash 域、producer/consumer 独立授权、所有 child/Run/Request 集合与并发序列化、当前资格/刷新和 #192 质量消费。读取的必要实现包括 `controlled-final-result.ts`、`recovery-final-profile.ts`、`task-readiness-plan.ts`、`work-order-validation-plan.ts` 的支持边界及 Artifact `revision-service.ts`；现行 Event Schema 确认 Completed 正式事实集合为非空。审查没有把尚待人类批准当作阻止审查设计提案本身的前置循环。

## 首轮 Blocking findings（历史记录）

### R1 — P1：恢复输出创建资格与原 final blocker 形成循环

位置：`Module-Spec-003-TaskExecution.md` §25.2（审查版本第 2159 行）、§25.4（第 2198/2208 行），并关联既有 §11.5/§24 的恢复屏障。

`get_output_creation_binding` 要求“无未处理 blocker”；但恢复规则明确规定 Run-1 的 BLOCKED_INPUT 只有在 Request 有效 RESOLVED、Context-2 采用该 Resolution、Run-2 合法成功后才被视为已处理。具体反例是已经完成 Human answer/Resolution、Context-2、retry 与 Run-2 START 的正常恢复链：此时原 final blocker 仍未处理，因此 Artifact 无法取得 binding 创建输出；而本新 profile 的 Run-2 非空成功 final 又必须等待该输出。遵循当前规则的实现永远无法走通 TE-COMP-D-003。

需要在 owning 规格明确区分输出创建的 Run-2 当前资格和 Completion 的原 final 屏障。已有效解决且被 Context-2/retry intent 精确采用的源 blocker，应有明确规则允许其后继 Run 创建输出；原 blocker 仍须保留到该后继合法成功，不能因为允许创建就豁免 Completion。同步定义额外未解 Request/其他源 blocker 的拒绝行为及正负验收。

### R2 — P1：已声明支持的质量判据缺少精确 Profile/RAS/ABS 的选择与绑定来源

位置：`Module-Spec-003-TaskExecution.md` §25.1（第 2153 行）、§25.3、§25.4（第 2210 行）；相关旧 §11.6、§21.5 及 `Module-Spec-005-QualityGovernance.md` #192。

新 profile 声明可选择 REVISION_ACCEPTANCE_READY / REVISION_FULLY_APPROVED；TaskCriterion 的 closed bindings 仅有 outputSlots，Completion v2 的 closed payload 仅有 policyRef/evaluatorRef，Completion Policy 仅有 TTL，Artifact output-fact 也不提供 Quality 引用。§25 沿用 §21 首版检查，未明确解除两处 qualityProfileRef 必须缺省的支持限制。文档却要求读取同 Revision/Profile 的精确 RAS/ABS，再调用 #192；后者要求调用方已经给出精确 RAS/可选 ABS，不能负责替消费方选择。

具体反例：同一个新 Revision 在两个 Profile P1/P2 下分别存在 READY RAS 和 FULLY_APPROVED ABS，或同 Profile 有前后两个历史 RAS/ABS。当前冻结 Task/WorkOrder、请求与输出事实无法决定权威 Profile、初次 Evaluation 使用哪一组精确 Snapshot，以及新 Snapshot 出现后 refresh 是否仍使用原锚点。自行选择 latest/Profile 或发现式回退违反本设计的精确冻结及“new latest snapshot fail closed”规则；统一拒绝又违反已声明的可选质量支持集和 TE-COMP-D-010 正向预期。

需要给出完整且唯一的 owning 选择/绑定语义、权限读取、精确引用持久化与 refresh 规则，并同步必要 closed 字段/兼容分类/fixtures；或者明确收窄此次有限支持集。不能仅要求实现者调用 #192，因为其精确输入来源仍未定义。

## 其余技术判断与证据

在上述两项之外，设计明确使用 Artifact owning spelling，保留旧路径冻结历史并要求新建冻结执行；新 creation Receipt 与 Revision 不互相包含完整 Hash，creation binding 和 Result 后向 join 避免补写 sealed provenance；Completion 输入由 owner 派生，保留独立 BUSINESS_OUTPUT 与完整性判断；明确 Task→WO→Run→Request 共同 parent 锁协议覆盖 INSERT phantom、单 Root CAS、一次 Completed Event、immutable refresh 与历史/current 状态分离。这些判断仅为静态设计审查，不证明未来实现已正确运行。

配置目标为 `docs`。PR 正文记录 `vibe verify docs --json` PASS（19 文件设计集）；本轮没有重复执行已有目标。独立读回远端 reviewed SHA 的 [CI run 36675351461](https://github.com/qzhike/zhiju-business-core/actions/runs/36675351461)：select/checks/verify 为 SUCCESS，persistence 为 SKIPPED，与纯文档范围一致。现行 Registry 230 / TE 57 / compatibility 200 与未来 237 / 62 / 200 的提案区分保留；此次未注册执行契约或新增 migration。

## 门禁与未执行边界

技术设计审查：`REQUEST_CHANGES`，须修复 R1/R2 后对新完整 SHA 独立复审。明确人类设计批准：`PENDING`，不制造批准事实。Issue #233 及 IM-06 未关闭；此记录不授权合并或后续实现。

未来 Contract/application/真实 PostgreSQL Completion、正常与恢复业务正链、Readiness/current quality 消费、并发/回滚/重放全部 `NOT RUN`；真实 CLI/Provider/飞书、public HTTP、生产/负载、独立人工业务验收亦 `NOT RUN`。既有 #224 分层证据、Grant PolicySnapshot lifecycle 延后、TD-05–07 及 milestone Cancel/late-result 退出要求未被升级或豁免。

## 第二轮复审 — beff2668a33903eaf72abc3a55280302f14df32a

结论：`REQUEST_CHANGES / HUMAN DESIGN APPROVAL PENDING / RUNTIME NOT RUN`。

已通过 `vibe repo --json` 及远端 PR readback 核对完整 SHA。R1 已修复：§25.2 只要求当前 Run 无自身 final reservation，并允许唯一已有效 RESOLVED、被 Context-2/retry intent 精确采用的原 BLOCKED_INPUT 屏障保留到 Run-2 成功；额外、未解决或未采用的来源仍拒绝。原 Completion 屏障没有因输出创建例外而提前消除。

R2 的引用来源与选择语义已修复：新冻结 profile 显式替换旧 qualityProfileRef 缺省限制，全部 child 的两处 exact Enterprise Profile pin 必须一致；Quality owning 内部发现仅在该 Profile/Revision 下选择已提交 Snapshot，不向旧 ABS 或其他 Profile回退；Evaluation 保存 qualitySelection，current 只检验历史精确锚点，显式 refresh 才形成新选择及新 Evaluation。独立检查 `quality-business-repository.ts` 确认 RAS/ABS 现行降序规则确为 evaluated_at、snapshot_id，与新 Port 一致。新来源集合排除目标自身新判断/pointer/版本、保留 child current pointer/版本；重读观察时间变化不会自动成为业务源变更，避免自失效循环。

### R3 — P1：SelectionPort 的 Service-only allowlist 与 Human Completion 支持冲突

位置：`Module-Spec-005-QualityGovernance.md` CompletionQualitySelectionPort（本 SHA 第 404 行）；对照 `Module-Spec-003-TaskExecution.md` §25.3 及 `Module-Spec-001-IdentityPolicy.md` §15.15。

新 SelectionPort “只允许固定TE Evaluator SERVICE”，而 Completion producer 明确允许授权 HUMAN，依赖授权规则要求每项实际 dependency 由消费方自身 principal 取得独立 Decision。具体反例是拥有合法 Task Completion 及全部质量读取 capability 的 Human，对带 REVISION_FULLY_APPROVED 的 Task 发起首次 Completion 或显式 refresh：必须调用 SelectionPort，却因 Human principal 被拒绝。以 Service 身份代理此依赖又违反“消费方自身 principal”的已声明规则。此矛盾使已支持的人类路径不能实施。

需使 SelectionPort 的 principal allowlist 与支持的 Completion caller 一致，保留每个实际 consumer 的独立授权；或在 owning Completion 规则中明确收窄并解释不支持的组合。修订后的 Human 和固定 Service 两种正向、Agent/未知 Service 及借身份的反例必须同步验收。

配置 docs 目标在 20 文件设计及首轮 Review 文件集记录为 PASS；本轮复用，不重复运行。远端 [CI run 36676047869](https://github.com/qzhike/zhiju-business-core/actions/runs/36676047869) 精确绑定本 SHA，select/checks/verify SUCCESS，persistence SKIPPED。除 R3 外未发现新的具体阻断反例；这不代替未来完整 Contract/application/PostgreSQL 实施验证。人类详细设计批准仍 PENDING，所有新增运行和外部/人工场景仍 NOT RUN。

## 最终复审 — f7d9406b6640e3aea4e86be77d6c0d3a53430eea

角色结论：`HUMAN_REVIEW_REQUIRED`。独立技术设计审查：`PASS`；明确人类详细设计批准：`PENDING`；全部新增运行验收：`NOT RUN`。

`vibe repo --json` 确认本完整 SHA。相较第二轮仅 Quality Spec/Test 两行 allowlist 修订：SelectionPort 现允许目标 Scope 内授权 HUMAN 或固定 TE Evaluator SERVICE，QG-COMP-D-001 明确两类 producer 都使用自身独立 Decision。该修订与 Completion 命令、自身归因、consumer dependency 授权及 #192 allowlist 一致，不引入借用 Service 身份或未授权读取；R3 已解决。第一轮 R1/R2 的修订未变，继续成立。新增 Port 是已证明必要的 owning 内部增量，不新增公开 Quality operation/table，也不绕过现行 exact Query/#192 current eligibility。

对本最终设计范围未发现剩余 blocking finding。正常及恢复创建、BUSINESS_OUTPUT 与独立完整性、固定 Profile/精确 Snapshot 来源、current 与 refresh、source collection/parent 锁协议及 Readiness 消费已具备可定位的实施规则；旧 identity/hash/compatibility、非空正式 Completion fact 和单 Root/一次 Event 边界保持。批准后的 Planner 仍须在届时 main 重验 NOW + READY，未来完整实施仍须 full、真实 PostgreSQL、独立实施审查及适用人类技术审查。

配置 `vibe verify docs --json` 的最终同一 20 文件集 PASS 证据由 Implementer 提供（target=docs，exit_code=0），本 Reviewer 复用已有目标结果；最终角色记录交付后的必要格式验证由交付方执行。上述 CI run 36676047869 仅对应第二轮 SHA，不能声称它覆盖最终 SHA。Reviewer 对最终 SHA 的独立 GraphQL 读回因连接超时未能取得；随后交付方实际执行 REST `gh api repos/qzhike/zhiju-business-core/commits/f7d9406b6640e3aea4e86be77d6c0d3a53430eea/check-runs`，读回精确最终 SHA 的 [CI run 36676266071](https://github.com/qzhike/zhiju-business-core/actions/runs/36676266071)：verify/checks/select 全部 completed/SUCCESS，persistence completed/SKIPPED。这是交付方 REST readback，非 Reviewer 独立 GraphQL 读回；该实际成功结果补齐最终 SHA 的 CI 证据，不改变先前超时事实，也不将 SKIPPED persistence 或 docs PASS 解释为运行时完成验证。

本记录保存技术审查及其历史，不能替代明确人类详细设计批准。因该具体设计批准仍待取得，最终角色按 Reviewer outcome 规则为 HUMAN_REVIEW_REQUIRED；这不是因人类批准未取得而拒绝审查提案，也不把技术 PASS 称为全部 Issue Acceptance 完成。PR 保持 Draft、Issue/IM-06 未关闭；没有合并、后续实施或发布授权的推定。所有未来 Contract/application/PostgreSQL、外部及人工边界继续 NOT RUN。


## 明确人类详细设计批准 — 2026-09-30

交付方记录：用户在本协作会话审阅最终交付说明后明确回复“批准了”，对应PR #234详细设计、当时远端head `f0cc2b29a326e526602dbdc30fbb9215670e973d`。独立审查的业务设计revision为 `f7d9406b6640e3aea4e86be77d6c0d3a53430eea`；独立Reviewer已只读确认f7d9406至f0cc2b2仅三文件metadata/正式记录变化、无新增设计语义。

当前门禁：独立技术设计审查PASS；明确人类详细设计批准APPROVED。上述HUMAN_REVIEW_REQUIRED是批准前的独立角色结论，不重写审查历史或伪造Reviewer新的结论。本次仅同步批准状态、保留全部运行NOT RUN；不修改业务设计、注册契约或产品实现。

当时最终head的实际CI为[run 36676733610](https://github.com/qzhike/zhiju-business-core/actions/runs/36676733610)，交付方REST读回select/checks/verify SUCCESS、persistence SKIPPED；本批准记录提交后的docs/新head CI证据另由PR保存。此批准解除具体设计门禁，不授权合并、后续Issue发布或产品实现；Issue/IM-06完成与后续NOW + READY按各自流程处理。
