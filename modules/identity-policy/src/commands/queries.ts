// IM-02 WI-09 (issue #37): the four access/policy queries. Together with
// WI-07's resolve_principal these cover all six public IdentityPolicy
// queries. Each access check goes through the unique Decision Port, so an
// immutable AuthorizationDecision exists for every outcome (ALLOW or DENY).

import { newUuidV7 } from '@zhiju/shared-kernel';
import type { CanonicalJson, Common } from '@zhiju/contracts';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import {
  authorizeCommand,
  createActorSnapshot,
  assertSnapshotReference,
  SnapshotBoundaryError,
  type AuthorizationDecisionView,
  type IdentityCommandDeps,
} from './actor-snapshot.js';
import { policySchemaReference } from './static-registry.js';

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
  policySnapshotRef: Common.SnapshotRef;
}

export interface AccessDecision {
  outcome: 'ALLOW' | 'DENY';
  authorizationDecisionRef: AuthorizationDecisionView['authorizationDecisionRef'];
  reasons: string[];
  effectiveRoles: Common.ObjectRef[];
  effectiveCapabilities: Common.ObjectRef[];
  expiresAt: Common.UtcInstant;
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
    scopeKind: input.scopeKind,
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
        .filter(
          (r) =>
            r.scope_kind === input.scopeKind &&
            r.enterprise_id === input.enterpriseId &&
            r.project_id === (input.projectId ?? null),
        )
        .map((r) =>
          objectReference(
            'identity.role_assignment',
            r.id,
            r.scope_kind,
            r.enterprise_id,
            r.project_id,
          ),
        ),
      grants: grants
        .filter(
          (g) =>
            g.scope_kind === input.scopeKind &&
            g.enterprise_id === input.enterpriseId &&
            g.project_id === (input.projectId ?? null),
        )
        .map((g) =>
          objectReference(
            'identity.capability_grant',
            g.id,
            g.scope_kind,
            g.enterprise_id,
            g.project_id,
          ),
        ),
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
  policySnapshotRef: Common.SnapshotRef;
  policySetVersion: string;
  policySchemaRefs: Common.TypedReference[];
  effectiveFrom: Common.UtcInstant;
  supersededAt?: Common.UtcInstant | undefined;
  payload: unknown;
}

/**
 * identity.get_policy_snapshot@1.0: exact id+hash resolution only — there is
 * deliberately no current/latest path.
 */
export async function getPolicySnapshot(
  deps: IdentityCommandDeps,
  ref: Common.SnapshotRef,
): Promise<PolicySnapshotView> {
  assertSnapshotReference(
    ref,
    'identity.policy_snapshot',
    IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
    'policy snapshot',
  );
  if (Object.keys(ref.scope).length !== 0) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
      'policy snapshot scope must be empty',
    );
  }
  const resolved = await withIdentityTransaction(deps.db, deps.context, async (trx) =>
    deps.repo.getPolicySnapshotByIdAndHash(
      trx,
      ref.snapshotId,
      contentHashToBuffer(ref.contentHash),
    ),
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
  const storedSchemaRefs = Array.isArray(row.policy_schema_refs) ? row.policy_schema_refs : [];
  const policySchemaRefs = storedSchemaRefs.map((schemaRef) => {
    if (typeof schemaRef !== 'string') {
      throw new SnapshotBoundaryError(
        IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
        'policy snapshot schema reference is invalid',
      );
    }
    const typedRef = policySchemaReference(schemaRef);
    if (!typedRef) {
      throw new SnapshotBoundaryError(
        IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
        'policy snapshot schema reference is not resolvable',
      );
    }
    return typedRef;
  });
  return {
    policySnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: row.policy_snapshot_id,
      snapshotId: row.policy_snapshot_id,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: row.payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    },
    policySetVersion: row.policy_set_version,
    policySchemaRefs,
    effectiveFrom: row.effective_from.toISOString(),
    ...(row.superseded_at === null || row.superseded_at === undefined
      ? {}
      : { supersededAt: row.superseded_at.toISOString() }),
    payload: row.canonical_payload as CanonicalJson,
  };
}

function objectReference(
  objectType: string,
  objectId: string,
  scopeKind: 'ENTERPRISE' | 'PROJECT',
  enterpriseId: string,
  projectId: string | null,
): Common.ObjectRef {
  const scope =
    scopeKind === 'PROJECT' && projectId !== null ? { enterpriseId, projectId } : { enterpriseId };
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope,
  };
}

function contentHashToBuffer(value: Common.ContentHash): Buffer {
  const candidate: { algorithm: string; canonicalizationVersion: string; digest: string } = value;
  if (
    candidate.algorithm !== 'SHA-256' ||
    candidate.canonicalizationVersion !== '1' ||
    !/^[0-9a-f]{64}$/.test(candidate.digest)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
      'policy snapshot hash must be a SHA-256 digest',
    );
  }
  return Buffer.from(candidate.digest, 'hex');
}
