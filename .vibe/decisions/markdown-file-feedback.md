# Markdown 整份候选与逐文件反馈 Spec Delta（#259）

状态：T2 / PROPOSED / DESIGN ONLY / TECHNICAL APPROVAL PENDING / NOT REGISTERED / NOT IMPLEMENTED。

本提案交付 [Issue #259](https://github.com/qzhike/zhiju-business-core/issues/259)。输入基线是 main@15c085354056ab327e03352c32020010cc11285b，包含 #252 / PR #254 与 #253 / PR #255；本工作树在 134dffec23a3ff87b378edcafd723f759110a991 上追加设计，保留之后已合入的 owning 增量。依据为[已批准的检查、反馈、个人草稿与本地改稿交互](workspace-mvp-human-agent.md#44-已确认的逐文件检查交互)、[D14 整份范围](d14-rd01-first-customer-flow.md#5-转换原意图与恢复)及 [IM-DG-005](canonical-content-renderer.md)。没有依赖本设计波次其他新 Issue 的实现，也不选择分析 Runtime。

本文件拥有跨步骤方案、取舍及设计 trace；字段唯一维护在 owning Spec。新增名称在 [Catalog 提案](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#markdown-逐文件处理名称提案259)登记为未来设计，不改变当前 Registry、Schema、兼容基线或可调用能力。独立设计审查及绑定精确修订的人类技术批准后才可冻结新增语义；生成 profile、真实 Host 接纳、内容人工验收与依赖实施的 NOW + READY 分别判断。

## 1. 完整支持集与事实分层

首版仅同一 ACTIVE Project、本轮已接收的一个完整 fileId、STRUCTURED_DOCUMENT、公司锁定的生成方案。首次生成、现有候选逐文件修改、旧基准 Markdown 建议复核各形成独立意图；不支持批量改稿、跨文件自动修改、保护例外、通用 Feedback Aggregate、Workflow Engine、Word 编辑/输出、WORKBOOK_SPEC/XLSX 转换或批准/发布实现。

| 事实 | 唯一 Owner | 成立条件 / 不能据此推导的事实 |
|---|---|---|
| 接纳材料、报告与完整计划、PROJECT_START | EnterpriseProject | 复用 D14 精确来源和 Human 决定；范围接收不批准任何保护例外 |
| fileSourceBinding、原提交意图、专用有限 Process、Task/WorkOrder/Context/Run/Result/Validation/Acceptance | TaskExecution | 每文件完整计划和必要依赖当前可用；范围 RECEIVED 不自动 READY 或 dispatch |
| 原调用 Attempt/session/lease/fencing、原 JSON/Markdown/身份映射及 bytes | IntegrationGateway / Runtime | 保留真实原 invocation；退出码、输出文件或 Runner 自检不能证明受控候选 |
| 基线结构映射、已确认修改约束、Canonical Content、不可变 Revision、候选接纳、Diff/定位、Representation | Artifact | ART 独立核验 TE 来源与完整内容、范围、保护、对象 readback；不写 TE 或 Quality 表 |
| Evidence、ReviewIssue、Gate、RAS、Approval/ABS | QualityGovernance | 复用精确来源/claim 与当前资格；新候选或意见“已处理”不关闭 Issue、不产生批准 |
| 每次当前读/写/依赖/下载与本人草稿授权 | IdentityPolicy | 原 ActorSnapshot/Decision 仅作历史，不能复用过期或撤销许可 |
| 固定高度检查页、单意见区、主动切换版本 | UI01 / BFF | 只组合 owning Query/Result；sessionStorage、DOM、浏览位置均不成为业务事实 |

TE 保存私有草稿和提交 Process 的技术支持记录；它们没有新的领域 Feedback Aggregate，不替代 InformationRequest、ReviewIssue、Task 或 Artifact。UI/BFF 不拥有这些记录的业务状态或持久化数据库。

## 2. 从完整计划到下一候选

1. EP 授权读回本轮 workScope 所绑定的 reportRef、planRef、PROJECT_START、整份 change/KEEP 集合、真正前置依赖、来源及保护项。fileId 是原计划内的稳定别名，以 workScopeRef + fileId 绑定，不按文件名、路径或模板数认定身份。
2. Human先在已有整份计划核对页调用[TE确认前准备Command](../module-specs/Module-Spec-003-TaskExecution.md#280-确认前的提案准备与公开读回)，TE提交原request/Receipt后以独立SERVICE权限调用ART source-mapping Port读取精确主基线和模板。此时不要求Root/Branch/Revision/constraints。基线为已有sealed Revision，或已接纳、可无损映射的Markdown来源；DOCX原件只能作为D14已接纳的证据/派生来源，原件与提取件hash/locator分别固定，读取受限的结构不能伪装成无损Markdown基线。每个change、KEEP和保护项都须映射到具体Unit/subtree/新建锚及完整claim。自然语言计划、报告evidenceId或行号不能直接成为allowedUnitRefs。
3. Human以原request/key/hash调用TE get_file_constraint_review只读Query，取得完整baselineMapping/提案及精确Refs/cv1 Hash/当前资格；Query不运行producer、不暴露SERVICE入口。MAPPING_REQUIRED时在同整份核对页明确原映射位置，以新准备意图携带exact mapping/items；ART确定性核验rangeProposal/结构/源绑定，不猜自然语言范围。完整提案READY且mayConfirm时Human才确认exact proposalRef，ART提交重验源/保护/CAS。缺映射、重复标题无法唯一对应、保护依据缺失/冲突、ragged table或源结构有损时，只阻该文件。已有D14 scope Receipt没有确认授权含义；prepare/get/confirm均不自动安排Run或创建Root，也不扩大已选集合。后续反馈可沿该Artifact已接纳lineage复用仍有效的stable范围，但每次冻结新的current；锚或保护变更须显式新约束确认，不迁移旧意见。
4. TE 由当前 owning 来源构建 fileSourceBinding；显式首次生成请求或一次“提交并修改”冻结独立原意图。受理仅表示持久化请求。专用有限 Process 独立推进新 Task、DRAFT WorkOrder、真实 Context、Validation/Freeze、Run、IG dispatch；每步有自身权限、稳定键和 Receipt。不把这些步骤做成一个跨模块事务。
5. Runner 只读所锁定原件/模板/保护证据/原提交快照，输出整份 candidate Markdown、结构身份映射和逐意见处理报告。IG 先封存原 bytes；TE 核原调用、Run/Contract/Context、输出 profile/schema/hash、lease/fencing 和结果格式，保存 immutable Result/Validation/Acceptance。此 profile 的 raw proposal 属 WorkspaceOutput，不冒充已有 #233 的 creationRequired BusinessOutput。
6. 首份文件先由TE原Process独立调用既有ART create_artifact/Query建立确认identity的Root和实际main Branch，不能预造branch事实；现有文件复用合法Root。ART 经 TE 权威 candidate-binding Query 消费已经接纳的提案，独立 parse/canonicalize/round-trip、完整 Diff、scope/protection/evidence/locator 检查；通过才 stage→readback→link→finalize→FROZEN→seal 新 Revision。首次 Parent=[]；修改 Parent=[提交时 current Revision]。Revision provenance 可引用已存在的 AgentResult，不补未来引用。ART 接纳事实绑定原请求、Result Acceptance、raw bytes、约束、内容 Hash 与创建 Receipt。
7. 新 Revision 创建与 Branch Head 前进分开。只有既有 move_working_head 的当前授权/CAS 成功才成为当前候选；Head 冲突保留已封存历史及 PARTIAL/STALE 回执，不能覆盖并发成果。旧 Revision、已批准/发布绑定、原提交与未提交草稿均不改写。
8. IG经独立新operation integration.request_markdown_render@1.0从该exact Canonical Revision确定性render Markdown，ART核原operation及真实render binding后登记Representation。旧request_render@1.0的{request:RenderRequest}不变；不声明不兼容Minor。阅读候选来自已封存Canonical Content；Markdown下载还须exact REGISTERED Representation与当前bytes权限。任何一个步骤都不产生RAS、Human Approval、Release、EffectiveBinding或Completion。

允许“可检查候选已建立，但 Markdown 导出失败”；状态分别显示 Revision/Head/Representation 事实。不为了下载失败回滚 Revision，不把 raw output 下载成正式候选。文件数量仅从完整目录的 owning facts 派生；其他独立文件持续处理。

## 3. Markdown 支持、解析与无损规则

语法/profile 与 Canonical 映射由 [ART #259](../module-specs/Module-Spec-004-Artifact.md#13-markdown-候选定位与表示提案259)拥有。拟 profile 为 artifact.markdown_document@1.0，新 structure selector 为 artifact.markdown_document.schema@1.0；仍使用 CanonicalContentPayload、canonicalizationVersion=1、STRUCTURED_DOCUMENT。不新增 MARKDOWN ContentType，不把 .md bytes 变为 Source of Truth，不更改 IM-DG-005 的旧 Schema、Diff/Human Edit 接受集或历史 Hash。

| 首版结构 | 明确语义与处理 |
|---|---|
| UTF-8、中文、占位符、□/☑/√、编号及版本文字 | 原 bytes 不变保存；Unicode 不做 NFKC、不把“Ⅰ”换成“I”；占位与示例不转客户事实；不自动签批 |
| ATX 1–6 级标题、正文、强/斜体、inline code、分隔线、普通有序/无序列表及缩进续行 | 保留全部标题，包括采购程序的两个 H1；标题级数和原编号是语义，稳定 ID 不由标题文本或序号推导 |
| rectangular pipe table、空白 header/cell、转义竖线、每列 alignment、宽表 | 每个实际单元格有身份；空白不转成 0、null 或 UNKNOWN；UI 横向滚动不裁列；同文字重复行不合并 |
| 单元格内换行 | 仅精确 allowlist 的 `<br>`、`<br/>`、`<br />` 映射 HARD_BREAK，不放行属性或其他 HTML；两空格行尾与反斜线硬换行也有明确映射 |
| 已填记录 | 数量/日期/姓名/备注按原文本完整保留；空签名、数值“0”和“未提供”分别表达；不执行公式、不把填写当客户活动证明 |
| 不支持或危险结构 | raw HTML/属性、脚本、图片/嵌入、外链/自动链接、front matter、注释身份指令、脚注、代码块、引用块、合并单元格、ragged table、未知扩展等：显式 UNSUPPORTED/UNSAFE，零自动补齐/删改 |

格式换行 CRLF→LF、可选 UTF-8 BOM 去除、固定转义/列表 marker/列宽仅发生在派生确定性 render 中；不能覆盖 raw hash。Markdown 整份建议不是 byte-exact 回放：render(parse(md, identityMap)) 再 parse 必须得到同一语义树、Unit/row/cell 身份、元数据与 contentHash；原始 bytes 单独可审计。纯空行排版与 table padding 不进入语义，正文空格、硬换行、标题、编号、alignment 与格式 span 进入语义。不能证明等价就拒绝整个候选，不发布部分删减版本。

先扫描 UTF-8/字节/节点/深度/表规模，再固定版本 parser，禁网络/执行/HTML DOM 解析。拟 markdown-limits@1：单文件 10 MiB、100000 Units、标题/列表深度≤6、单表≤128列/10000行、单逻辑文本≤65536 Unicode code points、解析≤10秒/256 MiB；共享 Gateway guard 若更严格则先拒绝，不削弱既有上限。profile、parser、renderer、mapping/validator 版本及 digest 在公司生成锁中明确绑定；这些数值仅待审设计，部署与大样本可行性 NOT RUN。

## 4. 精确 Diff、位置与大目录

ART 公共变化目录是对现有内部 Diff 的 additive 提案，旧 get_revision_diff_inputs 不改字段或行为。from/to 必须同 Artifact、同 Scope、exact sealed Revision + FROZEN Canonical Hash；首次 Parent=[] 用显式 EMPTY_INITIAL baseline，全部新增，不假称与源 Word/模板的已批准 Revision Diff。源文件对照作为另有 exact source/mapping 的辅助依据，不能混入批准变化证据。

服务器按稳定 Unit 身份报告 ADDED、REMOVED、CHANGED、MOVED，同 Unit 可同时 CHANGED+MOVED。变化条目包含双方位置/claimHash、上下文章节/表/字段、前后完整值或受权内容入口；删除保留旧位置，新增不捏造旧位置，移动显示两端。Diff Hash 覆盖算法版本和两个 exact inputs+排序后全条目；不因分页、Browser 高亮或浏览次数变化。Diff 是可重建读取值，不是 Gate/Approval。

Location 是带 revisionRef 的 Value Object，不是以任意文本 unitId 冒充 UUID TypedReference。ART 独立核验 Unit kind、path、claimHash 和 exact Revision；旧→新解析返回 UNCHANGED/MOVED/CHANGED/REMOVED/AMBIGUOUS/UNSUPPORTED，只给迁移建议，不改原引用。已删位置只能查旧版、移除或经顾问重新引用；重复 label、重建 row 或错误 Evidence claim 不自动绑定附近内容。

变化目录固定 totalChanges、chapterGroups 和 page limit=1..100；server cursor 绑定 exact inputs/diffAlgorithm/filter/sort/授权水位。36变化跨9章样例必须可逐处跳转、搜索章节、查看全文，同时保留单意见区与当前展开章节；不能把一页或最后一次 change 当整份检查完成。大文件目录由 TE 权威按 workScope 查询，limit=1..100，支持 filename/code/state 查询和已存在计划导航标签；201文件跨页、未接收文件、待执行、可检查与失败分开，总数/分母不取已加载页数。目录标签不冻结新条款归口/编号替代规则。

## 5. 一文件意见、Quality Issue 与旧基准建议

| 输入 / 意图 | 不可变提交内容 | 可执行边界 |
|---|---|---|
| 普通修改意见 | exact 项目/workScope/file/plan、viewedRevision、submittedCurrentRevision、reviewBasis、原文、location 集合、已接纳附件 refs、作者/Decision、key/hash | TE 拥有普通 edit intent；至少非空意见或一份 suggestion，不因只引用位置生成修改 |
| Quality ReviewIssue 关联 | exact Issue refs、origin Revision/claim、原问题快照；改稿处理结果逐条引用 | 仅链接既有 Issue；要 Raise/Propose/Verify/Close 仍调用 Quality 自身操作和权限；不把全部自由意见建 Blocking Issue |
| 一份 Markdown suggestion | IG 封存原 bytes/length/hash、显式 declaredBaseRevision、提交时 current Revision、既有 representation/identity map（有则精确核对）、原意见与位置 | 一次一文件；文件名、内容自称版本、hash 相同或导出注释不能证明基准；上传不是 Revision |
| PLAN_OBJECTION | 原计划+原文+完整文件上下文 | 暂停该文件后续安排，保留已有 Run/Revision/history；不暂停同轮独立文件、不自动取消进程或重写计划 |

当前 viewedRevision 必须与 submittedCurrent 相同才可提交普通 edit；发现新 Head 是 STALE，保留草稿并主动切换/核对。旧基准建议是唯一有界例外：declaredBase=B、submittedCurrent=S（B可旧）、suggestion=M 同时固定，Human 明确要求受控复核。ART/Runner 对 B→M 意图和 B→S 已有变化分开检查，以 S 为新候选 Parent；S 的无关改动须保持。无可信 identity map 时只能提出基于精确上下文的 tentative 对应，重复行/标题无法唯一判定即待澄清，不给内容 Hash 匹配自动授予稳定 ID。冲突必须在原意见区保留具体 B/M/S 位置与原请求。

服务器归纳自然语言不能扩大授权：新增/删除/移动/字段改写均受整份已确认约束和保护；涉及其他文件、超范围、保护项或不清楚的位置先 NEEDS_REVIEW/CLARIFICATION，无新 dispatch。改稿相对 S 的实际完整 Diff 仍需 ART 验证，不能仅检查 B→M。提出保护例外停在受影响文件，本提案无例外批准入口。

每条 feedback item 保留 id、原文/位置及 HANDLED/NOT_HANDLED/NEEDS_JUDGMENT、proposedLocations 和解释。处理报告只声明 Runner 做了什么。部分反馈可产生含明确未处理项的候选，但不得显示“意见全部落实”、自动解决 ReviewIssue、批准或扩大范围；涉及未解决冲突/保护或无法验证的 locator，则不建立可操作候选，返回待判断事项。顾问核对新版和原位置后，用新 key/新 snapshot 显式提交；原请求永久保留。

## 6. 私人草稿与提交恢复

未提交草稿的唯一作者由可信 HUMAN Context 推导；key 空间按 principal + Enterprise + Project + workScope/file + viewedRevision + draftId 分隔。server 保存 immutable draft snapshots 与 CAS pointer，原文、附件 refs、declaredBase/旧位置、clientEditId、pendingSubmission 传输快照均纳入 canonical draft hash。不保存 Session token、Presigned URL、对象路径或 CLI 设置。默认仅本人；Project 管理员、其他顾问、Agent、Runtime 不能借项目读权读私稿。撤权停止读取/保存/提交，保留受控历史，不把未提交稿分享给 Runner。

输入自动保存到 TE；收到对应 editId/hash 的权威 Receipt 后才显示“已保存”。刷新/关页/换设备由当前身份查询恢复同精确版本的私稿和 pendingSubmission；旧稿可供显式复制核对，不随 incoming Revision 改绑。BFF Session 只含认证技术状态；sessionStorage 可作未确认 buffer，但不满足 server persistence 或跨设备要求。

两设备同稿 CAS 只一 winner。loser 保留输入与原 snapshot，可自动用独立新 draftId+稳定 key 保存同作者的 recovery fork（保存不执行）；不能覆盖 winner 或拼接文本/附件。用户在现有意见区选择要继续的草稿、核对差异后显式采用。保存 UNKNOWN 按原 save target/key/editId 查询，依赖不通仍 UNKNOWN，不能标已保存或删除 buffer。离线/限额/存储故障有明确未保存状态，不保证尚未到服务器的文本已跨设备存在。

点击“提交并修改”先在本人 draft snapshot 保存 pendingSubmission={预分配 requestRef、原 commandId/key、完整 public payload、requestPayloadHash}，然后只提交该一次请求；这个个人传输快照不是已受理事实，也不自动重发。TE 原意图事务保存 ActorSnapshot/Decision、immutable submittedIntentRef、Receipt 与唯一文件占用，commit 后才推进步骤。提交成功也不删除新输入：仅将被确认提交的 draft snapshot 标为与 request 关联；后续键入/附件进入新的未提交 snapshot。

UNKNOWN 的短时自动查询预算拟为同一次提交累计≤10秒、最多3次，绝不重发，刷新不重置预算；超预算在唯一意见区保留“重新查询”。get_file_processing_request 以原 request/key/payloadHash 核验当次权限，返回原提交与实际每步 facts。只有完整 TE request+Receipt 索引确定未提交且 private pending snapshot 精确匹配才 CONFIRMED_NOT_RECEIVED，用户可明确按原键重试。NOT_FOUND/无权/超时/错上下文不当作未提交。已接纳、排队、运行、候选返回分别表示；UNKNOWN 禁重复提交、批准或第二 dispatch，但可以继续保存下一轮草稿。

## 7. 转换、故障与历史

| 故障 / 状态 | owning 事实与允许恢复 | 零自动行为 |
|---|---|---|
| request 提交前失败 | 确定未提交才同原键重试；private pending snapshot/输入保留 | 无“已接收”或新键 |
| request commit 后 Task/Context/dispatch 前失败 | PARTIAL，保存全部已提交 refs；resume 只推进原缺失步骤 | 不重建成功 Task、scope 或历史 Run |
| dispatch 已提交但 Host ack/提交响应丢失 | UNKNOWN，查原 Attempt/journal/Receipt | 不 second invoke、不换 Runtime、不空 Result |
| raw proposal/TE Result 已接纳，ART parse/scope/protection 失败 | 单文件 BLOCKED/NEEDS_REVIEW；raw/TE 历史保存，零 accepted candidate | 不把部分内容包装为成果 |
| Content finalize 不确定 | manifest 不 FROZEN，request PARTIAL/UNKNOWN | 不 seal Revision |
| Revision 已 seal，Head CAS 或 render 失败 | 保留 Revision、原请求和失败步骤；Head stale 不选候选，render 可原 Attempt 恢复 | 不回滚历史/覆盖新 Head/伪造下载 |
| 输入/模板/保护 Evidence/当前权变化 | 每文件追加 STALE/BLOCKED，停止新步骤；历史成功不改 | 不静默新基准/新 refs |
| 返回时 current 已是 S2 | 旧 S→candidate 只作历史待重新核对；当前页仍原 viewedRevision | 不 silent rebase、不替换阅读/意见/批准 |
| 新意见在原 Run 处理中 | 仅个人 next-round draft；新候选返回后由 Human 核对再提交 | 不进入原 frozen Context/Result |
| 计划异议 / 未处理意见 | 仅受影响文件暂停或待判断；独立文件正常，旧处理报告保留 | 不全项目暂停或自动关闭 Issue |

resume_file_processing_request 只接受原 ref/key/requestPayloadHash 与 CONTINUE_PENDING_STEP；当次权限/源资格/CAS 重验。不接受新正文、附件、fileId/base、profile、计划或新键。确定终态失败后的再次执行须显式新 request/Context/Run；maxAttempts、deadline、cancel/late profile 另由经批准生成锁定义。terminal Run 不恢复，未锁定或漂移的生成 profile 零 dispatch。

## 8. 设计 trace 与真实来源

所有下表对象 B/S/C、request、Human、201文件及客户记录均 SYNTHETIC / DESIGN TRACE；不是已创建的 Ref，也不预造 UUID/hash/Receipt。模板原件是真实已检入快照，版本与 raw SHA-256 由本文件所链接文件和 procurement-fixtures.js 复核；不导入真实客户任务。

| Trace | 输入、步骤与可核验预期 | owning 场景 / 执行状态 |
|---|---|---|
| MF-01 首份候选 | [采购申请单 A/0](../prototypes/workspace-mvp/templates/application.md)全标题/三表/空签批；无Root/Revision/constraints→Human prepare→只读get完整baselineMapping/MAPPING_REQUIRED→明确range的新prepare→get exact proposal/map/Hash/资格→整份confirm→显式generation request/新Run→IG原输出→TE Acceptance→ART C1 Parent=[]/Head CAS；blank与“0”分别可读→exact Markdown Representation/download；每次读回均当前Human+SERVICE独立授权，prepare/get/confirm不dispatch | ART-MF-001/002、TE-MF-001、IP-MF-004、UI-MF-001、IG-MF-001；NOT RUN |
| MF-02 单文件改稿 | C1 数量为空、库存量“0”；原意见“数量补12，保留库存0”+数量 exact location→新 immutable intent→C2 Parent=[C1]；Diff只列授权字段，顾问主动换版，C1签批仍空 | ART-MF-003、TE-MF-002、UI-MF-001；NOT RUN |
| MF-03 真实模板结构 | [采购程序 A/5](../prototypes/workspace-mvp/templates/procedure.md)两个 H1、表1=3列表头/5列行、br换行、维护历史；可保存原来源但 ragged 阻该整文件，不能 pad/merge/去历史；[评价记录 A/0](../prototypes/workspace-mvp/templates/evaluation.md)5评价维度、审批栏与编制说明#4差异仍可见，独立候选不受牵连 | ART-MF-004/005、QG-MF-001；NOT RUN |
| MF-04 有损/恶意 Markdown | 多/少列、重复伪身份、未知扩展、非UTF-8、HTML属性/脚本、外链、超限；或 render→parse 改编号/空白/0/复选状态/换行→拒整个 candidate，原bytes/raw validation仍在 | ART-MF-004/006、IG-MF-002、IP-MF-003；NOT RUN |
| MF-05 超范围/保护 | Runner 添“金额阈值审批”、删总经理批准、改人员/方针或多个文件；与已确认范围/完整保护 claim 不符→ART零候选或TE零dispatch；只阻该文件 | ART-MF-003、TE-MF-003、QG-MF-001；NOT RUN |
| MF-06 大目录/移动删除 | 复用 [36变化/9章匿名场景](../prototypes/workspace-mvp/README.md#multiple-change-layout-preview)，另以同一方案构造201 fileId设计集合；跨页跳change，新增/删除/移动明确；旧引用REMOVED不能移附近行，目录第201项可访问，current inputs变则游标拒绝 | ART-MF-007/008、TE-MF-004、UI-MF-002；NOT RUN |
| MF-07 旧基准建议 | 复用 [旧版改稿场景](../prototypes/workspace-mvp/README.md#external-markdown-revision-suggestions)：B=C2、S=C3、M改B的§5；S的§7更新保持；冲突回原区待判断，返回C4的Parent为C3；若current已C5则C4仅历史 | ART-MF-009、TE-MF-005、UI-MF-003；NOT RUN |
| MF-08 UNKNOWN/部分提交 | 复用 [原提交核验场景](../prototypes/workspace-mvp/README.md#submission-receipt-reconciliation-preview)：原request commit响应丢失→最多3次查询/10秒后手动查；Task已commit/dispatch未知，不新key；刷新重登同原意图，当前撤权阻续步 | TE-MF-006/007、IP-MF-001、UI-MF-004；NOT RUN |
| MF-09 两设备私稿 | 同author同C3两设备CAS；一winner、另一保留recovery fork；运行中新的文字/附件始终不发原请求，新C4返回不切页/绑位置；另一Human/Agent/Admin不可读 | TE-MF-008/009、IP-MF-002、UI-MF-005；NOT RUN |
| MF-10 部分处理/Issue | 两意见一HANDLED一NEEDS_JUDGMENT；候选/处理报告分别完整，未处理不伪完成；linked Blocking Issue仍OPEN，作者自验/Agent Approval拒绝，后续Quality另行精确验证 | TE-MF-010、QG-MF-002/003、UI-MF-006；NOT RUN |
| MF-11 Evidence/locator错配 | EvidenceRef存在但captured source/version/claimHash不等、原提取hash换掉、同名Unit或新Run拿旧session；来源/保护/locator拒绝，旧Evidence/Revision/raw留历史 | ART-MF-010、IG-MF-003、QG-MF-001；NOT RUN |
| MF-12 seal后故障 | ART创建提交后Head CAS失败；另一文件可继续。Head成功而request_markdown_render@1.0 UNKNOWN：页面读C2，下载等待真实Representation；重放原键只返回同Receipt/Revision。legacy {request:RenderRequest}在旧request_render@1.0仍合法，在新入口拒绝；新flat Markdown请求只走新入口，wrong profile/hash无successful binding | ART-MF-011/012、TE-MF-007、IG-MF-004、UI-MF-007；NOT RUN |

## 9. 兼容、取舍与验收门禁

采用新的 additive 操作/profile/schema/支持记录；不放宽旧 public Human Edit、create_execution_revision 的初版 Parent=[]/Human-only 约束、synthetic Runtime/final、D14 analysis 或旧 Renderer media-type allowlist。新的受信 ART/TE/IG Service 各用自身权限，不借 Human 历史 Decision；所有旧 Ref 拼写仍按各操作接受集解析，不建立通用 alias。新增表/约束只在后续实现的 owning Schema，旧记录无迁移或历史重算。

拒绝：.md bytes 作为 Canonical、以 Browser Diff批准、自动三方 merge/last-write-wins、将未提交草稿作为 request、把全部意见升级为 Quality Issue、上传直接创建 Revision、从自报成功倒推真实 invocation、对不规则表自动补齐、跨文件扩改或保护例外默认通过。

本设计成功标准是六项 Acceptance 都能追溯到唯一 Owner、完整字段/Hash/权限/转换、正链和必要反例，严格 Markdown diff 的 docs 配置目标通过。focused 检查核 owner/operation/ref、字段闭集、transition、trace ID 与链接；不是实现测试。新场景的 PostgreSQL/full、OIDC/HTTP、真实 generation feasibility、Host/Runner acceptance、公开下载、Windows/macOS Chrome/Edge、独立内容人工批准均 NOT RUN。批准设计只关闭设计门禁，不宣告生成 profile已可运行或依赖实现 READY。
