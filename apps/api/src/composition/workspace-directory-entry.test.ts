// IM-UI-01 (#266/#258): deterministic unit tests of the workspace directory
// entry. The owning IdentityPolicy and EnterpriseProject modules are replaced
// with explicit test doubles at the module boundary, so the suite exercises the
// real entry, the real decision boundary and the real Contract Registry without
// a database or an identity provider.
//
// Covered: the empty self-discovery scope (accepted) versus a non-empty scope
// (refused), the DENY candidate skipped without an EP read, the empty
// intermediate page versus the terminal page, the candidate budget and the
// budget-cut chain that must not drop an accumulated match, cursor
// tamper/expiry/scope-mismatch/watermark-drift error mapping, the
// fail-the-whole-page revalidation rule, the full-chain re-observation of every
// served EnterpriseProject summary (including a summary served on an earlier page
// that changed after the next continuation already passed) and the declared
// cursor capacity that fails a chain closed instead of dropping a carried
// observation.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Common } from '@zhiju/contracts';

const mockState = vi.hoisted(() => ({
  authorizeCandidate: (targetRef: Common.ObjectRef): Promise<unknown> =>
    Promise.resolve(allowOutcome(targetRef.objectId)),
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
      authorizeCandidate: (
        _deps: IdentityCommandDeps,
        input: WorkspaceProjectDiscoveryAuthorizationInput,
      ) => {
        mockState.calls.authorizeCandidate += 1;
        return mockState.authorizeCandidate(input.targetRef);
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
  type IdentityCommandDeps,
  type VerifiedHumanResolution,
  type WorkspaceProjectDiscoveryAuthorizationInput,
  type WorkspaceProjectDiscoveryScanInput,
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
const PRJ_C = '018f22e2-7c15-7b2e-8d86-2de956a9d408';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d402';
const QUERY_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d401';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d404';
const AUTH_REF = '018f22e2-7c15-7b2e-8d86-2de956a9d403';

function candidateRef(projectId: string, objectType = 'zhiju.project.project'): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
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
  getAuthorizationDecisionByIdAndHash: (_trx: unknown, decisionId: string): Promise<unknown> =>
    Promise.resolve({ hashMatched: true, row: decisionRow(decisionId) }),
};

/**
 * The Decision the double mints for one candidate. Its store resolves a
 * Decision id back to the Project that Decision was issued for, so the id here
 * carries the Project: the boundary re-reads the row under the candidate's exact
 * scope and must not see another Project's row.
 */
function decisionReference(projectId: string): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'identity.authorization_decision',
    objectId: projectId,
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
  readonly objectType?: string | undefined;
}) {
  const sequence = input.sequence ?? 4;
  return {
    items: input.projectIds.map((projectId) => ({
      projectRef: candidateRef(projectId, input.objectType),
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

/** A distinct Project id per index, for the long-chain cursor capacity fixture. */
function projectIdAt(index: number): string {
  return `018f22e2-7c15-7b2e-8d86-${index.toString(16).padStart(12, '0')}`;
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

/** The project ids of a page's cards, narrowed at runtime (never a blind cast). */
function projectIdsOf(result: unknown): string[] {
  const items = pageOf(result).items;
  if (!Array.isArray(items)) throw new Error('the page items are not an array');
  return items.map((item) => {
    if (item === null || typeof item !== 'object' || !('projectRef' in item)) {
      throw new Error('a page item carries no projectRef');
    }
    const projectRef: unknown = item.projectRef;
    if (projectRef === null || typeof projectRef !== 'object' || !('objectId' in projectRef)) {
      throw new Error('a page item projectRef carries no objectId');
    }
    const objectId: unknown = projectRef.objectId;
    if (typeof objectId !== 'string') throw new Error('a page item project id is not a string');
    return objectId;
  });
}

/** The project id the entry asked the IP scan to continue after, if any. */
function scanAfterProjectOf(input: WorkspaceProjectDiscoveryScanInput): string | undefined {
  if (input.cursor === undefined) return undefined;
  const parsed: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || !('after' in parsed)) {
    throw new Error('the IP scan cursor carries no continuation key');
  }
  const after: unknown = parsed.after;
  if (after === null || typeof after !== 'object' || !('projectId' in after)) {
    throw new Error('the IP scan cursor continuation key is malformed');
  }
  const projectId: unknown = after.projectId;
  if (typeof projectId !== 'string') throw new Error('the IP scan cursor carries no project id');
  return projectId;
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

async function rejectionOf(promise: Promise<unknown>): Promise<CompositionBoundaryError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof CompositionBoundaryError)) {
    throw new Error('expected the entry to reject with a CompositionBoundaryError');
  }
  return error;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
  message?: string,
): Promise<void> {
  const error = await rejectionOf(promise);
  expect(error.code).toBe(code);
  if (message !== undefined) expect(error.message).toContain(message);
}

beforeEach(() => {
  mockState.calls.authorizeCandidate = 0;
  mockState.calls.revalidateCandidate = 0;
  mockState.authorizeCandidate = (targetRef) => Promise.resolve(allowOutcome(targetRef.objectId));
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

  it('stops at the candidate budget with items=[] + nextCursor when nothing matched yet', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockResolvedValue(
      scanPage({ projectIds: [PRJ, PRJ_B], nextCursor: 'scan-cursor-1' }),
    );
    mockState.authorizeCandidate = () =>
      Promise.resolve({ outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] });
    const entry = makeEntry({ maxCandidates: 1 });
    const result = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 25 } }),
      session(),
    );
    expect(result.status).toBe('OK');
    expect(pageOf(result).items).toHaveLength(0);
    expect(typeof result.nextCursor).toBe('string');
  });

  it('follows a budget-cut chain to completion without dropping a matched card', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({ projectIds: [PRJ, PRJ_B], nextCursor: 'scan-cursor-1' })
          : scanPage({ projectIds: [PRJ_B] }),
      ),
    );
    mockState.authorizeCandidate = (targetRef) =>
      Promise.resolve(
        targetRef.objectId === PRJ
          ? allowOutcome(PRJ)
          : { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] },
      );
    const entry = makeEntry({ maxCandidates: 1 });

    const delivered: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const result = await entry.findWorkspaceProjects(
        envelope({ page: { pageSize: 25, ...(cursor === undefined ? {} : { cursor }) } }),
        session(),
      );
      pages += 1;
      delivered.push(...projectIdsOf(result));
      const next = result.nextCursor;
      if (typeof next !== 'string') break;
      cursor = next;
      if (pages > 5) throw new Error('the cursor chain did not terminate');
    }

    // Project A matched and is authorized while B is denied: the cut after A must
    // still deliver A on page one, and the chain must terminate with exactly A.
    expect(delivered).toEqual([PRJ]);
    expect(pages).toBe(2);
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

  it('completes an unchanged multi-page chain with stable watermarks and bounded cursors', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) => {
      const after = scanAfterProjectOf(input);
      if (after === undefined) {
        return Promise.resolve(scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }));
      }
      if (after === PRJ) {
        return Promise.resolve(scanPage({ projectIds: [PRJ_B], nextCursor: 'scan-cursor-2' }));
      }
      return Promise.resolve(scanPage({ projectIds: [PRJ_C] }));
    });
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 25 } }),
      session(),
    );
    const firstCursor = cursorOf(first);
    const second = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 1, cursor: firstCursor } }),
      session(),
    );
    const secondCursor = cursorOf(second);
    const third = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 1, cursor: secondCursor } }),
      session(),
    );

    expect(projectIdsOf(first)).toEqual([PRJ]);
    expect(projectIdsOf(second)).toEqual([PRJ_B]);
    expect(projectIdsOf(third)).toEqual([PRJ_C]);
    expect(third.nextCursor).toBeUndefined();
    // Every cursor of the chain carries its served set inside the declared
    // 16..8192 bound, and the Page cursor is the envelope cursor.
    expect(firstCursor).toMatch(/^[A-Za-z0-9_-]{16,8192}$/u);
    expect(secondCursor).toMatch(/^[A-Za-z0-9_-]{16,8192}$/u);
    expect(pageOf(second).nextCursor).toBe(secondCursor);
    expect(pageOf(third).nextCursor).toBeUndefined();
    // The emitted cursor carries two served observations: 167 fixed payload bytes
    // (format/operation/version tags, four 32-byte digests, the two-byte count),
    // 2 * 42 entry bytes, three 8-byte numbers and the 32-byte MAC -> 307 bytes
    // -> 410 base64url characters, well inside the declared 16..8192 bound.
    expect(secondCursor).toHaveLength(410);
    // The chain keeps the first page's snapshot instant and watermarks.
    expect(pageOf(second).snapshotAt).toBe(pageOf(first).snapshotAt);
    expect(pageOf(third).snapshotAt).toBe(pageOf(first).snapshotAt);
    expect(pageOf(second).sourceWatermarks).toEqual(pageOf(first).sourceWatermarks);
    expect(pageOf(third).sourceWatermarks).toEqual(pageOf(first).sourceWatermarks);
  });

  it('rejects a cursor when a summary the chain first page served changed', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' })
          : scanPage({ projectIds: [PRJ_B] }),
      ),
    );
    let firstProjectVersion = 3;
    vi.mocked(readWorkspaceProjectSummary).mockImplementation((_db, _context, request) =>
      Promise.resolve({
        ...summary(request.projectId, `Project ${request.projectId}`),
        aggregateVersion: request.projectId === PRJ ? firstProjectVersion : 3,
      }),
    );
    const entry = makeEntry();
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    expect(projectIdsOf(first)).toEqual([PRJ]);
    const cursor = cursorOf(first);

    // The reviewer's probe: page one served A at aggregateVersion 3, A changes
    // to 4, and the same cursor must restart instead of serving the next page.
    firstProjectVersion = 4;
    await expectCode(
      entry.findWorkspaceProjects(envelope({ page: { pageSize: 1, cursor } }), session()),
      'QUERY_CURSOR_INVALID',
      'a summary the directory chain served changed',
    );
  });

  it('rejects a later continuation when a summary an earlier page served changed', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) => {
      const after = scanAfterProjectOf(input);
      if (after === undefined) {
        return Promise.resolve(scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' }));
      }
      if (after === PRJ) {
        return Promise.resolve(scanPage({ projectIds: [PRJ_B], nextCursor: 'scan-cursor-2' }));
      }
      if (after === PRJ_B) {
        return Promise.resolve(scanPage({ projectIds: [PRJ_C], nextCursor: 'scan-cursor-3' }));
      }
      return Promise.resolve(scanPage({ projectIds: [PRJ_C] }));
    });
    let middleProjectVersion = 3;
    vi.mocked(readWorkspaceProjectSummary).mockImplementation((_db, _context, request) =>
      Promise.resolve({
        ...summary(request.projectId, `Project ${request.projectId}`),
        aggregateVersion: request.projectId === PRJ_B ? middleProjectVersion : 3,
      }),
    );
    const entry = makeEntry();

    // Three pages are served with the middle page's summary unchanged, so the
    // continuation that immediately follows it (the third page) still passes.
    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    const second = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 1, cursor: cursorOf(first) } }),
      session(),
    );
    const third = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 1, cursor: cursorOf(second) } }),
      session(),
    );
    expect(projectIdsOf(third)).toEqual([PRJ_C]);
    const thirdCursor = cursorOf(third);

    // R5: the summary page two served changes *after* that continuation passed.
    // A scheme that re-observes only the first page and the previous page cannot
    // see it any more; the full carried served set must still fail the chain.
    middleProjectVersion = 4;
    await expectCode(
      entry.findWorkspaceProjects(
        envelope({ page: { pageSize: 1, cursor: thirdCursor } }),
        session(),
      ),
      'QUERY_CURSOR_INVALID',
      'a summary the directory chain served changed',
    );
  });

  it('rejects a continuation whose carried served project vanished', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' })
          : scanPage({ projectIds: [PRJ_B] }),
      ),
    );
    let vanished = false;
    vi.mocked(readWorkspaceProjectSummary).mockImplementation((_db, _context, request) =>
      Promise.resolve(
        vanished && request.projectId === PRJ
          ? undefined
          : summary(request.projectId, `Project ${request.projectId}`),
      ),
    );
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    expect(projectIdsOf(first)).toEqual([PRJ]);
    const cursor = cursorOf(first);

    // The Project row page one served is gone, so the card it produced can no
    // longer be reproduced by any current read.
    vanished = true;
    await expectCode(
      entry.findWorkspaceProjects(envelope({ page: { pageSize: 1, cursor } }), session()),
      'QUERY_CURSOR_INVALID',
      'a summary the directory chain served changed',
    );
  });

  it('rejects a continuation whose carried served project lost its Decision', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' })
          : scanPage({ projectIds: [PRJ_B] }),
      ),
    );
    let revoked = false;
    mockState.authorizeCandidate = (targetRef) =>
      Promise.resolve(
        revoked && targetRef.objectId === PRJ
          ? { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] }
          : allowOutcome(targetRef.objectId),
      );
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    expect(projectIdsOf(first)).toEqual([PRJ]);
    const cursor = cursorOf(first);

    // The grant page one served the card under is gone: the continuation cannot
    // re-mint the Decision the card was served with.
    revoked = true;
    await expectCode(
      entry.findWorkspaceProjects(envelope({ page: { pageSize: 1, cursor } }), session()),
      'QUERY_CURSOR_INVALID',
      'a summary the directory chain served is no longer authorized',
    );
  });

  it('re-reads a carried card under the exact Project spelling it was served with', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({
              projectIds: [PRJ],
              nextCursor: 'scan-cursor-1',
              objectType: 'project.project',
            })
          : scanPage({ projectIds: [PRJ_B], objectType: 'project.project' }),
      ),
    );
    // This chain's Grants are registered under the legacy Project spelling, so a
    // continuation that re-minted its carried Decisions over another accepted
    // spelling would be denied and would fail a legitimate chain.
    mockState.authorizeCandidate = (targetRef) =>
      Promise.resolve(
        targetRef.objectType === 'project.project'
          ? allowOutcome(targetRef.objectId)
          : { outcome: 'DENY', reasons: ['NO_COVERING_GRANT'] },
      );
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(envelope({ page: { pageSize: 1 } }), session());
    expect(projectIdsOf(first)).toEqual([PRJ]);
    const second = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 1, cursor: cursorOf(first) } }),
      session(),
    );
    expect(projectIdsOf(second)).toEqual([PRJ_B]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('continues a chain whose page served nothing from an empty carried set', async () => {
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation((_deps, _config, input) =>
      Promise.resolve(
        scanAfterProjectOf(input) === undefined
          ? scanPage({ projectIds: [PRJ], nextCursor: 'scan-cursor-1' })
          : scanPage({ projectIds: [PRJ_B] }),
      ),
    );
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(
      envelope({ searchText: 'no-such-title', page: { pageSize: 1 } }),
      session(),
    );
    expect(pageOf(first).items).toHaveLength(0);
    const second = await entry.findWorkspaceProjects(
      envelope({ searchText: 'no-such-title', page: { pageSize: 1, cursor: cursorOf(first) } }),
      session(),
    );
    expect(pageOf(second).items).toHaveLength(0);
    expect(second.nextCursor).toBeUndefined();
  });

  it('fails a chain closed when the carried served set outgrows the declared cursor capacity', async () => {
    let scan = 0;
    vi.mocked(discoverWorkspaceProjectScopes).mockImplementation(() => {
      const offset = scan * 50;
      scan += 1;
      return Promise.resolve(
        scanPage({
          projectIds: Array.from({ length: 50 }, (_unused, index) => projectIdAt(offset + index)),
          nextCursor: `scan-cursor-${scan}`,
        }),
      );
    });
    const entry = makeEntry();

    const first = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 50 } }),
      session(),
    );
    expect(projectIdsOf(first)).toHaveLength(50);
    const second = await entry.findWorkspaceProjects(
      envelope({ page: { pageSize: 50, cursor: cursorOf(first) } }),
      session(),
    );
    expect(projectIdsOf(second)).toHaveLength(50);
    const secondCursor = cursorOf(second);
    expect(secondCursor).toMatch(/^[A-Za-z0-9_-]{16,8192}$/u);
    // 100 carried observations still fit: 167 fixed payload bytes + 100 * 42
    // entry bytes + three 8-byte numbers + the 32-byte MAC -> 4423 bytes -> 5898
    // base64url characters.
    expect(secondCursor).toHaveLength(5898);

    // The third page would carry 150 served observations, which no longer fit
    // the declared 8192-character bound: the page fails closed and the client
    // restarts at page one instead of receiving a cursor that dropped a card.
    await expectCode(
      entry.findWorkspaceProjects(
        envelope({ page: { pageSize: 50, cursor: secondCursor } }),
        session(),
      ),
      'QUERY_CURSOR_INVALID',
      'exceeded the declared cursor capacity',
    );
  });
});
