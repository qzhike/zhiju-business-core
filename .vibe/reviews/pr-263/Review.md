# PR #263 独立设计审查

## 审查对象与结论

- Issue：[#258](https://github.com/qzhike/zhiju-business-core/issues/258)，`T2 / design only`。
- PR：[#263](https://github.com/qzhike/zhiju-business-core/pull/263)，Draft。
- Reviewed SHA：`5a6d55ed678be7c0325fc47bcfd627ab94919ddf`。
- Base SHA：`e8d05d6dccfe6034b241a8d0c4b8b49e255e4029`。
- 审查日期：2026-10-09。
- Reviewer outcome：`REQUEST_CHANGES`。
- Human 技术批准：`PENDING / NOT PROVIDED`。

本次从最新 Issue、已批准 UI-DG-003、IP/EP/UI01 owning 契约、D14 公共操作及共享 Envelope/Page 规则建立预期，再检查最新 head 的完整 diff 和当前验证证据。审查对象仅含 12 份 `.vibe/` Markdown；没有实现、Registry/Schema、SQL、迁移或验证工具改动。本正式记录是审查交付，不属于 reviewed SHA；未修改提案或产品代码。

## 阻塞发现

### R1 / P1：回调封闭字段排除了 Keycloak 默认的认证响应参数

定位：[Session Delta §3](../../decisions/workspace-trusted-session-public-access.md#3-登录刷新登出与重启)，reviewed SHA 第 55 行；与 §1 固定 Keycloak 配置及 UI-258-002/003 的合法登录验收共同核对。

该行将 callback 输入限定为 query `code/state` 或安全 `error`，并要求验证 issuer；没有接纳 `iss` 和 `session_state`。Keycloak 默认认证响应会携带这两个字段，见官方升级指南的 [iss 参数](https://www.keycloak.org/docs/latest/upgrading/index.html#added-iss-parameter-to-oauth-2-0openid-connect-authentication-response)和 [session_state 参数](https://www.keycloak.org/docs/latest/upgrading/index.html#added-session_state-parameter-to-openid-connect-authentication-response)。[RFC 9207 §2.4](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4) 定义了将响应 `iss` 与发起交易的预期 issuer 精确比较的规则。

直接反例：同一合法 browser-bound transaction 返回 `?code=…&state=…&iss=…&session_state=…`，Cookie、state、期限和 issuer 全部正确。按当前封闭输入规则实现，响应仍会因包含不允许的字段而被拒绝，无法进入 token exchange/Core bootstrap/Session。配置表也没有规定通过 Keycloak 兼容开关删除这些参数；不能由 Implementer 静默增加白名单或忽略响应 issuer 来完成登录。本结论是设计接受集的静态反例，未声称已运行真实 Keycloak。

修复要求：完整定义成功和失败回调的 OIDC 参数接受集，接纳并校验 `iss`，明确 `session_state` 的有限接受/忽略规则；固定发行方 profile 下明确缺失、重复和不匹配 issuer 的拒绝规则，并保留单次 Cookie/state/nonce/PKCE 绑定。同步 UI owning 场景，包含真实形状的成功响应、安全 error 响应以及错/缺/重复 issuer 反例，不以关闭标准参数或绕过协议验证代替闭合。

### R2 / P2：空中间页与完整空目录的成功规则相互矛盾

定位：[EP Workspace 目录](../../module-specs/Module-Spec-002-EnterpriseProject.md#workspace-授权项目目录提案258)，reviewed SHA 第 1005、1009 行；相关未来验收为 EP-258-003/004。

第 1005 行规定每个请求最多扫描 200 个候选，并明确即使过滤后本页为空，只要还有候选就返回 nextCursor；第 1009 行却限定只有枚举完整才能返回 `OK + items=[]`。新 Query 声明返回共享 `Page<WorkspaceProjectSummary>`，共享 QueryResult 没有另一种成功的中间页状态，见 [Page](../../api-contract-v0.1/API-Contract-v0.1.md#4-共享标量与-value-object)及 [QueryResult](../../high-level-docs/06-typed-references-contract-catalog-v0.1.md#84-queryresult)。

直接反例：Human 有 201 个当前获权候选，稳定排序的前 200 项均不匹配 searchText，第 201 项匹配。扫描到预算后，必须返回空 items 和 nextCursor 供下一页继续；此时枚举未完成，第 1009 行又禁止该合法 Page 的 `OK`。继续扫描会违反预算，返回完整 EMPTY 会遗漏获权项目，返回错误则使该合法过滤查询无法完成。EP-258-003 已要求覆盖这一分支，现有两条规格不能同时满足。

修复要求：统一成功 Page 与 EMPTY 的定义，允许 `OK + items=[] + nextCursor` 表达仍有候选的中间页；只有枚举完整且无 nextCursor 时才能显示完整空目录。同步 Delta/UI 和 EP-258-003/004，明确客户端继续分页及完整性判断，并保留 200 项/5 秒预算、当前授权和源水位校验。具体修复措辞可不同，但不能为得到非空页而突破扫描限制。

## 其他已核对边界

| 边界 | 独立静态核对 |
|---|---|
| 身份与授权 | 实际 token verifier → IP 当前 issuer/subject link → ACTIVE HUMAN → scoped Actor/当次 Decision；没有 email/Realm Role、actingFor、Browser header 或旧 ALLOW 的授权旁路。bootstrap 与目录专用入口不放宽旧 scoped Port。 |
| 配置与会话 | 固定 issuer/client/audience/endpoint/peer，bounded Session/交易、single-flight refresh、logout/expiry/restart 与迟到结果代次检查；业务意图/草稿/Receipt 不进入技术 Session。R1 的真实回调参数仍需修正。 |
| 目录与所有权 | IP 仅给自身 exact PROJECT 候选，EP 每项独立 discovery Decision 与双 Scope RLS；目录、board、content 和续步分别授权。没有跨 Schema Repository/SQL join 或 BFF 扫库。R2 的分页成功语义仍需统一。 |
| 有限公开路由 | 18 个唯一候选：3 个既有注册操作、14 个 D14 未注册提案、1 个新目录提案；启用还要求 exact Registry/schema/handler 和批准接受集，管理/worker 操作不暴露。 |
| Command 输入字段 | commandId、commandType、commandVersion、scopeRef、targetRef、expectedAggregateVersion?、idempotencyKey、correlationId、causationId?、requestedAt、deadline?、payload、integrity 均与共享 Envelope 对应；actor/authorizationDecisionRef 由 Core 形成。 |
| Query 输入字段 | queryId、queryType、queryVersion、scopeRef、consistencyRequirement、minimumWatermark?、asOf?、pagination?、correlationId、requestedAt、payload 均与共享 Envelope 对应；requester/authenticationContextRef/Decision 由 Core 形成。 |
| 原意图与恢复 | 原 target/key/payloadHash/CAS、真实 step refs、UNKNOWN/PARTIAL/STALE 与重新认证后的独立当前读权；不自动换键重发、不重 start、不把 COMMITTED/202 当 running。 |
| 流与内容 | ZIP 原流有界转发、IG 独立验证与恢复，BFF 不解包/分析/写存储；Evidence 使用 owning 精确引用；缺原件 bytes transport 时下载不可用。缓存清理、迟到响应、bfcache 与诊断字段 allowlist 明确。 |
| 兼容及证据真实性 | 旧 Catalog、schemas/Registry、历史 bytes 和业务 ownership 未修改；8 条 trace、26 条新增 runtime 验收均为未来场景，保持 NOT RUN。 |

上述仅是本次设计核对的结果，不构成运行时安全、授权、持久化或浏览器验证。

## 验证证据与剩余门禁

- `vibe repo --json` 与 GitHub PR 均指向 reviewed SHA；工作区初始干净。
- 已读回 [CI run 37914920358](https://github.com/qzhike/zhiju-business-core/actions/runs/37914920358)：headSha 精确匹配；select/checks/verify SUCCESS，persistence 为文档路由预期 SKIPPED。checks 的 Verify documentation step SUCCESS，日志显示 BASE_SHA 为上述 base、`[docs-verification] PASS files=12` 和 Prettier 检查通过。复用该证据，不为重复取证重跑此修订的 docs 目标。
- 独立 `git diff --check <base> <head>`：PASS。
- 独立补充静态诊断：18 个候选唯一性与 R/P/N 分类、Command 13 项和 Query 11 项非可信顶层字段映射、8 条唯一 trace、26 条唯一且保持 NOT RUN 的验收行、10 个不同的新增本地文件/标题目标均核对通过。这些检查不能消除 R1/R2 的语义反例。
- 本地新增正式审查记录的配置 docs 验证和 GitHub comment 发布/读回事实，由本次 PR comment 交付；本记录不预写未执行结果。
- 真实 OIDC/HTTP、当前 IP Grant/Policy/RLS 的 PostgreSQL 集成、Host/Runner、实际 Windows/macOS Chrome/Edge 平台矩阵及独立人工验收：`NOT RUN`。

先修复 R1/R2，再独立审查新精确 head。Issue #258 仍要求精确修订的人类技术批准后才冻结语义或声明依赖实现 READY；此次 REQUEST_CHANGES 不代替该门禁，也不授权 commit、push、合并或部署。用户授权提交 PR comment；本地正式记录尚未 commit/push，不声称已进入远端 PR。

## 最新 head 独立复审：6bb86edb

- Reviewed SHA：`6bb86edbdf9af32fde86b8f86d88cb87f5bcb511`。
- Base SHA：`e8d05d6dccfe6034b241a8d0c4b8b49e255e4029`。
- 前次 Reviewed SHA：`5a6d55ed678be7c0325fc47bcfd627ab94919ddf`。
- 复审日期：2026-10-09。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。
- 独立代理设计语义复审：`PASS / NO NEW BLOCKING FINDING`；R1、R2 均 `RESOLVED AT REVIEWED SHA`。
- Human 技术批准：`PENDING / NOT PROVIDED`。

上述 REQUEST_CHANGES 记录保留为前次 SHA 的历史结论；本节定义新 reviewed SHA 的复审结论。已重新读取最新 Issue/PR、实际 head/base、上轮到本轮的完整修订、受影响的 owning 契约和验收场景，并核对精确 head 的 CI。当前 PR 共 13 份 `.vibe/` Markdown，包含已纳入 head 的前次正式审查记录；没有实现、Registry/Schema、SQL、迁移或验证工具改动。复审不以 PR 自述或上轮结论代替新 head 核对。

### 原发现闭合

| 发现 | 新 head 的闭合依据 | 结论 |
|---|---|---|
| R1 / P1 | [Delta §3](../../decisions/workspace-trusted-session-public-access.md#3-登录刷新登出与重启)固定 code/query/openid 与支持响应 iss 的 profile，分别定义成功和安全 error 形状。两分支均将解码一次的 iss 与发起交易 expectedIssuer 和固定 discovery/config 精确比较；缺/错/空/重复 issuer 拒绝，合法 session_state 有界校验后丢弃。Cookie/state/期限/config 绑定先于原子交易消费；失败零 exchange/bootstrap/新 Session。未知/重复/非法编码/控制字符/超限参数拒绝，error 文本/URI 不展示、记录或导航。UI Spec 与 UI-258-002/003 同步覆盖原合法回调反例及两分支负向场景。 | `RESOLVED` |
| R2 / P2 | [EP 目录](../../module-specs/Module-Spec-002-EnterpriseProject.md#workspace-授权项目目录提案258)、Delta 和 UI Spec 一致允许 `OK + items=[] + nextCursor`；Page 与 Envelope 游标同值，未完成时继续绑定分页。仅完整游标链结束且累计零项为 EMPTY，空末页保留已有卡片；依赖错误不能冒充结束。保留 200 项/5 秒预算、当前授权与固定水位变更拒绝。EP-258-003 明确前 200 候选不匹配、第 201 项匹配的原反例；EP-258-004/UI-258-007 同步中间空页、真实 EMPTY、已有卡片和中途错误场景。 | `RESOLVED` |

原 R1 的协议预期继续依据 [RFC 9207 §2.4](https://www.rfc-editor.org/rfc/rfc9207.html#section-2.4)及 [Keycloak 官方升级指南](https://www.keycloak.org/docs/latest/upgrading/index.html)。上述闭合是设计接受集和场景一致性结论，不是实际 OIDC、分页或 Browser 测试通过声明。

### 其余边界与证据

- 新 head 保留固定受信配置、Core 实际 token verifier、IP 当前 link/ACTIVE HUMAN、逐请求 Actor/Decision 与返回前当前授权复验；self-discovery 不放宽空 Scope 的业务访问，不扩大目录到 board/content/start 权限。技术 Session 不存业务原意图，重认证后按原 request/key/target/hash/CAS 与当前 read 权恢复，不因 UNKNOWN 自动换键重发。
- 有限公开候选仍为 18 个唯一操作（R=3、P=14、N=1）；未注册/缺 handler 不可用，管理/worker 操作不暴露。原 Command 13 项、Query 11 项非可信顶层字段及 Core 追加身份/授权边界保持不变。流、Evidence/原件内容、CSRF、缓存清理及迟到响应边界未放宽。
- [CI run 37928593208](https://github.com/qzhike/zhiju-business-core/actions/runs/37928593208)的 headSha 精确匹配本次 reviewed SHA；select/checks/verify 均 SUCCESS，persistence 为文档路由预期 SKIPPED。Verify documentation 日志包含上述 BASE_SHA、`[docs-verification] PASS files=13` 和 Prettier PASS；复用当前 CI，不为重复取证重跑该修订的配置目标。
- 独立 `git diff --check <base> <head>`：PASS。补充静态诊断确认 13 份 Markdown 范围、18 个唯一候选及分类、8 条唯一 trace、26 条唯一未来验收行（IP=8、EP=6、UI=12）均保持 NOT RUN，并确认原 R1/R2 反例进入 owning 场景。
- 本节是 reviewed SHA 之外的本地正式记录追加；其配置 docs 验证及新 comment 发布/读回结果由本次 GitHub comment 交付，不预写未执行结果。未修改提案或产品代码，未 commit/push。
- 真实 OIDC/HTTP、IP Grant/Policy/RLS 的 PostgreSQL 集成、Host/Runner、实际 Windows/macOS Chrome/Edge 平台矩阵与独立人工验收：`NOT RUN`。

本次未发现新的设计阻塞缺陷，但 Issue #258 的 Verify 明确要求独立设计审查和人类技术批准。当前未提供针对本次精确修订的人类技术批准，因此最终 outcome 为 HUMAN_REVIEW_REQUIRED；不得据此冻结语义、将依赖实现标为 READY 或合并。用户已授权发布复审 comment；该 comment 与正式人类批准仍是不同证据。

## 人类技术批准与最终结论：6bb86edb

- 批准日期：2026-10-09。
- 批准来源：当前会话用户在上述精确 SHA 的复审结论后明确回复“批准”。
- 批准对象：PR #263 / Issue #258 的 T2 设计，Reviewed SHA `6bb86edbdf9af32fde86b8f86d88cb87f5bcb511`。
- 已核对远端 head/base 与上述 reviewed SHA/base 一致，PR 仍为 OPEN / Draft。
- Human 技术批准：`APPROVED / EXPLICIT USER INSTRUCTION`。
- 最终 Reviewer outcome：`APPROVE`。

批准到达前的 HUMAN_REVIEW_REQUIRED 保留为历史记录；本节记录该人类门禁已满足后的最终结论。独立设计复审、R1/R2 闭合及精确 head 的 CI 证据沿用上节，本次未更改受审设计。实际 OIDC/HTTP、PostgreSQL 授权集成、Host/Runner、浏览器平台和人工运行验收仍为 NOT RUN，批准是设计判断，不将这些场景改写为 PASS。

当前授权覆盖正式审查记录追加及 PR comment 中的批准证据交付；本地记录的配置 docs 验证和 comment 发布/读回事实在交付 comment 中记录。本地追加未 commit/push，APPROVE 不构成合并授权。
