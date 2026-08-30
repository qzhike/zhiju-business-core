import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import { canonicalize } from '@zhiju/shared-kernel';
import type { QualityTransactionContext } from '../persistence/quality-db.js';
import {
  QUALITY_GATE_INPUT_MISMATCH,
  QUALITY_GATE_RESULT_INVALID,
  QUALITY_GATE_REUSE_NOT_ALLOWED,
  QUALITY_GATE_STAGE_MISMATCH,
  QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  validateChangeImpactDefinition,
  validateGateResultSubmission,
  validateGateReuseSubmission,
  validateReleaseReadinessInput,
} from './quality-gate-validation.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const ARTIFACT = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const BASE_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const TARGET_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d209';
const PROFILE = '018f22e2-7c15-7b2e-8d86-2de956a9d20a';
const PROFILE_VERSION = '018f22e2-7c15-7b2e-8d86-2de956a9d20b';
const GATE_SPEC = '018f22e2-7c15-7b2e-8d86-2de956a9d20c';
const GATE_RESULT = '018f22e2-7c15-7b2e-8d86-2de956a9d20d';
const CHANGE_IMPACT = '018f22e2-7c15-7b2e-8d86-2de956a9d20e';
const INPUT_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d20f';
const PACKAGE_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d210';
const APPROVAL_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d211';
const RECIPIENT_SNAPSHOT = '018f22e2-7c15-7b2e-8d86-2de956a9d212';
const RELEASE = '018f22e2-7c15-7b2e-8d86-2de956a9d213';

const context: QualityTransactionContext = {
  kind: 'REQUEST',
  principalId: PRINCIPAL,
  principalKind: 'HUMAN',
  actorSnapshotId: ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: Buffer.alloc(32, 0x11),
  authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  policySnapshotId: '018f22e2-7c15-7b2e-8d86-2de956a9d214',
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [PROJECT],
  correlationId: CORRELATION,
};

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function revisionRef(objectId: string, byte: number): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function objectRef(objectType: string, objectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function snapshotRef(objectType: string, snapshotId: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function profileRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'quality.quality_profile',
    objectId: PROFILE,
    versionId: PROFILE_VERSION,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function gateResultSubmission(): QualityGovernance.GateResultSubmission {
  return {
    artifactRef: objectRef('artifact.artifact', ARTIFACT),
    gateTarget: { kind: 'REVISION', revisionRef: revisionRef(TARGET_REVISION, 0x21) },
    evaluationStage: 'REVISION_ACCEPTANCE',
    qualityProfileRef: profileRef(),
    gateSpecId: GATE_SPEC,
    gateVersion: '1.0.0',
    evaluationAttempt: 1,
    evaluatedScope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    inputSnapshotRef: snapshotRef('quality.gate_input', INPUT_SNAPSHOT, 0x22),
    evaluator: { evaluatorId: 'quality-service', evaluatorVersion: '1.0.0' },
    outcome: 'PASS',
    findings: [],
    evidenceRefs: [],
    startedAt: '2026-08-30T00:00:00Z',
    completedAt: '2026-08-30T00:01:00Z',
  };
}

function changeImpactDefinition(): Record<string, unknown> {
  return {
    baseRevisionRef: revisionRef(BASE_REVISION, 0x31),
    targetRevisionRef: revisionRef(TARGET_REVISION, 0x21),
    changedUnits: [{ unit: 'claims/1' }],
    unchangedUnits: [{ unit: 'claims/2' }],
    affectedClaimRefs: [],
    affectedEvidenceLinkRefs: [],
    affectedGateSpecIds: [],
    toolchainChanges: [],
    profileChanges: [],
    analysisMethod: 'structural-diff',
    analysisVersion: '1.0.0',
    analyzedBy: { principalKind: 'SERVICE', principalId: PRINCIPAL },
    analyzedAt: '2026-08-30T00:02:00Z',
    coverage: { complete: true, coveredUnits: [{ unit: 'claims/2' }] },
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected a QualityBusinessError');
  } catch (error) {
    expect(error).toBeInstanceOf(QualityBusinessError);
    expect((error as QualityBusinessError).code).toBe(code);
  }
}

describe('QualityGovernance WI-03 validation', () => {
  it('preserves exact GateResult inputs and computes a canonical payload hash', () => {
    const validated = validateGateResultSubmission(gateResultSubmission(), context);

    expect(validated.scope).toEqual({ enterpriseId: ENTERPRISE, projectId: PROJECT });
    expect(validated.revisionContentHash).toEqual(Buffer.from(hash(0x21).digest, 'hex'));
    expect(validated.payloadHash).toEqual(
      createHash('sha256').update(canonicalize(validated.definition), 'utf8').digest(),
    );
    expect('executionMode' in validated.submission).toBe(false);
  });

  it('rejects execution-mode injection and revision/release stage mixing', () => {
    expectCode(
      () =>
        validateGateResultSubmission(
          { ...gateResultSubmission(), executionMode: 'EXECUTED' },
          context,
        ),
      QUALITY_GATE_RESULT_INVALID,
    );
    expectCode(
      () =>
        validateGateResultSubmission(
          { ...gateResultSubmission(), evaluationStage: 'RELEASE_READINESS' },
          context,
        ),
      QUALITY_GATE_STAGE_MISMATCH,
    );
  });

  it('requires two distinct exact revisions for a ChangeImpact fact', () => {
    const validated = validateChangeImpactDefinition(changeImpactDefinition(), context);

    expect(validated.baseRevisionRef.objectId).toBe(BASE_REVISION);
    expect(validated.targetRevisionRef.objectId).toBe(TARGET_REVISION);
    expect(validated.payloadHash).toHaveLength(32);

    const sameRevision = changeImpactDefinition();
    sameRevision.targetRevisionRef = sameRevision.baseRevisionRef;
    expectCode(
      () => validateChangeImpactDefinition(sameRevision, context),
      QUALITY_GATE_INPUT_MISMATCH,
    );
  });

  it('accepts reuse only with exact source, impact, target, and profile references', () => {
    const validated = validateGateReuseSubmission(
      {
        newTarget: { kind: 'REVISION', revisionRef: revisionRef(TARGET_REVISION, 0x21) },
        sourceGateResultRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'quality.gate_result',
          objectId: GATE_RESULT,
          scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
          contentHash: hash(0x41),
        },
        changeImpactRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'quality.change_impact',
          objectId: CHANGE_IMPACT,
          scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
          contentHash: hash(0x42),
        },
        qualityProfileRef: profileRef(),
        gateSpecId: GATE_SPEC,
        derivedOutcome: 'PASS',
        evaluatedAt: '2026-08-30T00:03:00Z',
      },
      context,
    );

    expect(validated.reuse.derivedOutcome).toBe('PASS');
    expect(validated.reuse.sourceGateResultRef.objectType).toBe('quality.gate_result');
    expect(validated.reuse.changeImpactRef.objectType).toBe('quality.change_impact');

    expectCode(
      () =>
        validateGateReuseSubmission(
          {
            newTarget: { kind: 'REVISION', revisionRef: revisionRef(TARGET_REVISION, 0x21) },
            sourceGateResultRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'quality.gate_result_alias',
              objectId: GATE_RESULT,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
              contentHash: hash(0x41),
            },
            changeImpactRef: validated.reuse.changeImpactRef,
            qualityProfileRef: profileRef(),
            gateSpecId: GATE_SPEC,
            derivedOutcome: 'PASS',
            evaluatedAt: '2026-08-30T00:03:00Z',
          },
          context,
        ),
      QUALITY_GATE_INPUT_MISMATCH,
    );
  });

  it('requires a non-empty destination set for release readiness input', () => {
    const base = {
      releasePackageRef: {
        releaseRef: objectRef('release.release', RELEASE),
        packageSnapshotRef: snapshotRef('release.package_snapshot', PACKAGE_SNAPSHOT, 0x51),
        packageHash: hash(0x52),
      },
      approvalBundleSnapshotRef: snapshotRef(
        'quality.approval_bundle_snapshot',
        APPROVAL_SNAPSHOT,
        0x53,
      ),
      recipientScopeSnapshotRef: snapshotRef(
        'release.recipient_scope_snapshot',
        RECIPIENT_SNAPSHOT,
        0x54,
      ),
      releaseGateResultRefs: [],
      evaluatedAt: '2026-08-30T00:04:00Z',
    };
    expectCode(
      () => validateReleaseReadinessInput({ ...base, destinationRefs: [] }, context),
      QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
    );

    const validated = validateReleaseReadinessInput(
      {
        ...base,
        destinationRefs: [
          {
            system: 'feishu',
            resourceType: 'tenant',
            externalId: 'tenant-1',
            observedAt: '2026-08-30T00:04:00Z',
          },
        ],
      },
      context,
    );
    expect(validated.destinationRefs).toHaveLength(1);
  });

  it('uses the dedicated reuse error namespace for invalid reuse outcomes', () => {
    expectCode(
      () =>
        validateGateReuseSubmission(
          {
            newTarget: { kind: 'REVISION', revisionRef: revisionRef(TARGET_REVISION, 0x21) },
            sourceGateResultRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'quality.gate_result',
              objectId: GATE_RESULT,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
              contentHash: hash(0x41),
            },
            changeImpactRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'quality.change_impact',
              objectId: CHANGE_IMPACT,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
              contentHash: hash(0x42),
            },
            qualityProfileRef: profileRef(),
            gateSpecId: GATE_SPEC,
            derivedOutcome: 'UNKNOWN',
            evaluatedAt: '2026-08-30T00:03:00Z',
          },
          context,
        ),
      QUALITY_GATE_REUSE_NOT_ALLOWED,
    );
  });
});
