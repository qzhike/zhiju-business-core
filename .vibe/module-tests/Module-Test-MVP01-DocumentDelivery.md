# Module-Test-MVP01-DocumentDelivery

日期：2026-10-24

状态：`IMPLEMENTED 2026-10-22 / AUTOMATED PARTIAL / MANUAL NOT RUN`。对应 [MVP01 Spec](../module-specs/Module-Spec-MVP01-DocumentDelivery.md)和 [B1 设计](../mvp/b1-design.md)。自动化证据分为：`tests/persistence/mvp-document-delivery.test.ts`（真实隔离 PostgreSQL、文件 store、原包/条目字节、补充批次、恢复与重启读回、R1 旧 epoch/新会话反例、R3 已终止不完整上传收敛、并发 claim/迟到 generation、首次 EXTRACT 安排前崩溃间隙、跨 epoch 旧 writer 由当前身份 RECONCILE→STAGED→新 epoch CONTINUE、条目行写失败回滚后 staging 不可读且旧清单/字节保留、清单事务已提交但成功响应丢失后重启不重复接纳、独立 PostgreSQL 容器停启后重连读回、授权变更后重启不续跑、真实当前 epoch 的旧 attempt 拒绝与显式 RETRY 成功、零字节来源、未封存原件不可读）、`tests/persistence/mvp-http.test.ts`（真实 Core HTTP、OIDC 签名 token、幂等、上传与下载、R5 分页边界、R2 public BatchView）、`tests/persistence/mvp-built-browser.test.ts`（构建后的 Web → 真实 BFF/Core/PostgreSQL/文件 store 登录、建项目、混合格式上传、限制核对、空来源下载、原包下载、补充批次、提交响应丢失后的同键恢复与刷新后双批次读回）、`tests/business/mvp-custody.test.ts`（ZIP/OOXML/XLSX 安全）、`apps/workspace-bff/src/mvp-routes.test.ts`（有限 BFF 路径）与 `apps/workspace-web/src/custody/model.test.ts`（展示模型）。另外，`tests/workspace/mvp-environment.test.ts` 覆盖生成配置可被 BFF 接纳、重复初始化/秘密保留、异实例/可发布或跟踪目录/端口/资源身份冲突；独立本机 B1 已执行真实 Keycloak 登录、合成三格式初次/补充/原请求恢复、保留卷/文件的 stop→init→start→重登读回，并核对 A/B 资源身份未改变。正式来源人工试走与用户内容验收仍未运行。

2026-10-31 当前持久化范围更新：保留原四个 MVP 入口全部场景；从旧 Workspace 迁入 `mvp-controlled-keycloak.test.ts`，验证真实 Keycloak → BFF → MVP Core → `DocumentDelivery` 的登录、issuer/audience 拒绝、回调拒绝、刷新和签名 key 轮换，以及写操作的 CSRF/Origin 拒绝。audience 负例除真实无 mapper 客户端外，必须以合法 issuer/sub/azp 的同源签名 token 先证明正控制可读，再仅移除或改错 aud，确认拒绝且无 owning read。使用独立单员工绑定和项目，不借旧 Enterprise、Grant、Projection 或迁移历史。上述迁移场景以本修订的实际执行证据为准，历史旧 Workspace PASS 不自动升级为新 MVP PASS。五文件叶级用例由独立清单核对；具体门禁见 [验证基准](../high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由)。

## 1. 可观察接受集

| ID | 层级/输入 | 必须观察到的结果 | 当前结果 |
|---|---|---|---|
| B1-01 | Auth/HTTP/Browser：合法 OIDC、错 issuer/sub/aud/peer、停用绑定、伪造 owner/header、重登；epoch=1建批后停机，epoch=2重新启用并重启 | 仅明确实例员工进入；Core 独立校验；逐请求 binding/epoch；无身份 fallback/自动注册，旧 IP 权限不成为新授权；旧epoch的PREPARED/RUNNING尝试不能自动执行/接纳；显式恢复以新Request授权新attempt，旧授权/receipt不改，RECONCILE不授予执行；会话 token 不入浏览器、日志或业务 DB | `PARTIAL AUTOMATED`：真实签名 token、技术头、真实当前 epoch 下旧 attempt 被拒且显式 RETRY 成功、跨 epoch 旧 writer 的观察性 RECONCILE 与执行授权分离、构建浏览器 OIDC 登录已有证据；隔离 B1 的真实 Keycloak 登录和整实例停启重登已执行；受控 Keycloak 正反例已迁入当前 MVP 测试入口，结果以本修订的 full 为准；全部认证负例组合仍不由正向旅程推定 |
| B1-02 | Persistence/HTTP：同 key 同 project/body 重复、同 key 改值/换project但沿用batch target、同 target 换 key；提交响应丢失 | 一个 Project 与固定 receipt；同意图返回原结果；冲突409无新增；原请求可授权回读；数据库未知不回空成功 | `AUTOMATED`：持久化与 HTTP 幂等/冲突/回读通过；构建浏览器在服务端已提交但成功响应丢失后保留原请求标记，并按同一键恢复原批次 |
| B1-03 | Unit/Persistence/Browser：合法 DOCX/MD/XLSX 同包、目录、两个同名异目录文件 | 原 ZIP/accepted 条目的真实 bytes/sha/长度匹配；所有 entry 保持 ordinal与路径；manifest和计数完整，不以结构接受宣称语义读懂 | `AUTOMATED`（Unit/Persistence/Browser）：三格式、目录剔除、路径/ordinal、字节/hash/长度与内置浏览器读回通过 |
| B1-04 | Persistence/Browser：首次失败、首次成功、补充批次、同名/同 bytes 新显式批次、同请求 replay | batchNo串行唯一；后续批次保留原件与旧manifest；重放不新增；前批失败仍可见；补充不自动改分析/范围/阶段依据 | `AUTOMATED`（Persistence/Browser）：补充批次、连续 batchNo、旧 manifest 不变、replay 通过；构建浏览器完成第 2 批补充并在刷新后分别读回两批 |
| B1-05 | Safety：穿越/绝对/重复规范路径、symlink、加密、CRC/目录损坏、ZIP bomb、按 policy 的外层/Office预算 | 不写任意宿主路径；外包安全失败零业务 source/manifest；预算按已批准 policy 累加不重置；不临时提高限制换绿灯；安全有限包逐项说明问题 | `PARTIAL AUTOMATED`：穿越/绝对/反斜杠/重复规范路径/CRC/截断已有单测；新增 symlink、加密标志、真实高压缩比 deflate 及跨嵌套 OOXML 累计条目预算反例已执行；不据此声称达到所有容量/时间/内存边界 |
| B1-06 | OOXML：合法 XLSX inline/sharedStrings、空sheet/0/公式；缺workbook/sheet、重复rels、伪namespace、DTD/XXE、活动内容、外链 | 合法字节不改写；不计算公式、不联网；结构坏为CORRUPT，宏/嵌入活动内容UNSUPPORTED，外链READ_LIMITED；无伪造accepted引用；DOCX原防护回归 | `PARTIAL AUTOMATED`：合法 XLSX/DOCX、宏、坏 XLSX、外链已有单测；新增 sharedStrings/inlineStr/空 sheet/零值/公式原字节保留、缺 workbook/sheet、重复 rels ID、伪 namespace、DTD/XXE 拒绝均已执行；独立审查发现并修复被引用 styles/sharedStrings 非默认路径漏检，新增默认/非默认路径合法保留与缺 part、DTD、伪根/namespace、错误 media、逃逸及重复关系反例，并覆盖 Default ContentType 和外链保持 READ_LIMITED |
| B1-07 | Unit/Browser：XLS/PDF/未知格式、坏UTF-8、全包0 accepted | 不支持/损坏/受限条目不消失；安全包PARTIAL和真实分母；0 accepted明确无可分析资料；转换通过新批次，不替换旧条目 | `PARTIAL AUTOMATED`：XLS/PDF、坏 UTF-8、0 accepted 与真实分母已有证据；构建浏览器与本机合成包的受限条目展示已运行；隔离 B1 的 0 accepted 专项浏览器检查确认两项受限条目不消失、无条目下载入口、明确无可分析来源且原包字节可回读 |
| B1-08 | Concurrency/Persistence：双击、并发建batch、并发上传、重复/迟到generation、跨项目ref | 每项目一个活动批次，连续唯一batchNo；原attempt独占流，重复无覆盖；完整归属组合验证及RLS拒绝跨项目/owner；晚finish不更新新generation | `PARTIAL AUTOMATED`：并发 claim 只有一个成功、迟到旧 generation 完成被拒绝、跨 owner 读取拒绝已运行；隔离 B1 实际双击创建/上传仅发出一次对应请求并各生成一个项目/批次；本机锁回归覆盖同进程不同 fd、真实 SIGKILL 后多个进程竞争及 stale socket 恢复交错，确认同时最多一个持有者；完整并发上传流矩阵仍未运行 |
| B1-09 | Recovery：上传中断、进程尚活但lease超时、退出未join、重启OS锁释放、完整staging尚未publish、完整原包但DB未记/首个EXTRACT尚不存在；未上传就改用新文件 | 未证明旧写者终止时UNKNOWN且不重传/放弃；取得锁并inspect后完整原包复用，缺完整包时同sha/length新attempt；原batch不改payload；尚无EXTRACT时RECONCILE→STAGED，再CONTINUE_EXTRACTION原子建首个attempt/当前授权/generation，重复恢复不再分配；安全ABANDON保留历史、释放占用，新内容显式新batch | `PARTIAL AUTOMATED`：已结束失败→RETRY_UPLOAD、ABANDON、replay、已终止不完整上传→FAILED/RETRY、原包 durable 但首次 EXTRACT 未安排→RECONCILE→STAGED→CONTINUE 已运行；同一 durable gap 在 epoch 变更并重开服务后，由真实当前身份 RECONCILE→STAGED，再以新 epoch CONTINUE 建首个 EXTRACT 已运行；锁层真实子进程 SIGKILL 已覆盖内核释放及并发恢复；上传中真实 Core SIGKILL 的完整业务旅程仍未运行。真实 PG 回归确认活跃上传时 ABANDON 被拒绝且原状态/请求/占用不变，旧 UPLOAD/EXTRACT 仍持锁时恢复拒绝，释放后相同合法意图可继续；完整 staging 尚未 publish 的窗口已覆盖：持锁不恢复、结束后固定原目标与同 attempt 字节复用、缺失/截断保持明确重试，正常及跨 epoch 的 RECONCILE 不创建 EXTRACT 且旧授权不改 |
| B1-10 | Persistence/File store：原包durable但首次EXTRACT安排事务失败、条目写后DB失败、manifest提交后响应丢失、提取部分完成、store根丢失/替换/字节坏 | 只有一次manifest接纳；稳定目标inspect恢复；未提交staging不成为source；已接纳历史不覆盖；未知/损坏不初始化空store或自动GC | `PARTIAL AUTOMATED`：字节损坏可见失败、重启后同一 manifest/bytes、未封存原件不可读、首次 EXTRACT 安排前持久原包恢复通过；条目行写失败注入后 manifest/条目回滚、staging 不可读、旧批次不变，显式 CONTINUE 后只接纳一次；清单事务已提交但成功响应丢失后服务/数据库重开仍返回同一 manifest，重复启动不新增接纳 |
| B1-11 | Restart/Browser：初次与补充成功，停启Core/BFF、保留卷重启PostgreSQL，重新登录 | 同project/batch/request/manifest/source/sha可回读；BFF丢session只要求重登；不丢业务、不重新生成意图；旧环境数据与运行资源不变 | `PARTIAL AUTOMATED`：独立 PostgreSQL 容器 stop/start（端口重映射）后连接池/服务重建并读回同一 manifest/bytes；构建 Core 进程停启后浏览器刷新读回两批；真实本机整实例 stop/init/start 后 Keycloak 重登、三批同身份和原包字节读回已运行；BFF 独立停启后的会话失效/重登由构建浏览器回归覆盖，最终结果绑定当前候选验证 |
| B1-12 | Read/Privacy：完整游标链、跨owner/project/manifest游标、归属错source、坏checksum、下载断流/恶意文件名 | 分页高水位及真实总数；cursor无权拒绝；只给精确已接纳字节、attachment/no-store/nosniff；不泄漏locator/token；断流不标送达/保存成功 | `PARTIAL AUTOMATED`：跨 owner cursor 拒绝、精确字节与附件/摘要响应头、entries 1..100 边界、零字节来源下载通过；新增同 owner 跨项目批次分页、分页高水位及跨批次 attempt cursor 拒绝已运行；隔离 B1 的带引号/分号/Unicode 文件名下载保持精确字节与 attachment/no-store/nosniff，响应头无换行；断流、CRLF 等其余恶意文件名未逐一运行 |
| B1-13 | Composition/Init：缺配置、旧DB/store指向、重复初始化、instance/realm/ports冲突、新旧模式混挂 | 初始化拒绝混用旧实例；MVP-only路由/数据库/文件根；重复init验证既有身份不重建；新模式无fixture/旧业务链依赖；停止只处理本实例 | `PARTIAL AUTOMATED / LOCAL VERIFIED`：专用实例实际 init/start/status/stop 与停止后重复 init、installation/密钥保留已运行；A/B 容器/进程身份前后相同。配置与资源冲突负例有聚焦测试；Core HTTP 回归覆盖同实例重复启动及父目录别名绕过拒绝、正常关闭后重开，以及数据库启动失败后的锁释放；未执行所有部分安装故障/崩溃点矩阵 |
| B1-14 | Manual：正式来源下真实混合格式ZIP、补充、受限条目、原请求恢复、重启后回读 | 用户完成完整B1结果并理解资料已接收但分析未接入；记录精确修订/匿名输入及用户反馈；公共自动化和私有内容分别取证 | `NOT RUN`：用户选择沿用 C01–C07 DOCX，私有初次/补充 ZIP 已准备但未上传；真实 MD/XLSX 待补，人工操作和反馈待完成 |

## 2. 验证安排

以下新增范围已在本地实现。自动化使用独立 PostgreSQL/文件根及合成输入；具体执行结果绑定交付候选，不能沿用 B1 历史记录，也不代表现有实例已升级或真实输入已验收。

| ID | 场景 | 预期 | 状态 |
|---|---|---|---|
| NA-01 | 正常文档与任意目录下的 RAR/ZIP/7z 等压缩文件混合，首次与补充批次 | 整批 REJECTED；明确嵌套原因及完整路径；零 ACCEPTED_ENTRY、零 manifest；项目可新建修正批次 | `AUTOMATED`：初次/补充拒绝、零来源/清单、释放占用及修正新批次由持久化与 HTTP 用例覆盖 |
| NA-02 | 扩展名大小写、常见签名改名、分卷、名称中间含 `.rar`、普通目录；正常 MD 分别搭配无 OOXML 结构的 ZIP 改名 DOCX/XLSX、正常 OOXML、具有 OOXML 容器结构但内部损坏或含活动内容/外链的文档 | 真正内层压缩文件不能通过改名绕过；无 OOXML 结构的改名 ZIP 必须使整批 REJECTED / NESTED_ARCHIVE_NOT_ALLOWED，不能形成 PARTIAL；普通目录和正常 OOXML 不误拒；真实 OOXML 的内部损坏、活动内容、外链仍分别沿原 CORRUPT / UNSUPPORTED / READ_LIMITED 规则，累计预算检查保留 | `AUTOMATED`：scanner 扩展名/签名/改名 Office/普通目录及既有 OOXML 安全回归；组合字符原始路径 240-byte 保留、241/304-byte 安全拒绝并释放活动占用；不声称识别任意私有压缩格式 |
| NA-03 | HTTP 绕过 UI 直接上传、恶意文件名、另一 owner/project 查询拒绝详情 | 服务端独立拒绝；路径作为文本；无越权路径/内容泄漏；被拒原包不能作为业务 SourceRef 下载 | `AUTOMATED`：直接 HTTP、跨 owner/project 拒绝及隔离原包不可下载；构建浏览器将恶意文件名按文本展示 |
| NA-04 | 拒绝响应丢失、重复请求、刷新和服务重启、拒绝提交事务失败 | 同键不重复创建/提取；拒绝路径及状态一致读回；没有部分提交的业务来源；故障按原恢复边界保留 | `PARTIAL AUTOMATED`：原创建回执重放、刷新/服务重启、拒绝事务注入失败及恢复通过；嵌套拒绝响应丢失的独立断网注入未运行 |
| NA-05 | `@1` 封存/终态历史和未完成/活跃/UNKNOWN 尝试升级到新代码 | 新批次使用 `@2`；旧历史不改写；旧未完成不自动续跑，核对写者结束后显式放弃并新建；不偷锁、不清除活动写者 | `PARTIAL AUTOMATED`：五种旧未完成状态、活跃写者锁、RECONCILE→FAILED→ABANDON、新 @2 与旧放弃历史不变；真实既有实例迁移未执行 |
| NA-06 | 用户重新整理的无内层压缩文件 ZIP、正常文档混合包、已有来源与补充批次 | 修正后新批次正常接纳，原拒绝记录保留；文档内容及普通目录可追溯；新输入摘要/清单独立固定 | `PARTIAL AUTOMATED`：合成 MD/DOCX 整理包新批次接纳、旧拒绝及既有清单保留；用户整理后的真实全量包及摘要/清单验收 `NOT RUN` |

- 实现文档与代码：配置化目标为 `vibe verify full --json`；本轮已先运行 `environment` 与多个 focused 持久化/HTTP/单元检查。
- 隔离 B1 本机初始化、真实登录、三格式合成资料浏览器旅程、整实例停启和 PostgreSQL 持久卷读回已执行；它们证明运行链与托管字节，不替代正式来源人工内容验收。
- 受控 Browser 使用真实 BFF/Core/PostgreSQL/文件 store 和测试 OIDC，不以 fixture 通过冒充 B1。自动化数据库/文件根不能指向用户现有环境 B。
- 正式模板来源不替换；安全负例用可追溯派生或公开无敏感结构样本。当前客户 DOCX 选择不覆盖真实 MD/XLSX 内容；补齐合法样本后才记录对应人工结果。
- 执行证据进入对应 Issue/PR，注明完整代码 SHA、配置/输入匿名快照、目标与结果、剩余限制；不在此追加逐轮运行日志。私有内容、路径、截图、凭据不进入公开证据。

独立实现审查和必要人类技术审查覆盖最终修订；有 PR 时关闭前保留 `.vibe/reviews/pr-<number>/Review.md`。设计批准本身不授权真实环境初始化或迁移；执行按具体实例授权，不能扩展到旧 A/B。

## @3 资源预算与超限说明（已本地实现，证据绑定验证候选）

| ID | 场景 | 断言 |
| --- | --- | --- |
| ZB-01 | 外层 1000/1001、Office 单份 1000/1001、累计 20000/20001 | 等值允许、越界整包拒绝；Office 与外层分开，跨文档/失败不重置 |
| ZB-02 | 超过旧合并上限的正常 DOCX/XLSX 组合 | 新预算内完成扫描，格式与内容检查保留 |
| ZB-03 | 字节、倍率、内存、耗时及 XML 各超限出口 | 有界闭合详情，正确计量依据、数值、上限；预算保护不变 |
| ZB-04 | 伪造目录声明 1001 而实际仅 1 条、伪造展开/倍率 | 可提前拒绝；页面明确目录声明，不冒充完整读取；无未验证路径 |
| ZB-05 | 拒绝事务、回滚、隔离、重启与同请求查询 | 状态/详情/占用原子提交；零业务来源/manifest；重启结果不变 |
| ZB-06 | V0003 fresh/旧库升级/no-op、旧 @1/@2 历史和活动写者 | 旧迁移/历史不改，活动写者证明与显式放弃不绕过，新批次使用 @3 |
| ZB-07 | 生产 Web 中文提示、历史无详情、恶意路径、窄屏 | 服务端事实驱动，未知/非法详情拒绝，文本安全，无布局溢出 |
| ZB-08 | 两个真实原包本机只读扫描 | 记录新策略实际结果与逐项限制，不自动重传、不冒充持久化/人工内容验收 |

独立关键用例清单保留原有名称与接受集，新增五项：旧 @1/@2 拒绝升级、新 @3 超限持久读回、新超限事务回滚、旧 @2 活动批次恢复边界、直接 HTTP 超限与原回执重放。`tools/persistence/critical-cases.json` 与上述用例共同审查；不放宽缺失、跳过或未登记用例的门禁。

实现验证通过 `full`（含持久化）；本节场景描述不等于已执行证据。

## @4 接收兼容性验收（已批准实现）

唯一设计依据为 [SD-IC-01–04](../decisions/mvp-document-intake-compatibility.md)，以下场景由 `mvp-intake-compatibility.test.ts`、`mvp-document-delivery.test.ts`、`mvp-built-browser.test.ts`、`custody-intake.spec.ts` 及展示模型测试共同覆盖；IC-06 使用 Git 忽略的受控样本只读复测。执行结果绑定具体候选随交付提供，不继承旧 @3 的通过结论。

| ID | 覆盖与成功条件 |
| --- | --- |
| IC-01 | 合成 method 8 四组压缩选项覆盖外层/DOCX/XLSX、descriptor/UTF-8 组合；method 0 误用、未知方法/位、加密、header 不一致、CRC/路径/预算反例仍拒绝，原件 hash 不变 |
| IC-02 | AppleDouble/DS_Store 名称和签名共同匹配才归附属项；每项 ordinal/摘要/计数保留，无 SourceRef；普通隐藏文件、伪装及嵌套压缩不得绕过 |
| IC-03 | DOCX 模板 settings 的完整 ContentType/主关系/namespace/唯一关系/直接子元素精确 id 匹配；Strict/Transitional 和不同前缀支持；缺失/重复/DTD/错引用及 namespace 拒绝，其他外链/宏/嵌入/XLSX 保持受限（包括 `.rels` / `.RELS` / 混合大小写扩展名的页眉关系），零目标网络/文件访问 |
| IC-04 | 真实隔离数据库原子保存接收说明与来源，分页/下载/hash/归属与重启后事实一致；V4 fresh/升级/no-op，V1–V3 不改；旧 @1–@3 历史与活动尝试恢复不升级，@3/@4 超限与 @2–@4 嵌套拒绝约束一致 |
| IC-05 | 生产构建桌面/320px 文件行完整显示已接收说明、附属条目和真正限制，中文下一步与技术码并存；无漏项或错误总数，安全文本、分页/刷新/来源和分析不可用状态保持 |
| IC-06 | 隔离只读扫描真实原包，摘要前后相同；逐项变化符合规则，嵌入对象等残余问题不隐藏；扫描器证据不冒充真实上传、正文读取、Runner 或人工内容验收 |

配置化出口为 `vibe verify full --json`，保留独立关键持久化用例登记与既有接受集，新增 @4 说明/来源持久化及旧 @3 迁移恢复反例。实际实例部署和客户重新上传另行授权；本节不记录尚未完成的人工验收为通过。


## 已接收资料只读内容核对（2026-11-04）

验收矩阵为[设计 SP-01–07](../decisions/mvp-source-content-preview.md#5-可验证出口)，实现配置目标为 full。对应：SP-01 合成 DOCX/Markdown 内容与换行；SP-02 HTTP/真实持久来源的 owner/project/batch/manifest/source 与期间失权；SP-03 支持集、模板/图片/空内容及四类文本修订限制；SP-04 全部辅助 XML 与输出 schema/XSS/外部资源；SP-05 调用前输出放大、执行期文件/内存/管道/临时配额、超时取消/并发/依赖漂移；SP-06 built-browser 1440/320、返回分页、刷新重登/迟到响应及原件不变；SP-07 真实 90 来源的只读覆盖记录。配置化自动化与实际私有来源、人工内容验收分别留证，不把未执行项写成 PASS。合成固定 reader 快照仅作测试 fixture，不成为生产替代读取器。


## 整批资料读取检查增量（2026-11-04）

实施与结果按 [BR-01–06](../decisions/mvp-batch-read-check.md#5-可验证出口)。合成自动化由 `mvp-read-checks.test.ts`、`mvp-source-preview.test.ts`、`mvp-built-browser.test.ts` 及相应 UI 用例覆盖；当前候选的完整验证与审查证据在交付时绑定，真实客户整包与人工内容验收保持 NOT RUN。必须覆盖：混合/零accepted清单计数守恒、真实固定reader输出与原说明；当前owner/epoch/manifest隔离；同键重放异载荷及跨请求并发；数据库结果/版本原子提交和终态不可变；有签名的旧版本分页409与筛选/容量作用域拒绝；忙碌共享槽、总时限（含 claim/next/commit 的真实数据库锁等待和 COMMIT 前取消回滚）、依赖漂移、撤权、原件损坏；提交失联读回、RUNNING→UNKNOWN→再次启动收敛、进程树继承锁/fencing、保留卷重启与新任务保留旧结果。正文不能进入结果表、日志或普通API。真实PostgreSQL与built-browser不能由mock替代；全量真实内容人工验收单列。
