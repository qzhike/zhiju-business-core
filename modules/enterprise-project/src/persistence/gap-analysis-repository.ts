// IM-03 WI-09 (issue #65): GapAnalysis persistence boundary. This repository
// extends the existing EnterpriseProject repository so all reads and writes
// stay inside the trusted transaction and the owning module schema.

import { sql } from 'kysely';
import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { TemplateRegulatoryRepository } from './template-regulatory-repository.js';
import type {
  GapAnalysisDecisionTable,
  GapAnalysisDisposition,
  GapAnalysisInputSnapshotTable,
  GapAnalysisMode,
  GapAnalysisStatus,
  GapAnalysisTable,
  GapAnalysisVersionStatus,
  GapAnalysisVersionTable,
  GapFindingSeverity,
  GapFindingTable,
} from './enterprise-business-types.js';

export interface GapAnalysisInsert {
  gapAnalysisId: string;
  enterpriseId: string;
  projectId: string;
  currentVersionId: string;
  status: GapAnalysisStatus;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface GapAnalysisInputSnapshotInsert {
  inputSnapshotId: string;
  gapAnalysisId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  customerBaselineRef: unknown;
  customerBaselineId: string;
  customerBaselineVersionId: string;
  templateBaselineRef: unknown;
  templateBaselineId: string;
  templateBaselineVersionId: string;
  regulatoryProfileRef: unknown;
  regulatoryProfileId: string;
  regulatoryProfileVersionId: string;
  enterpriseProfileSnapshotRef: unknown;
  enterpriseProfileSnapshotId: string;
  enterpriseProfilePayloadHash: Buffer;
  qmsConfigurationRef: unknown;
  qmsConfigurationId: string;
  qmsConfigurationRevisionId: string;
  qmsConfigurationRevisionHash: Buffer;
  productScopeSnapshotRef: unknown;
  productScopeSnapshotId: string;
  productScopePayloadHash: Buffer;
  analysisPolicyRef: unknown;
  analysisPolicyId: string;
  analysisPolicyVersionId: string;
  payload: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface GapAnalysisVersionInsert {
  versionId: string;
  gapAnalysisId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  mode: GapAnalysisMode;
  inputSnapshotId: string;
  requestedScope: unknown;
  findingsSummary: unknown;
  payload: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface GapFindingInsert {
  findingId: string;
  gapAnalysisId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  subjectKey: string;
  subjectType: string;
  customerBaselineItemRefs: unknown;
  templateRefs: unknown;
  regulatoryItemRefs: unknown;
  gapStatus: string;
  severity: GapFindingSeverity;
  rationale: unknown;
  evidenceRefs: unknown;
  recommendedAction: string;
  informationRequestRefs: unknown;
  reviewDisposition?: string;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface GapAnalysisDecisionInsert {
  decisionId: string;
  gapAnalysisId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  reviewSnapshotRef: unknown;
  disposition: GapAnalysisDisposition;
  justification: unknown;
  payload: unknown;
  payloadHash: Buffer;
  decidedByPrincipalId: string;
  decidedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface GapStaleDependency {
  kind: 'CustomerBaseline' | 'TemplateBaseline' | 'RegulatoryProfile';
  objectId: string;
  versionId: string;
}

interface StaleDependencyColumns {
  readonly objectIdColumn:
    'customer_baseline_id' | 'template_baseline_id' | 'regulatory_profile_id';
  readonly versionIdColumn:
    | 'customer_baseline_version_id'
    | 'template_baseline_version_id'
    | 'regulatory_profile_version_id';
}

const STALE_DEPENDENCY_COLUMNS: Readonly<
  Record<GapStaleDependency['kind'], StaleDependencyColumns>
> = {
  CustomerBaseline: {
    objectIdColumn: 'customer_baseline_id',
    versionIdColumn: 'customer_baseline_version_id',
  },
  TemplateBaseline: {
    objectIdColumn: 'template_baseline_id',
    versionIdColumn: 'template_baseline_version_id',
  },
  RegulatoryProfile: {
    objectIdColumn: 'regulatory_profile_id',
    versionIdColumn: 'regulatory_profile_version_id',
  },
};

function aggregateVersion(value: unknown): string {
  return String(value);
}

export class GapAnalysisRepository extends TemplateRegulatoryRepository {
  async insertGapAnalysis(
    trx: EnterpriseProjectTransaction,
    insert: GapAnalysisInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.gap_analysis')
      .values({
        gap_analysis_id: insert.gapAnalysisId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        current_version_id: insert.currentVersionId,
        accepted_version_id: null,
        status: insert.status,
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .onConflict((conflict) => conflict.column('gap_analysis_id').doNothing())
      .returning('gap_analysis_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getGapAnalysisById(
    trx: EnterpriseProjectTransaction,
    gapAnalysisId: string,
  ): Promise<GapAnalysisTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.gap_analysis')
      .selectAll()
      .where('gap_analysis_id', '=', gapAnalysisId)
      .executeTakeFirst()) as unknown as GapAnalysisTable | undefined;
  }

  async getGapAnalysisByIdForUpdate(
    trx: EnterpriseProjectTransaction,
    gapAnalysisId: string,
  ): Promise<GapAnalysisTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.gap_analysis')
      .selectAll()
      .where('gap_analysis_id', '=', gapAnalysisId)
      .forUpdate()
      .executeTakeFirst()) as unknown as GapAnalysisTable | undefined;
  }

  async casGapAnalysis(
    trx: EnterpriseProjectTransaction,
    gapAnalysisId: string,
    expectedVersion: string,
    status: GapAnalysisStatus,
    acceptedVersionId: string | null,
    sourceCommandId: string,
  ): Promise<
    { ok: true; nextVersion: string; row: GapAnalysisTable } | { ok: false; current: string }
  > {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.gap_analysis')
      .set({
        status,
        accepted_version_id: acceptedVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('gap_analysis_id', '=', gapAnalysisId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getGapAnalysisById(trx, gapAnalysisId);
      if (!row) throw new Error('casGapAnalysis: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getGapAnalysisById(trx, gapAnalysisId);
    if (!current) return { ok: false, current: '0' };
    return { ok: false, current: aggregateVersion(current.aggregate_version) };
  }

  async insertGapAnalysisInputSnapshot(
    trx: EnterpriseProjectTransaction,
    insert: GapAnalysisInputSnapshotInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.gap_analysis_input_snapshot')
      .values({
        input_snapshot_id: insert.inputSnapshotId,
        gap_analysis_id: insert.gapAnalysisId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        customer_baseline_ref: JSON.stringify(insert.customerBaselineRef),
        customer_baseline_id: insert.customerBaselineId,
        customer_baseline_version_id: insert.customerBaselineVersionId,
        template_baseline_ref: JSON.stringify(insert.templateBaselineRef),
        template_baseline_id: insert.templateBaselineId,
        template_baseline_version_id: insert.templateBaselineVersionId,
        regulatory_profile_ref: JSON.stringify(insert.regulatoryProfileRef),
        regulatory_profile_id: insert.regulatoryProfileId,
        regulatory_profile_version_id: insert.regulatoryProfileVersionId,
        enterprise_profile_snapshot_ref: JSON.stringify(insert.enterpriseProfileSnapshotRef),
        enterprise_profile_snapshot_id: insert.enterpriseProfileSnapshotId,
        enterprise_profile_payload_hash: insert.enterpriseProfilePayloadHash,
        qms_configuration_ref: JSON.stringify(insert.qmsConfigurationRef),
        qms_configuration_id: insert.qmsConfigurationId,
        qms_configuration_revision_id: insert.qmsConfigurationRevisionId,
        qms_configuration_revision_hash: insert.qmsConfigurationRevisionHash,
        product_scope_snapshot_ref: JSON.stringify(insert.productScopeSnapshotRef),
        product_scope_snapshot_id: insert.productScopeSnapshotId,
        product_scope_payload_hash: insert.productScopePayloadHash,
        analysis_policy_ref: JSON.stringify(insert.analysisPolicyRef),
        analysis_policy_id: insert.analysisPolicyId,
        analysis_policy_version_id: insert.analysisPolicyVersionId,
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

  async getGapAnalysisInputSnapshot(
    trx: EnterpriseProjectTransaction,
    inputSnapshotId: string,
  ): Promise<GapAnalysisInputSnapshotTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.gap_analysis_input_snapshot')
      .selectAll()
      .where('input_snapshot_id', '=', inputSnapshotId)
      .executeTakeFirst()) as unknown as GapAnalysisInputSnapshotTable | undefined;
  }

  async insertGapAnalysisVersion(
    trx: EnterpriseProjectTransaction,
    insert: GapAnalysisVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.gap_analysis_version')
      .values({
        version_id: insert.versionId,
        gap_analysis_id: insert.gapAnalysisId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: 'COMPLETED',
        mode: insert.mode,
        input_snapshot_id: insert.inputSnapshotId,
        requested_scope: JSON.stringify(insert.requestedScope),
        findings_summary: JSON.stringify(insert.findingsSummary),
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        stale_reason: null,
        stale_at: null,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getGapAnalysisVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<GapAnalysisVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.gap_analysis_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as GapAnalysisVersionTable | undefined;
  }

  async insertGapFinding(
    trx: EnterpriseProjectTransaction,
    insert: GapFindingInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.gap_finding')
      .values({
        finding_id: insert.findingId,
        gap_analysis_id: insert.gapAnalysisId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        subject_key: insert.subjectKey,
        subject_type: insert.subjectType,
        customer_baseline_item_refs: JSON.stringify(insert.customerBaselineItemRefs),
        template_refs: JSON.stringify(insert.templateRefs),
        regulatory_item_refs: JSON.stringify(insert.regulatoryItemRefs),
        gap_status: insert.gapStatus,
        severity: insert.severity,
        rationale: JSON.stringify(insert.rationale),
        evidence_refs: JSON.stringify(insert.evidenceRefs),
        recommended_action: insert.recommendedAction,
        information_request_refs: JSON.stringify(insert.informationRequestRefs),
        review_disposition: insert.reviewDisposition ?? null,
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

  async getGapFindings(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<GapFindingTable[]> {
    return (await trx
      .selectFrom('enterprise_project.gap_finding')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('subject_key', 'asc')
      .orderBy('finding_id', 'asc')
      .execute()) as unknown as GapFindingTable[];
  }

  async setGapAnalysisVersionStatus(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    status: GapAnalysisVersionStatus,
  ): Promise<boolean> {
    const updated = await trx
      .updateTable('enterprise_project.gap_analysis_version')
      .set({ version_status: status })
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  async insertGapAnalysisDecision(
    trx: EnterpriseProjectTransaction,
    insert: GapAnalysisDecisionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.decidedByPrincipalId);
    await trx
      .insertInto('enterprise_project.gap_analysis_decision')
      .values({
        decision_id: insert.decisionId,
        gap_analysis_id: insert.gapAnalysisId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        review_snapshot_ref: JSON.stringify(insert.reviewSnapshotRef),
        disposition: insert.disposition,
        justification: JSON.stringify(insert.justification),
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        decided_by_principal_id: insert.decidedByPrincipalId,
        decided_by_actor_snapshot_id: insert.decidedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getGapAnalysisDecision(
    trx: EnterpriseProjectTransaction,
    decisionId: string,
  ): Promise<GapAnalysisDecisionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.gap_analysis_decision')
      .selectAll()
      .where('decision_id', '=', decisionId)
      .executeTakeFirst()) as unknown as GapAnalysisDecisionTable | undefined;
  }

  async markGapAnalysesStaleForDependency(
    trx: EnterpriseProjectTransaction,
    dependency: GapStaleDependency,
    enterpriseId: string,
    projectId: string,
    staleReason: unknown,
    sourceCommandId: string,
  ): Promise<number> {
    const columns = STALE_DEPENDENCY_COLUMNS[dependency.kind];
    const matches = await sql<{ gap_analysis_id: string; version_id: string }>`
      SELECT DISTINCT version_row.gap_analysis_id, version_row.version_id
        FROM enterprise_project.gap_analysis_input_snapshot input_row
        JOIN enterprise_project.gap_analysis_version version_row
          ON version_row.enterprise_id = input_row.enterprise_id
         AND version_row.project_id = input_row.project_id
         AND version_row.gap_analysis_id = input_row.gap_analysis_id
         AND version_row.version_id = input_row.version_id
       WHERE input_row.enterprise_id = ${enterpriseId}::uuid
         AND input_row.project_id = ${projectId}::uuid
         AND input_row.${sql.raw(columns.objectIdColumn)} = ${dependency.objectId}::uuid
         AND input_row.${sql.raw(columns.versionIdColumn)} <> ${dependency.versionId}::uuid
         AND version_row.version_status <> 'STALE'
       ORDER BY version_row.gap_analysis_id, version_row.version_id
    `.execute(trx);

    const now = new Date();
    const reasonJson = JSON.stringify(staleReason);
    const roots = new Map<string, Set<string>>();
    for (const match of matches.rows) {
      const versionIds = roots.get(match.gap_analysis_id) ?? new Set<string>();
      versionIds.add(match.version_id);
      roots.set(match.gap_analysis_id, versionIds);
      await trx
        .updateTable('enterprise_project.gap_analysis_version')
        .set({ version_status: 'STALE', stale_reason: reasonJson, stale_at: now })
        .where('gap_analysis_id', '=', match.gap_analysis_id)
        .where('version_id', '=', match.version_id)
        .where('version_status', '<>', 'STALE')
        .execute();
    }

    for (const [gapAnalysisId, versionIds] of roots) {
      const root = await this.getGapAnalysisById(trx, gapAnalysisId);
      if (!root) continue;
      const currentIsStale = versionIds.has(root.current_version_id);
      const acceptedIsStale =
        root.accepted_version_id !== null && versionIds.has(root.accepted_version_id);
      if (!currentIsStale && !acceptedIsStale) continue;
      const next = (BigInt(aggregateVersion(root.aggregate_version)) + 1n).toString();
      await trx
        .updateTable('enterprise_project.gap_analysis')
        .set({
          status: currentIsStale ? 'STALE' : root.status,
          accepted_version_id: currentIsStale || acceptedIsStale ? null : root.accepted_version_id,
          aggregate_version: next,
          updated_at: now,
          last_command_id: sourceCommandId,
        })
        .where('gap_analysis_id', '=', gapAnalysisId)
        .where('aggregate_version', '=', aggregateVersion(root.aggregate_version))
        .execute();
    }
    return matches.rows.length;
  }
}
