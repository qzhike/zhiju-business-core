// IM-06 TD-05 (#248): the internal Task Board snapshot profile shared by the
// owning source assembler, the export manifest and the Projection store.
//
// The public operation keeps its published `TaskBoardItem`/`TaskBoardPage`
// schemas; everything here is the internal, canonicalizing representation that
// both the AUTHORITATIVE read and the EXPORT path assemble from the same
// REPEATABLE READ snapshot. `filterKeys` never reaches the strict public page.

import { Buffer } from 'node:buffer';
import {
  canonicalize,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';

/** Registry key of the finite Board Policy profile (Spec 003 §12.5). */
export const TASK_BOARD_POLICY_PROFILE_KEY = 'execution.task_board.policy@1.0';

/** Source module of the Board SourceWatermark (the export publication stream). */
export const TASK_BOARD_SOURCE_MODULE = 'task_execution';

/** The two accepted Project spellings; neither authorizes the other. */
export const TASK_BOARD_PROJECT_OBJECT_TYPES = [
  'project.project',
  'zhiju.project.project',
] as const;

/** WorkOrder statuses that are still in flight on the Board. */
export const TASK_BOARD_ACTIVE_WORK_ORDER_STATUSES = [
  'DRAFT',
  'READY',
  'QUEUED',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETION_PENDING',
  'RETRY_PENDING',
] as const;

export type TaskBoardConsistency = 'AUTHORITATIVE' | 'SNAPSHOT_AT_LEAST' | 'PROJECTION_OK';
export type TaskBoardStalenessStatus = 'FRESH' | 'STALE' | 'REBUILDING' | 'FAILED';

/** The closed rule fields of `execution.task_board.policy@1.0`. */
export interface TaskBoardPolicyRules {
  readonly maxPageSize: number;
  readonly maxSnapshotRows: number;
  readonly maxSnapshotBytes: number;
  readonly freshnessMaxAgeSeconds: number;
  readonly cursorTtlSeconds: number;
  readonly refreshIntervalSeconds: number;
  readonly workerLeaseSeconds: number;
}

/** The exact immutable Policy observation a generation was published under. */
export interface TaskBoardPolicyObservation {
  readonly policyRef: CanonicalJsonObject;
  readonly policyVersionRef: CanonicalJsonObject;
  readonly contentHash: string;
  readonly effectiveFrom: string;
  readonly supersededAt?: string;
}

/** One internal Board row: the public item plus its private filter bindings. */
export interface TaskBoardSnapshotRow {
  readonly item: CanonicalJsonObject;
  readonly filterKeys: {
    readonly deliveryItemRef?: CanonicalJsonObject;
  };
}

/** One owning source identity/version/hash that changed the snapshot. */
export interface TaskBoardSourceIdentity {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion?: number;
  readonly sourceHash?: string;
}

/** The complete immutable manifest of one pre-allocated `exportId`. */
export interface TaskBoardSnapshotManifest {
  readonly exportId: string;
  readonly projectRef: CanonicalJsonObject;
  readonly snapshotAt: string;
  readonly policyRef: CanonicalJsonObject;
  readonly policyObservation: TaskBoardPolicyObservation;
  readonly rows: readonly TaskBoardSnapshotRow[];
  readonly rowCount: number;
  readonly rowsHash: string;
  readonly sourceFingerprint: string;
  readonly coveredDirtyIds: readonly string[];
}

const utf8 = (value: string): Buffer => Buffer.from(value, 'utf8');

/** Canonical UTF-8 byte order of two Task ids (the fixed Board sort key). */
export function compareTaskBoardTaskId(left: string, right: string): number {
  return Buffer.compare(utf8(left), utf8(right));
}

/** SHA-256/cv1 over the complete ordered internal row array. */
export function taskBoardRowsHash(rows: readonly TaskBoardSnapshotRow[]): string {
  return sha256CanonicalJson(rows as unknown as CanonicalJsonValue);
}

/**
 * SHA-256/cv1 over the complete canonical manifest. The manifest carries no
 * self-hash member, so the hash covers every other field including filterKeys,
 * field presence, policy observation, source fingerprint and covered dirty ids.
 */
export function taskBoardManifestHash(manifest: TaskBoardSnapshotManifest): string {
  return sha256CanonicalJson(manifest as unknown as CanonicalJsonValue);
}

/**
 * The source fingerprint: the ordered row array plus the sorted local source
 * identity/version/hash vector. It deliberately excludes snapshotAt, dirty
 * markers and any current authorization time, so a repeated AUTHORITATIVE read
 * of an unchanged Project reproduces the same fingerprint.
 */
export function taskBoardSourceFingerprint(
  rows: readonly TaskBoardSnapshotRow[],
  sources: readonly TaskBoardSourceIdentity[],
): string {
  const ordered = [...sources].sort((left, right) => {
    const leftKey = `${left.sourceType}\u0000${left.sourceId}`;
    const rightKey = `${right.sourceType}\u0000${right.sourceId}`;
    return Buffer.compare(utf8(leftKey), utf8(rightKey));
  });
  return sha256CanonicalJson({
    rows: rows as unknown as CanonicalJsonValue,
    sources: ordered as unknown as CanonicalJsonValue,
  });
}

/** The canonical normalized-filter hash bound into a cursor. */
export function taskBoardFilterHash(input: {
  readonly statuses: readonly string[];
  readonly deliveryItemRef?: CanonicalJsonObject | undefined;
}): string {
  const statuses = [...new Set(input.statuses)].sort((left, right) =>
    Buffer.compare(utf8(left), utf8(right)),
  );
  return sha256CanonicalJson({
    statuses,
    ...(input.deliveryItemRef === undefined ? {} : { deliveryItemRef: input.deliveryItemRef }),
  });
}

/** The declared UTF-8 byte budget of the canonical manifest. */
export function taskBoardManifestBytes(manifest: TaskBoardSnapshotManifest): number {
  return Buffer.byteLength(canonicalize(manifest as unknown as CanonicalJsonValue), 'utf8');
}

/** Strict deep equality of two canonical refs/values. */
export function taskBoardSameRef(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

/**
 * A full canonical VersionedRef comparator: kind/objectType/objectId/versionId
 * and the complete Scope (plus any legal qualifier) must all be equal, so two
 * DeliveryItem versions or the two spellings never match each other.
 */
export function taskBoardSameVersionedRef(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return false;
  return taskBoardSameRef(left, right);
}
