APPROVE。最终实现修订 `1d5d145e1366d900860c7ad268617968ceff3d6d` 无剩余代码阻断，exact-head CI 全部通过；用户于 2026-10-21 明确表示“手动测试暂时批准通过，可合并PR并关闭issue及local/remote pr”，据此接受本次 U2 模拟 UI 切片并授权交付清理。

## 最终交付与批准边界（2026-10-21）

- 最终 head 与已复审修订一致；R5–R7 均关闭。[CI run 39599484524 / attempt 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39599484524/attempts/2) 的 checks、三个 persistence gate、persistence 汇总及 verify 全部成功，未重复运行本地 full。
- 用户的暂时批准及交付授权已记录在 [PR 评论](https://github.com/qzhike/zhiju-business-core/pull/307#issuecomment-6317000947)。这是用户对当前切片的接受决定，不补造逐项人工执行结果。用户反馈 U1 分析演示控制难以找到；已在下方客户补充面板展开并定位，未因此修改产品代码。
- [PR #307](https://github.com/qzhike/zhiju-business-core/pull/307) 已合入 `main@845c75e67f6f43e3242c20ac5c4c46667890076b`；[#306](https://github.com/qzhike/zhiju-business-core/issues/306) 已自动关闭为 COMPLETED。本节为合并后的文档收口，不改变已验证实现。
- 私有原文逐字内容试走未收到单独完成结果，仍为 `NOT RUN`；本次按用户明确的暂时批准关闭切片，不把该缺失证据记为 PASS。真实 Runner／服务器状态、持久化与跨设备恢复、完整平台矩阵、U3 及整体 U1–U3 验收继续保留各自未运行边界。
- 后续先基于合并后的 main 准备 U3 的返工、恢复与交付旅程，重新核对依赖及 NOW + READY；不因 U2 合并宣称整体 UI 阶段完成，不提前冻结后端设计。

---

## 合并前 CI 收口记录（历史）

HUMAN_REVIEW_REQUIRED。PR #307 head `1d5d145e1366d900860c7ad268617968ceff3d6d` 的代码复审无剩余阻断，R5–R7 已关闭；同一 head 的 CI run 39599484524 attempt 2 全部通过。以下保留用户批准前的门禁快照，最终决定以上文为准。

# 当前复审（1d5d145，2026-10-21）

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，关联 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`1d5d145e1366d900860c7ad268617968ceff3d6d`；上一轮已发布审查：`0b2a42e233380eceb6c4ced95b593c82c3752969`。
- Base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`。
- 已审全部修复增量：U2 adapter、draft 模型及模型／浏览器回归、正式审查记录。验收范围及 owning Spec/Test 要求沿用前轮，Issue 无新增评论或范围变更。

## R7 残留已关闭

[`submitRevision`](https://github.com/qzhike/zhiju-business-core/blob/1d5d145e1366d900860c7ad268617968ceff3d6d/apps/workspace-web/src/fixtures/u2.tsx#L832) 在保存未决时直接返回；[`submitBlocked`](https://github.com/qzhike/zhiju-business-core/blob/1d5d145e1366d900860c7ad268617968ceff3d6d/apps/workspace-web/src/fixtures/u2.tsx#L1319) 同时禁用共享提交按钮并指引查询原保存请求。两个入口均用 `draftSaveUnresolved` 识别 SAVING/UNKNOWN，未决保存不会再进入覆盖 draft 的修订成功／失败分支。

新增浏览器回归覆盖上轮反例：保存未决 → 编辑 → 提交禁用 → 导航往返 → 原保存回执 → 新文本 UNSAVED → 修订成功／失败历史及后续新保存。模型断言补充未决判定。本轮没有修改产品代码或永久测试。

独立浏览器诊断四组均通过：

| 原保存状态 | 收敛后的修订结果 | 原请求、导航及提交验证 |
|---|---|---|
| SAVING | RECEIVED | PASS |
| SAVING | FAILED | PASS |
| UNKNOWN | RECEIVED | PASS |
| UNKNOWN | FAILED | PASS |

各组均核对：未决时提交和保存禁用；编辑和概览／审阅往返保持同一 `U2-SAVE-*`；匹配原回执后新文本仍为 UNSAVED；随后提交保留文本及结果；原请求收敛后才允许新保存 ID。原 [R7 P2](https://github.com/qzhike/zhiju-business-core/pull/307#discussion_r4336686872) 已关闭。R5/R6 相关守卫未在本轮改动，既有复核结论保持，未发现新增代码阻断。

## 验证与未完成项

- 当前未修改源码上的独立 Playwright focused UI diagnostic 4/4 PASS；增量 `git diff --check` PASS。
- 保留工作区原有 package.json/lockfile 改动；focused 结果不冒充 exact-head 完整构建／full Gate。未重复运行活动 CI 正在覆盖的 full 目标。
- [CI run 39599484524 / attempt 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39599484524/attempts/2) head 为本轮 SHA，最终 completed / success；select、checks、persistence-1/2/3 gate、persistence 汇总和 verify 全部 success，当前 head 的 full 所需 CI 证据齐全。此前 attempt 1 待结果快照由此取代，不声称 attempt 1 通过。PR 正文所列 `4fef41a` CI 与 `5d0081d` 本地 full 仍仅为旧证据。
- 外部等待器只读诊断：沙箱拒绝 Desktop IPC 后按规则在主机重试，返回 `codex_runtime_unavailable`，当前原会话无受支持 live owner。没有注册 waiter，没有创建／恢复其他会话，没有模型轮询 CI。用户随后告知 CI 已完成，本轮按其状态请求核对了最终 attempt 2 结果；未通过等待器接收自动事件。
- #306 必需的用户实际 U2 试走／反馈和私有内容试走仍 NOT RUN，不能以自动化替代；真实 Runner／服务器／持久化恢复及 U3 保持范围外未运行。
- 本轮[COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/307#pullrequestreview-5599643726) 已发布并回读，绑定本轮 SHA；只有正式审查记录本地更新及用户授权的 COMMENT 发布；未 commit/push/merge/关闭 Issue。技术审查与 CI 已通过，最终角色结论为 HUMAN_REVIEW_REQUIRED，原因是明确要求的 U2 人工验收尚缺证据；不构成合并授权。

CI 收口 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/307#pullrequestreview-5600114569) 已发布并回读，绑定当前 head。

下一步：由用户完成／提供 U2 桌面实际试走反馈，并记录私有内容试走的脱敏证据及 tested SHA，再收口 #306 的人工验收。没有新的代码修复要求，R7 不再需要按旧反例继续修复。

---

# 先前审查历史（结论限各自 SHA）

APPROVE（R7 提交交叉路径关闭）。当前 reviewed SHA `2b11408692fedc4ffe160129fc7465b793c34adc`（base 仍为 `eb5b2c516feb49ccdafa0c42389e0c4b32396d44`，审查日期 2026-10-21）：上一轮 `0b2a42e` 的 R7 P2（保存未决时提交修改会丢失原保存请求）已关闭；focused 浏览器 3/3、模型 15/15 通过；R5/R6 继续关闭，无剩余代码阻断。exact-head CI 在本轮审查时尚未出结论；U2 用户实际试走、私有内容试走、真实 Runner/服务器、重启/跨设备与 U3 仍为 `NOT RUN`。此前各轮保留为历史。

# 当前独立审查（2b11408，2026-10-21）

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，任务 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`2b11408692fedc4ffe160129fc7465b793c34adc`；上一轮 `0b2a42e233380eceb6c4ced95b593c82c3752969`。
- PR 当前 base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`；本轮产品/测试增量 `0b2a42e..2b11408`，4 个文件：`u2.tsx`、`review-model.ts`、`review-model.test.ts`、`u2-journey.spec.ts`。
- 重点：重跑 SAVING/UNKNOWN 保存未决 → 编辑 → 提交修改的交叉反例，确认原保存请求不被修订提交覆盖。

## R7 关闭

- [`draftSaveUnresolved`](https://github.com/qzhike/zhiju-business-core/blob/2b11408692fedc4ffe160129fc7465b793c34adc/apps/workspace-web/src/mvp/review-model.ts#L432) 统一识别 SAVING/UNKNOWN；`saveDraft`、`applySaveReceipt`、保存回执控件和显式重绑定都使用该判定。
- [u2.tsx:832–836](https://github.com/qzhike/zhiju-business-core/blob/2b11408692fedc4ffe160129fc7465b793c34adc/apps/workspace-web/src/fixtures/u2.tsx#L832) 的 `submitRevision` 在保存未决时直接返回；[submitBlocked](https://github.com/qzhike/zhiju-business-core/blob/2b11408692fedc4ffe160129fc7465b793c34adc/apps/workspace-web/src/fixtures/u2.tsx#L1319) 显示“当前范围的意见仍在等待原保存请求回执；请先查询原保存请求，再提交修改。”，共享页提交按钮因此禁用。
- FAILED 修订分支保留 `requestLabel`/`savedText`（[u2.tsx:905–912](https://github.com/qzhike/zhiju-business-core/blob/2b11408692fedc4ffe160129fc7465b793c34adc/apps/workspace-web/src/fixtures/u2.tsx#L905)），原保存请求不会被修订成功或失败分支静默替换；新保存请求只在原请求收敛后生成。
- 新浏览器回归 [u2-journey.spec.ts:391](https://github.com/qzhike/zhiju-business-core/blob/2b11408692fedc4ffe160129fc7465b793c34adc/tests/workspace/u2-journey.spec.ts#L391) 覆盖：SAVING 保存 A → 编辑 B → 提交禁用；SAVED 回执 → UNSAVED → FAILED 修订保留历史；再次保存得到不同 `U2-SAVE-*`；UNKNOWN → 编辑 → 提交禁用 → 导航往返 → 原回执 SAVED → 编辑文本提交成功。focused 运行通过。
- 独立反例（上一轮会丢失原保存请求）现在保持提交禁用；保存回执控件仍只收敛当前范围的原请求，原 `requestLabel`/`savedText` 在编辑和提交被阻止期间保留。R7 关闭。

## R5/R6/P3 状态

- R5 的定稿查询 active 检查、R6 的 basis 保留/显式重绑定、9f2c445 的按范围保存回执控件均未改变，上一轮结论继续适用；本轮 focused 3/3 覆盖对应路径。
- 未发现新的 P2/P3 阻断。

## 本轮验证证据与边界

- Focused browser：`unresolved save requests block revision submission...`、`save, submission and finalization recovery...`、`stage draft keeps...` 3/3 passed；模型 `review-model.test.ts` 15/15 passed。作者报告 U2 非 production 8/8、typecheck/lint pass 作为补充。
- 独立反例使用 fixture 构建与 reviewed SHA 源码；编辑/提交/导航均走实际页面，不读取或输出客户原文、私有路径或截图。
- 作者报告的 `vibe verify full --json` PASS 仍记录在父修订 `5d0081d`，不是 `2b11408` 的 exact-head 结果；本轮未重跑 full。
- Exact-head CI：[run 39599235928](https://github.com/qzhike/zhiju-business-core/actions/runs/39599235928)（`headSha=2b11408...`）：审查时 `select` success，`checks`/persistence 仍 IN_PROGRESS，尚无 verify 汇总；合并前须等待该 exact SHA 的 required CI。
- **NOT RUN（不得由自动化或本文件代替）**：用户实际 U2 试走与反馈（UI-MVP-U2-008）；私有客户/模板原文逐字试走；真实 Runner 调用/输出；真实服务器草稿/保存/定稿；重启与跨设备恢复；U3 交付；完整平台矩阵。

## 交接

代码审查在 `2b11408` 给出 `APPROVE`：R7 提交交叉路径已关闭，R5/R6 与 P3 继续关闭，未发现剩余代码阻断项。合并前的硬门禁仍是 exact-head CI 全绿及用户实际 U2 试走/脱敏反馈；私有内容逐字试走、真实 Runner/服务器、重启/跨设备与 U3 继续分别 `NOT RUN`。本轮只更新本审查文件，不修改产品代码，不 commit/push/merge。

# 上一轮独立复审（0b2a42e，历史）

以下为 `0b2a42e` 的审查；其中 R7 P2 已由 `2b11408` 关闭，保留作历史。

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，关联 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`0b2a42e233380eceb6c4ced95b593c82c3752969`；上一轮已发布审查 SHA：`8bb5d066f12f5afed5d4175cdd1899309db8a98e`。
- PR base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`。
- 已核查上一轮至当前 head 的全部修复增量：U2 adapter、draft 模型、共享保存按钮、模型／浏览器回归、UI Test 矩阵与正式审查记录；按原 Issue 与 U2 Spec 的原依据／原请求约束独立判断，不以既有 APPROVE 为通过依据。

## R5 关闭：定稿查询不再越过未决修改

`queryFinalization` 接纳回执前检查项目范围内的 active submission。独立浏览器复现原顺序：定稿 PENDING → 修改 UNKNOWN → 定稿回执到达 → 查询；结果块数量为 0，出现未决修改阻断说明。`activeSubmission` 同时覆盖 PENDING/UNKNOWN；新增浏览器回归覆盖原 UNKNOWN 反例。

## R6 关闭：项目／阶段草稿保留原依据

`draftAfterEditInPlace` 保留既有 basis，`draftBasisChanged` 阻止旧依据提交；显式重绑提供独立动作。独立浏览器分别验证项目与阶段范围：V1 保存 → 文件意见产生 V2 → 切换 V2 → 返回原范围并编辑，提交保持禁用；显式重绑后才启用。新增正式浏览器回归覆盖阶段范围及编辑后仍阻止提交，模型检查覆盖原 basis 保留。

## R7 仍有 P2：提交修改会丢失未决保存请求

位置：[u2.tsx:913](https://github.com/qzhike/zhiju-business-core/blob/0b2a42e233380eceb6c4ced95b593c82c3752969/apps/workspace-web/src/fixtures/u2.tsx#L913)，关联 `submitRevision` 与按当前 draft 查找保存请求的 `applySaveReceipt`。

已修复的部分：UNKNOWN 时保存禁用；编辑保留原 requestLabel/savedText/basis；原 SAVED 回执到达后，新文本标为 UNSAVED。独立浏览器确认这条直接恢复路径成立。

残留反例（SAVING 和 UNKNOWN 两种状态均已独立复现）：

1. 保存文本 A，保留未决 `U2-SAVE-*` 请求。
2. 输入文本 B 并点击仍可用的“提交并修改”。
3. draft 被整体替换为 EMPTY，原保存请求从页面和唯一保存状态载体消失；“模拟当前范围原保存回执到达/查询”禁用。修订历史只有 B 和新 `U2-REV`，没有 A 的保存请求及其依据。
4. 输入文本 C 并保存，得到另一 `U2-SAVE-*`，原请求从未收敛。

原因：未决保存意图只存在于被覆盖的 draft 字段中；`submitRevision` 不检查保存未决状态，在成功／未决修改分支清空该 draft，FAILED 分支同样不保留保存意图。这绕过新增的 UNKNOWN 禁重存保护，违反 #306 和 U2 Spec 边界 7 的原请求恢复要求。

修复要求：将未决保存请求及冻结的文本／scope／basis 与可编辑／提交的草稿独立保留，或在保存收敛前明确阻止修订提交并提供原请求恢复动作。补 SAVING/UNKNOWN → 编辑 → 提交 → 导航／原请求恢复／再次保存的浏览器回归，覆盖修订提交成功与失败。未决保存不得因另一个动作静默丢失或被新请求替代。

## 证据与交接

- 独立 Playwright 浏览器诊断在临时本机 fixture 服务上执行，读取当前 head 未修改的产品源码；R5、项目／阶段 R6 及 R7 直接恢复获得预期结果，R7 的两种提交交叉路径均复现缺陷。
- 本机 package.json/lockfile 仍有原有改动，未修改或纳入本轮审查；focused 反例不冒充 exact-head full/build 证书。增量 `git diff --check` 通过。
- 当前 head 的 [CI run 39596496692](https://github.com/qzhike/zhiju-business-core/actions/runs/39596496692)：审查快照 select/checks success，persistence 三分片仍运行；不得用 PR 正文中的 `4fef41a` 旧 run 认定当前 full PASS。pending CI 不是失败；已有明确 P2，无须等待 CI 才交回实现者。
- 用户实际 U2 试走／反馈与私有内容试走仍 NOT RUN，须与自动化分开；真实 Runner／服务器／持久化恢复与 U3 非本批范围，不要求在本轮修复中扩展。
- 本轮仅更新本正式记录并按用户授权发布 comments；无产品代码修改，无 commit/push/merge/Issue closure。记录尚未 commit/push。[本轮 COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/307#pullrequestreview-5599531290) 及 [R7 行内评论](https://github.com/qzhike/zhiju-business-core/pull/307#discussion_r4336686872) 已发布并回读，绑定本轮 SHA。

下一步：实现者修复 R7 残留交互、补回归，提供新 head 的适用验证并重新复审。本结论不授权合并。

---

# 先前审查历史

APPROVE（P3 关闭复核）。当前 reviewed SHA `9f2c4452e613526a52079c942ee98268a2e48dfd`（base 仍为 `eb5b2c516feb49ccdafa0c42389e0c4b32396d44`，审查日期 2026-10-21）：805f170 的唯一非阻断 P3（保存回执控件全局收敛）已关闭；focused 浏览器 2/2、独立 scope 反例通过；R5–R7 继续关闭。exact-head CI 在本轮审查时尚未出结论；U2 用户实际试走、私有内容试走、真实 Runner/服务器、重启/跨设备与 U3 仍为 `NOT RUN`。此前各轮保留为历史。

# 当前独立审查（9f2c445，2026-10-21）

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，任务 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`9f2c4452e613526a52079c942ee98268a2e48dfd`；上一轮 `805f170c8a2988fda2542c174eca68bc410c4ec1`。
- PR 当前 base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`；本轮产品/测试增量仅为 `u2.tsx` 与 `u2-journey.spec.ts`（审查记录另由文档提交保存）。
- 重点：确认保存回执控件按当前意见范围的原 `requestLabel` 收敛，而不是一次处理所有未决草稿。

## P3 关闭

- [u2.tsx:815–830](https://github.com/qzhike/zhiju-business-core/blob/9f2c4452e613526a52079c942ee98268a2e48dfd/apps/workspace-web/src/fixtures/u2.tsx#L815) 的 `applySaveReceipt` 现在只读取 `current.drafts[selectedScope.id]`；仅当该草稿处于 SAVING/UNKNOWN 且有 `requestLabel` 时应用当前场景，否则返回“当前意见范围没有可查询的原保存请求”。不再遍历所有 drafts。
- 控件在 [u2.tsx:1584–1596](https://github.com/qzhike/zhiju-business-core/blob/9f2c4452e613526a52079c942ee98268a2e48dfd/apps/workspace-web/src/fixtures/u2.tsx#L1584) 无 unresolved 请求时禁用，并显示“当前范围原保存请求 U2-SAVE-…”；按钮文案改为“模拟当前范围原保存回执到达/查询”。
- 独立 scope 反例（同 reviewed SHA 的 fixture 构建，Playwright inline）：分别保存阶段范围与文件版本的 UNKNOWN 草稿；对阶段范围返回 SAVED 后，阶段草稿变为已保存，文件版本草稿仍为 UNKNOWN，且控件显示阶段请求标签。此前“一次解决所有未决草稿”的行为已不存在。
- Focused browser 运行 `save, submission and finalization recovery keep one original request` 与 `stage draft keeps its original basis until explicit rebind`：2/2 passed；作者报告的 U2 非 production 7/7 与 typecheck/lint 作为补充证据。

## R5–R7 状态

- R5/R6/R7 的代码与回归未在本轮改变；上一轮 805f170 的关闭结论继续适用：定稿等待期间修改不可绕过；编辑器保留草稿 basis/requestLabel；UNKNOWN 编辑后仍禁用保存并在原回执返回后标记新输入未保存。
- 本轮未发现新的 P2/P3 阻断。

## 本轮验证证据与边界

- Focused browser 2/2 passed（fixture 构建）；独立 scope 反例确认回执控件按 `selectedScope` 与 `requestLabel` 收敛。未读取/输出客户原文、私有路径或截图。
- 作者提供 U2 非 production 浏览器 7/7、typecheck/lint pass；`vibe verify full --json` PASS 仍记录在父修订 `5d0081d`，**不是** `9f2c445` 的 exact-head 结果，本轮未重跑 full。
- Exact-head CI：[run 39596260202](https://github.com/qzhike/zhiju-business-core/actions/runs/39596260202)（`headSha=9f2c445...`）：审查时 `select` success，`checks`/persistence 仍 IN_PROGRESS，尚无 verify 汇总；合并前须等待该 exact SHA 的 required CI。
- **NOT RUN（不得由自动化或本文件代替）**：用户实际 U2 试走与反馈（UI-MVP-U2-008）；私有客户/模板原文逐字试走；真实 Runner 调用/输出；真实服务器草稿/保存/定稿；重启与跨设备恢复；U3 交付；完整平台矩阵。

## 交接

代码审查在 `9f2c445` 给出 `APPROVE`：上一轮唯一 P3 已关闭，R5–R7 继续关闭，未发现剩余代码阻断项。合并前的硬门禁仍是 exact-head CI 全绿及用户实际 U2 试走/脱敏反馈；私有内容逐字试走、真实 Runner/服务器、重启/跨设备与 U3 继续分别 `NOT RUN`。本轮只更新本审查文件，不修改产品代码，不 commit/push/merge。

# 上一轮独立审查（805f170，历史）

以下为 `805f170` 的审查；其唯一 P3（全局保存回执控件）已由 `9f2c445` 关闭。

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，任务 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`805f170c8a2988fda2542c174eca68bc410c4ec1`；上一轮 `5d0081d55ac19574688eea35cfeb39de6a8d9569`。
- PR 当前 base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`；按 PR 的 merge-base 到 head 审查。本轮增量 `5d0081d..805f170`，4 个文件（+70/−5）。
- 重点：重跑上一轮 R6 编辑换绑和 R7 UNKNOWN 编辑重存两个反例，确认显式重绑定与原保存请求在编辑后仍保留。

## R6 关闭

- [u2.tsx:781](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/apps/workspace-web/src/fixtures/u2.tsx#L781) 的 `changeDraft` 改用 [`draftAfterEditInPlace`](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/apps/workspace-web/src/mvp/review-model.ts#L431)：已有 `basis` 在编辑后保留，只有草稿没有 basis 时才回退当前依据。[u2.tsx:913](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/apps/workspace-web/src/fixtures/u2.tsx#L913) 的 FAILED 草稿也保存 `basis: currentBasis`。
- 浏览器回归 [u2-journey.spec.ts:381–385](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/tests/workspace/u2-journey.spec.ts#L381)：V1 保存阶段草稿 → V2 切换 → 编辑文本 → 提交仍禁用，“该草稿按上一版本依据保存”仍在；显式重绑定后提交，历史记录 `F-MANUAL@V2`。focused 运行通过。
- 我的独立反例（上一轮会解禁）现在保持 `提交并修改` disabled，提示未消失；显式 rebind 后才启用。R6 的编辑绕过关闭。

## R7 关闭

- [`draftAfterEditInPlace`](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/apps/workspace-web/src/mvp/review-model.ts#L431) 在 SAVING/UNKNOWN 时保留 `state`、`requestLabel`、`savedText` 和原 `basis`，新输入只作为本页文本；[`draftAfterSaveReceipt`](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/apps/workspace-web/src/mvp/review-model.ts#L456) 在 SAVED 回执但文本已改时返回 `UNSAVED`（“原保存请求已返回；新输入尚未保存”），不会声称新文本已保存。`rebindDraft` 在 SAVING/UNKNOWN 时禁用。
- 浏览器回归 [u2-journey.spec.ts:289–299](https://github.com/qzhike/zhiju-business-core/blob/805f170c8a2988fda2542c174eca68bc410c4ec1/tests/workspace/u2-journey.spec.ts#L289)：UNKNOWN → 编辑 → 保存按钮仍禁用；原保存回执 SAVED → 状态变为“新输入尚未保存”，保存按钮恢复。focused 运行通过。
- 我的独立反例（上一轮编辑后可重新保存）现在编辑后仍为 UNKNOWN、保存保持禁用，原请求可继续通过回执收敛。R7 的重复保存绕过关闭。

## R5 状态

- R5 的 `queryFinalization` active 检查未改；上一轮已通过，本轮 focused 浏览器用例继续通过，保持关闭。

## 本轮验证证据与边界

- Focused browser：fixture 构建上运行 `save, submission and finalization recovery keep one original request` 与 `stage draft keeps its original basis until explicit rebind`，2/2 passed；两条用例覆盖 R7 编辑后 UNKNOWN、R6 编辑后重绑定和 R5 定稿等待期间修改。
- Focused model：`apps/workspace-web/src/mvp/review-model.test.ts` 15/15 passed，包含 `draftAfterEditInPlace` 保留 basis/requestLabel/UNKNOWN 及 SAVED 改文返回 UNSAVED。
- 作者提供的 typecheck/lint 与本轮 focused 结果一致；`vibe verify full --json` PASS 记录在父修订 `5d0081d`，**不是** `805f170` 的 exact-head 结果，本轮未重跑 full。
- Exact-head CI：审查时 `gh pr view 307` 对 `805f170` 返回 `statusCheckRollup=[]`、`mergeStateStatus=CLEAN`，尚无 `checks`/`persistence`/`verify` 结论；合并前须等待该 exact SHA 的 required CI。
- **NOT RUN（不得由自动化或本文件代替）**：用户实际 U2 试走与反馈（UI-MVP-U2-008）；私有客户/模板原文逐字试走；真实 Runner 调用/输出；真实服务器草稿/保存/定稿；重启与跨设备恢复；U3 交付；完整平台矩阵。
- P3 观察（不阻断）：`applySaveReceipt` 仍是全局控件，会把当前场景应用到所有 SAVING/UNKNOWN 草稿，而不是按 `requestLabel` 选择单个原请求；当前单草稿路径和无重复意图要求满足，多未决草稿演示时建议按请求选择或限制。

## 交接

代码审查在 `805f170` 给出 `APPROVE`：R5 保持关闭，R6/R7 的编辑绕过已关闭，未发现剩余 P2。合并前的硬门禁是 exact-head CI 全绿及用户实际 U2 试走/脱敏反馈；私有内容逐字试走、真实 Runner/服务器、重启/跨设备与 U3 继续分别 `NOT RUN`。本轮只更新本审查文件，不修改产品代码，不 commit/push/merge。

# 上一轮独立审查（5d0081d，历史）

以下为 `5d0081d` 的审查；R6/R7 的编辑残留已由 `805f170` 关闭，保留作历史。

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，任务 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`5d0081d55ac19574688eea35cfeb39de6a8d9569`；上一轮 `8bb5d066f12f5afed5d4175cdd1899309db8a98e`。
- PR 当前 base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`；按 PR 的 merge-base 到 head 审查。
- 依据：Issue Goal/Acceptance/Verify、UI01 的 U2 Spec/Test、`usable-loop.md` §3–6 和验证基准；重点复核 R5–R7 的原始反例及“显式重绑定/原保存请求”约束。
- 本轮只更新正式审查记录；不修复产品代码，不 commit、push、merge 或关闭 Issue。

## R5 关闭

- [u2.tsx:1245–1256](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L1245) 的 `queryFinalization` 在评估回执前先查 `activeSubmission`；存在 PENDING/UNKNOWN 修改时返回“仍有待回执或待核验的修改请求…不能完成阶段定稿”，不应用回执。
- 回归在 [u2-journey.spec.ts:338–351](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/tests/workspace/u2-journey.spec.ts#L338)：定稿 PENDING → 提交 UNKNOWN 修改 → 定稿回执到达 → 查询被阻止；修改回执查询为已接收后，再查询定稿才完成。该用例在本轮 focused browser run 中通过。
- 未发现 R5 的其他绕过：`requestFinalization` 仍受 `finalizationBlocker` 的 active 约束，`receiveFinalization` 只登记回执，不应用。

## R6 未完全关闭：编辑已保存草稿会静默换绑

- 主场景已修复：[u2.tsx:1322–1326](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L1322) 在 `draftBasisChanged` 时设置 `submitBlocked`，[rebindDraft](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L931) 提供显式重绑定；未改文本的 V1 阶段草稿切到 V2 后确实禁止提交，浏览器回归通过。
- **残留 P2**：[changeDraft](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L774) 每次编辑都用 `currentBasis` 重建草稿（[781](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L781)），`draftAfterEdit` 不保留旧 `basis`（[review-model.ts:404](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/mvp/review-model.ts#L404)）。因此在 V1 保存阶段草稿、切到 V2 后，只要在 textarea 改一个字符，草稿 basis 即变为 V2，提交按钮重新可用，“该草稿按上一版本依据保存”提示消失，显式重绑定按钮被绕过。
- 独立 focused 复现：未编辑时 `提交并修改` disabled=true；编辑一字后 disabled=false，`.markdown-opinion` 不再含上一版本依据提示（Playwright inline，源码同 reviewed SHA）。这仍允许保存时 V1、提交时静默记成 V2，违反 R6 与 #306 原依据保留要求。
- 相关残留：提交 FAILED 时 [u2.tsx:910–915](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L910) 重建草稿只保留 text/state/note，丢掉 `basis`；失败草稿在切换版本后可无提示换绑。
- 修复方向：`changeDraft` 应保留已有 `latest.basis`（或在 basis 不同时保持“待重绑定”状态），只有显式 rebind 才更新 basis；FAILED 草稿保留原 basis。补“V1 保存 → V2 → 编辑一字 → 仍阻止提交，直到显式重绑定”的浏览器回归。

## R7 未完全关闭：编辑 UNKNOWN 保存草稿会重新开放保存

- 主场景已修复：`saveDraft` 在 SAVING/UNKNOWN 时拒绝新保存并保留 `requestLabel`（[u2.tsx:788–810](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L788)）；`applySaveReceipt` 可把 UNKNOWN 按原请求收敛到 SAVED/FAILED/UNKNOWN（[815–835](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L815)）；共享页保存按钮在 UNKNOWN 时禁用（[MarkdownReviewPage.tsx:864–867](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/MarkdownReviewPage.tsx#L864)）。直接 UNKNOWN → SAVED 恢复用例通过。
- **残留 P2**：[changeDraft](https://github.com/qzhike/zhiju-business-core/blob/5d0081d55ac19574688eea35cfeb39de6a8d9569/apps/workspace-web/src/fixtures/u2.tsx#L774) 在 UNKNOWN 状态编辑时调用 `draftAfterEdit`，返回 `UNSAVED` 且不带 `requestLabel`，原保存请求从草稿中消失；共享页的保存按钮只按 draft.state 禁用，于是编辑后重新可用。
- 独立 focused 复现：UNKNOWN 时 `保存意见草稿（模拟）` disabled=true；在 textarea 编辑后 disabled=false；再次保存直接进入 `正在模拟保存…`，原 `U2-SAVE-*` 请求不再可从草稿查询（Playwright inline，源码同 reviewed SHA）。这与页面“只能查询原保存动作”的文案和 R7 要求冲突。
- 修复方向：SAVING/UNKNOWN 时禁止编辑或保留 `requestLabel` 与 UNKNOWN 状态，先显式收敛原请求才允许新的保存意图；补“UNKNOWN → 编辑 → 保存仍禁用/原请求可查询”的回归。

## 本轮验证证据与未运行边界

- Focused browser：在 fixture 构建上单独运行 `save, submission and finalization recovery keep one original request` 与 `stage draft keeps its original basis until explicit rebind`，2/2 passed；这两个用例覆盖 R5、R7 直接恢复和 R6 未编辑主场景。
- Focused model：`apps/workspace-web/src/mvp/review-model.test.ts` 15/15 passed（含 `draftBasisChanged`/requestLabel）。
- 独立反例：同一 fixture 构建用 Playwright inline（不写入仓库）复现 R6 编辑后提交解禁、R7 UNKNOWN 编辑后保存解禁；均为产品代码路径，不是测试断言问题。未读取/输出客户原文、私有路径或截图。
- 作者提供 `vibe verify full --json` PASS on this revision；本轮未重跑 full，不能独立确认。exact-head CI [run 39588912360](https://github.com/qzhike/zhiju-business-core/actions/runs/39588912360) 的 head 为 `5d0081d...`；审查时 `select` success，`checks`/persistence 仍运行，尚无 verify 汇总。不得宣称 exact-head full 通过。
- **NOT RUN**：用户实际 U2 试走与反馈、私有内容逐字试走、真实 Runner/服务器保存/定稿、重启/跨设备、U3 交付；与自动化 findings 分开。

实现者应修复 R6/R7 残留（编辑后的 basis/UNKNOWN 保存意图保留），补相应浏览器回归，再提供新 head；本轮不提供合并授权，#306 人工验收证据另行补齐。

上一轮 R5–R7 的原始发现保留如下，仅适用于 `8bb5d06`；本轮关闭/残留判断以 `5d0081d` 为准。

# 更早一轮独立审查（8bb5d06，历史）

- 对象：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)，任务 [#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`8bb5d066f12f5afed5d4175cdd1899309db8a98e`。
- PR 当前 base：`eb5b2c516feb49ccdafa0c42389e0c4b32396d44`；按 PR 的 merge-base 到 head 实际 diff 审查，不把 main 上独立的 #305 变更误记成此 PR 删除。
- 依据：Issue Goal/Acceptance/Verify、UI01 的 U2 Spec/Test、`usable-loop.md` §3–6 和验证基准。先确定精确版本、完整集合、原意见依据及原请求恢复要求，再检查实现。
- 本轮仅更新正式审查记录，并按用户授权发布 PR comments；不修复产品代码，不 commit、push、merge 或关闭 Issue。已有 `package.json` / `pnpm-lock.yaml` 工作区改动保留。

## R5 · P2：查询定稿回执可以绕过未决修改请求

位置：[u2.tsx:1217](https://github.com/qzhike/zhiju-business-core/blob/8bb5d066f12f5afed5d4175cdd1899309db8a98e/apps/workspace-web/src/fixtures/u2.tsx#L1217)，关联 `submitRevision` 和 `finalizationBlocker`。

浏览器复现：生成手册 V1 → 选择 pending 定稿并确认 → 选择 UNKNOWN 修改回执并提交意见 → 模拟原定稿回执到达 → 查询原定稿请求。页面同时出现“提交结果待核验”和“模拟阶段定稿已完成”，并开放第二阶段。已观察到结果块数量为 1，原 `U2-REV` 请求仍 UNKNOWN。

原因：发起定稿时检查 active modification，但定稿等待期间仍可提交修改；`queryFinalization` 只校验版本集合和上游 ID，接受回执时没有检查未决修改。这违反 #306 的 pending revision work cannot be bypassed by finalization，以及 U2 Spec 边界 4/7。

修复要求：发起修改与接纳定稿回执共用未决修改约束，保留阅读和保存草稿；补充先定稿 pending、后修改 PENDING/UNKNOWN、再收定稿回执的浏览器反例，未决修改期间不得推进阶段。

## R6 · P2：已保存的项目／阶段草稿被重新绑定到新版本

位置：[u2.tsx:823](https://github.com/qzhike/zhiju-business-core/blob/8bb5d066f12f5afed5d4175cdd1899309db8a98e/apps/workspace-web/src/fixtures/u2.tsx#L823)，草稿读取与依据构造见 [518 行](https://github.com/qzhike/zhiju-business-core/blob/8bb5d066f12f5afed5d4175cdd1899309db8a98e/apps/workspace-web/src/fixtures/u2.tsx#L518)。

浏览器复现：在手册 V1 选择阶段范围，写入并保存意见；切到文件范围另提交一次修改，触发 V2 到达并显式切换；重新选择阶段范围，原草稿仍为“已保存”，直接提交后历史将其“原依据”记成 `F-MANUAL@V2`。诊断观察到原 V1 文件意见保持 `F-MANUAL@V1`，阶段草稿文本未变却记录 V2。

原因：草稿只有 text/state/note，按不含版本的项目／阶段 scope ID 保存；提交时从当前阅读集合构造 `currentBasis`。阅读切换不是对另外保存的阶段意见的显式重新绑定。违反 #306 原依据保留及旧意见不可静默迁移的验收要求、U2 Spec 边界 3。

修复要求：创建／保存草稿时保留原依据；依据变化后要求明确复核／重新绑定或另建草稿，不能继续显示原意见已保存并直接换绑提交。补项目和阶段两类范围的版本切换回归。

## R7 · P2：UNKNOWN 草稿保存不能恢复原请求，反而可重新保存

位置：[u2.tsx:802](https://github.com/qzhike/zhiju-business-core/blob/8bb5d066f12f5afed5d4175cdd1899309db8a98e/apps/workspace-web/src/fixtures/u2.tsx#L802)，保存按钮见 [MarkdownReviewPage.tsx:864](https://github.com/qzhike/zhiju-business-core/blob/8bb5d066f12f5afed5d4175cdd1899309db8a98e/apps/workspace-web/src/MarkdownReviewPage.tsx#L864)。

浏览器复现：输入草稿 → 保存 → 返回 UNKNOWN → 改选 SAVED 并再次返回回执，状态仍为 UNKNOWN；此时保存按钮可用。`applySaveReceipt` 只处理 SAVING，缺少原保存请求查询和固定的保存意图；再次保存会开始新的 SAVING 转移，与“只能查询原保存动作”文案冲突。

修复要求：保存固定文本、scope、basis 和原请求；SAVING/UNKNOWN 都可通过匹配原请求回执收敛，未决时不重复创建保存意图。覆盖 UNKNOWN 恢复、重复保存、导航及输入下轮草稿的场景。此项属于 #306 / U2 Spec 边界 7 的模拟恢复要求。

## 验证证据和未运行边界

- 独立 focused diagnostic：Playwright + Chromium `156.0.8078.4`，临时 fixture Vite 服务连接当前未修改的 U2 源码；以上 3 个反例均可达。阶段草稿历史通过 DOM 文本核实，未读取／输出客户原文、私有路径或截图。
- 浏览器沙箱启动因 macOS MachPort 权限失败，主机最小启动探针成功后完成复现；该问题是环境限制，不是产品测试失败。
- 本机依赖工作区存在用户原有 package/lock 改动，故该结果只作为源码路径一致的定向语义反例，不冒充 exact-head 构建或 full Gate。没有重跑完整 configured target，没有修改产品源码／正式测试。
- [CI run 39581811520 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39581811520) 的 head 为本轮 SHA。审查快照：select/checks success；persistence 三分片仍运行，总结果 pending。不得宣称 full PASS，也不把运行中的 CI 记作失败。现有确定阻断足以给出 REQUEST_CHANGES，无须等待 CI。
- 用户实际 U2 试走与反馈、私有内容试走仍 NOT RUN，须与自动化分开。真实 Runner、服务器保存／定稿、持久化恢复和 U3 不属于本次演练实现，未作为本轮缺陷要求扩展。
- 正式记录已在本地更新，尚未 commit/push；[COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/307#pullrequestreview-5598183282) 与 R5/R6/R7 三条行内 comments 已发布并回读，绑定本轮 SHA。GitHub 状态为 COMMENTED，REQUEST_CHANGES 是角色结论。

实现者应修复 R5–R7 并补相应回归，再提供新 head 的适用验证和独立复审；#306 人工验收证据另行补齐。本次不提供合并授权。

---

# 先前审查历史（以下结论仅适用于各自 SHA）

APPROVE（最终 P3 复核）。当前 reviewed SHA `4548e8df52191314883a0bc85af03281b1504415`（base 不变 `48d08d8a3a395f7b891105edae38136dfaeb7ad4`，审查日期 2026-10-21）：上一轮 `5785836864ead2153793f7c8158dfbafa75eebb4` 的 R1–R4 已关闭，本轮 4 项 P3（R1 回归、文案方向、changed fail-closed、未使用导出）也已关闭；无剩余代码阻断项。exact-head CI 在本轮审查时尚未出结论。U2 用户实际试走、私有内容逐字试走、真实 Runner/服务器定稿仍为 `NOT RUN`，本轮 APPROVE 不是 U2 验收通过，也不提供合并授权。

# PR #307 独立审查

## 对象与范围

- PR：[#307](https://github.com/qzhike/zhiju-business-core/pull/307)；关联任务：[#306](https://github.com/qzhike/zhiju-business-core/issues/306)。
- Reviewed SHA：`4548e8df52191314883a0bc85af03281b1504415`（最终 P3 复核）；上一轮 `5785836864ead2153793f7c8158dfbafa75eebb4`；原轮 `b561622e871f33eb03c691dec4ef512867340bb1`。
- Base SHA：`48d08d8a3a395f7b891105edae38136dfaeb7ad4`（未变）。
- 审查日期：2026-10-21。
- 最终增量：`5785836..4548e8d`，4 个文件（+4/−16）：`fixtures/u2-data.ts`、`fixtures/u2.tsx`、`mvp/StageReviewPage.tsx`、`tests/workspace/u2-journey.spec.ts`。
- 修复轮增量（历史）：`b561622..5785836`，5 个文件（+103/−35）：`fixtures/u2.tsx`、`mvp/StageReviewPage.tsx`、`mvp/review-model.ts`、`tests/workspace/u2-journey.spec.ts`、`module-tests/Module-Test-UI01-WorkspaceUI.md`。
- 审查依据：Issue #306 的 Acceptance/Scope/Verify；`Module-Spec-UI01-WorkspaceUI.md` 的 U2 增量；`Module-Test-UI01-WorkspaceUI.md` 的 U2 矩阵；`usable-loop.md` §3–6；`delivery-plan.md` 的 U2 行与就绪判断；`08-verification-baseline.md` 的目标路由与证据规则。
- 实际阅读：`48d08d8..b561622` 的 24 个文件增量（+4947/−127）、`b561622..5785836` 的 5 个文件修复增量（+103/−35），以及 `5785836..4548e8d` 的 4 个文件最终增量（+4/−16）；包括 `mvp/review-model.ts`、`mvp/StageReviewPage.tsx`、共享 `MarkdownReviewPage`/`review/model.ts`、U1/U2 adapter、`App.tsx` 路由、`tools/workspace/check.mjs`、`apps/workspace-web/tools/serve.mjs` 及 U2 浏览器/模型测试。未读取私有客户 DOCX、正式模板、私有清单或本机截图/路径。
- 本轮只写入本审查文件，不修改产品代码，不 commit、push、merge 或关闭 Issue。

## 原轮阻断发现（针对 b561622，历史）

以下 R1–R4 是 `b561622` 的原始发现，保留作修订历史；`5785836` 的修复核对与关闭结论见文末“修复轮复审”。

### R1 · P2：阶段定稿完成后“版本集合”跟随当前浏览版本，而非已确认版本

位置：[StageReviewPage.tsx:302](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/StageReviewPage.tsx#L302)、[u2.tsx:1423](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1423)。

已完成定稿的结果块把 `finalization.exactSet` 当作已确认集合展示，但该字段来自 `fileViews(plan, stage, session)`，即**当前 session 的 viewedVersionId**；已确认记录实际是 `session.finalization.files`。`switchVersion`（[u2.tsx:978](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L978)）、`nextCandidate`（[1004](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1004)）和 `removeFileForRehearsal`（[1039](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1039)）在 DONE 后都没有冻结。

复现（源码路径确定，无需重跑浏览器）：

1. 按现有手工路径生成质量手册 V2 并在 V2 定稿（`u2-journey.spec.ts` 的手册用例即此路径）。
2. 定稿完成后，在“查看当前文件版本”选择 V1。
3. 结果块“版本集合”从 V2 变为 V1；实际模拟定稿仍是 V2，进入第二阶段后 [上游依据](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L536)仍显示 V2。
4. 或在定稿后点击“模拟缺少一份文件”，结果块会把已定稿文件显示为“缺失”。

这违反 #306“only a matching simulated finalization result makes it the second stage's basis”、U2 Spec 边界 4/5 的精确版本/历史保留要求。下游模型里的 `finalization.files` 本身未被改写，因此不是数据损坏，但用户看到的“已定稿集合”可与真实依据不一致，属于验收级展示错误。

修复方向：把 `session.finalization.files` 放进结果视图（例如 `result.files`），DONE 分支只渲染这份冻结集合；同时冻结或明确标注定稿后的版本切换、新候选和移除控件，避免把“当前浏览”误读成“已确认”。补充“V2 定稿后切到 V1/移除文件，结果块仍为 V2”的回归。

### R2 · P2：“回执不匹配”和“确认期间版本变化”场景在 V1 或无可切换版本时会静默匹配

位置：[u2.tsx:1123–1134](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1123)、[u2.tsx:1135–1155](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1135)。

- `mismatch` 场景把回执的第一个文件硬编码为 `versionId: 'V1'`。若当前 intent 的首个文件本来就是 V1（质量手册默认 v1；或第二阶段仍为 v1），`finalizationIntentMatchesReceipt` 的 `sameVersionSet` 会返回 true，随后 `queryFinalization` 走 `evaluateFinalizationReceipt` 成功路径并显示 DONE。用户选择“版本集合错绑”却得到成功，要求的负向场景没有被演示。
- `changed` 场景只检查**最后一个计划文件**是否有不同于 `viewedVersionId` 的另一版本；若该文件只有一个版本（即使其他文件已有 V2），`otherVersion` 为 undefined，集合没有变化，回执与 intent 完全匹配，查询后同样 DONE，但界面文案声称“确认期间模拟版本变化”。

现有浏览器只覆盖第二阶段 V2 的 mismatch（[u2-journey.spec.ts:169–174](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/tests/workspace/u2-journey.spec.ts#L169)），所以没有暴露这两条路径；模型层 `evaluateFinalizationReceipt`（[review-model.ts:249](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L249)）本身是正确的，问题在 isolated adapter 构造的“错误回执”并不错误。

这违反 #306“A missing file, changed version/basis or mismatched response prevents success”及 U2 Spec 边界 5。修复方向：用保证不同的 sentinel 版本/文件或不同 requestId/basis 构造错绑回执；对 `changed` 在没有可切换版本时不伪造“已变化”，而是明确不能演示或先要求生成新候选；补质量手册 V1 mismatch 与 no-alternate-version 的模型/浏览器回归。

### R3 · P2：定稿回执不匹配后仍可直接再次确认，原请求被覆盖

位置：[u2.tsx:638–642](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L638)、[StageReviewPage.tsx:335](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/StageReviewPage.tsx#L335)、[u2.tsx:1156–1161](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1156)。

`canConfirm` 排除了 PENDING/UNKNOWN/FAILED，却没有排除 `MISMATCH`。因此查询到不匹配后，主按钮“确认…定稿（模拟）”仍可点击；页面同时显示“只查询原请求；重复点击或页面往返不会创建第二个定稿意图”。实际点击会创建**新的** intent 并直接 DONE，旧的 mismatch 请求被 `finalizationRequest` 覆盖，没有保留为历史。现有测试正是这样完成第二阶段的：先 mismatch 查询，再把场景改为 matched 重新确认并成功（[u2-journey.spec.ts:177–184](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/tests/workspace/u2-journey.spec.ts#L177)）。

这违反 #306“mismatched response prevents success”的语义边界，也与 U2 Spec 边界 5“要求重新核对，不能静默确认另一个集合”及页面自己的“只查询原请求”文案冲突。即使把新确认视为显式恢复，也应保留原不匹配请求并明确标注为新请求，而不是让“确认”按钮看起来像重复点击。

修复方向：MISMATCH 时禁用主确认按钮，要求一个显式的“已核对不匹配回执并重新发起”动作；该动作要么保留 old request 历史并创建可区分的新请求，要么清除 mismatch 状态后再允许新的确认。同步修改文案和测试，覆盖“不匹配后直接点确认不会创建第二个 intent”。

### R4 · P2：阶段集合缺文件时提交意见静默无操作

位置：[u2.tsx:810–818](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L810)、[u2.tsx:1246](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1246)、[MarkdownReviewPage.tsx:355](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/MarkdownReviewPage.tsx#L355)。

`submitRevision` 在 `!currentSet` 时直接 `return`，但 `submitBlocked` 只覆盖“已有待回执批次”；`canSubmit` 的条件覆盖提交动作、submission、stale、文本/基准与已有的 `submitBlocked`，不检查阶段集合是否完整。复现：在第二阶段生成候选后点击“模拟缺少一份文件”，选择一个仍有候选的文件范围，填写意见并点击“提交并修改”；按钮可用，但函数静默返回，没有请求、没有状态消息，用户不知道意见为何未提交。

这违反 #306“actionable errors”及 U2 Spec 边界 7 对可理解恢复状态的要求。修复方向：在缺少任一计划文件/版本时把原因放进 `submitBlocked`（例如“本阶段缺少文件或版本，请恢复或缩小意见作用范围”），或为文件版本范围定义不依赖完整集合的 basis；补对应浏览器用例。

## 非阻断观察

- **P3 · U2-008 自动化断言窄于测试名。** [u2-journey.spec.ts:307–335](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/tests/workspace/u2-journey.spec.ts#L307) 在 1440/360/320 只断言开发标识、`.stage-basis`、横向溢出和 axe，焦点只在 1440 检查；没有在窄屏断言意见区、作用范围选择或返回链接可用，也没有检查窄屏定稿/桌面完成指引。当前“reading, opinions, basis and return actions usable”的名称比实际覆盖更宽。建议补充断言，或把矩阵中的 `PASS (AUTOMATED LAYOUT/A11Y)` 收紧到实际覆盖。
- **P3 · 未使用的导出。** `draftAfterSave`（[review-model.ts:410](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L410)）与 `u2StageRetained`（[u2-data.ts:1027](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2-data.ts#L1027)）在实现/测试中没有消费者；删除或接入，避免演示模型留下死代码。
- PR 正文写“U2 浏览器用例 6 项”，`u2-journey.spec.ts` 实际有 7 个 `test(`；不影响行为，但证据计数应与文件一致。

## 已核对且未发现阻断的方面

- **精确集合/上游绑定**：[`sameVersionSet`](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L47) 按 fileId/versionId 做集合比较；`manualBasis`/`procedureBasis`（[122](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L122)/[155](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L155)）检查项目、计划版本、输入、模板、手册定稿 ID 和完整文件集合；[`evaluateFinalizationReceipt`](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L249) 在回执、当前集合或上游改变时拒绝。
- **旧逐文件批准未被改标为阶段确认**：U2 显式传 `approval.visible: false`（[u2.tsx:1368–1372](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1368)），共享页面不渲染“检查完成并批准”，阶段定稿是独立的一次完整集合确认。
- **记录表单无单独定稿关卡**：`finalization.supported: stage !== 'RECORDS'`（[u2.tsx:1416](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1416)）；页面显示 U3 边界，不提供 ZIP/已交付入口；浏览器用例覆盖。
- **深链接门禁**：[u2.tsx:572–627](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L572) 按计划/上游定稿给出原因与返回动作，直接打开不能补造；测试覆盖无计划、无手册定稿、无第二阶段定稿。
- **单项目单批次、保存/提交/定稿分离、append-only 历史**：[`activeSubmission`](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L371) 只把 PENDING/UNKNOWN 视为活动；`saveDraft`（[783](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L783)）、`submitRevision`（[810](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L810)）、`requestFinalization`（[1085](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1085)）是不同动作；submissions 只追加（[876](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L876)）并在历史中显示原请求/依据。
- **候选到达不替换阅读/草稿**：`nextCandidate` 只追加版本（[1004](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/fixtures/u2.tsx#L1004)），`candidateVersion`（[review-model.ts:454](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/apps/workspace-web/src/mvp/review-model.ts#L454)）只提示；浏览器验证草稿在切换前保留。普通保存/失败/UNKNOWN 状态与内存边界文案可见；没有计时器推导成功。
- **U1 交接回归**：计划页按钮直接导航到 `/stages/manual`，不重复范围确认；U1 用例已改为该路径并断言无对话框（[u1-journey.spec.ts:225–231](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/tests/workspace/u1-journey.spec.ts#L225)）。
- **生产隔离**：`App.tsx` 的 U2 lazy import 受 `__DEV_FIXTURE__` 保护，`vite.config.ts` 只在 fixture serve/development 置 true；`tools/workspace/check.mjs` 增加 U2 标记断言；本机现有 production `dist`（16:55，早于 pin commit）不含 U1/U2 标记；浏览器 production 用例存在。

## 验证证据与限制

- [Exact-head CI](https://github.com/qzhike/zhiju-business-core/actions/runs/39574093705)（`headSha` 为 reviewed SHA）：审查时 `select`、`checks` 为 completed / success；`persistence-1/2/3` 仍在运行，`verify` 尚未出现，PR `mergeStateStatus=UNSTABLE`。因此本轮**不能**声称 exact-head `full` 已通过。
- 作者报告的 `vibe verify environment --json` / `vibe verify full --json` PASS 作为提供的证据记录，不视为 Reviewer 独立重跑；本轮没有重复运行 full、浏览器或 persistence。`vibe verify full` 的路由与 U2 新增路径（`App.tsx`、共享审阅、MVP 页面）相符。
- 本机 production `dist` 的 U1/U2 标记检查是**辅助观察**，不是 exact-head 构建证据；`b561622` 的 PostgreSQL 18.6 digest pin 是独立的验证维护提交，不属于产品范围，但其余代码的 exact-head CI 仍需完整通过。
- 私有来源“C01–C07/T01–T06 字节和 SHA-256 全部匹配”是作者/实现记录，本轮未读取私有 DOCX、模板或清单，未独立复核；`u2-data.ts` 为匿名展示内容，未包含客户身份、路径或私有清单。
- **NOT RUN（不得由自动化代替）**：
  - 用户实际 U2 桌面试走与反馈（UI-MVP-U2-008）；PR 正文与测试矩阵均明确 `NOT RUN`。
  - 私有客户/模板原文的逐字内容试走；[Module-Test-UI01-WorkspaceUI.md:399](https://github.com/qzhike/zhiju-business-core/blob/b561622e871f33eb03c691dec4ef512867340bb1/.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md#L399) 明确该项仍为 `NOT RUN`，Issue #306 Verify 3 要求本地内容依据的浏览器试走。
  - 真实 Runner 调用/输出、真实服务器草稿/保存/定稿、重启与跨设备恢复、真实 Markdown 下载与登录/会话清理的新增证据。
  - U3 的上游返工、部分结果重试、迟到结果、最终交付清单/ZIP/下载、完整 UI-06/08 与 MVP-01–10。
  - 窄屏/平台矩阵的完整人工试走；自动化只覆盖 1440/360/320 的布局/axe 子集。

## 原轮交接（针对 b561622，历史）

请实现者修复 R1–R4，补充相应的负向/展示回归，然后提供新的 exact head 的适用验证（含 exact-head `full`/CI）并重新进行独立审查。R1 是本轮最优先的展示正确性问题，R2/R3 直接关系到 #306 对错误回执和定稿语义的验收，R4 影响可理解的恢复动作。

用户实际 U2 试走、私有内容试走和真实 Runner/服务器行为仍须在关闭 #306 前单独完成并记录脱敏证据；原轮 `REQUEST_CHANGES` 不代表 U2 验收通过，也不提供合并授权。本文件只保存在本地，尚未 commit/push；合并前须按交付授权将正式审查记录纳入 Git，并按新 head 复核本结论不自动延伸到新 SHA。

## 修复轮复审（针对 5785836，2026-10-21）

- Reviewed SHA：`5785836864ead2153793f7c8158dfbafa75eebb4`；上一轮 `b561622e871f33eb03c691dec4ef512867340bb1`；base 仍为 `48d08d8a3a395f7b891105edae38136dfaeb7ad4`。
- 结论：原 R1–R4 的可达路径均已由实际源码和新增回归关闭，`APPROVE`。以下 3 项 P3 后续项不阻断代码结论，但建议在提交本审查记录的非代码提交前或下一轮补齐。

### R1 关闭（代码修复，但声明的回归缺失）

- [u2.tsx:1452](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1452) 现在从 `session.finalization.files` 生成 `result.files`；[StageReviewPage.tsx:309](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/mvp/StageReviewPage.tsx#L309) 的结果块只渲染这份冻结集合，`exactSet` 仅用于确认前对话框；`switchVersion`/`nextCandidate`/`removeFileForRehearsal` 不再改变已完成的定稿结果。修复是产品代码，不是测试替身。
- **P3 · 声明的 R1 浏览器回归不存在。** Main 描述“定稿 V2 后切换到 V1 并断言结果仍为 V2”，但 `tests/workspace/u2-journey.spec.ts` 的版本切换在定稿前（[120–122](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L120)），定稿后只断言 [133](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L133) 含 V2，没有再做切换。请补“定稿 V2 → 切 V1 → 冻结结果仍为 V2（且 `stage-set` 明确标注当前阅读选择）”的浏览器回归。
- **P3 · 指针方向错误。** [StageReviewPage.tsx:250](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/mvp/StageReviewPage.tsx#L250) 写“见上方‘模拟阶段定稿已完成’”，但 `stage-set`（243 行）在 `stage-finalize`（276 行）之前，结果实际在下方；改为“见下方”或调整面板顺序。

### R2 关闭（当前可达路径）

- `mismatch` 使用 `${ref.versionId}-MISMATCH` sentinel（[u2.tsx:1128](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1128)），不会与 V1/V2 相等；`changed` 在缺少替代版本时返回显式 MISMATCH（[1141–1152](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1141)），有替代版本时才切换。手册 V1 mismatch 由 recovery 用例覆盖（[tests/workspace/u2-journey.spec.ts:302 起](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L302)），程序/制度的 mismatch 与 changed 由 [174–193](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L174) 覆盖。可达路径的负向场景现在确实得到 MISMATCH，不再静默 DONE。
- **P3 · 不可达分支仍不是 fail-closed。** 无替代版本分支在 [1148–1150](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1148) 设置 `MISMATCH` 但保存的 `receipt: matching` 与 intent 完全相同；若该分支被触发，用户点击“重新查询原定稿请求”仍会在 [queryFinalization](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1196) 评估成功并 DONE。当前所有计划文件都有 V1/V2，分支不可达；仍应改为无 receipt 或 sentinel，避免未来单版本文件把它变成成功路径。

### R3 关闭

- [u2.tsx:638–643](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L638) 的 `canConfirm` 已排除 `MISMATCH`；主确认按钮和对话框确认均禁用，只有 [resetFinalization](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1231) 清除不匹配请求后才重新开放。程序用例断言主按钮禁用和重置路径（[177–184](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L177)），手册 recovery 用例走同一重置路径。重置会清除原不匹配请求而不保留历史，这符合上一轮给出的“显式清除后再允许新确认”方向。

### R4 关闭

- [u2.tsx:1265](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2.tsx#L1265) 在 `!currentSet` 时设置可操作的 `submitBlocked`；共享页 `canSubmit` 因 `opinion.submitBlocked` 禁用提交。程序用例在“模拟缺少一份文件”后断言提交禁用和原因可见（[163–169](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/tests/workspace/u2-journey.spec.ts#L163)）。

### 其余 P3 与验证边界

- `u2StageRetained` **仍存在**于 [u2-data.ts:1027](https://github.com/qzhike/zhiju-business-core/blob/5785836864ead2153793f7c8158dfbafa75eebb4/apps/workspace-web/src/fixtures/u2-data.ts#L1027)，没有消费者；Main 所称“已删除”只对 `draftAfterSave` 成立。删除或接入后再更新声明。
- PR 正文的 U2 浏览器用例数已改为 7，实际文件有 7 个 `test(`，一致。
- 作者报告当前树 `vibe verify full --json` PASS（format、lint、typecheck、全量 Vitest、workspace/browser、architecture、contracts、PostgreSQL persistence gate）作为提供的证据，本轮没有重跑 full、浏览器或 persistence。
- Exact-head CI：[run 39581014907](https://github.com/qzhike/zhiju-business-core/actions/runs/39581014907)（`headSha=5785836...`）：审查时 `select` success；`checks`、`persistence-1/2/3` 仍为 IN_PROGRESS，`verify` 未出，`mergeStateStatus=UNSTABLE`。因此本轮仍不能声称 exact-head `full` 通过；合并前须等待该 SHA 的 required CI 完成。
- U2 用户实际试走/反馈、私有内容逐字试走、真实 Runner/服务器保存/定稿、重启/跨设备、U3 与平台矩阵仍为 `NOT RUN`；本轮 `APPROVE` 只针对代码修订，不代替 #306 的人工验收。

### 修复轮交接

代码层无剩余 P2/R1–R4 阻断；建议在非代码审查提交或下一轮补 R1 回归、修正“上方/下方”文案、删除 `u2StageRetained`，并把 `changed` 无替代版本分支改为 fail-closed。合并前仍需 exact-head CI 全绿及用户实际 U2 试走；本轮不 commit/push/merge，也不把 APPROVE 延伸为新 SHA。

## 最终 P3 关闭复核（针对 4548e8d，2026-10-21）

- Reviewed SHA：`4548e8df52191314883a0bc85af03281b1504415`；上一轮 `5785836864ead2153793f7c8158dfbafa75eebb4`；base 仍为 `48d08d8a3a395f7b891105edae38136dfaeb7ad4`。
- 增量：`5785836..4548e8d`，4 个文件（+4/−16）：`fixtures/u2-data.ts`、`fixtures/u2.tsx`、`mvp/StageReviewPage.tsx`、`tests/workspace/u2-journey.spec.ts`；`git diff --check` 通过。
- 结论：`APPROVE` 维持。上一轮 4 项 P3 均已关闭，无新增代码阻断项。

### R1 回归与文案关闭

- 新增的实际回归在 [u2-journey.spec.ts:134–135](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/tests/workspace/u2-journey.spec.ts#L134)：先完成手册 V2 定稿（[130–133](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/tests/workspace/u2-journey.spec.ts#L130)），再切到 V1，断言 `.stage-finalization-result` 仍含“质量手册 · 第 2 版候选”。这正好覆盖上一轮缺失的定稿后切换场景。
- 冻结结果仍由 `session.finalization.files` 生成（[u2.tsx:1452](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/fixtures/u2.tsx#L1452)），并由 [StageReviewPage.tsx:309](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/mvp/StageReviewPage.tsx#L309) 渲染；切换阅读版本不再改写结果。
- [StageReviewPage.tsx:250](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/mvp/StageReviewPage.tsx#L250) 已去掉错误的“上方”，文案与面板顺序一致。

### changed 无替代版本分支关闭

- [u2.tsx:1149](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/fixtures/u2.tsx#L1149) 现在只保存 `finalizationRequest: { intent }`，不再附带 matching receipt。该分支进入 MISMATCH 后，[queryFinalization](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/fixtures/u2.tsx#L1196) 查不到 receipt，只能返回“原定稿请求仍无可匹配回执；未创建第二个意图”，不会 DONE；主确认按钮因 MISMATCH 保持禁用，只能走显式 reset。分支现在 fail-closed。该分支在当前 V1/V2 fixture 中仍不可达，但不再是潜在成功路径。

### 未使用导出关闭

- `u2StageRetained` 已从 [u2-data.ts](https://github.com/qzhike/zhiju-business-core/blob/4548e8df52191314883a0bc85af03281b1504415/apps/workspace-web/src/fixtures/u2-data.ts) 删除；全仓 `grep u2StageRetained` 无引用，`draftAfterSave` 也仍不存在。上一轮的 P3 清理声明现在与源码一致。

### 最终验证证据与边界

- 作者提供的证据：U2 非 production 浏览器用例 6/6、模型/组件 24/24、typecheck/lint pass；这与 `u2-journey.spec.ts` 的 7 个用例（1 个 production 用例被 `--grep-invert production` 排除）一致。本轮未重跑这些用例。
- `vibe verify full --json` PASS 记录在上一轮 `5785836`，**不是** `4548e8d` 的 exact-head 结果；本轮没有重跑 full，也不把它当作最终 head 的验证。
- Exact-head CI：审查时 `gh pr view 307` 对 `4548e8d` 返回 `statusCheckRollup=[]`、`mergeStateStatus=CLEAN`，尚无 `checks`/`persistence`/`verify` 结论。合并前必须等待该 exact SHA 的 required CI 完成；本轮不声称 exact-head full 通过。
- **NOT RUN（不得由自动化或本文件代替）**：用户实际 U2 桌面试走与反馈（UI-MVP-U2-008）；私有客户/模板原文的逐字内容试走；真实 Runner 调用/输出；真实服务器草稿/保存/定稿；重启与跨设备恢复；U3 上游返工/最终交付 ZIP/下载；完整平台矩阵。Issue #306 的人工与真实服务验收仍未完成。

### 最终交接

代码审查在 `4548e8d` 给出 `APPROVE`：R1–R4 与上一轮 P3 均已关闭，未发现剩余代码阻断项。合并前的硬门禁仍是 exact-head CI 全绿以及用户实际 U2 试走/脱敏反馈；私有内容逐字试走、真实 Runner/服务器、重启/跨设备与 U3 继续分别 `NOT RUN`。本轮只更新本审查文件，不修改产品代码，不 commit/push/merge；本文件届时作为非代码提交纳入 Git，结论不自动延伸到后续 SHA。


