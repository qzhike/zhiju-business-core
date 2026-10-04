// IM-06 TD-05 (#248), Spec 001 §15.19: the IdentityPolicy-owned Task Board
// authorization source fingerprint.
//
// The Board cursor binds a fingerprint of the *actual* authorization source so
// that a newly signed short-lived Decision over the same principal, Actor
// Snapshot, mapping, config code, Scope and Policy does not invalidate a
// cursor, while a real identity, Scope, configuration or Policy change does.
// The composition layer supplies only the already-read facts; the canonical
// ordering and the field allow-list live here, so no consumer re-derives an
// IdentityPolicy table or invents its own fingerprint shape.

import { canonicalize, sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';

/** One actually-used authorization mapping of the current Board access. */
export interface TaskBoardAuthorizationSourceEntry {
  readonly capabilityConfigKey: string;
  readonly capabilityCode: string;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly purpose: string;
  readonly principalId: string;
  readonly principalKind: string;
  readonly actorSnapshotId: string;
  readonly actorSnapshotPayloadHash: string;
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly policySnapshotId: string;
  readonly policySnapshotPayloadHash: string;
}

export interface TaskBoardAuthorizationSource {
  readonly entries: readonly TaskBoardAuthorizationSourceEntry[];
  readonly boardPolicyRef: CanonicalJsonValue;
  readonly boardPolicyContentHash: string;
}

/**
 * Canonical fingerprint of the Board authorization source. It deliberately
 * excludes Decision id/issuedAt/expiresAt and every current check time.
 */
export function taskBoardAuthorizationSourceHash(source: TaskBoardAuthorizationSource): string {
  const entries = [...source.entries]
    .map((entry) => ({
      actorSnapshotId: entry.actorSnapshotId,
      actorSnapshotPayloadHash: entry.actorSnapshotPayloadHash,
      capabilityCode: entry.capabilityCode,
      capabilityConfigKey: entry.capabilityConfigKey,
      commandType: entry.commandType,
      commandVersion: entry.commandVersion,
      enterpriseId: entry.enterpriseId,
      policySnapshotId: entry.policySnapshotId,
      policySnapshotPayloadHash: entry.policySnapshotPayloadHash,
      principalId: entry.principalId,
      principalKind: entry.principalKind,
      projectId: entry.projectId,
      purpose: entry.purpose,
    }))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(canonicalize(left as unknown as CanonicalJsonValue), 'utf8'),
        Buffer.from(canonicalize(right as unknown as CanonicalJsonValue), 'utf8'),
      ),
    );
  return sha256CanonicalJson({
    entries: entries as unknown as CanonicalJsonValue,
    boardPolicyRef: source.boardPolicyRef,
    boardPolicyContentHash: source.boardPolicyContentHash,
  });
}
