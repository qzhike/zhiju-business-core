# IM-02 WI-06 本地 Runbook：同一 Command 三次探测

对应 Issue #34。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/command-runner.test.ts`：PG-U-004/006/009/010/012 全部子场景、REJECTED 持久化、并发 CAS、企业/平台表路由）。

## 手动验收（脱敏三次探测 + 行数核对）

1. 启动一次性容器并应用全部 migration（同 runbook-wi-04，容器名 `zju-wi06-probe`），确认端口：`docker port zju-wi06-probe 5432`。
2. 执行内置演示脚本（同一 Command 的首次提交 / 同 key+hash 重放 / 同 key 不同 hash 冲突）：

```bash
ZJU_DATABASE_URL='postgres://postgres:zhiju-gate-test@127.0.0.1:PORT/zhiju_core' \
  node --experimental-strip-types tests/manual/wi06-probe.mts
```

脚本输出依次为：

```text
[1] first   → status=COMMITTED, principalVersion=1
[2] replay  → status=DUPLICATE(originalOutcome=COMMITTED), principalVersion=1（未重复执行）
[3] conflict→ CommandExecutionError IDEMPOTENCY_PAYLOAD_CONFLICT（无原 payload 泄漏）
```

3. 行数核对（psql）——Aggregate version、Receipt、Audit 与 Outbox 均未重复：

```sql
SELECT aggregate_version::text, status FROM identity_policy.principal
WHERE id = 'abababab-0000-7000-8000-000000000001';                 -- 1 / ACTIVE

SELECT outcome, count(*) FROM identity_policy.platform_command_receipt
WHERE idempotency_key = 'wi06-manual' GROUP BY outcome;            -- COMMITTED 1

SELECT outcome, count(*) FROM identity_policy.platform_audit_record
WHERE command_type = 'wi06.manual.register' GROUP BY outcome;      -- COMMITTED 1, DENIED 1

SELECT count(*) FROM identity_policy.platform_outbox_event
WHERE event_type = 'wi06.PrincipalRegistered';                     -- 1
```

用户可直接观察：首次提交产生恰好一份业务事实；重放返回原结果；冲突只新增一条 DENIED 安全审计，错误消息不含原始 payload。

## NOT RUN 声明

- 跨模块分布式事务、exactly-once 声明：非目标；
- Outbox 发布/Inbox 消费循环：`NOT RUN`（WI-10）。
