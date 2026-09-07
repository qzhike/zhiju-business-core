# Zhiju Core 业务证据与产品约束基准

日期：2026-08-08
重建日期：2026-08-12
状态：`RECONSTRUCTED / PRODUCT PRINCIPLES CONFIRMED 2026-08-12`

文档角色：业务证据与产品约束基准。本文中的现场事实用于解释“为什么这样设计”，不定义模块、Contract 或数据库结构；涉及原始报告的具体数字、客户名称和原话仍需原材料校准。

主要来源：此前对《QMS 智能化服务发展规划讨论报告（2026-08-08）》及两个月客户实践的对话归纳。

## 文档说明

本文根据此前“Zhiju Business Core Planning”对话中对客户实践、制巨员工工作方式、OpenClaw 使用情况、QMS 服务流程和产品目标的讨论归纳重建。当前项目目录中没有原始附件，因此本文不是原报告的逐字恢复。

本文的用途是作为 Zhiju Core 的业务证据和产品约束输入，回答：

1. 制巨当前真正开展的业务是什么；
2. Agent 已经带来了哪些价值；
3. 现有使用方式暴露了哪些结构性问题；
4. 下一阶段产品必须解决什么；
5. 哪些行为必须由 Human 控制，不能交给 Agent 自主决定。

本文中的“现场发现”来自既有对话归纳；“规划建议”是基于现场发现形成的产品建议。2026-08-12，用户确认本文的产品原则，并明确 MVP 使用完整双向飞书 Agent Channel、QM 弃用。涉及原报告中的具体客户、人数、项目数量、成本和原话时，仍需以后用原始材料校准。

---

## 1. 执行摘要

过去一阶段的实践已经证明，通用 Agent Harness 可以显著提高资料分析、文档起草、内容比较、问题发现和重复劳动处理效率。但是，当前方式仍以聊天、文件夹、个人记忆和单次 Agent Session 为中心，尚不能稳定承载制巨的长期 QMS 服务业务。

核心判断是：

> 制巨需要的不是一个更会聊天的 Agent，而是一套以企业、项目、受控文件、证据、审查、批准和长期知识为中心的 Agent-native 业务平台。

下一阶段应从“让 Agent 帮人写文件”升级为：

> 建立能够长期理解一家企业、持续维护其质量管理体系、保留决策与证据、协调 Human 与 Agent、并对正式成果实施质量控制的 Enterprise Digital Quality Advisor。

这意味着：

- 文件不是最终产品，企业持续可用的 QMS 能力才是产品；
- 聊天和 Harness Session 不是业务记忆，Core 中的受控事实与历史才是业务记忆；
- Agent 生成内容不等于正式交付物；
- Human 必须拥有最终审查、批准和发布权；
- 客户数据和项目数据必须严格隔离；
- 法规、企业事实、体系设计、文件和运行记录必须能够追溯；
- 确定性规则应优先于昂贵且不可完全重复的 LLM Review；
- 飞书适合作为日常入口，但复杂的项目、文档 Diff、证据和审批需要专业工作台承载。

---

## 2. 制巨 QMS 服务的实际业务链

制巨承接一家医疗器械企业的质量管理体系服务后，典型业务不是简单生成一份文件，而是持续执行以下链路：

```text
理解企业与产品
    ↓
接收和识别客户现有资料
    ↓
确认适用法规与质量体系范围
    ↓
选择制巨标准模板体系
    ↓
比较客户现状与目标体系
    ↓
形成差距分析与交付计划
    ↓
起草或修订质量手册、程序和管理规则
    ↓
生成配套记录表格
    ↓
确定性校验与独立审查
    ↓
Human 审阅、修改和批准
    ↓
发布正式版本并交付
    ↓
在后续运行、整改和新项目中持续维护
```

客户提供的资料经常不完整。可能包括：

- 产品信息；
- 质量手册；
- 程序文件；
- 管理规则；
- 与上述文件配套的记录表格；
- 组织、人员、地址、设备、供应商等基础资料。

对于每类资料，系统必须区分：

```text
已提供且完整
已提供但部分缺失
客户确认不存在
当前尚未提供
当前无法判断
不适用
```

“没有上传”不能自动等同于“客户没有”，更不能自动触发 Agent 编造或补齐。

---

## 3. 当前 Agent 使用方式

### 3.1 多 Harness 已经成为现实

制巨员工并不统一使用同一个 Agent Harness。现有习惯包括：

- Claude Code；
- Codex；
- OpenClaw；
- 对轻量或后台 Agent Runtime 的探索。

不同员工已经形成各自的使用偏好。强行统一到单一 Harness 会增加培训成本，也会丢失已有生产力。因此长期产品必须接受 Harness 可替换这一事实。

### 3.2 飞书仍是主要工作入口

员工希望继续在飞书中完成：

- 发起任务；
- 日常沟通；
- 接收进度和异常通知；
- 补充客户资料；
- 查询项目状态；
- 处理待办；
- 打开审查页面；
- 获取最终交付物。

但飞书聊天并不适合承载：

- 长文档章节 Diff；
- 多版本比较；
- 法规证据逐条核对；
- 表格单元格错误定位；
- 复杂项目依赖；
- 长任务运行详情；
- 正式受控版本的完整生命周期。

因此，飞书应是统一入口和协作表面，而不是业务数据和受控文档的唯一载体。

### 3.3 本地文件仍不可避免

员工对 DOCX、XLSX 和本地编辑工具已有成熟习惯。正式产品不能假设所有人都在聊天窗口或在线文档中完成复杂编辑。

合理方向不是禁止本地文件，而是明确：

```text
本地文件和 Harness Workspace 文件 = 草稿或交换格式

Zhiju Core 中的 ArtifactRevision = 正式受控业务版本
```

---

## 4. 已验证的 Agent 价值

根据既有讨论，Agent 已经在以下方面体现价值：

### 4.1 资料理解和整理

- 快速读取客户提供的多个文件；
- 识别文件类型、章节和相互关系；
- 归纳客户现状；
- 发现明显缺失项和冲突项；
- 为后续人工判断准备结构化摘要。

### 4.2 文件起草和修订

- 根据客户资料和制巨模板生成初稿；
- 根据 Review 意见定向修改章节；
- 比较客户文件与标准模板；
- 生成修改摘要；
- 处理大量重复性内容。

### 4.3 独立 Review

- 使用不同模型或 Harness 进行交叉审查；
- 检查术语一致性、内容完整性和跨文件矛盾；
- 形成结构化问题清单；
- 降低 Writer 自我审查造成的系统性偏差。

### 4.4 长任务和批量工作

- 连续处理多份程序文件和记录表格；
- 在夜间或后台执行资料整理、生成与 Review；
- 为员工节省机械操作时间。

这些价值说明 Agent 值得继续投入，但也说明下一阶段的瓶颈已经从“模型会不会写”转变为“业务系统能否控制、继承、追溯和验收”。

---

## 5. 当前模式的结构性问题

### 5.1 文件被误当成最终产品

如果一次服务的结果只是一批 DOCX/XLSX，那么在人员变动、模型切换、法规变化或后续整改时，过去的背景、决策和证据仍会丢失。

制巨真正需要长期保留的是：

- 企业是谁；
- 企业生产什么；
- 哪些法规适用；
- 当前体系如何设计；
- 为什么这样设计；
- 哪些事实已经确认；
- 哪些问题仍有争议；
- 哪个版本已批准并正式使用；
- 哪些证据支持某项要求；
- 历史上做过哪些修改和整改。

### 5.2 Harness Memory 不能成为业务记忆

Claude Code、Codex、OpenClaw 的 Session、Thread、Memory 或 Workspace 都可能：

- 被删除；
- 无法跨用户共享；
- 随 Harness 更换而失效；
- 缺少来源与确认状态；
- 把推断与事实混合；
- 将个人偏好错误提升为公司知识。

因此必须区分：

```text
Fact       可结构化、可确认的业务事实
Memory     对未来工作有帮助的上下文
Evidence   支持事实、判断或内容的依据
Decision   Human 或授权流程形成的业务决定
```

Agent 可以提出这些内容，但不能默认直接写入长期业务事实。

### 5.3 客户与项目隔离不足

质量管理体系服务涉及企业敏感信息。不同企业、项目、员工和 Agent Run 之间必须有明确授权边界。

不能依靠：

- 文件夹命名；
- Prompt 中的“不要访问其他客户”；
- Harness 自己的 Memory Namespace；
- 共享管理员 API Key。

正式访问令牌至少需要绑定：

```text
human principal
agent principal
enterprise
project
work order
allowed capabilities
expiry
```

### 5.4 文档修订难以审查和追溯

飞书消息或本地文件名无法稳定回答：

- 本次具体修改了什么；
- 修改前是什么；
- 谁或哪个 Agent 修改；
- 为什么修改；
- 使用了哪些客户资料、模板和法规证据；
- 哪个模型进行了 Review；
- Human 是否真正看过并批准；
- 当时交付给客户或监管部门的是哪一版。

因此 Revision 必须是一等业务对象，并且不可原地覆盖。

### 5.5 记录表格不能只追求“生成出来”

记录表格需要检查：

- 日期先后关系；
- 人员是否真实存在；
- 负责人角色是否匹配；
- 设备、供应商或产品编号是否存在；
- 表格字段是否符合上游程序文件；
- 记录之间是否相互矛盾；
- 是否出现为通过检查而制造的虚假活动或虚假记录。

这些问题不能只靠 LLM 的主观评分，必须尽量形成确定性规则。

### 5.6 长任务缺少可恢复业务状态

长任务可能暂停、失败、等待客户补资料或需要 Human 决策。单个聊天 Session 无法可靠表示：

```text
正在执行
等待输入
需要修改
审查失败
等待批准
已批准但未发布
已发布
```

任务状态必须由业务系统持久化，Agent Session 只作为可选的运行时 continuation。

### 5.7 Token 成本与上下文膨胀

如果每次任务都加载全部客户文件、全部历史聊天、全部法规库和全部模板，将导致：

- Token 成本不可预测；
- 检索噪声增加；
- Agent 更容易抓错事实；
- 不同 Harness 得到不同上下文；
- 全文重复 Review。

需要从完整项目世界模型中按 WorkOrder 生成最小、可追溯、可复现的 Execution Context。

---

## 6. 不可妥协的业务原则

### 6.1 Human 最终负责

Agent 可以：

- 读取授权范围内的信息；
- 分析；
- 起草；
- 创建新的草稿 Revision；
- 提出 Fact、Memory、Evidence 和 Decision Proposal；
- 记录 Finding 或 Review Issue；
- 提议后续任务；
- 提交审查。

Agent 不可以：

- 冒充 Human 完成批准；
- 直接发布正式文件；
- 修改已存在 Revision；
- 绕过 Quality Gate；
- 将推断直接写成已确认事实；
- 擅自扩大 WorkOrder 范围；
- 制造不存在的企业活动、人员签字或质量记录。

### 6.2 不制造虚假记录

系统可以提供：

- 空白记录模板；
- 字段规则；
- 示例数据；
- 缺失信息清单；
- 数据一致性检查；
- 待补录任务。

系统不能为了让体系“看起来完整”而虚构：

- 未发生的培训；
- 未执行的审核；
- 不存在的签字；
- 伪造日期；
- 未实施的供应商评价；
- 不真实的生产或检验记录。

### 6.3 Evidence 优先于 Agent 自信

涉及法规、企业关键信息和高风险质量决定时，Agent 的自然语言解释不能替代 Evidence。

目标追溯链应能够表达：

```text
Regulation / Standard
        ↓ supports
Business or Professional Decision
        ↓ configures
QMS Configuration
        ↓ governs
Artifact Section / Record Rule
        ↓ evidenced by
Operational Record / Approval / Release
```

### 6.4 客户数据严格隔离

默认原则是：

- Enterprise 之间不可见；
- Project 只继承被明确授权的 Enterprise 知识；
- Runtime 只获得当前 WorkOrder 所需 Context；
- Agent Token 不继承 Human 的全部权限；
- 原始客户资料只读保存；
- 正式输出通过新 Revision 产生，不覆盖客户原件。

---

## 7. 建议的风险分级

此前讨论明确提出 L1—L4 风险分级，但未取得原报告中的逐字定义。以下是根据整体业务原则重建的建议版本，需由业务负责人确认后再作为正式 Policy。

| 等级 | 典型工作 | Agent 权限建议 | 最低质量门槛 |
|---|---|---|---|
| L1 低风险 | 格式整理、摘要、非正式检索、错别字修正 | 可自动执行和提交草稿 | 结构校验、审计记录；必要时抽检 |
| L2 一般风险 | 文档初稿、模板套用、普通记录表结构生成 | 可创建 Revision，不可批准 | 确定性校验、语义 Review、Human Review |
| L3 高风险 | 法规适用性分析、核心程序修改、跨文件体系设计 | 必须限制范围并使用独立 Reviewer | Evidence Gate、Writer/Reviewer 分离、Human Approval |
| L4 关键风险 | 正式发布、监管提交、关键质量决定、真实记录确认 | Agent 只能准备材料和提出建议 | 授权 Human 明确决定、完整审计与 Release 记录 |

风险等级不应只决定使用哪个模型，还应决定：

- 可访问的数据范围；
- 可调用的 Capability；
- 是否允许联网检索；
- 是否必须使用独立 Reviewer；
- 是否必须由特定角色批准；
- 是否允许自动重试；
- Token 与成本预算；
- 是否允许发布。

---

## 8. 产品需求归纳

### 8.1 长期企业档案

系统需要形成跨项目保留的企业档案，包括：

- 企业与产品信息；
- 组织和角色；
- 质量体系适用范围；
- 已确认事实及其来源；
- 体系设计选择；
- 当前有效配置；
- 历史版本和整改；
- 当前正式文件及发布记录。

### 8.2 企业 QMS 配置档案

系统不应只保存一批文件，还需要保存“为什么形成这套体系”的结构化配置，例如：

- 法规与标准适用性；
- 不适用项及理由；
- 管理层选择；
- 专业判断；
- 文件体系和记录体系的设计决定；
- 生效版本和历史版本。

### 8.3 项目工作空间

项目需要清晰分开：

```text
Customer Baseline
客户当前真实有什么

Zhiju Reference Baseline
制巨标准和法规依据是什么

Project Deliverables
本项目最终要交付什么
```

并通过 GapAnalysis 和 DeliveryPlan 把三者连接起来。

### 8.4 受控 Artifact 与 Revision

质量手册、程序文件、管理规则、记录表格、审查报告和法规分析都应成为 Artifact。每次 Human 或 Agent 修改都产生不可变 Revision。

系统需要支持：

- 章节级 Diff；
- 修改原因；
- Evidence；
- Review Issue；
- Human 评论和修改；
- 批准；
- 发布；
- DOCX/XLSX/PDF 渲染和导出。

### 8.5 Agent-native Task Board

项目协作需要以业务 Task Board 为 Source of Truth，而不是 Coordinator Memory。

Board 至少能展示：

```text
BACKLOG
READY
RUNNING
BLOCKED / WAITING_INPUT
REVIEW
DONE
```

Human、Claude Code、Codex、OpenClaw 或未来 Runtime 都应围绕同一 Task、WorkOrder 和业务输出协作。

### 8.6 飞书入口与专业工作台

推荐形态：

```text
飞书
= 对话、通知、待办入口、轻量操作、Deep Link、最终版触达

Zhiju Workspace
= 项目、文档、Diff、Evidence、表格校验、任务详情、Human Review
```

MVP 必须建设完整双向飞书 Agent Channel；但业务逻辑不得写入飞书适配层，复杂 Diff、Evidence、表格校验和正式审批继续通过专业 Workspace 承载。

---

## 9. 产品成功指标建议

下一阶段不能只以“Agent 回答得好不好”衡量，应同时观察：

### 9.1 业务效率

- 项目资料盘点耗时；
- 交付计划形成耗时；
- 单份文件首次草稿耗时；
- Review 循环次数；
- Human 实际编辑和审查耗时；
- 从客户资料到正式交付的总周期。

### 9.2 质量

- 确定性校验失败率；
- 无 Evidence 的法规性主张数量；
- 跨文件冲突数量；
- Human 退回率；
- 发布后发现的严重问题数量；
- 错误企业事实被使用的次数。

### 9.3 可追溯性

- 正式内容能够追溯到 Evidence 的比例；
- Revision 能够追溯到 WorkOrder、Run、模型和 Context Snapshot 的比例；
- 发布物能够准确定位批准版本的比例；
- 企业关键事实包含来源与确认人的比例。

### 9.4 成本

- 每个项目、Task、WorkOrder、Run、Harness 和模型的 Token/成本；
- 缓存 Token 使用情况；
- 全文 Review 与增量 Review 的成本差异；
- 无效重试和重复生成比例。

### 9.5 采用情况

- 不同员工对 Managed Project Mode 的使用率；
- 飞书到 Workspace 的任务闭环率；
- Human 在移动端完成审查的比例；
- 跨 Harness 继续同一业务任务的成功率。

---

## 10. 建议的推进阶段

### 阶段一：业务事实与受控成果

先实现或验证：

- Enterprise / Project 基础模型；
- EnterpriseFact；
- Customer Baseline；
- Delivery Plan；
- Artifact / Revision；
- 基础 Human Review；
- 项目和版本审计。

手动验收产出：Human 可以在没有 Agent 的情况下创建项目、录入已确认事实、建立交付项、创建和比较 Revision、批准并导出一个正式文件。

### 阶段二：Harness-neutral Agent 接入

再实现：

- Project Context Projection；
- WorkOrder；
- Run / AgentResult；
- AgentPrincipal 和短期 Capability Token；
- Claude Code / Codex / OpenClaw 的薄 Runtime Adapter；
- Usage Ledger。

手动验收产出：同一个 WorkOrder 可以由不同 Harness 执行，并产生相同类型的业务输出和审计信息。

### 阶段三：质量门与增量审查

实现：

- Schema Gate；
- Business Rule Gate；
- Evidence Gate；
- Semantic Review；
- Human Approval；
- QualityProfile；
- ChangeImpact 和增量 Gate。

手动验收产出：一份“采购控制程序”从客户原版或模板建立初稿，经过修改、校验、独立 Review、Human Approval 和 Release，完整链路可追溯。

### 阶段四：企业长期知识与持续服务

实现：

- EnterpriseProfile；
- QMSConfiguration；
- 跨项目知识继承；
- Traceability；
- 历史整改和有效文件视图；
- 更完整的飞书与 Workspace 闭环。

手动验收产出：新项目可以冻结企业档案与 QMS 配置快照，在不依赖旧 Harness Session 的情况下继承历史事实、决定和有效成果。

---

## 11. 待业务负责人确认

以下内容不应由技术团队自行假设：

1. L1—L4 风险等级的正式定义和审批要求；
2. 哪些企业事实允许自动确认，哪些必须由特定角色确认；
3. 哪些文件或动作必须进入飞书审批；
4. 客户原始资料、草稿、批准版和发布版的保存期限；
5. 制巨内部模板升级后，对进行中项目和历史项目的影响规则；
6. 法规证据的授权来源、有效性和更新机制；
7. Human Approval 是否需要单人、多人或按角色分级；
8. 真实业务记录与“空白记录模板”的法律和流程边界；
9. 哪些客户数据允许进入外部模型，以及脱敏和日志保留要求；
10. 完整双向飞书 Agent Channel 的消息保留、撤回、跨项目转发和审计细则。

---

## 12. 最终结论

当前实践已经验证 Agent 对 QMS 服务具有明确价值，但继续堆叠 Prompt、Skill、聊天机器人或单一 Harness，不会解决企业知识继承、客户隔离、项目状态、正式文档版本、法规证据、人工批准和长期审计问题。

下一阶段的研发主线应当是：

> 以 Zhiju Core 承载长期业务事实和正式状态，以可替换 Agent Harness 执行具体任务，以确定性验证、独立 Review 和 Human Approval 控制质量，以飞书和专业 Workspace 提供符合员工习惯的使用体验。

本报告是 [`02-zhiju-core-architecture.md`](02-zhiju-core-architecture.md) 的业务输入，不应被 Agent Runtime、UI 或数据库设计反向覆盖。
