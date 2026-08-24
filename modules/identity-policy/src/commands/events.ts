// IM-02 WI-07 (issue #35): public event payload builders for the minimal
// IdentityPolicy slice. The payloads follow Module-Spec-001 §5 exactly:
// ExternalIdentityLinked carries only a content-addressed lookup reference —
// raw open_id / email / phone must never appear in events, logs or errors.

import { sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, IdentityPolicy } from '@zhiju/contracts';

type PrincipalRegisteredPayload = IdentityPolicy.IdentityPrincipalRegisteredPayload;
type ExternalIdentityLinkedPayload = IdentityPolicy.IdentityExternalIdentityLinkedPayload;

function objectReference(
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope,
  };
}

export function principalRegisteredPayload(input: {
  principalId: string;
  principalKind: IdentityPolicy.PrincipalKind;
  status: IdentityPolicy.PrincipalStatus;
  scope: Common.ScopeRef;
}): PrincipalRegisteredPayload & CanonicalJsonObject {
  return {
    principalRef: objectReference('identity.principal', input.principalId, input.scope),
    principalKind: input.principalKind,
    status: input.status,
  } as unknown as PrincipalRegisteredPayload & CanonicalJsonObject;
}

export function externalIdentityLinkedPayload(input: {
  linkId: string;
  principalId: string;
  providerCode: string;
  accountLookupHash: Buffer;
  accountLookupHashAlgorithm: string;
  accountLookupKeyVersion: number;
  subjectLookupHash: Buffer;
  subjectLookupHashAlgorithm: string;
  subjectLookupKeyVersion: number;
  scope: Common.ScopeRef;
}): ExternalIdentityLinkedPayload & CanonicalJsonObject {
  const lookupIdentity = {
    account: {
      algorithm: input.accountLookupHashAlgorithm,
      digest: input.accountLookupHash.toString('hex'),
      keyVersion: input.accountLookupKeyVersion,
    },
    subject: {
      algorithm: input.subjectLookupHashAlgorithm,
      digest: input.subjectLookupHash.toString('hex'),
      keyVersion: input.subjectLookupKeyVersion,
    },
  } satisfies CanonicalJsonObject;

  return {
    externalIdentityLinkRef: objectReference(
      'identity.external_identity_link',
      input.linkId,
      input.scope,
    ),
    principalRef: objectReference('identity.principal', input.principalId, input.scope),
    providerCode: input.providerCode,
    externalIdentityLookupHashRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.external_identity_lookup',
      // WI-07 does not materialize a separate lookup row; the immutable link
      // identity is the stable locator for the paired keyed hashes.
      objectId: input.linkId,
      scope: input.scope,
      contentHash: {
        algorithm: 'SHA-256',
        digest: sha256CanonicalJson(lookupIdentity),
        canonicalizationVersion: '1',
      },
    },
  } as unknown as ExternalIdentityLinkedPayload & CanonicalJsonObject;
}
