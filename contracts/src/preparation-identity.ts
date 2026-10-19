import type { Common } from './generated/types/common.js';
import type { PreparationSession } from './preparation-transport.js';

export const PREPARATION_SERVICE_AUTHORITY_OPERATIONS = [
  'project.preparation.preset.read',
  'identity.preparation.membership_template.read',
  'identity.preparation.admission.read',
  'identity.preparation.membership.materialize',
  'identity.preparation.membership.read',
  'identity.preparation.creator_access.provision',
  'project.preparation.intake_binding.read',
  'project.preparation.creation.read',
  'project.preparation.handoff.read',
  'project.preparation.handoff.continue',
  'project.preparation.source.capture',
  'project.preparation.source.read',
  'project.source_material.register',
  'project.source_material.accept',
  'enterprise.project.get_project_board_slice',
  'integration.customer_zip.submission.read',
  'identity.preparation.original_analysis.read',
  'execution.preparation.task.create',
  'execution.preparation.context.build',
  'execution.preparation.analysis.request',
  'execution.preparation.result.read',
  'project.preparation.report.accept',
  'execution.preparation.process.step',
] as const;
export type PreparationServiceAuthorityOperation =
  | (typeof PREPARATION_SERVICE_AUTHORITY_OPERATIONS)[number]
  | 'project.preparation.analysis_basis.read'
  | 'project.preparation.source_v2.capture'
  | 'project.preparation.source_v2.read';

export interface PreparationCreatorBinding {
  operation: string;
  version: '1.0';
  purpose: string;
  action: string;
  capabilityCode: string;
  targetObjectType: string;
}
export interface PreparationMembershipTemplate {
  profile: 'ip.preparation_membership_template@1.0' | 'ip.preparation_membership_template@1.1';
  templateCode: string;
  templateVersion: string;
  creatorBindings: PreparationCreatorBinding[];
  grantPolicySnapshotRef: Common.SnapshotRef;
  maxGrantLifetimeSeconds: number;
}
export interface PreparationEnrollmentInput {
  grantId: string;
  principalRef: Common.ObjectRef;
  allowedModes: ('NEW' | 'EXISTING')[];
  preparationPresetRef: Common.VersionedRef;
  preparationPresetHash: Common.ContentHash;
  membershipTemplateRef: Common.VersionedRef;
  membershipTemplateHash: Common.ContentHash;
  policySnapshotRef: Common.SnapshotRef;
  effectivePeriod: { from: string; to: string };
  maxUses: number;
}
export interface PreparationAdmissionInput {
  requestRef: Common.ObjectRef;
  originalCommandId: string;
  originalKey: string;
  payloadHash: Common.ContentHash;
  customerMode: 'NEW' | 'EXISTING';
  enterpriseRef: Common.ObjectRef;
  projectRef: Common.ObjectRef;
  preparationPresetRef: Common.VersionedRef;
  preparationPresetHash: Common.ContentHash;
}
export interface PreparationAuthorizationProof {
  context: {
    principalKind: 'HUMAN' | 'SERVICE';
    policySnapshotId: string;
    authorizationDecisionExpiresAt: string;
  };
  session: PreparationSession;
  actorSnapshotRef: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
}
export interface PreparationAdmission extends PreparationAdmissionInput {
  creatorRef: Common.ObjectRef;
  membershipTemplateRef: Common.VersionedRef;
  membershipTemplateHash: Common.ContentHash;
  enrollmentGrantRef: Common.ContentAddressedRef;
  enterprisePermissionRefs: Common.ObjectRef[];
  actorSnapshotRef: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
  createdAt: string;
  validUntil: string;
}
export interface PreparationAdmissionResult {
  admissionRef: Common.ContentAddressedRef;
  receiptRef: Common.ContentAddressedRef;
  grantRefs: Common.ContentAddressedRef[];
  payload: PreparationAdmission;
  currentUseStatus: 'USABLE';
  checkedAt: string;
  validUntil: string;
}
export interface PreparationMemberPolicy {
  profile: 'ip.preparation_membership@1.0';
  templateRef: Common.VersionedRef;
  templateHash: Common.ContentHash;
  admissionRef: Common.ContentAddressedRef;
  creatorRef: Common.ObjectRef;
  enterpriseRef: Common.ObjectRef;
  projectRef: Common.ObjectRef;
  creatorBindings: PreparationCreatorBinding[];
  grantPolicySnapshotRef: Common.SnapshotRef;
  validUntil: string;
}
export interface PreparationMemberPolicyResult {
  memberPolicyRef: Common.VersionedRef;
  memberPolicyHash: Common.ContentHash;
  payload: PreparationMemberPolicy;
  receiptRef: Common.ContentAddressedRef;
}
export interface PreparationProjectCreationProof {
  requestRef: Common.ObjectRef;
  enterpriseRef: Common.ObjectRef;
  projectRef: Common.ObjectRef;
  preparationPresetRef: Common.VersionedRef;
  preparationPresetHash: Common.ContentHash;
  projectCreationReceiptRef: Common.ObjectRef;
  projectScopeClaimRef: Common.ObjectRef;
}
export interface PreparationProvisioningResult {
  provisioningReceiptRef: Common.ContentAddressedRef;
  grantRefs: Common.ObjectRef[];
  steps: { operation: string; grantRef: Common.ObjectRef }[];
  access: 'COMPLETE' | 'INCOMPLETE' | 'REVOKED';
  checkedAt: string;
}
export interface PreparationIdentityPort {
  authorizeServiceBootstrap(
    session: PreparationSession,
    input: {
      admissionRef?: Common.ContentAddressedRef;
      operation: string;
      target: Common.ObjectRef;
      payloadHash: Common.ContentHash;
    },
  ): Promise<PreparationAuthorizationProof>;
  grantAuthority(
    session: PreparationSession,
    input: {
      grantId: string;
      principalRef: Common.ObjectRef;
      operation: PreparationServiceAuthorityOperation;
      target: Common.ObjectRef;
      policySnapshotRef: Common.SnapshotRef;
      effectivePeriod: { from: string; to: string };
    },
  ): Promise<Common.ContentAddressedRef>;
  revokeAuthority(
    session: PreparationSession,
    input: { grantRef: Common.ContentAddressedRef; reasonCode: string },
  ): Promise<Common.ContentAddressedRef>;

  authorizeOperation(
    session: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
    payload: unknown,
    human?: PreparationSession,
  ): Promise<PreparationAuthorizationProof>;
  checkOperation(
    proof: PreparationAuthorizationProof,
    operation: string,
    target: Common.ObjectRef,
    payload: unknown,
  ): Promise<void>;
  grantEnrollment(
    session: PreparationSession,
    input: PreparationEnrollmentInput,
  ): Promise<{ grantRef: Common.ContentAddressedRef; receiptRef: Common.ContentAddressedRef }>;
  revokeEnrollment(
    session: PreparationSession,
    input: { grantRef: Common.ContentAddressedRef; reasonCode: string },
  ): Promise<Common.ContentAddressedRef>;
  publishMembershipTemplate(
    session: PreparationSession,
    input: {
      templateId: string;
      versionId: string;
      payload: PreparationMembershipTemplate;
      effectiveFrom: string;
    },
  ): Promise<{
    templateRef: Common.VersionedRef;
    templateHash: Common.ContentHash;
    receiptRef: Common.ContentAddressedRef;
  }>;
  readMembershipTemplate(
    session: PreparationSession,
    input: { templateRef: Common.VersionedRef; templateHash: Common.ContentHash },
  ): Promise<{
    payload: PreparationMembershipTemplate;
    useStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'WITHDRAWN';
    checkedAt: string;
  }>;
  withdrawMembershipTemplate(
    session: PreparationSession,
    input: {
      templateRef: Common.VersionedRef;
      templateHash: Common.ContentHash;
      reasonCode: string;
      effectiveFrom: string;
    },
  ): Promise<Common.ContentAddressedRef>;
  discover(
    session: PreparationSession,
    input: { preparationPresetRef: Common.VersionedRef; preparationPresetHash: Common.ContentHash },
  ): Promise<{
    newCustomerAllowed: boolean;
    enterpriseCandidates: Common.ObjectRef[];
    sourceWatermarks: Common.ContentHash;
  }>;
  lookupAdmission(
    session: PreparationSession,
    input: { requestRef: Common.ObjectRef; originalKey: string },
  ): Promise<PreparationAdmissionResult>;
  reserve(
    session: PreparationSession,
    input: PreparationAdmissionInput,
  ): Promise<PreparationAdmissionResult>;
  revalidate(
    session: PreparationSession,
    admissionRef: Common.ContentAddressedRef,
  ): Promise<PreparationAdmissionResult>;
  authorizeBootstrap(
    session: PreparationSession,
    input: {
      admissionRef: Common.ContentAddressedRef;
      operation: string;
      target: Common.ObjectRef;
      payloadHash: Common.ContentHash;
    },
  ): Promise<PreparationAuthorizationProof>;
  checkBootstrap(
    proof: PreparationAuthorizationProof,
    input: {
      admissionRef: Common.ContentAddressedRef;
      operation: string;
      target: Common.ObjectRef;
      payloadHash: Common.ContentHash;
    },
  ): Promise<void>;
  materializeMemberPolicy(
    session: PreparationSession,
    input: {
      admissionRef: Common.ContentAddressedRef;
      templateRef: Common.VersionedRef;
      templateHash: Common.ContentHash;
      memberPolicyId: string;
      versionId: string;
    },
  ): Promise<PreparationMemberPolicyResult>;
  readMemberPolicy(
    session: PreparationSession,
    input: { memberPolicyRef: Common.VersionedRef; memberPolicyHash: Common.ContentHash },
  ): Promise<PreparationMemberPolicyResult>;
  provisionCreatorAccess(
    session: PreparationSession,
    input: {
      admissionRef: Common.ContentAddressedRef;
      memberPolicyRef: Common.VersionedRef;
      memberPolicyHash: Common.ContentHash;
      projectCreationReceiptRef: Common.ObjectRef;
      projectScopeClaimRef: Common.ObjectRef;
    },
  ): Promise<PreparationProvisioningResult>;
  currentCreatorAccess(
    session: PreparationSession,
    admissionRef: Common.ContentAddressedRef,
  ): Promise<PreparationProvisioningResult>;
}
