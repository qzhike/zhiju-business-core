# D14 / RD-01 首个 Runner 与执行锁提案

状态：`T2 / PROPOSED / HUMAN SELECTED 2026-10-09 / INDEPENDENT REVIEW NOT RUN / TECHNICAL APPROVAL PENDING / NOT REGISTERED / DEPLOYMENT NOT IMPLEMENTED / INTERNAL SCHEMA+PRODUCER+VALIDATOR+PREFLIGHT IMPLEMENTED 2026-10-09 (#264, CONTRACT-ONLY)`。

本提案对应 [Issue #256](https://github.com/qzhike/zhiju-business-core/issues/256)，基于 `main@15c085354056ab327e03352c32020010cc11285b`；承接已批准 [D14 / RD-01](d14-rd01-first-customer-flow.md)，只闭合首个分析 profile 的选择、锁接口与控制支持集。注册、实现、安装、凭据读取、Provider 调用及真实客户任务不在本次授权内。本文拥有配置选择与锁描述；IG 拥有调用/观察，TE 拥有 Run 控制与接纳，IP 拥有授权，Deployment 拥有进程隔离。业务规则内容由独立启动规则设计发布，本文不填其强制清单。

## 1. 首发选择与证据

2026-10-09 人类在本任务会话订正首发默认选择：**OMP（Oh-My-Pi / oh-my-pi）+ DeepSeek 官方 API + DeepSeek-V4.1-Flash / `d14.analysis@1` / 单 Ubuntu Host 的非交互 LOCAL_PROCESS**。本次订正取代先前 Claude Code / Anthropic / Sonnet 的配置选择；数据边界继续为**拟允许真实客户资料出网；部署前补齐合同、驻留、保留期与客户授权证据**，须按新 Provider 重新取证。这是公司首发设计参数选择；不是技术设计冻结、部署许可或本次真实客户调用授权。个人订阅、代理的默认模型及已有 CLI 登录态都不证明公司身份或数据授权。该选择与已批准 D14 的固定员工执行计划相容，不新增 UI Runtime selector。

当前 Runtime/model 选择证据为本会话的明确订正：“默认Profile改成OMP(Oh-My-Pi) + DeepSeek v4.1-Flash.”；数据边界沿用此前答复：“拟允许真实客户资料出网；部署前补齐合同、驻留、保留期与客户授权证据”。交付时在 PR 将订正后的选择及配置内容绑定到实际 head SHA；后续独立 Review 和技术批准必须另外绑定精确 reviewed SHA，不能用选择答复代替。

以下官方资料于 2026-10-09 查阅；它们证明文档能力，不证明指定安装、认证、隔离或业务质量。四个目标保留，旧 Codex/OpenClaw 和 synthetic profile 不删除。

| 目标 | 有依据的能力 / 采用成本 | 本轮选择理由与未验证项 |
|---|---|---|
| OMP / oh-my-pi | [官方仓库](https://github.com/can1357/oh-my-pi)提供 print/JSON/RPC；[模型配置](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md)支持 DeepSeek、精确 provider/model selector，也包含 fallback、额外模型和配置发现 | 人类订正后的首发默认；须新增 OMP 事件 mapper、原调用 journal，并证明关闭回退/额外模型与个人配置。本轮不做 conformance，没有四目标性能比较结论 |
| Claude Code | 既有 Runtime Contract 已定义 `claude -p` 映射；[CLI](https://code.claude.com/docs/en/cli-reference) / [程序模式](https://code.claude.com/docs/en/headless)说明结构化事件、固定模型、工具/配置限制 | 保留候选与既有映射；不再作为本轮默认，也不作为 OMP 失败后的自动替代 |
| pi | [官方 coding-agent 文档](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)提供 print/JSON/RPC、工具名单及关闭 context/Skill/extension 发现 | 保留候选；进程容器隔离仍是部署责任，需新增映射和真实锁；没有本地安装证据 |
| qoder-cli | [官方 CLI](https://docs.qoder.com/cli/cli-reference)提供非交互、JSON、tools；模型选项包含 auto/lite/performance 与 BYOK | 保留候选；档位不是本提案认可的固定底层模型身份；需证明精确 Provider/model、数据边界及关闭模型路由；没有本地安装证据 |

[DeepSeek 更新日志](https://api-docs.deepseek.com/updates/)确认 V4.1-Flash 发布及当前 API 名称 `deepseek-flash`；[模型详情](https://api-docs.deepseek.com/quick_start/pricing/)与[模型列表说明](https://api-docs.deepseek.com/api/list-models/)区分 API ID 和展示版本 `DeepSeek-V4.1-Flash`。拟使用 OMP 精确 selector `deepseek/deepseek-flash`；不能自行编造 `deepseek-v4.1-flash` 为已确认 API ID。官方使用“最新”模型表述，当前映射不证明底层版本永不变化：配置选择记录 API ID 与批准版本，部署仍须取得 Provider 固定版本绑定及实际调用版本可核验的证据。当前尚未取得；只有 argv、catalog/name 或响应回显 `deepseek-flash` 不足以物化可运行锁。若无法固定并核验 V4.1-Flash，拒绝 dispatch/接纳，不改用其他模型、Provider 或自托管部署。旧 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 的兼容路由、裸名称、`auto`、`latest`、模糊匹配、动态 routing 和 fallback 均不放行。

[DeepSeek 隐私政策](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)是公共政策来源；须另按实际公司 API 账号、合同、产品和功能核对数据处理、驻留、保留/删除及缓存范围，不能沿用 Anthropic 的政策、ZDR 或地域证据。公共资料不证明公司已签合同、零保留或 CLI 实际请求参数。人类选择的条件性出网边界要求部署前提供精确客户授权、数据类别/目的、Provider 组织、处理与存储地域、保留/删除及工具目的地批准；缺一就拒绝该类输入，不能用脱敏测试结果替代。当前合同、地域、保留期数值与客户授权都未取证，保持未物化；conformance仍只使用先经批准脱敏的DOCX/Markdown。

### 只读观察与未决事实

2026-10-09 在当前开发机执行 `--version`、Claude / OMP `--help`、可执行文件 bytes SHA-256 与系统查询；没有调用模型、读取认证文件或修改安装。

| 观察对象 | 实际观察 | 可证明 / 不可证明 |
|---|---|---|
| 开发机 | Darwin 25.6.0 / arm64 | 不证明 Ubuntu 版本、内核、架构或服务器可用性 |
| Claude Code | `2.1.236`；binary SHA-256 `6bc4ba992d2786cbf0237c4453ca53c1fdf0c3b3d83ffa0025c0d8190ed27848` | help 显示 print/stream-json、bare、tools、disable-slash-commands、strict-mcp-config、no-session-persistence；不证明登录、模型可用或隔离 |
| OMP / oh-my-pi | `omp/18.5.0`；binary SHA-256 `5608ba1705ae8081f4bced9b54b583752d05926ff9c63779aa866a4c13d43aad`；help 显示 print/json、no-session、tools、no-extensions/no-skills/no-rules/no-lsp/no-title | 首发候选的本机安装/能力观察，不证明 Ubuntu 部署制品、DeepSeek 模型可用或配置已生效；no-extensions 仍允许显式扩展，工具默认全集不合本提案 |
| pi / qodercli / qoder | 当前 PATH 未解析到 | 只说明本次 PATH，不推断全机未安装 |
| 外部 evidence 工具 | `runner_evidence/analysis.py`、`reader.py`、`common.py` 的实际 SHA-256 与 [D14 §7](d14-rd01-first-customer-flow.md#7-首个-runtimeprofile-候选与待批准选择)三值相同 | 只读代码确认当前 finalize/renderer 为 v0.1；没有运行旧报告，不是 v0.2 或 Host acceptance |

Ubuntu OMP CLI/build digest、Host image/OS/kernel/arch、OMP Adapter revision/build、公司 DeepSeek 组织/账号策略、模型可用性与固定版本绑定、prompt、发布模板/规则、v0.2 证据工具/依赖及 conformance 都缺少部署事实。保留缺失，不用上述 Darwin hash、历史报告、浮动 tag 或虚构 digest 补齐。

## 2. 一个版本化锁合同与三个不同证据层

拟内部闭合描述 `d14.runner_execution_lock@1.0`，由 IG/Runtime 承载，不注册为公开 Command 或让员工上传 JSON。未知字段、未知版本或任意 executable/argv/endpoint 覆盖均拒绝；机器 Schema/producer/validator 已按本合同作为**内部描述符**实现（Issue #264，`contracts/src/d14-runner-execution-lock.ts` 与 `modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts`），仍不注册公开 Command/TypedReference，且物化边界只接受调用方提供的可信来源事实。本文件其余部分是设计合同；真实部署物化锁仍不存在。

实现按下列规则闭合本合同，不以命名 regex 替代 owning 身份：`boundary.scope` 每个 anchor 校验获批 kind 与**精确** canonical objectType（均取自 Registry/Contract Catalog：Project=`zhiju.project.project`、Enterprise=`zhiju.project.enterprise`、Task=`execution.task`/`zhiju.execution.task`、WorkOrder=`execution.work_order`/`zhiju.execution.work_order`、WorkOrderContract=`zhiju.contract.work_order`（CONTENT_ADDRESSED，objectId=contractId）、Run=`execution.run`、Attempt=`integration.runtime_attempt`、Package=`zhiju.runtime.execution_package`）及必需 Scope，未注册或同 namespace 的未知类型一律拒绝；content-addressed/snapshot pin 的 `ref.contentHash` 必须与外层 `contentHash` 一致；preparationSource/preparationContext/outputRoot 必须是锁定 Project Scope 的 owning pin，前两者还固定 `zhiju.project.preparation_source`/`zhiju.execution.preparation_context`；selection/design review/technical approval 与获批配置按完整 pin（kind/type/id/version/snapshot/Scope/hash）相等绑定，而非仅比较 digest；`leaseId`/`fencingToken` 沿用 owning `UuidV7`/`Common.NonNegativeInteger`，不发明字符串 token；物化边界独立重验锁自身 `[issuedAt, validUntil)` 与客户数据授权期限。

| 层 | 必须保存 | 放行含义 |
|---|---|---|
| 配置选择 / ApprovedConfiguration | 人类选择的 Runtime、provider/model、数据政策、控制/隔离支持集；配置 version/hash；选择记录、独立 Review 与人类技术批准分别绑定精确 reviewed SHA | 仅批准设计参数；缺批准保持 PROPOSED，缺部署制品仍不可执行 |
| 安装观察 / InstallationObservation | 只读工具/version、受信 observedAt、OS/arch、CLI 实际 version/bytes digest、已观察能力、未探测项及 observation hash | 只证明该环境该时刻；不能签出审批、凭据可用或 conformance |
| Run 物化 / MaterializedLock | 所有下表精确 pins、批准配置及观察 hash、真实 Scope/Run/Attempt/Package/lease bindings、当前授权/期限与部署 conformance refs | 只有无缺失、无漂移、当前许可的完整实例才可 dispatch；后续真实执行成功仍需 IG/TE/EP 分别出证 |

MaterializedLock 的封闭 payload 分组如下；所有必需 digest 都来自实际 bytes/build 或已发布 owning 对象，不设置通用占位值。允许名单为空表示禁止，缺失名单不是空名单。

| 分组 | 必填 pins / 消费规则 |
|---|---|
| identity / approval | lockId、lockVersion=`1.0`、profileCode=`d14.analysis@1`、approvedConfigurationVersion/hash、installationObservationHash、reviewedRevision 与真实 selection/review/technicalApproval 证据；审批记录引用 payload/revision，审批本身不进入自身被签 hash |
| CLI / adapter / Host | executableCode、受信解析路径、observedCliVersion、CLI binary/build/dependency digest；adapterCode/version + source SHA/build digest；harnessId/version；Host OCI **digest**、OS release、kernel version、architecture、launcher/parser version/digest。当前 none，不把产品名当 pin |
| model / data | provider=`deepseek`、modelId=`deepseek-flash`、approvedModelVersion=`DeepSeek-V4.1-Flash`、固定版本绑定证据 ref/hash及逐调用核验规则；公司身份绑定策略 ref/hash（无凭据）、精确 API transport/endpoint/network/dataPolicy refs/hash。modelConfigHash 覆盖显式 effort、context/output/turn/budget 上限、禁 fallback/auxiliary model、所有实际生效参数与默认值。当前 API ID 不是固定版本证据；缺固定绑定、无法观察实际模型/配置或与批准不符则不运行/不接纳 |
| prompt / tools | company system/task prompt refs + bytes hashes、完整有效 settings hash、Skill allowlist=`[]`、MCP allowlist=`[]`、hooks/plugins/extensions/subagents/memory=`DISABLED`、OMP 工具闭集 `read/grep/glob/write` 与版本化权限规则；前三项仅锁定根内普通文件，不准 URL/内部 URI scheme。禁止 bash/edit/python/eval/browser/computer/web_search/task/外部消息/安装及其他工具。公司规则作为锁定输入，客户配置永不进入该列表 |
| templates / startup rules | NonEmpty exact PUBLISHED template refs + publication receipts + bytes hashes；ruleBundleRef/version/hash/publication receipt、startupRulesRef 与 vocabularyRef/version/hash。其结构接口引用 [EP StartupBinding](../module-specs/Module-Spec-002-EnterpriseProject.md#ep-操作输入和结果)，业务内容由独立规则设计提供；尚未发布即不可物化，但不阻止本锁设计评审 |
| input / output / evidence tools | InputAliasManifest schema/version/actual bytes hash；PreparationSource/Context exact refs/hash；outputProfile/schema refs/version/hash，固定 reader/validator/renderer 的代码、runtime 与 dependency-lock/build digests、完整命令模板。v0.1 reader 只有经兼容性回归后可复用，v0.1 finalize/renderer 不充当 v0.2 实现 |
| isolation / controls / validity | filesystem/network/tool/data policy refs/hash、资源和六项控制 policy refs/hash、retention/cleanup policy；完整 enterprise/project/task/WO/Run/Attempt/Contract/Package refs/hash、analysisRequestKey、input manifest bytes hash、leaseId/fencingToken、issuedAt/validUntil、phase 与必要 frozen start ref；每 Run 输出根单独生成 |

Lock payload 使用 `SHA-256(cv1(payload))`，排除自身 lockHash；引用已有 Versioned/ContentAddressed/Snapshot Ref 的完整 type/version/Scope/hash，禁 `latest`。原件、manifest、prompt、工具和报告另用实际 bytes SHA-256，两种 hash 域不互换。Package@1.1 的 preparation materialization 绑定内部 lockId/version/lockHash；invocationHash 覆盖同一 binding，IG journal、TE provenance 和 EP report 的 Package/output bindings 都须解析回同一 lock，不能把新内部 lock 身份伪装成已注册 TypedReference。

冻结 WorkOrder、前次报告和运行锁不可原位修改。CLI/模型/prompt/规则/工具/隔离任一变化都产生新配置/lock version、受影响审核和 conformance；新分析用新 source/Context/Run/lease，而不是覆盖旧 lock。历史观察仍可按当前独立读权返回，历史存在不等于当前可执行。

## 3. 有界控制与原调用恢复

六项 IM-DG-006 的字段、授权、支持/拒绝和状态不变量唯一在 [TE 首发控制](../module-specs/Module-Spec-003-TaskExecution.md#d14-runner-首发六项控制提案256)。首版建议支持 heartbeat、有限 progress、原 Provider usage；拒绝 suspension、same-Run resume 与取消确认写入。拒绝后仍有 deadline/UNKNOWN、Human stop request 和新 Run retry 的完整路径；不是用未实现控制冒充可用。

以下参数为待审核的首版 policy 提案，不是既有默认或已部署事实：每次 wall clock ≤900s，整 WorkOrder ≤1800s、maxAttempts=2；dispatch 观察窗口30s；Host heartbeat15s、Run lease60s，TE 自身续租不得越 Context/Grant/Policy/总预算/deadline；stop 先 TERM，5s 后 KILL 并核对整个 cgroup；lease 到期不等待 kill 结果继续延长期限。费用预算建议每 Run 5 USD/总10 USD，由 Host/Provider 预算策略约束；不能推定 OMP 存在相同的 CLI cost-cap 参数。OMP catalog 估价不是账单硬限额，实际账单可能超出；审批必须接受这一差异或先配置独立 Provider 硬配额。价表版本/hash与请求时间须固定以处理 DeepSeek 峰/谷费率。内存2GiB、pids32、总报告/提取输出32MiB，解析器独立限量；合法输入超过本 profile 能力时明确 READ_LIMITED/拒绝，不偷偷放宽。

OMP 首发拟采用 `omp -p --mode json --no-session`，配合精确 `--model deepseek/deepseek-flash`、固定公司 prompt/settings 与 `--tools read,grep,glob,write`；这些只是待物化命令模板的已观察参数，不是可直接执行的完整批准 argv。Adapter 须固定 OMP JSON 事件版本/parser并独立映射 ack、有限 progress、原 Provider usage、final/error；不能复用 Claude stream-json parser 或将 JSON 模式当成业务报告 v0.2 Schema。缺事件/模型版本证明仍 UNKNOWN/拒绝。OMP RPC abort 即使返回成功也不证明 DeepSeek 远端取消 ACK，本 profile 不因此开放 cancellation acknowledgement。

| 事件 / 故障 | 原 invocation 与 TE 处理 |
|---|---|
| dispatch | IG 先提交 Attempt/稳定键/lock/Package/bindings，Host 在 spawn 前 durable 标记 invoke-once intent；直接受信 executable + argv 数组，prompt 经 stdin/固定只读文件，无用户 shell command |
| ack | 原 CLI 真正启动产生的已识别事件与受管进程身份绑定后才保存 ack；CLI 启动观察不宣称 Provider 推理已成功。TE start 仍须原 ack 与当前授权/lease；预分配 session/实例不证明调用 |
| 丢回执 / Worker重启 | 只查询 IG 与 Host 原不可变 invocation journal 的 ack/output hashes；同 key/hash 不 spawn。spawn 前后未能证明是否执行的崩溃缝隙保持 UNKNOWN；不能保证 Provider 可查时就宣称已重建 |
| UNKNOWN / 超时 | 无可证原观察继续 UNKNOWN，无 fabricated empty success；TE 按受信期限终结为 TIMED_OUT/ABANDONED；Host 无期限续租、另一 Provider、第二 active Run 或 session resume 均拒绝 |
| stop request / 本地停止观察 | Human 意图先 TE 提交 CANCELLING；IG/Host 的独立当前 control 授权只向原 cgroup 请求停止，分别留 request、signal、LOCAL_PROCESS_STOPPED 或 STOP_UNKNOWN。本地全树退出/网络封闭仍不证明远端 Provider取消 ACK；首版不写 CANCELLED |
| final 与取消/到期竞态 | TE 同 Run lock/CAS 重读资格：record 先提交则新 cancel 拒绝；cancel/expiry 先提交则 final 只留 IG 历史与 TE late isolation Audit，零新可用 Acceptance/EP report。超时响应不是 Run 已到期的证明 |
| 显式 retry | 原 Run 已确定 terminal、非取消终结，旧 cgroup已确认停止、Scope/phase窗口仍允许且预算尚有第二次额度时，Human 显式新分析意图才允许新 snapshot/Context/Run/Bundle/Attempt/fencing；BLOCKED_INPUT 先有可信解决事实。原 UNKNOWN 不新发，第二次失败不产生第三次，旧 terminal 不 resume |

首发不加入取消后的 retry 或恢复 suspension。Provider 内部同模型传输重试如无法完全禁止，必须由精确 CLI/config 的有限 deadline/费用/调用日志约束并作为 invocation 内证据；不得改变模型/Provider、让 Host重启 CLI 或把多个真实请求藏成 exactly-once。Provider 请求数未知仍标 UNKNOWN。

## 4. 进程级输入、输出与数据边界

具体执行责任见 [Deployment 首发隔离](../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md#d14-runner-首发进程隔离提案256)与 [IP 最小权限](../module-specs/Module-Spec-001-IdentityPolicy.md#d14-runner-锁与控制授权提案256)。Ubuntu 受信 launcher 必须以每 Run 独立 UID/mount/PID/network namespace、非 root、drop capabilities、no-new-privileges、只读 rootfs 与强制 MAC/seccomp/cgroup 建立边界；任一机制缺失即拒绝 dispatch。

原件、manifest、模板、规则、prompt、证据代码与依赖只读，前/后逐件复核 hashes。客户按 server entryId 物化，不以 AGENTS.md/CLAUDE.md、`.claude`/`.pi`/`.omp`/`.qoder`、Skill/MCP 设置或原 ZIP 路径建立自动发现目录；正文作为客户证据阅读，不能当指令。cwd 和个人配置视图为空；OMP 使用已观察的 `--no-extensions --no-skills --no-rules --no-lsp --no-pty --no-title --no-prewalk` 收窄，并禁显式 extension/hook/plugin 加载。必须另关闭 MCP、memory、advisor、自动压缩/标题/辅助模型、context promotion 与 retry fallback，校验有效配置与实际工具全集；不能只凭 tools/no-extensions 或 profile 目录隔离宣称全禁用。公司规则仅作为锁定 prompt/input 提供，不借规则发现加载；配置解析失败/静默忽略不能回落默认。

只准 Write 本 Run output 根；scratch 也置于该根的非发布子目录，不能写原件、模板、规则、工具、另一 Run 或宿主。拒绝路径逃逸、symlink/hardlink/设备/FIFO、输出碰撞和继承文件描述符；Host 用受控根句柄解析、按实际 bytes 封存普通文件，不以 caller 路径授权。CLI root 工具限制仅是第二层收窄，必须另做 kernel/MAC 越界反例。

Runner 只读固定提取件和必要原件并写 analysis draft；外层固定 reader 在调用前提取，固定 v0.2 validator/renderer 在调用后生成最终 JSON/MD pair，均无模型二次分析、无安装权限。renderer 对 narrative hash 元数据排除自引用后生成 MD bytes，再把其 hash 写 JSON并保存最终 JSON bytes hash，拒绝用零 hash 发布。工具失败保留不可接纳诊断，不能由 Runner 改代码、Schema或覆盖结果放行。

Runner 网络仅准锁定的公司 Provider TLS inference 目的地，经受控 egress；无公网 DNS绕过/任意代理、loopback管理面、云metadata、Core/DB/OpenBao/Ceph、浏览器、MCP、搜索/下载、遥测/反馈/自动升级。需要新目的地须新版数据/网络政策与批准。公司 CLI 凭据由部署方预配置到仅 CLI 推理进程的最小私有环境，不沿用个人配置、不进入 prompt/argv/输出；无 Bash/exec/插件工具，隐藏 `/proc`/环境/调试接口、禁 core dump与继承 secret fd，固定 evidence 工具不继承凭据。Host只记录可用性证明与身份策略 ref，不读取/复制/刷新凭据。

脱敏批准覆盖每个实际 source hash、角色、用途、Provider 与限期；Hash、改名或去个人姓名不自动完成业务秘密脱敏。旧报告/可信决定、公司规则/模板同样检查可发送范围；不合规来源零 Provider 调用。正文、系统prompt、secret、隐藏推理/完整 transcript不进普通日志/Event；原报告/提取件、必要ack/final/usage bytes是加密且独立授权的证据，诊断只保留有限安全事件，保留/删除按精确批准 policy，不杜撰现有 retention。

## 5. 可复现 conformance 计划

本节是未来验收计划，所有真实执行保持 `NOT RUN`。后续 fixture producer须提供独立具名制品：`customer-policy.docx`、`customer-procedure.md`、`customer-organization-read-limited.docx`、`customer-instruction-injection.md`、发布模板/规则、`fixture-manifest.json` 与独立人工 `expected-facts.md`。先经批准脱敏，包含图/嵌入读取限制、保护方针/职责/产品、明确 UNKNOWN/CONFLICT、多模板对一文件与一模板对多文件、17/18数量、悬空 M25；每个源实际 bytes/hash、审批/发布/Scope refs 都须生成且可解析。不存在的 DOCX 不用 Markdown 改扩展名代替；当前仓库匿名字段样例不是这份实际输入。

执行步骤：先审查 exact revision/config 与真实物化 lock；通过 owning 入口接纳 fixture 源并生成真实 preparation source/Context/Contract/Run，不直接造数据库 refs；固定 reader产 extraction-index；记录一次真实 locked CLI invocation 与有效 ack/model/工具/网络观察；外层 finalize v0.2 后封存原 outputs；分别经 IG→TE→EP，最后由独立顾问核对保护事实/缺口/计划。补料重试使用批准第二额度的新 Run并对账旧历史。

| 独立证据层 | 可核验产物 / 判定，彼此不能替代 |
|---|---|
| 配置/隔离 | 审批 revision、物化 lock hash、actual installation/version、policy/build pins、只读/跨 Project/网络/secret负例；有配置不等于执行 |
| Runner/evidence tools | 真实 invocation 次数、ack与模型观察、输入前后 hash、extraction-index/ceilings、同次 JSON/MD bytes与 validator结果；standalone finalize 仅工具结论 |
| IG observation | 原 Attempt/Run/lock/Package/session/实例/lease/fencing 与 immutable ack/final/output refs/hash、UNKNOWN/late历史，原调用 readback；不替 TE 接纳 |
| TE result acceptance | 经当前独立 IP 授权，真实 Result/Validation/Acceptance/Run/原 IG observation exact refs/receipts，错误资格不 ACCEPTED；不替 EP 接纳或 Completion |
| EP report acceptance | 按 [EP 接纳合同](../module-specs/Module-Spec-002-EnterpriseProject.md#ep-操作输入和结果)消费真实 TE query，核 source/outputProfile/alias/前版/当前水位，保存 report/candidateSet/plan/hash及 becameCurrent；未知/冲突可审阅但不自动确认/start |
| 独立 Human / 兼容 | 人工逐项核 protected facts、read limits、需求/模板与客户依据，旧 v0.1/三个 CLI/synthetic bytes与支持集不扩；报告接纳不等于事实批准/启动/文件完成 |

v0.1 基准工具按观察 pins仅验证原 v0.1 证据结构；必须另提供 v0.2 schema/candidate validator/renderer 与相同读取约束回归。覆盖五类 startupCandidates、UNKNOWN/missingFields、CONFLICT/alternatives、词表/required规则及确定性 MD 完整性；只换 Schema不能算升级。详见 [Runtime conformance 矩阵](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md#d14-runner-首发锁与控制验收256)。

必要负例至少包括错 source/manifest/output/canonical hash、跨 Scope、sourceId/evidenceId换别名且重算合法 Hash、READ超 extraction ceiling、客户事实仅取模板、遗漏 protected fact、重复 final/异 Hash replay、late/旧 fencing、原 UNKNOWN重发、取消无ACK/OMP abort或本地kill冒充ProviderACK、输出根越界、输入漂移、模型别名/回退、同一API ID底层版本漂移或无法核验、OMP额外工具/配置/辅助模型加载、v0.1冒充v0.2、首次scope窗口关闭。每例保留真实拒绝与**零新 invoke/Acceptance/current report/start**中适用的计数，禁止只列预期。

## 6. 冻结与实现入口

本次明确的人类 Runtime/provider/model/条件性客户数据出网选择已记录§1；选择证据进入 PR并绑定所选配置内容及精确修订，公司模板/规则等实际发送许可仍逐源核验。独立 Reviewer核全部 owning Delta与用例，形成 `.vibe/reviews/pr-<number>/Review.md`；人类技术批准必须绑定该 reviewed SHA，后续实质修改重新审查/批准。独立审查和技术批准仍待取得，本文不预写批准，不把 Issue 的 NOW+READY设计状态扩大为依赖实现 READY；部署的数据前提尚未达成时不能物化可执行锁。

本次只执行 `vibe verify docs --json` 和 focused owner/ref/field/transition 对账，其结果只覆盖 Markdown设计交付。真实 OIDC/HTTP、PostgreSQL、Host/Runner/Provider、Browser/platform及独立人工验收均 `NOT RUN`。即使未来首个锁 conformance通过，也只覆盖该 bounded profile；all-four-runtime、生成/反馈、业务规则发布和首条真实客户链仍有自己的门禁。

后续 [Issue #264](https://github.com/qzhike/zhiju-business-core/issues/264) 在本合同之上实现了内部锁的闭合 Schema、静态类型、producer/validator 与物化 preflight（`contracts/src/d14-runner-execution-lock.ts`、`modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts`），并执行 `vibe verify code --json` 的 contract 级用例；该实现仍不注册公开 Command/TypedReference、不接线真实 dispatcher、不制造 §1 未取得的部署事实，因此本节的真实运行与人工验收门禁不变。
