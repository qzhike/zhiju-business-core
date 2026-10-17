# PR #300 独立代码审查

APPROVE。独立语义审查未发现阻断问题；reviewed SHA 的 required `full` CI 已全部通过，最终日志补齐了 PostgreSQL 执行、关键清单、动态 EXIT 来源与容器清理证据。本结论仅绑定下述代码修订，不提供 merge 或部署授权。

## 审查对象与授权

- PR：[#300](https://github.com/qzhike/zhiju-business-core/pull/300)，本轮读取为 OPEN / Draft。
- Reviewed SHA：[`561be171a08909c366c78211928dbb0955484477`](https://github.com/qzhike/zhiju-business-core/commit/561be171a08909c366c78211928dbb0955484477)。`vibe repo --json`、PR head 与本地 HEAD 一致。
- Base SHA：`1770bbf4c4ec5ef7ea159801af2ec3ce56947692`，base 为 `main`；审查完整 base-to-head 七文件差异，不仅检查最后一个文件或作者总结。
- 相关业务要求：[#250](https://github.com/qzhike/zhiju-business-core/issues/250)，读取正文及 comments；该 Issue 当前 CLOSED，没有 comments。本 PR 是已有受控退出测试的隔离调度与验证策略改进，不重新声明 #250 全部业务验收，也不改变其关闭状态。
- 用户授权 PR 交付后启动独立 Reviewer；本 Reviewer 只审查并保存本正式记录，不修改测试/产品实现，不 commit、push、merge、deploy 或关闭 Issue。GitHub 审查意见尚未发布。

## 独立预期与依据

已读取实际根 AGENTS、`.vibe/project.yaml`、`vibe-development` Reviewer 角色与 contract-review 规则、HL-Spec §1–6/8–11、验证基准 §1–2/7、TD-07 决定 X-01–X-05/§7–8、TaskExecution Spec §14.1–14.4 及 Module-Test 的 EXIT-D 与 initial-context 执行边界，再对照实际差异和被复用的生命周期接线。

本次改动应满足以下边界：

1. 四个 EXIT 叶级场景分别保留空 TE 库起点、真实 owning 链、原 Scenario 参数和断言、Task-only/Task+Release 顺序、五种提交后故障、真实 backoff/lease 等待与动态来源证据；迟到 final 和已有 Progress 停止维持两个独立来源。
2. 每例有独立迁移后的 PostgreSQL、suite、时钟、运行时存储和可变状态；最多两例业务并行，组内串行，全局 persistence 文件并行策略不变。异常退出仍须使环境不可复用、收敛在途工作并回收资源。
3. 关键清单须独立于本轮实际收集结果，逐一核对五个入口的文件、叶名、多重性和最终执行状态。完整模式拒绝遗漏、重复、改名、移动、新增、未执行或未通过；聚焦模式须明示其证据限制。
4. 本差异涉及持久化测试与验证策略，required target 为 `full`。普通测试、收集结果、旧 main 的 full 或源码审查均不能替代 reviewed SHA 的完整验证。

## 语义审查结果

当前未发现需要修复的实现或权威文档不一致：

- `controlled-exit.test.ts` 使用既有 `registerIsolatedInitialContextGroups`，normal→cancel 与 recovered→cancel-progress 两组内部串行；`databasePerCase: true` 为每个叶级场景创建独立 Environment，未让后继场景复用前例的业务库。`deliveryOnly: true` 仍对应原 `prepareSuite(true)`，不创建 golden TE WorkOrder；空库断言保留。
- 独立检查 helper 的准备、`verifyIsolation`、`runIntegrationCase`、settlement、afterEach 与 afterAll：实例 `system_identifier`、角色撤销、同键行锁、时钟和 SQL 错误隔离仍在业务开始前验证；开始排空即禁止复用，测试体与 drain 分开管理，超时/部分 setup/清理失败仍走有限等待及停止容器路径。该 helper 本身未被本 PR 修改。
- 独立 TypeScript AST 对比 base 与 reviewed SHA，按原顺序打印后比较：62 个 `expect` 表达式、2 个 `runScenario` 调用、11 个 SQL `query` 调用全部一致。原叶名、900 秒超时与 profile 集合保留。此静态证据支持业务主体未被删改，不单独证明真实 PostgreSQL 执行成功。
- `critical-cases.json` 为受审查的固定期望，包含 64 + 12 + 3 + 13 + 4 = 96 个叶级名称；检查器从实际 Vitest module/test 对象取得路径、叶名和终态，逐项要求唯一且 passed，分组名称不成为业务身份。
- reporter 在完整模式执行关键清单与原全量 skipped 拒绝；`gate.mjs` 根据是否显式选择单文件覆盖 `ZJU_PERSISTENCE_FOCUSED`，完整 Gate 不会继承环境中意外残留的 focused=1。聚焦模式明确输出不检查完整清单，失败用例仍由 Vitest 自身使进程失败。
- 验证基准与 TaskExecution Module-Test 已同步明确隔离调度、固定清单、失败与证据边界。没有生产代码、公开 API、Contract、migration、依赖或全局并行配置变更；没有把外部或人工验收升级为 PASS。

## 验证证据

| 证据                              | 结果及含义                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 当前 SHA 的 focused 回归          | 复用交付协调方提供并在 PR 描述中的同内容证据：`vitest run tests/business/persistence-case-inventory.test.ts tests/business/initial-context-isolation.test.ts`，2 files、21/21 passed。覆盖真实 Vitest reporter 的清单反例及隔离生命周期失败探针；不替代 full。                                                                                                                                                                                                                       |
| 实际五入口收集                    | 复用当前修订的 Vitest list 证据：五文件 96 名称匹配，64/12/3/13/4；不表示业务测试已执行。                                                                                                                                                                                                                                                                                                                                                                                            |
| Reviewer 独立 AST 对比            | 62 assertions、2 Scenario calls、11 SQL calls，数量、表达式及顺序全部相同。                                                                                                                                                                                                                                                                                                                                                                                                          |
| Reviewer 独立 reporter 反例       | 临时目录构造与固定清单一致的真实 Vitest 文件，导入仓库实际 persistence config/reporter，强制非 focused 模式。`it.todo`、整组 `describe.skip`、`beforeAll` 抛错、`--testNamePattern` 误过滤四种模式均 exit 1，且包含 `critical persistence case inventory failed`。临时文件已清理；未修改仓库实现。                                                                                                                                                                                   |
| 作用域静态检查                    | 复用交付方当前内容的 ESLint、Prettier、`git diff --check` 通过证据。                                                                                                                                                                                                                                                                                                                                                                                                                 |
| required exact-head full          | [CI run 38994379937, attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38994379937)，head 为 reviewed SHA，event 为 pull_request；协调方本轮读取状态为 completed / success，select、checks、persistence、verify 四个 jobs 全部 success。Reviewer 独立读取已下载的完整日志 ZIP：select 明确 `target=full`、`changed_path_count=7`；verify 的 NEEDS_JSON 确认 full、checks/persistence success、WORKFLOW_CANCELLED=false，最终 `{"status":"PASS","failures":[]}`。 |
| full 的普通与浏览器检查           | 完整 checks 日志：144 files / 2,965 tests passed；`workspace_shell=PASS independent_builds=Web,BFF production_rejection=PASS fixture_browser=PASS`，浏览器汇总分别为 7 passed 与 53 passed。                                                                                                                                                                                                                                                                                         |
| full 的真实 PostgreSQL 与关键清单 | 完整 persistence 日志：64 files / 739 tests passed；`critical inventory passed: files=5; tests=96`、`gate passed`、`postgres container removed`。本轮没有重复运行本地 full。                                                                                                                                                                                                                                                                                                         |
| full 的 EXIT 与隔离清理           | 四个 `EXIT_EVIDENCE` profile normal/recovered/cancel/cancel-progress 均存在；主链 invocation 分别为 1/2/1/1，normal/recovered 的独立 Task+Release 负例 invocation 分别为 1/2，且各有两次独立 EP 最终读回。normal 的 submit/accept/finalize/EP consume、recovered 的 resolve/EP consume 故障全部 reached=COMMITTED；四个 controlled-exit 独立容器均有 stopped 记录。                                                                                                                  |

旧 main 的历史 full 证据不作为本修订通过依据。当前不声称取得本修订的运行耗时改善百分比；本 PR 没有提供可据以复验该数字的当前 A/B 证据。

## 最终结论与未运行边界

用户通知 CI 已完成后，同一 Reviewer 继续原审查；协调方本轮重新读取远端确认 PR 仍为 OPEN / Draft、head 与 base 未变，Reviewer 再执行 `vibe repo --json` 确认本地 head 仍为 `561be171a08909c366c78211928dbb0955484477`。Reviewer 独立核对上述已下载的完整 CI 日志，没有轮询 GitHub、启动第二 waiter 或重复 full。结合实际完整差异、权威要求、AST 对比、独立 reporter 反例与当前 exact-head full，阻断发现为零，最终 outcome 为 `APPROVE`。

本次测试隔离调度与验证策略改动未改变生产业务契约、批准的取消支持集或数据库结构，未发现新增未决人类技术审查门禁。Draft 状态及后续交付授权仍独立；该 agent-review APPROVE 不等于 GitHub 正式 Approve review。

外部 HTTP/UI/CLI/Provider/Feishu、生产环境、独立人工业务验收及原 Grant PolicySnapshot lifecycle 延后仍为各自 `NOT RUN`/既定边界。审查结论不自动完成 IM-06 退出对账，也不提供 merge、deploy 或清理授权。本记录以普通追加提交纳入 PR；本次代码修订结论不预先覆盖后续 SHA。文档追加提交须独立审查新增差异，并取得最终 HEAD 的适用验证；最终交付证据维护在 PR。
