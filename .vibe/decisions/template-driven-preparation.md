# 模板驱动的准备分析：MVP 前置条件校正

状态：`T2 / PRODUCT DIRECTION CONFIRMED 2026-10-18 / FIRST ANALYSIS AUTHORIZED / BASIS, EXECUTION AND REPORT CHAIN IMPLEMENTED`。

## 1. 目标与批准范围

2026-10-18 用户再次明确原始目标：“输入客户资料，比对项目模板，阅读客户资料根据项目模板给出修订意见”，随后选择“批准先做模板分析”。这是对 [MVP §4.8/§5.3](workspace-mvp-human-agent.md#48-首轮资料接纳与-runner-分析报告) 的重申，不是新增法规分析产品，也不是仅环境 B 才允许的业务例外。当前授权先交付真实首次分析；本机存储/OMP 的技术适配继续按已批准的 Deployment Baseline。

原 #257 将特定标准/法规发布与公司 startup bundle 绑定，#277 又把该 bundle 作为准备入口前置；这使模板比对依赖尚未配置的规范原文，偏离上述目标。本次校正采用真实项目模板、固定工作规则和实际客户资料作为分析依据；法规来源仅在任务明确使用时作为实际来源，不作为所有准备项目的无条件前置。公司负责选择模板及其适用范围；Runner 不因模板带法规引用而声称已独立核验法规。

当前交付为：可信登录 → 创建准备项目 → 上传一个 ZIP → 本机 OMP 阅读客户资料并比对固定模板 → v0.2 报告经真实业务接口接纳 → 顾问查看报告。报告之后的修改、审批、交付仍是正常 MVP 主链路的后续能力；本次没有实现它们，也不新设“补齐三份规范原文才可继续修订”的永久条件。

用户对前一份“仅 B 模板分析例外”临时草案的确认题属于同一会话，须结合上述澄清解释；该临时草案已撤回，不作为新模式或永久启动限制的依据。本文件不扩大 Git、生产部署、实际客户资料出网或第三方发布授权。

## 2. 确定的技术选择

| 选择 | 决定及理由 |
| --- | --- |
| 分析基准 | EP 拥有独立不可变的项目分析基准，绑定实际模板、公司指令、词表和模板要求定位；不伪装成旧 company startup bundle 或法规发布。 |
| 版本兼容 | 新 `ep.preparation_entry@1.1` 仅按精确 profile 分派；新 capture/get source @2.0 与独立报告读取 @1.0 显式登记。原 @1.0 请求、发布、Refs/Hash 与回读保持原义，不改历史事实；新请求不默默回落旧入口。 |
| 使用资格 | 验证真实模板/指令/映射、来源 Hash、当前授权及基准使用状态。缺法规原文不构成该模板分析入口的全局失败；未读、未知、冲突仍须如实报告。 |
| 分析所有权 | 平台只做技术提取、托管、调度、结构/证据校验及业务接纳；语义阅读和建议由 Runner 产生。模板示例不得成为客户事实。 |
| 本轮边界 | 只新增 PREPARING 的首次资料分析。后续正式信息确认与文件修改接受集尚未实现，不借本报告创建/激活 Fact、Product、QMS、Profile、ProductScope 或 PROJECT_START。此为本轮实现边界，不是模板驱动业务的永久禁止条件。 |
| 部署与产品分开 | 模板驱动语义属于正常业务流程；本次只在环境 B 安装实际 macOS OMP 执行 profile。未安装的生产 Runtime 仍不可调用，不靠特殊业务标志绕过检查。 |

## 3. Owning 增量与接口边界

字段及失败条件由 [EP](../module-specs/Module-Spec-002-EnterpriseProject.md#模板驱动准备分析2026-10-18)、[IP](../module-specs/Module-Spec-001-IdentityPolicy.md#模板驱动准备分析授权2026-10-18)、[TE](../module-specs/Module-Spec-003-TaskExecution.md#模板驱动准备分析执行2026-10-18)、[IG](../module-specs/Module-Spec-007-IntegrationGateway.md#模板驱动分析输入绑定2026-10-18)、[UI](../module-specs/Module-Spec-UI01-WorkspaceUI.md#模板驱动准备入口2026-10-18) 拥有。分析基准、精确 preset 分派与 source@2.0 已有实现及注册；TE preparation 执行、EP 报告接纳/读取已补齐实现；必须分别完成配置化验证、独立审查与本机实测后才能宣称整条链可供手动测试。

- EP：实际分析基准版本与授权使用记录、技术预设、准确准备来源、报告接纳及当前可用性。
- IP：部署发布/读取与顾问准入的真实授权；模板可用不自动授予项目权限。
- TE：专用准备 Task/WorkOrder/Context/Run、独立结果校验与接纳；保留旧 ACTIVE Task 接受集。
- IG：原 ZIP/条目及基准材料的实际字节托管、固定提取、受控 OMP 调用、原输出封存；不解释业务完成。
- UI/BFF：现有创建、ZIP 和报告页面接线；只消费已登记公开操作，不增加 BFF 私有业务捷径。

## 4. 当前性与恢复

项目请求锁定完整基准版本/Hash。并行的新版本不自动替换旧版；明确取代、撤回或所锁来源损坏时停止受影响的新 source capture、dispatch 和可用报告接纳，保留原历史。不确定调用先查原 Attempt，禁止第二次盲目调用。重登录、进程重启、重发网络响应均不生成新业务意图。

历史报告继续按当前读权限回读真实原始字节及其基准，并显示当前限制；不能重算成新版本结果。已在运行的迟到输出仅保留原调用观察，不能绕过当前资格形成可操作报告。固定源的宿主目录发生变化不改变本轮已物化字节；下一轮显式使用新基准。

## 5. 一项贯通验收与实施顺序

1. 环境 B 在没有三项规范发布实例时，受权顾问仍可创建项目、上传合法 DOCX/Markdown ZIP；真实 OMP 读取客户材料与指定模板，并返回可校验的 v0.2 JSON/Markdown。
2. UI 读回实际报告、读取限制、缺口及修订建议；服务重启、刷新或重登后事实一致，不使用合成结果。
3. 错模板/指令 Hash、悬空映射、越权、跨项目来源、重复请求、UNKNOWN、迟到/漂移输出、缺执行能力分别有明确拒绝或恢复行为。
4. 旧入口、历史引用与环境 A 回归保持；报告成功不产生未实现的正式确认、修改、审批或交付副作用。

先闭合 owning Spec/Test、Catalog、持久化及运行配置绑定，再按一条真实用户旅程实现基准初始化、准备来源、TE/IG 执行和报告接纳。运行窄范围诊断和项目 `full`，独立审查实际修订；实际 Provider、平台接纳与人工浏览器验收各自取证。本文件不创建额外任务状态机或平行验收日志。

## 6. 首次分析执行链的合同收口（已批准技术增量）

状态：`HUMAN TECHNICAL APPROVAL CONFIRMED 2026-10-18 / REGISTERED AND IMPLEMENTED`。用户继续接通环境 B 的目标不变；本节处理读取当前可执行合同后发现的具体差异，不能将已批准的 macOS 进程适配当作缺失 Core 执行接受集已经实现。用户已于同日明确选择“批准该技术增量，继续实现”；按照本节补齐执行合同及其持久化、授权和独立接纳后方可发布报告。

### 6.1 已证实的差异

1. 现有 Task/WorkOrder/Context 创建和 freeze/Run/Result producer 的支持集属于 ACTIVE 项目。D14 仍将新 PreparationContext/WorkOrder preparation 分支标为 PROPOSED/未注册，不能通过移除 ACTIVE 检查使“先分析后确认”进入旧分支。
2. D14 提案有“Run 使用 canonical zhiju.execution.*”表述，但现有 Run、Result、Acceptance 的真实 owning 类型为 `execution.run`、`execution.agent_result`、`execution.agent_result_acceptance`。直接新造同义 Ref 会破坏历史比较与回读；新 profile 应复用真实身份，不能依照该概括描述创建别名。
3. `captureSourceV2` 目前把 `validUntil` 设为短期 SERVICE session 的到期时间；环境 B SERVICE session 为 5 分钟，而获批本机分析允许最长 60 分钟。完整分析不能通过延长登录态或忽略过期来解决，需明确区分资料快照有效期与当次执行授权。
4. 环境 B Core 登录尚未具有准备流程两个既有数据库角色的显式 SET 权限；原 initializer 具备角色不代表 Core 可完成真实顾问创建/上传流程。

### 6.2 推荐的有界技术决定

| 项目            | 推荐决定                                                                                                                                                                                                                         | 接受与拒绝边界                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 生命周期        | 新 `PREPARATION_ANALYSIS` profile 只接 PREPARING 的首次 source@2.0。使用既有 TE owning Task/WorkOrder/Run/Result Root；对新 profile 增加明确的 producer、验证和迁移支持，不另建同义 Root。                                       | 不要求先 PROJECT_START；不放宽旧 create_task/Context/Run selector；ACTIVE 首轮恢复、补料、多轮生成均不在本增量。                                 |
| Context         | 落地已提案的 `PreparationContext@1.1`：精确 project/source、analysisBasisRef/Hash/publication、客户与模板/指令 bytes Hash、词表与要求映射、purpose/audience、运行配置 Hash、初始授权出处、deadline。独立内容 Hash 覆盖完整绑定。 | 初始授权是来源记录，不能持续授权；每次 dispatch、控制与最终接纳须取当前独立 Decision。冻结后不替换来源或重算原 Hash。                            |
| WorkOrder       | 落地 `WorkOrderContract@1.1` 的 preparation 分支；目标仅为已固定客户源与模板的只读分析，输出为 v0.2 raw JSON/MD pair 与提取证据。                                                                                                | 不授予 document.write/Artifact/Approval/Release；五类验证、readiness、freeze、Run claim/lease/fencing 和独立 Acceptance 均保留实际 owning 事实。 |
| 身份与版本      | Task/WorkOrder/Contract 使用现有真实 canonical 类型；Run/Result/Acceptance 继续精确使用 execution.*。新 PreparationContext/analysis_request 等类型按 owning Spec 显式登记。                                                      | 无别名归一化，不改变旧成功回执或旧 Context 的语义。                                                                                              |
| 来源有效期      | 新 source@2.0 capture 使用独立、最多 60 分钟的分析快照期限，并取基准/相关来源使用期限的较早值；不延长用户或 SERVICE 登录态。旧 Source 保留原期限。                                                                               | 当前撤权、基准撤回/取代、来源损坏立即阻断新调用或可用报告接纳。短期 Decision 过期必须重新授权；不得因快照未到期沿用失效权限。                    |
| 运行            | 初版一个实例一个实际 OMP 分析进程。Invoke 前落盘原 Attempt；启动握手核验实际模型/工具/公司指令。lease 可在当前授权下续到固定 deadline，原冻结规范不变。                                                                          | UNKNOWN 只读原记录；无确定停止/无原调用结果不得重发。Provider 取消未知不转成已取消。                                                             |
| 报告            | IG 固定工具校验并封存原 bytes → TE 独立 Result/Acceptance → EP exact source/basis/CAS 接纳 report/candidateSet/plan → 新公开 Query 给 Web。                                                                                      | OMP 自报成功、固定工具 PASS、TE 接纳、EP 当前报告是四个不同事实。Hash 按实际 bytes，失败不能返回空成功。                                         |
| Core 数据库角色 | 仅环境 B 的 env_b_core 增加已有 `identity_policy_preparation_writer` 与 `identity_preparation_self_reader` 的 `SET TRUE, INHERIT FALSE, ADMIN FALSE`。                                                                           | 不新增 superuser/BYPASSRLS、模板发布权限或生产权限；仍由当前事务显式 SET ROLE 和 RLS 约束。                                                      |

### 6.3 要闭合的公开接口与 UI

在 owning Spec/Test/Core/Catalog 中一起完成字段、正负 fixtures、selector 与持久化后再登记：`execution.create_preparation_analysis_task@1.0`、`execution.build_preparation_context@1.0`、`execution.request_preparation_analysis@1.0`、`execution.get_preparation_analysis_result@1.0`、`project.accept_preparation_report@1.0`、`project.get_preparation_analysis_report@1.0`。控制与状态必须复用已经明确声明支持该 preparation profile 的 owning 入口；不在旧 CanonicalJson 中隐藏新 selector。

继续沿用当前新建项目、一个 ZIP 上传、分析总览布局。上传回执展示真实接纳与运行阶段，不显示伪造百分比；报告页从新 Query 的同版 v0.2 内容映射。尚未通过接纳、当前资格失效与历史只读分别提示，不借 get_startup_review 填占位法规/启动 Ref。

### 6.4 实施与验收顺序

1. 按已批准技术决定，同步 owning Core/TE/IP/EP/IG/UI 接受集，先证明一条 PREPARING 来源可产生真实 DRAFT、Context、五类验证、frozen Contract 和有界 Run。
2. 安装当前本机 OMP 的明确 profile；新增的权限只在 B 初始化中安装，并验证运行账号无更高权限。通过 worker 接入真实 IG 调用，重启只恢复原 owning 回执。
3. 完成 v0.2 独立重验、TE 接纳和 EP immutable report，接入 BFF 精确 allowlist 与现有 Web 总览。
4. 执行所需 `full` 与独立审查；小型脱敏 ZIP 经真实 OMP 返回报告后验证刷新/重登/服务重启、无重复调用、跨项目/撤权/过期/迟到输出/校验失败负例。Provider、平台接纳与人工浏览器结果分别记录。

达到第 4 步并有实际报告回读证据后，才能告知用户开始该链路手动测试。仅有常驻服务、模板初始化或单独 Provider 成功，不足以宣称整条链已贯通。本增量不授权 Git 推送、合并、生产部署或真实客户资料出网。


## 7. 环境 B 项目看板角色补齐（2026-10-19，用户选择暂缓）

状态：`DEFERRED BY USER / NOT AUTHORIZED / NOT IMPLEMENTED`。用户明确选择“暂不补齐，先通过原报告链接测试”；本轮不安装该角色，工作台恢复到报告不列为当前手动测试入口，顾问从本次资料提交回执的原报告链接进入并保存书签。首次真实 OMP 报告已接纳，直接打开原准备请求可读；恢复验证发现，工作台目录能返回当前授权的准备项目，但已有 `project.get_project_board_slice@1.0` 在 `SET LOCAL ROLE projection_app` 处返回 PostgreSQL `42501`。环境 B 的 `env_b_core` 不具备该角色的 SET/MEMBER 权限，导致接口先失败，既有 `preparationEntry` 链接无法返回。空 Projection 本身按合同应返回 `REBUILDING`，不能用伪造 READY/空看板掩盖这个安装缺项。

第 6 节批准的新增权限明确限于两个 preparation 角色，不涵盖此项。建议仅为本机 B 的 `env_b_core` 增加既有 `projection_app` 的 `SET TRUE, INHERIT FALSE, ADMIN FALSE`，由现有 owning Query 在已授权的 Enterprise/Project 事务中显式切换；不增加公开操作、不改用户 CapabilityGrant、不改目录/看板/准备请求的独立授权检查、不修改 RLS 或环境 A。

权限影响须明确：`projection_app` 是项目与任务看板读模型的既有读写角色，并非数据库只读角色；它不拥有业务成果、批准或发布的写入权，没有 superuser/BYPASSRLS/角色管理权。本提案接受该既有角色粒度用于本机受信 Core，当前新增调用仍仅执行已存在的看板 Query。若不接受此粒度，应另行设计仅可读的 Projection 数据库角色及 owning 事务选择，不临时绕过现有边界。

批准后的最小实施为 B 初始化的一个角色成员关系补齐及相关部署/Test 说明。验收使用实际 `env_b_core` 检查可 SET、不可自动继承、不可管理角色且无 superuser/BYPASSRLS；通过真实登录从工作台打开同一准备项目和同一已接纳报告，校验缺少 board/read 权限仍拒绝、原报告 Hash 与 OMP 调用标记不变，并完成同内容 `full` 和独立审查。批准前不写入实际数据库权限。
