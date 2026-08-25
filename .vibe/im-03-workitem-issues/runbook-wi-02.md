# IM-03 WI-02 本地 Runbook：成功 / 重放 / Hash 冲突 / CAS 冲突 / 回滚

对应 Issue #58。自动验收入口 `pnpm persistence:gate`（`tests/persistence/enterprise-project-command-runner.test.ts`：幂等 replay、hash conflict、并发 claim、CAS、过期/无/伪造 Context、跨 Project Scope、连接池 Context 泄漏、payload/hash 与提升列拒绝、故障回滚）。

本切片不创建 EnterpriseProject 业务表或业务 Handler。CAS 使用已有 `process_instance` 技术表。授权只绑定可信 Actor/Authorization/Policy Snapshot，不读取 IdentityPolicy 内部 Repository。

## 手动验收（五步探测 + 行数核对）

1. 启动一次性容器并应用全部 migration（同 IM-02 runbook-wi-04，容器名 `zju-im03-wi02-probe`，需发布 `5432`，例如 `-p 127.0.0.1::5432`），确认端口：`docker port zju-im03-wi02-probe 5432`。执行脚本的登录必须同时拥有 `platform_context_establisher` 与 `enterprise_project_app` membership；事务代码先显式切换前者建立 Context，再切换后者执行 RLS 受限 SQL。
2. 执行内置演示脚本：

```bash
ZJU_DATABASE_URL='postgres://postgres:zhiju-gate-test@127.0.0.1:PORT/zhiju_core' \
  node --experimental-strip-types tests/manual/im03-wi02-probe.mts
```

脚本输出依次为：

```text
[1] success      → COMMITTED
[2] replay       → DUPLICATE(originalOutcome=COMMITTED)
[3] hash-conflict→ IDEMPOTENCY_PAYLOAD_CONFLICT (first receipt unchanged)
[4] cas-conflict → CONCURRENCY_CONFLICT (loser left no receipt/outbox)
[5] rollback     → INJECTED_FAULT (no leftover rows)
```

3. 行数核对（psql）：

```sql
SELECT aggregate_version::text, state FROM enterprise_project.process_instance
WHERE process_id = 'abababab-0000-7000-8000-0000000000e2';          -- 2 / SUSPENDED

SELECT outcome, count(*) FROM enterprise_project.command_receipt
WHERE idempotency_key IN ('wi02-manual','wi02-manual-cas-lose','wi02-manual-fault')
GROUP BY outcome;                                                  -- COMMITTED 1；lose/fault 为 0

SELECT count(*) FROM enterprise_project.process_instance
WHERE process_id = 'abababab-0000-7000-8000-0000000000e3';          -- 0
```

用户可直接观察：首次提交产生一份技术事实；重放返回原结果；不同 Hash 不改写首个 Receipt；CAS 失败者整事务回滚；故障后无 Receipt/Audit/Outbox/Process 残留。

2026-08-25 agent-executed probe 输出与上列五步一致：CAS process `2 / SUSPENDED`；`wi02-manual` Receipt 仅 `COMMITTED 1`；fault process 计数 `0`。这不能替代用户亲自运行。

## NOT RUN 声明

- Enterprise/Project 业务表、业务 Handler、受控 Capability 实现：非目标；
- IdentityPolicy 内部 Repository 共享层：明确禁止；
- Outbox 发布/Inbox 消费循环、公开 HTTP、真实 Provider：`NOT RUN`。
