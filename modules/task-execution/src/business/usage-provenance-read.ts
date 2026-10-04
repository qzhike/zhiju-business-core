// IM-06 (#246): `execution.get_usage_and_provenance@1.0`, the Human-operated
// Usage and execution Provenance readback (Spec 003 §13, approved design
// `.vibe/decisions/task-execution-usage-provenance.md` U-01..U-04).
//
// One authorized Human reads Usage and execution Provenance for exactly one
// supported Run. The read distinguishes four facts without ever claiming
// Provider/runtime measurement or business completion:
//
//   * a measurement that was never observed (UNKNOWN / SOURCE_NOT_OBSERVED),
//   * a final whose Acceptance is not committed yet (UNKNOWN / RESULT_NOT_ACCEPTED),
//   * a structured Agent declaration that an ACCEPTED Result and its original
//     IG source verify (PRESENT / AGENT_DECLARED, original fields verbatim),
//   * a late, ineligible original final isolated by the owning cancel path
//     (UNKNOWN / LATE_RESULT).
//
// The owning facts are read from ONE dedicated REPEATABLE READ TE snapshot
// (`withTaskExecutionSnapshotTransaction`): Run, final submission claim,
// AgentResult, Acceptance and the limited LATE_RESULT audit are consistent with
// each other and with `snapshotAt`. The original invocation facts come from the
// IntegrationGateway-owned reads; the frozen WorkOrder Contract comes from the
// TaskExecution-owned Contract read. Cross-owner facts are never promised to be
// atomically consistent with the TE snapshot.
//
// This path performs no TE/IG business or source DML, no Driver call, no
// readBack/readFinal/invoke, creates no Result/Acceptance, advances no Root and
// appends no Receipt/Outbox event. A legitimate history remains readable after
// the original execution lease/Bundle expires; a revoked or expired *read*
// authority still fails closed, and the composition revalidates every Decision
// it used before this function returns.
//
// Local Root/source storage corruption (a mirror the owning module wrote
// inconsistently) is refused as `INTERNAL_CONTRACT_VIOLATION` with no data. A
// verifiable cross-owner conflict is reported as safe UNAVAILABLE evidence and
// never becomes PRESENT Usage.

import { getContractRegistry, resolveWorkOrderReadyProfile } from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  sha256CanonicalJson,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import type { Kysely, Selectable } from 'kysely';
import { CommandExecutionError } from '../persistence/command-runner.js';
import {
  withTaskExecutionSnapshotTransaction,
  type AgentResultAcceptanceTable,
  type AgentResultTable,
  type AuditRecordTable,
  type RunFinalSubmissionClaimTable,
  type RunTable,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { hash, object, requireThat, same, textValue } from './work-order-validation-plan.js';

const registry = getContractRegistry();
const RUN = 'execution.run';
const RESULT = 'execution.agent_result';
const ACCEPTANCE = 'execution.agent_result_acceptance';
const ATTEMPT = 'integration.runtime_attempt';
const ADAPTER_IDENTITY = 'zhiju.runtime.runtime';
const LATE_COMMAND = 'execution.run.late_final.isolate';
const LATE_ERROR = 'LATE_RESULT';

/** The registered query this handler owns. Only `@1.0` exists. */
export const GET_USAGE_AND_PROVENANCE_QUERY = 'execution.get_usage_and_provenance';
export const GET_USAGE_AND_PROVENANCE_VERSION = '1.0';

/** The closed safety profile of this read (Spec 003 §13.3). */
export const USAGE_PROVENANCE_PROFILE = 'execution.provenance.human_operated.v1';

/** The closed reasonCode set of this profile (Spec 003 §13.2). */
export type UsageReasonCode =
  | 'SOURCE_NOT_OBSERVED'
  | 'RESULT_NOT_ACCEPTED'
  | 'USAGE_NOT_DECLARED'
  | 'SOURCE_CONFLICT'
  | 'LATE_RESULT';

const MEASUREMENT_FIELDS = [
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'toolCalls',
  'estimatedCost',
] as const;

const RUN_STATUSES: Readonly<Record<string, true>> = Object.freeze({
  CREATED: true,
  STARTING: true,
  RUNNING: true,
  RESULT_RECORDED: true,
  SUCCEEDED: true,
  TIMED_OUT: true,
  CANCELLING: true,
  ABANDONED: true,
});

/**
 * Trusted owning reads the composition supplies. `readContract`,
 * `readBinding`, `readRuntimeAdapterIdentity` and `readFinal` each mint and
 * revalidate their own target-bound SERVICE Decision; `revalidateAuthorization`
 * revalidates the Human, source, Contract and every used IG Decision before the
 * handler returns.
 */
export interface UsageProvenancePorts {
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readContract: (workOrderRef: CanonicalJsonObject) => Promise<{
    readonly workOrderRef: CanonicalJsonObject;
    readonly workOrderContract: CanonicalJsonObject;
    readonly contractRef: CanonicalJsonObject;
  }>;
  readonly readBinding: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  /** `undefined` when the owning read proves no committed identity exists yet. */
  readonly readRuntimeAdapterIdentity: (
    attemptRef: CanonicalJsonObject,
  ) => Promise<CanonicalJsonObject | undefined>;
  /** `undefined` when the owning read proves no committed final exists yet. */
  readonly readFinal: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject | undefined>;
}

interface UsageSnapshot {
  readonly run: Selectable<RunTable>;
  readonly claim: Selectable<RunFinalSubmissionClaimTable> | undefined;
  readonly result: Selectable<AgentResultTable> | undefined;
  readonly acceptance: Selectable<AgentResultAcceptanceTable> | undefined;
  readonly lateAudits: readonly Selectable<AuditRecordTable>[];
  readonly snapshotAt: Date;
}

/** The owning error code carried by a stable safe error, without trusting a shape. */
function errorCode(error: unknown): unknown {
  return error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
}

function ref(
  kind: string,
  type: string,
  id: string,
  subjectScope: CanonicalJsonObject,
  digest?: string,
) {
  return {
    kind,
    objectType: type,
    objectId: id,
    scope: subjectScope,
    ...(digest === undefined ? {} : { contentHash: hash(digest) }),
  };
}

function requireRef(
  value: CanonicalJsonObject,
  kind: string,
  type: string,
  subjectScope: CanonicalJsonObject,
): void {
  requireThat(
    value.kind === kind &&
      value.objectType === type &&
      typeof value.objectId === 'string' &&
      same(object(value.scope), subjectScope),
    'REFERENCE_INVALID',
  );
}

function dedupe(refs: readonly CanonicalJsonObject[]): CanonicalJsonObject[] {
  const seen = new Set<string>();
  const unique: CanonicalJsonObject[] = [];
  for (const value of refs) {
    const key = canonicalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function envelope(
  presence: 'PRESENT' | 'UNKNOWN' | 'UNAVAILABLE',
  reasonCode: UsageReasonCode | undefined,
  evidenceRefs: readonly CanonicalJsonObject[],
  value?: CanonicalJsonObject,
): CanonicalJsonObject {
  return {
    presence,
    ...(value === undefined ? {} : { value }),
    ...(reasonCode === undefined ? {} : { reasonCode }),
    evidenceRefs: [...evidenceRefs],
  };
}

function failInternal(): never {
  throw new CommandExecutionError(
    'INTERNAL_CONTRACT_VIOLATION',
    'TaskExecution usage provenance snapshot is internally inconsistent',
  );
}

function losslessVersion(value: string): number {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    return failInternal();
  }
  if (parsed < 0n || parsed > 9007199254740991n) return failInternal();
  return Number(parsed);
}

/**
 * Reads the one dedicated REPEATABLE READ TE snapshot and validates every
 * TaskExecution-local mirror the owning writers established. A missing Run
 * collapses to NOT_FOUND; a mirror that the owning module wrote inconsistently
 * is corruption and returns no data.
 */
async function readUsageSnapshot(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  runRef: CanonicalJsonObject,
  subjectScope: CanonicalJsonObject,
): Promise<UsageSnapshot> {
  const runId = textValue(runRef.objectId);
  return withTaskExecutionSnapshotTransaction(db, context, async (trx, snapshotAt) => {
    const run = await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirst();
    requireThat(run !== undefined, 'NOT_FOUND');
    requireThat(
      run.enterprise_id === subjectScope.enterpriseId && run.project_id === subjectScope.projectId,
      'NOT_FOUND',
    );
    const started = run.start_attempt_ref !== null;
    if (started) {
      const attemptRef = object(run.start_attempt_ref);
      const adapterRef = object(run.runtime_adapter_identity_ref);
      requireThat(
        run.started_at !== null &&
          run.status !== 'CREATED' &&
          run.status !== 'STARTING' &&
          attemptRef.objectType === ATTEMPT &&
          same(object(attemptRef.scope), subjectScope) &&
          adapterRef.objectType === ADAPTER_IDENTITY &&
          same(object(adapterRef.scope), subjectScope),
        'INTERNAL_CONTRACT_VIOLATION',
      );
    } else {
      requireThat(
        run.started_at === null &&
          run.runtime_adapter_identity_ref === null &&
          (run.status === 'CREATED' || run.status === 'STARTING'),
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }

    const claims = await trx
      .selectFrom('task_execution.run_final_submission_claim')
      .selectAll()
      .where('run_id', '=', run.run_id)
      .execute();
    requireThat(claims.length <= 1, 'INTERNAL_CONTRACT_VIOLATION');
    const results = await trx
      .selectFrom('task_execution.agent_result')
      .selectAll()
      .where('run_id', '=', run.run_id)
      .execute();
    requireThat(results.length <= 1, 'INTERNAL_CONTRACT_VIOLATION');
    const claim = claims[0];
    const result = results[0];
    const acceptances =
      result === undefined
        ? []
        : await trx
            .selectFrom('task_execution.agent_result_acceptance')
            .selectAll()
            .where('run_id', '=', run.run_id)
            .execute();
    requireThat(acceptances.length <= 1, 'INTERNAL_CONTRACT_VIOLATION');
    const acceptance = acceptances[0];

    if (claim !== undefined) {
      requireThat(
        claim.result_id === result?.result_id &&
          claim.enterprise_id === subjectScope.enterpriseId &&
          claim.project_id === subjectScope.projectId,
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }
    if (run.result_ref !== null) {
      requireThat(result !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
      requireThat(
        same(
          run.result_ref,
          ref(
            'CONTENT_ADDRESSED',
            RESULT,
            result.result_id,
            subjectScope,
            result.result_payload_hash.toString('hex'),
          ),
        ),
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }
    if (run.acceptance_ref !== null) {
      requireThat(acceptance !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
      requireThat(
        same(
          run.acceptance_ref,
          ref(
            'CONTENT_ADDRESSED',
            ACCEPTANCE,
            acceptance.acceptance_id,
            subjectScope,
            acceptance.payload_hash.toString('hex'),
          ),
        ),
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }
    if (result !== undefined) {
      const payload = object(result.result_payload);
      requireThat(
        result.enterprise_id === subjectScope.enterpriseId &&
          result.project_id === subjectScope.projectId &&
          result.run_id === run.run_id &&
          same(object(result.attempt_ref), object(run.start_attempt_ref)) &&
          same(object(result.adapter_identity_ref), object(run.runtime_adapter_identity_ref)) &&
          hashContractPayload(payload) === result.result_payload_hash.toString('hex') &&
          same(
            object(object(payload.header).payloadHash),
            hash(result.result_payload_hash.toString('hex')),
          ) &&
          same(object(payload.runRef), ref('OBJECT', RUN, run.run_id, subjectScope)),
        'INTERNAL_CONTRACT_VIOLATION',
      );
      if (claim !== undefined) {
        requireThat(
          same(object(claim.observation_ref), object(result.observation_ref)) &&
            claim.result_payload_hash.equals(result.result_payload_hash),
          'INTERNAL_CONTRACT_VIOLATION',
        );
      }
    }
    if (acceptance !== undefined) {
      requireThat(result !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
      const payload = object(acceptance.canonical_payload);
      requireThat(
        acceptance.result_id === result.result_id &&
          acceptance.enterprise_id === subjectScope.enterpriseId &&
          acceptance.project_id === subjectScope.projectId &&
          sha256CanonicalJson(payload) === acceptance.payload_hash.toString('hex') &&
          payload.disposition === 'ACCEPTED' &&
          same(
            object(payload.agentResultRef),
            ref(
              'CONTENT_ADDRESSED',
              RESULT,
              result.result_id,
              subjectScope,
              result.result_payload_hash.toString('hex'),
            ),
          ),
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }

    const lateAudits = await trx
      .selectFrom('task_execution.audit_record')
      .selectAll()
      .where('target_type', '=', RUN)
      .where('target_id', '=', run.run_id)
      .where('command_type', '=', LATE_COMMAND)
      .where('outcome', '=', 'REJECTED')
      .where('error_code', '=', LATE_ERROR)
      .execute();

    return { run, claim, result, acceptance, lateAudits, snapshotAt };
  });
}

/** The frozen runtime binding the owning create path derives from the Contract. */
function supportedRuntimeBinding(contract: CanonicalJsonObject): CanonicalJsonObject | undefined {
  const adapterRef = object(object(contract.versionPins).runtimeAdapterContractRef);
  const initial = resolveWorkOrderReadyProfile(adapterRef, 'te.human_operated.synthetic@1.0');
  const formal = resolveWorkOrderReadyProfile(adapterRef, 'te.human_operated.synthetic.formal@1.0');
  if (initial === undefined && formal === undefined) return undefined;
  return {
    adapterCode:
      formal === undefined ? 'te.human_operated.synthetic' : 'te.human_operated.synthetic.formal',
    adapterVersion: '1.0',
    harnessId: 'zhiju.runtime.synthetic',
    harnessVersion: '1.0',
    provider: 'synthetic',
    modelId: 'synthetic',
    modelConfigHash: hash(sha256CanonicalJson({})),
  };
}

/**
 * Reads Usage and execution Provenance for one supported Run.
 *
 * Returns the registered `execution.get_usage_and_provenance@1.0` result data,
 * or throws a stable safe code (`NOT_FOUND`, `REFERENCE_INVALID`,
 * `INTERNAL_CONTRACT_VIOLATION`, `EXECUTION_CRITERION_UNSUPPORTED`) with no
 * data. Cross-owner conflicts are reported inside the safe profile as
 * UNAVAILABLE evidence, never as PRESENT Usage.
 */
export async function handleGetUsageAndProvenance(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  runRef: CanonicalJsonObject,
  ports: UsageProvenancePorts,
): Promise<CanonicalJsonObject> {
  await ports.revalidateAuthorization();
  const subjectScope = object(runRef.scope);
  requireRef(runRef, 'OBJECT', RUN, subjectScope);
  const snapshot = await readUsageSnapshot(db, context, runRef, subjectScope);
  const { run, claim, result, acceptance } = snapshot;

  // The frozen Contract bounds the supported Runtime/profile selector.
  const contract = await ports.readContract(object(run.work_order_ref));
  requireThat(
    same(contract.workOrderRef, object(run.work_order_ref)) &&
      same(contract.contractRef, object(run.work_order_contract_ref)),
    'SOURCE_CONFLICT',
  );
  const expectedRuntimeBinding = supportedRuntimeBinding(object(contract.workOrderContract));
  requireThat(expectedRuntimeBinding !== undefined, 'EXECUTION_CRITERION_UNSUPPORTED');
  requireThat(
    same(object(run.runtime_binding), expectedRuntimeBinding),
    'EXECUTION_CRITERION_UNSUPPORTED',
  );

  const started = run.start_attempt_ref !== null;
  const attemptRef = started ? object(run.start_attempt_ref) : undefined;
  const adapterRef = started ? object(run.runtime_adapter_identity_ref) : undefined;

  let conflict = false;
  let binding: CanonicalJsonObject | undefined;
  let identity: CanonicalJsonObject | undefined;
  let final: CanonicalJsonObject | undefined;
  if (attemptRef !== undefined && adapterRef !== undefined) {
    try {
      binding = await ports.readBinding(attemptRef);
    } catch (error) {
      if (errorCode(error) === 'INTEGRATION_RUNTIME_ATTEMPT_NOT_FOUND') conflict = true;
      else throw error;
    }
    if (binding !== undefined && !conflict) {
      const invocation = object(binding.invocationBinding);
      const acknowledgement =
        binding.acknowledgement === undefined ? undefined : object(binding.acknowledgement);
      conflict =
        binding.status !== 'SUCCEEDED' ||
        acknowledgement?.source !== 'SYNTHETIC_DRIVER' ||
        !same(binding.attemptRef, attemptRef) ||
        !same(invocation.runRef, runRef) ||
        !same(invocation.workOrderContractRef, object(run.work_order_contract_ref)) ||
        !same(invocation.contextSnapshotRef, object(run.context_snapshot_ref)) ||
        !same(invocation.capabilityGrantRef, object(run.capability_grant_ref)) ||
        !same(invocation.runtimeBinding, object(run.runtime_binding)) ||
        invocation.leaseId !== run.lease_id ||
        typeof invocation.fencingToken !== 'number' ||
        invocation.fencingToken !== Number(run.fencing_token) ||
        invocation.leaseExpiresAt !== run.lease_expires_at.toISOString();
    }
    if (!conflict) {
      identity = await ports.readRuntimeAdapterIdentity(attemptRef);
      conflict =
        identity === undefined ||
        binding === undefined ||
        !same(identity.runtimeAdapterIdentityRef, adapterRef) ||
        !same(identity.attemptRef, attemptRef) ||
        !same(identity.runRef, runRef) ||
        !same(identity.runtimeBinding, object(run.runtime_binding)) ||
        !same(identity.bindingHash, binding.bindingHash) ||
        identity.ackObservationId !== textValue(object(binding.acknowledgement).observationId);
    }
    if (!conflict) {
      try {
        final = await ports.readFinal(attemptRef);
      } catch (error) {
        if (errorCode(error) === 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND') final = undefined;
        else throw error;
      }
    }
  }
  const finalObserved = final !== undefined;
  const lateAudits = snapshot.lateAudits;
  if (lateAudits.length > 0 && !finalObserved) conflict = true;
  if (!finalObserved && (claim !== undefined || result !== undefined || acceptance !== undefined)) {
    conflict = true;
  }

  const matchingLate =
    final !== undefined
      ? lateAudits.find((audit) => {
          const runtimeRef = object(audit.runtime_ref);
          return (
            same(object(runtimeRef.observationRef), object(final.observationRef)) &&
            same(object(runtimeRef.attemptRef), object(final.attemptRef)) &&
            same(object(runtimeRef.bindingHash), object(final.bindingHash)) &&
            audit.result_payload_hash?.toString('hex') ===
              textValue(object(final.resultPayloadHash).digest)
          );
        })
      : undefined;

  const accepted = acceptance !== undefined && result !== undefined;

  // ---- attemptEvidence -------------------------------------------------
  let attemptEvidence: CanonicalJsonObject;
  if (!started) {
    attemptEvidence = envelope('UNKNOWN', 'SOURCE_NOT_OBSERVED', []);
  } else if (conflict || attemptRef === undefined || adapterRef === undefined) {
    attemptEvidence = envelope('UNAVAILABLE', 'SOURCE_CONFLICT', []);
  } else {
    requireThat(binding !== undefined && identity !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
    const acknowledgement = object(binding.acknowledgement);
    const attemptValue: CanonicalJsonObject = {
      attemptRef,
      bindingHash: object(binding.bindingHash),
      ackObservationId: textValue(acknowledgement.observationId),
      runtimeAdapterIdentityRef: adapterRef,
      source: 'SYNTHETIC_DRIVER',
      ...(final === undefined
        ? {}
        : {
            observationRef: object(final.observationRef),
            resultPayloadHash: object(final.resultPayloadHash),
          }),
    };
    attemptEvidence = envelope(
      'PRESENT',
      undefined,
      dedupe([
        attemptRef,
        object(acknowledgement.rawReceiptRef),
        adapterRef,
        ...(final === undefined ? [] : [object(final.observationRef)]),
      ]),
      attemptValue,
    );
  }

  // ---- resultEvidence --------------------------------------------------
  let resultEvidence: CanonicalJsonObject;
  if (conflict) {
    resultEvidence = envelope('UNAVAILABLE', 'SOURCE_CONFLICT', []);
  } else if (accepted) {
    const observationRef =
      final === undefined ? object(result.observation_ref) : object(final.observationRef);
    resultEvidence = envelope(
      'PRESENT',
      undefined,
      dedupe([
        ref(
          'CONTENT_ADDRESSED',
          RESULT,
          result.result_id,
          subjectScope,
          result.result_payload_hash.toString('hex'),
        ),
        ref(
          'CONTENT_ADDRESSED',
          ACCEPTANCE,
          acceptance.acceptance_id,
          subjectScope,
          acceptance.payload_hash.toString('hex'),
        ),
        observationRef,
      ]),
      {
        agentResultRef: ref(
          'CONTENT_ADDRESSED',
          RESULT,
          result.result_id,
          subjectScope,
          result.result_payload_hash.toString('hex'),
        ),
        acceptanceRecordRef: ref(
          'CONTENT_ADDRESSED',
          ACCEPTANCE,
          acceptance.acceptance_id,
          subjectScope,
          acceptance.payload_hash.toString('hex'),
        ),
        resultPayloadHash: hash(result.result_payload_hash.toString('hex')),
      },
    );
  } else if (matchingLate !== undefined && final !== undefined) {
    resultEvidence = envelope('UNKNOWN', 'LATE_RESULT', [object(final.observationRef)]);
  } else if (finalObserved) {
    resultEvidence = envelope('UNKNOWN', 'RESULT_NOT_ACCEPTED', []);
  } else {
    resultEvidence = envelope('UNKNOWN', 'SOURCE_NOT_OBSERVED', []);
  }

  // ---- agentDeclaredUsage ---------------------------------------------
  let agentDeclaredUsage: CanonicalJsonObject;
  let authoritativeSource: string;
  let reconciliationStatus: string;
  if (conflict) {
    agentDeclaredUsage = envelope('UNAVAILABLE', 'SOURCE_CONFLICT', []);
    authoritativeSource = 'UNAVAILABLE';
    reconciliationStatus = 'execution.usage.source_conflict';
  } else if (accepted) {
    const evidenceRefs = dedupe([
      ref(
        'CONTENT_ADDRESSED',
        RESULT,
        result.result_id,
        subjectScope,
        result.result_payload_hash.toString('hex'),
      ),
      ref(
        'CONTENT_ADDRESSED',
        ACCEPTANCE,
        acceptance.acceptance_id,
        subjectScope,
        acceptance.payload_hash.toString('hex'),
      ),
    ]);
    const declared = object(result.result_payload).agentDeclaredUsage;
    const declaredObject = declared === undefined ? undefined : object(declared);
    if (
      declaredObject !== undefined &&
      MEASUREMENT_FIELDS.some((field) => declaredObject[field] !== undefined)
    ) {
      agentDeclaredUsage = envelope('PRESENT', undefined, evidenceRefs, declaredObject);
      authoritativeSource = 'AGENT_DECLARED';
      reconciliationStatus = 'execution.usage.agent_declared_only';
    } else {
      agentDeclaredUsage = envelope('UNKNOWN', 'USAGE_NOT_DECLARED', evidenceRefs);
      authoritativeSource = 'UNAVAILABLE';
      reconciliationStatus = 'execution.usage.unavailable';
    }
  } else if (matchingLate !== undefined) {
    agentDeclaredUsage = envelope('UNKNOWN', 'LATE_RESULT', []);
    authoritativeSource = 'UNAVAILABLE';
    reconciliationStatus = 'execution.usage.unavailable';
  } else if (finalObserved) {
    agentDeclaredUsage = envelope('UNKNOWN', 'RESULT_NOT_ACCEPTED', []);
    authoritativeSource = 'UNAVAILABLE';
    reconciliationStatus = 'execution.usage.unavailable';
  } else {
    agentDeclaredUsage = envelope('UNKNOWN', 'SOURCE_NOT_OBSERVED', []);
    authoritativeSource = 'UNAVAILABLE';
    reconciliationStatus = 'execution.usage.unavailable';
  }

  const provenance: CanonicalJsonObject = {
    profile: USAGE_PROVENANCE_PROFILE,
    runRef,
    aggregateVersion: losslessVersion(run.aggregate_version),
    runStatus: run.status,
    snapshotAt: snapshot.snapshotAt.toISOString(),
    workOrderContractRef: object(run.work_order_contract_ref),
    contextSnapshotRef: object(run.context_snapshot_ref),
    capabilityGrantRef: object(run.capability_grant_ref),
    runtimeBinding: object(run.runtime_binding),
    attemptEvidence,
    resultEvidence,
  };

  const resultPayload: CanonicalJsonObject = {
    runRef,
    agentDeclaredUsage,
    authoritativeSource,
    provenance,
    reconciliationStatus,
  };
  requireThat(
    registry.validateOperationResult(GET_USAGE_AND_PROVENANCE_QUERY, '1.0', resultPayload).valid,
    'INTERNAL_CONTRACT_VIOLATION',
  );
  validateUsageSafetyProfile(resultPayload, runRef);
  await ports.revalidateAuthorization();
  return resultPayload;
}

/**
 * The closed `execution.provenance.human_operated.v1` safety profile. The
 * public `provenance` member is CanonicalJson, so this validator is the
 * authoritative closure of its shape: required top-level fields, the exact
 * seven-field runtime binding, the two ValueEnvelopes with the paired-optional
 * observation rule, the closed agentDeclaredUsage declaration and no
 * `runtimeUsageRef` on any path.
 */
export function validateUsageSafetyProfile(
  result: CanonicalJsonObject,
  runRef: CanonicalJsonObject,
): void {
  requireThat(result.runtimeUsageRef === undefined, 'INTERNAL_CONTRACT_VIOLATION');
  requireThat(
    result.authoritativeSource === 'AGENT_DECLARED' || result.authoritativeSource === 'UNAVAILABLE',
    'INTERNAL_CONTRACT_VIOLATION',
  );
  requireThat(
    result.reconciliationStatus === 'execution.usage.agent_declared_only' ||
      result.reconciliationStatus === 'execution.usage.unavailable' ||
      result.reconciliationStatus === 'execution.usage.source_conflict',
    'INTERNAL_CONTRACT_VIOLATION',
  );
  validateUsageEnvelope(object(result.agentDeclaredUsage), true);

  const provenance = object(result.provenance);
  requireThat(
    same(Object.keys(provenance).sort(), [
      'aggregateVersion',
      'attemptEvidence',
      'capabilityGrantRef',
      'contextSnapshotRef',
      'profile',
      'resultEvidence',
      'runRef',
      'runStatus',
      'runtimeBinding',
      'snapshotAt',
      'workOrderContractRef',
    ]),
    'INTERNAL_CONTRACT_VIOLATION',
  );
  requireThat(
    provenance.profile === USAGE_PROVENANCE_PROFILE &&
      same(provenance.runRef, runRef) &&
      typeof provenance.aggregateVersion === 'number' &&
      Number.isSafeInteger(provenance.aggregateVersion) &&
      provenance.aggregateVersion >= 0 &&
      RUN_STATUSES[textValue(provenance.runStatus)] === true &&
      typeof provenance.snapshotAt === 'string' &&
      Number.isFinite(Date.parse(provenance.snapshotAt)),
    'INTERNAL_CONTRACT_VIOLATION',
  );
  for (const member of ['workOrderContractRef', 'contextSnapshotRef', 'capabilityGrantRef']) {
    requireThat(
      typeof object(provenance[member]).objectType === 'string',
      'INTERNAL_CONTRACT_VIOLATION',
    );
  }
  requireThat(
    same(Object.keys(object(provenance.runtimeBinding)).sort(), [
      'adapterCode',
      'adapterVersion',
      'harnessId',
      'harnessVersion',
      'modelConfigHash',
      'modelId',
      'provider',
    ]),
    'INTERNAL_CONTRACT_VIOLATION',
  );
  validateAttemptEvidence(object(provenance.attemptEvidence));
  validateUsageEnvelope(object(provenance.resultEvidence), false);
}

function validateAttemptEvidence(value: CanonicalJsonObject): void {
  const presence = textValue(value.presence);
  requireThat(
    presence === 'PRESENT' || presence === 'UNKNOWN' || presence === 'UNAVAILABLE',
    'INTERNAL_CONTRACT_VIOLATION',
  );
  if (presence !== 'PRESENT') {
    requireThat(value.value === undefined, 'INTERNAL_CONTRACT_VIOLATION');
    return;
  }
  const present = object(value.value);
  const withObservation = same(Object.keys(present).sort(), [
    'ackObservationId',
    'attemptRef',
    'bindingHash',
    'observationRef',
    'resultPayloadHash',
    'runtimeAdapterIdentityRef',
    'source',
  ]);
  const withoutObservation = same(Object.keys(present).sort(), [
    'ackObservationId',
    'attemptRef',
    'bindingHash',
    'runtimeAdapterIdentityRef',
    'source',
  ]);
  requireThat(withObservation || withoutObservation, 'INTERNAL_CONTRACT_VIOLATION');
  requireThat(
    present.source === 'SYNTHETIC_DRIVER' &&
      (present.observationRef === undefined) === (present.resultPayloadHash === undefined),
    'INTERNAL_CONTRACT_VIOLATION',
  );
}

function validateUsageEnvelope(value: CanonicalJsonObject, declaration: boolean): void {
  const presence = textValue(value.presence);
  requireThat(
    presence === 'PRESENT' || presence === 'UNKNOWN' || presence === 'UNAVAILABLE',
    'INTERNAL_CONTRACT_VIOLATION',
  );
  requireThat(Array.isArray(value.evidenceRefs), 'INTERNAL_CONTRACT_VIOLATION');
  if (presence !== 'PRESENT') {
    requireThat(value.value === undefined, 'INTERNAL_CONTRACT_VIOLATION');
    return;
  }
  const present = object(value.value);
  if (!declaration) {
    requireThat(
      present.agentResultRef !== undefined &&
        present.acceptanceRecordRef !== undefined &&
        present.resultPayloadHash !== undefined,
      'INTERNAL_CONTRACT_VIOLATION',
    );
    return;
  }
  requireThat(
    present.measurementSource === 'AGENT_DECLARED' &&
      Object.keys(present).every((key) =>
        [...MEASUREMENT_FIELDS, 'measurementSource'].includes(key),
      ) &&
      MEASUREMENT_FIELDS.some((field) => present[field] !== undefined),
    'INTERNAL_CONTRACT_VIOLATION',
  );
  for (const field of ['inputTokens', 'outputTokens', 'reasoningTokens', 'toolCalls'] as const) {
    const amount = present[field];
    if (amount !== undefined) {
      requireThat(
        typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0,
        'INTERNAL_CONTRACT_VIOLATION',
      );
    }
  }
  if (present.estimatedCost !== undefined) {
    const cost = object(present.estimatedCost);
    requireThat(
      typeof cost.amountDecimal === 'string' &&
        typeof cost.currency === 'string' &&
        same(Object.keys(cost).sort(), ['amountDecimal', 'currency']),
      'INTERNAL_CONTRACT_VIOLATION',
    );
  }
}
