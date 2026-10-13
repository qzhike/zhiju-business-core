# 准备项目入口与 ZIP 交接 Spec Delta（#277）

状态：`T2 / DESIGN APPROVED / INDEPENDENT REVIEW PASSED / HUMAN TECHNICAL APPROVAL 2026-10-13 / NOT REGISTERED / NOT IMPLEMENTED`。

交付 [Issue #277](https://github.com/qzhike/zhiju-business-core/issues/277)，对照 `b28a004a48c60decb975494f4d7ecbebff9f46b8`。本文只拥有本次选择、跨 Owner trace 与后续 readiness；字段和失败条件分别归 [EP](../module-specs/Module-Spec-002-EnterpriseProject.md#277-准备入口预设与原请求交接提案)、[IP](../module-specs/Module-Spec-001-IdentityPolicy.md#277-准备入口准入与显式项目授权提案)、[IG](../module-specs/Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案)、[UI](../module-specs/Module-Spec-UI01-WorkspaceUI.md#277-两字段创建与单次提交交接提案)。本补充已通过独立设计审查，并于 2026-10-13 获用户对 `98f60b3a81c10c23173482c31162371dfcecfc27` 的明确技术批准；独立审查、复审及批准来源见 [PR #288 正式记录](../reviews/pr-288/Review.md)。批准覆盖本文四项选择与该修订的 owning Spec/Test，不制造已注册、已实现或生产可用事实。

#253/#255 的准备状态、ZIP 安全上限、三组启动核对和整份选择，#258/#263 的可信 Session 与有限 transport，#257/#262 的公司清单及 #267/#268 的发布基础均保持各自批准。此处仅替换 D14 未注册准备入口的未闭合字段，显式新增 bootstrap 接受集和一次重传操作；不变更旧 create_project、ACTIVE Task、历史 Hash、公司发布 registry 或既有目录权限。二字段仍是客户与项目标题，ZIP 页仍是一个包、可选说明、一次“提交并分析”。

## 1. 已批准的最小选择

| Delta | 选择与理由 | 兼容 / 审查边界 |
|---|---|---|
| SD277-PRESET | EP 拥有独立公司技术预设及发布/精确解析；VERSIONED Ref 与单独 canonical payload hash 成对绑定。预设声明技术默认值、membership 模板、ZIP policy 和精确公司规则发布选择 | startup rule bundle 拥有业务清单，不能替代预设；实际两类 publication 都是部署输入，无生产 UUID/hash 默认值 |
| SD277-ADMISSION | IP 新增专用准入 authority；具权限管理员事先显式授予 NEW 准入，EXISTING 还须该 Enterprise 当次 select/create 权限。一次 reservation 固定 Human、原请求和三个预分配身份；创建后另以批准 membership 模板产生 exact Project Grants | 当前 scoped Grant/空 Scope 目录不足以完成该步骤。本提案明确增加独立内部 operation/Policy/RLS，不借公司发布权或登录自动授予；不新增管理 UI |
| SD277-HANDOFF | IG 原 intake 持久化 note、原 preparation request/key、ANALYZE 意图；manifest 成功事务发最小 Event，EP 固定 Process 经受权 readback 捕获来源并消费已批准 TE 接口 | BFF 不协调 source/task/run；只接收 ZIP 不显示分析运行。说明是客户提供的材料，不是系统指令或已确认事实 |
| SD277-RECOVERY | IG 增加一个公开 Command：同 intake、同 bytes、当前 Human 授权下，最多一次完整重传；不实现分片/Range 续传，Query 不签 token | 批准范围包含新增有限 route、generation/CAS/旧流 fencing；UNKNOWN 不许可重传。次数耗尽显示明确人工处理边界，不换键自动建 intake |

以上四项技术选择已获精确修订批准；后续实现仍须按下表准备一个贯通交付、完成注册与适用验证。真实管理员、授权 PolicySnapshot、membership 内容、公司 preset/rule/template 发布实例、部署地址均不得从示例推断。

## 2. 一次完整用户结果

后续一个贯通实现目标是：受权顾问从工作台新建准备项目，提交一个 ZIP 和说明，重新登录后仍能读回该原请求、资料接纳结果及分析交接的真实阶段。运行能力缺失时，资料与意图已保存，显示明确“资料已接收，分析能力暂不可用”；用户不需要第二次提交分析意图。该有限结果不承诺报告、PROJECT_START 或整条 D14 完成。

首版准备入口只处理 PREPARATION/PREPARING 项目的首次 ZIP；ACTIVE 初轮恢复、后续补料仍沿 D14 自己的接受集，不能借本新增 bootstrap 扩展。一个 preparation request 只认一个原 intake target；预分配身份、原键、Human 和 payload 都由 owning 事实固定。跨标签页相同原请求返回同一结果；有意创建另一个同名客户仍须显式 NEW，不按名称合并。

## 3. 正向 trace（设计场景，均 NOT RUN）

| 步骤 | EXISTING 客户 | NEW 客户 | 权威回执 / 当前权限 |
|---|---|---|---|
| 1. 进入表单 | IP self 候选仅来自当前 Enterprise select/create Grants；EP 逐 Enterprise RLS 读安全名称 | IP 只返回该 Human 是否有当前 NEW 准入及公司预设选择，不枚举客户 | EP `find_preparation_enterprises` 返回 entryBinding + Page；没有 Actor/Grant 的 Browser 自报 |
| 2. 固定提交 | 精确既有 enterpriseRef；Browser 预分配 request/project UUIDv7 | Browser 再预分配 enterprise UUIDv7；名称只是 payload | 原 target/key/Scope/payloadHash；IP admission Receipt 固定模式、身份、预设和原意图 Hash；IP 不存客户名称 |
| 3. EP admission | 当前 Enterprise select/create 与准入模板独立复验 | 当前 NEW grant 和限额/期限独立复验 | EP request 原子提交 immutable intent + request scope reservation + Receipt；准入允许这一个未创建 Project 的 CREATE Context，不伪造 ProjectScopeClaim |
| 4. 分步建对象 | 重验真实 ACTIVE Enterprise，不新建企业 | EP create_enterprise 原键，独立 Enterprise Root/Receipt | IP 精确物化 scoped memberPolicy；EP create_preparing_project 同事务 Project/ProjectScopeClaim/Receipt/Event；PREPARING、无 start |
| 5. 创建者可用 | 两条路径相同：IP 按原准入批准的模板，逐项发真实 exact Project Grant | 同左；新 Enterprise 的 select/create 权限另显式配置，Project Grant 不反向授企业权限 | IP provisioning Receipt + 每项 Grant/Policy refs；当前 discovery、Project board、request read、intake/read/restart 和 ANALYZE admission 逐项复验；缺项不显示可进入上传 |
| 6. 提交 ZIP | 固定 Project、原 preparation request/key、intake UUIDv7、note、ZIP 实际 hash/length；`analysisIntent=ANALYZE` | 同左 | IG intent Receipt 和一次短 upload ticket；EP 只读 request binding 证明目标；Browser PUT 原流，BFF 不解包 |
| 7. 接收与交接 | ZIP 含有效 DOCX、UTF-8 Markdown 和一个不支持条目；扫描安全后 EP 分别 register/validate/accept 原 ZIP、合法条目、非空 note | 同左 | 真实 EP source/validation/accept Receipts；IG immutable manifest/Receipt/Event；不支持条目保留限制。EP Inbox/Process 只消费同 intake 的原分析意图 |
| 8. 分析边界 | EP 当次 source capture → TE task → TE analysis request；只在相应 Owner 已提交后记录 refs | 同左 | TE Task/Request/逐步 Receipts，IG Attempt/ack 才证明 invoke；服务缺失则保留 `WAITING_CAPABILITY`，零伪 Task/Run/report。Query 不驱动这些步骤 |
| 9. 重登录读回 | 沿安全 request/intake ID 定位；IP 当前身份/读权→EP/IG 原意图与逐步 refs | 同左 | 新认证摘要不改原作者/原键；失权不能靠旧 URL/Receipt 获取内容；已成功事实保持 |

## 4. 失败、保留事实与有界恢复

下表对 NEW/EXISTING 均适用；仅企业创建一行限定 NEW。所有“继续”都要求同原意图、独立当前授权、owner readback/CAS；HTTP 错误、404 或没看到响应都不能证明未提交。

| 故障点 | 保留的真实事实与可见状态 | 允许恢复 / 禁止行为 | owning 场景 |
|---|---|---|---|
| preset 缺失、同 version 异 hash、未发布/未来生效/撤回 | entry 不可提交；未建 EP request/Enterprise/Project | 补齐真实发布后重新读取；已存在 request 标 STALE，保留成功步骤，不在原 payload 换预设 | EP-277-001/004 |
| startup rule publication 缺失或失效 | 创建前拒绝；创建后发生则保留 Project/原 request，阻止新 intake/分析 source | 当原绑定恢复可用时同键续未完步；需要换绑定则显式新设计允许的意图，首版不自动搬迁 Project | EP-277-004 |
| NEW Enterprise 已建，Project 创建回滚 | Enterprise Receipt 成立，Project 无成功 Receipt；PARTIAL | 原 request 只续 memberPolicy/Project/provision；不得删企业或另建同名企业 | EP-277-002 |
| Project 已建，creator provisioning 少一 Grant/撤权 | Project/ScopeClaim 保留；access=INCOMPLETE/REVOKED，不得把 EP 创建 ACCEPTED 展示为工作区可用 | 原 request 的限域恢复读权仍独立校验；受权管理员修复同一 provisioning slot，顾问显式同键继续；目录无权则不出现 | IP-277-004 / EP-277-003 |
| request/intake 提交响应丢失、重登或服务器重启 | UNKNOWN；可能已有原 Receipt，BFF 不持业务副本 | 原 ID/key 查询；PENDING 只查；只有 owner 完整证明 NOT_COMMITTED 且原 payload 尚可取得才同键显式重发。新键/新企业/新 intake 均禁止 | EP-277-005 / UI-277-003 |
| 首 token 响应丢失，或流中断/过期 | 同 intake 的 intent 与已验收来源不变；原 generation 先查明 CLOSED_NO_OBJECT | 当前 Human 显式 restart，最多一次，从 byte 0 重传相同 ZIP；原 token/generation 作废。UNKNOWN、已 STAGED/有 link、旧流未停均不许可 | IG-277-002/003 |
| 重传许可响应丢失、第二次流也中断 | 当前 generation/token 可在同 restart key 确定性重放有效期内读回；不得再增 generation/延长期限 | 额度耗尽或 token 再过期由受权运维对账原 intake，首版显示停止/联系处理；不承诺自动续传或自动新 intake | IG-277-003 |
| 安全 ZIP 中不支持文件、坏 DOCX/非 UTF-8 MD | 合法源保留；逐 entry 限制与 PARTIAL manifest | 至少一个合法 ZIP entry 才分析；note 不把零可分析 ZIP 变成功。不忽略错误、不把技术提取写成 READ/已理解 | IG-277-004 |
| unsafe ZIP / ZIP bomb / 类型伪装 / path traversal | 安全隔离、明确失败；零 manifest handoff/dispatch；先前已 link 来源保持历史 | 不重传同一不安全包、不 cleanup 已 link 源；换包属于新明确意图，首版无自动替换动作 | IG-277-004 |
| object 已写、EP link 失败或 worker 在 entry commit 后重启 | object/源/验证各自真实 Receipt 保留；manifest 未提交不宣称 READY | 原 intake/entry ID/step key readback，只续缺失步骤；orphan cleanup 先核验未 link、retention/hold | IG-277-005 |
| manifest 已提交，Event 丢回执/重复/EP 暂不可用 | IG custody 成立，EP handoff PENDING/UNKNOWN，保存原 note/ANALYZE | outbox/inbox 原 Event 重投，同 intake 只有一个 handoff；Query 零写入；不让 Browser 再调 TE | EP-277-006 / IG-277-006 |
| TE 接口未注册、Runner/执行锁不可用或当前分析授权撤销 | source/intake 保留；WAITING_CAPABILITY 或 BLOCKED_AUTHORIZATION；可能已有 Task/analysisRequest 仍如实返回 | 首版受权运维仅在原 Process/原 step 已知未提交且依赖恢复后继续；若 TE/IG UNKNOWN，先原 Receipt/Attempt readback，绝不第二 invocation | EP-277-006 / UI-277-004 |

## 5. 一个后续实现的 readiness

| 面 | 已批准/已实现依赖 | 本次闭合的最小增量 | 后续可执行条件 |
|---|---|---|---|
| EP | 既有 Enterprise/Source 及 ProjectScopeClaim 基础；D14 准备/来源设计已批准 | preset 发布/解析、request admission 与恢复、PREPARING producer、binding read Port、固定 intake→analysis Process | 本设计独立审查与精确修订 Human 批准已完成；所用 schemas/handlers/迁移仍须完整注册，旧入口回归 |
| IP | 可信 Human、当次 scoped Actor/Decision、exact PROJECT discovery；公司发布独立基础 | 明确 NEW 准入、EXISTING Enterprise 候选、一次 reservation/Decision、scoped memberPolicy 与独立 creator provisioning | 显式受权管理者、真实 current Grants/Policy、有限接受集和专用 RLS；缺任何生产值拒绝 |
| IG | D14 ZIP 限制/源接纳及原调用语义已批准 | immutable submit intent/note、原 intake query、一次 restart、manifest Event 和 handoff readback | 一 ZIP 的真实流、staging/scan/validation/link/manifest；对象存储/解析器配置有效 |
| UI/API/BFF | #266 可信入口、三项实际 Query transport；D14 浏览器候选 route 已批准但未实现 | EP entry/result 字段映射，准备请求/IG intake + restart finite routes，上传及原请求页 | 同源 Session/CSRF/当前权限；一个显式提交，真实资料/分析状态；不得私有编排 |
| shared contracts / persistence | 既有 Envelope、cv1、Receipt/Outbox/Inbox、FORCE RLS | 本次 VERSIONED+hash、bootstrap proof、closed result/Event、预创建 Scope 与上传 generation 约束 | [Catalog](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#277-准备入口增量名称与引用提案)、[持久化](../high-level-docs/07-postgresql-logical-model-v0.1.md#277-准备准入与上传交接持久化提案) 对应注册/正负 fixtures/full gate |
| TE / Runner | 消费 #253 的 create task/request analysis 接口和 #256 执行锁设计 | 不实现 TE/Runner；只锁定原 intent 与精确 handoff refs/Receipts | 缺真实能力时诚实 WAITING_CAPABILITY；报告/真实 Runner 验收仍 NOT RUN，不等待并行工具链来完成本设计 |

此表不是已发布实现 Issue。后续保持一个“可创建、提交并恢复原资料”的交付，不按模块拆成相互不可用的任务；实际 Runner/报告另按已批准依赖判断。公司真实模板/requirement/rule publication、preset/membership/授权实值、部署/对象存储、Runner 工具链/完整执行锁及实际浏览器/人工验收尚无本任务证据。

本任务只运行 `vibe verify docs --json` 和字段/trace 定向静态对账；运行实现、Registry、迁移、上传、生产发布、TE/Runner、Browser、独立人工业务验收全部 `NOT RUN`。后续包含持久化，须配置 `full`（新容器环境先 `environment`），按 owning Module-Test 分层保留证据。独立审查与 Human 技术批准已绑定 `98f60b3a81c10c23173482c31162371dfcecfc27`，记录保存于实际 PR #288 的正式 Review.md；docs PASS 不代替这两项门禁。后续贯通实现可据此准备执行工作项，仍须核对所用已批准依赖与显式部署输入，不据设计批准宣称生产权限、接口或 Runner 已可用。
