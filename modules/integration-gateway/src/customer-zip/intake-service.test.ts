/* eslint-disable @typescript-eslint/require-await -- Async stream fixtures intentionally yield deterministic bytes without external IO. */
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  preparationHash,
  type CustomerZipIntakePayload,
  type PreparationSession,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import { createCustomerZipIntakeService } from './intake-service.js';
import { createCustomerZipTicketCodec } from './upload-ticket.js';
import { createCustomerZipPolicyRegistry } from './policy.js';
const ids = {
  human: '0199e61a-7000-7000-8000-000000000001',
  enterprise: '0199e61a-7000-7000-8000-000000000002',
  project: '0199e61a-7000-7000-8000-000000000003',
  intake: '0199e61a-7000-7000-8000-000000000004',
  preparation: '0199e61a-7000-7000-8000-000000000005',
  command: '0199e61a-7000-7000-8000-000000000006',
  version: '0199e61a-7000-7000-8000-000000000007',
};
const scope = { enterpriseId: ids.enterprise, projectId: ids.project };
const ref = (objectType: string, objectId: string) => ({
  kind: 'OBJECT' as const,
  objectType,
  objectId,
  scope,
});
const session: PreparationSession = {
  principalId: ids.human,
  authenticationContextHash: preparationHash({ session: 'verified' }),
  expiresAt: '2026-10-15T11:00:00.000Z',
};
function command(): WorkspaceCommandInput<CustomerZipIntakePayload> {
  const payload: CustomerZipIntakePayload = {
    projectRef: ref('zhiju.project.project', ids.project),
    preparationRequestRef: ref('zhiju.project.preparation_request', ids.preparation),
    originalPreparationKey: 'original-key',
    preparationPresetRef: {
      ...ref('zhiju.project.preparation_preset', ids.preparation),
      kind: 'VERSIONED',
      versionId: ids.version,
    },
    preparationPresetHash: preparationHash({ preset: true }),
    originalName: 'original.zip',
    declaredByteLength: 100,
    zipBytesSha256: preparationHash({ bytes: 'placeholder' }),
    intakePolicyRef: {
      ...ref('zhiju.integration.customer_zip_policy', ids.preparation),
      kind: 'VERSIONED',
      versionId: ids.version,
    },
    intakePolicyHash: preparationHash({ policy: true }),
    submittedNote: 'Customer note',
    analysisIntent: 'ANALYZE',
  };
  return {
    commandId: ids.command,
    type: 'integration.request_customer_zip_intake',
    version: '1.0',
    scopeRef: scope,
    targetRef: ref('zhiju.integration.customer_zip_intake', ids.intake),
    idempotencyKey: `integration.request_customer_zip_intake:1.0:${ids.intake}`,
    correlationId: ids.command,
    requestedAt: '2026-10-15T10:00:00.000Z',
    payload,
    integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
  };
}
function fixture() {
  const pool = new Pool(),
    connect = vi
      .spyOn(pool, 'connect')
      .mockRejectedValue(new Error('Unexpected protected database access'));
  const unavailable = () => Promise.reject(new Error('Unexpected owner call'));
  const verifySession = vi.fn(() => Promise.resolve());
  const authorize = vi.fn(() => Promise.reject(new Error('AUTHORIZATION_DENIED')));
  const service = createCustomerZipIntakeService({
    pool,
    ticketCodec: createCustomerZipTicketCodec({
      activeKeyId: 'test',
      keys: new Map([['test', Buffer.alloc(32, 1)]]),
    }),
    policyResolver: createCustomerZipPolicyRegistry([]),
    verifySession,
    authorize,
    objectStore: { put: unavailable, read: unavailable, inspect: unavailable },
    owners: {
      resolvePreparation: unavailable,
      acceptSource: unavailable,
      sourceLinks: unavailable,
      acceptHandoff: unavailable,
      queryHandoff: unavailable,
    },
  });
  return { service, connect, authorize, verifySession };
}
describe('owning customer ZIP service authorization boundary', () => {
  it('rejects a changed original note/hash before protected reads or authorizations', async () => {
    const f = fixture(),
      original = command(),
      forged = { ...original, payload: { ...original.payload, submittedNote: 'different' } };
    await expect(f.service.request(session, forged)).rejects.toThrow('API_PAYLOAD_HASH_MISMATCH');
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it('requires current intake permission before EP preparation read or any database access', async () => {
    const f = fixture();
    await expect(f.service.request(session, command())).rejects.toThrow('AUTHORIZATION_DENIED');
    expect(f.authorize).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ purpose: 'integration.customer_zip.intake', scopeRef: scope }),
    );
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('rejects forged cross-Scope selectors without protected lookups', async () => {
    const f = fixture();
    await expect(
      f.service.get(session, {
        scopeRef: { ...scope, projectId: ids.intake },
        payload: {
          by: 'INTAKE',
          intakeRef: ref('zhiju.integration.customer_zip_intake', ids.intake),
        },
        correlationId: ids.command,
      }),
    ).rejects.toThrow('SCOPE_MISMATCH');
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('reverifies the actual trusted Session before minimal upload scope lookup', async () => {
    const f = fixture();
    f.verifySession.mockRejectedValueOnce(new Error('SESSION_REVOKED'));
    async function* empty() {
      yield new Uint8Array();
    }
    await expect(
      f.service.upload(session, {
        intakeId: ids.intake,
        token: 'token',
        stream: empty(),
        contentLength: 1,
      }),
    ).rejects.toThrow('SESSION_REVOKED');
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });
});
