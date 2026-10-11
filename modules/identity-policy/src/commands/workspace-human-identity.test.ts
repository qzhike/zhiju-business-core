import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { IdentityCommandDeps } from './actor-snapshot.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';
import type { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import {
  AUTHENTICATION_CONTEXT_OBJECT_TYPE,
  IDENTITY_WORKSPACE_HUMAN_NOT_LINKED,
  WorkspaceHumanIdentityError,
  assertSessionBindingHash,
  authenticationContextHash,
  authenticationContextSummary,
  resolveVerifiedHuman,
  type VerifiedOidcContextInput,
} from './workspace-human-identity.js';

// The Port reads the owning repository only through a live transaction. The
// suite replaces the transaction helper with an in-process runner so the
// identity bridge can be driven without a database; every repository read is
// an explicit double and no statement reaches PostgreSQL.
vi.mock('../persistence/identity-db.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../persistence/identity-db.js');
  return {
    ...actual,
    withIdentityTransaction: (_db: unknown, _context: unknown, fn: () => Promise<unknown>) => fn(),
  };
});

const PROVIDER_CODE = 'keycloak';
const ACCOUNT_ID = 'account-1';
const SUBJECT_ID = 'subject-1';
const LINK_ID = '01920000-0000-7000-8000-0000000000a1';
const PRINCIPAL_ID = '01920000-0000-7000-8000-0000000000b1';
const ENTERPRISE_ID = '01920000-0000-7000-8000-0000000000c1';

function cryptoPorts(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash: (normalizedInput: string) => ({
        hash: createHash('sha256').update(normalizedInput, 'utf8').digest(),
        algorithm: 'HMAC-SHA-256',
        keyVersion: 1,
      }),
    },
    fieldEncryption: {
      encryptField: () => {
        throw new Error('field encryption is not used by the identity bridge');
      },
      decryptField: () => {
        throw new Error('field encryption is not used by the identity bridge');
      },
    },
  };
}

function verifiedContext(
  overrides: Partial<VerifiedOidcContextInput> = {},
): VerifiedOidcContextInput {
  return {
    trustConfigHash: 'a'.repeat(64),
    issuerConfigHash: 'issuer-config-hash-1',
    providerCode: PROVIDER_CODE,
    issuer: 'https://identity.example/realms/zhiju',
    accountExternalId: ACCOUNT_ID,
    subjectExternalId: SUBJECT_ID,
    clientId: 'zhiju-bff',
    apiAudience: 'zhiju-core-api',
    azp: 'zhiju-bff',
    tokenSha256: Buffer.alloc(32, 1),
    issuedAt: new Date('2026-10-10T00:00:00.000Z'),
    expiresAt: new Date('2026-10-10T00:05:00.000Z'),
    validatedAt: new Date('2026-10-10T00:00:01.000Z'),
    sessionBindingHash: Buffer.alloc(32, 2),
    ...overrides,
  };
}

interface LinkDouble {
  readonly id: string;
  readonly principalId: string;
  readonly status: 'ACTIVE' | 'REVOKED';
}

interface PrincipalDouble {
  readonly id: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED';
  readonly principal_kind: 'HUMAN' | 'AGENT' | 'SERVICE';
  readonly display_name: string;
}

interface RepoBehaviour {
  readonly link?: LinkDouble | undefined;
  readonly linkThrows?: boolean | undefined;
  readonly principal?: PrincipalDouble | undefined;
}

function depsWith(behaviour: RepoBehaviour): IdentityCommandDeps {
  const repo = {
    findExternalIdentityLinkByLookup: () => {
      if (behaviour.linkThrows === true) return Promise.reject(new Error('storage offline'));
      return Promise.resolve(behaviour.link);
    },
    getPrincipalById: () => Promise.resolve(behaviour.principal),
  } as unknown as IdentityPolicyRepository;
  return {
    db: undefined as never,
    repo,
    crypto: cryptoPorts(),
    context: {
      kind: 'REQUEST',
      principalId: 'bootstrap-verifier',
      actorSnapshotId: '01920000-0000-7000-8000-0000000000d1',
      authorizationDecisionId: '01920000-0000-7000-8000-0000000000d2',
      authorizationDecisionHash: Buffer.alloc(32, 9),
      authorizationDecisionExpiresAt: new Date('2026-10-10T01:00:00.000Z'),
      enterpriseId: ENTERPRISE_ID,
      allowedProjectIds: [],
      correlationId: '01920000-0000-7000-8000-0000000000d3',
    },
  } as unknown as IdentityCommandDeps;
}

const activeHuman: PrincipalDouble = {
  id: PRINCIPAL_ID,
  status: 'ACTIVE',
  principal_kind: 'HUMAN',
  display_name: 'Ada Lovelace',
};

describe('AuthenticationContext canonical summary and hash', () => {
  const crypto = cryptoPorts();

  it('is stable across calls for the same verified context', () => {
    const first = authenticationContextHash(verifiedContext(), crypto);
    const second = authenticationContextHash(verifiedContext(), crypto);
    expect(first.authenticationContextHash.equals(second.authenticationContextHash)).toBe(true);
    expect(first.authenticationContextHash).toHaveLength(32);
    expect(first.summary).toEqual(second.summary);
  });

  it('covers every field of the verified context', () => {
    const base = authenticationContextHash(verifiedContext(), crypto).authenticationContextHash;
    const mutations: readonly Partial<VerifiedOidcContextInput>[] = [
      { trustConfigHash: 'b'.repeat(64) },
      { issuerConfigHash: 'issuer-config-hash-2' },
      { providerCode: 'other-provider' },
      { subjectExternalId: 'subject-2' },
      { clientId: 'other-bff' },
      { apiAudience: 'other-api' },
      { tokenSha256: Buffer.alloc(32, 3) },
      { issuedAt: new Date('2026-10-10T00:00:02.000Z') },
      { expiresAt: new Date('2026-10-10T00:06:00.000Z') },
      { validatedAt: new Date('2026-10-10T00:00:03.000Z') },
      { sessionBindingHash: Buffer.alloc(32, 4) },
      { authTime: new Date('2026-10-10T00:00:00.500Z') },
      { sidHash: Buffer.alloc(32, 5) },
    ];
    for (const mutation of mutations) {
      const mutated = authenticationContextHash(
        verifiedContext(mutation),
        crypto,
      ).authenticationContextHash;
      expect(mutated.equals(base)).toBe(false);
    }
  });

  it('normalizes the subject lookup exactly like link-external-identity', () => {
    const summary = authenticationContextSummary(verifiedContext(), crypto);
    const expected = createHash('sha256')
      .update(`${PROVIDER_CODE}:${SUBJECT_ID}`, 'utf8')
      .digest('hex');
    expect(summary.subjectLookupHash).toBe(expected);
    // Case and surrounding whitespace do not change the keyed lookup input.
    const noisy = authenticationContextSummary(
      verifiedContext({ providerCode: ' KeyCloak ', subjectExternalId: ` ${SUBJECT_ID} ` }),
      crypto,
    );
    expect(noisy.subjectLookupHash).toBe(expected);
  });

  it('never carries the raw token or subject and omits absent optional members', () => {
    const summary = authenticationContextSummary(verifiedContext(), crypto);
    expect(Object.keys(summary)).toEqual([
      'trustConfigHash',
      'issuerConfigHash',
      'subjectLookupHash',
      'clientId',
      'apiAudience',
      'tokenSha256',
      'issuedAt',
      'expiresAt',
      'validatedAt',
      'sessionBindingHash',
    ]);
    expect(summary.tokenSha256).toBe(Buffer.alloc(32, 1).toString('hex'));
    expect(JSON.stringify(summary)).not.toContain(SUBJECT_ID);
    expect(JSON.stringify(summary)).not.toContain(ACCOUNT_ID);
    expect(summary.issuedAt).toBe('2026-10-10T00:00:00.000Z');
  });

  it('includes authTime and sidLookupHash only when the verifier supplied them', () => {
    const present = authenticationContextSummary(
      verifiedContext({
        authTime: new Date('2026-10-10T00:00:00.250Z'),
        sidHash: Buffer.alloc(32, 5),
      }),
      crypto,
    );
    expect(present.authTime).toBe('2026-10-10T00:00:00.250Z');
    expect(present.sidLookupHash).toBe(Buffer.alloc(32, 5).toString('hex'));
  });

  it('rejects a malformed trust config hash and a short session binding', () => {
    expect(() =>
      authenticationContextSummary(verifiedContext({ trustConfigHash: 'not-hex' }), crypto),
    ).toThrow(/trust config hash/u);
    expect(() =>
      authenticationContextSummary(
        verifiedContext({ sessionBindingHash: Buffer.alloc(16, 2) }),
        crypto,
      ),
    ).toThrow(/session binding hash/u);
  });

  it('names the canonical AuthenticationContext object type', () => {
    expect(AUTHENTICATION_CONTEXT_OBJECT_TYPE).toBe('zhiju.identity.authentication_context');
  });
});

describe('assertSessionBindingHash', () => {
  it('accepts exactly 32 bytes and rejects any other length', () => {
    expect(() => {
      assertSessionBindingHash(Buffer.alloc(32, 1));
    }).not.toThrow();
    expect(() => {
      assertSessionBindingHash(Buffer.alloc(31, 1));
    }).toThrow(/32 bytes/u);
    expect(() => {
      assertSessionBindingHash(Buffer.alloc(33, 1));
    }).toThrow(/32 bytes/u);
  });
});

// Every denial path resolves to the single safe code, so a caller can never
// learn which of "missing / revoked / conflicting / non-HUMAN / non-ACTIVE" held.
const denialCases: readonly (readonly [string, RepoBehaviour])[] = [
  ['missing link', { principal: activeHuman }],
  ['revoked link', { link: { id: LINK_ID, principalId: PRINCIPAL_ID, status: 'REVOKED' } }],
  [
    'non-HUMAN principal',
    {
      link: { id: LINK_ID, principalId: PRINCIPAL_ID, status: 'ACTIVE' },
      principal: { ...activeHuman, principal_kind: 'SERVICE' },
    },
  ],
  [
    'suspended principal',
    {
      link: { id: LINK_ID, principalId: PRINCIPAL_ID, status: 'ACTIVE' },
      principal: { ...activeHuman, status: 'SUSPENDED' },
    },
  ],
  [
    'unresolvable principal',
    { link: { id: LINK_ID, principalId: PRINCIPAL_ID, status: 'ACTIVE' } },
  ],
];

describe('resolveVerifiedHuman', () => {
  const crypto = cryptoPorts();

  it('returns the ACTIVE HUMAN principal and the canonical context hash', async () => {
    const deps = depsWith({
      link: { id: LINK_ID, principalId: PRINCIPAL_ID, status: 'ACTIVE' },
      principal: activeHuman,
    });
    const input = verifiedContext();
    const resolution = await resolveVerifiedHuman(deps, input);
    expect(resolution.status).toBe('ACTIVE');
    expect(resolution.principalKind).toBe('HUMAN');
    expect(resolution.displayName).toBe('Ada Lovelace');
    expect(resolution.principalRef).toEqual({
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: PRINCIPAL_ID,
      scope: { enterpriseId: ENTERPRISE_ID },
    });
    expect(resolution.resolvedByLinkRef).toEqual({
      kind: 'OBJECT',
      objectType: 'identity.external_identity_link',
      objectId: LINK_ID,
      scope: { enterpriseId: ENTERPRISE_ID },
    });
    const expectedHash = authenticationContextHash(input, crypto).authenticationContextHash;
    expect(resolution.authenticationContextHash.equals(expectedHash)).toBe(true);
  });

  it.each(denialCases)('uses the single safe code for a %s', async (_label, behaviour) => {
    const deps = depsWith(behaviour);
    let error: WorkspaceHumanIdentityError | undefined;
    try {
      await resolveVerifiedHuman(deps, verifiedContext());
    } catch (caught) {
      error = caught as WorkspaceHumanIdentityError;
    }
    expect(error?.code).toBe(IDENTITY_WORKSPACE_HUMAN_NOT_LINKED);
    // The safe rejection never echoes the external identifier or another ref.
    expect(error?.message).not.toMatch(/subject|account/u);
    expect(error?.message).not.toContain(PRINCIPAL_ID);
    expect(error?.message).not.toContain(LINK_ID);
  });

  it('surfaces a storage failure as DEPENDENCY_UNAVAILABLE, never as "no identity"', async () => {
    const deps = depsWith({ linkThrows: true });
    let failure: WorkspaceHumanIdentityError | undefined;
    try {
      await resolveVerifiedHuman(deps, verifiedContext());
    } catch (caught) {
      failure = caught instanceof WorkspaceHumanIdentityError ? caught : undefined;
    }
    expect(failure?.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(failure?.code).not.toBe(IDENTITY_WORKSPACE_HUMAN_NOT_LINKED);
  });

  it('rejects a short session binding before reading the repository', async () => {
    const deps = depsWith({});
    await expect(
      resolveVerifiedHuman(deps, verifiedContext({ sessionBindingHash: Buffer.alloc(8, 1) })),
    ).rejects.toThrow(/session binding hash/u);
  });
});
