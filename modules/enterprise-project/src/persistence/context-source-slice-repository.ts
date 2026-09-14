// IM-06 (#188): ContextSourceSlice persistence. One immutable capture fact per
// slice identity; the repository appends the Slice and reads it back by exact
// id inside the owning transaction. It never rewrites a committed Slice and
// never touches another module's tables.

import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { EnterpriseBusinessRepository } from './enterprise-business-repository.js';
import type { ContextSourceSliceTable } from './enterprise-business-types.js';

export interface ContextSourceSliceInsert {
  sliceId: string;
  enterpriseId: string;
  projectId: string;
  purpose: string;
  audienceRef: unknown;
  capturePolicyRef: unknown;
  capturedAt: Date;
  validUntil: Date;
  slicePayload: unknown;
  slicePayloadHash: Buffer;
  policyVersionRef: unknown;
  policySetVersion: string;
  policyContentHash: Buffer;
  policyEffectiveFrom: Date;
  policySupersededAt?: Date | undefined;
  policyCheckedAt: Date;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
  sourceCommandId: string;
}

export class ContextSourceSliceRepository extends EnterpriseBusinessRepository {
  /**
   * Appends the Slice together with its Policy observation metadata. The
   * created-by principal must equal the trusted transaction context.
   */
  async insertContextSourceSlice(
    trx: EnterpriseProjectTransaction,
    insert: ContextSourceSliceInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.context_source_slice')
      .values({
        slice_id: insert.sliceId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        purpose: insert.purpose,
        audience_ref: JSON.stringify(insert.audienceRef),
        capture_policy_ref: JSON.stringify(insert.capturePolicyRef),
        captured_at: insert.capturedAt,
        valid_until: insert.validUntil,
        slice_payload: JSON.stringify(insert.slicePayload),
        slice_payload_hash: insert.slicePayloadHash,
        policy_version_ref: JSON.stringify(insert.policyVersionRef),
        policy_set_version: insert.policySetVersion,
        policy_content_hash: insert.policyContentHash,
        policy_effective_from: insert.policyEffectiveFrom,
        policy_superseded_at: insert.policySupersededAt ?? null,
        policy_checked_at: insert.policyCheckedAt,
        canonicalization_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.sourceCommandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  /**
   * Reads one Slice by its exact id. FORCE RLS already limits the result to the
   * transaction's allowed Project scope, so a foreign Project Slice is simply
   * not visible and no existence information leaks through this path.
   */
  async getContextSourceSliceById(
    trx: EnterpriseProjectTransaction,
    sliceId: string,
  ): Promise<ContextSourceSliceTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.context_source_slice')
      .selectAll()
      .where('slice_id', '=', sliceId)
      .executeTakeFirst()) as unknown as ContextSourceSliceTable | undefined;
  }
}
