# PR #249 正式审查记录

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`c9c2e03a2cd9d623787cc9928fe8ac25d8887241`。
- PR：https://github.com/qzhike/zhiju-business-core/pull/249。
- Work item：Issue #248；classification T2。
- 日期：2026-10-05。
- 独立性：从 Issue 验收、Spec003 §12、Spec001 §15.19、共享 API IM06-BOARD 与 PostgreSQL IM06-BOARD 建立预期后核对 actual diff；未承担本 PR 实现，未修复产品代码。

## 预期与范围

获授权 Human 应得到真实来源的完整 QueryResult；Task/WO/Completion 分层保持，精确过滤先于分页；三种 consistency 不降级；固定 generation/authority 来源与 cursor 绑定且当前授权独立重验；导出、发布、确认与 retention 在各 Owner 技术边界保持完整性、fence、幂等和恢复。公开 operation/payload/result 与既有 registry 基线保持。外部 Provider、公开 HTTP/UI、生产/性能、独立人工及 TD-07 不属于本出口。

## 验证证据

- 同 SHA 的 [CI run 37223041070](https://github.com/qzhike/zhiju-business-core/actions/runs/37223041070)：select/checks/persistence/verify 全部 SUCCESS；已读取 workflow 配置与 run headSha，覆盖 full 的 code 与真实 PostgreSQL gate；未为重复取证重跑本地 full。
- 独立 focused source-level 诊断：`node node_modules/vitest/vitest.mjs run .review-pr249-probe.test.ts`，最终 1 file / 5 cases PASS。断言对象是已复现的缺陷行为，不是功能验收成功。验证权威页重复、handler trusted now 超过 TTL 仍接受、旧 asOf 假 FRESH、budget failure 假 FRESH、unknown keyId/毫秒丢失。临时诊断文件不交付到产品测试集合。
- 初次诊断的 Projection millisecond asOf 第二页预期拒绝并未成立：实际正常返回；该初步假设已撤回，不作为 finding。
- SQL/存储与授权 findings 通过 current source/guard 与现有 persistence 正例核对；没有把 static inspection 写为本轮 PG 运行证据。
- 本轮新增 PG、真实 Grant/Policy 生命周期、owning producer→entry E2E、两连接 reached-barrier 并发均 NOT RUN。外部/人工仍 NOT RUN。

## 阻断发现

### R1 [P1] Human 读取必须重验当前 covering Grant

位置：`apps/api/src/composition/task-board-entry.ts:324`。

这里调用的通用 validateAuthorizationDecision（actor-snapshot.ts:521–612）只检查已存 Decision 的字段、ALLOW 与 expiry，不查询当前 Grant/revocation/Principal，也不校验 taskBoardReadHumanV1 的配置 code、required action、完整 target 或 HUMAN/forbidActingFor。首屏和返回前重复调用同一个验证器仍会在 Grant 被撤销后放行未过期旧 Decision。请接入 Board owning revalidate mapping，并以真实撤权、非 Human/actingFor、config/target 漂移证明 protected read 为 0、无 data。违反 Spec001 §15.19 和 #248 独立权限验收。

### R2 [P1] Dispatcher 和 maintenance 缺少独立当前授权与 Policy 解析

位置：`apps/api/src/composition/task-board-dispatcher.ts:75`。

导出的 composition pass 直接信任 project.sourceContext/dispatchContext/publishContext/maintainContext 和已经解析的 project.policy；本文件没有 IdentityPolicy authorize/revalidate 或当前 resolve_policy 调用。底层 SQL 的 dispatch_scope 只检查 SERVICE 与 Scope，Projection RLS 也不验证 owning operation/action。因此一个仍在期限内的 source/health Context 可被换用来 claim/confirm/publish/cleanup，撤权或失效 Policy 也不会在步骤边界被发现。请在每项 protected read/write 前接线相应独立 mapping、完整 payload/target 和当前固定 Policy，并覆盖权限不可互转的真实负例；Context/RLS 不能代替 Spec001 §15.19、Spec003 §12.5/12.7。

### R3 [P1] 发布前必须校验 canonical hash、完整行与镜像

位置：`modules/task-execution/src/persistence/task-board-projection-repository.ts:231`。

publishTaskBoardGeneration 将 caller 的 manifestHash/rowsHash/count/manifest/Scope 直接落库并切 alias，未重算 hash、验证 rowCount==rows.length、完整 Ref/Scope、预算或 persisted owning manifest；V7015 只有长度/范围/FK/不可变检查，没有 INSERT 完整性 guard。读路径也不验证 rowsHash/count。现有 PG 正例使用 rowsHash=b×64，manifestHash 也直接取同一值并断言成功，说明错误 hash 已被当作合法发布。请按 PostgreSQL IM06-BOARD 与 BOARD-D-002/005/007 在应用和 SQL 边界分别拒绝单字段损坏，事务失败保留原 alias，不能将 arbitrary rows 发布成成功 generation。

### R4 [P1] 未发布的 manifest 不能确认并删除 dirty

位置：`migrations/task_execution/V7014__task_board_dirty_and_dispatch.sql:443`。

confirm 只证明 export manifest 存在及 dirty id 属于 coveredDirtyIds；p_publish_sequence 完全由 caller 提供，没有匹配已提交 publication outcome/generation 的证明。因此 record manifest 后即使从未 publish，也能删除全部 covered marker，并记录任意 sequence。tests/persistence/task-board.test.ts:311–324 正好在对应 export 未发布时确认成功并断言 marker 清零。请增加独立的同 Project/exportId/hash/generation/sequence 发布证明，保持 Owner 事务分离，并用发布失败/确认重放负例证明未发布事实不会被 ack。违反 #248 导出恢复验收及 PostgreSQL IM06-BOARD。

### R5 [P1] Fence 必须使用发布时当前时间及 TE control proof

位置：`modules/task-execution/src/persistence/task-board-projection-repository.ts:153`。

registerFence 只比较 caller 提供的 tuple 与 Projection 本地 token，并用 input.now 判断到期；没有读取 TE 当前已提交 claim 的 control proof。dispatcher 又在 pass 开始时只取一次 now。若导出耗时超过 lease，旧 worker 仍以旧 now 发布；即使 TE 已被接管，只要新 worker 尚未注册 Projection fence，这里仍接受旧 tuple。现有 PG 正例甚至以落后真实时钟数分钟、已真实过期的 lease 成功发布。请在注册/发布边界取得当前 TE claim 资格，Projection 事务按当时受信时间拒绝过期，并添加 TE 接管但 Projection 未注册窗口的两连接负例。违反 Spec003 §12.7。

### R6 [P2] AUTHORITATIVE 翻页必须从 decoded.lastTaskId 继续

位置：`modules/task-execution/src/business/task-board-read.ts:365`。

cursor 虽然被 decode 和绑定验证，分页却始终 pageRows(..., undefined)，没有使用 decoded.lastTaskId。来源不变的三个 Task、pageSize=2：第一页 [T11,T12]，带返回 cursor 的第二页仍 [T11,T12]，T13 永远取不到，并继续生成 nextCursor。独立 source-level focused probe 已复现。请保留 decoded paging state 并从最后 Task 后读取，同时验证多页无重复/漏项、来源变化要求重启；这是 #248 BOARD-D-003 的明确验收失败。

### R7 [P2] Cursor codec 必须实现已批准的完整编码与受信期限

位置：`modules/task-execution/src/business/task-board-cursor.ts:218`。

当前 codec 是十一项 16-byte slot + 截断 16-byte HMAC，时间 floor 到秒，keyId 完全未写入/验证，与 Spec003 §12.6 已批准的 198-byte 毫秒 int64、uint32 keyId、完整 32-byte HMAC 布局不同。probe 验证 snapshotAt .123Z 往返变 .000Z，换 unknown keyId 但同 Secret 仍通过，ports.now 已超过 TTL 而 Date.now 尚未到期时仍返回 OK。264 字符只满足长度，并不满足其余契约。请实现批准布局、无损毫秒时间/完整 hash/keyId 绑定、安全整数与 canonical 解码，并按入口受信 now 判断过期，补配对反例；不应静默替换已批准设计。

### R8 [P2] asOf 读取旧 generation 时不能标 FRESH

位置：`modules/task-execution/src/business/task-board-read.ts:470`。

无 cursor 的 asOf 请求会把 target 设为历史 generation，但 aliasChanged 只比较 P1/P2 当前 alias 是否相互变化，完全没有比较 target.generationId 与当前 alias。G2 已是当前 alias，asOf 返回仍保留的 G1，只要 dirty=0 且年龄达标就得到 OK/FRESH。独立 probe 已复现。请让所有路径的 freshness 都以实际读取 generation 为比较对象，历史 G1 至少为 STALE，并按 Spec003 §12.3/12.6 保留相应 data/status 语义。

### R9 [P2] 识别实际导出失败，不能把超预算标成 FRESH

位置：`modules/task-execution/src/business/task-board-read.ts:474`。

dispatcher 实际记录 TASK_BOARD_EXPORT_BUDGET_EXCEEDED，但 handler 只识别 TASK_BOARD_FAILED/REBUILD/PAUSED，其余 failure 被忽略。旧 alias 年龄达标且 dirty=0 时，已发生的超预算导出失败仍返回 OK/FRESH；focused probe 已复现。请统一 producer/consumer 的 failure 语义，真实失败使用 ERROR/FAILED（旧 data 仅按保留/授权规则附带），并确保后续成功发布能够解除对应失败状态。违反 #248 freshness/有限资源验收及 Spec003 §12.3/12.6。

### R10 [P1] 补齐 Issue 明确要求的 owning 入口和并发验收

位置：`.vibe/module-tests/Module-Test-003-TaskExecution.md:654`。

BOARD-D-001–007 和 IP-BOARD-D-001–003 全部仍是 NOT RUN，PR 也明确没有真实 owning producer→完整 Board entry、Grant 撤权生命周期、三 consistency 的入口运行验收。现有新测试仅是内存 handler/authorization mapping 与 synthetic SERVICE Context 的存储调用；未调用 createTaskBoardEntry、runTaskBoardExportPass 或 assembleTaskBoardRows，也没有 required reached-barrier source/alias/late dirty/crash 场景。#248 Acceptance/Verify 将这些作为本切片出口，并未列入 Non-goals；CI full 不能替代它们。请用真实 owning 正链和必要两连接/当前授权反例补齐，分层更新真实证据；HTTP/UI/Provider/性能/独立人工仍可保留 NOT RUN。

## 交付边界

已提交并读回 [GitHub COMMENT review 5408627162](https://github.com/qzhike/zhiju-business-core/pull/249#pullrequestreview-5408627162)，state=`COMMENTED`，绑定上述 SHA，R1–R10 共 10 条代码评论均存在。当前登录账号为 PR 作者，故提交 COMMENT review；`REQUEST_CHANGES` 是 Reviewer 技术结论，不是 GitHub Request changes review 状态。发布后再次读取 PR，head 未变化，仍为 OPEN。

本文件为 Reviewer 本地正式交付，不属于上述被审 SHA；未 commit/push。仅写审查记录和 GitHub comments，不改实现、不合并。R1–R10 交回 Implementer，修复后需按新 head 复审并取得适用验证证据。GitHub publication 结果在 PR 读回；本地审查完成不能代替成功发布。
