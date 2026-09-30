import type { Kysely } from 'kysely';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  handleCreateQualityProfileDraft,
  handleActivateQualityProfile,
  handleRecordGateResult,
  handleEvaluateRevisionReadiness,
  handleRequestApproval,
  handleSubmitApprovalDecision,
  handleInvalidateGateResult,
  handleRevokeApproval,
  withQualityGovernanceTransaction,
  type QualityGovernanceDb,
  type QualityTransactionContext,
  type QualityCommandEnvelope,
  type CommandResult,
} from '@zhiju/quality-governance';

/** Production Quality commands supply the optional Task Completion criteria. */
export function formalQualityFixture(
  db: Kysely<QualityGovernanceDb>,
  author: QualityTransactionContext,
  now: () => Date,
) {
  const scope = { enterpriseId: author.enterpriseId, projectId: author.allowedProjectIds[0] };
  const hash = {
    algorithm: 'SHA-256' as const,
    canonicalizationVersion: '1' as const,
    digest: 'a'.repeat(64),
  };
  function snapshot(type: string, enterpriseOnly = false): Common.SnapshotRef {
    const id = newUuidV7();
    return {
      kind: 'SNAPSHOT',
      objectType: type,
      objectId: id,
      snapshotId: id,
      scope: enterpriseOnly ? { enterpriseId: scope.enterpriseId } : scope,
      contentHash: hash,
    };
  }
  function content(type: string): Common.ContentAddressedRef {
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: type,
      objectId: newUuidV7(),
      scope,
      contentHash: hash,
    };
  }
  function envelope<P extends object>(
    ctx: QualityTransactionContext,
    targetType: string,
    targetId: string,
    payload: P,
    expectedAggregateVersion?: string,
  ): QualityCommandEnvelope<P> {
    return {
      commandId: newUuidV7(),
      commandType: `quality.${targetType}`,
      commandVersion: '1.0',
      idempotencyScope: 'im06.formal.quality',
      idempotencyKey: newUuidV7(),
      requestPayload: payload as unknown as CanonicalJsonObject,
      payload,
      enterpriseId: ctx.enterpriseId,
      ...(targetType === 'quality.quality_profile' ? {} : { projectId: scope.projectId }),
      targetType,
      targetId,
      correlationId: ctx.correlationId,
      principalId: ctx.principalId,
      principalKind: ctx.principalKind,
      actorSnapshotId: ctx.actorSnapshotId,
      authorizationDecisionId: ctx.authorizationDecisionId,
      policySnapshotId: ctx.policySnapshotId,
      ...(expectedAggregateVersion ? { expectedAggregateVersion } : {}),
    };
  }
  function committed(result: CommandResult) {
    if (result.status !== 'COMMITTED')
      throw new Error(`Quality fixture command failed: ${JSON.stringify(result)}`);
    return result.resultPayload;
  }
  async function createProfile() {
    const profileId = newUuidV7(),
      gateId = newUuidV7();
    const draft = committed(
      await handleCreateQualityProfileDraft(
        db,
        author,
        envelope(author, 'quality.quality_profile', profileId, {
          definition: {
            name: `Formal output ${profileId}`,
            profileVersion: '1.0.0',
            applicableArtifactTypes: ['artifact.control_procedure'],
            riskApplicability: { riskLevels: ['MEDIUM'] },
            gateSpecs: [
              {
                gateSpecId: gateId,
                gateType: 'STRUCTURAL_SCHEMA',
                gateVersion: '1.0.0',
                evaluationStage: 'REVISION_ACCEPTANCE',
                mandatory: true,
                applicabilityRule: { kind: 'always' },
                inputContract: { objectType: 'ArtifactRevision' },
                evaluatorPolicy: { principalKind: 'SERVICE' },
                passCriteria: { outcome: 'PASS' },
                failureSeverity: 'MAJOR',
                blockingRule: { outcomes: ['FAIL', 'ERROR'] },
                dependencyGateSpecIds: [],
                rerunRule: { onChange: 'IMPACT_ANALYSIS' },
                resultRetentionRule: { retain: 'regulated' },
              },
            ],
            gateDependencies: [],
            rerunPolicy: { allowImpactReuse: true, reusableOutcomes: ['PASS'] },
            issuePolicy: { blockingLevels: ['CRITICAL', 'MAJOR'] },
            separationOfDutiesPolicy: { authorMayReviewOwnWork: false },
            approvalRequirements: [
              { requiredRole: 'quality.reviewer', requiredCount: 1, approverKind: 'HUMAN' },
            ],
            releaseRequirements: [
              {
                purpose: 'formal_release',
                formats: ['DOCX'],
                recipientScope: { enterpriseId: scope.enterpriseId },
                validity: { validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' },
                receiptRequired: true,
              },
            ],
          },
        }),
      ),
    );
    const profileRef = draft.qualityProfileRef as unknown as Common.VersionedRef;
    committed(
      await handleActivateQualityProfile(
        db,
        author,
        envelope(
          author,
          'quality.quality_profile',
          profileId,
          {
            profileVersionRef: profileRef,
            reviewSnapshotRef: snapshot('quality.quality_profile_review', true),
            validationSnapshotRef: snapshot('quality.quality_profile_validation', true),
            activatedAt: now().toISOString(),
          },
          '1',
        ),
      ),
    );
    const requirement = await withQualityGovernanceTransaction(db, author, (trx) =>
      trx
        .selectFrom('quality_governance.quality_profile_approval_requirement')
        .selectAll()
        .where('profile_version_id', '=', profileRef.versionId)
        .executeTakeFirst(),
    );
    if (!requirement) throw new Error('No persisted approval requirement');
    return { profileRef, gateId, approvalRequirementId: requirement.approval_requirement_id };
  }
  async function accept(
    profile: Awaited<ReturnType<typeof createProfile>>,
    artifactRef: Common.ObjectRef,
    revisionRef: Common.ContentAddressedRef,
    attempt = 1,
  ) {
    const at = now().toISOString();
    const gate = committed(
      await handleRecordGateResult(
        db,
        author,
        envelope(author, 'quality.gate_result', newUuidV7(), {
          submission: {
            artifactRef,
            gateTarget: { kind: 'REVISION', revisionRef },
            evaluationStage: 'REVISION_ACCEPTANCE',
            qualityProfileRef: profile.profileRef,
            gateSpecId: profile.gateId,
            gateVersion: '1.0.0',
            evaluationAttempt: attempt,
            evaluatedScope: scope,
            inputSnapshotRef: snapshot('quality.gate_input'),
            evaluator: { evaluatorId: 'synthetic_gate', evaluatorVersion: '1.0.0' },
            outcome: 'PASS',
            findings: [],
            evidenceRefs: [],
            startedAt: at,
            completedAt: at,
          } as QualityGovernance.GateResultSubmission,
        }),
      ),
    );
    const gateRef = gate.gateResultRef as unknown as Common.ContentAddressedRef;
    const readiness = committed(
      await handleEvaluateRevisionReadiness(
        db,
        author,
        envelope(author, 'quality.revision_acceptance_snapshot', newUuidV7(), {
          revisionRef,
          qualityProfileRef: profile.profileRef,
          gateResultRefs: [gateRef],
          evidenceStatusSnapshotRef: snapshot('quality.evidence_status_snapshot'),
          issueSnapshotRef: snapshot('quality.issue_snapshot'),
          evaluatorVersions: [{ evaluatorId: 'synthetic_readiness', evaluatorVersion: '1.0.0' }],
          evaluatedAt: at,
        }),
      ),
    );
    return { gateRef, acceptanceRef: readiness.snapshotRef as unknown as Common.SnapshotRef };
  }
  async function approve(
    profile: Awaited<ReturnType<typeof createProfile>>,
    artifactRef: Common.ObjectRef,
    revisionRef: Common.ContentAddressedRef,
    acceptanceRef: Common.SnapshotRef,
    approver: QualityTransactionContext,
  ) {
    const requestId = newUuidV7();
    const request = committed(
      await handleRequestApproval(
        db,
        author,
        envelope(author, 'quality.approval_request', requestId, {
          definition: {
            artifactRef,
            revisionRef,
            revisionAcceptanceSnapshotRef: acceptanceRef,
            qualityProfileRef: profile.profileRef,
            approvalRequirementId: profile.approvalRequirementId,
            requestedApproverRole: 'quality.reviewer',
            expiresAt: new Date(now().getTime() + 3600_000).toISOString(),
            requestNonceHash: { ...hash, digest: sha256CanonicalJson({ requestId }) },
          },
        }),
      ),
    );
    const approval = committed(
      await handleSubmitApprovalDecision(
        db,
        approver,
        envelope(approver, 'quality.approval_request', requestId, {
          submission: {
            requestRef: request.requestRef as unknown as Common.ObjectRef,
            revisionRef,
            revisionAcceptanceSnapshotRef: acceptanceRef,
            approvalRequirementId: profile.approvalRequirementId,
            decision: 'APPROVED',
            decisionComment: 'Independent Human approval for the controlled acceptance fixture.',
            approverHumanPrincipalRef: {
              principalKind: 'HUMAN',
              principalId: approver.principalId,
            },
            approverRoleSnapshotRef: snapshot('identity.role_assignment'),
            authorizationDecisionRef: content('identity.authorization_decision'),
            separationCheckRef: content('quality.separation_check'),
            decidedAt: now().toISOString(),
          },
        }),
      ),
    );
    return {
      approvalRef: approval.approvalRef as unknown as Common.ContentAddressedRef,
      bundleRef: approval.approvalBundleSnapshotRef as unknown as Common.SnapshotRef,
    };
  }
  return {
    createProfile,
    accept,
    approve,
    async supersedeProfile(profileRef: Common.VersionedRef) {
      const prior = await withQualityGovernanceTransaction(db, author, (trx) =>
        trx
          .selectFrom('quality_governance.quality_profile_version')
          .select('definition')
          .where('profile_version_id', '=', profileRef.versionId)
          .executeTakeFirstOrThrow(),
      );
      const draft = committed(
        await handleCreateQualityProfileDraft(
          db,
          author,
          envelope(
            author,
            'quality.quality_profile',
            profileRef.objectId,
            {
              definition: {
                ...(prior.definition as CanonicalJsonObject),
                profileVersion: '2.0.0',
              } as unknown as QualityGovernance.QualityProfileDefinition,
            },
            '2',
          ),
        ),
      );
      const successor = draft.qualityProfileRef as unknown as Common.VersionedRef;
      committed(
        await handleActivateQualityProfile(
          db,
          author,
          envelope(
            author,
            'quality.quality_profile',
            profileRef.objectId,
            {
              profileVersionRef: successor,
              reviewSnapshotRef: snapshot('quality.quality_profile_review', true),
              validationSnapshotRef: snapshot('quality.quality_profile_validation', true),
              activatedAt: now().toISOString(),
            },
            '3',
          ),
        ),
      );
      return successor;
    },
    async invalidate(gateRef: Common.ContentAddressedRef) {
      return handleInvalidateGateResult(
        db,
        author,
        envelope(author, 'quality.gate_result', gateRef.objectId, {
          impactAssessmentRef: content('quality.impact_assessment'),
          invalidationReason: {
            reasonCode: 'FORMAL_OUTPUT_CHANGE',
            summary: 'Actual gate invalidation for current Completion consumption.',
            evidenceRefs: [],
          },
          invalidatedAt: now().toISOString(),
        }),
      );
    },
    async revoke(approvalRef: Common.ContentAddressedRef) {
      return handleRevokeApproval(
        db,
        author,
        envelope(
          author,
          'quality.approval',
          approvalRef.objectId,
          {
            impactAssessmentRef: content('quality.impact_assessment'),
            revocationReason: {
              reasonCode: 'FORMAL_OUTPUT_CHANGE',
              summary: 'Actual approval revocation for current Completion consumption.',
              evidenceRefs: [],
            },
            revokedAt: now().toISOString(),
          },
          '1',
        ),
      );
    },
  };
}
