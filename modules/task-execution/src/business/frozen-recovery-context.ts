import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ContractRegistry } from '@zhiju/contracts';
import {
  canonicalize,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  executeTaskExecutionCommand,
  CommandExecutionError,
  type CommandEnvelope,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  assembleInitialContext,
  deriveContextItemId,
  type InitialContextAssemblyPolicy,
  type InitialContextAssemblySlice,
} from './initial-context-assembly.js';
import {
  object,
  requireThat,
  same,
  textValue,
  hash,
  digest,
} from './work-order-validation-plan.js';
import {
  canonicalSet,
  appendRecoveryEdges,
  appendRecoveryEvent,
  insertRecoveryCommandMaterial,
  readRecoveryBlockers,
  readRecoveryResolution,
  recoveryControls,
  recoveryGuard,
  recoveryRef,
  recoveryScope,
  type RecoveryPorts,
} from './blocked-input-recovery.js';

const registry = new ContractRegistry();
export interface FrozenRecoveryContextPorts extends RecoveryPorts {
  readonly resolveBuilder: (ref: CanonicalJsonObject) => Promise<InitialContextAssemblyPolicy>;
  readonly readSlice: (
    ref: CanonicalJsonObject,
  ) => Promise<{ slice: CanonicalJsonObject; useStatus: string; checkedAt: string }>;
}
export async function handleBuildFrozenRecoveryContext(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: FrozenRecoveryContextPorts,
) {
  requireThat(
    env.commandType === 'execution.build_context_snapshot' &&
      env.commandVersion === '1.1' &&
      env.targetType === 'zhiju.execution.context_snapshot' &&
      env.principalKind === 'SERVICE',
  );
  const scope = recoveryScope(env),
    request = object(env.requestPayload.request),
    woRef = object(request.workOrderRef);
  requireThat(same(woRef.scope, scope) && woRef.objectType === 'zhiju.execution.work_order');
  const answered = request.answeredInformationRefs;
  requireThat(
    Array.isArray(answered) && answered.length === 1,
    'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
  );
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      const deps = await recoveryControls(ex.trx, textValue(woRef.objectId), ports);
      await ex.trx
        .selectFrom('task_execution.task')
        .selectAll()
        .where('task_id', '=', deps.root.task_id)
        .forUpdate()
        .executeTakeFirst();
      const root = await ex.trx
        .selectFrom('task_execution.work_order')
        .selectAll()
        .where('work_order_id', '=', deps.root.work_order_id)
        .forUpdate()
        .executeTakeFirst();
      requireThat(
        root && ['WAITING_INPUT', 'RETRY_PENDING'].includes(root.status),
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      const blockers = await readRecoveryBlockers(ex.trx, root.work_order_id, scope);
      requireThat(
        !blockers.unresolved && same(answered, blockers.resolutionRefs),
        'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
      );
      const proof = await readRecoveryResolution(ex.trx, object(answered[0]), ports);
      await sql`SELECT request_id FROM task_execution.information_request WHERE work_order_id=${root.work_order_id} ORDER BY request_id FOR UPDATE`.execute(
        ex.trx,
      );
      requireThat(
        same(request.workOrderContractRef, deps.contractRef),
        'EXECUTION_CONTEXT_TARGET_INVALID',
      );
      const claim = await ex.trx
        .selectFrom('task_execution.work_order_run_claim')
        .select('run_id')
        .where('work_order_id', '=', root.work_order_id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();
      requireThat(!claim, 'EXECUTION_ACTIVE_RUN_EXISTS');
      const firstRef = object(deps.contract.contextSnapshotRef);
      await ports.authorizeLocalRead(
        'context',
        recoveryRef('zhiju.execution.context_snapshot', textValue(firstRef.objectId), scope),
        { contextSnapshotRef: firstRef },
      );
      const initial = await ex.trx
        .selectFrom('task_execution.context_snapshot_build')
        .selectAll()
        .where('snapshot_id', '=', textValue(firstRef.snapshotId))
        .executeTakeFirst();
      requireThat(initial);
      const binding = object(initial.canonical_payload);
      for (const key of ['purpose', 'builderPolicyRef'])
        requireThat(same(request[key], binding[key]), 'EXECUTION_CONTEXT_TARGET_INVALID');
      const initialSnapshot = await ex.trx
        .selectFrom('task_execution.context_snapshot')
        .selectAll()
        .where('snapshot_id', '=', textValue(firstRef.snapshotId))
        .executeTakeFirst();
      requireThat(
        initialSnapshot &&
          object(object(initialSnapshot.canonical_payload).projection).projectionType ===
            request.projectionType,
      );
      const policy = await ports.resolveBuilder(object(request.builderPolicyRef));
      requireThat(
        same(policy.resolvedRef, request.builderPolicyRef),
        'EXECUTION_CONTEXT_TARGET_INVALID',
      );
      const refs = request.sourceSlices;
      requireThat(Array.isArray(refs) && refs.length > 0);
      const slices: InitialContextAssemblySlice[] = [];
      for (const r of refs) {
        const ref = object(r);
        const observation = await ports.readSlice(ref);
        requireThat(
          observation.useStatus === 'USABLE' &&
            Date.parse(textValue(observation.slice.capturedAt)) >=
              Date.parse(textValue(proof.resolution.effectiveAt)) &&
            same(ref.scope, scope) &&
            sha256CanonicalJson(observation.slice) === digest(ref.contentHash),
          'EXECUTION_CONTEXT_SOURCE_INVALID',
        );
        slices.push({ ref, slice: observation.slice });
      }
      const validUntil = Math.min(
        ports.validUntil().getTime(),
        proof.request.expires_at.getTime(),
        Date.parse(textValue(proof.human.validUntil)),
        root.expires_at?.getTime() ?? Infinity,
        policy.supersededAt === undefined ? Infinity : Date.parse(policy.supersededAt),
        ...slices.map((s) => Date.parse(textValue(s.slice.validUntil))),
      );
      requireThat(
        Number.isFinite(validUntil) && validUntil > ports.now().getTime(),
        'EXECUTION_CONTEXT_SOURCE_INVALID',
      );
      if (request.expiresAt !== undefined)
        requireThat(
          Date.parse(textValue(request.expiresAt)) <= validUntil,
          'EXECUTION_CONTEXT_SOURCE_INVALID',
        );
      const expiresAt =
        request.expiresAt === undefined
          ? new Date(validUntil).toISOString()
          : textValue(request.expiresAt);
      const snapshotId = newUuidV7(),
        asOf = ports.now().toISOString();
      const audience = object(binding.audience);
      requireThat(
        same(
          request.audience,
          recoveryRef('zhiju.identity.principal', textValue(audience.principalId), scope),
        ),
        'EXECUTION_CONTEXT_TARGET_INVALID',
      );
      const built = assembleInitialContext({
        request: {
          draftSnapshotRef: deps.contractRef,
          projectionType: textValue(request.projectionType),
          purpose: textValue(request.purpose),
          audience: {
            principalId: textValue(audience.principalId),
            principalKind: textValue(audience.principalKind),
          },
          builderPolicyRef: object(request.builderPolicyRef),
          expiresAt,
        },
        draft: {
          workOrderRef: woRef,
          taskRef: object(deps.contract.taskRef),
          scopeRef: scope,
          // Frozen inputs remain pinned in Contract/Context-1. This projection
          // consumes the exact fresh slices named by the recovery request;
          // initial DRAFT slice adoption must not re-adopt historical captures.
          draft: { ...deps.contract, inputRefs: [] },
          expiresAt,
        },
        slices,
        policy,
        snapshotId,
        asOf,
        correlationId: env.correlationId,
        causationId: env.commandId,
        issuedBy: { principalId: env.principalId, principalKind: env.principalKind },
      });
      if (built.outcome === 'REJECTED')
        throw new CommandExecutionError(built.errorCode, built.safeSummary);
      const payload = built.payload as Record<string, CanonicalJsonValue>,
        metadata = built.metadata as Record<string, CanonicalJsonValue>;
      const effectiveExpiresAt = textValue(metadata.effectiveExpiresAt);
      if (request.expiresAt === undefined) delete metadata.requestExpiresAt;
      const content = object(proof.answer.answerContent);
      const item: Record<string, CanonicalJsonValue> = {
        kind: 'MATERIAL',
        subjectRef: definedValue(content.confirmedMaterialRef),
        epistemicState: 'CONFIRMED',
        value: { presence: 'PRESENT', value: content, evidenceRefs: [] },
        evidenceRefs: [],
        provenanceRefs: canonicalSet([
          answered[0] as CanonicalJsonValue,
          object(proof.resolution.acceptedAnswerRef),
          ...(proof.resolution.domainCommandRefs as CanonicalJsonValue[]),
          definedValue(proof.attestation.decisionRef),
          ...(proof.answer.sourceRefs as CanonicalJsonValue[]),
        ]),
        recordedTime: definedValue(proof.resolution.effectiveAt),
        permittedUses: [definedValue(request.purpose)],
        sensitivity: 'CUSTOMER_CONFIDENTIAL',
      };
      item.contextItemId = deriveContextItemId(
        Date.parse(asOf),
        canonicalize(item),
        textValue(object(answered[0]).objectId),
        0,
      );
      requireThat(Array.isArray(payload.contextItems));
      payload.contextItems.push(item);
      (payload.workContext as Record<string, CanonicalJsonValue>).informationRequestRefs =
        blockers.requestRefs;
      metadata.buildKind = 'FROZEN';
      delete metadata.draftSnapshotRef;
      metadata.frozenContractRef = deps.contractRef;
      metadata.recovery = {
        previousRunRef: definedValue(proof.resolution.previousRunRef),
        sourceAgentResultRef: definedValue(proof.resolution.sourceAgentResultRef),
        sourceAcceptanceRef: definedValue(proof.resolution.sourceAcceptanceRef),
        resolutionRefs: answered as CanonicalJsonValue[],
        answerRefs: [definedValue(proof.resolution.acceptedAnswerRef)],
        receiptRefs: definedValue(proof.resolution.domainCommandRefs),
        receiptObservationHashes: [definedValue(proof.resolution.receiptAttestationHash)],
        requestAggregateVersions: [
          {
            informationRequestRef: recoveryRef(
              'execution.information_request',
              proof.request.request_id,
              scope,
            ),
            aggregateVersion: Number(proof.request.aggregate_version),
          },
        ],
        sourceWatermarks: definedValue(payload.sourceWatermarks),
      };
      const validation = registry.validateCoreContract(
        'https://schemas.zhiju.local/core/project-context/1.0',
        payload,
      );
      if (!validation.valid)
        throw new CommandExecutionError(
          'API_VALUE_INVALID',
          validation.errors.map((error) => `${error.instancePath}: ${error.keyword}`).join('; '),
        );
      await recoveryGuard(ports);
      await insertRecoveryCommandMaterial(ex, env);
      await sql`INSERT INTO task_execution.context_snapshot(snapshot_id,object_id,purpose,audience,enterprise_id,project_id,builder_version,policy_snapshot_id,source_manifest_count,context_item_count,omission_count,redaction_count,coverage_state,payload_hash,canonicalization_version,payload_hash_algorithm,expires_at,effective_expires_at,request_payload_hash,source_command_id,created_by_principal_id,canonical_payload)
  VALUES(${snapshotId},${env.targetId},${request.purpose},${audience.principalId},${env.enterpriseId},${env.projectId},'1.1',${object(request.builderPolicyRef).versionId},${Object.values(object(payload.sourceManifest)).reduce<number>((sum, v) => sum + (Array.isArray(v) ? v.length : 1), 0)},${payload.contextItems.length},${(payload.omissions as CanonicalJsonValue[]).length},${(payload.redactions as CanonicalJsonValue[]).length},${object(payload.coverage).completeness},${Buffer.from(sha256CanonicalJson(payload), 'hex')},'1','SHA-256',${effectiveExpiresAt}::timestamptz,${effectiveExpiresAt}::timestamptz,${Buffer.from(sha256CanonicalJson(env.requestPayload), 'hex')},${env.commandId},${env.principalId},${canonicalize(payload)}::jsonb)`.execute(
        ex.trx,
      );
      await sql`INSERT INTO task_execution.context_snapshot_build(snapshot_id,build_kind,draft_snapshot_ref,frozen_contract_ref,slice_refs,purpose,audience,builder_policy_ref,policy_content_hash,policy_effective_from,policy_superseded_at,request_expires_at,effective_expires_at,canonical_payload,payload_hash,request_payload_hash,source_command_id,enterprise_id,project_id,created_by_principal_id)
  VALUES(${snapshotId},'FROZEN',NULL,${canonicalize(deps.contractRef)}::jsonb,${canonicalize(definedValue(metadata.sliceRefs))}::jsonb,${request.purpose},${canonicalize(audience)}::jsonb,${canonicalize(object(request.builderPolicyRef))}::jsonb,${Buffer.from(policy.contentHashDigest, 'hex')},${policy.effectiveFrom}::timestamptz,${policy.supersededAt ?? null}::timestamptz,${metadata.requestExpiresAt ?? null}::timestamptz,${effectiveExpiresAt}::timestamptz,${canonicalize(metadata)}::jsonb,${Buffer.from(sha256CanonicalJson(metadata), 'hex')},${Buffer.from(sha256CanonicalJson(env.requestPayload), 'hex')},${env.commandId},${env.enterpriseId},${env.projectId},${env.principalId})`.execute(
        ex.trx,
      );
      const contextSnapshotRef = {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.execution.context_snapshot',
        objectId: env.targetId,
        snapshotId,
        scope,
        contentHash: hash(sha256CanonicalJson(payload)),
      };
      await appendRecoveryEdges(ex, env, metadata, 'context-build');
      await appendRecoveryEvent(
        ex,
        env,
        'execution.ContextSnapshotBuilt',
        {
          contextSnapshotRef,
          workOrderRef: woRef,
          projectionType: definedValue(request.projectionType),
          coverageStatus: definedValue(object(payload.coverage).completeness),
        },
        '1',
        new Date(asOf),
        { eventVersion: '1.1', aggregateType: 'zhiju.execution.context_snapshot' },
      );
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return { kind: 'COMMITTED' as const, resultPayload: { contextSnapshotRef } };
    },
    () => recoveryGuard(ports),
  );
}

export async function readFrozenContextEligibility(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  contextSnapshotRef: CanonicalJsonObject,
  workOrderContractRef: CanonicalJsonObject,
  ports: FrozenRecoveryContextPorts,
) {
  await recoveryGuard(ports);
  const result = await withTaskExecutionTransaction(db, context, async (trx) => {
    const snapshot = await trx
      .selectFrom('task_execution.context_snapshot')
      .selectAll()
      .where('snapshot_id', '=', textValue(contextSnapshotRef.snapshotId))
      .executeTakeFirst();
    const build = await trx
      .selectFrom('task_execution.context_snapshot_build')
      .selectAll()
      .where('snapshot_id', '=', textValue(contextSnapshotRef.snapshotId))
      .executeTakeFirst();
    requireThat(
      snapshot &&
        build?.build_kind === 'FROZEN' &&
        snapshot.object_id === contextSnapshotRef.objectId &&
        snapshot.payload_hash.toString('hex') === digest(contextSnapshotRef.contentHash) &&
        same(build.frozen_contract_ref, workOrderContractRef),
      'EXECUTION_CONTEXT_SOURCE_INVALID',
    );
    requireThat(
      sha256CanonicalJson(object(snapshot.canonical_payload)) ===
        snapshot.payload_hash.toString('hex') &&
        sha256CanonicalJson(object(build.canonical_payload)) === build.payload_hash.toString('hex'),
      'EXECUTION_CONTEXT_SOURCE_INVALID',
    );
    const metadata = object(build.canonical_payload),
      recovery = object(metadata.recovery);
    const resolutions = recovery.resolutionRefs;
    requireThat(Array.isArray(resolutions) && resolutions.length === 1);
    const proof = await readRecoveryResolution(trx, object(resolutions[0]), ports);
    const deps = await recoveryControls(trx, proof.request.work_order_id, ports);
    const blockers = await readRecoveryBlockers(
      trx,
      proof.request.work_order_id,
      object(contextSnapshotRef.scope),
    );
    requireThat(
      !blockers.unresolved &&
        same(blockers.resolutionRefs, resolutions) &&
        same(deps.contractRef, workOrderContractRef) &&
        same(contextSnapshotRef.scope, {
          enterpriseId: snapshot.enterprise_id,
          projectId: snapshot.project_id,
        }),
      'EXECUTION_CONTEXT_SOURCE_INVALID',
    );
    const policy = await ports.resolveBuilder(object(metadata.builderPolicyRef));
    requireThat(
      same(policy.resolvedRef, metadata.builderPolicyRef) &&
        policy.contentHashDigest === build.policy_content_hash.toString('hex'),
      'EXECUTION_CONTEXT_SOURCE_INVALID',
    );
    const slices = metadata.sliceRefs;
    requireThat(Array.isArray(slices));
    const sliceExpiries: number[] = [];
    let useStatus = 'USABLE';
    for (const ref of slices) {
      const observed = await ports.readSlice(object(ref));
      requireThat(
        sha256CanonicalJson(observed.slice) === digest(object(ref).contentHash),
        'EXECUTION_CONTEXT_SOURCE_INVALID',
      );
      requireThat(
        ['USABLE', 'STALE', 'EXPIRED', 'REVOKED'].includes(observed.useStatus),
        'DEPENDENCY_UNAVAILABLE',
      );
      const priority = ['USABLE', 'STALE', 'EXPIRED', 'REVOKED'];
      if (priority.indexOf(observed.useStatus) > priority.indexOf(useStatus))
        useStatus = observed.useStatus;
      sliceExpiries.push(Date.parse(textValue(observed.slice.validUntil)));
    }
    const validUntil = Math.min(
      proof.request.expires_at.getTime(),
      ...sliceExpiries,
      policy.supersededAt === undefined ? Infinity : Date.parse(policy.supersededAt),
      snapshot.effective_expires_at?.getTime() ?? 0,
      ports.validUntil().getTime(),
      Date.parse(textValue(proof.human.validUntil)),
    );
    return {
      contextSnapshotRef,
      workOrderContractRef,
      previousRunRef: definedValue(recovery.previousRunRef),
      resolutionRefs: resolutions,
      validUntil: new Date(validUntil).toISOString(),
      useStatus:
        useStatus === 'REVOKED' || validUntil > ports.now().getTime() ? useStatus : 'EXPIRED',
    };
  });
  await recoveryGuard(ports);
  return result;
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
