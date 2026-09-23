import { createHash } from 'node:crypto';

import {
  ContractRegistry,
  type Common,
  type IntegrationGateway,
  type TaskExecution,
} from '@zhiju/contracts';
import {
  canonicalize,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';

import {
  type IntegrationRendererDb,
  type RenderTransactionContext,
  withRenderTransaction,
} from '../persistence/render-attempt-db.js';
import { RenderPersistenceError } from '../persistence/render-attempt-repository.js';
import type { RenderObjectStoragePort } from '../renderer/in-memory-render-object-storage.js';

const registry = new ContractRegistry();
const ATTEMPT = 'integration.runtime_attempt';
const RECEIPT = 'integration.raw_external_receipt';
const RUNTIME = {
  adapterCode: 'te.human_operated.synthetic',
  adapterVersion: '1.0',
  harnessId: 'zhiju.runtime.synthetic',
  harnessVersion: '1.0',
  provider: 'synthetic',
  modelId: 'synthetic',
  modelConfigHash: {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: sha256CanonicalJson({}),
  },
} as const;

type Binding = TaskExecution.ExecutionGetRunDispatchBindingResult;
type Result = IntegrationGateway.IntegrationGetRuntimeAttemptBindingResult;
type InvocationBinding = Result['invocationBinding'];

export interface SyntheticRuntimeAcknowledgement {
  readonly attemptRef: Common.ObjectRef;
  readonly bindingHash: Common.ContentHash;
  readonly runtimeSessionRef: Common.ExternalRef;
  readonly providerReceiptRef: Common.ExternalRef;
  readonly receiptPayload: CanonicalJsonObject;
  readonly acknowledgedAt: Date;
}

export interface SyntheticRuntimeDriver {
  invoke(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RuntimeDispatchRequest;
    readonly invocationBinding: InvocationBinding;
    readonly bindingHash: Common.ContentHash;
  }): Promise<SyntheticRuntimeAcknowledgement>;
  readBack(attemptRef: Common.ObjectRef): Promise<SyntheticRuntimeAcknowledgement | undefined>;
}

export interface ControlledRuntimeDispatchPorts {
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readDispatchBinding: (runRef: Common.ObjectRef) => Promise<Binding>;
  readonly readBundle: (
    bundleRef: Common.ContentAddressedRef,
    runRef: Common.ObjectRef,
  ) => Promise<{
    readonly bundleRef: CanonicalJsonObject;
    readonly payload: CanonicalJsonObject;
    readonly useStatus: string;
  }>;
  readonly authorizeReceipt: (
    receiptRef: Common.ObjectRef,
    receipt: CanonicalJsonObject,
  ) => Promise<() => Promise<void>>;
}

function invalid(code = 'INTEGRATION_RUNTIME_BINDING_INVALID'): never {
  throw new RenderPersistenceError(
    code,
    'controlled runtime binding is invalid or no longer current',
  );
}
function same(left: unknown, right: unknown): boolean {
  return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
}
function object(value: unknown): CanonicalJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as CanonicalJsonObject;
}
function hash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', canonicalizationVersion: '1', digest };
}
function sha(value: CanonicalJsonValue): Common.ContentHash {
  return hash(sha256CanonicalJson(value));
}
function scope(
  context: RenderTransactionContext,
): Common.ScopeRef & { readonly projectId: string } {
  if (context.allowedProjectIds.length !== 1) invalid();
  const projectId = context.allowedProjectIds[0] ?? invalid();
  return { enterpriseId: context.enterpriseId, projectId };
}
function attemptRef(id: string, subjectScope: Common.ScopeRef): Common.ObjectRef {
  return { kind: 'OBJECT', objectType: ATTEMPT, objectId: id, scope: subjectScope };
}
function assertLive(now: Date, ...instants: readonly (string | undefined)[]) {
  if (
    instants.some(
      (instant) =>
        instant !== undefined &&
        (!Number.isFinite(Date.parse(instant)) || now.getTime() >= Date.parse(instant)),
    )
  )
    invalid();
}
function invocationOf(binding: Binding): InvocationBinding {
  return {
    runRef: binding.runRef,
    workOrderContractRef: binding.workOrderContractRef,
    contextSnapshotRef: binding.contextSnapshotRef,
    capabilityGrantRef: binding.capabilityGrantRef,
    leaseId: binding.leaseId,
    fencingToken: binding.fencingToken,
    leaseExpiresAt: binding.leaseExpiresAt,
    runtimeBinding: binding.runtimeBinding as unknown as CanonicalJsonValue,
  };
}
function receiptRef(
  id: string,
  digest: string,
  subjectScope: Common.ScopeRef,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: RECEIPT,
    objectId: id,
    scope: subjectScope,
    contentHash: hash(digest),
  };
}

async function validateDependencies(
  ports: ControlledRuntimeDispatchPorts,
  subjectScope: Common.ScopeRef,
  request: IntegrationGateway.RuntimeDispatchRequest,
): Promise<Binding> {
  const now = ports.now();
  const binding = await ports.readDispatchBinding(request.runRef);
  if (
    !same(request.runRef.scope, subjectScope) ||
    binding.status !== 'CREATED' ||
    !same(binding.runRef, request.runRef) ||
    !same(binding.workOrderRef, request.workOrderRef) ||
    !same(binding.workOrderContractRef, request.workOrderContractRef) ||
    !same(binding.contextSnapshotRef, request.contextSnapshotRef) ||
    !same(binding.capabilityGrantRef, request.capabilityGrantRef) ||
    !same(binding.runtimeBinding, request.runtimeBinding) ||
    !same(binding.runtimeBinding, RUNTIME) ||
    binding.fencingToken !== 1 ||
    binding.aggregateVersion !== 1 ||
    !binding.leaseId ||
    !request.stableIdempotencyKey ||
    !Number.isFinite(Date.parse(request.requestedAt))
  )
    invalid();
  assertLive(now, binding.leaseExpiresAt, binding.executionDeadline);
  const bundle = await ports.readBundle(request.capabilityGrantRef, request.runRef);
  if (
    bundle.useStatus !== 'USABLE' ||
    !same(bundle.bundleRef, request.capabilityGrantRef) ||
    sha256CanonicalJson(bundle.payload) !== request.capabilityGrantRef.contentHash.digest ||
    !same(bundle.payload.runRef, request.runRef) ||
    !same(bundle.payload.workOrderContractRef, request.workOrderContractRef) ||
    !same(bundle.payload.contextSnapshotRef, request.contextSnapshotRef)
  )
    invalid();
  assertLive(
    ports.now(),
    typeof bundle.payload.validUntil === 'string' ? bundle.payload.validUntil : undefined,
    binding.leaseExpiresAt,
  );
  await ports.revalidateAuthorization();
  return binding;
}

export class ControlledRuntimeDispatchService {
  constructor(
    private readonly db: Kysely<IntegrationRendererDb>,
    private readonly driver: SyntheticRuntimeDriver,
    private readonly storage: RenderObjectStoragePort,
    private readonly ports: ControlledRuntimeDispatchPorts,
  ) {}

  async dispatch(
    context: RenderTransactionContext,
    input: {
      readonly attemptRef: Common.ObjectRef;
      readonly request: IntegrationGateway.RuntimeDispatchRequest;
    },
  ): Promise<Result> {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (input.attemptRef.objectType !== ATTEMPT || !same(input.attemptRef.scope, subjectScope))
      invalid();
    const binding = await validateDependencies(this.ports, subjectScope, input.request);
    const invocationBinding = invocationOf(binding);
    const requestHash = sha(input.request as unknown as CanonicalJsonValue);
    const bindingHash = sha({
      attemptRef: input.attemptRef,
      request: input.request,
      invocationBinding,
    } as unknown as CanonicalJsonValue);
    const stableKeyHash = createHash('sha256')
      .update(input.request.stableIdempotencyKey, 'utf8')
      .digest();
    const claimed = await withRenderTransaction(this.db, context, async (trx) => {
      const inserted = await trx
        .insertInto('integration_gateway.runtime_attempt')
        .values({
          attempt_id: input.attemptRef.objectId,
          enterprise_id: context.enterpriseId,
          project_id: subjectScope.projectId,
          stable_key_hash: stableKeyHash,
          request_payload: canonicalize(input.request as unknown as CanonicalJsonValue),
          request_payload_hash: Buffer.from(requestHash.digest, 'hex'),
          invocation_binding: canonicalize(invocationBinding as unknown as CanonicalJsonValue),
          binding_hash: Buffer.from(bindingHash.digest, 'hex'),
          created_at: this.ports.now(),
          updated_at: this.ports.now(),
        })
        .onConflict((oc) => oc.doNothing())
        .returning('attempt_id')
        .executeTakeFirst();
      const row = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('enterprise_id', '=', context.enterpriseId)
        .where('project_id', '=', subjectScope.projectId)
        .where('stable_key_hash', '=', stableKeyHash)
        .executeTakeFirst();
      if (
        row?.attempt_id !== input.attemptRef.objectId ||
        !row.request_payload_hash.equals(Buffer.from(requestHash.digest, 'hex')) ||
        !row.binding_hash.equals(Buffer.from(bindingHash.digest, 'hex'))
      )
        invalid('INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT');
      await this.ports.revalidateAuthorization();
      return inserted !== undefined;
    });
    if (!claimed) return this.getBinding(context, input.attemptRef);
    let acknowledgement: SyntheticRuntimeAcknowledgement;
    try {
      acknowledgement = await this.driver.invoke({
        attemptRef: input.attemptRef,
        request: input.request,
        invocationBinding,
        bindingHash,
      });
    } catch {
      await this.markUnknown(context, input.attemptRef, bindingHash);
      return this.getBinding(context, input.attemptRef);
    }
    await this.commitAcknowledgement(
      context,
      input.attemptRef,
      input.request,
      invocationBinding,
      bindingHash,
      acknowledgement,
    );
    return this.getBinding(context, input.attemptRef);
  }

  async reconcileUnknown(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
  ): Promise<Result> {
    await this.ports.revalidateAuthorization();
    const original = await this.getBinding(context, ref);
    if (original.status !== 'UNKNOWN') invalid('INTEGRATION_ATTEMPT_TERMINAL');
    const acknowledgement = await this.driver.readBack(ref);
    if (acknowledgement === undefined) return original;
    const subjectScope = scope(context);
    const binding = await validateDependencies(this.ports, subjectScope, original.request);
    if (!same(invocationOf(binding), original.invocationBinding)) invalid();
    await this.commitAcknowledgement(
      context,
      ref,
      original.request,
      original.invocationBinding,
      original.bindingHash,
      acknowledgement,
      true,
    );
    return this.getBinding(context, ref);
  }

  async getBinding(context: RenderTransactionContext, ref: Common.ObjectRef): Promise<Result> {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope)) invalid();
    return withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (
        row?.enterprise_id !== subjectScope.enterpriseId ||
        row.project_id !== subjectScope.projectId
      )
        invalid('INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND');
      const request = object(
        row.request_payload,
      ) as unknown as IntegrationGateway.RuntimeDispatchRequest;
      const invocationBinding = object(row.invocation_binding) as unknown as InvocationBinding;
      const bindingHash = hash(row.binding_hash.toString('hex'));
      if (
        sha256CanonicalJson(request as unknown as CanonicalJsonValue) !==
          row.request_payload_hash.toString('hex') ||
        sha256CanonicalJson({
          attemptRef: ref,
          request,
          invocationBinding,
        } as unknown as CanonicalJsonValue) !== bindingHash.digest
      )
        invalid();
      const observation = await trx
        .selectFrom('integration_gateway.runtime_attempt_observation')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if ((row.status === 'SUCCEEDED') !== (observation !== undefined)) invalid();
      let acknowledgement: Result['acknowledgement'];
      if (observation !== undefined) {
        const receipt = await trx
          .selectFrom('integration_gateway.raw_external_receipt')
          .selectAll()
          .where('receipt_id', '=', observation.raw_receipt_id)
          .executeTakeFirst();
        if (
          receipt?.attempt_kind !== 'RUNTIME' ||
          receipt.runtime_attempt_id !== ref.objectId ||
          receipt.observed_outcome !== 'SUCCEEDED' ||
          observation.observation_hash.toString('hex') !==
            sha256CanonicalJson(object(observation.observation_payload))
        )
          invalid();
        acknowledgement = {
          observationId: observation.observation_id,
          rawReceiptRef: receiptRef(
            receipt.receipt_id,
            receipt.receipt_content_hash.toString('hex'),
            subjectScope,
          ),
          runtimeSessionRef: object(
            observation.runtime_session_ref,
          ) as unknown as Common.ExternalRef,
          acknowledgedAt: observation.acknowledged_at.toISOString(),
          source: observation.acknowledgement_source,
        };
      }
      const result: Result = {
        attemptRef: ref as Result['attemptRef'],
        status: row.status,
        request,
        requestPayloadHash: hash(row.request_payload_hash.toString('hex')),
        invocationBinding,
        bindingHash,
        ...(acknowledgement === undefined ? {} : { acknowledgement }),
      };
      if (
        !registry.validateOperationResult('integration.get_runtime_attempt_binding', '1.0', result)
          .valid
      )
        invalid();
      await this.ports.revalidateAuthorization();
      return result;
    });
  }

  private async markUnknown(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
    bindingHash: Common.ContentHash,
  ): Promise<void> {
    await withRenderTransaction(this.db, context, async (trx) => {
      await trx
        .updateTable('integration_gateway.runtime_attempt')
        .set({ status: 'UNKNOWN', updated_at: this.ports.now() })
        .where('attempt_id', '=', ref.objectId)
        .where('binding_hash', '=', Buffer.from(bindingHash.digest, 'hex'))
        .where('status', '=', 'CREATED')
        .execute();
      await this.ports.revalidateAuthorization();
    });
  }

  private async commitAcknowledgement(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
    request: IntegrationGateway.RuntimeDispatchRequest,
    invocationBinding: InvocationBinding,
    bindingHash: Common.ContentHash,
    acknowledgement: SyntheticRuntimeAcknowledgement,
    reconcile = false,
  ): Promise<void> {
    if (
      !same(acknowledgement.attemptRef, ref) ||
      !same(acknowledgement.bindingHash, bindingHash) ||
      acknowledgement.runtimeSessionRef.system !== 'zhiju.runtime.synthetic' ||
      acknowledgement.providerReceiptRef.system !== 'zhiju.runtime.synthetic' ||
      acknowledgement.providerReceiptRef.externalId !== ref.objectId ||
      !Number.isFinite(acknowledgement.acknowledgedAt.getTime())
    )
      invalid();
    await validateDependencies(this.ports, scope(context), request);
    const receiptId = newUuidV7(),
      observationId = newUuidV7();
    const receiptBytes = Buffer.from(canonicalize(acknowledgement.receiptPayload), 'utf8');
    const locator = `integration/runtime/receipt/${ref.objectId}.json`;
    const recordedAt = this.ports.now();
    assertLive(recordedAt, invocationBinding.leaseExpiresAt);
    const revalidateReceipt = await this.ports.authorizeReceipt(
      {
        kind: 'OBJECT',
        objectType: RECEIPT,
        objectId: receiptId,
        scope: scope(context),
      },
      {
        attemptKind: 'RUNTIME',
        attemptRef: ref as unknown as CanonicalJsonValue,
        providerReceiptRef: acknowledgement.providerReceiptRef as unknown as CanonicalJsonValue,
        receiptPayloadRef: locator,
        receiptPayloadHash: sha(acknowledgement.receiptPayload),
        observedOutcome: 'SUCCEEDED',
        occurredAt: acknowledgement.acknowledgedAt.toISOString(),
        recordedAt: recordedAt.toISOString(),
      } as unknown as CanonicalJsonObject,
    );
    await revalidateReceipt();
    const stored = await this.storage.putImmutable({
      locator,
      bytes: receiptBytes,
      mediaType: 'application/json',
    });
    const readBack = await this.storage.read(locator);
    if (
      readBack === undefined ||
      !readBack.bytes.equals(receiptBytes) ||
      readBack.checksum.digest !== stored.checksum.digest ||
      stored.checksum.digest !== sha256CanonicalJson(acknowledgement.receiptPayload)
    )
      invalid();
    assertLive(this.ports.now(), invocationBinding.leaseExpiresAt);
    const receiptContent = {
      attemptRef: ref,
      providerReceiptRef: acknowledgement.providerReceiptRef,
      receiptPayloadRef: locator,
      receiptPayloadHash: stored.checksum,
      recordedAt: recordedAt.toISOString(),
    };
    const receiptHash = sha(receiptContent as unknown as CanonicalJsonValue);
    const observationPayload = {
      attemptRef: ref,
      bindingHash,
      rawReceiptRef: receiptRef(receiptId, receiptHash.digest, scope(context)),
      runtimeSessionRef: acknowledgement.runtimeSessionRef,
      acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
      source: 'SYNTHETIC_DRIVER',
    } as unknown as CanonicalJsonObject;
    await withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .forUpdate()
        .executeTakeFirst();
      if (
        row?.status !== (reconcile ? 'UNKNOWN' : 'CREATED') ||
        !row.binding_hash.equals(Buffer.from(bindingHash.digest, 'hex'))
      )
        invalid();
      await trx
        .insertInto('integration_gateway.raw_external_receipt')
        .values({
          receipt_id: receiptId,
          enterprise_id: context.enterpriseId,
          project_id: scope(context).projectId,
          attempt_id: null,
          attempt_kind: 'RUNTIME',
          runtime_attempt_id: ref.objectId,
          provider_receipt_ref: canonicalize(
            acknowledgement.providerReceiptRef as unknown as CanonicalJsonValue,
          ),
          receipt_payload_ref: locator,
          receipt_payload_hash: Buffer.from(stored.checksum.digest, 'hex'),
          receipt_content_hash: Buffer.from(receiptHash.digest, 'hex'),
          observed_outcome: 'SUCCEEDED',
          occurred_at: acknowledgement.acknowledgedAt,
          recorded_at: recordedAt,
        })
        .execute();
      await trx
        .insertInto('integration_gateway.runtime_attempt_observation')
        .values({
          observation_id: observationId,
          attempt_id: ref.objectId,
          enterprise_id: context.enterpriseId,
          project_id: scope(context).projectId,
          raw_receipt_id: receiptId,
          runtime_session_ref: canonicalize(
            acknowledgement.runtimeSessionRef as unknown as CanonicalJsonValue,
          ),
          acknowledgement_source: 'SYNTHETIC_DRIVER',
          acknowledged_at: acknowledgement.acknowledgedAt,
          observation_payload: canonicalize(observationPayload),
          observation_hash: Buffer.from(sha256CanonicalJson(observationPayload), 'hex'),
        })
        .execute();
      await trx
        .updateTable('integration_gateway.runtime_attempt')
        .set({ status: 'SUCCEEDED', updated_at: recordedAt })
        .where('attempt_id', '=', ref.objectId)
        .execute();
      const eventPayload = {
        attemptRef: ref,
        workOrderRef: request.workOrderRef,
        runRef: request.runRef,
        runtimeSessionRef: acknowledgement.runtimeSessionRef,
        rawReceiptRef: receiptRef(receiptId, receiptHash.digest, scope(context)),
      };
      const outboxPayload = {
        enterpriseId: context.enterpriseId,
        projectId: scope(context).projectId,
        event: eventPayload,
      } as unknown as CanonicalJsonObject;
      await trx
        .insertInto('integration_gateway.outbox_event')
        .values({
          event_id: newUuidV7(),
          event_type: 'integration.RuntimeDispatchSucceeded',
          event_version: '1.0',
          aggregate_type: 'RuntimeAttempt',
          aggregate_id: ref.objectId,
          aggregate_version: reconcile ? 3 : 2,
          enterprise_id: context.enterpriseId,
          project_id: scope(context).projectId,
          correlation_id: context.correlationId,
          causation_id: context.sourceEventId ?? null,
          payload: canonicalize(outboxPayload),
          payload_hash: Buffer.from(sha256CanonicalJson(outboxPayload), 'hex'),
          canonicalization_version: '1',
          occurred_at: acknowledgement.acknowledgedAt,
          lease_owner: null,
          lease_until: null,
          lease_token: null,
          last_error_code: null,
          published_at: null,
          created_by_principal_id: context.principalId,
          source_command_id: ref.objectId,
        })
        .execute();
      await this.ports.revalidateAuthorization();
      await revalidateReceipt();
    });
  }
}

export class LocalSyntheticRuntimeDriver implements SyntheticRuntimeDriver {
  private readonly observations = new Map<string, SyntheticRuntimeAcknowledgement>();
  readonly invokedAttemptIds: string[] = [];

  invoke(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RuntimeDispatchRequest;
    readonly invocationBinding: InvocationBinding;
    readonly bindingHash: Common.ContentHash;
  }): Promise<SyntheticRuntimeAcknowledgement> {
    this.invokedAttemptIds.push(input.attemptRef.objectId);
    const acknowledgedAt = new Date();
    const runtimeSessionRef: Common.ExternalRef = {
      system: 'zhiju.runtime.synthetic',
      resourceType: 'runtime_session',
      externalId: input.attemptRef.objectId,
      observedAt: acknowledgedAt.toISOString(),
    };
    const result: SyntheticRuntimeAcknowledgement = {
      attemptRef: input.attemptRef,
      bindingHash: input.bindingHash,
      runtimeSessionRef,
      providerReceiptRef: {
        system: 'zhiju.runtime.synthetic',
        resourceType: 'dispatch_acknowledgement',
        externalId: input.attemptRef.objectId,
        observedAt: acknowledgedAt.toISOString(),
      },
      receiptPayload: {
        attemptRef: input.attemptRef,
        bindingHash: input.bindingHash,
        runtimeSessionRef,
        acknowledgedAt: acknowledgedAt.toISOString(),
        source: 'SYNTHETIC_DRIVER',
      } as unknown as CanonicalJsonObject,
      acknowledgedAt,
    };
    this.observations.set(input.attemptRef.objectId, result);
    return Promise.resolve(result);
  }

  readBack(ref: Common.ObjectRef): Promise<SyntheticRuntimeAcknowledgement | undefined> {
    return Promise.resolve(this.observations.get(ref.objectId));
  }
}
