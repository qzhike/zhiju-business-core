# PR #255 独立设计审查

## 审查对象与结论

- Issue：[#253](https://github.com/qzhike/zhiju-business-core/issues/253)，`T2 / design-contract closure only`。
- PR：[#255](https://github.com/qzhike/zhiju-business-core/pull/255)，Draft。
- Reviewed SHA：`4616482822ea4899a37366eb0d48e030b4a5ee76`。
- Base SHA：`b66beb0afcf3e71143c348348fcc41cfc7819cbb`。
- 独立审查日期：2026-10-09。
- Reviewer outcome：`REQUEST_CHANGES`。
- Human 技术批准：`PENDING / NOT PROVIDED`。本记录不批准设计冻结、Runtime/规则选择、依赖实现 READY、合并或部署。

本次由独立 Reviewer 从最新 Issue、当前 owning authority、精确 head 差异和 revision-bound 验证证据推导验收条件；未修复提案或实现。共审查 26 份 `.vibe/` Markdown，未发现运行实现、Schema/Registry 注册、SQL/migration 或无关业务模块改动。审查记录本身不属于上述 reviewed SHA。

## 阻塞发现

### R1：已启动但首次范围尚未接收时，缺少新范围意图与可信 Human 范围决定的产生路径

定位：[Delta §5](../../decisions/d14-rd01-first-customer-flow.md#5-转换原意图与恢复)，reviewed SHA 的第 89、92、95、97、99 行；[EP 操作及启动](../../module-specs/Module-Spec-002-EnterpriseProject.md#ep-操作输入和结果)，第 954–967 行；[TE 新公开入口及接受集](../../module-specs/Module-Spec-003-TaskExecution.md#新公开入口字段)，第 2459、2463、2472 行。

直接反例：原 Human 请求已完成信息确认和唯一 PROJECT_START，项目为 ACTIVE；首次 `receive_initial_work_scope` 因所选一份文件新增阻塞而未提交。Delta 要求保留 ACTIVE 和冻结 start，并允许 Human 重新选择独立合法文件形成新意图；若输入已经变化，要求绑定当前新报告。原 `resume_startup_request` 同时明确禁止改变文件集合、报告或 binding。

现有 EP 只定义信息确认→前置版本→一次 PREPARING start→scope 的 startup request，没有为 ACTIVE、首次 scope 尚未接收的边界定义独立 Human scope intent/decision producer。TE `receive_initial_work_scope` 又要求 `startupRequestRef` 与 `humanScopeDecisionRef`，但 EP 未定义新集合对应的 scope decision 的产生操作、精确类型、绑定和回执。需要重新分析补充资料时，TE preparation Port/create 仅允许 PREPARING，也无法产生该恢复所需的当前新报告。因此原意图不能改、项目不能重 start、合法新范围意图又没有可执行的 owning 路径；这违反 Issue 的 initial scope-request continuation、STALE/PARTIAL 恢复和独立 eligible 文件可接收验收要求。

修复要求：在 owning EP 定义有界的 ACTIVE 且首次 scope 尚未接收的新 Human 范围意图、可信决定及权威回读/原键恢复，连接 TE 的首次范围接收。绑定既有精确 PROJECT_START、当前 report/plan/source/version/hash 和完整文件选择，保留旧请求成功事实，不重复信息版本激活或 start；补充资料后的新分析必须有同样边界的 EP eligibility 和 TE preparation profile 支持。同步 IP、Catalog/Core/Domain/一致性/持久化提案及必要失败场景，并保持后续生成和首次 scope 接收后的流程为后续合同。可以采用不同具体操作名，但不能由 BFF 生成决定或放宽旧 Task/Context 接受集。

必要反例应包含：start 已提交后原 scope 阻塞，改选合法独立文件；首次 scope 前输入变更导致旧 request STALE，经新报告和新决定接收；新范围响应丢失按原 key 返回同一 scope；首次 scope 已接收、跨 Project、伪造决定、撤权、旧 start 被替换或旧集合被改时拒绝。上述为未来验收 trace，不是已执行 PASS。

## 已核对且无独立阻塞发现的边界

| 验收边界 | 设计核对结果 |
|---|---|
| Owner 与 scope | EP 拥有准备身份、来源及报告业务快照/启动；TE 拥有 Context/Run/Result/范围；IG 拥有 intake/Runtime 原观察；IP 当前授权；UI/BFF 仅组合公开能力；Quality Evidence 复用既有 Owner。R1 之外无新增所有权冲突。 |
| 原始 bytes 与引用 | ZIP/条目/JSON/Markdown/manifest bytes SHA 与 cv1 snapshot hash 分域，保留来源身份、alias map、原 invocation 与真正 Result Acceptance；不凭同 hash 合并来源。 |
| 准备执行链 | 新 PreparationContext、WorkOrderContract/Package 显式版本/profile，逐层列出 readiness/freeze/run/dispatch/final 接受集；不填占位启动快照，不偷偷扩大旧 producer。R1 的阶段资格仍需修复。 |
| Human 与必要启动事实 | TEXT/结构化不支持边界、完整 Product、QMS 三组必需条目、Quality Evidence 生产与当前授权显式；未知/冲突阻必要 start，报告/READ/模板不代替客户事实或批准。 |
| ZIP 与 Host | 有界流式提取、DOCX 二级预算、安全失败零 dispatch、逐 entry 不支持/损坏/读限、只读公司输入和独立报告根；Browser/BFF 无解包、CLI/path、模型或 storage 写权限。 |
| 兼容与迁移 | 旧 create_project、ACTIVE Task、ProjectContext@1.0、historical schemas/bytes 保留；forward migration 验证旧 binding，不把损坏旧 ACTIVE 当 PREPARING。 |
| Runtime/公司规则门禁 | Claude Code 仅候选；精确 CLI/model/prompt/Skill/MCP/template/rule/output lock、IM-DG-006 和真实 conformance 显式待人类批准；不推导默认或 fallback。 |

## 验证证据与未运行边界

- 最新 Issue 与 PR head、base、实际 diff 已独立读回；`vibe repo --json` 返回上述 repository/root/branch/head。
- 配置目标：严格 `.vibe/` Markdown 使用 `docs`。复用该 head 的 `vibe verify docs --json` 本地 PASS（exit 0；26 文件）；44 个新链接/锚点检查为补充静态证据。
- 独立读回 [CI run 37884070891](https://github.com/qzhike/zhiju-business-core/actions/runs/37884070891)：headSha 为 reviewed SHA，`checks` job `SUCCESS`，`Verify documentation` step `SUCCESS`；`persistence` 为 `SKIPPED`。未将尚未读回的总聚合状态推定为 PASS。
- 独立 `git diff --check`：PASS。
- 已核对 EP/IP/TE/IG/UI/Runtime owning 正链、错误/撤权/并发/UNKNOWN/PARTIAL/late/兼容场景。场景设计存在不等于场景执行成功。
- 真实 PostgreSQL、OIDC/public HTTP、Host/Runner conformance、Browser 支持矩阵与独立人工业务验收：`NOT RUN`。

R1 修复后必须独立审查新精确 head；本结论不覆盖未来修订。明确人类技术批准和公司 Runtime/规则锁定选择仍待完成，#253 不应因文档或 agent 审查结果自动关闭。GitHub 审查发布由主 Implementer 按已授权范围处理，本 Reviewer 未发布消息、commit 或 push。

## 新修订独立复审：5a231858

- Reviewed SHA：`5a2318585b30ee08ae6e4fc862ba56a392546e8a`。
- Base SHA：`b66beb0afcf3e71143c348348fcc41cfc7819cbb`。
- 前次 reviewed SHA：`4616482822ea4899a37366eb0d48e030b4a5ee76`；上述 R1 及 `REQUEST_CHANGES` 保留为该历史修订结论。
- 复审日期：2026-10-09。
- 独立 agent 设计语义审查：`PASS / NO BLOCKING DEFECT FOUND`；R1：`RESOLVED AT REVIEWED SHA`。
- Reviewer role outcome：`HUMAN_REVIEW_REQUIRED`。
- Human 技术批准与 Runtime/规则锁定决定：`PENDING / NOT PROVIDED`。

最新 Issue 的设计 scope/acceptance 未变；已重新读回 Issue/PR、`vibe repo --json`、新旧修订实际差异及受影响 owning 合同。此时整体差异仍仅包含 27 份 `.vibe/` Markdown，包括本正式记录；没有实现/注册/migration。本节新增记录本身尚不属于本次 reviewed SHA。

### R1 反例的独立复核

| 原反例 / 必要边界 | 新修订中可解析的 owning 路径与结论 |
|---|---|
| start 已提交、原集合某文件阻塞，新选独立合法子集 | [EP ACTIVE 首轮恢复](../../module-specs/Module-Spec-002-EnterpriseProject.md#active-首轮范围重核对与精确-human-scope-决定) 新 `request_initial_scope_confirmation` 仅接受 PREPARATION 模式 ACTIVE 且首次范围尚未接收；记录新 intent 和独立 `initial_work_scope_decision`，绑定原 start/当前 report/plan/整文件集合。旧 request/info/start 不改；路径闭合。 |
| 新范围决定的真实 producer 与 start 引用 | 初次 startup 同事务独立产生 information 与 scope 两份决定；`START_FROM_SAME_REQUEST` 不提前引用未来 start，由真实不可变 request→start 事实验证。ACTIVE 恢复用 `EXISTING_FROZEN_START` 和真实精确 binding，不再激活信息或 start；消除了不存在/自洽伪造引用。 |
| start 后、首次范围前补料令旧 report stale | EP/TE source、PreparationContext/Package 增加 `INITIAL_SCOPE_RECOVERY`，仅该 ACTIVE/PREPARATION 窗口读取冻结 start 并做新分析；旧 Task/Context 接受集不扩展。必要 start 依据失效须 impact review 阻接收，不能以新候选改冻结绑定。 |
| 新范围写响应丢失 / PARTIAL / UNKNOWN / STALE | 新 EP get/resume 从原保存 intent/key 读取，不能换 report/文件；当前权限独立校验。TE 原 request/hash duplicate 返回同一真实 scope/Receipt，不重复 scope、启动或派发；旧成功事实保留。 |
| 新旧 intent 同时竞争 / 初轮资格查询后变化 | [TE 唯一首次接收](../../module-specs/Module-Spec-003-TaskExecution.md#active-首轮恢复接受集与唯一接收事实) 定义 AUTHORITATIVE state Query 及最终 `(enterprise_id,project_id,purpose=INITIAL)` 唯一事务约束；Query 不保留资格，不同 intent 一 winner，输家不能把自身决定当成功。 |
| 首轮已收到、旧 FULL_START、跨 Scope、伪决定、撤权、晚输出 | 窗口及 creationMode 明确拒绝，Human decision/Actor/current authorization 与 request→start 链精确验证；已关闭窗口输出只保留 observation/history，不覆盖可操作 current report，不授予后续批次或文件修改资格。 |

IP、UI、Core Context、Domain、跨 Aggregate 一致性、Catalog、PostgreSQL 逻辑约束和 Runtime proposal 均与新增有界恢复分支对齐；EP-D14-010、TE-D14-008、IP-D14-006、IG-D14-007、UI-RD01-007、RA-D14-007 增加相应未来正负/竞态 trace，原 UNKNOWN、同键异 payload、跨 Project、撤权和 response-loss trace 继续适用。此次未发现新的阻塞语义缺陷，也未将实现策略偏好或后续能力作为 blocker。

### 新修订验证及剩余门禁

- 复用该实际工作集的 configured `vibe verify docs --json`：PASS（exit 0；27 Markdown 文件）。109 个链接/锚点检查为补充静态证据；不替代设计语义审查。
- 独立新 head `git diff --check`：PASS。
- 独立读回 [CI run 37884529676](https://github.com/qzhike/zhiju-business-core/actions/runs/37884529676)：headSha 为本次 reviewed SHA；此次读回时 `select` SUCCESS、`checks` / `Verify documentation` IN_PROGRESS、`persistence` SKIPPED。未把未完成 CI 当 PASS；上述本地 configured docs 证据满足此设计修订要求。
- 真实 PostgreSQL/full、OIDC/public HTTP、Host/Runner conformance、Browser 支持矩阵与独立人工业务验收仍全部 `NOT RUN`。

Issue #253 明确要求独立审查和精确修订 Human 技术批准后才冻结或使依赖实现 READY；公司 Runtime/model/模板/强制 rule bundle 等锁定选择仍需 Human 决定。Reviewer 角色不在尚有必需 Human 技术审查门禁时输出 `APPROVE`，因此本次角色结论为 `HUMAN_REVIEW_REQUIRED`，不是新的提案修复请求。可继续提交和展示 Draft 供 Human 审阅；此记录不批准冻结、开工、合并或部署。主 Implementer 纳入记录后的新 commit 若只增加审查交付文本，需要保留 reviewed SHA 与证明其提案内容未变，并完成适用 docs 检查。Reviewer 未修改提案、commit、push 或发布 GitHub 消息。
