// IM-06 (#216): repository for the initial Context Snapshot facts (V3004).
// The immutable `context_snapshot` row and its `context_snapshot_build` INITIAL
// metadata commit inside the command transaction the runner already opened;
// this file exposes only the two inserts and the exact identity read the
// authoritative `execution.get_context_snapshot@1.0` query performs. Every
// insert re-verifies that the row identity and Project Scope equal the
// runner-bound command target and that the writer is the trusted transaction
// principal.
//
// The promoted mirrors (Scope, policy snapshot id, counts, coverage state, both
// expiry mirrors, payload hash) are re-derived inside the database from the
// stored canonical payload by the V3004 mirror guards, and the V3004
// creation-identity guards close the rows against the in-flight
// `execution.build_initial_context_snapshot@1.1` Receipt and the exact
// `work_order_draft_snapshot` the build consumed. A row that does not agree
// with its own payload, its command or its DRAFT is therefore rejected before
// it can be committed, so these helpers do not restate those comparisons.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { COMMAND_FACTS_RUNTIME_BRAND, type CommandFacts } from './command-runner.js';
import { readTrustedContext } from './task-execution-repository.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

/** The one object type these rows are ever written under (§19.2). */
export const CONTEXT_SNAPSHOT_OBJECT_TYPE = 'zhiju.execution.context_snapshot';

/** The Snapshot row of one initial Context build, exactly as V3004 stores it. */
export interface ContextSnapshotInsert {
  /** Application-generated, independent of the aggregate CAS version (§19.2). */
  snapshotId: string;
  /** The validated CREATE `targetRef.objectId`. */
  objectId: string;
  purpose: string;
  /** The encoded `projection.audience` string. */
  audience: string;
  enterpriseId: string;
  projectId: string;
  /** Closed to `'1.1'` by V3004; equals the Receipt `command_version`. */
  builderVersion: string;
  /** `projection.builderPolicyRef.versionId`. */
  policySnapshotId: string;
  sourceManifestCount: number;
  contextItemCount: number;
  omissionCount: number;
  redactionCount: number;
  /** `coverage.completeness`. */
  coverageState: string;
  payloadHash: Buffer;
  /** Declared-text expiry, or undefined when the payload has no `expiresAt`. */
  expiresAt?: string | undefined;
  /** Same member as `expiresAt` (the payload expiry IS the effective expiry). */
  effectiveExpiresAt?: string | undefined;
  requestPayloadHash: Buffer;
  sourceCommandId: string;
  createdByPrincipalId: string;
  canonicalPayload: CanonicalJsonObject;
}

/** The INITIAL build metadata row of one committed Context Snapshot. */
export interface ContextSnapshotBuildInsert {
  snapshotId: string;
  /** Closed to `'INITIAL'` by V3004. */
  buildKind: string;
  /** The exact `work_order_draft_snapshot` CONTENT_ADDRESSED ref consumed. */
  draftSnapshotRef: CanonicalJsonObject;
  /** The sorted exact slice refs of the build (§19.4 item 1). */
  sliceRefs: readonly CanonicalJsonObject[];
  purpose: string;
  /** The full audience PrincipalRef. */
  audience: CanonicalJsonObject;
  builderPolicyRef: CanonicalJsonObject;
  policyContentHash: Buffer;
  /** Declared-text Policy validity window start. */
  policyEffectiveFrom: string;
  policySupersededAt?: string | undefined;
  requestExpiresAt?: string | undefined;
  effectiveExpiresAt?: string | undefined;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  requestPayloadHash: Buffer;
  sourceCommandId: string;
  enterpriseId: string;
  projectId: string;
  createdByPrincipalId: string;
}

/** The committed Snapshot facts the authoritative read returns. */
export interface ContextSnapshotRow {
  readonly snapshotId: string;
  readonly objectId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly payloadHash: Buffer;
  readonly canonicalPayload: unknown;
}

function assertRunnerBoundContextSnapshotFacts(
  facts: CommandFacts,
  row: { objectId: string; enterpriseId: string; projectId: string },
): void {
  if (!(
    typeof facts === 'object' &&
    (facts as unknown as Record<symbol, unknown>)[COMMAND_FACTS_RUNTIME_BRAND] === true &&
    Object.isFrozen(facts)
  )) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot insert must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (facts.targetType !== CONTEXT_SNAPSHOT_OBJECT_TYPE) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot target type must equal the runner-bound command target type',
    );
  }
  if (facts.targetId !== row.objectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot object id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot project scope must equal the runner-bound command projectId',
    );
  }
}

/**
 * The trusted anchor of a Context Snapshot creation is the established
 * transaction context, not the Receipt's creator column: the creator must be
 * the trusted principal, and the Project scope must be allowed by that very
 * context. The database guards repeat the same closure against
 * `context_principal_id()`/`context_principal_kind()`; failing here keeps the
 * failure a stable module error instead of a raw guard violation.
 */
async function assertTrustedCreationContext(
  trx: TaskExecutionTransaction,
  row: { enterpriseId: string; projectId: string; createdByPrincipalId: string },
): Promise<void> {
  const trusted = await readTrustedContext(trx, row.enterpriseId, row.projectId);
  if (row.createdByPrincipalId !== trusted.principal_id) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
      'context snapshot creator must equal the trusted transaction principal',
    );
  }
  if (!trusted.allowsEnterprise || trusted.allowsProject !== true) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'context snapshot scope is not allowed by the trusted transaction context',
    );
  }
}

export class ContextSnapshotRepository {
  /**
   * Inserts the immutable Context Snapshot of one initial build. The Project
   * Scope uniqueness `(enterprise_id, project_id, object_id)` is the
   * database-adjudicated single-winner boundary for the CREATE identity: a
   * concurrent build of the same target under a different idempotency key
   * inserts nothing and is reported back to the caller instead of raising, so
   * the loser records its stable business rejection in the same transaction
   * (§19.8 item 3).
   */
  async insertContextSnapshot(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: ContextSnapshotInsert,
  ): Promise<boolean> {
    assertRunnerBoundContextSnapshotFacts(facts, row);
    await assertTrustedCreationContext(trx, row);
    const inserted = await trx
      .insertInto('task_execution.context_snapshot')
      .values({
        snapshot_id: row.snapshotId,
        object_id: row.objectId,
        purpose: row.purpose,
        audience: row.audience,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        builder_version: row.builderVersion,
        policy_snapshot_id: row.policySnapshotId,
        source_manifest_count: row.sourceManifestCount,
        context_item_count: row.contextItemCount,
        omission_count: row.omissionCount,
        redaction_count: row.redactionCount,
        coverage_state: row.coverageState,
        payload_hash: row.payloadHash,
        payload_hash_algorithm: 'SHA-256',
        expires_at: row.expiresAt ?? null,
        effective_expires_at: row.effectiveExpiresAt ?? null,
        request_payload_hash: row.requestPayloadHash,
        source_command_id: row.sourceCommandId,
        created_by_principal_id: row.createdByPrincipalId,
        canonical_payload: JSON.stringify(row.canonicalPayload),
      })
      // The Scope-unique CREATE identity is the only way this insert conflicts;
      // the untargeted form reports the single winner.
      .onConflict((conflict) => conflict.doNothing())
      .returning('snapshot_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /**
   * Inserts the INITIAL build metadata of a just-inserted Context Snapshot. The
   * row is accepted only when its Scope equals the runner-bound command Scope
   * and its creator is the trusted transaction principal; the V3004 mirror and
   * creation-identity guards then re-derive the promoted columns from
   * `canonicalPayload`, require the Snapshot row this `snapshot_id` names (the
   * FK is immediate, so the Snapshot is written first), and close the DRAFT
   * identity against the owning WorkOrder's current pointer.
   */
  async insertContextSnapshotBuild(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: ContextSnapshotBuildInsert,
  ): Promise<void> {
    assertRunnerBoundContextSnapshotFacts(facts, {
      objectId: facts.targetId,
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
    });
    await assertTrustedCreationContext(trx, row);
    await trx
      .insertInto('task_execution.context_snapshot_build')
      .values({
        snapshot_id: row.snapshotId,
        build_kind: row.buildKind,
        draft_snapshot_ref: JSON.stringify(row.draftSnapshotRef),
        frozen_contract_ref: null,
        slice_refs: JSON.stringify(row.sliceRefs),
        purpose: row.purpose,
        audience: JSON.stringify(row.audience),
        builder_policy_ref: JSON.stringify(row.builderPolicyRef),
        policy_content_hash: row.policyContentHash,
        policy_effective_from: row.policyEffectiveFrom,
        policy_superseded_at: row.policySupersededAt ?? null,
        request_expires_at: row.requestExpiresAt ?? null,
        effective_expires_at: row.effectiveExpiresAt ?? null,
        canonical_payload: JSON.stringify(row.canonicalPayload),
        payload_hash: row.payloadHash,
        request_payload_hash: row.requestPayloadHash,
        source_command_id: row.sourceCommandId,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        created_by_principal_id: row.createdByPrincipalId,
      })
      .execute();
  }

  /**
   * Reads one committed Context Snapshot by its exact identity -
   * `(object_id, snapshot_id, payload_hash)` - so the hash is part of the
   * lookup: a stored payload whose bytes changed can never be returned as the
   * Snapshot the request named. RLS is the only Scope authority here, so
   * "invisible" and "missing" reach the caller as the same undefined result.
   */
  async readContextSnapshot(
    trx: TaskExecutionTransaction,
    identity: { objectId: string; snapshotId: string; payloadHash: Buffer },
  ): Promise<ContextSnapshotRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.context_snapshot')
      .select([
        'snapshot_id',
        'object_id',
        'enterprise_id',
        'project_id',
        'payload_hash',
        'canonical_payload',
      ])
      .where('object_id', '=', identity.objectId)
      .where('snapshot_id', '=', identity.snapshotId)
      .where('payload_hash', '=', identity.payloadHash)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          snapshotId: row.snapshot_id,
          objectId: row.object_id,
          enterpriseId: row.enterprise_id,
          projectId: row.project_id,
          payloadHash: row.payload_hash,
          canonicalPayload: row.canonical_payload,
        };
  }
}
