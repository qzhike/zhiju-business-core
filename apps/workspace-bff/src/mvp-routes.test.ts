import { describe, expect, it } from 'vitest';

import { matchMvpRoute } from './routes.js';

const PROJECT = '0199a000-0000-7000-8000-000000000001';
const BATCH = '0199a000-0000-7000-8000-000000000002';
const SOURCE = '0199a000-0000-7000-8000-000000000003';
const REQUEST = '0199a000-0000-7000-8000-000000000004';

describe('MVP BFF route allowlist', () => {
  it('maps only the finite MVP surface to Core', () => {
    expect(matchMvpRoute('/bff/mvp/v1/session', 'GET')).toEqual({
      kind: 'read',
      corePath: '/api/mvp/v1/session',
      query: [],
    });
    expect(matchMvpRoute('/bff/mvp/v1/projects', 'GET')).toEqual({
      kind: 'read',
      corePath: '/api/mvp/v1/projects',
      query: ['limit', 'cursor'],
    });
    expect(matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}`, 'PUT')).toEqual({
      kind: 'write',
      corePath: `/api/mvp/v1/projects/${PROJECT}`,
      query: [],
    });
    expect(matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}/batches/${BATCH}`, 'PUT')).toEqual({
      kind: 'write',
      corePath: `/api/mvp/v1/projects/${PROJECT}/batches/${BATCH}`,
      query: [],
    });
    expect(
      matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}/batches/${BATCH}/recovery`, 'POST'),
    ).toMatchObject({ kind: 'write' });
    expect(
      matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}/batches/${BATCH}/zip`, 'PUT'),
    ).toMatchObject({ kind: 'upload' });
    expect(
      matchMvpRoute(
        `/bff/mvp/v1/projects/${PROJECT}/batches/${BATCH}/sources/${SOURCE}/content`,
        'GET',
      ),
    ).toMatchObject({ kind: 'download' });
    expect(matchMvpRoute(`/bff/mvp/v1/requests/${REQUEST}`, 'GET')).toMatchObject({
      kind: 'read',
    });
  });

  it('rejects unknown, encoded, trailing-slash and wrong-method paths', () => {
    expect(matchMvpRoute('/bff/mvp/v1', 'GET')).toBeUndefined();
    expect(matchMvpRoute('/bff/mvp/v1/unknown', 'GET')).toBeUndefined();
    expect(matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}/`, 'GET')).toBeUndefined();
    expect(matchMvpRoute('/bff/mvp/v1/projects/not-a-uuid', 'GET')).toBeUndefined();
    expect(matchMvpRoute('/bff/mvp/v1/projects/%31', 'GET')).toBeUndefined();
    expect(matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}`, 'DELETE')).toBe('METHOD');
    expect(matchMvpRoute(`/bff/mvp/v1/projects/${PROJECT}/batches/${BATCH}/zip`, 'POST')).toBe(
      'METHOD',
    );
    expect(matchMvpRoute('/bff/mvp/v2/projects', 'GET')).toBeUndefined();
  });
});
