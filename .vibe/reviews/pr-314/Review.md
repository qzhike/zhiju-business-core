# PR #314 独立审查记录

## 阶段、候选与范围

- PR：[#314](https://github.com/qzhike/zhiju-business-core/pull/314)。
- 阶段：第一阶段远端启用试点的文档子 PR；目标分支为 `batch/ci-activation`。
- 试点起点：main 修订 `4657f10c44a1645a38188c5c36be0e3c529902c2`。
- 初始文档修订：`a5f56f628081aa6a1324b40001897f0497329fe4`。
- 本记录形成于 2026-10-23，已复核初始文档及其后的工作区修正；包含本记录的最终提交与检查仍待确认。

范围仅为[验证基准的远端启用操作约束](../../high-level-docs/08-verification-baseline.md#远端启用操作约束)，不修改业务行为、CI 路由实现、测试覆盖或第二阶段证据复用。审查依据为[已批准批次设计](../../decisions/batch-integration-ci.md)、[项目规则](../../../AGENTS.md)和[验证目标配置](../../project.yaml)。

## 独立语义审查

本阶段应准确说明普通批次及故障恢复批次的起点、创建与后续更新的保护边界、正式批准要求、既有 PR 切换检查及失败回退。文档不能把平台设置等同于已完成验收，也不能改变批次出口 full、合入后 main full 或正式 Review 要求。

修正后的条款保留至少一个正式批准、当前基线验证、最新推送批准、对话解决、普通 merge commit 和无管理员或应用旁路。Agent 的审查评论不替代 GitHub formal approval。创建来源由执行者及独立 Reviewer 核对，后续更新继续经过 PR、阶段检查与审查；变量切换不自动重跑既有 PR，旧关闭模式结果不能证明新模式准入成立。

## 发现与处理

### R1：批次起点约束遗漏故障恢复例外（P2，已关闭）

初始文本无条件要求所有批次从已通过 main full 的修订创建，与批准设计 §4.2 及验证基准既有恢复条款冲突。main 合入后 full 失败且需要代码修复时，设计允许从故障 main 建立明确标注的专用单 PR 恢复批次。

修正将成功 main 起点要求限定为普通批次，明确保留故障修订、最近已验证基线、禁止业务扩展和恢复候选合入前后 full。Reviewer 已复核实际修订，确认恢复语义与批准设计一致。关闭 R1 仅表示该文档冲突已消除，不表示最终检查或恢复平台试点已完成。

### 配置建议修订依据

Reviewer 曾建议将 batch 的 `do_not_enforce_on_create` 设为 `false`，以避免创建时豁免状态检查。进一步对照故障恢复规则后撤回该项必要性判断：该设置也会要求故障 main 起点已有成功的 `verify`，从而阻断设计允许的恢复批次；仅修改文档不能解除此矛盾。

修订结论为 batch 使用 `do_not_enforce_on_create=true`，同时保留 `deletion`、`non_fast_forward`、PR、严格 `verify`、GitHub Actions 来源绑定和空 bypass。创建豁免不授权夹带未经审查的变更，不取消后续更新门禁，也不证明起点来自 main。删除保护保留；已完成分支的清理仍须针对确切获授权对象处理。

上述判断依据 [GitHub Rules API 的创建检查参数](https://docs.github.com/en/rest/repos/rules)及[独立删除、PR 与状态检查规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。它是配置语义判断，不是删除重建攻击或故障恢复路径已完成平台实测的声明。原执行会话负责设置变更、实际规则读回及平台验收证据。

## 验证与最终确认边界

- 本次属于已批准操作约束的文档澄清，本阶段执行配置目标 `docs`。
- 原执行会话已交接初始修订的本地 docs 成功，以及[运行 39890494201](https://github.com/qzhike/zhiju-business-core/actions/runs/39890494201) attempt 1 的 `verify` 成功、App `15368`。该运行属于旧关闭模式和初始候选，仅支持当时检查名称及来源绑定，不能覆盖后续文档修正和本记录。
- 包含修正及正式 Review 的最终候选，其 docs、远端 CI、准确 head/base 与本记录适用性仍待复核。本记录不提前作最终批准；最终确认留在 PR review/comment，不为回填成功日志另造提交。
- 整批远端启用与平台验收尚未完成。创建豁免后的保护行为、启用后的路由及拒绝路径、重跑恢复、批次出口与合入后验证，以实际试点 PR 中的证据为准，未执行项不得记为通过。
- 子 PR 的最终批准仅适用于进入 `batch/ci-activation`。批次进入 main 前仍须累计候选 full、独立审查及所需正式批准，合入后仍须 main full；第二阶段证据复用未实施。

后续实质发现、修复或批准范围变化须更新正式记录并重新审查受影响候选。最终验证及精确候选确认完成之前，本记录承载语义审查和发现处理，不代表主干交付或整批验收完成。
