// IM-06 (#208): `execution.mark_task_ready@1.0`, the READY consumer.
//
// Design authority: Module-Spec-003 §17.8 (approved #206 design, PR #207). The
// registered Schema, Catalog entry and compatibility metadata of this historical
// operation are unchanged: the payload stays
// `{readinessSnapshotRef, requestedAt}`, and `requestedAt` is recorded as the
// caller's declared request instant only — it never participates in expiry, CAS
// or authorization, and the caller can never supply `ready` or a check list.
//
// The consumer revalidates its *own* authorization (composition, before the
// idempotency claim and before any historical Receipt return), re-reads the
// judgment by exact identity, re-checks every observation at the commit point
// with its own authorization, and only then performs the single `DRAFT`-only
// CAS. One Task transaction commits the transition, the Receipt, the Audit, the
// Reference Edges and exactly one registered `execution.TaskReady@1.0` row.

import { canonicalize, isUuidV7, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
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
  TaskReadinessRepository,
} from '../persistence/task-readiness-repository.js';
import { resolveTaskReadinessEvaluatorProfile } from './evaluator-profiles.js';
import {
  AUTHORIZATION_EXPIRED,
  EXECUTION_CRITERION_UNSUPPORTED,
  EXECUTION_DEFINITION_REF_INVALID,
  EXECUTION_JUDGMENT_INVALID,
  EXECUTION_JUDGMENT_STALE,
  EXECUTION_TASK_NOT_EXECUTABLE,
  EXECUTION_TASK_READINESS_UNSATISFIED,
  EXECUTION_TASK_REF_INVALID,
  NOT_FOUND,
  TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE,
  TASK_READINESS_OBJECT_TYPE,
  type TaskReadinessProducerPorts,
} from './task-readiness-production.js';
import {
  DEPENDENCY_UNAVAILABLE,
  exactProjectScope,
  observeReadiness,
  readTaskRefClosure,
  taskSpellingForSchemaVersion,
  TASK_READINESS_TASK_BINDINGS,
  type ReadinessCheckRow,
  type ReadinessScope,
} from './task-readiness-plan.js';

/** The registered command this handler owns. */
export const MARK_TASK_READY_COMMAND = 'execution.mark_task_ready';

/** The one registered public event a successful transition publishes. */
export const TASK_READY_EVENT = 'execution.TaskReady';
export const TASK_READY_EVENT_VERSION = '1.0';

/**
 * The consumer's Ports. The consumer shares the producer's internal read Ports
 * (they are reads, not authority) but never the producer's Decision: the
 * composition entry revalidates this operation's own entry of Spec 001 §15.5,
 * and the two authorization entries cannot stand in for each other.
 */
export type TaskReadyTransitionPorts = TaskReadinessProducerPorts;

/**
 * The module's trusted clock. `evaluatedAt`/`validUntil` are never derived from
 * anything a caller declared, and every commitment decision reads this clock.
 */
function trustedClock(ports: TaskReadyTransitionPorts): () => Date {
  return ports.now ?? ((): Date => new Date());
}

const HEX_64 = /^[0-9a-f]{64}$/u;

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

function canonicalText(value: unknown): string {
  return canonicalize(value as CanonicalJsonObject);
}

function readinessSnapshotRef(
  judgmentId: string,
  digest: Buffer,
  scope: ReadinessScope,
): CanonicalJsonObject {
  return {
    kind: 'SNAPSHOT',
    objectType: TASK_READINESS_OBJECT_TYPE,
    objectId: judgmentId,
    snapshotId: judgmentId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest: digest.toString('hex'),
      canonicalizationVersion: '1',
    },
  };
}

/**
 * The exact `SnapshotRef<task_readiness>` the consumer was asked to consume.
 * `objectId == snapshotId` is the identity shape the registered TaskReadiness
 * ref fixes: a judgment has no mutable Root and no movable pointer.
 */
function readJudgmentRef(
  value: unknown,
  scope: ReadinessScope,
): { readonly judgmentId: string; readonly contentHash: Buffer } | undefined {
  const ref = record(value);
  const contentHash = record(ref.contentHash);
  const digest = contentHash.digest;
  if (
    ref.kind !== 'SNAPSHOT' ||
    ref.objectType !== TASK_READINESS_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    ref.snapshotId !== ref.objectId ||
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
  return { judgmentId: ref.objectId, contentHash: Buffer.from(digest, 'hex') };
}

/**
 * The same closed check-row derivation the producer used. Comparing the derived
 * rows as well as the raw observations keeps the verdict itself inside the
 * comparison instead of trusting the recorded boolean alone.
 */
function orderedChecks(checks: readonly ReadinessCheckRow[]): CanonicalJsonObject[] {
  return checks.map((check) => ({
    checkCode: check.checkCode,
    outcome: check.outcome,
    factRefs: [...check.factRefs],
    reasonCodes: [...check.reasonCodes].sort(),
  }));
}

export async function handleMarkTaskReady(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: TaskReadyTransitionPorts,
): Promise<CommandResult> {
  const projectId = envelope.projectId;
  if (
    envelope.commandType !== MARK_TASK_READY_COMMAND ||
    !TASK_READINESS_TASK_BINDINGS.some(
      (candidate) => candidate.taskObjectType === envelope.targetType,
    ) ||
    projectId === undefined ||
    !isUuidV7(envelope.targetId) ||
    envelope.expectedAggregateVersion === undefined
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'the READY transition target must be an existing published Task of this Project',
    );
  }
  const scope: ReadinessScope = { enterpriseId: envelope.enterpriseId, projectId };
  const repository = new TaskReadinessRepository();
  const requestPayload = record(envelope.requestPayload);

  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      // §17.8 step 2: exact identity, exact Scope and a content address that the
      // stored bytes still reproduce. Every other case is the same unusable
      // judgment, so the exterior never learns whether another Scope holds it.
      const judgmentRef = readJudgmentRef(requestPayload.readinessSnapshotRef, scope);
      if (judgmentRef === undefined) {
        return reject(
          EXECUTION_JUDGMENT_INVALID,
          'readinessSnapshotRef is not an exact Project-scoped TaskReadiness identity',
        );
      }
      const judgment = await repository.readExecutionJudgment(
        execution.trx,
        judgmentRef.judgmentId,
      );
      if (judgment === undefined) {
        return reject(EXECUTION_JUDGMENT_INVALID, 'no such readiness judgment is usable here');
      }
      const stored = record(judgment.canonical_payload);
      const storedDigest = digestCanonicalPayload(
        judgment.canonical_payload as CanonicalJsonObject,
      );
      if (
        judgment.enterprise_id !== scope.enterpriseId ||
        judgment.project_id !== scope.projectId ||
        judgment.judgment_kind !== TASK_READINESS_JUDGMENT_KIND ||
        stored.judgmentId !== judgment.judgment_id ||
        !judgment.payload_hash.equals(storedDigest.hash) ||
        !judgmentRef.contentHash.equals(storedDigest.hash)
      ) {
        return reject(
          EXECUTION_JUDGMENT_INVALID,
          'the readiness judgment is unusable or does not reproduce its own content address',
        );
      }

      // §17.8 step 3: expiry and the Policy/Evaluator lifecycle are re-checked with
      // the trusted clock and a fresh owning resolution, never with anything the
      // caller declared. This first read fails fast; the commit point re-reads the
      // clock and is the check that actually decides (see `commitNow` below).
      const trustedNow = trustedClock(ports);
      if (trustedNow().getTime() >= judgment.valid_until.getTime()) {
        return reject(EXECUTION_JUDGMENT_STALE, 'the readiness judgment has expired');
      }
      if (resolveTaskReadinessEvaluatorProfile(judgment.evaluator_ref) === undefined) {
        return reject(
          EXECUTION_CRITERION_UNSUPPORTED,
          'the judgment was produced by an Evaluator this build does not support',
        );
      }
      const observedPolicyRef = record(stored.policyRef);
      if (Object.keys(observedPolicyRef).length === 0) {
        return reject(
          EXECUTION_JUDGMENT_INVALID,
          'the readiness judgment does not carry the Policy version key it observed',
        );
      }
      let policyResolution;
      try {
        policyResolution = await ports.policy.resolvePolicy({
          policyRef: observedPolicyRef as CanonicalJsonObject,
        });
      } catch {
        throw new CommandExecutionError(
          DEPENDENCY_UNAVAILABLE,
          'the IdentityPolicy resolution entry is unavailable',
        );
      }
      if (
        policyResolution.status !== 'USABLE' ||
        policyResolution.contentHash !== judgment.policy_content_hash.toString('hex') ||
        policyResolution.effectiveFrom !== judgment.policy_effective_from.toISOString() ||
        (policyResolution.supersededAt ?? null) !==
          (judgment.policy_superseded_at === null
            ? null
            : judgment.policy_superseded_at.toISOString())
      ) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the Policy observation of the readiness judgment is no longer current',
        );
      }

      // §17.8 step 4: the envelope target, the Task Root and the judgment's
      // subject must agree on every field before the transition is attempted.
      const subject = (await repository.readTaskGraphNodes(execution.trx, [envelope.targetId])).at(
        0,
      );
      if (subject === undefined) {
        return reject(NOT_FOUND, 'no Task is visible for the READY target in this Project scope');
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
      // R-206-1: the accepted spelling is fixed by the Task's own creation major,
      // and an expected aggregate version is mandatory because this is a MUTATE of
      // an existing Task.
      if (
        envelope.targetType !== expectedObjectType ||
        readTaskRefClosure(
          {
            kind: 'OBJECT',
            objectType: envelope.targetType,
            objectId: envelope.targetId,
            scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
          },
          expectedObjectType,
          scope,
        ) === undefined
      ) {
        return reject(
          EXECUTION_TASK_REF_INVALID,
          'the target must be spelled exactly as the Task creation major spelled it',
        );
      }
      if (String(record(stored.taskRef).objectId) !== envelope.targetId) {
        return reject(
          EXECUTION_JUDGMENT_INVALID,
          'the readiness judgment is not about the Task this request converts',
        );
      }
      if (subject.status !== 'DRAFT') {
        return reject(EXECUTION_TASK_NOT_EXECUTABLE, 'only a DRAFT Task can be converted to READY');
      }
      if (subject.aggregateVersion !== envelope.expectedAggregateVersion) {
        return reject(CONCURRENCY_CONFLICT, 'the Task moved since the request was prepared');
      }
      if (String(stored.taskAggregateVersion) !== subject.aggregateVersion) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the Task moved after the readiness judgment was built',
        );
      }
      const judgedDefinition = record(stored.taskDefinitionRef);
      if (
        judgedDefinition.objectId !== subject.currentDefinitionSnapshotId ||
        record(judgedDefinition.contentHash).digest !==
          subject.currentDefinitionHash.toString('hex')
      ) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the Task definition changed after the readiness judgment was built',
        );
      }

      // §17.8 step 5: the complete dependency/input/blocker set is re-observed at
      // the commit point with this entry's own authorization and must equal the
      // recorded observation field by field. Nothing is repaired in place.
      const observation = await observeReadiness({
        repository,
        trx: execution.trx,
        subject,
        expectedObjectType,
        scope,
        ports: {
          inputRefs: ports.inputRefs,
          ...(ports.completion ? { completion: ports.completion } : {}),
        },
      });
      if (observation.outcome === 'REJECTED') {
        return reject(observation.errorCode, observation.safeSummary);
      }
      if (
        canonicalText(observation.dependencies) !== canonicalText(stored.dependencies) ||
        canonicalText(observation.inputs) !== canonicalText(stored.inputs) ||
        canonicalText(observation.blockers) !== canonicalText(stored.blockers) ||
        canonicalText(orderedChecks(observation.checks)) !== canonicalText(stored.checks)
      ) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the observed dependency, input or blocker facts no longer match the judgment',
        );
      }

      // §17.8 step 6: an unsupported check wins over a plain unsatisfied verdict,
      // and `ready` is read from the immutable judgment only.
      const recordedChecks = Array.isArray(stored.checks) ? stored.checks : [];
      if (recordedChecks.some((check) => record(check).outcome === 'UNSUPPORTED')) {
        return reject(
          EXECUTION_CRITERION_UNSUPPORTED,
          'the readiness judgment contains an unsupported criterion',
        );
      }
      if (!judgment.ready) {
        return reject(
          EXECUTION_TASK_READINESS_UNSATISFIED,
          'the readiness judgment concluded that the Task is not ready',
        );
      }

      // §17.6 time boundary at the commit point: a long transaction must not pass
      // on a timestamp read before its owning reads. The judgment, the producing
      // Decision and the Policy's own finite bound are all re-checked against the
      // trusted clock *now*, immediately before the irreversible CAS, and the same
      // instant is what the Receipt and the TaskReady event record, so no reader
      // can observe a transition that had already expired when it committed.
      const commitNow = trustedNow();
      const commitInstant = commitNow.getTime();
      if (commitInstant >= judgment.valid_until.getTime()) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the readiness judgment expired before the transition could commit',
        );
      }
      if (
        judgment.policy_superseded_at !== null &&
        commitInstant >= judgment.policy_superseded_at.getTime()
      ) {
        return reject(
          EXECUTION_JUDGMENT_STALE,
          'the Policy the judgment observed was superseded before the transition could commit',
        );
      }
      if (commitInstant >= context.authorizationDecisionExpiresAt.getTime()) {
        throw new CommandExecutionError(
          AUTHORIZATION_EXPIRED,
          'the authorizing Decision expired before the transition could commit',
        );
      }

      // §17.8 step 7: the single DRAFT-only CAS decides the winner.
      const transition = await execution.casTaskStatusToReady({
        taskId: envelope.targetId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        expectedAggregateVersion: envelope.expectedAggregateVersion,
        currentDefinitionSnapshotId: subject.currentDefinitionSnapshotId,
        currentDefinitionHash: subject.currentDefinitionHash,
        updatedByPrincipalId: envelope.principalId,
      });
      if (!transition.updated) {
        const current = transition.current;
        if (current === undefined) {
          return reject(NOT_FOUND, 'no Task is visible for the READY target in this Project scope');
        }
        if (current.status !== 'DRAFT') {
          return reject(
            EXECUTION_TASK_NOT_EXECUTABLE,
            'only a DRAFT Task can be converted to READY',
          );
        }
        if (
          current.currentDefinitionSnapshotId !== subject.currentDefinitionSnapshotId ||
          !current.currentDefinitionHash.equals(subject.currentDefinitionHash)
        ) {
          return reject(
            EXECUTION_JUDGMENT_STALE,
            'the Task definition changed at the transition point',
          );
        }
        return reject(CONCURRENCY_CONFLICT, 'the Task moved at the transition point');
      }

      const taskRef = {
        kind: 'OBJECT',
        objectType: expectedObjectType,
        objectId: envelope.targetId,
        scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
      } as unknown as CanonicalJsonObject;
      // The registered event payload is `{taskRef, readinessSnapshotRef, readyAt}`.
      // The outbox row additionally carries the promoted scope mirror that every
      // TaskExecution event payload must embed: V3000's `guard_outbox_scope_mirror`
      // and the shared runner both require it of the payload, exactly as the
      // delivered EnterpriseProject and IdentityPolicy event emissions already do.
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: TASK_READY_EVENT,
        eventVersion: TASK_READY_EVENT_VERSION,
        aggregateType: expectedObjectType,
        aggregateId: envelope.targetId,
        aggregateVersion: transition.aggregateVersion,
        payload: {
          enterpriseId: scope.enterpriseId,
          projectId: scope.projectId,
          taskRef,
          readinessSnapshotRef: readinessSnapshotRef(
            judgment.judgment_id,
            judgment.payload_hash,
            scope,
          ),
          readyAt: commitNow.toISOString(),
        },
        occurredAt: commitNow,
      });

      // The Task owner points at the judgment and at the definition it converted,
      // so the transition is traceable from the Task side. The opposite direction
      // (judgment -> Task) is written once by the producer, whose command target
      // *is* the judgment; this transaction's command target is the Task, and the
      // shared runner binds every Edge owner to the command target. Writing it
      // here as well would be both refused and a duplicate of an edge the
      // producer's own transaction already committed.
      await execution.appendReferenceEdge({
        ownerObjectType: expectedObjectType,
        ownerObjectId: envelope.targetId,
        ownerVersionId: subject.currentDefinitionSnapshotId,
        ownerPayloadHash: subject.currentDefinitionHash,
        referencePath: '/readinessSnapshotRef',
        targetModule: 'TaskExecution',
        targetObjectType: TASK_READINESS_OBJECT_TYPE,
        targetObjectId: judgment.judgment_id,
        targetPayloadHash: judgment.payload_hash,
        referencePurpose: 'TASK_READY_JUDGMENT',
      });
      await execution.appendReferenceEdge({
        ownerObjectType: expectedObjectType,
        ownerObjectId: envelope.targetId,
        ownerVersionId: subject.currentDefinitionSnapshotId,
        ownerPayloadHash: subject.currentDefinitionHash,
        referencePath: '/taskDefinitionRef',
        targetModule: 'TaskExecution',
        targetObjectType: TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE,
        targetObjectId: subject.currentDefinitionSnapshotId,
        targetPayloadHash: subject.currentDefinitionHash,
        referencePurpose: 'TASK_READY_DEFINITION',
      });

      return {
        kind: 'COMMITTED',
        // The same trusted instant the event carries becomes the Receipt's
        // `completed_at`, so §17.8's `readyAt` and the command's own completion
        // time are one value by construction instead of two independent clocks.
        committedAt: commitNow,
        // The result carries the transitioned identity only. The caller-declared
        // `requestedAt` is not authority and is not echoed: it is committed by the
        // request hash chain and by the runner's own Receipt and Audit rows.
        resultPayload: {
          taskRef,
          status: 'READY',
          aggregateVersion: transition.aggregateVersion,
        } as unknown as CanonicalJsonObject,
      };
    },
    ports.revalidateAuthorization,
  );
}
