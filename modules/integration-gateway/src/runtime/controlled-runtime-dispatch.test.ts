import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { Common } from '@zhiju/contracts';
import {
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type {
  IntegrationRendererDb,
  RenderTransactionContext,
} from '../persistence/render-attempt-db.js';
import type { RenderObjectStoragePort } from '../renderer/in-memory-render-object-storage.js';
import {
  ControlledRuntimeDispatchService,
  LocalSyntheticRuntimeDriver,
} from './controlled-runtime-dispatch.js';

it('requires an immutable journal before a formal invocation can have any effect', async () => {
  const driver = new LocalSyntheticRuntimeDriver();
  const input = {
    invocationBinding: { runtimeBinding: { adapterCode: 'te.human_operated.synthetic.formal' } },
  } as unknown as Parameters<LocalSyntheticRuntimeDriver['invoke']>[0];
  await expect(driver.invoke(input)).rejects.toThrow();
  expect(driver.invokedAttemptIds).toEqual([]);
});

it('refuses a formal release without a journal before authorization or owning output reads', async () => {
  const driver = new LocalSyntheticRuntimeDriver();
  let reads = 0;
  await expect(
    driver.releaseFormalOutput(
      {} as Common.ObjectRef,
      {},
      {
        revalidateAuthorization: () => {
          reads += 1;
          return Promise.resolve();
        },
        readExecutionOutput: () => {
          reads += 1;
          return Promise.resolve({});
        },
      },
    ),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});

const BINDING_INVALID = 'INTEGRATION_RUNTIME_BINDING_INVALID';
const IDENTITY_INVALID = 'INTEGRATION_RUNTIME_IDENTITY_INVALID';
const ATTEMPT_NOT_FOUND = 'INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND';
const FINAL_NOT_FOUND = 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND';
const FINAL_INVALID = 'INTEGRATION_RUNTIME_FINAL_INVALID';

type Row = Record<string, unknown>;

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', canonicalizationVersion: '1', digest };
}

interface Fixture {
  readonly context: RenderTransactionContext;
  readonly ref: Common.ObjectRef;
  readonly ids: {
    readonly attemptId: string;
    readonly instanceId: string;
    readonly observationId: string;
    readonly receiptId: string;
    readonly finalId: string;
  };
  readonly tables: Record<string, Row[]>;
}

function makeFixture(): Fixture {
  const scope = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
  const attemptId = newUuidV7();
  const instanceId = newUuidV7();
  const observationId = newUuidV7();
  const receiptId = newUuidV7();
  const finalId = newUuidV7();
  const ref: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'integration.runtime_attempt',
    objectId: attemptId,
    scope,
  };
  const runRef: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'execution.run',
    objectId: newUuidV7(),
    scope,
  };
  const objectRef = (objectType: string): Common.ObjectRef => ({
    kind: 'OBJECT',
    objectType,
    objectId: newUuidV7(),
    scope,
  });
  const contentRef = (objectType: string): Common.ContentAddressedRef => ({
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId: newUuidV7(),
    scope,
    contentHash: contentHash(sha256CanonicalJson({})),
  });
  const snapshotRef = (objectType: string): Common.SnapshotRef => ({
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope,
    contentHash: contentHash(sha256CanonicalJson({})),
  });
  const runtimeBinding = {
    adapterCode: 'te.human_operated.synthetic',
    adapterVersion: '1.0',
    harnessId: 'zhiju.runtime.synthetic',
    harnessVersion: '1.0',
    provider: 'synthetic',
    modelId: 'synthetic',
    modelConfigHash: contentHash(sha256CanonicalJson({})),
  };
  const request: Row = {
    workOrderRef: objectRef('zhiju.execution.work_order'),
    runRef,
    workOrderContractRef: contentRef('zhiju.contract.work_order'),
    contextSnapshotRef: snapshotRef('zhiju.execution.context_snapshot'),
    capabilityGrantRef: contentRef('zhiju.identity.execution_capability_bundle'),
    runtimeBinding,
    stableIdempotencyKey: newUuidV7(),
    requestedAt: new Date().toISOString(),
  };
  const invocationBinding: Row = {
    runRef,
    workOrderContractRef: request.workOrderContractRef,
    contextSnapshotRef: request.contextSnapshotRef,
    capabilityGrantRef: request.capabilityGrantRef,
    leaseId: newUuidV7(),
    fencingToken: 1,
    leaseExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    runtimeBinding,
  };
  const requestPayloadHash = Buffer.from(sha256CanonicalJson(request as CanonicalJsonValue), 'hex');
  const bindingHex = sha256CanonicalJson({
    attemptRef: ref,
    request,
    invocationBinding,
  } as unknown as CanonicalJsonValue);
  const bindingHash = Buffer.from(bindingHex, 'hex');
  const sourceCommandId = newUuidV7();
  const attempt: Row = {
    attempt_id: attemptId,
    enterprise_id: scope.enterpriseId,
    project_id: scope.projectId,
    stable_key_hash: Buffer.alloc(32),
    request_payload: request,
    request_payload_hash: requestPayloadHash,
    invocation_binding: invocationBinding,
    binding_hash: bindingHash,
    planned_runtime_instance_id: instanceId,
    source_command_id: sourceCommandId,
    status: 'SUCCEEDED',
    created_at: new Date(),
    updated_at: new Date(),
  };
  const sessionIso = new Date().toISOString();
  const sessionRef: Common.ExternalRef = {
    system: 'zhiju.runtime.synthetic',
    resourceType: 'runtime_session',
    externalId: attemptId,
    observedAt: sessionIso,
  };
  const providerReceiptRef: Common.ExternalRef = {
    system: 'zhiju.runtime.synthetic',
    resourceType: 'dispatch_acknowledgement',
    externalId: attemptId,
    observedAt: sessionIso,
  };
  const receiptPayloadRef = `integration/runtime/receipt/${attemptId}.json`;
  const receiptPayloadHashHex = sha256CanonicalJson({});
  const recordedAt = new Date();
  const receiptContentHashHex = sha256CanonicalJson({
    attemptRef: ref,
    providerReceiptRef,
    receiptPayloadRef,
    receiptPayloadHash: contentHash(receiptPayloadHashHex),
    recordedAt: recordedAt.toISOString(),
  } as unknown as CanonicalJsonValue);
  const receipt: Row = {
    receipt_id: receiptId,
    enterprise_id: scope.enterpriseId,
    project_id: scope.projectId,
    attempt_id: null,
    attempt_kind: 'RUNTIME',
    runtime_attempt_id: attemptId,
    provider_receipt_ref: providerReceiptRef,
    receipt_payload_ref: receiptPayloadRef,
    receipt_payload_hash: Buffer.from(receiptPayloadHashHex, 'hex'),
    receipt_content_hash: Buffer.from(receiptContentHashHex, 'hex'),
    observed_outcome: 'SUCCEEDED',
    occurred_at: recordedAt,
    recorded_at: recordedAt,
  };
  const observationPayload = {
    attemptRef: ref,
    bindingHash: contentHash(bindingHex),
    rawReceiptRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'integration.raw_external_receipt',
      objectId: receiptId,
      scope,
      contentHash: contentHash(receiptContentHashHex),
    },
    runtimeSessionRef: sessionRef,
    acknowledgedAt: sessionIso,
    source: 'SYNTHETIC_DRIVER',
  };
  const observation: Row = {
    observation_id: observationId,
    attempt_id: attemptId,
    enterprise_id: scope.enterpriseId,
    project_id: scope.projectId,
    raw_receipt_id: receiptId,
    runtime_session_ref: sessionRef,
    acknowledgement_source: 'SYNTHETIC_DRIVER',
    acknowledged_at: new Date(sessionIso),
    observation_payload: observationPayload,
    observation_hash: Buffer.from(
      sha256CanonicalJson(observationPayload as unknown as CanonicalJsonValue),
      'hex',
    ),
  };
  const identityPayload = {
    instanceId,
    attemptId,
    ackObservationId: observationId,
    bindingHash: bindingHex,
    adapterCode: runtimeBinding.adapterCode,
    adapterVersion: runtimeBinding.adapterVersion,
    source: 'SYNTHETIC_DRIVER',
  };
  const identity: Row = {
    instance_id: instanceId,
    attempt_id: attemptId,
    enterprise_id: scope.enterpriseId,
    project_id: scope.projectId,
    adapter_code: runtimeBinding.adapterCode,
    adapter_version: runtimeBinding.adapterVersion,
    binding_hash: bindingHash,
    ack_observation_id: observationId,
    source: 'SYNTHETIC_DRIVER',
    source_command_id: sourceCommandId,
    canonical_payload: identityPayload,
    payload_hash: Buffer.from(
      sha256CanonicalJson(identityPayload as unknown as CanonicalJsonValue),
      'hex',
    ),
  };
  const identityRef: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.runtime.runtime',
    objectId: instanceId,
    scope,
  };
  const submissionRef: Common.ExternalRef = {
    system: 'zhiju.runtime.synthetic',
    resourceType: 'runtime_submission',
    externalId: newUuidV7(),
    observedAt: new Date().toISOString(),
  };
  const agentResultContract: Row = {
    header: {
      contractId: newUuidV7(),
      contractType: 'zhiju.contract.agent_result',
      contractVersion: '1.0',
      schemaRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.contract.schema',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
        scope,
      },
      scopeRef: scope,
      issuedAt: sessionIso,
      issuedBy: { principalKind: 'SERVICE', principalId: newUuidV7() },
      correlationId: newUuidV7(),
      dataClassification: 'INTERNAL',
      canonicalizationVersion: '1',
      payloadHash: contentHash(sha256CanonicalJson({})),
    },
    agentResultId: newUuidV7(),
    runRef,
    workOrderRef: request.workOrderRef,
    taskRef: objectRef('zhiju.execution.task'),
    projectRef: objectRef('zhiju.project.project'),
    submissionKind: 'FINAL',
    executionOutcome: 'COMPLETED',
    businessOutputs: [],
    workspaceOutputs: [],
    findings: [],
    knowledgeProposals: [],
    inputRequestProposals: [],
    followUpProposals: [],
    provenance: {
      contextSnapshotRef: request.contextSnapshotRef,
      workOrderContractRef: request.workOrderContractRef,
      capabilityGrantRef: request.capabilityGrantRef,
      runtimeAdapterRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.runtime.adapter_contract',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
        scope,
      },
      harness: { harnessId: 'zhiju.runtime.synthetic', harnessVersion: '1.0' },
      provider: 'synthetic',
      model: { modelId: 'synthetic', modelConfigHash: contentHash(sha256CanonicalJson({})) },
      skillRefs: [],
      policyRefs: [],
      templateRefs: [],
      runtimeSessionExternalRef: sessionRef,
    },
    humanSummary: 'synthetic final observation',
    submittedAt: sessionIso,
    submittedByRuntime: identityRef,
  };
  const resultPayloadHashHex = hashContractPayload(
    agentResultContract as unknown as CanonicalJsonValue,
  );
  (agentResultContract.header as Row).payloadHash = contentHash(resultPayloadHashHex);
  const finalCanonicalPayload = {
    observationId: finalId,
    attemptId,
    runtimeAdapterIdentityRef: identityRef,
    runtimeSubmissionRef: submissionRef,
    resultPayloadHash: contentHash(resultPayloadHashHex),
    bindingHash: contentHash(bindingHex),
    observedAt: submissionRef.observedAt,
    source: 'SYNTHETIC_DRIVER',
  };
  const final: Row = {
    observation_id: finalId,
    attempt_id: attemptId,
    enterprise_id: scope.enterpriseId,
    project_id: scope.projectId,
    ack_observation_id: observationId,
    runtime_adapter_identity_id: instanceId,
    runtime_submission_ref: submissionRef,
    result_payload: agentResultContract,
    result_payload_hash: Buffer.from(resultPayloadHashHex, 'hex'),
    binding_hash: bindingHash,
    fencing_token: '1',
    observed_at: new Date(submissionRef.observedAt),
    source: 'SYNTHETIC_DRIVER',
    source_command_id: sourceCommandId,
    canonical_payload: finalCanonicalPayload,
    payload_hash: Buffer.from(
      sha256CanonicalJson(finalCanonicalPayload as unknown as CanonicalJsonValue),
      'hex',
    ),
  };
  const context: RenderTransactionContext = {
    kind: 'REQUEST',
    principalId: newUuidV7(),
    principalKind: 'SERVICE',
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.alloc(32, 0x11),
    authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
    policySnapshotId: newUuidV7(),
    enterpriseId: scope.enterpriseId,
    allowedProjectIds: [scope.projectId],
    correlationId: newUuidV7(),
  };
  return {
    context,
    ref,
    ids: { attemptId, instanceId, observationId, receiptId, finalId },
    tables: {
      'integration_gateway.runtime_attempt': [attempt],
      'integration_gateway.runtime_attempt_observation': [observation],
      'integration_gateway.raw_external_receipt': [receipt],
      'integration_gateway.runtime_adapter_identity': [identity],
      'integration_gateway.runtime_final_observation': [final],
    },
  };
}

function fakeDatabase(tables: Record<string, Row[]>): Kysely<IntegrationRendererDb> {
  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: () => ({ sql: '', parameters: [], query: {} }),
    executeQuery: () => Promise.resolve({ rows: [], numAffectedRows: 0n }),
    withPlugins: () => executor,
    withPlugin: () => executor,
  };
  const select = (rows: Row[]) => {
    const filters: [string, unknown][] = [];
    const builder = {
      selectAll: () => builder,
      where: (column: string, _op: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      forUpdate: () => builder,
      executeTakeFirst: () =>
        Promise.resolve(
          rows.find((row) => filters.every(([column, value]) => row[column] === value)),
        ),
    };
    return builder;
  };
  const trx = {
    getExecutor: () => executor,
    selectFrom: (table: string) => select(tables[table] ?? []),
  };
  const connection = {
    transaction: () => ({ execute: (run: (t: unknown) => unknown) => Promise.resolve(run(trx)) }),
  };
  return {
    connection: () => ({
      execute: (run: (c: unknown) => unknown) => Promise.resolve(run(connection)),
    }),
  } as unknown as Kysely<IntegrationRendererDb>;
}

function makeService(tables: Record<string, Row[]>): ControlledRuntimeDispatchService {
  return new ControlledRuntimeDispatchService(
    fakeDatabase(tables),
    new LocalSyntheticRuntimeDriver(),
    {} as unknown as RenderObjectStoragePort,
    {
      now: () => new Date(),
      revalidateAuthorization: () => Promise.resolve(),
      readDispatchBinding: () => Promise.reject(new Error('unused')),
      readBundle: () => Promise.reject(new Error('unused')),
      authorizeReceipt: () => Promise.reject(new Error('unused')),
    },
  );
}

function fixtureRow(tables: Record<string, Row[]>, name: string): Row {
  const first = tables[name]?.[0];
  if (first === undefined) throw new Error(`missing fixture row ${name}`);
  return first;
}

describe('ControlledRuntimeDispatchService strict usage reads', () => {
  it('returns the original binding, identity and final observation from an intact committed set', async () => {
    const fixture = makeFixture();
    const service = makeService(fixture.tables);

    const binding = await service.getUsageRuntimeBinding(fixture.context, fixture.ref);
    expect(binding.status).toBe('SUCCEEDED');
    expect(binding.attemptRef.objectId).toBe(fixture.ids.attemptId);
    expect(binding.bindingHash.digest).toBe(
      Buffer.from(
        sha256CanonicalJson({
          attemptRef: fixture.ref,
          request: binding.request,
          invocationBinding: binding.invocationBinding,
        } as unknown as CanonicalJsonValue),
        'hex',
      ).toString('hex'),
    );
    expect(binding.acknowledgement?.observationId).toBe(fixture.ids.observationId);
    expect(binding.acknowledgement?.source).toBe('SYNTHETIC_DRIVER');
    expect(binding.acknowledgement?.rawReceiptRef.objectId).toBe(fixture.ids.receiptId);

    const identity = await service.getUsageRuntimeAdapterIdentity(fixture.context, fixture.ref);
    expect(identity?.ackObservationId).toBe(fixture.ids.observationId);
    expect(identity?.source).toBe('SYNTHETIC_DRIVER');
    expect(identity?.bindingHash).toEqual(binding.bindingHash);

    const final = await service.getUsageFinalObservation(fixture.context, fixture.ref);
    expect(final.observationRef).toMatchObject({ objectId: fixture.ids.finalId });
    expect(final.ackObservationId).toBe(fixture.ids.observationId);
    expect(final.runFencingToken).toBe(1);
    expect(final.resultPayloadHash).toMatchObject({
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('rejects single-field canonical corruption for each stored canonical hash and mirror', async () => {
    const bindingAttempt = makeFixture();
    fixtureRow(bindingAttempt.tables, 'integration_gateway.runtime_attempt').request_payload_hash =
      Buffer.from('a'.repeat(64), 'hex');
    await expect(
      makeService(bindingAttempt.tables).getUsageRuntimeBinding(
        bindingAttempt.context,
        bindingAttempt.ref,
      ),
    ).rejects.toMatchObject({ code: BINDING_INVALID });

    const bindingHash = makeFixture();
    fixtureRow(bindingHash.tables, 'integration_gateway.runtime_attempt').binding_hash =
      Buffer.from('b'.repeat(64), 'hex');
    await expect(
      makeService(bindingHash.tables).getUsageRuntimeBinding(bindingHash.context, bindingHash.ref),
    ).rejects.toMatchObject({ code: BINDING_INVALID });

    const observationHash = makeFixture();
    fixtureRow(
      observationHash.tables,
      'integration_gateway.runtime_attempt_observation',
    ).observation_hash = Buffer.from('c'.repeat(64), 'hex');
    await expect(
      makeService(observationHash.tables).getUsageRuntimeBinding(
        observationHash.context,
        observationHash.ref,
      ),
    ).rejects.toMatchObject({ code: BINDING_INVALID });

    const identityPayload = makeFixture();
    fixtureRow(
      identityPayload.tables,
      'integration_gateway.runtime_adapter_identity',
    ).payload_hash = Buffer.from('d'.repeat(64), 'hex');
    await expect(
      makeService(identityPayload.tables).getUsageRuntimeAdapterIdentity(
        identityPayload.context,
        identityPayload.ref,
      ),
    ).rejects.toMatchObject({ code: IDENTITY_INVALID });

    const identityMirror = makeFixture();
    fixtureRow(identityMirror.tables, 'integration_gateway.runtime_adapter_identity').instance_id =
      newUuidV7();
    await expect(
      makeService(identityMirror.tables).getUsageRuntimeAdapterIdentity(
        identityMirror.context,
        identityMirror.ref,
      ),
    ).rejects.toMatchObject({ code: IDENTITY_INVALID });

    const finalResult = makeFixture();
    fixtureRow(
      finalResult.tables,
      'integration_gateway.runtime_final_observation',
    ).result_payload_hash = Buffer.from('e'.repeat(64), 'hex');
    await expect(
      makeService(finalResult.tables).getUsageFinalObservation(
        finalResult.context,
        finalResult.ref,
      ),
    ).rejects.toMatchObject({ code: FINAL_INVALID });

    const finalMirror = makeFixture();
    fixtureRow(finalMirror.tables, 'integration_gateway.runtime_final_observation').binding_hash =
      Buffer.from('f'.repeat(64), 'hex');
    await expect(
      makeService(finalMirror.tables).getUsageFinalObservation(
        finalMirror.context,
        finalMirror.ref,
      ),
    ).rejects.toMatchObject({ code: FINAL_INVALID });
  });

  it('distinguishes an owning not-found from an integrity failure for the final observation', async () => {
    const missing = makeFixture();
    missing.tables['integration_gateway.runtime_final_observation'] = [];
    await expect(
      makeService(missing.tables).getUsageFinalObservation(missing.context, missing.ref),
    ).rejects.toMatchObject({ code: FINAL_NOT_FOUND });

    const corrupted = makeFixture();
    fixtureRow(corrupted.tables, 'integration_gateway.runtime_final_observation').payload_hash =
      Buffer.from('9'.repeat(64), 'hex');
    await expect(
      makeService(corrupted.tables).getUsageFinalObservation(corrupted.context, corrupted.ref),
    ).rejects.toMatchObject({ code: FINAL_INVALID });
  });

  it('returns undefined when the attempt has no committed SUCCEEDED acknowledgement', async () => {
    const notYet = makeFixture();
    fixtureRow(notYet.tables, 'integration_gateway.runtime_attempt').status = 'CREATED';
    notYet.tables['integration_gateway.runtime_adapter_identity'] = [];
    await expect(
      makeService(notYet.tables).getUsageRuntimeAdapterIdentity(notYet.context, notYet.ref),
    ).resolves.toBeUndefined();

    const succeededWithoutIdentity = makeFixture();
    succeededWithoutIdentity.tables['integration_gateway.runtime_adapter_identity'] = [];
    await expect(
      makeService(succeededWithoutIdentity.tables).getUsageRuntimeAdapterIdentity(
        succeededWithoutIdentity.context,
        succeededWithoutIdentity.ref,
      ),
    ).resolves.toBeUndefined();
  });

  it('throws ATTEMPT_NOT_FOUND for an absent or out-of-scope attempt', async () => {
    const absent = makeFixture();
    absent.tables['integration_gateway.runtime_attempt'] = [];
    await expect(
      makeService(absent.tables).getUsageRuntimeBinding(absent.context, absent.ref),
    ).rejects.toMatchObject({ code: ATTEMPT_NOT_FOUND });
    await expect(
      makeService(absent.tables).getUsageRuntimeAdapterIdentity(absent.context, absent.ref),
    ).rejects.toMatchObject({ code: ATTEMPT_NOT_FOUND });

    const outOfScope = makeFixture();
    await expect(
      makeService(outOfScope.tables).getUsageRuntimeBinding(
        { ...outOfScope.context, allowedProjectIds: [newUuidV7()] },
        outOfScope.ref,
      ),
    ).rejects.toMatchObject({ code: ATTEMPT_NOT_FOUND });
  });

  it('revalidates authorization before returning the strict reads', async () => {
    const fixture = makeFixture();
    let calls = 0;
    const service = new ControlledRuntimeDispatchService(
      fakeDatabase(fixture.tables),
      new LocalSyntheticRuntimeDriver(),
      {} as unknown as RenderObjectStoragePort,
      {
        now: () => new Date(),
        revalidateAuthorization: () => {
          calls += 1;
          return Promise.resolve();
        },
        readDispatchBinding: () => Promise.reject(new Error('unused')),
        readBundle: () => Promise.reject(new Error('unused')),
        authorizeReceipt: () => Promise.reject(new Error('unused')),
      },
    );
    await service.getUsageRuntimeBinding(fixture.context, fixture.ref);
    expect(calls).toBe(2);
    await service.getUsageRuntimeAdapterIdentity(fixture.context, fixture.ref);
    expect(calls).toBe(4);
    await service.getUsageFinalObservation(fixture.context, fixture.ref);
    expect(calls).toBe(6);
  });
});
