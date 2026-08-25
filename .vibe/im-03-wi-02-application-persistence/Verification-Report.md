# IM-03 WI-02 Verification Report

日期：2026-08-25
对应 Issue：#58

## 自动验证

| Gate | 结果 |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | 21 files passed / 11 skipped；348 tests passed / 177 skipped |
| `pnpm architecture` | `architecture_boundaries=PASS source_roots=10`；`@zhiju/enterprise-project` 未引用 `@zhiju/identity-policy` |
| `pnpm persistence:gate` | 13 files / 190 tests PASS；含 target/owner/version 与 trusted principal 负向回归；空库 migrate Success；二次 migrate no-op；容器已清理 |

## Probe

`tests/manual/im03-wi02-probe.mts` agent-executed 2026-08-25：

```text
[1] success      → COMMITTED
[2] replay       → DUPLICATE (originalOutcome=COMMITTED)
[3] hash-conflict→ IDEMPOTENCY_PAYLOAD_CONFLICT (first receipt unchanged)
[4] cas-conflict → CONCURRENCY_CONFLICT (loser left no receipt/outbox)
[5] rollback     → INJECTED_FAULT (no leftover rows)
```

用户亲自运行仍为 `NOT RUN`。

## NOT RUN

- EnterpriseProject 业务 DDL / Handler / 受控 Capability
- 公开 HTTP、IdentityPolicy 真实 Decision Port 组成层接线
- Outbox 发布 / Inbox 消费
- 真实 Provider、飞书、对象存储、人工“采购控制程序”
