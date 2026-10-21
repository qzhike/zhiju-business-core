# PR #304 独立代码审查

APPROVE。独立审查未发现阻断问题；下述实现修订已取得本机完整验证和精确 head 的远端三分片验证。本记录保存实现审查结论，不预先批准文档入库后的新 SHA，也不替代最终交付检查。

## 审查对象与范围

- PR：[#304 — ci: parallelize persistence gates and refine UI verification routing](https://github.com/qzhike/zhiju-business-core/pull/304)。本次读取为 OPEN。
- Reviewed SHA：[`57da0b680dc62b311aba23ce08fd9b13053adedf`](https://github.com/qzhike/zhiju-business-core/commit/57da0b680dc62b311aba23ce08fd9b13053adedf)，分支 `codex/mvp-ci-verification`。`vibe repo --json`、本地 HEAD 和远端 PR head 一致。
- Base SHA：`ae2aa7cb730da2cd27fa461b45b5cf3e32a4ca61`，base 为 `main`。审查完整 base-to-head 的 18 文件差异。
- 已审查实现的内容聚合指纹：`43f2324b08a7d4efb8aa75a4eb4b6ebb826c5fa1a5a4cc5ab7acb84cf49c1bb1`。逐路径计算文件 SHA-256，再对按路径排序的紧凑 JSON 映射计算 SHA-256；已提交内容与此前独立审查及本机 full 的快照一致。
- 本次工作属于 T1 验证基础设施优化：持久化 CI 分片与汇总、测试库存检查、保守的 UI 验证路由扩展、迁移 no-op 重复检查合并，以及对应回归和验证基准。没有修改生产业务、公共契约、数据库迁移、依赖、业务 fixture 或 PR #303 的实现。
- 用户已授权交付协调方合并和清理本次分支/隔离工作区；本 Reviewer 的操作限于独立审查及撰写本文件，不执行 commit、push、merge 或清理。独立 agent 的 APPROVE 不等于 GitHub 正式批准 review。

## 独立依据与审查方法

依据根 `AGENTS.md`、`.vibe/project.yaml`、`vibe-development` Reviewer 规则和[验证基准 §2.1.1](../../high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由)，先以已授权范围明确覆盖、隔离、失败拒绝和风险路由的预期，再检查实际代码与负例。此次是同一 Reviewer 延续已完成的实现审查并补齐正式记录，不声明一次新的盲审。

实际审查覆盖两个 CI 工作流，`tools/persistence/` 中的分片选择、Gate、reporter、关键清单与 no-op 检查，`tools/verification/` 中的路由、汇总及回归，业务清单回归、迁移基准用例和验证基准文档。对照了未修改的持久化配置、Flyway/Docker 调用及相关 UI fixture 接入边界，确认新行为没有绕过原隔离和失败处理。

本 PR 涉及验证策略与持久化工具，适用目标为 `full`；本机普通测试、静态清单或先前 main 的绿色结果不能单独替代该修订的完整验证。

## 核心不变量与负例

1. **全部文件与关键业务覆盖保持。** 三分片必须对独立发现的文件形成完整且互斥的分配，新增文件进入分片 3；删除固定分配路径、重复分配、非法编号和空分片必须失败。reporter 将实际执行文件与预期集合逐项核对，不能只比总数。96 个关键用例按预期分片文件筛选，保留原叶级名称、唯一性和成功状态检查，不能根据实际收集结果缩小期望。
2. **分片不能冒充完整 Gate。** 本机默认 full 不分片；显式分片不能与聚焦文件、名称过滤或诊断选项混用。Gate 覆盖继承的模式环境变量；分片和聚焦输出明确说明不是完整 Gate。每个 runner 仍执行锁定镜像与版本检查、空库迁移、历史 seed、后续迁移和收尾；同一次 Gate 内文件串行，业务真实期限、用例内顺序及隔离清理不变。
3. **两个汇总层均拒绝不完整成功。** 三个显式复用工作流调用固定传入不同分片编号。原 `persistence` 检查要求三个分片全部 success；最终 `verify` 仍检查 select/checks，并按 full 或 docs/code 要求 persistence 成功或预期跳过。失败、取消、缺失、非法结果、意外跳过和未知 scope/target 均不能通过。
4. **路由扩展不降低业务验证等级。** 新增 13 个明确路径仅涉及现有匿名 fixture、组件/模型测试、浏览器测试和样式。Markdown 安全渲染、execution/delivery 页面及模型、身份导航、Scope、真实 adapter、构建依赖和未知或混合路径仍走 full。main 非文档 push、完整 PR diff、原始 Git 路径和重命名旧路径的规则保留；没有为 PR #303 特设绕过规则。
5. **no-op 合并保留更强的失败条件。** Gate 收尾要求 Flyway migrate 命令成功、报告无待执行迁移、完整 migration history 前后完全相同。历史读取失败、命令失败、历史漂移、实际应用迁移或空历史均拒绝通过。异常仍进入容器清理。仅移除被该检查替代的重复 Vitest 用例，业务用例不删减；旧业务套件继续保留至替代能力和依赖完成核对。

已检查的回归覆盖上述合法与非法模式、继承环境覆盖、同数量错误文件替换、缺失/重复/额外文件，以及实际 Vitest 子进程中的关键用例遗漏、改名、移动、额外用例、跳过、失败和分片/聚焦混用。汇总回归逐个依赖检查非成功状态，工作流回归锁定三个显式调用和两层依赖。路由回归保留未知路径、main 和高低风险混合反例。规范修正没有改变断言；最后的文档澄清准确区分同一 Gate 内串行与跨 runner 并行。

## 验证证据与独立核对

完整执行明细及耗时比较保留在 [PR #304](https://github.com/qzhike/zhiju-business-core/pull/304)，本记录仅保存支撑审查结论的证据摘要。

- 本机 `vibe verify full --json` 在上述相同内容上退出 0、返回 PASS。Reviewer 已独立读回捕获日志的最终结果：普通 150 文件 / 3,144 例、浏览器 60 例、持久化 65 文件 / 747 例、关键清单 96 例、文件清单 65 文件、第二次迁移无待执行项及容器清理。中段日志截断已知，最终状态与这些汇总完整；远端完整日志补齐当前分片执行证据。本次没有重复运行 full。
- [CI run 39531096736, attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/attempts/1)：Reviewer 单次读取 GitHub 元数据确认 event 为 pull_request、head 为 reviewed SHA、状态 completed/success，七个 jobs 全部 success；独立读取已下载的完整日志 ZIP，select 明确 `target=full`、`changed_path_count=18`。
- [分片 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/118996973708)、[分片 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/118996973548)、[分片 3](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/118996973572) 分别通过 1/6/58 个文件、64/94/589 个用例，关键清单分别为 64/32/0。Reviewer 从各完整日志的 file-end 和叶级结束记录重新计数：65 个文件恰好执行一次，与仓库预期集合一致，缺失、额外、重复均为零；747 条叶级结束状态全部为 passed。
- 每个分片日志均保留历史 seed 与后续迁移、第二次迁移 `No migration necessary`、分片通过和 PostgreSQL 容器移除。结合已审查的收尾控制流，分片成功意味着完整历史前后相等检查已通过；单个分片仍明确输出 `not the full gate`。
- [persistence 汇总](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/119002626256)及[最终 verify](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/119002682769)的完整日志均显示所需依赖 success、`WORKFLOW_CANCELLED=false` 和 `{"status":"PASS","failures":[]}`。[普通检查](https://github.com/qzhike/zhiju-business-core/actions/runs/39531096736/job/118996973361)日志独立确认 150 文件 / 3,144 例、7 + 53 个浏览器用例以及 Workspace 独立构建与生产拒绝检查通过。

上述远端日志已经证明三个独立 runner 实际完成分片，不再沿用此前远端 NOT RUN 的状态。性能观察仅代表该次运行；详细口径见 PR，不据此保证所有 runner 分配下的耗时，也不将墙钟缩短等同于等比例减少 runner 消耗。

## 结论与后续提交边界

阻断发现为零，`APPROVE` 绑定实现修订 `57da0b680dc62b311aba23ce08fd9b13053adedf`。当前实现符合授权的 T1 范围，没有发现新增的未决人类技术审查事项。真实外部 Provider/客户 Runner、生产环境及独立人工业务验收没有由本次工程验证覆盖，仍保持各自 NOT RUN 边界；本 PR 不宣称完成 U1 UI 验收或后端 MVP 业务验收。

本记录将作为普通后续提交加入已发布 PR。加入后的新 head 必须独立复核新增文档差异，并取得该最终 head 的适用 CI；完整 PR 仍含验证策略和持久化改动，应按 full 路由。不得将本记录或旧 head 的 PASS 当成尚未产生的新 head 的通过证据。最终 head、增量审查和 CI 证据记录在 PR，无需为追逐文档自身提交 SHA 反复改写本记录。合并与清理由交付协调方在最终门禁通过后按用户授权执行。
