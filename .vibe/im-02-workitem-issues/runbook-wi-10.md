# IM-02 WI-10 本地 Runbook：ACK-loss 重放与 Quarantine 演示

对应 Issue #38。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/messaging.test.ts`：同 Aggregate 顺序 claim/lease/fencing、UNKNOWN 同 EventId 重试、PG-E-004 ACK-loss 重放、PG-U-011 不同 Hash Quarantine、未知 Major/缺 Extension/Scope 冲突隔离、故障注入整体回滚后安全重放、DEAD 恢复写不可变 Audit、Dispatcher 无法触碰业务 payload）。

## 手动验收(可重复 ACK-loss 演示)

1. 启动一次性容器并应用全部 migration(同 runbook-wi-04,容器名 `zju-wi10-probe`)。
2. 修改 `tests/manual/wi10-probe.mts` 顶部连接(如需),执行:

Probe 的初始 Principal Fixture 必须显式写入 `status='ACTIVE'`；该字段没有可依赖的数据库默认值，不能通过放宽约束或省略字段继续验收。

```bash
ZJU_DATABASE_URL='postgres://postgres:zhiju-gate-test@127.0.0.1:PORT/zhiju_core' \
  node --experimental-strip-types tests/manual/wi10-probe.mts
```

脚本按验收剧本输出:

```text
[1] consume (first, ACK 丢失模拟)  → PROCESSED   targetEffects=1
[2] replay same id + same hash     → DUPLICATE   targetEffects=1(不重复)
[3] replay same id + different hash→ QUARANTINED contract_violation=1
[verify] target outbox rows = 1 ; command receipts = 1 ; 业务事实仍只有一份
```

3. psql 复核:

```sql
-- Quarantine 证据:INBOX_HASH_CONFLICT violation,原始 claim 未被改写
SELECT violation_kind, consumer_name, encode(observed_payload_hash, 'hex')
FROM identity_policy.contract_violation WHERE source_event_id IS NOT NULL;

-- Inbox 状态分布(PROCESSED / QUARANTINED,无错误标记为重复成功)
SELECT consumer_name, status, count(*) FROM identity_policy.inbox_message
GROUP BY 1, 2 ORDER BY 1;

-- 恢复 DEAD 的人工操作有不可变 Audit
SELECT command_type, outcome, safe_summary FROM identity_policy.audit_record
WHERE command_type = 'identity.internal.resume_dead_letter';
```

## IM-02 默认参数(已固化为 DISPATCH_DEFAULTS)

- `maxAttempts = 5`(超过进入 DEAD);
- `retryBackoffBaseSeconds = 2`(UNKNOWN 指数退避,同一 EventId 重试);
- `leaseSeconds = 60`、`claimBatchSize = 10`;
- 归档:超出 IM-02 范围(归档任务由后续里程碑落地,当前保留全部投递元数据)。

## NOT RUN 声明

生产 message broker、飞书/邮件 Provider、exactly-once 声明、#27 IntegrationGateway 业务 Handler/Adapter 均为 `NOT RUN`。
