/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime boundaries revalidate untrusted transport and persisted values. */
import { sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { ZIP_LIMITS } from './zip-safety.js';
export interface CustomerZipPolicyArtifact {
  readonly policyRef: Readonly<Record<string, unknown>>;
  readonly payloadHash: {
    readonly algorithm: 'SHA-256';
    readonly canonicalizationVersion: '1';
    readonly digest: string;
  };
  readonly payload: {
    readonly profile: 'zip-intake-limits@1';
    readonly limits: typeof ZIP_LIMITS;
    readonly allowedFormats: readonly ['DOCX', 'UTF8_MARKDOWN'];
    readonly rejectRules: readonly [
      'MULTI_DISK',
      'ENCRYPTED',
      'UNSAFE_PATH',
      'LINK_OR_DEVICE',
      'PATH_COLLISION',
      'CRC_MISMATCH',
      'ZIP_BOMB',
    ];
    readonly retainOriginalBytes: true;
    readonly noteIsUntrustedMaterial: true;
    readonly extractorProfileRef: Readonly<Record<string, unknown>>;
  };
}
export function customerZipPolicyHash(value: unknown): string {
  return sha256CanonicalJson(value as CanonicalJsonValue);
}
function unavailable(): never {
  throw new Error('INTEGRATION_PREPARATION_PROFILE_UNAVAILABLE');
}
/** Deployment supplies reviewed immutable artifacts; there are no production defaults. */
export function createCustomerZipPolicyRegistry(artifacts: readonly CustomerZipPolicyArtifact[]) {
  const registry = new Map<string, CustomerZipPolicyArtifact>();
  for (const input of artifacts) {
    const artifact = JSON.parse(JSON.stringify(input)) as CustomerZipPolicyArtifact;
    const payload = artifact.payload;
    if (
      Object.keys(artifact).sort().join() !== 'payload,payloadHash,policyRef' ||
      Object.keys(payload).sort().join() !==
        'allowedFormats,extractorProfileRef,limits,noteIsUntrustedMaterial,profile,rejectRules,retainOriginalBytes' ||
      payload.profile !== 'zip-intake-limits@1' ||
      customerZipPolicyHash(payload.limits) !== customerZipPolicyHash(ZIP_LIMITS) ||
      JSON.stringify(payload.allowedFormats) !== JSON.stringify(['DOCX', 'UTF8_MARKDOWN']) ||
      JSON.stringify(payload.rejectRules) !==
        JSON.stringify([
          'MULTI_DISK',
          'ENCRYPTED',
          'UNSAFE_PATH',
          'LINK_OR_DEVICE',
          'PATH_COLLISION',
          'CRC_MISMATCH',
          'ZIP_BOMB',
        ]) ||
      !payload.retainOriginalBytes ||
      !payload.noteIsUntrustedMaterial ||
      artifact.policyRef.kind !== 'VERSIONED' ||
      artifact.policyRef.objectType !== 'zhiju.integration.customer_zip_policy' ||
      typeof artifact.policyRef.versionId !== 'string' ||
      typeof payload.extractorProfileRef.versionId !== 'string' ||
      artifact.payloadHash.algorithm !== 'SHA-256' ||
      artifact.payloadHash.canonicalizationVersion !== '1' ||
      artifact.payloadHash.digest !== customerZipPolicyHash(payload)
    )
      unavailable();
    const key = customerZipPolicyHash(artifact.policyRef);
    if (registry.has(key)) unavailable();
    registry.set(key, artifact);
  }
  return {
    resolve(
      policyRef: Readonly<Record<string, unknown>>,
      hash: CustomerZipPolicyArtifact['payloadHash'],
    ): CustomerZipPolicyArtifact {
      const stored = registry.get(customerZipPolicyHash(policyRef));
      if (!stored || customerZipPolicyHash(hash) !== customerZipPolicyHash(stored.payloadHash))
        unavailable();
      return JSON.parse(JSON.stringify(stored)) as CustomerZipPolicyArtifact;
    },
  };
}
