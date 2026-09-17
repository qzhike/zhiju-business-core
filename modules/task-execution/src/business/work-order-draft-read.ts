// IM-06 (#212): `execution.get_work_order_draft@1.1` / `@2.0`, the exact DRAFT
// read (Spec 003 §18.8).
//
// The read returns committed facts only: the WorkOrder Root, the snapshot its
// composite pointer names and the stored canonical payload. It never rebuilds a
// draft, never fills a missing member and never infers an identity from another
// column, so a Root whose pointer and payload disagree is a `REFERENCE_INVALID`
// rather than a partial success. `expiresAt` is read back verbatim; an expired
// but still `DRAFT` Root keeps returning its historical draft, and a returned
// draft grants no build, validation, freeze, queue or execution eligibility
// (Spec 003 §11.2.4 item 2).
//
// The two satisfiable versions are mirror images and neither reads the other's
// creation fact: `@1.1` serves the canonical `zhiju.execution.work_order` with
// its `InitialWorkOrderDraft`, `@2.0` serves the legacy `execution.work_order`
// with its `WorkOrderDraft`. `execution.get_work_order_draft@1.0` has no handler
// at all, because no creation major produces its declared combination (§18.2).
//
// This path writes nothing: no Receipt, no Audit, no Edge, no Outbox row. The
// read authorization is revalidated by the composition entry through the
// IdentityPolicy-owned read Port before this function is reached.

import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  CANONICALIZATION_VERSION,
  digestCanonicalPayload,
  withTaskExecutionTransaction,
  type CanonicalPayloadDigest,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { WorkOrderDraftRepository } from '../persistence/work-order-draft-repository.js';
import { exactProjectScope } from './task-readiness-plan.js';
import { EXECUTION_WORK_ORDER_REF_INVALID } from './work-order-draft-creation.js';

/** The registered query this handler owns. Its `@1.0` version has no handler. */
export const GET_WORK_ORDER_DRAFT_QUERY = 'execution.get_work_order_draft';

/** Shared codes of §18.11: a non-DRAFT Root, and an inconsistent stored fact. */
export const AGGREGATE_STATE_NOT_ALLOWED = 'AGGREGATE_STATE_NOT_ALLOWED';
export const REFERENCE_INVALID = 'REFERENCE_INVALID';

/** The CONTENT_ADDRESSED object type of §18.8's `draftSnapshotRef`. */
export const WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE = 'zhiju.execution.work_order_draft_snapshot';

/**
 * The per-version read binding of §18.2: each read version accepts exactly the
 * one WorkOrder spelling its creating major produced, and can only read a Root
 * whose `draft_schema_version` is that same creation major. The two entries are
 * mirror images, never aliases: neither accepts the other's spelling, and there
 * is no fallback, normalization or implicit version.
 */
export interface WorkOrderDraftReadBinding {
  readonly commandVersion: '1.1' | '2.0';
  /** This read version's one accepted WorkOrder spelling. */
  readonly workOrderObjectType: string;
  /** The Root `draft_schema_version` this read version can return. */
  readonly draftSchemaVersion: string;
}

export const WORK_ORDER_DRAFT_READ_BINDINGS: readonly WorkOrderDraftReadBinding[] = Object.freeze([
  Object.freeze({
    commandVersion: '1.1',
    workOrderObjectType: 'zhiju.execution.work_order',
    draftSchemaVersion: '1.1',
  }),
  Object.freeze({
    commandVersion: '2.0',
    workOrderObjectType: 'execution.work_order',
    draftSchemaVersion: '1.0',
  }),
]);

export interface WorkOrderDraftReadInput {
  readonly commandVersion: '1.1' | '2.0';
  readonly payload: unknown;
}

/**
 * The closed outcome of one draft read. A refusal carries a stable safe code and
 * never a partial draft; the caller learns nothing about objects outside its own
 * Project scope.
 */
export type WorkOrderDraftReadResult =
  | { readonly status: 'FOUND'; readonly resultPayload: CanonicalJsonObject }
  | { readonly status: 'REJECTED'; readonly errorCode: string; readonly safeSummary: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reject(errorCode: string, safeSummary: string): WorkOrderDraftReadResult {
  return { status: 'REJECTED', errorCode, safeSummary };
}

/** The registered result carries a lossless non-negative integer. */
function readAggregateVersion(value: string): number | undefined {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return Number(parsed);
  } catch {
    return undefined;
  }
}

export async function handleGetWorkOrderDraft(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: WorkOrderDraftReadInput,
): Promise<WorkOrderDraftReadResult> {
  const binding = WORK_ORDER_DRAFT_READ_BINDINGS.find(
    (candidate) => candidate.commandVersion === input.commandVersion,
  );
  if (binding === undefined) {
    return reject(
      EXECUTION_WORK_ORDER_REF_INVALID,
      'the requested draft read version has no handler',
    );
  }
  const payload = record(input.payload);
  const workOrderRef = record(payload.workOrderRef);
  const workOrderId = workOrderRef.objectId;
  // The shared helper reads the Scope object itself, so the reference that
  // wraps it is unwrapped exactly once.
  const refScope = exactProjectScope(workOrderRef.scope);
  if (
    workOrderRef.kind !== 'OBJECT' ||
    workOrderRef.objectType !== binding.workOrderObjectType ||
    typeof workOrderId !== 'string' ||
    !isUuidV7(workOrderId) ||
    refScope === undefined
  ) {
    return reject(
      EXECUTION_WORK_ORDER_REF_INVALID,
      'workOrderRef must be the OBJECT of this read version spelling in an exact Project scope',
    );
  }

  return withTaskExecutionTransaction(db, context, async (trx) => {
    const repository = new WorkOrderDraftRepository();
    const root = await repository.readWorkOrderRoot(trx, workOrderId);
    // RLS is the only Scope authority: an invisible WorkOrder is refused exactly
    // like a misspelled, wrong-version or foreign one, so the facade never
    // reports the existence of another Scope's object.
    if (root === undefined) {
      return reject(
        EXECUTION_WORK_ORDER_REF_INVALID,
        'the WorkOrder reference does not close against a committed WorkOrder of this scope',
      );
    }
    if (
      root.workOrderObjectType !== binding.workOrderObjectType ||
      root.workOrderObjectType !== workOrderRef.objectType ||
      root.workOrderId !== workOrderId ||
      root.enterpriseId !== refScope.enterpriseId ||
      root.projectId !== refScope.projectId ||
      root.draftSchemaVersion !== binding.draftSchemaVersion
    ) {
      return reject(
        EXECUTION_WORK_ORDER_REF_INVALID,
        'the WorkOrder reference does not close against a committed WorkOrder of this scope',
      );
    }
    // §18.8 item 3: only a DRAFT Root has a readable draft.
    if (root.status !== 'DRAFT') {
      return reject(AGGREGATE_STATE_NOT_ALLOWED, 'only a DRAFT WorkOrder has a readable draft');
    }

    const aggregateVersion = readAggregateVersion(root.aggregateVersion);
    const snapshot = await repository.readWorkOrderDraftSnapshot(
      trx,
      root.workOrderId,
      root.currentDraftSnapshotId,
      root.currentDraftSnapshotHash,
    );
    if (snapshot === undefined || aggregateVersion === undefined) {
      return reject(REFERENCE_INVALID, 'the WorkOrder draft pointer does not close');
    }
    // §18.8 item 2: the content address of the returned reference is recomputed
    // from the stored bytes, so the pointer, the snapshot row and the payload are
    // one fact or the read fails.
    let digest: CanonicalPayloadDigest;
    try {
      digest = digestCanonicalPayload(snapshot.canonicalPayload as CanonicalJsonObject);
    } catch {
      return reject(
        REFERENCE_INVALID,
        'the stored draft payload cannot define its content address',
      );
    }
    if (
      !snapshot.payloadHash.equals(root.currentDraftSnapshotHash) ||
      !digest.hash.equals(snapshot.payloadHash)
    ) {
      return reject(REFERENCE_INVALID, 'the stored draft payload does not match the pointer');
    }

    const stored = record(snapshot.canonicalPayload);
    const storedWorkOrderRef = record(stored.workOrderRef);
    const storedTaskRef = record(stored.taskRef);
    const storedScope = record(stored.scopeRef);
    const storedDraft = stored.draft;
    const storedExpiresAt = Object.prototype.hasOwnProperty.call(stored, 'expiresAt')
      ? stored.expiresAt
      : undefined;
    if (
      storedWorkOrderRef.kind !== 'OBJECT' ||
      storedWorkOrderRef.objectType !== root.workOrderObjectType ||
      storedWorkOrderRef.objectId !== root.workOrderId ||
      storedTaskRef.kind !== 'OBJECT' ||
      storedTaskRef.objectType !== root.taskObjectType ||
      storedTaskRef.objectId !== root.taskId ||
      storedScope.enterpriseId !== root.enterpriseId ||
      storedScope.projectId !== root.projectId ||
      storedDraft === null ||
      typeof storedDraft !== 'object' ||
      Array.isArray(storedDraft)
    ) {
      return reject(REFERENCE_INVALID, 'the stored draft payload does not match its WorkOrder');
    }
    // `expiresAt` is read back verbatim: the member the command declared, whose
    // presence and value the database already proved against the Root column.
    const expiresAtMs =
      typeof storedExpiresAt === 'string' ? Date.parse(storedExpiresAt) : Number.NaN;
    if (
      (root.expiresAt === null) !== (storedExpiresAt === undefined) ||
      (root.expiresAt !== null &&
        (!Number.isFinite(expiresAtMs) || expiresAtMs !== root.expiresAt.getTime()))
    ) {
      return reject(REFERENCE_INVALID, 'the stored draft expiry does not match its WorkOrder');
    }

    return {
      status: 'FOUND',
      resultPayload: {
        draftSnapshotRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
          objectId: root.currentDraftSnapshotId,
          scope: { enterpriseId: root.enterpriseId, projectId: root.projectId },
          contentHash: {
            algorithm: 'SHA-256',
            digest: digest.hash.toString('hex'),
            canonicalizationVersion: CANONICALIZATION_VERSION,
          },
        },
        draft: storedDraft as CanonicalJsonObject,
        ...(storedExpiresAt === undefined ? {} : { expiresAt: storedExpiresAt as string }),
        rootAggregateVersion: aggregateVersion,
        status: root.status,
      },
    };
  });
}
