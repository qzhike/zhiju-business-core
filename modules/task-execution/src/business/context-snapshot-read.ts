// IM-06 (#216): `execution.get_context_snapshot@1.0`, the authoritative initial
// Context Snapshot read (Spec 003 §19.2, approved #214 design).
//
// The read returns committed facts only: the exact Snapshot row the requested
// six-field SnapshotRef names and the stored canonical ProjectContext v1.0
// payload whose SHA-256 the request itself carries. It never rebuilds a
// payload, never fills a missing member and never substitutes one Snapshot for
// another, so an uncommitted ref or a replay with a foreign Hash is a
// `REFERENCE_INVALID`, never a partial success (§19.2 item 3, TE-214-D-014).
//
// Two non-substitutable owning stores serve the read (§20.1): the requested
// objectType routes to exactly one of them - the canonical
// `zhiju.execution.context_snapshot` spelling reads `context_snapshot`, the
// legacy `zhiju.project.context_snapshot` spelling reads the import-only
// `context_snapshot_legacy` compatibility store. Any other spelling is
// refused before any lookup, and a miss in one store never falls through to
// the other.
//
// This path writes nothing: no Receipt, no Audit, no Edge, no Outbox row. The
// read authorization is revalidated by the composition entry through the
// IdentityPolicy-owned `contextSnapshotRead` grant before this function is
// reached (Spec 001 §15.8 item 4).

import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  ContractRegistry,
  contextSnapshotObjectType,
  legacyContextSnapshotObjectType,
  readSnapshotRef,
  validateContextSnapshotReadBinding,
  type SnapshotRefParts,
  type SnapshotRefReadError,
} from '@zhiju/contracts';
import {
  CANONICALIZATION_VERSION,
  digestCanonicalPayload,
  withTaskExecutionTransaction,
  type CanonicalPayloadDigest,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { ContextSnapshotRepository } from '../persistence/context-snapshot-repository.js';
import { API_VALUE_INVALID } from './work-order-draft-creation.js';
import { REFERENCE_INVALID } from './work-order-draft-read.js';

/** The registered query this handler owns. Only `@1.0` exists. */
export const GET_CONTEXT_SNAPSHOT_QUERY = 'execution.get_context_snapshot';
export const GET_CONTEXT_SNAPSHOT_VERSION = '1.0';

const PROJECT_CONTEXT_CORE_SCHEMA = 'https://schemas.zhiju.local/core/project-context/1.0';
const PROJECT_CONTEXT_CONTRACT_TYPE = 'zhiju.contract.project_context';

export interface GetContextSnapshotInput {
  readonly commandVersion: string;
  readonly payload: unknown;
}

/**
 * The closed outcome of one Snapshot read. A refusal carries a stable safe
 * code and never a partial payload; the caller learns nothing about Snapshots
 * outside its own Project scope (RLS is the only Scope authority).
 */
export type GetContextSnapshotResult =
  | { readonly status: 'FOUND'; readonly resultPayload: CanonicalJsonObject }
  | { readonly status: 'REJECTED'; readonly errorCode: string; readonly safeSummary: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reject(errorCode: string, safeSummary: string): GetContextSnapshotResult {
  return { status: 'REJECTED', errorCode, safeSummary };
}

/**
 * §20.1 route 2: the legacy read closes against the import-only
 * `context_snapshot_legacy` store with the same field-by-field posture as the
 * canonical route - exact identity, Project Scope, the complete contentHash
 * triple and the cv1 recompute of the stored payload. The historical contract
 * body and its reference are returned from their own stored columns verbatim;
 * they are never rebuilt, extended or re-spelled into the canonical identity.
 */
async function readLegacyContextSnapshot(
  trx: TaskExecutionTransaction,
  repository: ContextSnapshotRepository,
  payload: Record<string, unknown>,
  ref: SnapshotRefParts,
): Promise<GetContextSnapshotResult> {
  const row = await repository.readContextSnapshotLegacy(trx, {
    objectId: ref.objectId,
    snapshotId: ref.snapshotId,
    payloadHash: Buffer.from(ref.contentHash.digest, 'hex'),
  });
  if (
    row === undefined ||
    row.enterpriseId !== ref.scope.enterpriseId ||
    row.projectId !== ref.scope.projectId ||
    row.payloadHashAlgorithm !== ref.contentHash.algorithm ||
    row.canonicalizationVersion !== ref.contentHash.canonicalizationVersion
  ) {
    return reject(
      REFERENCE_INVALID,
      'the Context Snapshot reference does not close against a committed Snapshot of this scope',
    );
  }
  // The content address is recomputed from the stored cv1 bytes, so the
  // request, the row and the payload are one fact or the read fails.
  let digest: CanonicalPayloadDigest;
  try {
    digest = digestCanonicalPayload(row.canonicalPayload as CanonicalJsonObject);
  } catch {
    return reject(
      REFERENCE_INVALID,
      'the stored Context payload cannot define its content address',
    );
  }
  if (!digest.hash.equals(row.payloadHash)) {
    return reject(
      REFERENCE_INVALID,
      'the stored Context payload does not match its content address',
    );
  }
  // The stored historical contract body leaves the module only after it
  // revalidates against the registered ProjectContext v1.0 Core Schema.
  const validation = new ContractRegistry().validateCoreContract(
    PROJECT_CONTEXT_CORE_SCHEMA,
    row.projectContextContract,
  );
  if (!validation.valid) {
    return reject(
      REFERENCE_INVALID,
      'the stored Context payload is not a valid ProjectContext v1.0 contract',
    );
  }

  const resultPayload: CanonicalJsonObject = {
    // The returned ref equals the requested one in every field; it is echoed
    // verbatim, never rebuilt from the row.
    contextSnapshotRef: payload.contextSnapshotRef as CanonicalJsonObject,
    projectContextContract: row.projectContextContract as CanonicalJsonObject,
    contractRef: row.contractRef as CanonicalJsonObject,
  };
  if (
    !validateContextSnapshotReadBinding({
      payload: { contextSnapshotRef: payload.contextSnapshotRef },
      data: resultPayload,
    }).valid
  ) {
    return reject(REFERENCE_INVALID, 'the Context Snapshot read result does not close');
  }
  return { status: 'FOUND', resultPayload };
}

export async function handleGetContextSnapshot(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: GetContextSnapshotInput,
): Promise<GetContextSnapshotResult> {
  // §19.1: the initial chain registers no other read version; every other
  // version string is a reference to nothing this handler can serve.
  if (input.commandVersion !== GET_CONTEXT_SNAPSHOT_VERSION) {
    return reject(REFERENCE_INVALID, 'the requested Context Snapshot read version has no handler');
  }
  const payload = record(input.payload);
  if (!Object.keys(payload).every((member) => member === 'contextSnapshotRef')) {
    return reject(
      API_VALUE_INVALID,
      'the get_context_snapshot payload is closed to contextSnapshotRef',
    );
  }
  const refErrors: SnapshotRefReadError[] = [];
  const ref = readSnapshotRef(payload.contextSnapshotRef, '/contextSnapshotRef', refErrors);
  if (ref === undefined || refErrors.length > 0) {
    return reject(REFERENCE_INVALID, 'contextSnapshotRef must be a complete SnapshotRef');
  }
  // §20.1: the requested objectType routes to exactly one of the two
  // non-substitutable owning stores. The legacy spelling is Core v1.0 readback
  // history this entry never produced, but it is not refused by spelling
  // alone: it queries its own import-only store and fails closed on a miss,
  // exactly like an uncommitted canonical identity. Any other spelling can
  // never close against either store and is refused before any lookup.
  if (
    ref.objectType !== contextSnapshotObjectType &&
    ref.objectType !== legacyContextSnapshotObjectType
  ) {
    return reject(
      REFERENCE_INVALID,
      'contextSnapshotRef objectType must be a registered Context Snapshot spelling',
    );
  }
  if (ref.scope.enterpriseId === undefined || ref.scope.projectId === undefined) {
    return reject(REFERENCE_INVALID, 'contextSnapshotRef requires the exact Project scope');
  }
  // Both identity members index uuid columns; a non-UuidV7 value can never
  // name a committed Snapshot and must not reach the database as a raw cast
  // error.
  if (!isUuidV7(ref.objectId) || !isUuidV7(ref.snapshotId)) {
    return reject(REFERENCE_INVALID, 'contextSnapshotRef identity members must be UuidV7');
  }

  return withTaskExecutionTransaction(db, context, async (trx) => {
    const repository = new ContextSnapshotRepository();
    // §20.1 route 2: the legacy spelling reads only the import-only
    // compatibility store; a miss there never falls through to the canonical
    // table.
    if (ref.objectType === legacyContextSnapshotObjectType) {
      return readLegacyContextSnapshot(trx, repository, payload, ref);
    }
    // The Hash is part of the lookup (§19.2 item 3): a stored payload whose
    // bytes changed can never be returned as the Snapshot the request named.
    const row = await repository.readContextSnapshot(trx, {
      objectId: ref.objectId,
      snapshotId: ref.snapshotId,
      payloadHash: Buffer.from(ref.contentHash.digest, 'hex'),
    });
    if (
      row === undefined ||
      row.enterpriseId !== ref.scope.enterpriseId ||
      row.projectId !== ref.scope.projectId ||
      row.payloadHashAlgorithm !== ref.contentHash.algorithm ||
      row.canonicalizationVersion !== ref.contentHash.canonicalizationVersion
    ) {
      return reject(
        REFERENCE_INVALID,
        'the Context Snapshot reference does not close against a committed Snapshot of this scope',
      );
    }
    // §19.2 item 3 / TE-214-D-014: the content address is recomputed from the
    // stored bytes, so the request, the row and the payload are one fact or
    // the read fails.
    let digest: CanonicalPayloadDigest;
    try {
      digest = digestCanonicalPayload(row.canonicalPayload as CanonicalJsonObject);
    } catch {
      return reject(
        REFERENCE_INVALID,
        'the stored Context payload cannot define its content address',
      );
    }
    if (!digest.hash.equals(row.payloadHash)) {
      return reject(
        REFERENCE_INVALID,
        'the stored Context payload does not match its content address',
      );
    }
    // The stored payload is returned verbatim only after it revalidates
    // against the registered ProjectContext v1.0 Core Schema.
    const validation = new ContractRegistry().validateCoreContract(
      PROJECT_CONTEXT_CORE_SCHEMA,
      row.canonicalPayload,
    );
    if (!validation.valid) {
      return reject(
        REFERENCE_INVALID,
        'the stored Context payload is not a valid ProjectContext v1.0 contract',
      );
    }
    // The assembly pins the header identity to the Snapshot identity; the V3004
    // mirror guard pins `snapshot_id` to `contextSnapshotId`. A stored payload
    // that disagrees with its row is one inconsistent fact, not a read result.
    const storedPayload = record(row.canonicalPayload);
    const header = record(storedPayload.header);
    if (
      header.contractId !== row.snapshotId ||
      storedPayload.contextSnapshotId !== row.snapshotId
    ) {
      return reject(
        REFERENCE_INVALID,
        'the stored Context payload does not match the Snapshot identity',
      );
    }

    const resultPayload: CanonicalJsonObject = {
      // §19.2 item 3: the returned ref equals the requested one in every
      // field; it is echoed verbatim, never rebuilt from the row.
      contextSnapshotRef: payload.contextSnapshotRef as CanonicalJsonObject,
      projectContextContract: row.canonicalPayload as CanonicalJsonObject,
      contractRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: PROJECT_CONTEXT_CONTRACT_TYPE,
        // The Contract Record's own identity is its `header.contractId`, which
        // the closure above proved equal to the Snapshot identity.
        objectId: row.snapshotId,
        scope: { enterpriseId: row.enterpriseId, projectId: row.projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: row.payloadHash.toString('hex'),
          canonicalizationVersion: CANONICALIZATION_VERSION,
        },
      },
    };
    // §11.2.5.3: the read binding is a pure contract check; the result echoes
    // the request verbatim, so a failure here is a defect.
    if (
      !validateContextSnapshotReadBinding({
        payload: { contextSnapshotRef: payload.contextSnapshotRef },
        data: resultPayload,
      }).valid
    ) {
      return reject(REFERENCE_INVALID, 'the Context Snapshot read result does not close');
    }
    return { status: 'FOUND', resultPayload };
  });
}
