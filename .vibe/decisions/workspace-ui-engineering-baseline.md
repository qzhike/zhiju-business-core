# Workspace UI 首版工程决策基线

日期：2026-10-08。分类：`T2`。状态：`USER APPROVED 2026-10-08 / FUTURE ENGINEERING BASELINE / INDEPENDENT REVIEW NOT RUN / NOT IMPLEMENTED`。

本文收口 UI-DG-001～003 的工程选择，不再展开高保真布局探索。已批准的产品方向、启动核对布局及交互继续以[正式产品提案](workspace-mvp-human-agent.md)和 [UI01 Spec](../module-specs/Module-Spec-UI01-WorkspaceUI.md) 为准；字段级草案仍未注册。本文没有新增公共业务操作、改变 Core 状态机或宣布真实 Runner/UI 可用。

## 1. 已确认与本次批准范围

| 项目 | 状态与范围 |
|---|---|
| 产品与布局 | 用户已批准当前 MVP 流程及布局；冻结为首版交互参考，细节随实际使用调整 |
| 技术栈与仓库形式 | React + TypeScript + Tailwind CSS + Vite、Monorepo 已批准 |
| 浏览器范围 | 用户本轮确认首版覆盖 Windows/macOS Chrome、Edge；窄屏查看与反馈；Safari 全操作后续补齐 |
| UI-DG-001 | 用户已批准下述 SPA、路由/读取库、首装精确版本基线与升级策略；安装/集成验证尚未执行 |
| UI-DG-002 | 用户已批准下述基础组件、支持窗口、视口与可访问性/视觉验收方案；实际兼容性/可访问性尚未验证 |
| UI-DG-003 | 用户已批准下述独立 BFF、技术会话、安全协议、代理与可观测性方案；实际安全与恢复尚未验证 |
| 实现与验收 | 未建正式应用；真实 OIDC、业务 HTTP、Runner、持久化、浏览器及人工验收均为 NOT RUN |

受影响范围为 UI01 Spec/Test、Technology Baseline、Deployment/Security Baseline、Implementation Plan 和产品提案的工程路由。D14、RD-01 的 owning EP/TE/IG/Runtime 语义仅列依赖，不由本决定代替其字段冻结。

## 2. 应用与依赖方案（UI-DG-001 提案）

采用现有 pnpm workspace 内独立 `apps/workspace-web` 客户端 SPA 和独立 `apps/workspace-bff` 服务；Core 仍在 `apps/api`。静态 Web 与 BFF 独立构建/发布，经同源 HTTPS 反向代理接入。首版不用 SSR/RSC、微前端或新的前端仓库。

```text
Browser → 同源 HTTPS 反向代理
           ├─ 页面与资源 → workspace-web 静态构建产物
           └─ /bff/*    → workspace-bff
                           ├─ Keycloak OIDC
                           └─ 公开 HTTP API → Core owning Application
服务器 Runner ← owning Runtime/Integration 协议（不从 Browser 启动 CLI）
```

`/bff/*` 是 Experience 路由前缀提案，不是 Catalog 业务命令。Vite 开发/preview 服务不承担生产静态服务，见 [Vite 部署说明](https://vite.dev/guide/static-deploy.html)。Web fallback 只处理允许的页面路由；BFF/API/不存在的资源请求不得被 fallback 成 HTML 200。

- 路由采用 React Router **Declarative 模式**，只管理页面导航；业务读取统一由 TanStack Query 管理，避免两套数据缓存，见 [React Router 模式](https://reactrouter.com/start/modes)。
- 页面局部状态用 React state/reducer；服务器个人草稿仍由公开 owning 能力持久化，不能用浏览器存储冒充跨设备保存。不预先增加全局状态库、表单框架或共享组件包。
- Browser 仅消费经审查的公开 wire DTO/schema；不把含服务端实现的完整 contracts 包直接打进浏览器。BFF 不导入私有 Handler/Repository。
- 复用当前 main 的 Node **24.19.0**、pnpm **11.19.0**、TypeScript **6.0.3**、Vitest **4.1.10** 和现有 lint/build 规则；BFF 复用 NestJS **11.2.1**、Fastify **5.12.0**。不通过 UI 初始化顺带升级 Core 工具链。

### 2.1 精确版本候选与锁定

以下为 2026-10-08 对官方 npm 元数据核查得到的**批准的首装版本基线**，不是已安装/经过集成验证的依赖。用户本轮批准这些首装版本；开工前若必须改变版本，按本节升级策略复核。主仓 Node 与拟议 React 版本满足查见的 engine/必需 peer 区间；尚未解析完整依赖图、安装或构建。开工时将批准版本写入 manifest/catalog 与 lockfile，使用 frozen lockfile；不得在脚手架中使用浮动 `latest`。

| 用途 | 包与精确候选版本 | 官方依据 |
|---|---|---|
| React 与类型 | react / react-dom / @types/react / @types/react-dom **19.3.0** | [React registry](https://registry.npmjs.org/react/19.3.0)、[React DOM registry](https://registry.npmjs.org/react-dom/19.3.0)、[types](https://registry.npmjs.org/@types%2freact-dom/19.3.0) |
| 构建 | vite **8.3.3**；@vitejs/plugin-react **6.1.2** | [Vite registry](https://registry.npmjs.org/vite/8.3.3)、[plugin registry](https://registry.npmjs.org/@vitejs%2fplugin-react/6.1.2) |
| 样式 | tailwindcss / @tailwindcss/vite **4.3.3** | [Vite 集成](https://tailwindcss.com/docs/installation/using-vite)、[plugin registry](https://registry.npmjs.org/@tailwindcss%2fvite/4.3.3) |
| 导航 | react-router **8.4.0** | [registry](https://registry.npmjs.org/react-router/8.4.0) |
| 服务器读取 | @tanstack/react-query **5.104.1** | [registry](https://registry.npmjs.org/@tanstack%2freact-query/5.104.1) |
| 无样式交互基础 | @radix-ui/react-dialog **1.2.0**；@radix-ui/react-alert-dialog **1.1.24** | [Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)、[Alert Dialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog) |
| Markdown | react-markdown **10.1.0**；remark-gfm **4.0.1** | [react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm) |
| 组件测试 | @testing-library/react **16.3.3**；@testing-library/dom **10.4.2**；@testing-library/user-event **14.6.7**；jsdom **30.1.2** | [React registry](https://registry.npmjs.org/@testing-library%2freact/16.3.3)、[jsdom registry](https://registry.npmjs.org/jsdom/30.1.2) |
| 浏览器与可访问性诊断 | @playwright/test **1.64.0**；@axe-core/playwright **4.13.0** | [Playwright registry](https://registry.npmjs.org/@playwright%2ftest/1.64.0)、[axe registry](https://registry.npmjs.org/@axe-core%2fplaywright/4.13.0) |
| 开发/测试 API 替身 | msw **3.0.2**，只在替身需要时安装 | [registry](https://registry.npmjs.org/msw/3.0.2) |
| BFF OIDC / Cookie | openid-client **6.8.8**；@fastify/cookie **11.1.2** | [openid-client](https://github.com/panva/openid-client)、[Fastify Cookie 兼容表](https://github.com/fastify/fastify-cookie#compatibility) |

React Router 要求 Node >=22.22.0、React/DOM >=19.2.7；jsdom 30 要求 Node ^24.15.0 等受支持区间，本候选 Node 24.19.0 满足。Vite/React 插件及 Tailwind 插件的 peer 范围支持 Vite 8。React 插件的 React Compiler/Babel peers、MSW 的 GraphQL peer、jsdom 的 canvas peer 是可选项；首版不为满足可选 peer 额外引入这些能力。现有 Vitest、TypeScript 与完整依赖图的实际运行兼容性仍须在安装后验证。

升级采用单独可审阅变更：patch/minor 也更新精确锁定并验证受影响链；major 或会话/渲染边界变化独立评估，不自动跟随 latest。安全修复优先处理，不无限冻结旧版。来源核查不是安全扫描、浏览器证明或锁定结果。

## 3. 组件、浏览器与验收方案（UI-DG-002 提案）

保持现有原型的视觉方向与紧凑布局，抽取颜色、字体、间距、边框、焦点和状态 token；用 Tailwind 和小范围语义组件实现。普通按钮、表格、输入沿用原生元素；Dialog/AlertDialog 使用无样式 Radix 基础，补足可见标题、焦点恢复和确认中的状态，避免引入整套 ERP 组件框架。Radix 提供交互基础，不证明整个产品已可访问。

| 支持/检查项 | 首版口径 |
|---|---|
| 桌面正式操作 | Windows/macOS Chrome、Edge；验收时最近两个稳定大版本，记录实际版本 |
| 窄屏 | 受支持 Chrome/Edge 的查看、引用和反馈；完整批准/交付使用桌面流程。不由视口替代服务器权限 |
| Safari 与 iOS WebKit | 首版不承诺完整支持；iOS Chrome/Edge 也不能用桌面 Chromium 测试代替证明 |
| 代表视口 | 1280×800、1440×900、1920×1080；窄屏 360×800；另验缩放/普通内容 320 CSS px reflow，宽文档表格可在自身区域横向滚动 |
| 语言 | 全中文产品界面；时间/日期明确项目使用的时区；不新增国际化工程或语言切换 |
| 可访问性 | 以 WCAG 2.2 AA 为目标；验证键盘、可见焦点、名称/角色、错误提示与颜色之外的状态表达；自动诊断和人工检查共同进行 |
| 视觉验收 | 以已批准关键页面为参考，在固定测试数据与视口下比较；允许内容自然换行，不把每个像素差异当业务失败 |

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) 是目标依据；本提案不声明合规 PASS。Playwright Chromium 测试只能证明该测试环境；实际 Chrome/Edge、Windows/macOS、稳定版本窗口须有相应浏览器证据，不能以设备模拟替代完整平台矩阵。

目录显示总数、当前范围和是否完整，支持服务端搜索/分页；超过 200 份文件不预取全部正文。超过 30 处变化沿用已批准的集中目录和上下文布局。新报告或候选到达时保留当前页面及当前精确版本，显式提示可查看新版本。

## 4. 路由、读取与提交（Experience 提案）

| 页面 | 拟议页面路径 |
|---|---|
| 我的工作台 | /workbench |
| 新建与首轮 ZIP | /projects/new；/projects/:projectId/intake |
| 报告总览与启动核对 | /projects/:projectId/analysis/:reportId；/projects/:projectId/startup/:reportId |
| 本轮进度 | /projects/:projectId/executions/:scopeRequestId |
| 精确文件检查 | /projects/:projectId/files/:fileId/revisions/:revisionId |
| 项目交付准备 | /projects/:projectId/delivery |

路径为 UI 导航标识，不是最终 TypedReference。刷新/深链接重新经服务器授权并解析精确引用；查询参数仅携带安全的版本/目录筛选/稳定位置标识，不放客户正文、token、服务器路径或短期下载 URL。保留旧请求/版本，不用 `latest` 替换正在审阅对象。

TanStack Query 缓存键包括会话代次、Principal、Enterprise/Project 和对象精确版本；服务端返回的 authority/freshness/watermark 决定业务可信度，不能以客户端 staleTime 替代。切项目、登出、失权时取消请求并清理相应缓存；采用会话代次检查，迟到响应也不能重填旧用户/旧项目缓存。权限变更后失败即停止读取/操作，不展示失权内容作为离线副本。

活跃执行页初始读取间隔建议 5 秒，临时失败退避至 10/20/30 秒；隐藏标签页停止轮询，重新聚焦读取当前状态。授权错误不重试；普通只读请求最多一次额外重试；业务 Command 自动重试设为 0。精确 Revision 不因后台轮询被替换。这些是首版可调参数，需容量与真实延迟验证，见 [TanStack Query 默认行为](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)。

提交保存稳定意图/幂等键，经服务器返回原请求引用。读取超时初值 15 秒、Command 回执等待 30 秒；回执超时只标 UNKNOWN，不表示 Runtime 被取消。恢复查询只读原请求，不换键重发；缺失恢复公开 Query 时该操作不能正式接入。上传超时/大小限制由 owning 上传能力另行冻结，不把长上传套入 30 秒执行回执窗口。

首版不持久化查询缓存、token 或完整客户内容到 localStorage/IndexedDB，也不增加离线 Service Worker。开发替身只在明确开发/测试模式启用；正式构建缺服务或登录失败必须报错，不能 fallback 到 mock。个人草稿与请求恢复由服务器 owning 能力保存；技术 Session 内存不承担草稿或业务请求记录。

## 5. BFF 与安全方案（UI-DG-003 提案）

### 5.1 会话与 OIDC

独立 BFF 复用 NestJS/Fastify，首版单进程部署。建议用**进程内有界技术 Session 存储**，保存随机会话 ID 对应的 OIDC token、CSRF secret 和有效期；不为首版新建 Redis 或 PostgreSQL Session Repository。Session 不含业务草稿、批准或请求事实。重启后所有用户重新认证；重登后从 Core 回读既有提交，不能重新启动原任务。以后需要不中断重启或多实例时另审共享技术存储，本基线不承诺 HA/横向扩容。

- Session ID 使用密码学随机至少 32 字节；Cookie 仅携带 opaque ID：`__Host-zhiju_session; Secure; HttpOnly; SameSite=Lax; Path=/`，不设置 Domain。认证成功、重新认证时换 ID；旧 ID 作废。
- 空闲初值 30 分钟、绝对最长 8 小时，且服从更短 IdP 策略。后台轮询不续空闲期；续期依据显式用户活动，通过同源受 CSRF 保护的技术请求节流处理。过期需要重新认证。
- 使用 Authorization Code + PKCE S256；固定 issuer/client/callback allowlist，不从请求 Host 推导回调。state、nonce、PKCE verifier 单次使用，交易最长 5 分钟并通过受保护交易 Cookie 绑定发起浏览器；多标签页交易分别关联，拒绝重放/串交易。
- OIDC confidential client 凭据只由部署 Secret 通道注入 BFF；不读取或写入本次设计。首次真实环境锁定 Keycloak 26.7.x patch/digest 与 client/API audience；不以占位 issuer 或 dev realm 证明真实配置。
- 同一 Session 的 token refresh 串行合并，失败使 Session 失效；禁止无限重试。返回位置仅允许预设同源相对页面路径，防止开放重定向。
- 登出使用受 CSRF 保护的 POST，先撤销本地 Session/Cookie，再尽力调用 OIDC revocation；IdP 失败也不能恢复已登出的本地 Session。不宣称现有 Stateless API token 获得即时全局撤销能力。

实现参考 [openid-client](https://github.com/panva/openid-client) 和 [OWASP Session 指南](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)；内存存储、超时与重启语义是本项目的拟议取舍，本轮已获用户批准，独立审查与实测仍需完成。

### 5.2 CSRF、公开 API 与身份

每个 Session 生成独立随机 CSRF token，经已登录 session bootstrap 返回，响应 no-store，Browser 仅内存持有。所有业务写、草稿写、上传、登出及技术续期同时要求 `X-CSRF-Token`、精确 Origin、固定外部 Host allowlist；缺失/不符直接拒绝。登录回调仅按已绑定 OIDC 交易验证；SameSite 不能替代 CSRF 协议，见 [OWASP CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。

BFF 只代理明确允许的公开操作/版本；目标上游固定配置，不接受用户 URL/CLI 路径，也不向 Browser 开放整个 Registry 的任意 dispatch。将已验证 Human OIDC access token 交给 API；API 独立校验 issuer/audience/签名/期限，并由可信入口经 IdentityPolicy 形成 ActorSnapshot 与 AuthorizationDecision。Browser/BFF DTO 不能自报 Human、actingFor 或业务权限。业务授权、幂等、CAS、回执仍由 Core 强制执行。

上传只经 owning Staging/资料接收公开能力，BFF 有界流式转发，不在内存缓冲完整 ZIP、私自解包或直写对象存储。解包后的路径仅在受控 Host/Runner 内使用，页面通过正式引用查看资料。包大小/解压边界、清单及接纳规则是 D14/IG 的开工依赖，不在这里制造私有业务接口。

### 5.3 内容、下载与遥测

受保护页面/BFF 响应 `Cache-Control: no-store`，静态带内容 Hash 的资产可以缓存；`Referrer-Policy: no-referrer`。拟议 CSP：

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; object-src 'none';
base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'
```

样式的 `unsafe-inline` 仅为 Radix/动态布局内联样式兼容，禁止客户 CSS/HTML；脚本无 inline/eval。真实组件若无需该例外可收紧，不能为图省事放开脚本。CSP 最终是否可用须实测。首版不用第三方 analytics、iframe 嵌入或外部字体；Trusted Types 是否必要按实际 sink 评估，不声称已实现。

Markdown 使用 react-markdown + remark-gfm，禁用原始 HTML（skipHtml）、MDX、rehype-raw 和任意 dangerouslySetInnerHTML；定制链接只允许已核验 http/https 或授权的同源引用，默认不加载客户外部图片。Stable location、Diff 和 canonical Hash 来自服务器，Browser 渲染不能产出正式修改证据。链接/下载接口重新授权精确 Revision，短期 URL 不进入日志、长期存储或可分享深链接。

前端/BFF 遥测采用字段 allowlist：安全错误码、correlationId、操作/版本、耗时；不记录 token、auth callback 完整 URL、文件名、客户正文、原始错误对象、下载 URL 或原始 Payload。认证回调 URL 的代理访问日志也必须脱敏。测试 trace/screenshot 用合成或批准的脱敏资料，不能自动上传真实客户内容。

## 6. 首条真实链路与接口差距

首个用户目标是：顾问提交客户 ZIP → 服务器受控 Runner 读取客户与固定模板 → 返回接纳后的报告 → 原布局核对启动信息与逐份选择 → 明确确认 → 观察本轮真实请求与文件进度。独立 Runner 测试只提供报告设计依据，不能替代平台接纳、授权和持久化。

本轮核查主工作区 `main@b6e1f93d7a79e6334622c55b94f124750143949e`：`apps/api/src/app.module.ts` 仍只注册 HealthController。下表已有操作是 Catalog/module 能力，**均不因此成为现成业务 HTTP endpoint**。

| 页面能力 | 查见现行公开能力 | 正式接入前需要补齐 |
|---|---|---|
| 身份/Scope | identity.resolve_principal@1.0；identity.check_enterprise_access@1.0；identity.check_project_access@1.0 | HTTP 可信身份入口、精确权限/错误映射；不信任 Browser actor |
| 工作台/项目页 | project.get_project_board_slice@1.0；execution.get_task_board_slice@1.0 | 都是有 Scope 的查询；授权项目集合与跨项目汇总来源需 owning 确认，BFF 不扫库拼项目 |
| 创建企业/准备项目 | project.create_enterprise@1.0；project.create_project@1.0 | 后者需要三类真实 PROJECT_START 引用，不能伪造 Snapshot 用作 PREPARING 创建；D14 准备入口待注册 |
| ZIP 资料提交 | project.register_source_material@1.0；project.accept_source_material@1.0；project.propose_customer_material@1.0；project.confirm_customer_material@1.0 | 包接收/解包清单、PreparationContext 和报告接纳需 D14/RD-01/IG owning 增量；不用旧 Command 伪造任意 ZIP 功能 |
| 分析与启动核对 | [报告 v0.2](runner-analysis-report-v0.2.md)、[启动 DTO](workspace-startup-review-v0.1.md) 草案 | 字段/词表、准备上下文、Human 决定、真实引用、协调回执及恢复公开能力尚未注册 |
| 升级与进度 | execution.create_task@2.0；execution.get_run_state@1.0；execution.get_usage_and_provenance@1.0 | create_task 不能默认绕过现行 ACTIVE 约束；整份范围/多轮关联及原请求恢复要以 owning 冻结合同为准，进度不能伪造百分比 |
| 后续文件检查/交付 | artifact.get_revision_diff_inputs@1.0；release.create_release_draft@1.0 | 前者不是完整变化目录 DTO，后者不是项目批次交付包；已有产品布局继续保留，相应真实接口按依赖接入 |

首轮真实服务只选一个公司默认 Runtime/Profile 并锁定 CLI/模型/提示词/Skill/MCP/模板/规则版本；目标名单继续为 oh-my-pi、pi、qoder-cli、Claude Code。首个 Profile 的明确选择、真实输入/输出与 Host 接纳仍是 Runtime 开工条件，不在用户页面增加选择器。Runner 当前固定 v0.1 校验/渲染不能直接拿 v0.2 schema 当作实现。

首条链路不要求先实现全部意见草稿、批准和批次交付接口；这些是已确认 MVP 的后续接入范围，不能以初始链路通过声称全部 MVP 已完成。结构化组织/目标等候选尚不在 v0.2 TEXT 企业事实覆盖内，字段冻结前需明确首条真实项目的可支持范围，不虚构客户事实填过启动条件。

## 7. Spec Delta 与开工顺序

| 文档/Owner | 本轮增量 |
|---|---|
| Technology Baseline / Implementation Plan | 记录 UI-DG-001～003 的用户批准与首装基线；独立审查、安装和实际 Gate 验证不因此变成 PASS |
| Deployment/Security Baseline | 关联本提案的独立同源 BFF、技术 Session 重启语义、OIDC/CSRF/CSP/代理/日志方案；不修改既有 API stateless 或业务身份冻结规则 |
| UI01 Spec/Test | 同步应用、内容/缓存/提交边界与首版验收场景；正式结果保持 NOT RUN |
| 产品提案 | 固定 V1 布局与当前 first-use 目标，旧采购闭环映射作为后续审阅能力约束，不重新批准旧布局 |
| EP/TE/IG/Runtime | 仅引用现有 D14/RD-01 依赖；本轮不新增字段注册/生产实现，不替这些 Owner 定义新私有业务 Command |

实施顺序：

1. 保存本轮设计并同步当前 Core 基线，再复核 owning 合同。frontend 分支 `codex/frontend-mvp-design@6b6d533409171ba11a429d042c84858e3b035dae` 当前比本地 main 少 308 个提交、独有 1 个设计提交，且有未提交设计。同步必须先保留这些内容，避免把旧版 Core 文档整体覆盖到新 main；不在本轮擅自提交、merge/rebase 或改 main。
2. 本提案获技术批准及所需独立审查后，可准备 **Web/BFF 工程外壳**：构建/依赖隔离、既有布局的 React 页面、开发替身、安全会话与错误边界。先区分固定样例页和真实接入；该结果是工程进展，真实 OIDC 验收仍需指定环境。
3. 将首条链路的 D14/RD-01 owning 字段、HTTP 可信入口、恢复查询及一个真实 Runner Profile 闭合；其依赖明确 READY 后才生成相应执行 Issue。可与外壳开发并行，不能要求 BFF 暗补业务能力。
4. 经公开 HTTP 打通真实首轮链路；记录确切请求/输入/报告/范围及版本。随后接入文件检查、意见、批准和项目交付，沿已批准页面走，不重新展开广泛布局选择。

不把 IM-06 的旧执行快照当作仍未结束的前置。当前 main roadmap 已确认 IM-06 工程退出，但这不使 UI Gate、HTTP 入口或新启动字段自动 READY。用户于 2026-10-08 明确“按这份提案收口，然后准备正式开工”，本次据此冻结工程方向并准备实施边界。该批准不把 D14/RD-01 草案升级为已注册契约，不自动授权 Git commit/push/PR/merge，也不表示所有业务依赖已完成。

## 8. 可验证的首版验收

正式矩阵由 [UI01 Test](../module-tests/Module-Test-UI01-WorkspaceUI.md) 维护；实现前均为 NOT RUN。执行/验收证据随对应 GitHub Issue/PR 保存，不增设平行工程状态报告。

- 工程外壳：独立 build/typecheck、Browser 包不带私有模块/凭据；深链接刷新/前进后退和不存在页面正确；正式构建无 mock 自动回退。
- 会话：实际 OIDC 登录/失效/重新认证/登出、交易重放/错 nonce、refresh 并发与重启行为正确；失权、跨 Scope、CSRF/Origin/Host 拒绝可复现。
- 首条真实链路：固定真实输入/模板与 Runtime Profile，顾问完成 ZIP 接收、报告读取/缺口理解、启动核对和默认不选的整份文件确认；实际回执与进度可从 Core 回读。部分失败保留成功事实，超时恢复原请求而非多发任务。
- 内容与规模：200+ 文件目录分页、30+ 变化上下文、恶意 Markdown、宽表、迟到响应/缓存隔离、新版本到达保留当前页；没有“全部”误报或 raw HTML 执行。
- 浏览器/人验：批准范围的实际 Chrome/Edge 版本；键盘/焦点/错误恢复与可访问性人工检查；用户用脱敏真实链路完成一次独立业务验收。Mock、axe 或自动浏览器不能代替此验收。

本轮主要为 Markdown 工程提案与规格路由，可做链接、结构及候选版本元数据诊断。独立的未注册 DTO `.vibe/decisions/workspace-startup-review-v0.1.types.ts` 不属于应用 TypeScript project，精确排除该文件的应用 lint，并保留独立 `tsc --noEmit --strict` 与 Schema/样例检查；不豁免生产源码、公开 SDK 或 contracts lint。frontend 当前仅配置 `vibe verify full --json`，既有工作区还包含原型 JS/schema/DTO 等混合变更；不能凭空执行 docs target 或用本轮定向检查宣称 whole-branch full PASS。后续保存/同步时按当时变更范围使用有效配置的目标；Persistence、真实 OIDC/API/Runner/Browser/Manual 的证据分别保留。


## 9. 正式开工边界

正式实现使用从 `main@b6e1f93d7a79e6334622c55b94f124750143949e` 创建的 `codex/workspace-ui-mvp`，工作区为 `/Users/galendai/.codex/worktrees/workspace-ui-mvp/zhiju-business-core`。旧 `codex/frontend-mvp-design` 保留全部设计与未提交内容；新工作区带入 UI 设计及匿名演示材料，沿用当前 Core 源码、Catalog、迁移、工具链和验证配置，不复制旧 Core 实现或主工作区未提交改动。新旧工作区的设计文件还未形成 Git 提交，引用它们的执行 Issue 不能把未发表路径当作已可访问的 authority。

首个工程目标与退出条件由 [UI01 Spec 的首个工程交付目标](../module-specs/Module-Spec-UI01-WorkspaceUI.md#首个工程交付目标)及 [UI01 Test 的工程外壳场景](../module-tests/Module-Test-UI01-WorkspaceUI.md#工程外壳的首版验证)维护。先交付独立 Web/BFF 构建、页面路由/基础组件、开发样例隔离与边界检查；真实 OIDC 会话及首条真实业务链按其环境/公开契约依赖继续接入。工程外壳完成不表示 UI-WI-02 的真实登录/授权条件、整套 MVP 或人工验收完成。

本轮检查发现当前架构工具仅扫描 `.ts`，且不检查 `apps/*` manifest 依赖。工程外壳必须补齐 `.tsx` 与应用依赖检查，明确 Web/BFF 的禁止依赖，不能沿用旧检查的 PASS 推断 Browser 依赖隔离。无需为此先搭建一个通用规则引擎。

人类技术选择已完成；独立设计审查仍为 NOT RUN。依赖安装、正式应用实现与可执行 Issue 的 READY 判断在适用审查及有效工程基线满足后进行；不再重复征询已批准技术选择。准备阶段不写业务代码、不注册草案字段、不连接真实 Runtime 或读取凭据。
