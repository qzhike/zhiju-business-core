# PR #294 独立代码审查

- 日期：2026-10-14。
- PR：[PR #294](https://github.com/qzhike/zhiju-business-core/pull/294)，Ready。
- Issue：[#284](https://github.com/qzhike/zhiju-business-core/issues/284)，T1 frontend。
- Reviewed SHA：`b4662808555463b8038ce1333b5d2ae0a16ee633`，发布前确认远端 head 与本地一致。
- Reviewer outcome：`REQUEST_CHANGES`。
- 范围：启动核对与整文件范围组件、分析页意见导航、开发 adapter、相关测试与 UI01 文档。

## 独立验收依据

读取 Issue 及评论、UI01 Spec/Test、HL-Spec 指定章节、验证基线、启动核对设计与批准的交互要求、完整 diff、当前组件和 adapter、精确 head 的 CI 元数据。验收重点为：默认整文件零选，必要依据阻塞但保留选择，逐文件待复核不得阻断独立文件，报告变化要求重新核对，已确认范围不可变，UNKNOWN 只能核实原意图，生产不能回退开发样例。未将未注册 D14 服务、Runner 或持久化业务能力提升为本次页面交付范围。

## R1 — [P2] 为已选后变为不可处理的文件提供解除选择路径

定位：[startup/Page.tsx L200–201](https://github.com/qzhike/zhiju-business-core/blob/b4662808555463b8038ce1333b5d2ae0a16ee633/apps/workspace-web/src/startup/Page.tsx#L200)，结合 L56–58 的 `selected.every(eligible)` 与 `fixtures/analysis.tsx` L320 原样恢复选择。

复现：在启动面板先勾选“纠正措施程序”，通过该行的“对这项计划提意见”提交意见，返回范围面板，再勾选“预防措施程序”。纠正文件仍为 checked，但因待复核被 disabled；底部实测显示“已选 2 / 1 份”，确认按钮始终禁用。页面没有取消该已选阻塞文件的入口，独立的预防文件因此也无法确认。当前浏览器测试在未先选文件的前提下提交意见，未覆盖这条路径。

这违反 #284 的“待复核仅暂停对应文件”和允许独立整文件继续选择的验收。请保留阻塞原因及原选择的可核对性，同时提供显式移除阻塞文件／重新选择独立集合的操作；不要让一个无法取消的禁用勾选锁死整个范围。补充“先选 → 提意见 → 返回 → 明确移除阻塞项 → 独立文件确认”的浏览器回归。

## R2 — [P2] UNKNOWN 原意图必须跨页面导航保留

定位：[fixtures/analysis.tsx L322–324](https://github.com/qzhike/zhiju-business-core/blob/b4662808555463b8038ce1333b5d2ae0a16ee633/apps/workspace-web/src/fixtures/analysis.tsx#L322)，结合 L367–370 的 UNKNOWN 赋值和 L388–404 原请求查询。

新引入的 `status` 与 `originalIntent` 只存在于启动路由组件的局部 state。定向注入一次开发 adapter 写入异常，使确认进入 UNKNOWN 后，点击“返回核对 → 返回分析总览 → 核对信息与文件范围”。组件重新挂载为 READY，原意图及“重新查询原请求”入口消失，原选择却从 adapter 恢复；实测无需任何原请求核验即可再次确认，并进入新请求的进度页。

这不满足 #284 明确要求的 UNKNOWN 不盲目重提，也使本 PR 新增的原请求查询能力可被普通导航绕过。请在路由组件之外按精确报告保留待核验意图、原选择和状态，在核验完成前重新进入仍锁定确认并查询同一请求；在当前页面工程范围内使用共享内存 adapter 即可，不要求新增生产浏览器持久化或后台接口。补充 UNKNOWN 后离开／返回的回归断言。

## 验证证据与边界

- [CI checks job 115700473007](https://github.com/qzhike/zhiju-business-core/actions/runs/38517796776/job/115700473007) 的 `head_sha` 与 reviewed SHA 一致，`Verify code` SUCCESS。工作流显示该 job 执行 clean + code，另一个 persistence job 执行独立构建与持久化门禁。
- 发布前快照：同一 run `38517796776` 的 persistence 仍 IN_PROGRESS，不能据此声称完整 full CI PASS。PR 正文自报本地 full PASS 未当作独立完成证据。本轮已有确定的实现阻塞项，不等待 CI 即可给出 REQUEST_CHANGES。
- 使用已安装的 Vite 对当前源码执行 fixture 定向构建，输出 `/private/tmp/pr294-review-dist`，成功；未覆盖工作区生产制品。
- `/private/tmp/pr294-review-repro.cjs` 在临时回环服务上使用受控 Chromium `156.0.8078.4`、1440×900 运行两个语义反例，最终 exit 0。R1：blocked checked/disabled、独立文件 checked、确认 disabled 均为 true；R2：选择保留、原查询入口数量 0、再次确认 enabled，并产生新请求入口。浏览器与临时服务在 finally 关闭。
- 环境恢复：沙箱 loopback 为 EPERM，宿主同一探针 PASS。初始 pnpm 包装构建未产出结果，已取消，改用仓库已安装 Vite 完成定向构建。诊断脚本先修正实际 Playwright 包路径及模态框关闭顺序后成功；这些中间诊断失败不记为产品缺陷。
- 未重复运行配置 code/full 目标；浏览器反例补充语义证据，不替代 full 门禁。真实 D14 服务、Runner、业务意图持久化、跨设备恢复、完整 Windows/macOS Chrome/Edge 平台矩阵及人工业务验收保持 NOT RUN。

## 交付状态

本记录为本轮新增正式审查文档，不属于 reviewed SHA。产品代码未修改，未 commit、push 或 merge。

已按用户授权发布 [PR comment 6161867937](https://github.com/qzhike/zhiju-business-core/pull/294#issuecomment-6161867937)，并通过 GitHub API 回读确认正文、两项发现与 reviewed SHA。`REQUEST_CHANGES` 为 Reviewer 结论；此次发布的是普通 PR comment，不是 GitHub 原生 Request changes review。本地正式审查文档尚未提交。

## 2026-10-14 修订复审：df63815

- Reviewed SHA：`df638150530e948859b5133220f83d2f27f78774`，本地与远端一致，PR 为 Ready。
- Reviewer outcome：`APPROVE`。R1、R2 均已闭合，未发现新的阻塞项；当前版本完整 CI 已成功，最终证据见本节末尾。下方等待与监控错误记录保留当时事实。
- 重新读取 #284 及评论、PR/head/评论、两次 reviewed SHA 间全部增量、相关 UI01 Spec/Test、组件、adapter 及新增回归；未变更部分沿用本会话初审结果。
- 原初审记录已由当前提交纳入 Git；本复审节为本轮未提交增量，不属于 reviewed SHA。

### 修复核实

R1：已选阻塞文件保留原因及禁用勾选，独立移除按钮调用原选择更新逻辑，仅移除用户指定文件；历史或 UNKNOWN 时该操作也禁用。浏览器回归覆盖先勾选纠正文件、提意见、返回选择独立预防文件、明确移除纠正文件，并确认最终进度只包含预防文件。

R2：原意图、报告版本、信息引用及所选完整文件集合移至路由外的 provider 内存。重新进入从 pending scope 恢复选择，UI 和 action 均拒绝修改或再次确认。原请求查询校验原请求 ID 对应结果的报告、版本、信息引用和完整文件集合，匹配后才清除 UNKNOWN 并导航。浏览器故障注入覆盖离开／返回、保留原选择与查询、继续禁确认、查无回执且执行记录为零。UI01 文档明确会话内导航恢复与未来刷新／跨设备恢复的边界。

### 当前证据

- [CI checks 115705592723](https://github.com/qzhike/zhiju-business-core/actions/runs/38519444173/job/115705592723) head_sha 与 reviewed SHA 相符，Verify code SUCCESS。
- 实际日志：123 个测试文件 / 2,535 项单元测试、4 条生产浏览器与 27 条开发浏览器场景 PASS；两条 startup 回归均 PASS，生产隔离 PASS，受控 Chromium 156.0.8078.4。
- 复用精确版本 CI，不重复本地配置目标或已覆盖的浏览器路径。读取快照中 persistence 仍 IN_PROGRESS；准备由原会话 agent-ci 等待 run 38519444173、attempt 1、上述完整 SHA 的完成事件。
- 日志首次读取被 gh 的终端转义保护拒绝；宿主只读 job 探针成功，显式允许读取日志转义后提取测试结果。agent-ci 沙箱 IPC 被拒绝，宿主同一 doctor 探针确认原会话通知可用。
- 真实服务、Runner、业务持久化、跨设备、完整平台矩阵与人工验收仍 NOT RUN。产品代码未修改，未 commit/push/merge。

复审进展已发布为 [comment 6162335020](https://github.com/qzhike/zhiju-business-core/pull/294#issuecomment-6162335020)，并经 API 回读确认。该 comment 确认两项修复闭合，同时明确最终结论待完整 CI。

### CI 等待事件：监控错误

2026-10-14 已 ack job `d8c40b06be6fecc7b999fc07`、event `bfb711cd-3ab3-4232-b67a-aab929a2ff26`，session `01a138ee-a0ba-7772-8361-8a670c164b31`。事件为 `monitor_error`，原因 `GitHub read timed out`；它不代表 CI 完成或 CI 失败。

沙箱 gh 探针超时后，宿主最小只读恢复探针成功，同时完成本次允许的精确 run 核验：run `38519444173`、attempt `1`、SHA `df638150530e948859b5133220f83d2f27f78774` 仍为 `in_progress`、conclusion null；当前 PR head 未变。两项代码修复已闭合，code 证据有效，最终 APPROVE 仍待完整 CI。原等待任务已结束，不再轮询或为同一事件新建 waiter；当前没有自动完成通知待接收。

### 最终 CI 核验与复审结论

用户再次通知 CI 已结束后，核验 [run 38519444173](https://github.com/qzhike/zhiju-business-core/actions/runs/38519444173)、attempt 1 为 COMPLETED / SUCCESS；run 及各 job 的 head_sha 均为 `df638150530e948859b5133220f83d2f27f78774`，远端 PR head 未变。

- select、checks、persistence、verify 全部 SUCCESS。
- [Persistence job 115705592720](https://github.com/qzhike/zhiju-business-core/actions/runs/38519444173/job/115705592720) 的 Build persistence prerequisites、Verify persistence 均 SUCCESS，于 2026-10-14 06:41:45 UTC 完成。
- [汇总 verify 115719069932](https://github.com/qzhike/zhiju-business-core/actions/runs/38519444173/job/115719069932) 的 Require all selected verification results SUCCESS，于 06:41:57 UTC 完成。
- 当前 Ready PR 所需完整 CI 证据已满足；复用同版本 code 及其浏览器回归证据，不重复本地配置目标。

最终 Reviewer outcome 为 `APPROVE`，取代此前完整 CI 待完成时的暂缓通过状态。初审两项发现已由当前代码和回归闭合，未发现新阻塞项。先前监控错误仅为通知工具读取超时，不作为 CI 失败证据。

该结论限于 #284 的页面工程范围；真实 D14 服务、Runner、该业务意图的持久化与跨设备恢复、完整平台矩阵及人工验收仍 NOT RUN。仓库持久化回归通过不代表未接入业务能力已实现。正式复审记录增量尚未 commit/push；产品代码未修改，未 merge/deploy。

最终结论已发布为 [comment 6162569484](https://github.com/qzhike/zhiju-business-core/pull/294#issuecomment-6162569484)，API 回读确认 APPROVE、reviewed SHA 与验证说明。此次为普通 PR comment，不是 GitHub 原生 APPROVED review，不授权合并。
