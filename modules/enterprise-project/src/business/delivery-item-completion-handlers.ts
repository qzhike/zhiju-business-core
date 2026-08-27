// IM-03 WI-12 (issue #68): controlled formal-fact consumption and the
// DeliveryItem Completion Evaluator. Completion is derived only from frozen
// criteria and exact persisted facts; callers cannot submit a completion flag.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import {
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
const CONTRACT_REGISTRY = new ContractRegistry();
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
): Promise<DeliveryCompletionEventResult> {
  const normalized = normalizeEvent(context, input);
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
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
        existingFact?.source_watermark_hash.equals(normalized.sourceWatermarkHash) === true
      ) {
        return {
          status: 'DUPLICATE',
          factRef: asCanonicalJson(
            existingFact.fact_ref,
            PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
            'stored factRef',
          ) as unknown as Common.ContentAddressedRef,
        };
      }
      await insertInboxConflict(trx, normalized, normalized.payloadHash, context.principalId);
      return {
        status: 'QUARANTINED',
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
    return { status: 'PROCESSED', factRef, processId };
  });
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
