import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { getContractRegistry } from '@zhiju/contracts';
import {
  canonicalize,
  sha256CanonicalJson,
  hashContractPayload,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
  type CommandExecution,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  hash,
  object,
  requireThat,
  same,
  textValue,
  digest,
} from './work-order-validation-plan.js';
import { validateWorkOrderControlsPolicy } from './policy-profiles.js';

const registry = getContractRegistry();
const REQUEST = 'execution.information_request';
const ANSWER = 'execution.information_answer';
const RESOLUTION = 'execution.information_request_resolution';
const INVALID_RECEIPT = 'EXECUTION_RESOLUTION_RECEIPT_INVALID';
const ANSWER_CONFLICT = 'EXECUTION_INFORMATION_ANSWER_CONFLICT';
export type RecoveryConsumer =
  | 'request_open'
  | 'answer_submit'
  | 'request_resolve'
  | 'frozen_context_build'
  | 'retry_schedule'
  | 'work_order_reconcile'
  | 'task_reconcile'
  | 'work_order_state'
  | 'task_state'
  | 'bundle_issue'
  | 'run_create'
  | 'runtime_dispatch'
  | 'run_start'
  | 'result_submit'
  | 'result_record'
  | 'result_validate'
  | 'result_accept'
  | 'run_finalize'
  | 'driver_template'
  | 'output_creation';
export interface RecoveryPorts {
  readonly now: () => Date;
  readonly trustedEntryAt: string;
  readonly validUntil: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  /** Each call obtains its own current consumer-specific Decision before the owning read. */
  readonly authorizeLocalRead: (
    dependency: 'source' | 'answer' | 'contract' | 'context',
    target: CanonicalJsonObject,
    payload: CanonicalJsonObject,
  ) => Promise<void>;
  readonly resolveControls: (policyRef: CanonicalJsonObject) => Promise<{
    policyRef: CanonicalJsonObject;
    policySchemaRefs: readonly unknown[];
    policyDocument: unknown;
    useStatus: string;
    supersededAt?: string;
  }>;
  readonly readMaterial: (input: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly readReceipt: (receiptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly readHuman: (input: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly failAfterOutbox?: boolean;
}
export function recoveryScope(envelope: CommandEnvelope): {
  enterpriseId: string;
  projectId: string;
} {
  requireThat(envelope.projectId !== undefined, 'SCOPE_MISMATCH');
  return { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
}
export function recoveryRef(
  type: string,
  id: string,
  scope: CanonicalJsonObject,
  content?: CanonicalJsonObject,
): CanonicalJsonObject {
  return {
    kind: content === undefined ? 'OBJECT' : 'CONTENT_ADDRESSED',
    objectType: type,
    objectId: id,
    scope,
    ...(content === undefined
      ? {}
      : {
          contentHash: hash(
            type === 'zhiju.contract.work_order'
              ? hashContractPayload(content)
              : sha256CanonicalJson(content),
          ),
        }),
  };
}
export function canonicalSet(values: readonly CanonicalJsonValue[]): CanonicalJsonValue[] {
  const entries = new Map(values.map((v) => [canonicalize(v), v]));
  return [...entries]
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([, v]) => v);
}
function exact(value: unknown, keys: readonly string[]) {
  const o = object(value);
  requireThat(
    Object.keys(o).length === keys.length && keys.every((k) => k in o),
    'EXECUTION_INFORMATION_ANSWER_SPEC_MISMATCH',
  );
  return o;
}
function list(value: unknown): CanonicalJsonValue[] {
  requireThat(Array.isArray(value));
  return value as CanonicalJsonValue[];
}
export async function recoveryGuard(ports: RecoveryPorts) {
  await ports.revalidateAuthorization();
  requireThat(
    ports.validUntil().getTime() > ports.now().getTime(),
    'AUTHORIZATION_DECISION_INVALID',
  );
}
export async function insertRecoveryCommandMaterial(ex: CommandExecution, env: CommandEnvelope) {
  await sql`INSERT INTO task_execution.recovery_command_material(command_id,enterprise_id,project_id,request_payload,request_payload_hash)
 VALUES(${env.commandId},${env.enterpriseId},${env.projectId},${canonicalize(env.requestPayload)}::jsonb,${Buffer.from(sha256CanonicalJson(env.requestPayload), 'hex')})`.execute(
    ex.trx,
  );
}
/** Index the actual reference-only bindings in the same owning transaction. */
export async function appendRecoveryEdges(
  ex: CommandExecution,
  env: CommandEnvelope,
  payload: CanonicalJsonObject,
  fact: 'origin' | 'answer' | 'resolution' | 'context-build' | 'retry-intent',
) {
  const visit = async (value: CanonicalJsonValue, path: string): Promise<void> => {
    if (Array.isArray(value)) {
      for (const [i, item] of (value as CanonicalJsonValue[]).entries())
        await visit(item, `${path}/${i}`);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const ref = value as CanonicalJsonObject;
    if (
      typeof ref.kind === 'string' &&
      ['OBJECT', 'CONTENT_ADDRESSED', 'VERSIONED', 'SNAPSHOT'].includes(ref.kind) &&
      typeof ref.objectType === 'string' &&
      typeof ref.objectId === 'string'
    ) {
      const module =
        ref.objectType.includes('.identity.') || ref.objectType.startsWith('identity.')
          ? 'identity-policy'
          : ref.objectType.includes('.project.')
            ? 'enterprise-project'
            : 'task-execution';
      await ex.appendReferenceEdge({
        ownerObjectType: env.targetType,
        ownerObjectId: env.targetId,
        referencePath: path,
        targetModule: module,
        targetObjectType: ref.objectType,
        targetObjectId: ref.objectId,
        ...(typeof ref.versionId === 'string' ? { targetVersionId: ref.versionId } : {}),
        ...(ref.contentHash === undefined
          ? {}
          : { targetPayloadHash: Buffer.from(digest(ref.contentHash), 'hex') }),
        referencePurpose: 'RECOVERY_BINDING',
      });
      return;
    }
    for (const [key, item] of Object.entries(value)) await visit(item, `${path}/${key}`);
  };
  await visit(payload, `/recovery/${fact}`);
}
export interface RecoveryRequestRow {
  request_id: string;
  enterprise_id: string;
  project_id: string;
  work_order_id: string;
  task_id: string;
  definition: CanonicalJsonObject;
  definition_hash: Buffer;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  aggregate_version: string;
  expires_at: Date;
  accepted_answer_ref: CanonicalJsonObject | null;
  resolution_ref: CanonicalJsonObject | null;
}
interface RecoveryOriginRow {
  request_id: string;
  source_result_ref: CanonicalJsonObject;
  source_acceptance_ref: CanonicalJsonObject;
  previous_run_ref: CanonicalJsonObject;
  work_order_contract_ref: CanonicalJsonObject;
  proposal_id: string;
}
interface RecoveryFactRow {
  canonical_payload: CanonicalJsonObject;
  payload_hash: Buffer;
}
export async function readRecoveryRequest(trx: TaskExecutionTransaction, id: string, lock = false) {
  return (
    await (
      lock
        ? sql<RecoveryRequestRow>`SELECT * FROM task_execution.information_request WHERE request_id=${id} FOR UPDATE`
        : sql<RecoveryRequestRow>`SELECT * FROM task_execution.information_request WHERE request_id=${id}`
    ).execute(trx)
  ).rows[0];
}
async function origin(trx: TaskExecutionTransaction, id: string) {
  const row = (
    await sql<RecoveryOriginRow>`SELECT * FROM task_execution.information_request_origin WHERE request_id=${id}`.execute(
      trx,
    )
  ).rows[0];
  requireThat(row, 'EXECUTION_INFORMATION_REQUEST_UNRESOLVED');
  return row;
}
export async function recoveryControls(
  trx: TaskExecutionTransaction,
  workOrderId: string,
  ports: RecoveryPorts,
) {
  const root = await trx
    .selectFrom('task_execution.work_order')
    .selectAll()
    .where('work_order_id', '=', workOrderId)
    .executeTakeFirst();
  requireThat(
    root?.frozen_contract_id !== null && root?.frozen_contract_id !== undefined,
    'NOT_FOUND',
  );
  const scope = { enterpriseId: root.enterprise_id, projectId: root.project_id };
  await ports.authorizeLocalRead(
    'contract',
    recoveryRef('zhiju.execution.work_order', workOrderId, scope),
    { workOrderRef: recoveryRef('zhiju.execution.work_order', workOrderId, scope) },
  );
  const contract = await trx
    .selectFrom('task_execution.work_order_contract')
    .selectAll()
    .where('contract_id', '=', root.frozen_contract_id)
    .executeTakeFirst();
  requireThat(
    contract &&
      contract.payload_hash.equals(definedValue(root.frozen_contract_hash)) &&
      hashContractPayload(object(contract.canonical_payload)) ===
        contract.payload_hash.toString('hex'),
    'REFERENCE_INVALID',
  );
  const payload = object(contract.canonical_payload);
  const policyRef = object(object(payload.versionPins).capabilityPolicyRef);
  const policy = await ports.resolveControls(policyRef);
  const profile = validateWorkOrderControlsPolicy(policy);
  requireThat(policy.useStatus === 'USABLE' && same(policy.policyRef, policyRef), 'POLICY_EXPIRED');
  requireThat(
    profile.valid && profile.rules.recovery !== undefined,
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  requireThat(
    root.expires_at === null || root.expires_at > ports.now(),
    'EXECUTION_WORK_ORDER_EXPIRED',
  );
  return {
    root,
    contract: payload,
    contractRef: recoveryRef(
      'zhiju.contract.work_order',
      contract.contract_id,
      { enterpriseId: root.enterprise_id, projectId: root.project_id },
      payload,
    ),
    policyRef,
    profile: profile.rules.recovery,
    validUntil: policy.supersededAt,
  };
}
export async function appendRecoveryEvent(
  ex: CommandExecution,
  env: CommandEnvelope,
  type: string,
  payload: CanonicalJsonObject,
  version: string,
  at: Date,
  options: { eventVersion: string; aggregateType: string } = {
    eventVersion: '1.0',
    aggregateType: REQUEST,
  },
) {
  const event = {
    eventId: newUuidV7(),
    eventType: type,
    eventVersion: options.eventVersion,
    producerModule: 'task-execution',
    aggregateType: options.aggregateType,
    aggregateId: env.targetId,
    aggregateVersion: Number(version),
    scopeRef: recoveryScope(env),
    correlationId: env.correlationId,
    causationId: env.commandId,
    commandId: env.commandId,
    actorRef: recoveryRef('zhiju.identity.principal', env.principalId, recoveryScope(env)),
    occurredAt: at.toISOString(),
    dataClassification: 'INTERNAL',
    payload,
    integrity: { canonicalizationVersion: '1', payloadHash: hash(sha256CanonicalJson(payload)) },
  };
  requireThat(
    registry.validateOperation(type, options.eventVersion, event).valid,
    'API_VALUE_INVALID',
  );
  await ex.appendOutbox({
    eventId: event.eventId,
    eventType: type,
    eventVersion: options.eventVersion,
    aggregateType: options.aggregateType,
    aggregateId: env.targetId,
    aggregateVersion: version,
    payload,
    scopeMirror: recoveryScope(env),
    causationId: env.commandId,
    occurredAt: at,
  });
}

export async function handleOpenRecoveryRequest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  requireThat(
    env.commandType === 'execution.open_information_request' &&
      env.commandVersion === '1.0' &&
      env.targetType === REQUEST &&
      env.principalKind === 'SERVICE',
  );
  const definition = object(env.requestPayload.definition);
  const scope = recoveryScope(env);
  const workOrderRef = object(definition.workOrderRef);
  const taskRef = object(definition.taskRef);
  const runRef = object(definition.runRef);
  requireThat(
    same(workOrderRef.scope, scope) && same(taskRef.scope, scope) && same(runRef.scope, scope),
    'SCOPE_MISMATCH',
  );
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      await insertRecoveryCommandMaterial(ex, env);
      await ex.trx
        .selectFrom('task_execution.work_order')
        .selectAll()
        .where('work_order_id', '=', textValue(workOrderRef.objectId))
        .forUpdate()
        .executeTakeFirst();
      const deps = await recoveryControls(ex.trx, textValue(workOrderRef.objectId), ports);
      const related = list(definition.relatedRefs);
      const sourceRef = related.map(object).find((r) => r.objectType === 'execution.agent_result');
      requireThat(sourceRef);
      await ports.authorizeLocalRead(
        'source',
        recoveryRef('execution.agent_result', textValue(sourceRef.objectId), scope),
        { sourceAgentResultRef: sourceRef, previousRunRef: runRef },
      );
      const result = await ex.trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('result_id', '=', textValue(sourceRef.objectId))
        .executeTakeFirst();
      const run = await ex.trx
        .selectFrom('task_execution.run')
        .selectAll()
        .where('run_id', '=', textValue(runRef.objectId))
        .executeTakeFirst();
      const acceptance = await ex.trx
        .selectFrom('task_execution.agent_result_acceptance')
        .selectAll()
        .where('result_id', '=', textValue(sourceRef.objectId))
        .executeTakeFirst();
      requireThat(
        result &&
          run &&
          acceptance &&
          run.status === 'SUCCEEDED' &&
          run.run_id === result.run_id &&
          run.work_order_id === deps.root.work_order_id &&
          same(run.work_order_contract_ref, deps.contractRef) &&
          same(run.result_ref, sourceRef),
        'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
      );
      const resultPayload = object(result.result_payload);
      const proposals = list(resultPayload.inputRequestProposals);
      requireThat(resultPayload.executionOutcome === 'BLOCKED_INPUT' && proposals.length === 1);
      const proposal = object(proposals[0]);
      const answerSpec = object(proposal.expectedAnswerSpec);
      const acceptanceRef = recoveryRef(
        'execution.agent_result_acceptance',
        acceptance.acceptance_id,
        scope,
        object(acceptance.canonical_payload),
      );
      requireThat(
        same(run.acceptance_ref, acceptanceRef) &&
          object(acceptance.canonical_payload).disposition === 'ACCEPTED',
        'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
      );
      const existing = (
        await sql<RecoveryRequestRow>`SELECT q.* FROM task_execution.information_request q JOIN task_execution.information_request_origin o USING(request_id) WHERE o.source_result_id=${result.result_id} AND o.proposal_id=${textValue(proposal.proposalId)}`.execute(
          ex.trx,
        )
      ).rows[0];
      if (existing) {
        requireThat(
          same(existing.definition, definition),
          'EXECUTION_AGENT_RESULT_REPLAY_CONFLICT',
        );
        await recoveryGuard(ports);
        return {
          kind: 'COMMITTED' as const,
          resultPayload: {
            informationRequestRef: recoveryRef(REQUEST, existing.request_id, scope),
          },
        };
      }
      for (const key of ['requestType', 'question', 'reason', 'expectedAnswerSpec', 'blocking'])
        requireThat(same(definition[key], proposal[key]), 'EXECUTION_AGENT_RESULT_REPLAY_CONFLICT');
      requireThat(
        same(definition.taskRef, deps.contract.taskRef) &&
          same(proposal.targetRefs, canonicalSet([workOrderRef, taskRef])),
      );
      const requiredSources = list(answerSpec.requiredSourceRefs);
      const candidate = object(answerSpec.candidateMaterialRef);
      await ports.readMaterial({
        candidateMaterialRef: candidate,
        requiredSourceRefs: requiredSources,
      });
      requireThat(
        same(
          related,
          canonicalSet([
            sourceRef,
            acceptanceRef,
            candidate,
            ...requiredSources,
            ...list(proposal.targetRefs),
          ]),
        ) &&
          same(definition.requestedResponder, {
            principalKind: 'HUMAN',
            roleCode: deps.profile.responderRole,
            scopeRef: scope,
          }) &&
          definition.dueAt === undefined,
      );
      const expiresAt = new Date(
        Math.min(
          ports.validUntil().getTime(),
          deps.root.expires_at?.getTime() ?? Infinity,
          typeof deps.contract.expiresAt === 'string'
            ? Date.parse(deps.contract.expiresAt)
            : Infinity,
        ),
      );
      requireThat(
        definition.expiresAt === expiresAt.toISOString() && expiresAt > ports.now(),
        'EXECUTION_WORK_ORDER_EXPIRED',
      );
      await recoveryGuard(ports);
      await sql`INSERT INTO task_execution.information_request(request_id,enterprise_id,project_id,work_order_id,task_id,definition,definition_hash,status,aggregate_version,expires_at,source_command_id,last_command_id)
  VALUES(${env.targetId},${env.enterpriseId},${env.projectId},${workOrderRef.objectId},${taskRef.objectId},${canonicalize(definition)}::jsonb,${Buffer.from(sha256CanonicalJson(definition), 'hex')},'OPEN',1,${expiresAt},${env.commandId},${env.commandId})`.execute(
        ex.trx,
      );
      const originPayload = {
        informationRequestRef: recoveryRef(REQUEST, env.targetId, scope),
        sourceAgentResultRef: sourceRef,
        sourceAcceptanceRef: acceptanceRef,
        previousRunRef: runRef,
        workOrderContractRef: deps.contractRef,
        proposalId: textValue(proposal.proposalId),
        definitionHash: hash(sha256CanonicalJson(definition)),
      };
      await sql`INSERT INTO task_execution.information_request_origin(request_id,enterprise_id,project_id,source_result_id,proposal_id,source_result_ref,source_acceptance_ref,previous_run_ref,work_order_contract_ref,definition_hash,canonical_payload,payload_hash,source_command_id)
  VALUES(${env.targetId},${env.enterpriseId},${env.projectId},${result.result_id},${proposal.proposalId},${canonicalize(sourceRef)}::jsonb,${canonicalize(acceptanceRef)}::jsonb,${canonicalize(runRef)}::jsonb,${canonicalize(deps.contractRef)}::jsonb,${Buffer.from(sha256CanonicalJson(definition), 'hex')},${canonicalize(originPayload)}::jsonb,${Buffer.from(sha256CanonicalJson(originPayload), 'hex')},${env.commandId})`.execute(
        ex.trx,
      );
      await appendRecoveryEdges(ex, env, originPayload, 'origin');
      await appendRecoveryEvent(
        ex,
        env,
        'execution.InformationRequestOpened',
        {
          informationRequestRef: recoveryRef(REQUEST, env.targetId, scope),
          workOrderRef,
          blocking: true,
          requestedResponder: object(definition.requestedResponder),
          deliveryPurpose: 'execution.information_request.human_read',
        },
        '1',
        ports.now(),
      );
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return {
        kind: 'COMMITTED' as const,
        resultPayload: { informationRequestRef: recoveryRef(REQUEST, env.targetId, scope) },
      };
    },
    () => recoveryGuard(ports),
  );
}

async function requireCurrentRequest(
  q: RecoveryRequestRow,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  requireThat(q.enterprise_id === env.enterpriseId && q.project_id === env.projectId, 'NOT_FOUND');
  requireThat(q.expires_at > ports.now(), 'EXECUTION_INFORMATION_REQUEST_UNRESOLVED');
  const human = await ports.readHuman({
    principalRef: { principalKind: 'HUMAN', principalId: env.principalId },
    scopeRef: recoveryScope(env),
    roleCode: 'project.customer_material.confirmer',
  });
  requireThat(human.useStatus === 'USABLE', 'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED');
}

export async function handleSubmitRecoveryAnswer(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  requireThat(
    env.commandType === 'execution.submit_information_answer' &&
      env.commandVersion === '1.0' &&
      env.targetType === REQUEST &&
      env.principalKind === 'HUMAN',
    'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED',
  );
  const answer = object(env.requestPayload.answer);
  const answerId = textValue(answer.answerId);
  const scope = recoveryScope(env);
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      const q = await readRecoveryRequest(ex.trx, env.targetId, true);
      requireThat(q, 'NOT_FOUND');
      await requireCurrentRequest(q, env, ports);
      await recoveryControls(ex.trx, q.work_order_id, ports);
      const responder = recoveryRef('zhiju.identity.principal', env.principalId, scope);
      requireThat(same(answer.responder, responder), 'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED');
      const spec = object(q.definition.expectedAnswerSpec);
      const content = exact(answer.answerContent, ['candidateMaterialRef', 'confirmedMaterialRef']);
      requireThat(
        same(content.candidateMaterialRef, spec.candidateMaterialRef) &&
          same(answer.sourceRefs, spec.requiredSourceRefs) &&
          answer.channelSourceRef === undefined,
        'EXECUTION_INFORMATION_ANSWER_SPEC_MISMATCH',
      );
      const copy = { ...answer };
      delete copy.payloadHash;
      requireThat(
        same(answer.payloadHash, hash(sha256CanonicalJson(copy))),
        'PAYLOAD_HASH_MISMATCH',
      );
      const confirmed = object(content.confirmedMaterialRef),
        candidate = object(content.candidateMaterialRef);
      requireThat(
        confirmed.kind === 'VERSIONED' &&
          confirmed.objectType === candidate.objectType &&
          confirmed.objectId === candidate.objectId &&
          confirmed.versionId !== candidate.versionId &&
          same(confirmed.scope, scope),
        'EXECUTION_INFORMATION_ANSWER_SPEC_MISMATCH',
      );
      await ports.readMaterial({
        candidateMaterialRef: definedValue(content.candidateMaterialRef),
        requiredSourceRefs: definedValue(spec.requiredSourceRefs),
      });
      const old = (
        await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.answer_submission WHERE request_id=${q.request_id}`.execute(
          ex.trx,
        )
      ).rows[0];
      if (old) {
        requireThat(
          same(old.canonical_payload.answer, answer) && old.canonical_payload.answerId === answerId,
          ANSWER_CONFLICT,
        );
        await recoveryGuard(ports);
        return {
          kind: 'COMMITTED' as const,
          resultPayload: { answerRef: recoveryRef(ANSWER, answerId, scope, old.canonical_payload) },
        };
      }
      requireThat(
        q.status === 'OPEN' && q.aggregate_version === env.expectedAggregateVersion,
        'CONCURRENCY_CONFLICT',
      );
      requireThat(
        answer.submittedAt === ports.trustedEntryAt &&
          Date.parse(ports.trustedEntryAt) < q.expires_at.getTime(),
        'EXECUTION_INFORMATION_ANSWER_SPEC_MISMATCH',
      );
      await recoveryGuard(ports);
      await insertRecoveryCommandMaterial(ex, env);
      const recordedAt = ports.now().toISOString();
      const payload: CanonicalJsonObject = {
        answerId,
        informationRequestRef: recoveryRef(REQUEST, q.request_id, scope),
        answer,
        actorSnapshotRef: recoveryRef('zhiju.identity.actor_snapshot', env.actorSnapshotId, scope),
        authorizationDecisionRef: recoveryRef(
          'zhiju.identity.authorization_decision',
          env.authorizationDecisionId,
          scope,
        ),
        recordedAt,
      };
      await sql`UPDATE task_execution.information_request SET status='ANSWERED',aggregate_version=aggregate_version+1,last_command_id=${env.commandId} WHERE request_id=${q.request_id} AND aggregate_version=${q.aggregate_version}`.execute(
        ex.trx,
      );
      await sql`INSERT INTO task_execution.answer_submission(answer_id,request_id,enterprise_id,project_id,canonical_payload,payload_hash,recorded_at,source_command_id)
   VALUES(${answerId},${q.request_id},${env.enterpriseId},${env.projectId},${canonicalize(payload)}::jsonb,${Buffer.from(sha256CanonicalJson(payload), 'hex')},${recordedAt}::timestamptz,${env.commandId})`.execute(
        ex.trx,
      );
      await appendRecoveryEdges(ex, env, payload, 'answer');
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return {
        kind: 'COMMITTED' as const,
        resultPayload: { answerRef: recoveryRef(ANSWER, answerId, scope, payload) },
      };
    },
    () => recoveryGuard(ports),
  );
}

async function proveRecoveryReceipt(
  q: RecoveryRequestRow,
  answer: CanonicalJsonObject,
  receiptRef: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  const spec = object(q.definition.expectedAnswerSpec),
    content = object(answer.answerContent),
    responder = object(answer.responder);
  let attestation: CanonicalJsonObject;
  try {
    attestation = await ports.readReceipt(receiptRef);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('PROJECT_QUERY_')
    )
      requireThat(false, INVALID_RECEIPT);
    throw error;
  }
  const scope = { enterpriseId: q.enterprise_id, projectId: q.project_id };
  const candidate = object(content.candidateMaterialRef),
    confirmed = object(content.confirmedMaterialRef);
  requireThat(
    same(attestation.commandReceiptRef, receiptRef) &&
      attestation.commandType === 'project.confirm_customer_material' &&
      attestation.commandVersion === '1.0' &&
      attestation.outcome === 'COMMITTED' &&
      same(attestation.scopeRef, scope) &&
      same(attestation.candidateVersionRef, candidate) &&
      same(attestation.confirmedVersionRef, confirmed) &&
      same(
        attestation.targetRef,
        recoveryRef('zhiju.project.customer_material', textValue(candidate.objectId), scope),
      ) &&
      same(attestation.sourceMaterialRefs, spec.requiredSourceRefs) &&
      same(answer.sourceRefs, spec.requiredSourceRefs) &&
      same(candidate, spec.candidateMaterialRef) &&
      same(attestation.actorRef, {
        principalKind: 'HUMAN',
        principalId: textValue(responder.objectId),
      }),
    INVALID_RECEIPT,
  );
  await ports.readMaterial({
    candidateMaterialRef: candidate,
    confirmedMaterialRef: confirmed,
    requiredSourceRefs: definedValue(spec.requiredSourceRefs),
  });
  const human = await ports.readHuman({
    principalRef: { principalKind: 'HUMAN', principalId: textValue(responder.objectId) },
    scopeRef: scope,
    roleCode: 'project.customer_material.confirmer',
    confirmationActorSnapshotRef: definedValue(attestation.actorSnapshotRef),
    confirmationAuthorizationDecisionRef: definedValue(attestation.authorizationDecisionRef),
    confirmationTargetRef: definedValue(attestation.targetRef),
    confirmationRequestPayloadHash: definedValue(attestation.requestPayloadHash),
    confirmationCommittedAt: definedValue(attestation.committedAt),
  });
  requireThat(
    human.useStatus === 'USABLE' && human.confirmationProvenanceValid === true,
    INVALID_RECEIPT,
  );
  return { attestation, human };
}

export async function handleResolveRecoveryRequest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  requireThat(
    env.commandType === 'execution.resolve_information_request' &&
      env.commandVersion === '1.0' &&
      env.targetType === REQUEST &&
      env.principalKind === 'HUMAN',
    'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED',
  );
  const scope = recoveryScope(env),
    request = env.requestPayload;
  requireThat(
    same(request.resolvedBy, recoveryRef('zhiju.identity.principal', env.principalId, scope)),
    'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED',
  );
  const receiptRefs = list(request.domainCommandRefs);
  requireThat(
    receiptRefs.length === 1 &&
      request.resolutionDisposition === 'execution.resolution.customer_material_confirmed',
    INVALID_RECEIPT,
  );
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      const q = await readRecoveryRequest(ex.trx, env.targetId, true);
      requireThat(q, 'NOT_FOUND');
      await requireCurrentRequest(q, env, ports);
      await recoveryControls(ex.trx, q.work_order_id, ports);
      await ports.authorizeLocalRead('answer', recoveryRef(REQUEST, q.request_id, scope), {
        informationRequestRef: recoveryRef(REQUEST, q.request_id, scope),
        acceptedAnswerRef: definedValue(request.acceptedAnswerRef),
      });
      const a = (
        await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.answer_submission WHERE request_id=${q.request_id}`.execute(
          ex.trx,
        )
      ).rows[0];
      requireThat(a, 'EXECUTION_INFORMATION_REQUEST_UNRESOLVED');
      requireThat(
        sha256CanonicalJson(a.canonical_payload) === a.payload_hash.toString('hex'),
        'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
      );
      const answer = object(a.canonical_payload.answer);
      const answerRef = recoveryRef(
        ANSWER,
        textValue(a.canonical_payload.answerId),
        scope,
        a.canonical_payload,
      );
      requireThat(
        same(answerRef, request.acceptedAnswerRef) && same(answer.responder, request.resolvedBy),
        'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED',
      );
      const { attestation } = await proveRecoveryReceipt(q, answer, object(receiptRefs[0]), ports);
      const prior = (
        await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.answer_resolution WHERE request_id=${q.request_id}`.execute(
          ex.trx,
        )
      ).rows[0];
      if (prior) {
        for (const k of [
          'acceptedAnswerRef',
          'domainCommandRefs',
          'resolutionDisposition',
          'resolvedBy',
        ])
          requireThat(same(prior.canonical_payload[k], request[k]), ANSWER_CONFLICT);
        await recoveryGuard(ports);
        return {
          kind: 'COMMITTED' as const,
          resultPayload: {
            resolutionRef: recoveryRef(
              RESOLUTION,
              textValue(prior.canonical_payload.resolutionId),
              scope,
              prior.canonical_payload,
            ),
          },
        };
      }
      requireThat(
        q.status === 'ANSWERED' && q.aggregate_version === env.expectedAggregateVersion,
        'CONCURRENCY_CONFLICT',
      );
      requireThat(
        request.resolvedAt === ports.trustedEntryAt &&
          Date.parse(ports.trustedEntryAt) >=
            Date.parse(textValue(a.canonical_payload.recordedAt)) &&
          Date.parse(ports.trustedEntryAt) >= Date.parse(textValue(attestation.committedAt)),
        INVALID_RECEIPT,
      );
      const source = await origin(ex.trx, q.request_id);
      await recoveryGuard(ports);
      await insertRecoveryCommandMaterial(ex, env);
      const resolutionId = newUuidV7(),
        effectiveAt = ports.now().toISOString();
      const payload: CanonicalJsonObject = {
        resolutionId,
        informationRequestRef: recoveryRef(REQUEST, q.request_id, scope),
        sourceAgentResultRef: source.source_result_ref,
        proposalId: source.proposal_id,
        sourceAcceptanceRef: source.source_acceptance_ref,
        previousRunRef: source.previous_run_ref,
        acceptedAnswerRef: answerRef,
        resolutionDisposition: definedValue(request.resolutionDisposition),
        domainCommandRefs: receiptRefs,
        receiptAttestationHash: hash(sha256CanonicalJson(attestation)),
        confirmationDecisionRef: definedValue(attestation.decisionRef),
        confirmationActorSnapshotRef: definedValue(attestation.actorSnapshotRef),
        confirmationAuthorizationDecisionRef: definedValue(attestation.authorizationDecisionRef),
        resolvedBy: definedValue(request.resolvedBy),
        resolverActorSnapshotRef: recoveryRef(
          'zhiju.identity.actor_snapshot',
          env.actorSnapshotId,
          scope,
        ),
        resolverAuthorizationDecisionRef: recoveryRef(
          'zhiju.identity.authorization_decision',
          env.authorizationDecisionId,
          scope,
        ),
        resolvedAt: ports.trustedEntryAt,
        effectiveAt,
      };
      const resolutionRef = recoveryRef(RESOLUTION, resolutionId, scope, payload);
      await sql`UPDATE task_execution.information_request SET status='RESOLVED',aggregate_version=aggregate_version+1,accepted_answer_ref=${canonicalize(answerRef)}::jsonb,resolution_ref=${canonicalize(resolutionRef)}::jsonb,last_command_id=${env.commandId} WHERE request_id=${q.request_id} AND aggregate_version=${q.aggregate_version}`.execute(
        ex.trx,
      );
      await sql`INSERT INTO task_execution.answer_resolution(resolution_id,request_id,answer_id,enterprise_id,project_id,canonical_payload,payload_hash,effective_at,source_command_id)
   VALUES(${resolutionId},${q.request_id},${a.canonical_payload.answerId},${env.enterpriseId},${env.projectId},${canonicalize(payload)}::jsonb,${Buffer.from(sha256CanonicalJson(payload), 'hex')},${effectiveAt}::timestamptz,${env.commandId})`.execute(
        ex.trx,
      );
      await sql`INSERT INTO task_execution.resolution_receipt_observation(resolution_id,enterprise_id,project_id,canonical_payload,payload_hash,source_command_id)
   VALUES(${resolutionId},${env.enterpriseId},${env.projectId},${canonicalize(attestation)}::jsonb,${Buffer.from(sha256CanonicalJson(attestation), 'hex')},${env.commandId})`.execute(
        ex.trx,
      );
      await appendRecoveryEdges(ex, env, payload, 'resolution');
      await appendRecoveryEvent(
        ex,
        env,
        'execution.InformationRequestResolved',
        {
          informationRequestRef: recoveryRef(REQUEST, q.request_id, scope),
          acceptedAnswerRef: answerRef,
          resolutionRef,
          affectedWorkRefs: canonicalSet([
            definedValue(q.definition.taskRef),
            definedValue(q.definition.workOrderRef),
          ]),
        },
        (BigInt(q.aggregate_version) + 1n).toString(),
        new Date(effectiveAt),
      );
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return { kind: 'COMMITTED' as const, resultPayload: { resolutionRef } };
    },
    () => recoveryGuard(ports),
  );
}

/** Read the immutable Resolution and independently prove its current consumability. */
export async function readRecoveryResolution(
  trx: TaskExecutionTransaction,
  resolutionRef: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  const scope = object(resolutionRef.scope);
  requireThat(
    resolutionRef.kind === 'CONTENT_ADDRESSED' && resolutionRef.objectType === RESOLUTION,
  );
  await ports.authorizeLocalRead(
    'source',
    recoveryRef(RESOLUTION, textValue(resolutionRef.objectId), scope),
    { resolutionRef },
  );
  const row = (
    await sql<
      RecoveryFactRow & { request_id: string }
    >`SELECT * FROM task_execution.answer_resolution WHERE resolution_id=${resolutionRef.objectId}`.execute(
      trx,
    )
  ).rows[0];
  requireThat(row, 'EXECUTION_CONTEXT_SOURCE_INVALID');
  requireThat(
    sha256CanonicalJson(row.canonical_payload) === row.payload_hash.toString('hex') &&
      same(
        resolutionRef,
        recoveryRef(
          RESOLUTION,
          textValue(row.canonical_payload.resolutionId),
          scope,
          row.canonical_payload,
        ),
      ),
    'EXECUTION_CONTEXT_SOURCE_INVALID',
  );
  await ports.authorizeLocalRead('answer', recoveryRef(REQUEST, row.request_id, scope), {
    resolutionRef,
    acceptedAnswerRef: definedValue(row.canonical_payload.acceptedAnswerRef),
  });
  const q = await readRecoveryRequest(trx, row.request_id);
  requireThat(
    q?.status === 'RESOLVED' &&
      same(q.resolution_ref, resolutionRef) &&
      same(scope, { enterpriseId: q.enterprise_id, projectId: q.project_id }),
    'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
  );
  await ports.authorizeLocalRead('answer', recoveryRef(REQUEST, q.request_id, scope), {
    resolutionRef,
    acceptedAnswerRef: definedValue(row.canonical_payload.acceptedAnswerRef),
  });
  requireThat(q.expires_at > ports.now(), 'EXECUTION_CONTEXT_SOURCE_INVALID');
  const a = (
    await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.answer_submission WHERE request_id=${q.request_id}`.execute(
      trx,
    )
  ).rows[0];
  requireThat(a, 'EXECUTION_CONTEXT_SOURCE_INVALID');
  requireThat(sha256CanonicalJson(a.canonical_payload) === a.payload_hash.toString('hex'));
  const answer = object(a.canonical_payload.answer);
  const acceptedAnswerRef = recoveryRef(
    ANSWER,
    textValue(a.canonical_payload.answerId),
    scope,
    a.canonical_payload,
  );
  requireThat(
    same(q.accepted_answer_ref, acceptedAnswerRef) &&
      same(row.canonical_payload.acceptedAnswerRef, acceptedAnswerRef),
    INVALID_RECEIPT,
  );
  const source = await origin(trx, q.request_id);
  requireThat(
    sha256CanonicalJson(q.definition) === q.definition_hash.toString('hex') &&
      same(row.canonical_payload.sourceAgentResultRef, source.source_result_ref) &&
      same(row.canonical_payload.sourceAcceptanceRef, source.source_acceptance_ref) &&
      same(row.canonical_payload.previousRunRef, source.previous_run_ref) &&
      row.canonical_payload.proposalId === source.proposal_id,
    INVALID_RECEIPT,
  );
  await ports.authorizeLocalRead(
    'source',
    recoveryRef('execution.agent_result', textValue(source.source_result_ref.objectId), scope),
    { sourceAgentResultRef: source.source_result_ref, previousRunRef: source.previous_run_ref },
  );
  const previous = await trx
    .selectFrom('task_execution.run')
    .selectAll()
    .where('run_id', '=', textValue(source.previous_run_ref.objectId))
    .executeTakeFirst();
  requireThat(
    previous?.status === 'SUCCEEDED' &&
      previous.work_order_id === q.work_order_id &&
      same(previous.result_ref, source.source_result_ref) &&
      same(previous.acceptance_ref, source.source_acceptance_ref) &&
      same(previous.work_order_contract_ref, source.work_order_contract_ref),
    INVALID_RECEIPT,
  );
  const proof = await proveRecoveryReceipt(
    q,
    answer,
    object(list(row.canonical_payload.domainCommandRefs)[0]),
    ports,
  );
  requireThat(
    same(
      row.canonical_payload.receiptAttestationHash,
      hash(sha256CanonicalJson(proof.attestation)),
    ),
    INVALID_RECEIPT,
  );
  await recoveryGuard(ports);
  return {
    request: q,
    resolution: row.canonical_payload,
    answerFact: a.canonical_payload,
    answer,
    attestation: proof.attestation,
    human: proof.human,
  };
}

export async function handleGetRecoveryRequest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  await recoveryGuard(ports);
  requireThat(ref.kind === 'OBJECT' && ref.objectType === REQUEST);
  const result = await withTaskExecutionTransaction(db, context, async (trx) => {
    const q = await readRecoveryRequest(trx, textValue(ref.objectId));
    requireThat(
      q && same(ref.scope, { enterpriseId: q.enterprise_id, projectId: q.project_id }),
      'NOT_FOUND',
    );
    const answers = (
      await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.answer_submission WHERE request_id=${q.request_id}`.execute(
        trx,
      )
    ).rows;
    const view = {
      informationRequestRef: ref,
      aggregateVersion: Number(q.aggregate_version),
      definition: q.definition,
      status: q.status,
      deliveryRefs: [],
      answerRefs: answers.map((a) =>
        recoveryRef(
          ANSWER,
          textValue(a.canonical_payload.answerId),
          object(ref.scope),
          a.canonical_payload,
        ),
      ),
      ...(q.accepted_answer_ref === null ? {} : { acceptedAnswerRef: q.accepted_answer_ref }),
      ...(q.resolution_ref === null ? {} : { resolutionRef: q.resolution_ref }),
    };
    requireThat(
      registry.validateOperationResult('execution.get_information_request', '1.0', view).valid,
      'API_VALUE_INVALID',
    );
    return view;
  });
  await recoveryGuard(ports);
  return result;
}

export interface RecoveryBlockerFacts {
  readonly blockerRefs: CanonicalJsonValue[];
  readonly unresolved: boolean;
  readonly requestRefs: CanonicalJsonObject[];
  readonly resolutionRefs: CanonicalJsonObject[];
}
/** Complete owning reservations remain barriers before a formal Request exists. */
export async function readRecoveryBlockers(
  trx: TaskExecutionTransaction,
  workOrderId: string,
  scope: CanonicalJsonObject,
): Promise<RecoveryBlockerFacts> {
  const sources = (
    await sql<{
      result_id: string;
      result_payload: CanonicalJsonObject;
      result_payload_hash: Buffer;
      run_id: string;
    }>`SELECT a.result_id,a.result_payload,a.result_payload_hash,a.run_id FROM task_execution.agent_result a JOIN task_execution.run_final_submission_claim f USING(result_id) JOIN task_execution.run r ON r.run_id=a.run_id WHERE r.work_order_id=${workOrderId} AND a.result_payload->>'executionOutcome'='BLOCKED_INPUT' ORDER BY a.result_id`.execute(
      trx,
    )
  ).rows;
  const requests = (
    await sql<RecoveryRequestRow>`SELECT * FROM task_execution.information_request WHERE work_order_id=${workOrderId} ORDER BY request_id`.execute(
      trx,
    )
  ).rows;
  const blockers: CanonicalJsonValue[] = [];
  let unresolved = false;
  for (const q of requests) {
    if (q.status !== 'RESOLVED') {
      blockers.push(recoveryRef(REQUEST, q.request_id, scope));
      unresolved = true;
    }
  }
  for (const source of sources) {
    const associated = (
      await sql<{
        request_id: string;
      }>`SELECT request_id FROM task_execution.information_request_origin WHERE source_result_id=${source.result_id}`.execute(
        trx,
      )
    ).rows;
    const q = requests.find((r) => associated.some((a) => a.request_id === r.request_id));
    const sourceRef: CanonicalJsonObject = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'execution.agent_result',
      objectId: source.result_id,
      scope,
      contentHash: hash(source.result_payload_hash.toString('hex')),
    };
    if (!q) {
      blockers.push(sourceRef);
      unresolved = true;
      continue;
    }
    if (q.status !== 'RESOLVED') continue;
    const successor = (
      await sql<{
        run_id: string;
      }>`SELECT r.run_id FROM task_execution.run_retry_intent_consumption c JOIN task_execution.run r USING(run_id) JOIN task_execution.agent_result a ON a.run_id=r.run_id JOIN task_execution.agent_result_acceptance ac ON ac.result_id=a.result_id WHERE r.work_order_id=${workOrderId} AND r.status='SUCCEEDED' AND a.result_payload->>'executionOutcome'='COMPLETED' AND ac.canonical_payload->>'disposition'='ACCEPTED' AND c.canonical_payload->'resolutionRefs' @> ${canonicalize([definedValue(q.resolution_ref)])}::jsonb`.execute(
        trx,
      )
    ).rows[0];
    if (!successor) blockers.push(sourceRef);
  }
  return {
    blockerRefs: canonicalSet(blockers),
    unresolved,
    requestRefs: requests.map((q) => recoveryRef(REQUEST, q.request_id, scope)),
    resolutionRefs: requests
      .filter((q) => q.status === 'RESOLVED')
      .map((q) => definedValue(q.resolution_ref)),
  };
}

export async function readRecoveryBudget(
  trx: TaskExecutionTransaction,
  workOrderId: string,
  totalSeconds: number,
) {
  const rows = (
    await sql<{
      consumed: string;
      active: string;
    }>`SELECT coalesce(sum(c.consumed_seconds),0)::text AS consumed,count(*) FILTER(WHERE c.run_id IS NULL)::text AS active FROM task_execution.run_budget_reservation r LEFT JOIN task_execution.run_budget_consumption c USING(run_id) WHERE r.work_order_id=${workOrderId}`.execute(
      trx,
    )
  ).rows;
  const consumed = Number(rows[0]?.consumed ?? 0);
  return {
    totalSeconds,
    committedConsumedSeconds: consumed,
    remainingSeconds: totalSeconds - consumed,
    activeReservations: Number(rows[0]?.active ?? 0),
  };
}

export async function handleScheduleRecoveryRetry(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  requireThat(
    env.commandType === 'execution.schedule_work_order_retry' &&
      env.commandVersion === '1.0' &&
      env.targetType === 'zhiju.execution.work_order' &&
      env.principalKind === 'HUMAN',
    'EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED',
  );
  const scope = recoveryScope(env),
    request = env.requestPayload;
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      const root = await ex.trx
        .selectFrom('task_execution.work_order')
        .selectAll()
        .where('work_order_id', '=', env.targetId)
        .forUpdate()
        .executeTakeFirst();
      requireThat(root, 'NOT_FOUND');
      const deps = await recoveryControls(ex.trx, env.targetId, ports);
      const blockers = await readRecoveryBlockers(ex.trx, env.targetId, scope);
      requireThat(
        !blockers.unresolved && blockers.resolutionRefs.length === 1,
        'EXECUTION_INFORMATION_REQUEST_UNRESOLVED',
      );
      const proof = await readRecoveryResolution(
        ex.trx,
        definedValue(blockers.resolutionRefs[0]),
        ports,
      );
      requireThat(
        same(request.previousRunRef, proof.resolution.previousRunRef) &&
          request.retryReason === deps.profile.retryReason &&
          request.nextAttemptNumber === 2 &&
          same(request.retryPolicyRef, deps.policyRef) &&
          request.notBefore === undefined,
        'EXECUTION_RUN_ATTEMPT_CONFLICT',
      );
      const previous = await ex.trx
        .selectFrom('task_execution.run')
        .selectAll()
        .where('run_id', '=', textValue(object(request.previousRunRef).objectId))
        .executeTakeFirst();
      requireThat(previous?.status === 'SUCCEEDED' && previous.attempt_number === 1);
      if (request.selectedRuntimeBinding !== undefined)
        requireThat(
          same(request.selectedRuntimeBinding, previous.runtime_binding),
          'EXECUTION_RUN_ATTEMPT_CONFLICT',
        );
      const old = (
        await sql<RecoveryFactRow>`SELECT canonical_payload,payload_hash FROM task_execution.work_order_retry_intent WHERE work_order_id=${env.targetId} AND next_attempt_number=2`.execute(
          ex.trx,
        )
      ).rows[0];
      if (old) {
        requireThat(
          same(old.canonical_payload.previousRunRef, request.previousRunRef) &&
            same(old.canonical_payload.resolutionRefs, blockers.resolutionRefs) &&
            same(
              old.canonical_payload.scheduledBy,
              recoveryRef('zhiju.identity.principal', env.principalId, scope),
            ),
          'EXECUTION_RUN_ATTEMPT_CONFLICT',
        );
        await recoveryGuard(ports);
        return {
          kind: 'COMMITTED' as const,
          resultPayload: {
            workOrderRef: recoveryRef('zhiju.execution.work_order', env.targetId, scope),
            status: root.status,
          },
        };
      }
      requireThat(
        root.status === 'WAITING_INPUT' && root.aggregate_version === env.expectedAggregateVersion,
        'CONCURRENCY_CONFLICT',
      );
      const claims = await ex.trx
        .selectFrom('task_execution.work_order_run_claim')
        .selectAll()
        .where('work_order_id', '=', env.targetId)
        .execute();
      requireThat(
        claims.length === 1 && claims[0]?.status === 'RELEASED',
        'EXECUTION_ACTIVE_RUN_EXISTS',
      );
      const totalText = textValue(object(deps.contract.budget).wallClockLimit);
      const total = Number(totalText.slice(2, -1));
      requireThat(Number.isSafeInteger(total) && total > 0);
      const budget = await readRecoveryBudget(ex.trx, env.targetId, total);
      requireThat(
        budget.remainingSeconds > 0 && budget.activeReservations === 0,
        'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
      );
      await recoveryGuard(ports);
      await insertRecoveryCommandMaterial(ex, env);
      const intentId = newUuidV7();
      const payload: CanonicalJsonObject = {
        intentId,
        workOrderRef: recoveryRef('zhiju.execution.work_order', env.targetId, scope),
        workOrderContractRef: deps.contractRef,
        previousRunRef: definedValue(request.previousRunRef),
        sourceAgentResultRef: definedValue(proof.resolution.sourceAgentResultRef),
        sourceAcceptanceRef: definedValue(proof.resolution.sourceAcceptanceRef),
        nextAttemptNumber: 2,
        resolutionRefs: blockers.resolutionRefs,
        runtimeBinding: object(previous.runtime_binding),
        retryPolicyRef: deps.policyRef,
        budget: {
          totalSeconds: budget.totalSeconds,
          committedConsumedSeconds: budget.committedConsumedSeconds,
          remainingSeconds: budget.remainingSeconds,
        },
        scheduledAt: ports.now().toISOString(),
        scheduledBy: recoveryRef('zhiju.identity.principal', env.principalId, scope),
        actorSnapshotRef: recoveryRef('zhiju.identity.actor_snapshot', env.actorSnapshotId, scope),
        authorizationDecisionRef: recoveryRef(
          'zhiju.identity.authorization_decision',
          env.authorizationDecisionId,
          scope,
        ),
      };
      await sql`INSERT INTO task_execution.work_order_retry_intent(intent_id,work_order_id,next_attempt_number,enterprise_id,project_id,canonical_payload,payload_hash,source_command_id) VALUES(${intentId},${env.targetId},2,${env.enterpriseId},${env.projectId},${canonicalize(payload)}::jsonb,${Buffer.from(sha256CanonicalJson(payload), 'hex')},${env.commandId})`.execute(
        ex.trx,
      );
      await appendRecoveryEdges(ex, env, payload, 'retry-intent');
      await ex.trx
        .updateTable('task_execution.work_order')
        .set({
          status: 'RETRY_PENDING',
          aggregate_version: (BigInt(root.aggregate_version) + 1n).toString(),
          last_transition_command_id: env.commandId,
        })
        .where('work_order_id', '=', env.targetId)
        .where('aggregate_version', '=', root.aggregate_version)
        .execute();
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return {
        kind: 'COMMITTED' as const,
        resultPayload: {
          workOrderRef: definedValue(payload.workOrderRef),
          status: 'RETRY_PENDING',
        },
      };
    },
    () => recoveryGuard(ports),
  );
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
