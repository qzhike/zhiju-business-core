import { describe, expect, it } from 'vitest';
import {
  INITIAL_GUARD,
  acceptsResponse,
  bindGuard,
  createReadBoundary,
  invalidateGuard,
  type LiveGuard,
  type ResponseTag,
} from './guard.js';
import { runLogout } from './logout.js';
import {
  initialPageState,
  pageReducer,
  type PageAction,
  type PageObservation,
} from './pagination.js';

interface Card {
  readonly id: string;
}

const keyOf = (card: Card) => card.id;

const principalId = '018f2b9c-3333-7000-8000-000000000003';
const scopeKey = 'self-discovery';

const observation: PageObservation = {
  resultStatus: 'OK',
  freshness: 'FRESH',
  snapshotAt: '2026-10-10T00:00:00.000Z',
  sourceWatermarks: [],
};

/** The tag a response captured under this exact binding would carry. */
function tagOf(guard: LiveGuard, key: string): ResponseTag {
  return { generation: guard.generation, principalId: guard.principalId ?? '', scopeKey: key };
}

describe('logout boundary', () => {
  it('rejects a response captured before the invalidation and accepts one after a fresh bind', () => {
    const bound = bindGuard(INITIAL_GUARD, { principalId, scopes: [scopeKey] });
    const captured = tagOf(bound, scopeKey);
    expect(acceptsResponse(bound, captured)).toBe(true);

    const retired = invalidateGuard(bound);
    expect(retired.principalId).toBe(null);
    expect(acceptsResponse(retired, captured)).toBe(false);

    const rebound = bindGuard(retired, { principalId, scopes: [scopeKey] });
    expect(rebound.generation).toBe(retired.generation + 1);
    expect(acceptsResponse(rebound, tagOf(rebound, scopeKey))).toBe(true);
    expect(acceptsResponse(rebound, captured)).toBe(false);
  });

  it('invalidates identity, view state and in-flight reads before the logout call settles', async () => {
    const deferredLogout = Promise.withResolvers<number>();
    const readBoundary = createReadBoundary();
    const inFlight = new AbortController();
    const releaseInFlight = readBoundary.track(inFlight);
    const captured = tagOf(bindGuard(INITIAL_GUARD, { principalId, scopes: [scopeKey] }), scopeKey);
    let guard = bindGuard(INITIAL_GUARD, { principalId, scopes: [scopeKey] });
    let directory = pageReducer(
      initialPageState<Card>(),
      { type: 'page', items: [{ id: 'card-a' }], nextCursor: 'cursor-1', observation },
      keyOf,
    );
    let selectedKey: string | null = 'project:a';
    const order: string[] = [];

    const settled = runLogout({
      retireIdentity: () => {
        order.push('retire');
        guard = invalidateGuard(guard);
      },
      cancelReads: () => {
        order.push('cancel');
        readBoundary.abort();
      },
      clearView: () => {
        order.push('clear');
        selectedKey = null;
        directory = pageReducer(directory, { type: 'reset' }, keyOf);
      },
      notifyPeers: () => {
        order.push('peers');
      },
      requestLogout: () => {
        order.push('request');
        return deferredLogout.promise;
      },
      reprobe: () => {
        order.push('reprobe');
      },
    });

    // The logout call is still pending, yet every local invalidation already ran.
    expect(order).toEqual(['retire', 'cancel', 'clear', 'peers', 'request']);
    expect(selectedKey).toBe(null);
    expect(directory).toEqual(initialPageState<Card>());
    expect(inFlight.signal.aborted).toBe(true);
    expect(acceptsResponse(guard, captured)).toBe(false);
    releaseInFlight();

    deferredLogout.resolve(204);
    await settled;
    expect(order).toEqual(['retire', 'cancel', 'clear', 'peers', 'request', 'reprobe']);
  });

  it('re-probes the session even when the awaited logout fails', async () => {
    const deferredLogout = Promise.withResolvers<number>();
    let reprobes = 0;
    const settled = runLogout({
      retireIdentity: () => undefined,
      cancelReads: () => undefined,
      clearView: () => undefined,
      notifyPeers: () => undefined,
      requestLogout: () => deferredLogout.promise,
      reprobe: () => {
        reprobes += 1;
      },
    });

    expect(reprobes).toBe(0);
    deferredLogout.reject(new Error('logout transport failed'));
    await settled;

    expect(reprobes).toBe(1);
  });

  it('drops a directory page issued before logout so it cannot repopulate cards', () => {
    const bound = bindGuard(INITIAL_GUARD, { principalId, scopes: [scopeKey] });
    // The page read left the tab while the session was still live.
    const lateTag = tagOf(bound, scopeKey);
    const latePage: PageAction<Card> = {
      type: 'page',
      items: [{ id: 'card-late' }],
      nextCursor: null,
      observation,
    };
    const cleared = pageReducer(initialPageState<Card>(), { type: 'reset' }, keyOf);

    // `usePageChain`'s accept gate drops the page before the reducer sees it.
    const shown = acceptsResponse(invalidateGuard(bound), lateTag)
      ? pageReducer(cleared, latePage, keyOf)
      : cleared;

    expect(shown.items).toEqual([]);
    expect(shown.dataState).toBe('LOADING');
  });

  it('still accepts a page read after the guard is bound to the next session', () => {
    const bound = bindGuard(INITIAL_GUARD, { principalId, scopes: [scopeKey] });
    const rebound = bindGuard(invalidateGuard(bound), { principalId, scopes: [scopeKey] });
    const freshPage: PageAction<Card> = {
      type: 'page',
      items: [{ id: 'card-new' }],
      nextCursor: null,
      observation,
    };
    const initial = initialPageState<Card>();

    const shown = acceptsResponse(rebound, tagOf(rebound, scopeKey))
      ? pageReducer(initial, freshPage, keyOf)
      : initial;

    expect(shown.items.map((card) => card.id)).toEqual(['card-new']);
    expect(shown.dataState).toBe('READY');
  });
});
