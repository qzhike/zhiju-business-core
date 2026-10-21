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


