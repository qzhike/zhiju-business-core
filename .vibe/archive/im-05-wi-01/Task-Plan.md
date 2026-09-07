> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-05-wi-01/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-05-wi-01/Task-Plan.md).

# IM-05 WI-01 QualityGovernance Application/Persistence 任务计划

日期：2026-08-30
状态：`IMPLEMENTATION COMPLETE / LOCAL VERIFICATION PASS / REMOTE DELIVERY TRACKED IN ISSUE #121`

## 1. 范围

本工作项交付 Issue #121 的 QualityGovernance 技术事务基础。复用已经应用的 `V5000__quality_governance_technical_tables.sql` 与 owning roles，不修改历史 Migration；首轮 PostgreSQL 负向探针发现 app role 仍可直接解析两个 trigger guard function，因此通过 forward-only `V5001` 收紧 EXECUTE ACL。不创建 Evidence、QualityProfile、GateResult、ReviewIssue、Approval、RAS、ABS 或 RRS 业务表。

## 2. 里程碑与可手测产出

1. 文档与边界同步：订正 HL-Spec、Module-Spec-005 与 Module-Test-005；人工检查可确认业务非目标和 `NOT RUN` 边界。
2. Application/Persistence 基础：实现单连接事务 Context、Canonical Payload Hash、Receipt 幂等、BigInt CAS、Inbox/Process/Audit/Outbox/Reference Edge 原子组合；人工检查可读取脱敏 PostgreSQL 探针表。
3. 跨模块 Query Port：只通过 IdentityPolicy、EnterpriseProject、Artifact 的公开精确校验端口消费引用，不跨 Schema 读取 Repository；人工检查可确认错误 Ref 在回调边界被拒绝。
4. 验证与交付：运行聚焦 Unit、真实 disposable PostgreSQL、完整 `pnpm clean && pnpm verify`，随后进行精确范围 Git/GitHub 交付与远端回读。

## 3. 验收判定

- 同 key/same hash 重放首个已提交结果；同 key/different hash 返回稳定冲突。
- 同 expected version 并发写只有一个提交，版本使用字符串/BigInt 保持精度。
- Receipt、业务回调、Inbox、Process、Audit、Outbox、Reference Edge 同事务提交或回滚。
- 缺失、伪造、过期 Context，跨 Enterprise/Project、直接 SQL、DDL、owner escalation 与跨 Schema 读取被真实 PostgreSQL 拒绝。
- 三个外部依赖只通过公开 Query Port 做精确 Ref/Scope/Hash 校验。
- 空库 Migration、二次 no-op、聚焦测试、完整 Gate 与容器清理通过。

## 4. 保留边界

Renderer、ReleasePublication 业务流、外部 Provider、公开 HTTP、生产数据库、跨模块业务 E2E、独立人工业务验收以及全部 Quality 业务 Handler 保持 `NOT RUN`。

## 5. 本地结果

- 新增 Unit：2 个文件、5 个测试通过。
- 完整普通 Vitest：34 个文件通过、25 个按环境受控跳过；395 passed、278 skipped。
- Architecture：`PASS`；Catalog/Registry：201/201 `FULL`；冻结兼容性基线：200。
- disposable PostgreSQL 18.6 / Flyway 11.20.3：29 个文件、293 个测试通过；空库应用 32 条 Migration（含 forward-only V5001），第二次 migrate 为 `No migration necessary`，容器已删除。
- 首轮 guard direct-call 探针实际为 `0A000`，经 V5001 收紧后复验为 `42501`；该失败与修复均保留在 Module-Test-005。
