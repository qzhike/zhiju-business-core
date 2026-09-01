// IM-05 WI-07 (issue #127): Release Readiness and Human Authorization
// revalidation. This file intentionally consumes narrow ports instead of
// importing IdentityPolicy or QualityGovernance repositories.

import type { Common, Core, ReleasePublication } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { buildPackageHashMaterial, sameContentHash } from './package-hash.js';
import {
  ReleasePublicationBusinessError,
  validateDestinations,
  validateDraftAuthorities,
  validateDraftDefinition,
  validatePackageDefinition,
  validatePackageShape,
  validateReleasePackageRef,
  validateSelections,
  type ReleaseActorSnapshotFact,
  type ReleaseAuthorizationDecisionFact,
  type ReleaseAuthorityQueryPorts,
} from './release-publication-validation.js';
import { sameObjectRef, samePackageRef, sameScopeRef } from './receipt-validator.js';
import type { ReleaseTransactionContext } from './persistence/release-publication-db.js';

export const RELEASE_READINESS_NOT_READY = 'RELEASE_READINESS_NOT_READY';
export const RELEASE_READINESS_INVALID = 'RELEASE_READINESS_INVALID';
export const RELEASE_AUTHORIZATION_INVALID = 'RELEASE_AUTHORIZATION_INVALID';
export const RELEASE_AUTHORIZATION_EXPIRED = 'RELEASE_AUTHORIZATION_EXPIRED';
export const RELEASE_AUTHORIZATION_REVOKED = 'RELEASE_AUTHORIZATION_REVOKED';
export const RELEASE_ACTOR_NOT_HUMAN = 'RELEASE_ACTOR_NOT_HUMAN';
export const RELEASE_ACTOR_SNAPSHOT_MISMATCH = 'RELEASE_ACTOR_SNAPSHOT_MISMATCH';
export const RELEASE_AUTHORIZATION_DECISION_MISMATCH = 'RELEASE_AUTHORIZATION_DECISION_MISMATCH';
export const RELEASE_AUTHORIZATION_PURPOSE_MISMATCH = 'RELEASE_AUTHORIZATION_PURPOSE_MISMATCH';

const AUTHORIZE_COMMAND_TYPE = 'release.authorize_release';
const AUTHORIZE_COMMAND_VERSION = '1.0';
const AUTHORIZE_PURPOSE = 'release.publication.authorize_release';

type DraftDefinition = ReleasePublication.ReleaseDraftDefinition;
type PackageDefinition = ReleasePublication.ReleasePackageDefinition;

export interface ReleaseAuthorizationRevalidationInput {
  readonly context: ReleaseTransactionContext;
  readonly ports: ReleaseAuthorityQueryPorts;
  readonly releaseRef: Common.ObjectRef;
  readonly draftDefinition: DraftDefinition;
  readonly packageRef: Common.ReleasePackageRef;
  readonly packageDefinition: PackageDefinition;
  /** Frozen rows read from ReleasePublication immediately before recheck. */
  readonly frozenSelections?: readonly ReleasePublication.ReleaseRepresentationSelection[];
  readonly frozenDestinations?: readonly ReleasePublication.ReleaseDestinationDefinition[];
  readonly frozenRecipientScopeSnapshotRef?: Common.SnapshotRef;
  readonly releaseReadinessSnapshotRef: Common.SnapshotRef;
  readonly now: Date;
}

export interface ReleaseAuthorizationRevalidationResult {
  readonly releaseReadinessSnapshot: Core.ReleaseReadinessSnapshot;
  readonly packageDefinition: PackageDefinition;
}

export interface ReleaseAuthorizationValidationInput extends ReleaseAuthorizationRevalidationInput {
  readonly authorizingHumanRef: Common.PrincipalRef;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly expectedCommandPayloadHash?: Common.ContentHash;
  readonly expectedCommandType?: string;
  readonly expectedCommandVersion?: string;
  readonly expectedPurpose?: string;
}

export interface ReleaseHumanAuthorizationChainInput {
  readonly context: ReleaseTransactionContext;
  readonly ports: ReleaseAuthorityQueryPorts;
  readonly releaseRef: Common.ObjectRef;
  readonly authorizingHumanRef: Common.PrincipalRef;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly expectedCommandPayloadHash?: Common.ContentHash;
  readonly expectedCommandType?: string;
  readonly expectedCommandVersion?: string;
  readonly expectedPurpose?: string;
  readonly now: Date;
}

/** Input variant for commands whose current ActorSnapshot is named by the Decision. */
export type ReleaseCurrentDecisionAuthorizationChainInput = Omit<
  ReleaseHumanAuthorizationChainInput,
  'actorSnapshotRef'
>;

export interface ReleaseAuthorizationValidationResult extends ReleaseAuthorizationRevalidationResult {
  readonly actorSnapshot: ReleaseActorSnapshotFact;
  readonly authorizationDecision: ReleaseAuthorizationDecisionFact;
}

function fail(code: string, message: string): never {
  throw new ReleasePublicationBusinessError(code, message);
}

function date(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    fail(RELEASE_AUTHORIZATION_INVALID, `${label} is invalid`);
  return parsed;
}

function equalJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function sortedExternalRefs(refs: readonly Common.ExternalRef[]): readonly string[] {
  return refs.map((ref) => canonicalize(ref as unknown as CanonicalJsonValue)).sort();
}

function assertExactReadiness(
  snapshot: Core.ReleaseReadinessSnapshot,
  input: ReleaseAuthorizationRevalidationInput,
  packageDefinition: PackageDefinition,
): void {
  if (
    snapshot.snapshotId !== input.releaseReadinessSnapshotRef.snapshotId ||
    !sameScopeRef(snapshot.header.scopeRef, input.releaseReadinessSnapshotRef.scope) ||
    !sameObjectRef(snapshot.releaseRef, input.releaseRef) ||
    !sameObjectRef(snapshot.artifactRef, input.draftDefinition.artifactRef) ||
    !equalJson(snapshot.revisionRef, packageDefinition.canonicalRevisionRef) ||
    !equalJson(snapshot.approvalBundleSnapshotRef, packageDefinition.approvalBundleSnapshotRef) ||
    !samePackageRef(snapshot.releasePackageRef, input.packageRef) ||
    snapshot.purpose !== input.draftDefinition.purpose ||
    !equalJson(snapshot.recipientScopeSnapshotRef, packageDefinition.recipientScopeSnapshotRef) ||
    sortedExternalRefs(snapshot.destinationRefs).join('\u0000') !==
      sortedExternalRefs(
        packageDefinition.destinations.map((destination) => destination.destinationRef),
      ).join('\u0000') ||
    snapshot.readiness.status !== 'READY_FOR_AUTHORIZATION' ||
    snapshot.releaseRequirements.some((requirement) => !requirement.satisfied) ||
    date(snapshot.evaluatedAt, 'ReleaseReadinessSnapshot.evaluatedAt') > input.now
  ) {
    fail(
      snapshot.readiness.status === 'READY_FOR_AUTHORIZATION'
        ? RELEASE_READINESS_INVALID
        : RELEASE_READINESS_NOT_READY,
      'Release Readiness Snapshot is stale, not ready, or does not match the frozen Package',
    );
  }
}

/**
 * Performs the final exact authority recheck immediately before authorization.
 * A missing RRS port is a deliberate fail-closed result, not a legacy fallback.
 */
export async function revalidateReleaseForAuthorization(
  input: ReleaseAuthorizationRevalidationInput,
): Promise<ReleaseAuthorizationRevalidationResult> {
  const validatedDraft = validateDraftDefinition(
    input.draftDefinition,
    input.context,
    input.packageRef.releaseRef.scope.projectId,
  );
  if (!sameObjectRef(input.releaseRef, input.packageRef.releaseRef)) {
    fail(RELEASE_READINESS_INVALID, 'ReleasePackageRef.releaseRef must equal the target Release');
  }
  const validatedPackage = validatePackageDefinition(
    input.packageDefinition,
    input.context,
    input.packageRef.releaseRef.scope.projectId,
  );
  validateReleasePackageRef(input.packageRef, input.context);
  const packageShape = validatePackageShape(
    validatedPackage.definition,
    input.releaseRef,
    validatedDraft.definition,
    input.frozenSelections ?? validatedPackage.definition.representations,
    input.frozenDestinations ?? validatedPackage.definition.destinations,
    input.frozenRecipientScopeSnapshotRef ?? validatedPackage.definition.recipientScopeSnapshotRef,
    input.context,
    input.packageRef.releaseRef.scope.projectId,
  );
  const selections = await validateSelections(
    packageShape.representations,
    validatedDraft.definition.revisionRef,
    input.context,
    input.ports,
    input.packageRef.releaseRef.scope.projectId,
  );
  const destinations = validateDestinations(
    packageShape.destinations,
    packageShape.recipientScopeSnapshotRef,
    input.context,
    input.packageRef.releaseRef.scope.projectId,
  );
  const normalizedPackage: PackageDefinition = {
    ...packageShape,
    representations: selections,
    destinations: destinations.destinations,
    recipientScopeSnapshotRef: destinations.recipientScopeSnapshotRef,
  };
  const material = buildPackageHashMaterial(normalizedPackage);
  if (!sameContentHash(material.expectedPackageHash, input.packageRef.packageHash)) {
    fail(RELEASE_READINESS_INVALID, 'frozen Package hash does not match the recomputed manifest');
  }
  await validateDraftAuthorities(
    validatedDraft.definition,
    input.context,
    input.ports,
    input.packageRef.releaseRef.scope.projectId,
  );
  if (input.ports.quality.getReleaseReadinessSnapshot === undefined) {
    fail(RELEASE_READINESS_INVALID, 'Release Readiness Snapshot authority port is unavailable');
  }
  let resolvedSnapshot: unknown;
  try {
    resolvedSnapshot = await input.ports.quality.getReleaseReadinessSnapshot({
      snapshotRef: input.releaseReadinessSnapshotRef,
      requireCurrentForAuthorization: true,
    });
  } catch {
    fail(RELEASE_READINESS_INVALID, 'Release Readiness Snapshot could not be resolved exactly');
  }
  if (resolvedSnapshot === null || typeof resolvedSnapshot !== 'object') {
    fail(RELEASE_READINESS_INVALID, 'Release Readiness Snapshot could not be resolved exactly');
  }
  const snapshot = resolvedSnapshot as Core.ReleaseReadinessSnapshot;
  assertExactReadiness(snapshot, input, normalizedPackage);
  return { releaseReadinessSnapshot: snapshot, packageDefinition: material.normalizedDefinition };
}

function assertPrincipal(
  left: Common.PrincipalRef,
  right: Common.PrincipalRef,
  label: string,
): void {
  if (left.principalKind !== right.principalKind || left.principalId !== right.principalId) {
    fail(RELEASE_AUTHORIZATION_INVALID, `${label} does not match the trusted principal`);
  }
}

function assertActorSnapshot(
  actor: ReleaseActorSnapshotFact,
  input: ReleaseHumanAuthorizationChainInput,
): void {
  if (!equalJson(actor.actorSnapshotRef, input.actorSnapshotRef)) {
    fail(RELEASE_ACTOR_SNAPSHOT_MISMATCH, 'ActorSnapshot reference or hash is not exact');
  }
  if (actor.principalRef.principalKind !== 'HUMAN') {
    fail(RELEASE_ACTOR_NOT_HUMAN, 'only a trusted Human ActorSnapshot may authorize a Release');
  }
  if (actor.actingForRef !== undefined && actor.actingForRef.principalKind !== 'HUMAN') {
    fail(RELEASE_ACTOR_NOT_HUMAN, 'an Agent/Service/Runtime actingFor Human cannot authorize');
  }
  assertPrincipal(actor.principalRef, input.authorizingHumanRef, 'ActorSnapshot principal');
  if (!sameScopeRef(actor.actorSnapshotRef.scope, input.releaseRef.scope)) {
    fail(RELEASE_ACTOR_SNAPSHOT_MISMATCH, 'ActorSnapshot scope does not match the Release scope');
  }
  if (
    actor.revokedAt !== undefined &&
    date(actor.revokedAt, 'ActorSnapshot.revokedAt') <= input.now
  ) {
    fail(RELEASE_AUTHORIZATION_REVOKED, 'ActorSnapshot is revoked');
  }
}

function assertAuthorizationDecision(
  decision: ReleaseAuthorizationDecisionFact,
  actor: ReleaseActorSnapshotFact,
  input: ReleaseHumanAuthorizationChainInput,
): void {
  if (!equalJson(decision.authorizationDecisionRef, input.authorizationDecisionRef)) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'AuthorizationDecision reference or hash is not exact',
    );
  }
  if (!equalJson(decision.actorSnapshotRef, actor.actorSnapshotRef)) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'AuthorizationDecision ActorSnapshot is not exact',
    );
  }
  assertPrincipal(
    decision.principalRef,
    input.authorizingHumanRef,
    'AuthorizationDecision principal',
  );
  if (
    decision.commandType !== (input.expectedCommandType ?? AUTHORIZE_COMMAND_TYPE) ||
    decision.commandVersion !== (input.expectedCommandVersion ?? AUTHORIZE_COMMAND_VERSION)
  ) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'AuthorizationDecision command identity is not exact',
    );
  }
  if (!sameScopeRef(decision.scope, input.releaseRef.scope)) {
    fail(RELEASE_AUTHORIZATION_DECISION_MISMATCH, 'AuthorizationDecision scope is not exact');
  }
  if (decision.purpose !== (input.expectedPurpose ?? AUTHORIZE_PURPOSE)) {
    fail(RELEASE_AUTHORIZATION_PURPOSE_MISMATCH, 'AuthorizationDecision purpose is not exact');
  }
  if (
    input.expectedCommandPayloadHash !== undefined &&
    (decision.commandPayloadHash === undefined ||
      !sameContentHash(decision.commandPayloadHash, input.expectedCommandPayloadHash))
  ) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'AuthorizationDecision payload hash is not exact',
    );
  }
  if (!sameContentHash(decision.authenticationContextHash, actor.authenticationContextHash)) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'AuthorizationDecision authentication context is not exact',
    );
  }
  if (decision.outcome !== 'ALLOW') {
    fail(
      RELEASE_AUTHORIZATION_INVALID,
      'AuthorizationDecision did not allow Release authorization',
    );
  }
  if (
    decision.revokedAt !== undefined &&
    date(decision.revokedAt, 'AuthorizationDecision.revokedAt') <= input.now
  ) {
    fail(RELEASE_AUTHORIZATION_REVOKED, 'AuthorizationDecision is revoked');
  }
  if (date(decision.expiresAt, 'AuthorizationDecision.expiresAt') <= input.now) {
    fail(RELEASE_AUTHORIZATION_EXPIRED, 'AuthorizationDecision has expired');
  }
}

/** Validates the complete trusted Human → ActorSnapshot → Decision chain. */
export async function validateHumanAuthorizationChain(
  input: ReleaseHumanAuthorizationChainInput | ReleaseCurrentDecisionAuthorizationChainInput,
): Promise<{
  readonly actorSnapshot: ReleaseActorSnapshotFact;
  readonly authorizationDecision: ReleaseAuthorizationDecisionFact;
}> {
  if (
    input.context.kind !== 'REQUEST' ||
    input.context.principalKind !== 'HUMAN' ||
    input.context.principalId !== input.authorizingHumanRef.principalId ||
    input.authorizingHumanRef.principalKind !== 'HUMAN'
  ) {
    fail(
      RELEASE_ACTOR_NOT_HUMAN,
      'Release authorization requires the trusted Human transaction principal',
    );
  }
  if (
    input.releaseRef.scope.enterpriseId === undefined ||
    input.context.enterpriseId !== input.releaseRef.scope.enterpriseId ||
    (input.releaseRef.scope.projectId !== undefined &&
      !input.context.allowedProjectIds.includes(input.releaseRef.scope.projectId))
  ) {
    fail(RELEASE_AUTHORIZATION_INVALID, 'Release scope is outside the trusted transaction context');
  }
  if (
    !Number.isFinite(input.context.authorizationDecisionExpiresAt.getTime()) ||
    input.context.authorizationDecisionExpiresAt <= input.now
  ) {
    fail(RELEASE_AUTHORIZATION_EXPIRED, 'transaction authorization context has expired');
  }
  const authorizationDecisionReference = input.authorizationDecisionRef as unknown as {
    readonly kind?: unknown;
    readonly objectType?: unknown;
  };
  const actorSnapshotReference =
    'actorSnapshotRef' in input
      ? (input.actorSnapshotRef as unknown as {
          readonly kind?: unknown;
          readonly objectType?: unknown;
        })
      : undefined;
  if (
    (actorSnapshotReference !== undefined &&
      (actorSnapshotReference.kind !== 'SNAPSHOT' ||
        actorSnapshotReference.objectType !== 'identity.actor_snapshot')) ||
    authorizationDecisionReference.kind !== 'CONTENT_ADDRESSED' ||
    authorizationDecisionReference.objectType !== 'identity.authorization_decision'
  ) {
    fail(RELEASE_AUTHORIZATION_INVALID, 'authorization chain reference types are not exact');
  }
  if (input.context.authorizationDecisionId !== input.authorizationDecisionRef.objectId) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'Envelope AuthorizationDecision does not match the payload',
    );
  }
  if (
    !Buffer.isBuffer(input.context.authorizationDecisionHash) ||
    input.context.authorizationDecisionHash.length !== 32 ||
    !input.context.authorizationDecisionHash.equals(
      Buffer.from(input.authorizationDecisionRef.contentHash.digest, 'hex'),
    )
  ) {
    fail(
      RELEASE_AUTHORIZATION_DECISION_MISMATCH,
      'trusted AuthorizationDecision hash does not match the payload',
    );
  }
  const identity = input.ports.identity;
  if (identity === undefined) {
    fail(RELEASE_AUTHORIZATION_INVALID, 'Identity authority ports are unavailable');
  }

  let decision: ReleaseAuthorizationDecisionFact | undefined;
  try {
    decision = await identity.getAuthorizationDecision(input.authorizationDecisionRef);
  } catch {
    fail(RELEASE_AUTHORIZATION_INVALID, 'AuthorizationDecision could not be resolved exactly');
  }
  if (decision === undefined) {
    fail(RELEASE_AUTHORIZATION_DECISION_MISMATCH, 'AuthorizationDecision was not found exactly');
  }

  const actorSnapshotRef =
    'actorSnapshotRef' in input ? input.actorSnapshotRef : decision.actorSnapshotRef;
  const resolvedInput: ReleaseHumanAuthorizationChainInput = { ...input, actorSnapshotRef };
  const resolvedActorSnapshotReference = resolvedInput.actorSnapshotRef as unknown as {
    readonly kind?: unknown;
    readonly objectType?: unknown;
  };
  if (
    resolvedActorSnapshotReference.kind !== 'SNAPSHOT' ||
    resolvedActorSnapshotReference.objectType !== 'identity.actor_snapshot'
  ) {
    fail(RELEASE_AUTHORIZATION_INVALID, 'authorization chain reference types are not exact');
  }
  if (resolvedInput.context.actorSnapshotId !== resolvedInput.actorSnapshotRef.snapshotId) {
    fail(
      RELEASE_ACTOR_SNAPSHOT_MISMATCH,
      'Envelope ActorSnapshot does not match the authorization payload',
    );
  }

  let actor: ReleaseActorSnapshotFact | undefined;
  try {
    actor = await identity.getActorSnapshot(resolvedInput.actorSnapshotRef);
  } catch {
    fail(RELEASE_AUTHORIZATION_INVALID, 'ActorSnapshot could not be resolved exactly');
  }
  if (actor === undefined)
    fail(RELEASE_ACTOR_SNAPSHOT_MISMATCH, 'ActorSnapshot was not found exactly');
  assertActorSnapshot(actor, resolvedInput);
  assertAuthorizationDecision(decision, actor, resolvedInput);
  return { actorSnapshot: actor, authorizationDecision: decision };
}

export async function validateReleaseAuthorization(
  input: ReleaseAuthorizationValidationInput,
): Promise<ReleaseAuthorizationValidationResult> {
  const revalidated = await revalidateReleaseForAuthorization(input);
  const chain = await validateHumanAuthorizationChain(input);
  return { ...revalidated, ...chain };
}

export const releaseAuthorizationContract = Object.freeze({
  commandType: AUTHORIZE_COMMAND_TYPE,
  commandVersion: AUTHORIZE_COMMAND_VERSION,
  purpose: AUTHORIZE_PURPOSE,
});
