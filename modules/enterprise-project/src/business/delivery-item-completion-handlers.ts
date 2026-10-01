// IM-03 WI-12 (issue #68): controlled formal-fact consumption and the
// DeliveryItem Completion Evaluator. Completion is derived only from frozen
// criteria and exact persisted facts; callers cannot submit a completion flag.

import { sql, type Kysely } from 'kysely';
import { exactCompletionCriteria, DELIVERY_COMPLETION_EVALUATOR } from '@zhiju/contracts';
import { getContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  CommandExecutionError,
  CONCURRENCY_CONFLICT,
  executeEnterpriseProjectCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  DeliveryItemCompletionRepository,
  type DeliveryItemCompletionCasResult,
} from '../persistence/delivery-item-completion-repository.js';
import type {
  DeliveryItemCompletionEvaluationTable,
  DeliveryItemCompletionFactTable,
} from '../persistence/enterprise-business-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_COMPLETION_IS_DERIVED,
  PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
  PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
  PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT,
  PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
  PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID,
  PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
  PROJECT_DELIVERY_ITEM_INVALID,
  PROJECT_DELIVERY_REFERENCE_INVALID,
  PROJECT_DELIVERY_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

const COMPLETION_CONSUMER = 'enterprise-project.delivery-item-completion';
const COMPLETION_PROCESS_VERSION = '1.0';
const CONTRACT_REGISTRY = getContractRegistry();
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const EVENT_RULES = {
  'execution.TaskCompleted': {
    producerModule: 'task-execution',
    sourceModule: 'task_execution',
    lifecycle: 'ACTIVE',
  },
  'release.ReleaseCompleted': {
    producerModule: 'release-publication',
    sourceModule: 'release_publication',
    lifecycle: 'ACTIVE',
  },
  'quality.RevisionFullyApproved': {
    producerModule: 'quality-governance',
    sourceModule: 'quality_governance',
    lifecycle: 'ACTIVE',
  },
  'quality.RevisionApprovalLost': {
    producerModule: 'quality-governance',
    sourceModule: 'quality_governance',
    lifecycle: 'REVOKED',
  },
  'release.ReleaseRecalled': {
    producerModule: 'release-publication',
    sourceModule: 'release_publication',
    lifecycle: 'REVOKED',
  },
} as const;

type SupportedEventType = keyof typeof EVENT_RULES;
type EventRule = (typeof EVENT_RULES)[SupportedEventType];

export interface DeliveryCompletionEventEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly producerModule: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | string;
  readonly scopeRef: Common.ScopeRef;
  readonly correlationId: string;
  readonly causationId: string;
  readonly commandId: string;
  readonly actorRef: unknown;
  readonly occurredAt: string;
  readonly dataClassification: string;
  readonly payload: CanonicalJsonObject;
  readonly integrity: {
    readonly canonicalizationVersion: string;
    readonly payloadHash: Common.ContentHash;
  };
}

export interface DeliveryCompletionEventInput {
  readonly event: DeliveryCompletionEventEnvelope;
  readonly sourceWatermark: EnterpriseProject.SourceWatermark;
}

export type DeliveryCompletionEventResult =
  | {
      readonly status: 'PROCESSED';
      readonly factRef: Common.ContentAddressedRef;
      readonly processId: string;
    }
  | {
      readonly status: 'DUPLICATE';
      readonly factRef: Common.ContentAddressedRef;
    }
  | {
      readonly status: 'QUARANTINED';
      readonly failureCode: typeof PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT;
    };

interface NormalizedWatermark {
  readonly sourceModule: string;
  readonly partition: string;
  readonly sequence: number;
  readonly observedAt: string;
}

interface NormalizedEvent {
  readonly event: DeliveryCompletionEventEnvelope;
  readonly rule: EventRule;
  readonly eventId: string;
  readonly eventType: SupportedEventType;
  readonly eventVersion: '1.0';
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly payload: CanonicalJsonObject;
  readonly payloadHash: Buffer;
  readonly sourceWatermark: NormalizedWatermark;
  readonly sourceWatermarkHash: Buffer;
  readonly factRefs: readonly CanonicalJsonObject[];
  readonly subjectRefs: readonly CanonicalJsonObject[];
}

interface NormalizedEvaluationInput {
  readonly deliveryPlanRef: CanonicalJsonObject;
  readonly deliveryPlanId: string;
  readonly versionId: string;
  readonly deliveryItemId: string;
  readonly projectId: string;
  readonly criteriaHash: Buffer;
  readonly factRefs: readonly CanonicalJsonObject[];
  readonly sourceWatermarks: readonly NormalizedWatermark[];
  readonly evaluatorRef: CanonicalJsonObject;
  readonly evaluatorId: string;
  readonly evaluatorVersionId: string;
  readonly evaluatedAt: string;
}

interface CompletionCriterion {
  readonly eventType: SupportedEventType;
  readonly factRef?: CanonicalJsonObject;
}

interface EvaluationOutcome {
  readonly outcome: 'SATISFIED' | 'UNSATISFIED';
  readonly selectedFacts: readonly DeliveryItemCompletionFactTable[];
  readonly satisfiedFactRefs: readonly CanonicalJsonObject[];
}

const repo = new DeliveryItemCompletionRepository();

function completionError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asCanonicalJson(value: unknown, code: string, label: string): CanonicalJsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error('undefined JSON');
    return JSON.parse(serialized) as CanonicalJsonValue;
  } catch {
    completionError(code, `${label} must be canonical JSON`);
  }
}

function canonicalObject(value: unknown, code: string, label: string): CanonicalJsonObject {
  const candidate = asCanonicalJson(value, code, label);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    completionError(code, `${label} must be an object`);
  }
  return candidate as CanonicalJsonObject;
}

function nonEmpty(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    completionError(code, `${label} must be non-empty`);
  }
  return value;
}

function uuid(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    completionError(code, `${label} must be an RFC 9562 UUIDv7`);
  }
  return value;
}

function positiveInteger(value: unknown, code: string, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    completionError(code, `${label} must be a positive integer`);
  }
  return parsed;
}

function positiveBigint(value: unknown, code: string, label: string): string {
  if (!(
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) ||
    (typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) >= 1n)
  )) {
    completionError(code, `${label} must be a positive bigint`);
  }
  return String(value);
}

function aggregateVersionToString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error('completion aggregate version must be a scalar');
}

function instant(value: unknown, code: string, label: string): string {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    completionError(code, `${label} must be a UTC instant`);
  }
  return new Date(value).toISOString();
}

function contentHashBytes(value: unknown, code: string, label: string): Buffer {
  const hash = asRecord(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-fA-F]{64}$/.test(hash.digest)
  ) {
    completionError(code, `${label} must be a SHA-256 canonical hash`);
  }
  return Buffer.from(hash.digest, 'hex');
}

function hashValue(hash: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function canonicalKey(value: unknown): string {
  return digestCanonicalPayload(
    canonicalObject(value, PROJECT_DELIVERY_REFERENCE_INVALID, 'reference'),
  ).canonicalJson;
}

function uniqueReferences(values: readonly unknown[]): CanonicalJsonObject[] {
  const result: CanonicalJsonObject[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const reference = canonicalObject(
      value,
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event reference',
    );
    const key = canonicalKey(reference);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(reference);
    }
  }
  return result;
}

function validateTypedReference(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
  code = PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
): CanonicalJsonObject {
  const reference = canonicalObject(value, code, label);
  const kind = reference.kind;
  if (
    typeof kind !== 'string' ||
    !['OBJECT', 'VERSIONED', 'CONTENT_ADDRESSED', 'SNAPSHOT'].includes(kind)
  ) {
    completionError(code, `${label} must be a project-bound typed reference`);
  }
  const objectType = nonEmpty(reference.objectType, code, `${label}.objectType`);
  uuid(reference.objectId, code, `${label}.objectId`);
  const scope = canonicalObject(reference.scope, code, `${label}.scope`);
  if (
    scope.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId ||
    typeof scope.enterpriseId !== 'string' ||
    typeof scope.projectId !== 'string'
  ) {
    completionError(code, `${label} must identify the trusted Project scope`);
  }
  if (kind === 'VERSIONED') {
    uuid(reference.versionId, code, `${label}.versionId`);
  }
  if (kind === 'CONTENT_ADDRESSED') {
    if (reference.immutableVersionId !== undefined) {
      uuid(reference.immutableVersionId, code, `${label}.immutableVersionId`);
    }
    contentHashBytes(reference.contentHash, code, `${label}.contentHash`);
  }
  if (kind === 'SNAPSHOT') {
    uuid(reference.snapshotId, code, `${label}.snapshotId`);
    contentHashBytes(reference.contentHash, code, `${label}.contentHash`);
  }
  if (objectType === 'latest' || objectType === 'current') {
    completionError(code, `${label} cannot use a latest/current object type`);
  }
  return reference;
}

function collectTypedReferences(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
  output: CanonicalJsonObject[] = [],
): CanonicalJsonObject[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectTypedReferences(item, enterpriseId, projectId, `${label}[${index}]`, output),
    );
    return output;
  }
  if (value === null || typeof value !== 'object') return output;
  const record = value as Record<string, unknown>;
  if (typeof record.kind === 'string') {
    output.push(validateTypedReference(record, enterpriseId, projectId, label));
    return output;
  }
  for (const [key, child] of Object.entries(record)) {
    collectTypedReferences(child, enterpriseId, projectId, `${label}.${key}`, output);
  }
  return output;
}

function normalizeWatermark(
  value: unknown,
  rule: EventRule | undefined,
  projectId: string,
  code = PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
): NormalizedWatermark {
  const watermark = asRecord(value);
  const sourceModule = nonEmpty(watermark.sourceModule, code, 'sourceWatermark.sourceModule');
  if (rule !== undefined && sourceModule !== rule.sourceModule) {
    completionError(code, 'sourceWatermark.sourceModule does not match the event producer');
  }
  const partition = nonEmpty(watermark.partition, code, 'sourceWatermark.partition');
  if (partition !== projectId) {
    completionError(code, 'sourceWatermark.partition does not identify the Project');
  }
  const sequence = positiveInteger(watermark.sequence, code, 'sourceWatermark.sequence');
  return {
    sourceModule,
    partition,
    sequence,
    observedAt: instant(watermark.observedAt, code, 'sourceWatermark.observedAt'),
  };
}

function referenceArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      `${label} must be a non-empty array`,
    );
  }
  return value;
}

function eventSubjectReferences(
  eventType: SupportedEventType,
  payload: CanonicalJsonObject,
): readonly unknown[] {
  const value = asRecord(payload);
  switch (eventType) {
    case 'execution.TaskCompleted':
      return [value.taskRef, ...referenceArray(value.satisfiedFactRefs, 'satisfiedFactRefs')];
    case 'release.ReleaseCompleted':
      return [
        value.releaseRef,
        asRecord(value.packageRef).packageSnapshotRef,
        value.revisionRef,
        ...referenceArray(value.receiptRefs, 'receiptRefs'),
      ];
    case 'quality.RevisionFullyApproved':
      return [
        value.artifactRef,
        value.revisionRef,
        value.approvalBundleSnapshotRef,
        ...referenceArray(value.approvalRefs, 'approvalRefs'),
      ];
    case 'quality.RevisionApprovalLost':
      return [
        value.artifactRef,
        value.revisionRef,
        value.priorApprovalBundleSnapshotRef,
        value.triggeringRef,
      ];
    case 'release.ReleaseRecalled':
      return [
        value.releaseRef,
        asRecord(value.packageRef).releaseRef,
        asRecord(value.packageRef).packageSnapshotRef,
        value.recallRef,
      ];
  }
}

function normalizeEvent(
  context: EnterpriseProjectTransactionContext,
  input: DeliveryCompletionEventInput,
): NormalizedEvent {
  if (context.kind !== 'EVENT_CONSUMER' || context.principalKind !== 'SERVICE') {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'completion events require a trusted Service Event Consumer context',
    );
  }
  const event = input.event;
  const eventRecord = asRecord(event);
  const eventType = eventRecord.eventType;
  const eventVersion = eventRecord.eventVersion;
  if (
    typeof eventType !== 'string' ||
    !(eventType in EVENT_RULES) ||
    typeof eventVersion !== 'string' ||
    eventVersion !== '1.0'
  ) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event type or version is not supported by the completion consumer',
    );
  }
  const typedEventType = eventType as SupportedEventType;
  const rule = EVENT_RULES[typedEventType];
  if (eventRecord.producerModule !== rule.producerModule) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event producer module does not match the registered event type',
    );
  }
  const contract = CONTRACT_REGISTRY.validateOperation(typedEventType, '1.0', event);
  if (!contract.valid) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event does not satisfy the registered public event contract',
    );
  }
  const eventId = uuid(eventRecord.eventId, PROJECT_DELIVERY_COMPLETION_EVENT_INVALID, 'eventId');
  const aggregateType = nonEmpty(
    eventRecord.aggregateType,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'aggregateType',
  );
  const aggregateId = uuid(
    eventRecord.aggregateId,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'aggregateId',
  );
  const aggregateVersion = positiveBigint(
    eventRecord.aggregateVersion,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'aggregateVersion',
  );
  const enterpriseId = uuid(
    asRecord(eventRecord.scopeRef).enterpriseId,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'scopeRef.enterpriseId',
  );
  const projectId = uuid(
    asRecord(eventRecord.scopeRef).projectId,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'scopeRef.projectId',
  );
  if (
    enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(projectId) ||
    context.correlationId !== eventRecord.correlationId ||
    context.sourceEventId !== eventId
  ) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event scope or correlation does not match the trusted consumer context',
    );
  }
  const payload = canonicalObject(
    eventRecord.payload,
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'event.payload',
  );
  const payloadHash = digestCanonicalPayload(payload).hash;
  const integrity = asRecord(eventRecord.integrity);
  if (
    integrity.canonicalizationVersion !== '1' ||
    !contentHashBytes(
      integrity.payloadHash,
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event.integrity.payloadHash',
    ).equals(payloadHash)
  ) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
      'event integrity payload hash does not match canonical payload',
    );
  }
  const sourceWatermark = normalizeWatermark(input.sourceWatermark, rule, projectId);
  const sourceWatermarkObject = {
    sourceModule: sourceWatermark.sourceModule,
    partition: sourceWatermark.partition,
    sequence: sourceWatermark.sequence,
    observedAt: sourceWatermark.observedAt,
  } as unknown as CanonicalJsonObject;
  const factRefs = uniqueReferences(
    collectTypedReferences(payload, enterpriseId, projectId, 'event.payload'),
  );
  const subjectRefs = uniqueReferences(eventSubjectReferences(typedEventType, payload));
  return {
    event,
    rule,
    eventId,
    eventType: typedEventType,
    eventVersion: '1.0',
    aggregateType,
    aggregateId,
    aggregateVersion,
    enterpriseId,
    projectId,
    payload,
    payloadHash,
    sourceWatermark,
    sourceWatermarkHash: digestCanonicalPayload(sourceWatermarkObject).hash,
    factRefs,
    subjectRefs,
  };
}

function sourceWatermarkObject(watermark: NormalizedWatermark): CanonicalJsonObject {
  return {
    sourceModule: watermark.sourceModule,
    partition: watermark.partition,
    sequence: watermark.sequence,
    observedAt: watermark.observedAt,
  };
}

function syntheticFactRef(
  factId: string,
  enterpriseId: string,
  projectId: string,
  payloadHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'DeliveryItemCompletionFact',
    objectId: factId,
    immutableVersionId: factId,
    scope: { enterpriseId, projectId },
    contentHash: hashValue(payloadHash),
  };
}

async function insertInboxConflict(
  trx: EnterpriseProjectTransaction,
  normalized: NormalizedEvent,
  observedPayloadHash: Buffer,
  principalId: string,
): Promise<void> {
  await trx
    .insertInto('enterprise_project.contract_violation')
    .values({
      violation_id: newUuidV7(),
      violation_kind: 'INBOX_HASH_CONFLICT',
      contract_type: normalized.eventType,
      contract_version: normalized.eventVersion,
      enterprise_id: normalized.enterpriseId,
      project_id: normalized.projectId,
      observed_payload_hash: observedPayloadHash,
      schema_error_path: null,
      safe_summary:
        'completion Inbox event identity was replayed with a different hash or watermark',
      source_event_id: normalized.eventId,
      consumer_name: COMPLETION_CONSUMER,
      correlation_id: normalized.event.correlationId,
      created_by_principal_id: principalId,
    })
    .execute();
}

export async function consumeDeliveryItemCompletionEvent(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  input: DeliveryCompletionEventInput,
  internal?: {
    revalidate: () => Promise<void>;
    matches: (
      trx: EnterpriseProjectTransaction,
      fact: DeliveryItemCompletionFactTable,
    ) => Promise<boolean>;
    afterFact: (
      trx: EnterpriseProjectTransaction,
      factRef: Common.ContentAddressedRef,
    ) => Promise<void>;
  },
): Promise<DeliveryCompletionEventResult> {
  await internal?.revalidate();
  const normalized = normalizeEvent(context, input);
  const consumed = await withEnterpriseProjectTransaction<DeliveryCompletionEventResult>(
    db,
    context,
    async (trx) => {
      await sql`SELECT enterprise_project.lock_completion_ledger(${context.enterpriseId}::uuid,${normalized.projectId}::uuid)`.execute(
        trx,
      );
      await internal?.revalidate();
      const existingInbox = await trx
        .selectFrom('enterprise_project.inbox_message')
        .selectAll()
        .where('consumer_name', '=', COMPLETION_CONSUMER)
        .where('event_id', '=', normalized.eventId)
        .executeTakeFirst();
      const existingFact = await repo.getCompletionFactByEvent(
        trx,
        COMPLETION_CONSUMER,
        normalized.eventId,
      );
      if (existingInbox !== undefined) {
        if (
          existingInbox.payload_hash.equals(normalized.payloadHash) &&
          existingFact?.source_watermark_hash.equals(normalized.sourceWatermarkHash) === true &&
          (!internal || (await internal.matches(trx, existingFact)))
        ) {
          await internal?.revalidate();
          return {
            status: 'DUPLICATE' as const,
            factRef: asCanonicalJson(
              existingFact.fact_ref,
              PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
              'stored factRef',
            ) as unknown as Common.ContentAddressedRef,
          };
        }
        await insertInboxConflict(trx, normalized, normalized.payloadHash, context.principalId);
        await internal?.revalidate();
        return {
          status: 'QUARANTINED' as const,
          failureCode: PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT,
        };
      }
      await trx
        .insertInto('enterprise_project.inbox_message')
        .values({
          consumer_name: COMPLETION_CONSUMER,
          event_id: normalized.eventId,
          event_type: normalized.eventType,
          event_version: normalized.eventVersion,
          payload_hash: normalized.payloadHash,
          source_module: normalized.rule.sourceModule,
          enterprise_id: normalized.enterpriseId,
          project_id: normalized.projectId,
          status: 'PENDING',
          correlation_id: normalized.event.correlationId,
          created_by_principal_id: context.principalId,
        })
        .execute();

      const factId = newUuidV7();
      const factRef = syntheticFactRef(
        factId,
        normalized.enterpriseId,
        normalized.projectId,
        normalized.payloadHash,
      );
      await repo.insertCompletionFact(trx, {
        factId,
        consumerName: COMPLETION_CONSUMER,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        eventVersion: normalized.eventVersion,
        producerModule: normalized.rule.producerModule,
        aggregateType: normalized.aggregateType,
        aggregateId: normalized.aggregateId,
        aggregateVersion: normalized.aggregateVersion,
        enterpriseId: normalized.enterpriseId,
        projectId: normalized.projectId,
        factRef,
        factRefs: normalized.factRefs,
        subjectRefs: normalized.subjectRefs,
        lifecycle: normalized.rule.lifecycle,
        payload: normalized.payload,
        payloadHash: normalized.payloadHash,
        sourceWatermark: sourceWatermarkObject(normalized.sourceWatermark),
        sourceWatermarkHash: normalized.sourceWatermarkHash,
        correlationId: normalized.event.correlationId,
        causationId: normalized.event.causationId,
        recordedByPrincipalId: context.principalId,
        recordedByActorSnapshotId: context.actorSnapshotId,
        authorizationDecisionId: context.authorizationDecisionId,
        sourceCommandId: normalized.event.commandId,
      });
      await internal?.afterFact(trx, factRef);
      const processId = newUuidV7();
      await trx
        .insertInto('enterprise_project.process_instance')
        .values({
          process_id: processId,
          process_type: COMPLETION_CONSUMER,
          process_version: COMPLETION_PROCESS_VERSION,
          correlation_key: normalized.eventId,
          enterprise_id: normalized.enterpriseId,
          project_id: normalized.projectId,
          state: 'COMPLETED',
          aggregate_version: '1',
          last_consumed_event_id: normalized.eventId,
          blocked_reason_code: null,
          created_by_principal_id: context.principalId,
        })
        .execute();
      await trx
        .insertInto('enterprise_project.process_step')
        .values({
          process_step_id: newUuidV7(),
          process_id: processId,
          step_no: 1,
          enterprise_id: normalized.enterpriseId,
          project_id: normalized.projectId,
          input_event_id: normalized.eventId,
          input_event_type: normalized.eventType,
          issued_command_id: null,
          issued_command_type: null,
          outcome: 'COMPLETED',
          failure_code: null,
          human_intervention: null,
          created_by_principal_id: context.principalId,
        })
        .execute();
      await trx
        .updateTable('enterprise_project.inbox_message')
        .set({
          status: 'PROCESSED',
          processed_at: new Date(),
          result_command_id: normalized.event.commandId,
        })
        .where('consumer_name', '=', COMPLETION_CONSUMER)
        .where('event_id', '=', normalized.eventId)
        .execute();
      await internal?.revalidate();
      return { status: 'PROCESSED' as const, factRef, processId };
    },
  );
  await internal?.revalidate();
  return consumed;
}

function exactVersionedReference(
  value: unknown,
  objectType: string,
  context: EnterpriseProjectTransactionContext,
  label: string,
  code = PROJECT_DELIVERY_REFERENCE_INVALID,
): {
  readonly ref: CanonicalJsonObject;
  readonly objectId: string;
  readonly versionId: string;
  readonly projectId: string;
} {
  const reference = canonicalObject(value, code, label);
  if (reference.kind !== 'VERSIONED' || reference.objectType !== objectType) {
    completionError(code, `${label} must be an exact ${objectType} VersionedRef`);
  }
  const objectId = uuid(reference.objectId, code, `${label}.objectId`);
  const versionId = uuid(reference.versionId, code, `${label}.versionId`);
  const scope = canonicalObject(reference.scope, code, `${label}.scope`);
  if (
    scope.enterpriseId !== context.enterpriseId ||
    typeof scope.projectId !== 'string' ||
    !context.allowedProjectIds.includes(scope.projectId)
  ) {
    completionError(code, `${label} must identify an allowed Project exactly`);
  }
  const projectId = scope.projectId;
  return {
    ref: reference,
    objectId,
    versionId,
    projectId,
  };
}

function normalizedEvaluationInput(
  context: EnterpriseProjectTransactionContext,
  input: unknown,
): NormalizedEvaluationInput {
  const value = asRecord(input);
  if ('outcome' in value || 'submittedCompletion' in value || 'completionStatus' in value) {
    completionError(
      PROJECT_COMPLETION_IS_DERIVED,
      'completion outcome and status are derived and cannot be submitted by the caller',
    );
  }
  const planReference = exactVersionedReference(
    value.deliveryPlanRef,
    'DeliveryPlan',
    context,
    'input.deliveryPlanRef',
  );
  const deliveryItemId = uuid(
    value.deliveryItemId,
    PROJECT_DELIVERY_ITEM_INVALID,
    'input.deliveryItemId',
  );
  const criteriaHash = contentHashBytes(
    value.criteriaHash,
    PROJECT_DELIVERY_ITEM_INVALID,
    'input.criteriaHash',
  );
  const projectId = planReference.projectId;
  const rawFacts = referenceArray(value.factRefs, 'input.factRefs');
  const factRefs = uniqueReferences(
    rawFacts.map((fact, index) =>
      validateTypedReference(fact, context.enterpriseId, projectId, `input.factRefs[${index}]`),
    ),
  );
  if (factRefs.length !== rawFacts.length) {
    completionError(
      PROJECT_DELIVERY_ITEM_INVALID,
      'input.factRefs must not contain duplicate exact references',
    );
  }
  const rawWatermarks = referenceArray(value.sourceWatermarks, 'input.sourceWatermarks');
  const sourceWatermarks = rawWatermarks.map((watermark) =>
    normalizeWatermark(watermark, undefined, projectId),
  );
  const watermarkKeys = new Set(
    sourceWatermarks.map((watermark) => canonicalKey(sourceWatermarkObject(watermark))),
  );
  if (watermarkKeys.size !== sourceWatermarks.length) {
    completionError(
      PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
      'input.sourceWatermarks must not contain duplicate watermarks',
    );
  }
  const evaluatorReference = exactVersionedReference(
    value.evaluatorRef,
    'zhiju.quality.evaluator',
    context,
    'input.evaluatorRef',
    PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID,
  );
  const evaluatedAt = instant(
    value.evaluatedAt,
    PROJECT_DELIVERY_ITEM_INVALID,
    'input.evaluatedAt',
  );
  return {
    deliveryPlanRef: planReference.ref,
    deliveryPlanId: planReference.objectId,
    versionId: planReference.versionId,
    deliveryItemId,
    projectId,
    criteriaHash,
    factRefs,
    sourceWatermarks,
    evaluatorRef: evaluatorReference.ref,
    evaluatorId: evaluatorReference.objectId,
    evaluatorVersionId: evaluatorReference.versionId,
    evaluatedAt,
  };
}

function criteriaFromValue(
  value: unknown,
  enterpriseId: string,
  projectId: string,
): readonly CompletionCriterion[] {
  const criteria = asRecord(value);
  if (
    Object.keys(criteria).some((key) => key !== 'allOf') ||
    !Array.isArray(criteria.allOf) ||
    criteria.allOf.length === 0
  ) {
    completionError(
      PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
      'completionCriteria must be a non-empty allOf grammar',
    );
  }
  const result: CompletionCriterion[] = [];
  for (const [index, candidate] of criteria.allOf.entries()) {
    const criterion = asRecord(candidate);
    if (
      typeof criterion.eventType !== 'string' ||
      !(criterion.eventType in EVENT_RULES) ||
      Object.keys(criterion).some((key) => key !== 'eventType' && key !== 'factRef')
    ) {
      completionError(
        PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
        `completionCriteria.allOf[${index}] is not a supported criterion`,
      );
    }
    const eventType = criterion.eventType as SupportedEventType;
    if (criterion.factRef === undefined) {
      result.push({ eventType });
    } else {
      result.push({
        eventType,
        factRef: validateTypedReference(
          criterion.factRef,
          enterpriseId,
          projectId,
          `completionCriteria.allOf[${index}].factRef`,
          PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
        ),
      });
    }
  }
  return result;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function rowReferences(row: DeliveryItemCompletionFactTable): readonly CanonicalJsonObject[] {
  const stored = jsonValue(row.fact_refs);
  const values = Array.isArray(stored) ? (stored as readonly unknown[]) : [];
  return uniqueReferences([row.fact_ref, ...values]);
}

function rowSubjects(row: DeliveryItemCompletionFactTable): readonly CanonicalJsonObject[] {
  const stored = jsonValue(row.subject_refs);
  return uniqueReferences(Array.isArray(stored) ? stored : []);
}

function rowFactReference(row: DeliveryItemCompletionFactTable): CanonicalJsonObject {
  return canonicalObject(
    jsonValue(row.fact_ref),
    PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
    'stored factRef',
  );
}

function rowContainsReference(
  row: DeliveryItemCompletionFactTable,
  reference: CanonicalJsonObject,
): boolean {
  return rowReferences(row).some(
    (candidate) => canonicalKey(candidate) === canonicalKey(reference),
  );
}

function rowContainsFactReference(
  row: DeliveryItemCompletionFactTable,
  reference: CanonicalJsonObject,
): boolean {
  return canonicalKey(rowFactReference(row)) === canonicalKey(reference);
}

function referencesOverlap(
  left: readonly CanonicalJsonObject[],
  right: readonly CanonicalJsonObject[],
): boolean {
  const identityKey = (reference: CanonicalJsonObject): string | undefined => {
    const kind = reference.kind;
    return kind === 'VERSIONED' || kind === 'CONTENT_ADDRESSED' || kind === 'SNAPSHOT'
      ? canonicalKey(reference)
      : undefined;
  };
  const rightKeys = new Set(
    right.map(identityKey).filter((key): key is string => key !== undefined),
  );
  return left.some((reference) => {
    const key = identityKey(reference);
    return key !== undefined && rightKeys.has(key);
  });
}

function revokedByFacts(
  row: DeliveryItemCompletionFactTable,
  allFacts: readonly DeliveryItemCompletionFactTable[],
): boolean {
  if (row.lifecycle === 'REVOKED') return true;
  const subjects = rowSubjects(row);
  return allFacts.some(
    (candidate) =>
      candidate.lifecycle === 'REVOKED' && referencesOverlap(subjects, rowSubjects(candidate)),
  );
}

function selectedFactRows(
  input: NormalizedEvaluationInput,
  allFacts: readonly DeliveryItemCompletionFactTable[],
): readonly DeliveryItemCompletionFactTable[] {
  const selected: DeliveryItemCompletionFactTable[] = [];
  for (const [index, reference] of input.factRefs.entries()) {
    const row = allFacts.find((candidate) => rowContainsFactReference(candidate, reference));
    if (row === undefined) {
      completionError(
        PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
        `input.factRefs[${index}] does not identify a consumed formal fact`,
      );
    }
    if (!selected.some((candidate) => candidate.fact_id === row.fact_id)) selected.push(row);
  }
  return selected;
}

function evaluateCriteria(
  criteria: readonly CompletionCriterion[],
  selected: readonly DeliveryItemCompletionFactTable[],
  allFacts: readonly DeliveryItemCompletionFactTable[],
): EvaluationOutcome {
  const satisfyingRows = criteria
    .map((criterion) =>
      selected.find(
        (row) =>
          row.event_type === criterion.eventType &&
          row.lifecycle === 'ACTIVE' &&
          !revokedByFacts(row, allFacts) &&
          (criterion.factRef === undefined || rowContainsReference(row, criterion.factRef)),
      ),
    )
    .filter((row): row is DeliveryItemCompletionFactTable => row !== undefined);
  const outcome = satisfyingRows.length === criteria.length ? 'SATISFIED' : 'UNSATISFIED';
  return {
    outcome,
    selectedFacts: selected,
    satisfiedFactRefs:
      outcome === 'SATISFIED'
        ? uniqueReferences(satisfyingRows.map((row) => rowFactReference(row)))
        : [],
  };
}

function evaluationReference(
  row: Pick<DeliveryItemCompletionEvaluationTable, 'evaluation_id' | 'payload_hash'>,
  enterpriseId: string,
  projectId: string,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'CompletionEvaluation',
    objectId: row.evaluation_id,
    immutableVersionId: row.evaluation_id,
    scope: { enterpriseId, projectId },
    contentHash: hashValue(row.payload_hash),
  };
}

function safeRejection(error: EnterpriseBusinessError, currentAggregateVersion?: string) {
  return {
    kind: 'REJECTED' as const,
    errorCode: error.code,
    safeSummary: error.message,
    ...(currentAggregateVersion === undefined ? {} : { currentAggregateVersion }),
  };
}

function completionResult(
  evaluationRef: Common.ContentAddressedRef,
  outcome: 'SATISFIED' | 'UNSATISFIED',
  factRefs: readonly CanonicalJsonObject[],
  aggregateVersion: string,
  impactReviewRef?: Common.ContentAddressedRef,
): CanonicalJsonObject {
  return {
    evaluationRef,
    outcome,
    satisfiedFactRefs: outcome === 'SATISFIED' ? factRefs : [],
    aggregateVersion,
    ...(impactReviewRef === undefined ? {} : { impactReviewRef }),
  } as unknown as CanonicalJsonObject;
}

export type EvaluateDeliveryItemCompletionCommandPayload =
  EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload;

export async function handleEvaluateDeliveryItemCompletion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EvaluateDeliveryItemCompletionCommandPayload },
): Promise<CommandResult> {
  const input = normalizedEvaluationInput(context, envelope.payload.input);
  if (envelope.targetType !== 'DeliveryItem' || envelope.targetId !== input.deliveryItemId) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'evaluate_delivery_item_completion target must be the exact DeliveryItem',
    );
  }
  if (envelope.projectId !== undefined && envelope.projectId !== input.projectId) {
    throw new CommandExecutionError(
      'COMMAND_CONTEXT_MISMATCH',
      'evaluate_delivery_item_completion project does not match the exact Plan ref',
    );
  }
  const currentItem = await withEnterpriseProjectTransaction(db, context, (trx) =>
    repo.getDeliveryItem(trx, input.versionId, input.deliveryItemId),
  );
  if (currentItem === undefined) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_VERSION_NOT_FOUND,
      'input references an unknown DeliveryItem in the exact Plan Version',
    );
  }
  if (
    currentItem.delivery_plan_id !== input.deliveryPlanId ||
    currentItem.enterprise_id !== context.enterpriseId ||
    currentItem.project_id !== input.projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_VERSION_NOT_FOUND,
      'input references an unknown DeliveryItem in the exact Plan Version',
    );
  }
  const expectedAggregateVersion =
    envelope.expectedAggregateVersion ??
    aggregateVersionToString(currentItem.completion_aggregate_version);
  positiveBigint(expectedAggregateVersion, CONCURRENCY_CONFLICT, 'expectedAggregateVersion');
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId: input.projectId,
    targetType: 'DeliveryItem',
    targetId: input.deliveryItemId,
    expectedAggregateVersion,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    await sql`SELECT enterprise_project.lock_completion_ledger(${context.enterpriseId}::uuid,${input.projectId}::uuid)`.execute(
      execution.trx,
    );
    const item = await repo.getDeliveryItemForUpdate(
      execution.trx,
      input.versionId,
      input.deliveryItemId,
    );
    if (item === undefined) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'DeliveryItem was not found in the exact trusted Plan scope',
        ),
      );
    }
    if (
      item.delivery_plan_id !== input.deliveryPlanId ||
      item.enterprise_id !== context.enterpriseId ||
      item.project_id !== input.projectId
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'DeliveryItem was not found in the exact trusted Plan scope',
        ),
      );
    }
    const currentVersion = aggregateVersionToString(item.completion_aggregate_version);
    if (currentVersion !== expectedAggregateVersion) {
      return safeRejection(
        new EnterpriseBusinessError(
          CONCURRENCY_CONFLICT,
          'DeliveryItem completion pointer changed',
        ),
        currentVersion,
      );
    }
    const planVersion = await repo.getDeliveryPlanVersion(execution.trx, input.versionId);
    const plan = await repo.getDeliveryPlanById(execution.trx, input.deliveryPlanId);
    if (
      planVersion === undefined ||
      plan === undefined ||
      planVersion.delivery_plan_id !== input.deliveryPlanId ||
      planVersion.version_status !== 'ACTIVE' ||
      plan.active_version_id !== input.versionId
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'completion requires the exact active DeliveryPlan Version',
        ),
        currentVersion,
      );
    }
    const storedCriteria = asCanonicalJson(
      jsonValue(item.completion_criteria),
      PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
      'stored completionCriteria',
    );
    const storedCriteriaHash = digestCanonicalPayload({ criteria: storedCriteria }).hash;
    if (!storedCriteriaHash.equals(input.criteriaHash)) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
          'criteriaHash does not match the frozen DeliveryItem criteria',
        ),
        currentVersion,
      );
    }
    const criteria = criteriaFromValue(storedCriteria, context.enterpriseId, input.projectId);
    const allFacts = await repo.getCompletionFacts(
      execution.trx,
      context.enterpriseId,
      input.projectId,
    );
    const selected = selectedFactRows(input, allFacts);
    const selectedWatermarkKeys = new Set(
      input.sourceWatermarks.map((watermark) => canonicalKey(sourceWatermarkObject(watermark))),
    );
    const factWatermarkKeys = new Set(
      selected.map((fact) =>
        canonicalKey(
          canonicalObject(
            jsonValue(fact.source_watermark),
            PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
            'stored source watermark',
          ),
        ),
      ),
    );
    if (
      [...factWatermarkKeys].some((key) => !selectedWatermarkKeys.has(key)) ||
      [...selectedWatermarkKeys].some((key) => !factWatermarkKeys.has(key))
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
          'sourceWatermarks must exactly cover the selected formal facts',
        ),
        currentVersion,
      );
    }
    const evaluated = evaluateCriteria(criteria, selected, allFacts);
    const sortedFactRefs = [...input.factRefs].sort((left, right) =>
      canonicalKey(left).localeCompare(canonicalKey(right)),
    );
    const sortedSatisfiedFactRefs = [...evaluated.satisfiedFactRefs].sort((left, right) =>
      canonicalKey(left).localeCompare(canonicalKey(right)),
    );
    const sortedWatermarks = [...input.sourceWatermarks].sort((left, right) =>
      canonicalKey(sourceWatermarkObject(left)).localeCompare(
        canonicalKey(sourceWatermarkObject(right)),
      ),
    );
    const evaluatorRefHash = digestCanonicalPayload(input.evaluatorRef).hash;
    const factRefsHash = digestCanonicalPayload({ factRefs: sortedFactRefs }).hash;
    const sourceWatermarksHash = digestCanonicalPayload({
      sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
    }).hash;
    const inputFingerprint = digestCanonicalPayload({
      deliveryPlanRef: input.deliveryPlanRef,
      deliveryItemId: input.deliveryItemId,
      criteriaHash: hashValue(input.criteriaHash),
      evaluatorRef: input.evaluatorRef,
      factRefs: sortedFactRefs,
      sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
    } as unknown as CanonicalJsonObject).hash;
    const existing = await repo.getCompletionEvaluationByFingerprint(
      execution.trx,
      context.enterpriseId,
      input.projectId,
      input.versionId,
      input.deliveryItemId,
      inputFingerprint,
    );
    if (existing !== undefined) {
      const existingPayload = canonicalObject(
        jsonValue(existing.payload),
        PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
        'stored evaluation payload',
      );
      const storedSatisfiedFactRefs = asRecord(existingPayload).satisfiedFactRefs;
      const existingSatisfiedFactRefs = Array.isArray(storedSatisfiedFactRefs)
        ? uniqueReferences(storedSatisfiedFactRefs)
        : sortedFactRefs;
      return {
        kind: 'COMMITTED' as const,
        resultPayload: completionResult(
          evaluationReference(existing, context.enterpriseId, input.projectId),
          existing.outcome,
          existingSatisfiedFactRefs,
          currentVersion,
        ),
      };
    }
    const evaluationId = newUuidV7();
    const evaluationPayload = {
      enterpriseId: context.enterpriseId,
      projectId: input.projectId,
      deliveryPlanRef: input.deliveryPlanRef,
      deliveryItemId: input.deliveryItemId,
      criteriaHash: hashValue(input.criteriaHash),
      evaluatorRef: input.evaluatorRef,
      factRefs: sortedFactRefs,
      satisfiedFactRefs: sortedSatisfiedFactRefs,
      sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
      outcome: evaluated.outcome,
      evaluatedAt: input.evaluatedAt,
    } as unknown as CanonicalJsonObject;
    const evaluationPayloadHash = digestCanonicalPayload(evaluationPayload).hash;
    await repo.insertCompletionEvaluation(execution.trx, {
      evaluationId,
      deliveryPlanId: input.deliveryPlanId,
      versionId: input.versionId,
      deliveryItemId: input.deliveryItemId,
      enterpriseId: context.enterpriseId,
      projectId: input.projectId,
      criteriaHash: input.criteriaHash,
      evaluatorRef: input.evaluatorRef,
      evaluatorRefHash,
      evaluatorId: input.evaluatorId,
      evaluatorVersionId: input.evaluatorVersionId,
      factRefs: sortedFactRefs,
      factRefsHash,
      sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
      sourceWatermarksHash,
      outcome: evaluated.outcome,
      payload: evaluationPayload,
      payloadHash: evaluationPayloadHash,
      inputFingerprint,
      evaluatedAt: new Date(input.evaluatedAt),
      recordedByPrincipalId: envelope.principalId,
      recordedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
      ...(context.sourceEventId === undefined ? {} : { sourceEventId: context.sourceEventId }),
    });
    const nextEvaluationRef = evaluationReference(
      { evaluation_id: evaluationId, payload_hash: evaluationPayloadHash },
      context.enterpriseId,
      input.projectId,
    );
    const previousEvaluationId = item.current_completion_evaluation_id;
    const previousEvaluation =
      previousEvaluationId === null
        ? undefined
        : await repo.getCompletionEvaluationById(execution.trx, previousEvaluationId);
    const cas: DeliveryItemCompletionCasResult = await repo.casCurrentCompletionEvaluation(
      execution.trx,
      {
        deliveryPlanId: input.deliveryPlanId,
        versionId: input.versionId,
        enterpriseId: context.enterpriseId,
        projectId: input.projectId,
        deliveryItemId: input.deliveryItemId,
        expectedAggregateVersion: expectedAggregateVersion,
        expectedEvaluationId: previousEvaluationId,
        nextEvaluationId: evaluationId,
        commandId: envelope.commandId,
      },
    );
    if (!cas.ok) {
      return safeRejection(
        new EnterpriseBusinessError(
          CONCURRENCY_CONFLICT,
          'DeliveryItem completion pointer changed',
        ),
        cas.current === undefined
          ? currentVersion
          : aggregateVersionToString(cas.current.completion_aggregate_version),
      );
    }
    let impactReviewRef: Common.ContentAddressedRef | undefined;
    if (previousEvaluationId !== null && previousEvaluation !== undefined) {
      const triggeringRef =
        selected.length > 0
          ? (jsonValue(selected.at(-1)?.fact_ref) as CanonicalJsonObject)
          : sortedFactRefs[0];
      const impactPayload = {
        enterpriseId: context.enterpriseId,
        projectId: input.projectId,
        deliveryItemRef: {
          kind: 'VERSIONED',
          objectType: 'DeliveryItem',
          objectId: input.deliveryItemId,
          versionId: input.versionId,
          scope: {
            enterpriseId: context.enterpriseId,
            projectId: input.projectId,
          },
        },
        triggeringRef,
        priorEvaluationRef: evaluationReference(
          previousEvaluation,
          context.enterpriseId,
          input.projectId,
        ),
        newEvaluationRef: nextEvaluationRef,
        impactReason: selected.some((fact) => revokedByFacts(fact, allFacts))
          ? 'DELIVERY_ITEM_COMPLETION_FACT_REVOKED'
          : 'DELIVERY_ITEM_COMPLETION_FACT_CHANGED',
        affectedFactRefs: sortedFactRefs,
        sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
      } as unknown as CanonicalJsonObject;
      const impactPayloadHash = digestCanonicalPayload(impactPayload).hash;
      const impactReviewId = newUuidV7();
      impactReviewRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'DeliveryItemImpactReview',
        objectId: impactReviewId,
        immutableVersionId: impactReviewId,
        scope: {
          enterpriseId: context.enterpriseId,
          projectId: input.projectId,
        },
        contentHash: hashValue(impactPayloadHash),
      };
      await repo.insertImpactReview(execution.trx, {
        impactReviewId,
        deliveryPlanId: input.deliveryPlanId,
        versionId: input.versionId,
        deliveryItemId: input.deliveryItemId,
        enterpriseId: context.enterpriseId,
        projectId: input.projectId,
        triggeringRef,
        priorEvaluationRef: impactPayload.priorEvaluationRef,
        priorEvaluationId: previousEvaluationId,
        newEvaluationRef: nextEvaluationRef,
        newEvaluationId: evaluationId,
        impactReason: impactPayload.impactReason as string,
        affectedFactRefs: sortedFactRefs,
        sourceWatermarks: sortedWatermarks.map(sourceWatermarkObject),
        payload: impactPayload,
        payloadHash: impactPayloadHash,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      const impactEventPayload = {
        enterpriseId: context.enterpriseId,
        projectId: input.projectId,
        deliveryItemRef: impactPayload.deliveryItemRef,
        triggeringRef,
        priorEvaluationRef: impactPayload.priorEvaluationRef,
        impactReason: impactPayload.impactReason,
      } as unknown as CanonicalJsonObject;
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'project.DeliveryItemImpactReviewRequested',
        eventVersion: '1.0',
        aggregateType: 'DeliveryItem',
        aggregateId: input.deliveryItemId,
        aggregateVersion: cas.nextVersion,
        payload: impactEventPayload,
        declaredHash: digestCanonicalPayload(impactEventPayload).hash,
        occurredAt: new Date(),
      });
    }
    if (evaluated.outcome === 'SATISFIED' && previousEvaluation?.outcome !== 'SATISFIED') {
      const completionEventPayload = {
        enterpriseId: context.enterpriseId,
        projectId: input.projectId,
        deliveryItemRef: {
          kind: 'VERSIONED',
          objectType: 'DeliveryItem',
          objectId: input.deliveryItemId,
          versionId: input.versionId,
          scope: {
            enterpriseId: context.enterpriseId,
            projectId: input.projectId,
          },
        },
        evaluationRef: nextEvaluationRef,
        satisfiedFactRefs: sortedSatisfiedFactRefs,
        satisfiedAt: new Date().toISOString(),
      } as unknown as CanonicalJsonObject;
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'project.DeliveryItemCompletionSatisfied',
        eventVersion: '1.0',
        aggregateType: 'DeliveryItem',
        aggregateId: input.deliveryItemId,
        aggregateVersion: cas.nextVersion,
        payload: completionEventPayload,
        declaredHash: digestCanonicalPayload(completionEventPayload).hash,
        occurredAt: new Date(),
      });
    }
    return {
      kind: 'COMMITTED',
      resultPayload: completionResult(
        nextEvaluationRef,
        evaluated.outcome,
        sortedSatisfiedFactRefs,
        cas.nextVersion,
        impactReviewRef,
      ),
    };
  });
}

// #239: this constructor is wired only by trusted application composition.
export interface ExactTaskCompletionMaterial {
  readonly event: DeliveryCompletionEventEnvelope;
  readonly sidecar: CanonicalJsonObject;
  readonly bindingHash: Common.ContentHash;
  readonly sourceWatermark: EnterpriseProject.SourceWatermark;
}
function freezeCompletionResult<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeCompletionResult);
    Object.freeze(value);
  }
  return value;
}
const committedCompletionConsumptions = new WeakSet<object>();
export function isCommittedDeliveryCompletionConsumption(value: unknown): boolean {
  return typeof value === 'object' && value !== null && committedCompletionConsumptions.has(value);
}
interface AssociationRow {
  fact_id: string;
  enterprise_id: string;
  project_id: string;
  delivery_plan_id: string;
  version_id: string;
  delivery_item_id: string;
  task_id: string;
  event_id: string;
  canonical_payload: CanonicalJsonObject;
  payload_hash: Buffer;
}
async function association(trx: EnterpriseProjectTransaction, id: string) {
  return (
    await sql<AssociationRow>`SELECT * FROM enterprise_project.delivery_completion_task_association WHERE fact_id=${id}::uuid`.execute(
      trx,
    )
  ).rows[0];
}
const exactKey = (value: unknown) =>
  canonicalize(asCanonicalJson(value, PROJECT_DELIVERY_REFERENCE_INVALID, 'exact material'));
function sortedExact<T>(values: readonly T[]): T[] {
  return [...values].sort((a, b) =>
    Buffer.compare(Buffer.from(exactKey(a), 'utf8'), Buffer.from(exactKey(b), 'utf8')),
  );
}
function sameExact(a: unknown, b: unknown) {
  return exactKey(a) === exactKey(b);
}
function exactCriteria(value: unknown, scope: Common.ScopeRef) {
  try {
    return exactCompletionCriteria(value, scope);
  } catch {
    completionError(
      PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
      'Unsupported exact completion criteria',
    );
  }
}
export function createExactDeliveryCompletionConsumer(
  db: Kysely<EnterpriseProjectDb>,
  config: { assertTrustedMaterial: (value: unknown) => void },
) {
  return {
    consume: async (
      context: EnterpriseProjectTransactionContext,
      material: ExactTaskCompletionMaterial,
      revalidate: () => Promise<void>,
    ) => {
      config.assertTrustedMaterial(material);
      await revalidate();
      const { event, sidecar, bindingHash, sourceWatermark } = material;
      if (
        event.eventType !== 'execution.TaskCompleted' ||
        event.aggregateType !== 'zhiju.execution.task' ||
        Object.keys(sidecar).sort().join() !==
          'deliveryItemRef,eventEnvelopeHash,eventId,publicPayloadHash,storedPayloadHash,taskDefinitionSnapshotRef,taskEvaluationRef,taskRef' ||
        sidecar.eventId !== event.eventId ||
        !sameExact(sidecar.taskRef, event.payload.taskRef) ||
        !sameExact(sidecar.taskEvaluationRef, event.payload.evaluationRef) ||
        !sameExact(sidecar.publicPayloadHash, event.integrity.payloadHash) ||
        !contentHashBytes(
          sidecar.eventEnvelopeHash,
          PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
          'envelopeHash',
        ).equals(digestCanonicalPayload(event as unknown as CanonicalJsonObject).hash) ||
        !contentHashBytes(
          bindingHash,
          PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
          'bindingHash',
        ).equals(digestCanonicalPayload(sidecar).hash) ||
        asRecord(sidecar.taskDefinitionSnapshotRef).kind !== 'CONTENT_ADDRESSED' ||
        asRecord(sidecar.taskDefinitionSnapshotRef).objectType !==
          'zhiju.execution.task_definition_snapshot' ||
        asRecord(sidecar.taskRef).objectId !== event.aggregateId
      )
        completionError(
          PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
          'Invalid trusted TaskCompleted material',
        );
      const item = exactVersionedReference(
        sidecar.deliveryItemRef,
        'zhiju.project.delivery_item',
        context,
        'deliveryItemRef',
      );
      let planRef: CanonicalJsonObject | undefined;
      const consumed = await consumeDeliveryItemCompletionEvent(
        db,
        context,
        { event, sourceWatermark },
        {
          revalidate,
          matches: async (trx, fact) => {
            const stored = await association(trx, fact.fact_id);
            if (!stored?.payload_hash.equals(digestCanonicalPayload(stored.canonical_payload).hash))
              return false;
            const b = stored.canonical_payload;
            return (
              sameExact(b.event, event) &&
              sameExact(b.sidecar, sidecar) &&
              sameExact(b.bindingHash, bindingHash) &&
              sameExact(b.sourceWatermark, sourceWatermark)
            );
          },
          afterFact: async (trx, factRef) => {
            const target = await repo.getDeliveryItem(trx, item.versionId, item.objectId);
            if (
              target?.enterprise_id !== context.enterpriseId ||
              target.project_id !== item.projectId
            )
              completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Exact Item unavailable');
            planRef = {
              kind: 'VERSIONED',
              objectType: 'zhiju.project.delivery_plan',
              objectId: target.delivery_plan_id,
              versionId: item.versionId,
              scope: { enterpriseId: context.enterpriseId, projectId: item.projectId },
            };
            const body = {
              enterpriseId: context.enterpriseId,
              projectId: item.projectId,
              deliveryPlanRef: planRef,
              event,
              sidecar,
              bindingHash,
              sourceWatermark,
              sourceWatermarkHash: hashValue(
                digestCanonicalPayload(sourceWatermark as unknown as CanonicalJsonObject).hash,
              ),
            } as unknown as CanonicalJsonObject;
            await sql`INSERT INTO enterprise_project.delivery_completion_task_association(fact_id,enterprise_id,project_id,delivery_plan_id,version_id,delivery_item_id,task_id,event_id,canonical_payload,payload_hash) VALUES(${factRef.objectId}::uuid,${context.enterpriseId}::uuid,${item.projectId}::uuid,${target.delivery_plan_id}::uuid,${item.versionId}::uuid,${item.objectId}::uuid,${event.aggregateId}::uuid,${event.eventId}::uuid,${exactKey(body)}::jsonb,${digestCanonicalPayload(body).hash})`.execute(
              trx,
            );
            await trx
              .insertInto('enterprise_project.audit_record')
              .values({
                audit_id: newUuidV7(),
                enterprise_id: context.enterpriseId,
                project_id: item.projectId,
                principal_id: context.principalId,
                actor_snapshot_id: context.actorSnapshotId,
                authorization_decision_id: context.authorizationDecisionId,
                outcome: 'INFO',
                command_type: 'project.delivery_completion.consume',
                target_type: 'zhiju.project.delivery_item',
                target_id: item.objectId,
                correlation_id: event.correlationId,
                safe_summary: 'Consumed exact historical Task completion',
                retention_class: 'OPERATIONAL',
              })
              .execute();
          },
        },
      );
      await revalidate();
      const result = freezeCompletionResult({
        ...consumed,
        eventId: event.eventId,
        bindingHash,
        sourceWatermark,
      });
      if (consumed.status === 'PROCESSED' || consumed.status === 'DUPLICATE')
        committedCompletionConsumptions.add(result);
      return result;
    },
  };
}
export interface ExactDeliveryCompletionRequest {
  readonly deliveryPlanRef: Common.VersionedRef;
  readonly deliveryItemRef: Common.VersionedRef;
  readonly factRefs: readonly Common.ContentAddressedRef[];
}
function exactRequest(context: EnterpriseProjectTransactionContext, value: unknown, read = false) {
  const request = canonicalObject(value, PROJECT_DELIVERY_REFERENCE_INVALID, 'request');
  const keys = Object.keys(request).sort().join();
  if (
    keys !== 'deliveryItemRef,deliveryPlanRef,factRefs' &&
    !(read && keys === 'deliveryItemRef,deliveryPlanRef,evaluationRef,factRefs')
  )
    completionError(PROJECT_DELIVERY_REFERENCE_INVALID, 'Closed exact request required');
  const plan = exactVersionedReference(
    request.deliveryPlanRef,
    'zhiju.project.delivery_plan',
    context,
    'deliveryPlanRef',
  );
  const item = exactVersionedReference(
    request.deliveryItemRef,
    'zhiju.project.delivery_item',
    context,
    'deliveryItemRef',
  );
  if (plan.versionId !== item.versionId || plan.projectId !== item.projectId)
    completionError(PROJECT_DELIVERY_REFERENCE_INVALID, 'Exact Plan and Item mismatch');
  const refs = referenceArray(request.factRefs, 'factRefs').map((r) =>
    validateTypedReference(
      r,
      context.enterpriseId,
      item.projectId,
      'factRef',
      PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
    ),
  );
  if (
    refs.some(
      (r) => r.kind !== 'CONTENT_ADDRESSED' || r.objectType !== 'DeliveryItemCompletionFact',
    ) ||
    new Set(refs.map(exactKey)).size !== refs.length
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Invalid exact facts');
  return { request, plan, item, refs: sortedExact(refs) };
}
function verifyLedgerFact(
  row: DeliveryItemCompletionFactTable,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
) {
  const payload = canonicalObject(
    jsonValue(row.payload),
    PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
    'fact payload',
  );
  const watermark = canonicalObject(
    jsonValue(row.source_watermark),
    PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
    'watermark',
  );
  const ref = rowFactReference(row);
  if (
    row.enterprise_id !== context.enterpriseId ||
    row.project_id !== projectId ||
    !row.payload_hash.equals(digestCanonicalPayload(payload).hash) ||
    !row.source_watermark_hash.equals(digestCanonicalPayload(watermark).hash) ||
    !sameExact(
      ref,
      syntheticFactRef(row.fact_id, context.enterpriseId, projectId, row.payload_hash),
    )
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Fact unavailable');
  normalizeWatermark(watermark, EVENT_RULES[row.event_type as SupportedEventType], projectId);
  return { payload, watermark, ref };
}
async function exactSources(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  input: ReturnType<typeof exactRequest>,
  refs = input.refs,
  checkNewest = true,
) {
  const all = await repo.getCompletionFacts(trx, context.enterpriseId, input.item.projectId);
  const selected: DeliveryItemCompletionFactTable[] = [],
    associations: AssociationRow[] = [];
  const item = await repo.getDeliveryItem(trx, input.item.versionId, input.item.objectId);
  if (
    item?.delivery_plan_id !== input.plan.objectId ||
    item.enterprise_id !== context.enterpriseId ||
    item.project_id !== input.item.projectId
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Item unavailable');
  const criteria = exactCriteria(jsonValue(item.completion_criteria), {
    enterpriseId: context.enterpriseId,
    projectId: input.item.projectId,
  });
  const criteriaHash = digestCanonicalPayload({
    criteria: jsonValue(item.completion_criteria) as CanonicalJsonValue,
  }).hash;
  for (const ref of refs) {
    const row = all.find((r) => sameExact(rowFactReference(r), ref));
    if (!row) completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Fact unavailable');
    const fact = verifyLedgerFact(row, context, input.item.projectId);
    if (row.event_type === 'execution.TaskCompleted') {
      const a = await association(trx, row.fact_id);
      if (
        a?.version_id !== input.item.versionId ||
        a.delivery_item_id !== input.item.objectId ||
        a.delivery_plan_id !== input.plan.objectId ||
        a.enterprise_id !== context.enterpriseId ||
        a.project_id !== input.item.projectId ||
        !a.payload_hash.equals(digestCanonicalPayload(a.canonical_payload).hash)
      )
        completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Association unavailable');
      const b = a.canonical_payload,
        s = asRecord(b.sidecar),
        ev = asRecord(b.event);
      if (
        !sameExact(s.taskRef, criteria.taskRef) ||
        !sameExact(s.taskRef, fact.payload.taskRef) ||
        !sameExact(s.taskEvaluationRef, fact.payload.evaluationRef) ||
        !sameExact(s.deliveryItemRef, input.item.ref) ||
        !sameExact(b.deliveryPlanRef, input.plan.ref) ||
        !sameExact(b.sourceWatermark, fact.watermark) ||
        !sameExact(ev.payload, fact.payload) ||
        ev.eventId !== row.event_id ||
        ev.aggregateId !== row.aggregate_id ||
        a.task_id !== row.aggregate_id ||
        ev.aggregateType !== row.aggregate_type ||
        String(ev.aggregateVersion) !== aggregateVersionToString(row.aggregate_version) ||
        ev.producerModule !== row.producer_module ||
        ev.commandId !== row.source_command_id ||
        ev.causationId !== row.causation_id ||
        ev.correlationId !== row.correlation_id ||
        !contentHashBytes(
          s.eventEnvelopeHash,
          PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
          'envelopeHash',
        ).equals(digestCanonicalPayload(ev as CanonicalJsonObject).hash) ||
        !contentHashBytes(
          b.bindingHash,
          PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
          'bindingHash',
        ).equals(digestCanonicalPayload(s as CanonicalJsonObject).hash) ||
        !contentHashBytes(
          s.publicPayloadHash,
          PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
          'publicHash',
        ).equals(row.payload_hash) ||
        !contentHashBytes(
          b.sourceWatermarkHash,
          PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
          'watermarkHash',
        ).equals(row.source_watermark_hash)
      )
        completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Association unavailable');
      if (checkNewest) {
        const newer = (
          await sql<{
            sequence: string;
          }>`SELECT f.source_watermark->>'sequence' AS sequence FROM enterprise_project.delivery_completion_task_association a JOIN enterprise_project.delivery_item_completion_fact f USING(fact_id) WHERE a.enterprise_id=${context.enterpriseId}::uuid AND a.project_id=${input.item.projectId}::uuid AND a.delivery_plan_id=${input.plan.objectId}::uuid AND a.version_id=${input.item.versionId}::uuid AND a.delivery_item_id=${input.item.objectId}::uuid AND a.task_id=${row.aggregate_id}::uuid`.execute(
            trx,
          )
        ).rows.some((r) => BigInt(r.sequence) > BigInt(fact.watermark.sequence as number));
        if (newer)
          completionError(
            PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
            'A newer exact association has been consumed',
          );
      }
      associations.push(a);
    } else if (
      row.event_type !== 'release.ReleaseCompleted' ||
      !criteria.releaseRef ||
      !sameExact(fact.payload.releaseRef, criteria.releaseRef)
    )
      completionError(
        PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
        'Fact does not belong to the frozen criteria',
      );
    selected.push(row);
  }
  const revocations = all.filter(
    (r) =>
      r.lifecycle === 'REVOKED' &&
      selected.some((s) => referencesOverlap(rowSubjects(s), rowSubjects(r))),
  );
  revocations.forEach((r) => verifyLedgerFact(r, context, input.item.projectId));
  const task = selected.find(
    (r) => r.event_type === 'execution.TaskCompleted' && !revokedByFacts(r, all),
  );
  const release = selected.find(
    (r) => r.event_type === 'release.ReleaseCompleted' && !revokedByFacts(r, all),
  );
  const outcome =
    task && (!criteria.releaseRef || release) ? ('SATISFIED' as const) : ('UNSATISFIED' as const);
  return {
    item,
    all,
    selected,
    associations,
    criteriaHash,
    revocations,
    outcome,
    satisfiedFactRefs: outcome === 'SATISFIED' ? sortedExact(selected.map(rowFactReference)) : [],
  };
}
export async function handleEvaluateExactDeliveryItemCompletion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  ports: { revalidate: () => Promise<void>; now: () => Date },
) {
  await ports.revalidate();
  const input = exactRequest(context, envelope.requestPayload);
  if (
    envelope.commandType !== 'project.evaluate_delivery_item_completion' ||
    envelope.commandVersion !== '2.0' ||
    envelope.targetType !== 'zhiju.project.delivery_item' ||
    envelope.targetId !== input.item.objectId ||
    envelope.projectId !== input.item.projectId ||
    !envelope.expectedAggregateVersion
  )
    completionError(PROJECT_DELIVERY_REFERENCE_INVALID, 'Invalid exact completion command');
  positiveInteger(
    envelope.expectedAggregateVersion,
    CONCURRENCY_CONFLICT,
    'expectedAggregateVersion',
  );
  return executeEnterpriseProjectCommand(
    db,
    context,
    envelope,
    async (execution) => {
      await sql`SELECT enterprise_project.lock_completion_ledger(${context.enterpriseId}::uuid,${input.item.projectId}::uuid)`.execute(
        execution.trx,
      );
      await repo.getDeliveryItemForUpdate(execution.trx, input.item.versionId, input.item.objectId);
      await ports.revalidate();
      const sources = await exactSources(execution.trx, context, input);
      const version = aggregateVersionToString(sources.item.completion_aggregate_version);
      if (version !== envelope.expectedAggregateVersion)
        return safeRejection(
          new EnterpriseBusinessError(CONCURRENCY_CONFLICT, 'Completion pointer changed'),
          version,
        );
      const plan = await repo.getDeliveryPlanById(execution.trx, input.plan.objectId),
        pv = await repo.getDeliveryPlanVersion(execution.trx, input.plan.versionId),
        project = await repo.getProjectById(execution.trx, input.item.projectId);
      if (
        pv?.delivery_plan_id !== input.plan.objectId ||
        plan?.active_version_id !== input.plan.versionId ||
        pv.version_status !== 'ACTIVE' ||
        project?.status !== 'ACTIVE'
      )
        completionError(PROJECT_DELIVERY_REFERENCE_INVALID, 'Exact active Plan unavailable');
      const watermarks = sortedExact([
        ...new Map(
          sources.selected.map((r) => {
            const wm = canonicalObject(
              jsonValue(r.source_watermark),
              PROJECT_DELIVERY_REFERENCE_INVALID,
              'watermark',
            );
            return [exactKey(wm), wm] as const;
          }),
        ).values(),
      ]);
      const fingerprintPayload = {
        enterpriseId: context.enterpriseId,
        projectId: input.item.projectId,
        deliveryPlanRef: input.plan.ref,
        deliveryItemRef: input.item.ref,
        criteriaHash: hashValue(sources.criteriaHash),
        evaluatorRef: DELIVERY_COMPLETION_EVALUATOR,
        factRefs: input.refs,
        associationHashes: sources.associations.map((a) => hashValue(a.payload_hash)),
        sourceWatermarks: watermarks,
        revocationFactRefs: sortedExact(sources.revocations.map(rowFactReference)),
        taskFactSemantics: 'HISTORICAL_COMPLETION',
      } as unknown as CanonicalJsonObject;
      const fingerprint = digestCanonicalPayload(fingerprintPayload).hash;
      const old = await repo.getCompletionEvaluationByFingerprint(
        execution.trx,
        context.enterpriseId,
        input.item.projectId,
        input.item.versionId,
        input.item.objectId,
        fingerprint,
      );
      if (old) {
        await verifyExactEvaluationSources(
          execution.trx,
          context,
          input,
          verifyExactEvaluation(old, context, input),
        );
        await ports.revalidate();
        return {
          kind: 'COMMITTED' as const,
          resultPayload: exactCompletionResult(
            evaluationReference(old, context.enterpriseId, input.item.projectId),
            old.outcome,
            asRecord(jsonValue(old.payload)).satisfiedFactRefs as CanonicalJsonObject[],
            version,
          ),
        };
      }
      const time = ports.now(),
        id = newUuidV7();
      const payload = {
        ...fingerprintPayload,
        outcome: sources.outcome,
        satisfiedFactRefs: sources.satisfiedFactRefs,
        evaluatedAt: time.toISOString(),
      };
      const payloadHash = digestCanonicalPayload(payload).hash;
      await repo.insertCompletionEvaluation(execution.trx, {
        evaluationId: id,
        deliveryPlanId: input.plan.objectId,
        versionId: input.item.versionId,
        deliveryItemId: input.item.objectId,
        enterpriseId: context.enterpriseId,
        projectId: input.item.projectId,
        criteriaHash: sources.criteriaHash,
        evaluatorRef: DELIVERY_COMPLETION_EVALUATOR,
        evaluatorRefHash: digestCanonicalPayload(
          DELIVERY_COMPLETION_EVALUATOR as unknown as CanonicalJsonObject,
        ).hash,
        evaluatorId: DELIVERY_COMPLETION_EVALUATOR.objectId,
        evaluatorVersionId: DELIVERY_COMPLETION_EVALUATOR.versionId,
        factRefs: input.refs,
        factRefsHash: digestCanonicalPayload({ factRefs: input.refs }).hash,
        sourceWatermarks: watermarks,
        sourceWatermarksHash: digestCanonicalPayload({ sourceWatermarks: watermarks }).hash,
        outcome: sources.outcome,
        payload,
        payloadHash,
        inputFingerprint: fingerprint,
        evaluatedAt: time,
        recordedByPrincipalId: context.principalId,
        recordedByActorSnapshotId: context.actorSnapshotId,
        authorizationDecisionId: context.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      const prior = sources.item.current_completion_evaluation_id
        ? await repo.getCompletionEvaluationById(
            execution.trx,
            sources.item.current_completion_evaluation_id,
          )
        : undefined;
      const cas = await repo.casCurrentCompletionEvaluation(execution.trx, {
        deliveryPlanId: input.plan.objectId,
        versionId: input.item.versionId,
        enterpriseId: context.enterpriseId,
        projectId: input.item.projectId,
        deliveryItemId: input.item.objectId,
        expectedAggregateVersion: version,
        expectedEvaluationId: sources.item.current_completion_evaluation_id,
        nextEvaluationId: id,
        commandId: envelope.commandId,
      });
      if (!cas.ok) completionError(CONCURRENCY_CONFLICT, 'Completion pointer changed');
      const evalRef = evaluationReference(
        { evaluation_id: id, payload_hash: payloadHash },
        context.enterpriseId,
        input.item.projectId,
      );
      let impactRef: Common.ContentAddressedRef | undefined;
      if (prior) {
        const impactId = newUuidV7(),
          priorRef = evaluationReference(prior, context.enterpriseId, input.item.projectId),
          triggeringRef = sources.revocations.length
            ? canonicalObject(
                jsonValue(sources.revocations.at(-1)?.fact_ref),
                PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
                'revocation factRef',
              )
            : input.refs[0];
        if (!triggeringRef)
          completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Fact unavailable');
        const reason = sources.revocations.length
          ? 'DELIVERY_ITEM_COMPLETION_FACT_REVOKED'
          : 'DELIVERY_ITEM_COMPLETION_FACT_CHANGED';
        const body = {
          enterpriseId: context.enterpriseId,
          projectId: input.item.projectId,
          deliveryItemRef: input.item.ref,
          triggeringRef,
          priorEvaluationRef: priorRef,
          newEvaluationRef: evalRef,
          impactReason: reason,
          affectedFactRefs: input.refs,
          sourceWatermarks: watermarks,
        } as unknown as CanonicalJsonObject;
        const hash = digestCanonicalPayload(body).hash;
        impactRef = {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'DeliveryItemImpactReview',
          objectId: impactId,
          immutableVersionId: impactId,
          scope: { enterpriseId: context.enterpriseId, projectId: input.item.projectId },
          contentHash: hashValue(hash),
        };
        await repo.insertImpactReview(execution.trx, {
          impactReviewId: impactId,
          deliveryPlanId: input.plan.objectId,
          versionId: input.item.versionId,
          deliveryItemId: input.item.objectId,
          enterpriseId: context.enterpriseId,
          projectId: input.item.projectId,
          triggeringRef,
          priorEvaluationRef: priorRef,
          priorEvaluationId: prior.evaluation_id,
          newEvaluationRef: evalRef,
          newEvaluationId: id,
          impactReason: reason,
          affectedFactRefs: input.refs,
          sourceWatermarks: watermarks,
          payload: body,
          payloadHash: hash,
          recordedByPrincipalId: context.principalId,
          recordedByActorSnapshotId: context.actorSnapshotId,
          authorizationDecisionId: context.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'project.DeliveryItemImpactReviewRequested',
          eventVersion: '1.0',
          aggregateType: 'zhiju.project.delivery_item',
          aggregateId: input.item.objectId,
          aggregateVersion: cas.nextVersion,
          payload: {
            enterpriseId: context.enterpriseId,
            projectId: input.item.projectId,
            deliveryItemRef: input.item.ref,
            triggeringRef,
            priorEvaluationRef: priorRef as unknown as CanonicalJsonObject,
            impactReason: reason,
          },
          occurredAt: time,
        });
      }
      if (sources.outcome === 'SATISFIED' && prior?.outcome !== 'SATISFIED')
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'project.DeliveryItemCompletionSatisfied',
          eventVersion: '1.0',
          aggregateType: 'zhiju.project.delivery_item',
          aggregateId: input.item.objectId,
          aggregateVersion: cas.nextVersion,
          payload: {
            enterpriseId: context.enterpriseId,
            projectId: input.item.projectId,
            deliveryItemRef: input.item.ref,
            evaluationRef: evalRef as unknown as CanonicalJsonObject,
            satisfiedFactRefs: sources.satisfiedFactRefs,
            satisfiedAt: time.toISOString(),
          },
          occurredAt: time,
        });
      await ports.revalidate();
      return {
        kind: 'COMMITTED' as const,
        resultPayload: exactCompletionResult(
          evalRef,
          sources.outcome,
          sources.satisfiedFactRefs,
          cas.nextVersion,
          impactRef,
        ),
      };
    },
    ports.revalidate,
  );
}
function exactCompletionResult(
  ref: Common.ContentAddressedRef,
  outcome: string,
  facts: readonly CanonicalJsonObject[],
  version: string,
  impact?: Common.ContentAddressedRef,
): CanonicalJsonObject {
  const result = {
    evaluationRef: ref,
    outcome,
    satisfiedFactRefs: facts,
    aggregateVersion: positiveInteger(version, CONCURRENCY_CONFLICT, 'aggregateVersion'),
    ...(impact ? { impactReviewRef: impact } : {}),
  } as unknown as CanonicalJsonObject;
  if (
    !CONTRACT_REGISTRY.validateOperationResult(
      'project.evaluate_delivery_item_completion',
      '2.0',
      result,
    ).valid
  )
    completionError(PROJECT_DELIVERY_REFERENCE_INVALID, 'Invalid completion result');
  return result;
}
function verifyExactEvaluation(
  row: DeliveryItemCompletionEvaluationTable,
  context: EnterpriseProjectTransactionContext,
  input: ReturnType<typeof exactRequest>,
) {
  const b = canonicalObject(
    jsonValue(row.payload),
    PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
    'evaluation',
  );
  const fingerprint = { ...b };
  delete fingerprint.outcome;
  delete fingerprint.satisfiedFactRefs;
  delete fingerprint.evaluatedAt;
  if (
    Object.keys(b).sort().join() !==
      'associationHashes,criteriaHash,deliveryItemRef,deliveryPlanRef,enterpriseId,evaluatedAt,evaluatorRef,factRefs,outcome,projectId,revocationFactRefs,satisfiedFactRefs,sourceWatermarks,taskFactSemantics' ||
    b.taskFactSemantics !== 'HISTORICAL_COMPLETION' ||
    b.enterpriseId !== context.enterpriseId ||
    b.projectId !== input.item.projectId ||
    row.enterprise_id !== context.enterpriseId ||
    row.project_id !== input.item.projectId ||
    row.delivery_plan_id !== input.plan.objectId ||
    row.version_id !== input.item.versionId ||
    row.delivery_item_id !== input.item.objectId ||
    !sameExact(b.deliveryPlanRef, input.plan.ref) ||
    !sameExact(b.deliveryItemRef, input.item.ref) ||
    !row.payload_hash.equals(digestCanonicalPayload(b).hash) ||
    !row.input_fingerprint.equals(digestCanonicalPayload(fingerprint).hash) ||
    !sameExact(b.criteriaHash, hashValue(row.criteria_hash)) ||
    !sameExact(b.factRefs, jsonValue(row.fact_refs)) ||
    !row.fact_refs_hash.equals(digestCanonicalPayload({ factRefs: b.factRefs ?? null }).hash) ||
    !sameExact(b.sourceWatermarks, jsonValue(row.source_watermarks)) ||
    !row.source_watermarks_hash.equals(
      digestCanonicalPayload({ sourceWatermarks: b.sourceWatermarks ?? null }).hash,
    ) ||
    !sameExact(b.evaluatorRef, jsonValue(row.evaluator_ref)) ||
    !row.evaluator_ref_hash.equals(
      digestCanonicalPayload({ ...(b.evaluatorRef as CanonicalJsonObject) }).hash,
    ) ||
    row.evaluator_id !== DELIVERY_COMPLETION_EVALUATOR.objectId ||
    row.evaluator_version_id !== DELIVERY_COMPLETION_EVALUATOR.versionId ||
    typeof b.evaluatedAt !== 'string' ||
    new Date(b.evaluatedAt).getTime() !== new Date(row.evaluated_at).getTime() ||
    b.outcome !== row.outcome ||
    !sameExact(b.evaluatorRef, DELIVERY_COMPLETION_EVALUATOR)
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Evaluation unavailable');
  return b;
}
async function verifyExactEvaluationSources(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  input: ReturnType<typeof exactRequest>,
  evaluation: CanonicalJsonObject,
) {
  const sourceInput = exactRequest(
    context,
    { ...input.request, factRefs: evaluation.factRefs },
    true,
  );
  const sources = await exactSources(trx, context, sourceInput, sourceInput.refs, false);
  const watermarks = sortedExact([
    ...new Map(
      sources.selected.map((row) => {
        const watermark = canonicalObject(
          jsonValue(row.source_watermark),
          PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
          'watermark',
        );
        return [exactKey(watermark), watermark] as const;
      }),
    ).values(),
  ]);
  const revocations = evaluation.revocationFactRefs;
  if (
    !Array.isArray(revocations) ||
    !sameExact(evaluation.factRefs, sourceInput.refs) ||
    !sameExact(evaluation.criteriaHash, hashValue(sources.criteriaHash)) ||
    !sameExact(
      evaluation.associationHashes,
      sources.associations.map((row) => hashValue(row.payload_hash)),
    ) ||
    !sameExact(evaluation.sourceWatermarks, watermarks) ||
    !sameExact(revocations, sortedExact(revocations as CanonicalJsonObject[]))
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Evaluation sources unavailable');
  const frozenRevocations = revocations.map((ref) => {
    const row = sources.revocations.find((candidate) =>
      sameExact(rowFactReference(candidate), ref),
    );
    if (!row)
      completionError(
        PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
        'Evaluation revocation unavailable',
      );
    verifyLedgerFact(row, context, input.item.projectId);
    return row;
  });
  const criteria = exactCriteria(jsonValue(sources.item.completion_criteria), {
    enterpriseId: context.enterpriseId,
    projectId: input.item.projectId,
  });
  const active = sources.selected.filter((row) => !revokedByFacts(row, frozenRevocations));
  const satisfied =
    active.some((row) => row.event_type === 'execution.TaskCompleted') &&
    (!criteria.releaseRef || active.some((row) => row.event_type === 'release.ReleaseCompleted'));
  if (
    evaluation.outcome !== (satisfied ? 'SATISFIED' : 'UNSATISFIED') ||
    !sameExact(
      evaluation.satisfiedFactRefs,
      satisfied ? sortedExact(sources.selected.map(rowFactReference)) : [],
    )
  )
    completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Evaluation outcome unavailable');
  return sources;
}
function requireSelected(value: DeliveryItemCompletionEvaluationTable | undefined) {
  if (!value) completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Evaluation unavailable');
  return value;
}
export function createDeliveryItemCompletionReadbackPort(db: Kysely<EnterpriseProjectDb>) {
  return {
    readExact: async (
      context: EnterpriseProjectTransactionContext,
      request: ExactDeliveryCompletionRequest & {
        readonly evaluationRef?: Common.ContentAddressedRef;
      },
      ports: { revalidate: () => Promise<void>; now: () => Date },
    ) => {
      await ports.revalidate();
      const input = exactRequest(context, request, true);
      const result = await withEnterpriseProjectTransaction(db, context, async (trx) => {
        await sql`SELECT enterprise_project.lock_completion_ledger(${context.enterpriseId}::uuid,${input.item.projectId}::uuid)`.execute(
          trx,
        );
        await ports.revalidate();
        const s = await exactSources(trx, context, input, input.refs, false),
          current = s.item.current_completion_evaluation_id
            ? await repo.getCompletionEvaluationById(trx, s.item.current_completion_evaluation_id)
            : undefined;
        const wanted = request.evaluationRef;
        const selected = wanted
          ? await repo.getCompletionEvaluationById(trx, wanted.objectId)
          : current;
        if (
          wanted &&
          (!selected ||
            !sameExact(
              wanted,
              evaluationReference(selected, context.enterpriseId, input.item.projectId),
            ))
        )
          completionError(PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND, 'Evaluation unavailable');
        const evaluation = selected ? verifyExactEvaluation(selected, context, input) : undefined;
        if (evaluation) await verifyExactEvaluationSources(trx, context, input, evaluation);
        let derivedStatus: 'NOT_EVALUATED' | 'SATISFIED' | 'UNSATISFIED' = 'NOT_EVALUATED';
        if (current) {
          const c = verifyExactEvaluation(current, context, input);
          const currentSources = await verifyExactEvaluationSources(trx, context, input, c);
          const plan = await repo.getDeliveryPlanById(trx, input.plan.objectId),
            pv = await repo.getDeliveryPlanVersion(trx, input.plan.versionId),
            project = await repo.getProjectById(trx, input.item.projectId);
          derivedStatus =
            plan?.active_version_id === input.plan.versionId &&
            pv?.version_status === 'ACTIVE' &&
            project?.status === 'ACTIVE'
              ? currentSources.outcome
              : 'UNSATISFIED';
        }
        const facts = s.selected.map((row) => {
          const f = verifyLedgerFact(row, context, input.item.projectId),
            a = s.associations.find((x) => x.fact_id === row.fact_id),
            b = a?.canonical_payload,
            side = b ? asRecord(b.sidecar) : undefined;
          return {
            factRef: f.ref,
            eventId: row.event_id,
            eventType: row.event_type,
            eventVersion: row.event_version,
            ...(side
              ? {
                  taskRef: side.taskRef,
                  taskEvaluationRef: side.taskEvaluationRef,
                  deliveryPlanRef: b?.deliveryPlanRef,
                  deliveryItemRef: side.deliveryItemRef,
                  bindingHash: b?.bindingHash,
                }
              : {}),
            payloadHash: hashValue(row.payload_hash),
            sourceWatermark: f.watermark,
            lifecycle: row.lifecycle,
          };
        });
        await ports.revalidate();
        return {
          deliveryPlanRef: input.plan.ref,
          deliveryItemRef: input.item.ref,
          criteriaHash: hashValue(s.criteriaHash),
          facts,
          ...(evaluation
            ? {
                evaluation: {
                  evaluationRef: evaluationReference(
                    requireSelected(selected),
                    context.enterpriseId,
                    input.item.projectId,
                  ),
                  ...Object.fromEntries(
                    [
                      'deliveryPlanRef',
                      'deliveryItemRef',
                      'criteriaHash',
                      'evaluatorRef',
                      'factRefs',
                      'satisfiedFactRefs',
                      'sourceWatermarks',
                      'revocationFactRefs',
                      'outcome',
                      'evaluatedAt',
                    ].map((k) => [k, evaluation[k]]),
                  ),
                },
              }
            : {}),
          ...(current
            ? {
                currentEvaluationRef: evaluationReference(
                  current,
                  context.enterpriseId,
                  input.item.projectId,
                ),
              }
            : {}),
          completionAggregateVersion: positiveInteger(
            s.item.completion_aggregate_version,
            CONCURRENCY_CONFLICT,
            'aggregateVersion',
          ),
          derivedStatus,
          selectedEvaluationIsCurrent:
            !!selected && selected.evaluation_id === current?.evaluation_id,
          taskFactSemantics: 'HISTORICAL_COMPLETION',
          taskCurrentUseStatus: 'UNKNOWN',
          checkedAt: ports.now().toISOString(),
        };
      });
      await ports.revalidate();
      return result;
    },
  };
}
