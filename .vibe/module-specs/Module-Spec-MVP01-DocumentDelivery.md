# Module-Spec-MVP01-DocumentDelivery

日期：2026-10-23

状态：`IMPLEMENTED 2026-10-22 / AUTOMATED EVIDENCE PARTIAL / LOCAL PERSISTENT JOURNEY VERIFIED / USER ACCEPTANCE NOT RUN`。实现位于 `modules/document-delivery`（独立迁移 `migrations/V0001__document_delivery_schema.sql`）、`apps/api/src/mvp*`、`apps/workspace-bff/src/{routes,app,body}.ts` 的 `/bff/mvp/v1` 适配、`apps/workspace-web/src/custody` 与 `tools/mvp-environment`。自动化覆盖见 [MVP01 Test](../module-tests/Module-Test-MVP01-DocumentDelivery.md)；隔离本机初始化、真实 Keycloak 登录及保留卷/文件的停启读回已执行；正式来源人工试走和内容验收仍未运行。

本文件拥有新精简应用的 B1 字段、状态和操作语义；[B1 设计](../mvp/b1-design.md)拥有取舍，模块所有权由 02、持久化映射由 07 拥有。旧七模块 API/Schema 的约束不被追溯更改。B2–B5 未在此注册或实现。

2026-11-03 用户已决定取消嵌套 RAR 处理，上传含内层压缩文件时整包拒绝。指定测试实例已按单独升级授权运行第 10 节的 `@4` 接收兼容性及 V0004；客户新批次已实际接收，人工内容验收仍待执行。旧结果保留历史含义。

## 1. 范围、身份与基础类型

`DocumentDelivery` 是新 MVP composition 的唯一业务 Owner。项目只是文档交付项目；客户名称为项目描述，不创建旧 Enterprise/Fact/QMS/Preparation 对象。单部署显式绑定一个员工 OIDC `(issuer, subject)`，没有公开注册、账号转换、成员邀请或授权管理操作。

Core 每次独立验证 token、BFF peer/session binding/trust-config；验证后用精确 issuer/subject 解析本实例唯一启用的 `operator_binding`，取得 `ownerId` 与 `authEpoch`。无匹配拒绝；不得按邮箱/名称自动绑定。服务端将 owner 写入新对象，客户端不得提供或覆盖 owner、actor、权限或 object-store key。保留 OIDC PKCE/state/nonce、可信元数据/JWKS、Cookie/Session、Origin/CSRF、同源及失权清理的现有安全底线，BFF 重启后重登，不以 Session 存业务状态。数据库绑定停用/epoch 改变必须逐请求生效，查询不可使用旧授权缓存。

全部资源读写均先检查当前绑定及 owner，项目内的 batch/source/manifest/attempt 必须精确属于路径 project。RLS 是纵深保护，不替代服务端检查。无权/不存在资源统一 404；已登录但未获实例准入为 403。B1 不提供多用户产品能力；隔离测试可布置另一 owner 的封闭数据作为负例。

基础类型沿 [MVP v1 共享协议](../api-contract-v0.1/API-Contract-v0.1.md#mvp-v1-b1-共享协议已批准设计)：UUIDv7、UTC RFC3339、十六进制 SHA-256、安全整数。version/batchNo/attempt number/generation/ordinal 从1开始；计数和文件 byteLength 可为0，声明的 ZIP declaredBytes 必须为正且不超过 policy。原始提交字符串不 trim/NFC 改写后参与幂等；只对非法值拒绝。所有 JSON 是闭对象，未知/重复字段拒绝，optional 缺省用省略，不用 null。`version` 是并发令牌；它不能代替不可变 manifest/source 身份。

## 2. 持久事实与不变量

| 对象 | 必须保存的字段/语义 |
|---|---|
| Project | `projectId, ownerId, customerName, title, createdAt, version, lastBatchNo`；名称/title 各 UTF-8 1..512 bytes，至少一非空白字符、无控制字符；不按名称自动合并项目 |
| Request | `requestId` 来自 Idempotency-Key；`ownerId, projectId, operation, targetId, originalPayload, payloadHash, authorization:{ownerId,authEpoch,authorizedAt}, receipt, createdAt`；创建请求与其目标同事务提交；请求成功仅证明该操作声明的事实 |
| InputBatch | `batchId, ownerId, projectId, batchNo, kind, originalName, declaredBytes, zipSha256, note?, policyVersion, status, version, originalRequestId, createdAt`；`kind` 由 batchNo=1 推导 INITIAL，其余 SUPPLEMENT；名称 UTF-8 1..1024 bytes 无控制字符；note 可选，非空、≤4096 Unicode code points 且≤16384 UTF-8 bytes，只允许 TAB/LF/CR 作为控制字符 |
| BatchAttempt | `attemptId, batchId, kind:UPLOAD|EXTRACT, number, generation, status, processIncarnation, fencingToken, startedAt, endedAt?, errorCodes, stagedObjectReceipts`；另保存 `authorizationRequestId, authorizedOwnerId, authorizedAuthEpoch`，精确引用首次创建或显式恢复 Request 的不可变 authorization；记录固定输入及原尝试；状态变化留 append-only event，不能覆盖旧尝试来重试 |
| InputManifest | `manifestId, schemaVersion:'mvp.input_manifest@1', ownerId, projectId, batchId, batchNo, originalZip:SourceRef, note?, entries:Entry[], policyVersion, extractorVersion, createdAt, manifestHash`；原子封存，之后不可改；entries 按 central-directory ordinal 排列，不按名称或 hash 合并 |
| Entry | `entryId, ordinal, originalName, normalizedPath, mediaType?, byteLength?, sha256?, status, reasonCodes, sourceRef?`；status=`ACCEPTED|UNSUPPORTED|CORRUPT|READ_LIMITED`；只有 ACCEPTED 带 SourceRef，必须有实际 bytes/length/hash；其他条目不得伪造来源引用，已安全取得的元数据仍可显示 |
| SourceRef | 闭对象 `{projectId,batchId,sourceId,kind:'ORIGINAL_ZIP'|'ACCEPTED_ENTRY',sha256,byteLength,mediaType}`，每项不可变；服务端核验全 tuple/归属，不能只比较 sourceId；原 ZIP 与 accepted 条目各有独立身份，即使字节相同也不合并业务来源 |

`manifestHash = SHA256(UTF8('mvp.input_manifest@1\n') + UTF8(cv1(payload without manifestHash)))`；cv1 复用已有 canonical JSON 算法，entries 保留声明顺序；文件 SHA-256 只作用原始字节，两个 Hash 域不可互换。note 留在 manifest 作为明确的人类资料说明，不作为系统指令；禁止写进普通日志/事件。

每个 JSON 写在锁定当前 binding 后保存不可变 authorization，不保存 token/subject。原 Request/receipt 的授权版本不会在重放或重登时改成新 epoch；当前有权查看历史不等于重新授权旧执行。worker 必须比较 attempt 固定的 owner/epoch 与当前 binding，在每次开始副作用及接纳事务中重验；旧 epoch 不匹配则停止自动推进，原字节/结果保留，未能确认写者结束仍为 UNKNOWN。只有当前员工显式提交 RETRY_UPLOAD/CONTINUE_EXTRACTION 创建的新 Request 才能成为新执行的授权依据；新 attempt 引用它，旧 Request/attempt/receipt 原样保留。RECONCILE 只授权核对/收敛观察，不能替旧 epoch 接纳 manifest 或启动提取。已提交 manifest 只按当前访问权读回，不重新接纳。


主要不变量：

1. 创建 Project 不需要公司模板发布、Runner、旧预设、旧 IP capability、Fact/QMS 或 Project start；缺 B1 的认证/数据库/文件 store 配置仍拒绝启动。
2. 一项目一次活动接收/提取批次；新批次在 Project 行锁下分配连续 batchNo、递增 project.version，并占用 activeBatchId。多个项目可有各自批次；首版 worker 可串行。
3. 补充批次追加，不覆盖前批。相同名称/相同 bytes 可作为用户明确发起的另一批次，保留来源；同一请求重放不能创建另一批。批次不是文件修订身份，不在 B1 合并不同批次的同名文件。
4. `RECEIVED` / `PARTIAL` 只证明已提交精确 manifest。它们不表示文件读懂、业务有效、已分析或可生成。后续 B2 只能显式绑定 manifest/source 集合，不自动把新补充批次加入已固定输入。
5. 原包安全失败不产生业务 SourceRef/manifest；原件可隔离保留，仅内部诊断可读。已接纳来源/manifest 不原地改为别的内容。
6. Request/Project/Batch 属于同一 Owner 的明确事务边界；没有跨旧模块事务或旧 Event 驱动。B1 不发布 Runner 任务。

## 3. 有限 API 与返回形状

Core 前缀 `/api/mvp/v1`，BFF 前缀 `/bff/mvp/v1`，下表使用相对路径。名称由 [06 的 B1 目录](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#mvp-b1-独立目录已批准设计)登记。JSON 写均需 Idempotency-Key；GET/流读也受当前会话和归属保护。BFF 不接收任意上游路径，Core 仅接受已配置 BFF peer。任一未实现操作返回明确不可用，不走 fixture。

| Operation / HTTP | 输入 | 成功 result / 语义 |
|---|---|---|
| `mvp.get_session` GET `/session` | 无业务参数 | `{ownerId, displayName, authEpoch, capabilities:['PROJECT_CUSTODY'], instanceId}`；只在本实例绑定可用时返回；不返回 subject/token/权限凭据 |
| `mvp.create_project` PUT `/projects/{projectId}` | `{customerName,title}` | `{project:ProjectView}`；201 初次 / 200 同键重放；单事务保存 Request、Project 与创建 event |
| `mvp.list_projects` GET `/projects` | `limit?:1..50` 默认20，`cursor?` | `{items:ProjectSummary[],nextCursor?}`；仅当前 owner，不提供全局搜索或企业扫描 |
| `mvp.get_project` GET `/projects/{projectId}` | 无 | `{project:ProjectView}`；含 version、lastBatchNo、activeBatchId?、`analysis:{status:'UNAVAILABLE',reasonCode:'ANALYSIS_NOT_CONNECTED'}` |
| `mvp.create_input_batch` PUT `/projects/{projectId}/batches/{batchId}` | `{expectedProjectVersion, originalName,declaredBytes,zipSha256,note?}` | `{batch:BatchView}`；201 初次 / 200 重放；初始 status=AWAITING_UPLOAD，attempt/generation=1，policy 固定；无文件 bytes 时不能说已收到 |
| `mvp.list_input_batches` GET `/projects/{projectId}/batches` | `limit?:1..50` 默认20，`cursor?` | `{items:BatchSummary[],nextCursor?}`，包含失败/受限/未知批次，不隐藏无 manifest 的批次 |
| `mvp.get_input_batch` GET `/projects/{projectId}/batches/{batchId}` | `attemptLimit?:1..50` 默认20，`attemptCursor?` | `{batch:BatchView, attempts:AttemptSummary[],nextAttemptCursor?,manifest?:ManifestSummary,permittedActions:Action[],rejectedArchivePaths?:string[]}`；纯读取与必要 inspect，不创建尝试、不续 worker |
| `mvp.get_input_entries` GET `/projects/{projectId}/batches/{batchId}/entries` | `manifestId,limit?:1..100` 默认50，`cursor?` | `{manifest:ManifestSummary,entries:Entry[],nextCursor?}`；manifest 缺失返回409 `MANIFEST_NOT_READY`，不能把空列表冒充完整清单 |
| `mvp.get_request` GET `/requests/{requestId}` | 无 | `{requestId,projectId,operation,targetId,payloadHash,receipt}`；授权后读本人的原命令结果；404/503 不证明旧请求未执行，UI 不能换 key 重建 |
| `mvp.recover_input_batch` POST `/projects/{projectId}/batches/{batchId}/recovery` | `{expectedBatchVersion,action:'RECONCILE'|'RETRY_UPLOAD'|'CONTINUE_EXTRACTION'|'ABANDON'}` | `{batch:BatchView,recoveryRequestId}`；恢复命令先原子提交 Request/receipt 与新尝试的 PREPARED 状态（仅需新执行时），或 ABANDONED 与活动占用释放；其后执行有限恢复；原输入/sha 不可改；动作资格在写入时重新核验 |
| `mvp.upload_input_zip` PUT `/projects/{projectId}/batches/{batchId}/zip` | `application/zip`、精确 Content-Length、`X-Mvp-Upload-Attempt`/`X-Mvp-Upload-Generation`；body 为原 bytes | `{batch:BatchView}`；202 仅表示流已校验且进入持久提取安排，不证明 manifest 已存在；已封存批次拒绝再次上传409 BATCH_SEALED，引导查询原结果，不声称核对了未读取的重发body |
| `mvp.read_input_source` GET `/projects/{projectId}/batches/{batchId}/sources/{sourceId}/content` | 无 locator/ticket 参数；源必须为已接纳 SourceRef | 原始 bytes，精确 Content-Length、SHA-256 响应元数据、`Content-Disposition: attachment`、nosniff/no-store；不返回 object key；拒绝 Range/压缩转换；失败不宣称已保存或已送达 |

`ProjectSummary={projectId,customerName,title,createdAt,version}`；`ProjectView` 在此基础上增加 lastBatchNo/activeBatchId?/analysis。`BatchSummary={batchId,projectId,batchNo,kind,originalName,declaredBytes,zipSha256,status,version,createdAt,manifestId?,reasonCodes}`。`BatchView` 增加 originalRequestId、note?、policyVersion、currentAttempt?、observedAt；不含存储定位。`AttemptSummary={attemptId,kind,number,generation,status,startedAt,endedAt?,reasonCodes}`；`ManifestSummary={manifestId,manifestHash,batchId,originalZip,totalEntries,acceptedEntries,limitedEntries,createdAt}`，计数来自完整已封存集合。`Action` 是上述四个 recovery action，不是客户端可任意执行的许可；write 必须重新校验。

分页 cursor 是不透明、服务端认证的数据，绑定 owner/authEpoch、endpoint、project、上界和最后位置；不可跨用户/项目/过滤复用。项目以不可变创建序号分页，首请求锁定高水位；批次以 batchNo 且锁定上界分页；条目绑定 manifestId/hash 和 ordinal；尝试历史按批内创建序号及首请求上界分页，currentAttempt 始终单独返回，不能因历史分页漏掉当前状态。新数据不插入既有分页快照，刷新开新快照；失权或 binding 变化拒绝 cursor。无数据与依赖故障不同，不把故障返回空成功。

请求 receipt 结构固定 `{requestId,projectId,operation,targetId,payloadHash,committedAt,result}`，只有操作事务提交后存在。result 为表中该操作的 result；批次创建/恢复 receipt 是当时结果，不随 worker 更新。`get_input_batch` 是当前状态；receipt 不能被改写成最新状态。同 owner/key 改 method/operation/project/target/payload 任一项返回409 `IDEMPOTENCY_CONFLICT`。Project/batch target 已被其他请求占用也409，不复用他人 receipt。每个 response 的公共 envelope 见共享 API。

## 4. 状态与恢复

### 4.1 批次状态

Attempt status 闭集为 `PREPARED|RUNNING|SUCCEEDED|FAILED|UNKNOWN|ABANDONED`。PREPARED 已有固定输入/目标，无外部副作用；取得锁并完成当前授权/fence 校验才转 RUNNING。SUCCEEDED 只表示本次 UPLOAD durable staging、EXTRACT manifest 接纳，不是整个业务完成；FAILED/ABANDONED 必须有已结束证明，UNKNOWN 不作为终态，后续只能核对原尝试。旧 attempt 状态可随已证实观察收敛，但身份/输入不变，所有变化追加 event；任何新执行追加 attempt 而不重开终态。generation 是 batch 级单调 fence，每次安排新执行在锁/CAS 下递增；初始 UPLOAD 为1。查询与纯 inspect 不分配 generation，RECONCILE 若需持久状态收敛，也须取同一 attempt 锁并核验旧 fence，不能使活跃写者失效。

| 状态 | 含义 / 合法后续 |
|---|---|
| AWAITING_UPLOAD | 意图已提交，尚无完整原包；可首次流上传；未开始前可按相同 attempt 上传，不新建批次 |
| RECEIVING | 原 attempt 独占接收流；重复流409 `UPLOAD_BUSY`；页面只能查原请求 |
| STAGED | 原包已 durable 且 sha/长度匹配，尚无 manifest；可在原输入上开始/继续提取 |
| EXTRACTING | 固定 policy/extractor 正在处理；只读查询，不重复启动 |
| RECEIVED | 全部普通文件条目 ACCEPTED，manifest 已封存；解除项目活动占用 |
| PARTIAL | manifest 已封存，含 UNSUPPORTED/CORRUPT/READ_LIMITED；可为0 accepted，清楚显示无可处理源；解除活动占用，后续可补资料 |
| FAILED | 已确定原 attempt 终止，技术失败且有明确恢复方式；不冒充内容拒绝；恢复时保留失败 event |
| REJECTED | 原包安全/完整性/全局资源预算或嵌套压缩文件策略拒绝，不能产生业务 manifest；解除活动占用；改内容必须显式新批次，不以 retry 改原 bytes |
| ABANDONED | 用户显式放弃尚未接纳且已证明无活跃写者的批次；保留原意图/错误与隔离对象，解除活动占用；不是取消运行中进程或删除历史 |
| UNKNOWN | 存储、数据库提交或原进程结果未定；锁定项目活动占用，只能 RECONCILE；时间/网络断开不能转成 FAILED |

`RECONCILE` 只核对原 request、attempt、文件 receipt 与 DB 事实，不执行另一份上传/分析；命令以独立 recovery request 留意图及核对观察，不创建替代原尝试的执行。完整原包已存在则核验后恢复 STAGED；该收敛只记录旧 writer 的已证实观察，可由当前授权的恢复 Request 在 epoch 变化后执行，但不改变 attempt 原授权；续提取必须另有符合资格的 CONTINUE_EXTRACTION 意图；manifest 已提交则返回同一结果。无可靠证据保持 UNKNOWN，并显示需检查依赖/原尝试；无盲目“标为结束”按钮。

`RETRY_UPLOAD` 仅在已知 FAILED/AWAITING_UPLOAD 的原 attempt 已结束、无完整匹配 staged 原包且未有 manifest，且没有活跃旧写者时许可。在 Batch CAS 下废止旧 generation，追加新 UPLOAD attempt，重传同一声明 sha/length 的原包；不允许从重试改名称/note/内容。`CONTINUE_EXTRACTION` 在原完整包经 inspect 证明可用、无 manifest，且没有活跃写者时允许：既包括从未建立 EXTRACT attempt，也包括已有 EXTRACT attempt 全部已证实结束。持有原 attempt/实例互斥锁并校验 Batch CAS 后，一个事务保存恢复 Request/当前 authorization/receipt、原尝试的已证实结束观察、新 PREPARED EXTRACT attempt（稳定输入/目标、引用该 recoveryRequestId）、递增 generation/fence 与 batch.currentAttempt/STAGED。提交后才执行提取；同 recovery key 重放只返回原 receipt，不再分配 attempt 或 generation。成功条目对象按稳定目标幂等复用，最终只提交一个 manifest。

正常上传完成后的首次提取安排，同样把 UPLOAD 的 SUCCEEDED/staging receipt、首个 PREPARED EXTRACT、batch STAGED/currentAttempt 和新 generation 在一个事务提交；该 EXTRACT 沿用当前 UPLOAD attempt 引用的 Request 授权依据（最初创建或显式重传的恢复 Request），且必须仍为当前 epoch。若原包已 durable、此事务尚未提交就崩溃，RECONCILE 取得排他锁并核对原包后只收敛到 STAGED；随后显式 CONTINUE_EXTRACTION 按“尚无 EXTRACT”分支建立首次提取及当前授权，不重传原包、不新建 batch。若已存在 PREPARED EXTRACT，重启先核对其锁、状态及授权；只有原授权仍有效才可执行同 attempt，不能创建第二个。epoch 已变化的 PREPARED/RUNNING attempt 先核对结束，再通过上述显式恢复建立新 attempt。


`ABANDON` 用于用户不再提交已声明文件、或改用新内容的有界退出。只在无manifest、独占原attempt锁且inspect已确定原写者结束时允许；Batch CAS使旧fence失效并保存ABANDONED事件/receipt后释放项目占用。UNKNOWN/活跃流/未结束提取时禁用；客户端点击不能成为结束证明。已接纳批次不能放弃或隐藏。新内容随后以新batch进入，原batch及隔离原件不删除。

进程互斥由每实例启动锁及每 attempt 的操作系统文件锁保障。崩溃后锁由内核释放；重启恢复必须实际取得旧 attempt 排他锁并 inspect，DB lease 超时本身不证明旧写者已结束。运行中的原写者通过 Abort + join 确认终止后释放锁；未成功收敛则 UNKNOWN。从未启动的 PREPARED attempt 只有在取得对应排他锁、inspect 无活跃写者/副作用、CAS 固定旧 generation 后，才可在恢复事务中记为 ABANDONED 并安排新 attempt；不把 PREPARED 直接视作已经结束。文件锁使用真实本机文件系统（不支持 NFS/共享网络目录），锁获取失败不得偷锁。实现以固定 inode 上的非阻塞 `flock` 覆盖完整持有期，在其保护下检查和恢复旧 Unix socket；锁文件不得在释放或恢复时删除。文件根经身份校验后统一为 canonical realpath，父目录别名不能产生第二套实例或 attempt 锁。Core 在启动恢复之前取得实例锁，停止入口并等待工作结束后才释放；恢复写在 Batch CAS 下取得旧 attempts 的锁并 inspect，持有到事务提交或回滚后。未知锁或文件 I/O 错误不能视为写者已结束。generation/fencing 同时保护 DB 提交；晚到旧 finish 只能记隔离观察，不改变当前结果。后续 S3/多进程模型须另审，不能用本机锁推定远端安全。

### 4.2 文件与数据库一致性

1. 创建 request/batch/固定输入及初始 attempt 的事务先提交；开始任何外部写之前取得当前授权、attempt 锁与 fencing。
2. 原包写入 per-instance/project/batch/attempt 的隔离 key，计算真实长度/sha；fsync 文件、排他发布、fsync 父目录、回读/inspect 成功后才记 STAGED。key 由服务端生成，客户路径只作为元数据，不拼成宿主路径。
3. 先完成全包安全检查。按 ordinal 处理三格式，安全合格对象写入稳定、不可覆盖的条目 key。每个已完成对象留持久 staging receipt；写后 DB 未提交时可 inspect 同 key 恢复，不重新发明 sourceId。原包/条目身份及目标在首次安排时固定。
4. 确认当前 owner 启用、instance/store 身份、fence、原输入和全部 accepted 对象 bytes 证明仍匹配后，一个事务提交 manifest、条目、原包引用、batch 终态及 event，释放项目 activeBatchId。不能先向用户返回可读来源再补 DB。
5. 提交响应丢失时，查询原 batch/manifest。已有 manifest 的重放不重建；UNKNOWN 不创建新 batch。没有 manifest 时 staging 仅技术事实，不是业务接纳。
6. 原包/已接纳对象不可覆盖或自动删除。首版不提供自动 orphan GC；孤立 staging 保留并计入可用空间/限制，运维检查在单独授权下进行。不能用清目录、重建 store、清卷或跳过 Hash 修复不一致。
7. 文件流读取前完整核对对象身份/长度/sha，再从同一受保护对象读取；底层损坏为503 `STORAGE_INTEGRITY_ERROR`，不替换为另一对象。下载为附件，受限/恶意名字安全编码；断流不记成功保存。

## 5. ZIP、DOCX 与 XLSX 接收 policy

新批次使用 `mvp.zip-input@4`，在创建时固定；新 manifest 固定同一 policy 与 `mvp.input-extractor@4`。旧 `@1/@2/@3` receipt/manifest/拒绝结果保持历史含义，不回填或重扫。`@4` 的接收兼容性见第 10 节，预算沿用用户于 2026-11-04 批准的[预算增量](../decisions/mvp-zip-resource-budgets.md)：外层 ZIP 文件与目录最多 1000 条，单份 Office 内部条目最多 1000 条，全部 Office 内部条目共享 20000 条；目录和格式校验失败的已计量条目仍消耗预算，不返还、不逐文件重置。原 ZIP 100 MiB、累计展开 500 MiB、单 entry 50 MiB、展开倍率 100、path UTF-8 240 bytes / 16 层、120 秒、512 MiB 工作内存保持原值。展开字节、内存、耗时仍覆盖外层及 Office 整次扫描，CRC/真实长度仍须校验。旧 D14 policy 不改变，不以新额度宣称任意 1000 份文档或正式容量验收通过。

- 外层：校验 ZIP 目录/CRC/实际长度、重复或冲突 normalized path、绝对路径/`..`/反斜杠路径歧义、symlink/设备、加密及递归 ZIP；全包安全或完整性失败为 REJECTED。目录项保留目录关系，不假装文档文件；普通文件每个ordinal保留一条结果。内层压缩文件按第 8 节整批拒绝，不递归提取；旧 `@1` 的逐项 UNSUPPORTED 结果保持历史语义。
- Markdown：严格 UTF-8 解码；数据字节只保存、不执行。渲染安全沿现有安全 Markdown 边界，B1 不新增正文预览/解析业务能力。非法编码为 CORRUPT。
- DOCX：复用已批准的 namespace-aware XML/OOXML 校验，包括 ContentTypes、根关系及主文档；坏包逐项 CORRUPT。无 DTD/外部实体，无伪根/重复展开属性/未绑定前缀；注释、CDATA、PI 不提供结构证明。
- XLSX：只接收非宏 `.xlsx` OOXML ZIP。ContentTypes 必须声明 SpreadsheetML workbook，根 officeDocument relationship 指向唯一存在的 workbook；workbook 的 sheet 声明和其 relationship 必须唯一、内部、解析到确实存在的 worksheet，禁止缺失/重复关系、目标路径逃逸及用扩展名替代实际 media 检查。workbook/relationship/worksheet 及被引用的 styles/sharedStrings（如存在）均按同一安全 XML 规则验证；不需要存在 sharedStrings 才接受 inline string。空工作表合法，空值、0、公式与 cached value 都按原字节保留，不重新计算或承诺读取完整业务内容。
- 任一 Office 条目发现 macro-enabled ContentType、VBA、ActiveX/OLE 嵌入活动内容时为 UNSUPPORTED（`ACTIVE_CONTENT_NOT_SUPPORTED`），即使文件名伪装 docx/xlsx；不剥离后冒充干净原件。外部 relationship/链接不访问；仅 `@4` 的精确 DOCX 模板例外按第 10 节静态接收，其余保留原件隔离并标记 READ_LIMITED（`EXTERNAL_REFERENCE_REQUIRES_REVIEW`），不提供 ACCEPTED SourceRef 给后续 Runner。普通公式文本不执行，不以出现公式本身拒绝 XLSX。
- XLS/PDF/未知类型逐项 UNSUPPORTED；零可支持条目的安全包可以 PARTIAL 托管并展示完整限制，但 `acceptedEntries=0`，不能显示可分析。用户转换或修正内容通过新补充批次进入。
- 宏/外链/恶意 XML、结构/CRC 故障均应保持可解释限制。达到全包累计预算拒绝整个包；单文件结构故障不抹去其他通过条目，但只有全包安全已确认才允许提交 PARTIAL。

## 6. UI 接线与 B2 边界

真实项目/材料页面使用本模块 server result，且只声明 PROJECT_CUSTODY。既有 U1–U3 fixture 仍在 Environment A；新 production composition 不加载演练 adapter，不把没有报告当作空的成功分析。展示当前状态、原请求、失败原因、允许动作和输入批次来源；原始 filename 是不可信文本，不进入 HTML/路径/命令。

普通刷新、退出/重登、服务重启，从 server 项目目录及 batch/request 恢复持久事实；未发出的本地输入允许丢失，但须诚实提示。PENDING/UNKNOWN 导航不新建 intent；客户端只保留最小原 requestId/target 和待恢复命令，不存 token/凭据；遗失本地 command 时优先查询原请求，不能据两字段猜同一命令。

本批不构造报告、计划或“当前有效资料全集”。后续分析必须选择一组已封存 manifest 中的 ACCEPTED_ENTRY 引用；ORIGINAL_ZIP 仅用于资料留存/核对，不能用整包绕过受限条目后直接成为Runner读取集。新补充批次不会改写此前已固定的集合。B1 交付上述引用及受控读取端口，不注册 B2 的任务/Runner 操作。

## 7. 设计与验收出口

验收唯一见 [MVP01 Test](../module-tests/Module-Test-MVP01-DocumentDelivery.md)。B1 已按获批设计实现并进入 `batch/mvp-b1-document-delivery`；当前收口包含独立本机实例验收及缺陷修复，尚未完成 main 交付。初始化按实例取得环境授权；既有 A/B 的 DB/store 未迁移。正式来源人工验收、批次最终审查/full、main 合入授权及合入后 main full 分别保留门禁。技术批准绑定 [SD-B1-01–07](../mvp/b1-design.md#2-已批准的-spec-delta)，不由本文件的字段完整性推定批准。

## 8. 上传拒绝嵌套压缩文件

状态：`PRODUCT AND TECHNICAL DESIGN APPROVED 2026-11-03 / IMPLEMENTED LOCALLY`。取舍及范围见 [设计提案](../decisions/mvp-nested-archive-rejection.md)；本节不重写既有 `@1` 的历史行为。

- 本节最初引入 policy `mvp.zip-input@2` / `mvp.input-extractor@2`；新 `@3` 继续执行同一嵌套拒绝规则，预算按第 5、9 节。外层 ZIP 安全、完整性及全局预算失败优先按原规则拒绝，不以不可信路径构造说明。路径长度预算同时检查原始 UTF-8 名称与 NFC 规范路径；任一超限沿既有 ZIP_UNSAFE 整包拒绝，不截断或改写名称后保存拒绝详情。
- 外层安全扫描发现任意内层压缩文件时，在成员对象接纳和 manifest 封存前拒绝整个批次；`batch.status=REJECTED`，`reasonCodes` 包含新值 `NESTED_ARCHIVE_NOT_ALLOWED`，当次 EXTRACT 尝试结束为 FAILED，保留原 Request/Attempt。零 ACCEPTED_ENTRY / 零 manifest，不把正常文件先写成部分接纳结果。
- `mvp.get_input_batch` 的成功 result 增加可选 `rejectedArchivePaths: string[]`，只在该批次因嵌套压缩文件拒绝时返回，按外层目录 ordinal 排序。每项是安全扫描后的原始包内路径，不是宿主路径、内容链接或 SourceRef。数组非空，受既有条目数和路径字节预算限制；不转义后存储、不当 HTML 执行。其他批次省略字段，不用空数组冒充扫描成功。
- 拒绝路径作为 owning batch 的持久事实，与该次 REJECTED、错误原因、活动占用释放在同一事务保存；读取使用现有 owner/project 权限检查，拒绝详情不放入通用日志。响应丢失后查询原批次/请求，刷新及重启读回相同事实，不重新发起提取。
- 初始、补充批次同样检查。压缩文件名大小写和常见实际签名均覆盖；带 ZIP 签名的 `.docx/.xlsx` 必须先识别 OOXML 容器结构，扩展名本身不构成豁免依据。没有 OOXML 包级结构依据的改名 ZIP 按 `NESTED_ARCHIVE_NOT_ALLOWED` 整包拒绝，不能仅返回 INVALID_DOCX/XLSX 后部分接纳。正常 OOXML 文档不误拒；有 OOXML 容器结构依据但内部文档损坏、含活动内容或外链的条目继续按原 CORRUPT / UNSUPPORTED / READ_LIMITED 规则处理，结构身份识别不替代完整校验。资源预算按批次的明确 policy 执行。内层压缩文件不递归展开，不产生成员清单。
- 拒绝批次不可通过 retry 更换字节；用户移除内层压缩文件并重新打包后创建新批次。旧批次、原包隔离对象及失败历史保留，不自动删除。
- 数据库新增迁移允许 `@1/@2` 并保存拒绝路径，不改旧迁移或历史 receipt/manifest。旧 `@1` 已完成/终态结果照常只读；未完成旧批次不自动按新规则续跑。必须先证明原写者结束，再由用户显式放弃后重新上传；UNKNOWN/活动写者仍先核对，不以 policy 不同绕过结束证明或清除项目占用。旧 policy 的 RECONCILE 在持有批次事务锁并证明所有旧写者结束后，仅收敛为 FAILED / RECOVERY_REQUIRED，保留项目占用；之后显式 ABANDON 才释放占用，不恢复 STAGED 或授予继续提取。实现须同步其允许动作与服务端写入校验。

## 9. 分离资源预算与持久超限详情

用户已批准 @3 技术设计，具体数值见第 5 节。只对新 MVP 生效；任何未结束的 @1/@2 批次仍须证明原写者结束、RECONCILE 收敛、显式 ABANDON 后新建批次，不允许按 @3 自动续跑。旧已结束结果不修改。

`mvp.get_input_batch` data 新增可选闭对象 `limitViolation`。仅 @3、REJECTED、reasonCodes 包含 ZIP_LIMIT_EXCEEDED 且无 manifest 时允许并必须提供；其他原因省略，旧 @1/@2 缺省，不用 null。两种形状：

- `{metric, actual, limit, documentPath?}`：metric 为 ZIP_BYTES / OUTER_ENTRIES / OFFICE_DOCUMENT_ENTRIES / OFFICE_ENTRIES / ENTRY_BYTES / EXPANDED_BYTES / MEMORY_BYTES / PROCESSING_TIME_MS；actual、limit 为非负安全整数，actual > limit，limit 精确匹配该 policy。
- `{metric:'EXPANSION_RATIO', expandedBytes, compressedBytes, limit:100, documentPath?}`：两个字节值为非负安全整数；compressedBytes 为 0 时 expandedBytes 必须正，否则 expandedBytes / compressedBytes > 100。禁止其他字段、Infinity、NaN、null 或非法数值。

ZIP_BYTES 计量实际输入 Buffer 长度；三个 ENTRIES 计量 ZIP 结束目录声明数（OFFICE_ENTRIES 为已经遇到的 Office 声明数之和）；ENTRY_BYTES、EXPANDED_BYTES 计量目录声明展开大小及其累计值，EXPANSION_RATIO 计量目录声明的字节对；MEMORY_BYTES 计量已有工作内存公式（含预留），PROCESSING_TIME_MS 计量已运行时间。目录声明可能在 CRC/真实长度核验前触发拒绝，UI 不得把它称为已完整读取数量或实际解压结果；不为展示继续解包。

可选 documentPath 仅来自已经通过外层安全/完整性解析的原始 Office 路径，非空、UTF-8 最多 240 bytes，保留原文本且按安全路径规则检查。外层失败没有该字段，内层部件、宿主路径、原文与栈不返回。保留第一个超限事实，actual 为该计量依据下的当时值，不是全包完成统计。

详情与该次失败尝试、REJECTED、错误原因及活动占用释放同一事务落库，零 ACCEPTED_ENTRY、零 manifest；owner/project 授权不变，详情不进入通用日志/事件。刷新、重启、原批次查询返回相同详情。旧记录仅有代码时明确“此历史批次未记录具体超限项”，不得倒推新阈值、虚填 0 或宣称重新接纳。

持久映射为新增 V0003 / nullable JSONB limit_violation；数据库检查闭合形状、精确限额、状态/policy/原因/manifest 关系。旧迁移不修改，嵌套拒绝路径约束允许 @2/@3。读模型及 UI 同步验证可选字段，历史兼容只读。实施出口见 ZB-01–08；实际实例升级及重新上传另行取证。

## 10. @4 真实文档接收兼容性（已批准）

用户于 2026-11-04 批准[SD-IC-01–04](../decisions/mvp-document-intake-compatibility.md)，在保留第 5、8、9 节安全边界和原字节的前提下实施：

1. 外层和 Office ZIP 仅支持 method 0/8；method 8 允许 bit 1/2 压缩选项与原 bit 3/11，method 0 不允许 bit 1/2。加密、未知位/方法、local/central 不一致、CRC/长度/路径/资源失败仍拒绝，不改写压缩标志或原件。
2. 路径 basename 为 `._*` 且 magic/version 为 AppleDouble v2，或 basename 为 `.DS_Store` 且签名匹配，分类为 `UNSUPPORTED` + `SYSTEM_METADATA_NOT_DOCUMENT`。只识别名称与签名共同匹配的附属文件，不忽略整个 `__MACOSX` 目录或隐藏文件。外层安全、预算及嵌套压缩检查先执行；保留每个条目的身份、路径、ordinal、摘要与计数，无 SourceRef。
3. 唯一静态模板例外只用于非宏 DOCX：原结构与活动内容校验通过，所有外部关系均为 `word/_rels/settings.xml.rels` 中唯一的完整 Transitional/Strict attachedTemplate 类型、正确关系 namespace、精确 `TargetMode=External`。`word/settings.xml` 的 ContentType 和主文档到 settings 的唯一内部关系必须一致；安全 XML 的 WordprocessingML settings 根下唯一直接 attachedTemplate 子元素，使用关系 namespace 的 `id` 精确引用。缺失、重复、错 namespace 或结构不一致为 CORRUPT；其他有效外部引用仍 READ_LIMITED。不可仅凭名称、URI 后缀或固定前缀 `r` 判断。
4. 模板例外为 `ACCEPTED` + `EXTERNAL_TEMPLATE_NOT_LOADED`，保留实际原 bytes/hash/SourceRef。`ACCEPTED.reasonCodes` 可有此接收说明，不表示读取了模板或全文。无文件/网络目标访问、Office 调用、引用删除或重压缩。混合其他外链、宏、OLE/嵌入对象不享受例外，XLSX 外链规则不变。后续 Runner 接入须保留说明并证明不会解析外部目标；当前分析仍 UNAVAILABLE。
5. V0004 允许 @1–@4，嵌套拒绝路径约束适用于 @2–@4，第 9 节强制 limitViolation 约束适用于 @3/@4；额度和对象形状不变，V0001–V0003 checksum 不变。旧活动 @1/@2/@3 批次不得按新 policy 自动继续；沿既有写者结束证明、核对、显式放弃和新批次上传规则恢复。旧完成历史不重写。
6. 清单继续逐项分页，计数含附属文件；ACCEPTED 带说明不算受限，元数据仍算受限，批次可为 PARTIAL。页面在全部文件行显示模板说明，附属项和活动内容提供准确中文解释；历史不从名称反推新分类。静态接纳不等同于全文读取、分析或完整业务验收。


## 11. 已接收资料只读内容核对（2026-11-04 已批准）

依据 [SD-SP-01–04](../decisions/mvp-source-content-preview.md)，新增 `mvp.get_source_preview` GET `/projects/{projectId}/batches/{batchId}/sources/{sourceId}/preview?manifestId={manifestId}`。完整当前归属、sealed manifest 与 ACCEPTED_ENTRY 校验前不得读 bytes；原 ZIP 不适用。读取前和返回前核对 enabled/authEpoch，HTTP 返回前复核 token/session。复用原件完整性检查；响应 no-store，不写库、不改变原件/清单或业务读取状态。

闭响应：`{sourceRef,manifestId,fileName,profileId:'mvp.source-preview@1',status,limitations,sections?}`。fileName 为已验证来源的原文件名；status 为 AVAILABLE/LIMITED/UNSUPPORTED/UNAVAILABLE。limitations 为闭原因码数组：`EXTERNAL_TEMPLATE_NOT_LOADED, EXTRACTED_VIEW_ONLY, TABLE_TEXT_REPEATED, NUMBERING_NOT_RENDERED, TEXT_REVISIONS_ONLY, MEDIA_NOT_INTERPRETED, INCOMPLETE_EXTRACTION, FORMAT_NOT_SUPPORTED, NESTED_TABLE_NOT_SUPPORTED, EMPTY_CONTENT, UNSAFE_CONTENT, RESOURCE_LIMIT, TIMEOUT, BUSY, DEPENDENCY_UNAVAILABLE, INVALID_READER_OUTPUT, CANCELLED`。AVAILABLE/LIMITED 必须有非空实际内容，其他状态没有 sections。身份/权限/完整性沿用既有错误；本次预览失败以 UNAVAILABLE 和原因码返回，可显式重试，不能降格为成功空白。

sections 为以下闭联合：Markdown `{format:'MARKDOWN',source}`（严格解码原 bytes，保留 CRLF/CR/LF）；DOCX `{format:'DOCX',paragraphs,tables,headersFooters,comments,revisions,fields}`。paragraphs 项 `{position,text,style?}`；tables 项 `{position,rows}`，每行 `{cells}`，cell `{text,column,colSpan,rowSpan}`；headersFooters 项 `{part,text}`；comments 项 `{id,text,paragraphs:number[]}`；revisions 项 `{kind:'ins'|'del'|'moveFrom'|'moveTo',id,text}`；fields 项 `{part,text}`。数组/字符串、表格行列与跨度必须有界验证；不透传任意 Runner JSON、外部模板地址、编号定义或宿主路径。DOCX 至少 LIMITED；修订只包含已提取文本类型，无原位/格式修订完整性承诺。XLSX、Strict DOCX、嵌套表格 UNSUPPORTED。

固定代码快照、预先放大预算、独立进程与执行期保护、原始产物/管道/temp 预算、取消/超时及重启清理按 SD-SP-02/03 的精确数值实施。配置 `ZHIJU_MVP_PREVIEW_RUNNER_ROOT` 与 `ZHIJU_MVP_PREVIEW_PYTHON` 仅服务端提供绝对路径，缺失/漂移仅使预览不可用；不影响已有托管启动。临时目录属于已验证 store 的本实例 preview 子目录，其他实例/原件不清理。未来 profile 改动不得沿用旧阅读覆盖证据。


## 12. 整批资料读取检查（2026-11-04 已批准）

[SD-BR-01–04](../decisions/mvp-batch-read-check.md) 已获用户批准。以下只拥有技术读取检查，不发布分析、候选或业务 READ；原批次、manifest、来源和接收说明不变。

操作为 create/list/get/list entries：POST `/projects/{projectId}/batches/{batchId}/read-checks` body `{manifestId}`，Idempotency-Key 必填，返回 `{check:ReadCheckView}` + receipt（首次202、重放200）；GET 同路径 `limit=20(1..50),cursor?` 返回 `{items:ReadCheckView[],nextCursor?}`；GET `.../read-checks/{checkId}` 返回 `{check}`；GET `.../{checkId}/entries` 接受 `limit=20(1..100),cursor?,filter=ALL,resultVersion?`，返回 `{check,filter,total,entries:ReadCheckEntry[],nextCursor?}`。未知/重复字段拒绝。resultVersion 为正安全整数；有 cursor 时必须同时提供其 resultVersion。cursor 的签名作用域绑定 owner/epoch/project/batch/checkId/filter/limit/resultVersion，ordinal 为分页位置。先验证签名和作用域，再比较版本；版本失配409 READ_CHECK_RESULTS_CHANGED，跨作用域仍 CURSOR_INVALID。首次列表的行、分类总数和版本来自同一数据库观察；历史任务列表使用创建高水位，不混入后续新任务。

ReadCheckView 为 `{checkId,projectId,batchId,manifestId,manifestHash,profileId,profileHash,status,resultVersion,totalEntries,counts,createdAt,startedAt?,endedAt?,reasonCodes}`。counts 闭对象为 `{available,limited,unsupported,failed,notEligible,pending}`，和恒等于 totalEntries；全部非 pending 即完成检查，COMPLETED 允许包含失败或限制。状态闭集 QUEUED/RUNNING/COMPLETED/INTERRUPTED/FAILED/UNKNOWN。终态不可改；UNKNOWN 不是终态且保留项目占用。profileId 使用固定 `mvp.batch-read-check@1`，profileHash 绑定当前 preview profile、三份 reader 摘要、全部单份预算、60分钟总时限和16KiB元数据上限；漂移不自动升级旧任务。

ReadCheckEntry 为 `{entry:ManifestEntry,result?:ReadCheckResult}`。无 result 表示尚未检查；原 entry 完整保留。result 为 `{entryId,ordinal,status,profileId,checkedAt,limitations,resultHash?,counts?}`，status=AVAILABLE/LIMITED/UNSUPPORTED/FAILED/NOT_ELIGIBLE。limitations 只允许当前 PreviewReason 与批次检查闭集（STORAGE_INTEGRITY_ERROR、AUTHORIZATION_CHANGED、CHECK_TIME_LIMIT、CHECK_INTERRUPTED）；NOT_ELIGIBLE 的接收原因从 entry.reasonCodes 读取。取得内容才有 resultHash/counts；hash 为 `sha256CanonicalJson({profileId,sourceRef,manifestId,status,limitations,sections})`，不含易变时间。counts 闭对象 `{paragraphs,tables,comments,revisions,headersFooters,characters}`，均为非负安全整数；Markdown 只计 characters，DOCX 按提取结构计数，不宣称原件版式/业务已理解。结果存储不得包含 sections、原始异常或客户正文；单份 result JSON ≤16KiB。正常预览仍按需计算，不能称为报告的历史正文。

同键幂等将 payload 固定到路径 batchId 和 manifestId；创建 Request 和任务同事务，原授权 owner/epoch 不因重放改变。每项目仅一个 QUEUED/RUNNING/UNKNOWN，冲突409 READ_CHECK_ACTIVE 并附闭 `details:{checkId,batchId}`，仅当前授权项目可见。任务不存在/越界404，未封存或 manifest 不匹配409 READ_CHECK_NOT_READY。读写都核对当前 binding；worker 开始及每次结果提交前锁定并核对原授权。每项结果插入、resultVersion递增、可能COMPLETED及状态事件同事务；结果append-only，与任务/原entry/manifest强绑定。当前授权改变停止旧任务，不用新epoch续跑；恢复可记录已证实的中断事实，不接纳新读取结果。

实例调度串行、逐项释放内存，复用预览解析槽。BUSY等待不产生文件失败，60分钟含槽位等待。单文件失败继续；共同依赖、原件完整性、授权、数据库或总时限停止任务。提交失联先按 entryId/原代次/结果摘要核对已提交事实；无法证明则保持UNKNOWN，不重复解析。QUEUED原授权有效才启动；启动扫描RUNNING和UNKNOWN，持有同一稳定锁并确认旧解析进程树结束后核对持久结果、推进fencing并收敛终态/INTERRUPTED，释放占用；否则保留UNKNOWN。新检查使用新request/checkId，旧任务与结果保留，不自动续跑。继承的内核锁描述符必须贯穿受控worker和Python，只有全部进程释放后才准新读取/恢复；IPC断开终止旧worker/Python，禁止用PID或时间推断树已结束。
