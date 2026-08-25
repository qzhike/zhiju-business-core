// IM-03 WI-03 (issue #59): business handlers for the EnterpriseProject
// vertical slice. Each handler reuses the WI-02 Application/Persistence
// foundation (`executeEnterpriseProjectCommand`, `assertEnvelopeMatchesContext`,
// `digestCanonicalPayload`) so receipt / idempotency / CAS / audit / outbox
// / reference-edge behaviour is identical to the technical CAS path.
//
// Handlers fall into two groups:
//   * public Contract handlers — `project.create_enterprise`,
//     `project.propose_enterprise_fact`, `project.confirm_enterprise_fact`,
//     `project.get_enterprise_profile_snapshot`. These are part of the 200
//     item public Contract Catalog.
//   * controlled Capability handlers — `enterprise_product.create`,
//     `enterprise_product.create_version`, `enterprise_product.activate_version`,
//     `enterprise_product.create_scope_snapshot`,
//     `enterprise_qms.create_revision`, `enterprise_qms.activate_revision`,
//     `enterprise_profile.create_snapshot`. These were frozen by WI-01
//     (Contract-Decision-Matrix.md) and intentionally do not enter the
//     public Registry; they are Application-layer-only and require explicit
//     purpose binding at the composition layer.

import type { Kysely } from 'kysely';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import {
  withEnterpriseProjectTransaction,
  digestCanonicalPayload,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  CommandExecutionError,
  CONCURRENCY_CONFLICT,
  executeEnterpriseProjectCommand,
  type CommandEnvelope,
  type CommandExecution,
  type CommandResult,
} from '../persistence/command-runner.js';
import { ENTERPRISE_PAYLOAD_HASH_MISMATCH } from '../persistence/write-guards.js';
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import {
  EnterpriseBusinessError,
  PROJECT_ENTERPRISE_NOT_ACTIVE,
  PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT,
  PROJECT_FACT_CONFLICT_UNRESOLVED,
  PROJECT_FACT_SOURCE_REQUIRED,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT,
  PROJECT_PRODUCT_ACTIVATION_NOOP,
  PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
  PROJECT_PRODUCT_VERSION_IMMUTABLE,
  PROJECT_PRODUCT_VERSION_NOT_FOUND,
  PROJECT_PROFILE_SNAPSHOT_IMMUTABLE,
  PROJECT_PROFILE_SOURCE_MISMATCH,
  PROJECT_QMS_DECISION_SOURCE_REQUIRED,
  PROJECT_QMS_REVISION_IMMUTABLE,
  PROJECT_QMS_ACTIVATION_NOOP,
  PROJECT_QMS_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

const repo = new EnterpriseBusinessRepository();

// =====================================================================
// Shared helpers
// =====================================================================

function ensureHumanPrincipal(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): void {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new EnterpriseBusinessError(
      PROJECT_HUMAN_ONLY_DENIED,
      'Human-only operation invoked by a non-HUMAN principal',
    );
  }
}

function aggregateVersionToString(value: unknown): string {
  return String(value);
}

function outboxDigest(payload: unknown): Buffer {
  return digestCanonicalPayload(payload as Parameters<typeof digestCanonicalPayload>[0]).hash;
}

function asNonEmptyArray<T>(value: readonly T[] | undefined): T[] {
  return value === undefined ? [] : [...value];
}

interface ReferenceLike {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly versionId?: unknown;
  readonly snapshotId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
  readonly evidence?: unknown;
  readonly evidenceLinkRef?: unknown;
  readonly targetClaimRef?: unknown;
  readonly target?: unknown;
  readonly digest?: unknown;
  readonly algorithm?: unknown;
  readonly canonicalizationVersion?: unknown;
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' ? value : {};
}

function asCanonicalJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function asFactRiskLevel(value: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'CRITICAL') {
    return value;
  }
  throw new EnterpriseBusinessError(
    PROJECT_FACT_SOURCE_REQUIRED,
    'riskLevel must be one of LOW, MEDIUM, HIGH or CRITICAL',
  );
}

function scopedEnterpriseId(reference: unknown): string | undefined {
  const scope = asReferenceLike(reference).scope;
  if (scope === null || typeof scope !== 'object') return undefined;
  const enterpriseId = (scope as { enterpriseId?: unknown }).enterpriseId;
  return typeof enterpriseId === 'string' ? enterpriseId : undefined;
}

function hasProjectScope(reference: unknown): boolean {
  const scope = asReferenceLike(reference).scope;
  return (
    scope !== null &&
    typeof scope === 'object' &&
    'projectId' in scope &&
    (scope as { projectId?: unknown }).projectId !== undefined
  );
}

function requiresEnterpriseScope(reference: unknown): boolean {
  const kind = asReferenceLike(reference).kind;
  return (
    kind === 'OBJECT' || kind === 'VERSIONED' || kind === 'CONTENT_ADDRESSED' || kind === 'SNAPSHOT'
  );
}

function assertEnterpriseObjectRef(
  reference: Common.ObjectRef,
  enterpriseId: string,
  label: string,
): void {
  const facts = asReferenceLike(reference);
  if (
    facts.kind !== 'OBJECT' ||
    facts.objectType !== 'Enterprise' ||
    facts.objectId !== enterpriseId ||
    scopedEnterpriseId(reference) !== enterpriseId ||
    hasProjectScope(reference)
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      `${label} must identify the trusted Enterprise scope exactly`,
    );
  }
}

function validateReferenceSet(
  references: readonly unknown[],
  enterpriseId: string,
  label: string,
): void {
  const keys = new Set<string>();
  for (const reference of references) {
    const ref = asReferenceLike(reference);
    const candidates =
      ref.evidence !== undefined
        ? [ref.evidence, ref.evidenceLinkRef, asReferenceLike(ref.targetClaimRef).target]
        : [reference];
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      const candidateRef = asReferenceLike(candidate);
      const objectType = typeof candidateRef.objectType === 'string' ? candidateRef.objectType : '';
      const objectId = typeof candidateRef.objectId === 'string' ? candidateRef.objectId : '';
      const versionId = typeof candidateRef.versionId === 'string' ? candidateRef.versionId : '';
      const snapshotId = typeof candidateRef.snapshotId === 'string' ? candidateRef.snapshotId : '';
      const key = candidateRef.kind
        ? JSON.stringify([candidateRef.kind, objectType, objectId, versionId, snapshotId])
        : JSON.stringify(candidate);
      if (keys.has(key)) {
        throw new EnterpriseBusinessError(
          PROJECT_PROFILE_SOURCE_MISMATCH,
          `${label} must not contain duplicate exact references`,
        );
      }
      keys.add(key);
      const referencedEnterpriseId = scopedEnterpriseId(candidate);
      if (
        (requiresEnterpriseScope(candidate) && referencedEnterpriseId !== enterpriseId) ||
        (referencedEnterpriseId !== undefined && referencedEnterpriseId !== enterpriseId) ||
        hasProjectScope(candidate)
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_PROFILE_SOURCE_MISMATCH,
          `${label} crosses the trusted Enterprise scope`,
        );
      }
    }
  }
}

function assertExactReference(
  reference: unknown,
  objectType: string,
  objectId: string,
  errorCode: string,
  label: string,
): void {
  const ref = asReferenceLike(reference);
  if (ref.objectType !== objectType || ref.objectId !== objectId) {
    throw new EnterpriseBusinessError(errorCode, `${label} does not identify the exact object`);
  }
}

function parseOptionalInstant(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EnterpriseBusinessError(
      PROJECT_PROFILE_SOURCE_MISMATCH,
      `${label} is not a valid UTC instant`,
    );
  }
  return parsed;
}

async function appendReferenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  ownerObjectType: string,
  ownerObjectId: string,
  ownerVersionId: string | undefined,
  ownerPayloadHash: Buffer | undefined,
  references: readonly unknown[],
  purpose: string,
): Promise<void> {
  for (const [index, referenceValue] of references.entries()) {
    const reference = asReferenceLike(referenceValue);
    if (typeof reference.objectId !== 'string' || typeof reference.objectType !== 'string') {
      continue;
    }
    const targetVersionId =
      typeof reference.versionId === 'string'
        ? reference.versionId
        : typeof reference.snapshotId === 'string'
          ? reference.snapshotId
          : undefined;
    const contentHash = asReferenceLike(reference.contentHash);
    const targetPayloadHash =
      typeof contentHash.digest === 'string' && /^[0-9a-f]{64}$/i.test(contentHash.digest)
        ? Buffer.from(contentHash.digest, 'hex')
        : undefined;
    await execution.appendReferenceEdge({
      ownerObjectType,
      ownerObjectId,
      ...(ownerVersionId === undefined ? {} : { ownerVersionId }),
      ...(ownerPayloadHash === undefined ? {} : { ownerPayloadHash }),
      referencePath: `/references/${index}`,
      targetModule: 'EnterpriseProject',
      targetObjectType: reference.objectType,
      targetObjectId: reference.objectId,
      ...(targetVersionId === undefined ? {} : { targetVersionId }),
      ...(targetPayloadHash === undefined ? {} : { targetPayloadHash }),
      referencePurpose: purpose,
    });
  }
}

// =====================================================================
// Public Contract: project.create_enterprise
// =====================================================================

export type CreateEnterprisePayload = EnterpriseProject.ProjectCreateEnterprisePayload;

export async function handleCreateEnterprise(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: CreateEnterprisePayload },
): Promise<CommandResult> {
  if (envelope.payload.displayCode === '' || envelope.payload.displayName === '') {
    throw new EnterpriseBusinessError(
      PROJECT_ENTERPRISE_NOT_ACTIVE,
      'displayCode and displayName must be non-empty',
    );
  }
  // The new Enterprise root uses envelope.enterpriseId (the UUIDv7 the
  // composition layer minted for the target) so the receipt, audit row and
  // outbox payload all share the same scope as the trusted transaction
  // context. Generating a fresh UUID inside the handler would diverge from
  // the context and fail the WI-02 outbox scope-mirror guard.
  const enterpriseId = envelope.enterpriseId;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'Enterprise',
      targetId: enterpriseId,
    },
    async (execution) => {
      // Insert with ON CONFLICT DO NOTHING. The handler treats an empty
      // RETURNING (no row inserted) as a displayCode conflict; the WI-02
      // appendOutbox / finalizeReceipt path then records REJECTED on the
      // original transaction. A naive SELECT pre-check would be defeated
      // by the Enterprise RLS policy because the duplicate row belongs to
      // a different enterprise than the trusted transaction context.
      const inserted = await repo.insertEnterprise(execution.trx, {
        enterpriseId,
        displayCode: envelope.payload.displayCode,
        displayName: envelope.payload.displayName,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        sourceCommandId: envelope.commandId,
      });
      if (!inserted) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT,
          safeSummary: 'another Enterprise already uses this displayCode',
          currentAggregateVersion: undefined,
        };
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          enterpriseRef: {
            objectType: 'Enterprise',
            objectId: enterpriseId,
          },
          displayCode: envelope.payload.displayCode,
          aggregateVersion: '1',
        },
      };
      const outboxPayload = {
        enterpriseId,
        ...result.resultPayload,
      };
      const digest = digestCanonicalPayload(outboxPayload);
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Enterprise.EnterpriseCreated',
        eventVersion: '1.0',
        aggregateType: 'Enterprise',
        aggregateId: enterpriseId,
        aggregateVersion: '1',
        payload: outboxPayload,
        declaredHash: digest.hash,
        occurredAt: new Date(),
      });
      return result;
    },
  );
}

// =====================================================================
// Public Contract: project.propose_enterprise_fact
// =====================================================================

export type ProposeEnterpriseFactPayload = EnterpriseProject.ProjectProposeEnterpriseFactPayload;

export async function handleProposeEnterpriseFact(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ProposeEnterpriseFactPayload },
): Promise<CommandResult> {
  assertEnterpriseObjectRef(envelope.payload.enterpriseRef, envelope.enterpriseId, 'enterpriseRef');
  if (!Array.isArray(envelope.payload.proposal.sourceRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_FACT_SOURCE_REQUIRED,
      'fact proposal must carry at least one sourceRef',
    );
  }
  const enterpriseId = envelope.enterpriseId;
  validateReferenceSet(envelope.payload.proposal.sourceRefs, enterpriseId, 'fact sourceRefs');
  if (envelope.payload.proposal.sourceRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_FACT_SOURCE_REQUIRED,
      'fact proposal must carry at least one sourceRef',
    );
  }
  const enterpriseFactId = newUuidV7();
  const versionId = newUuidV7();
  const digest = digestCanonicalPayload({
    enterpriseId,
    enterpriseFactId,
    factType: envelope.payload.proposal.factType,
    value: asCanonicalJson(envelope.payload.proposal.value),
    sourceRefs: asCanonicalJson(envelope.payload.proposal.sourceRefs),
    riskLevel: envelope.payload.proposal.riskLevel,
    proposalReason: asCanonicalJson(envelope.payload.proposal.proposalReason),
    validPeriod: asCanonicalJson(envelope.payload.proposal.validPeriod ?? null),
    status: 'PROPOSED',
  });
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'EnterpriseFact',
      targetId: enterpriseFactId,
    },
    async (execution) => {
      const enterprise = await repo.getEnterpriseById(execution.trx, enterpriseId);
      if (!enterprise) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_ENTERPRISE_NOT_ACTIVE,
          safeSummary: 'enterprise does not exist',
          currentAggregateVersion: undefined,
        };
      }
      if (enterprise.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_ENTERPRISE_NOT_ACTIVE,
          safeSummary: `enterprise is in status ${enterprise.status}`,
          currentAggregateVersion: aggregateVersionToString(enterprise.aggregate_version),
        };
      }
      await repo.insertEnterpriseFact(execution.trx, {
        enterpriseFactId,
        enterpriseId,
        factType: envelope.payload.proposal.factType,
        riskLevel: asFactRiskLevel(envelope.payload.proposal.riskLevel),
        currentVersionId: versionId,
        currentStatus: 'PROPOSED',
        createdByPrincipalId: envelope.principalId,
        sourceCommandId: envelope.commandId,
      });
      await repo.insertEnterpriseFactVersion(execution.trx, {
        versionId,
        enterpriseFactId,
        enterpriseId,
        versionNo: 1,
        status: 'PROPOSED',
        value: {
          enterpriseId,
          value: asCanonicalJson(envelope.payload.proposal.value),
          proposalReason: asCanonicalJson(envelope.payload.proposal.proposalReason),
          validPeriod: asCanonicalJson(envelope.payload.proposal.validPeriod ?? null),
        },
        sourceRefs: asNonEmptyArray(envelope.payload.proposal.sourceRefs),
        payloadHash: digest.hash,
        proposedByPrincipalId: envelope.principalId,
        proposedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          enterpriseFactRef: {
            objectType: 'EnterpriseFact',
            objectId: enterpriseFactId,
            versionId,
          },
          versionNo: 1,
          status: 'PROPOSED',
          payloadHash: digest.hash.toString('hex'),
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Enterprise.EnterpriseFactProposed',
        eventVersion: '1.0',
        aggregateType: 'EnterpriseFact',
        aggregateId: enterpriseFactId,
        // Initial CREATE (no expectedAggregateVersion) emits the event at
        // aggregate_version=1 and the root is created with the same version.
        aggregateVersion: '1',
        payload: {
          enterpriseId,
          enterpriseFactId,
          versionId,
          versionNo: 1,
          status: 'PROPOSED',
          payloadHash: digest.hash.toString('hex'),
        },
        declaredHash: digestCanonicalPayload({
          enterpriseId,
          enterpriseFactId,
          versionId,
          versionNo: 1,
          status: 'PROPOSED',
          payloadHash: digest.hash.toString('hex'),
        }).hash,
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'EnterpriseFact',
        enterpriseFactId,
        versionId,
        digest.hash,
        envelope.payload.proposal.sourceRefs,
        'ENTERPRISE_FACT_SOURCE',
      );
      return result;
    },
  );
}

// =====================================================================
// Public Contract: project.confirm_enterprise_fact (Human-only)
// =====================================================================

export type ConfirmEnterpriseFactPayload = EnterpriseProject.ProjectConfirmEnterpriseFactPayload;

export async function handleConfirmEnterpriseFact(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ConfirmEnterpriseFactPayload },
): Promise<CommandResult> {
  ensureHumanPrincipal(context, envelope);
  const proposalRef = envelope.payload.proposalVersionRef;
  const proposalRefFacts = asReferenceLike(proposalRef);
  if (
    proposalRefFacts.kind !== 'VERSIONED' ||
    proposalRefFacts.objectType !== 'EnterpriseFact' ||
    hasProjectScope(proposalRef) ||
    scopedEnterpriseId(proposalRef) !== context.enterpriseId
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'proposalVersionRef must be a VERSIONED EnterpriseFact reference in the trusted scope',
    );
  }
  validateReferenceSet(envelope.payload.evidenceRefs, context.enterpriseId, 'fact evidenceRefs');
  const enterpriseFactId = envelope.payload.proposalVersionRef.objectId;
  const previousVersionId = envelope.payload.proposalVersionRef.versionId;
  if (envelope.payload.evidenceRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_FACT_SOURCE_REQUIRED,
      'fact confirmation must carry at least one evidenceRef',
    );
  }
  // Read the current aggregate_version outside the transaction so the
  // envelope's expectedAggregateVersion matches the body CAS. The body still
  // re-reads inside the transaction and surfaces a CONCURRENCY_CONFLICT
  // rejection if the value drifts between this call and the CAS.
  const currentFact = await withEnterpriseProjectTransaction(db, context, async (trx) =>
    repo.getEnterpriseFactById(trx, enterpriseFactId),
  );
  const expectedAggregateVersion = currentFact
    ? aggregateVersionToString(currentFact.aggregate_version)
    : undefined;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'EnterpriseFact',
      targetId: enterpriseFactId,
      ...(expectedAggregateVersion !== undefined ? { expectedAggregateVersion } : {}),
    },
    async (execution) => {
      const fact = await repo.getEnterpriseFactById(execution.trx, enterpriseFactId);
      if (!fact) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_FACT_CONFLICT_UNRESOLVED,
          safeSummary: 'enterprise_fact not found',
          currentAggregateVersion: undefined,
        };
      }
      if ((fact.current_version_id ?? '') !== previousVersionId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_FACT_CONFLICT_UNRESOLVED,
          safeSummary: 'proposal version is not the current version of the fact',
          currentAggregateVersion: aggregateVersionToString(fact.aggregate_version),
        };
      }
      const previousVersion = await repo.getEnterpriseFactVersion(execution.trx, previousVersionId);
      if (
        previousVersion?.enterprise_fact_id !== enterpriseFactId ||
        previousVersion.enterprise_id !== fact.enterprise_id
      ) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_FACT_CONFLICT_UNRESOLVED,
          safeSummary: 'proposalVersionRef does not identify the exact current Fact version',
          currentAggregateVersion: aggregateVersionToString(fact.aggregate_version),
        };
      }
      if (fact.current_status !== 'PROPOSED' && fact.current_status !== 'DISPUTED') {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_FACT_CONFLICT_UNRESOLVED,
          safeSummary: `Fact status ${fact.current_status} cannot be confirmed again`,
          currentAggregateVersion: aggregateVersionToString(fact.aggregate_version),
        };
      }
      const expected = aggregateVersionToString(fact.aggregate_version);
      const newVersionId = newUuidV7();
      const newVersionNo =
        fact.current_version_id === null
          ? 1
          : await nextFactVersionNo(execution.trx, enterpriseFactId);
      const valueWithScope = {
        enterpriseId: fact.enterprise_id,
        value: asCanonicalJson(envelope.payload.confirmedValue),
        effectivePeriod: asCanonicalJson(envelope.payload.effectivePeriod ?? null),
        justification: asCanonicalJson(envelope.payload.justification),
      };
      const digest = digestCanonicalPayload({
        enterpriseId: fact.enterprise_id,
        enterpriseFactId,
        value: asCanonicalJson(envelope.payload.confirmedValue),
        sourceRefs: asCanonicalJson(envelope.payload.evidenceRefs),
        effectivePeriod: asCanonicalJson(envelope.payload.effectivePeriod ?? null),
        justification: asCanonicalJson(envelope.payload.justification),
        status: 'CONFIRMED',
      });
      await repo.insertEnterpriseFactVersion(execution.trx, {
        versionId: newVersionId,
        enterpriseFactId,
        enterpriseId: fact.enterprise_id,
        versionNo: newVersionNo,
        status: 'CONFIRMED',
        value: valueWithScope,
        sourceRefs: asNonEmptyArray(envelope.payload.evidenceRefs),
        payloadHash: digest.hash,
        proposedByPrincipalId: envelope.principalId,
        proposedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
        effectiveFrom: parseOptionalInstant(
          envelope.payload.effectivePeriod?.validFrom,
          'effectivePeriod.validFrom',
        ),
        effectiveTo: parseOptionalInstant(
          envelope.payload.effectivePeriod?.validTo,
          'effectivePeriod.validTo',
        ),
      });
      const cas = await repo.casEnterpriseFact(
        execution.trx,
        enterpriseFactId,
        expected,
        newVersionId,
        'CONFIRMED',
      );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `enterprise_fact CAS conflict on confirmation (current=${cas.current})`,
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          enterpriseFactRef: {
            objectType: 'EnterpriseFact',
            objectId: enterpriseFactId,
            versionId: newVersionId,
          },
          versionNo: newVersionNo,
          status: 'CONFIRMED',
          payloadHash: digest.hash.toString('hex'),
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Enterprise.EnterpriseFactConfirmed',
        eventVersion: '1.0',
        aggregateType: 'EnterpriseFact',
        aggregateId: enterpriseFactId,
        aggregateVersion: cas.nextVersion,
        payload: {
          enterpriseId: fact.enterprise_id,
          enterpriseFactId,
          versionId: newVersionId,
          versionNo: newVersionNo,
          status: 'CONFIRMED',
          payloadHash: digest.hash.toString('hex'),
        },
        declaredHash: digestCanonicalPayload({
          enterpriseId: fact.enterprise_id,
          enterpriseFactId,
          versionId: newVersionId,
          versionNo: newVersionNo,
          status: 'CONFIRMED',
          payloadHash: digest.hash.toString('hex'),
        }).hash,
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'EnterpriseFact',
        enterpriseFactId,
        newVersionId,
        digest.hash,
        envelope.payload.evidenceRefs.map((ref) => ref.evidence),
        'ENTERPRISE_FACT_CONFIRMATION_EVIDENCE',
      );
      return result;
    },
  );
}

async function nextFactVersionNo(
  trx: EnterpriseProjectTransaction,
  enterpriseFactId: string,
): Promise<number> {
  const versions = await repo.getEnterpriseFactVersions(trx, enterpriseFactId);
  return versions.length === 0 ? 1 : (versions[versions.length - 1]?.version_no ?? 0) + 1;
}

// =====================================================================
// Public Contract: project.get_enterprise_profile_snapshot (Query)
// =====================================================================

export type GetEnterpriseProfileSnapshotPayload =
  EnterpriseProject.ProjectGetEnterpriseProfileSnapshotPayload;

export type GetEnterpriseProfileSnapshotResult =
  EnterpriseProject.ProjectGetEnterpriseProfileSnapshotResult;

export async function handleGetEnterpriseProfileSnapshot(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: GetEnterpriseProfileSnapshotPayload,
): Promise<GetEnterpriseProfileSnapshotResult> {
  // Read-only path: no receipt / no audit / no outbox. Exact
  // SnapshotRef resolution; "latest"/"current" are not allowed at this
  // layer (Module-Spec-002 §4).
  const inputRef = payload.enterpriseProfileSnapshotRef;
  const inputRefFacts = asReferenceLike(inputRef);
  if (
    inputRefFacts.kind !== 'SNAPSHOT' ||
    inputRefFacts.objectType !== 'EnterpriseProfileSnapshot'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_PROFILE_SOURCE_MISMATCH,
      'enterpriseProfileSnapshotRef must be a SNAPSHOT reference',
    );
  }
  const snapshotId = inputRef.snapshotId;
  if (snapshotId === 'latest' || snapshotId === 'current') {
    throw new EnterpriseBusinessError(
      PROJECT_PROFILE_SOURCE_MISMATCH,
      'latest/current pointers are not accepted for EnterpriseProfileSnapshot queries',
    );
  }
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const row = await repo.getEnterpriseProfileSnapshot(trx, snapshotId);
    if (!row) {
      throw new EnterpriseBusinessError(
        PROJECT_PROFILE_SNAPSHOT_IMMUTABLE,
        'enterprise_profile_snapshot not found',
      );
    }
    if (row.enterprise_id !== context.enterpriseId) {
      throw new EnterpriseBusinessError(
        PROJECT_PROFILE_SOURCE_MISMATCH,
        'snapshot does not belong to the transaction context enterprise',
      );
    }
    if (
      inputRef.objectId !== row.snapshot_id ||
      scopedEnterpriseId(inputRef) !== row.enterprise_id ||
      hasProjectScope(inputRef)
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_PROFILE_SOURCE_MISMATCH,
        'snapshot reference identity or scope does not match the stored snapshot',
      );
    }
    const inputHash = asReferenceLike(inputRef.contentHash);
    if (
      inputHash.algorithm !== 'SHA-256' ||
      inputHash.canonicalizationVersion !== '1' ||
      inputHash.digest !== row.payload_hash.toString('hex')
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_PROFILE_SOURCE_MISMATCH,
        'snapshot contentHash does not match the stored immutable payload',
      );
    }
    const payloadText = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
    const parsed = JSON.parse(payloadText) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as { enterpriseId?: unknown }).enterpriseId !== row.enterprise_id
    ) {
      throw new EnterpriseBusinessError(
        ENTERPRISE_PAYLOAD_HASH_MISMATCH,
        'snapshot payload enterpriseId mirror does not match promoted column',
      );
    }
    return {
      snapshotRef: {
        kind: 'SNAPSHOT' as const,
        objectType: 'EnterpriseProfileSnapshot',
        objectId: row.snapshot_id,
        snapshotId: row.snapshot_id,
        scope: { enterpriseId: row.enterprise_id },
        contentHash: {
          algorithm: 'SHA-256' as const,
          digest: row.payload_hash.toString('hex'),
          canonicalizationVersion: '1' as const,
        },
      },
      payload: parsed as EnterpriseProject.EnterpriseProfileSnapshotResult['payload'],
    } satisfies GetEnterpriseProfileSnapshotResult;
  });
}

// =====================================================================
// Controlled Capability: enterprise_product.create
// =====================================================================

export interface EnterpriseProductCreatePayload {
  enterpriseRef: { objectType: 'Enterprise'; objectId: string };
  displayCode: string;
  initialVersion: {
    productType: string;
    displayName: string;
    intendedUse: string;
    productScope: CanonicalJsonObject;
    sourceRefs: readonly { objectType: string; objectId: string; versionId?: string }[];
  };
}

export async function handleEnterpriseProductCreate(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseProductCreatePayload },
): Promise<CommandResult> {
  if (envelope.payload.initialVersion.sourceRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PRODUCT_VERSION_NOT_FOUND,
      'product initial version must carry at least one sourceRef',
    );
  }
  const productId = newUuidV7();
  const versionId = newUuidV7();
  assertExactReference(
    envelope.payload.enterpriseRef,
    'Enterprise',
    envelope.enterpriseId,
    'COMMAND_TARGET_MISMATCH',
    'enterpriseRef',
  );
  const enterpriseId = envelope.enterpriseId;
  validateReferenceSet(
    envelope.payload.initialVersion.sourceRefs,
    enterpriseId,
    'Product sourceRefs',
  );
  const versionDigest = digestCanonicalPayload({
    enterpriseId,
    productId,
    productType: envelope.payload.initialVersion.productType,
    displayName: envelope.payload.initialVersion.displayName,
    intendedUse: envelope.payload.initialVersion.intendedUse,
    productScope: envelope.payload.initialVersion.productScope,
    sourceRefs: envelope.payload.initialVersion.sourceRefs,
  });
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'Product',
      targetId: productId,
    },
    async (execution) => {
      const enterprise = await repo.getEnterpriseById(execution.trx, enterpriseId);
      if (enterprise?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_ENTERPRISE_NOT_ACTIVE,
          safeSummary: 'enterprise not found or not active',
          currentAggregateVersion:
            enterprise?.aggregate_version !== undefined
              ? aggregateVersionToString(enterprise.aggregate_version)
              : undefined,
        };
      }
      const inserted = await repo.insertProduct(execution.trx, {
        productId,
        enterpriseId,
        displayCode: envelope.payload.displayCode,
        displayName: envelope.payload.initialVersion.displayName,
        // The first version is intentionally historical until an explicit
        // Human activation moves the exact pointer to it.
        initialVersionId: null,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        sourceCommandId: envelope.commandId,
      });
      if (!inserted) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT,
          safeSummary: 'product displayCode already exists in this enterprise',
          currentAggregateVersion: undefined,
        };
      }
      await repo.insertProductVersion(execution.trx, {
        versionId,
        productId,
        enterpriseId,
        versionNo: 1,
        productType: envelope.payload.initialVersion.productType,
        displayName: envelope.payload.initialVersion.displayName,
        intendedUse: envelope.payload.initialVersion.intendedUse,
        productScope: envelope.payload.initialVersion.productScope,
        sourceRefs: asNonEmptyArray(envelope.payload.initialVersion.sourceRefs),
        payloadHash: versionDigest.hash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      // The first version row is HISTORICAL until the separate
      // activate_version capability flips it CURRENT. The product root
      // is created at aggregate_version=1 and stays there until the
      // first activate (which is the only handler that CASes the root).
      const productRow = await repo.getProductById(execution.trx, productId);
      if (!productRow || aggregateVersionToString(productRow.aggregate_version) !== '1') {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'product root aggregate_version drifted from expected initial 1',
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          productRef: { objectType: 'Product', objectId: productId },
          productVersionRef: {
            objectType: 'ProductVersion',
            objectId: productId,
            versionId,
          },
          versionNo: 1,
          payloadHash: versionDigest.hash.toString('hex'),
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Product.ProductCreated',
        eventVersion: '1.0',
        aggregateType: 'Product',
        aggregateId: productId,
        // Initial CREATE (no expectedAggregateVersion) emits the event at
        // aggregate_version=1 per the WI-02 outbox-mirror guard.
        aggregateVersion: '1',
        payload: { enterpriseId, productId, versionId },
        declaredHash: outboxDigest({ enterpriseId, productId, versionId }),
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'Product',
        productId,
        undefined,
        versionDigest.hash,
        envelope.payload.initialVersion.sourceRefs,
        'PRODUCT_VERSION_SOURCE',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_product.create_version
// =====================================================================

export interface EnterpriseProductCreateVersionPayload {
  productRef: { objectType: 'Product'; objectId: string };
  previousVersionRef: { objectType: 'ProductVersion'; objectId: string; versionId: string };
  productType: string;
  displayName: string;
  intendedUse: string;
  productScope: CanonicalJsonObject;
  sourceRefs: readonly { objectType: string; objectId: string; versionId?: string }[];
}

export async function handleEnterpriseProductCreateVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseProductCreateVersionPayload },
): Promise<CommandResult> {
  const productId = envelope.payload.productRef.objectId;
  const previousVersionId = envelope.payload.previousVersionRef.versionId;
  assertExactReference(
    envelope.payload.previousVersionRef,
    'ProductVersion',
    productId,
    PROJECT_PRODUCT_VERSION_NOT_FOUND,
    'previousVersionRef',
  );
  if (envelope.payload.sourceRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PRODUCT_VERSION_NOT_FOUND,
      'product version must carry at least one sourceRef',
    );
  }
  validateReferenceSet(envelope.payload.sourceRefs, envelope.enterpriseId, 'Product sourceRefs');
  const currentProduct = await withEnterpriseProjectTransaction(db, context, (trx) =>
    repo.getProductById(trx, productId),
  );
  const expectedAggregateVersion = currentProduct
    ? aggregateVersionToString(currentProduct.aggregate_version)
    : undefined;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'Product',
      targetId: productId,
      ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
    },
    async (execution) => {
      const product = await repo.getProductById(execution.trx, productId);
      if (!product) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_VERSION_NOT_FOUND,
          safeSummary: 'product not found',
          currentAggregateVersion: undefined,
        };
      }
      if (product.current_version_id !== previousVersionId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_VERSION_NOT_FOUND,
          safeSummary: 'previousVersionRef is not the current ProductVersion',
          currentAggregateVersion: aggregateVersionToString(product.aggregate_version),
        };
      }
      const previousVersion = await repo.getProductVersion(execution.trx, previousVersionId);
      if (previousVersion?.product_id !== productId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_VERSION_IMMUTABLE,
          safeSummary: 'previous ProductVersion not found',
          currentAggregateVersion: aggregateVersionToString(product.aggregate_version),
        };
      }
      const versions = await repo.getProductVersions(execution.trx, productId);
      const nextVersionNo =
        (versions[versions.length - 1]?.version_no ?? previousVersion.version_no) + 1;
      const versionId = newUuidV7();
      const versionDigest = digestCanonicalPayload({
        enterpriseId: product.enterprise_id,
        productId,
        productType: envelope.payload.productType,
        displayName: envelope.payload.displayName,
        intendedUse: envelope.payload.intendedUse,
        productScope: envelope.payload.productScope,
        sourceRefs: envelope.payload.sourceRefs,
        previousVersionId,
      });
      await repo.insertProductVersion(execution.trx, {
        versionId,
        productId,
        enterpriseId: product.enterprise_id,
        versionNo: nextVersionNo,
        productType: envelope.payload.productType,
        displayName: envelope.payload.displayName,
        intendedUse: envelope.payload.intendedUse,
        productScope: envelope.payload.productScope,
        sourceRefs: asNonEmptyArray(envelope.payload.sourceRefs),
        payloadHash: versionDigest.hash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
        previousVersionId,
      });
      // Adding a ProductVersion is an Aggregate mutation. Advance the root
      // even though the new version remains HISTORICAL until activation.
      const cas = await repo.casProduct(
        execution.trx,
        productId,
        aggregateVersionToString(product.aggregate_version),
      );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `product CAS conflict on version creation (current=${cas.current})`,
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          productVersionRef: {
            objectType: 'ProductVersion',
            objectId: productId,
            versionId,
          },
          versionNo: nextVersionNo,
          previousVersionId,
          aggregateVersion: cas.nextVersion,
          payloadHash: versionDigest.hash.toString('hex'),
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Product.ProductVersionCreated',
        eventVersion: '1.0',
        aggregateType: 'Product',
        aggregateId: productId,
        aggregateVersion: cas.nextVersion,
        payload: {
          enterpriseId: product.enterprise_id,
          productId,
          versionId,
          versionNo: nextVersionNo,
          previousVersionId,
          payloadHash: versionDigest.hash.toString('hex'),
        },
        declaredHash: outboxDigest({
          enterpriseId: product.enterprise_id,
          productId,
          versionId,
          versionNo: nextVersionNo,
          previousVersionId,
          payloadHash: versionDigest.hash.toString('hex'),
        }),
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'Product',
        productId,
        versionId,
        versionDigest.hash,
        envelope.payload.sourceRefs,
        'PRODUCT_VERSION_SOURCE',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_product.activate_version (Human-only)
// =====================================================================

export interface EnterpriseProductActivateVersionPayload {
  productRef: { objectType: 'Product'; objectId: string };
  productVersionRef: { objectType: 'ProductVersion'; objectId: string; versionId: string };
  activationMode: 'ACTIVATE' | 'ROLLBACK';
  expectedAggregateVersion: string;
  humanDecisionRef: { objectType: 'BusinessDecision'; objectId: string };
}

export async function handleEnterpriseProductActivateVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseProductActivateVersionPayload },
): Promise<CommandResult> {
  ensureHumanPrincipal(context, envelope);
  const productId = envelope.payload.productRef.objectId;
  const targetVersionId = envelope.payload.productVersionRef.versionId;
  assertExactReference(
    envelope.payload.productVersionRef,
    'ProductVersion',
    productId,
    PROJECT_PRODUCT_VERSION_NOT_FOUND,
    'productVersionRef',
  );
  if (asReferenceLike(envelope.payload.humanDecisionRef).objectType !== 'BusinessDecision') {
    throw new EnterpriseBusinessError(
      PROJECT_PRODUCT_VERSION_NOT_FOUND,
      'humanDecisionRef must identify a BusinessDecision',
    );
  }
  const expectedVersion = envelope.payload.expectedAggregateVersion;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'Product',
      targetId: productId,
      expectedAggregateVersion: expectedVersion,
    },
    async (execution) => {
      const product = await repo.getProductById(execution.trx, productId);
      if (!product) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_VERSION_NOT_FOUND,
          safeSummary: 'product not found',
          currentAggregateVersion: undefined,
        };
      }
      const targetVersion = await repo.getProductVersion(execution.trx, targetVersionId);
      if (targetVersion?.product_id !== productId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_VERSION_NOT_FOUND,
          safeSummary: 'target ProductVersion does not belong to the product',
          currentAggregateVersion: aggregateVersionToString(product.aggregate_version),
        };
      }
      if (aggregateVersionToString(product.aggregate_version) !== expectedVersion) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `product expectedVersion ${expectedVersion} but root is ${aggregateVersionToString(product.aggregate_version)}`,
        );
      }
      if (product.current_version_id === targetVersionId) {
        // Idempotent re-activation of the same version: emit a NOOP
        // rejection so the caller observes the duplicate guard (Issue #59
        // #5: duplicate activation must be rejected with a stable code).
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_ACTIVATION_NOOP,
          safeSummary: 'product current pointer already points to the requested version',
          currentAggregateVersion: aggregateVersionToString(product.aggregate_version),
        };
      }
      const previousCurrent = product.current_version_id;
      await repo.markProductVersionCurrent(execution.trx, productId, targetVersionId);
      const cas = await repo.casProduct(execution.trx, productId, expectedVersion, targetVersionId);
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `product CAS conflict on activation (current=${cas.current})`,
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          productRef: { objectType: 'Product', objectId: productId },
          currentVersionRef: {
            objectType: 'ProductVersion',
            objectId: productId,
            versionId: targetVersionId,
          },
          activationMode: envelope.payload.activationMode,
          previousVersionId: previousCurrent,
          aggregateVersion: cas.nextVersion,
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Product.ProductVersionActivated',
        eventVersion: '1.0',
        aggregateType: 'Product',
        aggregateId: productId,
        aggregateVersion: cas.nextVersion,
        payload: {
          enterpriseId: product.enterprise_id,
          productId,
          currentVersionId: targetVersionId,
          previousVersionId: previousCurrent,
          activationMode: envelope.payload.activationMode,
          humanDecisionRef: envelope.payload.humanDecisionRef,
        },
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'Product',
        productId,
        undefined,
        undefined,
        [envelope.payload.humanDecisionRef],
        'PRODUCT_ACTIVATION_HUMAN_DECISION',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_product.create_scope_snapshot
// =====================================================================

export interface EnterpriseProductCreateScopeSnapshotPayload {
  productRef: { objectType: 'Product'; objectId: string };
  productVersionRefs: readonly {
    objectType: 'ProductVersion';
    objectId: string;
    versionId: string;
  }[];
  purpose: string;
}

export async function handleEnterpriseProductCreateScopeSnapshot(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseProductCreateScopeSnapshotPayload },
): Promise<CommandResult> {
  if (envelope.payload.productVersionRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
      'productScope snapshot requires at least one ProductVersion',
    );
  }
  const productId = envelope.payload.productRef.objectId;
  const snapshotId = newUuidV7();
  for (const reference of envelope.payload.productVersionRefs) {
    assertExactReference(
      reference,
      'ProductVersion',
      productId,
      PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
      'productVersionRef',
    );
  }
  return executeEnterpriseProjectCommand(
    db,
    context,
    { ...envelope, targetType: 'ProductScopeSnapshot', targetId: snapshotId },
    async (execution) => {
      const product = await repo.getProductById(execution.trx, productId);
      if (!product) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
          safeSummary: 'product not found',
          currentAggregateVersion: undefined,
        };
      }
      const versions: {
        versionId: string;
        productScope: unknown;
        payloadHash: string;
        lifecycle: string;
      }[] = [];
      for (const ref of envelope.payload.productVersionRefs) {
        const v = await repo.getProductVersion(execution.trx, ref.versionId);
        if (v?.product_id !== productId || v.enterprise_id !== product.enterprise_id) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
            safeSummary: 'productVersionRef does not match the product enterprise',
            currentAggregateVersion: aggregateVersionToString(product.aggregate_version),
          };
        }
        versions.push({
          versionId: v.version_id,
          productScope: v.product_scope,
          payloadHash: v.payload_hash.toString('hex'),
          lifecycle: v.lifecycle,
        });
      }
      const payload = {
        enterpriseId: product.enterprise_id,
        productId,
        snapshotId,
        productVersionRefs: envelope.payload.productVersionRefs,
        productScopes: versions,
        purpose: envelope.payload.purpose,
        frozenAt: new Date().toISOString(),
      };
      const digest = digestCanonicalPayload(
        payload as unknown as Parameters<typeof digestCanonicalPayload>[0],
      );
      await repo.insertProductScopeSnapshot(execution.trx, {
        snapshotId,
        productId,
        enterpriseId: product.enterprise_id,
        payload,
        payloadHash: digest.hash,
        derivedFrom: envelope.payload.productVersionRefs,
        frozenByPrincipalId: envelope.principalId,
        frozenByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        purpose: envelope.payload.purpose,
        sourceCommandId: envelope.commandId,
      });
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          productScopeSnapshotRef: {
            objectType: 'ProductScopeSnapshot',
            objectId: snapshotId,
          },
          payloadHash: digest.hash.toString('hex'),
          derivedFromVersionIds: payload.productVersionRefs,
        } as unknown as CanonicalJsonObject,
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Product.ProductScopeSnapshotCreated',
        eventVersion: '1.0',
        aggregateType: 'ProductScopeSnapshot',
        aggregateId: snapshotId,
        aggregateVersion: '1',
        payload: {
          enterpriseId: product.enterprise_id,
          productId,
          snapshotId,
          payloadHash: digest.hash.toString('hex'),
        },
        declaredHash: outboxDigest({
          enterpriseId: product.enterprise_id,
          productId,
          snapshotId,
          payloadHash: digest.hash.toString('hex'),
        }),
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'ProductScopeSnapshot',
        snapshotId,
        undefined,
        digest.hash,
        envelope.payload.productVersionRefs,
        'PRODUCT_SCOPE_VERSION_SOURCE',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_qms.create_revision
// =====================================================================

export interface EnterpriseQmsCreateRevisionPayload {
  qmsConfigurationRef: { objectType: 'QMSConfiguration'; objectId: string };
  previousRevisionRef?: {
    objectType: 'QMSConfigurationRevision';
    objectId: string;
    versionId: string;
  };
  applicabilityDecisions: readonly CanonicalJsonObject[];
  managementChoices: readonly CanonicalJsonObject[];
  professionalDecisions: readonly CanonicalJsonObject[];
  sourceRefs: readonly { objectType: string; objectId: string; versionId?: string }[];
}

export async function handleEnterpriseQmsCreateRevision(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseQmsCreateRevisionPayload },
): Promise<CommandResult> {
  if (envelope.payload.sourceRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_QMS_DECISION_SOURCE_REQUIRED,
      'QMS revision must carry at least one sourceRef',
    );
  }
  if (
    envelope.payload.applicabilityDecisions.length === 0 ||
    envelope.payload.managementChoices.length === 0 ||
    envelope.payload.professionalDecisions.length === 0
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_QMS_DECISION_SOURCE_REQUIRED,
      'QMS revision must include all three non-empty decision groups',
    );
  }
  validateReferenceSet(envelope.payload.sourceRefs, envelope.enterpriseId, 'QMS sourceRefs');
  const qmsId = envelope.payload.qmsConfigurationRef.objectId;
  assertExactReference(
    envelope.payload.qmsConfigurationRef,
    'QMSConfiguration',
    qmsId,
    PROJECT_QMS_VERSION_NOT_FOUND,
    'qmsConfigurationRef',
  );
  const existingQms = await withEnterpriseProjectTransaction(db, context, (trx) =>
    repo.getQmsConfigurationById(trx, qmsId),
  );
  const expectedAggregateVersion = existingQms
    ? aggregateVersionToString(existingQms.aggregate_version)
    : undefined;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'QMSConfiguration',
      targetId: qmsId,
      ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
    },
    async (execution) => {
      const enterprise = await repo.getEnterpriseById(execution.trx, envelope.enterpriseId);
      if (enterprise?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_ENTERPRISE_NOT_ACTIVE,
          safeSummary: 'enterprise not found or not active',
          currentAggregateVersion:
            enterprise?.aggregate_version === undefined
              ? undefined
              : aggregateVersionToString(enterprise.aggregate_version),
        };
      }
      let qms = await repo.getQmsConfigurationById(execution.trx, qmsId);
      const rootWasCreated = qms === undefined;
      if (!qms) {
        // First revision brings the qms_configuration root into existence.
        if (envelope.payload.previousRevisionRef !== undefined) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_QMS_REVISION_IMMUTABLE,
            safeSummary: 'previousRevisionRef provided but qms_configuration does not exist',
            currentAggregateVersion: undefined,
          };
        }
        await repo.insertQmsConfiguration(execution.trx, {
          qmsConfigurationId: qmsId,
          enterpriseId: envelope.enterpriseId,
          displayCode: `QMS-${qmsId}`,
          displayName: `QMS configuration ${qmsId}`,
          initialRevisionId: null,
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          sourceCommandId: envelope.commandId,
        });
        qms = await repo.getQmsConfigurationById(execution.trx, qmsId);
        if (!qms) {
          throw new EnterpriseBusinessError(
            PROJECT_QMS_VERSION_NOT_FOUND,
            'qms_configuration root insert did not persist',
          );
        }
      }
      if (qms.enterprise_id !== envelope.enterpriseId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
          safeSummary: 'qms configuration does not belong to the trusted enterprise',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      if (!rootWasCreated && envelope.payload.previousRevisionRef === undefined) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_QMS_REVISION_IMMUTABLE,
          safeSummary: 'an existing QMSConfiguration requires the exact previousRevisionRef',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      const revisions = await repo.getQmsConfigurationRevisions(execution.trx, qmsId);
      const nextRevisionNo =
        revisions.length === 0 ? 1 : (revisions[revisions.length - 1]?.revision_no ?? 0) + 1;
      const revisionId = newUuidV7();
      if (envelope.payload.previousRevisionRef !== undefined) {
        if (
          envelope.payload.previousRevisionRef.versionId !== qms.current_revision_id ||
          envelope.payload.previousRevisionRef.objectId !== qmsId
        ) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_QMS_REVISION_IMMUTABLE,
            safeSummary: 'previousRevisionRef is not the current QMS Revision',
            currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
          };
        }
      }
      const digest = digestCanonicalPayload({
        enterpriseId: qms.enterprise_id,
        qmsConfigurationId: qmsId,
        applicabilityDecisions: envelope.payload.applicabilityDecisions,
        managementChoices: envelope.payload.managementChoices,
        professionalDecisions: envelope.payload.professionalDecisions,
        sourceRefs: envelope.payload.sourceRefs,
        revisionNo: nextRevisionNo,
      });
      await repo.insertQmsConfigurationRevision(execution.trx, {
        revisionId,
        qmsConfigurationId: qmsId,
        enterpriseId: qms.enterprise_id,
        revisionNo: nextRevisionNo,
        applicabilityDecisions: asNonEmptyArray(envelope.payload.applicabilityDecisions),
        managementChoices: asNonEmptyArray(envelope.payload.managementChoices),
        professionalDecisions: asNonEmptyArray(envelope.payload.professionalDecisions),
        sourceRefs: asNonEmptyArray(envelope.payload.sourceRefs),
        payloadHash: digest.hash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
        previousRevisionId: envelope.payload.previousRevisionRef?.versionId,
      });
      const cas = rootWasCreated
        ? { ok: true as const, nextVersion: '1' }
        : await repo.casQmsConfiguration(
            execution.trx,
            qmsId,
            aggregateVersionToString(qms.aggregate_version),
          );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `qms CAS conflict on revision creation (current=${cas.current})`,
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          qmsConfigurationRevisionRef: {
            objectType: 'QMSConfigurationRevision',
            objectId: qmsId,
            versionId: revisionId,
          },
          revisionNo: nextRevisionNo,
          aggregateVersion: cas.nextVersion,
          payloadHash: digest.hash.toString('hex'),
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'QMS.QMSRevisionCreated',
        eventVersion: '1.0',
        aggregateType: 'QMSConfiguration',
        aggregateId: qmsId,
        aggregateVersion: cas.nextVersion,
        payload: {
          enterpriseId: qms.enterprise_id,
          qmsConfigurationId: qmsId,
          revisionId,
          revisionNo: nextRevisionNo,
          payloadHash: digest.hash.toString('hex'),
        },
        declaredHash: outboxDigest({
          enterpriseId: qms.enterprise_id,
          qmsConfigurationId: qmsId,
          revisionId,
          revisionNo: nextRevisionNo,
          payloadHash: digest.hash.toString('hex'),
        }),
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'QMSConfiguration',
        qmsId,
        revisionId,
        digest.hash,
        envelope.payload.sourceRefs,
        'QMS_REVISION_SOURCE',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_qms.activate_revision (Human-only)
// =====================================================================

export interface EnterpriseQmsActivateRevisionPayload {
  qmsConfigurationRef: { objectType: 'QMSConfiguration'; objectId: string };
  qmsConfigurationRevisionRef: {
    objectType: 'QMSConfigurationRevision';
    objectId: string;
    versionId: string;
  };
  activationMode: 'ACTIVATE' | 'ROLLBACK';
  expectedAggregateVersion: string;
  humanDecisionRef: { objectType: 'BusinessDecision'; objectId: string };
}

export async function handleEnterpriseQmsActivateRevision(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseQmsActivateRevisionPayload },
): Promise<CommandResult> {
  ensureHumanPrincipal(context, envelope);
  const qmsId = envelope.payload.qmsConfigurationRef.objectId;
  const targetRevisionId = envelope.payload.qmsConfigurationRevisionRef.versionId;
  assertExactReference(
    envelope.payload.qmsConfigurationRevisionRef,
    'QMSConfigurationRevision',
    qmsId,
    PROJECT_QMS_VERSION_NOT_FOUND,
    'qmsConfigurationRevisionRef',
  );
  if (asReferenceLike(envelope.payload.humanDecisionRef).objectType !== 'BusinessDecision') {
    throw new EnterpriseBusinessError(
      PROJECT_QMS_VERSION_NOT_FOUND,
      'humanDecisionRef must identify a BusinessDecision',
    );
  }
  const expectedVersion = envelope.payload.expectedAggregateVersion;
  return executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope,
      targetType: 'QMSConfiguration',
      targetId: qmsId,
      expectedAggregateVersion: expectedVersion,
    },
    async (execution) => {
      const qms = await repo.getQmsConfigurationById(execution.trx, qmsId);
      if (!qms) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_QMS_VERSION_NOT_FOUND,
          safeSummary: 'qms_configuration not found',
          currentAggregateVersion: undefined,
        };
      }
      const target = await repo.getQmsConfigurationRevision(execution.trx, targetRevisionId);
      if (target?.qms_configuration_id !== qmsId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_QMS_VERSION_NOT_FOUND,
          safeSummary: 'target QMSRevision does not belong to the QMSConfiguration',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      if (aggregateVersionToString(qms.aggregate_version) !== expectedVersion) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `qms expectedVersion ${expectedVersion} but root is ${aggregateVersionToString(qms.aggregate_version)}`,
        );
      }
      if (qms.current_revision_id === targetRevisionId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_QMS_ACTIVATION_NOOP,
          safeSummary: 'qms current pointer already points to the requested revision',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      const previousRevisionId = qms.current_revision_id;
      await repo.markQmsConfigurationRevisionCurrent(execution.trx, qmsId, targetRevisionId);
      const cas = await repo.casQmsConfiguration(
        execution.trx,
        qmsId,
        expectedVersion,
        targetRevisionId,
      );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `qms CAS conflict on activation (current=${cas.current})`,
        );
      }
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          qmsConfigurationRef: { objectType: 'QMSConfiguration', objectId: qmsId },
          currentRevisionRef: {
            objectType: 'QMSConfigurationRevision',
            objectId: qmsId,
            versionId: targetRevisionId,
          },
          activationMode: envelope.payload.activationMode,
          previousRevisionId,
          aggregateVersion: cas.nextVersion,
        },
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'QMS.QMSRevisionActivated',
        eventVersion: '1.0',
        aggregateType: 'QMSConfiguration',
        aggregateId: qmsId,
        aggregateVersion: cas.nextVersion,
        payload: {
          enterpriseId: qms.enterprise_id,
          qmsConfigurationId: qmsId,
          currentRevisionId: targetRevisionId,
          previousRevisionId,
          activationMode: envelope.payload.activationMode,
          humanDecisionRef: envelope.payload.humanDecisionRef,
        },
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'QMSConfiguration',
        qmsId,
        undefined,
        undefined,
        [envelope.payload.humanDecisionRef],
        'QMS_ACTIVATION_HUMAN_DECISION',
      );
      return result;
    },
  );
}

// =====================================================================
// Controlled Capability: enterprise_profile.create_snapshot
// =====================================================================

export interface EnterpriseProfileCreateSnapshotPayload {
  enterpriseRef: { objectType: 'Enterprise'; objectId: string };
  enterpriseFactVersionRefs: readonly {
    objectType: 'EnterpriseFact';
    objectId: string;
    versionId: string;
  }[];
  productVersionRefs: readonly {
    objectType: 'ProductVersion';
    objectId: string;
    versionId: string;
  }[];
  qmsConfigurationRef: { objectType: 'QMSConfiguration'; objectId: string };
  qmsConfigurationRevisionRef: {
    objectType: 'QMSConfigurationRevision';
    objectId: string;
    versionId: string;
  };
  purpose: string;
}

export async function handleEnterpriseProfileCreateSnapshot(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: EnterpriseProfileCreateSnapshotPayload },
): Promise<CommandResult> {
  assertExactReference(
    envelope.payload.enterpriseRef,
    'Enterprise',
    envelope.enterpriseId,
    'COMMAND_TARGET_MISMATCH',
    'enterpriseRef',
  );
  const enterpriseId = envelope.enterpriseId;
  const snapshotId = newUuidV7();
  for (const ref of envelope.payload.enterpriseFactVersionRefs) {
    assertExactReference(
      ref,
      'EnterpriseFact',
      ref.objectId,
      PROJECT_PROFILE_SOURCE_MISMATCH,
      'enterpriseFactVersionRef',
    );
  }
  for (const ref of envelope.payload.productVersionRefs) {
    assertExactReference(
      ref,
      'ProductVersion',
      ref.objectId,
      PROJECT_PROFILE_SOURCE_MISMATCH,
      'productVersionRef',
    );
  }
  assertExactReference(
    envelope.payload.qmsConfigurationRef,
    'QMSConfiguration',
    envelope.payload.qmsConfigurationRef.objectId,
    PROJECT_PROFILE_SOURCE_MISMATCH,
    'qmsConfigurationRef',
  );
  assertExactReference(
    envelope.payload.qmsConfigurationRevisionRef,
    'QMSConfigurationRevision',
    envelope.payload.qmsConfigurationRef.objectId,
    PROJECT_PROFILE_SOURCE_MISMATCH,
    'qmsConfigurationRevisionRef',
  );
  return executeEnterpriseProjectCommand(
    db,
    context,
    { ...envelope, targetType: 'EnterpriseProfileSnapshot', targetId: snapshotId },
    async (execution) => {
      const enterprise = await repo.getEnterpriseById(execution.trx, enterpriseId);
      if (enterprise?.status !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
          safeSummary: 'enterprise not found or not active',
          currentAggregateVersion: undefined,
        };
      }
      const facts: {
        factVersionRef: (typeof envelope.payload.enterpriseFactVersionRefs)[number];
        factType: string;
        status: string;
        value: unknown;
        sourceRefs: unknown;
        payloadHash: string;
      }[] = [];
      for (const ref of envelope.payload.enterpriseFactVersionRefs) {
        const v = await repo.getEnterpriseFactVersion(execution.trx, ref.versionId);
        if (v?.enterprise_id !== enterpriseId || v.enterprise_fact_id !== ref.objectId) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
            safeSummary: 'enterpriseFactVersionRef does not belong to the enterprise',
            currentAggregateVersion: aggregateVersionToString(enterprise.aggregate_version),
          };
        }
        const fact = await repo.getEnterpriseFactById(execution.trx, v.enterprise_fact_id);
        if (fact?.enterprise_id !== enterpriseId) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
            safeSummary: 'enterprise fact does not belong to the enterprise',
            currentAggregateVersion: aggregateVersionToString(enterprise.aggregate_version),
          };
        }
        facts.push({
          factVersionRef: ref,
          factType: fact.fact_type,
          status: v.status,
          value: v.value,
          sourceRefs: v.source_refs,
          payloadHash: v.payload_hash.toString('hex'),
        });
      }
      const products: {
        productVersionRef: (typeof envelope.payload.productVersionRefs)[number];
        productType: string;
        displayName: string;
        intendedUse: string;
        productScope: unknown;
        payloadHash: string;
        lifecycle: string;
      }[] = [];
      for (const ref of envelope.payload.productVersionRefs) {
        const v = await repo.getProductVersion(execution.trx, ref.versionId);
        if (v?.enterprise_id !== enterpriseId || v.product_id !== ref.objectId) {
          return {
            kind: 'REJECTED',
            errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
            safeSummary: 'productVersionRef does not belong to the enterprise',
            currentAggregateVersion: aggregateVersionToString(enterprise.aggregate_version),
          };
        }
        products.push({
          productVersionRef: ref,
          productType: v.product_type,
          displayName: v.display_name,
          intendedUse: v.intended_use,
          productScope: v.product_scope,
          payloadHash: v.payload_hash.toString('hex'),
          lifecycle: v.lifecycle,
        });
      }
      const qms = await repo.getQmsConfigurationById(
        execution.trx,
        envelope.payload.qmsConfigurationRef.objectId,
      );
      if (qms?.enterprise_id !== enterpriseId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
          safeSummary: 'qms configuration does not belong to the enterprise',
          currentAggregateVersion: aggregateVersionToString(enterprise.aggregate_version),
        };
      }
      if (qms.current_revision_id !== envelope.payload.qmsConfigurationRevisionRef.versionId) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
          safeSummary: 'qms revision is not the current pointer',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      const qmsRevision = await repo.getQmsConfigurationRevision(
        execution.trx,
        envelope.payload.qmsConfigurationRevisionRef.versionId,
      );
      if (
        qmsRevision?.qms_configuration_id !== qms.qms_configuration_id ||
        qmsRevision.enterprise_id !== enterpriseId ||
        qmsRevision.lifecycle !== 'CURRENT'
      ) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PROFILE_SOURCE_MISMATCH,
          safeSummary: 'qms revision reference is not the exact active revision',
          currentAggregateVersion: aggregateVersionToString(qms.aggregate_version),
        };
      }
      const payload = {
        enterpriseId,
        snapshotId,
        purpose: envelope.payload.purpose,
        frozenAt: new Date().toISOString(),
        facts,
        products,
        qmsConfigurationRef: envelope.payload.qmsConfigurationRef,
        qmsConfigurationRevision: {
          revisionRef: envelope.payload.qmsConfigurationRevisionRef,
          applicabilityDecisions: qmsRevision.applicability_decisions,
          managementChoices: qmsRevision.management_choices,
          professionalDecisions: qmsRevision.professional_decisions,
          sourceRefs: qmsRevision.source_refs,
          payloadHash: qmsRevision.payload_hash.toString('hex'),
          lifecycle: qmsRevision.lifecycle,
        },
      };
      const digest = digestCanonicalPayload(
        payload as unknown as Parameters<typeof digestCanonicalPayload>[0],
      );
      await repo.insertEnterpriseProfileSnapshot(execution.trx, {
        snapshotId,
        enterpriseId,
        payload,
        payloadHash: digest.hash,
        derivedFrom: {
          factVersionRefs: envelope.payload.enterpriseFactVersionRefs,
          productVersionRefs: envelope.payload.productVersionRefs,
          qmsConfigurationRevisionRef: envelope.payload.qmsConfigurationRevisionRef,
        },
        frozenByPrincipalId: envelope.principalId,
        frozenByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        purpose: envelope.payload.purpose,
        sourceCommandId: envelope.commandId,
      });
      const result = {
        kind: 'COMMITTED' as const,
        resultPayload: {
          enterpriseProfileSnapshotRef: {
            objectType: 'EnterpriseProfileSnapshot',
            objectId: snapshotId,
          },
          payloadHash: digest.hash.toString('hex'),
          derivedFrom: payload as unknown as CanonicalJsonObject,
        } as unknown as CanonicalJsonObject,
      };
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Enterprise.EnterpriseProfileSnapshotCreated',
        eventVersion: '1.0',
        aggregateType: 'EnterpriseProfileSnapshot',
        aggregateId: snapshotId,
        aggregateVersion: '1',
        payload: {
          enterpriseId,
          snapshotId,
          payloadHash: digest.hash.toString('hex'),
        },
        declaredHash: outboxDigest({
          enterpriseId,
          snapshotId,
          payloadHash: digest.hash.toString('hex'),
        }),
        occurredAt: new Date(),
      });
      await appendReferenceEdges(
        execution,
        'EnterpriseProfileSnapshot',
        snapshotId,
        undefined,
        digest.hash,
        [
          ...envelope.payload.enterpriseFactVersionRefs,
          ...envelope.payload.productVersionRefs,
          envelope.payload.qmsConfigurationRef,
          envelope.payload.qmsConfigurationRevisionRef,
        ],
        'ENTERPRISE_PROFILE_SOURCE',
      );
      return result;
    },
  );
}
