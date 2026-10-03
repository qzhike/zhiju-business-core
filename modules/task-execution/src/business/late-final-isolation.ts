import { canonicalize, newUuidV7, sha256CanonicalJson } from '@zhiju/shared-kernel';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely, Selectable } from 'kysely';

import {
  withTaskExecutionTransaction,
  type RunTable,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { object, requireThat, same, textValue } from './work-order-validation-plan.js';

const RUN = 'execution.run';
type RunRow = Selectable<RunTable>;

/**
 * §27.3 late-final isolation. The original immutable IG Observation stays the
 * owning source; task_execution only appends a fixed redacted `LATE_RESULT`
 * audit that records the verified Observation Ref and original body Hash. The
 * path never creates an eligible Result, Acceptance, output or Completion, and
 * it never asks the expired execution Bundle to become current again: only the
 * independent isolation authority and the historical source integrity are
 * required.
 */
export interface LateFinalIsolationPorts {
  readonly now: () => Date;
  /** Current `runLateFinalIsolateV1` Decision, re-proved before/after writes. */
  readonly revalidateIsolation: () => Promise<void>;
  /** Authorized `integration.runtime.binding.read` read of the original Attempt. */
  readonly readBinding: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  /** Authorized `integration.runtime.final_observation.read` read of the final. */
  readonly readFinal: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  /** Historical Bundle integrity read; never re-grants execution eligibility. */
  readonly inspectBundle: (
    bundleRef: CanonicalJsonObject,
    runRef: CanonicalJsonObject,
  ) => Promise<void>;
}

export interface LateFinalIsolationInput {
  readonly runRef: CanonicalJsonObject;
  readonly attemptRef: CanonicalJsonObject;
}

export interface LateFinalIsolationResult {
  readonly auditId: string;
  readonly runId: string;
  readonly observationRef: CanonicalJsonObject;
  readonly resultPayloadHash: CanonicalJsonObject;
}

function reference(
  value: unknown,
  objectType: string,
  code = 'REFERENCE_INVALID',
): CanonicalJsonObject {
  const ref = object(value);
  requireThat(ref.objectType === objectType && typeof ref.objectId === 'string', code);
  return ref;
}

export async function isolateLateFinalResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: LateFinalIsolationInput,
  ports: LateFinalIsolationPorts,
): Promise<LateFinalIsolationResult> {
  const runRef = reference(input.runRef, RUN);
  const attemptRef = reference(input.attemptRef, 'integration.runtime_attempt');
  await ports.revalidateIsolation();
  const auditId = newUuidV7();
  const observed = await withTaskExecutionTransaction(db, context, async (trx) => {
    const run: RunRow | undefined = await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', textValue(runRef.objectId))
      .executeTakeFirst();
    requireThat(run !== undefined, 'NOT_FOUND');
    requireThat(
      run.enterprise_id === context.enterpriseId &&
        context.allowedProjectIds.includes(run.project_id) &&
        same(object(runRef.scope), { enterpriseId: run.enterprise_id, projectId: run.project_id }),
      'NOT_FOUND',
    );
    requireThat(
      ['CANCELLING', 'ABANDONED', 'TIMED_OUT'].includes(run.status),
      'EXECUTION_CRITERION_UNSUPPORTED',
    );
    requireThat(
      run.started_at !== null &&
        run.start_attempt_ref !== null &&
        run.runtime_adapter_identity_ref !== null,
      'EXECUTION_CRITERION_UNSUPPORTED',
    );
    if (run.status === 'ABANDONED' || run.status === 'TIMED_OUT')
      requireThat(run.ended_at !== null);
    const binding = await ports.readBinding(attemptRef);
    const final = await ports.readFinal(attemptRef);
    const invocation = object(binding.invocationBinding);
    const acknowledgement = object(binding.acknowledgement);
    requireThat(
      binding.status === 'SUCCEEDED' &&
        same(object(binding.attemptRef), attemptRef) &&
        same(invocation.runRef, runRef) &&
        same(invocation.workOrderContractRef, object(run.work_order_contract_ref)) &&
        same(invocation.contextSnapshotRef, object(run.context_snapshot_ref)) &&
        same(invocation.capabilityGrantRef, object(run.capability_grant_ref)) &&
        invocation.leaseId === run.lease_id &&
        invocation.fencingToken === Number(run.fencing_token) &&
        invocation.leaseExpiresAt === run.lease_expires_at.toISOString() &&
        same(invocation.runtimeBinding, object(run.runtime_binding)),
      'REFERENCE_INVALID',
    );
    const observationRef = reference(
      final.observationRef,
      'zhiju.integration.runtime_final_observation',
    );
    const resultPayloadHash = object(final.resultPayloadHash);
    requireThat(
      same(object(final.runRef), runRef) &&
        same(object(final.attemptRef), attemptRef) &&
        same(object(final.bindingHash), object(binding.bindingHash)) &&
        same(object(final.runtimeAdapterIdentityRef), object(run.runtime_adapter_identity_ref)) &&
        final.runFencingToken === Number(run.fencing_token) &&
        final.ackObservationId === acknowledgement.observationId &&
        observationRef.contentHash !== undefined &&
        resultPayloadHash.digest !== undefined,
      'REFERENCE_INVALID',
    );
    await ports.inspectBundle(object(run.capability_grant_ref), runRef);
    const requestHash = Buffer.from(
      sha256CanonicalJson({ runRef, attemptRef, observationRef }),
      'hex',
    );
    const recordedAt = ports.now();
    await ports.revalidateIsolation();
    await trx
      .insertInto('task_execution.audit_record')
      .values({
        audit_id: auditId,
        enterprise_id: run.enterprise_id,
        project_id: run.project_id,
        principal_id: context.principalId,
        actor_snapshot_id: context.actorSnapshotId,
        authorization_decision_id: context.authorizationDecisionId,
        command_type: 'execution.run.late_final.isolate',
        outcome: 'REJECTED',
        error_code: 'LATE_RESULT',
        request_payload_hash: requestHash,
        result_payload_hash: Buffer.from(textValue(resultPayloadHash.digest), 'hex'),
        target_type: RUN,
        target_id: run.run_id,
        target_aggregate_version: run.aggregate_version,
        correlation_id: context.correlationId,
        runtime_ref: canonicalize({
          observationRef,
          attemptRef,
          bindingHash: object(binding.bindingHash),
        }),
        safe_summary:
          'late final isolated as LATE_RESULT; no eligible Result, Acceptance, output or Completion',
        recorded_at: recordedAt,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
    await ports.revalidateIsolation();
    return { observationRef, resultPayloadHash };
  });
  return {
    auditId,
    runId: textValue(runRef.objectId),
    observationRef: observed.observationRef,
    resultPayloadHash: observed.resultPayloadHash,
  };
}
