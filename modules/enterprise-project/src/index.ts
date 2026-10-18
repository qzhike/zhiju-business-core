export const enterpriseProjectModule = Object.freeze({
  name: 'enterprise-project',
  status: 'IM_03_WI12_DELIVERY_ITEM_COMPLETION_IMPACT_IMPLEMENTATION_IN_PROGRESS' as const,
});

export {
  createEnterpriseProjectDatabase,
  withEnterpriseProjectTransaction,
  withEnterpriseProjectPlatformTransaction,
  withProjectionTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
  PLATFORM_CONTROL_SCOPE_ID,
} from './persistence/enterprise-db.js';
export type {
  EnterpriseProjectDb,
  EnterpriseProjectTransaction,
  EnterpriseProjectTransactionContext,
  EnterprisePrincipalKind,
  PlatformReferenceCapability,
} from './persistence/enterprise-db.js';
export type {
  ProjectBoardProjectionVersionTable,
  ProjectBoardTable,
  ProjectBoardReadAliasTable,
  ProjectionSourceStateTable,
  ProjectionCheckpointTable,
  ProjectionFailureTable,
  ProjectionVersionStatus,
  ProjectionCheckpointStatus,
} from './persistence/projection-types.js';
export {
  CAPTURE_POLICY_PROFILE_KEY,
  validateCapturePolicy,
} from './business/capture-policy-profile.js';
export type {
  CapturePolicyRules,
  CapturePolicyValidationResult,
} from './business/capture-policy-profile.js';
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
export { TemplateRegulatoryRepository } from './persistence/template-regulatory-repository.js';
export type {
  ReferenceTemplateInsert,
  ReferenceTemplateVersionInsert,
  RegulatoryReferenceInsert,
  RegulatoryReferenceVersionInsert,
  TemplateBaselineInsert,
  TemplateBaselineVersionInsert,
  TemplateSelectionInsert,
  RegulatoryProfileInsert,
  RegulatoryProfileVersionInsert,
  RegulatoryProfileItemInsert,
} from './persistence/template-regulatory-repository.js';
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
  PlatformReferenceStatus,
  PlatformReferenceLifecycle,
  ReferenceTemplateTable,
  ReferenceTemplateVersionTable,
  RegulatoryReferenceTable,
  RegulatoryReferenceVersionTable,
  FrozenVersionStatus,
  TemplateBaselineTable,
  TemplateBaselineVersionTable,
  TemplateSelectionTable,
  RegulatoryProfileTable,
  RegulatoryProfileVersionTable,
  RegulatoryProfileItemTable,
  GapAnalysisTable,
  GapAnalysisInputSnapshotTable,
  GapAnalysisVersionTable,
  GapFindingTable,
  GapAnalysisDecisionTable,
  GapAnalysisStatus,
  GapAnalysisVersionStatus,
  GapAnalysisMode,
  GapAnalysisDisposition,
  GapFindingSeverity,
  DeliveryPlanTable,
  DeliveryPlanVersionTable,
  DeliveryItemTable,
  DeliveryItemArtifactRequirementTable,
  DeliveryItemDependencyTable,
  DeliveryPlanDecisionTable,
  DeliveryPlanStatus,
  DeliveryPlanVersionStatus,
  DeliveryPlanDecision,
  DeliveryCommitmentStatus,
  DeliveryExecutionStatus,
  DeliveryCompletionFactLifecycle,
  DeliveryCompletionEvaluationOutcome,
  DeliveryItemCompletionFactTable,
  DeliveryItemCompletionEvaluationTable,
  DeliveryItemImpactReviewTable,
  ContextSourceSliceTable,
  ResolutionReceiptMaterialTable,
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
  handlePlatformTemplateImportVersion,
  handlePlatformTemplatePublishVersion,
  handlePlatformRegulatoryImportVersion,
  handlePlatformRegulatoryPublishVersion,
  handleFreezeTemplateBaseline,
  handleActivateRegulatoryProfile,
} from './business/template-regulatory-handlers.js';
export type {
  PlatformTemplateImportVersionPayload,
  PlatformTemplatePublishVersionPayload,
  PlatformRegulatoryImportVersionPayload,
  PlatformRegulatoryPublishVersionPayload,
} from './business/template-regulatory-handlers.js';
export {
  handleStartGapAnalysis,
  handleAcceptGapAnalysis,
} from './business/gap-analysis-handlers.js';
export type {
  StartGapAnalysisCommandPayload,
  AcceptGapAnalysisCommandPayload,
  ControlledGapFinding,
} from './business/gap-analysis-handlers.js';
export { GapAnalysisRepository } from './persistence/gap-analysis-repository.js';
export type {
  GapAnalysisInsert,
  GapAnalysisInputSnapshotInsert,
  GapAnalysisVersionInsert,
  GapFindingInsert,
  GapAnalysisDecisionInsert,
  GapStaleDependency,
} from './persistence/gap-analysis-repository.js';
export { DeliveryPlanRepository } from './persistence/delivery-plan-repository.js';
export type {
  DeliveryPlanInsert,
  DeliveryPlanVersionInsert,
  DeliveryItemInsert,
  DeliveryItemArtifactRequirementInsert,
  DeliveryItemDependencyInsert,
  DeliveryPlanDecisionInsert,
  DeliveryPlanCasPatch,
  DeliveryPlanCasResult,
} from './persistence/delivery-plan-repository.js';
export {
  handleCreateDeliveryPlanDraft,
  handleApproveDeliveryPlan,
  handleActivateDeliveryPlan,
  handleGetDeliveryItemCriteria,
} from './business/delivery-plan-handlers.js';
export type {
  CreateDeliveryPlanDraftCommandPayload,
  ApproveDeliveryPlanCommandPayload,
  ActivateDeliveryPlanCommandPayload,
  GetDeliveryItemCriteriaQueryPayload,
} from './business/delivery-plan-handlers.js';
export { DeliveryItemCompletionRepository } from './persistence/delivery-item-completion-repository.js';
export type {
  DeliveryItemCompletionFactInsert,
  DeliveryItemCompletionEvaluationInsert,
  DeliveryItemImpactReviewInsert,
  DeliveryItemCompletionCasInput,
  DeliveryItemCompletionCasResult,
} from './persistence/delivery-item-completion-repository.js';
export {
  consumeDeliveryItemCompletionEvent,
  handleEvaluateDeliveryItemCompletion,
} from './business/delivery-item-completion-handlers.js';
export type {
  DeliveryCompletionEventEnvelope,
  DeliveryCompletionEventInput,
  DeliveryCompletionEventResult,
  EvaluateDeliveryItemCompletionCommandPayload,
} from './business/delivery-item-completion-handlers.js';
export {
  handleGetProjectContextSource,
  handleGetProjectBoardSlice,
} from './business/query-handlers.js';
export type {
  GetProjectContextSourceQueryPayload,
  GetProjectBoardSliceQueryPayload,
} from './business/query-handlers.js';
// IM-UI-01 (#258/#266): EnterpriseProject owning read behind one candidate card
// of the workspace trusted-Human project directory.
export { readWorkspaceProjectSummary } from './business/workspace-directory-read.js';
export type {
  WorkspaceProjectSummaryView,
  WorkspaceProjectSummaryRequest,
} from './business/workspace-directory-read.js';
// IM-06 (#188): ContextSourceSlice capture/read handlers, the IdentityPolicy
// resolution Port they consume and the shared source-slice assembly the
// persisted capture reuses from the owning Source Query.
export {
  handleCaptureContextSourceSlice,
  handleGetContextSourceSlice,
  CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
  AUTHORIZATION_DECISION_INVALID,
  CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
  CONTEXT_SOURCE_SLICE_TARGET,
  PROJECT_OBJECT_TYPE,
} from './business/context-source-slice-handlers.js';
export type {
  CaptureContextSourceSliceCommandPayload,
  GetContextSourceSliceQueryPayload,
  ContextSourceSliceHandlerDeps,
} from './business/context-source-slice-handlers.js';
export {
  resolveCapturePolicy,
  DEPENDENCY_UNAVAILABLE,
} from './business/context-source-slice-policy.js';
export type {
  CapturePolicyObservation,
  CapturePolicyResolution,
  CapturePolicyResolutionPort,
  CapturePolicyResolutionRequest,
  CapturePolicyOutcome,
  ResolvedCapturePolicy,
} from './business/context-source-slice-policy.js';
export {
  SOURCE_KINDS,
  SOURCE_SLICE_PURPOSE_POLICIES,
  assembleProjectContextSourceSlice,
  validateRequestedKinds,
  validateSourceSlicePurpose,
} from './business/source-slice-assembly.js';
export type {
  SourceKind,
  SourceSlicePurposePolicy,
  ProjectContextSourceSliceRequest,
} from './business/source-slice-assembly.js';
export { ContextSourceSliceRepository } from './persistence/context-source-slice-repository.js';
export type { ContextSourceSliceInsert } from './persistence/context-source-slice-repository.js';
// IM-06 (#191): canonical Resolution Receipt material persistence and the
// narrow authoritative attestation Query.
export { ResolutionReceiptRepository } from './persistence/resolution-receipt-repository.js';
export type { ResolutionReceiptMaterialInsert } from './persistence/resolution-receipt-repository.js';
export {
  handleGetResolutionReceipt,
  readConfirmationReceiptRef,
  readCustomerMaterialRecoveryReferences,
  GET_RESOLUTION_RECEIPT_QUERY,
  GET_RESOLUTION_RECEIPT_PURPOSE,
  COMMAND_RECEIPT_OBJECT_TYPE,
  CONFIRM_CUSTOMER_MATERIAL_COMMAND,
} from './business/resolution-receipt-handlers.js';
export type { GetResolutionReceiptQueryPayload } from './business/resolution-receipt-handlers.js';
export {
  PROJECT_BOARD_PROJECTION_CONSUMER,
  calculateProjectBoardSnapshotHash,
  rebuildProjectBoardProjection,
  recordProjectBoardSourceEvent,
  pauseProjectBoardProjection,
  recordProjectBoardProjectionFailure,
  consumeProjectBoardEvent,
  readProjectBoardProjection,
} from './persistence/project-board-projection-repository.js';
export type {
  ProjectBoardProjectionItemInput,
  ProjectBoardSnapshotExport,
  ProjectBoardEventDelta,
  ProjectBoardProjectionRebuildResult,
  ProjectionSourceEventResult,
  ProjectBoardProjectionFailureInput,
  ProjectBoardProjectionFailureResult,
  ProjectionReadState,
} from './persistence/project-board-projection-repository.js';
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
  PROJECT_TEMPLATE_LATEST_FORBIDDEN,
  PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
  PROJECT_REGULATORY_EVIDENCE_REQUIRED,
  PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
  PROJECT_PLATFORM_REFERENCE_UNPUBLISHED,
  PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
  PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED,
  PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED,
  PROJECT_PLATFORM_REFERENCE_INVALID,
  PROJECT_TEMPLATE_VERSION_NOT_FOUND,
  PROJECT_REGULATORY_PROFILE_VERSION_NOT_FOUND,
  PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
  PROJECT_GAP_INPUT_INCOMPLETE,
  PROJECT_GAP_EPISTEMIC_CONFLICT,
  PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED,
  PROJECT_GAP_VERSION_NOT_FOUND,
  PROJECT_GAP_VERSION_IMMUTABLE,
  PROJECT_GAP_SCOPE_MISMATCH,
  PROJECT_GAP_INPUT_HASH_MISMATCH,
  PROJECT_GAP_STATUS_INVALID,
  PROJECT_GAP_FINDING_IMMUTABLE,
  PROJECT_GAP_DECISION_CONFLICT,
  PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
  PROJECT_DELIVERY_REFERENCE_INVALID,
  PROJECT_DELIVERY_ITEM_INVALID,
  PROJECT_DELIVERY_ITEM_KEY_CONFLICT,
  PROJECT_DELIVERY_DEPENDENCY_CYCLE,
  PROJECT_DELIVERY_VERSION_NOT_FOUND,
  PROJECT_DELIVERY_PLAN_IMMUTABLE,
  PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
  PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED,
  PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED,
  PROJECT_COMPLETION_IS_DERIVED,
  PROJECT_DELIVERY_COMPLETION_EVENT_INVALID,
  PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT,
  PROJECT_DELIVERY_COMPLETION_FACT_NOT_FOUND,
  PROJECT_DELIVERY_COMPLETION_EVALUATOR_INVALID,
  PROJECT_DELIVERY_COMPLETION_WATERMARK_INVALID,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_CURSOR_INVALID,
  PROJECT_PROJECTION_EVENT_INVALID,
  PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
  PROJECT_PROJECTION_REBUILD_INVALID,
  PROJECT_CAPTURE_POLICY_UNSUPPORTED,
  PROJECT_CAPTURE_POLICY_NOT_USABLE,
  PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
  PROJECT_CAPTURE_VALIDITY_INVALID,
  PROJECT_CAPTURE_RESULT_INVALID,
  PROJECT_CAPTURE_SLICE_ALREADY_EXISTS,
} from './business/enterprise-business-errors.js';
export type { EnterpriseBusinessErrorCode } from './business/enterprise-business-errors.js';
// IM-06 (#204): internal read-only Project/DeliveryItem proof Port for the
// `execution.create_task` DRAFT creation boundary (Spec 002 §13.1). It is not a
// registered operation and never enters the Contract Catalog.
export {
  createTaskExecutionCreationProjectScopePort,
  TASK_CREATION_SCOPE_KIND_MISMATCH,
  TASK_CREATION_SCOPE_IDENTITY_MISMATCH,
  TASK_CREATION_SCOPE_SCOPE_MISMATCH,
  TASK_CREATION_SCOPE_NOT_VISIBLE,
  TASK_CREATION_SCOPE_LIFECYCLE_INVALID,
} from './business/task-execution-creation-scope-port.js';
export type {
  TaskExecutionCreationProjectScopeConfig,
  TaskExecutionCreationProjectScopeOutcome,
  TaskExecutionCreationProjectScopePort,
  TaskExecutionCreationProjectScopeRequest,
} from './business/task-execution-creation-scope-port.js';

export {
  isCommittedDeliveryCompletionConsumption,
  createExactDeliveryCompletionConsumer,
  handleEvaluateExactDeliveryItemCompletion,
  createDeliveryItemCompletionReadbackPort,
  type ExactTaskCompletionMaterial,
  type ExactDeliveryCompletionRequest,
} from './business/delivery-item-completion-handlers.js';

export * from './persistence/company-startup-db.js';
export * from './business/company-startup-definition.js';
export * from './business/company-startup-handlers.js';
export * from './business/preparation-project.js';

export * from './business/preparation-analysis-basis.js';
