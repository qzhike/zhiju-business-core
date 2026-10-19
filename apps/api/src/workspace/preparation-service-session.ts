import { randomBytes } from 'node:crypto';
import {
  PreparationError,
  preparationHash,
  samePreparationValue,
  type PreparationSession,
} from '@zhiju/contracts';

/** Internal Environment B sessions; current policy is checked separately on every operation. */
export function createPreparationServiceSessions(
  principalId: string,
  clock: () => Date = () => new Date(),
) {
  const issued = new Map<string, PreparationSession>();
  let latest: PreparationSession | undefined;
  function prune() {
    for (const [key, session] of issued)
      if (Date.parse(session.expiresAt) <= clock().getTime()) issued.delete(key);
  }
  return {
    current(): PreparationSession {
      prune();
      const now = clock();
      if (!latest || Date.parse(latest.expiresAt) - now.getTime() <= 60000) {
        latest = {
          principalId,
          authenticationContextHash: preparationHash({
            principalId,
            issuedAt: now.toISOString(),
            nonce: randomBytes(32).toString('base64url'),
            purpose: 'preparation.internal.service',
          }),
          expiresAt: new Date(now.getTime() + 300000).toISOString(),
        };
        issued.set(latest.authenticationContextHash.digest, structuredClone(latest));
      }
      return structuredClone(latest);
    },
    verify(session: PreparationSession): void {
      prune();
      const original = issued.get(session.authenticationContextHash.digest);
      if (!original || !samePreparationValue(original, session))
        throw new PreparationError('AUTHORIZATION_DENIED');
    },
  };
}
