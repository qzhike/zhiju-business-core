// IM-06 (#216): `execution.build_initial_context_snapshot@1.1`, the initial
// Context Snapshot build (Spec 003 §19, approved #214 design; PR #217 review
// corrections §20.2/§20.3).
//
// One owning TaskExecution transaction commits the immutable
// `context_snapshot` row (the ProjectContext v1.0 Contract Record), its
// INITIAL `context_snapshot_build` metadata, the Receipt, the safe Audit, the
// DRAFT/Policy/Slice Reference Edges and the single registered
// `execution.ContextSnapshotBuilt@1.1` Outbox row, whose complete Event
// envelope is validated against the real ContractRegistry before anything is
// written (§20.3). The DRAFT dependency read carries its own current
// authorization proof, revalidated before the runner claims the Receipt
// (§20.2). `build_initial_context_snapshot@1.0`
// has no satisfiable input and no owning writer (§19.1): this handler throws
// `COMMAND_TARGET_MISMATCH` for it, one layer below the authorization entry
// that already refuses it.
//
// The handler owns what the registered Schemas cannot express: the exact
// DRAFT identity chain (by-identity read, `FOR SHARE` Root lock, status and
// composite pointer revalidation, §19.8), the cross-module observations
// through the EnterpriseProject-owned Slice read Port and the
// IdentityPolicy-owned Policy resolve Port (both fail-closed on
// unavailability), the #168 expiry composition re-check (§11.2.5.4) and the
// commit-point WorkOrder/effective expiry revalidation (§19.5). The
// deterministic assembly itself is pure (`initial-context-assembly.ts`); the
// database closes the same facts again through the V3004 mirror and
// creation-identity guards.

import {
  canonicalize,
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  ContractRegistry,
  validateInitialContextCommandResult,
  validateInitialContextExpiryBinding,
} from '@zhiju/contracts';
import {
  CANONICALIZATION_VERSION,
  digestCanonicalPayload,
  PAYLOAD_HASH_ALGORITHM,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  CommandExecutionError,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  executeTaskExecutionCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import { WorkOrderDraftRepository } from '../persistence/work-order-draft-repository.js';
import { CONTEXT_SNAPSHOT_OBJECT_TYPE } from '../persistence/context-snapshot-repository.js';
import { exactProjectScope } from './task-readiness-plan.js';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  DEPENDENCY_UNAVAILABLE,
} from './work-order-draft-creation.js';
import { AUTHORIZATION_EXPIRED } from './task-readiness-production.js';
import {
  AGGREGATE_STATE_NOT_ALLOWED,
  REFERENCE_INVALID,
  WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
} from './work-order-draft-read.js';
import {
  assembleInitialContext,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  type InitialContextAssemblySlice,
} from './initial-context-assembly.js';

/** The registered command this handler owns. Only `@1.1` is satisfiable (§19.1). */
export const BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND = 'execution.build_initial_context_snapshot';
export const BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION = '1.1';

/** §19.1 / §19.8: the only new stable codes of this entry. */
export const EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH = 'EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH';
export const EXECUTION_DRAFT_SNAPSHOT_STALE = 'EXECUTION_DRAFT_SNAPSHOT_STALE';

/** §11.2.5.2 closed codes this handler maps lifecycle states onto. */
export const POLICY_NOT_EFFECTIVE = 'POLICY_NOT_EFFECTIVE';
export const POLICY_EXPIRED = 'POLICY_EXPIRED';

const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';
const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';
const AUTHORIZATION_DECISION_OBJECT_TYPE = 'identity.authorization_decision';
const CONTEXT_SNAPSHOT_BUILT_EVENT = 'execution.ContextSnapshotBuilt';
// §20.3: the corrected build publishes the additive @1.1 event only; the
// frozen @1.0 stays registered for compatibility but is no longer produced.
const CONTEXT_SNAPSHOT_BUILT_EVENT_VERSION = '1.1';

const HEX_64 = /^[0-9a-f]{64}$/u;

/**
 * The EnterpriseProject-owned exact Source Slice read (§19.3 item 2). The Port
 * resolves the request's exact CONTENT_ADDRESSED ref and answers the owning
 * `project.get_context_source_slice@1.0` result; `undefined` means no such
 * committed Slice, and an unavailable boundary throws instead of answering.
 */
export interface ContextSourceSliceObservation {
  readonly slice: CanonicalJsonObject;
  readonly useStatus: string;
  readonly checkedAt: string;
}

export interface ContextSourceSliceReadPort {
  getContextSourceSlice(request: {
    readonly sourceSliceRef: CanonicalJsonObject;
  }): Promise<ContextSourceSliceObservation | undefined>;
}

/**
 * The IdentityPolicy-owned exact Builder Policy resolution (§19.4 item 3). The
 * object carries the owning `identity.resolve_policy@1.0` observation; the
 * binding check, not the caller, decides whether it is the requested Policy.
 */
export interface ContextBuilderPolicyResolution {
  readonly status: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'REVOKED';
  readonly policyRef?: CanonicalJsonObject | undefined;
  /** The resolved Policy content hash digest (64 lowercase hex). */
  readonly contentHash?: string | undefined;
  readonly effectiveFrom?: string | undefined;
  readonly supersededAt?: string | null | undefined;
  readonly policyDocument?: unknown;
  readonly policySchemaRefs?: readonly unknown[] | undefined;
}

export interface ContextBuilderPolicyPort {
  resolvePolicy(request: {
    readonly policyRef: CanonicalJsonObject;
  }): Promise<ContextBuilderPolicyResolution>;
}

/**
 * §20.2 / Spec 001 §15.9: the composition-supplied proof of the current DRAFT
 * dependency-read authorization. The composition layer obtains it from the
 * IdentityPolicy-owned revalidation Port before calling this handler; the
 * handler re-proves, before the runner claims anything, that the proof names
 * the request's exact `draftSnapshotRef` through a well-formed
 * AuthorizationDecision reference and a current trusted-time expiry.
 */
export interface InitialContextDraftReadDecision {
  /** The complete DRAFT snapshot ContentAddressedRef the Decision covers. */
  readonly draftSnapshotRef: CanonicalJsonObject;
  /** The exact ContentAddressedRef of the ALLOW AuthorizationDecision. */
  readonly authorizationDecisionRef: CanonicalJsonObject;
  /** The Decision expiry (ISO instant), re-checked against the trusted clock. */
  readonly expiresAt: string;
}

export interface InitialContextBuildPorts {
  readonly slices: ContextSourceSliceReadPort;
  readonly policy: ContextBuilderPolicyPort;
  /**
   * §20.2: the current DRAFT dependency-read authorization proof. It is a
   * required port member precisely so a composition that never obtained the
   * Decision cannot reach the DRAFT read.
   */
  readonly draftRead: InitialContextDraftReadDecision;
  /** Trusted server clock; the module's existing trusted-time semantics. */
  readonly now?: (() => Date) | undefined;
}

/**
 * Server-composed idempotency scope of one build version in one Project
 * Scope. It is never taken from a caller, and it carries the exact
 * `commandType@commandVersion`, so the build never shares a claim with any
 * other operation.
 */
export function buildInitialContextIdempotencyScope(
  commandType: string,
  commandVersion: string,
  enterpriseId: string,
  projectId: string,
): string {
  return `${commandType}@${commandVersion}:${enterpriseId}:${projectId}`;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reject(
  errorCode: string,
  safeSummary: string,
): { kind: 'REJECTED'; errorCode: string; safeSummary: string } {
  return { kind: 'REJECTED', errorCode, safeSummary };
}

const REQUEST_MEMBERS: Readonly<Record<string, true>> = Object.freeze({
  draftSnapshotRef: true,
  projectionType: true,
  purpose: true,
  audience: true,
  sourceSlices: true,
  builderPolicyRef: true,
  expiresAt: true,
});

function readContentHash(value: unknown): { readonly digest: string } | undefined {
  const contentHash = record(value);
  const digest = contentHash.digest;
  if (
    contentHash.algorithm !== 'SHA-256' ||
    typeof digest !== 'string' ||
    !HEX_64.test(digest) ||
    contentHash.canonicalizationVersion !== '1'
  ) {
    return undefined;
  }
  return { digest };
}

/**
 * The exact CONTENT_ADDRESSED identity of one declared reference in the
 * Envelope Project scope, or undefined when the reference is not exactly that.
 */
function readExactContentAddressedRef(
  value: unknown,
  objectType: string,
  scope: { readonly enterpriseId: string; readonly projectId: string },
): { readonly objectId: string; readonly hash: Buffer } | undefined {
  const ref = record(value);
  const contentHash = readContentHash(ref.contentHash);
  const refScope = exactProjectScope(ref.scope);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== objectType ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    contentHash === undefined ||
    refScope?.enterpriseId !== scope.enterpriseId ||
    refScope.projectId !== scope.projectId
  ) {
    return undefined;
  }
  return { objectId: ref.objectId, hash: Buffer.from(contentHash.digest, 'hex') };
}

/**
 * The Builder Policy ref gate of §11.2.5.1 row 1: an exact
 * `zhiju.identity.policy` VersionedRef inside the trusted Scope. Missing,
 * legacy or foreign refs are refused before any assembly.
 */
function readBuilderPolicyRef(
  value: unknown,
  scope: { readonly enterpriseId: string; readonly projectId: string },
): { readonly objectId: string; readonly versionId: string } | undefined {
  const ref = record(value);
  const refScope = record(ref.scope);
  const scopeKeys = Object.keys(refScope);
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== POLICY_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId) ||
    scopeKeys.length === 0 ||
    !scopeKeys.every((key) => key === 'enterpriseId' || key === 'projectId') ||
    refScope.enterpriseId !== scope.enterpriseId ||
    (refScope.projectId !== undefined && refScope.projectId !== scope.projectId)
  ) {
    return undefined;
  }
  return { objectId: ref.objectId, versionId: ref.versionId };
}

/**
 * §20.2 preflight: the composition-supplied DRAFT dependency-read proof must
 * name the exact `draftSnapshotRef` the request carries, through a well-formed
 * AuthorizationDecision reference and a current trusted-time expiry. Every
 * defect throws before the runner is entered: no DRAFT fact is read, no
 * idempotency Receipt is claimed and no historical Receipt is returned. A
 * missing proof, a substituted ref, a malformed Decision reference or an
 * unparseable expiry is `AUTHORIZATION_DECISION_INVALID`; a crossed expiry is
 * `AUTHORIZATION_EXPIRED` (mirroring the owning revalidation's `expires_at <=
 * now` semantics).
 */
function assertDraftReadProof(
  proof: InitialContextDraftReadDecision | undefined,
  draftSnapshotRef: unknown,
  trustedNow: () => Date,
): void {
  const decisionRef = record(proof?.authorizationDecisionRef);
  let sameRef: boolean;
  try {
    sameRef =
      canonicalize(proof?.draftSnapshotRef as CanonicalJsonValue) ===
      canonicalize(draftSnapshotRef as CanonicalJsonValue);
  } catch {
    sameRef = false;
  }
  if (
    proof === undefined ||
    decisionRef.kind !== 'CONTENT_ADDRESSED' ||
    decisionRef.objectType !== AUTHORIZATION_DECISION_OBJECT_TYPE ||
    typeof decisionRef.objectId !== 'string' ||
    !isUuidV7(decisionRef.objectId) ||
    !sameRef
  ) {
    throw new CommandExecutionError(
      AUTHORIZATION_DECISION_INVALID,
      'the DRAFT dependency-read authorization proof does not cover the requested draft snapshot',
    );
  }
  const expiresAt = Date.parse(proof.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new CommandExecutionError(
      AUTHORIZATION_DECISION_INVALID,
      'the DRAFT dependency-read authorization proof carries no parseable expiry',
    );
  }
  if (expiresAt <= trustedNow().getTime()) {
    throw new CommandExecutionError(
      AUTHORIZATION_EXPIRED,
      'the DRAFT dependency-read authorization has expired',
    );
  }
}

export async function handleBuildInitialContext(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: InitialContextBuildPorts,
): Promise<CommandResult> {
  const projectId = envelope.projectId;
  if (
    envelope.commandType !== BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND ||
    envelope.commandVersion !== BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION ||
    envelope.targetType !== CONTEXT_SNAPSHOT_OBJECT_TYPE ||
    projectId === undefined ||
    !isUuidV7(envelope.targetId)
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the initial Context build target must be the pre-allocated Context Snapshot identity of this Project',
    );
  }
  // This operation is a CREATE: the Snapshot identity does not exist yet, so an
  // expected aggregate version can only be a request that misunderstands it.
  if (envelope.expectedAggregateVersion !== undefined) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'an initial Context build must omit the expected aggregate version',
    );
  }
  const scope = { enterpriseId: envelope.enterpriseId, projectId };
  const trustedNow = ports.now ?? ((): Date => new Date());

  // §20.2: the DRAFT dependency read carries its own current authorization,
  // independent of the build Decision. The composition-supplied proof is
  // revalidated before the command runner claims the Receipt, so a missing,
  // substituted, malformed or expired proof fails closed ahead of any DRAFT
  // fact read, idempotency claim and historical Receipt return. A payload
  // whose `draftSnapshotRef` cannot even parse skips this preflight: the body
  // below rejects it with the same fail-closed codes and still reads no DRAFT
  // fact.
  const preflightPayload = record(envelope.requestPayload);
  const preflightRequest = record(preflightPayload.request);
  if (
    Object.keys(preflightPayload).every((member) => member === 'request') &&
    Object.keys(preflightRequest).every((member) => REQUEST_MEMBERS[member] === true) &&
    readExactContentAddressedRef(
      preflightRequest.draftSnapshotRef,
      WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
      scope,
    ) !== undefined
  ) {
    assertDraftReadProof(ports.draftRead, preflightRequest.draftSnapshotRef, trustedNow);
  }

  return executeTaskExecutionCommand(db, context, envelope, async (execution) => {
    const payload = envelope.requestPayload;

    // The registered Envelope is closed to `{request}`; the V3004
    // creation-identity guards bind the stored facts to this exact payload
    // through the Receipt request hash, so any other member is a payload
    // defect rather than a fact to store.
    if (!Object.keys(payload).every((member) => member === 'request')) {
      return reject(
        API_VALUE_INVALID,
        'the build_initial_context_snapshot payload is closed to request',
      );
    }
    const request = record(payload.request);
    if (!Object.keys(request).every((member) => REQUEST_MEMBERS[member] === true)) {
      return reject(
        API_VALUE_INVALID,
        'the initial Context request is closed to its registered members',
      );
    }

    const draftRef = readExactContentAddressedRef(
      request.draftSnapshotRef,
      WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
      scope,
    );
    if (draftRef === undefined) {
      return reject(
        REFERENCE_INVALID,
        'draftSnapshotRef must be the exact ContentAddressedRef of a WorkOrder draft snapshot in this Project scope',
      );
    }
    const policyRef = readBuilderPolicyRef(request.builderPolicyRef, scope);
    if (policyRef === undefined) {
      return reject(
        REFERENCE_INVALID,
        'builderPolicyRef must be the exact zhiju.identity.policy VersionedRef of the trusted Scope',
      );
    }
    const sourceSlicesValue = request.sourceSlices;
    if (!Array.isArray(sourceSlicesValue) || sourceSlicesValue.length === 0) {
      return reject(API_VALUE_INVALID, 'sourceSlices must be a non-empty array of exact refs');
    }
    const sliceRefs: {
      readonly ref: CanonicalJsonObject;
      readonly objectId: string;
      readonly hash: Buffer;
    }[] = [];
    for (const sliceRefValue of sourceSlicesValue) {
      const sliceRef = readExactContentAddressedRef(
        sliceRefValue,
        CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        scope,
      );
      if (sliceRef === undefined) {
        return reject(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'every sourceSlices entry must be the exact ContentAddressedRef of a context source slice in this Project scope',
        );
      }
      sliceRefs.push({
        ref: sliceRefValue as CanonicalJsonObject,
        objectId: sliceRef.objectId,
        hash: sliceRef.hash,
      });
    }
    const audience = record(request.audience);
    if (
      typeof audience.principalId !== 'string' ||
      typeof audience.principalKind !== 'string' ||
      typeof request.projectionType !== 'string' ||
      typeof request.purpose !== 'string'
    ) {
      return reject(
        API_VALUE_INVALID,
        'projectionType, purpose and audience must be the declared request members',
      );
    }

    // §19.1 item 1: the DRAFT is resolved by its own exact identity; the
    // request hash pins the ref's content hash to the immutable row.
    const repository = new WorkOrderDraftRepository();
    const draftSnapshot = await repository.readWorkOrderDraftSnapshotByIdentity(
      execution.trx,
      draftRef.objectId,
      draftRef.hash,
    );
    if (
      draftSnapshot?.enterpriseId !== scope.enterpriseId ||
      draftSnapshot.projectId !== scope.projectId
    ) {
      return reject(
        REFERENCE_INVALID,
        'the draft snapshot reference does not close against a committed draft of this scope',
      );
    }
    let draftDigest;
    try {
      draftDigest = digestCanonicalPayload(draftSnapshot.canonicalPayload as CanonicalJsonObject);
    } catch {
      return reject(
        REFERENCE_INVALID,
        'the stored draft payload cannot define its content address',
      );
    }
    if (!draftDigest.hash.equals(draftSnapshot.payloadHash)) {
      return reject(
        REFERENCE_INVALID,
        'the stored draft payload does not match its content address',
      );
    }

    // §19.8 item 1: the WorkOrder Root is read under the read-only dependency
    // lock (`FOR SHARE`, held to commit), and the status/pointer revalidation
    // below runs while that lock is held.
    const root = await repository.readWorkOrderRootForShare(
      execution.trx,
      draftSnapshot.workOrderId,
    );
    if (root?.enterpriseId !== scope.enterpriseId || root.projectId !== scope.projectId) {
      return reject(
        REFERENCE_INVALID,
        'the owning WorkOrder does not close against a committed WorkOrder of this scope',
      );
    }
    if (
      root.draftSchemaVersion !== '1.1' ||
      root.workOrderObjectType !== 'zhiju.execution.work_order'
    ) {
      return reject(
        EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
        'the initial Context build only accepts a WorkOrder draft created by create_work_order@1.1',
      );
    }
    if (root.status !== 'DRAFT') {
      return reject(EXECUTION_DRAFT_SNAPSHOT_STALE, 'the owning WorkOrder is no longer a DRAFT');
    }
    if (
      root.currentDraftSnapshotId !== draftSnapshot.snapshotId ||
      !root.currentDraftSnapshotHash.equals(draftSnapshot.payloadHash)
    ) {
      return reject(
        EXECUTION_DRAFT_SNAPSHOT_STALE,
        'the requested draft snapshot is not the draft the WorkOrder currently points to',
      );
    }

    const stored = record(draftSnapshot.canonicalPayload);
    const storedWorkOrderRef = record(stored.workOrderRef);
    const storedTaskRef = record(stored.taskRef);
    const storedScope = record(stored.scopeRef);
    const storedDraft = stored.draft;
    const storedExpiresAt = Object.prototype.hasOwnProperty.call(stored, 'expiresAt')
      ? stored.expiresAt
      : undefined;
    if (
      stored.snapshotId !== draftSnapshot.snapshotId ||
      storedWorkOrderRef.kind !== 'OBJECT' ||
      storedWorkOrderRef.objectType !== root.workOrderObjectType ||
      storedWorkOrderRef.objectId !== root.workOrderId ||
      storedTaskRef.kind !== 'OBJECT' ||
      storedTaskRef.objectType !== root.taskObjectType ||
      storedTaskRef.objectId !== root.taskId ||
      storedScope.enterpriseId !== root.enterpriseId ||
      storedScope.projectId !== root.projectId ||
      storedDraft === null ||
      typeof storedDraft !== 'object' ||
      Array.isArray(storedDraft) ||
      (storedExpiresAt !== undefined && typeof storedExpiresAt !== 'string')
    ) {
      return reject(REFERENCE_INVALID, 'the stored draft payload does not match its WorkOrder');
    }
    const draft = record(storedDraft);
    // §19.1 item 1: the @1.1 DRAFT shape carries DraftVersionPins without a
    // `projectContextContractRef`; the @1.0 pin set is the other creation
    // major's identity, never an alias of this one.
    const versionPins = record(draft.versionPins);
    if (Object.prototype.hasOwnProperty.call(versionPins, 'projectContextContractRef')) {
      return reject(
        EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
        'the initial Context build only accepts the @1.1 DraftVersionPins shape',
      );
    }

    // §19.4 item 2: every Source Slice is read through the owning EP boundary
    // by its exact ref; existence, content closure and current usability are
    // owning facts, and an unavailable boundary fails closed.
    const slices: InitialContextAssemblySlice[] = [];
    for (const sliceRef of sliceRefs) {
      let observation: ContextSourceSliceObservation | undefined;
      try {
        observation = await ports.slices.getContextSourceSlice({
          sourceSliceRef: sliceRef.ref,
        });
      } catch {
        throw new CommandExecutionError(
          DEPENDENCY_UNAVAILABLE,
          'the EnterpriseProject source slice read boundary is unavailable',
        );
      }
      if (observation?.useStatus !== 'USABLE') {
        return reject(
          EXECUTION_CONTEXT_SOURCE_INVALID,
          'a Source Slice is missing or not currently usable',
        );
      }
      slices.push({ ref: sliceRef.ref, slice: observation.slice });
    }

    // §19.4 item 3: the Builder Policy observation comes only from the owning
    // `identity.resolve_policy@1.0` read of this exact ref, with its own
    // authorization. Lifecycle states map onto the §11.2.5.2 closed codes.
    let resolution: ContextBuilderPolicyResolution;
    try {
      resolution = await ports.policy.resolvePolicy({
        policyRef: request.builderPolicyRef as CanonicalJsonObject,
      });
    } catch {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'the IdentityPolicy resolution entry is unavailable',
      );
    }
    if (resolution.status === 'NOT_YET_EFFECTIVE') {
      return reject(
        POLICY_NOT_EFFECTIVE,
        'the requested Builder Policy version is not yet effective',
      );
    }
    if (resolution.status !== 'USABLE') {
      return reject(POLICY_EXPIRED, 'the requested Builder Policy version is not currently usable');
    }
    const policyContentHash = resolution.contentHash;
    const policyEffectiveFrom = resolution.effectiveFrom;
    if (
      resolution.policyRef === undefined ||
      typeof policyContentHash !== 'string' ||
      !HEX_64.test(policyContentHash) ||
      typeof policyEffectiveFrom !== 'string'
    ) {
      return reject(
        REFERENCE_INVALID,
        'the resolved Builder Policy observation is not the exact reference this request declared',
      );
    }

    // §19.4 item 5: `asOf` is the trusted commit-point instant of this
    // transaction; the same sample drives the payload stamp, the deterministic
    // contextItemId time field and the §19.5 commit-point revalidation.
    const commitAt = trustedNow();
    const asOf = commitAt.toISOString();
    const snapshotId = newUuidV7();

    const assembled = assembleInitialContext({
      request: {
        draftSnapshotRef: request.draftSnapshotRef as CanonicalJsonObject,
        projectionType: request.projectionType,
        purpose: request.purpose,
        audience: {
          principalId: audience.principalId,
          principalKind: audience.principalKind,
        },
        builderPolicyRef: request.builderPolicyRef as CanonicalJsonObject,
        ...(Object.prototype.hasOwnProperty.call(request, 'expiresAt')
          ? { expiresAt: request.expiresAt }
          : {}),
      },
      draft: {
        workOrderRef: stored.workOrderRef as CanonicalJsonObject,
        taskRef: stored.taskRef as CanonicalJsonObject,
        scopeRef: { enterpriseId: root.enterpriseId, projectId: root.projectId },
        draft,
        ...(storedExpiresAt === undefined ? {} : { expiresAt: storedExpiresAt }),
      },
      slices,
      policy: {
        resolvedRef: resolution.policyRef,
        contentHashDigest: policyContentHash,
        effectiveFrom: policyEffectiveFrom,
        supersededAt: resolution.supersededAt ?? undefined,
        policySchemaRefs: resolution.policySchemaRefs ?? [],
        policyDocument: resolution.policyDocument,
      },
      snapshotId,
      asOf,
      correlationId: envelope.correlationId,
      causationId: envelope.causationId,
      issuedBy: { principalId: context.principalId, principalKind: context.principalKind },
    });
    if (assembled.outcome === 'REJECTED') {
      return reject(assembled.errorCode, assembled.safeSummary);
    }

    // §11.2.5.4 / §19.5: the expiry binding is re-validated with the trusted
    // commit instant against the assembled mirrors; an already-crossed Context
    // expiry is the Builder-side `AGGREGATE_STATE_NOT_ALLOWED`, every other
    // failure keeps its own closed code.
    const payloadExpiresAt = assembled.payload.expiresAt;
    const metadataRecord = record(assembled.metadata);
    const expiryBinding = validateInitialContextExpiryBinding({
      request: {
        ...(Object.prototype.hasOwnProperty.call(request, 'expiresAt')
          ? { expiresAt: request.expiresAt as string }
          : {}),
      },
      workOrder: { ...(storedExpiresAt === undefined ? {} : { expiresAt: storedExpiresAt }) },
      sourceSlices: slices.map((entry) => {
        const validUntil = record(entry.slice).validUntil;
        return typeof validUntil === 'string' ? { validUntil } : {};
      }),
      builderPolicy: {
        ...(resolution.supersededAt == null ? {} : { supersededAt: resolution.supersededAt }),
      },
      projectContext: {
        ...(typeof payloadExpiresAt === 'string' ? { expiresAt: payloadExpiresAt } : {}),
      },
      contextBuildMetadata: {
        ...(typeof metadataRecord.requestExpiresAt === 'string'
          ? { requestExpiresAt: metadataRecord.requestExpiresAt }
          : {}),
        ...(typeof metadataRecord.effectiveExpiresAt === 'string'
          ? { effectiveExpiresAt: metadataRecord.effectiveExpiresAt }
          : {}),
      },
      now: asOf,
    });
    if (!expiryBinding.valid) {
      const first = expiryBinding.errors[0];
      const code = first?.code ?? 'INVALID_EXPIRY_BINDING';
      return reject(
        code === 'CONTEXT_EXPIRED' ? AGGREGATE_STATE_NOT_ALLOWED : code,
        'the initial Context expiry binding does not close',
      );
    }

    // §19.5: the WorkOrder creation expiry is revalidated at the commit point
    // under the held dependency lock (Root mirror, the §11.2.4 semantics).
    if (root.expiresAt !== null && commitAt.getTime() >= root.expiresAt.getTime()) {
      return reject(AGGREGATE_STATE_NOT_ALLOWED, 'the owning WorkOrder creation expiry has passed');
    }

    const digest = digestCanonicalPayload(assembled.payload);
    const contextSnapshotRef = {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
      objectId: envelope.targetId,
      snapshotId,
      scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      contentHash: {
        algorithm: 'SHA-256',
        digest: digest.hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
    const result = {
      targetRef: {
        kind: 'OBJECT',
        objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
        objectId: envelope.targetId,
        scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      },
      data: { contextSnapshotRef },
    } as unknown as CanonicalJsonObject;
    // §11.2.5.3: the result binding is a pure contract check; this handler
    // builds both sides from one identity, so a failure here is a defect.
    if (!validateInitialContextCommandResult(result).valid) {
      return reject(REFERENCE_INVALID, 'the assembled Context Snapshot result does not close');
    }

    const projection = record(assembled.payload.projection);
    const manifest = record(assembled.payload.sourceManifest);
    const coverage = record(assembled.payload.coverage);
    const manifestSingletons = [
      'enterpriseProfileSnapshotRef',
      'qmsConfigurationRef',
      'customerBaselineRef',
      'templateBaselineRef',
      'regulatoryProfileRef',
      'gapAnalysisRef',
      'deliveryPlanRef',
    ].filter((member) => manifest[member] !== undefined).length;
    const manifestArrays = ['policyRefs', 'schemaRefs', 'externalAuthoritySnapshotRefs'].reduce(
      (total, member) => total + (Array.isArray(manifest[member]) ? manifest[member].length : 0),
      0,
    );
    const payloadExpiresAtText =
      typeof payloadExpiresAt === 'string' ? payloadExpiresAt : undefined;
    const requestPayloadHash = digestCanonicalPayload(envelope.requestPayload).hash;

    // §20.3: the success path publishes exactly one additive
    // `execution.ContextSnapshotBuilt@1.1`. Its payload is closed to the four
    // registered members - the refs taken from the committed-payload facts and
    // the two enums taken verbatim from the assembled ProjectContext - and
    // carries no Scope members: the event Scope lives only on the envelope
    // `scopeRef`. The complete Event envelope is validated against the real
    // ContractRegistry before anything is written, so a build whose event
    // cannot close fails here with zero inserts; a failure, conflict or
    // same-key replay writes no Outbox row at all.
    const eventPayload = {
      contextSnapshotRef,
      workOrderRef: stored.workOrderRef as CanonicalJsonObject,
      projectionType: projection.projectionType,
      coverageStatus: coverage.completeness,
    } as unknown as CanonicalJsonObject;
    const eventId = newUuidV7();
    const eventCausationId = envelope.causationId ?? envelope.commandId;
    const eventEnvelope = {
      eventId,
      eventType: CONTEXT_SNAPSHOT_BUILT_EVENT,
      eventVersion: CONTEXT_SNAPSHOT_BUILT_EVENT_VERSION,
      producerModule: 'task-execution',
      aggregateType: envelope.targetType,
      aggregateId: envelope.targetId,
      aggregateVersion: 1,
      scopeRef: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      correlationId: envelope.correlationId,
      causationId: eventCausationId,
      commandId: envelope.commandId,
      actorRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.identity.principal',
        objectId: envelope.principalId,
        scope: { enterpriseId: scope.enterpriseId },
      },
      occurredAt: asOf,
      dataClassification: 'INTERNAL',
      payload: eventPayload,
      integrity: {
        canonicalizationVersion: CANONICALIZATION_VERSION,
        payloadHash: {
          algorithm: PAYLOAD_HASH_ALGORITHM,
          digest: digestCanonicalPayload(eventPayload).hash.toString('hex'),
          canonicalizationVersion: CANONICALIZATION_VERSION,
        },
      },
    } as unknown as CanonicalJsonObject;
    const eventValidation = new ContractRegistry().validateOperation(
      CONTEXT_SNAPSHOT_BUILT_EVENT,
      CONTEXT_SNAPSHOT_BUILT_EVENT_VERSION,
      eventEnvelope,
    );
    if (!eventValidation.valid) {
      return reject(
        REFERENCE_INVALID,
        'the built Context Snapshot event does not close against its registered contract',
      );
    }

    // The Snapshot row is the database-adjudicated single winner for this
    // CREATE identity: a concurrent build of the same target under another
    // idempotency key inserts nothing and is recorded as the stable business
    // rejection (§19.8 item 3).
    const inserted = await execution.insertContextSnapshot({
      snapshotId,
      objectId: envelope.targetId,
      purpose: request.purpose,
      audience:
        typeof projection.audience === 'string' ? projection.audience : audience.principalId,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      builderVersion: BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
      policySnapshotId: policyRef.versionId,
      sourceManifestCount: manifestSingletons + manifestArrays,
      contextItemCount: (assembled.payload.contextItems as unknown[]).length,
      omissionCount: (assembled.payload.omissions as unknown[]).length,
      redactionCount: (assembled.payload.redactions as unknown[]).length,
      coverageState: typeof coverage.completeness === 'string' ? coverage.completeness : 'PARTIAL',
      payloadHash: digest.hash,
      expiresAt: payloadExpiresAtText,
      effectiveExpiresAt: payloadExpiresAtText,
      requestPayloadHash,
      sourceCommandId: envelope.commandId,
      createdByPrincipalId: envelope.principalId,
      canonicalPayload: assembled.payload,
    });
    if (!inserted) {
      return reject(
        CONCURRENCY_CONFLICT,
        'the Context Snapshot identity already exists in this Project scope',
      );
    }

    const metadataDigest = digestCanonicalPayload(assembled.metadata);
    await execution.insertContextSnapshotBuild({
      snapshotId,
      buildKind: 'INITIAL',
      draftSnapshotRef: request.draftSnapshotRef as CanonicalJsonObject,
      sliceRefs: metadataRecord.sliceRefs as readonly CanonicalJsonObject[],
      purpose: request.purpose,
      audience: metadataRecord.audience as CanonicalJsonObject,
      builderPolicyRef: request.builderPolicyRef as CanonicalJsonObject,
      policyContentHash: Buffer.from(policyContentHash, 'hex'),
      policyEffectiveFrom: policyEffectiveFrom,
      policySupersededAt: resolution.supersededAt ?? undefined,
      requestExpiresAt:
        typeof metadataRecord.requestExpiresAt === 'string'
          ? metadataRecord.requestExpiresAt
          : undefined,
      effectiveExpiresAt:
        typeof metadataRecord.effectiveExpiresAt === 'string'
          ? metadataRecord.effectiveExpiresAt
          : undefined,
      canonicalPayload: assembled.metadata,
      payloadHash: metadataDigest.hash,
      requestPayloadHash,
      sourceCommandId: envelope.commandId,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      createdByPrincipalId: envelope.principalId,
    });

    // §19.2 item 2: only the references this transaction proved become Edges -
    // the consumed DRAFT, the Builder Policy version and every consumed Slice.
    const edgeBase = {
      ownerObjectType: envelope.targetType,
      ownerObjectId: envelope.targetId,
      ownerVersionId: snapshotId,
      ownerPayloadHash: digest.hash,
    };
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/draftSnapshotRef',
      targetModule: 'TaskExecution',
      targetObjectType: WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
      targetObjectId: draftSnapshot.snapshotId,
      targetPayloadHash: draftSnapshot.payloadHash,
      referencePurpose: 'CONTEXT_SNAPSHOT_DRAFT',
    });
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/projection/builderPolicyRef',
      targetModule: 'IdentityPolicy',
      targetObjectType: POLICY_OBJECT_TYPE,
      targetObjectId: policyRef.objectId,
      targetVersionId: policyRef.versionId,
      referencePurpose: 'CONTEXT_SNAPSHOT_POLICY',
    });
    const sortedSliceRefs = metadataRecord.sliceRefs as readonly CanonicalJsonObject[];
    for (const [index, sortedRef] of sortedSliceRefs.entries()) {
      const refRecord = record(sortedRef);
      const refHash = readContentHash(refRecord.contentHash);
      const refObjectId = refRecord.objectId;
      if (refHash === undefined || typeof refObjectId !== 'string') {
        return reject(REFERENCE_INVALID, 'the assembled slice refs do not close');
      }
      await execution.appendReferenceEdge({
        ...edgeBase,
        referencePath: `/sourceSlices/${index}`,
        targetModule: 'EnterpriseProject',
        targetObjectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        targetObjectId: refObjectId,
        targetPayloadHash: Buffer.from(refHash.digest, 'hex'),
        referencePurpose: 'CONTEXT_SNAPSHOT_SOURCE_SLICE',
      });
    }

    // §20.3: exactly one `execution.ContextSnapshotBuilt@1.1` Outbox row of
    // the envelope validated above - the same event id, the closed four-member
    // payload and the envelope-derived causation; the runner mirrors the
    // trusted envelope Scope into the stored payload.
    await execution.appendOutbox({
      eventId,
      eventType: CONTEXT_SNAPSHOT_BUILT_EVENT,
      eventVersion: CONTEXT_SNAPSHOT_BUILT_EVENT_VERSION,
      aggregateType: envelope.targetType,
      aggregateId: envelope.targetId,
      aggregateVersion: '1',
      payload: eventPayload,
      scopeMirror: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      causationId: eventCausationId,
      occurredAt: commitAt,
    });

    return { kind: 'COMMITTED', resultPayload: result };
  });
}
