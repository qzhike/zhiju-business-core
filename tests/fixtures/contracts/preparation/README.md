# Preparation entry contract fixtures

All identifiers, names, policies, hashes, grants and receipt references in this directory are synthetic schema examples. They are not production publications or evidence that a real Task, analysis request, Runner invocation or report exists. Analysis result examples deliberately use `WAITING_INPUT` or `WAITING_CAPABILITY`.

`manifest.json` enumerates every standalone JSON fixture and its owning operation, version, validation mode and expected outcome. Positive payload files cover all eleven operations registered for issue #291. Positive results cover the six browser operations and the three internal source/project operations. Negative files cover closed payload/result fields, unsupported reference strengths, incomplete Project scopes, malformed hashes, invented native references and browser Actor injection.

`contracts/src/preparation-fixtures.test.ts` resolves each actual registered owning `payloadSchemaRef` through `ContractRegistry`, validates results with `validateOperationResult`, and runs the original public-command validator for semantic Scope and canonical payload-hash binding. Schema-only validation does not claim to prove current authorization, persisted existence, or cross-owner publication validity; those require the owning PostgreSQL and end-to-end tests.
