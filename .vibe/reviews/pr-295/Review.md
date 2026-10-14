# PR #295 独立审查

当前结果：`APPROVE`（Draft 阶段；复审 SHA 见下文）。

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
