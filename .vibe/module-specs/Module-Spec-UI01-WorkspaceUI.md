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
