// IM-03 WI-12 (issue #68): persistence mapping for formal completion facts,
// immutable evaluations, impact history and the DeliveryItem CAS pointer.
// Domain validation stays in the Application handlers; SQL remains the final
// authority for scope, foreign keys, immutable history and pointer CAS.

import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { DeliveryPlanRepository } from './delivery-plan-repository.js';
import type {
  DeliveryCompletionEvaluationOutcome,
  DeliveryCompletionFactLifecycle,
  DeliveryItemCompletionFactTable,
  DeliveryItemCompletionEvaluationTable,
  DeliveryItemTable,
} from './enterprise-business-types.js';

export interface DeliveryItemCompletionFactInsert {
  factId: string;
  consumerName: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  producerModule: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: string;
  enterpriseId: string;
  projectId: string;
  factRef: unknown;
  factRefs: unknown;
  subjectRefs: unknown;
  lifecycle: DeliveryCompletionFactLifecycle;
  payload: unknown;
  payloadHash: Buffer;
  sourceWatermark: unknown;
  sourceWatermarkHash: Buffer;
  correlationId: string;
  causationId?: string | undefined;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryItemCompletionEvaluationInsert {
  evaluationId: string;
  deliveryPlanId: string;
  versionId: string;
  deliveryItemId: string;
  enterpriseId: string;
  projectId: string;
  criteriaHash: Buffer;
  evaluatorRef: unknown;
  evaluatorRefHash: Buffer;
  evaluatorId: string;
  evaluatorVersionId: string;
  factRefs: unknown;
  factRefsHash: Buffer;
  sourceWatermarks: unknown;
  sourceWatermarksHash: Buffer;
  outcome: DeliveryCompletionEvaluationOutcome;
  payload: unknown;
  payloadHash: Buffer;
  inputFingerprint: Buffer;
  evaluatedAt: Date;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  sourceEventId?: string | undefined;
}

export interface DeliveryItemImpactReviewInsert {
  impactReviewId: string;
  deliveryPlanId: string;
  versionId: string;
  deliveryItemId: string;
  enterpriseId: string;
  projectId: string;
  triggeringRef: unknown;
  priorEvaluationRef?: unknown;
  priorEvaluationId?: string | undefined;
  newEvaluationRef: unknown;
  newEvaluationId: string;
  impactReason: string;
  affectedFactRefs: unknown;
  sourceWatermarks: unknown;
  payload: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryItemCompletionCasInput {
  deliveryPlanId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  deliveryItemId: string;
  expectedAggregateVersion: string;
  expectedEvaluationId: string | null;
  nextEvaluationId: string;
  commandId: string;
}

export type DeliveryItemCompletionCasResult =
  { ok: true; nextVersion: string } | { ok: false; current: DeliveryItemTable | undefined };

function nextAggregateVersion(value: unknown): string {
  try {
    const current = BigInt(String(value));
    if (current < 0n) throw new Error('negative');
    return (current + 1n).toString();
  } catch {
    throw new Error('delivery item completion aggregate version must be a non-negative bigint');
  }
}

export class DeliveryItemCompletionRepository extends DeliveryPlanRepository {
  async getDeliveryItemForUpdate(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    deliveryItemId: string,
  ): Promise<DeliveryItemTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item')
      .selectAll()
      .where('version_id', '=', versionId)
      .where('delivery_item_id', '=', deliveryItemId)
      .forUpdate()
      .executeTakeFirst()) as unknown as DeliveryItemTable | undefined;
  }

  async getCompletionFacts(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<DeliveryItemCompletionFactTable[]> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item_completion_fact')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .orderBy('recorded_at', 'asc')
      .orderBy('fact_id', 'asc')
      .execute()) as unknown as DeliveryItemCompletionFactTable[];
  }

  async getCompletionFactByEvent(
    trx: EnterpriseProjectTransaction,
    consumerName: string,
    eventId: string,
  ): Promise<DeliveryItemCompletionFactTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item_completion_fact')
      .selectAll()
      .where('consumer_name', '=', consumerName)
      .where('event_id', '=', eventId)
      .executeTakeFirst()) as unknown as DeliveryItemCompletionFactTable | undefined;
  }

  async insertCompletionFact(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemCompletionFactInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item_completion_fact')
      .values({
        fact_id: insert.factId,
        consumer_name: insert.consumerName,
        event_id: insert.eventId,
        event_type: insert.eventType,
        event_version: insert.eventVersion,
        producer_module: insert.producerModule,
        aggregate_type: insert.aggregateType,
        aggregate_id: insert.aggregateId,
        aggregate_version: insert.aggregateVersion,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        fact_ref: JSON.stringify(insert.factRef),
        fact_refs: JSON.stringify(insert.factRefs),
        subject_refs: JSON.stringify(insert.subjectRefs),
        lifecycle: insert.lifecycle,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        source_watermark: JSON.stringify(insert.sourceWatermark),
        source_watermark_hash: insert.sourceWatermarkHash,
        correlation_id: insert.correlationId,
        causation_id: insert.causationId ?? null,
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getCompletionEvaluationByFingerprint(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
    versionId: string,
    deliveryItemId: string,
    inputFingerprint: Buffer,
  ): Promise<DeliveryItemCompletionEvaluationTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item_completion_evaluation')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .where('version_id', '=', versionId)
      .where('delivery_item_id', '=', deliveryItemId)
      .where('input_fingerprint', '=', inputFingerprint)
      .executeTakeFirst()) as unknown as DeliveryItemCompletionEvaluationTable | undefined;
  }

  async getCompletionEvaluationById(
    trx: EnterpriseProjectTransaction,
    evaluationId: string,
  ): Promise<DeliveryItemCompletionEvaluationTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item_completion_evaluation')
      .selectAll()
      .where('evaluation_id', '=', evaluationId)
      .executeTakeFirst()) as unknown as DeliveryItemCompletionEvaluationTable | undefined;
  }

  async insertCompletionEvaluation(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemCompletionEvaluationInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item_completion_evaluation')
      .values({
        evaluation_id: insert.evaluationId,
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        delivery_item_id: insert.deliveryItemId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        criteria_hash: insert.criteriaHash,
        evaluator_ref: JSON.stringify(insert.evaluatorRef),
        evaluator_ref_hash: insert.evaluatorRefHash,
        evaluator_id: insert.evaluatorId,
        evaluator_version_id: insert.evaluatorVersionId,
        fact_refs: JSON.stringify(insert.factRefs),
        fact_refs_hash: insert.factRefsHash,
        source_watermarks: JSON.stringify(insert.sourceWatermarks),
        source_watermarks_hash: insert.sourceWatermarksHash,
        outcome: insert.outcome,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        input_fingerprint: insert.inputFingerprint,
        evaluated_at: insert.evaluatedAt,
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
        source_event_id: insert.sourceEventId ?? null,
      })
      .execute();
  }

  async casCurrentCompletionEvaluation(
    trx: EnterpriseProjectTransaction,
    input: DeliveryItemCompletionCasInput,
  ): Promise<DeliveryItemCompletionCasResult> {
    const nextVersion = nextAggregateVersion(input.expectedAggregateVersion);
    let query = trx
      .updateTable('enterprise_project.delivery_item')
      .set({
        current_completion_evaluation_id: input.nextEvaluationId,
        completion_aggregate_version: nextVersion,
        completion_updated_at: new Date(),
        completion_last_command_id: input.commandId,
      })
      .where('delivery_plan_id', '=', input.deliveryPlanId)
      .where('version_id', '=', input.versionId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('delivery_item_id', '=', input.deliveryItemId)
      .where('completion_aggregate_version', '=', input.expectedAggregateVersion);
    query =
      input.expectedEvaluationId === null
        ? query.where('current_completion_evaluation_id', 'is', null)
        : query.where('current_completion_evaluation_id', '=', input.expectedEvaluationId);
    const updated = await query.executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) return { ok: true, nextVersion };
    const current = (await trx
      .selectFrom('enterprise_project.delivery_item')
      .selectAll()
      .where('delivery_plan_id', '=', input.deliveryPlanId)
      .where('version_id', '=', input.versionId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('delivery_item_id', '=', input.deliveryItemId)
      .executeTakeFirst()) as unknown as DeliveryItemTable | undefined;
    return { ok: false, current };
  }

  async insertImpactReview(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemImpactReviewInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item_impact_review')
      .values({
        impact_review_id: insert.impactReviewId,
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        delivery_item_id: insert.deliveryItemId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        triggering_ref: JSON.stringify(insert.triggeringRef),
        prior_evaluation_ref:
          insert.priorEvaluationRef === undefined
            ? null
            : JSON.stringify(insert.priorEvaluationRef),
        prior_evaluation_id: insert.priorEvaluationId ?? null,
        new_evaluation_ref: JSON.stringify(insert.newEvaluationRef),
        new_evaluation_id: insert.newEvaluationId,
        impact_reason: insert.impactReason,
        affected_fact_refs: JSON.stringify(insert.affectedFactRefs),
        source_watermarks: JSON.stringify(insert.sourceWatermarks),
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }
}
