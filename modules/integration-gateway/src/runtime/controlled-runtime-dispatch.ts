import { createHash } from 'node:crypto';

import {
  getContractRegistry,
  type Common,
  type IntegrationGateway,
  type TaskExecution,
} from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { Kysely, Selectable } from 'kysely';

import {
  type IntegrationRendererDb,
  type RawExternalReceiptTable,
  type RuntimeAdapterIdentityTable,
  type RuntimeAttemptObservationTable,
  type RuntimeAttemptTable,
  type RuntimeFinalObservationTable,
  type RenderTransaction,
  type RenderTransactionContext,
  withRenderTransaction,
} from '../persistence/render-attempt-db.js';
import { RenderPersistenceError } from '../persistence/render-attempt-repository.js';
import type { RenderObjectStoragePort } from '../renderer/in-memory-render-object-storage.js';

const registry = getContractRegistry();
const ATTEMPT = 'integration.runtime_attempt';
const RECEIPT = 'integration.raw_external_receipt';
const USAGE_CODES = {
  attemptNotFound: 'INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND',
  bindingInvalid: 'INTEGRATION_RUNTIME_BINDING_INVALID',
  identityInvalid: 'INTEGRATION_RUNTIME_IDENTITY_INVALID',
  finalNotFound: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND',
  finalInvalid: 'INTEGRATION_RUNTIME_FINAL_INVALID',
} as const;
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
  readonly runtimeAdapterIdentityRef: Common.ObjectRef;
  readonly bindingHash: Common.ContentHash;
  readonly runtimeSessionRef: Common.ExternalRef;
  readonly providerReceiptRef: Common.ExternalRef;
  readonly receiptPayload: CanonicalJsonObject;
  readonly acknowledgedAt: Date;
}

export interface SyntheticRuntimeFinal {
  readonly attemptRef: Common.ObjectRef;
  readonly runtimeAdapterIdentityRef: Common.ObjectRef;
  readonly bindingHash: Common.ContentHash;
  readonly runtimeSubmissionRef: Common.ExternalRef;
  readonly runFencingToken: number;
  readonly agentResultContract: CanonicalJsonObject;
  readonly observedAt: Date;
}

export interface FormalOutputReleasePorts {
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readExecutionOutput: (
    revisionRef: Common.ContentAddressedRef,
  ) => Promise<CanonicalJsonObject>;
}
export const FORMAL_RUNTIME_TEMPLATES = [
  'formal-completed-v1',
  'formal-blocked-input-v1',
  'formal-recovered-completed-v1',
] as const;
export interface SyntheticRuntimeDriver {
  invoke(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly runtimeAdapterIdentityRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RuntimeDispatchRequest;
    readonly invocationBinding: InvocationBinding;
    readonly bindingHash: Common.ContentHash;
  }): Promise<SyntheticRuntimeAcknowledgement>;
  readBack(attemptRef: Common.ObjectRef): Promise<SyntheticRuntimeAcknowledgement | undefined>;
  readFinal?(attemptRef: Common.ObjectRef): Promise<SyntheticRuntimeFinal | undefined>;
  releaseFinal?(attemptRef: Common.ObjectRef): Promise<void>;
  releaseFormalOutput?(
    attemptRef: Common.ObjectRef,
    output: CanonicalJsonObject,
    ports: FormalOutputReleasePorts,
  ): Promise<void>;
}

export interface ControlledRuntimeDispatchPorts {
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readDispatchBinding: (runRef: Common.ObjectRef) => Promise<Binding>;
  readonly readFrozenEligibility?: (
    contextRef: CanonicalJsonObject,
    contractRef: CanonicalJsonObject,
  ) => Promise<CanonicalJsonObject>;
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

export interface RuntimeDispatchCommand {
  readonly commandId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId?: string;
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
function stringValue(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}
function objectWith(code: string, value: unknown): CanonicalJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(code);
  return value as CanonicalJsonObject;
}
function stringWith(code: string, value: unknown): string {
  if (typeof value !== 'string') invalid(code);
  return value;
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

async function completeDispatchReceipt(
  trx: RenderTransaction,
  sourceCommandId: string,
  result: Result,
  completedAt: Date,
): Promise<void> {
  if (
    !registry.validateOperationResult('integration.get_runtime_attempt_binding', '1.0', result)
      .valid
  )
    invalid();
  const payload = result as unknown as CanonicalJsonValue;
  const updated = await trx
    .updateTable('integration_gateway.command_receipt')
    .set({
      outcome: 'COMMITTED',
      result_payload: canonicalize(payload),
      result_payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
      completed_at: completedAt,
    })
    .where('command_id', '=', sourceCommandId)
    .where('command_type', '=', 'integration.request_runtime_dispatch')
    .where('target_id', '=', result.attemptRef.objectId)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) !== 1) invalid();
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
    (!same(binding.runtimeBinding, RUNTIME) &&
      !same(binding.runtimeBinding, {
        ...RUNTIME,
        adapterCode: 'te.human_operated.synthetic.formal',
      })) ||
    ![1, 2].includes(binding.fencingToken) ||
    binding.aggregateVersion !== 1 ||
    !binding.leaseId ||
    !request.stableIdempotencyKey ||
    !Number.isFinite(Date.parse(request.requestedAt))
  )
    invalid();
  assertLive(now, binding.leaseExpiresAt, binding.executionDeadline);
  if (binding.fencingToken === 2) {
    if (!ports.readFrozenEligibility) invalid();
    const eligibility = await ports.readFrozenEligibility(
      request.contextSnapshotRef as unknown as CanonicalJsonObject,
      request.workOrderContractRef as unknown as CanonicalJsonObject,
    );
    if (
      eligibility.useStatus !== 'USABLE' ||
      typeof eligibility.validUntil !== 'string' ||
      !same(eligibility.contextSnapshotRef, request.contextSnapshotRef) ||
      !same(eligibility.workOrderContractRef, request.workOrderContractRef)
    )
      invalid();
    assertLive(ports.now(), eligibility.validUntil);
  }
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
      readonly command: RuntimeDispatchCommand;
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
    const plannedInstanceId = newUuidV7();
    if (
      input.command.correlationId !== context.correlationId ||
      !input.command.idempotencyScope ||
      !input.command.idempotencyKey
    )
      invalid();
    const commandPayloadHash = Buffer.from(
      sha256CanonicalJson({ request: input.request as unknown as CanonicalJsonValue }),
      'hex',
    );
    const claimed = await withRenderTransaction(this.db, context, async (trx) => {
      const claimedAt = this.ports.now();
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
          planned_runtime_instance_id: plannedInstanceId,
          source_command_id: input.command.commandId,
          created_at: claimedAt,
          updated_at: claimedAt,
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
      if (inserted !== undefined) {
        await trx
          .insertInto('integration_gateway.command_receipt')
          .values({
            command_id: input.command.commandId,
            command_type: 'integration.request_runtime_dispatch',
            command_version: '1.0',
            idempotency_scope: input.command.idempotencyScope,
            idempotency_key: input.command.idempotencyKey,
            request_payload_hash: commandPayloadHash,
            enterprise_id: context.enterpriseId,
            project_id: subjectScope.projectId,
            target_type: ATTEMPT,
            target_id: input.attemptRef.objectId,
            outcome: 'PENDING',
            first_seen_at: claimedAt,
            correlation_id: context.correlationId,
            causation_id: input.command.causationId ?? null,
            created_by_principal_id: context.principalId,
            actor_snapshot_id: context.actorSnapshotId,
            authorization_decision_id: context.authorizationDecisionId,
          })
          .execute();
        await trx
          .insertInto('integration_gateway.audit_record')
          .values({
            audit_id: newUuidV7(),
            enterprise_id: context.enterpriseId,
            project_id: subjectScope.projectId,
            principal_id: context.principalId,
            actor_snapshot_id: context.actorSnapshotId,
            authorization_decision_id: context.authorizationDecisionId,
            command_id: input.command.commandId,
            command_type: 'integration.request_runtime_dispatch',
            outcome: 'COMMITTED',
            request_payload_hash: commandPayloadHash,
            target_type: ATTEMPT,
            target_id: input.attemptRef.objectId,
            correlation_id: context.correlationId,
            causation_id: input.command.causationId ?? null,
            safe_summary: 'runtime attempt created before driver invocation',
            recorded_at: claimedAt,
            retention_class: 'BUSINESS_AUDIT',
          })
          .execute();
        const references = [
          { path: '/request/runRef', module: 'task-execution', ref: input.request.runRef },
          {
            path: '/request/workOrderRef',
            module: 'task-execution',
            ref: input.request.workOrderRef,
          },
          {
            path: '/request/workOrderContractRef',
            module: 'task-execution',
            ref: input.request.workOrderContractRef,
          },
          {
            path: '/request/contextSnapshotRef',
            module: 'task-execution',
            ref: input.request.contextSnapshotRef,
          },
          {
            path: '/request/capabilityGrantRef',
            module: 'identity-policy',
            ref: input.request.capabilityGrantRef,
          },
        ];
        for (const reference of references) {
          const target = object(reference.ref);
          await trx
            .insertInto('integration_gateway.reference_edge')
            .values({
              owner_object_type: ATTEMPT,
              owner_object_id: input.attemptRef.objectId,
              owner_payload_hash: Buffer.from(bindingHash.digest, 'hex'),
              reference_path: reference.path,
              target_module: reference.module,
              target_object_type: stringValue(target.objectType),
              target_object_id: stringValue(target.objectId),
              target_version_id: typeof target.snapshotId === 'string' ? target.snapshotId : null,
              target_payload_hash:
                target.contentHash === undefined
                  ? null
                  : Buffer.from(stringValue(object(target.contentHash).digest), 'hex'),
              reference_purpose: 'RUNTIME_DISPATCH_BINDING',
              enterprise_id: context.enterpriseId,
              project_id: subjectScope.projectId,
              source_command_id: input.command.commandId,
            })
            .execute();
        }
      }
      await this.ports.revalidateAuthorization();
      return inserted !== undefined;
    });
    if (!claimed) {
      const original = await this.getBinding(context, input.attemptRef);
      if (original.status !== 'CREATED') return original;
      const acknowledgement = await this.driver.readBack(input.attemptRef);
      if (acknowledgement === undefined) return original;
      await this.commitAcknowledgement(
        context,
        input.attemptRef,
        original.request,
        original.invocationBinding,
        original.bindingHash,
        acknowledgement,
      );
      return this.getBinding(context, input.attemptRef);
    }
    const runtimeAdapterIdentityRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: 'zhiju.runtime.runtime',
      objectId: plannedInstanceId,
      scope: subjectScope,
    };
    let acknowledgement: SyntheticRuntimeAcknowledgement;
    try {
      acknowledgement = await this.driver.invoke({
        attemptRef: input.attemptRef,
        runtimeAdapterIdentityRef,
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

  async readRuntimeAdapterIdentityForAttempt(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
  ) {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope)) invalid();
    return withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      const identity = await trx
        .selectFrom('integration_gateway.runtime_adapter_identity')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (row?.status !== 'SUCCEEDED' || identity === undefined) invalid();
      if (
        identity.instance_id !== row.planned_runtime_instance_id ||
        row.enterprise_id !== subjectScope.enterpriseId ||
        row.project_id !== subjectScope.projectId ||
        !identity.binding_hash.equals(row.binding_hash)
      )
        invalid();
      const result = {
        runtimeAdapterIdentityRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.runtime.runtime',
          objectId: identity.instance_id,
          scope: subjectScope,
        },
        attemptRef: ref,
        runRef: object(object(row.invocation_binding).runRef),
        bindingHash: hash(row.binding_hash.toString('hex')),
        runtimeBinding: object(object(row.invocation_binding).runtimeBinding),
        ackObservationId: identity.ack_observation_id,
        source: identity.source,
      };
      await this.ports.revalidateAuthorization();
      return result;
    });
  }

  async observeFinal(context: RenderTransactionContext, ref: Common.ObjectRef) {
    await this.ports.revalidateAuthorization();
    if (this.driver.readFinal === undefined) invalid('INTEGRATION_RUNTIME_FINAL_UNAVAILABLE');
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope)) invalid();
    const actual = await this.driver.readFinal(ref);
    if (actual === undefined) return undefined;
    const outcome = await withRenderTransaction(this.db, context, async (trx) => {
      const attempt = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .forUpdate()
        .executeTakeFirst();
      const identity = await trx
        .selectFrom('integration_gateway.runtime_adapter_identity')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      const acknowledgement =
        identity === undefined
          ? undefined
          : await trx
              .selectFrom('integration_gateway.runtime_attempt_observation')
              .selectAll()
              .where('observation_id', '=', identity.ack_observation_id)
              .executeTakeFirst();
      if (
        attempt?.status !== 'SUCCEEDED' ||
        identity === undefined ||
        acknowledgement?.attempt_id !== ref.objectId ||
        acknowledgement.enterprise_id !== subjectScope.enterpriseId ||
        acknowledgement.project_id !== subjectScope.projectId ||
        attempt.enterprise_id !== subjectScope.enterpriseId ||
        attempt.project_id !== subjectScope.projectId ||
        !same(actual.attemptRef, ref) ||
        !same(actual.runtimeAdapterIdentityRef, {
          kind: 'OBJECT',
          objectType: 'zhiju.runtime.runtime',
          objectId: identity.instance_id,
          scope: subjectScope,
        }) ||
        !same(actual.bindingHash, hash(attempt.binding_hash.toString('hex'))) ||
        !Number.isSafeInteger(actual.runFencingToken) ||
        actual.runFencingToken !== object(attempt.invocation_binding).fencingToken ||
        actual.agentResultContract.submittedByRuntime === undefined ||
        !same(actual.agentResultContract.submittedByRuntime, actual.runtimeAdapterIdentityRef) ||
        !same(actual.agentResultContract.runRef, object(attempt.invocation_binding).runRef) ||
        !same(
          object(actual.agentResultContract.provenance).runtimeSessionExternalRef,
          object(acknowledgement.runtime_session_ref),
        ) ||
        !same(
          object(object(actual.agentResultContract.header).payloadHash),
          hash(hashContractPayload(actual.agentResultContract)),
        ) ||
        !same(object(actual.agentResultContract.header).scopeRef, subjectScope) ||
        !registry.validateCoreContract(
          'https://schemas.zhiju.local/core/agent-result/1.0',
          actual.agentResultContract,
        ).valid
      )
        invalid();
      const resultHash = hash(hashContractPayload(actual.agentResultContract));
      const current = await trx
        .selectFrom('integration_gateway.runtime_final_observation')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (current !== undefined) {
        if (
          !current.result_payload_hash.equals(Buffer.from(resultHash.digest, 'hex')) ||
          !same(current.runtime_submission_ref, actual.runtimeSubmissionRef)
        ) {
          await this.ports.revalidateAuthorization();
          await trx
            .insertInto('integration_gateway.audit_record')
            .values({
              audit_id: newUuidV7(),
              enterprise_id: context.enterpriseId,
              project_id: subjectScope.projectId,
              principal_id: context.principalId,
              actor_snapshot_id: context.actorSnapshotId,
              authorization_decision_id: context.authorizationDecisionId,
              command_id: attempt.source_command_id,
              command_type: 'integration.request_runtime_dispatch',
              outcome: 'DENIED',
              error_code: 'INTEGRATION_RUNTIME_FINAL_CONFLICT',
              request_payload_hash: Buffer.from(resultHash.digest, 'hex'),
              target_type: ATTEMPT,
              target_id: ref.objectId,
              correlation_id: context.correlationId,
              safe_summary: 'synthetic final conflicts with the immutable observation',
              recorded_at: this.ports.now(),
              retention_class: 'BUSINESS_AUDIT',
            })
            .execute();
          await this.ports.revalidateAuthorization();
          return { conflict: true } as const;
        }
        await this.ports.revalidateAuthorization();
        return this.finalFromRow(ref, subjectScope, current);
      }
      const observationId = newUuidV7();
      const payload = {
        observationId,
        attemptId: ref.objectId,
        runtimeAdapterIdentityRef: actual.runtimeAdapterIdentityRef,
        runtimeSubmissionRef: actual.runtimeSubmissionRef,
        resultPayloadHash: resultHash,
        bindingHash: actual.bindingHash,
        observedAt: actual.observedAt.toISOString(),
        source: 'SYNTHETIC_DRIVER',
      } as unknown as CanonicalJsonObject;
      await trx
        .insertInto('integration_gateway.runtime_final_observation')
        .values({
          observation_id: observationId,
          attempt_id: ref.objectId,
          enterprise_id: context.enterpriseId,
          project_id: subjectScope.projectId,
          ack_observation_id: identity.ack_observation_id,
          runtime_adapter_identity_id: identity.instance_id,
          runtime_submission_ref: canonicalize(
            actual.runtimeSubmissionRef as unknown as CanonicalJsonValue,
          ),
          result_payload: canonicalize(actual.agentResultContract),
          result_payload_hash: Buffer.from(resultHash.digest, 'hex'),
          binding_hash: attempt.binding_hash,
          fencing_token: String(actual.runFencingToken),
          observed_at: actual.observedAt,
          source: 'SYNTHETIC_DRIVER',
          source_command_id: attempt.source_command_id,
          canonical_payload: canonicalize(payload),
          payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
        })
        .execute();
      await trx
        .insertInto('integration_gateway.audit_record')
        .values({
          audit_id: newUuidV7(),
          enterprise_id: context.enterpriseId,
          project_id: subjectScope.projectId,
          principal_id: context.principalId,
          actor_snapshot_id: context.actorSnapshotId,
          authorization_decision_id: context.authorizationDecisionId,
          command_id: attempt.source_command_id,
          command_type: 'integration.request_runtime_dispatch',
          outcome: 'INFO',
          result_payload_hash: Buffer.from(resultHash.digest, 'hex'),
          target_type: 'zhiju.integration.runtime_final_observation',
          target_id: observationId,
          correlation_id: context.correlationId,
          safe_summary: 'synthetic final observation committed',
          recorded_at: this.ports.now(),
          retention_class: 'BUSINESS_AUDIT',
        })
        .execute();
      for (const reference of [
        { path: '/attemptRef', module: 'integration-gateway', ref },
        {
          path: '/runRef',
          module: 'task-execution',
          ref: object(actual.agentResultContract.runRef),
        },
        {
          path: '/runtimeAdapterIdentityRef',
          module: 'integration-gateway',
          ref: actual.runtimeAdapterIdentityRef,
        },
      ]) {
        await trx
          .insertInto('integration_gateway.reference_edge')
          .values({
            owner_object_type: 'zhiju.integration.runtime_final_observation',
            owner_object_id: observationId,
            owner_payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
            reference_path: reference.path,
            target_module: reference.module,
            target_object_type: stringValue(reference.ref.objectType),
            target_object_id: stringValue(reference.ref.objectId),
            reference_purpose: 'RUNTIME_FINAL_BINDING',
            enterprise_id: context.enterpriseId,
            project_id: subjectScope.projectId,
            source_command_id: attempt.source_command_id,
          })
          .execute();
      }
      await this.ports.revalidateAuthorization();
      return this.finalFromRow(ref, subjectScope, {
        observation_id: observationId,
        attempt_id: ref.objectId,
        enterprise_id: context.enterpriseId,
        project_id: subjectScope.projectId,
        ack_observation_id: identity.ack_observation_id,
        runtime_adapter_identity_id: identity.instance_id,
        runtime_submission_ref: actual.runtimeSubmissionRef,
        result_payload: actual.agentResultContract,
        result_payload_hash: Buffer.from(resultHash.digest, 'hex'),
        binding_hash: attempt.binding_hash,
        fencing_token: String(actual.runFencingToken),
        observed_at: actual.observedAt,
        source: 'SYNTHETIC_DRIVER',
        source_command_id: attempt.source_command_id,
        canonical_payload: payload,
        payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
      });
    });
    if ('conflict' in outcome) invalid('INTEGRATION_RUNTIME_FINAL_CONFLICT');
    return outcome;
  }

  async getFinal(context: RenderTransactionContext, ref: Common.ObjectRef) {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope)) invalid();
    return withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_final_observation')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (row === undefined) invalid('INTEGRATION_RUNTIME_FINAL_NOT_FOUND');
      if (row.enterprise_id !== context.enterpriseId || row.project_id !== subjectScope.projectId)
        invalid('INTEGRATION_RUNTIME_FINAL_NOT_FOUND');
      const result = this.finalFromRow(ref, subjectScope, row);
      await this.ports.revalidateAuthorization();
      return result;
    });
  }

  /**
   * Strict usage read of the original committed runtime binding.
   * Throws `INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND` when the owning attempt row is absent or out of
   * scope; `INTEGRATION_RUNTIME_BINDING_INVALID` on any canonical hash/mirror/receipt failure.
   * A non-SUCCEEDED attempt is a valid state and is returned without an invented acknowledgement.
   */
  async getUsageRuntimeBinding(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
  ): Promise<Result> {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope))
      invalid(USAGE_CODES.attemptNotFound);
    return withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (row === undefined) invalid(USAGE_CODES.attemptNotFound);
      if (
        row.enterprise_id !== subjectScope.enterpriseId ||
        row.project_id !== subjectScope.projectId
      )
        invalid(USAGE_CODES.attemptNotFound);
      const { request, invocationBinding } = this.validateUsageAttempt(
        USAGE_CODES.bindingInvalid,
        ref,
        row,
      );
      const bindingHash = hash(row.binding_hash.toString('hex'));
      const observation = await trx
        .selectFrom('integration_gateway.runtime_attempt_observation')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if ((row.status === 'SUCCEEDED') !== (observation !== undefined))
        invalid(USAGE_CODES.bindingInvalid);
      let acknowledgement: Result['acknowledgement'];
      if (observation !== undefined) {
        const receipt = await this.validateUsageAcknowledgement(
          trx,
          ref,
          subjectScope,
          USAGE_CODES.bindingInvalid,
          observation,
        );
        acknowledgement = {
          observationId: observation.observation_id,
          rawReceiptRef: receiptRef(
            receipt.receipt_id,
            receipt.receipt_content_hash.toString('hex'),
            subjectScope,
          ),
          runtimeSessionRef: objectWith(
            USAGE_CODES.bindingInvalid,
            observation.runtime_session_ref,
          ) as unknown as Common.ExternalRef,
          acknowledgedAt: observation.acknowledged_at.toISOString(),
          source: observation.acknowledgement_source,
        };
      }
      const result: Result = {
        attemptRef: ref as Result['attemptRef'],
        status: row.status,
        request: request as unknown as IntegrationGateway.RuntimeDispatchRequest,
        requestPayloadHash: hash(row.request_payload_hash.toString('hex')),
        invocationBinding,
        bindingHash,
        ...(acknowledgement === undefined ? {} : { acknowledgement }),
      };
      if (
        !registry.validateOperationResult('integration.get_runtime_attempt_binding', '1.0', result)
          .valid
      )
        invalid(USAGE_CODES.bindingInvalid);
      await this.ports.revalidateAuthorization();
      return result;
    });
  }

  /**
   * Strict usage read of the actual adapter identity. Returns `undefined` exactly when the attempt
   * row exists but has no committed SUCCEEDED acknowledgement / no identity row (a legitimate
   * "not yet observed"). Throws `INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND` when the attempt row is
   * absent/out of scope and `INTEGRATION_RUNTIME_IDENTITY_INVALID` on integrity failures.
   */
  async getUsageRuntimeAdapterIdentity(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
  ): Promise<CanonicalJsonObject | undefined> {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope))
      invalid(USAGE_CODES.attemptNotFound);
    return withRenderTransaction(this.db, context, async (trx) => {
      const attempt = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (attempt === undefined) invalid(USAGE_CODES.attemptNotFound);
      if (
        attempt.enterprise_id !== subjectScope.enterpriseId ||
        attempt.project_id !== subjectScope.projectId
      )
        invalid(USAGE_CODES.attemptNotFound);
      const { invocationBinding } = this.validateUsageAttempt(
        USAGE_CODES.identityInvalid,
        ref,
        attempt,
      );
      if (attempt.status !== 'SUCCEEDED') {
        await this.ports.revalidateAuthorization();
        return undefined;
      }
      const identity = await trx
        .selectFrom('integration_gateway.runtime_adapter_identity')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (identity === undefined) {
        await this.ports.revalidateAuthorization();
        return undefined;
      }
      await this.validateUsageIdentity(
        trx,
        ref,
        subjectScope,
        USAGE_CODES.identityInvalid,
        attempt,
        invocationBinding,
        identity,
      );
      const result = {
        runtimeAdapterIdentityRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.runtime.runtime',
          objectId: identity.instance_id,
          scope: subjectScope,
        },
        attemptRef: ref,
        runRef: objectWith(USAGE_CODES.identityInvalid, invocationBinding.runRef),
        bindingHash: hash(attempt.binding_hash.toString('hex')),
        runtimeBinding: objectWith(USAGE_CODES.identityInvalid, invocationBinding.runtimeBinding),
        ackObservationId: identity.ack_observation_id,
        source: identity.source,
      } as unknown as CanonicalJsonObject;
      await this.ports.revalidateAuthorization();
      return result;
    });
  }

  /**
   * Strict usage read of the original final observation. Throws
   * `INTEGRATION_RUNTIME_FINAL_NOT_FOUND` exactly when the owning read proves no committed final
   * row exists (or it is out of scope); `INTEGRATION_RUNTIME_FINAL_INVALID` on any integrity,
   * mirror or hash failure.
   */
  async getUsageFinalObservation(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
  ): Promise<CanonicalJsonObject> {
    await this.ports.revalidateAuthorization();
    const subjectScope = scope(context);
    if (ref.objectType !== ATTEMPT || !same(ref.scope, subjectScope))
      invalid(USAGE_CODES.finalNotFound);
    return withRenderTransaction(this.db, context, async (trx) => {
      const row = await trx
        .selectFrom('integration_gateway.runtime_final_observation')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (row === undefined) invalid(USAGE_CODES.finalNotFound);
      if (row.enterprise_id !== context.enterpriseId || row.project_id !== subjectScope.projectId)
        invalid(USAGE_CODES.finalNotFound);
      const fail = USAGE_CODES.finalInvalid;
      const recomputedPayloadHash = sha256CanonicalJson(objectWith(fail, row.canonical_payload));
      if (recomputedPayloadHash !== row.payload_hash.toString('hex')) invalid(fail);
      const agentResultContract = objectWith(fail, row.result_payload);
      const recomputedResultHash = hashContractPayload(agentResultContract);
      if (recomputedResultHash !== row.result_payload_hash.toString('hex')) invalid(fail);
      if (
        !registry.validateCoreContract(
          'https://schemas.zhiju.local/core/agent-result/1.0',
          agentResultContract,
        ).valid
      )
        invalid(fail);
      const header = objectWith(fail, agentResultContract.header);
      if (
        stringWith(fail, objectWith(fail, header.payloadHash).digest) !== recomputedResultHash ||
        !same(header.scopeRef, subjectScope)
      )
        invalid(fail);
      const attempt = await trx
        .selectFrom('integration_gateway.runtime_attempt')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (attempt?.status !== 'SUCCEEDED') invalid(fail);
      if (
        attempt.enterprise_id !== subjectScope.enterpriseId ||
        attempt.project_id !== subjectScope.projectId
      )
        invalid(fail);
      const { invocationBinding } = this.validateUsageAttempt(fail, ref, attempt);
      const runRef = objectWith(fail, invocationBinding.runRef);
      const runFencingToken = Number(row.fencing_token);
      if (
        !same(agentResultContract.runRef, runRef) ||
        !Number.isSafeInteger(runFencingToken) ||
        runFencingToken !== objectWith(fail, invocationBinding).fencingToken ||
        !row.binding_hash.equals(attempt.binding_hash) ||
        attempt.planned_runtime_instance_id === null ||
        attempt.planned_runtime_instance_id !== row.runtime_adapter_identity_id
      )
        invalid(fail);
      const identity = await trx
        .selectFrom('integration_gateway.runtime_adapter_identity')
        .selectAll()
        .where('attempt_id', '=', ref.objectId)
        .executeTakeFirst();
      if (identity === undefined) invalid(fail);
      const observation = await this.validateUsageIdentity(
        trx,
        ref,
        subjectScope,
        fail,
        attempt,
        invocationBinding,
        identity,
      );
      const identityRef = {
        kind: 'OBJECT',
        objectType: 'zhiju.runtime.runtime',
        objectId: identity.instance_id,
        scope: subjectScope,
      };
      if (
        identity.ack_observation_id !== row.ack_observation_id ||
        !same(agentResultContract.submittedByRuntime, identityRef) ||
        !same(
          objectWith(
            fail,
            objectWith(fail, agentResultContract.provenance).runtimeSessionExternalRef,
          ),
          objectWith(fail, observation.runtime_session_ref),
        )
      )
        invalid(fail);
      const submission = objectWith(fail, row.runtime_submission_ref);
      const instant = stringWith(fail, submission.observedAt);
      if (
        !stringWith(fail, submission.system) ||
        !stringWith(fail, submission.resourceType) ||
        !stringWith(fail, submission.externalId) ||
        !Number.isFinite(Date.parse(instant))
      )
        invalid(fail);
      const result = {
        observationRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.integration.runtime_final_observation',
          objectId: row.observation_id,
          scope: subjectScope,
          contentHash: hash(recomputedPayloadHash),
        },
        attemptRef: ref,
        runRef,
        runtimeSubmissionRef: submission,
        resultPayloadHash: hash(recomputedResultHash),
        bindingHash: hash(attempt.binding_hash.toString('hex')),
        runFencingToken,
        ackObservationId: row.ack_observation_id,
        runtimeAdapterIdentityRef: identityRef,
        agentResultContract,
        observedAt: row.observed_at.toISOString(),
        source: row.source,
      };
      if (
        !registry.validateOperationResult(
          'integration.get_runtime_final_observation',
          '1.0',
          result,
        ).valid
      )
        invalid(fail);
      await this.ports.revalidateAuthorization();
      return result as unknown as CanonicalJsonObject;
    });
  }

  private validateUsageAttempt(
    code: string,
    ref: Common.ObjectRef,
    row: Selectable<RuntimeAttemptTable>,
  ): { request: CanonicalJsonObject; invocationBinding: InvocationBinding } {
    const request = objectWith(code, row.request_payload);
    const invocationBinding = objectWith(
      code,
      row.invocation_binding,
    ) as unknown as InvocationBinding;
    if (
      sha256CanonicalJson(request) !== row.request_payload_hash.toString('hex') ||
      sha256CanonicalJson({
        attemptRef: ref,
        request,
        invocationBinding,
      } as unknown as CanonicalJsonValue) !== row.binding_hash.toString('hex')
    )
      invalid(code);
    return { request, invocationBinding };
  }

  private async validateUsageAcknowledgement(
    trx: RenderTransaction,
    ref: Common.ObjectRef,
    subjectScope: Common.ScopeRef,
    code: string,
    observation: Selectable<RuntimeAttemptObservationTable>,
  ): Promise<Selectable<RawExternalReceiptTable>> {
    if (
      observation.attempt_id !== ref.objectId ||
      observation.enterprise_id !== subjectScope.enterpriseId ||
      observation.project_id !== subjectScope.projectId ||
      observation.acknowledgement_source !== 'SYNTHETIC_DRIVER' ||
      sha256CanonicalJson(objectWith(code, observation.observation_payload)) !==
        observation.observation_hash.toString('hex')
    )
      invalid(code);
    const receipt = await trx
      .selectFrom('integration_gateway.raw_external_receipt')
      .selectAll()
      .where('receipt_id', '=', observation.raw_receipt_id)
      .executeTakeFirst();
    if (receipt === undefined) invalid(code);
    if (
      receipt.attempt_kind !== 'RUNTIME' ||
      receipt.runtime_attempt_id !== ref.objectId ||
      receipt.observed_outcome !== 'SUCCEEDED' ||
      receipt.enterprise_id !== subjectScope.enterpriseId ||
      receipt.project_id !== subjectScope.projectId ||
      sha256CanonicalJson({
        attemptRef: ref,
        providerReceiptRef: objectWith(code, receipt.provider_receipt_ref),
        receiptPayloadRef: receipt.receipt_payload_ref,
        receiptPayloadHash: hash(receipt.receipt_payload_hash.toString('hex')),
        recordedAt: receipt.recorded_at.toISOString(),
      } as unknown as CanonicalJsonValue) !== receipt.receipt_content_hash.toString('hex')
    )
      invalid(code);
    return receipt;
  }

  private async validateUsageIdentity(
    trx: RenderTransaction,
    ref: Common.ObjectRef,
    subjectScope: Common.ScopeRef,
    code: string,
    attempt: Selectable<RuntimeAttemptTable>,
    invocationBinding: InvocationBinding,
    identity: Selectable<RuntimeAdapterIdentityTable>,
  ): Promise<Selectable<RuntimeAttemptObservationTable>> {
    const runtimeBinding = objectWith(code, invocationBinding.runtimeBinding);
    const canonicalIdentity = objectWith(code, identity.canonical_payload);
    const bindingHex = attempt.binding_hash.toString('hex');
    if (
      sha256CanonicalJson(canonicalIdentity) !== identity.payload_hash.toString('hex') ||
      canonicalIdentity.instanceId !== identity.instance_id ||
      canonicalIdentity.attemptId !== ref.objectId ||
      canonicalIdentity.ackObservationId !== identity.ack_observation_id ||
      canonicalIdentity.bindingHash !== bindingHex ||
      canonicalIdentity.adapterCode !== identity.adapter_code ||
      canonicalIdentity.adapterVersion !== identity.adapter_version ||
      canonicalIdentity.source !== identity.source ||
      identity.instance_id !== attempt.planned_runtime_instance_id ||
      identity.instance_id === ref.objectId ||
      identity.attempt_id !== ref.objectId ||
      identity.enterprise_id !== subjectScope.enterpriseId ||
      identity.project_id !== subjectScope.projectId ||
      !identity.binding_hash.equals(attempt.binding_hash) ||
      identity.adapter_code !== stringWith(code, runtimeBinding.adapterCode) ||
      identity.adapter_version !== stringWith(code, runtimeBinding.adapterVersion)
    )
      invalid(code);
    const observation = await trx
      .selectFrom('integration_gateway.runtime_attempt_observation')
      .selectAll()
      .where('observation_id', '=', identity.ack_observation_id)
      .executeTakeFirst();
    if (observation === undefined) invalid(code);
    await this.validateUsageAcknowledgement(trx, ref, subjectScope, code, observation);
    return observation;
  }

  private finalFromRow(
    ref: Common.ObjectRef,
    subjectScope: Common.ScopeRef,
    row: Selectable<RuntimeFinalObservationTable>,
  ) {
    const result = {
      observationRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.integration.runtime_final_observation',
        objectId: row.observation_id,
        scope: subjectScope,
        contentHash: hash(row.payload_hash.toString('hex')),
      },
      attemptRef: ref,
      runRef: object(object(row.result_payload).runRef),
      runtimeSubmissionRef: object(row.runtime_submission_ref),
      resultPayloadHash: hash(row.result_payload_hash.toString('hex')),
      bindingHash: hash(row.binding_hash.toString('hex')),
      runFencingToken: Number(row.fencing_token),
      ackObservationId: row.ack_observation_id,
      runtimeAdapterIdentityRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.runtime.runtime',
        objectId: row.runtime_adapter_identity_id,
        scope: subjectScope,
      },
      agentResultContract: object(row.result_payload),
      observedAt: row.observed_at.toISOString(),
      source: row.source,
    };
    if (
      !registry.validateOperationResult('integration.get_runtime_final_observation', '1.0', result)
        .valid
    )
      invalid();
    return result;
  }

  private async markUnknown(
    context: RenderTransactionContext,
    ref: Common.ObjectRef,
    bindingHash: Common.ContentHash,
  ): Promise<void> {
    await withRenderTransaction(this.db, context, async (trx) => {
      const completedAt = this.ports.now();
      const row = await trx
        .updateTable('integration_gateway.runtime_attempt')
        .set({ status: 'UNKNOWN', updated_at: completedAt })
        .where('attempt_id', '=', ref.objectId)
        .where('binding_hash', '=', Buffer.from(bindingHash.digest, 'hex'))
        .where('status', '=', 'CREATED')
        .returningAll()
        .executeTakeFirst();
      if (row === undefined) invalid();
      await completeDispatchReceipt(
        trx,
        row.source_command_id,
        {
          attemptRef: ref as Result['attemptRef'],
          status: 'UNKNOWN',
          request: object(row.request_payload) as unknown as Result['request'],
          requestPayloadHash: hash(row.request_payload_hash.toString('hex')),
          invocationBinding: object(row.invocation_binding) as unknown as InvocationBinding,
          bindingHash,
        },
        completedAt,
      );
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
      if (row?.status === 'SUCCEEDED') {
        const observation = await trx
          .selectFrom('integration_gateway.runtime_attempt_observation')
          .selectAll()
          .where('attempt_id', '=', ref.objectId)
          .executeTakeFirst();
        const receipt =
          observation === undefined
            ? undefined
            : await trx
                .selectFrom('integration_gateway.raw_external_receipt')
                .selectAll()
                .where('receipt_id', '=', observation.raw_receipt_id)
                .executeTakeFirst();
        const identity = await trx
          .selectFrom('integration_gateway.runtime_adapter_identity')
          .selectAll()
          .where('attempt_id', '=', ref.objectId)
          .executeTakeFirst();
        if (
          !row.binding_hash.equals(Buffer.from(bindingHash.digest, 'hex')) ||
          observation === undefined ||
          receipt === undefined ||
          identity === undefined ||
          !same(object(observation.runtime_session_ref), acknowledgement.runtimeSessionRef) ||
          observation.acknowledged_at.getTime() !== acknowledgement.acknowledgedAt.getTime() ||
          !same(object(receipt.provider_receipt_ref), acknowledgement.providerReceiptRef) ||
          !receipt.receipt_payload_hash.equals(Buffer.from(stored.checksum.digest, 'hex')) ||
          identity.instance_id !== row.planned_runtime_instance_id ||
          !same(acknowledgement.runtimeAdapterIdentityRef, {
            kind: 'OBJECT',
            objectType: 'zhiju.runtime.runtime',
            objectId: identity.instance_id,
            scope: scope(context),
          })
        )
          invalid('INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT');
        await this.ports.revalidateAuthorization();
        await revalidateReceipt();
        return;
      }
      if (
        row?.status !== (reconcile ? 'UNKNOWN' : 'CREATED') ||
        !row.binding_hash.equals(Buffer.from(bindingHash.digest, 'hex')) ||
        row.planned_runtime_instance_id === null ||
        !same(acknowledgement.runtimeAdapterIdentityRef, {
          kind: 'OBJECT',
          objectType: 'zhiju.runtime.runtime',
          objectId: row.planned_runtime_instance_id,
          scope: scope(context),
        })
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
      const identityPayload = {
        instanceId: row.planned_runtime_instance_id,
        attemptId: ref.objectId,
        ackObservationId: observationId,
        bindingHash: bindingHash.digest,
        adapterCode: stringValue(object(invocationBinding.runtimeBinding).adapterCode),
        adapterVersion: RUNTIME.adapterVersion,
        source: 'SYNTHETIC_DRIVER',
      } as const;
      await trx
        .insertInto('integration_gateway.runtime_adapter_identity')
        .values({
          instance_id: row.planned_runtime_instance_id,
          attempt_id: ref.objectId,
          enterprise_id: context.enterpriseId,
          project_id: scope(context).projectId,
          adapter_code: stringValue(object(invocationBinding.runtimeBinding).adapterCode),
          adapter_version: RUNTIME.adapterVersion,
          binding_hash: Buffer.from(bindingHash.digest, 'hex'),
          ack_observation_id: observationId,
          source: 'SYNTHETIC_DRIVER',
          source_command_id: row.source_command_id,
          canonical_payload: canonicalize(identityPayload),
          payload_hash: Buffer.from(sha256CanonicalJson(identityPayload), 'hex'),
        })
        .execute();
      await trx
        .updateTable('integration_gateway.runtime_attempt')
        .set({ status: 'SUCCEEDED', updated_at: recordedAt })
        .where('attempt_id', '=', ref.objectId)
        .execute();
      await completeDispatchReceipt(
        trx,
        row.source_command_id,
        {
          attemptRef: ref as Result['attemptRef'],
          status: 'SUCCEEDED',
          request,
          requestPayloadHash: hash(row.request_payload_hash.toString('hex')),
          invocationBinding,
          bindingHash,
          acknowledgement: {
            observationId,
            rawReceiptRef: receiptRef(receiptId, receiptHash.digest, scope(context)),
            runtimeSessionRef: acknowledgement.runtimeSessionRef,
            acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
            source: 'SYNTHETIC_DRIVER',
          },
        },
        recordedAt,
      );
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
          source_command_id: row.source_command_id,
        })
        .execute();
      await this.ports.revalidateAuthorization();
      await revalidateReceipt();
    });
  }
}

export class LocalSyntheticRuntimeDriver implements SyntheticRuntimeDriver {
  private readonly observations = new Map<string, SyntheticRuntimeAcknowledgement>();
  private readonly templates = new Map<
    string,
    {
      readonly content: CanonicalJsonObject;
      readonly templateHash: string;
      readonly input: Parameters<SyntheticRuntimeDriver['invoke']>[0];
    }
  >();
  private readonly finals = new Map<string, SyntheticRuntimeFinal>();
  readonly invokedAttemptIds: string[] = [];

  constructor(
    private readonly finalTemplate?: (
      input: Parameters<SyntheticRuntimeDriver['invoke']>[0],
      acknowledgement: SyntheticRuntimeAcknowledgement,
    ) => CanonicalJsonObject,
    private readonly journal?: RenderObjectStoragePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private locator(ref: Common.ObjectRef, kind: 'invocation' | 'final'): string {
    return `integration/runtime/synthetic/${ref.objectId}/${kind}.json`;
  }

  private async writeJournal(
    ref: Common.ObjectRef,
    kind: 'invocation' | 'final',
    value: CanonicalJsonObject,
  ): Promise<void> {
    if (this.journal === undefined) return;
    await this.journal.putImmutable({
      locator: this.locator(ref, kind),
      bytes: Buffer.from(canonicalize(value), 'utf8'),
      mediaType: 'application/json',
    });
  }

  private async readJournal(
    ref: Common.ObjectRef,
    kind: 'invocation' | 'final',
  ): Promise<CanonicalJsonObject | undefined> {
    if (this.journal === undefined) return undefined;
    const stored = await this.journal.read(this.locator(ref, kind));
    if (stored === undefined) return undefined;
    if (
      stored.mediaType !== 'application/json' ||
      createHash('sha256').update(stored.bytes).digest('hex') !== stored.checksum.digest
    )
      invalid();
    return object(JSON.parse(stored.bytes.toString('utf8')));
  }

  async invoke(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly runtimeAdapterIdentityRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RuntimeDispatchRequest;
    readonly invocationBinding: InvocationBinding;
    readonly bindingHash: Common.ContentHash;
  }): Promise<SyntheticRuntimeAcknowledgement> {
    if (
      object(input.invocationBinding.runtimeBinding).adapterCode ===
        'te.human_operated.synthetic.formal' &&
      this.journal === undefined
    )
      invalid();
    this.invokedAttemptIds.push(input.attemptRef.objectId);
    const acknowledgedAt = this.now();
    const runtimeSessionRef: Common.ExternalRef = {
      system: 'zhiju.runtime.synthetic',
      resourceType: 'runtime_session',
      externalId: input.attemptRef.objectId,
      observedAt: acknowledgedAt.toISOString(),
    };
    const result: SyntheticRuntimeAcknowledgement = {
      attemptRef: input.attemptRef,
      runtimeAdapterIdentityRef: input.runtimeAdapterIdentityRef,
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
    let template:
      | {
          content: CanonicalJsonObject;
          templateHash: string;
          input: Parameters<SyntheticRuntimeDriver['invoke']>[0];
        }
      | undefined;
    if (this.finalTemplate !== undefined) {
      const content = structuredClone(this.finalTemplate(input, result));
      if ('submittedAt' in content || 'submittedByRuntime' in content) invalid();
      template = {
        content,
        templateHash: sha256CanonicalJson(content),
        input,
      };
    }
    await this.writeJournal(input.attemptRef, 'invocation', {
      input: input as unknown as CanonicalJsonObject,
      acknowledgement: {
        ...result,
        acknowledgedAt: acknowledgedAt.toISOString(),
      } as unknown as CanonicalJsonObject,
      ...(template === undefined
        ? {}
        : { content: template.content, templateHash: template.templateHash }),
    });
    this.observations.set(input.attemptRef.objectId, result);
    if (template !== undefined) this.templates.set(input.attemptRef.objectId, template);
    return result;
  }

  async readBack(ref: Common.ObjectRef): Promise<SyntheticRuntimeAcknowledgement | undefined> {
    const current = this.observations.get(ref.objectId);
    if (current !== undefined) return structuredClone(current);
    const stored = await this.readJournal(ref, 'invocation');
    if (stored === undefined) return undefined;
    const acknowledgement = object(stored.acknowledgement);
    if (!same(acknowledgement.attemptRef, ref)) invalid();
    const result = {
      ...acknowledgement,
      acknowledgedAt: new Date(stringValue(acknowledgement.acknowledgedAt)),
    } as unknown as SyntheticRuntimeAcknowledgement;
    if (!Number.isFinite(result.acknowledgedAt.getTime())) invalid();
    this.observations.set(ref.objectId, result);
    return structuredClone(result);
  }

  async releaseFinal(ref: Common.ObjectRef): Promise<void> {
    await this.materializeFinal(ref);
  }

  async releaseFormalOutput(
    ref: Common.ObjectRef,
    output: CanonicalJsonObject,
    ports: FormalOutputReleasePorts,
  ): Promise<void> {
    if (this.journal === undefined) invalid();
    await ports.revalidateAuthorization();
    const previous = await this.readFinal(ref);
    if (previous) {
      if (!same(previous.agentResultContract.businessOutputs, [output]))
        invalid('INTEGRATION_RUNTIME_FINAL_CONFLICT');
      await ports.revalidateAuthorization();
      return;
    }
    const stored = await this.readJournal(ref, 'invocation');
    const template =
      this.templates.get(ref.objectId) ??
      (stored?.content
        ? {
            content: object(stored.content),
            templateHash: stringValue(stored.templateHash),
            input: object(stored.input) as unknown as Parameters<
              SyntheticRuntimeDriver['invoke']
            >[0],
          }
        : undefined);
    if (
      template?.content === undefined ||
      sha256CanonicalJson(template.content) !== template.templateHash ||
      !same(template.input.invocationBinding.runtimeBinding, {
        ...RUNTIME,
        adapterCode: 'te.human_operated.synthetic.formal',
      }) ||
      template.content.executionOutcome !== 'COMPLETED'
    )
      invalid();
    const fact = await ports.readExecutionOutput(
        object(output.ref) as unknown as Common.ContentAddressedRef,
      ),
      binding = object(fact.creationBinding),
      receipt = object(fact.creationReceipt);
    if (
      fact.useStatus !== 'USABLE' ||
      !same(object(fact.revision).revisionRef, output.ref) ||
      !same(binding.creationCommandRef, output.creationCommandRef) ||
      !same(binding.runRef, template.input.invocationBinding.runRef) ||
      !same(binding.workOrderContractRef, template.input.invocationBinding.workOrderContractRef) ||
      !same(binding.contextSnapshotRef, template.input.invocationBinding.contextSnapshotRef) ||
      !same(output.createdByRunRef, binding.runRef) ||
      receipt.outcome !== 'COMMITTED' ||
      !same(receipt.revisionRef, output.ref) ||
      object(output.creationCommandRef).objectId !== receipt.commandId ||
      !same(object(output.creationCommandRef).contentHash, hash(sha256CanonicalJson(receipt))) ||
      !same(fact.creationBindingHash, hash(sha256CanonicalJson(binding)))
    )
      invalid();
    await ports.revalidateAuthorization();
    await this.materializeFinal(ref, output);
    await ports.revalidateAuthorization();
  }

  private async materializeFinal(
    ref: Common.ObjectRef,
    formalOutput?: CanonicalJsonObject,
  ): Promise<void> {
    const acknowledgement = await this.readBack(ref);
    const stored = await this.readJournal(ref, 'invocation');
    const template =
      this.templates.get(ref.objectId) ??
      (stored?.content === undefined
        ? undefined
        : {
            content: object(stored.content),
            templateHash: stringValue(stored.templateHash),
            input: object(stored.input) as unknown as Parameters<
              SyntheticRuntimeDriver['invoke']
            >[0],
          });
    if (template === undefined) return;
    if (
      acknowledgement === undefined ||
      !same(acknowledgement.attemptRef, ref) ||
      sha256CanonicalJson(template.content) !== template.templateHash
    )
      invalid();
    if ((await this.readFinal(ref)) !== undefined) return;
    const formal = same(template.input.invocationBinding.runtimeBinding, {
      ...RUNTIME,
      adapterCode: 'te.human_operated.synthetic.formal',
    });
    if (formal && template.content.executionOutcome === 'COMPLETED' && formalOutput === undefined)
      return;
    const observedAt = this.now();
    const runtimeSubmissionRef: Common.ExternalRef = {
      system: 'zhiju.runtime.synthetic',
      resourceType: 'runtime_submission',
      externalId: newUuidV7(),
      observedAt: observedAt.toISOString(),
    };
    const contentWithRuntimeFields = {
      ...template.content,
      ...(formalOutput ? { businessOutputs: [formalOutput] } : {}),
      header: {
        ...object(template.content.header),
        issuedAt: observedAt.toISOString(),
      },
      submittedAt: observedAt.toISOString(),
      submittedByRuntime: acknowledgement.runtimeAdapterIdentityRef,
    } as unknown as CanonicalJsonObject;
    const agentResultContract = {
      ...contentWithRuntimeFields,
      header: {
        ...object(contentWithRuntimeFields.header),
        payloadHash: hash(hashContractPayload(contentWithRuntimeFields)),
      },
    } as unknown as CanonicalJsonObject;
    const validation = registry.validateCoreContract(
      'https://schemas.zhiju.local/core/agent-result/1.0',
      agentResultContract,
    );
    if (!validation.valid) {
      throw new RenderPersistenceError(
        'INTEGRATION_RUNTIME_FINAL_SCHEMA_INVALID',
        validation.errors
          .map((error) => `${error.instancePath}:${error.keyword}:${JSON.stringify(error.params)}`)
          .join(','),
      );
    }
    const result = {
      attemptRef: ref,
      runtimeAdapterIdentityRef: acknowledgement.runtimeAdapterIdentityRef,
      bindingHash: acknowledgement.bindingHash,
      runtimeSubmissionRef,
      runFencingToken: template.input.invocationBinding.fencingToken,
      agentResultContract,
      observedAt,
    };
    try {
      await this.writeJournal(ref, 'final', {
        ...result,
        observedAt: observedAt.toISOString(),
      } as unknown as CanonicalJsonObject);
    } catch (error) {
      const winner = await this.readFinal(ref);
      if (
        !winner ||
        !same(
          winner.agentResultContract.businessOutputs,
          result.agentResultContract.businessOutputs,
        )
      )
        throw error;
      return;
    }
    this.finals.set(ref.objectId, result);
  }

  async readFinal(ref: Common.ObjectRef): Promise<SyntheticRuntimeFinal | undefined> {
    const result = this.finals.get(ref.objectId);
    if (result !== undefined) return structuredClone(result);
    const stored = await this.readJournal(ref, 'final');
    if (stored === undefined) return undefined;
    if (!same(stored.attemptRef, ref)) invalid();
    const recovered = {
      ...stored,
      observedAt: new Date(stringValue(stored.observedAt)),
    } as unknown as SyntheticRuntimeFinal;
    if (!Number.isFinite(recovered.observedAt.getTime())) invalid();
    this.finals.set(ref.objectId, recovered);
    return structuredClone(recovered);
  }
}
