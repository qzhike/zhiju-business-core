APPROVE — 仅批准进入批次 `batch/mvp-b1-document-delivery`。第四轮复审 `308698abf639a74e0ff130bf15f71182a879f0a9`：R6 的条目写回滚、manifest 提交后响应丢失、独立 PostgreSQL 停启与 Core 进程重启证据已闭合；P2 证据强化已确认。真实 Keycloak、BFF 单独重启/重登、B1-13 本机初始化及 B1-14 正式来源/用户验收仍 NOT RUN。

# PR #312 第四轮独立审查（2026-10-23，批次入口）

- 对象：[PR #312](https://github.com/qzhike/zhiju-business-core/pull/312)，[Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)。
- 阶段：业务子 PR 进入同仓库批次 `batch/mvp-b1-document-delivery`，base `4657f10c44a1645a38188c5c36be0e3c529902c2`。此批准不表示批次 full、main 准入或完整 B1 产品验收完成。
- Reviewed SHA：`308698abf639a74e0ff130bf15f71182a879f0a9`。实现增量在 `c65ba49` 上仅包含测试强化。
- P2 处置：响应丢失注入增加触发断言；条目回滚后以管理查询断言 source_entries=0，接纳后>0；重启测试使用固定 `postgresImageReference()` 并校验 server_version_num；Core 重启后浏览器同时读回两批。
- R6：CLOSED（批次入口范围）。故障注入先提交真实事务再失败，或由真实 PostgreSQL trigger 触发回滚；未提交 staging 不成为可读 source，旧 manifest/bytes 保留，重启/重复启动不产生第二个 manifest。
- R1–R5、R7、R8：沿用前轮 CLOSED 结论，本轮增量未改变其依据。
- 独立证据：共享 custody 21 项、独立重启 1 项、构建浏览器 1 项均通过；精确 head CI 见 PR 评论/检查，最终确认不在本文档内自引用。
- 证据边界：未运行真实 Keycloak 登录/重登、BFF 单独停启、B1-13 真实本机初始化、B1-14 正式来源人工试走与用户验收；不得由批次入口批准推定这些通过。

Implementer/Reviewer 在该稳定候选上完成批次 PR 创建与精确 head 检查；批次 final full、main 合入及合入后 main full 仍按批次设计另行执行。

---

REQUEST_CHANGES。第三轮复审 `4c325b41e99a04f2c4661511ea1850d1ab054fe0`：R7/R8 已修复，R6 新增浏览器补充与原请求恢复覆盖，但必需故障、真实重启及本机验收证据仍未闭合。

# PR #312 第三轮独立审查（2026-10-23）

- 对象：[PR #312](https://github.com/qzhike/zhiju-business-core/pull/312)，[Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)。
- Reviewed SHA：`4c325b41e99a04f2c4661511ea1850d1ab054fe0`，目标 `main`；上一轮为 `035baeb546171c1886e2085194854b523c602b71`。
- T2，完整 B1 项目与资料托管；验收范围未变，无阶段交付豁免。
- 独立读取当前 Issue/PR、六文件增量、受影响实现与回归测试、MVP01 Spec/Test；沿用历史字段矩阵未变部分，不把实施者运行声明当作独立通过证据。

## 发现处置

| ID | 当前状态 | 依据及边界 |
|---|---|---|
| R1–R5 | 保持 CLOSED | 本轮未改变已修复的执行授权、来源隔离、缺包恢复、零字节与分页边界；沿用上一轮针对原始反例的结论 |
| R7 | CLOSED | convergeUploadStaged 仅核对当前 binding，不改旧 attempt 授权；新增真实当前 epoch、首个 EXTRACT 前 durable gap、重开 Service、RECONCILE→STAGED 无 manifest、显式 CONTINUE→RECEIVED 的回归 |
| R8 | CLOSED | 测试从数据库取得实际 epoch 并断言，旧 caller 和真正当前 caller 对旧 attempt 均拒绝，增加当前 epoch 显式 RETRY 后上传成功的正对照 |
| R6 | PARTIAL / OPEN | 新增浏览器补充批次、双批次刷新读回、建批提交后响应丢失的同键恢复；仍缺下述故障与完整验收证据 |

## 剩余阻断与验收边界

R6 / P1：B1-10 仍明确未注入“条目写后 DB 失败”和“manifest 提交后响应丢失”。新的 Browser 故障发生在 create-batch 请求响应，不覆盖文件 store 与 manifest 接纳事务边界。需要定向故障证明未提交 staging 不可读为业务 source、未知提交结果可以核对且只有一次不可变 manifest 接纳、旧 manifest/bytes 不变。

B1-11 仍缺保留持久数据的应用/PostgreSQL 真实进程停启；重建 Service/连接池或刷新网页不能替代。B1-13 工具在真实本机实例的执行、真实 Keycloak、B1-14 正式来源试走与用户验收仍 NOT RUN。这些要求来自 Issue #311 和 owning Test，按适用环境授权及人类门禁补齐；本次复审未初始化实例或要求公开私有材料。

本增量未建立新的产品代码缺陷。R7/R8 关闭是代码与用例前提核验结论，不将仍在运行的 CI 或实施者声称通过升级为本轮独立运行 PASS。

## 本轮字段与操作增量

- RECONCILE：当前身份只记录持锁确认的旧技术事实；旧 attempt 的 authorizedOwnerId/authorizedAuthEpoch 不变，STAGED 不产生 manifest；新 CONTINUE Request 独立授权执行。
- create_input_batch：新意图读取当前 project version；原意图重放保留 marker.expectedVersion、requestId、targetId 与原 payload fingerprint，避免把新版本混入原键。
- 浏览器测试扩展：同一生产构建 Web/BFF/Core/PostgreSQL/store 链路增加补充和建批响应丢失；恢复点击采用 DOM click，证据限于提交及业务恢复，不据此额外宣称全部鼠标可操作性已验证。

## 验证证据

- [CI run 39890508871](https://github.com/qzhike/zhiju-business-core/actions/runs/39890508871)，attempt 1，event pull_request，headSha 精确匹配 Reviewed SHA。最终查询时 checks 和三个 persistence 分片为 IN_PROGRESS；未据此宣称成功或失败，也未复用上一修订绿灯。
- 本轮未重复 full 或 focused 执行；已建立的 R6 必需证据缺口足以提出变更，不为等 CI 延迟发布。
- 发布前后确认 PR OPEN、head 不变；已发布并回读[第三轮总评](https://github.com/qzhike/zhiju-business-core/pull/312#pullrequestreview-5623310554)及 [R6 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/312#discussion_r4355597076)。Review ID `5623310554`，commit_id 精确匹配，平台状态 `COMMENTED`；正文 `REQUEST_CHANGES` 为 Reviewer 角色结论。
- 正式 Review 保存第三轮与前两轮历史；仅更新本文件，未修改产品代码，未 commit/push/merge。

Implementer 补齐 R6 定向故障、真实重启和适用授权下的验收证据，最终候选通过精确 head 检查后再复审，并完成 T2 人类技术门禁及正式 Review 的授权交付。

---

# 第二轮审查历史（仅针对 035baeb，不代表当前未修复清单）

REQUEST_CHANGES。复审 `035baeb546171c1886e2085194854b523c602b71`：上轮 R1–R5 的原始反例已修复，但新增 R7 恢复回归、R8 回归测试前提错误，R6 完整验收仍未闭合。

# PR #312 第二轮独立审查（2026-10-23）

- 对象：[PR #312](https://github.com/qzhike/zhiju-business-core/pull/312)，[Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)。
- Reviewed SHA：`035baeb546171c1886e2085194854b523c602b71`，目标 `main`；上轮审查 SHA：`183d53587145fbd346a0bd3ae578af33d6f06623`。
- 分类与范围：T2，完整 B1 项目与资料托管；最新 Issue 未改变验收，也没有阶段交付豁免。
- 已发布：[第二轮总评及行内comments](https://github.com/qzhike/zhiju-business-core/pull/312#pullrequestreview-5623016392)，review ID `5623016392`，状态 `COMMENTED`；Reviewed SHA 精确绑定。
- 本轮读取最新 Issue/PR/comments、11文件修复增量、相关原实现、MVP01恢复/授权/字段契约、回归用例及精确head CI；沿用下方首轮字段矩阵中未变的部分，不以实施者声称“已修复”代替核验。

## 上轮发现处置

| ID | 本轮状态 | 依据与边界 |
|---|---|---|
| R1 | 原始绕过反例 CLOSED | claimUpload/completeUpload/claimExtraction/acceptManifest 比对持久 attempt owner/epoch；独立隔离数据库检查证明真正当前epoch拒绝旧attempt，显式RETRY后新attempt成功。纯核对路径的新增回归另列R7，已提交回归测试问题另列R8；不宣称全部授权并发问题已穷尽 |
| R2 | CLOSED | source读取要求RECEIVED/PARTIAL及精确已封存manifest，原包来源从manifest解析；upload显式构造BatchView，去除内部originalZipSource/owner泄露；已有staged/拒绝负例及正例 |
| R3 | 原始缺包反例 CLOSED | 无活跃写者、原包缺失/不匹配时，持attempt锁经failIncompleteUpload收敛FAILED并开放RETRY/ABANDON；完整包且epoch变化的组合不属于此关闭，见R7 |
| R4 | CLOSED | DDL允许source_byte_length=0；BFF/UI允许Content-Length=0；真实持久化及构建浏览器覆盖空文件下载 |
| R5 | CLOSED | entries显式最大100，其他列表默认50；HTTP正负边界覆盖51/100/101及projects50/51 |
| R6 | PARTIAL / OPEN | 真实构建浏览器主路径和部分故障证据已补；完整B1出口仍缺下述证据 |

## 本轮阻断项

### R7 / P1：旧 epoch 的完整原包无法通过纯核对恢复

位置：`modules/document-delivery/src/persistence/repository.ts:1516`，convergeUploadStaged新调用assertAttemptAuthorization。

独立反例：当前epoch N建批并owning claim，文件store已发布完整匹配原ZIP，尚未completeUpload/安排首个EXTRACT；binding变更N+1，关闭并重建Service/DB pool，再用实际当前身份RECONCILE。结果RECOVERY_NOT_ALLOWED，batch仍RECEIVING、只有RECONCILE动作、没有EXTRACT/manifest；CONTINUE_EXTRACTION也因没有originalZipSource被拒绝。相同前提但epoch不变的正对照正常STAGED→显式CONTINUE→RECEIVED。

[MVP01 §2/§4.1](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md#41-批次状态)要求区分核对既有技术事实与授权新执行。当前有权的恢复请求持旧attempt排他锁，可以记录已证实的原包和已结束观察，不能借此重授权/启动旧执行。修复应保留执行及接纳的epoch约束，允许纯核对收敛STAGED，随后以新的CONTINUE Request/当前授权建立新attempt，旧授权不可变。增加“首次EXTRACT安排间隙+授权变化+重开服务”的组合用例。

### R8 / P2：fresh-epoch回归测试在完整文件运行时使用过期身份

位置：`tests/persistence/mvp-document-delivery.test.ts:738–742`。

此前prepared-extraction测试已把共享binding从1改到2，未重置。最后的epoch测试继续用最初epoch1 identity建批，再将数据库binding递增到3，却把硬编码epoch2当作fresh。即使移除新增的attempt授权校验，旧的current-binding比较也会因2≠3拒绝，测试不能证明R1拒绝原因。

按契约审查要求及[MVP01 Test B1-01](../../module-tests/Module-Test-MVP01-DocumentDelivery.md)负例目的，应隔离fixture或明确取得并断言实际当前epoch，确保唯一错误是attempt旧授权，并增加显式新授权成功的正对照。本轮独立干净反例确认产品已修复原R1；R8是必须修复的回归证据问题，不重复声称原绕过仍存在。

### R6 / P1：完整 B1 验收证据仍不齐全

新增mvp-built-browser确实启动production构建Web/BFF/Core，使用真实PostgreSQL/file store与synthetic OIDC，覆盖登录、建项目、混合包、限制、空来源/原包下载、页面刷新读回；此部分认可。新增同epoch首个EXTRACT间隙、已有PREPARED EXTRACT授权变化后重开Service、并发claim与迟到旧generation检查也认可。

但Browser未覆盖补充批次和原请求恢复；条目写后DB失败、提交响应丢失等必需故障仍在owning Test标为未运行。实际应用/PostgreSQL保留数据停启、真实Keycloak、正式来源本机试走与用户内容验收也仍NOT RUN。Issue #311要求完整结果，未获缩减/分阶段批准。补齐可自动化证据；持久实例试走和适用人类技术门禁按其授权边界完成，本次复审不代为初始化。

## 字段与操作矩阵增量

下方首轮矩阵为历史对照；本表覆盖本轮发生变化的字段/边界，不把旧问题描述当作当前状态。

| 契约 | 字段与约束 | 当前结论 |
|---|---|---|
| BatchView / upload result | batch保留BatchSummary全部字段及originalRequestId/policyVersion/observedAt；note?/currentAttempt?；无owner/internal原包字段 | Service改用batchView构造，R2关闭 |
| SourceRef / read_input_source | projectId,batchId,sourceId,kind,sha256,byteLength,mediaType；只允许已封存manifest来源；byteLength允许0 | source通过sealed manifest解析；DDL/BFF/UI零长度一致，R2/R4关闭 |
| get_input_entries | manifestId必需；limit?=1..100、cursor?；结果manifest/entries/nextCursor?不变 | 独立maximum=100，其他列表50，R5关闭 |
| Attempt授权 / recovery | authorizedOwnerId/authorizedAuthEpoch与当前执行授权一致；RECONCILE只核对，新的执行用新Request授权 | 执行原绕过已修，核对错误复用相同epoch前提导致R7 |
| RECONCILE缺包结果 | 当前batch/attempt及reasonCodes，FAILED意味着有锁和已终止证据；新执行仍需新Request | 原R3已修；完整包旧epoch组合另列R7 |
| BFF trust config | postLogoutRedirectUri只允许当前publicOrigin的/workbench或/custody | 新增有限同源/custody，构建Browser登录路径已执行；不扩为任意外链 |

## 证据与交付边界

- [CI run 39876693765](https://github.com/qzhike/zhiju-business-core/actions/runs/39876693765)：headSha精确匹配Reviewed SHA，checks、三个persistence分片、persistence汇总及verify全部SUCCESS。复用本次可信CI，不重复本地full。
- `vibe verify environment --json`：宿主PASS，Docker29.8.2、固定镜像cached且registry pin-match。
- 独立focused：`node tools/persistence/gate.mjs --test-file=tests/persistence/mvp-rereview-312.test.ts`，一次性PostgreSQL18.6及真实file store，3个诊断断言均符合观察结果，exit0。其一证明原R1修复及显式重试成功，其二为同epoch正常恢复，其三确认R7错误存在；不是全部业务验收PASS。
- 崩溃间隙通过owning claim+durable store写构造，未直接写业务表制造成功事实；数据库管理员只修改隔离测试binding作为epoch输入。重建了Service/连接池，没有声称真实kill或PostgreSQL进程重启。
- 临时诊断代码从仓库移除，留本机 `/tmp/pr-312-rereview-counterexamples.test.ts` 供复核；容器已清理。未修改产品实现。
- 正式Review保留首轮历史，本轮更新尚未Git提交；用户授权仅复审及comments，不推断commit/push/merge或持久环境初始化授权。

Implementer修复R7/R8并补R6必要证据，之后复审新的精确head。最终仍需适用T2人类技术门禁及正式Review纳入授权交付。

---

# 首轮审查历史（仅针对 183d535，不代表当前未修复清单）

REQUEST_CHANGES。PR #312 当前修订存在授权 epoch、原包隔离、恢复出口和合法输入契约缺陷；已有绿色 CI 不足以关闭这些反例及 Issue #311 尚未完成的验收。

# PR #312 独立实现审查

- 日期：2026-10-22。
- PR：https://github.com/qzhike/zhiju-business-core/pull/312
- Issue：https://github.com/qzhike/zhiju-business-core/issues/311
- Reviewed SHA：`183d53587145fbd346a0bd3ae578af33d6f06623`。
- Base：`main@3555e85508a17a4c86f302f7da6f1c1be576571b`。
- 范围：T2，完整 B1 项目与资料托管结果；项目未配置阶段交付豁免。
- 发布前及发布后回读：PR OPEN，head 与 Reviewed SHA 相同。
- 已发布并回读：[审查总评及5条行内comments](https://github.com/qzhike/zhiju-business-core/pull/312#pullrequestreview-5616457504)，review ID `5616457504`，平台状态 `COMMENTED`，commit_id 与 Reviewed SHA 相同。

## 独立预期及审查边界

依据 Issue #311、HL-Spec、已批准 B1 设计、MVP01 Spec/Test、共享 MVP API 约定建立预期，再检查实现：当前身份准入不重新授权旧 attempt；原包 staging 不成为业务接纳；没有活跃写者且无完整原包时有安全重试出口；合法三格式和空文件不会被无关约束破坏；请求、receipt、BatchView、分页和下载跨层一致；完整 B1 需真实持久化与浏览器链路证据。

审查集中于新 Core/BFF HTTP 边界、MVP01 Service/Repository/DDL、存储/格式分类、对应测试和实际 CI。已确认阻断问题后停止继续扩展取证；本记录不声称对 74 个变更文件的所有语义完成穷尽审计。没有修改实现来配合 Reviewer 结论。

## 阻断发现

| ID | 优先级 | 触发及实际结果 | 违反的要求 / 修复方向 |
|---|---|---|---|
| R1 | P1 | epoch=1 创建 batch，binding 升至2后用新身份上传旧 attempt；最终 RECEIVED，UPLOAD/EXTRACT 授权仍为1，无 recovery Request | MVP01 §2：持久 attempt owner/epoch 必须在开始副作用和接纳时与锁定当前 binding 比对；显式恢复才能授权新执行。`repository.ts:976–983`、completeUpload/claimExtraction/acceptManifest 均只核验传入 epoch |
| R2 | P1 | `../escape.md` 危险外包最终 REJECTED、无 manifest，但利用 upload 返回的 staged original sourceId 仍能下载原包 | MVP01 §2/§4.2：未接纳原件只允许内部隔离诊断。`repository.ts:598–607` 应通过已封存 manifest 解析原包，upload 应返回 BatchView 而不是内部 BatchRecord |
| R3 | P1 | owning claim 后终止、没有完整原包且无活跃写者，两次 RECONCILE 后 batch/attempt 仍 UNKNOWN，仅允许 RECONCILE，RETRY_UPLOAD 拒绝，项目占用不能解除 | MVP01 §4.1/B1-09：持排他锁核对 staged/final 对象和已结束事实，以 CAS 收敛到可重试/安全放弃状态。`service.ts:442–445` 不能对已证实的缺包永久保留 UNKNOWN |
| R4 | P2 | 安全 ZIP 含 empty.md 和普通 Markdown，分类接受空 UTF-8，但 source_byte_length > 0 导致整个 manifest 回滚并 FAILED | MVP01 §1/§5 允许文件 byteLength=0。DDL:231–232、BFF/UI 下载的正数 Content-Length 检查须一致支持空来源；原 ZIP declaredBytes 仍要求正数 |
| R5 | P2 | HTTP entries 的合法 limit=51..100 被共享 limitParameter 的50上限拒绝 | MVP01 §3：entries 允许1..100，其他列表1..50。`http.ts:280–285` 应传独立上限，补 HTTP 边界正负例 |
| R6 | P1 | 完整 Browser→BFF→Core→PostgreSQL/store、并发/迟到 generation、首次 EXTRACT 崩溃与提交丢失等必需证据仍缺；真实本机试走和用户验收未完成 | Issue #311 Acceptance/Verify、B1-08–14；补定向自动化证据，按单独环境授权完成持久实例试走，不能把旧 Browser 检查/组件解析测试当作 B1 完成 |

R1–R4 已通过独立真实 PostgreSQL/文件 store 反例确认。R5 为直接代码与契约对比。R6 为最新 Issue、实际变更测试及 PR/owning Test 的 NOT RUN 状态核对。以上不是偏好或可选打磨；均落在已批准实现范围内。

## 字段与操作对照

`?` 表示可省略；数组保留原顺序，不擅自改为集合。此表记录字段边界，不把静态类型检查提升为所有 HTTP/业务场景通过。

| 契约 | 必需字段 / optional 字段 | 实现对照及差异 |
|---|---|---|
| SessionView | ownerId, displayName, authEpoch, capabilities, instanceId | Service 构造 PROJECT_CUSTODY；Core 解析当前 binding；执行旧 epoch 的问题见R1 |
| ProjectSummary / ProjectView | projectId, customerName, title, createdAt, version；View增加lastBatchNo, analysis；activeBatchId? | rows 显式构造；analysis 固定 UNAVAILABLE/ANALYSIS_NOT_CONNECTED |
| create_project | customerName, title；path projectId / key requestId | closedObject 必需字段及未知字段检查；名称1..512 UTF-8 bytes；原字符串入幂等hash |
| create_input_batch | expectedProjectVersion, originalName, declaredBytes, zipSha256；note?；path projectId/batchId / key | closedObject 校验；名称1024 bytes、note4096 code points/16384 bytes、ZIP正数≤100 MiB |
| Request / Authorization | requestId, ownerId, projectId, operation, targetId, originalPayload, payloadHash, authorization, receipt, createdAt；authorization=ownerId,authEpoch,authorizedAt | insertRequest/DDL 保存；执行时未强制原授权等于当前授权，见R1 |
| Receipt / RequestView | receipt=requestId,projectId,operation,targetId,payloadHash,committedAt,result；view=requestId,projectId,operation,targetId,payloadHash,receipt | owning request 查回/重放；result 为操作快照，与资源当前查询分离 |
| BatchSummary / BatchView | batchId,projectId,batchNo,kind,originalName,declaredBytes,zipSha256,status,version,createdAt,reasonCodes；manifestId?；View增originalRequestId,policyVersion,observedAt；note?,currentAttempt? | 普通 rows 构造与类型一致；upload 返回内部 BatchRecord，额外暴露 originalZipSource 且不构造 currentAttempt，见R2 |
| AttemptSummary / 持久 Attempt | summary=attemptId,kind,number,generation,status,startedAt,reasonCodes；endedAt?；持久增加归属、授权引用/epoch、固定输入、receipts、incarnation/fence | 状态/不可变字段有DDL；授权消费与恢复语义见R1/R3，不能由存有字段推定约束生效 |
| Manifest / ManifestSummary | manifestId,schemaVersion,ownerId,projectId,batchId,batchNo,originalZip,entries,policyVersion,extractorVersion,createdAt,manifestHash；note?；summary=manifestId,manifestHash,batchId,originalZip,totalEntries,acceptedEntries,limitedEntries,createdAt | manifest 有独立hash域、不可变DDL；安全接纳/空条目边界见R2/R4 |
| Entry | entryId,ordinal,originalName,normalizedPath,status,reasonCodes；mediaType?,byteLength?,sha256?,sourceRef? | 四种状态；仅ACCEPTED带来源。空文件source长度跨层矛盾见R4 |
| SourceRef | projectId,batchId,sourceId,kind,sha256,byteLength,mediaType | 查询含完整path归属；原包未绑定接纳manifest见R2；空文件读取见R4 |
| list_projects / list_input_batches | limit?,cursor?；结果items,nextCursor? | HTTP上限50；repository 高水位/签名scope，items保留数组 |
| get_input_batch | attemptLimit?,attemptCursor?；结果batch,attempts,permittedActions；nextAttemptCursor?,manifest? | 当前attempt独立于历史页；UNKNOWN动作无法完成安全收敛见R3 |
| get_input_entries | manifestId；limit?,cursor?；结果manifest,entries；nextCursor? | manifest绑定和分页存在；HTTP limit上限错误见R5 |
| recover_input_batch | expectedBatchVersion,action；result=batch,recoveryRequestId | 四动作闭集和CAS；恢复及授权前提仍须修复R1/R3并补故障证据 |
| upload_input_zip | application/zip，Content-Length，attempt/generation头，原始bytes；result=batch:BatchView | 上传独占claim及校验；实际result为BatchRecord，参见R2；不能据202宣称manifest |
| read_input_source | project/batch/source路径；返回原字节、长度/hash、attachment/no-store/nosniff | 接纳状态与空文件读取限制见R2/R4 |
| 公共 envelope | success=ok,data,observedAt；receipt?；error=ok,error,observedAt；error含code,message,retryable，requestId? | Core helper 构造；严格JSON/闭对象有实现。错误和结果跨层完整负例/真实Browser验收仍缺，见R6 |

## 验证证据与局限

- Reviewed SHA 的 [CI run 39776055448](https://github.com/qzhike/zhiju-business-core/actions/runs/39776055448) 为 SUCCESS；code、三个 persistence 分片及汇总 verify 均成功，headSha 已精确核验。复用此证据，未重复本地 full。
- 宿主 `vibe verify environment --json` PASS，Docker 29.8.2，固定 PostgreSQL/Flyway 镜像 cached 且 registry pin-match。沙箱首次环境检查因 pnpm registry fetch 失败未启动目标，Docker只读probe也被权限拒绝；宿主重试成功，未更改校验策略。
- 独立 focused diagnostic 使用项目 `node tools/persistence/gate.mjs --test-file=tests/persistence/mvp-review-312.test.ts`，一次性 PostgreSQL18.6、真实DDL/Repository/Service/file store，产品代码保持Reviewed SHA不变；4个断言确认R1–R4的实际错误行为，exit0。它不是full或业务验收PASS。
- 初次诊断3个反例确认；R3的Reviewer断言误把attempt预期写为RUNNING，实际为UNKNOWN。只修正此诊断断言后重跑，4个反例均确认。该修正不是产品修复。
- R3通过owning claim后不执行后续写来模拟已终止进程的持久状态；没有直接写业务表构造成功链，也没有声称执行了真实kill/restart。R1通过隔离测试管理员变更绑定epoch，这是其受控输入。
- 诊断临时文件已从仓库移除，脚本保存在本机 `/tmp/pr-312-counterexamples.test.ts` 供复核；临时容器已清理。脚本断言错误行为存在，Implementer应改成契约应满足的回归断言。
- NOT RUN：真实员工Keycloak登录、完整Browser链、正式来源三格式本机试走、应用/PostgreSQL真实停启与用户反馈；其余尚缺的并发/崩溃/迟到故障矩阵。未初始化用户持久实例，未接触Runner或既有环境数据。

## 交付与后续

本轮按用户要求在 PR 发布带 Reviewed SHA 的 COMMENT 审查及行内意见；当前账号是 PR 作者，COMMENT 不等于 GitHub REQUEST_CHANGES review 状态。正式记录仅落盘，未获本地 Git 提交/推送授权，关闭前仍须将其纳入授权交付。

Implementer修复R1–R5并补R6证据；最终候选需重新独立审查、适用T2人类技术门禁和精确head检查。本结论不批准合并，未修改业务代码、commit、push、merge或执行持久实例初始化。
