import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely } from 'kysely';
import {
  getContractRegistry,
  type Artifact,
  type Common,
  type IntegrationGateway,
} from '@zhiju/contracts';
import { canonicalize, newUuidV7, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import {
  withRenderTransaction,
  type IntegrationRendererDb,
  type RenderTransactionContext,
  type SelectedRenderAttempt,
} from '../persistence/render-attempt-db.js';
import {
  RenderAttemptRepository,
  RenderPersistenceError,
  type RenderCompletionRecord,
} from '../persistence/render-attempt-repository.js';
import {
  MARKDOWN_RENDERER_PROFILE,
  renderMarkdownDocument,
} from './deterministic-markdown-renderer.js';

const registry = getContractRegistry();
const repo = new RenderAttemptRepository();
const OPERATION = 'integration.request_markdown_render';
const mediaType = MARKDOWN_RENDERER_PROFILE.mediaType;
const json = (value: unknown) => canonicalize(value as CanonicalJsonValue);
const bytesHash = (bytes: Uint8Array): Common.ContentHash => ({
  algorithm: 'SHA-256',
  canonicalizationVersion: '1',
  digest: createHash('sha256').update(bytes).digest('hex'),
});
const hash = (value: unknown) => bytesHash(Buffer.from(json(value)));
const bufferHash = (value: unknown) => Buffer.from(hash(value).digest, 'hex');
function invalid(): never {
  throw new RenderPersistenceError(
    'INTEGRATION_MARKDOWN_RENDER_INVALID',
    'Markdown render binding is unavailable',
  );
}

/** Deployment pins the actual renderer implementation digest, not a caller assertion. */
export interface MarkdownRenderStorageReference {
  storageProvider: string;
  objectLocator: string;
  objectVersionId: string;
}
export interface MarkdownRenderStoragePort {
  putStaging(input: {
    objectLocator: string;
    bytes: Buffer;
    mediaType: string;
  }): Promise<MarkdownRenderStorageReference>;
  read(
    reference: MarkdownRenderStorageReference,
  ): Promise<
    MarkdownRenderStorageReference & { bytes: Buffer; byteSize: number; mediaType: string }
  >;
  finalize(reference: MarkdownRenderStorageReference): Promise<void>;
}
export interface MarkdownCanonicalPort {
  read(revisionRef: Common.ContentAddressedRef): Promise<{
    content: Artifact.MarkdownDocumentContent;
    canonicalContentRef: string;
    identityMap: Artifact.MarkdownIdentityMap;
  }>;
  verify(input: {
    revisionRef: Common.ContentAddressedRef;
    bytes: Buffer;
    identityMap: Artifact.MarkdownIdentityMap;
  }): Promise<Common.ContentHash>;
}
export interface MarkdownRenderAuthority {
  authorize(
    operation: string,
    target: Common.ObjectRef | Common.ContentAddressedRef,
  ): Promise<RenderTransactionContext>;
}
export interface MarkdownRenderConfig {
  db: Kysely<IntegrationRendererDb>;
  storage: MarkdownRenderStoragePort;
  canonical: MarkdownCanonicalPort;
  rendererDigest: Common.ContentHash;
  now?: () => number;
  timeoutMs?: number;
}
export interface MarkdownRenderCommand {
  commandId: string;
  attemptRef: Common.ObjectRef;
  idempotencyScope: string;
  idempotencyKey: string;
  payload: IntegrationGateway.MarkdownRenderRequest;
}

function attemptRef(row: SelectedRenderAttempt): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'integration.render_attempt',
    objectId: row.attempt_id,
    scope: {
      enterpriseId: row.enterprise_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
    },
  };
}
function completion(row: SelectedRenderAttempt): RenderCompletionRecord {
  return {
    attemptId: row.attempt_id,
    enterpriseId: row.enterprise_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    stableKeyHash: row.stable_key_hash,
    requestPayloadHash: row.request_payload_hash,
    request: row.request_payload as IntegrationGateway.MarkdownRenderRequest,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.source_command_id ? { sourceCommandId: row.source_command_id } : {}),
  };
}

export class MarkdownRenderService {
  private readonly now: () => number;
  constructor(private readonly config: MarkdownRenderConfig) {
    this.now = config.now ?? Date.now;
  }
  private async authorize(
    authority: MarkdownRenderAuthority,
    operation: string,
    revision: Common.ObjectRef | Common.ContentAddressedRef,
  ) {
    const context = await authority.authorize(operation, revision);
    if (
      context.principalKind !== 'SERVICE' ||
      context.enterpriseId !== revision.scope.enterpriseId ||
      !revision.scope.projectId ||
      !context.allowedProjectIds.includes(revision.scope.projectId) ||
      context.authorizationDecisionExpiresAt.getTime() <= this.now()
    )
      return invalid();
    return context;
  }
  private async bounded<T>(
    operation: () => Promise<T>,
    deadline = this.now() + (this.config.timeoutMs ?? 30_000),
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              reject(new Error('Markdown external outcome unknown'));
            },
            Math.max(1, deadline - this.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async verifySource(request: IntegrationGateway.MarkdownRenderRequest) {
    const source = await this.config.canonical.read(request.revisionRef);
    if (
      !registry.validateCoreContract(
        'https://schemas.zhiju.local/modules/integration-gateway/1.0#/$defs/markdownRenderRequest',
        request,
      ).valid ||
      !isDeepStrictEqual(request.rendererDigest, this.config.rendererDigest) ||
      !isDeepStrictEqual(request.inputHash, request.revisionRef.contentHash) ||
      request.canonicalContentRef !== source.canonicalContentRef ||
      !isDeepStrictEqual(request.markdownProfileRef, source.content.schemaRef) ||
      !isDeepStrictEqual(request.structureSchemaRef, source.content.schemaRef) ||
      !isDeepStrictEqual(request.identityMapHash, hash(source.identityMap))
    )
      return invalid();
    return source;
  }
  async request(
    authority: MarkdownRenderAuthority,
    input: MarkdownRenderCommand,
  ): Promise<IntegrationGateway.IntegrationRequestMarkdownRenderResult> {
    const request = input.payload;
    const context = await this.authorize(authority, OPERATION, request.revisionRef);
    if (
      !registry.validateCoreContract(
        'https://schemas.zhiju.local/common/1.0#/$defs/objectRef',
        input.attemptRef,
      ).valid ||
      input.attemptRef.objectType !== 'integration.render_attempt' ||
      !isDeepStrictEqual(input.attemptRef.scope, request.revisionRef.scope) ||
      !input.idempotencyScope ||
      !input.idempotencyKey
    )
      return invalid();
    // The entry validates the public Envelope; this also closes direct worker inputs.
    if (
      !registry.validateCoreContract(
        'https://schemas.zhiju.local/modules/integration-gateway/1.0#/$defs/markdownRenderRequest',
        request,
      ).valid
    )
      return invalid();
    await this.verifySource(request);
    const requestHash = bufferHash(request);
    const stableHash = bufferHash({
      operation: OPERATION,
      scope: input.idempotencyScope,
      key: input.idempotencyKey,
    });
    return withRenderTransaction(this.config.db, context, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyScope + ':' + input.idempotencyKey}, 279))`.execute(
        trx,
      );
      const prior = await trx
        .selectFrom('integration_gateway.command_receipt')
        .selectAll()
        .where('idempotency_scope', '=', input.idempotencyScope)
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst();
      if (prior) {
        if (
          prior.command_type !== OPERATION ||
          prior.command_version !== '1.0' ||
          prior.target_id !== input.attemptRef.objectId ||
          !prior.request_payload_hash.equals(requestHash) ||
          prior.outcome !== 'COMMITTED'
        )
          return invalid();
        return prior.result_payload as IntegrationGateway.IntegrationRequestMarkdownRenderResult;
      }
      const result: IntegrationGateway.IntegrationRequestMarkdownRenderResult = {
        attemptRef: input.attemptRef,
        receiptRef: {
          kind: 'OBJECT',
          objectType: 'integration.command_receipt',
          objectId: input.commandId,
          scope: input.attemptRef.scope,
        },
        status: 'CREATED',
      };
      await trx
        .insertInto('integration_gateway.command_receipt')
        .values({
          command_id: input.commandId,
          command_type: OPERATION,
          command_version: '1.0',
          idempotency_scope: input.idempotencyScope,
          idempotency_key: input.idempotencyKey,
          request_payload_hash: requestHash,
          enterprise_id: context.enterpriseId,
          project_id: request.revisionRef.scope.projectId,
          target_type: 'integration.render_attempt',
          target_id: input.attemptRef.objectId,
          outcome: 'COMMITTED',
          result_payload: JSON.stringify(result),
          result_payload_hash: bufferHash(result),
          completed_at: new Date(this.now()),
          correlation_id: context.correlationId,
          created_by_principal_id: context.principalId,
          actor_snapshot_id: context.actorSnapshotId,
          authorization_decision_id: context.authorizationDecisionId,
        })
        .execute();
      await trx
        .insertInto('integration_gateway.render_attempt')
        .values({
          attempt_id: input.attemptRef.objectId,
          original_operation: OPERATION,
          source_command_id: input.commandId,
          enterprise_id: context.enterpriseId,
          project_id: request.revisionRef.scope.projectId,
          stable_key_hash: stableHash,
          request_payload_hash: requestHash,
          request_payload: JSON.stringify(request),
          output_object_ref: null,
          output_checksum: null,
          raw_receipt_id: null,
          error_code: null,
        })
        .execute();
      await trx
        .insertInto('integration_gateway.audit_record')
        .values({
          audit_id: newUuidV7(),
          enterprise_id: context.enterpriseId,
          project_id: request.revisionRef.scope.projectId,
          principal_id: context.principalId,
          actor_snapshot_id: context.actorSnapshotId,
          authorization_decision_id: context.authorizationDecisionId,
          command_id: input.commandId,
          command_type: OPERATION,
          outcome: 'COMMITTED',
          request_payload_hash: requestHash,
          result_payload_hash: bufferHash(result),
          target_type: 'integration.render_attempt',
          target_id: input.attemptRef.objectId,
          correlation_id: context.correlationId,
          safe_summary: 'Markdown attempt committed before rendering',
          retention_class: 'BUSINESS_AUDIT',
        })
        .execute();
      return result;
    });
  }
  private async load(authority: MarkdownRenderAuthority, ref: Common.ObjectRef) {
    const context = await this.authorize(authority, 'integration.get_markdown_render_binding', ref);
    const row = await withRenderTransaction(this.config.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.render_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (
        row?.original_operation !== OPERATION ||
        !row.source_command_id ||
        !isDeepStrictEqual(attemptRef(row), ref)
      )
        return invalid();
      const receipt = await trx
        .selectFrom('integration_gateway.command_receipt')
        .selectAll()
        .where('command_id', '=', row.source_command_id)
        .executeTakeFirst();
      if (
        receipt?.command_type !== OPERATION ||
        receipt.command_version !== '1.0' ||
        receipt.target_id !== row.attempt_id ||
        receipt.target_type !== 'integration.render_attempt' ||
        receipt.enterprise_id !== row.enterprise_id ||
        receipt.project_id !== row.project_id ||
        receipt.outcome !== 'COMMITTED' ||
        !receipt.request_payload_hash.equals(row.request_payload_hash) ||
        !row.request_payload_hash.equals(bufferHash(row.request_payload))
      )
        return invalid();
      return row;
    });
    await this.authorize(
      authority,
      'integration.get_markdown_render_binding',
      (row.request_payload as IntegrationGateway.MarkdownRenderRequest).revisionRef,
    );
    return { row, context };
  }
  async getBinding(
    authority: MarkdownRenderAuthority,
    ref: Common.ObjectRef,
  ): Promise<IntegrationGateway.MarkdownRenderBinding> {
    const { row, context } = await this.load(authority, ref);
    const request = row.request_payload as IntegrationGateway.MarkdownRenderRequest;
    const result: IntegrationGateway.MarkdownRenderBinding = {
      attemptRef: ref,
      status: row.status,
      originalOperation: { type: OPERATION, version: '1.0' },
      originalRequest: request,
      requestPayloadHash: hash(request),
      sourceWatermarks: [
        {
          sourceModule: 'integration_gateway',
          partition: row.attempt_id,
          sequence: row.status === 'CREATED' ? 1 : 2,
          observedAt: new Date(this.now()).toISOString(),
        },
      ],
    };
    if (row.status !== 'SUCCEEDED') return result;
    const material = await withRenderTransaction(this.config.db, context, async (trx) => ({
      output: await trx
        .selectFrom('integration_gateway.markdown_render_output')
        .selectAll()
        .where('attempt_id', '=', row.attempt_id)
        .executeTakeFirst(),
      receipt: row.raw_receipt_id
        ? await trx
            .selectFrom('integration_gateway.raw_external_receipt')
            .selectAll()
            .where('receipt_id', '=', row.raw_receipt_id)
            .executeTakeFirst()
        : undefined,
    }));
    if (
      !material.output ||
      material.receipt?.observed_outcome !== 'SUCCEEDED' ||
      material.receipt.attempt_id !== row.attempt_id ||
      !row.output_object_ref ||
      !row.output_checksum
    )
      return invalid();
    const rawReceiptRef: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'integration.raw_external_receipt',
      objectId: material.receipt.receipt_id,
      scope: ref.scope,
      contentHash: {
        algorithm: 'SHA-256',
        canonicalizationVersion: '1',
        digest: material.receipt.receipt_content_hash.toString('hex'),
      },
    };
    const binding: IntegrationGateway.MarkdownRenderBinding = {
      ...result,
      rawReceiptRef,
      markdownValidation: material.output.validation as IntegrationGateway.MarkdownValidation,
      succeededResult: {
        attemptRef: ref,
        revisionRef: request.revisionRef,
        outputObjectRef: row.output_object_ref,
        outputChecksum: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: row.output_checksum.toString('hex'),
        },
        rendererId: request.rendererId,
        rendererVersion: request.rendererVersion,
        rawReceiptRef,
      },
    };
    if (
      !registry.validateOperationResult('integration.get_markdown_render_binding', '1.0', binding)
        .valid
    )
      return invalid();
    return binding;
  }
  async work(
    authority: MarkdownRenderAuthority,
    ref: Common.ObjectRef,
    reconcile = false,
  ): Promise<IntegrationGateway.MarkdownRenderBinding> {
    const { row, context } = await this.load(authority, ref);
    const request = row.request_payload as IntegrationGateway.MarkdownRenderRequest;
    await this.authorize(authority, OPERATION, request.revisionRef);
    if (row.status === 'SUCCEEDED' || row.status === 'FAILED')
      return await this.getBinding(authority, ref);
    if (row.status === 'UNKNOWN' && !reconcile) return await this.getBinding(authority, ref);
    let output = await withRenderTransaction(this.config.db, context, (trx) =>
      trx
        .selectFrom('integration_gateway.markdown_render_output')
        .selectAll()
        .where('attempt_id', '=', row.attempt_id)
        .executeTakeFirst(),
    );
    try {
      if (!output) {
        if (row.status !== 'CREATED') return await this.getBinding(authority, ref);
        const previous = await withRenderTransaction(this.config.db, context, (trx) =>
          trx
            .selectFrom('integration_gateway.markdown_render_work')
            .selectAll()
            .where('attempt_id', '=', row.attempt_id)
            .executeTakeFirst(),
        );
        if (previous) {
          if (previous.deadline_at.getTime() <= this.now())
            throw new Error('Original Markdown work outcome unknown');
          return await this.getBinding(authority, ref);
        }
        if (reconcile) return await this.getBinding(authority, ref);
        const started = this.now();
        const deadline = started + (this.config.timeoutMs ?? 30_000);
        const claimed = await withRenderTransaction(this.config.db, context, (trx) =>
          trx
            .insertInto('integration_gateway.markdown_render_work')
            .values({
              attempt_id: row.attempt_id,
              enterprise_id: row.enterprise_id,
              project_id: requiredValue(row.project_id),
              started_at: new Date(started),
              deadline_at: new Date(deadline),
            })
            .onConflict((c) => c.doNothing())
            .returning('attempt_id')
            .executeTakeFirst(),
        );
        if (!claimed) return await this.getBinding(authority, ref);
        const source = await this.bounded(() => this.verifySource(request), deadline);
        const rendered = renderMarkdownDocument(source.content);
        const reference = await this.bounded(
          () =>
            this.config.storage.putStaging({
              objectLocator: `integration/markdown/output/${row.attempt_id}.md`,
              bytes: rendered.bytes,
              mediaType,
            }),
          deadline,
        );
        const actual = await this.bounded(() => this.config.storage.read(reference), deadline);
        if (
          this.now() > deadline ||
          actual.byteSize !== rendered.bytes.length ||
          !actual.bytes.equals(rendered.bytes) ||
          actual.mediaType !== mediaType ||
          !isDeepStrictEqual(
            {
              storageProvider: actual.storageProvider,
              objectLocator: actual.objectLocator,
              objectVersionId: actual.objectVersionId,
            },
            reference,
          )
        )
          return invalid();
        const roundTrip = await this.bounded(
          () =>
            this.config.canonical.verify({
              revisionRef: request.revisionRef,
              bytes: actual.bytes,
              identityMap: source.identityMap,
            }),
          deadline,
        );
        if (!isDeepStrictEqual(roundTrip, request.inputHash)) return invalid();
        const validation: IntegrationGateway.MarkdownValidation = {
          profileRef: request.markdownProfileRef,
          structureSchemaRef: request.structureSchemaRef,
          rendererDigest: request.rendererDigest,
          identityMapHash: request.identityMapHash,
          inputContentHash: request.inputHash,
          roundTripContentHash: roundTrip,
          outputBytesSha256: bytesHash(actual.bytes),
          outputByteLength: actual.bytes.length,
          validatorRef: { validatorId: 'artifact.markdown_round_trip', version: '1.0' },
          outcome: 'PASS',
        };
        const receiptBytes = Buffer.from(
          json({
            attemptRef: ref,
            originalOperation: { type: OPERATION, version: '1.0' },
            requestPayloadHash: hash(request),
            outputObjectRef: reference.objectLocator,
            markdownValidation: validation,
          }),
        );
        const receiptReference = await this.bounded(
          () =>
            this.config.storage.putStaging({
              objectLocator: `integration/markdown/receipt/${row.attempt_id}.json`,
              bytes: receiptBytes,
              mediaType: 'application/json',
            }),
          deadline,
        );
        const receipt = await this.bounded(
          () => this.config.storage.read(receiptReference),
          deadline,
        );
        if (
          !receipt.bytes.equals(receiptBytes) ||
          receipt.byteSize !== receiptBytes.length ||
          this.now() > deadline
        )
          return invalid();
        output = await withRenderTransaction(this.config.db, context, (trx) =>
          trx
            .insertInto('integration_gateway.markdown_render_output')
            .values({
              attempt_id: row.attempt_id,
              enterprise_id: row.enterprise_id,
              project_id: requiredValue(row.project_id),
              storage_reference: JSON.stringify(reference),
              receipt_storage_reference: JSON.stringify(receiptReference),
              validation: JSON.stringify(validation),
              observed_at: new Date(this.now()),
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        );
      }
      // Recovery reuses the persisted Attempt, object versions and original receipt.
      const reference = output.storage_reference as MarkdownRenderStorageReference;
      const receiptReference = output.receipt_storage_reference as MarkdownRenderStorageReference;
      const validation = output.validation as IntegrationGateway.MarkdownValidation;
      const source = await this.verifySource(request);
      const actual = await this.config.storage.read(reference);
      const receipt = await this.config.storage.read(receiptReference);
      const expectedReceipt = Buffer.from(
        json({
          attemptRef: ref,
          originalOperation: { type: OPERATION, version: '1.0' },
          requestPayloadHash: hash(request),
          outputObjectRef: reference.objectLocator,
          markdownValidation: validation,
        }),
      );
      if (
        actual.byteSize !== actual.bytes.length ||
        actual.bytes.length !== validation.outputByteLength ||
        actual.mediaType !== mediaType ||
        !isDeepStrictEqual(bytesHash(actual.bytes), validation.outputBytesSha256) ||
        !receipt.bytes.equals(expectedReceipt) ||
        !isDeepStrictEqual(
          await this.config.canonical.verify({
            revisionRef: request.revisionRef,
            bytes: actual.bytes,
            identityMap: source.identityMap,
          }),
          request.inputHash,
        )
      )
        return invalid();
      await this.bounded(() => this.config.storage.finalize(reference));
      await this.bounded(() => this.config.storage.finalize(receiptReference));
      await this.authorize(authority, OPERATION, request.revisionRef);
      const receiptId = newUuidV7();
      const recordedAt = new Date(this.now());
      const providerReceiptRef: Common.ExternalRef = {
        system: 'zhiju.local_renderer',
        resourceType: 'render_receipt',
        externalId: row.attempt_id,
        observedAt: output.observed_at.toISOString(),
        payloadHash: bytesHash(receipt.bytes),
        adapterVersion: request.rendererVersion,
      };
      await withRenderTransaction(this.config.db, context, async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.attempt_id}, 279))`.execute(
          trx,
        );
        const latest = await trx
          .selectFrom('integration_gateway.render_attempt')
          .selectAll()
          .where('attempt_id', '=', row.attempt_id)
          .executeTakeFirstOrThrow();
        if (latest.status === 'SUCCEEDED') return;
        if (latest.status !== 'CREATED' && !(reconcile && latest.status === 'UNKNOWN'))
          return invalid();
        await repo.recordSuccess(trx, {
          record: completion(latest),
          context,
          outputObjectRef: reference.objectLocator,
          outputChecksum: validation.outputBytesSha256,
          receipt: {
            receiptId,
            providerReceiptRef,
            receiptPayloadRef: receiptReference.objectLocator,
            receiptPayloadHash: bytesHash(receipt.bytes),
            receiptContentHash: hash({
              attemptRef: ref,
              providerReceiptRef,
              receiptPayloadRef: receiptReference.objectLocator,
              receiptPayloadHash: bytesHash(receipt.bytes),
              recordedAt: recordedAt.toISOString(),
            }),
            occurredAt: requiredValue(output).observed_at,
            recordedAt,
          },
        });
      });
    } catch (error) {
      await withRenderTransaction(this.config.db, context, async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.attempt_id}, 279))`.execute(
          trx,
        );
        const latest = await trx
          .selectFrom('integration_gateway.render_attempt')
          .selectAll()
          .where('attempt_id', '=', row.attempt_id)
          .executeTakeFirstOrThrow();
        if (latest.status === 'CREATED' || latest.status === 'UNKNOWN')
          await repo.recordFailure(trx, {
            record: completion(latest),
            context,
            status: error instanceof RenderPersistenceError ? 'FAILED' : 'UNKNOWN',
            errorCode:
              error instanceof RenderPersistenceError
                ? error.code
                : 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN',
            occurredAt: new Date(this.now()),
          });
      });
    }
    return await this.getBinding(authority, ref);
  }
  async readOutput(authority: MarkdownRenderAuthority, ref: Common.ObjectRef) {
    const binding = await this.getBinding(authority, ref);
    if (binding.status !== 'SUCCEEDED' || !binding.markdownValidation || !binding.succeededResult)
      return invalid();
    const { context } = await this.load(authority, ref);
    const material = await withRenderTransaction(this.config.db, context, (trx) =>
      trx
        .selectFrom('integration_gateway.markdown_render_output')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirstOrThrow(),
    );
    const reference = material.storage_reference as MarkdownRenderStorageReference;
    const actual = await this.config.storage.read(reference);
    if (
      !isDeepStrictEqual(
        {
          storageProvider: actual.storageProvider,
          objectLocator: actual.objectLocator,
          objectVersionId: actual.objectVersionId,
        },
        reference,
      ) ||
      reference.objectLocator !== binding.succeededResult.outputObjectRef ||
      actual.byteSize !== actual.bytes.length ||
      actual.bytes.length !== binding.markdownValidation.outputByteLength ||
      actual.mediaType !== mediaType ||
      !isDeepStrictEqual(bytesHash(actual.bytes), binding.succeededResult.outputChecksum)
    )
      return invalid();
    await this.authorize(
      authority,
      'integration.get_markdown_render_binding',
      binding.originalRequest.revisionRef,
    );
    return { binding, bytes: actual.bytes, observedAt: material.observed_at.toISOString() };
  }
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
