import { afterEach, describe, expect, it } from 'vitest';
import { failureFromUnknown, readQueryPage } from './client.js';
import { classifyFailure, readApiFailure } from './errors.js';
import { isUuidV7, queryRoute, uuidV7 } from './identity.js';
import {
  BffFailure,
  DIRECTORY_OPERATION,
  DIRECTORY_SCOPE_KEY,
  PROJECT_BOARD_OPERATION,
  TASK_BOARD_OPERATION,
  buildDirectoryQueryInput,
  buildProjectBoardQueryInput,
  buildTaskBoardQueryInput,
  parseDirectoryPage,
  parseProjectBoardPage,
  parseTaskBoardPage,
  projectScopeKey,
  readQueryResult,
  type DirectoryCard,
} from './protocol.js';
import {
  UNAVAILABLE_PROBE,
  hasCallbackFailure,
  isLegacyUnconfiguredBootstrap,
  readSessionProbe,
  safeReturnTo,
  signInHref,
  stripCallbackParams,
} from './session.js';

const enterpriseId = '018f2b9c-1111-7000-8000-000000000001';
const projectId = '018f2b9c-2222-7000-8000-000000000002';
const principalId = '018f2b9c-3333-7000-8000-000000000003';

const ids = {
  queryId: uuidV7(),
  correlationId: uuidV7(),
  requestedAt: '2026-10-10T09:00:00.000Z',
  cursor: null,
};

const card = {
  key: `project:${enterpriseId}/${projectId}`,
  enterpriseId,
  projectId,
  enterpriseRef: { kind: 'OBJECT', objectType: 'enterprise', objectId: enterpriseId, scope: {} },
  projectRef: {
    kind: 'OBJECT',
    objectType: 'project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  },
  enterpriseDisplayName: '青禾制造（脱敏）',
  displayCode: 'QH-2026',
  title: '体系文件升级',
  status: 'ACTIVE',
  aggregateVersion: 3,
} satisfies DirectoryCard;

interface Captured {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

let restore: (() => void) | null = null;

function stubFetch(status: number, body: unknown): Captured[] {
  const captured: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  restore = () => {
    globalThis.fetch = original;
  };
  return captured;
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe('identifier and route safety', () => {
  it('generates canonical UUIDv7 identifiers', () => {
    const random = new Uint8Array(10).fill(7);
    const instant = Date.UTC(2026, 9, 10, 9, 0, 0);
    const value = uuidV7(instant, random);
    expect(isUuidV7(value)).toBe(true);
    expect(value[14]).toBe('7');
    expect(Number.parseInt(value.replace(/-/gu, '').slice(0, 12), 16)).toBe(instant);
    expect(uuidV7(instant, random)).toBe(value);
    expect(uuidV7(instant + 1, random)).not.toBe(value);
  });

  it('refuses to build a route for an unknown, encoded or malformed operation', () => {
    expect(queryRoute(DIRECTORY_OPERATION, '1.0')).toBe(`/bff/queries/${DIRECTORY_OPERATION}/1.0`);
    expect(() => queryRoute('project.find_workspace_projects%2F..', '1.0')).toThrow();
    expect(() => queryRoute('Project.Find', '1.0')).toThrow();
    expect(() => queryRoute(DIRECTORY_OPERATION, '1')).toThrow();
  });
});

describe('frozen query projection', () => {
  it('sends exactly the shared Envelope projection keys and no actor surface', () => {
    const body = buildDirectoryQueryInput(ids);
    expect(Object.keys(body).sort()).toEqual(
      [
        'consistencyRequirement',
        'correlationId',
        'integrity',
        'pagination',
        'payload',
        'queryId',
        'requestedAt',
        'scopeRef',
        'type',
        'version',
      ].sort(),
    );
    expect(body.type).toBe(DIRECTORY_OPERATION);
    expect(body.version).toBe('1.0');
    expect(body.scopeRef).toEqual({});
    expect(body.consistencyRequirement).toBe('AUTHORITATIVE');
    expect(body.integrity).toBe(null);
    expect(body.payload).toEqual({ page: { pageSize: 50 } });
    expect(body.pagination).toEqual({ pageSize: 50 });
    for (const forbidden of [
      'actor',
      'actorRef',
      'actingFor',
      'requester',
      'authorizationDecisionRef',
      'authenticationContextRef',
      'roles',
      'policySnapshot',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(body, forbidden)).toBe(false);
    }
  });

  it('binds the cursor into both pagination and the owning payload page', () => {
    const body = buildDirectoryQueryInput({ ...ids, cursor: 'cursor-1' });
    expect(body.pagination).toEqual({ pageSize: 50, cursor: 'cursor-1' });
    expect(body.payload).toEqual({ page: { pageSize: 50, cursor: 'cursor-1' } });
  });

  it('reads each Project board with that exact Project scope and its own filters', () => {
    const projectBoard = buildProjectBoardQueryInput({ ...ids, card });
    expect(projectBoard.type).toBe(PROJECT_BOARD_OPERATION);
    expect(projectBoard.scopeRef).toEqual({ enterpriseId, projectId });
    expect(projectBoard.consistencyRequirement).toBe('PROJECTION_OK');
    expect(projectBoard.payload).toEqual({
      projectRef: card.projectRef,
      statuses: [],
      itemTypes: [],
      page: { pageSize: 50 },
    });

    const taskBoard = buildTaskBoardQueryInput({ ...ids, card });
    expect(taskBoard.type).toBe(TASK_BOARD_OPERATION);
    expect(taskBoard.scopeRef).toEqual({ enterpriseId, projectId });
    const payload = taskBoard.payload as { statuses: readonly string[]; itemTypes?: unknown };
    expect(payload.statuses.length).toBe(11);
    expect(new Set(payload.statuses).size).toBe(11);
    expect(payload.itemTypes).toBe(undefined);
    expect(projectScopeKey(card)).toBe(card.key);
  });
});

describe('result parsing', () => {
  it('maps a valid directory page and keeps the terminal cursor absent', () => {
    const parsed = parseDirectoryPage({
      items: [card],
      snapshotAt: '2026-10-10T09:00:00.000Z',
      sourceWatermarks: [
        { sourceModule: 'enterprise-project', sequence: 7, observedAt: '2026-10-10T08:59:00.000Z' },
        { sourceModule: 'identity-policy', sequence: 3 },
      ],
    });
    expect(parsed.items).toEqual([card]);
    expect(parsed.nextCursor).toBe(null);
    expect(parsed.snapshotAt).toBe('2026-10-10T09:00:00.000Z');
    expect(parsed.sourceWatermarks).toEqual([
      {
        sourceModule: 'enterprise-project',
        sequence: 7,
        observedAt: '2026-10-10T08:59:00.000Z',
      },
      { sourceModule: 'identity-policy', sequence: 3, observedAt: null },
    ]);
  });

  it('rejects a card whose ProjectRef identity disagrees with its scope', () => {
    const mismatched = {
      ...card,
      projectRef: { ...card.projectRef, objectId: enterpriseId },
    };
    expect(() => parseDirectoryPage({ items: [mismatched] })).toThrow(BffFailure);
    expect(() => parseDirectoryPage({ items: [{ ...card, title: '' }] })).toThrow(BffFailure);
    expect(() => parseDirectoryPage({ items: [], nextCursor: '' })).toThrow(BffFailure);
  });

  it('parses board rows with their own status, version and blocker counts', () => {
    const delivery = parseProjectBoardPage({
      items: [
        {
          deliveryItemId: projectId,
          itemKey: 'D-01',
          title: '质量手册',
          commitmentStatus: 'APPROVED',
          executionStatus: 'IN_PROGRESS',
          blockerRefs: [{ kind: 'OBJECT' }],
        },
      ],
      nextCursor: 'board-cursor-1',
    });
    expect(delivery.items[0]).toEqual({
      key: projectId,
      title: '质量手册',
      status: 'IN_PROGRESS',
      version: null,
      secondary: 'APPROVED',
      blockers: 1,
    });
    expect(delivery.nextCursor).toBe('board-cursor-1');

    const tasks = parseTaskBoardPage({
      items: [
        {
          taskRef: card.projectRef,
          aggregateVersion: 4,
          title: '首轮范围核对',
          status: 'BLOCKED',
          blockerRefs: [],
        },
      ],
    });
    expect(tasks.items[0]).toEqual({
      key: projectId,
      title: '首轮范围核对',
      status: 'BLOCKED',
      version: 4,
      secondary: null,
      blockers: 0,
    });
    expect(tasks.nextCursor).toBe(null);
  });

  it('treats an ERROR envelope as an error and a STALE envelope as stale data', () => {
    expect(() => readQueryResult(200, { status: 'ERROR' })).toThrow(BffFailure);
    try {
      readQueryResult(200, { status: 'ERROR' });
    } catch (error) {
      expect((error as BffFailure).api.code).toBe('UI_PROJECTION_STALE');
    }
    expect(readQueryResult(200, { status: 'OK', data: { items: [] } }).freshness).toBe('FRESH');
    expect(
      readQueryResult(200, { status: 'STALE', stalenessStatus: 'REBUILDING', data: null }),
    ).toEqual({ resultStatus: 'STALE', freshness: 'REBUILDING', data: null });
    expect(() => readQueryResult(200, { status: 'PARTIAL' })).toThrow(BffFailure);
    expect(() => readQueryResult(200, 'not-json')).toThrow(BffFailure);
    expect(() => readQueryResult(503, { code: 'DEPENDENCY_UNAVAILABLE' })).toThrow(BffFailure);
  });
});

describe('failure classification', () => {
  it('maps closed codes and statuses to the fail-closed UI vocabulary', () => {
    expect(classifyFailure(readApiFailure(401, { code: 'AUTHENTICATION_REQUIRED' }))).toBe(
      'SESSION',
    );
    expect(classifyFailure(readApiFailure(403, { code: 'ACCESS_DENIED' }))).toBe('DENIED');
    expect(classifyFailure(readApiFailure(404, {}))).toBe('NOT_FOUND');
    expect(classifyFailure(readApiFailure(503, { code: 'DEPENDENCY_UNAVAILABLE' }))).toBe(
      'UNAVAILABLE',
    );
    expect(classifyFailure(readApiFailure(200, { code: 'QUERY_CURSOR_EXPIRED' }))).toBe('CURSOR');
    expect(readApiFailure(503, { code: 'DEPENDENCY_UNAVAILABLE', correlationId: 'x' })).toEqual({
      httpStatus: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
      correlationId: 'x',
    });
    expect(
      classifyFailure(failureFromUnknown(new Error('offline'), 'DEPENDENCY_UNAVAILABLE')),
    ).toBe('UNAVAILABLE');
  });
});

describe('session probe and safe entry', () => {
  it('accepts only a complete HUMAN session and otherwise fails closed', () => {
    const allowed = readSessionProbe(200, {
      accessState: 'ALLOWED',
      businessActionsEnabled: true,
      sessionGeneration: 'gen-1',
      csrfToken: 'csrf-1',
      expiresAt: '2026-10-10T17:00:00.000Z',
      idleExpiresAt: '2026-10-10T10:30:00.000Z',
      principal: { principalId, principalKind: 'HUMAN', displayName: '顾问' },
    });
    expect(allowed.state).toBe('ALLOWED');
    expect(allowed.session?.csrfToken).toBe('csrf-1');
    expect(allowed.session?.principal.displayName).toBe('顾问');

    expect(
      readSessionProbe(200, {
        accessState: 'ALLOWED',
        sessionGeneration: 'gen-1',
        csrfToken: 'csrf-1',
        principal: { principalId, principalKind: 'AGENT' },
      }).state,
    ).toBe('UNAVAILABLE');
    expect(readSessionProbe(200, { accessState: 'REAUTH_REQUIRED' })).toEqual({
      state: 'REAUTH_REQUIRED',
      code: 'UI_REAUTH_REQUIRED',
      session: null,
    });
    expect(readSessionProbe(200, { accessState: 'SESSION_EXPIRED' }).state).toBe('SESSION_EXPIRED');
    expect(readSessionProbe(403, { code: 'ACCESS_DENIED' }).state).toBe('DENIED');
    expect(readSessionProbe(200, '<html>')).toEqual(UNAVAILABLE_PROBE);
  });

  it('keeps the legacy unconfigured probe exact', () => {
    expect(
      isLegacyUnconfiguredBootstrap({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: false,
      }),
    ).toBe(true);
    expect(
      isLegacyUnconfiguredBootstrap({
        accessState: 'REAUTH_REQUIRED',
        businessActionsEnabled: true,
      }),
    ).toBe(false);
    expect(isLegacyUnconfiguredBootstrap(null)).toBe(false);
  });

  it('only returns approved same-origin return routes', () => {
    expect(safeReturnTo('/workbench')).toBe('/workbench');
    expect(safeReturnTo('/projects/DEMO-1/analysis/REPORT-1')).toBe(
      '/projects/DEMO-1/analysis/REPORT-1',
    );
    expect(safeReturnTo('https://evil.invalid/')).toBe('/workbench');
    expect(safeReturnTo('//evil.invalid')).toBe('/workbench');
    expect(safeReturnTo('/\\evil.invalid')).toBe('/workbench');
    expect(safeReturnTo('/projects/../../etc/passwd')).toBe('/workbench');
    expect(safeReturnTo('/projects/A/analysis/B#x')).toBe('/workbench');
    expect(safeReturnTo(`/${'a'.repeat(240)}`)).toBe('/workbench');
    expect(signInHref('/workbench')).toBe('/bff/auth/login?returnTo=%2Fworkbench');
    expect(signInHref('https://evil.invalid')).toBe('/bff/auth/login?returnTo=%2Fworkbench');
  });

  it('never surfaces a callback error value and strips callback parameters', () => {
    expect(hasCallbackFailure('?error=access_denied&error_description=secret-customer-text')).toBe(
      true,
    );
    expect(hasCallbackFailure('?tab=files')).toBe(false);
    expect(
      stripCallbackParams('?tab=files&error=access_denied&code=abc&iss=https%3A%2F%2Fidp'),
    ).toBe('tab=files');
    expect(stripCallbackParams('?error=access_denied')).toBe('');
  });
});

describe('BFF query request', () => {
  it('posts the projection with CSRF and no identity override header', async () => {
    const captured = stubFetch(200, {
      status: 'OK',
      data: { items: [card], snapshotAt: '2026-10-10T09:00:00.000Z', sourceWatermarks: [] },
    });
    const page = await readQueryPage({
      identity: {
        sessionGeneration: 'gen-1',
        principalId,
        operation: DIRECTORY_OPERATION,
        version: '1.0',
        scopeKey: DIRECTORY_SCOPE_KEY,
      },
      generation: 4,
      csrfToken: 'csrf-1',
      cursor: null,
      buildBody: (built) => buildDirectoryQueryInput(built),
      parsePage: parseDirectoryPage,
    });
    expect(captured.length).toBe(1);
    const request = captured.at(0);
    if (request === undefined) throw new Error('the query request was not captured');
    expect(request.url).toBe(`/bff/queries/${DIRECTORY_OPERATION}/1.0`);
    expect(request.method).toBe('POST');
    expect(Array.from(request.headers.keys()).sort()).toEqual([
      'accept',
      'content-type',
      'x-csrf-token',
    ]);
    expect(request.headers.get('x-csrf-token')).toBe('csrf-1');
    expect(page.tag).toEqual({ generation: 4, principalId, scopeKey: DIRECTORY_SCOPE_KEY });
    expect(page.items).toEqual([card]);
    expect(page.nextCursor).toBe(null);
    expect(page.observation.resultStatus).toBe('OK');
  });

  it('binds the returned cursor to the next request', async () => {
    const captured = stubFetch(200, {
      status: 'OK',
      data: { items: [], nextCursor: 'cursor-1', snapshotAt: null, sourceWatermarks: [] },
    });
    await readQueryPage({
      identity: {
        sessionGeneration: 'gen-1',
        principalId,
        operation: DIRECTORY_OPERATION,
        version: '1.0',
        scopeKey: DIRECTORY_SCOPE_KEY,
      },
      generation: 4,
      csrfToken: 'csrf-1',
      cursor: 'cursor-0',
      buildBody: (built) => buildDirectoryQueryInput(built),
      parsePage: parseDirectoryPage,
    });
    const request = captured.at(0);
    if (request === undefined) throw new Error('the query request was not captured');
    const body = request.body as { pagination: unknown; payload: unknown };
    expect(body.pagination).toEqual({ pageSize: 50, cursor: 'cursor-0' });
    expect(body.payload).toEqual({ page: { pageSize: 50, cursor: 'cursor-0' } });
  });

  it('propagates an expired session as a session failure, not an empty page', async () => {
    stubFetch(401, { code: 'UI_SESSION_EXPIRED', retryable: true, correlationId: 'c-1' });
    await expect(
      readQueryPage({
        identity: {
          sessionGeneration: 'gen-1',
          principalId,
          operation: DIRECTORY_OPERATION,
          version: '1.0',
          scopeKey: DIRECTORY_SCOPE_KEY,
        },
        generation: 4,
        csrfToken: 'csrf-1',
        cursor: null,
        buildBody: (built) => buildDirectoryQueryInput(built),
        parsePage: parseDirectoryPage,
      }),
    ).rejects.toBeInstanceOf(BffFailure);
  });
});
