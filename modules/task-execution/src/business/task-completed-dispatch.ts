import { sql, type Kysely } from 'kysely';
import { ContractRegistry } from '@zhiju/contracts';
import { canonicalize, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  withTaskExecutionTransaction,
} from '../persistence/task-execution-db.js';
type Ref = CanonicalJsonObject;
export interface TaskCompletedDeliveryMaterial {
  readonly event: Ref;
  readonly sidecar: Ref;
  readonly bindingHash: Ref;
  readonly sourceWatermark: Ref;
}
export interface TaskCompletedClaim {
  readonly status: 'CLAIMED';
  readonly eventId: string;
  readonly taskRef: Ref;
  readonly leaseToken: string;
}
export interface TaskCompletedDispatchProof {
  readonly context: TaskExecutionTransactionContext;
  readonly revalidate: () => Promise<void>;
}
const materials = new WeakSet<object>();
export function isTaskCompletedDeliveryMaterial(
  value: unknown,
): value is TaskCompletedDeliveryMaterial {
  return typeof value === 'object' && value !== null && materials.has(value);
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
function object(value: unknown): Ref {
  return value as Ref;
}
function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
function verifyMaterial(value: TaskCompletedDeliveryMaterial) {
  const { event, sidecar, bindingHash, sourceWatermark } = value;
  const registry = new ContractRegistry();
  if (
    !registry.validateOperation('execution.TaskCompleted', '1.0', event).valid ||
    object(object(event.integrity).payloadHash).digest !==
      sha256CanonicalJson(object(event.payload)) ||
    sidecar.eventId !== event.eventId ||
    object(sidecar.eventEnvelopeHash).digest !== sha256CanonicalJson(event) ||
    canonicalize(sidecar.publicPayloadHash ?? null) !==
      canonicalize(object(event.integrity).payloadHash ?? null) ||
    bindingHash.digest !== sha256CanonicalJson(sidecar) ||
    canonicalize(sidecar.taskRef ?? null) !== canonicalize(object(event.payload).taskRef ?? null) ||
    canonicalize(sidecar.taskEvaluationRef ?? null) !==
      canonicalize(object(event.payload).evaluationRef ?? null) ||
    object(sidecar.taskDefinitionSnapshotRef).kind !== 'CONTENT_ADDRESSED' ||
    sourceWatermark.sourceModule !== 'task_execution' ||
    sourceWatermark.partition !== object(event.scopeRef).projectId ||
    !Number.isSafeInteger(sourceWatermark.sequence) ||
    Number(sourceWatermark.sequence) < 1
  )
    fail('DISPATCH_SOURCE_INVALID');
}
export function createTaskCompletedDispatchPort(
  db: Kysely<TaskExecutionDb>,
  config: { readonly leaseSeconds?: number } = {},
) {
  const lease = config.leaseSeconds ?? 60;
  if (!Number.isSafeInteger(lease) || lease < 1 || lease > 300)
    throw new TypeError('Invalid dispatch lease');
  async function transaction<T>(
    proof: TaskCompletedDispatchProof,
    projectId: string,
    body: (trx: Parameters<Parameters<typeof withTaskExecutionTransaction>[2]>[0]) => Promise<T>,
  ) {
    if (!proof.context.allowedProjectIds.includes(projectId))
      fail('AUTHORIZATION_DECISION_INVALID');
    await proof.revalidate();
    const result = await withTaskExecutionTransaction(db, proof.context, async (trx) => {
      await sql.raw('SET LOCAL ROLE task_execution_dispatcher').execute(trx);
      await proof.revalidate();
      const value = await body(trx);
      await proof.revalidate();
      return value;
    });
    await proof.revalidate();
    return result;
  }
  return {
    scan: (proof: TaskCompletedDispatchProof, projectId: string) =>
      transaction(proof, projectId, async (trx) => {
        const rows = await sql<{
          event_id: string;
        }>`SELECT task_execution.dispatch_scan(${proof.context.enterpriseId}::uuid,${projectId}::uuid) AS event_id`.execute(
          trx,
        );
        return rows.rows.map((r) => r.event_id);
      }),
    claim: (
      proof: TaskCompletedDispatchProof,
      projectId: string,
      eventId: string,
      workerOwner: string,
      authorizeRead: (taskRef: Ref, leaseToken: string) => Promise<TaskCompletedDispatchProof>,
    ) =>
      transaction(proof, projectId, async (trx) => {
        const e = proof.context.enterpriseId;
        const locked = (
          await sql<{
            value: Ref;
          }>`SELECT task_execution.dispatch_lock(${e}::uuid,${projectId}::uuid,${eventId}::uuid) AS value`.execute(
            trx,
          )
        ).rows[0]?.value;
        if (!locked) fail('NOT_FOUND');
        const read = await authorizeRead(object(locked.taskRef), locked.nextToken as string);
        if (
          read.context.principalId !== proof.context.principalId ||
          read.context.enterpriseId !== e ||
          !read.context.allowedProjectIds.includes(projectId)
        )
          fail('AUTHORIZATION_DECISION_INVALID');
        await proof.revalidate();
        await read.revalidate();
        const result = (
          await sql<{
            value: Ref;
          }>`SELECT task_execution.dispatch_claim(${e}::uuid,${projectId}::uuid,${eventId}::uuid,${workerOwner},${lease}) AS value`.execute(
            trx,
          )
        ).rows[0]?.value;
        if (!result) fail('NOT_FOUND');
        if (result.status === 'CLAIMED') {
          const material = (
            await sql<{
              value: TaskCompletedDeliveryMaterial;
            }>`SELECT task_execution.dispatch_read(${e}::uuid,${projectId}::uuid,${eventId}::uuid,${workerOwner},${result.leaseToken}::bigint,${object(locked.taskRef).objectId}::uuid) AS value`.execute(
              trx,
            )
          ).rows[0]?.value;
          if (!material) fail('NOT_FOUND');
          verifyMaterial(material);
        }
        await read.revalidate();
        await proof.revalidate();
        return result as unknown as
          TaskCompletedClaim | { status: 'UNAVAILABLE' | 'UNSUPPORTED_ASSOCIATION' | 'DEAD' };
      }),
    readClaimed: async (
      proof: TaskCompletedDispatchProof,
      projectId: string,
      claim: TaskCompletedClaim,
      workerOwner: string,
    ) => {
      const value = await transaction(proof, projectId, async (trx) => {
        const material = (
          await sql<{
            value: TaskCompletedDeliveryMaterial;
          }>`SELECT task_execution.dispatch_read(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${claim.eventId}::uuid,${workerOwner},${claim.leaseToken}::bigint,${claim.taskRef.objectId}::uuid) AS value`.execute(
            trx,
          )
        ).rows[0]?.value;
        if (!material) fail('NOT_FOUND');
        verifyMaterial(material);
        return material;
      });
      immutable(value);
      materials.add(value);
      return value;
    },
    confirm: (
      proof: TaskCompletedDispatchProof,
      projectId: string,
      claim: TaskCompletedClaim,
      workerOwner: string,
      consumerResult: Ref,
    ) =>
      transaction(proof, projectId, async (trx) => {
        await sql`SELECT task_execution.dispatch_lock(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${claim.eventId}::uuid)`.execute(
          trx,
        );
        await proof.revalidate();
        await sql`SELECT task_execution.dispatch_finish(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${claim.eventId}::uuid,${workerOwner},${claim.leaseToken}::bigint,${claim.taskRef.objectId}::uuid,${canonicalize(consumerResult)}::jsonb)`.execute(
          trx,
        );
      }),
    markFailure: (
      proof: TaskCompletedDispatchProof,
      projectId: string,
      claim: TaskCompletedClaim,
      workerOwner: string,
      errorCode: string,
    ) =>
      transaction(proof, projectId, async (trx) => {
        await sql`SELECT task_execution.dispatch_lock(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${claim.eventId}::uuid)`.execute(
          trx,
        );
        await proof.revalidate();
        const retry = [
          'DEPENDENCY_UNAVAILABLE',
          'DISPATCH_TIMEOUT',
          'DISPATCH_TRANSPORT_UNKNOWN',
        ].includes(errorCode);
        return (
          await sql<{
            state: string;
          }>`SELECT task_execution.dispatch_finish(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${claim.eventId}::uuid,${workerOwner},${claim.leaseToken}::bigint,${claim.taskRef.objectId}::uuid,NULL,${errorCode},${retry}) AS state`.execute(
            trx,
          )
        ).rows[0]?.state;
      }),
    resumeDead: (
      proof: TaskCompletedDispatchProof,
      projectId: string,
      eventId: string,
      taskId: string,
      reason: string,
    ) =>
      transaction(proof, projectId, async (trx) => {
        await sql`SELECT task_execution.dispatch_lock(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${eventId}::uuid,true)`.execute(
          trx,
        );
        await proof.revalidate();
        await sql`SELECT task_execution.dispatch_resume(${proof.context.enterpriseId}::uuid,${projectId}::uuid,${eventId}::uuid,${taskId}::uuid,${reason})`.execute(
          trx,
        );
      }),
  };
}
export type TaskCompletedDispatchPort = ReturnType<typeof createTaskCompletedDispatchPort>;
