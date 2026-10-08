# PR #251 正式审查记录

## 第二轮独立复审（当前结论）

- Reviewer outcome：`APPROVE`。
- Reviewed SHA：`be7c871b789ac3ed6806d10742a32ecc10a590ed`；日期：2026-10-07。
- PR：[#251](https://github.com/qzhike/zhiju-business-core/pull/251)，OPEN、非 Draft；关联 [Issue #250](https://github.com/qzhike/zhiju-business-core/issues/250)。`vibe repo --json` 确认本地与远端 head 一致；比较上一轮 reviewed head `89cdd22eb3310a1586550eb85353e07253d495c1` 的修复增量，并保留对整个 PR 已建立的范围与契约检查。
- 非盲审：从当前 Issue、TD-07 X-01–X-05/§8、Spec 003 §14.1–14.4、EXIT-D-001–006 重建预期。R1 要求故障穿过实际入口调用并使用重放结果继续同链；R2 按记录的人类批准澄清分为独立的迟到 final 与已有 Progress 挂起来源。该验收组合不改变 §23/§27 的生产来源、进度、取消支持集或其它退出 Gate。
- 本轮开始时工作区仅有 `.vibe/reviews/pr-249/Review.md` 的既有改动，保持原样。第一轮正式记录已进入被审查 revision，本轮在其前追加复审，不修改实现，不 commit/push/merge。

### R1 / R2 处理结果

**R1 [P1] 关闭。** `afterCommit` 在真实 owning commit 和 COMMITTED Receipt 可读之后直接抛出；异常穿过内层 `withRecoveryReceiptFaults` 的实际 entry Promise。外层 `withExitResponseRecovery` 作为测试调用方，经 `invokeCommand` 观察该 Promise 拒绝，核对原命令 canonical bytes、已提交业务快照、Receipt 与 invocation 数，再构造新 owning entry，以相同 command/参数重放。只有重放的真实 DUPLICATE 返回给场景；原丢失的 COMMITTED 不返回。Result/Acceptance/finalize/Resolution 的状态与 payload 检查使用该 DUPLICATE 结果继续到同链最终 Completion/EP readback，未全局放宽其它场景的 COMMITTED 预期。pendingResponses 清空、恢复 command 数量等于必需边界数，并保留 EP consume 的 UNKNOWN/backoff/重建 dispatcher 路径。

**R2 [P2] 关闭。** 决定 §8、Spec §14.3 和 EXIT-D-005 已一致记录用户批准的两个独立场景，不再要求一条 Run 同时具有互不相容的提前 Observation/Progress 与 expiry 后首次 final。CANCEL-D-003 恢复真正迟到时序：取消前、CANCELLING 后、ABANDONED 后首次释放前均断言 Driver final/IG Observation 不存在；首次释放原 Attempt 后检查 submittedAt=observedAt 且不早于已提交 endedAt，再经真实 IG/TE 入口观察和隔离。无原 Progress 的 recovery tick 不创建或执行新进度。另一个独立迁移数据库的 cancel-progress 沿 CANCEL-D-008 合法预先观察、建立真实 Progress，再取消并两次执行恢复 tick；原 source/attempt/policy refs 不变、进度 SUSPENDED、无重新 invoke。四场景各自来源和调用数分开记录。

### 本轮验证证据

[Exact-head CI run 37575983418](https://github.com/qzhike/zhiju-business-core/actions/runs/37575983418) 的 headSha 为本轮 reviewed SHA，已完成 SUCCESS；select/checks/persistence/verify 及必需步骤均成功。独立核对 workflow 的 full 路径包含 clean code、独立 clean build、完整 PostgreSQL gate 和所有 selected 结果汇总，满足 #250 required `full`。按项目政策复用该证据，未重复本地 full 或 PostgreSQL 测试。

独立读取 [checks 原始日志](https://github.com/qzhike/zhiju-business-core/actions/runs/37575983418/job/112644929743)：90 files / 1734 tests 全通过；architecture_boundaries PASS；payloads=239、results=79、core_contracts=6；catalog/registry=239 全部 FULL；历史 v1.0 operations=200 compatibility PASS。

独立读取 [persistence 原始日志](https://github.com/qzhike/zhiju-business-core/actions/runs/37575983418/job/112644929800)：PostgreSQL server_version=180006、Flyway OSS 11.20.3；49 files / 640 tests 全通过，无测试 skip 汇总；second migrate no-op，gate passed。`gh run view --log` 的持久化 Verify 步骤未返回后半段，故改用同 job 的原始 logs API 读取完整日志，未以截断输出推断后续结果。完整日志中四个 EXIT 场景分别 state=passed，动态证据为：

| 场景            | 实际证据 |
| --------------- | -------- |
| normal          | 主 invocation=1，独立 Release-required=1；submit/accept/finalize 各 reached=COMMITTED、callerObserved=REJECTED、replayStatus=DUPLICATE；EP 两条独立尾链分别 SATISFIED/UNSATISFIED |
| recovered       | 主 invocation=2，独立 Release-required=2；Resolution reached=COMMITTED、callerObserved=REJECTED、replayStatus=DUPLICATE；EP 两条独立尾链分别 SATISFIED/UNSATISFIED |
| cancel          | invocation=1；Run `01a114d7-bfb8-7489-9885-8d8147e5240d` 为 ABANDONED，endedAt=`2026-10-07T05:31:16.191Z`；原 Attempt final submittedAt/observedAt=`2026-10-07T05:31:16.331Z`；finalProgress=[]，无 Acceptance/Request/Completion |
| cancel-progress | 独立 Run `01a114d8-62f5-7469-b7f5-b359cc15896d`/Attempt；invocation=1、CANCELLING，Progress 为 SUSPENDED/RUN_CANCELLING；原完整 Observation/Attempt refs 与 hash 保留，无 Acceptance/Request/Completion |

本轮核对批准澄清、修复 diff、实际 owning 调用和完整 CI 后未发现新的阻塞 finding。生产实现、公开 API/Schema/Purpose/profile/migration 未变；239/63/200 基线保持。Board/Usage 的独立 owning 预期、只读快照/调用计数、四层 Completion 与独立 Release-required 反例证据维持；不将成功配置验证等同于单独设计或人工验收。

### 边界与交接

原先单独设计审查的 NOT RUN 历史不追认为已执行；本轮独立核对当前批准的验收组合与实现。外部 HTTP/UI/CLI/Provider/Feishu、生产/性能、独立人工业务验收与 Grant PolicySnapshot lifecycle 保持原 NOT RUN/延后。IM-06 原退出 Gate 仍需另行对账。该 tests/composition 与验收文档修复没有新增未决人类技术门禁；APPROVE 不授权 merge 或其它 Git 交付。

本轮按用户授权将 reviewed SHA、R1/R2 关闭依据与验证证据发布到 [PR #251 comment 6032096100](https://github.com/qzhike/zhiju-business-core/pull/251#issuecomment-6032096100)，已通过 `gh pr view --json comments` 读回并核对正文与发布文件完全一致。此为 PR comment 中的独立 Reviewer APPROVE 结论，不是 GitHub 正式 Approve review。本记录的聚焦 Prettier 格式及 diff whitespace 检查通过；复审记录保持未提交，保留第一轮历史和既有 PR #249 工作区改动。

## 合并授权与交付读回（2026-10-07）

用户在第二轮 APPROVE 后明确要求“合并PR，关闭issue及local/remote branch”，授权 PR #251 合并、Issue #250 关闭及对应任务分支清理。本次合并前读回 head 仍为 `be7c871b789ac3ed6806d10742a32ecc10a590ed`，PR MERGEABLE/CLEAN、非 Draft，exact-head select/checks/persistence/verify 均 SUCCESS；未绕过必需门禁。第二轮正式审查记录在合并前已保存在本工作区并通过格式/空白检查，审查结论和完整证据已发布到原 PR；该记录的新增段落尚未单独 commit/push。

采用 `gh pr merge --merge --match-head-commit` 仅合并已审查 SHA。远端读回 PR 为 MERGED，merge commit=`b6e1f93d7a79e6334622c55b94f124750143949e`、mergedAt=`2026-10-07T06:22:30Z`；Issue #250 随合并自动 CLOSED/COMPLETED，closedAt=`2026-10-07T06:22:32Z`。fetch 后确认 reviewed head 为 origin/main 的祖先，本地 main 仅快进并切换到该 merge commit；对应 `issue-250-controlled-exit` 远端分支及本地分支已删除，本地采用安全 `branch -d`。其它 worktree/分支保持原样，原 PR #249/#251 未提交记录在切换后逐字节核对保持完整。

Planner 只更新 roadmap 中已改变的 TD-07 交付事实与下一推进意图；IM-06 保持 Current，按原退出 Gate 另行对账，不因 PR/Issue 关闭扩大外部、人工或原 PARTIAL/NOT RUN 验收。合并后的文档对账和第二轮正式记录留在 main 工作区，未创建额外本地提交或推送。

## 第一轮独立审查

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`89cdd22eb3310a1586550eb85353e07253d495c1`；日期：2026-10-07。
- PR：[#251](https://github.com/qzhike/zhiju-business-core/pull/251)，OPEN、非 Draft；关联工作项：[Issue #250](https://github.com/qzhike/zhiju-business-core/issues/250)。比较基线：`main@b243ce850d9927af3fa1ca8e93158fddc59d89d0`。
- `vibe repo --json` 确认 repository 为 `qzhike/zhiju-business-core`，本地 head 与 PR head 一致。起始工作区有 `.vibe/reviews/pr-249/Review.md` 的既有未提交改动，保持原样。本轮只新增本正式审查记录，不修改实现，不提交、推送或合并。

### 独立预期与审查范围

先从 Issue #250、TD-07 决定 X-01–X-05、Spec 003 §14.1–14.4 与 Module-Test 003 `EXIT-D-001–006` 建立预期，再核对 PR diff 和实际调用路径。normal/recovered/cancel 各自从独立迁移后的空 TE 业务库开始；正式 Completion 与 EP Evaluation 分层成立；Board/Usage 只读且精确关联原来源；四个 Command 和 EP consume 的指定提交后故障必须真实阻断响应或进度，并通过重建入口/worker、原身份重放恢复到同链最终读回；取消链要求实际 ack/start 后取消、原 lease 到期、ABANDONED 后释放并隔离原 final。

读取根 AGENTS、project 配置、HL-Spec §1–6/8–11、验证基准 §1–2/2.8、TD-07 决定、受影响 Spec/Test、相关 final/blocked-input/dispatch/cancellation 规则及 contract-review。独立核对新增 Fixture/Query/Board expectation、既有场景接线、取消 helper、真实 Driver 的 final materialization，以及可复用 Process 提交后崩溃矩阵。未发现生产实现、公开 API/Schema/Purpose/profile 或 migration 变更。提案采用 T2 和已记录的人类设计批准；独立设计审查的 `NOT RUN` 不被本实现审查追认为已执行。

### R1 [P1] 四个 Command 故障未真正丢失调用方响应或进度

位置：[controlled-exit.test.ts:193–198](https://github.com/qzhike/zhiju-business-core/blob/89cdd22eb3310a1586550eb85353e07253d495c1/tests/persistence/controlled-exit.test.ts#L193-L198)；接线：[initial-context-scenario.ts:2508–2520](https://github.com/qzhike/zhiju-business-core/blob/89cdd22eb3310a1586550eb85353e07253d495c1/tests/persistence/initial-context-scenario.ts#L2508-L2520)。

`afterCommit` 的 `EXIT_RESPONSE_LOST` 只从一个独立 Promise 抛出，并在同一 callback 内由 `expect(...).rejects` 完整消费。callback 随即用重建 entry 重放并验证 DUPLICATE，随后 proxy 仍把原 `committed` 返回给原调用方。Result submit、Acceptance、Run finalize、Resolution 的调用方从未收到响应丢失，也没有因本故障留下未确认进度或进入恢复路径；原链始终正常推进。当前证据证明真实提交和直接幂等重放，却不能证明 EXIT-D-003 要求的提交后响应/进度丢失恢复。既有独立 Process 故障矩阵不替代新要求的同链故障。

修正要求：在真实 owning commit 和 Receipt 可读之后，让故障穿过 entry/worker 的实际返回或进度确认边界；由测试捕获原调用失败，核对故障时的业务提交与未确认状态，再重建对应 entry/worker，以保存的原 commandId/target/key/payload bytes 重试，从重放结果继续同链到最终 Completion/EP readback。每个边界保留 reached、Receipt、唯一效果和 invocation 不变断言。EP consume 的显式 UNKNOWN/重建 dispatcher 路径应继续保留。修正并运行前，Module-Test 的 EXIT-D-003 和 PR 中相应 PASS 声明不足以成立。

### R2 [P2] 取消 Fixture 在取消前已经释放 final，遗漏要求的迟到来源时序

位置：[initial-context-verify-run-cancellation.ts:419–420](https://github.com/qzhike/zhiju-business-core/blob/89cdd22eb3310a1586550eb85353e07253d495c1/tests/persistence/initial-context-verify-run-cancellation.ts#L419-L420)；helper：[同文件:738–755](https://github.com/qzhike/zhiju-business-core/blob/89cdd22eb3310a1586550eb85353e07253d495c1/tests/persistence/initial-context-verify-run-cancellation.ts#L738-L755)。

新增的 `prepareCancelFinalProgress` 在 `cancelRow002` 之前调用。它立即 `lateDriver.releaseFinal`，并通过真实 IG entry 持久化 final Observation，然后才创建 Process progress 和发起 Human cancel。ABANDONED 后的第二次 `releaseFinal` 会复用已存在的 final：真实 Driver 的 `materializeFinal` 在 `readFinal` 非空时直接返回，原 submittedAt/observedAt/Hash 不会变成 expiry 后来源。因此本链证明的是“取消前已有 final、取消后隔离旧观察”，没有执行 Spec 003 §14.3、X-04 和 #250 要求的“延迟原 final，原 lease 到期到 ABANDONED 后才释放并隔离”。改动还使既有 supported CANCEL-D-003 使用相同提前释放路径。

修正要求：保持 CANCEL-D-003 的原 final 在取消与到期期间未释放，明确断言 final/Observation 尚不存在；在真实 ABANDONED 后首次释放并通过 IG owning entry 观察原 Attempt 的 final，核对实际观察时间、身份/Hash、LATE_RESULT 隔离以及 Usage/Board/无 Completion。已有 final Process 挂起可继续保留现有 CANCEL-D-008 的合法预先观察证据。TD-07 又要求同来源的原进度停止，而现有 progress 创建需要已观察 final；若现有入口不能同时保留延迟 final 与原进度，则先由 Planner 澄清 Spec §14.3/X-04 的验收组合是否允许分离场景，不能自行拆分后宣称同链满足，也不能通过提前释放绕过时序要求。本轮不授权扩大生产支持集。

### 验证证据与边界

- Required target：Issue #250 的 `vibe verify full --json`。PR 提供了本地 environment/full 和聚焦动态身份日志，但本地 full 在最终文档结果注释之前执行；这些实现者声明与当前 CI 分开记录。
- 独立读取 [CI run 37574394598](https://github.com/qzhike/zhiju-business-core/actions/runs/37574394598)：`headSha` 精确匹配 reviewed SHA。2026-10-07 05:09 UTC，select/checks SUCCESS，persistence IN_PROGRESS，汇总 verify 尚未完成。发布前再次读取 PR，head 未变化。当前尚无可复用的完整 exact-head full SUCCESS。
- workflow 的 ready/persistence 路径覆盖 clean code、独立 clean build 和完整 PostgreSQL gate；CI 完成后可按项目政策复用。上述两个 finding 由直接源码调用路径和权威验收要求建立，即使 full 变绿也仍须修正。
- 本轮未重跑本地 full、PostgreSQL Fixture 或外部系统，不把源码审查写成运行测试。HTTP/UI/CLI/Provider/Feishu、生产/性能、独立人工业务验收与真实 Grant PolicySnapshot lifecycle 保持原 `NOT RUN`/延后；IM-06 退出仍需单独按原 Gate 对账。
- 本正式记录通过仓库既有 Prettier 的聚焦格式检查；新增文件的 diff whitespace 检查无错误输出。这不替代 PR 的 required full。

### 交接

本轮审查意见按用户“审查 PR251 并发布 comments 至原 PR”的授权，已发布到 [PR #251 comment 6031381183](https://github.com/qzhike/zhiju-business-core/pull/251#issuecomment-6031381183)，并通过 `gh pr view --json comments` 读回完整正文，核对 outcome、reviewed SHA 和两个 finding。`REQUEST_CHANGES` 为 Reviewer 角色结论；PR comment 不等于 GitHub 的正式 Request changes review。正式记录保存在当前工作区，Git 交付未获本轮授权，保持未提交。R1 由 Implementer 在已批准范围内修正；R2 先保留真实迟到边界，若同来源进度要求无法同时实现则由 Planner 澄清验收组合。新 head 必须独立复审。
