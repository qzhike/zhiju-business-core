// IM-03 WI-11 (issue #67): authoritative Query and permission-trimmed
// Project Board read handlers. Query handlers validate the trusted context
// before opening a database transaction and never replace an exact reference
// with a latest/current lookup.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { CanonicalJson, Common, EnterpriseProject } from '@zhiju/contracts';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  withProjectionTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import {
  PROJECT_BOARD_PROJECTION_CONSUMER,
  compareProjectBoardPosition,
  projectBoardItemFromRow,
  readProjectBoardProjection,
} from '../persistence/project-board-projection-repository.js';
import type { ProjectBoardTable } from '../persistence/projection-types.js';
import { loadActiveBaselineRefs } from './active-baseline-query.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_CURSOR_INVALID,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';
import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

type ContextSourcePayload = EnterpriseProject.ProjectGetProjectContextSourcePayload;
type BoardPayload = EnterpriseProject.ProjectGetProjectBoardSlicePayload;

const SOURCE_KINDS = [
  'PROJECT',
  'ENTERPRISE_PROFILE',
  'QMS_CONFIGURATION',
  'PRODUCT_SCOPE',
  'ACTIVE_BASELINES',
  'ENTERPRISE_FACTS',
] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];

const PURPOSE_POLICIES: Readonly<
  Record<string, { readonly allowFactMetadata: boolean; readonly allowActiveBaselines: boolean }>
> = {
  'context.snapshot.read': { allowFactMetadata: true, allowActiveBaselines: true },
  'document.write': { allowFactMetadata: true, allowActiveBaselines: true },
  'review.read': { allowFactMetadata: true, allowActiveBaselines: true },
  'record.form.read': { allowFactMetadata: false, allowActiveBaselines: true },
};

const EXECUTION_STATUSES = new Set<EnterpriseProject.DeliveryExecutionStatus>([
  'NOT_READY',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'APPROVED_OUTPUT',
  'RELEASED',
  'COMPLETED',
]);

function queryError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
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
    queryError(PROJECT_QUERY_NOT_FOUND, `${label} is not valid stored JSON`);
  }
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = jsonValue(value, label);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    queryError(PROJECT_QUERY_NOT_FOUND, `${label} is not a stored JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function exactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
): { readonly enterpriseId: string; readonly projectId: string } {
  const ref = record(value);
  const scope = record(ref.scope);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'Project' ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    scope.enterpriseId !== context.enterpriseId ||
    scope.projectId !== ref.objectId
  ) {
    queryError(PROJECT_QUERY_REF_INVALID, 'projectRef must be an exact Project ObjectRef');
  }
  if (!context.allowedProjectIds.includes(ref.objectId)) {
    queryError(PROJECT_QUERY_SCOPE_MISMATCH, 'projectRef is outside the trusted Project scope');
  }
  return { enterpriseId: context.enterpriseId, projectId: ref.objectId };
}

function validateContext(context: EnterpriseProjectTransactionContext): void {
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    queryError(PROJECT_QUERY_CONTEXT_EXPIRED, 'authorization context has expired');
  }
}

function validateAudience(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
): void {
  const audience = record(value);
  const scope = record(audience.scope);
  const audienceProjectId = scope.projectId;
  if (
    audience.kind !== 'OBJECT' ||
    (audience.objectType !== 'Principal' && audience.objectType !== 'identity.principal') ||
    typeof audience.objectId !== 'string' ||
    !isUuidV7(audience.objectId) ||
    scope.enterpriseId !== context.enterpriseId ||
    (audienceProjectId !== undefined && audienceProjectId !== projectId) ||
    audience.objectId !== context.principalId
  ) {
    queryError(
      PROJECT_QUERY_AUDIENCE_INVALID,
      'audience must identify the trusted Principal exactly',
    );
  }
}

function validatePurpose(value: unknown): {
  readonly allowFactMetadata: boolean;
  readonly allowActiveBaselines: boolean;
} {
  if (typeof value !== 'string' || PURPOSE_POLICIES[value] === undefined) {
    queryError(PROJECT_QUERY_PURPOSE_FORBIDDEN, 'purpose is not enabled for this Source Slice');
  }
  return PURPOSE_POLICIES[value];
}

function validateRequestedKinds(value: readonly string[]): Set<SourceKind> {
  const result = new Set<SourceKind>();
  for (const kind of value) {
    if (!(SOURCE_KINDS as readonly string[]).includes(kind)) {
      queryError(PROJECT_QUERY_REF_INVALID, 'requestedKinds contains an unsupported kind');
    }
    if (result.has(kind as SourceKind)) {
      queryError(PROJECT_QUERY_REF_INVALID, 'requestedKinds must contain unique kinds');
    }
    result.add(kind as SourceKind);
  }
  return result;
}

function parseInstant(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    queryError(PROJECT_QUERY_REF_INVALID, `${label} must be a valid UTC instant`);
  }
  return parsed;
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
    queryError(
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
    queryError(PROJECT_QUERY_REF_INVALID, `${label} does not identify the persisted exact version`);
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
  trx: Parameters<Parameters<typeof withEnterpriseProjectTransaction>[2]>[0],
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
    queryError(PROJECT_QUERY_NOT_FOUND, 'source watermark could not be observed');
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
  trx: Parameters<Parameters<typeof withEnterpriseProjectTransaction>[2]>[0],
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
      queryError(PROJECT_QUERY_NOT_FOUND, 'enterprise fact current version is not resolvable');
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

export type GetProjectContextSourceQueryPayload = ContextSourcePayload;

export async function handleGetProjectContextSource(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: ContextSourcePayload,
): Promise<EnterpriseProject.ProjectGetProjectContextSourceResult> {
  validateContext(context);
  const scope = exactProjectRef(payload.projectRef, context);
  validateAudience(payload.audience, context, scope.projectId);
  const policy = validatePurpose(payload.purpose);
  const requestedKinds = validateRequestedKinds(payload.requestedKinds);
  const asOf = parseInstant(payload.asOf, 'asOf');
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const repo = new EnterpriseBusinessRepository();
    const project = await repo.getProjectById(trx, scope.projectId);
    const binding = await repo.getProjectSnapshotBinding(trx, scope.projectId, 'PROJECT_START');
    const bindingMatchesScope =
      binding?.enterprise_id === scope.enterpriseId && binding.project_id === scope.projectId;
    if (project?.enterprise_id !== scope.enterpriseId || !bindingMatchesScope) {
      queryError(PROJECT_QUERY_NOT_FOUND, 'Project or ProjectSnapshotBinding was not found');
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
  });
}

interface BoardCursor {
  readonly version: 1;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly filterHash: string;
  readonly projectionVersionId: string;
  readonly itemKey: string;
  readonly deliveryItemId: string;
  readonly expiresAt: number;
}

function cursorSignature(body: string, context: EnterpriseProjectTransactionContext): string {
  return createHmac('sha256', context.authorizationDecisionHash)
    .update(body, 'utf8')
    .digest('base64url');
}

function encodeCursor(
  cursor: Omit<BoardCursor, 'version' | 'expiresAt'>,
  context: EnterpriseProjectTransactionContext,
): string {
  const payload: BoardCursor = {
    ...cursor,
    version: 1,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${cursorSignature(body, context)}`;
}

function decodeCursor(value: string, context: EnterpriseProjectTransactionContext): BoardCursor {
  const [body, signature, extra] = value.split('.');
  if (extra !== undefined || body === undefined || signature === undefined) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor encoding is invalid');
  }
  const expected = cursorSignature(body, context);
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor signature is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor payload is invalid');
  }
  const cursor = record(parsed);
  if (
    cursor.version !== 1 ||
    typeof cursor.enterpriseId !== 'string' ||
    typeof cursor.projectId !== 'string' ||
    typeof cursor.filterHash !== 'string' ||
    typeof cursor.projectionVersionId !== 'string' ||
    typeof cursor.itemKey !== 'string' ||
    typeof cursor.deliveryItemId !== 'string' ||
    typeof cursor.expiresAt !== 'number' ||
    !Number.isSafeInteger(cursor.expiresAt) ||
    cursor.expiresAt <= Date.now()
  ) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor claims are invalid or expired');
  }
  return cursor as unknown as BoardCursor;
}

function filterHash(payload: BoardPayload): string {
  const statuses = [...payload.statuses].sort();
  const itemTypes = [...payload.itemTypes].sort();
  return digestCanonicalPayload({ statuses, itemTypes }).hash.toString('hex');
}

function boardItem(
  row: ProjectBoardTable,
  scope: { readonly enterpriseId: string; readonly projectId: string },
): EnterpriseProject.ProjectBoardSliceItem {
  const item = projectBoardItemFromRow(row, scope.enterpriseId, scope.projectId);
  return {
    deliveryItemId: item.deliveryItemId,
    itemKey: item.itemKey,
    title: item.title,
    commitmentStatus: item.commitmentStatus,
    executionStatus: item.executionStatus,
    ...(item.completionEvaluationRef === undefined
      ? {}
      : { completionEvaluationRef: item.completionEvaluationRef }),
    blockerRefs: item.blockerRefs,
  };
}

function projectionStatus(
  hasAlias: boolean,
  versionStatus: string | undefined,
  checkpointStatus: string | undefined,
  lag: number,
): 'READY' | 'STALE' | 'REBUILDING' | 'FAILED' {
  if (!hasAlias) return 'REBUILDING';
  if (versionStatus === 'FAILED') return 'FAILED';
  if (versionStatus === 'BUILDING') return 'REBUILDING';
  if (checkpointStatus === 'FAILED') return 'FAILED';
  if (checkpointStatus === 'REBUILDING') return 'REBUILDING';
  if (checkpointStatus === 'PAUSED' || lag > 0) return 'STALE';
  return 'READY';
}

export type GetProjectBoardSliceQueryPayload = BoardPayload;

export async function handleGetProjectBoardSlice(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: BoardPayload,
): Promise<EnterpriseProject.ProjectGetProjectBoardSliceResult> {
  validateContext(context);
  const scope = exactProjectRef(payload.projectRef, context);
  if (
    !Number.isSafeInteger(payload.page.pageSize) ||
    payload.page.pageSize < 1 ||
    payload.page.pageSize > 200
  ) {
    queryError(PROJECT_QUERY_REF_INVALID, 'page.pageSize must be between 1 and 200');
  }
  for (const status of payload.statuses) {
    if (!EXECUTION_STATUSES.has(status)) {
      queryError(PROJECT_QUERY_REF_INVALID, 'statuses contains an unsupported execution status');
    }
  }
  for (const itemType of payload.itemTypes) {
    if (typeof itemType !== 'string' || itemType.trim().length === 0) {
      queryError(PROJECT_QUERY_REF_INVALID, 'itemTypes must contain non-empty values');
    }
  }
  const hash = filterHash(payload);
  return withProjectionTransaction(db, context, async (trx) => {
    const state = await readProjectBoardProjection(trx, scope.enterpriseId, scope.projectId);
    const cursor =
      payload.page.cursor === undefined ? undefined : decodeCursor(payload.page.cursor, context);
    if (cursor !== undefined) {
      if (
        cursor.enterpriseId !== scope.enterpriseId ||
        cursor.projectId !== scope.projectId ||
        cursor.filterHash !== hash ||
        state.version?.projection_version_id !== cursor.projectionVersionId
      ) {
        queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor scope or projection version mismatches');
      }
    }
    const statusFilter = new Set(payload.statuses);
    const itemTypeFilter = new Set(payload.itemTypes);
    const orderedRows = [...state.rows].sort((left, right) =>
      compareProjectBoardPosition(
        left.item_key,
        left.delivery_item_id,
        right.item_key,
        right.delivery_item_id,
      ),
    );
    const filtered = orderedRows.filter((row) => {
      if (statusFilter.size > 0 && !statusFilter.has(row.execution_status as never)) return false;
      if (itemTypeFilter.size > 0 && !itemTypeFilter.has(row.item_type)) return false;
      if (
        cursor !== undefined &&
        compareProjectBoardPosition(
          row.item_key,
          row.delivery_item_id,
          cursor.itemKey,
          cursor.deliveryItemId,
        ) <= 0
      ) {
        return false;
      }
      return true;
    });
    const pageRows = filtered.slice(0, payload.page.pageSize + 1);
    const visibleRows = pageRows.slice(0, payload.page.pageSize);
    const nextRow = pageRows.length > payload.page.pageSize ? visibleRows.at(-1) : undefined;
    const targetSequence = Math.max(
      state.sourceState === undefined ? 0 : Number(state.sourceState.latest_sequence),
      state.checkpoint === undefined ? 0 : Number(state.checkpoint.target_sequence),
    );
    const lastSequence =
      state.checkpoint === undefined ? 0 : Number(state.checkpoint.last_sequence);
    const lag = Math.max(targetSequence - lastSequence, 0);
    const snapshotAt = state.version?.source_recorded_at ?? new Date();
    const sourceObservedAt = state.sourceState?.observed_at ?? snapshotAt;
    const projectionObservedAt = state.checkpoint?.updated_at ?? snapshotAt;
    const status = projectionStatus(
      state.alias !== undefined,
      state.version?.status,
      state.checkpoint?.status,
      lag,
    );
    return {
      items: visibleRows.map((row) => boardItem(row, scope)),
      ...(nextRow === undefined
        ? {}
        : {
            nextCursor: encodeCursor(
              {
                enterpriseId: scope.enterpriseId,
                projectId: scope.projectId,
                filterHash: hash,
                projectionVersionId: state.version?.projection_version_id ?? '',
                itemKey: nextRow.item_key,
                deliveryItemId: nextRow.delivery_item_id,
              },
              context,
            ),
          }),
      snapshotAt: snapshotAt.toISOString(),
      sourceWatermarks: [
        {
          sourceModule: 'enterprise_project',
          partition: scope.projectId,
          sequence: targetSequence,
          observedAt: new Date(sourceObservedAt).toISOString(),
        },
        {
          sourceModule: 'projection',
          partition: `${PROJECT_BOARD_PROJECTION_CONSUMER}:${scope.projectId}`,
          sequence: lastSequence,
          observedAt: new Date(projectionObservedAt).toISOString(),
        },
      ],
      consistency: 'PROJECTION',
      ...(state.version?.source_event_id === null || state.version?.source_event_id === undefined
        ? {}
        : { asOfEventId: state.version.source_event_id }),
      asOfRecordedAt: new Date(snapshotAt).toISOString(),
      projectionLag: lag,
      projectionStatus: status,
    };
  });
}

export function queryFilterDigest(payload: BoardPayload): string {
  return filterHash(payload);
}

export function queryPayloadDigest(value: CanonicalJsonObject): string {
  return digestCanonicalPayload(value).hash.toString('hex');
}
