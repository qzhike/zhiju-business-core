// IM-05 WI-05 (issue #125): real PostgreSQL Renderer Attempt, Receipt, UNKNOWN,
// reconciliation, RLS, rollback, and Artifact public-port composition probes.

import { readFileSync } from 'node:fs';

import { validateRepresentationBinding, type ArtifactTransactionContext } from '@zhiju/artifact';
import type { Artifact, Common, IntegrationGateway } from '@zhiju/contracts';
import {
  createIntegrationRendererDatabase,
  DOCX_RENDERER_PROFILE,
  InMemoryRenderObjectStorage,
  INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT,
  LocalOoxmlRenderProvider,
  RenderAttemptService,
  type RenderProviderOutcome,
  type RenderProviderPort,
  type RenderTransactionContext,
} from '@zhiju/integration-gateway';
import {
  canonicalizeCanonicalContentPayload,
  hashCanonicalContentPayload,
  newUuidV7,
  type CanonicalContentPayload,
} from '@zhiju/shared-kernel';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE = '11111111-1111-7111-8111-111111111111';
const PROJECT_A = '22222222-2222-7222-8222-222222222222';
const PROJECT_B = '33333333-3333-7333-8333-333333333333';
const PRINCIPAL = '44444444-4444-7444-8444-444444444444';
const ACTOR = '55555555-5555-7555-8555-555555555555';
const DECISION = '66666666-6666-7666-8666-666666666666';
const POLICY = '77777777-7777-7777-8777-777777777777';
const CORRELATION = '88888888-8888-7888-8888-888888888888';
const DECISION_HASH = Buffer.alloc(32, 0x45);

function context(overrides: Partial<RenderTransactionContext> = {}): RenderTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'SERVICE',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT_A],
    correlationId: CORRELATION,
    ...overrides,
  };
}

function documentPayload(): Artifact.CanonicalContentPayload {
  const url = new URL(
    '../fixtures/contracts/canonical-content/document-golden.json',
    import.meta.url,
  );
  const parsed = JSON.parse(readFileSync(url, 'utf8')) as { payload: unknown };
  return parsed.payload as Artifact.CanonicalContentPayload;
}

function contentHash(payload: Artifact.CanonicalContentPayload): Common.ContentHash {
  return hashCanonicalContentPayload(payload as unknown as CanonicalContentPayload);
}

function attemptRef(attemptId = newUuidV7(), projectId = PROJECT_A): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'integration.render_attempt',
    objectId: attemptId,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function renderRequest(
  payload: Artifact.CanonicalContentPayload,
  stableIdempotencyKey: string,
  sourceRef: string,
): IntegrationGateway.RenderRequest {
  const inputHash = contentHash(payload);
  return {
    revisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'artifact.artifact_revision',
      objectId: newUuidV7(),
      immutableVersionId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      contentHash: inputHash,
    },
    canonicalContentRef: sourceRef,
    inputHash,
    outputFormat: DOCX_RENDERER_PROFILE.outputFormat,
    rendererId: DOCX_RENDERER_PROFILE.rendererId,
    rendererVersion: DOCX_RENDERER_PROFILE.rendererVersion,
    renderPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'policy.render',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
    },
    stableIdempotencyKey,
    requestedAt: '2026-08-30T12:00:00Z',
  };
}

class CountingProvider implements RenderProviderPort {
  calls = 0;

  constructor(private readonly delegate: RenderProviderPort) {}

  render(input: {
    readonly attemptRef: Common.ObjectRef;
    readonly request: IntegrationGateway.RenderRequest;
  }): Promise<RenderProviderOutcome> {
    this.calls += 1;
    return this.delegate.render(input);
  }

  verifySucceeded(input: Parameters<RenderProviderPort['verifySucceeded']>[0]): Promise<boolean> {
    return this.delegate.verifySucceeded(input);
  }
}

interface SqlOutcome {
  readonly allowed: boolean;
  readonly code?: string;
}

describe.skipIf(!gateEnabled)('IntegrationGateway Renderer slice (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIntegrationRendererDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE im05_wi05_probe LOGIN PASSWORD 'im05-wi05-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher, integration_gateway_app TO im05_wi05_probe`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im05_wi05_probe';
    url.password = 'im05-wi05-probe';
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createIntegrationRendererDatabase(pool);
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.query('DROP ROLE im05_wi05_probe');
    await admin.end();
  });

  async function count(
    table: string,
    where = '',
    values: readonly unknown[] = [],
  ): Promise<number> {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM integration_gateway.${table} ${where}`,
      [...values],
    );
    return Number(result.rows[0]?.count ?? '-1');
  }

  async function establish(
    client: pg.Client,
    projectIds: readonly string[] = [PROJECT_A],
  ): Promise<void> {
    await client.query('SET LOCAL ROLE platform_context_establisher');
    await client.query(
      `SELECT platform_security.establish_transaction_context(
        'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        PRINCIPAL,
        ACTOR,
        DECISION,
        DECISION_HASH,
        new Date(Date.now() + 60 * 60 * 1000),
        ENTERPRISE,
        [...projectIds],
        CORRELATION,
      ],
    );
    await client.query('SET LOCAL ROLE integration_gateway_app');
  }

  async function trySql(text: string, values: readonly unknown[] = []): Promise<SqlOutcome> {
    await probe.query('SAVEPOINT renderer_statement_probe');
    try {
      await probe.query(text, [...values]);
      await probe.query('RELEASE SAVEPOINT renderer_statement_probe');
      return { allowed: true };
    } catch (error) {
      const code = (error as pg.DatabaseError).code;
      await probe.query('ROLLBACK TO SAVEPOINT renderer_statement_probe');
      await probe.query('RELEASE SAVEPOINT renderer_statement_probe');
      return { allowed: false, ...(code === undefined ? {} : { code }) };
    }
  }

  async function sourceFixture(
    storage: InMemoryRenderObjectStorage,
    locator: string,
  ): Promise<Artifact.CanonicalContentPayload> {
    const payload = documentPayload();
    const bytes = Buffer.from(
      canonicalizeCanonicalContentPayload(payload as unknown as CanonicalContentPayload),
      'utf8',
    );
    await storage.putImmutable({ locator, bytes, mediaType: 'application/json' });
    return payload;
  }

  it('persists exact success, replays once, rejects hash conflicts, and composes through the Artifact public port', async () => {
    const storage = new InMemoryRenderObjectStorage();
    const sourceRef = `integration/render/source/${newUuidV7()}.json`;
    const payload = await sourceFixture(storage, sourceRef);
    const request = renderRequest(payload, `render-success-${newUuidV7()}`, sourceRef);
    const ref = attemptRef();
    const provider = new CountingProvider(new LocalOoxmlRenderProvider(storage));
    const service = new RenderAttemptService(db, provider);

    const first = await service.requestRender(context(), {
      attemptRef: ref,
      request,
      timeoutMs: 1000,
    });
    expect(first.status).toBe('SUCCEEDED');
    expect(first.succeededResult?.outputChecksum.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.rawReceiptRef?.contentHash.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(provider.calls).toBe(1);
    const replay = await service.requestRender(context(), {
      attemptRef: attemptRef(newUuidV7()),
      request,
      timeoutMs: 1000,
    });
    expect(replay).toEqual(first);
    expect(provider.calls).toBe(1);

    const conflicting = {
      ...request,
      canonicalContentRef: `integration/render/source/${newUuidV7()}.json`,
    };
    await expect(
      service.requestRender(context(), {
        attemptRef: attemptRef(),
        request: conflicting,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT });
    await expect(
      service.requestRender(context(), {
        attemptRef: ref,
        request: { ...request, stableIdempotencyKey: `different-key-${newUuidV7()}` },
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT });

    if (first.succeededResult === undefined) throw new Error('missing successful fixture result');
    const registration: Artifact.RepresentationRegistration = {
      revisionRef: request.revisionRef,
      format: request.outputFormat,
      mediaType: DOCX_RENDERER_PROFILE.mediaType,
      objectRef: first.succeededResult.outputObjectRef,
      checksum: first.succeededResult.outputChecksum,
      rendererId: request.rendererId,
      rendererVersion: request.rendererVersion,
      renderAttemptRef: first.attemptRef,
      createdAt: new Date().toISOString(),
    };
    const artifactContext: ArtifactTransactionContext = context();
    expect(validateRepresentationBinding(registration, first, artifactContext)).toMatchObject({
      registration,
      binding: first,
    });
    const checksumMismatch: IntegrationGateway.RenderAttemptBindingView = {
      ...first,
      succeededResult: {
        ...first.succeededResult,
        outputChecksum: { ...first.succeededResult.outputChecksum, digest: 'ef'.repeat(32) },
      },
    };
    expect(() =>
      validateRepresentationBinding(registration, checksumMismatch, artifactContext),
    ).toThrow();

    expect(await count('render_attempt', 'WHERE attempt_id = $1', [ref.objectId])).toBe(1);
    expect(await count('raw_external_receipt', 'WHERE attempt_id = $1', [ref.objectId])).toBe(1);
    expect(
      await count(
        'outbox_event',
        "WHERE event_type = 'integration.RenderSucceeded' AND aggregate_id = $1",
        [ref.objectId],
      ),
    ).toBe(1);

    const missingSourceRequest = renderRequest(
      payload,
      `render-failed-${newUuidV7()}`,
      `integration/render/source/${newUuidV7()}.json`,
    );
    const failedRef = attemptRef();
    const failed = await service.requestRender(context(), {
      attemptRef: failedRef,
      request: missingSourceRequest,
      timeoutMs: 1000,
    });
    expect(failed.status).toBe('FAILED');
    expect(failed).not.toHaveProperty('succeededResult');
    expect(failed).not.toHaveProperty('rawReceiptRef');
    expect(await count('raw_external_receipt', 'WHERE attempt_id = $1', [failedRef.objectId])).toBe(
      0,
    );
  });

  it('keeps timeout UNKNOWN, never repeats it, and reconciles only authoritative readback', async () => {
    const storage = new InMemoryRenderObjectStorage();
    const sourceRef = `integration/render/source/${newUuidV7()}.json`;
    const payload = await sourceFixture(storage, sourceRef);
    const request = renderRequest(payload, `render-unknown-${newUuidV7()}`, sourceRef);
    const ref = attemptRef();
    const local = new LocalOoxmlRenderProvider(storage);
    let calls = 0;
    const hanging: RenderProviderPort = {
      render: () => {
        calls += 1;
        return new Promise<RenderProviderOutcome>(() => undefined);
      },
      verifySucceeded: (input) => local.verifySucceeded(input),
    };
    const service = new RenderAttemptService(db, hanging);
    const unknown = await service.requestRender(context(), {
      attemptRef: ref,
      request,
      timeoutMs: 5,
    });
    expect(unknown.status).toBe('UNKNOWN');
    expect(unknown.succeededResult).toBeUndefined();
    const replay = await service.requestRender(context(), {
      attemptRef: ref,
      request,
      timeoutMs: 5,
    });
    expect(replay).toEqual(unknown);
    expect(calls).toBe(1);

    const observed = await local.render({ attemptRef: ref, request });
    if (observed.outcome !== 'SUCCEEDED') throw new Error('local reconciliation fixture failed');
    const tampered = {
      ...observed,
      outputChecksum: { ...observed.outputChecksum, digest: 'ab'.repeat(32) },
    } satisfies RenderProviderOutcome;
    await expect(service.reconcileSucceeded(context(), ref, tampered)).rejects.toMatchObject({
      code: 'INTEGRATION_RENDER_OUTPUT_MISMATCH',
    });
    const reconciled = await service.reconcileSucceeded(context(), ref, observed);
    expect(reconciled.status).toBe('SUCCEEDED');
    expect(await count('raw_external_receipt', 'WHERE attempt_id = $1', [ref.objectId])).toBe(1);
  });

  it('rolls back Receipt/terminal state/Outbox and enforces RLS plus immutable writes', async () => {
    const storage = new InMemoryRenderObjectStorage();
    const sourceRef = `integration/render/source/${newUuidV7()}.json`;
    const payload = await sourceFixture(storage, sourceRef);
    const request = renderRequest(payload, `render-rollback-${newUuidV7()}`, sourceRef);
    const ref = attemptRef();
    const service = new RenderAttemptService(db, new LocalOoxmlRenderProvider(storage));
    await expect(
      service.requestRender(context(), {
        attemptRef: ref,
        request,
        timeoutMs: 1000,
        failAfterOutbox: true,
      }),
    ).rejects.toThrow('controlled fault after render outbox');
    const row = await admin.query<{ status: string }>(
      'SELECT status FROM integration_gateway.render_attempt WHERE attempt_id = $1',
      [ref.objectId],
    );
    expect(row.rows[0]?.status).toBe('CREATED');
    const createdBinding = await service.getRenderAttemptBinding(context(), ref);
    expect(createdBinding.status).toBe('CREATED');
    expect(createdBinding).not.toHaveProperty('succeededResult');
    expect(await count('raw_external_receipt', 'WHERE attempt_id = $1', [ref.objectId])).toBe(0);
    expect(
      await count(
        'outbox_event',
        "WHERE event_type = 'integration.RenderSucceeded' AND aggregate_id = $1",
        [ref.objectId],
      ),
    ).toBe(0);

    await probe.query('BEGIN');
    try {
      await establish(probe);
      expect(
        await trySql(
          'UPDATE integration_gateway.render_attempt SET status = $2 WHERE attempt_id = $1',
          [ref.objectId, 'SUCCEEDED'],
        ),
      ).toMatchObject({ allowed: false, code: '42501' });
      expect(
        await trySql('DELETE FROM integration_gateway.render_attempt WHERE attempt_id = $1', [
          ref.objectId,
        ]),
      ).toMatchObject({ allowed: false, code: '42501' });
      expect(await trySql('SELECT count(*) FROM artifact.representation')).toMatchObject({
        allowed: false,
        code: '42501',
      });
    } finally {
      await probe.query('ROLLBACK');
    }

    await probe.query('BEGIN');
    try {
      await establish(probe, [PROJECT_B]);
      const hidden = await probe.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM integration_gateway.render_attempt WHERE attempt_id = $1',
        [ref.objectId],
      );
      expect(hidden.rows[0]?.count).toBe('0');
    } finally {
      await probe.query('ROLLBACK');
    }
  });
});
