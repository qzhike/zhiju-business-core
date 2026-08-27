// IM-03 WI-11 (issue #67): shared authoritative active-pointer reader.
// Every caller receives the exact Project Root pointer and never resolves a
// latest/current version by ordering or label.

import type { Common, EnterpriseProject } from '@zhiju/contracts';
import { DeliveryPlanRepository } from '../persistence/delivery-plan-repository.js';
import type {
  DeliveryPlanTable,
  GapAnalysisTable,
} from '../persistence/enterprise-business-types.js';
import type { EnterpriseProjectTransaction } from '../persistence/enterprise-db.js';
import { TemplateRegulatoryRepository } from '../persistence/template-regulatory-repository.js';
import {
  EnterpriseBusinessError,
  PROJECT_BASELINE_STATUS_INVALID,
} from './enterprise-business-errors.js';

function versionedRef(
  objectType: string,
  objectId: string,
  versionId: string,
  enterpriseId: string,
  projectId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function aggregateVersion(value: unknown): string {
  return String(value);
}

export async function loadActiveBaselineRefs(
  trx: EnterpriseProjectTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<EnterpriseProject.ActiveBaselineRefsView> {
  const repo = new DeliveryPlanRepository();
  const templateRepo = new TemplateRegulatoryRepository();
  const customerRoot = await repo.getCustomerBaselineByProject(trx, enterpriseId, projectId);
  const templateRoot = await templateRepo.getTemplateBaselineByProject(
    trx,
    enterpriseId,
    projectId,
  );
  const regulatoryRoot = await templateRepo.getRegulatoryProfileByProject(
    trx,
    enterpriseId,
    projectId,
  );
  const gapRoot = (await trx
    .selectFrom('enterprise_project.gap_analysis')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .executeTakeFirst()) as unknown as GapAnalysisTable | undefined;
  const deliveryRoot = (await trx
    .selectFrom('enterprise_project.delivery_plan')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .executeTakeFirst()) as unknown as DeliveryPlanTable | undefined;

  const result: {
    customerBaselineRef?: Common.VersionedRef;
    templateBaselineRef?: Common.VersionedRef;
    regulatoryProfileRef?: Common.VersionedRef;
    gapAnalysisRef?: Common.VersionedRef;
    deliveryPlanRef?: Common.VersionedRef;
  } = {};
  const aggregateVersions: Record<string, string> = {};

  if (customerRoot?.active_version_id !== null && customerRoot !== undefined) {
    const active = await repo.getCustomerBaselineVersion(trx, customerRoot.active_version_id);
    if (
      active?.customer_baseline_id !== customerRoot.customer_baseline_id ||
      active.enterprise_id !== enterpriseId ||
      active.project_id !== projectId ||
      active.version_status !== 'CONFIRMED'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'active CustomerBaseline pointer does not resolve to a confirmed version',
      );
    }
    result.customerBaselineRef = versionedRef(
      'CustomerBaseline',
      customerRoot.customer_baseline_id,
      active.version_id,
      enterpriseId,
      projectId,
    );
    aggregateVersions.customerBaseline = aggregateVersion(customerRoot.aggregate_version);
    aggregateVersions.customerBaselineVersion = String(active.version_no);
  }

  if (templateRoot !== undefined) {
    const active = await templateRepo.getTemplateBaselineVersion(
      trx,
      templateRoot.active_version_id,
    );
    const activeVersionStatus: unknown = active?.version_status;
    if (
      active?.template_baseline_id !== templateRoot.template_baseline_id ||
      active.enterprise_id !== enterpriseId ||
      active.project_id !== projectId ||
      activeVersionStatus !== 'FROZEN'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'active TemplateBaseline pointer does not resolve to a frozen version',
      );
    }
    result.templateBaselineRef = versionedRef(
      'TemplateBaseline',
      templateRoot.template_baseline_id,
      active.version_id,
      enterpriseId,
      projectId,
    );
    aggregateVersions.templateBaseline = aggregateVersion(templateRoot.aggregate_version);
    aggregateVersions.templateBaselineVersion = String(active.version_no);
  }

  if (regulatoryRoot !== undefined) {
    const active = await templateRepo.getRegulatoryProfileVersion(
      trx,
      regulatoryRoot.active_version_id,
    );
    const activeVersionStatus: unknown = active?.version_status;
    if (
      active?.regulatory_profile_id !== regulatoryRoot.regulatory_profile_id ||
      active.enterprise_id !== enterpriseId ||
      active.project_id !== projectId ||
      activeVersionStatus !== 'FROZEN'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'active RegulatoryProfile pointer does not resolve to a frozen version',
      );
    }
    result.regulatoryProfileRef = versionedRef(
      'RegulatoryProfile',
      regulatoryRoot.regulatory_profile_id,
      active.version_id,
      enterpriseId,
      projectId,
    );
    aggregateVersions.regulatoryProfile = aggregateVersion(regulatoryRoot.aggregate_version);
    aggregateVersions.regulatoryProfileVersion = String(active.version_no);
  }

  if (gapRoot?.accepted_version_id !== null && gapRoot !== undefined) {
    const accepted = await repo.getGapAnalysisVersion(trx, gapRoot.accepted_version_id);
    if (
      accepted?.gap_analysis_id !== gapRoot.gap_analysis_id ||
      accepted.enterprise_id !== enterpriseId ||
      accepted.project_id !== projectId ||
      accepted.version_status !== 'ACCEPTED'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'accepted GapAnalysis pointer does not resolve to an accepted version',
      );
    }
    result.gapAnalysisRef = versionedRef(
      'GapAnalysis',
      gapRoot.gap_analysis_id,
      accepted.version_id,
      enterpriseId,
      projectId,
    );
    aggregateVersions.gapAnalysis = aggregateVersion(gapRoot.aggregate_version);
    aggregateVersions.gapAnalysisVersion = String(accepted.version_no);
  }

  if (deliveryRoot?.active_version_id !== null && deliveryRoot !== undefined) {
    const active = await repo.getDeliveryPlanVersion(trx, deliveryRoot.active_version_id);
    if (
      active?.delivery_plan_id !== deliveryRoot.delivery_plan_id ||
      active.enterprise_id !== enterpriseId ||
      active.project_id !== projectId ||
      active.version_status !== 'ACTIVE'
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'active DeliveryPlan pointer does not resolve to an active version',
      );
    }
    result.deliveryPlanRef = versionedRef(
      'DeliveryPlan',
      deliveryRoot.delivery_plan_id,
      active.version_id,
      enterpriseId,
      projectId,
    );
    aggregateVersions.deliveryPlan = aggregateVersion(deliveryRoot.aggregate_version);
    aggregateVersions.deliveryPlanVersion = String(active.version_no);
  }

  return { ...result, aggregateVersions };
}
