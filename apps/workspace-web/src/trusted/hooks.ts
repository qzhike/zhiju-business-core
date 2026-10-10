// React wiring for the trusted journey: the boot session probe, the live
// guard, and the bound-cursor page chain shared by the directory and the two
// per-project boards.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  failureFromUnknown,
  fetchLegacyUnconfigured,
  fetchSession,
  postActivity,
  readQueryPage,
  type PageFetch,
  type PageQueryArgs,
  type QueryIdentity,
} from './client.js';
import { classifyFailure, type FailureKind } from './errors.js';
import {
  INVALIDATION_CHANNEL,
  INVALIDATION_SIGNAL,
  acceptsResponse,
  bindGuard,
  invalidateGuard,
  isInvalidationSignal,
  scopeGuard,
  type LiveGuard,
  type ResponseTag,
} from './guard.js';
import {
  MAX_AUTO_PAGES,
  MAX_CURSOR_RESTARTS,
  initialPageState,
  pageReducer,
  type PageAction,
  type PageState,
} from './pagination.js';
import type { ParsedPage } from './protocol.js';
import { UNAVAILABLE_PROBE, type SessionProbe } from './session.js';

export interface TrustedSession {
  readonly phase: 'LOADING' | 'READY';
  readonly probe: SessionProbe;
  readonly legacyUnconfigured: boolean;
  readonly reload: () => void;
}

/**
 * Boot read. A failed or malformed probe is never retried into a fabricated
 * session: the shell degrades to UNAVAILABLE and keeps the legacy unconfigured
 * wording when that probe still answers.
 */
export function useTrustedSession(): TrustedSession {
  const [token, setToken] = useState(0);
  const [state, setState] = useState<{
    phase: 'LOADING' | 'READY';
    probe: SessionProbe;
    legacy: boolean;
  }>({ phase: 'LOADING', probe: UNAVAILABLE_PROBE, legacy: false });
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'LOADING', probe: UNAVAILABLE_PROBE, legacy: false });
    void (async () => {
      let probe: SessionProbe;
      try {
        probe = await fetchSession(controller.signal);
      } catch {
        probe = UNAVAILABLE_PROBE;
      }
      let legacy = false;
      if (probe.state === 'UNAVAILABLE') {
        try {
          legacy = await fetchLegacyUnconfigured(controller.signal);
        } catch {
          legacy = false;
        }
      }
      if (controller.signal.aborted) return;
      setState({
        phase: 'READY',
        probe:
          probe.state === 'UNAVAILABLE' && legacy
            ? { state: 'UNAVAILABLE', code: 'UI_SERVICE_NOT_CONFIGURED', session: null }
            : probe,
        legacy,
      });
    })();
    return () => {
      controller.abort();
    };
  }, [token]);
  const reload = useCallback(() => {
    setToken((current) => current + 1);
  }, []);
  return {
    phase: state.phase,
    probe: state.probe,
    legacyUnconfigured: state.legacy,
    reload,
  };
}

export interface GuardControl {
  readonly guard: LiveGuard;
  readonly guardRef: { readonly current: LiveGuard };
  readonly bind: (principalId: string | null, scopes: readonly string[]) => void;
  readonly setScopes: (scopes: readonly string[]) => void;
  readonly invalidate: () => void;
}

/** Live guard in a ref (read by in-flight continuations) plus React state. */
export function useGuardControl(): GuardControl {
  const [guard, setGuard] = useState<LiveGuard>({ generation: 0, principalId: null, scopes: [] });
  const guardRef = useRef(guard);
  const apply = useCallback((next: LiveGuard) => {
    guardRef.current = next;
    setGuard(next);
  }, []);
  return {
    guard,
    guardRef,
    bind: (principalId, scopes) => {
      apply(bindGuard(guardRef.current, { principalId, scopes }));
    },
    setScopes: (scopes) => {
      apply(scopeGuard(guardRef.current, scopes));
    },
    invalidate: () => {
      apply(invalidateGuard(guardRef.current));
    },
  };
}

/**
 * Explicit user activity renews the idle window at most once per minute, and
 * only while a session is live. A background tab never renews anything.
 */
export function useIdleRenewal(csrfToken: string, enabled: boolean): void {
  const lastRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const renew = () => {
      const now = Date.now();
      if (now - lastRef.current < 60_000) return;
      lastRef.current = now;
      void postActivity(csrfToken).catch(() => {
        // A failed renewal never changes local state; the next probe decides.
      });
    };
    window.addEventListener('pointerdown', renew);
    window.addEventListener('keydown', renew);
    return () => {
      window.removeEventListener('pointerdown', renew);
      window.removeEventListener('keydown', renew);
    };
  }, [csrfToken, enabled]);
}

export function publishInvalidation(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(INVALIDATION_CHANNEL);
  channel.postMessage(INVALIDATION_SIGNAL);
  channel.close();
}

/**
 * Another tab may only invalidate this tab: the fixed signal carries no token,
 * CSRF secret or customer content, and anything else is ignored.
 */
export function useTabInvalidation(onInvalidate: () => void): void {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(INVALIDATION_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (isInvalidationSignal(event.data)) onInvalidate();
    };
    return () => {
      channel.close();
    };
  }, [onInvalidate]);
}

export interface PageChainOptions<T> {
  readonly sessionGeneration: string;
  readonly principalId: string;
  readonly operation: string;
  readonly version: string;
  readonly scopeKey: string;
  readonly generation: number;
  readonly csrfToken: string;
  readonly enabled: boolean;
  readonly guardRef: { readonly current: LiveGuard };
  readonly buildBody: PageQueryArgs<T>['buildBody'];
  readonly parsePage: (data: unknown) => ParsedPage<T>;
  readonly keyOf: (item: T) => string;
  readonly onSessionFailure: () => void;
}

export interface PageChain<T> {
  readonly state: PageState<T>;
  readonly failureKind: FailureKind | null;
  readonly failureCode: string | null;
  readonly retryable: boolean;
  readonly reload: () => void;
  readonly loadMore: () => void;
}

export function usePageChain<T>(options: PageChainOptions<T>): PageChain<T> {
  const {
    sessionGeneration,
    principalId,
    operation,
    version,
    scopeKey,
    generation,
    csrfToken,
    enabled,
    buildBody,
    parsePage,
    keyOf,
    onSessionFailure,
  } = options;
  const guardRef = options.guardRef;
  const [state, dispatch] = useReducer(
    (current: PageState<T>, action: PageAction<T>) => pageReducer(current, action, keyOf),
    undefined,
    initialPageState<T>,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const runRef = useRef(0);
  const [failure, setFailure] = useState<{
    kind: FailureKind;
    code: string;
    retryable: boolean;
  } | null>(null);
  const identity: QueryIdentity = useMemo(
    () => ({ sessionGeneration, principalId, operation, version, scopeKey }),
    [sessionGeneration, principalId, operation, version, scopeKey],
  );
  const identityKey = `${operation}@${version}|${scopeKey}`;

  const load = useCallback(
    async (startCursor: string | null, seededRestarts: number) => {
      const run = runRef.current + 1;
      runRef.current = run;
      const controller = new AbortController();
      const accept = (tag: ResponseTag) =>
        run === runRef.current && acceptsResponse(guardRef.current, tag);
      let cursor = startCursor;
      let pages = 0;
      let restarts = seededRestarts;
      try {
        for (;;) {
          dispatch({ type: 'request', cursor });
          let page: PageFetch<T>;
          try {
            page = await readQueryPage<T>({
              identity,
              generation,
              csrfToken,
              cursor,
              signal: controller.signal,
              buildBody,
              parsePage,
            });
          } catch (error) {
            if (run !== runRef.current) return;
            const api = failureFromUnknown(error, 'DEPENDENCY_UNAVAILABLE');
            const kind = classifyFailure(api);
            if (kind === 'SESSION') {
              dispatch({ type: 'failure', code: api.code });
              onSessionFailure();
              return;
            }
            restarts += 1;
            if (kind === 'CURSOR' && restarts <= MAX_CURSOR_RESTARTS) {
              dispatch({ type: 'cursorRejected', code: api.code });
              cursor = null;
              pages = 0;
              continue;
            }
            setFailure({ kind, code: api.code, retryable: api.retryable });
            dispatch({ type: 'failure', code: api.code });
            return;
          }
          if (!accept(page.tag)) return;
          setFailure(null);
          dispatch({
            type: 'page',
            items: page.items,
            nextCursor: page.nextCursor,
            observation: page.observation,
          });
          pages += 1;
          if (page.nextCursor === null || pages >= MAX_AUTO_PAGES) return;
          cursor = page.nextCursor;
        }
      } finally {
        controller.abort();
      }
    },
    [identity, generation, csrfToken, buildBody, parsePage, guardRef, onSessionFailure],
  );

  useEffect(() => {
    runRef.current += 1;
    dispatch({ type: 'reset' });
    setFailure(null);
    if (!enabled) return;
    void load(null, 0);
    return () => {
      runRef.current += 1;
    };
  }, [enabled, identityKey, load]);

  return {
    state,
    failureKind: failure?.kind ?? null,
    failureCode: failure?.code ?? state.errorCode,
    retryable: failure?.retryable ?? false,
    reload: () => {
      runRef.current += 1;
      dispatch({ type: 'reset' });
      setFailure(null);
      void load(null, 0);
    },
    loadMore: () => {
      void load(stateRef.current.cursor, stateRef.current.restarts);
    },
  };
}
