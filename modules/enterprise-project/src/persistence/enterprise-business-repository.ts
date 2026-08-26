// IM-03 WI-03 (issue #59): business-aggregate repository for EnterpriseProject.
// Reuses the WI-02 Application/Persistence foundation (one transaction over
// `process_instance` CAS is not applicable here — the business aggregates
// own their own `aggregate_version` columns on V2001 roots). Every method
// binds the trusted transaction context principal and validates the promoted
// scope mirrors (Issue #59 §1–§4).

import { sql } from 'kysely';
import type { EnterpriseProjectTransaction, ReferenceEdgeTable } from './enterprise-db.js';
import { EnterpriseProjectRepository } from './enterprise-project-repository.js';
import {
  ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
  EnterprisePersistenceError,
} from './write-guards.js';
import type {
  EnterpriseTable,
  EnterpriseFactTable,
  EnterpriseFactVersionTable,
  EnterpriseProfileSnapshotTable,
  ProductTable,
  ProductVersionTable,
  ProductScopeSnapshotTable,
  QmsConfigurationTable,
  QmsConfigurationRevisionTable,
  ProjectTable,
  ProjectScopeClaimTable,
  ProjectSnapshotBindingTable,
  SourceMaterialTable,
  SourceMaterialOriginTable,
  SourceMaterialValidationTable,
  CustomerMaterialTable,
  CustomerMaterialVersionTable,
  CustomerMaterialDecisionTable,
  CustomerBaselineTable,
  CustomerBaselineVersionTable,
  CustomerBaselineItemTable,
  CustomerBaselineImpactReviewTable,
} from './enterprise-business-types.js';

export interface EnterpriseInsert {
  enterpriseId: string;
  displayCode: string;
  displayName: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface EnterpriseFactInsert {
  enterpriseFactId: string;
  enterpriseId: string;
  factType: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  currentVersionId?: string | null;
  currentStatus?: 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'SUPERSEDED';
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface EnterpriseFactVersionInsert {
  versionId: string;
  enterpriseFactId: string;
  enterpriseId: string;
  versionNo: number;
  status: 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'SUPERSEDED';
  value: unknown;
  sourceRefs: unknown;
  payloadHash: Buffer;
  proposedByPrincipalId: string;
  proposedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  effectiveFrom?: Date | undefined;
  effectiveTo?: Date | undefined;
}

export interface EnterpriseProfileSnapshotInsert {
  snapshotId: string;
  enterpriseId: string;
  payload: unknown;
  payloadHash: Buffer;
  derivedFrom: unknown;
  frozenByPrincipalId: string;
  frozenByActorSnapshotId: string;
  authorizationDecisionId: string;
  purpose: string;
  sourceCommandId: string;
}

export interface ProductInsert {
  productId: string;
  enterpriseId: string;
  displayCode: string;
  displayName: string;
  initialVersionId: string | null;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface ProductVersionInsert {
  versionId: string;
  productId: string;
  enterpriseId: string;
  versionNo: number;
  productType: string;
  displayName: string;
  intendedUse: string;
  productScope: unknown;
  sourceRefs: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  previousVersionId?: string | undefined;
}

export interface ProductScopeSnapshotInsert {
  snapshotId: string;
  productId: string;
  enterpriseId: string;
  payload: unknown;
  payloadHash: Buffer;
  derivedFrom: unknown;
  frozenByPrincipalId: string;
  frozenByActorSnapshotId: string;
  authorizationDecisionId: string;
  purpose: string;
  sourceCommandId: string;
}

export interface QmsConfigurationInsert {
  qmsConfigurationId: string;
  enterpriseId: string;
  displayCode: string;
  displayName: string;
  initialRevisionId: string | null;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface QmsConfigurationRevisionInsert {
  revisionId: string;
  qmsConfigurationId: string;
  enterpriseId: string;
  revisionNo: number;
  applicabilityDecisions: unknown;
  managementChoices: unknown;
  professionalDecisions: unknown;
  sourceRefs: unknown;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  previousRevisionId?: string | undefined;
}

// IM-03 WI-04 (issue #60): Project Aggregate and the
// ProjectScopeClaim / ProjectSnapshotBinding rows that freeze its start
// snapshot. The Project root owns the (enterprise_id, project_id) tuple;
// the ScopeClaim publishes that tuple to other modules; the
// SnapshotBinding records the exact StartSnapshot consumed by the
// `project.create_project` handler.
export interface ProjectInsert {
  projectId: string;
  enterpriseId: string;
  displayCode: string;
  title: string;
  objective: string;
  memberPolicyRef: unknown;
  memberPolicyVersionId: string;
  memberPolicyPayloadHash: Buffer | null;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface ProjectScopeClaimInsert {
  claimId: string;
  enterpriseId: string;
  projectId: string;
  claimedByPrincipalId: string;
  claimedByActorSnapshotId: string;
  authorizationDecisionId: string;
  payloadHash: Buffer;
  payload: unknown;
  sourceCommandId: string;
}

export interface ProjectSnapshotBindingInsert {
  bindingId: string;
  enterpriseId: string;
  projectId: string;
  bindingPurpose: 'PROJECT_START';
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
  initialCustomerBaselineRef?: unknown;
  initialCustomerBaselineVersionId?: string;
  initialCustomerBaselineVersionHash?: Buffer;
  templateBaselineRef?: unknown;
  templateBaselineVersionId?: string;
  templateBaselineVersionHash?: Buffer;
  regulatoryProfileRef?: unknown;
  regulatoryProfileVersionId?: string;
  regulatoryProfileVersionHash?: Buffer;
  memberPolicyRef: unknown;
  memberPolicyVersionId: string;
  memberPolicyPayloadHash: Buffer | null;
  payloadHash: Buffer;
  boundByPrincipalId: string;
  boundByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

// IM-03 WI-05 (issue #61): SourceMaterial custody and append-only history
// write inputs. The handler supplies canonical payload hashes; the database
// enforces scope, immutability and the promoted validation mirrors.
export interface SourceMaterialInsert {
  sourceMaterialId: string;
  enterpriseId: string;
  projectId: string;
  submittedByPrincipalId: string;
  submittedByRef: unknown;
  receivedAt: Date;
  originalName: string;
  mediaType: string;
  byteLength: string | number;
  contentHash: Buffer;
  stagedObjectRef: string;
  descriptorPayloadHash: Buffer;
  duplicateOfSourceMaterialId?: string;
  retentionClass: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface SourceMaterialOriginInsert {
  sourceMaterialOriginId: string;
  sourceMaterialId: string;
  enterpriseId: string;
  projectId: string;
  originRef: unknown;
  originRefHash: Buffer;
  receivedAt: Date;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  recordedAt?: Date;
}

export interface SourceMaterialValidationInsert {
  validationId: string;
  sourceMaterialId: string;
  enterpriseId: string;
  projectId: string;
  validationKind: 'SECURITY' | 'INTEGRITY';
  outcome: 'PASSED' | 'FAILED';
  validatedObjectRef: string;
  validatedContentHash: Buffer;
  validatedByteLength: string | number;
  validatorId: string;
  validatorVersion: string;
  payload: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  recordedAt?: Date;
}

// IM-03 WI-06 (issue #62): CustomerMaterial persistence inputs. The root is
// updated only through its aggregate CAS; version and decision inputs are
// append-only and carry the exact canonical payload hash supplied by the
// handler.
export interface CustomerMaterialInsert {
  customerMaterialId: string;
  enterpriseId: string;
  projectId: string;
  materialType: string;
  title: string;
  customerDocumentNumber?: string;
  customerVersionLabel?: string;
  effectiveDate?: Date;
  declaredStatus: string;
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNREADABLE';
  classificationStatus?:
    | 'PROPOSED'
    | 'UNDER_REVIEW'
    | 'CONFIRMED'
    | 'DISPUTED'
    | 'REJECTED'
    | 'NOT_CURRENT'
    | 'SUPERSEDED';
  currentVersionId: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface CustomerMaterialVersionInsert {
  versionId: string;
  customerMaterialId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  versionStatus: 'PROPOSED' | 'CONFIRMED';
  materialType: string;
  title: string;
  customerDocumentNumber?: string;
  customerVersionLabel?: string;
  effectiveDate?: Date;
  declaredStatus: string;
  completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNREADABLE';
  sourceSelections: unknown;
  language: string;
  classificationRationale: unknown;
  payloadHash: Buffer;
  proposedByPrincipalId: string;
  proposedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
  previousVersionId?: string;
}

export interface CustomerMaterialDecisionInsert {
  decisionId: string;
  customerMaterialId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  decisionKind: 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
  evidenceRefs: unknown;
  justification: unknown;
  payload: unknown;
  payloadHash: Buffer;
  decidedByPrincipalId: string;
  decidedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

// IM-03 WI-07 (issue #63): CustomerBaseline persistence inputs. The handler
// supplies canonical JSON and payload hashes; the migration owns the
// cross-field CHECK constraints and immutable/controlled update boundary.
export interface CustomerBaselineInsert {
  customerBaselineId: string;
  enterpriseId: string;
  projectId: string;
  currentVersionId: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  sourceCommandId: string;
}

export interface CustomerBaselineVersionInsert {
  versionId: string;
  customerBaselineId: string;
  enterpriseId: string;
  projectId: string;
  versionNo: number;
  previousVersionId?: string;
  baselinePolicyRef: unknown;
  expectationsPayload: unknown;
  payloadHash: Buffer;
  proposedByPrincipalId: string;
  proposedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface CustomerBaselineItemInsert {
  expectationId: string;
  customerBaselineId: string;
  versionId: string;
  enterpriseId: string;
  projectId: string;
  expectedMaterialKey: string;
  materialType: string;
  expectedTitleOrRole: string;
  status:
    'PRESENT' | 'PARTIAL' | 'MISSING_CONFIRMED' | 'NOT_PROVIDED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  customerMaterialRefs: unknown;
  decisionRef?: unknown;
  reason: unknown;
  payloadHash: Buffer;
  recordedByPrincipalId: string;
  recordedByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export interface CustomerBaselineImpactReviewInsert {
  impactReviewId: string;
  customerBaselineId: string;
  newVersionId: string;
  previousActiveVersionId?: string;
  enterpriseId: string;
  projectId: string;
  reviewSnapshotRef: unknown;
  impactPolicyRef: unknown;
  justification: unknown;
  affectedReferences: unknown;
  staleReferences: unknown;
  impactStatus: 'STALE' | 'NO_PRIOR_ACTIVE';
  payloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export type CasResult<T> =
  { ok: true; nextVersion: string; row: T } | { ok: false; current: string };

function asAggregateVersion(value: unknown): string {
  return String(value);
}

function isProjectDisplayCodeConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === 'project_display_code_unique';
}

/**
 * WI-03 business aggregate repository. Every write that introduces a
 * root or version row validates that the trusted transaction-context
 * principal matches the supplied createdByPrincipalId (Issue #58 P-005
 * invariant; identical pattern for V2001 business tables).
 */
export class EnterpriseBusinessRepository extends EnterpriseProjectRepository {
  // -------------------- principal binding --------------------

  protected async assertContextPrincipal(
    trx: EnterpriseProjectTransaction,
    expectedPrincipalId: string,
  ): Promise<void> {
    const context = await sql<{ principal_id: string | null }>`
      SELECT platform_security.context_principal_id() AS principal_id
    `.execute(trx);
    if (context.rows[0]?.principal_id !== expectedPrincipalId) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'created-by principal does not match the trusted transaction context',
      );
    }
  }

  // -------------------- enterprise --------------------

  async insertEnterprise(
    trx: EnterpriseProjectTransaction,
    insert: EnterpriseInsert,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    // Use ON CONFLICT DO NOTHING so a duplicate displayCode does not abort
    // the transaction; the handler converts the empty RETURNING into a
    // REJECTED PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT. RLS hides rows
    // belonging to other enterprises, so a SELECT pre-check is unreliable.
    const inserted = await trx
      .insertInto('enterprise_project.enterprise')
      .values({
        enterprise_id: insert.enterpriseId,
        display_code: insert.displayCode,
        display_name: insert.displayName,
        status: 'ACTIVE',
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
        retention_class: 'CUSTOMER_RECORD',
      })
      .onConflict((oc) => oc.column('display_code').doNothing())
      .returning('enterprise_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getEnterpriseById(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
  ): Promise<EnterpriseTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.enterprise')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .executeTakeFirst()) as unknown as EnterpriseTable | undefined;
  }

  async casEnterprise(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    expectedVersion: string,
    nextPointerIds?: {
      currentFactSnapshotId?: string | null;
      currentProductId?: string | null;
      currentQmsConfigurationId?: string | null;
    },
  ): Promise<CasResult<EnterpriseTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.enterprise')
      .set({
        aggregate_version: next,
        updated_at: new Date(),
        ...(nextPointerIds?.currentFactSnapshotId !== undefined
          ? { current_fact_snapshot_id: nextPointerIds.currentFactSnapshotId }
          : {}),
        ...(nextPointerIds?.currentProductId !== undefined
          ? { current_product_id: nextPointerIds.currentProductId }
          : {}),
        ...(nextPointerIds?.currentQmsConfigurationId !== undefined
          ? {
              current_qms_configuration_id: nextPointerIds.currentQmsConfigurationId,
            }
          : {}),
      })
      .where('enterprise_id', '=', enterpriseId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getEnterpriseById(trx, enterpriseId);
      if (!row) throw new Error('casEnterprise: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getEnterpriseById(trx, enterpriseId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casEnterprise: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  // -------------------- enterprise_fact --------------------

  async insertEnterpriseFact(
    trx: EnterpriseProjectTransaction,
    insert: EnterpriseFactInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.enterprise_fact')
      .values({
        enterprise_fact_id: insert.enterpriseFactId,
        enterprise_id: insert.enterpriseId,
        fact_type: insert.factType,
        risk_level: insert.riskLevel,
        current_version_id: insert.currentVersionId ?? null,
        current_status: insert.currentStatus ?? 'PROPOSED',
        created_by_principal_id: insert.createdByPrincipalId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  async getEnterpriseFactById(
    trx: EnterpriseProjectTransaction,
    enterpriseFactId: string,
  ): Promise<EnterpriseFactTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.enterprise_fact')
      .selectAll()
      .where('enterprise_fact_id', '=', enterpriseFactId)
      .executeTakeFirst()) as unknown as EnterpriseFactTable | undefined;
  }

  async casEnterpriseFact(
    trx: EnterpriseProjectTransaction,
    enterpriseFactId: string,
    expectedVersion: string,
    nextVersionId: string,
    nextStatus: 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'SUPERSEDED',
  ): Promise<CasResult<EnterpriseFactTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.enterprise_fact')
      .set({
        aggregate_version: next,
        updated_at: new Date(),
        current_version_id: nextVersionId,
        current_status: nextStatus,
      })
      .where('enterprise_fact_id', '=', enterpriseFactId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getEnterpriseFactById(trx, enterpriseFactId);
      if (!row) throw new Error('casEnterpriseFact: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getEnterpriseFactById(trx, enterpriseFactId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casEnterpriseFact: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  // -------------------- enterprise_fact_version --------------------

  async insertEnterpriseFactVersion(
    trx: EnterpriseProjectTransaction,
    insert: EnterpriseFactVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.proposedByPrincipalId);
    await trx
      .insertInto('enterprise_project.enterprise_fact_version')
      .values({
        version_id: insert.versionId,
        enterprise_fact_id: insert.enterpriseFactId,
        enterprise_id: insert.enterpriseId,
        version_no: insert.versionNo,
        status: insert.status,
        value: JSON.stringify(insert.value),
        source_refs: JSON.stringify(insert.sourceRefs),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        proposed_by_principal_id: insert.proposedByPrincipalId,
        proposed_by_actor_snapshot_id: insert.proposedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        effective_from: insert.effectiveFrom ?? null,
        effective_to: insert.effectiveTo ?? null,
        recorded_at: new Date(),
      })
      .execute();
  }

  async getEnterpriseFactVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<EnterpriseFactVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.enterprise_fact_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as EnterpriseFactVersionTable | undefined;
  }

  async getEnterpriseFactVersions(
    trx: EnterpriseProjectTransaction,
    enterpriseFactId: string,
  ): Promise<EnterpriseFactVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.enterprise_fact_version')
      .selectAll()
      .where('enterprise_fact_id', '=', enterpriseFactId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as EnterpriseFactVersionTable[];
  }

  // -------------------- enterprise_profile_snapshot --------------------

  async insertEnterpriseProfileSnapshot(
    trx: EnterpriseProjectTransaction,
    insert: EnterpriseProfileSnapshotInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.frozenByPrincipalId);
    await trx
      .insertInto('enterprise_project.enterprise_profile_snapshot')
      .values({
        snapshot_id: insert.snapshotId,
        enterprise_id: insert.enterpriseId,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        derived_from: JSON.stringify(insert.derivedFrom),
        frozen_by_principal_id: insert.frozenByPrincipalId,
        frozen_by_actor_snapshot_id: insert.frozenByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        purpose: insert.purpose,
        source_command_id: insert.sourceCommandId,
        recorded_at: new Date(),
      })
      .execute();
  }

  async getEnterpriseProfileSnapshot(
    trx: EnterpriseProjectTransaction,
    snapshotId: string,
  ): Promise<EnterpriseProfileSnapshotTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.enterprise_profile_snapshot')
      .selectAll()
      .where('snapshot_id', '=', snapshotId)
      .executeTakeFirst()) as unknown as EnterpriseProfileSnapshotTable | undefined;
  }

  // -------------------- product --------------------

  async insertProduct(trx: EnterpriseProjectTransaction, insert: ProductInsert): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    const inserted = await trx
      .insertInto('enterprise_project.product')
      .values({
        product_id: insert.productId,
        enterprise_id: insert.enterpriseId,
        display_code: insert.displayCode,
        display_name: insert.displayName,
        status: 'ACTIVE',
        current_version_id: insert.initialVersionId,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
        retention_class: 'CUSTOMER_RECORD',
      })
      .onConflict((oc) => oc.columns(['enterprise_id', 'display_code']).doNothing())
      .returning('product_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getProductById(
    trx: EnterpriseProjectTransaction,
    productId: string,
  ): Promise<ProductTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.product')
      .selectAll()
      .where('product_id', '=', productId)
      .executeTakeFirst()) as unknown as ProductTable | undefined;
  }

  async casProduct(
    trx: EnterpriseProjectTransaction,
    productId: string,
    expectedVersion: string,
    nextVersionId?: string,
  ): Promise<CasResult<ProductTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.product')
      .set({
        aggregate_version: next,
        updated_at: new Date(),
        ...(nextVersionId !== undefined ? { current_version_id: nextVersionId } : {}),
      })
      .where('product_id', '=', productId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getProductById(trx, productId);
      if (!row) throw new Error('casProduct: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getProductById(trx, productId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casProduct: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  // -------------------- product_version --------------------

  async insertProductVersion(
    trx: EnterpriseProjectTransaction,
    insert: ProductVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.product_version')
      .values({
        version_id: insert.versionId,
        product_id: insert.productId,
        enterprise_id: insert.enterpriseId,
        version_no: insert.versionNo,
        product_type: insert.productType,
        display_name: insert.displayName,
        intended_use: insert.intendedUse,
        product_scope: JSON.stringify(insert.productScope),
        source_refs: JSON.stringify(insert.sourceRefs),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        lifecycle: 'HISTORICAL',
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        recorded_at: new Date(),
        previous_version_id: insert.previousVersionId ?? null,
      })
      .execute();
  }

  async markProductVersionCurrent(
    trx: EnterpriseProjectTransaction,
    productId: string,
    newCurrentVersionId: string,
  ): Promise<void> {
    await trx
      .updateTable('enterprise_project.product_version')
      .set({ lifecycle: 'HISTORICAL' })
      .where('product_id', '=', productId)
      .where('lifecycle', '=', 'CURRENT')
      .where('version_id', '<>', newCurrentVersionId)
      .execute();
    await trx
      .updateTable('enterprise_project.product_version')
      .set({ lifecycle: 'CURRENT' })
      .where('version_id', '=', newCurrentVersionId)
      .where('product_id', '=', productId)
      .execute();
  }

  async getProductVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<ProductVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.product_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as ProductVersionTable | undefined;
  }

  async getProductVersions(
    trx: EnterpriseProjectTransaction,
    productId: string,
  ): Promise<ProductVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.product_version')
      .selectAll()
      .where('product_id', '=', productId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as ProductVersionTable[];
  }

  // -------------------- product_scope_snapshot --------------------

  async insertProductScopeSnapshot(
    trx: EnterpriseProjectTransaction,
    insert: ProductScopeSnapshotInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.frozenByPrincipalId);
    await trx
      .insertInto('enterprise_project.product_scope_snapshot')
      .values({
        snapshot_id: insert.snapshotId,
        product_id: insert.productId,
        enterprise_id: insert.enterpriseId,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        derived_from: JSON.stringify(insert.derivedFrom),
        frozen_by_principal_id: insert.frozenByPrincipalId,
        frozen_by_actor_snapshot_id: insert.frozenByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        purpose: insert.purpose,
        source_command_id: insert.sourceCommandId,
        recorded_at: new Date(),
      })
      .execute();
  }

  async getProductScopeSnapshot(
    trx: EnterpriseProjectTransaction,
    snapshotId: string,
  ): Promise<ProductScopeSnapshotTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.product_scope_snapshot')
      .selectAll()
      .where('snapshot_id', '=', snapshotId)
      .executeTakeFirst()) as unknown as ProductScopeSnapshotTable | undefined;
  }

  // -------------------- qms_configuration --------------------

  async insertQmsConfiguration(
    trx: EnterpriseProjectTransaction,
    insert: QmsConfigurationInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.qms_configuration')
      .values({
        qms_configuration_id: insert.qmsConfigurationId,
        enterprise_id: insert.enterpriseId,
        display_code: insert.displayCode,
        display_name: insert.displayName,
        status: 'ACTIVE',
        current_revision_id: insert.initialRevisionId,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        last_command_id: insert.sourceCommandId,
        created_at: new Date(),
        updated_at: new Date(),
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  async getQmsConfigurationById(
    trx: EnterpriseProjectTransaction,
    qmsConfigurationId: string,
  ): Promise<QmsConfigurationTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.qms_configuration')
      .selectAll()
      .where('qms_configuration_id', '=', qmsConfigurationId)
      .executeTakeFirst()) as unknown as QmsConfigurationTable | undefined;
  }

  async casQmsConfiguration(
    trx: EnterpriseProjectTransaction,
    qmsConfigurationId: string,
    expectedVersion: string,
    nextRevisionId?: string,
  ): Promise<CasResult<QmsConfigurationTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.qms_configuration')
      .set({
        aggregate_version: next,
        updated_at: new Date(),
        ...(nextRevisionId !== undefined ? { current_revision_id: nextRevisionId } : {}),
      })
      .where('qms_configuration_id', '=', qmsConfigurationId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getQmsConfigurationById(trx, qmsConfigurationId);
      if (!row) throw new Error('casQmsConfiguration: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getQmsConfigurationById(trx, qmsConfigurationId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casQmsConfiguration: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  // -------------------- qms_configuration_revision --------------------

  async insertQmsConfigurationRevision(
    trx: EnterpriseProjectTransaction,
    insert: QmsConfigurationRevisionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.qms_configuration_revision')
      .values({
        revision_id: insert.revisionId,
        qms_configuration_id: insert.qmsConfigurationId,
        enterprise_id: insert.enterpriseId,
        revision_no: insert.revisionNo,
        applicability_decisions: JSON.stringify(insert.applicabilityDecisions),
        management_choices: JSON.stringify(insert.managementChoices),
        professional_decisions: JSON.stringify(insert.professionalDecisions),
        source_refs: JSON.stringify(insert.sourceRefs),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        lifecycle: 'HISTORICAL',
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        recorded_at: new Date(),
        previous_revision_id: insert.previousRevisionId ?? null,
      })
      .execute();
  }

  async markQmsConfigurationRevisionCurrent(
    trx: EnterpriseProjectTransaction,
    qmsConfigurationId: string,
    newCurrentRevisionId: string,
  ): Promise<void> {
    await trx
      .updateTable('enterprise_project.qms_configuration_revision')
      .set({ lifecycle: 'HISTORICAL' })
      .where('qms_configuration_id', '=', qmsConfigurationId)
      .where('lifecycle', '=', 'CURRENT')
      .where('revision_id', '<>', newCurrentRevisionId)
      .execute();
    await trx
      .updateTable('enterprise_project.qms_configuration_revision')
      .set({ lifecycle: 'CURRENT' })
      .where('revision_id', '=', newCurrentRevisionId)
      .where('qms_configuration_id', '=', qmsConfigurationId)
      .execute();
  }

  async getQmsConfigurationRevision(
    trx: EnterpriseProjectTransaction,
    revisionId: string,
  ): Promise<QmsConfigurationRevisionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.qms_configuration_revision')
      .selectAll()
      .where('revision_id', '=', revisionId)
      .executeTakeFirst()) as unknown as QmsConfigurationRevisionTable | undefined;
  }

  async getQmsConfigurationRevisions(
    trx: EnterpriseProjectTransaction,
    qmsConfigurationId: string,
  ): Promise<QmsConfigurationRevisionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.qms_configuration_revision')
      .selectAll()
      .where('qms_configuration_id', '=', qmsConfigurationId)
      .orderBy('revision_no', 'asc')
      .execute()) as unknown as QmsConfigurationRevisionTable[];
  }

  // IM-03 WI-04 (issue #60): Project Aggregate root + Scope Claim +
  // Project Start Snapshot Binding. The Project row owns the
  // (enterprise_id, project_id) tuple; both columns are immutable once
  // written (PG-007 / Issue #60 #1). The ScopeClaim publishes that pair to
  // other modules. The SnapshotBinding freezes the exact StartSnapshot
  // inputs at create time.

  async insertProject(trx: EnterpriseProjectTransaction, insert: ProjectInsert): Promise<boolean> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    // A new Project is not visible to the Project SELECT policy until its
    // project_id is added to the trusted allowed-project set. PostgreSQL's
    // ON CONFLICT arbiter path therefore cannot be used here: it needs to
    // read the prospective row and raises an RLS error before the duplicate
    // can be converted into a business rejection. Keep the unique-violation
    // path inside a savepoint so the surrounding command transaction remains
    // usable for the receipt and rejection result.
    const savepoint = 'project_display_code_insert';
    await sql.raw(`SAVEPOINT ${savepoint}`).execute(trx);
    try {
      await trx
        .insertInto('enterprise_project.project')
        .values({
          project_id: insert.projectId,
          enterprise_id: insert.enterpriseId,
          display_code: insert.displayCode,
          title: insert.title,
          objective: insert.objective,
          status: 'ACTIVE',
          member_policy_ref: JSON.stringify(insert.memberPolicyRef),
          member_policy_version_id: insert.memberPolicyVersionId,
          member_policy_payload_hash: insert.memberPolicyPayloadHash,
          created_by_principal_id: insert.createdByPrincipalId,
          created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
          last_command_id: insert.sourceCommandId,
          created_at: new Date(),
          updated_at: new Date(),
          retention_class: 'CUSTOMER_RECORD',
        })
        // Do not use RETURNING: PostgreSQL applies the Project SELECT RLS
        // policy to returned rows, and a freshly minted project_id is not
        // visible through that policy yet.
        .execute();
      await sql.raw(`RELEASE SAVEPOINT ${savepoint}`).execute(trx);
      return true;
    } catch (error) {
      await sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`).execute(trx);
      await sql.raw(`RELEASE SAVEPOINT ${savepoint}`).execute(trx);
      if (isProjectDisplayCodeConflict(error)) return false;
      throw error;
    }
  }

  async getProjectById(
    trx: EnterpriseProjectTransaction,
    projectId: string,
  ): Promise<ProjectTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.project')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst()) as unknown as ProjectTable | undefined;
  }

  async casProject(
    trx: EnterpriseProjectTransaction,
    projectId: string,
    expectedVersion: string,
  ): Promise<CasResult<ProjectTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.project')
      .set({
        aggregate_version: next,
        updated_at: new Date(),
      })
      .where('project_id', '=', projectId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getProjectById(trx, projectId);
      if (!row) throw new Error('casProject: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getProjectById(trx, projectId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casProject: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  async insertProjectScopeClaim(
    trx: EnterpriseProjectTransaction,
    insert: ProjectScopeClaimInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.claimedByPrincipalId);
    await trx
      .insertInto('enterprise_project.project_scope_claim')
      .values({
        claim_id: insert.claimId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        scope_version: '1',
        status: 'ACTIVE',
        claimed_by_principal_id: insert.claimedByPrincipalId,
        claimed_by_actor_snapshot_id: insert.claimedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        payload: JSON.stringify(insert.payload),
        source_command_id: insert.sourceCommandId,
        claimed_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
  }

  async getProjectScopeClaimByProjectId(
    trx: EnterpriseProjectTransaction,
    projectId: string,
  ): Promise<ProjectScopeClaimTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.project_scope_claim')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirst()) as unknown as ProjectScopeClaimTable | undefined;
  }

  async insertProjectSnapshotBinding(
    trx: EnterpriseProjectTransaction,
    insert: ProjectSnapshotBindingInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.boundByPrincipalId);
    await trx
      .insertInto('enterprise_project.project_snapshot_binding')
      .values({
        binding_id: insert.bindingId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        binding_purpose: insert.bindingPurpose,
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
        initial_customer_baseline_ref:
          insert.initialCustomerBaselineRef === undefined
            ? null
            : JSON.stringify(insert.initialCustomerBaselineRef),
        initial_customer_baseline_version_id: insert.initialCustomerBaselineVersionId ?? null,
        initial_customer_baseline_version_hash: insert.initialCustomerBaselineVersionHash ?? null,
        template_baseline_ref:
          insert.templateBaselineRef === undefined
            ? null
            : JSON.stringify(insert.templateBaselineRef),
        template_baseline_version_id: insert.templateBaselineVersionId ?? null,
        template_baseline_version_hash: insert.templateBaselineVersionHash ?? null,
        regulatory_profile_ref:
          insert.regulatoryProfileRef === undefined
            ? null
            : JSON.stringify(insert.regulatoryProfileRef),
        regulatory_profile_version_id: insert.regulatoryProfileVersionId ?? null,
        regulatory_profile_version_hash: insert.regulatoryProfileVersionHash ?? null,
        member_policy_ref: JSON.stringify(insert.memberPolicyRef),
        member_policy_version_id: insert.memberPolicyVersionId,
        member_policy_payload_hash: insert.memberPolicyPayloadHash,
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        bound_at: new Date(),
        bound_by_principal_id: insert.boundByPrincipalId,
        bound_by_actor_snapshot_id: insert.boundByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getProjectSnapshotBinding(
    trx: EnterpriseProjectTransaction,
    projectId: string,
    bindingPurpose: 'PROJECT_START',
  ): Promise<ProjectSnapshotBindingTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.project_snapshot_binding')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('binding_purpose', '=', bindingPurpose)
      .executeTakeFirst()) as unknown as ProjectSnapshotBindingTable | undefined;
  }

  // -------------------- source material --------------------

  async insertSourceMaterial(
    trx: EnterpriseProjectTransaction,
    insert: SourceMaterialInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.source_material')
      .values({
        source_material_id: insert.sourceMaterialId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        submitted_by_principal_id: insert.submittedByPrincipalId,
        submitted_by_ref: JSON.stringify(insert.submittedByRef),
        received_at: insert.receivedAt,
        original_name: insert.originalName,
        media_type: insert.mediaType,
        byte_length: insert.byteLength,
        content_hash: insert.contentHash,
        staged_object_ref: insert.stagedObjectRef,
        descriptor_payload_hash: insert.descriptorPayloadHash,
        custody_status: 'RECEIVED',
        processing_status: 'NOT_PROCESSED',
        duplicate_of_source_material_id: insert.duplicateOfSourceMaterialId ?? null,
        accepted_object_ref: null,
        accepted_at: null,
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
        retention_class: insert.retentionClass,
      })
      .execute();
  }

  async getSourceMaterialById(
    trx: EnterpriseProjectTransaction,
    sourceMaterialId: string,
  ): Promise<SourceMaterialTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.source_material')
      .selectAll()
      .where('source_material_id', '=', sourceMaterialId)
      .executeTakeFirst()) as unknown as SourceMaterialTable | undefined;
  }

  async findSourceMaterialsByHash(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
    contentHash: Buffer,
  ): Promise<SourceMaterialTable[]> {
    return (await trx
      .selectFrom('enterprise_project.source_material')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .where('content_hash', '=', contentHash)
      .orderBy('received_at', 'asc')
      .orderBy('source_material_id', 'asc')
      .execute()) as unknown as SourceMaterialTable[];
  }

  async casSourceMaterialAccepted(
    trx: EnterpriseProjectTransaction,
    sourceMaterialId: string,
    expectedVersion: string,
    acceptedObjectRef: string,
    acceptedAt: Date,
  ): Promise<CasResult<SourceMaterialTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.source_material')
      .set({
        custody_status: 'ACCEPTED',
        accepted_object_ref: acceptedObjectRef,
        accepted_at: acceptedAt,
        aggregate_version: next,
        updated_at: new Date(),
      })
      .where('source_material_id', '=', sourceMaterialId)
      .where('aggregate_version', '=', expectedVersion)
      .where('custody_status', '=', 'RECEIVED')
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getSourceMaterialById(trx, sourceMaterialId);
      if (!row) throw new Error('casSourceMaterialAccepted: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getSourceMaterialById(trx, sourceMaterialId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casSourceMaterialAccepted: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  async insertSourceMaterialOrigin(
    trx: EnterpriseProjectTransaction,
    insert: SourceMaterialOriginInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.source_material_origin')
      .values({
        source_material_origin_id: insert.sourceMaterialOriginId,
        source_material_id: insert.sourceMaterialId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        origin_ref: JSON.stringify(insert.originRef),
        origin_ref_hash: insert.originRefHash,
        received_at: insert.receivedAt,
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        recorded_at: insert.recordedAt ?? new Date(),
      })
      .execute();
  }

  async getSourceMaterialOriginBySourceMaterialId(
    trx: EnterpriseProjectTransaction,
    sourceMaterialId: string,
  ): Promise<SourceMaterialOriginTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.source_material_origin')
      .selectAll()
      .where('source_material_id', '=', sourceMaterialId)
      .orderBy('recorded_at', 'asc')
      .orderBy('source_material_origin_id', 'asc')
      .executeTakeFirst()) as unknown as SourceMaterialOriginTable | undefined;
  }

  async insertSourceMaterialValidation(
    trx: EnterpriseProjectTransaction,
    insert: SourceMaterialValidationInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.source_material_validation')
      .values({
        validation_id: insert.validationId,
        source_material_id: insert.sourceMaterialId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        validation_kind: insert.validationKind,
        outcome: insert.outcome,
        validated_object_ref: insert.validatedObjectRef,
        validated_content_hash: insert.validatedContentHash,
        validated_byte_length: insert.validatedByteLength,
        validator_id: insert.validatorId,
        validator_version: insert.validatorVersion,
        payload: JSON.stringify(insert.payload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        recorded_by_principal_id: insert.recordedByPrincipalId,
        recorded_by_actor_snapshot_id: insert.recordedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        recorded_at: insert.recordedAt ?? new Date(),
      })
      .execute();
  }

  async getSourceMaterialValidationById(
    trx: EnterpriseProjectTransaction,
    validationId: string,
  ): Promise<SourceMaterialValidationTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.source_material_validation')
      .selectAll()
      .where('validation_id', '=', validationId)
      .executeTakeFirst()) as unknown as SourceMaterialValidationTable | undefined;
  }

  // -------------------- customer material --------------------

  async insertCustomerMaterial(
    trx: EnterpriseProjectTransaction,
    insert: CustomerMaterialInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_material')
      .values({
        customer_material_id: insert.customerMaterialId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        material_type: insert.materialType,
        title: insert.title,
        customer_document_number: insert.customerDocumentNumber ?? null,
        customer_version_label: insert.customerVersionLabel ?? null,
        effective_date: insert.effectiveDate ?? null,
        declared_status: insert.declaredStatus,
        completeness: insert.completeness,
        classification_status: insert.classificationStatus ?? 'PROPOSED',
        current_version_id: insert.currentVersionId,
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        confirmed_by_principal_id: null,
        confirmed_by_actor_snapshot_id: null,
        confirmed_at: null,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  async getCustomerMaterialById(
    trx: EnterpriseProjectTransaction,
    customerMaterialId: string,
  ): Promise<CustomerMaterialTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_material')
      .selectAll()
      .where('customer_material_id', '=', customerMaterialId)
      .executeTakeFirst()) as unknown as CustomerMaterialTable | undefined;
  }

  async getCustomerMaterialsByProject(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<CustomerMaterialTable[]> {
    return (await trx
      .selectFrom('enterprise_project.customer_material')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .orderBy('customer_material_id', 'asc')
      .execute()) as unknown as CustomerMaterialTable[];
  }

  async casCustomerMaterial(
    trx: EnterpriseProjectTransaction,
    customerMaterialId: string,
    expectedVersion: string,
    nextVersionId: string,
    nextStatus:
      | 'PROPOSED'
      | 'UNDER_REVIEW'
      | 'CONFIRMED'
      | 'DISPUTED'
      | 'REJECTED'
      | 'NOT_CURRENT'
      | 'SUPERSEDED',
    patch: {
      completeness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNREADABLE';
      declaredStatus: string;
      confirmedByPrincipalId?: string | null;
      confirmedByActorSnapshotId?: string | null;
      confirmedAt?: Date | null;
      sourceCommandId: string;
    },
  ): Promise<CasResult<CustomerMaterialTable>> {
    const expected = BigInt(expectedVersion);
    const next = (expected + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.customer_material')
      .set({
        aggregate_version: next,
        current_version_id: nextVersionId,
        classification_status: nextStatus,
        completeness: patch.completeness,
        declared_status: patch.declaredStatus,
        ...(patch.confirmedByPrincipalId === undefined
          ? {}
          : { confirmed_by_principal_id: patch.confirmedByPrincipalId }),
        ...(patch.confirmedByActorSnapshotId === undefined
          ? {}
          : { confirmed_by_actor_snapshot_id: patch.confirmedByActorSnapshotId }),
        ...(patch.confirmedAt === undefined ? {} : { confirmed_at: patch.confirmedAt }),
        updated_at: new Date(),
        last_command_id: patch.sourceCommandId,
      })
      .where('customer_material_id', '=', customerMaterialId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getCustomerMaterialById(trx, customerMaterialId);
      if (!row) throw new Error('casCustomerMaterial: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getCustomerMaterialById(trx, customerMaterialId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casCustomerMaterial: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  async insertCustomerMaterialVersion(
    trx: EnterpriseProjectTransaction,
    insert: CustomerMaterialVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.proposedByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_material_version')
      .values({
        version_id: insert.versionId,
        customer_material_id: insert.customerMaterialId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: insert.versionStatus,
        material_type: insert.materialType,
        title: insert.title,
        customer_document_number: insert.customerDocumentNumber ?? null,
        customer_version_label: insert.customerVersionLabel ?? null,
        effective_date: insert.effectiveDate ?? null,
        declared_status: insert.declaredStatus,
        completeness: insert.completeness,
        source_selections: JSON.stringify(insert.sourceSelections),
        language: insert.language,
        classification_rationale: JSON.stringify(insert.classificationRationale),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        proposed_by_principal_id: insert.proposedByPrincipalId,
        proposed_by_actor_snapshot_id: insert.proposedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
        previous_version_id: insert.previousVersionId ?? null,
      })
      .execute();
  }

  async getCustomerMaterialVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<CustomerMaterialVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_material_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as CustomerMaterialVersionTable | undefined;
  }

  async getCustomerMaterialVersions(
    trx: EnterpriseProjectTransaction,
    customerMaterialId: string,
  ): Promise<CustomerMaterialVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.customer_material_version')
      .selectAll()
      .where('customer_material_id', '=', customerMaterialId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as CustomerMaterialVersionTable[];
  }

  async insertCustomerMaterialDecision(
    trx: EnterpriseProjectTransaction,
    insert: CustomerMaterialDecisionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.decidedByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_material_decision')
      .values({
        decision_id: insert.decisionId,
        customer_material_id: insert.customerMaterialId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        decision_kind: insert.decisionKind,
        evidence_refs: JSON.stringify(insert.evidenceRefs),
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

  async getCustomerMaterialDecisionById(
    trx: EnterpriseProjectTransaction,
    decisionId: string,
  ): Promise<CustomerMaterialDecisionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_material_decision')
      .selectAll()
      .where('decision_id', '=', decisionId)
      .executeTakeFirst()) as unknown as CustomerMaterialDecisionTable | undefined;
  }

  // -------------------- customer baseline --------------------

  async insertCustomerBaseline(
    trx: EnterpriseProjectTransaction,
    insert: CustomerBaselineInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_baseline')
      .values({
        customer_baseline_id: insert.customerBaselineId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        current_version_id: insert.currentVersionId,
        active_version_id: null,
        aggregate_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        updated_at: new Date(),
        last_command_id: insert.sourceCommandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  async getCustomerBaselineById(
    trx: EnterpriseProjectTransaction,
    customerBaselineId: string,
  ): Promise<CustomerBaselineTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline')
      .selectAll()
      .where('customer_baseline_id', '=', customerBaselineId)
      .executeTakeFirst()) as unknown as CustomerBaselineTable | undefined;
  }

  async getCustomerBaselineByProject(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
  ): Promise<CustomerBaselineTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .executeTakeFirst()) as unknown as CustomerBaselineTable | undefined;
  }

  async casCustomerBaselineDraft(
    trx: EnterpriseProjectTransaction,
    customerBaselineId: string,
    expectedVersion: string,
    nextVersionId: string,
    sourceCommandId: string,
  ): Promise<CasResult<CustomerBaselineTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.customer_baseline')
      .set({
        current_version_id: nextVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('customer_baseline_id', '=', customerBaselineId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getCustomerBaselineById(trx, customerBaselineId);
      if (!row) throw new Error('casCustomerBaselineDraft: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getCustomerBaselineById(trx, customerBaselineId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casCustomerBaselineDraft: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  async casCustomerBaselineActivation(
    trx: EnterpriseProjectTransaction,
    customerBaselineId: string,
    expectedVersion: string,
    nextVersionId: string,
    sourceCommandId: string,
  ): Promise<CasResult<CustomerBaselineTable>> {
    const next = (BigInt(expectedVersion) + 1n).toString();
    const updated = await trx
      .updateTable('enterprise_project.customer_baseline')
      .set({
        current_version_id: nextVersionId,
        active_version_id: nextVersionId,
        aggregate_version: next,
        updated_at: new Date(),
        last_command_id: sourceCommandId,
      })
      .where('customer_baseline_id', '=', customerBaselineId)
      .where('aggregate_version', '=', expectedVersion)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      const row = await this.getCustomerBaselineById(trx, customerBaselineId);
      if (!row) throw new Error('casCustomerBaselineActivation: row disappeared after CAS');
      return { ok: true, nextVersion: next, row };
    }
    const current = await this.getCustomerBaselineById(trx, customerBaselineId);
    if (!current) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
        'casCustomerBaselineActivation: target not found',
      );
    }
    return { ok: false, current: asAggregateVersion(current.aggregate_version) };
  }

  async insertCustomerBaselineVersion(
    trx: EnterpriseProjectTransaction,
    insert: CustomerBaselineVersionInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.proposedByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_baseline_version')
      .values({
        version_id: insert.versionId,
        customer_baseline_id: insert.customerBaselineId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        version_no: insert.versionNo,
        version_status: 'DRAFT',
        previous_version_id: insert.previousVersionId ?? null,
        baseline_policy_ref: JSON.stringify(insert.baselinePolicyRef),
        expectations_payload: JSON.stringify(insert.expectationsPayload),
        payload_hash: insert.payloadHash,
        canonicalization_version: '1',
        proposed_by_principal_id: insert.proposedByPrincipalId,
        proposed_by_actor_snapshot_id: insert.proposedByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        confirmed_by_principal_id: null,
        confirmed_by_actor_snapshot_id: null,
        confirmed_at: null,
        recorded_at: new Date(),
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  async getCustomerBaselineVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<CustomerBaselineVersionTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline_version')
      .selectAll()
      .where('version_id', '=', versionId)
      .executeTakeFirst()) as unknown as CustomerBaselineVersionTable | undefined;
  }

  async getCustomerBaselineVersions(
    trx: EnterpriseProjectTransaction,
    customerBaselineId: string,
  ): Promise<CustomerBaselineVersionTable[]> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline_version')
      .selectAll()
      .where('customer_baseline_id', '=', customerBaselineId)
      .orderBy('version_no', 'asc')
      .execute()) as unknown as CustomerBaselineVersionTable[];
  }

  async confirmCustomerBaselineVersion(
    trx: EnterpriseProjectTransaction,
    versionId: string,
    principalId: string,
    actorSnapshotId: string,
    confirmedAt: Date,
  ): Promise<boolean> {
    await this.assertContextPrincipal(trx, principalId);
    const updated = await trx
      .updateTable('enterprise_project.customer_baseline_version')
      .set({
        version_status: 'CONFIRMED',
        confirmed_by_principal_id: principalId,
        confirmed_by_actor_snapshot_id: actorSnapshotId,
        confirmed_at: confirmedAt,
      })
      .where('version_id', '=', versionId)
      .where('version_status', '=', 'DRAFT')
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  async insertCustomerBaselineItem(
    trx: EnterpriseProjectTransaction,
    insert: CustomerBaselineItemInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.recordedByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_baseline_item')
      .values({
        expectation_id: insert.expectationId,
        customer_baseline_id: insert.customerBaselineId,
        version_id: insert.versionId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        expected_material_key: insert.expectedMaterialKey,
        material_type: insert.materialType,
        expected_title_or_role: insert.expectedTitleOrRole,
        status: insert.status,
        customer_material_refs: JSON.stringify(insert.customerMaterialRefs),
        decision_ref: insert.decisionRef === undefined ? null : JSON.stringify(insert.decisionRef),
        reason: JSON.stringify(insert.reason),
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

  async getCustomerBaselineItems(
    trx: EnterpriseProjectTransaction,
    versionId: string,
  ): Promise<CustomerBaselineItemTable[]> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline_item')
      .selectAll()
      .where('version_id', '=', versionId)
      .orderBy('expected_material_key', 'asc')
      .orderBy('expectation_id', 'asc')
      .execute()) as unknown as CustomerBaselineItemTable[];
  }

  async insertCustomerBaselineImpactReview(
    trx: EnterpriseProjectTransaction,
    insert: CustomerBaselineImpactReviewInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.customer_baseline_impact_review')
      .values({
        impact_review_id: insert.impactReviewId,
        customer_baseline_id: insert.customerBaselineId,
        new_version_id: insert.newVersionId,
        previous_active_version_id: insert.previousActiveVersionId ?? null,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        review_snapshot_ref: JSON.stringify(insert.reviewSnapshotRef),
        impact_policy_ref: JSON.stringify(insert.impactPolicyRef),
        justification: JSON.stringify(insert.justification),
        affected_references: JSON.stringify(insert.affectedReferences),
        stale_references: JSON.stringify(insert.staleReferences),
        impact_status: insert.impactStatus,
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

  async getCustomerBaselineImpactReviewByVersion(
    trx: EnterpriseProjectTransaction,
    customerBaselineId: string,
    versionId: string,
  ): Promise<CustomerBaselineImpactReviewTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.customer_baseline_impact_review')
      .selectAll()
      .where('customer_baseline_id', '=', customerBaselineId)
      .where('new_version_id', '=', versionId)
      .executeTakeFirst()) as unknown as CustomerBaselineImpactReviewTable | undefined;
  }

  async getReferenceEdgesToCustomerBaselineVersion(
    trx: EnterpriseProjectTransaction,
    enterpriseId: string,
    projectId: string,
    customerBaselineId: string,
    versionId: string,
  ): Promise<ReferenceEdgeTable[]> {
    return (await trx
      .selectFrom('enterprise_project.reference_edge')
      .selectAll()
      .where('enterprise_id', '=', enterpriseId)
      .where('project_id', '=', projectId)
      .where('target_module', '=', 'EnterpriseProject')
      .where('target_object_type', '=', 'CustomerBaseline')
      .where('target_object_id', '=', customerBaselineId)
      .where('target_version_id', '=', versionId)
      .orderBy('created_at', 'asc')
      .orderBy('reference_path', 'asc')
      .execute()) as unknown as ReferenceEdgeTable[];
  }
}
