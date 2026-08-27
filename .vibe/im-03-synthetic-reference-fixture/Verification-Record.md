# IM-03 合成 Reference Project Composed 技术验证记录

## 1. 记录状态

- 验证日期：2026-08-27
- Fixture Key：`IM03-SYNTHETIC-RP-001`
- 验证范围：`SYNTHETIC / TECHNICAL ONLY / COMPOSED CONTROLLED PERSISTENCE`
- 当前结论：`PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN; MANUAL NOT RUN`
- 工作目录：`/Users/galendai/orca/workspaces/zhiju-business-core/im-03-enterpriseproject-reference-foundation`
- 本地 HEAD：`d256e52148f1ba9807d0eb0f27230ba649d07bb6`
- `origin/main`：`d256e52148f1ba9807d0eb0f27230ba649d07bb6`

## 2. 运行命令与环境

执行：

```text
pnpm persistence:gate
```

实际输出：

| 项目 | 实际输出 | 结果 |
|---|---|---|
| PostgreSQL 镜像 | `postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` | `PASS` |
| PostgreSQL | `server_version=180006` | `PASS` |
| Flyway | `11.20.3` | `PASS` |
| 空库迁移 | 迁移完成，V2013 `delivery item completion impact` 为 `Success` | `PASS` |
| Persistence tests | `21 passed (21)`；`256 passed (256)` | `PASS` |
| 二次迁移 | `Schema "public" is up to date. No migration necessary.` | `PASS` |
| 清理 | `postgres container removed` | `PASS` |

首次拉取 PostgreSQL 镜像时出现一次 Docker Hub 网络超时，Gate 按既定重试策略继续执行，之后容器启动、迁移和全部测试均通过；该环境事件不计为业务断言失败。

## 3. Composed 技术证据映射

本次没有新增一个把所有 Aggregate 串在同一个 runtime identity 下的测试 Runner；使用现有 WI focused fixtures 组成技术验收证据。每个测试仍通过其实际 Handler/Repository/Application 边界执行，数据库只用于观察或验证拒绝。

| Fixture 场景 | 现有实际证据 | 结果 |
|---|---|---|
| `SYN-WI03-001` | `enterprise-project-business-aggregates.test.ts` 的 Enterprise、Fact、Product、QMS、Profile 和精确 Hash/Scope 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI04-001` | `enterprise-project-scope.test.ts` 的 Project Snapshot、Scope Claim、跨 Enterprise/Project 和 RLS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI05-001` | `enterprise-project-scope.test.ts` 的相同 Hash 不同 Origin、Source acceptance、immutable、replay 和 RLS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI06-001` | `customer-material.test.ts` 的 Source→Proposal→Agent/actingFor/Human confirmation、版本和 Event 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI07-001` | `customer-baseline.test.ts` 的三态、Human-only、旧版本、active pointer、Impact 和 CAS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI08-001` | `template-regulatory.test.ts` 的 Platform publish、精确冻结、Evidence 分离、latest/hash、immutable 和 CAS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI09-001` | `gap-analysis.test.ts` 的精确输入、latest/hash、UNKNOWN、Human accept、Replay、CAS、stale/Impact 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI10-001` | `delivery-plan.test.ts` 的 DAG、Human approval/activation、exact Decision、Event minimality、CAS、RLS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI11-001` | `query-projection.test.ts` 的 Source Slice、active exact refs、criteria、cursor、pause/lag、rebuild 和 RLS 用例 | `PASS (CONTROLLED PERSISTENCE)` |
| `SYN-WI12-001` | `delivery-plan.test.ts` 的 Task-only、Release-complete、Replay/Quarantine、revoke/new-version、late fact、CAS、rollback、ACL/RLS 用例 | `PASS (CONTROLLED PERSISTENCE)` |

## 4. Issue #56 父级场景判定

| 场景 | 本次结果 | 边界 |
|---|---|---|
| `EP-API-U-001` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` | CustomerBaseline focused fixture 实际拒绝 Agent `MISSING_CONFIRMED`；不是统一 Reference Project runner |
| `EP-API-U-002` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` | Gap/Template/Regulatory focused fixtures 实际拒绝缺失和模糊 Ref |
| `EP-API-U-003` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` | WI-12 Task-only 实际为 `UNSATISFIED`，Item 保持 `NOT_READY` |
| `EP-API-C-001` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` | 各 owning boundary 的 cross-scope/RLS focused negative 通过 |
| `EP-API-C-002` | `PASS (COMPOSED CONTROLLED PERSISTENCE)` | CustomerBaseline activated Event 精确 refs/hash/minimality 断言通过 |
| `EP-API-E-001` | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` | 没有一个 runtime runner 贯穿 Enterprise→Project→Material→Baseline→Gap→Plan |
| `EP-API-E-002` | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` | stale/Impact 组件证据通过，统一旧 Context→Gap→Plan replay 未执行 |
| `EP-API-M-001` | `NOT RUN` | 用户确认了技术-only口径，但尚未实际逐项浏览和人工验收运行输出 |

## 5. 未运行边界

以下边界不因本次 Gate 通过而升级：

- 真实客户业务适用性、采购制度、法规判断和审批组织；
- 真实 Feishu、Provider、Ceph RGW、OpenBao、对象存储和生产数据库；
- 公开 HTTP/E2E、真实跨模块 Event Bus/Process Manager；
- TaskExecution、Artifact、QualityGovernance、ReleasePublication 的真实业务 Handler；
- 独立人工 Reference Project 验收。

以上均为 `NOT RUN`。Issue #56 不能仅凭本记录关闭。

## 6. 清理与后续

- Persistence Gate 已移除 PostgreSQL 容器。
- Gate 未新增临时脚本或临时测试文件；测试后执行 `pnpm clean` 清理 TypeScript 构建缓存。
- 本记录、Fixture 文档和测试矩阵当前尚未提交 Git。
- 下一步若要将 `EP-API-E-001/E-002` 标记为 integrated PASS，需要另行实现并评审统一 runtime Fixture Runner；这不是本次 composed Gate 的结论。
