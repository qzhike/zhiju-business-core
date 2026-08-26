export const enterpriseProjectModule = Object.freeze({
  name: 'enterprise-project',
  status: 'IM_03_WI07_CUSTOMER_BASELINE_LANDED' as const,
});

export {
  createEnterpriseProjectDatabase,
  withEnterpriseProjectTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/enterprise-db.js';
export type {
  EnterpriseProjectDb,
  EnterpriseProjectTransaction,
  EnterpriseProjectTransactionContext,
  EnterprisePrincipalKind,
} from './persistence/enterprise-db.js';
export { EnterpriseProjectRepository } from './persistence/enterprise-project-repository.js';
export type { ProcessInstanceInsert } from './persistence/enterprise-project-repository.js';
export {
  EnterprisePersistenceError,
  ENTERPRISE_PAYLOAD_HASH_MISMATCH,
  ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
  ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/write-guards.js';
export {
  executeEnterpriseProjectCommand,
  assertEnvelopeMatchesContext,
  CommandExecutionError,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  CONCURRENCY_CONFLICT,
  COMMAND_IN_PROGRESS,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_CONTEXT_EXPIRED,
  COMMAND_CONTEXT_REJECTED,
  COMMAND_TARGET_MISMATCH,
  PAYLOAD_HASH_MISMATCH,
} from './persistence/command-runner.js';
export type {
  CommandEnvelope,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
  CommandAuditInput,
  OutboxEventInput,
  ReferenceEdgeInput,
} from './persistence/command-runner.js';
// IM-03 WI-03 (issue #59): business-aggregate types and repository for
// the EnterpriseProject vertical slice. The V2001 migration owns the
// schema; this module only describes the rows and the write boundary.
export { EnterpriseBusinessRepository } from './persistence/enterprise-business-repository.js';
export type {
  EnterpriseInsert,
  EnterpriseFactInsert,
  EnterpriseFactVersionInsert,
  EnterpriseProfileSnapshotInsert,
  ProductInsert,
  ProductVersionInsert,
  ProductScopeSnapshotInsert,
  QmsConfigurationInsert,
  QmsConfigurationRevisionInsert,
  ProjectInsert,
  ProjectScopeClaimInsert,
  ProjectSnapshotBindingInsert,
  SourceMaterialInsert,
  SourceMaterialOriginInsert,
  SourceMaterialValidationInsert,
  CustomerMaterialInsert,
  CustomerMaterialVersionInsert,
  CustomerMaterialDecisionInsert,
  CustomerBaselineInsert,
  CustomerBaselineVersionInsert,
  CustomerBaselineItemInsert,
  CustomerBaselineImpactReviewInsert,
  CasResult,
} from './persistence/enterprise-business-repository.js';
export type {
  EnterpriseTable,
  EnterpriseFactTable,
  EnterpriseFactVersionTable,
  EnterpriseProfileSnapshotTable,
  ProductTable,
  ProductVersionTable,
  ProductScopeSnapshotTable,
  QmsConfigurationTable,
  QmsConfigurationRevisionTable,
  ProjectTable,
  ProjectScopeClaimTable,
  ProjectSnapshotBindingTable,
  EnterpriseStatus,
  EnterpriseFactStatus,
  EnterpriseFactRiskLevel,
  ProductStatus,
  VersionLifecycle,
  QmsConfigurationStatus,
  ProjectStatus,
  ProjectScopeClaimStatus,
  ProjectSnapshotBindingPurpose,
  SourceMaterialTable,
  SourceMaterialOriginTable,
  SourceMaterialValidationTable,
  SourceMaterialCustodyStatus,
  SourceMaterialProcessingStatus,
  SourceMaterialValidationKind,
  SourceMaterialValidationOutcome,
  CustomerMaterialTable,
  CustomerMaterialVersionTable,
  CustomerMaterialDecisionTable,
  CustomerMaterialClassificationStatus,
  CustomerMaterialVersionStatus,
  CustomerMaterialDecisionKind,
  MaterialCompleteness,
  CustomerBaselineTable,
  CustomerBaselineVersionTable,
  CustomerBaselineItemTable,
  CustomerBaselineImpactReviewTable,
  CustomerBaselineVersionStatus,
  CustomerBaselineItemStatus,
  CustomerBaselineImpactStatus,
} from './persistence/enterprise-business-types.js';
// IM-03 WI-03 (issue #59): business handlers and failure codes for the
// EnterpriseProject vertical slice. Handlers fall into two groups:
//   * public Contract handlers (project.create_enterprise, ...);
//   * controlled Application Capability handlers (enterprise_product.*,
//     enterprise_qms.*, enterprise_profile.create_snapshot).
// The Capability handlers are frozen by WI-01 (Contract-Decision-Matrix)
// and intentionally do not enter the 200-item public Contract Catalog.
export {
  handleCreateEnterprise,
  handleProposeEnterpriseFact,
  handleConfirmEnterpriseFact,
  handleGetEnterpriseProfileSnapshot,
  handleCreateProject,
  handleValidateObjectScope,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateVersion,
  handleEnterpriseProductActivateVersion,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseQmsCreateRevision,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseProfileCreateSnapshot,
} from './business/enterprise-business-handlers.js';
export {
  handleRegisterSourceMaterial,
  handleAcceptSourceMaterial,
} from './business/source-material-handlers.js';
export {
  handleProposeCustomerMaterial,
  handleConfirmCustomerMaterial,
} from './business/customer-material-handlers.js';
export {
  handleCreateCustomerBaselineDraft,
  handleActivateCustomerBaselineVersion,
  handleGetActiveBaselineRefs,
} from './business/customer-baseline-handlers.js';
export type {
  CreateEnterprisePayload,
  ProposeEnterpriseFactPayload,
  ConfirmEnterpriseFactPayload,
  GetEnterpriseProfileSnapshotPayload,
  GetEnterpriseProfileSnapshotResult,
  CreateProjectPayload,
  ValidateObjectScopePayload,
  ValidateObjectScopeResult,
  EnterpriseProductCreatePayload,
  EnterpriseProductCreateVersionPayload,
  EnterpriseProductActivateVersionPayload,
  EnterpriseProductCreateScopeSnapshotPayload,
  EnterpriseQmsCreateRevisionPayload,
  EnterpriseQmsActivateRevisionPayload,
  EnterpriseProfileCreateSnapshotPayload,
} from './business/enterprise-business-handlers.js';
export type {
  RegisterSourceMaterialCommandPayload,
  AcceptSourceMaterialCommandPayload,
} from './business/source-material-handlers.js';
export type {
  ProposeCustomerMaterialCommandPayload,
  ConfirmCustomerMaterialCommandPayload,
} from './business/customer-material-handlers.js';
export type {
  CreateCustomerBaselineDraftCommandPayload,
  ActivateCustomerBaselineVersionCommandPayload,
  GetActiveBaselineRefsCommandPayload,
} from './business/customer-baseline-handlers.js';
export {
  EnterpriseBusinessError,
  PROJECT_ENTERPRISE_NOT_ACTIVE,
  PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT,
  PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT,
  PROJECT_FACT_SOURCE_REQUIRED,
  PROJECT_FACT_CONFIRMATION_FORBIDDEN,
  PROJECT_FACT_CONFLICT_UNRESOLVED,
  PROJECT_PROFILE_SOURCE_MISMATCH,
  PROJECT_PROFILE_SNAPSHOT_IMMUTABLE,
  PROJECT_PRODUCT_VERSION_NOT_FOUND,
  PROJECT_PRODUCT_VERSION_IMMUTABLE,
  PROJECT_PRODUCT_ACTIVATION_HUMAN_REQUIRED,
  PROJECT_PRODUCT_ACTIVATION_NOOP,
  PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID,
  PROJECT_QMS_DECISION_SOURCE_REQUIRED,
  PROJECT_QMS_REVISION_IMMUTABLE,
  PROJECT_QMS_ACTIVATION_HUMAN_REQUIRED,
  PROJECT_QMS_VERSION_NOT_FOUND,
  PROJECT_QMS_ACTIVATION_NOOP,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_PROJECT_DISPLAY_CODE_CONFLICT,
  PROJECT_START_SNAPSHOT_INCOMPLETE,
  PROJECT_START_SNAPSHOT_SCOPE_MISMATCH,
  PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN,
  PROJECT_MEMBER_POLICY_REF_INVALID,
  PROJECT_OBJECT_SCOPE_MISMATCH,
  PROJECT_SOURCE_CONTENT_IMMUTABLE,
  PROJECT_SOURCE_NOT_TRUSTED,
  PROJECT_MATERIAL_SOURCE_INVALID,
  PROJECT_SOURCE_ALREADY_ACCEPTED,
  PROJECT_MATERIAL_VERSION_NOT_FOUND,
  PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
  PROJECT_MATERIAL_CONFLICT_UNRESOLVED,
  PROJECT_BASELINE_STATUS_INVALID,
  PROJECT_MISSING_CONFIRMATION_REQUIRED,
  PROJECT_BASELINE_VERSION_IMMUTABLE,
  PROJECT_MULTIPLE_ACTIVE_BASELINES,
  PROJECT_BASELINE_VERSION_NOT_FOUND,
} from './business/enterprise-business-errors.js';
export type { EnterpriseBusinessErrorCode } from './business/enterprise-business-errors.js';
