# PR #295 独立审查

结果：`REQUEST_CHANGES`

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
