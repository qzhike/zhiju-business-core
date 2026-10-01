# PR #240 — TaskCompleted / DeliveryItem Completion 实现审查

状态：`INDEPENDENT RE-REVIEW COMPLETED ON f1868668db60cf2dfb32a87d88bef30d6c815003 / ROUND-1 F1–F3 CLOSED / EXPLICIT HUMAN TECHNICAL APPROVAL AND MERGE AUTHORIZATION RECORDED 2026-10-01 / FINAL DOCUMENT-HEAD REVIEW AND CHECKS REQUIRED BEFORE MERGE`。

本文为项目要求的正式审查记录入口。第 1–4 节保留 Implementer 在取得实际 PR 编号后建立的准备记录与当时门禁，不构成独立审查结论或人类技术批准；第 1 轮与第 2 轮独立审查结果见第 5、7 节，不把作者验证作为 Reviewer APPROVE。

## 1. 工作项与修订

- 工作项：[Issue #239](https://github.com/qzhike/zhiju-business-core/issues/239)。交付：[PR #240](https://github.com/qzhike/zhiju-business-core/pull/240)，Draft，base `main@caa9bd6525bfd577369efe3ae84acc2e8dbdc2df`。
- 首次提交实现的代码修订：`845e531ef5bee12af50e06c527bfde168802f0a9`。本记录加入后 PR head 会前进；正式 Reviewer 必须独立读回最新 head，绑定当时实际完整 SHA，并审查包括本记录在内的最终 diff。
- 第1轮独立审查实现 SHA：`17e8ae6969e229930df86498b46e172826fd2ce5`，结果 `REQUEST_CHANGES`，详见 §5；第2轮 reviewed SHA 为 `f1868668db60cf2dfb32a87d88bef30d6c815003`，结果 `HUMAN_REVIEW_REQUIRED`，F1–F3 已关闭，详见 §7。

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

## 7. 独立实现复审第 2 轮（2026-10-01）

- Reviewer：本次用户请求的独立 Codex Reviewer；对修订实际 diff、未变更的 Issue #239 与 owning 契约独立核对，未修改产品代码。
- Reviewed SHA：`f1868668db60cf2dfb32a87d88bef30d6c815003`；发布前 GitHub 读回为同一 head、OPEN / Draft。前轮基线为 `17e8ae6969e229930df86498b46e172826fd2ce5`。
- 结论：`HUMAN_REVIEW_REQUIRED`。前轮 F1–F3 在该修订上 CLOSED；本轮未发现新的阻塞实现问题。项目明确要求的授权 / RLS / persistence 人类技术审查仍为 PENDING，既有详细设计批准不替代当前实现批准。
- [已发布并读回的复审总结](https://github.com/qzhike/zhiju-business-core/pull/240#pullrequestreview-5377208288)，GitHub state 为 `COMMENTED`，commit_id 与 reviewed SHA 一致；不是 GitHub APPROVE review event 或人类批准。

### 7.1 Findings 处置

| Finding | 本轮独立证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 结论                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| F1 / P1 | V7012 先读取 exact Item 冻结 profile；exact-task profile 缺失 discriminator 仍走完整 v2 guard，真正 legacy Item 保留兼容路径。负例从正常 owning Evaluation 复制，仅删除 `taskFactSemantics` 并重算 payload/fingerprint Hash，确认 app role 与合法 Project context，要求 23514 且 pointer 不变；legacy owning 正例确认其成功 Evaluation 无 discriminator。两者纳入当前 exact-head CI。                                                                                                            | CLOSED；本轮复用真实 PostgreSQL CI，不声称重新本地执行该 SQL 反例。 |
| F2 / P2 | Result 普通数组移除 uniqueness，request NonEmptySet 保留。独立 Registry probe：原结果 PASS、新 standalone duplicate-array 结果 PASS；duplicate request 在 `/payload/factRefs/uniqueItems` 拒绝。复核请求三个必填字段、结果四个必填字段/optional Impact、closed shape、Ref 与 PositiveInt 范围仍符合 Spec 002 §23.3。                                                                                                                                                                             | CLOSED。                                                            |
| F3 / P2 | 新 isolated owning 测试在同一合法 Human-approved ACTIVE Plan 创建两个独立 Task/Item，以 Kysely result hook 暂停真实 producer 的 Outbox INSERT 后/pre-commit；未提交源不可见，高 UUID 可见源先 sequence1，低 UUID 晚提交后仍被发现并 sequence2。先消费/评估 sequence2，再处理另一个 Item 的 sequence1，两者 owning readback SATISFIED、pointer1→2、各一份 Fact/association/Evaluation/CompletionEvent；DUPLICATE 重放和原 binding/watermark 不变。CI 日志明确记录该 named schedule state=passed。 | CLOSED；不将剩余同关联多源等子项升级为 PASS。                       |

### 7.2 验证与当前门禁

复用 [full CI run 36830102436](https://github.com/qzhike/zhiju-business-core/actions/runs/36830102436)：独立读回 `headSha` 为 reviewed SHA；`select`、`checks`、`persistence`、汇总 `verify` 均 SUCCESS，实际 Verify code / Verify persistence steps 成功。独立查阅 CI 日志确认普通 83 files / 1641 tests、真实 PostgreSQL 43 files / 550 tests；新增 late-commit/cross-Item schedule、两个 normal/recovered owning delivery fixtures（含 F1 负例）以及 `EP-WI12-P-005` legacy control 均通过。未为重复取证再运行本地 configured full。

剩余 PARTIAL / NOT RUN 子项保持原有分层限定；LOCAL SYNTHETIC revocation 不冒充 owning 撤销生产者证据。外部 Provider/CLI/飞书、生产/负载及独立人工业务验收继续 NOT RUN。下一门禁为当前授权 / RLS / persistence 实现的人类技术审查，再按适用交付门禁与明确合并授权推进；本轮未提交、推送、合并或关闭 IM-06。本节为本地正式记录更新，尚未提交或推送。

## 8. 人类批准与交付授权（2026-10-01）

第 2 轮复审已向用户明确说明：F1–F3 在 `f1868668db60cf2dfb32a87d88bef30d6c815003` 关闭，无新阻塞实现 finding；剩余门禁为当前授权、RLS、持久化实现的人类技术审查。用户随后明确回复：

> 批准更改，合并PR并关闭local/remote branch及issue

该批准在上述复审上下文中绑定 `f1868668db60cf2dfb32a87d88bef30d6c815003` 的当前变更及已说明的人类技术门禁，并授权 PR #240 合并、Issue #239 关闭与对应本地/远端 task branch 清理。批准包含为满足正式记录门禁而提交、推送本记录的必要交付动作；不授权 unrelated branch/worktree 清理、部署或 IM-06 整体关闭。

本次最后提交仅保存第 2 轮正式复审记录与本批准，不修改实现、契约、迁移或测试。记录提交后仍须从 GitHub 读回实际最终 head、独立检查文档增量与原实现一致性，并取得该 head 的 required full CI 成功；最终 reviewed SHA、检查和真实合并/关闭结果记录在 PR/Issue，不预写未来合并事实。

此前 §1–7 的 PENDING / NOT RUN / 未提交等表述保留各轮当时事实，由本节的明确批准与后续 GitHub 交付证据 supersede；未执行的 external/manual/PARTIAL 子项不因批准升级为 PASS。
