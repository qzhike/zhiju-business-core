# PR #315 独立审查记录

## 阶段、候选与范围

- PR：[#315](https://github.com/qzhike/zhiju-business-core/pull/315)。
- 阶段：第一阶段平台验收的可抛弃探针，不承担业务交付。
- 初始目标：`batch/ci-activation`，base 为 `4657f10c44a1645a38188c5c36be0e3c529902c2`。
- 初始被审 head：`e5c74375bf72ea933914d1cbc7d2c28cae17f96e`。
- 本记录形成于 2026-10-23；包含本记录的最终 head、实际 base 与相应检查仍须另行确认。

实施范围只有 [tests/fixtures/batch-delivery-platform-probe.txt](../../../tests/fixtures/batch-delivery-platform-probe.txt) 的 3 行惰性文本及本正式 Review。目标是验证启用后的 code 路由、同一 head 改 base 为 main 时的准入拒绝，以及批次基线前进后旧候选证据失效。不改变业务代码、CI、测试断言、路径允许范围或第二阶段证据复用。

本 PR 不得合入批次或 main；完成已授权平台试验并记录证据后，保留正式 Review，按授权关闭而不合并。临时改 base 仅用于负例，不能由探针检查成功推导出业务交付批准。

## 独立语义审查

依据[批准设计](../../decisions/batch-integration-ci.md)、[验证基准](../../high-level-docs/08-verification-baseline.md#212-批次交付第一阶段)及[配置目标](../../project.yaml)，本探针应触发现有业务路径分类，同时保持运行行为不变；不能为了制造负例而修改业务实现或验证门禁。

实际新增文件是普通文本，不包含可执行代码、客户数据或运行配置。引用搜索未发现该文件的程序消费者；现有 [Vitest 收集规则](../../../vitest.config.ts)只收集 `.test.ts` 和 `.test.tsx`，该文件不增加或替换可执行测试。现有 fixture 读取位置未显示对该探针的加载。

现有[路径分类器](../../../tools/verification/select-target.mts)明确接受 `tests/fixtures/` 下的 `.txt` 作为批次业务路径，而严格文档只接受仓库 README 或 `.vibe/` 下的 Markdown。因此同仓库合法批次目标下，此文件与正式 Review 的完整累计 diff 应选择 `code`；新增 Review 不能把整个 PR 降级为 `docs`。该结论不要求改变分类器。

改 base 为 main 后，即使 head 相同，也必须按新的目标重新路由和准入；非批次来源、非严格文档的该探针不得直达 main。批次 base 前进后，旧组合的成功检查也不能代表新候选已通过。两项均为待执行的平台接受标准，本记录不将代码语义推导写成平台实测成功。

## 发现与处理

在上述惰性内容及可抛弃范围内，未发现阻塞语义问题。范围不包含新的业务能力或业务验收；探针的 code 结果仅证明所选验证与平台路径，不代表持久化、生产、人工或完整批次验收通过。

若平台试验发现实现缺陷，应另行记录具体边界、候选和原始结果，按既有修复与独立复审规则处理；不能在本探针中顺带修改 CI 或业务代码，也不能把预期的准入拒绝标为交付成功。

## 验证与最终确认边界

- 原执行会话已交接初始 head 的本地 `code` 成功：普通测试 156 文件、3270 用例，生产及 fixture 浏览器用例分别 10 和 86，通过构建、格式、lint、类型、Architecture 与 Contract 检查。该结果不覆盖随后新增正式 Review 的最终提交。
- 初始远端[运行 39892050377](https://github.com/qzhike/zhiju-business-core/actions/runs/39892050377) attempt 1 在本记录形成时仍待终态，本 Reviewer 未查询或轮询 CI。
- 正式 Review 提交后形成新 head；最终 code 检查必须绑定该新 head 和当时实际 base、测试合并候选、tree、run/attempt。旧 head 的成功不能替代新候选证据。
- 同 head 改 base 的拒绝、恢复批次目标后的检查，以及批次基线前进后的旧证据失效，均须保留各自实际边界和平台结果；改变目标或基线时重新判断证据适用性。
- 本记录只完成可进行的语义审查，不提前作最终批准。最终试验结论在 PR review/comment 确认，不为回填成功日志另造提交；实质发现与修复仍须更新正式记录并重新复核。
- 整批平台验收、批次进入 main 前的 full、最终累计审查及合入后的 main full 不由本探针替代。第二阶段证据复用未实施。

后续确认仅可用于本探针验收与按授权关闭，不授权将该探针合入批次或 main。
