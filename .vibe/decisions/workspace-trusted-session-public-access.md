# Workspace 可信 Human 会话与公开接入 Spec Delta

日期：2026-10-09。状态：`T2 / HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / REGISTERED AND IMPLEMENTED (#266) / EXECUTION EVIDENCE IN ISSUE-PR / CONTROLLED KEYCLOAK JOURNEY AND BUILT-BROWSER JOURNEY EXECUTED IN THE EXACT-HEAD PERSISTENCE GATE (ISOLATED SETUP, PINNED IMAGE) / PRODUCTION DEPLOYMENT, ACTUAL CHROME-EDGE PLATFORM MATRIX AND MANUAL ACCEPTANCE NOT RUN`。

本文交付 [Issue #258](https://github.com/qzhike/zhiju-business-core/issues/258) 的字段级设计。对照 `main@15c085354056ab327e03352c32020010cc11285b`：API 只有 HealthController，Web/BFF 只有工程外壳；Catalog 注册不等于 HTTP handler 存在。保留已批准的 [UI-DG-003](workspace-ui-engineering-baseline.md#5-bff-与安全方案ui-dg-003-提案)、Keycloak、同源 BFF、单进程有界技术 Session、30 分钟空闲/8 小时绝对期限与现有布局。本文新增的接口、参数和目录能力须经精确修订的独立设计审查及人类技术批准才能冻结；不宣布任何依赖实现 READY。

唯一业务权威仍为 [IP Spec](../module-specs/Module-Spec-001-IdentityPolicy.md#workspace-可信-human-入口与目录授权提案258)、[EP Spec](../module-specs/Module-Spec-002-EnterpriseProject.md#workspace-授权项目目录提案258) 和既有 [D14 Delta](d14-rd01-first-customer-flow.md)。本文拥有技术认证、transport 字段映射和跨边界 trace，不重新定义 TE/IG 的 Run、上传接纳、业务 Process 或 Receipt。实际部署地址、Keycloak patch/digest、凭据和 handler 均未提供，不使用占位配置证明真实接入。

独立设计复审与明确人类技术批准均绑定 `6bb86edbdf9af32fde86b8f86d88cb87f5bcb511`，依据见 [正式 Review](../reviews/pr-263/Review.md#人类技术批准与最终结论6bb86edb) 和 [批准 comment](https://github.com/qzhike/zhiju-business-core/pull/263#issuecomment-6081005384)。本设计已获批准；注册、实现及运行证据仍分别保持未交付/NOT RUN。

## 1. 信任入口与配置接口

未来 `WorkspaceTrustConfig` 是部署注入、启动时验证的封闭配置。BFF 与 Core 各自校验同一 `trustConfigVersion/hash`；Browser 不能选择 issuer、client、audience、上游或认证算法。配置变更使技术 Session 失效，历史 Actor/Decision/Receipt 不改。

| 配置字段 | 必须满足的绑定 / 失败行为 |
|---|---|
| `publicOrigin; allowedHosts; trustedProxyPeers` | 一个固定 HTTPS origin；Host 与端口精确匹配，无 wildcard。仅接受固定代理 peer 重写的转发字段；无受信代理时用连接本身，不能信任任意 Forwarded/X-Forwarded-* |
| `issuer; providerCode; discoveryUrl` | 单个固定 Keycloak realm issuer，字符串精确比较、不改大小写/尾斜杠；providerCode 为注册的 Keycloak provider；discovery issuer 必须相同 |
| `clientId; apiAudience; allowedAzp; clientAuthSecretRef` | confidential BFF client、独立 Core audience、唯一允许的 BFF azp；Secret 通道仅注入 BFF 内存，不把 SecretRef 解析能力交给 Browser。实际值须在安装锁定，无默认 dev realm/client |
| `callbackUri; postLogoutRedirectUri; returnRoutePatterns` | 前两者为 publicOrigin 下固定 `/bff/auth/callback`、`/workbench`；return route 仅既有 UI 页面及安全 request ID，无 scheme、`//`、反斜杠或解码后的外站路径 |
| `oidcEndpointAllowlist; apiBaseUrl; apiGatewayPeers` | discovery/auth/token/JWKS/revocation/end-session 的精确 HTTPS URL 与 Core 固定 origin/prefix；endpoint 不符、跨站 redirect、TLS 失败直接拒绝。Core 的 workspace 入口只接受固定 BFF 技术 peer（受信 TLS 客户端），并独立验证 Human access token |
| `idTokenAlgorithms; accessTokenAlgorithms; accessTokenMaxAgeSeconds` | 首版提案各固定 `RS256`，最长 access token 300 秒；拒绝 none、对称 key 混用、ID token 当 API bearer、service/client-credentials token 当 Human；改变算法另审配置和反例 |
| `clockSkewSeconds; jwksTtlSeconds; httpTimeoutSeconds` | 首版提案 30 / 300 / 10 秒；期限及依赖错误 fail closed。JWKS/OIDC JSON 响应各 ≤64 KiB、JWKS ≤64 keys，JWT ≤16 KiB；先限流读响应再解析；均为待批准参数，不是已运行事实 |
| `maxSessions; maxLoginTransactions; maxTransactionsPerBrowser; maxConcurrentUploads` | 首版提案 1000 / 2000 / 4 / 4；Session/交易字段封闭、token总长度受OIDC响应上限约束，过期条目定期清除；容量满返回安全 503，不驱逐活跃 Session 或改为无限存储；技术限流不发业务权限 |

BFF 校验 ID token 的签名、issuer、client audience、azp、exp/iat、nonce；Core 校验 access token 的签名、issuer、API audience、允许 azp、token type、exp/nbf/iat 与最长寿命。BFF 要求 exchange/refresh 返回的 access token 与 ID token/既有 Session 的 issuer、subject 相同；本 profile 要求 Keycloak access token 的 `typ=Bearer` claim，JOSE header `typ=JWT`，实际 realm 不符则调整并批准 profile，不能跳过校验。Core 不接收 Browser 的“已验证”标记。主体稳定键采用 `(iss, sub)`，email/displayName/Realm Roles 只可作展示；依据 [OIDC Core 的主体唯一性和 token 验证](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability)，具体算法/寿命为本项目提案。

两端各缓存固定 issuer 的 JWKS；已知 kid 只在缓存有效期内使用。未知 kid 合并一次受限刷新（每 issuer 至少间隔 30 秒），重验一次仍未知/错签名则 401；刷新失败且没有有效匹配 key 则 503。缓存到期不能无限用旧 key，移除 key 后不使用过期副本；不跟随 JWT 的 jku/x5u 或用户 URL。Keycloak 的证书、refresh、revocation endpoint 能力见 [官方 OIDC endpoint 文档](https://www.keycloak.org/securing-apps/oidc-layers)。这些规则不声称获得 token 即时全局撤销能力。

## 2. Core 身份与每次授权

```text
Browser Cookie → BFF technical Session → access token + technical session binding
  → Core token verifier → VerifiedOidcContext（仅受信进程可构造）
  → IP resolveVerifiedHuman → ExternalIdentityLink → ACTIVE HUMAN Principal
  → IP createActorSnapshot（本次精确 Scope + AuthenticationContext hash）
  → IP 当次 operation Decision → owning Handler 重验 → owning Result/Receipt
```

| 受信接口提案 / owner | 输入与输出 / 不允许的替代 |
|---|---|
| `VerifiedOidcContext` / Core authentication | verifier 产生 issuer-config hash、subject lookup 输入、audience/client、token digest、issuedAt/expiresAt、authTime/sid（若有）、validatedAt、BFF session-binding hash；无 raw token 持久化。token digest 不作为授权凭证 |
| `resolveVerifiedHuman(context)` / IP 受控身份 Port | `identityKey={providerCode:固定值,accountExternalId:verified issuer,subjectExternalId:verified sub}`；使用现有加密原值/密钥化 lookup，返回真实 PrincipalRef + linkRef + kind/status；只可读本次已验证主体，不开放任意身份目录 |
| `AuthenticationContext` / Core + IP | 规范认证摘要绑定 issuer config、实际 token digest/期限、lookup hash、随机 session binding；cv1 hash 构成精确 `authenticationContextRef`。Session binding 由 BFF 每次登录随机 ≥32 bytes，只有固定 BFF peer 可传；公网同名 header 拒绝/在代理入口剥离 |
| `createActorSnapshot` / IP | 从 Principal 权威 kind/status 与当次 Enterprise/Project Scope 形成真实 snapshot/hash；Browser 不传 actor、actingFor、roles、PolicySnapshot 或 Decision；身份摘要/旧 snapshot 不替代本次解析 |
| `authorize_command` / IP；当前 Query check / IP | 固定 operation/version/Purpose/action/完整 target/Scope/payloadHash/Actor/认证上下文，最长至 token/Decision 较短期限；owning entry 在幂等 claim 前和保护性读/写前重验当前 Grant/Policy、撤销和期限。普通 check 的 ALLOW 不能代替实际 operation Decision |

未关联身份：返回已认证但不可进入的安全 403，无 JIT 创建/邮箱合并；冲突、撤销 link、非 ACTIVE/非 HUMAN 同样拒绝，不泄露另一 Principal。IP 不可用返回 503，无 fallback Human。首业务 Principal/Role 复用受审计、限期、单次 bootstrap claim；Keycloak bootstrap admin 不自动成为业务管理员。其后由已有受权操作者经 IP register/link/assign/grant，核验该 issuer-subject 的身份依据后显式关联；这些管理操作不在 Browser allowlist。link 冲突不覆盖，变更主体必须走受审计管理流程。

Core 每次解析当前 link/Principal，不能仅相信 BFF 缓存的 principalRef。Role/Capability 撤销使下一检查点拒绝，但历史 Actor/Decision 不改。Keycloak token/IdP session 撤销在 stateless API 下最迟由短 token 到期或 BFF 下一次 refresh 发现（含 30 秒时钟容差）；本轮不新增 introspection、全局 denylist 或 back-channel logout。登出立即失效本 BFF Session，不能保证已被窃取的 bearer 即时失效。切 Scope 不改认证主体；同一技术 Session 的多 Tab 以请求内精确 Scope 工作，不设置可被别 Tab 改写的全局 activeProject。Project B 的 snapshot/Decision 必须重新产生，Enterprise Grant 不能自动覆盖 Project。

## 3. 登录、刷新、登出与重启

| 技术状态 / 路由 | 绑定和转换 |
|---|---|
| `GET /bff/auth/login?returnTo=…` | 校验 Host/安全 returnTo。随机 login transaction、state、nonce、PKCE verifier/challenge S256；5 分钟 TTL，记录本交易的 expectedIssuer/trustConfigHash。`__Host-zhiju_login; Secure; HttpOnly; SameSite=Lax; Path=/` 仅含随机 browser-binding ID；每个 state 对应独立 transaction，不让多 Tab 共用 nonce/verifier |
| `GET /bff/auth/callback` | 固定 callback，仅接受下述成功/失败 query 形状；先验证 browser Cookie+state+期限+响应 iss 与交易/config 绑定，原子消费 transaction，成功才 exchange 并验证 ID token nonce。缺 Cookie、缺/错/重复 issuer、重复/串 state/nonce 拒绝且零 Session；exchange 超时不重用已消费 code，重新登录。callback 是唯一无需 Session/CSRF 的认证回调例外 |
| Core identity bootstrap | BFF token exchange 后调用固定 `POST /api/workspace/session-bootstrap` 技术认证桥，仅固定BFF peer+实际access token+技术binding，无Browser身份字段；Core→IP resolveVerifiedHuman 返回当前安全Principal摘要。不是Business Catalog操作、不创建Role/Grant；无关联403，依赖503，不建立可进入业务的Session |
| `AUTHENTICATED` | token与Core身份bootstrap均成功后替换 Session ID、旧 ID 作废；并发 callback 对同一 browser 代次只接受一 winner，另一重新登录，不相互覆盖用户。session bootstrap 只返回安全 Principal 摘要、sessionGeneration、CSRF token、期限；随后通过目录 Query 进入工作台，后续仍重新解析当前身份 |
| `GET /bff/session`；`POST /bff/session/activity` | GET no-store，轮询不续空闲期；显式用户活动受 CSRF/Origin 保护，最多每分钟一次续空闲，不能延长 8 小时绝对期或更短 IdP 期限；不信任客户端时间 |
| `REFRESHING` | 同 Session 一个 in-flight promise，其他请求等待最多 10 秒；refresh 前检查 idle/absolute expiry。原子换 access/refresh token 并重验主体和 claim；auth context 更新，后续重新签 Actor/Decision，不延长绝对期。失败/invalid_grant/超时使 Session 失效，禁止重放不确定 refresh token；后台结果检查代次，不能复活已登出的 Session |
| `POST /bff/auth/logout` | CSRF/Origin/Host 校验后先删除本地 Session、清 Cookie，取消 refresh；再尽力固定 revocation endpoint。需要 IdP SSO 退出时仅用标准 RP-initiated end-session 固定client_id/redirect，可由IdP要求用户确认；不把id_token_hint/token放进Browser URL，不调用legacy logout。失败不恢复本地 Session，不取消已提交业务请求 |
| `EXPIRED / RESTARTED` | 30 分钟空闲、8 小时绝对期、更短 IdP 期限或进程重启后 401 + UI_REAUTH_REQUIRED；旧 Cookie/transaction 不可恢复。重新登录换 Session ID/代次，读取原 Core 请求与当前权限，不能重建/重新提交业务 intent |

回调 profile 固定 `response_type=code`、`response_mode=query`、scope 含 `openid`，要求 discovery 的 `authorization_response_iss_parameter_supported=true`。Keycloak 默认响应含 [iss](https://www.keycloak.org/docs/latest/upgrading/index.html#added-iss-parameter-to-oauth-2-0openid-connect-authentication-response) 和 [session_state](https://www.keycloak.org/docs/latest/upgrading/index.html#added-session_state-parameter-to-openid-connect-authentication-response)；不以关闭这两个标准参数的兼容开关完成接入。接受集如下，不接受 form body、fragment 或 JARM：

| callback query 形状 / 参数 | 接受与处理 |
|---|---|
| 成功：`code; state; iss; session_state?` | code/state/iss 各一个非空值；先完成交易绑定和 iss 校验，再单次消费交易、PKCE exchange、token/nonce 验证与 Core bootstrap；其他 error 字段不得出现 |
| 失败：`error; state; iss; error_description?; error_uri?; session_state?` | error/state/iss 各一个非空值，code 不得出现；仍须相同 Cookie/state/期限/iss 校验并单次消费交易。零 token exchange、零 Core bootstrap、零新 Session；error 只映射固定安全“登录未完成”提示，不展示/记录原 error、description 或 URI，不导航/请求 error_uri |
| `iss` | 按 [RFC 9207 §2.4](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4) 仅做一次 application/x-www-form-urlencoded 解码，字符串精确等于发起交易的 expectedIssuer 及固定 discovery/config issuer；大小写/尾斜杠不归一化。成功与失败均必填；缺失、空值、重复（即使值相同）、不匹配或交易 config 已变直接拒绝，不 exchange、不信任该 error、不建立 Session |
| `session_state` | 可缺省；出现时仅一个非空 opaque 值，解码后 UTF-8 ≤1024 bytes；校验长度/重复后丢弃，不持久化、不当作 state、nonce、token sid、Session ID 或认证/授权依据 |
| 通用解析边界 | raw query ≤16 KiB；解码后 code ≤4096 bytes，state/error ≤256 bytes，iss/error_description/error_uri 各 ≤2048 bytes；可选 description 可为空，error_uri 若出现须非空但始终丢弃。任何未知键、重复键（含解码后同名）、必填空值、非法编码、控制字符或超限均安全 400，零 exchange/bootstrap/新 Session；按键收集后校验，禁止取第一个/最后一个值或二次解码。响应及 redirect 沿 no-store/no-referrer，诊断不保留 callback query |

技术 `SessionRecord` 仅含 opaque ID、generation/browser binding、OIDC tokens、CSRF secret、created/lastActivity/absolute expiry、refresh lock；`LoginTransaction` 仅含认证字段与安全 return route。业务 payload、草稿、selectedFileIds、requestRef/原键、Receipt 和 Process 步骤禁止进入此存储。草稿若尚无 owning 公共持久化能力，只在当前页面内存保留并明确未保存；跨设备/重启恢复从 Core 已提交意图查询，不伪称恢复未提交草稿。refresh 单次消费与失效策略是项目提案，参考 [OAuth Security BCP 的 refresh token 保护](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14)。

## 4. 授权目录与工作台来源

新增唯一公共业务能力提案为 EP `project.find_workspace_projects@1.0`：AUTHORITATIVE、自身身份的有限目录；字段与分页唯一维护于 EP Spec。它返回当次许可的精确 Enterprise/Project ref、安全名称/编号、项目状态和版本，不返回别人的授权集合、客户材料、全局总数或业务完成判断。该新 Query 尚未注册；没有它时首版工作台入口不可用，不用 demo 列表或 BFF 扫库替代。

Core 自身目录入口以 `scopeRef={}` 的专用 self-discovery 接受集处理已验证 Human，不能把空 Scope 解释成任意业务访问。IP 内部 `discoverWorkspaceProjectScopes` 只从该 Principal 的当前 exact PROJECT Grant/Policy 得到候选引用，不读 EP；EP 对每个候选取得独立 `project.workspace.discover` 当前 Decision，再在该 Enterprise+Project RLS Context 读取自己的项目摘要并在返回前重验。无空 Scope ActorSnapshot/业务 Decision、无全库 EP transaction、无 Enterprise→Project 权限继承。首次 identity bootstrap 和这个专用入口不能假装现有 scoped Port 已经支持无 Scope；具体实现需独立注册、权限/持久化测试。分页绑定稳定的登录 sessionBindingHash/代次，不能绑定每次验证变化的 validatedAt；每次IP Decision仍绑定本次完整认证摘要。

目录合法分页一律为 `OK + Page`：达到 200 项/5 秒扫描预算时允许 `items=[] + nextCursor`，表示本页无匹配但枚举未完。Browser 以该绑定游标继续逐页读取，零累计项时保留 LOADING，不显示完整 EMPTY，不为凑非空页突破单请求预算。仅同一有效游标链枚举完整、末页省略 nextCursor 且累计可见项为零才显示 EMPTY；空末页不清空之前的非空项。每页保持当前授权、固定观察水位和变更拒绝规则，错误不能当作枚举结束；业务字段及完整规则以 EP Spec 为准。

目录权限不包含 board/content/start 权限。BFF 只把目录结果展示为选项；选中后用各自当前授权的 `project.get_project_board_slice@1.0`、`execution.get_task_board_slice@1.0` 组合指定 Project 的安全看板，保留各自 consistency、水位、freshness、完整分母。首版跨项目工作台先显示项目卡片，按显式选择/可见卡片有限读取，不把分页的几项 Task 加起来称为全部项目总数。卡片标题不匹配名称搜索不赋新权限，PREPARING 只有相应 D14 可用动作。依赖失败为 ERROR/503，不冒充 EMPTY。

### #277 未批准的准备入口补充

[准备入口 Delta](preparation-entry-bootstrap.md) 拟新增 EP find_preparation_enterprises 的 self Enterprise 候选接受集及 IP 独立准入/创建者配置，空 Scope 不再只靠既有 Project 目录完成创建；这些是明确待审增量，当前 #258/#266 实现并未获得该能力。新增唯一 Browser Command 候选为 `integration.restart_customer_zip_upload@1.0`，对应同形 `/bff/commands/…` → `/api/commands/…`；其原 intake/generation/CAS/一次重传字段归 [IG #277](../module-specs/Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案)。Query 不续签 token，BFF 不补授权、不重写原 payload/hash。以下已批准表及空 Scope 规则继续是当前实现基准，#277 获独立审查与精确修订 Human 批准后才可注册这一补充。

## 5. 有限公开路由与 Envelope 映射

下表是**完整的首版候选集合**，不是运行中的 handler 清单。`R` 表示当前 Catalog 已有该 version、HTTP 仍 NOT RUN；`P` 表示已批准 D14 设计中的未注册 proposal；`N` 为本 Issue 新提案。启用须同时满足配置 allowlist、exact Registry/schema/result、owning handler 和批准接受集；P/N 缺任何项一律不可用。Browser `POST /bff/commands/{operation}/1.0`、`POST /bff/queries/{operation}/1.0` 仅接受下列逐字 token，映射固定上游同形 `/api/…`，不作为 Registry 任意 dispatch。IP 管理/Decision、EP start/accept/source、TE readiness/run/receive、IG dispatch 等均不暴露。

URL operation/version/kind 必须逐字等于输入commandType/commandVersion或queryType/queryVersion，含编码分隔符/重复解码/不符则400；仅允许一轮规范路径解析，不接受body替换route。Core再次独立执行相同绑定，不能借BFF许可的route派发另一operation。

| kind / public operation@1.0 | owner / 状态 | 用途与服务器授权 |
|---|---|---|
| Query `project.find_workspace_projects` | EP / N | 自身有限目录；上述 IP current discovery，不能 caller 指定 requester |
| Query `project.find_preparation_enterprises` | EP / P | D14 当前可选客户，不用名称确定身份 |
| Command `project.request_project_preparation` | EP / P | 明确 NEW/EXISTING 原准备意图，各步独立授权 |
| Query `project.get_project_preparation_request` | EP / P | 原准备请求/原键，当前 read 权限 |
| Command `integration.request_customer_zip_intake` | IG / P | 同 Project 当前 Human 接纳权；只创建固定 intake |
| Query `integration.get_customer_zip_intake` | IG / P | 同 intake 状态/manifest/Receipt，不解析 ZIP |
| Query `project.get_startup_review` | EP / P | 精确 report/binding/依据/allowedActions；当前 read 权限 |
| Command `project.request_startup_confirmation` | EP / P | Human-only 原 binding/完整文件集合，非业务自由代理 |
| Query `project.get_startup_request` | EP / P | 原请求/原键，UNKNOWN/PARTIAL 回读 |
| Command `project.resume_startup_request` | EP / P | 原请求/原键/封闭 action，当前续步授权 |
| Command `project.request_initial_scope_confirmation` | EP / P | 已 start/首轮未接收窗口，Human-only 新 scope 意图 |
| Query `project.get_initial_scope_request` | EP / P | 原 scope request/原键，当前 read 权限 |
| Command `project.resume_initial_scope_request` | EP / P | 原 scope 意图仅续 pending step，无重 start |
| Query `execution.get_initial_work_scope_state` | TE / P | 精确 start binding，只读初轮接收事实 |
| Query `execution.get_work_scope_progress` | TE / P | 原 workScope 的真实阶段/文件进度/水位 |
| Query `project.get_project_board_slice` | EP / R | 指定 projectRef、既有过滤/page 与允许 consistency |
| Query `execution.get_task_board_slice` | TE / R | 指定 projectRef，既有精确 target/Purpose/当前 Human 授权 |
| Query `quality.get_evidence` | QG / R | 已接纳 report 引用的 exact EvidenceRef；当前同 Scope read；不新增 QG 写合同 |

`PUT /bff/customer-intakes/{intakeId}/zip` 是唯一 ZIP stream route，映射已批准 IG `PUT /api/customer-intakes/{intakeId}/zip`，不是任意 URL 转发。可用性同样依赖 IG owning transport；技术 session/auth 路由只消费 §3 的封闭字段，不注册 Business Core operation。未知 operation/version/HTTP method 返回安全 404/405，已知但尚不可用返回 503 + DEPENDENCY_UNAVAILABLE，无空成功或私有替代。TE `create_preparation_analysis_task / build_preparation_context / request_preparation_analysis / get_preparation_analysis_result` 的公开字段不等于Browser可调用；首版沿D14当次SERVICE/owning Process接受集使用，Browser不制造source/task或原Attempt恢复能力。

| wire 输入/输出 | 字段级转换与 owner |
|---|---|
| `WorkspaceCommandInput` | 仅 commandId/type/version、scopeRef、targetRef、expectedAggregateVersion?、idempotencyKey、correlationId、causationId?、requestedAt、deadline?、payload、integrity；CREATE 预分配 target UUIDv7、MUTATE 既有 CAS。Browser/BFF 不发送 actor/authorizationDecisionRef；未知字段（含伪 actor）拒绝，非静默覆盖 |
| `WorkspaceQueryInput` | 仅 queryId/type/version、scopeRef、consistencyRequirement、minimumWatermark?、asOf?、pagination?、correlationId、requestedAt、payload；requester/authenticationContextRef/Decision 由 Core 生成；directory 的空 Scope 是唯一声明的 self-discovery 例外 |
| BFF → Core | 传固定 Bearer Human token、受信技术 binding 与上述输入；不签业务 Envelope。Core 对实际 token/当前 Principal/完整 Scope/target/schema/hash 验证，IP 生成 Actor/Decision 后组成完整共享 Envelope，owning entry 再验。保留原 commandId/key/payloadHash/CAS，不换 target，不给批准 payload 加默认值 |
| Command / Query response | 按共享 CommandResult/QueryResult 和注册 resultSchema 原样保留身份/Hash/水位、真实 step refs；仅安全裁剪，不把业务 ApiError 改成另一 code。COMMITTED/DUPLICATE 200 仅表示 request Root 已提交；该 data 可仍 PENDING/PARTIAL/UNKNOWN，UI 不推成 running |
| 202 与不确定结果 | 仅 owning durable admission 存在精确 requestRef/Receipt 时可 202；普通收到 TCP/流/队列不够。无 Receipt 的 transport 超时为 UI_COMMAND_RESULT_UNKNOWN，先查原请求，不虚构共享 CommandResult 的第四种 status |
| 错误 | 未认证401；无关联/无可用业务身份403；对象不可见统一404（错误/长度/计时策略不提供探测差异）；CAS/原键异内容409；大小413/类型415/结构安全422；依赖503。保留 ApiError `retryDisposition`，它不是自动重发许可；认证/CSRF等前置错误用封闭 UI code+correlationId，无业务 Receipt 声称 |

Hash 规则沿共享 Contract：Browser 声明的 payloadHash 在 Core 对原 payload 的 cv1 计算后比较，禁止裁剪/加默认值后用旧 hash；bytes SHA 与 canonical Hash 分域。Scope/target/operation/CAS 还必须逐字段进入实际 Intent 和授权校验，不能凭 payloadHash 代替。BFF 不缓存业务 Decision，不让 Browser 直调 authorize_command。共享完整 Envelope 仍是 Core Application 输入，以上是公开 transport projection，不改变旧服务调用 Schema。

`requestedAt/asOf` 仅为声明的请求/读取时间，不能用于倒退当前授权或延长lease/token期限；受信receivedAt/检查时钟由服务器产生。correlationId按UuidV7验证，不能把任意输入作为日志字段；deadline仅收紧已有服务器期限，不放宽owner策略。目录分页保持首屏snapshotAt/asOf与源水位；相关EP/IP源水位变化时拒绝旧cursor，不静默漂移或用旧授权读新数据。

## 6. CSRF、流、内容与缓存

Session Cookie 固定 `__Host-zhiju_session; Secure; HttpOnly; SameSite=Lax; Path=/`，无 Domain；拒绝重复/畸形 Session Cookie。所有业务 Command、POST Query、ZIP PUT、活动续期与 logout 同时要求 Session、恒时比较的 `X-CSRF-Token`、精确 `Origin=publicOrigin`、允许 Host 和允许 Content-Type；Origin 缺失/null/不符及跨站 Fetch-Metadata 拒绝。JSON 仅 application/json，ZIP 仅 application/zip，严格方法/长度限制；CORS 不开放其他 origin。GET 只读 bootstrap/login/callback；不能用 GET 启动业务。回调的单次 browser-bound transaction 替代 CSRF，其他例外不存在。公网 Authorization、X-Actor、X-Principal、X-Authorization-Decision、X-Workspace-Session-Binding 等 override 不转发；出现业务 override 字段/header 返回安全400，可信代理重写的技术字段只对其 peer 有效。

ZIP Browser 先计算原 bytes SHA-256/长度（可增量，无解压/分析），创建 intake 后以 `X-Intake-Upload-Token` 转发原流。token 只绑定原 intake/Scope/Human/hash/长度/期限，不代替 Session、CSRF 或当前 IP 接纳权，不放 URL/Cookie/日志；过期须 owning 原 intake readback/许可续传，不由 BFF 重新签发。BFF 采用 backpressure、最多 1 MiB 应用缓冲，关闭反向代理全包 body buffering，先限制 Content-Length 和累计实收 ≤100 MiB，拒绝 Content-Encoding/多段或 chunked 超限；总上传初值 ≤5 分钟、无数据 ≤30 秒。IG 仍独立验证实际 bytes/hash/长度并拥有 scan、解包、Source link、Attempt 与恢复。BFF 超时/断开中止本次转发；已经提交的 intake 不删除、不重建、不声明 FAILED，先查原 intake。解包规则/累计展开预算沿 D14，不在 BFF 复写。

依据读取使用 EP startup-review 的已授权 `evidenceViews`、QG exact `quality.get_evidence`；sourceId/evidenceId 先由 EP accepted report 解析为精确 source/snapshot/hash，不把别名当 EvidenceRef。下载必须具有 owning **已注册且获授权**的 exact content transport：请求绑定 source/representation 精确版本及 bytes hash、同 Enterprise/Project、用途、当前 Principal；owner 在发流前重验并限制短 token 期限/原引用，BFF 只转发固定 owner endpoint、固定媒体类型/长度与 attachment filename 编码，不获取 arbitrary URL/ObjectLocator。receipt/metadata 不能自行变成 bytes 权限。

当前已查公共 Catalog 没有 D14 原件字节下载 transport；`artifact.get_representation` 返回 metadata 也不等于 bytes handler。**本首版 route 集合不启用下载**，无 owning exact stream 时显示不可用、请求404；不为完成页面造 EP/IG/QG 私有下载。后续 owner 批准并注册 exact stream 后须独立增量 allowlist 和实际跨 Scope/hash/撤权测试，才能启用这一协议。此限制不阻止已授权依据摘录核对，不承诺 ZIP 原件或任意报告文件下载已可用。

Web/BFF/API 受保护响应与错误均 no-store、no-referrer、nosniff；内容流 attachment 不作为同源可执行 HTML/inline preview。沿 UI-DG-003 CSP、react-markdown skipHtml、无 MDX/rehype-raw/任意 HTML sink、受控链接与禁外部客户图片；正文/文件名不作为 DOM attribute/代码/服务器路径。Hash 资产可缓存；客户 API/下载/认证不得 CDN/cache/Service Worker 持久化。

登出、401/当前失权、切用户/Scope 先推进客户端 generation，取消旧请求并清理相关 Query cache/草稿内存/DOM/object URL；迟到响应须检查 generation+Principal+Scope+exact version，不能再填旧缓存。多 Tab 只广播“失效/清理”信号，不传播 token、CSRF或客户内容；每 Tab重新 bootstrap。页面从 bfcache/pageshow 恢复先清敏感展示并校验 Session/当前权限，再读取 Core。BFF/反向代理/前端诊断 allowlist 仅安全 code、随机 correlationId、operation/version、耗时；删 callback query、Authorization/Cookie/token、Subject、客户正文/文件名/路径、下载 URL、原 payload/error/CLI stdout。自动截图/trace 只用合成/批准脱敏资料。

## 7. 原意图恢复与设计 trace

Browser 在发送前固定 request target UUIDv7、commandId、原 payload/hash/CAS 和 key；本 transport 提案的 request CREATE key 为 `operation:1.0:targetUuid`，key 不是读权限。导航的安全 request ID 可重建原 key，不放正文/token/hash全集进 URL。刷新/重登可沿原 request 页面调用 owning get；Core 已提交意图是恢复权威，未提交页面草稿不声称已保存。换主体不能凭原ID/key取得权限，仍由owner当前read权裁决；后续步骤继续原Human决定链，不改原actor。

| trace / 每个信任边界 owner | 精确意图绑定与可观察结果 |
|---|---|
| `TR-258-01` 允许 Human | Browser→BFF：browser-bound transaction；BFF→Core：独立 token/technical binding 校验；IP：exact issuer-sub link/ACTIVE HUMAN；EP目录：每Project current discovery；项目页：各 board独立授权；D14 Command：原 target/key/hash/binding→IP Decision→EP原意图 Receipt。没有一步靠角色字符串放行 |
| `TR-258-02` 缺 link/非 Human/撤销 | 有效 OIDC 不等于业务身份；IP resolver 拒绝，Core安全403；目录/业务 protected reads=0，无 JIT/新角色/start。IP依赖失败503，无空目录/假身份 |
| `TR-258-03` 跨项目深链接/翻页 | A Session 请求 B refs/cursor；Core token解析→IP exact B Scope当前拒绝→统一404，无 EP/TE/QG受保护读取；切B/旧A响应由Browser generation拒收。directory项不充当board/content授权 |
| `TR-258-04` malicious override | Browser自报 HUMAN/actor/actingFor/Decision/上游URL/CLI；BFF封闭字段/header拒绝；绕过BFF则Core固定peer+token verifier拒绝；已认证Agent经IP仍非HUMAN。原命令不被重写成另一Actor或target |
| `TR-258-05` CSRF/认证 replay/重复 click | 缺CSRF/错Origin/Host→BFF拒绝且Core调用0；错Cookie/state/nonce/已消费回调→Session0；合法双click原target/key/hash只一owning意图，异payload同key409；CSRF本身不提供业务幂等 |
| `TR-258-06` 已提交请求等待时过期/重启 | EP已存原request+step receipts，BFF失效401；不取消owning Process/不改变已成功start。重登新AuthContext→IP当前read Decision→EP get原request/key；权限撤销仅阻续步，按当次read权返回；旧Session决定不能续写 |
| `TR-258-07` response丢失/UNKNOWN | 已知预分配原requestRef/key但未收Receipt；只调用EP/IG原查询（各自当前IP），依赖503仍UNKNOWN；PENDING轮询，PARTIAL保留成功steps，STALE保留已ACTIVE事实。只有owner完整证明未提交且允许重试时才显式同key/原payload重试；不以404/空结果自动推未提交 |
| `TR-258-08` refresh/logout竞态、key轮换 | 同Session一个refresh；logout先失效，迟到refresh不能复活；未知kid一次受限JWKS更新，失效/错签名不进入IP；新的token/Session不修改原business intent、Receipt hash或历史Actor |

业务写自动重试为0；活跃读取5秒起步，失败退避10/20/30秒，授权失败停止；短时有限只读核验结束后由用户“重新查询”同一原请求，不换提交。浏览器中止、Session失效或 transport503不是 owner“未提交”证明；resume 的 READBACK/CONTINUE_PENDING_STEP 只允许已批准原 request/原 payload，BFF不保留协调步骤。

## 8. 分层验收与批准门禁

| 层次 | 实施后必须取得的独立证据 | 本设计当前状态 |
|---|---|---|
| 静态设计 | owning字段/owner/Purpose/版本、finite allowlist、原intent与负向trace对账；`vibe verify docs --json`；精确head独立Review与人类技术批准 | proposal；执行证据进Issue/PR，审查/批准不预写PASS |
| 确定性本地 | 固定合成issuer/key/token/时钟，错claim/override/CSRF/限额、refresh单次、重启/late response、Registry未注册拒绝、Envelope正负映射 | `NOT RUN`；替身仅证明限定协议分支 |
| controlled OIDC + public HTTP + PostgreSQL | 锁定实际Keycloak realm/client/audience、独立BFF/Core verifier、真实link/grant撤销与RLS；公开owning准备请求与Receipt、丢包/expiry/UNKNOWN；JWKS真实轮换/IdP故障 | `NOT RUN`；不能用伪Human header或直接SQL构造业务中间态 |
| Browser / Host / Runner | 实际构建Browser登录→授权目录→D14已注册请求/原意图恢复；受控ZIP流与owner限制；Runner按单独批准profile接纳，浏览器不制造接纳事实 | `NOT RUN`；anonymous shell与mock回执不属于session证据 |
| 实际Chrome/Edge +独立Manual | Windows/macOS最近两稳定大版本记录实际build/viewport；键盘、深链接、expiry、多Tab、XSS/CSRF、原请求恢复；独立顾问走允许与拒绝链 | `NOT RUN`；Playwright Chromium/axe不替代平台矩阵和人验 |

对应失败场景在 IP/EP/UI01 Module-Test 的 #258 专节。设计批准仍不证明已安装 IdP、API handler、当前权限集成或可用 Session；具体安装锁、目录 Registry/实现、D14未注册操作、原件下载 transport、公司规则/Runner gate 按其 owner 单独核验，不据本 Markdown PASS 推成真实首条链路可用。
