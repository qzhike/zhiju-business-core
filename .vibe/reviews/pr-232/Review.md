# PR #232 独立实现审查

- 日期：2026-09-28。
- PR：[PR #232](https://github.com/qzhike/zhiju-business-core/pull/232)，Draft；工作项：[Issue #231](https://github.com/qzhike/zhiju-business-core/issues/231)。
- Reviewed SHA：`05a1ac760c8d5cab4241d1e66de63aa7714af5a3`。
- Base SHA：`84d1bd4d92ddb5aa7c337960d380a03fb511fbd5`。
- Role outcome：**REQUEST_CHANGES**。

## 独立判据与范围

先读取 Issue、HL-Spec 冻结规则、Spec 003 §24 和当前验证要求，再对照新增 Schema、恢复入口、IP Human 资格证明、Request/Resolution/retry、Context 构建、Root reconcile、Process 与相关 SQL guard。重点判据为公开契约与 Handler 支持集分离、原 frozen 历史不变、同一 Human 确认/答复/采纳、独立当前权限、新 Context/Run、累计预算和幂等恢复。

本轮在确认下述契约阻断后结束取证，不将已阅读路径写成全量运行验收或所有其余路径已批准。未修改产品代码或权威设计。

## R1 — P2：保留 ContextBuildRequest 的普通数组契约

位置：`contracts/src/operations/task-execution.schema.ts:689–691`，`frozenContextBuildRequestV11.answeredInformationRefs`。

Spec 003 §2 声明 `answeredInformationRefs: TypedReference[]`；§24.1 明确新增 build @1.1 的“请求不变”，§24.7 继续引用完整 `ContextBuildRequest` 并把 Handler 支持集指向 §24.5。当前 Schema 却将此字段定义为仅接受 Project 下的 `CONTENT_ADDRESSED/execution.information_request_resolution`，并增加 `minItems: 1` 和 `uniqueItems: true`。因此，公开契约允许的空数组、重复引用及其它合法 TypedReference 被提前作为 Schema 错误拒绝。有限恢复 profile 恰一个 Resolution 的业务规则不能替代公开请求类型。

这是新增版本与其已批准命名契约的偏差；不声称旧 @1.0 的该字段已经被修改。建议复用契约声明的普通 TypedReference 数组，在 `handleBuildFrozenRecoveryContext` 保留单一、精确 Resolution 的业务校验；同步生成类型及 fixture。若要改变公开请求契约，须先明确获得对应设计变更，不能由实现自行推导。

### 字段对账

| ContextBuildRequest 字段 | 必填性 | 本轮核对 |
|---|---|---|
| workOrderRef | 必填 | Schema 存在；新 canonical WorkOrder 绑定 |
| workOrderContractRef | 必填 | Schema 存在；CONTENT_ADDRESSED Contract |
| projectionType | 必填 | Schema 存在；当前实现使用 Core projectionType |
| purpose | 必填 | NamespaceCode |
| audience | 必填 | 当前实现采用 Project OBJECT principal；本轮不另行裁定历史 PrincipalRef 文字与已发布 TypedReference 的关系 |
| sourceSlices | 必填 | 非空、去重集合，与 NonEmptySet 基数相符 |
| answeredInformationRefs | 必填 | **不符：普通数组被收窄为非空、去重、单一引用类型集合** |
| builderPolicyRef | 必填 | VERSIONED Policy |
| expiresAt | 可选 | UtcInstant |

新增 build result 为 closed `{contextSnapshotRef}`；Task reconcile result 为 closed `{taskRef,status}`；Task state 的八个必填字段与可选 completionEvaluationRef、WorkOrder state 的九个必填字段与可选 activeRunRef 均已与 §24.7 对照。上述字段核对不代替 Handler、授权或 PostgreSQL 验收。

### 聚焦复现

通过公开 `ContractRegistry.validateOperation`，以仓库 `build-context-v1-1-valid.json` 为基线，仅改变 answeredInformationRefs。每个版本先建立合法正例；旧 @1.0 的 projectionType 使用其既有 NamespaceCode 合法值，以免该无关字段污染反例。

| 输入 | @1.0 | @1.1 |
|---|---|---|
| 原始单 Resolution 数组 | valid | valid |
| 空数组 | valid | invalid，仅 answeredInformationRefs/minItems |
| 两个完全相同的合法 Resolution Ref | valid | invalid，仅 answeredInformationRefs/uniqueItems |

命令退出 0；输出明确显示新版本分别在该字段触发 minItems 和 uniqueItems。源码同样直接包含 `{ nonEmpty: true, unique: true }`。这是公开 validator 的 focused counterexample，不是完整配置目标或数据库运行证据。

## 验证证据及剩余门禁

- Reviewer 读回当前 PR head 与本地 `vibe repo --json` 一致；发布前再次核对 SHA 未变。
- [CI run 36434043241](https://github.com/qzhike/zhiju-business-core/actions/runs/36434043241)：select FAILURE、checks/persistence SKIPPED、verify FAILURE。select annotation 明确说明账户付款失败或 spending limit 需要提高，任务没有启动。这是外部 CI 阻塞，不是代码测试失败。
- PR body 报告该 SHA 的本地 `vibe verify full --json` PASS（1553 普通测试、535 PostgreSQL 测试）。本轮未独立运行 full、environment 或 PostgreSQL，不把 Implementer 摘要当作 Reviewer 已执行证据。因已确认语义阻断，本轮不为尝试批准而追加昂贵全量验证；修正后仍需当前 revision 的完整可信验证及独立复审。
- 适用的人类技术审查仍待完成；设计批准不代替最终实现批准。真实 Provider、CLI、Feishu、公开 HTTP、部署、生产和独立人工业务验收仍 NOT RUN；#224 的既有分层证据及 Grant PolicySnapshot 生命周期延后边界保持原含义。
- 审查记录为本轮新增本地文档，不属于被审 SHA；尚未 commit/push。本轮只获授权发布 PR comment，未提交正式 GitHub APPROVE/REQUEST_CHANGES review，未合并。

## 第二轮复审（2026-09-29）

- Reviewed SHA：`237d52fedb5852ee24e658383e95fcfdf79591ae`；base 仍为 `84d1bd4d92ddb5aa7c337960d380a03fb511fbd5`。
- Role outcome：**REQUEST_CHANGES**。
- 上轮 R1：**CLOSED**。Schema 已恢复 `array(typedReference)`；生成类型、独立正反 fixtures 与 owning Handler 拒绝用例同步。Reviewer 执行 `node node_modules/vitest/vitest.mjs run contracts/src/blocked-input-recovery.fixture.test.ts contracts/src/operations/task-execution.schema.test.ts`，2 文件、82 测试 PASS。新 PostgreSQL 用例代码先断言 Schema 接受，再断言业务拒绝且无 Snapshot/成功 Receipt；本轮未独立执行其数据库层。

### R2 — P1：逐项检查 Human Grant 的 action 与 target，不能只按 capability code 判断覆盖

位置：`modules/identity-policy/src/commands/recovery-human-eligibility.ts:117–122`。

当前代码先以 `requiredCapabilities.some(...)` 筛出满足任意一项完整 binding 的 Grant，随后以 `requiredCapabilities.every(binding => grants.some(g => g.capability_code === binding.capabilityCode))` 判断所有权限齐全。第二步丢失了该项要求的 action 和 targetObjectType。

具体触发条件：受信配置的 `humanCapabilityCodes.answerSubmit` 与 `requestResolve` 使用同一个 capability code C；当前 Human 有 C 的 `execution.information_request.answer.submit.v1` Grant，却没有 C 的 `execution.information_request.resolve.v1` Grant（或该 Grant 已被撤销）。答复 Grant 通过第一步后，第二步仅凭 C 相同就同时满足两项，Port 错误返回 `USABLE`。组成配置未要求这两个 code 互异；capability code 相同不表示其 Grant 拥有相同 actions。

影响：Spec 001 §15.14 明确要求当前答复、采纳、来源读取权限各自有效；Spec 003 §24.4–24.5 要求历史确认有效性与当前 Human 恢复资格分开。`createRecoveryDependencyPorts.readHuman` 在后续 Service 消费中调用该 Port，`readRecoveryResolution`/FROZEN eligibility 使用其证明。已有合法历史确认/Resolution 后，采纳 Grant 的当前撤销可能被仍存的答复 Grant 掩盖，使恢复资格检查放行。Human 自己调用 resolve 时的主动作授权并不能替代后续 Service 消费时对 Human 当前资格的重验。这里不声称所有配置均受影响，也不声称已复现整个 Run-2 数据库链。

建议：对每个 required binding 独立寻找同时满足 capability code、action、target selector 及其余限制的当前 Grant；不要用已通过“任意一项”的集合再仅按 code 检查“每一项”。补充同 code 多 action 的正例、缺失/撤销其中一个 action 的负例及不同 target selector 负例，并在 owning 恢复链验证当前权限撤销阻止新 Context/Bundle/Run。

### R2 聚焦证据

Reviewer 临时诊断直接调用实际 `readRecoveryHumanEligibility` 函数；mock 事务、Repository 返回和 Policy 完整性函数，以隔离此次 Grant 匹配逻辑。自身读取授权、Scope、Human/Role、有效期与 Policy hash 均保持一致；未执行真实 PostgreSQL/RLS 或历史确认证明。

| 对照 | 当前 Grant | 所需权限 | 实际结果 |
|---|---|---|---|
| 正例 | C 同时包含 answer.submit 与 resolve 两个实际 action | 同 code C 的两项 binding | USABLE |
| 负对照 | 只有 answer.submit | 不同 code 的 answer.submit 与 resolve | AUTHORIZATION_DECISION_INVALID |
| 反例 | 只有 answer.submit | 同 code C 的 answer.submit 与 resolve | **错误地 USABLE** |

命令 `node node_modules/vitest/vitest.mjs run tests/business/review-232-human-eligibility.test.ts`：1 文件、3 个行为断言 PASS，exit 0；第三个断言确认缺陷现状，不表示安全要求通过。诊断文件执行后已删除，产品代码未修改。其余已有 current-Grant 用例使用不同 code 时不能证明此反例已覆盖。

### 当前验证与交付边界

- 最新 [CI run 36442717547](https://github.com/qzhike/zhiju-business-core/actions/runs/36442717547) 的 select annotation 已由 Reviewer 读回：账户付款或 spending limit 阻止任务启动；select/verify FAILURE，checks/persistence SKIPPED。远端 gate 仍不完整，不将其解释为测试失败。
- PR body 报告该 SHA 的本地 full PASS（1563 普通测试、535 PostgreSQL 测试）；本轮独立证据为上述 82 项契约测试和 3 项隔离诊断，不冒充 full。确认 R2 后结束本轮取证；修复后须新 head 的完整可信验证和独立复审。
- 人类技术审查、真实外部系统及独立人工验收仍未完成；上轮所述 NOT RUN 与 #224 延后边界保留。
- 正式记录仅在本地追加；没有 commit、push、修复产品代码或 merge。用户授权发布本轮 PR comment，该 comment 不等于 GitHub 正式 review。

## 第三轮复审（2026-09-29）

- Reviewed SHA：`6724a2b34bd6e87f698f2074776902c6b6cb8f78`；base：`84d1bd4d92ddb5aa7c337960d380a03fb511fbd5`。
- Role outcome：**REQUEST_CHANGES**。R1、R2 均关闭；最新修复差异未发现新增代码阻塞项，但本轮完整验证未成功收束，远端检查也未执行，尚不能批准。
- 本轮范围：相对第二轮的 5 文件修复差异、Spec 001 §15.14、实际 Human eligibility 实现、下游 Resolution/FROZEN 消费及新增 owning PostgreSQL 用例；复用前两轮已读取的 Issue/契约上下文。最新 Issue 无新增评论。

### R2 修复复核：CLOSED

`coversBinding` 同时比较 capability code、action、TARGET_TYPE/objectType、maxUses 和 constraints；候选筛选与每项必需权限覆盖检查均调用该完整谓词。Project Scope、有效 Grant/Role 查询、Policy hash/有效期、自身读取授权及历史确认校验继续保留。同 code 可以合法覆盖多个动作，但不再仅凭 code 相同覆盖缺失 action 或 target。

新增 PostgreSQL 用例通过 owning grant/revoke 入口建立同 code 多 action 正例，并覆盖缺 action、错误 target、CREATE selector、撤销后只恢复 answer 权限的负例。正常组成使用共享 answer/resolve code；已有 Resolution/Context/Bundle 后撤销并仅恢复 answer 权限，分别断言新 Context、Bundle、Run 拒绝且没有新事实/成功 Receipt，恢复完整权限后继续正链。已核对这些用例代码，不把本轮未完整收束的数据库执行标为 PASS。R1 的普通 TypedReference 数组修复保持。

### V1：当前完整验证证据尚未闭合

Reviewer 独立执行了项目配置目标，未修改验证配置或使用测试过滤：

1. 只读 preflight 最初在沙箱内无法访问 Docker socket；获准提升执行权限后同一只读检查 PASS。沿用当前 Docker context 的 socket，仅对本次命令设置 DOCKER_HOST，使用项目固定 pnpm 11.19.0，没有更改全局 Docker 配置。
2. `vibe verify environment --json`：PASS，PostgreSQL 18.6 / Flyway 11.20.3 的固定 tag/digest 匹配。
3. `vibe verify full --json`：普通 Vitest 79/79 文件、1563/1563 测试 PASS；格式、lint、TypeScript、architecture（10 roots）、generated API/types、Catalog/Registry（230）、compatibility（200 baseline）通过。
4. PostgreSQL 阶段启动并执行真实迁移与测试，但约 33 分钟总运行时间仍未退出。参考项目 CI 30 分钟边界，Reviewer **主动向本次 Vitest runner 发送 SIGTERM**；不是配置目标自动触发 timeout，也不是已证明某个业务断言失败。日志记录 persistence tests elapsedMs=1932631、Vitest exit 143，最终 Vibe `status=VERIFY_FAIL` / 内层 exit_code=1（工具进程 exit 21）。因此完整 full 与数据库全套验收不能记为 PASS。
5. gate 的 finally 完成 container cleanup，并报告 postgres container removed。运行期间只读诊断未见采样时刻的数据库阻塞 PID；这不能证明运行无其他问题，也不构成完整验证。

[当前 SHA 的 CI run 36519518902](https://github.com/qzhike/zhiju-business-core/actions/runs/36519518902) 的 select annotation 已独立读回：账户付款失败或 spending limit 限制使任务未启动；select/verify FAILURE，checks/persistence SKIPPED。该外部限制与本地人工中止分别记录。PR body 中该 SHA 的 full PASS 是 Implementer 报告，本轮无法据此替换独立执行的未完成结果。

需补齐：提供绑定当前或修复后 head、可核查且成功结束的完整 full 输出；若持久化套件持续无法在预算内收束，应定位耗时/等待并修正，不能通过删减必需验收或过滤测试获得通过。恢复账户额度后完成远端必需检查；随后进行新 head 复审及适用的人类技术审查。V1 是验证证据阻塞，不新增未经证实的产品代码缺陷。

### 边界与交付

真实 Provider/CLI/Feishu、HTTP、生产/负载、独立人工业务验收及既有 Grant PolicySnapshot lifecycle 延后项保持 NOT RUN。本轮仅追加正式审查记录和发布 PR comment；没有修改产品代码、提交、推送或合并。此记录不是被审 SHA 的组成部分。

## 远端 CI 第二次运行补证（2026-09-29）

**REQUEST_CHANGES**，仍绑定 `6724a2b34bd6e87f698f2074776902c6b6cb8f78`。

用户授权重跑后，[run 36519518902 / attempt 2](https://github.com/qzhike/zhiju-business-core/actions/runs/36519518902/attempts/2) 已实际执行。此前账户付款/额度问题没有阻止这次启动；select、checks SUCCESS。persistence 从 06:02:59 UTC 运行至 06:33:18 UTC，annotation 明确为超过 30m0s 最大执行时间而取消；最终 verify 因 `persistence: expected success` 失败。

### 超时前已有五项测试失败

Reviewer 下载并检查了 [persistence job 109278484497](https://github.com/qzhike/zhiju-business-core/actions/runs/36519518902/job/109278484497) 的完整可用日志。在取消前，`tests/persistence/initial-context.test.ts` 的 reporter 已记录以下五项 `state=failed`：

| 用例 | reporter duration |
|---|---|
| TE-REC-D-005/007/010 / SECOND_WRONG_SESSION | 141354 ms |
| TE-REC-D-005/007/010 / SECOND_EXPIRY_RACE | 25786 ms |
| TE-REC-D-009 / Run-2 BLOCKED_INPUT final 拒绝 | 31942 ms |
| TE-REC-D-009 / Run-2 PARTIAL final 拒绝 | 23151 ms |
| TE-REC-D-009 / Run-2 FAILED_EXECUTION final 拒绝 | 24153 ms |

这五项失败在 06:22–06:25 UTC 已记录，早于 06:33 UTC 的超时取消，不能归因于随后取消所导致的未执行；单纯增加 timeout 不能解决已有失败。另一方面，TE-REC-D-001 正常两 Run 恢复用例明确 PASS（125201 ms），该用例包含 R1/R2 增补的断言，因而 R1/R2 保持关闭；不能把这一个正链 PASS 推广为恢复矩阵全部 PASS。

可用日志未包含这五项的 AssertionError/错误堆栈或最终失败汇总。现有 progress reporter 只即时输出 state/duration；工作流在该文件尚未结束时取消。取消前最后进入 `recovers each committed final step after Process restart` 的准备/Validation 阶段；期间 deadline/row-lock 场景仍有正常推进与结束，不能仅凭最后一条 heartbeat 推断死锁。当前证据可以证明失败用例与总时限超标，尚不能确定每项失败的实现根因。

后续应由 Implementer 先聚焦复现这五项并取得实际异常和堆栈，修复业务实现或测试时序问题，再定位完整套件的累计耗时并保留必需验收。必须重新取得成功的完整门禁；不以无变化重跑、放宽断言、跳过测试或仅延长超时替代修复。本补证取代“远端仅因账户限制未执行”的当前状态描述，历史运行记录保留。本轮未修改产品代码或 CI 配置。

## 第四轮复审（2026-09-29）

HUMAN_REVIEW_REQUIRED

复审对象：`dc5f8dca35188595906905343925d9b346ddfdba`；base：`84d1bd4d92ddb5aa7c337960d380a03fb511fbd5`。

本轮未发现新增阻塞性代码问题。R1（公开数组契约）和 R2（逐项完整 Grant binding 校验）保持 CLOSED；V1（完整验证未收束）及上轮远端五项失败现已 CLOSED。结论绑定上述 revision；适用的人类技术审查仍待完成，不是正式 GitHub APPROVE，也不授权合并。

复核了相对 `6724a2b` 的三个文件差异和关键测试上下文：

- 公共逐 consumer 缺权、Receipt 回滚、13 步提交后进度丢失、双 Worker 重放、并发创建、历史证明及 SQL/RLS 反例集中在 NORMAL 正链执行。其他变体仍独立通过真实 owning 入口建立自己的事实链，并保留各自拒绝/停止边界与无额外 Run/Result/Receipt 断言。未发现必需公共断言被整体删除。
- `SECOND_*` 使用累计 30 秒 WorkOrder 预算，Run-2 reservation/deadline 从真实 Run-1 消费后的余量计算；Context 仍为 60 秒，真实期限检查与到期等待保留。错误 session、finalize/expiry 竞争及三个不支持 outcome 的拒绝仍有独立断言。
- BUDGET_EXHAUSTED 的等待移到真实 Acceptance 对应 Result 读取后，不改查询返回值或数据库时钟；新增断言证明实际消费/预留/总预算均为 30 秒，终结时间仍早于 Run deadline。
- reporter 现在在失败用例结束时输出异常堆栈；Module-Test 同步解释矩阵组织与时间边界。产品实现、CI timeout 和全套测试选择未在本轮差异中修改。

独立下载核查了 [CI run 36545268180](https://github.com/qzhike/zhiju-business-core/actions/runs/36545268180) 的完整日志与运行元数据。该 run 的 headSha 为上述 SHA；实际 checkout 是 GitHub 为该 head 与上述 base 生成的 PR merge revision `a5a8902`，不是声称直接 checkout head。select 选择 `full`，checks/persistence/verify 均 SUCCESS；配置中的代码与持久化门禁覆盖完整：

| 证据 | 结果 |
|---|---|
| checks：格式、lint、TypeScript、architecture、生成物与契约兼容性 | PASS |
| 普通测试 | 79 文件，1563/1563 PASS |
| PostgreSQL 全套 | 43 文件，535/535 PASS；未见测试失败或跳过 |
| TE-REC 恢复矩阵 | 14/14 PASS，含 NORMAL 和预算耗尽 |
| PostgreSQL cleanup | container removed |
| 最终 verify 汇总 | PASS，failures=[] |

上轮五项失败的本次 reporter 结果：SECOND_WRONG_SESSION **PASS / 50154 ms**；SECOND_EXPIRY_RACE **PASS / 51578 ms**；Run-2 BLOCKED_INPUT **PASS / 52120 ms**；PARTIAL **PASS / 54872 ms**；FAILED_EXECUTION **PASS / 54986 ms**。完整 [persistence job](https://github.com/qzhike/zhiju-business-core/actions/runs/36545268180/job/109330096363) 成功结束，Vitest duration 1676.48 秒，job 29 分 01 秒。本轮复用当前可信 CI，没有重复本地 full，也不把 Implementer 的本地日志摘要记作 Reviewer 自行执行。

非阻塞风险：持久化 job 距现有 30 分钟上限仅约 59 秒；本次 PASS 证明该次完整执行成功，不能据此保证不同 runner 负载下无超时波动。后续若优化耗时，应继续保留必需验收和真实时间边界。

剩余门禁来自 `vibe-development/SKILL.md` 的 “high-risk work requires human technical review” 及 Reviewer 的 “HUMAN_REVIEW_REQUIRED … when human technical judgment or authority is the remaining gate”。本 PR 的 T2 授权、恢复、持久化变更仍需绑定最终 revision 的人类技术审查；既有设计批准不替代它。PR 仍为 Draft。真实 Provider/CLI/Feishu、公开 HTTP、生产/负载、独立人工业务验收及既有延后项仍保持原 NOT RUN/延后边界。

正式审查记录已追加至本地 `.vibe/reviews/pr-232/Review.md`，尚未 commit/push，不属于被审 SHA。本轮没有修改产品代码或合并 PR。

## 最终 revision 人类技术审查批准（2026-09-29）

APPROVE

Reviewed / approved SHA: `dc5f8dca35188595906905343925d9b346ddfdba`.

用户在第四轮复审结论后明确回复“批准”，据此记录对该 revision 的人类技术审查批准，关闭此前 HUMAN_REVIEW_REQUIRED 门禁。发布前已重新读取远端：PR head 未变，select、checks、persistence、verify 均为 SUCCESS。结合第四轮独立审查无新增阻塞项、R1/R2/V1 已关闭，Reviewer outcome 更新为 APPROVE。

[第四轮复审与完整证据](https://github.com/qzhike/zhiju-business-core/pull/232#issuecomment-5888129002)继续适用；持久化 job 的时间余量风险及 External/Manual 的 NOT RUN 边界保持原记录。本批准不将未执行验收提升为 PASS。

此 comment 记录会话中的明确人类批准，不等于通过 GitHub review API 提交正式 APPROVED review。PR 仍为 Draft；本次未授权或执行 merge、commit、push。正式审查记录已在本地 `.vibe/reviews/pr-232/Review.md` 追加，尚待获授权后提交和推送。
