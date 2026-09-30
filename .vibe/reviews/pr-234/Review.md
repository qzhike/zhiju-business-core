# PR #234 独立设计审查

状态：`REQUEST_CHANGES / HUMAN DESIGN APPROVAL PENDING / RUNTIME NOT RUN`。

- Issue：[#233](https://github.com/qzhike/zhiju-business-core/issues/233)；设计 PR：[#234](https://github.com/qzhike/zhiju-business-core/pull/234)，Draft。
- 审查日期：2026-09-30。
- Reviewed SHA：`d10927d3531ea8f284cb96aee6b1bb8d55dba497`。
- Base SHA：`8d15943f4c28a6a7b4c177571d04c773f74d5238`。
- 角色：独立 Reviewer；未修改产品代码或 owning 设计文档，未提交、推送或发布 GitHub 评论。

## 审查范围与独立预期

依据最新 Issue 正文（无评论）、原 TaskExecution §11.3–11.6/§21/§23–24、Artifact 不可变 Revision/创建与精确读取、Quality #192 以及现行注册契约建立预期，再核对 19 文件设计差异和必要 owning 实现。此交付应允许实现者在不自行发明业务语义的情况下完成正常及恢复正链：真实 Human Artifact 创建、原 invocation 非空 final、独立 BUSINESS_OUTPUT/Acceptance、两个单 Root Completion、精确历史及当前可用性读取、完成依赖 Readiness。历史冻结身份、200 compatibility baseline、非空正式事实、权限及完整 blocker 集合不能被替换或豁免。

重点核对新 selector/公开身份、创建与 Result 依赖及 Hash 域、producer/consumer 独立授权、所有 child/Run/Request 集合与并发序列化、当前资格/刷新和 #192 质量消费。读取的必要实现包括 `controlled-final-result.ts`、`recovery-final-profile.ts`、`task-readiness-plan.ts`、`work-order-validation-plan.ts` 的支持边界及 Artifact `revision-service.ts`；现行 Event Schema 确认 Completed 正式事实集合为非空。审查没有把尚待人类批准当作阻止审查设计提案本身的前置循环。

## Blocking findings

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
