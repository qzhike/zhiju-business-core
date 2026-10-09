# PR #261 独立设计审查

## 审查对象与结论

- Issue：[#256](https://github.com/qzhike/zhiju-business-core/issues/256)，`T2 / design only`。
- PR：[#261](https://github.com/qzhike/zhiju-business-core/pull/261)，OPEN / Draft。
- Reviewed SHA：`8e8d2715b815179e92a18f444fb0eca13d58d466`。
- Base SHA：`15c085354056ab327e03352c32020010cc11285b`。
- 独立审查日期：2026-10-09。
- 独立设计语义结论：`DESIGN VERIFIED / NO BLOCKING DEFECT FOUND`。
- Reviewer role outcome：`HUMAN_REVIEW_REQUIRED`。
- 该精确修订的人类技术批准：`PENDING / NOT PROVIDED`。

以上为批准前的独立审查结论；最新人类技术批准见[批准记录](#人类技术设计批准8e8d271)。

本次从最新 Issue、已批准 D14/RD-01 与相关 owning 契约建立预期，再审查 base-to-head 的全部 11 份 `.vibe/` Markdown 差异和 exact-head CI。工作区起始干净，`vibe repo --json` 的 repository/head 与 PR 一致；发布前再次读回远端确认 head/base 未变。未修复提案或产品实现。本正式记录是审查后的本地新增文件，不包含于上述 reviewed SHA 或其 CI；其配置文档验证证据随 PR 评论交付。

## 独立预期与验收对账

审查前的关键预期：配置选择不能替代部署事实和运行时授权；锁必须绑定实际制品、模型、输入和同次 invocation；六项控制须逐项确定支持或拒绝；UNKNOWN 只能回读原调用；取消意图、本地停止、Provider ACK 与 TE 终态分别成立；只读输入和跨 Project/Run 隔离由进程边界强制；IG 原观察、TE Result Acceptance 和 EP 报告接纳不能相互代替。旧公开合同及 synthetic/v0.1 支持集不能因新设计自动扩大。

| Issue 验收 | 当前修订的独立判断 |
|---|---|
| 四目标证据与人类选择 | [首发提案 §1](../../decisions/d14-rd01-runner-profile-lock.md#1-首发选择与证据)保留 OMP、pi、qoder-cli、Claude Code，并记录 OMP + DeepSeek 官方 API + DeepSeek-V4.1-Flash 及条件性客户资料出网选择。PR 正文把选择绑定 reviewed SHA；选择、技术批准、部署许可和客户数据准入分别记录。只读 Darwin 安装观察没有提升为 Ubuntu 或真实 conformance 证明。 |
| 一个版本化锁与三层证据 | [锁合同 §2](../../decisions/d14-rd01-runner-profile-lock.md#2-一个版本化锁合同与三个不同证据层)明确 ApprovedConfiguration、InstallationObservation、MaterializedLock 的不同放行含义；完整 pins、缺值拒绝、版本漂移、新配置和新 Run 边界与 IG/Runtime 专节一致。启动规则内容仍由独立规则设计发布，本提案只定义精确引用接口。 |
| 六项 Runtime 控制 | [TE 首发控制](../../module-specs/Module-Spec-003-TaskExecution.md#d14-runner-首发六项控制提案256)逐项列出有限 heartbeat/progress/usage 和拒绝 suspension/same-Run resume/cancellation ACK。当前授权、依赖读权、lease/fencing、重放、期限及使用历史计量的边界可解析；没有宣称六项已注册或全 IM-DG-006 已批准。 |
| 输入、输出与数据隔离 | [Deployment 专节](../../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md#d14-runner-首发进程隔离提案256)和 [IP 专节](../../module-specs/Module-Spec-001-IdentityPolicy.md#d14-runner-锁与控制授权提案256)要求每 Run 强制文件/进程/网络边界、输入与工具只读、独立输出根、当前逐源数据许可和最小凭据环境；客户配置只作证据。OMP tools/flags 作为收窄措施，不能替代隔离或关闭全部发现面。 |
| 可复现 conformance 与独立接纳 | [计划 §5](../../decisions/d14-rd01-runner-profile-lock.md#5-可复现-conformance-计划)具名脱敏 DOCX/Markdown、manifest、发布输入和独立 expected-facts；由 owning 入口生成真实链，分别取证 Runner、IG、TE、EP 和 Human。v0.1 工具与 v0.2 startup 输出分别固定和回归，错 hash/别名/read ceiling、重复/late、保护客户事实等反例已列入 owning 测试计划，均保持 NOT RUN。 |

## 受影响合同的字段与支持集矩阵

本修订没有机器 Schema、Registry、producer 或 validator 实现；以下对账覆盖 Markdown 中声明的全部新增字段组和控制分支。机器 required/optional、拒绝值和实际接口验证仍须由后续实现独立交付，不能用本表代替运行测试。

| 合同 / 字段组 | 声明字段与消费边界 | 对账结果 |
|---|---|---|
| `d14.runner_execution_lock@1.0` identity/approval | lockId、lockVersion、profileCode、approvedConfigurationVersion/hash、installationObservationHash、reviewedRevision、selection/review/technicalApproval 证据；自身 lockHash 排除，审批不进入自身被签 hash | 配置、观察、批准和 Run 物化不混用；锁是新内部身份，不伪装已注册 TypedReference。 |
| lock CLI/adapter/Host | executableCode、受信路径、observedCliVersion、CLI binary/build/dependency digest、adapterCode/version/source SHA/build digest、harnessId/version、Host OCI digest、OS release/kernel/architecture、launcher/parser version/digest | IG/Deployment 同一精确 pin 要求；缺值不以 Darwin、浮动 tag 或产品名补齐。 |
| lock model/data | provider、modelId、approvedModelVersion、固定版本绑定证据 ref/hash、逐调用核验规则、公司身份策略 ref/hash、API transport/endpoint/network/dataPolicy refs/hash、modelConfigHash 与全部实际参数/默认值 | API ID 与模型版本分列；仅同名回显不足以运行或接纳；DeepSeek 数据证据须重新取得。 |
| lock prompt/tools | company system/task prompt refs/bytes hashes、有效 settings hash、Skill/MCP allowlists、hooks/plugins/extensions/subagents/memory 状态、read/grep/glob/write 闭集与权限规则 | 空允许名单与缺名单有不同含义；额外工具、URI、配置发现、辅助模型和 fallback 不放行。 |
| lock templates/startup rules | NonEmpty PUBLISHED template refs/publication receipts/bytes hashes、ruleBundleRef/version/hash/publication receipt、startupRulesRef、vocabularyRef/version/hash | 接口连接现有 EP StartupBinding；未发布输入不可物化，业务清单未在本提案复制或虚构。 |
| lock input/output/evidence tools | InputAliasManifest schema/version/actual bytes hash、PreparationSource/Context exact refs/hash、outputProfile/schema refs/version/hash、reader/validator/renderer code/runtime/dependency-lock/build digests、完整命令模板 | 实际 bytes hash 与 cv1 hash 分域；v0.1 finalize/renderer 不能冒充 v0.2 或平台接纳。 |
| lock isolation/controls/validity | filesystem/network/tool/data/resource/六控制 policy refs/hash、retention/cleanup policy、enterprise/project/task/WO/Run/Attempt/Contract/Package refs/hash、analysisRequestKey、manifest bytes hash、leaseId/fencingToken、issuedAt/validUntil、phase、必要 frozen start ref、每 Run 输出根 | Scope、期限、预算和 INITIAL_SCOPE_RECOVERY 窗口均须重验；改变锁配置不能覆盖冻结 WorkOrder、旧 Run 或旧输出。 |
| Package@1.1 preparation 增量 | materializationManifest 中 lockId/version/lockHash，纳入 packageHash 与 invocationHash，供 IG journal、TE provenance 和 EP report bindings 解析 | [Runtime 增量](../../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#d14-runner-首发执行锁增量256)与 IG 声明一致；Package@1.0 与 synthetic 接受集不扩大。 |
| 三项支持的 TE control payload | 必填 attemptRef、observationRef、leaseId、fencingToken；共享 MUTATE/OBJECT Run target、CAS、稳定键和 payloadHash；时间/phase/metering/lock/session 来自 owning 观察 | 没有由 caller 时间、正文或自洽 JSON 补造来源的入口；当前独立写权/IG 读权、提交重验与幂等规则分别明确。 |
| IG preparation_control_observation | observationId、attemptRef、runRef、packageRef、lockId/lockVersion/lockHash、runtimeAdapterIdentityRef、runtimeSessionRef、leaseId/fencingToken、kind、observedAt、source、details；可选 rawEvidenceRef/rawEvidenceBytesSha256；canonical hash 排除自身 Ref/hash | [IG 专节](../../module-specs/Module-Spec-007-IntegrationGateway.md#d14-runner-物化锁与原调用观察提案256)要求原成功 ack/session/Scope/hash 和真实来源；当前未注册类型与旧 synthetic-only Queries 分离。 |
| IG observation 判别分支 | HOST_HEARTBEAT/HOST_PROCESS、PROGRESS/CLI_PROTOCOL、USAGE/PROVIDER、STOP_REQUESTED/HOST_PROCESS、LOCAL_PROCESS_STOPPED/HOST_PROCESS、STOP_UNKNOWN/HOST_PROCESS；progress phase 为 INPUT_READ/REPORT_DRAFT/OUTPUT_GUARD | 未知 kind/source/phase 拒绝；存活不证明业务进度，进度不续租；Provider metering 与估价/Agent 自报分开，missing 为 UNKNOWN/UNAVAILABLE。 |
| 三项拒绝控制 | record_run_suspension、resume_suspended_run、acknowledge_run_cancellation | 首发返回 EXECUTION_CRITERION_UNSUPPORTED，零新 invoke/lease/成功状态；OMP abort 或本地全树停止不满足 Runtime §13 的 Provider ACK 条件。 |

## 关键失败边界的独立判断

| 直接边界 / 反例 | 当前设计如何处置 |
|---|---|
| 同 `deepseek-flash` API ID 指向变化模型，或没有逐调用固定版本证明 | 不物化、不 dispatch；运行中漂移不接纳。argv/catalog/响应同名不作为不可变版本证据。 |
| spawn 前后崩溃、ack/提交响应丢失、Worker 重启 | 只读原 Attempt 与受保护 invocation journal；无法证明是否调用则 UNKNOWN，不因查无 Receipt 再 spawn。 |
| 期限/授权/fencing 已过期，或旧进程树未证停止 | heartbeat 不获得新执行资格；原 UNKNOWN/旧树未知不 retry。合法新分析最多第二次，重新 source/Context/Bundle/Run/Attempt/fencing；BLOCKED_INPUT 先有真实解决事实。 |
| Human stop、OMP abort、父进程退出或全 cgroup 停止 | 分别保存 intent/request/signal/local-stop/unknown；不产生 Provider ACK 或 CANCELLED。CANCELLING 到期由 TE 独立转 ABANDONED。 |
| cancel/expiry 与 record 竞争，同 final 重放或第二异 hash final | 同 Run lock/CAS 裁决；取消先赢则 late 仅 IG 历史与 TE Audit，零新可用 Acceptance/EP report；record 先赢则取消拒绝。一 Run 一 final identity。 |
| 客户 AGENTS/Skill/MCP、read/write 内部 URI、个人配置或辅助模型 | 不加载客户执行配置；有效设置/工具集合及 OS/network 反例须真实验证。URI 与超允许名单工具拒绝，flags 自报不能证明安全。 |
| 错 hash/Scope/session、别名交换后自洽重算、READ 超 ceiling、模板代替客户事实 | IG/TE/EP 各层独立拒绝对应错误；不修补原 bytes 伪造来源。EP 已有报告/候选接纳规则和 EP-D14-003/004/010 继续拥有业务判定，报告不自动启动或完成项目。 |

未发现需要退回 Implementer 修复的阻塞设计缺陷。Ubuntu 制品、Provider 固定版本和逐调用证明、数据合同/驻留/保留期/客户授权、公司 prompt/发布规则/模板、v0.2 工具与真实 conformance 的缺失已显式保留，并作为不可运行条件；这些未物化事实不能被此次设计审查补齐。

## 验证证据与未运行边界

- 独立读回 [CI run 37906460526](https://github.com/qzhike/zhiju-business-core/actions/runs/37906460526)：headSha 精确等于 reviewed SHA；select、checks、verify 为 SUCCESS，checks 的 Verify documentation step 为 SUCCESS；code/Chromium/persistence 为文档路由的预期跳过。依据项目规则复用当前证据，没有为同一 head 重复执行配置目标。
- 独立 `git diff --check`：PASS。
- 对全部新增本地 Markdown 链接/锚点做 focused 检查：31 项，零未解析目标。
- 对实际 diff 及新增场景做 focused 检查：11 份 `.vibe/` Markdown；IP-LOCK 5、TE-LOCK 8、IG-LOCK 5、RA-LOCK 14，共 32 项，ID 唯一且全部 NOT RUN；六控制表完整。
- 依据官方 [DeepSeek 模型详情](https://api-docs.deepseek.com/quick_start/pricing/)及[更新日志](https://api-docs.deepseek.com/updates/)确认当前 API ID/展示版本区分；这些资料没有建立本部署所需的不可变模型绑定。
- 依据官方 [OMP 仓库](https://github.com/can1357/oh-my-pi)与[模型配置](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md)核对工具/配置发现、辅助模型、context promotion 与成本估算风险；提案已要求逐项禁用/核验。pi、qoder-cli、Claude Code 的官方文档支持保留候选的有限能力说明，没有把资料能力当实际 conformance。
- 依据 [DeepSeek 公共隐私政策](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)核对数据处理资料边界；公共政策不能替代实际公司 API 合同、精确数据许可和部署证明。
- 本次没有重跑旧客户报告、调用 Provider、安装/注册 profile 或读取凭据；只读安装观察仍保持其声明环境与证据层。
- 真实 OIDC/public HTTP、PostgreSQL/full、Ubuntu Host/Runner/Provider、Browser/platform、安全隔离运行场景与独立人工业务验收：全部 NOT RUN。32 项新增场景是未来验收计划，不是运行 PASS。

## 剩余人工门禁与交付

Issue #256 Verify 和 [提案 §6](../../decisions/d14-rd01-runner-profile-lock.md#6-冻结与实现入口)明确要求独立设计审查后，由人类对精确 reviewed SHA 给予技术批准，才能冻结改变的语义或重新判断依赖实现 READY。当前没有该批准；Runtime/model/条件性数据边界的选择不能替代这一决定。因此角色结论为 HUMAN_REVIEW_REQUIRED，独立设计语义审查没有阻塞发现。

本次用户明确授权发布 PR 评论；该评论交付 reviewed SHA、角色结论、证据和 NOT RUN 边界，并需发布后读回。不提交 GitHub 原生 APPROVE/REQUEST_CHANGES review。正式 Review.md 保存在本地，尚未 commit/push；不修改业务代码或 owning 提案，不合并、部署、关闭 Issue 或把依赖实现宣布 READY。

## 人类技术设计批准：8e8d271

- 批准日期：2026-10-09。
- Approved SHA：`8e8d2715b815179e92a18f444fb0eca13d58d466`。
- 批准时读回：PR #261 为 OPEN / Draft，远端 head 与 reviewed SHA 一致；base 仍为 `15c085354056ab327e03352c32020010cc11285b`。
- 批准来源：用户在上述独立审查结论之后明确回复“批准”；本记录保存本会话的人类决定，不伪装为 GitHub 原生 APPROVED review。
- 独立审查证据：[已发布的审查评论](https://github.com/qzhike/zhiju-business-core/pull/261#issuecomment-6078155448)，设计语义 `DESIGN VERIFIED / NO BLOCKING DEFECT FOUND`。
- 该精确修订的人类技术设计批准：`APPROVED`。
- 批准后的 Reviewer role outcome：`APPROVE`，限定 #256 的 T2 设计交付。

本批准覆盖该修订的 OMP + DeepSeek 官方 API + DeepSeek-V4.1-Flash 首发选择、有界执行锁、六项控制支持/拒绝、授权与进程隔离、条件性数据边界及 conformance 计划。上文 HUMAN_REVIEW_REQUIRED/PENDING 保留为批准前历史；本次明确决定满足 #256 的精确修订人类技术设计批准门禁。

Ubuntu/CLI/adapter/Host 制品 pins、Provider 固定版本绑定及逐调用证明、公司 API 合同/驻留/保留期/客户授权、发布模板/启动规则与 v0.2 工具等缺失事实仍须按获批设计取得。审批不制造这些值或准入证据，完整可运行锁仍未物化；依赖实现需重新判断 NOW + READY。真实 OIDC/HTTP、PostgreSQL、Host/Runner/Provider、Browser/platform、安全隔离运行场景和独立人工验收继续 NOT RUN。

本次只追加正式批准记录并在同一 PR 发布批准补充评论。该记录尚未 commit/push，且不属于 Approved SHA；PR/Issue 状态与后续 Git 交付按各自授权处理。
