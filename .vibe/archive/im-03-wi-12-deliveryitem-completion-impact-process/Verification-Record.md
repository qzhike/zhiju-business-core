> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md).

# IM-03 WI-12 DeliveryItem Completion 与 Impact Process 验证记录

## 1. 记录状态

- 记录日期：2026-08-27
- Issue：[#68](https://github.com/qzhike/zhiju-business-core/issues/68)
- 工作目录：`/Users/galendai/orca/workspaces/zhiju-business-core/im-03-wi-12-deliveryitem-completion-impact-proce`
- 工作分支：`galendai/im-03-wi-12-deliveryitem-completion-impact-proce`
- 验证前本地 HEAD：`a8eb515`（与当时的 `main`、`origin/main` 一致）
- 当前交付状态：`LOCAL IMPLEMENTATION VERIFIED / COMMIT PENDING / PR NOT CREATED`
- 证据边界：本文只证明当前工作树中的 EnterpriseProject 实现、测试、Migration 与受控 PostgreSQL Gate；不把本地事实账本模拟成真实上游或生产链路。

## 2. Issue 范围与实现结果

本轮实现 Issue #68 要求的 EnterpriseProject owning 逻辑：

- DeliveryItem Completion Evaluator：从冻结 criteria、精确 formal fact refs、source watermark 和受信 `zhiju.quality.evaluator` VersionedRef 派生 `SATISFIED` 或 `UNSATISFIED`；拒绝 caller outcome、`submittedCompletion`、`completionStatus` 和直接 `execution_status='COMPLETED'`。
- Formal fact Consumer：校验注册 Event Envelope、producer、scope、payload hash、exact TypedReference、Event Consumer `sourceEventId` 与 SourceWatermark；在同一事务中写入 Inbox、Completion Fact、ProcessInstance、ProcessStep，并支持 replay `DUPLICATE` 与 hash/watermark 冲突 `QUARANTINED`。
- V2013 immutable history：新增 `delivery_item_completion_fact`、`delivery_item_completion_evaluation`、`delivery_item_impact_review`，保留 revoke、late fact 和 upstream new version 的追加历史；历史表对应用角色不授予 `UPDATE/DELETE`。
- DeliveryItem current pointer：增加 `current_completion_evaluation_id`、独立 `completion_aggregate_version`、更新时间和最后命令字段，使用 exact scope、expected version、expected pointer 的 CAS 更新。
- Completion/Impact 事件：只在非 `SATISFIED` 到 `SATISFIED` 的转移发布 `project.DeliveryItemCompletionSatisfied`；revoke 后重新满足允许再次发布；稳定 `SATISFIED` 的 late fact 不重复发布 Completion Event；Evaluation 变化追加 `project.DeliveryItemImpactReviewRequested`。
- `get_delivery_item_criteria`：返回冻结 criteria/hash、`NOT_READY` projection 以及可选的当前精确 Completion Evaluation Ref，不查询 `latest/current` 模糊对象。

未在本轮实现的上游业务 Handler 与外部链路仍保持 `NOT RUN`，见第 6 节。

## 3. 交付文件

- 规格同步：
  - `.vibe/high-level-docs/HL-Spec.md`
  - `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`
  - `.vibe/high-level-docs/04-domain-model-v0.1.md`
  - `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
  - `.vibe/high-level-docs/08-verification-baseline.md`
  - `.vibe/module-tests/Module-Test-002-EnterpriseProject.md`
- 本地执行记录：`.vibe/archive/im-03-wi-12-deliveryitem-completion-impact-process/Task-Plan.md`
- Forward-only Migration：`migrations/enterprise_project/V2013__delivery_item_completion_impact.sql`
- EnterpriseProject 类型、数据库映射和 Repository：
  - `modules/enterprise-project/src/persistence/enterprise-business-types.ts`
  - `modules/enterprise-project/src/persistence/enterprise-db.ts`
  - `modules/enterprise-project/src/persistence/delivery-item-completion-repository.ts`
- Business Handler 与公共导出：
  - `modules/enterprise-project/src/business/delivery-item-completion-handlers.ts`
  - `modules/enterprise-project/src/business/delivery-plan-handlers.ts`
  - `modules/enterprise-project/src/business/enterprise-business-errors.ts`
  - `modules/enterprise-project/src/index.ts`
- 回归测试：
  - `tests/business/delivery-item-completion.test.ts`
  - `tests/persistence/delivery-plan.test.ts`
  - `tests/persistence/technical-tables.test.ts`
  - `tests/business/tsconfig.json`
  - 根 `tsconfig.json` 的 `tests/business` project reference

## 4. 场景矩阵

| 场景 | 输入 | 期望输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| `EP-WI12-U-001` | 非法 caller outcome、错误 evaluator、跨 Project factRef、无 Event Consumer Service context、缺失 `sourceEventId`、未知事件 | 在数据库事务前稳定拒绝，不产生业务写入 | Unit/Contract 独立文件 4/4 通过；完整 Vitest 通过 | `PASS (UNIT/CONTRACT)` |
| `EP-WI12-P-001` | `TaskCompleted@1.0`，criteria 同时要求 Task 与 Release | Inbox/Fact/Process Step 成功；Task-only 为 `UNSATISFIED`；无 Completion Event；Item 仍 `NOT_READY` | Persistence Gate 中全部断言通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-002` | 在 P-001 后补入精确 `ReleaseCompleted@1.0` 并评估 | Outcome 为 `SATISFIED`；current pointer CAS；产生一个 Completion Event 和一个 Impact Event | Completion aggregate version 从 `1` 经评估推进到 `3`；事实、事件、pointer 和 hash 断言通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-003` | 同 event 相同 payload/watermark replay；同 event id 改 payload | 相同输入 `DUPLICATE`；冲突 `QUARANTINED`；首条事实和业务结果不变 | Fact count=`1`；`INBOX_HASH_CONFLICT` violation count=`1`；command replay=`DUPLICATE` | `PASS (PERSISTENCE)` |
| `EP-WI12-P-004` | Release recall、同一上游新 PackageSnapshot、晚到 Task fact | revoke 后 `UNSATISFIED`；新版本后 `SATISFIED`；late 只追加历史；稳定 SAT 不重复 Completion Event | 5 个 Fact、4 个 Evaluation、3 个 Impact Review、2 个 Completion Event；旧 Evaluation/Plan Version/Approval/hash 保留 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-005` | 直接写 `execution_status='COMPLETED'`；修改/删除 Fact/Evaluation；跨 Project 读写 | ACL/trigger/RLS fail-closed；不产生半写入；跨 Project 不泄漏 | 直接完成写入和历史 UPDATE/DELETE 均为 `42501`；跨 Project SELECT=`0`；Item=`NOT_READY`、version=`2`、pointer 不变 | `PASS (PERSISTENCE/RLS)` |
| `EP-WI12-P-006` | 两个命令竞争同一 pointer；Impact outbox 插入注入 `P0001` | 一个 CAS `COMMITTED`，一个 `CONCURRENCY_CONFLICT`；故障事务的派生历史和 Root 全部回滚 | `1 COMMITTED / 1 REJECTED`；故障后 facts=`3`、evaluations=`2`、impacts=`1`、Completion events=`1`、Root version=`3`；失败事件 Inbox=`PROCESSED` | `PASS (PERSISTENCE)` |
| `EP-WI12-RLS-001` | 无 Context、缺失 `sourceEventId`、错误 scope/producer/payload hash/watermark | 业务写入前拒绝或隔离 | Unit 覆盖无 Context/缺失 sourceEventId；P-005 覆盖跨 Project ACL/RLS | `PASS (UNIT + PERSISTENCE/RLS)` |
| `EP-WI12-E-001` | 受控 Fixture 依次注入 Task、评估、Release、评估 | 缺 Release 时未完成，补齐后完成，所有 ref/hash 可追溯 | 受控 PostgreSQL Task→Evaluation→Release→Evaluation 链通过；Projection 和真实跨模块链路未运行 | `PASS (CONTROLLED PERSISTENCE); CROSS-MODULE NOT RUN` |
| `EP-WI12-M-001` | 人工查看 Task-only、Release-complete、revoke/new-version 历史 | 人工区分 Fact、Evaluation、pointer、Impact 和外部链路边界 | 未准备人工界面 | `NOT RUN` |

## 5. 自动化命令与实际输出

最终验证在最新未提交工作树上执行：

```text
pnpm verify
```

结果：

- `format:check`：`All matched files use Prettier code style!`
- `lint`：通过，exit code `0`
- `typecheck`：通过，exit code `0`
- `test`：`Test Files 24 passed | 17 skipped (41)`；`Tests 356 passed | 241 skipped (597)`
- `architecture`：`architecture_boundaries=PASS source_roots=10`
- `contracts:check`：
  - `public_api_generation=PASS operations=200`
  - `typescript_types=PASS payloads=200 query_results=44 core_contracts=6`
  - `catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}`
  - `compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=5 findings=5`
- `persistence:gate`：`Test Files 21 passed (21)`；`Tests 256 passed (256)`；`gate passed`

Persistence Gate 环境与迁移证据：

- PostgreSQL image：`docker.io/library/postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`
- PostgreSQL：`server_version=180006`
- Flyway image：`docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`
- Flyway：`Flyway OSS Edition 11.20.3`
- 空库迁移：通过，V2013 `delivery item completion impact` 为 `Success`
- 二次 migrate：`Schema "public" is up to date. No migration necessary.`
- 测试环境清理：Gate 输出 `postgres container removed`；未保留测试容器、临时数据库、临时脚本或测试文件。

验证期间曾修正两项测试夹具问题，最终结果以本节最终 `pnpm verify` 为准：P006 将故障触发器从被正确抑制的重复 Completion Event 改为同一事务必写的 Impact Event；并行构建期间出现的瞬时 Unit 产物竞争通过串行完整验证复核，最终 24/24 文件和 356/356 非跳过测试通过。

## 6. 未运行边界与后续授权边界

以下项目没有被本地 Gate 覆盖，必须保持 `NOT RUN`：

- TaskExecution、QualityGovernance、ReleasePublication 的真实业务 Handler 和真实上游数据库事务。
- 真实跨模块 Event Bus、Process Manager、公共 HTTP/E2E、外部发布和 Provider。
- 生产数据库、生产消息 broker、真实对象存储和生产部署。
- 独立人工 Reference Project/采购控制程序验收。

当前工作树验证完成不等于 Git 交付完成。后续仍需在用户检查并明确确认后，分开执行 commit、push、PR exact-head review、CI/readback、merge、Issue #68 close、远端/本地 branch 删除、`origin/main` ancestry 验证和最终 API readback。
