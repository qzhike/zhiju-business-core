/* eslint-disable no-control-regex -- The approved intake contract explicitly rejects ASCII control characters. */
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime boundaries revalidate untrusted transport and persisted values. */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Common } from '@zhiju/contracts';
import {
  PreparationError,
  assertPreparationCommand,
  assertPreparationClosed,
  assertPreparationHash,
  preparationHash,
  samePreparationValue,
  type PreparationSession,
  type PreparationProjectScope,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import type {
  CustomerZipIntakePayload,
  CustomerZipRestartPayload,
  CustomerZipQuery,
} from '@zhiju/contracts';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { createCustomerZipTicketCodec } from './upload-ticket.js';
import {
  CustomerZipTicketError,
  type EncryptedCustomerZipTicket,
  type CustomerZipTicketBinding,
} from './upload-ticket.js';
import type { createCustomerZipPolicyRegistry } from './policy.js';
import type { CustomerZipPolicyArtifact } from './policy.js';
import { scanCustomerZip, CustomerZipSafetyError, type ScannedZipEntry } from './zip-safety.js';

type Ref = Common.ObjectRef;
type Hash = Common.ContentHash;
export interface CustomerZipAuthorizationContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly actorSnapshotId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationDecisionHash: Buffer;
  readonly authorizationDecisionExpiresAt: Date;
  readonly enterpriseId: string;
  readonly allowedProjectIds: readonly string[];
  readonly correlationId: string;
}
export interface CustomerZipObjectReceipt {
  readonly key: string;
  readonly sha256: string;
  readonly byteLength: number;
}
export interface CustomerZipObjectStore {
  /** Durable isolated object, idempotent for the same key and exact bytes. */
  put(key: string, bytes: Uint8Array): Promise<CustomerZipObjectReceipt>;
  read(key: string): Promise<Uint8Array>;
  /** UNKNOWN must be returned whenever absence cannot be proven. */
  inspect(key: string): Promise<{
    readonly state: 'ABSENT' | 'COMPLETE' | 'UNKNOWN';
    readonly receipt?: CustomerZipObjectReceipt;
  }>;
}
export interface CustomerZipSourceInput {
  readonly intakeRef: Ref;
  readonly submissionPayloadHash: Hash;
  readonly scopeRef: PreparationProjectScope;
  readonly creatorId: string;
  readonly sourceId: string;
  readonly validationId: string;
  readonly registerCommandId: string;
  readonly validateCommandId: string;
  readonly acceptCommandId: string;
  readonly kind: 'ZIP' | 'ENTRY' | 'NOTE';
  readonly ordinal?: number;
  readonly originalName: string;
  readonly mediaType: string;
  readonly bytesSha256: Hash;
  readonly byteLength: number;
  readonly objectRef: CustomerZipObjectReceipt;
  readonly validation: {
    readonly safety: 'PASS';
    readonly integrity: 'PASS';
    readonly analyzable: boolean;
  };
}
export interface CustomerZipSourceResult {
  readonly sourceRef: Common.ContentAddressedRef;
  readonly validationRef: Common.ContentAddressedRef;
  readonly receiptRefs: readonly Common.TypedReference[];
}
export interface CustomerZipOwnerPorts {
  resolvePreparation(
    session: PreparationSession,
    input: {
      readonly preparationRequestRef: Ref;
      readonly originalPreparationKey: string;
      readonly projectRef: Ref;
      readonly intakeRef: Ref;
      readonly intakePayloadHash: Hash;
    },
  ): Promise<{
    readonly creatorId: string;
    readonly scopeRef: PreparationProjectScope;
    readonly preparationPresetRef: Common.VersionedRef;
    readonly preparationPresetHash: Hash;
    readonly intakePolicyRef: Common.VersionedRef;
    readonly intakePolicyHash: Hash;
    readonly sourceWatermarks: readonly unknown[];
  }>;
  acceptSource(
    session: PreparationSession,
    input: CustomerZipSourceInput,
  ): Promise<CustomerZipSourceResult>;
  sourceLinks(session: PreparationSession, intakeRef: Ref): Promise<{ readonly hasLinks: boolean }>;
  acceptHandoff(input: {
    readonly eventId: string;
    readonly intakeRef: Ref;
    readonly manifestRef: Common.SnapshotRef;
    readonly submissionPayloadHash: Hash;
  }): Promise<unknown>;
  queryHandoff(session: PreparationSession, intakeRef: Ref): Promise<unknown>;
}
interface Step {
  input?: CustomerZipSourceInput;
  sourceId: string;
  validationId: string;
  registerCommandId: string;
  validateCommandId: string;
  acceptCommandId: string;
  result?: CustomerZipSourceResult;
  object?: CustomerZipObjectReceipt;
}
interface State {
  aggregateVersion: number;
  generation: 1 | 2;
  restartsUsed: 0 | 1;
  ticket: EncryptedCustomerZipTicket;
  uploadState: 'ISSUED' | 'RECEIVING' | 'CLOSED_NO_OBJECT' | 'STAGED' | 'UNKNOWN';
  custody: 'RECEIVING' | 'STAGED' | 'EXTRACTING' | 'READY' | 'PARTIAL' | 'FAILED' | 'UNKNOWN';
  reasonCodes: string[];
  terminalContentFailure?: true;
  fence: string;
  streamClosed: boolean;
  steps: Record<string, Step>;
  object?: CustomerZipObjectReceipt;
  restartCommand?: WorkspaceCommandInput<CustomerZipRestartPayload>;
  restartReceiptRef?: Ref;
  manifestRef?: Common.SnapshotRef;
  manifest?: Record<string, unknown>;
  eventId?: string;
  receiptRefs: Common.TypedReference[];
  provenance: {
    intake: CustomerZipAuthorizationContext;
    analysis: CustomerZipAuthorizationContext;
  };
}
interface Row {
  intake_id: string;
  enterprise_id: string;
  project_id: string;
  preparation_request_id: string;
  creator_id: string;
  original_command: WorkspaceCommandInput<CustomerZipIntakePayload>;
  payload_hash: Buffer;
  original_key: string;
  aggregate_version: string;
  generation: number;
  state: State;
}
const scope = (row: Row): PreparationProjectScope => ({
  enterpriseId: row.enterprise_id,
  projectId: row.project_id,
});
function objectRef(type: string, id: string, s: PreparationProjectScope): Ref {
  return { kind: 'OBJECT', objectType: type, objectId: id, scope: s };
}
function byteHash(bytes: Uint8Array): Hash {
  return {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: createHash('sha256').update(bytes).digest('hex'),
  };
}
function fail(code: string): never {
  throw new PreparationError(code);
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function createCustomerZipIntakeService(config: {
  readonly pool: Pool;
  readonly ticketCodec: ReturnType<typeof createCustomerZipTicketCodec>;
  readonly policyResolver: ReturnType<typeof createCustomerZipPolicyRegistry>;
  readonly verifySession: (session: PreparationSession) => Promise<void>;
  readonly authorize: (
    session: PreparationSession,
    input: {
      purpose: string;
      scopeRef: PreparationProjectScope;
      targetRef: Ref;
      payloadHash: Hash;
      correlationId: string;
    },
  ) => Promise<CustomerZipAuthorizationContext>;
  readonly owners: CustomerZipOwnerPorts;
  readonly objectStore: CustomerZipObjectStore;
  readonly clock?: () => Date;
  readonly newId?: () => string;
}) {
  const now = config.clock ?? (() => new Date());
  const id = config.newId ?? newUuidV7;
  async function resolveUploadScope(
    session: PreparationSession,
    intakeId: string,
  ): Promise<PreparationProjectScope> {
    await config.verifySession(session);
    const client = await config.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE integration_gateway_app');
      const record = (
        await client.query<{ enterprise_id: string; project_id: string }>(
          'SELECT * FROM integration_gateway.lookup_customer_zip_scope($1,$2)',
          [intakeId, session.principalId],
        )
      ).rows[0];
      await client.query('COMMIT');
      if (!record) fail('AUTHORIZATION_DENIED');
      return { enterpriseId: record.enterprise_id, projectId: record.project_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function transaction<T>(
    context: CustomerZipAuthorizationContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await config.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await client.query(
        'SELECT platform_security.establish_transaction_context($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          context.kind,
          context.principalId,
          context.actorSnapshotId,
          context.authorizationDecisionId,
          context.authorizationDecisionHash,
          context.authorizationDecisionExpiresAt,
          context.enterpriseId,
          context.allowedProjectIds,
          context.correlationId,
          null,
        ],
      );
      await client.query('SET LOCAL ROLE integration_gateway_app');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function auth(
    session: PreparationSession,
    purpose: string,
    s: PreparationProjectScope,
    target: Ref,
    hash: Hash,
    correlationId: string,
  ) {
    await config.verifySession(session);
    return config.authorize(session, {
      purpose,
      scopeRef: s,
      targetRef: target,
      payloadHash: hash,
      correlationId,
    });
  }
  async function both(
    session: PreparationSession,
    purpose: string,
    s: PreparationProjectScope,
    target: Ref,
    hash: Hash,
    correlationId: string,
  ) {
    const intake = await auth(session, purpose, s, target, hash, correlationId);
    const analysis = await auth(
      session,
      'project.preparation.analysis.admit',
      s,
      target,
      hash,
      correlationId,
    );
    return { intake, analysis };
  }
  async function load(
    client: PoolClient,
    intakeId: string,
    lock = false,
    creatorId?: string,
  ): Promise<Row> {
    const result = await client.query<Row>(
      `SELECT * FROM integration_gateway.customer_zip_intake WHERE intake_id=$1${creatorId ? ' AND creator_id=$2' : ''}${lock ? ' FOR UPDATE' : ''}`,
      creatorId ? [intakeId, creatorId] : [intakeId],
    );
    const row = result.rows[0] ?? fail('NOT_FOUND');
    if (
      !Number.isSafeInteger(row.state.aggregateVersion) ||
      row.state.aggregateVersion < 1 ||
      BigInt(row.aggregate_version) !== BigInt(row.state.aggregateVersion)
    )
      fail('INTEGRATION_INTAKE_VERSION_INVALID');
    return row;
  }
  function owner(session: PreparationSession, row: Row) {
    if (
      !Number.isSafeInteger(row.state.aggregateVersion) ||
      row.state.aggregateVersion < 1 ||
      BigInt(row.aggregate_version) !== BigInt(row.state.aggregateVersion)
    )
      fail('INTEGRATION_INTAKE_VERSION_INVALID');
    if (row.creator_id !== session.principalId) fail('AUTHORIZATION_DENIED');
  }
  function binding(row: Row): CustomerZipTicketBinding {
    const p = row.original_command.payload;
    return {
      intakeId: row.intake_id,
      creatorId: row.creator_id,
      enterpriseId: row.enterprise_id,
      projectId: row.project_id,
      submissionPayloadHash: row.original_command.integrity.payloadHash.digest,
      zipBytesSha256: p.zipBytesSha256.digest,
      declaredByteLength: p.declaredByteLength,
      generation: row.state.generation,
    };
  }
  function replayTicket(row: Row) {
    try {
      return config.ticketCodec.replay(binding(row), row.state.ticket, now());
    } catch (error) {
      if (
        error instanceof CustomerZipTicketError &&
        error.code === 'INTEGRATION_ZIP_TICKET_EXPIRED'
      )
        return undefined;
      throw error;
    }
  }
  async function save(client: PoolClient, row: Row) {
    row.state.aggregateVersion += 1;
    if (!Number.isSafeInteger(row.state.aggregateVersion))
      fail('INTEGRATION_INTAKE_VERSION_INVALID');
    row.aggregate_version = String(row.state.aggregateVersion);
    await client.query(
      'UPDATE integration_gateway.customer_zip_intake SET aggregate_version=$2,generation=$3,state=$4::jsonb WHERE intake_id=$1',
      [row.intake_id, row.state.aggregateVersion, row.state.generation, JSON.stringify(row.state)],
    );
  }
  async function receipt(
    client: PoolClient,
    row: Row,
    command: WorkspaceCommandInput<unknown>,
    context: CustomerZipAuthorizationContext,
    result: unknown,
  ) {
    await client.query(
      `INSERT INTO integration_gateway.command_receipt(command_id,command_type,command_version,idempotency_scope,idempotency_key,request_payload_hash,enterprise_id,project_id,target_type,target_id,expected_aggregate_version,outcome,result_payload,result_payload_hash,completed_at,correlation_id,created_by_principal_id,actor_snapshot_id,authorization_decision_id) VALUES($1,$2,'1.0',$3,$4,$5,$6,$7,$8,$9,$10,'COMMITTED',$11::jsonb,$12,$13,$14,$15,$16,$17)`,
      [
        command.commandId,
        command.type,
        `${row.enterprise_id}:${row.project_id}:${command.type}`,
        command.idempotencyKey,
        Buffer.from(command.integrity.payloadHash.digest, 'hex'),
        row.enterprise_id,
        row.project_id,
        command.targetRef.objectType,
        row.intake_id,
        command.expectedAggregateVersion ?? null,
        JSON.stringify(result),
        Buffer.from(preparationHash(result).digest, 'hex'),
        now(),
        command.correlationId,
        context.principalId,
        context.actorSnapshotId,
        context.authorizationDecisionId,
      ],
    );
  }
  function validatePayload(payload: CustomerZipIntakePayload, s: PreparationProjectScope) {
    assertPreparationClosed(
      payload,
      [
        'projectRef',
        'preparationRequestRef',
        'originalPreparationKey',
        'preparationPresetRef',
        'preparationPresetHash',
        'originalName',
        'declaredByteLength',
        'zipBytesSha256',
        'intakePolicyRef',
        'intakePolicyHash',
        'analysisIntent',
      ],
      ['submittedNote'],
    );
    if (
      payload.analysisIntent !== 'ANALYZE' ||
      typeof payload.originalPreparationKey !== 'string' ||
      !payload.originalPreparationKey ||
      typeof payload.originalName !== 'string' ||
      !payload.originalName ||
      Buffer.byteLength(payload.originalName) > 1024 ||
      /[\x00-\x1f\x7f]/u.test(payload.originalName) ||
      !Number.isSafeInteger(payload.declaredByteLength) ||
      payload.declaredByteLength < 1 ||
      payload.declaredByteLength > 104857600
    )
      fail('API_VALUE_INVALID');
    for (const ref of [payload.projectRef, payload.preparationRequestRef])
      if (!samePreparationValue(ref.scope, s)) fail('SCOPE_MISMATCH');
    if (
      payload.projectRef.objectId !== s.projectId ||
      payload.projectRef.objectType !== 'zhiju.project.project' ||
      payload.preparationRequestRef.objectType !== 'zhiju.project.preparation_request'
    )
      fail('SCOPE_MISMATCH');
    for (const hash of [
      payload.zipBytesSha256,
      payload.preparationPresetHash,
      payload.intakePolicyHash,
    ])
      assertPreparationHash(hash);
    if (
      payload.submittedNote !== undefined &&
      (typeof payload.submittedNote !== 'string' ||
        !payload.submittedNote ||
        Array.from(payload.submittedNote).length > 4096 ||
        Buffer.byteLength(payload.submittedNote) > 16384 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(payload.submittedNote))
    )
      fail('API_VALUE_INVALID');
  }
  async function preparation(
    session: PreparationSession,
    command: WorkspaceCommandInput<CustomerZipIntakePayload>,
  ): Promise<CustomerZipPolicyArtifact> {
    const p = command.payload;
    const b = await config.owners.resolvePreparation(session, {
      preparationRequestRef: p.preparationRequestRef,
      originalPreparationKey: p.originalPreparationKey,
      projectRef: p.projectRef,
      intakeRef: command.targetRef,
      intakePayloadHash: command.integrity.payloadHash,
    });
    if (
      b.creatorId !== session.principalId ||
      !samePreparationValue(b.scopeRef, command.scopeRef) ||
      !samePreparationValue(b.preparationPresetRef, p.preparationPresetRef) ||
      !samePreparationValue(b.preparationPresetHash, p.preparationPresetHash) ||
      !samePreparationValue(b.intakePolicyRef, p.intakePolicyRef) ||
      !samePreparationValue(b.intakePolicyHash, p.intakePolicyHash)
    )
      fail('INTEGRATION_PREPARATION_PROFILE_UNAVAILABLE');
    return config.policyResolver.resolve(
      p.intakePolicyRef as unknown as Record<string, unknown>,
      p.intakePolicyHash,
    );
  }
  async function request(
    session: PreparationSession,
    command: WorkspaceCommandInput<CustomerZipIntakePayload>,
  ) {
    assertPreparationCommand(
      command,
      'integration.request_customer_zip_intake',
      'zhiju.integration.customer_zip_intake',
      'CREATE',
    );
    validatePayload(command.payload, command.scopeRef);
    const provenance = await both(
      session,
      'integration.customer_zip.intake',
      command.scopeRef,
      command.targetRef,
      command.integrity.payloadHash,
      command.correlationId,
    );
    await preparation(session, command);
    let resume = false;
    const result = await transaction(provenance.intake, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        command.payload.preparationRequestRef.objectId,
      ]);
      const existing = (
        await client.query<Row>(
          'SELECT * FROM integration_gateway.customer_zip_intake WHERE (intake_id=$1 OR preparation_request_id=$2 OR original_key=$3) AND creator_id=$4 FOR UPDATE',
          [
            command.targetRef.objectId,
            command.payload.preparationRequestRef.objectId,
            command.idempotencyKey,
            session.principalId,
          ],
        )
      ).rows[0];
      if (existing) {
        owner(session, existing);
        if (!samePreparationValue(existing.original_command, command))
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        resume = existing.state.uploadState === 'STAGED';
        return requestResult(existing, 'IDEMPOTENT_REPLAY');
      }
      const row: Row = {
        intake_id: command.targetRef.objectId,
        enterprise_id: command.scopeRef.enterpriseId,
        project_id: command.scopeRef.projectId,
        preparation_request_id: command.payload.preparationRequestRef.objectId,
        creator_id: session.principalId,
        original_command: clone(command),
        payload_hash: Buffer.from(command.integrity.payloadHash.digest, 'hex'),
        original_key: command.idempotencyKey,
        aggregate_version: '1',
        generation: 1,
        state: {
          aggregateVersion: 1,
          generation: 1,
          restartsUsed: 0,
          ticket: {} as EncryptedCustomerZipTicket,
          uploadState: 'ISSUED',
          custody: 'RECEIVING',
          reasonCodes: [],
          fence: id(),
          streamClosed: true,
          steps: {},
          receiptRefs: [
            objectRef('zhiju.integration.command_receipt', command.commandId, command.scopeRef),
          ],
          provenance,
        },
      };
      row.state.ticket = config.ticketCodec.issue(binding(row), now());
      await client.query(
        'INSERT INTO integration_gateway.customer_zip_intake(intake_id,enterprise_id,project_id,preparation_request_id,creator_id,original_command,payload_hash,original_key,aggregate_version,generation,state,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,1,1,$9::jsonb,$10)',
        [
          row.intake_id,
          row.enterprise_id,
          row.project_id,
          row.preparation_request_id,
          row.creator_id,
          JSON.stringify(command),
          row.payload_hash,
          row.original_key,
          JSON.stringify(row.state),
          now(),
        ],
      );
      await receipt(client, row, command, provenance.intake, {
        intakeRef: command.targetRef,
        generation: 1,
        expiresAt: row.state.ticket.expiresAt,
      });
      return requestResult(row, 'ACCEPTED');
    });
    if (resume) {
      // An explicit original-command replay resumes only the original server steps.
      // Custody remains committed if a downstream dependency is unavailable.
      try {
        await processStaged(session, command.targetRef.objectId);
      } catch {
        /* Query exposes the unchanged actual custody and owner receipts. */
      }
    }
    return result;
  }
  function requestResult(row: Row, disposition: string) {
    const upload = replayTicket(row);
    return {
      intakeRef: row.original_command.targetRef,
      originalCommandId: row.original_command.commandId,
      originalKey: row.original_key,
      payloadHash: row.original_command.integrity.payloadHash,
      receiptRef: row.state.receiptRefs[0],
      ...(upload ? { upload } : {}),
      disposition,
      analysis: { status: 'WAITING_INPUT' },
    };
  }
  async function get(session: PreparationSession, query: CustomerZipQuery) {
    const selector = query.payload;
    assertPreparationClosed(
      selector,
      selector.by === 'INTAKE'
        ? ['by', 'intakeRef']
        : ['by', 'preparationRequestRef', 'originalPreparationKey'],
    );
    const target = selector.by === 'INTAKE' ? selector.intakeRef : selector.preparationRequestRef;
    if (!samePreparationValue(target.scope, query.scopeRef)) fail('SCOPE_MISMATCH');
    const context = await auth(
      session,
      'integration.customer_zip.read',
      query.scopeRef,
      target,
      preparationHash(selector),
      query.correlationId,
    );
    const row = await transaction(context, async (client) => {
      if (selector.by === 'INTAKE')
        return load(client, selector.intakeRef.objectId, false, session.principalId);
      if (selector.by !== 'PREPARATION_REQUEST') fail('API_VALUE_INVALID');
      const r = (
        await client.query<Row>(
          "SELECT * FROM integration_gateway.customer_zip_intake WHERE preparation_request_id=$1 AND original_command->'payload'->>'originalPreparationKey'=$2 AND creator_id=$3",
          [
            selector.preparationRequestRef.objectId,
            selector.originalPreparationKey,
            session.principalId,
          ],
        )
      ).rows[0];
      return r ?? fail('NOT_FOUND');
    });
    owner(session, row);
    let canRestart = false;
    try {
      await both(
        session,
        'integration.customer_zip.restart',
        scope(row),
        row.original_command.targetRef,
        row.original_command.integrity.payloadHash,
        query.correlationId,
      );
      canRestart = await restartProof(session, row);
    } catch {
      /* Current eligibility fails closed; Query does not mutate. */
    }
    let analysis: unknown = { status: 'WAITING_INPUT' };
    if (row.state.manifestRef) {
      try {
        analysis = await config.owners.queryHandoff(session, row.original_command.targetRef);
        if (
          analysis &&
          typeof analysis === 'object' &&
          'status' in analysis &&
          analysis.status === 'NOT_OBSERVED'
        )
          analysis = { ...analysis, status: 'PENDING' };
      } catch {
        analysis = { status: 'UNKNOWN', reasonCodes: ['DEPENDENCY_UNAVAILABLE'] };
      }
    }
    return {
      intakeRef: row.original_command.targetRef,
      aggregateVersion: row.state.aggregateVersion,
      preparationRequestRef: row.original_command.payload.preparationRequestRef,
      originalCommand: row.original_command,
      originalKey: row.original_key,
      payloadHash: row.original_command.integrity.payloadHash,
      ...(row.state.restartCommand ? { restartCommand: row.state.restartCommand } : {}),
      ...(row.original_command.payload.submittedNote !== undefined
        ? { submittedNote: row.original_command.payload.submittedNote }
        : {}),
      analysisIntent: 'ANALYZE',
      uploadState: {
        generation: row.state.generation,
        state: canRestart ? 'CLOSED_NO_OBJECT' : row.state.uploadState,
        restartsUsed: row.state.restartsUsed,
        expiresAt: row.state.ticket.expiresAt,
        reasonCodes: row.state.reasonCodes,
      },
      custody: {
        status: row.state.custody,
        receiptRefs: row.state.receiptRefs,
        ...(row.state.manifestRef ? { manifestRef: row.state.manifestRef } : {}),
        ...(row.state.manifest ? { entries: row.state.manifest.entries } : {}),
        reasonCodes: row.state.reasonCodes,
      },
      analysis,
      allowedActions: canRestart ? ['RESTART'] : [],
      sourceWatermarks: [
        {
          sourceModule: 'zhiju.integration_gateway',
          partition: row.intake_id,
          sequence: row.state.aggregateVersion,
          observedAt: now().toISOString(),
        },
      ],
    };
  }
  async function restartProof(session: PreparationSession, row: Row) {
    if (
      row.state.terminalContentFailure === true ||
      row.state.generation !== 1 ||
      row.state.restartsUsed !== 0 ||
      !(
        row.state.uploadState === 'CLOSED_NO_OBJECT' ||
        (row.state.uploadState === 'ISSUED' &&
          now().getTime() >= Date.parse(row.state.ticket.expiresAt))
      ) ||
      !row.state.streamClosed ||
      row.state.object ||
      row.state.manifestRef ||
      Object.values(row.state.steps).some((s) => s.result)
    )
      return false;
    const observed = await config.objectStore.inspect(`customer-zip/${row.intake_id}/1/original`);
    if (observed.state !== 'ABSENT') return false;
    return !(await config.owners.sourceLinks(session, row.original_command.targetRef)).hasLinks;
  }
  async function restart(
    session: PreparationSession,
    command: WorkspaceCommandInput<CustomerZipRestartPayload>,
  ) {
    assertPreparationCommand(
      command,
      'integration.restart_customer_zip_upload',
      'zhiju.integration.customer_zip_intake',
      'MUTATE',
    );
    assertPreparationClosed(command.payload, [
      'intakeRef',
      'originalKey',
      'originalPayloadHash',
      'expectedUploadGeneration',
    ]);
    if (!samePreparationValue(command.targetRef, command.payload.intakeRef)) fail('SCOPE_MISMATCH');
    const provenance = await both(
      session,
      'integration.customer_zip.restart',
      command.scopeRef,
      command.targetRef,
      command.integrity.payloadHash,
      command.correlationId,
    );
    await auth(
      session,
      'integration.customer_zip.read',
      command.scopeRef,
      command.targetRef,
      command.integrity.payloadHash,
      command.correlationId,
    );
    return transaction(provenance.intake, async (client) => {
      const row = await load(client, command.targetRef.objectId, true, session.principalId);
      owner(session, row);
      if (row.state.restartCommand) {
        if (!samePreparationValue(row.state.restartCommand, command))
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return restartResult(row);
      }
      if (row.state.restartsUsed !== 0) fail('INTEGRATION_ZIP_UPLOAD_RESTART_EXHAUSTED');
      if (
        command.expectedAggregateVersion !== row.state.aggregateVersion ||
        command.payload.expectedUploadGeneration !== row.state.generation
      )
        fail('INTEGRATION_ZIP_UPLOAD_GENERATION_CONFLICT');
      if (
        command.payload.originalKey !== row.original_key ||
        !samePreparationValue(
          command.payload.originalPayloadHash,
          row.original_command.integrity.payloadHash,
        )
      )
        fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
      if (!(await restartProof(session, row))) fail('INTEGRATION_ZIP_UPLOAD_RESTART_NOT_ALLOWED');
      await preparation(session, row.original_command);
      row.state.generation = 2;
      row.state.restartsUsed = 1;
      row.state.uploadState = 'ISSUED';
      row.state.fence = id();
      row.state.reasonCodes = [];
      row.state.restartCommand = clone(command);
      row.state.restartReceiptRef = objectRef(
        'zhiju.integration.command_receipt',
        command.commandId,
        scope(row),
      );
      row.state.provenance = provenance;
      row.state.ticket = config.ticketCodec.issue(binding(row), now());
      await save(client, row);
      await receipt(client, row, command, provenance.intake, {
        intakeRef: command.targetRef,
        generation: 2,
        expiresAt: row.state.ticket.expiresAt,
      });
      return restartResult(row);
    });
  }
  function restartResult(row: Row) {
    const upload = replayTicket(row);
    return {
      intakeRef: row.original_command.targetRef,
      originalKey: row.original_key,
      originalPayloadHash: row.original_command.integrity.payloadHash,
      ...(upload ? { upload } : {}),
      receiptRef: row.state.restartReceiptRef,
    };
  }
  async function upload(
    session: PreparationSession,
    input: {
      readonly intakeId: string;
      readonly token: string;
      readonly stream: AsyncIterable<Uint8Array>;
      readonly contentLength?: number;
      readonly range?: string;
      readonly contentEncoding?: string;
    },
  ) {
    if (
      input.range !== undefined ||
      input.contentEncoding !== undefined ||
      (input.contentLength !== undefined && !Number.isSafeInteger(input.contentLength))
    )
      fail('API_VALUE_INVALID');
    await config.verifySession(session);
    const s = await resolveUploadScope(session, input.intakeId),
      target = objectRef('zhiju.integration.customer_zip_intake', input.intakeId, s);
    const authorization = await both(
      session,
      'integration.customer_zip.intake',
      s,
      target,
      preparationHash({ intakeRef: target }),
      id(),
    );
    const row = await transaction(authorization.intake, async (client) => {
      const current = await load(client, input.intakeId, true);
      owner(session, current);
      config.ticketCodec.verify(binding(current), current.state.ticket, input.token, now());
      if (
        input.contentLength !== undefined &&
        input.contentLength !== current.original_command.payload.declaredByteLength
      )
        fail('INTEGRATION_ZIP_CORRUPT');
      if (current.state.uploadState !== 'ISSUED')
        fail('INTEGRATION_ZIP_UPLOAD_GENERATION_CONFLICT');
      current.state.uploadState = 'RECEIVING';
      current.state.streamClosed = false;
      current.state.fence = id();
      await save(client, current);
      return current;
    });
    const expectedByteLength = row.original_command.payload.declaredByteLength;
    const generation = row.state.generation,
      fence = row.state.fence,
      key = `customer-zip/${row.intake_id}/${generation}/original`;
    let writingObject = false;
    try {
      const chunks: Buffer[] = [];
      let received = 0;
      const started = now().getTime();
      const iterator = input.stream[Symbol.asyncIterator]();
      try {
        while (true) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                reject(new PreparationError('INTEGRATION_ZIP_STREAM_TIMEOUT'));
              }, 30000);
            }),
          ]).finally(() => {
            if (timeout) clearTimeout(timeout);
          });
          if (next.done) break;
          await config.verifySession(session);
          if (
            now().getTime() >= Date.parse(row.state.ticket.expiresAt) ||
            now().getTime() - started >= 300000
          )
            fail('INTEGRATION_ZIP_TICKET_EXPIRED');
          received += next.value.byteLength;
          if (received > expectedByteLength || received > 104857600)
            fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
          chunks.push(Buffer.from(next.value));
        }
      } finally {
        await iterator.return?.();
      }
      const bytes = Buffer.concat(chunks);
      chunks.length = 0;
      if (received !== expectedByteLength) fail('INTEGRATION_ZIP_STREAM_INCOMPLETE');
      if (byteHash(bytes).digest !== row.original_command.payload.zipBytesSha256.digest)
        fail('INTEGRATION_ZIP_CORRUPT');
      const entries = scanCustomerZip(bytes);
      await both(
        session,
        'integration.customer_zip.intake',
        s,
        target,
        row.original_command.integrity.payloadHash,
        id(),
      );
      await preparation(session, row.original_command);
      config.ticketCodec.verify(binding(row), row.state.ticket, input.token, now());
      writingObject = true;
      const object = await config.objectStore.put(key, bytes);
      checkObject(object, key, bytes);
      await transaction(authorization.intake, async (client) => {
        const current = await load(client, row.intake_id, true);
        assertFence(current, generation, fence);
        if (now().getTime() >= Date.parse(current.state.ticket.expiresAt))
          fail('INTEGRATION_ZIP_TICKET_EXPIRED');
        current.state.object = object;
        current.state.streamClosed = true;
        current.state.uploadState = 'STAGED';
        current.state.custody = 'STAGED';
        await save(client, current);
      });
      await processStaged(session, row.intake_id, entries);
      return { intakeRef: target, disposition: 'STAGED' };
    } catch (error) {
      await transaction(authorization.intake, async (client) => {
        const current = await load(client, row.intake_id, true);
        if (
          current.state.generation !== generation ||
          current.state.fence !== fence ||
          current.state.uploadState === 'STAGED'
        )
          return;
        current.state.streamClosed = true;
        const observation = await config.objectStore
          .inspect(key)
          .catch(() => ({ state: 'UNKNOWN' as const }));
        current.state.uploadState =
          observation.state === 'ABSENT' && !writingObject ? 'CLOSED_NO_OBJECT' : 'UNKNOWN';
        current.state.custody = current.state.uploadState === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
        const code =
          error instanceof PreparationError ||
          error instanceof CustomerZipSafetyError ||
          error instanceof CustomerZipTicketError
            ? error.code
            : 'DEPENDENCY_UNAVAILABLE';
        current.state.reasonCodes = [code];
        if (
          [
            'INTEGRATION_ZIP_UNSAFE',
            'INTEGRATION_ZIP_LIMIT_EXCEEDED',
            'INTEGRATION_NO_ANALYZABLE_SOURCE',
            'INTEGRATION_ZIP_CORRUPT',
          ].includes(code)
        )
          current.state.terminalContentFailure = true;
        await save(client, current);
      });
      throw error;
    }
  }
  function assertFence(row: Row, generation: number, fence: string) {
    if (
      row.state.generation !== generation ||
      row.state.fence !== fence ||
      row.state.uploadState !== 'RECEIVING'
    )
      fail('INTEGRATION_ZIP_UPLOAD_GENERATION_CONFLICT');
  }
  function checkObject(object: CustomerZipObjectReceipt, key: string, bytes: Uint8Array) {
    if (
      object.key !== key ||
      object.byteLength !== bytes.byteLength ||
      object.sha256 !== byteHash(bytes).digest
    )
      fail('INTEGRATION_ZIP_CORRUPT');
  }
  async function processStaged(
    session: PreparationSession,
    intakeId: string,
    alreadyScanned?: readonly ScannedZipEntry[],
  ) {
    await config.verifySession(session);
    const s = await resolveUploadScope(session, intakeId),
      target = objectRef('zhiju.integration.customer_zip_intake', intakeId, s);
    const authorization = await both(
      session,
      'integration.customer_zip.intake',
      s,
      target,
      preparationHash({ intakeRef: target }),
      id(),
    );
    let row = await transaction(authorization.intake, (client) => load(client, intakeId));
    owner(session, row);
    await preparation(session, row.original_command);
    if (row.state.manifestRef) {
      await dispatch(row);
      return;
    }
    if (row.state.uploadState !== 'STAGED' || !row.state.object) fail('DEPENDENCY_UNAVAILABLE');
    const original = Buffer.from(await config.objectStore.read(row.state.object.key));
    checkObject(row.state.object, row.state.object.key, original);
    const entries = alreadyScanned ?? scanCustomerZip(original),
      p = row.original_command.payload;
    const sources: {
      key: string;
      kind: 'ZIP' | 'ENTRY' | 'NOTE';
      ordinal?: number;
      originalName: string;
      mediaType: string;
      bytes: Buffer;
      analyzable: boolean;
    }[] = [
      {
        key: 'zip',
        kind: 'ZIP',
        originalName: p.originalName,
        mediaType: 'application/zip',
        bytes: original,
        analyzable: false,
      },
      ...entries.map((e) => ({
        key: `entry:${e.ordinal}`,
        kind: 'ENTRY' as const,
        ordinal: e.ordinal,
        originalName: e.originalName,
        mediaType: e.mediaType,
        bytes: e.bytes,
        analyzable: e.status === 'ANALYZABLE',
      })),
      ...(p.submittedNote !== undefined
        ? [
            {
              key: 'note',
              kind: 'NOTE' as const,
              originalName: 'submission-note.txt',
              mediaType: 'text/plain',
              bytes: Buffer.from(p.submittedNote, 'utf8'),
              analyzable: false,
            },
          ]
        : []),
    ];
    row = await transaction(authorization.intake, async (client) => {
      const current = await load(client, intakeId, true);
      if (current.state.manifestRef) return current;
      for (const source of sources)
        current.state.steps[source.key] ??= {
          sourceId: id(),
          validationId: id(),
          registerCommandId: id(),
          validateCommandId: id(),
          acceptCommandId: id(),
        };
      current.state.custody = 'EXTRACTING';
      await save(client, current);
      return current;
    });
    for (const source of sources) {
      const currentAuth = await both(
        session,
        'integration.customer_zip.intake',
        s,
        target,
        row.original_command.integrity.payloadHash,
        id(),
      );
      row = await transaction(currentAuth.intake, (client) => load(client, intakeId));
      const step = row.state.steps[source.key] ?? fail('DEPENDENCY_UNAVAILABLE');
      if (step.result) continue;
      const objectKey = `customer-zip/${row.intake_id}/sources/${step.sourceId}`;
      const object =
        source.kind === 'ZIP'
          ? (row.state.object ?? fail('DEPENDENCY_UNAVAILABLE'))
          : await config.objectStore.put(objectKey, source.bytes);
      checkObject(
        object,
        source.kind === 'ZIP' ? (row.state.object?.key ?? '') : objectKey,
        source.bytes,
      );
      const sourceInput: CustomerZipSourceInput = {
        intakeRef: target,
        submissionPayloadHash: row.original_command.integrity.payloadHash,
        scopeRef: s,
        creatorId: row.creator_id,
        sourceId: step.sourceId,
        validationId: step.validationId,
        registerCommandId: step.registerCommandId,
        validateCommandId: step.validateCommandId,
        acceptCommandId: step.acceptCommandId,
        kind: source.kind,
        ...(source.ordinal !== undefined ? { ordinal: source.ordinal } : {}),
        originalName: source.originalName,
        mediaType: source.mediaType,
        bytesSha256: byteHash(source.bytes),
        byteLength: source.bytes.length,
        objectRef: object,
        validation: { safety: 'PASS', integrity: 'PASS', analyzable: source.analyzable },
      };
      await transaction(currentAuth.intake, async (client) => {
        const current = await load(client, intakeId, true),
          targetStep = current.state.steps[source.key] ?? fail('DEPENDENCY_UNAVAILABLE');
        if (targetStep.input && !samePreparationValue(targetStep.input, sourceInput))
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        targetStep.input = sourceInput;
        targetStep.object = object;
        await save(client, current);
      });
      const result = await config.owners.acceptSource(session, sourceInput);
      if (
        result.sourceRef.kind !== 'CONTENT_ADDRESSED' ||
        result.sourceRef.objectType !== 'SourceMaterial' ||
        !samePreparationValue(result.sourceRef.contentHash, byteHash(source.bytes)) ||
        result.validationRef.kind !== 'CONTENT_ADDRESSED' ||
        result.validationRef.objectType !== 'ValidationResult' ||
        result.sourceRef.objectId !== step.sourceId ||
        result.validationRef.objectId !== step.validationId ||
        !samePreparationValue(result.sourceRef.scope, s) ||
        !samePreparationValue(result.validationRef.scope, s) ||
        result.receiptRefs.length !== 3 ||
        result.receiptRefs.some(
          (receipt, index) =>
            !('kind' in receipt) ||
            receipt.kind !== 'OBJECT' ||
            receipt.objectType !== 'CommandReceipt' ||
            receipt.objectId !==
              [step.registerCommandId, step.validateCommandId, step.acceptCommandId][index] ||
            !samePreparationValue(receipt.scope, s),
        )
      )
        fail('INTEGRATION_SOURCE_RECEIPT_INVALID');
      await transaction(currentAuth.intake, async (client) => {
        const current = await load(client, intakeId, true);
        const targetStep = current.state.steps[source.key] ?? fail('DEPENDENCY_UNAVAILABLE');
        if (targetStep.result && !samePreparationValue(targetStep.result, result))
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        targetStep.object = object;
        targetStep.result = result;
        await save(client, current);
      });
    }
    const finalAuth = await both(
      session,
      'integration.customer_zip.intake',
      s,
      target,
      row.original_command.integrity.payloadHash,
      id(),
    );
    const policy = await preparation(session, row.original_command);
    row = await transaction(finalAuth.intake, async (client) => {
      const current = await load(client, intakeId, true);
      if (current.state.manifestRef) return current;
      const sourceReceiptRefs = Object.values(current.state.steps).flatMap(
        (step) => step.result?.receiptRefs ?? [],
      );
      if (Object.values(current.state.steps).some((step) => !step.result))
        fail('DEPENDENCY_UNAVAILABLE');
      const zip = current.state.steps.zip?.result ?? fail('DEPENDENCY_UNAVAILABLE'),
        note = current.state.steps.note?.result;
      const manifest = {
        intakeRef: target,
        preparationRequestRef: p.preparationRequestRef,
        originalIntakeKey: current.original_key,
        submissionPayloadHash: current.original_command.integrity.payloadHash,
        projectRef: p.projectRef,
        zipSourceRef: zip.sourceRef,
        zipBytesSha256: p.zipBytesSha256,
        zipByteLength: original.length,
        intakePolicyRef: p.intakePolicyRef,
        intakePolicyHash: p.intakePolicyHash,
        extractorProfileRef: policy.payload.extractorProfileRef,
        entries: entries.map((e) => {
          const step = current.state.steps[`entry:${e.ordinal}`] ?? fail('DEPENDENCY_UNAVAILABLE');
          return {
            entryId: step.sourceId,
            ordinal: e.ordinal,
            originalName: e.originalName,
            normalizedPath: e.normalizedPath,
            mediaType: e.mediaType,
            byteLength: e.bytes.length,
            bytesSha256: byteHash(e.bytes),
            sourceRef: step.result?.sourceRef,
            validationRef: step.result?.validationRef,
            status: e.status,
            reasonCodes: e.reasonCodes,
          };
        }),
        ...(note
          ? {
              noteSourceRef: note.sourceRef,
              noteBytesSha256: byteHash(Buffer.from(p.submittedNote ?? '', 'utf8')),
            }
          : {}),
        analysisIntent: 'ANALYZE',
        preparationPresetRef: p.preparationPresetRef,
        preparationPresetHash: p.preparationPresetHash,
        sourceReceiptRefs,
        createdAt: now().toISOString(),
      };
      const manifestId = id(),
        manifestRef: Common.SnapshotRef = {
          kind: 'SNAPSHOT',
          objectType: 'zhiju.integration.customer_input_manifest',
          objectId: manifestId,
          snapshotId: id(),
          scope: s,
          contentHash: preparationHash(manifest),
        };
      const eventId = id(),
        receiptId = id();
      const event = {
        intakeRef: target,
        preparationRequestRef: p.preparationRequestRef,
        projectRef: p.projectRef,
        manifestRef,
        submissionPayloadHash: current.original_command.integrity.payloadHash,
        analysisIntent: 'ANALYZE',
      };
      const command = {
        ...current.original_command,
        commandId: receiptId,
        type: 'integration.commit_customer_zip_manifest',
        idempotencyKey: `integration.commit_customer_zip_manifest:1.0:${intakeId}`,
        payload: { manifestRef },
        integrity: {
          canonicalizationVersion: '1' as const,
          payloadHash: preparationHash({ manifestRef }),
        },
      };
      await receipt(client, current, command, finalAuth.intake, { manifestRef });
      await client.query(
        `INSERT INTO integration_gateway.outbox_event(event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,enterprise_id,project_id,correlation_id,causation_id,payload,payload_hash,canonicalization_version,occurred_at,created_by_principal_id,source_command_id) VALUES($1,'integration.CustomerZipManifestCommitted','1.0','zhiju.integration.customer_zip_intake',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'1',$10,$11,$12)`,
        [
          eventId,
          intakeId,
          current.state.aggregateVersion + 1,
          s.enterpriseId,
          s.projectId,
          current.original_command.correlationId,
          current.original_command.commandId,
          JSON.stringify({ enterpriseId: s.enterpriseId, projectId: s.projectId, event }),
          Buffer.from(
            preparationHash({ enterpriseId: s.enterpriseId, projectId: s.projectId, event }).digest,
            'hex',
          ),
          now(),
          session.principalId,
          receiptId,
        ],
      );
      await client.query(
        'INSERT INTO integration_gateway.customer_zip_manifest(intake_id,enterprise_id,project_id,manifest_id,payload,payload_hash,receipt_id,event_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',
        [
          intakeId,
          s.enterpriseId,
          s.projectId,
          manifestId,
          JSON.stringify(manifest),
          Buffer.from(manifestRef.contentHash.digest, 'hex'),
          receiptId,
          eventId,
        ],
      );
      current.state.manifest = manifest;
      current.state.manifestRef = manifestRef;
      current.state.eventId = eventId;
      current.state.custody = entries.every((e) => e.status === 'ANALYZABLE') ? 'READY' : 'PARTIAL';
      current.state.receiptRefs = [
        ...current.state.receiptRefs,
        ...sourceReceiptRefs,
        objectRef('zhiju.integration.command_receipt', receiptId, s),
      ];
      await save(client, current);
      return current;
    });
    await dispatch(row);
  }
  async function dispatch(row: Row) {
    if (!row.state.manifestRef || !row.state.eventId) return;
    await config.owners.acceptHandoff({
      eventId: row.state.eventId,
      intakeRef: row.original_command.targetRef,
      manifestRef: row.state.manifestRef,
      submissionPayloadHash: row.original_command.integrity.payloadHash,
    });
  }
  async function readSubmission(
    serviceSession: PreparationSession,
    input: {
      readonly intakeRef: Ref;
      readonly manifestRef: Common.SnapshotRef;
      readonly submissionPayloadHash: Hash;
    },
  ) {
    const s = input.intakeRef.scope;
    if (!s.enterpriseId || !s.projectId) fail('SCOPE_MISMATCH');
    const context = await auth(
      serviceSession,
      'integration.customer_zip.submission.read',
      { enterpriseId: s.enterpriseId, projectId: s.projectId },
      input.intakeRef,
      preparationHash(input),
      id(),
    );
    return transaction(context, async (client) => {
      const row = await load(client, input.intakeRef.objectId);
      if (
        !row.state.manifestRef ||
        !samePreparationValue(row.state.manifestRef, input.manifestRef) ||
        !samePreparationValue(
          row.original_command.integrity.payloadHash,
          input.submissionPayloadHash,
        )
      )
        fail('INTEGRATION_REPORT_BINDING_INVALID');
      const p = row.original_command.payload;
      return {
        intakeRef: row.original_command.targetRef,
        projectRef: p.projectRef,
        preparationRequestRef: p.preparationRequestRef,
        originalPreparationKey: p.originalPreparationKey,
        originalSubmissionKey: row.original_key,
        submissionPayloadHash: row.original_command.integrity.payloadHash,
        manifestRef: row.state.manifestRef,
        sourceRefs: Object.values(row.state.steps).flatMap((step) =>
          step.result ? [step.result.sourceRef] : [],
        ),
        receiptRefs: row.state.receiptRefs,
        creatorId: row.creator_id,
        ...(row.state.steps.note?.result
          ? { noteSourceRef: row.state.steps.note.result.sourceRef }
          : {}),
        originalSubmission: {
          originalCommand: row.original_command,
          creatorId: row.creator_id,
          provenance: row.state.provenance,
        },
        manifest: row.state.manifest,
        currentUsability: { custody: row.state.custody },
        sourceWatermarks: [
          {
            sourceModule: 'zhiju.integration_gateway',
            partition: row.intake_id,
            sequence: row.state.aggregateVersion,
            observedAt: now().toISOString(),
          },
        ],
      };
    });
  }
  async function readSourceAdmission(
    service: PreparationSession,
    input: { intakeRef: Ref; submissionPayloadHash: Hash; sourceId: string },
  ) {
    const s = input.intakeRef.scope;
    if (!s.enterpriseId || !s.projectId) fail('SCOPE_MISMATCH');
    const context = await auth(
      service,
      'integration.customer_zip.submission.read',
      { enterpriseId: s.enterpriseId, projectId: s.projectId },
      input.intakeRef,
      preparationHash(input),
      id(),
    );
    return transaction(context, async (client) => {
      const row = await load(client, input.intakeRef.objectId);
      if (
        !samePreparationValue(
          row.original_command.integrity.payloadHash,
          input.submissionPayloadHash,
        ) ||
        row.state.uploadState !== 'STAGED'
      )
        fail('INTEGRATION_SOURCE_RECEIPT_INVALID');
      const step = Object.values(row.state.steps).find((step) => step.sourceId === input.sourceId);
      if (!step?.input || !step.object || !samePreparationValue(step.input.objectRef, step.object))
        fail('INTEGRATION_SOURCE_RECEIPT_INVALID');
      return {
        sourceInput: clone(step.input),
        originalCommand: row.original_command,
        creatorId: row.creator_id,
        currentUsability: { custody: row.state.custody },
        sourceWatermarks: [
          {
            sourceModule: 'zhiju.integration_gateway',
            partition: row.intake_id,
            sequence: row.state.aggregateVersion,
            observedAt: now().toISOString(),
          },
        ],
      };
    });
  }
  return { request, get, restart, upload, processStaged, readSubmission, readSourceAdmission };
}
