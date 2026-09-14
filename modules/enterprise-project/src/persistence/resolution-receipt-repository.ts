// IM-06 (#191): canonical Resolution Receipt material persistence. The
// repository appends one immutable canonical receipt fact per committed
// CustomerMaterial confirmation command inside the owning command transaction
// and reads it back by the exact command id. It never rewrites a committed
// receipt and never touches another module's tables.

import type { EnterpriseProjectTransaction } from './enterprise-db.js';
import { EnterpriseBusinessRepository } from './enterprise-business-repository.js';
import type { ResolutionReceiptMaterialTable } from './enterprise-business-types.js';

export interface ResolutionReceiptMaterialInsert {
  commandId: string;
  enterpriseId: string;
  projectId: string;
  commandType: string;
  commandVersion: string;
  outcome: 'COMMITTED';
  targetRef: unknown;
  requestPayloadHash: Buffer;
  candidateVersionRef: unknown;
  confirmedVersionRef: unknown;
  sourceMaterialRefs: unknown;
  decisionRef: unknown;
  actorRef: unknown;
  actorSnapshotRef: unknown;
  authorizationDecisionRef: unknown;
  committedAt: Date;
  receiptPayload: unknown;
  receiptPayloadHash: Buffer;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
  authorizationDecisionId: string;
}

export class ResolutionReceiptRepository extends EnterpriseBusinessRepository {
  /**
   * Appends the canonical receipt material of one committed confirmation. The
   * promoted mirrors and the content address are re-checked by the V2015
   * guard, and the created-by principal must equal the trusted transaction
   * context.
   */
  async insertResolutionReceiptMaterial(
    trx: EnterpriseProjectTransaction,
    insert: ResolutionReceiptMaterialInsert,
  ): Promise<void> {
    await this.assertContextPrincipal(trx, insert.createdByPrincipalId);
    await trx
      .insertInto('enterprise_project.resolution_receipt_material')
      .values({
        command_id: insert.commandId,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId,
        command_type: insert.commandType,
        command_version: insert.commandVersion,
        outcome: insert.outcome,
        target_ref: JSON.stringify(insert.targetRef),
        request_payload_hash: insert.requestPayloadHash,
        candidate_version_ref: JSON.stringify(insert.candidateVersionRef),
        confirmed_version_ref: JSON.stringify(insert.confirmedVersionRef),
        source_material_refs: JSON.stringify(insert.sourceMaterialRefs),
        decision_ref: JSON.stringify(insert.decisionRef),
        actor_ref: JSON.stringify(insert.actorRef),
        actor_snapshot_ref: JSON.stringify(insert.actorSnapshotRef),
        authorization_decision_ref: JSON.stringify(insert.authorizationDecisionRef),
        committed_at: insert.committedAt,
        receipt_payload: JSON.stringify(insert.receiptPayload),
        receipt_payload_hash: insert.receiptPayloadHash,
        canonicalization_version: '1',
        created_at: new Date(),
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
        authorization_decision_id: insert.authorizationDecisionId,
        source_command_id: insert.commandId,
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
  }

  /**
   * Reads one canonical receipt material by its exact command id. FORCE RLS
   * already limits the result to the transaction's allowed Project scope, so a
   * foreign Project receipt is simply not visible through this path.
   */
  async getResolutionReceiptMaterialById(
    trx: EnterpriseProjectTransaction,
    commandId: string,
  ): Promise<ResolutionReceiptMaterialTable | undefined> {
    return (await trx
      .selectFrom('enterprise_project.resolution_receipt_material')
      .selectAll()
      .where('command_id', '=', commandId)
      .executeTakeFirst()) as unknown as ResolutionReceiptMaterialTable | undefined;
  }

  /**
   * Reads the owning command receipt of one command id. The receipt row is the
   * immutable authority the attestation is re-verified against.
   */
  async getCommandReceiptById(trx: EnterpriseProjectTransaction, commandId: string) {
    return trx
      .selectFrom('enterprise_project.command_receipt')
      .selectAll()
      .where('command_id', '=', commandId)
      .executeTakeFirst();
  }
}
