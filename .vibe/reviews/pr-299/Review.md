# PR #299 独立代码审查

## 最新浏览器预算复审：b27f278 / APPROVE

- 日期：2026-10-16；PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)。
- Reviewed SHA：`b27f278b3b6b2e7e162a22a33067ba8bc0b7d45a`，Reviewer 独立运行 `vibe repo --json` 确认；写入本记录前工作树干净。
- Reviewer outcome：`APPROVE`。相对 `50c7ec38df14679b5260a343d91cdeebeb75d576`，该提交只修改两份持久化浏览器测试，未修改产品、业务预算、受控 fixture 或权限/事实接受集；独立检查修订与慢 owner 对照、精确 head full 后未发现新的可证实阻塞。上轮远端 CI 的失败仍是有效历史，新远端最终 head 的 CI 尚待取得实际通过证据。

### 失败、干净对照与修订判断

Reviewer 读取缓存 CI run `38852056576` 的 `1_persistence.txt`，确认该 run 不能由普通 checks 通过而认定整体成功：持久化有三项断言失败，包括 NEW 的三十秒 UI 等待、restart 的三十秒 PUT response 等待和 Keycloak 看板文本快照竞态；还发生 afterAll 三十秒超时，Core 存在正文已完整接收但尚未结束响应的活动 PUT。该远端 run 的失败不被此前本地 full 或审查 APPROVE 覆盖。

为区分合法慢处理与业务失败，原主会话在临时受控诊断中，仅在每次真实 EP acceptSource 前等待十二秒，保留实际 owning PostgreSQL/receipts 链。Reviewer 独立读取两个诊断文件：

| 对照 | 实际可见证据与解释 |
| --- | --- |
| `/tmp/preparation-upload-slow-baseline.log` | 旧 NEW 用例因三十秒 UI 子等待失败；真实 owning/runtime 随后在约 49.903/49.908 秒完成并触发 onSend/onResponse；afterAll 仍超时，运行最终 FAIL。说明业务仍在既有预算内完成时，旧子窗口会过早结束测试，不能把该运行写成成功。 |
| `/tmp/preparation-upload-slow-fixed.log` | 同一慢处理条件下，owning/runtime 约 48.930/48.934 秒完成，NEW 用例 PASS，BFF/Core active requests=0 且清理正常结束。该 focused 只选 NEW，另外两项过滤 skip，不作为整套浏览器通过；临时诊断不构成生产性能或容量认证。 |

最终提交中已移除所有临时 sleep、owning/runtime wrapper 和 server hooks。实际测试修订如下：

- NEW 在提交点击前注册同原 intake 路径的 PUT 响应等待；restart 继续匹配已知 intake 的固定路径。两项均使用 **case 启动时的原 120 秒 deadline 剩余预算**，没有把 case 总时限提高至五分钟，也没有新增随机 sleep。
- response waiter 与 action 以 Promise.all 连接，要求 **200、response.finished() 无错误**之后才检查 UI。STAGED/READY、manifest、WAITING_CAPABILITY、generation、原 command/身份及重登等原断言保留；实际 503、响应中断或超过 case 总预算仍失败。afterAll 仍为 **30 秒**，不强杀活动请求，不吞掉清理错误。
- Keycloak 用例先等待任务看板的不可用状态出现，再读取同一 boardSection 的文本快照；原行数、READY/APPROVED、DEPENDENCY_UNAVAILABLE 及其余权限断言没有删除。该调整修复读取快照早于异步状态完成的竞态，不放宽业务预期。

### 精确修订的完整验证

Reviewer 独立读取 `/tmp/pr-299-browser-budget-full-tool-output.txt` 中原主会话 `20891` 的实际工具返回文本，核对该 SHA、命令、退出状态、可见汇总、第二次 migration、gate 与清理。导出声明工具截断，不是完整原始日志；不提交该临时文件，也没有由 Reviewer 重复执行 full。

- `vibe verify full --json` 实际工具退出码 **0**，最终 JSON 为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。
- 普通测试 **143 files / 2955 tests PASS**；production browser **7 PASS**；fixture browser **53 PASS**。
- PostgreSQL **64 files / 739 tests PASS**；第二次 migration 无待应用变更，gate passed，临时 PostgreSQL 容器移除。本轮完整通过覆盖两份已修订测试，未把 focused 的过滤 skip 推广为全量完成。
- BFF/Core 清理时 active requests 均为 **0**，两者 closed，runtime/owning pools、OIDC、浏览器和 stack 清理阶段正常结束。关闭回调后的 idle connection close 事件不被误写为未完成的活动请求。

### 批准与仍待交付的证据

产品与 `50c7ec3` 无差异，先前已记录的人类技术批准及产品审查边界保持；本轮未引入需另定的架构、授权、数据或业务预算选择。该独立 APPROVE 不是 GitHub 原生 review，也不把旧失败 run 升级为新 CI 通过。由原主会话在正式文档子提交和最终推送后，绑定精确最终 head 核对远端 required checks；不能沿用其他 head 的 CI。

真实生产 Provider/Ceph、native TE/Runner、报告、完整浏览器平台矩阵、性能/容量以及独立人工/客户验收仍为 `NOT RUN`。本 Reviewer 只追加正式记录，未改产品或测试，未 commit、push、merge、运行 full 或查询 CI。下方所有历史原文保留各自精确修订与当时结论，不被覆盖。

---


## 最新传输修订复审：204b7ee / APPROVE

- 日期：2026-10-16；PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)。
- Reviewed product SHA：`204b7ee5f23b12ef7de62906af24026de04053d5`，Reviewer 独立通过 `vibe repo --json` 确认。冻结产品未再修改；随后规划对账与本正式记录为文档增量，不包含在该产品 SHA 中。
- Reviewer outcome：`APPROVE`。本轮重新核对 ZIP 传输修复、增强的浏览器完成条件和该精确产品的 configured full，未发现新的可证实阻塞。此前 CI 的清理超时是实际失败，不能由其测试断言全部通过而抹掉；当前仅确认修订后的本地完整验证通过，远端最终 head 仍须重新检查。

### 失败证据与独立范围

本轮读取缓存 CI run `38753381512 / attempt 1` 的 `2_persistence.txt`：第三个上传 case 后 Core 仍有活动 PUT，随后 afterAll 超时。初始修订仅增强测试等待，真实响应 503 仍会暴露，不能把这一步称为根因已修复。最终产品还修正两项传输行为，并保持原权限、存储、source/manifest/handoff 与不可变原请求边界。

- 静态 Web 代理此前对所有请求使用十五秒 socket 超时。现在仅对 `PUT` 加固定 UUIDv7 `/bff/customer-intakes/<id>/zip` 路径使用 **300 秒 socket inactivity timeout**，允许正文结束后合法的 owning 处理继续；普通请求仍为十五秒，固定 upstream 未改变。该参数不是独立绝对总时钟；Browser 的五分钟 AbortSignal 与 BFF/IG 原上传总时限、空闲、大小和授权限制保持，不从代理 timeout 推导更宽的业务接受集。
- Browser `uploadPreparationZip` 在成功 headers 后继续消费完整 response body，正文尚未结束不能返回成功，正文中断仍失败。对失败/UNKNOWN 仍沿原 intake 查询，不改变键、Project 或原 bytes，不制造 replacement。
- 浏览器重传测试在 file picker 操作前注册同一 intake 精确 PUT 响应等待，要求 **200 且 response.finished() 无错误**，再核对 generation 2、STAGED、READY、manifest 和真实 WAITING_CAPABILITY 摘要。不能只用 owner 已提交事实或 UI 文字代替 HTTP transport 完成。
- 新真实 HTTP proxy 回归让受控 upstream 在收到完整正文后处理十六秒，验证原 bytes 和完整成功响应。Browser transport 正负对照分别让 200 headers 先到而 body 延迟或中断。本轮最终产品上 Reviewer 独立执行 transport **8/8 PASS**；真实 HTTP proxy 回归由 configured full 覆盖，受控 upstream 不冒充真实 BFF/业务验收。
- cleanup 的三十秒 hook 与 case timeout 没有提高，没有跳过、强杀活动请求或吞错。保留的诊断只有去 query 的路径与 HTTP 状态布尔量，不包含 token/note；临时 fetch/runtime handler 包装未进入产品。测试路径迁移至既有 typed test project，没有修改 tsconfig 或验证政策。

### 精确产品验证证据

Reviewer 独立读取 `/tmp/pr-299-transport-full-tool-output.txt` 中原主会话 `34025` 的实际工具返回文本，核对产品 SHA、命令、退出码、汇总、第二次 migration、gate/容器与 HTTP/pool 清理。文件明确声明工具截断，不是完整原始日志；临时导出不提交仓库，Reviewer 未重复运行 full。

- `vibe verify full --json` 实际工具退出码 **0**；最终结果 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。
- 普通测试 **143 files / 2955 tests PASS**；production browser **7 PASS**；fixture browser **53 PASS**。
- PostgreSQL **64 files / 739 tests PASS**；第二次 migration 无待应用变更，gate passed，临时 PostgreSQL 容器移除。
- 清理时 BFF active requests=0、Core active requests=0；runtime/owning pools、OIDC、浏览器与 stack 清理阶段均正常结束。Core close 回调后待派发 close 事件的 idle connections 不等于未完成的活动上传。本轮没有用断言通过数掩盖 hook/suite 失败。

### 文档对账、批准与交付边界

同时语义核对 Planner 提供的三文档增量：roadmap 与 EP/IG owning 状态明确 #291 已实现的准备创建、首包托管/说明及原请求恢复切片；后续意图仍是准备分析、报告接纳、启动核对与整份选择，并要求重新核对 NOW + READY。它们不制造已合并、真实公司发布、native TE/Runner、完整客户链或 IM-UI-01 完成事实，验收证据继续归 Issue/PR。该对账不改变公共字段、Policy 或产品行为。

原用户对已审 #291/R2 的技术批准与后续合并授权仍按下方历史原文保留。本轮是实现既有五分钟 ZIP 传输边界、补全成功响应完成语义的修复，没有新增架构/授权/数据边界；没有据此制造新的技术批准请求或伪写用户对 `204b7ee` 的新精确批准。独立代码审查 APPROVE 不代表新的 GitHub 原生 review，也不替代最终 head 的 required checks。旧 CI 失败不能自动提升为已修订远端 CI 通过；由原主会话在文档子提交、最终推送后核对。

真实生产 Ceph/OIDC、native TE/Runner、报告、完整浏览器平台矩阵及独立人工/客户验收仍为 `NOT RUN`。本 Reviewer 仅追加正式记录，未修改产品、commit、push、merge 或查询 CI；下方全部历史审查和人工批准原文完整保留。

---


## 最新整合复审：08713bb / APPROVE

- 日期：2026-10-15；PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)。
- Reviewed product SHA：`08713bbd5c8a8294a7191ec1f79bbae542a9129c`，Reviewer 独立执行 `vibe repo --json` 确认；正式记录前工作树干净。
- Reviewer outcome：`APPROVE`。本轮核对最新 main 整合、冲突解决和精确修订的 configured full 证据，未发现剩余可证实阻塞；R1、R2 维持关闭。此为独立代码审查结论，不是 GitHub 原生 APPROVED review，也不替代最终远端 required checks 或自动执行合并。

### 本轮独立范围与冲突复核

基于此前 R2 产品复核，重新检查 `f30ffd13a66cda63ad6217470b67018b3f131f33` 到本次 head 的增量、当前 PR 相对 main `f823a81b2ccd14207c242fed54c51d25387d55f0` 的差异及手工冲突交集。既有 main 新增的 Markdown review/delivery 页面与其测试、文档按已合并基线辨认，本轮重点检查它们与 #291 准备旅程的整合，不把其他审查记录的结论当作此次冲突已正确解决的证据。

- `serve.mjs` 同时保留 main 的 `/review-workspace` 和 #291 的 `/preparations/<UUIDv7>`；旧有页面 routes 保留。Reviewer 对实际正则运行七组独立对照：两个新增入口及旧 `/projects/new`、delivery 路径匹配；UUIDv4、额外子路径和路径穿越形式拒绝。
- `TrustedApp` 保留 main 的 DeliveryPage UNAVAILABLE 接线，同时保留 #291 的 LiveNewProject、LivePreparationRequest 与当前 Session/Scope guard；未见冲突解决移除准备流程或将开发 fixture 引入生产。未改变的准入、授权、ZIP/XML 安全、source/manifest/handoff 实现沿用此前已核对的代码边界。
- UI owning Module-Test 完整保留 #286 有界审查工作区十一项场景、#287 页面工程接受集和 #291 准备旅程测试入口；各自受控本地与真实服务/外部/人工 NOT RUN 的边界未混同。
- 中间 merge SHA `1318ca69e2e39ef749d75302166d923bc91ff967` 的 serve 正则行缺少缩进，Reviewer focused Prettier 确认失败并要求修正。`1318ca6 → 08713bb` 仅补该行两空格，不改变任何正则字符；精确 head 上 focused Prettier 检查 `serve.mjs` 与 UI Module-Test 已 PASS，该阻塞已闭合。

### 精确 head 验证与证据限制

Reviewer 独立读取原主会话 `80981` 的实际工具返回文本导出 `/tmp/pr-299-merge-full-tool-output.txt`，核对其产品 SHA、命令、退出码、可见摘要、持久化 gate/清理及最终 JSON。该导出明确声明工具截断，正文还存在内嵌截断；它不是完整原始日志，临时文件不作为仓库交付物。

- `vibe verify full --json` 实际工具退出码 **0**；最终结果为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。此结果对应 `08713bb`，没有沿用整合前 head 的 full；Reviewer 未重复运行 full。
- 可见普通测试摘要为 **142 files / 2952 tests PASS**，production browser 为 **7 passed**，包含 review/delivery 生产隔离对照。
- fixture browser 可见启动 **53** 项用例，但该部分最终摘要已被截断；本记录不填入未经读回的 passed 数。PostgreSQL 的 test files/tests 汇总和第二次 migration 摘要同样不可见，不从前一修订复制计数或将不可见内容写作本轮独立核对事实。
- 可见 PostgreSQL **gate passed**、临时容器移除；BFF/Core 清理时 active requests 均为 **0**，runtime/owning pools 以及其余清理阶段正常结束。关闭回调时尚有待派发 close 事件的 idle connections 不表示活动上传。configured full 的最终成功与这些可见记录一致。
- focused 路由对照与格式检查只证明冲突交集，不代替上述 configured full。远端最终 head 的 CI 状态本轮未查询；本地 full 不能冒充 GitHub required checks 通过，后续文档子提交仍须由原主会话完成精确 head 交付检查。

### 人类批准与剩余交付门禁

下方保留的用户明确“批准”绑定 `f30ffd1`，满足已审 #291 实现与 R2 修订的人类技术审核门槛。本轮辨认该已批准产品语义仍保留：新增准入/隔离/XML 安全代码没有在 main 整合中被另行修改；冲突交集是既有 main 页面与两条入口、owning 测试文档的并存，以及格式修正。因此没有据无关 main 整合重新制造同一 #291 技术批准请求，也没有将旧批准伪写为用户对本次具体 SHA 的新批准。用户后续合并授权由原主会话掌握，必须与 required checks 等实际交付门禁分别处理。

真实生产 Ceph/OIDC、native TE/Runner、报告、完整浏览器平台矩阵和独立人工/客户验收仍为 `NOT RUN`，本次整合与自动验证不提升这些层的状态。原主会话在审查记录文档子提交后执行文档验证、最终推送、精确 head CI 与已获授权的交付；本 Reviewer 只追加该记录，未修改产品、commit、push、merge 或轮询 CI。以下所有历史原文完整保留。

---


## 2026-10-15 人类技术批准：f30ffd1

用户在原会话收到下方 `f30ffd1 / HUMAN_REVIEW_REQUIRED` 复审结论后明确回复“批准”。本次批准绑定 `f30ffd13a66cda63ad6217470b67018b3f131f33`，覆盖已审 #291 实现及 R2 修订的人类技术批准门禁。记录前重新核验远端 head 未变化，PR 为 OPEN / Draft。

该人类技术批准门禁已满足；下方各轮结论保留当时的历史状态。批准不改变测试与外部验收事实：远端 checks 仍为空，最新 head CI 尚无通过证据；真实生产/外部/人工客户验收边界不升级。本次“批准”不扩展为 commit、push、合并或部署授权，正式记录的本地增量仍未提交。

已同步 [PR 批准记录 comment 6193691162](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6193691162)，并经 GitHub API 回读确认批准原文来源、精确 SHA 与保留门禁。

## 2026-10-15 最新远端修订复审：f30ffd1 / HUMAN_REVIEW_REQUIRED

- Reviewed SHA：`f30ffd13a66cda63ad6217470b67018b3f131f33`；`vibe repo --json` 与发布前 GitHub head 一致，开始时工作区干净，PR 仍为 Draft。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。原 R2 的独立反例已闭合，本次增量复审未发现新的可证实阻塞实现缺陷；原 R1 维持关闭。#291 新准入、授权、隔离与托管的适用人类技术审核仍须完成，不能据此合并。
- 本次范围为 `508987c` 后的全部八文件增量：parser、scanner/owning persistence 回归、精确依赖与 lockfile、IG Spec/Test 和正式审查记录。未变化部分沿用本会话此前核对；没有将已有 Reviewer 的结论当作本轮独立验证结果。

### R2 关闭依据

依据最新 Issue/评论、IG owning Spec/Test 和原 D14 ZIP 接受集复核：坏 DOCX 必须 CORRUPT，合法 Markdown 可保留部分结果，零可分析来源不得成功交接。三个 XML 部件现在统一采用 `saxes@6.0.0` namespace-aware SAX 解析；只有实际根/直接子元素建立 OOXML 证据。错误事件和 DTD 均直接拒绝，没有外部实体 resolver。namespace 原属性空白检查先于 tag URI 判定，避免 parser trim 把错误 URI 变为批准值；原 ZIP 限额及累计 XML 时间/内存检查保留。

直接对当前源码重放上一轮保留的五个独立 ZIP 样本（`/private/tmp/pr299-review-repro/`），未用修复方新 fixture 替代原反例：

| 样本 | 当前实际结果 |
| --- | --- |
| 正常 DOCX | ANALYZABLE，空 reasonCodes |
| 错误根 namespace，无注释 | INTEGRATION_NO_ANALYZABLE_SOURCE |
| 注释伪根 + 实际错误 namespace | INTEGRATION_NO_ANALYZABLE_SOURCE |
| 正确 namespace + 重复属性 | INTEGRATION_NO_ANALYZABLE_SOURCE |
| 正确 namespace + 非法 `&#0;` | INTEGRATION_NO_ANALYZABLE_SOURCE |

新增 scanner 用例在三个 XML 部件分别覆盖原反例、重复 expanded-name 属性、namespace 字面/实体空格、DTD/外部实体，保留正常 comments/CDATA/PI 正例及深层 parser frame 预算反例。owning PostgreSQL 新四例从真实 ZIP/CRC 经 IG upload 路径验证：mixed 包持久化 PARTIAL/三项 CORRUPT，三个 DOCX-only 包零 source/object/manifest/event/handoff。已检查这些断言与原请求 replay；它们的 EP/object ports 仍是明确受控依赖。

### 本轮证据与保留门禁

- 本轮独立 focused Vitest：`./node_modules/.bin/vitest run modules/integration-gateway/src/customer-zip/zip-safety.test.ts modules/integration-gateway/src/customer-zip/upload-ticket.test.ts contracts/src/preparation-fixtures.test.ts contracts/src/preparation-intake.test.ts tests/workspace/preparation-transport.test.ts`；**5 files / 148 tests PASS**，含 scanner 68 项。原反例另直接经 Node transform-types 执行当前源码，结果见上表。
- 读取 `/tmp/pr-299-r2-full-tool-output.txt` 的已有工具输出导出，核对产品 SHA `967e333b27acb2ec29e0c85ae98c0867da934dee`、configured `vibe verify full --json`、exit 0/PASS、普通 **139 files / 2936 tests**、PostgreSQL **64 files / 739 tests**、二次 migration no-op 和容器清理。该导出明确被截断，不是完整原日志；属于已存在的本地执行证据，不声称本轮重新执行 full，也不从截断部分推断单例明细。
- `967e333` 到本次 reviewed SHA 仅修改正式 Review.md，产品代码与依赖无差异；据此复用该产品 full 证据，避免重复数据库运行。完整 PR 仍属于 full 范围，不因最后的文档提交降级。
- 本轮 GitHub 精确 head 的 checks 和 workflow run 查询均为空：远端 CI **NOT RUN**。没有可绑定的 run/attempt，不注册 waiter，也不使用旧 head 的 CI。最终 required checks 仍待交付方补齐。
- 真实生产 Ceph/OIDC、native TE/Runner、完整浏览器平台矩阵及独立人工/客户验收仍 NOT RUN。人类技术审核、远端 CI 和合并授权分别保留；本轮不提交 GitHub 原生 APPROVED review。

本轮仅追加本正式文档，未修改产品代码，未 commit/push/merge。已按用户授权发布 [复审 comment 6193428932](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6193428932)，并通过 GitHub API 回读确认正文、reviewed SHA、R2 关闭及保留门禁。发布为普通 PR comment，不是 GitHub 原生 APPROVED review。`git diff --check` 与本文件 Prettier check 通过。

## 先前复审：R2 修订 / 967e333 / HUMAN_REVIEW_REQUIRED

- 日期：2026-10-15；Issue：[#291](https://github.com/qzhike/zhiju-business-core/issues/291)，PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)，仍为 Draft。
- Reviewed product SHA：`967e333b27acb2ec29e0c85ae98c0867da934dee`。Reviewer 独立运行 `vibe repo --json` 确认；复核时唯一未提交差异是用户上一轮 R2 正式审查记录，产品工作树没有其他差异。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。R2 已证实的 XML 反例及本轮另发现的 namespace trim 反例均已修复，当前复核未发现新的可证实阻塞实现缺陷；#291 整体的适用人类技术审核仍须完成，不据本结论合并或认定生产验收完成。
- R1 的实现范围缺口继续保持已关闭；下方 `508987c / REQUEST_CHANGES` 为修订前的有效历史发现，完整保留，不代表本产品 SHA 仍接受那些反例。此前所有审查与验证记录同样保留其各自修订含义。

### 独立范围、反例与修订核对

重新读取 [R2 comment](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6189936913)、IG owning Spec/Test 和 D14 ZIP 边界，并检查该产品提交的七个文件。预期是从真实 XML 根及直接子元素判断 OOXML、完成良构性校验、禁止 DTD/外部实体且保持原资源上限；正常 DOCX 应可分析，坏 DOCX 与合法 Markdown 共存时保留 CORRUPT/PARTIAL，零可分析源不得形成成功交接。此轮不重新定义 DOCX 专业内容验收或实现新的提取/Runner 能力。

- `zip-safety.ts` 已移除三套正则 XML 路径，改用固定 `saxes@6.0.0` 的单一路径、命名空间感知 SAX 事件。实际根的 local name/URI、直接子 Override 和同一内部 officeDocument Relationship 分别核验；注释、CDATA、PI 不构成元素证据。
- parser error 与 doctype 事件即拒绝，不安装外部实体 resolver；重复属性（含不同前缀但相同 expanded name）、非法字符/字符引用、未绑定前缀等由严格解析拒绝。原 ZIP/CRC、DOCX 二级累计展开和至少一个可分析条目的闸门保留。
- Reviewer 另独立复现 saxes 会 trim namespace 声明 URI 的边界：前后空格包围的错误 URI曾被转换成批准 URI，导致 DOCX-only 错误 ANALYZABLE。修订在 attribute callback 使用原解析值拒绝 namespace whitespace/trim 差异，先于 binding 与 tag.uri 判断；原复现 ZIP 直接运行修订源码现返回 `INTEGRATION_NO_ANALYZABLE_SOURCE`。三 XML 部件的 literal/entity padding 正负对照已加入。
- XML 解析不建立 DOM，分块处理沿用本次 ZIP 的 120 秒墙钟预算，并在解码前预留 UTF-16/token buffers、对 live frames/attributes 计入现有 512 MiB 保守预算。deep-frame 测试使用默认 namespace，避免祖先前缀解析成本掩盖测试目的。没有放宽 ZIP policy 的任何上限。
- `pnpm-lock.yaml` 的最终变化仅为新 parser 与其 `xmlchars` 依赖；临时顺带出现的 picomatch 更新已恢复。owning Spec/Test 更新与实际严格解析及失败语义一致。
- owning PostgreSQL 新四项测试保留真实 ZIP/CRC。mixed 包验证实际 IG custody/manifest 为 PARTIAL、三类坏 DOCX 为 CORRUPT 且 analyzable=false；三个 DOCX-only 反例验证零 source 调用、object、manifest、event、handoff，原请求 replay 不改失败事实。该测试使用真实 IG owning 服务与 PostgreSQL，EP/object 端口为明确受控依赖，不能称为本轮 native EP/TE/Runner 外部验收。

### 该产品修订的实际验证证据

Reviewer 独立读取 `/tmp/pr-299-r2-full-tool-output.txt` 中原主会话 `82320` 的实际工具返回文本，核对产品 SHA、命令、工具退出码、汇总、migration/清理和最终 JSON。导出明确含工具截断声明，不是完整未截断日志；该临时文件不提交仓库，Reviewer 没有重复运行 full。

- `vibe verify full --json` 工具退出码 **0**，最终结果 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。
- 普通测试 **139 files / 2936 tests PASS**；production browser **5 PASS**；fixture browser **36 PASS**。
- Catalog/Registry/FULL 均 **258**；compatibility baseline 的 frozen **200 PASS**，未扩大本轮公共操作接受集。
- PostgreSQL **64 files / 739 tests PASS**；第二次 migration 无待应用变更，gate passed，临时 PostgreSQL 容器移除。清理记录中 BFF/Core active requests 均为 0，runtime/owning pools 和其余清理阶段正常结束；未把关闭回调时待派发 close 事件的 idle connections 当作活动上传。
- Reviewer 在上述精确产品 SHA 独立执行 `./node_modules/.bin/vitest run modules/integration-gateway/src/customer-zip/zip-safety.test.ts`，**1 file / 68 tests PASS**。此为反例与正常对照的 focused 核对，不能替代 configured full。

### 保留门禁与交付边界

本地 full 通过不等于远端 CI 通过。形成本记录时，本轮精确最终 head 的远端 required checks 尚无通过证据；由原主会话在文档提交后确认 CI，并按既有规则绑定原会话等待。该文档子提交不在 reviewed product SHA 中，不改变上述产品实现。

真实生产 Ceph/OIDC 部署、native TE preparation engine、Runner/真实 execution ack、报告、完整浏览器平台矩阵与独立人工/客户验收仍为 `NOT RUN`。受控本地与协议测试只证明其实际覆盖层。适用人类技术审核、最终 CI 和合并授权继续独立保留，#277 的设计批准不被提升为本次实现的生产批准。

本轮仅追加本正式复审记录；完整保留下方用户 R2 与更早轮次原文，未修改产品代码、commit、push、merge 或提交 GitHub 原生 review。

---


## 2026-10-15 独立复审：508987c / REQUEST_CHANGES

- Reviewed SHA：`508987c520929005b638014bf76f54ee710aad1c`；本地 `vibe repo --json` 与发布前 GitHub head 一致，PR 仍为 Draft，开始时工作区干净。
- Reviewer outcome：`REQUEST_CHANGES`。原 R1 的实现范围缺口已有实质交付；本轮独立反例发现 R2：DOCX XML 校验接受伪造命名空间与非良构 XML。下方其他轮次的 `HUMAN_REVIEW_REQUIRED` 和本地 full 记录保留历史含义，不能覆盖本次新发现。

### 复审范围与 R1

重新读取最新 #291（无新评论）、PR/head/评论、项目配置与 Reviewer/contract-review 规则，按 EP/IP/IG #277 owning 规格、D14 ZIP 限制和 API transport 建立独立预期。核对自原 `12a1cb2` 起的变更范围，检查真实 production routing/composition、前端创建与原请求恢复、IG request/query/upload/restart/source/manifest 流程、权限组合、迁移和相关 schema/fixtures；没有将其他审查者的结论当作本轮批准依据。

原 R1 所指“仅有独立票据 helper、生产仍全部返回未实现”已不再成立：新增 production composition、有限 EP/IG handlers、React/BFF 接线、owning 服务及迁移都已存在。此项范围缺口关闭，不表示所有新增行为已经验收通过。本轮发现以下确定性缺陷后，按 Reviewer 规则报告阻塞，不宣称穷尽了整个新增实现的所有缺陷。

### R2 / P2：DOCX XML 检查把损坏文件标为可分析

定位：[zip-safety.ts L291–303](https://github.com/qzhike/zhiju-business-core/blob/508987c520929005b638014bf76f54ee710aad1c/modules/integration-gateway/src/customer-zip/zip-safety.ts#L291)，相关 `validXml` 为 L261–288，最终判定为 L443–462。

`rootNamespace` 在原始 XML 文本上取第一个正则匹配，不排除注释。保持合法的 ZIP central/local headers、CRC、ContentTypes Override 和 package Relationship，仅将 `word/document.xml` 换成下列内容，当前 `scanCustomerZip` 仍返回 `ANALYZABLE`、空 reasonCodes：

```xml
<!-- <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/> -->
<w:document xmlns:w="urn:wrong"><w:body/></w:document>
```

删除注释但保留同一错误根命名空间时，正确触发 `INTEGRATION_NO_ANALYZABLE_SOURCE`。注释本身不改变实际根元素的 expanded name，因此这是明确绕过，不是合法 OOXML 的另一种表示。

同一 XML 检查边界另有两个干净负例：正确根命名空间下，根元素增加 `a="one" a="two"` 重复属性，或在 `<w:t>` 中放 `&#0;`，当前也均为 `ANALYZABLE`。Python 标准 XML parser 独立确认前者为 duplicate attribute，后者为 invalid character number；`validXml` 只匹配标签及实体字面模式，没有完成良构性检查。

影响：只含该损坏 DOCX 的 ZIP 通过末尾“至少一个可分析条目”检查。`intake-service.ts` 按 scanner 结果设置 source 的 `validation.analyzable`，并将其写入 manifest；全条目被标可分析时 custody 可成为 READY。这违反 #291 Acceptance、[D14 §2](../../decisions/d14-rd01-first-customer-flow.md) 与 IG owning 规格的“损坏 DOCX 逐项 CORRUPT、零可分析源拒绝分析”要求。这里没有声称已复现外部 Runner 执行或代码执行。

修复要求：从完成良构性验证的实际 XML 根元素取得命名空间，不让注释/CDATA/PI 充当元素证据；拒绝重复属性和非法字符引用，继续禁止 DTD/外部实体，并保持有界资源限制。新增正常 DOCX 正例、同包仅修改 document.xml 的上述负例，以及有合法 Markdown 时 CORRUPT/PARTIAL、仅坏 DOCX 时零可分析源拒绝的回归。由 Implementer 修改产品代码，修订后再次独立审查。

### 本轮验证与门禁

- 直接调用当前源码 `scanCustomerZip`，以 Python `zipfile` 生成普通 stored ZIP/内层 DOCX，实际重算 CRC 和长度；临时样本在 `/private/tmp/pr299-review-repro/`。正常 DOCX → ANALYZABLE；错误 namespace 无注释 → INTEGRATION_NO_ANALYZABLE_SOURCE；注释伪装、重复属性、非法字符引用 → 错误 ANALYZABLE。正常/错误 namespace 的标准 XML parser 读回分别为 `{http://schemas.openxmlformats.org/wordprocessingml/2006/main}document` / `{urn:wrong}document`，注释伪装仍是后者。
- focused 命令：`./node_modules/.bin/vitest run modules/integration-gateway/src/customer-zip/zip-safety.test.ts modules/integration-gateway/src/customer-zip/upload-ticket.test.ts contracts/src/preparation-fixtures.test.ts contracts/src/preparation-intake.test.ts tests/workspace/preparation-transport.test.ts`；**5 files / 97 tests PASS**。现有测试通过不覆盖上述新反例，也不代替 full。
- 当前 GitHub `statusCheckRollup=[]`；对精确 head 查询 workflow run 结果为 `[]`。远端 CI 为 NOT RUN，不沿用 helper head 的旧成功或运行状态，不注册无 run/attempt 可绑定的 waiter。
- PR 与既有正式记录报告产品 SHA `e4b4359` 的本地 full PASS。本轮核对该 SHA 到 reviewed SHA 仅新增正式 Review.md；该事实说明产品代码未再变化，但未将他人记录写成本轮亲自执行的 full。已有明确实现缺陷，本轮未重复运行 full，也不以等待 CI 为由延迟报告 R2。
- 原生 TE/Runner、真实生产 Ceph/OIDC 部署、完整平台浏览器矩阵与独立人工/客户验收仍 NOT RUN；适用人类技术批准和最终 CI 门禁继续保留，应先修复已证实问题再进入最终审核。

本次仅追加正式审查记录，未修改产品实现，未 commit/push/merge。已按用户授权发布 [复审 comment 6189936913](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6189936913)，并通过 GitHub API 回读确认完整正文、reviewed SHA、R1 关闭与 R2 结论。这是普通 PR comment，不是 GitHub 原生 Request changes review。`git diff --check` 与本文件 Prettier check 通过。

## 先前复审记录：#291 完整修订

- 日期：2026-10-15。
- PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)，Draft；Issue：[#291](https://github.com/qzhike/zhiju-business-core/issues/291)，T2。
- Reviewed product SHA：`e4b435979d5b659a9859b8c3a86a80e32a5fc9ce`；由 Reviewer 在最终复核时独立执行 `vibe repo --json` 确认。复核时无未提交产品差异，仅本正式记录尚未跟踪。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。本轮未发现剩余可证实的阻塞实现缺陷；原 R1 所指的“仅有 ticket helper、完整旅程未接线”范围缺口已补齐。新增准入、授权、RLS 与对象托管涉及的适用人类技术审核仍须完成，本结论不授权合并。
- 验证状态：该产品修订的本地 configured `full` 已通过；远端新 head 的 CI 在本记录形成时为 `PENDING`，不得沿用旧 helper head 的 CI。正式记录后续文档提交不包含在上述产品 SHA 中。

### 独立预期与范围

依据最新 #291、原 R1 评论、批准的 [#277 Delta](../../decisions/preparation-entry-bootstrap.md)、IP/EP/IG/UI owning Spec/Test、TE D14 selectors、共享 API/Catalog/persistence 边界建立预期，再核对实际源码、迁移、正负 fixtures 与证据。完整结果应是当前获权 Human 的 NEW/EXISTING 准备创建、一次 ZIP 与说明提交、真实源托管及原请求恢复；缺 TE/Runner 能力可以诚实等待，不能制造 Task、Run、报告或启动事实。

复核覆盖有限 React/BFF/Core routes、显式生产配置与 owning 组装、独立准入与 scoped provisioning、原命令及原绑定恢复、ZIP/DOCX 安全、对象读回、EP source receipts、IG manifest/Receipt/Outbox 与 EP Inbox/handoff、一次 CAS 重传及旧流 fencing。未将 fixtures 的结构有效或受控外部 ports 当作 native TE/Runner 或生产部署成功。

### R1 与本轮发现的复核

| 边界 | 最终产品核对结果 |
| --- | --- |
| R1：完整旅程缺少实现 | IP/EP/IG owning 服务、迁移、公共闭集 contracts 和真实 React/BFF/Core 接线均已交付；生产启用依赖显式配置与实际 publication/enrollment，未配置时安全不可用。受控实际 PostgreSQL 与 built-browser 证据覆盖创建、提交、刷新/重登录及恢复，不再是独立 helper。 |
| 当前权限与恢复 | 原作者、完整 Scope、稳定 target/key/raw payload/hash 由 owning 事实固定；独立 SERVICE authority 与 Human 原 ANALYZE 资格分别检查。UI 分别查询 EP/IG，写入资格失效不再截断仍获权的 custody 读取。另一个 Human、跨 Scope 或身份覆写仍拒绝。 |
| 历史绑定与依赖撤回 | 原 request 与 captured source 保留 immutable payload；模板撤回后返回原 tuple/已提交步骤与 STALE，禁止新 intake。历史读取放宽仅用于封闭读取，仍保留当前 SERVICE exact authority、原 Human/enrollment 与 Scope 检查；source 依赖未知的 UNKNOWN 结果已同步 schema。 |
| 安全失败与一次重传 | 安全、限额、全包损坏或零可分析源失败带不可重传标记；普通中断仍须 stream closed、无 durable object/EP link/manifest 的 owner proof，并通过独立 aggregateVersion/generation CAS。保存原 restart command，重放不续票据期限，不开第三代。 |
| ZIP/DOCX 安全反例 | 已修正注释伪造 MIME、分离关系 Type/Target 和外部 officeDocument 关系被误认作 DOCX 的反例；核验精确 Override 与同一内部关系。deflate 必须完整消费声明压缩段，末尾垃圾不能稀释展开比。普通 DOCX/Markdown 与 unsupported/corrupt 限制路径保留。 |
| 公共闭集与引用 | IG 命名 results/原 command 的类型及 Scope 已收紧；首个 ACCEPTED 需 upload，合法过期 replay 可省略。共享 Registry/Catalog 增加 11 项至 258；旧 frozen 200 与 TE 63 项接受集保留。正负 fixtures 覆盖 weak/wrong refs、额外字段、hash/Scope、状态与第二次重传。 |
| 公司源对象边界 | 使用部署显式 keys 的独立只读 S3 reader，核验实际 bytes/hash 后交由 EP 检查当前 publication、固定来源及唯一 slice；未扩大 intake put/inspect 的窄 key 接受集。协议测试不等同真实 Ceph 验收。 |
| TE 能力与映射 | Task/analysis request 使用 canonical `zhiju.execution.*` 目标；真实 Registry 的两项 selector 未 FULL 注册时，SOURCE 保留且 TE create/request/read 零调用，返回 WAITING_CAPABILITY。回调存在不构成能力已安装。未来 owning 返回须通过注册 schema、目标/Scope/hash/aggregate 与原命令 readback 检查后才持久化；结构 fixtures 不构成真实 TE Receipt。 |
| 完整验证中的资源与共享 fixture | runtime pools 有受信注入并由测试显式回收；仅关闭 idle HTTP 连接，不强杀 active 请求，不放宽 30 秒 hook，不吞清理失败。共享公司源只精确复用实际 published bytes/hash/version/provenance；默认 OIDC subject 独立，实际 Human 解析有断言。目录四表及总数更新没有放宽原 owning/TE 断言。 |

### 精确修订验证证据

- 最终本地 `vibe verify full --json`：原主会话执行单元 `92259`，工具退出码 **0**，最终实际结果为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。Reviewer 独立读取主会话实际工具返回文本的临时导出 `/tmp/pr-299-full-92259-tool-output.txt`，核对退出状态、汇总、migration、清理及最终 JSON；该文件明确保留工具截断声明，不是完整未截断日志。没有重复执行 full，临时文件不作为仓库交付物。
- 该 full 的普通测试 **139 files / 2885 tests PASS**；production browser **5 PASS**；fixture browser **36 PASS**；Catalog/Registry/FULL 均 **258**，frozen **200 PASS**。持久化 **64 files / 735 tests PASS，零 skip**；第二次 migration 无待应用变更，gate passed，临时 PostgreSQL 容器移除。
- 清理证据包含 browser context、Chromium、artifact process、BFF、Core、runtime pools、owning pools、OIDC 和 stack 各阶段正常结束；BFF active requests=0、Core active requests=0，所有 pool.end 完成。Core 关闭回调时尚待 close 事件的两个 idle 连接不被当作未完成的 ZIP 请求。
- 新旅程实际 owning PostgreSQL 与 BFF/Core/生产 SPA browser 用例包含 NEW/EXISTING、响应恢复/真实重登录、ZIP 与说明、能力不可用及中断后的同 intake generation 2。history 用例通过真实组合验证依赖撤回后的原请求/source 历史保留。它们属于受控本地验收；其具体 fixture 边界以 [journey](../../../tests/persistence/preparation-journey.test.ts)、[history](../../../tests/persistence/preparation-history-recovery.test.ts)、[browser](../../../tests/persistence/preparation-built-browser.test.ts) 及相应 owning tests 为准。
- Reviewer 在上述最终产品 SHA 独立执行 focused Vitest：ZIP safety、S3 object store、preparation task port、preparation fixtures、intake contracts、workspace transport，**6 files / 102 tests PASS**。这用于复核具体负例、闭集与 guard，不替代 full。
- 先前 full `2727`、`5320` 为 FAIL；`42009` 暴露 clean build 类型错误后修正；被中止的运行不记 PASS。最终通过仅指 `92259` 对应的冻结产品修订，不能用单独断言通过掩盖 suite/hook 失败。

### 保留门禁与未运行层

真实外部 OIDC Provider、Ceph/RGW、native TE preparation engine、Runner/真实 execution ack、报告和客户/人工验收均为 `NOT RUN`；没有生产发布或部署证据。受控 OIDC provider、本地 object port、SigV4 协议测试、结构 fixtures 与 built-browser 各自只证明其实际覆盖的层。

新远端 head CI 仍须取得精确 SHA 的 required checks；本地 full 与 CI 是独立证据。#291 涉及的新授权/隔离与持久化实现仍须适用人类技术审核。#277 的既有设计批准不被提升为本次实现的生产验收或合并授权。本记录未提交 GitHub 原生 APPROVE/REQUEST_CHANGES review，未 commit、push、merge 或改动产品代码；由原主会话完成已授权的 PR 交付及 CI 等待。

---

<details>
<summary>历史审查：12a1cb2 / REQUEST_CHANGES / 原 R1（完整原文保留，不代表当前结论）</summary>

# PR #299 独立代码审查

- 日期：2026-10-15。
- PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)，Draft。
- Issue：[#291](https://github.com/qzhike/zhiju-business-core/issues/291)，T2。
- Reviewed SHA：`12a1cb243f311a83d99e661e97ce559791005e43`；发布前再次确认远端 head 相同。
- Reviewer outcome：`REQUEST_CHANGES`，针对 #291 整体交付尚未完成。未发现当前票据加密组件内可证实的新增阻塞缺陷。

## 范围与独立预期

读取最新 Issue/PR 与评论、项目配置、HL-Spec 入口及验证基线、IG owning Spec/Test 的 #277 票据/恢复要求、相关 API transport、完整三文件 diff、当前 dispatcher 与调用点。先依据批准规格建立预期，再核对实现：票据绑定 intake、原作者、Enterprise/Project、原 payload hash、ZIP hash/长度及 generation；随机 token 至少 256 bits；固定五分钟，原票据重放不续期；错误绑定、篡改、过期及缺失历史密钥拒绝。授权、持久化及旧流 fencing 必须由 owning 服务另行保证。

完整 Issue 的出口是可使用的 NEW/EXISTING 创建 → ZIP 托管 → 原请求恢复旅程；TE/Runner 不可用可以是诚实的最终状态，但不能因此省略准备创建、来源接纳和生产接线。本次未变更公共 schema/registry，未将局部 TypeScript 类型当作完整公共契约注册证据。

## R1：完整用户旅程尚未接入生产（P1，已声明的 WIP 缺口）

当前 diff 只有 `upload-ticket.ts`、其单元测试和一段 owning Spec 实现边界说明。检索 `apps/`、`modules/`、`packages/` 的源码，codec 仅由自身测试调用。

[dispatcher L115–120](https://github.com/qzhike/zhiju-business-core/blob/12a1cb243f311a83d99e661e97ce559791005e43/apps/api/src/workspace/dispatch.ts#L115) 仍将 preparation 创建/恢复和 ZIP intake 创建/查询列为 `ALLOWLISTED_UNIMPLEMENTED`；[L363–368](https://github.com/qzhike/zhiju-business-core/blob/12a1cb243f311a83d99e661e97ce559791005e43/apps/api/src/workspace/dispatch.ts#L363) 对它们返回 `DEPENDENCY_UNAVAILABLE`。因此合法客户端请求也无法完成 #291 的第一个实际创建动作，更不能完成首次 ZIP 托管或恢复。加密函数通过测试不会改变该路径。

这是 PR 已如实披露的未完成范围，不是本次新增的回归或隐藏缺陷；但按当前 Issue 验收不能 APPROVE 完整交付。请 Implementer 继续交付 Issue 已约定的 IP/EP/IG owning 操作、封闭契约、持久化与权限、真实来源/manifest/outbox/inbox、能力感知 handoff 和 React/BFF/Core 接线，并补齐 owning acceptance 的正负及故障证据。保持 Draft；后续完整 head 需重新独立审查。不能仅把本 PR 标题改为局部组件就视为 #291 已验收。

## 组件核对结果

未发现需要修复的组件级阻塞问题；以下结论只来自当前静态实现与测试检查，不代表独立密码学安全认证或真实上传服务已完成。

| 契约字段或边界 | 当前实现 |
| --- | --- |
| intakeId、creatorId、enterpriseId、projectId | UUIDv7 校验；四字段全部进入固定顺序 AAD |
| submissionPayloadHash、zipBytesSha256 | 64 位小写 hex；全部进入 AAD |
| declaredByteLength、generation | 整数 1–100 MiB、代次 1/2；全部进入 AAD |
| keyId、issuedAt、expiresAt | AAD 绑定；精确五分钟，签发前及到期瞬间拒绝 |
| upload.generation/token/expiresAt | 原代次、32 随机 bytes 的 base64url token、原期限；replay 不修改记录 |
| upload.method/path | 固定 PUT 与 `/api/customer-intakes/<intakeId>/zip` |
| upload.expectedByteLength/expectedZipBytesSha256 | 精确来自已验证 binding；七个公开字段与 owning 闭集一致 |
| 密文及历史密钥 | AES-256-GCM，12-byte nonce、16-byte tag；缺 key 安全失败；显式轮换可读取原记录 |
| 使用边界 | 没有伪造授权、持久化、restart 或流处理成功；Spec 明确仍待集成 |

## 验证与门禁

- [CI run 38689711858 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38689711858) 的 headSha 与 reviewed SHA 一致。读取时 select、checks 成功，persistence 仍 IN_PROGRESS；完整 full/汇总成功尚未取得。这是待完成证据，不记为 CI FAIL，也不单独作为实现缺陷。
- 当前 CI workflow 的 checks 包含普通代码 Gate，persistence 为 full 所选的独立数据库 Gate。没有重复运行本地 full。
- `gh run view ... --job 116272615802 --log` 因整条 run 尚在进行而不可取；宿主最小只读 GitHub 探测成功，不属于认证或网络故障。不把 PR 自报的本地 full/environment 结果当作本轮独立执行证据。
- 独立 focused 单测：`./node_modules/.bin/vitest run modules/integration-gateway/src/customer-zip/upload-ticket.test.ts`，1 file / 26 tests PASS（Vitest 4.1.10）。最初 `pnpm exec vitest run ...` 启动后持续无输出，主动中止（exit 130）；直接调用仓库已安装 Vitest 成功，未改变依赖或配置。既有测试覆盖全部八个绑定替换、token/密文篡改、期限、进程重建、显式 key 轮换和输入边界；这不替代 IG-277-001–006 的 owning integration。
- #291 新用户旅程的 PostgreSQL、公开 HTTP、built-browser、实际 ZIP/source/manifest/recovery 验收尚无交付证据；生产、外部 TE/Runner 和独立人工/客户验收保持 NOT RUN。已有其他功能的 CI 测试不能提升本旅程的状态。
- 完整交付仍须 final-head full 通过、正式审查及适用人类技术批准；本次不推断批准已满足。

## 交付状态

本记录为项目要求的正式审查文档，不属于 reviewed SHA；产品代码未修改，未 commit、push 或 merge。已按用户授权发布 [PR comment 6185763516](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6185763516)，通过 GitHub API 回读确认正文、reviewed SHA 和结论。Reviewer outcome 不等同 GitHub 原生 REQUEST_CHANGES review。本地仅新增本审查记录，尚未提交到 Git；`git diff --check` 通过。

</details>
