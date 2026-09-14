// IM-06 (#188): capture Policy consumption for the ContextSourceSlice boundary.
//
// EnterpriseProject never reads IdentityPolicy tables and never imports the
// IdentityPolicy module (Spec 002 §11). The resolved capture Policy therefore
// arrives through this module-owned Port, whose production adapter calls the
// IdentityPolicy-owned `identity.resolve_policy@1.0` entry with its own
// `identity.policy.resolve_policy` Decision. This module only accepts an
// observation that is bound to the exact requested version key, Scope, content
// hash and observation instant, and it applies the owning
// `ep.context_source_slice_capture.policy@1.0` closed-field rules. Nothing here
// trusts a caller-reported hash, TTL or historical receipt.

import { isUuidV7 } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import { validateCapturePolicy, type CapturePolicyRules } from './capture-policy-profile.js';

/** Shared API reason code for an unreachable Policy resolution dependency. */
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

const POLICY_VERSION_OBJECT_TYPE = 'zhiju.identity.policy_version';
const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';

export interface CapturePolicyObservation {
  readonly policyRef: Common.VersionedRef;
  readonly policyVersionRef: Common.SnapshotRef;
  readonly policySetVersion: string;
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
  readonly contentHash: Common.ContentHash;
  readonly scopeRef: Common.ScopeRef;
  readonly effectiveFrom: Common.UtcInstant;
  readonly supersededAt?: Common.UtcInstant | undefined;
  readonly useStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'REVOKED';
  readonly checkedAt: Common.UtcInstant;
}

export interface CapturePolicyResolutionRequest {
  /** Exact Policy version key from the capture request or the stored Slice. */
  readonly policyRef: Common.VersionedRef;
  /** Trusted server time the observation must be bound to. */
  readonly asOf: Date;
  readonly correlationId: string;
}

/**
 * `RESOLVED` carries the observation of this request; `UNRESOLVED` is the
 * authoritative "no committed version fact for this key in this Scope";
 * `UNAVAILABLE` is a temporary dependency failure that must fail closed.
 */
export type CapturePolicyResolution =
  | { readonly kind: 'RESOLVED'; readonly observation: CapturePolicyObservation }
  | { readonly kind: 'UNRESOLVED' }
  | { readonly kind: 'UNAVAILABLE' };

export interface CapturePolicyResolutionPort {
  resolveCapturePolicy(request: CapturePolicyResolutionRequest): Promise<CapturePolicyResolution>;
}

export interface ResolvedCapturePolicy {
  readonly observation: CapturePolicyObservation;
  readonly policyVersionRef: Common.SnapshotRef;
  readonly contentHash: Buffer;
  readonly rules: CapturePolicyRules;
}

export type CapturePolicyOutcome =
  | { readonly kind: 'USABLE'; readonly policy: ResolvedCapturePolicy }
  | { readonly kind: 'UNSUPPORTED' }
  | { readonly kind: 'NOT_USABLE' }
  | { readonly kind: 'UNAVAILABLE' };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sameScope(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return (
    (left.enterpriseId ?? null) === (right.enterpriseId ?? null) &&
    (left.projectId ?? null) === (right.projectId ?? null)
  );
}

function contentHashDigest(value: unknown): string | null {
  const hash = record(value);
  return hash.algorithm === 'SHA-256' &&
    hash.canonicalizationVersion === '1' &&
    typeof hash.digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(hash.digest)
    ? hash.digest
    : null;
}

function instantMillis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

/**
 * Resolves the exact capture Policy version key through the Port and accepts
 * the observation only when it is bound to this request and carries the owning
 * canonical profile with valid closed fields. Any other shape, key, Scope,
 * hash, instant or lifecycle state is refused instead of being interpreted.
 */
export async function resolveCapturePolicy(
  port: CapturePolicyResolutionPort,
  request: CapturePolicyResolutionRequest,
): Promise<CapturePolicyOutcome> {
  let resolution: CapturePolicyResolution;
  try {
    resolution = await port.resolveCapturePolicy(request);
  } catch {
    // A failing or misbehaving adapter is a dependency failure: it must never
    // degrade into an empty, default or previously observed Policy.
    return { kind: 'UNAVAILABLE' };
  }
  if (resolution.kind === 'UNAVAILABLE') return { kind: 'UNAVAILABLE' };
  if (resolution.kind === 'UNRESOLVED') return { kind: 'UNSUPPORTED' };
  const observation = resolution.observation;
  const requestedScope = record(request.policyRef.scope);
  const echoedRef = record(observation.policyRef);
  if (
    echoedRef.kind !== 'VERSIONED' ||
    echoedRef.objectType !== POLICY_OBJECT_TYPE ||
    echoedRef.objectType !== request.policyRef.objectType ||
    echoedRef.objectId !== request.policyRef.objectId ||
    echoedRef.versionId !== request.policyRef.versionId ||
    !sameScope(record(echoedRef.scope), requestedScope) ||
    !sameScope(record(observation.scopeRef), requestedScope)
  ) {
    return { kind: 'UNSUPPORTED' };
  }
  const digest = contentHashDigest(observation.contentHash);
  const versionRef = record(observation.policyVersionRef);
  if (
    digest === null ||
    versionRef.kind !== 'SNAPSHOT' ||
    versionRef.objectType !== POLICY_VERSION_OBJECT_TYPE ||
    typeof versionRef.objectId !== 'string' ||
    !isUuidV7(versionRef.objectId) ||
    versionRef.snapshotId !== versionRef.objectId ||
    !sameScope(record(versionRef.scope), requestedScope) ||
    contentHashDigest(versionRef.contentHash) !== digest
  ) {
    return { kind: 'UNSUPPORTED' };
  }
  const checkedAt = instantMillis(observation.checkedAt);
  const effectiveFrom = instantMillis(observation.effectiveFrom);
  const supersededAt =
    observation.supersededAt === undefined ? null : instantMillis(observation.supersededAt);
  if (
    checkedAt === null ||
    checkedAt !== request.asOf.getTime() ||
    effectiveFrom === null ||
    (observation.supersededAt !== undefined && supersededAt === null) ||
    typeof observation.policySetVersion !== 'string' ||
    observation.policySetVersion.trim().length === 0
  ) {
    return { kind: 'UNSUPPORTED' };
  }
  if (
    observation.useStatus !== 'USABLE' ||
    effectiveFrom > request.asOf.getTime() ||
    (supersededAt !== null && supersededAt <= request.asOf.getTime())
  ) {
    return { kind: 'NOT_USABLE' };
  }
  const document = validateCapturePolicy({
    policySchemaRefs: Array.isArray(observation.policySchemaRefs)
      ? observation.policySchemaRefs
      : [],
    policyDocument: observation.policyDocument,
  });
  if (!document.valid) return { kind: 'UNSUPPORTED' };
  return {
    kind: 'USABLE',
    policy: {
      observation,
      policyVersionRef: observation.policyVersionRef,
      contentHash: Buffer.from(digest, 'hex'),
      rules: document.rules,
    },
  };
}
