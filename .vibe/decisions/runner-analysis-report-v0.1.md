# Runner 分析报告 Schema v0.1 设计提案

- 日期：2026-09-22。
- 状态：**PROPOSED / T2，供产品与技术审阅**。用户已授权以独立测试报告设计 Schema，尚未批准本草案的字段合同或实现。
- 所属提案：[Human + Agent 工作台 MVP](workspace-mvp-human-agent.md)。工作分支 `codex/frontend-mvp-design`；不改变 main 的 IM-06 实现。
- 交付物：[JSON Schema](runner-analysis-report-v0.1.schema.json)、[匿名合成 JSON 示例](runner-analysis-report-v0.1.example.json)、[对应 Markdown 示例](runner-analysis-report-v0.1.example.md)、[提取件定位示例](runner-analysis-report-v0.1.example-extracted.md)。JSON Schema 使用 Draft 2020-12；`urn:zhiju:design:runner-analysis-report:0.1.0` 是设计标识，不是已注册公开 Contract。

## 1. 本次要交付的能力与边界

顾问在明确项目内上传客户 ZIP，后台受控解包、准备本轮输入目录和公司模板目录，向已配置的服务器 Runner 发起**分析**。Runner 先读企业文件、建立保护与来源关系，再比对模板，返回分析计划报告。顾问首先看需补要的资料和必须决定的问题，可以复制索取内容、补交资料或确认后续工作范围。

产品层已确认：客户资料接受 DOCX / Markdown，ZIP 是批量接纳容器；升级成果仍为 Markdown。服务器 Runtime 目标为 `oh-my-pi`、`pi`、`qoder-cli`、`Claude Code`，员工不选择 Runtime、模型或修改公司执行规则。上传包中的其他文件不得静默算作已经读取，也不因接受 ZIP 扩大到所有 Office 格式。既有成果的本地改稿仍按单份 Markdown 建议处理。

平台负责接纳、解包、来源清单、受控调度、结果接纳、展示及可信 Human 操作；**阅读客户正文、业务匹配、覆盖判断、缺口与冲突分析均由 Runner 完成**。平台的确定性校验只检查形状、绑定、引用、文件与声明是否一致，不另调用模型分析客户内容，不凭文件名生成业务判断。

本 Schema 只承载 `stage=ANALYSIS` 的一次完整报告快照。它不设计 ZIP API、Runtime Driver、数据库迁移、正式生成交付清单、文件差异或发布包协议。读取了生成后报告用于发现反例，不把技术自检结果混成首轮分析通过，也不把分析报告当作成果正文。

## 2. 实际报告依据

基准目录：`/Users/galendai/repo/qzhike/zhiju-doc-artifacts`，本轮样本 `E2E-full-md-20260922`。报告是此次设计输入，不是当前 Core 已接纳的业务事实。未重跑 Runner、原报告校验器或法规核验。

| 实际材料 | 读取位置及用途 | Schema 对应 |
|---|---|---|
| `work/.../修改计划-v1.md` | §1 模板去向，§2 M 项，§3 U 项，§4 P 项，§5 K 项，§6 编号，§7 分批执行 | `templateCoverage`、`changes`、`attentionItems`、`protectedFacts` |
| `work/.../修改计划-v2.md`、`-v3.md` | 在 v1 上追加答复、批准转述和剩余问题，不是完整替代文件 | `context.sourceReportIds`、前版精确绑定；Human 决定另行保存 |
| `work/.../企业保护基线-v1.md` | 方针、目标、组织、程序、产品和文件身份；正文与提取限制 | `protectedFacts`、`evidence`、`readCoverage` |
| `work/.../模板-企业-输出对照表-v1.md` | 309 个模板条目、客户承载、处置、拟输出；多对多关系 | `templateCoverage` 与去重后的 `plannedFiles` |
| `output/.../审核说明.md` | 原始 DOCX 与转换件区别，检查范围，未做语义审核，组织图读取失败 | 来源表示、读取限制、`checks` 的自报边界 |
| `output/.../审核说明-附录-逐件待确认.md`、`人工审核清单.md` | 单一问题影响多份文件；待确认项也可能存在于正文目录 | `affectedPlannedFileIds`、阶段化影响，不按目录推定批准 |
| `work/.../final-verify.json` | 文件数量和有限技术检查结果 | 仅用于后续生成结果设计参考，不是本分析 Schema 的业务完成字段 |

关键文件 SHA-256（精确 bytes，本次设计参考）：

| 文件 | SHA-256 |
|---|---|
| 修改计划-v1.md | `a3c235174bf3d47447f616b26d138dfb103359c41d2d85b7c9f10ee5e47e11aa` |
| 修改计划-v2.md | `6aa2e10200642fcb99271685cd7a7fa994fb5ea2fcc4ba2151c4be8e52422285` |
| 修改计划-v3.md | `54e9572d8887339dad3d78493898a8ea8f58d7369775c73110ba9c573509d4e1` |
| 企业保护基线-v1.md | `674b4daff0683a1051cd447195f4cd2ed1837ad2e513cf272e2ffcce2964135e` |
| 模板-企业-输出对照表-v1.md | `d90ec21ca8bc187eeba28668a9a7573d8270c18d3e7f935b4a1503b86c6ce5c3` |
| 审核说明.md | `65b94d08f9512dc7f27d2fc019242d5a4267008bfed4a94b29ff93fa2f88536f` |

此次不复制客户原文、个人姓名、质量参数或完整报告到前端仓库。示例只保留关系和问题类型，输入集合缩为三份客户资料、三份模板；全部是匿名合成数据，不是实际测试的全量转换。

### 2.1 从样本反推的必要约束

1. **缺失不等于没有**：U16 是支撑文件未提供，U17 是其中的职责依据，两者部分重叠。组织图则已提供但不可可靠读取；软件适用性 U09 属事实问题。这些必须能分别显示。
2. **模板不等于交付文件**：纠正/预防等功能允许一模板多客户文件；共享表单允许多模板关联同一拟交付文件。模板 309 项不能直接作为交付进度分母。
3. **编号不可自动展开**：v1 的 M 项表没有独立 M25 定义，而批次文字出现 `M02~M25`。保留原文并提出不一致，不能自动补造 M25 或把区间当成已知授权集合。
4. **数量需对账**：审核说明称制度表单 17 张；附录明确列 18 张，本次目录盘点亦为 18 个 Markdown。后续生成进度应基于接纳的文件清单；本 Schema 的拟交付数量只按 `plannedFiles.id` 去重计算。
5. **报告声明不是权限**：v2/v3 中的“批准”和后续审核说明中的“批次获批”是 Runner 报告内容，不能代替平台可信 Human 决定。本文不判定独立测试缺少批准，只限定机器接纳的证据来源。
6. **字符串命中不是语义审核**：既有技术检查与报告中的 `NOT RUN` 保持分开；“抽样即可判断全批”等原报告表述不继承为平台验收规则。

## 3. 交接物与来源绑定

一次分析输出两份同源文件：`analysis-report.json`（本 Schema）和 `analysis-report.md`（顾问可读报告）。Runner 在同一次分析中生成二者；平台不再用另一个 Agent 从自由文本猜字段。JSON 绑定 Markdown 实际 bytes 的 SHA-256；界面栏目与操作以已接纳 JSON 为准，Markdown 提供完整阅读和追溯，不自动触发操作。

正式输入继续使用既有 `RuntimeExecutionPackage/materializationManifest`。Adapter 在项目/Run 工作区内物化客户文件、模板与公司规则，Runner 获得的目录路径仅是授权工作区内的访问方式，不能替代精确源对象、Hash、Scope 和执行授权。

本草案在 materialization manifest 上**建议增加版本化的输入别名映射**，字段为 `sourceId → role / materializedRelativePath / exactSourceRef / contentHash / displayName`；`role` 限定客户来源、模板、前次报告、可信决定输入。此映射的正式字段嵌入点在 Runtime owning Delta 审查时冻结，不将这里的字符串 ID 注册为 Core TypedReference。

| 字段 | 提供方与意义 |
|---|---|
| `context.analysisRequestKey` | 服务器预先分配，Runner 仅原样回传；Adapter 从真实 dispatch 绑定 project/Run，不能信此字符串授权 |
| `context.inputManifestSha256` | 本轮输入别名清单 bytes 的 SHA-256，由服务器锁定并校验回传；这是附件摘要，不改既有 Package/Context Hash 域 |
| `context.previousReportSha256` | 首轮为 null，后继分析绑定前一份已接纳 JSON 的 bytes；重复/迟到报告由既有 Attempt/Result 语义处理 |
| `context.sourceReportIds` | 已物化的历史报告 ID，用于保留 v1/v2/v3 来源链；每项须存在于本轮输入清单且角色正确 |
| `narrative` | 本轮报告相对输出路径与实际 SHA-256；允许根、文件存在性、真实路径和 Hash 由 Adapter 检查 |

报告不自带 `approved`、`accepted`、`released`、Core `status`、用户身份或自选 Runtime 配置。服务端记录的接纳时间、原文对象、报告摘要和真实 Run/Project 绑定在外层；无需让 Runner 生成第二套执行收据。

## 4. 字段结构与用户用途

| 顶层字段 | 内容与约束 | 页面用途 |
|---|---|---|
| `schemaVersion / stage / context` | 版本、固定分析阶段、本轮和前轮绑定 | 避免旧报告替换当前结果 |
| `title / summary / narrative / limitations` | 可读说明与完整报告；摘要不作为进度数据源 | 紧凑概要、全文和限制入口 |
| `analysisCompleteness` | `COMPLETE / PARTIAL` 仅表示所声明范围的分析完整性；有待顾问决定仍可分析完成 | 显示读取/分析是否受限，不表示文件升级完成 |
| `readCoverage[]` | 每个输入的读取状态、实际范围和限制 | 已提供但未读、失败、部分读取可以区别 |
| `evidence[]` | 来源 ID、原件/提取件/历史报告/可信决定输入、真实定位、可选原文、说明；提取件另外绑定相对路径与实际 Hash | 回查判断依据；提取行号不得展示为 Word 页码 |
| `protectedFacts[]` | 方针、目标、组织、职责、流程、产品、文件身份及来源状态 | 企业保护内容，按需查看；Runner 提取是候选，不覆盖正式 CustomerBaseline |
| `attentionItems[]` | 缺失、读取问题、事实问题、保护冲突、来源冲突、报告不一致 | 首屏待处理事项及复制索取内容 |
| `resolutionProposals[]` | 本轮不再开放的历史问题及其解决/替代建议、依据；首轮为空 | 防止补料后旧问题无解释消失；不是正式关闭记录 |
| `plannedFiles[]` | 去重的拟交付文件、客户编号、来源和拟输出路径 | 项目交付范围；不把拟路径当下载地址或已有 Artifact |
| `templateCoverage[]` | 每份模板的处置、客户承载、多对多输出关联及依据 | 完整对照，默认次要展示 |
| `changes[]` | M/K 类动作、目标文件、保护影响、相关问题和前置动作 | 修改计划按需展开，后续确认范围的候选输入 |
| `checks[]` | 方法、范围、限制、`PASS / FAIL / LIMITED / NOT_RUN`；统一为 `RUNNER_DECLARED` | 告诉顾问检查过什么，不冒充服务端验证、人工审核或 Quality Gate |

本样本没有独立 R 清单，因此 v0.1 不要求 Runner 虚构 `requirements[R001…]`；对应要求通过模板处置及真实 evidence 表达。将来独立要求目录作为单独版本化增量设计。

### 4.1 缺失资料与索取内容

`attentionItems.kind` 使用：

| 值 | 中文展示与处理 |
|---|---|
| `MISSING_MATERIAL` | 本轮资料集合未找到所需材料；不能断言企业不存在 |
| `UNREAD_MATERIAL` | 已提供，尚未实际读取；优先交回分析执行处理 |
| `UNREADABLE_MATERIAL` | 已提供，但无法可靠读取；必要时请客户提供可读版本 |
| `PARTIAL_MATERIAL` | 已有资料缺少必要部分；只索取缺少的内容 |
| `FACT_QUESTION` | 需要确认实际情况，不计作缺少一份文件 |
| `PROTECTION_CONFLICT` | 拟修改可能影响保护项，需要专项决定 |
| `SOURCE_CONFLICT` | 客户资料或依据之间有矛盾，不任选一方 |
| `REPORT_INCONSISTENCY` | 报告自身数字、编号或来源不一致，需要 Runner/顾问核对 |

每项包含 `reason / question / evidenceIds`，以及 `affectedPlannedFileIds / relatedChangeIds / protectedFactIds`。`effect` 是 Runner 对受影响阶段的建议，不是 Core 的权威阻塞状态；`BEFORE_AFFECTED_GENERATION` 不阻塞无关文件。

材料类问题带 `material`：期望材料名称、查找过的来源、实际已提供的来源及限定范围。缺失项不得指向一个实际已提供的同一材料；读取失败项必须指出真实输入。不存在的文件只用期望名称描述，不编造 sourceId。

需要客户处理的事项可以带 `customerRequest={key,title,text}`。同一材料可关联 U16/U17 等多个问题，但使用同一 `key`，文字必须一致；平台确定性去重、合并关联影响。顾问选择全部或部分后复制文本；复制不代表已发送、已收到资料、已确认事实或已批准修改。系统不在此发送消息、不建客户账号、不增加发送追踪。

已确认“没有”的情况来自可信 Human 记录，Runner 在新分析中引用它，提出是否基于模板补建；旧缺失项如何关闭或替换必须有后继报告的明确变化和可信决定依据，不能凭上传成功或新报告省略就消失。

### 4.2 交付关系与计划

`plannedFiles.id` 在当前工作内稳定；客户原编号与模板来源分别保存。一个模板行可关联多份客户资料/拟文件；多个模板行可共享同一拟文件。`plannedFiles.proposedOutputPath` 是计划，不代表文件存在、Artifact 已注册或可发布。

模板处置保留七种结论：适配既有、已有等效覆盖、派生新建、外部主体承载、待确认、不适用候选、历史参考。待确认/不适用候选需关联具体 attention 项；顾问决定后的正式适用性记录由 EnterpriseProject owning 流程负责，模板缺少客户来源不能自动变成不适用。

`changes.protectedImpact` 区分 `NONE_DECLARED / POTENTIAL / EXCEPTION_PROPOSED`。无影响只是 Runner 声明；后两类必须关联保护对象和待处理事项。`KEEP` 保留 K 项。`dependsOnChangeIds` 只表达真正前置动作，普通相关文件放关联字段，不能据此无故阻塞。

`legacyLabels` 只用于保留原报告编号/文字与追溯。实际引用均用明确 ID 数组，不接受区间或 `同某项` 作为可执行范围。计划描述不取代受控执行约束、精确批准范围或后续候选审阅。

### 4.3 后继报告与顾问确认

v0.1 新 Runner 每次返回**完整快照**，不让浏览器合并自然语言增量。Runner 读取前次报告、此次补充和可信决定，再输出新 JSON/Markdown；`previousReportSha256` 精确绑定前版。新报告未通过接纳时，旧报告仍可查看，并明确当前更新失败。

报告内 ID 在同一项工作中稳定复用，不因排序改变。后继快照需与前版做确定性差异对账：旧开放项或者继续存在于 `attentionItems`，或者逐项出现在 `resolutionProposals`。后者必须说明前版 ID、解决/替代建议、原因和新依据；替代时须引用当前问题 ID。同一旧项不能既保留开放又提出关闭，不能对不存在的历史 ID 提议关闭。

未解决问题若无可信决定、来源补充及可追溯替代而被删除，不能自动关闭。Runner 的 `RESOLVED_PROPOSED` 只显示“建议已解决，待核对”；正式关闭按 owning resolver/可信顾问确认完成。v0.1 保留历史项与待核对变化，具体正式 resolver 的字段与权限在 owning Delta 中收敛，不让前端发明状态机。

顾问答复、计划范围确认、保护项例外和最终成果批准是不同事实，记录在既有 owning 流程中，指向**精确报告 Hash + 具体事项/动作 ID + 当时版本**。Runner 仅接收授权范围内的决定输入，不能用报告自报“已批准”替代真实记录；批量同意普通修改不自动批准保护例外。

旧独立测试报告仍原样保留。可由 Runner 在独立任务中按 v1/v2/v3 和相关基线重新整理成此格式；当前示例不是自动导入工具，平台不自行猜历史批准、补出 M25 或把段落正则识别当专业结论。未经正式接纳的历史报告只供阅读。

## 5. 确定性接纳规则

JSON Schema 只保证字段形状与局部条件。以下关系、绑定及权限需由服务端执行，Schema 验证通过不能代替它们：

1. 校验 Schema 版本、大小约束、JSON 完整性、真实 dispatch/Run/lease 绑定、输入摘要、前版摘要；限额继承已冻结 Runtime/接纳策略，不能靠截断满足限制。
2. sourceId 只可解析到本轮 manifest 的授权对象；角色匹配，不能以客户上传的同名模板或指令覆盖公司输入。文件名和报告中的路径不能决定对象身份。
3. `readCoverage` 对本轮应读输入逐项且唯一；遗漏或失败不能包装成全部读完。`COMPLETE` 要求约定读取范围完成，但不等于所有业务问题已解答。
4. evidence ID 唯一，来源、表示与定位有效；提取件的 `sourceId` 指向原始输入，`extractedText` 绑定本轮独立输出的 Markdown 提取件及 Hash，并校验其真实文件。没有原文时 `quote=null`，不可把 Runner 推断冒充逐字原文。只引用历史报告的判断不能自动获得原件证据等级；Hash 一致不证明转换语义无损。
5. protected/attention/planned/change/check 的 ID 唯一，所有跨集合引用存在；依赖无自环或循环。M25 等悬空引用必须报告错误，不自动造对象。
6. templateCoverage 对本轮纳入的模板逐项且唯一；所有 customer/template ID 角色匹配。没有适用性结论不能从表中删除模板。
7. 相同 plannedFile ID 只计一次；规范化拟输出路径不得碰撞。未知、尚未决定输出的模板继续以待确认展示，不能把当前拟文件数标为冻结交付总量。
8. 索取 key 相同的 title/text 必须一致，否则返回报告矛盾；同一 key 合并所有受影响文件。材料缺失、未读、读取失败及事实待确认分别计数。
9. 检查拟文件、change 和 attention 的双向关联一致；模板待确认问题也允许尚无拟文件。涉及保护影响的动作必须关联相应保护对象与具体待决定事项。
10. 验证 narrative 路径属于本 Run 允许输出根、真实文件存在且 Hash 匹配；禁止目录穿越、符号链接逃逸等替换。`proposedOutputPath` 只做计划展示，不用来读取真实文件。
11. `checks.PASS` 始终是 Runner 声明；不能创建 Human Review/Approval、Quality Gate、Release 或 Completion。自报确认也不能解析成认证 Human 身份。
12. 不支持的结构、未知引用、矛盾摘要、未决历史状态保留可读原报告与明确错误；不可拼造空成功报告、静默采用另一文件或启用受影响的执行入口。
13. 逐项对账前版开放问题；删除项必须有 `resolutionProposals`，替代对象和证据须存在。无前版时该数组为空；不得凭关闭建议直接建立正式 Resolution Receipt，也不得删除或改写原保护基线来制造“无变化”。

本次把严重结构/绑定错误视为报告不接纳。业务材料缺失、保护冲突和有依据的分析限制是**合法的部分分析报告**，应显示给顾问，不作为格式错误丢弃。若 JSON 合法但与 Markdown 业务含义不一致，平台不能靠形状验证发现全部矛盾；须由 Runner 修正/顾问审核，同源输出及来源追溯不能被表述为语义正确性证明。

## 6. 与现有 Core 的关系及 Spec Delta

本次核对权威依据为本地主仓 `main@96ecfa069cb2c49a8ce21c9fafb5cad9bede6c8b`；前端设计分支基线为 `6b6d533409171ba11a429d042c84858e3b035dae`。引用路径指向仓库正式 owning 文档，落地前须按最新 main 再对账，不能用较旧前端分支覆盖新契约。

- [Core Contract §5](../high-level-docs/03-core-contracts.md) 的 `AgentResult@1.0`、外层执行收据、Hash 与完成语义保持不变。本 JSON 是建议的 Provider 输出子协议，不直接冒充 AgentResult。
- [Runtime Contract §5/8/10](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md) 继续约束精确物化、工作区与接纳。报告初始只属于受控 WorkspaceOutput；该类输出 `diagnosticOnly=true`，不满足 BusinessOutput/ExpectedOutput，也不自动形成 ArtifactRevision。
- `attentionItems` 是 `findings/inputRequestProposals` 的候选内容来源；正式 InformationRequest/事实确认仍由对应模块命令创建。首版 CustomerMaterial Profile 的覆盖范围不能直接扩张到所有保护例外和升级计划。
- [UI Spec](../module-specs/Module-Spec-UI01-WorkspaceUI.md) 保持 Web/BFF 为 Experience Layer；BFF 不直接调用 CLI、数据库或模型，不拥有完成、审批和发布状态机。

| 拟增量 | Owning 位置 | 本次状态 |
|---|---|---|
| RD-01 报告子协议、输入别名映射、四 Runtime 共同输出规则及失败语义 | Runtime Contract/Test、IntegrationGateway Spec/Test | 仅本文与 JSON 草案；未注册 Profile，四 Runtime 适配未验收 |
| RD-02 原始 ZIP 接纳、DOCX/Markdown 输入、读取与来源证据 | EnterpriseProject/Artifact/IntegrationGateway 输入与存储契约 | 业务方向确认；公开操作、存储和解析实现未设计完成 |
| RD-03 分析报告的正式对象/查询与计划确认、保护例外 | EnterpriseProject/TaskExecution/IdentityPolicy、必要 Quality 契约 | 不预设新 Aggregate/API。若要满足 ExpectedOutput 或用于执行授权，须冻结 owning 对象与可信确认绑定，不能滥用 diagnostic WorkspaceOutput |
| RD-04 缺口优先、索取复制、报告与当前状态分离 | UI Spec/Test、产品发现、工作台提案 | 缺口、索取复制、总览及补充复核已有匿名原型；正式 UI 接入与业务状态尚未实现 |

因此本草案足以供 Runner 输出格式讨论与 UI fixture 设计；**不表示现有 Core 已能运行真实 ZIP→Runner→报告→授权生成链**。不更改正式 Module Spec、已批准 Contract、公共 Catalog、数据库或 main。

## 7. 首版可验证验收

| 场景 | 应有结果 |
|---|---|
| U16/U17 请求同一职责文件 | 可显示两个问题，复制只出现一次材料请求，关联影响完整 |
| 已上传 DOCX 的组织图未读出 | 显示读取受限及来源，不能显示客户未提供整个手册 |
| 一个模板由两份企业程序覆盖 | 两份文件保留独立身份，模板只一条；不生成重复程序 |
| 软件事实未知 | 模板仍待确认，既不自动不适用，也不声称客户缺少软件文件 |
| 公司模板拟增职责 | 保护项、关联动作及待决定事项可一起查看；不能由普通批量同意自动解锁 |
| v1→v2/v3 历史增量 | 原报告保留；新格式输出完整快照并绑定来源链；旧批准转述不变认证决定 |
| 注入 `approved=true` 或 `stage=GENERATION` | 本 Schema 拒绝；分析子协议不能携带批准或生成结果 |
| 缺失 source/evidence/M25、重复 ID、循环依赖 | 确定性接纳拒绝，不补造对象 |
| 同一索取 key 文案不同 | 显示报告矛盾，不随机选一段复制 |
| 跨项目来源、输入摘要或前版摘要错误 | 接纳拒绝，旧页面仍可查看，不替换当前报告 |
| narrative 缺失、越界路径或摘要不符 | 接纳失败；不把终端 final 文本伪装成完整报告 |
| 技术检查 PASS、业务审核 NOT_RUN | 两者并列保留，不能显示“已批准/可正式交付” |
| 原报告 17 与清单 18 不一致 | 清单对账并显示差异；不以摘要数字驱动进度 |
| 后继快照省略未解决问题 | 保留旧问题及待核对变化，不自动关闭 |

Schema 与合成示例可做离线形状/引用反例检查。这是设计验证，真实 Runtime 生产此格式、上传/解包、服务端接纳、跨设备、人类确认、业务语义与端到端运行均为 **NOT RUN**。实施前完成 owning Delta、人类技术审查和独立审查；不将编写本草案的授权解释为实现或 Git 交付授权。

当前已用匿名示例制作分析报告、总览和补充复核原型；用户已阶段性认可总览，补充复核页面仍待体验确认。后续可选择一个实际 Runner 试产同格式报告，需单独明确实施范围。页面演示不代表该生产链已验收。


## 8. 补充资料后的完整快照示例

[后继 JSON 示例](runner-analysis-report-v0.1.followup-example.json)、[对应 Markdown](runner-analysis-report-v0.1.followup-example.md) 以及[新增职责资料示例](runner-analysis-report-v0.1.supplement-source-example.md) 仅服务补充复核原型；不改变 Schema。新增资料完全匿名合成，输入集合增加 `C-ROLE`。后继报告的 `previousReportSha256` 绑定首轮 JSON 的精确 bytes，`narrative.sha256` 绑定对应 Markdown；输入清单摘要仅是合成标识，不代表已接纳的服务端 Manifest。

首轮 U16/U17 由两条 `RESOLVED_PROPOSED` 说明替代；两条事项仍对应同一个客户索取需求。页面必须显示“建议已解决，待核对”，保留历史入口，不计为正式关闭。U-ORG-READ、U09、P03 继续保留，保护事实不变，法规现行性和人工业务审核仍为 `NOT_RUN`。F-ROLE 的来源建议改为客户现有职责文件，尚未批准新计划，也未产生任何成果版本。本例不演示正式 Resolver 或 Human 接受解决建议的命令。


## D14：准备分析与启动信息候选（方向批准，字段待闭合）

2026-10-08 用户批准[同一项目先准备、分析后核对启动信息](workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。v0.1 保持不变；`protectedFacts.statement` 不是已满足 EP 启动输入的产品/企业/QMS 结构。下一版交接须由 Runner 输出带来源的 EnterpriseFact/Product/QMS 候选或明确 UNKNOWN/冲突，Host 只做确定性身份/来源映射及校验，不增加正文分析 Agent。新字段、版本、typed ref 映射和可信 Human 决定关系必须与 EP、TE PreparationContext 和 Runtime 一起技术闭合。本轮新增 UI 启动信息是独立匿名 fixture，不能当作原报告提取或正式 Snapshot。


### D14 字段细化草案：Runner 候选、展示与确认

状态：`PROPOSED FIELD MAPPING / NOT REGISTERED / NOT IMPLEMENTED`。用户于 2026-10-08 批准当前核对面板布局；本节继续细化其数据来源与提交关系，不批准新公共字段。现有 v0.1 Schema、样本和已接纳报告保持不变，新结构须放在下一版输出子协议。Core 输入依据再次核对 `main@b6e1f93d7a79e6334622c55b94f124750143949e` 的 [EnterpriseProject Spec](../module-specs/Module-Spec-002-EnterpriseProject.md) 和[前置 Capability §4—6](enterprise-project-capabilities.md)；本分支对应文档保留较早副本，字段落实前仍须与主工作区 owning 权威复核。

三个 UI 摘要区不等于三个自由文本字段，也不等于已生成的 ProjectStartSnapshot。Runner 提出带依据的值，服务器完成确定性映射与校验，可信 Human 确认后由 owning 服务形成版本和 Snapshot。以下为字段映射候选，字段名与新版本的注册位置均待技术闭合：

| 摘要区 | 下一版 Runner 候选的内容 | 来源与正式对象关系 |
|---|---|---|
| 企业基础信息 | EnterpriseFact 候选：`factType / value / validPeriod? / riskLevel / proposalReason`，以及逐项依据和未决事项；界面仅显示客户名称及需保护的信息摘要 | 客户文件或显式接纳的客户答复为事实依据；Enterprise 身份来自已选择/新建的正式项目范围，不按名称推导。Profile 由 EP 从精确 Fact、ProductVersion 和已激活 QMS 引用生成，Runner/浏览器不得填写自由 Profile Payload |
| 体系与规则 | 对已锁定规则的适用性建议：`requirementRef / outcome / rationale / evidenceRefs`；客户现行管理安排、专业判断及待定项按既有 QMS 三组结构记录候选 | 公司的升级规则/模板使用服务器锁定的精确版本；客户资料提供企业范围与现行安排依据。公司预设不能证明客户职责、流程或产品事实；Human 决定由可信入口另行创建，不接纳 Runner 自报决定引用。沿既有 QMS Revision/激活规则形成正式版本 |
| 产品范围 | 产品候选：`productType / displayName / intendedUse / productScope(productFamily, variants, markets)`，以及逐项来源；界面摘要以产品和市场为主，详细用途等在依据中展开 | 不从模板产品例子填值；类型/市场代码须由受控词表确定性映射，不能由 Host 再调用 Agent 猜测。EP 创建或明确引用精确 ProductVersion，再生成 ProductScopeSnapshot；不能仅以“产品系列甲 · 中国”替代完整输入 |

候选还需以下公共包络。它属于 Runner 输出子协议，不是已注册 Core Fact、授权或 TypedReference：

| 拟字段 | 用途与校验边界 |
|---|---|
| `candidateId` | 在本次完整报告中唯一；服务器把报告内别名映射为受控候选对象，客户端不以显示名称作为身份 |
| `kind` | 封闭到本轮需要的企业事实、产品、QMS 建议类型；各分支使用对应结构，不开放任意 `value` 对象来承载整个启动快照 |
| `valueState` | 拟采用 `EVIDENCED / UNKNOWN / CONFLICT`。EVIDENCED 仅声明有依据，不等于 Human CONFIRMED、服务端接纳或业务正确；UNKNOWN/CONFLICT 保留具体缺口与相互矛盾的来源 |
| `evidenceIds` | 解析到本轮已授权 manifest 来源与报告 evidence；有值的客户事实候选须有依据。读取受限和原件/提取件区分沿用 v0.1，不能把未读内容标为原件证据 |
| `reason / relatedAttentionItemIds` | 将缺口、冲突和读取限制关联到总览已有事项，不新增一个意见输入区；没有对应原事项时不得虚构关联 |

哪些值必须具备才能启动，由服务器按锁定的准备/启动规则及 owning 输入约束决定。Runner 不自行提供可信 `mandatoryForStartup`、`canStart`、`approved` 或 Human 身份；报告 COMPLETE 也不代表启动候选全部满足条件。候选中的客户名称与已选 Enterprise 存在冲突时保留该冲突，不能自动合并、重建或改换客户身份。

**前端读取与确认的最小关系**：正式受权查询应返回当前 Project 状态/版本、已接纳报告精确引用与 Hash、候选集合及其依据、公司规则版本、具体启动阻塞原因、按文件去重的完整计划、允许的操作和可恢复请求状态。只显示许可字段，名称、路径、摘要与 UI 排序不参与授权判断。

“确认信息与范围并开始”应绑定同一 Project、当次 CAS 版本、精确报告/输入与候选集合、所选文件的完整计划版本，以及本次意图稳定键。Human 来自认证上下文，由 owning 服务记录独立可信决定；客户端不传自称批准人，不把 Runner 报告中的“批准”映射为该决定。后三类正式启动引用由受控过程准备并提交，浏览器不按别名拼造 SnapshotRef。具体操作名、payload Schema、错误码和公开注册仍在 D14 owning Delta 中闭合，本节不定义私有 BFF 业务 API。

返回应能区分信息确认、项目启动和本轮工作范围接收各步的真实状态及精确回执：启动成功而范围请求失败时保留已启动项目，恢复后续步骤；UNKNOWN 先核实原请求；旧报告/权限/CAS 失效时保留选择并明确原因。已接收等待安排不表示 Runner 开始或文件完成。正式项目启动后的后续轮次沿既有冻结绑定选择文件，不再次替换 PROJECT_START。

首版字段反例须覆盖：从模板填造产品/职责、EVIDENCED 被当 CONFIRMED、产品只有名称但缺必要结构、虚假 Human 决定、报告/候选/计划版本不一致、跨项目 evidence、候选别名悬空、必要值 UNKNOWN、非必要未知影响独立文件的错误扩大、规则版本漂移与多步部分成功。当前均为设计要求；实际新 Schema、接纳器、公开接口、持久化及 Runner 生产验证为 `NOT RUN`。

**字段细化产物链接**：下一版 [Runner v0.2 字段草案](runner-analysis-report-v0.2.md) 和 [启动核对 DTO 草案](workspace-startup-review-v0.1.md) 已另立文件；仍为未注册提案，现有 v0.1 Schema 与样例保持原样。

### D14 / RD-01 owning 闭合入口

后续技术提案见 [首条资料链路 Delta](d14-rd01-first-customer-flow.md) 与 [v0.2 交接](runner-analysis-report-v0.2.md#d14--rd-01-正式交接提案)。本 v0.1 字段/Schema/样例及历史 hashes 保持不变；standalone 输入/输出工具只有独立证据意义，Host→TE→EP、可信 Human 与一次 start 全部仍需后续真实验证。新增 owning 增量是 PROPOSED/FUTURE DESIGN，不再以旧工作树“已同步”作为当前基准事实。
