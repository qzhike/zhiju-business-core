// IM-06 (#208): `execution.build_task_readiness@1.0`, the Task Readiness
// producer.
//
// Design authority: Module-Spec-003 §17 (approved #206 design, PR #207). One
// owning TaskExecution transaction commits the immutable judgment fact, the
// Receipt, the Audit and the Reference Edges this transaction proved, and writes
// no Outbox row: no readiness Event is registered in the Catalog.
//
// The handler owns the three things the registered Schemas cannot express:
// R-206-1 (the Task spelling is fixed by the Task's own creation major, never by
// the caller), the closed reference set of the frozen definition payload, and the
// Policy/Evaluator binding. Authorization is not this module's business: the
// composition entry revalidates the producer Decision before the idempotency
// claim, so a replayed command never reaches this body.
//
// A judgment that concludes `ready=false` is still committed: §11.3 allows an
// explanatory failing judgment, and the consumer maps it to the matching stable
// error. Only the steps that §17.5 marks as rejections produce no fact at all.

import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
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
import {
  TASK_READINESS_JUDGMENT_KIND,
  TASK_READINESS_TARGET_TYPE,
  TaskReadinessRepository,
} from '../persistence/task-readiness-repository.js';
import { resolveTaskReadinessEvaluatorProfile } from './evaluator-profiles.js';
import { validateTaskReadinessPolicy } from './policy-profiles.js';
import {
  DEPENDENCY_UNAVAILABLE,
  exactProjectScope,
  observeReadiness,
  readTaskRefClosure,
  taskSpellingForSchemaVersion,
  type ReadinessCheckRow,
  type ReadinessScope,
  type TaskReadinessInputRefPort,
} from './task-readiness-plan.js';

/** The registered command this handler owns. */
export const BUILD_TASK_READINESS_COMMAND = 'execution.build_task_readiness';

export const EXECUTION_TASK_REF_INVALID = 'EXECUTION_TASK_REF_INVALID';
export const EXECUTION_DEFINITION_REF_INVALID = 'EXECUTION_DEFINITION_REF_INVALID';
export const EXECUTION_JUDGMENT_INVALID = 'EXECUTION_JUDGMENT_INVALID';
export const EXECUTION_JUDGMENT_STALE = 'EXECUTION_JUDGMENT_STALE';
export const EXECUTION_CRITERION_UNSUPPORTED = 'EXECUTION_CRITERION_UNSUPPORTED';
export const EXECUTION_TASK_DEPENDENCY_CYCLE = 'EXECUTION_TASK_DEPENDENCY_CYCLE';
export const EXECUTION_TASK_READINESS_UNSATISFIED = 'EXECUTION_TASK_READINESS_UNSATISFIED';
export const EXECUTION_TASK_NOT_EXECUTABLE = 'EXECUTION_TASK_NOT_EXECUTABLE';
export const NOT_FOUND = 'NOT_FOUND';
/**
 * Shared authorization code (Spec 003 §17.9): reusing the existing exterior keeps
 * a Decision that expired inside a long command indistinguishable, to the
 * caller, from one that had already expired when the command started.
 */
export const AUTHORIZATION_EXPIRED = 'AUTHORIZATION_EXPIRED';

/** The registered object types this operation fixes. */
export const TASK_READINESS_OBJECT_TYPE = 'zhiju.execution.task_readiness';
export const TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE = 'zhiju.execution.task_definition_snapshot';
export const POLICY_VERSION_OBJECT_TYPE = 'zhiju.identity.policy_version';
export const EVALUATOR_PROFILE_OBJECT_TYPE = 'zhiju.execution.evaluator_profile';
const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';

/**
 * The complete Policy observation of one build (§17.6). It can only be produced
 * by the owning `identity.resolve_policy@1.0` read; the object carries the
 * resolution's own fields so the producer never re-derives a version identity
 * from `objectId`/`versionId`.
 */
export interface TaskReadinessPolicyResolution {
  readonly status: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'REVOKED';
  readonly policyVersionRef?: CanonicalJsonObject | undefined;
  readonly contentHash?: string | undefined;
  readonly effectiveFrom?: string | undefined;
  readonly supersededAt?: string | null | undefined;
  readonly policyDocument?: unknown;
  readonly policySchemaRefs?: readonly unknown[] | undefined;
  readonly scopeRef?: CanonicalJsonObject | undefined;
}

/**
 * Internal TaskExecution Port for Policy resolution. IdentityPolicy owns the
 * authoritative resolution; TaskExecution never reads that schema, and an
 * unavailable owning entry throws instead of answering a default.
 */
export interface TaskReadinessPolicyPort {
  resolvePolicy(request: {
    readonly policyRef: CanonicalJsonObject;
  }): Promise<TaskReadinessPolicyResolution>;
}

export interface TaskReadinessProducerPorts {
  readonly policy: TaskReadinessPolicyPort;
  readonly inputRefs: TaskReadinessInputRefPort;
  /** Trusted server clock; the module's existing trusted-time semantics. */
  readonly now?: (() => Date) | undefined;
}

/**
 * Server-composed idempotency scope of the producer in one Project Scope. It is
 * never taken from a caller and carries the exact `commandType@commandVersion`,
 * so the producer never shares a claim with any other operation.
 */
export function buildTaskReadinessIdempotencyScope(
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

const HEX_64 = /^[0-9a-f]{64}$/u;

/**
 * The exact content-addressed TaskDefinitionSnapshot reference the frozen
 * definition pointer must equal. A hash of the wrong length, algorithm or
 * canonicalization version is not "close enough": the pointer comparison is what
 * proves the judgment judged the definition the Task currently commits to.
 */
function readExactDefinitionRef(
  value: unknown,
  scope: ReadinessScope,
): { readonly snapshotId: string; readonly hash: Buffer } | undefined {
  const ref = record(value);
  const contentHash = record(ref.contentHash);
  const digest = contentHash.digest;
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof digest !== 'string' ||
    !HEX_64.test(digest) ||
    contentHash.algorithm !== 'SHA-256' ||
    contentHash.canonicalizationVersion !== '1'
  ) {
    return undefined;
  }
  const refScope = exactProjectScope(ref.scope);
  if (refScope?.enterpriseId !== scope.enterpriseId || refScope.projectId !== scope.projectId) {
    return undefined;
  }
  return { snapshotId: ref.objectId, hash: Buffer.from(digest, 'hex') };
}

/**
 * The Policy version key of one build. §17.4 leaves its Scope to the owning
 * Handler: the first version requires an Enterprise dimension equal to the
 * trusted Enterprise and never accepts the empty/Platform form, and the
 * resolution's own `scopeRef` is compared against it field by field afterwards.
 */
function policyRefWithinTrustedScope(value: unknown, scope: ReadinessScope): boolean {
  const ref = record(value);
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== POLICY_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId)
  ) {
    return false;
  }
  const refScope = record(ref.scope);
  const keys = Object.keys(refScope);
  if (keys.length === 0 || !keys.includes('enterpriseId')) return false;
  if (!keys.every((key) => key === 'enterpriseId' || key === 'projectId')) return false;
  if (refScope.enterpriseId !== scope.enterpriseId) return false;
  return refScope.projectId === undefined || refScope.projectId === scope.projectId;
}

function sameScopeValue(left: unknown, right: unknown): boolean {
  const a = record(left);
  const b = record(right);
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key])
  );
}

function contentHashOf(digestHex: string): CanonicalJsonObject {
  return {
    algorithm: 'SHA-256',
    digest: digestHex,
    canonicalizationVersion: '1',
  };
}

/** The four upper-snake check codes and their closed outcome sets (§17.6). */
function orderedChecks(checks: readonly ReadinessCheckRow[]): CanonicalJsonObject[] {
  return checks.map((check) => ({
    checkCode: check.checkCode,
    outcome: check.outcome,
    factRefs: [...check.factRefs],
    reasonCodes: [...check.reasonCodes].sort(),
  }));
}

export async function handleBuildTaskReadiness(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: TaskReadinessProducerPorts,
): Promise<CommandResult> {
  const projectId = envelope.projectId;
  if (
    envelope.commandType !== BUILD_TASK_READINESS_COMMAND ||
    envelope.targetType !== TASK_READINESS_TARGET_TYPE ||
    projectId === undefined ||
    !isUuidV7(envelope.targetId)
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the readiness producer target must be the pre-allocated readiness identity of this Project',
    );
  }
  // This operation is a CREATE: the readiness identity does not exist yet, so an
  // expected aggregate version can only be a request that misunderstands it.
  if (envelope.expectedAggregateVersion !== undefined) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'a readiness CREATE must omit the expected aggregate version',
    );
  }
  const scope: ReadinessScope = { enterpriseId: envelope.enterpriseId, projectId };
  const payload = envelope.requestPayload;
  const repository = new TaskReadinessRepository();

  return executeTaskExecutionCommand(db, context, envelope, async (execution) => {
    const taskRef = payload.taskRef;
    const definitionRef = readExactDefinitionRef(payload.taskDefinitionRef, scope);
    if (definitionRef === undefined) {
      return reject(
        EXECUTION_JUDGMENT_INVALID,
        'taskDefinitionRef must be the exact Project-scoped snapshot reference of this Task',
      );
    }
    if (!policyRefWithinTrustedScope(payload.policyRef, scope)) {
      return reject(
        EXECUTION_JUDGMENT_INVALID,
        'policyRef must be the exact version key of the trusted Enterprise',
      );
    }
    // §17.6: the Evaluator selector is matched against the build-time registered
    // profile in every field. The observation is the registered reference, never
    // the caller's bytes, and any other selector is unsupported.
    const evaluatorRef = resolveTaskReadinessEvaluatorProfile(payload.evaluatorRef);
    if (evaluatorRef === undefined) {
      return reject(
        EXECUTION_CRITERION_UNSUPPORTED,
        'evaluatorRef is not the registered task readiness evaluator profile of this version',
      );
    }

    // §17.5 step 2: the Task Root is read under RLS, so "invisible" and
    // "missing" are the same NOT_FOUND and no other Scope's existence leaks.
    const taskShape = record(taskRef);
    const taskId = taskShape.objectId;
    if (typeof taskId !== 'string' || !isUuidV7(taskId)) {
      return reject(EXECUTION_TASK_REF_INVALID, 'taskRef must carry an exact Task identity');
    }
    const initialScope = exactProjectScope(taskShape.scope);
    if (
      taskShape.kind !== 'OBJECT' ||
      initialScope?.enterpriseId !== scope.enterpriseId ||
      initialScope.projectId !== scope.projectId
    ) {
      return reject(
        EXECUTION_TASK_REF_INVALID,
        'taskRef must be the Task OBJECT of this exact Project scope',
      );
    }
    const subject = (await repository.readTaskGraphNodes(execution.trx, [taskId])).at(0);
    if (subject === undefined) {
      return reject(NOT_FOUND, 'no Task is visible for taskRef in this Project scope');
    }
    const expectedObjectType =
      subject.definitionSchemaVersion === null
        ? undefined
        : taskSpellingForSchemaVersion(subject.definitionSchemaVersion);
    if (expectedObjectType === undefined) {
      return reject(
        EXECUTION_DEFINITION_REF_INVALID,
        'the Task definition does not carry a known creation major',
      );
    }
    // R-206-1: the accepted spelling is the one the Task's own creation major
    // fixed. The other published major's spelling, a bare local name, a prefix
    // change and a case variant are all refused with the same exterior, and
    // nothing is normalized or looked up again under another spelling.
    if (readTaskRefClosure(taskRef, expectedObjectType, scope) === undefined) {
      return reject(
        EXECUTION_TASK_REF_INVALID,
        'taskRef must be spelled exactly as the Task creation major spelled it',
      );
    }
    if (subject.status !== 'DRAFT') {
      return reject(EXECUTION_TASK_NOT_EXECUTABLE, 'only a DRAFT Task can be judged for readiness');
    }
    if (
      subject.currentDefinitionSnapshotId !== definitionRef.snapshotId ||
      !subject.currentDefinitionHash.equals(definitionRef.hash)
    ) {
      return reject(
        EXECUTION_JUDGMENT_INVALID,
        'taskDefinitionRef must be the exact definition the Task currently commits to',
      );
    }

    // §17.6: the Policy observation comes only from the owning resolution, with
    // its own authorization, and its lifecycle decides whether a judgment may be
    // produced at all.
    let resolution: TaskReadinessPolicyResolution;
    try {
      resolution = await ports.policy.resolvePolicy({
        policyRef: payload.policyRef as CanonicalJsonObject,
      });
    } catch {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'the IdentityPolicy resolution entry is unavailable',
      );
    }
    if (resolution.status !== 'USABLE') {
      return reject(
        EXECUTION_JUDGMENT_STALE,
        'the requested Policy version is not currently usable',
      );
    }
    const policyVersionRef = resolution.policyVersionRef;
    const policyContentHash = resolution.contentHash;
    const effectiveFrom = resolution.effectiveFrom;
    if (
      policyVersionRef === undefined ||
      typeof policyContentHash !== 'string' ||
      !HEX_64.test(policyContentHash) ||
      typeof effectiveFrom !== 'string' ||
      resolution.supersededAt === undefined ||
      !sameScopeValue(resolution.scopeRef, record(payload.policyRef).scope)
    ) {
      return reject(
        EXECUTION_JUDGMENT_INVALID,
        'the resolved Policy observation is not the exact reference this request declared',
      );
    }
    const profile = validateTaskReadinessPolicy({
      policySchemaRefs: resolution.policySchemaRefs ?? [],
      policyDocument: resolution.policyDocument,
    });
    if (!profile.valid) {
      return reject(
        EXECUTION_CRITERION_UNSUPPORTED,
        'the resolved Policy document is not the registered task readiness profile',
      );
    }

    const observation = await observeReadiness({
      repository,
      trx: execution.trx,
      subject,
      expectedObjectType,
      scope,
      ports: { inputRefs: ports.inputRefs },
    });
    if (observation.outcome === 'REJECTED') {
      return reject(observation.errorCode, observation.safeSummary);
    }

    const evaluatedAt = (ports.now ?? ((): Date => new Date()))();
    // The judgment records both the resolved Policy fact identity
    // (`policyVersionRef`) and the exact version key it was resolved from.
    // Without the key a later consumer could not re-resolve the Policy at its own
    // commit point, and §17.8 step 3 requires exactly that re-resolution before
    // the READY transition. Both values are covered by the judgment content hash.
    const observedPolicyRef = payload.policyRef as CanonicalJsonObject;
    const inputHashBody = {
      taskRef: taskRef as CanonicalJsonObject,
      taskDefinitionRef: payload.taskDefinitionRef as CanonicalJsonObject,
      taskAggregateVersion: subject.aggregateVersion,
      policyRef: observedPolicyRef,
      policyVersionRef,
      policyContentHash,
      policyEffectiveFrom: effectiveFrom,
      policySupersededAt: resolution.supersededAt ?? null,
      evaluatorRef,
      dependencies: observation.dependencies as unknown as CanonicalJsonObject[],
      inputs: observation.inputs as unknown as CanonicalJsonObject[],
      blockers: observation.blockers as unknown as CanonicalJsonObject[],
    } as unknown as CanonicalJsonObject;
    const inputHash = digestCanonicalPayload(inputHashBody).hash;

    // §17.6: `validUntil` is the minimum of the Policy bound, the producing
    // Decision's expiry and every applicable finite input bound. A term that has
    // no finite bound simply does not participate — it never becomes infinity.
    const bounds: number[] = [
      evaluatedAt.getTime() + profile.rules.maxReadinessValiditySeconds * 1000,
      context.authorizationDecisionExpiresAt.getTime(),
    ];
    for (const input of observation.inputs) {
      if (input.resolution !== 'USABLE' || input.validUntil === null) continue;
      const bound = Date.parse(input.validUntil);
      if (!Number.isNaN(bound)) bounds.push(bound);
    }
    const validUntil = new Date(Math.min(...bounds));

    const canonicalPayload = {
      judgmentId: envelope.targetId,
      judgmentKind: TASK_READINESS_JUDGMENT_KIND,
      scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      taskRef,
      taskDefinitionRef: payload.taskDefinitionRef,
      taskAggregateVersion: subject.aggregateVersion,
      policyRef: observedPolicyRef,
      policyVersionRef,
      policyContentHash,
      policyEffectiveFrom: effectiveFrom,
      policySupersededAt: resolution.supersededAt ?? null,
      evaluatorRef,
      dependencies: observation.dependencies,
      inputs: observation.inputs,
      blockers: observation.blockers,
      checks: orderedChecks(observation.checks),
      inputHash: inputHash.toString('hex'),
      evaluatedAt: evaluatedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      ready: observation.ready,
    } as unknown as CanonicalJsonObject;
    const digest = digestCanonicalPayload(canonicalPayload);

    const inserted = await execution.insertExecutionJudgment({
      judgmentId: envelope.targetId,
      judgmentKind: TASK_READINESS_JUDGMENT_KIND,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      taskId,
      taskDefinitionSnapshotId: definitionRef.snapshotId,
      taskDefinitionHash: definitionRef.hash,
      policyVersionRef,
      policyContentHash: Buffer.from(policyContentHash, 'hex'),
      policyEffectiveFrom: new Date(effectiveFrom),
      policySupersededAt:
        resolution.supersededAt == null ? null : new Date(resolution.supersededAt),
      evaluatorRef: evaluatorRef as unknown as CanonicalJsonObject,
      inputHash,
      evaluatedAt,
      validUntil,
      ready: observation.ready,
      canonicalPayload,
      payloadHash: digest.hash,
      requestPayloadHash: digestCanonicalPayload(envelope.requestPayload).hash,
      sourceCommandId: envelope.commandId,
      createdByPrincipalId: envelope.principalId,
    });
    if (!inserted) {
      return reject(
        CONCURRENCY_CONFLICT,
        'the readiness identity already exists in this Project scope',
      );
    }

    // Only references this transaction proved exist become Edges. Dependencies,
    // inputs and blockers stay inside the immutable payload: their existence and
    // current validity are proved by the owning actions in their own
    // transactions, which write the Edges, so no dangling Edge is created here.
    const edgeBase = {
      ownerObjectType: TASK_READINESS_TARGET_TYPE,
      ownerObjectId: envelope.targetId,
      ownerVersionId: envelope.targetId,
      ownerPayloadHash: digest.hash,
    };
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/taskRef',
      targetModule: 'TaskExecution',
      targetObjectType: expectedObjectType,
      targetObjectId: taskId,
      referencePurpose: 'TASK_READINESS_TASK',
    });
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/taskDefinitionRef',
      targetModule: 'TaskExecution',
      targetObjectType: TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE,
      targetObjectId: definitionRef.snapshotId,
      targetPayloadHash: definitionRef.hash,
      referencePurpose: 'TASK_READINESS_DEFINITION',
    });
    const policyRefRecord = record(policyVersionRef);
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/policyVersionRef',
      targetModule: 'IdentityPolicy',
      targetObjectType: POLICY_VERSION_OBJECT_TYPE,
      targetObjectId: String(policyRefRecord.objectId),
      targetPayloadHash: Buffer.from(policyContentHash, 'hex'),
      referencePurpose: 'TASK_READINESS_POLICY',
    });
    const evaluatorRefRecord = record(evaluatorRef);
    await execution.appendReferenceEdge({
      ...edgeBase,
      referencePath: '/evaluatorRef',
      targetModule: 'TaskExecution',
      targetObjectType: EVALUATOR_PROFILE_OBJECT_TYPE,
      targetObjectId: String(evaluatorRefRecord.objectId),
      targetVersionId: String(evaluatorRefRecord.versionId),
      referencePurpose: 'TASK_READINESS_EVALUATOR',
    });

    return {
      kind: 'COMMITTED',
      resultPayload: {
        targetRef: {
          kind: 'OBJECT',
          objectType: TASK_READINESS_OBJECT_TYPE,
          objectId: envelope.targetId,
          scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
        },
        data: {
          readinessSnapshotRef: {
            kind: 'SNAPSHOT',
            objectType: TASK_READINESS_OBJECT_TYPE,
            objectId: envelope.targetId,
            snapshotId: envelope.targetId,
            scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
            contentHash: contentHashOf(digest.hash.toString('hex')),
          },
        },
      } as unknown as CanonicalJsonObject,
    };
  });
}
