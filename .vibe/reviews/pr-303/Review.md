APPROVE。独立工程复审绑定 `eb00cb950d26e3d4c5b814cc4706853c755cfa26`：R1–R3 已确认修复，新增范围门禁的聚焦浏览器检查通过，该 SHA 的 required `full` CI 已通过，未发现新的代码阻断问题。用户随后报告 U1 手动验证通过并授权合并，证据见文末交付前对账。以下各轮发现、待完成边界及授权范围按其记录日期保留为历史；本次文档增量形成的新 head 仍须独立复核并通过适用 CI 后合并。

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

## 当前 head 独立复审（2026-10-20）

- Reviewed SHA：`eb00cb950d26e3d4c5b814cc4706853c755cfa26`；base 仍为 `ae2aa7cb730da2cd27fa461b45b5cf3e32a4ca61`。
- 本轮重新读取 PR/Issue 正文、comments、当前 checks 与实际源码差异，审查 `dc4374f` 之后的六个文件增量；此前记录的复审结论不作为本轮批准依据。
- 最终 Reviewer 结论：`APPROVE`。原 R1–R3 关闭；新增范围门禁通过独立聚焦检查；未发现新的代码阻断问题。用户告知 CI 结束后，已确认当前 SHA 的 required `full` 完整通过。

### 原发现复核

1. **R1 关闭。** [状态映射](https://github.com/qzhike/zhiju-business-core/blob/eb00cb950d26e3d4c5b814cc4706853c755cfa26/apps/workspace-web/src/fixtures/u1.tsx#L151)现在显式产生 `FAILED` / `RECEIVED`。浏览器确认失败标题正确、失败后可重试、收到后提交按钮锁定；经资料页返回仍保留两条失败/收到回执并保持锁定。
2. **R2 关闭。** [明确查看版本的记录](https://github.com/qzhike/zhiju-business-core/blob/eb00cb950d26e3d4c5b814cc4706853c755cfa26/apps/workspace-web/src/fixtures/u1.tsx#L554)与新版本可用性分开。浏览器确认第 2 版到达但未选择时，资料页往返仍为第 1 版；主动选择第 2 版后概览/资料页往返保留第 2 版；主动回看历史第 1 版后仍保留第 1 版及只读状态。
3. **R3 关闭。** [修订请求追加保存](https://github.com/qzhike/zhiju-business-core/blob/eb00cb950d26e3d4c5b814cc4706853c755cfa26/apps/workspace-web/src/fixtures/u1.tsx#L319)和[意见快照展示](https://github.com/qzhike/zhiju-business-core/blob/eb00cb950d26e3d4c5b814cc4706853c755cfa26/apps/workspace-web/src/plan/Page.tsx#L340)保留历史。浏览器确认同一计划的两次反馈有不同请求 ID，两条原文都可展开阅读；新计划没有继承旧反馈，返回旧计划后 ID、正文和计划版本绑定仍可核对；被替代计划不能生成。
4. **新增范围门禁通过。** [范围页入口](https://github.com/qzhike/zhiju-business-core/blob/eb00cb950d26e3d4c5b814cc4706853c755cfa26/apps/workspace-web/src/fixtures/u1.tsx#L680)在第 2 版报告未到达或未核对时不渲染计划与确认操作；用户显式核对后才开放范围页。浏览器分别检查了这三种条件。

### 当前验证与未完成边界

- 本轮把 reviewed SHA 导出到临时目录，使用现有本机依赖和受控 Chromium `156.0.8078.4` 运行上述四组聚焦场景，全部 `PASS`。这是本轮独立浏览器诊断，不是重复执行 required full，也不替代构建、生产隔离或完整回归证据。
- base-to-head `git diff --check` 通过。共享页面改动和新增回归与 owning UI Spec/Test 对应，未发现新增业务 API、授权或持久化实现。
- [CI run 39429395652，attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39429395652)绑定 reviewed SHA。复审进展发布时持久化仍在运行；用户通知结束后，本会话最终读回为 `completed / success`，`select`、`checks`、`persistence`、`verify` 全部成功。[verify 汇总日志](https://github.com/qzhike/zhiju-business-core/actions/runs/39429395652/job/118673547277)明确 `target=full`、`checks=success`、`persistence=success`、`WORKFLOW_CANCELLED=false`，最终输出 `{"status":"PASS","failures":[]}`。PR head 与本地 HEAD 仍是 reviewed SHA，未新增代码差异；复用该 exact-head CI，没有重复运行本地 full。
- 此前 `agent-ci doctor --target codex` 在 sandbox 返回 `desktop_ipc_permission_denied`，宿主只读复测返回 `desktop_owner_unavailable` / `no-client-found`，因此未启动 waiter。用户随后在本会话通知 CI 结束，已完成同一 run/attempt/SHA 的最终核对；没有新建/恢复其他 runtime，也没有轮询 GitHub。
- 用户 U1 实际试走反馈仍为 `NOT RUN`，关闭 #302 前须记录修订、观察结果和脱敏反馈。此项不因代码复核或自动化通过而完成。
- 本次未重做私有来源内容核验；真实 ZIP/OOXML、BFF/Core 写入、Runner、服务器持久化/重启、UI-04–08 与 MVP-01–10 保持既定未验收边界。
- 已纳入 PR 的历史正式审查记录予以保留；本轮追加内容只修改此文档，尚未 commit/push。产品代码与已有 `package.json`、`pnpm-lock.yaml` 改动未修改。后续需把最终审查记录按项目交付授权纳入 Git。
- 本轮复审进展已[发布到 PR #303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6292095463)，并通过 GitHub API 读回确认 reviewed SHA、四组核验结果和 CI 待完成边界。

### 最终交接

当前代码修订的独立审查完成，无待修复的代码阻断发现。#302 关闭前仍需实际用户 U1 试走及脱敏反馈；正式审查记录的本轮更新需按交付授权纳入 Git。后续 head 变化时复核新增差异和适用验证，不把本结论自动延伸到新 SHA。本次只发布 PR comment，不提交 GitHub formal approval，不 commit、push、merge 或关闭 Issue。

最终 `APPROVE` 已[发布到 PR #303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6292886453)，并通过 GitHub API 读回确认正文、reviewed SHA 和完整 CI 证据。

### attempt 2 监视器事件补充（2026-10-20）

- 已在原会话确认接收 job `8db239de4b58d7c8b74051a2` / event `f597f529-47ab-4dee-8168-ae64a27184b3`。结果为 `monitor_error`，错误为 `GitHub read timed out`，没有 CI conclusion。
- 单次核对 [run 39429395652，attempt 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39429395652/attempts/2)：`headSha` 仍为 reviewed SHA，状态为 `in_progress`；`select`、`checks` 成功，`persistence` 的 `Verify persistence` 仍在运行，尚无 `verify` 汇总结果。PR 仍为 OPEN，head 未变。
- attempt 1 的成功证据和该代码修订的工程审查结论保持有效；最新 attempt 2 的 CI 门禁仍待完成。本事件不能用来认定 attempt 2 成功或失败，也不能认定最新检查已满足合并条件。
- 没有轮询、启动新 waiter、重跑验证或启动手动测试服务。用户 U1 试走仍待反馈，其他交付边界保持不变。
- 补充说明已[发布到 PR #303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6294006484)，并通过 GitHub API 读回确认正文和 attempt 区分。

## 交付前对账（2026-10-21）

- 当前实现仍为 `eb00cb950d26e3d4c5b814cc4706853c755cfa26`。[run 39429395652，attempt 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39429395652/attempts/2)已最终核对为 `completed / success`，`select`、`checks`、`persistence`、`verify` 全部成功；前述监视器超时保留为历史，不再表示 CI 待完成。
- 用户报告 U1 手动验证通过并授权合并；修订、观察结果和脱敏反馈已记录并读回于 [Issue #302](https://github.com/qzhike/zhiju-business-core/issues/302#issuecomment-6308788799) 与 [PR #303](https://github.com/qzhike/zhiju-business-core/pull/303#issuecomment-6308789929)。这是用户报告的 U1 整体试走通过，不推断逐项失败场景或完整平台矩阵的人工覆盖；此前用户反馈 `NOT RUN` 的边界已由这次实际反馈更新。
- 本次增量仅补齐正式审查记录及相关文档的当前事实、后续意图；实现、测试、依赖和验证配置不变。最终文档提交的独立审查与 CI 以 PR 中绑定该新 SHA 的证据为准，不能把旧 SHA 的批准直接当作新 head 批准。
- U2/U3、第一阶段整体流程确认、真实 ZIP/OOXML、BFF/Core、Runner、服务器持久化/重启及 MVP-01–10 保持原未验收边界。没有通过本次 U1 交付扩大已验证范围。
