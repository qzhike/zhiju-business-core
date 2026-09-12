# Human + Agent 工作台 MVP 正式设计提案

日期：2026-09-10  
分类：T2，跨 Experience、内容处理、任务执行与 Agent 接入的设计变更  
状态：正式提案；当前产品交互已获用户阶段性认可，用户批准继续收敛提案与架构；React + TypeScript + Tailwind CSS + Vite 与 Monorepo 已获用户明确批准；其余 §7 技术建议及跨模块 Spec Delta 尚待审查  
设计分支：`codex/frontend-mvp-design`

## 1. 提案定位与权威边界

智举是 Human 与 Agent 共用的业务协作平台。Web 是人的工作台，公开 API/MCP 是 Agent 的业务入口，服务器 Agent 是受控执行者。MVP Web 不内置独立聊天 Agent；员工无需迁移日常对话习惯，也可直接通过 Web 完成适用的人工作业。

本文汇总已确认方向、提出兼容现有内核的设计增量，并显式保留未决问题。创建正式提案不等于全部技术选型、接口、运行时、上传政策或上线条件已获批准；不将前期助手建议提升为用户决定。

本文在独立工作树维护，不替换当前 IM-06 工作项和验收范围。与既有冻结规格的差异列于 §8，正式实现前须同步 owning Spec/Test 与必要 Contract。本文不授权绕过现有 Gate，也不声称代码或集成已经交付。

主要依据：

- [HL-Spec](../high-level-docs/HL-Spec.md)：模块所有权、业务事实、版本、授权与完成边界。
- [产品发现 §8.5–8.6](../high-level-docs/01-customer-field-findings.md)：Agent-native Task Board、飞书与专业 Workspace。
- [架构 §9、§14–15](../high-level-docs/02-zhiju-core-architecture.md)：Canonical Content、Runtime 与 Experience。
- [UI Spec](../module-specs/Module-Spec-UI01-WorkspaceUI.md)、[UI Test](../module-tests/Module-Test-UI01-WorkspaceUI.md)。
- [TaskExecution Spec](../module-specs/Module-Spec-003-TaskExecution.md)、[IM-06 设计](task-execution-human-operated.md)。
- [Runtime Contract](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md)、[Feishu Contract](../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md)。
- [Canonical Content 决策](canonical-content-renderer.md)、[实施里程碑与 Gate](../implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)、[当前路线](../product/roadmap.md)。

## 2. 已确认的产品方向

| 编号 | 已确认内容 | 边界 |
|---|---|---|
| P01 | MVP 服务一线咨询顾问与项目负责人；负责人同时亲自做项目并承担质量审核角色 | 不包含客户企业侧用户；角色重叠不豁免质量与授权规则 |
| P02 | 员工同时推进多个项目，频繁切换 | 入口需要跨项目概览、需要介入的工作和最近访问 |
| P03 | 保留员工惯用的个人 Agent / 飞书入口 | Web 聊天框不是必经入口，不要求重复说明背景和搬运反馈 |
| P04 | Web 不内置独立 Agent，Human 与 Agent 使用同一业务对象体系 | Human 使用 Web/飞书，Agent 使用授权接口；不要求 Agent 操作网页 |
| P05 | 受控文档的 Agent 生成和修改集中在智举服务器 | 个人 Agent 可以讨论、准备输入、提交请求；不能直接覆盖受控成果 |
| P06 | 公司统一控制执行提示词、Skill、MCP，员工不能修改 | Claude Code / oh-my-pi 是用户提出的服务器执行方向；首发组合与适配尚未冻结 |
| P07 | MVP 工作文件统一为 Markdown，暂不处理 XLSX 或 Word | 外部文件由员工在外部整理为 Markdown 后提交；系统内转换与 Excel 模板设计后置 |
| P08 | 本地修改文件是否可直接成为候选或受控新版本尚未决定 | 用户希望上线后观察习惯；不能将上传接纳或全面禁用写成已批准政策 |
| P09 | Web 工作页默认呈现变化详情，摘要按需展开；飞书仍反馈摘要及详情链接 | 后续用户确认替代早期 Web 摘要优先方案；不改变飞书反馈顺序，不承诺所有外部 Agent 支持通知或会话恢复 |
| P10 | 全中文；成果按单套体系标准章节组织；预计交付文档可超过 200 份，记录表单较多 | 看板组织工作或成果批次，不把全部文件平铺成卡片；MVP 以 Markdown 承载正文及表格 |
| P11 | MVP 记录表单、质量手册、程序文件和管理制度统一以 Markdown 填写、检查和交付 | 2026-09-10 用户调整范围，取代此前记录表单统一输出 XLSX 的决定；Excel 转换与模板设计后置 |
| P12 | MVP 保留文件级编号、精确版本、检查及批准；Excel 工作表及工作簿结构设计后置 | 此前工作簿组织建议及两份 Excel 样例仅作探索材料，不构成 MVP 验收条件；已填写记录不等于已批准或已发布 |

用户已要求独立分支承接前端设计与后续开发，避免干扰 IM-06。Monorepo 及 React + TypeScript + Tailwind CSS + Vite 已获用户批准；独立 Web 应用目录与 BFF 部署拓扑仍按 §7 细化，不将框架确认扩大为全部技术 Gate 通过。

## 3. Human、个人 Agent、服务器执行 Agent 的职责

```text
Human → Web / Feishu ───────────────────┐
                                       ↓
个人 Agent → 授权业务接入 → Public API → 智举 Core
                                       │
                            已确认范围与执行授权
                                       ↓
                             服务器 Runtime Adapter
                                       ↓
                             Claude Code / oh-my-pi
                                       │
                             候选输出、来源与执行收据
                                       ↓
                       Core 验证、版本、质量、人工确认
```

- Web 提供进度、成果检查、资料与意见提交、业务确认，不自行调用模型或拥有执行状态机。
- 个人 Agent 提交业务意图、输入资料和修改建议，读取被授权的项目上下文与结果；权限不继承员工全部 Human-only 能力。
- 服务器执行 Agent 处理授权范围内的文档；输出不因进程结束而自动成为已批准或已发布成果。
- Core 保有 Task/WorkOrder/Run/Result、Artifact/Revision、Quality/Approval/Release 的独立所有权及事实解释权。
- Agent 接入与运行时调用是两条不同边界。MCP 工具可用不等于可以远程接管个人桌面会话。

## 4. Web 产品结构建议

### 4.1 看板与工作详情

默认跨项目呈现需要介入的工作、进展和最近访问；支持按项目过滤。看板建议采用“需要你、推进中、待开始、已完成”四组，作为业务状态的展示分组，不新增同名 Core 状态机。

“需要你”保留缺少输入、成果待检查等具体原因。任务执行完成、交付项完成与项目交付进度分别展示，不从 Agent 自报完成推导项目完成百分比。Projection 延迟、UNKNOWN、拒绝与部分成功必须有可辨识状态。

点击工作卡片进入固定高度的独立审阅工作区：左侧为当前工作文件列表，中间为文档阅读区，右侧为唯一的意见与处理区。页面不随文档长度持续增长；正文和长表在阅读区域内滚动。一次展示一处变化，通过上一处/下一处替换当前变化，同时保留所在章节或表格的上下文。

文件用途、编号、模板版次和候选轮次保留为标题下的一行辅助信息。变化详情默认打开，完整内容、资料与依据、摘要与关联在阅读区内按需切换，不在正文下纵向堆叠。右侧意见针对当前文件精确版本，可同时收集多处位置反馈；逐处浏览不是逐处独立批准，提交和批准粒度仍为单文件版本。

成果目录保持标准章节导航。MVP 中间阅读区展示 Markdown 的章节、表区及字段变化，并可核对完整文件；不以 Agent 摘要替代检查依据。宽表在阅读区内横向滚动，不省略列。Excel 预览、差异及转换后置。用户已确认此布局方向，间距、字号、提示文案等可根据上线后的使用反馈调整；版本、权限、反馈可靠提交及可访问性基本要求仍需在上线前验证。


### 4.2 一个反馈入口，不增加聊天助手

当前工作中的问题回答、修改要求、附件与定位引用集中在一个反馈区域。它提交明确关联的业务内容，不运行一套独立 Web Agent。复杂意图由受控服务器流程处理；无法确定范围时产生具体澄清项，不伪装已执行。

区分保存意见与提交修改。主要动作随状态变化；人工批准和发布单独呈现精确对象与条件，不把一般反馈等同于正式授权。新反馈如何转换为后续 WorkOrder，须完成 §8 的业务契约设计。

全局自然语言发起是否进入服务器的请求整理步骤、何时确认范围，仍需细化。Web 无 Agent 不等于禁止后台 Agent 协助整理请求；也不意味着引入自主复杂 Coordinator。

### 4.3 多入口接续

入口共享正式任务、成果和反馈，不强求复制全部聊天记录。业务上下文包括目标、确认要求、精确输入版本、成果引用、未解决问题及人的反馈。

Web 留下意见后无需再次复制回个人 Agent。服务器能否立即执行取决于明确提交、当前授权、范围与运行条件。状态区分意见已保存、已提交待执行、执行中及结果待检查。主动通知、轮询和下次查询分别适配，不承诺所有工具都有推送能力。

手机在“查看文档”和“意见与处理”之间切换，引用变化后进入同一个意见视图；不同时挤入桌面三栏。手机主要支持查看与轻量处理，复杂检查及批准范围沿用正式 UI Gate 决策。历史常驻聊天助手原型属于探索，不是本提案的正式实现依据。

### 4.4 已确认的逐文件检查交互

以下规则来自本提案建立后的用户逐项确认，属于产品交互决定，不代表相关 Command、状态映射或授权增量已经实现。

| 场景 | 已确认行为 |
|---|---|
| 从看板进入工作 | 进入独立工作详情页，处理后返回；不以侧边抽屉作为主要工作空间 |
| 本轮多份成果 | 左侧紧凑成果列表，中间阅读区，右侧唯一意见与处理区；列表限定当前工作成果 |
| 需要修改 | 单份文件检查后即可提交意见，不等待整批；提交成功后留在当前文件，MVP 不自动切换 |
| 无需修改 | 在当前页逐份检查并批准具体版本，不等待整批集中批准；必须满足真实质量与授权条件 |
| 批准成功 | 自动进入下一份待检查文件；批准失败或结果 UNKNOWN 时不按成功切换 |
| 新版本交回 | 用户主动切换到新版本后默认显示变化详情；上次意见与处理摘要在“摘要与关联”视图按需查看，保留本轮其他改动及完整文件入口；Agent 自报已处理不等于检查通过 |
| 检查中发现新版本 | 保持正在查看的旧版本及未提交意见，提示新版本，由用户主动决定切换；不自动替换正文 |
| 默认阅读顺序 | 首次进入、切换文件、批准后进入下一份及查看其他版本均以变化详情为主，一次一处变化；摘要通过辅助视图查看 |
| 辅助信息 | 文件身份为一行；一般提示和关联文件在辅助视图查看，不纵向追加到正文；真实阻断问题保留紧凑醒目的提示 |
| 阅读空间 | 页面高度受视口约束；长文与表格在阅读区滚动，逐处导航替换当前变化，意见区独立保留 |
| 窄视口 | 文档和意见分视图切换；引用后可直接写意见；具体断点和支持矩阵待 UI-DG-002 |
| 位置反馈 | 从章节、表格、适用性问题或关联关系引用到同一个反馈入口；不增加各处独立输入区 |

单份反馈明确绑定文件、基准版本及适用内容位置，切换文件保留各自未提交意见。批准只绑定精确版本，表示智举内部对交付成果版本的批准，不等于发布、交付，也不替代模板中的客户总经理或企业负责人签批。没有下一份待检查文件时列明本轮检查结果与仍在修改/等待的事项，不自动推导整项工作完成。

版本保护不代表旧版本必然仍可提交或批准：动作发生前仍须按 owning 规则核验当前适用性。禁止静默将旧意见、位置引用或批准对象改绑到新版本；意见迁移与冲突解决的具体交互仍需细化。

### 4.5 关联影响的分工与范围确认

单文件修改涉及其他成果时，先提出关联修改建议，由 Human 确认是否扩大范围。已确认由服务器 CC/OMP 分析语义影响，业务服务校验和保存建议、组织确认，Web 展示并收集决定。

业务服务可以提供已有的文档关联；Agent 判断本次修改对关联内容的实际影响，并返回目标文件与版本、影响原因及建议。读取相关资料必须经过授权，读取许可不等于写入许可。范围外的文件在扩大范围获准前不得被修改。

具体建议 Schema、反馈与 ReviewIssue 的关系、阻断条件和后续 WorkOrder 创建规则仍按 §8 D05 设计，不将产品分工直接视为可执行接口。

### 4.6 适用性展示与原型边界

用户接受了工作页中的适用性提示、引用查看、内容定位与单一反馈入口；这属于展示和操作方向确认。实际哪些问题阻断批准、谁能确认、确认绑定哪些版本与证据、变更后是否需要重评，仍由 owning 业务规则决定，并须完成 D10/Q10 的契约设计。

采购申请单原型使用“客户是否存在研发样品采购”的合成待确认场景。底部“演示：当前范围已确认”只是模拟已取得确认结果，不是拟上线的业务按钮。提交自由文本不会自动解除阻断；当前演示只对本轮候选记录确认，新版本不会继承。不得据此推导生产规则一律按文件轮次重新确认，或浏览器可自行解除 Quality Gate。

章节/表格引用在原型中以模板文本位置展示；正式反馈须使用精确 RevisionRef 与受支持的稳定内容定位。源文本行号不等于 Canonical Unit ID。读取关联文件不表示必须改写，文件被多处引用也不应复制成多个互不关联的正式身份。

## 5. Markdown 工作格式与内容版本

已确定的是用户工作格式和 Word 输入边界，尚未决定改变 Canonical Source of Truth。

**推荐保留现有 STRUCTURED_DOCUMENT / WORKBOOK_SPEC 与不可变版本模型**。MVP 先明确 Markdown 的受控导入、执行交换、解析验证和输出映射；本次缩小用户工作格式范围不删除现有 WORKBOOK_SPEC 或 XLSX Renderer 能力，也不改变 Canonical Source of Truth。若改为文件 bytes 是唯一正式内容，必须单独修订 IM-DG-005，不得以普通 UI 改动实施。

需要冻结：

1. Markdown 支持语法、图片/附件及证据引用、稳定段落身份映射和不支持内容的处理。
2. Markdown 表格的宽表、长文本、空白值和已填数据保留边界；不支持的内容须显式报告。Excel 公式、校验、格式保真和模板转换不属于 MVP。
3. 原始文件、规范化内容、执行输出、候选版本与下载表示之间的来源及 Hash 关系。
4. 导入与再生成的差异检测；不支持内容必须报告，不能静默丢失。
5. 空白模板与真实业务记录分别处理；修改表格结构不能默许改写历史数据。

MVP 最终交付格式已由用户确认：

| 模板业务类别 | 最终交付格式 | 内容保留要求 |
|---|---|---|
| 记录表单 | Markdown | 包括报告、说明、签批单和追溯矩阵；填写真实数据并保留章节、字段说明、条件适用、关联编号及签批区，不伪造记录或签字 |
| 质量手册、程序文件、管理制度 | Markdown | 保留正文层级、表格与引用；不转为 Word |

P11/P12 按 2026-09-10 最新决定统一为 Markdown 工作格式，撤回 MVP 必须交付 XLSX 的要求。当前 Markdown 预览与格式方向一致，但仍只是交互原型，不代表受控内容管线已实现。模板源文件保留，填写后的候选与源模板精确版本保持可追溯关系。Excel 转换及逐模板工作簿设计后置，尚未承诺实现时间。

公司维护的记录模板与客户已有表格都属于实际输入来源。系统不将“未上传”视为“客户没有”。

本地修改文件的接纳策略继续待定。建议评估“作为参考修改建议上传，由服务器比较后形成候选”的过渡路径，但此建议未获用户确认。上线前仍须确定可执行默认行为与观察指标：实际上传需求、服务器重新处理成本、差异保留质量及误覆盖风险。

### 5.1 真实模板输入与修正依据

2026-09-09 对本地 `/Users/galendai/repo/qzhike/zhiju-doc-artifacts` 的盘点为 309 份 Markdown：质量手册 1、程序文件 35、管理制度 25、记录表单 248；没有实际 Excel 工作簿。此为当次目录快照，不是持续更新的模板注册表，也不是法规有效性或全部模板业务正确性的认证。

记录表单包括台账、签批单、报告和追溯矩阵。结构扫描中 46 份文件包含超过 12 列的表格，软件缺陷明细表达到 44 列；MVP 使用 Markdown 仍须保留全部字段与说明，宽表展示不能裁掉内容。业务类别不因统一扩展名而合并，分类不清的输入须先确认。

采购原型保留三份精确源文件快照，可在仓库内复核：

| 来源快照 | 模板版次 | 约束与演示用途 |
|---|---|---|
| [采购控制程序](../prototypes/workspace-mvp/templates/procedure.md) | A/5 | §5.3.1 保留生产/研发审核及总经理批准；§7 演示引用编号补齐。没有新增金额审批阈值的模板依据 |
| [采购申请单](../prototypes/workspace-mvp/templates/application.md) | A/0 | 保留计划周期、库存、研发样品补充区及既有总经理批准栏；演示供方名录引用核对 |
| [供应商评价记录](../prototypes/workspace-mvp/templates/evaluation.md) | A/0 | 保留评价类型、五个评价栏目、附件和签批栏；演示整改跟踪引用。签批栏与编制说明的适用表述差异应可见，不由原型自行裁定 |

原始快照的来源路径和 SHA-256 见 [模板样例数据](../prototypes/workspace-mvp/procurement-fixtures.js)。模板维护历史属于模板来源，不继承为客户修订活动。客户名称、变化前遗漏、候选轮次、进度和质量结果是合成演示；模板内容并非全部虚构。候选预览不等于受控 Markdown 导入、渲染或业务验收已经实现。

### 5.2 内容与业务身份的分界

以下是与已有权威规则一致的设计约束及后续细化方向，不预先增加业务模块或数据库聚合：

- 公司标准模板、客户适配成果/空白表单、已填写的客户业务记录分别识别；空白表单编制完成不证明客户已执行活动。参见 [产品发现 §6.2](../high-level-docs/01-customer-field-findings.md) 与 [领域模型 §31.7](../high-level-docs/04-domain-model-v0.1.md)。
- 保留 [TemplateBaseline](../high-level-docs/04-domain-model-v0.1.md) 的精确版本冻结，不把目录的当前文件视为项目永久跟随的 latest；模板不是法规证据，示例数据不是客户事实。
- 一个主导航体系可以引用多个标准或法规。编号、归口章节、适用条款及跨文件引用应分别表达；最终映射、编号替代与适用范围规则待 D09/D10 冻结。
- 看板完成度来自已确认交付计划，不能以 309 份模板为默认分母，也不能把空白表单数量当作客户运行成熟度。
- 模板接入需识别占位符、已填示例、维护历史和结构歧义；不支持的结构不能静默丢失。模板库准入及发布流程是建议细化项，见 Q08。
- 模板中的采购、生产、检验等客户运营流程是交付文件内容，不自动成为智举需要运行的 ERP 流程。MVP 不因此增加客户运营业务模块。

### 5.3 Markdown 填写与后置的 Excel 转换

MVP 直接基于 Markdown 模板填入经确认的数据，形成文件级候选；一份文件独立编号、版本管理、检查及批准。空白模板、客户适配表单、已填写业务记录继续区分，不能把填写完成视为客户已签批或系统已发布。

员工通过当前文件的同一个意见入口提出内容或结构调整。服务器在授权范围内处理并形成新候选，由 Human 重新检查；已批准版本和历史记录保持不可变。反馈不直接改写公司模板库，新候选也不自动升级公司模板或其他客户项目。本地文件接纳仍见 P08/Q02，格式缩减没有替用户决定上传策略。

Web 中间阅读区按 Markdown 章节、表区和字段定位当前变化，上一处/下一处切换上下文；左侧以文件为单位，右侧保留一个文件级反馈入口。引用携带精确版本及稳定内容位置；源文本行号不等于正式稳定身份。表格调整后的引用失效与迁移规则仍须在 Q01/Q08 冻结，不能静默把旧意见绑定到新位置。

此前提出的一模板一 Excel 文件、公司预设工作表及按用途分表的方案，以及采购申请单、供应商评价记录两份 Excel 结构样例，保留为后续探索材料。MVP 不继续设计或验收工作簿划分、Excel 渲染、公式保真和模板转换；后续重新讨论时须另行确认范围。

## 6. 公司执行方案与权限

建议将用户所说的“固定写死”落实为版本化的公司执行方案，而非散落硬编码：

- 方案关联提示词、Skill、MCP 工具白名单、模板、检查规则和运行时配置版本。
- 每次执行锁定方案和输入版本，升级只影响后续适用任务，不改写历史。
- 执行目录与环境由服务器管理，不继承员工上传的项目指令、插件或个人配置。
- 个人 Agent 不能提交任意 shell、运行时路径、工具安装或凭证配置作为业务请求。
- 只读输入、独立输出、客户/项目/Run 隔离和确定性检查保留。
- 建议先验证一个默认执行运行时，其他作为后续受控适配；不得无提示切换运行时重试。

目前受控 CLI 基准列明 Codex / Claude Code / OpenClaw，oh-my-pi 尚未有等价的正式 Profile。本提案不声称其 CLI、结构化结果、取消、恢复、Usage 或沙箱能力已验证。

## 7. 前端架构建议

按已批准的 Monorepo 形式交付，建议采用仓库内独立 Web 应用，独立构建及部署，维持契约统一管理。暂不拆分独立前端仓库，不引入微前端。

沿用里程碑已有目标命名，避免另造平行目录：

```text
apps/workspace-web/       Browser 工作台
apps/workspace-bff/       会话与公开 API 组合的逻辑边界
apps/api/                 业务 API 入口
modules/                  现有业务模块
contracts/                公开业务契约
packages/                 按实际需求提取的共享代码
```

这些是拟议目录，不在本次提案中创建应用脚手架。BFF 可独立进程或由 Web 服务端部分承载，物理拓扑尚待 UI-DG-003。Agent 接入层的位置与部署单元另作契约设计，不默认要求新建独立网关服务。

依赖约束：

- Web/BFF 仅消费公开 API 与适用的浏览器客户端类型，不直接导入业务 Repository、私有 Service 或数据库连接。
- BFF 负责 OIDC 会话、页面数据组合和安全代理，不重新定义业务授权、Completion、Approval 或 Release。
- 不把整个包含服务器依赖的 contracts 包未经审查直接打进浏览器。
- Web 不接触 Runtime 凭证、执行目录或配置管理接口；正式业务规则必须由 Core 强制执行。
- 前后端可在同一变更中同步契约，部署仍保持向后兼容；同仓提交不保证同时上线。
- 公共 UI 组件按需要抽取；框架、路由与状态方案的具体建议见 §7.1，未获选型批准前不新增依赖或脚手架。

### 7.1 前端工程方案（技术栈及 Monorepo 已批准，其余待冻结）

用户明确批准 React + TypeScript + Tailwind CSS + Vite，以 Monorepo 交付。建议在现有 pnpm workspace 内新建独立的 `apps/workspace-web`，采用客户端 SPA；SPA/SSR 边界、精确版本与升级策略仍须完成 UI-DG-001 的剩余确认。工作台主要为登录后的文档检查与跨项目协作，本轮没有 SEO 或服务器首屏渲染需求；业务服务和 BFF 已有独立边界，客户端构建与部署可以单独交付。该选择是项目适配判断，不是 React 官方的唯一推荐路线。

React 官方通常建议以框架起步，也支持 Vite 构建客户端 SPA；后者需显式负责路由、数据获取及后续框架能力。见 [React 应用构建说明](https://react.dev/learn/build-a-react-app-from-scratch)。Vite 支持独立静态构建产物，生产部署使用正式静态服务，不能把 preview 服务作为生产服务器，见 [Vite 部署说明](https://vite.dev/guide/static-deploy.html)。首次工程实现前锁定精确依赖版本并核对当时主仓 Node/pnpm 基线，本提案不预填未经验证的版本号。

| 项目 | 建议 | 取舍与验收 |
|---|---|---|
| 应用形态 | React + TypeScript + Vite 已批准；客户端 SPA、独立构建及部署为建议 | 初期免去 SSR/RSC 运行层；路由、错误边界、数据读取需明确实现。未来若出现明确 SSR 需求再复评 |
| 路由 | 采用维护中的客户端路由库；路径携带工作对象，查询参数携带精确版本及位置 | 本轮不锁定路由库；刷新、深链接、前进后退、失权与不存在必须正确处理，不在 URL 中存正文、token 或短期下载链接 |
| 样式 | Tailwind CSS 已批准；设计 token 和语义组件集中管理 | 不把 utility class 写入业务数据或契约；具体组件库与可访问性验证仍待 UI-DG-002 |
| UI 组织 | 工作看板、文件检查、反馈结果三个 feature；共用基础按钮、对话框、表格和状态提示 | 沿用已认可的视觉与交互；组件库候选在键盘、目录焦点和宽表验证后确定，不直接套用 ERP 页面模板 |
| 状态分类 | 服务端事实、页面导航、未提交意见分别管理 | 不把业务事实复制成浏览器状态机；正式敏感草稿暂建议仅内存保留，跨刷新恢复需独立受控草稿方案，不能照搬原型 sessionStorage |
| 读取刷新 | 首版采用可停止的轮询和用户触发刷新；后台标签页降低频率，登出/切 Scope 取消请求 | 刷新可发现新候选，但不自动替换正在检查的版本或把旧意见迁到新位置；刷新间隔在可用 API 与容量核验后冻结 |
| 大量内容 | 核对总数常驻，目录按需搜索及分页；只读取选中变化需要的上下文 | 40 项原型验证不能替代大规模服务端分页；超过 200 份文件不全量加载正文，目录结果注明总数及是否完整 |
| Markdown | 通过受控内容管线提供正文、差异、稳定位置和下载表示 | 浏览器负责安全呈现；不把客户端 diff 当作正式变更证据，不执行客户 HTML、脚本或任意嵌入内容 |

### 7.2 BFF 与部署方案（拟议，待 UI-DG-003）

推荐独立 `apps/workspace-bff` 进程，沿用现有 Node/TypeScript 与 NestJS/Fastify 技术方向以减少服务端技术分叉。首次部署可与 Core 同机，仍保持进程、配置与发布边界；无需为 MVP 引入微服务集群或微前端。仓库内独立应用不等于独立仓库，也不要求独立域名。

```text
Browser → 同源反向代理
            ├─ 静态资源 → workspace-web 构建产物
            └─ Web 会话/页面读取 → workspace-bff
                                      ├─ Keycloak：OIDC
                                      └─ 公开 HTTP API → owning Core Service
个人 Agent / 服务器 Runtime → 各自授权业务与执行入口（不经过页面）
```

路径前缀属于后续 Experience 路由设计，不在这里发明公开业务 Command。BFF 可以组合已授权 Query，不能用一个页面动作同步写多个 owning module。命令仍通过现有公开契约指向唯一 Owner；只有公开 API 准备好，相关页面才可接入。

继承既有 OIDC Code + PKCE、HttpOnly/Secure Cookie、CSRF、Origin/Host 校验及 token 服务端保管规则。建议部署为同源 Browser/BFF；认证由 Keycloak 证明，业务权限由 IdentityPolicy 决定，不能以 UI 隐藏按钮替代服务器拒绝。

UI-DG-003 仍须具体冻结：服务端会话存储与重启/撤销语义、Cookie/SameSite 与 OIDC 回调匹配、超时和刷新策略、CSRF 协议、CSP/Markdown 净化策略、草稿恢复，以及短期下载与日志脱敏边界。在这些细节完成前，不声称本节是一套可上线的认证方案。

### 7.3 首个闭环的页面能力与事实来源

下表是能力映射，不是已存在的接口清单。正式接入前须用主仓最新 Catalog、Payload 和实际 Handler 逐项核对，缺失能力列为 owning 契约增量，不在 BFF 私造替代。

| 页面/动作 | 所需公开能力 | 必须保留的边界 |
|---|---|---|
| 跨项目看板 | 已授权工作集合、待办原因、进度 Projection | 显示更新时间和 STALE；不把任务完成换算为项目完成，不把模板数量当交付分母 |
| 打开工作与文件 | 工作范围、成果列表、精确 Revision、权限裁剪查询 | 深链接重新授权；文件与版本不能依赖名称匹配 |
| 核对目录与正文 | 变化总数、可分页目录、稳定位置、精确版本正文及证据引用 | 目录缺页不能显示“全部”；找不到位置要明确失效，不能静默跳到附近文本 |
| 提交补充/修改 | 当前版本绑定、明确范围、幂等提交与请求回执 | 未收到成功回执保留草稿；超时进入待核实，不重复自动启动执行；与 IM-06 的反馈接续契约仍需冻结 |
| 意见处理结果 | 原始提交与返回 Revision 的可追溯关联、执行声明及服务验证结果 | Agent 自报已处理不等于服务校验通过；无关联回执不能推断已完成，部分处理须逐项保留未处理部分 |
| 批准此版本 | AUTHORITATIVE readiness/授权查询和 owning Approval Command | 提交时重验版本及权限；成功才自动下一份，UNKNOWN 留在当前；Human-only 与客户签批分离 |
| 下载 | 对精确版本发起授权下载 | 不能下载成 latest；短期 URL 不进入长期缓存或可分享链接 |

### 7.4 浏览器与验证范围（拟议，待 UI-DG-002）

建议桌面首发覆盖 Windows/macOS 的 Chrome、Edge 最近两个稳定大版本，窄视口覆盖 iOS Safari 与 Android Chrome 的查看、引用和反馈；Safari 桌面及其他浏览器的完整批准能力另评。建议以 WCAG 2.2 AA 作为可访问性目标，具体支持版本和测试清单在 Gate 冻结时记录，不把原型一次截图视为正式兼容性或合规结论。

正式测试需覆盖：40/200 项目录与分页、宽表、键盘和焦点恢复、网络超时与 UNKNOWN、多个标签页竞争、新版本到达时保留当前页、Scope 切换缓存隔离、Markdown 恶意内容、登出与重新认证。UI 组件和 Mock API 测试、真实 OIDC/API 浏览器测试、独立人工验收分别记录，互不替代。

### 7.5 实施顺序与退出条件

1. **当前：完成设计准备。** 以本节审查 UI-DG-001～003；梳理 Markdown 映射、反馈及批准所需公开能力。原型继续保留，尚不创建正式应用。
2. **READY 后：建立 Web/BFF 工程和会话外壳。** 须有适用 IM-06 前置条件、已批准技术 Gate 和可用公共契约。完成构建、依赖隔离、真实登录与失权路径，不用 mock 验收真实会话。
3. **先接只读工作闭环。** 看板 → 工作文件 → 精确候选 → 变化与来源 → 授权下载；验证 Projection freshness 与权威读取的区分。
4. **再接修改闭环。** 补充/反馈提交 → 处理结果 → 新候选 → 人工批准；必须先冻结反馈 Owner、运行中追加意见和版本冲突语义。正式服务器执行还需 Runtime Gate，不把浏览器演示按钮变成后端业务能力。
5. **完成组合验收。** 权限、失败恢复、浏览器及人工验证分别通过后才讨论上线。GitHub 实现任务只在 NOW + READY 时发布；本次不创建 Issue、提交、推送或合并。

### 7.6 首个采购审阅闭环的接口就绪结论

本节作为前瞻能力映射与 Spec Delta 的依据，不是独立验收报告。核查来源为 §11.1 指定的主工作区代码基线；代码路径以仓库根目录为准，独立 frontend 分支尚未同步主工作区的新契约。以下“已有实现”只指查见模块内实现，不代表本轮重跑过模块测试或公开 HTTP 已验收。

**总体结论：可继续设计与接入准备，真实 UI 闭环尚未 READY。** 当前 `apps/api/src/app.module.ts` 只注册 `HealthController`，`apps/api/src/health.controller.ts` 仅提供 health 查询；因此下列业务操作即使已有 Handler，也尚不能通过当前 API 应用供浏览器/BFF 调用。HTTP Dispatcher、可信身份/Scope、契约校验、错误映射和适用授权链须先接通。BFF 不能通过直接导入 Handler/Repository 来规避此缺口。

| 页面能力 | 已找到的公开契约/实现 | 剩余差异与推进条件 |
|---|---|---|
| 项目进度 | `project.get_project_board_slice`；`modules/enterprise-project/src/business/query-handlers.ts` 的 `handleGetProjectBoardSlice` 已有按项目分页、过滤及 Projection cursor 校验 | 这是单项目交付条目视图，不等于跨项目“需要我处理”。需确定已授权项目集合、跨项目排序/分页和 freshness 的组合契约；再接公开 HTTP |
| 工作队列和执行状态 | `execution.get_task_board_slice`、`execution.get_work_order_contract`、`execution.get_work_order_draft`、`execution.get_run_state`、`execution.get_agent_result` 等已有 Schema 定义 | `modules/task-execution/src/index.ts` 及模块目录仍为技术持久化基础，未查见对应业务查询 Handler；等待适用 IM-06 业务切片，不以 FULL Schema 视为可调用 |
| 文件与精确候选 | `artifact.get_artifact`、`artifact.get_revision_snapshot`、`artifact.get_revision_lineage`；Artifact 的 `artifact-handlers.ts` / `revision-service.ts` 已有读取实现 | 需工作到成果集合的精确关联、公开 HTTP 和权限裁剪；不要把“能读取某个 Revision”当作“已能列出本轮全部成果” |
| 变化目录和逐处对比 | `artifact.get_revision_diff_inputs` 与 `handleGetRevisionDiffInputs` 已有实现 | 返回 left/right snapshot、commonAncestorRef 与 comparisonSchemaRef，不返回原型中的变化条目、分页目录、字段高亮或意见定位。须冻结 Markdown/Canonical 映射及稳定位置/比较结果契约；不新增 BFF 私有业务事实 |
| Markdown 填写与下载 | Artifact 的 sealed Revision、`artifact.get_representation` / representation registration 及 `integration.request_render` 有现有基础 | 当前 deterministic renderer 生成 DOCX/XLSX；未查见 Markdown Renderer。Representation 查询不等于授权短期下载服务。需完成 MD 导入/输出、完整性验证及精确版本下载协议；用户缩小格式范围不代表这些代码已经存在 |
| 提交修改意见并接续执行 | `quality.raise_review_issue`、`quality.propose_issue_resolution`、`quality.verify_issue_resolution`、`quality.close_review_issue` 已有模块内 Handler | ReviewIssue 是质量问题，不等同任意自然语言编辑请求。Task Spec §11/§12 仍未支持 IN_REVIEW/CHANGES_REQUIRED 的 Human 控制入口；先冻结 Q05 的 Owner、意图/质量问题分类、修改范围、版本冲突和后续 WorkOrder 关系 |
| 意见处理回执 | `execution.get_agent_result` 有声明；Quality 的 resolution proposal/verification 有独立语义 | 尚未找到与原型等价的通用“某次文件意见 → 部分处理状态 → 新 Revision”公开视图。需区分 Agent 声明、服务验证和 Human 核对；单纯出现新 Revision 不能判定意见已落实 |
| 检查与批准 | `quality.evaluate_revision_readiness`、`quality.get_revision_acceptance_snapshot`、`quality.get_approval_bundle_snapshot`、`quality.request_approval`、`quality.submit_approval_decision` 已有 gate/review/approval Handler | 仍缺公开 HTTP/会话接入和 UI 操作映射。保留版本、Human-only、职责分离及质量条件；“负责人兼顾问”不能绕过 profile 要求的独立性。成功回执后才自动下一份，UNKNOWN 需核实 |

主要证据位置：`contracts/src/operations/{enterprise-project,task-execution,artifact,quality-governance,integration-gateway}.schema.ts`；`modules/artifact/src/business/{revision-service,representation-service}.ts`；`modules/quality-governance/src/business/{quality-gate-handlers,quality-review-approval-handlers}.ts`；`modules/integration-gateway/src/renderer/deterministic-ooxml-renderer.ts`。TaskExecution 缺少 Human 审阅控制入口与实现范围，另见 owning Module-Spec-003 的当前状态及 reconcile 规则。

#### 应优先完成的设计增量

1. **反馈接续（Q05）：** 明确普通补充/编辑请求与质量 ReviewIssue 的区别、唯一 Owner、绑定版本、允许的范围、追加/冲突及创建后续 WorkOrder 的条件。结果必须可追溯到提交与返回候选；未处理和部分处理不可被进程完成覆盖。
2. **Markdown 与变化（Q01/Q08）：** 冻结 Markdown 支持集、Canonical 映射、稳定段落/表格位置、目录分页与变化结果表达、精确下载。以宽表、空白/零值、结构移动、无效引用和恶意内容作为必要失败场景。
3. **公开接入与会话（UI-DG-003）：** 对已有模块能力接公共 HTTP，而非改写其规则；建立 BFF/IdentityPolicy 链、幂等提交与 UNKNOWN 核实路径。具体操作版本在实现任务就绪时从最新 Catalog 锁定。
4. **剩余前端决定（UI-DG-001/002）：** 在已批准技术栈上确定 SPA/SSR、精确依赖及升级策略、组件系统、浏览器/视口和可访问性目标。Tailwind CSS 的确认不自动选择组件库。

退出本阶段设计准备的条件：上述 Owner 和精确版本语义无歧义；相关 Spec/Test/Contract 已同步并获适用审核；每个准备实施的动作有确切 API 及 Handler/HTTP 就绪状态。当前不创建尚未 READY 的实现 Issue，不使用原型或 mock 宣称真实会话、Markdown、Agent、HTTP/业务 E2E 或人工验收通过。

## 8. Spec Delta 与影响范围

| 增量 | 当前差异 | 建议修改的权威位置 | 状态 |
|---|---|---|---|
| D01 Web 无独立 Agent | 原型曾展示常驻助手；现有 Experience 分层兼容新方向 | 产品发现、架构 §15、UI Spec/Test | 产品方向与工作页布局确认；正式 UI/API 映射待定 |
| D02 仅服务器执行受控文档任务 | Runtime 允许用户或服务器 CLI，列明三个既有 Profile | 架构 §14、Runtime Contract/Test、IntegrationGateway Spec/Test、IM-DG-006 / IM-08 | 方向确认；运行时选择与验证待定 |
| D03 Markdown MVP | 正式内容为结构化模型；已有最小 DOCX/XLSX Renderer 不等于 Markdown 支持 | Canonical 决策、Artifact/IntegrationGateway Spec/Test、必要输入/输出 Contract、相关 Render Gate | MVP 仅 Markdown；映射路线待定；Excel 转换后置 |
| D04 个人 Agent 请求与授权 | Agent 创建 Task DRAFT 需要 Coordinator Capability，不能直接 READY；部分首版 Query 面向 Human/Service | IdentityPolicy、TaskExecution、IntegrationGateway、API/MCP 接入与测试 | 需明确受限 Agent 能力与可信 Human Intent 路径 |
| D05 修改反馈进入下一轮 | TaskExecution 首版答案仅特定 CustomerMaterial；尚无完整 Human IN_REVIEW / CHANGES_REQUIRED 控制路径 | TaskExecution、Quality ReviewIssue、Artifact、必要 Command/Query/Event 与模块测试 | 需明确反馈所有权、范围、版本、提交和接续契约 |
| D06 人工本地修改上传 | UI Spec/里程碑含 Human Edit 新 Revision，但本轮用户未决定上传接纳方式 | UI/Artifact Spec/Test、IM-UI-01、相关产品范围 | 待定；不能宣布允许或永久禁止 |
| D07 Monorepo 独立应用 | 与现有 workspace-web / workspace-bff 目标兼容 | UI-DG-001～003、Technology / Deployment Baseline | Monorepo 与 React/TypeScript/Tailwind CSS/Vite 已批准；其余技术与拓扑待定 |
| D08 变化优先与精确反馈 | 早期摘要优先及纵向堆叠已被固定高度三栏、逐处变化与辅助视图替代 | 产品发现、架构 §15、UI Spec/Test、反馈定位 Contract | 布局确认；正式稳定定位与 Diff 公共接口待审查 |
| D09 模板接入与文件关系 | 已有 TemplateBaseline/精确引用；需细化模板用途、归口、编号替代、示例隔离与解析歧义处理 | 产品发现、EnterpriseProject/Artifact/IntegrationGateway Spec/Test、相关输入 Contract | Markdown 填写及交付方向按 P11/P12 确认；元数据、准入及兼容规则待定；工作簿设计后置 |
| D10 适用性与批准含义 | 原型展示待确认阻断；实际事实、角色、证据和重评条件尚未冻结 | EnterpriseProject/QualityGovernance/TaskExecution、UI Spec/Test、批准快照 | 内部批准不替代客户签批；阻断与确认契约待定 |
| D11 真实模板验收 | 最小 Renderer 和合成业务 Fixture 不证明复杂真实模板已支持 | 验证基线、Canonical 决策、相关 Module Test | 需覆盖宽表、混合表单、引用影响与格式损失；业务验收 NOT RUN |

D04 不能给个人 Agent 伪造 Human 身份；可提议受限请求草稿与可信人类确认流程。D05 不应把任意修改要求塞入现有客户资料确认 Profile；先决定 owning module 与新旧对象关系，不预先承诺新增独立 Feedback Aggregate。

所有新增接口遵循公开契约的 additive/versioning 规则；不改历史 Hash、sealed Revision、旧 Result 或既有 Compatibility Baseline。保留七个 Business Core 模块，不因新页面新增业务内核模块。

### 8.1 PRD / HL-Spec 后续同步清单

本轮只更新此正式提案与 Spec Delta，不直接改写正在开发中的权威规格。仓库未单列 PRD 文件，以产品发现文档作为需求依据。后续落实按 owning 权威同步：

| 文档 | 应同步的修正 |
|---|---|
| [01 产品发现](../high-level-docs/01-customer-field-findings.md) | Web 变化优先、三类内容身份、MVP Markdown 范围、内部批准含义及代表性模板验收 |
| [HL-Spec](../high-level-docs/HL-Spec.md) | 新 MVP 范围与专题路由；保留业务所有权、不可变版本和 Human-only 授权 |
| [02 架构](../high-level-docs/02-zhiju-core-architecture.md) | 模板接入和文件交换路径、Web 展示分工、Markdown 路线与既有 Renderer 能力边界 |
| [03 核心契约](../high-level-docs/03-core-contracts.md) | 真实采购引用示例、内容单元范围、反馈与授权衔接；以 IM-06 最新契约重新核对 D04/D05 |
| [04 领域模型](../high-level-docs/04-domain-model-v0.1.md) | 沿用基线/适用性/证据模型，细化模板用途、输出类型和编号替代的所有权 |
| [05 跨聚合一致性](../high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md) | 保留模板升级影响评估；明确逐文件批准与跨文件一致性/发布条件；对齐旧 DOCX/PDF 示例的 MVP 范围 |
| [06 精确引用](../high-level-docs/06-typed-references-contract-catalog-v0.1.md) | 文件别名与业务行号映射稳定身份，反馈不以文本行号或名称代替精确引用 |
| [07 数据模型](../high-level-docs/07-postgresql-logical-model-v0.1.md) | 业务语义先冻结，再判断现有元数据或新增字段的需求；不因 UI 卡片直接设计新表 |
| [08 验证基线](../high-level-docs/08-verification-baseline.md) | 纳入真实模板结构及失败场景；区分技术、格式、真实业务与人工验收 |

## 9. 尚待决定

| 编号 | 问题 | 建议 / 最晚决定点 |
|---|---|---|
| Q01 | Markdown 与 Canonical 的关系 | 推荐保留结构化内核；MVP 内容管线实现前决定；Excel 映射后置 |
| Q02 | 本地修改上传的 MVP 默认行为 | 保留未决；上传产品能力和上线验收前决定 |
| Q03 | 首个服务器运行时及 oh-my-pi 范围 | 推荐单运行时先验收；IM-DG-006 / IM-08 前决定 |
| Q04 | 个人 Agent 的身份、请求与授权 | 接入契约和 MCP 工具发布前决定 |
| Q05 | 反馈提交后自动执行的条件、版本冲突与运行中追加意见 | 修改闭环接口实现前决定；不能把建议当作已批准规则 |
| Q06 | 框架、构建、SPA/SSR、组件系统、可访问性与 BFF 拓扑 | React/TypeScript/Tailwind CSS/Vite 与 Monorepo 已批准；SPA/SSR、版本策略、组件系统和 UI-DG-002/003 仍需收敛 |
| Q07 | 看板分组、进度统计及刷新语义 | UI 与 Projection 契约对齐，不由浏览器猜业务状态 |
| Q08 | Markdown 模板准入、用途分类、字段填写、稳定定位及不支持内容的处置 | P11/P12 已确认 MVP Markdown 范围；具体设计在输入管线前冻结，禁止将示例直接采信为客户事实；逐模板 Excel 转换与结构迁移后置 |
| Q09 | 归口、多重引用、旧编号替代与条款映射 | 模板目录和关联查询实现前冻结，保留已有精确引用基础 |
| Q10 | 适用性问题的确认角色、证据、阻断及重评条件 | 与 owning Gate/Approval 契约一起冻结；原型模拟按钮不是业务接口 |

## 10. 正式业务验收场景（前瞻要求，均为 NOT RUN）

1. Human 无需使用 Web 聊天助手，可通过 Web 提交明确范围的工作并查看执行结果。
2. 个人 Agent 在授权项目提交请求；不能访问其他客户、直接 READY、覆盖受控版本或执行 Human-only 批准。
3. 同一任务可从外部入口进入 Web 查看精确成果；Web 反馈无需手动复制回外部工具。
4. 服务器执行使用锁定方案版本；上传的指令文件和个人配置不能改变工具授权。
5. 重复提交、并发执行、旧版本意见、超时 UNKNOWN 和 late result 不产生重复有效执行或覆盖。
6. 正常闭环与补充输入闭环有正式业务证据；terminal Run 不以聊天“继续”原地恢复。
7. MVP 支持的 Markdown 内容能正确导入、填写、比较与输出；不支持内容显式报告；历史记录、表格字段及引用无静默改写或丢失。
8. 看板区分工作执行、成果检查、批准与交付；陈旧 Projection 不显示为当前权威状态。
9. 运行时失败、客户端离线、通知不可达时，任务仍可查询且状态真实。
10. 手机轻量操作与桌面专业检查各自通过适用的键盘、焦点、窄屏及安全检查。

11. Web 首次进入、切换文件和主动查看新版本均默认变化详情；身份为一行，摘要按需切换；正文不撑高整页，逐处切换及手机文档/意见切换不丢失草稿；飞书仍按摘要加链接反馈。
12. 三份采购样例保持原模板职责；内部版本批准不会填写客户签字，也不会把空白表单计为已执行活动。
13. 章节、表区、字段规则和数据变化能按受支持结构检查；正式引用绑定精确版本及稳定定位；宽表在桌面和窄屏可访问。
14. 已确认的正式适用性阻断在服务端拒绝批准；提交意见、Agent 自报完成或陈旧页面均不能清除。新版本按冻结的影响规则核验适用性，不盲目继承或重置。
15. 模板含示例数据、未替换占位符、失效引用、表格列数不一致或不支持语法时明确报告；具体阻断等级依已冻结规则，不静默生成丢失内容的成果。
16. 记录表单、手册、程序和制度均交付 Markdown。已填写表单保留必要字段、章节、说明和签批区，空白与真实业务记录可区分；XLSX 输出及模板转换不作为 MVP 验收条件。
17. 共享表单保持单一身份；范围外关联修改需获授权；模板升级不改历史成果；项目分母来自确认交付计划。

18. 工作表名称、用途和主要结构来自已锁定的公司模板；结构调整经意见与授权执行形成新候选，不直接覆盖旧版本或修改公司模板库。工作表改名/移动引起的定位变化显式处理，旧反馈不静默改绑。
19. MVP Markdown 文件按精确版本检查和批准；逐处导航覆盖章节、表区及字段，一次反馈可引用多处，不能把查看一处推导为整个文件检查完成。Excel 多工作表相关验收后置。

需要分别提供文档审查、自动化、真实 CLI/Feishu/MCP、浏览器及人工验收证据。设计原型和受控 Fixture 不能替代真实集成或业务验收。

## 11. 与 IM-06 并行的推进边界

当前独立分支只承接提案、决策收敛和可逆的设计验证。主工作区继续 IM-06，不改变其已批准 TD-01–04 或将 TD-05–07 提案视为已批准。

可先推进：明确 Q01～Q10、信息架构、无内置 Agent 的交互原型、状态展示与 Route/Capability Matrix。涉及业务语义的增量先审查对应 Spec/Test，不发布尚未 READY 的实现任务。

正式 UI/BFF 仍遵守 IM-06 与 UI-DG 的现有 Gate；真实服务器自动化遵守 Runtime Gate。任何调整实施顺序的建议须另行确认，不能通过独立分支绕过依赖。

后续实施切片按 NOW + READY 滚动形成；不在本提案中预建完整 Issue backlog。最终合入前同步 owning 权威文件、核对 IM-06 已交付契约并完成适用独立审查，不能把本提案直接覆盖到开发中的模块规格。

### 11.1 下一阶段设计顺序

当前优先顺序为设计收敛，不是可执行 Issue 清单，也不授权提前锁定框架依赖或修改主工作区：

1. **内容管线（Q01/Q08）**：按 P11/P12 最新决定推进 Markdown 模板填写、规范化内容映射、稳定定位、差异及下载表示。继续区分模板、客户适配表单及已填写业务记录；Excel 转换与工作簿结构设计后置。输入业务类别不清时先确认，不仅凭文件扩展名猜测。
2. **正式前端工程（Q06、UI-DG-001～003）**：形成框架/构建、浏览器与可访问性、BFF/会话和安全边界的具体方案。三栏方向确认不等于上述 Gate 已通过。
3. **首个审阅闭环（Q05/Q10）**：在 IM-06 适用前置条件与公共契约完成后，将三份采购文件贯通为精确版本读取、变化检查、单文件反馈、服务器受控修改、新候选、内部批准。先冻结权限和确认规则，再接真实执行；不把演示按钮转成生产接口。

本轮就绪核查以本地主工作区 `feat/157-context-source-slice-contracts` 的 `ae6242ecefb4f6e8a273ec7ff04849ab48873b64` 为代码基线；当时另有 roadmap、PR 160/163 review 文档未提交，未修改这些文件，也未将本地状态宣称为 main 或最新远端交付。查阅代码确认 TaskExecution 尚为 application/persistence foundation，新增 Source Slice / WorkOrder Draft 契约不能替代业务 Handler 与 HTTP 接入。具体能力与缺口见 §7.6；前端分支仍以 §12 的独立基线为准，正式接入前重新核查。

## 12. 基线与证据声明

提案的代码能力判断基于独立前端分支 `166b72a78221071e2f6d8eecd88effcd87f018e1`，不是当前 main/远端进展声明；正式落地前必须刷新 IM-06 契约与实现差异。此版本的路线与模块入口显示 TaskExecution 为 application/persistence foundation，不能据此宣称完整业务 Handler、MCP、Web 或真实 Runtime 自动化已可用。

本文的验收场景是前瞻要求，状态为 `NOT RUN`。当前没有真实 oh-my-pi 适配验证，不包含外部发布、生产部署或独立人工验收结论。本文须经后续设计审查，不声称已完成独立审查。

## 13. 交互原型入口

[逐文件检查原型](../prototypes/workspace-mvp/index.html) 为纯 HTML/CSS/JavaScript 演示，验证看板到独立工作页、单文件反馈、逐份批准、关联范围确认与新版本保护。状态仅存于本浏览器标签页的演示存储，可重置；不连接真实 API、Agent 或审批服务，不选定正式前端技术栈。正文依据三份真实 Markdown 模板快照；客户适配、候选变化、质量结果与确认均为合成场景，批准成功/失败/UNKNOWN 可手动模拟。用户已确认固定高度三栏、变化优先、紧凑身份及摘要/关联独立视图的布局；原型中的自动化、确认按钮和文本行号定位不构成正式技术决定。

### 13.1 核对导航与意见处理展示

用户已阶段性认可当前三栏、Markdown 填写与意见处理结果设计；批准继续收敛提案及架构，其中 React/TypeScript/Tailwind CSS/Vite 与 Monorepo 后续已明确批准，其余技术决定仍待定。用户暂时保留固定大小的核对导航：总数、当前位置和前后切换常驻，完整目录按需打开，支持独立滚动与搜索；不平铺全部变化，也不把导航选中当作检查完成。

后续原型在现有“摘要与关联”视图中展示当前候选对应的意见处理结果，变化视图只保留紧凑入口。已写入、未处理及没有关联回执分别表达，结果关联提交时的版本与返回版本；写入结果不等于检查或批准。当前采购场景为固定演示，尚未实现真实 Agent 回执、服务校验或任意自然语言理解。
