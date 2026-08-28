// IM-04 WI-02 (issue #91): Artifact command transaction runner.
// One owning-module transaction: claim receipt -> execute -> technical
// aggregate/CAS + audit + outbox + reference edge -> finalize -> commit.
// Authorization is supplied as a trusted snapshot; this module never reads
// IdentityPolicy or another owning schema.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
  withArtifactTransaction,
  type ArtifactDb,
  type ArtifactTransaction,
  type ArtifactTransactionContext,
} from './artifact-db.js';

export const IDEMPOTENCY_PAYLOAD_CONFLICT = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
export const CONCURRENCY_CONFLICT = 'CONCURRENCY_CONFLICT';
export const COMMAND_IN_PROGRESS = 'COMMAND_IN_PROGRESS';
export const PAYLOAD_HASH_MISMATCH = 'PAYLOAD_HASH_MISMATCH';
export const COMMAND_CONTEXT_MISMATCH = 'COMMAND_CONTEXT_MISMATCH';
export const COMMAND_CONTEXT_EXPIRED = 'COMMAND_CONTEXT_EXPIRED';
export const COMMAND_CONTEXT_REJECTED = 'COMMAND_CONTEXT_REJECTED';
export const COMMAND_TARGET_MISMATCH = 'COMMAND_TARGET_MISMATCH';

/** Typed failure with a stable, safe code and no raw payload echo. */
export class CommandExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

function nextAggregateVersion(expectedVersion: string): string {
  try {
    const parsed = BigInt(expectedVersion);
    if (parsed < 1n) {
      throw new Error('aggregate version must be positive');
    }
    return (parsed + 1n).toString();
  } catch {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'expected aggregate version must be a positive bigint',
    );
  }
}

export interface CommandEnvelope {
  commandId: string;
  commandType: string;
  commandVersion: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestPayload: CanonicalJsonObject;
  enterpriseId: string;
  projectId?: string | undefined;
  targetType: string;
  targetId: string;
  expectedAggregateVersion?: string | undefined;
  correlationId: string;
  causationId?: string | undefined;
  principalId: string;
  principalKind: ArtifactTransactionContext['principalKind'];
  actorSnapshotId: string;
  authorizationDecisionId: string;
  policySnapshotId: string;
}

export interface OutboxEventInput {
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: string;
  payload: CanonicalJsonObject;
  declaredHash?: Buffer;
  occurredAt: Date;
}

export interface ReferenceEdgeInput {
  ownerObjectType: string;
  ownerObjectId: string;
  ownerVersionId?: string | undefined;
  ownerPayloadHash?: Buffer | undefined;
  referencePath: string;
  targetModule: string;
  targetObjectType: string;
  targetObjectId: string;
  targetVersionId?: string | undefined;
  targetPayloadHash?: Buffer | undefined;
  referencePurpose: string;
}

export interface CommandAuditInput {
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  errorCode?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  targetAggregateVersion?: string | undefined;
  safeSummary?: string | undefined;
  requestHash?: Buffer | undefined;
  resultHash?: Buffer | undefined;
}

export type CommandBodyResult =
  | { kind: 'COMMITTED'; resultPayload: CanonicalJsonObject }
  | {
      kind: 'REJECTED';
      errorCode: string;
      safeSummary: string;
      currentAggregateVersion?: string | undefined;
    };

export interface CommandExecution {
  readonly trx: ArtifactTransaction;
  /** CAS on the technical process aggregate until business tables exist. */
  casProcessInstance(
    id: string,
    expectedVersion: string,
    patch?: { state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED' },
  ): Promise<'OK' | 'NOT_FOUND' | 'CONFLICT'>;
  appendOutbox(event: OutboxEventInput): Promise<void>;
  appendReferenceEdge(edge: ReferenceEdgeInput): Promise<void>;
  appendAudit(audit: CommandAuditInput): Promise<void>;
  failAfterOutbox(): never;
}

export type CommandResult =
  | { status: 'COMMITTED'; resultPayload: CanonicalJsonObject; resultPayloadHash: Buffer }
  | {
      status: 'REJECTED';
      errorCode: string;
      safeSummary: string;
      currentAggregateVersion: string | null;
    }
  | {
      status: 'DUPLICATE';
      originalOutcome: 'COMMITTED' | 'REJECTED';
      resultPayload: CanonicalJsonObject | null;
      resultPayloadHash: Buffer | null;
      errorCode: string | null;
    };

/** Binds envelope attribution and scope to the trusted transaction context. */
export function assertEnvelopeMatchesContext(
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
): void {
  const projectAllowed =
    envelope.projectId === undefined || context.allowedProjectIds.includes(envelope.projectId);
  if (
    envelope.principalId !== context.principalId ||
    envelope.principalKind !== context.principalKind ||
    envelope.actorSnapshotId !== context.actorSnapshotId ||
    envelope.authorizationDecisionId !== context.authorizationDecisionId ||
    envelope.policySnapshotId !== context.policySnapshotId ||
    envelope.enterpriseId !== context.enterpriseId ||
    envelope.correlationId !== context.correlationId ||
    !projectAllowed
  ) {
    throw new CommandExecutionError(
      COMMAND_CONTEXT_MISMATCH,
      'command envelope does not match the trusted transaction context',
    );
  }
}

/**
 * Executes one command atomically. Receipt, technical changes, audit,
 * outbox and reference edges commit together or roll back together.
 */
export async function executeArtifactCommand(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
): Promise<CommandResult> {
  assertEnvelopeMatchesContext(context, envelope);
  const requestDigest = digestCanonicalPayload(envelope.requestPayload);

  let outcome: Awaited<ReturnType<typeof runCommandTransaction>>;
  try {
    outcome = await runCommandTransaction(db, context, envelope, requestDigest.hash, body);
  } catch (error) {
    mapTransactionError(error);
  }

  if (outcome.kind === 'PAYLOAD_CONFLICT') {
    throw new CommandExecutionError(
      IDEMPOTENCY_PAYLOAD_CONFLICT,
      'the same idempotency key was already used with a different request payload',
    );
  }
  if (outcome.kind === 'IN_PROGRESS') {
    throw new CommandExecutionError(
      COMMAND_IN_PROGRESS,
      'a command with the same idempotency key is still in flight',
    );
  }
  return outcome.result;
}

async function runCommandTransaction(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
  requestHash: Buffer,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
) {
  return withArtifactTransaction(db, context, async (trx) => {
    const claimed = await claimReceipt(trx, envelope, requestHash);
    if (!claimed) {
      const existing = await readReceipt(trx, envelope);
      if (!existing) {
        throw new CommandExecutionError(
          COMMAND_IN_PROGRESS,
          'the command claim could not be resolved after a concurrent attempt',
        );
      }
      if (!existing.request_payload_hash.equals(requestHash)) {
        await insertAuditRow(trx, envelope, {
          outcome: 'DENIED',
          errorCode: IDEMPOTENCY_PAYLOAD_CONFLICT,
          targetType: envelope.targetType,
          targetId: envelope.targetId,
          targetAggregateVersion: existing.expected_aggregate_version ?? undefined,
          safeSummary: 'same idempotency key replayed with a different request hash',
          requestHash,
        });
        return { kind: 'PAYLOAD_CONFLICT' } as const;
      }
      if (existing.outcome === 'PENDING') {
        return { kind: 'IN_PROGRESS' } as const;
      }
      return {
        kind: 'RESULT',
        result: {
          status: 'DUPLICATE',
          originalOutcome: existing.outcome,
          resultPayload: (existing.result_payload as CanonicalJsonObject | null) ?? null,
          resultPayloadHash: existing.result_payload_hash ?? null,
          errorCode: rejectionErrorCode(existing),
        } satisfies CommandResult,
      } as const;
    }

    const bodyResult = await body(createExecution(trx, envelope));
    if (bodyResult.kind === 'REJECTED') {
      await finalizeReceipt(trx, envelope, {
        outcome: 'REJECTED',
        resultPayload: {
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        },
      });
      await insertAuditRow(trx, envelope, {
        outcome: 'REJECTED',
        errorCode: bodyResult.errorCode,
        targetType: envelope.targetType,
        targetId: envelope.targetId,
        targetAggregateVersion: bodyResult.currentAggregateVersion,
        safeSummary: bodyResult.safeSummary,
        requestHash,
      });
      return {
        kind: 'RESULT',
        result: {
          status: 'REJECTED',
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        } satisfies CommandResult,
      } as const;
    }

    const resultDigest = digestCanonicalPayload(bodyResult.resultPayload);
    await finalizeReceipt(trx, envelope, {
      outcome: 'COMMITTED',
      resultPayload: bodyResult.resultPayload,
    });
    await insertAuditRow(trx, envelope, {
      outcome: 'COMMITTED',
      targetType: envelope.targetType,
      targetId: envelope.targetId,
      requestHash,
      resultHash: resultDigest.hash,
    });
    return {
      kind: 'RESULT',
      result: {
        status: 'COMMITTED',
        resultPayload: bodyResult.resultPayload,
        resultPayloadHash: resultDigest.hash,
      } satisfies CommandResult,
    } as const;
  });
}

interface ReceiptFacts {
  request_payload_hash: Buffer;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED';
  result_payload: unknown;
  result_payload_hash: Buffer | null;
  expected_aggregate_version: string | null;
}

async function readReceipt(
  trx: ArtifactTransaction,
  envelope: CommandEnvelope,
): Promise<ReceiptFacts | undefined> {
  return (await trx
    .selectFrom('artifact.command_receipt')
    .selectAll()
    .where('idempotency_scope', '=', envelope.idempotencyScope)
    .where('idempotency_key', '=', envelope.idempotencyKey)
    .executeTakeFirst()) as ReceiptFacts | undefined;
}

async function claimReceipt(
  trx: ArtifactTransaction,
  envelope: CommandEnvelope,
  requestHash: Buffer,
): Promise<boolean> {
  const inserted = await trx
    .insertInto('artifact.command_receipt')
    .values({
      command_id: envelope.commandId,
      command_type: envelope.commandType,
      command_version: envelope.commandVersion,
      idempotency_scope: envelope.idempotencyScope,
      idempotency_key: envelope.idempotencyKey,
      request_payload_hash: requestHash,
      enterprise_id: envelope.enterpriseId,
      project_id: envelope.projectId ?? null,
      target_type: envelope.targetType,
      target_id: envelope.targetId,
      expected_aggregate_version: envelope.expectedAggregateVersion ?? null,
      outcome: 'PENDING',
      correlation_id: envelope.correlationId,
      causation_id: envelope.causationId ?? null,
      created_by_principal_id: envelope.principalId,
      actor_snapshot_id: envelope.actorSnapshotId,
      authorization_decision_id: envelope.authorizationDecisionId,
    })
    .onConflict((conflict) =>
      conflict.columns(['idempotency_scope', 'idempotency_key']).doNothing(),
    )
    .returning('command_id')
    .executeTakeFirst();
  return inserted !== undefined;
}

async function finalizeReceipt(
  trx: ArtifactTransaction,
  envelope: CommandEnvelope,
  final: {
    outcome: 'COMMITTED' | 'REJECTED';
    resultPayload: CanonicalJsonObject;
  },
): Promise<void> {
  const resultDigest = digestCanonicalPayload(final.resultPayload);
  await trx
    .updateTable('artifact.command_receipt')
    .set({
      outcome: final.outcome,
      completed_at: new Date(),
      result_payload: resultDigest.canonicalJson,
      result_payload_hash: resultDigest.hash,
    })
    .where('command_id', '=', envelope.commandId)
    .execute();
}

function createExecution(trx: ArtifactTransaction, envelope: CommandEnvelope): CommandExecution {
  return {
    trx,
    async casProcessInstance(id, expectedVersion, patch = {}) {
      if (id !== envelope.targetId || expectedVersion !== envelope.expectedAggregateVersion) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target and expected version must match the command envelope',
        );
      }
      const nextVersion = nextAggregateVersion(expectedVersion);
      const updated = await trx
        .updateTable('artifact.process_instance')
        .set({
          aggregate_version: nextVersion,
          updated_at: new Date(),
          ...(patch.state === undefined ? {} : { state: patch.state }),
        })
        .where('process_id', '=', id)
        .where('aggregate_version', '=', expectedVersion)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 1) {
        return 'OK';
      }
      const visible = await trx
        .selectFrom('artifact.process_instance')
        .select(['aggregate_version'])
        .where('process_id', '=', id)
        .executeTakeFirst();
      return visible ? 'CONFLICT' : 'NOT_FOUND';
    },
    async appendOutbox(event) {
      const expectedEventVersion =
        envelope.expectedAggregateVersion === undefined
          ? '1'
          : nextAggregateVersion(envelope.expectedAggregateVersion);
      if (
        event.aggregateType !== envelope.targetType ||
        event.aggregateId !== envelope.targetId ||
        event.aggregateVersion !== expectedEventVersion
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'event aggregate identity and version must match the command target',
        );
      }
      if (
        event.payload.enterpriseId !== envelope.enterpriseId ||
        (event.payload.projectId ?? null) !== (envelope.projectId ?? null)
      ) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'event payload scope mirror does not match the command scope',
        );
      }
      const digest = digestCanonicalPayload(event.payload);
      if (event.declaredHash && !event.declaredHash.equals(digest.hash)) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'declared event hash does not match the canonical payload',
        );
      }
      await trx
        .insertInto('artifact.outbox_event')
        .values({
          event_id: event.eventId,
          event_type: event.eventType,
          event_version: event.eventVersion,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          aggregate_version: event.aggregateVersion,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          correlation_id: envelope.correlationId,
          causation_id: envelope.causationId ?? null,
          payload: digest.canonicalJson,
          payload_hash: digest.hash,
          canonicalization_version: digest.canonicalizationVersion,
          occurred_at: event.occurredAt,
          created_by_principal_id: envelope.principalId,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendReferenceEdge(edge) {
      if (
        edge.ownerObjectType !== envelope.targetType ||
        edge.ownerObjectId !== envelope.targetId
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'reference edge owner must match the command target',
        );
      }
      if (edge.ownerPayloadHash !== undefined && edge.ownerPayloadHash.length !== 32) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'owner payload hash must be 32 bytes',
        );
      }
      if (edge.targetPayloadHash !== undefined && edge.targetPayloadHash.length !== 32) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'target payload hash must be 32 bytes',
        );
      }
      await trx
        .insertInto('artifact.reference_edge')
        .values({
          owner_object_type: edge.ownerObjectType,
          owner_object_id: edge.ownerObjectId,
          owner_version_id: edge.ownerVersionId ?? null,
          owner_payload_hash: edge.ownerPayloadHash ?? null,
          reference_path: edge.referencePath,
          target_module: edge.targetModule,
          target_object_type: edge.targetObjectType,
          target_object_id: edge.targetObjectId,
          target_version_id: edge.targetVersionId ?? null,
          target_payload_hash: edge.targetPayloadHash ?? null,
          reference_purpose: edge.referencePurpose,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendAudit(audit) {
      await insertAuditRow(trx, envelope, audit);
    },
    failAfterOutbox(): never {
      throw new CommandExecutionError('INJECTED_FAULT', 'controlled fault after outbox write');
    },
  };
}

async function insertAuditRow(
  trx: ArtifactTransaction,
  envelope: CommandEnvelope,
  audit: CommandAuditInput,
): Promise<void> {
  await trx
    .insertInto('artifact.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: envelope.enterpriseId,
      project_id: envelope.projectId ?? null,
      principal_id: envelope.principalId,
      actor_snapshot_id: envelope.actorSnapshotId,
      authorization_decision_id: envelope.authorizationDecisionId,
      command_id: envelope.commandId,
      command_type: envelope.commandType,
      outcome: audit.outcome,
      error_code: audit.errorCode ?? null,
      request_payload_hash: audit.requestHash ?? null,
      result_payload_hash: audit.resultHash ?? null,
      target_type: audit.targetType ?? null,
      target_id: audit.targetId ?? null,
      target_aggregate_version: audit.targetAggregateVersion ?? null,
      correlation_id: envelope.correlationId,
      causation_id: envelope.causationId ?? null,
      safe_summary: audit.safeSummary ?? null,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

function rejectionErrorCode(receipt: ReceiptFacts): string | null {
  const payload = receipt.result_payload as { errorCode?: unknown } | null;
  return typeof payload?.errorCode === 'string' ? payload.errorCode : null;
}

function mapTransactionError(error: unknown): never {
  if (error instanceof CommandExecutionError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : '';
  if (/authorization decision is expired/i.test(message)) {
    throw new CommandExecutionError(COMMAND_CONTEXT_EXPIRED, 'authorization decision is expired');
  }
  if (
    /invalid context kind|incomplete transaction context|missing authorization decision|hash must be 32 bytes|event consumer context|null project scope|request context must not carry/i.test(
      message,
    )
  ) {
    throw new CommandExecutionError(COMMAND_CONTEXT_REJECTED, 'transaction context was rejected');
  }
  throw error;
}
