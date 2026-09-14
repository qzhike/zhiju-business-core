import { taskExecutionCreationPurposeMappings } from '@zhiju/contracts';

// =============================================================================
// IdentityPolicy boundary: exact creation Purpose resolution (Spec 001 §14)
// =============================================================================
//
// The four published creation versions are authorized per exact
// `(commandType, commandVersion)` key (Spec 003 §15.1). `TaskExecution` cannot
// infer the approved Purpose of a creation version from its own acceptance
// set, so the mapping is published once by the contracts build chain
// (`contracts/src/task-execution-creation-purpose.ts`, derived from the two
// registries and drift-checked by `pnpm contracts:check`) and consumed here.
//
// This module is the owning boundary for the resulting fact and the only
// resolution path:
//
// 1. Only the exact key resolves. An unknown operation, an unknown, missing or
//    non-exact version, an alias (`execution.work_order.create`), a case
//    variant, a prefix, a wildcard, a non-string input and a version without
//    its operation all fail explicitly.
// 2. There is no fallback: no latest-version lookup, no implicit `@1.0`, no
//    version comparison and no Purpose assembled by concatenation. The same
//    Purpose for both WorkOrder versions never merges them — the resolved fact
//    keeps the exact version, so a Decision of one version cannot be replayed
//    as the other.
// 3. The result is a resolution fact only. It is not an ALLOW, a
//    CapabilityGrant, an AuthorizationDecision or a statement of current
//    eligibility, and this module reads no database, no Repository and no
//    other module's state. It does not lift the current version restriction of
//    `authorizeCommand`, which keeps rejecting non-`1.0` command versions
//    until the versioned authorization composition layer exists.
//
// The versioned Capability/Policy wiring, Decision issuance and current-grant
// revalidation stay with that future composition layer (Spec 001 §14).
// =============================================================================

/** The exact identity and Purpose of one published creation version. */
export interface TaskExecutionCreationPurpose {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
}

/**
 * Closed outcome of the exact resolution: the matched creation version, or the
 * reason the key has no approved mapping. An unresolved key is never a DENY
 * decision and never a partial match.
 */
export type TaskExecutionCreationPurposeResolution =
  | ({ readonly outcome: 'RESOLVED' } & TaskExecutionCreationPurpose)
  | { readonly outcome: 'UNSUPPORTED_OPERATION' }
  | { readonly outcome: 'UNSUPPORTED_VERSION' };

/**
 * Resolves the one approved Purpose of an exact creation key, or reports that
 * the operation or the version has no approved mapping.
 */
export function resolveTaskExecutionCreationPurpose(
  commandType: unknown,
  commandVersion: unknown,
): TaskExecutionCreationPurposeResolution {
  if (typeof commandType !== 'string') return { outcome: 'UNSUPPORTED_OPERATION' };
  const versions = taskExecutionCreationPurposeMappings.filter(
    (mapping) => mapping.commandType === commandType,
  );
  if (versions.length === 0) return { outcome: 'UNSUPPORTED_OPERATION' };
  if (typeof commandVersion !== 'string') return { outcome: 'UNSUPPORTED_VERSION' };
  const mapping = versions.find((candidate) => candidate.commandVersion === commandVersion);
  if (mapping === undefined) return { outcome: 'UNSUPPORTED_VERSION' };
  return {
    outcome: 'RESOLVED',
    commandType: mapping.commandType,
    commandVersion: mapping.commandVersion,
    authorizationPurpose: mapping.authorizationPurpose,
  };
}
