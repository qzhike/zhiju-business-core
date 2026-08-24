import { describe, expect, it } from 'vitest';
import { ContractRegistry } from '@zhiju/contracts';
import { externalIdentityLinkedPayload, principalRegisteredPayload } from './events.js';

// IP-API-C-001 contract slice: the public event payloads follow
// Module-Spec-001 §5 exactly and never embed raw external identifiers.

describe('identity public event payloads', () => {
  const scope = { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' };

  it('PrincipalRegistered carries the principal ref, kind and status', () => {
    const payload = principalRegisteredPayload({
      principalId: '11111111-1111-7111-8111-1111111111a1',
      principalKind: 'HUMAN',
      status: 'ACTIVE',
      scope,
    });
    expect(payload).toEqual({
      principalRef: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: '11111111-1111-7111-8111-1111111111a1',
        scope,
      },
      principalKind: 'HUMAN',
      status: 'ACTIVE',
    });
  });

  it('ExternalIdentityLinked exposes only a content-addressed lookup reference', () => {
    const accountHash = Buffer.alloc(32, 0xab);
    const subjectHash = Buffer.alloc(32, 0xcd);
    const payload = externalIdentityLinkedPayload({
      linkId: '22222222-2222-7222-8222-2222222222b2',
      principalId: '11111111-1111-7111-8111-1111111111a1',
      providerCode: 'feishu',
      accountLookupHash: accountHash,
      accountLookupHashAlgorithm: 'HMAC-SHA-256',
      accountLookupKeyVersion: 1,
      subjectLookupHash: subjectHash,
      subjectLookupHashAlgorithm: 'HMAC-SHA-256',
      subjectLookupKeyVersion: 1,
      scope,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'externalIdentityLinkRef',
      'externalIdentityLookupHashRef',
      'principalRef',
      'providerCode',
    ]);
    expect(payload.externalIdentityLinkRef).toMatchObject({
      kind: 'OBJECT',
      objectType: 'identity.external_identity_link',
      scope,
    });
    expect(payload.principalRef).toMatchObject({
      kind: 'OBJECT',
      objectType: 'identity.principal',
      scope,
    });
    expect(payload.externalIdentityLookupHashRef).toMatchObject({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.external_identity_lookup',
      scope,
      contentHash: {
        algorithm: 'SHA-256',
        canonicalizationVersion: '1',
      },
    });
    expect(payload.externalIdentityLookupHashRef.contentHash.digest).toMatch(/^[0-9a-f]{64}$/);
    // No raw identifier field exists on the payload shape at all.
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      'open_id',
      'email',
      'phone',
      'accountExternalId',
      'subjectExternalId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const registry = new ContractRegistry();
    expect(
      registry.validateOperation('identity.ExternalIdentityLinked', '1.0', {
        eventId: '33333333-3333-7333-8333-3333333333c3',
        eventType: 'identity.ExternalIdentityLinked',
        eventVersion: '1.0',
        producerModule: 'identity-policy',
        aggregateType: 'identity.external_identity_link',
        aggregateId: '22222222-2222-7222-8222-2222222222b2',
        aggregateVersion: 1,
        scopeRef: scope,
        correlationId: '44444444-4444-7444-8444-4444444444d4',
        causationId: '55555555-5555-7555-8555-5555555555e5',
        commandId: '66666666-6666-7666-8666-6666666666f6',
        actorRef: {
          kind: 'OBJECT',
          objectType: 'identity.principal',
          objectId: '11111111-1111-7111-8111-1111111111a1',
          scope,
        },
        occurredAt: '2026-08-24T00:00:00Z',
        dataClassification: 'RESTRICTED_PERSONAL',
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: {
            algorithm: 'SHA-256',
            digest: '0'.repeat(64),
            canonicalizationVersion: '1',
          },
        },
      }),
    ).toEqual({ valid: true, errors: [] });
  });
});
