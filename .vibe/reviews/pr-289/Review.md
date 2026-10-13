# PR #289 独立实现审查

## 当前 main 集成复审与人类实施技术批准：8ce4665

- 日期：2026-10-13（Asia/Shanghai）；本轮结论：`Reviewer / APPROVE`。本轮独立审查绑定 `8ce4665b0d7516d01ca5dc77ca5c90ad39bed0d0`；本地与 GitHub head 一致，base 为 `55af2e84c7d2e762a7a8f2c29b12a272e6d4b912`。该修订整合当前 main，包含生产工作台/ZIP 页面与 #279 阅读路由的组合；不把旧 `97de915` 的批准或 full 当作本轮证据。
- 用户在明确绑定上述新 head 的技术批准问题中回复“批准新修订的实施技术变更”。本条记录适用于该精确实现修订的 Human 实施技术批准；既有合并、关闭 #279 和删除对应分支的授权保持有效，#286 不因此关闭。
- 独立依据 Issue #279、UI01 exact source/会话边界及 ART/IG/IP 权威约束复核四处冲突组合和自动合并结果。`TrustedApp` 同时保留 main 工作台、ZIP 页面及 #279 精确阅读路由；`reviewScopeKey` 保留 exact pathname + binding，当前会话/主体/Scope guard 继续过滤迟到结果。`WorkbenchNavigation` 只保留导航引用，不保存正文或意见。静态服务器保留两类页面路径和固定 Markdown stream；代理取消/中断处理未被回退。七项操作的 Schema、owning 服务和迁移未因本次 main 集成改变，既有字段对账仍适用。
- 独立读取本轮 full 已生成的新 production build，未并发改写构建目录。受控 HTTP + built Chromium **11 场景 PASS**：原 10 项恢复/拒绝场景继续通过；新增导航取消保留意见、确认离开清空受保护阅读状态、exact 深链接重开意见为空。持续 401/403/404 及 current/baseline 拒绝后 500ms 内无自动后续请求，显式重试恰一轮，恢复后可读取。材料位于 `/private/tmp/pr289-integration-browser-probe.mjs` 与 `/private/tmp/pr289-integration-browser-probe-results.json`；该受控呈现证据不替代 owning PostgreSQL/OIDC/Core/BFF 授权验收。
- 独立读取完整本轮宿主日志 `/private/tmp/zhiju-full-8ce4665.log`，核对仓库、exact implementation SHA、配置命令及最终 `status=PASS / target=full / exit_code=0`。文件含导出 header 共 1,048,924 bytes，SHA-256 为 `6b03e4015d16e504e370dfec68bed8e2740816a04f39e4f9d22956c648ac59b4`。普通检查 **120 files / 2,523 tests PASS**，PostgreSQL **58 files / 709 tests PASS**；生产/fixture 构建、4 个 production 工作台浏览器用例、13 个 fixture 用例、architecture、247-operation Catalog 与兼容门禁均通过。已逐项读到 #279 六项真实 built-browser、双下载/拒绝/撤权、四项 observed-output 有界恢复及读后/锁等待授权重验的 passed 行。数据库阶段 1,750.72 秒，二次迁移 no-op，gate passed 且容器已删除。
- 本轮静态检查及独立浏览器未发现新的实现阻塞；R1–R5 修复保持有效。新 exact head 的人类技术批准与必需 full 已满足，独立结论为 APPROVE。GitHub run `38402940919` 在审查时仍有 persistence pending；本结论采用完整本地 full，不将尚未完成的 CI 冒记成功，也未重复运行 full。
- 独立审查待交付的 roadmap 两处 Markdown 修订：D12 未交付能力限定为批次资格/接入，#279 已交付能力限定为现有授权 sealed Revision 的单文件技术审阅/下载；保持 #286、意见提交/私人草稿、TE 准备/确认、D12 批次及 IM-UI-01 Current 边界。这一 roadmap 与本 Review.md 的增量为后续单独文档交付，不包含在上述 implementation SHA 的 full 中；须保留不同交付 SHA 与最终 PR CI 状态，不能把 mixed PR 降级为 docs-only 验证。
- 生产部署、实际 Windows/macOS Chrome/Edge 全矩阵与独立 Human 内容验收仍 NOT RUN。本次 Reviewer 未修改产品源码、commit、push 或 merge；已授权交付仍须检查最终文档修订和 PR 门禁。

## 人类实施技术批准与最终结论：97de915

- 日期：2026-10-13（Asia/Shanghai）；当前角色结论：`Reviewer / APPROVE`。
- 用户在第三轮复审明确列出剩余 Human 实施技术批准门禁后，于本会话回复“批准”。该批准绑定已审实现 SHA `97de9154c5b5fb60845556a2d7c8a96ce3e9b763`，完成 Issue #279 的适用人类实施技术批准要求。
- 批准记录前重新执行 `vibe repo --json`，并读取 GitHub 最新 head/base；本地与远端 head 均仍为上述 SHA，base 仍为 `b28a004a48c60decb975494f4d7ecbebff9f46b8`，PR 为 OPEN / Draft。实现未变，复用第三轮已核实的 full PASS 与 10 场景独立浏览器证据，不重复运行验证。
- R1–R5 均已解决，没有剩余实现审查阻塞。此前 HUMAN_REVIEW_REQUIRED 是第三轮发表时的历史状态；取得本次人类批准后，当前 outcome 更新为 APPROVE。
- 本批准为当前实现的技术批准，不变更生产部署、实际平台浏览器矩阵或独立 Human 内容验收的 NOT RUN 事实，也不扩大为 commit/push/merge 授权。正式记录仍在本地未跟踪目录，待后续授权交付。
- GitHub 批准记录已发表并完整读回：[COMMENT review 5503922251](https://github.com/qzhike/zhiju-business-core/pull/289#pullrequestreview-5503922251)，2026-10-13 13:03:03 UTC，state=COMMENTED；完整正文及精确 commit_id 与本地材料一致。该 COMMENT 承载 APPROVE 结论并记录用户明确批准，不冒充 GitHub Human APPROVED review 事件。

## 第三轮复审：97de915

- 日期：2026-10-13（Asia/Shanghai）；角色结论：`Reviewer / HUMAN_REVIEW_REQUIRED`。本轮未发现新的实现阻塞，R4/R5 已修复，原 R1–R3 修复保持有效。
- 已审 SHA：`97de9154c5b5fb60845556a2d7c8a96ce3e9b763`；Base：`b28a004a48c60decb975494f4d7ecbebff9f46b8`；PR 仍为 OPEN / Draft，Issue #279 验收未改变且无新增 comments。
- 本轮相对 `08cbb54` 只改 4 个文件、229 additions / 26 deletions：阅读适配器、built-browser 测试及 UI Spec/Test。公开 Schema、操作身份、ART/IG/IP 后端未改变，首轮完整 Contract 字段矩阵继续适用。审查前工作区只有既有未跟踪 Review.md，没有修改产品实现或原测试。

### 独立预期与修复核对

依据 Issue #279 与 ART/UI01 的 exact source 授权、敏感状态清理和意见保留约束，复核要求为：双版本比较的所有保留来源均需独立复验；任一确认失权清除相关受保护数据；单纯资源拒绝不能导致无限 Session reload；显式恢复需要新读取并拒绝旧请求迟到结果；辅助故障在仍受权时保留意见。现有上下文包含前轮实现，因此本轮是基于权威要求的增量复审，不声称盲审。

| 发现 | 当前结论 | 代码与独立证据 |
| --- | --- | --- |
| R4 基线失权保留旧内容 | RESOLVED | `retainedReadPermission()` 逐项读取 current/baseline，并将各响应与各自 Ref 校验；任一 DENIED 经 `fail()` 清空比较与意见、abort 请求、撤销 objectURL。current UNKNOWN 仍继续核 baseline，不能掩盖后者 DENIED。分页和下载两条入口均使用公共检查 |
| R5 资源拒绝自动循环 | RESOLVED | 403/404 清理后停在稳定错误状态，显式 read retry；401 显式 Session check。`readAttempt/currentAttempt` 和 AbortController 拒绝旧代次响应。持续拒绝下无自动请求，明确重试只发一轮，恢复权限后可重新打开 |
| R1 可恢复错误丢意见 | 保持修复 | 正常下载、stream404 与 page503 均保留意见；stream404 现在确实重验两个来源 |
| R2/R3 渲染超时/提交前授权 | 保持修复 | 本轮 owning 实现未变；本 SHA 完整日志中的四个超时恢复用例与合法 replay/读取及锁等待撤权用例均 passed |

UI Spec/Test 的新增说明与修复一致，并明确区分受控 baseline/status 响应的呈现层证据与真实 IP Grant 撤销的 owning 证据；未将 fixture 提升为真实授权验收。

### 当前修订的验证证据

- 用户提供完整原始日志 `/private/tmp/zhiju-full-97de915.log`，独立读取并核对 repository、精确 SHA、配置命令、前后 head 未变声明、测试结果与最终退出状态。该文件是完成执行的 stdout/stderr 导出，不只采用 PR 作者的 prose summary。文件 1,049,182 bytes，SHA-256 为 `965a290ce97149bd52dc5d4f1bf3f5bc4aa0154bd69af95cfdfafcf69243573a`。
- `vibe verify full --json` **PASS / exit 0**，宿主执行、当前 OrbStack context；code **118 files / 2,517 tests PASS**，PostgreSQL persistence **58 files / 709 tests PASS**。格式、lint、类型、生产构建、workspace、architecture、generated contracts、247-operation catalog、冻结 200-operation compatibility 均 PASS；二次 migration no-op，容器已删除。已逐项核到 R4/R5 新增 browser 及 R2/R3 对应 PG 用例的 passed 行。
- 当前 SHA 的 GitHub Actions 仍无 run/checks。收到上述原始日志前已启动本轮重复 full；确认相同修订的完整证据后，对重复 Vitest 发送 SIGINT，让 gate 正常删除临时容器 `fe53f3217df9`。重复运行的 code 也为 118 files / 2,517 tests PASS，但该重复运行最终为主动中止，不用于证明 full 通过；它不覆盖或推翻已完成日志的 PASS。
- 独立新生产构建 PASS：pinned pnpm 11.19.0 的 `--filter @zhiju/workspace-web build`，bundle `index-1QK6Th0-.js`。
- 独立 built Chromium **10 场景 PASS**：正常下载、可恢复 stream404/page503、current denial、分页后的 baseline-only denial、下载后的 baseline-only denial、current UNKNOWN + baseline DENIED、初始持续 401/403/404。确认失权后敏感文本/意见消失、500ms 内无自动后续请求、显式重试恰一轮、恢复权限后意见为空并能再次读取。stream404 正对照实际核验 current/baseline 两个 Ref。正常 DTO 全部通过当前公开结果 Schema。
- 临时探针与结果为 `/private/tmp/pr289-round3-browser-probe.mjs`、`/private/tmp/pr289-round3-browser-probe-results.json`。受控 HTTP + 当前生产构建证据，与 full 中实际 PostgreSQL/OIDC/Core/BFF 旅程区分；不声称受控拒绝响应本身就是实际 IP 授权撤销。

### 结论与交接

R1–R5 当前均不再构成实现阻塞；本轮未发现新的阻塞问题。Issue #279 明确要求适用 Human 实施技术批准，已有 #259 设计批准不代替当前实现修订的批准，当前没有该人类批准证据，因此 role outcome 为 `HUMAN_REVIEW_REQUIRED`。生产部署、实际 Windows/macOS Chrome/Edge 全矩阵与独立 Human 内容验收继续 NOT RUN。

第三轮已发表并完整读回：[COMMENT review 5503893565](https://github.com/qzhike/zhiju-business-core/pull/289#pullrequestreview-5503893565)，2026-10-13 13:00:51 UTC，state=COMMENTED；完整正文与本地材料逐字一致、commit_id 精确匹配已审 SHA，发表前后 head/base 未变。没有新增缺陷行内 comment，汇总正文明确 R4/R5 已解决。该 COMMENT 承载 HUMAN_REVIEW_REQUIRED，不是 GitHub APPROVE 或人类技术批准。

正式记录保留前两轮历史；本增量位于未跟踪目录，不属于已审 SHA 或其 full 证据，单独进行文档检查。本轮没有 commit、push、merge 或产品修复。重复验证的容器已独立回查确认删除。

## 第二轮复审：08cbb54

- 日期：2026-10-13（Asia/Shanghai）；角色结论：`Reviewer / REQUEST_CHANGES`。
- 已审 SHA：`08cbb54b192e442b973555f3dcf2334851ffa40e`；Base：`b28a004a48c60decb975494f4d7ecbebff9f46b8`。
- PR 仍为 OPEN / Draft；最新 Issue #279 没有新增 comments 或改变验收。修复增量相对首轮为 6 个文件、488 additions / 29 deletions；没有改动公开 Schema、Contract 或模块 Spec，首轮完整字段矩阵继续适用。
- 本轮开始时只有本正式记录未跟踪；local head 与远端一致。没有修改产品实现或原测试；独立探针位于 `/private/tmp/`。

### 原发现的复核结果

| 原发现 | 当前结果 | 独立核对 |
| --- | --- | --- |
| R1 可恢复错误丢意见 | 原 stream404 / page503 反例已修复；关联失权处理仍有下文 R4、R5 | 当前生产 Chromium 中正常下载、stream404、page503 均保留 `UNSAVED_REVIEW_OPINION`；真实当前版读取拒绝会清空正文/意见。辅助错误不再无条件卸载意见组件 |
| R2 回读无时间界限 | 原发现已修复 | 实际服务源的四阶段挂起均按共享 deadline 返回 UNKNOWN；显式恢复复用同一 observation/对象版本并 SUCCEEDED；UNKNOWN 恢复本身也有界。正常成功、挂起 finalize 对照通过 |
| R3 请求提交前不重验 | 原发现已修复 | canonical read 后以及 advisory lock 后重验原授权，覆盖 prior Receipt 返回和新写入；读取期间撤权的独立探针现在拒绝且无 Receipt/Attempt 写入。新增真实 PG 测试还检查锁等待期间撤权及合法同键 replay |

### 当前阻塞发现

**R4 / P2：只重验当前版，基线版失权后仍保留其受保护内容。** 位置：`apps/workspace-web/src/MarkdownReview.tsx:74–84`（行内锚点 78）。`load()` 在 REVISION 比较中同时保留 `revisionRef` 与 `fromRevisionRef` 的正文，变化目录也含旧值；新 `canonicalReadPermission()` 却只读前者。仅旧版失权时，ART 对两个 exact Revision 独立授权的 continuation 可返回 masked 404，而当前版读仍成功。恢复分支因此保留旧正文与 before-values，并提示文件/意见已经保留。

当前 production bundle + 通过公开 Schema 的双版本 DTO 探针复现：继续分页返回 404 后，仅出现一次针对当前版的权限读，`BASELINE_SECRET_REVOKED` 仍在可见页面中，没有向基线版发起重验。Issue #279、UI01 #266/#279 要求实际读取失权清理敏感 DOM/cache；当前版可读不能证明旧版仍可读。应对所有保留的 exact source（包括 baseline）重验，撤权时去除对应正文/旧值或清空页面，同时保留双方仍受权时的辅助错误恢复。补充仅基线失权、仅当前版失权和可恢复故障对照。

**R5 / P2：持续资源拒绝导致无限 Session 重查/重新挂载循环。** 位置：`apps/workspace-web/src/MarkdownReview.tsx:55–64`（行内锚点 63），调用链包括 `TrustedApp.tsx:141–144`、`:250–271` 与 `trusted/hooks.ts:60–96`。`fail()` 将所有 canonical 403/404 都传给 `onSessionFailure()`；有效 Session 再次返回同一 ALLOWED 后页面重新挂载、自动读同一不可见 Revision、再 fail/reload。不存在重试上限或稳定的不可用状态，首次打开不可见 exact link 也会触发。

独立有界 Chromium 探针在当前版持续 404、同一 Session 持续 ALLOWED 时，正文/意见已清理，但随后 500ms 内新增 338 次 Session 请求，并伴随 canonical 反复读取。新增集成用例只等待意见 detached，不能证明重试已经停止。应保留敏感状态清理，区分资源无权与 Session 失效；必要 Session probe 有界，原 exact binding 持续拒绝时停在稳定不可用状态，通过显式重试恢复。补充持续 403/404 + 不变 ALLOWED Session 下请求停止的验证。

### 第二轮验证与发表

本轮 GitHub 没有当前 SHA 的 Actions run/checks。宿主 `vibe verify environment --json` PASS，当前 Docker context 与 PostgreSQL 18.6 / Flyway 11.20.3 固定镜像摘要匹配。独立 `vibe verify full --json` 的 code 阶段通过：118 files / 2,517 tests，以及格式、lint、类型、生产构建、workspace、architecture、generated contracts、247-operation catalog、冻结 200-operation compatibility 均 PASS。运行约 17 分钟且两个阻塞反例均已成立后，Reviewer 以 SIGINT 结束仍在进行的 persistence suite；该阶段已运行 958406ms，日志可见原有 Run cancellation/late-final 用例的真实 deadline 等待，不能据耗时断言实现故障或进程挂死。Vitest exit=130，gate 返回 `VERIFY_FAIL`（target exit=1，Vibe CLI exit=21），原因是本轮主动中止；准确结论为 `INTERRUPTED / INCOMPLETE`，没有取得完整 full PASS。gate 已在 finally 中删除本轮 PostgreSQL 容器 `2e669c0004d3`。没有把 PR 作者声明的 full 通过替代为本轮独立证据；修复后的 head 仍需完整当前 full 证据。

- 9 项独立当前源测试 PASS：`/private/tmp/pr289-round2-render-probe.test.ts`，结果在 `pr289-round2-render-probe-results.json`。实际服务/Kysely 路径 + 受控 SQL driver；不将其声称为新增真实 PostgreSQL 验收。
- 当前生产构建的 5 个浏览器场景完成；`/private/tmp/pr289-round2-browser-probe.mjs` / `pr289-round2-browser-probe-results.json`。正常 current/baseline content、directory、download DTO 均通过当前公开结果 Schema。另有 500ms 有界循环探针及结果 `pr289-round2-revocation-loop.mjs` / `pr289-round2-revocation-loop-results.json`。这些是受控 HTTP/UI 证据，区别于 full 中真实 PostgreSQL/OIDC/Core/BFF 旅程。
- 首轮 CI 仅对应旧 SHA，本轮没有复用它作为新 head 的通过证据。正式记录增量不属于已审 SHA，单独做文档格式/whitespace 检查，不冒称纳入该 SHA 的 full。
- 已发表并完整读回：[COMMENT review 5502318868](https://github.com/qzhike/zhiju-business-core/pull/289#pullrequestreview-5502318868)，2026-10-13 10:43:15 UTC，state=COMMENTED，commit_id 精确匹配本轮 SHA；完整正文与本地材料一致。R4 为 [discussion_r4257638958](https://github.com/qzhike/zhiju-business-core/pull/289#discussion_r4257638958)，R5 为 [discussion_r4257638967](https://github.com/qzhike/zhiju-business-core/pull/289#discussion_r4257638967)。两条正文、文件、review/commit 绑定及 REST position=78/63 全部读回一致。文件为 PR 单一全新增 hunk，position 对应上述源行；REST line/side 为 null，不声称返回了这些字段。该事件是 COMMENT，承载 Reviewer 的 REQUEST_CHANGES 结论。

补入最终验证状态后再次完整读回 review，正文与本地最终材料逐字一致、SHA 不变；远端 head/base 未变。正式记录单文件 Prettier、Markdown fence/conflict/SHA/history 与 `git diff --check HEAD` 检查通过；工作区仅本审查目录未跟踪。独立只读 Docker 回查确认本轮容器已删除。

结论：原 R1–R3 反例已纠正，R4/R5 仍须交回 Implementer 修复，再审新 head。适用 Human 实现技术批准仍待取得；生产部署、真实 Windows/macOS Chrome/Edge 全矩阵与独立 Human 内容验收继续 NOT RUN。本轮没有 commit、push 或 merge。

## 第一轮审查：e05058b（历史记录）

- 审查日期：2026-10-13（Asia/Shanghai）。
- 当前角色与结论：`Reviewer / REQUEST_CHANGES`，3 项阻塞发现。
- 已审 SHA：`e05058be3a79578d5bf27d7fd03df04b65a3eadc`。
- Base SHA：`b28a004a48c60decb975494f4d7ecbebff9f46b8`。
- PR：<https://github.com/qzhike/zhiju-business-core/pull/289>；工作项：[#279](https://github.com/qzhike/zhiju-business-core/issues/279)。
- 当前 PR 为 OPEN / Draft；本轮开始工作区干净，local head 与远端一致。
- GitHub 发表与完整读回：[COMMENT review 5500055974](https://github.com/qzhike/zhiju-business-core/pull/289#pullrequestreview-5500055974)，2026-10-13 07:18:32 UTC；state=COMMENTED、完整 body 与精确 commit_id 均匹配本地提交材料。发表前后远端 head/base 均未变。本记录增量不属于上述已审 SHA，未 commit/push。

三条行内意见已完整读回正文、路径、review/commit 绑定与 REST diff position：R1 为 [discussion_r4255784162](https://github.com/qzhike/zhiju-business-core/pull/289#discussion_r4255784162)，position=58；R2 为 [discussion_r4255784171](https://github.com/qzhike/zhiju-business-core/pull/289#discussion_r4255784171)，position=581；R3 为 [discussion_r4255784174](https://github.com/qzhike/zhiju-business-core/pull/289#discussion_r4255784174)，position=216。两文件均为本 PR 全新文件、单一新增 hunk，这些 position 对应下文所审当前源行。REST 读回的 line/start_line/side 为 null，因此不声称平台保存了 R2 的多行范围；已确认其末行锚点。该事件是已发表的 COMMENT review，不是 GitHub REQUEST_CHANGES 事件或人类技术批准。

## 独立预期与审查范围

从最新 Issue #279、ART §13.4–13.5、IG #259、IP Markdown 当前授权规则、UI01 Markdown 阅读切片、Markdown Delta §§3–4/7/9 建立预期，再比对实际 diff、owning 服务、机器 Schema、迁移与测试。已批准 #259 设计不能代替本实现修订的人类技术批准。

预期为：只读取 exact sealed Revision/FROZEN canonical bytes；完整 Diff/稳定 Unit 身份、定位 claim、总条目与去重单元数不随分页改变；原 render operation/Receipt/Attempt 与真实对象版本、完整 round-trip、登记绑定一致；每次当前授权在受保护读取和提交/Receipt 返回前分别重验；外部结果不确定及时落为原 Attempt 的 UNKNOWN，可显式恢复；阅读、下载和未实现操作不产生批准/完成事实。正文仍可读而下载或后续分页暂时失败时，唯一意见区的未保存输入必须保留。实际主体/Scope/Session 或读取权限失效仍须清理敏感内容。

检查七项注册操作、ART/IG/IP/composition、四项 Human BFF allowlist 与固定 stream、Web 适配及共用页面、V7018/V7019 的 owning/RLS/immutable 边界。#286 的后续页面打磨、TE 生成/候选接纳、持久草稿、批准/发布与批次交付不作为本工作项的缺陷。

## 阻塞发现

### R1 / P2：可恢复的下载、分页失败卸载意见区，丢失未保存输入

位置：`apps/workspace-web/src/MarkdownReview.tsx:55–62`、`:162–163`、`:247–251`；输入状态在 `MarkdownReviewPage` 内。

`fail()` 无条件清空 loaded 并切换为整页错误；下载的 404 还会触发 Session re-probe。对象完整性失败、票据失效等安全拒绝也使用 404，不能据此判定 canonical 读取权或 Session 已失效。分页的临时 503 同样调用 `fail()`，使共用页面卸载，意见状态永久丢失。该过程未发生离开链接或关页，已有离开提示无法保护输入。

独立 built Chromium 反例：在同一受权主体/Scope/Session 下先输入 `UNSAVED_REVIEW_OPINION`。正常完整下载后原文仍在；仅使固定下载 stream 返回 404，Session 再次返回同一 ALLOWED 绑定，重新显示正文后的 textarea 值变为 `""`；仅使继续分页返回 503，意见字段与阅读组件均消失，且没有 Session 变化。受控响应的正常 content/directory/download DTO 分别通过当前公开结果 Schema。

违反 Issue #279 的输入保留与正文/下载分别表达要求，以及 UI01 已实现阅读切片的唯一未保存意见区约束。请将后续分页/下载错误显示为可恢复状态，保留当前 exact Revision、导航与输入；对 masked 404 如需确认读取资格，应定向重新核当前读取权，再决定清理。实际登出、主体/Scope/Session 变化或读取权撤销继续按 #266 清理。补充上述故障与真正失权的对照验收。

### R2 / P2：观察落盘后的回读与 round-trip 未设时间界限，原 Attempt 可永久挂起

位置：`modules/integration-gateway/src/renderer/markdown-render-service.ts:579–581`、`:598–602`。

原 output observation 持久化后，正常工作和显式恢复共用的 `verifySource()`、两次 storage read 与 canonical verify 都是裸 await；只有随后 finalize 调用了 `bounded()`。任一 adapter 永不结算时，没有超时进入 catch，原工作持续 CREATED，或显式恢复持续 UNKNOWN 且不返回。外部调用方超时不能使该 owning worker 记录/结束本次不确定结果。

独立当前源探针配置 `timeoutMs=20`，分别挂起 source read、output read、receipt read、round-trip。100ms 后四项工作均未结算、Attempt 仍 CREATED，没有 transition 调用。已 UNKNOWN 的原 Attempt 显式恢复也有同样挂起。对照中完整绑定能 SUCCEEDED，而挂起 finalize 会在同一配置下落 UNKNOWN 并返回；解除各挂起回读后可继续处理同一材料。

违反 IG #279 已声明的异步操作时间界限和 Issue #279 的原 Attempt 不确定性恢复要求。请为这一公共回读/验证阶段的全部外部 await 设置有界预算；超时保留原 Attempt/对象版本/Receipt 与 UNKNOWN，允许之后显式恢复，不以新键重启或将迟到结果直接晋升成功。补充每个阶段的故障对照。

### R3 / P2：新渲染请求在正文读取期间失去 Grant 后仍提交正式 Receipt/Attempt

位置：`modules/integration-gateway/src/renderer/markdown-render-service.ts:209–216`；同事务的 prior Receipt 返回路径也没有最终重验。

`request()` 只在入口调用一次 render-purpose 授权，随后 await canonical source 读取、等待事务 advisory lock，并直接插入 COMMITTED Receipt、Attempt/Audit 或返回 prior Receipt。期间若该 SERVICE 的 `integration.render.request` Grant 撤销/失效，旧 Decision 尚未过期仍会被使用。ART source Port 的自身权限不等于该 render Grant；数据库事务 context 只验证 Scope/Decision 有效期限，V7018 的绑定 trigger 也没有当前 IP Grant 重验。

独立当前源探针在 canonical read 返回时撤销 render 授权（后续 authorize 必拒绝），`request()` 仍返回 CREATED，受控 SQL driver 观察到 COMMITTED Receipt 与 CREATED Attempt，并且授权 callback 恰调用一次。对照中入口已经撤权会立即拒绝且零写入。该探针只证明 owning 服务的调用/写入路径，不声称新增真实 PostgreSQL 授权验收。

违反 IP #259 的“在提交、Receipt 返回前重验”和 #279 的当前 SERVICE 授权规则。请在实际提交与 replay Receipt 返回前，使用原 operation/version/payload/target binding 重验当前 Grant；验证正文读取或锁等待期间撤权会回滚本次新事实，并保留同键、当前仍有权的正常幂等路径。

## Named Contract 字段对账

下表逐项核对 owning 定义与当前 request/result Schema 的字段和 required/optional 列表。`?` 表示 optional；未标记者为 required。闭集对象、条件 required 与数组接受集一起核对，不以生成类型或少数 fixture 代替 Schema。表中无新增字段缺漏阻塞发现；R1–R3 是运行行为与失败语义问题。

| 操作 @1.0 | Payload 字段 | Result/data 字段及边界 |
| --- | --- | --- |
| artifact.get_file_review_content | revisionRef、location? | FileReviewContent 全字段见下表；exact Project Revision，由 owning handler 复验完整 Ref/hash/Scope |
| artifact.get_file_change_directory | toRevisionRef、baselineKind、fromRevisionRef?、filter、page | FileChangeDirectory 全字段见下表；REVISION 必有 from，EMPTY_INITIAL 禁 from；filter 为 chapterUnitId?/text?；page 为 limit 1–100/cursor?，cursor 沿共享 opaqueCursor 512 字符边界 |
| artifact.resolve_file_review_locations | fromRevisionRef、toRevisionRef、locations | locations 为 1–100 普通数组；result 为 items/sourceWatermarks，items 元素见下表，没有添加 Set 去重限制 |
| artifact.register_markdown_representation | revisionRef、renderAttemptRef | representationRef、registrationRef、receiptRef；CREATE target artifact.representation；SERVICE purpose，原 Attempt/operation 与 bytes 在业务服务核验 |
| artifact.get_markdown_download | representationRef | MarkdownDownload 全字段见下表；消费完整 shared RepresentationRef，不删 opaque objectStorageRef 身份字段 |
| integration.request_markdown_render | MarkdownRenderRequest 全字段见下表 | attemptRef、receiptRef、status；CREATE target integration.render_attempt，SERVICE；新 flat 请求与旧 request_render 包装/接受集分离 |
| integration.get_markdown_render_binding | attemptRef | MarkdownRenderBinding 全字段见下表；SERVICE 同时授权 Attempt 和真实 Revision |

| Named Contract | 全字段、条件与集合 |
| --- | --- |
| FileReviewLocation | revisionRef/unitId/unitType/path/claimHash；unitType 五种 Canonical Unit；path 非空普通数组；TABLE_CELL 必填 tableUnitId/rowUnitId/columnId，其他类型禁止这三字段；claim 由完整子树计算 |
| FileChangeEntry | changeId/unitId/kind/chapterUnitIds/contextUnitIds；beforeLocation?/beforeValue?/afterLocation?/afterValue?；ADDED 禁 before，REMOVED 禁 after，CHANGED/MOVED 双端必填；值沿完整 MarkdownDocumentUnit，导航数组保持普通数组 |
| FileReviewContent | revisionRef/canonicalContentHash/profileRef/document/authoritativeIdentityMap/currentUsability/sourceWatermarks；可用性 enum USABLE/STALE/REVOKED；document/map 沿已批准 Markdown 定义；watermarks 元素沿共享 SourceWatermark |
| FileChangeDirectory | exactInputs/algorithmRef/diffHash/totalChanges/changedUnitCount/filteredChanges/chapterGroups/entries/sourceWatermarks、nextCursor?；exactInputs 为 toRevisionRef/baselineKind/fromRevisionRef?；algorithm 固定 artifact.file_diff/1.0；chapterGroups 每项 unitId/title/changeCount；计数非负；entries 与 watermarks 为 typed 普通数组 |
| FileReviewLocationResolution | originalLocation/resolution/reasonCodes、suggestedLocation?；resolution 六值 UNCHANGED/MOVED/CHANGED/REMOVED/AMBIGUOUS/UNSUPPORTED；两个位置保持原/新 Revision，reasonCodes 沿共享 ReasonCode 普通数组 |
| MarkdownDownload | representationRef/revisionRef/checksum/byteLength/mediaType/safeFilename/downloadTicket/expiresAt；byteLength 1–10 MiB；mediaType 固定 text/markdown; charset=utf-8；安全 .md 名称≤100 字符；ticket 有界 base64url，owning 服务签名/≤60 秒/当前授权；RepresentationRef 沿完整 shared 定义 |
| MarkdownRenderRequest | revisionRef/canonicalContentRef/inputHash/outputFormat/rendererId/rendererVersion/markdownProfileRef/structureSchemaRef/rendererDigest/identityMapHash；format 固定 zhiju.markdown，renderer 固定 zhiju.renderer.markdown.canonical/1.0.0；registered selector、digest/map/input 精确相等由 owning 校验 |
| MarkdownValidation | profileRef/structureSchemaRef/rendererDigest/identityMapHash/inputContentHash/roundTripContentHash/outputBytesSha256/outputByteLength/validatorRef/outcome；bytes 1–10 MiB，validator 固定 artifact.markdown_round_trip/1.0，outcome 固定 PASS |
| MarkdownRenderBinding | attemptRef/status/originalOperation/originalRequest/requestPayloadHash/sourceWatermarks；status 四值 CREATED/SUCCEEDED/FAILED/UNKNOWN；原操作固定 integration.request_markdown_render/1.0；仅 SUCCEEDED 必有 succeededResult/rawReceiptRef/markdownValidation，其他状态禁止；Succeeded 沿既有完整 RenderSucceededPayload |

旧 PDF/DOCX/XLSX、200-operation compatibility baseline 与七模块所有权保持原边界。Machine registry 的七项名称/purpose/owner、四项 Human 浏览器 allowlist、新旧 render/登记分离、forward-only migration owning/RLS/immutable 设计均有对应实现与当前 CI；不因此推断全部业务失败语义通过。

## 验证证据与完成边界

| 证据 | 本轮核对结果 | 边界 |
| --- | --- | --- |
| Repository/revision | `vibe repo --json` 为 qzhike/zhiju-business-core / e05058b；远端最新 Issue/PR/head、base 与 local head 一致 | 实现 diff 72 files；本轮不改产品源码/原测试/Contract/Spec |
| Required full | [CI run 38353777824](https://github.com/qzhike/zhiju-business-core/actions/runs/38353777824) attempt 2 的 headSha 精确一致，select/checks/persistence/verify 均 SUCCESS；select log 实际选择 full；checks 的 code、persistence 的 clean build/PG gate 均已运行并成功 | 复用当前可信 full 证据，没有重复本地 full；绿色 CI 未覆盖本轮反例 |
| 独立当前源探针 | `node node_modules/vitest/vitest.mjs run --config /private/tmp/pr289-probe.config.mts --reporter=default --reporter=json --outputFile=/private/tmp/pr289-render-probe-results.json`；1 file / 9 characterization tests PASS，1.33 秒 | 直接加载当前源、真实 Kysely query/事务代码，使用受控 SQL driver；正对照与 R2/R3 反例成立，不冒称真实 PG 新证据 |
| 当前生产 Web 构建 | `/Users/galendai/Library/pnpm/.tools/pnpm/11.19.0/bin/pnpm --filter @zhiju/workspace-web build` PASS | 精确 pinned pnpm；产物仅为 ignored build artifacts |
| 独立 built Chromium | `node /private/tmp/pr289-browser-probe.mjs`，宿主执行；正常下载保留输入、stream404 丢输入、page503 卸载阅读/意见三项均复现 | 当前 production bundle + 通过公开结果 Schema 的受控 HTTP DTO；没有替代 CI 中的真实 PostgreSQL/OIDC/Core/BFF 集成事实 |
| 临时材料 | `/private/tmp/pr289-render-probe.test.ts`、`pr289-probe.config.mts`、`pr289-render-probe-results.json`、`pr289-browser-probe.mjs`、`pr289-browser-probe-results.json` | 位于临时目录，未加入实现 diff |
| 环境恢复 | 沙箱浏览器本机 listen 报 EPERM；宿主诊断成功。默认 pnpm shim 自动版本解析失败；read-only preflight 找到已安装 11.19.0，随后精确 binary 构建成功 | 未关闭签名校验、改 lockfile 或降低验证配置；没有 automatic approval rejection |
| Diff whitespace | reviewed base-to-head `git diff --check` PASS | 正式记录增量另做 focused 文档检查；不冒称已包含在 reviewed SHA 的 CI |

正式记录的单文件 Prettier、Markdown fence/conflict/精确 SHA 检查及工作区 `git diff --check HEAD` 均 PASS。这些仅覆盖本轮 Review.md 增量，不能替代产品修订的 full 或反例修复验收。

本轮结果为 REQUEST_CHANGES，先交回 Implementer 修复 R1–R3，再审修复后的最新 head。Issue #279 明确要求适用 Human 实现技术批准，当前修订尚无该批准证据；本轮评论不代签批准。Windows/macOS Chrome/Edge 全矩阵、生产 Ceph/OpenBao/Renderer 部署与独立 Human 内容验收继续 NOT RUN。未 commit、push、merge 或修改产品实现。
