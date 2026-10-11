# Module-Test-UI01-WorkspaceUI

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

状态：`HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / LOCAL DETERMINISTIC + DISPOSABLE-POSTGRESQL + REAL PUBLIC-HTTP + CONTROLLED KEYCLOAK + BUILT-BROWSER EVIDENCE RECORDED IN ISSUE/PR`（受控 Keycloak 26.7.0 隔离 realm/client/user 与受控 Chromium 制品旅程已在 exact-head persistence gate 通过；真实生产部署、实际 Windows/macOS Chrome/Edge 矩阵与独立人工顾问验收仍 `NOT RUN`）。对应 [UI01 #258](../module-specs/Module-Spec-UI01-WorkspaceUI.md#可信-human-session-与公开-workspace-接入提案258) 和 [Session Delta](../decisions/workspace-trusted-session-public-access.md)。本地确定性替身、真实controlled Keycloak/HTTP/PG、浏览器制品、实际Windows/macOS Chrome/Edge与独立人验分别记录；本轮已取得确定性本地、一次性 PostgreSQL 与真实公开 HTTP（合成 issuer/JWKS/RS256/PKCE）证据，受控 Keycloak 部署、浏览器制品旅程、平台矩阵与独立人验仍 `NOT RUN`，不用 mock 回执填 PASS。

| ID / 层次 | 输入 / 关联 trace | 可观察预期 | 实际 / 结果 |
|---|---|---|---|
| UI-258-001 / Config + Security | 缺固定issuer/audience/client/callback/peer、用户URL、伪Forwarded/Host、TLS/endpoint变化 | fail closed，无回调Host推导/外站redirect/任意upstream；无dev/mock fallback | 确定性本地 PASS：封闭配置缺项/未知键/用户 URL/伪 Host/不对齐 endpoint 均 fail closed，无 dev/mock fallback（`trust-config.test.ts`、`shell-fallback.test.ts`）；真实 TLS/代理部署与非受信 peer 的 Forwarded 忽略由 `trusted-session.test.ts` 覆盖。受控 Keycloak 部署 `NOT RUN` |
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
