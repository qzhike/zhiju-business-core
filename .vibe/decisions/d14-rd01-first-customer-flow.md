# D14 / RD-01 首条客户资料链路 Spec Delta

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。

技术设计已于 2026-10-09 获人类明确批准，绑定独立审查的 `a4da30706c12b3b351fc471c8ac5f99b2ab38873`，见 [PR 批准记录](https://github.com/qzhike/zhiju-business-core/pull/255#issuecomment-6075169806)与[正式 Review](../reviews/pr-255/Review.md#人类技术设计批准a4da307)。该批准覆盖已闭合的技术设计；§7 首发 Runtime/model/数据边界已在#256获得明确人类选择，但精确修订技术批准与部署事实、公司强制规则/词表和完整执行锁仍待齐备，未注册字段/profile 保持未来设计，依赖实现须重新核验 NOW + READY。

本提案交付 [Issue #253](https://github.com/qzhike/zhiju-business-core/issues/253) 的技术设计，保留 [D14 已批准初始化方向与布局](workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。对照基线为 UI authority `955461abff2f0b694fe08676e83d1f702f3cab03` 和当前 Core `b66beb0afcf3e71143c348348fcc41cfc7819cbb`。当前 API 只注册 HealthController；下文均为拟议公开操作和未来接受集，不是可调用 HTTP 或生产注册。现有 Schema、200 项历史兼容基线、Catalog 实际计数及样例 bytes 不变。

独立审查、精确修订的人类技术批准及 IM-DG-006 决定是冻结门禁；提交 PR 不代表已批准。审查证据在 PR 与 `.vibe/reviews/pr-<number>/Review.md`；未决选择见 §7。不能把依赖实现任务标为 READY。本提案不冻结文档修改、批准、发布或项目完成合同。

## 1. 所有权与完整支持集

| 用户步骤 | 唯一 owning 能力 / 拟议操作 | 精确输出与边界 |
|---|---|---|
| 明确新建 / 选择已有客户 | EP 既有 `project.create_enterprise@1.0` / 拟 `project.find_preparation_enterprises@1.0` | EnterpriseRef；名称不去重、合并或授予权限；新客户成功而项目失败保留客户 |
| 建准备项目 | EP 拟 `project.request_project_preparation@1.0` 驱动 `project.create_preparing_project@1.0` | 同事务 Root + ScopeClaim + Receipt；无 PROJECT_START；字段见 Spec 002 D14 |
| 上传 ZIP | IG 拟 `integration.request_customer_zip_intake@1.0`，内部受控 staging worker；EP 既有 register/accept_source_material | intakeRef、ZIP 原件、逐 entry 来源、validation 和不可变 manifest；接收不表示读取 |
| 捕获准备来源 | EP 拟 `project.capture_preparation_source@1.0` / `project.get_preparation_source@1.0` | purpose/audience 裁剪的 source snapshot；不伪造 Profile/QMS |
| 分析任务与上下文 | TE 拟 `execution.create_preparation_analysis_task@1.0` / `execution.build_preparation_context@1.0` | 新 PREPARATION_ANALYSIS selector；其后逐层支持 readiness/freeze/run/result，见 Spec 003 |
| 受控 Runner 与原始返回 | IG / Runtime 新 `d14.analysis@1` profile | dispatch 提交后调用；真实 Attempt/session/fencing/raw outputs；不确认客户事实 |
| 接纳报告 | EP 拟 `project.accept_preparation_report@1.0` | 不可变报告/候选/完整计划 snapshots；独立于 TE Result acceptance，不接受报告自称成功 |
| 查看与核对 | EP 拟 `project.get_startup_review@1.0` | 权威 binding、缺口、文件条件、允许操作；UI/BFF 只组合公开结果 |
| 单次显式确认 | EP 拟 `project.request_startup_confirmation@1.0` | 保存原意图，专用 Process 驱动 Human 决定、真实前置版本、一次 start，再接范围；无跨 Aggregate 原子承诺 |
| 一次正式启动 | EP 拟 `project.start_preparing_project@1.0` | 唯一 PROJECT_START + PREPARING→ACTIVE 同 Project 事务；失败不留下半份 binding |
| 本轮整份范围接收 | TE 拟 `execution.receive_initial_work_scope@1.0` | 精确 workScopeRef / Receipt；只接范围，不自动 READY、dispatch、批准 DeliveryPlan 或完成文件 |
| ACTIVE 首轮接收前重新核对 | EP 拟 `project.request_initial_scope_confirmation@1.0` / get/resume；TE 拟 `execution.get_initial_work_scope_state@1.0` | 独立 Human scope decision，保留原 start；仅尚未收到首轮 scope，有界补料分析，不重复信息确认/激活 |
| 原意图恢复 / 进度 | EP 拟 `project.get_startup_request@1.0` / `project.resume_startup_request@1.0`；TE 拟 `execution.get_work_scope_progress@1.0`；IG intake Query | owning Receipt / step facts / 水位；原键原内容，未执行保持 NOT RUN |

EP/IP/TE/IG/UI 的字段、授权与失败场景分别在 owning Spec/Test 的 D14 专节；[Core 03](../high-level-docs/03-core-contracts.md)、[Domain 04](../high-level-docs/04-domain-model-v0.1.md)、[一致性 05](../high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md)、[Catalog 06](../high-level-docs/06-typed-references-contract-catalog-v0.1.md)、[持久化 07](../high-level-docs/07-postgresql-logical-model-v0.1.md) 只维护各自权威。本文件维护方案选择与跨步骤导航，不复制生产 Schema。

## 2. ZIP、staging 与 Host 的交接

IG owning intake 先提交稳定请求和 Attempt，再由服务器流式收取原包到隔离 staging，核验声明与实际 bytes SHA-256、长度及安全扫描。原 ZIP 与每个原条目 bytes 保留；DOCX 转换只生成派生件。EP 在独立命令事务 register/accept 原件与合法条目，各自保存真实 validation；IG 只存其精确 refs/receipts，不写 EP 表。对象写入成功而 link 失败留下可审计孤立对象，原键重读/续接；cleanup 必须核验未被任何已提交 link 引用和 retention/legal hold，禁止用补偿删除已接纳客户材料。

拟定首版 `zip-intake-limits@1`：单 ZIP ≤100 MiB；≤1000 个条目；总解压 bytes ≤500 MiB；单条目 ≤50 MiB；每个压缩条目展开比 ≤100（空压缩体但有输出拒绝）；路径 UTF-8 ≤240 bytes、深度 ≤16；解包墙钟 ≤120 秒、进程内存 ≤512 MiB。计数、bytes 和限时同时约束流式过程，不能只信 central directory。DOCX 本身是 ZIP，必须再套用同样累计展开、条目/比率上限，计入本次总预算。所有数值是待批准的有界首版提案，不是已部署参数；放宽需新 policy version 和回归。

只接受普通未加密 ZIP；拒绝分卷、加密、路径穿越/绝对路径/驱动器路径、NUL、符号/硬链接、设备条目、规范化后路径碰撞、CRC/目录长度不一致及 ZIP bomb。安全或全包完整性失败：整体隔离、零 dispatch，保留安全原因。目录项仅作为元数据；不递归展开客户嵌套 ZIP。格式首版限定 `.docx`（实际 OOXML 类型与扩展一致、无宏执行）和 UTF-8 `.md`（不得执行 HTML/脚本/链接/嵌入）；不支持 PDF/XLSX/DOC/图片单文件分析。其他条目、损坏 DOCX、编码失败或读取受限均逐项返回 `UNSUPPORTED / CORRUPT / READ_LIMITED`；安全 ZIP 内有合法源时允许部分分析，缺口显式展示；零可分析源则明确拒绝分析，不制造空报告。

`entryId` 为服务器 UUIDv7，身份锚为 intakeRef + ZIP bytes hash + central-directory ordinal，不按文件名或 hash 合并来源；同 bytes 不同 entry 仍为不同来源。条目结果保存原始名（敏感）、normalized display path、实际 media type/bytes/hash、EP sourceRef、validation refs、状态/限制；服务器以 entryId 物化到隔离目录，不采用客户路径为宿主路径。后续 sourceId 是本 manifest 内唯一别名，Hash 相同不能替代身份。

Runner 输入只含本次已授权 CUSTOMER_MATERIAL、精确 PUBLISHED TEMPLATE、固定 RULE、授权 PREVIOUS_REPORT / TRUSTED_DECISION；来源具有 role、exactSourceRef、bytesSha256、服务器 relative path 与用途/有效期。公司输入由发布 owner/部署锁定，客户同名模板、AGENTS.md、Skill 或 MCP 配置只是客户证据，不加载成指令。Browser/BFF 不解压、不分析正文、不写对象存储；Browser 经公开上传传输，服务器生成 locator。Host 只核验 bytes、类型、绑定和引用，业务阅读/比较由 Runner 完成。原件/模板/规则只读挂载，报告根独立可写；运行结束重验输入 hash。控制文件解析器固定版本，禁用外部实体/宏/网络资源；CLI 权限提示不能替代进程级文件与网络隔离。

## 3. 原始报告与已接纳业务快照

正式新 profile 采用 v0.2 startupCandidates 的封闭结构；现有 v0.1 不变，且不具备启动能力。v0.2 JSON、Markdown 和提取件须来自同次 invocation。采用独立证据工具的确定性同源 renderer（从 JSON 渲染 Markdown），不让两个模型产物各自声明数量；工具版本与 renderer hash 进入 outputProfile。此提案不修改已有 JSON Schema/脚本，后续实现必须按下表注册接受集。

| 对象 / hash 域 | 定义与验证 |
|---|---|
| raw JSON / Markdown / ZIP / 原件 / 提取件 | 实际 bytes 的 SHA-256；禁止重排、去 BOM 或重写换行后代替原 hash；JSON 拒绝重复 key、非法 UTF-8、尾随内容、非有限数值 |
| inputManifestSha256 | Host 序列化后实际传入 manifest 文件的 bytes hash；不是 Core canonical hash，独立 extraction index 必须精确回传 |
| source snapshot / PreparationContext / AcceptedReport / CandidateSet / FilePlan | `SHA-256(cv1(payload))`，集合按声明稳定 ID 排序；自引用 ref、自身 hash 与可变生命周期不在 payload 中；外部 SnapshotRef 引用此值 |
| accepted report payload | schema/outputProfile refs、run/result/acceptance/attempt/observation refs、source snapshot/manifest bytes hash、前版 acceptedReportRef + raw JSON hash、JSON/MD 对象 refs + bytes hashes、候选/计划内容、alias mapping、接纳来源水位 |
| alias mapping | sourceId→本次授权 exactSourceRef + role + bytes hash；evidenceId→sourceId + 原件/提取件表示 + locator + 实际 hash；candidateId/fileId/changeId→本报告稳定 ID，不是任意 TypedReference |

Raw outputs 先由 IG 保存不可变 observation；TE 从实际原 invocation 验证 AgentResult 的来源、Run/Contract/Context/lease/fencing、结果格式及 profile 绑定，独立保存 Acceptance。报告属于 diagnostic WorkspaceOutput，不自动满足 BusinessOutput / Completion；EP 通过 TE owning 的拟 `execution.get_preparation_analysis_result@1.0` 取得已经 ACCEPTED 的精确 Result + 当前可用性及 IG observation 证明，确定性复核后才生成业务快照。EP 不直接读取 IG/TE 表，不把 RUN SUCCEEDED 当接纳凭证。合法缺失/冲突/PARTIAL 报告可被接纳以供审阅；输入/Scope/hash/引用结构错误隔离，不发布可操作快照。

接受规则：v0.1 的逐源 readCoverage、逐模板 templateCoverage、关联双向一致、唯一 ID、依赖 DAG、去重计划路径、历史问题逐项解释、索取 key 一致全部保留。sourceId/evidenceId 只能在本 manifest 中解析；提取件必绑定原件 sourceRef 和两种 bytes hash，Word 无可靠页码时显示稳定段落/表格定位，不能把提取行号冒充页码。READ 不得超过 extraction technicalReadCeiling；Hash/技术提取成功不证明理解或语义无损。模板条数不是交付分母；文件按 fileId 去重，M02~M25 等字符串不构成执行范围。JSON 与阅读报告语义有疑问需 Runner 修正/Human 核对，不能声称校验器已验证业务正确。

EP `candidateSetRef` 与 `planRef` 由已接纳报告派生，包含该报告精确 ref 和各自 canonical hash。报告当前 pointer 用报告请求序列与 EP CAS 前进，禁止按到达时间覆盖；迟到合法报告只保留历史，取消/过期 Run 返回仅留 IG late observation，不建立新的可操作 report。材料、规则、模板、权限或用途有效性变化追加 stale/impact 事实，不改历史快照；新分析使用新 source snapshot / Context / Run。

## 4. 必要启动信息与可信决定

| 分支 | 首版支持 / 正式 owner 映射 | 必要条件与限制 |
|---|---|---|
| ENTERPRISE_FACT | 仅 TEXT ValueEnvelope；由 EP propose/confirm_enterprise_fact@1.0 + 真实来源生成 FactVersion | 锁定启动规则要求的完整质量方针文本；组织图、表格目标、结构化职责不支持时显式 `UNSUPPORTED_CANDIDATE`，若规则要求则阻止启动，禁止扁平化伪造 |
| PRODUCT | productType、displayName、intendedUse、productFamily、非空 variants/markets、来源 → EP enterprise_product.create/create_version；已有精确版本可引用 | 全部结构必备；名称或“系列甲·中国”不够。首版仅版本化词表中的代码，未知代码拒绝确定性映射，不由 Host 猜测 |
| APPLICABILITY | 正式 requirementRef、outcome/rationale/evidenceRefs → QMS applicabilityDecisions | 锁定规则的 mandatory requirement 全集；高风险/启动必要项不能 PENDING_DETERMINATION；模板证明要求，客户依据支持适用性结论 |
| MANAGEMENT_CHOICE | choiceKey/selectedOption/rationale + EP 真实 Human BusinessDecisionRef → QMS managementChoices | 锁定 rule set 的必需 choice 全集，非空；Runner 不提供决定身份或自由决定引用 |
| PROFESSIONAL_DECISION | decisionType/outcome/rationale/evidenceRefs → QMS professionalDecisions | 锁定 rule set 必需决定全集，非空；专业判断由有权限 Human 作出，不把参考模板当已确认结论 |

首版拟 `startup-rules@1` 支持集限定为：有客户依据的完整质量方针 TEXT、至少一个完整 ProductVersion、QMS 三组必需条目及可信 Human 决定。具体 factType、productType/market 词表、requirement/choice/decision 精确 ID 与强制清单必须由公司发布为不可变 rule bundle 并在人类批准中逐项确认；不存在可解析 bundle 或某必需字段超出上述支持集时 fail closed，不能用匿名 demo.* 码、空数组或通用默认规则启动。已有客户可显式选择同 Enterprise、仍有效且适用本项目的精确 Fact/Product/QMS 版本，不能自动采用 latest。

[Issue #257 公司规则与词表提案](company-startup-rules-v0.1.md)提交真实模板来源、具体有界范围/必需清单、精确发布与取代条件以及支持集不足时的独立 Delta；公司业务清单于 `2026-10-09` 逐项确认，四类保护 Evidence 满足首版要求，不选择结构化 Fact 扩展。独立设计审查/技术批准仍待完成，未注册、未实现；该新确认单独留痕，不回写为本 D14 原批准。

`EVIDENCED / UNKNOWN / CONFLICT` 是 Runner 候选状态，未变为 CONFIRMED。UNKNOWN 保留已知部分和封闭 missingFields；CONFLICT 值为空并保留至少两组带依据 alternatives 与 conflictingFields；缺失、读取失败、未提供、Human 明确没有分别保留。非必需 UNKNOWN 不写入正式版本；若影响文件则整文件等待，独立文件不受牵连。Human 自身的答复经认证和来源接纳后可以成为候选证据；冲突解决须新证据/精确候选版本重新核对，不能在旧 CONFLICT 上点批量同意。

证据别名不是 `EvidenceRef`。使用既有 QualityGovernance `quality.capture_evidence_candidate@1.0` / `quality.verify_evidence@1.0` / `quality.get_evidence@1.0`，建立真实、精确 source snapshot、locator、captured content/hash、verification 与 claim 的 EvidenceRef；此为复用现有所有权，不新增 Quality 合同或放宽验证。Host 来源完整性只可支持确定性验证，专业结论需 Human；template ref/原路径不能直接填到 EvidenceRef。若 Evidence 生产/验证不能合法完成，信息确认停在 PARTIAL/明确缺口，不伪造 QMS/Fact refs。

可信 Human 确认固定 candidateSetRef + confirmationCandidateIds + report/plan/rule/input bindings。服务端从当前认证上下文取得 ActorSnapshot 和当前 AuthorizationDecision，EP 为每项决定保存原值/依据/风险/授权/Receipt。按不同 Aggregate 的既有 EP Capability 逐步创建 Fact/Product/QMS，Human-only 激活后生成 Profile/ProductScope；Profile 只接收精确来源，浏览器/Runner 不提交自由 payload 或 ProjectStartSnapshot。步骤失败保留已提交版本与回执，后续恢复不再生成同一对象。新项目复用企业版本不无声改写企业 current pointers；必须 Human 明确授权必要激活，记录对其他项目的 impact，其他项目冻结绑定保持不变。

## 5. 转换、原意图与恢复

每个 public Command 使用共享 Envelope 的 target/Scope、payloadHash、稳定 idempotencyKey 和必要 CAS。服务器保存原完整意图；下游键由 request UUID + step code + 精确对象 ID 派生，不含重试时刻。相同键异 payload 拒绝；重复查询/恢复仍重验当前权限。多步响应同时给总体 disposition、每步状态与真实 refs，不能用一个状态抹掉 owning 事实。

| 起点 / 故障 | owning 事实与转换 | 回读 / 允许动作 |
|---|---|---|
| 新客户创建成功、准备项目失败 | Enterprise 已存在；Project 未提交 | PARTIAL；原创建意图及 key 续接项目，不新建客户或删除客户 |
| 已有客户名相同 / 跨项目材料 | 无自动合并/导入；精确 EnterpriseRef，准备创建仍查当前权限 | 不可见统一安全错误；跨项目转用需明确来源接纳与授权 |
| PREPARING 收合法部分 ZIP | 保留 source/manifest 与部分限制；不写 PROJECT_START | 可分析/补料；一般文件写 Task 不可创建 |
| 分析尚未输出 / dispatch 超时 | 已提交 Attempt/Run；没有成功报告 | PENDING 或 UNKNOWN；查同原 attempt，UNKNOWN 禁止新键再 dispatch |
| report accepted，但必要值缺失 | report/candidates/plan 独立事实成立；项目仍 PREPARING | 显示启动 blocker，复制索取/原位补充；不凭 COMPLETE 放行 |
| Human 确认部分提交、前置版本失败 | 保存已完成决定/版本，PROJECT_START 尚未创建 | PARTIAL；只续缺失步骤，各自当前授权/CAS，过期则停止 |
| start 事务提交前故障 | 三 refs 验证、唯一 binding、ACTIVE、Receipt/Event 同事务回滚 | FAILED（先前步骤成功则 PARTIAL）；无 ACTIVE 半绑定 |
| start 已提交、范围接收失败 | Project ACTIVE、PROJECT_START 永久保留；scope 未接收 | PARTIAL；仅恢复原 scope，不得再次 start/更换 snapshot |
| 任何写步骤响应丢失 | “没收到响应”不等于没提交，旧 refs 不变 | UNKNOWN；先查原 request/key 及 owning Receipt；确认未提交才按同键重试 |
| 等待 worker / 尚未结论 | 持久化 intent/step 尚在处理，已知成功事实仍可读 | PENDING；只查询。PARTIAL 明确已有成功步骤和已知阻塞；UNKNOWN 优先于推测 |
| report/material/rule/CAS 变化或撤权 | 原请求的 current eligibility 失效，历史成功不变 | STALE + 完整 step facts；保留草稿，当前读后显式新意图；已 ACTIVE 不回 PREPARING |
| scope RECEIVED、未安排 Run | 真实 workScopeRef/Receipt；每文件仍 RECEIVED/WAITING | ACCEPTED 只表示确认、启动、范围接收均成立；进度从 TE owning 查询 |
| 同项目并发两次 start | 唯一 PROJECT_START + Project CAS | 一 winner；另一 STALE/冲突，可读已有真实 start；不得隐式把另一确认当成功 |
| 新准备路径已 ACTIVE、首轮接收前报告 stale/所选阻塞 | 原 start 不变；旧 intent 不改；EP initial-scope-confirmation 新 Human 决定绑定当前整份合法子集 | 有界 INITIAL_SCOPE_RECOVERY 可补料分析；新意图不再次确认/激活启动信息；收到首轮 scope 后关闭本入口 |
| 历史 FULL_START ACTIVE / 迟到报告 / 后续批次 | 历史 PROJECT_START/Context/Result 不改；旧项目不转准备路径 | 历史项目/后续批次不进入首轮恢复支持集，另行合同；迟到结果仅历史 |

`FAILED` 仅在确认、启动、范围均无已提交成功时使用；`STALE` 和 `UNKNOWN` 可携带先前成功步骤，不能重新显示“未启动”。resume 只接 requestRef、originalKey、允许的 `READBACK / CONTINUE_PENDING_STEP`，服务器查原 payload；不同 candidate/file/binding 或 new key 拒绝。安全查无 Receipt 只有在 owning 查询完整且确定时才是未提交；依赖不可用维持 UNKNOWN。成功后重复 resume 返回原 refs，不重复写/dispatch。权限撤销停止新步骤但不篡改已有事实，对无权读取者不泄露 refs。

首版 scope 的接收只保存整份文件候选授权意图，不批准保护例外、DeliveryPlan、文档修改或 Completion。每文件绑定 reportRef/planRef/fileId/full change set/PROJECT_START；精确 plan 中的必要 dependencies 和 protection/conflict 必须均满足。接收时若某所选文件已阻塞则拒绝该原集合，保留草稿，由 Human 重新选独立合法文件形成新意图；接收后新变化按文件追加 BLOCKED/STALE，不影响独立文件。后续 generation 工作在另行批准合同下建立，不因 scope receipt 自动 dispatch。

## 6. 兼容、迁移与安全 HTTP 映射

新增 preparation 操作/profile 是 additive；旧 create_project@1.0、create_task@1.0/@2.0、ProjectContext@1.0、synthetic Result/Runtime 的字段、purpose、Hash 域、支持集不扩大。新类型 canonical 拼写在 Catalog 提案表固定，不允许 legacy/canonical 互换。新 WorkOrder Contract/Context 接受集通过显式版本/profile selector 注册；旧冻结 Contract、v0.1 报告和历史技术 fixture 只读，不升级成可启动的新对象。

未来 forward migration 显式增加 creationMode=`FULL_START / PREPARATION`、PREPARING 与 source/report/startup/scope 事实。旧行只有验证既有 PROJECT_START 类型、Scope、hash 后才回填 FULL_START；旧 ACTIVE 缺 binding 是迁移阻塞/损坏记录，不改成 PREPARING。合法新 PREPARING 是 PREPARATION 且零 start binding；ACTIVE 必须有唯一完整 binding；Scope/memberPolicy 不可改，历史 refs 不重算。迁移、触发器、RLS、回滚/并发须真实 PostgreSQL full gate；本 Issue 不写 SQL。

HTTP 提案是公开 Catalog 的 transport mapping，不是 BFF 私有业务合同。Core public gateway 按 operation@version allow-list 路由到单一 Owner；未知新操作未注册时 fail closed。Browser/BFF 只能传共享 Envelope 或拥有明确定义的上传传输字段，不能传 Actor/AuthorizationDecision、CLI/path/model/Skill/MCP 或 storage key。认证由 BFF/OIDC 与受信 Core gateway 完成，不能相信公网 actor header；same-origin Session、CSRF、cookie 和可见错误沿用 UI-DG-003。上传 route 只接受原 ZIP 流与 server-issued intakeRef/token，不带任意目标 URL；下载/依据查询核验同 Scope 与当前权限，不返回宿主路径。

| 公开 transport / 结果 | 安全映射 |
|---|---|
| `POST /api/commands/{operation}/{version}` | 仅批准注册操作；COMMITTED/DUPLICATE→200；持久化受理尚待步骤→202 + 精确 requestRef；202 不等于任何 owning step 成功 |
| `POST /api/queries/{operation}/{version}` | 受权 AUTHORITATIVE 查询→200 + watermark/current eligibility；UNKNOWN 在已提交请求的 data 中表达 |
| `PUT /api/customer-intakes/{intakeId}/zip` | 只绑定 IG issued intake 与原 hash/长度；提交接收→202；流未完整持久化不得返回成功；响应丢失按原 intake 查询 |
| 未认证 / 当前拒绝 / 不可见 | 401 / 403（仅不暴露对象存在性时）/统一404；不区分别的 Scope hash/存在性 |
| CAS、stale、异 payload 同键 | 409 + 安全 code；超限413、格式415、安全/结构校验422；依赖503保持 UNKNOWN，不映射空成功 |

HTTP status 不替代共享 Result Envelope 或 per-step owning Receipt；响应不含正文/locator/secret/log/stdout。transport 只做类型、上传、认证和有限组合；BFF 不能自行执行未注册 Capability 或在会话内存维护业务 Process。

## 7. 首个 Runtime/Profile 候选与待批准选择

#256 的后续 [首发选择与执行锁提案](d14-rd01-runner-profile-lock.md)细化四目标证据、配置/安装观察/可运行锁三层、六项控制及真实conformance计划。人类已于2026-10-09订正首发默认为OMP（Oh-My-Pi）+ DeepSeek官方API + DeepSeek-V4.1-Flash；拟允许真实客户资料出网，但部署前必须按新Provider补齐合同、驻留、保留期与客户授权证据。独立审查/技术批准仍待取得；#253的精确修订批准不自动覆盖这一新提案，默认设计选择与缺失部署事实不因此成为已批准可运行profile。

**人类订正后的首发默认提案：OMP + DeepSeek-V4.1-Flash / `d14.analysis@1`，公司控制的单 Host 非交互 LOCAL_PROCESS，仅分析 DOCX/Markdown、输出 v0.2 完整报告；不开放 UI selector、不自动 fallback、不支持 session resume。** [OMP官方仓库](https://github.com/can1357/oh-my-pi)提供print/JSON和多Provider能力，[DeepSeek更新日志](https://api-docs.deepseek.com/updates/)给出当前API名称`deepseek-flash`（2026-10-09查阅）；OMP事件mapper与底层固定版本证据仍须独立取得，当前名称不能替代版本锁。oh-my-pi、pi、qoder-cli、Claude Code四目标和既有映射保留；人类选择不证明本地/服务器真实conformance，也不据独立测试猜它用过哪个Harness。

| lock / 待决定项 | 放行所需证据；缺失行为 |
|---|---|
| CLI、adapter、Host | exact observedCliVersion、binary/build digest、adapterCode/version、harnessId/version、Host image digest + OS/arch；只读探测非交互/认证能力，禁止输出凭据；未取得精确值为 NOT RUN，不用 latest |
| 模型与数据边界 | provider=`deepseek`、API ID=`deepseek-flash`、批准版本=`DeepSeek-V4.1-Flash`；仍需固定版本绑定/实际调用版本证明、精确modelConfigHash、新Provider数据合同/驻留/保留期/客户授权/预算/期限证明与精确修订技术批准；同ID不能核验底层版本或漂移时拒绝，不因选择放行实际客户调用 |
| Prompt / Skill / MCP | 公司 prompt hash、Skill 全集 refs/version/hash、工具与只读规则；首版 MCP 集合拟为空、禁止客户配置发现和远程工具；需要 MCP 时新 profile 与评审 |
| 模板 / 规则 / 词表 | PUBLISHED 精确 template refs/hash；rule bundle、startup mandatory list、product/market/fact vocabulary versions/hash，独立发布证明；缺一不形成可运行 profile |
| 输出与证据工具 | outputProfile/schema/renderer/reader/validator 版本与 digest；v0.2 与当前 v0.1 工具差异单独回归；`d14.analysis@1` 版本只是拟议，不代表 installed |
| IM-DG-006 | 人类批准该首发选择、6 个 Runtime controls 的 first-version 支持/拒绝、retry/cancel/UNKNOWN 策略和兼容成本；旧三个 CLI profile 不删除，扩大四目标后逐个 conformance |

首版控制支持拟定：已提交 dispatch、原 invocation readback、deadline/进程停止请求、合法失败后显式 new Run retry；UNKNOWN 不重启、terminal 不 resume；取消是请求，不是 ACK，迟到输出只留历史。CLI flag 不是安全边界，必须 Host 只读挂载、只准输出根写入、阻断未授权网络/工具与 secret 泄漏。若所锁 CLI 在真实隔离下不能产报告则候选不通过；不通过关闭权限或换 SDK/Provider 直连放行。

独立证据依据：v0.1 §2 的 E2E-full-md-20260922 原报告包含多对多模板、M25 悬空、17/18 数量不一致、组织图读限和自报批准等必要反例；本次不重跑/导入客户原文，不把这些历史报告当 Host acceptance。当前本地 evidence 工具只读复核：`runner_evidence/analysis.py` SHA-256 `30dc7e70377eb64fb5d11c1c3f2a78309bafc32faf9444b2a9b812d0198de0eb`、`reader.py` `cdb41d2cfd3f393b6f64d70f541a397248b65604b53b3e1407f74a6a4380168f`、`common.py` `e43bb39396aa9044e427f3493cbb69c09f40cf63a2ab27fee51dfd70dace06d1`，源于 `/Users/galendai/repo/qzhike/zhiju-doc-artifacts`；此 Hash 是观察定位，不是部署 lock。README / analysis.py 证明 finalize-analysis 使用 manifest bytes hash、extraction-index、逐源 SHA、v0.1 validator 与确定性 renderer；它没有平台 Scope、当前授权/lease、v0.2 startup 或业务快照接纳能力。历史样本未在此次目录按原路径重新取证，引用沿用已发表 v0.1 的已注明历史证据，不声称复验其内容。

被拒替代：由四目标列表推默认；将旧 standalone finalize 成功当 Host conformance；浏览器解析 ZIP/调用 CLI；让 Host 二次 Agent 分析正文；将报告“批准”当 Human；给旧 ProjectContext 填空启动引用；复制旧 Core 文档覆盖新 authority。

## 8. 后续验收与冻结门禁

| 层次 | 必须独立获得的证据 | 当前状态 |
|---|---|---|
| 设计 | owning fields/refs/hash/authorization/transition 逐项对账；owner Module-Test 正负/恢复 trace；精确 head 独立审查 + 人类技术批准 | PROPOSED；审查/批准证据见 PR，不预写 PASS |
| 独立 Runner | 脱敏 DOCX/MD、固定 inputs，真实锁定 CLI 实际 invocation；readCoverage/提取限制/模板关系/候选完整快照；报告正确性人工核对 | NOT RUN；只引用旧独立输入/输出设计证据 |
| Host acceptance | 将同一真实输出经过 IG→TE→EP 接纳；错 hash/Scope/session/fencing/alias/read ceiling/迟到全部拒绝；不能只运行 Runner 自检 | NOT RUN |
| Core / persistence | full，真实 PostgreSQL RLS/CAS/唯一 start/idempotency/崩溃/部分提交；旧合同与 migration 回归 | NOT RUN |
| Public / OIDC / Browser | 当前 Session、CSRF、跨项目/撤权、上传上限、原 request 刷新 UNKNOWN/PARTIAL、真实 per-file progress；实际 approved Chrome/Edge 支持矩阵 | NOT RUN |
| Human | 顾问从新/已有客户到同 Project ZIP、报告/缺口、三组核对/整份默认不选、原意图恢复；必要事实阻启动、保护冲突仅阻整份，独立文件可接收 | NOT RUN |

本设计分支只用 `vibe verify docs --json`；它验证 Markdown 和变更范围，不替代上述语义门禁。随后实现须注册 additive Schema/Registry/fixture 与版本 selector，并由新的完整工作项覆盖首条真实目标，不能仅以页面或独立脚本通过宣告 READY。范围接收后的生成、反馈、内部批准、发布、Excel 转换和全 Runtime 接入保持各自后续合同。

### 首轮范围恢复的有界闭合

EP [ACTIVE 首轮恢复字段](../module-specs/Module-Spec-002-EnterpriseProject.md#active-首轮范围重核对与精确-human-scope-决定) 和 TE [唯一接收事实](../module-specs/Module-Spec-003-TaskExecution.md#active-首轮恢复接受集与唯一接收事实) 定义：初次显式确认分别产生 informationDecision 与独立 initial_work_scope_decision；start 已提交但 scope 失败/STALE 时，只要尚无成功初轮 scope，Human 可经 request_initial_scope_confirmation 建新原意图，引用不变的 PROJECT_START 与当前 report/plan，选独立 eligible 整文件。必要补料分析仅在新准备路径 ACTIVE、初轮未收到的 INITIAL_SCOPE_RECOVERY 窗口，按冻结 start 分析；必需启动依据失效须 impact review，不能改写 start。TE current Query+最终唯一约束裁决，受理/Query 本身不占成功资格，竞态只一 scope。旧 request/key/binding/选择、已提交 start 及所有成功事实保持。成功接收后关闭此分支，后续生成/反馈/批次仍另行设计。
