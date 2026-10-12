# PR #275 独立实现审查

## 人类实现技术批准与最终审查结论

- 批准日期：2026-10-12（Asia/Shanghai）。
- 当前 Reviewer 结论：`APPROVE`。
- 已审并获批 SHA：`e41a6e8600e592f98709c0a8161e68dd565f682f`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 人类批准来源：用户针对第四轮技术复审结论及其明确列出的精确修订人类技术门禁，在当前 Codex 对话中明确回复“批准”；本批准由 Codex 转录该用户决定。
- GitHub 批准记录：[Human implementation technical approval / comment 6117295474](https://github.com/qzhike/zhiju-business-core/pull/275#issuecomment-6117295474)，2026-10-12 03:37:55 UTC；已完整读回 APPROVE、用户明确批准来源和精确 SHA，正文匹配本地准备的转录。发表前后远端 head 均未变。

批准前已通过 `vibe repo --json` 和远端 PR 读回确认本地及 PR head 仍为上述 SHA；第四轮 [独立技术复审](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5486297442) 精确绑定该 SHA，R1–R10 的已报告反例已修复，19 个独立定向用例全部通过。[CI run 38193828114](https://github.com/qzhike/zhiju-business-core/actions/runs/38193828114) 再次读回 headSha 相同、conclusion=success，覆盖所需 full 门禁。没有产品修订变化，复用这些当前证据，没有重复执行相同验证。

该用户决定满足 Issue #270 对此修订的 Human 实现技术批准门禁，取代下方第四轮发表时的 HUMAN_REVIEW_REQUIRED 结论；既有审查过程、发现、证据和当时事实均保留。批准范围为 #270 的 ART/IG/Contracts 闭口 Markdown 技术管线；未来 TE、候选封存 / Head、Attempt/Binding/Representation、公开 Diff/下载、Host/Runner/OIDC/HTTP、Browser 与独立人工内容验收仍按原切片边界保持 NOT IMPLEMENTED / NOT RUN。

本轮只记录技术批准并更新正式记录；记录增量在 approved SHA 之后产生、未 commit/push，不属于该 SHA 或其 CI。没有合并 PR。

批准附录及完整 Review.md 的单文件 Prettier、Markdown fence/conflict 与工作区 `git diff --check HEAD` 检查均 PASS；这些仅覆盖正式记录增量，没有改变或替代已获批 SHA 的 CI 证据。

## 第四轮复审：修复 head `e41a6e8`

- 复审日期：2026-10-12（Asia/Shanghai）。
- 当前角色与结论：`Reviewer / HUMAN_REVIEW_REQUIRED`。
- 独立技术判断：R1–R10 已报告反例均通过复验；本轮未发现剩余代码、Contract、范围或配置门禁阻塞项。剩余门禁为 Issue #270 明确要求的精确修订人类实现技术批准。
- 已审 SHA：`e41a6e8600e592f98709c0a8161e68dd565f682f`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 上轮已审 SHA：`e3901db795325ecd9ea31f77f3ea2739de7cac09`。
- PR：<https://github.com/qzhike/zhiju-business-core/pull/275>；Issue：[#270](https://github.com/qzhike/zhiju-business-core/issues/270)。
- 本轮已发表：[COMMENT review 5486297442](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5486297442)，2026-10-12 03:30:15 UTC；已读回 HUMAN_REVIEW_REQUIRED、完整 body、state=COMMENTED 和精确 commit_id，均匹配本地准备的评论。发表前后远端 head 均未变。

本轮独立读取最新 PR / Issue、实际修复 diff、相关 ART / Module-Test 和当前 exact-revision CI，沿用已批准 ART §13.2 / Delta §3 的支持集与首轮完整 named Contract 字段对账。预期为 R10 两种缩进 spaced thematic marker 正确结束列表、产生真实 THEMATIC_BREAK，扫描必须消费输入；普通子列表保持 parent/depth，真实 setext 继续拒绝，受支持输入保持完整 tree、身份与 cv1 Hash。实现者的修复说明与临时探针报告仅作定位，不作为本轮验证证据。

### 已报告发现的当前状态

| 发现  | 本轮独立核对                                                                                                                                                                                                                    | 判定           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1–R8 | 当前源代码上的合法绑定 / round-trip、Artifact/Project/output/raw/base/mapping 拒绝、node/column 完整对应拒绝、列表硬换行 / ATX、Unit 上限、未知 selector / 非首行 header、扩展拒绝与 CODE literal 控制均通过。                  | 原反例保持修复 |
| R9    | 五种未缩进 thematic marker 的相邻 / 空行列表对照、段落相邻 `***`、真实 setext 拒绝与 canonical round-trip 均通过。                                                                                                              | 原反例保持修复 |
| R10   | `- item\n  * * *\n` / `- item\n  - - -\n` 的正常时钟与约 100ms 测试 deadline、有 / 无空行各组均产出恰好 LIST_ITEM + THEMATIC_BREAK，省略 break text，无重复节点。与未缩进基准 canonicalJson 相等，完整 round-trip / Hash 通过。 | 原反例已修复   |

代码在递归子列表之前判定 THEMATIC_PATTERN。根扫描入口已先处理 thematic，递归入口现在也只送入非 thematic 的合法 list marker；子 scanner 第一轮因此建立真实 item 并增加 index，不再返回零消费空 LIST。普通 `- parent\n  - child\n  * * x\n` 的 3 个真实项、child.parentUnitId 和 listDepth=2 均独立断言并通过 round-trip。本轮没有要求增加不可达的防御分支或扩大 grammar。

新增测试和 `list-thematic-break.md` 确实覆盖两种缩进 marker 与普通子列表；ART §13.6 / Module-Test 同步了实现边界。此次实现增量仅 4 行 parser 优先级处理，没有变更机器 Schema/类型、registered selector、identity input、IG renderer、旧 profile / request_render@1.0 或 cv1 Hash。前三轮正式记录现在均已包含在 `e41a6e8`；以下保留其原始发表时事实，历史“未提交”等措辞不代表本轮初始工作区。

### 本轮证据与人类技术门禁

| 证据             | 核对结果                                                                                                                                                                                                                                                                                        | 边界                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Exact revision   | `vibe repo --json` 为 qzhike/zhiju-business-core / `e41a6e8600e592f98709c0a8161e68dd565f682f`；远端 head 一致，base 未变，PR OPEN / 非 Draft；本轮开始工作区干净。                                                                                                                              | 本轮正式记录增量在 reviewed head 之后新增。                                                                           |
| 配置 CI          | [run 38193828114](https://github.com/qzhike/zhiju-business-core/actions/runs/38193828114) 的 headSha 精确匹配，select/checks/persistence/verify 全部 SUCCESS；实际 Verify code、Build persistence prerequisites、Verify persistence 和 aggregate 步骤全部成功，workflow / project config 未变。 | 覆盖 ready PR 要求的 full；复用当前证据，不重复本地 full，不推导未来 Markdown 业务链或人工验收已完成。                |
| 独立定向验证     | `node node_modules/vitest/vitest.mjs run tests/business/pr275-round4-probe.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/pr275-round4-probe-results.json`；1 file / 19 tests 全 PASS，1.15 秒。                                                                          | R1–R10 回归及正反控制通过；R10 同时使用正常时钟和前轮的短测试 deadline。这是独立语义诊断，不冒称配置 full。           |
| 临时材料         | 最终源在 `/private/tmp/pr275-round4-probe.test.ts`，结果在 `/private/tmp/pr275-round4-probe-results.json`。                                                                                                                                                                                     | 探针已从仓库删除；未改产品代码、原测试、Contract 或 owning Spec。                                                     |
| 正式记录         | 本轮仅更新此 Review.md，保留各轮发现、证据与发表链接，并补入第四轮 review 的完整读回指针。                                                                                                                                                                                                      | 本轮增量未 commit/push，不属于 reviewed SHA 或其 CI。                                                                 |
| Focused 文档检查 | 单文件 Prettier、Markdown fence/conflict、历史 R10 原始输入文本及工作区 `git diff --check HEAD` 均 PASS。                                                                                                                                                                                       | 只覆盖正式记录增量，不冒称该页已包含在 current CI 或取得新的 full。                                                   |
| GitHub 访问恢复  | 发表前沙箱 `gh pr view 275` 的 GraphQL 调用超时；host 最小只读 `gh api repos/qzhike/zhiju-business-core` 也报 `dial tcp 198.18.0.37:443: i/o timeout`。一次有界 host REST PR 读回恢复，随后 head / reviews / comments 核对、POST review 与完整读回均成功。                                      | 短暂外部连接失败，没有推断认证无效；保持 gh 路径，没有使用 Computer Use。不影响此前取得的当前修订 CI 或独立语义证据。 |

[Issue #270 Verify](https://github.com/qzhike/zhiju-business-core/issues/270) 明确要求：“Require independent T2 implementation review and applicable exact-revision Human technical approval before delivery.” 当前 PR 的最新讨论仍明确记录实现人类技术批准待办；当前 reviews 未提供对此 head 的人类批准。PR #269 的 `d5ff5f0` 设计批准不能代替 `e41a6e8` 的实现技术批准。因此本轮独立技术复审通过，但 Reviewer outcome 为 HUMAN_REVIEW_REQUIRED，而非 APPROVE；这不是因普通合并授权待办而设置的门禁。

本轮已以 COMMENT review 发表上述技术判断与精确 SHA，交由适用 Human 技术权威审查该实现；该事件不是 GitHub APPROVED，也不是人类技术批准。未来 TE、候选封存 / Head、Attempt/Binding/Representation、公开 Diff/下载、Host/Runner/OIDC/HTTP、Browser 与独立人工内容验收继续保持本切片的 NOT IMPLEMENTED / NOT RUN。没有修复产品、commit、push 或 merge。

## 第三轮复审：修复 head `e3901db`

- 复审日期：2026-10-12（Asia/Shanghai）。
- 当前角色与结论：`Reviewer / REQUEST_CHANGES`，新增 1 条阻塞发现 `R10 / P2`。
- 已审 SHA：`e3901db795325ecd9ea31f77f3ea2739de7cac09`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 上轮已审 SHA：`a2d40d41175f371d01fe6599d463c7edd61e1676`。
- PR：<https://github.com/qzhike/zhiju-business-core/pull/275>；Issue：[#270](https://github.com/qzhike/zhiju-business-core/issues/270)。
- 本轮已发表：[COMMENT review 5485597196](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5485597196)，2026-10-12 00:01:13 UTC；已读回 outcome、完整 body、state=COMMENTED 和精确 commit_id。发表前后远端 head 均未变。
- R10 行内意见：[discussion_r4243790062](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4243790062)；已独立读回 path、RIGHT line=569、body 和上述 commit_id。

本轮独立读取最新 PR / Issue、实际修复 diff、相关 ART §13.2/13.6、Delta §3、Module-Test 与精确修订 CI。预期为：相邻普通分隔线保持 THEMATIC_BREAK，空行排版不改变语义，真实 setext 仍拒绝；列表与子列表扫描必须消费输入或把已识别的块交回 owning scanner，不能对同一行持续重入。复审范围为 R9 修复及其实际影响，延续首轮完整 Contract 字段对账，不重复读取无关历史或扩展业务范围。

### 已报告发现的当前状态

| 发现     | 本轮独立复验                                                                                                                                                                                                                     | 判定           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1–R8    | 合法 sidecar / round-trip、精确绑定与逐项 correspondence 拒绝、列表硬换行 / ATX、表格 Unit 上限、未知 selector / 非首行 header、未知扩展、CODE literal 与危险内容拒绝控制均通过当前源代码探针。                                  | 原反例保持修复 |
| R9       | 原输入 `- item\n***\n` 得到 LIST_ITEM + THEMATIC_BREAK；`***`/`---`/`___`/`- - -`/`* * *` 的无空行与带空行列表对照均保留初次 tree、完整 round-trip 和 Hash。段落相邻 `***` 正常；段落 `---`/`===` 和列表项内缩进 setext 仍拒绝。 | 原反例已修复   |
| R10 / P2 | 缩进两个空格的 spaced thematic marker 被递归送入空子列表，`next` 不前进，外层持续追加空 LIST 并重入，直到 deadline。                                                                                                             | 新增阻塞发现   |

本修复没有变更 Contract Schema/类型、注册 selector、身份输入、IG renderer 或 cv1 Hash 接受集。ART 实现状态与 Module-Test 同步了 R9 的真实边界，新增 `list-thematic-break.md` 走跨模块管线；没有把未来操作或业务验收改成 PASS。前两轮正式记录现均已包含在 `e3901db`；后续历史段落中的“未提交”等语句只描述各轮发表时状态，当前结论以上方第三轮为准。

### R10 / P2：缩进 spaced 分隔线导致列表扫描不前进

位置：`modules/artifact/src/business/markdown-document-service.ts:569`（新增 thematic 优先级），递归调用及回写 `next` 在 `:595`。

受支持的 15-byte 独立输入（第二行两个空格）：

```text
- item
  * * *
```

把第二行换成 `  - - -` 也相同。外层 list scanner 先命中 `marker !== null && indent > baseIndent`，把该行递归给 `#scanList(index, end, indent)`。子 scanner 第一行现在命中新增的 THEMATIC_PATTERN break，返回 `items=[]` 和未改变的 `next=index`。外层追加空 LIST 后把 index 设回同一值，再次重入。该分支没有消费字符 / 行，真正的 Unit 计数也尚未开始；deadline 是此循环的退出条件。

独立定向探针通过现有 `request.now` 注入约 100ms 的测试 deadline（`Date.now()-9900`），以免人为消耗完整 10 秒预算。两个输入均在约 100ms 后返回 `ARTIFACT_MARKDOWN_LIMIT`；同样注入下，`- item\n  ***\n` 得到真实 THEMATIC_BREAK，普通 `- outer\n  - inner\n` 子列表也正常解析且可 round-trip。短测试 deadline 仅用于控制复现成本；未声称实际测量默认 10 秒或 heap 峰值。代码检查独立确认了不前进的 next / 重入路径，因此不是把人工缩短 deadline 本身当产品缺陷。

Delta §3 / ART §13.2 已支持普通分隔线、列表与缩进续行 / 子列表；spaced marker 也已被当前 THEMATIC_PATTERN 识别，不能因递归分支优先级把微小合法输入变成资源超限。修复应在递归子列表前处理 thematic 优先级，并保证返回的 scanner 位置消费了输入或正确终止外层列表；无需新规划或 grammar 扩展。加入两个 marker 的缩进初次 tree / round-trip 用例，保留未缩进分隔线、普通子列表和真实 setext 拒绝对照。

### 本轮证据与交付边界

| 证据             | 核对结果                                                                                                                                                                                                                                                    | 边界                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact revision   | `vibe repo --json` 为 qzhike/zhiju-business-core / `e3901db795325ecd9ea31f77f3ea2739de7cac09`；远端 head 一致，base 未变，PR OPEN / 非 Draft。本轮开始工作区干净。                                                                                          | 前两轮记录已经由实现修订保留；本轮增量在 head 之后新增。                                                                                      |
| 配置 CI          | [run 38146461688](https://github.com/qzhike/zhiju-business-core/actions/runs/38146461688) 的 headSha 精确匹配；select/checks/persistence/verify 全部 SUCCESS。已核对 unchanged workflow 和实际 Verify code、clean build prerequisites、Verify persistence。 | 覆盖 ready PR 要求的 full，复用当前可信证据，没有重复本地 full；不替代本轮语义反例。                                                          |
| 独立定向验证     | `node node_modules/vitest/vitest.mjs run tests/business/pr275-round3-probe.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/pr275-round3-probe-results.json`；最终 1 file / 19 tests，18 PASS / 1 FAIL，1.40 秒。                       | 原 R1–R9、合法控制与 setext 控制均通过；唯一 FAIL 是两个缩进 spaced marker 的接纳预期，实际均为 LIMIT。这是语义诊断，不冒称 configured full。 |
| 临时材料         | 最终源在 `/private/tmp/pr275-round3-probe.test.ts`，结果在 `/private/tmp/pr275-round3-probe-results.json`。                                                                                                                                                 | 探针已从仓库移除；没有更改产品、原测试、Contract 或 owning Spec。                                                                             |
| 正式记录         | 本轮仅更新此 Review.md，保留各轮发现、证据及发表指针，并补入第三轮 review / R10 读回链接。                                                                                                                                                                  | 本轮增量未 commit/push，不属于 reviewed SHA 或其 CI。                                                                                         |
| Focused 文档检查 | 单文件 Prettier、Markdown fence/conflict、R10 原始输入文本及工作区 `git diff --check HEAD` 均 PASS。                                                                                                                                                        | 只覆盖本轮正式记录，不冒称该增量已包含在 exact-head CI 或取得新的 full。                                                                      |

本轮结论为 REQUEST_CHANGES。R10 修复后需复审新 head 与对应门禁；Issue #270 的 exact-revision Human 实现技术批准仍未提供，#269 的设计批准不能替代。未来 TE、候选封存 / Head、Attempt/Binding/Representation、公开 Diff/下载、Host/Runner/OIDC/HTTP、Browser 与独立人工内容验收继续保持本切片的 NOT IMPLEMENTED / NOT RUN。没有修复产品、commit、push 或 merge。

已发表 COMMENT review 与 1 条 P2 行内意见，完整读回匹配本地准备的评论和精确 SHA；这不是 GitHub APPROVED / CHANGES_REQUESTED 事件。

## 第二轮复审：修复 head `a2d40d4`

- 复审日期：2026-10-11。
- 当前角色与结论：`Reviewer / REQUEST_CHANGES`，新增 1 条阻塞发现 `R9 / P2`。
- 已审 SHA：`a2d40d41175f371d01fe6599d463c7edd61e1676`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 上轮已审 SHA：`6195c76ef00ce6933fba48eb99fda6553ec175e6`。
- PR：<https://github.com/qzhike/zhiju-business-core/pull/275>；Issue：[#270](https://github.com/qzhike/zhiju-business-core/issues/270)。
- 本轮已发表：[COMMENT review 5483589632](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5483589632)，2026-10-11 14:02:43 UTC；已读回 outcome、完整 body、state=COMMENTED 和精确 commit_id。发表前后远端 head 均未变。
- R9 行内意见：[discussion_r4241851173](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241851173)；已独立读回 path、RIGHT line=664、body 和上述 commit_id。

本轮针对最新修订独立读取 Issue、PR diff、受影响 ART / IG / Contracts、测试和精确修订 CI，并依据已批准 ART §13.2 与 Delta §3 重建预期。未用实现者的修复表或临时探针 PASS 作为批准依据。上轮报告的 8 条具体反例现已满足要求，但列表结束后的普通分隔线仍可被接受为正文文字，且错误语义的树仍通过 round-trip；不能以配置 CI 通过关闭这一契约缺陷。

### 上轮发现复验

| 发现    | 当前修订的独立核对与定向结果                                                                                                                                                                                                                         | 判定                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R1 / P1 | 有 sidecar 时必须提供 owning `identityBinding`；精确 Artifact、Project、candidate output、base、mapping、profile、document 和 raw hash 对账。合法绑定接纳；分别替换 Artifact/Project/output/raw、替换或漏掉 base/mapping、缺 owning binding 均拒绝。 | 原反例已修复                                       |
| R2 / P1 | materialized sourceNodes/sourceColumns 与 sidecar 按 path/type/identity/parent/ordinal 及每表列覆盖逐项对账。分别错 parent/ordinal/type、同数量替换 path、缺列/异表列/额外列均拒绝。                                                                 | 原反例已修复                                       |
| R3 / P2 | 两空格和反斜线 marker 行硬换行均保留为 LF + HARD_BREAK；无空行的后续 ATX 标题保留独立 SECTION。对应初次 tree 与 round-trip 均验证。                                                                                                                  | 原硬换行 / ATX 反例已修复；新的分隔线边界问题见 R9 |
| R4 / P1 | `#scanTable` 在 materialization 前累计 TABLE、ROW、CELL，并执行统一 Unit / deadline 检查。原 20001 个两行小表输入仍仅 380019 bytes，现在返回 `ARTIFACT_MARKDOWN_LIMIT`。                                                                             | 原反例已修复                                       |
| R5 / P2 | 公开 validator 精确检查 registered selector/version 和 Enterprise-only Scope；分别未知 objectId、未知 versionId、额外 projectId 均验证失败，renderer 同时拒绝；合法对照通过。                                                                        | 原反例已修复                                       |
| R6 / P2 | header 必须是 childUnitIds 首行、真实 TABLE_ROW / HEADER 且持最低 row ordinal。合法图中将最后一行改为 header 的原反例在 validator 和 renderer 均拒绝。                                                                                               | 原反例已修复                                       |
| R7 / P2 | 未转义删除线、task-list 显式 UNSUPPORTED；转义 tilde、checkbox literal 接纳并可 round-trip，未把无法配对的受支持 marker 提升为扩展语法。                                                                                                             | 原反例已修复                                       |
| R8 / P2 | CODE span 内的 link/footnote/HTML/script 文字原样保留为 CODE；这些语法在 CODE 外仍按既有 UNSAFE / UNSUPPORTED 边界拒绝。                                                                                                                             | 原反例已修复                                       |

本轮没有新增机器 Schema 字段或重新定义首轮 named Contract 的接受集。公开 validator 的 selector 与 TABLE 首行约束已按 owning 规定收紧，旧 profile、Set 语义与 request_render@1.0 未改。技术输入新增 `MarkdownIdentityBinding`：`artifactRef` 必填，`baseRevisionRef?` / `baselineMappingRef?` 可选；parse 有 sidecar 时条件必需，round-trip 必需，optional 的有无也逐项相等。这不宣称未来 TE 权威来源或真实业务接纳已经实现。R4 的确定性生成负例确实触发 Unit 预算，无需为同一反例额外检入重复文本。

### R9 / P2：列表后的相邻分隔线被成功降为文字

位置：`modules/artifact/src/business/markdown-document-service.ts:661`（`isSetextContinuation`），调用处 `:438`，新列表终止逻辑 `:597`。

独立输入：

```text
- item
***
```

预期第二个 Unit 为 `PARAGRAPH / blockKind:THEMATIC_BREAK`，省略 text。实际为 `PARAGRAPH / blockKind:TEXT / text:'***'`。列表的 `#startsBlock` 正确把该行交回外层，但 `isSetextContinuation` 仅检查前一行非空、缩进小于 4；即使前一行已属于 list，也让外层跳过分隔线分支。`***` 本身也不是 setext underline，不能据此作 setext 歧义处理。

renderer 把错误的第二个 Unit 写成转义文字 `\*\*\*`，随后 parse/render 和 canonical Hash 校验仍成功。这证明初次解析已改变分隔线语义，往返一致不能补回它。加入一行空行的对照 `- item\n\n***\n` 则得到真实 THEMATIC_BREAK，render 为 `---`；Delta §3 明确普通分隔线属于支持集、纯空行排版不进入语义，ART §13.6 也声明分隔线正确终止列表。此处不需要扩展 grammar 或新规划。

修复应按当前实际块上下文及真正 setext underline 判断，保留相邻普通分隔线；不能把已识别的支持结构落成成功的 literal 替代。增加直接检查初次 tree 的无空行列表→分隔线用例，与带空行、真实 setext 拒绝及 round-trip 对照成对验证。

### 本轮验证及证据边界

| 证据                        | 核对结果                                                                                                                                                                                                                                                  | 边界                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact revision / repository | PR head 与本地 `a2d40d41175f371d01fe6599d463c7edd61e1676` 一致，base 未变，PR 为 OPEN / 非 Draft；本轮开始工作区干净。                                                                                                                                    | 当前分支已经包含原 Review.md；下面首轮“未提交”措辞只描述首轮发表时状态。                                                                                              |
| 当前配置 CI                 | [run 38141950821](https://github.com/qzhike/zhiju-business-core/actions/runs/38141950821) 的 headSha 精确匹配；select/checks/persistence/verify 全部 SUCCESS。独立核对实际 Verify code、clean build prerequisites 与 Docker/PostgreSQL persistence 步骤。 | 覆盖 ready PR 要求的 full，复用当前证据，不重复本地 full；绿色 CI 不取代语义审查。                                                                                    |
| 独立定向验证                | `node node_modules/vitest/vitest.mjs run tests/business/pr275-rereview-probe.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/pr275-rereview-probe-results.json`；最终 1 file / 15 tests，14 PASS、1 FAIL，1.17 秒。                  | 上轮 8 条原反例和合法控制已通过；唯一 FAIL 为 R9 的 THEMATIC_BREAK 预期。失败前实际错误 tree 的 round-trip / Hash 相等检查已通过。该命令是语义诊断，未冒称配置 full。 |
| 临时材料                    | 最终 probe 源在 `/private/tmp/pr275-rereview-probe.test.ts`，结果在 `/private/tmp/pr275-rereview-probe-results.json`。                                                                                                                                    | 临时源已从仓库移除；没有修改产品代码、原测试、Contract 或 owning Spec。                                                                                               |
| 正式记录                    | 本轮仅更新 `.vibe/reviews/pr-275/Review.md`，保留首轮发现、证据与发表链接，并补入第二轮 review / R9 读回链接。                                                                                                                                            | 第二轮增量未 commit/push，不属于已审 head 或其 CI。                                                                                                                   |
| Focused 文档检查            | 新 Review.md 的单文件 Prettier、Markdown fence/conflict 与工作区 `git diff --check HEAD` 均 PASS；语义反例使用 text fence，保持原始行和星号。                                                                                                             | 只覆盖本轮正式记录增量，不冒称该页已包含在 current head CI 或获得新的 full 证据。                                                                                     |

### 本轮交付边界

R9 为既有支持集内的实现缺陷，当前结论是 REQUEST_CHANGES。修复后应复审新 head 和对应门禁。Issue #270 要求的精确修订人类实现技术批准依然未提供；PR #269 的设计批准不替代它。未来 TE、候选封存、Head、Attempt/Binding/Representation、公开 Diff/下载、Host/Runner/OIDC/HTTP、Browser 与独立人工内容验收仍为本切片的 NOT IMPLEMENTED / NOT RUN。没有修复产品、commit、push 或 merge。

已发表 COMMENT review 与 1 条 P2 行内意见，完整读回匹配本地准备的评论和精确 SHA；这不是 GitHub APPROVED / CHANGES_REQUESTED 事件。

## 第一轮审查：历史记录 `6195c76`

以下保留首轮原始判断与当时执行事实；当前修订的状态和发现以上方第二轮复审为准。首轮记录已随修复提交进入 `a2d40d4`，其原“未提交”表述不代表本轮开始时的工作区状态。

- PR：<https://github.com/qzhike/zhiju-business-core/pull/275>
- Issue：[#270](https://github.com/qzhike/zhiju-business-core/issues/270)，T2 闭口 Markdown canonicalization / round-trip 技术管线。
- 审查日期：2026-10-11。
- 角色与结论：`Reviewer / REQUEST_CHANGES`。
- 已审 SHA：`6195c76ef00ce6933fba48eb99fda6553ec175e6`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 已发表：[COMMENT review 5483294839](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5483294839)，2026-10-11 12:28:22 UTC；已读回 outcome、精确 commit_id 和全部 8 条 comments。
- 本记录由 Reviewer 在上述提交之后新增，不属于该 SHA 或其 CI；未 commit、push 或 merge。仅有此正式记录的工作区变更，临时探针已移出仓库。

## 独立判断依据与范围

本轮读取 `.vibe/project.yaml`、`vibe-development` Reviewer / Contract Review、HL-Spec 第 1–6、8–11 节、最新 Issue #270、ART §13.2/13.6、IG Markdown owning 章节与相关 Module-Test。先从验收及已批准设计建立预期，再检查实际 base-to-head diff、源代码、测试及精确修订 CI。

设计权威为 `d5ff5f0be1a492233f7ff3f0fac51b68a740a9de` 的 #259 Delta §3 和 ART §13.2，及 [PR #269 的精确修订人类设计批准](https://github.com/qzhike/zhiju-business-core/pull/269#issuecomment-6093748821)。直接比较该设计快照与被审修订：相关规范段落未被本实现重定义，新增了 #270 实现状态；已存在于当前 base 的 #260 增量不当作本 PR 的实现扩展。

独立预期：

1. 支持语法的初次解析保留标题、原编号、空格、硬换行、格式和表格结构；round-trip 相等不能掩盖初次解析已经丢失的语义。
2. 受信 sidecar 与精确 Artifact/Project、document、base/mapping、candidate output 和 raw bytes 绑定；每个 node / column 必须完整对应实际解析结果，不能凭节点数量或文本相似度认定身份。
3. 注册 selector/version、封闭字段和 graph 规则在公开 validator / renderer 边界生效；危险内容和未知扩展拒绝，inline code 内按 literal text 处理。
4. 文件、Unit、深度、表规模、文本和资源预算必须实际限制输入；raw hash 与 cv1 canonical content hash 保持分域。
5. 只评审本 Issue 的技术库、schema 和导入的必要设计，不要求非目标中的 TE 业务链、持久化 Handler、公开下载或 Browser 流程。

## Contract 字段对账

以下按实际新增 named definitions 对账，含 required/optional、枚举和集合语义。`U` 表示各 Unit 必填的 `unitId/unitType/ordinal/childUnitIds/semanticMetadata`；`O` 表示可选 `parentUnitId/evidenceRefs`。`childUnitIds` 按原 Canonical 身份关系唯一，`evidenceRefs` 保持既有 Set 语义；其余普通数组没有新增通用去重限制。

| Named Contract                   | Required 字段 / 接受集                                                                  | Optional / 条件 / 对账结果                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `markdownInlineSpan`             | `start/end/kind`；STRONG/EMPHASIS/CODE/HARD_BREAK                                       | code-point 半开区间及 HARD_BREAK 的 LF 检查存在；不嵌套，STRONG/EMPHASIS 可同区间组合。                      |
| `markdownInlineSpans`            | `markdownInlineSpan[]`，允许空数组                                                      | 普通有序数组，未加 `uniqueItems`。                                                                           |
| `markdownSectionMetadata`        | `markdown:{headingLevel,inlineSpans}`                                                   | headingLevel=1..6；对象闭合。                                                                                |
| `markdownParagraphTextMetadata`  | `markdown:{blockKind:TEXT,inlineSpans}`                                                 | 对象闭合。                                                                                                   |
| `markdownListItemMetadata`       | `markdown:{blockKind:LIST_ITEM,inlineSpans,listId,listKind,listOrdinal,listDepth}`      | `orderedMarker?` 保持 owning 表中的可选声明；ORDERED/UNORDERED、depth=1..6。未将可选字段提升为必填审查要求。 |
| `markdownThematicBreakMetadata`  | `markdown:{blockKind:THEMATIC_BREAK}`                                                   | 无 inlineSpans；对象闭合。                                                                                   |
| `markdownTableColumn`            | `columnId/ordinal/alignment`                                                            | NONE/LEFT/CENTER/RIGHT；顺序/重复由跨单元 validator 检查。                                                   |
| `markdownTableMetadata`          | `markdown:{columns,headerRowUnitId}`；columns 非空                                      | `captionUnitId?`；header 的真实首行约束缺失，见 R6。                                                         |
| `markdownTableRowMetadata`       | `markdown:{rowRole}`                                                                    | HEADER/DATA；对象闭合。                                                                                      |
| `markdownBlankTableCellMetadata` | `markdown:{columnId,valueState:BLANK,inlineSpans:[]}`                                   | 空 cell 禁 text；对象闭合。                                                                                  |
| `markdownTextTableCellMetadata`  | `markdown:{columnId,valueState:TEXT,inlineSpans}`                                       | TEXT cell 必填非空 text；对象闭合。                                                                          |
| `markdownDocumentMetadata`       | `fileKind/fileCode`                                                                     | `templateVersionText?`；五种 fileKind 与文档闭集匹配。                                                       |
| `markdownSectionUnit`            | U + `text`，unitType=SECTION                                                            | O；使用对应封闭 metadata。                                                                                   |
| `markdownParagraphTextUnit`      | U + `text`，unitType=PARAGRAPH                                                          | O；TEXT metadata。                                                                                           |
| `markdownListItemUnit`           | U + `text`，unitType=PARAGRAPH                                                          | O；LIST_ITEM metadata。                                                                                      |
| `markdownThematicBreakUnit`      | U，unitType=PARAGRAPH                                                                   | O；禁止 text，THEMATIC_BREAK metadata。                                                                      |
| `markdownParagraphUnit`          | TEXT/LIST_ITEM/THEMATIC_BREAK 的 oneOf                                                  | 无额外字段，按 blockKind 分支。                                                                              |
| `markdownTableUnit`              | U，unitType=TABLE                                                                       | O；禁止 text，TABLE metadata。                                                                               |
| `markdownTableRowUnit`           | U，unitType=TABLE_ROW                                                                   | O；parent 必须是 TABLE 的约束在 validator。                                                                  |
| `markdownBlankTableCellUnit`     | U，unitType=TABLE_CELL                                                                  | O；禁止 text，BLANK metadata。                                                                               |
| `markdownTextTableCellUnit`      | U + `text`，unitType=TABLE_CELL                                                         | O；TEXT metadata；parent 必须是 TABLE_ROW。                                                                  |
| `markdownTableCellUnit`          | BLANK/TEXT 的 oneOf                                                                     | 无额外字段。                                                                                                 |
| `markdownDocumentUnit`           | SECTION/PARAGRAPH/TABLE/TABLE_ROW/TABLE_CELL 的 oneOf                                   | 封闭形状及一般 graph 检查存在；本 profile 首行条件见 R6。                                                    |
| `markdownDocument`               | `documentId/title/units/metadata`；units 非空                                           | 无额外字段；Unit 上限的 parser enforcement 缺失，见 R4。                                                     |
| `markdownDocumentContent`        | `schemaRef/contentType:STRUCTURED_DOCUMENT/canonicalizationVersion:1/body`              | schemaRef 仅 generic VersionedRef，未核 registered selector，见 R5。                                         |
| `markdownIdentityMapNode`        | `sourceNodePath/unitId/type/ordinal`                                                    | `parentUnitId?`；五类 type 闭合，但 parent/ordinal/path 的实际对应缺失，见 R2。                              |
| `markdownIdentityMapColumn`      | `tableUnitId/columnId/ordinal`                                                          | 实际覆盖和对应检查缺失，见 R2。                                                                              |
| `markdownIdentityMap`            | `profileRef/artifactRef/documentId/candidateOutputId/markdownBytesSha256/nodes/columns` | `baseRevisionRef?/baselineMappingRef?`；形状及重复 node 检查存在；绑定和完整性见 R1/R2。                     |

新注册 JSON 与生成镜像一致；旧 Canonical schema / contentType / request_render@1.0 语义未在 diff 中变更。本轮没有把注册文件的静态封闭等同于运行时 selector 检查。

## 阻塞发现

### R1 / P1：sidecar 未绑定精确 Artifact、Project、base/mapping 和 output

位置：`modules/artifact/src/business/markdown-document-service.ts:1063`。

`assertIdentityBinding` 只比较 profile、documentId、Enterprise 和 raw digest。公开 parse 请求没有本次预期 Artifact/base/mapping 参数，`candidateOutputId` 也未与本次 derivation 对比。合法 fixture 中替换 Artifact objectId、同 Enterprise 的 projectId、candidateOutputId，或添加另一份形状合法的 baseRevisionRef/baselineMappingRef，仍继承原身份并得到相同 contentHash。

Issue Acceptance 第三项及 ART §13.2 要求错 Artifact/base/mapping 绑定拒绝、现有身份仅来自精确受信来源。应提供并核验 owning caller 的预期绑定和受信身份来源；保留受控技术 fixture provenance，不要求本切片伪造 TE Receipt。

### R2 / P1：数量相同不证明 sidecar 完整对应，parent/ordinal/columns 被忽略

位置：`modules/artifact/src/business/markdown-document-service.ts:1103`。

完整性仅比较 `units.length === map.nodes.length`。将每个 sidecar node 的 parentUnitId 改为不存在的父节点、ordinal 改为 999，parse 和 round-trip 仍成功，因为 materializer 重新计算关系而不比较声明。将一个真实 path 替换成唯一但不存在的 path，或将所有 column facts 换成不存在表的 column，仍成功；缺失项由 derivation 补出。

应将 materialized sourceNodes/sourceColumns 与 sidecar 逐项完整对账：精确 path、kind、身份、parent、ordinal、每张表 column 覆盖，无缺项、额外项或歧义；错误返回 IDENTITY_INVALID。不能以同长度或结构校验通过代替 correspondence。

### R3 / P2：列表续行吞掉硬换行和后续 ATX 标题，round-trip 无法发现初次丢失

位置：`modules/artifact/src/business/markdown-document-service.ts:564`。

输入 `- first  \n  second\n` 的两个行尾空格应形成 HARD_BREAK，当前变为 `text='first   second'`、spans=[]。输入 `- item\n# Heading\nbody\n` 得到一个 LIST_ITEM 的 `text='item # Heading body'`，没有 SECTION。这两份已丢失语义的 tree 都通过 round-trip 和 hash 比较。

应保留 marker 行与续行之间的原硬/软换行语义，并在列表扫描中识别结束列表的块边界；加入这些相邻结构的正向断言，直接检查初次 canonical tree，不能只依赖 parser 与 renderer 相互一致。

### R4 / P1：表格路径没有计算 Unit，绕过 100000 上限

位置：`modules/artifact/src/business/markdown-document-service.ts:438`。

普通段落调用 `#countUnit`，列表调用 `#countAstUnits`，table 分支只 scan/attach，不调用任何 Unit 计数。`'| h |\n|---|\n| v |\n\n'.repeat(20001)` 仅 380019 bytes，每张表均合法且远低于单表规模限制，却成功 materialize 100005 Units。更大同类输入还会进入 graph validation 和多次 canonicalization，注册的 Unit/资源边界失效。

应在 materialization 前计入 TABLE、全部 TABLE_ROW/TABLE_CELL，并及时执行统一预算与 deadline；越界整文件返回 LIMIT。增加低于字节上限、但超过 Unit 上限的有效表格负例。

### R5 / P2：公开 Markdown validator / renderer 接受未知 selector 和 version

位置：`contracts/src/registry.ts:193`。

对合法解析结果仅将 schemaRef.objectId/versionId 换为未注册 UUID，`validateMarkdownDocumentContent(...).valid` 仍为 true，`renderMarkdownDocument` 也成功。机器 schema 只引用 generic VersionedRef，invariant 没有调用已有 `isMarkdownDocumentSchema` 或等价的精确检查。固定注册 JSON loader 只约束部署注册文件，不能约束实际 caller payload。

应在这一唯一公开 validator 中校验 registered objectType/objectId/versionId、Enterprise Scope 及无 projectId 的完整接受集，使 renderer 的前置验证也生效；保留旧 profile 接受集。对应 Issue Acceptance 第一项和 ART §13.2/13.6。

### R6 / P2：TABLE.headerRowUnitId 可指最后一行，validator 仍成功

位置：`contracts/src/markdown-document.validation.ts:160`。

合法两行表中把第一行 role 改为 DATA，第二行改为 HEADER，并令 headerRowUnitId 指向第二行，graph 与 schema validator 均通过。renderer 把 D 行移到输出 header，把原 H 行放到数据区，实际顺序由坏 metadata 改写。当前检查仅要求同表/HEADER，没有 owning 规定的“真实首行”。

应核对 headerRowUnitId 与实际首个 row identity/ordinal 一致，并验证真实 header row 的唯一性及其 graph 关系；在公开 validator 加入合法 graph 的定向反例。ART §13.2 TABLE 明确要求真实首行，这不是新的规划决定。

### R7 / P2：不支持的 inline extension 被接纳为成功 literal 替代

位置：`modules/artifact/src/business/markdown-document-service.ts:724`。

输入 `~~removed~~` 被接纳为 TEXT、spans=[]；renderer 转义 tilde 后的结果仍通过 round-trip。profile 没有 strikethrough 类型，ART §13.2 与 Delta §3 要求识别未知 syntax / 不支持扩展后整文件 UNSUPPORTED，不能作为成功纯文本替代。

应对未转义的、不在允许集中的扩展作明确拒绝，并保留 contract 已允许的无法配对 star/backtick literal 规则；加入独立 negative fixture 及 escaped literal 对照。不能通过扩展 grammar 或静默降级来关闭此项。

### R8 / P2：全串危险语法预检查错误拒绝 inline code 的 literal 内容

位置：`modules/artifact/src/business/markdown-document-service.ts:636`。

`parseInline` 在解析 code span 之前对整个 source 执行 link/footnote/script regex。合法 `` `[label](https://example.com)` `` 返回 UNSAFE，而 `` `ordinary code` `` 正常接纳。这里没有外链执行或 DOM 解析，内容都在已批准 CODE span 内。ART §13.2 明确规定 inline code 内只按文字处理。

应按解析上下文识别危险语法和转义，CODE span 的内容保留 literal；同时保留 span 外真实链接、图片、HTML 等拒绝对照。避免把保留 code 文字误解为扩大外链接受集。

## 验证与证据边界

| 证据                        | 核对结果                                                                                                                                                                                                               | 边界                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository / exact revision | `vibe repo --json` 为 qzhike/zhiju-business-core、上述 head；远端 PR head/base 一致，发表前再次读取未变                                                                                                                | 初始工作区干净；本正式记录在之后新增。                                                                                                                                 |
| 当前配置门禁 CI             | [run 38133987026](https://github.com/qzhike/zhiju-business-core/actions/runs/38133987026) 的 headSha 为上述 SHA；select/checks/persistence/verify 全部 SUCCESS                                                         | 已核对 workflow 与实际步骤：clean + verify:code、clean build、Docker/PostgreSQL persistence gate 均执行，覆盖 ready PR 所需 full；复用当前 CI，没有重复本地 full。     |
| 独立定向反例                | `node node_modules/vitest/vitest.mjs run tests/business/pr275-review-probe.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/pr275-review-probe-results.json`；最终 1 file / 15 tests PASS，2.59 秒 | 探针断言当前实现的具体错误行为；PASS 表示反例成功复现，不是产品满足契约。包括合法 parse/round-trip、错 raw hash 拒绝、普通 CODE 对照；只采用修正后形状合法的引用反例。 |
| 临时材料                    | 最终 probe 源保存在 `/private/tmp/pr275-review-probe.test.ts`；结果在 `/private/tmp/pr275-review-probe-results.json`                                                                                                   | 探针已从仓库删除；没有修改产品、registry、原测试或 owning 规格。不是并行任务计划或普通验证日志。                                                                       |
| Diff whitespace             | base-to-head `git diff --check` 的两处 trailing whitespace 是既有新增 fixture 中用于 HARD_BREAK 的两空格                                                                                                               | byte-exact 语义输入，不作为格式缺陷；未删除这些空格。                                                                                                                  |

本轮未把 optional orderedMarker 或实际 renderer parse 失败的错误码提升为新契约要求。所有报告缺陷均来自已有 Issue / 已批准 owning 语义，修复不需要新规划或范围扩展。

## 交付边界

- GitHub 已发表并读回 COMMENT review，包含上述 outcome、精确 SHA、证据和全部 8 条行内发现；发表后再次读取 PR，head 未变，review 状态为 COMMENTED。它不是 GitHub APPROVED / CHANGES_REQUESTED 事件。
- Issue #270 的新 T2 实现人类技术批准尚未提供；#269 的设计批准不替代本实现的精确修订批准。应先修复阻塞项，再独立复审修复 head 和其所需 CI，最后完成适用人类技术门禁。
- TE 准备/确认/执行与恢复、真实候选封存及 Head、公开 Diff/下载、Attempt/Binding/Representation、真实 Host/Runner/object store/OIDC/HTTP、Browser/平台及独立人工内容验收保持本切片的 `NOT IMPLEMENTED / NOT RUN`；本轮没有执行或要求扩展到这些非目标。
- 本轮不修复实现、不 commit/push、不合并。正式记录的 Git 交付独立待授权，不能声称本页已包含在 reviewed SHA 或其 CI。

## 已发表行内意见

| 发现    | GitHub 读回链接                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| R1 / P1 | [精确 identity 来源绑定](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564644)      |
| R2 / P1 | [完整 sidecar correspondence](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564647) |
| R3 / P2 | [列表硬换行与标题边界](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564649)        |
| R4 / P1 | [表格 Unit 预算](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564651)              |
| R5 / P2 | [未知 selector/version](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564657)       |
| R6 / P2 | [真实首行 HEADER](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564660)             |
| R7 / P2 | [未知 inline extension](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564664)       |
| R8 / P2 | [CODE literal 内容](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564669)           |

正式记录的 focused Markdown fence/conflict 检查与单文件 Prettier 检查通过；这些只覆盖新 Review.md，不声称该页已经取得 reviewed SHA 的 CI 或新的配置 full 证据。
