# PR #249 正式审查记录

## 第二轮复审（当前结论）

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
