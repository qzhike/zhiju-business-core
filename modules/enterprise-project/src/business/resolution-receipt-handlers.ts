// IM-06 (#191): narrow authoritative Resolution Receipt attestation Query.
//
// `project.get_resolution_receipt@1.0` dereferences one exact CommandReceipt
// content address and returns the immutable attestation of the CustomerMaterial
// confirmation that receipt committed. The attestation is re-verified against
// the owning command receipt, the real confirmed version, the confirmation
// BusinessDecision and the confirmed source selections before it is returned:
// the caller's claimed outcome, candidate, result or actor is never echoed
// back, and a receipt that is not a committed confirmation of the first
// version stays unavailable instead of being repaired.
//
// Authorization never degrades to "the caller is a Service": the entry
// requires the trusted transaction context to pin the registered authorization
// purpose of the operation, exactly like the Source Slice read.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import { ResolutionReceiptRepository } from '../persistence/resolution-receipt-repository.js';
import type {
  CustomerMaterialVersionTable,
  ResolutionReceiptMaterialTable,
} from '../persistence/enterprise-business-types.js';
import { AUTHORIZATION_DECISION_INVALID } from './context-source-slice-handlers.js';
import {
  receiptSourceMaterialRefs,
  type ReceiptSourceMaterialRef,
} from './customer-material-handlers.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';

const repo = new ResolutionReceiptRepository();
const CONTRACT_REGISTRY = new ContractRegistry();

export const GET_RESOLUTION_RECEIPT_QUERY = 'project.get_resolution_receipt';
export const GET_RESOLUTION_RECEIPT_PURPOSE = 'project.resolution_receipt.read';
/** Canonical public object name of the EnterpriseProject command receipt. */
export const COMMAND_RECEIPT_OBJECT_TYPE = 'zhiju.project.command_receipt';
/** The only command the first version attests. */
export const CONFIRM_CUSTOMER_MATERIAL_COMMAND = 'project.confirm_customer_material';

export type GetResolutionReceiptQueryPayload = EnterpriseProject.ProjectGetResolutionReceiptPayload;

/** Exact Receipt content address as the registered attestation declares it. */
type CommandReceiptRef = EnterpriseProject.ProjectGetResolutionReceiptResult['commandReceiptRef'];

function receiptError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function contentHashValue(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

function hashFromContentHash(value: unknown): Buffer | undefined {
  const hash = record(value);
  return hash.algorithm === 'SHA-256' &&
    hash.canonicalizationVersion === '1' &&
    typeof hash.digest === 'string' &&
    /^[0-9a-f]{64}$/u.test(hash.digest)
    ? Buffer.from(hash.digest, 'hex')
    : undefined;
}

/**
 * Registered purpose gate: the pinned Decision must have been issued for the
 * registered authorization purpose of this entry. A Service principal without
 * that purpose is rejected exactly like any other unauthorized caller.
 */
function requireRegisteredPurpose(
  context: EnterpriseProjectTransactionContext,
  purpose: string,
): void {
  if (context.authorizationPurposes?.includes(purpose) !== true) {
    receiptError(
      AUTHORIZATION_DECISION_INVALID,
      'the pinned authorization decision does not cover this operation',
    );
  }
}

/**
 * The requested exact Receipt content address: `CONTENT_ADDRESSED` for the
 * registered CommandReceipt object type, with an exact Project scope and a
 * complete content hash. The Scope must already be inside the trusted context;
 * the authoritative Scope comparison happens against the stored receipt.
 */
function receiptReference(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
): CommandReceiptRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const scopeProjectId = scope.projectId;
  const hash = hashFromContentHash(ref.contentHash);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== COMMAND_RECEIPT_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof scopeProjectId !== 'string' ||
    !isUuidV7(scopeProjectId) ||
    hash === undefined
  ) {
    receiptError(
      PROJECT_QUERY_REF_INVALID,
      'commandReceiptRef must be an exact CommandReceipt content address',
    );
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(scopeProjectId)
  ) {
    receiptError(PROJECT_QUERY_SCOPE_MISMATCH, 'commandReceiptRef is outside the trusted scope');
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: COMMAND_RECEIPT_OBJECT_TYPE,
    objectId: ref.objectId,
    scope: { enterpriseId: context.enterpriseId, projectId: scopeProjectId },
    contentHash: contentHashValue(hash.toString('hex')),
  };
}

/**
 * The exact source refs of the stored confirmed version, in their public
 * spelling. They are rebuilt from the frozen version payload with the same
 * exact-ref dedupe rule the live Receipt projection and the V2015 backfill
 * use, so a selection that repeats one SourceMaterial under another
 * role/locator never publishes that source twice, and a stored receipt that
 * disagrees with the real confirmation is refused instead of being returned.
 */
function confirmedSourceMaterialRefs(
  version: CustomerMaterialVersionTable,
  scope: Common.ScopeRef,
): readonly ReceiptSourceMaterialRef[] {
  const selections = Array.isArray(version.source_selections)
    ? (version.source_selections as unknown[])
    : [];
  return receiptSourceMaterialRefs(
    selections.map((selection) => {
      const source = record(record(selection).sourceMaterialRef);
      const hash = hashFromContentHash(source.contentHash);
      if (typeof source.objectId !== 'string' || !isUuidV7(source.objectId) || hash === undefined) {
        receiptError(
          PROJECT_QUERY_REF_INVALID,
          'the stored confirmation does not carry an exact source selection',
        );
      }
      return { objectId: source.objectId, payloadHash: hash };
    }),
    scope,
  );
}

interface ReceiptRow {
  readonly command_id: string;
  readonly command_type: string;
  readonly command_version: string;
  readonly request_payload_hash: Buffer;
  readonly enterprise_id: string;
  readonly project_id?: string | null;
  readonly target_id: string;
  readonly outcome: string;
  readonly completed_at: Date | null;
  readonly created_by_principal_id: string;
  readonly actor_snapshot_id: string;
  readonly authorization_decision_id: string;
}

/**
 * Joint verification of the persisted receipt material against the owning
 * command receipt. Every attested fact must be the fact that command actually
 * committed: a receipt of another command type, another Scope or target, an
 * unfinalized receipt, or a receipt whose actor/decision attribution differs
 * from the material is not attestable.
 */
function assertReceiptAgrees(material: ResolutionReceiptMaterialTable, receipt: ReceiptRow): void {
  if (
    receipt.command_id !== material.command_id ||
    receipt.command_type !== material.command_type ||
    receipt.command_version !== material.command_version ||
    receipt.outcome !== 'COMMITTED' ||
    receipt.completed_at === null ||
    receipt.project_id === null ||
    receipt.enterprise_id !== material.enterprise_id ||
    receipt.project_id !== material.project_id ||
    !receipt.request_payload_hash.equals(material.request_payload_hash) ||
    receipt.created_by_principal_id !== material.created_by_principal_id ||
    receipt.actor_snapshot_id !== material.created_by_actor_snapshot_id ||
    receipt.authorization_decision_id !== material.authorization_decision_id ||
    receipt.completed_at.getTime() !== material.committed_at.getTime()
  ) {
    receiptError(
      PROJECT_QUERY_NOT_FOUND,
      'the requested receipt is not a committed confirmation of this Project',
    );
  }
}

/**
 * `project.get_resolution_receipt@1.0`: return the immutable attestation of
 * one committed CustomerMaterial confirmation. The exact reference, its Scope,
 * the owning receipt, the real confirmed version, the confirmation Decision
 * and the confirmed source selections are verified together; anything that
 * cannot be proven from those immutable facts is unavailable.
 */
export async function handleGetResolutionReceipt(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: GetResolutionReceiptQueryPayload,
): Promise<EnterpriseProject.ProjectGetResolutionReceiptResult> {
  requireRegisteredPurpose(context, GET_RESOLUTION_RECEIPT_PURPOSE);
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    receiptError(PROJECT_QUERY_CONTEXT_EXPIRED, 'authorization context has expired');
  }
  const ref = receiptReference(payload.commandReceiptRef, context);
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const material = await repo.getResolutionReceiptMaterialById(trx, ref.objectId);
    if (material === undefined) {
      receiptError(PROJECT_QUERY_NOT_FOUND, 'the requested receipt is not available');
    }
    if (
      material.enterprise_id !== context.enterpriseId ||
      !context.allowedProjectIds.includes(material.project_id) ||
      material.project_id !== ref.scope.projectId
    ) {
      receiptError(PROJECT_QUERY_SCOPE_MISMATCH, 'the requested receipt is outside the scope');
    }
    const storedPayload = material.receipt_payload as CanonicalJsonObject;
    const digest = digestCanonicalPayload(storedPayload).hash;
    if (
      !digest.equals(Buffer.from(ref.contentHash.digest, 'hex')) ||
      !digest.equals(material.receipt_payload_hash)
    ) {
      receiptError(
        PROJECT_QUERY_REF_INVALID,
        'the requested content address is not the canonical Receipt payload',
      );
    }
    const receipt = await repo.getCommandReceiptById(trx, material.command_id);
    if (receipt === undefined) {
      receiptError(PROJECT_QUERY_NOT_FOUND, 'the requested receipt is not available');
    }
    assertReceiptAgrees(material, receipt as unknown as ReceiptRow);

    const scope: Common.ScopeRef = {
      enterpriseId: material.enterprise_id,
      projectId: material.project_id,
    };
    const candidateVersionRef = material.candidate_version_ref as unknown as {
      objectId: string;
      versionId: string;
    };
    const confirmedVersionRef = material.confirmed_version_ref as unknown as {
      objectId: string;
      versionId: string;
    };
    const version = await repo.getCustomerMaterialVersion(trx, confirmedVersionRef.versionId);
    if (
      version?.version_status !== 'CONFIRMED' ||
      version.customer_material_id !== confirmedVersionRef.objectId ||
      version.enterprise_id !== material.enterprise_id ||
      version.project_id !== material.project_id ||
      version.source_command_id !== material.command_id ||
      version.previous_version_id !== candidateVersionRef.versionId
    ) {
      receiptError(
        PROJECT_QUERY_NOT_FOUND,
        'the confirmed version of this receipt is not available',
      );
    }
    const decisionRef = material.decision_ref as unknown as { objectId: string };
    const decision = await repo.getCustomerMaterialDecisionById(trx, decisionRef.objectId);
    if (
      decision?.decision_kind !== 'CONFIRMED' ||
      decision.version_id !== version.version_id ||
      decision.customer_material_id !== version.customer_material_id ||
      decision.enterprise_id !== material.enterprise_id ||
      decision.project_id !== material.project_id ||
      decision.source_command_id !== material.command_id ||
      decision.decided_by_principal_id !== material.created_by_principal_id ||
      decision.decided_by_actor_snapshot_id !== material.created_by_actor_snapshot_id ||
      decision.authorization_decision_id !== material.authorization_decision_id
    ) {
      receiptError(
        PROJECT_QUERY_NOT_FOUND,
        'the confirmation decision of this receipt is not available',
      );
    }
    const sourceMaterialRefs = confirmedSourceMaterialRefs(version, scope);
    const attestedSourceRefs = material.source_material_refs as unknown as CanonicalJsonObject[];
    // JSONB does not preserve object key order, so the stored selection refs
    // are compared by their canonical payload hash rather than by raw text.
    if (
      attestedSourceRefs.length !== sourceMaterialRefs.length ||
      attestedSourceRefs.some(
        (attested, index) =>
          sourceMaterialRefs[index] === undefined ||
          digestCanonicalPayload(attested).hash.toString('hex') !==
            digestCanonicalPayload(sourceMaterialRefs[index].ref).hash.toString('hex'),
      )
    ) {
      receiptError(
        PROJECT_QUERY_NOT_FOUND,
        'the confirmed source selections of this receipt are not available',
      );
    }
    for (const sourceRef of sourceMaterialRefs) {
      const source = await repo.getSourceMaterialById(trx, sourceRef.objectId);
      if (
        source?.custody_status !== 'ACCEPTED' ||
        source.enterprise_id !== material.enterprise_id ||
        source.project_id !== material.project_id
      ) {
        receiptError(
          PROJECT_QUERY_NOT_FOUND,
          'a confirmed source of this receipt is not available',
        );
      }
    }

    const attestation: EnterpriseProject.ProjectGetResolutionReceiptResult = {
      commandReceiptRef: ref,
      commandType: 'project.confirm_customer_material',
      commandVersion: '1.0',
      targetRef:
        material.target_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['targetRef'],
      scopeRef: { enterpriseId: material.enterprise_id, projectId: material.project_id },
      requestPayloadHash: contentHashValue(material.request_payload_hash.toString('hex')),
      outcome: 'COMMITTED',
      candidateVersionRef:
        material.candidate_version_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['candidateVersionRef'],
      confirmedVersionRef:
        material.confirmed_version_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['confirmedVersionRef'],
      sourceMaterialRefs:
        attestedSourceRefs as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['sourceMaterialRefs'],
      decisionRef:
        material.decision_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['decisionRef'],
      actorRef:
        material.actor_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['actorRef'],
      actorSnapshotRef:
        material.actor_snapshot_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['actorSnapshotRef'],
      authorizationDecisionRef:
        material.authorization_decision_ref as unknown as EnterpriseProject.ProjectGetResolutionReceiptResult['authorizationDecisionRef'],
      committedAt: material.committed_at.toISOString(),
    };
    const contract = CONTRACT_REGISTRY.validateOperationResult(
      GET_RESOLUTION_RECEIPT_QUERY,
      '1.0',
      attestation,
    );
    if (!contract.valid) {
      receiptError(
        PROJECT_QUERY_REF_INVALID,
        'the stored receipt cannot be returned as a registered ResolutionReceiptAttestation',
      );
    }
    return attestation;
  });
}
