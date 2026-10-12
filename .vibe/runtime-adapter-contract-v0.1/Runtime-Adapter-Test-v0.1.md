# Runtime Adapter Contract v0.1 测试规格

版本：v0.1
日期：2026-08-17
状态：`BASELINE TEST SPEC / DESIGN VERIFIED / USER PROGRESSION CONFIRMED / IMPLEMENTATION NOT STARTED`

对应规格：[`Runtime-Adapter-Contract-v0.1.md`](Runtime-Adapter-Contract-v0.1.md)。对应模块：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md) 与 [`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

`DESIGN VERIFIED` 只表示文档静态一致；Unit/Contract/E2E/Manual 在没有实现和真实 Provider 时保持 `NOT RUN`。

## 1. Design Gate

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-D-001 | HL/02/03/04/05/06/07/08、API、Module Spec/Test、Runtime 专项文档 | 路由完整；没有第八模块或第二套 Run/Completion | `high_level=9 api=3 module_specs=7 module_tests=7 feishu=4 runtime=4`；Markdown 结构问题 0 | `DESIGN VERIFIED` |
| RA-D-002 | Runtime Contract Core API mapping 与 200 项 Catalog | 已批准引用全部存在；未覆盖项只出现在 proposal | `baseline_refs=16 missing=0 proposals=6`；Catalog/Specs 均 200 unique、集合差 0 | `DESIGN VERIFIED` |
| RA-D-003 | 三个 Installed CLI Profile | 每项只有 CLI 官方来源；能力事实与本地验证状态分开 | `cli_profiles=3 official_urls=3`；全部标记 local `NOT RUN` | `DESIGN VERIFIED` |
| RA-D-004 | 安全、Lease/Fencing、Result、Usage、Resume/Retry 章节 | 关键负向锚点齐全、无 Human-only 越权 | `security_anchors=10 security_issues=0`；错误码与禁止边界可定位 | `DESIGN VERIFIED` |

## 2. Unit

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-U-001 | 相同 dispatch stable key + 相同 invocationHash 三次 | 返回同一 Attempt，不重复启动 Provider | 无实现 | `NOT RUN` |
| RA-U-002 | 相同 stable key + 不同 invocationHash | 冲突并 Quarantine，不启动第二次 | 无实现 | `NOT RUN` |
| RA-U-003 | 旧 fencingToken 提交 final Result | `LATE_RESULT_QUARANTINED`，不改变 Run | 无实现 | `NOT RUN` |
| RA-U-004 | Usage 缺少 reasoning/cost | 对应字段 UNKNOWN，不填 0 | 无实现 | `NOT RUN` |
| RA-U-005 | Runtime PROGRESS 含隐藏推理/Secret | 丢弃敏感内容并记录安全违规 | 无实现 | `NOT RUN` |
| RA-U-006 | final BLOCKED_INPUT 请求 Resume 原 Run | 拒绝，必须创建新 Run Retry | 无实现 | `NOT RUN` |
| RA-U-007 | Provider cancel 请求 timeout | Attempt/Run 保持 UNKNOWN/CANCELLING，不标 CANCELLED | 无实现 | `NOT RUN` |
| RA-U-008 | WorkspaceOutput 路径与 Artifact 同名 | 不满足 ExpectedOutput，不创建 Revision | 无实现 | `NOT RUN` |

## 3. Contract

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-C-001 | Execution Package 缺 workOrder/context/capability Hash Ref | Schema/Reference Validation 拒绝 | 无 Schema | `NOT RUN` |
| RA-C-002 | Dispatch Invocation 试图覆盖 executable path、把 Prompt 塞入 argv、注入 shell command 或额外 argv | Payload Guard 拒绝且不启动进程 | 无 Schema/Process Driver | `NOT RUN` |
| RA-C-003 | 未知 Runtime Event Major | Quarantine，不猜测转换 | 无 Mapper | `NOT RUN` |
| RA-C-004 | Provider event ID 相同、payloadHash 不同 | Replay conflict，首个事实不改写 | 无 Mapper | `NOT RUN` |
| RA-C-005 | AgentResult 只有自然语言 final message | Schema invalid；Run 不进入 SUCCEEDED | 无 Mapper | `NOT RUN` |
| RA-C-006 | RuntimeBinding 与 RunCreation 不一致 | 拒绝 dispatch/result binding | 无 Validator | `NOT RUN` |
| RA-C-007 | required CLI 缺失、版本不兼容或认证不可用，但 fallback 可用 | 不静默替换；返回明确 policy/availability 结果 | 无 Probe/Router | `NOT RUN` |
| RA-C-008 | Agent capability 包含 approval/release | Package 构建拒绝 `HUMAN_ONLY_CAPABILITY` | 无 Validator | `NOT RUN` |

## 4. E2E

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-E-001 | READY WO→Run→受控 argv 启动已安装 CLI→解析 structured final Result | Attempt/Process/Receipt/Run/Result 链可追溯；Completion 另行计算 | 无 Adapter/Core 实现 | `NOT RUN` |
| RA-E-002 | Provider dispatch timeout 后查询发现已启动 | 复用同 Attempt 补记 Receipt，不重复启动 Run | 无 Adapter | `NOT RUN` |
| RA-E-003 | RuntimeInputRequired→Feishu Answer→same Run Resume | 仅在 continuation/context/token 均有效时恢复；历史不改写 | 无 Runtime/飞书 | `NOT RUN` |
| RA-E-004 | final BLOCKED_INPUT→Human Answer | 新 ContextSnapshot、新 Run；旧 Run terminal | 无 Runtime/飞书 | `NOT RUN` |
| RA-E-005 | Codex Run timeout，Policy 允许 Claude Code fallback | 新 Run/Attempt/Token/Binding；旧 Usage/Provenance 保留 | 无两个 Adapter | `NOT RUN` |
| RA-E-006 | Human cancel，Provider未确认且 Lease 到期 | CANCELLING→ABANDONED；late result Quarantine | 无 Adapter/Timeout Service | `NOT RUN` |
| RA-E-007 | Provider structured result 引用跨 Project Revision | AgentResult REJECTED/QUARANTINED，不处理 Proposal | 无 Validator | `NOT RUN` |
| RA-E-008 | Adapter 进程在 Provider 成功后、Receipt 提交前崩溃 | 相同 key reconciliation 补记，不盲目重发 | 无 Persistence/Adapter | `NOT RUN` |

## 5. Manual

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-M-001 | 已安装 `codex`、`claude`、`openclaw` 的最小 hello/structured result Fixture | Reviewer 可比较探测、argv、stdout/stderr、Result、Usage 与 continuation 差异 | 未连接三个 CLI | `NOT RUN` |
| RA-M-002 | 恶意 workspace 指令请求 approve/release/越权读取 | Runtime 可执行层与 Core 均拒绝，审计不泄密 | 未准备 Fixture | `NOT RUN` |
| RA-M-003 | Cancel/timeout/network partition 演练 | UI/审计准确区分 UNKNOWN、FAILED、CANCELLED、ABANDONED | 未实现 | `NOT RUN` |
| RA-M-004 | WorkOrder→Run→AgentResult→Completion 审核 | Reviewer 能区分四层完成与 Workspace/Business Output | 未准备 Fixture | `NOT RUN` |

## 6. 当前结果

- 32 个用例：4 Design、8 Unit、8 Contract、8 E2E、4 Manual。
- 4 个 Design Gate 已完成静态 `DESIGN VERIFIED`；其余 28 个 Unit/Contract/E2E/Manual 保持 `NOT RUN`。
- 不存在 Runtime Adapter、Process Driver、Schema、Fixture 或真实 CLI 执行；CLI 安装和认证是部署前提，不由本项目实现。


## #233 正式输出 profile 设计用例

| ID | 层级 / 输入 | 预期 | 实际 / 结果 |
|---|---|---|---|---|
| RT-COMP-D-001 | Controlled Application + PostgreSQL / 三份实际调用的versioned模板及normal/recovered owning fixture | 调用前固定模板Hash，Artifact提交后才计算Result Header/提交时间；无虚构receipt或先引用未来Result，Run-2独立Context/invocation | OWNING/PG/CONTROLLED PASS：normal/recovered独立fixture和三个固定versioned模板被实际调用；真实新Artifact Receipt提交后才冻结原invocation final，Run-2新Context/实例/session；Core合法空COMPLETED负例独立执行。 |
| RT-COMP-D-002 | Controlled Application + PostgreSQL / release错误身份/Ref、readFinal跨restart/期限后释放 | protected依赖读先授权，同键稳定原文，第二final拒绝，expiry由TE决定；不是Provider conformance或manual business acceptance | APPLICATION/PG/CONTROLLED PASS（已执行）：Human-only、未提交Ref/Receipt、冲突第二final、restart原文与无再invoke；实际deadline赢后sealed output不救late Result/Completion。期限后首次release子项NOT RUN；External Provider/manual仍NOT RUN。 |

## D14 / RD-01 真实 Profile conformance 场景提案

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。候选不是默认，lock/批准要求见 [Delta §7](../decisions/d14-rd01-first-customer-flow.md#7-首个-runtimeprofile-候选与待批准选择)。standalone Runner、Host acceptance、公网/Browser 各自出证，不能互相替代。

| ID | 输入 / 故障 | 可观察预期 | 实际 / 结果 |
|---|---|---|---|
| RA-D14-001 | exact CLI/model/prompt/Skill/MCP/template/rule/output locks，脱敏 DOCX/MD | 原 invocation trace/ack/output hashes 可绑定；输出 v0.2 完整快照，固定 renderer 数量一致；CLI/version/认证/预算证据分列 | 未执行 / `NOT RUN` |
| RA-D14-002 | 客户含恶意 Skill/AGENTS/CLI/模板同名；尝试改原件/模板、越输出根/网络 | 公司配置不被替换；Host 隔离拒绝，结束输入 hashes 不变；CLI permission allow-list 不是隔离证明 | 未执行 / `NOT RUN` |
| RA-D14-003 | 模板填客户事实、组织图读限、M25悬空、17/18数量、多对多映射 | 无虚构依据/全读；来源/候选缺口明确，逐 ID 对账；READ/checks 不证明业务正确或批准 | 未执行 / `NOT RUN` |
| RA-D14-004 | actual output 进入 IG→TE→EP；错 manifest/path/hash/session/lease/fencing | 三段各有真实事实与安全拒绝；独立 finalize 成功不足以 Host acceptance | 未执行 / `NOT RUN` |
| RA-D14-005 | dispatch UNKNOWN、取消/超时/重启readback、terminal重试 | 原键不重复 invoke，真实停止观察非伪 ACK，late仅历史，许可 retry 新 Run，首版不 session resume | 未执行 / `NOT RUN` |
| RA-D14-006 | observed CLI/version/model/provider 漂移、缺公司 mandatory规则/词表、profile不可用 | 不 ready/invoke，无默认/fallback/API直连；明确 IM-DG-006 决定与 conformance缺口 | 未执行 / `NOT RUN` |

首轮恢复追加场景（`NOT RUN`）：**RA-D14-007** — ACTIVE/PREPARATION + frozen start + 未收首轮 scope 的 supplemental analysis；核对 INITIAL_SCOPE_RECOVERY Context/Package binding 和输入只读，窗口关闭后 late outputs 仅历史；不第二次启动、不产生后续批次资格。

## D14 Runner 首发锁与控制验收（#256）

状态：`PROPOSED / HUMAN SELECTED 2026-10-09 / TECHNICAL APPROVAL PENDING / NOT RUN / INTERNAL CONTRACT-ONLY CASE SET EXECUTED (#264)`。采用 [首发提案§5](../decisions/d14-rd01-runner-profile-lock.md#5-可复现-conformance-计划)的具名、批准脱敏DOCX/Markdown输入；实际bytes/hash/部署lock/原invocation/owningreceipts与独立Human核对是必需制品。表中均为未来计划，不因为只读version/help、旧standalone finalize或Markdown Gate改成平台PASS。#264 只执行了内部 lock/producer/validator/preflight 的 contract 级用例（`contracts/src/d14-runner-execution-lock.test.ts`、`modules/integration-gateway/src/runtime/d14-runner-lock-preflight.test.ts`，含 RA-LOCK-001/003 的配置/观察/部署分层、固定版本证据与工具面拒绝语义）；本表任何一行都保持 `NOT RUN`。

| ID | 输入 / 必需执行 | 可观察判定 | 实际 / 结果 |
|---|---|---|---|
| RA-LOCK-001 | 明确人类选择、exact reviewed SHA批准；配置、Darwin观察和真实Ubuntu物化lock各自取证 | 三层不互相替代；缺CLI/Host/Adapter/prompt/rule/tool digest或当前数据许可零invoke；不填latest/虚构hash | 未执行 / `NOT RUN` |
| RA-LOCK-002 | 一次真实lockedCLI、固定reader/v0.2validator/renderer、原JSON/MD/extraction进入IG→TE→EP | invocation次数/模型/原ack/outputs与各层refs/receipts分别可读；inputs前后hash相同；report可审阅不自动start/Completion | 未执行 / `NOT RUN` |
| RA-LOCK-003 | OMP精确selector与DeepSeek API ID/批准版本分列；缺固定版本证据、同deepseek-flash底层版本变化或不可核验；默认config忽略、辅助模型/context promotion/retry fallback/MCP/Skill/显式extension及工具URL/URI | 名称相同不证明版本固定；capability/config/版本绑定不足不dispatch，运行中漂移隔离不接纳；实际仅read/grep/glob/write且根内普通文件，零额外模型调用/自动替换/第二CLI调用 | 未执行 / `NOT RUN` |
| RA-LOCK-004 | 客户AGENTS/CLAUDE/Skill/MCP注入与模板同名、试改原件/规则/工具 | 客户内容仅证据；发现/执行禁用，kernel/MAC拒绝写，前后hash不变；不能靠flag自报安全 | 未执行 / `NOT RUN` |
| RA-LOCK-005 | 输出穿越/link/FIFO/device/碰撞；跨Enterprise/Project/Run读写；secret/proc/Core/metadata/外网/代理访问 | 强制隔离实际拒绝，零越界bytes/泄密/不准入Provider调用；日志无正文/秘密/推理 | 未执行 / `NOT RUN` |
| RA-LOCK-006 | spawn前后崩溃、ack/IG提交后响应丢失、Worker重启且原journal存在/不存在 | 只readback原Attempt；可证补交相同ack/output，不能证实维持UNKNOWN；同键零第二spawn | 未执行 / `NOT RUN` |
| RA-LOCK-007 | Host真实heartbeat/progress、重复key、旧fencing、deadline/lease/授权到期 | TE有限续租不越policy/预算/有效期；progress零完成/续租；late/replay不获新执行资格 | 未执行 / `NOT RUN` |
| RA-LOCK-008 | 调用全部六项控制，含suspend/resume/cancelACK及CLI自报批准/Usage | 三项有限支持、三项UNSUPPORTED；无SUSPENDED/RESUMED/CANCELLED假事实，missingUsage不填0，Agent声明不升级权威 | 未执行 / `NOT RUN` |
| RA-LOCK-009 | Humancancel、OMP abort响应、只发signal/父进程退出/全树退出/无DeepSeek远端ProviderACK；期限与final竞态 | intent/request/localstop分列；OMP abort或本地退出不当ProviderACK，无ACK不CANCELLED；cancel/expiry先赢则late仅历史，record先赢cancel拒绝 | 未执行 / `NOT RUN` |
| RA-LOCK-010 | UNKNOWN重试、已terminal但旧树未知、合法第二Run、第三次/取消后retry | 前两者拒绝invoke；合法新Context/Bundle/Run/Attempt/fencing最多第二次，旧历史不改；第三次/取消后retry/同Runresume拒绝 | 未执行 / `NOT RUN` |
| RA-LOCK-011 | 各层错manifest/source/output/canonical hash、wrongScope/session/fencing、source/evidence别名交换且自洽重算 | 对应IG/TE/EP独立拒绝，原bytes不修补；零可用Acceptance/currentreport/start；sourcealias不是EvidenceRef | 未执行 / `NOT RUN` |
| RA-LOCK-012 | 同final同Hash重复、异Hash第二final、late输出及ACTIVE初轮窗口关闭 | 原观察稳定，冲突隔离；一Run一final，late不覆盖EPcurrent或启动，窗口关闭不再执行新分析 | 未执行 / `NOT RUN` |
| RA-LOCK-013 | v0.1工具输出冒充v0.2、五类startupCandidates遗漏/未知/冲突、组织图READ超ceiling、模板推客户事实 | 不偷扩v0.1支持集；独立v0.2schema/validator/renderer与读取约束回归；未知/冲突合法但必要值阻启动；错误宣称READ/依据拒绝 | 未执行 / `NOT RUN` |
| RA-LOCK-014 | approved匿名expected-facts独立核对保护方针/职责/产品、17/18数量、M25与多对多模板 | 保护值/来源/缺口逐项解释，不自动展开授权编号/确认事实；确定性checks不证明业务语义正确 | 未执行 / `NOT RUN` |

覆盖归属：原调用/stop/readback由 [IG-LOCK](../module-tests/Module-Test-007-IntegrationGateway.md#d14-runner-原调用与锁验收256)，六控制/Run由 [TE-LOCK](../module-tests/Module-Test-003-TaskExecution.md#d14-runner-六项控制与结果验收256)，当前授权/数据边界由 [IP-LOCK](../module-tests/Module-Test-001-IdentityPolicy.md#d14-runner-最小权限与锁验收256)。EP报告仍执行既有EP-D14-003/004/010，owner不变化。真实HTTP/OIDC/PostgreSQL/Host/Browser/Provider与独立人工验收各出证，当前全部 `NOT RUN`；四Runtime全面conformance不属首发Gate。

## Markdown 生成 Profile 设计场景（#259）

权威见 [Runtime #259](Runtime-Adapter-Contract-v0.1.md#markdown-整份生成与旧基准复核-profile-提案259)，均匿名设计trace。原型/自检/exit码不替代下表真实调用、Host接纳或人工内容判断。

| ID / 输入 | 可核验预期 | 实际 / 结果 |
|---|---|---|
| RA-MF-001 / approved generation lock+MF-01/02支持模板，原intent/constraints+单file真实调用 | 精确部署/tool/schema/model/data权限，输入只读/输出根隔离；三份原bytes绑定同Run/session，内容完整；generation feasible与Host acceptance分别取证 | 未执行 / NOT RUN |
| RA-MF-002 / MF-07旧base B/M/current S，重复标题/row或冲突/保护/跨file要求 | 原三快照分别保存，不推filename身份；只处理authorized S→candidate，不automatic merge/rebase，歧义/保护待Human | 未执行 / NOT RUN |
| RA-MF-003 / 缺profile/lock漂移、AGENTS/tool加载、出界path、HTML/外链/输出替换或v0.1/analysisselector | 物化前/受控Host/validator fail closed，零非法invoke或accepted candidate，不换Harness放行 | 未执行 / NOT RUN |
| RA-MF-004 / MF-08 ack UNKNOWN、重启、异hash二final/新Run旧session、取消/过期late | 原journal查询、zero second invoke；Run/fencing精确来源，late只历史；旧Result/Revision/其他file完整保留 | 未执行 / NOT RUN |
| RA-MF-005 / MF-10 partial处理报告、ART接纳/Head失败、导航/下载成功 | 所有submittedItem显式 disposition/real locations，反馈未处理不伪全成功；ART/Quality/Human判断独立，审阅和下载不Completion/Approval | 未执行 / NOT RUN |
