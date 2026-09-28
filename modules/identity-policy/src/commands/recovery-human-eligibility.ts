import type { Common } from '@zhiju/contracts';
import {
  canonicalize,
  sha256CanonicalJson,
  type CanonicalJsonValue,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import {
  authorizationDecisionIntegrityHolds,
  policySnapshotIntegrityHolds,
} from '../persistence/identity-policy-repository.js';
import type { IdentityCommandDeps } from './actor-snapshot.js';

export interface RecoveryHumanEligibilityInput {
  readonly principalRef: Common.PrincipalRef;
  readonly scopeRef: Common.ScopeRef;
  readonly roleCode: 'project.customer_material.confirmer';
  readonly confirmationActorSnapshotRef?: Common.ObjectRef;
  readonly confirmationAuthorizationDecisionRef?: Common.ObjectRef;
  readonly confirmationTargetRef?: Common.ObjectRef;
  readonly confirmationRequestPayloadHash?: Common.ContentHash;
  readonly confirmationCommittedAt?: string;
}
export interface RecoveryHumanEligibilityAuthority {
  readonly now: () => Date;
  readonly validUntil: () => Date;
  /** Independently validates this internal read's exact payload/target/Purpose/session. */
  readonly revalidateAuthorization: () => Promise<void>;
  /** The trusted composition's current consumer actions, not a caller-selected grant. */
  readonly requiredCapabilities: readonly {
    readonly capabilityCode: string;
    readonly action: string;
    readonly targetObjectType: string;
  }[];
}
function unavailable(code = 'INVALID_PROVENANCE'): never {
  throw Object.assign(new Error(code), { code });
}
function same(a: unknown, b: unknown) {
  return canonicalize(a as CanonicalJsonValue) === canonicalize(b as CanonicalJsonValue);
}

/** Historical confirmation proof and current Human authority are separate observations. */
export async function readRecoveryHumanEligibility(
  deps: IdentityCommandDeps,
  input: RecoveryHumanEligibilityInput,
  authority: RecoveryHumanEligibilityAuthority,
) {
  await authority.revalidateAuthorization();
  const scope = input.scopeRef;
  if (
    input.principalRef.principalKind !== 'HUMAN' ||
    scope.enterpriseId !== deps.context.enterpriseId ||
    !deps.context.allowedProjectIds.includes(scope.projectId ?? '') ||
    !['project.customer_material.confirmer'].includes(input.roleCode) ||
    authority.requiredCapabilities.length === 0
  )
    unavailable('AUTHORIZATION_DECISION_INVALID');
  const result = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const now = authority.now();
    const principal = await deps.repo.getPrincipalById(trx, input.principalRef.principalId);
    if (principal?.principal_kind !== 'HUMAN' || principal.status !== 'ACTIVE')
      unavailable('AUTHORIZATION_DECISION_INVALID');
    if (deps.context.principalId === principal.id) {
      const actor = await trx
        .selectFrom('identity_policy.actor_snapshot')
        .selectAll()
        .where('actor_snapshot_id', '=', deps.context.actorSnapshotId)
        .executeTakeFirst();
      if (
        actor?.principal_kind !== 'HUMAN' ||
        actor.principal_id !== principal.id ||
        actor.acting_for_principal_id !== null
      )
        unavailable('AUTHORIZATION_DECISION_INVALID');
    }
    const roles = (
      await deps.repo.listActiveRoleAssignments(
        trx,
        principal.id,
        definedValue(scope.enterpriseId),
        now,
      )
    ).filter(
      (r) =>
        r.scope_kind === 'PROJECT' &&
        r.project_id === scope.projectId &&
        r.role_code === input.roleCode &&
        same(r.constraints, {}),
    );
    if (roles.length === 0) unavailable('AUTHORIZATION_DECISION_INVALID');
    const grants = (
      await deps.repo.listActiveCapabilityGrants(
        trx,
        principal.id,
        definedValue(scope.enterpriseId),
        now,
      )
    ).filter(
      (g) =>
        g.scope_kind === 'PROJECT' &&
        g.project_id === scope.projectId &&
        authority.requiredCapabilities.some(
          (binding) =>
            binding.capabilityCode === g.capability_code &&
            g.actions.includes(binding.action) &&
            g.max_uses === null &&
            same(g.constraints, {}) &&
            Array.isArray(g.resource_selectors) &&
            g.resource_selectors.some((selector) => {
              const s = selector as Record<string, unknown>;
              return s.selectorType === 'TARGET_TYPE' && s.objectType === binding.targetObjectType;
            }),
        ),
    );
    if (
      !authority.requiredCapabilities.every((binding) =>
        grants.some((g) => g.capability_code === binding.capabilityCode),
      )
    )
      unavailable('AUTHORIZATION_DECISION_INVALID');
    const expiries = [
      authority.validUntil().getTime(),
      ...roles.map((r) => r.valid_to?.getTime() ?? Infinity),
    ];
    for (const grant of grants) {
      const policy = await trx
        .selectFrom('identity_policy.policy_snapshot')
        .selectAll()
        .where('policy_snapshot_id', '=', grant.grant_policy_snapshot_id)
        .executeTakeFirst();
      if (
        !policy ||
        !policySnapshotIntegrityHolds(policy) ||
        !policy.payload_hash.equals(grant.grant_policy_snapshot_hash) ||
        policy.effective_from > now ||
        (policy.superseded_at !== null &&
          policy.superseded_at !== undefined &&
          policy.superseded_at <= now)
      )
        unavailable('AUTHORIZATION_DECISION_INVALID');
      expiries.push(
        grant.valid_to?.getTime() ?? Infinity,
        policy.superseded_at?.getTime() ?? Infinity,
      );
    }
    const history = [
      input.confirmationActorSnapshotRef,
      input.confirmationAuthorizationDecisionRef,
      input.confirmationTargetRef,
      input.confirmationRequestPayloadHash,
      input.confirmationCommittedAt,
    ];
    let confirmationProvenanceValid = false;
    if (history.some((v) => v !== undefined)) {
      if (history.some((v) => v === undefined)) unavailable();
      const decisionRef = definedValue(input.confirmationAuthorizationDecisionRef);
      const actorRef = definedValue(input.confirmationActorSnapshotRef);
      if (
        !hasReferenceKind(decisionRef, 'OBJECT') ||
        decisionRef.objectType !== 'zhiju.identity.authorization_decision' ||
        !hasReferenceKind(actorRef, 'OBJECT') ||
        actorRef.objectType !== 'zhiju.identity.actor_snapshot' ||
        !same(decisionRef.scope, scope) ||
        !same(actorRef.scope, scope)
      )
        unavailable();
      const decision = await trx
        .selectFrom('identity_policy.authorization_decision')
        .selectAll()
        .where('authorization_decision_id', '=', decisionRef.objectId)
        .executeTakeFirst();
      if (!decision || !authorizationDecisionIntegrityHolds(decision)) unavailable();
      const actor = await deps.repo.getActorSnapshotByIdAndHash(
        trx,
        decision.actor_snapshot_id,
        decision.actor_snapshot_payload_hash,
      );
      const committedAt = Date.parse(definedValue(input.confirmationCommittedAt));
      const payload = decision.canonical_payload as CanonicalJsonObject;
      const issuedAt =
        payload.requestedAt === undefined
          ? decision.created_at.getTime()
          : typeof payload.requestedAt === 'string'
            ? Date.parse(payload.requestedAt)
            : NaN;
      if (
        !actor ||
        !actor.hashMatched ||
        sha256CanonicalJson(actor.row.canonical_payload as CanonicalJsonObject) !==
          actor.row.payload_hash.toString('hex') ||
        actor.row.actor_snapshot_id !== actorRef.objectId ||
        actor.row.principal_id !== principal.id ||
        actor.row.principal_kind !== 'HUMAN' ||
        actor.row.acting_for_principal_id !== null ||
        actor.row.enterprise_id !== scope.enterpriseId ||
        actor.row.project_id !== scope.projectId ||
        !actor.row.authentication_context_hash.equals(decision.authentication_context_hash) ||
        decision.outcome !== 'ALLOW' ||
        decision.principal_id !== principal.id ||
        decision.principal_kind !== 'HUMAN' ||
        decision.command_type !== 'project.confirm_customer_material' ||
        decision.command_version !== '1.0' ||
        decision.purpose !== 'enterprise.project.confirm_customer_material' ||
        decision.scope_kind !== 'PROJECT' ||
        decision.enterprise_id !== scope.enterpriseId ||
        decision.project_id !== scope.projectId ||
        !same(payload.targetRef, input.confirmationTargetRef) ||
        decision.command_payload_hash.toString('hex') !==
          definedValue(input.confirmationRequestPayloadHash).digest ||
        !Number.isFinite(committedAt) ||
        !Number.isFinite(issuedAt) ||
        committedAt < issuedAt ||
        committedAt >= decision.expires_at.getTime()
      )
        unavailable();
      confirmationProvenanceValid = true;
    }
    const validUntil = Math.min(...expiries);
    if (!Number.isFinite(validUntil) || validUntil <= now.getTime())
      unavailable('AUTHORIZATION_DECISION_INVALID');
    const ref = (objectType: string, objectId: string) => ({
      kind: 'OBJECT' as const,
      objectType,
      objectId,
      scope,
    });
    return {
      principalRef: input.principalRef,
      roleCode: input.roleCode,
      roleAssignmentRef: ref('identity.role_assignment', definedValue(roles[0]).id),
      grantRefs: grants
        .map((g) => ref('identity.capability_grant', g.id))
        .sort((a, b) => a.objectId.localeCompare(b.objectId)),
      checkedAt: now.toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      confirmationProvenanceValid,
      useStatus: 'USABLE' as const,
    };
  });
  await authority.revalidateAuthorization();
  return result;
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}

function hasReferenceKind(value: unknown, kind: string): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === kind
  );
}
