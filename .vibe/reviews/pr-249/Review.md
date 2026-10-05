# PR #249 正式审查记录

## 第五轮复审（当前结论，新 head）

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

| Finding | 第五轮判断 | 当前依据 |
|---|---|---|
| R1/R5/R6/R8/R9/R11 | 维持原缺陷关闭 | 无相关回退证据 |
| R2 | 原撤权 publish 反例已修复；pending Policy 恢复仍阻断 | publish 前二次 owning Policy 解析有效；未核对 pending 原 Policy/提供失效后新导出出口 |
| R3 | 关闭包含关系缺陷 | SQL manifest element 改用全 row JSONB 相等；相应真实单字段负例覆盖归 R10 |
| R4 | 关闭当前 alias/retained generation 依赖 | proof 仅核对独立不可变 outcome；实际崩溃恢复缺口另见 R14/R10 |
| R7 | 部分修复 | 前118-byte/完整源字段/部分AUTH零值规则修正；uint32序号与尾部布局不符批准契约 |
| R10 | 部分修复、必要出口仍未完成 | 新增 reached信号/manifest读取认可；真实入口文件未新增完整状态链及恢复验收 |
| R12 | 关闭 AUTH health 耦合 | 签发、最终重验和来源hash只在实际 health 路径使用 |
| R13 | 部分修复 | 各步 own Decision/source预分配exportId已实现；完整fence/owner/confirm结果尚未绑定 |
| R14 | 新增阻断 | publication proof commit 后但 dirty confirm 前的崩溃被 pending reader 漏选 |

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

| Finding | 第三轮判断 | 本轮依据 |
|---|---|---|
| R1/R6/R8/R9 | 维持原缺陷已修复 | 当前修订无相关回退证据 |
| R2 | 部分修复 | 专用 Policy mapping、Query 最终 Decision 重验及 maintenance 解析新增；worker protected publish 前仍不重验 Policy，payload 另见 R13 |
| R3 | 部分修复 | SQL canonical hash 与 promoted mirror 新增；row 使用包含判断，非完整相等 |
| R4 | 原伪造反例已修复；恢复仍阻断 | 独立 outcome 校验新增；当前 alias/generation JOIN 拒绝合法历史重放 |
| R5 | 关闭原锁等待取时缺陷 | 数据库时间移至 fence 锁之后且切 alias 前再次检查；reached 验收缺口归 R10 |
| R7 | 期限与完整 digest 缺陷关闭；协议仍部分修复 | authority/Projection 保留原期限，完整 HMAC/binding/evidence；字节布局及 Projection sourceFingerprint 仍不符批准格式 |
| R10 | 未完成 | 新增 focused PG 不代替 Issue 完整 owning/恢复验收 |
| R11 | 关闭原 selected Grant 身份缺失 | owning revalidation 返回实际 selectedGrant，grant id/Scope/actions/selectors/Policy snapshot/aggregateVersion 纳入 hash；更换 Grant 与同来源稳定性有 Unit |
| R12/R13 | 新增相关阻断 | AUTH health 权限耦合；技术步骤 Decision 未绑定完整实际 payload |

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

| 上轮 finding | 第二轮状态 | 依据/剩余边界 |
|---|---|---|
| R1 | 原缺陷已修复 | Human 使用 owning Board mapping；真实首页 Grant revoke PG 负例；更完整返回前撤权证据归 R10 |
| R2 | 部分修复 | 技术 mapping 已接线；Policy mapping、最终/current 重验与实际 payload 仍不足 |
| R3 | 部分修复 | 应用 hash/count 与读回校验新增；SQL hash/row mirror 仍缺 |
| R4 | 部分修复 | confirm 要求 publication 记录，但记录自身未验证 Projection 结果 |
| R5 | 部分修复 | 使用 DB clock 且读 TE control，但取时在 fence 锁等待之前 |
| R6 | 原缺陷已修复 | authority 使用 lastTaskId 继续；独立多页反例复核成功 |
| R7 | 部分修复 | 毫秒/key/HMAC/trusted expiry 修复；会话自动续期、编码布局仍不符合契约 |
| R8 | 原缺陷已修复 | 历史 asOf 与实际 alias 比较，独立 probe 为 STALE |
| R9 | 原缺陷已修复 | budget failure 为 FAILED，后续成功发布解除失败有 Unit 覆盖 |
| R10 | 部分修复 | 新增三项 real owning entry PG；其余明确验收仍缺 |
| R11 | 新增阻断 | selected Grant 完整来源身份未进入 authorizationSourceHash |

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
