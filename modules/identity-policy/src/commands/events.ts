// IM-02 WI-07 (issue #35): public event payload builders for the minimal
// IdentityPolicy slice. The payloads follow Module-Spec-001 §5 exactly:
// ExternalIdentityLinked carries only the keyed lookup-hash reference —
// raw open_id / email / phone must never appear in events, logs or errors.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export interface PrincipalRegisteredPayload {
  principalRef: { objectType: 'Principal'; objectId: string };
  principalKind: string;
  status: string;
}

export function principalRegisteredPayload(input: {
  principalId: string;
  principalKind: string;
  status: string;
}): PrincipalRegisteredPayload & CanonicalJsonObject {
  return {
    principalRef: { objectType: 'Principal', objectId: input.principalId },
    principalKind: input.principalKind,
    status: input.status,
  };
}

export interface ExternalIdentityLinkedPayload {
  externalIdentityLinkRef: { objectType: 'ExternalIdentityLink'; objectId: string };
  principalRef: { objectType: 'Principal'; objectId: string };
  providerCode: string;
  externalIdentityLookupHashRef: {
    algorithm: string;
    digest: string;
    canonicalizationVersion: string;
  };
}

export function externalIdentityLinkedPayload(input: {
  linkId: string;
  principalId: string;
  providerCode: string;
  lookupHash: Buffer;
  lookupHashAlgorithm: string;
  canonicalizationVersion: string;
}): ExternalIdentityLinkedPayload & CanonicalJsonObject {
  return {
    externalIdentityLinkRef: { objectType: 'ExternalIdentityLink', objectId: input.linkId },
    principalRef: { objectType: 'Principal', objectId: input.principalId },
    providerCode: input.providerCode,
    externalIdentityLookupHashRef: {
      algorithm: input.lookupHashAlgorithm,
      digest: input.lookupHash.toString('hex'),
      canonicalizationVersion: input.canonicalizationVersion,
    },
  };
}
