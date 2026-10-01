// Legitimate owning baseline/Gap/Plan setup for #239. No business-table writes.
import * as ep from '@zhiju/enterprise-project';
import type { Kysely } from 'kysely';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
type Ref = CanonicalJsonObject;
const record = (v: unknown) => v as Ref;
const hash = (v: Ref) => ({
  algorithm: 'SHA-256',
  canonicalizationVersion: '1',
  digest: ep.digestCanonicalPayload(v).hash.toString('hex'),
});
function committed(result: ep.CommandResult) {
  if (result.status !== 'COMMITTED') throw new Error(JSON.stringify(result));
  return record(result.resultPayload);
}
const planInputs = new Map<
  string,
  {
    baselineRef: Ref;
    templateBaseline: Ref;
    regProfile: Ref;
    qmsRef: Ref;
    productScopeRef: Ref;
    gapRef: Ref;
    findingId: string;
  }
>();
export async function createDeliveryCompletionPlanFixture(
  db: Kysely<ep.EnterpriseProjectDb>,
  context: ep.EnterpriseProjectTransactionContext,
  taskId: string,
  requireRelease: boolean,
  now: () => Date,
  authorize: (type: string, payload: Ref) => Promise<ep.EnterpriseProjectTransactionContext>,
  additionalTaskIds: readonly string[] = [],
) {
  context = { ...context };
  const scope = {
    enterpriseId: context.enterpriseId,
    projectId:
      context.allowedProjectIds[0] ??
      (() => {
        throw new Error('Project required');
      })(),
  };
  const ref = (
    kind: string,
    type: string,
    id: string = newUuidV7(),
    version: string = newUuidV7(),
    s: Ref = scope,
  ): Ref => ({
    kind,
    objectType: type,
    objectId: id,
    scope: s,
    ...(kind === 'VERSIONED' ? { versionId: version } : {}),
    ...(kind === 'SNAPSHOT' ? { snapshotId: id, contentHash: hash({ id }) } : {}),
  });
  const policy = ref('VERSIONED', 'Policy');
  const justification = {
    reasonCode: 'DELIVERY_COMPLETION_FIXTURE',
    summary: 'Controlled owning delivery fixture',
    evidenceRefs: [],
    assumptions: [],
    riskNotes: [],
  };
  async function command<T extends object>(
    type: string,
    targetType: string,
    targetId: string,
    payload: T,
    expected?: string,
    platform = false,
  ): Promise<ep.CommandEnvelope & { payload: T }> {
    if (!platform) Object.assign(context, await authorize(type, payload as unknown as Ref));
    return {
      commandId: newUuidV7(),
      commandType: type,
      commandVersion: '1.0',
      idempotencyScope: `${scope.enterpriseId}:${scope.projectId}:${targetId}:${type}`,
      idempotencyKey: newUuidV7(),
      requestPayload: payload as unknown as Ref,
      payload,
      enterpriseId: platform ? ep.PLATFORM_CONTROL_SCOPE_ID : context.enterpriseId,
      ...(!platform ? { projectId: scope.projectId } : {}),
      targetType,
      targetId,
      ...(expected ? { expectedAggregateVersion: expected } : {}),
      correlationId: context.correlationId,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
      ...(platform ? { platform: true } : {}),
    };
  }
  const prepareInputs = async () => {
    // The Project's start snapshot was itself created through owning entries.
    const start = await ep.withEnterpriseProjectTransaction(db, context, async (trx) => {
      const b = await trx
        .selectFrom('enterprise_project.project_snapshot_binding')
        .selectAll()
        .where('project_id', '=', scope.projectId)
        .where('binding_purpose', '=', 'PROJECT_START')
        .executeTakeFirstOrThrow();
      return {
        productScopeSnapshotRef: b.product_scope_snapshot_ref,
        enterpriseProfileSnapshotRef: b.enterprise_profile_snapshot_ref,
        qmsConfigurationRef: b.qms_configuration_ref,
      };
    });
    const productScopeRef = await ep.withEnterpriseProjectTransaction(db, context, async (trx) => {
      const stored = record(start.productScopeSnapshotRef);
      const row = await trx
        .selectFrom('enterprise_project.product_scope_snapshot')
        .selectAll()
        .where('snapshot_id', '=', stored.snapshotId as string)
        .executeTakeFirstOrThrow();
      return { ...stored, objectId: row.product_id };
    });
    const profileRef = record(start.enterpriseProfileSnapshotRef),
      qmsRef = record(start.qmsConfigurationRef);
    const baselineId = newUuidV7(),
      expectationId = newUuidV7();
    const baseline = committed(
      await ep.handleCreateCustomerBaselineDraft(
        db,
        context,
        await command('project.create_customer_baseline_draft', 'CustomerBaseline', baselineId, {
          projectRef: ref('OBJECT', 'Project', scope.projectId),
          expectations: [
            {
              expectationId,
              expectedMaterialKey: 'delivery.input',
              materialType: 'quality.procedure',
              expectedTitleOrRole: 'Controlled expected input',
              status: 'UNKNOWN',
              customerMaterialRefs: [],
              reason: justification,
            },
          ],
          baselinePolicyRef: policy,
        } as unknown as EnterpriseProject.ProjectCreateCustomerBaselineDraftPayload),
      ),
    );
    const baselineRef = record(baseline.customerBaselineRef);
    committed(
      await ep.handleActivateCustomerBaselineVersion(
        db,
        context,
        await command(
          'project.activate_customer_baseline_version',
          'CustomerBaseline',
          baselineId,
          {
            baselineVersionRef: baselineRef,
            reviewSnapshotRef: ref('SNAPSHOT', 'BaselineReview'),
            impactPolicyRef: policy,
            justification,
          } as unknown as EnterpriseProject.ProjectActivateCustomerBaselineVersionPayload,
          '1',
        ),
      ),
    );
    const platformContext: ep.EnterpriseProjectTransactionContext = {
      ...context,
      enterpriseId: ep.PLATFORM_CONTROL_SCOPE_ID,
      allowedProjectIds: [],
      platformReferenceCapabilities: ['PLATFORM_REFERENCE_ADMIN', 'PLATFORM_REFERENCE_PUBLISHER'],
    };
    const templateId = newUuidV7(),
      templateVersion = newUuidV7(),
      regId = newUuidV7(),
      regVersion = newUuidV7();
    const templateContent = { title: 'Controlled template' },
      regContent = { citation: 'Controlled fixture regulation' };
    const contentRef = (type: string, id: string, b: Ref) => ({
      kind: 'CONTENT_ADDRESSED',
      objectType: type,
      objectId: id,
      scope: {},
      contentHash: hash(b),
    });
    const template = committed(
      await ep.handlePlatformTemplateImportVersion(
        db,
        platformContext,
        await command(
          'enterprise_project.platform_template_import_version',
          'ReferenceTemplate',
          templateId,
          {
            referenceTemplateId: templateId,
            referenceCode: `DEL-${templateId}`,
            templateType: 'CONTROL_PROCEDURE',
            versionId: templateVersion,
            versionLabel: '1.0',
            contentRef: contentRef('TemplateContent', newUuidV7(), templateContent),
            contentHash: hash(templateContent),
            sourceRef: { sourceSystem: 'controlled_fixture', sourceLocator: 'delivery/template' },
            applicability: { jurisdiction: 'CN' },
          },
          undefined,
          true,
        ),
      ),
    );
    committed(
      await ep.handlePlatformTemplatePublishVersion(
        db,
        platformContext,
        await command(
          'enterprise_project.platform_template_publish_version',
          'ReferenceTemplate',
          templateId,
          {
            referenceTemplateId: templateId,
            versionId: templateVersion,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'CONTROLLED_FIXTURE' },
          },
          '1',
          true,
        ),
      ),
    );
    const regulatory = committed(
      await ep.handlePlatformRegulatoryImportVersion(
        db,
        platformContext,
        await command(
          'enterprise_project.platform_regulatory_import_version',
          'RegulatoryReference',
          regId,
          {
            regulatoryReferenceId: regId,
            authorityCode: 'CONTROLLED',
            jurisdiction: 'CN',
            referenceCode: `DEL-${regId}`,
            versionId: regVersion,
            versionLabel: '1.0',
            citation: 'Controlled fixture regulation',
            effectivePeriod: { validFrom: '2026-01-01T00:00:00Z' },
            sourceRef: { sourceSystem: 'controlled_fixture', sourceLocator: 'delivery/regulation' },
            contentRef: contentRef('RegulatoryContent', newUuidV7(), regContent),
            contentHash: hash(regContent),
            verificationRefs: [
              contentRef('RegulatoryVerification', newUuidV7(), { verified: true }),
            ],
          },
          undefined,
          true,
        ),
      ),
    );
    committed(
      await ep.handlePlatformRegulatoryPublishVersion(
        db,
        platformContext,
        await command(
          'enterprise_project.platform_regulatory_publish_version',
          'RegulatoryReference',
          regId,
          {
            regulatoryReferenceId: regId,
            versionId: regVersion,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'CONTROLLED_FIXTURE' },
          },
          '1',
          true,
        ),
      ),
    );
    const templateBaseline = ref('VERSIONED', 'TemplateBaseline'),
      regProfile = ref('VERSIONED', 'RegulatoryProfile');
    committed(
      await ep.handleFreezeTemplateBaseline(
        db,
        context,
        await command(
          'project.freeze_template_baseline',
          'TemplateBaseline',
          templateBaseline.objectId as string,
          {
            templateBaselineVersionRef: templateBaseline,
            selections: [
              {
                deliveryCategory: 'CONTROL_PROCEDURE',
                templateRef: {
                  ...record(template.referenceTemplateVersionRef),
                  objectType: 'TemplateVersion',
                  objectId: templateId,
                  immutableVersionId: templateVersion,
                },
                applicabilityScope: { jurisdiction: 'CN' },
                selectionReason: justification,
              },
            ],
            reviewSnapshotRef: ref('SNAPSHOT', 'TemplateReview'),
            selectionRationale: justification,
          } as unknown as EnterpriseProject.ProjectFreezeTemplateBaselinePayload,
        ),
      ),
    );
    committed(
      await ep.handleActivateRegulatoryProfile(
        db,
        context,
        await command(
          'project.activate_regulatory_profile',
          'RegulatoryProfile',
          regProfile.objectId as string,
          {
            regulatoryProfileVersionRef: regProfile,
            jurisdiction: 'CN',
            productScopeSnapshotRef: productScopeRef,
            applicabilityItems: [
              {
                regulatoryReferenceRef: {
                  ...record(regulatory.regulatoryReferenceVersionRef),
                  objectType: 'RegulatoryReferenceVersion',
                  objectId: regId,
                  immutableVersionId: regVersion,
                },
                applicability: 'APPLICABLE',
                rationale: justification,
                evidenceRefs: [
                  {
                    evidence: {
                      ...contentRef('controlled.fixture_evidence', newUuidV7(), regContent),
                      scope,
                    },
                    relation: 'SUPPORTS',
                  },
                ],
                riskLevel: 'LOW',
              },
            ],
            reviewSnapshotRef: ref('SNAPSHOT', 'RegulatoryReview'),
          } as unknown as EnterpriseProject.ProjectActivateRegulatoryProfilePayload,
        ),
      ),
    );
    const gapId = newUuidV7(),
      findingId = newUuidV7();
    const gap = committed(
      await ep.handleStartGapAnalysis(
        db,
        context,
        await command('project.start_gap_analysis', 'GapAnalysis', gapId, {
          projectRef: ref('OBJECT', 'Project', scope.projectId),
          inputSnapshot: {
            customerBaselineRef: baselineRef,
            templateBaselineRef: templateBaseline,
            regulatoryProfileRef: regProfile,
            enterpriseProfileSnapshotRef: profileRef,
            qmsConfigurationRef: qmsRef,
            productScopeSnapshotRef: productScopeRef,
            analysisPolicyRef: policy,
          },
          mode: 'FORMAL',
          requestedScope: {
            evaluator: 'controlled-fixture-v1',
            findings: [
              {
                findingId,
                subjectKey: 'delivery.output',
                subjectType: 'ControlRequirement',
                customerBaselineItemRefs: [
                  ref(
                    'VERSIONED',
                    'CustomerBaselineItem',
                    expectationId,
                    baselineRef.versionId as string,
                  ),
                ],
                templateRefs: [],
                regulatoryItemRefs: [],
                gapStatus: 'UNKNOWN',
                severity: 'MEDIUM',
                rationale: { reasonCode: 'CONTROLLED_FIXTURE' },
                evidenceRefs: [],
                recommendedAction: 'NEED_INFORMATION',
                informationRequestRefs: [ref('VERSIONED', 'InformationRequest')],
              },
            ],
          },
        } as unknown as EnterpriseProject.ProjectStartGapAnalysisPayload),
      ),
    );
    const gapRef = record(gap.gapAnalysisRef);
    committed(
      await ep.handleAcceptGapAnalysis(
        db,
        context,
        await command(
          'project.accept_gap_analysis',
          'GapAnalysis',
          gapId,
          {
            gapAnalysisVersionRef: gapRef,
            reviewSnapshotRef: ref('SNAPSHOT', 'GapReview'),
            disposition: 'ACCEPT',
            justification,
          } as unknown as EnterpriseProject.ProjectAcceptGapAnalysisPayload,
          '1',
        ),
      ),
    );
    return {
      baselineRef,
      templateBaseline,
      regProfile,
      qmsRef,
      productScopeRef,
      gapRef,
      findingId,
    };
  };
  const key = `${scope.enterpriseId}:${scope.projectId}`;
  const inputs = planInputs.get(key) ?? (await prepareInputs());
  planInputs.set(key, inputs);
  const { baselineRef, templateBaseline, regProfile, qmsRef, productScopeRef, gapRef, findingId } =
    inputs;
  const planId = newUuidV7(),
    releaseRef = ref('OBJECT', 'release.release');
  const taskItems = [taskId, ...additionalTaskIds].map((id) => ({
    itemId: newUuidV7(),
    completionCriteria: {
      profile: 'ep.delivery_item.exact_task_completion@1.0',
      allOf: [
        {
          eventType: 'execution.TaskCompleted',
          taskRef: ref('OBJECT', 'zhiju.execution.task', id),
        },
        ...(requireRelease ? [{ eventType: 'release.ReleaseCompleted', factRef: releaseRef }] : []),
      ],
    },
  }));
  const firstItem = taskItems[0];
  if (!firstItem) throw new Error('At least one Task Item required');
  const { itemId, completionCriteria } = firstItem;
  const draft = committed(
    await ep.handleCreateDeliveryPlanDraft(
      db,
      context,
      await command('project.create_delivery_plan_draft', 'DeliveryPlan', planId, {
        projectRef: ref('OBJECT', 'Project', scope.projectId),
        acceptedGapAnalysisRef: gapRef,
        baselineRefs: [baselineRef, templateBaseline, regProfile, qmsRef, productScopeRef],
        items: taskItems.map(({ itemId, completionCriteria }, index) => ({
          itemId,
          itemKey: index === 0 ? 'controlled-output' : `controlled-output-${index}`,
          itemType: 'CONTROL_PROCEDURE',
          title: 'Controlled output',
          objective: 'Completion delivery acceptance',
          sourceGapItemRefs: [ref('VERSIONED', 'GapItem', findingId, gapRef.versionId as string)],
          dependencyItemIds: [],
          targetArtifactTypes: ['artifact.artifact_revision'],
          qualityProfileRef: ref('VERSIONED', 'QualityProfile'),
          completionCriteria,
          commitmentStatus: 'PROPOSED',
        })),
        assumptions: [],
        exclusions: [],
        planQualityPolicyRef: policy,
      } as unknown as EnterpriseProject.ProjectCreateDeliveryPlanDraftPayload),
    ),
  );
  const planRef = record(draft.deliveryPlanRef);
  const approval = committed(
    await ep.handleApproveDeliveryPlan(
      db,
      context,
      await command(
        'project.approve_delivery_plan',
        'DeliveryPlan',
        planId,
        {
          deliveryPlanVersionRef: planRef,
          reviewSnapshotRef: ref('SNAPSHOT', 'DeliveryPlanReview'),
          decision: 'APPROVE',
          justification,
        } as unknown as EnterpriseProject.ProjectApproveDeliveryPlanPayload,
        '1',
      ),
    ),
  );
  committed(
    await ep.handleActivateDeliveryPlan(
      db,
      context,
      await command(
        'project.activate_delivery_plan',
        'DeliveryPlan',
        planId,
        {
          deliveryPlanVersionRef: planRef,
          approvalDecisionRef: approval.approvalDecisionRef,
          activatedAt: now().toISOString(),
          impactPolicyRef: policy,
        } as unknown as EnterpriseProject.ProjectActivateDeliveryPlanPayload,
        '2',
      ),
    ),
  );
  return {
    deliveryPlanRef: {
      ...planRef,
      objectType: 'zhiju.project.delivery_plan',
    } as unknown as Common.VersionedRef,
    deliveryItemRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.project.delivery_item',
      objectId: itemId,
      versionId: planRef.versionId as string,
      scope,
    } as Common.VersionedRef,
    completionCriteria,
    releaseRef,
    additionalItems: taskItems.slice(1).map((item) => ({
      completionCriteria: item.completionCriteria,
      deliveryItemRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.project.delivery_item',
        objectId: item.itemId,
        versionId: planRef.versionId as string,
        scope,
      } satisfies Common.VersionedRef,
    })),
  };
}
