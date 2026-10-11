# PR #273 独立实现审查

## 人类技术批准与最终结论（2026-10-11；当前结论）

- Reviewer outcome：`APPROVE`。
- Reviewed / human-approved SHA：`3c078f7ded7ad33dfb91591bcb1575f135aa5961`。
- Base SHA：`1316616a8896908f36f15982551c60272e6c7f0c`。
- PR：[#273](https://github.com/qzhike/zhiju-business-core/pull/273)，OPEN / Ready；Issue：[#266](https://github.com/qzhike/zhiju-business-core/issues/266)。
- R1–R9：全部 CLOSED；第四轮代理独立审查无新增 blocking finding。
- 人类实现技术批准：`APPROVED`。批准来源为本会话用户，在明确报告第四轮 reviewed SHA、R1–R9 CLOSED、full CI PASS 和 HUMAN_REVIEW_REQUIRED 后，明确回复“批准”。绑定上述实现修订；不是由代理推断或代替人类作出的批准。
- 本次记录时刻：`2026-10-11 07:49:41 UTC`。记录时重新核对的本地、远端 head 均为上述 SHA，PR 仍 OPEN / Ready；fresh GitHub 只读探针 PASS。

### 批准适用范围与验证

批准适用于 Issue #266 的有界 trusted Human Session / authorized workspace entry T2 实现及第四轮已审修订。依据包括 [第四轮独立复审 comment](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6106798590)、下方保留的完整正式复审及 [exact-head CI run 38111231906](https://github.com/qzhike/zhiju-business-core/actions/runs/38111231906)。本次再次读取 checks / persistence / aggregate verify / select，四项均 SUCCESS；复用既有 exact-head full 证据，没有重复运行配置验证或修改产品。

Issue #266 所要求的独立 exact-head 审查与适用人类实现技术批准，在此 approved SHA 上已满足。生产安装/凭据/部署、实际 Windows/macOS Chrome/Edge 平台矩阵、独立人工顾问验收、Host/Runner、D14/真实客户/Provider 等未执行层继续保留 NOT RUN；本批准不重新标记这些证据。

本正式记录仍为本地未提交交付物，不属于 approved SHA 的提交或 CI。用户本次“批准”授权记录技术批准及延续本 PR 的 comment 发表；Git commit/push 和合并仍按既有单独授权规则执行。实现若发生后续变化，需要按变更核对审查、验证与批准适用性。

### 批准记录 GitHub 发表

- 人类实现技术批准与最终结论 comment：[issuecomment-6106849066](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6106849066)，绑定 reviewed / approved SHA `3c078f7ded7ad33dfb91591bcb1575f135aa5961`，明确本会话用户“批准”的来源、`APPROVE` 结论与保留的 NOT RUN 层次。
- 发表后经 GitHub API 独立读回，正文与 prepared body 逐字一致，comment ID 和 URL 均核对一致。
- 发布账户与 PR author 均为 `galendai`；以 comment 保留批准事实，没有声称提交正式 GitHub APPROVED review event。
- 正式 Review 继续保持本地未提交；没有 commit、push 或 merge。当前 reviewed SHA 的独立审查与人类技术批准已满足，正式记录的 Git 交付和合并仍分别遵循授权及最终 head 门禁。

---

## 第四轮复审（2026-10-11；历史记录）

- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。
- Reviewed SHA：`3c078f7ded7ad33dfb91591bcb1575f135aa5961`。
- Base SHA：`1316616a8896908f36f15982551c60272e6c7f0c`。
- PR：[#273](https://github.com/qzhike/zhiju-business-core/pull/273)，OPEN / Ready；Issue：[#266](https://github.com/qzhike/zhiju-business-core/issues/266)。
- R1–R9：全部 CLOSED；本轮没有新增 blocking finding。
- 剩余门禁：适用的人类实现技术批准仍为 `PENDING / NOT PROVIDED`。当前代理审查没有实现、契约、文档或必需验证阻塞；按 Issue #266 Verify 的新 T2 实现人类技术批准要求和 Reviewer outcome precedence，转交人类技术审查，不输出 APPROVE 或推断合并授权。

### 本轮独立依据与范围

从最新 Issue Goal/Acceptance/Scope/Verify 及 owning UI01 #258 的分层事实规则建立预期：已执行的真实受控 Keycloak、公开 HTTP、一次性 PostgreSQL 与受控 Chromium 制品旅程应准确记录；生产部署、实际 Windows/macOS Chrome/Edge 矩阵和独立人工验收继续 NOT RUN。独立审查当前 head 的三处实际修订及相邻完整段落，未以实现者关闭声明代替 diff 和证据。相对上轮 reviewed `5b6ad739a5b1c5df0736f71b2778b5ce31204496`，仅两个 owning Markdown 文件、3 insertions / 3 deletions；没有产品、测试、公开契约、迁移、CI、tooling 或验证策略变更。既有代码及字段审查结论在本轮保持有效，不声称重新盲审全部实现。

`vibe repo --json` 确认 repository `qzhike/zhiju-business-core`、本地 reviewed SHA；本轮 fresh `gh api user` 只读探针 PASS，远端 head 与本地一致。当前发布权限仅覆盖复审 comment；没有实施修复、commit、push 或 merge。

### R9 修复复核

| 位置                                                                                                                                                                        | 本轮判断                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [UI01 Module-Test:145](https://github.com/qzhike/zhiju-business-core/blob/3c078f7ded7ad33dfb91591bcb1575f135aa5961/.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md#L145) | CLOSED：同段首尾均准确区分已执行的受控 Keycloak / built-browser 等层次和未执行的生产 / 平台 / 人工层次，原本轮 NOT RUN 矛盾消除。明确命名 owning suites，未把更广泛未执行子项提升为 PASS。 |
| [UI-258-001:149](https://github.com/qzhike/zhiju-business-core/blob/3c078f7ded7ad33dfb91591bcb1575f135aa5961/.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md#L149)       | 同步移除“受控 Keycloak 部署 NOT RUN”的旧尾句，将受控旅程与生产安装/凭据/部署分开。                                                                                                         |
| [UI01 Module-Spec:290](https://github.com/qzhike/zhiju-business-core/blob/3c078f7ded7ad33dfb91591bcb1575f135aa5961/.vibe/module-specs/Module-Spec-UI01-WorkspaceUI.md#L290) | 第 8 项与当前实现事实一致；已执行的受控 OIDC / HTTP / PostgreSQL / Chromium 与未执行的生产 / Host / Runner / 实际平台 / 人验分别保留。无新增规范参数或批准范围扩展。                       |

R1–R8 的代码/契约修复不受本轮纯文档 delta 影响。R5 在上一 head 的独立旧反例、未变化终页正控和目录原 suite 共 24 tests PASS 是前轮定向证据；本轮复用而未重复运行，不标成本轮新本地执行。

### 当前 exact-head 验证

- Issue #266 必需 configured target 仍为 `full`，CI 按整个 PR 的 base-to-head 路由，未因末次文档提交降为 docs。
- 独立读回 [CI run 38111231906](https://github.com/qzhike/zhiju-business-core/actions/runs/38111231906)：head_sha 精确为 `3c078f7ded7ad33dfb91591bcb1575f135aa5961`，completed / success。
- [checks](https://github.com/qzhike/zhiju-business-core/actions/runs/38111231906/job/114387089579)：SUCCESS；`Verify code` 与 controlled Chromium 安装 SUCCESS，`Verify documentation` 为预期 skipped。
- [persistence](https://github.com/qzhike/zhiju-business-core/actions/runs/38111231906/job/114387089629)：SUCCESS；head_sha 精确匹配，受控 Chromium 安装、clean build prerequisites、`Verify persistence` 均 SUCCESS。
- [aggregate verify](https://github.com/qzhike/zhiju-business-core/actions/runs/38111231906/job/114393861991) 和 select 全 SUCCESS；当前未变化 CI workflow 的 code + clean build/persistence 路径覆盖 required full。本轮没有重复本地 full/environment 或新 focused tests。
- 生产安装/凭据/部署、实际 Windows/macOS Chrome/Edge 矩阵、独立人工顾问验收、Host/Runner、D14/真实客户/Provider 等超出本 slice 或独立未执行层仍保持 NOT RUN，不由受控成功推断 PASS。

### 人类技术门禁

Issue #266 Verify 明确要求：“New T2 implementation requires independent exact-head review and applicable human technical approval before delivery.” 本轮核对当前 PR reviews（仅 COMMENTED，无 APPROVED）、本轮后续 PR/Issue 评论与已有前轮证据，没有绑定当前实现 head 的明确人类技术批准；最新实现者 comment 也将此门禁记录为 pending。#258 的既有 revision-bound 人类设计批准单独有效，未被解释为 #266 的新实现批准。

当前 outcome 不是新的实现缺陷，也不是普通 merge 授权缺失。人类技术审查应对当前实现修订作明确判断并保留批准证据；若 head 后续改变，按变更重新核对审查和验证适用性。正式记录本身仍是本地未提交交付物，不属于当前 reviewed SHA/CI。

### 第四轮 GitHub 发表

- 复审汇总：[issuecomment-6106798590](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6106798590)，明确 reviewed SHA `3c078f7ded7ad33dfb91591bcb1575f135aa5961`、R1–R9 CLOSED / no new blocking finding、current full CI 与 `HUMAN_REVIEW_REQUIRED` 门禁。
- 发表后经 GitHub API 独立读回，正文与 prepared body 逐字一致，comment ID 与 URL 核对一致。
- 发表前最后一次远端 PR 查询确认 head 仍为 reviewed `3c078f7`。发表及正文读回成功后，收尾补充 `gh api repos/qzhike/zhiju-business-core/pulls/273 --jq ...` 在 sandbox 返回 `dial tcp 198.18.0.37:443: i/o timeout`；按 AGENTS.md 先执行宿主最小只读 `gh api user --jq .login`，同样超时。已发布/读回完成事实保持有效，未声称取得发表后的额外 head 读回；没有转用 UI 或重复发表。
- 用户授权的是 comment；本轮未提交正式 GitHub APPROVE review。正式记录保持本地未提交状态，仓库交付与人类实现技术批准仍为分别记录的完成事实。

---

## 第三轮复审（2026-10-11；历史记录）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`5b6ad739a5b1c5df0736f71b2778b5ce31204496`。
- Base SHA：`1316616a8896908f36f15982551c60272e6c7f0c`。
- PR：[#273](https://github.com/qzhike/zhiju-business-core/pull/273)，OPEN / Ready；Issue：[#266](https://github.com/qzhike/zhiju-business-core/issues/266)。
- 当前阻塞：1 项 P2，R9 的 owning UI01 Module-Test 当前验收状态自相矛盾。
- R1–R8：全部 CLOSED。本轮确认 R5 最终检查点修复，不沿用上一 head 的失败结论。
- 适用的人类实现技术批准：`PENDING / NOT PROVIDED`。先完成残余 owning 文档修复，再复审新 head 与适用人类技术门禁。

本轮先从 Issue 当前 Acceptance/Verify、EP §258 最终检查点规则与 owning 当前事实同步要求建立预期，再读取第二轮 head 至当前 head 的实际 9 文件 diff、最新修复评论、当前 CI 和相关完整段落。当前本地、远端 reviewed head 一致；没有以实现者“两个 P2 已关闭”的声明代替独立复核。修改范围只有本正式审查记录，独立临时 probe 已删除；无产品实现、契约或原测试改动，无 commit/push/merge。记录不属于 reviewed SHA 的提交或 CI。

### 上轮修复判断

| 发现                   | 本轮结果                 | 依据                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5 / P2 最终返回检查点 | CLOSED                   | `reobserveServedObservation` 返回并保留 Decision/row/scope/observation；最终 `checkpointEntry` 在新页 awaited reads 之后覆盖 `[...carried,...used]`，逐项在原 exact Enterprise+Project Scope 重验并重读。旧页摘要在终页新读期间变化时抛 `QUERY_CURSOR_INVALID`，在构造 Page/cursor/snapshot/watermarks 之前中止；失权继续原 AUTHORIZATION_REVOKED 映射，无数据返回。独立旧反例与 unchanged-chain 正控均 PASS，原目录 suite 同时 PASS。 |
| R9 / P2 文档当前事实   | PARTIAL / OPEN           | EP §258 的水位说明已与实际首屏 `servedObservationDigest` 的 48-bit 投影一致；IP/EP/UI01 主状态、Delta、PR acceptance/NOT RUN 和多数相关 Test 行已正确分层。但 UI01 Module-Test §258 首段尾句仍把已执行的 Keycloak/制品旅程称为本轮 NOT RUN，与同一段新增的 PASS 声明冲突。                                                                                                                                                             |
| R1–R4、R6–R8           | CLOSED（保留第二轮判断） | 此次修复 delta 不修改对应 BFF/Web/契约/CI 实现；当前 exact-head full CI 覆盖相关回归。未重复声称独立本轮执行这些全部测试。                                                                                                                                                                                                                                                                                                             |

### R9 / P2 残留：同一 owning 当前验收段落同时声明已执行与 NOT RUN

定位：[Module-Test-UI01-WorkspaceUI.md:145](https://github.com/qzhike/zhiju-business-core/blob/5b6ad739a5b1c5df0736f71b2778b5ce31204496/.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md#L145)。

该段新增状态说“受控 Keycloak 26.7.0 隔离 realm/client/user 与受控 Chromium 制品旅程已在 exact-head persistence gate 通过”，其尾句却仍说“本轮已取得确定性本地、一次性 PostgreSQL 与真实公开 HTTP（合成 issuer/JWKS/RS256/PKCE）证据，受控 Keycloak 部署、浏览器制品旅程、平台矩阵与独立人验仍 NOT RUN”。至少 built-browser 制品旅程在同一个当前 owning 验收段落被同时标为已执行和未执行，无法作为明确的证据层次记录；尾句标注“本轮”，没有作为历史记录隔离。

修复只需同步这条已决定的当前事实：保留合成协议证据的独立层，明确受控 Keycloak / HTTP / PostgreSQL / built-browser 已有相应 evidence，将真正未执行的生产、实际 Windows/macOS Chrome/Edge 矩阵和独立人工验收继续列为 NOT RUN。R9 不是新的业务实现或设计请求；当前 owning 验收文档的重要事实矛盾依项目 Reviewer policy 仍阻塞。没有要求把未执行子场景或更广泛整行提升为 PASS。

### 验证与契约边界

- `vibe repo --json` PASS，repository / local SHA 已确认；本轮 fresh `gh api user` 只读探针 PASS，后续 CLI 读取正常。
- 必需 configured target 为 `full`；复用当前 [CI run 38106169517](https://github.com/qzhike/zhiju-business-core/actions/runs/38106169517)：[checks](https://github.com/qzhike/zhiju-business-core/actions/runs/38106169517/job/114372092996)、[persistence](https://github.com/qzhike/zhiju-business-core/actions/runs/38106169517/job/114372093200)、[verify](https://github.com/qzhike/zhiju-business-core/actions/runs/38106169517/job/114379061782) 全部 SUCCESS。独立读回 persistence job 的 head_sha 精确匹配 `5b6ad73`，浏览器安装 / clean build prerequisites / Verify persistence 全 SUCCESS；该 CI 分拆覆盖 required full。没有为复制当前可信 CI 再跑 full。
- Reviewer 定向执行锁定 Vitest：directory-entry 原 suite 22 tests + 独立第三轮 R5 probe 2 tests，**2 suites / 24 tests PASS**。独立 probe 使用真实 directory entry/Registry、owning IP/EP port doubles，保持与第二轮相同反例：A@3 已复验后 B read 将 A 推进到 @4，当前返回前 checkpoint 正确拒绝；未变化终页正控 OK、稳定 snapshot/watermarks、无 nextCursor。该定向执行不冒充独立本轮 PostgreSQL 或 Keycloak 本地运行。
- [实现者当前修复/证据评论](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6105041471) 声明 110 files / 2285 unit tests、focused PostgreSQL directory 11/11 PASS，独立读取的 exact-head CI 是本轮复用 required full 的主要证据。
- 本次 9 文件 delta 未改变 contracts、CI 或 tooling，公开字段矩阵沿用第二轮完整检查；DirectoryCursor 仍为已声明的 16..8192 封闭信封、原样 Project spelling 与容量 fail closed。base 至当前 head 的 `contracts/baselines/v1.0` 无变化。未发现新的实现/契约阻塞。
- 实际 Windows/macOS Chrome/Edge 矩阵、生产、独立人工顾问验收、D14/Host/Runner/真实客户与 Provider 仍为独立未执行层；现有受控 Keycloak/制品层不替代这些门禁。

### 第三轮 GitHub 发表

- R9 残留行内 comment：[discussion_r4240126027](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4240126027)，绑定 reviewed SHA `5b6ad739a5b1c5df0736f71b2778b5ce31204496`，UI01 Module-Test 第 145 行。
- 复审汇总：[issuecomment-6105082659](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6105082659)，明确 `REQUEST_CHANGES`、R5 CLOSED、R9 PARTIAL / OPEN、exact-head CI 与独立 24-test 诊断结果。
- 发表后经 GitHub API 独立读回，两条正文与 prepared body 逐字一致；行内 comment 的 SHA/path/line 与预期一致。
- 角色 outcome 的 comment 不等于正式提交 GitHub REQUEST_CHANGES review。正式记录继续保留未提交状态；无产品修复、commit、push 或 merge。

---

## 第二轮复审（2026-10-11；历史记录）

- Reviewer outcome：`REQUEST_CHANGES`。
- Reviewed SHA：`1d7535f82d43ed79d68f13b5e65dd9e3f92bf24d`。
- Base SHA：`1316616a8896908f36f15982551c60272e6c7f0c`。
- PR：[#273](https://github.com/qzhike/zhiju-business-core/pull/273)，OPEN / Ready；Issue：[#266](https://github.com/qzhike/zhiju-business-core/issues/266)。
- 本轮阻塞：2 项 P2。R5 尚有返回前检查缺口；R9 为 owning 文档的当前事实未同步。
- 适用的实现人类技术批准：`PENDING / NOT PROVIDED`；已知修复问题先交 Implementer，修复后独立复审新 head。

本轮从 Issue 当前验收、EP §258 的最终检查点规则、批准的 Session Delta、IP/EP/UI Spec/Test 与公开契约重建预期，再检查上轮 SHA 至当前 head 的 27 个修复路径及当前实现。本地与远端 head 相同，base 未变。复审覆盖上轮 R1–R8，不以实现者的“已解决”声明代替静态审查、定向反例和精确修订 CI。仅更新此正式审查记录，临时 Reviewer probe 在发表前删除；未修复产品代码、未修改契约/原测试、未 commit/push/merge。此审查记录不在被审 SHA 的提交或 CI 内，Git 交付未授权。

### 上轮发现复核

| 发现    | 本轮判断           | 独立依据                                                                                                                                                                                                                                                                                                                            |
| ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 / P1 | CLOSED             | 受信代理仅选择目标 Host；真实 Origin 保留。独立定向 BFF 用例验证外站/null/缺失 Origin 均 403 且零 Core 调用，正控 200。                                                                                                                                                                                                             |
| R2 / P1 | CLOSED             | LoginTransaction 携带 bindingGeneration；同步 CAS 只允许同一浏览器代次一个 winner，替换时移除旧 Session；并发 winner 和旧 Cookie 失效两个定向用例 PASS。                                                                                                                                                                            |
| R3 / P1 | CLOSED             | runLogout 在 await 前退休 guard、取消 protected reads、移除 protected routes；BFF 在 Core await 后 isCurrent。迟到 protected Query 定向用例 401、无 protected body；Web logout/guard 回归 PASS。                                                                                                                                    |
| R4 / P2 | CLOSED             | 预算分支保留 items/used，cursor 只越过已检查项。完整预算链回归 PASS。                                                                                                                                                                                                                                                               |
| R5 / P2 | OPEN               | 全部已返回身份/观测现已携带并在每次续读开始复验；跨请求变化、消失、失权、原样 spelling 和容量回归 PASS。但当前页读取期间旧页变化不在最终返回检查点复验，定向反例仍返回 OK/FRESH，见下文。                                                                                                                                           |
| R6 / P1 | CLOSED（执行缺口） | 实际受控 Keycloak fixture 固定镜像 digest、生成隔离 realm/client/user，以 built SPA + BFF + Core + PostgreSQL 完成真实 PKCE 登录，并验证真实 refresh/Keycloak admin key rotation。新的非跳过 suite 由精确 head 的 persistence gate 收集且通过；合成/改写 token 拒绝分支仍作为其各自层次。当前 owning 文档的旧 NOT RUN 声明归入 R9。 |
| R7 / P2 | CLOSED             | 依据 owner option (a) 的 Query 专用 DirectoryCursor，request.page.cursor/result.nextCursor 均是封闭 16..8192 URL 字母表；types 同步，短/错误字母表/8193 负例及边界正例 PASS。其他 Query/Board 仍共享 16..512。                                                                                                                      |
| R8 / P1 | CLOSED             | persistence runner 安装受控 Chromium 与系统依赖；原 built-browser teardown 分步注册资源并容忍部分启动失败。精确 head 的 persistence 和 verify 均 SUCCESS。                                                                                                                                                                          |

### R5 / P2：已返回摘要没有进入最终返回检查点

定位：[workspace-directory-entry.ts:1000](https://github.com/qzhike/zhiju-business-core/blob/1d7535f82d43ed79d68f13b5e65dd9e3f92bf24d/apps/api/src/composition/workspace-directory-entry.ts#L1000)；最终 checkpoint 的 `used` 循环位于同文件 1071 行。

`cursor.served` 在新页读取之前逐项重验，但 helper 仅返回 void，没有把此前页的 Decision/观测加入最终 checkpoint。后者只遍历本次扫描的 `used`。独立定向反例：首屏 A@3；续页早期复验 A@3；读取 B 时 A 已变为 @4；最终页仍返回 `OK / FRESH`、首屏 snapshot/watermarks 并省略 nextCursor。客户端保留 A@3 且链已结束，没有后续请求补救。未变化两页链正控 PASS；变化期间的负控因返回成功而 FAIL。

EP §258 的现行规则明确要求 EP/IP 相关水位在逐项读取前后及最终返回检查点变化时拒绝 `QUERY_CURSOR_INVALID`；无跨 Enterprise 原子快照的限制不取消已定义的最终检查点。修复应让此前页的已返回身份、当次授权与观测在 awaited 新页读取之后也进入返回前重验，整页拒绝已变化链；增加“终页读取期间旧页变化”的回归，保持 exact Scope、已声明容量及扫描预算，不引入技术 Session 业务缓存或全库 EP 扫描。

### R9 / P2：owning 文档仍描述被替换的水位和验收事实

定位：[Module-Spec-002-EnterpriseProject.md:1013](https://github.com/qzhike/zhiju-business-core/blob/1d7535f82d43ed79d68f13b5e65dd9e3f92bf24d/.vibe/module-specs/Module-Spec-002-EnterpriseProject.md#L1013)。

该“实现事实”仍称 `enterprise_project` 水位记录首屏受权摘要数；当前代码却通过 `servedObservationDigest` / `enterpriseProjectWatermarkSequence` 使用首屏真实观测摘要 digest 的 48-bit 投影。这是当前来源语义的差异，不能同时作为 owning 真相。该节状态及相关 Spec/Test、PR 验收/NOT RUN 描述还把已经执行的 controlled Keycloak / built browser 保留为 NOT RUN。

需同步已经决定的 owning 文档事实，准确描述实际 digest、续页和最终 checkpoint；已执行层以精确 head PR/CI 链接为证据，生产、实际 Windows/macOS Chrome/Edge 矩阵与独立人工验收仍分别 NOT RUN。按项目 Reviewer policy，当前实现使权威文档重要事实过时是阻塞项；本修复不要求新的设计或未授权生产工作。

### 当前目录 Contract 字段矩阵

| 契约字段                      | required / optional 与值约束        | 当前实现                                                          |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| Query.enterpriseRef           | optional ObjectRef<Enterprise>      | shared objectRef                                                  |
| Query.searchText              | optional Sensitive<NonEmptyString>  | nonEmptyString；不回显                                            |
| Query.page                    | required closed PageRequest         | closed object                                                     |
| Query.page.pageSize           | required integer 1..50              | minimum=1/maximum=50                                              |
| Query.page.cursor             | optional Query 专用 DirectoryCursor | minLength=16/maxLength=8192/URL 字母表；generated DirectoryCursor |
| Summary.enterpriseRef         | required ObjectRef<Enterprise>      | shared objectRef，完整 Scope                                      |
| Summary.projectRef            | required ObjectRef<Project>         | shared objectRef，保留被授权身份的原样 spelling/Scope             |
| Summary.enterpriseDisplayName | required SafeSummary                | safeSummary                                                       |
| Summary.displayCode           | required NonEmptyString             | nonEmptyString                                                    |
| Summary.title                 | required SafeSummary                | safeSummary                                                       |
| Summary.status                | required ACTIVE/SUSPENDED/ARCHIVED  | owning 闭集，未扩展 PREPARING                                     |
| Summary.aggregateVersion      | required AggregateVersion           | 1..MAX_SAFE_INTEGER                                               |
| Page.items                    | required WorkspaceProjectSummary[]  | typed array，允许空/重复，未误加 uniqueness                       |
| Page.nextCursor               | optional Query 专用 DirectoryCursor | 与请求同一封闭声明，Page/Envelope 同值                            |
| Page.snapshotAt               | required UtcInstant                 | utcInstant                                                        |
| Page.sourceWatermarks         | required SourceWatermark[]          | typed array，未以 open JSON 代替                                  |
| SourceWatermark.sourceModule  | required NamespaceCode              | namespaceCode                                                     |
| SourceWatermark.partition     | optional NonEmptyString             | nonEmptyString                                                    |
| SourceWatermark.sequence      | required NonNegativeInt             | integer minimum=0                                                 |
| SourceWatermark.observedAt    | required UtcInstant                 | utcInstant                                                        |

冻结的 `contracts/baselines/v1.0` 从 base 至 reviewed head 无变更。此 Query 专用 cursor 延长已进入 owning EP/API 声明、注册 schema 和生成 types；容量超限 fail closed 是已声明边界，没有提升为新的审查要求。当前字段/接受集检查与语义 R5 问题分开判断。

### 验证与证据边界

- `vibe repo --json`：本地 repository/branch/head 已确认；远端发布前再次读取 head。
- 必需 configured target 为 `full`。复用精确 `1d7535f` 的 [CI run 38063743281](https://github.com/qzhike/zhiju-business-core/actions/runs/38063743281)：[checks](https://github.com/qzhike/zhiju-business-core/actions/runs/38063743281/job/114247117452)、[persistence](https://github.com/qzhike/zhiju-business-core/actions/runs/38063743281/job/114247117430)、[verify](https://github.com/qzhike/zhiju-business-core/actions/runs/38063743281/job/114255801736) 全部 SUCCESS。persistence job 的 head_sha 精确匹配，Install controlled Chromium / Build persistence prerequisites / Verify persistence 均 SUCCESS；workflow 分拆执行 configured full 覆盖的 code 和 PostgreSQL gate。本轮没有为复制可信证据重跑 full。
- 实现者的 [精确 head 本地 full 记录](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6099448566) 声明 110 files / 2283 unit tests、55 files / 692 persistence tests PASS；将其作为实现者的本地证据，独立判定同时依赖已读回的当前 CI。
- Reviewer 锁定 Vitest 定向检查：原有 directory-entry、EP schema、Web logout、Web guard 4 suites 共 269 tests PASS；另有 1 个 unchanged-chain 正控 PASS。最终独立 R5 probe 2 tests 中正控 PASS、变化期间的负控 FAIL（实际 OK/FRESH），不冒充 PostgreSQL 或 Keycloak 独立本地执行。
- Reviewer 定向真实 BFF + 本机合成 HTTP issuer/Core：R1 Origin、R2 winner、R2 replaced-session、R3 delayed protected result 共 4 tests PASS，24 个不相关测试因 filter 未执行。
- 新 Keycloak suite 不用 FakeOidcProvider 代替正常登录；fixture 固定 `keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13`、读取容器版本、只生成本次测试凭据，运行 PKCE built-browser、真实 refresh 和 admin API key rotation。版本/digest/configuration 来源由 fixture 和精确 CI/PR 证据保留，未宣称生产安装完成。
- 实际 Windows/macOS Chrome/Edge 矩阵、独立人工顾问验收、生产、D14/Host/Runner 和真实客户/Provider 执行继续 NOT RUN；当前 human implementation technical approval 仍单独 pending。
- 工具恢复记录：本轮 `gh api user` 初探成功；随后沙箱 `gh pr view` 两次连接超时，宿主 `gh api user` 两次同样超时（`198.18.0.37:443`）。有界恢复中尝试 CUA，未提供 browser/iab；随后宿主小型 REST 读取恢复成功，后续返回 `gh`，没有诊断为凭据失效或要求新登录。

### 本轮 GitHub 发表

状态：已发布并逐项读回，3 条 comments 的 body 与准备内容完全匹配；2 条行内评论的 commit_id/path/line 精确匹配 reviewed SHA 与定位。发布期间远端 head 再读仍为 `1d7535f82d43ed79d68f13b5e65dd9e3f92bf24d`。

| 评论                              | 发布定位                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5 / P2 最终检查点                | [discussion_r4239994873](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4239994873)，workspace-directory-entry.ts:1000         |
| R9 / P2 owning 当前事实           | [discussion_r4239995308](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4239995308)，Module-Spec-002-EnterpriseProject.md:1013 |
| REQUEST_CHANGES 汇总与 R1–R8 复核 | [issuecomment-6104657774](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6104657774)                                          |

本轮任务的复审与 comment 发表已完成。Reviewer outcome 为 REQUEST_CHANGES，评论不等于正式 GitHub REQUEST_CHANGES review。将两项 P2 修复交 Implementer，修复后要求独立复审新 head 与当前 full 证据；适用的人类实现技术批准仍是单独门禁。正式记录保留本地未提交状态，不进行产品修复或 Git 交付。

---

## 第一轮审查（2026-10-10；历史记录）

### 审查对象与结论

- Issue：[#266](https://github.com/qzhike/zhiju-business-core/issues/266)，T2 trusted Human sessions and authorized workspace entry。
- PR：[#273](https://github.com/qzhike/zhiju-business-core/pull/273)，OPEN / Ready。
- Reviewed SHA：`c342738c8677d71c26e1fc34378af0662e4f63f0`。
- Base SHA：`1316616a8896908f36f15982551c60272e6c7f0c`。
- 日期：2026-10-10。
- Reviewer outcome：`REQUEST_CHANGES`。
- 阻塞发现：8 项，5 项 P1、3 项 P2。
- 本实现修订的人类技术批准：`PENDING / NOT PROVIDED`。已批准 predecessor design 不替代该实现门禁；当前先修复已知问题。

审查以当前 Issue/评论、批准的 #258 Session Delta、IP/EP/UI owning Spec/Test、共享 API/Page 规则、实际 base-to-head diff 和当前 CI 为依据。先建立真实 ACTIVE HUMAN、每次精确 Scope/独立授权、Session 失效、分页不丢项及分层证据预期，再检查实现。当前工作区与 PR head 相同，106 个变更路径，共新增 20,196 行、删除 140 行。未修改业务实现、契约或原测试，未 commit/push/merge。

本正式记录在 reviewed SHA 之后由 Reviewer 新增，不属于该 SHA 或其 CI；Git 交付尚未授权。GitHub 发表状态见文末，发表 comments 与正式提交 APPROVE/REQUEST_CHANGES review 是不同事实。

### 独立验收判断

| 验收边界                                                        | 判断及证据                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定 issuer/client/audience、PKCE、封闭 callback、真实 Keycloak | 已检查 token/callback/peer 组成边界与真实 HTTP fixture。合成 issuer 不能完成 Issue 明确要求的真实受控 Keycloak 层，见 R6。                                                             |
| owning link、真实 HUMAN/Actor/Decision、逐项 RLS、授权不继承    | 本次读取 resolver、self-only V1008、discovery authorization、EP exact-scope read、board adapters。逐项目独立 Decision 与 EP Scope 实现存在；不将这些静态读取称为独立 PostgreSQL PASS。 |
| directory 过滤、完整 cursor chain、预算与水位                   | 两个独立定向反例分别证实丢项和 EP 跨页变更未拒绝，见 R4/R5。                                                                                                                           |
| 有限 transport、注册与结果校验                                  | 检查 Core/BFF dispatch、 owning read/result validation 和新增 Query 字段矩阵。结果 OpaqueCursor 约束未保持，见 R7。                                                                    |
| Session rotation、Origin、登出/迟到结果、清理                   | 四个定向 BFF HTTP 反例证实三项实现问题，见 R1/R2/R3。原有 refresh 单飞/late refresh 证据不证明 distinct-state callback 或晚到 Query 安全。                                             |
| built browser / 必需 full gate / evidence truth                 | required target 为 full。当前 CI 普通 checks 通过，persistence 已有明确 Browser 依赖失败，见 R8；没有把历史本地 PASS 当作当前 CI PASS。                                                |
| D14/Runner、生产、平台矩阵和人验                                | 属于已声明的后续或独立门禁，保留 NOT RUN，没有提升为本审查的额外实现要求。                                                                                                             |

### 新增目录 Contract 字段矩阵

逐字段比较批准的 EP #258、共享 API §4 与新 schema/generated type。以下记录字段、required/optional 和约束；不把 handler 当前输出有效等同于注册 schema 的接受集正确。

| 契约/字段                     | 批准的字段/约束                           | 实现 property / required/optional                                              |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Query.enterpriseRef           | optional ObjectRef<Enterprise>            | optional，复用 shared objectRef                                                |
| Query.searchText              | optional Sensitive<NonEmptyString>        | optional，nonEmptyString；敏感字段不进入响应                                   |
| Query.page                    | required PageRequest                      | required closed object                                                         |
| Query.page.pageSize           | required integer 1..50                    | required，minimum=1/maximum=50                                                 |
| Query.page.cursor             | optional OpaqueCursor                     | optional，复用 opaqueCursor                                                    |
| Summary.enterpriseRef         | required ObjectRef<Enterprise>            | required，shared objectRef；handler 输出 enterprise 完整 ref                   |
| Summary.projectRef            | required ObjectRef<Project>               | required，shared objectRef；handler 传递被授权 candidate 的原 objectType/Scope |
| Summary.enterpriseDisplayName | required SafeSummary                      | required，safeSummary                                                          |
| Summary.displayCode           | required NonEmptyString                   | required，nonEmptyString                                                       |
| Summary.title                 | required SafeSummary                      | required，safeSummary                                                          |
| Summary.status                | required owning registered Project status | required，ACTIVE/SUSPENDED/ARCHIVED；无 PREPARING 扩展                         |
| Summary.aggregateVersion      | required AggregateVersion                 | required，integer 1..MAX_SAFE_INTEGER                                          |
| Page.items                    | required WorkspaceProjectSummary[]        | required，typed array；允许空、没有误加 uniqueness                             |
| Page.nextCursor               | optional OpaqueCursor                     | optional，实际使用 nonEmptyString，违反约束，见 R7                             |
| Page.snapshotAt               | required UtcInstant                       | required，utcInstant                                                           |
| Page.sourceWatermarks         | required SourceWatermark[]                | required，typed array；不替换成 open JSON                                      |
| SourceWatermark.sourceModule  | required NamespaceCode                    | required，namespaceCode                                                        |
| SourceWatermark.partition     | optional NonEmptyString                   | optional，nonEmptyString                                                       |
| SourceWatermark.sequence      | required NonNegativeInt                   | required，integer minimum=0                                                    |
| SourceWatermark.observedAt    | required UtcInstant                       | required，utcInstant                                                           |

新增 public operation/metadata 是 additive directory Query，authorizationPurpose=`project.workspace.discover`，INTERNAL、AUTHORITATIVE。没有要求改写冻结的 200-operation 历史基线；兼容证据仍须以该修订的实际 gate 为准。

### 阻塞发现

#### R1 / P1：代理转发字段绕过实际 Origin 校验

定位：[`apps/workspace-bff/src/routes.ts:142`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/apps/workspace-bff/src/routes.ts#L142)。

受信代理分支把请求的 Origin 换成目标 Host/proto。通过 allowlisted proxy 发出有效 Cookie/CSRF 且 Origin 为外站的请求，实际返回 200 并调用 Core；批准的 Delta §6 要求 403 且 Core 调用为零。应保留并独立核验实际 Origin，转发字段只用于可信目标解析；增加代理路径下缺失/null/外站 Origin 的拒绝覆盖。

#### R2 / P1：并发 callback 无单一 winner，重新登录后旧 Session 仍有效

定位：[`apps/workspace-bff/src/routes.ts:444`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/apps/workspace-bff/src/routes.ts#L444)。

LoginTransaction 只按 state 消费，SessionStore.create 没有 browser generation 的原子胜出/替换边界。两个不同 state 共用同一 browser-binding Cookie 时，并发 callback 实际建立两个 Session；携带旧 Session Cookie 再登录成功后，旧 Cookie 仍为 ALLOWED。Delta §3 要求同一浏览器代次只一个 winner，替换后旧 ID 作废。需实现浏览器代次的原子完成和被替换 Session 的失效，不将同一 Principal 的所有设备登录混为一个 Session。

#### R3 / P1：登出没有先失效当前标签页，BFF 返回迟到受保护结果

定位：[`apps/workspace-web/src/TrustedApp.tsx:159`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/apps/workspace-web/src/TrustedApp.tsx#L159)。

当前标签页发起登出仅清 selectedKey 并广播其他标签页，自己的 live identity、目录 state 和 guard 要等 postLogout 完成才 reload。BFF 又等待尽力 IdP revocation，等待期间可能保留敏感目录并接纳旧请求。BFF 的 protected Query 返回前也未重验 Session；独立反例先发出延迟 Query、完成 logout，再收到 200 和受保护卡片。Delta §6 要求先推进 generation、清缓存/DOM，再处理异步结果。需同步清理当前标签页，并在 BFF 返回 awaited protected read 前复核 Session 身份/期限。

#### R4 / P2：扫描预算分支丢弃已匹配卡片并越过其游标位置

定位：[`apps/api/src/composition/workspace-directory-entry.ts:671`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/apps/api/src/composition/workspace-directory-entry.ts#L671)。

预算耗尽分支清空 items/used，却保留已向后推进的 lastKey。收紧 maxCandidates=1，候选 A 为匹配且 ALLOW、B 为 DENY，连续读取至末页后实际累计零卡片，A 永远被游标跳过。默认 5 秒 wall budget 也可进入同一分支。空中间页不能丢弃已消费的匹配项；应保留并重验已累积结果，或保证 cursor 不越过尚未交付的匹配候选，并断言完整 cursor chain 的结果。

#### R5 / P2：目录 cursor 未检测前页受权 EP 摘要的变化

定位：[`apps/api/src/composition/workspace-directory-entry.ts:766`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/apps/api/src/composition/workspace-directory-entry.ts#L766)。

cursor.q 只是首屏已读摘要数，后续原样复制；最终 reread 只检查当前页 used，不检查此前已返回摘要的当前来源事实。反例：第一页 A 的 aggregateVersion=3，A 变为 4 后按原 cursor 读取 B，仍返回 OK/FRESH 与旧 snapshot/watermarks。EP Spec #258 和 Delta §5 保留相关 EP 事实变化拒绝 QUERY_CURSOR_INVALID 的规则，复制计数不能证明这项不变量。需绑定并验证 owning 的相关受权摘要变更观察，保持无全库 EP scan、无 Session 业务 cache 的边界。

#### R6 / P1：尚未执行 Issue 必需的真实受控 Keycloak 验收

定位：[`tests/persistence/workspace-built-browser.test.ts:54`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/tests/persistence/workspace-built-browser.test.ts#L54)。

两条真实 HTTP/Browser suite 都使用 FakeOidcProvider，证明的是合成 issuer 的协议路径。Issue #266 的 Acceptance/Verify 明确要求 actual controlled Keycloak + public HTTP + PostgreSQL + built browser，并记录实际版本/digest 与安全配置来源；当前 PR 声明该层 NOT RUN。生产安装/凭据属于 non-goal，但隔离 controlled realm/client/user setup 明确在 Scope 中，不能以生产 non-goal 放宽验收。需补真实受控 Keycloak 允许链与适用拒绝/issuer/refresh/轮换证据，保持合成、生产及人工层分开。

#### R7 / P2：结果 Page 的 nextCursor 扩宽为普通 NonEmptyString

定位：[`contracts/src/operations/enterprise-project.schema.ts:498`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/contracts/src/operations/enterprise-project.schema.ts#L498)。

新结果 workspaceProjectPage.nextCursor 使用 NonEmptyString，批准的 Page<T> 明确要求 OpaqueCursor。实际公开 result validator 接受 'x'、含点游标、513 字符，valid fixture 正控通过；请求 cursor 已正确约束。需复用 opaqueCursor、重生成类型，并补结果长度/字符集负例。

#### R8 / P1：persistence CI 未安装新增 Browser suite 的运行依赖

定位：[`tests/persistence/workspace-built-browser.test.ts:305`](https://github.com/qzhike/zhiju-business-core/blob/c342738c8677d71c26e1fc34378af0662e4f63f0/tests/persistence/workspace-built-browser.test.ts#L305)。

新 built-browser suite 进入 persistence gate，但 CI 仅在独立 checks runner 安装 Chromium。受审 head 对应 run 38047988002 的 persistence job 已失败：缺少 chromium_headless_shell-1248，53 suite/685 tests 通过、1 suite 失败、1 test skipped，汇总 verify 失败。afterAll 随后对未创建的 context 调用 close，阻止 stack.stop。需在执行该 gate 的 runner 提供锁定 Browser/system dependencies、保证 setup 部分失败时清理，并取得当前修订 full 通过证据。

### 验证证据与限制

- `vibe repo --json`：PASS，repository/head 已建立；`git status --short` 初始干净。
- [CI checks](https://github.com/qzhike/zhiju-business-core/actions/runs/38048022348/job/114201422805)：SUCCESS，对应 PR head `c342738c`，包含 configured code 检查。未为重复证据再次运行 code/full。
- [CI persistence](https://github.com/qzhike/zhiju-business-core/actions/runs/38047988002/job/114201323888)：FAILURE，具体失败是新 Browser suite 找不到 Chromium，而非 PostgreSQL/RLS 测试失败。实际 53 suite/685 tests 通过、1 suite 失败、1 test skipped；完整 gate 没有通过。
- [Run `38048022348`](https://github.com/qzhike/zhiju-business-core/actions/runs/38048022348) 在发表时已完成：checks SUCCESS、persistence FAILURE、verify FAILURE；不是当前 full PASS。
- 实现者声称本地 `vibe verify full --json` 于 `a478c40` PASS；其后仅 README 更新。这是历史本地证据，不覆盖当前 CI 的依赖缺口，也不证明真实受控 Keycloak 已运行。
- Reviewer 定向 composition 反例：通过锁定 Vitest 4.1.10 运行两个临时测试，断言正确行为均 FAIL：累计卡片 expected 1 / actual 0；EP 变更后 expected QUERY_CURSOR_INVALID / actual successful result。Port 替身限定为验证组成层的真实分页/游标逻辑，不冒充独立 PostgreSQL 证据。
- Reviewer 定向 BFF HTTP 反例：四个临时测试均执行至明确业务断言并 FAIL。预期/实际：callback winner 1/2，旧 Session EXPIRED/ALLOWED，登出后的 delayed protected Query 401/200，代理后的外站 Origin 403/200。真实 BFF、真实本地 HTTP 合成 issuer/Core；不冒充真实 Keycloak。
- Reviewer 直接公开 validator：valid result fixture 正控接受；nextCursor 短/错误字符/超长三个负控全部错误接受，见 R7。
- 初次 `pnpm exec vitest run ...` 卡在包管理器的 `pnpm install`，已中止；read-only preflight 确认锁定 pnpm 11.19.0/Node 24.19.0 可用。定向诊断直接调用已安装 Vitest，未替代 configured target。BFF 沙箱监听未启动，主机环境定向测试正常执行；未改依赖、锁文件或 verifier。
- 真实受控 Keycloak、Windows/macOS Chrome/Edge 矩阵、独立人工顾问验收、生产、D14/Host/Runner、真实客户/Provider 执行均 NOT RUN。

定向反例临时源文件在审查发表前删除，避免把 Reviewer 的诊断测试混入实现修订。正式记录是唯一新增的仓库文件；Git 交付 PENDING / NOT AUTHORIZED。

### GitHub 发表与后续门禁

发表状态：已完成并读回。8 条行内 comments 的 body、commit_id、path、line 全部匹配；[汇总结论](https://github.com/qzhike/zhiju-business-core/pull/273#issuecomment-6097306667) body 读回一致。按用户请求以 comments 发布；这是 Reviewer outcome，不声称正式提交 GitHub REQUEST_CHANGES review。

| 发现    | 已发布 comment                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R1 / P1 | [代理转发字段绕过实际 Origin 校验](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547314)                         |
| R2 / P1 | [并发 callback 无单一 winner，重新登录后旧 Session 仍有效](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547415) |
| R3 / P1 | [登出没有先失效当前标签页，BFF 返回迟到受保护结果](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547487)         |
| R4 / P2 | [扫描预算分支丢弃已匹配卡片并越过其游标位置](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547542)               |
| R5 / P2 | [目录 cursor 未检测前页受权 EP 摘要的变化](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547607)                 |
| R6 / P1 | [尚未执行 Issue 必需的真实受控 Keycloak 验收](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547675)              |
| R7 / P2 | [结果 Page 的 nextCursor 扩宽为普通 NonEmptyString](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547836)        |
| R8 / P1 | [persistence CI 未安装新增 Browser suite 的运行依赖](https://github.com/qzhike/zhiju-business-core/pull/273#discussion_r4237547981)       |

发表后回读 run `38048022348`：checks SUCCESS、persistence FAILURE、verify FAILURE，run 已完成；绑定的 PR head 仍为 `c342738c`。

本结论为独立 Reviewer 的 `REQUEST_CHANGES`。修复应由 Implementer 在原 owning 范围中完成，并同步必要 Spec/Test、取得当前 full 证据，然后重新审查新 head；适用的实现人类技术批准继续单独保留。不修复产品代码、不 commit/push、不 merge。
