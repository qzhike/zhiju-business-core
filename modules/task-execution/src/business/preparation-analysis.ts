/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Revalidate persisted and cross-owner data. */
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  ContractRegistry,
  operationPayloadSchemaRef,
  PreparationError,
  preparationHash as hash,
  samePreparationValue as same,
  assertPreparationCommand,
  PREPARATION_CONTEXT_SCHEMA,
  PREPARATION_WORK_ORDER_SCHEMA,
  RUNNER_ANALYSIS_REPORT_SCHEMA_ID,
  RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
  type Common,
  type PreparationSession,
  type PreparationAuthorizationProof,
  type WorkspaceCommandInput,
  type PreparationAnalysisTaskPayload,
  type PreparationAnalysisRequestPayload,
  type PreparationAnalysisBasisPayload,
  type PreparationAnalysisRuntimePort,
  type LocalAnalysisPackage,
  type LocalAnalysisOutput,
  type LocalAnalysisSource,
  type PreparationExecutionProgress,
  type PreparationTaskCreated,
  type PreparationAnalysisRequested,
  type PreparationResultContent,
  type PreparationReportAcceptancePayload,
} from '@zhiju/contracts';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  type TaskExecutionTransaction,
} from '../persistence/task-execution-db.js';
import {
  executeTaskExecutionCommand,
  type CommandExecution,
} from '../persistence/command-runner.js';

type Ref = Common.ObjectRef;
type Hash = Common.ContentHash;
type Json = Record<string, unknown>;
export interface PreparationSourceObservation {
  preparationSourceRef: Common.SnapshotRef;
  payload: {
    profile: 'ep.preparation_source@2.0';
    projectRef: Ref;
    intakeManifestRef: Common.SnapshotRef;
    analysisBasisRef: Common.VersionedRef;
    analysisBasisHash: Hash;
    analysisBasisPublicationRef: Common.ContentAddressedRef;
    templateRefs: Common.ContentAddressedRef[];
    purpose: 'preparation.analysis';
    audience: Ref;
    sources: {
      sourceRef: Common.ContentAddressedRef;
      bytesSha256: string;
      byteLength: number;
      objectRef: string;
      role?: 'CUSTOMER_NOTE';
    }[];
    validUntil: string;
  };
  basis: PreparationAnalysisBasisPayload;
  analysisProfileRef: Common.VersionedRef;
  expectedReportProfileRef: Common.VersionedRef;
}
export interface PreparationAnalysisConfig {
  db: Kysely<TaskExecutionDb>;
  runtime: PreparationAnalysisRuntimePort;
  authorize(
    session: PreparationSession,
    purpose: string,
    target: Ref,
    payload: unknown,
  ): Promise<PreparationAuthorizationProof>;
  check(
    proof: PreparationAuthorizationProof,
    purpose: string,
    target: Ref,
    payload: unknown,
  ): Promise<void>;
  source(
    session: PreparationSession,
    ref: Common.SnapshotRef,
  ): Promise<PreparationSourceObservation>;
  materialize(
    session: PreparationSession,
    source: PreparationSourceObservation,
  ): Promise<{
    instructions: { sha256: string; bytes: Uint8Array };
    sources: LocalAnalysisSource[];
  }>;
  serviceSession(): Promise<PreparationSession>;
  onAccepted(
    session: PreparationSession,
    command: WorkspaceCommandInput<PreparationReportAcceptancePayload>,
  ): Promise<void>;
  onError?: (error: unknown) => void;
  clock?: () => Date;
}
interface RequestRow {
  request_id: string;
  enterprise_id: string;
  project_id: string;
  task_id: string;
  source_ref: Common.SnapshotRef;
  request_payload: PreparationAnalysisRequestPayload;
  payload_hash: Buffer;
  original_command: WorkspaceCommandInput<PreparationAnalysisRequestPayload>;
  source_command_id: string;
  state: PreparationExecutionProgress['state'];
  revision: string;
  reason_codes: string[];
  deadline: Date;
  updated_at: Date;
  work_order_id: string;
  run_id: string;
  context_id: string;
  draft_id: string;
  contract_id: string;
  attempt_id: string;
  controls_id: string;
  readiness_id: string;
  validation_id: string;
  result_id: string;
  acceptance_id: string;
  worker_id: string | null;
  worker_lease: Date | null;
}
const PROFILE = 'PREPARATION_ANALYSIS',
  SELECTOR = 'te.preparation_analysis@1';
const registry = new ContractRegistry();
const json = (value: unknown) => value as CanonicalJsonObject;
const bytesHash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const digest = (s: unknown) => Buffer.from(hash(s).digest, 'hex');
const ref = (objectType: string, objectId: string, scope: Common.ScopeRef): Ref => ({
  kind: 'OBJECT',
  objectType,
  objectId,
  scope,
});
const content = (
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
  payload: unknown,
): Common.ContentAddressedRef => ({
  ...ref(objectType, objectId, scope),
  kind: 'CONTENT_ADDRESSED',
  contentHash: hash(payload),
});
const snap = (
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
  payload: unknown,
): Common.SnapshotRef => ({
  ...ref(objectType, objectId, scope),
  kind: 'SNAPSHOT',
  snapshotId: objectId,
  contentHash: hash(payload),
});
function fail(code: string): never {
  throw new PreparationError(code);
}
function record(v: unknown): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    fail('EXECUTION_PREPARATION_INTEGRITY_INVALID');
  return v as Json;
}
function stableId(root: string, label: string) {
  const h = createHash('sha256')
    .update(root + ':' + label)
    .digest('hex');
  return root.slice(0, 14) + '7' + h.slice(0, 3) + '-8' + h.slice(3, 6) + '-' + h.slice(6, 18);
}
function scope(r: RequestRow): { enterpriseId: string; projectId: string } {
  return { enterpriseId: r.enterprise_id, projectId: r.project_id };
}
function target(r: RequestRow) {
  return ref('zhiju.execution.preparation_analysis_request', r.request_id, scope(r));
}
function context(
  p: PreparationAuthorizationProof,
  s: Common.ScopeRef,
  correlationId = newUuidV7(),
): TaskExecutionTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: p.session.principalId,
    principalKind: p.context.principalKind,
    actorSnapshotId: p.actorSnapshotRef.objectId,
    authorizationDecisionId: p.authorizationDecisionRef.objectId,
    authorizationDecisionHash: Buffer.from(p.authorizationDecisionRef.contentHash.digest, 'hex'),
    authorizationDecisionExpiresAt: new Date(p.context.authorizationDecisionExpiresAt),
    policySnapshotId: p.context.policySnapshotId,
    enterpriseId: s.enterpriseId ?? fail('SCOPE_MISMATCH'),
    allowedProjectIds: [s.projectId ?? fail('SCOPE_MISMATCH')],
    correlationId,
  };
}
const tables = new Set([
  'task',
  'task_definition_snapshot',
  'work_order',
  'work_order_draft_snapshot',
  'context_snapshot',
  'work_order_contract',
  'run',
  'work_order_run_claim',
  'execution_judgment',
  'agent_result',
  'run_final_submission_claim',
  'result_validation_bundle',
  'result_validation_fact',
  'agent_result_acceptance',
  'preparation_analysis_request',
  'preparation_analysis_fact',
]);
async function insert(trx: TaskExecutionTransaction, table: string, values: Json) {
  if (!tables.has(table)) fail('EXECUTION_PREPARATION_INTEGRITY_INVALID');
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  await sql`INSERT INTO ${sql.table('task_execution.' + table)} (${sql.join(entries.map(([k]) => sql.ref(k)))}) VALUES (${sql.join(entries.map(([, v]) => sql`${v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v}`))})`.execute(
    trx,
  );
}
export function createPreparationAnalysisService(config: PreparationAnalysisConfig) {
  const now = config.clock ?? (() => new Date());
  const workerId = newUuidV7();
  let stopped = false;
  let ticking = false;
  const active = new Map<string, AbortController>();
  async function proof(s: PreparationSession, op: string, t: Ref, payload: unknown) {
    return config.authorize(s, op, t, payload);
  }
  async function query<T>(
    s: PreparationSession,
    op: string,
    t: Ref,
    payload: unknown,
    body: (trx: TaskExecutionTransaction) => Promise<T>,
  ) {
    const p = await proof(s, op, t, payload);
    const result = await withTaskExecutionTransaction(config.db, context(p, t.scope), body);
    await config.check(p, op, t, payload);
    return result;
  }
  async function command(
    s: PreparationSession,
    op: string,
    purpose: string,
    t: Ref,
    payload: unknown,
    key: string,
    id: string,
    body: (e: CommandExecution, p: PreparationAuthorizationProof) => Promise<unknown>,
  ) {
    const p = await proof(s, purpose, t, payload),
      ctx = context(p, t.scope);
    const outcome = await executeTaskExecutionCommand(
      config.db,
      ctx,
      {
        commandId: id,
        commandType: op,
        commandVersion: '1.0',
        idempotencyScope: `${op}@1.0:${ctx.enterpriseId}:${t.scope.projectId ?? fail('SCOPE_MISMATCH')}`,
        idempotencyKey: key,
        requestPayload: json(payload),
        enterpriseId: ctx.enterpriseId,
        projectId: t.scope.projectId,
        targetType: t.objectType,
        targetId: t.objectId,
        correlationId: ctx.correlationId,
        principalId: ctx.principalId,
        principalKind: ctx.principalKind,
        actorSnapshotId: ctx.actorSnapshotId,
        authorizationDecisionId: ctx.authorizationDecisionId,
        policySnapshotId: ctx.policySnapshotId,
      },
      async (e) => ({ kind: 'COMMITTED', resultPayload: json(await body(e, p)) }),
      () => config.check(p, purpose, t, payload),
    );
    if (
      outcome.status !== 'COMMITTED' &&
      !(outcome.status === 'DUPLICATE' && outcome.originalOutcome === 'COMMITTED')
    )
      fail('EXECUTION_PREPARATION_COMMAND_REJECTED');
    return outcome.resultPayload;
  }
  async function source(s: PreparationSession, r: Common.SnapshotRef) {
    const value = await config.source(s, r);
    if (
      !same(value.preparationSourceRef, r) ||
      value.payload.profile !== 'ep.preparation_source@2.0' ||
      !same(hash(value.payload), r.contentHash) ||
      new Date(value.payload.validUntil) <= now() ||
      !value.payload.sources.length
    )
      fail('EXECUTION_PREPARATION_SOURCE_STALE');
    return value;
  }
  function validate(op: string, payload: unknown, result = false) {
    const meta = registry.getOperation(op, '1.0');
    if (!meta) fail('EXECUTION_PREPARATION_PROFILE_UNSUPPORTED');
    const uri = result ? meta.resultSchemaRef : operationPayloadSchemaRef(meta);
    if (!uri || !registry.validateCoreContract(uri, payload).valid)
      fail('EXECUTION_PREPARATION_CONTRACT_INVALID');
  }
  async function create(
    s: PreparationSession,
    input: WorkspaceCommandInput<PreparationAnalysisTaskPayload>,
  ) {
    assertPreparationCommand(
      input,
      'execution.create_preparation_analysis_task',
      'zhiju.execution.task',
      'CREATE',
    );
    validate(input.type, input.payload);
    const observed = await source(s, input.payload.preparationSourceRef);
    if (
      !same(input.scopeRef, observed.payload.projectRef.scope) ||
      !same(input.payload.projectRef, observed.payload.projectRef) ||
      !same(input.payload.analysisProfileRef, observed.analysisProfileRef) ||
      !same(input.payload.definition.expectedReportProfileRef, observed.expectedReportProfileRef) ||
      !same(
        input.payload.definition.inputRefs,
        observed.payload.sources.map((x) => x.sourceRef),
      )
    )
      fail('EXECUTION_PREPARATION_SOURCE_INVALID');
    const output = await command(
      s,
      input.type,
      'execution.preparation.task.create',
      input.targetRef,
      input.payload,
      input.idempotencyKey,
      input.commandId,
      async (e, p) => {
        const id = stableId(input.targetRef.objectId, 'definition');
        const base = {
          enterprise_id: input.scopeRef.enterpriseId,
          project_id: input.scopeRef.projectId,
          execution_profile: PROFILE,
        };
        await insert(e.trx, 'task_definition_snapshot', {
          ...base,
          snapshot_id: id,
          task_id: input.targetRef.objectId,
          schema_version: 'preparation.1.0',
          canonical_payload: input.payload,
          payload_hash: digest(input.payload),
          source_command_id: input.commandId,
          created_by_principal_id: s.principalId,
        });
        await insert(e.trx, 'task', {
          ...base,
          task_id: input.targetRef.objectId,
          status: 'DRAFT',
          aggregate_version: 1,
          current_definition_snapshot_id: id,
          current_definition_hash: digest(input.payload),
          created_by_principal_id: s.principalId,
          preparation_command_id: input.commandId,
        });
        await config.check(p, 'execution.preparation.task.create', input.targetRef, input.payload);
        return {
          taskRef: input.targetRef,
          definitionSnapshotRef: content(
            'zhiju.execution.task_definition_snapshot',
            id,
            input.scopeRef,
            input.payload,
          ),
          aggregateVersion: 1,
          receiptRef: ref('execution.command_receipt', input.commandId, input.scopeRef),
        };
      },
    );
    validate(input.type, output, true);
    return output as unknown as PreparationTaskCreated;
  }
  async function request(
    s: PreparationSession,
    input: WorkspaceCommandInput<PreparationAnalysisRequestPayload>,
  ) {
    assertPreparationCommand(
      input,
      'execution.request_preparation_analysis',
      'zhiju.execution.preparation_analysis_request',
      'CREATE',
    );
    validate(input.type, input.payload);
    const observed = await source(s, input.payload.preparationSourceRef);
    if (
      !same(input.scopeRef, observed.payload.projectRef.scope) ||
      !same(input.payload.analysisProfileRef, observed.analysisProfileRef)
    )
      fail('EXECUTION_PREPARATION_SOURCE_INVALID');
    // Discovery hint is written first. It never authorizes a missing/uncommitted TE request.
    await config.runtime.enqueue(input.targetRef);
    const output = await command(
      s,
      input.type,
      'execution.preparation.analysis.request',
      input.targetRef,
      input.payload,
      input.idempotencyKey,
      input.commandId,
      async (e) => {
        const task = (
          await sql<{
            canonical_payload: PreparationAnalysisTaskPayload;
            payload_hash: Buffer;
            status: string;
            aggregate_version: string;
            snapshot_id: string;
          }>`SELECT d.*,t.status,t.aggregate_version FROM task_execution.task t JOIN task_execution.task_definition_snapshot d ON d.snapshot_id=t.current_definition_snapshot_id WHERE t.task_id=${input.payload.taskRef.objectId} AND t.execution_profile='PREPARATION_ANALYSIS' FOR SHARE OF t`.execute(
            e.trx,
          )
        ).rows[0];
        if (
          task?.status !== 'DRAFT' ||
          Number(task.aggregate_version) !== input.payload.expectedTaskAggregateVersion ||
          !same(
            content(
              'zhiju.execution.task_definition_snapshot',
              task.snapshot_id,
              input.scopeRef,
              task.canonical_payload,
            ),
            input.payload.taskDefinitionSnapshotRef,
          ) ||
          !same(task.canonical_payload.preparationSourceRef, input.payload.preparationSourceRef)
        )
          fail('EXECUTION_PREPARATION_TASK_INVALID');
        const ids = Object.fromEntries(
          [
            'work_order',
            'run',
            'context',
            'draft',
            'contract',
            'attempt',
            'controls',
            'readiness',
            'validation',
            'result',
            'acceptance',
          ].map((n) => [n + '_id', stableId(input.targetRef.objectId, n)]),
        );
        await insert(e.trx, 'preparation_analysis_request', {
          request_id: input.targetRef.objectId,
          enterprise_id: input.scopeRef.enterpriseId,
          project_id: input.scopeRef.projectId,
          task_id: input.payload.taskRef.objectId,
          source_ref: input.payload.preparationSourceRef,
          request_payload: input.payload,
          payload_hash: digest(input.payload),
          original_command: input,
          source_command_id: input.commandId,
          last_command_id: input.commandId,
          state: 'PENDING',
          deadline: new Date(observed.payload.validUntil),
          updated_at: now(),
          ...ids,
        });
        return {
          analysisRequestRef: input.targetRef,
          receiptRef: ref('execution.command_receipt', input.commandId, input.scopeRef),
        };
      },
    );
    validate(input.type, output, true);
    return output as unknown as PreparationAnalysisRequested;
  }
  async function readOriginal(
    s: PreparationSession,
    input: {
      operation: 'TASK' | 'ANALYSIS_REQUEST';
      originalCommand: WorkspaceCommandInput<
        PreparationAnalysisTaskPayload | PreparationAnalysisRequestPayload
      >;
    },
  ) {
    const cmd = input.originalCommand;
    assertPreparationCommand(
      cmd,
      cmd.type,
      input.operation === 'TASK'
        ? 'zhiju.execution.task'
        : 'zhiju.execution.preparation_analysis_request',
      'CREATE',
    );
    validate(cmd.type, cmd.payload);
    return query(
      s,
      input.operation === 'TASK'
        ? 'execution.preparation.task.create'
        : 'execution.preparation.analysis.request',
      cmd.targetRef,
      cmd.payload,
      async (trx) => {
        const row = (
          await sql<{
            request_payload_hash: Buffer;
            result_payload: unknown;
            outcome: string;
            target_id: string;
            command_id: string;
          }>`SELECT * FROM task_execution.command_receipt WHERE command_type=${cmd.type} AND command_version='1.0' AND idempotency_scope=${cmd.type + '@1.0:' + cmd.scopeRef.enterpriseId + ':' + cmd.scopeRef.projectId} AND idempotency_key=${cmd.idempotencyKey}`.execute(
            trx,
          )
        ).rows[0];
        if (!row) return { status: 'NOT_COMMITTED' as const };
        if (
          row.target_id !== cmd.targetRef.objectId ||
          row.command_id !== cmd.commandId ||
          !row.request_payload_hash.equals(digest(cmd.payload))
        )
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return row.outcome === 'COMMITTED'
          ? { status: 'COMMITTED' as const, result: row.result_payload }
          : { status: 'UNKNOWN' as const };
      },
    );
  }
  async function row(s: PreparationSession, t: Ref): Promise<RequestRow | undefined> {
    return query(
      s,
      'execution.preparation.analysis.request',
      t,
      { analysisRequestRef: t },
      async (trx) =>
        (
          await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE request_id=${t.objectId}`.execute(
            trx,
          )
        ).rows[0],
    );
  }
  async function step(
    s: PreparationSession,
    r: RequestRow,
    name: string,
    payload: Json,
    body: (e: CommandExecution, p: PreparationAuthorizationProof, id: string) => Promise<unknown>,
  ) {
    const op = 'execution.preparation.internal.' + name,
      id = stableId(r.request_id, 'command:' + name);
    return command(
      s,
      op,
      'execution.preparation.process.step',
      target(r),
      payload,
      r.request_id + ':' + name,
      id,
      async (e, p) => {
        const lease = (
          await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE request_id=${r.request_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        if (lease?.worker_id !== workerId || !lease.worker_lease || lease.worker_lease <= now())
          fail('EXECUTION_PREPARATION_CLAIM_CONFLICT');
        return body(e, p, id);
      },
    );
  }
  async function fact(
    e: CommandExecution,
    r: RequestRow,
    kind: string,
    id: string,
    payload: unknown,
    commandId: string,
  ) {
    await insert(e.trx, 'preparation_analysis_fact', {
      fact_id: id,
      enterprise_id: r.enterprise_id,
      project_id: r.project_id,
      request_id: r.request_id,
      kind,
      canonical_payload: payload,
      payload_hash: digest(payload),
      source_command_id: commandId,
    });
    return snap('zhiju.execution.preparation_' + kind.toLowerCase(), id, scope(r), payload);
  }
  async function state(
    e: CommandExecution,
    r: RequestRow,
    next: RequestRow['state'],
    id: string,
    reasons: string[] = [],
  ) {
    const changed =
      await sql`UPDATE task_execution.preparation_analysis_request SET state=${next},revision=revision+1,reason_codes=${JSON.stringify(reasons)}::jsonb,updated_at=${now()},last_command_id=${id} WHERE request_id=${r.request_id}`.execute(
        e.trx,
      );
    if (changed.numAffectedRows !== 1n) fail('EXECUTION_PREPARATION_REQUEST_INVALID');
  }
  async function claimed(s: PreparationSession, r: RequestRow) {
    const id = newUuidV7(),
      payload = { analysisRequestRef: target(r), workerId };
    await command(
      s,
      'execution.preparation.internal.claim',
      'execution.preparation.process.step',
      target(r),
      payload,
      id,
      id,
      async (e) => {
        const current = (
          await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE request_id=${r.request_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        if (
          !current ||
          (current.worker_id !== workerId && current.worker_lease && current.worker_lease > now())
        )
          fail('EXECUTION_PREPARATION_CLAIM_CONFLICT');
        if (
          !['PENDING', 'PREPARING', 'RUNNING', 'VALIDATING', 'ACCEPTED', 'UNKNOWN'].includes(
            current.state,
          )
        )
          fail('EXECUTION_PREPARATION_REQUEST_INVALID');
        await sql`UPDATE task_execution.preparation_analysis_request SET worker_id=${workerId},worker_lease=${new Date(Math.min(now().getTime() + 300000, r.deadline.getTime()))},last_command_id=${id},state=${current.state === 'PENDING' ? 'PREPARING' : current.state},revision=revision+1,updated_at=${now()} WHERE request_id=${r.request_id}`.execute(
          e.trx,
        );
        return { workerId };
      },
    );
  }
  async function prepare(r: RequestRow, observed: PreparationSourceObservation) {
    let s = await config.serviceSession();
    const sc = scope(r),
      t = target(r);
    const wo = ref('zhiju.execution.work_order', r.work_order_id, sc);
    const draft = {
      profile: SELECTOR,
      workOrderRef: wo,
      taskRef: ref('zhiju.execution.task', r.task_id, sc),
      scopeRef: sc,
      sourceRef: r.source_ref,
      runtimeProfileHash: config.runtime.profileHash,
      deadline: r.deadline.toISOString(),
    };
    await step(s, r, 'draft', draft, async (e, _p, id) => {
      const base = {
        enterprise_id: r.enterprise_id,
        project_id: r.project_id,
        execution_profile: PROFILE,
      };
      await insert(e.trx, 'work_order_draft_snapshot', {
        ...base,
        snapshot_id: r.draft_id,
        work_order_id: r.work_order_id,
        draft_schema_version: 'preparation.1.0',
        work_order_object_type: wo.objectType,
        task_object_type: 'zhiju.execution.task',
        expires_at: r.deadline,
        canonical_payload: draft,
        payload_hash: digest(draft),
        request_payload_hash: digest(draft),
        source_command_id: id,
        created_by_principal_id: s.principalId,
      });
      await insert(e.trx, 'work_order', {
        ...base,
        work_order_id: r.work_order_id,
        work_order_object_type: wo.objectType,
        task_id: r.task_id,
        task_object_type: 'zhiju.execution.task',
        status: 'DRAFT',
        aggregate_version: 1,
        current_draft_snapshot_id: r.draft_id,
        current_draft_snapshot_hash: digest(draft),
        draft_schema_version: 'preparation.1.0',
        expires_at: r.deadline,
        created_by_principal_id: s.principalId,
        requested_by_principal_id: s.principalId,
        preparation_command_id: id,
      });
      return { workOrderRef: wo };
    });
    s = await config.serviceSession();
    // Public builder identity is separate from the controlled request process.
    const ctxPayload = {
      taskRef: ref('zhiju.execution.task', r.task_id, sc),
      workOrderRef: wo,
      preparationSourceRef: r.source_ref,
      builderPolicyRef: observed.analysisProfileRef,
      purpose: 'preparation.analysis',
      audience: observed.payload.audience,
    };
    validate('execution.build_preparation_context', ctxPayload);
    const ctx = record(
      await command(
        s,
        'execution.build_preparation_context',
        'execution.preparation.context.build',
        ref('zhiju.execution.preparation_context', r.context_id, sc),
        ctxPayload,
        r.request_id + ':context',
        stableId(r.request_id, 'command:context'),
        async (e, p) => {
          const value = {
            profile: SELECTOR,
            projectRef: observed.payload.projectRef,
            taskRef: ctxPayload.taskRef,
            workOrderRef: wo,
            preparationSourceRef: r.source_ref,
            purpose: 'preparation.analysis',
            audience: observed.payload.audience,
            analysisBasisRef: observed.payload.analysisBasisRef,
            analysisBasisHash: observed.payload.analysisBasisHash,
            analysisBasisPublicationRef: observed.payload.analysisBasisPublicationRef,
            inputRefs: observed.payload.sources.map((x) => x.sourceRef),
            templateRefs: observed.payload.templateRefs,
            instructions: observed.basis.instructionBindings,
            runtimeProfileHash: config.runtime.profileHash,
            vocabularyHash: hash(observed.basis.vocabulary),
            requirementBindingsHash: hash(observed.basis.requirementBindings),
            initialActorSnapshotRef: p.actorSnapshotRef,
            initialAuthorizationDecisionRef: p.authorizationDecisionRef,
            policySnapshotId: p.context.policySnapshotId,
            createdAt: now().toISOString(),
            validUntil: r.deadline.toISOString(),
          };
          const contextCheck = registry.validateCoreContract(PREPARATION_CONTEXT_SCHEMA, value);
          if (!contextCheck.valid) {
            config.onError?.(new Error(JSON.stringify(contextCheck.errors)));
            fail('EXECUTION_PREPARATION_CONTEXT_INVALID');
          }
          await insert(e.trx, 'context_snapshot', {
            execution_profile: PROFILE,
            snapshot_id: r.context_id,
            object_id: r.context_id,
            purpose: 'preparation.analysis',
            audience: observed.payload.audience.objectId,
            enterprise_id: r.enterprise_id,
            project_id: r.project_id,
            builder_version: 'preparation.1.1',
            policy_snapshot_id: p.context.policySnapshotId,
            source_manifest_count:
              observed.payload.sources.length + observed.payload.templateRefs.length,
            context_item_count: 0,
            omission_count: 0,
            redaction_count: 0,
            coverage_state: 'COMPLETE',
            payload_hash: digest(value),
            payload_hash_algorithm: 'SHA-256',
            expires_at: r.deadline,
            effective_expires_at: r.deadline,
            request_payload_hash: digest(ctxPayload),
            source_command_id: stableId(r.request_id, 'command:context'),
            created_by_principal_id: s.principalId,
            canonical_payload: value,
          });
          return {
            contextRef: snap('zhiju.execution.preparation_context', r.context_id, sc, value),
            receiptRef: ref(
              'execution.command_receipt',
              stableId(r.request_id, 'command:context'),
              sc,
            ),
            validUntil: r.deadline.toISOString(),
          };
        },
      ),
    );
    validate('execution.build_preparation_context', ctx, true);
    s = await config.serviceSession();
    const controls = {
      profile: SELECTOR,
      runtimeProfileHash: config.runtime.profileHash,
      analysisProfileRef: observed.analysisProfileRef,
      maxAttempts: 1,
      maxOutputBytes: 33554432,
      deadline: r.deadline.toISOString(),
      leaseSeconds: 300,
      capabilities: ['preparation.analysis'],
      deniedCapabilities: [
        'document.write',
        'project.start',
        'artifact.approve',
        'release.publish',
      ],
    };
    const frozen = record(
      await step(
        s,
        r,
        'freeze',
        { analysisRequestRef: t, contextRef: ctx.contextRef, controls },
        async (e, p, id) => {
          const current = await source(s, r.source_ref);
          if (!same(current.payload, observed.payload) || now() >= r.deadline)
            fail('EXECUTION_PREPARATION_SOURCE_STALE');
          await config.runtime.verify();
          const materialized = await config.materialize(s, current);
          if (
            !materialized.sources.some((x) => x.role === 'CUSTOMER_MATERIAL') ||
            bytesHash(materialized.instructions.bytes) !== materialized.instructions.sha256 ||
            materialized.sources.some((x) => bytesHash(x.bytes) !== x.sha256)
          )
            fail('EXECUTION_PREPARATION_SOURCE_INVALID');
          if (current.basis.reportSchemaSha256 !== RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256)
            fail('EXECUTION_PREPARATION_CONTRACT_INVALID');
          await config.check(p, 'execution.preparation.process.step', t, {
            analysisRequestRef: t,
            contextRef: ctx.contextRef,
            controls,
          });
          const controlsRef = await fact(e, r, 'CONTROLS', r.controls_id, controls, id);
          const kinds = [
            'CONTEXT_VALIDATION',
            'INPUT_VALIDATION',
            'AUTHORIZATION_VALIDATION',
            'RUNTIME_VALIDATION',
            'OUTPUT_VALIDATION',
          ];
          const validations = [];
          for (const kind of kinds)
            validations.push(
              await fact(
                e,
                r,
                kind,
                stableId(r.request_id, kind),
                {
                  profile: SELECTOR,
                  kind,
                  contextRef: ctx.contextRef,
                  sourceRef: r.source_ref,
                  controlsRef,
                  runtimeProfileHash: config.runtime.profileHash,
                  actorSnapshotRef: p.actorSnapshotRef,
                  authorizationDecisionRef: p.authorizationDecisionRef,
                  valid: true,
                  evaluatedAt: now().toISOString(),
                },
                id,
              ),
            );
          const readiness = {
            profile: SELECTOR,
            taskRef: ctxPayload.taskRef,
            workOrderRef: wo,
            validationRefs: validations,
            ready: true,
            validUntil: r.deadline.toISOString(),
          };
          const readinessRef = snap(
            'zhiju.execution.preparation_readiness',
            r.readiness_id,
            sc,
            readiness,
          );
          await insert(e.trx, 'execution_judgment', {
            execution_profile: PROFILE,
            enterprise_id: r.enterprise_id,
            project_id: r.project_id,
            source_command_id: id,
            judgment_id: r.readiness_id,
            judgment_kind: 'PREPARATION_READINESS',
            task_id: r.task_id,
            work_order_id: r.work_order_id,
            policy_version_ref: controlsRef,
            policy_content_hash: digest(controls),
            policy_effective_from: now(),
            evaluator_ref: null,
            preparation_evaluator: SELECTOR,
            input_hash: digest({ contextRef: ctx.contextRef, validationRefs: validations }),
            evaluated_at: now(),
            valid_until: r.deadline,
            canonical_payload: readiness,
            payload_hash: digest(readiness),
            request_payload_hash: digest({
              analysisRequestRef: t,
              contextRef: ctx.contextRef,
              controls,
            }),
            created_by_principal_id: s.principalId,
          });
          const spec = {
            profile: SELECTOR,
            workOrderRef: wo,
            taskRef: ctxPayload.taskRef,
            projectRef: observed.payload.projectRef,
            contextSnapshotRef: ctx.contextRef,
            preparationSourceRef: r.source_ref,
            objective: 'COMPARE_CUSTOMER_WITH_TEMPLATES',
            allowedCapabilities: ['preparation.analysis'],
            deniedCapabilities: controls.deniedCapabilities,
            expectedOutputs: [
              'analysis-report.json',
              'analysis-report.md',
              'extraction-index.json',
            ],
            completionCriteria: 'REPORT_ACCEPTANCE_ONLY',
            runtimeProfileHash: config.runtime.profileHash,
            validationRefs: validations,
            readinessRef,
            budget: {
              maxAttempts: 1,
              wallClockLimitSeconds: Math.max(
                1,
                Math.floor((r.deadline.getTime() - now().getTime()) / 1000),
              ),
              maxOutputBytes: 33554432,
            },
            issuedAt: now().toISOString(),
            expiresAt: r.deadline.toISOString(),
          };
          const contract = { ...spec, specificationHash: hash(spec) };
          if (!registry.validateCoreContract(PREPARATION_WORK_ORDER_SCHEMA, contract).valid)
            fail('EXECUTION_PREPARATION_CONTRACT_INVALID');
          const contextRef = ctx.contextRef as Common.SnapshotRef;
          await insert(e.trx, 'work_order_contract', {
            execution_profile: PROFILE,
            contract_id: r.contract_id,
            work_order_id: r.work_order_id,
            enterprise_id: r.enterprise_id,
            project_id: r.project_id,
            work_order_object_type: wo.objectType,
            task_id: r.task_id,
            task_object_type: 'zhiju.execution.task',
            draft_snapshot_id: r.draft_id,
            draft_snapshot_hash: digest(draft),
            context_snapshot_id: r.context_id,
            context_snapshot_hash: Buffer.from(contextRef.contentHash.digest, 'hex'),
            validation_judgment_id: r.readiness_id,
            validation_judgment_hash: Buffer.from(readinessRef.contentHash.digest, 'hex'),
            canonical_payload: contract,
            payload_hash: digest(contract),
            specification_hash: digest(spec),
            request_payload_hash: digest({
              analysisRequestRef: t,
              contextRef: ctx.contextRef,
              controls,
            }),
            source_command_id: id,
            created_by_principal_id: s.principalId,
          });
          await sql`UPDATE task_execution.work_order SET status='READY',aggregate_version=aggregate_version+1,frozen_contract_id=${r.contract_id},frozen_contract_hash=${digest(contract)},preparation_command_id=${id} WHERE work_order_id=${r.work_order_id} AND status='DRAFT'`.execute(
            e.trx,
          );
          await sql`UPDATE task_execution.task SET status='READY',aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE task_id=${r.task_id} AND status='DRAFT'`.execute(
            e.trx,
          );
          return {
            contractRef: content('zhiju.contract.work_order', r.contract_id, sc, contract),
            contextRef,
            controlsRef,
          };
        },
      ),
    );
    s = await config.serviceSession();
    await step(
      s,
      r,
      'queue',
      { analysisRequestRef: t, contractRef: frozen.contractRef },
      async (e, _p, id) => {
        await sql`UPDATE task_execution.work_order SET status='QUEUED',queue_policy_ref=${JSON.stringify(frozen.controlsRef)}::jsonb,queued_at=${now()},requested_runtime_class='workspace.macos_manual_omp@1',aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE work_order_id=${r.work_order_id} AND status='READY'`.execute(
          e.trx,
        );
        return { workOrderRef: wo };
      },
    );
    s = await config.serviceSession();
    await step(
      s,
      r,
      'run',
      {
        analysisRequestRef: t,
        contractRef: frozen.contractRef,
        contextRef: ctx.contextRef,
        runtimeBinding: config.runtime.binding,
      },
      async (e, p, id) => {
        const base = {
          execution_profile: PROFILE,
          enterprise_id: r.enterprise_id,
          project_id: r.project_id,
          work_order_id: r.work_order_id,
          run_id: r.run_id,
          attempt_number: 1,
          fencing_token: 1,
          source_command_id: id,
        };
        await insert(e.trx, 'run', {
          ...base,
          work_order_ref: wo,
          work_order_contract_ref: frozen.contractRef,
          context_snapshot_ref: ctx.contextRef,
          capability_grant_ref: null,
          preparation_authorization_ref: p.authorizationDecisionRef,
          runtime_binding: config.runtime.binding,
          lease_policy_ref: frozen.controlsRef,
          lease_id: stableId(r.request_id, 'lease'),
          lease_expires_at: new Date(Math.min(now().getTime() + 300000, r.deadline.getTime())),
          execution_deadline: r.deadline,
          status: 'CREATED',
          created_at: now(),
          created_by_principal_id: s.principalId,
          preparation_command_id: id,
        });
        await insert(e.trx, 'work_order_run_claim', {
          ...base,
          status: 'ACTIVE',
          preparation_command_id: id,
        });
        return { runRef: ref('execution.run', r.run_id, sc) };
      },
    );
    return {
      contractRef: frozen.contractRef as Common.ContentAddressedRef,
      contextRef: ctx.contextRef as Common.SnapshotRef,
    };
  }
  async function packageFor(r: RequestRow, observed: PreparationSourceObservation) {
    const s = await config.serviceSession();
    const binding = await query(
      s,
      'execution.preparation.analysis.request',
      target(r),
      { analysisRequestRef: target(r) },
      async (trx) => {
        const contract = (
          await sql<{
            canonical_payload: Json;
            payload_hash: Buffer;
          }>`SELECT canonical_payload,payload_hash FROM task_execution.work_order_contract WHERE contract_id=${r.contract_id} AND execution_profile='PREPARATION_ANALYSIS'`.execute(
            trx,
          )
        ).rows[0];
        if (!contract || !digest(contract.canonical_payload).equals(contract.payload_hash))
          fail('EXECUTION_PREPARATION_CONTRACT_INVALID');
        return {
          contractRef: content(
            'zhiju.contract.work_order',
            r.contract_id,
            scope(r),
            contract.canonical_payload,
          ),
          contextRef: contract.canonical_payload.contextSnapshotRef as Common.SnapshotRef,
        };
      },
    );
    const materials = await config.materialize(s, observed);
    const byCode = new Map(
      observed.basis.templateBindings.map((x) => [x.templateCode, x.templateRef.objectId]),
    );
    const input: LocalAnalysisPackage = {
      runRef: ref('execution.run', r.run_id, scope(r)),
      attemptRef: ref('zhiju.integration.preparation_analysis_attempt', r.attempt_id, scope(r)),
      adapterRef: ref(
        'zhiju.integration.preparation_analysis_adapter',
        stableId(r.request_id, 'adapter'),
        scope(r),
      ),
      runFencingToken: 1,
      ...binding,
      analysisRequestKey: r.original_command.idempotencyKey,
      ...materials,
      vocabulary: observed.basis.vocabulary as unknown as Json,
      requirementBindings: observed.basis.requirementBindings.map((x) => ({
        sourceId: byCode.get(x.templateCode) ?? fail('EXECUTION_PREPARATION_SOURCE_INVALID'),
        locator: x.locator,
        requirementCode: x.requirementCode,
      })),
      deadline: r.deadline.toISOString(),
    };
    return input;
  }
  async function renew(r: RequestRow, markRunning = false) {
    const s = await config.serviceSession();
    await source(s, r.source_ref);
    const payload = { analysisRequestRef: target(r), markRunning, observedAt: now().toISOString() },
      id = newUuidV7();
    await command(
      s,
      'execution.preparation.internal.renew',
      'execution.preparation.process.step',
      target(r),
      payload,
      id,
      id,
      async (e) => {
        const cid = id;
        const owner = (
          await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE request_id=${r.request_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        if (
          owner?.worker_id !== workerId ||
          !owner.worker_lease ||
          owner.worker_lease <= now() ||
          r.deadline <= now()
        )
          fail('EXECUTION_PREPARATION_CLAIM_CONFLICT');

        const run = (
          await sql<{
            status: string;
            lease_expires_at: Date;
          }>`SELECT status,lease_expires_at FROM task_execution.run WHERE run_id=${r.run_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        const expiry = new Date(Math.min(now().getTime() + 300000, r.deadline.getTime()));
        if (!run && !markRunning && owner.state === 'PREPARING') {
          await sql`UPDATE task_execution.preparation_analysis_request SET worker_lease=${expiry},last_command_id=${cid} WHERE request_id=${r.request_id}`.execute(
            e.trx,
          );
          return { leaseExpiresAt: expiry.toISOString() };
        }
        if (
          !run ||
          !['CREATED', 'RUNNING', 'RESULT_RECORDED'].includes(run.status) ||
          run.lease_expires_at <= now() ||
          r.deadline <= now()
        )
          fail('EXECUTION_PREPARATION_LEASE_EXPIRED');
        if (markRunning && run.status === 'CREATED') {
          await sql`UPDATE task_execution.run SET status='RUNNING',started_at=${now()},start_attempt_ref=${JSON.stringify(ref('zhiju.integration.preparation_analysis_attempt', r.attempt_id, scope(r)))}::jsonb,aggregate_version=aggregate_version+1,lease_expires_at=${expiry},preparation_command_id=${cid} WHERE run_id=${r.run_id}`.execute(
            e.trx,
          );
          await sql`UPDATE task_execution.work_order SET status='RUNNING',aggregate_version=aggregate_version+1,preparation_command_id=${cid} WHERE work_order_id=${r.work_order_id} AND status='QUEUED'`.execute(
            e.trx,
          );
          await sql`UPDATE task_execution.task SET status='IN_PROGRESS',aggregate_version=aggregate_version+1,preparation_command_id=${cid} WHERE task_id=${r.task_id} AND status='READY'`.execute(
            e.trx,
          );
          await state(e, r, 'RUNNING', cid);
        } else
          await sql`UPDATE task_execution.run SET lease_expires_at=${expiry},aggregate_version=aggregate_version+1,preparation_command_id=${cid} WHERE run_id=${r.run_id}`.execute(
            e.trx,
          );
        await sql`UPDATE task_execution.preparation_analysis_request SET worker_lease=${expiry},last_command_id=${cid} WHERE request_id=${r.request_id}`.execute(
          e.trx,
        );
        return { leaseExpiresAt: expiry.toISOString() };
      },
    );
  }
  async function accept(r: RequestRow, input: LocalAnalysisPackage, output: LocalAnalysisOutput) {
    if (
      output.observation.promptStatus !== 'completed' ||
      !output.observation.processStopped ||
      !same(output.runRef, input.runRef) ||
      !same(output.attemptRef, input.attemptRef) ||
      !same(output.adapterRef, input.adapterRef) ||
      output.runFencingToken !== 1 ||
      !same(output.profileHash, config.runtime.profileHash) ||
      bytesHash(output.reportJson) !== output.jsonSha256 ||
      bytesHash(output.narrativeMarkdown) !== output.markdownSha256
    )
      fail('EXECUTION_PREPARATION_RESULT_INVALID');
    const report: unknown = JSON.parse(output.reportJson);
    if (!registry.validateCoreContract(RUNNER_ANALYSIS_REPORT_SCHEMA_ID, report).valid)
      fail('EXECUTION_PREPARATION_RESULT_INVALID');
    const reportContext = record(record(report).context);
    if (
      reportContext.analysisRequestKey !== input.analysisRequestKey ||
      reportContext.inputManifestSha256 !== output.manifestSha256 ||
      record(record(report).narrative).sha256 !== output.markdownSha256
    )
      fail('EXECUTION_PREPARATION_RESULT_INVALID');
    const sc = scope(r),
      observationRef = content(
        'zhiju.integration.preparation_analysis_observation',
        r.attempt_id,
        sc,
        output,
      );
    const resultPayload = {
      profile: SELECTOR,
      runRef: input.runRef,
      workOrderContractRef: input.contractRef,
      contextRef: input.contextRef,
      preparationSourceRef: r.source_ref,
      attemptRef: input.attemptRef,
      observationRef,
      runFencingToken: 1,
      executionOutcome: 'COMPLETED',
      businessOutputs: [],
      output: {
        jsonBytes: output.reportJson,
        markdownBytes: output.narrativeMarkdown,
        jsonSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: output.jsonSha256,
        },
        markdownSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: output.markdownSha256,
        },
        manifestSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: output.manifestSha256,
        },
        extractionSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: output.extractionSha256,
        },
        validationContextSha256: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: output.validationContextSha256,
        },
        observationRef,
      },
    };
    const resultRef = content('execution.agent_result', r.result_id, sc, resultPayload);
    let s = await config.serviceSession();
    await source(s, r.source_ref);
    await step(
      s,
      r,
      'record',
      { analysisRequestRef: target(r), observationRef, resultRef },
      async (e, _p, id) => {
        const run = (
          await sql<{
            status: string;
            lease_expires_at: Date;
          }>`SELECT status,lease_expires_at FROM task_execution.run WHERE run_id=${r.run_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        if (run?.status !== 'RUNNING' || run.lease_expires_at <= now() || r.deadline <= now())
          fail('EXECUTION_PREPARATION_LEASE_EXPIRED');
        await insert(e.trx, 'agent_result', {
          execution_profile: PROFILE,
          result_id: r.result_id,
          run_id: r.run_id,
          enterprise_id: r.enterprise_id,
          project_id: r.project_id,
          attempt_ref: input.attemptRef,
          observation_ref: observationRef,
          adapter_identity_ref: input.adapterRef,
          runtime_submission_ref: observationRef,
          fencing_token: 1,
          result_payload: resultPayload,
          result_payload_hash: digest(resultPayload),
          source_command_id: id,
        });
        await insert(e.trx, 'run_final_submission_claim', {
          execution_profile: PROFILE,
          run_id: r.run_id,
          result_id: r.result_id,
          enterprise_id: r.enterprise_id,
          project_id: r.project_id,
          observation_ref: observationRef,
          result_payload_hash: digest(resultPayload),
          source_command_id: id,
        });
        await fact(
          e,
          r,
          'OBSERVATION',
          stableId(r.request_id, 'observation'),
          {
            observationRef,
            profileHash: config.runtime.profileHash,
            packageHash: output.packageHash,
          },
          id,
        );
        await sql`UPDATE task_execution.run SET status='RESULT_RECORDED',result_ref=${JSON.stringify(resultRef)}::jsonb,runtime_adapter_identity_ref=${JSON.stringify(input.adapterRef)}::jsonb,aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE run_id=${r.run_id}`.execute(
          e.trx,
        );
        await state(e, r, 'VALIDATING', id);
        return { agentResultRef: resultRef };
      },
    );
    // Independent owning readback rechecks physical bytes with the pinned validator.
    const checked = await config.runtime.read(input);
    if (checked.status !== 'COMPLETE' || !same(checked.output, output))
      fail('EXECUTION_PREPARATION_RESULT_INVALID');
    s = await config.serviceSession();
    await source(s, r.source_ref);
    const accepted = record(
      await step(
        s,
        r,
        'accept',
        { analysisRequestRef: target(r), agentResultRef: resultRef, observationRef },
        async (e, p, id) => {
          const bundle = {
            profile: SELECTOR,
            runRef: input.runRef,
            agentResultRef: resultRef,
            observationRef,
            contextRef: input.contextRef,
            checks: ['SCHEMA', 'IDENTITY', 'RUN_BINDING', 'SCOPE', 'BUSINESS_OUTPUT'].map(
              (kind) => ({ kind, valid: true }),
            ),
            validUntil: r.deadline.toISOString(),
            evaluator: 'te.preparation_analysis.result@1',
          };
          const controls = (
            await sql<{
              canonical_payload: Json;
              payload_hash: Buffer;
            }>`SELECT canonical_payload,payload_hash FROM task_execution.preparation_analysis_fact WHERE fact_id=${r.controls_id}`.execute(
              e.trx,
            )
          ).rows[0];
          if (!controls) fail('EXECUTION_PREPARATION_CONTRACT_INVALID');
          const controlsRef = snap(
            'zhiju.execution.preparation_controls',
            r.controls_id,
            sc,
            controls.canonical_payload,
          );
          const common = {
            execution_profile: PROFILE,
            enterprise_id: r.enterprise_id,
            project_id: r.project_id,
            source_command_id: id,
          };
          await insert(e.trx, 'execution_judgment', {
            ...common,
            judgment_id: r.validation_id,
            judgment_kind: 'RESULT_VALIDATION_BUNDLE',
            run_id: r.run_id,
            result_id: r.result_id,
            attempt_ref: input.attemptRef,
            observation_ref: observationRef,
            policy_version_ref: controlsRef,
            policy_content_hash: controls.payload_hash,
            policy_effective_from: now(),
            evaluator_ref: null,
            preparation_evaluator: SELECTOR,
            input_hash: digest({ resultRef, observationRef }),
            evaluated_at: now(),
            valid_until: r.deadline,
            canonical_payload: bundle,
            payload_hash: digest(bundle),
            request_payload_hash: digest({
              analysisRequestRef: target(r),
              agentResultRef: resultRef,
              observationRef,
            }),
            created_by_principal_id: s.principalId,
          });
          await insert(e.trx, 'result_validation_bundle', {
            ...common,
            bundle_id: r.validation_id,
            run_id: r.run_id,
            result_id: r.result_id,
            attempt_ref: input.attemptRef,
            observation_ref: observationRef,
            policy_ref: controlsRef,
            evaluator_ref: null,
            preparation_evaluator: SELECTOR,
            valid_until: r.deadline,
            canonical_payload: bundle,
            payload_hash: digest(bundle),
          });
          for (const check of bundle.checks)
            await insert(e.trx, 'result_validation_fact', {
              ...common,
              validation_id: stableId(r.request_id, 'result:' + check.kind),
              bundle_id: r.validation_id,
              kind: check.kind,
              canonical_payload: { ...check, agentResultRef: resultRef, observationRef },
              payload_hash: digest({ ...check, agentResultRef: resultRef, observationRef }),
            });
          const acceptance = {
            profile: SELECTOR,
            agentResultRef: resultRef,
            runRef: input.runRef,
            validationRef: snap('execution.result_validation_bundle', r.validation_id, sc, bundle),
            disposition: 'ACCEPTED',
            actorSnapshotRef: p.actorSnapshotRef,
            authorizationDecisionRef: p.authorizationDecisionRef,
            acceptedAt: now().toISOString(),
          };
          await insert(e.trx, 'agent_result_acceptance', {
            ...common,
            acceptance_id: r.acceptance_id,
            result_id: r.result_id,
            bundle_id: r.validation_id,
            run_id: r.run_id,
            canonical_payload: acceptance,
            payload_hash: digest(acceptance),
          });
          const acceptanceRef = content(
            'execution.agent_result_acceptance',
            r.acceptance_id,
            sc,
            acceptance,
          );
          const completed =
            await sql`UPDATE task_execution.run SET status='SUCCEEDED',acceptance_ref=${JSON.stringify(acceptanceRef)}::jsonb,ended_at=${now()},termination_reason='EXECUTION_RESULT_ACCEPTED',aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE run_id=${r.run_id} AND status='RESULT_RECORDED' AND lease_expires_at>${now()} AND execution_deadline>${now()}`.execute(
              e.trx,
            );
          if (completed.numAffectedRows !== 1n) fail('EXECUTION_PREPARATION_LEASE_EXPIRED');
          await sql`UPDATE task_execution.work_order_run_claim SET status='RELEASED',preparation_command_id=${id} WHERE run_id=${r.run_id} AND status='ACTIVE'`.execute(
            e.trx,
          );
          await sql`UPDATE task_execution.work_order SET status='COMPLETION_PENDING',aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE work_order_id=${r.work_order_id} AND status='RUNNING'`.execute(
            e.trx,
          );
          await state(e, r, 'ACCEPTED', id);
          return { analysisResultRef: resultRef, analysisResultAcceptanceRef: acceptanceRef };
        },
      ),
    );
    return accepted as unknown as {
      analysisResultRef: Common.ContentAddressedRef;
      analysisResultAcceptanceRef: Common.ContentAddressedRef;
    };
  }
  async function getResult(
    s: PreparationSession,
    input: {
      agentResultRef: Common.ContentAddressedRef;
      acceptanceRef: Common.ContentAddressedRef;
      preparationSourceRef: Common.SnapshotRef;
    },
  ) {
    validate('execution.get_preparation_analysis_result', input);
    const t = ref(
      'execution.agent_result',
      input.agentResultRef.objectId,
      input.agentResultRef.scope,
    );
    const output = await query(s, 'execution.preparation.result.read', t, input, async (trx) => {
      const result = (
        await sql<{
          result_payload: Json;
          result_payload_hash: Buffer;
          run_id: string;
        }>`SELECT * FROM task_execution.agent_result WHERE result_id=${input.agentResultRef.objectId} AND execution_profile='PREPARATION_ANALYSIS'`.execute(
          trx,
        )
      ).rows[0];
      const accepted = (
        await sql<{
          canonical_payload: Json;
          payload_hash: Buffer;
          result_id: string;
        }>`SELECT * FROM task_execution.agent_result_acceptance WHERE acceptance_id=${input.acceptanceRef.objectId} AND execution_profile='PREPARATION_ANALYSIS'`.execute(
          trx,
        )
      ).rows[0];
      if (!result || !accepted) fail('EXECUTION_PREPARATION_RESULT_INVALID');
      if (
        accepted.result_id !== input.agentResultRef.objectId ||
        !digest(result.result_payload).equals(result.result_payload_hash) ||
        !digest(accepted.canonical_payload).equals(accepted.payload_hash) ||
        !same(
          content(t.objectType, t.objectId, t.scope, result.result_payload),
          input.agentResultRef,
        ) ||
        !same(
          content(
            'execution.agent_result_acceptance',
            input.acceptanceRef.objectId,
            t.scope,
            accepted.canonical_payload,
          ),
          input.acceptanceRef,
        ) ||
        !same(result.result_payload.preparationSourceRef, input.preparationSourceRef)
      )
        fail('EXECUTION_PREPARATION_RESULT_INVALID');
      const request = (
        await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE run_id=${result.run_id} AND state='ACCEPTED'`.execute(
          trx,
        )
      ).rows[0];
      if (!request) fail('EXECUTION_PREPARATION_RESULT_INVALID');
      return {
        ...input,
        runRef: result.result_payload.runRef,
        contractRef: result.result_payload.workOrderContractRef,
        contextRef: result.result_payload.contextRef,
        profileRef: request.request_payload.analysisProfileRef,
        output: result.result_payload.output,
        currentUsability: 'USABLE',
        reasons: [] as string[],
      };
    });
    try {
      await source(s, input.preparationSourceRef);
    } catch {
      output.currentUsability = 'STALE';
      output.reasons = ['EXECUTION_PREPARATION_SOURCE_STALE'];
    }
    validate('execution.get_preparation_analysis_result', output, true);
    return output as unknown as PreparationResultContent;
  }
  async function progress(
    s: PreparationSession,
    requestRef: Ref,
  ): Promise<PreparationExecutionProgress> {
    const r = await row(s, requestRef);
    if (!r) fail('EXECUTION_PREPARATION_REQUEST_NOT_FOUND');
    const value: PreparationExecutionProgress = {
      analysisRequestRef: requestRef,
      preparationSourceRef: r.source_ref,
      taskRef: ref('zhiju.execution.task', r.task_id, scope(r)),
      state: r.state,
      reasonCodes: r.reason_codes,
      updatedAt: r.updated_at.toISOString(),
    };
    if (['RUNNING', 'VALIDATING', 'ACCEPTED'].includes(r.state))
      value.runRef = ref('execution.run', r.run_id, scope(r));
    if (r.state === 'ACCEPTED') {
      const pair = await query(
        s,
        'execution.preparation.analysis.request',
        requestRef,
        { analysisRequestRef: requestRef },
        async (trx) => {
          const a = (
            await sql<{
              canonical_payload: Json;
            }>`SELECT canonical_payload FROM task_execution.agent_result_acceptance WHERE acceptance_id=${r.acceptance_id}`.execute(
              trx,
            )
          ).rows[0];
          if (!a) fail('EXECUTION_PREPARATION_RESULT_INVALID');
          return a.canonical_payload;
        },
      );
      value.agentResultRef = pair.agentResultRef as Common.ContentAddressedRef;
      value.acceptanceRef = content(
        'execution.agent_result_acceptance',
        r.acceptance_id,
        scope(r),
        pair,
      );
    }
    return value;
  }
  async function publish(r: RequestRow) {
    const s = await config.serviceSession(),
      observed = await source(s, r.source_ref),
      p = await progress(s, target(r));
    if (!p.agentResultRef || !p.acceptanceRef) fail('EXECUTION_PREPARATION_RESULT_INVALID');
    const payload: PreparationReportAcceptancePayload = {
      projectRef: observed.payload.projectRef,
      preparationSourceRef: r.source_ref,
      analysisResultRef: p.agentResultRef,
      analysisResultAcceptanceRef: p.acceptanceRef,
      expectedPreparationVersion: 1,
      outputProfileRef: observed.expectedReportProfileRef,
    };
    const saved = await step(
      s,
      r,
      'report',
      { analysisRequestRef: target(r), ...payload },
      async (e, _proof, id) => {
        const command: WorkspaceCommandInput<PreparationReportAcceptancePayload> = {
          commandId: stableId(r.request_id, 'report-command'),
          type: 'project.accept_preparation_report',
          version: '1.0',
          scopeRef: scope(r),
          targetRef: ref(
            'zhiju.project.preparation_report',
            stableId(r.request_id, 'report'),
            scope(r),
          ),
          idempotencyKey:
            'project.accept_preparation_report:1.0:' + stableId(r.request_id, 'report'),
          correlationId: r.original_command.correlationId,
          requestedAt: now().toISOString(),
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: hash(payload) },
        };
        await fact(
          e,
          r,
          'REPORT_ACCEPTANCE',
          stableId(r.request_id, 'report-intent'),
          { command },
          id,
        );
        return command;
      },
    );
    await config.onAccepted(
      s,
      saved as unknown as WorkspaceCommandInput<PreparationReportAcceptancePayload>,
    );
  }
  async function drive(r: RequestRow) {
    const controller = new AbortController();
    active.set(r.request_id, controller);
    let renewError: Error | undefined;
    let renewal: Promise<void> = Promise.resolve();
    const timer = setInterval(() => {
      renewal = renewal
        .then(() => renew(r))
        .catch((error: unknown) => {
          renewError =
            error instanceof Error
              ? error
              : new Error('EXECUTION_PREPARATION_DEPENDENCY_UNAVAILABLE');
          controller.abort();
        });
    }, 60000);
    timer.unref();
    try {
      const s = await config.serviceSession(),
        observed = await source(s, r.source_ref);
      await prepare(r, observed);
      const input = await packageFor(r, observed);
      const existing = await config.runtime.read(input);
      let output: LocalAnalysisOutput;
      if (existing.status === 'COMPLETE' && existing.output) output = existing.output;
      else if (existing.status === 'NOT_INVOKED' && ['PENDING', 'PREPARING'].includes(r.state))
        output = await config.runtime.invoke(input, () => renew(r, true), controller.signal);
      else fail('INTEGRATION_OMP_PROVIDER_UNKNOWN');
      if (renewError) throw renewError;
      clearInterval(timer);
      await renewal;
      await accept(r, input, output);
      await publish(r);
    } catch (error) {
      config.onError?.(error);
      if (renewError) config.onError?.(renewError);
      clearInterval(timer);
      await renewal;
      const code =
        error instanceof PreparationError
          ? error.code
          : 'EXECUTION_PREPARATION_DEPENDENCY_UNAVAILABLE';
      const unknown = code.includes('UNKNOWN') || code.includes('ORIGINAL_ATTEMPT');
      try {
        const s = await config.serviceSession();
        const current = await row(s, target(r));
        if (current && current.state !== 'ACCEPTED')
          await step(
            s,
            r,
            'failure',
            { analysisRequestRef: target(r), reason: code },
            async (e, _p, id) => {
              await state(
                e,
                r,
                unknown ? 'UNKNOWN' : r.deadline <= now() ? 'EXPIRED' : 'FAILED',
                id,
                [code],
              );
              return { state: unknown ? 'UNKNOWN' : 'FAILED' };
            },
          );
      } catch {
        /* The durable original request remains recoverable; never retry an unknown invocation. */
      }
    } finally {
      clearInterval(timer);
      active.delete(r.request_id);
    }
  }
  async function expire(s: PreparationSession, r: RequestRow) {
    const id = newUuidV7();
    await command(
      s,
      'execution.preparation.internal.expire',
      'execution.preparation.process.step',
      target(r),
      { analysisRequestRef: target(r) },
      id,
      id,
      async (e) => {
        const current = (
          await sql<RequestRow>`SELECT * FROM task_execution.preparation_analysis_request WHERE request_id=${r.request_id} FOR UPDATE`.execute(
            e.trx,
          )
        ).rows[0];
        if (!current || current.deadline > now() || current.state === 'ACCEPTED')
          fail('EXECUTION_PREPARATION_REQUEST_INVALID');
        await sql`UPDATE task_execution.run SET status='TIMED_OUT',ended_at=${now()},termination_reason='EXECUTION_DEADLINE_EXCEEDED',aggregate_version=aggregate_version+1,preparation_command_id=${id} WHERE run_id=${r.run_id} AND status IN('CREATED','RUNNING','RESULT_RECORDED') AND execution_deadline<=${now()}`.execute(
          e.trx,
        );
        await sql`UPDATE task_execution.work_order_run_claim SET status='EXPIRED',preparation_command_id=${id} WHERE run_id=${r.run_id} AND status='ACTIVE'`.execute(
          e.trx,
        );
        await state(e, r, 'EXPIRED', id, ['EXECUTION_DEADLINE_EXCEEDED']);
        return { state: 'EXPIRED' };
      },
    );
  }
  const published = new Set<string>();
  const inflight = new Set<Promise<void>>();
  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      for (const hint of await config.runtime.pending()) {
        if (stopped || active.size) break;
        try {
          const s = await config.serviceSession(),
            r = await row(s, hint);
          if (!r || published.has(r.request_id)) continue;
          if (r.deadline <= now() && !['EXPIRED', 'ACCEPTED'].includes(r.state)) {
            await expire(s, r);
            continue;
          }
          if (['FAILED', 'EXPIRED'].includes(r.state) || r.deadline <= now()) continue;
          if (r.worker_id !== workerId && r.worker_lease && r.worker_lease > now()) continue;
          await claimed(s, r);
          if (r.state === 'ACCEPTED') {
            await publish(r);
            published.add(r.request_id);
            continue;
          }
          const work = drive(r);
          inflight.add(work);
          void work.then(
            () => inflight.delete(work),
            () => inflight.delete(work),
          );
          // UNKNOWN can only reread its original attempt. Finish that bounded
          // recovery before continuing so it cannot starve later queued work.
          if (r.state === 'UNKNOWN') await work;
        } catch (error) {
          config.onError?.(error);
          /* One inaccessible historical hint cannot block other project work. */
        }
      }
    } finally {
      ticking = false;
    }
  }
  const timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, 3000);
  timer.unref();
  return {
    create,
    request,
    read: readOriginal,
    getResult,
    progress,
    tick,
    close: async () => {
      stopped = true;
      clearInterval(timer);
      for (const c of active.values()) c.abort();
      await Promise.allSettled(inflight);
    },
  };
}
