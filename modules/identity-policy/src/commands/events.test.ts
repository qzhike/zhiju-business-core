import { describe, expect, it } from 'vitest';
import { externalIdentityLinkedPayload, principalRegisteredPayload } from './events.js';

// IP-API-C-001 contract slice: the public event payloads follow
// Module-Spec-001 §5 exactly and never embed raw external identifiers.

describe('identity public event payloads', () => {
  it('PrincipalRegistered carries the principal ref, kind and status', () => {
    const payload = principalRegisteredPayload({
      principalId: '11111111-1111-7111-8111-1111111111a1',
      principalKind: 'HUMAN',
      status: 'ACTIVE',
    });
    expect(payload).toEqual({
      principalRef: { objectType: 'Principal', objectId: '11111111-1111-7111-8111-1111111111a1' },
      principalKind: 'HUMAN',
      status: 'ACTIVE',
    });
  });

  it('ExternalIdentityLinked exposes only the keyed lookup-hash reference', () => {
    const hash = Buffer.alloc(32, 0xab);
    const payload = externalIdentityLinkedPayload({
      linkId: '22222222-2222-7222-8222-2222222222b2',
      principalId: '11111111-1111-7111-8111-1111111111a1',
      providerCode: 'feishu',
      lookupHash: hash,
      lookupHashAlgorithm: 'HMAC-SHA-256',
      canonicalizationVersion: '1',
    });
    expect(Object.keys(payload).sort()).toEqual([
      'externalIdentityLinkRef',
      'externalIdentityLookupHashRef',
      'principalRef',
      'providerCode',
    ]);
    expect(payload.externalIdentityLookupHashRef).toEqual({
      algorithm: 'HMAC-SHA-256',
      digest: hash.toString('hex'),
      canonicalizationVersion: '1',
    });
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
  });
});
