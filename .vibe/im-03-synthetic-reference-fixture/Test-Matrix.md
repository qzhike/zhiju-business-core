# IM-03 合成 Reference Project 测试矩阵

- 版本：v0.1
- 日期：2026-08-27
- 状态：`USER CONFIRMED / COMPOSED CONTROLLED PERSISTENCE PASS / SCOPED CLOSEOUT AUTHORIZED / INTEGRATED E2E NOT RUN / MANUAL NOT RUN`
- Fixture：[`Synthetic-Reference-Project-Fixture.md`](./Synthetic-Reference-Project-Fixture.md)

## 1. 使用规则

本矩阵把 Issue #56 要求的父级场景映射到合成 Fixture。矩阵中的“实际输出”在真正执行前必须保持 `NOT RUN`，不能从既有 WI focused 测试结果推导为本矩阵已通过。

使用以下结果标签：

- `PASS (SYNTHETIC CONTROLLED FIXTURE)`：合成数据经 Application/Command 边界实际执行并与预期一致。
- `PASS (COMPOSED CONTROLLED PERSISTENCE)`：多个已存在的 WI focused 合成 fixture 在同一受控 PostgreSQL Gate 中通过，结果不代表单一跨 Aggregate runtime chain。
- `PASS (CONTROLLED PERSISTENCE)`：真实 Disposable PostgreSQL 中的受控持久化链实际通过。
- `NOT RUN`：场景尚未执行。
- `FAIL`：实际输出与预期不一致。
- `BLOCKED`：环境、权限或未决选择阻止执行，并记录阻塞证据。

## 2. Issue #56 父级场景映射

| ID | 层级 | 合成输入/步骤 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-API-U-001` | Unit | `AGENT-SYN-WRITER` 请求把 `re-evaluation-frequency=NOT_PROVIDED` 直接确认成 `MISSING_CONFIRMED` | 拒绝 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；原状态保持 `UNKNOWN` 或 `NOT_PROVIDED` | `tests/persistence/customer-baseline.test.ts` 的 `EP-API-U-001/U-002` 通过；Gate `21 files / 256 tests PASS` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| `EP-API-U-002` | Unit | `GA-SYN-001` 缺 `TB-SYN-001`，或任一 Gap 输入使用 `latest/current` | 拒绝 `PROJECT_GAP_INPUT_INCOMPLETE` 或对应 latest/reference 错误；不创建有效 Gap Version | `tests/persistence/gap-analysis.test.ts` 的 `EP-WI09-P-001/P-002` 以及 Template/Regulatory 精确引用负向用例通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| `EP-API-U-003` | Unit/Persistence | `DI-SYN-001` 只有 `execution.TaskCompleted@1.0`，criteria 还要求 `release.ReleaseCompleted@1.0` | Evaluation=`UNSATISFIED`；不产生 `DeliveryItemCompletionSatisfied`；Item 不被直接设置为 `COMPLETED` | `tests/persistence/delivery-plan.test.ts` 的 `EP-WI12-P/E-001..003` 通过，Task-only=`UNSATISFIED` 且 Item=`NOT_READY` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| `EP-API-C-001` | Contract/Persistence | `PRJ-SYN-001` Command 引用 `PRJ-SYN-002` 的 CustomerMaterial/SourceMaterial，或使用跨 Enterprise Ref | 返回 Scope/Reference 拒绝；不跨 Project 枚举或泄漏替代对象 | Project Scope、SourceMaterial、CustomerMaterial、DeliveryPlan 和 Completion 的 cross-scope/RLS focused fixtures 均通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| `EP-API-C-002` | Contract/Event | 产生 `project.CustomerBaselineVersionActivated@1.0`，包含 `CB-SYN-001`、previous ref、Project Ref 和 impact policy | Event 只含精确 refs/hash/发生事实，不复制 CustomerMaterial 正文；Contract 校验通过 | `tests/persistence/customer-baseline.test.ts` 激活事件 payload、previous ref、impact policy 和精确版本断言通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| `EP-API-E-001` | Controlled E2E | `ENT-SYN-001` → `PRJ-SYN-001` → Source/CustomerMaterial → `CB/TB/RP` → `GA-SYN-001` → Human ACCEPT → `DP/DI` Human APPROVE/ACTIVE | 每一步输出精确 ID/Version/Hash/Scope、Human 决定和预期拒绝；对象链可追溯 | 各 WI focused controlled persistence slice 均通过；没有一个统一 runtime runner 串起全部 Aggregate | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` |
| `EP-API-E-002` | Controlled E2E | 激活新的 `CB-SYN-002` 或 `RP-SYN-002`，重放引用旧 `CB-SYN-001` 的 Context/Gap/Plan | 旧 Context/Gap/Plan 不改写；旧精确 Ref 仍可解析；追加 STALE/Impact Review 和新版本事实 | CustomerBaseline/Gap stale focused fixtures 通过；没有统一 Context→Gap→Plan runtime replay | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` |
| `EP-API-M-001` | Manual/Local | 用户检查合成 Fixture 的完整对象链、状态转换、精确 Ref、Human Gate 和负向输出 | 用户确认这是技术验证数据，不是真实业务结论；确认所有真实外部边界仍为 `NOT RUN` | 文档口径已由用户确认；实际人工浏览/逐项审阅尚未执行 | `NOT RUN` |

## 3. WI focused 场景补充映射

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `SYN-WI03-001` | Persistence | 两个 Enterprise 使用相同 display code | 一个成功，一个返回稳定冲突码；失败不留下 Receipt/Outbox/Edge | `enterprise-project-business-aggregates.test.ts` 的 `EP-WI03-P-*` 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI04-001` | Persistence/RLS | Project A 使用 Project B 的 StartSnapshot/Scope Ref | 稳定 `PROJECT_START_SNAPSHOT_SCOPE_MISMATCH` 或 `PROJECT_OBJECT_SCOPE_MISMATCH`；无跨 Scope 写入 | `enterprise-project-scope.test.ts` 的 `EP-WI04-P-003/P-008` 及 RLS 断言通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI05-001` | Persistence | `SM-SYN-001` 和 `SM-SYN-002` 相同 bytes/hash、不同 origin | 两个 Root/Origin 均保留；只接受被验证的一份 | `enterprise-project-scope.test.ts` 的 `EP-WI05-P-001..P-006` 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI06-001` | Persistence | accepted SourceMaterial 提议 CustomerMaterial；Agent、actingFor、Human 依次确认 | Agent/actingFor 拒绝；Human 产生确认 Version/Decision/Outbox | `customer-material.test.ts` 的 `EP-WI06-P-001/P-002`、RLS 和 source rejection 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI07-001` | Persistence | 三态 Baseline 草稿、Agent 缺失确认、Human Decision、旧版本重放 | 三态不互相推导；只有 Human 可激活；旧版本和 Impact 历史不变 | `customer-baseline.test.ts` 的 `EP-API-U/P/M` focused persistence fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI08-001` | Persistence | 合成 Platform Reference 发布、Template/Regulatory 冻结、错误 latest/hash/Evidence | 精确已发布 Ref 通过；latest/hash/Evidence 混用拒绝；冻结历史不可更新 | `template-regulatory.test.ts` 的 `EP-WI08-U/P/C` focused fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI09-001` | Persistence | `GA-SYN-001` 固定输入后激活新的 Baseline/Profile | 旧 Gap 进入 STALE 并追加 Impact；旧 InputSnapshot/Finding/Decision 不改写 | `gap-analysis.test.ts` 的 `EP-WI09-U/P/E/M` focused fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI10-001` | Persistence | DeliveryPlan 含环依赖、重复 key、Agent 批准、Human 批准/激活 | 非法计划和 Agent 批准拒绝；Human 决定后才 ACTIVE | `delivery-plan.test.ts` 的 `EP-WI10-U/P/E/C/RLS/M` focused fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI11-001` | Persistence/Projection | 暂停 Projection 后读取权威 Source Slice、active refs 和 Board | omissions/redactions/watermark 正确；Projection lag 不改变权威状态和 Completion criteria | `query-projection.test.ts` 的 Source Slice、active refs、Board、pause/lag/cursor fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI12-001` | Persistence | Task-only、补齐 Release、同 hash replay、不同 hash conflict、revoke/new version/late fact | UNSATISFIED → SATISFIED；replay 幂等；冲突 Quarantine；历史只追加、不改写 | `delivery-plan.test.ts` 的 `EP-WI12-P/E-001..006` 及 RLS fixtures 通过 | `PASS (CONTROLLED PERSISTENCE)` |

## 4. 输出记录模板

执行每个场景时，必须把以下模板复制到实际验证记录中并填写，不把规划内容当作结果：

```text
Scenario ID:
Fixture Key: IM03-SYNTHETIC-RP-001
Scope: SYNTHETIC / TECHNICAL ONLY
Environment:
Input:
Exact refs / versions / hashes:
Expected output:
Actual output:
Receipt / event / watermark:
Rejected attempts and error codes:
PASS / FAIL / BLOCKED / NOT RUN:
Command or observation evidence:
Timestamp:
Cleanup:
Remaining risk:
```

## 5. 通过条件和不通过条件

### 可以标记合成技术场景通过

- Application/Command 边界实际执行成功或按预期拒绝；
- 业务对象没有通过直接 SQL 创建或修补；
- 精确 ID/Version/Hash/Scope 可回读；
- Human/Agent/`actingFor` 的权限边界与预期一致；
- Replay、CAS、RLS、immutable、stale/impact 和 Completion 结果有实际输出；
- 测试后的容器、临时脚本和构建缓存按 Runbook 清理。

### 仍必须保持 `NOT RUN`

- 真实客户业务适用性；
- 真实 Feishu/Provider/对象存储/生产数据库；
- 公开 HTTP 和真实跨模块 Event Bus/Process Manager；
- Artifact、QualityGovernance、ReleasePublication 的真实业务 Handler；
- 独立真实业务用户验收。

## 6. 当前结论

本矩阵已由用户确认，并完成一次 composed controlled persistence Gate：`21` 个 persistence 文件、`256` 个测试通过，空库迁移、二次 no-op 和容器清理通过。该结果只覆盖现有 WI focused 合成 fixtures 的技术组合证据；没有一个统一 runtime runner 串起所有 Aggregate，因此 `EP-API-E-001/E-002` 的 integrated cross-aggregate execution 和 `EP-API-M-001` 的人工逐项审阅继续为 `NOT RUN`。结果记录见 [`Verification-Record.md`](./Verification-Record.md)。用户后续已明确授权以该 scoped technical evidence 关闭 Issue #56；这不会把上述 `NOT RUN` 改写为 `PASS`。
