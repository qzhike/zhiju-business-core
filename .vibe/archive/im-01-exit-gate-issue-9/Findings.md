> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-01-exit-gate-issue-9/Findings.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-01-exit-gate-issue-9/Findings.md).

# IM-01 Exit Gate Findings（Issue #9）

## Prerequisite matrix

| Issue | Schema / contract evidence | Current state |
|---|---|---|
| #1 | PR #11 | CLOSED |
| #2 | PR #10 | CLOSED |
| #3 | PR #12 | CLOSED |
| #4 | PR #13 | CLOSED |
| #5 | PR #14 Schema；duplicate/late → 已关闭 #15；其余 Runtime → #22–#24 | FIELD-SCHEMA COMPLETE / CLOSE-READY |
| #6 | PR #16；Runtime → #17 | CLOSED |
| #7 | PR #18 | CLOSED |
| #8 | PR #19 | CLOSED |

## Exit-gate measured counts

- Registry operations: 200
- schemaStatus: FULL=200, ENVELOPE_ONLY=0
- kinds: COMMAND=95, QUERY=44, EVENT=61
- owners: 20/32/37/26/37/25/23
- generated types check: payloads=200, query_results=44, core_contracts=6
- baseline: operations=200, coreContracts=6
- tests: 13 files / 287 passed
- architecture: source_roots=10, violations=0
- HTTP health: `{"status":"ok"}`

## Decision on #5 / #9

2026-08-21 user approved Path A on PR #20:

1. Issue #9 hard dependency revised to Schema/Contract sub-slices of #1–#8 merged.
2. #5 may remain OPEN for Runtime #15; #15 is not an IM-01 Schema exit prerequisite.
3. Round-2 delivery requires atomic `IM-01 COMPLETE` in this PR plus consistent `Closes #9`.

后续状态：#15 已完成并关闭；用户批准将 #5 收敛为字段 Schema 边界，未完成 Runtime 验收分别迁移至 #22–#24。该迁移不改变其 `PARTIAL` / `NOT RUN` 状态。
