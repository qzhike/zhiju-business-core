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
