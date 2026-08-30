# IM-05 WI-03 实施计划

日期：2026-08-30
Issue：[#123](https://github.com/qzhike/zhiju-business-core/issues/123)
工作树：`im-05-wi-03-implement-gate-results-impact-reuse`
起始提交：`d04f3fe`

## 目标

在已交付的 WI-01 QualityGovernance 事务基础和 WI-02 Evidence/QualityProfile 生命周期之上，实现 GateResult、ChangeImpact、GateResult 复用/失效，以及 RevisionAcceptanceSnapshot（RAS）和 ReleaseReadinessSnapshot（RRS）的受控持久化与 Handler。

## 已确认边界

- #122 已关闭，#123 的前置依赖满足；#120 仍是 IM-05 父退出门槛。
- 不修改已应用的 `V5000`、`V5001`、`V5002`，新增 forward-only QualityGovernance migration。
- 不跨 Schema 读取其他模块 Repository；跨模块 Artifact/Release/Representation 只通过精确、fail-closed 的公开 Query Port 或已绑定 Typed Reference 校验。
- GateResult、ChangeImpact、GateInvalidation、RAS、RRS 全部保留 canonical payload/hash 和精确 scope；历史事实只追加，不原地覆盖。
- `REVISION_ACCEPTANCE` 与 `RELEASE_READINESS` 严格分离；RAS 不接受 Release Render Gate，RRS 必须绑定冻结 `ReleasePackageRef`、Representation checksum/renderer 与 package hash。
- Provider、Renderer 实际执行、ReleasePublication、公开 HTTP、生产、跨模块业务 E2E 和独立人工客户验收继续标记为 `NOT RUN`。

## 交付计划

1. 先同步 HL-Spec、Module-Spec-005、Module-Test-005 及 PostgreSQL 逻辑模型，冻结 WI-03 的表、状态、错误和测试边界。
2. 新增 GateResult/ChangeImpact/Readiness 的数据库表、不可变触发器、RLS 和 owner mutation functions。
3. 扩展 QualityGovernance Kysely 类型、Repository、fail-closed 业务校验与 Command/Query Handler。
4. 增加 Unit、Contract、Persistence 和受控 synthetic E2E fixtures，覆盖失败 Gate、精确复用、覆盖不足、失效、RAS/RRS 阶段及冻结输入不匹配。
5. 运行聚焦检查、全量静态/契约/测试/迁移门禁，清理 disposable PostgreSQL 和临时测试产物；把实际结果写回 Module-Test 和 GitHub Issue/PR。

## 用户检查点

代码或规格变更完成并验证后，先向用户提供变更文件、关键不变量、测试结果、未运行边界和 Git 状态；未收到用户确认前不执行 `git commit`。

## 当前状态

`IMPLEMENTATION COMPLETE / LOCAL VERIFICATION PASS / DOCUMENTATION SYNCED / USER INSPECTION REQUIRED BEFORE COMMIT`
