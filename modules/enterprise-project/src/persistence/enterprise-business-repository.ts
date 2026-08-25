// IM-03 WI-03 (issue #59): business-aggregate repository for EnterpriseProject.
// Reuses the WI-02 Application/Persistence foundation (one transaction over
// `process_instance` CAS is not applicable here — the business aggregates
// own their own `aggregate_version` columns on V2001 roots). Every method
// binds the trusted transaction context principal and validates the promoted
// scope mirrors (Issue #59 §1–§4).

import { sql } from 'kysely';
import type { EnterpriseProjectTransaction } from './enterprise-db.js';
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
  initialVersionId: string;
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
  initialRevisionId: string;
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

export type CasResult<T> =
  { ok: true; nextVersion: string; row: T } | { ok: false; current: string };

function asAggregateVersion(value: unknown): string {
  return String(value);
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
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
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
      .execute();
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
        current_status: 'PROPOSED',
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

  async insertProduct(trx: EnterpriseProjectTransaction, insert: ProductInsert): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
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
      .execute();
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
}
