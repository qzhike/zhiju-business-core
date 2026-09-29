// IM-06 (#217): DRAFT Snapshot dependency-read authorization for the initial
// Context build.
//
// Design authority: Module-Spec-001 §15.9 and Spec 003 §20.2. This module is
// the IdentityPolicy owning boundary of the single approved DRAFT dependency
// read of `execution.build_initial_context_snapshot@1.1`:
//
// 1. `authorizeContextSnapshotDraftRead` signs one immutable
//    AuthorizationDecision for the exact consumer operation/version, the
//    trusted composition capability configuration, the exact ActorSnapshot,
//    the *complete* `draftSnapshotRef` the build request already carries and
//    the request facts. A caller or an Envelope can never supply or override
//    the capability code, the required Grant action, the Grant selector type
//    or the accepted target object type, and the composition layer never has
//    to read a TaskExecution table to discover a WorkOrder id before it can
//    name this target.
// 2. `revalidateContextSnapshotDraftRead` proves, before any TaskExecution
//    DRAFT fact is read or locked, before idempotency is claimed and before
//    any historical Receipt is returned, that the same exact Decision still
//    covers this request *now*: exact id/hash, actor and actual principal,
//    authentication context, consumer type/version/Purpose, payload hash, the
//    complete target reference (not only the promoted id), Project Scope,
//    ALLOW and expiry, plus a fresh read of the single covering Grant and its
//    Policy Snapshot. A cached or historical result never skips that step.
//
// The target is a ContentAddressedRef, which the two §15.8 entries never
// handle: their targets are bare OBJECT references. The canonical Decision
// payload therefore carries the complete target reference under
// `draftSnapshotRef` — kind, object type, object id, the existence and value
// of `immutableVersionId`, the exact Project Scope and the complete content
// hash triple (Spec 001 §15.9 rule 2). The V1006 promoted columns keep
// mirroring only `objectType`/`objectId`, and the payload `targetRef` keeps
// the V1006 OBJECT mirror shape: the owning read-side mirror check accepts
// exactly that shape, so the complete ContentAddressedRef is bound next to it
// instead of replacing it. Revalidation compares the stored complete
// reference field by field, so a Decision signed for snapshot A never
// authorizes snapshot B and a hash or version-id substitution behind the same
// promoted id is refused.
//
// Capability isolation (Spec 001 §15.9 rule 4): the build entry's
// `contextSnapshotBuildV11` never covers this dependency read; a caller's
// past `workOrderDraftReadV11` Decision, or the fact it once obtained the ref
// through `execution.get_work_order_draft`, never covers it either; and this
// entry in turn authorizes no public `get_work_order_draft` Query, no Source
// Slice read, no Policy resolution and no Context Snapshot read.
//
// Everything fails closed. An unknown consumer version, an unusable trusted
// configuration — including a deployment that never configures this entry's
// key, which must not fall back to the build capability or to a historical
// Decision (Spec 001 §15.9 rule 5) — a malformed or substituted target and a
// request outside the trusted transaction scope raise a stable error; a
// request that no single Grant completely covers is denied with a masked
// in-scope Audit. Neither path produces a success fact, a decision-carrying
// Outbox row or execution eligibility when it does not pass.
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

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
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
import {
  IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
} from './context-snapshot-authorization.js';
import { WORK_ORDER_DRAFT_READ_PURPOSE } from './work-order-draft-read-authorization.js';

/** The NamespaceCode shape of the shared contract (`Common.NamespaceCode`). */
const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** UuidV7, the identity shape every target and reference of this module uses. */
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const authorizationDecisionObjectType = 'identity.authorization_decision';
const policySnapshotObjectType = 'identity.policy_snapshot';
const actorSnapshotObjectType = 'identity.actor_snapshot';

/**
 * Trusted configuration key of the single approved DRAFT dependency read. The
 * key is independent of `contextSnapshotBuildV11` and `workOrderDraftReadV11`:
 * neither entry's code ever authorizes this read (Spec 001 §15.9 rule 4).
 */
export type ContextSnapshotDraftReadCapabilityKey = 'contextSnapshotDraftReadV11';

/**
 * The one Grant selector type this entry interprets: `TARGET_TYPE` selects the
 * exact `objectType` a request declares. `CREATE_TARGET_TYPE` belongs to the
 * build entry and is never accepted here.
 */
export type ContextSnapshotDraftReadSelectorType = 'TARGET_TYPE';

/**
 * The exact consumer identity, Purpose, Grant action, target kind, accepted
 * target object type, Grant selector type and trusted configuration key of the
 * single approved DRAFT dependency read (Spec 001 §15.9).
 */
export interface ContextSnapshotDraftReadBinding {
  /** The consuming operation: `execution.build_initial_context_snapshot`. */
  readonly commandType: string;
  /** The consuming operation version: `1.1`. */
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'CONTENT_ADDRESSED';
  /**
   * The closed accepted objectType set. The request's declared object type must
   * equal the single member exactly; the set is a closed list, never a pattern.
   */
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: ContextSnapshotDraftReadSelectorType;
  readonly capabilityConfigKey: ContextSnapshotDraftReadCapabilityKey;
}

/**
 * The closed approved mapping. A consumer operation/version pair outside this
 * table has no approved DRAFT dependency-read authorization at all: there is
 * no alias, prefix, case-insensitive, latest-version or implicit-default
 * resolution, and the entry never inherits the build entry's or the public
 * DRAFT-read entry's action, target spelling or config key. The Grant action
 * `execution.work_order.draft_snapshot.read.for_context_build.v1_1` is an
 * internal configuration token of Spec 001 §15.9: it enters no public Catalog
 * and no published metadata.
 */
export const CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS: readonly ContextSnapshotDraftReadBinding[] =
  Object.freeze([
    Object.freeze({
      commandType: 'execution.build_initial_context_snapshot',
      commandVersion: '1.1',
      authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
      requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_context_build.v1_1',
      targetKind: 'CONTENT_ADDRESSED',
      targetObjectTypes: Object.freeze(['zhiju.execution.work_order_draft_snapshot']),
      selectorType: 'TARGET_TYPE',
      capabilityConfigKey: 'contextSnapshotDraftReadV11',
    }),
  ]);

/**
 * The published Purpose indexed by the trusted configuration key, so a drift
 * between the binding table and the constant above fails closed instead of
 * signing a Decision under a Purpose no caller expects. The Purpose reuses the
 * already-published `execution.work_order.draft.read` value verbatim; sharing
 * it with the public DRAFT-read entries never merges this entry with them.
 */
const approvedPurposes: Readonly<Record<ContextSnapshotDraftReadCapabilityKey, string>> =
  Object.freeze({
    contextSnapshotDraftReadV11: WORK_ORDER_DRAFT_READ_PURPOSE,
  });

/**
 * Trusted composition capability configuration: one capability code for the
 * single approved DRAFT dependency read. The value is read from the
 * composition layer, never from a caller or an Envelope. A missing, blank or
 * non-NamespaceCode value fails closed; there is no fallback to the build
 * capability or to a historical Decision (Spec 001 §15.9 rule 5).
 */
export type ContextSnapshotDraftReadCapabilityCodes = Readonly<
  Record<ContextSnapshotDraftReadCapabilityKey, string>
>;

export interface ContextSnapshotDraftReadAuthorizationConfig {
  readonly capabilityCodes: ContextSnapshotDraftReadCapabilityCodes;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

/** The single stable reason a DRAFT dependency-read request was not allowed to proceed. */
export type ContextSnapshotDraftReadDenialReason =
  | 'PRINCIPAL_NOT_ACTIVE'
  | 'CAPABILITY_HUMAN_ONLY'
  | 'NO_ACTIVE_GRANT'
  | 'GRANT_POLICY_SNAPSHOT_INVALID'
  | 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT';

export interface ContextSnapshotDraftReadAuthorizationInput {
  /** Exact actor snapshot of the calling principal (id and payload hash). */
  readonly actorSnapshotRef: ActorSnapshotRef;
  /** The consuming operation: `execution.build_initial_context_snapshot`. */
  readonly commandType: string;
  /** The consuming operation version: `1.1`. */
  readonly commandVersion: string;
  /**
   * The complete DRAFT snapshot reference the build request already carries:
   * object type, id, the existence and value of `immutableVersionId`, the
   * exact Project Scope and the complete content hash.
   */
  readonly draftSnapshotRef: Common.ContentAddressedRef;
  /** The build request payload hash. */
  readonly commandPayloadHash: Buffer;
  readonly authenticationContextHash: Buffer;
}

export interface ContextSnapshotDraftReadAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly draftSnapshotRef: Common.ContentAddressedRef;
  readonly reasons: readonly string[];
  /** Present exactly when a Decision was issued. */
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

export interface ContextSnapshotDraftReadRevalidationInput {
  readonly decisionRef: Common.ContentAddressedRef;
  readonly expectedCommandType: string;
  readonly expectedCommandVersion: string;
  readonly expectedCommandPayloadHash: Buffer;
  readonly expectedAuthenticationContextHash: Buffer;
  /**
   * The complete DRAFT snapshot reference this request would submit, with its
   * exact Project Scope and complete content hash.
   */
  readonly expectedDraftSnapshotRef: Common.ContentAddressedRef;
}

/**
 * The closed outcome of a revalidation. A `false` result is never an ALLOW and
 * never restores eligibility; the reason names the single compared dimension
 * that failed.
 */
export type ContextSnapshotDraftReadRevalidationFailure =
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

export type ContextSnapshotDraftReadRevalidationResult =
  | {
      readonly valid: true;
      readonly authorizationDecisionRef: Common.ContentAddressedRef;
      readonly draftSnapshotRef: Common.ContentAddressedRef;
      readonly policySnapshotRef: Common.SnapshotRef;
      readonly expiresAt: Common.UtcInstant;
    }
  | {
      readonly valid: false;
      readonly reason: ContextSnapshotDraftReadRevalidationFailure;
    };

export interface ContextSnapshotDraftReadAuthorizationPort {
  /** Signs the exact DRAFT dependency-read Decision the request needs, or denies it. */
  authorizeContextSnapshotDraftRead(
    deps: IdentityCommandDeps,
    input: ContextSnapshotDraftReadAuthorizationInput,
  ): Promise<ContextSnapshotDraftReadAuthorizationView>;
  /** Proves that the presented Decision still covers this dependency read now. */
  revalidateContextSnapshotDraftRead(
    deps: IdentityCommandDeps,
    input: ContextSnapshotDraftReadRevalidationInput,
  ): Promise<ContextSnapshotDraftReadRevalidationResult>;
}

/** The validated target of one DRAFT dependency-read request. */
interface DraftSnapshotTarget {
  readonly objectType: string;
  readonly objectId: string;
  readonly immutableVersionId: string | undefined;
  readonly scope: Common.ScopeRef;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly contentHash: Common.ContentHash;
}

interface DraftSnapshotGrantQuery {
  readonly principalId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly capabilityCode: string;
  readonly requiredGrantAction: string;
  readonly selectorType: ContextSnapshotDraftReadSelectorType;
  readonly targetObjectType: string;
  /** Exact Policy Snapshot the Decision is bound to, when one already exists. */
  readonly policySnapshot?: { readonly id: string; readonly hash: Buffer } | undefined;
  readonly now: Date;
}

type DraftSnapshotGrantFinding =
  | { readonly policySnapshot: SelectedPolicySnapshot }
  | { readonly denial: ContextSnapshotDraftReadDenialReason };

/**
 * The owning port. The trusted configuration is resolved for every call, so a
 * value that is missing, blank or not a NamespaceCode can never authorize
 * anything, and the trusted clock is never a caller argument.
 */
export function createContextSnapshotDraftReadAuthorizationPort(
  config: ContextSnapshotDraftReadAuthorizationConfig,
): ContextSnapshotDraftReadAuthorizationPort {
  // A configuration object that is missing entirely must still fail closed
  // (as an unusable capability configuration) instead of crashing here.
  const configuredNow = (config as { readonly now?: unknown } | null | undefined)?.now;
  const now: () => Date =
    typeof configuredNow === 'function' ? (configuredNow as () => Date) : () => new Date();

  return {
    async authorizeContextSnapshotDraftRead(deps, input) {
      const binding = approvedDraftReadBinding(input.commandType, input.commandVersion);
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readDraftSnapshotTarget(input.draftSnapshotRef, binding, deps.context);
      assertDraftReadInput(input, target, deps.context);
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
          await appendDraftSnapshotDeniedAudit(trx, deps, {
            commandType: binding.commandType,
            denial: reason,
            target,
            actorSnapshotId: actor.row.actor_snapshot_id,
            actorPrincipalId: actor.row.principal_id,
            commandPayloadHash: input.commandPayloadHash,
          });
          return { outcome: 'DENY' as const, reasons: [reason] };
        }
        const finding = await coveringDraftSnapshotGrant(deps, trx, {
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
          await appendDraftSnapshotDeniedAudit(trx, deps, {
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
            // The V1006 OBJECT mirror of the promoted target columns; the
            // complete ContentAddressedRef is bound next to it below.
            targetRef: {
              kind: 'OBJECT',
              objectType: target.objectType,
              objectId: target.objectId,
              scope: { enterpriseId: target.enterpriseId, projectId: target.projectId },
            },
            // The complete target reference (Spec 001 §15.9 rule 2). An absent
            // immutableVersionId is bound as absence, never serialized as null.
            draftSnapshotRef: draftSnapshotRefPayload(target),
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
        return {
          outcome: 'DENY',
          draftSnapshotRef: input.draftSnapshotRef,
          reasons: decision.reasons,
        };
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
        draftSnapshotRef: input.draftSnapshotRef,
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

    async revalidateContextSnapshotDraftRead(deps, input) {
      const binding = approvedDraftReadBinding(
        input.expectedCommandType,
        input.expectedCommandVersion,
      );
      const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
      const target = readDraftSnapshotTarget(input.expectedDraftSnapshotRef, binding, deps.context);
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
        // readable history but never authorizes this dependency read.
        if (row.target_object_type === null || row.target_object_id === null) {
          return invalid('TARGET_UNBOUND');
        }
        if (
          row.target_object_type !== target.objectType ||
          row.target_object_id !== target.objectId
        ) {
          return invalid('TARGET_MISMATCH');
        }
        // The promoted id is not the target: the complete reference stored in
        // the canonical payload must equal the request ref field by field, so
        // a hash or version-id substitution behind the same id, or a Decision
        // signed for another snapshot, is refused (Spec 001 §15.9 rule 2).
        const storedPayload = row.canonical_payload as
          { readonly draftSnapshotRef?: unknown } | null | undefined;
        if (!storedDraftSnapshotRefMatches(storedPayload?.draftSnapshotRef, target)) {
          return invalid('TARGET_MISMATCH');
        }
        if (
          row.scope_kind !== 'PROJECT' ||
          row.enterprise_id !== target.enterpriseId ||
          row.project_id !== target.projectId ||
          !sameScope(input.decisionRef.scope, target.scope) ||
          !sameScope(input.expectedDraftSnapshotRef.scope, target.scope)
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

        const finding = await coveringDraftSnapshotGrant(deps, trx, {
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
          draftSnapshotRef: input.expectedDraftSnapshotRef,
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
function invalid(reason: ContextSnapshotDraftReadRevalidationFailure): {
  readonly valid: false;
  readonly reason: ContextSnapshotDraftReadRevalidationFailure;
} {
  return { valid: false, reason };
}

/**
 * Exact resolution of the single approved DRAFT dependency read. A consumer
 * operation/version pair that is not the approved key has no binding, and the
 * binding must agree with the published Purpose of its trusted configuration
 * key (drift fails closed).
 */
function approvedDraftReadBinding(
  commandType: unknown,
  commandVersion: unknown,
): ContextSnapshotDraftReadBinding {
  if (typeof commandType !== 'string' || typeof commandVersion !== 'string') {
    throw new SnapshotBoundaryError(
      IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
      'DRAFT dependency read must be an exact consumer operation and version',
    );
  }
  const binding = CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS.find(
    (candidate) =>
      candidate.commandType === commandType && candidate.commandVersion === commandVersion,
  );
  if (binding === undefined) {
    throw new SnapshotBoundaryError(
      IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
      'consumer version has no approved DRAFT dependency-read binding',
    );
  }
  if (approvedPurposes[binding.capabilityConfigKey] !== binding.authorizationPurpose) {
    throw new SnapshotBoundaryError(
      IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
      'DRAFT dependency-read binding Purpose does not match the published Purpose',
    );
  }
  return binding;
}

function configuredCapabilityCode(
  config: ContextSnapshotDraftReadAuthorizationConfig,
  key: ContextSnapshotDraftReadCapabilityKey,
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
      IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID,
      `trusted capability configuration for ${key} is missing or invalid`,
    );
  }
  return value;
}

/**
 * The target reference of one DRAFT dependency-read request: an exact
 * ContentAddressedRef of the single approved object type, a UuidV7 object id,
 * an optional UuidV7 `immutableVersionId`, the exact Project Scope the request
 * runs in and a complete SHA-256 content hash. Enterprise scope, any other
 * object type or kind, a wildcard, a case variant, a `null` masquerading as an
 * absent version id, an unknown scope or content-hash member and a target
 * outside the trusted transaction scope are refused.
 */
function readDraftSnapshotTarget(
  draftSnapshotRef: Common.ContentAddressedRef,
  binding: ContextSnapshotDraftReadBinding,
  context: IdentityTransactionContext,
): DraftSnapshotTarget {
  const candidate = draftSnapshotRef as unknown as
    | {
        kind?: unknown;
        objectType?: unknown;
        objectId?: unknown;
        immutableVersionId?: unknown;
        scope?: unknown;
        contentHash?: unknown;
      }
    | null
    | undefined;
  const scope = candidate?.scope as
    { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
  const hashShape = candidate?.contentHash as Record<string, unknown> | null | undefined;
  const objectType = candidate?.objectType;
  if (
    candidate?.kind !== binding.targetKind ||
    typeof objectType !== 'string' ||
    !binding.targetObjectTypes.includes(objectType) ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    (candidate.immutableVersionId !== undefined &&
      (typeof candidate.immutableVersionId !== 'string' ||
        !uuidV7Pattern.test(candidate.immutableVersionId))) ||
    typeof scope?.enterpriseId !== 'string' ||
    typeof scope.projectId !== 'string' ||
    !Object.keys(scope).every((key) => key === 'enterpriseId' || key === 'projectId') ||
    typeof hashShape !== 'object' ||
    hashShape === null ||
    Array.isArray(hashShape) ||
    !Object.keys(hashShape).every(
      (key) => key === 'algorithm' || key === 'digest' || key === 'canonicalizationVersion',
    )
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
      'DRAFT snapshot target must be the accepted object type, id and Project Scope',
    );
  }
  // The complete content hash is part of the target identity: it must be a
  // SHA-256 / canonicalization-v1 digest before the ref can bind a Decision.
  const contentHashDigest = contentHashToBuffer(
    candidate.contentHash,
    IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
    'DRAFT snapshot content hash',
  );
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(scope.projectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
      'DRAFT snapshot target scope must match the trusted transaction scope',
    );
  }
  return {
    objectType,
    objectId: candidate.objectId,
    immutableVersionId: candidate.immutableVersionId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
    contentHash: contentHash(contentHashDigest),
  };
}

/**
 * The canonical-payload serialization of the complete target reference. An
 * absent `immutableVersionId` is bound as absence: the member is not
 * serialized at all, so a `null` can never impersonate it and the stored
 * payload hash fixes the difference.
 */
function draftSnapshotRefPayload(target: DraftSnapshotTarget): CanonicalJsonObject {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: target.objectType,
    objectId: target.objectId,
    ...(target.immutableVersionId === undefined
      ? {}
      : { immutableVersionId: target.immutableVersionId }),
    scope: { enterpriseId: target.enterpriseId, projectId: target.projectId },
    contentHash: {
      algorithm: target.contentHash.algorithm,
      digest: target.contentHash.digest,
      canonicalizationVersion: target.contentHash.canonicalizationVersion,
    },
  };
}

/**
 * The complete target binding of a stored Decision: the canonical payload
 * member `draftSnapshotRef` must equal the validated request ref field by
 * field — kind, object type, object id, the existence and value of
 * `immutableVersionId`, the exact Project Scope and the complete content hash
 * triple. The promoted columns alone cannot see a hash or version-id
 * substitution, which is exactly what this comparison exists to refuse
 * (Spec 001 §15.9 rule 2).
 */
function storedDraftSnapshotRefMatches(stored: unknown, expected: DraftSnapshotTarget): boolean {
  const candidate = stored as
    | {
        kind?: unknown;
        objectType?: unknown;
        objectId?: unknown;
        immutableVersionId?: unknown;
        scope?: unknown;
        contentHash?: unknown;
      }
    | null
    | undefined;
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') {
    return false;
  }
  const hash = candidate.contentHash as
    { algorithm?: unknown; digest?: unknown; canonicalizationVersion?: unknown } | null | undefined;
  return (
    candidate.kind === 'CONTENT_ADDRESSED' &&
    candidate.objectType === expected.objectType &&
    candidate.objectId === expected.objectId &&
    (candidate.immutableVersionId === undefined
      ? expected.immutableVersionId === undefined
      : candidate.immutableVersionId === expected.immutableVersionId) &&
    sameScope(candidate.scope, expected.scope) &&
    hash !== null &&
    hash !== undefined &&
    typeof hash === 'object' &&
    !Array.isArray(hash) &&
    hash.algorithm === expected.contentHash.algorithm &&
    hash.digest === expected.contentHash.digest &&
    hash.canonicalizationVersion === expected.contentHash.canonicalizationVersion
  );
}

function assertDraftReadInput(
  input: ContextSnapshotDraftReadAuthorizationInput,
  target: DraftSnapshotTarget,
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
 * action, the closed selector of this entry's selector type for the exact
 * target object type, an empty `constraints`, no `maxUses`, and — when a
 * Decision is already bound — exactly that Policy Snapshot, currently effective
 * and not superseded. Coverage is never assembled from several partial Grants.
 */
async function coveringDraftSnapshotGrant(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  query: DraftSnapshotGrantQuery,
): Promise<DraftSnapshotGrantFinding> {
  const grants = await deps.repo.listActiveCapabilityGrants(
    trx,
    query.principalId,
    query.enterpriseId,
    query.now,
    query.capabilityCode,
  );
  let sawStalePolicy = false;
  let sawInvalidPolicy = false;
  for (const grant of grants) {
    if (!grantMatchesDraftSnapshot(grant, query)) continue;
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

function grantMatchesDraftSnapshot(
  grant: SelectedCapabilityGrant,
  query: DraftSnapshotGrantQuery,
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
    selectorsCoverDraftSnapshotTarget(
      grant.resource_selectors,
      query.selectorType,
      query.targetObjectType,
    )
  );
}

/**
 * The closed selector shape of this entry. Every element of the array must be
 * exactly `{selectorType, objectType}` with this entry's `TARGET_TYPE` selector
 * and a NamespaceCode object type (no unknown field, no wildcard, no prefix, no
 * alias, no case variant), and at least one element must equal the exact target
 * object type of this request. A build-entry `CREATE_TARGET_TYPE` selector
 * fails the shape here: the two selector types are never interchangeable.
 */
function selectorsCoverDraftSnapshotTarget(
  selectors: unknown,
  selectorType: ContextSnapshotDraftReadSelectorType,
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
 * Masked, in-scope audit of a denied DRAFT dependency-read request. The entry
 * stays inside the trusted transaction scope and never carries the request
 * payload.
 */
async function appendDraftSnapshotDeniedAudit(
  trx: IdentityTransaction,
  deps: IdentityCommandDeps,
  input: {
    readonly commandType: string;
    readonly denial: ContextSnapshotDraftReadDenialReason;
    readonly target: DraftSnapshotTarget;
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
      safe_summary: `context snapshot draft-read authorization denied: ${input.denial}`,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}
