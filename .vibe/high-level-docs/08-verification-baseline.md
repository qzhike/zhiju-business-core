# Zhiju Business Core 验证基准

版本：v0.1
日期：2026-08-31
状态：`CURRENT VERIFICATION BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-02 TECHNICAL BASELINE COMPLETE / IM-03 SCOPED TECHNICAL ACCEPTANCE COMPLETE / IM-04 WI-01–WI-09 GIT DELIVERY VERIFIED / ISSUE #90–#98 CLOSED / IM-04 SCOPED TECHNICAL ACCEPTANCE COMPLETE / IM-05 WI-01–WI-06 GIT DELIVERY VERIFIED / ISSUE #121–#126 CLOSED / IM-05 WI-07 GITHUB DELIVERY VERIFIED PR #138 / ISSUE #127 CLOSED / IM-05 WI-08 SYNTHETIC QMS/REL-801 EXIT REVIEW DELIVERED PR #139 / EXACT-HEAD CI PASS 2026-08-31 / ISSUE #128 CLOSED / PARENT #120 OPEN / #22–#24 OPEN / UI ENGINEERING SHELL IMPLEMENTED / REAL UI INTEGRATION AND MANUAL NOT RUN / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

文档角色：统一定义设计、实现、集成和人工验收的验证口径，并集中保存跨模块验收场景。领域专属基准场景继续靠近其唯一权威设计；从字段级 API 阶段起，每个逻辑模块维护独立 `Module-Test-[ID]-[ModuleName].md`，记录模块 Unit/Contract/E2E/Manual 用例和真实结果，本文负责总索引、跨模块覆盖和结果真实性。

---

## 1. 验证结果的含义

| 标签 | 含义 |
|---|---|
| `DESIGN VERIFIED` | 文档结构、术语、引用和设计不变量静态一致；不代表实现存在 |
| `NOT RUN` | 用例已定义，但尚未执行 |
| `PASS` | 本次确实执行，实际输出与预期一致，并有命令/日志/人工记录证据 |
| `FAIL` | 本次确实执行，实际输出与预期不一致 |
| `BLOCKED` | 外部权限、环境或未决产品选择阻止执行，且已说明阻塞条件 |
| `NOT APPLICABLE` | 经明确理由确认不适用于当前范围，不得用来掩盖未执行 |

禁止：

- 把文档中存在测试表写成“测试通过”；
- 把静态检索写成运行时权限、事务或 RLS 验证；
- 把 Mock Adapter 通过写成真实飞书/Runtime/Renderer 通过；
- 把某个 Run 成功写成 WorkOrder、Task、DeliveryItem 或 Release 完成；
- 把未执行的 macOS/生产数据库/外部 Provider/人工业务验收省略不报。

---

## 2. 验证层级

### 2.1 文档与 Contract 静态 Gate

检查：文档入口、唯一权威、术语、编号、链接、模块所有权、Catalog 唯一性、Contract 兼容、Hash 自引用、状态和测试清单。结果只能是 `DESIGN VERIFIED`。

#### 2.1.1 配置化验证目标与 CI 路由

本节风险路由是批次流程尚未启用时的默认规则；启用后按 §2.1.2 分配子任务与批次出口的验证。检查内容、失败判定、持久化分片及关键清单仍沿用本节。

项目配置保留三个确定性目标，并始终选择覆盖当前变更风险边界的最小充分目标：

- `docs`：严格限于 `.vibe/` 下 Markdown 或根 `README.md` 的文档变更，检查变更路径、diff whitespace、冲突标记、Markdown fence 和仓库既有格式 Gate；设计、Contract 语义与 `NOT RUN` 边界仍由独立审查和适用的人类门禁判断，不能由该自动化结果替代；
- `code`：Draft 或 ready Pull Request 的完整变更集合仅包含明确的低风险 UI 允许路径和可选的严格文档路径；执行 clean、格式、lint、TypeScript、普通 Vitest、Workspace 独立构建与浏览器检查、Architecture 与 Contract Gate；
- `full`：main 非文档 push、Core 业务与状态机、授权/Session/Scope/真实提交与回执、共享 Contract、Migration/SQL、Persistence、依赖/构建/验证策略，以及允许列表外或混合范围；在 `code` 之上追加 PostgreSQL/Flyway Persistence Gate。Draft 状态不豁免高风险变更。

第一阶段低风险范围只包括已确认的页面样式、无业务动作的 shell 展示组件、当前仅经开发 fixture 接入的 analysis/startup 页面与局部模型、隔离的开发 fixture 文件及普通页面测试；精确允许路径由 `tools/verification/select-target.mts` 维护。本轮扩展到现有 review/execution/delivery 的匿名 fixture、组件/模型测试和浏览器用例，以及 execution/delivery 样式。不能按整个前端目录或文件扩展名统一放行。生产入口 `App.tsx`、`TrustedApp`、`trusted/`、BFF/API、真实 adapter、包含真实操作的 intake/Markdown 页面、安全 Markdown 渲染、execution/delivery 的版本绑定和回执逻辑，以及共享导航/Scope 模型仍为 `full`。新页面、新配置及职责无法确认的路径默认 `full`；允许路径接入生产业务、安全或持久化职责时，必须在同一变更中更新路由和反例，不能沿用原低风险分类。

CI 对 Pull Request 使用 base-to-head 的完整变更集合，不能仅凭最后一次提交把含代码的 PR 降级为文档 Gate。路径按 Git 的 NUL 分隔输出原样匹配，不裁剪空格、不把文件名中的反斜杠改成目录分隔符；外观相近的未知路径不能被改写成允许路径。重命名按删除旧路径和新增新路径共同分类，文件类型变化也纳入 diff；不能把高风险文件移入低风险目录后隐藏原路径。任一路径不在允许范围、空集合或 diff 不可得时 fail closed 到 `full`；非 Pull Request 的非文档事件始终 `full`。Reviewer 优先复用同一 exact revision 的可信 CI，不为重复取证再次运行相同目标；需要额外语义证据时使用 focused counterexample。绿色 `docs` 或 `code` 不表示 Persistence、外部系统、生产或人工验收通过。

同一工作流按事件类型与 PR 编号建立 concurrency group，新提交触发的运行取消同一 PR 的旧运行；不同 PR 互不取消。main 和其他非 PR 运行按各自 run id 分组，不取消或挤掉其他 main 验证。取消仍是未通过的旧修订证据，最终合并只接受当前修订的完整所选检查；`verify` 的失败、取消、缺失和意外 skipped 判定保持不变。主干非文档 full 的执行频次保持不变，不引入 nightly、跳过标签或 `[skip ci]`。

路由回归须覆盖 Draft/ready 低风险及文档混合、任一高风险/未知路径覆盖低风险、带首尾空格或字面反斜杠的真实 Git 文件名及混合变更、main 同路径 full、严格文档 main、空/失败 diff、重命名旧路径与累计 PR diff；工作流回归须覆盖同 PR 新 SHA 共享取消组、不同 PR 隔离、每个 main run 独立且禁止取消，以及 docs/code/full 的取消结果均不得通过汇总。

2026-10-31 用户确认按最新 MVP 业务链移除旧平台专用数据库测试。本节是本次测试范围调整的唯一权威；产品范围见 [MVP 可用闭环](../mvp/usable-loop.md#8-明确移出本次-mvp)。旧七模块实现、迁移、公开契约与历史证据保留，但旧平台专用持久化回归不再属于当前 `full`。当前通过不能解释为旧平台数据库回归通过；恢复旧能力或重新接入旧模块时，必须先恢复适用场景并同步 owning Module-Test。

当前 Persistence Gate 覆盖独立 `DocumentDelivery` 数据库及其真实 HTTP、Browser 和访问保护：

- 保留 `mvp-document-delivery.test.ts`、`mvp-http.test.ts`、`mvp-built-browser.test.ts`、`mvp-postgres-restart.test.ts`；保留实际事务、幂等、归属/RLS、原件与清单不可变、文件与数据库故障、UNKNOWN、并发及重启读回，不能改成内存替身。
- 原受控 Keycloak 登录、错误 issuer/audience、回调拒绝、令牌刷新和密钥轮换迁到 `mvp-controlled-keycloak.test.ts`，经过真实 MVP Core/BFF/构建 Web 和独立员工绑定；去除旧 Enterprise/Grant/Projection 准备，保留拒绝前零业务读取证据。
- 移除旧 IdentityPolicy、EnterpriseProject、TaskExecution/Context、Artifact AST/Workbook/Branch/Renderer、QualityGovernance、ReleasePublication、旧 Preparation/目录/投影专用持久化入口及仅供这些入口使用的测试辅助代码。旧七 schema 的角色/技术表/Outbox/Inbox/事务 runner 回归随之退出；这不取消新 MVP 的访问保护、原件保护、精确版本、事务与恢复要求。
- 普通 Unit/Contract、共享 OIDC/BFF 安全和输入格式安全测试继续执行；本次不按旧模块名称批量删除普通测试。移除的旧隔离执行测试工具不再要求自身生命周期回归，仍被保留测试使用的辅助代码继续保留。
- M2/M3 的意见、计划、阶段版本、上游返工和冻结交付包，随真实接入在 owning Spec/Test 中补齐；已有 B1 测试不能代替完整 MVP 或 bopu 真实验收。

Gate 继续验证锁定 PostgreSQL/Flyway 镜像和版本，但只应用 `modules/document-delivery/migrations`，与 MVP 实例初始化使用同一迁移目录；不再应用旧七模块迁移或 seed V6002 Provider Result。空库迁移、第二次 migrate 成功且无待执行项、完整迁移 history 前后相同、异常清理仍是必需检查。每个业务测试使用隔离的 MVP database；同一临时实例内文件继续串行，避免数据库重建和角色负例相互干扰。

普通 Vitest 只收集无需数据库的测试；新增纯校验不得放进被普通配置排除的 `tests/persistence/`。完整/分片数据库验证不允许意外 skipped、失败或取消；聚焦诊断只能显式选择文件并标明不是完整 Gate。`docs/code/full` 路由、主干准入和批次要求不变，验证策略修改仍需 `full`。

CI 保留三个独立 runner 和现有检查名：分片 1 为 MVP custody，分片 2 为真实 Keycloak，分片 3 为 HTTP、built-browser、PostgreSQL restart 及新增文件。每个分片独立完成镜像检查、MVP 空库迁移和 no-op；全部文件必须恰好分配一次。明确路径不存在、重复分配、非法分片或空集合均失败；最终核对实际执行文件集合，不能只核对总数。CI `checks` 预算为 30 分钟，持久化分片预算为 60 分钟；本地 `full` 仍顺序执行 code 与完整不分片 persistence。

`tools/persistence/critical-cases.json` 独立列出当前五个 MVP 入口的叶级用例名称。保留原四文件的全部用例，受控 Keycloak 场景按 MVP 入口重绑定。移除旧 96 项 Context/controlled-exit 清单；当前清单不得由本轮实际收集反推。缺文件、缺用例、重复、未审查的增删/改名/移位、失败或跳过均拒绝 Gate；普通测试通过真实 Vitest 子进程验证这些拒绝路径及聚焦边界。合法变化须同步审查清单和 MVP01 Test。

数据库验证继续流式输出文件/测试开始、结束和耗时，长测试及 setup/cleanup 每 30 秒输出当前项；等待诊断只允许连接状态、等待事件、阻塞 PID 和事务持续时间，禁止 SQL、凭据或业务 payload。容器与连接必须在成功及失败路径清理；本次不缩短业务期限或跳过真实恢复等待。

CI 的 `select` 先按相同 base-to-head 风险路由选择目标；`checks` 执行 docs 或完整 code 检查，`persistence-1/2/3` 仅在 full 时调用同一复用工作流，分别在独立 runner 执行固定分片。数据库任务先安装受控 Chromium 并 clean build 自己的 workspace libraries；不重复普通测试、格式、lint、Architecture 或 Contract Gate，也不把同一数据库内文件并行化。原 `persistence` 名称保留为汇总，要求三个明确分片全部 success，缺失、失败、取消、非法结果和意外 skipped 一律拒绝。本地配置的 full 仍是 code + 不分片 persistence 的完整顺序验证。原 `verify` 检查作为 always 汇总，必须确认 select/checks 成功，full 的 persistence 成功，docs/code 的 persistence 为预期 skipped；失败、取消、缺失/非法结果、未知目标和意外跳过不能通过。文档任务传入同一 BASE_SHA/GITHUB_SHA 边界；根 `vitest.persistence.config.ts` 单独变化也必须 full。分片带来的实际 CI 耗时改善须由调整后的远端运行验证，不能由历史耗时相加推定已达成。

Workspace 工程外壳的独立 Web/BFF 构建、生产安全拒绝、TS/TSX 与应用依赖边界反例，以及实际构建匿名开发制品的受控 Chromium 旅程，接入 `code/full` 的普通检查。CI 为该检查安装锁定 Playwright 的 Chromium；它不替代真实 OIDC/业务 HTTP/Runner、Windows/macOS Chrome/Edge 支持矩阵、生产或独立人工验收。生成的匿名截图保持本地忽略，执行证据进入 Issue/PR。

Workspace 浏览器验证默认使用 4 个 worker，保持 `fullyParallel: false`：开发制品测试文件之间并行，同一文件内顺序执行。`workspace:check` 的生产检查显式使用 1 个 worker。每例继续使用独立 BrowserContext；跨文件可变资源须隔离，真实剪贴板场景保留在同一文件内串行执行。该调度调整保留完整用例、断言、视口与可访问性组合，既有超时和零重试策略不变；不能把缩小用例集合或跳过失败算作提速。

#### 2.1.2 批次交付第一阶段

本节落实[已批准的批次设计](../decisions/batch-integration-ci.md)。共享 Vibe 只解释项目声明的阶段；本项目以仓库变量 `VIBE_BATCH_DELIVERY_ENABLED` 精确等于 `true` 为远端启用条件。缺失或 `false` 保持 §2.1.1 路由，非法值拒绝准入。设计批准、本地实现和本地验证不等于 GitHub 已启用。2026-10-23 用户已授权第一阶段远端启用及平台验收，main/batch 保护和变量已配置；本次修订时平台验收仍进行中，最终批次与合入后 main full 尚待收口。该日期快照及最终执行证据见 [批次 PR #316](https://github.com/qzhike/zhiju-business-core/pull/316)，实际路由仍以远端变量及生效保护为准。

启用后，普通业务、UI 与紧急修复 PR 均先进入同仓库的 `batch/<goal>`；`<goal>` 使用小写字母、数字和分隔单词的连字符，可以只有一个子 PR。子 PR 完整累计 diff 仅含严格文档时为 `docs`，包含明确业务源代码、业务测试或 migration 路径时为 `code`，同时仍须执行 Issue 本阶段约定的事务、权限等聚焦检查。工程配置、依赖、构建、验证策略、未知和混合工程路径保留 `full`。允许路径由 `select-target.mts` 维护，不能为省略验证放宽路径。直接进入 main 的普通业务 PR 即使 full 通过也不准入；严格独立文档是例外，启用前有限的工程引导 PR 仍走旧规则 full。

`batch/<goal> → main` 一律 `full`，包括 UI-only 和 docs-only 批次。批次冻结后先同步当前 main，记录 base SHA、head SHA、实际测试合并 SHA 与 tree，并完成最终语义审查。`ci.yml` 对非 main PR 独立运行，对 main push 保留运行，并可被 `main-admission.yml` 的 main PR 流程复用。主干准入等待本次完整验证结果后才执行，不在子 PR 上产生可被误用的 skipped 同名主干检查。PR 的 `edited` 事件重新验证，包含改 base 的情形；目前对其他元数据编辑也保守重跑，不通过跳过整个必需 job 优化。

验证汇总拒绝选中检查的失败、取消、缺失与意外 skipped，full 必须含三个持久化分片。准入脚本还核对本地 checkout、合并候选的双亲、事件载荷以及只读 API 返回的当前 base/head/merge SHA 和 open 状态；无法读取或边界变化时拒绝旧证据。普通 PR 与 main PR 都绑定当前候选，不能把子 PR 旧绿灯用于改目标后的主干合入。不同 PR 的 concurrency 隔离，同 PR 新运行取消旧运行；每次 main push 独立验证。最终检查与实际合入之间的竞态仍需分支保护的 up-to-date 要求和合入时精确 head 校验，本地脚本不能代替平台保护。

第一阶段合入 main 后仍执行 full；批次合入即使最终只剩文档也不降级。仅当 main push 的完整 diff 为严格文档、GitHub 只读查询能唯一关联到同 SHA 已合并的独立非批次文档 PR，且其累计 diff 也为严格文档时，保留独立 docs 路由；来源未知、关联失败或不一致均退回 full。这只判断文档来源，不复用其他运行的 full 结果。第二阶段的同代码树证据复用、跨 SHA 免跑和自动生成通过状态均未实现。

失败处理与 Review 收口遵守设计 §4–§5：批次出口失败时保持冻结，区分实现缺陷、验证缺陷、环境问题和新设计决定；修复通过同批次补丁 PR、阶段检查与独立审查进入，新候选重新 full。相同候选的临时环境故障首版重跑整个 workflow，不拼接不同 attempt 的分片成功。选路、检查、每个持久化分片及汇总都输出实际执行的 attempt；汇总与主干准入要求这些输出属于当前 attempt，只重跑失败任务或单独重跑准入不能沿用旧成功。移除子任务必须复核依赖、撤回受影响批准并更新批次接受标准。main 合入后 full 失败时暂停后续批次最终合入及发布；允许从故障 main 建立单 PR 恢复批次，恢复仍执行合入前后 full。环境恢复和故障归因不代表业务验收通过。

正式 `.vibe/reviews/pr-<number>/Review.md` 在冻结最终候选前记录语义发现、处置、阶段与目标；最终 SHA/检查确认留在 PR review/comment 中，不为回填成功日志产生新提交。实质发现和修复仍更新文档、重新审查并验证受影响候选。子任务进入集成分支不等于产品目标交付；main 与其必需 post-merge full 完成后才按授权更新真实交付事实。本地尚无 PR 时不伪造编号或预写正式批准。

配置目标 `delivery` 用于路由、准入、累计 diff、候选漂移、取消与证据来源的聚焦回归；验证策略改动仍必须执行 `full`。启用顺序为：先以变量关闭状态交付工作流并验证真实 check 名称；为 main 配置实际主干准入与对应验证检查、up-to-date 和必需审查，为 batch 配置实际子 PR 验证与审查；验证保护及重定向负例后才设置变量为 `true`。检查名称以真实 GitHub 运行读取结果为准，不能仅凭本地 job id 宣称设置正确。已授权的平台验收必须完成实际运行及负例核验，不以本地测试或仅启用变量替代；单人审查的承载方式与平台自动门禁按下述约束区分。

#### 远端启用操作约束

远端保护以 GitHub 实际匹配到的规则为准：main 的必需检查是 `verification / verify` 与 `main-admission`，batch 子 PR 的必需检查是 `verify`；检查来源绑定 GitHub Actions，不接受同名的其他来源。两类目标都要求 PR、当前基线验证及未解决对话清零，不配置管理员或应用旁路，第一阶段使用普通 merge commit。

项目按用户确认的单人开发方式执行审查：独立 Agent 审查、正式 Review 文档与人的合入授权仍然必需，人的授权可来自当前会话并在 PR 中记录其范围。GitHub 不支持作者正式批准自己的 PR，因此 main 和 batch 的 `required_approving_review_count=0`、`require_last_push_approval=false`；不要求第二个账户，不伪造 formal approval。平台自动执行 PR、CI 与基线门禁；Agent 审查和人的授权由交付流程核对，不能声称 GitHub 自动强制了这两项。候选、目标或基线变化后仍须重新判断审查和授权适用性，不将旧结论直接沿用到新组合。

普通 `batch/<goal>` 的起点必须是已完成 main full 的精确 main 修订。main full 失败后的专用单 PR 恢复批次保留上述窄例外：记录故障修订与最近已验证基线，不扩展业务，恢复候选合入前后仍须 full。batch 创建豁免状态检查仅用于建立合法起点，不能夹带未经审查的变更；后续更新仍须经 PR、阶段检查与审查。GitHub 规则无法证明创建来源，执行者与独立 Reviewer 必须核对普通或恢复批次的起点身份及范围。活跃批次禁止删除和强推；批次交付后，清理仅对获授权的确切已完成分支处理，不为清理撤销其他批次保护。

启用变量不会自动重跑既有 PR。切换前逐一核对已有 main PR 的必需检查、当前候选和新门禁适用性；旧的关闭模式成功不能作为启用后业务直达 main 的证据。未纳入本次迁移范围的业务 PR 保持阻挡，另行确认批次和验收归属后再改 base，不自动搬运其他执行上下文的工作。

若平台验收暴露阻塞，先将 `VIBE_BATCH_DELIVERY_ENABLED` 设为 `false` 并回读，保留 main/batch 保护及必需检查；按实际失败范围恢复与复验，不能用删除 ruleset、增加旁路或放宽测试来恢复交付。成功、失败及回退证据记录在实际试点 PR，正式 Review 仍按本节既有规则收口。

### 2.2 Unit

针对 Aggregate、Value Object、状态机、Invariant、Evaluator、Canonicalization、Reference Validation、Authorization 和纯映射逻辑。应覆盖成功与拒绝路径。

### 2.3 Contract

针对：

- Command/Query/Event Schema 与 Major/Minor 兼容；
- Canonical Payload 和跨语言 Hash Fixture；
- Typed Reference 强度、Scope、Hash、Lifecycle、Authorization、Purpose；
- Project Context、WorkOrder、AgentResult、RAS/ABS/RRS；
- 飞书/Runtime/Renderer Adapter 与 Core Contract 的 Anti-Corruption 映射。

### 2.4 Persistence/Integration

使用真实 PostgreSQL 行为验证：Migration、Constraint、RLS、Role、CAS、Lease/Fencing、Outbox/Inbox、JSONB/Hash、对象存储 Link、Replay 和并发。仅用内存 Repository 不能完成该 Gate。

### 2.5 E2E

从公开 Application Capability 驱动完整流程，不能直接写数据库制造中间状态。必须验证 Human/Agent 权限、真实状态层级和最终 Traceability。

### 2.6 External/Manual

真实飞书双向消息/文件/卡片、真实 Runtime 调度、Renderer 文件可用性、对象存储权限、人工质量审查、备份恢复和运营故障处理分别记录。它们不能被离线测试代替。

### 2.7 Browser UI

针对真实构建制品与批准浏览器验证：OIDC/BFF Session、CSRF/Origin/Cookie、公开 API mapping、ViewModel 状态真实性、跨 Scope、重复提交、断网/UNKNOWN/reconciliation、XSS/CSP、敏感信息、键盘/焦点/语义和完整 Human 操作路径。组件 Unit/Story 或 Mock API 不能完成 Browser E2E、安全、可访问性或人工 Gate。

### 2.8 首版可用验收与任务粒度

后续 backlog 规划默认采用共享 Planner 的 lean delivery 原则：每条任务包含一个可独立交付、可验证的完整目标，验收以首版可用为准，通过真实反馈决定后续完善。

- **目标完整**：功能任务应让用户完成一个明确动作并理解结果，包含为此必需的技术层。仅当包含多个独立交付目标或无法在预期迭代内完成时考虑拆分；实现步骤多、涉及多层或仍可打磨，不单独构成拆分理由。必须先行的基础设施任务应说明它支撑的下一个具体结果，工程交付不等于用户已可使用。
- **允许有限成熟度**：在约定范围内，可以接受支持范围有限、界面粗糙、手动恢复和影响有限且可恢复的缺陷。重要限制写入已有 Scope 或 Non-goals；不默认要求通用扩展、自动恢复、完整边界组合或未经当前需求证明的规模优化。
- **保留交付底线**：目标无法完成、重大结果错误、数据丢失或损坏、越权、其他可信的严重风险及违反明确项目要求仍是阻塞项。Human-only 批准/发布、Enterprise/Project 隔离、版本与事实真实性、适用的事务/幂等和公共契约要求继续有效；可优先用简单安全的实现或有限支持范围完成目标。
- **验收清楚且稳定**：用少量必要的可观察 PASS/FAIL 条件判断当前目标。验收一旦约定就必须满足；需要放宽已有条件时，明确调整范围或验收并遵循适用授权，不得为让实现通过而静默删减。规划新任务时引用当前相关 Module Spec/Test，不把整个模块或未来阶段的场景清单复制为当前阻塞项。
- **审查按约定执行**：Reviewer 不把可选打磨、后续能力或已明确接受的可恢复限制提升为阻塞项。当前验收失败、适用契约违反、严重缺陷和非预期回归仍按现有规则处理。
- **范围与证据分开**：本规则影响后续规划和明确重新约定的验收，不自动重写已有 Issue、已批准设计或里程碑退出条件。必需的 HL-Spec、Module-Spec、Module-Test、正式审查及审批要求继续适用；配置的验证目标与执行命令不变，未执行的外部/人工验证继续标为 `NOT RUN`。

---

### 2.9 缩编 MVP 正式模板与闭环验收

2026-10-26 更新的 [MVP 可用闭环](../mvp/usable-loop.md#7-验收条件)是本版验收范围；[mvp-v1-release](../mvp/mvp-v1-release.md)维护当前里程碑和共用 checklist。旧模块验收保留原证据边界，不因历史合成/fixture 检查通过而认定新闭环可用。

- 真实业务验收必须基于独立 Runner 内的正式模板。更新后的 PRD 指定目录 `/Users/galendai/repo/qzhike/zhiju-doc-artifacts`，模板在 `template/`；Core 不修改正式包，不用演示模板替代真实验收。M1 可以 mock data 确认 UI 交互，页面和产物必须明确标注模拟，内容业务验收保持未验证。
- 验证绑定 Core 修订、Runner 规则和模板快照、客户输入及实际结果。故障材料由正式基准可追溯派生，原包只读；Runner 更新后按影响重验，不沿用失配证据。
- 小规模验证用于先闭合 MVP-01–09；本版发布按用户指定的完整 bopu 输入验收 MVP-10，包含嵌套 RAR 内全部文档，不另设 300+ 份数量门槛。输入摘要、完整清单、处理去向和人工结论均须可核对，未读或遗漏不能当作完成。
- 必须覆盖指定输入的 ZIP/嵌套容器处理、DOCX/Markdown、计划确认、范围内直接修改、扩大范围再确认、质量手册 → 控制程序 → 管理制度及记录表单、上游变化、必要恢复和精确交付。既有 XLSX 接收契约及其测试要求保留，该样本不证明 XLSX 业务处理已通过。
- 真实 Harness、文件内容与人工业务验收分别取证；目录存在、结构校验、单文件生成或模型自报成功不能替代。尚未运行的验收保持 `NOT RUN`。

本次按用户明确决定更新产品验收对象和阶段，不改变 §2.1.1 的配置目标、脚本或 CI 路由。文档结构检查只能证明文本完整性，不能视为正式模板下的产品验证。后续实现前将适用场景放入 owning Module-Test 并对齐真实业务依赖；不以减少旧模块范围为由静默降低门禁。

## 3. 设计场景总索引

| 场景集 | 唯一位置 | 数量 | 当前实际状态 |
|---|---|---:|---|
| Domain Aggregate 场景 | [`04-domain-model-v0.1.md`](04-domain-model-v0.1.md) | 105 | `NOT RUN` |
| Cross-Aggregate 场景 | [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](05-cross-aggregate-consistency-module-boundary-v0.1.md) | 17 | `NOT RUN` |
| Core Contract 场景 | [`03-core-contracts.md`](03-core-contracts.md) | 20 | `NOT RUN` |
| Typed Reference/Envelope 场景 | [`06-typed-references-contract-catalog-v0.1.md`](06-typed-references-contract-catalog-v0.1.md) | 12 | `NOT RUN` |
| PostgreSQL Logical Model 场景 | [`07-postgresql-logical-model-v0.1.md`](07-postgresql-logical-model-v0.1.md) | 24 | `NOT RUN` |
| 跨模块验收场景 | 本文第 5 节 | 57 | `NOT RUN` |
| API Module Test 场景 | [七份 Module Test](../module-tests) | 63 | 7 个 Design Gate `DESIGN VERIFIED`；其余 56 个 `NOT RUN` |
| Feishu Channel 专项场景 | [`Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md) | 32 | 4 个 Design Gate `DESIGN VERIFIED`；其余 28 个 `NOT RUN`；用户已指示进入下一阶段 |
| Runtime Adapter 专项场景 | [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md) | 32 | 4 个 Design Gate `DESIGN VERIFIED`；其余 28 个 `NOT RUN`；用户已指示进入实施计划阶段 |
| Workspace UI Experience 场景 | [`Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md) | 15 | 1 个 Design Gate `DESIGN VERIFIED`；其余 14 个 `NOT RUN` |
| 合计 |  | 377 | Workspace UI 工程外壳已实现；真实集成/外部/人工场景仍独立保持 NOT RUN |

数量用于发现遗漏，不代表覆盖率或通过率。后续实现可以拆分出更多测试，但不得删除业务语义等价的失败路径。

---

## 4. 基准完整性 Gate

| ID | 检查 | 通过条件 |
|---|---|---|
| V-DOC-001 | 文档集合 | `.vibe/high-level-docs/` 仍只包含一个入口 `HL-Spec` 和 `01`—`08` 八份专题高层基准，共九份；阶段文档位于明确的 API、Feishu、Runtime、Module Spec/Test 目录 |
| V-DOC-002 | Agent 入口 | `HL-Spec` 明确阅读路由、冻结规则、状态口径、变更纪律和下一阶段 |
| V-DOC-003 | 唯一权威 | 每份基准声明权威范围；同一模块职责不由第二份文档维护 |
| V-DOC-004 | 模块边界 | 七模块在架构基准中都有职责、所有权、非职责、端口类别、依赖、持久化边界和验收锚点 |
| V-DOC-005 | 无循环写依赖 | 每个公开写 Command 只有一个 Owner；无共享 Repository、跨 Schema 写或跨模块业务外键 |
| V-DOC-006 | Domain 完整性 | Aggregate、Entity、状态、Command、Event、Invariant、权限和失败场景可定位 |
| V-DOC-007 | Contract 完整性 | 四个 Core Contract、Typed Reference、Envelope、兼容性和 Canonical Hash 规则可定位且无自引用 Hash |
| V-DOC-008 | Catalog 唯一性 | 当前 201 个公开 Contract 名称全局唯一，namespace 与模块 Owner 一致；冻结 v1.0 历史基线仍为 200 |
| V-DOC-009 | 持久化边界 | 七个权威 Schema + Projection；关系/JSONB/对象存储；RLS/Role；Outbox/Inbox 均只有一个权威定义 |
| V-DOC-010 | Human/Agent 边界 | Agent/actingFor 不可 Approval 或 Release Authorization；Human 不能绕过 Mandatory Gate |
| V-DOC-011 | 状态层级 | Run、WorkOrder、Task、DeliveryItem、Revision、Approval、Release、Effective 不相互冒充 |
| V-DOC-012 | 飞书边界 | MVP 完整双向；消息/附件/卡片不直接成为业务完成、Approval 或 Formal Release |
| V-DOC-013 | QM 弃用 | QM 只可作为明确弃用说明出现，不得成为 Runtime、Adapter、Scope、Task 或依赖 |
| V-DOC-014 | 链接与格式 | Markdown 链接可达、代码块闭合、编号唯一、无冲突标记或过期状态 |
| V-DOC-015 | 状态真实性 | 所有未执行实现/外部/人工用例保持 `NOT RUN`，不得因静态审计改为 PASS |
| V-DOC-016 | Module 文档集合 | 七个 Business Core 模块各有且只有一份 `Module-Spec` 和一份 `Module-Test`；Workspace UI 另有一份 Experience Module Spec/Test，不混入 Business Core Owner/Schema/Catalog；ID/ModuleName 一致，测试含输入、预期、实际和结果 |
| V-DOC-017 | API Catalog 覆盖 | `06` 的当前 201 个公开 `name@1.0` 在七份 Module Spec 中各出现一次，集合差异为零，namespace 与 Owner 一致 |
| V-DOC-018 | API 字段完整性 | 每个 Command 有 target/mode、payload、authorization/拒绝语义；每个 Query 有 payload/result/consistency；每个 Event 有最小已发生事实 payload |
| V-DOC-019 | API 安全边界 | Agent/actingFor 不能 Approval/Release Authorization；Sensitive External ID 不进入 Event/普通错误；latest/workspace/session/message 不冒充强引用 |
| V-DOC-020 | API 文档链接 | HL、共享 API、七份 Module Spec 与七份 Module Test 的相对链接可达，无冲突标记或未闭合代码块 |
| V-DOC-021 | Feishu Channel 文档集合 | 专项 Contract、Test、Task Plan、Verification Report 各一份，均位于 `feishu-channel-contract-v0.1/` 并由 HL 与 IntegrationGateway Spec/Test 路由 |
| V-DOC-022 | 飞书协议映射 | 允许的飞书事件/API、外部幂等键、原始字段、Core API 目标和未知协议处置均明确，且不新增业务 Owner |
| V-DOC-023 | 飞书安全边界 | Webhook/长连接认证边界、身份映射、最小权限、敏感标识、卡片 nonce、附件 Staging 和 Credential 禁存规则明确 |
| V-DOC-024 | 飞书业务边界 | 普通消息/附件/卡片/发送回执不冒充 Fact、Answer、Approval、Release、Task Completion 或 EffectiveBinding |
| V-DOC-025 | Runtime Adapter 文档集合 | 专项 Contract、Test、Task Plan、Verification Report 各一份，位于 `runtime-adapter-contract-v0.1/` 并由 HL、TaskExecution/IntegrationGateway Spec/Test 路由 |
| V-DOC-026 | Runtime 映射 | Execution Package、Dispatch、Event、Result、Usage、Cancel、Resume/Retry 与现有 Core API 目标明确，不新增业务 Owner |
| V-DOC-027 | Runtime 安全边界 | 单 Run Capability、Workspace/Sandbox、Secret、Network/Tool、Lease/Fencing、late result、Chain of Thought 禁存规则明确 |
| V-DOC-028 | Runtime API proposal 隔离 | 6 个 additive Command 在审核前不进入 200 项 Catalog/Module 基准，也不允许实现绕过 public port 直写 Repository |
| V-DOC-029 | Implementation Plan 文档集合 | Milestone Plan、Technology Baseline、Deployment/Security Baseline、Task Plan、Verification Report 各一份，位于 `implementation-milestone-plan-v0.1/` 并由 HL 路由 |
| V-DOC-030 | Implementation 决策隔离 | IM-00 至 IM-09 的 10 个 Core/Adapter/Operations 里程碑与独立 IM-UI-01 共 11 个计划节点可定位；6 个 IM 决策 Gate 与 3 个 UI 决策 Gate 状态分开；未选技术栈、物理参数和 proposal 不得被静默事实化 |
| V-DOC-031 | 私有化部署与认证边界 | Ubuntu 单机明确非 HA；MicroCeph/OpenBao/Keycloak 责任分离；Authentication 不冒充 IdentityPolicy Authorization；Fake 不完成 Conformance Gate |
| V-DOC-032 | Workspace UI 非所有权边界 | UI/BFF 只消费公开 API/Projection；不拥有 Business Core Contract、Schema、Repository、Authorization、Approval、Release 或 Completion |
| V-DOC-033 | Workspace UI 状态与安全真实性 | UNKNOWN/STALE/epistemic state 不被折叠；Human-only 由服务器重验；Session/CSRF/XSS/Scope/敏感信息/Accessibility/Manual Gate 可定位且未运行项为 NOT RUN |

---

## 5. 跨模块验收场景

这些场景用于保证模块实现不会只满足局部 happy path。实际实现时可以拆成多个测试，但场景 ID 和业务预期应保持可追溯。

### 5.1 IdentityPolicy

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| IP-U-001 | Unit | Agent actingFor 质量负责人请求 Approval Capability | 拒绝 Human-only Capability | NOT RUN |
| IP-U-002 | Unit | Project A 用户读取 Project B | 拒绝跨 Project/Enterprise 访问 | NOT RUN |
| IP-U-003 | Unit | 相同外部身份映射到冲突 Principal | 进入冲突处理，不按最后写入覆盖 | NOT RUN |
| IP-U-004 | Unit | Agent ActorSnapshot 携带 actingFor Human 并请求 Human-only Capability | 保留 AGENT 身份并拒绝，不按 actingFor 提权 | NOT RUN |
| IP-U-005 | Unit | 同 Provider/Account/ExternalId 的加密值重复登记 | Lookup Hash 唯一约束阻止第二个有效映射 | NOT RUN |
| IP-E-001 | E2E | 已绑定飞书用户发起 Task 后执行授权检查 | 映射真实 HumanPrincipal，Command 保存 Authorization Context | NOT RUN |
| IP-E-002 | E2E | Human 角色被撤销后查看历史 Approval | 新命令被拒绝，历史角色快照和 Approval 保留 | NOT RUN |
| IP-E-003 | E2E | Enterprise A 数据库上下文读取 Enterprise B AuthorizationDecision | RLS/Scope 拒绝，不泄漏跨企业数据 | NOT RUN |

追加覆盖：角色并发、授权过期、Capability Secret 泄漏防护、break-glass 审计和 Enterprise 隔离。

### 5.2 EnterpriseProject

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| EP-U-001 | Unit | 未收到培训程序，Agent 请求 `MISSING_CONFIRMED` | 拒绝，保持 UNKNOWN/NOT_PROVIDED | NOT RUN |
| EP-U-002 | Unit | 未批准 DeliveryPlan 请求激活 | 拒绝 Human Approval Requirement | NOT RUN |
| EP-U-003 | Unit | 直接设置 DeliveryItem COMPLETED | 拒绝，Completion 必须派生 | NOT RUN |
| EP-U-004 | Unit | Context Builder 收到 `latest` Baseline 或 aggregateVersion 作为业务版本 | 拒绝并要求精确 VersionedRef | NOT RUN |
| EP-U-005 | Unit | Project enterprise_id 与 BaselineVersion Scope 不一致 | 组合约束/写入验证拒绝 | NOT RUN |
| EP-E-001 | E2E | 采购程序材料进入系统直到 DeliveryItemActivated | 每一步保留版本、Human 决定与输入快照 | NOT RUN |
| EP-E-002 | E2E | DeliveryItem 所需 ReleaseCompleted 到达 | 精确 Criteria 满足才产生 CompletionSatisfied | NOT RUN |
| EP-E-003 | E2E | 已激活 CB-003 后创建 CB-004 | 新版本和当前指针更新；旧 Context 仍解析 CB-003 | NOT RUN |

追加覆盖：Baseline 并发激活、Impact Replay、跨项目引用、消息撤回与材料保留 Policy。

### 5.3 TaskExecution

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| TE-U-001 | Unit | READY WorkOrder 请求扩 Scope | 拒绝并要求新 WorkOrder | NOT RUN |
| TE-U-002 | Unit | 两个 Dispatcher 竞争 active Run | 仅一个 Lease/fencing token 有效 | NOT RUN |
| TE-U-003 | Unit | Terminal Run 接收不同的第二个 final Result | 拒绝并隔离 Replay | NOT RUN |
| TE-U-004 | Unit | READY WorkOrder 的 specificationHash 不匹配 | 拒绝执行，不物化 Runtime Prompt | NOT RUN |
| TE-U-005 | Unit | 两事务同时创建同 WorkOrder active Run Claim | 唯一 Claim 只允许一个成功 | NOT RUN |
| TE-E-001 | E2E | final BLOCKED_INPUT 经飞书回答 | 新 ContextSnapshot、新 Run；旧 Run 不恢复 | NOT RUN |
| TE-E-002 | E2E | Runtime timeout 后执行 Policy fallback | 新 Run/Adapter；旧 Run 和 Usage 不变 | NOT RUN |
| TE-E-003 | E2E | 同 Run 重放相同 Hash 后再提交不同 Hash AgentResult | 相同 Hash 返回原记录；不同 Hash 进入冲突审计 | NOT RUN |

追加覆盖：取消竞态、late result、Budget、Lease 过期、Capability handle 过期和 Provider Usage 缺失。

### 5.4 Artifact

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| AF-U-001 | Unit | 修改 SEALED Revision | 拒绝 Revision Immutable | NOT RUN |
| AF-U-002 | Unit | 不同 Artifact Revision 作为 Parent | 拒绝 Cross-Artifact Parent | NOT RUN |
| AF-U-003 | Unit | 两个 Release 竞争同 Purpose EffectiveBinding | 仅 expectedVersion 成功者建立 Binding | NOT RUN |
| AF-U-004 | Unit | ContentAddressed RevisionRef ID 正确但 Hash 错 | 拒绝，不能读取当前内容替代 | NOT RUN |
| AF-U-005 | Unit | SEALED Revision 对象 Key 不变但请求修改 Content Hash | 不可变保护拒绝，必须创建新 Revision | NOT RUN |
| AF-E-001 | E2E | 两个 Agent 从同 Head 并行修订 | 形成 Branch，不 last-write-wins | NOT RUN |
| AF-E-002 | E2E | 已 Release 旧版本后创建新 Draft | 旧 Approval、Release、EffectiveBinding 均不变 | NOT RUN |
| AF-E-003 | E2E | 两事务以同 expected Head 移动 Branch | 一个 CAS 成功，另一个形成可解释冲突 | NOT RUN |

追加覆盖：Canonical Hash、Merge DAG、Representation 校验、有效期排他约束、归档和对象保留。

### 5.5 QualityGovernance

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| QG-U-001 | Unit | FAIL GateResult 请求改 PASS | 拒绝，要求新 Result | NOT RUN |
| QG-U-002 | Unit | 作者验证自己的修复且 Policy 要求分离 | 拒绝职责分离冲突 | NOT RUN |
| QG-U-003 | Unit | Agent actingFor Approver 提交 Approval | 永久拒绝 | NOT RUN |
| QG-U-004 | Unit | RevisionAcceptanceSnapshot 混入 Release Readiness Render Gate | 拒绝 evaluationStage 不匹配 | NOT RUN |
| QG-U-005 | Unit | 更新既有 GateResult outcome 或 targetHash | 不可变保护拒绝；重跑插入新 Result | NOT RUN |
| QG-E-001 | E2E | REV-002 FAIL 后 REV-003 修复 | Issue 历史保留，新 Gate/Verification 绑定 REV-003 | NOT RUN |
| QG-E-002 | E2E | 已批准 Revision 的 Evidence 撤销 | Approval Readiness 丢失并触发 Release Impact | NOT RUN |
| QG-E-003 | E2E | Agent Snapshot 伪带 Human Ref 写 Approval Decision | Identity/Auth/Human-only 组合校验拒绝并审计 | NOT RUN |

追加覆盖：Gate DAG、ChangeImpact 复用、多角色/多级 Approval、Request 过期、Profile 版本迁移和上游失效传播。

IM-05 WI-01 只补充技术 Application/Persistence 证据：Unit 2 files/5 tests；完整普通 Vitest 34 passed/25 skipped files（395 passed/278 skipped tests）；PostgreSQL 18.6/Flyway 11.20.3 Persistence 29 files/293 tests，32 migrations（含 forward-only V5001）、second no-op 与容器清理通过。Receipt/Inbox/Process/Audit/Outbox/Reference Edge 原子性、BigInt CAS、RLS/ACL 与公开精确 Authority Port 为 `PASS (LOCAL/PERSISTENCE)`；本节既有 Quality 业务 Unit/E2E 仍为 `NOT RUN`。

### 5.6 ReleasePublication

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| RPUB-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 Release Not Ready | NOT RUN |
| RPUB-U-002 | Unit | PREPARED 后替换收件人或文件 | 拒绝 Package Frozen | NOT RUN |
| RPUB-U-003 | Unit | 相同幂等键返回不同 packageHash Receipt | 拒绝并记录冲突 | NOT RUN |
| RPUB-U-004 | Unit | Revision 已批准但冻结 Package 无精确 Render Gate PASS | Release 不能 Authorize | NOT RUN |
| RPUB-U-005 | Unit | RRS packageHash 与冻结 Package 不同 | 拒绝 Authorize，Readiness 视为 STALE | NOT RUN |
| RPUB-U-006 | Unit | PREPARED Package 更新 Destination 或 packageHash | 不可变保护拒绝，要求新 Release | NOT RUN |
| RPUB-E-001 | E2E | 两个 Destination 一成功一失败 | PARTIALLY_RELEASED，逐项记录，失败项可重试 | NOT RUN |
| RPUB-E-002 | E2E | 发布后 Approval 撤销 | Receipt 保留，触发 Impact/Recall Review | NOT RUN |
| RPUB-E-003 | E2E | 相同 Destination/Package/Receipt Hash 回调重放 | 只形成一个 Formal PublicationReceipt | NOT RUN |

追加覆盖：Timeout UNKNOWN、Receipt 补记、Recall 通知、Destination 权限、有效日期和部分成功人工介入。

### 5.7 IntegrationGateway

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| IG-U-001 | Unit | 相同 external eventId/相同 Hash 重复入站 | 幂等返回原处理结果 | NOT RUN |
| IG-U-002 | Unit | 相同 eventId/不同 Hash | 隔离并记录安全异常 | NOT RUN |
| IG-U-003 | Unit | 未绑定飞书用户提交 Approval 卡片 | 拒绝，不调用 Approval Command | NOT RUN |
| IG-U-004 | Unit | 外部事件携带未知 Contract Major | Quarantine，不猜测字段或写业务状态 | NOT RUN |
| IG-U-005 | Unit | 同 externalEventId/不同 Hash 并发写入 | 首个 Envelope 保留，冲突进 Quarantine | NOT RUN |
| IG-E-001 | E2E | InformationRequest 发出、回答、重复回调 | 双向闭环且只形成一个 AnswerSubmission | NOT RUN |
| IG-E-002 | E2E | 正式 REL-801 发布与普通文件发送对比 | 只有正式路径生成 PublicationReceipt | NOT RUN |
| IG-E-003 | E2E | Outbound Attempt 提交后进程崩溃并重放 | 复用稳定幂等键，不重复不可控副作用 | NOT RUN |

追加覆盖：消息撤回、群解散、用户离职、Channel Timeout UNKNOWN、Runtime late result、Renderer Hash 和 Adapter Credential 泄漏防护。

---

## 6. Reference Project E2E Gate

采购控制程序是 MVP 的纵向验收主线：

```text
Feishu / Workspace UI SourceMaterial
    → CustomerMaterial / CustomerBaseline
    → GapAnalysis / Human-approved DeliveryItem
    → Task / frozen WorkOrder / Run
    → InformationRequest / authorized Feishu Answer / new Context / new Run
    → immutable ArtifactRevision
    → Gate FAIL / ReviewIssue / fixed Revision / independent Verification
    → Human Approval
    → Frozen Release Package / Release Readiness
    → Feishu PublicationAttempt / Raw Receipt / Formal Receipt
    → DeliveryItem Completion Evaluation
    → INTERNAL_EFFECTIVE_USE remains unchanged by default
```

E2E 通过必须同时证明：

- 每一步通过公开 Capability/Command，不直接写库；
- 每个对象 Enterprise/Project Scope 一致；
- CTX → WO → Run → AgentResult → Revision → RAS → ABS → Package → RRS → Receipt Hash 链完整；
- 重放、超时、部分失败和上游撤销不会破坏历史；
- Agent 没有完成 Human Approval/Release Authorization；
- 飞书消息和文件没有成为第二套业务 Source of Truth；
- Projection 延迟时权威 Query 仍返回正确结果。
- Workspace UI 只显示/提交公开 API 结果，Session、页面缓存、乐观更新和 BFF 组合不形成第二套业务事实。

---

## 7. 实施阶段强制 Gate

### 7.1 每次变更

1. 受影响基准文档已同步；
2. 新/变更失败场景先被记录；
3. Focused Unit/Contract/Persistence Test 通过；
4. 相关 E2E 回归通过；
5. 全项目格式、静态分析、类型检查和测试通过；
6. `git diff --check` 通过；
7. 未运行的外部/人工项明确报告；
8. 只修改请求范围内文件；
9. 用户确认后才提交。

### 7.2 Database/Migration

除第 7.1 节外，还必须验证：

- 空库迁移、已存在数据升级和回滚/前滚策略；
- 每个 Schema Role 的最小权限与跨 Schema 拒绝；
- RLS 正向、横向越权、无 Context、伪造 Context 和 Background Consumer；
- immutable table UPDATE/DELETE 拒绝；
- expectedVersion、active Claim、排他有效期和幂等并发；
- Outbox/Inbox crash/replay；
- JSONB 提升列与 Canonical Payload/Hash 一致；
- 对象 Staging/Link/Orphan Cleanup 和 Legal Hold；
- 真实 Query Plan 和数据量基准后再决定索引/分区。

### 7.3 Channel/Runtime/Renderer

必须分别验证：

- 真实飞书身份映射、项目群/话题绑定、消息/文件、卡片回调、撤回、重复和权限失败；
- Runtime Dispatch、Cancel/Resume、BLOCKED_INPUT、late result、Usage/Provenance 和 Adapter fallback；
- Renderer 输入 Hash、Renderer Version、输出 Checksum、可打开性、版式人工检查和 Release Package 绑定；
- 外部 Timeout 维持 UNKNOWN；
- 普通附件发送不产生 Formal Release Receipt。

### 7.4 Workspace UI/BFF

除第 7.1 节外，还必须验证：

- UI-DG-001 至 UI-DG-003 已审核，前端框架、Design System、浏览器/视口、可访问性和 BFF 部署没有被脚手架静默选择；
- Browser/BFF 只调用公开 API/Projection，无 Business Core internal import、Repository、跨 Schema SQL 或私有业务 Command；
- OIDC Authorization Code + PKCE、Session Cookie、CSRF、Origin/Host、logout、expiry、revocation 与 reauth；
- Access/refresh token、External ID、客户正文、短期下载 URL 不进入浏览器持久存储、DOM attribute、日志、analytics、trace 或 screenshot；
- Human-only、跨 Enterprise/Project Scope、Deep Link、缓存切换和多 Tab 负向路径由服务器拒绝且不泄漏对象存在性；
- expectedVersion、idempotency、double-click、网络中断、UNKNOWN/reconciliation 和 `CONCURRENCY_CONFLICT` 不制造第二业务事实；
- Projection freshness、epistemic state、部分成功、Provider UNKNOWN、Run/WorkOrder/Task/DeliveryItem 四层状态真实显示；
- XSS/CSP、恶意文件名/预览、错误 redaction 和依赖/制品安全；
- 批准浏览器/视口矩阵、键盘/焦点/name-role-value/错误恢复和用户手动 Reference Project 验收。

组件 Unit Test、Story、静态截图或 Mock API 不能完成 Browser E2E、安全、可访问性或人工 Gate。

---

## 8. 结果记录格式

每次真实执行后，在任务报告或未来测试报告中记录：

```text
Test/Scenario ID
scope and environment
input / fixture / exact version
expected output
actual output
PASS / FAIL / BLOCKED / NOT RUN
command or manual evidence
timestamp
remaining risk
```

不要把运行日志永久复制进架构基准。长期自动验证应落入代码仓库测试和 CI；人工验收应形成明确、精简、可重复的验收记录。

---

## 9. 当前状态

状态条目按实际发生日期累计；2026-08-28 最新增量为 IM-04 WI-04 交付验证与 IM-UI-01 里程碑基线：

- 用户已批准 IM-UI-01 的依赖、范围和 Exit Gate；它在 IM-06 后启动，可与 IM-07/IM-08 时间窗并行，并成为 IM-09 前置。
- Workspace UI Spec/Test 的 15 个场景已定义；仅 `UI-D-001` 为 `DESIGN VERIFIED`，其余 14 个 Unit/Contract/Browser/Security/Accessibility/Manual 场景全部为 `NOT RUN`。
- UI-DG-001/002 为 `USER DECISION REQUIRED`；UI-DG-003 为 `BOUNDARY FROZEN / CONCRETE DESIGN REQUIRED`。不存在 UI 工程、BFF、Browser build 或运行证据。

### 9.3 IM-04 WI-04 Canonical Content Object 验证边界（2026-08-28）

Issue #93 的实现和本地自动验证已完成，唯一证据报告为 [`Verification-Report.md`](../archive/issue-93-delivery/Verification-Report.md)。本次实现使用 forward-only `V4002`，不修改 V4000/V4001，不创建 Revision 或公开 Artifact Operation。

- 完整 `pnpm verify` 已通过：format/lint/typecheck、全量 Vitest（28 个文件通过、20 个受控跳过；373 passed、262 skipped）、Architecture、Contract（201 operations、201 schema FULL；历史 compatibility baseline 200）均通过；新增 in-memory Object Storage 与既有 Artifact focused 回归为 3 个文件、10 个测试通过。
- pinned PostgreSQL 18.6/Flyway 11.20.3 的 `pnpm persistence:gate` 通过 24 个测试文件、277 个测试；V4002 空库迁移成功，第二次 migrate 输出 `No migration necessary`，测试容器已清理。
- 已验证 Canonical Schema/Scope、caller hash、authoritative readback、media/size/hash、Manifest 生命周期、STAGING direct-finalize 拒绝、finalize unknown/retry、quarantine、DB rollback Orphan、24 小时 grace、5 分钟 lease、fencing、并发 worker、retention/legal-hold、unknown/NOT_FOUND/DELETED cleanup 和 RLS/ACL。
- SEALED Revision consumer、真实 Ceph RGW/OpenBao、生产加密/Object Lock、生产 scheduler、公开 HTTP、跨模块 E2E、生产数据库和独立人工业务验收仍保持 `NOT RUN`；synthetic walkthrough 只作为后续人工复核输入。

### 9.4 IM-04 WI-05 Revision/Lineage/Branch CAS 验证边界（2026-08-29）

Issue #94 的实现、自动验证和交付记录已同步到 [`Module-Test-004-Artifact.md`](../module-tests/Module-Test-004-Artifact.md) 与 [`Verification-Report.md`](../archive/issue-94-delivery/Verification-Report.md)。WI-05 仍把本地技术证据与外部/人工验收分开记录：

- `PASS` 只用于实际运行的 Unit/Contract、V4003 空库迁移与二次 no-op、FROZEN Manifest 门禁、immutable ACL/Trigger、递归 DAG、Parent 数量、cross Artifact/Project、wrong hash、Branch CAS race、explicit Merge conflict/resolution、幂等、rollback、RLS 和历史 Snapshot/Lineage replay；本轮这些本地/临时 PostgreSQL 证据均已在交付报告中列出；
- `DESIGN VERIFIED` 只表示 HL-Spec、Module Spec、Module Test 和 PostgreSQL logical model 已同步，不代表 Revision Handler 或业务数据库存在；
- WI-05 已证明 CAS 版本只来自 Envelope、同 Enterprise 的结构 Schema Scope 可被合法引用、Reference Edge owner version 保持 UUID 形状，以及 Merge 预校验失败时 Revision/Parent/Conflict/Outbox/Edge 一起回滚；这些结论以实际测试命令和结果为准，不能由静态代码检查单独替代。
- 首轮 V4003 空库迁移曾在 `invalidate_revision` 的 GRANT 参数签名不完整处失败并由 Flyway 回滚；修正后已重新完成全量空库迁移、二次 no-op 和完整 Persistence Gate，首轮失败作为修复历史保留，不计入最终 PASS 计数。
- 本 WI 的 local/in-memory、disposable PostgreSQL 和 CI 不能代表真实 Ceph/OpenBao、生产 DB、公开 HTTP、跨模块 E2E、Renderer、Quality/Approval/Release、外部 Provider、Browser 或独立人工 ART-023 验收；这些项在证据齐全前保持 `NOT RUN`。

既有状态记录：

- 高层设计基准已由用户审核通过；字段级 API Contract、七份 Module Spec 与七份 Module Test 已完成本轮静态 `DESIGN VERIFIED`，并由用户于 2026-08-13 审核通过；
- 本文中的 235 个实现前业务/外部场景仍主要为 `NOT RUN`（不得用 IM-01 静态证据冒充）；
- API Module Test、Feishu Channel、Runtime Adapter 的 Design Gate 仍为 `DESIGN VERIFIED`，其 Unit/Contract/E2E/Manual 运行时项保持 `NOT RUN`；
- IM-00 已完成；IM-DG-001 至 IM-DG-005 已批准；IM-DG-006 仍为 `USER DECISION REQUIRED`；
- IM-01 已 `COMPLETE`：干净 checkout 下 `pnpm install --frozen-lockfile`、`pnpm clean`、`pnpm verify` 全过；
- 当前仓库自动验证为 `pnpm test` 的 `Test Files 20 passed / 10 skipped`、`Tests 341 passed / 164 skipped`；`pnpm verify` 的 persistence gate 为 `12` 个测试文件、`177` 个测试通过；架构边界 `source_roots=10`；
- Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`，分类为 Command=95、Query=44、Event=61；Catalog/Module Spec/Registry 集合 diff=0；
- 200 payload + 44 query result + 6 Core Contract 的 Schema-derived Type 与 v1.0 compatibility baseline 已接入 `contracts:check`；
- 架构禁止依赖负向探针与 compatibility breaking 负向 fixtures 均实际失败（拒绝非法变更）；
- #1–#4、#6–#8 已关闭并合入；#5 字段 Schema 由 PR #14 完成，duplicate/late Runtime 由已关闭的 #15 完成，其余 Runtime 分别由 #22–#24 追踪；#17 的本地 IntegrationGateway Runtime 切片已落地，Handler/Adapter/DB/外部验收改由 #27 追踪；
- 2026-08-21 用户先批准修订 Issue #9 的 Schema 退出硬依赖，随后批准将 #5 收敛为字段 Schema 边界；关闭 #5 不会把 #22–#24 或 #27 的 Runtime/外部验收改写为 `PASS`；
- 尚无 IM-03 EnterpriseProject 业务 DDL、Repository、业务 Handler、飞书 Adapter、Runtime Adapter 或 Renderer 实现；IM-02 标准事务技术表已落地并有独立验证，但不能写成 IM-03 业务实现 `PASS`；
- 尚无 IM-03 业务 PostgreSQL 事务链、飞书、Runtime、Renderer、对象存储、负载、备份恢复或人工质量验收结果；IM-02 技术表的 PostgreSQL/Flyway persistence gate 已通过，但不等于业务链完成；
- 正式 `IM-01 COMPLETE` 已由 PR #20 原子更新（证据见 [Issue #9 Verification Report](../archive/im-01-exit-gate-issue-9/Verification-Report.md)）；IM-02 已完成技术基础和文档收口，PR #51–#55 已合入，Issue #28 已关闭；真实业务 Handler、外部系统和人工验收仍未完成。IM-03 WI-01 设计决策已记录；WI-02 正在落地 EnterpriseProject Application/Persistence 事务基础，业务 DDL/Handler 仍为 `NOT RUN`。

## 10. IM-03 WI-01 设计验证边界

Issue #57 的决策矩阵提供了 Product/QMS/Profile/Platform Reference 的唯一 Owner、受控入口、授权目的、精确版本/Hash 语义、失败码和手测示例。该矩阵可标记为 `DESIGN VERIFIED`，但以下项目仍为 `NOT RUN`：

- 受控 Application Capability 的 Handler、Repository、业务 DDL、真实 PostgreSQL 事务、RLS、CAS、幂等和 Audit/Outbox；
- 从空库创建 Enterprise、Product、QMS、Profile、ProductScope、Project 并重放旧 Snapshot 的业务 E2E；
- Platform Reference 导入/发布、TemplateBaseline/RegulatoryProfile 精确引用、Gap stale/Impact Process 的运行验证；
- IM-05 QualityProfile/Evidence 真实来源与跨模块验证、对象存储、外部 Provider 和人工“采购控制程序”验收。

截至 2026-08-21，本轮唯一可验证的自动范围是当时的 200 项公开 Contract、文档链接/格式和 Catalog/Registry 一致性；这些 Gate 通过也不能提升上述业务项状态。

### 9.1 IM-04 WI-01 当前验证边界（2026-08-28）

- 当前公开 Registry 为 `FULL:201 / ENVELOPE_ONLY:0`，其中新增的唯一 Operation 是 `integration.get_render_attempt_binding@1.0`；`contracts/baselines/v1.0/` 的历史 200-operation 快照不可改写。
- 本 WI 的自动 Gate 已覆盖并通过 Canonical Document/Workbook Schema、结构不变量、Canonical JSON/SHA-256 Fixture、Manifest hash-domain 排除、Binding Query payload/result、生成类型、Catalog 对账与兼容性增量；`pnpm test` 为 `25 个测试文件 PASS / 17 个 skipped`、`363 passed / 241 skipped`。
- `pnpm verify` 的 format、lint、typecheck、test、architecture、contracts:check 和 PostgreSQL persistence gate 均通过；Persistence 使用锁定的 PostgreSQL 18.6 / Flyway 11.20.3，完成 `21` 个测试文件、`256` 个测试、空库迁移、二次 migrate no-op 和容器清理。
- PR [#100](https://github.com/qzhike/zhiju-business-core/pull/100) 的最终 head `2fb49e243f6aac3e604190c5f655c0b1980fef69` 上 GitHub Actions `ci/verify` 已成功；PR 已合入 `main`，Issue [#90](https://github.com/qzhike/zhiju-business-core/issues/90) 已关闭，远端和本地 feature branch 已删除，`origin/main` ancestry 已验证。
- 对象存储、Renderer 进程、Artifact 业务 Repository/Handler、真实 Provider/数据库、公开 HTTP、跨模块 E2E、生产和独立人工业务验收继续保持 `NOT RUN`。

### 9.2 IM-04 WI-02 Application/Persistence 验证边界（2026-08-28）

Issue #91 只实现 Artifact owning Schema 在既有 V4000 技术表上的事务基础。适用 Gate 为：可信 Actor/Scope/Correlation Context 传播；同 key/hash 幂等 Replay 与不同 hash Quarantine/Conflict；技术 Process `bigint` CAS；Receipt、Audit、Outbox、Reference Edge 和技术 Process 的原子提交/回滚；Project 双重 RLS、Process Step Scope mirror、Reference Edge owner-version 唯一性，以及直接 App Role 权限拒绝。

该 WI 不新增 Artifact/Branch/Revision/Content Object/Representation/Binding 业务表，不修改已应用的 V4000，不读取 IdentityPolicy 或 EnterpriseProject Schema，也不实现业务 Handler、对象存储、Renderer、Provider、公开 HTTP 或跨模块业务 E2E。2026-08-28 的 `pnpm clean && pnpm verify` 已通过：静态、类型、全量测试、架构、Contract 和 pinned PostgreSQL/Flyway Persistence Gate 均通过；Persistence 为 22 个文件、268 个测试，空库 Migration、二次 no-op 和容器清理均通过。实现 commit `76c48f01e1a7c53ca9d2485be34290b4436310fa` 已由 PR #102 合入 `main`，Issue #91 已关闭，远端 feature branch 保留。业务 Artifact、生产数据库和独立人工验收仍为 `NOT RUN`，直到有对应实现和独立证据。

## 11. IM-03 WI-02 Application/Persistence 验证边界

Issue #58 验证 EnterpriseProject 模块内技术表写入路径，而不是业务 Aggregate：

- 相同幂等键/相同 Hash 重放、不同 Hash 冲突、并发 CAS、故障回滚必须在真实 PostgreSQL 证明；
- 无 Context、伪造 GUC、过期 AuthorizationDecision、跨 Project Scope 与连接池 Context 泄漏必须安全拒绝；
- Canonical payload/hash 与提升 Scope 列不一致必须在写入边界拒绝；
- 授权只允许绑定 IdentityPolicy 公开 Decision/Query Port 给出的可信快照，禁止模块 import `@zhiju/identity-policy` 或共享其 Repository；
- 空库 Migration / 二次 no-op 继续由 persistence gate 证明。业务 Handler、业务 DDL、公开 HTTP 和人工“采购控制程序”仍为 `NOT RUN`。

## 12. IM-03 WI-08 验证边界

WI-08 的最小自动验证包括 Platform Reference 的 DRAFT→PUBLISHED lifecycle、published immutability、writer/app role boundary、TemplateBaseline/RegulatoryProfile 的 Project Scope/RLS、精确 Ref/Hash/CAS、Evidence separation、idempotency、Audit/Outbox/Reference Edge 原子提交和失败回滚。测试文档必须同时记录输入、预期输出和实际输出；在测试未执行前所有 WI-08 场景保持 `NOT RUN`。

Disposable PostgreSQL 与本地 Unit/Contract 通过只证明当前代码、迁移和受控入口。Platform Provider、真实外部法规来源、公开 HTTP、跨模块 Process Manager、生产环境和独立人工 Reference Project 验收必须独立取证，不得由本地 Gate 推断为 `PASS`。

## 13. IM-03 WI-09 验证边界

WI-09 的最小自动验证必须同时覆盖：七个 Gap InputSnapshot ref 的 exact object/version/snapshot id、Scope、生命周期和 hash；受控 evaluator 的 `UNKNOWN` 保留与 summary 派生；InputSnapshot/Version/Finding/Decision 的 INSERT-only 与完成版本不可变；Human-only ACCEPT 以及 Agent/Service/`actingFor` 拒绝；ACCEPTED pointer、REJECT/CHANGES_REQUIRED 分支和 `GapAnalysisAccepted` 的 exact refs；Command Receipt 幂等、Root CAS 并发和故障回滚；以及旧 Gap 被新 Customer/Template/Regulatory Baseline/Profile 激活标记 `STALE` 后旧 finding/Decision/input 和 Impact trigger 仍可解释。

测试结果必须写回 [`Module-Test-002-EnterpriseProject.md`](../module-tests/Module-Test-002-EnterpriseProject.md)，并区分 `PASS (PERSISTENCE)`、`PASS (LOCAL)`、`DESIGN VERIFIED` 和 `NOT RUN`。Disposable PostgreSQL 不代表 Provider、公开 HTTP、跨模块 Process Manager、生产或独立人工 Reference Project 已运行；这些边界继续保持 `NOT RUN`，直到有独立证据。

Persistence Gate 的外部镜像证据还必须记录 tag 与当前 manifest digest 的一致性。若远端 registry 重新解析固定 tag，先更新经核对的 immutable pin，再重新执行本地和 exact-head Gate；tag-digest 检查失败时，不能把此前的静态或 Unit PASS 记作完整验证 PASS。

2026-08-27 的 WI-09 corrected exact head `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 GitHub Actions [run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309)，并以 merge commit `2d6afd0cc2889cf0fa6350c0599d514d5917b071` 合入 `main`。Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已显式 `CLOSED`；远端和本地 WI-09 feature branch 已删除，`origin/main` 已确认包含实现 head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## 14. IM-03 WI-12 Completion/Impact 验证边界

WI-12 的验证必须证明一条完整的本地受控链：精确 DeliveryPlan/Item criteria → 正式 Event Envelope 校验 → Inbox 幂等/冲突隔离 → ProcessInstance/Step → immutable Completion Fact → Evaluator → Evaluation/Root CAS → 最小 Completion 或 Impact Event。结果记录必须保留测试输入、期望输出、实际输出、精确 migration/head、环境和清理证据。

最小自动矩阵包括：TaskCompleted 存在但 ReleaseCompleted 缺失时 UNSATISFIED 且无 Completion Event；补入精确 ReleaseCompleted 后才 SATISFIED；同一 event/command 相同 hash replay 为 DUPLICATE；相同 id 不同 hash/watermark 进入 Quarantine 且不产生第二业务事实；late/revoked/upstream new Version 只追加新的 Evaluation/Impact Review；旧 Evaluation/Plan Version/Approval/Fact 保留；直接 SQL `delivery_item.execution_status='COMPLETED'`、跨 Project/无 Context/伪造 Scope 和 immutable UPDATE/DELETE 被拒绝；故障回滚不留下 Inbox/Fact/Evaluation/Impact/Event 半提交。

Disposable PostgreSQL、Unit/Contract 和 controlled fixture 只能标记 `PASS (PERSISTENCE)` 或 `PASS (LOCAL)`；真实 TaskExecution/QualityGovernance/ReleasePublication Provider、跨模块 Event Bus/Process Manager、公开 HTTP、生产和独立人工 Reference Project 继续 `NOT RUN`，不得由本地事实账本模拟成已完成外部链路。

截至 2026-08-27，WI-12 的本地验证记录为 [`Verification-Record.md`](../archive/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md)：`pnpm verify` 全部通过；完整 Vitest 为 24 个文件通过、17 个受控跳过，356 个测试通过、241 个受控跳过；Persistence Gate 为 21 个文件、256 个测试全部通过。Gate 使用 PostgreSQL 18.6（`server_version=180006`）与 Flyway 11.20.3 的固定镜像 digest，V2013 空库迁移和二次 no-op 均通过，测试容器已清理。Provider、真实跨模块 Event Bus/Process Manager、公开 HTTP、生产数据库和独立人工 Reference Project 仍为 `NOT RUN`。

## 15. IM-03 合成 Reference Project 验证补充

用户已确认 `SYNTHETIC / TECHNICAL ONLY` 方案。现有 WI focused fixtures 已组成一次受控技术 Gate：`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上通过 `21` 个 persistence 测试文件、`256` 个测试，空库迁移、V2013、二次 no-op 和容器清理均通过。该结果标记为 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不标记为统一跨 Aggregate E2E。

`EP-API-E-001/E-002` 的 integrated runtime chain、`EP-API-M-001` 的实际人工逐项审阅、真实业务适用性、Provider、公开 HTTP、生产和真实跨模块 Event Bus/Process Manager 继续为 `NOT RUN`。完整矩阵和证据见 [`Verification-Record.md`](../archive/im-03-synthetic-reference-fixture/Verification-Record.md)。

## 16. IM-UI-01 Workspace UI 验证边界

IM-UI-01 只在 IM-06 Human-operated Core 完成、UI-DG-001 至 UI-DG-003 获得适用审核、公开 API/Projection 语义稳定后进入实现。UI 是 Experience Module，不增加第八个 Business Core Owner，也不修改现有 200 项 Catalog。

最小自动与人工矩阵由 [`Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md) 唯一维护，必须覆盖：

- Projection freshness 与 PRESENT/UNKNOWN/NOT_PROVIDED/MISSING_CONFIRMED 的 ViewModel 真值映射；
- BFF 只调用公开 API，无 internal import/Repository/SQL/私有 Command；
- OIDC/Session/CSRF/Origin/Cookie/reauth/logout；
- Human-only、跨 Scope、Deep Link、缓存、多 Tab 和敏感信息负向场景；
- expectedVersion/idempotency/double-click/UNKNOWN/reconciliation；
- Project/Baseline/Gap/Delivery、Artifact/Revision/Diff/Edit、Evidence/Review/Approval/Release、Task/Run/InformationRequest/Audit 的真实浏览器链；
- XSS/CSP、文件/URL、telemetry redaction、批准浏览器/视口、键盘/焦点/语义和独立用户手动验收。

当前只完成文档结构、依赖和不变量的静态一致性检查，可标记 `UI-D-001 DESIGN VERIFIED`。前端框架、BFF、OIDC 环境、页面、组件、Browser E2E、Security、Accessibility 和 Manual 均不存在或未执行，必须保持 `NOT RUN`。IM-03 的受控 PostgreSQL、IM-07 的飞书卡片或 IM-09 文档中的“Workspace 输入”都不能替代 UI 运行证据。

## 17. IM-04 WI-08 Representation Binding 验证边界

Issue #97 的本地实现只通过注入的公开 `integration.get_render_attempt_binding@1.0` Query Port 读取权威候选，不依赖 IntegrationGateway 实现包、数据库或共享 Repository。自动矩阵覆盖 Registry result、exact Revision/Canonical locator/input hash、format/media、Renderer、output locator/checksum、Raw Receipt、非成功状态、Scope、幂等、同 Attempt 冲突、不同 Attempt identity、RLS/ACL、rollback 和 success event minimality。

2026-08-29 的聚焦 Unit/Contract 为 4 个文件、17 个测试通过；完整 `pnpm verify` 的 format、lint、typecheck、全量 test、architecture、contracts 与 persistence 均通过。全量 Vitest 为 32 个文件通过、24 个受控跳过，390 个测试通过、269 个受控跳过；架构边界为 `source_roots=10`；公开契约为 `FULL=201`，历史 v1.0 兼容基线仍为 200 项。真实 Persistence Gate 使用 pinned PostgreSQL 18.6 与 Flyway 11.20.3：V4004 空库迁移成功，28 个测试文件、284 个测试通过，第二次 migrate 返回 `No migration necessary`，测试容器已删除。成功 fixture 精确生成 1 Representation、1 Validation、3 Reference Edge 和 1 `artifact.RepresentationRegistered` Event；exact replay 不增加业务事实，同 Attempt 替换返回 conflict，注入故障无半提交。合成可复核表见 [`Manual-Representation-Binding.md`](../archive/codex-issue-97/Manual-Representation-Binding.md)。

上述结果只能标记 `PASS (LOCAL/PERSISTENCE)`。真实 IntegrationGateway Handler/DB readback、Renderer/Provider/object store、文件打开与版式、公开 HTTP、部署后的跨模块 E2E、生产和独立人工业务验收均为 `NOT RUN`。

## 18. IM-05 WI-07 Release Authorization、Publication、Receipt 与 Recall 验证边界

Issue #127 的验证必须沿 Release → frozen Package → latest RAS/ABS/RRS → trusted Human Authorization → PublicationAttempt/AdapterAttempt → RawExternalReceipt → Formal Receipt → per-destination Completion → Recall 事实链展开。Authorize 的最后一次 authority recheck 必须发生在同一事务内，并在任何 publisher/adapter side effect 前拒绝 stale approval/readiness、scope/purpose/hash/version 不一致、Agent/Service/Runtime 或 actingFor Human、revoked/expired Decision 和不完整 provenance。

自动化 Unit/Contract 需要覆盖 Human/ActorSnapshot/Envelope/Decision exact match、稳定 Attempt key、timeout `UNKNOWN`、reconciliation 不盲目重发、Raw Receipt provenance、providerResult PII allowlist/redaction、ordinary Feishu/file-send negative、partial/final completion、late receipt 和 append-only Recall。disposable PostgreSQL 需要覆盖 forward-only V6002、空库/二次 no-op、RLS/ACL、CAS/race、stable-key conflict、直接 DML、跨 Scope、rollback、Receipt/Failure/Recall 历史和最小事件。

REL-801 双 Destination 合成时间线是手工复核材料：必须能核对 exact refs、hashes、authorizing Human、时间戳、一次成功、一次 timeout/failed、partial、reconciliation/retry、Formal Receipt、最终完成或保留 partial、ordinary-send/PII/stale negatives、Recall 和 cleanup。Controlled Fake/Adapter 只可记为本地技术或受控 E2E `PASS`，不等价于真实 Provider；真实 Feishu/email、生产凭据、公开 HTTP、跨模块业务 E2E、外部收件人确认、部署和独立人工业务验收继续为 `NOT RUN`。#22/#23/#24 的独立证据和 Issue 状态不在本切片中静默替代或关闭。

2026-08-31 验证结果：精确执行 `pnpm verify` 全部通过，普通 Vitest 为 42 个文件通过、30 个受控跳过（432 passed、299 skipped），Architecture 为 `source_roots=10`，Public API/Catalog 为 201 operations 且全部 `FULL`，compatibility baseline v1.0 为 200 operations；PostgreSQL/Flyway Persistence Gate 为 34 个文件、314 个测试，V6002、二次 no-op、tag→digest、RLS/ACL、CAS、append-only、Observation hash readback、rollback、跨 Scope 和容器清理均通过。ReleasePublication focused suite 为 6 个文件、33 个测试通过。该结果只覆盖本地、合成和 disposable PostgreSQL 技术边界；真实 Provider、公开 HTTP、生产数据库、跨模块业务 E2E、外部收件人和独立人工验收保持 `NOT RUN`。

2026-08-31 exact-head GitHub 验证：最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 已通过 [PR #139](https://github.com/qzhike/zhiju-business-core/pull/139) 合入 `main`，merge commit 为 `07fc6a083897c01924f842d12dffe06fd6068261`；GitHub Actions `verify` run `33355948473` 在该精确 head 上通过，Issue #128 已关闭。本地/CI 技术 PASS 仍不代表统一跨模块业务 E2E、Provider、生产或独立人工验收。

## 19. IM-05 WI-08 合成 QMS/REL-801 退出复核

WI-08 的验收对象是“证据是否可以沿精确引用重建”和“父级是否应当关闭”的复核材料，而不是新增业务 Owner。复核报告必须把 QualityGovernance 的 Evidence/Profile/Gate/ReviewIssue/Approval/RAS/ABS/RRS、Artifact 的 Revision/Representation、IntegrationGateway 的 RenderAttempt/Raw Receipt、ReleasePublication 的 Release/Package/Attempt/Receipt/Failure/Recall 分成可追踪的事实段，并为每段记录输入、预期、实际、直接测试证据和边界。

当前可复用的直接证据包括：

- QualityGovernance：`quality-business-validation.test.ts`、`quality-gate-validation.test.ts`、`quality-review-approval-validation.test.ts` 以及三组真实 PostgreSQL Persistence 场景；WI-08 额外要求 ReviewIssue 主流程明确产生 `REV-002 / FAIL`，再由 `REV-003` 的独立验证形成 RAS/Approval/ABS 历史。
- Renderer/Representation：Canonical Document/Workbook golden fixture、确定性 DOCX/XLSX Renderer、V7001 RenderAttempt/Raw Receipt、Artifact Binding Query/Representation 测试，以及 PR #135 已记录的本地 Word/Excel openability 结果。Renderer 成功不能推导 Quality PASS、Approval、Release Authorization 或 Completion。
- ReleasePublication：V6002 Handler 的完整授权/Attempt/Failure/Receipt/Completion/Recall 场景和 `tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 受控时间线。后者的 `RELEASE_RECEIPT_STALE`、`RELEASE_RECEIPT_ALREADY_RECORDED`、`PARTIALLY_RELEASED` 是可重放的本地 Runtime 结果，不是外部 Provider 结果。

WI-08 复核命令和实际输出见 [`Synthetic-QMS-REL-801-Exit-Report.md`](../archive/codex-issue-128-delivery/Synthetic-QMS-REL-801-Exit-Report.md)。`pnpm clean && pnpm verify`、空库/二次 no-op Migration、精确 head/CI 和文档同步可以形成技术 `PASS`；统一跨模块业务 E2E、公开 HTTP、生产、真实 Provider、外部收件人确认、Workspace UI、CLI runtime、IM-09 和独立人工客户验收必须保持 `NOT RUN`。父 Issue #120 不由 WI-08 自动关闭。

## #229 设计与恢复执行证据的出口

状态：`T2 DESIGN ONLY / DESIGN APPROVED / INDEPENDENT DESIGN REVIEW PASSED 2026-09-27 / HUMAN DESIGN APPROVED 2026-09-27 / RUNTIME NOT RUN`。本设计交付仅Markdown under `.vibe/`，配置验证目标为 `docs`，另做registered request/result/error/ref/Purpose与[Spec003§24](../module-specs/Module-Spec-003-TaskExecution.md#24-blocked_input--customermaterial--context-2--run-2-spec-delta229)的focused semantic comparison。其成功不能代替独立设计审查/人类批准，不写为新runtime/persistence PASS；正式review按项目规则归档在未来PR的`.vibe/reviews/pr-<number>/Review.md`。

未来实施必须完整交付限定Human恢复动作及owning读回，配置验证为 `full`（新/变化容器环境先 `environment`）；最小业务出口与必要反例/fault分别由Module-Test003 `TE-REC-D-001–011`、001 `IP-REC-D-001–003`、002 `EP-REC-D-001/002`、007 `IG-REC-D-001–003`拥有。Contract/Unit、真实PostgreSQL/owningentry、controlledsynthetic、External、Manual证据分开，未执行子项保持NOT RUN。#224最终20 tiered PASS/3 PARTIAL、actual grant PolicySnapshot生命周期延后及§22.8边界不被本提案重标；TD-05–07、正式输出、Completion、Provider/CLI/Feishu/publicHTTP/部署/独立人工验收仍非本Issue出口。


## #237 真实派发与独立 DeliveryItem Completion 的验收边界（提案）

状态：`HUMAN DESIGN APPROVED 2026-10-01 / DESIGN REVIEW PASSED / IMPLEMENTED IN #239 PROPOSED REVISION / TIERED RUNTIME EVIDENCE IN MODULE-TEST`。[决定](../decisions/task-completed-delivery-completion.md)的bounded结果按既有§2.8首版原则交付：本实现包含normal与一次BLOCKED_INPUTrecovered的owning链，真实TEOutbox→EPInbox/精确关联→独立Evaluation→EPReadback。Task-only可SATISFIED，另需Release的合法目标UNSATISFIED。字段/失败唯一见Spec003 §26、Spec002 §23、Spec001 §15.16、PostgreSQL §41；必要运行矩阵TE-DEL-D-*、EP-DEL-D-*、IP-DEL-D-*在各Module-Test，不以现有EPsyntheticEvent或#235CompletionPASS替代。

设计交付仍按现行strictMarkdown`docs`路由，另需独立语义设计审查和revision-bound明确人类设计批准、真实PR编号下的正式Review记录。这里只新增验收场景和证据边界，不改变§2.1.1验证策略/targets。后续实现需`full`及适用首次`environment`，standaloneinput/contractfixtures、实际controlledDriver、正负/并发/commit前与commit后故障、ACL/RLS/immutable/升级证据分层保存。OnlyexternalRuntime可替换；Event/Decision/Receipt/fact不能伪造或direct-table构造positivechain。

EP结论的Task语义是历史正式完成，不宣称TE当前USABLE或尚不存在的Task invalidation follow-up；已有Release/Quality撤销证据单独记录。外部Provider/CLI/飞书/publicHTTP/UI、部署/生产/负载、独立人工、Cancel/late-result和IM-06整体退出仍NOT RUN；Grant PolicySnapshot lifecycle既有延后不泛化。设计批准不等于实现NOW+READY或IM-06关闭。

## D14 / RD-01 设计与真实链路证据边界

[#277 准备入口补充](../decisions/preparation-entry-bootstrap.md) 的接受集追加于 `IP-277-001–006`、`EP-277-001–006`、`IG-277-001–006`、`UI-277-001–005`，既有 D14/#258/#257 用例与批准不被替代。检查 NEW/EXISTING、精确preset/规则发布、无Project前的受控Scope、创建后缺权、同请求response-loss、说明与ANALYZE、一次完整重传/UNKNOWN/迟到流、unsafe/部分合法ZIP、manifest可靠交接及缺TE/Runner的诚实状态。这里只索引未来设计验收，所有新增运行用例 NOT RUN；严格Markdown仍用 docs，未来注册/持久化贯通实现须 full，保持既有验证路由。本补充的独立Review与精确修订Human技术批准已完成，来源见Delta及正式Review；后续实现仍须完成依赖readiness和适用运行Gate，不把本设计或docs结果提升为运行PASS。

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`；保持现有 verify targets/路由/结果协议不变。严格 `.vibe/` Markdown 设计分支用 `vibe verify docs --json`，其 PASS 只表示配置文档检查，不能替代 T2 独立设计审查和精确修订人类技术批准；具体 Runtime/规则 lock 决定前依赖实现不 READY。

新 owning traces 位于 Module-Test 001 `IP-D14-*`、002 `EP-D14-*`、003 `TE-D14-*`、007 `IG-D14-*`、UI01 `UI-RD01-*` 与 Runtime Test `RA-D14-*`。后续分别执行：真实 PostgreSQL/full（历史迁移、唯一 start、RLS/CAS/幂等/rollback/部分提交）、独立 Runner output（只证明该锁定执行实际产物）、Host IG→TE→EP acceptance（真实来源与当前可用性）、公开 OIDC/HTTP/Browser（Session/CSRF/撤权/原意图恢复）和独立顾问业务验收。所有新 runtime/持久化/public/manual 场景仍 NOT RUN；既有 v0.1 standalone/原型/外壳不升级其结果。

## Markdown 候选与逐文件反馈设计验收索引（#259）

状态：T2 / PROPOSED / DESIGN ONLY；不改变§2.1.1目标/路由/验证策略。[Spec Delta](../decisions/markdown-file-feedback.md#9-兼容取舍与验收门禁)与owning场景ART-MF-*、TE-MF-*、QG-MF-*、IP-MF-*、IG-MF-*、UI-MF-*、RA-MF-*覆盖整份candidate→一文件revision正链、真实采购快照/宽表/空白与0/已填记录、unsupported/lossy/恶意内容、scope/protection、exactdiff/location/201files、旧B/M/S、UNKNOWN/partial/撤权、私稿跨设备CAS与历史保留。

严格.vibe Markdown设计diff执行vibe verify docs --json，另定向检查唯一Owner、Catalog/proposed字段/Ref/Hash/transition/trace链接；自动docs或静态对账不能替代独立设计Review和精确修订人类技术批准。本节是场景索引，不声称用例已执行或记录普通任务验证日志。后续混合实现仍按现有code/full规则，不以文档目标覆盖code/SQL/registry。

真实生成profile的Runner可行性、Host原invocation→IG→TE→ART接纳、PostgreSQL/RLS/CAS/full、OIDC/HTTP/download、批准Chrome/Edge矩阵及独立Human内容检查/Approval均NOT RUN，需分别取证。原型36changes/旧版改稿/6.5秒UNKNOWN演示仅synthetic交互输入；本提案的10秒/3次预算、Markdown限制与不规则表拒绝也不是生产配置/业务验收。

## MVP B1 项目与资料托管设计及实现出口（已批准设计）

[B1 设计](../mvp/b1-design.md)与 [MVP01 Spec/Test](../module-tests/Module-Test-MVP01-DocumentDelivery.md)定义一个完整资料托管结果。T2 设计增量使用配置 `vibe verify docs --json`，并独立检查字段/状态、权限、事务与文件一致性、原请求恢复、ZIP/OOXML/XLSX 失败场景、初始化及 UI 对照；人类技术批准绑定精确内容，静态 PASS 不替代该批准。

后续实现涉及新认证/归属边界、API、数据库、文件存储、解包和初始化，配置目标必须为 `full`；新或实质变化容器运行环境先执行一次 `environment`。同修订可信 CI 可复用，但不得从 docs/旧链 full 推导新实现 PASS。B1-01–14 覆盖受控 Contract/Unit、真实 disposable PostgreSQL、文件 fault/restart、公开可信 HTTP/Browser 和独立本机用户试走。每层记录自身证据；B1 接纳不是文件语义理解，U1–U3 模拟流程确认不是新链验收；所有新增 runtime/persistence/manual 均为 NOT RUN。
