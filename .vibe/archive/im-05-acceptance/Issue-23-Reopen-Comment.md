## Post-fix re-verification — REOPENED / direct counterexample still passes

PR #141 merged into exact `main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d` and automatically closed this issue. The new root-key allowlist correctly removes unknown and nested fields, but allowlisted values are still accepted through generic token regexes without provider-specific safe semantics.

### Direct post-fix counterexample

Input:

```json
{
  "messageId": "AliceCustomer",
  "providerStatus": "AliceCustomer",
  "reasonCode": "BobBuyer",
  "status": "CustomerName"
}
```

Actual `sanitizeProviderResult(...)` result:

```json
{
  "value": {
    "messageId": "AliceCustomer",
    "providerStatus": "AliceCustomer",
    "reasonCode": "BobBuyer",
    "status": "CustomerName"
  },
  "redactedPaths": []
}
```

The current implementation classifies identifier/status values only by generic string shape:
https://github.com/qzhike/zhiju-business-core/blob/737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d/modules/release-publication/src/provider-result.ts#L71-L84

An external result can therefore place a name, customer identifier, or equivalent PII inside an allowlisted key. A key allowlist alone does not satisfy this issue's requirement for a provider-reviewed allowlist/mapping or a deterministic safe transformation.

### Required before re-closing

- Map each supported Provider's raw response into a closed internal result owned by the Adapter boundary.
- Use closed enums or registered mappings for status/outcome/error/reason values.
- Accept provider/message/request identifiers only from authoritative Adapter extraction; do not allow callers to self-declare arbitrary strings as safe identifiers.
- Omit, tokenize, or irreversibly hash identifiers whose non-sensitive semantics cannot be proved.
- Add regressions for allowlisted-key/name-like-value, customer identifiers, misplaced fields, unknown/nested/array content, and valid provider mappings.
- Prove that Receipt persistence/readback, public Events, ApiError, and logging paths never contain the original sensitive value.
- Synchronize HL-Spec, Module Spec, Module Test, and verification records, then rerun the direct counterexample, focused tests, and fresh exact-head `pnpm clean && pnpm verify`.

The existing repository gates are green — focused 4 files/34 tests, ordinary 42 passed/30 skipped files and 438 passed/299 skipped tests, PostgreSQL 34 files/314 tests — but the counterexample succeeds on the same exact head.

Parent review evidence: https://github.com/qzhike/zhiju-business-core/issues/120#issuecomment-5475844746

Real Provider/Feishu, production, public HTTP, external-recipient confirmation, and independent manual acceptance remain `NOT RUN`.
