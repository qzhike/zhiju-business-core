# Module-Test-MVP01-DocumentDelivery

日期：2026-10-22

状态：`IMPLEMENTED 2026-10-22 / AUTOMATED PARTIAL / MANUAL NOT RUN`。对应 [MVP01 Spec](../module-specs/Module-Spec-MVP01-DocumentDelivery.md)和 [B1 设计](../mvp/b1-design.md)。自动化证据分为：`tests/persistence/mvp-document-delivery.test.ts`（真实隔离 PostgreSQL、文件 store、原包/条目字节、补充批次、恢复与重启读回）、`tests/persistence/mvp-http.test.ts`（真实 Core HTTP、OIDC 签名 token、幂等、上传与下载）、`tests/business/mvp-custody.test.ts`（ZIP/OOXML/XLSX 安全）、`apps/workspace-bff/src/mvp-routes.test.ts`（有限 BFF 路径）与 `apps/workspace-web/src/custody/model.test.ts`（展示模型）。这些证据不包含真实本机初始化、浏览器完整旅程、进程重启或用户内容验收。

## 1. 可观察接受集

| ID | 层级/输入 | 必须观察到的结果 | 当前结果 |
|---|---|---|---|
| B1-01 | Auth/HTTP/Browser：合法 OIDC、错 issuer/sub/aud/peer、停用绑定、伪造 owner/header、重登；epoch=1建批后停机，epoch=2重新启用并重启 | 仅明确实例员工进入；Core 独立校验；逐请求 binding/epoch；无身份 fallback/自动注册，旧 IP 权限不成为新授权；旧epoch的PREPARED/RUNNING尝试不能自动执行/接纳；显式恢复以新Request授权新attempt，旧授权/receipt不改，RECONCILE不授予执行；会话 token 不入浏览器、日志或业务 DB | `PARTIAL AUTOMATED`：真实签名 token、技术头、停用/epoch 拒绝已有 HTTP/持久化证据；浏览器登录、真实 Keycloak 与停机重启未运行 |
| B1-02 | Persistence/HTTP：同 key 同 project/body 重复、同 key 改值/换project但沿用batch target、同 target 换 key；提交响应丢失 | 一个 Project 与固定 receipt；同意图返回原结果；冲突409无新增；原请求可授权回读；数据库未知不回空成功 | `AUTOMATED`：持久化与 HTTP 幂等/冲突/回读通过；响应丢失的浏览器表现未运行 |
| B1-03 | Unit/Persistence/Browser：合法 DOCX/MD/XLSX 同包、目录、两个同名异目录文件 | 原 ZIP/accepted 条目的真实 bytes/sha/长度匹配；所有 entry 保持 ordinal与路径；manifest和计数完整，不以结构接受宣称语义读懂 | `AUTOMATED`（Unit/Persistence）：三格式、目录剔除、路径/ordinal、字节/hash/长度通过；Browser 未运行 |
| B1-04 | Persistence/Browser：首次失败、首次成功、补充批次、同名/同 bytes 新显式批次、同请求 replay | batchNo串行唯一；后续批次保留原件与旧manifest；重放不新增；前批失败仍可见；补充不自动改分析/范围/阶段依据 | `AUTOMATED`（Persistence）：补充批次、连续 batchNo、旧 manifest 不变、replay 通过；Browser 未运行 |
| B1-05 | Safety：穿越/绝对/重复规范路径、symlink、加密、CRC/目录损坏、ZIP bomb、nested累计预算 | 不写任意宿主路径；外包安全失败零业务 source/manifest；预算累加不重置；不提高限制换绿灯；安全有限包逐项说明问题 | `PARTIAL AUTOMATED`：穿越/绝对/反斜杠/重复规范路径/CRC/截断已有单测；symlink、加密、bomb 与 nested 预算未逐一自动化 |
| B1-06 | OOXML：合法 XLSX inline/sharedStrings、空sheet/0/公式；缺workbook/sheet、重复rels、伪namespace、DTD/XXE、活动内容、外链 | 合法字节不改写；不计算公式、不联网；结构坏为CORRUPT，宏/嵌入活动内容UNSUPPORTED，外链READ_LIMITED；无伪造accepted引用；DOCX原防护回归 | `PARTIAL AUTOMATED`：合法 XLSX/DOCX、宏、坏 XLSX、外链已有单测；sharedStrings/空表/公式/重复 rels/XXE 未逐一覆盖 |
| B1-07 | Unit/Browser：XLS/PDF/未知格式、坏UTF-8、全包0 accepted | 不支持/损坏/受限条目不消失；安全包PARTIAL和真实分母；0 accepted明确无可分析资料；转换通过新批次，不替换旧条目 | `PARTIAL AUTOMATED`：XLS/PDF、坏 UTF-8、0 accepted 与真实分母已有证据；Browser 未运行 |
| B1-08 | Concurrency/Persistence：双击、并发建batch、并发上传、重复/迟到generation、跨项目ref | 每项目一个活动批次，连续唯一batchNo；原attempt独占流，重复无覆盖；完整归属组合验证及RLS拒绝跨项目/owner；晚finish不更新新generation | `NOT RUN`：当前只覆盖顺序拒绝与跨 owner 读取，未运行真实并发/迟到 generation |
| B1-09 | Recovery：上传中断、进程尚活但lease超时、退出未join、重启OS锁释放、完整staged但DB未记/首个EXTRACT尚不存在；未上传就改用新文件 | 未证明旧写者终止时UNKNOWN且不重传/放弃；取得锁并inspect后完整原包复用，缺完整包时同sha/length新attempt；原batch不改payload；尚无EXTRACT时RECONCILE→STAGED，再CONTINUE_EXTRACTION原子建首个attempt/当前授权/generation，重复恢复不再分配；安全ABANDON保留历史、释放占用，新内容显式新batch | `PARTIAL AUTOMATED`：已结束失败→RETRY_UPLOAD、ABANDON 与 replay 通过；崩溃间隙/RECONCILE→CONTINUE 未自动化 |
| B1-10 | Persistence/File store：原包durable但首次EXTRACT安排事务失败、条目写后DB失败、manifest提交后响应丢失、提取部分完成、store根丢失/替换/字节坏 | 只有一次manifest接纳；稳定目标inspect恢复；未提交staging不成为source；已接纳历史不覆盖；未知/损坏不初始化空store或自动GC | `PARTIAL AUTOMATED`：字节损坏可见失败、重启后同一 manifest/bytes、无空 store 初始化通过；提交丢失与条目写后 DB 失败未注入 |
| B1-11 | Restart/Browser：初次与补充成功，停启Core/BFF、保留卷重启PostgreSQL，重新登录 | 同project/batch/request/manifest/source/sha可回读；BFF丢session只要求重登；不丢业务、不重新生成意图；旧环境数据与运行资源不变 | `PARTIAL AUTOMATED`：服务/连接重建后回读通过；真实进程停启、PostgreSQL 卷重启与浏览器重登未运行 |
| B1-12 | Read/Privacy：完整游标链、跨owner/project/manifest游标、归属错source、坏checksum、下载断流/恶意文件名 | 分页高水位及真实总数；cursor无权拒绝；只给精确已接纳字节、attachment/no-store/nosniff；不泄漏locator/token；断流不标送达/保存成功 | `PARTIAL AUTOMATED`：跨 owner cursor 拒绝、精确字节与附件/摘要响应头通过；断流与恶意文件名未逐一运行 |
| B1-13 | Composition/Init：缺配置、旧DB/store指向、重复初始化、instance/realm/ports冲突、新旧模式混挂 | 初始化拒绝混用旧实例；MVP-only路由/数据库/文件根；重复init验证既有身份不重建；新模式无fixture/旧业务链依赖；停止只处理本实例 | `NOT RUN`：工具已实现但未对本机实例执行 |
| B1-14 | Manual：正式来源下真实混合格式ZIP、补充、受限条目、原请求恢复、重启后回读 | 用户完成完整B1结果并理解资料已接收但分析未接入；记录精确修订/匿名输入及用户反馈；公共自动化和私有内容分别取证 | `NOT RUN` |

## 2. 验证安排

- 实现文档与代码：配置化目标为 `vibe verify full --json`；本轮已先运行 `environment` 与多个 focused 持久化/HTTP/单元检查。
- 真实本机初始化、浏览器完整旅程、进程停启、PostgreSQL 卷重启与人工内容验收仍未运行；不得由隔离自动化推定通过。
- 受控 Browser 使用真实 BFF/Core/PostgreSQL/文件 store 和测试 OIDC，不以 fixture 通过冒充 B1。自动化数据库/文件根不能指向用户现有环境 B。
- 正式模板来源不替换；安全负例用可追溯派生或公开无敏感结构样本。当前客户 DOCX 选择不覆盖真实 MD/XLSX 内容；补齐合法样本后才记录对应人工结果。
- 执行证据进入对应 Issue/PR，注明完整代码 SHA、配置/输入匿名快照、目标与结果、剩余限制；不在此追加逐轮运行日志。私有内容、路径、截图、凭据不进入公开证据。

独立实现审查和必要人类技术审查覆盖最终修订；有 PR 时关闭前保留 `.vibe/reviews/pr-<number>/Review.md`。本设计不授权真实环境初始化或迁移。
