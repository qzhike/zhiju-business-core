import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Common, IntegrationGateway, TaskExecution } from '@zhiju/contracts';
import {
  ControlledRuntimeDispatchService,
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
  withRenderTransaction,
  type RenderTransactionContext,
  type SyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const enterpriseId = 'fa01fa01-fa01-7a01-8a01-fa01fa01fa01';
const projectId = 'fa02fa02-fa02-7a02-8a02-fa02fa02fa02';
const principalId = 'fa03fa03-fa03-7a03-8a03-fa03fa03fa03';
const actorId = 'fa04fa04-fa04-7a04-8a04-fa04fa04fa04';
const decisionId = 'fa05fa05-fa05-7a05-8a05-fa05fa05fa05';
const policyId = 'fa06fa06-fa06-7a06-8a06-fa06fa06fa06';
const correlationId = 'fa07fa07-fa07-7a07-8a07-fa07fa07fa07';
const scope = { enterpriseId, projectId };
const hash = (digest: string): Common.ContentHash => ({
  algorithm: 'SHA-256',
  canonicalizationVersion: '1',
  digest,
});
const objectRef = (objectType: string, objectId = newUuidV7()): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType,
  objectId,
  scope,
});

function fixture() {
  const workOrderRef = objectRef('zhiju.execution.work_order');
  const runRef = objectRef('execution.run');
  const attemptRef = objectRef('integration.runtime_attempt');
  const workOrderContractRef: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.contract.work_order',
    objectId: newUuidV7(),
    scope,
    contentHash: hash('a'.repeat(64)),
  };
  const contextSnapshotRef: Common.SnapshotRef = {
    kind: 'SNAPSHOT',
    objectType: 'zhiju.execution.context_snapshot',
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope,
    contentHash: hash('b'.repeat(64)),
  };
  const payload = {
    runRef,
    workOrderRef,
    workOrderContractRef,
    contextSnapshotRef,
    validUntil: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as CanonicalJsonObject;
  const capabilityGrantRef: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.identity.execution_capability_bundle',
    objectId: newUuidV7(),
    scope,
    contentHash: hash(sha256CanonicalJson(payload)),
  };
  const runtimeBinding = {
    adapterCode: 'te.human_operated.synthetic',
    adapterVersion: '1.0',
    harnessId: 'zhiju.runtime.synthetic',
    harnessVersion: '1.0',
    provider: 'synthetic',
    modelId: 'synthetic',
    modelConfigHash: hash(sha256CanonicalJson({})),
  };
  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const binding = {
    runRef,
    workOrderRef,
    workOrderContractRef,
    contextSnapshotRef,
    capabilityGrantRef,
    runtimeBinding,
    leaseId: newUuidV7(),
    fencingToken: 1,
    leaseExpiresAt,
    executionDeadline: leaseExpiresAt,
    status: 'CREATED',
    aggregateVersion: 1,
  } as unknown as TaskExecution.ExecutionGetRunDispatchBindingResult;
  const request = {
    workOrderRef,
    runRef,
    workOrderContractRef,
    contextSnapshotRef,
    capabilityGrantRef,
    runtimeBinding,
    stableIdempotencyKey: newUuidV7(),
    requestedAt: new Date().toISOString(),
  } as unknown as IntegrationGateway.RuntimeDispatchRequest;
  const command = {
    commandId: newUuidV7(),
    idempotencyScope: `integration.request_runtime_dispatch@1.0:${enterpriseId}:${projectId}`,
    idempotencyKey: request.stableIdempotencyKey,
    correlationId,
  };
  return { attemptRef, binding, request, command, capabilityGrantRef, payload };
}

function context(): RenderTransactionContext {
  return {
    kind: 'REQUEST',
    principalId,
    principalKind: 'SERVICE',
    actorSnapshotId: actorId,
    authorizationDecisionId: decisionId,
    authorizationDecisionHash: Buffer.alloc(32, 0x51),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
    policySnapshotId: policyId,
    enterpriseId,
    allowedProjectIds: [projectId],
    correlationId,
  };
}

describe.skipIf(!databaseUrl)('controlled RuntimeAttempt persistence', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIntegrationRendererDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      "CREATE ROLE im06_run_probe LOGIN PASSWORD 'im06-run-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
    await admin.query(
      'GRANT platform_context_establisher, integration_gateway_app TO im06_run_probe',
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im06_run_probe';
    url.password = 'im06-run-probe';
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createIntegrationRendererDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query('DROP ROLE im06_run_probe');
    await admin.end();
  });

  it('persists a real driver acknowledgement and replays without another invocation', async () => {
    const f = fixture();
    const driver = new LocalSyntheticRuntimeDriver();
    const verifiedDriver: SyntheticRuntimeDriver = {
      invoke: async (input) => {
        const beforeDriver = await admin.query<{
          source_command_id: string;
          receipt_outcome: string;
          audits: string;
          edges: string;
          events: string;
        }>(
          `SELECT (SELECT source_command_id::text FROM integration_gateway.runtime_attempt WHERE attempt_id=$1) AS source_command_id,
                  (SELECT outcome FROM integration_gateway.command_receipt WHERE command_id=$2) AS receipt_outcome,
                  (SELECT count(*)::text FROM integration_gateway.audit_record WHERE command_id=$2) AS audits,
                  (SELECT count(*)::text FROM integration_gateway.reference_edge WHERE source_command_id=$2) AS edges,
                  (SELECT count(*)::text FROM integration_gateway.outbox_event WHERE aggregate_id=$1) AS events`,
          [f.attemptRef.objectId, f.command.commandId],
        );
        expect(beforeDriver.rows[0]).toEqual({
          source_command_id: f.command.commandId,
          receipt_outcome: 'PENDING',
          audits: '1',
          edges: '5',
          events: '0',
        });
        return driver.invoke(input);
      },
      readBack: (ref) => driver.readBack(ref),
    };
    const service = new ControlledRuntimeDispatchService(
      db,
      verifiedDriver,
      new InMemoryRenderObjectStorage(),
      {
        now: () => new Date(),
        revalidateAuthorization: () => Promise.resolve(),
        readDispatchBinding: () => Promise.resolve(f.binding),
        readBundle: () =>
          Promise.resolve({
            bundleRef: f.capabilityGrantRef as unknown as CanonicalJsonObject,
            payload: f.payload,
            useStatus: 'USABLE',
          }),
        authorizeReceipt: () => Promise.resolve(() => Promise.resolve()),
      },
    );
    const first = await service.dispatch(context(), {
      attemptRef: f.attemptRef,
      request: f.request,
      command: f.command,
    });
    expect(first.status).toBe('SUCCEEDED');
    expect(first.acknowledgement?.source).toBe('SYNTHETIC_DRIVER');
    expect(driver.invokedAttemptIds).toEqual([f.attemptRef.objectId]);
    const replay = await service.dispatch(context(), {
      attemptRef: f.attemptRef,
      request: f.request,
      command: f.command,
    });
    expect(replay).toEqual(first);
    expect(driver.invokedAttemptIds).toHaveLength(1);
    const counts = await admin.query<{
      attempts: string;
      receipts: string;
      observations: string;
      events: string;
    }>(
      `SELECT (SELECT count(*) FROM integration_gateway.runtime_attempt WHERE attempt_id = $1)::text AS attempts,
              (SELECT count(*) FROM integration_gateway.raw_external_receipt WHERE runtime_attempt_id = $1)::text AS receipts,
              (SELECT count(*) FROM integration_gateway.runtime_attempt_observation WHERE attempt_id = $1)::text AS observations,
              (SELECT count(*) FROM integration_gateway.outbox_event WHERE aggregate_id = $1)::text AS events`,
      [f.attemptRef.objectId],
    );
    expect(counts.rows[0]).toEqual({
      attempts: '1',
      receipts: '1',
      observations: '1',
      events: '1',
    });
    const source = await admin.query<{
      outcome: string;
      result_payload: unknown;
      event_command_id: string;
    }>(
      `SELECT receipt.outcome, receipt.result_payload,
              (SELECT source_command_id::text FROM integration_gateway.outbox_event WHERE aggregate_id=$1) AS event_command_id
         FROM integration_gateway.command_receipt receipt WHERE receipt.command_id=$2`,
      [f.attemptRef.objectId, f.command.commandId],
    );
    expect(source.rows[0]).toEqual({
      outcome: 'COMMITTED',
      result_payload: first,
      event_command_id: f.command.commandId,
    });
    await expect(
      admin.query(
        `INSERT INTO integration_gateway.runtime_attempt
           (attempt_id, enterprise_id, project_id, stable_key_hash, request_payload,
            request_payload_hash, invocation_binding, binding_hash, source_command_id,
            created_at, updated_at)
         SELECT $2::uuid, enterprise_id, project_id, $3::bytea, request_payload,
                request_payload_hash, invocation_binding, binding_hash, $4::uuid,
                now(), now()
           FROM integration_gateway.runtime_attempt WHERE attempt_id=$1::uuid`,
        [f.attemptRef.objectId, newUuidV7(), Buffer.alloc(32, 0x31), newUuidV7()],
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23503|22023)$/) });
  });

  it('keeps an uncertain invocation UNKNOWN and never calls the driver twice', async () => {
    const f = fixture();
    let calls = 0;
    const driver: SyntheticRuntimeDriver = {
      invoke: () => {
        calls += 1;
        return Promise.reject(new Error('ack lost'));
      },
      readBack: () => Promise.resolve(undefined),
    };
    const service = new ControlledRuntimeDispatchService(
      db,
      driver,
      new InMemoryRenderObjectStorage(),
      {
        now: () => new Date(),
        revalidateAuthorization: () => Promise.resolve(),
        readDispatchBinding: () => Promise.resolve(f.binding),
        readBundle: () =>
          Promise.resolve({
            bundleRef: f.capabilityGrantRef as unknown as CanonicalJsonObject,
            payload: f.payload,
            useStatus: 'USABLE',
          }),
        authorizeReceipt: () => Promise.resolve(() => Promise.resolve()),
      },
    );
    expect(
      (
        await service.dispatch(context(), {
          attemptRef: f.attemptRef,
          request: f.request,
          command: f.command,
        })
      ).status,
    ).toBe('UNKNOWN');
    expect(
      (
        await service.dispatch(context(), {
          attemptRef: f.attemptRef,
          request: f.request,
          command: f.command,
        })
      ).status,
    ).toBe('UNKNOWN');
    expect(calls).toBe(1);
    const receipt = await admin.query<{ outcome: string; status: string }>(
      `SELECT receipt.outcome, receipt.result_payload->>'status' AS status
         FROM integration_gateway.command_receipt receipt WHERE command_id=$1`,
      [f.command.commandId],
    );
    expect(receipt.rows).toEqual([{ outcome: 'COMMITTED', status: 'UNKNOWN' }]);
    await expect(
      withRenderTransaction(db, context(), (trx) =>
        trx
          .updateTable('integration_gateway.runtime_attempt')
          .set({ status: 'SUCCEEDED', updated_at: new Date() })
          .where('attempt_id', '=', f.attemptRef.objectId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await service.reconcileUnknown(context(), f.attemptRef)).toMatchObject({
      status: 'UNKNOWN',
    });
    expect(calls).toBe(1);
  });
});
