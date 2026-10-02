import type { Common } from '@zhiju/contracts';
import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import {
  createIntegrationRendererDatabase,
  withRenderTransaction,
} from '@zhiju/integration-gateway';
import {
  canonicalize,
  type CanonicalJsonObject,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
} from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import { contentHash, type Principal, record } from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyFinalBindingContext {
  readonly exercisePreparationMatrix: boolean;
  tePool: InitialContextSuite['tePool'];
  readonly observingDriver: LocalSyntheticRuntimeDriver;
  readonly attemptRef: Common.ObjectRef;
  readonly runnerContext: InitialContextSuite['runnerContext'];
  service: Principal;
  fixture: InitialContextSuite['fixture'];
  readonly registry: InitialContextSuite['registry'];
  admin: InitialContextSuite['admin'];
}

export async function verifyFinalBinding(
  scenarioState: VerifyFinalBindingContext,
): Promise<boolean> {
  if (scenarioState.exercisePreparationMatrix) {
    const igDb = createIntegrationRendererDatabase(scenarioState.tePool);
    const actualFinal = await scenarioState.observingDriver.readFinal(scenarioState.attemptRef);
    if (actualFinal === undefined) throw new Error('missing SQL final guard source');
    const source = await withRenderTransaction(
      igDb,
      scenarioState.runnerContext(scenarioState.service),
      async (trx) => ({
        attempt: await trx
          .selectFrom('integration_gateway.runtime_attempt')
          .selectAll()
          .where('attempt_id', '=', scenarioState.attemptRef.objectId)
          .executeTakeFirstOrThrow(),
        identity: await trx
          .selectFrom('integration_gateway.runtime_adapter_identity')
          .selectAll()
          .where('attempt_id', '=', scenarioState.attemptRef.objectId)
          .executeTakeFirstOrThrow(),
      }),
    );
    const resultHash = contentHash(hashContractPayload(actualFinal.agentResultContract));
    const payloadBase = {
      attemptId: scenarioState.attemptRef.objectId,
      runtimeAdapterIdentityRef: actualFinal.runtimeAdapterIdentityRef,
      runtimeSubmissionRef: actualFinal.runtimeSubmissionRef,
      resultPayloadHash: resultHash,
      bindingHash: actualFinal.bindingHash,
      observedAt: actualFinal.observedAt.toISOString(),
      source: 'SYNTHETIC_DRIVER',
    } as unknown as CanonicalJsonObject;
    const base = {
      observation_id: newUuidV7(),
      attempt_id: scenarioState.attemptRef.objectId,
      enterprise_id: scenarioState.fixture.enterpriseId,
      project_id: scenarioState.fixture.projectId,
      ack_observation_id: source.identity.ack_observation_id,
      runtime_adapter_identity_id: source.identity.instance_id,
      runtime_submission_ref: canonicalize(
        actualFinal.runtimeSubmissionRef as unknown as CanonicalJsonObject,
      ),
      result_payload: canonicalize(actualFinal.agentResultContract),
      result_payload_hash: Buffer.from(resultHash.digest, 'hex'),
      binding_hash: source.attempt.binding_hash,
      fencing_token: String(actualFinal.runFencingToken),
      observed_at: actualFinal.observedAt,
      source: 'SYNTHETIC_DRIVER' as const,
      source_command_id: source.attempt.source_command_id,
      canonical_payload: canonicalize(payloadBase),
      payload_hash: Buffer.from(sha256CanonicalJson(payloadBase), 'hex'),
    };
    const rollbackMarker = new Error('WI224 direct final insert rolled back');
    const insertAndRollback = (patch: Partial<typeof base>) => {
      const observationId = newUuidV7();
      const payload = { ...payloadBase, observationId };
      return withRenderTransaction(
        igDb,
        scenarioState.runnerContext(scenarioState.service),
        async (trx) => {
          await trx
            .insertInto('integration_gateway.runtime_final_observation')
            .values({
              ...base,
              observation_id: observationId,
              canonical_payload: canonicalize(payload),
              payload_hash: Buffer.from(sha256CanonicalJson(payload), 'hex'),
              ...patch,
            })
            .execute();
          throw rollbackMarker;
        },
      );
    };
    await expect(insertAndRollback({})).rejects.toBe(rollbackMarker);
    const bodyPatch = (body: CanonicalJsonObject) => {
      const revisedBody = {
        ...body,
        header: { ...record(body.header), payloadHash: contentHash(hashContractPayload(body)) },
      } as unknown as CanonicalJsonObject;
      expect(
        scenarioState.registry.validateCoreContract(
          'https://schemas.zhiju.local/core/agent-result/1.0',
          revisedBody,
        ).valid,
      ).toBe(true);
      return {
        result_payload: canonicalize(revisedBody),
        result_payload_hash: Buffer.from(hashContractPayload(revisedBody), 'hex'),
      };
    };
    const body = actualFinal.agentResultContract;
    const mutations: readonly (readonly [string, Partial<typeof base>])[] = [
      ['Attempt FK', { attempt_id: newUuidV7() }],
      ['ack FK', { ack_observation_id: newUuidV7() }],
      ['Adapter identity', { runtime_adapter_identity_id: newUuidV7() }],
      ['Enterprise Scope', { enterprise_id: newUuidV7() }],
      ['Project Scope', { project_id: newUuidV7() }],
      ['binding Hash', { binding_hash: Buffer.alloc(32) }],
      ['Result Hash', { result_payload_hash: Buffer.alloc(32) }],
      ['observation Hash', { payload_hash: Buffer.alloc(32) }],
      ['source Receipt', { source_command_id: newUuidV7() }],
      ['fencing', { fencing_token: String(actualFinal.runFencingToken + 1) }],
      [
        'Result Run',
        bodyPatch({
          ...body,
          runRef: { ...record(body.runRef), objectId: newUuidV7() },
        }),
      ],
      [
        'Result Scope',
        bodyPatch({
          ...body,
          header: {
            ...record(body.header),
            scopeRef: { enterpriseId: scenarioState.fixture.enterpriseId, projectId: newUuidV7() },
          },
        }),
      ],
      [
        'Result Adapter',
        bodyPatch({
          ...body,
          submittedByRuntime: { ...record(body.submittedByRuntime), objectId: newUuidV7() },
        }),
      ],
      [
        'Result session',
        bodyPatch({
          ...body,
          provenance: {
            ...record(body.provenance),
            runtimeSessionExternalRef: {
              ...record(record(body.provenance).runtimeSessionExternalRef),
              externalId: newUuidV7(),
            },
          },
        }),
      ],
    ];
    const outcomes: { label: string; code: string }[] = [];
    for (const [label, patch] of mutations) {
      try {
        await insertAndRollback(patch);
        outcomes.push({ label, code: 'NO_ROLLBACK' });
      } catch (error) {
        outcomes.push({
          label,
          code:
            error === rollbackMarker
              ? 'ACCEPTED'
              : error !== null &&
                  typeof error === 'object' &&
                  'code' in error &&
                  typeof error.code === 'string'
                ? error.code
                : 'UNKNOWN',
        });
      }
    }
    expect(
      (
        await scenarioState.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM integration_gateway.runtime_final_observation WHERE attempt_id=$1',
          [scenarioState.attemptRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    expect(outcomes).toEqual(mutations.map(([label]) => ({ label, code: '22023' })));
  }
  return false;
}
