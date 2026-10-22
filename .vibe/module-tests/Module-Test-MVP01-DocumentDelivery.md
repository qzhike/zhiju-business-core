# Module-Test-MVP01-DocumentDelivery

日期：2026-10-22

状态：`B1 DESIGN SCENARIOS / NOT RUN`。对应 [MVP01 Spec](../module-specs/Module-Spec-MVP01-DocumentDelivery.md)和 [B1 设计](../mvp/b1-design.md)；场景存在、文档检查或设计 review 均不等于实现通过。

## 1. 可观察接受集

| ID | 层级/输入 | 必须观察到的结果 | 当前结果 |
|---|---|---|---|
| B1-01 | Auth/HTTP/Browser：合法 OIDC、错 issuer/sub/aud/peer、停用绑定、伪造 owner/header、重登；epoch=1建批后停机，epoch=2重新启用并重启 | 仅明确实例员工进入；Core 独立校验；逐请求 binding/epoch；无身份 fallback/自动注册，旧 IP 权限不成为新授权；旧epoch的PREPARED/RUNNING尝试不能自动执行/接纳；显式恢复以新Request授权新attempt，旧授权/receipt不改，RECONCILE不授予执行；会话 token 不入浏览器、日志或业务 DB | NOT RUN |
| B1-02 | Persistence/HTTP：同 key 同 project/body 重复、同 key 改值/换project但沿用batch target、同 target 换 key；提交响应丢失 | 一个 Project 与固定 receipt；同意图返回原结果；冲突409无新增；原请求可授权回读；数据库未知不回空成功 | NOT RUN |
| B1-03 | Unit/Persistence/Browser：合法 DOCX/MD/XLSX 同包、目录、两个同名异目录文件 | 原 ZIP/accepted 条目的真实 bytes/sha/长度匹配；所有 entry 保持 ordinal与路径；manifest和计数完整，不以结构接受宣称语义读懂 | NOT RUN |
| B1-04 | Persistence/Browser：首次失败、首次成功、补充批次、同名/同 bytes 新显式批次、同请求 replay | batchNo串行唯一；后续批次保留原件与旧manifest；重放不新增；前批失败仍可见；补充不自动改分析/范围/阶段依据 | NOT RUN |
| B1-05 | Safety：穿越/绝对/重复规范路径、symlink、加密、CRC/目录损坏、ZIP bomb、nested累计预算 | 不写任意宿主路径；外包安全失败零业务 source/manifest；预算累加不重置；不提高限制换绿灯；安全有限包逐项说明问题 | NOT RUN |
| B1-06 | OOXML：合法 XLSX inline/sharedStrings、空sheet/0/公式；缺workbook/sheet、重复rels、伪namespace、DTD/XXE、活动内容、外链 | 合法字节不改写；不计算公式、不联网；结构坏为CORRUPT，宏/嵌入活动内容UNSUPPORTED，外链READ_LIMITED；无伪造accepted引用；DOCX原防护回归 | NOT RUN |
| B1-07 | Unit/Browser：XLS/PDF/未知格式、坏UTF-8、全包0 accepted | 不支持/损坏/受限条目不消失；安全包PARTIAL和真实分母；0 accepted明确无可分析资料；转换通过新批次，不替换旧条目 | NOT RUN |
| B1-08 | Concurrency/Persistence：双击、并发建batch、并发上传、重复/迟到generation、跨项目ref | 每项目一个活动批次，连续唯一batchNo；原attempt独占流，重复无覆盖；完整归属组合验证及RLS拒绝跨项目/owner；晚finish不更新新generation | NOT RUN |
| B1-09 | Recovery：上传中断、进程尚活但lease超时、退出未join、重启OS锁释放、完整staged但DB未记/首个EXTRACT尚不存在；未上传就改用新文件 | 未证明旧写者终止时UNKNOWN且不重传/放弃；取得锁并inspect后完整原包复用，缺完整包时同sha/length新attempt；原batch不改payload；尚无EXTRACT时RECONCILE→STAGED，再CONTINUE_EXTRACTION原子建首个attempt/当前授权/generation，重复恢复不再分配；安全ABANDON保留历史、释放占用，新内容显式新batch | NOT RUN |
| B1-10 | Persistence/File store：原包durable但首次EXTRACT安排事务失败、条目写后DB失败、manifest提交后响应丢失、提取部分完成、store根丢失/替换/字节坏 | 只有一次manifest接纳；稳定目标inspect恢复；未提交staging不成为source；已接纳历史不覆盖；未知/损坏不初始化空store或自动GC | NOT RUN |
| B1-11 | Restart/Browser：初次与补充成功，停启Core/BFF、保留卷重启PostgreSQL，重新登录 | 同project/batch/request/manifest/source/sha可回读；BFF丢session只要求重登；不丢业务、不重新生成意图；旧环境数据与运行资源不变 | NOT RUN |
| B1-12 | Read/Privacy：完整游标链、跨owner/project/manifest游标、归属错source、坏checksum、下载断流/恶意文件名 | 分页高水位及真实总数；cursor无权拒绝；只给精确已接纳字节、attachment/no-store/nosniff；不泄漏locator/token；断流不标送达/保存成功 | NOT RUN |
| B1-13 | Composition/Init：缺配置、旧DB/store指向、重复初始化、instance/realm/ports冲突、新旧模式混挂 | 初始化拒绝混用旧实例；MVP-only路由/数据库/文件根；重复init验证既有身份不重建；新模式无fixture/旧业务链依赖；停止只处理本实例 | NOT RUN |
| B1-14 | Manual：正式来源下真实混合格式ZIP、补充、受限条目、原请求恢复、重启后回读 | 用户完成完整B1结果并理解资料已接收但分析未接入；记录精确修订/匿名输入及用户反馈；公共自动化和私有内容分别取证 | NOT RUN |

## 2. 验证安排

- 设计文档：`vibe verify docs --json`，配合独立语义审查；不运行或宣称业务验证。
- 实施：`vibe verify full --json`；新/实质变化容器环境或相关失败后先 `vibe verify environment --json`，有效结果可复用。此切片涉及真实接口、授权、DB/文件事务，不能使用低风险 UI 路由。
- 先做身份、幂等、批次/manifest状态和OOXML失败的 focused 检查，再走配置full。新增 schema 的空库迁移/重跑/历史不变、RLS、真实字节与重启恢复须纳入测试；现有七模块回归保留，不为新MVP删测试。
- 受控Browser使用真实BFF/Core/PostgreSQL/文件store和测试OIDC，不以fixture通过冒充B1。自动化数据库/文件根不能指向用户现有环境B。
- 正式模板来源不替换；安全负例用可追溯派生或公开无敏感结构样本。当前客户DOCX选择不覆盖真实MD/XLSX内容；补齐合法样本后才记录对应人工结果。
- 执行证据进入对应Issue/PR，注明完整代码SHA、配置/输入匿名快照、目标与结果、剩余限制；不在此追加逐轮运行日志。私有内容、路径、截图、凭据不进入公开证据。

独立实现审查和必要人类技术审查覆盖最终修订；有PR时关闭前保留 `.vibe/reviews/pr-<number>/Review.md`。本设计不授权真实环境初始化或迁移。
