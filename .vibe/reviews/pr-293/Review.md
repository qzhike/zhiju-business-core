# PR #293 独立代码审查

- 日期：2026-10-14。
- PR：[PR #293](https://github.com/qzhike/zhiju-business-core/pull/293)，Draft。
- Issue：[#283](https://github.com/qzhike/zhiju-business-core/issues/283)，T1 frontend。
- Reviewed SHA：`e913f27ed0f1dd40a56e141cddd63199633803fd`。
- Reviewer outcome：`REQUEST_CHANGES`。
- 范围：分析总览、索取复制、上下文输入、开发 adapter、路由接线与 UI01 文档。

## 独立验收依据

读取 Issue 及评论、UI01 Spec/Test、HL-Spec 指定入口、验证基线、已批准的交互和前端工程基线、实际完整 diff、相关当前实现及测试。预期为：精确报告四区可导航；索取选择与复制互不覆盖；每个模式草稿独立，提交冻结上下文；更新报告显式进行，旧上下文不被新版证据替代，历史只读仍可回看原输入；单文件意见仅影响对应文件；生产不加载开发 fixture。

## R1：旧上下文错误展示新报告的同名证据（P2）

定位：[Page.tsx L639](https://github.com/qzhike/zhiju-business-core/blob/e913f27ed0f1dd40a56e141cddd63199633803fd/apps/workspace-web/src/analysis/Page.tsx#L639)，以及 L133–136 的证据解析。

**[P2] 旧上下文的依据必须按原报告解析**

第 1 版客户补充中留下草稿，再用“模拟新报告到达 → 应用更新到当前总览”打开第 2 版，展开“关联报告、事项与依据”。此处仍显示 `DEMO-STARTUP-REPORT-01 / 第 1 版`，但 `showEvidence` 在第 136 行始终查当前 `report.evidence`，于是 `E-ROLE` 从原文“该文件未出现在输入清单”被替换成第 2 版的“本轮新增依据另见现行岗位职责文件”。已在当前 head 的 built Chromium 页面复现。

这把新版证据混入了标注为旧报告的待核对草稿，违反 #283 的精确上下文和 stale 草稿重新核对要求。请使用上下文绑定的原报告/版本解析证据，或在旧证据不可取得时明确显示不可用并链接原报告；不能仅按同名 evidence ID 从当前报告补齐。补充“两个报告复用 evidence ID、内容不同”的回归断言。

## R2：历史只读使其他上下文的旧草稿无法查看（P2）

定位：[Page.tsx L463](https://github.com/qzhike/zhiju-business-core/blob/e913f27ed0f1dd40a56e141cddd63199633803fd/apps/workspace-web/src/analysis/Page.tsx#L463)，同类入口在 L444、L487、L531；旧稿提示只读取当前 key（L540–547）。

**[P2] 历史只读仍需保留各模式旧草稿的查看入口**

在第 1 版先填写客户草稿，再填写顾问判断草稿，切回客户补充后显式应用第 2 版。此后回看第 1 版时，顾问判断入口在这里被 `disabled={historical}` 禁用；计划意见和“切换客户补充”也同样禁用。唯一输入区只呈现 `state.context.key` 对应的草稿，“报告记录”没有其他草稿入口。第 2 版选择同一事项则生成新版 key，无法取出旧稿。因此已保存在其他 key 下的顾问/计划草稿虽仍在内存中，用户却无法查看、复制或重新核对。built Chromium 复现确认：顾问入口 disabled，旧顾问草稿未出现在历史页 DOM，只有原活动客户草稿可见。

#283 明确要求分别保留输入，并在 stale 时保留草稿供重新核对。请允许只读切换旧上下文，或增加按原报告/事项列出的旧草稿查看入口，同时继续禁止历史编辑和提交；补充多模式草稿跨报告更新后全部可读的回归场景。

## 验证证据与未运行边界

- [CI run 38422336226](https://github.com/qzhike/zhiju-business-core/actions/runs/38422336226) 的 headSha 与 reviewed SHA 一致，`checks / Verify code` 和汇总 `verify` 为 SUCCESS；实际日志包含生产检查、22 个 fixture browser journeys 与架构/契约 Gate。复用符合 Draft 要求的 code 证据，没有重复运行完整配置目标。
- 以当前源码调用已安装 Vite，fixture 构建输出到 `/private/tmp/pr293-review-dist`，成功；没有覆盖工作区生产 dist。
- 定向脚本 `/private/tmp/pr293-repro.cjs` 使用仓库已安装 Playwright/受控 Chromium，临时回环静态服务于 finally 关闭。R1 实测旧/new evidence 文本不同且上下文仍为第 1 版；R2 实测历史顾问入口 disabled、旧顾问草稿未出现在 DOM，当前客户草稿仍可见。属于 built-browser 语义反例，不替代配置目标。
- 沙箱 loopback listen 为 EPERM；宿主同一能力探测 PASS，定向浏览器复现 exit 0。
- `full` / persistence 未运行（CI persistence 为 SKIPPED），ready 前仍需项目要求的 full 证据。真实服务/Runner、上传与上下文命令、服务器草稿、跨设备、完整 Windows/macOS Chrome/Edge 矩阵、人工业务验收仍为 NOT RUN。它们不作为当前 Draft 页工程范围的额外阻塞项。

## 交付状态

本记录是正式审查文档，不属于 reviewed SHA。产品代码未修改，未 commit、push 或 merge。用户授权向 PR 提交 comments；发布采用 COMMENT review 和两条行内 comments，角色结论为 REQUEST_CHANGES，不等同于 GitHub 原生 REQUEST_CHANGES review。

已于 2026-10-14 发布并通过 GitHub API 回读确认：

- [Review 5512485793](https://github.com/qzhike/zhiju-business-core/pull/293#pullrequestreview-5512485793)：状态 COMMENTED，commit_id 与 reviewed SHA 一致，正文正确。
- [R1 行内评论](https://github.com/qzhike/zhiju-business-core/pull/293#discussion_r4266254411)。
- [R2 行内评论](https://github.com/qzhike/zhiju-business-core/pull/293#discussion_r4266254421)。

本地仅新增本审查记录，尚未提交到 Git。
