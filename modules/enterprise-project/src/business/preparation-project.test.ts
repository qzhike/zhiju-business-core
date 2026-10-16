import { describe, expect, it, vi } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  type PreparationSession,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import {
  createPreparationProjectService,
  type PreparationProjectConfig,
} from './preparation-project.js';

const session: PreparationSession = {
  principalId: newUuidV7(),
  authenticationContextHash: preparationHash({ session: 'controlled-test' }),
  expiresAt: '2099-01-01T00:00:00.000Z',
};
function command(): WorkspaceCommandInput {
  const scopeRef = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
  const requestId = newUuidV7();
  const payload = {
    customer: { mode: 'NEW', displayName: '  客户原名  ' },
    projectTitle: ' 原标题 ',
    preparationPresetRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.project.preparation_preset',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: {},
    },
    preparationPresetHash: preparationHash({ preset: 'exact' }),
  };
  return {
    commandId: newUuidV7(),
    type: 'project.request_project_preparation',
    version: '1.0',
    scopeRef,
    targetRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.project.preparation_request',
      objectId: requestId,
      scope: scopeRef,
    },
    idempotencyKey: `project.request_project_preparation:1.0:${requestId}`,
    correlationId: newUuidV7(),
    requestedAt: '2026-10-15T00:00:00.000Z',
    payload,
    integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
  };
}
function fixture() {
  const verifySession = vi.fn(() => Promise.resolve());
  const authorize = vi.fn(() => Promise.reject(new Error('authorization reached')));
  const reserve = vi.fn();
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error('database reached');
      },
    },
  );
  const service = createPreparationProjectService({
    db,
    verifySession,
    authorize,
    check: vi.fn(),
    identity: { reserve },
    selection: {
      preparationPresetRef: command().payload.preparationPresetRef,
      preparationPresetHash: preparationHash({ preset: 'exact' }),
      publicationRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.preparation_preset_publication',
        objectId: newUuidV7(),
        scope: {},
        contentHash: preparationHash({ publication: 'exact' }),
      },
    },
    cursorKey: Buffer.alloc(32, 1),
    clock: () => new Date('2026-10-15T00:00:00.000Z'),
  } as unknown as PreparationProjectConfig);
  return { service, verifySession, authorize, reserve };
}
describe('Preparation EP owning boundary', () => {
  it.each([
    ['original key', (c: WorkspaceCommandInput) => ({ ...c, idempotencyKey: 'new-key' })],
    [
      'scope',
      (c: WorkspaceCommandInput) => ({ ...c, scopeRef: { ...c.scopeRef, projectId: newUuidV7() } }),
    ],
    [
      'payload hash',
      (c: WorkspaceCommandInput) => ({ ...c, payload: { ...c.payload, projectTitle: 'changed' } }),
    ],
    [
      'browser actor',
      (c: WorkspaceCommandInput) => ({ ...c, actor: { principalId: session.principalId } }),
    ],
    [
      'create aggregate version',
      (c: WorkspaceCommandInput) => ({ ...c, expectedAggregateVersion: 1 }),
    ],
    [
      'foreign customer ref',
      (c: WorkspaceCommandInput) => {
        const payload = {
          ...c.payload,
          customer: {
            mode: 'EXISTING',
            enterpriseRef: {
              kind: 'OBJECT',
              objectType: 'zhiju.project.enterprise',
              objectId: newUuidV7(),
              scope: { enterpriseId: c.scopeRef.enterpriseId },
            },
          },
        };
        return {
          ...c,
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
        };
      },
    ],
    [
      'blank title',
      (c: WorkspaceCommandInput) => {
        const payload = { ...c.payload, projectTitle: '  ' };
        return {
          ...c,
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
        };
      },
    ],
    [
      'UTF-8 bytes',
      (c: WorkspaceCommandInput) => {
        const payload = { ...c.payload, projectTitle: '中'.repeat(171) };
        return {
          ...c,
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
        };
      },
    ],
  ] as const)('rejects invalid %s before admission or database access', async (_name, mutate) => {
    const f = fixture();
    await expect(
      f.service.request(session, mutate(command()) as WorkspaceCommandInput),
    ).rejects.toThrow();
    expect(f.verifySession).toHaveBeenCalledOnce();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('requires the trusted session verifier before any owning action', async () => {
    const f = fixture();
    f.verifySession.mockRejectedValueOnce(new Error('unverified'));
    await expect(f.service.request(session, command())).rejects.toThrow('unverified');
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('rejects expired verified sessions before admission', async () => {
    const f = fixture();
    await expect(
      f.service.request({ ...session, expiresAt: '2026-10-15T00:00:00.000Z' }, command()),
    ).rejects.toThrow('SESSION_EXPIRED');
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it('has no fallback directory page when the preset cannot be authorized', async () => {
    const f = fixture();
    await expect(
      f.service.findEnterprises(session, { searchText: '', page: { limit: 10 } }),
    ).rejects.toThrow();
    expect(f.authorize).toHaveBeenCalledOnce();
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it('requires an unpredictable cursor authentication key', () => {
    expect(() =>
      createPreparationProjectService({ cursorKey: Buffer.alloc(16) } as PreparationProjectConfig),
    ).toThrow('PREPARATION_CONFIGURATION_INVALID');
  });
});
