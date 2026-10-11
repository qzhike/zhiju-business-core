# PR #274 独立代码审查

- PR：<https://github.com/qzhike/zhiju-business-core/pull/274>
- 审查日期：2026-10-11
- 角色与结论：`Reviewer / APPROVE`
- 已审代码提交：`1c6c7cf445c3c77270fe15c700580e789c65a239`
- 比较基线：`1316616a8896908f36f15982551c60272e6c7f0c`
- 本页是上述代码提交之后新增的正式审查记录；不能声称本页已包含在该代码 SHA 或其验证范围内。提交本页后的最终 PR head 仍须确认差异及该 head 的 CI。

## 范围与独立判断依据

用户限定只优化三个 delivery 和十二个 eligibility-change 用例，保留业务链、真实等待、deadline、Run budget、断言、隔离和其他用例的串行行为。本 PR 无关联待关闭 Issue；工作项依据为用户明确范围与 PR #274。

本轮按 `vibe-development` Reviewer 角色，先读取 `AGENTS.md`、`.vibe/project.yaml`、HL-Spec 的权威规则、验证基准 §1–2、TaskExecution Spec §23、§24.5、§26 和 Module-Test 的对应执行边界，再检查实际 diff、源码与证据。独立预期为：

1. 调度可以跨独立数据库重叠，同一数据库内部不能同时执行业务用例；数据库、连接、迁移、角色、时钟、准备缓存和运行时存储分别拥有独立生命周期。
2. 授权资格在 SUBMIT、RECORD、VALIDATE、ACCEPT、FINALIZE 和取得 Run 锁后仍须按原场景重验；历史 Receipt/Result 不恢复当前资格，失败后仍执行真实到期与 owning cleanup。
3. 交付保留正常及恢复链、Task-only 与 Task+Release 顺序、迟提交和乱序证明；TE dispatch 确认不替代 EP 独立 Evaluation。
4. 失败、取消、超时和 drain 异常必须阻止不确定环境复用；持续未完成的 Promise 不能阻止关闭连接及停止容器的兜底尝试，setup 退出后到达的资源也必须回收。
5. 持久化测试和验证策略变化要求 `full`；普通或模拟生命周期测试不能替代真实 PostgreSQL，也不能替代外部和人工验收。

## 本次代码审查结果

未发现当前已审代码中的阻塞项。

- `initial-context-eligibility.test.ts` 把十二例分为 GRANT/POLICY 两组，各组按五个消费边界及一个持锁反例串行执行。`initial-context-delivery.test.ts` 为三例分别保留独立环境，并通过两组调度把同时执行业务的上限保持为二。
- 新调度器为每个环境分别创建容器、suite 和 `createRunScenario` 闭包。`createRunScenario` 中准备缓存为闭包内状态，运行时存储仍由独立场景创建。没有替换外层共享数据库连接，没有修改全局 `fileParallelism: false` 或 gate 的 `--no-file-parallelism`。
- 业务前置探针检查不同 PostgreSQL `system_identifier`，并检查时钟、角色撤销、相同业务键行锁和 SQL 异常的跨环境隔离。角色恢复与锁回滚仍有 `finally` 保障，失败聚合后阻止进入业务测试。
- `available` 在测试体及 afterEach 排空开始前关闭，只有成功收敛且未失败、未取消、未退出才恢复。即使 Vitest 的 hook 先超时，下一例也先在业务入口拒绝。`failed` 和 `closing` 是额外的不可复用条件。
- body 保留在独立的 settlement 跟踪中，未加入自身会调用的 suite drain 集合。正常路径等待 body 和被跟踪操作；异常路径的 settlement 为 60 秒，单次资源释放及 setup join 各为 10 秒，按当前有限阶段最长约 110 秒，为原 120 秒清理 hook 留出余量。资源释放错误保留失败，不能被后续停止容器的成功覆盖。
- setup 与退出共用关闭标记，批次开始前检查退出；startup 返回后及 migration 后检查关闭状态；setup 的 `finally` 另行释放迟到资源，不依赖可能正在 join setup 的 `environment.close`。重复释放会收集后续新增连接，容器 stop Promise 复用以避免重复停止。
- `initial-context-suite.ts` 的共享变更只增加诊断 heartbeat 的登记和 disposal 清除；业务准备、时钟计算、等待、断言和 drain 规则没有被改写。该变更用于防止异常测试体留下持续诊断计时器。
- 验证基准及 Module-Test 已同步四入口、隔离范围、异常收敛和证据边界。没有修改生产模块、公开 Contract、Migration、SQL 或原有 unsupported-final 调度器。本轮不扩展到修复后者的既有生命周期设计。

## 历史失败轮次与本轮处置

前一轮审查针对当时**未提交工作区**，不能为它补造 reviewed commit SHA。保留的旧调度器副本为 `/private/tmp/zhiju-initial-context-optimization/initial-context-isolated-cases.ts`，SHA-256 为 `44949b80d231d70d122d9eb322dbce3832bdd5da4f7f596a48b457e19d433cc3`。原反例来自 `/private/tmp/zhiju-initial-context-review-20261011/`，并通过真实 Vitest 调度执行；其资源层是诊断替身。

| 历史发现 | 原有直接反例 | 当前处置与证据 |
| --- | --- | --- |
| P2：drain hook 超时后可能复用未完成排空的环境 | `review-drain-0.log` 出现 hook timeout；`drain-reused.json` 中 `drain-blocked:1` 后仍出现 `body:second` | **已修复**。排空前撤销 `available`，hook 返回后再次检查测试结果及取消状态。当前 `drain-hang`、`drain-hook` 回归均要求无 `body:second`，并保留失败及清理。 |
| P2：永久 pending 的 body 阻止 disposal/stop | `body-reused.json` 与 `body-fresh.json` 均保留 `unclosed:["1"]`；对应日志出现测试/hook timeout | **已修复**。有限 settlement 失败后仍进入资源释放；body、drain 和 dispose 挂起分别覆盖。当前 reused/fresh、健康组、及时结束的迟到 body 均有对照；后者仍要求 body 收敛发生在 disposal 前。 |
| P2：setup 超时退出后的迟到 startup 遗漏清理且继续准备 | `setup-fresh.json` 中先停止 1/2，随后仍出现 `started:3`、`prepared:3`，`unclosed:["3"]` | **已修复**。全局退出标记阻止下一批准备；迟到 startup 立即进入释放路径。当前 `setup-late` 要求容器 3 已停止且没有 `suite:3`/`migrated:probe-3`；`setup-hook`、`setup-failure` 另覆盖 hook 提前超时和部分准备失败。 |

这些历史失败记录不改写为当时通过，也不以旧轮次的局部成功取代当前复审。

## 验证与语义证据

| 证据 | 本轮核对结果 | 边界 |
| --- | --- | --- |
| 当前身份与 diff | `vibe repo --json`、GitHub PR 读取均为上述 head/base；`git diff --check` 通过 | 本页写入前工作区干净。 |
| 本地 full 的源码对应 | 逐一从已审提交读取全部 11 个变更文件，与 `verified-source-manifest.json` 的 SHA-256 及磁盘内容比对，全部一致；基线到 head 的变更集合也与清单完全相等 | full 在代码提交前运行；以内容清单建立对应，未伪称当时已有该 commit。 |
| 配置化完整门禁 | `/private/tmp/zhiju-initial-context-fixes-20261011/full-verification-output-excerpt.log` 保留 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`；97 个普通文件/2010 测试、52 个持久化文件/657 测试通过，浏览器 fixture 4 项通过；第二次 migration no-op，gate 容器已移除 | 原输出中间有工具截断；本轮直接核对保留的 totals、PASS JSON、固定 PostgreSQL 18.6/Flyway 11.20.3、migration 和 cleanup 记录，没有声称逐条读到全部测试日志。未重复运行昂贵 full。 |
| 生命周期窄范围复验 | 本轮独立执行 `node node_modules/vitest/vitest.mjs run tests/business/initial-context-isolation.test.ts`：1 文件、11 测试通过，7.46 秒 | 通过当前安装的 Vitest 运行；仅诊断资源与计时缩放，业务测试期限不变。不是 PostgreSQL 证据。 |
| 叶级注册清单 | 独立从固定 base/head 提取注册：92→92 个唯一叶名，无缺失、新增或 timeout 变化；共享入口 79→64，剩余 64 例相对顺序一致 | 只执行注册以提取清单，不执行其业务回调。输出为 `final-leaf-inventory.json`。 |
| 业务表达式与参数 | 固定 base 重算：12→12 个资格变化注册，名称/参数/timeout 无差异；交付的 25 个断言表达式及全部 `runScenario` 调用一致；suite 断言不变；scenario 和 eligibility-loss helper 内容未改 | 独立核对审计脚本并把旧 `HEAD` 读取固定为上述 base 后执行，输出为 `final-semantic-audit.json`。结合实际 diff 判断业务链保持，未用总数量替代语义审查。 |
| 真实 PostgreSQL 挂起诊断 | 已检查 `real-cleanup-probe.test.ts` 和事件文件：真实 `pg_sleep(3600)`、健康组完成、pending query 收敛，事件中没有不安全复用 | 该诊断的退出码及容器删除在实现方摘要中报告；本轮未取得它的完整原始运行日志，故不把摘要单独作为独立实测证明。真实正常业务及数据库隔离依据上述 full；异常调度结论依据源码与本轮 11 项回归。 |

源清单、full 摘录和原摘要位于 `/private/tmp/zhiju-initial-context-fixes-20261011/`；本轮两个静态复核输出位于 `/private/tmp/zhiju-initial-context-review-20261011/`。它们是本地诊断材料，执行及交付证据继续在 PR 中维护，本页只保存必需的正式审查结论及其依据。

## 未执行与交付边界

- 本轮没有重新执行性能 A/B benchmark；此前局部 15 例计时不能推算为整个 full 的收益，也不能当作生命周期修复后的新基准。
- 真实外部 Runtime/Provider、公开 HTTP 全链路、生产数据库、真实客户业务和独立人工验收均为 `NOT RUN`。此次测试调度优化不改变这些既有状态。
- 本轮未提交、推送、发布 GitHub review 或合并。最终 head 的远端 CI 与本页提交后的差异确认由后续交付步骤完成，不能用本页的代码审查 `APPROVE` 替代它们。
- 审查 `APPROVE` 仅针对所列代码 SHA；后续只新增本页也须确认该差异没有修改代码，再读取最终 head 的所需检查。用户的合并授权和项目其他 Gate 仍分别生效。
