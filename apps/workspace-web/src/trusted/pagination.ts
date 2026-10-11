// Bound-cursor page accumulator for the authorized directory and the
// per-project boards.
//
// The #258 directory contract allows a *legal* page with `items=[]` **and** a
// bound `nextCursor`: the owning scan budget (200 items / 5s) was reached
// before any match, so "no items on this page" is not completion. Only the same
// valid cursor chain reaching a terminal page (no `nextCursor`) with zero
// accumulated items is a complete EMPTY; an empty final page must never clear
// cards already shown; a page error is ERROR and never EMPTY.
//
// dataState / freshness vocabulary: Module-Spec-UI01 §4.

export type DataState = 'LOADING' | 'READY' | 'EMPTY' | 'ERROR';
export type Freshness = 'FRESH' | 'STALE' | 'PAUSED' | 'REBUILDING' | 'FAILED';

/** Per-request page size. Never larger than the owning directory bound (1..50). */
export const PAGE_SIZE = 50;
/** Pages read per user-initiated run before the view offers an explicit continue. */
export const MAX_AUTO_PAGES = 20;
/** Cursor rejections tolerated per run before the view stops and reports them. */
export const MAX_CURSOR_RESTARTS = 1;

export interface SourceWatermarkView {
  readonly sourceModule: string;
  readonly sequence: number;
  readonly observedAt: string | null;
}

export interface PageObservation {
  readonly resultStatus: string;
  readonly freshness: Freshness;
  readonly snapshotAt: string | null;
  readonly sourceWatermarks: readonly SourceWatermarkView[];
}

export interface PageState<T> {
  readonly dataState: DataState;
  readonly items: readonly T[];
  /** The cursor bound to the next request; `null` means "first page / no cursor". */
  readonly cursor: string | null;
  /** The whole chain completed: the last page omitted `nextCursor`. */
  readonly terminal: boolean;
  /** A bound cursor remains, so the enumeration is known to be incomplete. */
  readonly enumerating: boolean;
  readonly inFlight: boolean;
  readonly errorCode: string | null;
  readonly restarts: number;
  readonly pages: number;
  readonly observation: PageObservation | null;
}

export type PageAction<T> =
  | { readonly type: 'request'; readonly cursor: string | null }
  | {
      readonly type: 'page';
      readonly items: readonly T[];
      readonly nextCursor: string | null;
      readonly observation: PageObservation;
    }
  | { readonly type: 'failure'; readonly code: string }
  | { readonly type: 'cursorRejected'; readonly code: string }
  | { readonly type: 'reset' };

export function initialPageState<T>(): PageState<T> {
  return {
    dataState: 'LOADING',
    items: [],
    cursor: null,
    terminal: false,
    enumerating: false,
    inFlight: false,
    errorCode: null,
    restarts: 0,
    pages: 0,
    observation: null,
  };
}

function mergeItems<T>(current: readonly T[], incoming: readonly T[], keyOf: (item: T) => string) {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(keyOf));
  const merged = [...current];
  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function pageReducer<T>(
  state: PageState<T>,
  action: PageAction<T>,
  keyOf: (item: T) => string,
): PageState<T> {
  switch (action.type) {
    case 'reset':
      return initialPageState<T>();
    case 'request':
      return {
        ...state,
        inFlight: true,
        errorCode: null,
        cursor: action.cursor,
        dataState: state.items.length === 0 ? 'LOADING' : 'READY',
      };
    case 'page': {
      const items = mergeItems(state.items, action.items, keyOf);
      const terminal = action.nextCursor === null;
      const dataState = items.length > 0 ? 'READY' : terminal ? 'EMPTY' : 'LOADING';
      return {
        dataState,
        items,
        cursor: action.nextCursor,
        terminal,
        enumerating: !terminal,
        inFlight: false,
        errorCode: null,
        restarts: state.restarts,
        pages: state.pages + 1,
        observation: action.observation,
      };
    }
    case 'failure':
      // Cards already shown stay visible; the state itself is an honest ERROR.
      return { ...state, dataState: 'ERROR', inFlight: false, errorCode: action.code };
    case 'cursorRejected': {
      const restarts = state.restarts + 1;
      if (restarts > MAX_CURSOR_RESTARTS) {
        return { ...state, dataState: 'ERROR', inFlight: false, errorCode: action.code };
      }
      // The rejected chain is unusable: restart from the first page.
      return { ...initialPageState<T>(), restarts };
    }
  }
}
