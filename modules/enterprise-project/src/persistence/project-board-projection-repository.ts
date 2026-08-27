// IM-03 WI-11 (issue #67): rebuildable Project Board projection boundary.
// The writer accepts only normalized Snapshot Export/Event Delta values. It
// never opens a second connection to EnterpriseProject and never performs a
// cross-schema join.

import type { Kysely } from 'kysely';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import {
  digestCanonicalPayload,
  withProjectionTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
  type EnterpriseProjectTransactionContext,
} from './enterprise-db.js';
import type {
  ProjectBoardProjectionVersionTable,
  ProjectBoardReadAliasTable,
  ProjectBoardTable,
  ProjectionCheckpointTable,
  ProjectionSourceStateTable,
} from './projection-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
  PROJECT_PROJECTION_EVENT_INVALID,
  PROJECT_PROJECTION_REBUILD_INVALID,
} from '../business/enterprise-business-errors.js';
import { isUuidV7, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

export const PROJECT_BOARD_PROJECTION_CONSUMER = 'enterprise-project.board';
const PROJECT_BOARD_SOURCE_MODULE = 'enterprise_project';
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const COMMITMENT_STATUSES = new Set<EnterpriseProject.DeliveryCommitmentStatus>([
  'PROPOSED',
  'APPROVED',
  'CANCELLED',
  'REPLACED',
]);
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

export interface ProjectBoardProjectionItemInput {
  readonly deliveryItemId: string;
  readonly itemKey: string;
  readonly itemType: string;
  readonly title: string;
  readonly commitmentStatus: EnterpriseProject.DeliveryCommitmentStatus;
  readonly executionStatus: EnterpriseProject.DeliveryExecutionStatus;
  readonly completionEvaluationRef?: Common.ContentAddressedRef;
  readonly blockerRefs: readonly Common.TypedReference[];
}

export interface ProjectBoardSnapshotExport {
  readonly projectRef: Common.ObjectRef;
  readonly snapshotAt: string;
  readonly sourceWatermark: Common.SourceWatermark;
  readonly sourceEventId?: string;
  readonly sourceSnapshotHash: Common.ContentHash;
  readonly items: readonly ProjectBoardProjectionItemInput[];
}

export interface ProjectBoardEventDelta {
  readonly projectRef: Common.ObjectRef;
  readonly eventId: string;
  readonly eventType: string;
  readonly operation: 'UPSERT' | 'REMOVE';
  readonly sourceWatermark: Common.SourceWatermark;
  readonly itemId: string;
  readonly item?: ProjectBoardProjectionItemInput;
}

export interface ProjectBoardProjectionRebuildResult {
  readonly projectionVersionId: string;
  readonly rowCount: number;
  readonly domainChecksum: string;
  readonly checkpointSequence: number;
  readonly aliasSwitched: true;
}

export interface ProjectionSourceEventResult {
  readonly status: 'RECORDED' | 'DUPLICATE';
  readonly targetSequence: number;
}

export interface ProjectBoardProjectionFailureInput {
  readonly projectRef: Common.ObjectRef;
  readonly eventId?: string;
  readonly eventType: string;
  readonly failureCode: string;
  readonly safeSummary: string;
}

export interface ProjectBoardProjectionFailureResult {
  readonly failureId: string;
}

export interface ProjectionReadState {
  readonly alias: ProjectBoardReadAliasTable | undefined;
  readonly version: ProjectBoardProjectionVersionTable | undefined;
  readonly rows: readonly ProjectBoardTable[];
  readonly sourceState: ProjectionSourceStateTable | undefined;
  readonly checkpoint: ProjectionCheckpointTable | undefined;
}

interface NormalizedProjectRef {
  readonly enterpriseId: string;
  readonly projectId: string;
}

interface NormalizedItem {
  readonly deliveryItemId: string;
  readonly itemKey: string;
  readonly itemType: string;
  readonly title: string;
  readonly commitmentStatus: EnterpriseProject.DeliveryCommitmentStatus;
  readonly executionStatus: EnterpriseProject.DeliveryExecutionStatus;
  readonly completionEvaluationRef?: Common.ContentAddressedRef;
  readonly blockerRefs: readonly Common.TypedReference[];
}

interface NormalizedWatermark {
  readonly sourceModule: string;
  readonly partition: string;
  readonly sequence: number;
  readonly observedAt: Date;
}

interface NormalizedSnapshot {
  readonly scope: NormalizedProjectRef;
  readonly snapshotAt: Date;
  readonly sourceWatermark: NormalizedWatermark;
  readonly sourceEventId: string | null;
  readonly sourceSnapshotHash: Buffer;
  readonly items: readonly NormalizedItem[];
}

interface NormalizedDelta {
  readonly scope: NormalizedProjectRef;
  readonly eventId: string;
  readonly eventType: string;
  readonly operation: 'UPSERT' | 'REMOVE';
  readonly sourceWatermark: NormalizedWatermark;
  readonly itemId: string;
  readonly item?: NormalizedItem;
}

function projectionError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

function requireUuid(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    projectionError(code, `${label} must be an RFC 9562 UUIDv7`);
  }
  return value;
}

function requireNonEmpty(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    projectionError(code, `${label} must be non-empty`);
  }
  return value;
}

function jsonClone(value: unknown, code: string, label: string): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error('undefined JSON');
    return JSON.parse(serialized);
  } catch {
    projectionError(code, `${label} must be canonical JSON`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  code: string,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      projectionError(code, `${label} contains unsupported field ${key}`);
    }
  }
}

function normalizeInstant(value: unknown, code: string, label: string): Date {
  if (
    typeof value !== 'string' ||
    !UTC_INSTANT_PATTERN.test(value) ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    projectionError(code, `${label} must be a valid UTC instant`);
  }
  return new Date(value);
}

function normalizeScopeRef(value: unknown, code: string, label: string): Common.ScopeRef {
  const scope = asRecord(value);
  assertAllowedKeys(scope, ['enterpriseId', 'projectId'], code, label);
  const enterpriseId =
    scope.enterpriseId === undefined
      ? undefined
      : requireUuid(scope.enterpriseId, code, `${label}.enterpriseId`);
  const projectId =
    scope.projectId === undefined
      ? undefined
      : requireUuid(scope.projectId, code, `${label}.projectId`);
  if (projectId !== undefined) {
    if (enterpriseId === undefined) {
      projectionError(code, `${label}.projectId requires enterpriseId`);
    }
    return { enterpriseId, projectId };
  }
  return enterpriseId === undefined ? {} : { enterpriseId };
}

function normalizeContentHash(value: unknown, code: string, label: string): Common.ContentHash {
  const hash = asRecord(value);
  assertAllowedKeys(hash, ['algorithm', 'digest', 'canonicalizationVersion'], code, label);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash.digest)
  ) {
    projectionError(code, `${label} must be a lowercase SHA-256 content hash`);
  }
  return {
    algorithm: 'SHA-256',
    digest: hash.digest,
    canonicalizationVersion: '1',
  };
}

function normalizeObjectRef(value: unknown, code: string, label: string): Common.ObjectRef {
  const ref = asRecord(value);
  assertAllowedKeys(ref, ['kind', 'objectType', 'objectId', 'scope'], code, label);
  if (ref.kind !== 'OBJECT') {
    projectionError(code, `${label} must be an OBJECT reference`);
  }
  return {
    kind: 'OBJECT',
    objectType: requireNonEmpty(ref.objectType, code, `${label}.objectType`),
    objectId: requireUuid(ref.objectId, code, `${label}.objectId`),
    scope: normalizeScopeRef(ref.scope, code, `${label}.scope`),
  };
}

function normalizeVersionedRef(value: unknown, code: string, label: string): Common.VersionedRef {
  const ref = asRecord(value);
  assertAllowedKeys(ref, ['kind', 'objectType', 'objectId', 'versionId', 'scope'], code, label);
  if (ref.kind !== 'VERSIONED') {
    projectionError(code, `${label} must be a VERSIONED reference`);
  }
  return {
    kind: 'VERSIONED',
    objectType: requireNonEmpty(ref.objectType, code, `${label}.objectType`),
    objectId: requireUuid(ref.objectId, code, `${label}.objectId`),
    versionId: requireUuid(ref.versionId, code, `${label}.versionId`),
    scope: normalizeScopeRef(ref.scope, code, `${label}.scope`),
  };
}

function normalizeContentAddressedRef(
  value: unknown,
  code: string,
  label: string,
): Common.ContentAddressedRef {
  const ref = asRecord(value);
  assertAllowedKeys(
    ref,
    ['kind', 'objectType', 'objectId', 'immutableVersionId', 'scope', 'contentHash'],
    code,
    label,
  );
  if (ref.kind !== 'CONTENT_ADDRESSED') {
    projectionError(code, `${label} must be a CONTENT_ADDRESSED reference`);
  }
  const immutableVersionId =
    ref.immutableVersionId === undefined
      ? undefined
      : requireUuid(ref.immutableVersionId, code, `${label}.immutableVersionId`);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: requireNonEmpty(ref.objectType, code, `${label}.objectType`),
    objectId: requireUuid(ref.objectId, code, `${label}.objectId`),
    ...(immutableVersionId === undefined ? {} : { immutableVersionId }),
    scope: normalizeScopeRef(ref.scope, code, `${label}.scope`),
    contentHash: normalizeContentHash(ref.contentHash, code, `${label}.contentHash`),
  };
}

function normalizeSnapshotRef(value: unknown, code: string, label: string): Common.SnapshotRef {
  const ref = asRecord(value);
  assertAllowedKeys(
    ref,
    ['kind', 'objectType', 'objectId', 'snapshotId', 'scope', 'contentHash'],
    code,
    label,
  );
  if (ref.kind !== 'SNAPSHOT') {
    projectionError(code, `${label} must be a SNAPSHOT reference`);
  }
  return {
    kind: 'SNAPSHOT',
    objectType: requireNonEmpty(ref.objectType, code, `${label}.objectType`),
    objectId: requireUuid(ref.objectId, code, `${label}.objectId`),
    snapshotId: requireUuid(ref.snapshotId, code, `${label}.snapshotId`),
    scope: normalizeScopeRef(ref.scope, code, `${label}.scope`),
    contentHash: normalizeContentHash(ref.contentHash, code, `${label}.contentHash`),
  };
}

function normalizeExternalRef(value: unknown, code: string, label: string): Common.ExternalRef {
  const ref = asRecord(value);
  assertAllowedKeys(
    ref,
    [
      'system',
      'tenantOrAccountRef',
      'resourceType',
      'externalId',
      'observedAt',
      'payloadHash',
      'adapterVersion',
    ],
    code,
    label,
  );
  const tenantOrAccountRef =
    ref.tenantOrAccountRef === undefined
      ? undefined
      : normalizeObjectRef(ref.tenantOrAccountRef, code, `${label}.tenantOrAccountRef`);
  const payloadHash =
    ref.payloadHash === undefined
      ? undefined
      : normalizeContentHash(ref.payloadHash, code, `${label}.payloadHash`);
  const adapterVersion =
    ref.adapterVersion === undefined
      ? undefined
      : requireNonEmpty(ref.adapterVersion, code, `${label}.adapterVersion`);
  return {
    system: requireNonEmpty(ref.system, code, `${label}.system`),
    ...(tenantOrAccountRef === undefined ? {} : { tenantOrAccountRef }),
    resourceType: requireNonEmpty(ref.resourceType, code, `${label}.resourceType`),
    externalId: requireNonEmpty(ref.externalId, code, `${label}.externalId`),
    observedAt: normalizeInstant(ref.observedAt, code, `${label}.observedAt`).toISOString(),
    ...(payloadHash === undefined ? {} : { payloadHash }),
    ...(adapterVersion === undefined ? {} : { adapterVersion }),
  };
}

function normalizeTypedReference(
  value: unknown,
  code: string,
  label: string,
): Common.TypedReference {
  const ref = asRecord(value);
  if (ref.kind === 'OBJECT') return normalizeObjectRef(ref, code, label);
  if (ref.kind === 'VERSIONED') return normalizeVersionedRef(ref, code, label);
  if (ref.kind === 'CONTENT_ADDRESSED') return normalizeContentAddressedRef(ref, code, label);
  if (ref.kind === 'SNAPSHOT') return normalizeSnapshotRef(ref, code, label);
  return normalizeExternalRef(ref, code, label);
}

function exactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  code: string,
): NormalizedProjectRef {
  const ref = asRecord(value);
  const scope = asRecord(ref.scope);
  const enterpriseId = requireUuid(scope.enterpriseId, code, 'projectRef.scope.enterpriseId');
  const projectId = requireUuid(ref.objectId, code, 'projectRef.objectId');
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'Project' ||
    scope.projectId !== projectId ||
    enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    projectionError(code, 'projectRef must identify an allowed Project scope exactly');
  }
  return { enterpriseId, projectId };
}

function exactContentAddressedRef(
  value: unknown,
  scope: NormalizedProjectRef,
  code: string,
): Common.ContentAddressedRef {
  const ref = normalizeContentAddressedRef(value, code, 'completionEvaluationRef');
  if (ref.scope.enterpriseId !== scope.enterpriseId || ref.scope.projectId !== scope.projectId) {
    projectionError(code, 'completionEvaluationRef must be an exact scoped content reference');
  }
  return ref;
}

function normalizeItem(value: unknown, scope: NormalizedProjectRef, code: string): NormalizedItem {
  const item = asRecord(value);
  const deliveryItemId = requireUuid(item.deliveryItemId, code, 'item.deliveryItemId');
  const itemKey = requireNonEmpty(item.itemKey, code, 'item.itemKey');
  const itemType = requireNonEmpty(item.itemType, code, 'item.itemType');
  const title = requireNonEmpty(item.title, code, 'item.title');
  if (
    !COMMITMENT_STATUSES.has(item.commitmentStatus as EnterpriseProject.DeliveryCommitmentStatus)
  ) {
    projectionError(code, 'item.commitmentStatus is unsupported');
  }
  if (!EXECUTION_STATUSES.has(item.executionStatus as EnterpriseProject.DeliveryExecutionStatus)) {
    projectionError(code, 'item.executionStatus is unsupported');
  }
  if (!Array.isArray(item.blockerRefs)) {
    projectionError(code, 'item.blockerRefs must be an array');
  }
  const blockerRefs = item.blockerRefs.map((reference, index) =>
    normalizeTypedReference(reference, code, `item.blockerRefs[${index}]`),
  );
  const completionEvaluationRef =
    item.completionEvaluationRef === undefined
      ? undefined
      : exactContentAddressedRef(item.completionEvaluationRef, scope, code);
  return {
    deliveryItemId,
    itemKey,
    itemType,
    title,
    commitmentStatus: item.commitmentStatus as EnterpriseProject.DeliveryCommitmentStatus,
    executionStatus: item.executionStatus as EnterpriseProject.DeliveryExecutionStatus,
    ...(completionEvaluationRef === undefined ? {} : { completionEvaluationRef }),
    blockerRefs,
  };
}

function normalizeWatermark(
  value: unknown,
  scope: NormalizedProjectRef,
  code: string,
): NormalizedWatermark {
  const watermark = asRecord(value);
  const sourceModule = requireNonEmpty(
    watermark.sourceModule,
    code,
    'sourceWatermark.sourceModule',
  );
  if (sourceModule !== PROJECT_BOARD_SOURCE_MODULE) {
    projectionError(code, `sourceWatermark.sourceModule must be ${PROJECT_BOARD_SOURCE_MODULE}`);
  }
  const partition = requireNonEmpty(watermark.partition, code, 'sourceWatermark.partition');
  const sequence = watermark.sequence;
  const observedAt = watermark.observedAt;
  if (
    partition !== scope.projectId ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    typeof observedAt !== 'string' ||
    !UTC_INSTANT_PATTERN.test(observedAt) ||
    !Number.isFinite(new Date(observedAt).getTime())
  ) {
    projectionError(code, 'sourceWatermark must identify the exact Project and sequence');
  }
  return { sourceModule, partition, sequence, observedAt: new Date(observedAt) };
}

function hashInputSnapshot(input: ProjectBoardSnapshotExport): Buffer {
  const payload = {
    projectRef: jsonClone(input.projectRef, PROJECT_PROJECTION_REBUILD_INVALID, 'projectRef'),
    snapshotAt: input.snapshotAt,
    sourceWatermark: jsonClone(
      input.sourceWatermark,
      PROJECT_PROJECTION_REBUILD_INVALID,
      'sourceWatermark',
    ),
    items: input.items.map((item) => jsonClone(item, PROJECT_PROJECTION_REBUILD_INVALID, 'item')),
  } as unknown as CanonicalJsonObject;
  return digestCanonicalPayload(payload).hash;
}

export function calculateProjectBoardSnapshotHash(input: ProjectBoardSnapshotExport): string {
  return hashInputSnapshot(input).toString('hex');
}

function normalizeSnapshot(
  input: ProjectBoardSnapshotExport,
  context: EnterpriseProjectTransactionContext,
): NormalizedSnapshot {
  const scope = exactProjectRef(input.projectRef, context, PROJECT_PROJECTION_REBUILD_INVALID);
  const snapshotAt = normalizeInstant(
    input.snapshotAt,
    PROJECT_PROJECTION_REBUILD_INVALID,
    'snapshotAt',
  );
  const sourceWatermark = normalizeWatermark(
    input.sourceWatermark,
    scope,
    PROJECT_PROJECTION_REBUILD_INVALID,
  );
  const actualHash = hashInputSnapshot(input).toString('hex');
  const suppliedHash = asRecord(input.sourceSnapshotHash);
  if (
    suppliedHash.algorithm !== 'SHA-256' ||
    suppliedHash.canonicalizationVersion !== '1' ||
    suppliedHash.digest !== actualHash
  ) {
    projectionError(
      PROJECT_PROJECTION_REBUILD_INVALID,
      'sourceSnapshotHash does not match the canonical Snapshot Export',
    );
  }
  const sourceEventId =
    input.sourceEventId === undefined
      ? null
      : requireUuid(input.sourceEventId, PROJECT_PROJECTION_REBUILD_INVALID, 'sourceEventId');
  const items = input.items.map((item) =>
    normalizeItem(item, scope, PROJECT_PROJECTION_REBUILD_INVALID),
  );
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.deliveryItemId)) {
      projectionError(
        PROJECT_PROJECTION_REBUILD_INVALID,
        'Snapshot Export contains duplicate items',
      );
    }
    seen.add(item.deliveryItemId);
  }
  return {
    scope,
    snapshotAt,
    sourceWatermark,
    sourceEventId,
    sourceSnapshotHash: Buffer.from(actualHash, 'hex'),
    items,
  };
}

function normalizeDelta(
  input: ProjectBoardEventDelta,
  context: EnterpriseProjectTransactionContext,
): NormalizedDelta {
  const scope = exactProjectRef(input.projectRef, context, PROJECT_PROJECTION_EVENT_INVALID);
  const eventId = requireUuid(input.eventId, PROJECT_PROJECTION_EVENT_INVALID, 'eventId');
  const eventType = requireNonEmpty(input.eventType, PROJECT_PROJECTION_EVENT_INVALID, 'eventType');
  const itemId = requireUuid(input.itemId, PROJECT_PROJECTION_EVENT_INVALID, 'itemId');
  const operation: unknown = (input as { readonly operation?: unknown }).operation;
  if (operation !== 'UPSERT' && operation !== 'REMOVE') {
    projectionError(PROJECT_PROJECTION_EVENT_INVALID, 'operation must be UPSERT or REMOVE');
  }
  const sourceWatermark = normalizeWatermark(
    input.sourceWatermark,
    scope,
    PROJECT_PROJECTION_EVENT_INVALID,
  );
  if (sourceWatermark.sequence < 1) {
    projectionError(PROJECT_PROJECTION_EVENT_INVALID, 'Event Delta sequence must start at 1');
  }
  if (operation === 'UPSERT' && input.item === undefined) {
    projectionError(PROJECT_PROJECTION_EVENT_INVALID, 'UPSERT event must carry an item');
  }
  if (operation === 'REMOVE' && input.item !== undefined) {
    projectionError(PROJECT_PROJECTION_EVENT_INVALID, 'REMOVE event must not carry an item');
  }
  const item =
    input.item === undefined
      ? undefined
      : normalizeItem(input.item, scope, PROJECT_PROJECTION_EVENT_INVALID);
  if (item !== undefined && item.deliveryItemId !== itemId) {
    projectionError(PROJECT_PROJECTION_EVENT_INVALID, 'event item id does not match the delta key');
  }
  return {
    scope,
    eventId,
    eventType,
    operation,
    sourceWatermark,
    itemId,
    ...(item === undefined ? {} : { item }),
  };
}

function itemCanonical(item: NormalizedItem): CanonicalJsonObject {
  return {
    deliveryItemId: item.deliveryItemId,
    itemKey: item.itemKey,
    itemType: item.itemType,
    title: item.title,
    commitmentStatus: item.commitmentStatus,
    executionStatus: item.executionStatus,
    ...(item.completionEvaluationRef === undefined
      ? {}
      : {
          completionEvaluationRef: item.completionEvaluationRef as unknown as CanonicalJsonObject,
        }),
    blockerRefs: item.blockerRefs as unknown as readonly CanonicalJsonObject[],
  };
}

export function compareProjectBoardPosition(
  leftItemKey: string,
  leftDeliveryItemId: string,
  rightItemKey: string,
  rightDeliveryItemId: string,
): number {
  return (
    Buffer.compare(Buffer.from(leftItemKey, 'utf8'), Buffer.from(rightItemKey, 'utf8')) ||
    Buffer.compare(
      Buffer.from(leftDeliveryItemId, 'utf8'),
      Buffer.from(rightDeliveryItemId, 'utf8'),
    )
  );
}

function sortedItems(items: Iterable<NormalizedItem>): NormalizedItem[] {
  return [...items].sort((left, right) =>
    compareProjectBoardPosition(
      left.itemKey,
      left.deliveryItemId,
      right.itemKey,
      right.deliveryItemId,
    ),
  );
}

function domainChecksum(items: Iterable<NormalizedItem>): Buffer {
  return digestCanonicalPayload({ items: sortedItems(items).map(itemCanonical) }).hash;
}

function asAggregateNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    projectionError(
      PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
      `${label} is outside safe integer range`,
    );
  }
  return parsed;
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      projectionError(PROJECT_PROJECTION_CHECKPOINT_CONFLICT, `${label} is invalid JSON`);
    }
  }
  return value;
}

function rowToItem(row: ProjectBoardTable, scope: NormalizedProjectRef): NormalizedItem {
  const completion = parseJson(row.completion_evaluation_ref, 'completion_evaluation_ref');
  return normalizeItem(
    {
      deliveryItemId: row.delivery_item_id,
      itemKey: row.item_key,
      itemType: row.item_type,
      title: row.title,
      commitmentStatus: row.commitment_status as EnterpriseProject.DeliveryCommitmentStatus,
      executionStatus: row.execution_status as EnterpriseProject.DeliveryExecutionStatus,
      ...(completion === null || completion === undefined
        ? {}
        : { completionEvaluationRef: completion as Common.ContentAddressedRef }),
      blockerRefs: parseJson(row.blocker_refs, 'blocker_refs') as readonly Common.TypedReference[],
    },
    scope,
    PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
  );
}

export function projectBoardItemFromRow(
  row: ProjectBoardTable,
  enterpriseId: string,
  projectId: string,
): ProjectBoardProjectionItemInput {
  if (row.enterprise_id !== enterpriseId || row.project_id !== projectId) {
    projectionError(
      PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
      'projection row is outside the requested Project scope',
    );
  }
  return rowToItem(row, { enterpriseId, projectId });
}

async function readProjectionVersion(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
  versionId: string,
): Promise<ProjectBoardProjectionVersionTable | undefined> {
  return (await trx
    .selectFrom('projection.project_board_projection_version')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .where('projection_version_id', '=', versionId)
    .executeTakeFirst()) as unknown as ProjectBoardProjectionVersionTable | undefined;
}

async function readCheckpoint(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
  forUpdate = false,
): Promise<ProjectionCheckpointTable | undefined> {
  let query = trx
    .selectFrom('projection.projection_checkpoint')
    .selectAll()
    .where('consumer_name', '=', PROJECT_BOARD_PROJECTION_CONSUMER)
    .where('partition', '=', projectId)
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId);
  if (forUpdate) query = query.forUpdate();
  return (await query.executeTakeFirst()) as unknown as ProjectionCheckpointTable | undefined;
}

async function readSourceState(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<ProjectionSourceStateTable | undefined> {
  return (await trx
    .selectFrom('projection.projection_source_state')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .executeTakeFirst()) as unknown as ProjectionSourceStateTable | undefined;
}

export async function readProjectBoardProjection(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<ProjectionReadState> {
  const alias = (await trx
    .selectFrom('projection.project_board_read_alias')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .executeTakeFirst()) as unknown as ProjectBoardReadAliasTable | undefined;
  const version = alias
    ? await readProjectionVersion(trx, enterpriseId, projectId, alias.projection_version_id)
    : undefined;
  const queriedRows = version
    ? ((await trx
        .selectFrom('projection.project_board')
        .selectAll()
        .where('enterprise_id', '=', enterpriseId)
        .where('project_id', '=', projectId)
        .where('projection_version_id', '=', version.projection_version_id)
        .execute()) as unknown as ProjectBoardTable[])
    : [];
  const rows = queriedRows.sort((left, right) =>
    compareProjectBoardPosition(
      left.item_key,
      left.delivery_item_id,
      right.item_key,
      right.delivery_item_id,
    ),
  );
  return {
    alias,
    version,
    rows,
    sourceState: await readSourceState(trx, enterpriseId, projectId),
    checkpoint: await readCheckpoint(trx, enterpriseId, projectId),
  };
}

interface ProjectionVersionInsertInput {
  readonly scope: NormalizedProjectRef;
  readonly sourceSnapshotHash: Buffer;
  readonly sourceEventId: string | null;
  readonly sourceSequence: number;
  readonly sourceRecordedAt: Date;
  readonly items: readonly NormalizedItem[];
  readonly checkpointMode: 'REBUILD' | 'CONSUME';
}

async function persistProjectionVersion(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  input: ProjectionVersionInsertInput,
): Promise<ProjectBoardProjectionRebuildResult> {
  const projectionVersionId = newUuidV7();
  const checksum = domainChecksum(input.items);
  const existingSource = await readSourceState(
    trx,
    input.scope.enterpriseId,
    input.scope.projectId,
  );
  const existingCheckpoint = await readCheckpoint(
    trx,
    input.scope.enterpriseId,
    input.scope.projectId,
    true,
  );
  const existingSourceSequence =
    existingSource === undefined
      ? -1
      : asAggregateNumber(existingSource.latest_sequence, 'latest source sequence');
  if (
    existingSource !== undefined &&
    existingSourceSequence === input.sourceSequence &&
    existingSource.latest_event_id !== input.sourceEventId
  ) {
    projectionError(
      PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
      'source sequence is already bound to a different event',
    );
  }
  if (
    input.checkpointMode === 'REBUILD' &&
    existingCheckpoint !== undefined &&
    asAggregateNumber(existingCheckpoint.target_sequence, 'checkpoint target sequence') >
      input.sourceSequence
  ) {
    projectionError(
      PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
      'rebuild target watermark would move backwards',
    );
  }
  if (input.checkpointMode === 'CONSUME' && existingCheckpoint === undefined) {
    projectionError(
      PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
      'projection checkpoint does not exist for event consumption',
    );
  }
  const sourceEventId =
    existingSourceSequence > input.sourceSequence
      ? (existingSource?.latest_event_id ?? null)
      : input.sourceEventId;
  const sourceSequence = Math.max(existingSourceSequence, input.sourceSequence);
  const sourceRecordedAt =
    existingSourceSequence > input.sourceSequence
      ? (existingSource?.observed_at ?? input.sourceRecordedAt)
      : input.sourceRecordedAt;
  const checkpointTargetSequence =
    input.checkpointMode === 'CONSUME' && existingCheckpoint !== undefined
      ? Math.max(
          asAggregateNumber(existingCheckpoint.target_sequence, 'checkpoint target sequence'),
          input.sourceSequence,
        )
      : input.sourceSequence;
  const checkpointTargetEventId =
    checkpointTargetSequence === input.sourceSequence
      ? input.sourceEventId
      : (existingCheckpoint?.target_event_id ?? null);
  const checkpointLastSequence = input.sourceSequence;
  const checkpointLastEventId = input.sourceEventId;
  await trx
    .insertInto('projection.project_board_projection_version')
    .values({
      projection_version_id: projectionVersionId,
      enterprise_id: input.scope.enterpriseId,
      project_id: input.scope.projectId,
      status: 'BUILDING',
      source_snapshot_hash: input.sourceSnapshotHash,
      source_event_id: input.sourceEventId,
      source_sequence: input.sourceSequence,
      source_recorded_at: input.sourceRecordedAt,
      row_count: input.items.length,
      domain_checksum: checksum,
      created_by_principal_id: context.principalId,
      created_at: new Date(),
      ready_at: null,
      failure_code: null,
    })
    .execute();

  const rows = sortedItems(input.items).map((item) => ({
    projection_version_id: projectionVersionId,
    enterprise_id: input.scope.enterpriseId,
    project_id: input.scope.projectId,
    delivery_item_id: item.deliveryItemId,
    item_key: item.itemKey,
    item_type: item.itemType,
    title: item.title,
    commitment_status: item.commitmentStatus,
    execution_status: item.executionStatus,
    completion_evaluation_ref:
      item.completionEvaluationRef === undefined
        ? null
        : JSON.stringify(item.completionEvaluationRef),
    blocker_refs: JSON.stringify(item.blockerRefs),
    source_event_id: input.sourceEventId,
    source_sequence: input.sourceSequence,
    source_recorded_at: input.sourceRecordedAt,
  }));
  if (rows.length > 0) {
    await trx.insertInto('projection.project_board').values(rows).execute();
  }

  const readyAt = new Date();
  await trx
    .updateTable('projection.project_board_projection_version')
    .set({ status: 'READY', ready_at: readyAt })
    .where('projection_version_id', '=', projectionVersionId)
    .execute();

  await trx
    .insertInto('projection.projection_source_state')
    .values({
      enterprise_id: input.scope.enterpriseId,
      project_id: input.scope.projectId,
      latest_event_id: sourceEventId,
      latest_sequence: sourceSequence,
      observed_at: sourceRecordedAt,
      updated_by_principal_id: context.principalId,
      updated_at: readyAt,
    })
    .onConflict((oc) =>
      oc.columns(['enterprise_id', 'project_id']).doUpdateSet({
        latest_event_id: sourceEventId,
        latest_sequence: sourceSequence,
        observed_at: sourceRecordedAt,
        updated_by_principal_id: context.principalId,
        updated_at: readyAt,
      }),
    )
    .execute();

  await trx
    .insertInto('projection.projection_checkpoint')
    .values({
      consumer_name: PROJECT_BOARD_PROJECTION_CONSUMER,
      partition: input.scope.projectId,
      enterprise_id: input.scope.enterpriseId,
      project_id: input.scope.projectId,
      last_event_id: checkpointLastEventId,
      last_sequence: checkpointLastSequence,
      target_event_id: checkpointTargetEventId,
      target_sequence: checkpointTargetSequence,
      status: 'ACTIVE',
      updated_by_principal_id: context.principalId,
      updated_at: readyAt,
    })
    .onConflict((oc) =>
      oc.columns(['consumer_name', 'partition', 'enterprise_id', 'project_id']).doUpdateSet({
        last_event_id: checkpointLastEventId,
        last_sequence: checkpointLastSequence,
        target_event_id: checkpointTargetEventId,
        target_sequence: checkpointTargetSequence,
        status: 'ACTIVE',
        updated_by_principal_id: context.principalId,
        updated_at: readyAt,
      }),
    )
    .execute();

  await trx
    .insertInto('projection.project_board_read_alias')
    .values({
      enterprise_id: input.scope.enterpriseId,
      project_id: input.scope.projectId,
      projection_version_id: projectionVersionId,
      switched_at: readyAt,
      switched_by_principal_id: context.principalId,
    })
    .onConflict((oc) =>
      oc.columns(['enterprise_id', 'project_id']).doUpdateSet({
        projection_version_id: projectionVersionId,
        switched_at: readyAt,
        switched_by_principal_id: context.principalId,
      }),
    )
    .execute();

  return {
    projectionVersionId,
    rowCount: input.items.length,
    domainChecksum: checksum.toString('hex'),
    checkpointSequence: checkpointLastSequence,
    aliasSwitched: true,
  };
}

export async function rebuildProjectBoardProjection(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  snapshot: ProjectBoardSnapshotExport,
  deltas: readonly ProjectBoardEventDelta[] = [],
): Promise<ProjectBoardProjectionRebuildResult> {
  const normalizedSnapshot = normalizeSnapshot(snapshot, context);
  const normalizedDeltas = deltas.map((delta) => normalizeDelta(delta, context));
  let previousSequence = normalizedSnapshot.sourceWatermark.sequence;
  const items = new Map(normalizedSnapshot.items.map((item) => [item.deliveryItemId, item]));
  let sourceEventId = normalizedSnapshot.sourceEventId;
  let sourceRecordedAt = normalizedSnapshot.sourceWatermark.observedAt;
  let sourceSequence = previousSequence;
  for (const delta of normalizedDeltas) {
    if (
      delta.scope.enterpriseId !== normalizedSnapshot.scope.enterpriseId ||
      delta.scope.projectId !== normalizedSnapshot.scope.projectId ||
      delta.sourceWatermark.sequence <= previousSequence
    ) {
      projectionError(
        PROJECT_PROJECTION_EVENT_INVALID,
        'Event Delta scope or sequence is not strictly after the Snapshot Export',
      );
    }
    previousSequence = delta.sourceWatermark.sequence;
    sourceSequence = delta.sourceWatermark.sequence;
    sourceEventId = delta.eventId;
    sourceRecordedAt = delta.sourceWatermark.observedAt;
    if (delta.operation === 'REMOVE') items.delete(delta.itemId);
    else if (delta.item !== undefined) items.set(delta.itemId, delta.item);
  }
  const finalItems = sortedItems(items.values());
  return withProjectionTransaction(db, context, async (trx) => {
    const existingSource = await readSourceState(
      trx,
      normalizedSnapshot.scope.enterpriseId,
      normalizedSnapshot.scope.projectId,
    );
    if (
      existingSource !== undefined &&
      asAggregateNumber(existingSource.latest_sequence, 'latest source sequence') > sourceSequence
    ) {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'rebuild source watermark would move backwards',
      );
    }
    return persistProjectionVersion(trx, context, {
      scope: normalizedSnapshot.scope,
      sourceSnapshotHash: normalizedSnapshot.sourceSnapshotHash,
      sourceEventId,
      sourceSequence,
      sourceRecordedAt,
      items: finalItems,
      checkpointMode: 'REBUILD',
    });
  });
}

export async function recordProjectBoardSourceEvent(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  event: ProjectBoardEventDelta,
): Promise<ProjectionSourceEventResult> {
  const normalized = normalizeDelta(event, context);
  return withProjectionTransaction(db, context, async (trx) => {
    const current = await readSourceState(
      trx,
      normalized.scope.enterpriseId,
      normalized.scope.projectId,
    );
    const currentSequence = current
      ? asAggregateNumber(current.latest_sequence, 'latest source sequence')
      : -1;
    if (normalized.sourceWatermark.sequence < currentSequence) {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'source event sequence is older than the source watermark',
      );
    }
    if (normalized.sourceWatermark.sequence === currentSequence) {
      if (current?.latest_event_id === normalized.eventId) {
        return { status: 'DUPLICATE', targetSequence: currentSequence };
      }
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'source sequence is already bound to a different event',
      );
    }
    const now = new Date();
    await trx
      .insertInto('projection.projection_source_state')
      .values({
        enterprise_id: normalized.scope.enterpriseId,
        project_id: normalized.scope.projectId,
        latest_event_id: normalized.eventId,
        latest_sequence: normalized.sourceWatermark.sequence,
        observed_at: normalized.sourceWatermark.observedAt,
        updated_by_principal_id: context.principalId,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['enterprise_id', 'project_id']).doUpdateSet({
          latest_event_id: normalized.eventId,
          latest_sequence: normalized.sourceWatermark.sequence,
          observed_at: normalized.sourceWatermark.observedAt,
          updated_by_principal_id: context.principalId,
          updated_at: now,
        }),
      )
      .execute();
    const checkpoint = await readCheckpoint(
      trx,
      normalized.scope.enterpriseId,
      normalized.scope.projectId,
      true,
    );
    if (checkpoint === undefined) {
      await trx
        .insertInto('projection.projection_checkpoint')
        .values({
          consumer_name: PROJECT_BOARD_PROJECTION_CONSUMER,
          partition: normalized.scope.projectId,
          enterprise_id: normalized.scope.enterpriseId,
          project_id: normalized.scope.projectId,
          last_event_id: null,
          last_sequence: 0,
          target_event_id: normalized.eventId,
          target_sequence: normalized.sourceWatermark.sequence,
          status: 'ACTIVE',
          updated_by_principal_id: context.principalId,
          updated_at: now,
        })
        .execute();
    } else if (
      normalized.sourceWatermark.sequence >
      asAggregateNumber(checkpoint.target_sequence, 'checkpoint target sequence')
    ) {
      await trx
        .updateTable('projection.projection_checkpoint')
        .set({
          target_event_id: normalized.eventId,
          target_sequence: normalized.sourceWatermark.sequence,
          updated_by_principal_id: context.principalId,
          updated_at: now,
        })
        .where('consumer_name', '=', PROJECT_BOARD_PROJECTION_CONSUMER)
        .where('partition', '=', normalized.scope.projectId)
        .where('enterprise_id', '=', normalized.scope.enterpriseId)
        .where('project_id', '=', normalized.scope.projectId)
        .execute();
    }
    return { status: 'RECORDED', targetSequence: normalized.sourceWatermark.sequence };
  });
}

export async function pauseProjectBoardProjection(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  projectRef: Common.ObjectRef,
): Promise<{ status: 'PAUSED'; targetSequence: number }> {
  const scope = exactProjectRef(projectRef, context, PROJECT_PROJECTION_CHECKPOINT_CONFLICT);
  return withProjectionTransaction(db, context, async (trx) => {
    const now = new Date();
    const checkpoint = await readCheckpoint(trx, scope.enterpriseId, scope.projectId, true);
    const source = await readSourceState(trx, scope.enterpriseId, scope.projectId);
    const sourceSequence = source
      ? asAggregateNumber(source.latest_sequence, 'latest source sequence')
      : -1;
    const checkpointTargetSequence = checkpoint
      ? asAggregateNumber(checkpoint.target_sequence, 'checkpoint target sequence')
      : 0;
    const effectiveTargetSequence = Math.max(sourceSequence, checkpointTargetSequence);
    const targetEventId =
      source !== undefined && sourceSequence > checkpointTargetSequence
        ? source.latest_event_id
        : (checkpoint?.target_event_id ?? null);
    if (checkpoint === undefined) {
      await trx
        .insertInto('projection.projection_checkpoint')
        .values({
          consumer_name: PROJECT_BOARD_PROJECTION_CONSUMER,
          partition: scope.projectId,
          enterprise_id: scope.enterpriseId,
          project_id: scope.projectId,
          last_event_id: null,
          last_sequence: 0,
          target_event_id: targetEventId,
          target_sequence: effectiveTargetSequence,
          status: 'PAUSED',
          updated_by_principal_id: context.principalId,
          updated_at: now,
        })
        .execute();
    } else {
      await trx
        .updateTable('projection.projection_checkpoint')
        .set({
          status: 'PAUSED',
          target_event_id: targetEventId,
          target_sequence: effectiveTargetSequence,
          updated_by_principal_id: context.principalId,
          updated_at: now,
        })
        .where('consumer_name', '=', PROJECT_BOARD_PROJECTION_CONSUMER)
        .where('partition', '=', scope.projectId)
        .where('enterprise_id', '=', scope.enterpriseId)
        .where('project_id', '=', scope.projectId)
        .execute();
    }
    return { status: 'PAUSED', targetSequence: effectiveTargetSequence };
  });
}

export async function recordProjectBoardProjectionFailure(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  input: ProjectBoardProjectionFailureInput,
): Promise<ProjectBoardProjectionFailureResult> {
  const scope = exactProjectRef(input.projectRef, context, PROJECT_PROJECTION_EVENT_INVALID);
  const eventId =
    input.eventId === undefined
      ? null
      : requireUuid(input.eventId, PROJECT_PROJECTION_EVENT_INVALID, 'eventId');
  const eventType = requireNonEmpty(input.eventType, PROJECT_PROJECTION_EVENT_INVALID, 'eventType');
  const failureCode = requireNonEmpty(
    input.failureCode,
    PROJECT_PROJECTION_EVENT_INVALID,
    'failureCode',
  );
  const safeSummary = requireNonEmpty(
    input.safeSummary,
    PROJECT_PROJECTION_EVENT_INVALID,
    'safeSummary',
  );
  const failureId = newUuidV7();
  await withProjectionTransaction(db, context, async (trx) => {
    await trx
      .insertInto('projection.projection_failure')
      .values({
        failure_id: failureId,
        consumer_name: PROJECT_BOARD_PROJECTION_CONSUMER,
        partition: scope.projectId,
        enterprise_id: scope.enterpriseId,
        project_id: scope.projectId,
        event_id: eventId,
        event_type: eventType,
        failure_code: failureCode,
        safe_summary: safeSummary,
        recorded_at: new Date(),
        recorded_by_principal_id: context.principalId,
      })
      .execute();
  });
  return { failureId };
}

export async function consumeProjectBoardEvent(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  event: ProjectBoardEventDelta,
): Promise<ProjectBoardProjectionRebuildResult> {
  const normalized = normalizeDelta(event, context);
  return withProjectionTransaction(db, context, async (trx) => {
    const checkpoint = await readCheckpoint(
      trx,
      normalized.scope.enterpriseId,
      normalized.scope.projectId,
      true,
    );
    if (checkpoint === undefined) {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'projection checkpoint does not exist for event consumption',
      );
    }
    if (checkpoint.status !== 'ACTIVE') {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'projection checkpoint is not active',
      );
    }
    const lastSequence = asAggregateNumber(checkpoint.last_sequence, 'checkpoint last sequence');
    if (normalized.sourceWatermark.sequence !== lastSequence + 1) {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'event sequence is not the next checkpoint sequence',
      );
    }
    const alias = (await trx
      .selectFrom('projection.project_board_read_alias')
      .selectAll()
      .where('enterprise_id', '=', normalized.scope.enterpriseId)
      .where('project_id', '=', normalized.scope.projectId)
      .executeTakeFirst()) as unknown as ProjectBoardReadAliasTable | undefined;
    if (alias === undefined) {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'projection alias does not exist for event consumption',
      );
    }
    const version = await readProjectionVersion(
      trx,
      normalized.scope.enterpriseId,
      normalized.scope.projectId,
      alias.projection_version_id,
    );
    if (version?.status !== 'READY') {
      projectionError(
        PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
        'projection alias does not identify a ready version',
      );
    }
    const rows = (await trx
      .selectFrom('projection.project_board')
      .selectAll()
      .where('enterprise_id', '=', normalized.scope.enterpriseId)
      .where('project_id', '=', normalized.scope.projectId)
      .where('projection_version_id', '=', alias.projection_version_id)
      .execute()) as unknown as ProjectBoardTable[];
    const items = new Map(
      rows.map((row) => [row.delivery_item_id, rowToItem(row, normalized.scope)]),
    );
    if (normalized.operation === 'REMOVE') items.delete(normalized.itemId);
    else if (normalized.item !== undefined) items.set(normalized.itemId, normalized.item);
    return persistProjectionVersion(trx, context, {
      scope: normalized.scope,
      sourceSnapshotHash: version.source_snapshot_hash,
      sourceEventId: normalized.eventId,
      sourceSequence: normalized.sourceWatermark.sequence,
      sourceRecordedAt: normalized.sourceWatermark.observedAt,
      items: sortedItems(items.values()),
      checkpointMode: 'CONSUME',
    });
  });
}
