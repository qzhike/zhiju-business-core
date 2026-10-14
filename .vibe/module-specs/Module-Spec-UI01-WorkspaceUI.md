# Module-Spec-UI01-WorkspaceUI

版本：v0.1
日期：2026-10-08
状态：`CURRENT EXPERIENCE MODULE BASELINE / IM-UI-01 MILESTONE USER APPROVED / DESIGN VERIFIED / ENGINEERING SHELL IMPLEMENTED / REAL INTEGRATION NOT RUN`

## 1. 模块定位与责任

Workspace UI 是 Zhiju Platform Experience Layer 的 Human Browser Client 与配套 BFF，不是第八个 Business Core 模块。它向授权 Human 提供跨模块、权限裁剪、状态真实的操作界面，但不拥有任何业务 Aggregate、状态机、Authorization、Approval、Release、Completion、Repository、PostgreSQL Schema 或公开业务 Contract。

本模块负责：

- OIDC Browser 登录、受控 Session、登出、过期与重新认证体验；
- Enterprise/Project Context 选择与授权范围内的页面导航；
- 调用公开 Command/Query API 并映射为安全 ViewModel；
- 显示 Projection freshness、外部副作用 UNKNOWN、部分成功和业务拒绝；
- 为 Human Edit、Review、Approval、Release 等高风险动作收集精确 Ref/Version/Justification 和显式确认；
- Browser 端安全、可访问性、错误恢复、前端可观测性和用户手动验收。

本模块不负责：

- 创建或解释 Role/Capability/AuthorizationDecision；
- 在浏览器或 BFF 中维护业务状态机、Ready/Complete 判据或审批规则；
- 直接读取/写入 PostgreSQL、OpenBao、Ceph、Renderer、Feishu 或 Runtime Provider；
- 通过隐藏按钮、路由守卫或前端角色字符串代替服务器授权；
- 把浏览器草稿、local cache、消息、附件或成功 toast 作为业务事实。

测试规格：[`Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md)。实施顺序：[`Implementation-Milestone-Plan-v0.1.md`](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)。认证与部署边界：[`Deployment-Security-Baseline-v0.1.md`](../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md)。

## 2. 依赖与调用边界

```text
Browser
    → Workspace BFF
        → Public HTTP Command/Query API
        → authorized download/upload initiation API
        → Projection Query with freshness metadata

Workspace BFF
    ↛ Business module internal package
    ↛ module Repository
    ↛ PostgreSQL/OpenBao/Ceph direct client
    ↛ Provider SDK business calls
```

依赖规则：

1. Browser/BFF 只导入生成的公开 API 类型、受控 ViewModel 类型和通用 HTTP/OIDC 基础设施类型。
2. BFF 可以组合多个权限裁剪的 Query Result，但不能在一个请求中同步写多个 owning module。
3. 所有 Command 仍以唯一 owning Application Port 为目标；BFF 不创建私有 Command 名称。
4. 跨模块页面优先读取 Projection；涉及授权、Approval、Release、Completion 或精确历史的判断必须调用 AUTHORITATIVE Query。
5. UI 不新增或修改现有 200 项公开 Catalog；如实现发现缺少必要公开能力，先走 Contract proposal/review，不以 internal route 绕过。

## 3. 产品范围与页面能力

### 3.1 Session 与 Context Shell

- 登录、回调、Session 状态、登出、过期与重新认证；
- 当前 Principal 的安全显示摘要；
- Enterprise/Project Context 选择，仅显示授权 Query 返回的选项；
- 全局 correlation id、Projection freshness、系统降级和未完成操作提示；
- Deep Link 必须在服务器重新授权，不能仅凭 URL 中的对象 ID 打开资源。

### 3.2 Enterprise/Project Workspace

- Enterprise 与 Project Overview；
- Customer Baseline 完整性与 `PRESENT/UNKNOWN/NOT_PROVIDED/MISSING_CONFIRMED` 区分；
- GapAnalysis 输入、Finding、Decision、accepted/stale 状态；
- DeliveryPlan/DeliveryItem、依赖、criteria、Human Approval 与 Impact 状态；
- Project Board Projection 的 checkpoint、target watermark、lag 和 rebuild 状态。

### 3.3 Artifact Workspace

- Artifact、Branch、Revision、Lineage 与 Representation；
- 两个精确 RevisionRef 的 Diff；
- Human Edit 保存为新 Revision，不能覆盖旧 Revision；
- 并发 Head/CAS 冲突提供重新加载、比较和显式 Merge 路径；
- 下载只使用即时授权的短期 URL，页面状态不持久化该 URL。

### 3.4 Quality 与 Release Workspace

- Evidence、GateResult、ReviewIssue、Verification 与 Approval 状态；
- exact Revision/Acceptance/Approval/Release Readiness Hash 链；
- Human Review/Approval/Release Authorization 的显式确认、Justification 与 expectedVersion；
- Agent/Service/`actingFor` 的 Human-only 请求即使页面被直接调用也必须由 Core 拒绝；
- 普通附件发送、Channel Receipt 或 message id 不得显示为 Formal Release。

### 3.5 Task 与运行 Workspace

- Task、WorkOrder、Run、AgentResult、Usage/Provenance；
- Run/WorkOrder/Task/DeliveryItem 四层状态分别显示；
- BLOCKED_INPUT、InformationRequest、Answer、Resolution、新 ContextSnapshot 与新 Run；
- Cancel request、late result、retry/fallback、UNKNOWN 和 conflict；
- Audit Timeline 只显示权限裁剪的安全摘要，不复制敏感 Canonical Payload。

## 4. ViewModel 与状态真实性

ViewModel 只能派生展示，不成为业务 Source of Truth。至少保留：

```text
dataState = LOADING | READY | EMPTY | ERROR
authority = AUTHORITATIVE | PROJECTION
freshness = FRESH | STALE | PAUSED | REBUILDING | FAILED
commandState = IDLE | SUBMITTING | PENDING | COMMITTED | REJECTED | UNKNOWN
accessState = ALLOWED | DENIED | SESSION_EXPIRED | REAUTH_REQUIRED
```

规则：

1. `READY` 只表示页面数据已加载，不表示业务完成。
2. Projection `STALE/PAUSED/REBUILDING/FAILED` 必须显示 last/target watermark 或安全摘要；不得把旧数据标成最新。
3. Command HTTP timeout 或连接中断后显示 `UNKNOWN`，通过幂等键/Command Result reconciliation 回读，不自动生成新业务操作。
4. `NOT_FOUND` 与 `ACCESS_DENIED` 按公开 API 的安全折叠语义显示，不通过二次查询探测对象存在性。
5. `UNKNOWN`、`NOT_PROVIDED`、`MISSING_CONFIRMED`、`NOT_APPLICABLE` 必须使用不同文本/图形语义，不允许统一显示为空白或“缺失”。
6. 可选字段未提供时使用 omission 语义，不把 `undefined`、`null` 或空字符串发送给公开 Contract，除非 Schema 明确允许。
7. 所有影响历史解释的详情页保存/显示 exact object/version/revision/snapshot/hash，而非 `latest/current` 标签替代。

## 5. Command、并发与 Human-only 操作

1. 表单由当前 Query Result 初始化，并保存目标 ObjectRef、expectedAggregateVersion、输入快照/内容 Hash 和 idempotency key。
2. 提交前可以做 UX 校验，但 Core Schema/Domain/Authorization 仍是唯一裁决；前端校验成功不代表 Command 可执行。
3. `CONCURRENCY_CONFLICT` 不自动覆盖或静默重试高风险 Command；页面重新加载权威状态，要求 Human 重新确认。
4. 相同用户动作的安全重试复用稳定 idempotency key；不能因按钮重复点击制造第二 Command intent。
5. Approval、Release Authorization、Gap Acceptance、DeliveryPlan Approval 等 Human-only 操作必须显示 exact target、scope、hash、影响与 Justification，并由服务器再次验证可信 Human ActorSnapshot。
6. UI 不接受 payload 中自报的 Human 身份覆盖 Session principal；`actingFor` 不改变 actor kind。
7. 乐观更新只能显示明确 `PENDING`，收到权威 COMMITTED Result 后才进入成功状态；REJECTED/UNKNOWN 必须回滚展示或进入 reconciliation。

## 6. BFF、Session 与认证

1. 使用 OIDC Authorization Code + PKCE `S256`；禁用 Implicit Flow。
2. Access/refresh token 不进入 `localStorage`、`sessionStorage`、IndexedDB、URL、普通日志或浏览器可读 Cookie。
3. Session Cookie 使用 `Secure`、`HttpOnly`、适用 `SameSite`、固定 Path/Domain 与短生命周期。
4. 状态改变请求验证 CSRF token、Origin/Host、Content-Type 和 Session；认证成功不替代 IdentityPolicy Authorization。
5. Session 过期或撤销时清理 BFF session 和浏览器敏感缓存，返回可恢复的重新认证入口；不得无限刷新失效 token。
6. BFF 传播 correlation id，不把 token、External ID、客户正文或下载 URL写入 trace/error analytics。
7. Keycloak Realm Role、email 或 display name 不能直接成为 Zhiju Role/Capability；必须经 ExternalIdentityLink → Principal → AuthorizationDecision。

## 7. Browser 安全、隐私与内容边界

1. 默认拒绝未授权 route/data；Route Guard 仅改善体验，服务器授权是最终边界。
2. CSP、输出编码、HTML sanitizer、依赖安全和 Trusted Types 可行性在 UI-DG-003 固定；客户内容不得以未净化 HTML 执行。
3. 文件上传先进入受控 Staging/validation；文件名、media type 和预览内容均视为不可信输入。
4. 短期下载 URL 不进入 Redux/store equivalent、持久缓存、复制 analytics、DOM data attribute 或可分享 Deep Link。
5. Error Boundary、telemetry、session replay/screenshot 工具默认禁采敏感字段；引入第三方遥测必须独立审核数据出境、保留和关闭方式。
6. 浏览器 Back/Forward、多个 Tab、断网恢复和重复提交不得绕过 expectedVersion/idempotency。
7. Logout、Session expiry 和 Project switch 清理 Project-scoped cache，防止同一浏览器后续 Principal 看到前一 Scope 数据。

## 8. 可访问性、响应式与人工使用

1. UI-DG-002 必须冻结支持浏览器、桌面/窄视口范围和可访问性目标；未冻结前不宣称 compatibility/accessibility PASS。
2. 所有交互支持键盘操作、可见 focus、语义化 name/role/value、错误摘要和焦点回收。
3. 颜色不是状态唯一编码；UNKNOWN、STALE、FAIL、DENY 和 REQUIRED 同时提供文本/图标语义。
4. 表格、Diff、Timeline 和 DAG 为复杂信息提供可导航结构、摘要和非视觉替代。
5. Approval/Release 等高风险确认不能只依赖 hover、颜色、拖拽或瞬时 toast。

## 9. UI 本地错误与业务错误映射

以下 code 只属于 Experience/BFF 交互，不进入 Business Core Catalog：

```text
UI_SESSION_EXPIRED
UI_REAUTH_REQUIRED
UI_CSRF_REJECTED
UI_ORIGIN_REJECTED
UI_PROJECTION_STALE
UI_COMMAND_RESULT_UNKNOWN
UI_UNSUPPORTED_BROWSER
UI_CLIENT_STATE_INVALID
```

业务 ApiError 的 code、safe message、retryable 和 details 路径原样按公开 Contract 映射；UI 不改名、不吞掉或按 HTTP status 猜测新的业务错误。敏感 details 不进入页面或 telemetry。

## 10. IM-UI-01 交付顺序

```text
UI-WI-01 Decision + IA + Route/Capability Matrix
    ↓
UI-WI-02 BFF/OIDC Session + App Shell
    ↓
UI-WI-03 Project/Baseline/Gap/Delivery
    ↓
UI-WI-04 Artifact/Revision/Diff/Human Edit
    ↓
UI-WI-05 Evidence/Review/Approval/Release
    ↓
UI-WI-06 Task/Run/InformationRequest/Audit
    ↓
UI-WI-07 Browser E2E + Security + Accessibility + Manual Acceptance
```

UI-WI-03 至 UI-WI-06 可以在稳定公共 API 和 shared shell 前提下局部并行，但不能绕过 UI-WI-01/02；UI-WI-07 必须覆盖组合后的完整路径。

## 11. 可人工验收的里程碑产出

使用脱敏“采购控制程序”Reference Project，授权 Human 可以在浏览器中：

1. 登录并进入唯一授权 Project；跨 Project Deep Link 被安全拒绝。
2. 查看 Customer Baseline 的 PRESENT/UNKNOWN/NOT_PROVIDED 区分，接受 Gap 并批准 DeliveryPlan。
3. 从精确 Artifact Revision 创建 Human Edit 新 Revision、查看 Diff，旧 Revision 保持不可变。
4. 查看 Evidence/Gate/Review，完成适用 Human Approval 和 Release Authorization；Agent/`actingFor` 路径被拒绝。
5. 查看 Task/WorkOrder/Run/BLOCKED_INPUT，提交 InformationRequest Answer 后观察新 Context/New Run。
6. 查看 Projection stale/恢复、Command UNKNOWN/reconciliation、Audit Timeline 和 Formal Release Receipt。
7. 使用键盘完成关键路径，验证 Session 过期、重新认证、登出、CSRF/越权负向场景和敏感信息不泄漏。

人工验收必须记录环境、浏览器版本、输入、预期、实际、截图/trace 的脱敏证据和剩余风险。受控 Browser E2E 或 Agent 操作浏览器不能替代独立用户验收。

## 12. 当前状态

- IM-UI-01 里程碑、依赖、范围和边界已由用户于 2026-08-28 批准。
- 用户于 2026-10-08 批准 UI-DG-001～003 的[工程技术基线](../decisions/workspace-ui-engineering-baseline.md)，并要求收口、准备正式开工。人类设计批准已完成；Issue #252 记录独立设计审查 APPROVE 绑定 `955461a` 与已保存设计 Hash。D14 字段草案仍未注册。
- [Issue #252](https://github.com/qzhike/zhiju-business-core/issues/252) 的 Web/BFF 工程外壳已实现：独立构建、固定匿名样例首轮导航、整份选择/确认、精确报告/请求、生产安全拒绝及架构门禁。开发样例使用专用标签页存储，不代表服务器个人草稿或业务持久化。
- 真实 OIDC/Session、公开业务 HTTP、客户 ZIP 接收/解包、报告接纳、Runner、生产部署、完整平台浏览器矩阵及独立人工业务验收仍为 `NOT RUN`。
- 本文 `DESIGN VERIFIED` 只表示 Experience 层职责、依赖和失败边界与现有 Core 权威文档一致，不代表 UI 可用。

## Workspace MVP D14：项目资料准备与正式启动

状态：`D14 / INITIALIZATION DIRECTION USER APPROVED 2026-10-08 / FIELD CONTRACT CLOSURE PENDING / NOT REGISTERED / NOT IMPLEMENTED`。用户批准的范围、主工作区依据及兼容规则见[正式提案 §4.7.1](../decisions/workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。本节同步新增设计约束，不宣称本分支较早正文的实施状态等于当前 main，也不改变已发布接口。

1. 新建入口保持客户企业名称与项目名称两个主要输入；已有客户在同一框中搜索并明确选择，新客户原位切换。创建准备项目后直接进入该项目 ZIP 页，身份和权限由公开 Core 能力返回。
2. 报告总览及逐章节文件选择保持原设计。在首轮范围面板紧凑展示“企业基础信息、体系与规则、产品范围”三类必要信息摘要和可展开客户依据；具体字段由正式服务给出，三类摘要不代替 owning 事实模型。
3. 文件默认均不选；底部同一“确认信息与范围并开始”操作明确同时确认必要信息及所选完整计划。界面不增加企业画像录入页或 Web Agent；BFF 只转交已注册公开能力，跨模块协调由受控 owning Application/Process 执行，不在 BFF 同步写多模块。
4. 必要启动信息缺失时突出原因并禁用开始，保留文件选择；有误可回总览提交说明/依据。普通缺口、未决职责保护冲突仍整份等待，其他独立文件在正式启动成功后可先做。
5. 核验中、已接收待安排、失败、UNKNOWN 和报告过时分别呈现；UNKNOWN 回读原提交，不自动换键；报告过时重看受影响信息再确认。关闭、刷新或失败保留草稿/所选内容，新反馈不强制导航。
6. #startup-review 为独立固定匿名原型入口，复用现有范围面板布局；选择和回执仅在本标签页专用演示键保存，不调用 Core/Runner，不修改其他项目、报告、执行轮次、批准或交付包。原型的启动信息来自新增匿名示例，不冒充现有 v0.1 报告的提取结果。2026-10-08 用户明确“保留当前布局”，三类摘要、可展开依据、章节文件清单与单一确认操作作为已批准交互基线；字段级合同、真实服务及独立人工业务验收仍待完成。

字段细化参见[启动核对 DTO v0.1 草案](../decisions/workspace-startup-review-v0.1.md)与[Runner v0.2 候选草案](../decisions/runner-analysis-report-v0.2.md)。保持当前布局；未注册字段不得直接成为私有 BFF 业务入口。匿名样例/定向设计检查不改变本节 NOT IMPLEMENTED 或正式 Module-Test 的 NOT RUN 状态。

## Workspace UI 首版工程 Spec Delta（已批准未来设计）

分类与选择见[工程决策提案](../decisions/workspace-ui-engineering-baseline.md)。人类技术批准已完成，在适用独立审查与工程前置条件满足后落实：

1. 独立 SPA/Web 与 NestJS/Fastify BFF，同源发布；公开 wire DTO 经审查后进入 Browser，无私有模块导入或直接数据库/Provider 访问。
2. 已批准布局由语义组件和 token 实现；Chrome/Edge 类别已确认，具体支持窗口、可访问性与视觉验收见提案。页面路径是 Experience 标识，不注册公共业务操作。
3. Session 代次与精确 Scope/版本隔离 Query 缓存，取消请求之外还拦截迟到响应；后台轮询不自动换候选，Command 不自动重试，UNKNOWN 查询原稳定意图。
4. 技术 Session 内存丢失要求重登；业务草稿与提交恢复须由 owning 公开能力持久化，不能依赖技术 Session 或原型 sessionStorage。真实 OIDC 与 CSRF/CSP/错误/日志方案按提案验证后才宣称可用。
5. 首个真实目标为 ZIP → 受控 Runner 分析/报告接纳 → 启动信息核对和整份文件选择 → 原请求回执与真实进度。D14/RD-01 公共字段及业务 HTTP 尚未 READY，未注册草案不能由 BFF 私有接口绕过。

工程外壳对应的设计审查已由 Issue #252 确认；本节的真实会话、业务及外部集成尚未实现。开发样例 Browser/安全拒绝证据独立于真实 Session、API、Runner、Persistence、平台矩阵与 Manual 验收。


## 首个工程交付目标

目标：在当前 Core 基线内交付可独立构建的 Web/BFF 工程外壳，使开发者可通过明确的开发样例模式走通“工作台 → 首轮 ZIP → 报告总览 → 启动核对/文件选择 → 本轮进度”的已批准页面导航。此阶段是工程进展，不是客户文档已被分析、请求已提交或 Runner 已执行的业务证明。

范围为 `apps/workspace-web`、`apps/workspace-bff` 及必要的 workspace/build/typecheck/lint/architecture/测试接线；不改七个业务模块、数据库迁移或 Catalog。页面复用已有布局、匿名报告及 DTO 草案，开发替身严格隔离；生产模式无有效 Session/公开服务时拒绝业务动作，不自动回退到样例。BFF 首版启动/健康与配置错误边界可先完成，真实 OIDC 及公开业务代理按后续实际接入验证，不用假身份代替授权。

必须在此工程阶段同时保证：

1. Web/BFF 构建彼此独立，使用批准版本及 lockfile，Core 既有构建/工具链保持有效；共享提取仅在实际重复需求出现时进行。
2. 开发模式的深链接刷新、前进后退、空/加载/安全错误状态可操作，沿用默认不选整份文件、显式确认和新结果保留当前页等已批准行为；样例回执明确为演示，不写成真实业务成功。
3. Web/BFF 不导入业务模块/Repository、Provider SDK 或执行器配置；Browser 不含 OIDC token/客户端凭据。与服务相关的 URL、Scope 和 DTO 必须来自受控边界，不造私有业务 Command。
4. 架构检查覆盖 `.ts`/`.tsx` 与应用 manifest，拒绝 Web/BFF 的禁止依赖和私有路径；静态/动态 import 的必要反例以实际代码形态验证。现有只扫描 `.ts` 的 PASS 不足以验收。
5. 开发替身不能出现在正式模式可执行入口。所用 Runner 报告/启动字段继续是未注册草案，不假装为生产 HTTP 返回类型。

开工依赖：适用独立审查、基于当前 Core 的工作区、可运行的配置门禁及设计 authority 可供后续执行任务访问。此目标不要求 D14/RD-01 及全部后续文件检查/批准/交付合同先完成；那些依赖约束各自真实接入。实施仍须走有效配置的验证目标，Browser 与真实服务、人验的证据分别保留。第一项工程任务不宣告整个 IM-UI-01 或 UI-WI-02 完成。


### 工程外壳当前实现边界（#252）

- `apps/workspace-web` 采用批准的 React/Vite/Tailwind、Declarative Router、TanStack Query、Radix AlertDialog 与安全 Markdown。生产构建剔除匿名样例 adapter/报告与演示回执；显式 `build:fixture` 为独立开发制品，静态服务在生产环境拒绝此制品。开发开关不启用生产业务路径。
- `apps/workspace-bff` 为独立 NestJS/Fastify 进程，只有健康和无身份 bootstrap。未接入认证及公开业务服务时，任何业务请求返回固定安全 JSON 错误，不产生 Human、上传/接纳成功或 Runner 回执。无请求内容日志。
- 静态服务只对声明页面与 HTML 导航使用 SPA fallback；`/bff/*` 固定转发，API 与不存在的资产不会变为 HTML 200。
- 开发样例默认不选文件，按精确报告独立保存整份选择，显式确认后才生成合成请求引用；刷新/历史可回读本标签页演示记录。新报告提示不会自动换页或替换当前版本。
- 工程检查覆盖 TS/TSX、应用 manifest 的四类 dependency 字段、静态/动态 import、require 与 import type 反例；manifest 同时检查依赖名称与声明目标，只允许精确 registry 版本或默认 `catalog:`，拒绝别名、本地路径与其他来源借允许名称引入禁止目标。Web/BFF 只允许批准的 Experience 依赖，不改七个业务模块、Catalog、Schema 或 migrations。
- 所有演示结果显示开发身份、合成报告/回执/进度标识。生产业务入口保持拒绝；真实接入继续由 owning 契约决定。

## #277 两字段创建与单次提交交接提案

状态：`T2 / DESIGN APPROVED / NOT REGISTERED / NOT IMPLEMENTED`。保留 [两字段原型](../prototypes/workspace-mvp/README.md) 的客户/项目标题、一个 ZIP/可选说明和“提交并分析”；[EP](Module-Spec-002-EnterpriseProject.md#277-准备入口预设与原请求交接提案)、[IP](Module-Spec-001-IdentityPolicy.md#277-准备入口准入与显式项目授权提案)、[IG](Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案) 拥有真实字段，本节只组合。

表单先公开 find_preparation_enterprises 读取公司 entryBinding 与本人可选客户；同一个客户字段明确 NEW 或选择 exact EXISTING。两种模式仍只由用户填客户和项目标题；浏览器生成 request/project 及 NEW enterprise UUIDv7、固定原键/完整 Scope，在原 payload 中原样回送 presetRef/hash，服务器复验公司选择。无可用 preset/publication/准入权限显示具体不可操作原因。配置、memberPolicy、Runtime/model、授权字段不成为员工表单选项，登录成功不显示“已获项目权限”。

创建按钮只调 request_project_preparation；成功进入 ZIP 页要求 EP Project receipt + 当次 access=USABLE。PARTIAL 显示已建客户/项目和未完成权限，允许原请求当前许可的继续；不重新生成 target/key。Project 目录仍按 exact discovery Grants；准备 Project 的 EP board 可返回下述 preparationEntry 安全链接，UI 不为 PREPARING 自动调用尚不支持它的 TE Task board。无 Project 读权时仅保留当次 admission recovery-read 允许的原请求摘要。

“提交并分析”先固定 intake UUIDv7、原 preparation request/key、note 原文、ZIP 原 bytes hash/长度、从 EP 原 preparation request 公开 result/query 取得的 preparationPresetRef/hash 与 intakePolicyRef/hash、以及 ANALYZE，再发送一个 IG Command，随后同 intake PUT。该 policy tuple 由原 exact preset 产生；首次进入和重登均使用同一公开结果，不从当前新 entryBinding 偷换旧请求绑定，不需要私有配置 API。浏览器只编排传输，不另调用 source capture/TE request 或第二私有分析 API。IG Query 的 custody、EP handoff、TE/IG 执行事实分别显示“接收资料/准备资料/等待安排/分析能力暂不可用/分析中”；没有真实 Run/Attempt ack 时不能显示分析中或百分比。已接收说明必须可原文读回，换 Session 不丢已提交内容；未提交内存草稿不承诺持久化。

跳转在首写前保存安全 request ID/Scope ID 到当前路由（不放客户名、note、token、完整 payload），沿 #258 原请求链接恢复；重新登录先 current auth，再 EP get 原 request，IG 用 PREPARATION_REQUEST selector 找回唯一 intake。浏览器业务写自动重试仍为0；请求 UNKNOWN 只查原事实，不显示“重新创建”。原 Query 返回许可 RESTART 时用户可在同页“重新上传这份 ZIP”，最多一次，重新选择文件须同 hash/长度；原 note 不可在重传中编辑。首次 restart 的 expectedAggregateVersion 取同次 IG Query.aggregateVersion，expectedUploadGeneration 取 uploadState.generation，不能互相替代或猜创建版本；提交时竞态拒绝后回读。原重传 Command 响应丢失按同 key/原 payload readback/replay，已保存的 restartCommand 不替换 CAS 版本，绝不第三代/新 intake。

finite route 增量只有 `POST /bff/commands/integration.restart_customer_zip_upload/1.0` → 固定同形 `/api/commands/…`；EP entry/preparation 与 IG intake/query 使用 #258 已批准候选 token，PUT 仍唯一 `/bff/customer-intakes/{intakeId}/zip`。空 Scope 增量仅 EP find_preparation_enterprises 的明确 self 候选 profile；request/read/restart 都有完整 Scope/精确 target，并沿 IP 专用 bootstrap 或普通 Project 当前权限。Core/BFF 同步逐字 allowlist/schema/结果检查，未注册/未实现保持不可用，不扩大任意 dispatcher。当前运行代码仍只有 #266 三项 Query，不能据本段宣布路由可用。

所有失败保留原可读成功 facts；403/401 先清敏感缓存，重登后不把旧作者换成当前 Human。分析能力恢复后的推进是 EP owning 原 Process 的受权运维动作，首版不暴露“重新分析”或自动新 Run。已有资料不删除、不制造报告/PROJECT_START；完整失败 trace 与 NOT RUN 验收见 [#277 Delta](../decisions/preparation-entry-bootstrap.md#4-失败保留事实与有界恢复)。

## D14 / RD-01 公开接入与回执提案

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。当前工程外壳/开发样例不属于此设计的真实接入证据。公开操作与字段由 [EP owning D14](Module-Spec-002-EnterpriseProject.md#d14--rd-01-准备报告与启动字段提案)、[TE owning D14](Module-Spec-003-TaskExecution.md#d14--rd-01-preparationcontext分析与初轮范围提案)、[IG owning D14](Module-Spec-007-IntegrationGateway.md#d14--rd-01-zip-intake-与真实报告观察提案) 定义；[DTO 映射](../decisions/workspace-startup-review-v0.1.md#d14--rd-01-公开操作映射提案) 只组合许可结果。

UI 新建/已有客户都使用精确公开 preparation request；同名企业不合并，搜索只返回当前可见数据。上传一次 server-issued intake 的原 ZIP，Browser/BFF 不解压、不读取正文做分析、不指定 storage locator/Host path。总览基于 EP accepted report，突出 missing/read limits/protection conflicts/customer evidence，复制选定去重索取文本不自动发送；原位补充产生新输入/报告，不凭上传关闭事项。

保持三类紧凑启动摘要、依据展开、章节文件列表、默认不选和一个“确认信息与范围并开始”。必要值未知/冲突/超出结构支持集明确禁止 start；选文件使用精确 planRef 的整份内容，不传 changeId 子集绕保护。请求提交后逐步显示信息确认/start/scope owning receipts；STARTED 才显示 ACTIVE，RECEIVED 不展示执行中。所选集合阻塞时保留草稿，Human 可明确重选独立 eligible 文件；合法 start 后逐文件新阻塞不扩大到独立文件。

客户端将稳定 key/requestRef 与原 binding/选择关联，刷新先公开查询原请求；PENDING 不重发，UNKNOWN 核实，PARTIAL 仅续未完成步骤，STALE 保留草稿读取当前版本再显式新意图。已启动项目不回退 PREPARING。HTTP 503/空查询不是失败证明；过期 Session 重新认证后仍查原意图并重验权限。安全 HTML/Markdown 编码、下载授权、CSRF/Session 等沿 UI-DG-003；BFF 不接受公网 Actor/Decision，不落业务 Process、不调用未注册 Capability。

ACTIVE 首轮恢复仍使用同一范围面板，公开 get_startup_review 的 confirmationMode=INITIAL_SCOPE_ONLY 清楚表明原启动信息已冻结，按钮只确认当次整份文件范围。原 startup request STALE/阻塞不修改旧选择；未成功接收初轮时可显式新 intent，通过 project.request_initial_scope_confirmation/get_initial_scope_request/resume_initial_scope_request 回读，引用原 PROJECT_START。必要补料仅有界 INITIAL_SCOPE_RECOVERY 分析；TE 已接收首轮后关闭这条入口，不重复显示信息激活/启动，也不自动建下一批次。

## 可信 Human Session 与公开 Workspace 接入提案（#258）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / REGISTERED AND IMPLEMENTED (#266) / EXECUTION EVIDENCE IN ISSUE-PR / CONTROLLED KEYCLOAK JOURNEY AND CONTROLLED-CHROMIUM BUILT-BROWSER JOURNEY EXECUTED IN THE EXACT-HEAD PERSISTENCE GATE / ACTUAL CHROME-EDGE PLATFORM MATRIX, PRODUCTION DEPLOYMENT AND MANUAL ACCEPTANCE NOT RUN`。字段、封闭技术配置、Session转换、有限public operation/version表、CSRF/流/内容协议与TR-258验收trace唯一见 [Session Delta](../decisions/workspace-trusted-session-public-access.md)。已批准 UI-DG-003 架构/会话期限和当前布局不变，工程外壳匿名证据不代表本提案实现。

1. Browser Cookie只索引BFF技术会话；token exchange后通过Core受信身份bootstrap桥确认当前link/ACTIVE HUMAN，才能进入工作台。每次受保护请求Core独立校验token，IP形成真实Actor/当次Decision；Browser自报actor/Decision/actingFor/header覆盖拒绝。email/Realm Role和BFF缓存摘要不赋权。
2. BFF技术Session只存认证字段，业务草稿/原意图/Receipt由owner保存；未经公开能力保存的页面草稿明确“未保存”，不承诺重启/跨设备恢复。单次登录交易绑定发起Browser，多Tab交易独立、并发callback只一winner；成功与安全error回调沿Delta封闭参数表接纳并精确验证响应iss，有限session_state仅校验后丢弃，不代替state/nonce或赋权；缺/错/重复issuer拒绝且零新Session。refresh串行，logout/过期/重启失效后不被迟到refresh复活。
3. 目录必须来自拟 `project.find_workspace_projects@1.0` 的当次受权项目摘要；它与per-project EP/TE看板分别授权。合法 `OK + items=[] + nextCursor` 是未完成中间页，按绑定游标继续逐页读取；零累计项仍为LOADING，有卡片则保留READY及未完成提示。仅同一有效游标链枚举完整、末页省略nextCursor且累计可见项为零才显示EMPTY，空末页保留之前非空项；不得突破200项/5秒单请求预算，每页沿EP当前授权/水位规则，变化拒绝后从首屏重取。无目录handler/注册则显示服务不可用，不从原型、旧cache或BFF数据库扫描构造项目集合。多Tab按请求精确Scope工作，无Session全局activeProject。
4. 公开命令输入为共享Envelope的transport projection；Core追加受信Actor/Decision，保留原target UUID、key、payloadHash/CAS。逐字allowlist只消费已注册owner版本；D14proposal缺Registry/handler仍不可用，不调用内部start/source/run或任意Catalog dispatcher。
5. ZIP仅原流→IG issued intake，大小/累计bytes/backpressure/期限在BFF和IG各自限制；BFF不解包/分析/写对象存储。依据只读EP受权摘录/QG exact Evidence。当前无D14原件bytes transport，下载保持不可用；有owner精确版本/hash/当前权限与公开stream才能单独审查启用，不将locator自行变URL。
6. 原CREATE request预分配target UUID，稳定key=`operation:1.0:targetUuid`；安全request页面不含客户正文/token。response丢失/401/重启后从Core回读原request/key；新认证只改变当次权限证明，不改原payload/历史Actor，禁止新键自动重发。PENDING/UNKNOWN/PARTIAL/STALE保留真实成功steps，COMMITTED/202不表示running。
7. 所有POST Query/业务写/上传/登出/技术活动要求精确Origin/Host/CSRF/Content-Type；只有绑定的OIDC callback例外。受保护响应no-store，安全Markdown/CSP与遥测allowlist沿Delta；Scope/Principal变更与失权清DOM/cache/objectURL，generation检查迟到响应、multiTab失效与bfcache恢复。
8. 独立设计Review和人类技术批准、actual deployment lock/Registry/当前权限/公开HTTP与D14依赖分开确认。#266 已执行受控 Keycloak、真实公开 HTTP、一次性 PostgreSQL 与受控 Chromium 制品旅程（见本节实现事实）；生产部署、Host/Runner、实际 Windows/macOS Chrome/Edge 平台矩阵与独立人工验收仍 NOT RUN，不因 docs gate 或受控证据宣告生产可用 Session 或任务 READY。

实现事实（#266）：上述 1–8 条的 BFF/Web 路径、封闭 Core 技术配置（`ZHIJU_WORKSPACE_TRUST_CONFIG`）与部署锁定值（capability code 映射、`ZHIJU_WORKSPACE_BOARD_CURSOR_KEY`、`ZHIJU_WORKSPACE_BOARD_POLICY_REFS`）已实现并有确定性本地、一次性 PostgreSQL、真实公开 HTTP 与 Chromium 制品旅程证据。首版 `execution.get_task_board_slice@1.0` 仍要求部署为该 Project 配置精确 Board Policy 版本引用：未配置时 owning 入口按既有语义返回 `DEPENDENCY_UNAVAILABLE` 并由 UI 诚实显示不可用，不伪造看板数据；`project.get_project_board_slice@1.0` 只需该 Project 的独立 board 读授权。目录页的 EP 水位是首屏已返回摘要观测摘要（`servedObservationDigest`）的 48 位投影（`enterpriseProjectWatermarkSequence`），属读取观察，不是全局计数、未授权项目计数或完成度。真实受控 Keycloak 26.7.0 旅程（隔离 realm/client/user 的 PKCE 登录 → callback `iss` → refresh → admin-API 密钥轮换 → 错 aud/azp/iss 拒绝）与受控 Chromium 制品旅程已在 exact-head persistence gate 通过（`tests/persistence/workspace-controlled-keycloak.test.ts`、`workspace-built-browser.test.ts`；证据见 PR #273 与本 Issue 评论）；生产部署、实际 Windows/macOS Chrome/Edge 平台矩阵与独立人工验收仍 `NOT RUN`。

## 工作台页面实现边界（#281）

沿已批准产品 §4.1 与工程基线落实共享 React 工作台：顶部紧凑项目进度、项目选择与最近访问，下方“需要你 / 推进中 / 待开始”，已完成与次要入口默认折叠。展示分组不新增 Core 状态；卡片保留具体原因、动作和来源提供的精确项目/任务/报告/候选引用。任务完成、候选就绪、批准与项目交付分别表达。

生产继续只使用 #266 的授权目录与显式选中项目的 EP/TE 看板。数量标明已读取范围、枚举完整性及各来源观察水位；不推算跨项目总数、候选数量或项目完成百分比，不从 Task ID 构造 scope request。缺少公开读取或尚未交付的目标页面使用可导航的不可用边界，不能模拟上传、执行、保存、批准或交付成功。目录授权不代替看板授权。

页面展示模型与动作类型仅属于 Experience。隔离开发 adapter 使用同一工作台组件提供多项目、混合状态、空/失败及候选/报告更新场景，生产构建剔除 adapter。原卡更新不跳页、不抢焦点、不覆盖输入或当前精确版本。筛选、展开、阅读位置与最近访问仅保留在当前有效会话的内存；URL 只保存安全项目/对象标识，历史记录不保存业务 payload。身份失效清理页面内存；切项目卸载旧看板，既有 generation/Scope 防迟到机制保持。

文件检查、项目交付与任务详情边界均是页面导航，不增加公共操作、业务所有权、通知服务或持久最近访问能力。既有工程样例的报告/启动流程继续独立于真实服务验收；实际 Chrome/Edge 平台矩阵、Runner、生产服务与人工验收不由页面证据替代。

## D12 / Q11 项目交付与原意图恢复提案（#260）

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。owning字段/Hash/操作候选见 [REL §14](Module-Spec-006-ReleasePublication.md#14-d12--q11-项目交付批次与受控导出提案260)，跨轮次/失败trace见 [Spec Delta](../decisions/project-delivery-controlled-export.md#5-设计-trace-与必要反例)。已批准 #project-delivery/#delivery/#execution-review 布局与中文产品文案保留，原型sessionStorage/合成ZIP不成为生产事实。

| 入口/事实 | 呈现与操作 | 权威边界 |
|---|---|---|
| 单份审批 | 当前精确文件/版本的APPROVED决定权威COMMITTED并回读后自动接续下一份待检查文件；其他角色仍待办则明确显示 | 按Quality角色/职责分离；REJECTED/拒绝/UNKNOWN不前进，UNKNOWN先回读原request/key |
| 准备项目交付 | 固定高度章节清单/详情、搜索/资格筛选，汇总所有轮次，初始不选；每行保留原轮次/报告及阻断原因 | Candidate Query的EXPORT_ELIGIBLE才可确认；内部获批、Page READY及原型fixture不等于发布就绪 |
| 核对本批版本 | 一个确认对话显示全部exact版本/配套及接收范围；不暗选新文件、不替换Hash | 单文件Release Human授权若未满足，显示“待发布授权”，不能复用内部批准按钮代签 |
| 确认成功 | “本批版本已确认，待生成交付包” | CONFIRMED不等于AVAILABLE；生成请求响应与包可用分别回读 |
| 生成中/失败/UNKNOWN | “正在生成交付包”/“交付包未能生成”/“生成结果待核实”；已有包保留 | 只恢复原Batch/PackageRequest/Attempt，不自动新建Batch或改版本；技术失败不会重置独立文件 |
| 选择变化/撤销 | 失效行明确“版本或交付条件已变化，请重新核对”；保留其他有效选择，由Human清除或重新选择 | 服务端重验原集合，旧确认/包不可变；新候选不自动替换仍有效批准 |
| 已请求下载 | Browser主动请求与服务端接受请求可分别标明，缺响应时“下载结果待核实” | a.click/HTTP accepted不证明保存成功；没有请求Receipt时只显示本地请求未核实 |
| 服务端流 | 可显示“服务端已开始下载响应”/“服务端已发送下载响应”/“下载响应中断” | 只映射可靠持久化ResponseObservation，完整响应也不标“已保存”“已发送”“客户已收到” |
| 过期/失权 | “下载链接已过期”/安全的“当前无法下载”，有权时重新请求同一包 | 新Decision/许可，不延长旧Token，不从对象locator拼URL；禁用入口不替代Core授权 |

未提交selection只算页面草稿；没有owner保存能力不承诺跨设备恢复。CREATE前固定operation/version/target UUID/key/payloadHash与exact Scope；response丢失、401或重启后先登录再回读原request/Command Receipt，不换key自动提交。后续新草稿不加入旧intent，原Actor不因新Session改写。已保存Batch/PackageRequest/DownloadRequest可在当前权限下恢复，读回COMMITTED/UNKNOWN/FAILED/STALE的实际边界，不以toast推定成功。

下载只消费owning公开能力批准后的受控短期stream，BFF传bytes/backpressure，不生成ZIP、拥有Batch或调用存储。Session/Project/Principal变更清理敏感DOM/cache/objectURL及许可；迟到响应需按request generation与Scope检查，不带回失效主体的内容。短期Token/URL不得进入持久storage、分享链接、日志/telemetry。

桌面批准限制和手机查看/反馈/包详情沿已批准原型；不新增移动端审批。响应式滚动、键盘确认/焦点回收及真实Chrome/Edge验收分别验证。无发送人/时间登记、手动sent marker、客户验收入口或自动项目完成；复制或下载的旧bytes无法回滚，不把本系统观察当外部渠道事实。

## Markdown 检查、单意见区与草稿接续提案（#259）

状态：T2 / APPROVED DESIGN；#279 已实现精确 Revision 阅读/变化导航/下载切片，其余提案仍 NOT IMPLEMENTED。沿用[已批准交互](../decisions/workspace-mvp-human-agent.md#44-已确认的逐文件检查交互)，字段/流程见 [Markdown Delta](../decisions/markdown-file-feedback.md)。不新增聊天助手、逐change输入框、批量改稿或第二次“开始修改”动作。

首份文件在无Root/Revision/constraints时使用TE §28.0的确认前入口：在已有整份计划核对页显式prepare，按原request/key/hash只读查询，展示完整基线Canonical/nodeMap、精确来源/Hash、完整change/KEEP/allowed/protected提案和当前资格。MAPPING_REQUIRED时在同核对页明确已有位置映射后以新准备意图提交，READY且mayConfirm才确认exact proposalRef；失权、错Scope/hash、过期或未知准备状态不得盲确认。prepare/get/confirm都不自动generation或dispatch，确认后另显式生成。此时不调用要求current Revision的review_basis，也不暴露service producer或以Browser Diff代替完整映射。

1. 固定高度桌面文件列表/阅读区/唯一意见区，窄屏在文档与意见视图切换。server精确file directory支持200+文件、搜索/状态筛选与完整游标链；未加载页不能作分母。变化默认显示一处，36变化/9章能上一处/下一处/章节展开直接跳，保留当前展开、阅读与意见。全文/来源/摘要按需切换；宽表横向滚动全部列，空cell/0/复选符号/标题编号/签批不丢失。
2. 内容来自ART exact Revision/Hash+server change-directory/Location。源行号、DOM/highlight、chapter label只展示，不能提交其为stable identity或批准证据。新增无旧位置、删除保留旧版入口、移动给两端；旧引用REMOVED/AMBIGUOUS醒目保留，不自动移附近行。切新版后需Human核对新位置、显式引用/移除才提交。
3. 本文件“提交并修改”冻结reviewBasis/current+原文/位置/附件、原request target/key/payloadHash。普通edit看旧版时新current已到→STALE且保留草稿；一份Markdown建议保留明确B/M/S，Human切到并核对S后在同意见区明确复核。上传只显示intake真实状态，不直接改Revision/批准，也不从filename猜base。跨文件/保护例外/不明确范围返回原意见区具体澄清，不自动执行。
4. 草稿自动存TE本人技术记录，权威Receipt匹配editId/hash才“已保存”；显示保存中/未保存/冲突/UNKNOWN。刷新/关页/换设备恢复同file/base、附件和pending snapshot；两个设备CAS冲突保留两个草稿及显式选择，不自动merge。本人撤权/登出清DOM/cache，server历史按retention保存，不能由BFF Session/sessionStorage伪装跨设备成功。
5. 提交前private pending snapshot先保存，提交只发送一次。原提交/回执为只读折叠信息，新typing/附件写next-round draft；处理报告和部分未处理项在同区显示。UNKNOWN状态位于意见区顶部；最多3次/累计10秒查同一次原request，刷新不重置，随后“重新查询”只读不重发；无权/超时/错context/NOT_FOUND不显示失败或未接收。核验未定时禁重复提交/批准，可继续写未提交稿。
6. RECEIVED/PENDING/真实RUNNING/accepted当前候选/导出状态分别展示，不从点击/202/日志推断运行/完成。PLAN_OBJECTION只暂停该文件未来安排；other files候选/私稿/批准保留。新候选返回仅更新提示和文件计数，当前页/精确阅读版本/滚动/输入不变，主动切换后重核草稿和位置再显式提交。批准成功才按已有规则进下一份；新候选/反馈回执不触发批准。
7. Markdown下载必须ART registered Representation与即时授权，ticket放header、短时且不持久化；raw proposal/source下载与受控成果明显区分，未注册public stream则功能不可用。CSP、安全编码/no-store、当前Session/CSRF/Scope、迟到响应generation与失权清理沿既有基线。Quality ReviewIssue/Gate/RAS/Approval/Release分别显示，不把HANDLED或看完changes当已批准。

所需BFF仅finite已注册transport projection和受权Query组合；service-only producer/acceptance/render不进Browser allowlist。原型sessionStorage/36-change导航/UNKNOWN演示仅设计输入；真实server persistence、OIDC/HTTP/browser矩阵、Host/Runner及独立人工内容验收UI-MF-*均NOT RUN。


## 已实现的精确 Markdown 阅读切片（#279）

`MarkdownReviewPage` 为 #279 与 #286 共用的类型化展示组件，承接已批准页面的导航、完整正文与单一意见区；`MarkdownReview` 适配 owning 内容/变化、当前会话边界与下载动作。#286 在同一组件继续完善页面能力，不另建生产/演示审阅页，也不以页面工程证据替代 #279 的真实服务验收。

已实现受保护深链接 `/projects/:projectId/artifacts/:artifactId/revisions/:revisionId?binding=...`。binding 为已合法读回的 exact Artifact/Revision refs、可选明确 baseline 和 RepresentationRef 的 base64url 编码，不含票据/凭证。Core owning 读重新校验全部身份，不因 URL 声明获得权限。该入口不依赖未实现的 TE 文件目录或成果生成；无注册表示时明确下载不可用。

页面沿用已批准固定高度章节目录、单处变化/全文阅读和单一意见区：显示完整 server 分母与已加载数，支持章节搜索、展开直达、前后导航；新旧内容来自各自 exact Revision，宽表保留全部列、空格与 0。当前页版本不随候选更新自动替换。意见只留在当前受权页面，明确未保存，离开链接/关页提示；反馈提交、跨设备草稿和批准均禁用。导航/切全文/窄屏切意见保留本页输入。

BFF 只新增四个 Human Query allowlist 与固定同源 Markdown GET stream，SERVICE render/register 不在公共 allowlist。下载经 ticket、CSRF、当前 Session、可信 peer、Core 当前权限与完整 checksum 核验，浏览器收齐并核 SHA-256 后才交给保存流程。所有层 no-store/nosniff，票据只进 header/内存，不进入 Link、storage 或日志。Principal/Scope/session generation、登出、bfcache 与失权清理沿 #266；迟到响应不恢复旧内容，objectURL 在清理时撤销。

分页或下载的鉴权相关失败须复核全部保留的 exact Revision（包括基线），不能仅凭当前版本可读而保留已失权的旧正文或 before-values。确认任一来源读取权丢失时清空比较页和意见。资源 403/404 本身不触发 Session 重载；清理后停在稳定不可用状态，显式重读重新授权，会话失败提供显式会话检查入口，避免同一拒绝绑定自动循环。

受控 built Chromium 验收覆盖 36 项/9 章、完整 12 列表格与两次相同已登记字节下载。Windows/macOS Chrome/Edge 全矩阵、生产环境与独立 Human 内容判断仍 NOT RUN，不以自动化读取/下载替代批准。

## 新建项目与首轮 ZIP 页面组件（#282）

页面工程复用同一 React 组件与 typed presentation actions，不注册 wire Contract。客户搜索必须显式选择独立 ID，NEW 原位切换；匹配原意图的创建回执才进入精确项目。ZIP 页固定项目，跨项目入口先显式选择；本地选择只保留文件引用/名称，不读取、解包或分析。无公开创建/上传能力时生产明确不可用。

提交冻结 ZIP 与说明；重复点击仅一个意图。状态由 adapter 提供，接收、准备、等待安排、Runner 分析、报告核验、报告就绪、失败和 UNKNOWN 分别显示。后台更新不导航。准备失败允许替换，分析失败只有 adapter 明确许可才显示重试；原输入与失败历史保留。固定开发场景显式带入，任意本地 ZIP 不返回合成报告；新建演示项目只到等待安排，不借用其他项目报告。状态仅在当前身份边界内存保留，不承诺刷新/跨设备保存；退出/身份变化清理，离开项目的迟到选择与响应丢弃。真实服务、Runner、持久化、完整平台矩阵及人工验收仍 NOT RUN。


## #285 文件进度与轮次导航

共享 React 执行页消费 typed presentation rounds/actions，不新增公共 wire contract。只展示确认范围成员，按 supplied 等待、实际处理中、待检查、失败、信息待核验状态统计；精确候选入口必须同时匹配项目、轮次和文件，缺失或错上下文时不制造检查链接。范围、报告版本、最新更新时间、失败原因与历史原位保留，不根据经过时间推导候选、百分比或完成时间。

单文件重试只在 supplied 许可且 adapter 可用时提供；点击冻结原 intent 并显示 pending，UNKNOWN/错回执保留原意图，只允许原请求查询，不能重复提交。接受回执不表示已执行；新进展仅由 supplied 文件事件更新，其他文件和旧候选不变。各轮搜索、筛选、滚动与次级展开状态保存在当前身份边界内存；新候选不导航、不抢焦点、不替换审阅版本或草稿。明确的轮次选择才导航到该精确请求。候选返回轮次与轮次返回工作台的地址分别保留，打开候选不能覆盖工作台项目/筛选上下文。

复用既有 shell/session 清理。生产缺已注册授权进度/重试能力时，同一页面明确不可用且无样例回退；开发 adapter 仅在 fixture 构建隔离，显式事件复用页面，不制定 Runner、调度或轮询策略。固定候选以不可变合成快照复用既有 MarkdownReviewPage，实际正文读取、保存、反馈及批准接入仍属于 owning 后续工作；阅读期间新候选到达不更换当前快照或意见。不新增浏览器客户数据/凭据存储。真实服务、Runner、重试授权、服务器持久化、跨设备和人工验收仍 NOT RUN。

## #283 分析总览与上下文补充页面

共享 React 页面接受 typed presentation report/actions，保留精确项目、报告与版本。总览同时呈现客户需补充、顾问需判断、拟交付文件、报告依据；桌面两行两列，详情清单/内容各自滚动，窄屏切换清单与单项详情，并在同页切换报告阅读与唯一意见区，避免提示和输入挤占阅读空间。索取按报告提供的 key 去重，保留缺失、读取受限和事实问题差异；全部复制不修改逐项选择，预览可编辑，剪贴板失败提供手动复制。复制不发送、不标记交付。

唯一上下文输入区分别保留客户补充、顾问判断和精确单文件计划意见的内存草稿。提交冻结报告、事项、文件、保护事实、依据、原文和附件名称；下一稿编辑不改变快照。pending/不可用/失败/UNKNOWN 原位显示；反馈不关闭事项、不确认新资格、不批准或执行文件。仅 adapter 提供的单文件待复核展示影响该文件选择，不扩散共享 action 的其他文件。新报告显式应用后回到相同四区并显示简要变化；详情和主动查看的历史不静默替换，历史只读。旧草稿保留并要求重新核对，不能静默改绑。关联依据按草稿原项目、报告和版本解析；原报告不可取得时明确显示依据不可用并提供原报告入口，不从新版补齐同名 evidence ID。历史模式允许切换客户、顾问与单文件计划的原上下文，原草稿文本可聚焦、选择和复制，但不能编辑、附加资料或提交。

生产保持 #266 身份/Scope 清理与真实公开读取边界；没有已注册报告/反馈能力时显示不可用，绝不回退样例。开发 adapter 单独隔离，复用已检入匿名报告，不分析本地附件；只有显式固定补充场景可提供固定复核报告。页面状态仅当前会话内存，不新增 browser storage、公共接口、业务策略或迁移；真实服务、Runner、服务器草稿、平台矩阵与人工验收仍 NOT RUN。
