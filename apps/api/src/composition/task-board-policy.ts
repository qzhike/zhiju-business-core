// IM-06 TD-05 (#248): the shared owning Board Policy resolution.
//
// Both the Human read entry and the dispatcher/maintenance passes must resolve
// the *current* fixed Project-scoped Board Policy through the owning
// `identity.resolve_policy@1.0` entry under their own `taskBoardPolicyReadV1`
// Decision. Keeping one implementation here means the read path and the
// technical passes can never drift into resolving a stale or a different
// profile.

import type { Common } from '@zhiju/contracts';
import {
  AUTHORIZATION_REVOKED,
  SnapshotBoundaryError,
  authorizeCommand,
  resolvePolicy,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { validateTaskBoardPolicy, type TaskBoardPolicyResolution } from '@zhiju/task-execution';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  contentHash,
  entryError,
  payloadHashOf,
  policySnapshotReference,
  record,
  type DecisionRow,
} from './decision-boundary.js';

export interface BoardPolicyResolutionContext {
  /** The owning Decision port dependencies of the SERVICE bootstrap. */
  readonly deps: IdentityCommandDeps;
  /** The bootstrap Decision row (Service principal and Scope). */
  readonly row: DecisionRow;
  /** The exact Policy the Project is configured with. */
  readonly policyRef: Common.VersionedRef;
  /** Actor snapshot of the SERVICE principal that resolves the Policy. */
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authenticationContextHash: Buffer;
  readonly capabilityCode: string;
  readonly now: () => Date;
}

/**
 * Resolve and validate the fixed Board Policy. A missing Decision, a
 * non-USABLE Policy, a different configured identity or a document outside the
 * registered closed profile fails the whole read/step closed.
 */
export async function resolveTaskBoardPolicy(
  context: BoardPolicyResolutionContext,
): Promise<TaskBoardPolicyResolution> {
  const scopeValue = record(context.policyRef.scope);
  const base: IdentityTransactionContext = {
    kind: 'REQUEST',
    principalId: context.row.principal_id,
    actorSnapshotId: context.actorSnapshotRef.snapshotId,
    authorizationDecisionId: context.row.authorization_decision_id,
    authorizationDecisionHash: context.row.payload_hash,
    authorizationDecisionExpiresAt: context.row.expires_at,
    enterpriseId: context.row.enterprise_id,
    allowedProjectIds: context.row.project_id === null ? [] : [context.row.project_id],
    correlationId: context.row.authorization_decision_id,
  };
  const authorized = await authorizeCommand(
    { ...context.deps, context: base },
    {
      actorSnapshotRef: context.actorSnapshotRef,
      intent: {
        commandType: 'identity.resolve_policy',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: context.row.enterprise_id,
        ...(context.row.project_id === null ? {} : { projectId: context.row.project_id }),
        purpose: 'identity.policy.resolve_policy',
        requestedCapability: context.capabilityCode,
        commandPayloadHash: payloadHashOf({ policyRef: context.policyRef }),
        requestedAt: context.now(),
        highRiskAction: false,
      },
      authenticationContextHash: context.authenticationContextHash,
      policySnapshotRef: policySnapshotReference(context.row),
    },
  );
  if (authorized.outcome !== 'ALLOW')
    entryError(AUTHORIZATION_REVOKED, 'Board Policy resolution was denied');
  const resolveContext: IdentityTransactionContext = {
    ...base,
    authorizationDecisionId: authorized.authorizationDecisionRef.objectId,
    authorizationDecisionHash: Buffer.from(
      authorized.authorizationDecisionRef.contentHash.digest,
      'hex',
    ),
    authorizationDecisionExpiresAt: new Date(authorized.expiresAt),
  };
  const envelope = {
    queryId: newUuidV7(),
    queryType: 'identity.resolve_policy',
    queryVersion: '1.0',
    scopeRef: scopeValue,
    requester: {
      kind: 'OBJECT',
      objectType: 'zhiju.identity.principal',
      objectId: context.row.principal_id,
      scope: scopeValue,
    },
    authenticationContextRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.identity.authentication_context',
      objectId: context.row.actor_snapshot_id,
      scope: scopeValue,
      contentHash: contentHash(context.authenticationContextHash.toString('hex')),
    },
    authorizationDecisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: AUTHORIZATION_DECISION_OBJECT_TYPE,
      objectId: authorized.authorizationDecisionRef.objectId,
      scope: scopeValue,
      contentHash: authorized.authorizationDecisionRef
        .contentHash as unknown as CanonicalJsonObject,
    },
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: context.row.authorization_decision_id,
    requestedAt: context.now().toISOString(),
    payload: { policyRef: context.policyRef },
  } as unknown as CanonicalJsonObject;
  let view: Awaited<ReturnType<typeof resolvePolicy>>;
  try {
    view = await resolvePolicy(
      { ...context.deps, context: resolveContext },
      {
        envelope,
        asOf: context.now(),
      },
    );
  } catch (error) {
    if (error instanceof SnapshotBoundaryError)
      entryError('DEPENDENCY_UNAVAILABLE', 'Board Policy resolution is unavailable');
    throw error;
  }
  if (view.useStatus !== 'USABLE')
    entryError(AUTHORIZATION_REVOKED, 'the Board Policy is not currently usable');
  if (
    view.policyRef.objectId !== context.policyRef.objectId ||
    view.policyRef.versionId !== context.policyRef.versionId ||
    view.scopeRef.enterpriseId !== context.row.enterprise_id ||
    view.scopeRef.projectId !== (context.row.project_id ?? undefined)
  )
    entryError('SCOPE_MISMATCH', 'the resolved Board Policy is not the configured one');
  const validated = validateTaskBoardPolicy({
    policySchemaRefs: view.policySchemaRefs,
    policyDocument: view.policyDocument,
  });
  if (!validated.valid)
    entryError('EXECUTION_CRITERION_UNSUPPORTED', 'the Board Policy profile is not supported');
  const policyRef = view.policyRef as unknown as CanonicalJsonObject;
  const policyVersionRef = view.policyVersionRef as unknown as CanonicalJsonObject;
  return {
    policyRef,
    policyVersionRef,
    policyContentHash: view.contentHash.digest,
    policyObservation: {
      policyRef,
      policyVersionRef,
      contentHash: view.contentHash.digest,
      effectiveFrom: view.effectiveFrom,
      ...(view.supersededAt === undefined ? {} : { supersededAt: view.supersededAt }),
    },
    rules: validated.rules,
  };
}
