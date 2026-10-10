// Ordered logout transition for the trusted shell.
//
// Session Delta §6 and Module-Spec-UI01 §258 point 7 require that logout (like
// 401 / lost authority / a user or scope change) *first* advances the client
// generation, cancels the old requests and clears the protected view, and only
// then handles the asynchronous continuation. The BFF performs best-effort IdP
// revocation inside the awaited logout call, so that call can be arbitrarily
// late and must never gate the local cleanup: otherwise protected cards stay on
// screen and an older directory page can still repopulate them.
//
// This module is the pure, testable half of that rule. The React shell supplies
// callbacks that mutate the guard ref, the read boundary and the view state; a
// response issued before the invalidation is already rejected by the retired
// generation, whether it lands before or after `requestLogout` settles.

export interface LogoutDependencies {
  /** Advances the generation and drops the live principal/scopes, synchronously. */
  readonly retireIdentity: () => void;
  /** Cancels every protected read still in flight, synchronously. */
  readonly cancelReads: () => void;
  /** Clears the selected project and the protected view state, synchronously. */
  readonly clearView: () => void;
  /** Broadcasts the content-free cross-tab invalidation signal. */
  readonly notifyPeers: () => void;
  /** The awaited BFF logout; IdP revocation may make this arbitrarily slow. */
  readonly requestLogout: () => Promise<number>;
  /** Re-probes the session once the logout call settles (success or failure). */
  readonly reprobe: () => void;
}

/**
 * Runs the logout transition in the required order. Every local step happens
 * before the first `await`, so a slow or failed logout can never leave live
 * identity or protected cards behind, and a late response can never re-bind
 * them.
 */
export function runLogout(dependencies: LogoutDependencies): Promise<void> {
  dependencies.retireIdentity();
  dependencies.cancelReads();
  dependencies.clearView();
  dependencies.notifyPeers();
  return dependencies
    .requestLogout()
    .catch(() => 0)
    .then(() => {
      dependencies.reprobe();
    });
}
