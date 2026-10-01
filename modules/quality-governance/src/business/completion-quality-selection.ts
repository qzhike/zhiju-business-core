import type { Common } from '@zhiju/contracts';
import { canonicalize, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  withQualityGovernanceTransaction,
  digestCanonicalPayload,
  type QualityGovernanceDb,
  type QualityTransactionContext,
} from '../persistence/quality-db.js';
import { QualityBusinessRepository } from '../persistence/quality-business-repository.js';
import { exactQualityProfileRef } from './quality-business-validation.js';
import { validateContentAddressedRef } from './quality-gate-validation.js';
import { QualityBusinessError } from './quality-business-errors.js';

export const COMPLETION_QUALITY_SELECTION_PURPOSE = 'quality.completion_selection.read';
const repo = new QualityBusinessRepository();
export interface CompletionQualitySelectionPort {
  read(input: {
    revisionRef: Common.ContentAddressedRef;
    qualityProfileRef: Common.VersionedRef;
    requireApproval: boolean;
  }): Promise<CanonicalJsonObject>;
}
/** Discover exact committed facts for one frozen Profile; never search older anchors. */
export async function handleCompletionQualitySelection(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  input: {
    revisionRef: Common.ContentAddressedRef;
    qualityProfileRef: Common.VersionedRef;
    requireApproval: boolean;
  },
  revalidate: () => Promise<void>,
  now: () => Date,
) {
  await revalidate();
  if (
    !['HUMAN', 'SERVICE'].includes(context.principalKind) ||
    !context.authorizationPurposes?.includes(COMPLETION_QUALITY_SELECTION_PURPOSE) ||
    Object.keys(input).length !== 3
  )
    throw new QualityBusinessError(
      'QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED',
      'Completion selection is unavailable',
    );
  const revisionRef = validateContentAddressedRef(
    input.revisionRef,
    context,
    'revisionRef',
    new Set(['artifact.artifact_revision']),
  );
  const qualityProfileRef = exactQualityProfileRef(input.qualityProfileRef, context);
  if (
    canonicalize(qualityProfileRef.scope as unknown as CanonicalJsonObject) !==
      canonicalize({ enterpriseId: context.enterpriseId }) ||
    typeof input.requireApproval !== 'boolean'
  )
    throw new QualityBusinessError(
      'QUALITY_PROFILE_QUERY_NOT_FOUND',
      'Completion Profile is unavailable',
    );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const root = await repo.getQualityProfileById(trx, qualityProfileRef.objectId),
      version = await repo.getQualityProfileVersionById(trx, qualityProfileRef.versionId);
    if (
      !root ||
      version?.quality_profile_id !== root.quality_profile_id ||
      version.enterprise_id !== context.enterpriseId ||
      version.project_id !== null ||
      !digestCanonicalPayload(version.definition as CanonicalJsonObject).hash.equals(
        version.definition_hash,
      )
    )
      throw new QualityBusinessError(
        'QUALITY_PROFILE_QUERY_NOT_FOUND',
        'Completion Profile is unavailable',
      );
    const ras = await repo.getLatestRevisionAcceptanceSnapshot(trx, revisionRef, qualityProfileRef),
      abs = input.requireApproval
        ? await repo.getLatestApprovalBundleSnapshot(trx, revisionRef, qualityProfileRef)
        : undefined;
    const snapshotRef = (type: string, id: string, digest: Buffer) => ({
      kind: 'SNAPSHOT',
      objectType: type,
      objectId: id,
      snapshotId: id,
      scope: revisionRef.scope,
      contentHash: {
        algorithm: 'SHA-256',
        canonicalizationVersion: '1',
        digest: digest.toString('hex'),
      },
    });
    const revisionAcceptanceRef = ras
      ? snapshotRef('quality.revision_acceptance_snapshot', ras.snapshot_id, ras.payload_hash)
      : undefined;
    const approvalBundleRef =
      abs &&
      revisionAcceptanceRef &&
      canonicalize(abs.revision_acceptance_snapshot_ref as CanonicalJsonObject) ===
        canonicalize(revisionAcceptanceRef as unknown as CanonicalJsonObject)
        ? snapshotRef('quality.approval_bundle_snapshot', abs.snapshot_id, abs.payload_hash)
        : undefined;
    const body = {
      revisionRef,
      qualityProfileRef,
      profileUsable:
        root.status === 'ACTIVE' &&
        version.status === 'ACTIVE' &&
        root.active_version_id === version.profile_version_id,
      ...(revisionAcceptanceRef ? { revisionAcceptanceRef } : {}),
      ...(approvalBundleRef ? { approvalBundleRef } : {}),
    } as unknown as CanonicalJsonObject;
    await revalidate();
    return {
      ...body,
      selectionHash: {
        algorithm: 'SHA-256',
        canonicalizationVersion: '1',
        digest: sha256CanonicalJson(body),
      },
      observedAt: now().toISOString(),
      sourceWatermarks: [
        {
          sourceModule: 'quality_governance',
          sequence: Number(root.aggregate_version),
          observedAt: now().toISOString(),
        },
      ],
    };
  });
}

/** Frozen completion profiles require the owning current ACTIVE version at freeze. */
export async function handleReadCompletionQualityProfile(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  ref: Common.VersionedRef,
  revalidate: () => Promise<void>,
) {
  await revalidate();
  const profile = exactQualityProfileRef(ref, context);
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const root = await repo.getQualityProfileById(trx, profile.objectId);
    const version = await repo.getQualityProfileVersionById(trx, profile.versionId);
    if (
      !root ||
      !version ||
      root.project_id !== null ||
      version.quality_profile_id !== root.quality_profile_id ||
      !digestCanonicalPayload(version.definition as CanonicalJsonObject).hash.equals(
        version.definition_hash,
      )
    )
      throw new QualityBusinessError(
        'QUALITY_PROFILE_QUERY_NOT_FOUND',
        'Completion Profile unavailable',
      );
    await revalidate();
    return {
      qualityProfileRef: profile,
      definitionHash: version.definition_hash.toString('hex'),
      usable:
        root.status === 'ACTIVE' &&
        version.status === 'ACTIVE' &&
        root.active_version_id === version.profile_version_id,
    } as unknown as CanonicalJsonObject;
  });
}
