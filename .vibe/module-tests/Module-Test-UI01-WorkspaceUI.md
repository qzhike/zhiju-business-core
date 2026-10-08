# Module-Test-UI01-WorkspaceUI

版本：v0.1
日期：2026-08-28
状态：`EXPERIENCE TEST BASELINE / DESIGN VERIFIED / IMPLEMENTATION NOT STARTED / AUTOMATED NOT RUN / MANUAL NOT RUN`

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
| UI-A-001 | Accessibility | 仅键盘执行登录后导航、Gap 决策、Diff、Approval 确认与错误恢复 | 可见 focus、正确 name/role/value、错误摘要与焦点回收；颜色不是唯一状态编码 | Accessibility Test 未运行；目标待 UI-DG-002 冻结 | `NOT RUN` |
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
- 未创建临时测试脚本、浏览器制品、截图、HAR、trace 或测试账号。

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

对应[工程提案](../decisions/workspace-ui-engineering-baseline.md)及 UI01 工程 Spec Delta；本表定义未来验证，不将本轮 Markdown/版本元数据检查算作正式通过。当前状态均为 `NOT RUN`。

设计 DTO 精确排除在生产应用 lint 外，仍以独立 TypeScript 与 Schema/样例定向检查验证。该排除不扩展至 `.vibe` 全目录或生产 contracts，也不替代下表任何正式验收。

| ID | 层级与触发条件 | 必须验证的结果 | 当前结果 |
|---|---|---|---|
| UI-ENG-001 | Build/Boundary：生产 build、直接业务私包导入、缺配置/登录失败 | 静态 Web 与 BFF 独立构建；私有依赖/凭据不能进 Browser；无 mock 自动 fallback；页面 fallback 不吞 BFF/API/资产 404 | `NOT RUN` |
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
| UI-SHELL-001 | 干净安装批准 lockfile 后构建 Web/BFF 与 Core | 两个应用可独立构建，Core 既有构建仍通过；正式构建无 token/凭据/私有业务包 | `NOT RUN` |
| UI-SHELL-002 | 明确开发模式与匿名报告，执行首轮导航、刷新、返回与加载/失败 | 已批准布局与默认不选/显式确认保持；刷新/历史与错误可恢复，样例动作不会伪称真实执行 | `NOT RUN` |
| UI-SHELL-003 | 生产模式缺 Session/公开服务或注入开发开关 | 业务动作安全拒绝，无假身份/假回执或 mock fallback；配置错误有可理解反馈 | `NOT RUN` |
| UI-SHELL-004 | `.tsx` 引入禁止业务/私有依赖，应用 manifest 声明禁止依赖，以及允许库的对照 | 架构检查拒绝必要负向反例，允许批准依赖；未遗漏 React 源码或 apps manifest | `NOT RUN` |
