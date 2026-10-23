# PR #313 第一阶段批次交付独立审查

本文记录已完成的语义审查与发现处置。当前未解决阻塞发现为 0；本地实施候选已通过独立复审。包含本 Review 的最终提交及其远端 CI 尚待确认，本文不提前给出该最终候选的 APPROVE，也不授权合并或远端启用。

## 审查对象与阶段

- 审查日期：2026-10-22 至 2026-10-23。
- 对象：[PR #313](https://github.com/qzhike/zhiju-business-core/pull/313)，第一阶段批次路由、候选绑定和主干准入的工程引导交付。
- 被审实现提交：`6c429c7bb6ca3b991ff61a66b8ee574aade7a993`；基线：`3555e85508a17a4c86f302f7da6f1c1be576571b`；目标分支：`main`。
- 阶段：批次模式启用前的工程引导 PR，仍要求 `full`。本 PR 不修改仓库变量或分支保护，不代表批次模式已在远端启用。
- 关联共享技能交付：[agent-config PR #1](https://github.com/galendai/agent-config/pull/1)，被审提交 `8c658a477cba31aedaa4ca6d90d13b92c1b7cfa2`，基线 `753150dfe2ba3f93b55ae3f5b65b93d39795562c`。两个仓库分别取得最终修订审查与适用 CI；其中一个通过不代替另一个通过。
- 用户已批准设计及第一阶段实施，并授权本轮提交、推送、创建 PR、远端 CI 和独立复审；合并、GitHub 设置修改、远端批次启用及第二阶段证据复用不在本轮执行范围。

权威依据为[已批准的批次设计](../../decisions/batch-integration-ci.md)、[验证基准 §2.1.1–§2.1.2](../../high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由)、根 [AGENTS.md](../../../AGENTS.md) 和 [.vibe/project.yaml](../../project.yaml)。本文按设计 §4.3 在最终候选固定前纳入；最终 head/base、实际测试候选、run/attempt 与批准范围在 PR review/comment 中确认，不为回填成功日志再产生提交。

## 独立预期与实际审查

先从批准设计推导阶段要求和失败边界，再检查实际工作流、选择器、准入脚本、汇总、测试及共享角色规则。审查同时覆盖未跟踪文件，没有仅依赖已跟踪文件的 diff 或实施者摘要。

| 独立预期 | 实际审查结果 |
| --- | --- |
| 未显式启用时保持原风险路由；启用后普通业务、UI 和紧急修复先进入同仓库批次 | 变量精确启用条件及同仓库/base 校验存在；业务直接进入 main 即使 full 成功也被拒绝。共享技能只解释项目显式启用的阶段，不给其他项目自动豁免。 |
| 批次出口始终检查累计候选，文档或 UI 批次不能降级 | 选择器基于完整 base-to-candidate diff，批次到 main 优先选择 full；工程和未知路径不获子 PR 降级。 |
| 批次、子 PR 与主干批准不能混用旧目标或旧候选证据 | PR edited 重新路由；实际 checkout、合并双亲、事件 repository/base/head 与当前 PR API 边界相互核对，漂移或读取失败拒绝准入。最终检查到合入之间仍需要平台保护及精确 head 核验。 |
| 失败、取消、缺失、意外 skipped 和跨 attempt 成功拼接不能收口 | 汇总要求选中任务成功；full 要求三个 persistence 分片；R1 修复后还逐层核对任务实际执行的 attempt。 |
| 第一阶段保留 main 合入后 full，不实现同 tree 复用 | 批次来源的 main push 保留 full；严格独立文档例外单独证明来源和累计范围。没有交付第二阶段复用开关或跨 SHA 免跑工具。 |
| 阶段验收、失败恢复和正式 Review 保持一致 | 子任务批准只覆盖指定集成阶段；批次失败维持冻结并由 Implementer 修复、独立 Reviewer 复核；子任务关闭不等于产品目标交付；实质性 Review 变化形成新候选。 |

已检查 reusable workflow 的同提交引用、调用上下文、输出传播和 concurrency 隔离；当前 caller 与 callee 不使用相同取消组。该静态语义核对不代替真实 GitHub 运行、check 名称或保护配置验收。

## R1：跨 attempt 成功拼接

- 严重性：P2。
- 状态：CLOSED。
- 原因：原候选只核对 `needs.result`，准入仅记录当前 `runAttempt`，没有证明各成功任务来自当前 attempt。分片 2 在 attempt 1 失败、其余检查成功后，仅重跑失败任务可能组合旧成功和本次成功，通过汇总。GitHub 支持全量、失败任务和单任务重跑；保留同一 SHA/ref 不能证明本次已重跑全部任务。该行为违反批准设计 §4.2 的完整重跑规则。
- 修复：[ci.yml](../../../.github/workflows/ci.yml) 和 [persistence.yml](../../../.github/workflows/persistence.yml) 从实际执行的 producer step 输出 attempt；选路、普通检查、三个分片、persistence 汇总及 verify 逐层传播。[check-ci-results.mts](../../../tools/verification/check-ci-results.mts) 要求各选中任务的输出属于当前 attempt；[check-delivery.mts](../../../tools/verification/check-delivery.mts) 在 main 准入时要求 reusable verification 输出与当前 attempt 一致。未增加 Actions API 或第二阶段证据复用。
- 独立复核：同 attempt 2 的完整结果在两层汇总均接受；分片 3 或 checks 沿用 attempt 1 时，分别返回 `expected current attempt 2`；main-admission 当前 attempt 为 2、verification attempt 为 1 时，实际 CLI 退出 1 并拒绝。输出在任务成功执行步骤产生，未用新的 job 表达式重算旧任务的身份。
- 覆盖：[汇总回归](../../../tools/verification/check-ci-results.test.ts)、[工作流拓扑回归](../../../tools/verification/ci-workflow.test.ts) 和[准入 CLI 回归](../../../tools/verification/batch-delivery-cli.test.ts)覆盖同 attempt 完整重跑、混合 attempt、缺失及单独重跑准入的拒绝路径。真实 GitHub 重跑试点仍待平台验收。

## 修订身份与验证证据

修复后的本地候选清单包含项目与共享技能共 22 个文件，清单 SHA256 为 `6d6c827f3d8d384da5d325e67a97a20950ca35285745d86ffc0af28830d4fc47`。Reviewer 独立重算确认 22 文件全部一致；项目与共享技能基线分别为本文件列出的两个基线提交。哈希只证明内容身份，不证明运行或平台行为。

该候选的 `vibe verify full --json` 终态为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。Reviewer 已读取保存的工具返回结果，确认以下汇总：

| 验证层 | 结果 |
| --- | --- |
| 普通测试 | 156 文件、3270 测试通过 |
| 两组浏览器检查 | 10 项和 86 项通过 |
| PostgreSQL | 65 文件、747 测试通过 |
| Critical inventory | 5 文件、96 用例通过 |
| Persistence 文件库存与清理 | 65 文件库存通过，gate passed，postgres container removed |

保存的工具返回结果带有超长中段截断标记；终态、各层汇总与容器清理结果保留，不能称为未截断的全量日志。此前因修复而主动中断的旧候选 full 不计为 PASS。执行证据由原任务在 PR 中交付，不把本机路径、凭据或完整诊断输出放入公开文档。

原任务另外提供本轮 `vibe verify delivery --json` 的 5 文件、394 测试 PASS，验证工具 TypeScript 子项目检查 PASS，以及共享技能的 18 相对链接和 69 项既有 conformance 回归 PASS。Reviewer 对 R1 做了上述独立窄诊断，没有为重复取证再运行 full；这些聚焦结果不替代最终发布候选的远端 full。

从本地候选到被审发布提交，项目仅调整设计文档的实施状态和交付授权文字；其余原候选文件哈希不变。设计文档已消除过时的“仅设计”“禁止提交”表述，保留远端启用 NOT RUN、main full 和第二阶段未实施。关联共享 PR 的 7 个技能文件与原候选一致，新增工作流只执行技能元数据、相对链接及既有离线 conformance/matcher 回归，不把它们冒充真实 Agent 行为验收。

## 待完成边界与最终确认

- 本 Review 纳入后形成的新 head，须复核新增文档及受影响结论，并获得适用的最终候选远端 CI。文档写入时该最终证据仍待完成，不能将前述本地 PASS 改称最终远端 PASS。
- 原会话统一核对两个 PR 的最终 head/base、实际 checkout/tree、workflow/run/attempt、选中 target 和任务结果，并交回同一独立 Reviewer；Reviewer 不另行轮询 CI或注册 waiter。
- 远端批次启用、main/batch 分支保护、实际 check 名称与保护绑定、改 base 和基线更新负例、真实重跑及合并树试点仍为 NOT RUN。
- 本轮不合并；main 合入后 full、批次产品交付、生产/外部服务/人工验收均不能由本审查推定完成。第二阶段同 tree 证据复用未实施。
- 本文件是语义审查和发现处置记录。最终独立结论、PR comment 与 GitHub formal approval 的实际发布类型必须区分；任何结论均不增加合并或设置修改授权。
