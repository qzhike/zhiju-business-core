import type {
  createBlockedInputRecoveryWorker,
  createRecoveryProcessAuthorities,
} from '@zhiju/api/composition';
import {
  createBlockedInputRecoveryEntry,
  createControlledFirstRunEntry,
  createFormalCompletionEntry,
  createWorkOrderValidationEntry,
  type FormalCompletionEntryConfig,
  type InitialContextSession,
} from '@zhiju/api/composition';
import { createArtifactDatabase, InMemoryObjectStorage } from '@zhiju/artifact';
import {
  type Common,
  executionDocumentSchemaReference,
  type IntegrationGateway,
  registeredEvaluatorProfileReference,
  workOrderReadyProfileRegistry,
} from '@zhiju/contracts';
import {
  BLOCKED_INPUT_RECOVERY_BINDINGS,
  CONTROLLED_FIRST_RUN_BINDINGS,
  type ControlledFirstRunCapabilityCodes,
  createActorSnapshot,
  createControlledFirstRunAuthorizationPort,
  createFormalCompletionAuthorizationPort,
  createRecoveryAuthorizationPort,
  createWorkOrderValidationAuthorizationPort,
  FORMAL_OUTPUT_RECOVERY_BINDINGS,
  formalCompletionBindings,
  withIdentityTransaction,
  WORK_ORDER_VALIDATION_BINDINGS,
  type WorkOrderValidationCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createIntegrationRendererDatabase,
  InMemoryRenderObjectStorage,
  LocalSyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import { createQualityGovernanceDatabase } from '@zhiju/quality-governance';
import {
  canonicalize,
  type CanonicalJsonObject,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
} from '@zhiju/shared-kernel';
import {
  type CommandResult,
  digestCanonicalPayload,
  EXECUTION_DRAFT_SNAPSHOT_STALE,
  listControlledFinalProgress,
  recoverControlledFinalRuns,
  scanControlledFinalCandidates,
  type TaskExecutionTransactionContext,
  withTaskExecutionTransaction,
} from '@zhiju/task-execution';
import { type KyselyPlugin, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { expect } from 'vitest';
import { createDeliveryCompletionPlanFixture } from './delivery-completion-plan-fixture.js';
import { formalQualityFixture } from './formal-completion-quality-fixture.js';
import {
  createFormalOutput,
  type CreateFormalOutputContext,
} from './initial-context-create-formal-output.js';
import {
  executeRecoveryStep,
  type ExecuteRecoveryStepContext,
} from './initial-context-execute-recovery-step.js';
import {
  ACTIONS,
  AUTH_HASH,
  BUILDER_POLICY,
  BUILDER_PROFILE,
  CAPTURE_CAPABILITY,
  CAPTURE_PROFILE,
  contentHash,
  CONTEXT_SNAPSHOT_OBJECT,
  contextSnapshotCapabilityCodes,
  CORRELATION,
  definedValue,
  type DeliveryScheduleHooks,
  type ControlledExitHooks,
  dependencyCapabilities,
  DRAFT_SNAPSHOT_OBJECT,
  objectRef,
  OPERATOR,
  OPERATOR_ACTOR,
  PAST,
  policyKey,
  type Principal,
  PRINCIPAL_OBJECT,
  profileReference,
  PURPOSE_DOCUMENT,
  record,
  type RecoveryFixture,
  rewriteFixtureScopes,
  TASK_V2,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
import {
  prepareRecoveryAuthorities,
  type PrepareRecoveryAuthoritiesContext,
} from './initial-context-prepare-recovery-authorities.js';
import type { InitialContextSuite } from './initial-context-suite.js';
import type { ScenarioBoardProbe } from './initial-context-scenario-types.js';
import {
  verifyBoundedRecovery,
  type VerifyBoundedRecoveryContext,
} from './initial-context-verify-bounded-recovery.js';
import {
  verifyEligibilityLoss,
  type VerifyEligibilityLossContext,
} from './initial-context-verify-eligibility-loss.js';
import {
  verifyFinalBinding,
  type VerifyFinalBindingContext,
} from './initial-context-verify-final-binding.js';
import {
  verifyFinalDependencies,
  type VerifyFinalDependenciesContext,
} from './initial-context-verify-final-dependencies.js';
import { verifyFinalSql, type VerifyFinalSqlContext } from './initial-context-verify-final-sql.js';
import {
  verifyFormalCompletion,
  type VerifyFormalCompletionContext,
} from './initial-context-verify-formal-completion.js';
import {
  verifyHistoricalReadPermissions,
  type VerifyHistoricalReadPermissionsContext,
} from './initial-context-verify-historical-read-permissions.js';
import {
  verifyHistoricalRunUpgrade,
  type VerifyHistoricalRunUpgradeContext,
} from './initial-context-verify-historical-run-upgrade.js';
import {
  verifyInitialFinalPermissions,
  type VerifyInitialFinalPermissionsContext,
} from './initial-context-verify-initial-final-permissions.js';
import {
  verifyPreparationValidation,
  type VerifyPreparationValidationContext,
} from './initial-context-verify-preparation-validation.js';
import {
  verifyProcessRecovery,
  type VerifyProcessRecoveryContext,
} from './initial-context-verify-process-recovery.js';
import {
  verifyRecoveryExpiry,
  type VerifyRecoveryExpiryContext,
} from './initial-context-verify-recovery-expiry.js';
import {
  verifyRecoveryRollback,
  type VerifyRecoveryRollbackContext,
} from './initial-context-verify-recovery-rollback.js';
import {
  verifyRecoverySql,
  type VerifyRecoverySqlContext,
} from './initial-context-verify-recovery-sql.js';
import {
  type CancelVariant,
  verifyRunCancellation,
  type VerifyRunCancellationContext,
} from './initial-context-verify-run-cancellation.js';
import { verifyCancelArbitration } from './initial-context-verify-cancel-arbitration.js';
import { verifyCancelAuthorization } from './initial-context-verify-cancel-authorization.js';
import { verifyCancelLateFinal } from './initial-context-verify-cancel-late-final.js';
import { verifyCancelReview } from './initial-context-verify-cancel-review.js';
import {
  verifyRunCreation,
  type VerifyRunCreationContext,
} from './initial-context-verify-run-creation.js';
import {
  verifyRuntimeDispatch,
  type VerifyRuntimeDispatchContext,
} from './initial-context-verify-runtime-dispatch.js';
import {
  verifySubmissionBinding,
  type VerifySubmissionBindingContext,
} from './initial-context-verify-submission-binding.js';
import {
  verifySubmissionConcurrency,
  type VerifySubmissionConcurrencyContext,
} from './initial-context-verify-submission-concurrency.js';
import {
  verifyTerminalExpiry,
  type VerifyTerminalExpiryContext,
} from './initial-context-verify-terminal-expiry.js';
import { verifyWorkOrderValidationUpgrade } from './work-order-validation-upgrade.js';
export function createRunScenario(suite: InitialContextSuite) {
  let independentScenarioService: Principal | undefined;
  const independentScenarioGrantIds = new Map<string, string>();
  const runScenario = async (
    terminalScenario:
      | 'FORMAL_QUALITY'
      | 'FORMAL_DELIVERY_NORMAL'
      | 'FORMAL_DELIVERY_RECOVERED'
      | 'FORMAL_NORMAL'
      | 'FORMAL_GRANT_LOCK'
      | 'FORMAL_DEPENDENCY_LOCK'
      | 'FORMAL_CHILD_FIRST'
      | 'FORMAL_POLICY'
      | 'FORMAL_TTL'
      | 'FORMAL_EMPTY'
      | 'FORMAL_LATE'
      | 'FORMAL_RECOVERED'
      | 'FORMAL_REQUEST_COMPLETION_FIRST'
      | 'FORMAL_REQUEST_OPEN_FIRST'
      | 'BOUNDED_RECOVERY'
      | 'SUCCEEDED'
      | 'MIX_VALIDATIONS'
      | 'ACCEPT_RACE'
      | 'ELIGIBILITY_CHANGE'
      | 'TIMED_OUT'
      | 'TERMINAL_BEFORE_FINAL'
      | 'IG_WRONG_SESSION'
      | 'RACE'
      | 'LOCK_DEADLINE'
      | 'RECOVERY'
      | 'RECOVERY_WORKER'
      | 'RECOVERY_MULTIPLE'
      | 'LEGACY_UPGRADE'
      | 'RECOVERY_EXPIRE'
      | 'VALIDATION_EXPIRED'
      | 'UNSUPPORTED_FINAL'
      | 'TIMED_OUT_BUNDLE_EXPIRED'
      | 'NON_FINAL_CORE_REJECT'
      | 'RUN_CANCEL',
    negativeFinalCase:
      | 'RUNTIME_USAGE'
      | 'OUTCOME'
      | 'BUSINESS_OUTPUT'
      | 'ARTIFACT_ALIAS'
      | 'WORKSPACE_OUTPUT'
      | 'FINDING'
      | 'KNOWLEDGE_PROPOSAL'
      | 'INPUT_REQUEST_PROPOSAL'
      | 'FOLLOW_UP_PROPOSAL'
      | 'CONTINUATION'
      | 'HEADER'
      | 'PROVENANCE'
      | 'TIME' = 'RUNTIME_USAGE',
    foreignValidations?: CanonicalJsonObject,
    observeValidations?: (validations: CanonicalJsonObject) => void,
    eligibilityChange?: {
      readonly step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE';
      readonly source: 'GRANT' | 'POLICY';
      readonly whileLocked?: boolean;
    },
    observeRecovery?: (value: RecoveryFixture) => Promise<void>,
    recoveryVariant:
      | 'NORMAL'
      | 'SUSPEND'
      | 'BUDGET_EXHAUSTED'
      | 'EXPIRE_SOURCE'
      | 'SECOND_WRONG_SESSION'
      | 'SECOND_EXPIRY_RACE'
      | 'OTHER_CHILD'
      | 'REQUEST_EXPIRED'
      | 'CONTROLS_SUPERSEDED'
      | 'BUILDER_SUPERSEDED'
      | 'STALE_CONTEXT'
      | 'SECOND_BLOCKED'
      | 'SECOND_PARTIAL'
      | 'SECOND_FAILED' = 'NORMAL',
    deliveryRequiredRelease = false,
    deliverySchedule?: DeliveryScheduleHooks,
    cancelVariant?: CancelVariant,
    usageProbe?: (
      stage:
        'CREATED' | 'STARTED' | 'SUBMITTED' | 'ACCEPTED' | 'FINALIZED' | 'CANCELLED' | 'ISOLATED',
      runRef: Common.ObjectRef,
    ) => Promise<void>,
    boardProbe?: ScenarioBoardProbe,
    exitHooks?: ControlledExitHooks,
  ) => {
    const expectedCommandStatus = (command: { commandId: unknown }) =>
      exitHooks?.commandStatus?.(command.commandId) ?? 'COMMITTED';
    const firstRunPayload = (result: CommandResult) =>
      exitHooks && result.status === 'DUPLICATE'
        ? result.resultPayload
        : suite.committedPayload(result);
    const stageDependencies: VerifyPreparationValidationContext &
      VerifyRecoverySqlContext &
      VerifyRecoveryRollbackContext &
      ExecuteRecoveryStepContext &
      PrepareRecoveryAuthoritiesContext &
      CreateFormalOutputContext &
      VerifyFormalCompletionContext &
      VerifyRunCreationContext &
      VerifyRuntimeDispatchContext &
      VerifyHistoricalRunUpgradeContext &
      VerifyTerminalExpiryContext &
      VerifyFinalBindingContext &
      VerifyFinalDependenciesContext &
      VerifyEligibilityLossContext &
      VerifyFinalSqlContext &
      VerifyInitialFinalPermissionsContext &
      VerifyRecoveryExpiryContext &
      VerifyProcessRecoveryContext &
      VerifySubmissionBindingContext &
      VerifySubmissionConcurrencyContext &
      VerifyBoundedRecoveryContext &
      VerifyHistoricalReadPermissionsContext &
      VerifyRunCancellationContext = {
      get exercisePreparationMatrix() {
        return exercisePreparationMatrix;
      },
      get admin() {
        return suite.admin;
      },
      set admin(value: typeof suite.admin) {
        suite.admin = value;
      },
      get teDb() {
        return suite.teDb;
      },
      set teDb(value: typeof suite.teDb) {
        suite.teDb = value;
      },
      get runnerContext() {
        return suite.runnerContext;
      },
      get service() {
        return service;
      },
      set service(value: typeof service) {
        service = value;
      },
      get judgmentId() {
        return judgmentId;
      },
      get judgmentPayload() {
        return judgmentPayload;
      },
      get contextRef() {
        return contextRef;
      },
      get envelope() {
        return envelope;
      },
      get revised() {
        return revised;
      },
      get judgmentRef() {
        return judgmentRef;
      },
      get entry() {
        return entry;
      },
      get sessionFor() {
        return suite.sessionFor;
      },
      get receiptRows() {
        return suite.receiptRows;
      },
      get createWorkOrder() {
        return suite.createWorkOrder;
      },
      get taskId() {
        return taskId;
      },
      get expiresAt() {
        return expiresAt;
      },
      get draftSnapshotRefOf() {
        return suite.draftSnapshotRefOf;
      },
      get initialContextEntry() {
        return suite.initialContextEntry;
      },
      set initialContextEntry(value: typeof suite.initialContextEntry) {
        suite.initialContextEntry = value;
      },
      get preparedBuild() {
        return suite.preparedBuild;
      },
      get slice() {
        return slice;
      },
      get contextSnapshotRefOf() {
        return suite.contextSnapshotRefOf;
      },
      get scope() {
        return suite.scope;
      },
      get specFields() {
        return specFields;
      },
      get validationRef() {
        return validationRef;
      },
      get evaluator() {
        return evaluator;
      },
      get committedPayload() {
        return suite.committedPayload;
      },
      get fixture() {
        return suite.fixture;
      },
      set fixture(value: typeof suite.fixture) {
        suite.fixture = value;
      },
      get registerPolicyVersionAs() {
        return suite.registerPolicyVersionAs;
      },
      get validationEnvelope() {
        return validationEnvelope;
      },
      get enterpriseProjectDb() {
        return suite.enterpriseProjectDb;
      },
      set enterpriseProjectDb(value: typeof suite.enterpriseProjectDb) {
        suite.enterpriseProjectDb = value;
      },
      get identityDb() {
        return suite.identityDb;
      },
      set identityDb(value: typeof suite.identityDb) {
        suite.identityDb = value;
      },
      get identityRepo() {
        return suite.identityRepo;
      },
      set identityRepo(value: typeof suite.identityRepo) {
        suite.identityRepo = value;
      },
      get crypto() {
        return suite.crypto;
      },
      get codes() {
        return codes;
      },
      get clock() {
        return suite.clock;
      },
      set clock(value: typeof suite.clock) {
        suite.clock = value;
      },
      get activeDatabaseUrl() {
        return suite.activeDatabaseUrl;
      },
      get woId() {
        return woId;
      },
      get recoverySqlVerified() {
        return recoverySqlVerified;
      },
      get recoverySqlCounterexamples() {
        return recoverySqlCounterexamples;
      },
      get runtimeDriver() {
        return runtimeDriver;
      },
      get recoveryFaults() {
        return recoveryFaults;
      },
      get processPending() {
        return processPending;
      },
      set processPending(value: typeof processPending) {
        processPending = value;
      },
      get processExecute() {
        return processExecute;
      },
      set processExecute(value: typeof processExecute) {
        processExecute = value;
      },
      get processResult() {
        return processResult;
      },
      set processResult(value: typeof processResult) {
        processResult = value;
      },
      get processWorkers() {
        return processWorkers;
      },
      set processWorkers(value: typeof processWorkers) {
        processWorkers = value;
      },
      get exerciseRecoveryFaultMatrix() {
        return exerciseRecoveryFaultMatrix;
      },
      get recoveryVariant() {
        return recoveryVariant;
      },
      get recoveryAuth() {
        return recoveryAuth;
      },
      get identityDeps() {
        return suite.identityDeps;
      },
      get recoveryConfig() {
        return recoveryConfig;
      },
      get processAuthorities() {
        return processAuthorities;
      },
      get processStep() {
        return processStep;
      },
      set processStep(value: typeof processStep) {
        processStep = value;
      },
      get proposalId() {
        return proposalId;
      },
      get processHandoffs() {
        return processHandoffs;
      },
      get bounded() {
        return bounded;
      },
      get operator() {
        return suite.operator;
      },
      get prepareIndependentGrants() {
        return suite.prepareIndependentGrants;
      },
      get formal() {
        return formal;
      },
      get grant() {
        return suite.grant;
      },
      get recoveryCodes() {
        return recoveryCodes;
      },
      get recoveryGrants() {
        return recoveryGrants;
      },
      get otherChildId() {
        return otherChildId;
      },
      get otherDraftChildId() {
        return otherDraftChildId;
      },
      set otherDraftChildId(value: typeof otherDraftChildId) {
        otherDraftChildId = value;
      },
      get draft() {
        return draft;
      },
      get recoveryEntryRaw() {
        return recoveryEntryRaw;
      },
      get recoveryEnvelope() {
        return recoveryEnvelope;
      },
      get recoverySource() {
        return recoverySource;
      },
      set recoverySource(value: typeof recoverySource) {
        recoverySource = value;
      },
      get registry() {
        return suite.registry;
      },
      get recoveryProposeEnvelope() {
        return recoveryProposeEnvelope;
      },
      set recoveryProposeEnvelope(value: typeof recoveryProposeEnvelope) {
        recoveryProposeEnvelope = value;
      },
      get recoveryEntry() {
        return recoveryEntry;
      },
      get candidateMaterial() {
        return candidateMaterial;
      },
      set candidateMaterial(value: typeof candidateMaterial) {
        candidateMaterial = value;
      },
      get terminalScenario() {
        return terminalScenario;
      },
      get cancelVariant() {
        return cancelVariant;
      },
      get workOrderRef() {
        return workOrderRef;
      },
      get revokeCapabilityTracked() {
        return suite.revokeCapabilityTracked;
      },
      get formalGrants() {
        return formalGrants;
      },
      get formalEnvelope() {
        return formalEnvelope;
      },
      get formalEntry() {
        return formalEntry;
      },
      get formalCodes() {
        return formalCodes;
      },
      get artifactDb() {
        return artifactDb;
      },
      get artifactStorage() {
        return artifactStorage;
      },
      get formalConfig() {
        return formalConfig;
      },
      get queryProbe() {
        return queryProbe;
      },
      get guardedTeDb() {
        return guardedTeDb;
      },
      get borrowedActors() {
        return borrowedActors;
      },
      get queryReads() {
        return queryReads;
      },
      get formalAuth() {
        return formalAuth;
      },
      get protectedReads() {
        return protectedReads;
      },
      get replayFormalCreation() {
        return replayFormalCreation;
      },
      set replayFormalCreation(value: typeof replayFormalCreation) {
        replayFormalCreation = value;
      },
      get actualFormalOutput() {
        return actualFormalOutput;
      },
      set actualFormalOutput(value: typeof actualFormalOutput) {
        actualFormalOutput = value;
      },
      get actualFormalArtifact() {
        return actualFormalArtifact;
      },
      set actualFormalArtifact(value: typeof actualFormalArtifact) {
        actualFormalArtifact = value;
      },
      get qualityProfile() {
        return qualityProfile;
      },
      get quality() {
        return quality;
      },
      get other() {
        return suite.other;
      },
      get actualQuality() {
        return actualQuality;
      },
      set actualQuality(value: typeof actualQuality) {
        actualQuality = value;
      },
      get runtimeJournal() {
        return runtimeJournal;
      },
      get outputProof() {
        return outputProof;
      },
      set outputProof(value: typeof outputProof) {
        outputProof = value;
      },
      get exitStage() {
        return exitHooks?.stage;
      },
      get exitCommandStatus() {
        return exitHooks?.commandStatus;
      },
      get phase() {
        return suite.phase;
      },
      get firstRunEntry() {
        return firstRunEntry;
      },
      get firstRunEnvelope() {
        return firstRunEnvelope;
      },
      get runRef() {
        return runRef;
      },
      get completionRef() {
        return completionRef;
      },
      get delivery() {
        return delivery;
      },
      get deliveryRequiredRelease() {
        return deliveryRequiredRelease;
      },
      get createWorkOrderResult() {
        return suite.createWorkOrderResult;
      },
      get deliverySchedule() {
        return deliverySchedule;
      },
      get deliveryPlan() {
        return deliveryPlan;
      },
      get track() {
        return suite.track;
      },
      get verifyDeliveryTail() {
        return exitHooks?.deliveryTail ?? suite.verifyDeliveryTail;
      },
      get formalFixture() {
        return formalFixture;
      },
      get createExecutableTask() {
        return suite.createExecutableTask;
      },
      get readyTaskForValidation() {
        return suite.readyTaskForValidation;
      },
      get tePool() {
        return suite.tePool;
      },
      set tePool(value: typeof suite.tePool) {
        suite.tePool = value;
      },
      get firstRunCodes() {
        return firstRunCodes;
      },
      get read() {
        return read;
      },
      get bundleRef() {
        return bundleRef;
      },
      get runtimeBinding() {
        return runtimeBinding;
      },
      get firstRunQuery() {
        return firstRunQuery;
      },
      get createEnvelope() {
        return createEnvelope;
      },
      get dispatchEnvelope() {
        return dispatchEnvelope;
      },
      get controlsRef() {
        return controlsRef;
      },
      get attemptRef() {
        return attemptRef;
      },
      get runDeadline() {
        return runDeadline;
      },
      get waitForDeadline() {
        return suite.waitForDeadline;
      },
      get firstRunConfig() {
        return firstRunConfig;
      },
      get dispatched() {
        return dispatched;
      },
      get bundleValidUntil() {
        return bundleValidUntil;
      },
      get firstRunAuth() {
        return firstRunAuth;
      },
      get firstRunGrants() {
        return firstRunGrants;
      },
      get identityContext() {
        return suite.identityContext;
      },
      get observingDriver() {
        return observingDriver;
      },
      get startEnvelope() {
        return startEnvelope;
      },
      get eligibilityChange() {
        return eligibilityChange;
      },
      get progress() {
        return suite.progress;
      },
      get executionCapabilityGrantId() {
        return executionCapabilityGrantId;
      },
      get independentScenarioGrantIds() {
        return independentScenarioGrantIds;
      },
      get controlFields() {
        return controlFields;
      },
      get finalQuery() {
        return finalQuery;
      },
      get finalView() {
        return finalView;
      },
      get boardProbe() {
        return boardProbe;
      },
      get usageProbe() {
        return usageProbe;
      },
      get progressAuthorization() {
        return progressAuthorization;
      },
      get scanContext() {
        return scanContext;
      },
      get progressEnvelope() {
        return progressEnvelope;
      },
      get scanProof() {
        return scanProof;
      },
      get restartedEntry() {
        return restartedEntry;
      },
      get progressListAuthorization() {
        return progressListAuthorization;
      },
      set progressListAuthorization(value: typeof progressListAuthorization) {
        progressListAuthorization = value;
      },
      get auth() {
        return auth;
      },
      get observeRecovery() {
        return observeRecovery;
      },
      get restartedDriver() {
        return restartedDriver;
      },
      get queryWrites() {
        return queryWrites;
      },
      get progressListPayload() {
        return progressListPayload;
      },
      get resultBody() {
        return resultBody;
      },
      get resultTarget() {
        return resultTarget;
      },
      get submitEnvelope() {
        return submitEnvelope;
      },
      set submitEnvelope(value: typeof submitEnvelope) {
        submitEnvelope = value;
      },
      get processEnabled() {
        return processEnabled;
      },
      set processEnabled(value: typeof processEnabled) {
        processEnabled = value;
      },
      get resultRef() {
        return resultRef;
      },
      get acceptanceRecordRef() {
        return acceptanceRecordRef;
      },
      get firstRunEntryRaw() {
        return firstRunEntryRaw;
      },
      get otherChildContract() {
        return otherChildContract;
      },
      set otherChildContract(value: typeof otherChildContract) {
        otherChildContract = value;
      },
      get otherChildContractRef() {
        return otherChildContractRef;
      },
      set otherChildContractRef(value: typeof otherChildContractRef) {
        otherChildContractRef = value;
      },
      get otherChildContextRef() {
        return otherChildContextRef;
      },
      set otherChildContextRef(value: typeof otherChildContextRef) {
        otherChildContextRef = value;
      },
      get serviceId() {
        return serviceId;
      },
      get otherChildAttemptRef() {
        return otherChildAttemptRef;
      },
      set otherChildAttemptRef(value: typeof otherChildAttemptRef) {
        otherChildAttemptRef = value;
      },
      get otherChildResultRef() {
        return otherChildResultRef;
      },
      set otherChildResultRef(value: typeof otherChildResultRef) {
        otherChildResultRef = value;
      },
      get finalEvaluator() {
        return finalEvaluator;
      },
      get recoveryReceiptRollback() {
        return recoveryReceiptRollback;
      },
      get captureSlice() {
        return suite.captureSlice;
      },
      get captureRef() {
        return captureRef;
      },
      get contextSnapshotBuildRow() {
        return suite.contextSnapshotBuildRow;
      },
      get contextSnapshotRow() {
        return suite.contextSnapshotRow;
      },
      get recoveryBuilderRef() {
        return recoveryBuilderRef;
      },
      get throughRecoveryProcess() {
        return throughRecoveryProcess;
      },
      get attemptRead() {
        return suite.attemptRead;
      },
      get preparedRead() {
        return suite.preparedRead;
      },
      get faultFirstRunCommands() {
        return faultFirstRunCommands;
      },
      set faultFirstRunCommands(value: typeof faultFirstRunCommands) {
        faultFirstRunCommands = value;
      },
      get shortRecoveryBudget() {
        return shortRecoveryBudget;
      },
      get createAndReleaseFormalOutput() {
        return createAndReleaseFormalOutput;
      },
      get attemptBinding() {
        return attemptBinding;
      },
      get completeFormal() {
        return completeFormal;
      },
      get startSession() {
        return startSession;
      },
      get recordEnvelope() {
        return recordEnvelope;
      },
      get validateEnvelope() {
        return validateEnvelope;
      },
      get acceptEnvelope() {
        return acceptEnvelope;
      },
      set acceptEnvelope(value: typeof acceptEnvelope) {
        acceptEnvelope = value;
      },
      get finalizeEnvelope() {
        return finalizeEnvelope;
      },
      get resultQuery() {
        return resultQuery;
      },
      get terminalRunQuery() {
        return terminalRunQuery;
      },
      get queueEnvelope() {
        return queueEnvelope;
      },
    };

    suite.phase(`scenario ${terminalScenario}/${negativeFinalCase}: business preparation`);
    // This independent chain must not inherit the time spent running the
    // preceding 22 cases: the Decision lookup's bootstrap lease is 60s
    // from the trusted instant, and PostgreSQL checks it against wall time.
    // Run common precondition refusals once; every other case still produces
    // its own live Task/Draft/Context/READY/Run through the owning entries.
    const formal = terminalScenario.startsWith('FORMAL_');
    const delivery = terminalScenario.startsWith('FORMAL_DELIVERY_');
    const formalFixture = formal
      ? (JSON.parse(
          readFileSync(
            new URL(
              `../fixtures/task-execution/${delivery ? 'delivery-completion' : 'formal-completion'}/${terminalScenario === 'FORMAL_RECOVERED' || terminalScenario === 'FORMAL_DELIVERY_RECOVERED' || terminalScenario.startsWith('FORMAL_REQUEST_') ? 'recovered' : 'normal'}.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        ) as {
          taskCriteria: string[];
          workOrderCriteria: string[];
          runtimeTemplates: string[];
          expected: {
            runCount: number;
            workOrderStatus: string;
            taskStatus: string;
            completionUseStatus: string;
            completedEventsPerRoot: number;
          };
        })
      : undefined;
    const bounded =
      terminalScenario === 'BOUNDED_RECOVERY' ||
      terminalScenario === 'FORMAL_RECOVERED' ||
      terminalScenario === 'FORMAL_DELIVERY_RECOVERED' ||
      terminalScenario.startsWith('FORMAL_REQUEST_') ||
      // #244: the supported Human cancel path needs the two-attempt Controls
      // @1.1 profile and a real creation-time budget reservation. The
      // CANCEL-D-005 unsupported-profile phase deliberately uses the
      // single-attempt profile instead.
      (terminalScenario === 'RUN_CANCEL' && cancelVariant?.bounded !== false);
    // Exercise shared refusal, replay and fault matrices once on the normal chain.
    // Repeating it in every variant consumes the short-lived Context before
    // the variant reaches its own session/outcome/expiry boundary.
    const exerciseRecoveryFaultMatrix = !formal && bounded && recoveryVariant === 'NORMAL';
    const shortRecoveryBudget = recoveryVariant.startsWith('SECOND_');
    const exercisePreparationMatrix = terminalScenario === 'SUCCEEDED';
    const exerciseCommonReplayMatrix = exercisePreparationMatrix || exerciseRecoveryFaultMatrix;
    // Only the GRANT-loss variant revokes a shared Service Grant. Discard that
    // one cached fact after the owning revoke; all other Grants stay current.
    // Recovery and common fault matrices retain fresh subjects.
    const reuseIndependentPreparation =
      terminalScenario === 'ELIGIBILITY_CHANGE' ||
      [
        'UNSUPPORTED_FINAL',
        'NON_FINAL_CORE_REJECT',
        'RACE',
        'LOCK_DEADLINE',
        'VALIDATION_EXPIRED',
        'IG_WRONG_SESSION',
        'TERMINAL_BEFORE_FINAL',
      ].includes(terminalScenario);
    const positiveFinalScenario =
      terminalScenario === 'SUCCEEDED' ||
      terminalScenario === 'MIX_VALIDATIONS' ||
      terminalScenario === 'ACCEPT_RACE';
    suite.clock = Date.now();
    const preparedService = reuseIndependentPreparation ? independentScenarioService : undefined;
    const serviceId = preparedService?.principalId ?? newUuidV7();
    let service: Principal;
    if (preparedService) service = preparedService;
    else {
      const actorId = newUuidV7();
      await withIdentityTransaction(suite.identityDb, suite.identityContext([]), (trx) =>
        suite.identityRepo.insertPrincipal(trx, {
          id: serviceId,
          principalKind: 'SERVICE',
          displayName: 'WI-219 controlled validator',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
      const actorRef = await createActorSnapshot(suite.identityDeps([suite.fixture.projectId]), {
        actorSnapshotId: actorId,
        principalId: serviceId,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: suite.fixture.enterpriseId,
        projectId: suite.fixture.projectId,
      });
      service = {
        principalId: serviceId,
        principalKind: 'SERVICE',
        actorSnapshotId: actorId,
        actorRef,
        authHash: AUTH_HASH,
      };
      if (reuseIndependentPreparation) independentScenarioService = service;
    }
    const actorId = service.actorSnapshotId;
    const actorRef = service.actorRef;
    async function prepareScenarioGrant(input: Parameters<typeof suite.grant>[0]): Promise<string> {
      // Already prepared unlimited Grants can authorize independent Runs.
      // Every actual entry still issues and revalidates its own current Decision.
      const key = JSON.stringify({
        ...input,
        principal: input.principal?.principalId ?? OPERATOR,
      });
      const prepared = reuseIndependentPreparation
        ? independentScenarioGrantIds.get(key)
        : undefined;
      if (prepared !== undefined) return prepared;
      const id = await suite.grant(input);
      if (reuseIndependentPreparation) independentScenarioGrantIds.set(key, id);
      return id;
    }
    async function prepareScenarioGeneric(capabilityCode: string): Promise<void> {
      const key = `generic:${serviceId}:${capabilityCode}`;
      if (reuseIndependentPreparation && independentScenarioGrantIds.has(key)) return;
      const id = await suite.grantGeneric(capabilityCode, service);
      if (reuseIndependentPreparation) independentScenarioGrantIds.set(key, id);
    }
    const borrowedActors: Principal[] = [];
    if (
      exercisePreparationMatrix ||
      exerciseRecoveryFaultMatrix ||
      terminalScenario === 'FORMAL_NORMAL'
    ) {
      const otherServiceId = newUuidV7();
      await withIdentityTransaction(suite.identityDb, suite.identityContext([]), (trx) =>
        suite.identityRepo.insertPrincipal(trx, {
          id: otherServiceId,
          principalKind: bounded || formal ? 'AGENT' : 'SERVICE',
          displayName: 'WI-224 unrelated service',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
      for (const subject of [
        { principalId: otherServiceId, kind: bounded || formal ? 'AGENT' : 'SERVICE' },
        { principalId: OPERATOR, kind: 'HUMAN' },
      ] as const) {
        const snapshotId = newUuidV7();
        const snapshot = await createActorSnapshot(suite.identityDeps([suite.fixture.projectId]), {
          actorSnapshotId: snapshotId,
          principalId: subject.principalId,
          declaredPrincipalKind: subject.kind,
          authenticationContextHash: AUTH_HASH,
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
          ...(subject.kind === 'HUMAN'
            ? {
                actingForPrincipalId: serviceId,
                actingForKind: 'SERVICE' as const,
              }
            : {}),
        });
        borrowedActors.push({
          principalId: subject.principalId,
          principalKind: subject.kind,
          actorSnapshotId: snapshotId,
          actorRef: snapshot,
          authHash: AUTH_HASH,
        });
      }
    }
    for (const capability of [
      dependencyCapabilities.resolvePolicy,
      dependencyCapabilities.readContextSourceSlice,
      CAPTURE_CAPABILITY,
    ])
      await prepareScenarioGeneric(capability);
    for (const [capabilityCode, action, targetObjectType, selectorType] of [
      [
        contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
        ACTIONS.ctxBuild,
        CONTEXT_SNAPSHOT_OBJECT,
        'CREATE_TARGET_TYPE',
      ],
      [
        contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11,
        ACTIONS.ctxDraftRead,
        DRAFT_SNAPSHOT_OBJECT,
        'TARGET_TYPE',
      ],
    ] as const)
      await prepareScenarioGrant({
        principal: service,
        capabilityCode,
        action,
        targetObjectType,
        selectorType,
      });
    const codes = Object.fromEntries(
      WORK_ORDER_VALIDATION_BINDINGS.map((b, i) => [b.capabilityConfigKey, `wi219.auth.c${i}`]),
    ) as WorkOrderValidationCapabilityCodes;
    const validationGrants = new Map<string, string>();
    await suite.prepareIndependentGrants(WORK_ORDER_VALIDATION_BINDINGS, async (binding) => {
      const targetObjectType = binding.targetObjectTypes[0];
      if (targetObjectType === undefined) throw new Error('missing target');
      validationGrants.set(
        binding.capabilityConfigKey,
        await prepareScenarioGrant({
          principal: service,
          capabilityCode: codes[binding.capabilityConfigKey],
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType,
        }),
      );
    });
    const captureRef = policyKey([newUuidV7(), newUuidV7()], suite.fixture);
    await suite.registerPolicyVersionAs({
      key: captureRef,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)],
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [PURPOSE_DOCUMENT],
      },
    });
    const slice = await suite.captureSlice({
      principal: service,
      purpose: PURPOSE_DOCUMENT,
      capturePolicyRef: captureRef,
      idempotencyKey: newUuidV7(),
    });
    const candidate = JSON.parse(
      readFileSync(
        new URL(
          '../fixtures/contracts/work-order-validation/ready-candidate-valid.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    rewriteFixtureScopes(candidate, suite.fixture);
    const controlsRef = policyKey([newUuidV7(), newUuidV7()], suite.fixture),
      validationRef = policyKey([newUuidV7(), newUuidV7()], suite.fixture);
    const originalControls = record(record(candidate.versionPins).capabilityPolicyRef);
    function replaceControls(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(replaceControls);
      if (value !== null && typeof value === 'object') {
        if (
          record(value).objectId === originalControls.objectId &&
          record(value).versionId === originalControls.versionId
        )
          return controlsRef;
        return Object.fromEntries(
          Object.entries(value).map(([key, v]) => [key, replaceControls(v)]),
        );
      }
      return value;
    }
    const revised = replaceControls(candidate) as Record<string, unknown>;
    // The first Run subset requires a finite wall clock limit. The older
    // READY fixture only carried tokenLimit, which remains legal for Freeze.
    record(revised.budget).wallClockLimit =
      terminalScenario === 'LEGACY_UPGRADE'
        ? 'PT60S'
        : terminalScenario === 'ELIGIBILITY_CHANGE' ||
            terminalScenario === 'TIMED_OUT' ||
            terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
            terminalScenario === 'FORMAL_LATE' ||
            terminalScenario === 'IG_WRONG_SESSION' ||
            terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
            terminalScenario === 'UNSUPPORTED_FINAL' ||
            terminalScenario === 'NON_FINAL_CORE_REJECT'
          ? eligibilityChange?.whileLocked === true
            ? 'PT30S'
            : 'PT10S'
          : terminalScenario === 'RECOVERY_EXPIRE'
            ? 'PT30S'
            : terminalScenario === 'VALIDATION_EXPIRED'
              ? 'PT30S'
              : terminalScenario === 'RACE' ||
                  terminalScenario === 'LOCK_DEADLINE' ||
                  terminalScenario === 'FORMAL_TTL' ||
                  terminalScenario === 'RUN_CANCEL'
                ? 'PT30S'
                : 'PT600S';
    if (terminalScenario === 'FORMAL_TTL') record(revised.budget).wallClockLimit = 'PT30S';
    if (shortRecoveryBudget || ['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant))
      record(revised.budget).wallClockLimit = 'PT30S';
    // Static selectors are Platform-scoped; recursive fixture scope rewriting
    // is restricted to business refs and must not turn them into Project refs.
    for (const profile of workOrderReadyProfileRegistry.profiles) {
      if (profile.registryKey === 'core.work_order@1.0') {
        record(revised.header).schemaRef = profile.reference;
        record(revised.versionPins).workOrderSchemaRef = profile.reference;
      }
      if (profile.registryKey === 'te.human_operated.synthetic@1.0')
        record(revised.versionPins).runtimeAdapterContractRef = profile.reference;
      if (profile.registryKey === 'te.work_order.human_review@1.0')
        record(revised.riskAndQuality).riskProfileRef = profile.reference;
    }
    const quality = formalQualityFixture(
      createQualityGovernanceDatabase(suite.tePool),
      suite.runnerContext(),
      () => new Date(suite.clock),
    );
    const qualityProfile =
      terminalScenario === 'FORMAL_QUALITY' ? await quality.createProfile() : undefined;
    const completionRef = policyKey([newUuidV7(), newUuidV7()], suite.fixture);
    if (formal) {
      const output = record((revised.expectedOutputs as unknown[])[0]);
      output.allowedObjectTypes = ['artifact.artifact_revision'];
      output.schemaRef = executionDocumentSchemaReference(suite.fixture.enterpriseId);
      record(revised.targetScope).allowedCreateTypes = [
        'artifact.artifact',
        'artifact.artifact_revision',
      ];
      for (const group of ['allowedCapabilities', 'deniedCapabilities'])
        for (const cap of revised[group] as Record<string, unknown>[])
          cap.resourceSelectors = (cap.resourceSelectors as string[]).map((type) =>
            type.replace(/^zhiju\.artifact\./u, 'artifact.'),
          );
      record(revised.versionPins).runtimeAdapterContractRef =
        workOrderReadyProfileRegistry.profiles.find(
          (p) => p.registryKey === 'te.human_operated.synthetic.formal@1.0',
        )?.reference;
      revised.constraints = [
        { profile: 'execution.completion_binding.v1', policyRef: completionRef },
      ];
      if (qualityProfile) {
        record(revised.versionPins).qualityProfileRef = qualityProfile.profileRef;
        record(revised.riskAndQuality).qualityProfileRef = qualityProfile.profileRef;
      }
      revised.completionCriteria = definedValue(formalFixture).workOrderCriteria.map((type) => ({
        criterionId: newUuidV7(),
        criterionType: type,
        required: true,
        expectedCondition: 'satisfied',
        failureDisposition: 'block_until_satisfied',
        evaluatorRef: registeredEvaluatorProfileReference(
          'im06-evaluator-static-v1',
          'te.work_order_completion.evaluator@1.0',
        ),
        inputBindings: [
          type === 'NO_BLOCKING_INFORMATION_REQUEST'
            ? 'informationRequests'
            : type === 'REQUIRED_PROPOSAL_PROCESSED'
              ? 'requiredProposals'
              : `expectedOutput.${String(output.outputSlot)}`,
        ],
      }));
      await suite.registerPolicyVersionAs({
        key: completionRef,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference('execution.completion.policy@1.0')],
        policyDocument: { maxCompletionValiditySeconds: 600 },
      });
    }
    const evaluator = registeredEvaluatorProfileReference(
      'im06-evaluator-static-v1',
      formal ? 'te.work_order_validation.evaluator@2.0' : 'te.work_order_validation.evaluator@1.0',
    );
    for (const criterion of revised.completionCriteria as Record<string, unknown>[])
      if (!formal) criterion.evaluatorRef = evaluator;
    const preallocatedTask = delivery ? (deliverySchedule?.taskId ?? newUuidV7()) : undefined;
    const deliveryPlan = delivery
      ? (deliverySchedule?.plan ??
        (await createDeliveryCompletionPlanFixture(
          suite.enterpriseProjectDb,
          suite.runnerContext(),
          definedValue(preallocatedTask),
          deliveryRequiredRelease,
          () => new Date(suite.clock),
          async (type, payload) => {
            const capability = `wi239.plan.${type.replaceAll('.', '_')}.${definedValue(preallocatedTask).replaceAll('-', '')}`;
            await suite.grantGeneric(capability);
            const decision = await suite.authorizeCommandTracked(
              suite.identityDeps([suite.fixture.projectId]),
              {
                actorSnapshotRef: suite.operatorActorRef,
                intent: {
                  commandType: type,
                  commandVersion: '1.0',
                  scopeKind: 'PROJECT',
                  enterpriseId: suite.fixture.enterpriseId,
                  projectId: suite.fixture.projectId,
                  purpose: type,
                  requestedCapability: capability,
                  commandPayloadHash: digestCanonicalPayload(payload).hash,
                  requestedAt: new Date(suite.clock),
                  highRiskAction: false,
                },
                authenticationContextHash: AUTH_HASH,
                policySnapshotRef: suite.grantPolicySnapshotReference(),
                ttlSeconds: 900,
              },
            );
            expect(decision.outcome, JSON.stringify(decision)).toBe('ALLOW');
            return {
              ...suite.runnerContext(),
              authorizationDecisionId: decision.authorizationDecisionRef.objectId,
              authorizationDecisionHash: Buffer.from(
                decision.authorizationDecisionRef.contentHash.digest,
                'hex',
              ),
              authorizationDecisionExpiresAt: new Date(decision.expiresAt),
            };
          },
          deliverySchedule?.additionalTaskIds,
        )))
      : undefined;
    const taskId = await suite.createExecutableTask(
      '2.0',
      true,
      formal
        ? {
            ...(deliveryPlan ? { deliveryItemRef: deliveryPlan.deliveryItemRef } : {}),
            expectedOutputSpec: { schemaVersion: '1.0', outputs: revised.expectedOutputs },
            completionCriteria: {
              schemaVersion: '1.0',
              criteria: [
                ...definedValue(formalFixture).taskCriteria,
                ...(qualityProfile ? ['REVISION_ACCEPTANCE_READY', 'REVISION_FULLY_APPROVED'] : []),
              ].map((type) => ({
                criterionId: `criterion.${type.toLowerCase()}`,
                criterionType: type,
                required: true,
                evaluatorRef: registeredEvaluatorProfileReference(
                  'im06-evaluator-static-v1',
                  'te.task_completion.evaluator@1.0',
                ),
                bindings:
                  type === 'NO_BLOCKING_INFORMATION_REQUEST'
                    ? { scope: 'TASK_AND_CHILD_WORK_ORDERS' }
                    : type === 'REQUIRED_WORK_ORDERS_COMPLETED'
                      ? { scope: 'ALL_CHILD_WORK_ORDERS' }
                      : { outputSlots: ['revision'] },
                expectedCondition: { satisfied: true },
                failureDisposition: 'BLOCK',
              })),
            },
          }
        : undefined,
      false,
      preallocatedTask,
      exitHooks?.stage,
    );
    revised.taskRef = objectRef(TASK_V2, taskId, suite.scope());
    revised.projectRef = objectRef('zhiju.project.project', suite.fixture.projectId, suite.scope());
    revised.requestedBy = { principalId: OPERATOR, principalKind: 'HUMAN' };
    revised.inputRefs = [
      {
        inputRole: 'context',
        ref: slice,
        required: true,
        permittedUse: PURPOSE_DOCUMENT,
        contentAccessMode: 'REFERENCE_ONLY',
        integrityRequired: true,
      },
    ];
    const recoveryBuilderRef =
      recoveryVariant === 'BUILDER_SUPERSEDED'
        ? policyKey([newUuidV7(), newUuidV7()], suite.fixture)
        : policyKey(BUILDER_POLICY.main, suite.fixture);
    if (recoveryVariant === 'BUILDER_SUPERSEDED')
      await suite.registerPolicyVersionAs({
        key: recoveryBuilderRef,
        factId: newUuidV7(),
        idempotencyKey: newUuidV7(),
        effectiveFrom: PAST,
        policySchemaRefs: [profileReference(BUILDER_PROFILE)],
        policyDocument: { allowedProjectionTypes: ['COORDINATOR'] },
      });
    record(revised.versionPins).contextBuilderPolicyRef = recoveryBuilderRef;
    for (const group of ['allowedCapabilities', 'deniedCapabilities'])
      for (const cap of revised[group] as Record<string, unknown>[])
        cap.expiresAt = new Date(suite.clock + 3600_000).toISOString();
    if (bounded) {
      record(revised.executionPolicy).maxAttempts = 2;
      record(revised.executionPolicy).retryableOutcomes = ['BLOCKED_INPUT'];
      delete record(revised.budget).tokenLimit;
      delete record(revised.budget).toolCallLimit;
      delete record(revised.budget).monetaryLimit;
    }
    if (terminalScenario === 'RUN_CANCEL')
      // The Human cancel Handler deep-equals payload.cancellationPolicyRef
      // against the frozen contract and requires it to resolve USABLE, so pin
      // it to the registered Controls PolicyVersion.
      record(revised.executionPolicy).cancellationPolicyRef = controlsRef;
    const controlFields = [
      'targetScope',
      'allowedCapabilities',
      'deniedCapabilities',
      'expectedOutputs',
      'riskAndQuality',
      'executionPolicy',
      'budget',
      'harnessPolicy',
      'modelPolicy',
    ];
    await suite.registerPolicyVersionAs({
      key: controlsRef,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [
        profileReference(
          formal
            ? 'execution.work_order_controls.policy@2.0'
            : bounded
              ? 'execution.work_order_controls.policy@1.1'
              : 'execution.work_order_controls.policy@1.0',
        ),
      ],
      policyDocument: {
        ...(formal ? { completionPolicyRef: completionRef } : {}),
        ...(bounded
          ? {
              recovery: {
                answerSpecProfile: 'execution.answer.customer_material.v1',
                requestType: 'execution.input.customer_material_confirmation',
                responderRole: 'project.customer_material.confirmer',
                maxBlockingRequests: 1,
                maxRecoveryRuns: 1,
                retryReason: 'BLOCKED_INPUT_RESOLVED',
                run2Outcome: 'COMPLETED',
                materialUse: 'REFERENCE_ONLY',
              },
            }
          : {}),
        controls: Object.fromEntries(controlFields.map((k) => [k, revised[k]])),
      } as unknown as CanonicalJsonObject,
    });
    await suite.registerPolicyVersionAs({
      key: validationRef,
      factId: newUuidV7(),
      idempotencyKey: newUuidV7(),
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference('execution.work_order_validation.policy@1.0')],
      policyDocument: { maxValidationValiditySeconds: 600 },
    });
    const draft = Object.fromEntries(
      Object.entries(revised).filter(
        ([key]) =>
          ![
            'header',
            'workOrderRef',
            'projectRef',
            'contextSnapshotRef',
            'issuedAt',
            'expiresAt',
            'specificationHash',
          ].includes(key),
      ),
    );
    const { projectContextContractRef: _, ...draftPins } = record(draft.versionPins);
    void _;
    draft.versionPins = draftPins;
    // The CANCEL-D-006 CLEANUP row needs a naturally expired execution Bundle
    // and lease: the row-level Bundle is immutable, so its validity and the
    // lease bound are shortened at issue time instead.
    const expiresAt = new Date(
      suite.clock +
        (terminalScenario === 'RUN_CANCEL' && cancelVariant?.phase === 'CLEANUP'
          ? 15_000
          : 3600_000),
    ).toISOString();
    const woId = await suite.createWorkOrder({
      taskId,
      taskMajor: '2.0',
      customDraft: draft,
      expiresAt,
    });
    const otherChildId =
      recoveryVariant === 'OTHER_CHILD'
        ? await suite.createWorkOrder({
            taskId,
            taskMajor: '2.0',
            customDraft: structuredClone(draft),
            expiresAt,
          })
        : undefined;
    const draftRef = await suite.draftSnapshotRefOf(woId);
    const contextBuild = await suite.initialContextEntry.build(
      await suite.preparedBuild({
        workOrderId: woId,
        draftRef,
        principal: service,
        sourceSlices: [slice],
        builderPolicyRef: recoveryBuilderRef,
        idempotencyKey: newUuidV7(),
      }),
      suite.sessionFor(service),
    );
    expect(contextBuild, JSON.stringify(contextBuild)).toMatchObject({ status: 'COMMITTED' });
    const contextRef = suite.contextSnapshotRefOf(contextBuild);
    if (terminalScenario === 'LEGACY_UPGRADE') {
      suite.phase('historical WorkOrder Validation upgrade');
      await verifyWorkOrderValidationUpgrade(suite.admin, suite.fixture.enterpriseId);
      suite.phase('Validation preparation');
    }
    revised.workOrderRef = objectRef(WORK_ORDER_V11, woId, suite.scope());
    revised.contextSnapshotRef = contextRef;
    record(revised.versionPins).projectContextContractRef = contextRef;
    revised.expiresAt = expiresAt;
    revised.issuedAt = new Date(suite.clock).toISOString();
    revised.header = {
      ...record(revised.header),
      contractId: newUuidV7(),
      issuedAt: revised.issuedAt,
      issuedBy: { principalId: serviceId, principalKind: 'SERVICE' },
    };
    const specFields = [
      'objective',
      'targetScope',
      'inputRefs',
      'contextSnapshotRef',
      'constraints',
      'allowedCapabilities',
      'deniedCapabilities',
      'expectedOutputs',
      'completionCriteria',
      'riskAndQuality',
      'executionPolicy',
      'budget',
      'harnessPolicy',
      'modelPolicy',
      'versionPins',
    ];
    revised.specificationHash = contentHash(
      sha256CanonicalJson(
        Object.fromEntries(specFields.map((k) => [k, revised[k]])) as CanonicalJsonObject,
      ),
    );
    record(revised.header).payloadHash = contentHash(
      hashContractPayload(revised as CanonicalJsonObject),
    );
    const artifactDb = createArtifactDatabase(suite.tePool);
    const artifactStorage = new InMemoryObjectStorage();
    const formalCodes = Object.fromEntries(
      formalCompletionBindings().map((b, i) => [
        b.capabilityConfigKey,
        `wi235.auth.c${i}.${serviceId.replaceAll('-', '')}`,
      ]),
    );
    const formalAuthorization = {
      capabilityCodes: formalCodes,
      servicePrincipalIds: {
        artifact: serviceId,
        evaluator: serviceId,
        validator: serviceId,
        driver: serviceId,
        taskExecution: [serviceId],
      },
      now: () => new Date(suite.clock),
    };
    const formalAuth = createFormalCompletionAuthorizationPort(formalAuthorization);
    let bindingProof: (() => Promise<void>) | undefined;
    let outputProof: (() => Promise<void>) | undefined;
    async function formalEnvelope(
      key: string,
      targetRef: Common.ObjectRef | Common.ContentAddressedRef,
      payload: CanonicalJsonObject,
      principal = service,
      expectedAggregateVersion?: number,
      query = false,
    ) {
      suite.clock = Math.max(suite.clock, Date.now());
      const mapping = definedValue(
        formalCompletionBindings().find((b) => b.capabilityConfigKey === key),
      );
      const payloadHash = digestCanonicalPayload(payload).hash;
      const issued = await formalAuth.authorize(
        suite.identityDeps([suite.fixture.projectId], principal),
        key,
        {
          actorSnapshotRef: principal.actorRef,
          commandType: mapping.commandType,
          commandVersion: mapping.commandVersion,
          commandPayloadHash: payloadHash,
          authenticationContextHash: AUTH_HASH,
          targetRef: targetRef,
        },
      );
      expect(issued.outcome, JSON.stringify(issued)).toBe('ALLOW');
      if (issued.outcome !== 'ALLOW') throw new Error('Formal authorization denied');
      const revalidate = async () => {
        const r = await formalAuth.revalidate(
          suite.identityDeps([suite.fixture.projectId], principal),
          key,
          {
            decisionRef: issued.authorizationDecisionRef,
            expectedCommandType: mapping.commandType,
            expectedCommandVersion: mapping.commandVersion,
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: targetRef,
          },
        );
        if (!r.valid) throw new Error(`Formal authorization revoked: ${key}`);
      };
      if (key === 'outputCreationBindingReadV1') bindingProof = revalidate;
      if (key === 'executionOutputReadV1') outputProof = revalidate;
      return query
        ? {
            queryId: newUuidV7(),
            queryType: mapping.commandType,
            queryVersion: mapping.commandVersion,
            scopeRef: suite.scope(),
            requester: principal.actorRef,
            authorizationDecisionRef: issued.authorizationDecisionRef,
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'identity.authentication_context',
              objectId: principal.principalId,
              scope: suite.scope(),
              contentHash: contentHash(AUTH_HASH.toString('hex')),
            },
            consistencyRequirement: 'AUTHORITATIVE',
            correlationId: newUuidV7(),
            requestedAt: new Date(suite.clock).toISOString(),
            payload,
          }
        : {
            commandId: newUuidV7(),
            commandType: mapping.commandType,
            commandVersion: mapping.commandVersion,
            scopeRef: suite.scope(),
            targetRef,
            actor: principal.actorRef,
            authorizationDecisionRef: issued.authorizationDecisionRef,
            idempotencyKey: newUuidV7(),
            correlationId: newUuidV7(),
            requestedAt: new Date(suite.clock).toISOString(),
            ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
            payload,
            integrity: {
              canonicalizationVersion: '1',
              payloadHash: contentHash(payloadHash.toString('hex')),
            },
          };
    }
    const formalConfig: FormalCompletionEntryConfig = {
      taskExecutionDb: deliverySchedule?.completionPlugin
        ? suite.teDb.withPlugin(deliverySchedule.completionPlugin)
        : suite.teDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      capabilities: dependencyCapabilities,
      formalAuthorization,
      artifactDb,
      artifactStorage,
      qualityDb: createQualityGovernanceDatabase(suite.tePool),
      now: () => new Date(suite.clock),
      revalidateOutputCreationBinding: async () => {
        if (!bindingProof) throw new Error('Missing Artifact Service binding proof');
        await bindingProof();
      },
      readOutputCreationBinding: async (runRef) =>
        formalEntry.readBinding(
          await formalEnvelope(
            'outputCreationBindingReadV1',
            runRef,
            { runRef } as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          suite.sessionFor(service),
        ),
      ...(bounded ? { recoveryConfig: () => recoveryConfig } : {}),
      get driver() {
        return {
          runtime: runtimeDriver,
          ports: {
            revalidateAuthorization: async () => {
              if (outputProof) await outputProof();
            },
            readExecutionOutput: async (revisionRef: Common.ContentAddressedRef) =>
              formalEntry.readOutput(
                await formalEnvelope(
                  'executionOutputReadV1',
                  revisionRef,
                  { revisionRef } as unknown as CanonicalJsonObject,
                  service,
                  undefined,
                  true,
                ),
                suite.sessionFor(service),
              ) as unknown as Promise<CanonicalJsonObject>,
          },
        };
      },
    };
    const formalEntry = createFormalCompletionEntry(formalConfig);
    const formalGrants = new Map<string, string>();
    if (formal)
      await suite.prepareIndependentGrants(formalCompletionBindings(), async (b) => {
        const principal = b.expectedPrincipalKind === 'HUMAN' ? suite.operator() : service;
        formalGrants.set(
          b.capabilityConfigKey,
          await suite.grant({
            principal,
            capabilityCode: definedValue(formalCodes[b.capabilityConfigKey]),
            action: b.requiredGrantAction,
            selectorType: b.selectorType,
            targetObjectType: definedValue(b.targetObjectTypes[0]),
            targetObjectTypes: b.targetObjectTypes,
          }),
        );
        if (
          b.capabilityConfigKey.startsWith('readinessBuild') ||
          b.capabilityConfigKey.startsWith('readinessConsume')
        ) {
          await suite.grant({
            principal: suite.operator(),
            capabilityCode: definedValue(formalCodes[b.capabilityConfigKey]),
            action: b.requiredGrantAction,
            selectorType: b.selectorType,
            targetObjectType: definedValue(b.targetObjectTypes[0]),
            targetObjectTypes: b.targetObjectTypes,
          });
        }
      });
    const entry = createWorkOrderValidationEntry({
      taskExecutionDb: suite.teDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      capabilityCodes: codes,
      capabilities: dependencyCapabilities,
      now: () => new Date(suite.clock),
      ...(formal ? { formalCompletion: formalConfig } : {}),
    });
    const auth = createWorkOrderValidationAuthorizationPort({
      capabilityCodes: codes,
      now: () => new Date(suite.clock),
    });
    async function envelope(
      commandType: string,
      payload: CanonicalJsonObject,
      targetRef: Common.ObjectRef,
      freeze = false,
    ) {
      const payloadHash = digestCanonicalPayload(payload).hash;
      const signed = await (
        freeze
          ? auth.authorizeWorkOrderFreeze.bind(auth)
          : auth.authorizeWorkOrderValidation.bind(auth)
      )(suite.identityDeps([suite.fixture.projectId], service), {
        actorSnapshotRef: actorRef,
        commandType,
        commandVersion: '1.0',
        commandPayloadHash: payloadHash,
        authenticationContextHash: AUTH_HASH,
        targetRef,
      });
      expect(signed.outcome).toBe('ALLOW');
      return {
        commandId: newUuidV7(),
        commandType,
        commandVersion: '1.0',
        scopeRef: suite.scope(),
        targetRef,
        actor: actorRef,
        authorizationDecisionRef: signed.authorizationDecisionRef,
        idempotencyKey: newUuidV7(),
        correlationId: newUuidV7(),
        requestedAt: new Date(suite.clock).toISOString(),
        ...(freeze ? { expectedAggregateVersion: 1 } : {}),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(payloadHash.toString('hex')),
        },
      };
    }
    const validationEnvelope = await envelope(
      'execution.validate_work_order_draft',
      {
        draftSnapshotRef: draftRef,
        candidateContract: revised,
        policyRef: validationRef,
        evaluatorRef: evaluator,
      } as unknown as CanonicalJsonObject,
      objectRef(
        'zhiju.execution.work_order_validation',
        newUuidV7(),
        suite.scope(),
      ) as unknown as Common.ObjectRef,
    );
    if (exercisePreparationMatrix) {
      suite.phase('Validation refusal matrix');
      // Own and dependency authorization failures precede the command claim.
      for (const key of [
        'workOrderValidationDraftReadV1',
        'workOrderValidationContextReadV1',
      ] as const) {
        const deniedEntry = createWorkOrderValidationEntry({
          taskExecutionDb: suite.teDb,
          enterpriseProjectDb: suite.enterpriseProjectDb,
          identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
          capabilityCodes: { ...codes, [key]: 'wi219.ungranted' },
          capabilities: dependencyCapabilities,
          now: () => new Date(suite.clock),
        });
        await expect(
          deniedEntry.validate(validationEnvelope, suite.sessionFor(service)),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
        expect(await suite.receiptRows(validationEnvelope.idempotencyKey)).toEqual([]);
      }
      await expect(
        entry.validate(
          {
            ...validationEnvelope,
            targetRef: objectRef(
              'zhiju.execution.work_order_validation',
              newUuidV7(),
              suite.scope(),
            ),
          },
          suite.sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      expect(await suite.receiptRows(validationEnvelope.idempotencyKey)).toEqual([]);
      const forged = structuredClone(revised);
      record(forged.header).payloadHash = contentHash('f'.repeat(64));
      const forgedEnvelope = await envelope(
        'execution.validate_work_order_draft',
        { ...validationEnvelope.payload, candidateContract: forged } as CanonicalJsonObject,
        objectRef(
          'zhiju.execution.work_order_validation',
          newUuidV7(),
          suite.scope(),
        ) as unknown as Common.ObjectRef,
      );
      await expect(entry.validate(forgedEnvelope, suite.sessionFor(service))).rejects.toMatchObject(
        {
          code: 'PAYLOAD_HASH_MISMATCH',
        },
      );
      expect(await suite.receiptRows(forgedEnvelope.idempotencyKey)).toEqual([]);
    }
    suite.phase('Validation and SQL guard matrix');
    const validated = await entry.validate(validationEnvelope, suite.sessionFor(service));
    expect(validated, JSON.stringify(validated)).toMatchObject({ status: 'COMMITTED' });
    const judgmentRef = record(
      record(suite.committedPayload(validated)).data,
    ).validationSnapshotRef;
    const judgmentId = record(judgmentRef).objectId as string;
    const judgmentPayload = definedValue(
      (
        await suite.admin.query<{ canonical_payload: Record<string, unknown> }>(
          'SELECT canonical_payload FROM task_execution.execution_judgment WHERE judgment_id=$1',
          [judgmentId],
        )
      ).rows[0],
    ).canonical_payload;
    expect(record(judgmentPayload.validation).executable).toBe(true);
    if (await verifyPreparationValidation(stageDependencies)) return;
    suite.phase('Freeze fault and concurrency matrix');
    let freezeEnvelope = await envelope(
      'execution.freeze_work_order',
      {
        workOrderContract: revised,
        validationSnapshotRef: judgmentRef,
        specificationHash: revised.specificationHash,
      } as CanonicalJsonObject,
      revised.workOrderRef as Common.ObjectRef,
      true,
    );
    if (exercisePreparationMatrix) {
      // A real owning call fails after the Outbox insert. All TE writes,
      // including the claim, pointer, Contract and edges, must roll back.
      await suite.admin.query(
        `CREATE FUNCTION public.wi219_freeze_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.aggregate_id='${woId}'::uuid AND NEW.event_type='execution.WorkOrderBecameReady' THEN RAISE EXCEPTION 'WI219_FREEZE_FAULT'; END IF; RETURN NEW; END $f$`,
      );
      await suite.admin.query(
        'CREATE TRIGGER wi219_freeze_fault AFTER INSERT ON task_execution.outbox_event FOR EACH ROW EXECUTE FUNCTION public.wi219_freeze_fault()',
      );
      try {
        await expect(entry.freeze(freezeEnvelope, suite.sessionFor(service))).rejects.toThrow(
          'WI219_FREEZE_FAULT',
        );
      } finally {
        await suite.admin.query('DROP TRIGGER wi219_freeze_fault ON task_execution.outbox_event');
        await suite.admin.query('DROP FUNCTION public.wi219_freeze_fault()');
      }
      expect(await suite.receiptRows(freezeEnvelope.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query(
            'SELECT count(*)::int AS n FROM task_execution.work_order_contract WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(
        (
          await suite.admin.query(
            'SELECT status,frozen_contract_id FROM task_execution.work_order WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([{ status: 'DRAFT', frozen_contract_id: null }]);
      expect(await suite.outboxRows(woId)).toEqual([]);
      const competingEnvelope = await envelope(
        'execution.freeze_work_order',
        freezeEnvelope.payload,
        revised.workOrderRef as Common.ObjectRef,
        true,
      );
      const candidates = [freezeEnvelope, competingEnvelope];
      const outcomes = await Promise.allSettled(
        candidates.map((candidate) => entry.freeze(candidate, suite.sessionFor(service))),
      );
      const winner = outcomes.findIndex(
        (result) => result.status === 'fulfilled' && result.value.status === 'COMMITTED',
      );
      expect(winner, JSON.stringify(outcomes)).toBeGreaterThanOrEqual(0);
      expect(
        outcomes.filter(
          (result) => result.status === 'fulfilled' && result.value.status === 'COMMITTED',
        ),
      ).toHaveLength(1);
      const loser = outcomes[1 - winner];
      expect(loser).toMatchObject({
        status: 'rejected',
        reason: { code: 'AGGREGATE_STATE_NOT_ALLOWED' },
      });
      const winningEnvelope = candidates[winner];
      if (winningEnvelope === undefined) throw new Error('missing winning Envelope');
      freezeEnvelope = winningEnvelope;
      await expect(
        entry.freeze(
          competingEnvelope === winningEnvelope ? candidates[0] : competingEnvelope,
          suite.sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'AGGREGATE_STATE_NOT_ALLOWED' });
    }
    if (!exercisePreparationMatrix) {
      expect(await entry.freeze(freezeEnvelope, suite.sessionFor(service))).toMatchObject({
        status: 'COMMITTED',
      });
    }
    if (exerciseCommonReplayMatrix) {
      expect(await entry.freeze(freezeEnvelope, suite.sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
      expect(await entry.validate(validationEnvelope, suite.sessionFor(service))).toMatchObject({
        status: 'DUPLICATE',
      });
    }
    if (exercisePreparationMatrix) {
      const staleBuild = await suite.initialContextEntry.build(
        await suite.preparedBuild({
          workOrderId: woId,
          draftRef,
          principal: service,
          sourceSlices: [slice],
          idempotencyKey: newUuidV7(),
        }),
        suite.sessionFor(service),
      );
      expect(staleBuild).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_DRAFT_SNAPSHOT_STALE,
      });
    }
    const queryPayload = { workOrderRef: revised.workOrderRef };
    const readDecision = await auth.authorizeWorkOrderContractRead(
      suite.identityDeps([suite.fixture.projectId], service),
      {
        actorSnapshotRef: actorRef,
        commandType: 'execution.get_work_order_contract',
        commandVersion: '1.0',
        targetRef: revised.workOrderRef as Common.ObjectRef,
        commandPayloadHash: digestCanonicalPayload(queryPayload as CanonicalJsonObject).hash,
        authenticationContextHash: AUTH_HASH,
      },
    );
    const read = await entry.read(
      {
        queryId: newUuidV7(),
        queryType: 'execution.get_work_order_contract',
        queryVersion: '1.0',
        scopeRef: suite.scope(),
        requester: objectRef(PRINCIPAL_OBJECT, serviceId, suite.scope()),
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: actorId,
          scope: suite.scope(),
          contentHash: contentHash(AUTH_HASH.toString('hex')),
        },
        authorizationDecisionRef: readDecision.authorizationDecisionRef,
        consistencyRequirement: 'AUTHORITATIVE',
        correlationId: newUuidV7(),
        requestedAt: new Date(suite.clock).toISOString(),
        payload: queryPayload,
      },
      suite.sessionFor(service),
    );
    expect(read.workOrderContract).toEqual(revised);
    if (exercisePreparationMatrix) {
      // Historical success does not preserve a revoked dependency Grant.
      const revokedGrant = validationGrants.get('workOrderFreezeDraftReadV1');
      if (revokedGrant === undefined) throw new Error('missing Freeze Draft Grant');
      expect(
        await suite.revokeCapabilityTracked(suite.identityDeps([suite.fixture.projectId]), {
          targetId: revokedGrant,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
          },
          reasonCode: 'WI219_REVOKE_FREEZE_DRAFT_READ',
          effectiveAt: new Date(suite.clock),
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
      await expect(entry.freeze(freezeEnvelope, suite.sessionFor(service))).rejects.toMatchObject({
        code: 'AUTHORIZATION_REVOKED',
      });

      await expect(
        withTaskExecutionTransaction(suite.teDb, suite.runnerContext(service), (trx) =>
          sql`UPDATE task_execution.work_order_contract SET canonical_payload=canonical_payload WHERE work_order_id=${woId}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        suite.admin.query(
          'UPDATE task_execution.work_order_contract SET canonical_payload=canonical_payload WHERE work_order_id=$1',
          [woId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        suite.admin.query(
          'UPDATE task_execution.work_order SET frozen_contract_hash=$2 WHERE work_order_id=$1',
          [woId, Buffer.alloc(32, 7)],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const hidden = await withTaskExecutionTransaction(
        suite.teDb,
        { ...suite.runnerContext(service), allowedProjectIds: [newUuidV7()] },
        (trx) =>
          sql`SELECT contract_id FROM task_execution.work_order_contract WHERE work_order_id=${woId}::uuid`.execute(
            trx,
          ),
      );
      expect(hidden.rows).toEqual([]);
    }
    expect(
      (
        await suite.admin.query(
          'SELECT status,aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
          [woId],
        )
      ).rows,
    ).toEqual([{ status: 'READY', aggregate_version: '2' }]);
    expect(
      (
        await suite.admin.query(
          "SELECT count(*)::int AS n FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.WorkOrderBecameReady'",
          [woId],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);

    await exitHooks?.stage?.('WORK_ORDER_READY', {
      taskId,
      contract: read,
    });
    let otherChildContract: Record<string, unknown> | undefined;
    let otherChildContractRef: unknown;
    let otherChildContextRef: unknown;
    if (otherChildId) {
      const childDraftRef = await suite.draftSnapshotRefOf(otherChildId);
      const builtChild = await suite.initialContextEntry.build(
        await suite.preparedBuild({
          workOrderId: otherChildId,
          draftRef: childDraftRef,
          principal: service,
          sourceSlices: [slice],
          builderPolicyRef: recoveryBuilderRef,
          idempotencyKey: newUuidV7(),
        }),
        suite.sessionFor(service),
      );
      otherChildContextRef = suite.contextSnapshotRefOf(builtChild);
      otherChildContract = structuredClone(revised);
      otherChildContract.workOrderRef = objectRef(WORK_ORDER_V11, otherChildId, suite.scope());
      otherChildContract.contextSnapshotRef = otherChildContextRef;
      record(otherChildContract.versionPins).projectContextContractRef = otherChildContextRef;
      record(otherChildContract.header).contractId = newUuidV7();
      otherChildContract.specificationHash = contentHash(
        sha256CanonicalJson(
          Object.fromEntries(
            specFields.map((key) => [key, definedValue(otherChildContract)[key]]),
          ) as CanonicalJsonObject,
        ),
      );
      record(otherChildContract.header).payloadHash = contentHash(
        hashContractPayload(otherChildContract as CanonicalJsonObject),
      );
      const validation = await entry.validate(
        await envelope(
          'execution.validate_work_order_draft',
          {
            ...validationEnvelope.payload,
            draftSnapshotRef: childDraftRef,
            candidateContract: otherChildContract,
          } as unknown as CanonicalJsonObject,
          objectRef(
            'zhiju.execution.work_order_validation',
            newUuidV7(),
            suite.scope(),
          ) as Common.ObjectRef,
        ),
        suite.sessionFor(service),
      );
      const validationRef = record(
        record(suite.committedPayload(validation)).data,
      ).validationSnapshotRef;
      const frozen = await entry.freeze(
        await envelope(
          'execution.freeze_work_order',
          {
            workOrderContract: otherChildContract,
            validationSnapshotRef: validationRef,
            specificationHash: otherChildContract.specificationHash,
          } as CanonicalJsonObject,
          otherChildContract.workOrderRef as Common.ObjectRef,
          true,
        ),
        suite.sessionFor(service),
      );
      expect(frozen).toMatchObject({ status: 'COMMITTED' });
      otherChildContractRef = record(suite.committedPayload(frozen)).workOrderContractRef;
    }
    suite.phase('Run authorization and preparation');
    // #221 starts from this committed READY fact. Each boundary receives
    // its own current Grant and target-bound Decision.
    suite.clock = Date.now();
    const firstRunCodes = Object.fromEntries(
      CONTROLLED_FIRST_RUN_BINDINGS.map((binding, index) => [
        binding.boundary,
        `wi221.auth.c${index}.${serviceId.replaceAll('-', '')}`,
      ]),
    ) as ControlledFirstRunCapabilityCodes;
    const firstRunGrants = new Map<string, string>();
    await suite.prepareIndependentGrants(CONTROLLED_FIRST_RUN_BINDINGS, async (binding) => {
      const targetObjectType = binding.targetObjectTypes[0];
      if (targetObjectType === undefined) throw new Error('missing first Run target');
      firstRunGrants.set(
        binding.boundary,
        await prepareScenarioGrant({
          principal: binding.expectedPrincipalKind === 'HUMAN' ? suite.operator() : service,
          capabilityCode: firstRunCodes[binding.boundary],
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType,
        }),
      );
    });
    const executionCapabilityGrantId = await prepareScenarioGrant({
      principal: service,
      capabilityCode: 'artifact.revision.create',
      action: 'create',
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: formal ? 'artifact.artifact_revision' : 'zhiju.artifact.artifact_revision',
      ...(terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED'
        ? { validTo: new Date(suite.clock + 45_000) }
        : {}),
    });
    const firstRunAuth = createControlledFirstRunAuthorizationPort({
      capabilityCodes: firstRunCodes,

      now: () => new Date(suite.clock),
    });
    const outputExamples = JSON.parse(
      readFileSync(
        new URL('../fixtures/contracts/core/agent-result-valid.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, unknown>;
    rewriteFixtureScopes(outputExamples, suite.fixture);
    const example = (field: string): unknown => {
      const values = outputExamples[field];
      if (!Array.isArray(values) || values.length === 0)
        throw new Error(`missing AgentResult ${field} fixture`);
      return structuredClone(values[0] as unknown);
    };
    const businessOutput = (runRef: unknown) => {
      const output = record(example('businessOutputs'));
      output.createdByRunRef = runRef;
      if (negativeFinalCase === 'ARTIFACT_ALIAS') {
        output.objectType = 'artifact.artifact_revision';
        record(output.ref).objectType = 'artifact.artifact_revision';
      }
      return output;
    };
    const queryReads: string[] = [];
    const queryWrites: string[] = [];
    let budgetFinalizationWaitAt: number | undefined;
    let budgetAcceptanceRead = false;
    let budgetWaitQueryId: Parameters<KyselyPlugin['transformQuery']>[0]['queryId'] | undefined;
    const queryProbe: KyselyPlugin = {
      transformQuery(args) {
        if (args.node.kind === 'SelectQueryNode') {
          const query = JSON.stringify(args.node);
          queryReads.push(query);
          if (budgetFinalizationWaitAt !== undefined) {
            if (query.includes('"name":"agent_result_acceptance"')) budgetAcceptanceRead = true;
            else if (budgetAcceptanceRead && query.includes('"name":"agent_result"'))
              budgetWaitQueryId = args.queryId;
          }
        }
        if (['InsertQueryNode', 'UpdateQueryNode', 'DeleteQueryNode'].includes(args.node.kind))
          queryWrites.push(JSON.stringify(args.node));
        return args.node;
      },
      async transformResult(args) {
        if (args.queryId === budgetWaitQueryId && budgetFinalizationWaitAt !== undefined) {
          // Keep the actual owning result and wall clock. Wait after dependency
          // preparation, immediately before the real terminal SQL transition.
          await suite.waitForDeadline(
            Math.max(0, budgetFinalizationWaitAt - Date.now()),
            'finite Run-1 budget consumption',
          );
          suite.clock = Date.now();
          budgetFinalizationWaitAt = undefined;
          budgetWaitQueryId = undefined;
        }
        return args.result;
      },
    };
    const guardedTeDb = suite.teDb.withPlugin(queryProbe);
    const protectedReads = () =>
      queryReads.filter((query) =>
        /"name":"(?:task_execution|integration_gateway|artifact)"/u.test(query),
      );
    const recoveryCodes = Object.fromEntries(
      [...BLOCKED_INPUT_RECOVERY_BINDINGS, ...FORMAL_OUTPUT_RECOVERY_BINDINGS].map((b, i) => [
        b.capabilityConfigKey,
        `wi231.c${i}.${serviceId.replaceAll('-', '')}`,
      ]),
    );
    if (!formal && bounded && recoveryVariant === 'NORMAL')
      recoveryCodes.informationRequestResolveV1 = definedValue(
        recoveryCodes.informationAnswerSubmitV1,
      );
    const recoveryAuth = createRecoveryAuthorizationPort({
      capabilityCodes: recoveryCodes,
      now: () => new Date(suite.clock),
    });
    const recoveryGrants = new Map<string, string>();
    const recoveryConfig = {
      taskExecutionDb: guardedTeDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      recoveryCapabilityCodes: recoveryCodes,
      humanCapabilityCodes: {
        answerSubmit: definedValue(recoveryCodes.informationAnswerSubmitV1),
        requestResolve: definedValue(recoveryCodes.informationRequestResolveV1),
        materialRead: definedValue(recoveryCodes['recovery.answer_submit.material.v1']),
      },
      capabilities: dependencyCapabilities,
      now: () => new Date(suite.clock),
    };
    let recoveryCreateRaceDone = false;
    const recoveryFaults = new Set<string>();
    const recoverySqlVerified = new Set<string>();
    async function recoverySqlCounterexamples(
      envelope: Record<string, unknown>,
      execute: () => Promise<unknown>,
    ) {
      return verifyRecoverySql(stageDependencies, envelope, execute);
    }
    async function recoveryReceiptRollback(
      envelope: Record<string, unknown>,
      execute: () => Promise<unknown>,
    ) {
      return verifyRecoveryRollback(stageDependencies, envelope, execute);
    }
    let faultFirstRunCommands = false;
    let processEnabled = false;
    let processStep = 0;
    const processHandoffs = new Set<number>();
    const processTypes = [
      'execution.open_information_request',
      'execution.reconcile_work_order_execution',
      'execution.reconcile_task_execution',
      'execution.build_context_snapshot',
      'execution.get_work_order_execution_state',
      'identity.issue_execution_capability_bundle',
      'execution.create_run',
      'integration.request_runtime_dispatch',
      'execution.start_run',
      'execution.reconcile_work_order_execution',
      'execution.reconcile_task_execution',
      'execution.reconcile_work_order_execution',
      'execution.reconcile_task_execution',
    ];
    let processPending: CanonicalJsonObject | undefined;
    let processExecute: ((command: CanonicalJsonObject) => Promise<unknown>) | undefined;
    let processResult: unknown;
    let processWorkers: ReturnType<typeof createBlockedInputRecoveryWorker>[] | undefined;
    const processAuthorities: Awaited<ReturnType<typeof createRecoveryProcessAuthorities>>[] = [];
    async function throughRecoveryProcess(
      envelope: Record<string, unknown>,
      execute: (command: CanonicalJsonObject) => Promise<unknown>,
    ) {
      return executeRecoveryStep(stageDependencies, envelope, execute);
    }
    const recoveryDependencyChecks = new Set<string>();
    async function missingRecoveryDependency(
      envelope: CanonicalJsonObject,
      method: PropertyKey,
      arguments_: unknown[],
      firstRun: boolean,
    ) {
      if (!exerciseRecoveryFaultMatrix || !processEnabled) return;
      const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
      const consumers: Record<string, string> = {
        'execution.open_information_request': 'request_open',
        'execution.submit_information_answer': 'answer_submit',
        'execution.resolve_information_request': 'request_resolve',
        'execution.build_context_snapshot': 'frozen_context_build',
        'execution.schedule_work_order_retry': 'retry_schedule',
        'identity.issue_execution_capability_bundle': 'bundle_issue',
        'execution.create_run': 'run_create',
        'integration.request_runtime_dispatch': 'runtime_dispatch',
        'execution.start_run': 'run_start',
        'execution.submit_agent_result': 'result_submit',
        'execution.record_run_result': 'result_record',
        'execution.validate_agent_result': 'result_validate',
        'execution.accept_agent_result': 'result_accept',
        'execution.finalize_run_from_acceptance': 'run_finalize',
        ...(processStep >= 6
          ? {
              'execution.reconcile_work_order_execution': 'work_order_reconcile',
              'execution.reconcile_task_execution': 'task_reconcile',
            }
          : {}),
      };
      const consumer = consumers[type];
      if (!consumer || recoveryDependencyChecks.has(type)) return;
      recoveryDependencyChecks.add(type);
      const dependency = ['request_open', 'answer_submit'].includes(consumer)
        ? 'contract'
        : 'answer';
      const codes = {
        ...recoveryCodes,
        [`recovery.${consumer}.${dependency}.v1`]: 'wi231.missing.consumer.dependency',
      };
      const dependencyReads: string[] = [];
      const dependencyProbe: KyselyPlugin = {
        transformQuery(args) {
          if (['SelectQueryNode', 'RawNode'].includes(args.node.kind))
            dependencyReads.push(JSON.stringify(args.node));
          return args.node;
        },
        transformResult: (args) => Promise.resolve(args.result),
      };
      const refusedEntry = firstRun
        ? createControlledFirstRunEntry({
            ...firstRunConfig,
            taskExecutionDb: suite.teDb.withPlugin(dependencyProbe),
            recovery: {
              recoveryCapabilityCodes: codes,
              humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
            },
          })
        : createBlockedInputRecoveryEntry({
            ...recoveryConfig,
            taskExecutionDb: suite.teDb.withPlugin(dependencyProbe),
            recoveryCapabilityCodes: codes,
          });
      const execute: unknown = Reflect.get(refusedEntry, method);
      if (typeof execute !== 'function') throw new Error('missing tested owning method');
      await expect(
        Promise.resolve(Reflect.apply(execute, refusedEntry, arguments_) as unknown),
        `TE-REC-D-005 ${consumer} missing ${dependency} Grant`,
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
      const table = dependency === 'contract' ? 'work_order_contract' : 'answer_submission';
      expect(
        dependencyReads.filter((query) => query.includes(table)),
        `${consumer} protected ${table} read`,
      ).toEqual([]);
      expect(await suite.receiptRows(definedValue(envelope.idempotencyKey) as string)).toEqual([]);
    }
    function withRecoveryReceiptFaults<T extends object>(entry: T, firstRun = false): T {
      return new Proxy(entry, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== 'function') return value;
          return async (...args: unknown[]) => {
            const envelope = record(args[0]);
            const invoke = () => Promise.resolve(Reflect.apply(value, target, args) as unknown);
            const targetExecute = async (command: CanonicalJsonObject) => {
              const commandInvoke = () =>
                Promise.resolve(
                  Reflect.apply(value, target, [command, ...args.slice(1)]) as unknown,
                );
              await missingRecoveryDependency(command, key, [command, ...args.slice(1)], firstRun);
              if (
                exerciseRecoveryFaultMatrix &&
                (!firstRun || faultFirstRunCommands) &&
                typeof command.commandType === 'string' &&
                typeof command.commandId === 'string' &&
                !recoveryFaults.has(command.commandId)
              )
                await recoveryReceiptRollback(command, commandInvoke);
              if (
                exerciseRecoveryFaultMatrix &&
                faultFirstRunCommands &&
                command.commandType === 'execution.create_run' &&
                !recoveryCreateRaceDone
              ) {
                recoveryCreateRaceDone = true;
                const race = await Promise.all([commandInvoke(), commandInvoke()]);
                expect(race.map((result) => record(result).status).sort()).toEqual([
                  'COMMITTED',
                  'DUPLICATE',
                ]);
                expect(record(race[0]).resultPayload).toEqual(record(race[1]).resultPayload);
                return definedValue(race.find((result) => record(result).status === 'COMMITTED'));
              }
              const committed = await commandInvoke();
              if (record(committed).status === 'COMMITTED')
                await exitHooks?.afterCommit?.(command, committed);
              return committed;
            };
            if (
              processEnabled &&
              envelope.commandType === 'identity.issue_execution_capability_bundle' &&
              processStep === 4
            ) {
              const query = await recoveryEnvelope(
                'workOrderExecutionStateReadV1',
                workOrderRef,
                { workOrderRef } as unknown as CanonicalJsonObject,
                service,
                undefined,
                true,
              );
              await throughRecoveryProcess(query, (command) =>
                recoveryEntryRaw.read(command, suite.sessionFor(service)),
              );
            }
            if (
              processEnabled &&
              typeof envelope.commandType === 'string' &&
              processTypes[processStep] === envelope.commandType
            )
              return throughRecoveryProcess(envelope, targetExecute);
            if (typeof envelope.commandType === 'string')
              return targetExecute(envelope as CanonicalJsonObject);
            return invoke();
          };
        },
      });
    }
    // This test caller sits OUTSIDE the faulting entry. It receives the rejected
    // entry invocation and continues only with the rebuilt entry's actual reply.
    function withExitResponseRecovery<T extends object>(entry: T, firstRun = false): T {
      if (exitHooks?.invokeCommand === undefined) return entry;
      return new Proxy(entry, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const command = record(args[0]) as CanonicalJsonObject;
            const invoke = () => Promise.resolve(Reflect.apply(value, target, args) as unknown);
            if (typeof command.commandType !== 'string') return invoke();
            return exitHooks.invokeCommand?.(command, invoke, () => {
              const rebuilt = firstRun
                ? createControlledFirstRunEntry(firstRunConfig)
                : createBlockedInputRecoveryEntry(recoveryConfig);
              const method: unknown = Reflect.get(rebuilt, key);
              if (typeof method !== 'function') throw new Error('missing rebuilt method');
              return Promise.resolve(
                Reflect.apply(method, rebuilt, [command, ...args.slice(1)]) as unknown,
              );
            });
          };
        },
      });
    }
    const recoveryEntryRaw = createBlockedInputRecoveryEntry(recoveryConfig);
    const recoveryEntry = withExitResponseRecovery(withRecoveryReceiptFaults(recoveryEntryRaw));
    async function recoveryEnvelope(
      key: string,
      target: Common.ObjectRef,
      payload: CanonicalJsonObject,
      principal: Principal,
      expectedVersion?: number,
      query = false,
    ): Promise<Record<string, unknown>> {
      const b = definedValue(
        BLOCKED_INPUT_RECOVERY_BINDINGS.find((b) => b.capabilityConfigKey === key),
      );
      const signed = await recoveryAuth.authorize(
        suite.identityDeps([suite.fixture.projectId], principal),
        key,
        {
          actorSnapshotRef: principal.actorRef,
          commandType: b.commandType,
          commandVersion: b.commandVersion,
          commandPayloadHash: digestCanonicalPayload(payload).hash,
          authenticationContextHash: principal.authHash,
          targetRef: target,
        },
      );
      expect(signed.outcome, key).toBe('ALLOW');
      if (signed.outcome !== 'ALLOW') throw new Error('denied recovery');
      const base = {
        scopeRef: suite.scope(),
        authorizationDecisionRef: signed.authorizationDecisionRef,
        correlationId: newUuidV7(),
        requestedAt: new Date(suite.clock).toISOString(),
        payload,
      };
      return query
        ? {
            ...base,
            queryId: newUuidV7(),
            queryType: b.commandType,
            queryVersion: b.commandVersion,
            requester: principal.actorRef,
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.authentication_context',
              objectId: principal.actorSnapshotId,
              scope: suite.scope(),
              contentHash: contentHash(principal.authHash.toString('hex')),
            },
            consistencyRequirement: 'AUTHORITATIVE',
          }
        : {
            ...base,
            commandId: newUuidV7(),
            commandType: b.commandType,
            commandVersion: b.commandVersion,
            targetRef: target,
            actor: principal.actorRef,
            idempotencyKey: newUuidV7(),
            ...(expectedVersion === undefined ? {} : { expectedAggregateVersion: expectedVersion }),
            integrity: {
              canonicalizationVersion: '1',
              payloadHash: contentHash(digestCanonicalPayload(payload).hash.toString('hex')),
            },
          };
    }
    let recoverySource: Common.ContentAddressedRef | undefined,
      candidateMaterial: Common.VersionedRef | undefined;
    let recoveryProposeEnvelope: Record<string, unknown> | undefined;
    let otherDraftChildId: string | undefined;
    let otherChildResultRef: unknown;
    let otherChildAttemptRef: Common.ObjectRef | undefined;
    const proposalId = newUuidV7();
    if (formal && !bounded)
      await suite.prepareIndependentGrants(BLOCKED_INPUT_RECOVERY_BINDINGS, async (b) => {
        await suite.grant({
          principal: b.expectedPrincipalKind === 'HUMAN' ? suite.operator() : service,
          capabilityCode: definedValue(recoveryCodes[b.capabilityConfigKey]),
          action: b.requiredGrantAction,
          selectorType: b.selectorType,
          targetObjectType: definedValue(b.targetObjectTypes[0]),
          targetObjectTypes: b.targetObjectTypes,
        });
      });
    if (formal && bounded)
      await suite.prepareIndependentGrants(FORMAL_OUTPUT_RECOVERY_BINDINGS, async (b) => {
        await suite.grant({
          principal: service,
          capabilityCode: definedValue(recoveryCodes[b.capabilityConfigKey]),
          action: b.requiredGrantAction,
          selectorType: b.selectorType,
          targetObjectType: definedValue(b.targetObjectTypes[0]),
          targetObjectTypes: b.targetObjectTypes,
        });
      });
    if (await prepareRecoveryAuthorities(stageDependencies)) return;
    let emitEarlyFinal = false;
    const runtimeJournal = new InMemoryRenderObjectStorage();
    function formalRuntimeOutcome(actualRunId: string): string {
      const templateName = definedValue(
        definedValue(formalFixture).runtimeTemplates[actualRunId === runRef.objectId ? 0 : 1],
      );
      const descriptor = record(
        JSON.parse(
          readFileSync(
            new URL(
              `../fixtures/task-execution/formal-completion/runtime/${templateName}.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      );
      expect(descriptor).toMatchObject({
        templateId: templateName,
        templateVersion: '1.0',
        runtimeAdapterProfile: 'te.human_operated.synthetic.formal@1.0',
      });
      if (typeof descriptor.executionOutcome !== 'string')
        throw new Error('Invalid formal Runtime template');
      return descriptor.executionOutcome;
    }
    const runtimeDriver = new LocalSyntheticRuntimeDriver(
      (input, ack) =>
        ({
          header: {
            contractId: newUuidV7(),
            contractType:
              terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'HEADER'
                ? 'zhiju.contract.unexpected_result'
                : 'zhiju.contract.agent_result',
            contractVersion: '1.0',
            schemaRef: {
              kind: 'VERSIONED',
              objectType: 'zhiju.contract.schema',
              objectId: '018f22e2-7c15-7b12-8d86-2de956a9d207',
              versionId: '018f22e2-7c15-7d42-8d86-2de956a9d22a',
              scope: { enterpriseId: suite.fixture.enterpriseId },
            },
            scopeRef: suite.scope(),
            issuedBy: { principalKind: 'SERVICE', principalId: serviceId },
            correlationId: CORRELATION,
            dataClassification: 'INTERNAL',
            canonicalizationVersion: '1',
          },
          agentResultId: newUuidV7(),
          runRef: input.request.runRef as unknown as CanonicalJsonObject,
          workOrderRef: input.request.workOrderRef as unknown as CanonicalJsonObject,
          taskRef: revised.taskRef as CanonicalJsonObject,
          projectRef: revised.projectRef as CanonicalJsonObject,
          submissionKind: terminalScenario === 'NON_FINAL_CORE_REJECT' ? 'INTERIM' : 'FINAL',
          executionOutcome: formal
            ? formalRuntimeOutcome(input.request.runRef.objectId)
            : bounded &&
                (input.request.runRef.objectId === runRef.objectId ||
                  input.request.workOrderRef.objectId === otherChildId)
              ? 'BLOCKED_INPUT'
              : bounded && recoveryVariant === 'SECOND_BLOCKED'
                ? 'BLOCKED_INPUT'
                : bounded && recoveryVariant === 'SECOND_PARTIAL'
                  ? 'PARTIAL'
                  : bounded && recoveryVariant === 'SECOND_FAILED'
                    ? 'FAILED_EXECUTION'
                    : terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'OUTCOME'
                      ? 'PARTIAL'
                      : 'COMPLETED',
          businessOutputs:
            terminalScenario === 'UNSUPPORTED_FINAL' &&
            (negativeFinalCase === 'BUSINESS_OUTPUT' || negativeFinalCase === 'ARTIFACT_ALIAS')
              ? [businessOutput(input.request.runRef)]
              : [],
          workspaceOutputs:
            terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'WORKSPACE_OUTPUT'
              ? [example('workspaceOutputs')]
              : [],
          findings:
            terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'FINDING'
              ? [example('findings')]
              : [],
          knowledgeProposals:
            terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'KNOWLEDGE_PROPOSAL'
              ? [example('knowledgeProposals')]
              : [],
          inputRequestProposals:
            bounded &&
            (input.request.runRef.objectId === runRef.objectId ||
              input.request.workOrderRef.objectId === otherChildId)
              ? [
                  {
                    proposalId,
                    requestType: 'execution.input.customer_material_confirmation',
                    question: 'Confirm this customer material.',
                    reason: 'A Human must confirm the candidate.',
                    expectedAnswerSpec: {
                      profile: 'execution.answer.customer_material.v1',
                      candidateMaterialRef: candidateMaterial,
                      requiredSourceRefs: [recoverySource],
                    },
                    blocking: true,
                    requestedResponderRole: 'project.customer_material.confirmer',
                    targetRefs: [input.request.workOrderRef, revised.taskRef].sort((a, b) =>
                      Buffer.compare(
                        Buffer.from(canonicalize(a as CanonicalJsonObject)),
                        Buffer.from(canonicalize(b as CanonicalJsonObject)),
                      ),
                    ),
                  },
                ]
              : terminalScenario === 'UNSUPPORTED_FINAL' &&
                  negativeFinalCase === 'INPUT_REQUEST_PROPOSAL'
                ? [example('inputRequestProposals')]
                : [],
          followUpProposals:
            terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'FOLLOW_UP_PROPOSAL'
              ? [example('followUpProposals')]
              : [],
          ...(positiveFinalScenario || exitHooks?.declareUsage === true
            ? { agentDeclaredUsage: { measurementSource: 'AGENT_DECLARED', inputTokens: 17 } }
            : {}),
          ...(terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'RUNTIME_USAGE'
            ? { runtimeUsageRef: read.contractRef }
            : {}),
          ...(terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'CONTINUATION'
            ? {
                continuationProposal: {
                  proposalId: newUuidV7(),
                  summary: 'Continue after this Run.',
                  suggestedContextRevision: false,
                },
              }
            : {}),
          provenance: {
            contextSnapshotRef: input.request.contextSnapshotRef,
            workOrderContractRef: input.request.workOrderContractRef,
            capabilityGrantRef: input.request.capabilityGrantRef,
            runtimeAdapterRef: record(revised.versionPins).runtimeAdapterContractRef,
            harness: { harnessId: 'zhiju.runtime.synthetic', harnessVersion: '1.0' },
            provider: 'synthetic',
            model: {
              modelId:
                terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'PROVENANCE'
                  ? 'synthetic.other'
                  : 'synthetic',
              modelConfigHash: record(input.request.runtimeBinding).modelConfigHash,
            },
            skillRefs: [],
            policyRefs: [],
            templateRefs: [],
            runtimeSessionExternalRef:
              terminalScenario === 'IG_WRONG_SESSION' ||
              (recoveryVariant === 'SECOND_WRONG_SESSION' &&
                input.request.runRef.objectId !== runRef.objectId)
                ? { ...ack.runtimeSessionRef, externalId: newUuidV7() }
                : ack.runtimeSessionRef,
          },
          humanSummary: 'Controlled synthetic execution completed.',
        }) as unknown as CanonicalJsonObject,
      runtimeJournal,
      () => new Date(suite.clock - (emitEarlyFinal ? 1_000 : 0)),
    );
    if (
      terminalScenario === 'TIMED_OUT' ||
      terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
      terminalScenario === 'FORMAL_LATE' ||
      terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
      terminalScenario === 'NON_FINAL_CORE_REJECT' ||
      // #244: the original final is released only after cancellation so the
      // late-observation isolation path sees a real delayed final.
      terminalScenario === 'RUN_CANCEL'
    )
      runtimeDriver.releaseFinal = () => Promise.resolve();
    if (terminalScenario === 'FORMAL_EMPTY') {
      // Replace only the external Runtime final producer. Invoke, acknowledgement,
      // immutable journal and every IG/TE owning consumer remain real.
      runtimeDriver.releaseFinal = async (attempt) => {
        const stored = definedValue(
          await runtimeJournal.read(
            `integration/runtime/synthetic/${attempt.objectId}/invocation.json`,
          ),
        );
        const invocation = record(JSON.parse(stored.bytes.toString('utf8')));
        const acknowledgement = record(invocation.acknowledgement);
        const observedAt = new Date(suite.clock).toISOString();
        const template = record(invocation.content);
        const body = {
          ...template,
          businessOutputs: [],
          header: { ...record(template.header), issuedAt: observedAt },
          submittedAt: observedAt,
          submittedByRuntime: acknowledgement.runtimeAdapterIdentityRef,
        } as CanonicalJsonObject;
        const agentResultContract = {
          ...body,
          header: { ...record(body.header), payloadHash: contentHash(hashContractPayload(body)) },
        } as unknown as CanonicalJsonObject;
        await runtimeJournal.putImmutable({
          locator: `integration/runtime/synthetic/${attempt.objectId}/final.json`,
          bytes: Buffer.from(
            canonicalize({
              attemptRef: attempt,
              runtimeAdapterIdentityRef: acknowledgement.runtimeAdapterIdentityRef,
              bindingHash: acknowledgement.bindingHash,
              runtimeSubmissionRef: {
                system: 'zhiju.runtime.synthetic',
                resourceType: 'runtime_submission',
                externalId: newUuidV7(),
                observedAt,
              },
              runFencingToken: record(record(invocation.input).invocationBinding).fencingToken,
              agentResultContract,
              observedAt,
            } as unknown as CanonicalJsonObject),
          ),
          mediaType: 'application/json',
        });
      };
    }
    const firstRunConfig = {
      ...(formal ? { formalCompletion: formalConfig } : {}),
      taskExecutionDb: guardedTeDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(queryProbe),
      runtimeDriver,
      receiptStorage: runtimeJournal,
      capabilityCodes: firstRunCodes,
      ...(bounded || formal
        ? {
            recovery: {
              recoveryCapabilityCodes: recoveryCodes,
              humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
            },
          }
        : {}),
      capabilities: dependencyCapabilities,
      now: () => new Date(suite.clock),
    } satisfies Parameters<typeof createControlledFirstRunEntry>[0];
    exitHooks?.runtime?.(runtimeDriver);
    const firstRunEntryRaw = createControlledFirstRunEntry(firstRunConfig);
    const firstRunEntry = withExitResponseRecovery(
      suite.observeEntry(withRecoveryReceiptFaults(firstRunEntryRaw, true)),
      true,
    );
    let replayFormalCreation: (() => Promise<unknown>) | undefined;
    let actualFormalOutput: CanonicalJsonObject | undefined;
    let actualFormalArtifact: Common.ObjectRef | undefined;
    let actualQuality: Awaited<ReturnType<typeof quality.accept>> | undefined;
    async function createAndReleaseFormalOutput(
      actualRun: Common.ObjectRef,
      actualAttempt: Common.ObjectRef,
    ) {
      return createFormalOutput(stageDependencies, actualRun, actualAttempt);
    }
    async function completeFormal() {
      await verifyFormalCompletion(stageDependencies);
      await boardProbe?.('COMPLETED', runRef);
    }
    async function firstRunEnvelope(
      commandType: string,
      targetRef: Common.ObjectRef,
      payload: CanonicalJsonObject,
      principal: Principal,
      expectedAggregateVersion?: number,
    ) {
      // Creation's exact deadline and start's exact timestamp were prepared at
      // this trusted instant. Later final commands consume the current clock.
      if (commandType !== 'execution.create_run' && commandType !== 'execution.start_run')
        suite.clock = Math.max(suite.clock, Date.now());
      const payloadHash = digestCanonicalPayload(payload).hash;
      const decision = await firstRunAuth.authorize(
        suite.identityDeps([suite.fixture.projectId], principal),
        CONTROLLED_FIRST_RUN_BINDINGS.find(
          (binding) =>
            binding.commandType === commandType &&
            binding.targetObjectTypes.includes(targetRef.objectType) &&
            [
              'workOrderQueueV1',
              'executionBundleIssueV1',
              'runCreateV1',
              'runtimeDispatchV1',
              'runStartV1',
              'workOrderReconcileV1',
              'agentResultSubmitV1',
              'runResultRecordV1',
              'agentResultValidateV1',
              'agentResultAcceptV1',
              'runFinalizeV1',
              'runExpireV1',
            ].includes(binding.boundary),
        )?.boundary ?? '',
        {
          actorSnapshotRef: principal.actorRef,
          commandType,
          commandVersion: '1.0',
          commandPayloadHash: payloadHash,
          authenticationContextHash: principal.authHash,
          targetRef,
        },
      );
      expect(decision.outcome).toBe('ALLOW');
      if (decision.outcome !== 'ALLOW') throw new Error('first Run Decision denied');
      return {
        commandId: newUuidV7(),
        commandType,
        commandVersion: '1.0',
        scopeRef: suite.scope(),
        targetRef,
        actor: principal.actorRef,
        authorizationDecisionRef: decision.authorizationDecisionRef,
        idempotencyKey: newUuidV7(),
        correlationId: newUuidV7(),
        requestedAt: new Date(suite.clock).toISOString(),
        ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(payloadHash.toString('hex')),
        },
      };
    }
    const workOrderRef = revised.workOrderRef as Common.ObjectRef;
    const queueEnvelope = await firstRunEnvelope(
      'execution.queue_work_order',
      workOrderRef,
      { queuePolicyRef: controlsRef as unknown as CanonicalJsonObject },
      suite.operator(),
      2,
    );
    if (exercisePreparationMatrix) {
      suite.phase('queue revocation probe');
      const deniedQueueEntry = createControlledFirstRunEntry({
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb: suite.enterpriseProjectDb,
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(
          queryProbe,
        ),
        runtimeDriver,
        receiptStorage: new InMemoryRenderObjectStorage(),
        capabilityCodes: { ...firstRunCodes, queueContextReadV1: 'wi221.ungranted' },
        capabilities: dependencyCapabilities,
        now: () => new Date(suite.clock),
      });
      await expect(deniedQueueEntry.queue(queueEnvelope, suite.sessionFor())).rejects.toMatchObject(
        {
          code: 'AUTHORIZATION_REVOKED',
        },
      );
      expect(await suite.receiptRows(queueEnvelope.idempotencyKey)).toEqual([]);
      await suite.admin.query(`
        CREATE OR REPLACE FUNCTION task_execution.wi221_pause_queue() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(221); RETURN NEW; END $$`);
      await suite.admin.query(`
        CREATE TRIGGER wi221_pause_queue BEFORE UPDATE ON task_execution.work_order
        FOR EACH ROW WHEN (NEW.work_order_id = '${workOrderRef.objectId}'::uuid AND NEW.status = 'QUEUED')
        EXECUTE FUNCTION task_execution.wi221_pause_queue()`);
      const queueBlocker = new pg.Client({ connectionString: suite.activeDatabaseUrl });
      let queuedAttempt: Promise<unknown> | undefined;
      try {
        await queueBlocker.connect();
        const blockerPid = (
          await queueBlocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        ).rows[0]?.pid;
        if (blockerPid === undefined) throw new Error('missing queue blocker backend');
        await queueBlocker.query('SELECT pg_advisory_lock(221)');
        queuedAttempt = suite.track(firstRunEntry.queue(queueEnvelope, suite.sessionFor())).then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        let paused = false;
        for (let poll = 0; poll < 200 && !paused; poll += 1) {
          const activity = await suite.admin.query<{ paused: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE pid <> pg_backend_pid() AND wait_event_type='Lock'
                 AND $1::int = ANY(pg_blocking_pids(pid))
             ) AS paused`,
            [blockerPid],
          );
          paused = activity.rows[0]?.paused === true;
          if (!paused) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(paused).toBe(true);
        expect(
          await suite.revokeCapabilityTracked(suite.identityDeps([suite.fixture.projectId]), {
            targetId: suite.grantResolve,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: suite.fixture.enterpriseId,
              projectId: suite.fixture.projectId,
            },
            reasonCode: 'WI221_REVOKE_POLICY_READ_AFTER_MINT',
            effectiveAt: new Date(suite.clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        await queueBlocker.query('SELECT pg_advisory_unlock(221)');
        expect(await queuedAttempt).toMatchObject({
          error: { code: 'AUTHORIZATION_REVOKED' },
        });
      } finally {
        // Release before draining, including assertion/timeout failures.
        try {
          await queueBlocker.end();
        } finally {
          await queuedAttempt;
          await suite.admin.query(
            'DROP TRIGGER IF EXISTS wi221_pause_queue ON task_execution.work_order',
          );
          await suite.admin.query('DROP FUNCTION IF EXISTS task_execution.wi221_pause_queue()');
          // Restore the shared dependency even when a probe assertion fails.
          suite.grantResolve = await suite.grantGeneric(dependencyCapabilities.resolvePolicy);
        }
      }
      expect(await suite.receiptRows(queueEnvelope.idempotencyKey)).toEqual([]);
    }
    suite.phase('queue and Run creation');
    const queued = await firstRunEntry.queue(queueEnvelope, suite.sessionFor());
    expect(queued, JSON.stringify(queued)).toMatchObject({ status: 'COMMITTED' });
    if (exerciseCommonReplayMatrix) {
      expect(await firstRunEntry.queue(queueEnvelope, suite.sessionFor())).toMatchObject({
        status: 'DUPLICATE',
      });
    }
    if (terminalScenario !== 'SUCCEEDED') suite.clock = Date.now();
    const runRef = objectRef('execution.run', newUuidV7(), suite.scope()) as Common.ObjectRef;
    const bundleEnvelope = await firstRunEnvelope(
      'identity.issue_execution_capability_bundle',
      objectRef(
        'zhiju.identity.execution_capability_bundle',
        newUuidV7(),
        suite.scope(),
      ) as Common.ObjectRef,
      {
        runRef,
        workOrderRef,
        workOrderContractRef: read.contractRef,
        contextSnapshotRef: contextRef,
        servicePrincipalRef: { principalId: serviceId, principalKind: 'SERVICE' },
        requestedCapabilities: revised.allowedCapabilities,
      } as unknown as CanonicalJsonObject,
      service,
    );
    suite.phase('Bundle issue');
    const bundle = await firstRunEntry.issueBundle(bundleEnvelope, suite.sessionFor(service));
    expect(bundle, JSON.stringify(bundle)).toMatchObject({ status: 'COMMITTED' });
    const bundleRef = record(suite.committedPayload(bundle as unknown as CommandResult)).bundleRef;
    const bundleValidUntil = (
      await suite.admin.query<{ valid_until: Date }>(
        'SELECT valid_until FROM identity_policy.execution_capability_bundle WHERE bundle_id=$1',
        [record(bundleRef).objectId],
      )
    ).rows[0]?.valid_until;
    if (bundleValidUntil === undefined) throw new Error('missing Bundle');
    // The eligibility case's unchanged Run budget begins at Run preparation,
    // after the independently committed Bundle has finished being prepared.
    if (
      terminalScenario === 'ELIGIBILITY_CHANGE' ||
      shortRecoveryBudget ||
      ['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant)
    )
      suite.clock = Date.now();
    const runDeadline = new Date(
      Math.min(
        bundleValidUntil.getTime(),
        ...(shortRecoveryBudget || ['BUDGET_EXHAUSTED', 'EXPIRE_SOURCE'].includes(recoveryVariant)
          ? [suite.clock + 30_000]
          : []),
        suite.clock +
          (terminalScenario === 'LEGACY_UPGRADE'
            ? 60_000
            : terminalScenario === 'ELIGIBILITY_CHANGE' ||
                terminalScenario === 'TIMED_OUT' ||
                terminalScenario === 'TERMINAL_BEFORE_FINAL' ||
                terminalScenario === 'FORMAL_LATE' ||
                terminalScenario === 'IG_WRONG_SESSION' ||
                terminalScenario === 'TIMED_OUT_BUNDLE_EXPIRED' ||
                terminalScenario === 'UNSUPPORTED_FINAL' ||
                terminalScenario === 'NON_FINAL_CORE_REJECT'
              ? eligibilityChange?.whileLocked === true
                ? 30_000
                : 10_000
              : terminalScenario === 'RECOVERY_EXPIRE'
                ? 30_000
                : terminalScenario === 'VALIDATION_EXPIRED'
                  ? 30_000
                  : terminalScenario === 'RACE' ||
                      terminalScenario === 'LOCK_DEADLINE' ||
                      terminalScenario === 'FORMAL_TTL' ||
                      terminalScenario === 'RUN_CANCEL'
                    ? 30_000
                    : 600_000),
      ),
    );
    const runtimeBinding = {
      adapterCode: formal ? 'te.human_operated.synthetic.formal' : 'te.human_operated.synthetic',
      adapterVersion: '1.0',
      harnessId: 'zhiju.runtime.synthetic',
      harnessVersion: '1.0',
      provider: 'synthetic',
      modelId: 'synthetic',
      modelConfigHash: contentHash(sha256CanonicalJson({})),
    };
    const createEnvelope = await firstRunEnvelope(
      'execution.create_run',
      runRef,
      {
        creation: {
          workOrderRef,
          workOrderContractRef: read.contractRef,
          contextSnapshotRef: contextRef,
          capabilityGrantRef: bundleRef,
          leasePolicyRef: controlsRef,
          attemptNumber: 1,
          runtimeBinding,
          executionDeadline: runDeadline.toISOString(),
        },
      } as unknown as CanonicalJsonObject,
      service,
    );
    suite.phase('Run creation');
    suite.progress('Run deadline', `remainingMs=${runDeadline.getTime() - Date.now()}`);
    const created = await firstRunEntry
      .createRun(createEnvelope, suite.sessionFor(service))
      .catch((error: unknown) => {
        if (bounded) process.stdout.write(JSON.stringify(error) + '\n');
        throw error;
      });
    expect(created, JSON.stringify(created)).toMatchObject({ status: 'COMMITTED' });
    if (exerciseCommonReplayMatrix) {
      expect(
        await firstRunEntry.createRun(createEnvelope, suite.sessionFor(service)),
      ).toMatchObject({
        status: 'DUPLICATE',
      });
    }
    const createdData = record(suite.committedPayload(created as unknown as CommandResult));
    async function firstRunQuery(
      queryType: string,
      targetRef: Common.ObjectRef | Common.ContentAddressedRef,
      payload: CanonicalJsonObject,
      key:
        | 'runtimeAttemptBindingReadV1'
        | 'runtimeFinalReadV1'
        | 'agentResultReadV1'
        | 'runStateReadV1',
    ) {
      suite.clock = Math.max(suite.clock, Date.now());
      const decision = await firstRunAuth.authorize(
        suite.identityDeps([suite.fixture.projectId], service),
        key,
        {
          actorSnapshotRef: service.actorRef,
          commandType: queryType,
          commandVersion: '1.0',
          commandPayloadHash: digestCanonicalPayload(payload).hash,
          authenticationContextHash: AUTH_HASH,
          targetRef,
        },
      );
      if (decision.outcome !== 'ALLOW') throw new Error('first Run query Decision denied');
      return {
        queryId: newUuidV7(),
        queryType,
        queryVersion: '1.0',
        scopeRef: suite.scope(),
        requester: objectRef(PRINCIPAL_OBJECT, serviceId, suite.scope()),
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: actorId,
          scope: suite.scope(),
          contentHash: contentHash(AUTH_HASH.toString('hex')),
        },
        authorizationDecisionRef: decision.authorizationDecisionRef,
        consistencyRequirement: 'AUTHORITATIVE',
        correlationId: newUuidV7(),
        requestedAt: new Date(suite.clock).toISOString(),
        payload,
      };
    }
    const attemptRef = objectRef(
      'integration.runtime_attempt',
      newUuidV7(),
      suite.scope(),
    ) as Common.ObjectRef;
    if (exercisePreparationMatrix) {
      const uninvokedBinding = await firstRunQuery(
        'integration.get_runtime_attempt_binding',
        attemptRef,
        { attemptRef } as unknown as CanonicalJsonObject,
        'runtimeAttemptBindingReadV1',
      );
      const uninvokedFinal = await firstRunQuery(
        'integration.get_runtime_final_observation',
        attemptRef,
        { attemptRef } as unknown as CanonicalJsonObject,
        'runtimeFinalReadV1',
      );
      await expect(
        firstRunEntry.getRuntimeAttemptBinding(uninvokedBinding, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      await expect(
        firstRunEntry.getRuntimeFinalObservation(uninvokedFinal, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(runtimeDriver.invokedAttemptIds).toEqual([]);
    }
    if (await verifyRunCreation(stageDependencies)) return;
    await usageProbe?.('CREATED', runRef);
    const dispatchEnvelope = await firstRunEnvelope(
      'integration.request_runtime_dispatch',
      attemptRef,
      {
        request: {
          workOrderRef,
          runRef,
          workOrderContractRef: read.contractRef,
          contextSnapshotRef: contextRef,
          capabilityGrantRef: bundleRef,
          runtimeBinding,
          stableIdempotencyKey: newUuidV7(),
          requestedAt: new Date(suite.clock).toISOString(),
        },
      } as unknown as CanonicalJsonObject,
      service,
    );
    if (await verifyRuntimeDispatch(stageDependencies)) return;

    suite.phase('runtime dispatch and start');
    const dispatched = (await firstRunEntry.dispatch(
      dispatchEnvelope,
      suite.sessionFor(service),
    )) as IntegrationGateway.IntegrationGetRuntimeAttemptBindingResult;
    expect(dispatched.status).toBe('SUCCEEDED');
    expect(dispatched.acknowledgement?.source).toBe('SYNTHETIC_DRIVER');
    expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
    const attemptBinding = await firstRunEntry.getRuntimeAttemptBinding(
      await firstRunQuery(
        'integration.get_runtime_attempt_binding',
        attemptRef,
        { attemptRef } as unknown as CanonicalJsonObject,
        'runtimeAttemptBindingReadV1',
      ),
      suite.sessionFor(service),
    );
    expect(attemptBinding).toEqual(dispatched);
    if (exercisePreparationMatrix) {
      const replayedDispatch = await firstRunEntry.dispatch(
        dispatchEnvelope,
        suite.sessionFor(service),
      );
      expect(replayedDispatch).toEqual(dispatched);
    }
    expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
    if (terminalScenario === 'UNSUPPORTED_FINAL' && negativeFinalCase === 'TIME')
      emitEarlyFinal = true;
    const startEnvelope = await firstRunEnvelope(
      'execution.start_run',
      runRef,
      {
        leaseId: createdData.leaseId,
        fencingToken: 1,
        runtimeAttemptRef: attemptRef,
        startedAt: new Date(suite.clock).toISOString(),
      } as unknown as CanonicalJsonObject,
      service,
      1,
    );
    const startSession = { ...suite.sessionFor(service), serviceEntryAt: new Date(suite.clock) };
    if (exercisePreparationMatrix) {
      const unacknowledgedAttempt = objectRef(
        'integration.runtime_attempt',
        newUuidV7(),
        suite.scope(),
      ) as Common.ObjectRef;
      const unacknowledgedStart = await firstRunEnvelope(
        'execution.start_run',
        runRef,
        {
          ...startEnvelope.payload,
          runtimeAttemptRef: unacknowledgedAttempt,
        } as unknown as CanonicalJsonObject,
        service,
        1,
      );
      await expect(firstRunEntry.startRun(unacknowledgedStart, startSession)).rejects.toBeDefined();
      expect(await suite.receiptRows(unacknowledgedStart.idempotencyKey)).toEqual([]);
      for (const key of ['runStartAttemptReadV1', 'runStartAdapterIdentityReadV1'] as const) {
        const dependencyGrantId = firstRunGrants.get(key);
        const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
          (candidate) => candidate.boundary === key,
        );
        if (dependencyGrantId === undefined || binding === undefined)
          throw new Error(`missing independent ${key} Grant`);
        expect(
          await suite.revokeCapabilityTracked(suite.identityDeps([suite.fixture.projectId]), {
            targetId: dependencyGrantId,
            expectedAggregateVersion: '1',
            scope: {
              scopeKind: 'PROJECT',
              enterpriseId: suite.fixture.enterpriseId,
              projectId: suite.fixture.projectId,
            },
            reasonCode: 'WI224_REVOKE_START_DEPENDENCY',
            effectiveAt: new Date(suite.clock),
            idempotencyKey: newUuidV7(),
          }),
        ).toMatchObject({ status: 'COMMITTED' });
        queryReads.length = 0;
        await expect(firstRunEntry.startRun(startEnvelope, startSession)).rejects.toMatchObject({
          code: 'AUTHORIZATION_REVOKED',
        });
        const table =
          key === 'runStartAttemptReadV1' ? 'runtime_attempt' : 'runtime_adapter_identity';
        expect(
          queryReads.filter((query) => query.includes(`"kind":"IdentifierNode","name":"${table}"`)),
          key,
        ).toEqual([]);
        expect(await suite.receiptRows(startEnvelope.idempotencyKey)).toEqual([]);
        await suite.grant({
          principal: service,
          capabilityCode: firstRunCodes[key],
          action: binding.requiredGrantAction,
          selectorType: binding.selectorType,
          targetObjectType: 'integration.runtime_attempt',
        });
      }
    }
    const started = await firstRunEntry.startRun(startEnvelope, startSession);
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'COMMITTED' });
    if (exerciseCommonReplayMatrix) {
      expect(await firstRunEntry.startRun(startEnvelope, startSession)).toMatchObject({
        status: 'DUPLICATE',
      });
    }
    const reconcileEnvelope = await firstRunEnvelope(
      'execution.reconcile_work_order_execution',
      workOrderRef,
      { triggerRef: runRef } as unknown as CanonicalJsonObject,
      service,
      3,
    );
    const reconciled = await firstRunEntry.reconcile(reconcileEnvelope, suite.sessionFor(service));
    expect(reconciled, JSON.stringify(reconciled)).toMatchObject({ status: 'COMMITTED' });
    expect(
      (
        await suite.admin.query<{ status: string; aggregate_version: string }>(
          'SELECT status,aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
          [woId],
        )
      ).rows,
    ).toEqual([{ status: 'RUNNING', aggregate_version: '4' }]);
    expect(
      (
        await suite.admin.query<{ status: string; aggregate_version: string }>(
          'SELECT status,aggregate_version FROM task_execution.run WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'RUNNING', aggregate_version: '2' }]);
    await usageProbe?.('STARTED', runRef);
    if (formal && !bounded && terminalScenario !== 'FORMAL_EMPTY')
      await createAndReleaseFormalOutput(runRef, attemptRef);
    if (terminalScenario === 'FORMAL_LATE') {
      const savedFinal = definedValue(await runtimeDriver.readFinal(attemptRef));
      const delay = Math.max(0, runDeadline.getTime() - Date.now() + 100);
      if (delay > 0) await suite.waitForDeadline(delay, 'formal source Run deadline');
      suite.clock = Date.now();
      const expire = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        2,
      );
      expect(await firstRunEntryRaw.expireRun(expire, suite.sessionFor(service))).toMatchObject({
        status: 'COMMITTED',
      });
      const submit = await firstRunEnvelope(
        'execution.submit_agent_result',
        objectRef(
          'execution.agent_result',
          String(record(savedFinal.agentResultContract).agentResultId),
          suite.scope(),
        ) as Common.ObjectRef,
        {
          agentResultContract: savedFinal.agentResultContract,
          runFencingToken: savedFinal.runFencingToken,
          runtimeSubmissionRef: savedFinal.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        service,
      );
      await expect(
        firstRunEntryRaw.submitAgentResult(submit, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'EXECUTION_JUDGMENT_STALE' });
      const version = Number(
        definedValue(
          (
            await suite.admin.query<{ aggregate_version: string }>(
              'SELECT aggregate_version FROM task_execution.work_order WHERE work_order_id=$1',
              [woId],
            )
          ).rows[0],
        ).aggregate_version,
      );
      const complete = await formalEnvelope(
        'workOrderCompletionEvaluateV2',
        workOrderRef,
        {
          policyRef: completionRef,
          evaluatorRef: registeredEvaluatorProfileReference(
            'im06-evaluator-static-v1',
            'te.work_order_completion.evaluator@1.0',
          ),
        } as unknown as CanonicalJsonObject,
        service,
        version,
      );
      await expect(
        formalEntry.evaluateWorkOrder(complete, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'EXECUTION_COMPLETION_STATE_CONFLICT' });
      expect(
        (
          await suite.admin.query('SELECT status FROM task_execution.run WHERE run_id=$1', [
            runRef.objectId,
          ])
        ).rows,
      ).toEqual([{ status: 'TIMED_OUT' }]);
      expect(
        (
          await suite.admin.query(
            'SELECT count(*)::int n FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(
        (
          await suite.admin.query(
            "SELECT count(*)::int n FROM task_execution.outbox_event WHERE aggregate_id=ANY($1::uuid[]) AND event_type IN('execution.TaskCompleted','execution.WorkOrderCompleted')",
            [[taskId, woId]],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
      expect(
        (
          await suite.admin.query(
            "SELECT count(*)::int n FROM artifact.execution_revision_creation_binding WHERE canonical_payload->'runRef'->>'objectId'=$1",
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);
      expect(await runtimeDriver.readFinal(attemptRef)).toEqual(savedFinal);
      return;
    }
    suite.phase('final boundary and recovery body');
    if (await verifyHistoricalRunUpgrade(stageDependencies)) return;
    const scanTarget = objectRef(
      'zhiju.project.project',
      suite.fixture.projectId,
      suite.scope(),
    ) as Common.ObjectRef;
    const scanPayloadHash = digestCanonicalPayload({
      projectRef: scanTarget as unknown as CanonicalJsonObject,
    }).hash;
    const scanDecision = await firstRunAuth.authorize(
      suite.identityDeps([suite.fixture.projectId], service),
      'runFinalCandidateScanV1',
      {
        actorSnapshotRef: service.actorRef,
        commandType: 'execution.submit_agent_result',
        commandVersion: '1.0',
        commandPayloadHash: scanPayloadHash,
        authenticationContextHash: AUTH_HASH,
        targetRef: scanTarget,
      },
    );
    expect(scanDecision.outcome).toBe('ALLOW');
    if (scanDecision.outcome !== 'ALLOW') throw new Error('final scan denied');
    const scanProof = async () => {
      const validity = await firstRunAuth.revalidate(
        suite.identityDeps([suite.fixture.projectId], service),
        'runFinalCandidateScanV1',
        {
          decisionRef: scanDecision.authorizationDecisionRef,
          expectedCommandType: 'execution.submit_agent_result',
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: scanPayloadHash,
          expectedAuthenticationContextHash: AUTH_HASH,
          expectedTargetRef: scanTarget,
        },
      );
      expect(validity.valid).toBe(true);
    };
    const scanContext = {
      ...suite.runnerContext(service),
      authorizationDecisionId: scanDecision.authorizationDecisionRef.objectId,
      authorizationDecisionHash: Buffer.from(
        scanDecision.authorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(scanDecision.expiresAt),
    };
    const progressTarget = objectRef(
      'zhiju.project.project',
      suite.fixture.projectId,
      suite.scope(),
    ) as Common.ObjectRef;
    async function progressAuthorization(payload: CanonicalJsonObject) {
      const payloadHash = digestCanonicalPayload(payload).hash;
      const decision = await firstRunAuth.authorize(
        suite.identityDeps([suite.fixture.projectId], service),
        'runFinalProcessProgressV1',
        {
          actorSnapshotRef: service.actorRef,
          commandType: 'execution.process_final_progress',
          commandVersion: '1.0',
          commandPayloadHash: payloadHash,
          authenticationContextHash: AUTH_HASH,
          targetRef: progressTarget,
        },
      );
      expect(decision.outcome).toBe('ALLOW');
      if (decision.outcome !== 'ALLOW') throw new Error('final progress denied');
      const proof = async () => {
        const validity = await firstRunAuth.revalidate(
          suite.identityDeps([suite.fixture.projectId], service),
          'runFinalProcessProgressV1',
          {
            decisionRef: decision.authorizationDecisionRef,
            expectedCommandType: 'execution.process_final_progress',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: progressTarget,
          },
        );
        expect(validity.valid).toBe(true);
      };
      return {
        decisionRef: decision.authorizationDecisionRef,
        context: {
          ...suite.runnerContext(service),
          authorizationDecisionId: decision.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            decision.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(decision.expiresAt),
        },
        proof,
      };
    }
    const progressListPayload = { projectRef: progressTarget } as unknown as CanonicalJsonObject;
    let progressListAuthorization = await progressAuthorization(progressListPayload);
    if (exerciseCommonReplayMatrix) {
      expect(
        await firstRunAuth.revalidate(
          suite.identityDeps([suite.fixture.projectId], service),
          'runFinalProcessProgressV1',
          {
            decisionRef: scanDecision.authorizationDecisionRef,
            expectedCommandType: 'execution.process_final_progress',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: digestCanonicalPayload(progressListPayload).hash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: progressTarget,
          },
        ),
      ).toMatchObject({ valid: false });
      expect(
        await firstRunAuth.revalidate(
          suite.identityDeps([suite.fixture.projectId], service),
          'runFinalCandidateScanV1',
          {
            decisionRef: progressListAuthorization.decisionRef,
            expectedCommandType: 'execution.submit_agent_result',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: scanPayloadHash,
            expectedAuthenticationContextHash: AUTH_HASH,
            expectedTargetRef: scanTarget,
          },
        ),
      ).toMatchObject({ valid: false });
    }
    function progressEnvelope(
      context: TaskExecutionTransactionContext,
      processId: string,
      payload: CanonicalJsonObject,
      idempotencyKey: string,
      expectedAggregateVersion?: string,
    ) {
      return {
        commandId: newUuidV7(),
        commandType: 'execution.process_final_progress',
        commandVersion: '1.0',
        idempotencyScope: `execution.process_final_progress@1.0:${suite.fixture.enterpriseId}:${suite.fixture.projectId}`,
        idempotencyKey,
        requestPayload: payload,
        enterpriseId: suite.fixture.enterpriseId,
        projectId: suite.fixture.projectId,
        targetType: 'ProcessInstance',
        targetId: processId,
        ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
        correlationId: context.correlationId,
        principalId: context.principalId,
        principalKind: context.principalKind,
        actorSnapshotId: context.actorSnapshotId,
        authorizationDecisionId: context.authorizationDecisionId,
        policySnapshotId: context.policySnapshotId,
      };
    }
    const scanned = await scanControlledFinalCandidates(
      guardedTeDb,
      scanContext,
      () => new Date(suite.clock),
      scanProof,
    );
    expect(scanned).toContainEqual({ runRef, attemptRef });
    const finalQuery = await firstRunQuery(
      'integration.get_runtime_final_observation',
      attemptRef,
      { attemptRef } as unknown as CanonicalJsonObject,
      'runtimeFinalReadV1',
    );
    async function expireRejectedFinalRun() {
      const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
      if (deadlineWait > 0)
        await suite.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
      suite.clock = Date.now();
      const expireEnvelope = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        2,
      );
      expect(
        await firstRunEntry.expireRun(expireEnvelope, suite.sessionFor(service)),
      ).toMatchObject({
        status: 'COMMITTED',
      });
    }
    if (terminalScenario === 'NON_FINAL_CORE_REJECT') {
      const malformedDriver = new LocalSyntheticRuntimeDriver(
        undefined,
        runtimeJournal,
        () => new Date(suite.clock),
      );
      await expect(malformedDriver.releaseFinal(attemptRef)).rejects.toMatchObject({
        code: 'INTEGRATION_RUNTIME_FINAL_SCHEMA_INVALID',
      });
      expect(await malformedDriver.readFinal(attemptRef)).toBeUndefined();
      await expect(
        firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      await expireRejectedFinalRun();
      return;
    }
    if (await verifyTerminalExpiry(stageDependencies)) return;
    if (await verifyCancelReview(stageDependencies)) return;
    if (await verifyRunCancellation(stageDependencies)) return;
    if (await verifyCancelArbitration(stageDependencies)) return;
    if (await verifyCancelAuthorization(stageDependencies)) return;
    if (await verifyCancelLateFinal(stageDependencies)) return;
    await expect(
      firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
    ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
    if (terminalScenario === 'RECOVERY' || terminalScenario === 'RECOVERY_WORKER') {
      expect(
        await recoverControlledFinalRuns(
          suite.teDb,
          scanContext,
          {
            now: () => new Date(suite.clock),
            revalidateScan: scanProof,
            readFinal: async (originalAttemptRef) => {
              expect(originalAttemptRef).toEqual(attemptRef);
              await expect(
                firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
              ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
              return undefined;
            },
            readRun: () => Promise.reject(new Error('unobserved final must not read Run')),
            readPolicy: () => Promise.reject(new Error('unobserved final must not read Policy')),
            listProgress: () =>
              listControlledFinalProgress(
                guardedTeDb,
                progressListAuthorization.context,
                progressListAuthorization.proof,
              ),
            createProgress: () =>
              Promise.reject(new Error('unobserved final must not create Process')),
            advanceProgress: () =>
              Promise.reject(new Error('unobserved final must not advance Process')),
            suspendTimedOutProgress: () =>
              Promise.reject(new Error('unobserved final must not suspend Process')),
            execute: () => Promise.reject(new Error('unobserved final must not submit')),
          },
          1,
        ),
      ).toBe(0);
    }
    const observingDriver = new LocalSyntheticRuntimeDriver(undefined, runtimeJournal);
    const observingEntry = createControlledFirstRunEntry({
      taskExecutionDb: guardedTeDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(queryProbe),
      runtimeDriver: observingDriver,
      receiptStorage: runtimeJournal,
      capabilityCodes: firstRunCodes,
      ...(bounded
        ? {
            recovery: {
              recoveryCapabilityCodes: recoveryCodes,
              humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
            },
          }
        : {}),
      capabilities: dependencyCapabilities,
      now: () => new Date(suite.clock),
    });
    expect(await observingDriver.readFinal(attemptRef)).toEqual(
      await runtimeDriver.readFinal(attemptRef),
    );
    expect(observingDriver.invokedAttemptIds).toEqual([]);
    if (exercisePreparationMatrix) {
      const unobservedFinal = await observingDriver.readFinal(attemptRef);
      if (unobservedFinal === undefined) throw new Error('missing unobserved synthetic final');
      const unobservedBody = record(unobservedFinal.agentResultContract);
      const unobservedSubmit = await firstRunEnvelope(
        'execution.submit_agent_result',
        objectRef(
          'execution.agent_result',
          String(unobservedBody.agentResultId),
          suite.scope(),
        ) as Common.ObjectRef,
        {
          agentResultContract: unobservedBody,
          runFencingToken: 1,
          runtimeSubmissionRef: unobservedFinal.runtimeSubmissionRef,
        } as unknown as CanonicalJsonObject,
        service,
      );
      await expect(
        firstRunEntry.submitAgentResult(unobservedSubmit, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(unobservedSubmit.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      const unavailableEntry = createControlledFirstRunEntry({
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb: suite.enterpriseProjectDb,
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(
          queryProbe,
        ),
        runtimeDriver: {
          invoke: () => Promise.reject(new Error('unexpected synthetic invocation')),
          readBack: (ref) => observingDriver.readBack(ref),
          readFinal: () => Promise.reject(new Error('injected IG final read outage')),
        },
        receiptStorage: runtimeJournal,
        capabilityCodes: firstRunCodes,
        ...(bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: recoveryCodes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(suite.clock),
      });
      await expect(
        unavailableEntry.observeRuntimeFinal(finalQuery, suite.sessionFor(service)),
      ).rejects.toThrow('injected IG final read outage');
      await expect(
        firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
    }
    if (terminalScenario === 'IG_WRONG_SESSION') {
      const actualFinal = await observingDriver.readFinal(attemptRef);
      if (actualFinal === undefined) throw new Error('missing wrong-session final');
      expect(
        suite.registry.validateCoreContract(
          'https://schemas.zhiju.local/core/agent-result/1.0',
          actualFinal.agentResultContract,
        ).valid,
      ).toBe(true);
      expect(
        record(actualFinal.agentResultContract.provenance).runtimeSessionExternalRef,
      ).not.toEqual(dispatched.acknowledgement?.runtimeSessionRef);
      await expect(
        observingEntry.observeRuntimeFinal(finalQuery, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      await expect(
        firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
      await expireRejectedFinalRun();
      return;
    }
    if (await verifyFinalBinding(stageDependencies)) return;
    async function finalDependencyRefusals(
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      execute: (
        entry: ReturnType<typeof createControlledFirstRunEntry>,
        value: unknown,
        session: InitialContextSession,
      ) => Promise<unknown>,
    ) {
      return verifyFinalDependencies(stageDependencies, envelope, execute);
    }
    async function finalEligibilityLoss(
      step: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE',
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      execute: (value: unknown) => Promise<unknown>,
    ) {
      return verifyEligibilityLoss(stageDependencies, step, envelope, execute);
    }

    async function finalSqlRefusals(
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      execute: (value: unknown) => Promise<unknown>,
    ) {
      return verifyFinalSql(stageDependencies, envelope, execute);
    }

    async function finalSourceReceiptRefusals(
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      execute: (value: unknown) => Promise<unknown>,
    ) {
      if (terminalScenario !== 'SUCCEEDED') return;
      await suite.admin
        .query(`CREATE FUNCTION task_execution.wi224_source_probe_end() RETURNS trigger
          LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_SOURCE_PROBE_ACCEPTED'; END $f$`);
      await suite.admin
        .query(`CREATE TRIGGER zz_wi224_source_probe AFTER UPDATE ON task_execution.command_receipt
          FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid AND NEW.outcome='COMMITTED')
          EXECUTE FUNCTION task_execution.wi224_source_probe_end()`);
      const probe = async (statement: string) => {
        await suite.admin
          .query(`CREATE FUNCTION task_execution.wi224_source_probe_change() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN ${statement} RETURN NEW; END $f$`);
        await suite.admin
          .query(`CREATE TRIGGER aa_wi224_source_probe BEFORE INSERT ON task_execution.command_receipt
            FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid)
            EXECUTE FUNCTION task_execution.wi224_source_probe_change()`);
        try {
          await execute(envelope);
          return 'UNEXPECTED_SUCCESS';
        } catch (error) {
          if (error instanceof Error && error.message.includes('WI224_SOURCE_PROBE_ACCEPTED'))
            return 'ACCEPTED';
          return error !== null && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'UNKNOWN';
        } finally {
          await suite.admin.query(
            'DROP TRIGGER aa_wi224_source_probe ON task_execution.command_receipt',
          );
          await suite.admin.query('DROP FUNCTION task_execution.wi224_source_probe_change()');
        }
      };
      try {
        expect(await probe(''), `${envelope.commandType} complete source baseline`).toBe(
          'ACCEPTED',
        );
        for (const [label, statement] of [
          ['request Hash', "NEW.request_payload_hash:=decode(repeat('0',64),'hex');"],
          ['command version', "NEW.command_version:='9.0';"],
          ['target', `NEW.target_id:='${newUuidV7()}'::uuid;`],
          ['principal', `NEW.created_by_principal_id:='${newUuidV7()}'::uuid;`],
          ['Decision', `NEW.authorization_decision_id:='${newUuidV7()}'::uuid;`],
          ...(envelope.expectedAggregateVersion === undefined
            ? []
            : [
                [
                  'CAS expected version',
                  `NEW.expected_aggregate_version:=${envelope.expectedAggregateVersion + 1};`,
                ] as const,
              ]),
        ] as const) {
          const code = await probe(statement);
          expect
            .soft(['22023', '23514', '42501', '23503'], `${envelope.commandType} ${label}: ${code}`)
            .toContain(code);
          expect(await suite.receiptRows(envelope.idempotencyKey)).toEqual([]);
        }
      } finally {
        await suite.admin.query(
          'DROP TRIGGER zz_wi224_source_probe ON task_execution.command_receipt',
        );
        await suite.admin.query('DROP FUNCTION task_execution.wi224_source_probe_end()');
      }
    }
    async function finalValidationAtomicity(
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
    ) {
      if (terminalScenario !== 'SUCCEEDED') return;
      for (const kind of ['SCHEMA', 'ALL'] as const) {
        await suite.admin
          .query(`CREATE FUNCTION task_execution.wi224_omit_validation() RETURNS trigger
            LANGUAGE plpgsql AS $f$ BEGIN
              IF '${kind}'='ALL' OR NEW.kind='${kind}' THEN RETURN NULL; END IF;
              RETURN NEW; END $f$`);
        await suite.admin
          .query(`CREATE TRIGGER aa_wi224_omit_validation BEFORE INSERT ON task_execution.result_validation_fact
            FOR EACH ROW WHEN (NEW.source_command_id='${envelope.commandId}'::uuid)
            EXECUTE FUNCTION task_execution.wi224_omit_validation()`);
        try {
          await expect(
            firstRunEntry.validateAgentResult(envelope, suite.sessionFor(service)),
            kind,
          ).rejects.toMatchObject({ code: '22023' });
        } finally {
          await suite.admin.query(
            'DROP TRIGGER aa_wi224_omit_validation ON task_execution.result_validation_fact',
          );
          await suite.admin.query('DROP FUNCTION task_execution.wi224_omit_validation()');
        }
        expect(await suite.receiptRows(envelope.idempotencyKey)).toEqual([]);
        for (const table of [
          'execution_judgment',
          'result_validation_bundle',
          'result_validation_fact',
        ])
          expect(
            (
              await suite.admin.query<{ count: string }>(
                `SELECT count(*)::text FROM task_execution.${table} WHERE source_command_id=$1`,
                [envelope.commandId],
              )
            ).rows,
            `${table} no partial ${kind}`,
          ).toEqual([{ count: '0' }]);
        expect(
          (
            await suite.admin.query<{ status: string }>(
              'SELECT status FROM task_execution.run WHERE run_id=$1',
              [runRef.objectId],
            )
          ).rows,
        ).toEqual([{ status: 'RESULT_RECORDED' }]);
      }
    }
    async function finalReceiptRollback(
      envelope: Awaited<ReturnType<typeof firstRunEnvelope>>,
      execute: (value: unknown) => Promise<unknown>,
    ) {
      if (!exercisePreparationMatrix) return;
      const snapshot = async () =>
        (
          await suite.admin.query<{ run: unknown; claim: unknown }>(
            `SELECT to_jsonb(r) AS run, to_jsonb(c) AS claim
             FROM task_execution.run r JOIN task_execution.work_order_run_claim c USING (run_id)
            WHERE r.run_id=$1`,
            [runRef.objectId],
          )
        ).rows;
      const before = await snapshot();
      await suite.admin.query(`CREATE FUNCTION task_execution.wi224_receipt_fault() RETURNS trigger
          LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI224_RECEIPT_FAULT'; END $f$`);
      await suite.admin
        .query(`CREATE TRIGGER wi224_receipt_fault AFTER UPDATE ON task_execution.command_receipt
          FOR EACH ROW WHEN (NEW.command_id='${envelope.commandId}'::uuid AND NEW.outcome='COMMITTED')
          EXECUTE FUNCTION task_execution.wi224_receipt_fault()`);
      try {
        await expect(execute(envelope), envelope.commandType).rejects.toThrow(
          'WI224_RECEIPT_FAULT',
        );
      } finally {
        await suite.admin.query(
          'DROP TRIGGER wi224_receipt_fault ON task_execution.command_receipt',
        );
        await suite.admin.query('DROP FUNCTION task_execution.wi224_receipt_fault()');
      }
      expect(await suite.receiptRows(envelope.idempotencyKey), envelope.commandType).toEqual([]);
      expect(await snapshot(), envelope.commandType).toEqual(before);
      for (const table of [
        'agent_result',
        'run_final_submission_claim',
        'execution_judgment',
        'result_validation_bundle',
        'result_validation_fact',
        'agent_result_acceptance',
        'reference_edge',
        'outbox_event',
      ]) {
        expect(
          (
            await suite.admin.query<{ count: string }>(
              `SELECT count(*)::text FROM task_execution.${table} WHERE source_command_id=$1`,
              [envelope.commandId],
            )
          ).rows,
          `${envelope.commandType} ${table}`,
        ).toEqual([{ count: '0' }]);
      }
    }

    const observed = await observingEntry.observeRuntimeFinal(
      finalQuery,
      suite.sessionFor(service),
    );
    expect(observed).toBeDefined();
    const finalView = await firstRunEntry.getRuntimeFinalObservation(
      finalQuery,
      suite.sessionFor(service),
    );
    expect(finalView.observationRef).toEqual(observed?.observationRef);
    if (exercisePreparationMatrix) {
      expect(
        await observingEntry.observeRuntimeFinal(finalQuery, suite.sessionFor(service)),
      ).toEqual(finalView);
    }
    if (exercisePreparationMatrix) {
      const unknownAttemptRef = objectRef(
        'integration.runtime_attempt',
        newUuidV7(),
        suite.scope(),
      ) as Common.ObjectRef;
      await expect(
        firstRunEntry.getRuntimeFinalObservation(
          await firstRunQuery(
            'integration.get_runtime_final_observation',
            unknownAttemptRef,
            { attemptRef: unknownAttemptRef } as unknown as CanonicalJsonObject,
            'runtimeFinalReadV1',
          ),
          suite.sessionFor(service),
        ),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND' });
      expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
    }
    if (terminalScenario === 'UNSUPPORTED_FINAL') {
      const unsupportedBody = record(finalView.agentResultContract);
      if (negativeFinalCase === 'RUNTIME_USAGE')
        expect(unsupportedBody.runtimeUsageRef).toEqual(read.contractRef);
      if (negativeFinalCase === 'TIME') {
        const startedAt = startEnvelope.payload.startedAt;
        const submittedAt = unsupportedBody.submittedAt;
        if (typeof startedAt !== 'string' || typeof submittedAt !== 'string')
          throw new Error('missing final timestamps');
        expect(Date.parse(submittedAt)).toBeLessThan(Date.parse(startedAt));
      }
      const unsupportedSubmit = await firstRunEnvelope(
        'execution.submit_agent_result',
        objectRef(
          'execution.agent_result',
          String(unsupportedBody.agentResultId),
          suite.scope(),
        ) as Common.ObjectRef,
        {
          agentResultContract: unsupportedBody,
          runFencingToken: 1,
          runtimeSubmissionRef: finalView.runtimeSubmissionRef,
        } as CanonicalJsonObject,
        service,
      );
      await expect(
        firstRunEntry.submitAgentResult(unsupportedSubmit, suite.sessionFor(service)),
      ).rejects.toMatchObject({
        code: ['HEADER', 'PROVENANCE', 'TIME'].includes(negativeFinalCase)
          ? 'REFERENCE_INVALID'
          : 'EXECUTION_CRITERION_UNSUPPORTED',
      });
      expect(await suite.receiptRows(unsupportedSubmit.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      expect(
        (
          await suite.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'ACTIVE' }]);
      await expireRejectedFinalRun();
      return;
    }
    if (exercisePreparationMatrix) {
      const conflictAudits = async () =>
        (
          await suite.admin.query<{ safe_summary: string }>(
            `SELECT safe_summary FROM integration_gateway.audit_record WHERE target_id=$1
           AND error_code='INTEGRATION_RUNTIME_FINAL_CONFLICT' ORDER BY audit_id`,
            [attemptRef.objectId],
          )
        ).rows;
      const priorConflictAudits = await conflictAudits();
      const conflictingEntry = createControlledFirstRunEntry({
        taskExecutionDb: guardedTeDb,
        enterpriseProjectDb: suite.enterpriseProjectDb,
        identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
        integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(
          queryProbe,
        ),
        runtimeDriver: {
          invoke: () => Promise.reject(new Error('unexpected second synthetic invocation')),
          readBack: (ref) => observingDriver.readBack(ref),
          readFinal: async (ref) => {
            const original = await observingDriver.readFinal(ref);
            return original === undefined
              ? undefined
              : {
                  ...original,
                  runtimeSubmissionRef: {
                    ...original.runtimeSubmissionRef,
                    externalId: newUuidV7(),
                  },
                };
          },
        },
        receiptStorage: runtimeJournal,
        capabilityCodes: firstRunCodes,
        ...(bounded
          ? {
              recovery: {
                recoveryCapabilityCodes: recoveryCodes,
                humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
              },
            }
          : {}),
        capabilities: dependencyCapabilities,
        now: () => new Date(suite.clock),
      });
      await expect(
        conflictingEntry.observeRuntimeFinal(finalQuery, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_CONFLICT' });
      const retainedConflictAudits = await conflictAudits();
      expect(retainedConflictAudits).toHaveLength(priorConflictAudits.length + 1);
      expect(retainedConflictAudits.at(-1)).toEqual({
        safe_summary: 'synthetic final conflicts with the immutable observation',
      });

      expect(
        await firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
      ).toEqual(finalView);
    }
    if (await verifyInitialFinalPermissions(stageDependencies)) return;
    const restartedDriver = new LocalSyntheticRuntimeDriver();
    const restartedEntry = createControlledFirstRunEntry({
      taskExecutionDb: guardedTeDb,
      enterpriseProjectDb: suite.enterpriseProjectDb,
      identity: { db: suite.identityDb, repo: suite.identityRepo, crypto: suite.crypto },
      integrationGatewayDb: createIntegrationRendererDatabase(suite.tePool).withPlugin(queryProbe),
      runtimeDriver: restartedDriver,
      receiptStorage: new InMemoryRenderObjectStorage(),
      capabilityCodes: firstRunCodes,
      ...(bounded
        ? {
            recovery: {
              recoveryCapabilityCodes: recoveryCodes,
              humanCapabilityCodes: recoveryConfig.humanCapabilityCodes,
            },
          }
        : {}),
      capabilities: dependencyCapabilities,
      now: () => new Date(suite.clock),
    });
    expect(
      await restartedEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
    ).toEqual(finalView);
    expect(restartedDriver.invokedAttemptIds).toEqual([]);
    expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
    if (await verifyRecoveryExpiry(stageDependencies)) return;
    if (await verifyProcessRecovery(stageDependencies)) return;
    const resultBody = record(finalView.agentResultContract);
    const resultTarget = objectRef(
      'execution.agent_result',
      String(resultBody.agentResultId),
      suite.scope(),
    ) as Common.ObjectRef;
    suite.phase('Result submit boundary');
    let submitEnvelope = await firstRunEnvelope(
      'execution.submit_agent_result',
      resultTarget,
      {
        agentResultContract: resultBody,
        runFencingToken: 1,
        runtimeSubmissionRef: finalView.runtimeSubmissionRef,
      } as unknown as CanonicalJsonObject,
      service,
    );
    if (exercisePreparationMatrix) {
      const wrongSubmission = await firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: resultBody,
          runFencingToken: 1,
          runtimeSubmissionRef: {
            ...finalView.runtimeSubmissionRef,
            externalId: newUuidV7(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      await expect(
        firstRunEntry.submitAgentResult(wrongSubmission, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
    }
    if (await verifySubmissionBinding(stageDependencies)) return;
    if (await verifySubmissionConcurrency(stageDependencies)) return;
    if (
      await finalEligibilityLoss('SUBMIT', submitEnvelope, (value) =>
        firstRunEntry.submitAgentResult(value, suite.sessionFor(service)),
      )
    )
      return;
    await finalDependencyRefusals(submitEnvelope, (entry, value, session) =>
      entry.submitAgentResult(value, session),
    );
    await finalSqlRefusals(submitEnvelope, (value) =>
      firstRunEntry.submitAgentResult(value, suite.sessionFor(service)),
    );
    await finalSourceReceiptRefusals(submitEnvelope, (value) =>
      firstRunEntry.submitAgentResult(value, suite.sessionFor(service)),
    );
    await finalReceiptRollback(submitEnvelope, (value) =>
      firstRunEntry.submitAgentResult(value, suite.sessionFor(service)),
    );
    const submitted = await (
      exitHooks
        ? withExitResponseRecovery(withRecoveryReceiptFaults(restartedEntry, true), true)
        : restartedEntry
    ).submitAgentResult(submitEnvelope, suite.sessionFor(service));
    expect(submitted, JSON.stringify(submitted)).toMatchObject({
      status: expectedCommandStatus(submitEnvelope),
    });
    expect(
      await scanControlledFinalCandidates(
        guardedTeDb,
        scanContext,
        () => new Date(suite.clock),
        scanProof,
      ),
    ).toEqual([]);
    if (exercisePreparationMatrix) {
      const forgedBody = { ...resultBody, humanSummary: 'Forged final body.' };
      const forgedSubmit = await firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: forgedBody,
          runFencingToken: 1,
          runtimeSubmissionRef: finalView.runtimeSubmissionRef,
        },
        service,
      );
      await expect(
        firstRunEntry.submitAgentResult(forgedSubmit, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      const alternateId = newUuidV7();
      for (const [label, body, target] of [
        [
          'same Result ID with changed content Hash',
          {
            ...forgedBody,
            header: {
              ...record(resultBody.header),
              payloadHash: contentHash(hashContractPayload(forgedBody)),
            },
          },
          resultTarget,
        ],
        [
          'different Result ID with original Hash',
          { ...resultBody, agentResultId: alternateId },
          objectRef('execution.agent_result', alternateId, suite.scope()) as Common.ObjectRef,
        ],
      ] as const) {
        const alternateSubmit = await firstRunEnvelope(
          'execution.submit_agent_result',
          target,
          {
            agentResultContract: body,
            runFencingToken: 1,
            runtimeSubmissionRef: finalView.runtimeSubmissionRef,
          } as unknown as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.submitAgentResult(alternateSubmit, suite.sessionFor(service)),
          label,
        ).rejects.toBeDefined();
        expect(await suite.receiptRows(alternateSubmit.idempotencyKey), label).toEqual([]);
        expect(await suite.auditRows(alternateSubmit.commandId), label).toEqual([
          {
            outcome: 'DENIED',
            error_code: 'EXECUTION_FINAL_CONFLICT',
            safe_summary: 'controlled final request rejected; business transaction rolled back',
          },
        ]);
      }
      expect(runtimeDriver.invokedAttemptIds).toEqual([attemptRef.objectId]);
    }
    expect(
      (
        await suite.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.agent_result WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '1' }]);
    const resultRef = record(firstRunPayload(submitted as CommandResult))
      .agentResultRef as Common.ContentAddressedRef;
    if (exercisePreparationMatrix) {
      const resultOnlyFinalize = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        {
          acceptanceRecordRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'execution.agent_result_acceptance',
            objectId: newUuidV7(),
            scope: suite.scope(),
            contentHash: contentHash('0'.repeat(64)),
          },
        } as unknown as CanonicalJsonObject,
        service,
        2,
      );
      await expect(
        firstRunEntry.finalizeRun(resultOnlyFinalize, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(resultOnlyFinalize.idempotencyKey)).toEqual([]);
    }
    const resultQuery = await firstRunQuery(
      'execution.get_agent_result',
      resultRef,
      { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
      'agentResultReadV1',
    );
    await expect(
      firstRunEntry.getAgentResult(resultQuery, suite.sessionFor(service)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const readCurrentRun = async () =>
      firstRunEntry.getRunState(
        await firstRunQuery(
          'execution.get_run_state',
          runRef,
          { runRef } as unknown as CanonicalJsonObject,
          'runStateReadV1',
        ),
        suite.sessionFor(service),
      );
    const reservedRunView = await readCurrentRun();
    expect(reservedRunView).toMatchObject({ status: 'RUNNING', aggregateVersion: 2 });
    expect(reservedRunView).not.toHaveProperty('resultRef');
    if (bounded) {
      const barrier = await recoveryEntryRaw.read(
        await recoveryEnvelope(
          'workOrderExecutionStateReadV1',
          workOrderRef,
          { workOrderRef } as unknown as CanonicalJsonObject,
          service,
          undefined,
          true,
        ),
        suite.sessionFor(service),
      );
      expect(barrier).toMatchObject({
        blockerRefs: [resultRef],
        informationRequestRefs: [],
        retryEligibility: 'WAITING_INPUT',
      });
      const taskBarrier = await recoveryEntryRaw.read(
        await recoveryEnvelope(
          'taskStateReadV1',
          revised.taskRef as Common.ObjectRef,
          { taskRef: revised.taskRef } as unknown as CanonicalJsonObject,
          service,
          undefined,
          true,
        ),
        suite.sessionFor(service),
      );
      expect(taskBarrier).toMatchObject({ blockerRefs: [resultRef] });
    }

    suite.phase('Result record boundary');
    const recordEnvelope = await firstRunEnvelope(
      'execution.record_run_result',
      runRef,
      { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
      service,
      2,
    );
    if (
      await finalEligibilityLoss('RECORD', recordEnvelope, (value) =>
        firstRunEntry.recordRunResult(value, suite.sessionFor(service)),
      )
    )
      return;
    await finalDependencyRefusals(recordEnvelope, (entry, value, session) =>
      entry.recordRunResult(value, session),
    );
    await finalSqlRefusals(recordEnvelope, (value) =>
      firstRunEntry.recordRunResult(value, suite.sessionFor(service)),
    );
    await finalSourceReceiptRefusals(recordEnvelope, (value) =>
      firstRunEntry.recordRunResult(value, suite.sessionFor(service)),
    );
    await finalReceiptRollback(recordEnvelope, (value) =>
      firstRunEntry.recordRunResult(value, suite.sessionFor(service)),
    );
    const recorded = await firstRunEntry.recordRunResult(recordEnvelope, suite.sessionFor(service));
    expect(recorded, JSON.stringify(recorded)).toMatchObject({ status: 'COMMITTED' });
    expect(await readCurrentRun()).toMatchObject({
      status: 'RESULT_RECORDED',
      aggregateVersion: 3,
      resultRef,
    });
    await expect(
      firstRunEntry.getAgentResult(resultQuery, suite.sessionFor(service)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const finalEvaluator = registeredEvaluatorProfileReference(
      'im06-evaluator-static-v1',
      formal
        ? 'te.agent_result_validation.evaluator@2.0'
        : 'te.agent_result_validation.evaluator@1.0',
    );
    expect(finalEvaluator).toBeDefined();
    const validationTarget = objectRef(
      'zhiju.execution.agent_result_validation_bundle',
      newUuidV7(),
      suite.scope(),
    ) as Common.ObjectRef;
    suite.phase('Result validation boundary');
    const validateEnvelope = await firstRunEnvelope(
      'execution.validate_agent_result',
      validationTarget,
      {
        agentResultRef: resultRef,
        runRef,
        runtimeAttemptRef: attemptRef,
        policyRef: controlsRef,
        evaluatorRef: finalEvaluator,
      } as unknown as CanonicalJsonObject,
      service,
    );
    if (exercisePreparationMatrix) {
      for (const [field, replacement] of [
        ['runtimeAttemptRef', objectRef('integration.runtime_attempt', newUuidV7(), suite.scope())],
        ['policyRef', policyKey([newUuidV7(), newUuidV7()], suite.fixture)],
        ['agentResultRef', { ...resultRef, objectId: newUuidV7() }],
        ['agentResultRef', { ...resultRef, contentHash: contentHash('0'.repeat(64)) }],
        [
          'agentResultRef',
          {
            ...resultRef,
            scope: { enterpriseId: suite.fixture.enterpriseId, projectId: newUuidV7() },
          },
        ],
        ['runRef', { ...runRef, objectId: newUuidV7() }],
        [
          'runRef',
          {
            ...runRef,
            scope: { enterpriseId: suite.fixture.enterpriseId, projectId: newUuidV7() },
          },
        ],
        ['evaluatorRef', { ...finalEvaluator, versionId: newUuidV7() }],
      ] as const) {
        const invalidValidation = await firstRunEnvelope(
          'execution.validate_agent_result',
          objectRef(
            'zhiju.execution.agent_result_validation_bundle',
            newUuidV7(),
            suite.scope(),
          ) as Common.ObjectRef,
          { ...validateEnvelope.payload, [field]: replacement } as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.validateAgentResult(invalidValidation, suite.sessionFor(service)),
        ).rejects.toBeDefined();
      }
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.result_validation_bundle WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
    }
    if (
      await finalEligibilityLoss('VALIDATE', validateEnvelope, (value) =>
        firstRunEntry.validateAgentResult(value, suite.sessionFor(service)),
      )
    )
      return;
    await finalDependencyRefusals(validateEnvelope, (entry, value, session) =>
      entry.validateAgentResult(value, session),
    );
    await finalSqlRefusals(validateEnvelope, (value) =>
      firstRunEntry.validateAgentResult(value, suite.sessionFor(service)),
    );
    await finalSourceReceiptRefusals(validateEnvelope, (value) =>
      firstRunEntry.validateAgentResult(value, suite.sessionFor(service)),
    );
    await finalReceiptRollback(validateEnvelope, (value) =>
      firstRunEntry.validateAgentResult(value, suite.sessionFor(service)),
    );
    await finalValidationAtomicity(validateEnvelope);
    const validatedFinal = await firstRunEntry.validateAgentResult(
      validateEnvelope,
      suite.sessionFor(service),
    );
    expect(validatedFinal, JSON.stringify(validatedFinal)).toMatchObject({
      status: 'COMMITTED',
    });
    expect(
      (
        await suite.admin.query<{ judgment_kind: string; result_id: string }>(
          'SELECT judgment_kind,result_id FROM task_execution.execution_judgment WHERE judgment_id=$1',
          [validationTarget.objectId],
        )
      ).rows,
    ).toEqual([{ judgment_kind: 'RESULT_VALIDATION_BUNDLE', result_id: resultTarget.objectId }]);
    const finalValidations = record(suite.committedPayload(validatedFinal as CommandResult));
    if (exercisePreparationMatrix) {
      const secondBundle = await firstRunEnvelope(
        'execution.validate_agent_result',
        objectRef(
          'zhiju.execution.agent_result_validation_bundle',
          newUuidV7(),
          suite.scope(),
        ) as Common.ObjectRef,
        validateEnvelope.payload,
        service,
      );
      await expect(
        firstRunEntry.validateAgentResult(secondBundle, suite.sessionFor(service)),
      ).rejects.toMatchObject({ code: 'EXECUTION_FINAL_CONFLICT' });
      expect(await suite.receiptRows(secondBundle.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.result_validation_bundle WHERE result_id=$1',
            [resultTarget.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      const absentAcceptance = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        {
          acceptanceRecordRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'execution.agent_result_acceptance',
            objectId: newUuidV7(),
            scope: suite.scope(),
            contentHash: contentHash('0'.repeat(64)),
          },
        } as unknown as CanonicalJsonObject,
        service,
        3,
      );
      await expect(
        firstRunEntry.finalizeRun(absentAcceptance, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(absentAcceptance.idempotencyKey)).toEqual([]);
    }
    expect(await readCurrentRun()).toMatchObject({
      status: 'RESULT_RECORDED',
      aggregateVersion: 3,
      resultRef,
    });
    await expect(
      firstRunEntry.getAgentResult(resultQuery, suite.sessionFor(service)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    let acceptanceTarget = objectRef(
      'execution.agent_result_acceptance',
      newUuidV7(),
      suite.scope(),
    ) as Common.ObjectRef;
    suite.phase('Result acceptance boundary');
    let acceptEnvelope = await firstRunEnvelope(
      'execution.accept_agent_result',
      acceptanceTarget,
      {
        agentResultRef: resultRef,
        schemaValidationRef: finalValidations.schemaValidationRef,
        identityValidationRef: finalValidations.identityValidationRef,
        runBindingValidationRef: finalValidations.runBindingValidationRef,
        scopeValidationRef: finalValidations.scopeValidationRef,
        businessOutputValidationRef: finalValidations.businessOutputValidationRef,
        disposition: 'ACCEPTED',
        reasons: [],
      } as unknown as CanonicalJsonObject,
      service,
    );
    if (terminalScenario === 'VALIDATION_EXPIRED') {
      const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
      if (deadlineWait > 0)
        await suite.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
      suite.clock = Date.now();
      await expect(
        firstRunEntry.acceptAgentResult(acceptEnvelope, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(acceptEnvelope.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      const expiredValidationRun = await firstRunEntry.expireRun(
        await firstRunEnvelope(
          'execution.expire_run',
          runRef,
          { reason: 'DEADLINE_EXCEEDED' },
          service,
          3,
        ),
        suite.sessionFor(service),
      );
      expect(expiredValidationRun).toMatchObject({ status: 'COMMITTED' });
      return;
    }
    if (exercisePreparationMatrix) {
      const original = acceptEnvelope.payload;
      for (const [field, replacement] of [
        [
          'schemaValidationRef',
          {
            ...record(original.schemaValidationRef),
            objectId: newUuidV7(),
          },
        ],
        [
          'identityValidationRef',
          {
            ...record(original.identityValidationRef),
            contentHash: contentHash(sha256CanonicalJson({ forged: true })),
          },
        ],
        [
          'schemaValidationRef',
          {
            ...record(original.schemaValidationRef),
            scope: { enterpriseId: suite.fixture.enterpriseId, projectId: newUuidV7() },
          },
        ],
        [
          'businessOutputValidationRef',
          {
            ...record(original.businessOutputValidationRef),
            objectId: newUuidV7(),
          },
        ],
        [
          'runBindingValidationRef',
          { ...record(original.runBindingValidationRef), objectId: newUuidV7() },
        ],
        ['scopeValidationRef', { ...record(original.scopeValidationRef), objectId: newUuidV7() }],
        ['schemaValidationRef', original.identityValidationRef],
        ['identityValidationRef', original.runBindingValidationRef],
        ['runBindingValidationRef', original.scopeValidationRef],
        ['scopeValidationRef', original.businessOutputValidationRef],
        ['businessOutputValidationRef', original.schemaValidationRef],
        ['agentResultRef', { ...resultRef, objectId: newUuidV7() }],
        ['disposition', 'REJECTED'],
        ['disposition', 'QUARANTINED'],
      ] as const) {
        const invalidAcceptance = await firstRunEnvelope(
          'execution.accept_agent_result',
          objectRef(
            'execution.agent_result_acceptance',
            newUuidV7(),
            suite.scope(),
          ) as Common.ObjectRef,
          { ...original, [field]: replacement } as CanonicalJsonObject,
          service,
        );
        await expect(
          firstRunEntry.acceptAgentResult(invalidAcceptance, suite.sessionFor(service)),
        ).rejects.toBeDefined();
      }
      const selfReportedAcceptance = await firstRunEnvelope(
        'execution.accept_agent_result',
        objectRef(
          'execution.agent_result_acceptance',
          newUuidV7(),
          suite.scope(),
        ) as Common.ObjectRef,
        { ...original, valid: true },
        service,
      );
      await expect(
        firstRunEntry.acceptAgentResult(selfReportedAcceptance, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(selfReportedAcceptance.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
    }
    if (
      await finalEligibilityLoss('ACCEPT', acceptEnvelope, (value) =>
        firstRunEntry.acceptAgentResult(value, suite.sessionFor(service)),
      )
    )
      return;
    await finalDependencyRefusals(acceptEnvelope, (entry, value, session) =>
      entry.acceptAgentResult(value, session),
    );
    await finalSqlRefusals(acceptEnvelope, (value) =>
      firstRunEntry.acceptAgentResult(value, suite.sessionFor(service)),
    );
    await finalSourceReceiptRefusals(acceptEnvelope, (value) =>
      firstRunEntry.acceptAgentResult(value, suite.sessionFor(service)),
    );
    await finalReceiptRollback(acceptEnvelope, (value) =>
      firstRunEntry.acceptAgentResult(value, suite.sessionFor(service)),
    );
    if (positiveFinalScenario && foreignValidations !== undefined) {
      for (const field of [
        'schemaValidationRef',
        'identityValidationRef',
        'runBindingValidationRef',
        'scopeValidationRef',
        'businessOutputValidationRef',
      ] as const) {
        const foreignRef = foreignValidations[field];
        if (foreignRef === undefined) throw new Error(`missing owning ${field}`);
        const mixed = await firstRunEnvelope(
          'execution.accept_agent_result',
          objectRef(
            'execution.agent_result_acceptance',
            newUuidV7(),
            suite.scope(),
          ) as Common.ObjectRef,
          { ...acceptEnvelope.payload, [field]: foreignRef },
          service,
        );
        await expect(
          firstRunEntry.acceptAgentResult(mixed, suite.sessionFor(service)),
          field,
        ).rejects.toBeDefined();
        expect(await suite.receiptRows(mixed.idempotencyKey), field).toEqual([]);
      }
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
    }
    let accepted: Awaited<ReturnType<typeof firstRunEntry.acceptAgentResult>>;
    if (terminalScenario === 'ACCEPT_RACE') {
      const competingTarget = objectRef(
        'execution.agent_result_acceptance',
        newUuidV7(),
        suite.scope(),
      ) as Common.ObjectRef;
      const competingEnvelope = await firstRunEnvelope(
        'execution.accept_agent_result',
        competingTarget,
        acceptEnvelope.payload,
        service,
      );
      const attempts = [acceptEnvelope, competingEnvelope];
      const race = await Promise.allSettled(
        attempts.map((value) => firstRunEntry.acceptAgentResult(value, suite.sessionFor(service))),
      );
      expect(race.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
      expect(race.filter((value) => value.status === 'rejected')).toHaveLength(1);
      const winnerIndex = race.findIndex((value) => value.status === 'fulfilled');
      const winner = race[winnerIndex];
      const winnerEnvelope = attempts[winnerIndex];
      const loserEnvelope = attempts[1 - winnerIndex];
      if (
        winner?.status !== 'fulfilled' ||
        winnerEnvelope === undefined ||
        loserEnvelope === undefined
      )
        throw new Error('missing unique Acceptance race winner');
      expect(await suite.receiptRows(loserEnvelope.idempotencyKey)).toEqual([]);
      accepted = winner.value;
      acceptanceTarget = winnerEnvelope.targetRef;
      acceptEnvelope = winnerEnvelope;
    } else {
      await boardProbe?.('FINAL_RESERVED', runRef);
      await usageProbe?.('SUBMITTED', runRef);
      accepted = await firstRunEntry.acceptAgentResult(acceptEnvelope, suite.sessionFor(service));
    }
    expect(accepted, JSON.stringify(accepted)).toMatchObject({
      status: expectedCommandStatus(acceptEnvelope),
    });
    await usageProbe?.('ACCEPTED', runRef);
    if (exercisePreparationMatrix) {
      const secondAcceptance = await firstRunEnvelope(
        'execution.accept_agent_result',
        objectRef(
          'execution.agent_result_acceptance',
          newUuidV7(),
          suite.scope(),
        ) as Common.ObjectRef,
        acceptEnvelope.payload,
        service,
      );
      await expect(
        firstRunEntry.acceptAgentResult(secondAcceptance, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(secondAcceptance.idempotencyKey)).toEqual([]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            'SELECT count(*)::text FROM task_execution.agent_result_acceptance WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
    }
    const acceptedView = await firstRunEntry.getAgentResult(resultQuery, suite.sessionFor(service));
    expect(acceptedView.agentResultContract).toEqual(finalView.agentResultContract);
    expect(await readCurrentRun()).toMatchObject({
      status: 'RESULT_RECORDED',
      aggregateVersion: 3,
      resultRef,
    });
    const acceptanceRecordRef = record(
      firstRunPayload(accepted as CommandResult),
    ).acceptanceRecordRef;
    if (bounded) {
      // ACCEPTED alone is insufficient: the source Run has not committed terminal state.
      const proposal = record((record(resultBody).inputRequestProposals as unknown[])[0]);
      const premature = await recoveryEnvelope(
        'informationRequestOpenV1',
        objectRef('execution.information_request', newUuidV7(), suite.scope()) as Common.ObjectRef,
        {
          definition: {
            taskRef: revised.taskRef,
            workOrderRef,
            runRef,
            requestType: proposal.requestType,
            question: proposal.question,
            reason: proposal.reason,
            expectedAnswerSpec: proposal.expectedAnswerSpec,
            blocking: true,
            requestedResponder: {
              principalKind: 'HUMAN',
              roleCode: 'project.customer_material.confirmer',
              scopeRef: suite.scope(),
            },
            relatedRefs: [
              resultRef,
              acceptanceRecordRef,
              candidateMaterial,
              recoverySource,
              workOrderRef,
              revised.taskRef,
            ].sort((a, b) =>
              Buffer.compare(
                Buffer.from(canonicalize(a as CanonicalJsonObject)),
                Buffer.from(canonicalize(b as CanonicalJsonObject)),
              ),
            ),
            expiresAt: new Date(suite.clock + 300_000).toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      await expect(
        recoveryEntryRaw.command(premature, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(String(premature.idempotencyKey))).toEqual([]);
      for (const [key, ref, payload] of [
        ['workOrderExecutionStateReadV1', workOrderRef, { workOrderRef }],
        ['taskStateReadV1', revised.taskRef, { taskRef: revised.taskRef }],
      ] as const) {
        const state = await recoveryEntryRaw.read(
          await recoveryEnvelope(
            key,
            ref as Common.ObjectRef,
            payload as unknown as CanonicalJsonObject,
            service,
            undefined,
            true,
          ),
          suite.sessionFor(service),
        );
        expect(state).toMatchObject({ blockerRefs: [resultRef] });
        expect(record(state).status).not.toBe('COMPLETION_PENDING');
      }
      expect(
        (
          await suite.admin.query(
            'SELECT request_id FROM task_execution.information_request WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([]);
    }
    if (recoveryVariant === 'EXPIRE_SOURCE') {
      await suite.waitForDeadline(
        Math.max(0, runDeadline.getTime() - Date.now() + 100),
        'source expiry wins',
      );
      suite.clock = Date.now();
      const expiry = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        3,
      );
      expect(await firstRunEntryRaw.expireRun(expiry, suite.sessionFor(service))).toMatchObject({
        status: 'COMMITTED',
      });
      const proposal = record((record(resultBody).inputRequestProposals as unknown[])[0]);
      const refused = await recoveryEnvelope(
        'informationRequestOpenV1',
        objectRef('execution.information_request', newUuidV7(), suite.scope()) as Common.ObjectRef,
        {
          definition: {
            taskRef: revised.taskRef,
            workOrderRef,
            runRef,
            requestType: proposal.requestType,
            question: proposal.question,
            reason: proposal.reason,
            expectedAnswerSpec: proposal.expectedAnswerSpec,
            blocking: true,
            requestedResponder: {
              principalKind: 'HUMAN',
              roleCode: 'project.customer_material.confirmer',
              scopeRef: suite.scope(),
            },
            relatedRefs: [
              resultRef,
              acceptanceRecordRef,
              candidateMaterial,
              recoverySource,
              workOrderRef,
              revised.taskRef,
            ],
            expiresAt: new Date(suite.clock + 300_000).toISOString(),
          },
        } as unknown as CanonicalJsonObject,
        service,
      );
      await expect(
        recoveryEntryRaw.command(refused, suite.sessionFor(service)),
      ).rejects.toBeDefined();
      expect(await suite.receiptRows(String(refused.idempotencyKey))).toEqual([]);
      expect(
        (
          await suite.admin.query(
            'SELECT request_id FROM task_execution.information_request WHERE work_order_id=$1',
            [woId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await suite.admin.query(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      return;
    }
    if (terminalScenario === 'RACE') {
      const deadlineWait = Math.max(0, runDeadline.getTime() - Date.now() + 100);
      if (deadlineWait > 0)
        await suite.waitForDeadline(deadlineWait, 'server deadline/deadlineWait');
      suite.clock = Date.now();
      const raceFinalize = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        { acceptanceRecordRef } as unknown as CanonicalJsonObject,
        service,
        3,
      );
      const raceExpire = await firstRunEnvelope(
        'execution.expire_run',
        runRef,
        { reason: 'DEADLINE_EXCEEDED' },
        service,
        3,
      );
      const race = await Promise.allSettled([
        firstRunEntry.finalizeRun(raceFinalize, suite.sessionFor(service)),
        firstRunEntry.expireRun(raceExpire, suite.sessionFor(service)),
      ]);
      expect(race[0].status).toBe('rejected');
      if (race[1].status === 'rejected') throw race[1].reason;
      expect(race[1].value).toMatchObject({ status: 'COMMITTED' });
      expect(
        await firstRunEntry.getRunState(
          await firstRunQuery(
            'execution.get_run_state',
            runRef,
            { runRef } as unknown as CanonicalJsonObject,
            'runStateReadV1',
          ),
          suite.sessionFor(service),
        ),
      ).toMatchObject({ status: 'TIMED_OUT', terminationReason: 'EXECUTION_DEADLINE_EXCEEDED' });
      expect(
        (
          await suite.admin.query<{ status: string }>(
            'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      expect(
        (
          await suite.admin.query<{ count: string }>(
            "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunTerminated'",
            [runRef.objectId],
          )
        ).rows,
      ).toEqual([{ count: '1' }]);
      return;
    }
    const wrongAcceptance = await firstRunEnvelope(
      'execution.finalize_run_from_acceptance',
      runRef,
      {
        acceptanceRecordRef: {
          ...record(acceptanceRecordRef),
          objectId: newUuidV7(),
        },
      },
      service,
      3,
    );
    await expect(
      firstRunEntry.finalizeRun(wrongAcceptance, suite.sessionFor(service)),
    ).rejects.toBeDefined();
    expect(await suite.receiptRows(wrongAcceptance.idempotencyKey)).toEqual([]);
    expect(
      (
        await suite.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.run WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'RESULT_RECORDED' }]);
    suite.phase('Run finalize boundary');
    const finalizeEnvelope = await firstRunEnvelope(
      'execution.finalize_run_from_acceptance',
      runRef,
      { acceptanceRecordRef } as unknown as CanonicalJsonObject,
      service,
      3,
    );
    if (
      await finalEligibilityLoss('FINALIZE', finalizeEnvelope, (value) =>
        firstRunEntry.finalizeRun(value, suite.sessionFor(service)),
      )
    )
      return;
    await finalDependencyRefusals(finalizeEnvelope, (entry, value, session) =>
      entry.finalizeRun(value, session),
    );
    await finalSqlRefusals(finalizeEnvelope, (value) =>
      firstRunEntry.finalizeRun(value, suite.sessionFor(service)),
    );
    await finalSourceReceiptRefusals(finalizeEnvelope, (value) =>
      firstRunEntry.finalizeRun(value, suite.sessionFor(service)),
    );
    await finalReceiptRollback(finalizeEnvelope, (value) =>
      firstRunEntry.finalizeRun(value, suite.sessionFor(service)),
    );
    if (recoveryVariant === 'BUDGET_EXHAUSTED') {
      const createdAt = definedValue(
        (
          await suite.admin.query<{ created_at: Date }>(
            'SELECT created_at FROM task_execution.run WHERE run_id=$1',
            [runRef.objectId],
          )
        ).rows[0],
      ).created_at;
      budgetFinalizationWaitAt = createdAt.getTime() + 29_100;
    }
    let finalized: Awaited<ReturnType<typeof firstRunEntry.finalizeRun>>;
    const foreignAcceptance = foreignValidations?.acceptanceRecordRef;
    if (foreignAcceptance !== undefined) {
      const competing = await firstRunEnvelope(
        'execution.finalize_run_from_acceptance',
        runRef,
        { acceptanceRecordRef: foreignAcceptance },
        service,
        3,
      );
      const outcomes = await Promise.allSettled([
        firstRunEntry.finalizeRun(finalizeEnvelope, suite.sessionFor(service)),
        firstRunEntry.finalizeRun(competing, suite.sessionFor(service)),
      ]);
      const winner = outcomes[0];
      if (winner.status !== 'fulfilled')
        throw new Error('legitimate finalizer lost to another Run Acceptance');
      finalized = winner.value;
      expect(outcomes[1].status).toBe('rejected');
      expect(await suite.receiptRows(competing.idempotencyKey)).toEqual([]);
    } else finalized = await firstRunEntry.finalizeRun(finalizeEnvelope, suite.sessionFor(service));
    expect(finalized, JSON.stringify(finalized)).toMatchObject({
      status: expectedCommandStatus(finalizeEnvelope),
    });
    if (recoveryVariant === 'BUDGET_EXHAUSTED') {
      expect(budgetFinalizationWaitAt).toBeUndefined();
      const consumption = definedValue(
        (
          await suite.admin.query<{
            consumed_seconds: number;
            reserved_seconds: number;
            total_seconds: number;
            ended_at: Date;
            execution_deadline: Date;
          }>(
            'SELECT c.consumed_seconds,b.reserved_seconds,b.total_seconds,r.ended_at,r.execution_deadline FROM task_execution.run r JOIN task_execution.run_budget_reservation b USING(run_id) JOIN task_execution.run_budget_consumption c USING(run_id) WHERE r.run_id=$1',
            [runRef.objectId],
          )
        ).rows[0],
      );
      expect(consumption).toMatchObject({
        consumed_seconds: 30,
        reserved_seconds: 30,
        total_seconds: 30,
      });
      expect(consumption.ended_at.getTime()).toBeLessThan(consumption.execution_deadline.getTime());
    }
    await boardProbe?.('RUN_FINALIZED', runRef);
    if (await verifyBoundedRecovery(stageDependencies)) return;
    if (formal) {
      await completeFormal();
      return;
    }
    const boundIdentity = await suite.admin.query<{
      runtime_adapter_identity_ref: CanonicalJsonObject;
    }>('SELECT runtime_adapter_identity_ref FROM task_execution.run WHERE run_id=$1', [
      runRef.objectId,
    ]);
    expect(boundIdentity.rows).toEqual([
      { runtime_adapter_identity_ref: finalView.runtimeAdapterIdentityRef },
    ]);
    expect(finalView.runtimeAdapterIdentityRef).not.toEqual(attemptRef);
    const storedResult = await suite.admin.query<{ result_payload: CanonicalJsonObject }>(
      'SELECT result_payload FROM task_execution.agent_result WHERE run_id=$1',
      [runRef.objectId],
    );
    expect(storedResult.rows[0]?.result_payload.submittedByRuntime).toEqual(
      finalView.runtimeAdapterIdentityRef,
    );
    expect(
      (
        await suite.admin.query<{
          result_count: number;
          claim_count: number;
          bundle_count: number;
          fact_count: number;
          acceptance_count: number;
        }>(
          `SELECT
               (SELECT count(*)::int FROM task_execution.agent_result WHERE run_id=$1) AS result_count,
               (SELECT count(*)::int FROM task_execution.run_final_submission_claim WHERE run_id=$1) AS claim_count,
               (SELECT count(*)::int FROM task_execution.result_validation_bundle WHERE run_id=$1) AS bundle_count,
               (SELECT count(*)::int FROM task_execution.result_validation_fact WHERE bundle_id=$2) AS fact_count,
               (SELECT count(*)::int FROM task_execution.agent_result_acceptance WHERE run_id=$1) AS acceptance_count`,
          [runRef.objectId, validationTarget.objectId],
        )
      ).rows,
    ).toEqual([
      {
        result_count: 1,
        claim_count: 1,
        bundle_count: 1,
        fact_count: 5,
        acceptance_count: 1,
      },
    ]);
    const replayFinalize = await firstRunEnvelope(
      'execution.finalize_run_from_acceptance',
      runRef,
      { acceptanceRecordRef } as unknown as CanonicalJsonObject,
      service,
      3,
    );
    expect(
      await firstRunEntry.finalizeRun(replayFinalize, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: firstRunPayload(finalized as CommandResult),
    });
    const replaySubmit = await firstRunEnvelope(
      'execution.submit_agent_result',
      resultTarget,
      {
        agentResultContract: resultBody,
        runFencingToken: 1,
        runtimeSubmissionRef: finalView.runtimeSubmissionRef,
      } as unknown as CanonicalJsonObject,
      service,
    );
    expect(
      await firstRunEntry.submitAgentResult(replaySubmit, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: firstRunPayload(submitted as CommandResult),
    });
    const replayRecord = await firstRunEnvelope(
      'execution.record_run_result',
      runRef,
      { agentResultRef: resultRef } as unknown as CanonicalJsonObject,
      service,
      2,
    );
    expect(
      await firstRunEntry.recordRunResult(replayRecord, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: suite.committedPayload(recorded as CommandResult),
    });
    const replayValidate = await firstRunEnvelope(
      'execution.validate_agent_result',
      validationTarget,
      record(validateEnvelope.payload) as CanonicalJsonObject,
      service,
    );
    expect(
      await firstRunEntry.validateAgentResult(replayValidate, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: suite.committedPayload(validatedFinal as CommandResult),
    });
    const replayAccept = await firstRunEnvelope(
      'execution.accept_agent_result',
      acceptanceTarget,
      record(acceptEnvelope.payload) as CanonicalJsonObject,
      service,
    );
    expect(
      await firstRunEntry.acceptAgentResult(replayAccept, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'COMMITTED',
      resultPayload: firstRunPayload(accepted as CommandResult),
    });
    const prematureExpire = await firstRunEnvelope(
      'execution.expire_run',
      runRef,
      { reason: 'DEADLINE_EXCEEDED' },
      service,
      4,
    );
    await expect(
      firstRunEntry.expireRun(prematureExpire, suite.sessionFor(service)),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JUDGMENT_STALE',
    });
    expect(
      await firstRunEntry.submitAgentResult(submitEnvelope, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    expect(
      await firstRunEntry.acceptAgentResult(acceptEnvelope, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    expect(
      await firstRunEntry.finalizeRun(finalizeEnvelope, suite.sessionFor(service)),
    ).toMatchObject({
      status: 'DUPLICATE',
    });
    const runQuery = await firstRunQuery(
      'execution.get_run_state',
      runRef,
      { runRef } as unknown as CanonicalJsonObject,
      'runStateReadV1',
    );
    expect(await firstRunEntry.getRunState(runQuery, suite.sessionFor(service))).toMatchObject({
      status: 'SUCCEEDED',
      resultRef,
      terminationReason: 'EXECUTION_RESULT_ACCEPTED',
    });
    expect(
      (
        await suite.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.work_order_run_claim WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'RELEASED' }]);
    await expect(
      withTaskExecutionTransaction(suite.teDb, suite.runnerContext(service), (trx) =>
        sql`UPDATE task_execution.agent_result SET result_payload=result_payload WHERE result_id=${resultTarget.objectId}::uuid`.execute(
          trx,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const hiddenFinal = await withTaskExecutionTransaction(
      suite.teDb,
      { ...suite.runnerContext(service), allowedProjectIds: [newUuidV7()] },
      (trx) =>
        sql`SELECT result_id FROM task_execution.agent_result WHERE result_id=${resultTarget.objectId}::uuid`.execute(
          trx,
        ),
    );
    expect(hiddenFinal.rows).toEqual([]);
    await suite.admin.query('BEGIN');
    try {
      await suite.admin.query('SET LOCAL ROLE task_execution_app');
      expect(
        (
          await suite.admin.query(
            'SELECT result_id FROM task_execution.agent_result WHERE result_id=$1',
            [resultTarget.objectId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await suite.admin.query('ROLLBACK');
    }
    for (const [table, idColumn, id] of [
      ['run_final_submission_claim', 'run_id', runRef.objectId],
      ['result_validation_bundle', 'bundle_id', validationTarget.objectId],
      [
        'result_validation_fact',
        'validation_id',
        String(record(finalValidations.schemaValidationRef).objectId),
      ],
      ['agent_result_acceptance', 'acceptance_id', acceptanceTarget.objectId],
    ] as const) {
      const tableName = `task_execution.${table}`;
      await suite.admin.query('BEGIN');
      try {
        await suite.admin.query('SET LOCAL ROLE task_execution_app');
        expect(
          (
            await suite.admin.query(`SELECT ${idColumn} FROM ${tableName} WHERE ${idColumn}=$1`, [
              id,
            ])
          ).rows,
        ).toEqual([]);
      } finally {
        await suite.admin.query('ROLLBACK');
      }
      const hidden = await withTaskExecutionTransaction(
        suite.teDb,
        { ...suite.runnerContext(service), allowedProjectIds: [newUuidV7()] },
        (trx) =>
          sql`SELECT ${sql.ref(idColumn)} FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
      );
      expect(hidden.rows).toEqual([]);
      await expect(
        withTaskExecutionTransaction(suite.teDb, suite.runnerContext(service), (trx) =>
          sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(idColumn)}=${sql.ref(idColumn)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTaskExecutionTransaction(suite.teDb, suite.runnerContext(service), (trx) =>
          sql`DELETE FROM ${sql.table(tableName)} WHERE ${sql.ref(idColumn)}=${id}::uuid`.execute(
            trx,
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        suite.admin.query(`UPDATE ${tableName} SET ${idColumn}=${idColumn} WHERE ${idColumn}=$1`, [
          id,
        ]),
      ).rejects.toMatchObject({ code: '55000' });
    }
    expect(runtimeDriver.invokedAttemptIds).toHaveLength(1);
    expect(
      (
        await suite.admin.query<{ event_type: string; count: string }>(
          "SELECT event_type,count(*)::text FROM task_execution.outbox_event WHERE aggregate_id IN ($1,$2) AND event_type IN ('execution.AgentResultAccepted','execution.RunTerminated') GROUP BY event_type ORDER BY event_type",
          [runRef.objectId, resultTarget.objectId],
        )
      ).rows,
    ).toEqual([
      { event_type: 'execution.AgentResultAccepted', count: '1' },
      { event_type: 'execution.RunTerminated', count: '1' },
    ]);
    const lateExpire = await firstRunEnvelope(
      'execution.expire_run',
      runRef,
      { reason: 'DEADLINE_EXCEEDED' },
      service,
      4,
    );
    await expect(
      firstRunEntry.expireRun(lateExpire, suite.sessionFor(service)),
    ).rejects.toBeDefined();
    expect(await suite.receiptRows(lateExpire.idempotencyKey)).toEqual([]);
    const lateConflictingFinalize = await firstRunEnvelope(
      'execution.finalize_run_from_acceptance',
      runRef,
      {
        acceptanceRecordRef: {
          ...record(acceptanceRecordRef),
          objectId: newUuidV7(),
        },
      },
      service,
      3,
    );
    await expect(
      firstRunEntry.finalizeRun(lateConflictingFinalize, suite.sessionFor(service)),
    ).rejects.toBeDefined();
    expect(await suite.receiptRows(lateConflictingFinalize.idempotencyKey)).toEqual([]);
    expect(
      (
        await suite.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.run WHERE run_id=$1',
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ status: 'SUCCEEDED' }]);
    expect(
      (
        await suite.admin.query<{ status: string }>(
          'SELECT status FROM task_execution.work_order WHERE work_order_id=$1',
          [woId],
        )
      ).rows,
    ).toEqual([{ status: 'RUNNING' }]);
    expect(revised.expectedOutputs).toHaveLength(1);
    expect(record(finalView.agentResultContract).businessOutputs).toEqual([]);
    const taskAfterFinal = await suite.admin.query<{ status: string }>(
      'SELECT status FROM task_execution.task WHERE task_id=$1',
      [taskId],
    );
    expect(taskAfterFinal.rows).toHaveLength(1);
    expect(taskAfterFinal.rows[0]?.status).not.toBe('COMPLETED');
    expect(
      (
        await suite.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM integration_gateway.reference_edge WHERE owner_object_id=$1',
          [record(finalView.observationRef).objectId],
        )
      ).rows,
    ).toEqual([{ count: '3' }]);
    expect(
      (
        await suite.admin.query<{ count: string }>(
          'SELECT count(*)::text FROM task_execution.reference_edge WHERE source_command_id = ANY($1::uuid[])',
          [
            [
              submitEnvelope.commandId,
              recordEnvelope.commandId,
              validateEnvelope.commandId,
              acceptEnvelope.commandId,
              finalizeEnvelope.commandId,
            ],
          ],
        )
      ).rows,
    ).toEqual([{ count: '10' }]);
    expect(
      (
        await suite.admin.query<{ count: string }>(
          "SELECT count(*)::text FROM task_execution.outbox_event WHERE aggregate_id=$1 AND event_type='execution.RunStarted'",
          [runRef.objectId],
        )
      ).rows,
    ).toEqual([{ count: '1' }]);
    const terminalRunQuery = await firstRunQuery(
      'execution.get_run_state',
      runRef,
      { runRef } as unknown as CanonicalJsonObject,
      'runStateReadV1',
    );
    if (terminalScenario === 'SUCCEEDED') {
      const currentClock = suite.clock;
      try {
        for (const [envelope, replay] of [
          [startEnvelope, () => firstRunEntry.startRun(startEnvelope, startSession)],
          [
            submitEnvelope,
            () => firstRunEntry.submitAgentResult(submitEnvelope, suite.sessionFor(service)),
          ],
          [
            recordEnvelope,
            () => firstRunEntry.recordRunResult(recordEnvelope, suite.sessionFor(service)),
          ],
          [
            validateEnvelope,
            () => firstRunEntry.validateAgentResult(validateEnvelope, suite.sessionFor(service)),
          ],
          [
            acceptEnvelope,
            () => firstRunEntry.acceptAgentResult(acceptEnvelope, suite.sessionFor(service)),
          ],
          [
            finalizeEnvelope,
            () => firstRunEntry.finalizeRun(finalizeEnvelope, suite.sessionFor(service)),
          ],
          [resultQuery, () => firstRunEntry.getAgentResult(resultQuery, suite.sessionFor(service))],
          [
            terminalRunQuery,
            () => firstRunEntry.getRunState(terminalRunQuery, suite.sessionFor(service)),
          ],
          [
            finalQuery,
            () => firstRunEntry.getRuntimeFinalObservation(finalQuery, suite.sessionFor(service)),
          ],
        ] as const) {
          const expiry = (
            await suite.admin.query<{ expires_at: Date }>(
              'SELECT expires_at FROM identity_policy.authorization_decision WHERE authorization_decision_id=$1',
              [envelope.authorizationDecisionRef.objectId],
            )
          ).rows[0]?.expires_at;
          if (expiry === undefined) throw new Error('missing original Decision expiry');
          // Exercise the owning consumer with its trusted clock. The immutable
          // Decision is not rewritten; wall-clock Bundle expiry has its own case.
          suite.clock = expiry.getTime() + 1;
          queryReads.length = 0;
          await expect(replay()).rejects.toMatchObject({ code: 'AUTHORIZATION_REVOKED' });
          expect(protectedReads(), 'expired original Decision').toEqual([]);
        }
      } finally {
        suite.clock = Math.max(currentClock, Date.now());
      }
    }
    if (await verifyHistoricalReadPermissions(stageDependencies)) return;
    if (usageProbe !== undefined && terminalScenario === 'SUCCEEDED') {
      // A later conflicting resubmission is rejected by the owning handler and
      // cannot erase the accepted immutable Result/Acceptance.
      const conflicting = await firstRunEnvelope(
        'execution.submit_agent_result',
        resultTarget,
        {
          agentResultContract: { ...resultBody, humanSummary: 'Conflicting late body.' },
          runFencingToken: 1,
          runtimeSubmissionRef: finalView.runtimeSubmissionRef,
        },
        service,
      );
      await expect(
        firstRunEntry.submitAgentResult(conflicting, suite.sessionFor(service)),
      ).rejects.toBeDefined();
    }
    await usageProbe?.('FINALIZED', runRef);
    observeValidations?.({ ...finalValidations, acceptanceRecordRef } as CanonicalJsonObject);
  };
  return runScenario;
}
export type RunScenario = ReturnType<typeof createRunScenario>;
