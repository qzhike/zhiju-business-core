> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-02-acceptance-issue-28/Main-Closeout-Failure-2026-08-24.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-02-acceptance-issue-28/Main-Closeout-Failure-2026-08-24.md).

# IM-02 合并后干净 main 阻塞记录

日期：2026-08-24  
范围：PR #51 合并后的默认分支验收  
状态：`HISTORICAL BLOCKER RESOLVED / PR #53+#54 MERGED / IM-02 COMPLETE / ISSUE #28 CLOSED / PR #55 DOC SYNC PENDING`

## 1. 事实结论

PR #51 已使用精确 head 合并进入 `main`，合并提交为 `8f5c0701ace93ce88ec55acde753e5abcd07fa2c`。随后从 `origin/main` 创建临时 detached checkout，首次完整验证的静态阶段与内嵌 Persistence Gate 通过；紧接着执行独立 Persistence Gate 时，WI-09 的 `IP-API-U-001` 在 DENY Audit 写入处失败：

```text
error: permission denied for table audit_record
tests/persistence/identity-policy-decisions.test.ts
  actor snapshot and decision port (real PostgreSQL)
  keeps the agent kind on actingFor and denies human-only requests (IP-API-U-001)
modules/identity-policy/src/commands/actor-snapshot.ts:418
Test Files  1 failed | 11 passed (12)
Tests       176 passed | 1 failed (177)
```

因此当时 Issue #28 保持 `OPEN`，IM-02 不能记录为 `COMPLETE`。该历史阻塞已由 PR #52 修复并在最终 `main` 上复验通过。

## 2. 可复核命令与结果

执行环境为新的 `origin/main` 临时 checkout，未触碰既有 `qm-dev-postgres` 容器：

| 命令 | 实际结果 |
|---|---|
| `pnpm install --frozen-lockfile` | `PASS` |
| `pnpm clean && pnpm verify` | 静态检查、常规 Vitest、Catalog/Registry、Compatibility 及其内嵌 Persistence Gate `PASS`；Persistence 为 `12 files / 177 tests`，容器已清理 |
| `pnpm typecheck && pnpm persistence:gate` | `typecheck PASS`；独立 Gate 在 `IP-API-U-001` 失败，容器已清理 |

两次 Gate 都使用 PostgreSQL 18.6 与 Flyway 11.20.3 的锁定镜像。第一次通过与第二次失败并不构成“可接受的偶发失败”；它揭示了共享测试数据库状态的并行竞态。

## 3. 根因定位

- `migrations/bootstrap/V0002__schema_roles_baseline.sql` 为各 owning schema 设置默认 `SELECT, INSERT, UPDATE`，`V1000` 创建 `identity_policy.audit_record` 后仅撤销 `UPDATE`；迁移设计仍要求 `identity_policy_app` 可以追加 Audit。
- `tests/persistence/messaging.test.ts` 的 WI-10 失败注入会对共享角色执行 `REVOKE INSERT ON identity_policy.audit_record FROM identity_policy_app`，调用 `resumeDeadLetterEvent` 后再恢复 `GRANT`。
- `withIdentityTransaction` 在 `platform_context_establisher` 建立受信 Context 后切换为 `identity_policy_app`；WI-09 DENY 路径也在该角色下向同一表追加安全 Audit。
- `tools/persistence/gate.mjs` 直接以 Vitest 默认文件并行方式运行 `tests/persistence`。WI-10 的全局 ACL 撤销窗口与 WI-09 的 DENY Audit 写入重叠时，后者得到 PostgreSQL `42501`。

所以本次阻塞是 Persistence Gate 的测试隔离缺陷，不应新增生产授权、编辑已应用 Migration 或削弱 RLS/ACL 约束来绕过它。

## 4. 修复前置约束

1. 先更新 HL-Spec、IdentityPolicy Module Spec、Module Test、Issue #28 验收报告和整体里程碑报告；本记录即为修复前的失败证据。
2. 只修复 Gate 的共享数据库状态隔离，保留 WI-10 “Audit INSERT 失败时事件仍为 DEAD”的真实权限反例。
3. 修复后至少连续执行两次独立 `pnpm persistence:gate`，并执行完整 `pnpm clean && pnpm verify`；每次都确认二次 migrate no-op、容器清理和 `IP-API-U-001` 通过。
4. 在修复 PR 合并后的全新 `main` 上重新验证；在该证据完成前不关闭 Issue #28。

## 5. 未改变的外部边界

Keycloak/OIDC、OpenBao、Ceph、飞书、生产 Broker/Provider、跨模块生产 E2E、生产负载和最终用户人工 Runbook 验收仍为 `NOT RUN`。本次修复不扩大这些边界，也不把本地自动化证据解释为外部系统通过。

## 6. 修复分支预验证结果

在 `galendai/im-02-main-closeout-repair` 分支将 Persistence Gate 改为 `--no-file-parallelism` 后：

- 连续两次独立 `pnpm persistence:gate` 均为 `12 files / 177 tests PASS`；二次 migrate 为 no-op，V0001–V0003、V1000–V1004、V2000–V7000 均为 `Success`，容器均已删除。
- `pnpm clean && pnpm verify` 的 format、lint、typecheck、常规 Vitest（`20 passed | 10 skipped`、`341 passed | 164 skipped`）、architecture、Public API、generated types、Catalog/Registry 和 compatibility 全部通过；内嵌 Gate 的另一次尝试在 Docker Registry tag-digest 网络校验处被 `EOF` 阻断，未进入测试，不能把该次编排记为完整 PASS。
- 使用同一锁定 PostgreSQL 18.6/Flyway 11.20.3 镜像的临时容器串行执行三个 local Probe：WI-06 `COMMITTED → DUPLICATE → IDEMPOTENCY_PAYLOAD_CONFLICT`；WI-07 三类 Principal 注册、External Identity 绑定/解析通过且 `raw identifiers leaked: false`；WI-10 `PROCESSED → DUPLICATE → QUARANTINED`，target outbox/receipt/violation 各为 1，业务事实只执行一次。临时容器已清理。

这些结果证明修复分支的测试隔离修复有效；PR #52 已完成 exact-head review、合并，并从全新 `main` 取得直接 digest 等价 Gate 的 `12 files / 177 tests PASS`、Migration/no-op 和容器清理证据。

## 7. PR #52 合并后的最终 main 证据

PR #52 已合并为 `64e3040b58093548a477021595d3c2f554b07e45`，PR #53 已合并为 `36825118c6b2483dd365879179b390205549dab7`，PR #54 已合并为 `47d1b57a2a51e2d4c458406de8af0eecd0a2ed8a`。新的 clean-main 直接 digest 验证与 PR #53 合并后的完整 `pnpm install --frozen-lockfile && pnpm clean && pnpm verify` 均取得 `12 files / 177 tests PASS`、14 个 Migration 成功、二次 migrate no-op；WI-02/03/04/09 Runbook 级探测和 WI-06/07/10 local Probe 均通过。探测过程中发现并已由 PR #53 修正两处 Runbook 口径：默认 `plpgsql` 不应被当作业务扩展遗漏，outbox payload 负例必须使用合法 JSON 才能证明 `42501` ACL 拒绝。IM-02 已完成，Issue #28 已关闭；PR #55 只同步最终 CLOSED 状态。

PR #53/#54 只更新 Runbook、验收记录和状态文档，不改运行时代码、Migration 或权限边界；其 exact-head review、CI、merge、最终 main 完整 verify、祖先关系和 Issue #28 CLOSED 状态均已回读。本记录不再阻塞 IM-02；PR #55 只同步最终 CLOSED 状态。

## 8. PR #53 合并后的最终 main 完整验证

- `origin/main@36825118c6b2483dd365879179b390205549dab7`：`pnpm install --frozen-lockfile`、`pnpm clean && pnpm verify` 均返回 `0`。
- 常规 Vitest：`341 passed / 164 skipped`；Persistence Gate：`12 files / 177 tests`。
- Migration：V0001–V7000 全部 `Success`；二次 migrate：`Schema "public" is up to date. No migration necessary.`。
- 临时 PostgreSQL 容器和 detached worktree 已清理；既有 `qm-dev-postgres` 未触碰。
