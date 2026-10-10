import { describe, expect, it } from 'vitest';
import {
  INITIAL_GUARD,
  INVALIDATION_SIGNAL,
  acceptsResponse,
  bindGuard,
  invalidateGuard,
  isInvalidationSignal,
  scopeGuard,
  type LiveGuard,
} from './guard.js';

const principal = '11111111-1111-7111-8111-111111111111';
const otherPrincipal = '22222222-2222-7222-8222-222222222222';

function live(guard: LiveGuard = INITIAL_GUARD) {
  return bindGuard(guard, { principalId: principal, scopes: ['self-discovery', 'project:a'] });
}

describe('session generation and late-response guard', () => {
  it('accepts a response tagged with the live generation, principal and scope', () => {
    const guard = live();
    expect(
      acceptsResponse(guard, {
        generation: guard.generation,
        principalId: principal,
        scopeKey: 'self-discovery',
      }),
    ).toBe(true);
  });

  it('drops a late response whose generation is no longer live', () => {
    const first = live();
    const bound = bindGuard(first, { principalId: principal, scopes: ['self-discovery'] });
    expect(
      acceptsResponse(bound, {
        generation: first.generation,
        principalId: principal,
        scopeKey: 'self-discovery',
      }),
    ).toBe(false);
  });

  it('drops a response from a different principal after re-login', () => {
    const guard = live();
    expect(
      acceptsResponse(guard, {
        generation: guard.generation,
        principalId: otherPrincipal,
        scopeKey: 'self-discovery',
      }),
    ).toBe(false);
  });

  it('drops project A data once the live scopes moved to project B', () => {
    const guard = scopeGuard(live(), ['self-discovery', 'project:b']);
    expect(guard.generation).toBe(live().generation);
    expect(
      acceptsResponse(guard, {
        generation: guard.generation,
        principalId: principal,
        scopeKey: 'project:a',
      }),
    ).toBe(false);
    expect(
      acceptsResponse(guard, {
        generation: guard.generation,
        principalId: principal,
        scopeKey: 'project:b',
      }),
    ).toBe(true);
  });

  it('accepts nothing after logout, 401/REAUTH_REQUIRED, bfcache or a cross-tab invalidation', () => {
    const guard = live();
    const invalidated = invalidateGuard(guard);
    expect(invalidated.principalId).toBe(null);
    expect(invalidated.scopes).toEqual([]);
    expect(
      acceptsResponse(invalidated, {
        generation: invalidated.generation,
        principalId: principal,
        scopeKey: 'self-discovery',
      }),
    ).toBe(false);
    expect(
      acceptsResponse(INITIAL_GUARD, { generation: 0, principalId: principal, scopeKey: 'x' }),
    ).toBe(false);
  });

  it('acts only on the fixed invalidation literal, never on a content-bearing message', () => {
    expect(isInvalidationSignal(INVALIDATION_SIGNAL)).toBe(true);
    expect(isInvalidationSignal('invalidate-session-token-abc')).toBe(false);
    expect(isInvalidationSignal({ token: 'secret', csrfToken: 'secret' })).toBe(false);
    expect(isInvalidationSignal(null)).toBe(false);
  });
});
