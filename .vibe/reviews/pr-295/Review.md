# PR #295 独立审查

当前结果：`REQUEST_CHANGES`（2026-10-14 新一轮独立审查；Reviewed SHA：`47256468ce16cdab15530f7b0e3404c5310074ea`；R2 待修复）。下方历史 APPROVE 保留，不代表本轮结论。

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
