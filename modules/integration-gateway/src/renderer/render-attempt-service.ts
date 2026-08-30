// IM-05 WI-05 (issue #125): Renderer worker, UNKNOWN handling, reconciliation,
// and authoritative Binding Query. External work occurs after CREATED commit.

import { createHash } from 'node:crypto';

import {
  ContractRegistry,
  type Artifact,
  type Common,
  type IntegrationGateway,
} from '@zhiju/contracts';
import {
  canonicalize,
  canonicalizeCanonicalContentPayload,
  newUuidV7,
  type CanonicalContentPayload,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';

import {
  type IntegrationRendererDb,
  type RenderTransactionContext,
  withRenderTransaction,
} from '../persistence/render-attempt-db.js';
import {
  RenderAttemptRepository,
  RenderPersistenceError,
  type RenderAttemptRecord,
  type RenderReceiptInput,
} from '../persistence/render-attempt-repository.js';
import { renderCanonicalContent, resolveRendererProfile } from './deterministic-ooxml-renderer.js';
import type { RenderObjectStoragePort } from './in-memory-render-object-storage.js';

const registry = new ContractRegistry();
const repo = new RenderAttemptRepository();
const LOCATOR = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;

export const INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN = 'INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN';
export const INTEGRATION_RENDER_FAILED = 'INTEGRATION_RENDER_FAILED';
export const INTEGRATION_RENDER_OUTPUT_MISMATCH = 'INTEGRATION_RENDER_OUTPUT_MISMATCH';

export interface RenderProviderSuccess {
  readonly outcome: 'SUCCEEDED';
  readonly outputObjectRef: string;
  readonly outputChecksum: Common.ContentHash;
  readonly providerReceiptRef: Common.ExternalRef;
  readonly receiptPayloadRef: string;
  readonly receiptPayloadHash: Common.ContentHash;
  readonly occurredAt: Date;
}

export interface RenderProviderFailure {
  readonly outcome: 'FAILED';
  readonly errorCode: string;
  readonly occurredAt: Date;
}

export type RenderProviderOutcome = RenderProviderSuccess | RenderProviderFailure;

export interface RenderProviderPort {
  render(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RenderRequest;
  }): Promise<RenderProviderOutcome>;
  verifySucceeded(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RenderRequest;
    readonly outcome: RenderProviderSuccess;
  }): Promise<boolean>;
}

export interface RequestRenderInput {
  readonly attemptRef: Common.ObjectRef;
  readonly request: IntegrationGateway.RenderRequest;
  readonly timeoutMs: number;
  readonly failAfterOutbox?: boolean;
}

function contentHash(bytes: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    canonicalizationVersion: '1',
  };
}

function receiptContentHash(input: {
  readonly attemptRef: Common.ObjectRef;
  readonly providerReceiptRef: Common.ExternalRef;
  readonly receiptPayloadRef: string;
  readonly receiptPayloadHash: Common.ContentHash;
  readonly recordedAt: string;
}): Common.ContentHash {
  return contentHash(Buffer.from(canonicalize(input as unknown as CanonicalJsonObject), 'utf8'));
}

function assertRequest(
  context: RenderTransactionContext,
  attemptRef: Common.ObjectRef,
  request: IntegrationGateway.RenderRequest,
): void {
  if (
    attemptRef.objectType !== 'integration.render_attempt' ||
    attemptRef.scope.enterpriseId !== context.enterpriseId ||
    request.revisionRef.scope.enterpriseId !== context.enterpriseId ||
    attemptRef.scope.projectId !== request.revisionRef.scope.projectId ||
    (request.revisionRef.scope.projectId !== undefined &&
      !context.allowedProjectIds.includes(request.revisionRef.scope.projectId)) ||
    request.revisionRef.objectType !== 'artifact.artifact_revision' ||
    request.inputHash.digest !== request.revisionRef.contentHash.digest ||
    !LOCATOR.test(request.canonicalContentRef) ||
    request.stableIdempotencyKey.trim().length === 0
  ) {
    throw new RenderPersistenceError(
      'INTEGRATION_RENDER_INPUT_MISMATCH',
      'render request identity, scope, locator, or input hash is inconsistent',
    );
  }
  resolveRendererProfile(request);
}

function scopeFor(record: RenderAttemptRecord): Common.ScopeRef {
  return {
    enterpriseId: record.enterpriseId,
    ...(record.projectId === undefined ? {} : { projectId: record.projectId }),
  };
}

function attemptRefFor(record: RenderAttemptRecord): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'integration.render_attempt',
    objectId: record.attemptId,
    scope: scopeFor(record),
  };
}

function receiptRefFor(record: RenderAttemptRecord): Common.ContentAddressedRef | undefined {
  if (record.rawReceiptId === undefined || record.rawReceiptContentHash === undefined)
    return undefined;
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'integration.raw_external_receipt',
    objectId: record.rawReceiptId,
    scope: scopeFor(record),
    contentHash: record.rawReceiptContentHash,
  };
}

export class LocalOoxmlRenderProvider implements RenderProviderPort {
  constructor(private readonly storage: RenderObjectStoragePort) {}

  async render(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RenderRequest;
  }): Promise<RenderProviderOutcome> {
    const source = await this.storage.read(input.request.canonicalContentRef);
    if (source === undefined) {
      return {
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_RENDER_SOURCE_NOT_FOUND',
        occurredAt: new Date(),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source.bytes.toString('utf8')) as unknown;
    } catch {
      return {
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_RENDER_INPUT_MISMATCH',
        occurredAt: new Date(),
      };
    }
    const validation = registry.validateCanonicalContent(parsed);
    if (!validation.valid) {
      return {
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_RENDER_INPUT_MISMATCH',
        occurredAt: new Date(),
      };
    }
    const payload = parsed as Artifact.CanonicalContentPayload;
    const canonicalBytes = Buffer.from(
      canonicalizeCanonicalContentPayload(payload as unknown as CanonicalContentPayload),
      'utf8',
    );
    if (!canonicalBytes.equals(source.bytes)) {
      return {
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_RENDER_INPUT_MISMATCH',
        occurredAt: new Date(),
      };
    }
    const profile = resolveRendererProfile(input.request);
    const rendered = renderCanonicalContent({
      payload,
      declaredInputHash: input.request.inputHash,
      profile,
    });
    const outputObjectRef = `integration/render/output/${input.attemptRef.objectId}.${rendered.extension}`;
    const output = await this.storage.putImmutable({
      locator: outputObjectRef,
      bytes: rendered.bytes,
      mediaType: rendered.mediaType,
    });
    if (output.checksum.digest !== rendered.checksum.digest) {
      return {
        outcome: 'FAILED',
        errorCode: 'INTEGRATION_RENDER_OUTPUT_MISMATCH',
        occurredAt: new Date(),
      };
    }
    const occurredAt = new Date();
    const receiptPayloadRef = `integration/render/receipt/${input.attemptRef.objectId}.json`;
    const receiptBytes = Buffer.from(
      canonicalize({
        attemptId: input.attemptRef.objectId,
        outputObjectRef,
        outputChecksum: output.checksum,
        rendererId: input.request.rendererId,
        rendererVersion: input.request.rendererVersion,
      } as unknown as CanonicalJsonObject),
      'utf8',
    );
    const receipt = await this.storage.putImmutable({
      locator: receiptPayloadRef,
      bytes: receiptBytes,
      mediaType: 'application/json',
    });
    return {
      outcome: 'SUCCEEDED',
      outputObjectRef,
      outputChecksum: output.checksum,
      providerReceiptRef: {
        system: 'zhiju.local_renderer',
        resourceType: 'render_receipt',
        externalId: input.attemptRef.objectId,
        observedAt: occurredAt.toISOString(),
        payloadHash: receipt.checksum,
        adapterVersion: input.request.rendererVersion,
      },
      receiptPayloadRef,
      receiptPayloadHash: receipt.checksum,
      occurredAt,
    };
  }

  async verifySucceeded(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RenderRequest;
    readonly outcome: RenderProviderSuccess;
  }): Promise<boolean> {
    const profile = resolveRendererProfile(input.request);
    const expectedOutputObjectRef = `integration/render/output/${input.attemptRef.objectId}.${profile.extension}`;
    const expectedReceiptPayloadRef = `integration/render/receipt/${input.attemptRef.objectId}.json`;
    if (
      input.outcome.outputObjectRef !== expectedOutputObjectRef ||
      input.outcome.receiptPayloadRef !== expectedReceiptPayloadRef ||
      input.outcome.providerReceiptRef.system !== 'zhiju.local_renderer' ||
      input.outcome.providerReceiptRef.resourceType !== 'render_receipt' ||
      input.outcome.providerReceiptRef.externalId !== input.attemptRef.objectId ||
      input.outcome.providerReceiptRef.adapterVersion !== input.request.rendererVersion ||
      input.outcome.providerReceiptRef.observedAt !== input.outcome.occurredAt.toISOString() ||
      input.outcome.providerReceiptRef.payloadHash === undefined
    ) {
      return false;
    }
    const [output, receipt] = await Promise.all([
      this.storage.read(input.outcome.outputObjectRef),
      this.storage.read(input.outcome.receiptPayloadRef),
    ]);
    if (
      output === undefined ||
      receipt === undefined ||
      output.mediaType !== profile.mediaType ||
      receipt.mediaType !== 'application/json' ||
      canonicalize(output.checksum as unknown as CanonicalJsonObject) !==
        canonicalize(input.outcome.outputChecksum as unknown as CanonicalJsonObject) ||
      canonicalize(receipt.checksum as unknown as CanonicalJsonObject) !==
        canonicalize(input.outcome.receiptPayloadHash as unknown as CanonicalJsonObject) ||
      canonicalize(
        input.outcome.providerReceiptRef.payloadHash as unknown as CanonicalJsonObject,
      ) !== canonicalize(receipt.checksum as unknown as CanonicalJsonObject)
    ) {
      return false;
    }
    const expectedReceiptBytes = Buffer.from(
      canonicalize({
        attemptId: input.attemptRef.objectId,
        outputObjectRef: expectedOutputObjectRef,
        outputChecksum: output.checksum,
        rendererId: input.request.rendererId,
        rendererVersion: input.request.rendererVersion,
      } as unknown as CanonicalJsonObject),
      'utf8',
    );
    return receipt.bytes.equals(expectedReceiptBytes);
  }
}

export class RenderAttemptService {
  constructor(
    private readonly db: Kysely<IntegrationRendererDb>,
    private readonly provider: RenderProviderPort,
  ) {}

  async requestRender(
    context: RenderTransactionContext,
    input: RequestRenderInput,
  ): Promise<IntegrationGateway.RenderAttemptBindingView> {
    assertRequest(context, input.attemptRef, input.request);
    const claim = await withRenderTransaction(this.db, context, (trx) =>
      repo.claim(trx, {
        attemptId: input.attemptRef.objectId,
        context,
        request: input.request,
      }),
    );
    if (!claim.claimed) return this.getRenderAttemptBinding(context, attemptRefFor(claim.record));

    const providerCall = this.provider.render({
      attemptRef: input.attemptRef,
      request: input.request,
    });
    providerCall.catch(() => undefined);
    let outcome: RenderProviderOutcome | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        providerCall,
        new Promise<undefined>((resolve) => {
          timeoutHandle = setTimeout(() => {
            resolve(undefined);
          }, input.timeoutMs);
        }),
      ]);
    } catch {
      outcome = { outcome: 'FAILED', errorCode: INTEGRATION_RENDER_FAILED, occurredAt: new Date() };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
    if (outcome === undefined) {
      await withRenderTransaction(this.db, context, (trx) =>
        repo.recordFailure(trx, {
          record: claim.record,
          status: 'UNKNOWN',
          errorCode: INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN,
          context,
          occurredAt: new Date(),
        }),
      );
      return this.getRenderAttemptBinding(context, input.attemptRef);
    }
    if (outcome.outcome === 'FAILED') {
      await withRenderTransaction(this.db, context, (trx) =>
        repo.recordFailure(trx, {
          record: claim.record,
          status: 'FAILED',
          errorCode: outcome.errorCode,
          context,
          occurredAt: outcome.occurredAt,
        }),
      );
      return this.getRenderAttemptBinding(context, input.attemptRef);
    }
    let verified: boolean;
    try {
      verified = await this.provider.verifySucceeded({
        attemptRef: input.attemptRef,
        request: input.request,
        outcome,
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      await withRenderTransaction(this.db, context, (trx) =>
        repo.recordFailure(trx, {
          record: claim.record,
          status: 'FAILED',
          errorCode: INTEGRATION_RENDER_OUTPUT_MISMATCH,
          context,
          occurredAt: new Date(),
        }),
      );
      return this.getRenderAttemptBinding(context, input.attemptRef);
    }
    await this.recordSuccess(context, claim.record, outcome, input.failAfterOutbox);
    return this.getRenderAttemptBinding(context, input.attemptRef);
  }

  async reconcileSucceeded(
    context: RenderTransactionContext,
    attemptRef: Common.ObjectRef,
    outcome: RenderProviderSuccess,
  ): Promise<IntegrationGateway.RenderAttemptBindingView> {
    const record = await withRenderTransaction(this.db, context, (trx) =>
      repo.getById(trx, attemptRef.objectId),
    );
    if (record?.status !== 'UNKNOWN') {
      throw new RenderPersistenceError(
        'INTEGRATION_ATTEMPT_TERMINAL',
        'only an authoritative UNKNOWN attempt can be reconciled',
      );
    }
    if (!(await this.provider.verifySucceeded({ attemptRef, request: record.request, outcome }))) {
      throw new RenderPersistenceError(
        'INTEGRATION_RENDER_OUTPUT_MISMATCH',
        'reconciliation output or receipt failed authoritative readback',
      );
    }
    await this.recordSuccess(context, record, outcome);
    return this.getRenderAttemptBinding(context, attemptRef);
  }

  async getRenderAttemptBinding(
    context: RenderTransactionContext,
    attemptRef: Common.ObjectRef,
  ): Promise<IntegrationGateway.RenderAttemptBindingView> {
    const record = await withRenderTransaction(this.db, context, (trx) =>
      repo.getById(trx, attemptRef.objectId),
    );
    if (
      record === undefined ||
      canonicalize(attemptRef as unknown as CanonicalJsonObject) !==
        canonicalize(attemptRefFor(record) as unknown as CanonicalJsonObject)
    ) {
      throw new RenderPersistenceError(
        'INTEGRATION_RENDER_ATTEMPT_NOT_FOUND',
        'render attempt was not found in the authorized scope',
      );
    }
    const requestHash: Common.ContentHash = {
      algorithm: 'SHA-256',
      digest: record.requestPayloadHash.toString('hex'),
      canonicalizationVersion: '1',
    };
    const receiptRef = receiptRefFor(record);
    const binding: IntegrationGateway.RenderAttemptBindingView = {
      attemptRef: attemptRefFor(record),
      status: record.status,
      request: record.request,
      requestPayloadHash: requestHash,
      ...(record.status === 'SUCCEEDED' &&
      record.outputObjectRef !== undefined &&
      record.outputChecksum !== undefined &&
      receiptRef !== undefined
        ? {
            succeededResult: {
              attemptRef: attemptRefFor(record),
              revisionRef: record.request.revisionRef,
              outputObjectRef: record.outputObjectRef,
              outputChecksum: record.outputChecksum,
              rendererId: record.request.rendererId,
              rendererVersion: record.request.rendererVersion,
              rawReceiptRef: receiptRef,
            },
            rawReceiptRef: receiptRef,
          }
        : {}),
    };
    const validation = registry.validateOperationResult(
      'integration.get_render_attempt_binding',
      '1.0',
      binding,
    );
    if (!validation.valid) {
      throw new RenderPersistenceError(
        'INTEGRATION_RENDER_BINDING_INVALID',
        'authoritative RenderAttempt row produced a contract-invalid binding',
      );
    }
    return binding;
  }

  private async recordSuccess(
    context: RenderTransactionContext,
    record: RenderAttemptRecord,
    outcome: RenderProviderSuccess,
    failAfterOutbox?: boolean,
  ): Promise<void> {
    const recordedAt = new Date();
    const receiptId = newUuidV7();
    const receiptHash = receiptContentHash({
      attemptRef: attemptRefFor(record),
      providerReceiptRef: outcome.providerReceiptRef,
      receiptPayloadRef: outcome.receiptPayloadRef,
      receiptPayloadHash: outcome.receiptPayloadHash,
      recordedAt: recordedAt.toISOString(),
    });
    const receipt: RenderReceiptInput = {
      receiptId,
      providerReceiptRef: outcome.providerReceiptRef,
      receiptPayloadRef: outcome.receiptPayloadRef,
      receiptPayloadHash: outcome.receiptPayloadHash,
      receiptContentHash: receiptHash,
      occurredAt: outcome.occurredAt,
      recordedAt,
    };
    await withRenderTransaction(this.db, context, (trx) =>
      repo.recordSuccess(trx, {
        record,
        receipt,
        outputObjectRef: outcome.outputObjectRef,
        outputChecksum: outcome.outputChecksum,
        context,
        ...(failAfterOutbox === undefined ? {} : { failAfterOutbox }),
      }),
    );
  }
}
