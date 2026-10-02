import type { Common } from '@zhiju/contracts';
import type { EnterpriseProjectDb } from '@zhiju/enterprise-project';
import type {
  IdentityCryptoPorts,
  IdentityPolicyDb,
  IdentityPolicyRepository,
} from '@zhiju/identity-policy';
import type { QualityTransactionContext } from '@zhiju/quality-governance';
import type { UuidV7 } from '@zhiju/shared-kernel';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type {
  TaskExecutionPrincipalKind,
  TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import type { CommandResult, TaskExecutionDb } from '@zhiju/task-execution';
import type { Kysely } from 'kysely';
import type { Principal } from './initial-context-fixtures.js';
export type ScenarioTerminalScenario =
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
  | 'NON_FINAL_CORE_REJECT';
export type ScenarioRecoveryEnvelope = (
  key: string,
  target: Common.ObjectRef,
  payload: CanonicalJsonObject,
  principal: Principal,
  expectedVersion?: number,
  query?: boolean,
) => Promise<Record<string, unknown>>;
export type ScenarioFormalEnvelope = (
  key: string,
  targetRef: Common.ObjectRef | Common.ContentAddressedRef,
  payload: CanonicalJsonObject,
  principal?: Principal,
  expectedAggregateVersion?: number,
  query?: boolean,
) => Promise<
  | {
      queryId: UuidV7;
      queryType: string;
      queryVersion: string;
      scopeRef: Record<string, string>;
      requester: Common.SnapshotRef;
      authorizationDecisionRef: Common.ContentAddressedRef;
      authenticationContextRef: {
        kind: string;
        objectType: string;
        objectId: string;
        scope: Record<string, string>;
        contentHash: Common.ContentHash;
      };
      consistencyRequirement: string;
      correlationId: UuidV7;
      requestedAt: string;
      payload: CanonicalJsonObject;
    }
  | {
      payload: CanonicalJsonObject;
      integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
      expectedAggregateVersion?: number;
      commandId: UuidV7;
      commandType: string;
      commandVersion: string;
      scopeRef: Record<string, string>;
      targetRef: Common.ObjectRef | Common.ContentAddressedRef;
      actor: Common.SnapshotRef;
      authorizationDecisionRef: Common.ContentAddressedRef;
      idempotencyKey: UuidV7;
      correlationId: UuidV7;
      requestedAt: string;
      queryId?: never;
      queryType?: never;
      queryVersion?: never;
      requester?: never;
      authenticationContextRef?: never;
      consistencyRequirement?: never;
    }
>;
export interface ScenarioQuality {
  createProfile: () => Promise<{
    profileRef: Common.VersionedRef;
    gateId: UuidV7;
    approvalRequirementId: string;
  }>;
  accept: (
    profile: Awaited<
      ReturnType<
        () => Promise<{
          profileRef: Common.VersionedRef;
          gateId: UuidV7;
          approvalRequirementId: string;
        }>
      >
    >,
    artifactRef: Common.ObjectRef,
    revisionRef: Common.ContentAddressedRef,
    attempt?: number,
  ) => Promise<{ gateRef: Common.ContentAddressedRef; acceptanceRef: Common.SnapshotRef }>;
  approve: (
    profile: Awaited<
      ReturnType<
        () => Promise<{
          profileRef: Common.VersionedRef;
          gateId: UuidV7;
          approvalRequirementId: string;
        }>
      >
    >,
    artifactRef: Common.ObjectRef,
    revisionRef: Common.ContentAddressedRef,
    acceptanceRef: Common.SnapshotRef,
    approver: QualityTransactionContext,
  ) => Promise<{ approvalRef: Common.ContentAddressedRef; bundleRef: Common.SnapshotRef }>;
  supersedeProfile(profileRef: Common.VersionedRef): Promise<Common.VersionedRef>;
  invalidate(gateRef: Common.ContentAddressedRef): Promise<CommandResult>;
  revoke(approvalRef: Common.ContentAddressedRef): Promise<CommandResult>;
}
export type ScenarioRecoveryVariant =
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
  | 'SECOND_FAILED';
export interface ScenarioRecoveryConfig {
  taskExecutionDb: Kysely<TaskExecutionDb>;
  enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  identity: {
    db: Kysely<IdentityPolicyDb>;
    repo: IdentityPolicyRepository;
    crypto: IdentityCryptoPorts;
  };
  recoveryCapabilityCodes: Record<string, string>;
  humanCapabilityCodes: { answerSubmit: string; requestResolve: string; materialRead: string };
  capabilities: {
    readonly resolvePolicy: 'wi216.cap.resolve';
    readonly readContextSourceSlice: 'wi216.cap.sliceread';
  };
  now: () => Date;
}
export type ScenarioFirstRunEnvelope = (
  commandType: string,
  targetRef: Common.ObjectRef,
  payload: CanonicalJsonObject,
  principal: Principal,
  expectedAggregateVersion?: number,
) => Promise<{
  payload: CanonicalJsonObject;
  integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
  expectedAggregateVersion?: number;
  commandId: UuidV7;
  commandType: string;
  commandVersion: string;
  scopeRef: Record<string, string>;
  targetRef: Common.ObjectRef;
  actor: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
  idempotencyKey: UuidV7;
  correlationId: UuidV7;
  requestedAt: string;
}>;
export interface ScenarioRuntimeBinding {
  adapterCode: string;
  adapterVersion: string;
  harnessId: string;
  harnessVersion: string;
  provider: string;
  modelId: string;
  modelConfigHash: Common.ContentHash;
}
export type ScenarioFirstRunQuery = (
  queryType: string,
  targetRef: Common.ObjectRef | Common.ContentAddressedRef,
  payload: CanonicalJsonObject,
  key:
    'runtimeAttemptBindingReadV1' | 'runtimeFinalReadV1' | 'agentResultReadV1' | 'runStateReadV1',
) => Promise<{
  queryId: UuidV7;
  queryType: string;
  queryVersion: string;
  scopeRef: Record<string, string>;
  requester: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Record<string, string>;
  };
  authenticationContextRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Record<string, string>;
    contentHash: Common.ContentHash;
  };
  authorizationDecisionRef: Common.ContentAddressedRef;
  consistencyRequirement: string;
  correlationId: UuidV7;
  requestedAt: string;
  payload: CanonicalJsonObject;
}>;
export interface ScenarioRead {
  workOrderRef: CanonicalJsonObject;
  workOrderContract: CanonicalJsonObject;
  contractRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: { enterpriseId: string; projectId: string };
    contentHash: CanonicalJsonObject;
  };
}
export interface ScenarioFinalView {
  observationRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Common.ScopeRef;
    contentHash: Common.ContentHash;
  };
  attemptRef: Common.ObjectRef;
  runRef: CanonicalJsonObject;
  runtimeSubmissionRef: CanonicalJsonObject;
  resultPayloadHash: Common.ContentHash;
  bindingHash: Common.ContentHash;
  runFencingToken: number;
  ackObservationId: string;
  runtimeAdapterIdentityRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Common.ScopeRef;
  };
  agentResultContract: CanonicalJsonObject;
  observedAt: string;
  source: 'SYNTHETIC_DRIVER';
}
export interface ScenarioFinalQuery {
  queryId: UuidV7;
  queryType: string;
  queryVersion: string;
  scopeRef: Record<string, string>;
  requester: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Record<string, string>;
  };
  authenticationContextRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: Record<string, string>;
    contentHash: Common.ContentHash;
  };
  authorizationDecisionRef: Common.ContentAddressedRef;
  consistencyRequirement: string;
  correlationId: UuidV7;
  requestedAt: string;
  payload: CanonicalJsonObject;
}
export type ScenarioFirstRunCodes = Readonly<
  Record<
    | 'workOrderQueueV1'
    | 'executionBundleIssueV1'
    | 'runCreateV1'
    | 'runDispatchBindingReadV1'
    | 'runtimeDispatchV1'
    | 'runtimeReceiptRecordV1'
    | 'runtimeAttemptBindingReadV1'
    | 'runStartV1'
    | 'workOrderReconcileV1'
    | 'bundleIssueContractReadV1'
    | 'bundleIssueContextReadV1'
    | 'queueContractReadV1'
    | 'queueContextReadV1'
    | 'runCreateContractReadV1'
    | 'runCreateContextReadV1'
    | 'runCreateBundleReadV1'
    | 'runtimeDispatchBundleReadV1'
    | 'runStartBundleReadV1'
    | 'runStartAttemptReadV1'
    | 'runStartAdapterIdentityReadV1'
    | 'workOrderReconcileRunReadV1'
    | 'runtimeFinalObserveV1'
    | 'runtimeFinalReadV1'
    | 'runFinalCandidateScanV1'
    | 'runFinalProcessProgressV1'
    | 'agentResultSubmitV1'
    | 'runResultRecordV1'
    | 'agentResultValidateV1'
    | 'agentResultAcceptV1'
    | 'runFinalizeV1'
    | 'runExpireV1'
    | 'agentResultReadV1'
    | 'runStateReadV1'
    | 'resultSubmitBindingReadV1'
    | 'resultSubmitFinalReadV1'
    | 'resultSubmitBundleReadV1'
    | 'resultSubmitPolicyReadV1'
    | 'resultRecordBindingReadV1'
    | 'resultRecordFinalReadV1'
    | 'resultRecordBundleReadV1'
    | 'resultRecordPolicyReadV1'
    | 'resultValidateBindingReadV1'
    | 'resultValidateFinalReadV1'
    | 'resultValidateBundleReadV1'
    | 'resultValidatePolicyReadV1'
    | 'resultAcceptBindingReadV1'
    | 'resultAcceptFinalReadV1'
    | 'resultAcceptBundleReadV1'
    | 'resultAcceptPolicyReadV1'
    | 'runFinalizeBindingReadV1'
    | 'runFinalizeFinalReadV1'
    | 'runFinalizeBundleReadV1'
    | 'runFinalizePolicyReadV1'
    | 'resultRecordSourceReadV1'
    | 'resultValidateSourceReadV1'
    | 'resultAcceptSourceReadV1'
    | 'runFinalizeSourceReadV1'
    | 'runExpireBundleInspectV1',
    string
  >
>;
export interface ScenarioStartEnvelope {
  payload: CanonicalJsonObject;
  integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
  expectedAggregateVersion?: number;
  commandId: UuidV7;
  commandType: string;
  commandVersion: string;
  scopeRef: Record<string, string>;
  targetRef: Common.ObjectRef;
  actor: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
  idempotencyKey: UuidV7;
  correlationId: UuidV7;
  requestedAt: string;
}
export interface ScenarioScanContext {
  authorizationDecisionId: string;
  authorizationDecisionHash: Buffer<ArrayBuffer>;
  authorizationDecisionExpiresAt: Date;
  kind: 'REQUEST' | 'EVENT_CONSUMER';
  principalId: string;
  principalKind: TaskExecutionPrincipalKind;
  actorSnapshotId: string;
  policySnapshotId: string;
  enterpriseId: string;
  allowedProjectIds: readonly string[];
  correlationId: string;
  sourceEventId?: string;
}
export interface ScenarioProgressListAuthorization {
  decisionRef: Common.ContentAddressedRef;
  context: {
    authorizationDecisionId: string;
    authorizationDecisionHash: Buffer<ArrayBuffer>;
    authorizationDecisionExpiresAt: Date;
    kind: 'REQUEST' | 'EVENT_CONSUMER';
    principalId: string;
    principalKind: TaskExecutionPrincipalKind;
    actorSnapshotId: string;
    policySnapshotId: string;
    enterpriseId: string;
    allowedProjectIds: readonly string[];
    correlationId: string;
    sourceEventId?: string;
  };
  proof: () => Promise<void>;
}
export type ScenarioProgressAuthorization = (payload: CanonicalJsonObject) => Promise<{
  decisionRef: Common.ContentAddressedRef;
  context: {
    authorizationDecisionId: string;
    authorizationDecisionHash: Buffer<ArrayBuffer>;
    authorizationDecisionExpiresAt: Date;
    kind: 'REQUEST' | 'EVENT_CONSUMER';
    principalId: string;
    principalKind: TaskExecutionPrincipalKind;
    actorSnapshotId: string;
    policySnapshotId: string;
    enterpriseId: string;
    allowedProjectIds: readonly string[];
    correlationId: string;
    sourceEventId?: string;
  };
  proof: () => Promise<void>;
}>;
export type ScenarioProgressEnvelope = (
  context: TaskExecutionTransactionContext,
  processId: string,
  payload: CanonicalJsonObject,
  idempotencyKey: string,
  expectedAggregateVersion?: string,
) => {
  correlationId: string;
  principalId: string;
  principalKind: TaskExecutionPrincipalKind;
  actorSnapshotId: string;
  authorizationDecisionId: string;
  policySnapshotId: string;
  expectedAggregateVersion?: string;
  commandId: UuidV7;
  commandType: string;
  commandVersion: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestPayload: CanonicalJsonObject;
  enterpriseId: string;
  projectId: string;
  targetType: string;
  targetId: string;
};
