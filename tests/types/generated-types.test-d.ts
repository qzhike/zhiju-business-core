// AUTO-GENERATED-MARKER: this file's expected compile failures live behind
// `@ts-expect-error` annotations; the file is compiled as part of `tsc -b`
// via the workspace's tsconfig and never executed. Run `pnpm typecheck` to
// verify that:
//   - positive fixtures compile without errors;
//   - every `@ts-expect-error` annotation actually fires.

import type { CanonicalJson } from '../../contracts/src/generated/types/common.js';
import type { Common } from '../../contracts/src/generated/types/common.js';
import type { Core } from '../../contracts/src/generated/types/core.js';
import type { IdentityPolicy } from '../../contracts/src/generated/types/identity-policy.js';
import type { EnterpriseProject } from '../../contracts/src/generated/types/enterprise-project.js';
import type { TaskExecution } from '../../contracts/src/generated/types/task-execution.js';
import type { ReleasePublication } from '../../contracts/src/generated/types/release-publication.js';

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
      objectType: 'context.builder_policy',
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
