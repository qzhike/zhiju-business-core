import { describe, expect, it } from 'vitest';
import type { Common } from '@zhiju/contracts';
import type { ReleaseTransactionContext } from './persistence/release-publication-db.js';
import {
  RELEASE_ACTOR_NOT_HUMAN,
  RELEASE_AUTHORIZATION_DECISION_MISMATCH,
  RELEASE_AUTHORIZATION_EXPIRED,
  RELEASE_AUTHORIZATION_INVALID,
  RELEASE_AUTHORIZATION_PURPOSE_MISMATCH,
  validateHumanAuthorizationChain,
} from './release-publication-authorization.js';
import type {
  ReleaseActorSnapshotFact,
  ReleaseAuthorizationDecisionFact,
  ReleaseAuthorityQueryPorts,
} from './release-publication-validation.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d501';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d502';
const RELEASE = '018f22e2-7c15-7b2e-8d86-2de956a9d503';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d504';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d505';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d506';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d507';

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scope(): Common.ScopeRef {
  return { enterpriseId: ENTERPRISE, projectId: PROJECT };
}

function actorSnapshotRef(): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: ACTOR,
    snapshotId: ACTOR,
    scope: scope(),
    contentHash: hash(0x11),
  };
}

function authorizationDecisionRef(): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'identity.authorization_decision',
    objectId: DECISION,
    scope: scope(),
    contentHash: hash(0x12),
  };
}

function context(overrides: Partial<ReleaseTransactionContext> = {}): ReleaseTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.from(authorizationDecisionRef().contentHash.digest, 'hex'),
    authorizationDecisionExpiresAt: new Date('2026-09-01T00:00:00Z'),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d508',
    ...overrides,
  };
}

function authorityPorts(
  actor: ReleaseActorSnapshotFact,
  decision: ReleaseAuthorizationDecisionFact,
): ReleaseAuthorityQueryPorts {
  return {
    artifact: {
      validateRevisionRef: () => Promise.reject(new Error('not used by this unit')),
      getRepresentation: () => Promise.reject(new Error('not used by this unit')),
    },
    quality: {
      getRevisionAcceptanceSnapshot: () => Promise.reject(new Error('not used by this unit')),
      getApprovalBundleSnapshot: () => Promise.reject(new Error('not used by this unit')),
    },
    identity: {
      getActorSnapshot: () => Promise.resolve(actor),
      getAuthorizationDecision: () => Promise.resolve(decision),
    },
  };
}

function validFacts(): {
  actor: ReleaseActorSnapshotFact;
  decision: ReleaseAuthorizationDecisionFact;
} {
  const actorRef = actorSnapshotRef();
  const decisionRef = authorizationDecisionRef();
  const actor: ReleaseActorSnapshotFact = {
    actorSnapshotRef: actorRef,
    principalRef: { principalKind: 'HUMAN', principalId: PRINCIPAL },
    authenticationContextHash: hash(0x21),
  };
  const decision: ReleaseAuthorizationDecisionFact = {
    authorizationDecisionRef: decisionRef,
    actorSnapshotRef: actorRef,
    principalRef: { principalKind: 'HUMAN', principalId: PRINCIPAL },
    commandType: 'release.authorize_release',
    commandVersion: '1.0',
    scope: scope(),
    purpose: 'release.publication.authorize_release',
    commandPayloadHash: hash(0x22),
    authenticationContextHash: hash(0x21),
    outcome: 'ALLOW',
    expiresAt: '2026-09-01T00:00:00Z',
  };
  return { actor, decision };
}

function input(
  facts: ReturnType<typeof validFacts>,
  overrides: Partial<Parameters<typeof validateHumanAuthorizationChain>[0]> = {},
) {
  const releaseRef: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'release.release',
    objectId: RELEASE,
    scope: scope(),
  };
  return {
    context: context(),
    ports: authorityPorts(facts.actor, facts.decision),
    releaseRef,
    authorizingHumanRef: { principalKind: 'HUMAN' as const, principalId: PRINCIPAL },
    actorSnapshotRef: actorSnapshotRef(),
    authorizationDecisionRef: authorizationDecisionRef(),
    expectedCommandType: 'release.authorize_release',
    expectedCommandVersion: '1.0',
    expectedPurpose: 'release.publication.authorize_release',
    expectedCommandPayloadHash: hash(0x22),
    now: new Date('2026-08-31T00:00:00Z'),
    ...overrides,
  };
}

describe('ReleasePublication WI-07 Human authorization chain', () => {
  it('accepts an exact Human → ActorSnapshot → AuthorizationDecision chain', async () => {
    const facts = validFacts();
    await expect(validateHumanAuthorizationChain(input(facts))).resolves.toMatchObject({
      actorSnapshot: facts.actor,
      authorizationDecision: facts.decision,
    });
  });

  it('rejects an Agent actor and an actingFor Agent before any publication side effect', async () => {
    const facts = validFacts();
    await expect(
      validateHumanAuthorizationChain(
        input(facts, {
          context: context({ principalKind: 'AGENT' }),
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_ACTOR_NOT_HUMAN });

    await expect(
      validateHumanAuthorizationChain(
        input({
          actor: {
            ...facts.actor,
            actingForRef: { principalKind: 'AGENT', principalId: PRINCIPAL },
          },
          decision: facts.decision,
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_ACTOR_NOT_HUMAN });

    await expect(
      validateHumanAuthorizationChain(
        input({
          actor: {
            ...facts.actor,
            principalRef: { principalKind: 'AGENT', principalId: PRINCIPAL },
            actingForRef: { principalKind: 'HUMAN', principalId: PRINCIPAL },
          },
          decision: facts.decision,
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_ACTOR_NOT_HUMAN });
  });

  it('rejects mismatched purpose, decision hash, and expired authorization', async () => {
    const facts = validFacts();
    await expect(
      validateHumanAuthorizationChain(
        input(facts, { expectedPurpose: 'release.publication.recall_release' }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_AUTHORIZATION_PURPOSE_MISMATCH });

    await expect(
      validateHumanAuthorizationChain(
        input(facts, {
          authorizationDecisionRef: {
            ...authorizationDecisionRef(),
            contentHash: hash(0x99),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_AUTHORIZATION_DECISION_MISMATCH });

    await expect(
      validateHumanAuthorizationChain(
        input({
          actor: facts.actor,
          decision: { ...facts.decision, expiresAt: '2026-08-30T00:00:00Z' },
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_AUTHORIZATION_EXPIRED });

    await expect(
      validateHumanAuthorizationChain(
        input(facts, {
          context: context({ allowedProjectIds: [] }),
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_AUTHORIZATION_INVALID });

    await expect(
      validateHumanAuthorizationChain(
        input(facts, {
          context: context({
            kind: 'EVENT_CONSUMER',
            enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d599',
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_ACTOR_NOT_HUMAN });

    await expect(
      validateHumanAuthorizationChain(
        input(facts, {
          context: context({
            authorizationDecisionExpiresAt: new Date('2026-08-30T00:00:00Z'),
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: RELEASE_AUTHORIZATION_EXPIRED });
  });
});
