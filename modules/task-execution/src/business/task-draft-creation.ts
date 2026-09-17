// IM-06 (#204): `execution.create_task@1.0` / `@2.0` DRAFT creation.
//
// Design authority: Module-Spec-003 §16 (approved #202 design) and
// Module-Spec-002 §13.1. One owning TaskExecution transaction commits the Task
// Aggregate Root, its immutable TaskDefinitionSnapshot, the Receipt, the safe
// Audit and the Reference Edges of the references this transaction proved; it
// writes no Outbox row, because no Task creation Event is registered.
//
// The handler narrows the module-level acceptance set that the registered
// Schemas cannot express (the per-version reference identities of §16.1 and the
// DRAFT-time scope rules of §16.3), proves the optional parent Task in this
// module's own Scope, and consumes the EnterpriseProject-owned
// `TaskExecutionCreationProjectScopePort` for the Project/DeliveryItem facts
// only EnterpriseProject can prove. Authorization is not this module's
// business: the composition entry revalidates the creation Decision before the
// idempotency claim, so a replayed command never reaches this body.

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
import { TaskDraftRepository } from '../persistence/task-draft-repository.js';

/** The registered command this handler owns. */
export const CREATE_TASK_COMMAND = 'execution.create_task';

export const EXECUTION_PROJECT_REF_INVALID = 'EXECUTION_PROJECT_REF_INVALID';
export const EXECUTION_DELIVERY_ITEM_REF_INVALID = 'EXECUTION_DELIVERY_ITEM_REF_INVALID';
export const EXECUTION_PARENT_TASK_REF_INVALID = 'EXECUTION_PARENT_TASK_REF_INVALID';
export const EXECUTION_DEFINITION_REF_INVALID = 'EXECUTION_DEFINITION_REF_INVALID';
export const EXECUTION_TASK_ALREADY_EXISTS = 'EXECUTION_TASK_ALREADY_EXISTS';
/** Shared dependency code: the Project-scope Port could not answer. */
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

/**
 * The per-version reference identities of §16.1. Both published majors have
 * exactly one accepted spelling each; nothing here is normalized, aliased or
 * case-folded, and neither version accepts the other's spelling.
 */
export interface TaskDraftCreationBinding {
  readonly commandVersion: string;
  readonly taskObjectType: string;
  readonly projectObjectType: string;
  readonly deliveryItemObjectType: string;
  /** @2.0 publishes closed `expectedOutputSpec`/`completionCriteria` shapes. */
  readonly closedDefinitionShape: boolean;
}

export const TASK_DRAFT_CREATION_BINDINGS: readonly TaskDraftCreationBinding[] = Object.freeze([
  Object.freeze({
    commandVersion: '1.0',
    taskObjectType: 'execution.task',
    projectObjectType: 'project.project',
    deliveryItemObjectType: 'project.delivery_item',
    closedDefinitionShape: false,
  }),
  Object.freeze({
    commandVersion: '2.0',
    taskObjectType: 'zhiju.execution.task',
    projectObjectType: 'zhiju.project.project',
    deliveryItemObjectType: 'zhiju.project.delivery_item',
    closedDefinitionShape: true,
  }),
]);

/**
 * Server-composed idempotency scope of one creation version in one Project
 * Scope. It is never taken from a caller, and it carries the exact
 * `commandType@commandVersion`, so the two majors never share a claim.
 */
export function createTaskIdempotencyScope(
  commandType: string,
  commandVersion: string,
  enterpriseId: string,
  projectId: string,
): string {
  return `${commandType}@${commandVersion}:${enterpriseId}:${projectId}`;
}

/** The refs EnterpriseProject must prove, exactly as the payload accepted them. */
export interface TaskExecutionCreationProjectScopeRequest {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly projectRef: CanonicalJsonObject;
  readonly deliveryItemRef?: CanonicalJsonObject | undefined;
}

/**
 * The closed result of the Project-scope proof. Identity/kind/scope/
 * existence/lifecycle reasons stay in the EnterpriseProject-owned Audit; the
 * consumer only learns whether the submitted refs are provable.
 */
export type TaskExecutionCreationProjectScopeOutcome = 'VALID' | 'INVALID';

/**
 * The internal read-only Port EnterpriseProject implements (§16.2). It is not
 * a registered operation, it never enters the Catalog, and a caller cannot
 * supply the expected object types or the trusted Project Scope: both are
 * bound by the owning implementation.
 */
export interface TaskExecutionCreationProjectScopePort {
  proveCreationScope(
    request: TaskExecutionCreationProjectScopeRequest,
  ): Promise<TaskExecutionCreationProjectScopeOutcome>;
}

export interface TaskDraftCreationPorts {
  readonly projectScope: TaskExecutionCreationProjectScopePort;
}

/**
 * The exact Project Scope form the creation handlers reason in. Exported so a
 * later handler of the same module reuses the §16.3/§18.6 helpers instead of
 * duplicating the accepted Scope forms.
 */
export interface EnvelopeScope {
  readonly enterpriseId: string;
  readonly projectId: string;
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

/** The exact Project scope form: `{enterpriseId, projectId}` and nothing else. */
function exactProjectScope(ref: unknown): EnvelopeScope | undefined {
  const value = record(ref);
  const scope = record(value.scope);
  const keys = Object.keys(scope);
  if (keys.length !== 2 || !keys.includes('enterpriseId') || !keys.includes('projectId')) {
    return undefined;
  }
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (typeof enterpriseId !== 'string' || typeof projectId !== 'string') {
    return undefined;
  }
  return { enterpriseId, projectId };
}

/**
 * §16.3 Scope containment of a reference that is not Project-anchored: the
 * Platform `{}` form is allowed, an Enterprise form must carry the Envelope
 * enterprise, and a Project form must carry both Envelope dimensions. A shape
 * the shared `ScopeRef` does not allow (for example a bare `projectId`) is not
 * contained.
 *
 * Exported because §18.6 gives the WorkOrder DRAFT the same Scope shapes: the
 * later handler reuses this rule instead of restating it.
 */
export function scopeWithinEnvelope(scope: unknown, envelope: EnvelopeScope): boolean {
  const value = record(scope);
  const keys = Object.keys(value);
  if (keys.length === 0) return true;
  if (value.enterpriseId !== envelope.enterpriseId) return false;
  if (keys.length === 1) return keys[0] === 'enterpriseId';
  return keys.length === 2 && keys.includes('projectId') && value.projectId === envelope.projectId;
}

/**
 * `inputRefs` keep their own Scope but must fall inside the Envelope Scope. An
 * `ExternalRef` carries no top-level `scope`: with a `tenantOrAccountRef` its
 * Scope must be contained, and without one it is accepted as a declared source
 * intent that is never a fact of existence, readiness or completion.
 */
export function inputReferenceWithinEnvelope(ref: unknown, envelope: EnvelopeScope): boolean {
  const value = record(ref);
  if (Object.prototype.hasOwnProperty.call(value, 'system')) {
    if (!Object.prototype.hasOwnProperty.call(value, 'tenantOrAccountRef')) return true;
    return scopeWithinEnvelope(record(value.tenantOrAccountRef).scope, envelope);
  }
  return scopeWithinEnvelope(value.scope, envelope);
}

/**
 * §16.1: exact kind, exact version spelling, exact Envelope Project scope.
 */
function matchesProjectAnchoredRef(
  ref: unknown,
  kind: 'OBJECT' | 'VERSIONED',
  objectType: string,
  envelope: EnvelopeScope,
  requireVersion = false,
): boolean {
  const value = record(ref);
  if (value.kind !== kind || value.objectType !== objectType) return false;
  if (typeof value.objectId !== 'string' || !isUuidV7(value.objectId)) return false;
  if (requireVersion && (typeof value.versionId !== 'string' || !isUuidV7(value.versionId))) {
    return false;
  }
  const scope = exactProjectScope(value);
  return scope?.enterpriseId === envelope.enterpriseId && scope.projectId === envelope.projectId;
}

/** §16.3: the v2 closed output/criterion references only need containment. */
function v2PolicyReferencesWithinEnvelope(
  definition: Record<string, unknown>,
  envelope: EnvelopeScope,
): boolean {
  const outputs = record(definition.expectedOutputSpec).outputs;
  if (Array.isArray(outputs)) {
    for (const output of outputs) {
      const acceptancePolicyRef = record(output).acceptancePolicyRef;
      if (
        acceptancePolicyRef !== undefined &&
        !scopeWithinEnvelope(record(acceptancePolicyRef).scope, envelope)
      ) {
        return false;
      }
    }
  }
  const criteria = record(definition.completionCriteria).criteria;
  if (Array.isArray(criteria)) {
    for (const criterion of criteria) {
      const evaluatorRef = record(criterion).evaluatorRef;
      if (
        evaluatorRef !== undefined &&
        !scopeWithinEnvelope(record(evaluatorRef).scope, envelope)
      ) {
        return false;
      }
    }
  }
  return true;
}

export async function handleCreateTask(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: TaskDraftCreationPorts,
): Promise<CommandResult> {
  if (envelope.commandType !== CREATE_TASK_COMMAND) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the create_task handler only serves the registered creation command',
    );
  }
  const binding = TASK_DRAFT_CREATION_BINDINGS.find(
    (candidate) => candidate.commandVersion === envelope.commandVersion,
  );
  const projectId = envelope.projectId;
  if (
    binding === undefined ||
    projectId === undefined ||
    envelope.targetType !== binding.taskObjectType ||
    !isUuidV7(envelope.targetId)
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the creation target must be the pre-allocated Task of this Project',
    );
  }
  const envelopeScope: EnvelopeScope = { enterpriseId: envelope.enterpriseId, projectId };
  const payload = envelope.requestPayload;
  const projectRef = payload.projectRef;
  const definition = record(payload.definition);

  return executeTaskExecutionCommand(db, context, envelope, async (execution) => {
    if (
      !matchesProjectAnchoredRef(projectRef, 'OBJECT', binding.projectObjectType, envelopeScope)
    ) {
      return reject(
        EXECUTION_PROJECT_REF_INVALID,
        'projectRef must be the OBJECT of the exact Project spelling and Scope',
      );
    }
    const deliveryItemRef = definition.deliveryItemRef;
    if (
      deliveryItemRef !== undefined &&
      !matchesProjectAnchoredRef(
        deliveryItemRef,
        'VERSIONED',
        binding.deliveryItemObjectType,
        envelopeScope,
        true,
      )
    ) {
      return reject(
        EXECUTION_DELIVERY_ITEM_REF_INVALID,
        'deliveryItemRef must be the exact VERSIONED DeliveryItem spelling and Scope',
      );
    }
    const dependencyTaskRefs = definition.dependencyTaskRefs;
    if (Array.isArray(dependencyTaskRefs)) {
      for (const dependency of dependencyTaskRefs) {
        if (
          !matchesProjectAnchoredRef(dependency, 'OBJECT', binding.taskObjectType, envelopeScope) ||
          record(dependency).objectId === envelope.targetId
        ) {
          return reject(
            EXECUTION_DEFINITION_REF_INVALID,
            'dependencyTaskRefs must be exact task references of this Scope that are not the target',
          );
        }
      }
    }
    const inputRefs = definition.inputRefs;
    if (Array.isArray(inputRefs)) {
      for (const input of inputRefs) {
        if (!inputReferenceWithinEnvelope(input, envelopeScope)) {
          return reject(
            EXECUTION_DEFINITION_REF_INVALID,
            'inputRefs must stay inside the Envelope Project scope',
          );
        }
      }
    }
    if (
      binding.closedDefinitionShape &&
      !v2PolicyReferencesWithinEnvelope(definition, envelopeScope)
    ) {
      return reject(
        EXECUTION_DEFINITION_REF_INVALID,
        'definition policy and evaluator references must stay inside the Envelope scope',
      );
    }

    // §16.6 step 4: after the idempotency claim and before the first business
    // write, EnterpriseProject proves the Project and the optional
    // DeliveryItem. An unavailable dependency is never a proof. The Port's
    // closed result cannot name which of the two published refs failed, so the
    // Project is proven first and the optional DeliveryItem second: each keeps
    // its own stable TaskExecution code without leaking an EP-side reason.
    let projectOutcome: TaskExecutionCreationProjectScopeOutcome;
    try {
      projectOutcome = await ports.projectScope.proveCreationScope({
        commandType: envelope.commandType,
        commandVersion: envelope.commandVersion,
        projectRef: projectRef as CanonicalJsonObject,
      });
    } catch {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'the EnterpriseProject scope proof is unavailable',
      );
    }
    if (projectOutcome !== 'VALID') {
      return reject(
        EXECUTION_PROJECT_REF_INVALID,
        'projectRef was not proven by the owning Project scope boundary',
      );
    }
    if (deliveryItemRef !== undefined) {
      let deliveryOutcome: TaskExecutionCreationProjectScopeOutcome;
      try {
        deliveryOutcome = await ports.projectScope.proveCreationScope({
          commandType: envelope.commandType,
          commandVersion: envelope.commandVersion,
          projectRef: projectRef as CanonicalJsonObject,
          deliveryItemRef: deliveryItemRef as CanonicalJsonObject,
        });
      } catch {
        throw new CommandExecutionError(
          DEPENDENCY_UNAVAILABLE,
          'the EnterpriseProject scope proof is unavailable',
        );
      }
      if (deliveryOutcome !== 'VALID') {
        return reject(
          EXECUTION_DELIVERY_ITEM_REF_INVALID,
          'deliveryItemRef was not proven by the owning Project scope boundary',
        );
      }
    }

    const parentTaskRef = definition.parentTaskRef;
    const repository = new TaskDraftRepository();
    if (parentTaskRef !== undefined) {
      if (
        !matchesProjectAnchoredRef(parentTaskRef, 'OBJECT', binding.taskObjectType, envelopeScope)
      ) {
        return reject(
          EXECUTION_PARENT_TASK_REF_INVALID,
          'parentTaskRef must be the exact Task OBJECT of this Scope',
        );
      }
      const parentTaskId = record(parentTaskRef).objectId as string;
      if (parentTaskId === envelope.targetId) {
        return reject(EXECUTION_PARENT_TASK_REF_INVALID, 'parentTaskRef must not be the target');
      }
      // §16.3: the parent must already exist in the same Scope, be
      // non-cancelled and not be the target. RLS is the final authority on the
      // Scope, so an invisible parent is rejected exactly like a missing one.
      const parent = await repository.readTaskScope(execution.trx, parentTaskId);
      if (
        parent?.enterpriseId !== envelopeScope.enterpriseId ||
        parent.projectId !== envelopeScope.projectId ||
        parent.status === 'CANCELLED'
      ) {
        return reject(
          EXECUTION_PARENT_TASK_REF_INVALID,
          'parentTaskRef must be an existing non-cancelled Task of this Scope',
        );
      }
    }

    const digest = digestCanonicalPayload(payload);
    const snapshotId = newUuidV7();
    const deliveryItemFacts =
      deliveryItemRef === undefined
        ? undefined
        : {
            objectId: record(deliveryItemRef).objectId as string,
            versionId: record(deliveryItemRef).versionId as string,
          };
    const deliveryItemMirror =
      deliveryItemFacts === undefined
        ? {}
        : {
            deliveryItemId: deliveryItemFacts.objectId,
            deliveryItemVersionId: deliveryItemFacts.versionId,
          };
    // The Root is the database-adjudicated single winner: a concurrent
    // creation of the same target inserts nothing and is recorded as the
    // stable business rejection instead of leaving a partial fact. The insert
    // is runner-bound, so the row identity and Scope are the command target.
    const inserted = await execution.insertTaskDraftRoot({
      taskId: envelope.targetId,
      targetObjectType: binding.taskObjectType,
      enterpriseId: envelopeScope.enterpriseId,
      projectId: envelopeScope.projectId,
      currentDefinitionSnapshotId: snapshotId,
      currentDefinitionHash: digest.hash,
      ...deliveryItemMirror,
      createdByPrincipalId: envelope.principalId,
    });
    if (!inserted) {
      return reject(
        EXECUTION_TASK_ALREADY_EXISTS,
        'the creation target already exists in this Project scope',
      );
    }
    await execution.insertTaskDraftDefinition({
      snapshotId,
      taskId: envelope.targetId,
      schemaVersion: envelope.commandVersion,
      enterpriseId: envelopeScope.enterpriseId,
      projectId: envelopeScope.projectId,
      ...deliveryItemMirror,
      canonicalPayload: payload,
      payloadHash: digest.hash,
      createdByPrincipalId: envelope.principalId,
      sourceCommandId: envelope.commandId,
    });

    // Only references this transaction proved exist become Edges: the
    // dependency, input and v2 policy/evaluator references stay in the
    // immutable Snapshot until their owning proof commits one.
    const edgeBase = {
      ownerObjectType: envelope.targetType,
      ownerObjectId: envelope.targetId,
      ownerVersionId: snapshotId,
      ownerPayloadHash: digest.hash,
    };
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/projectRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: binding.projectObjectType,
      targetObjectId: record(projectRef).objectId as string,
      referencePurpose: 'TASK_CREATION_PROJECT',
    });
    if (deliveryItemFacts !== undefined) {
      await execution.appendReferenceEdge({
        ...edgeBase,
        referencePath: '/definition/deliveryItemRef',
        targetModule: 'EnterpriseProject',
        targetObjectType: binding.deliveryItemObjectType,
        targetObjectId: deliveryItemFacts.objectId,
        targetVersionId: deliveryItemFacts.versionId,
        referencePurpose: 'TASK_CREATION_DELIVERY_ITEM',
      });
    }
    if (parentTaskRef !== undefined) {
      await execution.appendReferenceEdge({
        ...edgeBase,
        referencePath: '/definition/parentTaskRef',
        targetModule: 'TaskExecution',
        targetObjectType: binding.taskObjectType,
        targetObjectId: record(parentTaskRef).objectId as string,
        referencePurpose: 'TASK_CREATION_PARENT_TASK',
      });
    }

    return {
      kind: 'COMMITTED',
      resultPayload: {
        taskRef: {
          kind: 'OBJECT',
          objectType: binding.taskObjectType,
          objectId: envelope.targetId,
          scope: { enterpriseId: envelopeScope.enterpriseId, projectId: envelopeScope.projectId },
        },
        status: 'DRAFT',
        aggregateVersion: '1',
      },
    };
  });
}
