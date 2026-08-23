// IM-02 WI-09 (issue #37): the four access/policy queries. Together with
// WI-07's resolve_principal these cover all six public IdentityPolicy
// queries. Each access check goes through the unique Decision Port, so an
// immutable AuthorizationDecision exists for every outcome (ALLOW or DENY).

import { newUuidV7 } from '@zhiju/shared-kernel';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import {
  authorizeCommand,
  createActorSnapshot,
  SnapshotBoundaryError,
  type AuthorizationDecisionView,
  type IdentityCommandDeps,
} from './actor-snapshot.js';

export const IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH = 'IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH';
export const IDENTITY_POLICY_SNAPSHOT_NOT_FOUND = 'IDENTITY_POLICY_SNAPSHOT_NOT_FOUND';

export interface AccessCheckInput {
  principalId: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
  /** NamespaceCode action treated as the requested capability. */
  action: string;
  purpose: string;
  asOf: Date;
  authenticationContextHash: Buffer;
  policySnapshotRef: { snapshotType: 'PolicySnapshot'; snapshotId: string; payloadHash: Buffer };
}

export interface AccessDecision {
  outcome: 'ALLOW' | 'DENY';
  authorizationDecisionRef: AuthorizationDecisionView['authorizationDecisionRef'];
  reasons: string[];
  effectiveRoles: { objectType: 'RoleAssignment'; objectId: string }[];
  effectiveCapabilities: { objectType: 'CapabilityGrant'; objectId: string }[];
  expiresAt: Date;
}

async function evaluateAccess(
  deps: IdentityCommandDeps,
  input: AccessCheckInput,
): Promise<AccessDecision> {
  // Controlled actor snapshot for the queried principal, created inside the
  // same enterprise scope; the decision binds to it exactly.
  const actorSnapshotRef = await createActorSnapshot(deps, {
    actorSnapshotId: newUuidV7(),
    principalId: input.principalId,
    declaredPrincipalKind: await authoritativeKind(deps, input.principalId),
    authenticationContextHash: input.authenticationContextHash,
    enterpriseId: input.enterpriseId,
    projectId: input.projectId,
  });
  const decision = await authorizeCommand(deps, {
    actorSnapshotRef,
    intent: {
      commandType: 'identity.access.check',
      commandVersion: '1.0',
      scopeKind: input.scopeKind,
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      purpose: input.purpose,
      requestedCapability: input.action,
      commandPayloadHash: input.authenticationContextHash,
      requestedAt: input.asOf,
      highRiskAction: false,
    },
    authenticationContextHash: input.authenticationContextHash,
    policySnapshotRef: input.policySnapshotRef,
  });
  const lists = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const roles = await deps.repo.listActiveRoleAssignments(
      trx,
      input.principalId,
      input.enterpriseId,
      input.asOf,
    );
    const grants = await deps.repo.listActiveCapabilityGrants(
      trx,
      input.principalId,
      input.enterpriseId,
      input.asOf,
    );
    return {
      roles: roles
        .filter((r) => r.scope_kind === 'ENTERPRISE' || r.project_id === (input.projectId ?? null))
        .map((r) => ({ objectType: 'RoleAssignment' as const, objectId: r.id })),
      grants: grants
        .filter((g) => g.scope_kind === 'ENTERPRISE' || g.project_id === (input.projectId ?? null))
        .map((g) => ({ objectType: 'CapabilityGrant' as const, objectId: g.id })),
    };
  });
  return {
    outcome: decision.outcome,
    authorizationDecisionRef: decision.authorizationDecisionRef,
    reasons: decision.reasons,
    effectiveRoles: lists.roles,
    effectiveCapabilities: lists.grants,
    expiresAt: decision.expiresAt,
  };
}

async function authoritativeKind(deps: IdentityCommandDeps, principalId: string) {
  const principal = await withIdentityTransaction(deps.db, deps.context, async (trx) =>
    deps.repo.getPrincipalById(trx, principalId),
  );
  if (!principal) {
    throw new SnapshotBoundaryError('IDENTITY_PRINCIPAL_NOT_FOUND', 'principal does not resolve');
  }
  return principal.principal_kind;
}

/** identity.check_enterprise_access@1.0 (projectRef must be absent). */
export async function checkEnterpriseAccess(deps: IdentityCommandDeps, input: AccessCheckInput) {
  if (input.scopeKind !== 'ENTERPRISE' || input.projectId !== undefined) {
    throw new SnapshotBoundaryError(
      'IDENTITY_INPUT_INVALID',
      'enterprise check requires scopeKind ENTERPRISE without project',
    );
  }
  return evaluateAccess(deps, input);
}

/** identity.check_project_access@1.0 (projectRef required). */
export async function checkProjectAccess(deps: IdentityCommandDeps, input: AccessCheckInput) {
  if (input.scopeKind !== 'PROJECT' || input.projectId === undefined) {
    throw new SnapshotBoundaryError(
      'IDENTITY_INPUT_INVALID',
      'project check requires scopeKind PROJECT with project',
    );
  }
  return evaluateAccess(deps, input);
}

/**
 * identity.check_human_only_capability@1.0. Non-HUMAN principals get a
 * fixed, saved, auditable DENY (the actor kind is never upgraded); HUMAN
 * principals are evaluated against their grants.
 */
export async function checkHumanOnlyCapability(
  deps: IdentityCommandDeps,
  input: Omit<AccessCheckInput, 'action'> & { capabilityCode: string },
) {
  return evaluateAccess(deps, { ...input, action: input.capabilityCode });
}

export interface PolicySnapshotView {
  policySnapshotRef: { snapshotType: 'PolicySnapshot'; snapshotId: string; payloadHash: Buffer };
  policySetVersion: string;
  policySchemaRefs: string[];
  effectiveFrom: Date;
  supersededAt?: Date | undefined;
  payload: unknown;
}

/**
 * identity.get_policy_snapshot@1.0: exact id+hash resolution only — there is
 * deliberately no current/latest path.
 */
export async function getPolicySnapshot(
  deps: IdentityCommandDeps,
  ref: { snapshotId: string; payloadHash: Buffer },
): Promise<PolicySnapshotView> {
  const resolved = await withIdentityTransaction(deps.db, deps.context, async (trx) =>
    deps.repo.getPolicySnapshotByIdAndHash(trx, ref.snapshotId, ref.payloadHash),
  );
  if (!resolved) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
      'policy snapshot not found',
    );
  }
  if (!resolved.hashMatched) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
      'policy snapshot hash mismatch; exact ref required',
    );
  }
  const row = resolved.row;
  if (!row) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
      'policy snapshot not found',
    );
  }
  return {
    policySnapshotRef: {
      snapshotType: 'PolicySnapshot',
      snapshotId: row.policy_snapshot_id,
      payloadHash: row.payload_hash,
    },
    policySetVersion: row.policy_set_version,
    policySchemaRefs: Array.isArray(row.policy_schema_refs)
      ? (row.policy_schema_refs as string[])
      : [],
    effectiveFrom: row.effective_from,
    supersededAt: row.superseded_at ?? undefined,
    payload: row.canonical_payload,
  };
}
