# PR #297 正式代码审查

最新结论：`APPROVE`。已独立审查提交 `ad0a063f3e56a5980f90d3ca2bdda759ddfde01c`，R1–R5 均已关闭，未发现新的阻断问题；该精确提交的 full 范围 CI 已全部通过。结论限 #286 页面工程交付，不代表真实服务或人工业务验收通过，也不授权合并。

## 最终证据与结论

- 最终 reviewed SHA：[`ad0a063f3e56a5980f90d3ca2bdda759ddfde01c`](https://github.com/qzhike/zhiju-business-core/commit/ad0a063f3e56a5980f90d3ca2bdda759ddfde01c)。2026-10-15 最终回读时 PR #297 仍为 OPEN/Draft，head 与该 SHA 一致。
- [CI run 38683418850 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38683418850/attempts/1) 为 COMPLETED/SUCCESS，headSha 精确匹配；select、checks、persistence、verify 全部 SUCCESS，最终汇总于 `2026-10-15T05:30:31Z` 完成。当前所需 full 验证证据完整，未重复本地 full。
- 独立代码与交互证据见下方第三轮记录：两个批准窄屏视口均恢复 478px 阅读栏，实际滚动、导航、引用、输入保留及批准限制通过；三个桌面视口仍有界；旧版普通意见 STALE、显式切换与目录状态反例均保持关闭。UI01 Spec/Test 与已实现边界一致，没有新增后台业务、授权或持久化范围。
- 外部 waiter job=`94993452cb69d22a5a9ef49e`、event=`a82de950-05da-44f9-93c8-31291266cd78`、original session=`01a13a70-9aed-79d1-abf1-845a6a42a72e` 已准确 ack。读取结果为 `monitor_error / GitHub read timed out`，该事件本身没有 CI conclusion，未作为 CI 成功或失败证据。
- 按允许的最终核验，在原会话读取同一 PR head 与固定 run/attempt/SHA。沙箱 `gh pr view 297 --json headRefOid,state,isDraft,statusCheckRollup` 报 `dial tcp 198.18.0.37:443: i/o timeout`；按项目恢复规则进行宿主只读核验成功，并通过宿主 `gh run view 38683418850 --json headSha,status,conclusion,url,attempt,jobs` 确认上面的完整结果。未轮询、重建 waiter 或切换会话。
- 正式记录继续保留前两轮发现及修复证据，由后续文档提交交付。该提交仅包含本记录及 roadmap 的 #286 进展对账，不修改已审查代码；代码审查与原 full 证据仍绑定上述代码 SHA，不预先授予尚未产生的文档提交验证结论。最终 head、文档增量核对与所选 CI 结果在 PR 中记录。用户于本次交付明确授权合并 PR #297、关闭关联 Issue 并清理本地/远端任务分支；授权不豁免验证与正式记录门禁。
- 真实服务器草稿/提交/回执/建议复核/批准、Runner、跨设备恢复、完整 Windows/macOS Chrome/Edge 矩阵、生产和独立人工内容验收仍为 `NOT RUN`。Reviewer 没有修改产品代码或执行合并。
- [最终 APPROVE comment](https://github.com/qzhike/zhiju-business-core/pull/297#issuecomment-6185212816) 已发布并通过 GitHub API 回读确认，精确绑定上述 reviewed SHA、四项成功 CI 与 R1–R5 关闭证据；发布形式为 comment，不是 GitHub 正式 approval review。

## 第三轮复审：R5 修复与当时的验证等待记录

- 本轮提交：[`ad0a063f3e56a5980f90d3ca2bdda759ddfde01c`](https://github.com/qzhike/zhiju-business-core/commit/ad0a063f3e56a5980f90d3ca2bdda759ddfde01c)，本地 HEAD 与远端一致。增量限四份文件：窄屏 CSS、聚焦 Browser 回归与 UI01 Spec/Test；没有新增公开业务能力或修改桌面规则。
- 独立预期：360×800、320×800 可通过页面滚动到达正文与导航，阅读区仍可内部滚动；前后导航、精确引用、切回原意见保持可操作，窄屏批准限制保留；桌面三视口有界布局及 R2–R4 不回退。
- R5 关闭。Reviewer 在宿主 Chromium `156.0.8078.4` 对两个批准窄屏视口实测：阅读栏 clientHeight 均为 478px；正文滚动区 clientHeight 分别为 238px、197px，scrollHeight 均为 543px。实际滚动到当前段落后通过 viewport 检查；下一处/上一处导航、引用进入同一意见框、焦点、切回保留原引用、窄屏批准禁用均通过。合成截图已目视确认阅读内容与导航可见。
- 桌面 1280×800、1440×900、1920×1080 的工作区 bottom 仍为 768.17、868.17、1048.17px，整页高度分别为 800、900、1080px。新候选后的旧版普通提交仍禁用且保留输入；切文件/版本默认变化详情且旧草稿保留；批准后 APPROVED=1/1、READY=1/1、ALL=40/201。R1–R4 保持关闭。
- 增量 Browser 场景新增真实阅读栏高度、内部滚动、导航/正文进入 viewport、按钮操作与输入保留断言；UI01 Spec/Test 同步区分桌面有界三栏与窄屏页面滚动，未扩大后端范围。
- 聚焦证据保存在临时 `/private/tmp/pr297-r3-probe.mjs`、`/private/tmp/pr297-r3-results.json` 和 `/private/tmp/pr297-r3-360.png`、`/private/tmp/pr297-r3-320.png`；关键步骤与数值已写入本记录，不依赖临时文件长期存在。首次探针在尚未滚动到 after 段落时要求其立即进入 viewport，断言失败；按实际阅读行为显式滚动到该段落后，独立交互断言全部通过，没有修改产品代码。
- `git diff --check 08b3fe57fc6cef5176295cfecc2222c6a6ad4183...HEAD` 通过。正式记录使用聚焦 Prettier 检查；不重复运行已有 code 检查或以 docs 覆盖累计代码 diff。
- 已回读 [CI run 38683418850 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38683418850/attempts/1)：headSha 为本轮提交，select/checks SUCCESS，Persistence 仍 IN_PROGRESS，最终 verify 尚待完成。实现者声明的本地 full 结果不代替本轮尚待完成的精确 CI；当前不声明 full PASS 或最终 APPROVE。
- 外部等待固定为 repository=`qzhike/zhiju-business-core`、run=`38683418850`、attempt=`1`、head=`ad0a063f3e56a5980f90d3ca2bdda759ddfde01c`。通过项目要求的原会话 agent-ci 通道接收结果，完成事件后核对结果与当前 head，再发布最终结论。
- 真实服务/Runner/跨设备、完整 Windows/macOS Chrome/Edge 矩阵和独立人工内容验收仍为 `NOT RUN`；Reviewer 未修改产品实现，正式记录未 commit/push，不授权合并。
- [第三轮复核进展 comment](https://github.com/qzhike/zhiju-business-core/pull/297#issuecomment-6184948358) 已发布并回读确认，明确区分已关闭的代码发现与尚缺的 full CI 证据；不是最终 APPROVE 或 GitHub 正式 review。

以下第二轮记录保留当时的结论及反例；R5 在第三轮提交已关闭。

第二轮结论：`REQUEST_CHANGES`。提交 `1a543be023ede44a32d8afead02b67da355900e0` 已关闭初审 R1–R4，当时发现窄屏阅读回归 R5。

## 复审对象与原发现关闭情况

- 复审提交：[`1a543be023ede44a32d8afead02b67da355900e0`](https://github.com/qzhike/zhiju-business-core/commit/1a543be023ede44a32d8afead02b67da355900e0)，本地 HEAD 与远端一致。
- 审查初审后的七文件增量、Issue #286 最新正文与评论、受影响 UI01 Spec/Test、产品交互 §4.4 及精确提交 CI。初审依据及原始反例在下方保留。
- 独立预期仍为：桌面三栏受视口约束；窄屏可实际阅读和引用正文，并切换到同一意见区；候选到达保持当前输入但阻断旧版普通提交；显式切换回到变化详情；有效目录状态与筛选、计数一致。

| 初审发现 | 复审结果与独立证据 |
|---|---|
| R1 桌面工作区超出视口 | 关闭。1280×800、1440×900、1920×1080 下工作区 bottom 分别为 768.17、868.17、1048.17px，整页 scrollHeight 分别为 800、900、1080px；文件清单和正文仍可内部滚动。 |
| R2 新候选到达后旧版普通意见仍可提交 | 关闭。到达前普通提交可用，到达后禁用且没有请求生成，原草稿及第 2/36 处位置保留；显式切换后新版本可提交。附改稿但未声明基准时禁用，显式声明基准后保留既定建议例外。 |
| R3 显式切换未恢复变化详情 | 关闭。从全文切文件、从摘要切新版均回到变化详情，新版位置为第 1/1 处；返回旧文件/版本能读回原草稿。 |
| R4 批准后筛选使用旧状态 | 关闭。批准后 APPROVED=1/1、READY=1/1（无已批准文件），ALL=40/201；筛选先基于有效状态计算。 |

## R5 · P2 · 新高度约束把受支持窄屏的正文阅读栏压成零高度

位置：[`apps/workspace-web/src/style.css:523`](https://github.com/qzhike/zhiju-business-core/blob/1a543be023ede44a32d8afead02b67da355900e0/apps/workspace-web/src/style.css#L523-L525)，结合 `:10` 的固定剩余高度、`:555` 的 120px 文件列表行和 `.markdown-reader` 的 `overflow: hidden`。

复现：以 360×800 或 320×800 直接打开开发适配器 `/review-workspace`，保持默认“查看文档”。当前顶端偏移为 424.75px，工作区被约束为 355px；头部、视图切换和 120px 文件列表占用空间后，阅读栏只剩 2px 边框，`clientHeight=0`。360px 下变化导航从 y=889.20px 开始、正文从 y=1029.63px 开始，却被零高度阅读栏裁掉；320px 下同样 `clientHeight=0`。整页 scrollHeight 约 807px，普通整页滚动也不能取回被父容器裁掉的正文。独立截图确认默认文档视图只剩文件列表，看不到正文和变化导航。

原因是本轮将窄屏原来的 600px 最小高度改成 `min(600px, var(--review-space))`，同时保持桌面式剩余视口约束，没有处理窄屏多行头部与文件列表占满可用空间的情况。这是 R1 修复引入的交互回归，不是浏览器矩阵或真实服务尚未验收的边界。

Issue #286 第三项及 UI01 窄屏规则要求可在文档和同一意见区之间切换，支持实际阅读、引用与反馈。请在保留桌面三视口修复的同时，为窄屏阅读/导航分配可用空间，必要时调整窄屏头部、列表和滚动布局；不要仅以元素存在、`isVisible()` 或页面无横向溢出证明可读。补充 360×800、320×800 的正文实际可见、可滚动、可引用、前后导航可操作、切回意见仍保留输入的回归。当前旅程在这两个视口只检查横向宽度，未检查阅读栏被裁空。

## 复审验证与交接

- 已独立回读 [CI run 38676197965 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38676197965/attempts/1)：headSha 为 `1a543be023ede44a32d8afead02b67da355900e0`，select/checks/persistence/verify 全部 SUCCESS；复用当前 full 范围证据，不重复本地 code/full。CI 通过不覆盖 R5 的直接反例。
- `git diff --check 08b3fe57fc6cef5176295cfecc2222c6a6ad4183...HEAD` 通过。
- 本次更新的正式记录通过聚焦 Prettier 格式检查；未用 docs 目标覆盖累计代码 diff。
- Reviewer 在宿主 headless Chromium `156.0.8078.4`、同一 Vite fixture 与共享页面上，独立断言了上述四条关闭路径，并在批准窄屏视口测量及目视确认 R5。临时脚本/原始结果为 `/private/tmp/pr297-rereview-probe.mjs`、`/private/tmp/pr297-rereview-results.json`；合成截图为 `/private/tmp/pr297-rereview-360.png`、`/private/tmp/pr297-rereview-320.png`。本记录保留可复现步骤与实测数值，不依赖临时文件长期存在。
- 当前代码的构建后旅程由精确 CI 提供；本次 Reviewer 聚焦复现使用开发页面，不冒称新一次 built-browser 或完整浏览器矩阵验收。
- 真实服务器草稿/提交/回执/建议复核/批准、Runner、跨设备恢复、Windows/macOS Chrome/Edge 完整矩阵、生产和独立人工内容验收仍为 `NOT RUN`。
- Implementer 应在 #286 原范围修复 R5，取得新修订所需验证后再做独立 exact-head review。Reviewer 未修改产品代码；正式记录仍仅本地保存，未 commit/push，不授权合并。
- [复审 comment](https://github.com/qzhike/zhiju-business-core/pull/297#issuecomment-6184200831) 已发布并通过 GitHub API 回读确认，绑定上述 reviewed SHA；发布形式为 comment，不是 GitHub 正式 review。

以下为初审历史，结论和发现绑定初审提交，不代表 R1–R4 在复审提交仍未修复。

## 初审：审查对象与依据

- PR：[有界文档审查工作区与唯一意见区](https://github.com/qzhike/zhiju-business-core/pull/297)。
- 已审查提交：[`125b629d665e1b85a133a8772175668714c33620`](https://github.com/qzhike/zhiju-business-core/commit/125b629d665e1b85a133a8772175668714c33620)。
- Base：`08b3fe57fc6cef5176295cfecc2222c6a6ad4183`；审查开始时本地 HEAD 与 PR head 一致，工作区干净。
- 工作项：[Issue #286](https://github.com/qzhike/zhiju-business-core/issues/286)；依据 UI01 Spec/Test 的 #259、#279、#286 章节、Markdown 反馈设计 §4–§6，以及产品交互决定 §4.4。
- 独立预期：三栏完整落在可用视口内，长内容仅在各栏滚动；新候选保留原阅读上下文但阻止旧版普通修改；显式切换默认回到变化详情；目录筛选、分母与可见文件状态一致。真实服务尚未实现的能力允许明确不可用，不要求本 PR 实现后台业务。

## 初审：阻断发现

### R1 · P2 · 工作区高度未扣除实际页面头部，三栏超出桌面视口

位置：`apps/workspace-web/src/fixtures/review.tsx:527`；相关布局为 `apps/workspace-web/src/style.css:3`。

新页面在共享工作区前增加标题与说明，但工作区仍固定为 `100dvh - 130px`。独立 Chromium 在批准的 1440×900 视口测得：工作区 top=`300.171875`、height=`770`、bottom=`1070.171875`，文档 scrollHeight=`1102`。因此初始页面已经需要整页滚动，三栏底部约 170px 位于视口之外。现有浏览器用例只比较工作区自身 height 小于视口，没有验证 top + height。

这不满足 Issue #286 第一项固定高度三栏及内部滚动验收。应按 shell 和页面头部后的实际剩余空间分配高度，验证 1280×800、1440×900、1920×1080 下完整工作区均落在视口内，并保留各栏内部滚动。

### R2 · P2 · 已知新候选到达后仍可提交旧版本的普通意见

位置：`apps/workspace-web/src/MarkdownReviewPage.tsx:306`；开发 adapter 的候选与提交绑定位于 `apps/workspace-web/src/fixtures/review.tsx:585`、`:643`。

复现：在第 1 版填写普通意见，不附 Markdown 建议；触发“模拟本文件新候选到达”。页面正确保留第 1 版并显示新候选提示，但“提交并修改”仍可点击，点击后实际生成 `DEMO-REQUEST-1` 并进入 UNKNOWN。`canSubmit` 只检查 handler、已有提交和输入/基准，没有表达 viewed/current 不同的禁止条件；候选到达也未撤销该动作。

UI01 #259 第 3 条及 Markdown 反馈设计 §5 已明确：普通 edit 看旧版时新 current 到达，应为 STALE 并保留草稿，需显式切换核对后再提交。这里只要求页面和开发 adapter 如实呈现这个已知条件，不要求新增后端。应传入明确的提交资格/阻断原因，保留旧输入，覆盖“候选到达前可提交、到达后普通提交禁用、切换并核对后可继续”的正负用例，并保留旧基准建议的既定例外语义。

### R3 · P2 · 显式切换文件或版本没有恢复默认变化详情视图

位置：`apps/workspace-web/src/MarkdownReviewPage.tsx:192`；切换入口位于 `apps/workspace-web/src/fixtures/review.tsx:560`、`:590`。

复现一：选择“完整文件”，从目录切到“质量手册”；标题已变为质量手册，但“完整文件”仍为 `aria-pressed=true`，变化详情为 false。复现二：选择“摘要与依据”，触发新候选后显式切换第 2 版；页面仍停留摘要，变化详情为 false。共享组件的 tab/index 只在首次挂载初始化，文件/版本改变没有触发对应的阅读视图转换。

产品交互决定 §4.4 明确首次进入、切换文件、批准后进入下一份及查看其他版本均以变化详情为默认。应只在显式文件/精确版本切换时重置阅读视图及适用的当前位置，保留各文件/版本草稿；单纯候选到达不得触发该重置。

### R4 · P2 · 批准后的目录筛选仍按原始 READY 状态计算

位置：`apps/workspace-web/src/fixtures/review.tsx:383`。

`fixtureFileList` 先按常量目录的 `entry.state` 筛选，再在分页映射时把批准文件覆盖为 APPROVED。独立复现：批准预防措施程序并收到匹配成功回执后，选择“已批准”显示 `0 / 0` 且没有符合条件的文件；选择“待检查”却显示 `2 / 2`，其中包含标为“已批准”的预防措施程序。

这不满足 Issue #286 的状态筛选交互与目录真实性。应先计算当前有效状态，再对同一结果执行筛选、总数和分页，并回归批准前后 READY/APPROVED/ALL 的集合与分母。

## 初审：验证证据与边界

- 已独立回读 [CI run 38590812007 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38590812007/attempts/1)：headSha 精确为本次 reviewed SHA，`select`、`checks`、`persistence`、`verify` 全部 SUCCESS；覆盖当前变更所需 full 范围。本次未重复运行本地 code/full。
- `git diff --check 08b3fe57fc6cef5176295cfecc2222c6a6ad4183...HEAD` 通过。
- 新增正式记录的聚焦格式检查 `node node_modules/prettier/bin/prettier.cjs --check .vibe/reviews/pr-297/Review.md` 通过。另尝试 `vibe verify docs --json`：沙箱调用无输出后中止；宿主调用退出 21（verifier 退出 1），因累计 PR diff 包含前端代码而被文档范围保护明确拒绝，未计为 PASS，也未绕过范围保护重跑。该调用不是产品失败证据；已审查代码所需 full 证据仍为上面的精确 CI。
- Reviewer 于 2026-10-15 使用现有 Vite fixture 模式、同一共享页面与隔离 adapter，在宿主 headless Chromium `156.0.8078.4`、1440×900 完成上述四项聚焦复现；未修改产品代码。沙箱 Chromium 首次因 macOS MachPort 权限无法启动，宿主复现成功；不将启动失败误记为产品缺陷。
- 临时复现脚本和原始输出位于 `/private/tmp/pr297-review-probe.mjs` 与 `/private/tmp/pr297-review-probe-results.json`；上述步骤、实测数值和结果已保存在本正式记录中，不依赖临时文件长期存在。
- 本次聚焦复现使用开发页面，不声称新增 built-browser 或完整浏览器矩阵证据；当前提交的构建后旅程由上述 CI 证明。
- 真实服务器草稿/提交/回执/建议复核/批准、Runner、跨设备恢复、Windows/macOS Chrome/Edge 完整矩阵、生产和独立人工内容验收仍为 `NOT RUN`。这些不作为本次四项页面缺陷的替代解释，也不提升为额外实现范围。

## 初审：后续交接

Implementer 在 #286 的既定前端范围内修复 R1–R4，补充相应负向交互覆盖，取得新修订所需验证后重新申请独立 exact-head review。[审查 comment](https://github.com/qzhike/zhiju-business-core/pull/297#issuecomment-6183042754) 已发布并通过 GitHub API 回读确认。本记录与 comment 表达 Reviewer 的 `REQUEST_CHANGES` 结论，不表示已提交 GitHub 正式 review，不授权合并。正式记录当前仅本地落盘；未 commit、push 或修改产品实现。
