# 公司启动规则与词表 Spec Delta（#257）

状态：`T2 / DESIGN APPROVED / HUMAN BUSINESS CONFIRMED 2026-10-09 / INDEPENDENT DESIGN REVIEW PASSED 2026-10-09 / HUMAN TECHNICAL APPROVED 2026-10-09 / INTERNAL FOUNDATION REGISTERED AND IMPLEMENTED (#267) / IMPLEMENTATION REVIEW APPROVE / HUMAN IMPLEMENTATION TECHNICAL APPROVED 2026-10-10 / D14 CONSUMER NOT IMPLEMENTED / PRODUCTION NOT RUN`。内部基础实现批准绑定 `b834f072cd3b199693723131096abd8f2a8d4266`，见 [PR #268 正式记录](../reviews/pr-268/Review.md)；该批准不替代实际公司材料发布或后续客户链路验收。

本设计响应 [Issue #257](https://github.com/qzhike/zhiju-business-core/issues/257)，基于 `main@15c085354056ab327e03352c32020010cc11285b` 的 [D14 §4](d14-rd01-first-customer-flow.md#4-必要启动信息与可信决定)。公司业务清单已取得下述明确人类确认；创建 Issue、提交 PR、模板中的“定稿”或静态检查均不构成批准。既有冻结规则与 PROJECT_START 不变；本设计的最终修订已完成独立复审及显式人类技术批准，未注册字段与后续实现仍需其自身接受集、验证和 NOW + READY 核验。

### 业务确认记录

`2026-10-09`，本次请求的用户审阅 §1–2 后明确回复：“确认 §1–2 的范围与全部清单；四类保护 Evidence 满足首版要求”。确认覆盖有界范围、1类质量方针 Fact、全部完整 Product、四类保护依据、12项适用性、2项管理选择和3项专业决定；首版不选择 §5 的结构化 Fact 支持集扩展。

被确认的 §1–2 原始 UTF-8 bytes（从 `## 1. ` 至 `## 3. ` 之前）SHA-256 为 `8cabe2e26d2402660f92e3fec7b59daa595e6d5ae26df7af2560f4b080b5f64b`。此值只标识本次文档业务确认范围，不是 Core canonical bundle Hash、平台发布证明或技术审查 SHA。该确认不批准 §3 的技术字段/发布/兼容设计，不证明具体客户满足启动条件；独立设计审查、人类技术批准及真实客户验收仍各自取证。

### 人类技术批准（4bd1f01）

`2026-10-09`，本次请求的用户在 [PR #262 第二轮复审](https://github.com/qzhike/zhiju-business-core/pull/262#issuecomment-6081763567)明确指出 R1 已闭合、没有新增阻塞设计缺陷且仅待最终修订的人类技术批准后，回复“批准”。该批准绑定 `4bd1f0100a9ea4ddb2db071f153454557ac223cd`，覆盖 §3 的新 Platform registry/SchemaRef/producer/resolver/不可变存储、完整 Hash、授权、发布及兼容/取代设计和对应 owner traces。正式记录见 [Review 技术批准](../reviews/pr-262/Review.md#人类技术批准与最终审查结论2026-10-09)。本次技术批准与上方 §1–2 的业务确认分开；SD257-SUPPORT 继续未选择、未批准，生产注册、平台发布事实和运行/客户验收仍未完成。

## 1. 拟议首版范围与证据

提交确认的范围代码为 `zhiju.startup.cn_active_device_qms_upgrade`：中国大陆市场，有源、非无菌、非植入医疗器械硬件产品（可包含软件组件），既有质量体系文件的增量升级。标准目标限 `GB/T 42061-2022 / ISO 13485:2016`；2025 版《医疗器械生产质量管理规范》作为明确版本的升级目标，公司目标实施日期拟定 `2026-11-01`。项目需有人类确认的该目标及正式要求引用/适用时间，不把升级目标说成当前已生效要求。ISO 9001、境外市场、无源/IVD、独立软件、无菌/植入、新建体系和实际生产活动不在本 bundle 支持范围；需要它们时保留真实需要，使用另行批准的范围与规则，不套用本 bundle。

这是依据模板提交的有界建议，并非已确认的客户适用性：S1 页末明确有源模板定位，但正文含非无菌/非植入示例和 ISO 9001 引用；S7 区分独立软件与软件组件。因此不能从使用该模板推出客户产品属性，也不能照抄所有标准。专业 Human 须核对每个纳入产品的客户依据；公司须明确确认上述取舍。清单不是完整法规合规清单，项目启动不证明许可、认证、实施或文件完成。

### 实际来源清单

来源库为本地 `zhiju-doc-artifacts`，模板均逐件核对到 Git `0bb6976f27051e4abab8c45596e74f6903dad293` 的相同 bytes。以下为该库相对路径与实际 UTF-8 文件 bytes SHA-256，**不是** Core canonical hash、PUBLISHED TemplateRef 或客户 EvidenceRef。只读取相关章节，未盘点全部模板、未复核实际客户项目或全部法规现行性。S6/S7 页内仍标“拟”；现有公司发布与批准证明未取得，必须在正式 bundle 发布前补齐。

本次只定向核对 N0：[国家药监局 2025 年第107号公告的中国政府网发布](https://app.www.gov.cn/govdata/gov/202511/06/539701/article.html)（公告日期 `2025-11-04`，施行日期 `2026-11-01`，查阅日期 `2026-10-09`）。因此公司目标是施行前的升级准备；此事实不证明某客户适用或其他标准/指导原则仍有效。N0 网页链接尚未成为正式 RegulatoryReferenceVersion/EvidenceRef，发布仍需精确归档、校验与相应人类判断。

| ID | 来源相对路径 / 页内版次 | bytes SHA-256 | 本次设计依据 |
|---|---|---|---|
| S1 | `template/质量手册/[公司代号]-QM 质量手册（批次24定稿·B3）.md`；B/3 | `47f7a48ad5ebbd4bb413874e0be5ca3c39dd66af685f592e12c93c99b4bc4a75` | §0.3、0.5–0.6、1.2–1.3、4.1.6、4.2.3、4.3.3、5.3–5.5、7.3、7.5.2/5/6/7/9.2、使用说明 |
| S2 | `template/管理制度/[公司代号]-GL-5.4-01 质量目标考核管理规定（批次17定稿·A3）.md`；A/3 | `d0a18937d701027e2d256b5cd03880886481fb0e615524a441db403940f6a51d` | §4、5.1–5.7：目标指标、口径、周期、责任及审批关系不能被模板数值替换 |
| S3 | `template/管理制度/[公司代号]-GL-6.2-01 岗位职责与任职资格管理规定（2025版GMP修订·20260708修订）.md`；A/2 | `23281fd2ddcb6d9c14baccbfab5e4fab61172d80a971e7174c6f6a9f21f25364` | §3、5、5.8：岗位、职责、独立性和授权须匹配客户，不默认建立示例部门 |
| S4 | `template/控制程序/[公司代号]-PD-7.3 设计和开发控制程序（批次19定稿·V2）.md`；V2 | `c96258c912cab886ef4becd1970a680578c3e6f286e3e676680ec5169b14f100` | §1–2、5.1–5.12：全生命周期设计活动、预期用途、转换与委托设计 |
| S5 | `template/控制程序/[公司代号]-PD-7.5.1 生产和服务提供控制程序（批次19定稿·A3）.md`；A/3 | `31ecfb287068ad4900d42999f305edfd74a2248116740068571f5299f8e629be` | §2–5.2、5.6：工艺、关键/特殊过程、试产与常规生产、放行条件 |
| S6 | `template/控制程序/[公司代号]-PD-4.1.6 应用软件确认控制程序（批次20定稿·B1）.md`；B/1（拟） | `1d006f63cde644df823d4a96928e8444046f6d14449da4167e3ef310ef35f616` | §1–2、5.1–5.2：质量管理软件与产品软件分开，版本、用途和风险不可猜测 |
| S7 | `template/控制程序/[公司代号]-PD-7.3-01 软件生存周期过程控制程序（批次20定稿·A1）.md`；A/1（拟） | `a8ee5f64bc01c0558422c23a3bf1a412589271caffb552d0ddc7255a58b0c1a7` | §1–2、4、5.1：独立软件/组件及开发与非产品软件确认的边界 |
| S8 | `template/控制程序/[公司代号]-PD-7.5.13 委托生产与外协加工控制程序（2025版GMP修订·20260705修订）.md`；B/0 | `822aece31717a35e421f45b01bb99d0ccf2a7e2ffb042f5f70bb48365e836e06` | §2、4：委托生产、外协加工及客户责任路径分别核对 |
| S9 | `template/控制程序/[公司代号]-PD-6.4 工作环境和污染控制程序（2025版GMP修订·20260622修订）.md`；B/1 | `c1f3833bf34f694afc75a55f57fa44bd3068b2f73b229a2cba54c0788a9ce4e0` | §1–3、5.1、5.3：污染控制取决于产品/过程，非无菌不能直接推出不适用 |

已批准的业务依据为 [工作台 §4.7.1](workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)、[§5.1–5.3](workspace-mvp-human-agent.md#51-真实模板输入与修正依据) 和 D14 §4：保留客户方针、目标、人员组织、运营/产品过程、精确来源及可信 Human 决定。来源库 `AGENTS.md` §4–6 提供相同保护/适配规则；本次本地 bytes hash 为 `2e482f9b5c2f5960a6810c85b879c52e8111503aad2736d3987774e8b4d9757e`，与该库 HEAD 不同，仅为只读观察，不作为已批准公司规则或正式发布输入。

## 2. 提交确认的必需清单与词表

下列代码均为**有业务释义的拟发布公司代码**，尚未注册；未知代码、`demo.*`、空必需集合或通用默认值均不能启动。EP 拥有业务含义，IP 拥有不可变政策身份、发布证明与授权。词表把代码、中文释义、证据条件和正式 owner 映射一起版本化；中文别名只帮助展示，Host 不用相似名称或第二次模型调用猜代码。

### 企业事实、Product 和客户保护依据

| 必需项 | 具体字段 / 拟词表 | 客户依据、来源与业务理由 |
|---|---|---|
| 企业事实 | `factType=zhiju.fact.quality_policy`，完整 `ValueEnvelope.TEXT`；风险码 `zhiju.risk.high`，Human-only | S1 §0.3/5.3、D14 §4；客户现行完整原文及真实 Evidence，保留标点/措辞，不取模板占位符或润色摘要 |
| 每个纳入产品 | `productType=zhiju.product.active_device`、`displayName`、完整 `intendedUse`、`productScope.productFamily`、非空 `variants`、非空 `markets`、非空 `sourceRefs` | [Product v0.1](enterprise-project-capabilities.md#4-product-v01-最小结构)、S1 §1.2、S4/S5；名称、用途、产品族和型号是客户非空原值，不是公司生成的词表代码；至少一份完整 ProductVersion，且覆盖本项目所有纳入产品 |
| 产品/市场词表 | `zhiju.product.active_device` = 有源医疗器械硬件产品，可含软件组件；`zhiju.market.cn_mainland` = 本项目明确纳入中国大陆市场 | S1 模板范围、S7 §2；markets 首版只接受该代码；这是公司范围代码，不能据此推出注册类别、无菌性、植入性或软件安全级别。独立软件及其他市场不能强映射到此代码 |
| 质量目标保护依据 | 本项目涉及的 `QUALITY_OBJECTIVE` 全量源条款/表格及指标、数值、单位、口径、周期、范围和责任关联的 Evidence | S1 §0.3/5.4、S2 §4–5；模板示例指标、季度频次不能证明客户采用它们；需要但未取得时阻启动，不写伪造目标 Fact |
| 人员组织保护依据 | `ORGANIZATION` 与 `RESPONSIBILITY` 的源条款、部门/岗位/人员关系、职责及授权依据 | S1 §0.5–0.6/5.5、S3；客户组织图读不到则显式限制，模板任命书/签批栏不是人员身份或批准事实 |
| 运营/产品过程保护依据 | `PROCESS` 与 `PRODUCT_RULE` 的完整客户条款、触发/主体/步骤/判定/例外/记录/承接及工艺、检验、验证、放行规定的 Evidence | S4/S5/S8；保留正文与表格/关系，不能只凭摘要、模板路径或“已运行多年”认定现行；Evidence 覆盖限于明确项目范围 |

以上四类保护依据由现有报告 `protectedFacts` 分类和 Quality capture/verify/get 的真实 Evidence 承载，由下面的专业决定确认保护依据是否足够；它们**不转换为结构化 EnterpriseFact**，Evidence 的 captured content 不因展示摘要而截断。D14 的 TEXT/Product/QMS 支持集不扩大。对实际不存在的某项安排，只有客户可信答复、相应适用性结论和专业 Human 理由支持时才能说明不存在/不适用；不存在不会伪装成有值，缺质量方针、必需 Product 或必要适用性依据仍不能启动。

若公司要求把结构化目标、组织/人员图谱、职责矩阵或流程模型本身纳入 Profile 必需 Fact，本提案不能以保护 Evidence 代替；见 §5 的独立支持集 Delta。客户名称、模板编制/审核/批准空栏、模板维护历史、联系信息和未纳入项目的全部历史业务记录不自动变成启动必填项。

### 必需适用性要求：12 项逐项决定

每行均须有唯一、PUBLISHED、精确的 `requirementRef`，以及客户范围的 `outcome/rationale/NonEmptySet<EvidenceRef>`。`APPLICABLE / NOT_APPLICABLE` 沿用 QMS 闭集；启动必要项不能 `PENDING_DETERMINATION`。下表的 code/源定位是**拟导入定义**，不是正式 requirementRef；重复同 requirement 或遗漏任何一项均不满足全集。

| 拟 requirementCode | 公司要求含义与模板来源 | 必须取得的客户依据 / 决定约束 |
|---|---|---|
| `zhiju.requirement.qms.scope` | 项目产品、过程及标准/升级目标范围；S1 §1.2/4.3.3 | 产品范围、客户体系范围、目标日期和精确标准/法规目标引用；本 bundle 下必须 APPLICABLE |
| `zhiju.requirement.qms.design_development` | 设计开发过程边界；S1 §7.3、S4 §1–2 | 客户设计责任及生命周期活动；不能因没有新设计项目就自动不适用 |
| `zhiju.requirement.qms.product_cleanliness` | 产品清洁；S1 §1.3/7.5.2、S5 §5.2 | 客户产品/清洁过程；S1 的非无菌示例与 S5 清洁包装流程不能替客户裁定，矛盾须核对 |
| `zhiju.requirement.qms.sterile_device` | 无菌器械专用要求；S1 §7.5.5 | 客户交付状态证据；本有界范围须有依据的 NOT_APPLICABLE，APPLICABLE 表示超出范围 |
| `zhiju.requirement.qms.sterilization_validation` | 灭菌/无菌屏障过程确认；S1 §7.5.7 | 客户产品/过程证据；本范围须有依据的 NOT_APPLICABLE，不从文件缺失推出结论 |
| `zhiju.requirement.qms.implant_traceability` | 植入器械专用追溯；S1 §7.5.9.2 | 客户用途/产品证据；本范围须有依据的 NOT_APPLICABLE，未知阻启动 |
| `zhiju.requirement.qms.contamination_control` | 工作环境/污染控制；S1 §1.3、S9 §2/5.3 | 环境与产品/工艺依据；非无菌不自动不适用 |
| `zhiju.requirement.qms.process_validation` | 特殊过程及生产过程确认；S1 §7.5.6、S5 §3.3/5.6 | 客户工艺及可后续检验性；按实际过程裁定，不能由模板特殊过程名称补造 |
| `zhiju.requirement.qms.qms_software` | 非产品质量管理软件确认；S1 §4.1.6、S6 §2/5.2 | 实际软件清单/版本/用途与失效影响；未知必需，不能将示例 QMS/ERP 当客户安装事实 |
| `zhiju.requirement.qms.product_software` | 器械软件组件生命周期；S4 §5、S7 §2/5.1 | 客户产品软件组成/用途依据；独立软件超出首版范围，未提供不是不适用 |
| `zhiju.requirement.qms.external_processes` | 委托研发、生产、外协、检验的责任边界；S1 §4.2.3、S4 §5.12、S8 §2 | 客户合同/工艺/责任依据，四类活动分别解释；没有受权依据则不能声明均不存在 |
| `zhiju.requirement.qms.sample_retention` | 留样要求与承载；S1 §1.3 第6项 | 客户产品和经核验的具体要求；模板中的指导原则编号不证明现行性，正式引用缺失则阻启动 |

requirement 是公司要求客户在启动前作出有依据的范围判断，不把模板变成法规文本。涉及标准/法规结论的行，发布定义必须另绑定经核验的正式 RegulatoryReferenceVersion、authority/jurisdiction/effectivePeriod 和适用定位；未取得时不能发布为可用的规则。模板内一般背景不能为具体停用/不明要求背书。Human 也不能通过“不适用”绕过已证实的适用强制要求。

### 必需管理选择与专业决定

| 分支 / 拟代码 | 首版封闭选项或 outcome | 来源、理由与正式写入条件 |
|---|---|---|
| MANAGEMENT_CHOICE / `zhiju.choice.qms.document_base` | `zhiju.option.customer_controlled_base` | 已批准工作台 §5.3、S1–S5；沿用经确认的客户底稿与身份，缺件派生另按文件授权；真实 Human BusinessDecisionRef，不把 Runner 建议当决定 |
| MANAGEMENT_CHOICE / `zhiju.choice.qms.protection_strategy` | `zhiju.option.preserve_customer_arrangements` | 已批准保护规则；方针、目标、人员职责及既有过程保持；本选择不批准任何保护例外或修改，改变策略需另行明确设计/业务决定 |
| PROFESSIONAL_DECISION / `zhiju.decision.qms.supported_scope` | `zhiju.outcome.within_supported_scope` / `zhiju.outcome.outside_supported_scope` / `zhiju.outcome.undetermined` | S1/S4/S7；具权限 Human 核对每个产品、市场、标准目标和12项适用性；只有 within 可启动 |
| PROFESSIONAL_DECISION / `zhiju.decision.qms.protection_evidence` | `zhiju.outcome.sufficient` / `zhiju.outcome.insufficient` / `zhiju.outcome.conflicting` | 已批准保护范围、S2/S3/S5；四类保护依据覆盖本项目所需原文和关系，只有 sufficient 可启动；不自报“完整理解” |
| PROFESSIONAL_DECISION / `zhiju.decision.qms.startup_conflicts` | `zhiju.outcome.no_startup_conflict` / `zhiju.outcome.file_only_conflicts` / `zhiju.outcome.startup_conflict` | D14 §4–5；必需值/要求矛盾阻启动；仅精确文件修改的保护冲突不改客户事实，file_only 保留计划内受影响整文件 blocker |

两项管理选择均必需、分别有非空 rationale 和真实 Human decisionRef；三个专业决定均必需、有非空 rationale 和经验证的客户 EvidenceRefs。专业 outcome 是人类判断的记录，不是通用默认；startup_conflicts 只有前两个允许继续检查启动。上述决定不替代适用性授权、Fact 确认、QMS/Product 激活、start 或保护例外所需的各次许可。

## 3. 不可变公司 bundle、发布与精确引用

拟 bundleCode 为 `zhiju.startup.cn_active_device_qms_upgrade`，首版 bundleVersion 为 `1.0.0`。技术形状和 owner 校验只在 [EP Spec 公司规则专节](../module-specs/Module-Spec-002-EnterpriseProject.md#257-公司启动规则与词表字段提案) 与 [IP Spec 公司发布专节](../module-specs/Module-Spec-001-IdentityPolicy.md#257-公司规则发布与精确读取提案) 定义；当前不存在可用发布实例，不提供虚构运行时 bundle/snapshot/publication UUID/Hash。IP 的拟构建期 schema 身份与运行事实分开，尚未注册。

- `ruleBundleRef / startupRulesRef / vocabularyRef` 只复用 IP Platform `SNAPSHOT / identity.policy_snapshot` 的原生 wire identity；三个 EP-owned profile 为 `ep.company_startup_bundle@1.0`、`ep.company_startup_rules@1.0`、`ep.company_startup_vocabulary@1.0`，均未注册。保存/精确读取拟由独立 CompanyRuleSnapshotProducer 与 CompanyRuleSnapshotResolver 和 `im-ui-company-startup-v1` registry 完成，canonical SchemaRef、selector、完整 payload 与授权绑定唯一维护于 [IP 独立路径](../module-specs/Module-Spec-001-IdentityPolicy.md#独立-platform-profile-registryproducer-与-exact-resolver)。旧 record_policy_snapshot/get_policy_snapshot@1.0 保持 `im02-static-v1` 接受集；scoped PolicyVersion/resolve_policy 不接受 Platform，不改写历史 spelling、Refs 或 Hash。
- 外层 bundle payload 绑定上述业务身份/版本、两个 child refs、明确范围、非空精确 template/requirement 绑定、兼容约束及可选 supersedesBundleRef；每个 child 有独立不可变 Hash。正式模板需由 EP Platform Reference Publisher import/publish，分别绑定 S1–S9 的确切 bytes 和版本。sourceId/本地路径/文件名/源 SHA 不替代正式引用。
- 每个公司 requirement 拟使用 EP owning Platform `CONTENT_ADDRESSED / zhiju.project.company_startup_requirement`；payload 为 requirementCode、definitionVersion、完整要求/适用条件、templateRefs + source locators/bytes hashes、必要 normativeReferenceRefs。不同章节不能仅复用同一整文件 TemplateRef 当不同 requirementRef。来源定位映射必须唯一；S6/S7 的拟版须先补足发布决定。
- `contentHash=SHA-256(cv1(完整 owning snapshot/requirement payload))`，沿用既有 canonicalization；公司业务 identity/version 位于 policyDocument，新 snapshot 的 registryVersion/profileKey/唯一 canonical SchemaRef、派生 policySetVersion、effectiveFrom 及全部 policyDocument 一起参加 hash；view 返回 `{policySnapshotRef,payload}`。完整 refs 与作用于业务的限制参加 hash。集合按声明的稳定 code/ID 排序；文字、证据条件、源定位、版本或某一 child ref 变化均产生新版本。原文件的 bytes SHA 单独校验，不和 canonical hash 混用；不得把 computedHash 从另一个域填入 Ref。
- 公司指定具权限 Human 为业务清单批准人与 Publisher；IP 保存独立、不可变 `CONTENT_ADDRESSED / zhiju.identity.company_rule_publication` 发布事实，绑定新 producer 实际形成并经新 resolver 精确读回的 outer/child refs、批准的具体清单/范围 Hash、ActorSnapshot/AuthorizationDecision、EP 语义校验结果及 effectiveFrom。批准/发布证明不参与它所引用的 bundle hash，避免互相 hash 的循环；新 snapshot 保存成功本身不等于 PUBLISHED。模板/requirement 由 EP 发布，IP 不解释或重写其业务内容。
- 模板、requirement、publication 新类型及 profiles 都是待批准 additive 接受集；[Catalog 提案入口](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#257-公司启动规则引用提案) 不改变当前注册数。这里只定义 owning internal 发布/解析 Port，不新增可调用 HTTP、BFF 私有业务 API、Schema、迁移或管理页面。

EP 确认发布语义时检查精确源绑定、全部必需条目、支持映射及标准/法规引用；IP 确认身份/授权/Hash/profile 与不可变发布事实。SERVICE 只能执行该精确 Human 发布意图；AGENT/RUNTIME 不能出版。两 Owner 不共享 Repository，任一证据不可取得则 fail closed。Query 返回可验证历史 payload 与独立当前 useStatus，不把历史可读取解释为当前可启动。

### 兼容与取代

公司可并行发布不同支持范围，不能仅按日期、版本大小或“最新版”选择。准备项目必须锁定部署允许的精确 bundle/publication/模板集合。同 bundleCode + bundleVersion 只对应一个 payload；同身份异 Hash 拒绝。真实取代边只允许同一 bundleCode，后继至多一个、无环；改变支持范围、必需项、代码含义或映射须重新人类批准，并明确兼容/影响，不自动扩大 @1 支持集。

新发布不自动使旧版失效；只有显式发布事实中的 supersedesBundleRef 和生效时间、或独立撤回/影响决定，才改变准备项目的当前使用资格。未来生效前旧版仍可用；失效之后引用旧规则/模板的 source/report/request 追加 STALE，推进 preparationVersion，须重新捕获/分析和显式新确认，不在原意图里换 refs。仅换 bundle 但模板集合不变也必须重看规则；仅换模板而沿用旧 ruleRef 同样拒绝。

ACTIVE 的旧 PROJECT_START、Fact/Product/QMS/Profile/ScopeSnapshot、Context 和 Receipt 永远保留原精确引用。旧 FULL_START 不升级为准备路径；已 ACTIVE 的新增规则/来源影响通过 owning impact review 处理，不能重 start、把旧绑定指向后继、自动激活企业 current 或重算历史 hash。有界 INITIAL_SCOPE_RECOVERY 仍遵守 D14：必要启动依据失效时暂停范围接收，独立文件也不能借新 bundle 绕过 impact review。

## 4. 状态、启动与整份文件资格

| 观察 | 必须保留的含义 / 必需项的结果 |
|---|---|
| NOT_PROVIDED | 未提交；不能断言客户没有；显示索取/补料，阻启动 |
| MISSING_CONFIRMED | 可信客户答复及 Human 决定明确不存在；不是读取失败，不自动不适用；缺必需有值信息仍阻启动 |
| UNREADABLE / READ_LIMITED | 有源但技术读取不足，保留受限定位及 read ceiling；优先补读，未解决的必需依据阻启动 |
| UNSUPPORTED / UNSUPPORTED_CANDIDATE | 格式/语义不在接受集；保留实际输入和所需支持，不扁平化、不删必需项；阻启动 |
| UNKNOWN | 已读/部分已知但信息或结论未定；保留 known parts/missingFields；必需项阻启动 |
| CONFLICT | 至少两组不同值/依据或要求与客户安排不相容；保留 alternatives/conflictingFields；必需冲突阻启动 |
| EVIDENCED / CONFIRMED | 前者只是有依据候选，后者须真实 Human 与 owning 版本；只有后者及所有当前前置成立才可 start |

这些是不同层的原状态，Query 用 reason/detail 引用对应 owner 的状态，不往既有 FactStatus/MaterialStatus 枚举静默添加值。冲突裁决需要新依据和合法 Human 专项判断；普通启动勾选、模板强度或“全部批准”不能解锁保护、强制 Gate 或要求。未提供、明确没有与不适用各自有来源和决定。

公司 startup eligibility 必须同时满足：当前发布/引用/profile 可用；§1 范围已确认；§2 非空完整 Fact/Product/保护依据及12/2/3组要求；真实 Human 决定、Quality 证据当前有效；全部启动必要信息受支持、无未解决冲突；D14 的 Scope/两个 CAS 版本、report/source/input hashes 当前。Runner 的 COMPLETE、合法 JSON、模板存在和某个文件可做都不能代替这些条件。

文件 eligibility 与公司启动条件分别返回；范围接收必须已有 lawful start：精确 PROJECT_START + 当前 report/plan + 整文件 full change set + 依赖/保护许可。某文件的职责或流程变更缺专项授权，整文件等待；初次确认若选择了阻塞文件，D14 preflight 拒绝原选择且不启动，Human 可显式新选独立合法文件完成 start 后接收。独立文件只有自己的条件全部成立才可接收/进入后续已批准执行合同。保留已批准三组摘要、按需展开依据、默认不选的整文件、一个显式确认；不增加规则编辑区或 Runtime selector。Confirmation candidate IDs 包含全部待确认必要条目和真实 Human 决定，浏览器/Runner 不能删除必需项。

## 5. 独立的支持集变更提案（SD257-SUPPORT，首版未选择、未批准）

公司已明确确认四类保护 Evidence 满足首版要求，本节扩展未选择。若后续客户或公司另行要求机器可解释的目标/组织/流程 Facts，本节提出单独的 **T2 / PROPOSED / NOT SELECTED FOR FIRST VERSION / APPROVAL REQUIRED** 支持集变更，不能随本首版清单自动采用：

| 拟必需 factType / 结构 | 最低需要保留的语义 | 当前 D14 结果 |
|---|---|---|
| `zhiju.fact.quality_objectives` | 目标 ID、指标/数值/单位、统计口径/周期、适用范围、责任关系及精确来源 | 结构化/表格 Fact 未支持，启动 blocker |
| `zhiju.fact.organization_responsibilities` | 部门/岗位/人员稳定身份、隶属、职责、权限及来源，不用模板空签字推身份 | 图谱/职责矩阵未支持，启动 blocker |
| `zhiju.fact.operational_processes` | 触发、主体、顺序、判定、记录、异常、关闭、跨文件承接和来源 | 结构化流程未支持，启动 blocker |
| `zhiju.fact.product_processes` | 精确产品版本、工序/指标/检验/验证/放行与关联来源 | 结构化产品过程未支持，启动 blocker |

这需要 EP Fact/Profile 接受集、报告候选结构和 owning Spec/Test、相关 Core/Catalog/Schema 与持久化设计另行闭合并获得精确修订的人类批准；不能仅新增一个 TEXT code 或把 JSON/表格塞进 string。若实际规则另行要求这些 Fact，未批准/实现前保持必需 blocker。现有业务确认只确定首版保护 Evidence 路径，未读取真实代表性项目、未证明实际启动成功；若后续需求超出该路径，应保留真正的强制要求，另行选择并批准本支持 Delta。

## 6. 正负设计 trace 与冻结条件

正链（设计场景，`NOT RUN`）：公司逐项批准 §1–2 → EP 发布精确模板/12项公司 requirement 及经核验 normative refs → 新 registry/三个 canonical SchemaRef 与 EP validator 均已批准注册 → IP 新 producer 保存 rules/vocabulary，再绑定真实 child refs 保存 bundle → 新 resolver 逐项以完整 selector/id/hash 精确读回，真实 Human 决定发布 → 同 Project 准备源/报告映射出完整方针、全部 Product、四类保护 Evidence、12项适用性、2项管理选择及3项专业决定 → Quality 验证、Human 分别确认/激活 → Profile/ProductScope → EP 单事务唯一 PROJECT_START + ACTIVE → TE 接收 Human 所选独立 eligible 整文件。符号表示尚待实际取得的事实，不使用合成运行时 UUID、demo code 或假发布 hash 证明通过。

| 反例 trace | 必须可观察的结果 / owning 场景 |
|---|---|
| 正链所有项完整且引用/授权当前 | 唯一 lawful start，真实分步 refs；只有完整合格所选文件接收；`EP-257-001` |
| 三个新 profile 保存/精确读回/发布；旧 @1.0 接受新 profile 或旧 refs 转送新 reader | 新内部路径在批准注册及真实授权后成立；旧 writer 仍拒新 schema、旧 reader 不回退新存储，新 resolver 不接受历史 profile；旧 refs/hashes 不变；`IP-257-006`、`IP-257-007`、`EP-257-010` |
| 缺完整方针、一个产品字段或12/2/3任一项；NOT_PROVIDED/已确认不存在/未读/UNKNOWN | 分别展示缺口和原因，保留合法报告，PREPARING/零 start；`EP-257-002` |
| 公司必需结构化目标/组织/流程，现有 TEXT 不支持 | 可读报告与显式 UNSUPPORTED_CANDIDATE；零伪造 Fact，零 start；`EP-257-003` |
| 两份客户方针/用途矛盾，或强制要求与客户安排冲突 | 保留两组依据；新证据/合法 Human 判断前不确认；`EP-257-004` |
| 未知/错版市场码、别项目 Evidence、未发布 requirement、相同ID错 hash、错误 locator/profile | 拒绝映射/接纳或当前资格，安全 reason 不回显客户正文；`EP-257-005`、`IP-257-003` |
| 模板“非无菌/没有软件/示例岗位”充当客户值、公司模板别名直接充当 EvidenceRef | 不形成事实或适用性；`EP-257-006` |
| 新 bundle 真实取代旧规则、模板变更、旧 request 原键换引用；未来生效版本 | 当前性分别判定，失效追加 STALE，原 intent 不改；`EP-257-007`、`IP-257-004` |
| startup 合法，仅某文件新增质量目标数值/职责/批准步骤而无专项许可 | 该整文件 blocked，独立文件可经新明确选择接收；不能切掉 change 子集；`EP-257-008` |
| 取代发生在 start 后/初轮scope前，必要启动依据失效 | ACTIVE 与旧 start 保留，范围等待 impact；`EP-257-009` |
| Agent 发布、Human 已撤权、记录 snapshot 未发布、同业务版本异 payload | 拒绝新写/资格；历史 refs 不改，不因旧 ALLOW 放行；`IP-257-001`、`IP-257-002`、`IP-257-005` |

冻结的两项不同证明已分别记录：**公司业务确认**逐项覆盖 §1 范围、§2 的1类 Fact/完整 Product/四类保护依据/12项适用性/2项选择/3项专业决定，并明确首版不选择 SD257-SUPPORT；**独立设计审查及人类技术批准**已绑定 `4bd1f0100a9ea4ddb2db071f153454557ac223cd`，覆盖 §3 身份/Hash/发布/兼容和 owner traces。仅同意撰写或提交 PR 不是这些证明；设计批准不替代生产注册、实际发布或客户验收。

本 Issue 只修改 `.vibe/` Markdown，要求 `vibe verify docs --json` 及源 Hash、owner/reference/field/transition 定向对账；执行证据进入 PR，不新建验证日志。真实 OIDC/HTTP、PostgreSQL、Host/Runner、浏览器/平台和独立人工业务验收均 `NOT RUN`。设计获批后仍须按后续实现 Issue 注册 profiles/引用/Schema/fixtures、闭合持久化/发布/解析接线并取得对应 configured gate；本提案不部署、不运行启动或文件升级。
