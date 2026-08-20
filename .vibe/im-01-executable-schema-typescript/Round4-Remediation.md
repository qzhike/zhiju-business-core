# PR #18 Round 4 Remediation

Date: 2026-08-20
Head under review: `ac3854e`
Goal: fix the four review findings on dependentRequired emitter/Ajv parity.

## Review findings

| ID | Severity | Path | Fix |
|---|---|---|---|
| R4-1 | P1 | `tools/contracts/lib/json-schema-emitter.ts` | Each subset variant must forbid other triggers that are not selected and not pulled in as transitive deps (`triggerKeys - subset - closure(subset)`). |
| R4-2 | P1 | `tests/types/generator-dependent-required.test.ts` | Compare emitter acceptance vs Ajv with the TypeScript compiler API for every sample value. |
| R4-3 | P2 | `tests/types/generator-dependent-required.test.ts` | Pass `requiredSet` matching schema `required` (empty for the synthetic fixtures). |
| R4-4 | P2 | `tests/types/generator-dependent-required.test.ts` | Make the ScopeRef determinism smoke test actually call the emitter twice. |

## Counterexample that must fail after the fix

Independent rule `{ A:[B], C:[D] }`: value `{ A:'a', B:'b', C:'c' }`

- Ajv: reject (C present without D)
- Current emitter: accept (single-A branch leaves C optional)
- Fixed emitter: reject (single-A branch has `C?: undefined`)

## Verification

1. `pnpm test` — dependentRequired suite compares emitter diagnostics to Ajv for every case — PASS (24 tests)
2. `pnpm verify` — format/lint/typecheck/test/architecture/contracts:check all green — PASS (240 tests)
3. Update `Verification-Report.md` IM01-EXE-010 to describe the real compiler-API oracle — DONE

## Status

`REMEDIATED / USER REVIEW PENDING` — awaiting user confirmation before commit and push to PR #18.
