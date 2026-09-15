// IM-06 (#204): EnterpriseProject-owned Project/DeliveryItem proof for the
// `execution.create_task` DRAFT creation boundary.
//
// Design authority: Module-Spec-002 §13.1 and Module-Spec-003 §16.2. This is
// an internal read-only Port, not a registered operation: it adds nothing to
// the Catalog, it changes neither the `project.validate_object_scope@1.0`
// acceptance set (13 bare local names, no `@2.0`) nor its error surface, and a
// caller can neither supply the expected object types nor override the trusted
// Project Scope. The closed (version, canonical objectType) mapping and the
// trusted context are bound here, inside EnterpriseProject.
//
// The proof runs in EnterpriseProject's own RLS transaction and reuses the
// same SELECT and RLS helper semantics as `project.validate_object_scope`,
// with its own key table instead of the public Query's key set. The consumer
// only learns VALID/INVALID; the internal reason class of a rejection is
// recorded in EnterpriseProject's own audit trail and never returned, so the
// public exterior cannot tell "missing" from "invisible" or leak whether
// another Scope holds such an object.

import type { Kysely } from 'kysely';
import { isUuidV7, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';

/**
 * Internal audit codes of the reason classes (§16.2). They are written to the
 * permission-controlled EnterpriseProject audit trail only.
 */
export const TASK_CREATION_SCOPE_KIND_MISMATCH = 'TASK_CREATION_SCOPE_KIND_MISMATCH';
export const TASK_CREATION_SCOPE_IDENTITY_MISMATCH = 'TASK_CREATION_SCOPE_IDENTITY_MISMATCH';
export const TASK_CREATION_SCOPE_SCOPE_MISMATCH = 'TASK_CREATION_SCOPE_SCOPE_MISMATCH';
export const TASK_CREATION_SCOPE_NOT_VISIBLE = 'TASK_CREATION_SCOPE_NOT_VISIBLE';
export const TASK_CREATION_SCOPE_LIFECYCLE_INVALID = 'TASK_CREATION_SCOPE_LIFECYCLE_INVALID';

interface CreationBinding {
  readonly projectObjectType: string;
  readonly deliveryItemObjectType: string;
}

/**
 * The Port's own version-keyed table. It is deliberately separate from the
 * public Query's key set and only serves the creation boundary: the legacy
 * bare local names and `DeliveryItem` stay invalid inputs there.
 */
const CREATION_BINDINGS: Readonly<Record<string, CreationBinding>> = {
  'execution.create_task@1.0': {
    projectObjectType: 'project.project',
    deliveryItemObjectType: 'project.delivery_item',
  },
  'execution.create_task@2.0': {
    projectObjectType: 'zhiju.project.project',
    deliveryItemObjectType: 'zhiju.project.delivery_item',
  },
};

export interface TaskExecutionCreationProjectScopeRequest {
  readonly commandType: string;
  readonly commandVersion: string;
  /** The Project ref exactly as the consumer accepted it from the payload. */
  readonly projectRef: CanonicalJsonObject;
  /** The optional DeliveryItem ref exactly as the consumer accepted it. */
  readonly deliveryItemRef?: CanonicalJsonObject | undefined;
}

/**
 * Closed result of the proof. Identity/kind/scope/existence/lifecycle stay
 * internal; an unavailable dependency throws instead of answering INVALID.
 */
export type TaskExecutionCreationProjectScopeOutcome = 'VALID' | 'INVALID';

export interface TaskExecutionCreationProjectScopePort {
  proveCreationScope(
    request: TaskExecutionCreationProjectScopeRequest,
  ): Promise<TaskExecutionCreationProjectScopeOutcome>;
}

export interface TaskExecutionCreationProjectScopeConfig {
  /** Owning EnterpriseProject database handle over an application-owned pool. */
  readonly db: Kysely<EnterpriseProjectDb>;
  /** Trusted context derived by the composition layer from the Decision row. */
  readonly context: EnterpriseProjectTransactionContext;
  /** Command identity recorded in the internal audit trail. */
  readonly commandId: string;
}

interface TrustedProjectScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

interface Rejection {
  readonly code: string;
  readonly summary: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && isUuidV7(value) ? value : undefined;
}

/**
 * The trusted Project Scope of this call: the context must carry exactly one
 * allowed Project (the Decision's own). The caller-declared refs are never a
 * source of expected identity.
 */
function trustedProjectScope(
  context: EnterpriseProjectTransactionContext,
): TrustedProjectScope | undefined {
  const enterpriseId = uuidOrUndefined(context.enterpriseId);
  const projectIds = context.allowedProjectIds.filter((id) => uuidOrUndefined(id) !== undefined);
  const projectId = projectIds.length === 1 ? uuidOrUndefined(projectIds[0]) : undefined;
  if (enterpriseId === undefined || projectId === undefined) return undefined;
  return { enterpriseId, projectId };
}

interface ProjectRefFacts {
  readonly projectId: string;
}

interface DeliveryItemRefFacts {
  readonly objectId: string;
  readonly versionId: string;
}

/** A parsed ref, or the reason class its shape/identity was refused for. */
type RefParse<T> =
  | { readonly valid: true; readonly facts: T }
  | { readonly valid: false; readonly rejection: Rejection };

function readProjectRef(
  projectRef: unknown,
  binding: CreationBinding,
  trusted: TrustedProjectScope,
): RefParse<ProjectRefFacts> {
  const ref = record(projectRef);
  const scope = record(ref.scope);
  if (ref.kind !== 'OBJECT' || ref.objectType !== binding.projectObjectType) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_KIND_MISMATCH,
        summary: 'projectRef is not the version-bound Project object type',
      },
    };
  }
  if (scope.enterpriseId !== trusted.enterpriseId || scope.projectId !== trusted.projectId) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_SCOPE_MISMATCH,
        summary: 'projectRef does not carry the trusted Enterprise/Project scope',
      },
    };
  }
  // §16.2: `objectId == scope.projectId == trusted projectId`. A Project that
  // merely exists for the trusted project must never stand in for the exact
  // identity the payload declared.
  if (uuidOrUndefined(ref.objectId) !== trusted.projectId) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_IDENTITY_MISMATCH,
        summary: 'projectRef identity does not equal its own scope and the trusted project',
      },
    };
  }
  return { valid: true, facts: { projectId: trusted.projectId } };
}

function readDeliveryItemRef(
  deliveryItemRef: unknown,
  binding: CreationBinding,
  trusted: TrustedProjectScope,
): RefParse<DeliveryItemRefFacts> {
  const ref = record(deliveryItemRef);
  const scope = record(ref.scope);
  if (ref.kind !== 'VERSIONED' || ref.objectType !== binding.deliveryItemObjectType) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_KIND_MISMATCH,
        summary: 'deliveryItemRef is not the version-bound DeliveryItem object type',
      },
    };
  }
  if (scope.enterpriseId !== trusted.enterpriseId || scope.projectId !== trusted.projectId) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_SCOPE_MISMATCH,
        summary: 'deliveryItemRef does not carry the trusted Enterprise/Project scope',
      },
    };
  }
  const objectId = uuidOrUndefined(ref.objectId);
  const versionId = uuidOrUndefined(ref.versionId);
  if (objectId === undefined || versionId === undefined) {
    return {
      valid: false,
      rejection: {
        code: TASK_CREATION_SCOPE_IDENTITY_MISMATCH,
        summary: 'deliveryItemRef must carry an exact object and version identity',
      },
    };
  }
  return { valid: true, facts: { objectId, versionId } };
}

/**
 * The authoritative proof. Every existence/lifecycle answer comes from a
 * committed row read under EnterpriseProject RLS: an invisible row is
 * indistinguishable from a missing one and produces the same INVALID result.
 */
async function proveCreationFacts(
  trx: EnterpriseProjectTransaction,
  config: TaskExecutionCreationProjectScopeConfig,
  request: TaskExecutionCreationProjectScopeRequest,
): Promise<Rejection | undefined> {
  const key = `${request.commandType}@${request.commandVersion}`;
  const binding = Object.prototype.hasOwnProperty.call(CREATION_BINDINGS, key)
    ? CREATION_BINDINGS[key]
    : undefined;
  if (binding === undefined) {
    return {
      code: TASK_CREATION_SCOPE_KIND_MISMATCH,
      summary: 'the creation operation/version has no approved Project binding',
    };
  }
  const trusted = trustedProjectScope(config.context);
  if (trusted === undefined) {
    return {
      code: TASK_CREATION_SCOPE_SCOPE_MISMATCH,
      summary: 'the trusted context does not carry exactly one Project scope',
    };
  }
  const project = readProjectRef(request.projectRef, binding, trusted);
  if (!project.valid) return project.rejection;
  let deliveryItemFacts: DeliveryItemRefFacts | undefined;
  if (request.deliveryItemRef !== undefined) {
    const deliveryItem = readDeliveryItemRef(request.deliveryItemRef, binding, trusted);
    if (!deliveryItem.valid) return deliveryItem.rejection;
    deliveryItemFacts = deliveryItem.facts;
  }

  const projectRow = await trx
    .selectFrom('enterprise_project.project')
    .select(['status'])
    .where('enterprise_id', '=', trusted.enterpriseId)
    .where('project_id', '=', project.facts.projectId)
    .executeTakeFirst();
  if (projectRow === undefined) {
    return {
      code: TASK_CREATION_SCOPE_NOT_VISIBLE,
      summary: 'no committed Project row is visible in the trusted scope',
    };
  }
  if (projectRow.status !== 'ACTIVE') {
    return {
      code: TASK_CREATION_SCOPE_LIFECYCLE_INVALID,
      summary: 'the Project is not ACTIVE',
    };
  }

  if (deliveryItemFacts !== undefined) {
    const itemRow = await trx
      .selectFrom('enterprise_project.delivery_item')
      .select(['commitment_status'])
      .where('delivery_item_id', '=', deliveryItemFacts.objectId)
      .where('version_id', '=', deliveryItemFacts.versionId)
      .where('enterprise_id', '=', trusted.enterpriseId)
      .where('project_id', '=', trusted.projectId)
      .executeTakeFirst();
    if (itemRow === undefined) {
      return {
        code: TASK_CREATION_SCOPE_NOT_VISIBLE,
        summary: 'no committed DeliveryItem version is visible in the trusted scope',
      };
    }
    if (itemRow.commitment_status === 'CANCELLED' || itemRow.commitment_status === 'REPLACED') {
      return {
        code: TASK_CREATION_SCOPE_LIFECYCLE_INVALID,
        summary: 'the DeliveryItem version is cancelled or replaced',
      };
    }
  }
  return undefined;
}

async function insertRejectionAudit(
  trx: EnterpriseProjectTransaction,
  config: TaskExecutionCreationProjectScopeConfig,
  request: TaskExecutionCreationProjectScopeRequest,
  rejection: Rejection,
): Promise<void> {
  const context = config.context;
  const auditProjectId =
    context.allowedProjectIds.length === 1
      ? uuidOrUndefined(context.allowedProjectIds[0])
      : undefined;
  await trx
    .insertInto('enterprise_project.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: context.enterpriseId,
      project_id: auditProjectId ?? null,
      principal_id: context.principalId,
      actor_snapshot_id: context.actorSnapshotId,
      authorization_decision_id: context.authorizationDecisionId,
      command_id: config.commandId,
      command_type: request.commandType,
      outcome: 'DENIED',
      error_code: rejection.code,
      correlation_id: context.correlationId,
      safe_summary: rejection.summary,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

export function createTaskExecutionCreationProjectScopePort(
  config: TaskExecutionCreationProjectScopeConfig,
): TaskExecutionCreationProjectScopePort {
  return {
    async proveCreationScope(request) {
      return withEnterpriseProjectTransaction(config.db, config.context, async (trx) => {
        const rejection = await proveCreationFacts(trx, config, request);
        if (rejection === undefined) return 'VALID';
        await insertRejectionAudit(trx, config, request, rejection);
        return 'INVALID';
      });
    },
  };
}
