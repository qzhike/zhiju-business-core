# IM-01 Exit Gate Findings（Issue #9）

## Prerequisite matrix

| Issue | Schema / contract evidence | Current state |
|---|---|---|
| #1 | PR #11 | CLOSED |
| #2 | PR #10 | CLOSED |
| #3 | PR #12 | CLOSED |
| #4 | PR #13 | CLOSED |
| #5 | PR #14 Schema；Runtime → #15 | OPEN |
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

## Decision on #5

Proceed with Schema exit despite #5 remaining OPEN, because:

1. Issue #9 non-goals exclude Handler/DB/external E2E.
2. #5 body already split Runtime acceptance to #15.
3. #6 was closed with #17 tracking remaining Runtime gaps — same pattern.
4. Verification report records the exception explicitly.
