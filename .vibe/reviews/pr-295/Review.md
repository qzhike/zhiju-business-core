# PR #295 独立审查

当前结果：`APPROVE`（2026-10-14 合并前独立复审；Reviewed SHA：`d7576c516228aaab04e0d288679d74126c6498cb`；本地 full PASS，远端 CI 待确认；R1、R2 均关闭）。下方历史审查保留，当前结论仅绑定此精确版本。

## 初次审查历史

初次结果：`REQUEST_CHANGES`

- 工作项：[Issue #285](https://github.com/qzhike/zhiju-business-core/issues/285)
- PR：[Draft PR #295](https://github.com/qzhike/zhiju-business-core/pull/295)
- Reviewed SHA：`56a74b99dcbf0f1248b4099f9fb4d2ea34e895fc`
- Base SHA：`7a7f41d51bb0fa33d9da07be3468d30b6e58ffa1`
- 审查日期：2026-10-14
- 角色：独立 Reviewer；未修改产品实现，未提交、推送或发表 GitHub 评论。

## 验收预期与范围

先从最新 Issue（无评论）、UI01 Spec/Test、已批准交互与工程基线建立预期，再阅读实现差异。确认范围是唯一文件分母；等待、实际处理中、待检查、失败及待核验由显式输入提供，不能从经过时间制造候选。候选必须绑定项目、请求、文件与精确版本。重试需要许可与可用动作，一次点击冻结一个原意图；UNKNOWN 和错回执不能重复提交。轮次导航和后台到达保留查询、筛选、展开、阅读版本与意见。生产缺少注册能力应明确不可用，开发 adapter 不进入生产制品。

差异限于 `apps/workspace-web`、相关测试、UI01 Spec/Test 与应用 README。未见新业务端点、策略、迁移、持久化或 Runner 语义扩张。正式进度/重试接入仍归 owning 后续工作。

## 阻塞发现

### R1：检查候选覆盖原工作台返回位置，嵌套返回丢失工作台上下文

位置：`apps/workspace-web/src/execution/Page.tsx:258`，相关降级位置为同文件第 79 行。

工作台 `WorkLink` 在 `workbench/navigation.tsx:64` 保存包含查询参数的原工作台地址；`Workbench.tsx:38` 以该完整地址保存搜索、分组、滚动和焦点上下文。执行页打开候选时却将同一个 `memory.returnTo` 改为 `roundPath(round)`。检查页返回执行后，执行页 `BackLink` 发现该字段不再是工作台路径，便返回裸 `/workbench`。

直接反例：从 `/workbench?enterprise=DEMO-ENTERPRISE-01&project=DEMO-PROJECT-01` 的文件进度卡片进入第 1 轮，打开 `DEMO-REV-01`，点击“返回本轮文件进度”，再点击“返回工作台”。最终目标为 `/workbench`，而非原带项目查询的工作台；原 URL 对应的项目范围、搜索/分组、滚动与焦点无法按原键恢复。该链路违反 UI-BOARD-002 的返回上下文要求，也影响 #285 的安全返回验收。

应将候选到轮次的返回位置与轮次到工作台的返回位置分别保存，避免共享字段被下层导航覆盖；修复后补充从带项目查询及非默认筛选的工作台开始、经候选嵌套返回的 Browser 反例。现有 execution Browser 用例直接 `goto` 执行地址，只验证候选回到执行，未覆盖原工作台返回链。

本项由精确版本代码路径静态推导确认；本次未新运行浏览器复现，不将其表述为新增 Browser PASS/FAIL。

## 其余审查与证据

已检查确认范围过滤、缺失/重复观察的待核验降级、错项目/请求/文件候选拒绝、旧候选保留、重试的同步原意图锁及错回执 UNKNOWN、原请求读回、逐轮视图内存、后台更新与不可变合成候选快照。生产路由仍位于既有会话保护边界内，开发导入由 fixture 编译条件隔离。未在这些已检查路径发现其他阻塞项。

复用 `/private/tmp/issue-285-code-evidence.txt` 的完整配置验证输出及 PR 的精确实现版本绑定；未重复整个门禁。`vibe repo --json` 与远端 PR 均确认待审 SHA 和上述 base；PR 保持 Draft。配置 `vibe verify code --json` 最终 `PASS`，124 个测试文件 / 2545 个测试，5 个生产 Browser 检查和 31 个开发 Browser 旅程；包含 14 个新增 model/component 断言及 7 个执行相关 Browser 检查。该结果不覆盖 R1 的嵌套工作台返回反例。

`full` 门禁尚未执行，Draft 阶段该非持久化范围要求的是 `code`；转 ready 前仍须适用 `full` 与 environment 前置或允许复用的精确版本 CI。远端 CI 未作为本次完成证据，本 Reviewer 未注册 waiter 或轮询 CI。

真实服务进度、Runner、重试授权、服务器草稿/持久化、跨设备恢复、完整 Windows/macOS Chrome/Edge 矩阵与独立人工业务验收均为 `NOT RUN`。配置门禁通过不能替代上述接入、人验或 R1 的验收失败。

## 交接

将 R1 返回 Implementer 修复，在新精确 head 上执行适用验证并独立复审。本记录已本地保存；GitHub 审查交付由主 agent 按已有授权办理。此结果不授权合并或部署。

## R1 修复复审（2026-10-14）

结果：`APPROVE`

- Reviewed SHA：`ecb22a3f270701788931d110cdfe82a685a254d5`
- 比较版本：初次审查 `56a74b99dcbf0f1248b4099f9fb4d2ea34e895fc` → 本次 reviewed SHA；PR 基线不变。
- R1：`CLOSED`。本次独立检查实际提交差异、完整新增 Browser 反例及最终配置验证输出，未修改产品实现。

`ExecutionNavigation` 现在分别保存 `views` 与按精确候选路径绑定的 `candidateReturns`。打开候选只记录候选到原轮次的返回路径，不再改写 Workbench 的 `returnTo`；检查页读取该精确路径或按候选来源轮次回退。执行到工作台的返回地址和其完整查询参数得以保留。两层内存均继续位于已有身份边界内，未新增 storage、服务权限或业务状态。

新增 `tests/workspace/execution.spec.ts` 的完整嵌套返回旅程使用实际 fixture 项目查询 `/workbench?enterprise=WB-ENTERPRISE-01&project=DEMO-PROJECT-01`，先设搜索“文件”并展开 completed，再由真实工作台卡片进入 `WB-ROUND-01`、打开候选、返回轮次和工作台；断言原 URL、所选项目、搜索、展开与原入口焦点均恢复。初次静态反例使用的 `DEMO-ENTERPRISE-01` 是候选内容的匿名企业标识；实际工作台 fixture 企业标识为 `WB-ENTERPRISE-01`，本次 Browser 反例已按实际入口修正。该标识校正不改变初次导航覆盖缺陷的判断。

首轮固定执行请求改绑已有工作台 `WB-ROUND-01` 入口，相关文档与现有用例同步；其他轮次仍独立。该修改闭合原工作台与共享执行页入口，不扩展公共 contract 或 Runner 范围。实际差异未引入其他阻塞项。

复用 `/private/tmp/issue-285-r1-code-evidence.txt`，`vibe verify code --json` 最终 `PASS`：124 files / 2545 tests，5 个生产 Browser 检查、32 个开发 Browser 旅程。新增嵌套返回旅程在完整配置门禁内通过；Reviewer 未重复门禁。`vibe repo --json` 确认本次 implementation head；由主会话绑定并提供新 head 的最终验证输出。初版 CI 仅作为历史，不用作本次 head 的 CI 证据。

本 `APPROVE` 为 Issue #285 有界非持久化实现的 Draft 阶段独立 agent 审查结果。当前 required target 为 `code`，不将尚未执行的 `full` 作为 Draft 阻塞；转 ready 前必须完成适用 `full` 与 environment 前置或允许复用的精确版本 CI。真实服务、Runner、授权重试、服务器持久化/草稿、跨设备、完整平台矩阵与人工验收仍 `NOT RUN`。远端新 head CI 不在本次证据中；Reviewer 未轮询或注册 waiter。

本记录更新未提交、推送或发表 GitHub 评论。记录交付后的新最终 head 尚须确认仅含 review 文档差异并绑定最终 reviewed SHA；当前结论不得自动改标到未来修订。批准不授权合并或部署。

## 最新 head 独立审查（2026-10-14，用户要求发布 comments）

结果：`REQUEST_CHANGES`

- Reviewed SHA：`47256468ce16cdab15530f7b0e3404c5310074ea`。
- Base SHA：`7a7f41d51bb0fa33d9da07be3468d30b6e58ffa1`；PR 仍为 Draft。
- 从最新 Issue #285（无评论）、UI01 Spec/Test 和批准交互规则建立预期，再检查完整产品差异与验证证据。历史 R1 修复仍成立。
- 本轮未修改产品实现；仅更新正式审查记录。GitHub comment 的发布及读回结果以 PR 为准；本地记录更新未 commit/push。

### R2 / P2：切换轮次后到达的重试回执没有通知当前页面

位置：[execution/Page.tsx 第 137–147 行](https://github.com/qzhike/zhiju-business-core/blob/47256468ce16cdab15530f7b0e3404c5310074ea/apps/workspace-web/src/execution/Page.tsx#L137-L147)。

`requestRetry` 的 Promise 闭包持有发起请求的 `RoundPage` 实例。切换轮次使该实例卸载，`live.current` 变为 false；返回原轮会创建新实例，继续读取同一个 `view.retries` Map。旧 Promise 返回后只修改 Map，并因旧实例不再 live 跳过 render；共享内存没有订阅通知，新实例因此仍显示旧 pending 状态。UNKNOWN 已收到时，“查询原重试请求”入口仍不出现，用户不能按显示的流程继续恢复。

受控 Chromium `156.0.8078.4` 在当前源码的 Vite fixture 服务上实际复现（不是新增 built-browser 或真实服务证据）：

1. 打开 `/projects/DEMO-PROJECT-01/executions/WB-ROUND-01`，展开执行演示控制，带入已确认后轮示例，模拟第二份失败。
2. 将重试回执设为“等待回执”，点击“重新处理本文件”。页面显示 pending，并冻结一个原 intent。
3. 通过“查看轮次”切到 `WB-SCOPE-02`，再回到 `WB-ROUND-01`；此时原 Promise 尚未完成。
4. 点击“返回待核验重试回执”，等待浏览器帧处理结束。页面仍显示“重试请求等待回执”，“查询原重试请求”按钮数量为 0。
5. 在搜索框输入“预防”，触发无关重绘后，同一 intent 才显示“重试结果待核验”及原请求查询按钮。

这违反 #285 重试不确定结果可原位恢复、跨轮次后台到达保持正确上下文的验收，也与 UI01 Spec #285 的原请求查询要求不符。现有 Browser 用例只覆盖未导航时收到回执以及回执已完成后的导航，未覆盖原 Promise 跨卸载/重挂载完成。

修复应让回执更新通知当前订阅该轮的页面，例如将异步回执状态及通知放入身份边界内的 React provider/store；继续保留原 intent、去重锁及身份清理，不能靠重新提交请求恢复界面。补充 pending → 切到后轮 → 回原轮 → 原 Promise 返回 UNKNOWN/ACCEPTED 的回归，要求无需搜索、刷新或再次导航就展示正确状态；UNKNOWN 应立即提供原请求查询，且不产生第二个重试 intent。

### 本轮证据与边界

复查 `/private/tmp/issue-285-r1-code-evidence.txt` 的完整配置输出：`vibe verify code --json` 为 PASS，124 个测试文件 / 2545 个测试、5 个生产 Browser 检查与 32 个开发 Browser 旅程。其实施提交为 `ecb22a3f270701788931d110cdfe82a685a254d5`；检查其到 reviewed SHA 的差异仅为本正式 review 文档，因此复用产品配置验证，不重复整个门禁。该通过证据不覆盖上述新反例。

最新 head 的 Actions API 返回 `total_count: 0`；远端 CI 不作为本轮通过证据，也无 run/attempt 可注册 waiter。`full` 为转 ready 前要求，本轮 Draft/code 范围不因此升级。沙箱 Chromium 曾因 macOS IPC 权限无法启动；通过已有升级机制在宿主完成最小启动探针及匿名 fixture 反例，未将环境错误作为产品失败。

生产隔离、范围分母、精确候选与未知状态降级等已检查路径未发现新增阻塞项；本轮发现已足以要求修复，不代表穷举全部状态组合。真实进度服务、Runner、授权重试、服务器草稿/持久化、跨设备、Windows/macOS 完整 Chrome/Edge 矩阵及独立人工业务验收仍为 `NOT RUN`。

交接：Implementer 修复 R2 并补充上述回归，取得新 head 的适用配置验证及独立复审。R1 保持关闭。本轮不授权合并或部署。


## R2 修复独立复审（2026-10-14）

结果：`APPROVE`

- Reviewed SHA：`c2842aeeb148788f86f2f3263bcc77e8a4d4fdbf`。
- 比较版本：上一 reviewed head `47256468ce16cdab15530f7b0e3404c5310074ea` → 本次 reviewed SHA；PR 仍 Draft。
- 最新 Issue #285 无评论；[R2 comment](https://github.com/qzhike/zhiju-business-core/pull/295#issuecomment-6163917295) 与 UI01 Spec/Test、批准交互和工程基线构成验收依据。`vibe repo --json` 与远端 PR head 均确认该精确版本。
- R2：`CLOSED`；R1 保持关闭。本轮未修改产品、提交、推送或发表 GitHub 评论，仅更新本正式审查文档。

独立预期先于实现检查建立：pending 原请求切到另一轮再回原轮后，其 UNKNOWN/ACCEPTED 回执应直接更新当前显示，不依赖搜索、刷新或再次导航。UNKNOWN 必须立即开放原请求查询；ACCEPTED 仍只表示接收、等待安排。原 intent 与重复提交锁、失败历史、其他文件候选和当前焦点均须保留；身份退役后旧异步闭包不得写入新身份的页面内存。不存在新增业务操作、Runner 或浏览器持久化需求。

实际修复在 `ExecutionNavigation` 的身份边界内保存稳定 Map 与 provider 状态通知函数。提交前同步写入 PENDING，原回执精确匹配或异常/错回执降级 UNKNOWN 后统一通知 provider；provider 给出新的 Context value，使当前 consumer 重绘，而不再调用发起请求但已卸载的 RoundPage 的本地 render。当前轮次重新挂载仍读取原 RoundView，原 intent 与候选返回内存保持原归属。React state setter 与 Map 都属于原 provider；TrustedApp 的 WorkbenchNavigation 由 sessionGeneration/principalId 键控，失权、退出和身份更换卸载该子树。旧闭包最多改变已退役对象，不能填充新 provider 的 Map。本轮对此做静态边界核查，未声称新增真实身份运行旅程。

新增两个 built-browser 旅程覆盖 pending → 后轮 → 原轮 → UNKNOWN/ACCEPTED，双击初次重试并断言只记录一个意图；释放原 Promise 后直接断言结果、原意图、零重复重试入口、原路径与搜索焦点保持。UNKNOWN 随即允许原请求查询，并以同一 intent 读回 ACCEPTED；原失败历史及另一文件精确候选入口继续存在。回执释放按钮只 resolve Promise 和删除 pending Map，不调用 fixture setState；记录意图的 setIntents 在发起请求时执行，因此不会以无关 fixture 重绘掩盖原回执通知缺陷。测试使用程序化 click 保持搜索焦点，无输入、刷新或后续导航促成断言。开发 adapter 的新计数和 ACCEPTED release 仅用于隔离 fixture，生产隔离未改变。

复用实际 `/private/tmp/issue-285-r2-code-evidence.txt` 的完整 `vibe verify code --json` PASS 输出，并由原会话绑定至本次实施 head；工作区审查前干净。输出包含 124 files / 2545 unit/component tests、5 production browser checks、34 development browser journeys，新增 UNKNOWN/ACCEPTED 跨轮回执旅程及既有 R1 嵌套返回旅程均 PASS；format、lint、typecheck、独立 Web/BFF build、architecture 和 contracts 亦通过。未重复配置门禁，未新增独立 browser 运行；本结论来自契约、实际 diff、关键上下文和已执行验证证据的独立核对。

本 APPROVE 仅为当前有界非持久化 Draft/code 阶段的 agent 审查。远端当前 head CI 由原会话取得，不在本轮证据内，本 Reviewer 未查询、轮询或注册 waiter；不将其标为 PASS。`full` 与适用 environment 前置或允许复用的精确版本 CI 仍为转 ready 前要求。真实服务、Runner、授权重试、服务器草稿/持久化、跨设备、完整 Windows/macOS Chrome/Edge 矩阵及独立人工业务验收仍 NOT RUN。

本记录更新尚未提交/推送；记录交付后的最终 head 应另行确认仅含正式 review 文档差异并绑定最终 reviewed SHA，不构造自指 SHA，也不自动把本次结论改标到未知修订。GitHub comment/PR 证据交付由原会话按现有授权办理。批准不授权合并或部署。

## 最新 head 复审与 comment 交付（2026-10-14）

结果：`APPROVE`；Reviewed SHA：`4a3191c26e3e729e6c48e13f3326a9812db2d726`；Base SHA：`7a7f41d51bb0fa33d9da07be3468d30b6e58ffa1`。本轮响应用户“复审 PR 并提交 comments”，重新读取最新 Issue/PR/comments，确认本地与远端 head 一致、开始时工作区干净、PR 仍为 Draft。

基于前次 R2 的原始失败场景、UI01 Spec/Test 和当前实现，独立核对 `4725646 → 4a3191c` 全部增量。Provider 通知解决卸载实例无法刷新当前消费者的问题；提交同步锁、原 intent 匹配、UNKNOWN 降级、原请求回读与身份退役后的内存隔离仍成立。新增 UNKNOWN/ACCEPTED 回归在返回原轮后才释放原 Promise，并直接检查结果、路由、焦点、单一意图、失败历史和旧候选；释放动作不调用 fixture setState，因此不依赖无关重绘。R2 关闭，R1 保持关闭，未发现新增阻塞项。

实际读取 `/private/tmp/issue-285-r2-code-evidence.txt` 完整输出，确认 configured `code` PASS：124 files / 2545 tests、5 个生产 Browser 检查、34 个开发 Browser 旅程，包含新增两个回执反例与既有 R1 回归。PR 将该日志绑定到 `c2842aeeb148788f86f2f3263bcc77e8a4d4fdbf`；独立检查该提交至 reviewed SHA 的唯一变更为本 review 文档，产品源码、测试及配置未变，因此复用该产品验证证据。本轮未重复整个门禁或新增 Browser 运行，不以历史审查结论代替实现与日志核查。

本轮 exact-head Actions API 返回 `total_count: 0`，PR checks 为空；远端 CI 仍无可用证据或可绑定 waiter 的 run。批准仅覆盖 Draft/code 阶段，转 ready 前仍需适用 `full` 和 environment 前置或许可复用的精确版本 CI。真实服务、Runner、授权重试、服务器草稿/持久化、跨设备、完整平台矩阵与人工验收保持 `NOT RUN`。

本轮仅更新本正式记录，未修改产品、commit、push 或 merge。审查 comment 的发布与读回以 PR 为准；本地记录增量尚未提交，结论不自动绑定后续未知提交。


## 当前 main 基线上的合并前独立复审（2026-10-14）

结果：`APPROVE`

- Reviewed SHA：`d7576c516228aaab04e0d288679d74126c6498cb`。
- Base SHA：当前 main `8afaa30a89e61f9028ccea0031bdc820c6aab3ec`，已包含 startup PR #294。
- 本地 `vibe repo --json` 与最新远端 PR head/base 一致；最新 Issue #285 无评论，PR 仍 Draft。R1、R2 均保持关闭。
- 本次仅更新正式 review 记录，未修改产品、提交、推送、发表 GitHub comments、重跑 configured full 或注册/轮询 CI waiter。

先从最新 Issue/PR comments、UI01 #285 Spec/Test、已批准文件进度和重试交互建立预期：确认整份范围是唯一分母，supplied 进度不能由经过时间推导；候选、重试回执和轮次均绑定精确项目/请求/文件，UNKNOWN 保留原 intent 并只读原请求。startup #284/#294 的确认后进度入口应保留原报告版本及 fileIds，原位移除阻塞文件后不能把该文件纳入执行；其 PENDING/UNKNOWN 恢复不应因页面 wrapper 或轮次导航重置。身份清理、生产未注册能力不可用、R1 分层返回和 R2 跨卸载回执通知同样适用。

独立核查 actual diff 及当前上下文：相对当前 main，变更仍限于 workspace-web、相关 Browser/model/component 测试、UI01 Spec/Test、README 和本正式 review。App 保留已合并的 FixtureAnalysisStartup 路由及其 key，增加共享 ExecutionNavigation/FixtureExecutionProvider，并用共享执行页替代旧 elapsed-time 演示。TrustedApp 的新增 provider 位于原 sessionGeneration/principalId 键控且受 live/logout/session gate 控制的 WorkbenchNavigation 内；生产执行入口提供空 rounds 与 UNAVAILABLE，无开发回退或重试动作，既有公开 Markdown 读取路由保持。未增加业务端点、公共 wire contract、Schema、权限、持久化或 Runner 调度语义。

startup 开发 adapter 沿原确认操作生成唯一 request，使用精确 reportId/version/informationRefs/fileIds；FixtureExecution 从该请求逐文件建立 WAITING 输入，report/file 标题按原报告查找，不使用 createdAt 推导就绪。确认后的整份 fileIds 原样成为 confirmedFileIds，原计划意见阻塞文件显式移除后不进入进度分母。现有 startup 旅程改为断言共享清单仅含所确认的预防措施程序，原 UNKNOWN 跨路由查询旅程保留。旧 sessionStorage 演示范围机制来自已合并基线，本 PR 未新增客户数据或凭据存储。

R1 的工作台 returnTo 与精确 candidateReturns 仍分离；R2 的 provider notify、原 intent 同步锁、错回执 UNKNOWN 和 readback 保持。执行 model/component、fixture、相关 Browser 及 TrustedApp 产品差异相对已批准 `4a3191c` 未变；本轮仍重新核查关键边界，并检查其在新基线 full 中的实际回归结果，不把历史批准当成本次 head 的验证。候选快照不可变、后台到达不替换阅读版本/草稿等原检查结论未见反证。

验证采用原会话在本 reviewed SHA 执行的 `vibe verify full --json` 结果，实际读取 `/private/tmp/issue-285-full-final-evidence.txt` 的终端捕获。文件含工具输出截断提示，中间详细 persistence 日志有省略，不能称为完整原始日志。保留的汇总和最终结果明确为 PASS：125 files / 2549 unit/component tests、5 production Browser checks、36 development Browser journeys、58 persistence files / 709 tests；persistence gate passed，最终 Vibe `status=PASS,target=full,exit_code=0`。startup 两个旅程、R1 嵌套返回、R2 UNKNOWN/ACCEPTED 跨轮回执三个既有回归，以及生产执行 fixture 隔离均在本次输出中可见 PASS；Web/BFF 独立构建、架构与 contracts 汇总也 PASS。实际 PostgreSQL/Flyway digest、镜像验证、迁移和 cleanup 结果在该捕获中可见。本轮未重复 full 或另行执行 Browser。

environment 前置结果由原会话本轮实际执行并提供：`vibe verify environment --json` PASS，Docker 29.4.0，endpoint `unix:///Users/galendai/.orbstack/run/docker.sock`，PostgreSQL/Flyway 两个 digest 均 PIN_MATCH。该前置输出未另存文件，本 Reviewer 不声称独立读取其原始日志；本轮独立读取的 full 捕获确认同一 endpoint、固定镜像和实际 container-backed gate 成功。

该 APPROVE 是本地 full 证据充分后的独立 agent 审查结论；远端 exact-head CI 仍待原会话取得和核对，不作为本次 PASS 证据。本 Reviewer 未查询/轮询 CI、未登记 waiter。实际生产部署、真实客户文件进度/Runner 接入、重试授权、执行页服务器草稿及跨设备恢复、完整 Windows/macOS Chrome/Edge 矩阵和独立 Human 业务验收仍 NOT RUN；其他已执行 persistence 技术测试不能替代这些 #285 接入与人验。

下一步：原会话交付本正式记录，针对新增文档提交执行明确 BASE_SHA/GITHUB_SHA 的 configured docs 验证，再请求仅含 review 文档的最终 head 确认，并完成实际最终 head 的远端 CI 与适用交付 gates。PR 本轮仍 Draft；本 APPROVE 不自行授权 ready、merge 或部署，也不自动改标到未知后续修订。
