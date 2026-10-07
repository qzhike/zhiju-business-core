# IM-06 Task Board 首版 Spec Delta 提案

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-05 (B-01–05) / DETAILED BINDINGS / DESIGN TECHNICAL REVIEW PASSED 2026-10-05 / IMPLEMENTED AND REVIEW-REVISED 2026-10-05 (Issue #248; PR #249 五轮共 32 项) / CONTRACT+UNIT PASS / PG STORAGE-BOUNDARY+SQL GUARD+REACHED FENCE BARRIER+PROOF/CONFIRM RECOVERY PASS / 真实 v1+v2 身份、SNAPSHOT_AT_LEAST 入口与 G1→G2 分页 PASS / 其余 BOARD-D 与 IP-BOARD-D 矩阵、外部与人工验收 NOT RUN`。

本提案基于 `main@917723f54757a5f17209095d4c68b6d5959f855e`，承接 [roadmap](../product/roadmap.md) 中 Usage/Provenance 交付后的下一目标。它定义 TD-05 的当前切片，不追认 TD-07，不修改现行可执行 Contract。用户于 2026-10-05 批准已呈现设计并授权发布 implementation Issue；批准绑定见 §5，Git 交付与业务实现不由此授权。字段、授权及存储的正式归属仍分别是 owning Module Spec、IdentityPolicy、共享 API 和 PostgreSQL 基准；以下 B-01–05 保留已呈现决定，精确化字段与规则由 owning 文档维护。

## 1. 交付目标与当前事实

一个获授权 Human 可以按 Project 查看 Task 状态、尚未解除的 blocker 和相关未终结 WorkOrder，按状态及精确 DeliveryItem 版本筛选并翻页；同时知道结果的来源快照是否落后、重建中或失败。进入业务操作时仍调用权威 Query，不把 Board 状态解释为执行授权或当前 Completion 资格。

2026-10-04 远端核对：PR #247 已于 `2026-10-04T15:13:57Z` 合并，merge commit 为 `68c796f58b9a4186eb80302525787ad7c711132b`；其 final head `d2c7ae0c2b98758ab2a588fea0c6cf1da445a07f` 的 select/checks/persistence/verify 均 SUCCESS。当前本地与远端 main 均为上述提案基线，工作区在本轮开始时干净；开放 Issue 中无 IM-06 同目标任务。该 CI 是前置交付证据，不是本提案的运行证据。

| 已核对来源 | 当前事实与本轮影响 |
|---|---|
| `contracts/src/operations/task-execution.schema.ts`、operation metadata | 已有 `execution.get_task_board_slice@1.0` 与严格 TaskBoardPage/TaskBoardItem；Purpose 为 `task.execution.get_task_board_slice`。尚无业务 Handler/组成入口 |
| Spec 003 §12、PostgreSQL §34 | 不可变 generation、owning Export、dirty identity 与分页只是提案；尚无 Task Board 存储/worker，不可按已批准设计发布实现任务 |
| Spec 003 §16.3、§16.6 与 Task 创建实现 | Task definition 快照保存完整 `initialAssignee`，但它只是声明，不是有效 Assignment；Task root 无当前 assignee 指针 |
| Task/WorkOrder、恢复与正式 Completion owning 实现 | 已有合法状态、Request/Result 恢复来源及 Completion 指针，可形成受控 Board 来源；不能用各切片的 PASS 代替 Board 验收 |
| EnterpriseProject Board 实现 | 已有 projection 事务/RLS 与 rebuild 经验；其 cursor 绑定 Decision hash、分页读取当前 alias，不满足本目标的旧 generation 翻页，不能直接照搬或顺带重构 |

本项为 T2：涉及新持久化、独立读取授权、跨 owning/Projection 边界、发布与分页并发。预期模块为 TaskExecution、IdentityPolicy、API composition、Projection 存储及相应 contracts/tooling；不改变七模块所有权。

## 2. 拟议决定

### B-01 复用公开 Query，先交付现有事实能支持的视图

保持 operation/version/Purpose、payload/result data Schema、239/63/200 基线与旧合法 fixture。公开 Page 只含既有 `items,nextCursor?,snapshotAt,sourceWatermarks`；freshness、redactions、resultHash 放共享 QueryResult Envelope，不能塞入严格 data。

`statuses` 按现有 Schema 为非空、唯一的 TaskStatus 集合；查看所有状态时传完整闭集。旧 Spec 003 §12.3 的“空 statuses 表示不限”须在 owning Delta 中撤回，不能为旧提案改写已发布 Schema。

Task Ref 按不可变创建事实的 Major 使用 execution.task 或 zhiju.execution.task，不统一历史拼写；原提案裸 Task 是引用错误，按冻结Spec003 §16.1纠正，不批准新别名。Project支持project.project与zhiju.project.project，分别绑定完整target，不互转授权；精确Ref规则见Spec003 §12.4。

首版省略 `assignee`，不把 initialAssignee 或 createdBy 投影为已生效指派。显式传 `assigneeRef` 时返回 `EXECUTION_CRITERION_UNSUPPORTED`、无 data；不忽略过滤器，不以空页声称确实无人匹配。该有限业务支持集不修改 Schema 接受集合；有效 Assignment producer 交付后另行扩展。其余支持 Task v1/v2 已交付来源，不要求 Task 必须进入 synthetic 执行 profile 才能显示 DRAFT/READY。

每项从同一个 TE REPEATABLE READ 快照派生：title 来自已校验 definition；status/version 来自 root；activeWorkOrderRefs 包含同 Task 的非终结 WorkOrder（DRAFT、READY、QUEUED、RUNNING、WAITING_INPUT、COMPLETION_PENDING、RETRY_PENDING），按精确 Ref 排序去重。blockerRefs 复用已交付恢复/Completion 的本地阻塞语义，包含未解决 blocking Request，及既有 recovery_work_order_blocked 保守判据标明的 WorkOrder 引用（含已提交 final reservation 至 Request/后续合法覆盖前的窗口）；不凭 Task status 猜造 Request。completionEvaluationRef 只引用 root 当前已提交 Evaluation，完整校验 pointer/hash，存在不代表 USABLE。

非法 source mirror/hash、超出安全整数的 aggregateVersion、跨 Scope 关联必须失败，不能漏掉问题行后发布“完整”快照。输出仅含既有安全字段与精确 Ref，无 Context/答案/客户材料正文、Prompt、stdout、Credential 或自由 initialAssignee。

### B-02 owning 一致性 Export 与独立发布

沿用旧提案的完整快照方向，不要求所有变化都有公开 Event。内部只读 Export 形成完整有序 `TaskBoardSnapshotRow[]`：`{item,filterKeys:{deliveryItemRef?}}`；filter Ref 从同一 definition 快照原样取得，有无字段都纳入 canonical Hash。按 Task UUID 的 UTF-8 字节序升序；公开响应只取 item。

所有影响上述行的 TE owning 写事务同时产生 scoped dirty identity；业务回滚时一同回滚。必须覆盖 Task/WorkOrder 创建和状态、Completion pointer、Request/Resolution、已接纳阻塞 Result 与其覆盖来源。应从实际来源依赖逐项核对写入者，不能仅监听 Task 公开 Event。优先由 owning 表变更的数据库技术边界保证 marker 完整性；数据库 trigger 只标 dirty，不派生业务状态或写 Projection。

Export manifest 绑定 exportId、完整 Project Ref、source snapshotAt、精确技术 Policy 版本、完整 rows、rowCount、rowsHash、快照可见的 coveredDirtyIds；manifestHash 对不含自身 Hash 的完整规范 manifest 计算。Export 不写业务事实、dirty/checkpoint 或 generation。

TE 技术 dispatcher 以每 Project 的 lease/fencing 串行领取导出与发布；先持久化 manifest，再调用 Projection writer。Projection 在独立事务核验完整 manifest/行镜像/Hash/count、写 INSERT-only generation 与 rows，并原子切 alias/checkpoint。相同 exportId/hash 重放复用原 generation 和发布 sequence，异 Hash 拒绝；新快照使用新 exportId。旧 worker 失去 fence 后不能发布，失败保留旧 alias。

发布授权的 fence 必须由 Projection 自身保存的单调 fence 注册/比较来验证，不能只信调用者传入数字。领取/续约/接管的消息与 Projection fence 注册均可重放；完成 fence 注册之前不发布。TE lease 与 Projection 发布没有跨 Schema 事务；旧发布若先于新 fence 注册发生，仍属于先前合法代次，接管者随后发布更新代次，不能宣称两事务同一瞬时提交。

发布完成后只确认 manifest 明确覆盖的 dirty identities，禁止按 MAX(sequence) 删除或确认。低分配序号事务晚提交仍留下未确认 marker。启动、失败恢复及有限间隔完整刷新兜底，Event 只作唤醒。alias 切换后确认前崩溃可重放原导出，不重复发布 sequence、不丢后续 dirty。

存储拟沿用 PostgreSQL §34 的 TE dirty/dispatch 与 Projection generation/row/alias/checkpoint/failure 边界，以 forward-only migration 交付、独立 FORCE RLS、镜像/Hash guard 和最小角色 ACL，无跨 Schema FK。Projection app 不读 TE 表；Export app 不写 Projection；技术 dispatcher 不能改业务 Root。完整 manifest 仅含上述安全字段，不复制业务正文。migration 编号由未来 Implementer 分配。

### B-03 稳定过滤、cursor 与有限保留

PROJECTION_OK 第一页固定当前可用 generation；下一页始终读取 cursor 中原 generation。状态与完整 deliveryItemRef 过滤均先于分页；VersionedRef 比较包含 kind/objectType/objectId/versionId/完整 Scope 及其合法限定字段，不能只比 Item id。未绑定行仅在无 DeliveryItem 过滤器时出现。固定 Task id 升序；pageSize 受技术 PayloadGuard 限制，超限拒绝，不静默截断。

cursor 使用服务端受信 Secret 保护，不使用可见 Decision contentHash 当签名密钥；绑定 query/version、完整 Scope、requester/Purpose、当前授权来源指纹、规范 filter Hash、pageSize、consistencyRequirement/asOf/minimumWatermark、generation/hash、snapshotAt/watermarks、最后 Task id、issuedAt/expiresAt 与 Policy 版本。statuses 按集合规范化，Ref 逐字段规范化；pagination 重复入口与 payload.page 不一致时拒绝，不择一忽略。

每页重新验证当前授权，返回前再重验；已撤权、Policy/Grant 来源改变或越 Scope 时无行/计数/cursor data。新签发但来源与权限相同的短期 Decision 不单独使 cursor 失效；身份或授权来源变化必须重新查询。篡改为 `QUERY_CURSOR_INVALID`，绑定不匹配为 `QUERY_CURSOR_SCOPE_MISMATCH`，超期或已按规则清理为 `QUERY_CURSOR_EXPIRED`。

技术 Policy 给出有限 maxPageSize、maxSnapshotRows/maxSnapshotBytes、freshnessMaxAgeSeconds、cursorTtlSeconds、refreshIntervalSeconds、workerLeaseSeconds，及 Policy 版本；取值必须显式受信配置并在 future Issue 限定支持规模，不能从 caller 参数或无限默认值推导。generation 保留至少到 `publishedAt + cursorTtlSeconds`；该 generation 后续签发 cursor 的 expiresAt 不得越过此固定 retentionUntil，避免 Query 为续期产生写入。到期清理由独立技术 worker 执行。超导出资源预算记录失败并保留旧 alias，不截断成成功 generation。

### B-04 保留三种一致性请求，不让 Query 隐藏刷新

旧 §12 只描述 Projection，现有共享 Contract 的 P 却允许 AUTHORITATIVE、SNAPSHOT_AT_LEAST、PROJECTION_OK；本项不能把前两者无声降级。

| 请求 | 拟议首版语义 |
|---|---|
| PROJECTION_OK | 读取固定 generation。FRESH 要求当前 alias、source-health 检查无未覆盖 dirty、无失败/重建且未超 Policy 年龄；FAILED > REBUILDING > STALE > FRESH。source-health 不能取得时 FAILED；可返回已授权旧 data，status 为 ERROR 或 STALE；无有效 generation 则无 data |
| SNAPSHOT_AT_LEAST | 读取符合 minimumWatermark 的已发布 generation，水位仅是 `task_board:<projectId>` 发布流。未达最低要求返回 STALE、无 data，不在 Query 内启动刷新或等待写入。cursor 固定的 generation 若不满足请求亦拒绝，不自动切新 generation |
| AUTHORITATIVE | 经独立 TE owning source-read 授权直接在当前一致性快照组装同一安全 row profile，不读 Projection、不触发发布；sourceWatermarks=[]，snapshotAt 为真实源快照时间。只承诺本次读时点，不是后续写权限或跨模块原子资格 |

AUTHORITATIVE 分页采用有期限的 source-fingerprint cursor：下页重新读取完整同 Scope 来源，只有有序 source fingerprint 与第一页一致时继续，变化时 `QUERY_CURSOR_SCOPE_MISMATCH`、无 data并要求重新查询；不混页、不声称保留了未持久化的历史快照。这是首版允许的“活跃更新时权威翻页须重启”限制，PROJECTION_OK 的旧 generation 分页不受它影响。source fingerprint 包含 row profile 及其源身份/版本，不以当前查询时间参与；cursor 的第一页 snapshotAt 在下页保持不变，返回前仍独立重验授权。

`asOf` 首版只定位仍保留的精确 generation.snapshotAt 或 authority cursor 固定 snapshotAt；不提供任意时间的历史状态重建，无法满足时返回安全错误、无 data。AUTHORITATIVE 无 cursor 不接受历史 asOf/minimumWatermark；非 PROJECTION_OK 的最低一致性要求失败不能附带不满足条件的旧数据。source-health 与 Projection 在分离的读事务取值，freshness 是有明确检查时间的观测，不承诺随后仍无新提交；保守错误不能升级 FRESH。

共享 Envelope 与 data 的 snapshotAt/sourceWatermarks/nextCursor 必须一致；resultHash 按共享 canonical 规则，不把失败正文或内部筛选字段加入公开结果。必须在本项实现组成层的完整 QueryResult，不能只验证 data 后宣称 freshness 已交付。公开 HTTP/UI、通用所有 Query transport 改造不在此目标内。

### B-05 独立授权与 owning 文档出口

拟在 IP owning 内部 Port 增加互相独立的条目：Human Board public read（既有 operation/Purpose，target 为当前明确支持的完整 Project Ref）、SERVICE owning source export/read、SERVICE source health read，以及 SERVICE Projection publish。每项使用自己的精确 operation token/version/Purpose/action/config key/Project target、single covering Grant 与当前 Policy/Decision 重验；内部 token 不进入公共 Catalog，未配置不放行。Human Decision 不转授给 worker；Projection publish 不授予 TE source read，source read 不授予业务写入。授权来源来自受信 Context/IP owning Port，禁止调用者声明 SERVICE 或提供行即成为可信 Export。

详细化时，以下是必须闭合的 owning Delta，而不是留给实现者自由选择的需求：

| 唯一权威 | 拟议变化 |
|---|---|
| Spec 003 §12 | B-01–04 的来源算法、有限支持集、三种一致性分支、完整 Ref 支持集合、cursor/freshness/error 逐字段规则 |
| Spec 001 的 TaskExecution 读取授权边界 | B-05 每项确切 mapping、目标/主体/Grant/Policy 来源指纹、签发及返回前重验规则；补齐 Policy 读取的独立授权 |
| PostgreSQL §34 | B-02–03 的每张表 canonical/mirror、唯一/不可变/CAS/fence/retention/ACL/RLS 约束与 dirty 写入者覆盖；不改已应用 migration |
| 共享 API 与技术 Policy registry | 完整 QueryResult freshness/error/Hash profile、cursor Secret 使用、有限 Policy 配置的规范化与资源拒绝规则；保持公开请求/data Schema |
| Module-Test-003/001 | 下述可观察验收及授权正反例，旧 TE-TD-027–032、039–042 逐项映射，未执行仍 NOT RUN |

四项具体缺口已按所呈现B-01–05闭合：Project/Task/WO/Item identity见Spec003 §12.4；七项独立授权和来源指纹见Spec001 §15.19；P1→H→P2健康检查/竞态和fence见Spec003 §12.6–12.7及PostgreSQL IM06-BOARD；配置固定Project PolicyVersion的既有注册/解析路径见Spec003 §12.5。实际source数据和权限由未来owning入口产生，不把构建期selector当Policy事实。设计技术审查已完成，Planner已根据仍相同的main、当前开放Issue与本工作区权威来源复核该有限实现候选NOW + READY；尚未实现。

## 3. 可观察验收

所有新场景当前为 `NOT RUN`。设计文档验证只能证明格式/链接，不是 runtime、安全或 persistence PASS。

1. Human 从真实 owning producer 形成 DRAFT/READY、正常完成、BLOCKED_INPUT/一次恢复与有限取消来源后，能看到准确 Task 状态、未终结 WO 与阻塞事实；不混淆 Run/WO/Task/DeliveryItem，不提升初始指派声明或历史 Completion 为当前资格。
2. 非空 statuses 与精确 DeliveryItem 版本先过滤后分页；源无 Ref 的行、v1/v2 Task 身份正确；初始任意 assignee 不泄露，显式 unsupported filter 无假空页。
3. G1 翻页间源合法变化、G2 发布，原 PROJECTION_OK cursor 仍完整读 G1，无重复/漏项；换过滤器/主体/Scope、篡改与过期均拒绝。AUTHORITATIVE 按限定支持完成读取，变化时明确要求重启；最低 watermark 未达及历史 asOf 不被假满足。
4. 暂停、无 alias、导出超预算、源不可用、重建与失败各返回真实 Envelope 状态；data/Envelope 元数据与 Hash 一致，不返回 OK 空页掩盖故障，不用独立 TaskState 查询“修复”Board freshness。
5. 两连接屏障证明 source snapshot 不混读；低序号晚提交 dirty 不丢失；旧 worker fence、发布事务中断、alias 切换后确认前崩溃均安全，重放只复用原 export/generation/sequence。先声明已到达屏障再提交并释放，不以 sleep 代替证据。
6. 单字段完整 Ref/filterKey、rowsHash/count/manifest/mirror 损坏拒绝发布或返回；Hash 包含字段有无及筛选来源。区分应用纯反例与实际 PostgreSQL guard 证据，不以不可达 SQL 修改冒充正常业务场景。
7. 首屏、翻页及返回前真实撤权/到期无 data；跨租户/cross Project Export/Query/publish 与直接 SQL 权限/RLS 拒绝；查询无业务写入、generation 创建、Driver invocation 或外部副作用。cursor Secret 不是 DTO 或 Decision Hash。

## 4. 执行顺序与门禁

用户已批准已呈现B-01–05及implementation草稿，owning详细Delta与失败场景已补齐；设计技术审查通过后由Planner复核NOW + READY并按本次授权发布。不得从旧提案、绿色CI或未来merge授权推导其他批准。

门禁满足并且权威文档可访问后，Planner 再复核当前 main/依赖/重复任务，为一个完整 Human Board 交付目标判定 NOW + READY。实现应把 Handler/完整 Envelope、授权、Export/dirty、generation/worker、过滤/cursor/freshness 和最小受控验收放在同一交付目标内，不预先拆成注册-only、存储-only backlog。本次已获Issue发布授权，发布后须读回；无commit/push/merge授权。

本轮仅 `.vibe/` Markdown，required target 为 `vibe verify docs --json`。未来涉及上述持久化及并发的实现 required `vibe verify full --json`；新/变化容器环境先 environment，可复用可信 exact-revision CI，不重复运行相同门禁。业务、持久化、外部和人工证据分开。

TD-07 统一退出/恢复证据在 Board 交付后按实际 main 重新对账；既有受控正链可以复用其准确层级证据，缺少的统一故障/重放不能因分散 PASS 自动补齐。真实 Runtime/Provider/Feishu、公开 HTTP/UI、生产/性能及独立人工业务验收保持 NOT RUN，IM-06 不关闭。

## 5. 人类设计批准与精确化绑定（2026-10-05）

用户在本提案与完整implementation Issue草稿呈现后明确回复“批准设计，发布到github”。该批准覆盖已呈现B-01–05、七项Acceptance、Scope/Non-goals和required full，授权发布该implementation Issue；不授权业务实现或Git交付。批准时main为917723f54757a5f17209095d4c68b6d5959f855e，提案文件SHA-256为42f78f426ff01d11bcad7e14b5f662d16e98a68f07b04b845a2fda4dfbb74df2；该Hash绑定添加本审批记录/精确化前的字节，不声称main已包含设计。

本轮补齐草稿明列的四项前置：采用实际冻结Ref拼写与完整Scope；按既有single-covering-Grant模式为所需读取/技术操作分配精确内部token；使用已交付IdentityPolicy PolicyVersion/Profile registry闭合有限配置；明确独立source-health/alias观察与当前lease期限校验。部署参数必须由合法Policy明示，限制和故障行为不由实现者临时发明。纠正裸Task及BLOCKED_INPUT保守来源描述是遵守既有冻结Contract，不新增兼容别名或放宽阻塞。

设计仍只在本地未提交的owning文档中；main没有这些Delta，后续实现必须访问本工作区的批准版本并保留owning文档。独立技术推导/检查记录与本批准分开，见下一节；所有新runtime/persistence仍NOT RUN，既有外部/人工和TD-07边界不变。

## 6. 本地设计技术审查与发布前复核（2026-10-05）

Reviewer技术核对结果：APPROVE（设计范围，无剩余阻断finding）。这是同一会话按Reviewer规则从Goal/Acceptance、冻结Ref/隔离/不可变性及共享Contract重新建立预期后核对actual文档Delta的技术审查；不宣称盲审、另一个独立审查者或运行验收已经发生。人类批准单独见§5，不用docs PASS代替设计批准。

被审基线main@917723f54757a5f17209095d4c68b6d5959f855e，对象为9份本地文档；按路径排序的UTF-8 `SHA-256 + 两个空格 + 相对路径 + LF` manifest Hash为a3cb86823dec473c5c83c288ae0ad38943058c4545a3bcb1e1439b4b8c2111ad。该Hash绑定追加本审查记录及审批/推进状态更新之前的字节，不冒称baseline commit含设计。

核对完整payload/Page/Item/QueryResult required/optional字段和Set/数组区别、现有三种consistency、旧Schema/metadata字节保持、四组完整Ref身份、七项独立authorization mapping/Grant/Policy来源及当前IP隔离、export/dirty/fence/retention、Hash域及故障data有无。首轮核对发现直接JSON claims不能满足共享OpaqueCursor 16–512字符；回到Planner修正为固定198bytes/264字符的compact HMAC结构，保留全部逻辑绑定后复核。长度/模式算术诊断已执行，仅证明编码规模可满足共享边界，不声称HMAC/Handler或PG运行PASS。发布sequence分配权精确归于Projection事务，未给TE/Projection增加跨Schema原子性承诺。

被审设计的vibe verify docs --json PASS（files=9，全仓格式），git diff --check PASS；执行环境使用已安装的pnpm11.19.0，仅将默认自动deps安装检查设为warn，报告enableGlobalVirtualStore记录不同，未安装依赖或修改配置。BOARD-D/IP-BOARD-D全部NOT RUN，未来implementation required full与各外部/人工边界保留。

发布前再次读回远端main，仍等于基线；当前开放Issue仅#27，无重复Board任务。已交付Task/WO/恢复/Completion/Usage来源满足此有限slice前置。四项实质缺口已在owning文档闭合，Outcome/Acceptance/Scope/References/full齐备；本工作区的批准来源可直接读取，main不含这些未提交Delta，另一checkout缺少来源时必须停止而非按旧§12实现。候选NOW + READY，按用户“发布到github”授权创建一个完整implementation Issue，并读回正文；Git交付和实现未由此授权。

已按用户授权创建 [Issue #248](https://github.com/qzhike/zhiju-business-core/issues/248)，读回状态OPEN、标题与完整Goal/Acceptance/Scope/Non-goals/References/Verify正文和发布稿一致。Issue明确本地未提交批准来源的访问要求；发布不使业务实现或任何NOT RUN验收变为完成，也不授权Git交付。
