import { getContractRegistry, operationPayloadSchemaRef } from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { sql, type Kysely } from 'kysely';
import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  object,
  same,
  requireThat,
  textValue,
  hash,
  type WorkOrderPolicyObservation,
} from './work-order-validation-plan.js';
import { validateCompletionPolicy } from './policy-profiles.js';
import { canonicalSet } from './blocked-input-recovery.js';
import {
  formalCriteria,
  formalCompletionPolicy,
  formalEvaluator,
  validateFormalTaskDefinition,
  verifyFormalOutput,
  WORK_ORDER_COMPLETION,
  TASK_COMPLETION,
} from './formal-output.js';

const registry = getContractRegistry();
const WO = 'zhiju.execution.work_order',
  TASK = 'zhiju.execution.task',
  EVALUATION = 'zhiju.execution.completion_evaluation';
type Ref = CanonicalJsonObject;
interface Root {
  id: string;
  taskId: string;
  scope: Ref;
  status: string;
  version: string;
  definitionRef: Ref;
  definition: Ref;
  pointer?: Ref;
}
interface Source {
  ref: Ref;
  aggregateVersion?: number;
  payloadHash?: Ref;
}
interface Output {
  output: Ref;
  contract: Ref;
  run: Ref;
  runRef: Ref;
}
interface Collection {
  root: Root;
  sources: Source[];
  hash: Ref;
  contracts: Ref[];
  outputs: Output[];
  blockers: Ref[];
  active: boolean;
  children: Root[];
}
export interface CompletionQualityObservation {
  readonly selection: CanonicalJsonObject;
  readonly facts: readonly { ref: Ref; payload: Ref }[];
  readonly usable: boolean;
  readonly revoked: boolean;
  readonly validUntil?: string;
}
/** Every dependency is authorized by the consumer's current Decision before reading. */
export interface FormalCompletionPorts {
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly authorizationValidUntil: () => Date;
  readonly actorSnapshotRef: Ref;
  readonly authorizationDecisionRef: Ref;
  readonly authorizeSources: (targetRef: Ref) => Promise<void>;
  readonly resolvePolicy: (policyRef: Ref) => Promise<WorkOrderPolicyObservation>;
  readonly readExecutionOutput: (revisionRef: Ref) => Promise<Ref>;
  readonly inspectBundle: (bundleRef: Ref, runRef: Ref) => Promise<void>;
  readonly readQuality?: (input: {
    revisionRefs: readonly Ref[];
    qualityProfileRef: Ref;
    requireApproval: boolean;
    selection?: Ref;
  }) => Promise<CompletionQualityObservation>;
  readonly failAt?: (point: 'evaluation' | 'observations' | 'pointer' | 'event' | 'edges') => void;
}
function reference(type: string, id: string, scope: Ref, digest?: string): Ref {
  return {
    kind: digest === undefined ? 'OBJECT' : 'CONTENT_ADDRESSED',
    objectType: type,
    objectId: id,
    scope,
    ...(digest === undefined ? {} : { contentHash: hash(digest) }),
  };
}
function evaluationRef(id: string, scope: Ref, payload: Ref) {
  return reference(EVALUATION, id, scope, sha256CanonicalJson(payload));
}
function sorted<T extends CanonicalJsonValue>(values: readonly T[]): T[] {
  return canonicalSet(values) as T[];
}
function sourceJson(sources: readonly Source[]): Ref[] {
  return sources.map((s) => ({
    ref: s.ref,
    ...(s.aggregateVersion === undefined ? {} : { aggregateVersion: s.aggregateVersion }),
    ...(s.payloadHash ? { payloadHash: s.payloadHash } : {}),
  }));
}
function sourceHash(value: Ref) {
  return hash(sha256CanonicalJson(value));
}
function stableObservation(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) return value.map(stableObservation);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['observedAt', 'checkedAt', 'sourceWatermarks'].includes(key))
        .map(([key, v]) => [key, stableObservation(v)]),
    );
  return value;
}
function requireScope(ref: Ref, context: TaskExecutionTransactionContext) {
  requireThat(
    ref.kind === 'OBJECT' &&
      [WO, TASK].includes(textValue(ref.objectType)) &&
      same(ref.scope, {
        enterpriseId: context.enterpriseId,
        projectId: context.allowedProjectIds[0],
      }),
    'NOT_FOUND',
  );
}
async function readRoot(trx: TaskExecutionTransaction, target: Ref): Promise<Root> {
  const kind = target.objectType === TASK ? 'task' : 'work_order';
  const idColumn = kind === 'task' ? 'task_id' : 'work_order_id';
  const row = (
    await sql<{
      data: Ref;
    }>`SELECT to_jsonb(r) data FROM ${sql.table(`task_execution.${kind}`)} r WHERE ${sql.ref(idColumn)}=${target.objectId}::uuid`.execute(
      trx,
    )
  ).rows[0]?.data;
  requireThat(
    row && same(target.scope, { enterpriseId: row.enterprise_id, projectId: row.project_id }),
    'NOT_FOUND',
  );
  const definitionId =
    kind === 'task' ? row.current_definition_snapshot_id : row.frozen_contract_id;
  requireThat(typeof definitionId === 'string', 'NOT_FOUND');
  const definitionTable = kind === 'task' ? 'task_definition_snapshot' : 'work_order_contract';
  const definitionColumn = kind === 'task' ? 'snapshot_id' : 'contract_id';
  const definition = (
    await sql<{
      canonical_payload: Ref;
      payload_hash: Buffer;
      schema_version: string;
    }>`SELECT canonical_payload,payload_hash,${kind === 'task' ? sql.ref('schema_version') : sql.val(row.draft_schema_version)} AS schema_version FROM ${sql.table(`task_execution.${definitionTable}`)} WHERE ${sql.ref(definitionColumn)}=${definitionId}::uuid`.execute(
      trx,
    )
  ).rows[0];
  requireThat(definition?.schema_version === (kind === 'task' ? '2.0' : '1.1'), 'NOT_FOUND');
  requireThat(
    (kind === 'task'
      ? sha256CanonicalJson(definition.canonical_payload)
      : hashContractPayload(definition.canonical_payload)) ===
      definition.payload_hash.toString('hex'),
    'EXECUTION_JUDGMENT_INVALID',
  );
  const pointer =
    row.current_completion_evaluation_id === null ||
    row.current_completion_evaluation_id === undefined
      ? undefined
      : reference(
          EVALUATION,
          textValue(row.current_completion_evaluation_id),
          object(target.scope),
          textValue(row.current_completion_evaluation_hash).replace(/^\\x/u, ''),
        );
  return {
    id: textValue(target.objectId),
    taskId: textValue(row.task_id),
    scope: object(target.scope),
    status: textValue(row.status),
    version: String(Number(row.aggregate_version)),
    definition: definition.canonical_payload,
    definitionRef: reference(
      kind === 'task' ? 'zhiju.execution.task_definition_snapshot' : 'zhiju.contract.work_order',
      definitionId,
      object(target.scope),
      definition.payload_hash.toString('hex'),
    ),
    ...(pointer ? { pointer } : {}),
  };
}
/** Parent locks serialize membership as well as existing rows. */
export async function lockCompletionParents(trx: TaskExecutionTransaction, target: Ref) {
  const root = await readRoot(trx, target);
  await sql`SELECT task_id FROM task_execution.task WHERE task_id=${root.taskId}::uuid FOR UPDATE`.execute(
    trx,
  );
  const workOrders = (
    await sql<{
      work_order_id: string;
    }>`SELECT work_order_id FROM task_execution.work_order WHERE task_id=${root.taskId}::uuid ORDER BY work_order_id FOR UPDATE`.execute(
      trx,
    )
  ).rows;
  const ids = target.objectType === TASK ? workOrders.map((w) => w.work_order_id) : [root.id];
  if (ids.length) {
    await sql`SELECT run_id FROM task_execution.run WHERE work_order_id=ANY(${ids}::uuid[]) ORDER BY run_id FOR UPDATE`.execute(
      trx,
    );
    await sql`SELECT request_id FROM task_execution.information_request WHERE task_id=${root.taskId}::uuid ORDER BY request_id FOR UPDATE`.execute(
      trx,
    );
  }
}
async function collect(
  trx: TaskExecutionTransaction,
  target: Ref,
  ports: FormalCompletionPorts,
): Promise<Collection> {
  await ports.authorizeSources(target);
  const root = await readRoot(trx, target);
  const children =
    target.objectType === TASK
      ? (
          await sql<{
            work_order_id: string;
          }>`SELECT work_order_id FROM task_execution.work_order WHERE task_id=${root.id}::uuid ORDER BY work_order_id`.execute(
            trx,
          )
        ).rows
      : [{ work_order_id: root.id }];
  const outputs: Output[] = [],
    contracts: Ref[] = [],
    childRoots: Root[] = [],
    blockers: Ref[] = [];
  let active = false;
  for (const child of children) {
    const childRef = reference(WO, child.work_order_id, root.scope);
    await ports.authorizeSources(childRef);
    const w = await readRoot(trx, childRef);
    childRoots.push(w);
    contracts.push(w.definition);

    const runs = await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('work_order_id', '=', w.id)
      .orderBy('run_id')
      .execute();
    for (const run of runs) {
      const runRef = reference('execution.run', run.run_id, root.scope);
      // JSONB conversion preserves exact database mirrors without JS bigint loss.
      const runMirror = (
        await sql<{
          data: Ref;
        }>`SELECT to_jsonb(r) data FROM task_execution.run r WHERE run_id=${run.run_id}::uuid`.execute(
          trx,
        )
      ).rows[0]?.data;
      active ||= [
        'CREATED',
        'STARTING',
        'RUNNING',
        'RESULT_RECORDED',
        'SUSPENDED',
        'CANCELLING',
      ].includes(run.status);
      const claim = await trx
        .selectFrom('task_execution.work_order_run_claim')
        .selectAll()
        .where('run_id', '=', run.run_id)
        .executeTakeFirst();
      active ||= claim?.status === 'ACTIVE';
      const reservation = (
        await sql<{
          data: Ref;
        }>`SELECT to_jsonb(c) data FROM task_execution.run_final_submission_claim c WHERE run_id=${run.run_id}::uuid`.execute(
          trx,
        )
      ).rows[0]?.data;
      requireThat(runMirror, 'EXECUTION_JUDGMENT_INVALID');

      const result = await trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('run_id', '=', run.run_id)
        .executeTakeFirst();
      if (!result) continue;
      const payload = object(result.result_payload);
      requireThat(
        hashContractPayload(payload) === result.result_payload_hash.toString('hex'),
        'EXECUTION_JUDGMENT_INVALID',
      );
      const resultRef = reference(
        'execution.agent_result',
        result.result_id,
        root.scope,
        result.result_payload_hash.toString('hex'),
      );

      const acceptance = await trx
        .selectFrom('task_execution.agent_result_acceptance')
        .selectAll()
        .where('result_id', '=', result.result_id)
        .executeTakeFirst();

      if (
        run.status === 'SUCCEEDED' &&
        payload.executionOutcome === 'COMPLETED' &&
        acceptance &&
        object(acceptance.canonical_payload).disposition === 'ACCEPTED' &&
        same(run.result_ref, resultRef) &&
        same(
          run.acceptance_ref,
          reference(
            'execution.agent_result_acceptance',
            acceptance.acceptance_id,
            root.scope,
            acceptance.payload_hash.toString('hex'),
          ),
        ) &&
        reservation?.result_id === result.result_id
      ) {
        requireThat(
          sha256CanonicalJson(object(acceptance.canonical_payload)) ===
            acceptance.payload_hash.toString('hex'),
          'EXECUTION_JUDGMENT_INVALID',
        );
        await ports.inspectBundle(object(run.capability_grant_ref), runRef);
        for (const value of payload.businessOutputs as CanonicalJsonValue[])
          outputs.push({
            output: object(value),
            contract: w.definition,
            run: { ...runMirror, resultPayload: payload },
            runRef,
          });
      }
    }
    const requests = (
      await sql<{
        data: Ref;
      }>`SELECT to_jsonb(q) data FROM task_execution.information_request q WHERE work_order_id=${w.id}::uuid ORDER BY request_id`.execute(
        trx,
      )
    ).rows;
    for (const { data: q } of requests) {
      const requestRef = reference(
        'execution.information_request',
        textValue(q.request_id),
        root.scope,
      );

      if (q.status !== 'RESOLVED') blockers.push(requestRef);
    }
    const blocked = (
      await sql<{
        blocked: boolean;
      }>`SELECT task_execution.recovery_work_order_blocked(${w.id}::uuid) blocked`.execute(trx)
    ).rows[0]?.blocked;
    requireThat(typeof blocked === 'boolean');
    if (blocked) blockers.push(childRef);
  }
  const ordered = (
    await sql<{
      sources: Source[];
    }>`SELECT task_execution.completion_local_sources(${target.objectType === TASK ? 'TASK' : 'WORK_ORDER'},${root.id}::uuid,${root.scope.enterpriseId}::uuid,${root.scope.projectId}::uuid) sources`.execute(
      trx,
    )
  ).rows[0]?.sources;
  requireThat(Array.isArray(ordered), 'EXECUTION_JUDGMENT_INVALID');
  requireThat(
    new Set(ordered.map((s) => canonicalize(s.ref))).size === ordered.length,
    'EXECUTION_JUDGMENT_INVALID',
  );
  return {
    root,
    sources: ordered,
    hash: hash(sha256CanonicalJson(sourceJson(ordered))),
    contracts,
    outputs,
    blockers: sorted(blockers),
    active,
    children: childRoots,
  };
}
interface Observation {
  ref: Ref;
  owner: string;
  payload: Ref;
  observationHash: Ref;
  observedAt: string;
}
async function observe(
  trx: TaskExecutionTransaction,
  collection: Collection,
  target: Ref,
  ports: FormalCompletionPorts,
  prior?: Ref,
) {
  const policyRef = collection.contracts.length
    ? formalCompletionPolicy(object(collection.contracts[0]))
    : undefined;
  requireThat(
    policyRef && collection.contracts.every((c) => same(formalCompletionPolicy(c), policyRef)),
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  const policy = await ports.resolvePolicy(policyRef);
  const validation = validateCompletionPolicy(policy);
  requireThat(validation.valid, 'EXECUTION_CRITERION_UNSUPPORTED');
  const policyObservation: Ref = {
    policyRef,
    contentHash: policy.contentHash,
    effectiveFrom: policy.effectiveFrom,
    ...(policy.supersededAt ? { supersededAt: policy.supersededAt } : {}),
  };
  const observations: Observation[] = [];
  const outputRefs: Ref[] = [],
    outputSlots: Ref[] = [];
  let usable = policy.useStatus === 'USABLE',
    revoked = policy.useStatus === 'REVOKED';
  for (const source of collection.outputs) {
    const revisionRef = object(source.output.ref),
      fact = await ports.readExecutionOutput(revisionRef);
    const run = source.run;
    const verified = verifyFormalOutput({
      contract: source.contract,
      contractRef: object(run.work_order_contract_ref),
      contextRef: object(run.context_snapshot_ref),
      runRef: source.runRef,
      output: source.output,
      fact,
      startedAt: new Date(textValue(run.started_at)).toISOString(),
      endedAt: new Date(textValue(run.ended_at)).toISOString(),
      submittedAt: textValue(object(awaitResult(collection, source)).submittedAt),
    });
    usable &&= verified.usable;
    revoked ||= verified.revoked;
    outputRefs.push(revisionRef);
    outputSlots.push(source.output);
    observations.push({
      ref: revisionRef,
      owner: 'artifact',
      payload: fact,
      observationHash: sourceHash(fact),
      observedAt: textValue(fact.observedAt),
    });
  }
  let childUsable = collection.children.length > 0,
    childUntil = Infinity;
  if (target.objectType === TASK) {
    for (const child of collection.children) {
      if (child.status !== 'COMPLETED' || !child.pointer) {
        childUsable = false;
        continue;
      }
      const current = await currentInTransaction(trx, child.pointer, ports);
      childUsable &&= current.useStatus === 'USABLE';
      revoked ||= current.useStatus === 'REVOKED';
      if (current.useStatus === 'USABLE')
        childUntil = Math.min(childUntil, Date.parse(textValue(current.evaluation.validUntil)));
    }
  }
  const definition =
    target.objectType === TASK
      ? validateFormalTaskDefinition(object(collection.root.definition.definition))
      : formalCriteria(collection.root.definition);
  const criteria = definition.criteria;
  let quality: CompletionQualityObservation | undefined;
  if (target.objectType === TASK && 'quality' in definition && definition.quality) {
    const profiles = collection.contracts.map((c) => object(c.versionPins).qualityProfileRef);
    requireThat(
      profiles.length > 0 &&
        profiles[0] &&
        profiles.every((p) => same(p, profiles[0])) &&
        collection.contracts.every((c) =>
          same(object(c.riskAndQuality).qualityProfileRef, profiles[0]),
        ),
      'EXECUTION_CRITERION_UNSUPPORTED',
    );
    requireThat(ports.readQuality, 'DEPENDENCY_UNAVAILABLE');
    quality = await ports.readQuality({
      revisionRefs: sorted(outputRefs),
      qualityProfileRef: object(profiles[0]),
      requireApproval: 'requireApproval' in definition && definition.requireApproval === true,
      ...(prior?.qualitySelection ? { selection: object(prior.qualitySelection) } : {}),
    });
    revoked ||= quality.revoked;
    for (const fact of quality.facts)
      observations.push({
        ref: fact.ref,
        owner: 'quality',
        payload: fact.payload,
        observationHash: sourceHash(fact.payload),
        observedAt: ports.now().toISOString(),
      });
  }
  const expected = definition.output;
  const cardinality =
    outputSlots.filter((o) => o.outputSlot === expected.outputSlot).length === 1 &&
    outputSlots.length === 1;
  const results = criteria
    .map((c) => {
      const type = textValue(c.criterionType);
      const ok =
        type === 'NO_BLOCKING_INFORMATION_REQUEST' || type === 'REQUIRED_PROPOSAL_PROCESSED'
          ? collection.blockers.length === 0
          : type === 'REQUIRED_WORK_ORDERS_COMPLETED'
            ? childUsable
            : type === 'REVISION_ACCEPTANCE_READY' || type === 'REVISION_FULLY_APPROVED'
              ? quality?.usable === true
              : cardinality && usable;
      const reason =
        type === 'NO_BLOCKING_INFORMATION_REQUEST'
          ? 'COMPLETION_BLOCKING_REQUEST'
          : type === 'REQUIRED_PROPOSAL_PROCESSED'
            ? 'COMPLETION_UNPROCESSED_FINAL'
            : type === 'REQUIRED_WORK_ORDERS_COMPLETED'
              ? 'COMPLETION_CHILD_NOT_USABLE'
              : type.startsWith('REVISION_')
                ? 'COMPLETION_QUALITY_NOT_USABLE'
                : outputRefs.length
                  ? 'COMPLETION_OUTPUT_INVALID'
                  : 'COMPLETION_OUTPUT_MISSING';
      return {
        criterionId: c.criterionId,
        criterionType: type,
        required: true,
        outcome: ok ? 'SATISFIED' : 'UNSATISFIED',
        factRefs: ok ? sorted(outputRefs) : [],
        reasonCodes: ok ? [] : [reason],
      };
    })
    .sort((a, b) =>
      Buffer.compare(Buffer.from(textValue(a.criterionId)), Buffer.from(textValue(b.criterionId))),
    );
  const checks = results.map((r) => ({
    checkCode: r.criterionType,
    outcome: r.outcome,
    factRefs: r.factRefs,
    reasonCodes: r.reasonCodes,
  }));
  for (const [code, ok, reason] of [
    ['ACTIVE_RUN_ABSENT', !collection.active, 'COMPLETION_ACTIVE_RUN'],
    [
      'UNPROCESSED_FINAL_BLOCKER_ABSENT',
      collection.blockers.length === 0,
      'COMPLETION_UNPROCESSED_FINAL',
    ],
    ['FORMAL_FACTS_NONEMPTY', outputRefs.length > 0, 'COMPLETION_OUTPUT_MISSING'],
  ] as const)
    checks.push({
      checkCode: code,
      outcome: ok ? 'SATISFIED' : 'UNSATISFIED',
      factRefs: [],
      reasonCodes: ok ? [] : [reason],
    });
  observations.sort((a, b) =>
    Buffer.compare(Buffer.from(canonicalize(a.ref)), Buffer.from(canonicalize(b.ref))),
  );
  requireThat(
    new Set(observations.map((o) => canonicalize(o.ref))).size === observations.length,
    'EXECUTION_JUDGMENT_INVALID',
  );
  const satisfied = usable && childUsable && checks.every((c) => c.outcome === 'SATISFIED');
  const now = ports.now();
  const until = Math.min(
    now.getTime() + validation.rules.maxCompletionValiditySeconds * 1000,
    ports.authorizationValidUntil().getTime(),
    policy.useStatus === 'USABLE' && policy.supersededAt
      ? Date.parse(policy.supersededAt)
      : Infinity,
    childUntil,
    quality?.validUntil ? Date.parse(quality.validUntil) : Infinity,
  );
  return {
    policyRef,
    policyObservation,
    criteria,
    criteriaHash: sourceHash(criteria as unknown as Ref),
    observations,
    outputRefs: sorted(outputRefs),
    factRefs: sorted([...outputRefs, ...(quality?.facts.map((f) => f.ref) ?? [])]),
    results,
    checks,
    satisfied,
    revoked,
    until,
    ...(quality ? { qualitySelection: quality.selection } : {}),
  };
}
// Result times are immutable and were copied into the owning Run observation.
function awaitResult(collection: Collection, source: Output): Ref {
  return object(source.run.resultPayload);
}
async function evaluationRow(trx: TaskExecutionTransaction, ref: Ref) {
  const row = (
    await sql<{
      canonical_payload: Ref;
      payload_hash: Buffer;
    }>`SELECT canonical_payload,payload_hash FROM task_execution.completion_evaluation WHERE evaluation_id=${ref.objectId}::uuid`.execute(
      trx,
    )
  ).rows[0];
  requireThat(
    row &&
      same(ref, evaluationRef(textValue(ref.objectId), object(ref.scope), row.canonical_payload)) &&
      sha256CanonicalJson(row.canonical_payload) === row.payload_hash.toString('hex'),
    'EXECUTION_JUDGMENT_INVALID',
  );
  return row.canonical_payload;
}
async function currentInTransaction(
  trx: TaskExecutionTransaction,
  ref: Ref,
  ports: FormalCompletionPorts,
) {
  const evaluation = await evaluationRow(trx, ref),
    target = object(evaluation.targetRef);
  const collection = await collect(trx, target, ports),
    current = await observe(trx, collection, target, ports, evaluation);
  const observations = (
    await sql<{
      source_ref: Ref;
      canonical_payload: Ref;
    }>`SELECT source_ref,canonical_payload FROM task_execution.completion_source_observation WHERE evaluation_id=${ref.objectId}::uuid`.execute(
      trx,
    )
  ).rows;
  const stable = current.observations.every((o) =>
    observations.some(
      (p) =>
        same(p.source_ref, o.ref) &&
        same(stableObservation(p.canonical_payload), stableObservation(o.payload)),
    ),
  );
  const usable =
    evaluation.outcome === 'SATISFIED' &&
    current.satisfied &&
    stable &&
    same(collection.hash, evaluation.collectionHash) &&
    same(collection.root.pointer, ref) &&
    Number(collection.root.version) === evaluation.committedTargetVersion &&
    same(evaluation.policyObservation, current.policyObservation) &&
    Date.parse(textValue(evaluation.validUntil)) > ports.now().getTime();
  return { evaluation, useStatus: current.revoked ? 'REVOKED' : usable ? 'USABLE' : 'STALE' };
}

export async function handleEvaluateFormalCompletion(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: FormalCompletionPorts,
) {
  const operation = registry.getOperation(envelope.commandType, '2.0');
  requireThat(operation, 'API_VALUE_INVALID');
  const payloadSchema = operationPayloadSchemaRef(operation);
  requireThat(payloadSchema, 'API_VALUE_INVALID');
  requireThat(
    envelope.commandVersion === '2.0' &&
      [WO, TASK].includes(envelope.targetType) &&
      envelope.commandType ===
        (envelope.targetType === WO
          ? 'execution.evaluate_work_order_completion'
          : 'execution.evaluate_task_completion') &&
      envelope.projectId &&
      registry.validateCoreContract(payloadSchema, envelope.requestPayload).valid,
    'API_VALUE_INVALID',
  );
  const target = reference(envelope.targetType, envelope.targetId, {
    enterpriseId: envelope.enterpriseId,
    projectId: envelope.projectId,
  });
  requireScope(target, context);
  requireThat(
    formalEvaluator(
      envelope.requestPayload.evaluatorRef,
      envelope.targetType === WO ? WORK_ORDER_COMPLETION : TASK_COMPLETION,
    ),
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  await ports.revalidateAuthorization();
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const observed = await collect(execution.trx, target, ports);
      requireThat(
        ['COMPLETION_PENDING', 'COMPLETED'].includes(observed.root.status),
        'EXECUTION_COMPLETION_STATE_CONFLICT',
      );
      requireThat(
        observed.root.version === envelope.expectedAggregateVersion,
        'AGGREGATE_VERSION_CONFLICT',
      );
      const facts = await observe(execution.trx, observed, target, ports);
      requireThat(
        same(facts.policyRef, envelope.requestPayload.policyRef),
        'EXECUTION_CRITERION_UNSUPPORTED',
      );
      await lockCompletionParents(execution.trx, target);
      const locked = await collect(execution.trx, target, ports);
      requireThat(
        same(locked.hash, observed.hash) && locked.root.version === observed.root.version,
        'EXECUTION_JUDGMENT_STALE',
      );
      const current = await observe(execution.trx, locked, target, ports);
      requireThat(
        same(
          current.observations.map(({ ref, owner, payload }) => ({
            ref,
            owner,
            payload: stableObservation(payload),
          })),
          facts.observations.map(({ ref, owner, payload }) => ({
            ref,
            owner,
            payload: stableObservation(payload),
          })),
        ) && same(current.policyObservation, facts.policyObservation),
        'EXECUTION_JUDGMENT_STALE',
      );
      await ports.revalidateAuthorization();
      const now = ports.now();
      requireThat(
        Number.isFinite(facts.until) && now.getTime() < facts.until,
        'EXECUTION_JUDGMENT_STALE',
      );
      const transitioned = observed.root.status === 'COMPLETION_PENDING' && facts.satisfied;
      const version = (BigInt(observed.root.version) + 1n).toString(),
        id = newUuidV7();
      const input: Ref = {
        targetRef: target,
        definitionRef: observed.root.definitionRef,
        criteriaHash: facts.criteriaHash,
        policyObservation: facts.policyObservation,
        evaluatorRef: object(envelope.requestPayload.evaluatorRef),
        collectionHash: observed.hash,
        observedLocalSources: sourceJson(observed.sources),
        sourceFacts: facts.observations.map(({ ref, owner, observationHash, observedAt }) => ({
          ref,
          owner,
          observationHash,
          observedAt,
        })),
        ...(facts.qualitySelection ? { qualitySelection: facts.qualitySelection } : {}),
      };
      const evaluation: Ref = {
        ...input,
        judgmentId: id,
        judgmentKind: 'COMPLETION_EVALUATION',
        scopeRef: observed.root.scope,
        subjectRefs: sorted([target, observed.root.definitionRef]),
        inputHash: sourceHash(input),
        policyRef: facts.policyRef,
        producedBy: { principalId: envelope.principalId, principalKind: envelope.principalKind },
        actorSnapshotRef: ports.actorSnapshotRef,
        authorizationDecisionRef: ports.authorizationDecisionRef,
        evaluatedAt: now.toISOString(),
        validUntil: new Date(facts.until).toISOString(),
        sourceWatermarks: [
          {
            sourceModule: 'task_execution',
            sequence: Number(observed.root.version),
            observedAt: now.toISOString(),
          },
        ],
        checks: facts.checks,
        targetKind: target.objectType === WO ? 'WORK_ORDER' : 'TASK',
        observedTargetVersion: Number(observed.root.version),
        committedTargetVersion: Number(version),
        factRefs: facts.factRefs,
        blockerRefs: observed.blockers,
        criterionResults: facts.results as unknown as Ref[],
        outcome: facts.satisfied ? 'SATISFIED' : 'UNSATISFIED',
        completionTransition: transitioned,
      };
      const ref = evaluationRef(id, observed.root.scope, evaluation),
        digest = textValue(object(ref.contentHash).digest);
      requireThat(
        registry.validateCoreContract(
          'https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/completionEvaluation',
          evaluation,
        ).valid,
        'EXECUTION_JUDGMENT_INVALID',
      );
      await sql`INSERT INTO task_execution.completion_evaluation(evaluation_id,target_kind,target_id,enterprise_id,project_id,canonical_payload,payload_hash,source_command_id) VALUES(${id}::uuid,${evaluation.targetKind},${envelope.targetId}::uuid,${envelope.enterpriseId}::uuid,${envelope.projectId}::uuid,${canonicalize(evaluation)}::jsonb,${Buffer.from(digest, 'hex')},${envelope.commandId}::uuid)`.execute(
        execution.trx,
      );
      ports.failAt?.('evaluation');
      for (const o of facts.observations)
        await sql`INSERT INTO task_execution.completion_source_observation(evaluation_id,enterprise_id,project_id,source_ref,canonical_payload,payload_hash) VALUES(${id}::uuid,${envelope.enterpriseId}::uuid,${envelope.projectId}::uuid,${canonicalize(o.ref)}::jsonb,${canonicalize(o.payload)}::jsonb,${Buffer.from(textValue(o.observationHash.digest), 'hex')})`.execute(
          execution.trx,
        );
      ports.failAt?.('observations');
      await sql`SELECT task_execution.commit_completion(${envelope.targetType === WO ? 'WORK_ORDER' : 'TASK'},${envelope.targetId}::uuid,${observed.root.version}::bigint,${id}::uuid,${Buffer.from(digest, 'hex')},${envelope.commandId}::uuid)`.execute(
        execution.trx,
      );
      ports.failAt?.('pointer');
      if (transitioned) {
        const type =
          target.objectType === WO ? 'execution.WorkOrderCompleted' : 'execution.TaskCompleted';
        const payload: Ref = {
          ...(target.objectType === WO
            ? { workOrderRef: target, satisfiedOutputRefs: facts.outputRefs }
            : { taskRef: target, satisfiedFactRefs: facts.factRefs }),
          evaluationRef: ref,
          completedAt: now.toISOString(),
        };
        const event = {
          eventId: newUuidV7(),
          eventType: type,
          eventVersion: '1.0',
          producerModule: 'task-execution',
          aggregateType: textValue(target.objectType),
          aggregateId: envelope.targetId,
          aggregateVersion: Number(version),
          scopeRef: observed.root.scope,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId ?? envelope.commandId,
          commandId: envelope.commandId,
          occurredAt: now.toISOString(),
          actorRef: reference('zhiju.identity.principal', envelope.principalId, {
            enterpriseId: envelope.enterpriseId,
          }),
          dataClassification: 'INTERNAL',
          integrity: { canonicalizationVersion: '1', payloadHash: sourceHash(payload) },
          payload,
        };
        requireThat(registry.validateOperation(type, '1.0', event).valid, 'API_VALUE_INVALID');
        await execution.appendOutbox({
          eventId: event.eventId,
          eventType: type,
          eventVersion: '1.0',
          aggregateType: event.aggregateType,
          aggregateId: envelope.targetId,
          aggregateVersion: version,
          payload,
          scopeMirror: {
            enterpriseId: envelope.enterpriseId,
            projectId: textValue(envelope.projectId),
          },
          occurredAt: now,
        });
      }
      ports.failAt?.('event');
      for (const fact of sorted([
        ref,
        ...facts.factRefs,
        ...observed.blockers,
        observed.root.definitionRef,
      ]))
        await execution.appendReferenceEdge({
          ownerObjectType: envelope.targetType,
          ownerObjectId: envelope.targetId,
          referencePath: `/completion/${id}/${sha256CanonicalJson(fact)}`,
          targetModule: textValue(fact.objectType).startsWith('artifact.')
            ? 'artifact'
            : textValue(fact.objectType).startsWith('quality.')
              ? 'quality_governance'
              : textValue(fact.objectType).startsWith('identity.') ||
                  textValue(fact.objectType).startsWith('zhiju.identity.')
                ? 'identity_policy'
                : 'task_execution',
          targetObjectType: textValue(fact.objectType),
          targetObjectId: textValue(fact.objectId),
          ...(fact.contentHash
            ? { targetPayloadHash: Buffer.from(textValue(object(fact.contentHash).digest), 'hex') }
            : {}),
          referencePurpose: 'EXECUTION_COMPLETION',
        });
      ports.failAt?.('edges');
      await ports.revalidateAuthorization();
      requireThat(ports.now().getTime() < facts.until, 'EXECUTION_JUDGMENT_STALE');
      return {
        kind: 'COMMITTED',
        resultPayload: {
          evaluationRef: ref,
          outcome: textValue(evaluation.outcome),
          transitioned,
          completionUseStatus: facts.satisfied ? 'USABLE' : facts.revoked ? 'REVOKED' : 'STALE',
        },
      } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleGetFormalCompletionJudgment(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: Ref,
  ports: FormalCompletionPorts,
) {
  await ports.revalidateAuthorization();
  requireThat(
    ref.kind === 'CONTENT_ADDRESSED' &&
      ref.objectType === EVALUATION &&
      same(ref.scope, {
        enterpriseId: context.enterpriseId,
        projectId: context.allowedProjectIds[0],
      }),
    'EXECUTION_JUDGMENT_INVALID',
  );
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const evaluation = await evaluationRow(trx, ref),
      target = object(evaluation.targetRef);
    const collection = await collect(trx, target, ports),
      current = await observe(trx, collection, target, ports, evaluation);
    const reasons: string[] = [];
    if (evaluation.outcome !== 'SATISFIED' || !current.satisfied)
      reasons.push('COMPLETION_OUTPUT_INVALID');
    if (Date.parse(textValue(evaluation.validUntil)) <= ports.now().getTime())
      reasons.push('COMPLETION_EXPIRED');
    if (!same(collection.hash, evaluation.collectionHash))
      reasons.push('COMPLETION_SOURCE_CHANGED');
    if (!same(collection.root.pointer, ref)) reasons.push('COMPLETION_EVALUATION_SUPERSEDED');
    if (Number(collection.root.version) !== evaluation.committedTargetVersion)
      reasons.push('COMPLETION_SOURCE_CHANGED');
    if (!same(evaluation.policyObservation, current.policyObservation))
      reasons.push('COMPLETION_POLICY_NOT_USABLE');
    const observations = (
      await sql<{
        source_ref: Ref;
        canonical_payload: Ref;
      }>`SELECT source_ref,canonical_payload FROM task_execution.completion_source_observation WHERE evaluation_id=${ref.objectId}::uuid`.execute(
        trx,
      )
    ).rows;
    if (
      !current.observations.every((o) =>
        observations.some(
          (p) =>
            same(p.source_ref, o.ref) &&
            same(stableObservation(p.canonical_payload), stableObservation(o.payload)),
        ),
      )
    )
      reasons.push('COMPLETION_SOURCE_CHANGED');
    await ports.revalidateAuthorization();
    return {
      judgmentRef: ref,
      evaluation,
      useStatus: current.revoked ? 'REVOKED' : reasons.length ? 'STALE' : 'USABLE',
      reasonCodes: sorted(reasons),
      checkedAt: ports.now().toISOString(),
      sourceWatermarks: [
        {
          sourceModule: 'task_execution',
          sequence: Number(collection.root.version),
          observedAt: ports.now().toISOString(),
        },
      ],
    };
  });
}

export async function handleGetFormalWorkOrderState(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: Ref,
  ports: FormalCompletionPorts,
) {
  await ports.revalidateAuthorization();
  requireScope(ref, context);
  requireThat(ref.objectType === WO, 'NOT_FOUND');
  const state = await withTaskExecutionTransaction(db, context, (trx) => collect(trx, ref, ports));
  const current = state.root.pointer
    ? await handleGetFormalCompletionJudgment(db, context, state.root.pointer, ports)
    : undefined;
  await ports.revalidateAuthorization();
  return {
    workOrderRef: ref,
    aggregateVersion: Number(state.root.version),
    contractRef: state.root.definitionRef,
    status: state.root.status,
    runRefs: state.sources.filter((s) => s.ref.objectType === 'execution.run').map((s) => s.ref),
    blockerRefs: state.blockers,
    completionUseStatus: current?.useStatus ?? 'NOT_EVALUATED',
    ...(state.root.pointer ? { completionEvaluationRef: state.root.pointer } : {}),
  };
}

/** Current Task Completion is consumed under the caller-specific source authority. */
export function createDependencyCompletionPort(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ports: FormalCompletionPorts,
) {
  const consumed = new Map<string, { taskRef: Ref; evaluationRef: Ref; useStatus: string }>();
  return {
    revalidate: async () => {
      await ports.revalidateAuthorization();
      for (const value of consumed.values()) {
        const current = await handleGetFormalCompletionJudgment(
          db,
          context,
          value.evaluationRef,
          ports,
        );
        requireThat(current.useStatus === value.useStatus, 'DEPENDENCY_UNAVAILABLE');
      }
    },
    async read(taskRef: Ref) {
      await ports.revalidateAuthorization();
      requireScope(taskRef, context);
      requireThat(taskRef.objectType === TASK, 'NOT_FOUND');
      await ports.authorizeSources(taskRef);
      const root = await withTaskExecutionTransaction(db, context, (trx) => readRoot(trx, taskRef));
      requireThat(root.status === 'COMPLETED' && root.pointer, 'DEPENDENCY_UNAVAILABLE');
      const current = await handleGetFormalCompletionJudgment(db, context, root.pointer, ports);
      consumed.set(canonicalize(taskRef), {
        taskRef,
        evaluationRef: root.pointer,
        useStatus: current.useStatus,
      });
      return {
        evaluationRef: root.pointer,
        useStatus: current.useStatus as 'USABLE' | 'STALE' | 'REVOKED',
        validUntil: textValue(current.evaluation.validUntil),
      };
    },
  };
}
