import { describe, expect, it } from 'vitest';
import {
  MAX_CURSOR_RESTARTS,
  PAGE_SIZE,
  initialPageState,
  pageReducer,
  type PageAction,
  type PageObservation,
  type PageState,
} from './pagination.js';

interface Card {
  readonly id: string;
}

const keyOf = (card: Card) => card.id;

const observation = (resultStatus = 'OK', freshness: PageObservation['freshness'] = 'FRESH') =>
  ({
    resultStatus,
    freshness,
    snapshotAt: '2026-10-10T00:00:00.000Z',
    sourceWatermarks: [],
  }) satisfies PageObservation;

function run(actions: readonly PageAction<Card>[]): PageState<Card> {
  return actions.reduce<PageState<Card>>(
    (state, action) => pageReducer(state, action, keyOf),
    initialPageState<Card>(),
  );
}

const request = (cursor: string | null): PageAction<Card> => ({ type: 'request', cursor });
const page = (ids: readonly string[], nextCursor: string | null): PageAction<Card> => ({
  type: 'page',
  items: ids.map((id) => ({ id })),
  nextCursor,
  observation: observation(),
});

describe('bound-cursor page accumulator', () => {
  it('starts LOADING with no accumulated items and a 50-item request budget', () => {
    const state = initialPageState<Card>();
    expect(state.dataState).toBe('LOADING');
    expect(state.items).toEqual([]);
    expect(state.terminal).toBe(false);
    expect(state.enumerating).toBe(false);
    expect(state.cursor).toBe(null);
    expect(PAGE_SIZE).toBe(50);
  });

  it('keeps LOADING for a legal empty intermediate page that still has a cursor', () => {
    const state = run([request(null), page([], 'cursor-1')]);
    expect(state.dataState).toBe('LOADING');
    expect(state.items).toEqual([]);
    expect(state.enumerating).toBe(true);
    expect(state.terminal).toBe(false);
    expect(state.cursor).toBe('cursor-1');
    expect(state.errorCode).toBe(null);
  });

  it('keeps READY with the incomplete hint once cards exist and a cursor remains', () => {
    const state = run([request(null), page(['a', 'b'], 'cursor-2')]);
    expect(state.dataState).toBe('READY');
    expect(state.items.map(keyOf)).toEqual(['a', 'b']);
    expect(state.enumerating).toBe(true);
    expect(state.cursor).toBe('cursor-2');
  });

  it('yields EMPTY only for a completed chain with zero accumulated items', () => {
    const state = run([request(null), page([], null)]);
    expect(state.dataState).toBe('EMPTY');
    expect(state.terminal).toBe(true);
    expect(state.enumerating).toBe(false);
  });

  it('does not clear earlier cards when the terminal page is empty', () => {
    const state = run([request(null), page(['a', 'b'], 'cursor-1'), page([], null)]);
    expect(state.dataState).toBe('READY');
    expect(state.items.map(keyOf)).toEqual(['a', 'b']);
    expect(state.terminal).toBe(true);
    expect(state.enumerating).toBe(false);
    expect(state.pages).toBe(2);
  });

  it('keeps enumerating after an empty middle page until cards arrive', () => {
    const state = run([
      request(null),
      page([], 'cursor-1'),
      page([], 'cursor-2'),
      page(['a'], null),
    ]);
    expect(state.dataState).toBe('READY');
    expect(state.items.map(keyOf)).toEqual(['a']);
    expect(state.terminal).toBe(true);
  });

  it('reports ERROR (never EMPTY) on a page failure and keeps shown cards', () => {
    const state = run([
      request(null),
      page(['a'], 'cursor-1'),
      { type: 'failure', code: 'DEPENDENCY_UNAVAILABLE' },
    ]);
    expect(state.dataState).toBe('ERROR');
    expect(state.errorCode).toBe('DEPENDENCY_UNAVAILABLE');
    expect(state.items.map(keyOf)).toEqual(['a']);
    expect(state.inFlight).toBe(false);
  });

  it('restarts from the first page after a cursor rejection and stops after the retry', () => {
    const restarted = run([
      request(null),
      page(['a', 'b'], 'cursor-1'),
      { type: 'cursorRejected', code: 'QUERY_CURSOR_INVALID' },
    ]);
    expect(restarted.dataState).toBe('LOADING');
    expect(restarted.items).toEqual([]);
    expect(restarted.cursor).toBe(null);
    expect(restarted.restarts).toBe(1);
    expect(restarted.errorCode).toBe(null);

    const restartedAgain = pageReducer(
      restarted,
      { type: 'cursorRejected', code: 'QUERY_CURSOR_SCOPE_MISMATCH' },
      keyOf,
    );
    expect(MAX_CURSOR_RESTARTS).toBe(1);
    expect(restartedAgain.dataState).toBe('ERROR');
    expect(restartedAgain.errorCode).toBe('QUERY_CURSOR_SCOPE_MISMATCH');
  });

  it('keeps READY while a continuation is in flight and never duplicates an item', () => {
    const inFlight = run([request(null), page(['a'], 'cursor-1'), request('cursor-1')]);
    expect(inFlight.dataState).toBe('READY');
    expect(inFlight.inFlight).toBe(true);

    const deduped = pageReducer(inFlight, page(['a', 'b'], null), keyOf);
    expect(deduped.items.map(keyOf)).toEqual(['a', 'b']);
    expect(deduped.dataState).toBe('READY');
  });

  it('carries the owning freshness instead of relabelling stale data as current', () => {
    const state = run([
      request(null),
      {
        type: 'page',
        items: [{ id: 'a' }],
        nextCursor: null,
        observation: observation('STALE', 'REBUILDING'),
      },
    ]);
    expect(state.observation?.freshness).toBe('REBUILDING');
    expect(state.dataState).toBe('READY');
  });

  it('clears all accumulated view state on reset (logout or scope change)', () => {
    const state = run([request(null), page(['a'], 'cursor-1'), { type: 'reset' }]);
    expect(state).toEqual(initialPageState<Card>());
  });
});
