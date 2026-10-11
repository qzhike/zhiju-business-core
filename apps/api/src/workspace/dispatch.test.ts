// IM-UI-01 (#266/#258): deterministic unit tests of the closed workspace
// dispatch. The owning modules are replaced with explicit test doubles at the
// module boundary, so the suite exercises the real dispatch table, the real
// route/body/override checks and the real error projection without a database
// or an identity provider.
//
// Covered: unknown and non-allowlisted operations (404), an allowlisted but
// unimplemented command (503), the route-versus-body mismatch and override-field
// rejection (400), the directory `scopeRef={}` acceptance, and the board
// refusal of an empty scope.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  authorizeCandidate: (): Promise<unknown> => Promise.resolve({ outcome: 'ALLOW' }),
  revalidateCandidate: (): Promise<unknown> => Promise.resolve({ valid: true }),
}));

vi.mock('@zhiju/identity-policy', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveVerifiedHuman: vi.fn(),
    createActorSnapshot: vi.fn(),
    discoverWorkspaceProjectScopes: vi.fn(),
    withIdentityTransaction: (
      _db: unknown,
      _context: unknown,
      fn: (trx: unknown) => Promise<unknown>,
    ) => fn({}),
    createWorkspaceProjectDiscoveryPort: vi.fn(() => ({
      authorize: () => Promise.resolve({ outcome: 'DENY', reasons: [] }),
      revalidate: () => Promise.resolve({ valid: true }),
      authorizeCandidate: () => mockState.authorizeCandidate(),
      revalidateCandidate: () => mockState.revalidateCandidate(),
    })),
  };
});

vi.mock('@zhiju/enterprise-project', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, readWorkspaceProjectSummary: vi.fn() };
});

import {
  WorkspaceHumanIdentityError,
  createActorSnapshot,
  discoverWorkspaceProjectScopes,
  resolveVerifiedHuman,
  type VerifiedHumanResolution,
} from '@zhiju/identity-policy';
import { readWorkspaceProjectSummary } from '@zhiju/enterprise-project';
import { createWorkspaceDispatch } from './dispatch.js';
import type { WorkspaceDispatchRequest } from './controller.js';

const ENT = '018f22e2-7c15-7b2e-8d86-2de956a9d405';
const PRJ = '018f22e2-7c15-7b2e-8d86-2de956a9d406';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d402';
const QUERY_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d401';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d404';

const repoDouble = {
  getAuthorizationDecisionByIdAndHash: (): Promise<unknown> =>
    Promise.resolve({
      hashMatched: true,
      row: {
        authorization_decision_id: '018f22e2-7c15-7b2e-8d86-2de956a9d500',
        actor_snapshot_id: '018f22e2-7c15-7b2e-8d86-2de956a9d501',
        actor_snapshot_payload_hash: Buffer.alloc(32, 1),
        principal_id: PRINCIPAL,
        principal_kind: 'HUMAN',
        outcome: 'ALLOW',
        command_type: 'project.workspace.discover',
        scope_kind: 'PROJECT',
        enterprise_id: ENT,
        project_id: PRJ,
        purpose: 'project.workspace.discover',
        policy_snapshot_id: '018f22e2-7c15-7b2e-8d86-2de956a9d502',
        policy_snapshot_payload_hash: Buffer.alloc(32, 2),
        authentication_context_hash: Buffer.alloc(32, 7),
        expires_at: new Date('2026-10-10T00:05:00.000Z'),
        payload_hash: Buffer.alloc(32, 3),
      },
    }),
};

function makeDispatch() {
  return createWorkspaceDispatch({
    identity: { db: {} as never, repo: repoDouble as never, crypto: {} as never },
    enterpriseProjectDb: {} as never,
    taskExecutionDb: {} as never,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: 'workspace.project.discovery.v1',
      projectBoardSliceReadHumanV1: 'project.board.slice.read.v1',
      taskBoardReadHumanV1: 'task.board.read.v1',
      taskBoardSourceReadV1: 'task.board.source.read.v1',
      taskBoardHealthReadV1: 'task.board.health.read.v1',
      taskBoardPolicyReadV1: 'task.board.policy.read.v1',
    },
    boardService: { principalId: '018f22e2-7c15-7b2e-8d86-2de956a9d900' },
    boardPolicyRef: () => undefined,
    cursorKey: { keyId: 1, secret: Buffer.alloc(32, 9) },
    now: () => new Date('2026-10-10T00:00:00.000Z'),
  });
}

function request(overrides: Partial<WorkspaceDispatchRequest>): WorkspaceDispatchRequest {
  return {
    kind: 'QUERY',
    operation: 'project.find_workspace_projects',
    version: '1.0',
    body: directoryBody(),
    context: {} as never,
    sessionBinding: Buffer.alloc(32, 2),
    correlationId: CORRELATION,
    ...overrides,
  };
}

function directoryBody(scopeRef: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryId: QUERY_ID,
    type: 'project.find_workspace_projects',
    version: '1.0',
    scopeRef,
    consistencyRequirement: 'AUTHORITATIVE',
    pagination: { pageSize: 25 },
    correlationId: CORRELATION,
    requestedAt: '2026-10-10T00:00:00Z',
    payload: { page: { pageSize: 25 } },
  };
}

function boardBody(): Record<string, unknown> {
  return {
    queryId: QUERY_ID,
    type: 'project.get_project_board_slice',
    version: '1.0',
    scopeRef: {},
    consistencyRequirement: 'PROJECTION_OK',
    correlationId: CORRELATION,
    requestedAt: '2026-10-10T00:00:00Z',
    payload: {
      projectRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: PRJ,
        scope: { enterpriseId: ENT, projectId: PRJ },
      },
      statuses: [],
      itemTypes: [],
      page: { pageSize: 25 },
    },
  };
}

beforeEach(() => {
  mockState.authorizeCandidate = () =>
    Promise.resolve({
      outcome: 'ALLOW',
      reasons: ['ALLOWED_BY_GRANT'],
      authorizationDecisionRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'identity.authorization_decision',
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d600',
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: { algorithm: 'SHA-256', digest: 'b'.repeat(64), canonicalizationVersion: '1' },
      },
      expiresAt: '2026-10-10T00:05:00.000Z',
    });
  mockState.revalidateCandidate = () => Promise.resolve({ valid: true });
  vi.mocked(resolveVerifiedHuman).mockReset();
  vi.mocked(createActorSnapshot).mockReset();
  vi.mocked(discoverWorkspaceProjectScopes).mockReset();
  vi.mocked(readWorkspaceProjectSummary).mockReset();
  vi.mocked(resolveVerifiedHuman).mockResolvedValue({
    principalRef: {
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: PRINCIPAL,
      scope: {},
    },
    resolvedByLinkRef: {
      kind: 'OBJECT',
      objectType: 'identity.external_identity_link',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d503',
      scope: {},
    },
    principalKind: 'HUMAN',
    status: 'ACTIVE',
    displayName: 'Ada Lovelace',
    authenticationContextHash: Buffer.alloc(32, 7),
  } satisfies VerifiedHumanResolution);
  vi.mocked(createActorSnapshot).mockResolvedValue({
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d504',
    snapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d504',
    scope: {},
    contentHash: { algorithm: 'SHA-256', digest: 'd'.repeat(64), canonicalizationVersion: '1' },
  } as never);
  vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue({
    items: [
      {
        projectRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.project.project',
          objectId: PRJ,
          scope: { enterpriseId: ENT, projectId: PRJ },
        },
        sourceWatermark: {
          sourceModule: 'identity_policy',
          partition: `workspace_project_discovery:${PRINCIPAL}`,
          sequence: 4,
          observedAt: '2026-10-10T00:00:00.000Z',
        },
      },
    ],
    authorizationFingerprint: 'a'.repeat(64),
    sourceWatermarks: [
      {
        sourceModule: 'identity_policy',
        partition: `workspace_project_discovery:${PRINCIPAL}`,
        sequence: 4,
        observedAt: '2026-10-10T00:00:00.000Z',
      },
    ],
  } as never);
  vi.mocked(readWorkspaceProjectSummary).mockResolvedValue({
    enterpriseId: ENT,
    projectId: PRJ,
    enterpriseDisplayName: 'Example Enterprise',
    displayCode: 'ENT-0001',
    title: 'Upgrade',
    status: 'ACTIVE',
    aggregateVersion: 3,
  } as never);
});

describe('createWorkspaceDispatch', () => {
  it('returns 404 NOT_FOUND for an unknown operation', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(
      request({ operation: 'project.unknown', body: { type: 'project.unknown', version: '1.0' } }),
    );
    expect(response.status).toBe(404);
    expect(response.payload).toMatchObject({ code: 'NOT_FOUND', retryable: false });
  });

  it('returns 404 NOT_FOUND for an unknown version of an implemented operation', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(
      request({
        version: '2.0',
        body: { ...directoryBody(), version: '2.0' },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.payload).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 503 DEPENDENCY_UNAVAILABLE for an allowlisted but unimplemented command', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(
      request({
        kind: 'COMMAND',
        operation: 'project.request_project_preparation',
        body: { type: 'project.request_project_preparation', version: '1.0' },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.payload).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
  });

  it('returns 400 API_VALUE_INVALID when the route and body operation differ', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(
      request({ operation: 'project.find_workspace_projects', body: boardBody() }),
    );
    expect(response.status).toBe(400);
    expect(response.payload).toMatchObject({ code: 'API_VALUE_INVALID' });
  });

  it('returns 400 API_VALUE_INVALID when the body carries a business override field', async () => {
    const dispatch = makeDispatch();
    const body = directoryBody();
    body.requester = { kind: 'OBJECT', objectType: 'identity.principal', objectId: PRINCIPAL };
    const response = await dispatch.execute(request({ body }));
    expect(response.status).toBe(400);
    expect(response.payload).toMatchObject({ code: 'API_VALUE_INVALID' });
  });

  it('rejects a nested override field inside the payload', async () => {
    const dispatch = makeDispatch();
    const body = directoryBody();
    (body.payload as Record<string, unknown>).authorizationDecisionRef = { objectId: PRINCIPAL };
    const response = await dispatch.execute(request({ body }));
    expect(response.status).toBe(400);
    expect(response.payload).toMatchObject({ code: 'API_VALUE_INVALID' });
  });

  it('accepts scopeRef={} for the directory and returns the OK page', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(request({}));
    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({ status: 'OK' });
  });

  it('refuses an empty scopeRef for a board read with 400', async () => {
    const dispatch = makeDispatch();
    const response = await dispatch.execute(
      request({ operation: 'project.get_project_board_slice', body: boardBody() }),
    );
    expect(response.status).toBe(400);
    expect(response.payload).toMatchObject({ code: 'API_VALUE_INVALID' });
  });

  it('propagates a linked-identity denial as 403 ACCESS_DENIED', async () => {
    vi.mocked(resolveVerifiedHuman).mockRejectedValue(
      new WorkspaceHumanIdentityError('IDENTITY_WORKSPACE_HUMAN_NOT_LINKED', 'no link'),
    );
    const dispatch = makeDispatch();
    const response = await dispatch.execute(request({}));
    expect(response.status).toBe(403);
    expect(response.payload).toMatchObject({ code: 'ACCESS_DENIED' });
  });
});
