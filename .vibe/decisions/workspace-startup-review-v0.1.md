# 启动信息核对接口字段草案 v0.1

状态：`T2 / PROPOSED DTO CONTRACT / NOT REGISTERED / NOT IMPLEMENTED`。本草案维持已批准的三块摘要、章节文件清单、默认不选与一次显式确认布局。字段未注册，不定义私有 BFF 业务接口，也不改现行 create_project@1.0 或 ProjectContext v1.0。

## 可核对产物

[JSON Schema](workspace-startup-review-v0.1.schema.json)、[TypeScript DTO](workspace-startup-review-v0.1.types.ts) 和 [匿名样例](workspace-startup-review-v0.1.examples.json)。DTO 联合类型覆盖读取投影、确认请求、多步回执和原请求恢复；HTTP 路由、公共 Query/Command 名称、原因码和操作注册尚待 owning Delta 冻结。TypeScript 仅提供静态类型，不能代替运行时与业务校验。

## 页面读取投影

| 字段 | 页面与服务器关系 |
|---|---|
| binding | 精确 ProjectRef/CAS 版本、已接纳报告 SnapshotRef 与原 JSON 字节 SHA、候选集合/完整计划引用、输入清单 SHA、固定规则版本；不能仅靠名称或路径匹配 |
| informationGroups / candidateReviews / evidenceViews | 映射三块摘要和按需展开的依据，不增加输入区；仅返回许可内容，定位使用源对象引用，不返回服务器文件路径 |
| requiredCandidateIds | 服务器根据锁定规则和 owning 启动输入确定必需候选；不是 Runner 的判断，也不是用户可编辑项 |
| confirmationCandidateIds | 本次需显式确认的有依据候选集合；必要候选缺失/冲突时存在项目级阻塞；非必要未知候选留待后续 |
| plannedFiles / blockers | 完整文件计划、可处理/暂不能处理原因；职责保护冲突阻断整份受影响文件，不让浏览器排除部分 changeId 绕过 |
| allowedActions | 服务器结合身份、权限、状态和版本返回允许操作；UI 可控制按钮，owning 服务仍需重新校验 |

三类信息各出现一次，候选和依据只在许可范围内可见。`displayFields` 保留产品类别、名称、完整用途、产品族、型号和市场等所有需核对值；UNKNOWN 字段用 null 显示待补充，CONFLICT 的 `alternatives` 分别返回值与依据。EVIDENCED 的显示文案仍是“待确认”，不转换为已批准或已启动。

引用采用当前 common.schema 的封闭 wire shape；样例 objectType 为未注册的 `design.*`，其 UUID/Hash 也是合成值。Project、报告、候选集合、计划、请求和范围应属同一 Enterprise/Project；Profile/QMS/ProductScope 可以为同一 Enterprise 下的企业级引用；公司规则允许 Platform scope。最终还须验证登记类型、状态、Hash 域、来源水位与权限。

`reportJsonSha256` 是文件字节 Hash，Core SnapshotRef 的 contentHash 是其正式 canonicalization 域。样例不能证明二者互相等价；正式实现必须按各自域验证。

## 单次确认

确认请求绑定上述 binding、稳定 idempotencyKey、需确认候选和非空所选文件集合。页面默认无选择。文件一经选择即使用 planRef 对应的整份计划，payload 不开放任意 changeId 子集、执行器、提示词、Skill/MCP、批准人或启动 Snapshot。

服务器复核权限、PREPARING/CAS、报告/候选/规则/输入当前性与文件条件，再由可信认证入口形成 Human 决定。公司规则是固定版本；示例 requiredCandidateIds 只是虚构规则样例，不是现行产品规则注册。

## 分步回执与恢复

信息确认、项目启动、本轮范围接收分别保留 owning 事务事实和回执，不承诺一个跨模块事务。统一页面按钮可以驱动受控协调，不能在 BFF 创造业务事实。

| 回执 | 页面与恢复行为 |
|---|---|
| ACCEPTED | 信息已确认、项目已启动、范围已接收；不代表 Runner 已开始或文件完成 |
| PENDING | 原请求正在核实/处理；只能读取原请求，不能盲目重发 |
| PARTIAL | 确认或启动已成功，后续步骤明确尚未完成；保留成功事实，仅恢复未完成步骤 |
| UNKNOWN | 任一步结果未知；先查原 requestRef 和稳定键，不能新建意图或重放全部步骤 |
| FAILED | 没有已完成的确认/启动步骤；显示原因并重新核对。已完成任一步时应采用 PARTIAL，不能回滚显示 |
| STALE | 原输入、CAS 或权限失效；保留历史绑定与用户选择，读取当前状态后再显式确认。若已启动，继续使用冻结 PROJECT_START，不能恢复到 PREPARING |

STARTED 回执必须返回三类真实启动引用；RECEIVED 返回精确 workScopeRef。未知结果不携带虚构成功引用。恢复请求只携带原 requestRef、稳定键和允许动作；原候选、文件、binding 从服务器保存的原意图读取，客户端不能趁恢复替换内容。STALE 重新核对后是新意图，不是修改旧请求；已启动项目只能恢复或发起既有后续范围流程。

## 验证与冻结条件

[设计检查脚本](verify-startup-contract-drafts.py) 覆盖结构、来源别名、缺失/冲突、精确输入绑定、跨项目、文件阻塞、状态组合、部分成功和 UNKNOWN 恢复。它使用合成权限/规则与引用，不接入认证、数据库或 Runtime；不能作为正式验收或开工 readiness。

复现草案检查需要已安装 `jsonschema` 的 Python 环境：`python3 .vibe/decisions/verify-startup-contract-drafts.py`。DTO 可以单独进行 `tsc --ignoreConfig --noEmit --strict` 类型检查；它们均为定向设计诊断，不替代项目配置的 full 门禁。

字段冻结前需完成：候选类型/词表和 QMS 受控规则、准备状态输入/上下文注册、Human 决定与真实引用形成、公共查询/命令接受集、撤权/CAS/Hash/幂等与持久化故障场景。现有 UI 布局无需重新审批；Core/Runner/BFF 接入及实际业务验收仍为 `NOT RUN`。

## D14 / RD-01 公开操作映射提案

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。旧 DTO/Schema/TS fixture 保留参考；正式字段映射以 [EP Spec D14](../module-specs/Module-Spec-002-EnterpriseProject.md#d14--rd-01-准备报告与启动字段提案)、[TE scope](../module-specs/Module-Spec-003-TaskExecution.md#d14--rd-01-preparationcontext分析与初轮范围提案) 为 owning authority，public transport 见 [Delta §6](d14-rd01-first-customer-flow.md#6-兼容迁移与安全-http-映射)。

- read DTO → `project.get_startup_review@1.0`；binding 必须含 Project CAS 与独立 preparationVersion、report/source/candidateSet/plan/rule/vocabulary 的精确版本/hash，不能用 reportJsonSha256 替代 snapshot canonical hash。
- confirm DTO → `project.request_startup_confirmation@1.0`；整份默认不选，一次显式 Human 确认，candidate/value 修改不开放。server 保存完整原意图。首次准备项目与企业选择/新建通过 project.request_project_preparation 同样保存原意图。
- receipt/recovery DTO → `project.get_startup_request@1.0` / `project.resume_startup_request@1.0`；per-step state 固定 NOT_STARTED/PENDING/COMMITTED/FAILED/UNKNOWN/STALE，成功才带真实 ref/receipt。总体状态按 Delta 转换表归纳，STALE/UNKNOWN 也保留已提交 start，原键不可换集合。
- RECEIVED workScope → `execution.get_work_scope_progress@1.0`；receipt != scheduled != running != completed。所选任何阻塞文件拒绝原集合，保留草稿；用户可重新显式选独立文件，新意图不得暗改旧 request。

allowedActions 只用于展示，写入口再验当前权限。request 查询失败维持 UNKNOWN，不生成新 key。ACTIVE 已有 PROJECT_START 后不再确认替换 start，原 scope 恢复也不能换报告；新后续 scope 需另行绑定冻结 start 与当轮 plan。三组布局、章节清单、复制索取与原位补充保持既有批准；无额外意见区/Runtime 选择器。
