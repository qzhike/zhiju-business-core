> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-05-rrs-current-validity/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-05-rrs-current-validity/Task-Plan.md).

# IM-05 RRS 当前有效性阻断修复计划

## 背景

IM-05 父级 Issue #120 要求 ReleasePublication 在 `validate_release_readiness` 与 `authorize_release` 的事务内验证最新且仍有效的 Release Readiness Snapshot。当前 exact snapshot Query 只回放不可变历史 RRS；旧 `READY_FOR_AUTHORIZATION` RRS 在上游失效后仍可被读取，Release 端缺少当前有效性判断。

## 成功标准

1. QualityGovernance 提供窄化、权威、fail-closed 的 RRS 当前有效性 Query，能够识别指定 RRS 已被上游 Gate invalidation 或更新 readiness 取代。
2. ReleasePublication 在 readiness validation 与 Human authorization 写入前调用该 Query；不允许回退到历史快照内部状态。
3. 旧 READY RRS 后续失效时返回稳定拒绝，且 Release version、Authorization、Attempt、Receipt、Event、Outbox 和外部 Adapter 调用无新增。
4. 当前 READY RRS 正向路径保持通过；错误 Scope/hash、Query unavailable/undefined/exception 均 fail-closed。
5. HL-Spec、Module-Spec-005/006、Module-Test-005/006 与代码、测试结果一致。
6. 聚焦测试、`pnpm clean && pnpm verify`、disposable PostgreSQL、第二次迁移 no-op 和测试清理全部通过。

## 执行步骤

1. 先订正文档，冻结 Authority Query 输入、输出、错误和事务边界。
2. 实现 Quality 当前性判断及公开 Handler/Port。
3. 将 Release validate/authorize 接入当前性查询。
4. 增加 Unit、受控 Runtime 和 PostgreSQL 负向回归。
5. 执行全量验证并记录输入、预期、实际和 `NOT RUN` 边界。
6. 完成代码审核；等待用户检查确认后再创建 Git 提交。

## 保留边界

真实 Provider/Feishu、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人确认和独立业务验收继续为 `NOT RUN`。本修复只处理父级要求的当前有效 RRS 技术门禁，不扩展外部系统范围。
