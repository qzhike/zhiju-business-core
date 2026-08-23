// IM-02 WI-08 (issue #36): identity.assign_role / revoke_role /
// grant_capability / revoke_capability / record_policy_snapshot@1.0 command
// handlers, plus the audited first-role bootstrap that permanently closes
// the bootstrap claim. Static registries decide Human-only capabilities and
// policy schema resolvability (PG-022); revocations append immutable facts
// and never rewrite history; public events never carry constraint bodies,
// capability tokens, external ids or contact channels.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import type { IdentityPolicyDb } from '../persistence/identity-db.js';
import { executeIdentityCommand, type CommandResult } from '../persistence/command-runner.js';
import type { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';
import type { IdentityTransactionContext } from '../persistence/identity-db.js';
import {
  HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
  isHumanOnlyCapability,
  isResolvablePolicySchemaRef,
  POLICY_SCHEMA_REGISTRY_VERSION,
} from './static-registry.js';

export const IDENTITY_ROLE_SCOPE_INVALID = 'IDENTITY_ROLE_SCOPE_INVALID';
export const IDENTITY_ROLE_ALREADY_ACTIVE = 'IDENTITY_ROLE_ALREADY_ACTIVE';
export const IDENTITY_ROLE_NOT_ACTIVE = 'IDENTITY_ROLE_NOT_ACTIVE';
export const IDENTITY_CAPABILITY_HUMAN_ONLY = 'IDENTITY_CAPABILITY_HUMAN_ONLY';
export const IDENTITY_CAPABILITY_SCOPE_INVALID = 'IDENTITY_CAPABILITY_SCOPE_INVALID';
export const IDENTITY_CAPABILITY_ALREADY_ACTIVE = 'IDENTITY_CAPABILITY_ALREADY_ACTIVE';
export const IDENTITY_CAPABILITY_NOT_ACTIVE = 'IDENTITY_CAPABILITY_NOT_ACTIVE';
export const IDENTITY_POLICY_SNAPSHOT_INVALID = 'IDENTITY_POLICY_SNAPSHOT_INVALID';
export const IDENTITY_POLICY_VERSION_UNKNOWN = 'IDENTITY_POLICY_VERSION_UNKNOWN';
export const IDENTITY_PRINCIPAL_NOT_ACTIVE = 'IDENTITY_PRINCIPAL_NOT_ACTIVE';
export const IDENTITY_BOOTSTRAP_ROLE_INVALID = 'IDENTITY_BOOTSTRAP_ROLE_INVALID';

export interface IdentityCommandDeps {
  readonly db: Kysely<IdentityPolicyDb>;
  readonly repo: IdentityPolicyRepository;
  readonly crypto: IdentityCryptoPorts;
  readonly context: IdentityTransactionContext;
}

export interface ScopedRef {
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
}

function validateScope(
  scope: ScopedRef,
  context: IdentityTransactionContext,
  roleCode: string,
): string | null {
  if (scope.enterpriseId !== context.enterpriseId) {
    return IDENTITY_ROLE_SCOPE_INVALID;
  }
  if (scope.scopeKind === 'PROJECT') {
    if (scope.projectId === undefined) {
      return IDENTITY_ROLE_SCOPE_INVALID;
    }
    if (!context.allowedProjectIds.includes(scope.projectId)) {
      return IDENTITY_ROLE_SCOPE_INVALID;
    }
  } else if (scope.projectId !== undefined) {
    return IDENTITY_ROLE_SCOPE_INVALID;
  }
  void roleCode;
  return null;
}

function validatePeriod(validFrom: Date, validTo?: Date): string | null {
  if (validTo !== undefined && validTo <= validFrom) {
    return IDENTITY_POLICY_SNAPSHOT_INVALID;
  }
  return null;
}

export interface AssignRoleInput {
  assignmentId: string;
  principalId: string;
  roleCode: string;
  scope: ScopedRef;
  validFrom: Date;
  validTo?: Date | undefined;
  justification: string;
  idempotencyKey: string;
}

export async function assignRole(
  deps: IdentityCommandDeps,
  input: AssignRoleInput,
): Promise<CommandResult> {
  const scopeError = validateScope(input.scope, deps.context, input.roleCode);
  if (scopeError !== null && scopeError === IDENTITY_ROLE_SCOPE_INVALID) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      safeSummary: 'scope invalid for role assignment',
    };
  }
  if (validatePeriod(input.validFrom, input.validTo) !== null) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      safeSummary: 'effective period invalid',
    };
  }
  if (!input.justification.trim()) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_ROLE_SCOPE_INVALID,
      safeSummary: 'justification required',
    };
  }

  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.assign_role',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:assign_role',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        principalRef: { objectType: 'Principal', objectId: input.principalId },
        roleCode: input.roleCode,
        scopeKind: input.scope.scopeKind,
        enterpriseId: input.scope.enterpriseId,
        ...(input.scope.projectId !== undefined ? { projectId: input.scope.projectId } : {}),
        justification: input.justification,
      },
      platform: false,
      enterpriseId: input.scope.enterpriseId,
      projectId: input.scope.projectId ?? undefined,
      targetType: 'RoleAssignment',
      targetId: input.assignmentId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      const principal = await deps.repo.getPrincipalById(execution.trx, input.principalId);
      if (principal?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_NOT_ACTIVE,
          safeSummary: 'principal not active',
        };
      }
      const active = await deps.repo.listActiveRoleAssignments(
        execution.trx,
        input.principalId,
        input.scope.enterpriseId,
        new Date(),
      );
      if (
        active.some(
          (row) =>
            row.role_code === input.roleCode &&
            row.scope_kind === input.scope.scopeKind &&
            row.project_id === (input.scope.projectId ?? null),
        )
      ) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_ROLE_ALREADY_ACTIVE,
          safeSummary: 'active assignment exists',
        };
      }
      await deps.repo.insertRoleAssignment(execution.trx, {
        id: input.assignmentId,
        principalId: input.principalId,
        code: input.roleCode,
        scopeKind: input.scope.scopeKind,
        enterpriseId: input.scope.enterpriseId,
        projectId: input.scope.projectId,
        validFrom: input.validFrom,
        validTo: input.validTo,
        justification: input.justification,
        createdByPrincipalId: deps.context.principalId,
        createdByActorSnapshotId: deps.context.actorSnapshotId,
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.RoleAssigned',
        eventVersion: '1.0',
        aggregateType: 'RoleAssignment',
        aggregateId: input.assignmentId,
        aggregateVersion: '1',
        payload: {
          enterpriseId: input.scope.enterpriseId,
          ...(input.scope.projectId !== undefined ? { projectId: input.scope.projectId } : {}),
          roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.assignmentId },
          principalRef: { objectType: 'Principal', objectId: input.principalId },
          roleCode: input.roleCode,
          assignedScopeRef: {
            scopeKind: input.scope.scopeKind,
            enterpriseRef: { objectType: 'Enterprise', objectId: input.scope.enterpriseId },
            ...(input.scope.projectId !== undefined
              ? { projectRef: { objectType: 'Project', objectId: input.scope.projectId } }
              : {}),
          },
          effectivePeriod: {
            from: input.validFrom.toISOString(),
            ...(input.validTo !== undefined ? { to: input.validTo.toISOString() } : {}),
          },
        },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.assignmentId },
        },
      };
    },
  );
}

export interface RevokeScopedInput {
  targetId: string;
  expectedAggregateVersion: string;
  revokedByPrincipalId: string;
  reasonCode: string;
  effectiveAt: Date;
  idempotencyKey: string;
}

export async function revokeRole(
  deps: IdentityCommandDeps,
  input: RevokeScopedInput,
): Promise<CommandResult> {
  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.revoke_role',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:revoke_role',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        targetRef: { objectType: 'RoleAssignment', objectId: input.targetId },
        expectedAggregateVersion: input.expectedAggregateVersion,
        reasonCode: input.reasonCode,
      },
      platform: false,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'RoleAssignment',
      targetId: input.targetId,
      expectedAggregateVersion: input.expectedAggregateVersion,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      const assignment = await deps.repo.getRoleAssignmentById(execution.trx, input.targetId);
      if (!assignment) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_ROLE_NOT_ACTIVE,
          safeSummary: 'assignment not found',
        };
      }
      if (assignment.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_ROLE_NOT_ACTIVE,
          safeSummary: 'assignment not active',
        };
      }
      const cas = await execution.casScopedAssignmentStatus(
        'role_assignment',
        input.targetId,
        input.expectedAggregateVersion,
        {
          status: 'REVOKED',
        },
      );
      if (cas === 'CONFLICT') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_ROLE_NOT_ACTIVE,
          safeSummary: 'expected version mismatch',
        };
      }
      if (cas === 'NOT_FOUND') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_ROLE_NOT_ACTIVE,
          safeSummary: 'assignment not visible',
        };
      }
      await deps.repo.insertRoleRevocation(execution.trx, {
        revocationId: newUuidV7(),
        targetId: input.targetId,
        enterpriseId: deps.context.enterpriseId,
        revokedByPrincipalId: input.revokedByPrincipalId,
        reasonCode: input.reasonCode,
        effectiveAt: input.effectiveAt,
        actorSnapshotId: deps.context.actorSnapshotId,
        sourceCommandId: commandId,
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.RoleRevoked',
        eventVersion: '1.0',
        aggregateType: 'RoleAssignment',
        aggregateId: input.targetId,
        aggregateVersion: String(Number(input.expectedAggregateVersion) + 1),
        payload: {
          enterpriseId: deps.context.enterpriseId,
          roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.targetId },
          principalRef: { objectType: 'Principal', objectId: assignment.principal_id },
          revokedAt: input.effectiveAt.toISOString(),
          reasonCode: input.reasonCode,
        },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.targetId },
          status: 'REVOKED',
        },
      };
    },
  );
}

export interface GrantCapabilityInput {
  grantId: string;
  principalId: string;
  capabilityCode: string;
  scope: ScopedRef;
  resourceSelectors: CanonicalJsonObject[];
  actions: string[];
  validFrom: Date;
  validTo?: Date | undefined;
  maxUses?: number | undefined;
  grantPolicySnapshotId: string;
  grantPolicySnapshotHash: Buffer;
  justification: string;
  idempotencyKey: string;
}

export async function grantCapability(
  deps: IdentityCommandDeps,
  input: GrantCapabilityInput,
): Promise<CommandResult> {
  if (validateScope(input.scope, deps.context, input.capabilityCode) !== null) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_CAPABILITY_SCOPE_INVALID,
      safeSummary: 'scope invalid for capability grant',
    };
  }
  if (validatePeriod(input.validFrom, input.validTo) !== null) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_CAPABILITY_SCOPE_INVALID,
      safeSummary: 'effective period invalid',
    };
  }
  if (!input.justification.trim()) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_CAPABILITY_SCOPE_INVALID,
      safeSummary: 'justification required',
    };
  }

  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.grant_capability',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:grant_capability',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        principalRef: { objectType: 'Principal', objectId: input.principalId },
        capabilityCode: input.capabilityCode,
        scopeKind: input.scope.scopeKind,
        enterpriseId: input.scope.enterpriseId,
        ...(input.scope.projectId !== undefined ? { projectId: input.scope.projectId } : {}),
        grantPolicySnapshotRef: {
          snapshotType: 'PolicySnapshot',
          snapshotId: input.grantPolicySnapshotId,
          payloadHashDigest: input.grantPolicySnapshotHash.toString('hex'),
        },
      },
      platform: false,
      enterpriseId: input.scope.enterpriseId,
      projectId: input.scope.projectId ?? undefined,
      targetType: 'CapabilityGrant',
      targetId: input.grantId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      // The principal table is the only authority for the actor kind:
      // actingFor can never upgrade an AGENT/RUNTIME to HUMAN here.
      const principal = await deps.repo.getPrincipalById(execution.trx, input.principalId);
      if (principal?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_NOT_ACTIVE,
          safeSummary: 'principal not active',
        };
      }
      if (isHumanOnlyCapability(input.capabilityCode) && principal.principal_kind !== 'HUMAN') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_CAPABILITY_HUMAN_ONLY,
          safeSummary: `capability is human-only (registry ${HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION}); principal kind stays ${principal.principal_kind}`,
        };
      }
      const policy = await deps.repo.getPolicySnapshotByIdAndHash(
        execution.trx,
        input.grantPolicySnapshotId,
        input.grantPolicySnapshotHash,
      );
      if (!policy?.hashMatched) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
          safeSummary: 'grant policy snapshot not resolvable by exact ref',
        };
      }
      const active = await deps.repo.listActiveCapabilityGrants(
        execution.trx,
        input.principalId,
        input.scope.enterpriseId,
        new Date(),
      );
      if (
        active.some(
          (row) =>
            row.capability_code === input.capabilityCode &&
            row.scope_kind === input.scope.scopeKind &&
            row.project_id === (input.scope.projectId ?? null),
        )
      ) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_CAPABILITY_ALREADY_ACTIVE,
          safeSummary: 'active grant exists',
        };
      }
      await deps.repo.insertCapabilityGrant(execution.trx, {
        id: input.grantId,
        principalId: input.principalId,
        code: input.capabilityCode,
        scopeKind: input.scope.scopeKind,
        enterpriseId: input.scope.enterpriseId,
        projectId: input.scope.projectId,
        resourceSelectors: input.resourceSelectors,
        actions: input.actions,
        validFrom: input.validFrom,
        validTo: input.validTo,
        maxUses: input.maxUses,
        grantPolicySnapshotId: input.grantPolicySnapshotId,
        grantPolicySnapshotHash: input.grantPolicySnapshotHash,
        justification: input.justification,
        createdByPrincipalId: deps.context.principalId,
        createdByActorSnapshotId: deps.context.actorSnapshotId,
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.CapabilityGranted',
        eventVersion: '1.0',
        aggregateType: 'CapabilityGrant',
        aggregateId: input.grantId,
        aggregateVersion: '1',
        payload: {
          enterpriseId: input.scope.enterpriseId,
          ...(input.scope.projectId !== undefined ? { projectId: input.scope.projectId } : {}),
          capabilityGrantRef: { objectType: 'CapabilityGrant', objectId: input.grantId },
          principalRef: { objectType: 'Principal', objectId: input.principalId },
          capabilityCode: input.capabilityCode,
          grantedScopeRef: {
            scopeKind: input.scope.scopeKind,
            enterpriseRef: { objectType: 'Enterprise', objectId: input.scope.enterpriseId },
            ...(input.scope.projectId !== undefined
              ? { projectRef: { objectType: 'Project', objectId: input.scope.projectId } }
              : {}),
          },
          effectivePeriod: {
            from: input.validFrom.toISOString(),
            ...(input.validTo !== undefined ? { to: input.validTo.toISOString() } : {}),
          },
        },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          capabilityGrantRef: { objectType: 'CapabilityGrant', objectId: input.grantId },
        },
      };
    },
  );
}

export async function revokeCapability(
  deps: IdentityCommandDeps,
  input: RevokeScopedInput,
): Promise<CommandResult> {
  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.revoke_capability',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:revoke_capability',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        targetRef: { objectType: 'CapabilityGrant', objectId: input.targetId },
        expectedAggregateVersion: input.expectedAggregateVersion,
        reasonCode: input.reasonCode,
      },
      platform: false,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'CapabilityGrant',
      targetId: input.targetId,
      expectedAggregateVersion: input.expectedAggregateVersion,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      const grant = await deps.repo.getCapabilityGrantById(execution.trx, input.targetId);
      if (grant?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_CAPABILITY_NOT_ACTIVE,
          safeSummary: 'grant not active',
        };
      }
      const cas = await execution.casScopedAssignmentStatus(
        'capability_grant',
        input.targetId,
        input.expectedAggregateVersion,
        {
          status: 'REVOKED',
        },
      );
      if (cas !== 'OK') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_CAPABILITY_NOT_ACTIVE,
          safeSummary: `cas outcome ${cas}`,
        };
      }
      await deps.repo.insertCapabilityRevocation(execution.trx, {
        revocationId: newUuidV7(),
        targetId: input.targetId,
        enterpriseId: deps.context.enterpriseId,
        revokedByPrincipalId: input.revokedByPrincipalId,
        reasonCode: input.reasonCode,
        effectiveAt: input.effectiveAt,
        actorSnapshotId: deps.context.actorSnapshotId,
        sourceCommandId: commandId,
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.CapabilityRevoked',
        eventVersion: '1.0',
        aggregateType: 'CapabilityGrant',
        aggregateId: input.targetId,
        aggregateVersion: String(Number(input.expectedAggregateVersion) + 1),
        payload: {
          enterpriseId: deps.context.enterpriseId,
          capabilityGrantRef: { objectType: 'CapabilityGrant', objectId: input.targetId },
          principalRef: { objectType: 'Principal', objectId: grant.principal_id },
          revokedAt: input.effectiveAt.toISOString(),
          reasonCode: input.reasonCode,
        },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          capabilityGrantRef: { objectType: 'CapabilityGrant', objectId: input.targetId },
          status: 'REVOKED',
        },
      };
    },
  );
}

export interface RecordPolicySnapshotInput {
  policySnapshotId: string;
  policySetVersion: string;
  policySchemaRefs: string[];
  effectiveFrom: Date;
  policyDocument: CanonicalJsonObject;
  idempotencyKey: string;
}

export async function recordPolicySnapshot(
  deps: IdentityCommandDeps,
  input: RecordPolicySnapshotInput,
): Promise<CommandResult> {
  for (const ref of input.policySchemaRefs) {
    if (!isResolvablePolicySchemaRef(ref)) {
      return {
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
        safeSummary: `schema ref not resolvable by static registry ${POLICY_SCHEMA_REGISTRY_VERSION}`,
      };
    }
  }
  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.record_policy_snapshot',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:record_policy_snapshot',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        policySetVersion: input.policySetVersion,
        policySchemaRefs: input.policySchemaRefs,
        effectiveFrom: input.effectiveFrom.toISOString(),
      },
      platform: true,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'PolicySnapshot',
      targetId: input.policySnapshotId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      // Snapshot identity is the exact policy_set_version: no latest/current
      // replacement path exists.
      const existing = await deps.repo.getPolicySnapshotById(execution.trx, input.policySnapshotId);
      if (existing) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID,
          safeSummary: 'snapshot id already recorded',
        };
      }
      const byVersion = await execution.trx
        .selectFrom('identity_policy.policy_snapshot')
        .select('policy_snapshot_id')
        .where('policy_set_version', '=', input.policySetVersion)
        .executeTakeFirst();
      if (byVersion) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID,
          safeSummary: 'policy set version already recorded',
        };
      }
      await deps.repo.insertPolicySnapshot(execution.trx, {
        policySnapshotId: input.policySnapshotId,
        policySetVersion: input.policySetVersion,
        policySchemaRefs: input.policySchemaRefs,
        effectiveFrom: input.effectiveFrom,
        contractVersion: '1.0',
        schemaRegistryVersion: POLICY_SCHEMA_REGISTRY_VERSION,
        policyDocument: input.policyDocument,
        createdByPrincipalId: deps.context.principalId,
        actorSnapshotId: deps.context.actorSnapshotId,
        sourceCommandId: commandId,
        dataClassification: 'INTERNAL',
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.PolicySnapshotRecorded',
        eventVersion: '1.0',
        aggregateType: 'PolicySnapshot',
        aggregateId: input.policySnapshotId,
        aggregateVersion: '1',
        payload: {
          policySnapshotRef: { snapshotType: 'PolicySnapshot', snapshotId: input.policySnapshotId },
          policySetVersion: input.policySetVersion,
          effectiveFrom: input.effectiveFrom.toISOString(),
        },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          policySnapshotRef: { snapshotType: 'PolicySnapshot', snapshotId: input.policySnapshotId },
          schemaRegistryVersion: POLICY_SCHEMA_REGISTRY_VERSION,
        },
      };
    },
  );
}

export interface BootstrapRoleInput {
  /** Claim purpose FIRST_ADMIN_ROLE; consumed and closed atomically. */
  bootstrapClaimId: string;
  assignmentId: string;
  principalId: string;
  roleCode: string;
  justification: string;
  idempotencyKey: string;
}

/**
 * Audited first-role bootstrap: assigns the minimal admin role to the first
 * business principal and permanently closes the bootstrap claim in the same
 * transaction. Afterwards authorization only flows through the ordinary
 * assign_role command.
 */
export async function bootstrapMinimalAdminRole(
  deps: IdentityCommandDeps,
  input: BootstrapRoleInput,
): Promise<CommandResult> {
  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.internal.bootstrap_role',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:bootstrap_role',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        bootstrapClaimId: input.bootstrapClaimId,
        assignmentId: input.assignmentId,
        principalRef: { objectType: 'Principal', objectId: input.principalId },
        roleCode: input.roleCode,
      },
      platform: false,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'RoleAssignment',
      targetId: input.assignmentId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      const claim = await execution.trx
        .selectFrom('identity_policy.bootstrap_claim')
        .selectAll()
        .where('claim_id', '=', input.bootstrapClaimId)
        .executeTakeFirst();
      if (claim?.purpose !== 'FIRST_ADMIN_ROLE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_BOOTSTRAP_ROLE_INVALID,
          safeSummary: 'first-role bootstrap claim not found',
        };
      }
      if (claim.closed_at !== null) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_BOOTSTRAP_ROLE_INVALID,
          safeSummary: 'bootstrap already closed',
        };
      }
      if (claim.consumed_at !== null) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_BOOTSTRAP_ROLE_INVALID,
          safeSummary: 'bootstrap already consumed',
        };
      }
      if (claim.expires_at <= new Date()) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_BOOTSTRAP_ROLE_INVALID,
          safeSummary: 'bootstrap expired',
        };
      }
      await deps.repo.insertRoleAssignment(execution.trx, {
        id: input.assignmentId,
        principalId: input.principalId,
        code: input.roleCode,
        scopeKind: 'ENTERPRISE',
        enterpriseId: deps.context.enterpriseId,
        validFrom: new Date(),
        justification: input.justification,
        createdByPrincipalId: deps.context.principalId,
        createdByActorSnapshotId: deps.context.actorSnapshotId,
      });
      // Permanently close: consumed AND closed in one atomic step.
      await execution.trx
        .updateTable('identity_policy.bootstrap_claim')
        .set({
          consumed_at: new Date(),
          consumed_by_command_id: commandId,
          consumed_result: JSON.stringify({
            roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.assignmentId },
          }),
          closed_at: new Date(),
          closed_reason: 'first admin role bootstrapped; bootstrap permanently closed',
        })
        .where('claim_id', '=', input.bootstrapClaimId)
        .execute();
      await execution.appendAudit({
        outcome: 'ALLOWED',
        safeSummary: 'first admin role bootstrapped; bootstrap claim permanently closed',
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          roleAssignmentRef: { objectType: 'RoleAssignment', objectId: input.assignmentId },
          bootstrapClosed: true,
        },
      };
    },
  );
}
