// IM-03 WI-10 (issue #66): DeliveryPlan persistence boundary. The repository
// only maps validated, trusted values to the V2011 tables; scope, immutable
// history, pointer consistency and CAS remain database-enforced invariants.

import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { GapAnalysisRepository } from './gap-analysis-repository.js';
import type {
  DeliveryCommitmentStatus,
  DeliveryItemArtifactRequirementTable,
  DeliveryItemDependencyTable,
  DeliveryItemTable,
  DeliveryPlanDecision,
  DeliveryPlanDecisionTable,
  DeliveryPlanStatus,
  DeliveryPlanTable,
  DeliveryPlanVersionStatus,
  DeliveryPlanVersionTable,
} from './enterprise-business-types.js';

export interface DeliveryPlanInsert {
  deliveryPlanId: string;
  enterpriseId: string;
  projectId: string;
  currentVersionId: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface DeliveryPlanVersionInsert {
  versionId: string;
  deliveryPlanId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  acceptedGapAnalysisRef: unknown;
  acceptedGapAnalysisId: string;
  acceptedGapAnalysisVersionId: string;
  baselineRefs: unknown;
  assumptions: unknown;
  exclusions: unknown;
  planQualityPolicyRef: unknown;
  planQualityPolicyId: string;
  planQualityPolicyVersionId: string;
  payload: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryItemInsert {
  deliveryItemId: string;
  deliveryPlanId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  itemKey: string;
  itemType: string;
  title: string;
  objective: string;
  sourceGapItemRefs: unknown;
  dependencyItemIds: unknown;
  targetArtifactTypes: unknown;
  qualityProfileRef: unknown;
  qualityProfileId: string;
  qualityProfileVersionId: string;
  completionCriteria: unknown;
  dueConstraint?: unknown;
  commitmentStatus: DeliveryCommitmentStatus;
  criteriaHash: Buffer;
  payload: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryItemArtifactRequirementInsert {
  requirementId: string;
  deliveryPlanId: string;
  versionId: string;
  deliveryItemId: string;
  enterpriseId: string;
  projectId: string;
  artifactType: string;
  purpose: string;
  acceptanceCriteria: unknown;
  releaseCriteria: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryItemDependencyInsert {
  deliveryPlanId: string;
  versionId: string;
  fromItemId: string;
  toItemId: string;
  enterpriseId: string;
  projectId: string;
  dependencyType: string;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryPlanDecisionInsert {
  decisionId: string;
  deliveryPlanId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  reviewSnapshotRef: unknown;
  decision: DeliveryPlanDecision;
  justification: unknown;
  payload: unknown;
  payloadHash: Buffer;
  decidedByPrincipalId: string;
  decidedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface DeliveryPlanCasPatch {
  status: DeliveryPlanStatus;
  approvedVersionId: string | null;
  activeVersionId: string | null;
  sourceCommandId: string;
}

export type DeliveryPlanCasResult =
  { ok: true; nextVersion: string; row: DeliveryPlanTable } | { ok: false; current: string };

function aggregateVersion(value: unknown): string {
  return String(value);
}

export class DeliveryPlanRepository extends GapAnalysisRepository {
  async insertDeliveryPlan(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryPlanInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.delivery_plan')
      .values({
        delivery_plan_id: insert.deliveryPlanId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        current_version_id: insert.currentVersionId,
        approved_version_id: null,
        active_version_id: null,
        status: 'DRAFT',
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .onConflict((conflict) => conflict.column('delivery_plan_id').doNothing())
      .returning('delivery_plan_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getDeliveryPlanById(
    trx: EnterpriseProjectTransaction,
    deliveryPlanId: string,
  ): Promise<DeliveryPlanTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_plan')
      .selectAll()
      .where('delivery_plan_id', '=', deliveryPlanId)
      .executeTakeFirst()) as unknown as DeliveryPlanTable | undefined;
  }

  async getDeliveryPlanByIdForUpdate(
    trx: EnterpriseProjectTransaction,
    deliveryPlanId: string,
  ): Promise<DeliveryPlanTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_plan')
      .selectAll()
      .where('delivery_plan_id', '=', deliveryPlanId)
      .forUpdate()
      .executeTakeFirst()) as unknown as DeliveryPlanTable | undefined;
  }

  async getActiveDeliveryPlanByProjectForUpdate(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<DeliveryPlanTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_plan')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .where('active_version_id', 'is not', null)
      .forUpdate()
      .executeTakeFirst()) as unknown as DeliveryPlanTable | undefined;
  }

  async casDeliveryPlan(
    trx: EnterpriseProjectTransaction,
    deliveryPlanId: string,
    expectedVersion: string,
    patch: DeliveryPlanCasPatch,
  ): Promise<DeliveryPlanCasResult> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.delivery_plan')
      .set({
        status: patch.status,
        approved_version_id: patch.approvedVersionId,
        active_version_id: patch.activeVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: patch.sourceCommandId,
      })
      .where('delivery_plan_id', '=', deliveryPlanId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getDeliveryPlanById(trx, deliveryPlanId);
      if (!row) throw new Error('casDeliveryPlan: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getDeliveryPlanById(trx, deliveryPlanId);
    if (!current) return { ok: false, current: '0' };
    return { ok: false, current: aggregateVersion(current.aggregate_version) };
  }

  async insertDeliveryPlanVersion(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryPlanVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_plan_version')
      .values({
        version_id: insert.versionId,
        delivery_plan_id: insert.deliveryPlanId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: 'DRAFT',
        accepted_gap_analysis_ref: JSON.stringify(insert.acceptedGapAnalysisRef),
        accepted_gap_analysis_id: insert.acceptedGapAnalysisId,
        accepted_gap_analysis_version_id: insert.acceptedGapAnalysisVersionId,
        baseline_refs: JSON.stringify(insert.baselineRefs),
        assumptions: JSON.stringify(insert.assumptions),
        exclusions: JSON.stringify(insert.exclusions),
        plan_quality_policy_ref: JSON.stringify(insert.planQualityPolicyRef),
        plan_quality_policy_id: insert.planQualityPolicyId,
        plan_quality_policy_version_id: insert.planQualityPolicyVersionId,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        approval_decision_id: null,
        approved_by_principal_id: null,
        approved_by_actor_snapshot_id: null,
        approved_at: null,
        activated_at: null,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getDeliveryPlanVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<DeliveryPlanVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_plan_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as DeliveryPlanVersionTable | undefined;
  }

  async transitionDeliveryPlanVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    status: DeliveryPlanVersionStatus,
    fields: {
      approvalDecisionId?: string | null;
      approvedByPrincipalId?: string | null;
      approvedByActorSnapshotId?: string | null;
      approvedAt?: Date | null;
      activatedAt?: Date | null;
    } = {},
  ): Promise<boolean> {
    const updated = await trx
      .updateTable('enterprise_project.delivery_plan_version')
      .set({
        version_status: status,
        ...(fields.approvalDecisionId === undefined
          ? {}
          : { approval_decision_id: fields.approvalDecisionId }),
        ...(fields.approvedByPrincipalId === undefined
          ? {}
          : { approved_by_principal_id: fields.approvedByPrincipalId }),
        ...(fields.approvedByActorSnapshotId === undefined
          ? {}
          : { approved_by_actor_snapshot_id: fields.approvedByActorSnapshotId }),
        ...(fields.approvedAt === undefined ? {} : { approved_at: fields.approvedAt }),
        ...(fields.activatedAt === undefined ? {} : { activated_at: fields.activatedAt }),
      })
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  async insertDeliveryItem(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item')
      .values({
        delivery_item_id: insert.deliveryItemId,
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        item_key: insert.itemKey,
        item_type: insert.itemType,
        title: insert.title,
        objective: insert.objective,
        source_gap_item_refs: JSON.stringify(insert.sourceGapItemRefs),
        dependency_item_ids: JSON.stringify(insert.dependencyItemIds),
        target_artifact_types: JSON.stringify(insert.targetArtifactTypes),
        quality_profile_ref: JSON.stringify(insert.qualityProfileRef),
        quality_profile_id: insert.qualityProfileId,
        quality_profile_version_id: insert.qualityProfileVersionId,
        completion_criteria: JSON.stringify(insert.completionCriteria),
        due_constraint:
          insert.dueConstraint === undefined ? null : JSON.stringify(insert.dueConstraint),
        commitment_status: insert.commitmentStatus,
        execution_status: 'NOT_READY',
        criteria_hash: insert.criteriaHash,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getDeliveryItem(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    deliveryItemId: string,
  ): Promise<DeliveryItemTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item')
      .selectAll()
      .where('version_id', '=', versionId)
      .where('delivery_item_id', '=', deliveryItemId)
      .executeTakeFirst()) as unknown as DeliveryItemTable | undefined;
  }

  async getDeliveryItems(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<DeliveryItemTable[]> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('item_key', 'asc')
      .orderBy('delivery_item_id', 'asc')
      .execute()) as unknown as DeliveryItemTable[];
  }

  async insertDeliveryItemArtifactRequirement(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemArtifactRequirementInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item_artifact_requirement')
      .values({
        requirement_id: insert.requirementId,
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        delivery_item_id: insert.deliveryItemId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        artifact_type: insert.artifactType,
        purpose: insert.purpose,
        required_cardinality: 'REQUIRED',
        acceptance_criteria: JSON.stringify(insert.acceptanceCriteria),
        release_criteria: JSON.stringify(insert.releaseCriteria),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getDeliveryItemArtifactRequirements(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    deliveryItemId: string,
  ): Promise<DeliveryItemArtifactRequirementTable[]> {
    return (await trx
      .selectFrom('enterprise_project.delivery_item_artifact_requirement')
      .selectAll()
      .where('version_id', '=', versionId)
      .where('delivery_item_id', '=', deliveryItemId)
      .orderBy('artifact_type', 'asc')
      .execute()) as unknown as DeliveryItemArtifactRequirementTable[];
  }

  async insertDeliveryItemDependency(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryItemDependencyInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_item_dependency')
      .values({
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        from_item_id: insert.fromItemId,
        to_item_id: insert.toItemId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        dependency_type: insert.dependencyType,
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getDeliveryItemDependencies(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<DeliveryItemDependencyTable[]> {
    return await trx
      .selectFrom('enterprise_project.delivery_item_dependency')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('from_item_id', 'asc')
      .orderBy('to_item_id', 'asc')
      .execute();
  }

  async insertDeliveryPlanDecision(
    trx: EnterpriseProjectTransaction,
    insert: DeliveryPlanDecisionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.decidedByPrincipalId);
    await trx
      .insertInto('enterprise_project.delivery_plan_decision')
      .values({
        decision_id: insert.decisionId,
        delivery_plan_id: insert.deliveryPlanId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        review_snapshot_ref: JSON.stringify(insert.reviewSnapshotRef),
        decision: insert.decision,
        justification: JSON.stringify(insert.justification),
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        decided_by_principal_id: insert.decidedByPrincipalId,
        decided_by_principal_kind: 'HUMAN',
        decided_by_actor_snapshot_id: insert.decidedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getDeliveryPlanDecision(
    trx: EnterpriseProjectTransaction,
    decisionId: string,
  ): Promise<DeliveryPlanDecisionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.delivery_plan_decision')
      .selectAll()
      .where('decision_id', '=', decisionId)
      .executeTakeFirst()) as unknown as DeliveryPlanDecisionTable | undefined;
  }

  async getProjectByIdForUpdate(trx: EnterpriseProjectTransaction, projectId: string) {
    return (await trx
      .selectFrom('enterprise_project.project')
      .selectAll()
      .where('project_id', '=', projectId)
      .forUpdate()
      .executeTakeFirst()) as Awaited<ReturnType<GapAnalysisRepository['getProjectById']>>;
  }
}
