# Module-Spec-UI01-WorkspaceUI

版本：v0.1
日期：2026-08-28
状态：`CURRENT EXPERIENCE MODULE BASELINE / IM-UI-01 MILESTONE USER APPROVED / DESIGN VERIFIED / IMPLEMENTATION NOT STARTED`

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
- UI-DG-001 部分确认：React + TypeScript + Tailwind CSS + Vite、Monorepo 已获用户批准；SPA/SSR、精确版本及升级策略仍待冻结。UI-DG-002 尚为 `USER DECISION REQUIRED`；UI-DG-003 只有高层安全边界，具体设计未完成。
- 前端工程、BFF、OIDC、页面、组件、Browser Test、Security Test、Accessibility Test 和 Manual Acceptance 均未实现或运行，状态为 `NOT RUN`。
- 本文 `DESIGN VERIFIED` 只表示 Experience 层职责、依赖和失败边界与现有 Core 权威文档一致，不代表 UI 可用。
