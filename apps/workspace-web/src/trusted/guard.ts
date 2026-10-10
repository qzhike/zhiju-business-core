// Session-generation / scope isolation for every protected read.
//
// Requirement (Module-Spec-UI01 §258 point 4): every query key carries
// sessionGeneration + principal + exact scope/version, in-flight requests are
// aborted on scope or user change, late responses are dropped by a generation
// check, and a cross-tab signal may only invalidate — never carry a token or
// customer content.
//
// `LiveGuard` is the pure half of that rule: a monotonically increasing
// generation, the live principal, and the set of scopes that may still write
// into view state. A response tagged with anything else is dropped.

export interface LiveGuard {
  readonly generation: number;
  readonly principalId: string | null;
  readonly scopes: readonly string[];
}

export interface ResponseTag {
  readonly generation: number;
  readonly principalId: string;
  readonly scopeKey: string;
}

/** The only value a cross-tab invalidation channel may carry. */
export const INVALIDATION_SIGNAL = 'invalidate';
export const INVALIDATION_CHANNEL = 'zhiju-workspace-invalidation';

export const INITIAL_GUARD: LiveGuard = { generation: 0, principalId: null, scopes: [] };

/**
 * Binds a new live identity (session resolved, project selected, or scope left)
 * and advances the generation, which invalidates every response already in
 * flight under the previous binding.
 */
export function bindGuard(
  guard: LiveGuard,
  next: { readonly principalId: string | null; readonly scopes: readonly string[] },
): LiveGuard {
  return { generation: guard.generation + 1, principalId: next.principalId, scopes: next.scopes };
}

/**
 * Drops the live identity on logout, 401/REAUTH_REQUIRED, bfcache restore and a
 * cross-tab invalidation signal. Nothing writes view state until a new session
 * is bound.
 */
export function invalidateGuard(guard: LiveGuard): LiveGuard {
  return { generation: guard.generation + 1, principalId: null, scopes: [] };
}

/**
 * Changes which scopes may still write view state (project selection) without
 * invalidating a longer-running chain (the directory keeps its own
 * `self-discovery` scope key). Responses tagged with a scope that is no longer
 * live are dropped, so project A can never fill project B's view state.
 */
export function scopeGuard(guard: LiveGuard, scopes: readonly string[]): LiveGuard {
  return { generation: guard.generation, principalId: guard.principalId, scopes };
}

export function acceptsResponse(guard: LiveGuard, tag: ResponseTag): boolean {
  return (
    guard.principalId !== null &&
    guard.generation === tag.generation &&
    guard.principalId === tag.principalId &&
    guard.scopes.includes(tag.scopeKey)
  );
}

/** A cross-tab message is acted on only when it is exactly the fixed signal. */
export function isInvalidationSignal(data: unknown): boolean {
  return data === INVALIDATION_SIGNAL;
}
