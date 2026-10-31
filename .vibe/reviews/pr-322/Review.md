当前增量语义复审完成，未发现新增阻断；`6435188` 的本地 full 已通过。本文尚需纳入最终候选，最终 APPROVE 与合并仍待该候选的 required CI 和独立确认。本次审查范围仅为 M1 子 PR 进入 `batch/mvp-v1-ui`。

# PR #322 最终交付增量审查（2026-10-31）

- 候选：`643518872e2a2559e45bde05a26e628349df4bff`；base：`06595a6a94208399559ce5767dd107d0cc097184`；目标：`batch/mvp-v1-ui`。
- 用户在当前会话明确授权合并 PR #322 并关闭关联 Issue #321，作为后续 shadcn/ui 迁移之前的实现基线；该授权不把未执行的 M1 人工验收记为通过，也不授权合入 main。
- 独立 Reviewer 复核 `adea2a3 → 6435188` 的新增范围、当前验证权威及合并组合；保留未变化部分的历史语义分析，不复用旧 SHA 的验证结果。

## 新增范围及独立结论

2026-10-31 的验证基准明确记录用户批准旧平台专用数据库测试退出当前 MVP full。此次审查以保留 MVP 真实持久化与访问保护为依据；旧实现、公开契约与历史证据保留，当前 full 不再宣称覆盖退出范围的旧平台数据库回归。

| 边界 | 独立结论 |
| --- | --- |
| 持久化范围与迁移 | 初次迁移、第二次 no-op 和 info 均使用 `modules/document-delivery/migrations`。保留固定镜像/版本、真实 PostgreSQL、migration history 对照和资源清理；原四个 MVP 入口的场景保留并加强。 |
| 库存与分片 | 固定期望为 5 文件 / 44 个叶级用例，三分片分别为 30 / 7 / 7。库存由独立 JSON 定义；删除注册文件、遗漏、重复、改名、移位、失败及 skipped 均拒绝，三个分片及最终 verify 的要求保留。 |
| 真实 Keycloak | 使用真实 Keycloak → BFF → MVP Core → DocumentDelivery/构建 Web；保留登录、错误 issuer/audience、回调拒绝、刷新和 admin-API 密钥轮换。audience 负例先验证合法 issuer/sub/azp 正控制，再仅改变 aud，并断言 401 与零 owning read；CSRF/Origin 拒绝发生在 Core 调用前。 |
| BFF/UI 组合 | 构建浏览器覆盖 BFF 单独重启、Session 失效、重登和原项目/批次/原包读回。项目列表解析服务实际返回的 Summary，不要求详情专有字段；详情解析保持独立。 |
| 合入的 B1 修复 | 复核 canonical root、实例/attempt flock、旧 writer 排他、完整 staging 恢复、事务期间持锁、分页过滤、cursor batch 绑定及 XLSX 关系目标验证。8 个关键源码/测试文件 SHA-256 与 PR #318 正式 Review 冻结表一致；既有语义分析适用，当前组合仍单独验证。 |
| 浏览器并行 | `workers=4` 保持 `fullyParallel:false`，仅跨文件并行；真实剪贴板场景在同一文件串行，其余使用独立 BrowserContext。生产检查显式单 worker；未删除既有断言、视口或更改零重试策略。 |
| M1 历史发现 | `fixtures`、`mvp`、`markdown` 源码相对 `adea2a3` 无增量，已关闭的 R1–R3、R5–R20 处置继续适用。R4/P3 原建议针对的并排面板、步骤正文长 ID 已由后续上下布局、精简步骤及折叠详情替代，记为 SUPERSEDED，不宣称本轮人工视觉 PASS。 |

本轮没有新增产品缺陷编号。GitHub 的历史线程仍需按以上已关闭或被取代的处置解决；线程解决不构成最终 CI 或 GitHub formal approval。

## 当前验证与交付边界

在 `643518872e2a2559e45bde05a26e628349df4bff` 执行 `vibe verify environment --json` PASS，PostgreSQL/Flyway 为 PIN_MATCH；随后 `vibe verify full --json` PASS / exit 0：160 个普通测试文件 / 3292 tests，13 个生产构建与 134 个开发制品浏览器用例，5 个持久化文件 / 44 tests。关键库存、完整文件库存、MVP 迁移、第二次 no-op 和容器清理均通过。本记录新增前 tracked files 干净；这些是本地实现候选证据，不冒充包含本记录的最终远端合并候选 CI。

本轮只读发现仓库 Actions 已恢复 enabled，现有工作流 active；交付会话没有修改这些设置。目标分支匹配规则仍要求 PR、来自 GitHub Actions 的 `verify`、当前基线和已解决讨论。正式 Review 纳入后，由 PR review/comments 确认最终 head/base、实际 checkout、run/attempt 和独立结论，不为回填 CI 成功再生成文档提交。

用户要求关闭当前实现工作项；M1-3 无引导人工试走、当前 Runner 脱敏输出展示、真实业务内容验收及 batch/main 交付继续保留未完成事实。后续组件迁移与 UI 验收另行规划，本次不创建新 Issue，也不把它们标记完成。

---

以下为 `adea2a3` 及更早候选的历史记录，保留各自当时的 Actions 状态、发现与证据。

HUMAN_REVIEW_REQUIRED。R20 已关闭，当前没有新增代码阻断，本地 full 已通过；最终批准仍需用户明确决定如何处理停用 Actions 下的必需远端 CI 门禁。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`。

# PR #322 R20 共享导出修复复审（2026-10-31）

- Reviewed SHA：`adea2a3aaa5314d27a4ce774555dcb0ece127b3b`；base：`06595a6a94208399559ce5767dd107d0cc097184`；目标 M1 mock 子 PR → `batch/mvp-v1-ui`。本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 重读最新 #321/PR 及评论，验收 E3/E5、UI-MVP-M1-033/035 仍要求实际精确版本字节。审查从 `364fe85` 起完整四文件增量；保留未变化部分既往审查，不借用旧 SHA 的 full。

## R20 · CLOSED

`u2RevisionBytes` 现直接计算 `candidateMarkdown(u2Candidate(...))` 的 UTF-8 长度，与 `u3.tsx` 的 ZIP 成员共用序列化；独立 seed 拼装已移除。新增单测对 18 个候选比较导出字节，并锁定手册 V2=1357、V3=1263；浏览器 V2 期望改为正确 1.3 KB。owning Test 已同步共享导出表示。

独立诊断 `.local/mvp/pr322-review/probe-adea2a3.cjs` 直接读取本 SHA 的实际函数，覆盖全部 21 个候选（含通知表）、不存在文件/版本返回 undefined，并复核 R18/R19 对照。21 个候选字节完全一致，手册 V2/V3 为 1357/1263，申请表 V1 为 584。导入的 u3-model 没有运行时 fixture 反向依赖；无新的语义阻断，增量 `git diff --check` 通过。R18/R19 保持既往关闭。

## 当前验证与门禁

`vibe verify environment --json` PASS：当前 Docker context 可用，PostgreSQL/Flyway 固定镜像均 PIN_MATCH。独立执行当前 head 的 `vibe verify full --json` 返回 PASS / exit 0：160 个 Vitest 文件 / 3287 tests、134 个 built-browser cases、生产隔离、架构与契约检查；69 个 persistence 文件 / 774 tests、96 个关键业务用例及完整文件清单、迁移、二次迁移 no-op 与容器清理全部通过。R20 修正的大小用例及 R18/R19 浏览器回归均通过。执行前后 tracked files 干净，本地和远端 head/base 未变；这是本地 head 验证，不冒充 GitHub 合并候选 CI。

仓库级 Actions `enabled=false`，当前 PR 无 status checks，远端 CI 为 NOT RUN。遵守用户更新的 AGENTS.md，不恢复 Actions 或 workflow、不触发运行、不静默豁免。项目批次设计 §4.3 要求未完成 CI 不提前给出最终 APPROVE；本地验证结果与该远端门禁分别记录，停用下的后续处理需要用户明确决定。

本轮没有新的人工页面试走；M1-3、脱敏 Runner 输出展示、真实集成与 main 交付保持独立。只更新正式审查记录及提交 comments，未修改产品或永久测试，未 commit/push/merge，手动测试环境未改动。正式记录仍未提交。

代码语义复审与本地验证已完成。剩余交接由用户决定：保持 Actions 停用并保留最终批准阻塞，或明确授权恢复 Actions 并执行当前候选的 CI；不将本地 full 自动视作远端门禁豁免。无需为已关闭的 R20 再要求产品修复。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5720427308) 和 [R20 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4429834968)。GitHub 状态为 COMMENTED，正文结论 HUMAN_REVIEW_REQUIRED，review 绑定本次 reviewed SHA；R20 回复已补充最终本地 full 通过证据。

---

以下为 `364fe85` 历史审查；R20 的旧开放状态由上述新候选关闭处置更新。

REQUEST_CHANGES。PR #322 的当前候选 full 已通过，R18/R19 保持关闭，但 R20 实际导出字节不一致仍未修复。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准当前候选进入集成。

# PR #322 full 完成后的同候选复审（2026-10-30）

Reviewed SHA：`364fe85221a55558405af60b1d2224dcfdcbc58c`；base：`06595a6a94208399559ce5767dd107d0cc097184`。本地与远端一致，PR OPEN / Draft；最新 Issue/PR 验收语义及代码均未变化。本轮复用已有增量审查，重新执行精确源码诊断并检查新完成的 CI。

**R20 · P2 · STILL OPEN。** 手册 V2 仍为目录 1402 bytes / 1.4 KB，实际 ZIP 成员 1357 bytes / 1.3 KB；V3 为 1305 / 1263 bytes（1.3 / 1.2 KB），21 个现有候选字节数均不一致。`u2RevisionBytes` 与 `candidateMarkdown` 各自拼装不同 Markdown，大小回归仍断言错误 V2 1.4 KB。E3/E5、UI-MVP-M1-033/035 要求实际版本字节；[原行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424274061)继续有效，PR/Issue 的 R20 已修复文字仍不准确。

**required full · PASS。** [41067437433 / attempt 3](https://github.com/qzhike/zhiju-business-core/actions/runs/41067437433/attempts/3) completed/success；select 选择 full，原因 `batch-engineering-or-unknown-change`。checks、三个 persistence gate、汇总和 verify 全部 success。verify 候选绑定 PASS 明确记录上述 head/base、checkout `b5bf542cd79bb031a16b87f2606d5e8f8b0607fc`、target full、run 41067437433 / attempt 3。checks 为 159 个 Vitest 文件 / 3286 tests、134 个 built-browser cases 通过。只采用 attempt 3 的完整结果，不拼接先前尝试或取消运行。

**R18/R19 · CLOSED。** 当前源码对照及本次 browser 回归继续通过；full 成功补齐了前轮整体门禁证据，但不会消除 R20 语义反例。

只读检查确认仓库级 Actions `enabled=false`，各 workflow 定义仍 active。未修改设置、重启 workflow、触发 rerun 或重复本地 full；已完成的精确候选证据可保留。未来候选在 Actions 停用期间的外部 CI 保持 NOT RUN，不借用本候选结果或擅自豁免门禁；继续授权范围内的本地验证，后续必要的外部门禁决定仍须明确处理。

Implementer 修复 R20 与测试期望、同步处置，并提供新候选验证后复审。本轮仅更新正式审查文档与提交 comments，未修改产品、永久测试、手动测试环境，未 commit/push/merge。正式文档仍未提交；无新人工页面试走，M1-3、脱敏 Runner 输出、真实集成及 main 交付保持独立。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5714464384) 与 [R20 原线程回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4425245780)。review 绑定 reviewed SHA；GitHub 状态 COMMENTED，正文结论 REQUEST_CHANGES，没有重复创建行发现。

---

以下为同一候选的历史复审；其 full 待完成状态由本轮 attempt 3 通过证据更新，R20 仍开放。

REQUEST_CHANGES。PR #322 远端仍为 `364fe85`，没有新增代码修订；R18、R19 已补齐当前候选浏览器证据并关闭，R20 仍未修复。required full 尚无完整通过证据。本结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`。

# PR #322 同候选复审与 CI 证据更新（2026-10-30）

- Reviewed SHA：`364fe85221a55558405af60b1d2224dcfdcbc58c`；base：`06595a6a94208399559ce5767dd107d0cc097184`。本地/远端一致，PR OPEN / Draft。本轮重读最新 PR/#321、评论和新增 CI 结果；验收语义未变，描述增加 R18–R20 已修复字样，没有对应的新代码提交。
- 精确候选未变，复用上轮完整五文件增量审查；复核当前大小函数、测试及 owning Spec，并重新执行当前源码函数诊断，未重复整个配置化验证。

## R18 / R19 · CLOSED

[checks 124093806819](https://github.com/qzhike/zhiju-business-core/actions/runs/41064943887/job/124093806819) 已完成 success。日志检出 `b5bf542cd79bb031a16b87f2606d5e8f8b0607fc`，明确由上述 head 合入上述 base；159 个 Vitest 文件 / 3286 tests、134 个 built-browser cases 通过。

- R18：`m1-file-browser.spec.ts:306` 唯一成员与折叠隐藏回归通过；源码诊断继续确认 12 实体/12 行、单个成员过滤保留容器祖先。
- R19：`:324` 历史 V1 行选中、当前版本父行不被误选、排序/类型视图往返回归通过；实际 handler 诊断一致。
- 关闭的是上述原始发现，不代表 required full 或整个 PR 已批准。

## R20 · P2 · STILL OPEN

`u2RevisionBytes` 与 ZIP 使用的 `candidateMarkdown` 仍分别序列化不同字符串。当前源码诊断再次确认 21 个候选字节数均不一致：手册 V2 为 1402 / 1357 bytes（1.4 / 1.3 KB），V3 为 1305 / 1263 bytes（1.3 / 1.2 KB）。E3/E5、UI-MVP-M1-033/035 的实际版本字节要求没有改变。

`:358` 大小测试虽然在本次 checks 中通过，但它仍断言错误 V2 1.4 KB，不能证明与导出一致。保留 [R20 当前函数行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424274061)，不重复编号。Implementer 应共用实际文件表示/已知字节、以真实导出成员核对含表格候选，并纠正 PR/Issue 过早标记 R20 已修复的文字。

## 完整 CI 与边界

[41064943887 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/41064943887/attempts/1) select 选择 full，原因 `batch-engineering-or-unknown-change`；最终 run 为 cancelled，persistence-2 为 cancelled，persistence/verify 汇总 failure。verify 日志报告 `persistence: expected success` 与 `persistence: expected current attempt 1`。checks 的独立 success 可证明相关回归执行，不能把整个取消运行算为 full 通过；取消本身也不新增产品缺陷。

独立的同 head [41067437433 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/41067437433/attempts/1) 本轮观察到 in_progress，结果保持待完成；不拼接两个 run 的分片。R20 是已确认阻断，不等待 CI 才发布 REQUEST_CHANGES。

下一步由 Implementer 修复 R20、补齐正确测试和新候选 full 后再复审。M1-3 人工试走、脱敏 Runner 输出展示、真实服务、batch/main 交付保持独立。无新的人工页面试走；本轮仅更新正式审查文档及发布 comments，未修改产品、永久测试、手动测试环境，未 commit/push/merge。文档仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5713517152)、[R18 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424518757)、[R19 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424519249) 与 [R20 复核回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424519647)。review 绑定上述 SHA，GitHub 状态 COMMENTED，正文结论 REQUEST_CHANGES；没有重复新增 R20 行评论。

---

以下为同一 head 的前轮审查；R18/R19 的执行证据待完成状态由本轮关闭处置更新，R20 仍开放。

REQUEST_CHANGES。PR #322 当前候选的 R18、R19 原始源码反例已消除，R20 的修订大小仍与实际导出文件不一致；required full CI 执行中，不把待执行证据计为失败或通过。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`。

# PR #322 R18–R20 修复复审（2026-10-30）

- Reviewed SHA：`364fe85221a55558405af60b1d2224dcfdcbc58c`；base：`06595a6a94208399559ce5767dd107d0cc097184`；本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 依据当前 #321、[已批准 E1–E5](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6519076097)、UI01 Spec/Test 与既有审查，检查从 `31d0b5c` 起的完整五文件增量。期望：成员唯一归属并保留过滤祖先、所选历史行与信息一致、大小来自实际文件表示字节。R17 与更早未变化处置保留既往结论。

## R18 · 原始源码反例消除，当前浏览器执行证据待完成

实际 `u1InitialBatch` 12 个文档/容器实体现在产生 12 行；每个 C08 成员只出现一次，折叠 C08 后成员不再出现。搜索到 C08-R1 时保留 C08 祖先且不加入另一成员。新回归断言唯一计数与折叠隐藏，原有元数据测试不再折叠容器后期待成员仍可见。

## R19 · 原始源码反例消除，当前浏览器执行证据待完成

实际 V1 信息 handler 在最新为 V3 时保存精确 V1 行键，`aria-pressed=true`，父行不被误选；共享目录继续保存文件 ID。新增浏览器回归覆盖历史行选择、排序及两种视图往返。此处为源码函数诊断，没有新的渲染页面手工试走，不把本地实施说明当作独立浏览器执行证据。

## R20 · P2 · STILL OPEN：新大小函数仍未使用实际导出表示

位置：`apps/workspace-web/src/fixtures/u2-data.ts:1268–1282`。

`u2RevisionBytes` 从 seed 独立拼装 Markdown，但与交付 ZIP 使用的 `candidateMarkdown` 不同：标题使用 `##` 而非 `#`，添加表格 caption，在表格各行之间加入空行，末尾换行也不同。`u3.tsx` 仍以 `candidateMarkdown(data)` 作为成员内容；新字符串不是实际交付文件。

| 精确候选 | 目录计算 | 实际导出 |
| --- | --- | --- |
| F-MANUAL / V2 | 1402 bytes，1.4 KB | 1357 bytes，1.3 KB |
| F-MANUAL / V3 | 1305 bytes，1.3 KB | 1263 bytes，1.2 KB |
| F-FORM-APPLY / V1 | 620 bytes，0.6 KB | 584 bytes，0.6 KB |

对所有现有 7 份文件 × 3 个版本执行当前两个实际函数，21 个候选的字节数全部不一致。新增浏览器测试把手册 V2 的错误 1.4 KB 写成期望值，不能证明精确字节一致。E3/E5、UI-MVP-M1-033/035 要求实际文件/精确版本大小；应复用实际表示序列化或已知长度，并将含表格候选的显示大小与真实导出成员字节比较。本问题保留 R20 编号，不将函数提取当作已修复。

## 证据与交接

忽略目录 `.local/mvp/pr322-review/probe-364fe85.cjs` 从 reviewed SHA 直接读取并执行当前实际目录、信息 handler、候选与导出函数，使用现有安全合成样例；结果保存在同名 JSON。普通原件唯一行、父行选择和不存在候选大小未提供的正向/边界对照通过。没有修改产品或永久测试，增量 `git diff --check` 通过。

[full CI 41064943887 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/41064943887/attempts/1) 绑定当前 head；本轮观察到 select 成功、checks 与三个 persistence 分片执行中。未完成结果保持 pending，旧 head 的 full 不代替本候选。已确认 R20 无需等 CI 结束才报告。当前原会话 `agent-ci doctor --target codex` 返回 `codex_runtime_unavailable`，无支持运行时持有该会话；未启动 waiter、另建运行时或模型轮询。

Implementer 修复 R20 及错误测试期望，保留 R18/R19 修复，取得新候选 required full 后复审。PR/Issue 仍含旧 head、未实现和待验证的混合文字，应同步实际状态；M1-3 人工试走、脱敏 Runner 输出展示、真实服务与 batch/main 交付保持独立门禁。

本轮只更新本地正式审查文档及发布 comments；不修改产品、永久测试或远程手动测试环境，未 commit/push/merge。正式文档仍未提交，历史审查完整保留。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5713151947)、[R20 当前函数行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424274061)，以及 [R18](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424274420)、[R19](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424275072)、[R20](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4424275613) 原线程回复。review 绑定上述 reviewed SHA；GitHub 状态为 COMMENTED，正文记录独立 Reviewer 结论 REQUEST_CHANGES。

---

以下为 `31d0b5c` 的历史审查；R18–R20 最新处置以上方记录为准。

REQUEST_CHANGES。PR #322 的 R17 已关闭，当前文件浏览器增量新增三个 P2 问题（R18–R20）；required full CI 已通过，但未覆盖这些反例。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准当前候选进入集成，不代表 main 交付或人工验收完成。

# PR #322 文件浏览器与修改元数据复审（2026-10-30）

- Reviewed SHA：`31d0b5c8242d8201c0f80bb2fa2e0e402c6326b3`；base：`06595a6a94208399559ce5767dd107d0cc097184`；本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 依据最新 #321、[当前工作文件浏览器设计](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6519076097) 的 E1–E5、UI01 Spec/Test 与 M1 草图，审查从 `b6bf031` 起的完整六文件增量。先确认原件层级唯一、所选版本与信息一致、大小属于精确文件字节，再核对实现和验证。
- 本轮浏览器控制 inventory 无可用 browser，native pipe startup 失败，没有新的渲染页面手工试走。诊断使用 reviewed SHA 中实际源码函数和现有公开安全样例，不冒充浏览器或 M1-3 人工证据。没有改动正在运行的远程手动测试环境。

## R17 · CLOSED

精确版本动作仍通过 `exact=true` 打开所选计划/版本，普通同阶段文件选择保持阶段读者。当前精确候选 full 的 `m1-catalog.spec.ts:225` 同阶段 V3 → V1 回归通过，补齐上轮待执行证据。旧布局超时和工作台返回用例在本次完整运行也通过；旧 head 失败不作为当前失败。R13–R16 未变化部分保留此前关闭处置。

## R18 · P2 · OPEN：嵌套容器成员重复挂到目录层级

位置：`apps/workspace-web/src/fixtures/project-catalog.tsx:1007`。

`originalTree` 把批次所有条目直接放到一级路径目录；`originalDocumentRow(C08)` 又把同一批次的 C08-R1/R2 放在 RAR 下。实际 `u1InitialBatch` 只有 12 个文档/容器实体，默认展开树却产生 14 行。C08-R1 同时出现在“首轮资料 → 历史记录 → 变更历史（嵌套 RAR） → 成员”和“首轮资料 → 历史记录 → 成员”；收起容器后后一条仍可见，C08-R2 相同。

违反 E2/E5、UI-MVP-M1-032/035 的层级与精确身份要求。每个批次成员应具有唯一父节点，过滤时保留/说明其容器祖先；回归需断言每个实体只出现一次、收起容器后成员不可见。当前容器测试先收起 C08 再断言成员仍可见，恰好接受了这个错误结构。

## R19 · P2 · OPEN：选历史版本信息却高亮当前版本父行

位置：`apps/workspace-web/src/fixtures/project-catalog.tsx:1195`；文件名动作也存在同样的选择值归并。

历史版本行的 key 为 `F-MANUAL:MANUAL-V1@U1-PLAN-01-v1`，文件信息动作却只存 `F-MANUAL`。选择 V1 后，信息面板读取 V1，但 `data-selected` / `aria-pressed` 都以存储值比较 row.key，导致显示 V3 的文件父行高亮，V1 的信息按钮仍为 false。实际 handler 诊断确认了这些值；选择父行的正向对照正常。

违反 E2/E4、UI-MVP-M1-032/034 的明确选中行和精确版本上下文要求。应把浏览器行/版本选择与共享目录所需文件 ID 分开；回归检查 V1 行及按钮被选中、当前版本父行不被误标，并覆盖排序和视图往返后的保留。

## R20 · P2 · OPEN：修订大小不对应真实 Markdown 字节

位置：`apps/workspace-web/src/fixtures/project-catalog.tsx:300`。

`revisionBytes` 拼接全部 Unit.text，遗漏 Markdown 标题/表格语法且顺序/分隔不同，不能作为生成文件大小。以同一现有合成候选比较目录函数与交付 ZIP 使用的 `candidateMarkdown`：

| 精确候选 | 目录计算 | 实际 Markdown |
| --- | --- | --- |
| F-FORM-APPLY / V1 | 538 bytes，0.5 KB | 584 bytes，0.6 KB |
| F-MANUAL / V1 | 994 bytes | 1014 bytes |

违反 E3/E5、UI-MVP-M1-033/035 的实际文件/精确版本大小要求。应复用实际表示的序列化或已知字节长度；没有实际表示则显示未提供。需用含表格的候选把显示大小与实际导出成员字节对比。现有用例只检查存在数字 KB，不验证字节一致。

## 诊断与 CI 证据

忽略目录 `.local/mvp/pr322-review/probe-31d0b5c.cjs` 通过 `git show <reviewed SHA>:<path>` 读取源码，提取实际目录构建、行选择与元数据函数，使用现有 `u1InitialBatch` / `u1PlanOne` / `u2Candidate`；结果保存于同目录 JSON。三个反例均成立，普通原件单行与父行选择正向对照通过。没有修改产品源码或永久测试；增量 `git diff --check` 通过。

[CI 41038706549 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/41038706549/attempts/1) completed/success，select 选择 `full`，原因 `batch-engineering-or-unknown-change`。checkout 为 `ebf94f62b33985ca77b113fa1159ff3a9ef5e5ca`，verify 的候选绑定输出明确 PASS，head/base/checkout 与本次远端一致。

- checks：159 个 Vitest 文件 / 3286 tests，131 个 built-browser cases 全部通过，包含 R17、新增五个文件浏览器用例以及先前失败的两项用例。
- 三个 persistence gate、persistence 汇总与 verify 均成功。复用同一 run/attempt 的完整结果，没有拼接其他候选分片。
- 同 head 较早 run 41038448330 的分片被取消、汇总失败，不计为通过证据；当前另一个完整成功运行独立满足 full。未重复整个本地验证。

## 交接与边界

Implementer 修复 R18–R20 并增加身份唯一性、精确行选择及文件字节断言，按实际覆盖同步 owning Test；新候选取得 required full 后复审。PR 验证段与新草图仍留有“未实现/只修订设计”的矛盾状态句，也应同步为真实实施/验证和剩余人工门禁。

M1-3 无引导人工试走、独立 Runner 脱敏输出展示、真实服务/内容与 batch/main 交付保持各自边界。当前 full 通过不关闭这三个语义发现，也不构成人工视觉验收。

本轮仅更新本地正式审查记录并发布 PR comments；未修改产品代码或永久测试，未 commit/push/merge。人工反馈与历史记录全部保留，正式文档仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5712262372)、[R18](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4423622048)、[R19](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4423622067)、[R20](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4423622082) 与 [R17 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4423652293)。总体 review 绑定 reviewed SHA，发布后 head/base 未变；GitHub 状态为 COMMENTED，正文记录独立 Reviewer 结论 REQUEST_CHANGES。R17 回复首次连接超时，宿主只读 gh probe 恢复成功后先读回确认未发布，再作一次有界重试并验证，未重复创建评论。

---

以下为 `b6bf031` 的历史阶段性复审；其 CI 待确认和 R17 状态由上方当前候选证据更新。

本轮语义复审已完成，最终 Reviewer 结论待 required full CI。R17 的源码反例已消除；当前没有发现新的语义阻断，不将执行中的 CI 记为通过或失败。

# PR #322 R17 修复复审（2026-10-30，CI 待完成）

- Reviewed SHA：`b6bf031ea72dbcde83d294bca64697e8a8970984`；base：`06595a6a94208399559ce5767dd107d0cc097184`；目标为 M1 mock 子 PR → `batch/mvp-v1-ui`。本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 独立重读最新 #321 / PR、R17 讨论、受影响 UI01 Spec/Test 与从 `dd87498` 起的完整五文件增量。此前本地测试调整 `bd3eacb` 和 R17 修复均已进入远端。
- R13–R16 未变化部分保留既往处置；上轮 `dd87498` 的 CI 失败不作为当前候选失败。PR/#321 中旧 head / 待实现的状态文字仍需同步，但不能据此声称当前实现未进入远端。

## R17 · 源码修复确认，回归执行待 CI

显式版本按钮现在调用 `selectRevised(row, version, true)`，直接导航所选版本包含精确计划的 href；只有普通同阶段文件选择保留现有阶段读者。这符合 [文档工作区增量](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#已批准文档工作区增量2026-10-29) 对精确版本访问和普通文件选择的不同要求。

有界诊断 `.local/mvp/pr322-review/probe-b6bf031.cjs` 从 reviewed SHA 读取实际 handler/session/scope 函数，以合成会话验证：

1. 同阶段当前 V3 → 显式选择 V1：导航到精确 V1 href；原阶段会话内容保持不变，不迁移意见或定稿依据。
2. 普通同阶段文件选择：不导航，仍保留 V3 与其 scope。
3. results 路由与跨阶段选择继续按对应版本 href 导航。
4. 显式选择旧计划版本，以及当前计划尚无该文件阅读状态但历史版本存在时，均导航到指定历史 href，原阶段会话保持不变。

新增 built-browser 用例真实生成手册 V1/V2/V3，进入同阶段页选择历史 V1，断言精确 URL 与详情版本；返回后检查普通文件选择仍留在阶段页并保留 V3。UI-MVP-M1-028 已同步该覆盖。源码诊断不是渲染页面验证，本轮没有新的独立手工试走。

## CI 与剩余证据

[CI 40975884837 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40975884837/attempts/1) 绑定当前 head；select 日志检出 `fed7bea`（上述 head 合入上述 base），选择 `full`，原因 `batch-engineering-or-unknown-change`。发布前快照中 select 成功，checks 与三个 persistence jobs 均 in_progress，尚无当前候选的完整通过证据。

本次测试调整对布局矩阵增加到 90 秒预算，对工作台用例在输入搜索前等待项目 URL 落定；原断言没有删除。它们针对上轮两项失败，但是否收敛以本次执行结果为准。增量 `git diff --check` 通过，没有重复整个本地 code/full。

当前会话的 `agent-ci doctor --target codex` 返回 `codex_runtime_unavailable`：没有受支持的 live runtime 持有原会话，未启动 waiter。已报告无法自动接收完成通知；没有另建/恢复运行时，也不轮询 CI。需在该运行结束后核对完整结果与当时 head，再发布最终 Reviewer 结论；不能在 pending 时宣告 APPROVE。

本轮更新正式审查记录并发布阶段性 comments；未修改产品代码或永久测试，未 commit/push/merge。记录保留全部历史。M1-3 人工试走、Runner 脱敏输出展示、真实服务/内容、batch/main 交付与合并授权保持独立门禁。

已发布并回读 [阶段性 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5706496722) 与 [R17 修复确认回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4419135576)。总体 review 绑定 reviewed SHA，发布后 head/base 未变；GitHub 状态 COMMENTED，没有提前宣告最终 APPROVE。

---

以下为 `dd87498` 的历史审查；其 R17 未修复与 CI 失败状态仅适用于当时候选。

REQUEST_CHANGES。PR #322 当前远端候选的 R17 仍未修复，required full CI 另有两项 built-browser 失败。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准当前候选进入集成。

# PR #322 R17 与 CI 复审（2026-10-30）

- Reviewed SHA：`dd87498c2bb084251b4357c9b41fa7e0576236e2`；base：`06595a6a94208399559ce5767dd107d0cc097184`；PR OPEN / Draft，批次变量 `true`。
- 最新远端为 `dd87498`，本地额外的 `bd3eacb230d2b1e9762d9a5a367eb5d1e42c94bf` 尚未推送，不计入本轮远端结论。本轮没有代为推送。
- 独立重读最新 #321 / PR、R17 讨论、受影响 UI01 Spec/Test，以及从 `fe31310` 起完整四文件增量。增量恢复工作台项目条目的 article/work-item 标记，调整配套样式，并适配真实阅读器目录提示的组件/持久化浏览器断言；没有修改目录精确版本逻辑或相应回归。
- 沿用未变化部分的既往语义审查，R13–R16 保持原关闭处置。本轮没有新增独立产品缺陷编号。

## R17 · P2 · STILL OPEN

`project-catalog.tsx:418` 仍在同阶段分支忽略传入的 `version`，按当前 `viewedVersionId` 更新 scope 后返回。要求仍是 [UI01 文档工作区增量](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#已批准文档工作区增量2026-10-29) 与 UI-MVP-M1-027/028 的精确版本访问；保留普通同阶段文件选择不意味着可以忽略显式版本按钮。

有界诊断 `.local/mvp/pr322-review/probe-dd87498.cjs` 通过 `git show <reviewed SHA>:<path>` 读取候选源码，再用 AST 提取实际 handler/session/scope 函数，避免误用本地较新提交。结果：同阶段当前 V3 → 显式请求 V1 后，无导航，阅读版本仍为 V3，scope 仍为 `file:F-MANUAL:V3`；从 results / 其他阶段执行相同动作的两个正向对照均导航到精确 V1 href。

原评论继续有效，需区分普通文件选择和显式版本选择，绑定所选计划/版本并保留草稿/定稿边界，增加实际读者显示 V1 的同阶段回归。本轮仅做源码函数诊断，没有新的独立页面手工试走。

## 当前 exact-candidate 验证

[CI 40917043987 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40917043987/attempts/1) completed/failure，head 精确为上述 reviewed SHA。select 日志检出 `56f3e9d`（上述 head 合入上述 base），选择 `full`，原因 `batch-engineering-or-unknown-change`。

[checks](https://github.com/qzhike/zhiju-business-core/actions/runs/40917043987/job/123600106610) 中 159 个 Vitest 文件 / 3286 个测试通过，built-browser 为 123 passed / 2 failed：

1. `u1-journey.spec.ts:442` 的 development marker / layouts / keyboard 用例超过 30000 ms。
2. `workbench.spec.ts:21` 返回工作台后，`查找工作` 预期“文件”，实际为空，断言超时。

三个 persistence gates 与汇总均成功，verify 因 checks 失败未通过。日志证明所需门禁失败；仅凭这些日志不能断定两个失败都是产品缺陷或都只是 flaky。本地 `bd3eacb` 为上述用例增加超时预算与项目 URL 等待，但尚未成为远端候选，也没有修复 R17；不能代替当前候选通过证据。

本轮增量 `git diff --check` 通过；未重复整个本地 code/full，不拼接旧 head 的成功证据。CI 已结束，无需等待或启动轮询。

## 交接

Implementer 修复 R17、补足同阶段精确版本回归，收敛两项浏览器失败，并在授权交付后的新远端候选取得 required full 后复审。PR / #321 的旧 head 与待实现状态文字仍需同步；已有目录与工作台实现不能被旧描述误报为完全缺失。M1-3 无引导人工试走、Runner 脱敏输出展示、真实服务/内容、batch/main 交付及合并授权保持独立边界。

本轮仅更新本地正式审查记录并发布 PR comments；没有修改产品代码或永久测试，没有 commit/push/merge。历史反馈完整保留，正式记录仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5706276688) 与 [R17 复核回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4418956170)。总体 review 绑定 reviewed SHA；发布后远端 head/base 未变。GitHub 状态为 COMMENTED，正文记录独立 Reviewer 结论 REQUEST_CHANGES。

---

以下为 `fe31310` 的历史审查；其 R17 OPEN 状态由上方对新候选再次确认。

REQUEST_CHANGES。PR #322 新增目录实现存在 R17：在同阶段审阅页显式选择历史版本时，仍保留当前阅读版本。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`；不批准当前候选进入集成，不代表 main 交付或 M1 人工验收完成。

# PR #322 文档目录与工作台视图增量复审（2026-10-30）

- Reviewed SHA：`fe3131053fc76f06654574160a1f38e77901bdd5`；base：`06595a6a94208399559ce5767dd107d0cc097184`。本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 本轮依据最新 #321、[目录设计补充](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6492197823)、[工作台两视图补充](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6499359466)、UI01 Spec/Test，复审从 `b0ac4d6` 起的两个提交。目录与卡片/列表实现已进入远端，旧 PR/Issue 状态文字不能作为实现缺失的依据。
- 重读共享项目目录、精确版本/来源访问、项目导航和工作台状态、Mock 控件迁移及新增回归；未变化的 R13–R16 原始案例保持此前关闭处置，不将旧 head 的 APPROVE 延伸至新候选。
- 本轮原生浏览器控制通道返回 `Sky Computer Use native pipe startup failed`，没有执行新的渲染页面试走。下方为当前源码函数诊断，不冒充浏览器测试或 M1-3 人工验收。

## R17 · P2 · OPEN：同阶段目录版本按钮忽略所选版本

位置：`apps/workspace-web/src/fixtures/project-catalog.tsx:418`，同阶段分支读取已查看版本，并在处理传入的精确版本前返回。

在 `/projects/MVP-U1-PROJECT/stages/manual`，质量手册已有 V1/V2/V3、当前阅读 V3 时，展开目录的“版本与来源”并显式选择 V1 历史版本。该按钮实际调用 `selectRevised(row, version)`，但 `openRevision` 的同阶段分支完全忽略传入版本，继续读取当前计划的 `viewedVersionId` 并把意见 scope 设为 V3；既不切换阅读版本，也不导航到 V1。其他阶段内的同阶段版本选择同样受影响。

有界诊断 `.local/mvp/pr322-review/probe-fe31310.cjs` 使用 TypeScript AST 提取当前源码中的实际 handler、session 与 scope 函数，以合成会话执行；结果保存于同目录 JSON：

1. 当前手册 V3、显式请求 V1：没有导航，阅读版本仍为 V3，scope 为 `file:F-MANUAL:V3`。
2. 正向对照：从 results 路由执行同一 V1 动作，导航到包含精确计划与 V1 的 href。
3. 正向对照：从另一阶段执行同一 V1 动作，也导航到精确 V1 href。

这违反 [UI01 文档工作区增量](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#已批准文档工作区增量2026-10-29) 的每条目精确版本访问与保留阶段路由适用范围，以及 UI-MVP-M1-027/028。普通同阶段文件选择保留审阅页是已批准行为；显式版本选择必须另行处理所选精确计划/版本，同时保留草稿和定稿依据边界。需增加“同阶段当前 V3 → 目录显式选择 V1 → 实际读者显示 V1”的回归，并同步对应覆盖说明。现有历史 V1 测试从 results 路由进入，阶段页测试只覆盖跨阶段读取，未覆盖此分支。

## 验证证据与交接

[CI 40907806527 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40907806527/attempts/1) 精确匹配本次 head；select 日志检出 `219f931`（上述 head 合入上述 base），选择 `full`，原因为 `batch-engineering-or-unknown-change`。最后一次状态快照中 select 成功，checks 与三个 persistence jobs 均仍 in_progress。没有把 pending 记为失败或通过；R17 的阻断依据是独立语义反例，无需等待 CI 才能提交。

- 当前源码诊断确认 R17，两个正向导航对照通过；本轮增量 `git diff --check` 通过。
- 未重复本地 code/full，旧 head 的完整成功不作为当前候选通过证据。
- PR 正文与 #321 部分状态段落仍描述旧远端 head / 待实现，应由实现者同步为已进入候选的实现、实际验证与剩余验收。
- Implementer 修复 R17 并补回归，取得新精确候选 required full 后复审。M1-3 无引导人工验收、独立 Runner 脱敏输出展示核对、真实服务/内容与 batch/main 交付保持各自门禁。

本轮仅更新本地正式审查文档和发布 PR comments；未修改产品代码或永久测试，未 commit/push/merge。人工反馈与历史审查全部保留，正式文档仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5701097655) 与 [R17 行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4414882350)，均绑定 reviewed SHA；发布后 head/base 未变化。GitHub 状态为 COMMENTED，正文的独立 Reviewer 角色结论为 REQUEST_CHANGES。

---

以下为 `b0ac4d6` 的历史审查；其 APPROVE 仅适用于当时候选，不覆盖上述新提交。

APPROVE。PR #322 的 R16 已关闭，当前修订未发现新的阻断问题。结论仅适用于 M1 mock 子 PR → `batch/mvp-v1-ui`；不代表 main 交付、M1-3 人工验收或合并授权。

# PR #322 R16 修订复审（2026-10-29）

- Reviewed SHA：`b0ac4d6e83dd4600027a83b40a2dffc3c8edbff1`；base：`06595a6a94208399559ce5767dd107d0cc097184`；当前远端 merge candidate：`ab4f5a70b4f675a1a84d657bc23e6ac4f3fd0ea4`。本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 独立重读最新 #321、受影响 UI Spec/Test 和完整五文件增量，核对当前任务、原请求恢复与新旧冻结清单的既有约束。R13–R15 未变化部分沿用上一轮语义处置；未发现无关产品范围扩张。
- 本轮没有新的浏览器手工试走。复用精确候选 CI 的 built-browser 证据，并通过未修改源码中的实际函数完成独立有界诊断；这两类证据不冒充 M1-3 人工验收。

## R16 · CLOSED

新增 `packagingFrozen` 与 `packagingPackage` 保留原打包依据/包的展示，和最新 proposal 的当前包判断分离。当前工作在原打包未收敛时保留恢复区、请求 ID、原冻结成员和对应查询/重试；`confirmAndPackage` 在操作边界再次拒绝覆盖未收敛的 PENDING / UNKNOWN / MISMATCH / FAILED 请求。原请求收敛后，旧包作为历史，新清单仍需独立明确确认。

诊断 `.local/mvp/pr322-review/probe-b0ac4d6.cjs` 使用 AST 提取当前源码的任务推导、确认、查询、重试、冻结和 ZIP 函数，在合成清单上执行，结果保存于同目录 JSON：

1. UNKNOWN 打包→清单重新定稿：任务仍为 PACKAGING_RECOVERY，原请求 `U3-PACK-be243b01` 和 V1 冻结清单保留；直接再次调用确认也只产生阻断说明，不替换原请求/依据。
2. 查询原 UNKNOWN 请求后 ID 不变，仅生成原 V1 清单的包；重复查询不追加包、不改状态。当前任务随后要求新清单确认。
3. FAILED、MISMATCH 两条分支也在清单变化后保持原依据并阻止新确认；错绑先收敛为失败，再对原冻结清单重试。已知失败后的合法重试可创建新尝试，不将其误判为 UNKNOWN 重复执行。
4. 三条分支收敛后，明确确认 V2 均形成第二个包；旧 V1 包字节保持一致。R14 错绑回执/依据变化阻断、R15 已完成旧包→新确认的正向对照继续通过。

新增 built-browser 用真实导航和普通意见提交覆盖 UNKNOWN 打包→历史文件反馈→新稿→重新定稿→原请求 ID 保留→核对→历史 ZIP→新清单确认/第二包。其请求查询不依赖手工投递回执。该用例在当前候选 CI 通过。

## 验证证据与适用性

[CI 40811829106 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40811829106/attempts/1) 为同一精确 head/base 的完整成功运行。select 日志检出 `ab4f5a7`，选择 `full`，原因 `batch-engineering-or-unknown-change`；verify 的候选绑定输出为 PASS，head/base/checkout 均与当前远端读回一致。

- checks、三个 persistence gate、persistence 汇总及 verify 全部 completed/success；checks 日志明确为 114 个 built-browser 用例通过，包含新增 R16 用例。
- 有界源码诊断通过；修订 diff whitespace 检查通过。未修改产品代码或永久测试，未重复整个本地 code/full。
- 同 head 的后续 run `40815599885` 在本轮初始状态读取时仍 in_progress。它不是本结论的通过证据，未将其记为成功，也未将 pending 当作失败。依项目“优先复用同一 exact revision 可信 CI”的规则，本轮使用上面已完整通过且仍匹配当前候选的 run；没有拼接不同 run/attempt 的分片。实际合入仍应检查当时平台必需检查和精确 head。

## 交接与边界

当前修订可进入该子 PR 的后续集成交付门禁，无新的实现修复要求。M1-3 首次用户无引导试走、当前独立 Runner 脱敏输出展示核对、真实服务/内容/持久化验收、batch/main 累计验证及合并授权仍为独立门禁；本结论不关闭 M1 产品目标。

本轮更新本地正式审查记录并提交 PR comments，保留全部人工反馈与历史审查。未 commit/push/merge；正式文档仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5692746621) 与 [R16 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4408598328)。总体 review 绑定 reviewed SHA，发布后 head/base/merge candidate 均未变化；发布前最后一次状态读取确认后续 run 40815599885 仍在执行。GitHub 状态为 COMMENTED，正文记录独立 Reviewer 角色结论 APPROVE，不声称 GitHub 正式 APPROVED 或合并完成。正式文档通过单文件 Prettier 检查。

---

以下为 `4b44c81` 的历史审查；R16 OPEN 状态已由上方本轮处置更新。

REQUEST_CHANGES。PR #322 的 R13–R15 原始反例已关闭，但最新候选新增 R16：打包仍为 UNKNOWN 时，后续重新定稿会隐藏原请求恢复入口，并允许新确认覆盖该未决请求。required full CI 已通过；通过的既有用例未覆盖这个组合。本结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准该候选进入集成分支，不表示 main 交付或 M1 人工验收完成。

# PR #322 R13–R15 修订复审（2026-10-29）

- Reviewed SHA：`4b44c81207e158cd5081ebb6cefe65d5178c27c8`；base：`06595a6a94208399559ce5767dd107d0cc097184`，目标分支 `batch/mvp-v1-ui`。本地与远端一致，PR OPEN / Draft，批次变量为 `true`。
- 独立依据：最新 #321、已批准 v2 草图、UI01 Spec/Test、从 `e4aa806` 起的完整增量、当前源码及精确候选 CI。既往未变化部分复用原语义分析，不将作者摘要作为通过证据。
- 界面证据边界：本轮专用 fixture 服务已启动，但原生 UI 通道及重新连接均返回 `Sky Computer Use native pipe startup failed`，浏览器连接清单为空，未开展本轮页面点击或实际下载。此工具故障不是产品缺陷；没有将源码诊断或自动化 CI 冒充本轮独立浏览器试走。
- 有界诊断：在忽略目录保存 `.local/mvp/pr322-review/probe-4b44c81.cjs` 及结果 JSON，使用 TypeScript AST 从未修改的源码提取实际任务推导、确认/查询、冻结和 ZIP 函数，输入三阶段已定稿的合成清单进行状态转换与字节检查。未启动浏览器、未改产品代码或永久测试；该诊断补充语义证据，不替代 full 或人工验收。

## R13–R15 处置

| 发现 | 当前证据 | 处置 |
| --- | --- | --- |
| R13 导航后恢复入口丢失、正常核对依赖手动回执 | 恢复可见性与任务来自 provider 中保留的请求/失败状态，`RECOVERY` 优先于阶段推进；正常 query 校验原 intent 并只追加失败文件尝试。新增 built-browser 用真实链接覆盖历史→返回→主要动作恢复，精确 head CI 通过。 | CLOSED |
| R14 改场景即可接受旧错绑回执 | 新路径校验实际 receipt、原 intent、当前 proposal 和 blockers。当前源码函数诊断确认原错绑回执改为 matched 场景后仍 MISMATCH，UNKNOWN 期间 proposal 变化也保持阻断；对应两个新浏览器用例在 CI 通过。 | CLOSED |
| R15 后续重新定稿仍下载旧包 | 已完成旧包不再作为新 proposal 的当前包；必须重新确认，保留旧包并追加新包。源码函数正向诊断形成 PKG-01/02，新 manifest 为 V2，原包字节相同；新增正常反馈→重新定稿→第二次确认的浏览器用例通过。未决打包与后续重新定稿的组合另见 R16。 | CLOSED |

PR 正文、v2 草图及 owning 文档的“已实施/仍待人工验收”边界已同步。PostgreSQL 镜像仍固定 18.6 与明确 digest；本轮没有发现绕过 pin 或降低持久化验证的修改。

## R16 · P2 · OPEN：重新定稿会丢失 UNKNOWN 打包请求

位置：`apps/workspace-web/src/fixtures/u3.tsx:1097`（仅当前 proposal 匹配时暴露冻结清单）；相关路径为 `task-workspace.tsx` 的 `deriveTask` / `DeliveryPanel`，以及 `u3.tsx` 的 `confirmAndPackage`。

有界源码反例从完整定稿的有效清单开始，直接调用当前实现：

1. 确认清单 A，打包场景为 UNKNOWN；实际生成原请求 `U3-PACK-485c1d75`，任务为 `PACKAGING_RECOVERY`。
2. 后续改稿并重新定稿形成清单 B。原冻结清单 A 不匹配 B，API 不再暴露 `state.frozen`；任务变成 `DELIVERY_CONFIRM`。界面条件只有存在 `state.frozen` 才渲染原打包查询动作，故当前工作失去该恢复入口。
3. 再次确认 B。确认函数只阻止未决的确认状态，没有阻止未决打包；生成新请求 `U3-PACK-f033a526` 并覆盖 `packagingRequest` / `frozen`。两次状态均为 UNKNOWN，旧请求 ID 在完整 delivery 状态中已不存在。
4. 此后查询只能处理 B 的请求；没有证明 A 已结束，也没有保留 A 的原请求及冻结依据。这个反例不依赖把场景改回 AVAILABLE，更不依赖刷新或修改 URL。

这违反 [UI01 交付与隔离要求](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpm1-连续-mock-旅程2026-10-26)、UI-MVP-M1-023 和 [v2 图 6](../../mvp/m1-ui-mockups.md#图-6交付成为最后的当前任务) 的“打包未知先核对原尝试”。新旧包当前性与未决执行生命周期必须分开：保留原 UNKNOWN 请求及其冻结清单和当前工作内恢复入口，在原请求收敛前不允许覆盖它；随后才能确认新清单。无需新增产品决策。

需要增加 UNKNOWN 打包→正常反馈/新稿→重新定稿→原请求仍可核对且 ID 不变→收敛后新清单确认的回归，检查两套冻结依据与历史各自保留。当前新 R15 用例从旧包 AVAILABLE 开始，现有 UNKNOWN 用例未与后续重新定稿组合，故 full 通过没有反驳此反例。

## 当前验证证据

[CI 40709004375 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40709004375/attempts/1) 精确匹配 reviewed SHA，completed/success。select 选择 `full`，原因 `batch-engineering-or-unknown-change`；检出的合并候选为 `4a6af07`，合入上述 base/head。

- [checks](https://github.com/qzhike/zhiju-business-core/actions/runs/40709004375/job/122888949601)：159 个 Vitest 文件、3285 个测试通过；113 个 built-browser 用例通过，上一轮失败的未决恢复阻断用例现已通过。
- 三个 persistence gate、persistence 汇总及 verify 全部成功。独立读取 persistence-1 日志，镜像为 `postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4`，`server_version: 180006`。
- 未重复整个本地 code/full；当前配置目标已有精确通过证据，使用上述小范围诊断确认既有测试遗漏的行为。上一轮 CI 失败记录作为历史保留，不能当成本候选当前失败。

## 交接与边界

Implementer 修复 R16，增加组合回归并同步实际受影响的 UI-MVP-M1-023 覆盖说明，取得新精确候选的 required full 后复审。M1-3 首次用户无引导人工试走、当前 Runner 脱敏输出展示核对、真实服务/内容/持久化验收、batch/main 交付及合并授权仍为独立门禁。

本轮仅更新本地正式审查记录并发布 PR comments；未修改产品代码，未 commit/push/merge。人工反馈及旧审查全部保留。本地正式文档仍未提交。

已发布并回读 [总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5692422810)、[R16 行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4408338482) 和 [R13](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4408339211) / [R14](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4408339451) / [R15](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4408339724) 关闭回复。总体 review 绑定 reviewed SHA；发布后 head/base 未变化。GitHub 状态为 COMMENTED，Reviewer 角色结论为 REQUEST_CHANGES。专用 43223 fixture 服务已停止，未操作用户原手动测试标签页或服务。

---

以下为上一轮 `e4aa806` 审查记录；其 OPEN 与 CI 失败状态按当时修订解释。

REQUEST_CHANGES。PR #322 最新候选存在三个已独立复现的 v2 流程缺陷（R13–R15）；当前 required full CI 也未通过。本结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准该候选进入集成分支，不表示 main 交付或 M1 人工验收完成。

# PR #322 任务驱动 v2 独立复审（2026-10-28）

- Reviewed SHA：`e4aa80650f50c7f21916b16b02ebaca47371f45a`；base：`06595a6a94208399559ce5767dd107d0cc097184`。远端与本地一致，PR 为 Draft，仓库批次变量为 `true`。
- 依据：最新 #321 Acceptance/Verify、已批准 v2 草图、UI01 Spec/Test 与从 `164332d` 开始的实现增量。先重建同工作区、精确确认、恢复、历史/新交付的预期，再检查具体实现。先前 v1 关闭处置不等于新 v2 工作流已获批准。
- 独立诊断：在未修改的当前源码启动单独 fixture 服务，通过 Edge 的新标签页操作匿名合成项目；不复用用户手动测试标签页状态。完成正常分析、范围确认、三阶段候选/定稿、交付，以及下列反例。代理操作不算 UI-MVP-M1-024 的首次用户无引导验收。

## R13 · P2 · OPEN：未决恢复入口由开发开关控制，普通导航后消失

位置：`apps/workspace-web/src/fixtures/task-workspace.tsx:1267`，恢复区使用 `showRecovery` 条件渲染（1455）。

1. 三阶段定稿后，设置合成部分失败场景，点击“仅重试已知失败文件”，产生 `U3-RETRY-f811f09e`。
2. 点击“核对原重试请求”只提示没有匹配回执；必须点击“模拟原重试回执到达”后才能查询收敛。
3. 在收敛前进入“历史记录”并返回“当前工作”，原请求仍阻止交付，但恢复区与所有恢复动作消失；主按钮仍为“确认交付清单并生成文档包”。
4. 重新展开开发区、勾选恢复区才能找回动作；手工投递原回执后查询成功，失败文件恢复且原请求未重建。

根因：组件局部 `showRecovery=false` 在卸载后重置；任务推导未优先承接原恢复请求，恢复继续复用手动回执演练流程。违反 #321 / UI-MVP-M1-021 与草图图 5。故障设置可以用开发控件，恢复过程不应依赖再次设置或手工回执。需由持续保留的项目执行/请求状态决定恢复入口和主要操作，并增加失败→重试→历史→返回→原位恢复的回归。

## R14 · P2 · OPEN：最终确认恢复未验证实际回执和当前精确清单

位置：`apps/workspace-web/src/fixtures/u3.tsx:1291`–1297。

1. 三阶段完成，确认场景选择“错绑回执”，提交最终确认；第一次查询保持阻断。
2. 只将后续场景选择改为“匹配回执”，不投递新的匹配回执，再查询同一请求。
3. 页面直接显示“打包已冻结清单”。代码中的 `configure` 仅改场景，原 `request.receipt` 仍是错绑回执；新查询路径却直接设置 DONE 并冻结原 intent。

新路径按可变场景判断，而没有沿用旧 `queryConfirmation` 对实际 receipt、原 intent、当前 proposal key 和 blocker 的校验。违反 #321 与 UI-MVP-M1-023 的精确确认要求。正常模拟查询可以产生明确的模拟结果，但仍需验证结果；不能因场景标签变化而接受旧错绑回执。需覆盖错绑后的查询，以及 UNKNOWN 期间依据变化。

## R15 · P2 · OPEN：后续版本重新定稿后仍将历史包作为当前交付

位置：`apps/workspace-web/src/fixtures/task-workspace.tsx:384`–388；新工作区未暴露旧交付页的 `startNewRound` 动作。

本反例从刷新后的独立状态开始，全程正常业务动作、没有开发控件：

1. 分析/答复、确认范围、三阶段 V1 定稿、明确确认交付清单，生成 `U3-PKG-01`。
2. 从历史打开第三阶段 V1 的“外来文件管理规定”，编辑意见并提交，在当前工作显式查看 V2，重新定稿完整四文件集合。
3. 新第三阶段定稿为 `U2-STAGE-f3e06ab6`，待交付清单四份文件均 V2；任务却仍为“文档包已生成（模拟）”，只提供旧 `U3-PKG-01` 下载，没有新清单确认。
4. 实际下载并解包核对 `SYNTHETIC-MANIFEST.md`：仍绑定旧第三阶段 `U2-STAGE-daca311b`，四文件均 V1；手册/程序依据分别为 `U2-STAGE-346f2aa8` / `U2-STAGE-47d2a64b`。合成 ZIP 位于本机下载目录，未向外发布原文件。

历史包保持原字节是正确行为；错误是把旧包当成当前新清单交付、无法原位发起第二次明确确认。需比较当前 proposal/bases 与 frozen 清单，将旧包保留为历史并提供新清单确认/打包；回归覆盖首次包→正常反馈→V2 定稿→第二次交付、实际 manifest 与历史字节不变。对应 #321 / UI-MVP-M1-023。

## 当前验证证据

[CI 40670613131 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40670613131/attempts/1) 精确匹配 reviewed SHA，已 completed/failure。select 日志选择 `full`，原因 `batch-engineering-or-unknown-change`；checkout 的合并候选为 `b560698`，双方为上述 base/head。

- [checks](https://github.com/qzhike/zhiju-business-core/actions/runs/40670613131/job/122756252095)：built-browser 109 通过、1 失败。失败为 `u3-journey.spec.ts:562` 的未决恢复阻止最终交付场景，等待原恢复请求 blocker 文案超时。该日志本身不能证明业务确认被绕过；根因未进一步确定，必须排查并获得通过证据，不能归咎为下面的镜像故障。
- [persistence-3 gate](https://github.com/qzhike/zhiju-business-core/actions/runs/40670613131/job/122756252340)：镜像核验失败，`postgres:18.6` 的 registry digest 为 `sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4`，固定 digest 为 `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`。三个 persistence jobs 与汇总均失败；这是环境/基线问题，不冒充应用持久化测试失败，也不豁免 full。
- 未重复运行整个本地 code/full；复用当前精确 CI 并补充独立 UI 反例。已知镜像失败没有通过重试或绕过 pin 处理。本轮不需要等待 CI，不启动轮询或 waiter。

## 交接与边界

Implementer 修复 R13–R15，补足上述转移回归并收敛 UI-MVP-M1-017–023 的实际验收范围；排查浏览器失败，通过适用工程流程处理镜像基线后取得新精确候选的 full 证据，再复审。PR 正文和草图页首仍写“仅文档/实施待完成”，也应与当前实现及未完成项同步。

M1-3 无引导人工试走、当前独立 Runner 脱敏输出展示核对、真实服务/内容/持久化验收、batch/main 交付及合并授权均为独立门禁。本轮未修改产品代码/永久测试，未 commit/push/merge；本正式文档仅在本地，保留原人工反馈与历史审查。

已发布并回读 [本轮总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5682108427) 与三条行评论：[R13](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4400178987)、[R14](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4400178998)、[R15](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4400179006)。均绑定 reviewed SHA；发布后 head/base 未变化。GitHub 状态为 COMMENTED，角色结论为 REQUEST_CHANGES，不声称 GitHub 正式 CHANGES_REQUESTED 状态。正式记录通过单文件 Prettier 格式检查；该检查不替代候选 full。

---

以下保留此前设计确认、发布及 v1 审查历史；其状态按当时修订解释。


发布补充（2026-10-28）：按用户“根据最新设计更新当前 PR/Issue”的指示，已将四份 v2 设计/验收文档提交并推送为 `ac8b2f02ba10097389310ec456660c58aa47d976`，回读确认 [Issue #321](https://github.com/qzhike/zhiju-business-core/issues/321) 与 [PR #322](https://github.com/qzhike/zhiju-business-core/pull/322) 的标题、正文、链接及 PR head 一致。PR 已转为 Draft，实施交接见 [PR 评论](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6465316982)；新流程实施、UI-MVP-M1-017–024 与人工验收仍待完成，未修改产品代码或合并。以下“未提交/未发布”描述是此前确认轮次的历史状态。

确认补充（2026-10-28）：用户已同意以下流程订正意见。已在本地将 [M1 用户流程与界面草图](../../mvp/m1-ui-mockups.md) 更新为 v2，并同步 owning UI Spec/Test 与 release；任务驱动流程、共享意见提交、默认任务视图和当前工作区内恢复均为已批准待实施目标。UI-MVP-M1-017–024 为新验收，状态 NOT RUN；原 v1 实现/CI 证据保留。本轮没有修改产品代码、提交 Git、推送或修改 GitHub；#321 远端验收及 PR 交接仍待同步，不能沿用远端 v1 要求声称 v2 已交付。

以下保留确认前的产品流程复审，文中的“建议/待确认”是当时状态；已确认设计以 v2 草图为准。PLANNING_REQUIRED 的设计决策部分已收敛，不代表现有实现符合新目标或 M1 人工验收通过。

PLANNING_REQUIRED。现有流程需要从页面浏览改为当前任务驱动；此前已确认草图解决了展示层级，但没有充分合并实际操作。本轮给出产品流程订正建议，不修改产品代码，不把新流程建议追溯判为旧验收缺陷，也不批准 M1 产品流程定稿。

# PR #322 产品流程复审（2026-10-28）

- 对象：本地与远端 `164332d1c83a978e7ac60fca3ad4d426c957bb65`，PR OPEN，M1 mock 子 PR → `batch/mvp-v1-ui`。
- 用户请求：重新审视冗余、下一步不清楚的用户流程，提出订正意见，不修订代码。本轮意见仍待用户确认，不修改已批准草图、owning Spec/Test、Issue 或 GitHub 评论。
- 依据：最新 #321、已批准草图、MVP 可用闭环、UI01 当前 M1 设计与实现，以及本轮相关代码增量。独立核对工作台入口、结果总览与详情、分析/范围、阶段审阅、恢复和交付的入口、动作及状态。
- 界面证据边界：Edge 中观察了已有质量手册审阅页及新开标签页的工作台。新标签页后续导航/刷新未取得可用页面内容，未完成本轮全链界面试走；没有将此观察单独判定为源码导航缺陷。路径与动作判断主要依据当前源码。仅使用合成页面，未提交业务意见或确认，已关闭本轮新建标签页，保留原工作页面。
- 工程证据：本轮读取 [CI 40629847933](https://github.com/qzhike/zhiju-business-core/actions/runs/40629847933) 的 select、checks、三个 persistence gate、persistence 汇总及 verify 全为 COMPLETED/SUCCESS，精确匹配 reviewed SHA。下方旧记录的 pending 保留为历史状态；工程通过不能证明首次使用者能自行完成流程。未重跑 code/full，未开展真实 Runner/服务验收。

## 主要流程问题

1. **入口没有直接承接用户任务。** `fixtures/workbench.tsx:244` 的 M1 卡片始终归到 attention，按钮固定“查看项目概览”，没有直接使用实际下一步目的地。界面同时显示“待确认修改范围”“先核对资料批次和读取限制”及“准备项目交付”等不同层次线索。用户先选择页面，再寻找任务；项目状态、用户待办、系统处理中应清楚分开。
2. **新旧工作区并存。** `fixtures/results.tsx:276` 的分析下一步返回旧分析页，`:365` 的阶段动作返回旧阶段审阅；`:697` 总览的主操作继续跳转。新结果页负责看清单，旧页面负责答复、生成、推进和定稿，核心工作没有在新的两级结果结构内完成。折叠旧导航不能消除这些依赖。
3. **一次意图被拆成多个中间动作。** `plan/Page.tsx:368`–`:393` 同时存在“进入模拟生成”“进入质量手册审阅”；前者只登记意图，阶段页 `StageReviewPage.tsx:317` 再提供生成候选。总览“提交本轮意见并生成下一稿”实际登记修订请求后，还要求回阶段页显式演练候选到达。用户需要理解实现步骤才能推进。
4. **意见与定稿之间缺少清楚交接。** 详情保存意见后应继续本轮审阅/汇总提交，但 `fixtures/results.tsx:1095` 的主要出口指向“前往阶段审阅确认完整集合”；旧阶段页另有保存/提交入口。保存位置、提交位置、确认位置不一致，容易让用户跳过意见提交或以为必须再审一遍。
5. **查看结果和处理待办混在一起。** 结果类型/阶段/轮次选择、全部上传条目、计划目标、候选和多种状态同时占据主视图；用户必须自行找出现在需要处理的对象。`:360` 将“尚未成为阶段定稿”也列作 blocker，未区分正常待审阅、真实错误、业务阻断和处理中。完整性要求必要，但所有信息不应具有同等任务优先级。
6. **技术演练侵入业务路径。** 已观察阶段页同时有原请求查询、模拟保存回执、修改回执、下一轮候选、缺文件等控件，多段声明重复占用阅读空间。M1 应由业务按钮驱动正常模拟结果；故障注入和手动回执控制保留在独立开发区。模拟身份/内存限制仍需持续可见。

## 建议订正方向（未冻结）

- **以当前工作作为唯一主入口。** 工作台“需要你”卡直接进入待答复、待审阅或待确认的具体任务。项目概览的进度、当前状态及下一步合入工作区顶部；全部文件/资料和历史为辅助视图。用户不必先选结果类型、阶段与轮次，默认打开当前可处理任务；主动进入历史时保留选择并提供返回当前任务。
- **同一工作区完成动作。** 整体分析展示待答复问题并原位处理；生成后进入文件审阅；结果总览/文件详情保留为阅读层级，但答复、提交意见、定稿和恢复不能依赖另一个旧版操作页面。
- **一次用户意图对应一次明确动作。** 建议“上传并开始分析”“提交答复并继续分析”“确认范围并生成质量手册初稿”“提交 N 条意见并生成下一稿”“确认交付清单并生成文档包”。合并交互不合并事实：先取得对应精确对象的确认，再发起后续执行；确认失败/UNKNOWN 停在原意图核对，不能自行继续或重复执行。阶段定稿后在当前位置明确提供下一阶段的动作，不要求重新寻找入口。
- **意见草稿与修订请求分清但减少跳转。** 建议编辑即保留绑定版本的草稿，并明确保存状态；M1 只声明本会话内存保存。文件详情和总览共用固定的本轮任务栏，可以核对汇总的 N 条意见并提交，不强制先返回总览找按钮。有意见时优先提交修改；无意见或核对满意后可确认完整阶段集合。未提交草稿在定稿前提示处理，不静默忽略或迁移。
- **任务优先，完整清单可查。** 建议当前工作区优先本阶段需审阅/待处理文件，全部文件仍可一键访问、计数和追溯；影响当前工作的跨阶段缺项仍显著提示。这明确订正此前“每轮默认全部文件”的展示决定，不授权实现者自行改写原合同或静默排除输入。
- **状态决定下一步。** 未上传→上传分析；需澄清→提交答复；待确认范围→核对并确认；处理中→显示进度和等待原因；待审阅→查看候选；有意见→汇总提交；已知部分失败→重试失败部分；UNKNOWN→核对原执行；阶段可定稿→完整集合确认；交付就绪→确认清单并打包；包可用→下载。每个状态只有一个明确主要操作，保留相关次要操作，不把所有可能按钮同时排列。
- **保留必要业务判断。** 范围确认、三个阶段各自定稿、最终交付清单确认继续绑定精确对象；保护内容变化仍需明确授权。不得把少点击解释为自动批准、旧确认迁移、失败文件排除或历史覆盖。整体分析覆盖四层、三阶段顺序及真实 M2 范围不变。

## 建议用户流程验收

1. 无口头解释，首次使用者能从工作台直接进入当前任务，并说明现在状态、为何需要自己处理、操作后的结果。
2. 正常主路径不打开演练控制、不手工选择回执、不编辑 URL，也不先寻找“阶段审阅/执行恢复”等另一个操作页。
3. 至少两轮文件意见→提交修订→新稿复核，在同一工作区完成；“已保存草稿”“已提交修改”“已定稿”各有明确结果。
4. 阶段推进与历史回看不串用阅读/草稿/确认；用户始终能返回当前任务。
5. 一次部分失败和一次 UNKNOWN 都从当前任务恢复，成功文件保留，原请求不重复。
6. 完整输入、预期缺项和历史仍可查；任务聚焦不掩盖阻断或未处理文件。
7. 三阶段完成后核对明确的交付清单并生成下载包；最终确认仍独立于第三阶段定稿。

交接：先由用户确认当前任务入口、单一操作工作区、意见提交方式与默认任务视图，再订正草图/owning UI 文档及 #321 验收。当前仅追加本地正式审查记录；没有修改产品代码、原人工反馈或权威设计，没有 commit/push/merge 或发布本轮 GitHub 评论。

---

以下为此前 R10 技术复审记录；其 CI pending 描述是当时事实，最新检查状态及本轮产品设计结论以上方为准。

本轮语义复审完成，未发现新的阻断问题；R10 已关闭。Reviewed SHA `164332d1c83a978e7ac60fca3ad4d426c957bb65` 的 required full CI 仍在执行，最终 Reviewer 角色结论暂不发布。未将 CI pending 当作失败，也未提前 APPROVE。本记录适用于 M1 mock 子 PR → `batch/mvp-v1-ui`。

# PR #322 R10 历史保留修订复审（2026-10-28）

发布记录：已提交并回读 [本轮 COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5677665179) 与 [R10 关闭回复](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396775954)，明确 Reviewed SHA、独立复核结果及 CI 待完成边界。GitHub 状态为 COMMENTED，尚未发布最终 APPROVE。

- Reviewed SHA：`164332d1c83a978e7ac60fca3ad4d426c957bb65`；base `06595a6a94208399559ce5767dd107d0cc097184`。发布前远端 head/base 未变，PR OPEN；仓库批次变量重新读取为 `true`。
- 已独立读取最新 #321/PR、全部六文件增量、受影响 UI Spec/Test 和已批准的轮次/历史/显式切换要求。新增生成尝试历史属于既有 mock 验收范围，无范围扩张；未变化部分沿用既往语义分析，R11/R12 及更早已关闭反例的处置保持适用。

## R10 · CLOSED

`StageSession.generationAttempts` 保留独立请求身份及终态失败结果；结果页从尝试历史生成请求轮次，不再由单个实时请求替代历史。

独立 Chromium 诊断在未修改源码上连续完成五组场景，无页面异常：

1. **失败→失败→成功。** 两个旧请求 ID 均存在，旧文件失败结果不变；原固定选择保留，新 V1 独立提示。两个旧详情可读，浏览器 Back 无刷新返回原详情正常；显式选择 V1 后显示实际候选。
2. **UNKNOWN→原请求核验。** 重复生成禁用；原回执到达并重复查询后只保留同一请求身份，原详情仍可访问，V1 需显式选择。
3. **PENDING→原请求核验。** 原请求、详情和当前选择均保留，候选独立出现，不产生第二个请求。
4. **错绑回执。** 查询后仍是同一请求，不应用候选，详情保留不匹配说明。
5. **正常生成/反馈。** 直接 V1、详情保存、总览提交、共享阶段历史、V2 到达和本轮精确 V1→V2 比较均正常，原 V1 阅读不被自动替换。

永久回归已覆盖原失败→失败→成功反例；owning Spec/Test 与 release 的本项证据同步。独立合成脚本/读回位于忽略目录 `.local/mvp/pr322-review/probe-164332d.mjs`、`probe-164332d-results.json`。本轮没有新的实现修复要求。

## 待完成验证与最终结论

- [CI run 40629847933 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40629847933/attempts/1) head 精确匹配。最后读取时 select success，checks 与三个 persistence gate 仍 in_progress。没有最终通过/失败证据。
- 累计 PR 包含验证工具改动，child 继续要求 full。未使用旧 head CI 或作者命令摘要替代当前 required full，也未重复本地 code/full。
- 本轮在 host 重新执行 `agent-ci doctor --target codex`，返回 `codex_runtime_unavailable`：原会话没有受支持的 live runtime，不能接收完成通知。没有启动 waiter，没有创建/恢复另一会话，也不使用模型轮询等待。
- 最终 APPROVE 需要精确 run/attempt/head 完成后读回结果、核对 head/base 未改变及适用性；失败则检查具体日志。此时只关闭语义发现，保留最终角色结论待定。
- M1-3 用户完整试走、当前 Runner 脱敏输出展示核对、真实服务/内容、批次 main 交付与合并授权仍为独立门禁。
- 本轮仅更新本地正式审查记录与 PR comments，未修改产品代码/永久测试，未 commit/push/merge；保留人工反馈和全部既往审查。

---

# 历史：974cba6 修订复审

REQUEST_CHANGES。PR #322 最新候选 `974cba6f4bfdabe67689dcc12747ff5dd1adfe4e` 的 R11、R12 已关闭，R10 首次展示已修复，但失败重试会丢弃原轮次与详情，仍为 OPEN。当前 head 的 CI 尚在执行；本次结论由独立复现的语义缺陷确定，不将 pending 记为失败。本结论仅适用于 M1 mock 子 PR → `batch/mvp-v1-ui`。

# PR #322 R10–R12 修订复审（2026-10-28）

发布记录：已提交并回读 [本轮总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5677560316) 与 [R10 后续行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396690819)，均绑定本轮 Reviewed SHA。GitHub 状态为 COMMENTED；Reviewer 角色结论为 REQUEST_CHANGES。

- Reviewed SHA：`974cba6f4bfdabe67689dcc12747ff5dd1adfe4e`；base `06595a6a94208399559ce5767dd107d0cc097184`。发布前远端 head/base 未变，PR OPEN；仓库批次变量重新读取为 `true`。
- 独立读取最新 #321/PR、全部七文件增量、受影响 UI Spec/Test 与已批准草图要求。作者说明仅用于定位；未变化部分沿用既有语义分析，R5–R9 原始反例的关闭处置不变。

## R10–R12 处置

| 发现 | 独立验证及剩余问题 | 处置 |
|---|---|---|
| R10 无候选失败/UNKNOWN 没有轮次 | 两种初始状态均可从处理结果查看，文件状态正确，无伪造候选，下一步返回正确阶段；UNKNOWN 不能重复生成。但继续失败重试后原轮次消失，成功后只剩 V1，原详情不可访问，见下文。 | PARTIALLY FIXED / OPEN |
| R11 被替代计划仍能提交 | 旧意见保留；范围扩大后提交按钮禁用并解释替代原因。共享 U2 接收点按精确计划 ID/版本、确认状态和 supersededBy 再校验。正向控制：新计划确认后可保存/提交自己的意见并产生下一版。 | CLOSED |
| R12 旧分析被新范围改写 | ANALYSIS-1 与 ANALYSIS-2 扩大范围前后清单正文、行数和计数均相同，不引入后来新增的变更通知单；适用于当前两报告的有界 mock。 | CLOSED |

## R10 · P2 后续反例：重试抹除失败历史与原详情

位置：`apps/workspace-web/src/fixtures/results.tsx:306`。本次继续原 R10，不创建重复发现编号。

1. 质量手册首次生成选择失败；在处理结果显式选中原请求轮次，打开其文件详情。
2. 返回总览，经“回到阶段审阅处理失败”再次以失败场景生成。回总览，只有第二个请求 ID，原请求轮次消失，原选中项也被替换。
3. 再次返回阶段，以匹配回执重试成功；总览只剩 `MANUAL-V1@U1-PLAN-01-v1`，两次失败均不可查。
4. 无刷新地使用浏览器 Back 返回原详情地址，页面显示“无法打开此页面 / 未找到或无权访问这个精确对象”。

根因：请求轮次仅从单个实时 `session.generationRequest` 构造，并要求 `versions.length === 0`。U2 重试覆盖该请求，成功到达后整个请求分支消失，没有稳定的历史快照。此问题违反 #321 的请求/版本/历史保留、草图图 3 的固定输入/结果及图 5 的新结果显式切换要求；不是新增产品范围。

需要保留生成尝试及固定结果，历史 round/detail 身份在重试后仍可解析，用户查看的历史不被删除或自动替换。回归应继续完成 FAILED→FAILED→成功，逐一检查两个旧请求及详情、结果和选中项。当前新增测试仅检查首次失败/未知展示，未覆盖后续恢复。

## 证据与交接

- [CI run 40628267774 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40628267774/attempts/1) head 精确匹配。最后一次读取时 select success，checks 与三个 persistence gate 仍 in_progress；未获得最终结论。
- 累计 PR 含验证工具变更，child 继续要求 full；select 日志因 run 未完成暂不可读取，不推测其输出。不将作者的底层本地命令报告当成配置化 full。未重复执行本地 code/full，也未轮询等待 CI；已确立阻断缺陷，可先交还 Implementer。
- 未修改源码上的 Chromium 诊断最终完成六组场景，无页面异常：两种无候选状态及正确返回、旧计划阻断、两版历史分析隔离、新计划正常提交、失败→失败→成功后的历史访问。脚本及合成读回在忽略目录 `.local/mvp/pr322-review/probe-974cba6.mjs`、`probe-974cba6-results.json`。
- Implementer 继续修复 R10，并补齐转移/历史回归、校正 M1 验收口径；新 head 取得 required full 后复审。M1-3 人工完整试走、Runner 脱敏输出展示核对、真实服务/内容及 main 交付继续独立待完成。
- 本轮未修改产品代码或永久测试，未 commit/push/merge；仅更新本地正式审查记录并提交 PR comments，保留人工反馈及既往审查。

---

# 历史：3dd05f7 修订复审

REQUEST_CHANGES。PR #322 最新候选 `3dd05f754d31ac595c57d4d989fc954f31240688` 已修复 R5–R9 的原始反例；本轮独立复现三项新的 P2 验收问题 R10–R12。精确 head 的 full CI 全通过，仍需修复以下语义问题后复审。本结论仅适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准当前候选合入。

# PR #322 R5–R9 修订复审（2026-10-28）

发布记录：已提交并回读 [本轮总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5677402709) 和三条行评论 [R10](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396572645)、[R11](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396572652)、[R12](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396572656)，均绑定本轮 Reviewed SHA。GitHub 状态为 COMMENTED；Reviewer 角色结论为 REQUEST_CHANGES。

- Reviewed SHA：`3dd05f754d31ac595c57d4d989fc954f31240688`；base `06595a6a94208399559ce5767dd107d0cc097184`。发布前重新读取，远端 head/base 未变，PR OPEN；仓库批次变量重新读取为 `true`。
- 已读取 #321 最新正文与评论、PR 修复说明、已批准草图、owning UI Spec/Test、全部 11 文件增量及相关实现/测试。目标与 base 未变，未变化部分沿用既有语义分析。作者修复说明只用于定位，不作为通过证据。

## R5–R9 处置

| 发现 | 独立验证 | 处置 |
|---|---|---|
| R5 总览提交未接共享状态 | 从详情保存并在总览连续提交两轮意见；共享阶段历史可读，候选形成 V1→V2→V3。历史计划的提交资格另见 R11。 | CLOSED（原始反例） |
| R6 不存在候选仍渲染样例 | 非本阶段的外来制度、第三阶段模拟缺失的实施记录均显示不可用，无候选 reader。 | CLOSED |
| R7 跨计划轮次/意见碰撞 | 旧/新计划轮次同时存在，切到计划 2 时不显示计划 1 意见；旧轮仍保留意见。分析轮历史另见 R12。 | CLOSED（原始反例） |
| R8 当前 U3 恢复状态回写旧结果 | 第三阶段结果在失败文件重试/核验前后完全一致；不再引用 U3 预设观察。零候选请求的结果入口另见 R10。 | CLOSED（原始反例） |
| R9 桌面正文仍上下排列 | 1440px 两端 y 同为 1142.78，x 分别为 253/823，宽各 558；360px 改为上下单列。 | CLOSED |

## 当前发现

### R10 · P2：无候选的失败或 UNKNOWN 请求没有结果轮次

位置：`apps/workspace-web/src/fixtures/results.tsx:279`。处置：OPEN。

确认计划后，质量手册首次生成分别选择失败和 UNKNOWN。阶段页显示正确状态，但进入“处理结果”后只有整体分析及两版分析报告，找不到质量手册请求、失败/未知结果或对应下一步。轮次完全从候选版本集合构建，零候选时无法产生阶段结果，行级失败分支因此无处显示。应独立保留执行轮次/请求身份，不依赖候选存在；FAILED 显示可恢复失败，UNKNOWN 提供原请求核对入口，并保留文件清单。此反例使用真实 U2 模拟生成状态，独立 U3 恢复页测试不能替代草图图 3、#321 和 UI-MVP-M1-011/012/016 的结果页验收。

### R11 · P2：被替代计划仍可提交下一稿请求

位置：`apps/workspace-web/src/fixtures/results.tsx:508`，共享接收点 `fixtures/u2.tsx:598`。处置：OPEN。

计划 1 手册 V1 保存意见，扩大为计划 2 且尚未确认，再打开旧 MANUAL-V1 轮次。总览提交仍可用，生成 RECEIVED 请求并提示已登记；此时计划 1 已带 `supersededBy`，阶段入口因新计划待确认而不可用。后续确认计划 2 并生成候选，旧请求不在当前阶段历史，也不启用其下一轮。UI 和共享提交边界均缺少计划有效性检查。应保留旧意见供查阅，拒绝不具备生成资格的下一稿提交并给出原因/正确入口，不静默迁移到新计划；回归须覆盖从历史轮次实际提交，而不止检查意见隔离。

### R12 · P2：历史分析轮次被当前计划改写

位置：`apps/workspace-web/src/fixtures/results.tsx:240`（ANALYSIS-2 同类读取在 262）。处置：OPEN。

ANALYSIS-1 原清单没有 F-FORM-NOTICE；后续扩大范围新增变更通知单，再查看同一个 ANALYSIS-1，新增项显示为“已确认修改范围 / 拟议处理”，不是“未纳入本轮”，且进入本轮涉及范围，而新计划尚未确认。两版分析都绑定实时 `u2.plan`，随后按其文件生成行和计数。应将分析结果绑定原报告/计划快照，后续可见项目项明确未纳入并排除原轮次统计。阶段 ID 新增计划维度不能替代分析轮历史隔离；#321 与草图的固定输入/结果要求仍适用。

## 证据与交接

- [CI run 40623746764 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40623746764/attempts/1) 的 head 为本轮 Reviewed SHA，completed/success。select、checks、三个 persistence gate、汇总与 verify 均成功。
- select 日志明确 `target=full reason=batch-engineering-or-unknown-change changed_path_count=41 attempt=1`，checkout 合并候选 `0e125bf` 对应上述 head/base。复用此 required full 证据，未重复本地 code/full。
- 未修改当前源码上的 Chromium 诊断最终连续完成七组场景，无页面脚本异常：三组修复正向复核，四个反例覆盖三项新发现。脚本/合成读回在忽略目录 `.local/mvp/pr322-review/probe-3dd05f7.mjs` 与 `probe-3dd05f7-results.json`；诊断脚本自身的定位/等待调整不记为产品缺陷。
- 当前 Spec/Test/release 的 M1-010–016、M1-1/M1-2 PASS 口径仍需随 R10–R12 修复与新增回归校正；不得用恢复页旧证据代替新版结果页状态覆盖。需要修改的是已批准验收内的实现，不需要重新规划要求。
- Implementer 修复 R10–R12 并取得新 head 的 full 后复审。M1-3 用户完整试走、当前 Runner 脱敏输出展示核对、真实服务/内容与 main 交付继续独立待完成。
- 本轮只更新正式审查记录并发布 PR comments，未修改产品代码/永久测试，未 commit/push/merge；人工反馈和历史审查保留。

---

# 历史：026703c 页面修订复审

REQUEST_CHANGES。PR #322 最新候选 `026703ccb3a0ee6a99907f2535fb8a9788c688e9` 的已批准页面修订存在五项可复现的 P2 问题。full CI 已通过，但不消除这些语义反例；修复后需对新 head 重新审查。结论适用于 M1 mock 子 PR → `batch/mvp-v1-ui`，不批准当前候选合入。

# PR #322 已批准页面修订复审（2026-10-28）

- Reviewed SHA：`026703ccb3a0ee6a99907f2535fb8a9788c688e9`；base `06595a6a94208399559ce5767dd107d0cc097184`。发布前重新读取，远端 head/base 未变化，仓库批次变量为 `true`。
- 已读取最新 #321 与评论、PR 新增设计/实现评论、已批准 `.vibe/mvp/m1-ui-mockups.md`、owning UI Spec/Test 和全部 21 文件增量。旧版未变部分沿用已有语义分析，新结果状态/比较/意见路径重新审查。
- 上轮 PLANNING_REQUIRED 的执行前提已满足：设计草图及 Issue/Spec/Test 已同步。最新要求是两个面板上下排列，历史左右布局及 R4 建议已被取代，不追溯当作旧代码缺陷。
- D1 已独立验证：1440/700/641/360/320 上下两个面板、横向三步骤及步骤内部无溢出。四主导航和结果总览/详情路由已出现；D2–D5 的行为完成度仍受以下发现阻断。

## 当前发现

### R5 · P2：结果总览提交未进入共享修改状态

位置：`apps/workspace-web/src/fixtures/results.tsx:145`。处置：OPEN。

质量手册 V1 详情保存意见后，回总览点击“提交本轮意见并生成下一稿（模拟）”，显示已登记请求，但 handler 仅 `setReceipt`。返回阶段审阅，意见历史为空，“模拟下一轮候选到达”仍禁用；新的主流程无法推进，必须去旧页面重输意见。应将本轮已保存意见冻结成绑定原文件/轮次/版本的模拟请求，接通现有单活动请求、UNKNOWN 与候选到达机制。回归须覆盖详情保存→总览提交→请求历史→新轮次，不能只断言成功文案。

### R6 · P2：未生成或缺失候选仍可在详情中读到样例稿

位置：`apps/workspace-web/src/fixtures/results.tsx:702`。处置：OPEN。

独立复现两条路径：只生成质量手册 V1，打开“本阶段未处理 / —”的外来文件管理规定，`/results/MANUAL-V1/F-EXTERNAL-RULE` 却展示该文件 V1 候选，精确版本栏同时写 PLAN；第三阶段生成后模拟缺少一份文件，变更实施记录行显示“本轮未返回结果 / —”，详情仍显示其 V1。`dataForReview` 只检查计划文件和静态 seed，未检查本轮阶段/实际候选成员。应先按所选轮次的实际结果解析精确文件版本；无候选、未纳入、失败分支不能通过样例库补造。

### R7 · P2：计划变化重用轮次身份并迁移旧意见

位置：`apps/workspace-web/src/fixtures/results.tsx:247`，意见 key 见第 690 行。处置：OPEN。

计划 1 的 MANUAL-V1 保存唯一意见后，扩大范围新增变更通知单、确认计划 2 并生成其手册 V1。结果页仍只有同一个 MANUAL-V1 选项与 URL，旧计划意见自动显示为新轮次意见，详情草稿也相同。session 按当前计划读取，而 round ID 只含阶段和 V1，意见 key 再使用相同 round/file/version。应保存绑定原计划/输入/执行身份的稳定轮次，历史可继续访问，新轮次意见隔离；回归覆盖扩大范围后旧轮次与新轮次共存。

### R8 · P2：实时恢复状态回写旧轮次结果

位置：`apps/workspace-web/src/fixtures/results.tsx:350`，详情同类读取见第 701 行。处置：OPEN。

执行观察来自当前 `u3.execution.files`，仅按 fileId 与任意轮次拼接。独立复现 RULES-V1 的变更申请单原先“本轮失败 / —”，只进行失败文件重试与原请求核验，再回相同 RULES-V1 即变成“已生成候选 / 第 1 版候选”。旧失败被当前恢复结果改写；手册 V1 的详情还显示预设 F-MANUAL@V2 的执行来源。应按所选轮次固定 attempt/result 快照，保留原失败并区分恢复尝试，不用当前观察代替历史事实。

### R9 · P2：桌面详情未实现已确认的左右文档对照

位置：`apps/workspace-web/src/fixtures/results.tsx:911`，`focusReading` 样式与既有 `ChangeView` 配合。处置：OPEN。

该选项只隐藏目录/意见，原版本与当前阅读版本仍为上下 block。1440px 手册 V1 页面两者 x 均为 253、宽均为 1128，后者在前者下方；合成截图也确认修订正文位于首个阅读区域之外。草图图 5 / D4 明确要求桌面基线左、修订右、对齐差异及未变内容上下文，这不是新提出的外观偏好。应提供此对照区域并保留累计/本轮精确绑定和窄屏回退，回归直接检查两端几何和内容而非仅存在 reader。

## 证据与交接

- 已提交并回读 [本轮总体 review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5677014971) 及五条行评论：[R5](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396298236)、[R6](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396298240)、[R7](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396298244)、[R8](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396298250)、[R9](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4396298256)。均绑定本轮 Reviewed SHA。按用户要求以 COMMENT 提交，GitHub 状态为 COMMENTED；Reviewer 角色结论为 REQUEST_CHANGES。
- [CI run 40609851304 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40609851304/attempts/1) 精确 head 匹配，completed/success；select、checks、三个 persistence gate、汇总与 verify 全成功。
- select 日志为 `target=full reason=batch-engineering-or-unknown-change`；合并候选 `494db6457169cac9ecc75b3bcd52443a88b29ca7` 对应上述 head/base。复用该证据，未重复本地 code/full。
- 当前未修改源码上的独立 Chromium 连续诊断完成六组反例，覆盖五项发现；截图确认桌面上下比较。诊断仅使用合成数据，位于忽略目录 `.local/mvp/pr322-review/probe-026703c*` 和 `026703c-stacked-comparison.png`。另执行 D1 五宽度正向检查。
- 本次不将作者的底层命令报告作为配置化 gate 证据；当前 CI 已独立提供 required full。新测试只读回提交提示/比较标签，未覆盖上述请求推进、缺候选、换计划意见隔离、历史恢复快照与左右比较反例。
- Implementer 修复 R5–R9 并增加对应行为回归，同步 UI-MVP-M1-010–016、M1-1/M1-2 的完成口径；新 head 通过 full 后复审。M1-3 用户完整试走、当前 Runner 脱敏输出展示核对、真实服务/内容和 main 交付继续独立待完成。
- 本轮未修改产品代码或永久测试，未 commit/push/merge。正式审查记录仍为本地文件；保留人工反馈与以下既往审查历史。

---

# 历史产品设计复审（2026-10-27）

PLANNING_REQUIRED。本轮依据最新人工反馈重新审查产品页面设计：概览上下布局属于已明确的修正；“按阶段和轮次查看结果 → 文件详情”需要同步调整 M1 的页面设计与验收口径，再继续实现。当前不确认 M1 产品页面定稿。本结论针对下述产品设计范围，不将新增要求追溯认定为旧版代码缺陷。

# PR #322 产品页面设计复审（2026-10-27，最新人工反馈）

确认与发布补充（2026-10-27）：用户已同意下述 D1–D5 修改方向。完整意见已发布为 [PR #322 总体评论](https://github.com/qzhike/zhiju-business-core/pull/322#issuecomment-6444018781)，并在 [Issue #321 留下确认与索引](https://github.com/qzhike/zhiju-business-core/issues/321#issuecomment-6444039004)；两条均已回读并核对正文。`PLANNING_REQUIRED` 的剩余工作是同步可执行验收及 owning UI 设计，不再等待重复确认修改方向。本次发布未将建议记为已实现或产品验收通过，也未创建重复 Issue。

- 对象：本地及远端 head `e4f6f4d48dc31fa0a082a68bd8c300c8319fd791`，M1 mock 子 PR → `batch/mvp-v1-ui`，base `06595a6a94208399559ce5767dd107d0cc097184`。
- 最新依据：[pr-322-manual.md](pr-322-manual.md)、[可用闭环](../../mvp/usable-loop.md)、[M1 发布计划](../../mvp/mvp-v1-release.md)、最新 #321 和 owning UI01 Spec/Test。人工反馈明确要求两面板上下排列、横向三阶段 Step，以及逐轮结果的总览/文件详情两级页面。
- 独立观察：使用 Edge 打开本地 3100 页面，查看项目概览、分析总览和拟交付文件详情；在新建审查标签中以明确标识的合成答复完成报告 V1→V2、范围确认、质量手册模拟生成，检查现有差异阅读与意见布局。没有使用真实客户资料或调用 Runner；本次为桌面产品设计检查，未重跑窄屏/完整失败矩阵。
- CI 状态校正：本次读取 PR 当前 head 的 select、checks、三个 persistence gate、persistence 汇总及 verify 均为 COMPLETED/SUCCESS。下方“CI 仍执行”属于上一轮读取时的历史状态；工程检查成功不代表最新页面方向已实现或 M1-3 已通过。未重复运行 code/full。

## D1 · 已明确修正：概览上下排列，阶段占据完整宽度

当前 `overview/overview.css:13` 仍使用两列，实际桌面页面也将三个阶段挤在左半栏。它不符合最新人工反馈第 7 行；UI Spec M1 第 1 项、UI Test `UI-MVP-M1-010`、release M1-3 和下方旧复审仍写左右排列，均需随修订校正。历史 R4 的“保留左右布局”建议不再适用。

建议从上到下组织为：项目标题与当前下一步 → 全宽横向三阶段 Step → 四层文件统计。Step 只突出阶段名、状态和当前步骤，长依据/定稿标识进入可展开详情；四层文件是分类统计，可点击筛选文件，不成为第二套流程。整体分析/资料准备期间，三个修订阶段可以仍为“未开始”，在当前任务处明确显示准备工作，不虚构第一阶段已执行。

## D2 · 主要设计调整：以阶段、轮次和文件组织结果

当前 `analysis/Page.tsx:543` 先渲染来源理解和保护/冲突区，随后是客户需补充、顾问需判断、拟交付文件、报告依据四类卡片；每张卡片只显示首条入口。实际首屏大部分空间被说明占用。`analysis/model.ts:69` 的核心仍是报告与 `plannedFiles`；点击文件在 `analysis/Page.tsx:741` 展示拟议修改和证据，不是执行后的候选结果。不能通过换标题把这些计划项当成每轮实际产物。

建议将这一工作区统一为“处理结果”，保留两级页面：

1. **总览**：显示项目与当前业务阶段、选中的执行轮次、该轮结论/需处理事项/下一步，以及完整文件清单。首次整体分析和后续三个修订阶段使用同一信息组织方式，按轮次类型调整内容和主要动作；等待答复、无改动、部分失败及未知执行也有可读结果/限制说明。阶段、轮次、文件版本和执行尝试是不同概念，不合成同一个“第几版”。
2. **文件详情**：保留所选轮次与文件，展示原始来源、精确比较版本、正文差异、修改理由、该文件问题和反馈历史。返回总览恢复轮次、筛选、滚动和选择；新结果只提示，不能自动替换正在审阅的内容。

产品基准要求首次分析覆盖全部四层资料，三阶段限制的是生成和定稿顺序。不能为了表现三步流程，把首次理解拆成三个互相隔离的资料阅读阶段。建议总览顶部使用阶段导航和轮次选择，现有四类卡片降为摘要/筛选或详情内容；需要用户立即处理的阻断问题仍显著显示。

## D3 · 必须区分完整输入清单、处理范围与预期缺项

“总览显示全部文件”不能用本轮六份拟交付文件或当前阶段文件代替。建议默认覆盖全部已接收成员，保留原包/补充批次/目录层级；嵌套容器与成员分别展示，损坏、未读、沿用、不适用以及本轮不修改的文件均可查。提供“全部文件 / 本阶段 / 本轮涉及 / 待处理”筛选，结果缺失时明确“本轮未返回”，不能让文件从清单中消失。

建议文件行至少显示：文件名与来源、文件层级/所属修订阶段、读取状态、本轮处理结果、当前候选版本、待处理问题、详情入口。读取状态、执行结果、人工确认分别表达；Runner 执行结束不使每个文件自动变成已完成。

最新反馈中的“缺失文件”应拆为三种可解释对象：已上传但无法读取；依据模板/业务判断待补充且适用性尚待确认；已确认需要新增且没有客户原件。后两种作为“预期文件/待补项”显示来源和判断依据，不计入实际上传文件数；不能把“包中没找到”直接显示成“客户没有”。保留“缺失候选”和“缺失原件”的区别。

## D4 · 文件详情应给正文对照主要空间

当前 `StageReviewPage.tsx:344` 将 `MarkdownReviewPage` 嵌在较长的计划/依据区后；其后继续展示集合、定稿和演练控制。`style.css:3` 按组件原始顶部位置分配剩余视口高度，实际桌面观察中阅读区较矮；目录和意见区又分别占用两侧宽度。逐处修改虽可查看，但不适合用户要求的完整左右文档比对。

建议把文件详情作为独立页面层级，顶部收敛为面包屑、文件名、轮次、两端版本和比较方式；主体左侧为基线、右侧为本轮修订，提供对齐差异、上下处修改、未变内容展开以及 Markdown/表格预览。文件目录可收起；意见在选择修改处后展开到侧栏/底部，不能长期挤压两份正文。窄屏采用统一差异或原文/修订切换，不强行保留多栏。

比较方式必须明确区分：**本轮变化（上一轮稿 → 本轮稿）**和**累计变化（初始底稿 → 本轮稿）**。只固定“客户原件 → 最新稿”无法回答反馈后本轮实际改了什么。DOCX 左栏应标为可追溯的提取正文/规范底稿，并显示原件定位和读取限制，不声称还原 Word 版式；新增文件左侧显示“无原件”，未生成/失败时不伪造修订稿。反馈绑定文件、轮次和精确版本；阶段确认保持阶段完整集合动作，不移为逐文件批准。

## D5 · 统一主要导航，降低演练和技术说明的干扰

`mvp/JourneyNav.tsx:6` 与后续阶段、返工、恢复、交付入口当前组成很长的一排链接；分析页和阶段页又各有自己的分类导航。建议项目内主导航收敛为项目概览、资料、处理结果、交付；处理结果内部选择阶段和轮次，范围确认由整体分析的下一步进入，恢复/返工由对应轮次状态进入，保留清晰的历史入口。具体导航名称是本轮建议，尚未作为新契约冻结。

保留持续可见的模拟标识与刷新限制，错误和阻断保留清楚的下一步。U1/U2/U3、request/receipt 标识、场景注入等放入可展开演练/技术详情；客户或顾问的主要动作使用“提交意见并生成下一稿”“确认本阶段版本”等业务表达。保护内容默认保留，只在确有变更提议时突出授权处理；无需把六个变更按钮长期铺在结果总览首屏。

## Runner 展示依据与验证边界

只读核对独立 Runner 的 `contracts/runner-revision-round-v1.md` §3–4：当前协议已有每轮完整文件快照、changes/issues/limitations/nextAction、文件执行与完整性状态，以及 roundHunks/cumulativeHunks；物理行号与旧规范化索引不同。上述页面方向可以据此准备有明确来源的展示样例，但它不是 Core 接入协议批准。单轮范围仍不能自动代表项目所有原始输入，完整清单需与项目托管信息关联。

本轮没有读取真实运行产物或验证 portable handoff 到现有 UI 的字段适配；不能把协议阅读记为 M1-3 的 Runner 脱敏输出核对 PASS。M1 先用明确标注的 mock/sanitized snapshot 定稿页面，真实 Runner 调用、读取、持久化和恢复按 M2 的必要设计接入。

## 建议实施顺序与完成判断

先同步概览上下布局及 owning Spec/Test/release 中的冲突口径；再把两级结果页面、完整清单和两种差异写入 #321/owning UI 设计与验收，然后实现 mock 页面并请用户试走。此处给出审查建议，不自动修改产品契约、Issue 或产品代码。

新的可观察验收至少覆盖：桌面两面板上下且三步骤横向；任一轮总览能追溯全部输入与独立缺项；无修改/失败/缺结果不会丢行；从文件详情返回保留原轮次和筛选；两轮反馈后可分别解释本轮与累计差异；旧意见和阶段定稿不随查看新版自动迁移。概览布局回归须直接检查上下位置关系，不能继续用旧的左右位置断言。

本次设计复审及后续授权发布仅更新这份正式审查记录和上述 GitHub 评论，保留用户维护的人工反馈原文和下方历史；未修改产品代码或提交 Git。Issue 正文及 owning Spec/Test/release 的同步仍待实施前完成。当前 M1-3 产品定稿仍未完成。

---

以下为上一轮工程复审记录。其 CI 等待描述保留当时的事实，最新状态及产品设计结论以上方为准。

本轮语义复审已完成，尚未发布最终角色结论：`e4f6f4d48dc31fa0a082a68bd8c300c8319fd791` 未发现新的阻断问题，但精确版本的 required full CI 仍在执行。上一轮 APPROVE 仅适用于上一轮 SHA，不自动延续到本轮。

# PR #322 人工反馈修订复审（2026-10-27）

- 阶段：M1 mock 子 PR → `batch/mvp-v1-ui`；base `06595a6a94208399559ce5767dd107d0cc097184`，Reviewed SHA `e4f6f4d48dc31fa0a082a68bd8c300c8319fd791`。
- 仓库批次变量重新读取为 `true`；本轮全部 7 文件增量仅涉及概览、对应浏览器测试及 UI01 Spec/Test/M1 状态记录。独立读取最新 #321、PR、人工意见和受影响权威要求；未变化部分沿用上一轮语义分析。
- 人工意见 M1：桌面及 700px 的两个面板同排，640px 以下单列。M2：三阶段横向步骤、当前步骤及进度文本均落实。两项实现已确认，用户视觉复验仍待进行。
- 独立 Chromium 诊断完成 10 个状态读回：初始、范围确认、仅生成候选、三阶段依次定稿、新手册草稿、手册重新定稿、程序重新定稿、第三阶段重新确认。新草稿不替换已完成；手册返工标记第 2/3 步待复核并以第 2 步为当前，程序重新确认后转到第 3 步；最终恢复完成。未发现状态误报，R1–R3 保持 CLOSED。
- 初始/完成/返工三组状态分别检查 1440/1024/768/700/641/640/360/320 共 24 个布局；两面板/三步位置符合断点设计，页面无整体横向溢出，无脚本错误。人工检查合成截图。诊断脚本、数据及截图仅在忽略目录 `.local/mvp/pr322-review/overview-e4f6f4d*`，不作为真实服务、用户验收或 configured full 证据。

## R4 · P3 非阻断：中等宽度步骤可读性

位置：`apps/workspace-web/src/overview/overview.css:124`。处置：OPEN / NON-BLOCKING。

700px 完成态每步正文宽度 32px，641px 约 22px；状态文案成为长竖列，定稿 ID 的 scrollWidth 为 54–59px，超出自身区域。整体页面无横向溢出不能证明步骤内部无溢出。<=640px 的紧凑规则反而使 320px 更清晰。建议保留两个面板左右布局，在较窄面板提前隐藏/折叠次要说明或将编号置顶，并处理 ID 换行；增加 641/700px 完成态内部溢出验证。该可读性改进不升级为阻断，用户视觉复验继续待完成。

## 当前证据与剩余门禁

[CI run 40478976464 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40478976464/attempts/1) 对应 Reviewed SHA。最后一次读取时 select success，checks 和三个 persistence gate 仍 in_progress；没有最终结论。累计 PR 仍含 `tools/workspace/check.mjs`，所以 child 必需 full；作者的本地 code PASS 不替代它。未重复本地 code/full，不将旧版本 CI 复用为本次通过。CI pending 不是 CI failure，也不强行输出 APPROVE/REQUEST_CHANGES。

`agent-ci doctor --target codex` 在当前 host 环境返回 `codex_runtime_unavailable`：没有支持的 live runtime 接收原会话通知。未启动 waiter，不创建/恢复另一运行时，不循环轮询。完成后仍需核对精确 run/attempt/head 并补充最终结论。

M1-3 进行中：首页初步通过，项目概览待用户复验，完整试走及 Runner 脱敏输出展示核对尚未完成。真实服务/内容/平台矩阵验收仍 NOT RUN。本轮未修改产品代码；正式记录仅本地，尚未 commit/push/merge。

已发布并回读 [本轮 COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5664774201) 与 [R4 非阻断行评论](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4386966361)，绑定本轮 Reviewed SHA，GitHub 状态 COMMENTED，最终角色结论仍待当前 CI。

---

# 前一轮复审记录（历史：95ab925）

APPROVE。PR #322 修订 `95ab925fcaab5306d929b70e7e7664ed697fdea9` 的 R1–R3 已关闭，未发现新的阻断问题，当前候选的 full 范围 CI 通过；此结论仅适用于进入 `batch/mvp-v1-ui` 的 M1 mock 子 PR，不表示 M1 人工验收或 main 交付完成。

# PR #322 复审（2026-10-27）

- 对象：[PR #322](https://github.com/qzhike/zhiju-business-core/pull/322)，关联 [Issue #321](https://github.com/qzhike/zhiju-business-core/issues/321)，分类 T1。
- Reviewed SHA：`95ab925fcaab5306d929b70e7e7664ed697fdea9`；上一轮：`75cc191ad493db8b143e1b01d13648e5c6131bca`。
- 阶段与目标：M1 mock 实现子 PR → `batch/mvp-v1-ui`；base 保持 `06595a6a94208399559ce5767dd107d0cc097184`。仓库批次变量仍为 `true`。
- 已独立检查本轮全部九文件修复增量、最新 Issue/PR 评论、owning UI01 Spec/Test 及其与产品基准的衔接。作者修复说明仅用于定位，不作为通过证据；上一轮未变化部分沿用已完成的语义分析。

## R1–R3 处置

| 发现 | 当前修复与独立验证 | 处置 |
|---|---|---|
| R1：第三阶段两轮反馈后无法完成返工重新确认 | `refinalizing` 同时检查内容集合和上游定稿 ID。独立完成 V1→V2→V3 两轮反馈、V3 定稿、程序单独返工及手册/程序共同返工；两条路径均可在明确确认后保留 V3 内容、生成绑定新依据的定稿。旧定稿保留；程序仍绑定旧手册时第三阶段确认保持禁用。 | CLOSED |
| R2：旧/新依据串用控制程序 ID | `ReworkImpact.changes` 按实际来源记录；两个页面逐项显示。独立将每行 ID 与实际生成的定稿逐一比较，程序单独变化、手册单独变化、二者共同变化都准确；320px 变化表页面无整体横向溢出。 | CLOSED |
| R3：冻结即宣称交付包生成 | 首页同时检查实际打包状态、包可用性和当前冻结清单的匹配。冻结未打包、失败、UNKNOWN、核验后可用的状态与下一步读回均符合预期；历史包可用时，新冻结清单仍显示待打包。 | CLOSED |

修复位置：[上游变化识别及重新确认](https://github.com/qzhike/zhiju-business-core/blob/95ab925fcaab5306d929b70e7e7664ed697fdea9/apps/workspace-web/src/fixtures/u2.tsx#L795)、[逐项依据变化](https://github.com/qzhike/zhiju-business-core/blob/95ab925fcaab5306d929b70e7e7664ed697fdea9/apps/workspace-web/src/fixtures/u2.tsx#L315)、[当前包可用性与首页状态](https://github.com/qzhike/zhiju-business-core/blob/95ab925fcaab5306d929b70e7e7664ed697fdea9/apps/workspace-web/src/fixtures/u3.tsx#L1004)。

本次允许复核后保留同一精确内容并确认新上游依据，与产品基准 §6 的修改/保留及重新确认一致，不要求为保留内容虚构新版本；确认仍生成新定稿，不自动沿用旧确认。

## 当前验证证据

- [CI run 40442841850 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40442841850/attempts/1) 的 `headSha` 为 Reviewed SHA，状态 completed/success。select、checks、三个 persistence gate、persistence 汇总及 verify 全部成功。
- select 日志明确选择 `full`，原因为 `batch-engineering-or-unknown-change`；实际 checkout 为当前 base/head 的合并候选（`8e9a1f6`）。累计 PR 仍包含 workspace 验证工具改动，因此复用此 full 证据，不把作者的本地 code PASS 当成完整所需证据，也不重复执行本地 code/full。
- 独立 focused Chromium 诊断在未修改的当前源码与 fixture 开发服务执行，共五组行为断言通过：打包四态和下一步；程序单独返工及精确依据；手册单独/双上游变化及窄屏；第三阶段 V3 重新确认 UNKNOWN 的原请求、旧定稿及新依据；新包与历史包隔离。
- 连续诊断覆盖两轮反馈、两种上游返工、UNKNOWN 导航后原请求不变且不能重复确认、同一集合重新定稿、重新冻结、下载新 ZIP；新包 manifest 包含本轮手册/程序/第三阶段定稿 ID，旧包再次下载的字节完全相同。
- 新增永久浏览器回归覆盖 V3 连续返工及两组定稿 ID、首页冻结/失败/UNKNOWN/可用；UI Spec/Test 已同步。当前九文件差异没有扩大产品或后端范围。
- 诊断脚本及实际读回仅保留在本地忽略目录 `.local/mvp/pr322-review/rereview-95ab925*`，全部使用合成材料。它是独立语义检查，不替代 configured full、真实 Runner 或用户业务验收。

## 剩余门禁与交接

M1-3 用户完整试走与当前独立 Runner 脱敏输出展示核对，真实 BFF/Core/Runner、授权、持久化/跨设备恢复、真实内容验收及完整平台矩阵仍为 `NOT RUN`。#321 将其明确列为后续 M1 出口，不作为本次独立 mock 子 PR 的额外代码缺陷；当前不宣称 M1 完成或 M2 解锁。

该候选的独立技术审查通过。正式审查记录仍仅在本地，须在适用 Git 交付授权下纳入版本控制；本轮未 commit/push/merge。之后仍按项目规则处理集成分支交付；batch/main 需冻结累计候选、full、独立最终审查与明确合并授权，main 合入后仍需 post-merge full。当前批准不代替这些门禁。

已提交并回读 [本轮 COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5662056923)，绑定本轮 Reviewed SHA；GitHub 状态为 `COMMENTED`，角色结论为 `APPROVE`。已在原发现线程补充关闭说明并回读：[R1](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384948559)、[R2](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384948809)、[R3](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384949013)。这里的 CLOSED 表示语义发现已修复，不冒充 GitHub 正式审批或线程 resolve 操作。

---

# 上一轮审查记录（历史：75cc191）

以下保留原反例及证据，R1–R3 的当前处置以上方复审为准。

REQUEST_CHANGES。PR #322 当前候选存在三个已复现的 M1 展示/恢复缺陷；应修复后重新审查，当前不批准进入集成分支。

# PR #322 独立审查（2026-10-27）

- 对象：[PR #322](https://github.com/qzhike/zhiju-business-core/pull/322)，关联 [Issue #321](https://github.com/qzhike/zhiju-business-core/issues/321)，分类 T1。
- 阶段：M1 mock 实现子 PR；目标 `batch/mvp-v1-ui`，不是 main 最终交付。
- Reviewed SHA：`75cc191ad493db8b143e1b01d13648e5c6131bca`。
- Base SHA：`06595a6a94208399559ce5767dd107d0cc097184`；审查发布前重新读取，base/head 未变化。
- 仓库变量 `VIBE_BATCH_DELIVERY_ENABLED` 当前为 `true`。
- 范围：实际 31 文件差异、受影响 UI01 Spec/Test、MVP 可用闭环及 #321 Acceptance/Verify。先从需求确认精确集合、上游失效、恢复和首页状态的预期，再核对实现与测试。

## 审查发现

### R1 · [P2] 第三阶段两轮反馈后仍需支持上游返工定稿

位置：[apps/workspace-web/src/fixtures/u2.tsx:1855](https://github.com/qzhike/zhiju-business-core/blob/75cc191ad493db8b143e1b01d13648e5c6131bca/apps/workspace-web/src/fixtures/u2.tsx#L1855)。处置：OPEN。

第三阶段按本 PR 的演练步骤完成两轮反馈并定稿 V3 后，再重新定稿质量手册和控制程序，第三阶段会进入“依据已变化，待复核”，但这里最多只能再次加入已有的 V3。`refinalizing` 又只比较文件版本集合（第 760–762 行），因此保持 false，`StageReviewPage` 隐藏重新确认按钮。独立 Chromium 已复现：四份文件均查看/最新 V3，重新确认按钮数量为 0，交付页持续提示“第三阶段定稿依据已变化”。这使 PR walkthrough 第 3 步后接第 4 步无法完成，违反 #321 的连续多轮反馈与返工后完整集合重新确认要求。请让返工能产生绑定新依据的后续候选，并支持经明确复核保留内容时对新上游依据重新确认；补充“两轮反馈 → 第三阶段定稿 → 上游重新定稿 → 下游重新确认 → 交付”的同项目回归，不只分别测试反馈与从 V1 开始的返工。

### R2 · [P2] 按实际变化来源展示第三阶段的旧新依据

位置：[apps/workspace-web/src/fixtures/u2.tsx:313](https://github.com/qzhike/zhiju-business-core/blob/75cc191ad493db8b143e1b01d13648e5c6131bca/apps/workspace-web/src/fixtures/u2.tsx#L313)。处置：OPEN。

当只重新定稿质量手册、控制程序尚未重新定稿时，`source` 为 MANUAL，但 `previousBasisId` 优先取控制程序 ID，`newBasisId` 也固定取控制程序 ID。实际页面因此显示“变化来源：质量手册重新定稿”，却把同一个控制程序 ID 同时显示为旧依据和新依据；两个上游随后都变化时，来源仍写手册，ID 则仍是程序。这不是文案偏好：用户无法核对这次返工究竟替换了哪项精确定稿，违反 #321 明确要求的旧/新依据展示。请按变化来源选择对应的旧新定稿，或在两项都变化时分别列出两组；回归断言 ID 本身，而不只断言“质量手册重新定稿”字样。

### R3 · [P2] 将首页包状态绑定到实际打包结果

位置：[apps/workspace-web/src/fixtures/u3.tsx:1745](https://github.com/qzhike/zhiju-business-core/blob/75cc191ad493db8b143e1b01d13648e5c6131bca/apps/workspace-web/src/fixtures/u3.tsx#L1745)。处置：OPEN。

这里仅凭 `deliveryFrozen` 就显示“交付包已生成（模拟）”，而传入的条件只是 `delivery.frozen !== undefined`（第 1011 行）。冻结清单之后还需要单独点击“开始打包”，且打包可以失败或 UNKNOWN。独立 Chromium 已复现：确认并冻结清单后没有执行打包，历史包数量为 0，返回首页却已显示“交付包已生成”。同样的判定也无法反映打包失败/待核验。#321 要求首页看板和下一步反映同一项目的真实 mock 状态；请将冻结、待打包/失败/待核验、包可用分别映射，并只在当前冻结清单对应的包可用后显示已生成，加入冻结后未打包及失败/UNKNOWN 的首页读回断言。

## 验证证据与边界

- [CI run 40337937580 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40337937580/attempts/1) 的 `headSha` 为 Reviewed SHA；select、checks、三个 persistence gate、persistence 汇总与 verify 均成功。
- select 日志明确选中 `full`，原因 `batch-engineering-or-unknown-change`；本 PR 修改了 `tools/workspace/check.mjs`，不能只按 UI-only 子 PR 描述为 code 门禁。实际 CI 已提供本次 full 证据，不另报缺失，也不重复本地运行。
- CI 实际 checkout 的测试合并修订为 `5a5a2d8e51709c4f8922ad627e6248e73593d07c`，合并双方对应上述 base/head。此证据只适用于当前子 PR 候选，不是未来 batch/main 或 post-merge full。
- 独立 focused 诊断：在未修改的 Reviewed SHA 源码上启动 fixture Vite 服务，使用仓库锁定的 Playwright Chromium 驱动真实页面。完成确认范围、前两阶段定稿、第三阶段两轮反馈和 V3 定稿、冻结但不打包、首页读回、手册返工、程序返工、第三阶段复核与交付阻断读回。R1–R3 均复现；诊断仅使用匿名合成数据，脚本/读回/截图保留在忽略目录 `.local/mvp/pr322-review/`，详细步骤见本记录与 PR comments。
- 既有浏览器测试分别覆盖第三阶段两轮反馈和从 V1 开始的返工；未覆盖两者连续组合。绿灯不消除本次直接反例；修复后需增加对应回归并重新确认 owning UI Test/M1 checklist 的证据口径。
- 本轮未修改产品代码、永久测试或权威产品要求；新增本正式审查记录。记录仅做文件级格式及 whitespace 检查，不称为配置 docs/full 新结果；当前分支含代码差异，docs 目标不适用于完整候选。
- M1-3 用户完整试走、当前 Runner 脱敏输出展示核对、真实 BFF/Core/Runner、授权/持久化/跨设备恢复、真实内容验收与完整平台矩阵仍为 `NOT RUN`。它们是明确保留的后续门槛，不是本次三个代码缺陷的替代解释。

## 交接

Implementer 修复 R1–R3，补充上述连续/失败回归并同步实质审查处置；新 head 通过适用检查后再独立复审。当前子 PR 不应合入；将来 batch/main 仍需累计候选审查、full 与另行授权的合并，以及 main post-merge full。M1-3 未完成，不宣称 M1 完成或 M2 解锁。

用户本轮授权审查与提交 comments，未授权 Git commit/push/merge；本记录保存在本地，尚未纳入远端提交。

已发布并回读 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/322#pullrequestreview-5661643655) 及三条逐行 comments：[R1](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384604528)、[R2](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384604536)、[R3](https://github.com/qzhike/zhiju-business-core/pull/322#discussion_r4384604547)。GitHub 状态为 `COMMENTED`，绑定上述 Reviewed SHA；`REQUEST_CHANGES` 为 Reviewer 角色结论，不声称已提交 GitHub 正式 changes-requested 审批。
