// IM-06 (#188): shared Project Context Source Slice assembly.
//
// The assembly is the owning trimming rule of EnterpriseProject: it rebuilds
// allow-listed exact references from the committed Project/PROJECT_START
// binding, reads active baseline pointers and safe Enterprise Fact metadata,
// and records every omission/redaction instead of substituting empty values.
// `project.get_project_context_source@1.0` (WI-11) and the persisted
// `project.capture_context_source_slice@1.0` (#188) both consume this single
// implementation, so a captured Slice cannot disclose more than the owning
// Source Query would return for the same purpose.

import type { CanonicalJson, Common, EnterpriseProject } from '@zhiju/contracts';
import { sql } from 'kysely';
import type { EnterpriseProjectTransaction } from '../persistence/enterprise-db.js';
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import { loadActiveBaselineRefs } from './active-baseline-query.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_REF_INVALID,
} from './enterprise-business-errors.js';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export const SOURCE_KINDS = [
  'PROJECT',
  'ENTERPRISE_PROFILE',
  'QMS_CONFIGURATION',
  'PRODUCT_SCOPE',
  'ACTIVE_BASELINES',
  'ENTERPRISE_FACTS',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceSlicePurposePolicy {
  readonly allowFactMetadata: boolean;
  readonly allowActiveBaselines: boolean;
}

export const SOURCE_SLICE_PURPOSE_POLICIES: Readonly<Record<string, SourceSlicePurposePolicy>> = {
  'context.snapshot.read': { allowFactMetadata: true, allowActiveBaselines: true },
  'document.write': { allowFactMetadata: true, allowActiveBaselines: true },
  'review.read': { allowFactMetadata: true, allowActiveBaselines: true },
  'record.form.read': { allowFactMetadata: false, allowActiveBaselines: true },
};

export function sourceSliceError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

/** Closed purpose set of the Source Slice boundary; unknown purposes fail closed. */
export function validateSourceSlicePurpose(value: unknown): SourceSlicePurposePolicy {
  if (typeof value !== 'string' || SOURCE_SLICE_PURPOSE_POLICIES[value] === undefined) {
    sourceSliceError(
      PROJECT_QUERY_PURPOSE_FORBIDDEN,
      'purpose is not enabled for this Source Slice',
    );
  }
  return SOURCE_SLICE_PURPOSE_POLICIES[value];
}

export function validateRequestedKinds(value: readonly string[]): Set<SourceKind> {
  const result = new Set<SourceKind>();
  for (const kind of value) {
    if (!(SOURCE_KINDS as readonly string[]).includes(kind)) {
      sourceSliceError(PROJECT_QUERY_REF_INVALID, 'requestedKinds contains an unsupported kind');
    }
    if (result.has(kind as SourceKind)) {
      sourceSliceError(PROJECT_QUERY_REF_INVALID, 'requestedKinds must contain unique kinds');
    }
    result.add(kind as SourceKind);
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonValue(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    sourceSliceError(PROJECT_QUERY_NOT_FOUND, `${label} is not valid stored JSON`);
  }
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = jsonValue(value, label);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sourceSliceError(PROJECT_QUERY_NOT_FOUND, `${label} is not a stored JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function snapshotRef(
  value: unknown,
  expected: {
    readonly objectType: string;
    readonly objectId: string;
    readonly snapshotId: string;
    readonly enterpriseId: string;
    readonly projectId?: string;
    readonly payloadHash: Buffer;
  },
  label: string,
): Common.SnapshotRef {
  const ref = jsonObject(value, label);
  const scope = record(ref.scope);
  const contentHash = record(ref.contentHash);
  if (
    ref.kind !== 'SNAPSHOT' ||
    ref.objectType !== expected.objectType ||
    ref.objectId !== expected.objectId ||
    ref.snapshotId !== expected.snapshotId ||
    scope.enterpriseId !== expected.enterpriseId ||
    (expected.projectId === undefined
      ? scope.projectId !== undefined
      : scope.projectId !== expected.projectId) ||
    contentHash.algorithm !== 'SHA-256' ||
    contentHash.canonicalizationVersion !== '1' ||
    contentHash.digest !== expected.payloadHash.toString('hex')
  ) {
    sourceSliceError(
      PROJECT_QUERY_REF_INVALID,
      `${label} does not identify the persisted exact snapshot`,
    );
  }
  return {
    kind: 'SNAPSHOT',
    objectType: expected.objectType,
    objectId: expected.objectId,
    snapshotId: expected.snapshotId,
    scope:
      expected.projectId === undefined
        ? { enterpriseId: expected.enterpriseId }
        : { enterpriseId: expected.enterpriseId, projectId: expected.projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest: expected.payloadHash.toString('hex'),
      canonicalizationVersion: '1',
    },
  };
}

function versionedRef(
  value: unknown,
  expected: {
    readonly objectType: string;
    readonly objectId: string;
    readonly versionId: string;
    readonly enterpriseId: string;
    readonly projectId?: string;
  },
  label: string,
): Common.VersionedRef {
  const ref = jsonObject(value, label);
  const scope = record(ref.scope);
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== expected.objectType ||
    ref.objectId !== expected.objectId ||
    ref.versionId !== expected.versionId ||
    scope.enterpriseId !== expected.enterpriseId ||
    (expected.projectId === undefined
      ? scope.projectId !== undefined
      : scope.projectId !== expected.projectId)
  ) {
    sourceSliceError(
      PROJECT_QUERY_REF_INVALID,
      `${label} does not identify the persisted exact version`,
    );
  }
  return {
    kind: 'VERSIONED',
    objectType: expected.objectType,
    objectId: expected.objectId,
    versionId: expected.versionId,
    scope:
      expected.projectId === undefined
        ? { enterpriseId: expected.enterpriseId }
        : { enterpriseId: expected.enterpriseId, projectId: expected.projectId },
  };
}

async function readSourceWatermark(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
  asOf: Date | undefined,
): Promise<EnterpriseProject.SourceWatermark> {
  const result = await sql<{ sequence: number; observed_at: Date }>`
    SELECT COUNT(*)::integer AS sequence,
           COALESCE(MAX(recorded_at), ${asOf ?? new Date()}) AS observed_at
      FROM enterprise_project.outbox_event
     WHERE enterprise_id = ${enterpriseId}
       AND project_id = ${projectId}
       ${asOf === undefined ? sql`` : sql`AND recorded_at <= ${asOf}`}
  `.execute(trx);
  const row = result.rows[0];
  if (row === undefined) {
    sourceSliceError(PROJECT_QUERY_NOT_FOUND, 'source watermark could not be observed');
  }
  return {
    sourceModule: 'enterprise_project',
    partition: projectId,
    sequence: row.sequence,
    observedAt: new Date(row.observed_at).toISOString(),
  };
}

function omission(kind: string, reasonCode: string): CanonicalJsonObject {
  return { kind, reasonCode };
}

function redaction(path: string, reasonCode: string): CanonicalJsonObject {
  return { path, reasonCode };
}

async function readSafeFactItems(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
): Promise<{
  readonly items: readonly CanonicalJson[];
  readonly redactions: readonly CanonicalJson[];
}> {
  const repo = new EnterpriseBusinessRepository();
  const facts = await trx
    .selectFrom('enterprise_project.enterprise_fact')
    .select([
      'enterprise_fact_id',
      'fact_type',
      'risk_level',
      'current_version_id',
      'current_status',
    ])
    .where('enterprise_id', '=', enterpriseId)
    .orderBy('enterprise_fact_id', 'asc')
    .execute();
  const items: CanonicalJson[] = [];
  const redactions: CanonicalJson[] = [];
  for (const fact of facts) {
    if (fact.current_version_id === null) continue;
    const version = await repo.getEnterpriseFactVersion(trx, fact.current_version_id);
    if (
      version?.enterprise_fact_id !== fact.enterprise_fact_id ||
      version.enterprise_id !== enterpriseId ||
      version.status !== fact.current_status
    ) {
      sourceSliceError(
        PROJECT_QUERY_NOT_FOUND,
        'enterprise fact current version is not resolvable',
      );
    }
    const index = items.length;
    items.push({
      factRef: {
        kind: 'VERSIONED',
        objectType: 'EnterpriseFact',
        objectId: fact.enterprise_fact_id,
        versionId: version.version_id,
        scope: { enterpriseId },
      },
      factType: fact.fact_type,
      riskLevel: fact.risk_level,
      status: fact.current_status,
      value: {
        presence: 'REDACTED',
        reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED',
        evidenceRefs: [],
      },
    });
    redactions.push(
      redaction(`/factItems/${index}/value`, 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED'),
    );
    redactions.push(
      redaction(`/factItems/${index}/sourceRefs`, 'PROJECT_QUERY_SOURCE_REFS_REDACTED'),
    );
  }
  return { items, redactions };
}

export interface ProjectContextSourceSliceRequest {
  /** Already validated closed purpose of the request. */
  readonly purpose: string;
  /** Already validated requested kinds. */
  readonly requestedKinds: ReadonlySet<SourceKind>;
  /** Observation instant for the source watermark; omitted means "now". */
  readonly asOf?: Date | undefined;
}

/**
 * Assembles the permission-trimmed Project Context Source Slice from the
 * Project's committed owning facts inside the caller's transaction. The
 * Project and its `PROJECT_START` binding must exist in the exact requested
 * scope: a missing or inconsistent source fails closed instead of producing an
 * empty shell Slice.
 */
export async function assembleProjectContextSourceSlice(
  trx: EnterpriseProjectTransaction,
  scope: { readonly enterpriseId: string; readonly projectId: string },
  request: ProjectContextSourceSliceRequest,
): Promise<EnterpriseProject.ProjectContextSourceSlice> {
  const policy = validateSourceSlicePurpose(request.purpose);
  const { requestedKinds, asOf } = request;
  const repo = new EnterpriseBusinessRepository();
  const project = await repo.getProjectById(trx, scope.projectId);
  const binding = await repo.getProjectSnapshotBinding(trx, scope.projectId, 'PROJECT_START');
  const bindingMatchesScope =
    binding?.enterprise_id === scope.enterpriseId && binding.project_id === scope.projectId;
  if (project?.enterprise_id !== scope.enterpriseId || !bindingMatchesScope) {
    sourceSliceError(PROJECT_QUERY_NOT_FOUND, 'Project or ProjectSnapshotBinding was not found');
  }
  const enterpriseProfileSnapshotRef = snapshotRef(
    binding.enterprise_profile_snapshot_ref,
    {
      objectType: 'EnterpriseProfileSnapshot',
      objectId: binding.enterprise_profile_snapshot_id,
      snapshotId: binding.enterprise_profile_snapshot_id,
      enterpriseId: scope.enterpriseId,
      payloadHash: binding.enterprise_profile_payload_hash,
    },
    'enterpriseProfileSnapshotRef',
  );
  const qmsConfigurationRef = versionedRef(
    binding.qms_configuration_ref,
    {
      objectType: 'QMSConfiguration',
      objectId: binding.qms_configuration_id,
      versionId: binding.qms_configuration_revision_id,
      enterpriseId: scope.enterpriseId,
    },
    'qmsConfigurationRef',
  );
  const productScopeSnapshotRef = snapshotRef(
    binding.product_scope_snapshot_ref,
    {
      objectType: 'ProductScopeSnapshot',
      objectId: binding.product_scope_snapshot_id,
      snapshotId: binding.product_scope_snapshot_id,
      enterpriseId: scope.enterpriseId,
      payloadHash: binding.product_scope_payload_hash,
    },
    'productScopeSnapshotRef',
  );
  const omissions: CanonicalJson[] = [];
  const redactions: CanonicalJson[] = [];
  const activeBaselineRefs = requestedKinds.has('ACTIVE_BASELINES')
    ? policy.allowActiveBaselines
      ? Object.values(
          await loadActiveBaselineRefs(trx, scope.enterpriseId, scope.projectId),
        ).filter(
          (value): value is Common.VersionedRef =>
            value !== null && typeof value === 'object' && 'kind' in value,
        )
      : (omissions.push(omission('ACTIVE_BASELINES', 'PURPOSE_FORBIDDEN')), [])
    : (omissions.push(omission('ACTIVE_BASELINES', 'KIND_NOT_REQUESTED')), []);
  let factItems: readonly CanonicalJson[] = [];
  if (!requestedKinds.has('ENTERPRISE_FACTS')) {
    omissions.push(omission('ENTERPRISE_FACTS', 'KIND_NOT_REQUESTED'));
  } else if (!policy.allowFactMetadata) {
    omissions.push(omission('ENTERPRISE_FACTS', 'PURPOSE_FORBIDDEN'));
  } else {
    const facts = await readSafeFactItems(trx, scope.enterpriseId);
    factItems = facts.items;
    redactions.push(...facts.redactions);
  }
  for (const kind of SOURCE_KINDS) {
    if (kind !== 'ACTIVE_BASELINES' && kind !== 'ENTERPRISE_FACTS' && !requestedKinds.has(kind)) {
      omissions.push(omission(kind, 'KIND_NOT_REQUESTED'));
    }
  }
  if (requestedKinds.has('ENTERPRISE_FACTS') && policy.allowFactMetadata) {
    redactions.push(redaction('/factItems/*/value', 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED'));
    redactions.push(redaction('/factItems/*/sourceRefs', 'PROJECT_QUERY_SOURCE_REFS_REDACTED'));
  }
  return {
    projectRef: {
      kind: 'OBJECT',
      objectType: 'Project',
      objectId: scope.projectId,
      scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    },
    enterpriseProfileSnapshotRef,
    qmsConfigurationRef,
    productScopeSnapshotRef,
    activeBaselineRefs,
    factItems,
    omissions,
    redactions,
    sourceWatermark: await readSourceWatermark(trx, scope.enterpriseId, scope.projectId, asOf),
  };
}
