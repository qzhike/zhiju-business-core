// IM-06 (#216): §19.4 deterministic assembly — golden ProjectContext v1.0
// against the real ContractRegistry, deterministic identity assertions and the
// fail-closed branch matrix. Source Slice fixtures replicate the
// EnterpriseProject-published `canonicalSourceSlice` output byte-shape
// (type-matched fixtures: no cross-module imports; the legacy `EnterpriseFact`
// spelling inside `factItems` is exactly what the owning module publishes).

import { describe, expect, it } from 'vitest';
import {
  ContractRegistry,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
} from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '../persistence/task-execution-db.js';
import {
  assembleInitialContext,
  DRAFT_INPUT_KIND_NOT_SUPPORTED,
  DRAFT_INPUT_NOT_CAPTURED,
  DRAFT_INPUT_OMISSION_CATEGORY,
  ENTERPRISE_FACT_OBJECT_TYPE,
  EXECUTION_CONTEXT_INPUT_REQUIRED,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  EXECUTION_CONTEXT_TARGET_INVALID,
  type InitialContextAssemblyInput,
  type InitialContextAssemblyOutcome,
} from './initial-context-assembly.js';
import { CONTEXT_BUILDER_POLICY_PROFILE_KEY } from './policy-profiles.js';
import { API_VALUE_INVALID } from './work-order-draft-creation.js';
import { REFERENCE_INVALID } from './work-order-draft-read.js';

const PROJECT_CONTEXT_SCHEMA_ID = 'https://schemas.zhiju.local/core/project-context/1.0';

const ENT = '019945f7-0001-7000-8000-000000000001';
const PRJ = '019945f7-0002-7000-8000-000000000002';
const WO = '019945f7-0003-7000-8000-000000000003';
const TASK = '019945f7-0004-7000-8000-000000000004';
const DRAFT_SNAPSHOT = '019945f7-0005-7000-8000-000000000005';
const SLICE_A = '019945f7-0006-7000-8000-000000000006';
const SLICE_B = '019945f7-0007-7000-8000-000000000007';
const SLICE_GAMMA = '019945f7-001c-7000-8000-00000000001c';
const POLICY_OBJECT = '019945f7-0008-7000-8000-000000000008';
const POLICY_VERSION = '019945f7-0009-7000-8000-000000000009';
const CAPTURE_POLICY_OBJECT = '019945f7-000a-7000-8000-00000000000a';
const CAPTURE_POLICY_VERSION = '019945f7-000b-7000-8000-00000000000b';
const PROFILE_OBJECT = '019945f7-000c-7000-8000-00000000000c';
const PROFILE_SNAPSHOT = '019945f7-000d-7000-8000-00000000000d';
const QMS_OBJECT = '019945f7-000e-7000-8000-00000000000e';
const QMS_VERSION = '019945f7-000f-7000-8000-00000000000f';
const FACT_A1_OBJECT = '019945f7-0010-7000-8000-000000000010';
const FACT_A1_VERSION = '019945f7-0011-7000-8000-000000000011';
const FACT_A2_OBJECT = '019945f7-0012-7000-8000-000000000012';
const FACT_A2_VERSION = '019945f7-0013-7000-8000-000000000013';
const FACT_B1_OBJECT = '019945f7-0014-7000-8000-000000000014';
const FACT_B1_VERSION = '019945f7-0015-7000-8000-000000000015';
const SNAPSHOT_ID = '019945f7-0016-7000-8000-000000000016';
const PRINCIPAL = '019945f7-0017-7000-8000-000000000017';
const CORRELATION = '019945f7-0018-7000-8000-000000000018';
const WO_SCHEMA_OBJECT = '019945f7-0019-7000-8000-000000000019';
const WO_SCHEMA_VERSION = '019945f7-001a-7000-8000-00000000001a';
const ARTIFACT_OBJECT = '019945f7-001b-7000-8000-00000000001b';
const ARTIFACT_VERSION = '019945f7-001d-7000-8000-00000000001d';

const AS_OF = '2026-09-19T08:15:30.123Z';
const PURPOSE = 'document.write';
const AUDIENCE = { principalId: PRINCIPAL, principalKind: 'SERVICE' } as const;

function digestText(char: string): string {
  return char.repeat(64);
}

function contentHash(char: string): Record<string, unknown> {
  return { algorithm: 'SHA-256', digest: digestText(char), canonicalizationVersion: '1' };
}

function sliceRef(objectId: string, digestChar: string): Record<string, unknown> {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.project.context_source_slice',
    objectId,
    scope: { enterpriseId: ENT, projectId: PRJ },
    contentHash: contentHash(digestChar),
  };
}

function draftSnapshotRef(): Record<string, unknown> {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.execution.work_order_draft_snapshot',
    objectId: DRAFT_SNAPSHOT,
    scope: { enterpriseId: ENT, projectId: PRJ },
    contentHash: contentHash('d'),
  };
}

function builderPolicyRef(): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.identity.policy',
    objectId: POLICY_OBJECT,
    versionId: POLICY_VERSION,
    scope: { enterpriseId: ENT, projectId: PRJ },
  };
}

function capturePolicyRef(): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.identity.policy',
    objectId: CAPTURE_POLICY_OBJECT,
    versionId: CAPTURE_POLICY_VERSION,
    scope: { enterpriseId: ENT },
  };
}

function workOrderSchemaRef(): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.contract.work_order_schema',
    objectId: WO_SCHEMA_OBJECT,
    versionId: WO_SCHEMA_VERSION,
    scope: { enterpriseId: ENT },
  };
}

function projectRef(): Record<string, unknown> {
  return {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: PRJ,
    scope: { enterpriseId: ENT, projectId: PRJ },
  };
}

function enterpriseProfileSnapshotRef(): Record<string, unknown> {
  return {
    kind: 'SNAPSHOT',
    objectType: 'zhiju.project.enterprise_profile',
    objectId: PROFILE_OBJECT,
    snapshotId: PROFILE_SNAPSHOT,
    scope: { enterpriseId: ENT },
    contentHash: contentHash('1'),
  };
}

function qmsConfigurationRef(): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.project.qms_configuration',
    objectId: QMS_OBJECT,
    versionId: QMS_VERSION,
    scope: { enterpriseId: ENT },
  };
}

/** The EP-published fact item: the factRef keeps the legacy `EnterpriseFact` spelling. */
function factItem(
  objectId: string,
  versionId: string,
  status: string,
  riskLevel: string,
): Record<string, unknown> {
  return {
    factRef: {
      kind: 'VERSIONED',
      objectType: 'EnterpriseFact',
      objectId,
      versionId,
      scope: { enterpriseId: ENT },
    },
    factType: 'REGULATORY_OBLIGATION',
    riskLevel,
    status,
    value: {
      presence: 'REDACTED',
      reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED',
      evidenceRefs: [],
    },
  };
}

function sliceA(): Record<string, unknown> {
  return {
    sliceId: SLICE_A,
    scopeRef: { enterpriseId: ENT, projectId: PRJ },
    projectRef: projectRef(),
    purpose: PURPOSE,
    audience: { ...AUDIENCE },
    capturePolicyRef: capturePolicyRef(),
    capturedAt: '2026-09-18T10:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    source: {
      projectRef: projectRef(),
      enterpriseProfileSnapshotRef: enterpriseProfileSnapshotRef(),
      qmsConfigurationRef: qmsConfigurationRef(),
      factItems: [
        factItem(FACT_A1_OBJECT, FACT_A1_VERSION, 'CONFIRMED', 'LOW'),
        factItem(FACT_A2_OBJECT, FACT_A2_VERSION, 'PROPOSED', 'MEDIUM'),
      ],
      omissions: [{ kind: 'PRODUCT_SCOPE', reasonCode: 'PURPOSE_FORBIDDEN' }],
      redactions: [
        { path: '/factItems/0/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
        { path: '/factItems/0/sourceRefs', reasonCode: 'PROJECT_QUERY_SOURCE_REFS_REDACTED' },
        { path: '/factItems/*/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
        { path: '/factItems/*/sourceRefs', reasonCode: 'PROJECT_QUERY_SOURCE_REFS_REDACTED' },
      ],
      sourceWatermark: {
        sourceModule: 'enterprise_project',
        partition: PRJ,
        sequence: 41,
        observedAt: '2026-09-18T10:00:00Z',
      },
    },
  };
}

function sliceB(): Record<string, unknown> {
  return {
    sliceId: SLICE_B,
    scopeRef: { enterpriseId: ENT, projectId: PRJ },
    projectRef: projectRef(),
    purpose: PURPOSE,
    audience: { ...AUDIENCE },
    capturePolicyRef: capturePolicyRef(),
    capturedAt: '2026-09-18T11:00:00Z',
    validUntil: '2026-12-01T00:00:00Z',
    source: {
      projectRef: projectRef(),
      enterpriseProfileSnapshotRef: enterpriseProfileSnapshotRef(),
      qmsConfigurationRef: qmsConfigurationRef(),
      factItems: [factItem(FACT_B1_OBJECT, FACT_B1_VERSION, 'DISPUTED', 'HIGH')],
      omissions: [{ kind: 'ACTIVE_BASELINES', reasonCode: 'KIND_NOT_REQUESTED' }],
      redactions: [],
      sourceWatermark: {
        sourceModule: 'enterprise_project',
        partition: PRJ,
        sequence: 42,
        observedAt: '2026-09-18T11:00:00Z',
      },
    },
  };
}

function externalRef(externalId: string): Record<string, unknown> {
  return {
    system: 'external.dms',
    resourceType: 'external.document',
    externalId,
    observedAt: '2026-09-10T00:00:00Z',
  };
}

function typedArtifactRef(scope: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.artifact.artifact',
    objectId: ARTIFACT_OBJECT,
    versionId: ARTIFACT_VERSION,
    scope,
  };
}

interface InputRefOptions {
  readonly required?: boolean;
  readonly permittedUse?: string;
  readonly contentAccessMode?: string;
  readonly integrityRequired?: boolean;
  readonly epistemicExpectation?: string;
}

function inputRef(
  inputRole: string,
  ref: unknown,
  options?: InputRefOptions,
): Record<string, unknown> {
  return {
    inputRole,
    ref,
    required: options?.required ?? false,
    permittedUse: options?.permittedUse ?? PURPOSE,
    contentAccessMode: options?.contentAccessMode ?? 'REFERENCE_ONLY',
    integrityRequired: options?.integrityRequired ?? false,
    ...(options?.epistemicExpectation === undefined
      ? {}
      : { epistemicExpectation: options.epistemicExpectation }),
  };
}

function draftInputRefs(): Record<string, unknown>[] {
  return [
    inputRef('source.primary', sliceRef(SLICE_A, 'a'), { required: true, integrityRequired: true }),
    inputRef('source.secondary', sliceRef(SLICE_B, 'b'), {
      integrityRequired: false,
      epistemicExpectation: 'DISPUTED',
    }),
    inputRef('external.alpha', externalRef('DOC-001')),
    inputRef('external.beta', externalRef('DOC-002')),
    inputRef('slice.gamma', sliceRef(SLICE_GAMMA, 'f')),
    inputRef('typed.alpha', typedArtifactRef({ enterpriseId: ENT })),
    inputRef('typed.beta', typedArtifactRef({ enterpriseId: ENT, projectId: PRJ })),
  ];
}

function draftFixture(): {
  workOrderRef: Record<string, unknown>;
  taskRef: Record<string, unknown>;
  scopeRef: { enterpriseId: string; projectId: string };
  draft: Record<string, unknown>;
} {
  return {
    workOrderRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.execution.work_order',
      objectId: WO,
      scope: { enterpriseId: ENT, projectId: PRJ },
    },
    taskRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.execution.task',
      objectId: TASK,
      scope: { enterpriseId: ENT, projectId: PRJ },
    },
    scopeRef: { enterpriseId: ENT, projectId: PRJ },
    draft: {
      inputRefs: draftInputRefs(),
      targetScope: { targetObjectRefs: [] },
      versionPins: {
        contextBuilderPolicyRef: builderPolicyRef(),
        workOrderSchemaRef: workOrderSchemaRef(),
      },
    },
  };
}

function profileSchemaRef(): Record<string, unknown> {
  const reference = registeredPolicyProfileReference(
    POLICY_PROFILE_REGISTRY_VERSION,
    CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  );
  if (reference === undefined) throw new Error('the context builder profile is not registered');
  return reference as unknown as Record<string, unknown>;
}

function policyFixture(): {
  resolvedRef: Record<string, unknown>;
  contentHashDigest: string;
  effectiveFrom: string;
  policySchemaRefs: Record<string, unknown>[];
  policyDocument: Record<string, unknown>;
} {
  return {
    resolvedRef: builderPolicyRef(),
    contentHashDigest: digestText('e'),
    effectiveFrom: '2026-01-01T00:00:00Z',
    policySchemaRefs: [profileSchemaRef()],
    policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
  };
}

function asCanonical(value: unknown): CanonicalJsonObject {
  return value as CanonicalJsonObject;
}

function validInput(): InitialContextAssemblyInput {
  return {
    request: {
      draftSnapshotRef: asCanonical(draftSnapshotRef()),
      projectionType: 'DOCUMENT_WRITER',
      purpose: PURPOSE,
      audience: { ...AUDIENCE },
      builderPolicyRef: asCanonical(builderPolicyRef()),
    },
    draft: (() => {
      const fixture = draftFixture();
      return {
        workOrderRef: asCanonical(fixture.workOrderRef),
        taskRef: asCanonical(fixture.taskRef),
        scopeRef: fixture.scopeRef,
        draft: fixture.draft,
      };
    })(),
    slices: [
      { ref: asCanonical(sliceRef(SLICE_A, 'a')), slice: asCanonical(sliceA()) },
      { ref: asCanonical(sliceRef(SLICE_B, 'b')), slice: asCanonical(sliceB()) },
    ],
    policy: (() => {
      const fixture = policyFixture();
      return {
        resolvedRef: asCanonical(fixture.resolvedRef),
        contentHashDigest: fixture.contentHashDigest,
        effectiveFrom: fixture.effectiveFrom,
        policySchemaRefs: fixture.policySchemaRefs,
        policyDocument: fixture.policyDocument,
      };
    })(),
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
    correlationId: CORRELATION,
    issuedBy: { ...AUDIENCE },
  };
}

function expectAssembled(outcome: InitialContextAssemblyOutcome): {
  readonly payload: CanonicalJsonObject;
  readonly metadata: CanonicalJsonObject;
} {
  if (outcome.outcome !== 'ASSEMBLED') {
    throw new Error(
      `expected ASSEMBLED, got REJECTED(${outcome.errorCode}): ${outcome.safeSummary}`,
    );
  }
  return outcome;
}

function expectRejected(outcome: InitialContextAssemblyOutcome, errorCode: string): void {
  if (outcome.outcome !== 'REJECTED') {
    throw new Error(`expected REJECTED(${errorCode}), got ASSEMBLED`);
  }
  expect(outcome.errorCode).toBe(errorCode);
}

function rec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

function recArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('expected an array');
  return value as Record<string, unknown>[];
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`index ${index} is empty`);
  return value;
}

function uuidTimeMilliseconds(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

describe('assembleInitialContext (§19.4)', () => {
  it('assembles a golden ProjectContext v1.0 that passes the registered Core schema', () => {
    const { payload, metadata } = expectAssembled(assembleInitialContext(validInput()));

    const validation = new ContractRegistry().validateCoreContract(
      PROJECT_CONTEXT_SCHEMA_ID,
      payload,
    );
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    // Identity and header pins (§19.2 item 2, §19.4 item 5).
    expect(payload.contextSnapshotId).toBe(SNAPSHOT_ID);
    const header = rec(payload.header);
    expect(header.contractId).toBe(SNAPSHOT_ID);
    expect(header.contractType).toBe('zhiju.contract.project_context');
    expect(header.issuedAt).toBe(AS_OF);
    expect(rec(header.payloadHash).digest).toBe('0'.repeat(64));

    // §19.4 item 4: the audience encoding is exactly the principalId string.
    const projection = rec(payload.projection);
    expect(projection.audience).toBe(PRINCIPAL);
    expect(projection.purpose).toBe(PURPOSE);
    expect(projection.projectionType).toBe('DOCUMENT_WRITER');
    expect(projection.requestedByWorkOrderRef).toEqual(draftFixture().workOrderRef);
    expect(projection.builderPolicyRef).toEqual(builderPolicyRef());

    expect(rec(payload.enterpriseRef).objectType).toBe('zhiju.project.enterprise');
    expect(rec(payload.projectRef).objectType).toBe('zhiju.project.project');

    // §19.4 item 7: fact mapping with the fixed status/risk tables.
    const items = recArray(payload.contextItems);
    expect(items).toHaveLength(3);
    const mapped = items.map((item) => ({
      contextItemId: str(item.contextItemId),
      kind: str(item.kind),
      subjectRef: rec(item.subjectRef),
      epistemicState: str(item.epistemicState),
      sensitivity: str(item.sensitivity),
      recordedTime: str(item.recordedTime),
      permittedUses: item.permittedUses,
      provenanceRefs: recArray(item.provenanceRefs),
    }));
    const a1 = at(mapped, 0);
    const a2 = at(mapped, 1);
    const b1 = at(mapped, 2);
    for (const item of [a1, a2, b1]) {
      expect(item.kind).toBe('FACT');
      expect(item.subjectRef.objectType).toBe(ENTERPRISE_FACT_OBJECT_TYPE);
      expect(item.permittedUses).toEqual([PURPOSE]);
      expect(item.provenanceRefs).toHaveLength(2);
    }
    expect(a1.subjectRef.objectId).toBe(FACT_A1_OBJECT);
    expect(a1.epistemicState).toBe('CONFIRMED');
    expect(a1.sensitivity).toBe('INTERNAL');
    expect(a1.recordedTime).toBe('2026-09-18T10:00:00Z');
    expect(a2.epistemicState).toBe('INFERRED');
    expect(a2.sensitivity).toBe('CUSTOMER_CONFIDENTIAL');
    expect(b1.epistemicState).toBe('DISPUTED');
    expect(b1.sensitivity).toBe('RESTRICTED_PERSONAL');
    expect(b1.recordedTime).toBe('2026-09-18T11:00:00Z');

    // Deterministic UUIDv7 identity: the real `asOf` milliseconds sit in the
    // time field, ids are stable across runs and distinct across facts.
    const asOfMs = Date.parse(AS_OF);
    const ids = [a1, a2, b1].map((item) => item.contextItemId);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(uuidTimeMilliseconds(id)).toBe(asOfMs);
    }
    expect(new Set(ids).size).toBe(3);
    const rerun = expectAssembled(assembleInitialContext(validInput()));
    expect(recArray(rerun.payload.contextItems).map((item) => item.contextItemId)).toEqual(ids);
    expect(
      digestCanonicalPayload(rerun.payload).hash.equals(digestCanonicalPayload(payload).hash),
    ).toBe(true);

    // §19.4 item 5: manifest unions, canonical-string sorted and deduplicated.
    const manifest = rec(payload.sourceManifest);
    expect(manifest.enterpriseProfileSnapshotRef).toEqual(enterpriseProfileSnapshotRef());
    expect(manifest.qmsConfigurationRef).toEqual(qmsConfigurationRef());
    expect(recArray(manifest.policyRefs)).toHaveLength(2);
    expect(recArray(manifest.schemaRefs)).toHaveLength(2);
    expect(manifest.externalAuthoritySnapshotRefs).toEqual([]);

    // §19.4 item 8: slice omissions first, then draft-input omissions in the
    // sorted inputRef order; excludedScopes carries slice kinds only.
    const omissions = recArray(payload.omissions);
    expect(omissions).toHaveLength(7);
    expect(omissions[0]?.category).toBe('PRODUCT_SCOPE');
    expect(omissions[0]?.reasonCode).toBe('PURPOSE_FORBIDDEN');
    expect(omissions[1]?.category).toBe('ACTIVE_BASELINES');
    expect(omissions[1]?.reasonCode).toBe('KIND_NOT_REQUESTED');
    const draftOmissions = omissions.slice(2);
    expect(draftOmissions.map((omission) => omission.category)).toEqual([
      DRAFT_INPUT_OMISSION_CATEGORY,
      DRAFT_INPUT_OMISSION_CATEGORY,
      DRAFT_INPUT_OMISSION_CATEGORY,
      DRAFT_INPUT_OMISSION_CATEGORY,
      DRAFT_INPUT_OMISSION_CATEGORY,
    ]);
    expect(draftOmissions.map((omission) => omission.reasonCode)).toEqual([
      DRAFT_INPUT_KIND_NOT_SUPPORTED,
      DRAFT_INPUT_KIND_NOT_SUPPORTED,
      DRAFT_INPUT_NOT_CAPTURED,
      DRAFT_INPUT_KIND_NOT_SUPPORTED,
      DRAFT_INPUT_KIND_NOT_SUPPORTED,
    ]);

    const redactions = recArray(payload.redactions);
    expect(redactions).toHaveLength(4);
    for (const redaction of redactions) {
      expect(redaction.policyRef).toEqual(capturePolicyRef());
    }

    const coverage = rec(payload.coverage);
    expect(coverage.requestedScopes).toEqual([PURPOSE]);
    expect(coverage.includedScopes).toEqual([PURPOSE]);
    expect(coverage.excludedScopes).toEqual(['ACTIVE_BASELINES', 'PRODUCT_SCOPE']);
    expect(coverage.completeness).toBe('PARTIAL');

    // §19.4 item 6: one watermark per distinct slice watermark, in slice order.
    const watermarks = recArray(payload.sourceWatermarks);
    expect(watermarks).toHaveLength(2);
    expect(watermarks[0]?.sequence).toBe(41);
    expect(watermarks[1]?.sequence).toBe(42);

    // #168 / §11.2.5.4: no request expiry, so the earliest finite bound wins.
    expect(payload.expiresAt).toBe('2026-12-01T00:00:00Z');
    expect(metadata.buildKind).toBe('INITIAL');
    expect(metadata.effectiveExpiresAt).toBe('2026-12-01T00:00:00Z');
    expect(Object.prototype.hasOwnProperty.call(metadata, 'requestExpiresAt')).toBe(false);
    expect(recArray(metadata.sliceRefs).map((ref) => rec(ref).objectId)).toEqual([
      SLICE_A,
      SLICE_B,
    ]);
    const observations = recArray(metadata.inputRefObservations);
    expect(observations).toHaveLength(7);
    expect(observations.filter((entry) => entry.resolution === 'ADOPTED')).toHaveLength(2);
    expect(observations.filter((entry) => entry.resolution === 'OMITTED')).toHaveLength(5);
  });

  it('is invariant under slice and inputRef permutation', () => {
    const baseline = expectAssembled(assembleInitialContext(validInput()));

    const permuted: InitialContextAssemblyInput = {
      ...validInput(),
      slices: [...validInput().slices].reverse(),
    };
    permuted.draft.draft.inputRefs = [...draftInputRefs()].reverse();

    const rerun = expectAssembled(assembleInitialContext(permuted));
    expect(
      digestCanonicalPayload(rerun.payload).hash.equals(
        digestCanonicalPayload(baseline.payload).hash,
      ),
    ).toBe(true);
    expect(
      digestCanonicalPayload(rerun.metadata).hash.equals(
        digestCanonicalPayload(baseline.metadata).hash,
      ),
    ).toBe(true);
  });

  it('honours a declared request expiry as the effective expiry', () => {
    const base = validInput();
    const { payload, metadata } = expectAssembled(
      assembleInitialContext({
        ...base,
        request: { ...base.request, expiresAt: '2026-10-01T00:00:00Z' },
      }),
    );
    expect(payload.expiresAt).toBe('2026-10-01T00:00:00Z');
    expect(metadata.requestExpiresAt).toBe('2026-10-01T00:00:00Z');
    expect(metadata.effectiveExpiresAt).toBe('2026-10-01T00:00:00Z');
  });

  it('treats a JSON-null request expiry as "no bound" (the binding validation rejects it later)', () => {
    const base = validInput();
    const { payload, metadata } = expectAssembled(
      assembleInitialContext({
        ...base,
        request: { ...base.request, expiresAt: null },
      }),
    );
    expect(payload.expiresAt).toBe('2026-12-01T00:00:00Z');
    expect(Object.prototype.hasOwnProperty.call(metadata, 'requestExpiresAt')).toBe(false);
  });

  it('collapses a byte-identical duplicate inputRef into one observation', () => {
    const input = validInput();
    const draft = input.draft.draft;
    draft.inputRefs = [
      ...draftInputRefs(),
      inputRef('source.primary', sliceRef(SLICE_A, 'a'), {
        required: true,
        integrityRequired: true,
      }),
    ];
    const { metadata } = expectAssembled(assembleInitialContext(input));
    expect(recArray(metadata.inputRefObservations)).toHaveLength(7);
  });

  // --- Fail-closed branch matrix -------------------------------------------

  it('rejects an empty audience principalId', () => {
    const base = validInput();
    expectRejected(
      assembleInitialContext({
        ...base,
        request: { ...base.request, audience: { principalId: '', principalKind: 'SERVICE' } },
      }),
      API_VALUE_INVALID,
    );
  });

  it('rejects a malformed assembly instant', () => {
    expectRejected(
      assembleInitialContext({ ...validInput(), asOf: 'not-an-instant' }),
      API_VALUE_INVALID,
    );
  });

  it('rejects an empty slice set', () => {
    expectRejected(
      assembleInitialContext({ ...validInput(), slices: [] }),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects a duplicated exact slice ref', () => {
    const input = validInput();
    const first = input.slices[0];
    if (first === undefined) throw new Error('fixture slices missing');
    expectRejected(
      assembleInitialContext({ ...input, slices: [first, first] }),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects a slice ref of another object type', () => {
    const input = validInput();
    const ref = sliceRef(SLICE_A, 'a');
    ref.objectType = 'zhiju.project.other_slice';
    const first = input.slices[0];
    if (first === undefined) throw new Error('fixture slices missing');
    expectRejected(
      assembleInitialContext({
        ...input,
        slices: [{ ref: asCanonical(ref), slice: first.slice }, ...input.slices.slice(1)],
      }),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  function mutateSlice(
    input: InitialContextAssemblyInput,
    sliceIndex: number,
    mutate: (slice: Record<string, unknown>) => void,
  ): InitialContextAssemblyInput {
    const entry = input.slices[sliceIndex];
    if (entry === undefined) throw new Error('fixture slice missing');
    const slice = sliceIndex === 0 ? sliceA() : sliceB();
    mutate(slice);
    const slices = input.slices.map((candidate, index) =>
      index === sliceIndex ? { ref: entry.ref, slice: asCanonical(slice) } : candidate,
    );
    return { ...input, slices };
  }

  it.each([
    [
      'sliceId does not equal the ref objectId',
      (slice: Record<string, unknown>) => {
        slice.sliceId = SLICE_GAMMA;
      },
    ],
    [
      'scopeRef carries a third member',
      (slice: Record<string, unknown>) => {
        slice.scopeRef = { enterpriseId: ENT, projectId: PRJ, tenantId: ENT };
      },
    ],
    [
      'purpose was substituted after capture',
      (slice: Record<string, unknown>) => {
        slice.purpose = 'document.review';
      },
    ],
    [
      'audience does not match the request audience',
      (slice: Record<string, unknown>) => {
        slice.audience = { principalId: PRINCIPAL, principalKind: 'HUMAN' };
      },
    ],
    [
      'capturedAt is not a string',
      (slice: Record<string, unknown>) => {
        slice.capturedAt = 42;
      },
    ],
    [
      'validUntil is not a string',
      (slice: Record<string, unknown>) => {
        slice.validUntil = 42;
      },
    ],
    [
      'projectRef does not close to the build Project',
      (slice: Record<string, unknown>) => {
        rec(slice.source).projectRef = { ...projectRef(), objectId: SNAPSHOT_ID };
      },
    ],
    [
      'slices disagree on the enterprise profile snapshot',
      (slice: Record<string, unknown>) => {
        rec(slice.source).enterpriseProfileSnapshotRef = {
          ...enterpriseProfileSnapshotRef(),
          snapshotId: SLICE_GAMMA,
        };
      },
    ],
    [
      'a fact item is missing a member',
      (slice: Record<string, unknown>) => {
        const items = recArray(rec(slice.source).factItems);
        const first = items[0];
        if (first !== undefined) delete first.factType;
      },
    ],
    [
      'a fact item carries an off-table status',
      (slice: Record<string, unknown>) => {
        const items = recArray(rec(slice.source).factItems);
        if (items[0] !== undefined) items[0].status = 'ARCHIVED';
      },
    ],
    [
      'a fact item carries an off-table riskLevel',
      (slice: Record<string, unknown>) => {
        const items = recArray(rec(slice.source).factItems);
        if (items[0] !== undefined) items[0].riskLevel = 'SEVERE';
      },
    ],
    [
      'a fact ref lost the legacy EnterpriseFact spelling',
      (slice: Record<string, unknown>) => {
        const items = recArray(rec(slice.source).factItems);
        const first = items[0];
        if (first !== undefined) rec(first.factRef).objectType = ENTERPRISE_FACT_OBJECT_TYPE;
      },
    ],
    [
      'an omission carries an off-table kind',
      (slice: Record<string, unknown>) => {
        rec(slice.source).omissions = [{ kind: 'PROJECT_QUERY', reasonCode: 'KIND_NOT_REQUESTED' }];
      },
    ],
    [
      'an omission carries an off-table reasonCode',
      (slice: Record<string, unknown>) => {
        rec(slice.source).omissions = [{ kind: 'PRODUCT_SCOPE', reasonCode: 'PURPOSE_BLOCKED' }];
      },
    ],
    [
      'a redaction carries an off-pattern reasonCode',
      (slice: Record<string, unknown>) => {
        rec(slice.source).redactions = [{ path: '/factItems/0/value', reasonCode: 'lowercase' }];
      },
    ],
    [
      'a redaction is missing its path',
      (slice: Record<string, unknown>) => {
        rec(slice.source).redactions = [{ reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' }];
      },
    ],
  ] as const)('rejects a slice where %s', (_label, mutate) => {
    expectRejected(
      assembleInitialContext(mutateSlice(validInput(), 0, mutate)),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects two facts that share one subject identity across slices', () => {
    const input = mutateSlice(validInput(), 1, (slice) => {
      rec(slice.source).factItems = [factItem(FACT_A1_OBJECT, FACT_A1_VERSION, 'DISPUTED', 'HIGH')];
    });
    // The second slice must keep its own identity; only the fact collides.
    expectRejected(assembleInitialContext(input), EXECUTION_CONTEXT_SOURCE_INVALID);
  });

  function mutateDraft(
    input: InitialContextAssemblyInput,
    mutate: (draft: Record<string, unknown>) => void,
  ): InitialContextAssemblyInput {
    const fixture = draftFixture();
    mutate(fixture.draft);
    return {
      ...input,
      draft: {
        workOrderRef: asCanonical(fixture.workOrderRef),
        taskRef: asCanonical(fixture.taskRef),
        scopeRef: fixture.scopeRef,
        draft: fixture.draft,
      },
    };
  }

  it('rejects a required inputRef that no slice captured', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [
            inputRef('source.missing', sliceRef(SLICE_GAMMA, 'f'), { required: true }),
          ];
        }),
      ),
      EXECUTION_CONTEXT_INPUT_REQUIRED,
    );
  });

  it('rejects an adopted inputRef whose permittedUse differs from the purpose', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), {
              required: true,
              permittedUse: 'document.review',
            }),
            inputRef('source.secondary', sliceRef(SLICE_B, 'b')),
          ];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects an adopted inputRef requiring an unservable content access mode', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), {
              required: true,
              contentAccessMode: 'INLINE_FRAGMENT',
            }),
            inputRef('source.secondary', sliceRef(SLICE_B, 'b')),
          ];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects an epistemic expectation that the slice aggregate does not meet', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), { required: true }),
            inputRef('source.secondary', sliceRef(SLICE_B, 'b'), {
              epistemicExpectation: 'CONFIRMED',
            }),
          ];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects an epistemic expectation on a fact-free slice', () => {
    const input = validInput();
    const empty = sliceB();
    rec(empty.source).factItems = [];
    rec(empty.source).omissions = [];
    const second = input.slices[1];
    const first = input.slices[0];
    if (first === undefined || second === undefined) throw new Error('fixture slices missing');
    const withEmpty: InitialContextAssemblyInput = {
      ...input,
      slices: [first, { ref: second.ref, slice: asCanonical(empty) }],
    };
    expectRejected(
      assembleInitialContext(
        mutateDraft(withEmpty, (draft) => {
          draft.inputRefs = [
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), { required: true }),
            inputRef('source.secondary', sliceRef(SLICE_B, 'b'), {
              epistemicExpectation: 'CONFIRMED',
            }),
          ];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects a non-empty targetScope.targetObjectRefs', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.targetScope = { targetObjectRefs: [typedArtifactRef({ enterpriseId: ENT })] };
        }),
      ),
      EXECUTION_CONTEXT_TARGET_INVALID,
    );
  });

  it('rejects two inputRefs sharing inputRole and ref but differing in metadata', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), { required: true }),
            inputRef('source.primary', sliceRef(SLICE_A, 'a'), {
              required: true,
              integrityRequired: true,
            }),
            inputRef('source.secondary', sliceRef(SLICE_B, 'b')),
          ];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('rejects an inputRef that is missing a member', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.inputRefs = [{ inputRole: 'source.primary', ref: sliceRef(SLICE_A, 'a') }];
        }),
      ),
      EXECUTION_CONTEXT_SOURCE_INVALID,
    );
  });

  it('maps a versionPins policy ref mismatch onto POLICY_REF_MISMATCH', () => {
    expectRejected(
      assembleInitialContext(
        mutateDraft(validInput(), (draft) => {
          draft.versionPins = {
            contextBuilderPolicyRef: { ...builderPolicyRef(), versionId: SNAPSHOT_ID },
            workOrderSchemaRef: workOrderSchemaRef(),
          };
        }),
      ),
      'POLICY_REF_MISMATCH',
    );
  });

  it('maps a superseded Builder Policy onto POLICY_EXPIRED', () => {
    const input = validInput();
    expectRejected(
      assembleInitialContext({
        ...input,
        policy: { ...input.policy, supersededAt: '2026-09-01T00:00:00Z' },
      }),
      'POLICY_EXPIRED',
    );
  });

  it('maps a not-yet-effective Builder Policy onto POLICY_NOT_EFFECTIVE', () => {
    const input = validInput();
    expectRejected(
      assembleInitialContext({
        ...input,
        policy: { ...input.policy, effectiveFrom: '2027-01-01T00:00:00Z' },
      }),
      'POLICY_NOT_EFFECTIVE',
    );
  });

  it('maps an undeclared Builder Policy profile onto INVALID_POLICY_BINDING', () => {
    const input = validInput();
    expectRejected(
      assembleInitialContext({
        ...input,
        policy: { ...input.policy, policySchemaRefs: [] },
      }),
      'INVALID_POLICY_BINDING',
    );
  });

  it('maps a Policy that forbids the projection type onto INVALID_POLICY_BINDING', () => {
    const input = validInput();
    expectRejected(
      assembleInitialContext({
        ...input,
        policy: { ...input.policy, policyDocument: { allowedProjectionTypes: ['REVIEWER'] } },
      }),
      'INVALID_POLICY_BINDING',
    );
  });

  it('maps a malformed request builderPolicyRef onto REFERENCE_INVALID', () => {
    const base = validInput();
    expectRejected(
      assembleInitialContext({
        ...base,
        request: { ...base.request, builderPolicyRef: asCanonical(null) },
      }),
      REFERENCE_INVALID,
    );
  });
});
