> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/09-gap-analysis.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/09-gap-analysis.md).
> Published Issue: [#65](https://github.com/qzhike/zhiju-business-core/issues/65); this file is a historical draft, not its current body.

## 目标

实现 GapAnalysis 的冻结输入、不可变 finding、Human 接受与 stale 语义；Gap 只表达建议，不直接形成项目承诺。

父追踪：#56

硬依赖：#63、#64

## 范围

- `gap_analysis`、version/finding/decision Migration、Repository、Handler 与事件。
- `project.start_gap_analysis`、`project.accept_gap_analysis`、`project.GapAnalysisAccepted`。
- FORMAL/EXPLORATORY 输入规则；Customer/Template/Regulatory/Profile/QMS/Product/Policy 精确引用。
- `UNKNOWN` 不转 `MISSING`；输入变化标记 stale/产生新分析，不覆盖旧版本。

## 验收条件

- [ ] FORMAL Gap 缺任一必需冻结输入、使用 `latest` 或 scope/hash 不匹配时拒绝。
- [ ] finding 创建后不可变；完成版本不因新 Baseline/Profile 自动重算或覆盖。
- [ ] 只有授权 Human 可 ACCEPT；REJECT/CHANGES_REQUIRED 不形成 accepted pointer。
- [ ] Agent/actingFor 不能接受 Gap；Gap accepted event 包含精确 input snapshot 和 decision ref。
- [ ] EP-API-U-002 与 stale/replay/并发接受场景在真实 PostgreSQL 和 focused tests 通过。
- [ ] 用户可对同一旧输入接受 Gap，再激活新 Baseline，看到旧 Gap 保留且状态/Impact 可解释。

## 非目标与 `NOT RUN` 边界

- 不实现通用 AI Gap 算法或外部法规分析 Provider；受控 Evaluator/Fixture 只用于验证领域边界。
- Gap 接受不自动批准或激活 DeliveryPlan。
