// IM-03 WI-06 (issue #62): CustomerMaterial proposal and confirmation.
// This handler keeps customer business classification separate from the
// immutable SourceMaterial custody root. It validates exact Project-scoped
// source references, appends versions and decisions, and never places
// customer document content into the public confirmation event.

import type { Kysely } from 'kysely';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import {
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
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
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import type {
  CustomerMaterialVersionTable,
  SourceMaterialTable,
} from '../persistence/enterprise-business-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_MATERIAL_CONFLICT_UNRESOLVED,
  PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
  PROJECT_MATERIAL_SOURCE_INVALID,
  PROJECT_MATERIAL_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

const repo = new EnterpriseBusinessRepository();

type ProposeCustomerMaterialPayload = EnterpriseProject.ProjectProposeCustomerMaterialPayload;
type ConfirmCustomerMaterialPayload = EnterpriseProject.ProjectConfirmCustomerMaterialPayload;

type MaterialCompleteness = EnterpriseProject.MaterialCompleteness;

interface ReferenceLike {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly versionId?: unknown;
  readonly immutableVersionId?: unknown;
  readonly snapshotId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
  readonly algorithm?: unknown;
  readonly canonicalizationVersion?: unknown;
  readonly digest?: unknown;
  readonly locator?: unknown;
  readonly role?: unknown;
  readonly extractionSnapshotRef?: unknown;
  readonly evidence?: unknown;
  readonly evidenceLinkRef?: unknown;
  readonly relation?: unknown;
  readonly targetClaimRef?: unknown;
  readonly target?: unknown;
  readonly applicabilityScopeRef?: unknown;
  readonly claimLocator?: unknown;
  readonly claimHash?: unknown;
  readonly reasonCode?: unknown;
  readonly summary?: unknown;
  readonly evidenceRefs?: unknown;
  readonly policyRef?: unknown;
  readonly materialType?: unknown;
  readonly title?: unknown;
  readonly customerDocumentNumber?: unknown;
  readonly customerVersionLabel?: unknown;
  readonly effectiveDate?: unknown;
  readonly completeness?: unknown;
  readonly sourceSelections?: unknown;
  readonly language?: unknown;
  readonly classificationRationale?: unknown;
  readonly sourceMaterialRef?: unknown;
  readonly candidateVersionRef?: unknown;
  readonly declaredStatus?: unknown;
  readonly justification?: unknown;
  readonly actingFor?: unknown;
}

interface ScopeLike {
  readonly enterpriseId?: unknown;
  readonly projectId?: unknown;
}

interface ContentReferenceFacts {
  readonly reference: CanonicalJsonObject;
  readonly objectType: string;
  readonly objectId: string;
  readonly payloadHash: Buffer;
}

interface SourceSelectionFacts extends ContentReferenceFacts {
  readonly locator?: string;
  readonly extractionSnapshot?: ContentReferenceFacts;
}

interface ValidatedClassification {
  readonly materialType: string;
  readonly title: string;
  readonly customerDocumentNumber: string | undefined;
  readonly customerVersionLabel: string | undefined;
  readonly effectiveDate: Date | undefined;
  readonly effectiveDateValue: string | null;
  readonly completeness: MaterialCompleteness;
  readonly sourceSelections: readonly CanonicalJsonObject[];
  readonly sourceSelectionFacts: readonly SourceSelectionFacts[];
  readonly language: string;
  readonly classificationRationale: CanonicalJsonObject;
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' ? value : {};
}

function asScopeLike(value: unknown): ScopeLike | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function aggregateVersionToString(value: unknown): string {
  return String(value);
}

function asCanonicalJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function asCanonicalObject(
  value: unknown,
  code = PROJECT_MATERIAL_SOURCE_INVALID,
): CanonicalJsonObject {
  const candidate = asCanonicalJson(value);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new EnterpriseBusinessError(code, 'CustomerMaterial reference payload must be an object');
  }
  return candidate as CanonicalJsonObject;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be non-empty`,
    );
  }
  return value;
}

function parseLocalDate(value: unknown, label: string): { date: Date; value: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be a valid local date`,
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be a valid local date`,
    );
  }
  return { date, value };
}

function parseContentHash(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be a SHA-256 content hash with canonicalization version 1`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function contentHashValue(hash: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function projectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  };
}

function customerMaterialRef(
  enterpriseId: string,
  projectId: string,
  customerMaterialId: string,
  versionId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'CustomerMaterial',
    objectId: customerMaterialId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function businessDecisionRef(
  enterpriseId: string,
  projectId: string,
  decisionId: string,
  payloadHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'BusinessDecision',
    objectId: decisionId,
    scope: { enterpriseId, projectId },
    contentHash: contentHashValue(payloadHash),
  };
}

function assertProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): string {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const projectId = reference.objectId;
  if (
    reference.kind !== 'OBJECT' ||
    reference.objectType !== 'Project' ||
    typeof projectId !== 'string' ||
    !isUuidV7(projectId) ||
    scope?.enterpriseId !== context.enterpriseId ||
    scope.projectId !== projectId ||
    envelope.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'projectRef must identify an allowed Project scope exactly',
    );
  }
  return projectId;
}

function assertCandidateRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): { customerMaterialId: string; versionId: string; projectId: string } {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const projectId = scope?.projectId;
  if (
    reference.kind !== 'VERSIONED' ||
    reference.objectType !== 'CustomerMaterial' ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    typeof reference.versionId !== 'string' ||
    !isUuidV7(reference.versionId) ||
    scope?.enterpriseId !== context.enterpriseId ||
    typeof projectId !== 'string' ||
    !isUuidV7(projectId) ||
    (envelope.projectId !== undefined && projectId !== envelope.projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'candidateVersionRef must identify an exact Project-scoped CustomerMaterial version',
    );
  }
  return {
    customerMaterialId: reference.objectId,
    versionId: reference.versionId,
    projectId,
  };
}

function validateScopeReference(
  value: unknown,
  enterpriseId: string,
  projectId: string | undefined,
  label: string,
): void {
  const candidate = asReferenceLike(value);
  const scope = candidate.scope === undefined ? asScopeLike(value) : asScopeLike(candidate.scope);
  if (scope?.enterpriseId !== enterpriseId) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} crosses the trusted Enterprise scope`,
    );
  }
  if (projectId !== undefined && scope.projectId !== undefined && scope.projectId !== projectId) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} crosses the trusted Project scope`,
    );
  }
}

function validateContentReference(
  value: unknown,
  enterpriseId: string,
  projectId: string | undefined,
  label: string,
): ContentReferenceFacts {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'CONTENT_ADDRESSED' ||
    typeof reference.objectType !== 'string' ||
    reference.objectType.length === 0 ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    scope?.enterpriseId !== enterpriseId ||
    (projectId !== undefined && scope.projectId !== projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be an exact ContentAddressedRef in the trusted scope`,
    );
  }
  return {
    reference: asCanonicalObject(value),
    objectType: reference.objectType,
    objectId: reference.objectId,
    payloadHash: parseContentHash(reference.contentHash, `${label}.contentHash`),
  };
}

function validateObjectReference(
  value: unknown,
  enterpriseId: string,
  projectId: string | undefined,
  label: string,
): void {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'OBJECT' ||
    typeof reference.objectType !== 'string' ||
    reference.objectType.length === 0 ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    scope?.enterpriseId !== enterpriseId ||
    (projectId !== undefined && scope.projectId !== undefined && scope.projectId !== projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must remain in the trusted scope`,
    );
  }
}

function validateSnapshotReference(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): ContentReferenceFacts {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'SNAPSHOT' ||
    typeof reference.objectType !== 'string' ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    typeof reference.snapshotId !== 'string' ||
    !isUuidV7(reference.snapshotId) ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be an exact Project-scoped SnapshotRef`,
    );
  }
  return {
    reference: asCanonicalObject(value),
    objectType: reference.objectType,
    objectId: reference.objectId,
    payloadHash: parseContentHash(reference.contentHash, `${label}.contentHash`),
  };
}

function validateSourceSelection(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): SourceSelectionFacts {
  const selection = asReferenceLike(value);
  const sourceMaterial = asReferenceLike(selection.sourceMaterialRef);
  const scope = asScopeLike(sourceMaterial.scope);
  if (
    sourceMaterial.kind !== 'CONTENT_ADDRESSED' ||
    sourceMaterial.objectType !== 'SourceMaterial' ||
    typeof sourceMaterial.objectId !== 'string' ||
    !isUuidV7(sourceMaterial.objectId) ||
    sourceMaterial.immutableVersionId !== undefined ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label}.sourceMaterialRef must identify the exact Project-scoped SourceMaterial`,
    );
  }
  nonEmptyString(selection.role, `${label}.role`);
  const locator =
    selection.locator === undefined
      ? undefined
      : nonEmptyString(selection.locator, `${label}.locator`);
  const extractionSnapshot =
    selection.extractionSnapshotRef === undefined
      ? undefined
      : validateSnapshotReference(
          selection.extractionSnapshotRef,
          enterpriseId,
          projectId,
          `${label}.extractionSnapshotRef`,
        );
  const contentReference = validateContentReference(
    sourceMaterial,
    enterpriseId,
    projectId,
    `${label}.sourceMaterialRef`,
  );
  return {
    ...contentReference,
    ...(locator === undefined ? {} : { locator }),
    ...(extractionSnapshot === undefined ? {} : { extractionSnapshot }),
  };
}

function validateEvidenceReference(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): void {
  const evidence = asReferenceLike(value);
  validateContentReference(evidence.evidence, enterpriseId, projectId, `${label}.evidence`);
  if (evidence.evidenceLinkRef !== undefined) {
    validateObjectReference(
      evidence.evidenceLinkRef,
      enterpriseId,
      projectId,
      `${label}.evidenceLinkRef`,
    );
  }
  if (
    evidence.relation !== 'SUPPORTS' &&
    evidence.relation !== 'CONTRADICTS' &&
    evidence.relation !== 'CONTEXT_ONLY'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label}.relation is not a supported EvidenceRef relation`,
    );
  }
  if (evidence.targetClaimRef !== undefined) {
    const claim = asReferenceLike(evidence.targetClaimRef);
    validateContentReference(
      claim.target,
      enterpriseId,
      projectId,
      `${label}.targetClaimRef.target`,
    );
    nonEmptyString(claim.claimLocator, `${label}.targetClaimRef.claimLocator`);
    parseContentHash(claim.claimHash, `${label}.targetClaimRef.claimHash`);
  }
  if (evidence.applicabilityScopeRef !== undefined) {
    validateScopeReference(
      evidence.applicabilityScopeRef,
      enterpriseId,
      projectId,
      `${label}.applicabilityScopeRef`,
    );
  }
}

function validateEvidenceRefs(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonValue[] {
  if (!Array.isArray(value)) {
    throw new EnterpriseBusinessError(PROJECT_MATERIAL_SOURCE_INVALID, `${label} must be an array`);
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    validateEvidenceReference(candidate, enterpriseId, projectId, `${label}[${index}]`);
    const canonical = asCanonicalObject(candidate);
    const key = digestCanonicalPayload(canonical).hash.toString('hex');
    if (seen.has(key)) {
      throw new EnterpriseBusinessError(
        PROJECT_MATERIAL_SOURCE_INVALID,
        `${label} must not contain duplicate exact references`,
      );
    }
    seen.add(key);
    return canonical;
  });
}

function validateJustification(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const justification = asReferenceLike(value);
  if (
    typeof justification.reasonCode !== 'string' ||
    !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(justification.reasonCode)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label}.reasonCode must be a registered reason code`,
    );
  }
  nonEmptyString(justification.summary, `${label}.summary`);
  const evidenceRefs = validateEvidenceRefs(
    justification.evidenceRefs,
    enterpriseId,
    projectId,
    `${label}.evidenceRefs`,
  );
  if (justification.policyRef !== undefined) {
    const policy = asReferenceLike(justification.policyRef);
    if (
      policy.kind !== 'VERSIONED' ||
      typeof policy.objectType !== 'string' ||
      typeof policy.objectId !== 'string' ||
      !isUuidV7(policy.objectId) ||
      typeof policy.versionId !== 'string' ||
      !isUuidV7(policy.versionId)
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_MATERIAL_SOURCE_INVALID,
        `${label}.policyRef must be an exact VersionedRef`,
      );
    }
    validateScopeReference(policy, enterpriseId, projectId, `${label}.policyRef`);
  }
  return {
    reasonCode: justification.reasonCode,
    summary: justification.summary,
    evidenceRefs,
    ...(justification.policyRef === undefined
      ? {}
      : { policyRef: asCanonicalJson(justification.policyRef) }),
  } as unknown as CanonicalJsonObject;
}

function validateCompleteness(value: unknown): MaterialCompleteness {
  if (
    value !== 'COMPLETE' &&
    value !== 'PARTIAL' &&
    value !== 'UNKNOWN' &&
    value !== 'UNREADABLE'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'completeness is not a supported MaterialCompleteness value',
    );
  }
  return value;
}

function validateClassification(
  proposal: EnterpriseProject.CustomerMaterialProposal,
  enterpriseId: string,
  projectId: string,
): ValidatedClassification {
  const materialType = nonEmptyString(proposal.materialType, 'proposal.materialType');
  const title = nonEmptyString(proposal.title, 'proposal.title');
  const customerDocumentNumber =
    proposal.customerDocumentNumber === undefined
      ? undefined
      : nonEmptyString(proposal.customerDocumentNumber, 'proposal.customerDocumentNumber');
  const customerVersionLabel =
    proposal.customerVersionLabel === undefined
      ? undefined
      : nonEmptyString(proposal.customerVersionLabel, 'proposal.customerVersionLabel');
  const effectiveDate = parseLocalDate(proposal.effectiveDate, 'proposal.effectiveDate');
  const completeness = validateCompleteness(proposal.completeness);
  if (!Array.isArray(proposal.sourceSelections) || proposal.sourceSelections.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'proposal.sourceSelections must contain at least one exact SourceMaterial selection',
    );
  }
  const sourceSelections: CanonicalJsonObject[] = [];
  const sourceSelectionFacts: SourceSelectionFacts[] = [];
  const seenSelections = new Set<string>();
  proposal.sourceSelections.forEach((selection, index) => {
    const facts = validateSourceSelection(
      selection,
      enterpriseId,
      projectId,
      `proposal.sourceSelections[${index}]`,
    );
    const canonical = asCanonicalObject(selection);
    const key = digestCanonicalPayload(canonical).hash.toString('hex');
    if (seenSelections.has(key)) {
      throw new EnterpriseBusinessError(
        PROJECT_MATERIAL_SOURCE_INVALID,
        'proposal.sourceSelections must not contain duplicate exact selections',
      );
    }
    seenSelections.add(key);
    sourceSelections.push(canonical);
    sourceSelectionFacts.push(facts);
  });
  if (
    typeof proposal.language !== 'string' ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(proposal.language)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'proposal.language must be a valid language tag',
    );
  }
  const classificationRationale = validateJustification(
    proposal.classificationRationale,
    enterpriseId,
    projectId,
    'proposal.classificationRationale',
  );
  return {
    materialType,
    title,
    customerDocumentNumber,
    customerVersionLabel,
    effectiveDate: effectiveDate?.date,
    effectiveDateValue: effectiveDate?.value ?? null,
    completeness,
    sourceSelections,
    sourceSelectionFacts,
    language: proposal.language,
    classificationRationale,
  };
}

function jsonValue(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function sourceSelectionsFromVersion(
  version: CustomerMaterialVersionTable,
): readonly CanonicalJsonObject[] {
  const value = jsonValue(version.source_selections);
  if (!Array.isArray(value)) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
      'stored CustomerMaterial source selections are invalid',
    );
  }
  return value.map((selection) =>
    asCanonicalObject(selection, PROJECT_MATERIAL_CONFIRMATION_CONFLICT),
  );
}

function rationaleFromVersion(version: CustomerMaterialVersionTable): CanonicalJsonObject {
  return asCanonicalObject(
    jsonValue(version.classification_rationale),
    PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
  );
}

function classificationFingerprint(
  version: Pick<
    CustomerMaterialVersionTable,
    | 'material_type'
    | 'title'
    | 'customer_document_number'
    | 'customer_version_label'
    | 'effective_date'
    | 'completeness'
    | 'language'
  >,
  sourceSelections: readonly CanonicalJsonObject[],
): string {
  const effectiveDate = version.effective_date;
  const effectiveDateValue =
    effectiveDate === null
      ? null
      : typeof effectiveDate === 'string'
        ? effectiveDate
        : effectiveDate.toISOString().slice(0, 10);
  return digestCanonicalPayload({
    materialType: version.material_type,
    title: version.title,
    customerDocumentNumber: version.customer_document_number,
    customerVersionLabel: version.customer_version_label,
    effectiveDate: effectiveDateValue,
    completeness: version.completeness,
    language: version.language,
    sourceSelections,
  }).hash.toString('hex');
}

function sourceIds(sourceSelections: readonly CanonicalJsonObject[]): Set<string> {
  return new Set(
    sourceSelections
      .map((selection) => asReferenceLike(selection).sourceMaterialRef)
      .map((value) => asReferenceLike(value).objectId)
      .filter((value): value is string => typeof value === 'string'),
  );
}

function sourceScopeMatches(
  source: SourceMaterialTable,
  enterpriseId: string,
  projectId: string,
): boolean {
  return source.enterprise_id === enterpriseId && source.project_id === projectId;
}

async function validateAcceptedSources(
  execution: Pick<CommandExecution, 'trx'>,
  sourceSelectionFacts: readonly SourceSelectionFacts[],
  enterpriseId: string,
  projectId: string,
): Promise<
  { valid: true; sources: readonly SourceMaterialTable[] } | { valid: false; reason: string }
> {
  const sources: SourceMaterialTable[] = [];
  for (const facts of sourceSelectionFacts) {
    const source = await repo.getSourceMaterialById(execution.trx, facts.objectId);
    if (source === undefined || !sourceScopeMatches(source, enterpriseId, projectId)) {
      return { valid: false, reason: 'SourceMaterial is outside the trusted Project scope' };
    }
    if (source.custody_status !== 'ACCEPTED' || source.accepted_object_ref === null) {
      return { valid: false, reason: 'SourceMaterial is not ACCEPTED' };
    }
    if (!source.content_hash.equals(facts.payloadHash)) {
      return {
        valid: false,
        reason: 'SourceMaterial content hash does not match the exact reference',
      };
    }
    sources.push(source);
  }
  return { valid: true, sources };
}

function appendSourceSelectionEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  customerMaterialId: string,
  versionId: string,
  versionPayloadHash: Buffer,
  sourceSelectionFacts: readonly SourceSelectionFacts[],
): Promise<void> {
  return (async () => {
    for (const [index, facts] of sourceSelectionFacts.entries()) {
      await execution.appendReferenceEdge({
        ownerObjectType: 'CustomerMaterial',
        ownerObjectId: customerMaterialId,
        ownerVersionId: versionId,
        ownerPayloadHash: versionPayloadHash,
        referencePath: `/sourceSelections/${index}/sourceMaterialRef`,
        targetModule: 'EnterpriseProject',
        targetObjectType: 'SourceMaterial',
        targetObjectId: facts.objectId,
        targetPayloadHash: facts.payloadHash,
        referencePurpose: 'CUSTOMER_MATERIAL_SOURCE',
      });
      if (facts.extractionSnapshot !== undefined) {
        await execution.appendReferenceEdge({
          ownerObjectType: 'CustomerMaterial',
          ownerObjectId: customerMaterialId,
          ownerVersionId: versionId,
          ownerPayloadHash: versionPayloadHash,
          referencePath: `/sourceSelections/${index}/extractionSnapshotRef`,
          targetModule: 'EnterpriseProject',
          targetObjectType: facts.extractionSnapshot.objectType,
          targetObjectId: facts.extractionSnapshot.objectId,
          targetPayloadHash: facts.extractionSnapshot.payloadHash,
          referencePurpose: 'CUSTOMER_MATERIAL_EXTRACTION_SNAPSHOT',
        });
      }
    }
  })();
}

async function appendEvidenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  customerMaterialId: string,
  versionId: string,
  versionPayloadHash: Buffer,
  evidenceRefs: readonly CanonicalJsonValue[],
  enterpriseId: string,
  projectId: string,
  purpose: string,
): Promise<void> {
  for (const [index, value] of evidenceRefs.entries()) {
    const evidence = asReferenceLike(value);
    const evidenceFacts = validateContentReference(
      evidence.evidence,
      enterpriseId,
      projectId,
      `stored evidenceRefs[${index}].evidence`,
    );
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: customerMaterialId,
      ownerVersionId: versionId,
      ownerPayloadHash: versionPayloadHash,
      referencePath: `/evidenceRefs/${index}/evidence`,
      targetModule: 'EnterpriseProject',
      targetObjectType: evidenceFacts.objectType,
      targetObjectId: evidenceFacts.objectId,
      targetPayloadHash: evidenceFacts.payloadHash,
      referencePurpose: purpose,
    });
  }
}

function evidenceRefsFromJustification(justification: CanonicalJsonObject): CanonicalJsonValue[] {
  const evidenceRefs = (justification as { evidenceRefs?: unknown }).evidenceRefs;
  return Array.isArray(evidenceRefs) ? (evidenceRefs as CanonicalJsonValue[]) : [];
}

function safeReject(reason: string): string {
  return `CustomerMaterial command rejected: ${reason}`;
}

function assertHumanOnly(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  payload: unknown,
): void {
  const envelopeLike = envelope as CommandEnvelope & { actingFor?: unknown };
  const payloadLike = asReferenceLike(payload);
  if (
    context.principalKind !== 'HUMAN' ||
    envelope.principalKind !== 'HUMAN' ||
    envelopeLike.actingFor !== undefined ||
    payloadLike.actingFor !== undefined
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_HUMAN_ONLY_DENIED,
      'CustomerMaterial confirmation is Human-only and does not accept actingFor',
    );
  }
}

async function appendClassificationDecisionEvidenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  customerMaterialId: string,
  versionId: string,
  payloadHash: Buffer,
  rationale: CanonicalJsonObject,
  enterpriseId: string,
  projectId: string,
): Promise<void> {
  const evidenceRefs = evidenceRefsFromJustification(rationale);
  if (evidenceRefs.length === 0) return;
  for (const [index, value] of evidenceRefs.entries()) {
    const evidence = asReferenceLike(value);
    const facts = validateContentReference(
      evidence.evidence,
      enterpriseId,
      projectId,
      `classificationRationale.evidenceRefs[${index}].evidence`,
    );
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: customerMaterialId,
      ownerVersionId: versionId,
      ownerPayloadHash: payloadHash,
      referencePath: `/classificationRationale/evidenceRefs/${index}/evidence`,
      targetModule: 'EnterpriseProject',
      targetObjectType: facts.objectType,
      targetObjectId: facts.objectId,
      targetPayloadHash: facts.payloadHash,
      referencePurpose: 'CUSTOMER_MATERIAL_CLASSIFICATION_EVIDENCE',
    });
  }
}

// =====================================================================
// Public Contract: project.propose_customer_material
// =====================================================================

export type ProposeCustomerMaterialCommandPayload = ProposeCustomerMaterialPayload;

export async function handleProposeCustomerMaterial(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ProposeCustomerMaterialPayload },
): Promise<CommandResult> {
  const projectId = assertProjectRef(envelope.payload.projectRef, context, envelope);
  const classification = validateClassification(
    envelope.payload.proposal,
    context.enterpriseId,
    projectId,
  );
  const customerMaterialId = newUuidV7();
  const versionId = newUuidV7();
  const decisionId = newUuidV7();
  const versionPayload = {
    enterpriseId: context.enterpriseId,
    projectId,
    customerMaterialId,
    versionId,
    versionNo: 1,
    versionStatus: 'PROPOSED',
    materialType: classification.materialType,
    title: classification.title,
    customerDocumentNumber: classification.customerDocumentNumber ?? null,
    customerVersionLabel: classification.customerVersionLabel ?? null,
    effectiveDate: classification.effectiveDateValue,
    declaredStatus: 'PROPOSED',
    completeness: classification.completeness,
    sourceSelections: classification.sourceSelections,
    language: classification.language,
    classificationRationale: classification.classificationRationale,
  };
  const versionDigest = digestCanonicalPayload(versionPayload);
  const decisionPayload = {
    enterpriseId: context.enterpriseId,
    projectId,
    customerMaterialId,
    versionId,
    decisionKind: 'PROPOSED',
    classificationRationale: classification.classificationRationale,
  };
  const decisionDigest = digestCanonicalPayload(decisionPayload);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'CustomerMaterial',
    targetId: customerMaterialId,
  };

  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_SOURCE_INVALID,
        safeSummary: safeReject('Project scope is not active'),
      };
    }
    const sourceValidation = await validateAcceptedSources(
      execution,
      classification.sourceSelectionFacts,
      context.enterpriseId,
      projectId,
    );
    if (!sourceValidation.valid) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_SOURCE_INVALID,
        safeSummary: safeReject(sourceValidation.reason),
      };
    }
    await repo.insertCustomerMaterial(execution.trx, {
      customerMaterialId,
      enterpriseId: context.enterpriseId,
      projectId,
      materialType: classification.materialType,
      title: classification.title,
      ...(classification.customerDocumentNumber === undefined
        ? {}
        : { customerDocumentNumber: classification.customerDocumentNumber }),
      ...(classification.customerVersionLabel === undefined
        ? {}
        : { customerVersionLabel: classification.customerVersionLabel }),
      ...(classification.effectiveDate === undefined
        ? {}
        : { effectiveDate: classification.effectiveDate }),
      declaredStatus: 'PROPOSED',
      completeness: classification.completeness,
      currentVersionId: versionId,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      sourceCommandId: envelope.commandId,
    });
    await repo.insertCustomerMaterialVersion(execution.trx, {
      versionId,
      customerMaterialId,
      enterpriseId: context.enterpriseId,
      projectId,
      versionNo: 1,
      versionStatus: 'PROPOSED',
      materialType: classification.materialType,
      title: classification.title,
      ...(classification.customerDocumentNumber === undefined
        ? {}
        : { customerDocumentNumber: classification.customerDocumentNumber }),
      ...(classification.customerVersionLabel === undefined
        ? {}
        : { customerVersionLabel: classification.customerVersionLabel }),
      ...(classification.effectiveDate === undefined
        ? {}
        : { effectiveDate: classification.effectiveDate }),
      declaredStatus: 'PROPOSED',
      completeness: classification.completeness,
      sourceSelections: classification.sourceSelections,
      language: classification.language,
      classificationRationale: classification.classificationRationale,
      payloadHash: versionDigest.hash,
      proposedByPrincipalId: envelope.principalId,
      proposedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await repo.insertCustomerMaterialDecision(execution.trx, {
      decisionId,
      customerMaterialId,
      versionId,
      enterpriseId: context.enterpriseId,
      projectId,
      decisionKind: 'PROPOSED',
      evidenceRefs: evidenceRefsFromJustification(classification.classificationRationale),
      justification: classification.classificationRationale,
      payload: decisionPayload,
      payloadHash: decisionDigest.hash,
      decidedByPrincipalId: envelope.principalId,
      decidedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: customerMaterialId,
      ownerVersionId: versionId,
      ownerPayloadHash: versionDigest.hash,
      referencePath: '/projectRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: 'Project',
      targetObjectId: projectId,
      referencePurpose: 'CUSTOMER_MATERIAL_PROJECT_SCOPE',
    });
    await appendSourceSelectionEdges(
      execution,
      customerMaterialId,
      versionId,
      versionDigest.hash,
      classification.sourceSelectionFacts,
    );
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: customerMaterialId,
      ownerVersionId: versionId,
      ownerPayloadHash: versionDigest.hash,
      referencePath: '/proposalDecisionRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: 'BusinessDecision',
      targetObjectId: decisionId,
      targetPayloadHash: decisionDigest.hash,
      referencePurpose: 'CUSTOMER_MATERIAL_PROPOSAL_DECISION',
    });
    await appendClassificationDecisionEvidenceEdges(
      execution,
      customerMaterialId,
      versionId,
      versionDigest.hash,
      classification.classificationRationale,
      context.enterpriseId,
      projectId,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        customerMaterialRef: customerMaterialRef(
          context.enterpriseId,
          projectId,
          customerMaterialId,
          versionId,
        ),
        projectRef: projectRef(context.enterpriseId, projectId),
        proposalDecisionRef: businessDecisionRef(
          context.enterpriseId,
          projectId,
          decisionId,
          decisionDigest.hash,
        ),
        status: 'PROPOSED',
        aggregateVersion: '1',
        versionNo: 1,
        payloadHash: versionDigest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

// =====================================================================
// Public Contract: project.confirm_customer_material (Human-only)
// =====================================================================

export type ConfirmCustomerMaterialCommandPayload = ConfirmCustomerMaterialPayload;

export async function handleConfirmCustomerMaterial(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ConfirmCustomerMaterialPayload },
): Promise<CommandResult> {
  assertHumanOnly(context, envelope, envelope.payload);
  const candidate = assertCandidateRef(envelope.payload.candidateVersionRef, context, envelope);
  const completeness = validateCompleteness(envelope.payload.completeness);
  const declaredStatus = nonEmptyString(envelope.payload.declaredStatus, 'declaredStatus');
  const evidenceRefs = validateEvidenceRefs(
    envelope.payload.evidenceRefs,
    context.enterpriseId,
    candidate.projectId,
    'evidenceRefs',
  );
  const justification = validateJustification(
    envelope.payload.justification,
    context.enterpriseId,
    candidate.projectId,
    'justification',
  );
  return confirmCustomerMaterialAfterRead(
    db,
    context,
    envelope,
    candidate,
    completeness,
    declaredStatus,
    evidenceRefs,
    justification,
  );
}

async function confirmCustomerMaterialAfterRead(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ConfirmCustomerMaterialPayload },
  candidate: { customerMaterialId: string; versionId: string; projectId: string },
  completeness: MaterialCompleteness,
  declaredStatus: string,
  evidenceRefs: readonly CanonicalJsonValue[],
  justification: CanonicalJsonObject,
): Promise<CommandResult> {
  const current = await withEnterpriseProjectTransaction(db, context, (trx) =>
    repo.getCustomerMaterialById(trx, candidate.customerMaterialId),
  );
  const expectedAggregateVersion =
    current === undefined ? undefined : aggregateVersionToString(current.aggregate_version);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId: candidate.projectId,
    targetType: 'CustomerMaterial',
    targetId: candidate.customerMaterialId,
    ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getCustomerMaterialById(execution.trx, candidate.customerMaterialId);
    if (root === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_VERSION_NOT_FOUND,
        safeSummary: safeReject('CustomerMaterial candidate root was not found'),
      };
    }
    if (
      root.enterprise_id !== context.enterpriseId ||
      root.project_id !== candidate.projectId ||
      !context.allowedProjectIds.includes(root.project_id)
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
        safeSummary: safeReject('CustomerMaterial candidate is outside the trusted Project scope'),
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (
      root.current_version_id !== candidate.versionId ||
      (root.classification_status !== 'PROPOSED' && root.classification_status !== 'UNDER_REVIEW')
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
        safeSummary: safeReject('candidate version is no longer the current proposal'),
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const candidateVersion = await repo.getCustomerMaterialVersion(
      execution.trx,
      candidate.versionId,
    );
    if (
      candidateVersion?.customer_material_id !== candidate.customerMaterialId ||
      candidateVersion.enterprise_id !== context.enterpriseId ||
      candidateVersion.project_id !== candidate.projectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_VERSION_NOT_FOUND,
        safeSummary: safeReject('candidate version does not identify the exact stored version'),
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (candidateVersion.version_status !== 'PROPOSED') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
        safeSummary: safeReject('candidate version is already confirmed or no longer proposable'),
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const sourceSelections = sourceSelectionsFromVersion(candidateVersion);
    const sourceSelectionFacts = sourceSelections.map((selection, index) =>
      validateSourceSelection(
        selection,
        context.enterpriseId,
        candidate.projectId,
        `stored sourceSelections[${index}]`,
      ),
    );
    const sourceValidation = await validateAcceptedSources(
      execution,
      sourceSelectionFacts,
      context.enterpriseId,
      candidate.projectId,
    );
    if (!sourceValidation.valid) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MATERIAL_SOURCE_INVALID,
        safeSummary: safeReject(sourceValidation.reason),
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const candidateFingerprint = classificationFingerprint(candidateVersion, sourceSelections);
    const otherRoots = await repo.getCustomerMaterialsByProject(
      execution.trx,
      context.enterpriseId,
      candidate.projectId,
    );
    const candidateSourceIds = sourceIds(sourceSelections);
    for (const otherRoot of otherRoots) {
      if (
        otherRoot.customer_material_id === candidate.customerMaterialId ||
        otherRoot.classification_status !== 'PROPOSED'
      ) {
        continue;
      }
      const otherVersion = await repo.getCustomerMaterialVersion(
        execution.trx,
        otherRoot.current_version_id,
      );
      if (
        otherVersion?.version_status !== 'PROPOSED' ||
        otherVersion.enterprise_id !== context.enterpriseId ||
        otherVersion.project_id !== candidate.projectId
      ) {
        continue;
      }
      const otherSelections = sourceSelectionsFromVersion(otherVersion);
      const overlaps = [...candidateSourceIds].some((sourceId) =>
        sourceIds(otherSelections).has(sourceId),
      );
      if (
        overlaps &&
        classificationFingerprint(otherVersion, otherSelections) !== candidateFingerprint
      ) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_MATERIAL_CONFLICT_UNRESOLVED,
          safeSummary: safeReject(
            'another conflicting current proposal uses the same SourceMaterial',
          ),
          currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
        };
      }
    }
    const expected = aggregateVersionToString(root.aggregate_version);
    const newVersionId = newUuidV7();
    const newVersionNo =
      (await repo.getCustomerMaterialVersions(execution.trx, candidate.customerMaterialId)).reduce(
        (maximum, version) => Math.max(maximum, version.version_no),
        0,
      ) + 1;
    const effectiveDateValue = candidateVersion.effective_date?.toISOString().slice(0, 10) ?? null;
    const confirmedVersionPayload = {
      enterpriseId: context.enterpriseId,
      projectId: candidate.projectId,
      customerMaterialId: candidate.customerMaterialId,
      versionId: newVersionId,
      versionNo: newVersionNo,
      versionStatus: 'CONFIRMED',
      materialType: candidateVersion.material_type,
      title: candidateVersion.title,
      customerDocumentNumber: candidateVersion.customer_document_number,
      customerVersionLabel: candidateVersion.customer_version_label,
      effectiveDate: effectiveDateValue,
      declaredStatus,
      completeness,
      sourceSelections,
      language: candidateVersion.language,
      classificationRationale: rationaleFromVersion(candidateVersion),
    };
    const versionDigest = digestCanonicalPayload(confirmedVersionPayload);
    const decisionId = newUuidV7();
    const decisionPayload = {
      enterpriseId: context.enterpriseId,
      projectId: candidate.projectId,
      customerMaterialId: candidate.customerMaterialId,
      versionId: newVersionId,
      candidateVersionId: candidate.versionId,
      decisionKind: 'CONFIRMED',
      completeness,
      declaredStatus,
      evidenceRefs,
      justification,
    };
    const decisionDigest = digestCanonicalPayload(decisionPayload);
    const confirmationDecisionRef = businessDecisionRef(
      context.enterpriseId,
      candidate.projectId,
      decisionId,
      decisionDigest.hash,
    );
    const cas = await repo.casCustomerMaterial(
      execution.trx,
      candidate.customerMaterialId,
      expected,
      newVersionId,
      'CONFIRMED',
      {
        completeness,
        declaredStatus,
        confirmedByPrincipalId: envelope.principalId,
        confirmedByActorSnapshotId: envelope.actorSnapshotId,
        confirmedAt: new Date(),
        sourceCommandId: envelope.commandId,
      },
    );
    if (!cas.ok) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        `CustomerMaterial aggregate version changed from ${expected} to ${cas.current}`,
      );
    }
    await repo.insertCustomerMaterialVersion(execution.trx, {
      versionId: newVersionId,
      customerMaterialId: candidate.customerMaterialId,
      enterpriseId: context.enterpriseId,
      projectId: candidate.projectId,
      versionNo: newVersionNo,
      versionStatus: 'CONFIRMED',
      materialType: candidateVersion.material_type,
      title: candidateVersion.title,
      ...(candidateVersion.customer_document_number === null
        ? {}
        : { customerDocumentNumber: candidateVersion.customer_document_number }),
      ...(candidateVersion.customer_version_label === null
        ? {}
        : { customerVersionLabel: candidateVersion.customer_version_label }),
      ...(candidateVersion.effective_date === null
        ? {}
        : { effectiveDate: candidateVersion.effective_date }),
      declaredStatus,
      completeness,
      sourceSelections,
      language: candidateVersion.language,
      classificationRationale: rationaleFromVersion(candidateVersion),
      payloadHash: versionDigest.hash,
      proposedByPrincipalId: envelope.principalId,
      proposedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
      previousVersionId: candidate.versionId,
    });
    await repo.insertCustomerMaterialDecision(execution.trx, {
      decisionId,
      customerMaterialId: candidate.customerMaterialId,
      versionId: newVersionId,
      enterpriseId: context.enterpriseId,
      projectId: candidate.projectId,
      decisionKind: 'CONFIRMED',
      evidenceRefs,
      justification,
      payload: decisionPayload,
      payloadHash: decisionDigest.hash,
      decidedByPrincipalId: envelope.principalId,
      decidedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: candidate.customerMaterialId,
      ownerVersionId: newVersionId,
      ownerPayloadHash: versionDigest.hash,
      referencePath: '/previousVersionRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: 'CustomerMaterial',
      targetObjectId: candidate.customerMaterialId,
      targetVersionId: candidate.versionId,
      targetPayloadHash: candidateVersion.payload_hash,
      referencePurpose: 'CUSTOMER_MATERIAL_VERSION_PREVIOUS',
    });
    await execution.appendReferenceEdge({
      ownerObjectType: 'CustomerMaterial',
      ownerObjectId: candidate.customerMaterialId,
      ownerVersionId: newVersionId,
      ownerPayloadHash: versionDigest.hash,
      referencePath: '/confirmationDecisionRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: 'BusinessDecision',
      targetObjectId: decisionId,
      targetPayloadHash: decisionDigest.hash,
      referencePurpose: 'CUSTOMER_MATERIAL_CONFIRMATION_DECISION',
    });
    await appendSourceSelectionEdges(
      execution,
      candidate.customerMaterialId,
      newVersionId,
      versionDigest.hash,
      sourceSelectionFacts,
    );
    await appendEvidenceEdges(
      execution,
      candidate.customerMaterialId,
      newVersionId,
      versionDigest.hash,
      evidenceRefs,
      context.enterpriseId,
      candidate.projectId,
      'CUSTOMER_MATERIAL_CONFIRMATION_EVIDENCE',
    );
    const eventPayload = {
      // These promoted mirrors are technical storage fields required by the
      // WI-02 outbox guard; the public Contract payload remains the exact
      // five-field CustomerMaterialConfirmed shape.
      enterpriseId: context.enterpriseId,
      projectId: candidate.projectId,
      customerMaterialRef: customerMaterialRef(
        context.enterpriseId,
        candidate.projectId,
        candidate.customerMaterialId,
        newVersionId,
      ),
      projectRef: projectRef(context.enterpriseId, candidate.projectId),
      materialType: candidateVersion.material_type,
      completeness,
      confirmationDecisionRef,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'project.CustomerMaterialConfirmed',
      eventVersion: '1.0',
      aggregateType: 'CustomerMaterial',
      aggregateId: candidate.customerMaterialId,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        customerMaterialRef: customerMaterialRef(
          context.enterpriseId,
          candidate.projectId,
          candidate.customerMaterialId,
          newVersionId,
        ),
        projectRef: projectRef(context.enterpriseId, candidate.projectId),
        materialType: candidateVersion.material_type,
        completeness,
        declaredStatus,
        confirmationDecisionRef,
        status: 'CONFIRMED',
        aggregateVersion: cas.nextVersion,
        versionNo: newVersionNo,
        payloadHash: versionDigest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}
