# Module-Test-UI01-WorkspaceUI

2026-10-31 测试范围更新：用户已确认移除退出新版 MVP 链路的旧平台专用持久化测试，见 [当前验证范围](../high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由)。本文件的旧数据库 PASS/文件路径保留为历史证据，不代表当前 full 仍执行这些场景。普通 Unit/Contract 继续保留；重新接入本模块前须恢复适用持久化验证。共享 OIDC/会话安全继续验证，受控 Keycloak 数据库旅程改由 MVP01 拥有。

版本：v0.1
日期：2026-10-08
状态：`EXPERIENCE TEST BASELINE / DESIGN VERIFIED / ENGINEERING SHELL IMPLEMENTED / FIXTURE AUTOMATION / REAL INTEGRATION AND MANUAL NOT RUN`

对应规格：[`Module-Spec-UI01-WorkspaceUI.md`](../module-specs/Module-Spec-UI01-WorkspaceUI.md)。本文件记录 Workspace UI 的 Unit、Contract、Browser E2E、Security、Accessibility 与 Manual 用例。Business Core 的领域、API、Persistence 和跨模块测试继续由对应 Module Test 与 [`08-verification-baseline.md`](../high-level-docs/08-verification-baseline.md) 拥有。

## 1. 结果口径

- `DESIGN VERIFIED`：测试矩阵与权威边界静态一致，不代表前端或 BFF 存在。
- `NOT RUN`：实现、浏览器、环境或人工步骤尚未执行。
- `PASS`：必须记录精确 commit、环境、浏览器、输入、预期、实际和证据。
- Fake OIDC、Mock API 或组件 story 不能完成真实 Session、公开 API、跨 Scope、Browser E2E 或人工验收 Gate。

## 2. 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| UI-D-001 | Design | Implementation Plan、Architecture、Deployment Baseline、Workspace UI Spec/Test | UI 为 Experience Module；IM-06 后启动；不拥有业务 Contract/Schema/Repository；IM-09 依赖 UI Gate | 文档路由、职责、依赖与状态口径已静态对账 | `DESIGN VERIFIED` |
| UI-U-001 | Unit | Projection `last=41 target=44 status=PAUSED` | ViewModel 为 `STALE/PAUSED`、lag=3；页面不显示 READY/完成 | 无 ViewModel 实现 | `NOT RUN` |
| UI-U-002 | Unit | Baseline 同时含 PRESENT、UNKNOWN、NOT_PROVIDED、MISSING_CONFIRMED | 四种值显示不同文本/图形/辅助语义，不折叠为空白 | 无 ViewModel 实现 | `NOT RUN` |
| UI-U-003 | Unit | Session principal 为 AGENT/Service/actingFor，构造 Human-only Approval action | UI 可隐藏/禁用入口但仍提交时由服务器拒绝；不得把 actingFor 显示为 Human 授权 | 无 UI/BFF 实现 | `NOT RUN` |
| UI-U-004 | Unit | Command 返回 `CONCURRENCY_CONFLICT`，权威 aggregateVersion 已变化 | 不自动覆盖/重试；重新加载 exact state 并要求 Human 重新确认 | 无表单实现 | `NOT RUN` |
| UI-C-001 | Contract | BFF 请求跨模块 Overview、Approval/Release readiness | 只调用公开 Query/API；无 internal import、Repository、跨 Schema SQL 或私有业务 Command | 无 BFF 实现 | `NOT RUN` |
| UI-C-002 | Contract | ApiError 含 safe code/retryable 与敏感 internal details | 页面保留公开 code/safe message；敏感 details 不进入 DOM、日志或 telemetry | 无 Error Mapper | `NOT RUN` |
| UI-C-003 | Contract | 无/错误 CSRF、错误 Origin、过期 Session、Cookie 缺 Secure/HttpOnly/SameSite | 状态改变请求拒绝；Session/Token 不泄漏；需要时进入 reauth | 无 Session/BFF 实现 | `NOT RUN` |
| UI-E-001 | Browser E2E | 测试 Human 通过 OIDC 登录、进入授权 Project、登出、再次访问 Deep Link | 登录成功；Context 精确；登出后 Session 失效并要求重新认证 | 无 Browser App/OIDC 环境 | `NOT RUN` |
| UI-E-002 | Browser E2E | Enterprise A/Project A Human 打开 Project B Deep Link，并尝试复用缓存返回 | 服务器安全拒绝；不泄漏 Project B 存在性；Project A cache 不串 Scope | 无 Browser App/API E2E | `NOT RUN` |
| UI-E-003 | Browser E2E | 脱敏 Project → Baseline → Gap ACCEPT → DeliveryPlan APPROVE → Artifact Human Edit → Review/Approval → Release | 每步调用公开 API、保存 exact refs/hash/version；Human Edit 创建新 Revision；普通附件不形成 Formal Release | 跨模块 Browser E2E 未实现 | `NOT RUN` |
| UI-E-004 | Browser E2E | Command 提交后网络中断，Core 已提交但 Browser 未收到响应 | 页面显示 UNKNOWN；使用原 idempotency key reconciliation，最终只显示一个业务事实 | 无 Browser App/reconciliation | `NOT RUN` |
| UI-S-001 | Security | 存储/反射型脚本、恶意文件名、短期 URL、token、External ID、客户正文进入页面与 telemetry 探针 | 内容被编码/净化；CSP 生效；敏感值不进入 storage、DOM attribute、日志、analytics 或 screenshot | Security Test 未运行 | `NOT RUN` |
| UI-A-001 | Accessibility | 仅键盘执行登录后导航、Gap 决策、Diff、Approval 确认与错误恢复 | 可见 focus、正确 name/role/value、错误摘要与焦点回收；颜色不是唯一状态编码 | 真实业务 Accessibility Test 未运行；UI-DG-002 目标已批准，外壳键盘/自动诊断单列 | `NOT RUN` |
| UI-M-001 | Manual | 用户在批准浏览器上执行脱敏“采购控制程序”Workspace Runbook | 完成登录、Project 隔离、Baseline/Gap/Plan、Revision/Diff、Approval/Release、Task/Run/Audit；记录实际结果和剩余风险 | 未准备可执行 UI/Runbook | `NOT RUN` |

## 3. 自动化 Gate

实现后至少提供：

1. ViewModel/状态映射 Unit Test；
2. 生成公开类型与 BFF API mapping Contract Test；
3. OIDC/Session/CSRF/Origin/Cookie 安全测试；
4. 真实浏览器 E2E，覆盖授权与跨 Scope 负向路径；
5. XSS/CSP、敏感信息、重复提交、多 Tab、断网/UNKNOWN/reconciliation；
6. approved browser/viewport matrix 与可访问性自动检查；
7. 构建制品、依赖漏洞、source map、配置和运行时 header Gate。

Browser E2E 只能使用公开 API 或受控 Test Fixture 入口，不得直接写数据库制造中间业务状态。涉及 PostgreSQL/Provider 的前置事实必须由 owning module 的公开 Capability 或经审核 fixture 建立，并明确受控边界。

## 4. 手动验收记录要求

每次人工验收记录：

```text
commit / build artifact
environment / deployment topology
browser and viewport
test principal / enterprise / project fixture
scenario input
expected output
actual output
sanitized screenshot or trace
PASS / FAIL / BLOCKED / NOT RUN
remaining risk
reviewer and timestamp
```

不得在截图、HAR、console、trace 或录屏中保留 token、Cookie、External ID 原值、客户正文、短期下载 URL 或未脱敏 Canonical Payload。

## 5. 当前结果

- 15 个 Workspace UI 场景已定义：Design=1、Unit=4、Contract=3、Browser E2E=4、Security=1、Accessibility=1、Manual=1。
- `UI-D-001` 为 `DESIGN VERIFIED`；其余 14 个实现/自动/人工场景均为 `NOT RUN`。
- 工程外壳已有构建、内容边界、架构反例与受控 Chromium 测试；匿名截图仅保留在忽略的 `test-results/`。不创建真实测试身份，不记录 HAR/敏感 trace；执行证据归 Issue #252/PR，原 14 项真实实现/集成场景不因此升级。

## Workspace MVP D14：项目资料准备与正式启动

状态：`D14 / INITIALIZATION DIRECTION USER APPROVED 2026-10-08 / FIELD CONTRACT CLOSURE PENDING / NOT REGISTERED / NOT IMPLEMENTED`。用户批准的范围、主工作区依据及兼容规则见[正式提案 §4.7.1](../decisions/workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。本节同步新增设计约束，不宣称本分支较早正文的实施状态等于当前 main，也不改变已发布接口。

新增矩阵是方向批准后的前瞻要求；2026-10-08 用户明确“保留当前布局”，该选择确认 UI-D14-001 的交互布局基线，不将正式实现/验收结果改为 PASS。固定匿名原型及窄检查不证明公开 API、真实持久化、Runtime 或独立人工业务验收。执行证据按项目规则进入对应 GitHub Issue/PR，不在本表伪填 PASS。

| ID | 输入 | 预期 | 正式实现/验收结果 |
|---|---|---|---|
| UI-D14-001 | 首轮范围面板、三类启动信息、无勾选文件 | 摘要紧凑，依据可展开；默认不选，一次明确确认信息与完整范围 | `NOT RUN` |
| UI-D14-002 | 必要产品信息缺失 / 职责保护冲突 | 项目启动缺口突出并禁用开始；选择保留，文件级冲突另整份等待 | `NOT RUN` |
| UI-D14-003 | checking / failed / UNKNOWN / stale 与刷新 | 阶段清楚；同请求回读；失败与报告更新保留选择，重看精确版本再确认 | `NOT RUN` |
| UI-D14-004 | 同项目隔离、受控决定与旧候选/批准/交付包 | BFF 不写多模块或产生事实；新回执不修改其他范围及历史 | `NOT RUN` |
| UI-D14-005 | 桌面与窄屏、键盘、长文件清单和恶意文本 | 面板内部滚动、底部动作可达、焦点可见；来源/正文编码，确认不能靠颜色 | `NOT RUN` |

## UI 首版工程验收增量（已批准设计，验证未执行）

对应[工程提案](../decisions/workspace-ui-engineering-baseline.md)及 UI01 工程 Spec Delta；本表定义真实集成验证，不将工程外壳开发样例测试算作真实服务/完整平台或人验。UI-ENG-001 的工程部分由下方 UI-SHELL 场景覆盖，其余真实集成状态继续为 `NOT RUN`。

设计 DTO 精确排除在生产应用 lint 外，仍以独立 TypeScript 与 Schema/样例定向检查验证。该排除不扩展至 `.vibe` 全目录或生产 contracts，也不替代下表任何正式验收。

| ID | 层级与触发条件 | 必须验证的结果 | 当前结果 |
|---|---|---|---|
| UI-ENG-001 | Build/Boundary：生产 build、直接业务私包导入、缺配置/登录失败 | 静态 Web 与 BFF 独立构建；私有依赖/凭据不能进 Browser；无 mock 自动 fallback；页面 fallback 不吞 BFF/API/资产 404 | `PARTIAL`：工程部分见 UI-SHELL-001/003/004；真实登录失败/业务服务接入 `NOT RUN` |
| UI-ENG-002 | Session：真实登录/重放回调/错 nonce、多 tab refresh、BFF 重启 | 交易与发起浏览器绑定、single use；refresh 串行；重启要求重登，原任务/草稿从 Core 恢复，不重复发起 | `NOT RUN` |
| UI-ENG-003 | Security：缺/错 CSRF、Origin、Host，过期/登出/撤权 | 写操作均拒绝或重新认证；后台轮询不延长空闲期；Cookie 属性符合批准方案，服务端与浏览器日志不泄露回调/token | `NOT RUN` |
| UI-ENG-004 | Cache：切用户/Project 时旧读取迟到，新版本/报告到达 | 旧响应不能重填已清理缓存；Scope 精确隔离，失权内容不作为离线副本显示；当前版本/页面不被强制切换 | `NOT RUN` |
| UI-ENG-005 | Recovery：提交已成功但回执断网；启动成功/范围失败 | UNKNOWN 回读同一请求/稳定键；PARTIAL 保留已成功事实；无自动重发/假完成，恢复仍重新授权 | `NOT RUN` |
| UI-ENG-006 | Real chain：脱敏客户 ZIP、固定模板、一个真实受控 Runner Profile | 顾问可接收资料/看接纳报告、核对必要启动信息、默认不选后选整份文件、显式确认并看真实回执/进度；所用引用/输入/报告/版本可追溯 | `NOT RUN` |
| UI-ENG-007 | Content/Scale：200+文件、30+变化、宽表、恶意 Markdown | 服务端分页与总数/完整性正确，不全量预取正文；上下文可导航，原始 HTML/恶意链接不能执行，CSP 与渲染方案可共存 | `NOT RUN` |
| UI-ENG-008 | Browser/Accessibility/Manual：实际批准 Chrome/Edge 与平台/视口 | 深链接/历史/键盘焦点/错误恢复正确，窄屏可查看反馈；记录实际稳定版本；独立用户完成真实首条链路，自动模拟/axe 不替代人工验收 | `NOT RUN` |


## 工程外壳的首版验证

对应 [UI01 首个工程交付目标](../module-specs/Module-Spec-UI01-WorkspaceUI.md#首个工程交付目标)。真实会话与业务接入的既有场景继续保持独立，不由开发样例测试替代。

| ID | 输入/触发 | 可观察验收 | 当前结果 |
|---|---|---|---|
| UI-SHELL-001 | 干净安装批准 lockfile 后构建 Web/BFF 与 Core | 两个应用可独立构建，Core 既有构建仍通过；正式构建无 token/凭据/私有业务包 | `PASS`：#252 的配置门禁与受控匿名制品检查；执行证据见 Issue/PR |
| UI-SHELL-002 | 明确开发模式与匿名报告，执行首轮导航、刷新、返回与加载/失败 | 已批准布局与默认不选/显式确认保持；刷新/历史与错误可恢复，样例动作不会伪称真实执行 | `PASS`：#252 的配置门禁与受控匿名制品检查；执行证据见 Issue/PR |
| UI-SHELL-003 | 生产模式缺 Session/公开服务或注入开发开关 | 业务动作安全拒绝，无假身份/假回执或 mock fallback；配置错误有可理解反馈 | `PASS`：#252 的配置门禁与受控匿名制品检查；执行证据见 Issue/PR |
| UI-SHELL-004 | `.tsx` 引入禁止业务/私有依赖，应用 manifest 四类 dependency 字段中的禁止名称、npm/workspace 别名、file/link 与其他路径/来源，以及精确版本和 BFF `catalog:` 的允许对照 | 架构检查同时拒绝禁止依赖名称及声明目标，允许批准依赖；未遗漏 React 源码或 apps manifest | `PASS`：#252 的配置门禁与受控匿名制品检查；执行证据见 Issue/PR |


### #252 工程外壳可复现检查与证据边界

`full` 包含既有 Core 普通与 PostgreSQL 回归，以及 `workspace:check` 的两个独立应用构建、生产 bundle/HTTP 拒绝、生产 fixture mode 注入、开发制品生产服务拒绝和实际构建应用 Chromium 旅程。新增普通测试覆盖安全 Markdown 与 TS/TSX/manifest 的允许及禁止反例；CI 安装精确 Playwright Chromium。

开发浏览器场景覆盖 1440×900 桌面、360×800 窄屏及 320 CSS px reflow、默认不选、缺必要信息保留选择、显式整份确认、精确报告/请求、刷新/Back/Forward、迟到版本提示、加载/空/失败恢复、键盘/焦点与报告/范围页 axe 诊断。截图仅为合成资料。所有执行结果、exact revision、实际浏览器版本与未执行项在 Issue #252/PR 保存，不在此新增执行日志。

真实 OIDC、公开业务 HTTP、Runner、生产、Windows/macOS 最近两版 Chrome/Edge 支持矩阵、完整 WCAG AA 与独立人工业务验收仍为 `NOT RUN`。旧真实 UI-E/UI-S/UI-A/UI-M、D14 及 UI-ENG-002–008 场景不由外壳演示代替。

## #277 两字段与原 intake 恢复设计场景

状态：`DESIGN APPROVED / NOT RUN`。字段见 [UI #277](../module-specs/Module-Spec-UI01-WorkspaceUI.md#277-两字段创建与单次提交交接提案)。实际 Browser/publicHTTP 与独立顾问验收须另行取证；原型计时器不算真实Receipt。

| ID | 输入 / 故障 | 预期可见行为与边界 | 实际 / 结果 |
|---|---|---|---|
| UI-277-001 | 受权NEW与EXISTING两字段创建、公司entryBinding、Project/access成功 | 只有客户/标题字段；无员工preset/memberPolicy/runtime设置；进入固定Project ZIP页，目录/board权限分别成立；无start | 未执行 / NOT RUN |
| UI-277-002 | ZIP+note一次提交、policy tuple取EP原request公开结果、仅custody/Task/analysisRequest成功、合法unsupported entry | 无隐藏配置/默认即可构造完整intake；原note可读回，限制清晰；只显示已证实阶段；Browser/BFF不第二私有调用TE、不显示虚假RUNNING/百分比/报告 | 未执行 / NOT RUN |
| UI-277-003 | 原create/intake响应丢失、刷新/重登、原URL另一Human；同请求跨Tab；全局entry选择已变但原request仍可用 | 安全ID路由→EP/IG原key查询；首次intake始终取原request返回的policy tuple；唯一原intake；重新认证不重新提交/换作者；无权限清缓存，404/503不是重建许可 | 未执行 / NOT RUN |
| UI-277-004 | 缺preset/rule publication、无post-create access、Runner能力缺失、分析撤权 | 分别给真实原因；保留客户/Project/资料成功事实；资料已接收不冒充已分析；无Project权不能进上传，缺Runner可保留原ANALYZE意图 | 未执行 / NOT RUN |
| UI-277-005 | 首CREATE响应丢失后Query给RESTART及aggregateVersion/generation；查询后版本变化；UNKNOWN/次数耗尽；篡改note/hash/target/route/actor/CSRF | 同页从该Query独立填CAS/generation，一次完整重传，仅原bytes/hash；竞态拒绝后回读，UNKNOWN不显示可重传；已提交restart按保存原命令重放；有限route独立检查、坏输入零protected write，次数耗尽无自动新intake | 未执行 / NOT RUN |

## D14 / RD-01 首条资料链路设计场景

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。对应 owning Spec 的 D14 专节与 [Spec Delta](../decisions/d14-rd01-first-customer-flow.md)。下表是未来正链、必要反例与恢复验收；本 Issue 只做设计对账，不写实现测试、不运行客户任务，真实执行均 `NOT RUN`。后续使用脱敏独立 Runner 原输出、真实 owning receipts 和 PostgreSQL/HTTP/Browser 分层取证，不用合成 snapshot 代替。

| ID | 输入 / 故障 trace | 预期 owning 结果 | 实际 / 结果 |
|---|---|---|---|
| UI-RD01-001 | 新/已有客户，ZIP→真实报告→三摘要整份默认不选 | 布局不变；身份明确；总览缺口/证据/复制与原位补充；仅一次显式信息+整份范围确认 | 未执行 / `NOT RUN` |
| UI-RD01-002 | 必要 startup UNKNOWN/CONFLICT/unsupported 与单文件保护冲突 | 必要缺口禁开始并保留选择；独立文件合法 start 后可接收，整份保护不由子 action 绕过 | 未执行 / `NOT RUN` |
| UI-RD01-003 | 提交断网/刷新、PENDING/UNKNOWN、start成功scope失败 | 原 request/key 公共回读；PARTIAL 保留 ACTIVE，只续 scope；响应202不表示执行中 | 未执行 / `NOT RUN` |
| UI-RD01-004 | 新 report/撤权/CAS stale，STALE 响应有已提交 start | 旧草稿保留，新版重新核对；不回 PREPARING，不换旧 request 文件集合；Session 恢复仍当前授权 | 未执行 / `NOT RUN` |
| UI-RD01-005 | 公网 actor/header/CLI/path/zip正文处理/恶意Markdown | Core 认证/CSRF/Scope 拒绝；Browser/BFF 无解包/模型/storage写/私有Capability，正文安全编码与受权下载 | 未执行 / `NOT RUN` |
| UI-RD01-006 | scope已RECEIVED无Run、部分进度分页/迟到report | 阶段真实、水位/完整分母；未执行不标running/完成；无自动切换覆盖正在核对的旧报告 | 未执行 / `NOT RUN` |

首轮恢复追加场景（同为 `NOT RUN`）：**UI-RD01-007** — start成功scope失败，原选择阻塞/报告stale，新选独立文件；预期：INITIAL_SCOPE_ONLY 使用原start与新intent，清楚只确认范围；原请求immutable、刷新查新key；首轮已收到后入口关闭。

## 可信 Session 与公开接入验收场景（#258）

状态：`HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / LOCAL DETERMINISTIC + DISPOSABLE-POSTGRESQL + REAL PUBLIC-HTTP + CONTROLLED KEYCLOAK + BUILT-BROWSER EVIDENCE RECORDED IN ISSUE/PR`（受控 Keycloak 26.7.0 隔离 realm/client/user 与受控 Chromium 制品旅程已在 exact-head persistence gate 通过；真实生产部署、实际 Windows/macOS Chrome/Edge 矩阵与独立人工顾问验收仍 `NOT RUN`）。对应 [UI01 #258](../module-specs/Module-Spec-UI01-WorkspaceUI.md#可信-human-session-与公开-workspace-接入提案258) 和 [Session Delta](../decisions/workspace-trusted-session-public-access.md)。本地确定性替身、真实controlled Keycloak/HTTP/PG、浏览器制品、实际Windows/macOS Chrome/Edge与独立人验分别记录；本轮已取得确定性本地、一次性 PostgreSQL、真实公开 HTTP（合成 issuer/JWKS/RS256/PKCE）、真实受控 Keycloak 26.7.0（隔离 ream/client/user，PKCE 登录/refresh/密钥轮换）与受控 Chromium 制品旅程证据（`tests/persistence/workspace-controlled-keycloak.test.ts`、`workspace-built-browser.test.ts`，均在 exact-head persistence gate 通过）；生产安装/凭据/部署、实际 Windows/macOS Chrome/Edge 平台矩阵与独立人工验仍 `NOT RUN`，不用 mock 回执填 PASS。

| ID / 层次 | 输入 / 关联 trace | 可观察预期 | 实际 / 结果 |
|---|---|---|---|
| UI-258-001 / Config + Security | 缺固定issuer/audience/client/callback/peer、用户URL、伪Forwarded/Host、TLS/endpoint变化 | fail closed，无回调Host推导/外站redirect/任意upstream；无dev/mock fallback | 确定性本地 PASS：封闭配置缺项/未知键/用户 URL/伪 Host/不对齐 endpoint 均 fail closed，无 dev/mock fallback（`trust-config.test.ts`、`shell-fallback.test.ts`）；真实 TLS/代理部署与非受信 peer 的 Forwarded 忽略由 `trusted-session.test.ts` 覆盖。真实受控 Keycloak 26.7.0 旅程（隔离 realm/client/user）见 `tests/persistence/workspace-controlled-keycloak.test.ts`；生产安装/凭据/部署仍 `NOT RUN`。 |
| UI-258-002 / OIDC + HTTP | 同一合法交易的 `?code=…&state=…&iss=…&session_state=…` + PKCE；session_state缺省对照；错token iss/aud/azp/alg/type/期限/nonce，ID token当API token | 正确响应iss精确绑定交易/config后单次exchange、nonce验证与Core bootstrap；有限session_state校验后丢弃。双端独立验证，只有真实当前HUMAN关联可进入；非法token零业务调用，TR-258-01/02/04 | 确定性本地+HTTP PASS：真实 RS256/JWKS/PKCE（含 verifier 校验）走通 login→callback→Core bootstrap；缺省 `session_state` 与有限值均校验后丢弃；错 iss/aud/azp/alg/typ/期限/nonce 与 ID token 当 API token 全部拒绝且零业务调用（`trusted-session.test.ts`、`access-token.test.ts`、`workspace-trusted-http.test.ts`）；真实受控 Keycloak 26.7.0 的同一旅程（PKCE 登录 → callback iss → refresh → 密钥轮换 → 错 aud/azp/iss 拒绝）见 `tests/persistence/workspace-controlled-keycloak.test.ts`。 |
| UI-258-003 / OIDC | `?error=access_denied&state=…&iss=…`，可选session_state/恶意error_description/error_uri；成功/失败均缺/错/空/重复iss；code/error并存、未知/重复/超限/非法编码参数；未绑定Cookie/state、重放/串交易、多Tabcallback、5分钟过期与容量满 | 合法error仍验证绑定并single use，零exchange/bootstrap/新Session，只展示固定安全提示且不记录原参数/跟随URI；错误issuer/参数前置拒绝，重复同值也拒绝。交易single use；并发只一登录winner；限额503/无活跃Session驱逐，TR-258-05 | 确定性本地+HTTP PASS：合法 error 回调仍验绑定并单次消费、零 exchange/bootstrap/新 Session 且只展示固定安全提示；缺/空/重复/错 `iss`、code+error 并存、未知/重复/超限/非法编码、重放/串交易/过期交易、容量满 503 均覆盖（`trusted-session.test.ts`、`workspace-trusted-http.test.ts`）。多 Tab 真实并发 `NOT RUN` |
| UI-258-004 / Session + OIDC | 多Tab并发refresh、rotated refresh token、timeout/logout竞态、idle/absolute期/BFF重启 | single-flight/期限有效；迟到结果不复活；Cookie轮换/清理，轮询不续idle，TR-258-06/08 | 确定性本地 PASS：refresh 单飞/rotated token/timeout/logout 竞态/迟到结果不复活/idle 与绝对期/进程重启（内存丢失）均覆盖（`sessions.ts` 单测与 `trusted-session.test.ts`）。真实 IdP 轮转与浏览器多 Tab `NOT RUN` |
| UI-258-005 / Security + HTTP | GET业务写、所有POST Query/Command/PUT/activity/logout缺/错CSRF、null/错Origin/Host/Content-Type、公网actor/header | 前置拒绝且Core calls=0；仅已绑定OIDC callback例外；合法对照进入owner校验，TR-258-04/05 | 确定性本地+HTTP PASS：GET 业务写、缺/错 CSRF、null/错 Origin、Host、Content-Type 与公网 actor/header override 全部前置拒绝并证明 Core 调用计数为 0（`trusted-session.test.ts`、`workspace-trusted-http.test.ts`） |
| UI-258-006 / Contract + Registry | finite表逐项正例；未知operation/version、未注册D14、管理/worker操作、CREATE target/CAS/hash错值 | 只exact允许的已注册handler；Core形成共享Envelope身份字段，完整Result/code/retryDisposition保留，无私有dispatch | 确定性本地+HTTP PASS：逐字 allowlist 只消费 3 个已注册 QUERY；未知 operation/version 404/400，未注册 D14 与命令 503 `DEPENDENCY_UNAVAILABLE`，管理/worker 操作不存在，无通用 Registry dispatch；Core 侧自建共享 Envelope 身份字段并保留完整 Result/code（`dispatch.test.ts`、`operations.ts` 单测、`workspace-trusted-http.test.ts`）。D14 CREATE 预分配 target/CAS 用例因未注册 `NOT RUN` |
| UI-258-007 / Directory + Browser | 授权A/无权B、目录/board分权；201候选前200不匹配、第201匹配；完整零项与前页非空/末页空对照；翻页Grant/水位变化、B deep link与旧A迟到响应 | 空中间Page为OK且继续nextCursor，零累计项LOADING，后页显示匹配项目；仅完整无cursor且累计零项显示EMPTY，空末页不丢已有卡片，预算不变。有限owner目录，B统一不可见；current grant/RLS拒绝与变化从首屏重取；EP/TE水位与分母不混，TR-258-03 | 确定性本地+PostgreSQL PASS：授权 A/无权 B、目录与 board 分权、201 候选空首页与第 201 项、空末页保留先前卡片、游标绑定变化从首屏重取、EP/TE 水位与分母不混（`workspace-directory.test.ts`、web `pagination.test.ts`/`guard.test.ts`、`workspace-trusted-http.test.ts`）。真实浏览器跨项目深链接与旧响应 `NOT RUN` |
| UI-258-008 / Stream + HTTP | 合法100MiB边界ZIP、chunked超限/错hash/压缩HTTP body/断流/timeout/token过期、换Scope | 有界backpressure，零BFF解包/全包buffer/storage写；IG独立核验；同原intake查询，零新键/假FAILED | 未执行 / `NOT RUN`：本轮无 owning IG 原件字节 transport，`PUT /bff/customer-intakes/{id}/zip` 契约上保持 404/不可用；未伪造接纳或 FAILED |
| UI-258-009 / Content + Security | exact Evidence/EP依据摘录；别名/hash/Scope错值、未授权下载、恶意文件名/Markdown | owner当前权限/精确引用；无原件stream时下载不可用；不将locator/metadata转bytes权，CSP/编码且无脚本执行 | 部分：无 owning 下载流时下载不可用（404）已实现；既有 CSP/安全 Markdown/无外部图片由 shell 门禁与 `safe-markdown.test.tsx` 覆盖。受权依据摘录与恶意文件名/hash 错值的真实下载用例 `NOT RUN` |
| UI-258-010 / Recovery + HTTP + PG | request已commit/start成功scope失败时断网/Session过期/重启；原requestRef/key重登回读 | 原intent/成功steps/Receipt不变；新auth仅当前read/续步证明，UNKNOWN依赖失败不推未提交，零重复事实/dispatch，TR-258-06/07 | 部分确定性本地+HTTP PASS：Session 过期/登出/重登换代次、迟到结果丢弃、匿名会话 `REAUTH_REQUIRED`（`trusted-session.test.ts`、`workspace-trusted-http.test.ts`）；原 committed request 的跨重启回读依赖未注册 D14 操作，`NOT RUN` |
| UI-258-011 / Cache + Diagnostics | logout/401/撤权/切用户Scope、多Tab、bfcache；callback/token/body/file探针 | 敏感DOM/cache/objectURL清理，迟到响应不能复填；no-store；日志/trace字段allowlist无token/Subject/客户正文 | 确定性本地+HTTP PASS：受保护响应 no-store/no-referrer/nosniff、generation+Principal+Scope 迟到响应拦截、多 Tab 失效信号不携带 token/内容、日志/trace 无 token/Subject/客户正文（`trusted-session.test.ts`、`guard.test.ts`、`workspace-trusted-http.test.ts` 断言响应不出现 JWT/secret/subject）。真实 bfcache 与多 Tab 浏览器行为 `NOT RUN` |
| UI-258-012 / Actual Browser + Accessibility + Manual | 固定脱敏资料，Windows/macOS实际两稳定版Chrome/Edge；顾问登录→目录→已注册D14→原intent恢复 | 已批准布局/默认不选/键盘焦点/深链接真实可用；允许及拒绝链可追溯；记录build/环境/实际版本/独立审核人，不拿Chromium/axe代人验 | 未执行 / `NOT RUN`：受控 Chromium 的工程外壳门禁（`workspace:check`）与受控制品旅程（`workspace-built-browser.test.ts`、`workspace-controlled-keycloak.test.ts` 的真实 Keycloak 登录）已执行，但 Windows/macOS 实际 Chrome/Edge 平台矩阵与独立顾问人工验收仍未执行 |

UI-258-011 的合成 OIDC HTTP 泄漏探针按替身实际签发的 compact JWT 三段结构识别令牌，并逐项拒绝本次登录新签发的非空 opaque refresh token；保留原 URL、响应 JSON、Cookie 观测面及 secret、subject、Bearer 和 subject hash 断言。合法 PKCE challenge、state、nonce 或 opaque Cookie 偶然包含 `eyJ` 不构成令牌泄漏。确定性反例须同时覆盖这类合法随机值、真实 RSA 签名的 access/ID token 在各观测面出现、空签名三段形式及重复检测稳定性；该探针只服务测试替身，不作为生产 JWT 解析或认证实现。

## 工作台页面验收（#281）

以下为页面/组件验收，执行证据归 Issue/PR；不替代 #266 真实服务或完整浏览器矩阵。

| ID | 场景 | 可观察结果 |
|---|---|---|
| UI-BOARD-001 | 多项目、长名称、混合工作状态 | 共享页面呈现三列和折叠完成项、紧凑项目进度、最近访问；原因与动作清晰，无常驻聊天输入 |
| UI-BOARD-002 | 项目/工作筛选、精确入口、浏览器返回 | 新建、ZIP、报告、文件进度、精确候选与交付入口可导航；缺目标时诚实不可用；返回恢复筛选、展开、滚动和操作焦点 |
| UI-BOARD-003 | 新报告/候选在等待时到达 | 更新原卡及数量，不追加重复卡、不跳页、不抢焦点、不清输入；旧版本引用仍精确，Run 完成不推导项目完成 |
| UI-BOARD-004 | 授权目录与独立 EP/TE 读取、空中间页、分页/陈旧/拒绝/失效 | 只读选中项目，不推跨项目总数；完整/部分及各水位分开；失败不冒充空，失权无旧数据，迟到响应不回填 |
| UI-BOARD-005 | 1280×800、1440×900、1920×1080、360×800 与 320 CSS px | 桌面内容有界滚动，窄屏可切组和项目、长名称可读，无页面横向溢出；键盘/焦点/状态文本与 axe 检查 |
| UI-BOARD-006 | 生产制品、开发开关注入、深链接刷新 | 无工作台 fixture adapter/合成卡片及自动 fallback；注册页面可刷新，未知页面/资源仍拒绝 |

独立 exact-head review、真实服务/Runner/持久化、Windows/macOS 最近两个 Chrome/Edge 稳定版本与独立人工验收须另有证据；未执行层保持 `NOT RUN`。

## D12 / Q11 项目交付交互与恢复设计场景（#260）

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。对应 [UI D12](../module-specs/Module-Spec-UI01-WorkspaceUI.md#d12--q11-项目交付与原意图恢复提案260)；保留已批准原型布局/中文文案，以下不借用合成演示或工程外壳的浏览器结果。

| ID | 层级 / 输入 | 预期 | 当前实际输出 / 结果 |
|---|---|---|---|
| UI-D12-001 | Browser E2E；TR-260-01/09、仅Project/Plan进入、chapter/search/filter、R1/R2与无Run的Human文件、无Release的获批文件、移动详情 | 初始不选，章节汇总且逐文件显示来源/精确版本/等待原因，不要求先提供文件refs；集中核对一次；共享文件不重复；处理中M及旧#delivery包保留 | 未接真实API / NOT RUN |
| UI-D12-002 | Contract/Browser；APPROVED COMMITTED exact回读、PARTIAL ABS、拒绝、UNKNOWN、顾问缺独立角色 | 仅确定当前决策成功后接续下一可检查文件；其他角色仍待办/不可交付；拒绝/UNKNOWN留当前并回读原键，不批量批准 | 无真实Approval组合 / NOT RUN |
| UI-D12-003 | Race；确认dialog打开后新selected row/配套/Scope/Plan/RRS变化，旧Batch后新候选 | 显式STALE/阻断，其他有效选择不丢；重选需Human；旧Manifest/ZIP/来源不改，后台不切换当前文件 | 无真实qualification/query / NOT RUN |
| UI-D12-004 | Recovery；确认/生成timeout、401、BFF重启、未提交新草稿、late响应 | 原target/key/payloadHash读回单一原intent；未保存草稿不承诺跨设备；成功steps保留、UNKNOWN不新意图重发，late Scope/generation不串页 | 无生产保存/请求恢复 / NOT RUN |
| UI-D12-005 | HTTP/Security；点击下载、202、STARTED/RESPONSE_SENT/FAILED/UNKNOWN、许可过期/撤权/错主体/Range | 文案区分请求和服务端响应；不显示保存/发送/收件/验收/完成；有权重新请求同包，撤权清敏感cache/许可、无URL泄漏 | 无OIDC/stream/Browser安全验收 / NOT RUN |
| UI-D12-006 | Accessibility/Manual；键盘核对/失效回焦、窄屏包详情、连续下载/外部发送 | 保留布局和内部滚动、焦点可恢复；无移动审批/人工sent标记；不改变项目完成率/其他候选，真实客户送达另验 | Windows/macOS Chrome/Edge及独立人验 NOT RUN |

### #287 页面工程接受集

以下用例只验证共享页面和隔离开发适配器，执行证据进入 PR，不把 UI-D12 的真实服务接受集重标为 PASS。

| 场景 | 输入与预期 | 验证层 |
|---|---|---|
| 章节与来源 | 跨轮次/Human 文件、内部获批但无发布资格、默认不选、搜索/资格筛选及空结果；每行保留精确版本/报告与等待原因 | Component / built browser |
| 单次核对 | 多选后一次弹窗显示精确版本、接收范围及适配器给出的配套要求；缺配套、资格变化、版本消失及读取 PARTIAL/STALE 阻断，其他选择及弹窗保留 | Model / built browser |
| 原意图恢复 | 双击只提交一次；pending、UNKNOWN、拒绝/失败、确认待生成、生成中、包可用分开；错意图/错成员回执不晋升成功；只查询原请求；UNKNOWN 离开到工作台并等待卸载后返回，恢复同一 id/checkToken/精确成员，确认调用仍为一次 | Model / built browser |
| 固定包与下载 | 新候选不改变历史成员/来源；深链接包详情；可用/失权/过期/失败、请求与响应事实；合成 ZIP 明确标记，不能推断保存/发送/收件/项目完成；下载后离开再返回同一包，REQUESTED/UNKNOWN/FAILED/RESPONSE_STARTED/RESPONSE_SENT 观察与去重计数保留 | Built browser |
| 上下文与清理 | 后台更新保持搜索、选择、详情、弹窗及焦点；空/部分/陈旧/读取失败/失权与迟到响应安全；无浏览器持久化 | Built browser |
| 布局与键盘 | 1280/1440/1920 桌面内部滚动、200 项、320/360 reflow；窄屏列表/详情/包查看与桌面确认提示；键盘入弹窗、焦点圈定/Escape/回焦、自动可访问性诊断 | Controlled Chromium |
| 生产隔离 | 生产制品排除开发适配器与 ZIP 合成标识；缺 D12 能力诚实不可用，不 fallback 样例，不注册业务操作 | Production bundle / browser |

真实 D12 服务/授权/打包/传输、Runner、持久化、跨设备、Windows/macOS 完整 Chrome/Edge 矩阵及独立人工验收均 NOT RUN。

## Markdown 检查与单意见区设计场景（#259）

权威为 [UI #259](../module-specs/Module-Spec-UI01-WorkspaceUI.md#markdown-检查单意见区与草稿接续提案259)，原型入口/合成性质及完整steps见 [MF traces](../decisions/markdown-file-feedback.md#8-设计-trace-与真实来源)。下面均需实际构建、公开owner HTTP、server private drafts和批准浏览器矩阵；不是原型已验收记录。

| ID / 输入 | 可核验预期 | 实际 / 结果 |
|---|---|---|
| UI-MF-001 / MF-01无Root/Revision→同整份核对页prepare/get完整map与proposal/Hash→confirm；MF-02正文/表格blank/0/签批、natural comment+location→提交→新candidate | 不调用需current的review_basis或service producer；MAPPING_REQUIRED/失权/STALE/UNKNOWN禁盲确认、READY才确认exact proposal，准备/读取/确认不dispatch；exactfile/version/changes与唯一意见区一次submit，新candidate保留页/版本/输入，主动切版后复核；filled不是approved | 未执行 / NOT RUN |
| UI-MF-002 / MF-06 36changes/9章/201files、宽表、移动/删除、搜索/跨页/键盘 | 固定高度、逐处替换、章节点击保持展开/草稿；server total与stable locators，横滚全部列、旧删除引用明确，浏览不批准 | 未执行 / NOT RUN |
| UI-MF-003 / MF-07 one old-base suggestion B/M/S、错base/current变化/冲突 | 同区上传/声明base/显式复核，不guess/rebase；原请求/问题保留，新current提示而不换view；重新提交前核对新版位置 | 未执行 / NOT RUN |
| UI-MF-004 / MF-08 submit UNKNOWN/refresh/close/relogin、3次/10秒后手动查询、错Receipt/失权 | private pending snapshot与原key恢复、预算不重置；状态在原意见区顶部，无重发/假失败/自动批准；下一轮草稿可写 | 未执行 / NOT RUN |
| UI-MF-005 / MF-09真实server cross-device/CAS/save failure、processing时新text/attachment | 仅本人私稿，saved receipt exact匹配；一winner/fork保留差异，无自动merge/换base/发送；未保存状态真实可见 | 未执行 / NOT RUN |
| UI-MF-006 / MF-05/10plan objection/partial handling/linked Blocking Issue | 只该文件暂停、其他候选/草稿/批准不改；未处理明确、Issue不自解，反馈/导航不当Approval | 未执行 / NOT RUN |
| UI-MF-007 / MF-12Head成功但render UNKNOWN、exactdownload/撤权/恶意内容与filename | canonical可看/导出分别表达；未登记不下载raw成果，ticket header/no-store/安全编码/失权清理；下载不送达 | 未执行 / NOT RUN |

## 精确 Markdown built Browser 技术验收（#279）

`tests/persistence/workspace-built-browser.test.ts` 的 #279 场景复用真实 PostgreSQL、合成 OIDC HTTP、Core/BFF 与 production build artifact server。合法 owning Human setup 封存两个 exact Revision，先真实渲染登记，再用深链接登录并读取。检查 36/9 分母、逐处前后/章节搜索跳转、意见保留、全文与 12 列/空 cell/0、窄屏意见切换、禁用未实现提交/批准、两次实际 browser download 完整字节及 SHA-256 等于注册 checksum、跨 Scope、禁止 SERVICE 公共路由与撤权清空。

失败场景包含可恢复分页/下载失败保留意见、当前版本或基线单独拒绝时清空全部比较内容，以及持续 403/404 配合不变 ALLOWED Session 时请求停止、显式重读后仅发起一次新的读取。受控基线拒绝与请求计数为 Browser 呈现边界证据；实际当前 Grant 撤销另走真实 IP/Core/BFF 清理场景，不把受控响应当成额外 owning 授权证据。

本用例覆盖 UI-MF-002/007 的自动化技术切片；实际 Chrome/Edge 的 Windows/macOS 矩阵、真实客户文件内容判断与独立 Human acceptance 仍 NOT RUN。截图只为布局 QA，不是批准或接收事实。

## 新建项目与首轮 ZIP 页面验收（#282）

| ID | 场景 | 可观察结果 |
|---|---|---|
| UI-INTAKE-001 | 同名客户、键盘搜索、NEW、待定/错回执 | 名称不绑定身份；显式选 ID；保留输入；匹配回执才导航，创建不分析 |
| UI-INTAKE-002 | 固定/跨项目入口、无权/目录失败、迟到选择/响应 | 固定项目；跨项目初始不选；读取失败不冒充空；旧结果不串项目 |
| UI-INTAKE-003 | 单 ZIP/取消/非法选择、note、双击提交 | 旧选择保留；一次意图；提交后原 ZIP/note 不可变；任意文件无合成报告 |
| UI-INTAKE-004 | 各阶段、准备失败/替换、分析失败/许可重试、UNKNOWN | 同页真实区分状态，无自动跳转；原输入/失败可检查；UNKNOWN 不重发 |
| UI-INTAKE-005 | 构建后键盘/焦点、桌面三视口、360/320、axe、生产开关 | 有界滚动/无横向溢出；生产剔除 adapter，无模拟成功回退 |

组件/受控 Chromium 证据归 PR。真实创建、ZIP 接收、Runner、持久化、Windows/macOS Chrome/Edge 完整矩阵、独立 exact-head review 及人工验收需单独证据；未执行层 NOT RUN。


## #285 文件进度页面验收场景

| 场景 | 预期 | 证据位置 |
|---|---|---|
| 范围及混合结果 | 仅确认成员计数；等待/处理中/待检查/失败/待核验可区分；就绪文件立即进入精确候选 | Execution model/component / built-browser |
| 候选边界 | 缺失或错项目/轮次/文件候选不产生链接、不计待检查；旧候选引用保留 | Execution model/component |
| 重试及 UNKNOWN | 许可单文件点击一次产生 pending 原 intent，重复点击不提交；错回执和异常保持 UNKNOWN，只读原请求；失败历史与其他文件不变；pending→其他轮→原轮→UNKNOWN/ACCEPTED 即时更新，UNKNOWN 立即开放原请求查询且只提交一个意图 | Execution model/component / browser |
| 多轮上下文 | 后轮等待时前轮仍处理；搜索/筛选/滚动/展开往返保留；scope/report provenance 不改写 | Execution browser |
| 后台到达 | 页面、焦点、当前版本/草稿不被替换，展开区保持；另一轮事件不导航 | Execution component / browser |
| 负向状态 | 空范围/空搜索/读失败/失权各自明确，失权不展示文件；带项目查询及非默认搜索/展开的工作台→轮次→候选→轮次→工作台完整往返保留原 URL、项目和焦点 | Execution component / browser |
| 视口及键盘 | 1280/1440/1920 桌面清单内部滚动，360/320 reflow；键盘进入候选/切轮，状态不只依赖颜色 | Controlled Chromium browser; actual Chrome/Edge matrix NOT RUN |
| 生产隔离 | production bundle 不含 execution fixture，能力不可用不模拟执行或候选 | Configured code / production browser |

真实服务、Runner、授权重试、持久化、跨设备、完整 Windows/macOS Chrome/Edge 与人工验收：NOT RUN。执行证据记录在 Issue/PR。

## #283 分析页面验收场景

| 场景 | 预期 | 证据位置 |
|---|---|---|
| 精确报告四区与证据 | 同时显示四区，详情往返保留报告/位置；missing/read limit/顾问冲突与修改计划分开 | Analysis presentation unit / built-browser tests |
| 去重索取与复制失败 | 同 key 合并关联事项；顾问事项排除；全量复制不覆盖勾选，预览可编辑，失败显示手动复制 | Analysis unit / browser |
| 上下文草稿与提交快照 | 切换模式保留各自输入，重复点击仅一次，pending 可写下一稿，原文/依据不变 | Analysis browser |
| 新报告与历史 | 到达不跳页；显式应用显示变化摘要；历史只读；客户、顾问与计划旧稿均可切换查看和复制，但不能编辑、附加资料或提交；新版同事项不自动迁移旧稿 | Analysis browser |
| 旧上下文依据 | 两报告复用 evidence ID 且内容不同，旧上下文仅显示原项目/报告/版本依据；缺失或错项目/错版本来源明确不可用并提供原报告入口，不回退新版 | Analysis component / browser |
| 任意输入与异常结果 | 任意文本/附件无合成结论；failure/unavailable/UNKNOWN 原位保留；回执错上下文不成功 | Analysis unit / browser |
| 单文件计划意见 | supplied pending 仅限制被引用文件，其他共享计划文件可选；不关闭问题或执行 | Analysis browser |
| 视口/键盘 | 1280/1440/1920 桌面高度受限，360/320 reflow，窄屏清单/详情切换；焦点可见，dialog Escape 返回触发器 | Controlled Chromium browser; actual Chrome/Edge matrix NOT RUN |
| 生产隔离 | production bundle 无开发 adapter/匿名报告；未注册能力不可用、无 fixture fallback | Configured code target / production browser |

真实服务、Runner 接纳、上传、持久草稿、跨设备恢复、完整平台矩阵及人工验收：NOT RUN。执行结果记录在 Issue/PR，不由本场景表推导 PASS。

## #284 启动范围页面验收场景

| 场景 | 预期 | 证据位置 |
|---|---|---|
| 三类信息与整文件选择 | 默认零选；展开依据；搜索、章节和状态筛选不改变选择；桌面清单有界滚动，底部持续显示计数与确认 | Startup presentation / built browser |
| 必要依据与文件阻塞 | 必要依据缺失保留选择且禁确认；暂不能处理的整文件原因紧邻标题、关联禁用复选框；已选后阻塞可显式移除，独立文件仍可确认 | Startup presentation / built browser |
| 计划意见上下文 | 精确报告及文件进入分析页唯一意见区；待复核仅阻关联文件，不扩散到其他文件或旧 Run | Analysis/startup browser |
| 精确版本与后续轮 | 新报告不能沿用旧选择直接确认；已确认范围不变，重复纳入文件被排除并可打开原进度 | Startup browser / development adapter |
| 未知回执与生产隔离 | PENDING/UNKNOWN 禁重复提交；UNKNOWN 离开范围页再返回仍保留精确原意图、选择及只读查询入口；正式构建无演示适配器或合成成功 | Startup adapter / production build |

页面和匿名适配器的自动化结果记录于 #284 PR；真实服务、Runner、持久化、跨设备、完整 Chrome/Edge 平台矩阵及人工验收仍为 `NOT RUN`。

## #286 有界审查工作区页面验收场景

对应 [UI01 有界审查工作区切片](../module-specs/Module-Spec-UI01-WorkspaceUI.md#已实现的有界审查工作区与唯一意见区页面切片286)。页面/组件证据归 #286 PR；真实服务、Runner、持久化、跨设备与人工内容验收不由这些场景替代。

| 场景 | 预期 | 证据位置 |
|---|---|---|
| 有界三栏与 36 变化/9 章 | 固定高度文件列/阅读区/意见区共存；1280/1440/1920 下三栏底部不出视口且整页无纵向滚动、长内容栏内滚动；本文件总数与当前位置可见，上一处/下一处、章节分组可搜索弹窗可跳转，同章节展开保持、意见保留、浏览不标记检查完成 | Review component / development browser |
| 新增/删除/移动与缺失绑定 | 三类变化分别显示旧位置、原版本位置与两端；绑定无法解析时醒目待核对且不自动改绑相邻内容 | Review unit / browser |
| 201 份文件目录 | 显示真实分母与已加载数，搜索/状态筛选作用于完整目录，游标继续加载；批准前后 READY/APPROVED/ALL 的筛选、计数与分页一致使用生效状态；无候选文件不可打开；切换文件保留各自草稿、默认回到变化详情并提示重新核对引用 | Review model / development browser |
| 新候选与显式切换 | 候选到达只更新提示与计数，不替换阅读版本、滚动与输入，普通意见转为待重新核对并阻断提交/批准且保留草稿；显式切换后进入新版本、回到变化详情、提示重新核对引用位置与草稿，切换后可再提交 | Development browser |
| 提交冻结与回执核验 | 一次“提交并修改”冻结原提交，后续键入不改变快照；UNKNOWN 位于意见区顶部、只查询原请求、禁重复提交与批准，预算用尽提供重新查询 | Review component / development browser |
| 改稿与基准 | 附上 Markdown 改稿必须显式选择基准；旧基准/最新版本/改稿分别显示，文本按转义预览不执行，未选基准不可提交；候选到达后旧基准改稿复核仍可提交（有界例外） | Review component / development browser |
| 草稿保存状态 | adapter 提供的保存中/已保存/保存失败/冲突/UNKNOWN/未接入分别显示，输入始终保留 | Development browser |
| 批准推进 | 点击只产生待核验意图；UNKNOWN/错上下文不批准不切换；匹配成功回执才批准并进入下一份待检查文件 | Development browser |
| 下载状态 | 下载/未登记表示与阅读、意见、批准分开显示；无表示时禁用并说明原因 | Development browser |
| 视口与键盘 | 1280/1440/1920 三栏高度受限于视口且各列内部滚动；360/320 下页面滚动可到达正文，阅读区有可用高度并内部滚动、变化导航与正文实际可见、前后导航可操作、引用进入同一意见区且切回保留输入；键盘可达、焦点回收与 axe 无违规 | Controlled Chromium browser; actual Chrome/Edge matrix NOT RUN |
| 生产隔离 | production bundle 不含审查工作区 adapter 与合成内容；未接入时明确不可用、无 fixture fallback | Configured code target / production browser |

## #291 准备旅程实现测试入口

新增 `tests/persistence/preparation-built-browser.test.ts` 使用当前 production SPA 制品、真实 HTTP BFF/Core 与 owning PostgreSQL，前置公司规则/预设/准入由 owner Port 发布；受控本地 OIDC 和对象传输显式限定，不能视为外部 Provider/Ceph/Runner 验收。`preparation-journey.test.ts` 核对跨 owner 的 NEW/EXISTING 创建、ZIP+note 原文恢复、source/manifest/handoff 与无 TE 的诚实状态；IP/EP/IG 各有独立持久化故障/权限/CAS测试。`tests/workspace/preparation-transport.test.ts` 核 raw payload 与 cv1/NFC 的不同职责、完整 Scope/伪造 actor/hash 拒绝和安全恢复 URL；BFF zip-body 验证 backpressure、累计/声明长度、失权和超时。状态与精确 revision 的运行证据保留在 Issue/PR，人工/真实外部能力仍 NOT RUN。

ZIP 代理的受控真实 HTTP 用例覆盖上传正文结束后 owning 处理超过十五秒仍返回完整响应；浏览器 transport 用例覆盖 200 响应头先到、正文延迟或中断。真实重传浏览器场景必须等待同一 intake 的精确 PUT 返回 200 且响应完整结束，并核验 STAGED/READY、manifest 和真实 handoff 摘要后才允许 suite teardown；generation 更新或页面文字不单独证明传输完成。清理保持原三十秒失败门禁，不强杀活动请求或吞掉清理错误。

### macOS 环境 B 的基础设施验收

| 场景 | 必须结果 |
|---|---|
| 配置与数据 | 拒绝未知字段、环境 A 端口、重复端口、输入/数据目录重叠；私有文件权限受限且不入 Git；仓库内自定义数据目录未被整体忽略或含已跟踪文件时，在写入前拒绝，包含符号链接路径 |
| 重复初始化 | 保留密钥和账号，通过 owning 命令与真实 OIDC 绑定，不产生重复身份或虚构业务成果 |
| 初始化中断 | 两个容器均运行但初始化未完成时仍为 PARTIAL；INITIALIZED 必须匹配本实例、当前配置和身份文件；重试前撤销旧完成记录，成功后重新记录 |
| 归属与恢复 | 端口占用、资源归属不符、实例配置漂移安全拒绝；Runner 目录移走仍可 status/stop；依赖停止不报 RUNNING；部分启动失败可重试，不触及其他进程/容器 |
| 常驻与停止 | 启动命令退出后 Web/BFF/Core 仍可访问；停止只操作本实例，数据卷保留，再启可登录 |
| A/B 同时运行 | B 初始化、启停前后 A 的 3100/3101 服务保持可用 |
| 证据分层 | 本地基础环境、公司规则/上传、真实 OMP 调用、报告接纳和人工验收分别记录；未执行保持 NOT RUN |


### 环境 B v0.2 / 本机 OMP 分析验收（待执行适配批准）

对应 Deployment/Security Baseline 的本机分析适配提案。以下均为待实现/待执行场景，不继承基础设施或独立 Runner 工具的 PASS。

| 场景 | 必须结果 |
|---|---|
| 本地 profile 隔离 | 仅 B 显式测试模式可选本机 profile；生产 loader 拒绝；不得用 Darwin 观察填 Ubuntu 执行锁 |
| 存储与恢复 | 实际 ZIP/来源/报告字节重启保留；同 key 不同内容、穿越、链接和崩溃歧义失败；失败不伪造存储或来源 Receipt |
| 受信上下文 | 原始请求、manifest、前版、已发布词表/规则和 Hash 不匹配时拒绝；用户上传的 AGENTS/上下文不得成为执行配置 |
| 真实 OMP | 实际调用读取本轮固定 AGENTS 和授权材料；禁用额外发现/工具；配置改变、启动失败或模型不可用显示真实失败，不替换模型 |
| 重复与中断 | 重复提交/进程崩溃/超时先查原 Run；UNKNOWN 不创建第二次副作用；迟到结果不能越过 lease/fencing |
| v0.2 拒绝链 | 模板冒充客户事实、假冲突、错误缺失字段、词表越界、跨来源提取件、依赖环、遗漏旧事项、MD 漂移均不得成为 accepted report |
| 人工浏览器闭环 | 通过真实登录上传脱敏 ZIP，页面展示本次 OMP 返回且 TE/EP 接纳的报告；刷新/重启可回看，UNKNOWN/冲突不自动放行启动 |
| 验收范围 | A 保持可用；基础设施、固定工具、真实 Provider、平台接纳、人工验收分别取证；不把分析通过记作生成/批准/发布或完整 E2E 通过 |

## 模板驱动首次分析验收（2026-10-18）

对应 [校正决定](../decisions/template-driven-preparation.md)。设计场景均为 `NOT RUN`；实际本地、持久化、Provider、浏览器和人工证据分别记录。

| ID | 输入/故障 | 必须成立的结果 |
| --- | --- | --- |
| UI-TB-001 | 新基准准备项目、无公司规范发布 | 现有创建/ZIP/报告流程，无额外法规表单；展示真实状态 |
| UI-TB-002 | 公司配置缺失、客户资料缺失、未实现后续能力 | 明确区分原因；不让客户补公司规范，不用 fixture 冒充 Runner 或生成成功 |

补充 NOT RUN：capture/get source @2.0 与旧 @1.0 双向拒绝错 profile；首次模板报告经独立 get_preparation_analysis_report 真实回读；旧 startup review/confirm 不接受新报告且零正式写入；无报告不返回空成功；指令 sourceId 重复、首轮 previousReportRef 或非空 trustedDecisionRefs 拒绝。

## 缩编 MVP：U1 资料到范围验收（2026-10-20）

对应 [UI Spec 的 U1 展示增量](../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpu1-从资料到确认范围2026-10-20)和已确认 [交付计划 §3](../mvp/delivery-plan.md#3-第一阶段ui-订正与流程确认)。本组覆盖 UI-01–03 的 U1 页面演练及通用恢复，不替代真实业务能力或第一阶段整体确认。

| ID | 输入/操作 | 可观察通过条件 | 当前结果 |
|---|---|---|---|
| UI-MVP-U1-001 | 同项目概览→资料→分析→范围，返回、前进及缺上下文深链接 | 页面连续可达；项目和明确查看的版本不串用；缺上下文有原因及返回入口；三阶段与四层文件表达正确 | `PASS` · `u1-journey.spec.ts` 连续路径用例；fixture 浏览器 |
| UI-MVP-U1-002 | 首轮 7 份来源及显式补充批次，接收中、受限、失败、等待分析状态 | 目录、原批次和问题条目可核对；输入格式提示符合新范围；接收不等于分析；三格式展示不冒充实际读取验证 | `PASS` · 批次/格式/问题条目/接收中·等待分析·失败·未知状态用例；真实三格式读取仍 `NOT RUN` |
| UI-MVP-U1-003 | 有来源的报告、一次答复/补充及新报告，另覆盖无资料/无报告/受限/冲突 | 用户可查来源、区分事实/建议/待确认问题，答复后查看明确的变化；旧报告及意见绑定保留；不把模板条款当客户事实 | `PASS` · 七类理解/模板适用性、答复后第 2 版、旧版保留、失败/收到区分及收到后锁定用例 |
| UI-MVP-U1-004 | 具体计划、显式范围确认、范围内反馈及扩大范围 | 可解释当前情况/问题/建议/影响；回执匹配计划与输入；未确认不进入模拟生成；范围内修订不重复审批，扩展须新确认，已选文件不被永久排除；新阶段不重复范围审批 | `PASS` · 确认/多次修订历史/扩范围/下一阶段用例 |
| UI-MVP-U1-005 | 新报告/计划到达、主动切换及旧意见/选择 | 不抢走当前阅读内容；旧绑定保留；切换后要求核对而非自动确认新版 | `PASS` · 第 2 版到达、普通往返保留明确查看版本、显式核对、旧计划历史及新计划不切换当前视图用例 |
| UI-MVP-U1-006 | PENDING/FAILED/UNKNOWN、重复点击及往返页面 | 状态、原因与下一动作明确；UNKNOWN 保留原模拟意图并只查同一请求；不重复提交或显示真实保存/执行成功 | `PASS` · 范围确认三种状态与 UNKNOWN 同一请求恢复；分析页不再提供未接通的 UNKNOWN 场景；模拟回执明确标注非服务器保存 |
| UI-MVP-U1-007 | 正式模板内容、显式开发事件、生产构建及缺真实能力入口 | 开发标识持续可见；正式模板来源/摘要可追溯；无旧匿名报告替代；生产无模板演练内容和 mock fallback，既有真实入口及安全边界无回归 | `PASS` · 生产 bundle 标记排除检查；真实能力仍不可用 |
| UI-MVP-U1-008 | 桌面/窄屏、键盘导航、长内容和错误恢复，用户从头走完 U1 | 主操作和返回入口可达，焦点可见，内容安全规则保持；用户实际试走反馈可追溯，自动化不能代替此项人工结果 | `PASS (AUTOMATED LAYOUT/A11Y)` · 1440/360/320 与 axe/焦点用例；用户已反馈 U1 手动验证通过，见 [#302](https://github.com/qzhike/zhiju-business-core/issues/302#issuecomment-6308788799) / [#303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6308789929)；未逐项声明失败场景或平台矩阵的人工覆盖 |

正式模板和客户原件只读；场景状态可以模拟，不能自造替代模板或伪造客户事实。当前本机输入清单已固定 7 份客户 DOCX 和 6 份四层正式模板的角色/路径/摘要。实施时复核实际字节；样本缺失或来源变化时如实报告，不自动换成旧匿名 fixture。

公开 CI 使用不含客户身份与正文的展示状态输入，保留与正式来源匿名编号的关联，验证导航、版本绑定、范围提示、回执和构建隔离。客户内容及正式模板正文的页面试走在本机完成并单独取证；本机私有清单、客户原件/正文/截图不得进入公开仓库或 Issue。CI 缺私有语料不是跳过公共场景的理由，公共 CI 通过也不能代替本机内容与人工试走。公开报告只写无敏感内容的修订、来源匿名编号、通过范围及剩余限制。

本增量自动化入口为 `tests/workspace/u1-journey.spec.ts`，生产隔离标记检查在 `tools/workspace/check.mjs`。本机来源核对使用 `test-results/mvp-u1-inputs.local.json` 固定的 C01–C07 与 T01–T06，复核字节/SHA-256 后按匿名编号形成展示输入；未把客户身份、正文、截图或模板原文写入仓库。报告事实、缺口、冲突和非适用性来自正文提取与模板对照，图形、批注、修订和版式仍未读取。自动化结果不替代用户 U1 试走；用户已反馈 U1 手动验证通过，具体反馈与证据范围见对应 Issue/PR。

实施预计涉及共享导航及当前允许列表外路径，配置验证为 `vibe verify full --json`；新或变化容器环境在首个 full 前执行 `vibe verify environment --json`。只有完整 PR diff 实际全部落入现有低风险允许列表时，才按 §2.1.1 改用 `code`；不为本项放宽允许列表。本文两份 owning 文档的纯 Markdown 增量使用 `vibe verify docs --json`。

无敏感内容的浏览器结果、来源编号、Core 修订和人工页面反馈进入对应 Issue/PR；独立审查按最终修订进行。真实 ZIP/OOXML 接收与读取、正式范围确认、Runner、持久化/重启、UI-04–08 及 MVP-01–10 仍分别保持 `NOT RUN`，不以本项关闭宣称第一阶段全部完成。

## 缩编 MVP：U2 三阶段审阅与定稿验收（2026-10-21）

对应 [U2 展示增量](../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpu2-三阶段审阅与定稿2026-10-21)及 [交付计划 UI-04/05](../mvp/delivery-plan.md#34-ui-流程确认场景)。以下为已实现并自动化的确定性场景；U1 已通过不使本组自动通过。U2-008 的布局/无障碍自动化已通过，用户实际试走仍为 `NOT RUN`。

| ID | 输入/操作 | 可观察通过条件 | 当前结果 |
|---|---|---|---|
| UI-MVP-U2-001 | 同项目从 U1 确认范围进入三阶段并返回；未确认/被替代计划、错项目或缺上游依据深链接 | 主路径可达、演练控件可发现；项目/计划/明确查看版本不串用，阶段入口缺前置则解释并提供返回；进入后续阶段不重复范围审批 | `PASS (AUTOMATED)` · `u2-journey.spec.ts` 连续路径与深链接用例；U1 交接回归 |
| UI-MVP-U2-002 | 质量手册 v1，保存/提交意见，显式产生 v2，查看差异并确认 | 新候选不替换当前阅读位置/输入；主动切换核对后确认具体 v2；只有绑定计划/输入/版本的匹配模拟结果成为第二阶段依据，阅读/生成/意见收到均不代替定稿 | `PASS (AUTOMATED)` · 保存/两次提交/候选到达/显式切换/定稿用例；模型单测 |
| UI-MVP-U2-003 | 以手册精确版本为依据，联动修订程序与制度，整体确认集合；缺项、确认期间版本变化或回执错绑 | 两类文件在同阶段可审阅并至少同轮修订一次；确认完整精确集合，不要求两类间审批或逐文件批准；缺项/变化/错绑不推进，原草稿与历史保留 | `PASS (AUTOMATED)` · 两文件同轮修改/完整集合/缺文件/错绑/确认期间变化用例；模型单测 |
| UI-MVP-U2-004 | 第二阶段已定稿与未定稿两种入口，表单正文/宽表/意见及新候选 | 仅前两阶段依据齐全时进入表单生成演练；明确显示手册版本与第二阶段集合；表格完整可读，允许反馈；无额外表单定稿关卡，无已交付/真实 ZIP 可用暗示 | `PASS (AUTOMATED)` · 记录表单入口/依据/宽表/反馈/无定稿关卡用例 |
| UI-MVP-U2-005 | 项目/阶段/文件版本意见，连续两次提交，切文件/阶段/版本并返回；范围内与扩范围反馈 | 作用范围清楚且不串用；保留每轮原文、请求和原依据；旧版意见不自动迁移，新输入与已提交内容区分；范围内直接修订、扩范围回 U1 确认 | `PASS (AUTOMATED)` · 作用范围/两次提交/版本切换草稿/历史/阶段草稿原依据显式重绑用例 |
| UI-MVP-U2-006 | 模拟保存中/已保存/失败/未知，刷新限制；修改或定稿 PENDING/UNKNOWN，重复点击、往返及原请求匹配/不匹配回执 | 状态文案真实且有下一动作；普通导航不丢本轮草稿/历史；刷新明确重置，不冒充服务恢复；单项目一次修改批次，原请求未决不重复执行/跨过定稿，错绑不成功 | `PASS (AUTOMATED)` · 保存失败/UNKNOWN 原请求恢复/失败重试/定稿 PENDING 往返与单请求/未决修改阻止定稿完成用例 |
| UI-MVP-U2-007 | 正式来源快照、演示决定、新文件、生产 bundle 和既有真实入口回归 | 来源与限制可追溯；模板/模拟答复不变成客户事实；新增制度无虚构客户原版本；生产排除演练 adapter/内容，真实读取/下载/Session 安全保持 | `PASS (AUTOMATED)` · 来源/限制、新增制度无原件、模拟答复标识、生产 bundle 与既有入口检查 |
| UI-MVP-U2-008 | 桌面完整试走、窄屏阅读/意见/返回、键盘焦点与长内容；用户实际 U2 反馈 | 手册反馈定稿→程序/制度联动整体定稿→表单依据可在同项目完成；必要操作可发现；窄屏若禁确认有清晰桌面指引；记录修订与用户反馈，自动化不冒充人工通过 | `PASS (AUTOMATED LAYOUT/A11Y)` · 1440/360/320 的意见区/返回/axe 与两档焦点用例；用户实际 U2 试走与反馈 `NOT RUN` |

公开自动化使用关联 C01–C07/T01–T06 的非敏感展示状态，不复制正式模板或客户正文成为另一套模板。私有清单、原件、摘录与截图不进入 Git/公开 Issue。实现时按本机私有清单复核了 7 份客户 DOCX 与 6 份正式模板的字节和 SHA-256（全部匹配），并据来源结构与模板对照形成匿名展示候选；客户原文、模板原文、截图和私有清单未进入仓库。自动化 UI 与本机匿名展示内容试走已通过；客户原文/模板原文的私有内容逐字试走、用户实际 U2 试走与反馈仍为 `NOT RUN`，不以自动化代替。

本增量自动化入口为 `tests/workspace/u2-journey.spec.ts`；共享审阅模型/组件单测位于 `apps/workspace-web/src/mvp/review-model.test.ts`、`apps/workspace-web/src/review/model.test.ts` 与 `apps/workspace-web/src/MarkdownReviewPage.test.tsx`。生产隔离标记检查位于 `tools/workspace/check.mjs` 与浏览器生产用例。配置验证为 `vibe verify full --json`；新或变化的容器环境在首个本地 full 前执行一次 `vibe verify environment --json` 并复用有效结果。完整实际 PR diff 不在既有低风险允许列表内，未改用 `code`。

最终实现须按精确修订独立审查并保留 `.vibe/reviews/pr-<number>/Review.md`。证据及用户反馈进入对应 Issue/PR；真实 Runner、服务端保存/定稿、重启与跨设备、U3 的 UI-06–08 自动化页面试走由下方 U3 增量覆盖，用户 U3 整体试走、第一阶段整体确认和 MVP-01–10 继续分别为 `NOT RUN`。

## 缩编 MVP：U3 返工、恢复与交付验收（2026-10-21）

对应 [U3 展示增量](../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpu3-返工恢复与交付2026-10-21)及 [交付计划 UI-06–08](../mvp/delivery-plan.md#34-ui-流程确认场景)。以下场景由隔离开发 adapter 与受控 Chromium 自动化；不替代真实 Runner、持久化、跨设备或用户完整试走。

| ID | 输入/操作 | 可观察通过条件 | 当前结果 |
|---|---|---|---|
| UI-MVP-U3-001 | 从 U1 确认范围连续走到三阶段审阅、返工/复核、执行/恢复与最终交付；返回原审阅或原尝试；缺前置深链接与错项目入口 | 同项目、计划、输入与精确版本连续；缺上下文给原因和返回动作；必要演练控件可发现；返回不重置无关进度 | `PASS (AUTOMATED)` · `u3-journey.spec.ts` 连续路径/深链接用例 |
| UI-MVP-U3-002 | 已定稿手册出现新草稿、显式重新定稿、下游受影响文件与修改/保留理由；第二阶段按新手册重新确认集合；记录表单复核 | 草稿不替换旧依据；重新定稿保留前任并标记下游；旧/新依据、受影响文件/理由可见；第二阶段完整集合可重新确认；记录复核只绑定精确版本，不是定稿关卡 | `PASS (AUTOMATED)` · 重新定稿/影响/集合复核/记录复核用例；模型单测 |
| UI-MVP-U3-003 | 多文件部分成功与已知失败、仅失败文件重试、关联修正、批次期间保存下一轮意见 | 成功候选与原尝试/固定输入/错误历史保留；只重试失败文件；成功文件不重新生成/覆盖；部分成功不显示阶段完成；单项目一个活动批次 | `PASS (AUTOMATED)` · 部分成功/失败文件列表/重试意图/关联修正/意见保存用例 |
| UI-MVP-U3-004 | 执行 PENDING/UNKNOWN、重复点击、导航往返、错项目/错尝试/错版本回执；依据变化后迟到结果与较新尝试后的旧结果 | 只保留并查询原请求；错绑不推进；迟到/旧结果只进历史，不替换当前版本、阅读、草稿或定稿；意见历史追加 | `PASS (AUTOMATED)` · UNKNOWN 往返/错绑/迟到结果/历史追加用例；模型单测 |
| UI-MVP-U3-005 | 交付清单、精确版本、两项上游依据、未解决问题/依据变化；确认前版本变化、缺必需文件、错绑回执 | 一次显式确认才冻结；阅读/候选/打包回执不代替确认；阻断时保留选择/上下文；需显式重新核对；冻结后新候选不改清单 | `PASS (AUTOMATED)` · 清单/阻断/重新核对/冻结用例；模型单测 |
| UI-MVP-U3-006 | 打包失败后重试同一冻结清单、UNKNOWN 先核对、下载 ZIP 成员内容、后续改稿/新包与历史包 | 重试不重复确认/不重生成文档；UNKNOWN 先核对原尝试；ZIP 成员名称与正文对应冻结版本；历史包成员/字节不变；包可用/请求下载/观察结果分开 | `PASS (AUTOMATED)` · 失败重试/UNKNOWN/下载字节校验/历史包不变用例；模型单测 |
| UI-MVP-U3-007 | 正式来源快照、模拟答复、公开 ZIP 内容、生产 bundle 与既有真实入口回归 | 环境 A/内存限制持续可见；公开测试与 ZIP 无私有内容；模拟答复不成为客户决定；生产剔除 U3 adapter/数据/导出器，真实读取/下载/登录清理保持 | `PASS (AUTOMATED)` · 生产 bundle 标记、下载内容与既有入口回归 |
| UI-MVP-U3-008 | 桌面完整试走、窄屏表格/意见/返回、键盘焦点、axe 与用户整体确认 | 可区分范围确认/阶段定稿/最终交付确认；窄屏可操作且桌面限定说明清楚；错误可操作、焦点回收；记录实际修订与用户明确确认 | `PASS (AUTOMATED LAYOUT/A11Y)` · 1440/360/320 与 axe/焦点用例；U3/UI-01–08 整体模拟流程用户已确认，见 [PR #309 正式 Review](../reviews/pr-309/Review.md)；未逐项声明的人工反例/平台覆盖不外推 |

公开自动化仅使用关联 C01–C07/T01–T06 的非敏感展示状态和合成 ZIP 成员，不复制客户原件、正式模板正文、私有清单或截图。自动化通过不升级为私有内容试走、真实服务或人工验收；未执行项保持 `NOT RUN`。

PR #309 独立审查 R1–R4 的回归已并入上述矩阵：未决最终确认在重新核对、改选与导航后保留原 `U3-FINAL-*` 请求并阻止第二个意图；未决/错绑执行恢复请求计入最终交付阻断，收敛后才可冻结；错绑恢复回执保持原 `U3-RETRY-*` 请求锁定，只有同一请求的匹配结果或明确失败/结束才允许新意图并保留已结束请求历史；阶段修改与执行恢复共用项目级活动检查，两个操作顺序均不能创建并行的第二个请求，原请求收敛后才释放另一方。

本增量自动化入口为 `tests/workspace/u3-journey.spec.ts`；展示模型单测位于 `apps/workspace-web/src/mvp/u3-model.test.ts`，U2 返工扩展仍由 `mvp/review-model.test.ts` 与 `u2-journey.spec.ts` 回归。配置验证为 `vibe verify full --json`；新或变化容器环境在首个本地 full 前执行一次 `vibe verify environment --json` 并复用有效结果。完整实际 PR diff 不在既有低风险允许列表内，未改用 `code`。

最终实现须按精确修订独立审查并保留 `.vibe/reviews/pr-<number>/Review.md`。证据及用户反馈进入对应 Issue/PR；真实 Runner、服务端保存/定稿/打包、重启与跨设备、私有原文逐字内容及 MVP-01–10 继续分别为 `NOT RUN`。整体 UI 确认依据正式 Review 校正，不由自动化或合并推导。

## 缩编 MVP：B1 真实托管 UI 验收索引（已批准设计）

对应 [B1 UI 接线](../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpb1-真实项目与资料托管接线已批准设计)。共享用户出口及故障矩阵由 [MVP01 Test](Module-Test-MVP01-DocumentDelivery.md)拥有；以下不复制另一份业务测试集合。展示模型自动化见 `apps/workspace-web/src/custody/model.test.ts`；真实浏览器登录、上传、刷新和停启已有受控自动化及隔离本机技术证据，具体覆盖与剩余边界以 MVP01 Test 为准；正式来源人工内容验收仍为 `NOT RUN`。

| UI 观察 | Owning 场景 | 通过条件 |
|---|---|---|
| 登录、创建、刷新与真实能力 | B1-01/02/13 | 新 owner 绑定生效，成功回执与当前状态区分，生产无模拟回退，旧入口回归 |
| 三格式清单与补充批次 | B1-03–07 | 全部条目/限制/0 accepted 可核对，历史/精确源保留，补充不会覆盖旧输入 |
| 并发、原请求恢复、显式放弃 | B1-08–10 | 双击/响应丢失/刷新不换 key，恢复标记只含身份/摘要且不授权，失权清理；UNKNOWN 只核对原尝试，安全放弃保留历史 |
| 重启与归属读回 | B1-11/12 | 重新登录后同数据/字节，跨项目/旧会话无泄漏，分页连续，下载失败不记成功 |
| 实际用户小规模试走 | B1-14 | 正式来源三格式、补充、恢复、停启与浏览器读回有独立记录；不升级为 Runner 或 MVP 全闭环验收 |

自动化覆盖 1440/360/320 宽度、键盘/焦点及安全内容显示；文件名/长说明/错误可操作。人工试走按实际平台记录，不从自动化推定完整平台矩阵。未来实现用 full；这次 owning 设计文档只用 docs。
