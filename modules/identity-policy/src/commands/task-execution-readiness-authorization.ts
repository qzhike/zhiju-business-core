// IM-06 (#206): version-bound Task readiness build / READY-transition
// authorization.
//
// Design authority: Module-Spec-001 §15.5 and Spec 003 §17.4/§17.5/§17.8. This
// module is the IdentityPolicy owning boundary of the two published operations
// of the Task Readiness slice:
//
// 1. `authorizeReadiness` signs one immutable AuthorizationDecision for an
//    exact `(commandType, commandVersion)` key of the approved mapping, the
//    trusted composition capability configuration, the exact ActorSnapshot, the
//    exact target reference and the request facts. A caller or an Envelope can
//    never supply or override the capability code, the required Grant action,
//    the Grant selector type or the accepted target object types.
// 2. `revalidateReadiness` proves, before an owning handler claims idempotency
//    or returns a historical Receipt, that the same exact Decision still covers
//    this request *now*: exact id/hash, actor and actual principal,
//    authentication context, operation type/version/Purpose, payload hash,
//    target reference, Project Scope, ALLOW and expiry, plus a fresh read of the
//    single covering Grant and its Policy Snapshot.
//
// The Port exists because the historical `identity.authorize_command@1.0`
// Decision carries no `target_object_type` / `target_object_id` mirror: a
// generic Decision cannot express "build the readiness judgment of *this*
// pre-allocated id" or "mark *this* Task READY", and a Decision without a
// target binding authorizes neither action (Spec 001 §15.5). V1006 allows only
// this Port family to write non-NULL target columns, so a target-bound Decision
// for build/READY can only come from an owning internal Port.
//
// Everything fails closed. An unknown operation version, an unusable trusted
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
// which keeps rejecting non-`1.0` command versions and keeps its own acceptance
// set. TaskExecution consumes this port; it never reads these tables or this
// Repository.

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

export const IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED =
  'IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED';
export const IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID =
  'IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID';
export const IDENTITY_READINESS_TARGET_INVALID = 'IDENTITY_READINESS_TARGET_INVALID';

/**
 * The two approved Purposes, published so composition and the owning handlers
 * never re-spell them. They are deliberately *not* registered with the
 * creation-purpose resolver: that resolver answers for the four published
 * creation versions only, and a readiness key has no approved entry there.
 */
export const TASK_READINESS_BUILD_PURPOSE = 'execution.task.readiness.build';
export const TASK_READY_PURPOSE = 'task.execution.mark_task_ready';

/** The NamespaceCode shape of the shared contract (`Common.NamespaceCode`). */
const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** UuidV7, the identity shape every target and reference of this module uses. */
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const authorizationDecisionObjectType = 'identity.authorization_decision';
const policySnapshotObjectType = 'identity.policy_snapshot';
const actorSnapshotObjectType = 'identity.actor_snapshot';

/**
 * Trusted configuration key of one approved readiness operation. The two keys
 * are independent: neither entry ever reads the other key's code.
 */
export type TaskExecutionReadinessCapabilityKey = 'taskReadinessBuildV1' | 'taskReadyV1';

/**
 * The Grant selector type each entry interprets. `CREATE_TARGET_TYPE` keeps its
 * §15.2 meaning; `TARGET_TYPE` is new here and is interpreted by this Port only.
 * The two types are never interchangeable.
 */
export type TaskExecutionReadinessSelectorType = 'CREATE_TARGET_TYPE' | 'TARGET_TYPE';

/**
 * The exact identity, Purpose, Grant action, target kind, accepted target
 * object types, Grant selector type and trusted configuration key of one
 * approved readiness operation (Spec 001 §15.5).
 */
export interface TaskExecutionReadinessBinding {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'OBJECT';
  /**
   * The closed accepted objectType set. The request's declared object type must
   * equal one member exactly; the set is a closed list, never a pattern.
   */
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: TaskExecutionReadinessSelectorType;
  readonly capabilityConfigKey: TaskExecutionReadinessCapabilityKey;
}

/**
 * The closed approved mapping. An operation/version pair outside this table has
 * no approved readiness authorization at all: there is no alias, prefix,
 * case-insensitive, latest-version or implicit-default resolution, and the two
 * entries never inherit each other's Purpose, action, selector or config key.
 *
 * The consumer's two target object types are the two published Task identities
 * of Spec 003 §16.1. Declaring one of them here only says that this action may
 * act on both published spellings; which one is business-correct for a given
 * Task is decided by the owning TaskExecution handler from that Task's
 * immutable creation facts (R-206-1), because IdentityPolicy does not read
 * TaskExecution facts.
 */
export const TASK_EXECUTION_READINESS_BINDINGS: readonly TaskExecutionReadinessBinding[] =
  Object.freeze([
    Object.freeze({
      commandType: 'execution.build_task_readiness',
      commandVersion: '1.0',
      authorizationPurpose: TASK_READINESS_BUILD_PURPOSE,
      requiredGrantAction: 'execution.task.readiness.build',
      targetKind: 'OBJECT',
      targetObjectTypes: Object.freeze(['zhiju.execution.task_readiness']),
      selectorType: 'CREATE_TARGET_TYPE',
      capabilityConfigKey: 'taskReadinessBuildV1',
    }),
    Object.freeze({
      commandType: 'execution.mark_task_ready',
      commandVersion: '1.0',
      authorizationPurpose: TASK_READY_PURPOSE,
      requiredGrantAction: 'execution.task.mark_ready',
      targetKind: 'OBJECT',
      targetObjectTypes: Object.freeze(['execution.task', 'zhiju.execution.task']),
      selectorType: 'TARGET_TYPE',
      capabilityConfigKey: 'taskReadyV1',
    }),
  ]);

/**
 * The published Purposes indexed by the trusted configuration key, so a drift
 * between the binding table and the constants above fails closed instead of
 * signing a Decision under a Purpose no caller expects.
 */
const approvedPurposes: Readonly<Record<TaskExecutionReadinessCapabilityKey, string>> =
  Object.freeze({
    taskReadinessBuildV1: TASK_READINESS_BUILD_PURPOSE,
    taskReadyV1: TASK_READY_PURPOSE,
  });

/**
 * Trusted composition capability configuration: one capability code per
 * approved readiness operation. The values may be equal and are read from the
 * composition layer, never from a caller or an Envelope. A missing, blank or
 * non-NamespaceCode value fails closed for that entry.
 */
export type TaskExecutionReadinessCapabilityCodes = Readonly<
  Record<TaskExecutionReadinessCapabilityKey, string>
>;

export interface TaskExecutionReadinessAuthorizationConfig {
  readonly capabilityCodes: TaskExecutionReadinessCapabilityCodes;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

/** The single stable reason a readiness request was not allowed to proceed. */
export type TaskExecutionReadinessDenialReason =
  | 'PRINCIPAL_NOT_ACTIVE'
  | 'CAPABILITY_HUMAN_ONLY'
  | 'NO_ACTIVE_GRANT'
  | 'GRANT_POLICY_SNAPSHOT_INVALID'
  | 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT';

export interface TaskExecutionReadinessAuthorizationInput {
  /** Exact actor snapshot of the calling principal (id and payload hash). */
  readonly actorSnapshotRef: ActorSnapshotRef;
  readonly commandType: string;
  readonly commandVersion: string;
  /** The exact target of this request: object type, id and Project Scope. */
  readonly targetRef: Common.ObjectRef;
  readonly commandPayloadHash: Buffer;
  readonly authenticationContextHash: Buffer;
}

export interface TaskExecutionReadinessAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly targetRef: Common.ObjectRef;
  readonly reasons: readonly string[];
  /** Present exactly when a Decision was issued. */
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

export interface TaskExecutionReadinessRevalidationInput {
  readonly decisionRef: Common.ContentAddressedRef;
  readonly expectedCommandType: string;
  readonly expectedCommandVersion: string;
  readonly expectedCommandPayloadHash: Buffer;
  readonly expectedAuthenticationContextHash: Buffer;
  /** The exact target this request would submit, with its exact Project Scope. */
  readonly expectedTargetRef: Common.ObjectRef;
}

/**
 * The closed outcome of a revalidation. A `false` result is never an ALLOW and
 * never restores eligibility; the reason names the single compared dimension
 * that failed.
 */
export type TaskExecutionReadinessRevalidationFailure =
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

export type TaskExecutionReadinessRevalidationResult =
  | {
      readonly valid: true;
      readonly authorizationDecisionRef: Common.ContentAddressedRef;
      readonly targetRef: Common.ObjectRef;
      readonly policySnapshotRef: Common.SnapshotRef;
      readonly expiresAt: Common.UtcInstant;
    }
  | { readonly valid: false; readonly reason: TaskExecutionReadinessRevalidationFailure };

export interface TaskExecutionReadinessAuthorizationPort {
  /** Signs the exact build/READY Decision the request needs, or denies it. */
  authorizeReadiness(
    deps: IdentityCommandDeps,
    input: TaskExecutionReadinessAuthorizationInput,
  ): Promise<TaskExecutionReadinessAuthorizationView>;
  /** Proves that the presented Decision still covers this request now. */
  revalidateReadiness(
    deps: IdentityCommandDeps,
    input: TaskExecutionReadinessRevalidationInput,
  ): Promise<TaskExecutionReadinessRevalidationResult>;
}

/** The validated target of one readiness request. */
interface ReadinessTarget {
  readonly objectType: string;
  readonly objectId: string;
  readonly scope: Common.ScopeRef;
  readonly enterpriseId: string;
  readonly projectId: string;
}

interface ReadinessGrantQuery {
  readonly principalId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly capabilityCode: string;
  readonly requiredGrantAction: string;
  readonly selectorType: TaskExecutionReadinessSelectorType;
  readonly targetObjectType: string;
  /** Exact Policy Snapshot the Decision is bound to, when one already exists. */
  readonly policySnapshot?: { readonly id: string; readonly hash: Buffer } | undefined;
  readonly now: Date;
}

type ReadinessGrantFinding =
  | { readonly policySnapshot: SelectedPolicySnapshot }
  | { readonly denial: TaskExecutionReadinessDenialReason };

/**
 * The owning port. The trusted configuration is resolved for every call, so a
 * value that is missing, blank or not a NamespaceCode can never authorize
 * anything, and the trusted clock is never a caller argument.
 */
export function createTaskExecutionReadinessAuthorizationPort(
  config: TaskExecutionReadinessAuthorizationConfig,
): TaskExecutionReadinessAuthorizationPort {
  // A configuration object that is missing entirely must still fail closed
  // (as an unusable capability configuration) instead of crashing here.
  const configuredNow = (config as { readonly now?: unknown } | null | undefined)?.now;
  const now: () => Date =
    typeof configuredNow === 'function' ? (configuredNow as () => Date) : () => new Date();

  return {
    async authorizeReadiness(deps, input) {
      const binding = approvedReadinessBinding(input.commandType, input.commandVersion);
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readReadinessTarget(input.targetRef, binding, deps.context);
      assertReadinessInput(input, target, deps.context);
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
            'actor snapshot scope must be the exact request Project',
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
          await appendReadinessDeniedAudit(trx, deps, {
            commandType: binding.commandType,
            denial: reason,
            target,
            actorSnapshotId: actor.row.actor_snapshot_id,
            actorPrincipalId: actor.row.principal_id,
            commandPayloadHash: input.commandPayloadHash,
          });
          return { outcome: 'DENY' as const, reasons: [reason] };
        }
        const finding = await coveringReadinessGrant(deps, trx, {
          principalId: actor.row.principal_id,
          enterpriseId: target.enterpriseId,
          projectId: target.projectId,
          capabilityCode,
          requiredGrantAction: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: target.objectType,
          now: now(),
        });
        if ('denial' in finding) {
          await appendReadinessDeniedAudit(trx, deps, {
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

    async revalidateReadiness(deps, input) {
      const binding = approvedReadinessBinding(
        input.expectedCommandType,
        input.expectedCommandVersion,
      );
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readReadinessTarget(input.expectedTargetRef, binding, deps.context);
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
        // readable history but never authorizes one of the two versions.
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
        // Decision must still carry the capability code of this entry.
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

        const finding = await coveringReadinessGrant(deps, trx, {
          principalId: row.principal_id,
          enterpriseId: row.enterprise_id,
          projectId: target.projectId,
          capabilityCode,
          requiredGrantAction: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: row.target_object_type,
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
function invalid(reason: TaskExecutionReadinessRevalidationFailure): {
  readonly valid: false;
  readonly reason: TaskExecutionReadinessRevalidationFailure;
} {
  return { valid: false, reason };
}

/**
 * Exact resolution of one approved readiness version. An operation/version pair
 * that is not one of the two approved keys has no binding, and the binding must
 * agree with the published Purpose of its trusted configuration key (drift
 * fails closed).
 */
function approvedReadinessBinding(
  commandType: unknown,
  commandVersion: unknown,
): TaskExecutionReadinessBinding {
  if (typeof commandType !== 'string' || typeof commandVersion !== 'string') {
    throw new SnapshotBoundaryError(
      IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
      'readiness version must be an exact operation and version',
    );
  }
  const binding = TASK_EXECUTION_READINESS_BINDINGS.find(
    (candidate) =>
      candidate.commandType === commandType && candidate.commandVersion === commandVersion,
  );
  if (binding === undefined) {
    throw new SnapshotBoundaryError(
      IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
      'readiness version has no approved authorization binding',
    );
  }
  if (approvedPurposes[binding.capabilityConfigKey] !== binding.authorizationPurpose) {
    throw new SnapshotBoundaryError(
      IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
      'readiness binding Purpose does not match the published Purpose',
    );
  }
  return binding;
}

function configuredCapabilityCode(
  config: TaskExecutionReadinessAuthorizationConfig,
  key: TaskExecutionReadinessCapabilityKey,
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
      IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID,
      `trusted capability configuration for ${key} is missing or invalid`,
    );
  }
  return value;
}

/**
 * The target reference of one readiness request: an exact approved object type,
 * a UuidV7 and the exact Project Scope the request runs in. Enterprise scope,
 * an object type outside the entry's closed set, a wildcard, a case variant and
 * a target outside the trusted transaction scope are refused.
 */
function readReadinessTarget(
  targetRef: Common.ObjectRef,
  binding: TaskExecutionReadinessBinding,
  context: IdentityTransactionContext,
): ReadinessTarget {
  const candidate = targetRef as unknown as
    | { kind?: unknown; objectType?: unknown; objectId?: unknown; scope?: unknown }
    | null
    | undefined;
  const scope = candidate?.scope as
    { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
  const objectType = candidate?.objectType;
  if (
    candidate?.kind !== binding.targetKind ||
    typeof objectType !== 'string' ||
    !binding.targetObjectTypes.includes(objectType) ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    typeof scope?.enterpriseId !== 'string' ||
    typeof scope.projectId !== 'string' ||
    !Object.keys(scope).every((key) => key === 'enterpriseId' || key === 'projectId')
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_READINESS_TARGET_INVALID,
      'readiness target must be an accepted object type, id and Project Scope',
    );
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(scope.projectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_READINESS_TARGET_INVALID,
      'readiness target scope must match the trusted transaction scope',
    );
  }
  return {
    objectType,
    objectId: candidate.objectId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
  };
}

function assertReadinessInput(
  input: TaskExecutionReadinessAuthorizationInput,
  target: ReadinessTarget,
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
      'actor snapshot scope must be the exact request Project',
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
 * exact Project Scope, ACTIVE inside the trusted time window, the exact entry
 * action, the closed selector of that entry's selector type for the exact
 * target object type, an empty `constraints`, no `maxUses`, and — when a
 * Decision is already bound — exactly that Policy Snapshot, currently effective
 * and not superseded. Coverage is never assembled from several partial Grants.
 */
async function coveringReadinessGrant(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  query: ReadinessGrantQuery,
): Promise<ReadinessGrantFinding> {
  const grants = await deps.repo.listActiveCapabilityGrants(
    trx,
    query.principalId,
    query.enterpriseId,
    query.now,
  );
  let sawStalePolicy = false;
  let sawInvalidPolicy = false;
  for (const grant of grants) {
    if (!grantMatchesReadiness(grant, query)) continue;
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

function grantMatchesReadiness(
  grant: SelectedCapabilityGrant,
  query: ReadinessGrantQuery,
): boolean {
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
    selectorsCoverReadinessTarget(
      grant.resource_selectors,
      query.selectorType,
      query.targetObjectType,
    )
  );
}

/**
 * The closed selector shape of one entry. Every element of the array must be
 * exactly `{selectorType, objectType}` with *this* entry's selector type and a
 * NamespaceCode object type (no unknown field, no wildcard, no prefix, no
 * alias, no case variant), and at least one element must equal the exact target
 * object type of this request. The two selector types are never
 * interchangeable: a Grant selector of the other type fails the shape here.
 */
function selectorsCoverReadinessTarget(
  selectors: unknown,
  selectorType: TaskExecutionReadinessSelectorType,
  targetObjectType: string,
): boolean {
  if (!Array.isArray(selectors) || selectors.length === 0) return false;
  let matched = false;
  for (const selector of selectors) {
    if (selector === null || typeof selector !== 'object' || Array.isArray(selector)) return false;
    const candidate = selector as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === 'selectorType' || key === 'objectType') ||
      candidate.selectorType !== selectorType ||
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
 * Masked, in-scope audit of a denied readiness request. The entry stays inside
 * the trusted transaction scope and never carries the request payload.
 */
async function appendReadinessDeniedAudit(
  trx: IdentityTransaction,
  deps: IdentityCommandDeps,
  input: {
    readonly commandType: string;
    readonly denial: TaskExecutionReadinessDenialReason;
    readonly target: ReadinessTarget;
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
      safe_summary: `readiness authorization denied: ${input.denial}`,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}
