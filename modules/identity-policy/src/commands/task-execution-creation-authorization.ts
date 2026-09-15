// IM-06 (#200): version-bound Task/WorkOrder creation authorization.
//
// Design authority: Module-Spec-001 §15 and the approved `IM06-AUTH-01`
// decision record (decisions §14). This module is the IdentityPolicy owning
// boundary of the four published creation versions:
//
// 1. `authorizeCreation` signs one immutable AuthorizationDecision for an exact
//    `(commandType, commandVersion)` key from the approved mapping, the trusted
//    composition capability configuration, the exact ActorSnapshot, the exact
//    CREATE target reference and the request facts. A caller or an Envelope can
//    never supply or override the capability code, the required Grant action or
//    the target object type.
// 2. `revalidateCreation` proves, before an owning handler claims idempotency
//    or returns a historical Receipt, that the same exact Decision still
//    covers this request *now*: exact id/hash, actor and actual principal,
//    authentication context, operation type/version/Purpose, payload hash,
//    target reference, Project Scope, ALLOW and expiry, plus a fresh read of
//    the single covering Grant and its Policy Snapshot.
//
// Everything fails closed. An unknown creation version, an unusable trusted
// configuration, a malformed or substituted target and a request outside the
// trusted transaction scope raise a stable error; a request that no single
// Grant completely covers is denied with a masked in-scope Audit. Neither path
// produces a success fact, a decision-carrying Outbox row or execution
// eligibility when it does not pass.
//
// A denial produces no Decision row on purpose: a Decision of this Port binds
// the exact Policy Snapshot of its covering Grant, and no Grant covered the
// request, so there is no Policy Snapshot the row could carry. The denial is
// recorded as a masked audit in the same transaction, exactly like the other
// owning entries of this module record their rejected requests.
//
// The port is internal: it is not a registered operation, it never enters the
// Contract Catalog, and it does not change `identity.authorize_command@1.0`,
// which keeps rejecting non-`1.0` command versions and keeps its own
// acceptance set. TaskExecution consumes this port; it never reads these
// tables or this Repository.

import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import {
  withIdentityTransaction,
  type IdentityTransaction,
  type IdentityTransactionContext,
  type SelectedCapabilityGrant,
  type SelectedPolicySnapshot,
} from '../persistence/identity-db.js';
import {
  authorizationDecisionIntegrityHolds,
  policySnapshotIntegrityHolds,
} from '../persistence/identity-policy-repository.js';
import {
  assertSnapshotReference,
  contentHash,
  contentHashToBuffer,
  DECISION_DEFAULT_TTL_SECONDS,
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  sameScope,
  SnapshotBoundaryError,
  validateHash,
  type ActorSnapshotRef,
  type IdentityCommandDeps,
} from './actor-snapshot.js';
import { isHumanOnlyCapability } from './static-registry.js';
import { resolveTaskExecutionCreationPurpose } from './task-execution-creation-purpose.js';

export const IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED =
  'IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED';
export const IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID =
  'IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID';
export const IDENTITY_CREATION_TARGET_INVALID = 'IDENTITY_CREATION_TARGET_INVALID';

/** The NamespaceCode shape of the shared contract (`Common.NamespaceCode`). */
const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** UuidV7, the identity shape every target and reference of this module uses. */
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** The one resource-selector type this Port interprets (Spec 001 §15.2). */
const createTargetSelectorType = 'CREATE_TARGET_TYPE';
const authorizationDecisionObjectType = 'identity.authorization_decision';
const policySnapshotObjectType = 'identity.policy_snapshot';
const actorSnapshotObjectType = 'identity.actor_snapshot';

/** Trusted configuration key of one approved creation version. */
export type TaskExecutionCreationCapabilityKey =
  'taskV1' | 'taskV2' | 'workOrderV1' | 'workOrderV11';

/**
 * The exact identity, Purpose, Grant action, CREATE target object type and
 * trusted configuration key of one approved creation version (Spec 001 §15.1).
 */
export interface TaskExecutionCreationBinding {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetObjectType: string;
  readonly capabilityConfigKey: TaskExecutionCreationCapabilityKey;
}

/**
 * The closed approved mapping. An operation/version pair outside this table
 * has no approved creation authorization at all: there is no alias, prefix,
 * case-insensitive, latest-version or implicit-default resolution, and the two
 * Task majors never inherit each other's coverage.
 */
export const TASK_EXECUTION_CREATION_BINDINGS: readonly TaskExecutionCreationBinding[] =
  Object.freeze([
    Object.freeze({
      commandType: 'execution.create_task',
      commandVersion: '1.0',
      authorizationPurpose: 'task.execution.create_task',
      requiredGrantAction: 'execution.task.create.v1',
      targetObjectType: 'execution.task',
      capabilityConfigKey: 'taskV1',
    }),
    Object.freeze({
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      authorizationPurpose: 'execution.task.create',
      requiredGrantAction: 'execution.task.create.v2',
      targetObjectType: 'zhiju.execution.task',
      capabilityConfigKey: 'taskV2',
    }),
    Object.freeze({
      commandType: 'execution.create_work_order',
      commandVersion: '1.0',
      authorizationPurpose: 'task.execution.create_work_order',
      requiredGrantAction: 'execution.work_order.create.v1',
      targetObjectType: 'execution.work_order',
      capabilityConfigKey: 'workOrderV1',
    }),
    Object.freeze({
      commandType: 'execution.create_work_order',
      commandVersion: '1.1',
      authorizationPurpose: 'task.execution.create_work_order',
      requiredGrantAction: 'execution.work_order.create.v1_1',
      targetObjectType: 'zhiju.execution.work_order',
      capabilityConfigKey: 'workOrderV11',
    }),
  ]);

/**
 * Trusted composition capability configuration: one capability code per
 * approved creation version. The values may be equal and are read from the
 * composition layer, never from a caller or an Envelope. A missing, blank or
 * non-NamespaceCode value fails closed for that version.
 */
export type TaskExecutionCreationCapabilityCodes = Readonly<
  Record<TaskExecutionCreationCapabilityKey, string>
>;

export interface TaskExecutionCreationAuthorizationConfig {
  readonly capabilityCodes: TaskExecutionCreationCapabilityCodes;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

/** The single stable reason a creation request was not allowed to proceed. */
export type TaskExecutionCreationDenialReason =
  | 'PRINCIPAL_NOT_ACTIVE'
  | 'CAPABILITY_HUMAN_ONLY'
  | 'NO_ACTIVE_GRANT'
  | 'GRANT_POLICY_SNAPSHOT_INVALID'
  | 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT';

export interface TaskExecutionCreationAuthorizationInput {
  /** Exact actor snapshot of the calling principal (id and payload hash). */
  readonly actorSnapshotRef: ActorSnapshotRef;
  readonly commandType: string;
  readonly commandVersion: string;
  /** The pre-allocated CREATE target: exact object type, id and Project Scope. */
  readonly targetRef: Common.ObjectRef;
  readonly commandPayloadHash: Buffer;
  readonly authenticationContextHash: Buffer;
}

export interface TaskExecutionCreationAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly targetRef: Common.ObjectRef;
  readonly reasons: readonly string[];
  /** Present exactly when a Decision was issued. */
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

export interface TaskExecutionCreationRevalidationInput {
  readonly decisionRef: Common.ContentAddressedRef;
  readonly expectedCommandType: string;
  readonly expectedCommandVersion: string;
  readonly expectedCommandPayloadHash: Buffer;
  readonly expectedAuthenticationContextHash: Buffer;
  /** The CREATE target this request would submit, with its exact Project Scope. */
  readonly expectedTargetRef: Common.ObjectRef;
}

/**
 * The closed outcome of a revalidation. A `false` result is never an ALLOW and
 * never restores eligibility; the reason names the single compared dimension
 * that failed.
 */
export type TaskExecutionCreationRevalidationFailure =
  | 'NOT_FOUND'
  | 'HASH_MISMATCH'
  | 'NOT_ALLOW'
  | 'TARGET_UNBOUND'
  | 'TARGET_MISMATCH'
  | 'SCOPE_MISMATCH'
  | 'COMMAND_MISMATCH'
  | 'PAYLOAD_HASH_MISMATCH'
  | 'AUTH_CONTEXT_MISMATCH'
  | 'ACTOR_MISMATCH'
  | 'DECISION_INTEGRITY_MISMATCH'
  | 'PRINCIPAL_NOT_ACTIVE'
  | 'CONFIGURATION_CHANGED'
  | 'EXPIRED'
  | 'GRANT_NOT_CURRENT'
  | 'POLICY_INTEGRITY_MISMATCH'
  | 'POLICY_NOT_CURRENT';

export type TaskExecutionCreationRevalidationResult =
  | {
      readonly valid: true;
      readonly authorizationDecisionRef: Common.ContentAddressedRef;
      readonly targetRef: Common.ObjectRef;
      readonly policySnapshotRef: Common.SnapshotRef;
      readonly expiresAt: Common.UtcInstant;
    }
  | { readonly valid: false; readonly reason: TaskExecutionCreationRevalidationFailure };

export interface TaskExecutionCreationAuthorizationPort {
  /** Signs the exact creation Decision the request needs, or denies it. */
  authorizeCreation(
    deps: IdentityCommandDeps,
    input: TaskExecutionCreationAuthorizationInput,
  ): Promise<TaskExecutionCreationAuthorizationView>;
  /** Proves that the presented Decision still covers this request now. */
  revalidateCreation(
    deps: IdentityCommandDeps,
    input: TaskExecutionCreationRevalidationInput,
  ): Promise<TaskExecutionCreationRevalidationResult>;
}

/** The validated CREATE target of one creation request. */
interface CreationTarget {
  readonly objectType: string;
  readonly objectId: string;
  readonly scope: Common.ScopeRef;
  readonly enterpriseId: string;
  readonly projectId: string;
}

interface CreationGrantQuery {
  readonly principalId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly capabilityCode: string;
  readonly requiredGrantAction: string;
  readonly targetObjectType: string;
  /** Exact Policy Snapshot the Decision is bound to, when one already exists. */
  readonly policySnapshot?: { readonly id: string; readonly hash: Buffer } | undefined;
  readonly now: Date;
}

type CreationGrantFinding =
  | { readonly policySnapshot: SelectedPolicySnapshot }
  | { readonly denial: TaskExecutionCreationDenialReason };

/**
 * The owning port. The trusted configuration is resolved for every call, so a
 * value that is missing, blank or not a NamespaceCode can never authorize
 * anything, and the trusted clock is never a caller argument.
 */
export function createTaskExecutionCreationAuthorizationPort(
  config: TaskExecutionCreationAuthorizationConfig,
): TaskExecutionCreationAuthorizationPort {
  // A configuration object that is missing entirely must still fail closed
  // (as an unusable capability configuration) instead of crashing here.
  const configuredNow = (config as { readonly now?: unknown } | null | undefined)?.now;
  const now: () => Date =
    typeof configuredNow === 'function' ? (configuredNow as () => Date) : () => new Date();

  return {
    async authorizeCreation(deps, input) {
      const binding = approvedCreationBinding(input.commandType, input.commandVersion);
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readCreationTarget(input.targetRef, binding, deps.context);
      assertCreationInput(input, target, deps.context);
      const actorSnapshotPayloadHash = contentHashToBuffer(
        input.actorSnapshotRef.contentHash,
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'actor snapshot payload hash',
      );

      const decision = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
        const actor = await deps.repo.getActorSnapshotByIdAndHash(
          trx,
          input.actorSnapshotRef.snapshotId,
          actorSnapshotPayloadHash,
        );
        if (!actor?.hashMatched) {
          throw new SnapshotBoundaryError(
            IDENTITY_ACTOR_SNAPSHOT_INVALID,
            'actor snapshot ref does not match',
          );
        }
        // The Decision is issued for the trusted transaction actor: a caller
        // cannot present another principal's snapshot of the same Project.
        if (actor.row.principal_id !== deps.context.principalId) {
          throw new SnapshotBoundaryError(
            IDENTITY_ACTOR_SNAPSHOT_INVALID,
            'actor snapshot principal must be the trusted transaction principal',
          );
        }
        if (
          actor.row.scope_kind !== 'PROJECT' ||
          actor.row.enterprise_id !== target.enterpriseId ||
          actor.row.project_id !== target.projectId
        ) {
          throw new SnapshotBoundaryError(
            IDENTITY_ACTOR_SNAPSHOT_INVALID,
            'actor snapshot scope must be the exact creation Project',
          );
        }
        if (!actor.row.authentication_context_hash.equals(input.authenticationContextHash)) {
          throw new SnapshotBoundaryError(
            IDENTITY_DECISION_INPUT_INVALID,
            'authentication context mismatch',
          );
        }

        const principal = await deps.repo.getPrincipalById(trx, actor.row.principal_id);
        const principalKind = principal?.principal_kind ?? actor.row.principal_kind;
        // actingFor is metadata only: the kind stays the actor's real kind, and
        // a Human-only capability never becomes available to another kind.
        const principalInactive = principal?.status !== 'ACTIVE';
        const humanOnlyViolation =
          isHumanOnlyCapability(capabilityCode) && principalKind !== 'HUMAN';
        if (principalInactive || humanOnlyViolation) {
          const reason = principalInactive
            ? ('PRINCIPAL_NOT_ACTIVE' as const)
            : ('CAPABILITY_HUMAN_ONLY' as const);
          await appendCreationDeniedAudit(trx, deps, {
            commandType: binding.commandType,
            denial: reason,
            target,
            actorSnapshotId: actor.row.actor_snapshot_id,
            actorPrincipalId: actor.row.principal_id,
            commandPayloadHash: input.commandPayloadHash,
          });
          return { outcome: 'DENY' as const, reasons: [reason] };
        }
        const finding = await coveringCreationGrant(deps, trx, {
          principalId: actor.row.principal_id,
          enterpriseId: target.enterpriseId,
          projectId: target.projectId,
          capabilityCode,
          requiredGrantAction: binding.requiredGrantAction,
          targetObjectType: binding.targetObjectType,
          now: now(),
        });
        if ('denial' in finding) {
          await appendCreationDeniedAudit(trx, deps, {
            commandType: binding.commandType,
            denial: finding.denial,
            target,
            actorSnapshotId: actor.row.actor_snapshot_id,
            actorPrincipalId: actor.row.principal_id,
            commandPayloadHash: input.commandPayloadHash,
          });
          return { outcome: 'DENY' as const, reasons: [finding.denial] };
        }

        const decisionId = newUuidV7();
        const expiresAt = new Date(now().getTime() + DECISION_DEFAULT_TTL_SECONDS * 1000);
        const reasons = ['ALLOWED_BY_GRANT'];
        const policySnapshot = finding.policySnapshot;
        await deps.repo.insertAuthorizationDecision(trx, {
          authorizationDecisionId: decisionId,
          actorSnapshotId: actor.row.actor_snapshot_id,
          actorSnapshotPayloadHash: actor.row.payload_hash,
          principalId: actor.row.principal_id,
          principalKind,
          outcome: 'ALLOW',
          reasonCodes: reasons,
          commandType: binding.commandType,
          commandVersion: binding.commandVersion,
          scopeKind: 'PROJECT',
          enterpriseId: target.enterpriseId,
          projectId: target.projectId,
          purpose: binding.authorizationPurpose,
          requestedCapability: capabilityCode,
          commandPayloadHash: input.commandPayloadHash,
          policySnapshotId: policySnapshot.policy_snapshot_id,
          policySnapshotPayloadHash: policySnapshot.payload_hash,
          authenticationContextHash: input.authenticationContextHash,
          expiresAt,
          contractVersion: '1.0',
          targetRef: { objectType: target.objectType, objectId: target.objectId },
          decisionPayload: {
            outcome: 'ALLOW',
            actorSnapshotId: actor.row.actor_snapshot_id,
            actorSnapshotPayloadHash: actor.row.payload_hash.toString('hex'),
            principalId: actor.row.principal_id,
            principalKind,
            authenticationContextHash: input.authenticationContextHash.toString('hex'),
            enterpriseId: target.enterpriseId,
            projectId: target.projectId,
            scopeKind: 'PROJECT',
            commandType: binding.commandType,
            commandVersion: binding.commandVersion,
            purpose: binding.authorizationPurpose,
            requestedCapability: capabilityCode,
            commandPayloadHash: input.commandPayloadHash.toString('hex'),
            policySnapshotId: policySnapshot.policy_snapshot_id,
            policySnapshotPayloadHash: policySnapshot.payload_hash.toString('hex'),
            expiresAt: expiresAt.toISOString(),
            reasonCodes: reasons,
            targetRef: {
              kind: 'OBJECT',
              objectType: target.objectType,
              objectId: target.objectId,
              scope: { enterpriseId: target.enterpriseId, projectId: target.projectId },
            },
          },
          createdByPrincipalId: deps.context.principalId,
          sourceCommandId: newUuidV7(),
        });
        return {
          outcome: 'ALLOW' as const,
          reasons,
          decisionId,
          expiresAt,
          policySnapshotId: policySnapshot.policy_snapshot_id,
          policySnapshotPayloadHash: policySnapshot.payload_hash,
        };
      });

      if (decision.outcome === 'DENY') {
        return { outcome: 'DENY', targetRef: input.targetRef, reasons: decision.reasons };
      }
      // The stored canonical payload is authoritative; re-read the exact hash.
      const stored = await withIdentityTransaction(deps.db, deps.context, async (trx) =>
        trx
          .selectFrom('identity_policy.authorization_decision')
          .select(['authorization_decision_id', 'payload_hash'])
          .where('authorization_decision_id', '=', decision.decisionId)
          .executeTakeFirst(),
      );
      if (!stored) {
        throw new SnapshotBoundaryError(
          IDENTITY_DECISION_INPUT_INVALID,
          'decision persistence failed',
        );
      }
      return {
        outcome: 'ALLOW',
        targetRef: input.targetRef,
        reasons: decision.reasons,
        authorizationDecisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: authorizationDecisionObjectType,
          objectId: stored.authorization_decision_id,
          scope: target.scope,
          contentHash: contentHash(stored.payload_hash),
        },
        policySnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: policySnapshotObjectType,
          objectId: decision.policySnapshotId,
          snapshotId: decision.policySnapshotId,
          scope: {},
          contentHash: contentHash(decision.policySnapshotPayloadHash),
        },
        expiresAt: decision.expiresAt.toISOString(),
      };
    },

    async revalidateCreation(deps, input) {
      const binding = approvedCreationBinding(
        input.expectedCommandType,
        input.expectedCommandVersion,
      );
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readCreationTarget(input.expectedTargetRef, binding, deps.context);
      validateHash(
        input.expectedCommandPayloadHash,
        IDENTITY_DECISION_INPUT_INVALID,
        'expected command payload hash',
      );
      validateHash(
        input.expectedAuthenticationContextHash,
        IDENTITY_DECISION_INPUT_INVALID,
        'expected authentication context hash',
      );
      assertDecisionReference(input.decisionRef);
      const decisionPayloadHash = contentHashToBuffer(
        input.decisionRef.contentHash,
        IDENTITY_DECISION_INPUT_INVALID,
        'decision payload hash',
      );

      return withIdentityTransaction(deps.db, deps.context, async (trx) => {
        const found = await deps.repo.getAuthorizationDecisionByIdAndHash(
          trx,
          input.decisionRef.objectId,
          decisionPayloadHash,
        );
        if (!found) return invalid('NOT_FOUND');
        if (!found.hashMatched) return invalid('HASH_MISMATCH');
        const row = found.row;
        // The stored hash column is not the canonical payload: the bytes must
        // still hash to it before any field of the row is trusted.
        if (!authorizationDecisionIntegrityHolds(row)) {
          return invalid('DECISION_INTEGRITY_MISMATCH');
        }
        // The Decision must belong to the trusted transaction actor, not only
        // to the same Project Scope.
        if (
          row.actor_snapshot_id !== deps.context.actorSnapshotId ||
          row.principal_id !== deps.context.principalId
        ) {
          return invalid('ACTOR_MISMATCH');
        }
        if (row.outcome !== 'ALLOW') return invalid('NOT_ALLOW');
        // A Decision without a target binding predates this Port: it stays
        // readable history but never authorizes one of the four versions.
        if (row.target_object_type === null || row.target_object_id === null) {
          return invalid('TARGET_UNBOUND');
        }
        if (
          row.target_object_type !== target.objectType ||
          row.target_object_id !== target.objectId
        ) {
          return invalid('TARGET_MISMATCH');
        }
        if (
          row.scope_kind !== 'PROJECT' ||
          row.enterprise_id !== target.enterpriseId ||
          row.project_id !== target.projectId ||
          !sameScope(input.decisionRef.scope, target.scope) ||
          !sameScope(input.expectedTargetRef.scope, target.scope)
        ) {
          return invalid('SCOPE_MISMATCH');
        }
        if (
          row.command_type !== binding.commandType ||
          row.command_version !== binding.commandVersion ||
          row.purpose !== binding.authorizationPurpose
        ) {
          return invalid('COMMAND_MISMATCH');
        }
        // A trusted configuration change is not silently tolerated: the
        // Decision must still carry the capability code of this version.
        if (row.requested_capability !== capabilityCode) return invalid('CONFIGURATION_CHANGED');
        if (!row.command_payload_hash.equals(input.expectedCommandPayloadHash)) {
          return invalid('PAYLOAD_HASH_MISMATCH');
        }
        if (!row.authentication_context_hash.equals(input.expectedAuthenticationContextHash)) {
          return invalid('AUTH_CONTEXT_MISMATCH');
        }
        const trustedNow = now();
        if (row.expires_at <= trustedNow) return invalid('EXPIRED');

        const actor = await deps.repo.getActorSnapshotByIdAndHash(
          trx,
          row.actor_snapshot_id,
          row.actor_snapshot_payload_hash,
        );
        if (
          !actor?.hashMatched ||
          actor.row.principal_id !== row.principal_id ||
          actor.row.principal_kind !== row.principal_kind ||
          !actor.row.authentication_context_hash.equals(row.authentication_context_hash) ||
          actor.row.scope_kind !== row.scope_kind ||
          actor.row.enterprise_id !== row.enterprise_id ||
          actor.row.project_id !== row.project_id
        ) {
          return invalid('ACTOR_MISMATCH');
        }
        const principal = await deps.repo.getPrincipalById(trx, row.principal_id);
        if (principal?.status !== 'ACTIVE') return invalid('PRINCIPAL_NOT_ACTIVE');

        const finding = await coveringCreationGrant(deps, trx, {
          principalId: row.principal_id,
          enterpriseId: row.enterprise_id,
          projectId: target.projectId,
          capabilityCode,
          requiredGrantAction: binding.requiredGrantAction,
          targetObjectType: binding.targetObjectType,
          policySnapshot: { id: row.policy_snapshot_id, hash: row.policy_snapshot_payload_hash },
          now: trustedNow,
        });
        if ('denial' in finding) {
          return invalid(
            finding.denial === 'GRANT_POLICY_SNAPSHOT_INVALID'
              ? 'POLICY_INTEGRITY_MISMATCH'
              : finding.denial === 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT'
                ? 'POLICY_NOT_CURRENT'
                : 'GRANT_NOT_CURRENT',
          );
        }
        return {
          valid: true,
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: authorizationDecisionObjectType,
            objectId: row.authorization_decision_id,
            scope: target.scope,
            contentHash: contentHash(row.payload_hash),
          },
          targetRef: input.expectedTargetRef,
          policySnapshotRef: {
            kind: 'SNAPSHOT',
            objectType: policySnapshotObjectType,
            objectId: finding.policySnapshot.policy_snapshot_id,
            snapshotId: finding.policySnapshot.policy_snapshot_id,
            scope: {},
            contentHash: contentHash(finding.policySnapshot.payload_hash),
          },
          expiresAt: row.expires_at.toISOString(),
        };
      });
    },
  };
}

/**
 * The closed negative revalidation outcome. Call sites stay in lockstep so the
 * result shape cannot drift between the compared dimensions.
 */
function invalid(reason: TaskExecutionCreationRevalidationFailure): {
  readonly valid: false;
  readonly reason: TaskExecutionCreationRevalidationFailure;
} {
  return { valid: false, reason };
}

/**
 * Exact resolution of one approved creation version. An operation/version pair
 * that is not one of the four approved keys has no binding, and the shared
 * Purpose table must agree with the binding (drift fails closed).
 */
function approvedCreationBinding(
  commandType: unknown,
  commandVersion: unknown,
): TaskExecutionCreationBinding {
  if (typeof commandType !== 'string' || typeof commandVersion !== 'string') {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
      'creation version must be an exact operation and version',
    );
  }
  const binding = TASK_EXECUTION_CREATION_BINDINGS.find(
    (candidate) =>
      candidate.commandType === commandType && candidate.commandVersion === commandVersion,
  );
  if (binding === undefined) {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
      'creation version has no approved authorization binding',
    );
  }
  const resolved = resolveTaskExecutionCreationPurpose(commandType, commandVersion);
  if (
    resolved.outcome !== 'RESOLVED' ||
    resolved.authorizationPurpose !== binding.authorizationPurpose
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
      'creation Purpose resolution does not match the approved binding',
    );
  }
  return binding;
}

function configuredCapabilityCode(
  config: TaskExecutionCreationAuthorizationConfig,
  key: TaskExecutionCreationCapabilityKey,
): string {
  const capabilityCodes: unknown = (
    config as { readonly capabilityCodes?: unknown } | null | undefined
  )?.capabilityCodes;
  const value =
    capabilityCodes !== null && typeof capabilityCodes === 'object'
      ? (capabilityCodes as Readonly<Record<string, unknown>>)[key]
      : undefined;
  if (typeof value !== 'string' || !namespaceCodePattern.test(value)) {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
      `trusted capability configuration for ${key} is missing or invalid`,
    );
  }
  return value;
}

/**
 * The CREATE target reference of one creation request: the exact approved
 * object type, a pre-allocated UuidV7 and the exact Project Scope the request
 * runs in. Enterprise scope, another object type, a wildcard, a case variant
 * and a target outside the trusted transaction scope are refused.
 */
function readCreationTarget(
  targetRef: Common.ObjectRef,
  binding: TaskExecutionCreationBinding,
  context: IdentityTransactionContext,
): CreationTarget {
  const candidate = targetRef as unknown as
    | { kind?: unknown; objectType?: unknown; objectId?: unknown; scope?: unknown }
    | null
    | undefined;
  const scope = candidate?.scope as
    { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
  if (
    candidate?.kind !== 'OBJECT' ||
    candidate.objectType !== binding.targetObjectType ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    typeof scope?.enterpriseId !== 'string' ||
    typeof scope.projectId !== 'string' ||
    !Object.keys(scope).every((key) => key === 'enterpriseId' || key === 'projectId')
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_TARGET_INVALID,
      'creation target must be the exact approved object type, id and Project Scope',
    );
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(scope.projectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CREATION_TARGET_INVALID,
      'creation target scope must match the trusted transaction scope',
    );
  }
  return {
    objectType: binding.targetObjectType,
    objectId: candidate.objectId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
  };
}

function assertCreationInput(
  input: TaskExecutionCreationAuthorizationInput,
  target: CreationTarget,
  context: IdentityTransactionContext,
): void {
  assertSnapshotReference(
    input.actorSnapshotRef,
    actorSnapshotObjectType,
    IDENTITY_ACTOR_SNAPSHOT_INVALID,
    'actor snapshot',
  );
  if (input.actorSnapshotRef.snapshotId !== context.actorSnapshotId) {
    throw new SnapshotBoundaryError(
      IDENTITY_ACTOR_SNAPSHOT_INVALID,
      'actor snapshot must be the trusted transaction actor',
    );
  }
  if (!sameScope(input.actorSnapshotRef.scope, target.scope)) {
    throw new SnapshotBoundaryError(
      IDENTITY_ACTOR_SNAPSHOT_INVALID,
      'actor snapshot scope must be the exact creation Project',
    );
  }
  validateHash(input.commandPayloadHash, IDENTITY_DECISION_INPUT_INVALID, 'command payload hash');
  validateHash(
    input.authenticationContextHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'authentication context hash',
  );
}

function assertDecisionReference(ref: Common.ContentAddressedRef): void {
  const candidate = ref as unknown as
    { kind?: unknown; objectType?: unknown; objectId?: unknown } | null | undefined;
  if (
    candidate?.kind !== 'CONTENT_ADDRESSED' ||
    candidate.objectType !== authorizationDecisionObjectType ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'decision reference must be an exact AuthorizationDecision reference',
    );
  }
}

/**
 * The single covering Grant rule of Spec 001 §15.2. One Grant must satisfy
 * every condition on its own: exact principal, configured capability code,
 * exact Project Scope, ACTIVE inside the trusted time window, the exact version
 * action, the closed CREATE-target selector for the exact object type, an empty
 * `constraints`, no `maxUses`, and — when a Decision is already bound — exactly
 * that Policy Snapshot, currently effective and not superseded. Coverage is
 * never assembled from several partial Grants.
 */
async function coveringCreationGrant(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  query: CreationGrantQuery,
): Promise<CreationGrantFinding> {
  const grants = await deps.repo.listActiveCapabilityGrants(
    trx,
    query.principalId,
    query.enterpriseId,
    query.now,
  );
  let sawStalePolicy = false;
  let sawInvalidPolicy = false;
  for (const grant of grants) {
    if (!grantMatchesCreation(grant, query)) continue;
    if (
      query.policySnapshot !== undefined &&
      (grant.grant_policy_snapshot_id !== query.policySnapshot.id ||
        !grant.grant_policy_snapshot_hash.equals(query.policySnapshot.hash))
    ) {
      // The Grant still covers the action and target but is bound to another
      // Policy Snapshot than the Decision carries.
      sawStalePolicy = true;
      continue;
    }
    const policySnapshot = await deps.repo.getPolicySnapshotById(
      trx,
      grant.grant_policy_snapshot_id,
    );
    // The Snapshot must be integrity-valid before it is interpreted: a
    // rewritten document that no longer hashes to the stored hash is refused.
    if (
      policySnapshot === undefined ||
      !policySnapshot.payload_hash.equals(grant.grant_policy_snapshot_hash) ||
      !policySnapshotIntegrityHolds(policySnapshot)
    ) {
      sawInvalidPolicy = true;
      continue;
    }
    if (
      policySnapshot.effective_from > query.now ||
      (policySnapshot.superseded_at !== null &&
        policySnapshot.superseded_at !== undefined &&
        query.now >= policySnapshot.superseded_at)
    ) {
      sawStalePolicy = true;
      continue;
    }
    return { policySnapshot };
  }
  return {
    denial: sawInvalidPolicy
      ? 'GRANT_POLICY_SNAPSHOT_INVALID'
      : sawStalePolicy
        ? 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT'
        : 'NO_ACTIVE_GRANT',
  };
}

function grantMatchesCreation(grant: SelectedCapabilityGrant, query: CreationGrantQuery): boolean {
  const constraints = grant.constraints as unknown;
  const constraintsEmpty =
    typeof constraints === 'object' &&
    constraints !== null &&
    !Array.isArray(constraints) &&
    Object.keys(constraints).length === 0;
  return (
    grant.capability_code === query.capabilityCode &&
    grant.scope_kind === 'PROJECT' &&
    grant.enterprise_id === query.enterpriseId &&
    grant.project_id === query.projectId &&
    grant.actions.includes(query.requiredGrantAction) &&
    grant.max_uses === null &&
    constraintsEmpty &&
    selectorsCoverCreationTarget(grant.resource_selectors, query.targetObjectType)
  );
}

/**
 * The closed `CREATE_TARGET_TYPE` selector shape. Every element of the array
 * must be exactly this shape (no unknown field, no wildcard, no prefix, no
 * alias, no case variant) and at least one element must equal the exact object
 * type of the current version.
 */
function selectorsCoverCreationTarget(selectors: unknown, targetObjectType: string): boolean {
  if (!Array.isArray(selectors) || selectors.length === 0) return false;
  let matched = false;
  for (const selector of selectors) {
    if (selector === null || typeof selector !== 'object' || Array.isArray(selector)) return false;
    const candidate = selector as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === 'selectorType' || key === 'objectType') ||
      candidate.selectorType !== createTargetSelectorType ||
      typeof candidate.objectType !== 'string' ||
      !namespaceCodePattern.test(candidate.objectType)
    ) {
      return false;
    }
    if (candidate.objectType === targetObjectType) matched = true;
  }
  return matched;
}

/**
 * Masked, in-scope audit of a denied creation request. The entry stays inside
 * the trusted transaction scope and never carries the request payload.
 */
async function appendCreationDeniedAudit(
  trx: IdentityTransaction,
  deps: IdentityCommandDeps,
  input: {
    readonly commandType: string;
    readonly denial: TaskExecutionCreationDenialReason;
    readonly target: CreationTarget;
    readonly actorSnapshotId: string;
    readonly actorPrincipalId: string;
    readonly commandPayloadHash: Buffer;
  },
): Promise<void> {
  await trx
    .insertInto('identity_policy.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: input.target.enterpriseId,
      project_id: input.target.projectId,
      principal_id: input.actorPrincipalId,
      actor_snapshot_id: input.actorSnapshotId,
      authorization_decision_id: deps.context.authorizationDecisionId,
      command_id: newUuidV7(),
      command_type: input.commandType,
      outcome: 'DENIED',
      error_code: input.denial,
      request_payload_hash: input.commandPayloadHash,
      result_payload_hash: null,
      target_type: input.target.objectType,
      target_id: input.target.objectId,
      correlation_id: deps.context.correlationId,
      safe_summary: `creation authorization denied: ${input.denial}`,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}
