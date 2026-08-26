// IM-03 WI-09 (issue #65): controlled GapAnalysis evaluator and Human
// acceptance handlers. The evaluator accepts only deterministic finding
// fixtures; it never creates a DeliveryPlan or treats a recommendation as a
// project commitment.

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
import { GapAnalysisRepository } from '../persistence/gap-analysis-repository.js';
import type {
  GapAnalysisStatus,
  GapFindingSeverity,
} from '../persistence/enterprise-business-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_GAP_DECISION_CONFLICT,
  PROJECT_GAP_EPISTEMIC_CONFLICT,
  PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED,
  PROJECT_GAP_INPUT_HASH_MISMATCH,
  PROJECT_GAP_INPUT_INCOMPLETE,
  PROJECT_GAP_SCOPE_MISMATCH,
  PROJECT_GAP_STATUS_INVALID,
  PROJECT_GAP_VERSION_IMMUTABLE,
  PROJECT_GAP_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

const repo = new GapAnalysisRepository();

type StartPayload = EnterpriseProject.ProjectStartGapAnalysisPayload;
type AcceptPayload = EnterpriseProject.ProjectAcceptGapAnalysisPayload;

export type StartGapAnalysisCommandPayload = StartPayload;
export type AcceptGapAnalysisCommandPayload = AcceptPayload;

export interface ControlledGapFinding {
  readonly findingId: string;
  readonly subjectKey: string;
  readonly subjectType: string;
  readonly customerBaselineItemRefs?: readonly unknown[];
  readonly templateRefs?: readonly unknown[];
  readonly regulatoryItemRefs?: readonly unknown[];
  readonly gapStatus: string;
  readonly severity: GapFindingSeverity;
  readonly rationale: unknown;
  readonly evidenceRefs?: readonly unknown[];
  readonly recommendedAction: string;
  readonly informationRequestRefs?: readonly unknown[];
  readonly reviewDisposition?: string;
  readonly sourceState?: string;
}

type ReferenceLike = Record<string, unknown>;

interface ProjectVersionReference {
  readonly ref: CanonicalJsonObject;
  readonly objectId: string;
  readonly versionId: string;
}

interface EnterpriseSnapshotReference {
  readonly ref: CanonicalJsonObject;
  readonly objectId: string;
  readonly snapshotId: string;
  readonly hash: Buffer;
}

interface ResolvedInput {
  readonly customerBaseline: ProjectVersionReference;
  readonly templateBaseline: ProjectVersionReference;
  readonly regulatoryProfile: ProjectVersionReference;
  readonly enterpriseProfile: EnterpriseSnapshotReference;
  readonly qmsConfiguration: ProjectVersionReference;
  readonly qmsConfigurationRevisionHash: Buffer;
  readonly productScope: EnterpriseSnapshotReference;
  readonly analysisPolicy: ProjectVersionReference;
  readonly payload: CanonicalJsonObject;
  readonly payloadHash: Buffer;
}

interface NormalizedFinding {
  readonly value: CanonicalJsonObject;
  readonly findingId: string;
  readonly subjectKey: string;
  readonly subjectType: string;
  readonly customerBaselineItemRefs: readonly CanonicalJsonObject[];
  readonly templateRefs: readonly CanonicalJsonObject[];
  readonly regulatoryItemRefs: readonly CanonicalJsonObject[];
  readonly gapStatus: string;
  readonly severity: GapFindingSeverity;
  readonly rationale: CanonicalJsonObject;
  readonly evidenceRefs: readonly CanonicalJsonObject[];
  readonly recommendedAction: string;
  readonly informationRequestRefs: readonly CanonicalJsonObject[];
  readonly reviewDisposition?: string;
}

interface ValidatedFindingFixture {
  readonly scope: CanonicalJsonObject;
  readonly findings: readonly NormalizedFinding[];
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ReferenceLike)
    : {};
}

function asCanonicalJson(value: unknown, label: string): CanonicalJsonValue {
  try {
    const serialized = JSON.stringify(value);
    return JSON.parse(serialized) as CanonicalJsonValue;
  } catch {
    throw new EnterpriseBusinessError(PROJECT_GAP_INPUT_INCOMPLETE, `${label} must be valid JSON`);
  }
}

function canonicalObject(value: unknown, label: string): CanonicalJsonObject {
  const canonical = asCanonicalJson(value, label);
  if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must be a JSON object`,
    );
  }
  return canonical as CanonicalJsonObject;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(PROJECT_GAP_INPUT_INCOMPLETE, `${label} must be non-empty`);
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must be an RFC 9562 UUIDv7`,
    );
  }
  return value;
}

function rejectLatest(value: unknown, label: string): void {
  const reference = asReferenceLike(value);
  if (
    reference.versionId === 'latest' ||
    reference.versionId === 'current' ||
    reference.snapshotId === 'latest' ||
    reference.snapshotId === 'current' ||
    reference.immutableVersionId === 'latest' ||
    reference.immutableVersionId === 'current'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must identify an exact version or snapshot`,
    );
  }
}

function contentHash(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must carry a SHA-256/1 digest`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function hashRef(hash: Buffer): Common.ContentHash & CanonicalJsonObject {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function projectScope(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): void {
  const scope = asReferenceLike(asReferenceLike(value).scope);
  if (scope.enterpriseId !== enterpriseId || scope.projectId !== projectId) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      `${label} must carry the exact Project scope`,
    );
  }
}

function enterpriseScope(value: unknown, enterpriseId: string, label: string): void {
  const scope = asReferenceLike(asReferenceLike(value).scope);
  if (scope.enterpriseId !== enterpriseId || scope.projectId !== undefined) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      `${label} must carry the exact Enterprise scope`,
    );
  }
}

function exactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): string {
  const reference = asReferenceLike(value);
  const projectId = uuid(reference.objectId, 'projectRef.objectId');
  if (
    reference.kind !== 'OBJECT' ||
    reference.objectType !== 'Project' ||
    envelope.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'projectRef must identify an allowed Project exactly',
    );
  }
  projectScope(value, context.enterpriseId, projectId, 'projectRef');
  return projectId;
}

function exactProjectVersionRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  projectId: string,
  label: string,
): ProjectVersionReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.versionId, `${label}.versionId`);
  if (reference.kind !== 'VERSIONED' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must be an exact ${objectType} VersionedRef`,
    );
  }
  projectScope(value, enterpriseId, projectId, label);
  return { ref: canonicalObject(value, label), objectId, versionId };
}

function exactEnterpriseVersionRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  label: string,
): ProjectVersionReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.versionId, `${label}.versionId`);
  if (reference.kind !== 'VERSIONED' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must be an exact ${objectType} VersionedRef`,
    );
  }
  enterpriseScope(value, enterpriseId, label);
  return { ref: canonicalObject(value, label), objectId, versionId };
}

function exactEnterpriseSnapshotRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  label: string,
): EnterpriseSnapshotReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const snapshotId = uuid(reference.snapshotId, `${label}.snapshotId`);
  if (reference.kind !== 'SNAPSHOT' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      `${label} must be an exact ${objectType} SnapshotRef`,
    );
  }
  enterpriseScope(value, enterpriseId, label);
  return {
    ref: canonicalObject(value, label),
    objectId,
    snapshotId,
    hash: contentHash(reference.contentHash, `${label}.contentHash`),
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

function gapVersionRef(
  enterpriseId: string,
  projectId: string,
  gapAnalysisId: string,
  versionId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'GapAnalysis',
    objectId: gapAnalysisId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function inputSnapshotRef(
  enterpriseId: string,
  projectId: string,
  gapAnalysisId: string,
  snapshotId: string,
  payloadHash: Buffer,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'GapInput',
    objectId: gapAnalysisId,
    snapshotId,
    scope: { enterpriseId, projectId },
    contentHash: hashRef(payloadHash),
  };
}

function decisionRef(
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
    contentHash: hashRef(payloadHash),
  };
}

function reviewSnapshotRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
): CanonicalJsonObject {
  rejectLatest(value, 'reviewSnapshotRef');
  const reference = asReferenceLike(value);
  uuid(reference.objectId, 'reviewSnapshotRef.objectId');
  uuid(reference.snapshotId, 'reviewSnapshotRef.snapshotId');
  if (reference.kind !== 'SNAPSHOT' || reference.objectType !== 'GapReview') {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      'reviewSnapshotRef must be an exact GapReview SnapshotRef',
    );
  }
  projectScope(value, enterpriseId, projectId, 'reviewSnapshotRef');
  contentHash(reference.contentHash, 'reviewSnapshotRef.contentHash');
  return canonicalObject(value, 'reviewSnapshotRef');
}

function validateJustification(
  value: unknown,
  enterpriseId: string,
  projectId: string,
): CanonicalJsonObject {
  const justification = asReferenceLike(value);
  const reasonCode = nonEmpty(justification.reasonCode, 'justification.reasonCode');
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(reasonCode)) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      'justification.reasonCode must be a registered reason code',
    );
  }
  const summary = nonEmpty(justification.summary, 'justification.summary');
  if (!Array.isArray(justification.evidenceRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      'justification.evidenceRefs must be an array',
    );
  }
  const evidenceRefs = justification.evidenceRefs.map((value, index) => {
    const evidence = canonicalObject(value, `justification.evidenceRefs[${index}]`);
    const facts = asReferenceLike(value);
    if (facts.applicabilityScopeRef !== undefined) {
      projectScope(facts.applicabilityScopeRef, enterpriseId, projectId, 'applicabilityScopeRef');
    }
    if (facts.evidence !== undefined) {
      const evidenceFacts = asReferenceLike(facts.evidence);
      if (evidenceFacts.scope !== undefined) {
        const scope = asReferenceLike(evidenceFacts.scope);
        if (
          scope.enterpriseId !== enterpriseId ||
          (scope.projectId !== undefined && scope.projectId !== projectId)
        ) {
          throw new EnterpriseBusinessError(
            PROJECT_GAP_SCOPE_MISMATCH,
            `justification.evidenceRefs[${index}] crosses the trusted Project scope`,
          );
        }
      }
      if (evidenceFacts.contentHash !== undefined) {
        contentHash(evidenceFacts.contentHash, `justification.evidenceRefs[${index}].evidence`);
      }
    }
    return evidence;
  });
  const policyRef =
    justification.policyRef === undefined
      ? undefined
      : exactProjectVersionRef(
          justification.policyRef,
          'Policy',
          enterpriseId,
          projectId,
          'justification.policyRef',
        ).ref;
  return {
    reasonCode,
    summary,
    evidenceRefs,
    ...(policyRef === undefined ? {} : { policyRef }),
  };
}

function validateTypedReferenceArray(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): readonly CanonicalJsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new EnterpriseBusinessError(PROJECT_GAP_INPUT_INCOMPLETE, `${label} must be an array`);
  }
  return value.map((candidate, index) => {
    const reference = asReferenceLike(candidate);
    rejectLatest(candidate, `${label}[${index}]`);
    if (reference.scope !== undefined) {
      const scope = asReferenceLike(reference.scope);
      if (
        scope.enterpriseId !== enterpriseId ||
        (scope.projectId !== undefined && scope.projectId !== projectId)
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_GAP_SCOPE_MISMATCH,
          `${label}[${index}] crosses the trusted Project scope`,
        );
      }
    }
    if (reference.objectId !== undefined) uuid(reference.objectId, `${label}[${index}].objectId`);
    if (reference.versionId !== undefined)
      uuid(reference.versionId, `${label}[${index}].versionId`);
    if (reference.snapshotId !== undefined)
      uuid(reference.snapshotId, `${label}[${index}].snapshotId`);
    if (reference.immutableVersionId !== undefined) {
      uuid(reference.immutableVersionId, `${label}[${index}].immutableVersionId`);
    }
    if (reference.contentHash !== undefined) {
      contentHash(reference.contentHash, `${label}[${index}].contentHash`);
    }
    return canonicalObject(candidate, `${label}[${index}]`);
  });
}

function validateEvidenceArray(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): readonly CanonicalJsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new EnterpriseBusinessError(PROJECT_GAP_INPUT_INCOMPLETE, `${label} must be an array`);
  }
  return value.map((candidate, index) => {
    const evidence = canonicalObject(candidate, `${label}[${index}]`);
    const facts = asReferenceLike(candidate);
    if (facts.evidence !== undefined) {
      const evidenceFacts = asReferenceLike(facts.evidence);
      if (evidenceFacts.contentHash !== undefined) {
        contentHash(evidenceFacts.contentHash, `${label}[${index}].evidence.contentHash`);
      }
      if (evidenceFacts.scope !== undefined) {
        const scope = asReferenceLike(evidenceFacts.scope);
        if (
          scope.enterpriseId !== enterpriseId ||
          (scope.projectId !== undefined && scope.projectId !== projectId)
        ) {
          throw new EnterpriseBusinessError(
            PROJECT_GAP_SCOPE_MISMATCH,
            `${label}[${index}] crosses the trusted Project scope`,
          );
        }
      }
    }
    if (facts.applicabilityScopeRef !== undefined) {
      projectScope(facts.applicabilityScopeRef, enterpriseId, projectId, `${label}[${index}]`);
    }
    return evidence;
  });
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new EnterpriseBusinessError(PROJECT_GAP_STATUS_INVALID, `${label} is not supported`);
  }
  return value as T;
}

function validateFindingFixtures(
  value: unknown,
  enterpriseId: string,
  projectId: string,
): ValidatedFindingFixture {
  const scope = canonicalObject(value, 'requestedScope');
  const facts = asReferenceLike(scope);
  if (facts.findings === undefined) return { scope, findings: [] };
  if (!Array.isArray(facts.findings)) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_INCOMPLETE,
      'requestedScope.findings must be an array',
    );
  }
  const findings = facts.findings.map((candidate, index) => {
    const label = `requestedScope.findings[${index}]`;
    const finding = asReferenceLike(candidate);
    const findingId = uuid(finding.findingId, `${label}.findingId`);
    const subjectKey = nonEmpty(finding.subjectKey, `${label}.subjectKey`);
    const subjectType = nonEmpty(finding.subjectType, `${label}.subjectType`);
    const gapStatus = enumValue(
      finding.gapStatus,
      ['MATCH', 'MINOR_GAP', 'MAJOR_GAP', 'MISSING', 'EXTRA', 'UNKNOWN', 'NOT_APPLICABLE'],
      `${label}.gapStatus`,
    );
    const severity = enumValue(
      finding.severity,
      ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      `${label}.severity`,
    );
    const recommendedAction = enumValue(
      finding.recommendedAction,
      ['KEEP', 'REVISE', 'REPLACE', 'CREATE', 'REMOVE', 'NEED_INFORMATION', 'HUMAN_REVIEW'],
      `${label}.recommendedAction`,
    );
    const rationale = canonicalObject(finding.rationale, `${label}.rationale`);
    const customerBaselineItemRefs = validateTypedReferenceArray(
      finding.customerBaselineItemRefs,
      enterpriseId,
      projectId,
      `${label}.customerBaselineItemRefs`,
    );
    const templateRefs = validateTypedReferenceArray(
      finding.templateRefs,
      enterpriseId,
      projectId,
      `${label}.templateRefs`,
    );
    const regulatoryItemRefs = validateTypedReferenceArray(
      finding.regulatoryItemRefs,
      enterpriseId,
      projectId,
      `${label}.regulatoryItemRefs`,
    );
    const evidenceRefs = validateEvidenceArray(
      finding.evidenceRefs,
      enterpriseId,
      projectId,
      `${label}.evidenceRefs`,
    );
    const informationRequestRefs = validateTypedReferenceArray(
      finding.informationRequestRefs,
      enterpriseId,
      projectId,
      `${label}.informationRequestRefs`,
    );
    const sourceState = finding.sourceState;
    if ((sourceState === 'UNKNOWN' || sourceState === 'NOT_PROVIDED') && gapStatus === 'MISSING') {
      throw new EnterpriseBusinessError(
        PROJECT_GAP_EPISTEMIC_CONFLICT,
        `${label} cannot convert UNKNOWN or NOT_PROVIDED into MISSING`,
      );
    }
    if (
      gapStatus === 'UNKNOWN' &&
      recommendedAction !== 'NEED_INFORMATION' &&
      recommendedAction !== 'HUMAN_REVIEW'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_GAP_EPISTEMIC_CONFLICT,
        `${label} UNKNOWN requires NEED_INFORMATION or HUMAN_REVIEW`,
      );
    }
    if (
      (gapStatus === 'MAJOR_GAP' || severity === 'HIGH' || severity === 'CRITICAL') &&
      evidenceRefs.length === 0 &&
      informationRequestRefs.length === 0
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_GAP_EPISTEMIC_CONFLICT,
        `${label} high-risk or MAJOR_GAP requires evidence or an information request`,
      );
    }
    const reviewDisposition =
      finding.reviewDisposition === undefined
        ? undefined
        : nonEmpty(finding.reviewDisposition, `${label}.reviewDisposition`);
    const normalized: CanonicalJsonObject = {
      findingId,
      subjectKey,
      subjectType,
      customerBaselineItemRefs,
      templateRefs,
      regulatoryItemRefs,
      gapStatus,
      severity,
      rationale,
      evidenceRefs,
      recommendedAction,
      informationRequestRefs,
      ...(reviewDisposition === undefined ? {} : { reviewDisposition }),
    };
    return {
      value: normalized,
      findingId,
      subjectKey,
      subjectType,
      customerBaselineItemRefs,
      templateRefs,
      regulatoryItemRefs,
      gapStatus,
      severity,
      rationale,
      evidenceRefs,
      recommendedAction,
      informationRequestRefs,
      ...(reviewDisposition === undefined ? {} : { reviewDisposition }),
    } satisfies NormalizedFinding;
  });
  const findingIds = new Set<string>();
  const subjectKeys = new Set<string>();
  for (const finding of findings) {
    if (findingIds.has(finding.findingId) || subjectKeys.has(finding.subjectKey)) {
      throw new EnterpriseBusinessError(
        PROJECT_GAP_STATUS_INVALID,
        'findingId and subjectKey must be unique within one analysis version',
      );
    }
    findingIds.add(finding.findingId);
    subjectKeys.add(finding.subjectKey);
  }
  return { scope, findings };
}

async function resolveFindingEpistemicState(
  trx: EnterpriseProjectTransaction,
  baselineVersionId: string,
  findings: readonly NormalizedFinding[],
): Promise<void> {
  if (findings.length === 0) return;
  const items = await repo.getCustomerBaselineItems(trx, baselineVersionId);
  const byId = new Map(items.map((item) => [item.expectation_id, item]));
  for (const finding of findings) {
    for (const reference of finding.customerBaselineItemRefs) {
      const facts = asReferenceLike(reference);
      if (facts.objectType !== 'CustomerBaselineItem') continue;
      const itemId = uuid(facts.objectId, 'customerBaselineItemRef.objectId');
      const versionId = uuid(facts.versionId, 'customerBaselineItemRef.versionId');
      if (versionId !== baselineVersionId) {
        throw new EnterpriseBusinessError(
          PROJECT_GAP_SCOPE_MISMATCH,
          'CustomerBaselineItem ref must belong to the frozen CustomerBaseline version',
        );
      }
      const item = byId.get(itemId);
      if (!item) {
        throw new EnterpriseBusinessError(
          PROJECT_GAP_SCOPE_MISMATCH,
          'CustomerBaselineItem ref does not resolve to the frozen baseline',
        );
      }
      if (
        finding.gapStatus === 'MISSING' &&
        (item.status === 'UNKNOWN' || item.status === 'NOT_PROVIDED')
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_GAP_EPISTEMIC_CONFLICT,
          'UNKNOWN or NOT_PROVIDED CustomerBaseline facts cannot become MISSING',
        );
      }
    }
  }
}

function findingsSummary(findings: readonly NormalizedFinding[]): CanonicalJsonObject {
  const byGapStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const finding of findings) {
    byGapStatus[finding.gapStatus] = (byGapStatus[finding.gapStatus] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  return { findingCount: findings.length, byGapStatus, bySeverity };
}

async function resolveInputSnapshot(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  value: unknown,
): Promise<ResolvedInput> {
  const input = asReferenceLike(value);
  const customerBaseline = exactProjectVersionRef(
    input.customerBaselineRef,
    'CustomerBaseline',
    context.enterpriseId,
    projectId,
    'inputSnapshot.customerBaselineRef',
  );
  const templateBaseline = exactProjectVersionRef(
    input.templateBaselineRef,
    'TemplateBaseline',
    context.enterpriseId,
    projectId,
    'inputSnapshot.templateBaselineRef',
  );
  const regulatoryProfile = exactProjectVersionRef(
    input.regulatoryProfileRef,
    'RegulatoryProfile',
    context.enterpriseId,
    projectId,
    'inputSnapshot.regulatoryProfileRef',
  );
  const enterpriseProfile = exactEnterpriseSnapshotRef(
    input.enterpriseProfileSnapshotRef,
    'EnterpriseProfileSnapshot',
    context.enterpriseId,
    'inputSnapshot.enterpriseProfileSnapshotRef',
  );
  const qmsConfiguration = exactEnterpriseVersionRef(
    input.qmsConfigurationRef,
    'QMSConfiguration',
    context.enterpriseId,
    'inputSnapshot.qmsConfigurationRef',
  );
  const productScope = exactEnterpriseSnapshotRef(
    input.productScopeSnapshotRef,
    'ProductScopeSnapshot',
    context.enterpriseId,
    'inputSnapshot.productScopeSnapshotRef',
  );
  const analysisPolicy = exactProjectVersionRef(
    input.analysisPolicyRef,
    'Policy',
    context.enterpriseId,
    projectId,
    'inputSnapshot.analysisPolicyRef',
  );

  const customerRoot = await repo.getCustomerBaselineById(trx, customerBaseline.objectId);
  const customerVersion = await repo.getCustomerBaselineVersion(trx, customerBaseline.versionId);
  if (
    customerRoot?.enterprise_id !== context.enterpriseId ||
    customerRoot.project_id !== projectId ||
    customerRoot.current_version_id !== customerBaseline.versionId ||
    customerRoot.active_version_id !== customerBaseline.versionId ||
    customerVersion?.customer_baseline_id !== customerBaseline.objectId ||
    customerVersion.enterprise_id !== context.enterpriseId ||
    customerVersion.project_id !== projectId ||
    customerVersion.version_status !== 'CONFIRMED'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'customerBaselineRef does not identify the exact confirmed active version',
    );
  }

  const templateRoot = await repo.getTemplateBaselineById(trx, templateBaseline.objectId);
  const templateVersion = await repo.getTemplateBaselineVersion(trx, templateBaseline.versionId);
  if (
    templateRoot?.enterprise_id !== context.enterpriseId ||
    templateRoot.project_id !== projectId ||
    templateRoot.current_version_id !== templateBaseline.versionId ||
    templateRoot.active_version_id !== templateBaseline.versionId ||
    templateVersion?.template_baseline_id !== templateBaseline.objectId ||
    templateVersion.enterprise_id !== context.enterpriseId ||
    templateVersion.project_id !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'templateBaselineRef does not identify the exact frozen active version',
    );
  }

  const regulatoryRoot = await repo.getRegulatoryProfileById(trx, regulatoryProfile.objectId);
  const regulatoryVersion = await repo.getRegulatoryProfileVersion(
    trx,
    regulatoryProfile.versionId,
  );
  if (
    regulatoryRoot?.enterprise_id !== context.enterpriseId ||
    regulatoryRoot.project_id !== projectId ||
    regulatoryRoot.current_version_id !== regulatoryProfile.versionId ||
    regulatoryRoot.active_version_id !== regulatoryProfile.versionId ||
    regulatoryVersion?.regulatory_profile_id !== regulatoryProfile.objectId ||
    regulatoryVersion.enterprise_id !== context.enterpriseId ||
    regulatoryVersion.project_id !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'regulatoryProfileRef does not identify the exact frozen active version',
    );
  }

  const profileRow = await repo.getEnterpriseProfileSnapshot(trx, enterpriseProfile.snapshotId);
  if (
    profileRow?.enterprise_id !== context.enterpriseId ||
    profileRow.snapshot_id !== enterpriseProfile.objectId ||
    profileRow.snapshot_id !== enterpriseProfile.snapshotId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'enterpriseProfileSnapshotRef does not identify the persisted snapshot exactly',
    );
  }
  if (profileRow.payload_hash.compare(enterpriseProfile.hash) !== 0) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_HASH_MISMATCH,
      'enterpriseProfileSnapshotRef does not match the persisted snapshot hash',
    );
  }

  const qmsRoot = await repo.getQmsConfigurationById(trx, qmsConfiguration.objectId);
  const qmsRevision = await repo.getQmsConfigurationRevision(trx, qmsConfiguration.versionId);
  if (
    qmsRoot?.enterprise_id !== context.enterpriseId ||
    qmsRoot.status !== 'ACTIVE' ||
    qmsRoot.current_revision_id !== qmsConfiguration.versionId ||
    qmsRevision?.qms_configuration_id !== qmsConfiguration.objectId ||
    qmsRevision.enterprise_id !== context.enterpriseId ||
    qmsRevision.lifecycle !== 'CURRENT'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_SCOPE_MISMATCH,
      'qmsConfigurationRef does not identify the exact current QMS revision',
    );
  }

  const productScopeRow = await repo.getProductScopeSnapshot(trx, productScope.snapshotId);
  const product = await repo.getProductById(trx, productScope.objectId);
  if (!productScopeRow || !product) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_HASH_MISMATCH,
      'productScopeSnapshotRef does not match a persisted active product snapshot',
    );
  }
  if (
    productScope.objectId !== productScopeRow.product_id ||
    productScopeRow.enterprise_id !== context.enterpriseId ||
    product.enterprise_id !== context.enterpriseId ||
    product.status !== 'ACTIVE' ||
    productScopeRow.payload_hash.compare(productScope.hash) !== 0
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_INPUT_HASH_MISMATCH,
      'productScopeSnapshotRef does not match the persisted active product snapshot',
    );
  }

  const payload = {
    customerBaselineRef: customerBaseline.ref,
    templateBaselineRef: templateBaseline.ref,
    regulatoryProfileRef: regulatoryProfile.ref,
    enterpriseProfileSnapshotRef: enterpriseProfile.ref,
    qmsConfigurationRef: qmsConfiguration.ref,
    productScopeSnapshotRef: productScope.ref,
    analysisPolicyRef: analysisPolicy.ref,
    normalized: {
      customerBaselineId: customerBaseline.objectId,
      customerBaselineVersionId: customerBaseline.versionId,
      templateBaselineId: templateBaseline.objectId,
      templateBaselineVersionId: templateBaseline.versionId,
      regulatoryProfileId: regulatoryProfile.objectId,
      regulatoryProfileVersionId: regulatoryProfile.versionId,
      enterpriseProfileSnapshotId: enterpriseProfile.snapshotId,
      enterpriseProfilePayloadHash: hashRef(profileRow.payload_hash),
      qmsConfigurationId: qmsConfiguration.objectId,
      qmsConfigurationRevisionId: qmsConfiguration.versionId,
      qmsConfigurationRevisionHash: hashRef(qmsRevision.payload_hash),
      productScopeSnapshotId: productScope.snapshotId,
      productScopePayloadHash: hashRef(productScopeRow.payload_hash),
      analysisPolicyId: analysisPolicy.objectId,
      analysisPolicyVersionId: analysisPolicy.versionId,
    },
  } as unknown as CanonicalJsonObject;
  return {
    customerBaseline,
    templateBaseline,
    regulatoryProfile,
    enterpriseProfile: { ...enterpriseProfile, hash: profileRow.payload_hash },
    qmsConfiguration,
    qmsConfigurationRevisionHash: qmsRevision.payload_hash,
    productScope: { ...productScope, hash: productScopeRow.payload_hash },
    analysisPolicy,
    payload,
    payloadHash: digestCanonicalPayload(payload).hash,
  };
}

function containsActingFor(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsActingFor(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (key === 'actingFor' || key === 'actingForRef') return true;
    if (containsActingFor(child, seen)) return true;
  }
  return false;
}

function assertHumanOnly(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  payload: unknown,
): void {
  if (
    context.principalKind !== 'HUMAN' ||
    envelope.principalKind !== 'HUMAN' ||
    containsActingFor(envelope) ||
    containsActingFor(payload)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED,
      'GapAnalysis acceptance is Human-only and cannot use actingFor',
    );
  }
}

function targetPayloadHash(value: unknown): Buffer | undefined {
  const facts = asReferenceLike(value);
  const hash = asReferenceLike(facts.contentHash);
  return typeof hash.digest === 'string' && /^[0-9a-f]{64}$/i.test(hash.digest)
    ? Buffer.from(hash.digest.toLowerCase(), 'hex')
    : undefined;
}

async function appendReferenceFromValue(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  ownerId: string,
  ownerVersionId: string,
  ownerPayloadHash: Buffer,
  reference: unknown,
  referencePath: string,
  referencePurpose: string,
): Promise<void> {
  const facts = asReferenceLike(reference);
  if (typeof facts.objectType !== 'string' || typeof facts.objectId !== 'string') return;
  if (!isUuidV7(facts.objectId)) return;
  const targetVersionId =
    typeof facts.versionId === 'string'
      ? facts.versionId
      : typeof facts.snapshotId === 'string'
        ? facts.snapshotId
        : typeof facts.immutableVersionId === 'string'
          ? facts.immutableVersionId
          : undefined;
  const payloadHash = targetPayloadHash(reference);
  await execution.appendReferenceEdge({
    ownerObjectType: 'GapAnalysis',
    ownerObjectId: ownerId,
    ownerVersionId,
    ownerPayloadHash,
    referencePath,
    targetModule: 'EnterpriseProject',
    targetObjectType: facts.objectType,
    targetObjectId: facts.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(payloadHash === undefined ? {} : { targetPayloadHash: payloadHash }),
    referencePurpose,
  });
}

async function appendStartReferenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  gapAnalysisId: string,
  versionId: string,
  payloadHash: Buffer,
  enterpriseId: string,
  projectId: string,
  input: ResolvedInput,
  findings: readonly NormalizedFinding[],
): Promise<void> {
  const refs: readonly [unknown, string, string][] = [
    [projectRef(enterpriseId, projectId), '/projectRef', 'GAP_ANALYSIS_PROJECT_SCOPE'],
    [input.customerBaseline.ref, '/inputSnapshot/customerBaselineRef', 'GAP_ANALYSIS_INPUT'],
    [input.templateBaseline.ref, '/inputSnapshot/templateBaselineRef', 'GAP_ANALYSIS_INPUT'],
    [input.regulatoryProfile.ref, '/inputSnapshot/regulatoryProfileRef', 'GAP_ANALYSIS_INPUT'],
    [
      input.enterpriseProfile.ref,
      '/inputSnapshot/enterpriseProfileSnapshotRef',
      'GAP_ANALYSIS_INPUT',
    ],
    [input.qmsConfiguration.ref, '/inputSnapshot/qmsConfigurationRef', 'GAP_ANALYSIS_INPUT'],
    [input.productScope.ref, '/inputSnapshot/productScopeSnapshotRef', 'GAP_ANALYSIS_INPUT'],
    [input.analysisPolicy.ref, '/inputSnapshot/analysisPolicyRef', 'GAP_ANALYSIS_INPUT'],
  ];
  for (const [reference, path, purpose] of refs) {
    await appendReferenceFromValue(
      execution,
      gapAnalysisId,
      versionId,
      payloadHash,
      reference,
      path,
      purpose,
    );
  }
  for (const [findingIndex, finding] of findings.entries()) {
    const findingRefs: readonly [readonly CanonicalJsonObject[], string, string][] = [
      [
        finding.customerBaselineItemRefs,
        'customerBaselineItemRefs',
        'GAP_ANALYSIS_FINDING_BASELINE',
      ],
      [finding.templateRefs, 'templateRefs', 'GAP_ANALYSIS_FINDING_TEMPLATE'],
      [finding.regulatoryItemRefs, 'regulatoryItemRefs', 'GAP_ANALYSIS_FINDING_REGULATORY'],
      [finding.evidenceRefs, 'evidenceRefs', 'GAP_ANALYSIS_FINDING_EVIDENCE'],
      [
        finding.informationRequestRefs,
        'informationRequestRefs',
        'GAP_ANALYSIS_FINDING_INFORMATION',
      ],
    ];
    for (const [references, field, purpose] of findingRefs) {
      for (const [referenceIndex, reference] of references.entries()) {
        const target = field === 'evidenceRefs' ? asReferenceLike(reference).evidence : reference;
        await appendReferenceFromValue(
          execution,
          gapAnalysisId,
          versionId,
          payloadHash,
          target,
          `/findings/${findingIndex}/${field}/${referenceIndex}`,
          purpose,
        );
      }
    }
  }
}

function aggregateVersion(value: unknown): string {
  return String(value);
}

function safeRejection(error: EnterpriseBusinessError, currentAggregateVersion?: string) {
  return {
    kind: 'REJECTED' as const,
    errorCode: error.code,
    safeSummary: error.message,
    ...(currentAggregateVersion === undefined ? {} : { currentAggregateVersion }),
  };
}

export async function handleStartGapAnalysis(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: StartPayload },
): Promise<CommandResult> {
  const projectId = exactProjectRef(envelope.payload.projectRef, context, envelope);
  const gapAnalysisId = uuid(envelope.targetId, 'GapAnalysis targetId');
  if (envelope.targetType !== 'GapAnalysis') {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'start_gap_analysis target must be a GapAnalysis root',
    );
  }
  if (envelope.expectedAggregateVersion !== undefined) {
    throw new CommandExecutionError(
      CONCURRENCY_CONFLICT,
      'a new GapAnalysis root cannot carry an expected aggregate version',
    );
  }
  const mode = enumValue(envelope.payload.mode, ['FORMAL', 'EXPLORATORY'], 'mode');
  const validatedFixtures = validateFindingFixtures(
    envelope.payload.requestedScope,
    context.enterpriseId,
    projectId,
  );
  // Check the required keys before opening the command transaction. Database
  // fact matching is repeated inside the transaction below.
  const inputShape = asReferenceLike(envelope.payload.inputSnapshot);
  for (const key of [
    'customerBaselineRef',
    'templateBaselineRef',
    'regulatoryProfileRef',
    'enterpriseProfileSnapshotRef',
    'qmsConfigurationRef',
    'productScopeSnapshotRef',
    'analysisPolicyRef',
  ]) {
    if (inputShape[key] === undefined) {
      throw new EnterpriseBusinessError(
        PROJECT_GAP_INPUT_INCOMPLETE,
        `inputSnapshot.${key} is required`,
      );
    }
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'GapAnalysis',
    targetId: gapAnalysisId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_GAP_SCOPE_MISMATCH,
        safeSummary: 'GapAnalysis requires an active Project in the trusted scope',
      };
    }
    if (await repo.getGapAnalysisById(execution.trx, gapAnalysisId)) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'GapAnalysis target already exists',
      };
    }
    let input: ResolvedInput;
    try {
      input = await resolveInputSnapshot(
        execution.trx,
        context,
        projectId,
        envelope.payload.inputSnapshot,
      );
      await resolveFindingEpistemicState(
        execution.trx,
        input.customerBaseline.versionId,
        validatedFixtures.findings,
      );
    } catch (error) {
      if (error instanceof EnterpriseBusinessError) return safeRejection(error);
      throw error;
    }
    const summary = findingsSummary(validatedFixtures.findings);
    const inputSnapshotId = newUuidV7();
    const versionId = newUuidV7();
    const versionPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      gapAnalysisId,
      versionId,
      versionNo: 1,
      mode,
      inputSnapshot: input.payload,
      requestedScope: validatedFixtures.scope,
      findings: validatedFixtures.findings.map((finding) => finding.value),
      findingsSummary: summary,
    } as unknown as CanonicalJsonObject;
    const versionDigest = digestCanonicalPayload(versionPayload);
    const insertedRoot = await repo.insertGapAnalysis(execution.trx, {
      gapAnalysisId,
      enterpriseId: context.enterpriseId,
      projectId,
      currentVersionId: versionId,
      status: 'COMPLETED',
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      sourceCommandId: envelope.commandId,
    });
    if (!insertedRoot) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'another GapAnalysis root was created for the target id',
      };
    }
    await repo.insertGapAnalysisInputSnapshot(execution.trx, {
      inputSnapshotId,
      gapAnalysisId,
      versionId,
      enterpriseId: context.enterpriseId,
      projectId,
      customerBaselineRef: input.customerBaseline.ref,
      customerBaselineId: input.customerBaseline.objectId,
      customerBaselineVersionId: input.customerBaseline.versionId,
      templateBaselineRef: input.templateBaseline.ref,
      templateBaselineId: input.templateBaseline.objectId,
      templateBaselineVersionId: input.templateBaseline.versionId,
      regulatoryProfileRef: input.regulatoryProfile.ref,
      regulatoryProfileId: input.regulatoryProfile.objectId,
      regulatoryProfileVersionId: input.regulatoryProfile.versionId,
      enterpriseProfileSnapshotRef: input.enterpriseProfile.ref,
      enterpriseProfileSnapshotId: input.enterpriseProfile.snapshotId,
      enterpriseProfilePayloadHash: input.enterpriseProfile.hash,
      qmsConfigurationRef: input.qmsConfiguration.ref,
      qmsConfigurationId: input.qmsConfiguration.objectId,
      qmsConfigurationRevisionId: input.qmsConfiguration.versionId,
      qmsConfigurationRevisionHash: input.qmsConfigurationRevisionHash,
      productScopeSnapshotRef: input.productScope.ref,
      productScopeSnapshotId: input.productScope.snapshotId,
      productScopePayloadHash: input.productScope.hash,
      analysisPolicyRef: input.analysisPolicy.ref,
      analysisPolicyId: input.analysisPolicy.objectId,
      analysisPolicyVersionId: input.analysisPolicy.versionId,
      payload: input.payload,
      payloadHash: input.payloadHash,
      recordedByPrincipalId: envelope.principalId,
      recordedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await repo.insertGapAnalysisVersion(execution.trx, {
      versionId,
      gapAnalysisId,
      enterpriseId: context.enterpriseId,
      projectId,
      versionNo: 1,
      mode,
      inputSnapshotId,
      requestedScope: validatedFixtures.scope,
      findingsSummary: summary,
      payload: versionPayload,
      payloadHash: versionDigest.hash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    for (const finding of validatedFixtures.findings) {
      const findingPayload = {
        enterpriseId: context.enterpriseId,
        projectId,
        gapAnalysisId,
        versionId,
        finding: finding.value,
      } as unknown as CanonicalJsonObject;
      await repo.insertGapFinding(execution.trx, {
        findingId: finding.findingId,
        gapAnalysisId,
        versionId,
        enterpriseId: context.enterpriseId,
        projectId,
        subjectKey: finding.subjectKey,
        subjectType: finding.subjectType,
        customerBaselineItemRefs: finding.customerBaselineItemRefs,
        templateRefs: finding.templateRefs,
        regulatoryItemRefs: finding.regulatoryItemRefs,
        gapStatus: finding.gapStatus,
        severity: finding.severity,
        rationale: finding.rationale,
        evidenceRefs: finding.evidenceRefs,
        recommendedAction: finding.recommendedAction,
        informationRequestRefs: finding.informationRequestRefs,
        ...(finding.reviewDisposition === undefined
          ? {}
          : { reviewDisposition: finding.reviewDisposition }),
        payloadHash: digestCanonicalPayload(findingPayload).hash,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
    }
    const gapRef = gapVersionRef(context.enterpriseId, projectId, gapAnalysisId, versionId);
    const projectReference = projectRef(context.enterpriseId, projectId);
    const storedInputRef = inputSnapshotRef(
      context.enterpriseId,
      projectId,
      gapAnalysisId,
      inputSnapshotId,
      input.payloadHash,
    );
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      gapAnalysisRef: gapRef,
      projectRef: projectReference,
      inputSnapshotRef: storedInputRef,
      findingCount: validatedFixtures.findings.length,
      payloadHash: hashRef(versionDigest.hash),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'project.GapAnalysisCompleted',
      eventVersion: '1.0',
      aggregateType: 'GapAnalysis',
      aggregateId: gapAnalysisId,
      aggregateVersion: '1',
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendStartReferenceEdges(
      execution,
      gapAnalysisId,
      versionId,
      versionDigest.hash,
      context.enterpriseId,
      projectId,
      input,
      validatedFixtures.findings,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        gapAnalysisRef: gapRef,
        projectRef: projectReference,
        inputSnapshotRef: storedInputRef,
        status: 'COMPLETED',
        mode,
        versionNo: 1,
        aggregateVersion: '1',
        findingCount: validatedFixtures.findings.length,
        payloadHash: versionDigest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handleAcceptGapAnalysis(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: AcceptPayload },
): Promise<CommandResult> {
  assertHumanOnly(context, envelope, envelope.payload);
  const gap = exactProjectVersionRef(
    envelope.payload.gapAnalysisVersionRef,
    'GapAnalysis',
    context.enterpriseId,
    asReferenceLike(asReferenceLike(envelope.payload.gapAnalysisVersionRef).scope)
      .projectId as string,
    'gapAnalysisVersionRef',
  );
  const projectId = asReferenceLike(asReferenceLike(gap.ref).scope).projectId as string;
  if (envelope.targetType !== 'GapAnalysis' || envelope.targetId !== gap.objectId) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'gapAnalysisVersionRef must identify the command GapAnalysis target',
    );
  }
  if (envelope.expectedAggregateVersion === undefined) {
    throw new CommandExecutionError(
      CONCURRENCY_CONFLICT,
      'GapAnalysis acceptance requires an expected aggregate version',
    );
  }
  const reviewRef = reviewSnapshotRef(
    envelope.payload.reviewSnapshotRef,
    context.enterpriseId,
    projectId,
  );
  const justification = validateJustification(
    envelope.payload.justification,
    context.enterpriseId,
    projectId,
  );
  const disposition = enumValue(
    envelope.payload.disposition,
    ['ACCEPT', 'REJECT', 'CHANGES_REQUIRED'],
    'disposition',
  );
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'GapAnalysis',
    targetId: gap.objectId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getGapAnalysisById(execution.trx, gap.objectId);
    if (root?.enterprise_id !== context.enterpriseId || root.project_id !== projectId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_GAP_VERSION_NOT_FOUND,
        safeSummary: 'GapAnalysis root was not found in the trusted Project scope',
      };
    }
    const currentAggregateVersion = aggregateVersion(root.aggregate_version);
    if (currentAggregateVersion !== normalizedEnvelope.expectedAggregateVersion) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'GapAnalysis acceptance expected aggregate version is stale',
        currentAggregateVersion,
      };
    }
    if (root.current_version_id !== gap.versionId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_GAP_VERSION_IMMUTABLE,
        safeSummary: 'only the current GapAnalysis version can be accepted',
        currentAggregateVersion,
      };
    }
    const version = await repo.getGapAnalysisVersion(execution.trx, gap.versionId);
    if (
      version?.gap_analysis_id !== gap.objectId ||
      version.enterprise_id !== context.enterpriseId ||
      version.project_id !== projectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_GAP_VERSION_NOT_FOUND,
        safeSummary: 'gapAnalysisVersionRef does not identify the exact stored version',
        currentAggregateVersion,
      };
    }
    if (version.version_status !== 'COMPLETED' && version.version_status !== 'UNDER_REVIEW') {
      return {
        kind: 'REJECTED',
        errorCode:
          version.version_status === 'ACCEPTED'
            ? PROJECT_GAP_DECISION_CONFLICT
            : PROJECT_GAP_VERSION_IMMUTABLE,
        safeSummary: 'GapAnalysis version is not available for a first Human decision',
        currentAggregateVersion,
      };
    }
    const inputSnapshot = await repo.getGapAnalysisInputSnapshot(
      execution.trx,
      version.input_snapshot_id,
    );
    if (
      inputSnapshot?.gap_analysis_id !== root.gap_analysis_id ||
      inputSnapshot.version_id !== version.version_id ||
      inputSnapshot.enterprise_id !== context.enterpriseId ||
      inputSnapshot.project_id !== projectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_GAP_INPUT_HASH_MISMATCH,
        safeSummary: 'GapAnalysis InputSnapshot does not match the exact version',
        currentAggregateVersion,
      };
    }
    const nextStatus: GapAnalysisStatus =
      disposition === 'ACCEPT'
        ? 'ACCEPTED'
        : disposition === 'REJECT'
          ? 'REJECTED'
          : 'CHANGES_REQUIRED';
    const decisionId = newUuidV7();
    const decisionPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      gapAnalysisId: root.gap_analysis_id,
      versionId: version.version_id,
      reviewSnapshotRef: reviewRef,
      disposition,
      justification,
    } as unknown as CanonicalJsonObject;
    const decisionDigest = digestCanonicalPayload(decisionPayload);
    const cas = await repo.casGapAnalysis(
      execution.trx,
      root.gap_analysis_id,
      normalizedEnvelope.expectedAggregateVersion,
      nextStatus,
      disposition === 'ACCEPT' ? version.version_id : null,
      normalizedEnvelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'GapAnalysis acceptance lost the Root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const versionUpdated = await repo.setGapAnalysisVersionStatus(
      execution.trx,
      version.version_id,
      nextStatus,
    );
    if (!versionUpdated) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'GapAnalysis version decision lost its transition race',
      );
    }
    await repo.insertGapAnalysisDecision(execution.trx, {
      decisionId,
      gapAnalysisId: root.gap_analysis_id,
      versionId: version.version_id,
      enterpriseId: context.enterpriseId,
      projectId,
      reviewSnapshotRef: reviewRef,
      disposition,
      justification,
      payload: decisionPayload,
      payloadHash: decisionDigest.hash,
      decidedByPrincipalId: normalizedEnvelope.principalId,
      decidedByActorSnapshotId: normalizedEnvelope.actorSnapshotId,
      authorizationDecisionId: normalizedEnvelope.authorizationDecisionId,
      sourceCommandId: normalizedEnvelope.commandId,
    });
    const gapRef = gapVersionRef(
      context.enterpriseId,
      projectId,
      root.gap_analysis_id,
      version.version_id,
    );
    const projectReference = projectRef(context.enterpriseId, projectId);
    const storedInputRef = inputSnapshotRef(
      context.enterpriseId,
      projectId,
      root.gap_analysis_id,
      inputSnapshot.input_snapshot_id,
      inputSnapshot.payload_hash,
    );
    const storedDecisionRef = decisionRef(
      context.enterpriseId,
      projectId,
      decisionId,
      decisionDigest.hash,
    );
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      gapAnalysisRef: gapRef,
      projectRef: projectReference,
      inputSnapshotRef: storedInputRef,
      acceptanceDecisionRef: storedDecisionRef,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType:
        disposition === 'ACCEPT'
          ? 'project.GapAnalysisAccepted'
          : disposition === 'REJECT'
            ? 'project.GapAnalysisRejected'
            : 'project.GapAnalysisChangesRequested',
      eventVersion: '1.0',
      aggregateType: 'GapAnalysis',
      aggregateId: root.gap_analysis_id,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      root.gap_analysis_id,
      version.version_id,
      version.payload_hash,
      projectReference,
      '/decision/projectRef',
      'GAP_ANALYSIS_DECISION_PROJECT_SCOPE',
    );
    await appendReferenceFromValue(
      execution,
      root.gap_analysis_id,
      version.version_id,
      version.payload_hash,
      reviewRef,
      '/decision/reviewSnapshotRef',
      'GAP_ANALYSIS_REVIEW_SNAPSHOT',
    );
    await appendReferenceFromValue(
      execution,
      root.gap_analysis_id,
      version.version_id,
      version.payload_hash,
      storedDecisionRef,
      '/decision/decisionRef',
      'GAP_ANALYSIS_DECISION',
    );
    if (disposition === 'ACCEPT') {
      return {
        kind: 'COMMITTED',
        resultPayload: {
          gapAnalysisRef: gapRef,
          projectRef: projectReference,
          inputSnapshotRef: storedInputRef,
          acceptanceDecisionRef: storedDecisionRef,
          disposition,
          status: nextStatus,
          aggregateVersion: cas.nextVersion,
        } as unknown as CanonicalJsonObject,
      };
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        gapAnalysisRef: gapRef,
        projectRef: projectReference,
        inputSnapshotRef: storedInputRef,
        decisionRef: storedDecisionRef,
        disposition,
        status: nextStatus,
        aggregateVersion: cas.nextVersion,
      } as unknown as CanonicalJsonObject,
    };
  });
}
