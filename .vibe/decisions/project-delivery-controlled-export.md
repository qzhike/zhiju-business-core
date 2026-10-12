# 项目交付批次与受控下载 Spec Delta（D12 / Q11）

日期：2026-10-10
状态：`T2 / DESIGN APPROVED / INDEPENDENT REVIEW PASSED / HUMAN DESIGN APPROVED / §14.2 封闭类型与 §14.4 Hash 域已由 #272 注册并实现 / 8 个公开操作 NOT REGISTERED / 运行链路 NOT IMPLEMENTED`
工作项：[Issue #260](https://github.com/qzhike/zhiju-business-core/issues/260)。

本增量承接已批准的[项目汇总、分批交付和外部发送边界](workspace-mvp-human-agent.md#410-正式交付包与人工发送)。发现基线为 Issue 指定的 main@15c085354056ab327e03352c32020010cc11285b；设计工作基线 main@9611faff0af25a7d256e6cba7538e3fb71dabfe1 保留相同单 Revision 发布与 Human-only 不变量。独立设计复审及明确的人类技术设计批准均绑定 e87e9610a2524ff7317f59d0f76f68a27388dc84，见[正式审查记录](../reviews/pr-271/Review.md)及[批准证据](https://github.com/qzhike/zhiju-business-core/pull/271#issuecomment-6094594569)；[PR #271](https://github.com/qzhike/zhiju-business-core/pull/271) 已合并。本文作为已批准的后续实现设计基线：类型/身份拼写面已由 [#272](https://github.com/qzhike/zhiju-business-core/issues/272) 按 §14.2/§14.4 注册并实现封闭 Schema、结构校验与 Hash 域，8 个公开操作仍未注册、运行链路仍未实现；设计批准不自动使整条依赖实现 READY。[Issue #272](https://github.com/qzhike/zhiju-business-core/issues/272) 仅承接当前独立可执行的封闭类型、引用校验与 Hash 基础，完整 owning Handler/Policy/Renderer/存储/公开流接入仍须按 §6 复核实施范围与门禁。

## 1. 交付目标与首版限制

顾问从同一 Project 的不同执行轮次选择当前符合条件的内部获批文件，按体系章节核对一次本批精确版本，取得固定 Markdown ZIP；实际发送继续在已有渠道管理。批准、批次确认、包可用和下载各有独立事实，不推导发送、客户收件、验收、DeliveryItem/Project Completion 或 EffectiveBinding。

首版采用一个 Project、一个当前经批准激活的 DeliveryPlan 精确版本、一个接收范围与受控导出目标配置、每个 Artifact 一个精确 Revision/Markdown Representation；共享文件只装包一次，可以关联多个同计划 DeliveryItem。所有强制交付配套及其传递依赖必须在本批闭合；已下载或另一批已生成不能证明配套已对外交付。计划尚无合法文件关联、章节映射、配套分类或适用发布 Policy 时显示不可用原因，不能从原型或 Runner 名称推测。无通用依赖引擎，无跨项目批次，无 DOCX/XLSX 转换，无自动替换，无人工已发送标记。

## 2. 所有权与旧 ReleasePackage 的合法映射

| Owner | 本提案责任 | 保留边界 |
|---|---|---|
| ReleasePublication | 拟 ProjectDeliveryBatch、不可变清单、导出生成请求、受控下载请求/响应观察；逐文件 Release 关联及当前可用性裁决 | 旧 Release/Package/PublicationAttempt/FormalReceipt/Completion 完整保留；批次不冒充旧 Package |
| QualityGovernance | exact RAS/ABS、mandatory Gate/独立角色、当前 eligibility、逐文件冻结 Package 的 RRS；版本化配套要求 | 内部批准不授予 Release/下载授权；历史 Snapshot 不改写 |
| Artifact | 受权Project成果发现及获批版本/登记表示来源、immutable Revision、来源、已验证的 Markdown Representation 及受权精确 bytes 读取 | 不裁决Plan/质量/发布资格，不把 ZIP 登记成某个文件的 Representation，不写审批或发布事实 |
| EnterpriseProject | 当前计划及逐文件项目/交付项关联、章节与依赖来源证明 | 只提供关联事实，不因批次或下载评价 Completion |
| IdentityPolicy | 每次读取/确认/授权/下载的当前 Scope、purpose、Actor/Decision；撤权 | 项目负责人/顾问称谓不替代 capability 与职责分离 |
| IntegrationGateway | 精确 RenderAttempt/Binding；存储与导出技术 Adapter 的 Attempt/UNKNOWN | 不拥有批次业务决定，技术响应不晋升 Formal Receipt |
| UI01 / BFF | 已批准布局、精确选择、单份批准接续、原意图恢复及真实中文状态 | 无业务 Aggregate/数据库/私有业务 API |

选择 **新集合引用多个旧单 Revision ReleasePackage**。每个文件先独立完成 CONTROLLED_EXPORT Release 的 DRAFT → PREPARED → exact/current RRS → Human AUTHORIZED。批次仅消费已提交的冻结 Package 与授权，不在一个事务里批准/授权多模块，也不把批准按钮变成 Release 授权。单个 Release 的 packageHash 继续按 [REL §11.2](../module-specs/Module-Spec-006-ReleasePublication.md#112-canonical-package-hash) 计算。

拟首版受控导出 Destination/DeliveryPolicy 明确绑定本 Project、指定 HUMAN 下载人和拟对外交付接收范围，允许在适用质量/传播限制满足后向该下载人导出；目的仍为 CONTROLLED_EXPORT。目标使用 opaque ExternalRef，不包含 URL。需要未满足的客户授权/正式回执才能导出的 Policy 不适用本首版，必须阻断，不能设 required=false 绕过。下载响应只记新受控导出观察；即使旧 Package 有 requiredReceiptKind，也不以它调用 record_publication_receipt/complete_release。旧 Release 保留 AUTHORIZED 及未履行的正式回执义务；本首版不宣称 RELEASED。若后续需要正式发布，另走既有完整发布链，不能回填离线发送。

未选择修改旧 Package 为多 canonicalRevisionRef：那会破坏 Hash/批准/Readiness/回执关联及历史兼容。未选择 BFF ZIP Aggregate 或浏览器即时拼包：它们不能拥有授权、固定清单与失败恢复。

## 3. Owning 字段、Hash 与能力入口

完整拟字段、Hash 域、操作名/授权目的及转换只在 [REL §14](../module-specs/Module-Spec-006-ReleasePublication.md#14-d12--q11-项目交付批次与受控导出提案260) 定义；Quality、Artifact、EP、IG、UI 的对应 D12 专节约束各自输入与消费。#272 已注册 §14.2 的封闭类型与批次/归档 `objectType`（见 [REL §14.8](../module-specs/Module-Spec-006-ReleasePublication.md#148-272-已注册的封闭类型结构校验与-hash-域) 与 [Catalog D12 段](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#d12--q11-批次类型与操作候选路由260)），但这只发布类型/身份面：8 个公开操作、请求/生成/下载转换、Registry operation 计数、数据库与 HTTP route 均未新增。

批次清单包含同计划的逐文件关联/章节、完整 exact Revision/Representation/Quality/Release refs、版本化配套规则和来源。不同轮次只保存来源，不能要求按轮分别打包。清单、清单 Markdown bytes、每份 Markdown checksum、ZIP checksum 和旧 packageHash 分域，无自引用；再次下载读取同一已验证归档，不能按实时候选重新渲染。

候选入口从零已知Artifact refs开始：[EP关联Port](../module-specs/Module-Spec-002-EnterpriseProject.md#d12--q11-项目交付关联只读提案260)以ENUMERATE/Page提供真实Plan Item/章节/依赖；[ART发现Port](../module-specs/Module-Spec-004-Artifact.md#项目候选的只读发现来源)以Project/Page提供ArtifactView与已登记Markdown View；REL重读实际关联/获批Revision/QG证明及自己拥有的Release关联。内部获批但无Release的文件仍显示等待原因，不能只查询已有Release。共享文件按Artifact identity合并，当前无权项安全裁剪；内部与外层游标各由Owner绑定Scope/筛选/真实水位，空中间页不代表扫描结束。EP的pageAssociationHash只证明一页；逐文件及完整所需配套集合Hash由VERIFY精确验证生成，空VERIFY不等于枚举全部。核对/确认不把分页结果当完整闭包证明。

当前代码仅有 OOXML Renderer 与 Artifact 的 PDF/DOCX/XLSX 格式映射。Markdown 通过拟 additive document.markdown + text/markdown 配置沿原 RenderAttempt → authoritative Binding → Representation 登记链进入；首版只有被登记 Renderer 版本无损支持的 Canonical Document。未支持的结构或已有 Workbook/opaque 内容阻断；本设计不选择生成 Runtime，也不以另一设计 Issue 或真实 Runner 为前置。

## 4. 确认、生成与恢复

1. Project 查询给出章节组织的当前可读文件、exact 候选和不就绪原因；选择初始为空。查看历史 RAS/ABS 不足以勾选，所有适用 required approval roles/count/separation 与 Release 条件均须成立。
2. 核对选择读取逐文件与传递配套证明，产生只读 selectionHash/观测水位；Query 不写 Snapshot。确认展示精确版本，原 request target/key/payloadHash 保持固定。服务端重读同一集合且 selectionHash 一致才提交 CONFIRMED 清单，所有项一次成功或无新批次。
3. 单独生成请求提交后，Worker 才写 staging ZIP，逐字节复验源表示、清单、全部 entry/CRC/大小及归档 checksum。数据库 Link Commit 与外部 finalize 分开；最终读回验证成功并重新确认当前资格后才 AVAILABLE。
4. 失败/UNKNOWN 保留 CONFIRMED 清单及原请求；按原 target/key 回读或恢复同 Attempt。可验证已有对象就继续 finalize；未知不盲目重建/重发。确认版本不能续用时显示阻断，显式新选择/新批次；历史包和独立在处理文件保留。
5. 每次下载先生成新受权请求，再取得仅绑定原 batch/archive/主体的短期流许可；许可期限不超过当次 Session/Decision。流建立前再次检查撤权/当前资格；已知撤权停止后续服务，已传输数据无法回滚。过期可在仍有权时新建下载请求，不能改包。
6. Browser 点击只说明已请求下载；服务器可分别证明流已开始、响应已发送、失败或 UNKNOWN。完整响应也不能证明浏览器本地保存、外部发送或收件。没有返回或没有可靠观察时不得显示响应成功。

## 5. 设计 trace 与必要反例

下列 P/E/F/M、R1/R2、Plan-A、RAS/ABS/RRS/REL/PKG/AUTH 为匿名符号，展开时均须为 owning 查询可解析的完整 Ref（kind/objectType/id、完整 Scope、适用 version/snapshot/hash）；不是可投产数据或已执行 fixture。每条输入固定 Enterprise-A/Project-A/Plan-A 的真实版本与各自 Hash，观察水位只代表各 Owner 的观测，不假装跨模块原子快照。所有真实 trace 当前为 NOT RUN。

| Trace | 输入与步骤 | 必须得到的事实/拒绝 | Owning 场景 |
|---|---|---|---|
| TR-260-01 | R1 的 P@3、R2 的 E@2/F@5；P 强制配套 E/F；独立 Reviewer 与 Approver 已满足；三套 exact/current RAS/ABS/Markdown/PKG/RRS/AUTH；M 仍处理中 → 核对 → 确认 → 生成 → 两次下载 | 一个章节组织批次；三套单 Revision PKG 不变；三份 bytes/清单/ZIP 两次相同；轮次来源保留；M 与项目完成状态不动 | RP-D12-001/008、QG-D12-001、AF-D12-001、UI-D12-001 |
| TR-260-02 | 只选 P/E，缺 F；或 F 只有内部批准但无 Markdown/RRS/授权；或配套关系类型未知 | 配套未闭合/文件未就绪，确认拒绝；不自动选 F、不把整项目等待项加入、不生成批次 | RP-D12-002、EP-D12-002 |
| TR-260-03 | 替换任一完整 Ref 的 Scope、Revision hash、Representation checksum、PKG hash、RRS binding 或 ZIP bytes | masked scope 拒绝或稳定 Hash/绑定拒绝；无新成功事实；旧单 Revision Hash 基线不变 | RP-D12-003/006、AF-D12-002 |
| TR-260-04 | mandatory FAIL/ERROR/missing、blocking issue、PARTIALLY_APPROVED、作者自验；项目负责人请求跳过独立角色 | 不具内部获批资格，不进入可交付；成功 APPROVED receipt 才按单份接续；REJECTED/UNKNOWN 留当前文件 | QG-D12-001/002、UI-D12-002 |
| TR-260-05 | 核对后 Approval/Gate/Profile 失效、RRS 被新 Snapshot 取代或 Release Recall；确认后/Link 后/流前撤权 | 确认拒绝或原批次当前不可用；无新 AVAILABLE/许可/后续流；旧清单/历史下载观察保留 | RP-D12-004、QG-D12-003 |
| TR-260-06 | 核对后 selected exact row 被新合法选择取代、计划/关联/配套改变；确认后新候选到达 | 旧未确认选择显式 STALE 并阻断；有效选择保留；旧 CONFIRMED 清单与包不改；新候选本身不撤销仍有效旧批准 | RP-D12-005、UI-D12-003 |
| TR-260-07 | 确认响应丢失；同键异 payload；生成上传后 DB fault、finalize timeout、Worker lease 过期 | 回读原 target/key；同键异输入拒绝；无部分批次/可下载 Link；孤儿受审计清理；UNKNOWN 恢复同 Attempt，不触碰独立工作 | RP-D12-007、IG-D12-002、UI-D12-004 |
| TR-260-08 | 下载无 Session/错主体/Scope/过期许可；流中断或成功观察写入失败；Browser a.click/复制数据 | 无权/过期不发 bytes；已开始流保存真实部分/UNKNOWN；仅请求与服务端可证明事实可展示；FormalReceipt、ReleaseCompleted、DeliveryItem/Project Completion、EffectiveBinding 均无新事实 | RP-D12-009/010、UI-D12-005/006 |
| TR-260-09 | 仅有Project-A/Plan-A，无已知Artifact refs；ART中跨R1/R2的P/E/F及共享文件，另有内部获批但无Release的N、无Run的Human成果和无权成果 | EP只发现真实Item，ART发现文件/批准版本/Markdown refs；REL逐项权威重验后展示N的等待原因，共享文件一次且保存全部适用关联；隐藏项不泄漏，不依赖客户端refs或已存在Release | RP-D12-011、AF-D12-005、UI-D12-001 |
| TR-260-10 | Plan超过一页，EP ENUMERATE与ART发现出现空中间页；VERIFY空集合或完整required集合；续页换Scope/Plan/筛选或源水位变化 | 有nextCursor继续且无漏项/重复；空VERIFY只证明空集；一页Hash不能替代完整VERIFY；旧cursor安全拒绝，刷新不改选择/Batch，不将隐藏required关联排除后确认 | EP-D12-004/005、AF-D12-006、RP-D12-012 |

## 6. 验收与冻结 Gate

本交付只检查 Markdown、owning 路由、字段/Hash/转换与上表正反例的一致性；配置目标为 docs。独立设计审查不得由 Implementer 自审替代；人类技术批准须指向审查后的精确修订。批准后另行确认 Registry/类型/fixture、有限 Policy/Renderer profile、owning 持久化/Attempt、实际公开 transport 和真实存储的实施范围及门禁。

真实 OIDC/HTTP、PostgreSQL、Host/Runner、Renderer/对象存储/受控流、Windows/macOS Chrome/Edge、配套业务适用性与独立人工交付验收均 NOT RUN；原型 sessionStorage、合成 ZIP 或静态 Hash 检查不能升级这些证据。执行证据归 Issue/PR，不新增平行任务计划或验证报告。
