APPROVE — `60bf1bb0179aedbf8a0857018517bd365a40f25f` 的 R1、R2 已独立验证修复，未发现阻塞缺陷；同一 head 的完整 CI 已通过，本轮复审完成。下方保留此前修订的审查历史。

## 2026-10-15 用户请求的最新 head 复审

审查对象：[PR #298](https://github.com/qzhike/zhiju-business-core/pull/298)，head `60bf1bb0179aedbf8a0857018517bd365a40f25f`，base `08b3fe57fc6cef5176295cfecc2222c6a6ad4183`。重新读取最新 Issue #287、PR/comments、修复 diff、受影响 UI01 Spec/Test 及相关页面/adapter/测试；先前审查所依据的 D12 精确引用、原意图和下载事实约束继续适用。

- R1 已修复：恢复 receipt 与 intent 存在 provider 的内存会话中，页面重挂载恢复原锁；read 校验原 id、checkToken 与 selectionKey。UNKNOWN 导航返回可查询原意图，确认调用仍为一次。
- R2 已修复：adapter 将供应的下载观察追加至同一包的 downloads，页面合并时按 observation id 去重；五类供应观察导航返回后仍存在，固定成员不变。
- 本轮独立运行 `tests/workspace/delivery.spec.ts` 的全部 7 项非 production 用例，受控 Chromium `156.0.8078.4`，**7 passed / 15.7s / exit 0**。运行方式为当前源码的本机 Vite fixture server + Playwright；包括两条导航返回回归、资格/配套失效、UNKNOWN、固定 ZIP、下载观察、失权/迟到回执、200 文件、视口、键盘与 axe。此证据是 focused development-browser 验证，不冒充新执行的 production build 或完整 configured target。
- `0181999..60bf1bb` 仅追加正式审查文档；本轮仍独立检查当前代码及测试，不把此前 Reviewer 的 APPROVE 当作本轮结果。
- 当前完整 PR 含 App.tsx、TrustedApp.tsx 及新增页面等 full 路径，按验证基准 §2.1.1 保留完整 CI Gate。用户通知 CI 已完成后，本轮读取 [run 38690448023 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38690448023) 的最终结果，并确认 PR head 仍为 `60bf1bb0179aedbf8a0857018517bd365a40f25f`：整体 COMPLETED / SUCCESS，select SUCCESS、[checks SUCCESS](https://github.com/qzhike/zhiju-business-core/actions/runs/38690448023/job/116275093247)、[persistence SUCCESS](https://github.com/qzhike/zhiju-business-core/actions/runs/38690448023/job/116275093138)、[verify SUCCESS](https://github.com/qzhike/zhiju-business-core/actions/runs/38690448023/job/116288462057)。Verify code 与 Verify persistence 步骤均实际成功执行，汇总于 `2026-10-15T06:49:19Z` 完成；当前修订所需完整 CI 证据已齐备，复用此证据，不重复运行本地 full。
- 监测历史保留：此前 waiter job `54f6d483bef9baa6514a3a54` / event `43c2e5d4-f526-4bdc-83c7-54260521c7e7`（原 session `01a13e0f-43b1-73c3-9531-77f431750840`）以 `monitor_error: GitHub read timed out` 结束且已 ACK。当时一次核对仍为 persistence IN_PROGRESS；该事件没有被用作 CI 完成证据，也未重启同一事件的 waiter。本轮成功结论来自随后用户明确通知后的最终 GitHub 结果。
- 真实 D12 服务、发布授权、受控归档/下载传输、Runner、生产与跨设备、完整 Windows/macOS Chrome/Edge 矩阵及独立人工验收仍 NOT RUN。focused 页面测试不构成持久化证据。
- 本轮仅更新正式审查记录与授权的 PR comment，不修改实现、不 commit/push/merge。
- 最终结论 `APPROVE` 仅绑定上述已审查 SHA 与 Issue #287 的页面工程范围。PR 读取时仍为 Draft；后续进入交付流程须满足正式文档交付及适用人类门禁，任何新 head 均须重新核对变更与证据。本结论不授权 merge 或宣告真实业务人工验收完成。

---

以下为先前修订的审查历史。

APPROVE — 2026-10-15 对 `0181999219dcdee2cf8b1e846675770836189473` 的独立复审确认 R1、R2 已修复，当前 Draft 阶段未发现阻塞问题；本结论不将 full / Ready / Delivery 门禁记为通过。下方完整保留 REQUEST_CHANGES 与旧 APPROVE 历史。

## 2026-10-15 R1 / R2 修复独立复审

审查对象：[PR #298](https://github.com/qzhike/zhiju-business-core/pull/298)，完整 SHA `0181999219dcdee2cf8b1e846675770836189473`，关联 [Issue #287](https://github.com/qzhike/zhiju-business-core/issues/287)。`vibe repo --json` 与本轮 GitHub 读回的 PR head 一致，PR 仍为 Draft。先读取最新 [REQUEST_CHANGES comment](https://github.com/qzhike/zhiju-business-core/pull/298#issuecomment-6185339833)、Issue、UI01 Spec/Test 与既有 D12 原意图/下载事实约束，再检查修复 diff 及相关实现、回归断言；未依据 Implementer 的修复说明直接认可结果。

### R1：原意图导航恢复已满足

`FixtureDeliveryProvider` 在当前内存会话保存 receipt 与原 intents；共享 `DeliveryPage` 接收类型化 recovery 输入，重挂载时从同一 receipt 初始化显示与 confirmation lock。导航返回后可查询原意图，未核实原请求时不能再次确认。adapter 的只读恢复按同一 intent id 查找，继续同时验证原 checkToken 与 selectionKey；后者包含 Project、context、接收范围及精确文件/Revision/资格观察/来源。页面接收回执时仍使用 matchingReceipt 核对原 id、checkToken、exact members 与固定包成员，不以 read 替代成新的 confirm。

新 built-browser 回归先确认 UNKNOWN，明确等待工作台可见及交付页卸载后再返回，比较原回执，检查确认入口禁用、同一 intent 回读、固定包 URL 与原 CORR-REV-01 成员，确认调用仍为一次。该测试针对原反例补齐了此前遗漏的路由卸载边界。

访问 EXPIRED / UNAVAILABLE 或恢复输入与当前 Project/context/接收范围不匹配时，恢复 receipt 清空；workspace key 随该范围变化而重挂载。既有 alive 与 request generation 防护仍约束迟到确认/回读，旧页面卸载后不会重新写入 recovery。已检查既有 access-expiration / late-receipt 回归仍覆盖清空与忽略迟到回执；未把静态 Scope 分支检查冒充真实 Session/跨 Scope 服务验收。

### R2：同包下载观察导航保留已满足

开发 adapter 将每条已供应的 DownloadFact 写回同一 package 的内存 downloads，以 observation id 防止重复；共享详情将 package 已保存观察与本地返回观察按同一 id 合并。更新仅追加下载事实，不修改原包成员、Revision、来源或引入保存/发送/收件成功标记。显式供应的 UNKNOWN 与 REQUESTED、FAILED、RESPONSE_STARTED、RESPONSE_SENT 分别保留。

新 built-browser 回归对五类观察逐次下载并离开到工作台，等待卸载后返回相同 package URL；每次检查累计记录数及全部已供应状态仍存在。REQUESTED 路径实际捕获合成 ZIP download 事件；返回前后计数一致，也覆盖同一观察同时存在于 provider 与页面时不重复显示。真实受控下载或跨设备恢复没有因此被宣告实现。

### 当前证据与交接

- 原会话转交的实际 `vibe verify code --json` 执行证据绑定本次提交内容，提交前无后续实现变化：session `60944` / chunk `023960`，PASS、exit `0`；127 files / 2712 tests、6 production checks + 43 fixture browser journeys 全部通过，包括上述两条卸载返回回归。复用该可信证据，未重复运行 configured target。
- 独立检查了完整修复 diff、当前 matchingReceipt / selectionKey、原请求锁、失效及迟到回执保护、同包观察合并与配套 UI01 Spec/Test 更新。修复限于既有页面/内存 adapter 与接受集，无新公开 Contract、业务 API、权限、浏览器持久存储或持久化变化；未发现新增阻塞问题。
- 本轮仅更新本正式 review，完整保留下方历史；未修改产品代码、commit、push、发布 GitHub review 或启动/轮询 CI waiter。远端 CI 与 full 证据由原会话继续处理，历史运行不作为新 SHA 的 full PASS。
- 当前结论为 `APPROVE`，绑定 `0181999219dcdee2cf8b1e846675770836189473` 的 Draft 实现审查。进入 Ready / Delivery 前仍须满足最终 SHA 的 full 与必需远端检查；本结论不授权 merge。真实 D12 服务、发布授权、受控归档/下载传输、Runner、持久化、跨设备、完整 Windows/macOS Chrome/Edge 矩阵及独立人工验收仍为 **NOT RUN**。

---

以下为完整保留的历史审查；当前结论以上方精确修订复审为准。

REQUEST_CHANGES — 2026-10-15 对 `b8a879150bca12e97b2beaf1a56b20adee16bfe4` 的独立复审发现两项同标签页导航恢复缺陷；须修复后复审新 head。下方保留先前审查作为历史记录。

## 2026-10-15 当前 head 独立复审

审查对象：[PR #298](https://github.com/qzhike/zhiju-business-core/pull/298)，完整 SHA `b8a879150bca12e97b2beaf1a56b20adee16bfe4`，关联 [Issue #287](https://github.com/qzhike/zhiju-business-core/issues/287)。先依据 Issue、UI01 Spec/Test、已批准 D12 设计及工程基线重建预期，再检查完整 diff、页面/模型/adapter/浏览器断言。当前结论为 `REQUEST_CHANGES`；先前的 APPROVE 不覆盖本次已复现反例。

### R1 / P2：离开页面后无法恢复 UNKNOWN 原意图

位置：`apps/workspace-web/src/delivery/Page.tsx:95`、`:100`；`apps/workspace-web/src/fixtures/delivery.tsx:60`。

复现：开发场景设置确认回执为 UNKNOWN，选中纠正措施程序并确认；出现原意图 `10c16eb1-5cbd-4451-9729-e8181205d650`。点击“返回工作台”，等待交付页卸载，再浏览器后退。原回执和“查询原生成意图”入口消失；重新选择同一文件可以确认，并产生新意图 `dc6e66a7-b5df-4129-af6b-711fcfd4df99` 和新包。

原因：receipt 与 locked 仅保存在路由页面的 state/ref，卸载即丢失；provider 虽保留 intents，页面没有发现或重新挂接它们的输入/入口。原请求尚未核实时，正常应用导航使恢复路径消失，用户只能开始新的意图。违反 Issue #287 的原意图恢复要求及 D12 §4 的 UNKNOWN 回读原请求约束。

修复要求：在当前授权范围的内存 adapter/controller 中保留可恢复意图，并允许页面返回后挂接和查询同一 id、checkToken、精确成员；不得通过重新确认替代恢复。保持 Session/Scope 清理与迟到回执防护。增加 UNKNOWN → 工作台 → 返回 → 查询原意图的浏览器反例，确认无第二次 confirm。此要求不新增浏览器持久存储、真实 API 或跨设备恢复。

### R2 / P2：下载观察在普通导航后丢失

位置：`apps/workspace-web/src/delivery/Page.tsx:98`；`apps/workspace-web/src/fixtures/delivery.tsx:168`。

复现：生成合成包并点击“下载合成示例包 .zip”，实际捕获下载事件，详情显示“下载记录 · 1 / 已请求下载，保存情况未知”。点击“返回工作台”，等待卸载，再后退到同一 package URL；固定包仍在，但变成“下载记录 · 0 / 尚无可核实的下载记录”。

原因：download 返回的观察只进入页面 downloads state，adapter 未将其写回同一内存 package 的 downloads。普通导航保留包却丢失已经供应的观察，不能满足 Issue #287 的包/下载记录查看及 UI01 #287 固定包与下载接受集。

修复要求：将适配器供应的下载观察保留在同一包的内存读模型中，返回详情时读回并按观察 id 去重；加入“下载 → 离开 → 同包详情返回”的测试。继续区分 REQUESTED、UNKNOWN、响应观察与失败，不推导保存或发送成功。

### 本次证据与边界

- 两项反例均在上述未修改的代码 head、本机 Vite fixture 模式、1440×900 受控 Chromium 中独立执行；探针明确等待交付页卸载，退出码为 0。不是静态推测，也不是完整 built-browser/configured target 的重跑。
- 沙箱 Chromium 首次启动被 macOS MachPort 权限拒绝；经宿主执行机制完成定向验证。较早探针的定位器/导航等待问题已修正，未将其失败当作产品证据。
- 本轮读取的当前 head CI [run 38687485397](https://github.com/qzhike/zhiju-business-core/actions/runs/38687485397) 快照为 select SUCCESS、checks/persistence IN_PROGRESS；没有据此声明 full PASS。已确认的实现缺陷无需等待 CI 才反馈。
- 既有测试只验证页面保持挂载时的原意图/下载状态，没有覆盖上述离开页面后的恢复。此前 code PASS 和历史 APPROVE 不消除这两个反例。
- 真实 D12 服务、发布授权、受控归档/下载传输、Runner、持久化、跨设备、完整 Windows/macOS Chrome/Edge 矩阵及独立人工验收仍为 NOT RUN。
- 本轮仅更新正式审查文档并按用户授权提交 PR comment；不修改产品实现，不 commit、push 或 merge。Implementer 修复并补回归后，应取得适用配置验证证据并重新审查新 head。

---

历史结论：APPROVE — 当时针对 `6da87a7f718add4213dadc3d63f15187a4ce97c9` 的 Draft 页面审查，原文如下；当前结论以上方复审为准。

# PR #298 独立实现审查

## 审查对象与边界

- 工作项：[Issue #287](https://github.com/qzhike/zhiju-business-core/issues/287)。
- 提议修订：[PR #298](https://github.com/qzhike/zhiju-business-core/pull/298)，审查 SHA `6da87a7f718add4213dadc3d63f15187a4ce97c9`。
- 对比基线：`08b3fe57fc6cef5176295cfecc2222c6a6ad4183`。
- 角色：独立 Reviewer；不修改产品实现，不提交、推送或合并。
- 审查结论：`APPROVE`，绑定上述精确 SHA 与当前 Draft 阶段要求的 `code` 证据。`full` 仍待完成，PR 进入 Ready / Delivery 前必须另行满足。

本次先从 Issue 的 Goal / Acceptance / Scope / Verify、已批准的 [D12 交付设计](../../decisions/project-delivery-controlled-export.md)、[UI01 规格](../../module-specs/Module-Spec-UI01-WorkspaceUI.md)及[工程基线](../../decisions/workspace-ui-engineering-baseline.md)重建行为预期，再检查实际 diff、页面、局部模型、隔离 adapter 与测试。远端 head/base 与 `vibe repo --json` 所示本地 SHA 一致。

## 验收与实现检查

| 边界 | 独立检查结果 |
|---|---|
| 跨轮次清单与资格 | 共用页面按体系章节组织文件，默认无选择，提供搜索/资格筛选；行内显示 Revision、轮次、报告版本及等待原因，内部批准不等于可交付。 |
| 精确选择与单次核对 | 内存选择保留 exact Revision、资格观察 key、项目/计划/接收范围及来源；缺失、重复、替换、失权或 PARTIAL/STALE 均阻断。弹窗保留打开时的版本，其他有效选择保留；配套要求由 adapter 提供，页面不计算发布策略或传递闭包。 |
| 原意图与状态真实性 | 显式确认锁定唯一 intent；pending、CONFIRMED、GENERATING、UNKNOWN、REJECTED、FAILED 与 PACKAGE_READY 分开呈现。回读使用同一 intent，校验 intent/check/精确成员；错回执不晋升成功，迟到回执受 generation 与卸载保护。 |
| 固定包与下载观察 | 包详情使用真实路由查询参数，保留成员、版本与来源。后续候选不替换原包。下载展示可用、过期、不可用、失败及请求/响应观察，不推导本地保存、发送、收件、验收或项目完成。开发 ZIP 明确标为合成。 |
| 上下文、键盘与响应式 | 数据更新保留搜索、选择和弹窗；过期入口卸载敏感页面，恢复后从空选择开始。Radix Dialog 承担焦点圈定/Escape/回焦；桌面为有界清单/详情，窄屏支持查看和包详情，确认提示不替代服务端授权。 |
| 生产隔离与范围 | TrustedApp 接入同一共享页面的 UNAVAILABLE 边界；fixture lazy imports 置于编译常量分支。未新增业务 API、策略、权限、持久化、D12 handler 或真实下载 transport，未修改 #279 单文件下载。 |
| 持久知识 | UI01 Spec/Test 追加页面工程边界及接受集，保留真实 D12 / Runtime / 平台矩阵 / 人工接受的 NOT RUN。未改变已批准产品布局、模块所有权或 Core 契约。 |

已读取全部提议变更，包括 `src/delivery/Page.tsx`、`model.ts`、样例 adapter、CSS、App/TrustedApp 接入、focused unit/browser 用例及 UI01/README 增量。未发现需要修复的阻塞 correctness、contract、scope、安全或可靠性问题。

## 验证证据与门禁边界

- 原会话转交了本地实际工具执行结果，绑定本次 SHA：`functions.exec` session `88216` / chunk `056032`，exit `0`；最终原始 JSON 为 `{"status":"PASS","target":"code","command":"pnpm clean && pnpm verify:code","exit_code":0}`。普通 Vitest 为 127 files / 2712 tests PASS，built browser 为 6 production checks + 41 fixture journeys PASS；Web/BFF independent builds、production rejection、fixture browser、architecture boundaries（12 source roots）、public API generation 与 catalog/registry（247 operations）均 PASS。这是执行结果转交，不只引用 PR 描述。
- 原会话在 waiter monitor error 后取得的精确远端快照提供独立佐证：[run 38686826350 / attempt 1 的 checks job](https://github.com/qzhike/zhiju-business-core/actions/runs/38686826350/job/116263555238)在 `2026-10-15T05:31:48Z` 完成 Verify code，结果 success；snapshot 的 head 为 `6da87a7f718add4213dadc3d63f15187a4ce97c9`，select 为 success，persistence 仍 in_progress，整体无 conclusion。未将该快照表述为完整 CI PASS。
- 已独立检查模型与 built-browser 断言：缺配套、版本/资格变化、部分/陈旧读取、UNKNOWN 与原意图恢复、错回执、迟到回执、访问失效、固定 ZIP、下载失败/过期、200 项、键盘焦点及 production pruning 均有具体断言。未重复运行已有 configured target。
- 已目视检查本地 `test-results/delivery-1280.png` 与 `test-results/delivery-320.png`：有界章节清单、内部滚动、无横向溢出及窄屏查看/桌面确认提示符合本工作项要求。截图属于受控开发制品证据，不是完整平台或人工业务接受。
- Issue #287 明确允许当前 bounded、无持久化实现的 Draft 阶段使用 `code`，并要求 ready 前 `full`。本次 diff 含 App/TrustedApp 等默认 full 路径，完整远端 full 路由应继续执行；这不抹除 Issue 已明确的 Draft 本地交接要求。当前 `code` 执行证据足以支持本页面实现审查，未发现需要额外 persistence 语义取证才能判断的业务/数据库变更；不把后续 Ready / Delivery 门禁升级为当前审查的额外语义阻塞。
- `full`、全部必需远端检查、Ready / Delivery 仍未通过。原会话收到 waiter job `ad9ddb052c534bff686f232d` / event `5caacfe7-55e0-4195-b3b2-96b3bdf64c60` 的 `monitor_error=GitHub read timed out` 并 ACK；该事件不是 CI 完成或成功。独立 Reviewer 未注册第二个 CI waiter，也未轮询远端 CI。
- 真实 D12 服务、发布授权、受控 archive/下载 transport、Runner、持久化、跨设备恢复、Windows/macOS 最近两个 Chrome/Edge 稳定版本的完整矩阵与独立 Human 验收：**NOT RUN**。这些不是本页面工程范围已完成的事实。

## 后续交接

独立实现审查已完成，交回原会话继续现有 full / Ready / Delivery 门禁。进入 Ready 前须取得同一最终 SHA 的完整 full 与必需远端检查通过证据；本次 APPROVE 不代替该证据。任何后续修改均须重新审查新 head；本记录不授权 merge。
