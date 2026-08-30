// IM-05 WI-01 (issue #121): fail-closed composition over public authority
// operations. QualityGovernance never receives another module's Repository.

import type { Artifact, Common, EnterpriseProject, IdentityPolicy } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';

export const QUALITY_REFERENCE_VALIDATION_FAILED = 'QUALITY_REFERENCE_VALIDATION_FAILED';

export class QualityAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QualityAuthorityError';
  }
}

export interface IdentityPolicyAuthorityPort {
  readonly resolvePrincipal: (
    operation: 'identity.resolve_principal',
    payload: IdentityPolicy.IdentityResolvePrincipalPayload,
  ) => Promise<IdentityPolicy.IdentityResolvePrincipalResult>;
  readonly authorizeCommand: (
    operation: 'identity.authorize_command',
    payload: IdentityPolicy.IdentityAuthorizeCommandPayload,
  ) => Promise<IdentityPolicy.IdentityAuthorizeCommandResult>;
}

export interface EnterpriseProjectAuthorityPort {
  readonly validateObjectScope: (
    operation: 'project.validate_object_scope',
    payload: EnterpriseProject.ProjectValidateObjectScopePayload,
  ) => Promise<EnterpriseProject.ProjectValidateObjectScopeResult>;
}

export interface ArtifactAuthorityPort {
  readonly validateRevisionRef: (
    operation: 'artifact.validate_revision_ref',
    payload: Artifact.ArtifactValidateRevisionRefPayload,
  ) => Promise<Artifact.ArtifactValidateRevisionRefResult>;
}

export interface QualityAuthorityPorts {
  readonly identityPolicy: IdentityPolicyAuthorityPort;
  readonly enterpriseProject: EnterpriseProjectAuthorityPort;
  readonly artifact: ArtifactAuthorityPort;
}

export interface QualityAuthorityValidationInput {
  readonly principalRef: Common.ObjectRef;
  readonly expectedPrincipalKind: IdentityPolicy.PrincipalKind;
  readonly principalPurpose: Common.NamespaceCode;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationIntent: IdentityPolicy.CommandIntent;
  readonly authenticationContextRef: Common.ContentAddressedRef;
  readonly expectedAuthorizationDecisionId: Common.UuidV7;
  readonly objectRef: Common.TypedReference;
  readonly revisionRef: Common.ContentAddressedRef;
  readonly expectedScopeRef: Common.ScopeRef;
  readonly referencePurpose: Common.NamespaceCode;
  readonly allowedRevisionDispositions: readonly Artifact.RevisionDisposition[];
  readonly asOf: Date;
}

export interface QualityAuthorityValidation {
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly objectScope: EnterpriseProject.ObjectScopeValidation;
  readonly revision: Artifact.RevisionValidation;
}

function exact(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function reject(message: string): never {
  throw new QualityAuthorityError(QUALITY_REFERENCE_VALIDATION_FAILED, message);
}

export async function validateQualityAuthorities(
  ports: QualityAuthorityPorts,
  input: QualityAuthorityValidationInput,
): Promise<QualityAuthorityValidation> {
  const principal = await ports.identityPolicy.resolvePrincipal('identity.resolve_principal', {
    lookup: { kind: 'PRINCIPAL_REF', principalRef: input.principalRef },
    requiredScopeRef: input.expectedScopeRef,
    purpose: input.principalPurpose,
  });
  if (
    principal.status !== 'ACTIVE' ||
    principal.principalKind !== input.expectedPrincipalKind ||
    !exact(principal.principalRef, input.principalRef)
  ) {
    reject('IdentityPolicy did not resolve the exact active principal');
  }

  const authorization = await ports.identityPolicy.authorizeCommand('identity.authorize_command', {
    actorSnapshotRef: input.actorSnapshotRef,
    intent: input.authorizationIntent,
    authenticationContextRef: input.authenticationContextRef,
  });
  if (
    authorization.outcome !== 'ALLOW' ||
    authorization.authorizationDecisionRef.objectId !== input.expectedAuthorizationDecisionId ||
    !exact(authorization.effectiveScopeRef, input.expectedScopeRef) ||
    new Date(authorization.expiresAt).getTime() <= input.asOf.getTime()
  ) {
    reject('IdentityPolicy authorization is denied, stale, or not exact');
  }

  const objectScope = await ports.enterpriseProject.validateObjectScope(
    'project.validate_object_scope',
    {
      objectRef: input.objectRef,
      expectedScopeRef: input.expectedScopeRef,
      purpose: input.referencePurpose,
    },
  );
  if (
    !objectScope.valid ||
    !exact(objectScope.resolvedRef, input.objectRef) ||
    !exact(objectScope.authoritativeScopeRef, input.expectedScopeRef)
  ) {
    reject('EnterpriseProject did not validate the exact object and scope');
  }

  const revision = await ports.artifact.validateRevisionRef('artifact.validate_revision_ref', {
    revisionRef: input.revisionRef,
    expectedScopeRef: input.expectedScopeRef,
    purpose: input.referencePurpose,
    allowedDispositions: input.allowedRevisionDispositions,
  });
  if (
    !revision.valid ||
    !revision.contentAvailable ||
    !exact(revision.exactRef, input.revisionRef) ||
    !exact(revision.authoritativeScopeRef, input.expectedScopeRef) ||
    revision.disposition === undefined ||
    !input.allowedRevisionDispositions.includes(revision.disposition)
  ) {
    reject('Artifact did not validate the exact available revision');
  }

  return {
    authorizationDecisionRef: authorization.authorizationDecisionRef,
    objectScope,
    revision,
  };
}
