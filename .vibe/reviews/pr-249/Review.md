# PR #249 正式审查记录

## 第十五轮复审（当前结论）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`73378adc4da773b257d4c2bf945cafae36a657ca`；日期：2026-10-06。
- `vibe repo --json` 确认本地 repository/branch/revision；起始工作区干净。GitHub CLI GraphQL/REST 暂时连接超时后，浏览器备用通道成功读取 PR：OPEN、非 Draft，最新第13个 commit 的完整 SHA 与本地一致；Issue #248 当前 Acceptance/required full 未调整。
- 非盲审：按当前 Issue #248 原 Acceptance、Spec003 §12/Spec001 §15.19、BOARD-D/IP-BOARD-D 核对本轮实际 diff。相对第十四轮，只有新增未配置 Board Policy 的 PG 测试、Module-Test 状态与历史正式记录；产品代码未变，当前 owning authority 未变。

### 第十五轮实现证据与 finding 对账

- **认可 Board Policy 缺配置入口反例。** `runWithoutConfiguredPolicy` 使用真实 owning Human Decision，给 entry 的 `boardPolicyRef` 返回 undefined；新测试断言 `DEPENDENCY_UNAVAILABLE`。当前 entry 在该配置检查点同步抛错，早于 Human Decision/Policy/source 的 protected read；此控制流支持当前实现不读取受保护来源。
- **证据粒度仍需准确。** 新测试只有错误码断言，没有 protected-read/write 计数探针。若错误实现先读 source 再抛同一错误，本测试仍会通过，因此 Module-Test 不能据此宣称已执行证明“protected read 为0”。Board Policy ref 缺失是一个配置反例，也不是七项 capability mapping 各自缺 config/Grant 的完整反例。认可已补子项，不把它写成完整配置矩阵闭合。
- 当前恢复的原 export/sequence、hash/covered-identities、crash 后新 marker、恢复前 generation 计数与后续 export 断言保持认可；WO 两种身份、入口 source revoke、完整 G1 分页和 executed dirty read 后 owning 提交的既有实现不重开。无新的产品回退证据。
- Module-Test 仍明确列出正常完成/BLOCKED_INPUT/恢复/取消状态链、七项 mapping、源读取已到达后最终返回前撤权、Export RR 两连接、P1→H/H→P2 freshness 屏障未交付；完整 BOARD-D/IP-BOARD-D 行仍 NOT RUN。上述未交付条件足以维持 R10。

### 第十五轮阻断 finding

#### R10 [P1] 完成剩余原验收，并准确证明缺配置时的受保护访问边界

依据：Issue #248 当前原 Acceptance；`.vibe/module-tests/Module-Test-003-TaskExecution.md:650`；`tests/persistence/task-board-entry.test.ts:885`；BOARD-D-001/004/005/006、IP-BOARD-D-001–003；Spec003 §12、Spec001 §15.19。

- **完整 owning 状态链：** 正常完成、BLOCKED_INPUT/一次恢复、已有有限取消后准确 Task/WO/blocker/current Evaluation，包含保守未解除窗口。
- **独立当前权限：** 七项 mapping 必要正反例，缺 Grant/config 的对应 protected read/write 为0；新增 Board Policy ref 缺失测试只闭合该错误路径。为0的运行证据须有访问计数/拒绝访问探针及合法对照，不能只有错误码。首屏/翻页/最终返回前真实撤权/到期需 reached 屏障证明 IP 当前复验拒绝，不能用新 Query 前 revoke 代替。
- **业务快照/freshness：** 两连接 reached Export RR 对比完整 Task/child 旧事实与下一 Export 新事实；P1→H source 变化和 H→P2 alias 变化不得假 FRESH。
- **当前最终 SHA required full：** 浏览器已核实 [CI run 37450952125](https://github.com/qzhike/zhiju-business-core/actions/runs/37450952125)，与 PR 最新 `73378ad` commit 对应；PR 当前 select/checks 成功、persistence/verify 失败。持久化 job 在 `PostgreSQL startup and image verification` 阶段发现 `postgres:18.6` 当前 digest `sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf` 与固定 digest `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722` 不一致，子命令 exit1。失败在 PG 测试之前，不归因于新增测试/产品逻辑；本 SHA required full 无 PASS，新增 PG 用例未执行。需镜像基线条件恢复后的最终被审 SHA 完整成功证据，不能复用旧 SHA 的结果代替。

本轮无新增本地 Unit/PG/controlled/full runs。本地既有固定 pnpm dependency-status/非TTY install 限制未恢复，configured docs 未完成、不记 PASS；正式记录的 Prettier API check/`git diff --check` 仅为独立窄诊断。保持 HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle 与 TD-07 既有排除/延后边界。

### 第十五轮交付

GitHub CLI GraphQL 与 REST 读取均报 `dial tcp 198.18.0.26:443: i/o timeout`（exit1）；有限重试后改用 Edge 原生 UI，成功核对 PR 最新完整 SHA、当前 Issue 与持久化失败日志，不把失败 CLI 请求当作证据。

已通过浏览器发布 [第十五轮普通 PR comment 6014770295](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6014770295)，页面显示本轮完整记录、被审 SHA 和 R10；通过评论 Edit 入口读回原始 Markdown，与准备的完整正文逐字一致（3010 字符），随后 Cancel 退出，不提交额外编辑。发布后 PR 页面最新 commit 仍为 `73378ad`，状态 OPEN。正式记录 Prettier API check 与 `git diff --check` PASS；configured docs 限制如上。

本次为普通 PR comment，技术 outcome REQUEST_CHANGES 不等于 GitHub 正式 Request changes review；未重复发布旧 inline findings。仅更新正式记录与发布 comments，不修改产品代码，不 commit/push/merge。

---

## 第十四轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`908fa210a2107ebc42a6e481d6ea107f52188fb1`；日期：2026-10-06。
- `vibe repo --json`、本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。Issue #248 Acceptance 未调整、无 Issue comments。
- 非盲审：按当前 Issue 原验收、Spec003 §12.2/12.7、Spec001 §15.19、BOARD-D/IP-BOARD-D 预期独立核对本轮实际 diff/测试和 exact-revision CI。相对第十三轮，修改仅涉及 crash recovery 测试、Module-Test 状态和历史正式记录，产品代码未变。

### 第十四轮证据与 finding 对账

- **关闭上一轮 generation 计数的具体断言缺陷。** `generationsBefore` 已在 crash/recovery 前保存；crash 后与 recovery 后都要求基线加1，不能再通过两个 recovery 后查询的恒等式伪证明没有新增 generation。
- **认可恢复验收的新增实现。** crash 后要求无 confirmation、dirty 保持 pending 且 alias 指向已发布 generation；新 owning Task 在未确认窗口产生额外 marker。真实新 pass 重放原 exportId/sequence、replayed=true，确认记录 hash 与持久化 manifest hash 相等，`confirmed_dirty_ids` 与 crash 捕获的非空 covered identities 精确集合相等；剩余 dirty 数量保留额外 marker、generation 数量不增加、alias 保持。后续新 export 才清剩余 dirty 并推进 alias。这些是对实际 worker/非空 dirty 恢复的重要补足，不再把第十三轮已修复的 count/hash/covered-identities 问题列为未实现。
- 当前场景的 alias 是 recovery 后才由下一 export 推进；“alias 已前进再重放旧 export”的证据粒度仍应与既有存储层重放分开，不把本测试扩写为该竞争已经执行。新 PG 用例尚未运行，以上是实现/断言认可，不声称 PG PASS。
- **认可 Module-Test 状态修订。** 已标为 PG PARTIAL，移除重复“worker crash/非空 dirty 未交付”的旧描述，明确剩余状态链、mapping/config、读取中途撤权、Export RR/freshness 与 current full 限制；仍须区分历史已执行子证据和本 SHA 未执行新增 PG 用例。
- 两种 WO 身份、入口 source revoke、先前分页及 executed dirty read 后 owning 提交的既有实现认可保持；已关闭产品缺陷不重开。本轮无新的独立 finding，R10 只保留剩余必要验收及当前运行证据。

[CI run 37448453921](https://github.com/qzhike/zhiju-business-core/actions/runs/37448453921) 的 headSha 精确匹配本轮 SHA；select 选择 full，checks/Verify code 与 Build persistence prerequisites SUCCESS。persistence/Verify persistence、汇总 verify FAILURE：`PostgreSQL startup and image verification` 阶段发现 `postgres:18.6` 当前 digest 为 `sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf`，固定 digest 为 `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`；子命令 exit1。失败在 PG 测试之前，属于镜像基线校验，不能归因于新增恢复测试或产品逻辑，也不证明它们已通过。

当前 SHA required full 未取得 PASS，旧 SHA 成功记录不能替代。本轮没有新增本地 Unit/PG/controlled/full runs；未改变固定镜像或削弱门禁，不重复相同未恢复条件下的失败。本地既有固定 pnpm dependency-status/非TTY install 限制未恢复，configured docs 未完成、不记 PASS；正式记录的 Prettier API check/`git diff --check` 仅为独立窄诊断。

### 第十四轮阻断 finding

#### R10 [P1] 交付剩余原 Acceptance，并取得当前最终 SHA 的 passing full

依据：Issue #248；`.vibe/module-tests/Module-Test-003-TaskExecution.md:650`、BOARD-D-001/004/005/006；IP-BOARD-D-001–003；Spec003 §12 与 Spec001 §15.19。

本轮恢复断言与状态描述的具体修订认可。剩余阻断仍为：

- **完整 owning 状态链。** 正常完成、BLOCKED_INPUT/一次恢复、已有有限取消后，Board 准确返回 Task/WO/blocker/current Evaluation，保持保守未解除窗口；当前创建身份与 crash 用例不能替代这些状态。
- **独立当前权限。** 七项 mapping 的必要正反例、缺 Grant/config 时 protected read/write 为0；首屏/翻页/最终返回前真实撤权/到期。需要 source read 已到达后的 reached 屏障，证明最终返回前 IP 独立 READ COMMITTED 复验拒绝，无 data；现有新 Query 前 source revoke 不是该场景。
- **确定性业务快照与 freshness。** 两连接 reached Export RR 比较完整 Task/child 旧事实与下一 Export 新事实；P1→H source 变化、H→P2 alias 变化均不能假 FRESH。已有 dirty marker/稳定分页/恢复子证据不替代这些明确场景。
- **当前 required full。** 镜像基线条件恢复后提交最终被审 SHA 的完整成功验证证据，并逐场景记录 PG/PARTIAL/NOT RUN。code 成功与静态断言认可均不能替代 full。

这些条件为原任务必要验收；不扩大 HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle 或 TD-07。无需重开已修复的计数断言、WO 身份、分页和历史产品缺陷。

### 第十四轮交付

已发布并读回 [第十四轮普通 PR comment 6014350064](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6014350064)，完整正文与准备内容逐字一致（3313 字符）。发布后远端 head 仍为本轮 SHA，PR OPEN、非 Draft。正式记录的 Prettier API check 与 `git diff --check` PASS；configured docs 未完成，限制如上。

本次为普通 PR comment，技术 outcome REQUEST_CHANGES 不等于 GitHub 正式 Request changes review；未重复发布旧 inline findings。仅更新正式记录与发布 comments，不修改产品代码，不 commit/push/merge。

---

## 第十三轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`a3c9fdda04ff68363312570c381f0ce2946a5530`；日期：2026-10-06。
- 本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。重新核对 Issue #248 原 Acceptance、Spec003 §12/Spec001 §15.19、当前测试 diff 与 exact-revision CI。Issue Acceptance 未调整。
- 非盲审：本轮有历史 finding 上下文，但判断以当前权威预期和实际实现/断言为依据。新增修改仅为 PG 测试、Module-Test 状态与历史正式记录，产品代码未变。

### 第十三轮证据与 finding 对账

| 子项                       | 本轮判断                       | 依据与证据边界                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WO 两种创建事实            | 已补必要实现断言，运行证据待补 | owning 创建 WO@1.0/1.1，AUTHORITATIVE 返回分别核对实际 id 与 `execution.work_order` / `zhiju.execution.work_order`；撤回旧“仅 WO@1.1 正例”的描述                                                                                                                                                                                               |
| 实际 worker crash recovery | 已补实际 pass，验收 PARTIAL    | 在真实 `runTaskBoardExportPass` 的 CONFIRM 授权点抛错；该点位于 Projection publish 提交之后、TE publication proof/dirty confirm 之前。查询已提交 publication outcome，非空 covered dirty 保持 pending；新 pass 断言原 exportId/sequence、replayed=true、dirty 清零、alias 保持原 generation。撤回旧“实际 worker/非空 dirty 场景完全缺失”的描述 |
| Service source Grant 撤销  | 已补入口撤权反例，运行证据待补 | 先成功读取，经 owning revoke 后发起新 AUTHORITATIVE Query，断言 AUTHORIZATION_REVOKED；不是 source 读取已到达后、最终返回前的撤权屏障                                                                                                                                                                                                          |
| 旧分页和 owning dirty 边界 | 维持先前具体缺陷关闭           | G2 后旧 cursor 完整顺序比较/耗尽，executed dirty read 后真实 owning 命令提交的测试保持；不重新发布已关闭分页反例                                                                                                                                                                                                                               |
| R10 剩余原 Acceptance      | 仍为 P1                        | 完整业务状态链、返回前当前权限/七项 mapping、业务 Export RR 与 freshness 屏障尚未交付；当前 SHA 无 passing full/PG 证据                                                                                                                                                                                                                        |
| 其余历史 findings          | 维持原缺陷关闭                 | 无产品代码修改或相关回退证据                                                                                                                                                                                                                                                                                                                   |

[CI run 37437130006](https://github.com/qzhike/zhiju-business-core/actions/runs/37437130006) 的 headSha 精确匹配本轮 SHA。select 选择 full；checks/Verify code SUCCESS、Build persistence prerequisites SUCCESS；persistence/Verify persistence 与汇总 verify FAILURE。失败发生于 `PostgreSQL startup and image verification`：`postgres:18.6` 当前解析 digest `sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf`，固定 digest 为 `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`；persistence 子命令 exit1。当前 head 的 run list 只有此完成失败记录。

这是镜像基线校验失败，不能归因于新增测试/产品逻辑；PG 测试尚未执行，也不能升级为 PASS。旧 SHA 的成功 full 不替代本 SHA。未修改固定镜像/门禁或重试同一失败；本轮无新增本地 Unit/PG/controlled/full runs。本地既有固定 pnpm dependency-status/非TTY install 限制未恢复，不重复确定性失败；configured docs 未完成、不记 PASS。正式记录的 Prettier API check/`git diff --check` 仅为独立窄诊断。

### 第十三轮阻断 finding

#### R10 [P1] 补齐剩余必要验收并取得当前 SHA 的 passing full

依据：Issue #248 原 Acceptance；`.vibe/module-tests/Module-Test-003-TaskExecution.md:650`、BOARD-D-001/004/005/006；IP-BOARD-D-001–003；Spec003 §12.2/12.7、Spec001 §15.19。

本轮 WO 身份、实际发布后 crash/new-pass 与入口 source revoke 认可为已补实现。仍需交付：

- **完整 owning 状态链：** 正常完成、BLOCKED_INPUT/一次恢复、已有有限取消后准确 Task/WO/blocker/current Evaluation；新 WO 身份用例只覆盖创建事实。
- **当前独立权限：** 七项 mapping 的必要正反例及缺 Grant/config 时 protected read/write 为0；首屏/翻页/最终返回前真实撤权、Policy/依赖变化与期限跨越。此次 revoke 在新 Query 之前，不能证明读取中途撤权会在最终返回前由 IP 当前 READ COMMITTED 拒绝。
- **确定性快照与 freshness：** 两连接 reached Export RR 验证完整 Task/child 旧事实及下一 Export 新事实；P1→H source 变化、H→P2 alias 变化不得假 FRESH。既有 dirty marker 边界是有效子证据，不能代替业务行及 freshness 判定。
- **恢复验收收尾：** 新 actual pass 已存在，但需核对原 manifest hash/covered identities，安排 crash 后新增 marker 与更新 alias 的情形，证明只确认原覆盖 identities、不清新 marker、不退已前进 alias。当前仅断言 dirty 总数与原 alias；`generationCountBefore` 和 `after` 均在 recovery 后查询，其 count 等式不能证明 recovery 没有新增 generation。保留已有实际恢复正例，补必要 identity/hash 与竞争断言，不再把它描述为完全未实现。
- **当前运行证据与状态：** 在镜像基线条件恢复后取得本 SHA 或修订后的最终 SHA 的 required full SUCCESS，准确分层记录 PG 结果。Module-Test 状态同时宣称 crash 原 hash/精确 dirty 已有证据、又列 worker crash/非空 dirty 为未交付，与本轮实际 PARTIAL 粒度不一致，应对齐并区分新增测试与已执行验收。

剩余条件来自原验收，不扩大 HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle 或 TD-07。仅更新正式记录并发布 PR comment；不修改产品代码，不 commit/push/merge。

### 第十三轮交付

已发布并读回 [第十三轮普通 PR comment 6013876453](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6013876453)，完整正文与准备内容逐字一致（5632 字符）。发布后远端 head 仍为本轮 SHA，PR OPEN、非 Draft。正式记录的 Prettier API check 与 `git diff --check` PASS；configured docs 未完成，限制如上。

技术 outcome REQUEST_CHANGES 与 GitHub review 状态分开：本次为普通 PR comment，未提交正式 Request changes review，也未重复发布历史 inline comments。仅更新本正式记录与发布 comments；不修改产品代码，不 commit/push/merge。

---

## 第十二轮复核（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`b0806c40c0c71fcd9b8b53ed8fc7308435ba881b`；日期：2026-10-06。
- 重新读取远端 PR head/状态、Issue #248/评论、PR 普通 comments、finding 回复与当前验收矩阵。head 与第十一轮一致，无新实现提交或 finding 回复；工作区仅有上一轮本正式记录的未提交更新。
- 本轮复核当前权威预期与证据，未声称盲审；原 Issue Acceptance 未调整，完整状态链、两种 WO 身份、当前独立权限、确定性快照/freshness 及实际 worker/非空 dirty 崩溃恢复仍未交付，R10 继续为 P1。
- 具体必要验收、已关闭分页反例和 evidence 分层沿用 [第十一轮完整 PR comment](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6009415557)。无新的独立 finding，不重复相同 inline comments。
- 同 revision [CI run 37410374941](https://github.com/qzhike/zhiju-business-core/actions/runs/37410374941) 的 select/checks/persistence/verify 仍 SUCCESS；复用第十一轮已核实的 code/真实 PG full 覆盖，本次无新增本地 Unit/PG/controlled/full runs。
- 已关闭旧缺陷维持关闭。外部/人工、真实 Grant PolicySnapshot replacement lifecycle、TD-07 排除/延后范围不变。
- 本地 configured docs 的既有固定 pnpm dependency-status/非TTY install 限制未恢复，不重复失败、不记 PASS；本记录的 Prettier API check/`git diff --check` 仅为独立窄诊断。
- 已发布并读回 [第十二轮 PR comment 6012408108](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6012408108)，完整正文与准备内容逐字一致；发布后 head 仍为被审 SHA，PR OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；configured docs 限制如上。
- 仅更新本正式记录与发布复核结论，不修改产品代码，不 commit/push/merge。

---

## 第十一轮复审（历史记录，以下结论绑定同一 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`b0806c40c0c71fcd9b8b53ed8fc7308435ba881b`；日期：2026-10-06。
- 本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。Issue #248 Acceptance 未调整，无 Issue comments/finding 回复。
- 非盲审：按当前 Issue、Spec003 §12/Spec001 §15.19 和 BOARD-D/IP-BOARD-D 预期独立核对实际测试/状态文档修订。产品代码未变；原完整 owning/权限/快照/恢复验收不因局部修订改变，排除范围保持。
- 本轮继续按用户要求将完整复审记录发布为普通 PR comment，不重复发布已关闭分页反例的逐行 comment。

### 第十一轮证据

- [CI run 37410374941](https://github.com/qzhike/zhiju-business-core/actions/runs/37410374941) headSha 精确匹配本轮 SHA；select/checks/persistence/verify SUCCESS；Verify code 与真实 PostgreSQL gate PASS，覆盖未变化的 required full workflow。复用，不重复本地 full。
- 当前 walk 逐页要求非空，baseline/after 均断言 exhausted=true，after.ids 与 baseline.ids.slice(1) 逐元素顺序相等，并排除新 Task。因此关闭前轮“空 continuation 仍通过”“漏掉 G1 剩余行仍通过”“循环 cap 未断言耗尽”的具体反例；旧分页缺口不再阻断。
- 当前真实 owning 命令在 export 已执行 dirty read 后提交、原 export 不清该 marker、下一 export 覆盖的证据保持认可。
- 本轮没有新增本地 Unit/PG/controlled runs；当前 exact CI 已覆盖修改后的 PG 用例，产品代码未变，不重复前轮 fix probes。已关闭代码缺陷保持关闭，无相关回退证据。
- 当前 Module-Test 仍明确列出完整状态链、返回前权限与七项 mapping、Export RR/P1→H/H→P2、非空 dirty 的实际 worker crash recovery 未交付，完整 BOARD-D/IP-BOARD-D 矩阵仍 NOT RUN。Issue 原 Acceptance 未调整，分页证据闭合不等于完整任务验收。
- HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle、TD-07 的既有排除/延后边界保持。
- 本地配置 docs 沿用此前确认且未恢复的固定 pnpm dependency-status/非TTY install 限制（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY；此前 Vibe exit21/子命令1），不重复确定性失败、不记配置 docs PASS；Prettier API check/`git diff --check` 为独立窄诊断。

### 上轮 finding 对账

| Finding           | 第十一轮判断           | 当前依据                                                                                                  |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| R10 分页子项      | 关闭第十轮具体断言反例 | 非空逐页、明确耗尽、baseline remainder 精确顺序比较均存在，current PG CI PASS                             |
| R10 剩余必要验收  | 仍为 P1 阻断           | 原 Issue 的状态链、当前独立权限、确定性业务快照/freshness、实际 worker/marker crash recovery 仍明确未交付 |
| 其余历史 findings | 维持原报告缺陷关闭     | 无产品代码修改或相关回退证据                                                                              |

### 第十一轮阻断 finding

#### R10 [P1] 交付剩余原 Acceptance，不再以分页子项代替完整验收

依据：`.vibe/module-tests/Module-Test-003-TaskExecution.md:650`、BOARD-D-001/004/005/006 与 IP-BOARD-D-001–003；Issue #248 原 Acceptance。

认可本轮分页断言修复；剩余阻断只保留尚未交付的必要场景：

- **真实 owning 状态与身份。** 完成/BLOCKED_INPUT/一次恢复/有限取消后，准确 Task/WO/blocker/current Evaluation；两种 WO 创建事实均覆盖，当前仅 WO@1.1 正例不代替 WO@1.0。
- **当前独立权限。** 七项 mapping 的必要正反例、缺 Grant/config protected read/write 为0；首屏/翻页/最终返回前真实 Policy/依赖撤权及期限跨越，旧 TE 快照不能遮蔽 IP 当前变化。
- **确定性快照与 freshness。** 两连接 reached Export RR 证明 Task/child 完整旧事实及下一 Export 新事实；P1→H source 变化和 H→P2 alias 变化均不假 FRESH。现有 owning dirty 计数正例不能代替这些业务行与 freshness 判定。
- **实际 worker 崩溃恢复。** 发布提交后/确认前中断并在新 pass 重放原 export/hash/generation/sequence，非空 covered dirty 精确确认、不清新 marker、不退 alias。已有 storage proof/confirm 与旧 controlled probes 保持其证据粒度，不升级为实际 worker 恢复。

这些是原 Task 的必要 Acceptance；current CI 绿色不能替代未交付场景。请按场景逐项交付并准确维护 PARTIAL/PASS/NOT RUN。无需扩大外部/人工或既有延后 lifecycle 支持集，也无需重开已经关闭的分页反例。

### 第十一轮交付

已发布并读回 [第十一轮普通 PR comment 6009415557](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6009415557)，完整正文与准备记录逐字一致（3252 字符）。发布后 head 仍为本轮 SHA，PR OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成，限制如上。

技术 outcome REQUEST_CHANGES 与 GitHub review 状态分开。本轮为普通 PR comment，未重复提交已关闭分页反例的 inline comments。仅更新正式记录和发布 comments；不修改产品代码，不 commit/push/merge。

---

## 第十轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`ed15fa35085190cd52a347cea388d6f2779ec33e`；日期：2026-10-06。
- 本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。Issue #248 Acceptance 未调整，无 Issue comments/finding 回复。
- 非盲审：按当前 Issue、Spec003 §12/Spec001 §15.19 和 BOARD-D/IP-BOARD-D 预期核对测试与证据 diff。产品代码未变化。原完整状态链、当前权限、固定分页/快照、发布/确认与恢复验收仍有效，排除范围不扩大。

### 第十轮证据

- [CI run 37395864509](https://github.com/qzhike/zhiju-business-core/actions/runs/37395864509) headSha 精确匹配本轮 SHA，select/checks/persistence/verify SUCCESS；Verify code 与真实 PostgreSQL gate PASS，覆盖未变化的 required full workflow。复用，不重复本地 full。
- 分页现在在 G2 发布后跟随旧 cursor 的每个 nextCursor，撤回前轮“G2 后只读一页”的描述。检查无重复、新 Task 不混入和逐页 STALE 是有效进展。
- 当前 assertions 没有期望的完整 G1 IDs/count/order，相比 G2 只要求行数更多。逻辑反例：first continuation 返回 STALE、items=[]、无 nextCursor，seen 仅含首屏；unique/excludes-new/G2含new且更多均通过，剩余 G1 全丢也无法识别。50-page cap 后没有断言 next 消失。该反例为对测试断言的直接独立推导，未执行为产品故障，不声称真实实现正在漏行。
- dirty 测试改为 transformResult 在已执行 dirty read 后暂停，真实 createExecutableTask owning 命令提交后释放，旧 export 完成时 dirty 仍 pending、下一 export 覆盖。认可当前实际 PG owning-producer/dirty 边界，撤回前轮 direct-marker-insert 描述；未由该单 marker 断言升级为业务 Task/child 行 Export RR 完整不混读。
- 本轮没有新增本地 Unit/PG/controlled runs，current exact CI 已覆盖修改后的 PG 用例；产品代码未变，不重复前轮已关闭 fix probes。
- 当前 Module-Test 仍明示完整正常完成/BLOCKED_INPUT/恢复/取消/current Evaluation、最终返回前 Policy/依赖撤权与七项 mapping、Export RR、P1→H/H→P2、非空 dirty 的实际 worker crash recovery 尚未交付；BOARD-D/IP-BOARD-D 完整行仍 NOT RUN。只补分页断言不会关闭这些必要验收。
- HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle、TD-07 的既有排除/延后边界保持。
- 本地配置 docs 仍受此前确认且未恢复的固定 pnpm dependency-status/非TTY install 限制（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY；此前 Vibe exit21/子命令1），不重复确定性失败，当前配置 docs 未完成、不记 PASS。Prettier API check/`git diff --check` 为独立窄诊断。

### 上轮 finding 对账

| Finding           | 第十轮判断                                       | 当前依据                                                                                                                   |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| R10               | 分页循环与 owning dirty 部分改善，必要验收仍阻断 | G2 后真实多页循环与 executed-read owning 提交认可；分页未断言完整期望集合/耗尽，完整状态/权限/确定性快照与 worker 恢复仍缺 |
| 其余历史 findings | 维持原报告缺陷关闭                               | 无产品代码修改或相关回退证据                                                                                               |

### 第十轮阻断 comment

#### R10 [P1] 精确证明 G1 无漏项，并完成剩余原验收

位置：`tests/persistence/task-board-entry.test.ts:547`。

当前 loop 结束后只断言 unique/excludes new，再以 G2 行数更多比较；第一次 continuation 空页并停止仍能通过。请由受控 owning 来源或独立 pinned-G1 baseline 保存完整有序期望 IDs，G2 后遍历集合与该列表精确相等，并断言 cap 退出时 next=undefined，保留 duplicate/new/staleness 规则。

认可 G2 后多页循环和真实 owning producer 在已执行 dirty read 后提交，不再使用旧一页/direct INSERT 描述。#248 的完整 completion/BLOCKED_INPUT/恢复/取消/current Evaluation、两种 WO、返回前 Policy/依赖撤权及七 mapping 负例、Export RR/P1→H/H→P2、原 export/hash/generation/sequence 和非空 dirty 的实际 worker crash recovery 仍须交付。current CI 绿色与本轮局部修订不能替代这些必要场景；保持外部/人工与延后 lifecycle 边界。

### 第十轮交付

已发布并读回 [COMMENT review 5423477118](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5423477118)，state=`COMMENTED`、commit_id 精确匹配本轮 SHA；[R10 P1 comment 4191251048](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4191251048) 已存在。发布后 REST 读回 head 未变化，PR 仍 OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成，限制如上。

发布前 GraphQL/REST/user 读取曾连接超时（dial tcp 198.18.0.26:443: i/o timeout，exit1），浏览器备用通道不可用。有限重试后 POST review 成功，随后 review/comments/head 全部成功读回；未把失败尝试当作发布证据。

用户随后要求将复审记录提交至 PR comment；已将本轮完整记录发布到 [PR comment 6008778177](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-6008778177)，逐字读回比对一致（3788 字符）。发布前远端 head 仍为本轮被审 SHA。此交付为普通 PR comment，原 review 与逐行 R10 comment 均保留。

当前账号为 PR 作者，技术 outcome REQUEST_CHANGES 与 GitHub COMMENTED 状态分开。仅更新本正式记录及发布 comments；不修改产品代码，不 commit/push/merge。

---

## 第九轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`80cc763abd44c9fc04d5bd643c55a89609a96844`；日期：2026-10-06。
- 本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。Issue #248 Acceptance 未调整，无 Issue comments/finding 回复。
- 非盲审：从当前 Issue、Spec003 §12/Spec001 §15.19 和 BOARD-D/IP-BOARD-D 预期独立核对测试/证据修订。产品代码未变；完整 owning 状态、权限、分页、快照/发布/确认及恢复验收仍是预期，不扩大外部/人工或既有延后支持集。

### 第九轮证据

- [CI run 37388375857](https://github.com/qzhike/zhiju-business-core/actions/runs/37388375857) headSha 精确匹配本轮 SHA；select/checks/persistence/verify SUCCESS；Verify code 与真实 PostgreSQL gate PASS，覆盖未变化 full workflow。复用，不重复本地 full。
- 认可本轮真实 PG 双连接技术 dirty 边界：writer BEGIN 并插入 marker 保持未提交，实际 export 查询编译信号 reached 后完成 publish/confirm，然后 writer COMMIT，marker 待处理且下一 export 覆盖。撤回前轮“只是首次 export 结束后才插入、没有并发事务”的描述。
- writer 直接 INSERT 技术 marker，并未驱动 owning business producer/child 写入；该测试是实际 PG marker/确认边界，不提升为完整 owning 业务状态及 Export RR 不混读验收。信号来自 transformQuery，记录其粒度，不当作 SQL 执行后的显式业务读取屏障。
- 分页新增真实 source Task 与 G2 发布，比较一页 resumed IDs 有效。但完整 g1Seen 在 source 变化前已经遍历完；G2 后只查询一次 resumed page，最后排除 newTaskId 的断言仍只看旧 baseline。尚未证明 G2 后原 cursor 全链无漏项/混页/重复；Module-Test“源变化后 G1 全量遍历”应收窄。
- 本轮没有新增本地 Unit/PG/controlled runs；当前 exact CI 已覆盖新 PG 测试，产品代码未修改，不重复前轮 fix probes。已关闭代码反例保持关闭。
- 当前 Module-Test 明示完整状态链、最终返回前 Policy/依赖撤权/七项 mapping、Export RR、P1→H/H→P2 与非空 marker 的实际 worker crash recovery 尚未交付；BOARD-D-001–007/IP-BOARD-D-001–003 完整行仍 NOT RUN。
- HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot replacement lifecycle、TD-07 的既有排除/延后边界保持。
- 本地配置 docs 仍受此前确认且未恢复的固定 pnpm dependency-status/非TTY install 限制（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY；此前 Vibe exit21/子命令1），不重复确定性失败，不记当前配置 docs PASS。Prettier API check/`git diff --check` 为独立窄诊断。

### 上轮 finding 对账

| Finding           | 第九轮判断                              | 当前依据                                                                                            |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| R10               | 技术 dirty 并发部分改善，必要验收仍阻断 | 两连接未提交 marker 窗口认可；G2 后仍只重读一页，完整状态/当前权限/确定性快照与 worker 恢复尚未交付 |
| 其余历史 findings | 维持原报告缺陷关闭                      | 本 head 无产品代码修改，无相关回退证据                                                              |

### 第九轮阻断 comment

#### R10 [P1] G2 发布后遍历完整原 G1 cursor，并补剩余必要验收

位置：`tests/persistence/task-board-entry.test.ts:562`。

529–543 行在 source 变化前就遍历完 baseline；547–548 创建新 Task 并发布 G2 后只重读一页，562 排除 newTaskId 仍只检查旧 baseline。若错误 reader 在更后页混入新 Task，这个测试仍会通过。请保留 baseline，在 G2 后从原首屏 cursor 跟随所有 nextCursor 到结束，完整有序 IDs 与 G1 相等、无重复/漏项/新 Task，且 metadata 正确。当前 Module-Test 全量遍历描述应与该执行粒度对齐。

本轮双连接未提交 dirty 确認正例认可，旧 serial 描述撤回；直接技术 marker 写入不替代真实 owning producer/child Export RR。原 #248 仍缺 completion/BLOCKED_INPUT/恢复/取消/current Evaluation、两种 WO 身份、最终返回前 Policy/依赖撤权与七项 mapping 反例、Export RR/P1→H/H→P2 reached 屏障、实际 worker crash 的原 export/generation/sequence 和非空 dirty coverage 重放。继续补必要验收，保持外部/人工及延后 lifecycle 边界。

### 第九轮交付

已发布并读回 [COMMENT review 5422444197](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5422444197)，state=`COMMENTED`、commit_id 精确匹配本轮 SHA；[R10 P1 comment 4190347129](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4190347129) 已存在。发布后 head 未变化，PR 仍 OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成，限制如上。

当前账号为 PR 作者，技术 outcome REQUEST_CHANGES 与 GitHub COMMENTED 状态分开。仅更新本正式记录及发布 comments；不修改产品代码，不 commit/push/merge。

---

## 第八轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`9b0adfaded9314fdafcc949f4320030f6e89e2ad`；日期：2026-10-06。
- 本地与远端 head 一致；PR OPEN、非 Draft；起始工作区干净。Issue #248 Acceptance 未调整，无 Issue comments/finding 回复。
- 非盲审：已有历史上下文，独立以 Issue 的完整 Board 验收、Spec003 §12/Spec001 §15.19 与当前 BOARD-D/IP-BOARD-D 预期核对实际修订。新增内容只有两项 entry PG 测试、Module-Test 状态和历史 review；没有产品代码变更。
- 预期：真实 owning 状态与完整身份、固定分页/一致性、当前独立权限、导出快照与发布/确认覆盖、真实并发/崩溃恢复同时满足原 Acceptance。保持外部/人工及明确延后边界。

### 第八轮证据

- [CI run 37339116040](https://github.com/qzhike/zhiju-business-core/actions/runs/37339116040) headSha 精确匹配本轮 SHA，select/checks/persistence/verify SUCCESS；Verify code 和真实 PostgreSQL gate PASS，沿用未变化的 full workflow 覆盖。复用，不重复本地 full。
- 当前新增真实 owning WO @1.1 引用用例认可；createWorkOrder helper 未传 commandVersion，默认 @1.1，不能提升为两类 WO 创建身份均已验证。
- 当前新增 dirty serial refresh 用例认可：先完整 export/confirm，再由 admin 直接插入 marker，Projection 返回 STALE，下一 export 确认 marker。该用例没有相互重叠的两个事务或 reached 屏障，created_at 回拨不能证明 marker 在 export 快照时因尚未提交而不可见，不提升为 Issue/BOARD-D-005 的真实晚提交验收。
- 本轮没有新增本地 Unit/PG/controlled runs；产品代码未变化，当前 full CI 已包含新 PG 用例，不重复前轮 fix probes。已关闭旧代码反例保持关闭，无相关回退证据。
- BOARD-D-001–007 与 IP-BOARD-D-001–003 的完整矩阵仍 NOT RUN。正常完成/BLOCKED_INPUT/恢复/取消/current Evaluation、返回前 Policy/依赖撤权、两连接 Export RR、P1→H/H→P2、真实 late commit 与实际 worker/marker crash recovery 尚未交付。上一轮 source 未变的两页例和 coveredDirtyIds=[] 的 storage recovery 例仍不能证明完整验收。
- Module-Test 新状态明确列出部分未交付项，这是有效分层进展；其中“晚提交 dirty”应收窄到当前 serial insert/refresh 证据，不把时间戳回拨当并发。
- 既有 HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot 取代 lifecycle、TD-07 延后边界不变。
- 本地配置 docs 仍沿用已查明但未恢复的固定 pnpm dependency-status/非TTY install 限制（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY；此前 Vibe exit21/子命令1），不重复确定性失败，当前记录的配置 docs 未完成、非 PASS。Prettier API check/`git diff --check` 是独立窄诊断，不替代 configured gate。

### 上轮 finding 对账

| Finding           | 第八轮判断               | 当前依据                                                                                                                          |
| ----------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| R10               | 部分修复，必要验收仍阻断 | 新增 WO @1.1 引用与 serial dirty refresh 认可；未证明 concurrent late commit，完整状态链/当前权限/确定性并发/实际 worker 恢复仍缺 |
| 其余历史 findings | 维持原报告缺陷关闭       | 本 head 无产品代码修改，无相关回退证据                                                                                            |

### 第八轮阻断 comment

#### R10 [P1] 用真实并发 owning 事务补齐剩余验收

位置：`tests/persistence/task-board-entry.test.ts:522`。

新增用例在 await 完整 export/confirm 后才直接插入 dirty 行，仅回拨 created_at；没有 writer 持有未提交 owning 变更/marker，也没有证明 export reached 快照读取边界，不能代表尚未提交的 dirty identity 在旧快照中不可见、确认后才提交的竞态。请用 owning producer 与第二连接：保持 writer 未提交→证明 export reached 快照/读取点→旧 export 发布/确认且不覆盖该 identity→提交 writer→marker 仍待处理→下一 export 覆盖。当前 identity 确认模型保持，不要求引入 marker sequence 列。

其余原 Acceptance 仍缺完整 completion/BLOCKED_INPUT/恢复/取消/current Evaluation、两种 WO 创建事实、最终返回前 Policy/依赖撤权及七项独立 mapping 正反例、Export RR/P1→H/H→P2 reached 屏障、source 更新下完整 G1 分页、带非空 marker 的实际 worker crash recovery。current CI 绿色不能替代必要验收。请按实际 focused/PARTIAL 粒度对齐 Module-Test 状态，继续排除明确延后的外部/人工/lifecycle 支持集。

### 第八轮交付

已发布并读回 [COMMENT review 5421775172](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5421775172)，state=`COMMENTED`、commit_id 精确匹配本轮 SHA；[R10 P1 comment 4189810784](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4189810784) 已存在。发布后 head 未变化，PR 仍 OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成，限制如上。

当前账号为 PR 作者，技术 outcome REQUEST_CHANGES 与 GitHub COMMENTED 状态分开。仅更新本正式记录及发布 comments；不修改产品代码，不 commit/push/merge。

---

## 第七轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`328b5c499a19d5b8f098ce817b7a0727cff7546c`；日期：2026-10-05。
- PR OPEN、非 Draft；Issue #248 Acceptance 未调整、无 comments/finding 回复。本地与远端 head 一致，起始工作区干净。
- 非盲审：已有历史上下文，按当前 Issue、Spec003 §12、Spec001 §15.19、API/PG IM06-BOARD 和实际 diff 独立核对。旧问题关闭以本轮具体反例和证据为准，范围不扩大。

### 第七轮证据

- [CI run 37313254182](https://github.com/qzhike/zhiju-business-core/actions/runs/37313254182) headSha 精确匹配本轮 SHA；select/checks/persistence/verify SUCCESS。Verify code 包含 clean，Verify persistence 经过 clean/build prerequisites，覆盖 required full 的 code 与真实 PG gate；复用，不重复本地 full。
- Focused Unit：`node node_modules/vitest/vitest.mjs run modules/task-execution/src/business/task-board-read.test.ts modules/task-execution/src/business/task-board-cursor.test.ts modules/identity-policy/src/commands/task-board-authorization.test.ts modules/identity-policy/src/commands/task-board-source-hash.test.ts`：4 files / 33 tests PASS。
- 独立 fix probe：`node node_modules/vitest/vitest.mjs run .review-pr249-round7-probe.test.ts`：1 file / 3 cases PASS。有效 AUTH zero sequence 往返；前轮合法签名 AUTH sequence=1 现在报 QUERY_CURSOR_INVALID；outcome-derived 原 A publication tuple 在当前 B 下确认原 export/generation/sequence，retire/publish 为0。
- composition probe 的 recovery tuple 为 mocked input；只证明真实 worker 的控制流。tuple 来自 Projection outcome 且没有 TE proof 的实际 storage 读取/记录/确认，由本 head 新增 PG 测试及 exact CI 另行证明；不合并宣称真实 worker crash、Policy lifecycle 或 dirty 恢复已验收。临时诊断移出产品集合。
- 新增真实 v1/v2 Task 身份、SNAPSHOT_AT_LEAST 成功/最低水位未达、alias 变更后两页无重复的 focused entry PG 用例认可。分页例没有 G1→G2 间 owning source 变化，未遍历完整 G1 集合；因此不提升为完整无漏项验收。
- 完整 BOARD-D/IP-BOARD-D 状态链、返回前当前权限、确定性 Export RR/late dirty/worker 与 marker crash recovery 仍未完成。完整矩阵仍 NOT RUN；本轮未新增本地 PG。HTTP/UI/Provider/生产/性能/独立人工、真实 Grant PolicySnapshot 取代 lifecycle 和 TD-07 等延后边界保持。
- 本地配置 docs 沿用已查明但未恢复的固定 pnpm dependency-status/非TTY install 限制（ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY；此前 Vibe exit21/子命令1），不重复确定性失败，当前记录的配置 docs 未完成、非 PASS。Prettier API check/`git diff --check` 是独立窄诊断。

### 第六轮 findings 对账

| Finding           | 第七轮判断                               | 当前依据                                                                                                                                                   |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7                | 关闭原非法 AUTH sequence 接受反例        | decode 新增 sequence=0 检查；合法零值正例与前轮签名非零负例独立通过                                                                                        |
| R14               | 关闭原 publish→proof + Policy 更新死循环 | SQL recovery 加入精确 Project/export/hash 的不可变 Projection outcome；已有 tuple 的 worker confirmation 路径不退役、不重发布；实际 storage 正例由 CI 证明 |
| R10               | 部分修复，必要出口仍阻断                 | 新增两项 entry 与 proof-gap storage 例认可；剩余真实状态链、确定性并发、当前权限及 worker/marker 恢复未交付                                                |
| 其余历史 findings | 维持原报告缺陷关闭                       | 当前修订无相关回退证据；不据此声称完整业务矩阵通过                                                                                                         |

### 第七轮阻断 comment

#### R10 [P1] 补齐剩余必要 owning/并发/恢复验收

位置：`tests/persistence/task-board-entry.test.ts:465`。

新增真实 v1/v2 Task、SNAPSHOT_AT_LEAST 成功/未达水位、alias-change 两页与实际 Projection outcome 无 TE proof 的 PG 用例有效，撤回“entry 只有三例”的前轮描述。当前 #248 仍要求完成/BLOCKED_INPUT/恢复/取消/current Evaluation 与两种 WO 创建事实、七项 mapping 正反例及最终返回前依赖/Policy 撤权、reached 两连接 Export RR、低序号 dirty 晚提交、实际 dispatcher crash 原 export/hash/generation/sequence 与 covered marker 恢复；完整 BOARD-D/IP-BOARD-D 未完成，Acceptance 未变。

当前分页例只是源未变时重导并断言两页无重叠，未证明 source 更新后的完整 G1 无漏项遍历；新增 proof-gap storage 用例 coveredDirtyIds=[]，直接 reader/proof/confirm，未驱动 worker/Policy 变化/dirty 恢复。请补剩余确定性 owning/PG 场景，按真实执行粒度维护 PASS/PARTIAL；exact CI 与 focused 正例不可替代必要验收。不扩大外部/人工或既有延后 lifecycle 范围。

### 第七轮交付

已发布并读回 [COMMENT review 5417021454](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5417021454)，state=`COMMENTED`、commit_id 精确匹配本轮 SHA；[R10 P1 comment 4185822811](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4185822811) 已存在。发布后 head 未变化、PR 仍 OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成、限制如上。

当前账号是 PR 作者，技术 outcome REQUEST_CHANGES 与 GitHub COMMENTED 状态分开。仅更新本正式记录及发布 comments；未改产品代码，不 commit/push/merge。

---

## 第六轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`34c832fd577734841a69c85a20a01acba2ebf39d`；日期：2026-10-05。
- 最新 PR OPEN、非 Draft；Issue #248 的 Acceptance 未调整，无新 finding 回复。工作区起始干净。
- 范围：按 Issue 的完整 Board 交付、Spec003 §12、Spec001 §15.19、API/PG IM06-BOARD 独立审查修订。认可可证实修复，保留必要 owning/分页/三 consistency/权限/恢复验收，不扩大公开 Schema、HTTP/UI/Provider/性能/人工或明确延后范围。
- 非盲审：已有历史上下文，重新以当前权威、实际 diff 和 exact-revision 证据判断。没有修复产品代码。

### 第六轮证据

- [CI run 37279832242](https://github.com/qzhike/zhiju-business-core/actions/runs/37279832242) 的 headSha 精确匹配本轮 SHA；select/checks/persistence/verify 全部 SUCCESS，Verify code 与真实 PostgreSQL gate 完整覆盖 required full。复用，不重复本地 full。
- Focused Unit：`node node_modules/vitest/vitest.mjs run modules/task-execution/src/business/task-board-read.test.ts modules/task-execution/src/business/task-board-cursor.test.ts modules/identity-policy/src/commands/task-board-authorization.test.ts modules/identity-policy/src/commands/task-board-source-hash.test.ts`：4 files / 33 tests PASS。
- 独立 probe：`node node_modules/vitest/vitest.mjs run .review-pr249-round6-probe.test.ts`：最终 1 file / 6 cases PASS。证明批准的全部 byte offsets/最大安全 sequence 往返；AUTH sequence=1 仍签发并接受；旧未发布 Policy A 退役后按 B 新导出；实际 fence token/owner/deadline 及 confirm 结果绑定；已有 TE proof 的旧 Policy export 只确认、不重发布；Projection outcome 已提交但 TE proof 缺失且 Policy 更新时连续两次 forbidden retirement、publish/confirm 均为 0。
- probe 初次运行因审查 fixture 缺当前 reader 返回的顶层 policyObservation，3 cases 失败；补齐该 fixture 后重跑全部通过。该失败不是产品 finding。临时诊断移出产品测试集合。
- worker probe 使用 mocked dependencies，只证明真实 composition 的调用次序/参数；不声称真实 Grant lifecycle 或 PG crash recovery 已执行。断言缺陷存在的 PASS 不是业务验收 PASS。
- 当前 PG 用例认可：proof 已登记但 ack 未完成的 recovery tuple/confirm、未发布退役与拒绝退役已发布 export、删除 title 的精确 SQL-row guard 负例。最后一项关闭前轮对该具体 SQL 负例的证据要求。已发布但未登记 TE proof 的 retirement 拒绝也由当前 PG 用例直接覆盖，反向支持 R14 的 crash-window 诊断。
- 完整 BOARD-D/IP-BOARD-D owning 状态链、三 consistency、返回前撤权、Export RR/late dirty、worker 崩溃与 marker 恢复矩阵仍 NOT RUN。本轮未新增本地 PG；外部/人工与明确延后边界保持。
- 本地配置 docs 沿用已查明的环境限制：固定 pnpm 11.19.0 的 dependency status 要求 install，非 TTY 触发 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`（既有 Vibe exit 21、子命令 exit 1）；本轮依赖配置/运行环境未恢复，不重复确定性失败，当前记录的配置 docs 仍未完成、非 PASS。独立 Prettier/`git diff --check` 不替代该 gate。

### 第五轮 findings 对账

| Finding                      | 第六轮判断                                                  | 当前依据                                                                                                         |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R1/R3/R4/R5/R6/R8/R9/R11/R12 | 维持已关闭                                                  | 无相关回退证据；新增精确 SQL-row title 删除负例认可                                                              |
| R2                           | 关闭上一轮未发布旧 Policy 复选问题                          | current hash 不同则退役未发布旧 export 并新导出；已发布但 proof 缺失的剩余窗口归 R14                             |
| R7                           | 布局与安全 uint64 范围关闭；AUTH 全零规则部分修复           | 最大安全 sequence 与全部批准 offsets 成立；AUTH 非零 sequence 仍接受                                             |
| R10                          | 部分修复、必要验收仍未完成                                  | 新增三项 focused PG 认可；entry 文件仍仅三例，完整矩阵 NOT RUN                                                   |
| R13                          | 关闭上一轮实际字段遗漏                                      | CLAIM owner、publish Policy/retention/完整 fence、CONFIRM generation/sequence/token 均绑定；关闭仅针对原报告缺陷 |
| R14                          | proof→confirm 漏选已修复；publish→proof + Policy 更新仍阻断 | recovery 只看 TE proof，retirement 却正确看独立 Projection outcome，组合产生永久复选失败                         |

### 第六轮阻断 comments

#### R14 [P1] 恢复实际已发布但 TE proof 缺失的 export

位置：`apps/api/src/composition/task-board-dispatcher.ts:207`。

上一轮 proof commit→confirm 前的窗口已通过独立 confirmation 状态修复，应撤回该原反例。剩余合法顺序：Policy A 下 E1/G1 的 Projection outcome 提交→worker 在 TE recordTaskBoardPublication 前崩溃→Policy B 生效→新 pass 读取 E1。V7014:536 的 recovery reader 仅 LEFT JOIN TE proof，返回 generationId/publishSequence=null，worker 因旧 A 与当前 B 不同进入 retire；但 SQL 574–579 正确读取 Projection outcome，拒绝 `TASK_BOARD_EXPORT_ALREADY_PUBLISHED`。manifest 未确认、未退役，后续 pass 永远选中同一 E1，无法确认原 covered dirty 或开始新导出。

controlled composition probe 连续两次重现 retire 报错，publish/confirm 均 0；当前 PG retirement 用例还直接证明没有 TE proof 的实际已发布 export 不可退役。请通过 owning 边界恢复独立不可变 publication outcome，沿用原 E1/hash/G1/sequence 完成 proof/确认；用实际 PG/dispatcher publish commit 后、TE proof 前的 reached 崩溃及 Policy replacement 正例证明恢复。继续禁止退役已发布 export，保持 Spec003 §12.7/#248 的 alias 与 dirty 保证。

#### R7 [P2] AUTH sequence 仍需全零

位置：`modules/task-execution/src/business/task-board-cursor.ts:255`。

批准 offsets 与 uint64 安全整数范围已修复，不再报告旧布局/uint32 问题。但 AUTH decoder 只校验 generation/hash 全零；encoder 在 offset118 无条件写 claims.watermarkSequence。独立 codec probe 以 AUTHORITATIVE、无 generation/hash、sequence=1 签发后，成功 decode 为 AUTHORITY/sequence=1。Spec003 §12.6 明确 AUTH generationId/manifestHash/sequence 均全零且还原空水位。请编码拒绝矛盾 AUTH claims，解码拒绝合法签名的非零 AUTH sequence，保留零值正例与 Projection 安全整数边界。该结论是协议 canonical 规则违背，不声称无 Secret 客户端能伪造签名。

#### R10 [P1] 完成原 Issue 的必要 owning 与恢复验收

位置：`tests/persistence/task-board-entry.test.ts:369`。

本轮三项新增 PG focused 正反例和 exact-head CI 有效；撤回该单字段 SQL-row 负例缺失的前轮描述。entry 文件与第五轮 head 相同，仍仅 Task v2 DRAFT/READY 的 AUTHORITATIVE、export/PROJECTION_OK 和初始 Human revoke 三例。#248 已要求的真实 v1/v2 Task 与两种 WO 创建身份、完成/BLOCKED_INPUT/恢复/取消/current Evaluation、G1→G2 多页、SNAPSHOT_AT_LEAST、最终返回前依赖/Policy 撤权、两连接 reached Export RR、低序号 dirty 晚提交和实际 dispatcher 崩溃重放尚未交付。新的 storage recovery 用例 coveredDirtyIds=[] 且直接 reader/confirm，没有证明 worker/marker 恢复。完整 BOARD-D/IP-BOARD-D 仍 NOT RUN，Acceptance 未调整。请补现有必要 owning 正链、确定性并发与恢复，分开记录 Application/PG/controlled；不扩大明确排除的外部/人工与延后范围。

### 第六轮交付

已发布并读回 [COMMENT review 5412105288](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5412105288)，state=`COMMENTED`、commit_id 等于本轮 SHA；共 3 条代码 comments（2 项 P1、1 项 P2）：[R14](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4182237071)、[R7](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4182237084)、[R10](https://github.com/qzhike/zhiju-business-core/pull/249#discussion_r4182237097)。发布后 head 未变化，PR 仍 OPEN。正式文档 Prettier API check 与 `git diff --check` PASS；配置 docs 未完成，限制如上。

当前账号为 PR 作者，以 COMMENT review 保留技术 outcome `REQUEST_CHANGES`，不混同 GitHub Request changes 状态。仅更新正式记录和 GitHub comments，不改产品代码，不 commit/push/merge。

---

## 第五轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`8403eecd0a347ab0895de6bf1c4321f5bf848ad8`；日期：2026-10-05。
- 最新 PR OPEN、非 Draft；Issue #248 原 Acceptance 未调整，无 finding 回复。工作区起始干净。
- 预期与范围：继续以当前 Issue、Spec003 §12、Spec001 §15.19、API 字段矩阵/PG IM06-BOARD 判断真实完整 Board、当前独立权限、有限配置、固定分页、精确导出/发布/确认恢复与明确必要验收；公开 Schema、Set/数组及旧 registry/fixture 不改。外部/人工及明确延后范围不扩大。
- 非盲审：已有历史审查上下文，重新从权威标准、当前 diff 和 revision 证据独立判断；未承担实现或修改产品代码。

### 第五轮证据

- [CI run 37270134991](https://github.com/qzhike/zhiju-business-core/actions/runs/37270134991) 的 headSha 等于上述被审 SHA；select/checks/persistence/verify 全部 SUCCESS，code 与真实 PostgreSQL gate 完整覆盖 full；复用，不重复本地 full。
- Focused Unit：`node node_modules/vitest/vitest.mjs run modules/task-execution/src/business/task-board-read.test.ts modules/task-execution/src/business/task-board-cursor.test.ts modules/identity-policy/src/commands/task-board-authorization.test.ts modules/identity-policy/src/commands/task-board-source-hash.test.ts`：4 files / 31 tests PASS。
- 独立 probe：`node node_modules/vitest/vitest.mjs run .review-pr249-round5-probe.test.ts`：1 file / 5 cases PASS。验证前118-byte来源字段/key offset改善、uint32边界负例、AUTH非零序号仍接受；确认旧 R2 撤权时不再 publish；不同完整 versionRef 的 pending Policy A + current Policy B 会产生不一致 publish 输入；同一 pending export/hash 更换实际 fence token，publish Decision payload 不变。
- worker probe 使用 mocked dependencies，只证明真实 composition 调用次序/输出参数，不声称实际 Grant lifecycle、SQL publication 或 PG 恢复已经执行。断言缺陷存在的 PASS 不升级业务验收。临时诊断移出产品集合。
- 本 head 新增 publisher reached 信号与 pending manifest 读取的 CI PG 证据认可；本轮没有新增本地 PG。R14 两次已提交技术事务之间的恢复问题由当前 SQL/function/composition 直接核对。
- 完整 BOARD-D/IP-BOARD-D owning 状态链/三 consistency/返回前撤权/Export RR/late dirty/崩溃恢复矩阵仍 NOT RUN；HTTP/UI/Provider/性能/人工和既有延后边界保持。
- 本地配置 docs：以已安装项目固定 pnpm 路径运行 `vibe verify docs --json`，仍在 dependency status 要求 install 后以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止（Vibe exit 21，子命令 exit 1）。未改依赖、锁文件或 verifier，docs 不记 PASS；Prettier 和 `git diff --check` 独立文档诊断不替代配置门禁。

### 与上一轮对账

| Finding            | 第五轮判断                                           | 当前依据                                                                             |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| R1/R5/R6/R8/R9/R11 | 维持原缺陷关闭                                       | 无相关回退证据                                                                       |
| R2                 | 原撤权 publish 反例已修复；pending Policy 恢复仍阻断 | publish 前二次 owning Policy 解析有效；未核对 pending 原 Policy/提供失效后新导出出口 |
| R3                 | 关闭包含关系缺陷                                     | SQL manifest element 改用全 row JSONB 相等；相应真实单字段负例覆盖归 R10             |
| R4                 | 关闭当前 alias/retained generation 依赖              | proof 仅核对独立不可变 outcome；实际崩溃恢复缺口另见 R14/R10                         |
| R7                 | 部分修复                                             | 前118-byte/完整源字段/部分AUTH零值规则修正；uint32序号与尾部布局不符批准契约         |
| R10                | 部分修复、必要出口仍未完成                           | 新增 reached信号/manifest读取认可；真实入口文件未新增完整状态链及恢复验收            |
| R12                | 关闭 AUTH health 耦合                                | 签发、最终重验和来源hash只在实际 health 路径使用                                     |
| R13                | 部分修复                                             | 各步 own Decision/source预分配exportId已实现；完整fence/owner/confirm结果尚未绑定    |
| R14                | 新增阻断                                             | publication proof commit 后但 dirty confirm 前的崩溃被 pending reader 漏选           |

### 第五轮阻断 comments

#### R2 [P1] 对 pending manifest 的原 Policy 判定资格并提供重新导出出口

位置：`apps/api/src/composition/task-board-dispatcher.ts:244`。

新增的第二次 resolvePolicy 已挡住上一轮“record manifest 后撤权仍 publish”的反例，应认可修复。但 pending 分支取出的 manifest 可能属于旧 Policy A；这里比较的却只是本次两次解析得到的当前 Policy B，未与 pending.policyObservation/policyRef 比较。之后 publish 输入沿用 A 的 manifest/hash，同时传 B 的 policyObservation（279 行）和 TTL。独立 controlled probe 使用不同完整 versionRef 的 A/B，确认两次 resolver 均返回 B 时仍进入 publish，输入 manifest 为 A、promoted observation 为 B；V7015 的完整镜像 guard 将拒绝它。pending SQL 又会在每次 pass 继续选中同一未发布 A，worker 无法按新合法 B 重新导出，Project 长期停在旧 alias/dirty。请按 Spec003 §12.7 先核对持久 manifest 的完整原 Policy observation/current 资格；失效时保留失败/dirty，但用新合法 Policy 和新 exportId 重导，避免永久复选。补正常同 Policy 重放与旧 Policy 失效后的实际 owning/PG 恢复正反例。

#### R7 [P2] 保留批准的 uint64 安全序号范围与字节布局

位置：`modules/task-execution/src/business/task-board-cursor.ts:104`。

keyId/requestBindingHash/sourceFingerprint/generation/manifest 的前 118 bytes 已修正，Projection 完整来源字段和 AUTH generation/hash 零值检查也已新增。但这里把 publish sequence 缩为 uint32，直接拒绝合法安全整数 4294967296；SQL 允许序号直到 9007199254740991，Spec003 §12.6 明确 watermarkSequence:uint64。独立配对 probe：4294967295 往返成功，4294967296 编码报 API_VALUE_INVALID；有更多 filtered rows 的该 generation 将无法返回合法 Page。尾部还塞入 pageSize/consistency/flags并重排时间，仍不是批准的 sequence[118..125]/snapshotAt[126..133]/lastTaskId[134..149]/issuedAt[150..157]/expiresAt[158..165] 布局；这些请求字段已绑定在 requestBindingHash，无需挤掉 uint64。另外 AUTH watermark=1 的合法签名编码仍被接受，违反 AUTH sequence 全零规则。请落实完整批准格式及安全整数边界/全零负例，不能用同为 198 bytes 替代协议一致。

#### R10 [P1] 交付 Issue 的真实状态链和完整恢复验收

位置：`tests/persistence/task-board-entry.test.ts:368`。

认可新增 publisher reached 信号与 pending manifest 读取的同 head CI 证据；撤回上一轮“只有固定 sleep”和“worker 完全没有 persisted manifest 路径”的描述。但 entry 测试本轮没有新增，仍只有 Task v2 DRAFT/READY、Projection、首页 Human revoke 三例。#248 明确要求的真实 v1/v2+WO 两类创建身份、正常完成/BLOCKED_INPUT/恢复/取消/current Evaluation、G1→G2 多页、SNAPSHOT_AT_LEAST、返回前撤权、Export RR、低序号 dirty 晚提交及崩溃后原 export/generation/sequence 重放尚未交付。新的 PG pending 例只验证 reader 前后返回值，不驱动 dispatcher 从崩溃中恢复；也没有独立覆盖新 SQL 精确行相等 guard 的单字段删除负例。BOARD-D/IP-BOARD-D 仍 NOT RUN，Issue Acceptance 未调整。请补当前任务必要 owning 正链、确定性并发和恢复验收并准确分层记录；不扩大 HTTP/UI/Provider/性能/人工或既有延后范围。

#### R13 [P1] publish 和 confirm 的 Decision 仍需绑定实际 fence 与完整步骤字段

位置：`apps/api/src/composition/task-board-dispatcher.ts:255`。

按步骤签发 Decision、source 预分配 exportId、manifestHash/coveredDirtyIds 入 hash 是有效修复；原先“四项共用一个 {projectRef} hash”已不成立。但 publish payload 此处仍只有 projectRef/exportId/manifestHash，实际 fence.token/ownerPrincipalId/leaseUntil、固定 policyRef 与 retention 均未绑定；CLAIM 缺实际 owner，CONFIRM 的 payload 也缺实际 generationId/publishSequence/leaseToken。独立 controlled probe 用同一合法 pending export/hash、token 1 和 token 2 分别执行，实际 publish fence 不同而签发 payload 完全相同。Spec001 §15.19 要求这些操作实际使用字段的完整闭合意图，不能在签发后添加未绑定的 fence。请先形成实际技术输入再签发/重验自己的完整 payload，补仅替换 fence/owner/publication result 时 protected write 为 0 的 owning 负例；同 operation/target 与新签发 Decision 不能代替完整输入绑定。

#### R14 [P1] publication proof 已提交但 dirty 尚未确认的 export 仍需恢复

位置：`migrations/task_execution/V7014__task_board_dirty_and_dispatch.sql:475`。

新 pending selector 把 task_board_export_publication 是否存在当成恢复完成，但 dispatcher 的 recordTaskBoardPublication 与 confirmTaskBoardExport 是两个独立已提交事务。合法崩溃点：publish G1→record publication proof 成功→confirm 之前崩溃。此时 covered dirty 仍存在，该 NOT EXISTS 却已排除 E1；下次 worker 进入 fresh export 分支，生成 E2/G2，不能按 #248/Spec003 §12.7 规定重放原 E1/hash/generation/sequence 来完成确认。新的测试只在完整 confirm 后断言不再 pending，没有覆盖这个两步间窗口。请分别持久化/判断“已发布”和“已确认”进度，让 proof 存在但 ack 未完成的 manifest 仍可恢复确认；用在 proof commit 后 reached 的实际 PG/dispatcher 崩溃恢复证明同 export/sequence、alias 不回退、marker 不丢。当前恢复出口只能覆盖 proof 提交前的中断。

### 第五轮交付

已发布并读回 [COMMENT review 5411063583](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5411063583)，state=`COMMENTED`，commit_id 等于被审 SHA；R2/R7/R10/R13/R14 共 5 条代码 comments（4 项 P1、1 项 P2）已存在。发布后 head 未变化，PR 仍 OPEN。正式文档 Prettier 与 `git diff --check` PASS，配置 docs 运行限制如上，未记 PASS。

当前账号为 PR 作者，`REQUEST_CHANGES` 是 Reviewer 技术结论，与 GitHub COMMENTED 状态区分。仅更新本正式记录与 GitHub comments，不改产品代码，不 commit/push/merge。修复后按最新 head 复审。

---

## 第四轮复核（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`5ac169d420fa15507e77227f90e79608945680bb`；日期：2026-10-05。
- 本次重新读取远端 PR head、Issue #248 与评论、审查 comments 和相关当前代码。head 与第三轮相同，无新的实现提交或 finding 回复；工作区仅有本正式审查记录的未提交更新。
- 重新核对 R2/R3/R4/R7/R10/R12/R13：仍为 5 项 P1、2 项 P2。具体边界与修复要求见下面第三轮记录及其 GitHub 逐行 comments；本次未发现或发布新的独立 finding。
- 同 revision [CI run 37253911056](https://github.com/qzhike/zhiju-business-core/actions/runs/37253911056) 仍 SUCCESS。复用第三轮 4 files/31 Unit 与 1 file/3 focused probe 证据，本次不重复运行；新增 PG/端到端验收 NOT RUN，既有本地 docs 工具链限制未变化，不重试或记为 PASS。
- GitHub 交付：已发布并读回 [复核 PR comment 5987906055](https://github.com/qzhike/zhiju-business-core/pull/249#issuecomment-5987906055)，包含 reviewed SHA、REQUEST_CHANGES 和已有 7 条逐行 comments 链接。发布后 head 未变化，PR 仍 OPEN。未修改产品代码，不 commit/push/merge。

---

## 第三轮复审（历史记录，以下结论绑定同一 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`5ac169d420fa15507e77227f90e79608945680bb`。
- 日期：2026-10-05；Issue #248，T2；PR 为 OPEN、非 Draft。
- 范围与预期：按最新 Issue 的稳定验收及 Spec003 §12、Spec001 §15.19、API/PG IM06-BOARD 独立核对最新修订。真实 Task/WO/blocker/Completion 分层、完整 QueryResult、精确过滤与固定分页、实际使用 mapping 的当前授权、当前 Policy、完整导出/发布/确认/恢复应同时成立。公开契约与旧基线保持；HTTP/UI/Provider/性能/人工与明确延后范围不扩大。
- 非盲审：已有两轮上下文，重新以当前权威和 actual diff 评判；未承担实现或修改产品代码。

### 本轮验证证据

- [CI run 37253911056](https://github.com/qzhike/zhiju-business-core/actions/runs/37253911056)：headSha 精确等于上述被审 SHA；select/checks/persistence/verify 均 SUCCESS。workflow 选择 full，code 与 PostgreSQL gate 已覆盖；复用证据，不重复本地 full。
- Focused Unit：`node node_modules/vitest/vitest.mjs run modules/task-execution/src/business/task-board-read.test.ts modules/task-execution/src/business/task-board-cursor.test.ts modules/identity-policy/src/commands/task-board-authorization.test.ts modules/identity-policy/src/commands/task-board-source-hash.test.ts`：4 files / 31 tests PASS。
- 独立 focused probe：`node node_modules/vitest/vitest.mjs run .review-pr249-round3-probe.test.ts`：1 file / 3 cases PASS。确认毫秒与受信 expiry；直接验证 keyId 不在批准 offset；验证合法签名但 AUTH generation bytes 非零的编码被接受；controlled source-level worker 在 record manifest 后 Policy resolver 失效仍 publish/confirm，解析只有一次。mocked dependency 只证明实际 composition 调用次序，不是实际 Grant lifecycle/PG 撤权证据；断言缺陷成立的 PASS 也不是业务验收 PASS。
- 新增 hash/mirror、未发布 proof 与锁到期负例认可为该 head CI 的实际 PostgreSQL focused 证据；锁等待用例只有固定 sleep，没有 publisher reached 证明，不提升为确定性 reached-barrier 验收。
- R3/R4/R12/R13 的具体边界由当前 source/SQL/契约核对；本轮未新增本地 PostgreSQL 运行。完整 BOARD-D/IP-BOARD-D 正链、确定性并发/恢复及外部/人工仍按实际 NOT RUN。
- 临时诊断已移出产品测试集合，工作区只交付正式审查文档。
- 本地正式文档：Prettier check 与 `git diff --check` PASS；配置 `vibe verify docs --json` 未完成：默认 pnpm 的 11.19.0 切换在 registry fetch/signature 阶段失败（Vibe exit 21，子命令 exit 1）。只读 preflight 找到可执行固定版本后，将其加入本次 PATH 重试；pnpm 在 dependency status 检查时要求 install，并以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止（同样 exit 21/1）。该失败为本地工具链/依赖运行限制，未修改依赖、锁文件或 verifier；不记作 docs PASS，也不替代/否定被审 head 的完整 CI。

### 上轮 finding 对账

| Finding     | 第三轮判断                                 | 本轮依据                                                                                                                                                  |
| ----------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1/R6/R8/R9 | 维持原缺陷已修复                           | 当前修订无相关回退证据                                                                                                                                    |
| R2          | 部分修复                                   | 专用 Policy mapping、Query 最终 Decision 重验及 maintenance 解析新增；worker protected publish 前仍不重验 Policy，payload 另见 R13                        |
| R3          | 部分修复                                   | SQL canonical hash 与 promoted mirror 新增；row 使用包含判断，非完整相等                                                                                  |
| R4          | 原伪造反例已修复；恢复仍阻断               | 独立 outcome 校验新增；当前 alias/generation JOIN 拒绝合法历史重放                                                                                        |
| R5          | 关闭原锁等待取时缺陷                       | 数据库时间移至 fence 锁之后且切 alias 前再次检查；reached 验收缺口归 R10                                                                                  |
| R7          | 期限与完整 digest 缺陷关闭；协议仍部分修复 | authority/Projection 保留原期限，完整 HMAC/binding/evidence；字节布局及 Projection sourceFingerprint 仍不符批准格式                                       |
| R10         | 未完成                                     | 新增 focused PG 不代替 Issue 完整 owning/恢复验收                                                                                                         |
| R11         | 关闭原 selected Grant 身份缺失             | owning revalidation 返回实际 selectedGrant，grant id/Scope/actions/selectors/Policy snapshot/aggregateVersion 纳入 hash；更换 Grant 与同来源稳定性有 Unit |
| R12/R13     | 新增相关阻断                               | AUTH health 权限耦合；技术步骤 Decision 未绑定完整实际 payload                                                                                            |

### 本轮阻断 comments

#### R2 [P1] 每次实际 publish 前重新证明 Policy 当前资格

位置：`apps/api/src/composition/task-board-dispatcher.ts:139`。

专用 taskBoardPolicyReadV1 mapping、Query 最终 Policy Decision 重验以及 maintenance 的解析已接入，应认可这些修复。但 export pass 仍只在这里解析一次 Policy，后续 assemble/record manifest/publish/confirm 没有再次解析或重验该 Policy Decision。若 source 读取之后 Policy Grant 被撤销或版本被 supersede，publish mapping 的重验不会检查另一项 Policy authority，仍会发布和确认旧 Policy 的 manifest。独立 controlled source-level probe 在 record manifest 时使 Policy resolver 失效，实际 runTaskBoardExportPass 仍 publish+confirm，resolvePolicy 调用仅 1 次；这不是实际 PG 撤权证据。请在 protected publish 边界重新精确解析并验证原 observation 仍合法，失效时保留 dirty/旧 alias。Spec003 §12.5/12.7 要求每次 Query/Export/publish/cleanup 当前 Policy，不是仅 pass 开始检查。

#### R3 [P1] 用精确 JSONB 相等校验 manifest row，不能使用包含关系

位置：`migrations/task_execution/V7015__task_board_projection.sql:233`。

canonical manifest/rows hash 和新增 mirror guard 修复了原先的损坏 hash/身份遗漏，但这里的 @> 是递归包含判断，不是注释承诺的 exact manifest row 相等。对一个合法未插入 row 的 generation，仅从 NEW.row.item 删除 title（其余字段、taskRef、Scope、filterKeys 和 promoted columns 保持原值），上方 identity guard 全部通过，而 manifest.rows @> [NEW.row] 仍为 true；SQL 会接受缺必填 title 的 row。删掉 blockerRefs/current completion 字段也有同类问题，读回完整 rowsHash 才报错已太晚。请从 manifest.rows 选择相同完整 Task 身份的元素并使用 JSONB = 做全行相等验证，配合法 baseline/单字段删除的实际 SQL 负例；不能用同时换 generation/exportId/hash 的负例代替这条 guard 的证明。违反 PostgreSQL IM06-BOARD 和 BOARD-D-002/005/007 的独立 SQL 完整性边界。

#### R4 [P1] 确认已发布 export 不应依赖当前 alias 或仍保留的 generation

位置：`migrations/task_execution/V7014__task_board_dirty_and_dispatch.sql:501`。

新检查可以拒绝伪造未发布 publication，应关闭旧 head 的该反例；但 JOIN 当前 alias 新增了恢复错误。合法顺序为：E1/G1 已提交 publication outcome→确认前崩溃→新 lease 下发布 E2/G2→按持久 manifest 重放 E1，Projection 正确返回原 G1/sequence 且不回退 alias；这里因 alias 已指向 G2 返回 TASK_BOARD_NOT_PUBLISHED，E1 无法登记/重放确认。即使 E1 曾登记，函数也是先查 alias 再走 ON CONFLICT，重放仍失败。JOIN generation 还使保留 outcome、清理过期 G1 后的证明失效。请通过独立 owning 的不可变 publication outcome 验证同 Project/export/hash/generation/sequence，不能要求其仍是当前 alias/retained generation；增加 alias 前进和 cleanup 后恢复的实际 PG 正例，继续保留伪造负例。Spec003 §12.7/#248 明确要求此重放语义。

#### R7 [P2] 实现批准的 cv1 字节布局和两项完整来源字段

位置：`modules/task-execution/src/business/task-board-cursor.ts:66`。

原期限保留、32-byte request binding/evidence 与完整 HMAC 已修复，不能再报告自动续期或四个截断 digest。但该 OFF 布局仍不是 Spec003 §12.6 的批准格式：规定 keyId 在 offset 2、requestBindingHash 在 6、sourceFingerprint 在 38、generationId 在 70、manifestHash 在 86；实际 keyId 在 6、binding 在 90，且 sourceFingerprint/manifestHash 被合并为互斥 evidenceHash，Projection cursor 没有完整 sourceFingerprint。独立 codec probe 确认合法输出在规定 keyId offset 读不到实际 keyId；AUTH 编码中非零 generation bytes 重新合法签名后 decoder 也未拒绝（不是攻击者无 Secret 可以伪造签名）。请按已批准格式实现和对照 byte fixtures 校验，包含 AUTH generation/manifest/sequence 全零及完整时间/安全整数规则。198 bytes/264 chars 相同不是协议一致；若要变更设计需先取得相应 owning 决定。

#### R10 [P1] 补齐当前 Issue 已约定的真实来源与恢复验收

位置：`tests/persistence/task-board-entry.test.ts:371`。

认可同 head CI 的三项真实 entry 测试，以及新增 SQL/伪造 publication/lease 到期拒绝案例。但 entry 文件本轮只移除两个配置字段，仍只有 Task v2 DRAFT/READY、Projection、首页 Human revoke；#248 已要求的真实 v1/v2+WO 创建身份、正常完成/BLOCKED_INPUT/恢复/取消、current Evaluation、G1→G2 多页、SNAPSHOT_AT_LEAST、返回前 Policy/依赖撤权、P1→H/H→P2、Export RR、低序号 dirty 晚提交和崩溃重放没有交付。runTaskBoardExportPass 仍总是生成新 exportId，未使用已持久 manifest 恢复未完成 export。此外新增锁等待测试仅 setTimeout(1400)，没有证明 publisher 已 reached fence 等待点；延迟启动至到期后也会通过，不能标为 reached-barrier 证据。BOARD-D/IP-BOARD-D 矩阵仍 NOT RUN，Issue Acceptance 未调整。请补必要 owning 正链/确定性并发与恢复出口，准确更新证据；HTTP/UI/Provider/性能/人工和明确延后边界继续排除。

#### R12 [P2] AUTHORITATIVE 路径不应要求 health 权限

位置：`apps/api/src/composition/task-board-entry.ts:321`。

该 health authorize/revalidate 无条件发生在 consistency 分支之前，且 health Grant 无条件进入 authorizationSourceHash 和 revalidateAll。配置合法 Human/source/Policy 权限但没有 taskBoardHealthReadV1 Grant 时，AUTHORITATIVE 在真正读取源之前就返回 AUTHORIZATION_REVOKED；即使最初有 health 权限，权威多页期间只更换 health Grant 也会使 cursor scope mismatch。authorityRead 本身完全不使用 source-health。Spec001 §15.19 明确 AUTH 路径不需要 Projection/health/publish/maintenance 权限，fingerprint 只应绑定实际使用 mapping。请根据 consistency 仅签发/重验实际读取依赖，并用真实缺 health Grant 的 AUTHORITATIVE 正例及 Projection 拒绝负例证明权限不耦合。

#### R13 [P1] 将技术 Decision 绑定到该步骤的完整实际 payload

位置：`apps/api/src/composition/task-board-dispatcher.ts:405`。

四项技术 mapping 虽各自签发 Decision，但全部使用 prepare 中同一个 payloadHashOf({projectRef})，后续 authorize 又按该常量重验；exportId 直到 source snapshot 结束才生成，publish/confirm 时传入的 manifestHash、coveredDirtyIds、fence、操作类型均未进入各自 Decision。因而同 Project 下换 export/manifest/fence 或把 dispatch claim Decision 用来确认另一组 ids，都不会触发 payload binding 拒绝。Spec001 §15.19 已明确 source Export 预分配 exportId、完整 projectRef/policyRef 以及 dispatch/publish/maintain 各操作实际字段的 closed payload Hash。请改为在每个实际步骤形成受信 closed payload 并签发/重验自己的 Decision，source 在读取前绑定预分配 exportId；添加仅换 export/hash/fence/confirm ids 时 protected write 为 0 的负例。不能以 operation/target 相同代替完整意图绑定。

### 第三轮交付

已发布并逐条读回 [COMMENT review 5409641736](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5409641736)，state=`COMMENTED`，commit_id 等于被审 SHA。R2/R3/R4/R7/R10/R12/R13 共 7 条代码 comments 均存在（5 项 P1、2 项 P2）。发布后 PR head 未变化，仍为 OPEN。

当前账号为 PR 作者，`REQUEST_CHANGES` 为 Reviewer 技术结论，与 GitHub COMMENTED 状态区分。本轮仅更新此正式审查记录及提交 GitHub comments；不修改产品代码、不 commit/push/merge。修复后按最新 head 复审。

---

## 第二轮复审（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`ebfb3f1d8cd562c137e8bcda2328a7553825e40a`。
- 日期：2026-10-05；Issue #248，T2。
- 范围：最新 PR head，上一轮 R1–R10 的修订及新增相关行为；依据 Issue 原验收、Spec003 §12、Spec001 §15.19、共享 API/PG IM06-BOARD。未由修复说明或 CI 绿色推导业务验收完成。

### 当前验证证据

- [CI run 37244394436](https://github.com/qzhike/zhiju-business-core/actions/runs/37244394436) 的 headSha 等于被审 SHA；select/checks/persistence/verify 全部 SUCCESS。复用 exact-revision full，不重复本地 full。
- `node node_modules/vitest/vitest.mjs run modules/task-execution/src/business/task-board-read.test.ts modules/task-execution/src/business/task-board-cursor.test.ts modules/identity-policy/src/commands/task-board-authorization.test.ts`：3 files / 27 tests PASS。
- 独立 source-level focused probe：`node node_modules/vitest/vitest.mjs run .review-pr249-round2-probe.test.ts`：1 file / 3 cases PASS。确认 R6/R8/R9 与 R7 的毫秒/key/受信 expiry 修复；另断言自动续期缺陷存在。TTL=600s，第二页在590s继续，新 expiry 延长590s，第三页在601s仍 OK。复现用例 PASS 不提升验收状态；临时诊断文件不交付到产品测试集合。
- 新增 PG 三项 entry 测试已由本 head 完整 CI 执行并通过：真实 owning Task v2→authority、export/publish→projection、首页 Human Grant revoke。认可这些证据，撤回旧 head 的“没有任何入口调用”表述。
- 剩余 SQL guard、publication proof、锁等待、Policy mapping、Grant 指纹问题为当前 source/contract/test 独立核对；本轮新增 PG、两连接 reached、完整 owning 状态链和返回前撤权验收 NOT RUN。HTTP/UI/Provider/性能/独立人工及明确延后范围保持 NOT RUN。

### 上轮 finding 对账

| 上轮 finding | 第二轮状态   | 依据/剩余边界                                                                              |
| ------------ | ------------ | ------------------------------------------------------------------------------------------ |
| R1           | 原缺陷已修复 | Human 使用 owning Board mapping；真实首页 Grant revoke PG 负例；更完整返回前撤权证据归 R10 |
| R2           | 部分修复     | 技术 mapping 已接线；Policy mapping、最终/current 重验与实际 payload 仍不足                |
| R3           | 部分修复     | 应用 hash/count 与读回校验新增；SQL hash/row mirror 仍缺                                   |
| R4           | 部分修复     | confirm 要求 publication 记录，但记录自身未验证 Projection 结果                            |
| R5           | 部分修复     | 使用 DB clock 且读 TE control，但取时在 fence 锁等待之前                                   |
| R6           | 原缺陷已修复 | authority 使用 lastTaskId 继续；独立多页反例复核成功                                       |
| R7           | 部分修复     | 毫秒/key/HMAC/trusted expiry 修复；会话自动续期、编码布局仍不符合契约                      |
| R8           | 原缺陷已修复 | 历史 asOf 与实际 alias 比较，独立 probe 为 STALE                                           |
| R9           | 原缺陷已修复 | budget failure 为 FAILED，后续成功发布解除失败有 Unit 覆盖                                 |
| R10          | 部分修复     | 新增三项 real owning entry PG；其余明确验收仍缺                                            |
| R11          | 新增阻断     | selected Grant 完整来源身份未进入 authorizationSourceHash                                  |

### 本轮阻断 comments

#### R2 [P1] Policy 读取仍未使用独立 Board mapping，最终返回前也未重验

位置：`apps/api/src/composition/task-board-policy.ts:65`。

共享 helper 仍调用通用 authorizeCommand；该函数和 resolvePolicy 的 currentAuthorizationError 只检查 capability code/Scope 的 active Grant，不证明 taskBoardPolicyReadV1 的 required action、TARGET_TYPE selector、完整 VERSIONED target 或对应 Grant PolicySnapshot 当前资格。Board 的 capabilityCodes.taskBoardPolicyReadV1 并未用于这里，独立 capabilityCodeResolvePolicy 还可与之漂移。返回前 revalidateAll 只重验 Human/source/health，没有保存和重验实际 Policy Decision；Policy Grant 在 owning source 读取后被撤销仍可返回 data。Dispatcher 也仅在 pass 开始解析一次 Policy，maintenance 根本不调用 resolvePolicy。请让两路径接入 Spec001 §15.19 专用 Policy mapping，按真实使用条目在 protected 步骤及返回前重验；不能以解析了 Policy document 就关闭原 R2。

#### R3 [P1] SQL 完整性 guard 仍不校验 canonical hash 和 row/filter mirror

位置：`migrations/task_execution/V7015__task_board_projection.sql:156`。

应用新增 hash/count 检查是有效修复，但新 SQL guard 只比较 manifest 里的 rowsHash 文本与 rows_hash 列，完全未使用 NEW.manifest_hash，也不重算 canonical rows hash。保持 manifest 不变、仅换一个合法长度的 manifest_hash 仍会通过；伪造 rowsHash 并同步同名列也不会被 SQL 拒绝。task_board_row 仍无 INSERT guard 验证 row.item.taskRef/task_id、完整 Scope、filterKeys.deliveryItemRef/delivery_item_ref 和 generation.manifest.rows。新增 PG 损坏用例仍通过应用 publish 函数，不能证明实际 SQL guard 拒绝。请分别补实际应用/SQL 单字段反例并实现 PostgreSQL IM06-BOARD、BOARD-D-002/005/007 已要求的完整性规则，保留旧 alias。原 R3 只能算部分修复。

#### R4 [P1] Publication 记录仍然可以为未发布 export 伪造证明

位置：`migrations/task_execution/V7014__task_board_dirty_and_dispatch.sql:489`。

record_publication 只验证 live lease token 和 TE manifest 是否存在，然后直接把 caller 的 generationId/publishSequence 写成 publication proof；没有核对 Projection 实际已提交的 exportId/hash/generation/sequence 结果。反例顺序仍然成立：claim→record manifest→record_publication(任意新 UUID, sequence=1, 当前 token)→confirm；完全不调用 publishTaskBoardGeneration 就能删除 covered dirty。新增测试只验证跳过 record_publication 会失败，没有验证伪造记录会失败。请从独立 owning publication outcome 取得且验证精确证明后才能登记/确认，保持两 Owner 事务分离，并添加这条实际 PG 负例。原 R4 的漏确认风险仍在。

#### R5 [P1] 到期检查的数据库时间必须在 fence 锁等待后重新取得

位置：`modules/task-execution/src/persistence/task-board-projection-repository.ts:219`。

使用 clock_timestamp 修复了 caller 旧 now，但取时发生在 readFence 的 SELECT FOR UPDATE 之前。若另一事务持有 fence 锁，发布事务先取得 lease 到期前的 trustedNow，随后阻塞跨过 leaseUntil；获锁后仍用旧 trustedNow 检查并继续切 alias。Dispatcher 的 TE control 读取也在该等待前，无法防止这个窗口；提交后的 record_publication 可能拒绝，alias 却已被旧 worker 切换。请在获取必要串行锁后取得当前 DB 时间，并在实际发布边界校验期限/当前资格；按 Spec003 §12.7 和 BOARD-D-005 用 reached 两连接屏障覆盖锁等待跨期限，而非仅提交一个早已到期的输入。原 R5 部分修复。

#### R7 [P2] Cursor 续页不能重新延长原分页会话的期限

位置：`modules/task-execution/src/business/task-board-read.ts:373`。

毫秒、keyId、完整 HMAC、受信时钟已修复，但 authority 每一页仍重置 issuedAt=ports.now、expiresAt=now+TTL，忽略 decoded.expiresAt；Projection 分支也未限制到旧 cursor.expiresAt。独立 probe：TTL=600s，第二页在590s继续，新的 expiry 延长590s，第三页在601s（超过首个 cursor 期限）仍 OK。违反 #248“新短期同源 Decision 不使 cursor 自动续期”和 Spec003 §12.6。请让 continuation 保留/收紧原期限，验证原 deadline 后稳定 QUERY_CURSOR_EXPIRED。此外 codec 仍使用四个截断128-bit digest/不同布局，未落实权威指定的32-byte requestBindingHash、完整 sourceFingerprint/manifestHash 布局；198bytes/264字符相同不能替代已批准的完整字段算法。

#### R10 [P1] 新增三条入口测试仍未完成 Issue 明确要求的出口验收

位置：`tests/persistence/task-board-entry.test.ts:371`。

新增真实 Task v2→AUTHORITATIVE、export/publish→PROJECTION_OK、首页 Human revoke 三项证据应认可；上一轮“没有入口测试”不再成立。但这里只验证一个 DRAFT/READY Task，没有真实 v1/v2+WO 身份、正常完成/BLOCKED_INPUT/一次恢复/取消后的 blocker/current Evaluation、多页G1→G2、SNAPSHOT_AT_LEAST 入口、返回前撤权，以及 P1→H/H→P2、低序号 dirty 晚提交、Export RR/崩溃重放的 reached 两连接验收。现有 dispatcher 每次新建 exportId，也没有按持久 manifest 重放未完成 export 的恢复出口。BOARD-D/IP-BOARD-D 矩阵仍 NOT RUN，#248 验收未改。请补齐当前 Issue 的必要真实正链与并发/恢复反例，分层更新证据；不要求 Non-goals 的 HTTP/UI/Provider/性能/人工，也不要求扩展既有延后范围。原 R10 部分修复。

#### R11 [P2] 授权来源指纹缺少实际 selected Grant 身份

位置：`modules/identity-policy/src/commands/task-board-source-hash.ts:43`。

当前 fingerprint 仅含 principal/ActorSnapshot、mapping/config 和 PolicySnapshot，接口和实现均没有 selected Grant id/payloadHash/Scope/selector/action。owning coveringValidationGrant 也只返回 policySnapshot。因此在相同 Actor/Scope/配置/PolicySnapshot 下撤销 G1、创建新 covering G2，当前重验可通过，但 cursor authorizationSourceHash 不变，旧 cursor 不会因授权来源更换要求重启。Spec001 §15.19 明确要求 selected Grant 完整身份进入来源指纹。请由 owning IP Port 返回实际选择的 Grant 事实来计算指纹，保持同 Grant 的新短期 Decision hash 稳定，同时证明换 Grant 后旧 cursor 被拒绝。此为本轮新增发现。

### 第二轮交付

已发布并读回 [COMMENT review 5409225999](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5409225999)，state=`COMMENTED`，commit_id 为本轮被审 SHA；R2/R3/R4/R5/R7/R10/R11 共 7 条代码 comments 已存在。发布后 PR head 未变化，仍为 OPEN。当前账号为 PR 作者，`REQUEST_CHANGES` 是独立 Reviewer 技术结论，不是 GitHub Request changes 状态。

本轮仅更新此正式审查文档并发布 GitHub COMMENT review；不修改产品代码、不 commit/push、不合并。发布结果需读回确认；Reviewer 技术结论与 GitHub COMMENTED 状态区分。修复后按新 head 复审。

---

## 第一轮审查（历史记录，以下结论绑定旧 SHA）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`c9c2e03a2cd9d623787cc9928fe8ac25d8887241`。
- PR：https://github.com/qzhike/zhiju-business-core/pull/249。
- Work item：Issue #248；classification T2。
- 日期：2026-10-05。
- 独立性：从 Issue 验收、Spec003 §12、Spec001 §15.19、共享 API IM06-BOARD 与 PostgreSQL IM06-BOARD 建立预期后核对 actual diff；未承担本 PR 实现，未修复产品代码。

#### 预期与范围

获授权 Human 应得到真实来源的完整 QueryResult；Task/WO/Completion 分层保持，精确过滤先于分页；三种 consistency 不降级；固定 generation/authority 来源与 cursor 绑定且当前授权独立重验；导出、发布、确认与 retention 在各 Owner 技术边界保持完整性、fence、幂等和恢复。公开 operation/payload/result 与既有 registry 基线保持。外部 Provider、公开 HTTP/UI、生产/性能、独立人工及 TD-07 不属于本出口。

#### 验证证据

- 同 SHA 的 [CI run 37223041070](https://github.com/qzhike/zhiju-business-core/actions/runs/37223041070)：select/checks/persistence/verify 全部 SUCCESS；已读取 workflow 配置与 run headSha，覆盖 full 的 code 与真实 PostgreSQL gate；未为重复取证重跑本地 full。
- 独立 focused source-level 诊断：`node node_modules/vitest/vitest.mjs run .review-pr249-probe.test.ts`，最终 1 file / 5 cases PASS。断言对象是已复现的缺陷行为，不是功能验收成功。验证权威页重复、handler trusted now 超过 TTL 仍接受、旧 asOf 假 FRESH、budget failure 假 FRESH、unknown keyId/毫秒丢失。临时诊断文件不交付到产品测试集合。
- 初次诊断的 Projection millisecond asOf 第二页预期拒绝并未成立：实际正常返回；该初步假设已撤回，不作为 finding。
- SQL/存储与授权 findings 通过 current source/guard 与现有 persistence 正例核对；没有把 static inspection 写为本轮 PG 运行证据。
- 本轮新增 PG、真实 Grant/Policy 生命周期、owning producer→entry E2E、两连接 reached-barrier 并发均 NOT RUN。外部/人工仍 NOT RUN。

#### 阻断发现

##### R1 [P1] Human 读取必须重验当前 covering Grant

位置：`apps/api/src/composition/task-board-entry.ts:324`。

这里调用的通用 validateAuthorizationDecision（actor-snapshot.ts:521–612）只检查已存 Decision 的字段、ALLOW 与 expiry，不查询当前 Grant/revocation/Principal，也不校验 taskBoardReadHumanV1 的配置 code、required action、完整 target 或 HUMAN/forbidActingFor。首屏和返回前重复调用同一个验证器仍会在 Grant 被撤销后放行未过期旧 Decision。请接入 Board owning revalidate mapping，并以真实撤权、非 Human/actingFor、config/target 漂移证明 protected read 为 0、无 data。违反 Spec001 §15.19 和 #248 独立权限验收。

##### R2 [P1] Dispatcher 和 maintenance 缺少独立当前授权与 Policy 解析

位置：`apps/api/src/composition/task-board-dispatcher.ts:75`。

导出的 composition pass 直接信任 project.sourceContext/dispatchContext/publishContext/maintainContext 和已经解析的 project.policy；本文件没有 IdentityPolicy authorize/revalidate 或当前 resolve_policy 调用。底层 SQL 的 dispatch_scope 只检查 SERVICE 与 Scope，Projection RLS 也不验证 owning operation/action。因此一个仍在期限内的 source/health Context 可被换用来 claim/confirm/publish/cleanup，撤权或失效 Policy 也不会在步骤边界被发现。请在每项 protected read/write 前接线相应独立 mapping、完整 payload/target 和当前固定 Policy，并覆盖权限不可互转的真实负例；Context/RLS 不能代替 Spec001 §15.19、Spec003 §12.5/12.7。

##### R3 [P1] 发布前必须校验 canonical hash、完整行与镜像

位置：`modules/task-execution/src/persistence/task-board-projection-repository.ts:231`。

publishTaskBoardGeneration 将 caller 的 manifestHash/rowsHash/count/manifest/Scope 直接落库并切 alias，未重算 hash、验证 rowCount==rows.length、完整 Ref/Scope、预算或 persisted owning manifest；V7015 只有长度/范围/FK/不可变检查，没有 INSERT 完整性 guard。读路径也不验证 rowsHash/count。现有 PG 正例使用 rowsHash=b×64，manifestHash 也直接取同一值并断言成功，说明错误 hash 已被当作合法发布。请按 PostgreSQL IM06-BOARD 与 BOARD-D-002/005/007 在应用和 SQL 边界分别拒绝单字段损坏，事务失败保留原 alias，不能将 arbitrary rows 发布成成功 generation。

##### R4 [P1] 未发布的 manifest 不能确认并删除 dirty

位置：`migrations/task_execution/V7014__task_board_dirty_and_dispatch.sql:443`。

confirm 只证明 export manifest 存在及 dirty id 属于 coveredDirtyIds；p_publish_sequence 完全由 caller 提供，没有匹配已提交 publication outcome/generation 的证明。因此 record manifest 后即使从未 publish，也能删除全部 covered marker，并记录任意 sequence。tests/persistence/task-board.test.ts:311–324 正好在对应 export 未发布时确认成功并断言 marker 清零。请增加独立的同 Project/exportId/hash/generation/sequence 发布证明，保持 Owner 事务分离，并用发布失败/确认重放负例证明未发布事实不会被 ack。违反 #248 导出恢复验收及 PostgreSQL IM06-BOARD。

##### R5 [P1] Fence 必须使用发布时当前时间及 TE control proof

位置：`modules/task-execution/src/persistence/task-board-projection-repository.ts:153`。

registerFence 只比较 caller 提供的 tuple 与 Projection 本地 token，并用 input.now 判断到期；没有读取 TE 当前已提交 claim 的 control proof。dispatcher 又在 pass 开始时只取一次 now。若导出耗时超过 lease，旧 worker 仍以旧 now 发布；即使 TE 已被接管，只要新 worker 尚未注册 Projection fence，这里仍接受旧 tuple。现有 PG 正例甚至以落后真实时钟数分钟、已真实过期的 lease 成功发布。请在注册/发布边界取得当前 TE claim 资格，Projection 事务按当时受信时间拒绝过期，并添加 TE 接管但 Projection 未注册窗口的两连接负例。违反 Spec003 §12.7。

##### R6 [P2] AUTHORITATIVE 翻页必须从 decoded.lastTaskId 继续

位置：`modules/task-execution/src/business/task-board-read.ts:365`。

cursor 虽然被 decode 和绑定验证，分页却始终 pageRows(..., undefined)，没有使用 decoded.lastTaskId。来源不变的三个 Task、pageSize=2：第一页 [T11,T12]，带返回 cursor 的第二页仍 [T11,T12]，T13 永远取不到，并继续生成 nextCursor。独立 source-level focused probe 已复现。请保留 decoded paging state 并从最后 Task 后读取，同时验证多页无重复/漏项、来源变化要求重启；这是 #248 BOARD-D-003 的明确验收失败。

##### R7 [P2] Cursor codec 必须实现已批准的完整编码与受信期限

位置：`modules/task-execution/src/business/task-board-cursor.ts:218`。

当前 codec 是十一项 16-byte slot + 截断 16-byte HMAC，时间 floor 到秒，keyId 完全未写入/验证，与 Spec003 §12.6 已批准的 198-byte 毫秒 int64、uint32 keyId、完整 32-byte HMAC 布局不同。probe 验证 snapshotAt .123Z 往返变 .000Z，换 unknown keyId 但同 Secret 仍通过，ports.now 已超过 TTL 而 Date.now 尚未到期时仍返回 OK。264 字符只满足长度，并不满足其余契约。请实现批准布局、无损毫秒时间/完整 hash/keyId 绑定、安全整数与 canonical 解码，并按入口受信 now 判断过期，补配对反例；不应静默替换已批准设计。

##### R8 [P2] asOf 读取旧 generation 时不能标 FRESH

位置：`modules/task-execution/src/business/task-board-read.ts:470`。

无 cursor 的 asOf 请求会把 target 设为历史 generation，但 aliasChanged 只比较 P1/P2 当前 alias 是否相互变化，完全没有比较 target.generationId 与当前 alias。G2 已是当前 alias，asOf 返回仍保留的 G1，只要 dirty=0 且年龄达标就得到 OK/FRESH。独立 probe 已复现。请让所有路径的 freshness 都以实际读取 generation 为比较对象，历史 G1 至少为 STALE，并按 Spec003 §12.3/12.6 保留相应 data/status 语义。

##### R9 [P2] 识别实际导出失败，不能把超预算标成 FRESH

位置：`modules/task-execution/src/business/task-board-read.ts:474`。

dispatcher 实际记录 TASK_BOARD_EXPORT_BUDGET_EXCEEDED，但 handler 只识别 TASK_BOARD_FAILED/REBUILD/PAUSED，其余 failure 被忽略。旧 alias 年龄达标且 dirty=0 时，已发生的超预算导出失败仍返回 OK/FRESH；focused probe 已复现。请统一 producer/consumer 的 failure 语义，真实失败使用 ERROR/FAILED（旧 data 仅按保留/授权规则附带），并确保后续成功发布能够解除对应失败状态。违反 #248 freshness/有限资源验收及 Spec003 §12.3/12.6。

##### R10 [P1] 补齐 Issue 明确要求的 owning 入口和并发验收

位置：`.vibe/module-tests/Module-Test-003-TaskExecution.md:654`。

BOARD-D-001–007 和 IP-BOARD-D-001–003 全部仍是 NOT RUN，PR 也明确没有真实 owning producer→完整 Board entry、Grant 撤权生命周期、三 consistency 的入口运行验收。现有新测试仅是内存 handler/authorization mapping 与 synthetic SERVICE Context 的存储调用；未调用 createTaskBoardEntry、runTaskBoardExportPass 或 assembleTaskBoardRows，也没有 required reached-barrier source/alias/late dirty/crash 场景。#248 Acceptance/Verify 将这些作为本切片出口，并未列入 Non-goals；CI full 不能替代它们。请用真实 owning 正链和必要两连接/当前授权反例补齐，分层更新真实证据；HTTP/UI/Provider/性能/独立人工仍可保留 NOT RUN。

#### 交付边界

已提交并读回 [GitHub COMMENT review 5408627162](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5408627162)，state=`COMMENTED`，绑定上述 SHA，R1–R10 共 10 条代码评论均存在。当前登录账号为 PR 作者，故提交 COMMENT review；`REQUEST_CHANGES` 是 Reviewer 技术结论，不是 GitHub Request changes review 状态。发布后再次读取 PR，head 未变化，仍为 OPEN。

本文件为 Reviewer 本地正式交付，不属于上述被审 SHA；未 commit/push。仅写审查记录和 GitHub comments，不改实现、不合并。R1–R10 交回 Implementer，修复后需按新 head 复审并取得适用验证证据。GitHub publication 结果在 PR 读回；本地审查完成不能代替成功发布。
