// IM-06 (#219): WorkOrder Validation and Freeze authorization — the seven
// mutually non-substitutable internal mappings of Module-Spec-001 §15.10.
//
// Design authority: Module-Spec-001 §15.10 and Spec 003 §21. This module is the
// IdentityPolicy owning boundary of the seven approved authorization entries of
// the WorkOrder Validation / Freeze slice:
//
// - the own CREATE Decision of `execution.validate_work_order_draft@1.0`,
// - the own MUTATE Decision of `execution.freeze_work_order@1.0`,
// - the authoritative-read Decision of `execution.get_work_order_contract@1.0`,
// - the DRAFT snapshot dependency reads of validation and of freeze, and
// - the Context snapshot dependency reads of validation and of freeze.
//
// Each boundary has its own authorize/revalidate pair: `authorize…` signs one
// immutable AuthorizationDecision for the boundary's exact consumer
// operation/version, the trusted composition capability configuration, the
// exact ActorSnapshot, the exact target reference and the request facts;
// `revalidate…` proves, before any TaskExecution dependency fact is read or
// locked, before idempotency is claimed and before any historical Receipt is
// returned, that the same exact Decision still covers this request *now*:
// exact id/hash, actor and actual principal, authentication context, consumer
// type/version/Purpose, payload hash, the complete target reference (not only
// the promoted id), Project Scope, ALLOW and expiry, plus a fresh read of the
// single covering Grant and its Policy Snapshot. A cached or historical result
// never skips that step.
//
// A caller or an Envelope can never supply or override the capability code,
// the required Grant action, the Grant selector type or the accepted target
// object types, and the composition layer never has to read a TaskExecution
// table to discover a WorkOrder id before it can name a dependency target.
//
// The dependency targets are full references, which the own boundaries never
// handle: their targets are bare OBJECT references. The canonical Decision
// payload of a dependency entry therefore carries the complete target
// reference under `draftSnapshotRef` (ContentAddressedRef: kind, object type,
// object id, the existence and value of `immutableVersionId`, the exact
// Project Scope and the complete content hash triple) or `contextSnapshotRef`
// (SnapshotRef: kind, object type, object id, the required `snapshotId`, the
// exact Project Scope and the complete content hash triple; an
// `immutableVersionId` member is refused). The V1006 promoted columns keep
// mirroring only `objectType`/`objectId`, and the payload `targetRef` keeps
// the V1006 OBJECT mirror shape: the owning read-side mirror check accepts
// exactly that shape, so the complete reference is bound next to it instead of
// replacing it — a SNAPSHOT or CONTENT_ADDRESSED ref is never stuffed into the
// promoted OBJECT mirror columns (Spec 001 §15.10). Revalidation compares the
// stored complete reference field by field, so a Decision signed for snapshot
// A never authorizes snapshot B and a hash or version-id substitution behind
// the same promoted id is refused.
//
// Capability isolation (Spec 001 §15.10): the seven entries never cover one
// another — a validation Decision never authorizes a freeze, a build Decision
// never authorizes a dependency read, and the §15.9 build-specific
// `contextSnapshotDraftReadV11` entry, the public DRAFT/Context Query
// Decisions, historical Receipts, a shared Purpose and a shared principal
// never cover any of these entries either. The Validator Service and the
// Freeze Service each hold their own covering Grant; there is no Service
// wildcard.
//
// Everything fails closed. An unknown consumer version, an unusable trusted
// configuration — including a deployment that never configures one entry's
// key, which must not fall back to another entry's capability or to a
// historical Decision — a malformed or substituted target and a request
// outside the trusted transaction scope raise a stable error; a request that
// no single Grant completely covers is denied with a masked in-scope Audit.
// Neither path produces a success fact, a decision-carrying Outbox row or
// execution eligibility when it does not pass.
//
// A denial produces no Decision row on purpose: a Decision of this Port binds
// the exact Policy Snapshot of its covering Grant, and no Grant covered the
// request, so there is no Policy Snapshot the row could carry. The denial is
// recorded as a masked audit in the same transaction, exactly like the other
// owning entries of this module record their rejected requests.
//
// The first version binds canonical `@1.1` WorkOrder and INITIAL Context
// targets only: the legacy WorkOrder/Context spellings are not in the closed
// target sets of any entry (Spec 001 §15.10).
//
// The port is internal: it is not a registered operation, it never enters the
// Contract Catalog, and it does not change `identity.authorize_command@1.0`,
// which keeps rejecting non-`1.0` command versions and keeps its own
// acceptance set. TaskExecution consumes this port; it never reads these
// tables or this Repository.

import { newUuidV7, type CanonicalJsonObject, type CanonicalJsonValue } from '@zhiju/shared-kernel';
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
import { WORK_ORDER_DRAFT_READ_PURPOSE } from './work-order-draft-read-authorization.js';

export const IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED =
  'IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED';
export const IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID =
  'IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID';
export const IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID =
  'IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID';

/**
 * The Purposes of the seven approved entries (Spec 001 §15.10), published so
 * composition and the owning handlers never re-spell them. The DRAFT
 * dependency reads reuse the already-published `execution.work_order.draft.read`
 * value verbatim (`WORK_ORDER_DRAFT_READ_PURPOSE`); sharing a Purpose never
 * merges entries. The Context dependency reads carry the internal Purpose
 * `execution.context.snapshot.read`, which is deliberately *not* the published
 * `task.execution.get_context_snapshot` Query Purpose of §15.8.
 */
export const WORK_ORDER_DRAFT_VALIDATE_PURPOSE = 'execution.work_order.draft.validate';
export const WORK_ORDER_FREEZE_PURPOSE = 'task.execution.freeze_work_order';
export const WORK_ORDER_CONTRACT_READ_PURPOSE = 'task.execution.get_work_order_contract';
export const WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE = 'execution.context.snapshot.read';

/** The NamespaceCode shape of the shared contract (`Common.NamespaceCode`). */
const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** UuidV7, the identity shape every target and reference of this module uses. */
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const authorizationDecisionObjectType = 'identity.authorization_decision';
const policySnapshotObjectType = 'identity.policy_snapshot';
const actorSnapshotObjectType = 'identity.actor_snapshot';

/**
 * Trusted configuration key of one approved entry. The seven keys are
 * independent: no entry ever reads another entry's code.
 */
export type WorkOrderValidationCapabilityKey =
  | 'workOrderValidationBuildV1'
  | 'workOrderFreezeV1'
  | 'workOrderContractReadV1'
  | 'workOrderValidationDraftReadV1'
  | 'workOrderFreezeDraftReadV1'
  | 'workOrderValidationContextReadV1'
  | 'workOrderFreezeContextReadV1';

/**
 * The Grant selector type each entry interprets. `CREATE_TARGET_TYPE` keeps its
 * §15.2 meaning for the own CREATE of validation; `TARGET_TYPE` is interpreted
 * by the MUTATE, read and dependency entries. The two types are never
 * interchangeable.
 */
export type WorkOrderValidationSelectorType = 'CREATE_TARGET_TYPE' | 'TARGET_TYPE';

/**
 * The target reference kind of one entry: the own boundaries bind a bare
 * `OBJECT` reference; the DRAFT dependency reads bind a complete
 * `CONTENT_ADDRESSED` reference; the Context dependency reads bind a complete
 * `SNAPSHOT` reference. The three kinds are never interchangeable.
 */
export type WorkOrderValidationTargetKind =
  'OBJECT' | 'CONTENT_ADDRESSED' | 'SNAPSHOT' | 'VERSIONED';

/**
 * The consuming boundary of one approved entry. `(commandType, commandVersion)`
 * alone does not identify an entry — validation and freeze each own one DRAFT
 * and one Context dependency read under the same consumer operation/version —
 * so this closed key is the entry's identity.
 */
export type WorkOrderValidationBoundary =
  | 'validationBuild'
  | 'freeze'
  | 'contractRead'
  | 'validationDraftRead'
  | 'freezeDraftRead'
  | 'validationContextRead'
  | 'freezeContextRead';

/**
 * The exact identity, Purpose, Grant action, target kind, accepted target
 * object types, Grant selector type and trusted configuration key of one
 * approved entry (Spec 001 §15.10).
 */
interface AuthorizationEntryBinding {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: WorkOrderValidationTargetKind;
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: WorkOrderValidationSelectorType;
  readonly capabilityConfigKey: string;
  readonly targetPayloadMember?: string;
  readonly expectedPrincipalKind?: 'HUMAN' | 'SERVICE';
  readonly forbidActingFor?: boolean;
  readonly principalKinds?: readonly string[];
  readonly allowedServicePrincipalIds?: readonly string[];
  readonly enterpriseResource?: boolean;
}

export interface WorkOrderValidationBinding extends AuthorizationEntryBinding {
  readonly boundary: WorkOrderValidationBoundary;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: WorkOrderValidationTargetKind;
  /**
   * The closed accepted objectType set. The request's declared object type must
   * equal one member exactly; the set is a closed list, never a pattern.
   */
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: WorkOrderValidationSelectorType;
  readonly capabilityConfigKey: WorkOrderValidationCapabilityKey;
}

/**
 * The closed approved mapping of Spec 001 §15.10. A consumer boundary outside
 * this table has no approved authorization at all: there is no alias, prefix,
 * case-insensitive, latest-version or implicit-default resolution, and the
 * seven entries never inherit one another's Purpose, action, selector, target
 * set or config key. The Grant actions are internal configuration tokens: they
 * enter no public Catalog and no published metadata. Legacy WorkOrder/Context
 * spellings are not in any closed target set.
 */
export const WORK_ORDER_VALIDATION_BINDINGS: readonly WorkOrderValidationBinding[] = Object.freeze([
  Object.freeze({
    boundary: 'validationBuild',
    commandType: 'execution.validate_work_order_draft',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
    requiredGrantAction: 'execution.work_order.validation.create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order_validation']),
    selectorType: 'CREATE_TARGET_TYPE',
    capabilityConfigKey: 'workOrderValidationBuildV1',
  }),
  Object.freeze({
    boundary: 'freeze',
    commandType: 'execution.freeze_work_order',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_FREEZE_PURPOSE,
    requiredGrantAction: 'execution.work_order.freeze.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderFreezeV1',
  }),
  Object.freeze({
    boundary: 'contractRead',
    commandType: 'execution.get_work_order_contract',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_CONTRACT_READ_PURPOSE,
    requiredGrantAction: 'execution.work_order.contract.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderContractReadV1',
  }),
  Object.freeze({
    boundary: 'validationDraftRead',
    commandType: 'execution.validate_work_order_draft',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
    requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_validation.v1',
    targetKind: 'CONTENT_ADDRESSED',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order_draft_snapshot']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderValidationDraftReadV1',
  }),
  Object.freeze({
    boundary: 'freezeDraftRead',
    commandType: 'execution.freeze_work_order',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
    requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_freeze.v1',
    targetKind: 'CONTENT_ADDRESSED',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order_draft_snapshot']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderFreezeDraftReadV1',
  }),
  Object.freeze({
    boundary: 'validationContextRead',
    commandType: 'execution.validate_work_order_draft',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
    requiredGrantAction: 'execution.context.snapshot.read.for_validation.v1',
    targetKind: 'SNAPSHOT',
    targetObjectTypes: Object.freeze(['zhiju.execution.context_snapshot']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderValidationContextReadV1',
  }),
  Object.freeze({
    boundary: 'freezeContextRead',
    commandType: 'execution.freeze_work_order',
    commandVersion: '1.0',
    authorizationPurpose: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
    requiredGrantAction: 'execution.context.snapshot.read.for_freeze.v1',
    targetKind: 'SNAPSHOT',
    targetObjectTypes: Object.freeze(['zhiju.execution.context_snapshot']),
    selectorType: 'TARGET_TYPE',
    capabilityConfigKey: 'workOrderFreezeContextReadV1',
  }),
]);

/**
 * The published Purpose indexed by the trusted configuration key, so a drift
 * between the binding table and the constants above fails closed instead of
 * signing a Decision under a Purpose no caller expects.
 */
const approvedPurposes: Readonly<Record<WorkOrderValidationCapabilityKey, string>> = Object.freeze({
  workOrderValidationBuildV1: WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
  workOrderFreezeV1: WORK_ORDER_FREEZE_PURPOSE,
  workOrderContractReadV1: WORK_ORDER_CONTRACT_READ_PURPOSE,
  workOrderValidationDraftReadV1: WORK_ORDER_DRAFT_READ_PURPOSE,
  workOrderFreezeDraftReadV1: WORK_ORDER_DRAFT_READ_PURPOSE,
  workOrderValidationContextReadV1: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
  workOrderFreezeContextReadV1: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
});

/**
 * Trusted composition capability configuration: one capability code per
 * approved entry. The values may be equal and are read from the composition
 * layer, never from a caller or an Envelope. A missing, blank or
 * non-NamespaceCode value fails closed for that entry; there is no fallback to
 * another entry's capability or to a historical Decision.
 */
export type WorkOrderValidationCapabilityCodes = Readonly<
  Record<WorkOrderValidationCapabilityKey, string>
>;

export interface WorkOrderValidationAuthorizationConfig {
  readonly capabilityCodes: WorkOrderValidationCapabilityCodes;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

/** The single stable reason a request of this slice was not allowed to proceed. */
export type WorkOrderValidationDenialReason =
  | 'PRINCIPAL_NOT_ACTIVE'
  | 'CAPABILITY_HUMAN_ONLY'
  | 'NO_ACTIVE_GRANT'
  | 'GRANT_POLICY_SNAPSHOT_INVALID'
  | 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT';

/** The request fields every entry of this slice shares. */
interface WorkOrderValidationEntryRequest {
  /** Exact actor snapshot of the calling principal (id and payload hash). */
  readonly actorSnapshotRef: ActorSnapshotRef;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly commandPayloadHash: Buffer;
  readonly authenticationContextHash: Buffer;
}

/** The authorize input of the three own boundaries. */
export interface WorkOrderValidationAuthorizationInput extends WorkOrderValidationEntryRequest {
  /** The exact target of this request: object type, id and Project Scope. */
  readonly targetRef: Common.ObjectRef;
}

/** The authorize input of the two DRAFT dependency-read boundaries. */
export interface WorkOrderValidationDraftReadAuthorizationInput extends WorkOrderValidationEntryRequest {
  /**
   * The complete DRAFT snapshot reference the request already carries: object
   * type, id, the existence and value of `immutableVersionId`, the exact
   * Project Scope and the complete content hash.
   */
  readonly draftSnapshotRef: Common.ContentAddressedRef;
}

/** The authorize input of the two Context dependency-read boundaries. */
export interface WorkOrderValidationContextReadAuthorizationInput extends WorkOrderValidationEntryRequest {
  /**
   * The complete Context snapshot reference the request already carries: object
   * type, id, the required independent `snapshotId`, the exact
   * Project Scope and the complete content hash. An `immutableVersionId` member
   * is refused.
   */
  readonly contextSnapshotRef: Common.SnapshotRef;
}

export interface WorkOrderValidationAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly targetRef: Common.ObjectRef;
  readonly reasons: readonly string[];
  /** Present exactly when a Decision was issued. */
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

export interface WorkOrderValidationDraftReadAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly draftSnapshotRef: Common.ContentAddressedRef;
  readonly reasons: readonly string[];
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

export interface WorkOrderValidationContextReadAuthorizationView {
  readonly outcome: 'ALLOW' | 'DENY';
  readonly contextSnapshotRef: Common.SnapshotRef;
  readonly reasons: readonly string[];
  readonly authorizationDecisionRef?: Common.ContentAddressedRef | undefined;
  readonly policySnapshotRef?: Common.SnapshotRef | undefined;
  readonly expiresAt?: Common.UtcInstant | undefined;
}

/** The revalidation fields every entry of this slice shares. */
interface WorkOrderValidationEntryRevalidation {
  readonly decisionRef: Common.ContentAddressedRef;
  readonly expectedCommandType: string;
  readonly expectedCommandVersion: string;
  readonly expectedCommandPayloadHash: Buffer;
  readonly expectedAuthenticationContextHash: Buffer;
}

/** The revalidation input of the three own boundaries. */
export interface WorkOrderValidationRevalidationInput extends WorkOrderValidationEntryRevalidation {
  /** The exact target this request would submit, with its exact Project Scope. */
  readonly expectedTargetRef: Common.ObjectRef;
}

/** The revalidation input of the two DRAFT dependency-read boundaries. */
export interface WorkOrderValidationDraftReadRevalidationInput extends WorkOrderValidationEntryRevalidation {
  /**
   * The complete DRAFT snapshot reference this request would submit, with its
   * exact Project Scope and complete content hash.
   */
  readonly expectedDraftSnapshotRef: Common.ContentAddressedRef;
}

/** The revalidation input of the two Context dependency-read boundaries. */
export interface WorkOrderValidationContextReadRevalidationInput extends WorkOrderValidationEntryRevalidation {
  /**
   * The complete Context snapshot reference this request would submit, with its
   * required `snapshotId`, exact Project Scope and complete content hash.
   */
  readonly expectedContextSnapshotRef: Common.SnapshotRef;
}

/**
 * The closed outcome of a revalidation. A `false` result is never an ALLOW and
 * never restores eligibility; the reason names the single compared dimension
 * that failed.
 */
export type WorkOrderValidationRevalidationFailure =
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

interface WorkOrderValidationRevalidationAllow {
  readonly valid: true;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly policySnapshotRef: Common.SnapshotRef;
  /** The exact covering Grant the revalidation selected, when available. */
  readonly selectedGrant?: SelectedAuthorizationGrant;
  readonly expiresAt: Common.UtcInstant;
}

interface WorkOrderValidationRevalidationDeny {
  readonly valid: false;
  readonly reason: WorkOrderValidationRevalidationFailure;
}

export type WorkOrderValidationRevalidationResult =
  | (WorkOrderValidationRevalidationAllow & { readonly targetRef: Common.ObjectRef })
  | WorkOrderValidationRevalidationDeny;

export type WorkOrderValidationDraftReadRevalidationResult =
  | (WorkOrderValidationRevalidationAllow & {
      readonly draftSnapshotRef: Common.ContentAddressedRef;
    })
  | WorkOrderValidationRevalidationDeny;

export type WorkOrderValidationContextReadRevalidationResult =
  | (WorkOrderValidationRevalidationAllow & { readonly contextSnapshotRef: Common.SnapshotRef })
  | WorkOrderValidationRevalidationDeny;

export interface WorkOrderValidationAuthorizationPort {
  /** Signs the own CREATE Decision of `execution.validate_work_order_draft@1.0`, or denies it. */
  authorizeWorkOrderValidation(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationAuthorizationInput,
  ): Promise<WorkOrderValidationAuthorizationView>;
  /** Proves that the presented validation-build Decision still covers this request now. */
  revalidateWorkOrderValidation(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationRevalidationInput,
  ): Promise<WorkOrderValidationRevalidationResult>;
  /** Signs the own MUTATE Decision of `execution.freeze_work_order@1.0`, or denies it. */
  authorizeWorkOrderFreeze(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationAuthorizationInput,
  ): Promise<WorkOrderValidationAuthorizationView>;
  /** Proves that the presented freeze Decision still covers this request now. */
  revalidateWorkOrderFreeze(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationRevalidationInput,
  ): Promise<WorkOrderValidationRevalidationResult>;
  /** Signs the authoritative-read Decision of `execution.get_work_order_contract@1.0`, or denies it. */
  authorizeWorkOrderContractRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationAuthorizationInput,
  ): Promise<WorkOrderValidationAuthorizationView>;
  /** Proves that the presented contract-read Decision still covers this request now. */
  revalidateWorkOrderContractRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationRevalidationInput,
  ): Promise<WorkOrderValidationRevalidationResult>;
  /** Signs the validation DRAFT dependency-read Decision, or denies it. */
  authorizeValidationDraftRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadAuthorizationInput,
  ): Promise<WorkOrderValidationDraftReadAuthorizationView>;
  /** Proves that the presented validation DRAFT dependency-read Decision still covers this read now. */
  revalidateValidationDraftRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadRevalidationInput,
  ): Promise<WorkOrderValidationDraftReadRevalidationResult>;
  /** Signs the freeze DRAFT dependency-read Decision, or denies it. */
  authorizeFreezeDraftRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadAuthorizationInput,
  ): Promise<WorkOrderValidationDraftReadAuthorizationView>;
  /** Proves that the presented freeze DRAFT dependency-read Decision still covers this read now. */
  revalidateFreezeDraftRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadRevalidationInput,
  ): Promise<WorkOrderValidationDraftReadRevalidationResult>;
  /** Signs the validation Context dependency-read Decision, or denies it. */
  authorizeValidationContextRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadAuthorizationInput,
  ): Promise<WorkOrderValidationContextReadAuthorizationView>;
  /** Proves that the presented validation Context dependency-read Decision still covers this read now. */
  revalidateValidationContextRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadRevalidationInput,
  ): Promise<WorkOrderValidationContextReadRevalidationResult>;
  /** Signs the freeze Context dependency-read Decision, or denies it. */
  authorizeFreezeContextRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadAuthorizationInput,
  ): Promise<WorkOrderValidationContextReadAuthorizationView>;
  /** Proves that the presented freeze Context dependency-read Decision still covers this read now. */
  revalidateFreezeContextRead(
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadRevalidationInput,
  ): Promise<WorkOrderValidationContextReadRevalidationResult>;
}

/** The validated target of one request of this slice, per target kind. */
type WorkOrderValidationTarget =
  | {
      readonly kind: 'OBJECT';
      readonly objectType: string;
      readonly objectId: string;
      readonly scope: Common.ScopeRef;
      readonly enterpriseId: string;
      readonly projectId: string;
    }
  | {
      readonly kind: 'VERSIONED';
      readonly resourceScope?: Common.ScopeRef;
      readonly objectType: string;
      readonly objectId: string;
      readonly versionId: string;
      readonly scope: Common.ScopeRef;
      readonly enterpriseId: string;
      readonly projectId: string;
    }
  | {
      readonly kind: 'CONTENT_ADDRESSED';
      readonly objectType: string;
      readonly objectId: string;
      readonly immutableVersionId: string | undefined;
      readonly scope: Common.ScopeRef;
      readonly enterpriseId: string;
      readonly projectId: string;
      readonly contentHash: Common.ContentHash;
    }
  | {
      readonly kind: 'SNAPSHOT';
      readonly objectType: string;
      readonly objectId: string;
      readonly snapshotId: string;
      readonly scope: Common.ScopeRef;
      readonly enterpriseId: string;
      readonly projectId: string;
      readonly contentHash: Common.ContentHash;
    };

interface WorkOrderValidationGrantQuery {
  readonly principalId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly capabilityCode: string;
  readonly requiredGrantAction: string;
  readonly selectorType: WorkOrderValidationSelectorType;
  readonly targetObjectType: string;
  /** Exact Policy Snapshot the Decision is bound to, when one already exists. */
  readonly policySnapshot?: { readonly id: string; readonly hash: Buffer } | undefined;
  readonly now: Date;
}

type WorkOrderValidationGrantFinding =
  | { readonly policySnapshot: SelectedPolicySnapshot; readonly grant: SelectedCapabilityGrant }
  | { readonly denial: WorkOrderValidationDenialReason };

/**
 * The exact selected covering Grant facts of one allowed mapping. The Grant
 * carries no payload hash of its own; its immutable identity is covered by the
 * id, the owning Policy Snapshot binding and the aggregate version.
 */
export interface SelectedAuthorizationGrant {
  readonly grantId: string;
  readonly capabilityCode: string;
  readonly scopeKind: 'ENTERPRISE' | 'PROJECT';
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly actions: readonly string[];
  readonly resourceSelectors: readonly CanonicalJsonValue[];
  readonly grantPolicySnapshotId: string;
  readonly grantPolicySnapshotHash: string;
  readonly aggregateVersion: string;
}

function selectedGrantFacts(grant: SelectedCapabilityGrant): SelectedAuthorizationGrant {
  return {
    grantId: grant.id,
    capabilityCode: grant.capability_code,
    scopeKind: grant.scope_kind,
    enterpriseId: grant.enterprise_id,
    projectId: grant.project_id ?? null,
    actions: [...grant.actions],
    resourceSelectors: [...(grant.resource_selectors as readonly CanonicalJsonValue[])],
    grantPolicySnapshotId: grant.grant_policy_snapshot_id,
    grantPolicySnapshotHash: grant.grant_policy_snapshot_hash.toString('hex'),
    aggregateVersion: grant.aggregate_version,
  };
}

type IssuedEntryDecision =
  | { readonly outcome: 'DENY'; readonly reasons: readonly string[] }
  | {
      readonly outcome: 'ALLOW';
      readonly reasons: readonly string[];
      readonly authorizationDecisionRef: Common.ContentAddressedRef;
      readonly policySnapshotRef: Common.SnapshotRef;
      readonly expiresAt: Common.UtcInstant;
    };

type RevalidatedEntryDecision =
  | {
      readonly valid: true;
      readonly authorizationDecisionRef: Common.ContentAddressedRef;
      readonly policySnapshotRef: Common.SnapshotRef;
      readonly selectedGrant?: SelectedAuthorizationGrant;
      readonly expiresAt: Common.UtcInstant;
    }
  | WorkOrderValidationRevalidationDeny;

/**
 * The owning port of the seven approved entries. The trusted configuration is
 * resolved for every call, so a value that is missing, blank or not a
 * NamespaceCode can never authorize anything, and the trusted clock is never a
 * caller argument.
 */
export function createWorkOrderValidationAuthorizationPort(
  config: WorkOrderValidationAuthorizationConfig,
): WorkOrderValidationAuthorizationPort {
  // A configuration object that is missing entirely must still fail closed
  // (as an unusable capability configuration) instead of crashing here.
  const configuredNow = (config as { readonly now?: unknown } | null | undefined)?.now;
  const now: () => Date =
    typeof configuredNow === 'function' ? (configuredNow as () => Date) : () => new Date();

  const authorizeOwn = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationAuthorizationInput,
  ): Promise<WorkOrderValidationAuthorizationView> => {
    const issued = await issueEntryDecision(config, now, boundary, deps, input, input.targetRef);
    if (issued.outcome === 'DENY') {
      return { outcome: 'DENY', targetRef: input.targetRef, reasons: issued.reasons };
    }
    return { ...issued, targetRef: input.targetRef };
  };

  const revalidateOwn = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationRevalidationInput,
  ): Promise<WorkOrderValidationRevalidationResult> => {
    const result = await revalidateEntryDecision(
      config,
      now,
      boundary,
      deps,
      input,
      input.expectedTargetRef,
    );
    if (!result.valid) return result;
    return { ...result, targetRef: input.expectedTargetRef };
  };

  const authorizeDraftRead = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadAuthorizationInput,
  ): Promise<WorkOrderValidationDraftReadAuthorizationView> => {
    const issued = await issueEntryDecision(
      config,
      now,
      boundary,
      deps,
      input,
      input.draftSnapshotRef,
    );
    if (issued.outcome === 'DENY') {
      return { outcome: 'DENY', draftSnapshotRef: input.draftSnapshotRef, reasons: issued.reasons };
    }
    return { ...issued, draftSnapshotRef: input.draftSnapshotRef };
  };

  const revalidateDraftRead = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationDraftReadRevalidationInput,
  ): Promise<WorkOrderValidationDraftReadRevalidationResult> => {
    const result = await revalidateEntryDecision(
      config,
      now,
      boundary,
      deps,
      input,
      input.expectedDraftSnapshotRef,
    );
    if (!result.valid) return result;
    return { ...result, draftSnapshotRef: input.expectedDraftSnapshotRef };
  };

  const authorizeContextRead = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadAuthorizationInput,
  ): Promise<WorkOrderValidationContextReadAuthorizationView> => {
    const issued = await issueEntryDecision(
      config,
      now,
      boundary,
      deps,
      input,
      input.contextSnapshotRef,
    );
    if (issued.outcome === 'DENY') {
      return {
        outcome: 'DENY',
        contextSnapshotRef: input.contextSnapshotRef,
        reasons: issued.reasons,
      };
    }
    return { ...issued, contextSnapshotRef: input.contextSnapshotRef };
  };

  const revalidateContextRead = async (
    boundary: WorkOrderValidationBoundary,
    deps: IdentityCommandDeps,
    input: WorkOrderValidationContextReadRevalidationInput,
  ): Promise<WorkOrderValidationContextReadRevalidationResult> => {
    const result = await revalidateEntryDecision(
      config,
      now,
      boundary,
      deps,
      input,
      input.expectedContextSnapshotRef,
    );
    if (!result.valid) return result;
    return { ...result, contextSnapshotRef: input.expectedContextSnapshotRef };
  };

  return {
    authorizeWorkOrderValidation: (deps, input) => authorizeOwn('validationBuild', deps, input),
    revalidateWorkOrderValidation: (deps, input) => revalidateOwn('validationBuild', deps, input),
    authorizeWorkOrderFreeze: (deps, input) => authorizeOwn('freeze', deps, input),
    revalidateWorkOrderFreeze: (deps, input) => revalidateOwn('freeze', deps, input),
    authorizeWorkOrderContractRead: (deps, input) => authorizeOwn('contractRead', deps, input),
    revalidateWorkOrderContractRead: (deps, input) => revalidateOwn('contractRead', deps, input),
    authorizeValidationDraftRead: (deps, input) =>
      authorizeDraftRead('validationDraftRead', deps, input),
    revalidateValidationDraftRead: (deps, input) =>
      revalidateDraftRead('validationDraftRead', deps, input),
    authorizeFreezeDraftRead: (deps, input) => authorizeDraftRead('freezeDraftRead', deps, input),
    revalidateFreezeDraftRead: (deps, input) => revalidateDraftRead('freezeDraftRead', deps, input),
    authorizeValidationContextRead: (deps, input) =>
      authorizeContextRead('validationContextRead', deps, input),
    revalidateValidationContextRead: (deps, input) =>
      revalidateContextRead('validationContextRead', deps, input),
    authorizeFreezeContextRead: (deps, input) =>
      authorizeContextRead('freezeContextRead', deps, input),
    revalidateFreezeContextRead: (deps, input) =>
      revalidateContextRead('freezeContextRead', deps, input),
  };
}

/**
 * Signs the exact target-bound Decision of one entry, or records the masked
 * denial. The complete target reference of a dependency entry is bound in the
 * canonical payload next to the V1006 OBJECT mirror; the promoted columns keep
 * the OBJECT mirror shape only (Spec 001 §15.10).
 */
async function issueEntryDecision(
  config: WorkOrderValidationAuthorizationConfig,
  now: () => Date,
  boundary: WorkOrderValidationBoundary | undefined,
  deps: IdentityCommandDeps,
  input: WorkOrderValidationEntryRequest,
  rawTarget: unknown,
  entryBinding?: AuthorizationEntryBinding,
): Promise<IssuedEntryDecision> {
  const binding =
    entryBinding ??
    approvedValidationBinding(
      boundary ?? 'validationBuild',
      input.commandType,
      input.commandVersion,
    );
  const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
  const target = readValidationTarget(rawTarget, binding, deps.context);
  assertValidationInput(input, target, deps.context);
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
    const principalInactive =
      principal?.status !== 'ACTIVE' ||
      (binding.forbidActingFor === true && actor.row.acting_for_principal_id !== null) ||
      (binding.expectedPrincipalKind !== undefined &&
        principalKind !== binding.expectedPrincipalKind) ||
      (binding.principalKinds !== undefined && !binding.principalKinds.includes(principalKind)) ||
      (principalKind === 'SERVICE' &&
        binding.allowedServicePrincipalIds !== undefined &&
        !binding.allowedServicePrincipalIds.includes(actor.row.principal_id));
    const humanOnlyViolation = isHumanOnlyCapability(capabilityCode) && principalKind !== 'HUMAN';
    if (principalInactive || humanOnlyViolation) {
      const reason = principalInactive
        ? ('PRINCIPAL_NOT_ACTIVE' as const)
        : ('CAPABILITY_HUMAN_ONLY' as const);
      await appendWorkOrderValidationDeniedAudit(trx, deps, {
        commandType: binding.commandType,
        denial: reason,
        target,
        actorSnapshotId: actor.row.actor_snapshot_id,
        actorPrincipalId: actor.row.principal_id,
        commandPayloadHash: input.commandPayloadHash,
      });
      return { outcome: 'DENY' as const, reasons: [reason] };
    }
    const finding = await coveringValidationGrant(deps, trx, {
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
      await appendWorkOrderValidationDeniedAudit(trx, deps, {
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
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + DECISION_DEFAULT_TTL_SECONDS * 1000);
    const reasons = ['ALLOWED_BY_GRANT'];
    const policySnapshot = finding.policySnapshot;
    const dependencyMember = dependencyRefMember(target, binding);
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
        // Historical confirmation and its Receipt use the trusted application
        // clock, independently of PostgreSQL's technical insertion timestamp.
        ...(binding.capabilityConfigKey === 'customerMaterialConfirmV1'
          ? { requestedAt: issuedAt.toISOString() }
          : {}),
        expiresAt: expiresAt.toISOString(),
        reasonCodes: reasons,
        // The V1006 OBJECT mirror of the promoted target columns; the complete
        // dependency reference is bound next to it below.
        targetRef: {
          kind: 'OBJECT',
          objectType: target.objectType,
          objectId: target.objectId,
          scope: { enterpriseId: target.enterpriseId, projectId: target.projectId },
        },
        ...(dependencyMember === undefined ? {} : { [dependencyMember[0]]: dependencyMember[1] }),
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
    return { outcome: 'DENY', reasons: decision.reasons };
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
    throw new SnapshotBoundaryError(IDENTITY_DECISION_INPUT_INVALID, 'decision persistence failed');
  }
  return {
    outcome: 'ALLOW',
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
}

/**
 * Proves that the presented Decision still covers this request now: exact
 * id/hash, integrity recompute, actor and actual principal, ALLOW, target
 * binding (promoted columns and, for a dependency entry, the complete stored
 * reference), Project Scope, operation/version/Purpose, current configuration,
 * payload and authentication-context hashes, expiry, a re-read ActorSnapshot,
 * the current principal state and a fresh read of the covering Grant and its
 * Policy Snapshot at the trusted time.
 */
async function revalidateEntryDecision(
  config: WorkOrderValidationAuthorizationConfig,
  now: () => Date,
  boundary: WorkOrderValidationBoundary | undefined,
  deps: IdentityCommandDeps,
  input: WorkOrderValidationEntryRevalidation,
  rawTarget: unknown,
  entryBinding?: AuthorizationEntryBinding,
  transaction?: IdentityTransaction,
): Promise<RevalidatedEntryDecision> {
  const binding =
    entryBinding ??
    approvedValidationBinding(
      boundary ?? 'validationBuild',
      input.expectedCommandType,
      input.expectedCommandVersion,
    );
  const capabilityCode = configuredCapabilityCode(config, binding.capabilityConfigKey);
  const target = readValidationTarget(rawTarget, binding, deps.context);
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

  const check = async (trx: IdentityTransaction): Promise<RevalidatedEntryDecision> => {
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
    // readable history but never authorizes one of the seven entries.
    if (row.target_object_type === null || row.target_object_id === null) {
      return invalid('TARGET_UNBOUND');
    }
    if (row.target_object_type !== target.objectType || row.target_object_id !== target.objectId) {
      return invalid('TARGET_MISMATCH');
    }
    // The promoted id is not the target: the complete reference stored in the
    // canonical payload must equal the request ref field by field, so a hash,
    // snapshot-id or version-id substitution behind the same id, or a Decision
    // signed for another snapshot, is refused (Spec 001 §15.10).
    if (!storedDependencyRefMatches(row.canonical_payload, target, binding)) {
      return invalid('TARGET_MISMATCH');
    }
    if (
      row.scope_kind !== 'PROJECT' ||
      row.enterprise_id !== target.enterpriseId ||
      row.project_id !== target.projectId ||
      !sameScope(input.decisionRef.scope, target.scope)
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
    if (
      principal?.status !== 'ACTIVE' ||
      (binding.forbidActingFor === true && actor.row.acting_for_principal_id !== null) ||
      (binding.expectedPrincipalKind !== undefined &&
        principal.principal_kind !== binding.expectedPrincipalKind) ||
      (binding.principalKinds !== undefined &&
        !binding.principalKinds.includes(principal.principal_kind)) ||
      (principal.principal_kind === 'SERVICE' &&
        binding.allowedServicePrincipalIds !== undefined &&
        !binding.allowedServicePrincipalIds.includes(row.principal_id))
    )
      return invalid('PRINCIPAL_NOT_ACTIVE');

    const finding = await coveringValidationGrant(deps, trx, {
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
      policySnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: policySnapshotObjectType,
        objectId: finding.policySnapshot.policy_snapshot_id,
        snapshotId: finding.policySnapshot.policy_snapshot_id,
        scope: {},
        contentHash: contentHash(finding.policySnapshot.payload_hash),
      },
      selectedGrant: selectedGrantFacts(finding.grant),
      expiresAt: row.expires_at.toISOString(),
    };
  };
  return transaction ? check(transaction) : withIdentityTransaction(deps.db, deps.context, check);
}

/**
 * The closed negative revalidation outcome. Call sites stay in lockstep so the
 * result shape cannot drift between the compared dimensions.
 */
function invalid(
  reason: WorkOrderValidationRevalidationFailure,
): WorkOrderValidationRevalidationDeny {
  return { valid: false, reason };
}

/**
 * Exact resolution of one approved entry of this slice. The boundary key is
 * closed; the presented consumer operation/version must equal the entry's exact
 * pair (no alias, prefix, case variant or latest fallback), and the binding
 * must agree with the published Purpose of its trusted configuration key
 * (drift fails closed).
 */
function approvedValidationBinding(
  boundary: WorkOrderValidationBoundary,
  commandType: unknown,
  commandVersion: unknown,
): WorkOrderValidationBinding {
  const binding = WORK_ORDER_VALIDATION_BINDINGS.find(
    (candidate) => candidate.boundary === boundary,
  );
  if (
    binding === undefined ||
    typeof commandType !== 'string' ||
    typeof commandVersion !== 'string' ||
    binding.commandType !== commandType ||
    binding.commandVersion !== commandVersion
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
      'work-order validation authorization must be an exact approved consumer operation and version',
    );
  }
  if (approvedPurposes[binding.capabilityConfigKey] !== binding.authorizationPurpose) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
      'work-order validation binding Purpose does not match the published Purpose',
    );
  }
  return binding;
}

function configuredCapabilityCode(
  config: WorkOrderValidationAuthorizationConfig,
  key: string,
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
      IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID,
      `trusted capability configuration for ${key} is missing or invalid`,
    );
  }
  return value;
}

/** The target reader of one entry, dispatched by the entry's target kind. */
function readValidationTarget(
  rawTarget: unknown,
  binding: AuthorizationEntryBinding,
  context: IdentityTransactionContext,
): WorkOrderValidationTarget {
  if (binding.targetKind === 'CONTENT_ADDRESSED') {
    return readDraftSnapshotTarget(rawTarget, binding, context);
  }
  if (binding.targetKind === 'SNAPSHOT') {
    return readContextSnapshotTarget(rawTarget, binding, context);
  }
  if (binding.targetKind === 'VERSIONED') {
    if (binding.enterpriseResource) {
      const v = rawTarget as Common.VersionedRef;
      if (
        v.scope.enterpriseId !== context.enterpriseId ||
        Object.keys(v.scope).length !== 1 ||
        context.allowedProjectIds.length !== 1
      )
        throw new SnapshotBoundaryError(
          IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
          'Exact Enterprise resource required',
        );
      const target = readValidationTarget(
        {
          ...v,
          scope: { enterpriseId: context.enterpriseId, projectId: context.allowedProjectIds[0] },
        },
        { ...binding, enterpriseResource: false },
        context,
      );
      if (target.kind !== 'VERSIONED') throw new Error('Versioned resource required');
      return { ...target, resourceScope: { enterpriseId: context.enterpriseId } };
    }
    const candidate = rawTarget as {
      kind?: unknown;
      objectType?: unknown;
      objectId?: unknown;
      versionId?: unknown;
      scope?: unknown;
    } | null;
    const projectScope = readTargetScope(candidate?.scope);
    if (
      candidate?.kind !== 'VERSIONED' ||
      typeof candidate.objectType !== 'string' ||
      !binding.targetObjectTypes.includes(candidate.objectType) ||
      typeof candidate.objectId !== 'string' ||
      !uuidV7Pattern.test(candidate.objectId) ||
      typeof candidate.versionId !== 'string' ||
      !uuidV7Pattern.test(candidate.versionId) ||
      projectScope === undefined
    ) {
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
        'versioned target must have exact identity and Project Scope',
      );
    }
    assertTrustedScope(projectScope, context);
    return {
      kind: 'VERSIONED',
      objectType: candidate.objectType,
      objectId: candidate.objectId,
      versionId: candidate.versionId,
      scope: { enterpriseId: projectScope.enterpriseId, projectId: projectScope.projectId },
      enterpriseId: projectScope.enterpriseId,
      projectId: projectScope.projectId,
    };
  }
  return readObjectTarget(rawTarget, binding, context);
}

/**
 * The target reference of an own boundary: an exact approved object type, a
 * UuidV7 and the exact Project Scope the request runs in. Enterprise scope, an
 * object type outside the entry's closed set (including a legacy spelling), a
 * wildcard, a case variant and a target outside the trusted transaction scope
 * are refused.
 */
function readObjectTarget(
  rawTarget: unknown,
  binding: AuthorizationEntryBinding,
  context: IdentityTransactionContext,
): WorkOrderValidationTarget {
  const candidate = rawTarget as
    | { kind?: unknown; objectType?: unknown; objectId?: unknown; scope?: unknown }
    | null
    | undefined;
  const scope = readTargetScope(candidate?.scope);
  const objectType = candidate?.objectType;
  if (
    candidate?.kind !== 'OBJECT' ||
    typeof objectType !== 'string' ||
    !binding.targetObjectTypes.includes(objectType) ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    scope === undefined
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
      'target must be an accepted object type, id and Project Scope',
    );
  }
  assertTrustedScope(scope, context);
  return {
    kind: 'OBJECT',
    objectType,
    objectId: candidate.objectId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
  };
}

/**
 * The target reference of a DRAFT dependency-read boundary: an exact
 * ContentAddressedRef of the single approved object type, a UuidV7 object id,
 * an optional UuidV7 `immutableVersionId`, the exact Project Scope the request
 * runs in and a complete SHA-256 content hash. Enterprise scope, any other
 * object type or kind, a wildcard, a case variant, a `null` masquerading as an
 * absent version id, an unknown scope or content-hash member and a target
 * outside the trusted transaction scope are refused.
 */
function readDraftSnapshotTarget(
  rawTarget: unknown,
  binding: AuthorizationEntryBinding,
  context: IdentityTransactionContext,
): WorkOrderValidationTarget {
  const candidate = rawTarget as
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
  const scope = readTargetScope(candidate?.scope);
  const hashShape = readHashShape(candidate?.contentHash);
  const objectType = candidate?.objectType;
  if (
    candidate?.kind !== 'CONTENT_ADDRESSED' ||
    typeof objectType !== 'string' ||
    !binding.targetObjectTypes.includes(objectType) ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    (candidate.immutableVersionId !== undefined &&
      (typeof candidate.immutableVersionId !== 'string' ||
        !uuidV7Pattern.test(candidate.immutableVersionId))) ||
    scope === undefined ||
    hashShape === undefined
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
      'DRAFT snapshot target must be the accepted object type, id and Project Scope',
    );
  }
  // The complete content hash is part of the target identity: it must be a
  // SHA-256 / canonicalization-v1 digest before the ref can bind a Decision.
  const contentHashDigest = contentHashToBuffer(
    candidate.contentHash,
    IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
    'DRAFT snapshot content hash',
  );
  assertTrustedScope(scope, context);
  return {
    kind: 'CONTENT_ADDRESSED',
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
 * The target reference of a Context dependency-read boundary: an exact
 * SnapshotRef of the single approved object type, a UuidV7 object id, the
 * required independent `snapshotId`, the exact Project Scope the
 * request runs in and a complete SHA-256 content hash. An `immutableVersionId`
 * member is refused — the Context snapshot ref never carries one — as are
 * Enterprise scope, any other object type or kind (including the legacy
 * `zhiju.project.context_snapshot` spelling), a wildcard, a case variant, an
 * unknown scope or content-hash member and a target outside the trusted
 * transaction scope.
 */
function readContextSnapshotTarget(
  rawTarget: unknown,
  binding: AuthorizationEntryBinding,
  context: IdentityTransactionContext,
): WorkOrderValidationTarget {
  const candidate = rawTarget as
    | {
        kind?: unknown;
        objectType?: unknown;
        objectId?: unknown;
        snapshotId?: unknown;
        immutableVersionId?: unknown;
        scope?: unknown;
        contentHash?: unknown;
      }
    | null
    | undefined;
  const scope = readTargetScope(candidate?.scope);
  const hashShape = readHashShape(candidate?.contentHash);
  const objectType = candidate?.objectType;
  if (
    candidate?.kind !== 'SNAPSHOT' ||
    typeof objectType !== 'string' ||
    !binding.targetObjectTypes.includes(objectType) ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    typeof candidate.snapshotId !== 'string' ||
    !uuidV7Pattern.test(candidate.snapshotId) ||
    candidate.immutableVersionId !== undefined ||
    scope === undefined ||
    hashShape === undefined
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
      'Context snapshot target must be the accepted object type, id, snapshot id and Project Scope',
    );
  }
  const contentHashDigest = contentHashToBuffer(
    candidate.contentHash,
    IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
    'Context snapshot content hash',
  );
  assertTrustedScope(scope, context);
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: candidate.objectId,
    snapshotId: candidate.snapshotId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
    contentHash: contentHash(contentHashDigest),
  };
}

/** The exact Project Scope of a target reference, or `undefined` when malformed. */
function readTargetScope(
  rawScope: unknown,
): { readonly enterpriseId: string; readonly projectId: string } | undefined {
  const scope = rawScope as { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
  if (
    scope === null ||
    scope === undefined ||
    typeof scope !== 'object' ||
    Array.isArray(scope) ||
    typeof scope.enterpriseId !== 'string' ||
    typeof scope.projectId !== 'string' ||
    !Object.keys(scope).every((key) => key === 'enterpriseId' || key === 'projectId')
  ) {
    return undefined;
  }
  return { enterpriseId: scope.enterpriseId, projectId: scope.projectId };
}

/** The content-hash shape of a full reference, closed to the three members. */
function readHashShape(rawHash: unknown): true | undefined {
  const hashShape = rawHash as Record<string, unknown> | null | undefined;
  if (
    hashShape === null ||
    hashShape === undefined ||
    typeof hashShape !== 'object' ||
    Array.isArray(hashShape) ||
    !Object.keys(hashShape).every(
      (key) => key === 'algorithm' || key === 'digest' || key === 'canonicalizationVersion',
    )
  ) {
    return undefined;
  }
  return true;
}

/** The target scope must be the trusted transaction scope, exactly. */
function assertTrustedScope(
  scope: { readonly enterpriseId: string; readonly projectId: string },
  context: IdentityTransactionContext,
): void {
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(scope.projectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
      'target scope must match the trusted transaction scope',
    );
  }
}

/**
 * The canonical-payload member that binds the complete target reference of a
 * dependency entry (Spec 001 §15.10). An absent `immutableVersionId` is bound
 * as absence: the member is not serialized at all, so a `null` can never
 * impersonate it and the stored payload hash fixes the difference. An own
 * boundary has no such member: its OBJECT mirror `targetRef` is the complete
 * binding.
 */
function dependencyRefMember(
  target: WorkOrderValidationTarget,
  binding: AuthorizationEntryBinding,
): readonly [string, CanonicalJsonObject] | undefined {
  if (target.kind === 'VERSIONED') {
    return [
      binding.targetPayloadMember ?? 'policyRef',
      {
        kind: 'VERSIONED',
        objectType: target.objectType,
        objectId: target.objectId,
        versionId: target.versionId,
        scope: (target.resourceScope ?? target.scope) as unknown as CanonicalJsonObject,
      },
    ];
  }
  if (target.kind === 'CONTENT_ADDRESSED') {
    return [
      binding.targetPayloadMember ?? 'draftSnapshotRef',
      {
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
      },
    ];
  }
  if (target.kind === 'SNAPSHOT') {
    return [
      binding.targetPayloadMember ?? 'contextSnapshotRef',
      {
        kind: 'SNAPSHOT',
        objectType: target.objectType,
        objectId: target.objectId,
        snapshotId: target.snapshotId,
        scope: { enterpriseId: target.enterpriseId, projectId: target.projectId },
        contentHash: {
          algorithm: target.contentHash.algorithm,
          digest: target.contentHash.digest,
          canonicalizationVersion: target.contentHash.canonicalizationVersion,
        },
      },
    ];
  }
  return undefined;
}

/**
 * The complete target binding of a stored Decision: for a dependency entry the
 * canonical payload member (`draftSnapshotRef` or `contextSnapshotRef`) must
 * equal the validated request ref field by field — kind, object type, object
 * id, the existence and value of `immutableVersionId` or the required
 * `snapshotId`, the exact Project Scope and the complete content hash triple.
 * The promoted columns alone cannot see a hash, snapshot-id or version-id
 * substitution, which is exactly what this comparison exists to refuse
 * (Spec 001 §15.10). An own boundary's promoted columns are the complete
 * binding, so nothing more is compared.
 */
function storedDependencyRefMatches(
  storedPayload: unknown,
  expected: WorkOrderValidationTarget,
  binding: AuthorizationEntryBinding,
): boolean {
  if (expected.kind === 'OBJECT') return true;
  const member =
    binding.targetPayloadMember ??
    (expected.kind === 'SNAPSHOT'
      ? 'contextSnapshotRef'
      : expected.kind === 'VERSIONED'
        ? 'policyRef'
        : 'draftSnapshotRef');
  const candidate = (storedPayload as Record<string, unknown> | null | undefined)?.[member] as
    | {
        kind?: unknown;
        objectType?: unknown;
        objectId?: unknown;
        snapshotId?: unknown;
        versionId?: unknown;
        immutableVersionId?: unknown;
        scope?: unknown;
        contentHash?: unknown;
      }
    | null
    | undefined;
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') {
    return false;
  }
  if (expected.kind === 'VERSIONED') {
    return (
      candidate.kind === 'VERSIONED' &&
      candidate.objectType === expected.objectType &&
      candidate.objectId === expected.objectId &&
      candidate.versionId === expected.versionId &&
      sameScope(candidate.scope, expected.resourceScope ?? expected.scope)
    );
  }
  const hash = candidate.contentHash as
    { algorithm?: unknown; digest?: unknown; canonicalizationVersion?: unknown } | null | undefined;
  const hashMatches =
    hash !== null &&
    hash !== undefined &&
    typeof hash === 'object' &&
    !Array.isArray(hash) &&
    hash.algorithm === expected.contentHash.algorithm &&
    hash.digest === expected.contentHash.digest &&
    hash.canonicalizationVersion === expected.contentHash.canonicalizationVersion;
  if (expected.kind === 'CONTENT_ADDRESSED') {
    return (
      candidate.kind === 'CONTENT_ADDRESSED' &&
      candidate.objectType === expected.objectType &&
      candidate.objectId === expected.objectId &&
      (candidate.immutableVersionId === undefined
        ? expected.immutableVersionId === undefined
        : candidate.immutableVersionId === expected.immutableVersionId) &&
      sameScope(candidate.scope, expected.scope) &&
      hashMatches
    );
  }
  return (
    candidate.kind === 'SNAPSHOT' &&
    candidate.objectType === expected.objectType &&
    candidate.objectId === expected.objectId &&
    candidate.snapshotId === expected.snapshotId &&
    candidate.immutableVersionId === undefined &&
    sameScope(candidate.scope, expected.scope) &&
    hashMatches
  );
}

function assertValidationInput(
  input: WorkOrderValidationEntryRequest,
  target: WorkOrderValidationTarget,
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
async function coveringValidationGrant(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  query: WorkOrderValidationGrantQuery,
): Promise<WorkOrderValidationGrantFinding> {
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
    if (!grantMatchesValidation(grant, query)) continue;
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
    return { policySnapshot, grant };
  }
  return {
    denial: sawInvalidPolicy
      ? 'GRANT_POLICY_SNAPSHOT_INVALID'
      : sawStalePolicy
        ? 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT'
        : 'NO_ACTIVE_GRANT',
  };
}

function grantMatchesValidation(
  grant: SelectedCapabilityGrant,
  query: WorkOrderValidationGrantQuery,
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
    selectorsCoverValidationTarget(
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
function selectorsCoverValidationTarget(
  selectors: unknown,
  selectorType: WorkOrderValidationSelectorType,
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
 * Masked, in-scope audit of a denied request of this slice. The entry stays
 * inside the trusted transaction scope and never carries the request payload.
 */
async function appendWorkOrderValidationDeniedAudit(
  trx: IdentityTransaction,
  deps: IdentityCommandDeps,
  input: {
    readonly commandType: string;
    readonly denial: WorkOrderValidationDenialReason;
    readonly target: WorkOrderValidationTarget;
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
      safe_summary: `work-order validation authorization denied: ${input.denial}`,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

// IM-06 #221 uses the same owning target-bound Decision and single covering
// Grant machinery as WorkOrder validation. Every consumer has its own exact
// operation, Purpose, action, selector, target and trusted configuration key.
function firstRunBinding<const B extends string>(
  boundary: B,
  commandType: string,
  authorizationPurpose: string,
  requiredGrantAction: string,
  targetObjectType: string,
  selectorType: WorkOrderValidationSelectorType,
  expectedPrincipalKind: 'HUMAN' | 'SERVICE',
  targetKind: WorkOrderValidationTargetKind = 'OBJECT',
  targetPayloadMember?: string,
  commandVersion = '1.0',
): AuthorizationEntryBinding & { readonly boundary: B } {
  return Object.freeze({
    boundary,
    commandType,
    commandVersion,
    authorizationPurpose,
    requiredGrantAction,
    targetKind,
    targetObjectTypes: Object.freeze([targetObjectType]),
    selectorType,
    capabilityConfigKey: boundary,
    expectedPrincipalKind,
    ...(targetPayloadMember === undefined ? {} : { targetPayloadMember }),
  });
}

export const CONTROLLED_FIRST_RUN_BINDINGS = Object.freeze([
  firstRunBinding(
    'workOrderQueueV1',
    'execution.queue_work_order',
    'task.execution.queue_work_order',
    'execution.work_order.queue.v1',
    'zhiju.execution.work_order',
    'TARGET_TYPE',
    'HUMAN',
  ),
  firstRunBinding(
    'executionBundleIssueV1',
    'identity.issue_execution_capability_bundle',
    'identity.execution_capability_bundle.issue',
    'identity.execution_bundle.issue.v1',
    'zhiju.identity.execution_capability_bundle',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runCreateV1',
    'execution.create_run',
    'task.execution.create_run',
    'execution.run.create.v1',
    'execution.run',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runDispatchBindingReadV1',
    'execution.get_run_dispatch_binding',
    'execution.run.dispatch_binding.read',
    'execution.run.dispatch_binding.read.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runtimeDispatchV1',
    'integration.request_runtime_dispatch',
    'integration.gateway.request_runtime_dispatch',
    'integration.runtime.dispatch.request.v1',
    'integration.runtime_attempt',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runtimeReceiptRecordV1',
    'integration.record_external_receipt',
    'integration.gateway.record_external_receipt',
    'integration.runtime.receipt.record.v1',
    'integration.raw_external_receipt',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runtimeAttemptBindingReadV1',
    'integration.get_runtime_attempt_binding',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runStartV1',
    'execution.start_run',
    'task.execution.start_run',
    'execution.run.start.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'workOrderReconcileV1',
    'execution.reconcile_work_order_execution',
    'execution.work_order.reconcile',
    'execution.work_order.reconcile.v1',
    'zhiju.execution.work_order',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'bundleIssueContractReadV1',
    'identity.issue_execution_capability_bundle',
    'task.execution.get_work_order_contract',
    'execution.work_order.contract.read.for_bundle_issue.v1',
    'zhiju.execution.work_order',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'bundleIssueContextReadV1',
    'identity.issue_execution_capability_bundle',
    'task.execution.get_context_snapshot',
    'execution.context.snapshot.read.for_bundle_issue.v1',
    'zhiju.execution.context_snapshot',
    'TARGET_TYPE',
    'SERVICE',
    'SNAPSHOT',
  ),
  firstRunBinding(
    'queueContractReadV1',
    'execution.queue_work_order',
    'task.execution.get_work_order_contract',
    'execution.work_order.contract.read.for_queue.v1',
    'zhiju.execution.work_order',
    'TARGET_TYPE',
    'HUMAN',
  ),
  firstRunBinding(
    'queueContextReadV1',
    'execution.queue_work_order',
    'task.execution.get_context_snapshot',
    'execution.context.snapshot.read.for_queue.v1',
    'zhiju.execution.context_snapshot',
    'TARGET_TYPE',
    'HUMAN',
    'SNAPSHOT',
  ),
  firstRunBinding(
    'runCreateContractReadV1',
    'execution.create_run',
    'task.execution.get_work_order_contract',
    'execution.work_order.contract.read.for_run_create.v1',
    'zhiju.execution.work_order',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runCreateContextReadV1',
    'execution.create_run',
    'task.execution.get_context_snapshot',
    'execution.context.snapshot.read.for_run_create.v1',
    'zhiju.execution.context_snapshot',
    'TARGET_TYPE',
    'SERVICE',
    'SNAPSHOT',
  ),
  firstRunBinding(
    'runCreateBundleReadV1',
    'execution.create_run',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_run_create.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'runtimeDispatchBundleReadV1',
    'integration.request_runtime_dispatch',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_dispatch.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'runStartBundleReadV1',
    'execution.start_run',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_run_start.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'runStartAttemptReadV1',
    'execution.start_run',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_run_start.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runStartAdapterIdentityReadV1',
    'execution.start_run',
    'integration.runtime.adapter_identity.read',
    'integration.runtime.adapter_identity.read.for_run_start.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'workOrderReconcileRunReadV1',
    'execution.reconcile_work_order_execution',
    'task.execution.get_run_state',
    'execution.run.state.read.for_work_order_reconcile.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runtimeFinalObserveV1',
    'integration.get_runtime_final_observation',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.observe.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runtimeFinalReadV1',
    'integration.get_runtime_final_observation',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runFinalCandidateScanV1',
    'execution.submit_agent_result',
    'execution.run.final_candidate.scan',
    'execution.run.final_candidate.scan.v1',
    'zhiju.project.project',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runFinalProcessProgressV1',
    'execution.process_final_progress',
    'execution.process.final_progress',
    'execution.process.final_progress.v1',
    'zhiju.project.project',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'agentResultSubmitV1',
    'execution.submit_agent_result',
    'task.execution.submit_agent_result',
    'execution.agent_result.submit.v1',
    'execution.agent_result',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runResultRecordV1',
    'execution.record_run_result',
    'execution.run.result.record',
    'execution.run.result.record.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'agentResultValidateV1',
    'execution.validate_agent_result',
    'execution.agent_result.validate',
    'execution.agent_result.validate.v1',
    'zhiju.execution.agent_result_validation_bundle',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'agentResultAcceptV1',
    'execution.accept_agent_result',
    'task.execution.accept_agent_result',
    'execution.agent_result.accept.v1',
    'execution.agent_result_acceptance',
    'CREATE_TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runFinalizeV1',
    'execution.finalize_run_from_acceptance',
    'execution.run.finalize',
    'execution.run.finalize.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runExpireV1',
    'execution.expire_run',
    'execution.run.expire',
    'execution.run.expire.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'agentResultReadV1',
    'execution.get_agent_result',
    'task.execution.get_agent_result',
    'execution.agent_result.read.v1',
    'execution.agent_result',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
  ),
  firstRunBinding(
    'runStateReadV1',
    'execution.get_run_state',
    'task.execution.get_run_state',
    'execution.run.state.read.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultSubmitBindingReadV1',
    'execution.submit_agent_result',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_result_submit.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultSubmitFinalReadV1',
    'execution.submit_agent_result',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_result_submit.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultSubmitBundleReadV1',
    'execution.submit_agent_result',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_result_submit.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'resultSubmitPolicyReadV1',
    'execution.submit_agent_result',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_result_submit.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'SERVICE',
    'VERSIONED',
  ),
  firstRunBinding(
    'resultRecordBindingReadV1',
    'execution.record_run_result',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_result_record.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultRecordFinalReadV1',
    'execution.record_run_result',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_result_record.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultRecordBundleReadV1',
    'execution.record_run_result',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_result_record.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'resultRecordPolicyReadV1',
    'execution.record_run_result',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_result_record.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'SERVICE',
    'VERSIONED',
  ),
  firstRunBinding(
    'resultValidateBindingReadV1',
    'execution.validate_agent_result',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_result_validate.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultValidateFinalReadV1',
    'execution.validate_agent_result',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_result_validate.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultValidateBundleReadV1',
    'execution.validate_agent_result',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_result_validate.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'resultValidatePolicyReadV1',
    'execution.validate_agent_result',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_result_validate.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'SERVICE',
    'VERSIONED',
  ),
  firstRunBinding(
    'resultAcceptBindingReadV1',
    'execution.accept_agent_result',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_result_accept.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultAcceptFinalReadV1',
    'execution.accept_agent_result',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_result_accept.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'resultAcceptBundleReadV1',
    'execution.accept_agent_result',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_result_accept.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'resultAcceptPolicyReadV1',
    'execution.accept_agent_result',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_result_accept.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'SERVICE',
    'VERSIONED',
  ),
  firstRunBinding(
    'runFinalizeBindingReadV1',
    'execution.finalize_run_from_acceptance',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_run_finalize.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runFinalizeFinalReadV1',
    'execution.finalize_run_from_acceptance',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_run_finalize.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'runFinalizeBundleReadV1',
    'execution.finalize_run_from_acceptance',
    'identity.execution_capability_bundle.read',
    'identity.execution_bundle.read.for_run_finalize.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  firstRunBinding(
    'runFinalizePolicyReadV1',
    'execution.finalize_run_from_acceptance',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_run_finalize.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'SERVICE',
    'VERSIONED',
  ),
  firstRunBinding(
    'resultRecordSourceReadV1',
    'execution.record_run_result',
    'execution.final.source.read',
    'execution.agent_result.source.read.for_record.v1',
    'execution.agent_result',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
  ),
  firstRunBinding(
    'resultValidateSourceReadV1',
    'execution.validate_agent_result',
    'execution.final.source.read',
    'execution.agent_result.source.read.for_validate.v1',
    'execution.agent_result',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
  ),
  firstRunBinding(
    'resultAcceptSourceReadV1',
    'execution.accept_agent_result',
    'execution.final.source.read',
    'execution.result_validation.source.read.for_accept.v1',
    'execution.agent_result',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
  ),
  firstRunBinding(
    'runFinalizeSourceReadV1',
    'execution.finalize_run_from_acceptance',
    'execution.final.source.read',
    'execution.agent_result_acceptance.source.read.for_finalize.v1',
    'execution.agent_result_acceptance',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
  ),
  firstRunBinding(
    'runExpireBundleInspectV1',
    'execution.expire_run',
    'identity.execution_capability_bundle.inspect',
    'identity.execution_bundle.inspect.for_run_expire.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
  // IM-06 #244 Run cancellation, expiry Major 2 and late-final isolation
  // (Spec 001 §15.17). The public cancellation Purpose and the internal Grant
  // action stay separate fields; the late-final boundaries are internal
  // owning actions that reuse the registered IG Query Purposes.
  firstRunBinding(
    'runCancelRequestV1',
    'execution.request_run_cancel',
    'task.execution.request_run_cancel',
    'execution.run.cancel.request.v1',
    'execution.run',
    'TARGET_TYPE',
    'HUMAN',
  ),
  firstRunBinding(
    'runCancelPolicyReadV1',
    'execution.request_run_cancel',
    'identity.policy.resolve_policy',
    'identity.policy.resolve.for_run_cancel.v1',
    'zhiju.identity.policy',
    'TARGET_TYPE',
    'HUMAN',
    'VERSIONED',
  ),
  firstRunBinding(
    'runExpireV2',
    'execution.expire_run',
    'execution.run.expire',
    'execution.run.expire.v2',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
    'OBJECT',
    undefined,
    '2.0',
  ),
  firstRunBinding(
    'runExpireBundleInspectV2',
    'execution.expire_run',
    'identity.execution_capability_bundle.inspect',
    'identity.execution_bundle.inspect.for_run_expire.v2',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
    '2.0',
  ),
  firstRunBinding(
    'runStateReadForCancelHumanV1',
    'execution.get_run_state',
    'task.execution.get_run_state',
    'execution.run.state.read.for_cancel.v1',
    'execution.run',
    'TARGET_TYPE',
    'HUMAN',
  ),
  firstRunBinding(
    'runLateFinalIsolateV1',
    'execution.run.late_final.isolate',
    'execution.run.late_final.isolate',
    'execution.run.late_final.isolate.v1',
    'execution.run',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'lateFinalBindingReadV1',
    'execution.run.late_final.isolate',
    'integration.runtime.binding.read',
    'integration.runtime.binding.read.for_late_final.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'lateFinalObservationReadV1',
    'execution.run.late_final.isolate',
    'integration.runtime.final_observation.read',
    'integration.runtime.final.read.for_late_final.v1',
    'integration.runtime_attempt',
    'TARGET_TYPE',
    'SERVICE',
  ),
  firstRunBinding(
    'lateFinalBundleInspectV1',
    'execution.run.late_final.isolate',
    'identity.execution_capability_bundle.inspect',
    'identity.execution_bundle.inspect.for_late_final.v1',
    'zhiju.identity.execution_capability_bundle',
    'TARGET_TYPE',
    'SERVICE',
    'CONTENT_ADDRESSED',
    'bundleRef',
  ),
]);

export type ControlledFirstRunCapabilityCodes = Readonly<
  Record<(typeof CONTROLLED_FIRST_RUN_BINDINGS)[number]['boundary'], string>
>;

export interface ControlledFirstRunAuthorizationConfig {
  readonly capabilityCodes: ControlledFirstRunCapabilityCodes;
  readonly now?: () => Date;
}

export interface ControlledFirstRunAuthorizationInput extends WorkOrderValidationEntryRequest {
  readonly targetRef:
    Common.ObjectRef | Common.ContentAddressedRef | Common.SnapshotRef | Common.VersionedRef;
}

export interface ControlledFirstRunRevalidationInput extends WorkOrderValidationEntryRevalidation {
  readonly expectedTargetRef:
    Common.ObjectRef | Common.ContentAddressedRef | Common.SnapshotRef | Common.VersionedRef;
}

interface EntryDecisionRevalidation {
  readonly key: string;
  readonly input: ControlledFirstRunRevalidationInput;
}

/** Reuse setup within one checkpoint; never retain an authorization result. */
async function revalidateEntryBatch(
  config: WorkOrderValidationAuthorizationConfig,
  now: () => Date,
  binding: (key: string, operation: string, version: string) => AuthorizationEntryBinding,
  deps: IdentityCommandDeps,
  requests: readonly EntryDecisionRevalidation[],
): Promise<
  | { readonly valid: true }
  | (WorkOrderValidationRevalidationDeny & { readonly failedIndex: number })
> {
  if (requests.length === 0) return { valid: true };
  return withIdentityTransaction(
    deps.db,
    deps.context,
    async (trx) => {
      for (const [failedIndex, request] of requests.entries()) {
        const input = request.input;
        const result = await revalidateEntryDecision(
          config,
          now,
          undefined,
          deps,
          input,
          input.expectedTargetRef,
          binding(request.key, input.expectedCommandType, input.expectedCommandVersion),
          trx,
        );
        if (!result.valid) return { ...result, failedIndex };
      }
      return { valid: true };
    },
    'read committed',
  );
}

export function createControlledFirstRunAuthorizationPort(
  config: ControlledFirstRunAuthorizationConfig,
) {
  const now = config.now ?? (() => new Date());
  const commonConfig = config as unknown as WorkOrderValidationAuthorizationConfig;
  function bindingFor(boundary: string, operation: string, version: string) {
    const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
      (candidate) => candidate.boundary === boundary,
    );
    if (binding?.commandType !== operation || binding.commandVersion !== version)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'controlled first Run authorization key is unsupported',
      );
    return binding;
  }
  return {
    authorize: async (
      deps: IdentityCommandDeps,
      boundary: string,
      input: ControlledFirstRunAuthorizationInput,
    ) => {
      const binding = bindingFor(boundary, input.commandType, input.commandVersion);
      return issueEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding,
      );
    },
    revalidateBatch: (deps: IdentityCommandDeps, requests: readonly EntryDecisionRevalidation[]) =>
      revalidateEntryBatch(commonConfig, now, bindingFor, deps, requests),
    revalidate: async (
      deps: IdentityCommandDeps,
      boundary: string,
      input: ControlledFirstRunRevalidationInput,
    ) => {
      const binding = bindingFor(boundary, input.expectedCommandType, input.expectedCommandVersion);
      return revalidateEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding,
      );
    },
  };
}

// IM06-USAGE historical readback composition (Spec 001 §15.18, issue #246).
// The Human Query entry and the five SERVICE dependency reads each carry their
// own exact operation, Purpose, action, target set and trusted configuration
// key. No entry inherits another's Purpose, action, target or config key, and
// the two internal operations are trusted type/Purpose tokens only: they enter
// no public Catalog and are never resolved as a caller-chosen string.

export type UsageProvenanceCapabilityKey =
  | 'runUsageProvenanceReadHumanV1'
  | 'runUsageProvenanceSourceReadV1'
  | 'usageProvenanceContractReadV1'
  | 'usageProvenanceBindingReadV1'
  | 'usageProvenanceAdapterIdentityReadV1'
  | 'usageProvenanceFinalReadV1';

export type UsageProvenanceBinding = AuthorizationEntryBinding & {
  readonly capabilityConfigKey: UsageProvenanceCapabilityKey;
};

const usageProvenanceBindings: readonly UsageProvenanceBinding[] = Object.freeze([
  Object.freeze({
    capabilityConfigKey: 'runUsageProvenanceReadHumanV1',
    commandType: 'execution.get_usage_and_provenance',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_usage_and_provenance',
    requiredGrantAction: 'execution.run.usage_provenance.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['execution.run']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
  }),
  Object.freeze({
    capabilityConfigKey: 'runUsageProvenanceSourceReadV1',
    commandType: 'execution.run.usage_provenance.source.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.run.usage_provenance.source.read.v1',
    requiredGrantAction: 'execution.run.usage_provenance.source.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['execution.run']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'usageProvenanceContractReadV1',
    commandType: 'execution.get_work_order_contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_usage_provenance.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['zhiju.execution.work_order']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'usageProvenanceBindingReadV1',
    commandType: 'integration.get_runtime_attempt_binding',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.binding.read',
    requiredGrantAction: 'integration.runtime.binding.read.for_usage_provenance.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['integration.runtime_attempt']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'usageProvenanceAdapterIdentityReadV1',
    commandType: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    requiredGrantAction: 'integration.runtime.adapter_identity.read.for_usage_provenance.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['integration.runtime_attempt']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'usageProvenanceFinalReadV1',
    commandType: 'integration.get_runtime_final_observation',
    commandVersion: '1.0',
    authorizationPurpose: 'integration.runtime.final_observation.read',
    requiredGrantAction: 'integration.runtime.final.read.for_usage_provenance.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['integration.runtime_attempt']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
]);

export const USAGE_PROVENANCE_BINDINGS: readonly UsageProvenanceBinding[] = usageProvenanceBindings;

export type UsageProvenanceCapabilityCodes = Readonly<Record<UsageProvenanceCapabilityKey, string>>;

export interface UsageProvenanceAuthorizationConfig {
  readonly capabilityCodes: UsageProvenanceCapabilityCodes;
  readonly now?: (() => Date) | undefined;
}

export function createUsageProvenanceAuthorizationPort(config: UsageProvenanceAuthorizationConfig) {
  const now = config.now ?? (() => new Date());
  const commonConfig = config as unknown as WorkOrderValidationAuthorizationConfig;
  function bindingFor(key: string, operation: string, version: string) {
    const binding = usageProvenanceBindings.find(
      (candidate) => candidate.capabilityConfigKey === key,
    );
    if (binding?.commandType !== operation || binding.commandVersion !== version)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'usage provenance authorization key is unsupported',
      );
    return binding;
  }
  return {
    authorize: async (
      deps: IdentityCommandDeps,
      key: UsageProvenanceCapabilityKey,
      input: ControlledFirstRunAuthorizationInput,
    ) => {
      const binding = bindingFor(key, input.commandType, input.commandVersion);
      return issueEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding,
      );
    },
    revalidateBatch: (deps: IdentityCommandDeps, requests: readonly EntryDecisionRevalidation[]) =>
      revalidateEntryBatch(commonConfig, now, bindingFor, deps, requests),
    revalidate: async (
      deps: IdentityCommandDeps,
      key: UsageProvenanceCapabilityKey,
      input: ControlledFirstRunRevalidationInput,
    ) => {
      const binding = bindingFor(key, input.expectedCommandType, input.expectedCommandVersion);
      return revalidateEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding,
      );
    },
  };
}

// IM06-BOARD independent reads and technical publication authorization
// (Spec 001 §15.19, issue B-01–B-05). Seven mutually non-substitutable entries:
//
// - the Human public Task Board Query entry,
// - the owning source Export/authority read,
// - the source health read,
// - the dispatch scan/lease/manifest/confirm control,
// - the fence registration/publication/control proof,
// - the retention cleanup/maintenance, and
// - the current Board Policy resolution.
//
// Every entry carries its own exact operation, version, Purpose, Grant action,
// target kind, accepted target object types, selector type, expected principal
// kind and trusted configuration key; no entry inherits another's Purpose,
// action, target, selector or config key. The six `execution.task_board.…`
// internal operations and the reused `identity.resolve_policy` entry are
// trusted type/Purpose tokens only: they enter no public Catalog and are never
// resolved from a caller-chosen string. All rows are version `1.0` with
// selector `TARGET_TYPE` and an exact closed target set (§15.19): the Project
// OBJECT targets accept both the canonical `project.project` and the
// `zhiju.project.project` spelling without normalizing one into the other, and
// the Board Policy entry binds a complete `VERSIONED` `zhiju.identity.policy`
// reference.

/**
 * Trusted configuration key of one IM06-BOARD entry. The seven keys are
 * independent: no entry ever reads another entry's code.
 */
export type TaskBoardCapabilityKey =
  | 'taskBoardReadHumanV1'
  | 'taskBoardSourceReadV1'
  | 'taskBoardHealthReadV1'
  | 'taskBoardDispatchManageV1'
  | 'taskBoardProjectionPublishV1'
  | 'taskBoardProjectionMaintainV1'
  | 'taskBoardPolicyReadV1';

/**
 * The published Purpose indexed by the trusted configuration key, so a drift
 * between the binding table and the exact §15.19 Purpose of each row fails
 * closed instead of signing a Decision under a Purpose no caller expects.
 */
export const TASK_BOARD_PURPOSES: Readonly<Record<TaskBoardCapabilityKey, string>> = Object.freeze({
  taskBoardReadHumanV1: 'task.execution.get_task_board_slice',
  taskBoardSourceReadV1: 'execution.task_board.source.read.v1',
  taskBoardHealthReadV1: 'execution.task_board.health.read.v1',
  taskBoardDispatchManageV1: 'execution.task_board.dispatch.manage.v1',
  taskBoardProjectionPublishV1: 'execution.task_board.projection.publish.v1',
  taskBoardProjectionMaintainV1: 'execution.task_board.projection.maintain.v1',
  taskBoardPolicyReadV1: 'identity.policy.resolve_policy',
});

export type TaskBoardBinding = AuthorizationEntryBinding & {
  readonly capabilityConfigKey: TaskBoardCapabilityKey;
};

const taskBoardBindings: readonly TaskBoardBinding[] = Object.freeze([
  Object.freeze({
    capabilityConfigKey: 'taskBoardReadHumanV1',
    commandType: 'execution.get_task_board_slice',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardReadHumanV1,
    requiredGrantAction: 'execution.task_board.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardSourceReadV1',
    commandType: 'execution.task_board.source.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardSourceReadV1,
    requiredGrantAction: 'execution.task_board.source.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardHealthReadV1',
    commandType: 'execution.task_board.health.read.v1',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardHealthReadV1,
    requiredGrantAction: 'execution.task_board.health.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardDispatchManageV1',
    commandType: 'execution.task_board.dispatch.manage.v1',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardDispatchManageV1,
    requiredGrantAction: 'execution.task_board.dispatch.manage.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardProjectionPublishV1',
    commandType: 'execution.task_board.projection.publish.v1',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardProjectionPublishV1,
    requiredGrantAction: 'execution.task_board.projection.publish.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardProjectionMaintainV1',
    commandType: 'execution.task_board.projection.maintain.v1',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardProjectionMaintainV1,
    requiredGrantAction: 'execution.task_board.projection.maintain.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: Object.freeze(['project.project', 'zhiju.project.project']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
  Object.freeze({
    capabilityConfigKey: 'taskBoardPolicyReadV1',
    commandType: 'identity.resolve_policy',
    commandVersion: '1.0',
    authorizationPurpose: TASK_BOARD_PURPOSES.taskBoardPolicyReadV1,
    requiredGrantAction: 'execution.task_board.policy.read.v1',
    targetKind: 'VERSIONED',
    targetObjectTypes: Object.freeze(['zhiju.identity.policy']),
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  }),
]);

export const TASK_BOARD_BINDINGS: readonly TaskBoardBinding[] = taskBoardBindings;

export type TaskBoardCapabilityCodes = Readonly<Record<TaskBoardCapabilityKey, string>>;

export interface TaskBoardAuthorizationConfig {
  readonly capabilityCodes: TaskBoardCapabilityCodes;
  readonly now?: (() => Date) | undefined;
}

export function createTaskBoardAuthorizationPort(config: TaskBoardAuthorizationConfig) {
  // Trusted configuration key ↔ published Purpose drift fails closed before any
  // request is resolved: nothing may sign a Decision under a Purpose the
  // owning boundary does not expect.
  for (const binding of taskBoardBindings) {
    if (TASK_BOARD_PURPOSES[binding.capabilityConfigKey] !== binding.authorizationPurpose)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'task board binding Purpose does not match the published Purpose',
      );
  }
  const now = config.now ?? (() => new Date());
  const commonConfig = config as unknown as WorkOrderValidationAuthorizationConfig;
  function bindingFor(key: string, operation: string, version: string) {
    const binding = taskBoardBindings.find((candidate) => candidate.capabilityConfigKey === key);
    if (binding?.commandType !== operation || binding.commandVersion !== version)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'task board authorization key is unsupported',
      );
    return binding;
  }
  return {
    authorize: async (
      deps: IdentityCommandDeps,
      key: TaskBoardCapabilityKey,
      input: ControlledFirstRunAuthorizationInput,
    ) => {
      const binding = bindingFor(key, input.commandType, input.commandVersion);
      return issueEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding,
      );
    },
    revalidateBatch: (deps: IdentityCommandDeps, requests: readonly EntryDecisionRevalidation[]) =>
      revalidateEntryBatch(commonConfig, now, bindingFor, deps, requests),
    revalidate: async (
      deps: IdentityCommandDeps,
      key: TaskBoardCapabilityKey,
      input: ControlledFirstRunRevalidationInput,
    ) => {
      const binding = bindingFor(key, input.expectedCommandType, input.expectedCommandVersion);
      return revalidateEntryDecision(
        commonConfig,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding,
      );
    },
  };
}

/** Explicit approved recovery bindings; no runtime wildcard expansion. */
export const BLOCKED_INPUT_RECOVERY_BINDINGS: readonly AuthorizationEntryBinding[] = Object.freeze([
  {
    capabilityConfigKey: 'customerMaterialProposeV1',
    commandType: 'project.propose_customer_material',
    commandVersion: '1.0',
    authorizationPurpose: 'enterprise.project.propose_customer_material',
    requiredGrantAction: 'project.customer_material.propose.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'CREATE_TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'customerMaterialConfirmV1',
    commandType: 'project.confirm_customer_material',
    commandVersion: '1.0',
    authorizationPurpose: 'enterprise.project.confirm_customer_material',
    requiredGrantAction: 'project.customer_material.confirm.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'confirmationReceiptDiscoverV1',
    commandType: 'project.confirmation_receipt.discover',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.discover.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'informationRequestOpenV1',
    commandType: 'execution.open_information_request',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.open_information_request',
    requiredGrantAction: 'execution.information_request.open.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'CREATE_TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  },
  {
    capabilityConfigKey: 'informationRequestReadV1',
    commandType: 'execution.get_information_request',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_information_request',
    requiredGrantAction: 'execution.information_request.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'informationAnswerSubmitV1',
    commandType: 'execution.submit_information_answer',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.submit_information_answer',
    requiredGrantAction: 'execution.information_request.answer.submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'informationRequestResolveV1',
    commandType: 'execution.resolve_information_request',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.resolve_information_request',
    requiredGrantAction: 'execution.information_request.resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'frozenContextBuildV1_1',
    commandType: 'execution.build_context_snapshot',
    commandVersion: '1.1',
    authorizationPurpose: 'task.execution.build_context_snapshot',
    requiredGrantAction: 'execution.context.frozen.build.v1_1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'CREATE_TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  },
  {
    capabilityConfigKey: 'workOrderRetryScheduleV1',
    commandType: 'execution.schedule_work_order_retry',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.schedule_work_order_retry',
    requiredGrantAction: 'execution.work_order.retry.schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'HUMAN',
  },
  {
    capabilityConfigKey: 'taskReconcileV1',
    commandType: 'execution.reconcile_task_execution',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task.reconcile',
    requiredGrantAction: 'execution.task.reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.task'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  },
  {
    capabilityConfigKey: 'taskStateReadV1',
    commandType: 'execution.get_task_state',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.task.read',
    requiredGrantAction: 'execution.task.state.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.task'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'workOrderExecutionStateReadV1',
    commandType: 'execution.get_work_order_execution_state',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.work_order.execution_state.read',
    requiredGrantAction: 'execution.work_order.execution_state.read.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recoveryCandidateScanV1',
    commandType: 'execution.recovery.candidate.scan',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.candidate.scan',
    requiredGrantAction: 'execution.recovery.candidate.scan.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.project'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  },
  {
    capabilityConfigKey: 'recoveryProcessProgressV1',
    commandType: 'execution.process.recovery_progress',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.process.recovery_progress',
    requiredGrantAction: 'execution.process.recovery_progress.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.project'],
    selectorType: 'TARGET_TYPE',
    expectedPrincipalKind: 'SERVICE',
  },
  {
    capabilityConfigKey: 'recovery.driver_template.material.v1',
    commandType: 'execution.recovery.driver_template.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_driver_template.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_open.material.v1',
    commandType: 'execution.recovery.request_open.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_request_open.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.answer_submit.material.v1',
    commandType: 'execution.recovery.answer_submit.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_answer_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.material.v1',
    commandType: 'execution.recovery.request_resolve.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.material.v1',
    commandType: 'execution.recovery.frozen_context_build.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.material.v1',
    commandType: 'execution.recovery.retry_schedule.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.material.v1',
    commandType: 'execution.recovery.work_order_reconcile.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.material.v1',
    commandType: 'execution.recovery.task_reconcile.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.material.v1',
    commandType: 'execution.recovery.work_order_state.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.material.v1',
    commandType: 'execution.recovery.task_state.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.material.v1',
    commandType: 'execution.recovery.bundle_issue.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.material.v1',
    commandType: 'execution.recovery.run_create.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.material.v1',
    commandType: 'execution.recovery.runtime_dispatch.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.material.v1',
    commandType: 'execution.recovery.run_start.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.material.v1',
    commandType: 'execution.recovery.result_submit.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.material.v1',
    commandType: 'execution.recovery.result_record.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.material.v1',
    commandType: 'execution.recovery.result_validate.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.material.v1',
    commandType: 'execution.recovery.result_accept.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.material.v1',
    commandType: 'execution.recovery.run_finalize.material',
    commandVersion: '1.0',
    authorizationPurpose: 'project.customer_material.recovery_refs.read',
    requiredGrantAction: 'project.customer_material.recovery_refs.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.customer_material'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_open.source.v1',
    commandType: 'execution.recovery.request_open.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_request_open.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.source.v1',
    commandType: 'execution.recovery.work_order_reconcile.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.source.v1',
    commandType: 'execution.recovery.task_reconcile.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.source.v1',
    commandType: 'execution.recovery.retry_schedule.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.answer.v1',
    commandType: 'execution.recovery.request_resolve.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.answer.v1',
    commandType: 'execution.recovery.frozen_context_build.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.answer.v1',
    commandType: 'execution.recovery.retry_schedule.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.answer.v1',
    commandType: 'execution.recovery.work_order_reconcile.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.answer.v1',
    commandType: 'execution.recovery.task_reconcile.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.answer.v1',
    commandType: 'execution.recovery.work_order_state.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.answer.v1',
    commandType: 'execution.recovery.task_state.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.answer.v1',
    commandType: 'execution.recovery.bundle_issue.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.answer.v1',
    commandType: 'execution.recovery.run_create.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.answer.v1',
    commandType: 'execution.recovery.runtime_dispatch.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.answer.v1',
    commandType: 'execution.recovery.run_start.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.answer.v1',
    commandType: 'execution.recovery.result_submit.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.answer.v1',
    commandType: 'execution.recovery.result_record.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.answer.v1',
    commandType: 'execution.recovery.result_validate.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.answer.v1',
    commandType: 'execution.recovery.result_accept.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.answer.v1',
    commandType: 'execution.recovery.run_finalize.answer',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.answer.read',
    requiredGrantAction: 'execution.recovery.answer.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['execution.information_request'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.receipt.v1',
    commandType: 'execution.recovery.request_resolve.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.receipt.v1',
    commandType: 'execution.recovery.frozen_context_build.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.receipt.v1',
    commandType: 'execution.recovery.retry_schedule.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.receipt.v1',
    commandType: 'execution.recovery.bundle_issue.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.receipt.v1',
    commandType: 'execution.recovery.run_create.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.receipt.v1',
    commandType: 'execution.recovery.runtime_dispatch.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.receipt.v1',
    commandType: 'execution.recovery.run_start.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.receipt.v1',
    commandType: 'execution.recovery.work_order_reconcile.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.receipt.v1',
    commandType: 'execution.recovery.task_reconcile.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.receipt.v1',
    commandType: 'execution.recovery.work_order_state.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.receipt.v1',
    commandType: 'execution.recovery.task_state.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.receipt.v1',
    commandType: 'execution.recovery.result_submit.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.receipt.v1',
    commandType: 'execution.recovery.result_record.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.receipt.v1',
    commandType: 'execution.recovery.result_validate.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.receipt.v1',
    commandType: 'execution.recovery.result_accept.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.receipt.v1',
    commandType: 'execution.recovery.run_finalize.receipt',
    commandVersion: '1.0',
    authorizationPurpose: 'project.resolution_receipt.read',
    requiredGrantAction: 'project.resolution_receipt.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.project.command_receipt'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.answer_submit.human.v1',
    commandType: 'execution.recovery.answer_submit.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_answer_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.human.v1',
    commandType: 'execution.recovery.request_resolve.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.human.v1',
    commandType: 'execution.recovery.frozen_context_build.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.human.v1',
    commandType: 'execution.recovery.retry_schedule.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.human.v1',
    commandType: 'execution.recovery.bundle_issue.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.human.v1',
    commandType: 'execution.recovery.run_create.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.human.v1',
    commandType: 'execution.recovery.runtime_dispatch.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.human.v1',
    commandType: 'execution.recovery.run_start.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.human.v1',
    commandType: 'execution.recovery.work_order_reconcile.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.human.v1',
    commandType: 'execution.recovery.task_reconcile.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.human.v1',
    commandType: 'execution.recovery.work_order_state.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.human.v1',
    commandType: 'execution.recovery.task_state.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.human.v1',
    commandType: 'execution.recovery.result_submit.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.human.v1',
    commandType: 'execution.recovery.result_record.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.human.v1',
    commandType: 'execution.recovery.result_validate.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.human.v1',
    commandType: 'execution.recovery.result_accept.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.human.v1',
    commandType: 'execution.recovery.run_finalize.human',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.recovery.human_eligibility.read',
    requiredGrantAction: 'identity.recovery.human.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.principal'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_open.contract.v1',
    commandType: 'execution.recovery.request_open.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_request_open.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.contract.v1',
    commandType: 'execution.recovery.frozen_context_build.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.contract.v1',
    commandType: 'execution.recovery.retry_schedule.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.contract.v1',
    commandType: 'execution.recovery.work_order_state.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.context.v1',
    commandType: 'execution.recovery.frozen_context_build.context',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_context_snapshot',
    requiredGrantAction: 'execution.context.snapshot.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.context.v1',
    commandType: 'execution.recovery.bundle_issue.context',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_context_snapshot',
    requiredGrantAction: 'execution.context.snapshot.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.context.v1',
    commandType: 'execution.recovery.run_create.context',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_context_snapshot',
    requiredGrantAction: 'execution.context.snapshot.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.context.v1',
    commandType: 'execution.recovery.runtime_dispatch.context',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_context_snapshot',
    requiredGrantAction: 'execution.context.snapshot.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.context.v1',
    commandType: 'execution.recovery.run_start.context',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_context_snapshot',
    requiredGrantAction: 'execution.context.snapshot.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.frozen_eligibility.v1',
    commandType: 'execution.recovery.bundle_issue.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.frozen_eligibility.v1',
    commandType: 'execution.recovery.run_create.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.frozen_eligibility.v1',
    commandType: 'execution.recovery.runtime_dispatch.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.frozen_eligibility.v1',
    commandType: 'execution.recovery.run_start.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.frozen_eligibility.v1',
    commandType: 'execution.recovery.result_submit.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.frozen_eligibility.v1',
    commandType: 'execution.recovery.result_record.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.frozen_eligibility.v1',
    commandType: 'execution.recovery.result_validate.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.frozen_eligibility.v1',
    commandType: 'execution.recovery.result_accept.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.frozen_eligibility.v1',
    commandType: 'execution.recovery.run_finalize.frozen_eligibility',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.context.frozen_eligibility.read',
    requiredGrantAction: 'execution.context.frozen_eligibility.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.context_snapshot'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_open.controls.v1',
    commandType: 'execution.recovery.request_open.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_request_open.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.controls.v1',
    commandType: 'execution.recovery.frozen_context_build.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.retry_schedule.controls.v1',
    commandType: 'execution.recovery.retry_schedule.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_retry_schedule.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.controls.v1',
    commandType: 'execution.recovery.work_order_reconcile.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.controls.v1',
    commandType: 'execution.recovery.task_reconcile.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.controls.v1',
    commandType: 'execution.recovery.work_order_state.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.controls.v1',
    commandType: 'execution.recovery.task_state.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.answer_submit.controls.v1',
    commandType: 'execution.recovery.answer_submit.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_answer_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.controls.v1',
    commandType: 'execution.recovery.request_resolve.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.controls.v1',
    commandType: 'execution.recovery.bundle_issue.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.controls.v1',
    commandType: 'execution.recovery.run_create.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.controls.v1',
    commandType: 'execution.recovery.runtime_dispatch.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.controls.v1',
    commandType: 'execution.recovery.run_start.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.controls.v1',
    commandType: 'execution.recovery.result_submit.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.controls.v1',
    commandType: 'execution.recovery.result_record.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.controls.v1',
    commandType: 'execution.recovery.result_validate.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.controls.v1',
    commandType: 'execution.recovery.result_accept.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.controls.v1',
    commandType: 'execution.recovery.run_finalize.controls',
    commandVersion: '1.0',
    authorizationPurpose: 'identity.policy.resolve_policy',
    requiredGrantAction: 'identity.policy.resolve.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.identity.policy'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.answer_submit.contract.v1',
    commandType: 'execution.recovery.answer_submit.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_answer_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.request_resolve.contract.v1',
    commandType: 'execution.recovery.request_resolve.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_request_resolve.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_reconcile.contract.v1',
    commandType: 'execution.recovery.work_order_reconcile.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_work_order_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_reconcile.contract.v1',
    commandType: 'execution.recovery.task_reconcile.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_task_reconcile.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.contract.v1',
    commandType: 'execution.recovery.task_state.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.contract.v1',
    commandType: 'execution.recovery.bundle_issue.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.contract.v1',
    commandType: 'execution.recovery.run_create.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.contract.v1',
    commandType: 'execution.recovery.runtime_dispatch.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.contract.v1',
    commandType: 'execution.recovery.run_start.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.contract.v1',
    commandType: 'execution.recovery.result_submit.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.contract.v1',
    commandType: 'execution.recovery.result_record.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.contract.v1',
    commandType: 'execution.recovery.result_validate.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.contract.v1',
    commandType: 'execution.recovery.result_accept.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.contract.v1',
    commandType: 'execution.recovery.run_finalize.contract',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.get_work_order_contract',
    requiredGrantAction: 'execution.work_order.contract.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: ['zhiju.execution.work_order'],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.frozen_context_build.source.v1',
    commandType: 'execution.recovery.frozen_context_build.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_frozen_context_build.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.work_order_state.source.v1',
    commandType: 'execution.recovery.work_order_state.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_work_order_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.task_state.source.v1',
    commandType: 'execution.recovery.task_state.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_task_state.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.bundle_issue.source.v1',
    commandType: 'execution.recovery.bundle_issue.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_bundle_issue.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_create.source.v1',
    commandType: 'execution.recovery.run_create.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_run_create.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.runtime_dispatch.source.v1',
    commandType: 'execution.recovery.runtime_dispatch.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_runtime_dispatch.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_start.source.v1',
    commandType: 'execution.recovery.run_start.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_run_start.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_submit.source.v1',
    commandType: 'execution.recovery.result_submit.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_result_submit.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_record.source.v1',
    commandType: 'execution.recovery.result_record.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_result_record.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_validate.source.v1',
    commandType: 'execution.recovery.result_validate.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_result_validate.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.result_accept.source.v1',
    commandType: 'execution.recovery.result_accept.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_result_accept.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
  {
    capabilityConfigKey: 'recovery.run_finalize.source.v1',
    commandType: 'execution.recovery.run_finalize.source',
    commandVersion: '1.0',
    authorizationPurpose: 'execution.recovery.source.read',
    requiredGrantAction: 'execution.recovery.source.read.for_run_finalize.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [
      'zhiju.execution.work_order',
      'execution.agent_result',
      'execution.run',
      'execution.agent_result_acceptance',
      'execution.information_request_resolution',
    ],
    selectorType: 'TARGET_TYPE',
  },
]);
// Formal output creation consumes the same owning frozen-recovery facts under distinct actions.
export const FORMAL_OUTPUT_RECOVERY_BINDINGS = Object.freeze(
  BLOCKED_INPUT_RECOVERY_BINDINGS.filter((b) =>
    b.capabilityConfigKey.startsWith('recovery.run_finalize.'),
  ).map((b) => ({
    ...b,
    capabilityConfigKey: b.capabilityConfigKey.replace('run_finalize', 'output_creation'),
    commandType: b.commandType.replace('run_finalize', 'output_creation'),
    requiredGrantAction: b.requiredGrantAction.replace('run_finalize', 'output_creation'),
  })),
);
export type RecoveryCapabilityCodes = Readonly<Record<string, string>>;
export function createRecoveryAuthorizationPort(config: {
  readonly capabilityCodes: RecoveryCapabilityCodes;
  readonly now?: () => Date;
}) {
  const now = config.now ?? (() => new Date());
  const common = config as unknown as WorkOrderValidationAuthorizationConfig;
  function binding(key: string, operation: string, version: string) {
    const found = [...BLOCKED_INPUT_RECOVERY_BINDINGS, ...FORMAL_OUTPUT_RECOVERY_BINDINGS].find(
      (b) => b.capabilityConfigKey === key,
    );
    if (found?.commandType !== operation || found.commandVersion !== version)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'unsupported recovery authorization binding',
      );
    return found;
  }
  return {
    authorize: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunAuthorizationInput,
    ) =>
      issueEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        binding(key, input.commandType, input.commandVersion),
      ),
    revalidateBatch: (deps: IdentityCommandDeps, requests: readonly EntryDecisionRevalidation[]) =>
      revalidateEntryBatch(common, now, binding, deps, requests),
    revalidate: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunRevalidationInput,
    ) =>
      revalidateEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        binding(key, input.expectedCommandType, input.expectedCommandVersion),
      ),
  };
}

export const FORMAL_COMPLETION_CONSUMERS = [
  ['output_creation', 'outputCreation'],
  ['result_validate', 'resultValidate'],
  ['result_accept', 'resultAccept'],
  ['run_finalize', 'runFinalize'],
  ['work_order_completion', 'workOrderCompletion'],
  ['task_completion', 'taskCompletion'],
  ['work_order_state', 'workOrderState'],
  ['task_state', 'taskState'],
  ['judgment_read', 'judgmentRead'],
  ['readiness_build', 'readinessBuild'],
  ['readiness_consume', 'readinessConsume'],
  ['driver_release', 'driverRelease'],
  ['work_order_validation', 'workOrderValidation'],
  ['work_order_freeze', 'workOrderFreeze'],
] as const;
export type FormalCompletionConsumer = (typeof FORMAL_COMPLETION_CONSUMERS)[number][0];
export interface FormalCompletionAuthorizationConfig {
  readonly capabilityCodes: Readonly<Record<string, string>>;
  readonly servicePrincipalIds: {
    readonly artifact: string;
    readonly evaluator: string;
    readonly validator: string;
    readonly driver: string;
    readonly taskExecution: readonly string[];
  };
  readonly now?: () => Date;
}
/** The finite approved mappings are code, never caller-controlled configuration. */
export function formalCompletionBindings(): readonly AuthorizationEntryBinding[] {
  function binding(
    key: string,
    type: string,
    version: string,
    purpose: string,
    action: string,
    target: string,
    kind: WorkOrderValidationTargetKind = 'OBJECT',
    create = false,
  ): AuthorizationEntryBinding {
    return {
      capabilityConfigKey: key,
      commandType: type,
      commandVersion: version,
      authorizationPurpose: purpose,
      requiredGrantAction: action,
      targetKind: kind,
      targetObjectTypes: [target],
      selectorType: create ? 'CREATE_TARGET_TYPE' : 'TARGET_TYPE',
      ...(kind === 'OBJECT' ? {} : { targetPayloadMember: 'sourceRef' }),
    };
  }
  const result: AuthorizationEntryBinding[] = [
    binding(
      'workOrderCompletionEvaluateV2',
      'execution.evaluate_work_order_completion',
      '2.0',
      'execution.work_order.evaluate_completion',
      'execution.work_order.completion.evaluate.v2',
      'zhiju.execution.work_order',
    ),
    binding(
      'taskCompletionEvaluateV2',
      'execution.evaluate_task_completion',
      '2.0',
      'execution.task.evaluate_completion',
      'execution.task.completion.evaluate.v2',
      'zhiju.execution.task',
    ),
    {
      ...binding(
        'outputCreationBindingReadV1',
        'execution.get_output_creation_binding',
        '1.0',
        'execution.run.output_creation_binding.read',
        'execution.run.output_creation_binding.read.v1',
        'execution.run',
      ),
      expectedPrincipalKind: 'SERVICE',
    },
    {
      ...binding(
        'executionRevisionCreateV1',
        'artifact.create_execution_revision',
        '1.0',
        'artifact.execution_revision.create',
        'artifact.execution_revision.create.v1',
        'artifact.artifact_revision',
        'OBJECT',
        true,
      ),
      expectedPrincipalKind: 'HUMAN',
    },
    binding(
      'executionOutputReadV1',
      'artifact.get_execution_output_fact',
      '1.0',
      'artifact.execution_output.read',
      'artifact.execution_output.read.v1',
      'artifact.artifact_revision',
      'CONTENT_ADDRESSED',
    ),
    binding(
      'workOrderStateReadV1',
      'execution.get_work_order_state',
      '1.0',
      'execution.work_order.state.read',
      'execution.work_order.state.read.v1',
      'zhiju.execution.work_order',
    ),
    binding(
      'completionJudgmentReadV1',
      'execution.get_execution_judgment',
      '1.0',
      'execution.judgment.read',
      'execution.completion_judgment.read.v1',
      'zhiju.execution.completion_evaluation',
      'CONTENT_ADDRESSED',
    ),
    {
      ...binding(
        'formalOutputReleaseV1',
        'integration.runtime.formal_output.release',
        '1.0',
        'integration.runtime.formal_output.release',
        'integration.runtime.formal_output.release.v1',
        'integration.runtime_attempt',
      ),
      expectedPrincipalKind: 'HUMAN',
    },
  ];
  const currentConsumers = [
    'work_order_completion',
    'task_completion',
    'work_order_state',
    'task_state',
    'judgment_read',
    'readiness_build',
    'readiness_consume',
  ];
  for (const [c, stem] of FORMAL_COMPLETION_CONSUMERS) {
    if (c !== 'output_creation')
      result.push(
        binding(
          `${stem}ExecutionOutputReadV1`,
          'artifact.get_execution_output_fact',
          '1.0',
          'artifact.execution_output.read',
          `artifact.execution_output.read.for_${c}.v1`,
          'artifact.artifact_revision',
          'CONTENT_ADDRESSED',
        ),
      );
    if (currentConsumers.includes(c)) {
      result.push(
        binding(
          `${stem}CompletionPolicyReadV1`,
          'identity.resolve_policy',
          '1.0',
          'identity.policy.resolve_policy',
          `identity.policy.resolve.for_${c}.v1`,
          'zhiju.identity.policy',
          'VERSIONED',
        ),
      );
      result.push({
        ...binding(
          `${stem}CompletionSourcesReadV1`,
          'execution.completion.sources.read',
          '1.0',
          'execution.completion.sources.read',
          `execution.completion.sources.read.for_${c}.v1`,
          'zhiju.execution.work_order',
        ),
        targetObjectTypes: ['zhiju.execution.work_order', 'zhiju.execution.task'],
      });
      result.push(
        binding(
          `${stem}CompletionBundleInspectV1`,
          'identity.execution_capability_bundle.inspect',
          '1.0',
          'identity.execution_capability_bundle.inspect',
          `identity.execution_bundle.inspect.for_${c}.v1`,
          'zhiju.identity.execution_capability_bundle',
          'CONTENT_ADDRESSED',
        ),
      );
      result.push(
        binding(
          `${stem}RevisionAcceptanceReadV1`,
          'quality.get_revision_acceptance_snapshot',
          '1.0',
          'quality.governance.get_revision_acceptance_snapshot',
          `quality.ras.read.for_${c}.v1`,
          'quality.revision_acceptance_snapshot',
          'SNAPSHOT',
        ),
      );
      result.push(
        binding(
          `${stem}ApprovalBundleReadV1`,
          'quality.get_approval_bundle_snapshot',
          '1.0',
          'quality.governance.get_approval_bundle_snapshot',
          `quality.abs.read.for_${c}.v1`,
          'quality.approval_bundle_snapshot',
          'SNAPSHOT',
        ),
      );
      result.push(
        binding(
          `${stem}RevisionEligibilityReadV1`,
          'quality.get_revision_execution_eligibility',
          '1.0',
          'quality.revision.execution_eligibility.read',
          `quality.execution_eligibility.read.for_${c}.v1`,
          'artifact.artifact_revision',
        ),
      );
    }
    if (['work_order_validation', 'work_order_freeze'].includes(c)) {
      result.push({
        ...binding(
          `${stem}QualityProfileReadV1`,
          'quality.get_quality_profile',
          '1.0',
          'quality.governance.get_quality_profile',
          `quality.profile.read.for_${c}.v1`,
          'quality.quality_profile',
          'VERSIONED',
        ),
        enterpriseResource: true,
      });
      result.push(
        binding(
          `${stem}TaskDefinitionReadV1`,
          'execution.task.definition.read',
          '1.0',
          'execution.task.definition.read',
          `execution.task.definition.read.for_${c}.v1`,
          'zhiju.execution.task',
        ),
      );
    }
    if (c === 'task_completion')
      result.push(
        binding(
          `${stem}CompletionQualitySelectionReadV1`,
          'quality.completion_selection.read',
          '1.0',
          'quality.completion_selection.read',
          `quality.completion_selection.read.for_${c}.v1`,
          'artifact.artifact_revision',
        ),
      );
  }
  result.push(
    binding(
      'outputCreationControlsReadV1',
      'identity.resolve_policy',
      '1.0',
      'identity.policy.resolve_policy',
      'identity.policy.resolve.for_output_creation.v1',
      'zhiju.identity.policy',
      'VERSIONED',
    ),
  );
  result.push(
    binding(
      'outputCreationBundleReadV1',
      'identity.execution_capability_bundle.read',
      '1.0',
      'identity.execution_capability_bundle.read',
      'identity.execution_bundle.read.for_output_creation.v1',
      'zhiju.identity.execution_capability_bundle',
      'CONTENT_ADDRESSED',
    ),
  );
  return Object.freeze(result);
}
export function createFormalCompletionAuthorizationPort(
  config: FormalCompletionAuthorizationConfig,
) {
  const now = config.now ?? (() => new Date()),
    common = config as unknown as WorkOrderValidationAuthorizationConfig;
  function mapping(key: string, type: string, version: string) {
    const b = formalCompletionBindings().find(
      (v) =>
        v.capabilityConfigKey === key && v.commandType === type && v.commandVersion === version,
    );
    if (!b)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'Unsupported formal completion boundary',
      );
    const ids =
      key === 'outputCreationBindingReadV1'
        ? [config.servicePrincipalIds.artifact]
        : key === 'executionOutputReadV1'
          ? [
              config.servicePrincipalIds.evaluator,
              config.servicePrincipalIds.validator,
              config.servicePrincipalIds.driver,
            ]
          : [
                'workOrderCompletionEvaluateV2',
                'taskCompletionEvaluateV2',
                'taskCompletionCompletionQualitySelectionReadV1',
              ].includes(key)
            ? [config.servicePrincipalIds.evaluator]
            : [
                config.servicePrincipalIds.artifact,
                config.servicePrincipalIds.evaluator,
                config.servicePrincipalIds.validator,
                config.servicePrincipalIds.driver,
                ...config.servicePrincipalIds.taskExecution,
              ];
    return {
      ...b,
      ...(b.expectedPrincipalKind === 'HUMAN' ? { forbidActingFor: true } : {}),
      principalKinds: b.expectedPrincipalKind ? [b.expectedPrincipalKind] : ['HUMAN', 'SERVICE'],
      allowedServicePrincipalIds: ids,
    };
  }
  return {
    authorize: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunAuthorizationInput,
    ) =>
      issueEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        mapping(key, input.commandType, input.commandVersion),
      ),
    revalidateBatch: (deps: IdentityCommandDeps, requests: readonly EntryDecisionRevalidation[]) =>
      revalidateEntryBatch(common, now, mapping, deps, requests),
    revalidate: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunRevalidationInput,
    ) =>
      revalidateEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        mapping(key, input.expectedCommandType, input.expectedCommandVersion),
      ),
  };
}

// #239: finite owning mappings; Service identities come from trusted deployment configuration.
export interface TaskCompletedDeliveryAuthorizationConfig {
  readonly capabilityCodes: Readonly<Record<string, string>>;
  readonly servicePrincipalIds: {
    dispatcher: string;
    consumer: string;
    evaluator: string;
    reader: string;
  };
  readonly now?: () => Date;
}
export function taskCompletedDeliveryBindings(): readonly AuthorizationEntryBinding[] {
  const operations = [
    [
      'taskCompletedScanV1',
      'execution.task_completed.dispatch.scan',
      'zhiju.project.project',
      'dispatcher',
    ],
    [
      'taskCompletedClaimV1',
      'execution.task_completed.dispatch.claim',
      'zhiju.project.project',
      'dispatcher',
    ],
    [
      'taskCompletedReadV1',
      'execution.task_completed.dispatch.read',
      'zhiju.execution.task',
      'dispatcher',
    ],
    [
      'taskCompletedConfirmV1',
      'execution.task_completed.dispatch.confirm',
      'zhiju.execution.task',
      'dispatcher',
    ],
    [
      'taskCompletedFailureV1',
      'execution.task_completed.dispatch.failure',
      'zhiju.execution.task',
      'dispatcher',
    ],
    [
      'taskCompletedResumeV1',
      'execution.task_completed.dispatch.resume',
      'zhiju.execution.task',
      'human',
    ],
    [
      'deliveryCompletionConsumeV1',
      'project.delivery_completion.consume',
      'zhiju.project.project',
      'consumer',
    ],
    [
      'deliveryItemCompletionEvaluateV2',
      'project.evaluate_delivery_item_completion',
      'zhiju.project.delivery_item',
      'evaluator',
    ],
    [
      'deliveryCompletionReadExactV1',
      'project.delivery_completion.read_exact',
      'zhiju.project.delivery_item',
      'reader',
    ],
  ] as const;
  return operations.map(([key, type, target, role]) => ({
    capabilityConfigKey: key,
    commandType: type,
    commandVersion: role === 'evaluator' ? '2.0' : '1.0',
    authorizationPurpose: role === 'evaluator' ? 'project.delivery_item.evaluate_completion' : type,
    requiredGrantAction:
      role === 'evaluator' ? 'project.delivery_item.completion.evaluate.v2' : type + '.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: [target],
    selectorType: 'TARGET_TYPE',
    ...(role === 'human'
      ? { expectedPrincipalKind: 'HUMAN', forbidActingFor: true }
      : role === 'evaluator' || role === 'reader'
        ? { principalKinds: ['HUMAN', 'SERVICE'] as const }
        : { expectedPrincipalKind: 'SERVICE' }),
  }));
}
export function createTaskCompletedDeliveryAuthorizationPort(
  config: TaskCompletedDeliveryAuthorizationConfig,
) {
  const now = config.now ?? (() => new Date()),
    common = config as unknown as WorkOrderValidationAuthorizationConfig;
  function mapping(key: string, type: string, version: string) {
    const b = taskCompletedDeliveryBindings().find(
      (v) =>
        v.capabilityConfigKey === key && v.commandType === type && v.commandVersion === version,
    );
    if (!b)
      throw new SnapshotBoundaryError(
        IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
        'Unsupported delivery completion boundary',
      );
    const role = key.startsWith('taskCompleted')
      ? 'dispatcher'
      : key === 'deliveryCompletionConsumeV1'
        ? 'consumer'
        : key === 'deliveryItemCompletionEvaluateV2'
          ? 'evaluator'
          : 'reader';
    return { ...b, allowedServicePrincipalIds: [config.servicePrincipalIds[role]] };
  }
  return {
    authorize: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunAuthorizationInput,
    ) =>
      issueEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.targetRef,
        mapping(key, input.commandType, input.commandVersion),
      ),
    revalidate: (
      deps: IdentityCommandDeps,
      key: string,
      input: ControlledFirstRunRevalidationInput,
    ) =>
      revalidateEntryDecision(
        common,
        now,
        undefined,
        deps,
        input,
        input.expectedTargetRef,
        mapping(key, input.expectedCommandType, input.expectedCommandVersion),
      ),
  };
}
