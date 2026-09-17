// IM-06 (#212): `execution.create_work_order@1.0` / `@1.1` DRAFT creation.
//
// Design authority: Module-Spec-003 §18 (approved #210 design) and
// Module-Spec-001 §15.7. One owning TaskExecution transaction commits the
// WorkOrder Aggregate Root, its immutable WorkOrderDraftSnapshot, the Receipt,
// the safe Audit and the Reference Edge of the reference this transaction
// proved; it writes no Outbox row, because no WorkOrder draft creation Event is
// registered.
//
// The handler owns the four things the registered Schemas cannot express: the
// per-version creation binding and the registered-envelope closure of §18.2, the
// R-210-2 Task binding whose spelling comes only from the bound Task's own
// creation fact (§18.3), the closed allowed Task status set checked under the
// read-only dependency lock (§18.4), and the §18.6 scope-containment rules of
// the declared references. `draft.requestedBy` is the authenticated principal
// and nothing else (§18.5); the Human-only classification of the declared
// capability codes is consumed from the IdentityPolicy-owned internal Port and
// attributed in this command's Audit. Authorization is not this module's
// business: the composition entry revalidates the creation Decision before the
// idempotency claim, so a replayed command never reaches this body.
//
// The database closes the same facts again (§18.7): the V3003 creation-identity
// guard binds the stored draft to the in-flight Receipt, to the Root and to the
// bound Task's creation definition, and the two INSERT policies anchor the
// owner columns to the trusted transaction context.

import { isUuidV7, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  CommandExecutionError,
  COMMAND_TARGET_MISMATCH,
  executeTaskExecutionCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import { WorkOrderDraftRepository } from '../persistence/work-order-draft-repository.js';
import { exactProjectScope, taskSpellingForSchemaVersion } from './task-readiness-plan.js';
import { inputReferenceWithinEnvelope, type EnvelopeScope } from './task-draft-creation.js';

/** The registered command this handler owns. */
export const CREATE_WORK_ORDER_COMMAND = 'execution.create_work_order';

/**
 * The closed read-path code of §18.2. It is declared here with the other stable
 * codes of this slice and is only ever produced by the draft read: the create
 * path's own target spelling is closed one layer earlier (registered Envelope,
 * then the IdentityPolicy creation binding, then the V3003 guard), so it never
 * reaches this handler as a refusal.
 */
export const EXECUTION_WORK_ORDER_REF_INVALID = 'EXECUTION_WORK_ORDER_REF_INVALID';
export const EXECUTION_WORK_ORDER_ALREADY_EXISTS = 'EXECUTION_WORK_ORDER_ALREADY_EXISTS';
export const EXECUTION_WORK_ORDER_SCOPE_INVALID = 'EXECUTION_WORK_ORDER_SCOPE_INVALID';
export const EXECUTION_TASK_REF_INVALID = 'EXECUTION_TASK_REF_INVALID';
export const EXECUTION_DEFINITION_REF_INVALID = 'EXECUTION_DEFINITION_REF_INVALID';
export const EXECUTION_TASK_NOT_EXECUTABLE = 'EXECUTION_TASK_NOT_EXECUTABLE';
/** Shared code: a declared `capabilityType` is Human-only for this principal. */
export const HUMAN_ONLY_CAPABILITY = 'HUMAN_ONLY_CAPABILITY';
export const API_VALUE_INVALID = 'API_VALUE_INVALID';
export const AUTHORIZATION_DECISION_INVALID = 'AUTHORIZATION_DECISION_INVALID';
export const NOT_FOUND = 'NOT_FOUND';
/** Shared dependency code: an owning internal boundary could not answer. */
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

/**
 * The per-version creation identities of §18.2. Each published major has exactly
 * one accepted WorkOrder spelling and one draft payload shape, both fixed by the
 * Receipt `command_version` that created the row: nothing here is normalized,
 * aliased or case-folded, and neither version accepts the other's spelling.
 */
export interface WorkOrderDraftCreationBinding {
  readonly commandVersion: string;
  /** This version's one accepted public WorkOrder spelling. */
  readonly workOrderObjectType: string;
  /** The `draft_schema_version` the Root and the snapshot must carry. */
  readonly draftSchemaVersion: string;
}

export const WORK_ORDER_DRAFT_CREATION_BINDINGS: readonly WorkOrderDraftCreationBinding[] =
  Object.freeze([
    Object.freeze({
      commandVersion: '1.0',
      workOrderObjectType: 'execution.work_order',
      draftSchemaVersion: '1.0',
    }),
    Object.freeze({
      commandVersion: '1.1',
      workOrderObjectType: 'zhiju.execution.work_order',
      draftSchemaVersion: '1.1',
    }),
  ]);

/**
 * Server-composed idempotency scope of one creation version in one Project
 * Scope. It is never taken from a caller, and it carries the exact
 * `commandType@commandVersion`, so the two majors never share a claim.
 */
export function createWorkOrderIdempotencyScope(
  commandType: string,
  commandVersion: string,
  enterpriseId: string,
  projectId: string,
): string {
  return `${commandType}@${commandVersion}:${enterpriseId}:${projectId}`;
}

/** The `PrincipalRef` the trusted session is reduced to (§18.5 item 2). */
export interface WorkOrderDraftPrincipalRef {
  readonly principalId: string;
  readonly principalKind: TaskExecutionTransactionContext['principalKind'];
}

/**
 * The classification request of the IdentityPolicy-owned internal boundary
 * (Spec 001 §15.7). The declared list is the de-duplicated, canonically ordered
 * set of declared `capabilityType` codes, and `actionAt` is the trusted current
 * instant of this classification: none of these fields is a caller-declared
 * fact.
 */
export interface WorkOrderCapabilityClassificationRequest {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly principalRef: WorkOrderDraftPrincipalRef;
  readonly declaredCapabilityTypes: readonly string[];
  readonly scopeRef: {
    readonly enterpriseId: string;
    readonly projectId: string;
  };
  readonly actionAt: string;
}

/**
 * Closed classification result. The internal classification of a refusal and the
 * contents of the owning Human-only set stay inside IdentityPolicy's own Audit;
 * the consumer records this returned pair verbatim and converges `INVALID` onto
 * the shared `HUMAN_ONLY_CAPABILITY`, and an unavailable Port throws instead of
 * answering.
 */
export interface WorkOrderCapabilityClassificationResult {
  readonly outcome: 'VALID' | 'INVALID';
  readonly classificationRegistryVersion: string;
}

/**
 * The IdentityPolicy-owned read-only classification Port (§18.5 item 4, Spec 001
 * §15.7). It is not a registered operation, it never enters the Catalog, and a
 * caller cannot supply the classification set or read the owning constant across
 * the boundary.
 */
export interface WorkOrderCapabilityBoundaryPort {
  classifyDeclaredCapabilities(
    request: WorkOrderCapabilityClassificationRequest,
  ): Promise<WorkOrderCapabilityClassificationResult>;
}

export interface WorkOrderDraftCreationPorts {
  readonly capabilityBoundary: WorkOrderCapabilityBoundaryPort;
  /** Trusted server clock; the module's existing trusted-time semantics. */
  readonly now?: (() => Date) | undefined;
}

/**
 * §18.4 closed allowed set of the bound Task's status. `DRAFT`/`BACKLOG` are not
 * yet executable under the readiness rules, `COMPLETED`/`CANCELLED` are
 * terminal, so neither can carry a fresh DRAFT WorkOrder.
 */
const EXECUTABLE_TASK_STATUSES: Readonly<Record<string, true>> = Object.freeze({
  READY: true,
  IN_PROGRESS: true,
  WAITING_INPUT: true,
  BLOCKED: true,
  IN_REVIEW: true,
  CHANGES_REQUIRED: true,
  COMPLETION_PENDING: true,
});

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

/**
 * §18.6 shape half: a declared reference must be a reference (an exact kind, or
 * an `ExternalRef` that carries its `system`) before its Scope is judged. The
 * remaining Scope forms are the §16.3 rules this module already applies to the
 * Task DRAFT, reused rather than restated.
 */
function declaredRefWithinEnvelope(value: unknown, envelope: EnvelopeScope): boolean {
  const ref = record(value);
  if (typeof ref.kind !== 'string' && typeof ref.system !== 'string') return false;
  return inputReferenceWithinEnvelope(ref, envelope);
}

/**
 * §18.6 Scope containment of every reference a WorkOrder DRAFT declares: the
 * `targetScope` target and base references, the `inputRefs` (including their
 * `ExternalRef` branch), the `versionPins` profile pins, the objective's
 * issue/delivery references and the output/criterion/risk/policy references.
 * `constraints` is open Canonical JSON: §18.6 gives it a shape and Hash rule, not
 * a reference rule, so a JSON value inside it that merely looks like a reference
 * is not treated as one.
 */
function draftReferencesWithinEnvelope(
  draft: Record<string, unknown>,
  envelope: EnvelopeScope,
): boolean {
  const targetScope = record(draft.targetScope);
  const versionPins = record(draft.versionPins);
  const objective = record(draft.objective);
  const riskAndQuality = record(draft.riskAndQuality);
  const executionPolicy = record(draft.executionPolicy);
  const harnessPolicy = record(draft.harnessPolicy);
  const modelPolicy = record(draft.modelPolicy);
  const budget = record(draft.budget);
  const singleRefs: readonly unknown[] = [
    targetScope.scopePolicyRef,
    versionPins.projectContextContractRef,
    versionPins.contextBuilderPolicyRef,
    versionPins.workOrderSchemaRef,
    versionPins.regulatoryProfileRef,
    versionPins.qualityProfileRef,
    versionPins.capabilityPolicyRef,
    versionPins.runtimeAdapterContractRef,
    riskAndQuality.riskProfileRef,
    riskAndQuality.qualityProfileRef,
    riskAndQuality.dataHandlingPolicyRef,
    riskAndQuality.escalationPolicyRef,
    executionPolicy.leasePolicyRef,
    executionPolicy.cancellationPolicyRef,
    budget.budgetPolicyRef,
    harnessPolicy.selectionPolicyRef,
    modelPolicy.selectionPolicyRef,
  ];
  for (const ref of singleRefs) {
    if (ref !== undefined && !declaredRefWithinEnvelope(ref, envelope)) return false;
  }
  const refLists: readonly unknown[] = [
    targetScope.targetObjectRefs,
    targetScope.baseContentRefs,
    versionPins.skillRefs,
    versionPins.templateRefs,
    objective.relatedIssueRefs,
    objective.deliveryItemRefs,
  ];
  for (const list of refLists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return false;
    for (const ref of list) {
      if (!declaredRefWithinEnvelope(ref, envelope)) return false;
    }
  }
  if (draft.inputRefs !== undefined) {
    if (!Array.isArray(draft.inputRefs)) return false;
    for (const input of draft.inputRefs) {
      if (!declaredRefWithinEnvelope(record(input).ref, envelope)) return false;
    }
  }
  for (const list of [draft.expectedOutputs, draft.completionCriteria]) {
    if (list !== undefined && !Array.isArray(list)) return false;
    for (const element of Array.isArray(list) ? list : []) {
      const value = record(element);
      const elementRefs = [value.acceptancePolicyRef, value.schemaRef, value.evaluatorRef];
      for (const ref of elementRefs) {
        if (ref !== undefined && !declaredRefWithinEnvelope(ref, envelope)) return false;
      }
    }
  }
  return true;
}

/**
 * §18.5 item 6: the well-formed key of a capability declaration is the exact
 * `capabilityType` string. A declaration that does not carry one cannot be
 * classified, so it is a payload defect rather than an unclassifiable code.
 */
function readCapabilityTypes(value: unknown): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const codes: string[] = [];
  for (const grant of value) {
    const capabilityType = record(grant).capabilityType;
    if (typeof capabilityType !== 'string') return undefined;
    codes.push(capabilityType);
  }
  return codes;
}

export async function handleCreateWorkOrder(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: WorkOrderDraftCreationPorts,
): Promise<CommandResult> {
  if (envelope.commandType !== CREATE_WORK_ORDER_COMMAND) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the create_work_order handler only serves the registered creation command',
    );
  }
  const binding = WORK_ORDER_DRAFT_CREATION_BINDINGS.find(
    (candidate) => candidate.commandVersion === envelope.commandVersion,
  );
  const projectId = envelope.projectId;
  if (
    binding === undefined ||
    projectId === undefined ||
    envelope.targetType !== binding.workOrderObjectType ||
    !isUuidV7(envelope.targetId)
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the creation target must be the pre-allocated WorkOrder of this Project',
    );
  }
  const envelopeScope: EnvelopeScope = { enterpriseId: envelope.enterpriseId, projectId };
  const trustedNow = ports.now ?? ((): Date => new Date());

  return executeTaskExecutionCommand(db, context, envelope, async (execution) => {
    const payload = envelope.requestPayload;

    // §18.7 creation-request projection: the Snapshot the database stores is
    // bound to this command through `{draft}` plus `{expiresAt}` if and only if
    // that member exists, so any other member would make the stored draft
    // unprovable against the Receipt. The registered Envelope is already closed
    // to that member set; a payload outside it is refused as a payload defect
    // instead of reaching the database guard.
    if (!Object.keys(payload).every((member) => member === 'draft' || member === 'expiresAt')) {
      return reject(
        API_VALUE_INVALID,
        'the create_work_order payload is closed to draft and the optional expiresAt',
      );
    }
    const draftMember = payload.draft;
    if (
      draftMember === undefined ||
      draftMember === null ||
      typeof draftMember !== 'object' ||
      Array.isArray(draftMember)
    ) {
      return reject(API_VALUE_INVALID, 'draft must be the declared WorkOrderDraft object');
    }
    const draft = record(draftMember);

    // §18.5 item 2: the requester is the authenticated principal of the trusted
    // session, never a caller-supplied identity, and `actingFor`/transfer
    // metadata is not an authorization source.
    const requestedBy = record(draft.requestedBy);
    if (
      requestedBy.principalId !== context.principalId ||
      requestedBy.principalKind !== context.principalKind
    ) {
      return reject(
        AUTHORIZATION_DECISION_INVALID,
        'draft.requestedBy must be the authenticated principal of this command',
      );
    }

    // §18.3 R-210-2: the accepted Task spelling is derived from the bound Task's
    // own immutable creation fact. Only its kind, identity and Envelope Scope can
    // be judged before that fact is read; the spelling is judged after it.
    const taskRef = record(draft.taskRef);
    const taskId = taskRef.objectId;
    // The shared helper reads the Scope object itself, so the reference that
    // wraps it is unwrapped exactly once.
    const taskRefScope = exactProjectScope(taskRef.scope);
    if (
      taskRef.kind !== 'OBJECT' ||
      typeof taskId !== 'string' ||
      !isUuidV7(taskId) ||
      taskRefScope?.enterpriseId !== envelopeScope.enterpriseId ||
      taskRefScope.projectId !== envelopeScope.projectId
    ) {
      return reject(
        EXECUTION_TASK_REF_INVALID,
        'draft.taskRef must be the OBJECT of a Task in the Envelope Project scope',
      );
    }

    // §18.4: the bound Task is read under the read-only dependency lock
    // (`FOR SHARE`), and every check below runs while that lock is held. RLS is
    // the final authority on the Scope, so an invisible Task is reported exactly
    // like a missing one.
    const repository = new WorkOrderDraftRepository();
    const boundTask = await repository.readBoundTaskForShare(execution.trx, taskId);
    if (boundTask === undefined) {
      return reject(NOT_FOUND, 'the bound Task does not exist in this Project scope');
    }
    if (
      boundTask.enterpriseId !== envelopeScope.enterpriseId ||
      boundTask.projectId !== envelopeScope.projectId
    ) {
      return reject(
        EXECUTION_TASK_REF_INVALID,
        'the bound Task does not belong to the Envelope Project scope',
      );
    }
    const creationDefinitionSchemaVersion = boundTask.creationDefinitionSchemaVersion;
    const taskObjectType =
      creationDefinitionSchemaVersion === undefined
        ? undefined
        : taskSpellingForSchemaVersion(creationDefinitionSchemaVersion);
    if (taskObjectType === undefined) {
      return reject(
        EXECUTION_DEFINITION_REF_INVALID,
        'the bound Task has no self-consistent creation definition fact',
      );
    }
    if (taskRef.objectType !== taskObjectType) {
      return reject(
        EXECUTION_TASK_REF_INVALID,
        'draft.taskRef must carry the spelling of the bound Task creation major',
      );
    }
    if (EXECUTABLE_TASK_STATUSES[boundTask.status] !== true) {
      return reject(
        EXECUTION_TASK_NOT_EXECUTABLE,
        'the bound Task is not in a status that allows a DRAFT WorkOrder',
      );
    }

    // §18.6: every declared reference must stay inside the Envelope Project
    // scope. A cross-tenant reference is the Scope violation, and an unproven
    // reference stays in the immutable snapshot until its owning proof commits.
    if (!draftReferencesWithinEnvelope(draft, envelopeScope)) {
      return reject(
        EXECUTION_WORK_ORDER_SCOPE_INVALID,
        'the declared WorkOrder references must stay inside the Envelope Project scope',
      );
    }

    // §18.5 item 6: the same exact `capabilityType` may not be declared on both
    // the allowed and the denied side - a self-contradicting plan is a payload
    // defect, not an authorization judgement.
    const allowedCapabilityTypes = readCapabilityTypes(draft.allowedCapabilities);
    const deniedCapabilityTypes = readCapabilityTypes(draft.deniedCapabilities);
    if (allowedCapabilityTypes === undefined || deniedCapabilityTypes === undefined) {
      return reject(
        API_VALUE_INVALID,
        'a capability declaration must carry an exact capabilityType string',
      );
    }
    const deniedCodes = new Set(deniedCapabilityTypes);
    if (allowedCapabilityTypes.some((code) => deniedCodes.has(code))) {
      return reject(
        API_VALUE_INVALID,
        'the same capabilityType must not be declared as both allowed and denied',
      );
    }

    // §18.5 item 4: the declared codes are classified by the owning boundary in
    // a de-duplicated, canonically ordered set, and the returned
    // `{outcome, classificationRegistryVersion}` is recorded verbatim in this
    // command's Audit. The classification version never enters the immutable
    // DRAFT payload.
    const declaredCapabilityTypes = [
      ...new Set([...allowedCapabilityTypes, ...deniedCapabilityTypes]),
    ].sort();
    let classification: WorkOrderCapabilityClassificationResult;
    try {
      classification = await ports.capabilityBoundary.classifyDeclaredCapabilities({
        commandType: envelope.commandType,
        commandVersion: envelope.commandVersion,
        principalRef: {
          principalId: context.principalId,
          principalKind: context.principalKind,
        },
        declaredCapabilityTypes,
        scopeRef: { enterpriseId: envelopeScope.enterpriseId, projectId: envelopeScope.projectId },
        actionAt: trustedNow().toISOString(),
      });
    } catch {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'the declared capability classification boundary is unavailable',
      );
    }
    await execution.appendAudit({
      outcome: 'INFO',
      targetType: envelope.targetType,
      targetId: envelope.targetId,
      safeSummary: JSON.stringify({
        outcome: classification.outcome,
        classificationRegistryVersion: classification.classificationRegistryVersion,
      }),
    });
    if (classification.outcome !== 'VALID') {
      return reject(
        HUMAN_ONLY_CAPABILITY,
        'a declared capabilityType is Human-only for this principal',
      );
    }

    // §18.6: `expiresAt` is optional; its presence and value enter the complete
    // payload Hash, and a value that cannot define an instant is a payload
    // defect rather than a deadline that has passed.
    const expiresAtMember = Object.prototype.hasOwnProperty.call(payload, 'expiresAt')
      ? payload.expiresAt
      : undefined;
    const expiresAtMs =
      typeof expiresAtMember === 'string' ? Date.parse(expiresAtMember) : Number.NaN;
    if (expiresAtMember !== undefined && !Number.isFinite(expiresAtMs)) {
      return reject(API_VALUE_INVALID, 'expiresAt must be an exact instant');
    }

    // §18.4: the deadline is re-validated with the trusted server clock at the
    // point of the writes, so a transaction that crossed `expiresAt` while it
    // held the dependency lock commits no fact at all.
    const commitAt = trustedNow();
    if (expiresAtMember !== undefined && !(commitAt.getTime() < expiresAtMs)) {
      return reject(
        API_VALUE_INVALID,
        'expiresAt must lie after the commit instant of this command',
      );
    }

    const scopeRef = {
      enterpriseId: envelopeScope.enterpriseId,
      projectId: envelopeScope.projectId,
    };
    const snapshotId = newUuidV7();
    const workOrderRef: CanonicalJsonObject = {
      kind: 'OBJECT',
      objectType: binding.workOrderObjectType,
      objectId: envelope.targetId,
      scope: scopeRef,
    };
    // §18.3 item 6: `draft.taskRef` and the Snapshot's top-level `taskRef` are
    // one fact with the Root mirrors; the database guard proves all four against
    // the checked Task row, so the derived reference is written identically.
    const boundTaskRef: CanonicalJsonObject = {
      kind: 'OBJECT',
      objectType: taskObjectType,
      objectId: taskId,
      scope: scopeRef,
    };
    const canonicalPayload: CanonicalJsonObject = {
      snapshotId,
      workOrderRef,
      taskRef: boundTaskRef,
      scopeRef,
      draft: draftMember,
      ...(expiresAtMember === undefined ? {} : { expiresAt: expiresAtMember }),
      capturedAt: commitAt.toISOString(),
      createdBy: {
        principalId: context.principalId,
        principalKind: context.principalKind,
      },
    };
    const digest = digestCanonicalPayload(canonicalPayload);
    // The snapshot's request hash is the hash of the command's own request
    // payload; the database re-derives the same projection from the stored draft
    // and requires it to equal the in-flight Receipt's hash.
    const requestDigest = digestCanonicalPayload(payload);
    // The expiry is written as the declared text, not as a `Date`: only the
    // exact bytes the command declared satisfy the V3003 mirror comparison at
    // the microsecond precision PostgreSQL keeps.
    const expiresAt = expiresAtMember as string | undefined;

    // The Root is the database-adjudicated single winner: a concurrent creation
    // of the same target inserts nothing and is recorded as the stable business
    // rejection instead of leaving a partial fact. The insert is runner-bound, so
    // the row identity and Scope are the command target.
    const inserted = await execution.insertWorkOrderDraftRoot({
      workOrderId: envelope.targetId,
      workOrderObjectType: binding.workOrderObjectType,
      taskId,
      taskObjectType,
      draftSchemaVersion: binding.draftSchemaVersion,
      enterpriseId: envelopeScope.enterpriseId,
      projectId: envelopeScope.projectId,
      currentDraftSnapshotId: snapshotId,
      currentDraftSnapshotHash: digest.hash,
      expiresAt,
      createdByPrincipalId: envelope.principalId,
      requestedByPrincipalId: context.principalId,
    });
    if (!inserted) {
      return reject(
        EXECUTION_WORK_ORDER_ALREADY_EXISTS,
        'the creation target already exists in this Project scope',
      );
    }
    await execution.insertWorkOrderDraftSnapshot({
      snapshotId,
      workOrderId: envelope.targetId,
      draftSchemaVersion: binding.draftSchemaVersion,
      workOrderObjectType: binding.workOrderObjectType,
      taskObjectType,
      enterpriseId: envelopeScope.enterpriseId,
      projectId: envelopeScope.projectId,
      expiresAt,
      canonicalPayload,
      payloadHash: digest.hash,
      requestPayloadHash: requestDigest.hash,
      createdByPrincipalId: envelope.principalId,
      sourceCommandId: envelope.commandId,
    });

    // §18.7: only the reference this transaction proved exists becomes an Edge -
    // the bound Task, under the spelling its own creation major fixed. The
    // `inputRefs`, `versionPins` and policy references stay in the immutable
    // snapshot until their owning proof commits one.
    await execution.appendReferenceEdge({
      ownerObjectType: envelope.targetType,
      ownerObjectId: envelope.targetId,
      ownerVersionId: snapshotId,
      ownerPayloadHash: digest.hash,
      referencePath: '/draft/taskRef',
      targetModule: 'TaskExecution',
      targetObjectType: taskObjectType,
      targetObjectId: taskId,
      referencePurpose: 'WORK_ORDER_DRAFT_TASK',
    });

    return {
      kind: 'COMMITTED',
      resultPayload: {
        workOrderRef,
        status: 'DRAFT',
        aggregateVersion: '1',
      },
    };
  });
}
