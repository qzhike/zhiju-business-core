// IM-UI-01 (#266/#258): deterministic unit tests of the workspace directory
// entry. The owning IdentityPolicy and EnterpriseProject modules are replaced
// with explicit test doubles at the module boundary, so the suite exercises the
// real entry, the real decision boundary and the real Contract Registry without
// a database or an identity provider.
//
// Covered: the empty self-discovery scope (accepted) versus a non-empty scope
// (refused), the DENY candidate skipped without an EP read, the empty
// intermediate page versus the terminal page, the candidate budget, cursor
// tamper/expiry/scope-mismatch/watermark-drift error mapping and the
// fail-the-whole-page revalidation rule.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Common } from '@zhiju/contracts';

const mockState = vi.hoisted(() => ({
  authorizeCandidate: (): Promise<unknown> => Promise.resolve({ outcome: 'ALLOW' }),
  revalidateCandidate: (): Promise<unknown> => Promise.resolve({ valid: true }),
  calls: { authorizeCandidate: 0, revalidateCandidate: 0 },
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
      authorizeCandidate: () => {
        mockState.calls.authorizeCandidate += 1;
        return mockState.authorizeCandidate();
      },
      revalidateCandidate: () => {
        mockState.calls.revalidateCandidate += 1;
        return mockState.revalidateCandidate();
      },
    })),
  };
});

vi.mock('@zhiju/enterprise-project', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, readWorkspaceProjectSummary: vi.fn() };
});

import {
  createActorSnapshot,
  discoverWorkspaceProjectScopes,
  resolveVerifiedHuman,
  type VerifiedHumanResolution,
} from '@zhiju/identity-policy';
import { readWorkspaceProjectSummary } from '@zhiju/enterprise-project';
import {
  WORKSPACE_DIRECTORY_QUERY,
  WORKSPACE_DIRECTORY_QUERY_VERSION,
  createWorkspaceDirectoryEntry,
  type WorkspaceDirectorySession,
} from './workspace-directory-entry.js';
import { CompositionBoundaryError } from './decision-boundary.js';

const ENT = '018f22e2-7c15-7b2e-8d86-2de956a9d405';
const PRJ = '018f22e2-7c15-7b2e-8d86-2de956a9d406';
const PRJ_B = '018f22e2-7c15-7b2e-8d86-2de956a9d407';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d402';
const QUERY_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d401';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d404';
const AUTH_REF = '018f22e2-7c15-7b2e-8d86-2de956a9d403';

function candidateRef(projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: projectId,
    scope: { enterpriseId: ENT, projectId },
  };
}

function watermark(sequence: number): Common.SourceWatermark {
  return {
    sourceModule: 'identity_policy',
    partition: `workspace_project_discovery:${PRINCIPAL}`,
    sequence,
    observedAt: '2026-10-10T00:00:00.000Z',
  };
}

function session(bindingByte = 2): WorkspaceDirectorySession {
  return { context: {} as never, sessionBinding: Buffer.alloc(32, bindingByte) };
}

function envelope(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    queryId: QUERY_ID,
    queryType: WORKSPACE_DIRECTORY_QUERY,
    queryVersion: WORKSPACE_DIRECTORY_QUERY_VERSION,
    scopeRef: {},
    requester: { kind: 'OBJECT', objectType: 'identity.principal', objectId: PRINCIPAL, scope: {} },
    authenticationContextRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.identity.authentication_context',
      objectId: AUTH_REF,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: 'a'.repeat(64),
        canonicalizationVersion: '1',
      },
    },
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: CORRELATION,
    requestedAt: '2026-10-10T00:00:00Z',
    payload,
  };
}

function decisionRow(projectId: string) {
  return {
    authorization_decision_id: '018f22e2-7c15-7b2e-8d86-2de956a9d500',
    actor_snapshot_id: '018f22e2-7c15-7b2e-8d86-2de956a9d501',
    actor_snapshot_payload_hash: Buffer.alloc(32, 1),
    principal_id: PRINCIPAL,
    principal_kind: 'HUMAN',
    outcome: 'ALLOW' as const,
    command_type: 'project.workspace.discover',
    scope_kind: 'PROJECT' as const,
    enterprise_id: ENT,
    project_id: projectId,
    purpose: 'project.workspace.discover',
    policy_snapshot_id: '018f22e2-7c15-7b2e-8d86-2de956a9d502',
    policy_snapshot_payload_hash: Buffer.alloc(32, 2),
    authentication_context_hash: Buffer.alloc(32, 7),
    expires_at: new Date('2026-10-10T00:05:00.000Z'),
    payload_hash: Buffer.alloc(32, 3),
  };
}

const repoDouble = {
  getAuthorizationDecisionByIdAndHash: (): Promise<unknown> =>
    Promise.resolve({ hashMatched: true, row: decisionRow(PRJ) }),
};

function decisionReference(projectId: string): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'identity.authorization_decision',
    objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d600',
    scope: { enterpriseId: ENT, projectId },
    contentHash: { algorithm: 'SHA-256', digest: 'b'.repeat(64), canonicalizationVersion: '1' },
  };
}

function allowOutcome(projectId: string): unknown {
  return {
    outcome: 'ALLOW',
    reasons: ['ALLOWED_BY_GRANT'],
    authorizationDecisionRef: decisionReference(projectId),
    expiresAt: '2026-10-10T00:05:00.000Z',
  };
}

function scanPage(input: {
  readonly projectIds: readonly string[];
  readonly nextCursor?: string | undefined;
  readonly sequence?: number;
}) {
  const sequence = input.sequence ?? 4;
  return {
    items: input.projectIds.map((projectId) => ({
      projectRef: candidateRef(projectId),
      sourceWatermark: watermark(sequence),
    })),
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    authorizationFingerprint: 'a'.repeat(64),
    sourceWatermarks: [watermark(sequence)],
  };
}

function summary(projectId: string, title: string) {
  return {
    enterpriseId: ENT,
    projectId,
    enterpriseDisplayName: 'Example Enterprise',
    displayCode: 'ENT-0001',
    title,
    status: 'ACTIVE' as const,
    aggregateVersion: 3,
  };
}

/** Runtime narrowing of a result's `data` object (never a blind cast). */
function pageOf(result: unknown): Record<string, unknown> {
  if (result === null || typeof result !== 'object' || !('data' in result)) {
    throw new Error('result has no data');
  }
  const data: unknown = result.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('result data is not a page object');
  }
  return data as Record<string, unknown>;
}

/** Typed read of a bound cursor out of a result envelope (never blind String()). */
function cursorOf(result: Record<string, unknown>): string {
  const value = result.nextCursor;
  if (typeof value !== 'string') throw new Error('expected a bound cursor');
  return value;
}

function makeEntry(overrides: { readonly now?: () => Date; readonly maxCandidates?: number } = {}) {
  return createWorkspaceDirectoryEntry({
    identity: { db: {} as never, repo: repoDouble as never, crypto: {} as never },
    enterpriseProjectDb: {} as never,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: 'workspace.project.discovery.v1',
      projectBoardSliceReadHumanV1: 'project.board.slice.read.v1',
    },
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    ...(overrides.maxCandidates === undefined
      ? {}
      : { budgets: { maxCandidates: overrides.maxCandidates } }),
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CompositionBoundaryError);
  expect((error as CompositionBoundaryError).code).toBe(code);
}

beforeEach(() => {
  mockState.calls.authorizeCandidate = 0;
  mockState.calls.revalidateCandidate = 0;
  mockState.authorizeCandidate = () => Promise.resolve(allowOutcome(PRJ));
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
    contentHash: {
      algorithm: 'SHA-256',
      digest: 'd'.repeat(64),
      canonicalizationVersion: '1',
    },
  });
  vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(scanPage({ projectIds: [PRJ] }));
  vi.mocked(readWorkspaceProjectSummary).mockImplementation((_db, _context, request) =>
    Promise.resolve(summary(request.projectId, `Project ${request.projectId}`)),
  );
});

describe('createWorkspaceDirectoryEntry', () => {
  it('accepts scopeRef={} and returns an OK page with the authorized summary', async () => {
    const entry = makeEntry();
    const result = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 25 } }),
      session(),
    );
    expect(result.status).toBe('OK');
    expect(result.stalenessStatus).toBe('FRESH');
    const page = pageOf(result);
    const items = page.items as readonly Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.projectRef).toMatchObject({
      objectType: 'zhiju.project.project',
      objectId: PRJ,
    });
    expect(items[0]?.enterpriseRef).toMatchObject({ objectType: 'zhiju.project.enterprise' });
    expect(page.nextCursor).toBeUndefined();
    expect(result.resultHash).toBeDefined();
  });

  it('refuses a non-empty scopeRef with SCOPE_MISMATCH', async () => {
    const entry = makeEntry();
    const input = envelope({ page: { pageSize: 25 } });
    input.scopeRef = { enterpriseId: ENT, projectId: PRJ };
    await expectCode(entry.findWorkspaceProjects(input, session()), 'SCOPE_MISMATCH');
  });

  it('skips a DENY candidate without any EP read', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ, PRJ_B] }),
    );
    let call = 0;
    mockState.authorizeCandidate = () => {
      call += 1;
      return Promise.resolve(
        call === 1 ? allowOutcome(PRJ) : { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] },
      );
    };
    const entry = makeEntry();
    const result = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 25 } }),
      session(),
    );
    expect(pageOf(result).items as unknown[]).toHaveLength(1);
    // The DENY candidate is never read; the single ALLOWed candidate is read
    // once for the page and once at the before-return observation checkpoint.
    const readProjects = vi
      .mocked(readWorkspaceProjectSummary)
      .mock.calls.map((call) => call[2].projectId);
    expect(readProjects).toHaveLength(2);
    expect(new Set(readProjects)).toEqual(new Set([PRJ]));
  });

  it('returns an empty intermediate page with a bound nextCursor when the filter empties it', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }),
    );
    const entry = makeEntry();
    const result = await entry.findWorkspaceProjects(
      envelope({ searchText: 'no-such-title', page: { pageSize: 25 } }),
      session(),
    );
    expect(result.status).toBe('OK');
    const page = pageOf(result);
    expect(page.items).toHaveLength(0);
    expect(typeof result.nextCursor).toBe('string');
    expect(page.nextCursor).toBe(result.nextCursor);
  });

  it('returns a terminal empty page without a cursor when the scan is exhausted', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(scanPage({ projectIds: [PRJ] }));
    const entry = makeEntry();
    const result = await entry.findWorkspaceProjects(
      envelope({ searchText: 'no-such-title', page: { pageSize: 25 } }),
      session(),
    );
    expect(pageOf(result).items).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it('stops at the candidate budget with items=[] + nextCursor', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ, PRJ_B], nextCursor: 'scan-cursor-1' }),
    );
    const entry = makeEntry({ maxCandidates: 1 });
    const result = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 25 } }),
      session(),
    );
    expect(pageOf(result).items).toHaveLength(0);
    expect(typeof result.nextCursor).toBe('string');
  });

  it('fails the whole page when a used Decision no longer revalidates', async () => {
    mockState.revalidateCandidate = () =>
      Promise.resolve({ valid: false, reason: 'GRANT_NOT_CURRENT' });
    const entry = makeEntry();
    await expectCode(
      entry.findWorkspaceProjects(envelope({ page: { pageSize: 25 } }), session()),
      'AUTHORIZATION_REVOKED',
    );
    expect(mockState.calls.revalidateCandidate).toBe(1);
  });

  it('rejects a tampered cursor with QUERY_CURSOR_INVALID', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }),
    );
    const entry = makeEntry();
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    const cursor = cursorOf(first);
    const tampered = `${cursor.slice(0, 10)}${cursor[10] === 'A' ? 'B' : 'A'}${cursor.slice(11)}`;
    await expectCode(
      entry.findWorkspaceProjects(envelope({ page: { pageSize: 1, cursor: tampered } }), session()),
      'QUERY_CURSOR_INVALID',
    );
  });

  it('rejects an expired cursor with QUERY_CURSOR_EXPIRED', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }),
    );
    let current = new Date('2026-10-10T00:00:00.000Z');
    const entry = makeEntry({ now: () => current });
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    current = new Date('2026-10-10T00:06:00.000Z');
    await expectCode(
      entry.findWorkspaceProjects(
        envelope({ page: { pageSize: 1, cursor: cursorOf(first) } }),
        session(),
      ),
      'QUERY_CURSOR_EXPIRED',
    );
  });

  it('rejects a cursor whose filter changed with QUERY_CURSOR_SCOPE_MISMATCH', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }),
    );
    const entry = makeEntry();
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    await expectCode(
      entry.findWorkspaceProjects(
        envelope({
          searchText: 'changed',
          page: { pageSize: 1, cursor: cursorOf(first) },
        }),
        session(),
      ),
      'QUERY_CURSOR_SCOPE_MISMATCH',
    );
  });

  it('rejects a cursor whose IP source watermark advanced with QUERY_CURSOR_INVALID', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1', sequence: 4 }),
    );
    const entry = makeEntry();
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-2', sequence: 5 }),
    );
    await expectCode(
      entry.findWorkspaceProjects(
        envelope({ page: { pageSize: 1, cursor: cursorOf(first) } }),
        session(),
      ),
      'QUERY_CURSOR_INVALID',
    );
  });
});
