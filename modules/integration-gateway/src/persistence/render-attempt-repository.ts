// IM-05 WI-05 (issue #125): authoritative RenderAttempt/Receipt repository.

import { createHash } from 'node:crypto';

import type { Common, IntegrationGateway } from '@zhiju/contracts';
import {
  canonicalize,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { sql } from 'kysely';

import type {
  SelectedRenderAttempt,
  RenderTransaction,
  RenderTransactionContext,
} from './render-attempt-db.js';

export const INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT = 'INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT';
export const INTEGRATION_RENDER_ATTEMPT_NOT_FOUND = 'INTEGRATION_RENDER_ATTEMPT_NOT_FOUND';

export class RenderPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RenderPersistenceError';
  }
}

export interface RenderAttemptRecord {
  readonly sourceCommandId?: string;
  readonly attemptId: string;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly stableKeyHash: Buffer;
  readonly requestPayloadHash: Buffer;
  readonly request: IntegrationGateway.RenderRequest;
  readonly status: 'CREATED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  readonly outputObjectRef?: string;
  readonly outputChecksum?: Common.ContentHash;
  readonly rawReceiptId?: string;
  readonly rawReceiptContentHash?: Common.ContentHash;
  readonly errorCode?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type RenderCompletionRecord = Omit<RenderAttemptRecord, 'request'> & {
  readonly request: Pick<
    IntegrationGateway.RenderRequest,
    'revisionRef' | 'rendererId' | 'rendererVersion'
  >;
};

export interface RenderReceiptInput {
  readonly receiptId: string;
  readonly providerReceiptRef: Common.ExternalRef;
  readonly receiptPayloadRef: string;
  readonly receiptPayloadHash: Common.ContentHash;
  readonly receiptContentHash: Common.ContentHash;
  readonly occurredAt?: Date;
  readonly recordedAt: Date;
}

function digestJson(value: CanonicalJsonValue): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest();
}

export function requestPayloadHash(request: IntegrationGateway.RenderRequest): Buffer {
  return digestJson(request as unknown as CanonicalJsonValue);
}

export function stableKeyHash(stableKey: string): Buffer {
  return createHash('sha256').update(stableKey, 'utf8').digest();
}

function publicHash(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function rowToRecord(row: SelectedRenderAttempt): RenderAttemptRecord {
  const request = row.request_payload as IntegrationGateway.RenderRequest;
  return {
    attemptId: row.attempt_id,
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    stableKeyHash: Buffer.from(row.stable_key_hash),
    requestPayloadHash: Buffer.from(row.request_payload_hash),
    request,
    status: row.status,
    ...(row.output_object_ref === null ? {} : { outputObjectRef: row.output_object_ref }),
    ...(row.output_checksum === null ? {} : { outputChecksum: publicHash(row.output_checksum) }),
    ...(row.raw_receipt_id === null ? {} : { rawReceiptId: row.raw_receipt_id }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sameBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

function projectIdFor(request: IntegrationGateway.RenderRequest): string | undefined {
  return request.revisionRef.scope.projectId;
}

export class RenderAttemptRepository {
  async claim(
    trx: RenderTransaction,
    input: {
      readonly attemptId: string;
      readonly context: RenderTransactionContext;
      readonly request: IntegrationGateway.RenderRequest;
    },
  ): Promise<{ readonly record: RenderAttemptRecord; readonly claimed: boolean }> {
    const projectId = projectIdFor(input.request);
    const stableHash = stableKeyHash(input.request.stableIdempotencyKey);
    const requestHash = requestPayloadHash(input.request);
    const inserted = await trx
      .insertInto('integration_gateway.render_attempt')
      .values({
        attempt_id: input.attemptId,
        source_command_id: null,
        enterprise_id: input.context.enterpriseId,
        project_id: projectId ?? null,
        stable_key_hash: stableHash,
        request_payload_hash: requestHash,
        request_payload: JSON.stringify(input.request),
        output_object_ref: null,
        output_checksum: null,
        raw_receipt_id: null,
        error_code: null,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('attempt_id')
      .executeTakeFirst();
    let query = trx
      .selectFrom('integration_gateway.render_attempt')
      .selectAll()
      .where('enterprise_id', '=', input.context.enterpriseId)
      .where('stable_key_hash', '=', stableHash);
    query =
      projectId === undefined
        ? query.where('project_id', 'is', null)
        : query.where('project_id', '=', projectId);
    const row = await query.executeTakeFirst();
    if (row === undefined) {
      throw new RenderPersistenceError(
        INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT,
        'render attempt identity is already bound to another stable key or scope',
      );
    }
    if (row.original_operation !== 'integration.request_render') {
      throw new RenderPersistenceError(
        INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT,
        'Legacy render operation mismatch',
      );
    }
    if (!sameBuffer(row.request_payload_hash, requestHash)) {
      throw new RenderPersistenceError(
        INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT,
        'stable render key is already bound to a different request hash',
      );
    }
    return { record: rowToRecord(row), claimed: inserted !== undefined };
  }

  async getById(
    trx: RenderTransaction,
    attemptId: string,
  ): Promise<RenderAttemptRecord | undefined> {
    const row = await trx
      .selectFrom('integration_gateway.render_attempt')
      .selectAll()
      .where('attempt_id', '=', attemptId)
      .where('original_operation', '=', 'integration.request_render')
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const record = rowToRecord(row);
    if (record.rawReceiptId === undefined) return record;
    const receipt = await trx
      .selectFrom('integration_gateway.raw_external_receipt')
      .select('receipt_content_hash')
      .where('receipt_id', '=', record.rawReceiptId)
      .executeTakeFirst();
    return receipt === undefined
      ? record
      : { ...record, rawReceiptContentHash: publicHash(receipt.receipt_content_hash) };
  }

  async recordSuccess(
    trx: RenderTransaction,
    input: {
      readonly record: RenderCompletionRecord;
      readonly receipt: RenderReceiptInput;
      readonly outputObjectRef: string;
      readonly outputChecksum: Common.ContentHash;
      readonly context: RenderTransactionContext;
      readonly failAfterOutbox?: boolean;
    },
  ): Promise<void> {
    await trx
      .insertInto('integration_gateway.raw_external_receipt')
      .values({
        receipt_id: input.receipt.receiptId,
        enterprise_id: input.record.enterpriseId,
        project_id: input.record.projectId ?? null,
        attempt_id: input.record.attemptId,
        provider_receipt_ref: JSON.stringify(input.receipt.providerReceiptRef),
        receipt_payload_ref: input.receipt.receiptPayloadRef,
        receipt_payload_hash: Buffer.from(input.receipt.receiptPayloadHash.digest, 'hex'),
        receipt_content_hash: Buffer.from(input.receipt.receiptContentHash.digest, 'hex'),
        observed_outcome: 'SUCCEEDED',
        occurred_at: input.receipt.occurredAt ?? null,
        recorded_at: input.receipt.recordedAt,
      })
      .execute();
    await sql`SELECT integration_gateway.transition_render_attempt(
        ${input.record.attemptId}::uuid,
        ${input.record.requestPayloadHash},
        'SUCCEEDED',
        ${input.outputObjectRef},
        ${Buffer.from(input.outputChecksum.digest, 'hex')},
        ${input.receipt.receiptId}::uuid,
        ${null},
        ${input.receipt.recordedAt})`.execute(trx);
    const scope = {
      enterpriseId: input.record.enterpriseId,
      ...(input.record.projectId === undefined ? {} : { projectId: input.record.projectId }),
    };
    const attemptRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: 'integration.render_attempt',
      objectId: input.record.attemptId,
      scope,
    };
    const rawReceiptRef: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'integration.raw_external_receipt',
      objectId: input.receipt.receiptId,
      scope,
      contentHash: input.receipt.receiptContentHash,
    };
    const event = {
      attemptRef,
      revisionRef: input.record.request.revisionRef,
      outputObjectRef: input.outputObjectRef,
      outputChecksum: input.outputChecksum,
      rendererId: input.record.request.rendererId,
      rendererVersion: input.record.request.rendererVersion,
      rawReceiptRef,
    } satisfies IntegrationGateway.RenderSucceededPayload;
    await this.appendOutbox(trx, {
      record: input.record,
      context: input.context,
      eventType: 'integration.RenderSucceeded',
      aggregateVersion: input.record.status === 'UNKNOWN' ? 3 : 2,
      occurredAt: input.receipt.occurredAt ?? input.receipt.recordedAt,
      event: event as unknown as CanonicalJsonObject,
    });
    if (input.failAfterOutbox === true) throw new Error('controlled fault after render outbox');
  }

  async recordFailure(
    trx: RenderTransaction,
    input: {
      readonly record: RenderCompletionRecord;
      readonly status: 'FAILED' | 'UNKNOWN';
      readonly errorCode: string;
      readonly context: RenderTransactionContext;
      readonly occurredAt: Date;
    },
  ): Promise<void> {
    await sql`SELECT integration_gateway.transition_render_attempt(
        ${input.record.attemptId}::uuid,
        ${input.record.requestPayloadHash},
        ${input.status},
        ${null},
        ${null},
        ${null},
        ${input.errorCode},
        ${input.occurredAt})`.execute(trx);
    const scope = {
      enterpriseId: input.record.enterpriseId,
      ...(input.record.projectId === undefined ? {} : { projectId: input.record.projectId }),
    };
    const event = {
      attemptRef: {
        kind: 'OBJECT',
        objectType: 'integration.render_attempt',
        objectId: input.record.attemptId,
        scope,
      },
      revisionRef: input.record.request.revisionRef,
      outcome: input.status,
      reasonCode: input.errorCode,
      rendererId: input.record.request.rendererId,
      rendererVersion: input.record.request.rendererVersion,
    } satisfies IntegrationGateway.RenderFailedPayload;
    await this.appendOutbox(trx, {
      record: input.record,
      context: input.context,
      eventType: 'integration.RenderFailed',
      aggregateVersion: 2,
      occurredAt: input.occurredAt,
      event: event as unknown as CanonicalJsonObject,
    });
  }

  private async appendOutbox(
    trx: RenderTransaction,
    input: {
      readonly record: RenderCompletionRecord;
      readonly context: RenderTransactionContext;
      readonly eventType: string;
      readonly aggregateVersion: number;
      readonly occurredAt: Date;
      readonly event: CanonicalJsonObject;
    },
  ): Promise<void> {
    const payload: CanonicalJsonObject = {
      enterpriseId: input.record.enterpriseId,
      projectId: input.record.projectId ?? null,
      event: input.event,
    };
    await trx
      .insertInto('integration_gateway.outbox_event')
      .values({
        event_id: newUuidV7(),
        event_type: input.eventType,
        event_version: '1.0',
        aggregate_type: 'RenderAttempt',
        aggregate_id: input.record.attemptId,
        aggregate_version: input.aggregateVersion,
        enterprise_id: input.record.enterpriseId,
        project_id: input.record.projectId ?? null,
        correlation_id: input.context.correlationId,
        causation_id: input.context.sourceEventId ?? null,
        payload: JSON.stringify(payload),
        payload_hash: digestJson(payload),
        canonicalization_version: '1',
        occurred_at: input.occurredAt,
        lease_owner: null,
        lease_until: null,
        lease_token: null,
        last_error_code: null,
        published_at: null,
        created_by_principal_id: input.context.principalId,
        source_command_id: input.record.sourceCommandId ?? input.record.attemptId,
      })
      .execute();
  }
}
