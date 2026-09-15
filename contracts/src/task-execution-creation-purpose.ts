import artifact from './generated/task-execution-creation-purposes.json' with { type: 'json' };

// =============================================================================
// TaskExecution creation Purpose mapping (Spec 003 §15.1 / decision §13)
// =============================================================================
//
// `contracts/src/generated/task-execution-creation-purposes.json` is the
// derived build artifact of the two published registries: the four approved
// `(commandType, commandVersion)` keys, owner/kind from `public-api.v1.json`
// and the approved `authorizationPurpose` from
// `operation-compatibility-metadata.v1.json`. `pnpm contracts:check` rejects a
// stale artifact, and the generator rejects a missing, duplicated, mis-owned,
// mis-kinded or rewritten registry entry before the artifact is produced.
//
// The two `@1.0` creation entries omit `authorizationPurpose` in the public
// API registry. That historical shape stays legal and is not "no
// authorization": their approved Purpose is carried here from the
// compatibility metadata and is never back-filled from a newer version.
//
// Owning boundary: this module publishes the approved mapping as data. It
// answers no authorization question — no ALLOW, no CapabilityGrant, no
// Decision, no current eligibility — and it resolves nothing by latest
// version, by a default version or by an alias. Exact-match resolution of a
// command key belongs to the owning IdentityPolicy boundary (Spec 001 §14).
// =============================================================================

export interface TaskExecutionCreationPurposeMapping {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates the derived artifact as a closed shape: every entry names exactly
 * one non-empty `(commandType, commandVersion)` key and one non-empty Purpose,
 * and no key is registered twice.
 */
export function loadTaskExecutionCreationPurposeMappings(
  input: unknown,
): readonly TaskExecutionCreationPurposeMapping[] {
  if (!record(input) || !Array.isArray(input.mappings)) {
    throw new Error('invalid creation Purpose mapping artifact');
  }
  const mappings: TaskExecutionCreationPurposeMapping[] = [];
  const keys = new Set<string>();
  for (const entry of input.mappings as unknown[]) {
    if (
      !record(entry) ||
      typeof entry.commandType !== 'string' ||
      entry.commandType === '' ||
      typeof entry.commandVersion !== 'string' ||
      entry.commandVersion === '' ||
      typeof entry.authorizationPurpose !== 'string' ||
      entry.authorizationPurpose === ''
    ) {
      throw new Error('invalid creation Purpose mapping entry');
    }
    const key = `${entry.commandType}@${entry.commandVersion}`;
    if (keys.has(key)) throw new Error(`duplicate creation Purpose mapping: ${key}`);
    keys.add(key);
    mappings.push(
      Object.freeze({
        commandType: entry.commandType,
        commandVersion: entry.commandVersion,
        authorizationPurpose: entry.authorizationPurpose,
      }),
    );
  }
  if (mappings.length === 0) throw new Error('creation Purpose mapping artifact is empty');
  return Object.freeze(mappings);
}

/** The approved `(commandType, commandVersion, authorizationPurpose)` rows, and only these. */
export const taskExecutionCreationPurposeMappings: readonly TaskExecutionCreationPurposeMapping[] =
  loadTaskExecutionCreationPurposeMappings(artifact);
