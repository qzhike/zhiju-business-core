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
