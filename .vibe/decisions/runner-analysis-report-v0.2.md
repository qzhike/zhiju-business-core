# Runner 分析报告 v0.2 字段草案

状态：`T2 / PROPOSED FIELD CONTRACT / NOT REGISTERED / NOT IMPLEMENTED`。2026-10-08 的初始化方向和核对布局已经批准；本次仅细化 D14 数据草案，不冻结公共字段或批准生产接入。

## 版本与文件

- [JSON Schema](runner-analysis-report-v0.2.schema.json) 是下一版输出子协议草案，保留 v0.1 分析、读取限制、证据、保护事实、缺口和逐文件计划结构，增加 `startupCandidates`。
- [匿名报告](runner-analysis-report-v0.2.example.json) 与 [Markdown 对照](runner-analysis-report-v0.2.example.md) 使用同一个结构化样例。Markdown 内嵌完整业务体用于合同核对，不是最终用户报告排版。
- [来源集合](runner-analysis-report-v0.2.manifest.example.json) 和客户/模板 Markdown 仅为虚构字段样例，不是 Runner 正式 input-manifest。示例 SHA 计算规则为 UTF-8 内容字节；集合 Hash 为本设计工具的稳定 JSON 字节，不能映射为 Core Snapshot Hash。
- [候选边界样例](runner-analysis-report-v0.2.candidate-cases.json) 包含产品字段部分缺失、客户说明相互冲突和专业判断建议。它是候选级测试数据，不是可提交的完整报告。

现有 v0.1 Schema、报告和已接纳对象保持原样。当前独立 Runner 的 `analysis.py` 校验/渲染仍围绕 v0.1；不能直接替换 Schema 就宣称支持 v0.2。后续需要版本化 outputProfile、固定 Renderer、候选校验及真实报告回归。

## 候选含义

| 字段 | 含义与约束 |
|---|---|
| candidateId / kind | 报告内唯一别名；五个封闭分支：企业事实、产品、适用性、管理安排、专业判断。不是 Core TypedReference |
| valueState | EVIDENCED 表示 Runner 声明有依据，仍须顾问确认；UNKNOWN 保留已知部分并逐字段列缺口；CONFLICT 保留至少两组不同来源的候选值，不自动挑选 |
| value / alternatives | 各 kind 使用对应结构；部分产品值可保留名称和用途而缺市场。缺失字段不得编造。冲突分支的 value 为 null，备选值分别绑定依据 |
| evidenceIds | 必须解析到本轮授权来源与读取证据；客户事实不能仅由公司模板证明；适用性要求可来自固定模板，但客户是否适用需要客户依据 |
| missingFields / conflictingFields | 封闭字段路径；必须与值的实际缺失或差异一致；rationale 的出处说明差异不算业务值冲突；相互矛盾的依据不能标 EVIDENCED |
| reason / relatedAttentionItemIds | 保留候选理由，缺失/冲突关联现有总览事项，沿用同一补充意见入口 |

企业事实首版候选仅开放 TEXT 值，适合完整质量方针等文本。结构化组织、表格目标及其他 Fact 值类型仍需 owning 扩展，不能把复杂数据扁平化后声称覆盖全部 EnterpriseFact。`riskLevel`、产品/市场等代码是候选受控代码，样例的 `demo.*` 未注册；Host 只能按版本化词表确定性映射，不能再调用 Agent 猜测。

适用性分支的 `requirementSourceId + requirementLocator` 是源文件别名定位，Host 映射正式 requirementRef。UNKNOWN 用缺失 outcome 表示待定。管理安排和专业判断是提议，Runner 不能提供 Human decisionRef。候选中没有 `canStart`、`mandatoryForStartup`、`approved`、执行器配置或顾问身份。

## Host 接纳要求

1. 保留原始报告，核对输出版本、精确输入集合 Hash、内容文件路径/Hash、来源角色、逐类读取证据和 narrative 同源性。读取覆盖继续针对 CUSTOMER_MATERIAL 与 TEMPLATE；公司 policyBundle 的锁定版本另由可信上下文绑定，不强塞进旧读取集合。
2. 校验候选唯一性、所有证据/事项/要求别名、局部字段结构、完整产品结构、来源范围和码表。缺失和冲突不会因 JSON Schema 通过而解除。
3. 企业事实、产品、现行管理和专业建议的有值部分必须有客户或受权可信决定依据。模板可说明要求，不能单独证明客户适用、不适用或现行安排。未知事项可只引用提出问题的模板。
4. 按服务器锁定规则判定项目级必需信息与逐文件阻塞；非必要 UNKNOWN 不阻断不受影响的独立文件。报告 COMPLETE 不代表启动已满足。
5. 通过可信 Human 确认与 owning 服务形成 Fact/Product/QMS 版本，再形成 Profile/ProductScope 和正式启动引用；别名不能由浏览器拼成 SnapshotRef。

现行 Core 的 QMS Revision 要求适用性、管理安排、专业判断三组非空。匿名完整启动样例包含三组建议，确认后仍要形成真实决定与激活版本。软件 UNKNOWN 在本虚构规则样例中为非必要候选，未塞入已激活配置；真实项目是否属于必需项要按 owning QMS/启动规则核对，不能照搬样例的放行条件。

## 验证边界与后续

[设计检查脚本](verify-startup-contract-drafts.py) 只验证草案形状和匿名样例的确定性关系，不是生产 Host 接纳器，也不证明 READ、监管适用性或业务语义正确。它不替代现有 Runner 的逐类读取、DOCX/提取件核验、词表注册和 finalize-analysis。

下一步技术闭合由 EP/TE/IG/UI owning 规格共同完成：准备状态来源与 PreparationContext、正式输出 profile、别名映射和可信 Human 决定、CAS/回执/查询及持久化。实际 Runner、Core API、数据库和业务验收均为 `NOT RUN`。

## D14 / RD-01 正式交接提案

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。本节收口前述草案缺口，方案选择见 [D14 Delta §3–4](d14-rd01-first-customer-flow.md#3-原始报告与已接纳业务快照)，EP 操作及正式快照字段归 [Spec 002 D14](../module-specs/Module-Spec-002-EnterpriseProject.md#d14--rd-01-准备报告与启动字段提案)。现有 v0.1/v0.2 JSON Schema、匿名 fixtures、Python/TS 设计检查不在本 Markdown Issue 修改；它们是较早草案，不能直接注册为本提案的生产接受集。

| 字段 / 新 outputProfile 规则 | 精确解释与失败条件 |
|---|---|
| schemaVersion / stage | 固定 v0.2 / ANALYSIS；outputProfile=`d14.analysis@1` 由 Host 锁定并在 Package 中保存，Runner 不自选 |
| context.analysisRequestKey / inputManifestSha256 / previousReportSha256 | 真实服务器 key、实际物化 manifest bytes hash、前一 accepted report 原 JSON bytes hash；首轮 previous=null，不能把 stable JSON/hash 域当 Core snapshot hash |
| narrative / extraction | 实际 output-root 内文件+bytes hash；MD 由锁定 renderer 从同 JSON 确定性生成，允许报告写、不改 originals/templates；未知路径/未产生文件/Hash 不符拒绝 |
| sourceId / evidenceId | 本授权 manifest 别名；Host 映射 exactSourceRef、role/hash/locator/表示；原件与提取件分别保留 hash，技术 READ ceiling 与限制，不能生成不存在 EvidenceRef |
| startupCandidates | 五个封闭分支，字段沿上文；每个有值客户事实来自客户/可信答复，模板仅支持要求来源；UNKNOWN/CONFLICT 合法但阻止必要事实启动 |
| ENTERPRISE_FACT.value | TEXT 首版。结构化组织/指标/表格必须显式 unsupported，不编码进 string 假装可解析 Fact；启动 mandatory set 需要它时明确 blocker |
| PRODUCT.value | productType/displayName/intendedUse/productScope(productFamily,variants,markets) 全结构；code 经锁定词表映射，demo.* 不注册；部分值不得成为 ProductVersion |
| QMS 三分支 | 封闭 requirement/choice/decision 受控 ID，全必需条目；管理选择 decisionRef 仅由 EP 可信 Human 写事实；固定规则、模板示例不能证明客户适用性 |
| missingFields/conflictingFields | 版本化封闭字段路径；与实际值/不同 alternatives 一致；无证据待询问不变成有依据的客户值 |
| plannedFiles / changes | fileId 去重、整份 full change set、真实 dependencies、保护事项双向关联；path 是计划，非 Artifact/下载路径 |
| checks / analysisCompleteness | RUNNER_DECLARED 与 COMPLETE/PARTIAL 只说明分析声明，非 readiness、Human confirmation、Gate/Completion |
| resolutionProposals | 对旧开放事项逐项保留/建议替换/建议解决，exact 前版 ID 与新依据；Host 不凭 omission 或上传成功关闭旧项 |

EP acceptedReport payload 绑定 outputProfile/schema、TE Result+Acceptance、IG raw observation、PreparationSource、actual manifest JSON/MD hashes、前版 refs、完整 report body/alias map 与水位；candidateSet/plan 是派生不可变 snapshots，引用 reportRef 并有独立 canonical hash。业务当前性/STALE 另存，不写回 raw JSON；byte hash 与 `SHA-256(cv1(payload))` 双验证，不能相互替代。v0.1 历史可读但不能进入新 startup 确认；旧工具 finalize-analysis 不具 v0.2/授权/lease/EP acceptance 能力，后续需真实 profile 回归。
