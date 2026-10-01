# PR #240 — TaskCompleted / DeliveryItem Completion 实现审查

状态：`DRAFT / INDEPENDENT IMPLEMENTATION REVIEW REQUEST_CHANGES ON 17e8ae6969e229930df86498b46e172826fd2ce5 / FIXES PROPOSED / INDEPENDENT RE-REVIEW PENDING / HUMAN TECHNICAL REVIEW PENDING / NOT APPROVED FOR MERGE`。

本文为项目要求的正式审查记录入口。第 1–4 节保留 Implementer 在取得实际 PR 编号后建立的准备记录与当时门禁，不构成独立审查结论或人类技术批准；本轮独立审查结果与发布证据见第 5 节，不把作者验证作为 Reviewer APPROVE。

## 1. 工作项与修订

- 工作项：[Issue #239](https://github.com/qzhike/zhiju-business-core/issues/239)。交付：[PR #240](https://github.com/qzhike/zhiju-business-core/pull/240)，Draft，base `main@caa9bd6525bfd577369efe3ae84acc2e8dbdc2df`。
- 首次提交实现的代码修订：`845e531ef5bee12af50e06c527bfde168802f0a9`。本记录加入后 PR head 会前进；正式 Reviewer 必须独立读回最新 head，绑定当时实际完整 SHA，并审查包括本记录在内的最终 diff。
- 第1轮独立审查实现 SHA：`17e8ae6969e229930df86498b46e172826fd2ce5`，结果 `REQUEST_CHANGES`，详见 §5；修复后最新 head 的独立复审仍 `PENDING`。

## 2. 已有设计权威与本次边界

#237 设计由 PR #238 交付，其独立设计结论、人类设计批准和最终设计 head 绑定保留于 [PR #238 Review](../pr-238/Review.md)，不转写为本 PR 的实现审查。

既有详细设计批准绑定 `a38e66f2df60d45079a093f08fed4e4f12732ef1` 与 manifest SHA256 `fdc8dac48d6f993599203fcdb054b388ec8e301c588d33d068c89bed741b67a7`；最终设计独立 APPROVE 绑定 `60a5e00d764e3990ae8356959e4a13029be05dd5`。2026-10-01 用户在 #239 实现会话明确批准 V7011 / V7012 两个有限迁移编号例外，已同步 migration 布局契约及 PostgreSQL §41；这不替代实现或人类技术审查。

声明模块为 TaskExecution、EnterpriseProject、IdentityPolicy；共享 contracts/generated、owning migrations、application composition、fixtures、Spec/Test 和 authority 为必要配套。新增公开 Major 仅 EP `project.evaluate_delivery_item_completion@2.0`，没有新增公开 Query/Event/HTTP/UI。IM-06 的其余退出义务保持原范围。

## 3. 必需审查与证据入口

独立 Reviewer 应从最新 Issue/PR、head diff、TE Spec003 §26、EP Spec002 §23、IP Spec001 §15.16 与 PostgreSQL §41进入，独立确认：

- TE COMMITTED source / original definition / Receipt causation、stored/public/envelope/binding Hash 与 private material/ACK 句柄边界；
- Project-partition allocation、cursor→Outbox 锁序、lease fencing、五次窗口与 Human resume Audit 原子性；
- EP exact Plan Version / Item / Task、Inbox conflict/幂等、ledger→Item 锁序、独立 v2 CAS、immutable full Evaluation/fingerprint 及 revocation/history/current readback；
- 九个当前授权映射、真实 Service/Actor/session/Grant/Decision、各 protected read/lock/commit/历史返回复验与依赖不可达；
- 两个 forward migrations 的最小 ACL / FORCE RLS / owner guards / same-owner FK，以及空库、合法历史升级和第二次 no-op；
- Module-Test 001/002/003 #237 矩阵的实际覆盖与 PARTIAL / NOT RUN，尤其 controlled Driver 与 LOCAL SYNTHETIC revocation 不被提升为 external/manual/真实撤销生产者证据。

执行和 CI 证据以 [PR #240](https://github.com/qzhike/zhiju-business-core/pull/240) 的正文与 checks 为准；本记录不复制执行日志。外部 Runtime/Provider/CLI/飞书、生产/负载、独立人工业务验收及实际 Grant PolicySnapshot 生命周期仍不由本次 controlled 验证证明。

## 4. 建立准备记录时的门禁（历史）

| 门禁                                          | 当前事实                                                         |
| --------------------------------------------- | ---------------------------------------------------------------- |
| 既有详细设计人类批准                          | 已有，精确绑定见 §2 / PR #238 Review                             |
| V7011 / V7012 有限编号决定                    | 用户明确批准 2026-10-01，已同步契约                              |
| 最新 head configured full / exact-revision CI | 查看 PR checks；独立 Reviewer 需绑定实际 head，不接受旧 SHA 替代 |
| 独立实现审查                                  | PENDING / NOT RUN，无 Reviewer APPROVE                           |
| 授权 / RLS / persistence 人类技术审查         | PENDING / NOT RUN，无人类技术批准                                |
| 合并授权                                      | NOT GRANTED；用户本次仅授权实现和提交 PR                         |

在所有项目门禁及独立审查满足、且得到明确合并授权之前，本 PR 保持未合并。正式审查产生 findings 或结论后应追加其精确 reviewed SHA、分类、证据与处置，保留本准备记录的历史事实。

## 5. 独立实现审查第 1 轮（2026-10-01）

- Reviewer：本次用户请求的独立 Codex Reviewer；未修复产品代码。
- Reviewed SHA：`17e8ae6969e229930df86498b46e172826fd2ce5`；发布前与发布后均从 GitHub 读回一致，PR 为 OPEN / Draft。
- 结论：`REQUEST_CHANGES`。按用户要求发布为 GitHub `COMMENT` 类型的 review，包含三条行内 comments；不是 GitHub `REQUEST_CHANGES` review event，也不构成人类技术批准。
- [已发布并读回的审查总结](https://github.com/qzhike/zhiju-business-core/pull/240#pullrequestreview-5375899484)。本节记录的是该 SHA 的审查；本地新增记录本身尚未提交或推送。

### 5.1 Blocking findings

| ID / 优先级 | 位置与问题                                                                                                                                                 | 证据、影响与处置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1 / P1     | `V7012__exact_delivery_completion.sql:67–70`：v2 guard 按待插入 payload 是否带 `taskFactSemantics` 选择校验路径，而没有先检查 owning Item 的冻结 profile。 | 静态检查证明省略该键会直接 RETURN NEW，包括 exact-task profile Item。V2013 仍授予 app INSERT；旧约束只校验 Scope、非空数组、Hash 长度和同 Owner FK，pointer guard 只检查精确身份和版本推进，不能代替新 criteria/evaluator/association/Hash/outcome 校验。未校验的不可变 Evaluation 可污染 pointer，后续新 readback 拒绝该记录。应由 owning Item profile 决定强制 v2 shape，保留真正旧 Item 的兼容路径，并补 app role / 合法 Project context 的真实 PostgreSQL 负例与旧 grammar 正例。本轮未执行此 direct-SQL 反例，不标为 PostgreSQL 复现 PASS。[comment](https://github.com/qzhike/zhiju-business-core/pull/240#discussion_r4152640556)；OPEN。 |
| F2 / P2     | `enterprise-project.schema.ts:914–916`：结果 `satisfiedFactRefs` 的 `unique: true` 将 Spec 002 §23.3 的普通 `T[]` 收窄为 Set。                             | 独立调用 `ContractRegistry.validateOperationResult`：原合法 fixture PASS，仅复制一个合法数组元素后 FAIL，错误精确为 `/satisfiedFactRefs` 的 `uniqueItems`。应移除结果数组的 uniqueness 限制、同步生成产物并补重复元素合法正例；请求 `factRefs` 的 NonEmptySet 约束继续保留。[comment](https://github.com/qzhike/zhiju-business-core/pull/240#discussion_r4152640567)；OPEN。                                                                                                                                                                                                                                                                     |
| F3 / P2     | Module-Test 003 `TE-DEL-D-004` 与 Module-Test 002 `EP-DEL-D-004`：明确要求且可达的 late-commit / 不同 Item 乱序水位验收未执行。                            | Issue #239 明确要求未提交源不可见、低排序键晚提交仍可发现，以及不同 Item 的低 sequence Fact 仍可使用；当前矩阵将这些调度保留为 NOT RUN。两个合法独立 Task/Item 即可构造这些调度，不需要伪造同 Task 的不可达历史。应补 owning PostgreSQL 调度、稳定 binding/sequence/observedAt 重放及低 sequence 另一个 Item 的独立评估断言，取得当前修订证据。诚实标注 NOT RUN 不等于豁免明确验收；本 finding 不扩大到外部/人工或不可达同 Task 多源历史。[comment](https://github.com/qzhike/zhiju-business-core/pull/240#discussion_r4152640573)；OPEN。                                                                                                       |

### 5.2 证据与边界

独立读取 Issue #239、已批准 TE Spec §26 / EP Spec §23 / IP Spec §15.16、PostgreSQL §41、实际 diff、相关实现、迁移和 fixtures/tests。契约逐字段核对包含请求的三个必填字段、closed shape 与 NonEmptySet，以及结果的四个必填字段、可选 Impact Ref、普通数组和 PositiveInt；F2 的独立正反对照验证了具体收窄边界。

复用 [exact-head full CI run 36822314210](https://github.com/qzhike/zhiju-business-core/actions/runs/36822314210)：GitHub `headSha` 为 reviewed SHA，`select`、`checks`、`persistence` 与汇总 `verify` 均 SUCCESS；实际 code 与 persistence steps 成功，覆盖本项目 required full。未为重复取证重跑本地 configured full。CI 通过不消除 F1/F2 的契约缺陷，也不证明 F3 尚无执行证据的必需调度。

外部 Provider/CLI/飞书、生产/负载、独立人工业务验收保持 NOT RUN；LOCAL SYNTHETIC revocation ledger 不升级为 owning 撤销生产者证据。授权 / RLS / persistence 人类技术审查仍 PENDING，应先修复已知阻塞并对新 head 独立复审。没有实现修改、commit、push、merge 或 IM-06 关闭。

## 6. Implementer 修订处置（2026-10-01，待独立复审）

保留 §5 对原 reviewed SHA 的 REQUEST_CHANGES 与三条 findings，不将作者修订当作独立复审或人类技术批准。本节是用户要求“根据评论修订代码”的处置记录；实际最新 head 和 configured full 执行证据以 PR 为准。此前本地保存的第1轮正式审查记录随本次修订保留。

- F1：在尚未合并的 V7012 提案中，先读取 owning Item 的冻结 profile 再选择 guard；exact profile 缺失 discriminator 仍执行完整 v2 校验。新增合法 Project Context / enterprise_project_app 的真实 SQL 负例，只删除 discriminator 并重算派生 Hash/fingerprint；先在原 guard 复现可插入后主动 rollback，再在修订 guard 下验证 23514、pointer 不变。已有真实 legacy Item 的 v1 owning 正例明确验证无 discriminator 仍可提交；不改 main 已应用迁移。处置：修复提出，待独立复审。
- F2：Result satisfiedFactRefs 移除 uniqueness，保留 request NonEmptySet；重新生成配套产物，新增独立 duplicate-array 合法 fixture。处置：修复提出，待独立复审。
- F3：新增真实 owning producer 暂停于 Outbox INSERT 后/pre-commit 的晚提交调度；同一已批准 ACTIVE Plan 内两个独立预分配 Task/Item，高 UUID 可见源先 allocation，低 UUID 晚 commit 源后 allocation。按高 sequence→低 sequence 消费并独立评估另一 Item，核对 binding/sequence/observedAt 原材料重放及不重复事实/评估/事件；剩余不同层级子项继续 PARTIAL/NOT RUN。处置：补充可达验收，待独立复审。

最新修订仍须独立 Reviewer 绑定实际完整 head SHA 复审，授权/RLS/persistence 人类技术审查继续 PENDING；没有合并授权，也不关闭 IM-06。
