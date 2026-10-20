REQUEST_CHANGES（初審 dc4374f），已在修订后复审转为 `PASS`。PR #303 初始修订存在三项可复现的 U1 状态、版本与意见历史缺陷；R1–R3 已修复并完成独立复审。

# PR #303 独立审查

## 对象与范围

- PR：[#303](https://github.com/qzhike/zhiju-business-core/pull/303)；关联任务：[#302](https://github.com/qzhike/zhiju-business-core/issues/302)。
- Reviewed SHA：`dc4374f928dad63b353846637ca2cfddf1cce967`。
- Base SHA：`ae2aa7cb730da2cd27fa461b45b5cf3e32a4ca61`。
- 审查日期：2026-10-20。
- 用户授权审查并发布 PR comments。本轮不修复实现，不 commit、push、merge 或关闭 Issue。

依据 Issue 的 Acceptance、UI01 Spec 的 U1 展示与交互边界、UI-MVP-U1-001–008、MVP 可用闭环及验证基准独立检查。预期是：页面往返保留用户明确查看的版本；新版本只提示而不代替用户选择；失败和收到回执必须有不同语义；意见及其精确上下文应在当前演练会话中保留。演练的内存边界不要求本 PR 实现服务器持久化，也不允许在同一会话内覆盖已登记的历史。

## 阻断发现

### R1 · P2：分析回执的小写场景值绕过状态判断

位置：[fixtures/u1.tsx:148](https://github.com/qzhike/zhiju-business-core/blob/dc4374f928dad63b353846637ca2cfddf1cce967/apps/workspace-web/src/fixtures/u1.tsx#L148)。

`analysisScenario` 的实际值是 `received` / `failed`，这里用类型断言直接赋给只接受大写值的 `Receipt.state`。类型断言不会转换运行时字符串；共享分析页的失败标题与提交锁定逻辑只识别 `FAILED` / `RECEIVED` 等大写值。

复现：

1. 打开第 1 版分析，选择“针对整个项目提意见”，填写任意合成意见。
2. 将“分析回执场景”选为“失败”后提交。
3. 回执标题显示“已接收意见 · 演示”，正文却说明“复核失败”。
4. 在默认收到场景提交普通意见后，提交按钮仍可点击；再次点击产生第二条回执。

浏览器独立复现了上述两条路径。违反 #302 的状态区分要求及 UI Spec U1 边界 5；目前测试只断言成功标题，未覆盖 U1 分析失败值及正常回执后的重复提交行为。

修复方向：显式把场景映射为合法的 `Receipt.state`，避免用断言掩盖不相容值；补充失败标题和提交后重复点击的回归。固定答复路径已经使用大写 `RECEIVED`，应保持其语义。

### R2 · P2：经资料页返回分析会静默切换报告版本

位置：[fixtures/u1.tsx:485–488](https://github.com/qzhike/zhiju-business-core/blob/dc4374f928dad63b353846637ca2cfddf1cce967/apps/workspace-web/src/fixtures/u1.tsx#L485)；同文件 534–537 行的返回分析链接有同一问题。

资料页用 `reportTwoAvailable` 选择分析链接，把“新版本已到达”当成“用户已选择这个版本”。适配器没有保存用户明确查看的报告版本。

复现：

1. 在第 1 版分析带入并提交固定客户答复，使第 2 版到达。
2. 保持在第 1 版，不点击“主动查看第 2 版”。
3. 点击“资料批次”，再点击普通导航“分析与澄清”。
4. 实际进入 `U1-REPORT-02`，未返回原先阅读的 `U1-REPORT-01`。

浏览器已复现；第 2 版仍需核对的门禁没有消除阅读版本被替换的问题。违反 #302 的 Continuous project journey / Preserve version and request context，以及 UI-MVP-U1-001/005。

修复方向：分别保存“可用版本”和“明确查看版本”；普通往返导航使用明确查看的版本，只有版本选择动作更新它。补充“新版到达但未切换 → 资料页 → 返回分析”及“主动查看历史版 → 往返页面”的覆盖。

### R3 · P2：第二条范围内反馈覆盖第一条修订请求

位置：[fixtures/u1.tsx:310–320](https://github.com/qzhike/zhiju-business-core/blob/dc4374f928dad63b353846637ca2cfddf1cce967/apps/workspace-web/src/fixtures/u1.tsx#L310)；展示位置：[plan/Page.tsx:348–363](https://github.com/qzhike/zhiju-business-core/blob/dc4374f928dad63b353846637ca2cfddf1cce967/apps/workspace-web/src/plan/Page.tsx#L348)。

`revisions` 以计划 ID 保存单个 `RevisionRequest`。同一计划再次提交时用新对象覆盖旧对象；页面又只接收单个 `revision`，没有可回看的意见历史。回执没有展示 `revision.text`，输入框则在提交后清空，因此已提交意见的正文也无法从该页面回看。

复现：

1. 核对第 2 版分析，确认第 1 版范围计划。
2. 提交第一条范围内反馈，记录生成的 `U1-REV-*`。
3. 对同一计划提交第二条范围内反馈。
4. 页面只剩第二个请求；第一条请求 ID 从页面消失，已提交意见正文没有回看入口。

浏览器已确认两次请求 ID 不同、第二次提交后只有一条回执，源码确认第一次记录被覆盖。违反 #302 对旧反馈及来源绑定保留的要求、UI Spec U1 边界 5，以及可用闭环 §5 的意见历史原则。这是在同一会话中丢失已经登记的内容，不是要求新增服务器存储。

修复方向：按精确计划版本追加保留修订请求及其意见快照，允许回看原请求 ID、正文与绑定；覆盖同一计划多次提交，以及切换计划后回看旧版本记录。

## 验证证据与限制

- `vibe repo --json` 确认仓库身份；本地 HEAD 和远端 PR head 为上述 reviewed SHA。
- 复用 [CI run 39417437353](https://github.com/qzhike/zhiju-business-core/actions/runs/39417437353)：`headSha` 为 reviewed SHA，`select`、`checks`、`persistence`、`verify` 均为 completed / success。此范围要求 `full`；没有重复运行本地 full。
- 完整 base-to-head `git diff --check` 通过。
- 将 reviewed SHA 用 `git archive` 导出到临时目录，在该源码快照启动 fixture 模式，用现有本机依赖及受控 Chromium `156.0.8078.4` 做聚焦反例。R1 的失败和重复提交、R2 的版本往返、R3 的修订历史均独立复现。该诊断不是新的 full，也不替代 CI 的构建环境证据。
- 工作区另有 `package.json`、`pnpm-lock.yaml` 未提交改动；未修改、暂存或包含在受审查源码快照中。
- 已读取当前 Issue/PR 的正文和评论；用户 U1 试走反馈仍为 `NOT RUN`，PR 正文也明确承认该边界。自动化通过不能完成这项 Acceptance，U1 关闭前仍需实际试走并记录修订、结果和脱敏反馈。
- 本次未重新执行私有 DOCX/模板内容核验，不将作者关于来源阅读的描述当作本 Reviewer 的独立内容验收。客户身份、原件、正文、截图和本机清单未写入此记录或公开评论。
- 真实 ZIP/OOXML 链路、BFF/Core 写入、Runner、服务器持久化/重启、后续 UI-04–08 与 MVP-01–10 不在本轮新增验收范围，保持各自 `NOT RUN`。

## 交接

由 Implementer 修复 R1–R3 并补充对应的失败/历史/往返回归，再提供新 head 的适用验证并重新审查；实际用户 U1 反馈仍是独立的关闭条件。

本文件是项目要求的正式审查记录；当前只保存在本地，未 commit 或 push。关闭 PR/Issue 前须将正式记录纳入 Git，并按最终修订重新核对审查和验证。GitHub 发布形式为 PR comment；`REQUEST_CHANGES` 是 Reviewer 结论，不冒充 GitHub formal review，也不提供合并授权。

审查意见已[发布到 PR #303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6291237598)，并通过 GitHub API 读回确认正文、reviewed SHA 和三项发现。


## 修订后复审（2026-10-20）

- 复审代码修订：`bc0381a`（R1–R3）与 `d3904b2`（范围页门禁）。其后仅移除已不可达的 `blockedReason`/旧通知分支，不改变行为；最终 head 以 PR 与 CI 记录的 SHA 为准。
- 结论：`PASS`。R1、R2、R3 均关闭；范围页在未核对第 2 版分析前改为封闭的“先核对第 2 版分析”页面，确认、生成和下一阶段均不可达。未发现新的实质问题。

### R1 关闭

- 小写场景值显式映射为 `RECEIVED` / `FAILED`，不再用类型断言掩盖运行时值。
- 失败回执显示“复核失败”，仍允许再次提交；收到回执显示“已接收意见”并锁定提交按钮。
- 新增浏览器用例覆盖失败/收到区分、失败后可重试及收到后重复提交被禁用。

### R2 关闭

- Adapter 分别保存“可用版本”和“明确查看版本”；普通导航使用明确查看版本，只有实际打开报告页且报告可用时才更新。
- 新增用例覆盖：第 2 版到达但未切换时，资料页/概览/导航仍回到第 1 版；主动切换后回到第 2 版；主动查看历史第 1 版后往返仍为第 1 版。
- 概览在核对前后分别显示 `U1-REPORT-01` / `U1-REPORT-02`。

### R3 关闭

- 范围内修订请求按计划版本追加保存，不再覆盖；页面显示每条请求 ID、计划版本、正文快照和原意见。
- 新增用例覆盖同一计划连续两次反馈、展开到计划第 2 版后不继承旧反馈、切回计划第 1 版后两条请求及正文均可回看。

### 剩余限制

- 本轮复审未执行浏览器、axe、full 或 CI；最终 head 的适用验证由 PR 的 `vibe verify full` 与 CI 记录提供。
- 用户 U1 实际试走仍为 `NOT RUN`；真实 ZIP/OOXML、BFF/Core、Runner、服务器持久化、UI-04–08 与 MVP-01–10 仍不在本轮验收范围。
