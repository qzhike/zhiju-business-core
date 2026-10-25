# PR #319 批次累计语义审查（2026-10-24）

HUMAN_REVIEW_REQUIRED — B1-14 的正式来源试走与用户内容反馈仍须由人完成。累计语义审查已完成，未发现需要重新打开的阻塞代码问题；**当前不作最终 APPROVE**。本记录尚未纳入批次，当前批次的 full/main-admission 完成证据及纳入正式 Review 后新候选的精确验证均待确认。此人类边界来自尚未完成的人工接受条件，不是仅因缺少普通合并授权而产生的技术审查要求；已批准的 SD-B1-01–07 不重复索要批准。子 PR 的批准、成功 CI 和合并不代表完整 B1 或 main 交付。

## 阶段、候选与审查依据

- 对象：[PR #319](https://github.com/qzhike/zhiju-business-core/pull/319)，关联 [Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)。
- 阶段：`batch/mvp-b1-document-delivery → main` 的 B1 批次收口审查，累计范围包括实现子 PR #312 与修复/验收准备子 PR #318。
- 被审 main 基线：`fb8da30ad0cedfd3311eb3bee0b28a097ee7d120`。
- 被审批次 head：`225c2af2bd8b2fd099ae7933fcddb0321ec627c9`，为 #318 的实际 merge commit；双亲分别为 `89bbd41ee68257eae85ed4305f1d58519229fbef` 与 `fd24e84b4fc81c667f4d47e3a75314a279aab0bd`。
- 创建时的 PR 只读回执为 OPEN / Draft，base/head 与上述一致。本轮未发起新的 GitHub 查询或修改；远端最终状态由原会话在后续精确候选确认时读回。
- 本地 `vibe repo --json` 确认同仓库及上述 head；审查分支为 `codex/mvp-b1-batch-review`，写本记录前工作树干净。本记录不是 `225c2af` 已有内容，不预填尚未形成的新 head。

依据为已独立读取的 Issue #311、批准的 [SD-B1-01–07](../../mvp/b1-design.md#2-已批准的-spec-delta)、当前 [MVP01 Spec](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md)、[MVP01 Test](../../module-tests/Module-Test-MVP01-DocumentDelivery.md)、[批次交付规则](../../decisions/batch-integration-ci.md)与[验证基准 §2.1.2](../../high-level-docs/08-verification-baseline.md#212-批次交付第一阶段)。本轮复核实际累计差异和证据适用性，复用 [PR #312 Review](../pr-312/Review.md) 与 [PR #318 Review](../pr-318/Review.md) 已完成的独立语义分析，不把两个子 PR 的 APPROVE 相加为批次批准。

累计行为预期仍是：明确员工身份下建立持久项目，首次和补充 ZIP 保留不可变原件、清单及来源；三格式按既定安全边界接收，受限条目和真实分母可见；响应丢失恢复原意图，重启不重新分配业务身份；旧 writer 未证实结束不得被替换，RECONCILE 不把旧授权变成新执行授权；UI 明确“资料已接收、分析未接入”。没有扩展到 B2–B5 或借阶段交付缩减 B1 接受标准。

## 累计组合与 main 同步

实际 `main@fb8da30 → 225c2af` 累计差异为 90 个文件。模块实现、MVP Core/BFF/Web 接线、独立迁移和初始化工具、依赖、定向测试及当前状态文档均属于已审查的 B1 范围。

| 核对边界 | 累计候选结论 |
|---|---|
| 当前 main 与合并内容 | `fb8da30` 是 `225c2af` 的祖先；#318 合并后的完整内容与已审候选 `fd24e84` 无差异，没有额外的冲突解决改写。该内容比较只用于决定哪些语义分析继续适用，不用于跨 SHA 复用 CI |
| 验证与批次政策 | AGENTS、project.yaml、批次设计、验证基准、GitHub workflows 及验证工具相对当前 main 无差异；未通过累计业务变更放宽路由、删除分片或启用第二阶段复用 |
| 独立 composition 与旧环境 | 新 MVP 入口、专用 DB/schema/store 和初始化工具与既有入口并存；旧 API/Registry 兼容边界未迁移为 MVP 业务事实。原 token 校验技术复用不替代新 owner/epoch 归属检查 |
| UI、HTTP 与持久模型 | 沿用已审字段矩阵；ProjectSummary 与 ProjectView 分开解析，有限 BFF 路径和下载映射保持 owning contract。批次列表按 owner/project 过滤，attempt cursor 绑定 batch；新恢复修复不改变公开请求形状或幂等输入 |
| 初始化、实例锁与 attempt 锁 | 初始化生成的身份可被实际 BFF 接纳；文件根 canonical realpath 贯穿 Core 实例锁和 Service attempt 锁；Core 先排他再恢复，关闭等待工作结束后释放。父目录别名不能建立第二套锁 |
| 事务、文件与授权恢复 | repository 的 replay/CAS 与 Service guard 共同保护旧 attempts；完整 published/staged 原包复用原固定目标与 attempt，RECONCILE 仅收敛技术事实；显式 CONTINUE 才授权新执行。原包、旧授权、receipt 和已接纳 manifest 不被替换 |
| 依赖与运行约束 | `fs-ext@2.1.1` 与其类型固定，原生构建仅为该依赖明确启用；本机文件锁、不删除稳定锁文件、停止旧 Core 后升级及不支持同实例新旧版本并行的边界保留。macOS 实际执行与 Linux 子候选编译分别有证据，仍须新批次 full |
| 当前状态与产品含义 | 当前 Spec/Test 及 UI/API 索引区分已执行技术旅程、PARTIAL 覆盖和人工 NOT RUN；分析保持 UNAVAILABLE，不把安全结构准入、字节一致或历史 UI 模拟确认写成内容理解与用户验收 |

## 已发现问题的累计处置

| 来源 | 当前处置及未被豁免的边界 |
|---|---|
| #312 R1–R5、R7、R8 | 保持 CLOSED：旧 epoch 执行拒绝、未封存来源隔离、已结束缺包恢复、零字节合法来源、分页边界、跨 epoch 纯核对及负例前提修复均保留；#318 未恢复原绕过 |
| #312 R6 | 子 PR 范围的条目写回滚、manifest 提交后响应丢失、真实 PostgreSQL/Core 重启、补充与原请求恢复已有定向证据；后续 #318 补齐本机初始化、真实 Keycloak 与整实例读回。完整 B1 人工接受仍开放，不能把历史 R6 的子阶段关闭解释为整批验收完成 |
| #318 XLSX R1 | 保持 CLOSED：styles/sharedStrings 按实际关系目标验证存在性、ContentType、XML 根和安全约束，默认/非默认路径正反控制保留；共享 DOCX 防护与外链 READ_LIMITED 未被取消 |
| #318 R-BATCH-LOCK / INSTANCE | 保持 CLOSED：固定 inode flock 保护 socket 恢复和整个持有期；release 幂等且不额外 unlink；实例生命周期及 canonical root 防止两个实际 Core 绕过排他 |
| #318 R-BATCH-RECOVERY / RECOVERY-STAGING | 保持 CLOSED：活跃/UNKNOWN 批次不得 ABANDON；持全部旧 attempt 锁并 inspect 到事务结束；完整 staging 禁止 RETRY，恢复复用原 bytes；缺失/截断保留明确重试出口。正常与跨 epoch 两类组合、实际可 RETRY 状态下的完整/截断对照均保留 |
| #318 R-BATCH-DOCS | 保持 CLOSED：三处当前状态索引已修正为准确的技术证据与人工待验收边界 |

本轮再次核对 #318 正式 Review 记录的 8 项源码/测试 SHA-256，均匹配 `225c2af` 的实际 blob；该 Review 的 SHA-256 为 `28e00b24aa993dba5a17d96b7cc5aa4c7aa5a1d872b4a7124295883fee62a657`。历史记录中的 REQUEST_CHANGES、OPEN 或待冻结措辞对应各自当时的修订，不是当前未关闭代码问题清单；最终子候选确认与本轮适用性判断分别保留。

## 证据与验证边界

- [#318 full run 40072031078 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/40072031078/attempts/1) 精确绑定 `fd24e84` 与其子 PR base：7 个 jobs 成功，3 个持久化分片同 attempt，候选绑定 PASS；Linux 实际编译 fs-ext 成功，161 个测试文件 / 3306 项测试、Workspace 浏览器及契约检查通过。这是被审内容的子阶段证据，不是 `225c2af → main` 的完成证明。
- #318 独立锁/别名反例及真实 PostgreSQL 聚焦证据已在其正式 Review 留存；当前产品和测试内容未改变其前提。本轮没有为复制既有结果再运行广泛检查、启动运行服务或建立 CI waiter。
- `fd24e84` 的隔离 B1 技术记录为 6 阶段运行旅程与 3 项浏览器边界 PASS，保留两个旧候选项目、安装身份与密钥。数据为合成资料，人工标记仍为 NOT RUN；不能直接声称新批次 SHA 已完成真实来源验收。
- #319 创建时回执中，`main admission` 的 [run 40073455991](https://github.com/qzhike/zhiju-business-core/actions/runs/40073455991) 尚在运行。本轮没有读取最终结果，不将该快照解释为当前成功、失败或取消。纳入本 Review 或后续实质修订后，须以新的准确 base/head、checkout、tree、run/attempt 重新确认批次 full、全部持久化分片与主干准入。

## 尚未完成的批次接受与交付条件

1. **正式 Review 的交付与最终候选。** 本文件需通过同批次的文档子 PR、相应检查和独立审查纳入；其合入须有对应授权，#318 的合并授权不自动涵盖新的子 PR。随后冻结真实批次 head，同步并重新确认当时的 main 基线。最终 SHA/检查确认进入 #319 的 review/comment，不为补写 CI 成功再次提交本文件。
2. **批次 full 与 main-admission。** 不以 #312/#318 的成功、内容相同、当前运行快照或其他 attempt 的分片替代新候选结果。第二阶段证据复用仍 OFF；新候选还须由同一 Reviewer 判断语义结论与全部证据适用性。
3. **B1-14 正式来源人工验收。** 仍为 NOT RUN。已选择的 DOCX 和准备的初次/补充 ZIP 尚未人工试走；真实 Markdown/XLSX 待补。需要在实际验收修订上完成混合格式初次托管、补充、受限条目、原请求恢复、重启回读及用户反馈，并确认用户理解“已接收但分析未接入”。只记录匿名输入与必要结果，不公开私有内容、路径、截图或凭据。
4. **其余明确的证据边界。** MVP01 Test 中全部认证负例组合、完整并发上传流矩阵、上传中真实 Core SIGKILL 业务旅程、下载断流/CRLF、全部部分安装故障等仍按原文保留 PARTIAL / NOT RUN。锁层 SIGKILL 不替代 Core 业务旅程；单项正向成功不证明未运行组合。本审查未豁免已约定的必要条件，也不把首版非目标或未经要求的穷尽矩阵新增为阻塞；最终收口须按 owning Test 和批准范围核对必要接受条件。
5. **人类与 main 门禁。** 当前授权仅包括 #318 合入批次和创建本批次 PR；main 合并明确未授权。保留必要人类技术判断与人工验收，单人批准方式不要求第二个 GitHub 账户，也不替代独立 Agent 审查。即使后续获准合入，第一阶段仍必须完成实际 main merge SHA 的 full，才能按授权收口交付事实与 Issue #311。

B2–B5、Runner 接通、S3/生产部署、旧 A/B 数据迁移及 300+ 规模验收均为既定非目标，不因本次批次审查新增为 B1 阻塞项。

本次 Reviewer 仅在指定隔离工作树新增本 Review；未修改产品代码、提交、推送、写 GitHub、合并、运行 full/waiter 或改变 B1/A/B 服务。下一步由交付方准备本记录的可审文档子 PR并完成适用授权与验证；批次保持 Draft，正式人工验收与最终候选证据补齐后继续同一 Reviewer 复审，不提前关闭 Issue #311。
