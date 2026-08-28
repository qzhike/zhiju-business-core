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
