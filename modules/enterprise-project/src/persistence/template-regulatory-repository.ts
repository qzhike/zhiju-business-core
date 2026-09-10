// IM-03 WI-08 (issue #64): persistence boundary for controlled platform
// references and Project-owned TemplateBaseline/RegulatoryProfile facts.
// The database remains the authority for scope, lifecycle, immutable history
// and pointer constraints; this repository only maps trusted inputs to SQL.

import { sql } from 'kysely';
import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { EnterpriseBusinessRepository, type CasResult } from './enterprise-business-repository.js';
import type {
  ReferenceTemplateTable,
  ReferenceTemplateVersionTable,
  RegulatoryReferenceTable,
  RegulatoryReferenceVersionTable,
  TemplateBaselineTable,
  TemplateBaselineVersionTable,
  TemplateSelectionTable,
  RegulatoryProfileTable,
  RegulatoryProfileVersionTable,
  RegulatoryProfileItemTable,
} from './enterprise-business-types.js';

function aggregateVersionToString(value: unknown): string {
  return String(value);
}

export interface ReferenceTemplateInsert {
  referenceTemplateId: string;
  referenceCode: string;
  templateType: string;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface ReferenceTemplateVersionInsert {
  referenceTemplateVersionId: string;
  referenceTemplateId: string;
  versionNo: number;
  versionLabel: string;
  contentRef: unknown;
  contentHash: Buffer;
  sourceRef: unknown;
  applicability: unknown;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface RegulatoryReferenceInsert {
  regulatoryReferenceId: string;
  authorityCode: string;
  jurisdiction: string;
  referenceCode: string;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface RegulatoryReferenceVersionInsert {
  regulatoryReferenceVersionId: string;
  regulatoryReferenceId: string;
  versionNo: number;
  versionLabel: string;
  citation: string;
  effectivePeriod: unknown;
  sourceRef: unknown;
  contentRef: unknown;
  contentHash: Buffer;
  verificationRefs: unknown;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface TemplateBaselineInsert {
  templateBaselineId: string;
  enterpriseId: string;
  projectId: string;
  currentVersionId: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface TemplateBaselineVersionInsert {
  versionId: string;
  templateBaselineId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  previousVersionId?: string;
  selectionsPayload: unknown;
  reviewSnapshotRef: unknown;
  selectionRationale: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface TemplateSelectionInsert {
  selectionId: string;
  templateBaselineId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  deliveryCategory: string;
  templateRef: unknown;
  templateId: string;
  templateVersionId: string;
  applicabilityScope: unknown;
  selectionReason: unknown;
  replacementFor?: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface RegulatoryProfileInsert {
  regulatoryProfileId: string;
  enterpriseId: string;
  projectId: string;
  currentVersionId: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface RegulatoryProfileVersionInsert {
  versionId: string;
  regulatoryProfileId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  jurisdiction: string;
  productScopeSnapshotRef: unknown;
  productScopeSnapshotId: string;
  productScopePayloadHash: Buffer;
  applicabilityPayload: unknown;
  reviewSnapshotRef: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface RegulatoryProfileItemInsert {
  itemId: string;
  regulatoryProfileId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  regulatoryReferenceRef: unknown;
  regulatoryReferenceId: string;
  regulatoryReferenceVersionId: string;
  contentHash: Buffer;
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'PENDING_DETERMINATION';
  rationale: unknown;
  evidenceRefs: unknown;
  riskLevel: string;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export class TemplateRegulatoryRepository extends EnterpriseBusinessRepository {
  // -------------------- platform template reference --------------------

  async insertReferenceTemplate(
    trx: EnterpriseProjectTransaction,
    insert: ReferenceTemplateInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.reference_template')
      .values({
        reference_template_id: insert.referenceTemplateId,
        reference_code: insert.referenceCode,
        template_type: insert.templateType,
        status: 'ACTIVE',
        current_version_id: null,
        aggregate_version: '1',
        created_by_principal_id: insert.createdByPrincipalId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) => oc.column('reference_code').doNothing())
      .returning('reference_template_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getReferenceTemplateById(
    trx: EnterpriseProjectTransaction,
    referenceTemplateId: string,
  ): Promise<ReferenceTemplateTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.reference_template')
      .selectAll()
      .where('reference_template_id', '=', referenceTemplateId)
      .executeTakeFirst()) as unknown as ReferenceTemplateTable | undefined;
  }

  async getReferenceTemplateVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<ReferenceTemplateVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.reference_template_version')
      .selectAll()
      .where('reference_template_version_id', '=', versionId)
      .executeTakeFirst()) as unknown as ReferenceTemplateVersionTable | undefined;
  }

  async getReferenceTemplateVersions(
    trx: EnterpriseProjectTransaction,
    referenceTemplateId: string,
  ): Promise<ReferenceTemplateVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.reference_template_version')
      .selectAll()
      .where('reference_template_id', '=', referenceTemplateId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as ReferenceTemplateVersionTable[];
  }

  async insertReferenceTemplateVersion(
    trx: EnterpriseProjectTransaction,
    insert: ReferenceTemplateVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.reference_template_version')
      .values({
        reference_template_version_id: insert.referenceTemplateVersionId,
        reference_template_id: insert.referenceTemplateId,
        version_no: insert.versionNo,
        version_label: insert.versionLabel,
        content_ref: JSON.stringify(insert.contentRef),
        content_hash: insert.contentHash,
        source_ref: JSON.stringify(insert.sourceRef),
        applicability: JSON.stringify(insert.applicability),
        lifecycle: 'DRAFT',
        published_by_principal_id: null,
        published_at: null,
        release_decision_ref: null,
        publish_reason: null,
        created_by_principal_id: insert.createdByPrincipalId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async casReferenceTemplate(
    trx: EnterpriseProjectTransaction,
    referenceTemplateId: string,
    expectedVersion: string,
    nextCurrentVersionId: string | null,
    sourceCommandId: string,
  ): Promise<CasResult<ReferenceTemplateTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.reference_template')
      .set({
        aggregate_version: next,
        current_version_id: nextCurrentVersionId,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('reference_template_id', '=', referenceTemplateId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getReferenceTemplateById(trx, referenceTemplateId);
      if (!row) throw new Error('casReferenceTemplate: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getReferenceTemplateById(trx, referenceTemplateId);
    if (!current) throw new Error('casReferenceTemplate: target not found');
    return { ok: false, current: aggregateVersionToString(current.aggregate_version) };
  }

  async publishReferenceTemplateVersion(
    trx: EnterpriseProjectTransaction,
    referenceTemplateId: string,
    versionId: string,
    principalId: string,
    releaseDecisionRef: unknown,
    publishReason: unknown,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, principalId);
    const updated = await trx
      .updateTable('enterprise_project.reference_template_version')
      .set({
        lifecycle: 'PUBLISHED',
        published_by_principal_id: principalId,
        published_at: new Date(),
        release_decision_ref: JSON.stringify(releaseDecisionRef),
        publish_reason: JSON.stringify(publishReason),
      })
      .where('reference_template_id', '=', referenceTemplateId)
      .where('reference_template_version_id', '=', versionId)
      .where('lifecycle', '=', 'DRAFT')
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  // -------------------- platform regulatory reference --------------------

  async insertRegulatoryReference(
    trx: EnterpriseProjectTransaction,
    insert: RegulatoryReferenceInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.regulatory_reference')
      .values({
        regulatory_reference_id: insert.regulatoryReferenceId,
        authority_code: insert.authorityCode,
        jurisdiction: insert.jurisdiction,
        reference_code: insert.referenceCode,
        status: 'ACTIVE',
        current_version_id: null,
        aggregate_version: '1',
        created_by_principal_id: insert.createdByPrincipalId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.columns(['authority_code', 'jurisdiction', 'reference_code']).doNothing(),
      )
      .returning('regulatory_reference_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getRegulatoryReferenceById(
    trx: EnterpriseProjectTransaction,
    regulatoryReferenceId: string,
  ): Promise<RegulatoryReferenceTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_reference')
      .selectAll()
      .where('regulatory_reference_id', '=', regulatoryReferenceId)
      .executeTakeFirst()) as unknown as RegulatoryReferenceTable | undefined;
  }

  async getRegulatoryReferenceVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<RegulatoryReferenceVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_reference_version')
      .selectAll()
      .where('regulatory_reference_version_id', '=', versionId)
      .executeTakeFirst()) as unknown as RegulatoryReferenceVersionTable | undefined;
  }

  async getRegulatoryReferenceVersions(
    trx: EnterpriseProjectTransaction,
    regulatoryReferenceId: string,
  ): Promise<RegulatoryReferenceVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_reference_version')
      .selectAll()
      .where('regulatory_reference_id', '=', regulatoryReferenceId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as RegulatoryReferenceVersionTable[];
  }

  async insertRegulatoryReferenceVersion(
    trx: EnterpriseProjectTransaction,
    insert: RegulatoryReferenceVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.regulatory_reference_version')
      .values({
        regulatory_reference_version_id: insert.regulatoryReferenceVersionId,
        regulatory_reference_id: insert.regulatoryReferenceId,
        version_no: insert.versionNo,
        version_label: insert.versionLabel,
        citation: insert.citation,
        effective_period: JSON.stringify(insert.effectivePeriod),
        source_ref: JSON.stringify(insert.sourceRef),
        content_ref: JSON.stringify(insert.contentRef),
        content_hash: insert.contentHash,
        verification_refs: JSON.stringify(insert.verificationRefs),
        lifecycle: 'DRAFT',
        published_by_principal_id: null,
        published_at: null,
        release_decision_ref: null,
        publish_reason: null,
        created_by_principal_id: insert.createdByPrincipalId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async casRegulatoryReference(
    trx: EnterpriseProjectTransaction,
    regulatoryReferenceId: string,
    expectedVersion: string,
    nextCurrentVersionId: string | null,
    sourceCommandId: string,
  ): Promise<CasResult<RegulatoryReferenceTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.regulatory_reference')
      .set({
        aggregate_version: next,
        current_version_id: nextCurrentVersionId,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('regulatory_reference_id', '=', regulatoryReferenceId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getRegulatoryReferenceById(trx, regulatoryReferenceId);
      if (!row) throw new Error('casRegulatoryReference: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getRegulatoryReferenceById(trx, regulatoryReferenceId);
    if (!current) throw new Error('casRegulatoryReference: target not found');
    return { ok: false, current: aggregateVersionToString(current.aggregate_version) };
  }

  async publishRegulatoryReferenceVersion(
    trx: EnterpriseProjectTransaction,
    regulatoryReferenceId: string,
    versionId: string,
    principalId: string,
    releaseDecisionRef: unknown,
    publishReason: unknown,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, principalId);
    const updated = await trx
      .updateTable('enterprise_project.regulatory_reference_version')
      .set({
        lifecycle: 'PUBLISHED',
        published_by_principal_id: principalId,
        published_at: new Date(),
        release_decision_ref: JSON.stringify(releaseDecisionRef),
        publish_reason: JSON.stringify(publishReason),
      })
      .where('regulatory_reference_id', '=', regulatoryReferenceId)
      .where('regulatory_reference_version_id', '=', versionId)
      .where('lifecycle', '=', 'DRAFT')
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  // -------------------- TemplateBaseline --------------------

  async insertTemplateBaseline(
    trx: EnterpriseProjectTransaction,
    insert: TemplateBaselineInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    // Project-only ON CONFLICT can still raise a primary-key violation when
    // two speculative INSERTs pass the arbiter precheck together. Recover only
    // that exact root race, keeping the command transaction usable for its
    // rejection receipt/audit and preserving unrelated database failures.
    await sql`SAVEPOINT template_baseline_root_insert`.execute(trx);
    try {
      const inserted = await trx
        .insertInto('enterprise_project.template_baseline')
        .values({
          template_baseline_id: insert.templateBaselineId,
          enterprise_id: insert.enterpriseId,
          project_id: insert.projectId,
          current_version_id: insert.currentVersionId,
          active_version_id: insert.currentVersionId,
          aggregate_version: '1',
          created_at: new Date(),
          created_by_principal_id: insert.createdByPrincipalId,
          created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
          updated_at: new Date(),
          last_command_id: insert.sourceCommandId,
        })
        .onConflict((oc) => oc.columns(['enterprise_id', 'project_id']).doNothing())
        .returning('template_baseline_id')
        .executeTakeFirst();
      await sql`RELEASE SAVEPOINT template_baseline_root_insert`.execute(trx);
      return inserted !== undefined;
    } catch (error) {
      await sql`ROLLBACK TO SAVEPOINT template_baseline_root_insert`.execute(trx);
      await sql`RELEASE SAVEPOINT template_baseline_root_insert`.execute(trx);
      const failure = error as {
        code?: unknown;
        schema?: unknown;
        table?: unknown;
        constraint?: unknown;
      };
      if (
        failure.code === '23505' &&
        failure.schema === 'enterprise_project' &&
        failure.table === 'template_baseline' &&
        failure.constraint === 'template_baseline_pkey'
      ) {
        const root = await this.getTemplateBaselineByProject(
          trx,
          insert.enterpriseId,
          insert.projectId,
        );
        if (root?.template_baseline_id === insert.templateBaselineId) return false;
      }
      throw error;
    }
  }

  async getTemplateBaselineById(
    trx: EnterpriseProjectTransaction,
    templateBaselineId: string,
  ): Promise<TemplateBaselineTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.template_baseline')
      .selectAll()
      .where('template_baseline_id', '=', templateBaselineId)
      .executeTakeFirst()) as unknown as TemplateBaselineTable | undefined;
  }

  async getTemplateBaselineByProject(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<TemplateBaselineTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.template_baseline')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .executeTakeFirst()) as unknown as TemplateBaselineTable | undefined;
  }

  async casTemplateBaseline(
    trx: EnterpriseProjectTransaction,
    templateBaselineId: string,
    expectedVersion: string,
    nextVersionId: string,
    sourceCommandId: string,
  ): Promise<CasResult<TemplateBaselineTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.template_baseline')
      .set({
        current_version_id: nextVersionId,
        active_version_id: nextVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('template_baseline_id', '=', templateBaselineId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getTemplateBaselineById(trx, templateBaselineId);
      if (!row) throw new Error('casTemplateBaseline: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getTemplateBaselineById(trx, templateBaselineId);
    if (!current) throw new Error('casTemplateBaseline: target not found');
    return { ok: false, current: aggregateVersionToString(current.aggregate_version) };
  }

  async insertTemplateBaselineVersion(
    trx: EnterpriseProjectTransaction,
    insert: TemplateBaselineVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.template_baseline_version')
      .values({
        version_id: insert.versionId,
        template_baseline_id: insert.templateBaselineId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: 'FROZEN',
        previous_version_id: insert.previousVersionId ?? null,
        selections_payload: JSON.stringify(insert.selectionsPayload),
        review_snapshot_ref: JSON.stringify(insert.reviewSnapshotRef),
        selection_rationale: JSON.stringify(insert.selectionRationale),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getTemplateBaselineVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<TemplateBaselineVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.template_baseline_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as TemplateBaselineVersionTable | undefined;
  }

  async getTemplateBaselineVersions(
    trx: EnterpriseProjectTransaction,
    templateBaselineId: string,
  ): Promise<TemplateBaselineVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.template_baseline_version')
      .selectAll()
      .where('template_baseline_id', '=', templateBaselineId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as TemplateBaselineVersionTable[];
  }

  async insertTemplateSelection(
    trx: EnterpriseProjectTransaction,
    insert: TemplateSelectionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.template_selection')
      .values({
        selection_id: insert.selectionId,
        template_baseline_id: insert.templateBaselineId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        delivery_category: insert.deliveryCategory,
        template_ref: JSON.stringify(insert.templateRef),
        template_id: insert.templateId,
        template_version_id: insert.templateVersionId,
        applicability_scope: JSON.stringify(insert.applicabilityScope),
        selection_reason: JSON.stringify(insert.selectionReason),
        replacement_for:
          insert.replacementFor === undefined ? null : JSON.stringify(insert.replacementFor),
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

  async getTemplateSelections(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<TemplateSelectionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.template_selection')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('delivery_category', 'asc')
      .execute()) as unknown as TemplateSelectionTable[];
  }

  // -------------------- RegulatoryProfile --------------------

  async insertRegulatoryProfile(
    trx: EnterpriseProjectTransaction,
    insert: RegulatoryProfileInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.regulatory_profile')
      .values({
        regulatory_profile_id: insert.regulatoryProfileId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        current_version_id: insert.currentVersionId,
        active_version_id: insert.currentVersionId,
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
      })
      .onConflict((oc) => oc.columns(['enterprise_id', 'project_id']).doNothing())
      .returning('regulatory_profile_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getRegulatoryProfileById(
    trx: EnterpriseProjectTransaction,
    regulatoryProfileId: string,
  ): Promise<RegulatoryProfileTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_profile')
      .selectAll()
      .where('regulatory_profile_id', '=', regulatoryProfileId)
      .executeTakeFirst()) as unknown as RegulatoryProfileTable | undefined;
  }

  async getRegulatoryProfileByProject(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<RegulatoryProfileTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_profile')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .executeTakeFirst()) as unknown as RegulatoryProfileTable | undefined;
  }

  async casRegulatoryProfile(
    trx: EnterpriseProjectTransaction,
    regulatoryProfileId: string,
    expectedVersion: string,
    nextVersionId: string,
    sourceCommandId: string,
  ): Promise<CasResult<RegulatoryProfileTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.regulatory_profile')
      .set({
        current_version_id: nextVersionId,
        active_version_id: nextVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('regulatory_profile_id', '=', regulatoryProfileId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getRegulatoryProfileById(trx, regulatoryProfileId);
      if (!row) throw new Error('casRegulatoryProfile: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getRegulatoryProfileById(trx, regulatoryProfileId);
    if (!current) throw new Error('casRegulatoryProfile: target not found');
    return { ok: false, current: aggregateVersionToString(current.aggregate_version) };
  }

  async insertRegulatoryProfileVersion(
    trx: EnterpriseProjectTransaction,
    insert: RegulatoryProfileVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.regulatory_profile_version')
      .values({
        version_id: insert.versionId,
        regulatory_profile_id: insert.regulatoryProfileId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: 'FROZEN',
        jurisdiction: insert.jurisdiction,
        product_scope_snapshot_ref: JSON.stringify(insert.productScopeSnapshotRef),
        product_scope_snapshot_id: insert.productScopeSnapshotId,
        product_scope_payload_hash: insert.productScopePayloadHash,
        applicability_payload: JSON.stringify(insert.applicabilityPayload),
        review_snapshot_ref: JSON.stringify(insert.reviewSnapshotRef),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getRegulatoryProfileVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<RegulatoryProfileVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_profile_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as RegulatoryProfileVersionTable | undefined;
  }

  async getRegulatoryProfileVersions(
    trx: EnterpriseProjectTransaction,
    regulatoryProfileId: string,
  ): Promise<RegulatoryProfileVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_profile_version')
      .selectAll()
      .where('regulatory_profile_id', '=', regulatoryProfileId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as RegulatoryProfileVersionTable[];
  }

  async insertRegulatoryProfileItem(
    trx: EnterpriseProjectTransaction,
    insert: RegulatoryProfileItemInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.regulatory_profile_item')
      .values({
        item_id: insert.itemId,
        regulatory_profile_id: insert.regulatoryProfileId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        regulatory_reference_ref: JSON.stringify(insert.regulatoryReferenceRef),
        regulatory_reference_id: insert.regulatoryReferenceId,
        regulatory_reference_version_id: insert.regulatoryReferenceVersionId,
        content_hash: insert.contentHash,
        applicability: insert.applicability,
        rationale: JSON.stringify(insert.rationale),
        evidence_refs: JSON.stringify(insert.evidenceRefs),
        risk_level: insert.riskLevel,
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

  async getRegulatoryProfileItems(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<RegulatoryProfileItemTable[]> {
    return (await trx
      .selectFrom('enterprise_project.regulatory_profile_item')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('regulatory_reference_version_id', 'asc')
      .execute()) as unknown as RegulatoryProfileItemTable[];
  }
}
