// AUTO-GENERATED-MARKER: this file's expected compile failures live behind
// `@ts-expect-error` annotations; the file is compiled as part of `tsc -b`
// via the workspace's tsconfig and never executed. Run `pnpm typecheck` to
// verify that:
//   - positive fixtures compile without errors;
//   - every `@ts-expect-error` annotation actually fires.
//
// All imports come from the public `@zhiju/contracts` package entry so the
// fixture also proves that the root package export wires the generated
// namespaces correctly.

import type {
  CanonicalJson,
  Artifact,
  Common,
  Core,
  EnterpriseProject,
  IdentityPolicy,
  IntegrationGateway,
  ReleasePublication,
  TaskExecution,
} from '@zhiju/contracts';

// =============================================================================
// Constants shared by every fixture
// =============================================================================

const uuid = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const digest = '0'.repeat(64);
const enterpriseScope: Common.ScopeRef = { enterpriseId: uuid };
const projectScope: Common.ScopeRef = { enterpriseId: uuid, projectId: uuid };
const objectReference: Common.ObjectRef = {
  kind: 'OBJECT',
  objectType: 'identity.principal',
  objectId: uuid,
  scope: enterpriseScope,
};
const versionedReference: Common.VersionedRef = {
  kind: 'VERSIONED',
  objectType: 'project.customer_baseline',
  objectId: uuid,
  versionId: uuid,
  scope: projectScope,
};
const snapshotReference: Common.SnapshotRef = {
  kind: 'SNAPSHOT',
  objectType: 'core.contract_schema',
  objectId: uuid,
  snapshotId: uuid,
  scope: enterpriseScope,
  contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
};
const contentAddressedReference: Common.ContentAddressedRef = {
  kind: 'CONTENT_ADDRESSED',
  objectType: 'artifact.artifact_revision',
  objectId: uuid,
  immutableVersionId: uuid,
  scope: projectScope,
  contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
};
const payloadHash: Common.ContentHash = {
  algorithm: 'SHA-256',
  digest,
  canonicalizationVersion: '1',
};

// `expectType<T>(value)` is the only line that ever consumes a value; the
// runtime is erased because this file is `.test-d.ts`. Using `Equals<T, U>`
// (`T extends U ? 1 : 2`) lets us express bidirectional assignability while
// keeping the type parameter used twice, which satisfies
// `@typescript-eslint/no-unnecessary-type-parameters`.
//
// We disable the `array-type` and `no-unnecessary-type-parameters` rules here
// because the helpers deliberately mirror fixture ergonomics from type-test
// toolkits such as `expect-type`/`tsd` rather than the production-style
// helper signatures used elsewhere in the codebase.
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
type Equals<T, U> =
  (<V>() => V extends T ? 1 : 2) extends <V>() => V extends U ? 1 : 2 ? true : false;
declare const expectType: <T>(value: T, expected?: Equals<T, T>) => void;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

// =============================================================================
// IdentityPolicy COMMAND — `identity.register_principal` (COMMAND, FULL)
// =============================================================================

const registerPrincipal: IdentityPolicy.IdentityRegisterPrincipalPayload = {
  principalKind: 'HUMAN',
  displayName: 'Fixture Human',
  initialStatus: 'ACTIVE',
};
expectType<IdentityPolicy.IdentityRegisterPrincipalPayload>(registerPrincipal);

// Negative case — `initialStatus` must be the literal `"ACTIVE"`.
{
  const badInitialStatus: IdentityPolicy.IdentityRegisterPrincipalPayload = {
    principalKind: 'HUMAN',
    displayName: 'Fixture Human',
    // @ts-expect-error — closed enum, `SUSPENDED` is not a valid initialStatus.
    initialStatus: 'SUSPENDED',
  };
  void badInitialStatus;
}

// =============================================================================
// IM-04 WI-01 — Canonical Content and RenderAttempt Binding generated types
// =============================================================================

const canonicalDocument: Artifact.CanonicalDocument = {
  documentId: uuid,
  title: 'Generated canonical document',
  units: [
    {
      unitId: 'root',
      unitType: 'SECTION',
      ordinal: 0,
      childUnitIds: [],
    },
  ],
};
expectType<Artifact.CanonicalDocument>(canonicalDocument);

const canonicalContent: Artifact.CanonicalContentPayload = {
  schemaRef: versionedReference,
  contentType: 'STRUCTURED_DOCUMENT',
  canonicalizationVersion: '1',
  body: canonicalDocument,
};
expectType<Artifact.CanonicalContentPayload>(canonicalContent);

const workbookSpec: Artifact.CanonicalWorkbookSpec = {
  workbookId: uuid,
  sheets: [
    {
      sheetId: 'sheet-1',
      name: 'Sheet 1',
      ordinal: 0,
      columns: [{ columnId: 'amount', name: 'Amount', ordinal: 0, valueType: 'number' }],
      rows: [
        {
          rowId: 'row-1',
          ordinal: 0,
          cells: [
            {
              cellId: 'cell-1',
              columnId: 'amount',
              value: 1,
              valueType: 'number',
              formula: '=SUM(amount)',
            },
          ],
        },
      ],
    },
  ],
};
expectType<Artifact.CanonicalWorkbookSpec>(workbookSpec);

// Negative case — CanonicalContentPayload keeps contentType closed.
{
  const badContentType: Artifact.CanonicalContentPayload = {
    schemaRef: versionedReference,
    // @ts-expect-error — open STRUCTURED_REPORT content is not a WI-01 payload type.
    contentType: 'STRUCTURED_REPORT',
    canonicalizationVersion: '1',
    body: canonicalDocument,
  };
  void badContentType;
}

// Negative case — generated closed object types reject required extensions.
{
  const badDocument: Artifact.CanonicalDocument = {
    ...canonicalDocument,
    // @ts-expect-error — unknown required extensions are not part of the schema.
    requiredExtension: { extensionType: 'artifact.future_required' },
  };
  void badDocument;
}

const renderRequest: IntegrationGateway.RenderRequest = {
  revisionRef: contentAddressedReference,
  canonicalContentRef: 'artifact/canonical/document-001',
  inputHash: payloadHash,
  outputFormat: 'document.pdf',
  rendererId: 'renderer.pdf',
  rendererVersion: '1.0.0',
  renderPolicyRef: versionedReference,
  stableIdempotencyKey: 'generated-binding-fixture',
  requestedAt: '2026-08-28T00:00:00Z',
};
const renderSucceeded: IntegrationGateway.RenderSucceededPayload = {
  attemptRef: objectReference,
  revisionRef: contentAddressedReference,
  outputObjectRef: 'artifact/rendered/document-001',
  outputChecksum: payloadHash,
  rendererId: 'renderer.pdf',
  rendererVersion: '1.0.0',
  rawReceiptRef: contentAddressedReference,
};
const renderBinding: IntegrationGateway.RenderAttemptBindingView = {
  attemptRef: objectReference,
  status: 'SUCCEEDED',
  request: renderRequest,
  requestPayloadHash: payloadHash,
  succeededResult: renderSucceeded,
  rawReceiptRef: contentAddressedReference,
};
expectType<IntegrationGateway.RenderAttemptBindingView>(renderBinding);

// Negative case — Binding Query results do not expose credentials.
{
  const leakedBinding: IntegrationGateway.RenderAttemptBindingView = {
    ...renderBinding,
    // @ts-expect-error — provider credentials are outside the public result contract.
    credentials: 'must-not-leak',
  };
  void leakedBinding;
}

// Negative case — `principalKind` does not allow arbitrary strings.
{
  const badPrincipalKind: IdentityPolicy.IdentityRegisterPrincipalPayload = {
    // @ts-expect-error — closed enum, `MUTANT` is not a valid principalKind.
    principalKind: 'MUTANT',
    displayName: 'Fixture Human',
    initialStatus: 'ACTIVE',
  };
  void badPrincipalKind;
}

// Negative case — additional properties (e.g. `unknownField`) are rejected.
{
  const extraField: IdentityPolicy.IdentityRegisterPrincipalPayload = {
    principalKind: 'HUMAN',
    displayName: 'Fixture Human',
    initialStatus: 'ACTIVE',
    // @ts-expect-error — additional property `unknownField` is rejected.
    unknownField: 'nope',
  };
  void extraField;
}

// =============================================================================
// IdentityPolicy QUERY — `identity.resolve_principal` (QUERY, FULL)
// =============================================================================

const resolvedPrincipal: IdentityPolicy.IdentityResolvePrincipalPayload = {
  lookup: {
    kind: 'PRINCIPAL_REF',
    principalRef: objectReference,
  },
  purpose: 'identity.authorization.read',
};
expectType<IdentityPolicy.IdentityResolvePrincipalPayload>(resolvedPrincipal);

const resolvedView: IdentityPolicy.IdentityResolvePrincipalResult = {
  principalRef: objectReference,
  principalKind: 'HUMAN',
  status: 'ACTIVE',
  displayName: {
    presence: 'PRESENT',
    value: 'Fixture Human',
    evidenceRefs: [],
  },
};
expectType<IdentityPolicy.IdentityResolvePrincipalResult>(resolvedView);

// Negative case — closed enum, `EXTERNAL` is not a valid principalKind.
{
  const badPrincipalKindResult: IdentityPolicy.IdentityResolvePrincipalResult = {
    principalRef: objectReference,
    // @ts-expect-error — closed enum, `EXTERNAL` is not a valid principalKind.
    principalKind: 'EXTERNAL',
    status: 'ACTIVE',
    displayName: { presence: 'UNKNOWN', evidenceRefs: [] },
  };
  void badPrincipalKindResult;
}

// Negative case — ValueEnvelopeString.PRESENT branch requires `value`.
{
  const presentBranch: IdentityPolicy.ValueEnvelopeString = {
    presence: 'PRESENT',
    value: 'required',
    evidenceRefs: [],
  };
  void presentBranch;
  // @ts-expect-error — `value` is required when presence=PRESENT.
  const missingValue: IdentityPolicy.ValueEnvelopeString = {
    presence: 'PRESENT',
    evidenceRefs: [],
  };
  void missingValue;
}

// =============================================================================
// IdentityPolicy EVENT — `identity.PrincipalRegistered` (EVENT, FULL)
// =============================================================================

const principalRegisteredEvent: IdentityPolicy.IdentityPrincipalRegisteredPayload = {
  principalRef: objectReference,
  principalKind: 'HUMAN',
  status: 'ACTIVE',
};
expectType<IdentityPolicy.IdentityPrincipalRegisteredPayload>(principalRegisteredEvent);

// Negative case — closed enum, `BLOCKED` is not a valid principalStatus.
{
  const badStatus: IdentityPolicy.IdentityPrincipalRegisteredPayload = {
    principalRef: objectReference,
    principalKind: 'HUMAN',
    // @ts-expect-error — closed enum, `BLOCKED` is not a valid principalStatus.
    status: 'BLOCKED',
  };
  void badStatus;
}

// =============================================================================
// EnterpriseProject QUERY — `project.get_active_baseline_refs` (QUERY, FULL)
// =============================================================================

const activeBaselineQuery: EnterpriseProject.ProjectGetActiveBaselineRefsPayload = {
  projectRef: objectReference,
};
expectType<EnterpriseProject.ProjectGetActiveBaselineRefsPayload>(activeBaselineQuery);

const templateRef: Common.VersionedRef = {
  ...versionedReference,
  objectType: 'project.template_baseline',
};
const regulatoryRef: Common.VersionedRef = {
  ...versionedReference,
  objectType: 'project.regulatory_profile',
};
const gapRef: Common.VersionedRef = { ...versionedReference, objectType: 'project.gap_analysis' };
const deliveryPlanRef: Common.VersionedRef = {
  ...versionedReference,
  objectType: 'project.delivery_plan',
};
const activeBaselineResult: EnterpriseProject.ProjectGetActiveBaselineRefsResult = {
  customerBaselineRef: versionedReference,
  templateBaselineRef: templateRef,
  regulatoryProfileRef: regulatoryRef,
  gapAnalysisRef: gapRef,
  deliveryPlanRef,
  aggregateVersions: { foo: 1, bar: ['x', 'y'] },
};
expectType<EnterpriseProject.ProjectGetActiveBaselineRefsResult>(activeBaselineResult);

// Negative case — aggregateVersions is CanonicalJson, not a Date.
{
  const badAggregate: EnterpriseProject.ProjectGetActiveBaselineRefsResult = {
    customerBaselineRef: versionedReference,
    templateBaselineRef: templateRef,
    regulatoryProfileRef: regulatoryRef,
    gapAnalysisRef: gapRef,
    deliveryPlanRef,
    // @ts-expect-error — aggregateVersions is CanonicalJson; Date is not allowed.
    aggregateVersions: new Date('2026-08-17T00:00:00Z'),
  };
  void badAggregate;
}

// =============================================================================
// TaskExecution COMMAND — `execution.create_task` (COMMAND, FULL)
// =============================================================================

const createTaskPayload: TaskExecution.ExecutionCreateTaskPayload = {
  projectRef: objectReference,
  definition: {
    taskType: 'procurement.review',
    title: 'Review procurement procedure',
    objective: 'Evaluate the supplier evaluation procedure.',
    priority: 'NORMAL',
    riskLevel: 'MEDIUM',
    dependencyTaskRefs: [],
    inputRefs: [],
    expectedOutputSpec: { slot: 'revisedProcedure' },
    completionCriteria: [],
  },
};
expectType<TaskExecution.ExecutionCreateTaskPayload>(createTaskPayload);

const contextBuilderPolicyBinding: TaskExecution.ContextBuilderPolicyBinding = {
  builderPolicyRef: {
    ...versionedReference,
    objectType: 'zhiju.identity.policy',
    scope: projectScope,
  },
  contentHash: payloadHash,
  effectiveFrom: '2026-08-01T00:00:00Z',
  supersededAt: '2026-10-01T00:00:00Z',
};
expectType<TaskExecution.ContextBuilderPolicyBinding>(contextBuilderPolicyBinding);

// Negative case — the new WI-02 binding type narrows Builder Policy refs to
// the canonical registered namespace.
{
  const historicalPolicyBinding: TaskExecution.ContextBuilderPolicyBinding = {
    ...contextBuilderPolicyBinding,
    builderPolicyRef: {
      ...contextBuilderPolicyBinding.builderPolicyRef,
      // @ts-expect-error — new Builder Policy bindings use the canonical objectType.
      objectType: 'zhiju.context.policy',
    },
  };
  void historicalPolicyBinding;
}

const initialContextExpiryBinding: TaskExecution.InitialContextExpiryBinding = {
  requestExpiresAt: '2026-09-20T00:00:00Z',
  effectiveExpiresAt: '2026-09-20T00:00:00Z',
};
expectType<TaskExecution.InitialContextExpiryBinding>(initialContextExpiryBinding);

// Both members are optional on purpose: no request expiry plus no finite
// observed bound is a defined state, not a missing one.
{
  const openEndedExpiryBinding: TaskExecution.InitialContextExpiryBinding = {};
  expectType<TaskExecution.InitialContextExpiryBinding>(openEndedExpiryBinding);
}

// Negative case — the recorded expiry is an instant, not a duration or number.
{
  const invalidExpiryBinding: TaskExecution.InitialContextExpiryBinding = {
    ...initialContextExpiryBinding,
    // @ts-expect-error — effectiveExpiresAt is a UtcInstant.
    effectiveExpiresAt: 900,
  };
  void invalidExpiryBinding;
}

// Negative case — `outcome` is a closed enum, `MUTATED` is not in it.
{
  const externalRef: Common.ExternalRef = {
    system: 'feishu.im.message',
    resourceType: 'chat.message',
    externalId: 'msg-001',
    observedAt: '2026-08-17T00:00:00Z',
  };
  const badOutcome: TaskExecution.ExecutionRecordInformationDeliveryPayload = {
    deliveryAttemptRef: objectReference,
    destinationRef: externalRef,
    // @ts-expect-error — closed enum, `MUTATED` is not a valid delivery outcome.
    outcome: 'MUTATED',
    occurredAt: '2026-08-17T00:00:00Z',
  };
  void badOutcome;
}

// =============================================================================
// ReleasePublication COMMAND — `release.start_publication_attempt` (COMMAND, FULL)
// =============================================================================

const startPublicationAttempt: ReleasePublication.ReleaseStartPublicationAttemptPayload = {
  attempt: {
    destinationId: uuid,
    packageRef: {
      releaseRef: objectReference,
      packageSnapshotRef: snapshotReference,
      packageHash: payloadHash,
    },
    attemptNumber: 1,
    stableIdempotencyKey: 'attempt-001',
    requestedAt: '2026-08-17T00:00:00Z',
    externalDeliveryRequestRef: contentAddressedReference,
  },
};
expectType<ReleasePublication.ReleaseStartPublicationAttemptPayload>(startPublicationAttempt);

// Negative case — `attempt` payload is missing a required `stableIdempotencyKey`.
{
  const missingKey: ReleasePublication.ReleaseStartPublicationAttemptPayload = {
    attempt: {
      destinationId: uuid,
      packageRef: {
        releaseRef: objectReference,
        packageSnapshotRef: snapshotReference,
        packageHash: payloadHash,
      },
      attemptNumber: 1,
      // @ts-expect-error — `stableIdempotencyKey` is required.
      stableIdempotencyKey: undefined,
      requestedAt: '2026-08-17T00:00:00Z',
      externalDeliveryRequestRef: contentAddressedReference,
    },
  };
  void missingKey;
}

// =============================================================================
// Core Contract — ProjectContextContract (six Core Contracts)
// =============================================================================

const projectContextContract: Core.ProjectContextContract = {
  header: {
    contractId: uuid,
    contractType: 'zhiju.contract.project_context',
    contractVersion: '1.0',
    schemaRef: {
      ...versionedReference,
      objectType: 'core.contract_schema',
      scope: enterpriseScope,
    },
    scopeRef: enterpriseScope,
    issuedAt: '2026-08-17T00:00:00Z',
    issuedBy: { principalKind: 'HUMAN', principalId: uuid },
    correlationId: uuid,
    dataClassification: 'INTERNAL',
    canonicalizationVersion: '1',
    payloadHash,
  },
  contextSnapshotId: uuid,
  projectRef: objectReference,
  enterpriseRef: objectReference,
  projection: {
    projectionType: 'DOCUMENT_WRITER',
    purpose: 'document_drafting',
    audience: 'human_workspace',
    builderPolicyRef: {
      ...versionedReference,
      objectType: 'zhiju.identity.policy',
      scope: projectScope,
    },
  },
  asOf: '2026-08-17T00:00:00Z',
  sourceManifest: {
    enterpriseProfileSnapshotRef: snapshotReference,
    qmsConfigurationRef: {
      ...versionedReference,
      objectType: 'enterprise.qms_configuration',
      scope: enterpriseScope,
    },
    policyRefs: [],
    schemaRefs: [],
    externalAuthoritySnapshotRefs: [],
  },
  contextItems: [
    {
      contextItemId: uuid,
      kind: 'FACT',
      subjectRef: objectReference,
      epistemicState: 'CONFIRMED',
      value: { presence: 'PRESENT', value: 'known fact', evidenceRefs: [] },
      evidenceRefs: [],
      provenanceRefs: [],
      recordedTime: '2026-08-17T00:00:00Z',
      permittedUses: ['workorder.evidence'],
      sensitivity: 'INTERNAL',
    },
  ],
  artifactContext: [],
  workContext: {
    deliveryItemRefs: [],
    informationRequestRefs: [],
    blockers: [],
    relatedCompletionCriteriaRefs: [],
  },
  unresolvedItems: [],
  omissions: [],
  redactions: [],
  coverage: {
    requestedScopes: ['project.procurement'],
    includedScopes: ['project.procurement'],
    excludedScopes: [],
    completeness: 'COMPLETE_FOR_PURPOSE',
  },
  sourceWatermarks: [
    {
      sourceModule: 'enterprise-project',
      sequence: 0,
      observedAt: '2026-08-17T00:00:00Z',
    },
  ],
};
expectType<Core.ProjectContextContract>(projectContextContract);

// Negative case — closed enum, `EVIL` is not a valid dataClassification.
{
  const badClassification: Core.ProjectContextContract = {
    ...projectContextContract,
    header: {
      ...projectContextContract.header,
      // @ts-expect-error — closed enum, `EVIL` is not a valid dataClassification.
      dataClassification: 'EVIL',
    },
  };
  void badClassification;
}

// =============================================================================
// Whole Core Contract references — modules embed `Core.WorkOrderContract`,
// `Core.RevisionAcceptanceSnapshot` etc. as typed fields. The generator must
// preserve the full body rather than collapsing to `Common.ContractHeader`.
// =============================================================================

const workOrderContract: Core.WorkOrderContract = {
  ...projectContextContract,
  header: { ...projectContextContract.header, contractType: 'zhiju.contract.work_order' },
  workOrderRef: objectReference,
  taskRef: objectReference,
  projectRef: objectReference,
  requestedBy: { principalKind: 'HUMAN', principalId: uuid },
  objective: {
    objectiveType: 'procurement.review',
    humanReadableStatement: 'Review supplier evaluation procedure.',
    successIntent: 'Approved updated procedure.',
    relatedIssueRefs: [],
    deliveryItemRefs: [],
  },
  targetScope: {
    targetObjectRefs: [],
    baseContentRefs: [],
    allowedUnitRefs: [],
    forbiddenUnitRefs: [],
    allowedCreateTypes: [],
    crossObjectReferencesAllowed: [],
    scopePolicyRef: {
      ...versionedReference,
      objectType: 'project.scope_policy',
      scope: projectScope,
    },
  },
  inputRefs: [],
  contextSnapshotRef: snapshotReference,
  constraints: [],
  allowedCapabilities: [],
  deniedCapabilities: [],
  expectedOutputs: [],
  completionCriteria: [],
  riskAndQuality: {
    riskProfileRef: { ...versionedReference, objectType: 'risk.profile', scope: projectScope },
    dataHandlingPolicyRef: {
      ...versionedReference,
      objectType: 'policy.data_handling',
      scope: projectScope,
    },
    humanReviewRequired: false,
    escalationPolicyRef: {
      ...versionedReference,
      objectType: 'policy.escalation',
      scope: projectScope,
    },
  },
  executionPolicy: {
    maxAttempts: 3,
    retryableOutcomes: [],
    resumePolicy: 'RESET',
    fallbackPolicy: 'HUMAN',
    cancellationPolicyRef: {
      ...versionedReference,
      objectType: 'policy.cancellation',
      scope: projectScope,
    },
    leasePolicyRef: { ...versionedReference, objectType: 'policy.lease', scope: projectScope },
  },
  budget: {
    budgetPolicyRef: { ...versionedReference, objectType: 'policy.budget', scope: projectScope },
  },
  harnessPolicy: {
    fallbackAllowed: false,
    fallbackRequiresHuman: true,
    preferredHarnesses: [],
    selectionPolicyRef: {
      ...versionedReference,
      objectType: 'policy.harness_selection',
      scope: projectScope,
    },
  },
  modelPolicy: {
    allowedProviders: [],
    allowedModels: [],
    prohibitedDataClasses: [],
    minimumCapabilities: [],
    selectionPolicyRef: {
      ...versionedReference,
      objectType: 'policy.model_selection',
      scope: projectScope,
    },
  },
  versionPins: {
    projectContextContractRef: snapshotReference,
    contextBuilderPolicyRef: {
      ...versionedReference,
      objectType: 'zhiju.identity.policy',
      scope: projectScope,
    },
    workOrderSchemaRef: {
      ...versionedReference,
      objectType: 'core.work_order_schema',
      scope: projectScope,
    },
    capabilityPolicyRef: {
      ...versionedReference,
      objectType: 'policy.capability',
      scope: projectScope,
    },
    runtimeAdapterContractRef: {
      ...versionedReference,
      objectType: 'runtime.adapter_contract',
      scope: projectScope,
    },
    skillRefs: [],
    templateRefs: [],
  },
  issuedAt: '2026-08-17T00:00:00Z',
  specificationHash: payloadHash,
};
expectType<Core.WorkOrderContract>(workOrderContract);

const draftVersionPins: TaskExecution.DraftVersionPins = {
  contextBuilderPolicyRef: {
    ...workOrderContract.versionPins.contextBuilderPolicyRef,
    objectType: 'zhiju.identity.policy',
  },
  workOrderSchemaRef: workOrderContract.versionPins.workOrderSchemaRef,
  skillRefs: [],
  templateRefs: [],
  capabilityPolicyRef: workOrderContract.versionPins.capabilityPolicyRef,
  runtimeAdapterContractRef: workOrderContract.versionPins.runtimeAdapterContractRef,
};
expectType<TaskExecution.DraftVersionPins>(draftVersionPins);

const initialWorkOrderDraft: TaskExecution.InitialWorkOrderDraft = {
  taskRef: workOrderContract.taskRef,
  requestedBy: workOrderContract.requestedBy,
  objective: workOrderContract.objective,
  targetScope: workOrderContract.targetScope,
  inputRefs: workOrderContract.inputRefs,
  constraints: workOrderContract.constraints,
  allowedCapabilities: workOrderContract.allowedCapabilities,
  deniedCapabilities: workOrderContract.deniedCapabilities,
  expectedOutputs: workOrderContract.expectedOutputs,
  completionCriteria: workOrderContract.completionCriteria,
  riskAndQuality: workOrderContract.riskAndQuality,
  executionPolicy: workOrderContract.executionPolicy,
  budget: workOrderContract.budget,
  harnessPolicy: workOrderContract.harnessPolicy,
  modelPolicy: workOrderContract.modelPolicy,
  versionPins: draftVersionPins,
};
expectType<TaskExecution.InitialWorkOrderDraft>(initialWorkOrderDraft);

const createInitialWorkOrderPayload: TaskExecution.ExecutionCreateWorkOrderV11Payload = {
  draft: initialWorkOrderDraft,
};
expectType<TaskExecution.ExecutionCreateWorkOrderV11Payload>(createInitialWorkOrderPayload);

const initialContextBuildRequest: TaskExecution.InitialContextBuildRequestV11 = {
  draftSnapshotRef: {
    ...contentAddressedReference,
    objectType: 'zhiju.execution.work_order_draft_snapshot',
  },
  projectionType: 'COORDINATOR',
  purpose: 'context.initial',
  audience: { principalKind: 'HUMAN', principalId: uuid },
  sourceSlices: [
    {
      ...contentAddressedReference,
      objectType: 'zhiju.project.context_source_slice',
    },
  ],
  builderPolicyRef: {
    ...versionedReference,
    objectType: 'zhiju.identity.policy',
  },
};
expectType<TaskExecution.InitialContextBuildRequestV11>(initialContextBuildRequest);

const initialContextCommandResult: TaskExecution.ExecutionBuildInitialContextSnapshotResult = {
  contextSnapshotRef: {
    ...snapshotReference,
    objectType: 'zhiju.execution.context_snapshot',
    scope: projectScope,
  },
};
expectType<TaskExecution.ExecutionBuildInitialContextSnapshotResult>(initialContextCommandResult);
expectType<TaskExecution.InitialContextCommandResult>(initialContextCommandResult);

const initialContextV11CommandResult: TaskExecution.ExecutionBuildInitialContextSnapshotV11Result =
  initialContextCommandResult;
expectType<TaskExecution.ExecutionBuildInitialContextSnapshotV11Result>(
  initialContextV11CommandResult,
);

// Negative case — the Initial Context result never carries the legacy Core
// v1.0 Context Snapshot identity or a non-SNAPSHOT ref kind.
{
  const legacyInitialContextResult: TaskExecution.ExecutionBuildInitialContextSnapshotResult = {
    contextSnapshotRef: {
      ...snapshotReference,
      // @ts-expect-error — only zhiju.execution.context_snapshot is a valid result identity.
      objectType: 'zhiju.project.context_snapshot',
    },
  };
  void legacyInitialContextResult;

  const objectKindResult: TaskExecution.ExecutionBuildInitialContextSnapshotResult = {
    // @ts-expect-error — a SNAPSHOT ref is required, not an ObjectRef.
    contextSnapshotRef: { ...objectReference, objectType: 'zhiju.execution.context_snapshot' },
  };
  void objectKindResult;

  const incompleteProjectScope: TaskExecution.ExecutionBuildInitialContextSnapshotResult = {
    contextSnapshotRef: {
      ...snapshotReference,
      objectType: 'zhiju.execution.context_snapshot',
      // @ts-expect-error — a WI-02 Initial Context Snapshot is Project scoped,
      // so the shared enterprise-only ScopeRef is not sufficient.
      scope: enterpriseScope,
    },
  };
  void incompleteProjectScope;
}

// Negative case — DraftVersionPins cannot carry the frozen Context ref.
{
  const invalidDraftVersionPins: TaskExecution.DraftVersionPins = {
    ...draftVersionPins,
    // @ts-expect-error — projectContextContractRef is added only on the frozen branch.
    projectContextContractRef: snapshotReference,
  };
  void invalidDraftVersionPins;
}

const freezePayload: TaskExecution.ExecutionFreezeWorkOrderPayload = {
  workOrderContract,
  validationSnapshotRef: snapshotReference,
  specificationHash: payloadHash,
};
expectType<TaskExecution.ExecutionFreezeWorkOrderPayload>(freezePayload);

// Negative case — `workOrderContract` MUST keep the WorkOrder body. An
// Ajv-rejected `ContractHeader`-only value (header + nothing else) must
// therefore also be rejected by the static type.
{
  const headerOnly = projectContextContract.header;
  const badFreeze: TaskExecution.ExecutionFreezeWorkOrderPayload = {
    // @ts-expect-error — `ContractHeader` is not assignable to `WorkOrderContract`.
    workOrderContract: headerOnly,
    validationSnapshotRef: snapshotReference,
    specificationHash: payloadHash,
  };
  void badFreeze;
}

// =============================================================================
// Common.ScopeRef — `dependentRequired: { projectId: ['enterpriseId'] }` is
// expressed as a discriminated union: when `projectId` is present,
// `enterpriseId` must also be present.
// =============================================================================

const enterpriseOnlyScope: Common.ScopeRef = { enterpriseId: uuid };
const fullScope: Common.ScopeRef = { enterpriseId: uuid, projectId: uuid };
expectType<Common.ScopeRef>(enterpriseOnlyScope);
expectType<Common.ScopeRef>(fullScope);

// Positive case — neither key set is also allowed (matches the schema which
// leaves both as optional, with dependentRequired only firing on projectId).
const emptyScope: Common.ScopeRef = {};
expectType<Common.ScopeRef>(emptyScope);

// Negative case — `projectId` without `enterpriseId` is rejected both by
// Ajv (`dependentRequired`) and now by the static type union.
{
  // @ts-expect-error — `projectId` requires `enterpriseId` (dependentRequired).
  const projectOnly: Common.ScopeRef = { projectId: uuid };
  void projectOnly;
}

// =============================================================================
// CanonicalJson — controlled recursive value type
// =============================================================================

const canonicalPrimitive: CanonicalJson = 'string-value';
const canonicalNumber: CanonicalJson = 42;
const canonicalBool: CanonicalJson = true;
const canonicalNull: CanonicalJson = null;
const canonicalArray: CanonicalJson = [1, 'two', [3, { four: null }]];
const canonicalObject: CanonicalJson = { key: [1, 2, 3], nested: { enabled: true } };
expectType<CanonicalJson>(canonicalPrimitive);
expectType<CanonicalJson>(canonicalNumber);
expectType<CanonicalJson>(canonicalBool);
expectType<CanonicalJson>(canonicalNull);
expectType<CanonicalJson>(canonicalArray);
expectType<CanonicalJson>(canonicalObject);

// Negative case — Date is not part of CanonicalJson.
{
  // @ts-expect-error — Date is not assignable to CanonicalJson.
  const badCanonical: CanonicalJson = new Date('2026-08-17T00:00:00Z');
  void badCanonical;
}

// Persistent source slices reuse the existing named view and shared PrincipalRef.
function persistentSourceSliceTypes(
  source: EnterpriseProject.ProjectContextSourceSlice,
  result: EnterpriseProject.ProjectGetContextSourceSliceResult,
  request: EnterpriseProject.ProjectCaptureContextSourceSlicePayload,
) {
  const namedSource: EnterpriseProject.ProjectContextSourceSlice = result.slice.source;
  const principal: Common.PrincipalRef = request.audience;
  const capture: EnterpriseProject.ProjectCaptureContextSourceSlicePayload = {
    projectRef: { ...objectReference, objectType: 'zhiju.project.project' },
    purpose: 'context.snapshot.read',
    audience: { principalKind: 'SERVICE', principalId: uuid },
    requestedKinds: [],
    capturePolicyRef: { ...versionedReference, objectType: 'zhiju.identity.policy' },
  };
  // @ts-expect-error Policy is required, even when requestedKinds is empty.
  const missingPolicy: EnterpriseProject.ProjectCaptureContextSourceSlicePayload = {
    projectRef: capture.projectRef,
    purpose: capture.purpose,
    audience: principal,
    requestedKinds: [],
  };
  // @ts-expect-error Closed useStatus must not widen to string.
  const status: EnterpriseProject.ProjectGetContextSourceSliceResult['useStatus'] = 'STALE';
  // @ts-expect-error A dynamic view is not a persistent slice with capture metadata.
  const slice: EnterpriseProject.ContextSourceSlice = source;
  // @ts-expect-error A complete result must include checkedAt.
  const missingCheckedAt: EnterpriseProject.ProjectGetContextSourceSliceResult = {
    slice: result.slice,
    useStatus: 'USABLE',
  };
  return { namedSource, principal, capture, missingPolicy, status, slice, missingCheckedAt };
}
void persistentSourceSliceTypes;

// =============================================================================
// EnterpriseProject QUERY — `project.find_workspace_projects` (#258)
// =============================================================================

const workspaceProjectSummary: EnterpriseProject.WorkspaceProjectSummary = {
  enterpriseRef: objectReference,
  projectRef: { ...objectReference, objectType: 'zhiju.project.project' },
  enterpriseDisplayName: '示例企业',
  displayCode: 'ENT-0001',
  title: '升级项目',
  status: 'ACTIVE',
  aggregateVersion: 1,
};
expectType<EnterpriseProject.WorkspaceProjectSummary>(workspaceProjectSummary);

const workspaceProjectPage: EnterpriseProject.WorkspaceProjectPage = {
  items: [workspaceProjectSummary],
  nextCursor: 'opaque-cursor-value-0001',
  snapshotAt: '2026-10-10T00:00:00Z',
  sourceWatermarks: [
    { sourceModule: 'enterprise-project', sequence: 1, observedAt: '2026-10-10T00:00:00Z' },
  ],
};
expectType<EnterpriseProject.ProjectFindWorkspaceProjectsResult>(workspaceProjectPage);

const findWorkspaceProjects: EnterpriseProject.ProjectFindWorkspaceProjectsPayload = {
  enterpriseRef: objectReference,
  searchText: '升级',
  page: { pageSize: 25, cursor: 'opaque-cursor-value-0002' },
};
expectType<EnterpriseProject.ProjectFindWorkspaceProjectsPayload>(findWorkspaceProjects);

// Negative case — the owning Project status stays a closed enum.
{
  const badSummary: EnterpriseProject.WorkspaceProjectSummary = {
    ...workspaceProjectSummary,
    // @ts-expect-error — `status` is the registered Project lifecycle enum.
    status: 'DELETED',
  };
  void badSummary;
}

// Negative case — a directory summary never carries an extra field.
{
  const leakedSummary: EnterpriseProject.WorkspaceProjectSummary = {
    ...workspaceProjectSummary,
    // @ts-expect-error — customer text is outside the directory summary contract.
    customerName: 'leaked',
  };
  void leakedSummary;
}

// Negative case — the bounded directory payload always declares `page`.
{
  // @ts-expect-error — page is required even for a self-discovery directory Query.
  const missingPage: EnterpriseProject.ProjectFindWorkspaceProjectsPayload = {};
  void missingPage;
}

// Negative case — the empty ScopeRef self-discovery exception stays a plain ScopeRef.
{
  const emptyScope: Common.ScopeRef = {};
  expectType<Common.ScopeRef>(emptyScope);
}
