// IM-06 (#216) composition entry tests:
// `execution.build_initial_context_snapshot@1.1` and
// `execution.get_context_snapshot@1.0` through the trusted composition boundary.
//
// Recording in-memory connections stand in for PostgreSQL on all three owning
// schemas: every statement the command runner, the repositories, the
// IdentityPolicy ports and the RLS preambles issue is captured and answered
// with canned rows, so the suite exercises the real entry, the real
// IdentityPolicy sign/revalidate Ports, the real EnterpriseProject Slice read
// and the real TaskExecution handlers without a database. Source Slice and
// draft fixtures replicate the owning modules' published shapes
// (type-matched; no cross-module test imports).
//
// The harness clock is the real clock sampled once per harness: the generic
// `identity.authorize_command@1.0` Port timestamps its dependency Decisions
// with the process clock, so a fixed historical instant would make every
// freshly minted dependency Decision look expired to `identity.resolve_policy`.

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type Driver,
} from 'kysely';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  CAPTURE_POLICY_PROFILE_KEY,
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  createTaskExecutionContextSnapshotAuthorizationPort,
  type AuthorizationDecisionInsert,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
  type SelectedAuthorizationDecision,
} from '@zhiju/identity-policy';
import {
  BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
  CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  CONTEXT_SNAPSHOT_OBJECT_TYPE,
  CommandExecutionError,
  GET_CONTEXT_SNAPSHOT_QUERY,
  REFERENCE_INVALID,
  WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
  digestCanonicalPayload,
  type CommandResult,
  type TaskExecutionDb,
} from '@zhiju/task-execution';
import {
  createInitialContextEntry,
  type InitialContextEntry,
  type InitialContextSession,
} from './initial-context-entry.js';
import { CompositionBoundaryError } from './decision-boundary.js';
import { RESOLVE_POLICY_COMMAND, RESOLVE_POLICY_PURPOSE } from './context-source-slice-entry.js';

const ENT = '019945f7-1001-7000-8000-000000000001';
const PRJ = '019945f7-1002-7000-8000-000000000002';
const WO = '019945f7-1003-7000-8000-000000000003';
const TASK = '019945f7-1004-7000-8000-000000000004';
const DRAFT_SNAPSHOT = '019945f7-1005-7000-8000-000000000005';
const SLICE_A = '019945f7-1006-7000-8000-000000000006';
const SLICE_B = '019945f7-1007-7000-8000-000000000007';
const POLICY_OBJECT = '019945f7-1008-7000-8000-000000000008';
const POLICY_VERSION = '019945f7-1009-7000-8000-000000000009';
const CAPTURE_POLICY_OBJECT = '019945f7-100a-7000-8000-00000000000a';
const CAPTURE_POLICY_VERSION = '019945f7-100b-7000-8000-00000000000b';
const PROFILE_OBJECT = '019945f7-100c-7000-8000-00000000000c';
const PROFILE_SNAPSHOT = '019945f7-100d-7000-8000-00000000000d';
const QMS_OBJECT = '019945f7-100e-7000-8000-00000000000e';
const QMS_VERSION = '019945f7-100f-7000-8000-00000000000f';
const WO_SCHEMA_OBJECT = '019945f7-1010-7000-8000-000000000010';
const WO_SCHEMA_VERSION = '019945f7-1011-7000-8000-000000000011';
const FACT_A_OBJECT = '019945f7-1012-7000-8000-000000000012';
const FACT_A_VERSION = '019945f7-1013-7000-8000-000000000013';
const FACT_B_OBJECT = '019945f7-1014-7000-8000-000000000014';
const FACT_B_VERSION = '019945f7-1015-7000-8000-000000000015';
const COMMAND_ID = '019945f7-1016-7000-8000-000000000016';
const TARGET = '019945f7-1017-7000-8000-000000000017';
const PRINCIPAL = '019945f7-1018-7000-8000-000000000018';
const ACTOR_SNAPSHOT = '019945f7-1019-7000-8000-000000000019';
const POLICY_SNAPSHOT = '019945f7-101b-7000-8000-00000000001b';
const CORRELATION = '019945f7-101c-7000-8000-00000000001c';
const QUERY_ID = '019945f7-1020-7000-8000-000000000020';
const AUTH_CONTEXT_ID = '019945f7-1021-7000-8000-000000000021';
const BUILDER_POLICY_FACT = '019945f7-1022-7000-8000-000000000022';
const CAPTURE_POLICY_FACT = '019945f7-1023-7000-8000-000000000023';
const GRANT_ID = '019945f7-1024-7000-8000-000000000024';
const BOOTSTRAP_DECISION = '019945f7-1025-7000-8000-000000000025';
const SNAPSHOT_ID = '019945f7-1030-7000-8000-000000000030';
const PRODUCT_SCOPE_OBJECT = '019945f7-1031-7000-8000-000000000031';
const PRODUCT_SCOPE_SNAPSHOT = '019945f7-1032-7000-8000-000000000032';

const PURPOSE = 'document.write';
const LEGACY_SNAPSHOT_OBJECT_TYPE = 'zhiju.project.context_snapshot';
const POLICY_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

/** One capability code per trusted configuration slot, all distinct. */
const CAP_BUILD = 'execution.context.build.initial';
const CAP_READ = 'execution.context.snapshot.read';
const CAP_RESOLVE = 'identity.policy.resolve';
const CAP_SLICE = 'project.context_source.read';

const SESSION_HASH = Buffer.alloc(32, 0x5e);
const ACTOR_HASH = Buffer.alloc(32, 0xa1);

function rec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

function contentHashOf(hash: Buffer): Record<string, unknown> {
  return { algorithm: 'SHA-256', digest: hash.toString('hex'), canonicalizationVersion: '1' };
}

function factItem(objectId: string, versionId: string, status: string): Record<string, unknown> {
  return {
    factRef: {
      kind: 'VERSIONED',
      objectType: 'EnterpriseFact',
      objectId,
      versionId,
      scope: { enterpriseId: ENT },
    },
    factType: 'REGULATORY_OBLIGATION',
    riskLevel: 'LOW',
    status,
    value: {
      presence: 'REDACTED',
      reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED',
      evidenceRefs: [],
    },
  };
}

/**
 * The EnterpriseProject-published Slice shape, with the instants carrying the
 * millisecond suffix the owning read's `Date.toISOString()` comparison pins
 * and the capture Policy scoped to this Project, so the one Project-scoped
 * ActorSnapshot of this suite covers every owning read.
 */
function slicePayload(
  sliceId: string,
  capturedAt: string,
  validUntil: string,
  facts: Record<string, unknown>[],
  omissions: Record<string, unknown>[],
  sequence: number,
): Record<string, unknown> {
  const projectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: PRJ,
    scope: { enterpriseId: ENT, projectId: PRJ },
  };
  return {
    sliceId,
    scopeRef: { enterpriseId: ENT, projectId: PRJ },
    projectRef,
    purpose: PURPOSE,
    audience: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
    capturePolicyRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.identity.policy',
      objectId: CAPTURE_POLICY_OBJECT,
      versionId: CAPTURE_POLICY_VERSION,
      scope: { enterpriseId: ENT, projectId: PRJ },
    },
    capturedAt,
    validUntil,
    source: {
      projectRef,
      enterpriseProfileSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.project.enterprise_profile',
        objectId: PROFILE_OBJECT,
        snapshotId: PROFILE_SNAPSHOT,
        scope: { enterpriseId: ENT },
        contentHash: contentHashOf(Buffer.alloc(32, 0x31)),
      },
      qmsConfigurationRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.project.qms_configuration',
        objectId: QMS_OBJECT,
        versionId: QMS_VERSION,
        scope: { enterpriseId: ENT },
      },
      productScopeSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.project.product_scope',
        objectId: PRODUCT_SCOPE_OBJECT,
        snapshotId: PRODUCT_SCOPE_SNAPSHOT,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: contentHashOf(Buffer.alloc(32, 0x32)),
      },
      activeBaselineRefs: [],
      factItems: facts,
      omissions,
      redactions: [
        { path: '/factItems/*/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
      ],
      sourceWatermark: {
        sourceModule: 'enterprise_project',
        partition: PRJ,
        sequence,
        observedAt: capturedAt,
      },
    },
  };
}

const SLICE_A_PAYLOAD = slicePayload(
  SLICE_A,
  '2026-09-18T10:00:00.000Z',
  '2027-01-01T00:00:00.000Z',
  [factItem(FACT_A_OBJECT, FACT_A_VERSION, 'CONFIRMED')],
  [{ kind: 'PRODUCT_SCOPE', reasonCode: 'PURPOSE_FORBIDDEN' }],
  41,
);
const SLICE_B_PAYLOAD = slicePayload(
  SLICE_B,
  '2026-09-18T11:00:00.000Z',
  '2026-12-01T00:00:00.000Z',
  [factItem(FACT_B_OBJECT, FACT_B_VERSION, 'DISPUTED')],
  [],
  42,
);
const SLICE_A_HASH = digestCanonicalPayload(SLICE_A_PAYLOAD as CanonicalJsonObject).hash;
const SLICE_B_HASH = digestCanonicalPayload(SLICE_B_PAYLOAD as CanonicalJsonObject).hash;

/** The exact Slice content address the build request and the EP row share. */
function sliceRef(objectId: string, hash: Buffer): Record<string, unknown> {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.project.context_source_slice',
    objectId,
    scope: { enterpriseId: ENT, projectId: PRJ },
    contentHash: contentHashOf(hash),
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

/** The immutable WorkOrderDraftSnapshot payload the canned TE row stores. */
function draftPayload(): Record<string, unknown> {
  return {
    snapshotId: DRAFT_SNAPSHOT,
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
      inputRefs: [
        {
          inputRole: 'source.primary',
          ref: sliceRef(SLICE_A, SLICE_A_HASH),
          required: true,
          permittedUse: PURPOSE,
          contentAccessMode: 'REFERENCE_ONLY',
          integrityRequired: true,
        },
        {
          inputRole: 'source.secondary',
          ref: sliceRef(SLICE_B, SLICE_B_HASH),
          required: false,
          permittedUse: PURPOSE,
          contentAccessMode: 'REFERENCE_ONLY',
          integrityRequired: false,
          epistemicExpectation: 'DISPUTED',
        },
      ],
      targetScope: { targetObjectRefs: [] },
      versionPins: {
        contextBuilderPolicyRef: builderPolicyRef(),
        workOrderSchemaRef: {
          kind: 'VERSIONED',
          objectType: 'zhiju.contract.work_order_schema',
          objectId: WO_SCHEMA_OBJECT,
          versionId: WO_SCHEMA_VERSION,
          scope: { enterpriseId: ENT },
        },
      },
    },
    capturedAt: '2026-09-18T09:00:00.000Z',
    createdBy: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
  };
}

const DRAFT_PAYLOAD = draftPayload();
const DRAFT_HASH = digestCanonicalPayload(DRAFT_PAYLOAD as CanonicalJsonObject).hash;

/** The Policy Snapshot every covering Grant of this suite points at. */
const POLICY_SNAPSHOT_PAYLOAD = {
  policySetVersion: 'im06-static-v1',
  effectiveFrom: POLICY_EFFECTIVE_FROM.toISOString(),
  policySchemaRefs: [],
} as unknown as CanonicalJsonObject;
const POLICY_SNAPSHOT_DIGEST = digestCanonicalPayload(POLICY_SNAPSHOT_PAYLOAD);

function policySnapshotRow(): Record<string, unknown> {
  return {
    policy_snapshot_id: POLICY_SNAPSHOT,
    policy_set_version: 'im06-static-v1',
    policy_schema_refs: [],
    effective_from: POLICY_EFFECTIVE_FROM,
    superseded_at: null,
    payload_hash: POLICY_SNAPSHOT_DIGEST.hash,
    payload_hash_algorithm: POLICY_SNAPSHOT_DIGEST.hashAlgorithm,
    canonicalization_version: POLICY_SNAPSHOT_DIGEST.canonicalizationVersion,
    payload_size_bytes: String(POLICY_SNAPSHOT_DIGEST.sizeBytes),
    canonical_payload: POLICY_SNAPSHOT_PAYLOAD,
  };
}

/**
 * One integrity-valid Policy version row: the canonical payload digests to the
 * promoted hash columns, mirrors the promoted key/scope/set/refs/effectiveFrom
 * columns and declares its profile through the registered profile reference.
 */
function policyVersionRow(input: {
  readonly factId: string;
  readonly policyObjectId: string;
  readonly versionId: string;
  readonly profileKey: string;
  readonly policyDocument: CanonicalJsonObject;
}): Record<string, unknown> {
  const profileReference = registeredPolicyProfileReference(
    POLICY_PROFILE_REGISTRY_VERSION,
    input.profileKey,
  );
  if (profileReference === undefined) {
    throw new Error(`the policy profile ${input.profileKey} is not registered`);
  }
  const payload = {
    policyRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.identity.policy',
      objectId: input.policyObjectId,
      versionId: input.versionId,
      scope: { enterpriseId: ENT, projectId: PRJ },
    },
    policySetVersion: 'im06-static-v1',
    policySchemaRefs: [profileReference],
    policyDocument: input.policyDocument,
    effectiveFrom: POLICY_EFFECTIVE_FROM.toISOString(),
  } as unknown as CanonicalJsonObject;
  const digest = digestCanonicalPayload(payload);
  return {
    policy_version_fact_id: input.factId,
    policy_object_id: input.policyObjectId,
    policy_key_version_id: input.versionId,
    scope_kind: 'PROJECT',
    enterprise_id: ENT,
    project_id: PRJ,
    supersedes_object_id: null,
    supersedes_version_id: null,
    policy_set_version: 'im06-static-v1',
    policy_schema_refs: [profileReference],
    effective_from: POLICY_EFFECTIVE_FROM,
    contract_type: 'identity.PolicyVersion',
    contract_version: '1.0',
    schema_registry_version: POLICY_PROFILE_REGISTRY_VERSION,
    canonicalization_version: digest.canonicalizationVersion,
    payload_hash_algorithm: digest.hashAlgorithm,
    payload_hash: digest.hash,
    payload_size_bytes: String(digest.sizeBytes),
    canonical_payload: payload,
  };
}

const BUILDER_POLICY_ROW = policyVersionRow({
  factId: BUILDER_POLICY_FACT,
  policyObjectId: POLICY_OBJECT,
  versionId: POLICY_VERSION,
  profileKey: CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
});
const CAPTURE_POLICY_ROW = policyVersionRow({
  factId: CAPTURE_POLICY_FACT,
  policyObjectId: CAPTURE_POLICY_OBJECT,
  versionId: CAPTURE_POLICY_VERSION,
  profileKey: CAPTURE_POLICY_PROFILE_KEY,
  policyDocument: { maxSliceValiditySeconds: 7_776_000, allowedPurposeCodes: [PURPOSE] },
});

/** The canned EP row of one committed Slice, keyed by its content address. */
function sliceRow(
  sliceId: string,
  payload: Record<string, unknown>,
  hash: Buffer,
): Record<string, unknown> {
  return {
    slice_id: sliceId,
    enterprise_id: ENT,
    project_id: PRJ,
    purpose: PURPOSE,
    captured_at: new Date(payload.capturedAt as string),
    valid_until: new Date(payload.validUntil as string),
    slice_payload: payload,
    slice_payload_hash: hash,
    policy_content_hash: CAPTURE_POLICY_ROW.payload_hash,
  };
}

const SLICE_A_ROW = sliceRow(SLICE_A, SLICE_A_PAYLOAD, SLICE_A_HASH);
const SLICE_B_ROW = sliceRow(SLICE_B, SLICE_B_PAYLOAD, SLICE_B_HASH);

interface GrantOverrides {
  readonly capabilityCode: string;
  readonly actions?: readonly string[];
  readonly selectors?: readonly unknown[];
}

/** One active Project-scoped capability Grant row, as the owning read returns it. */
function grantRow(input: GrantOverrides): Record<string, unknown> {
  return {
    id: GRANT_ID,
    principal_id: PRINCIPAL,
    capability_code: input.capabilityCode,
    scope_kind: 'PROJECT',
    enterprise_id: ENT,
    project_id: PRJ,
    resource_selectors: input.selectors ?? [],
    actions: input.actions ?? [],
    constraints: {},
    valid_from: POLICY_EFFECTIVE_FROM,
    valid_to: null,
    max_uses: null,
    grant_policy_snapshot_id: POLICY_SNAPSHOT,
    grant_policy_snapshot_hash: POLICY_SNAPSHOT_DIGEST.hash,
    status: 'ACTIVE',
  };
}

/** The Grant covering the build entry of the pre-allocated Snapshot identity. */
function buildGrant(): Record<string, unknown> {
  return grantRow({
    capabilityCode: CAP_BUILD,
    actions: ['execution.context.build.initial.v1_1'],
    selectors: [
      { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.context_snapshot' },
    ],
  });
}

/** The Grant covering the read entry of one accepted Snapshot spelling. */
function snapshotReadGrant(objectType: string): Record<string, unknown> {
  return grantRow({
    capabilityCode: CAP_READ,
    actions: ['execution.context.snapshot.read'],
    selectors: [{ selectorType: 'TARGET_TYPE', objectType }],
  });
}

/** The Grant covering the owning `identity.resolve_policy@1.0` read. */
function resolveGrant(): Record<string, unknown> {
  return grantRow({ capabilityCode: CAP_RESOLVE });
}

/** The Grant covering the owning `project.get_context_source_slice@1.0` read. */
function sliceGrant(): Record<string, unknown> {
  return grantRow({ capabilityCode: CAP_SLICE });
}

/**
 * The exact row the owning repository would have stored for one Decision: the
 * promoted columns plus the canonical payload the Port asked it to write.
 * Transcribed from the IdentityPolicy suite of this same Port family.
 */
function decisionRow(insert: AuthorizationDecisionInsert): SelectedAuthorizationDecision {
  const mirrors: CanonicalJsonObject = {
    authorizationDecisionId: insert.authorizationDecisionId,
    actorSnapshotId: insert.actorSnapshotId,
    actorSnapshotPayloadHash: insert.actorSnapshotPayloadHash.toString('hex'),
    principalId: insert.principalId,
    principalKind: insert.principalKind,
    outcome: insert.outcome,
    reasonCodes: [...insert.reasonCodes],
    commandType: insert.commandType,
    commandVersion: insert.commandVersion,
    scopeKind: insert.scopeKind,
    enterpriseId: insert.enterpriseId,
    purpose: insert.purpose,
    requestedCapability: insert.requestedCapability,
    commandPayloadHash: insert.commandPayloadHash.toString('hex'),
    policySnapshotId: insert.policySnapshotId,
    policySnapshotPayloadHash: insert.policySnapshotPayloadHash.toString('hex'),
    authenticationContextHash: insert.authenticationContextHash.toString('hex'),
    expiresAt: insert.expiresAt.toISOString(),
    ...(insert.projectId === undefined ? {} : { projectId: insert.projectId }),
  };
  const payload: CanonicalJsonObject = { ...insert.decisionPayload, ...mirrors };
  const digest = digestCanonicalPayload(payload);
  return {
    authorization_decision_id: insert.authorizationDecisionId,
    actor_snapshot_id: insert.actorSnapshotId,
    actor_snapshot_payload_hash: insert.actorSnapshotPayloadHash,
    principal_id: insert.principalId,
    principal_kind: insert.principalKind,
    outcome: insert.outcome,
    reason_codes: insert.reasonCodes,
    command_type: insert.commandType,
    command_version: insert.commandVersion,
    scope_kind: insert.scopeKind,
    enterprise_id: insert.enterpriseId,
    project_id: insert.projectId ?? null,
    purpose: insert.purpose,
    requested_capability: insert.requestedCapability,
    command_payload_hash: insert.commandPayloadHash,
    policy_snapshot_id: insert.policySnapshotId,
    policy_snapshot_payload_hash: insert.policySnapshotPayloadHash,
    authentication_context_hash: insert.authenticationContextHash,
    expires_at: insert.expiresAt,
    target_object_type: insert.targetRef?.objectType ?? null,
    target_object_id: insert.targetRef?.objectId ?? null,
    contract_type: 'identity.AuthorizationDecision',
    contract_version: insert.contractVersion,
    canonicalization_version: digest.canonicalizationVersion,
    payload_hash_algorithm: digest.hashAlgorithm,
    payload_hash: digest.hash,
    payload_size_bytes: String(digest.sizeBytes),
    canonical_payload: payload,
    created_at: POLICY_EFFECTIVE_FROM,
    created_by_principal_id: insert.createdByPrincipalId,
    source_command_id: insert.sourceCommandId,
    retention_class: 'REGULATED_AUDIT',
  };
}

/** The ActorSnapshot reference the session and every Envelope present. */
function actorSnapshotRef(): Record<string, unknown> {
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: ACTOR_SNAPSHOT,
    snapshotId: ACTOR_SNAPSHOT,
    scope: { enterpriseId: ENT, projectId: PRJ },
    contentHash: contentHashOf(ACTOR_HASH),
  };
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7a)).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed');
      },
      decryptField() {
        throw new Error('not needed');
      },
    },
  };
}

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function recordingDb<T>(
  queries: RecordedQuery[],
  answer: (sql: string, parameters: readonly unknown[]) => unknown[],
): Kysely<T> {
  const connection = {
    executeQuery: (compiledQuery: CompiledQuery) => {
      queries.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
      return Promise.resolve({ rows: answer(compiledQuery.sql, compiledQuery.parameters) });
    },
    streamQuery: () => {
      throw new Error('this suite never streams');
    },
  };
  return new Kysely<T>({
    dialect: {
      createDriver: () =>
        ({
          init: () => Promise.resolve(),
          acquireConnection: () => Promise.resolve(connection),
          beginTransaction: () => Promise.resolve(),
          commitTransaction: () => Promise.resolve(),
          rollbackTransaction: () => Promise.resolve(),
          releaseConnection: () => Promise.resolve(),
          destroy: () => Promise.resolve(),
        }) as unknown as Driver,
      createAdapter: () => new PostgresAdapter(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    },
  });
}

/**
 * One in-memory composition state: the presented Decisions the real
 * IdentityPolicy Port signs, the covering Grants, the canned owning rows of
 * all three schemas and every statement each side executed.
 */
class CompositionHarness {
  /** Trusted clock: the real instant this harness was created at. */
  readonly now = new Date();
  readonly teQueries: RecordedQuery[] = [];
  readonly epQueries: RecordedQuery[] = [];
  readonly identityQueries: RecordedQuery[] = [];
  /** Every Decision the IdentityPolicy ports asked the owning repository to insert. */
  readonly decisionInserts: AuthorizationDecisionInsert[] = [];
  private readonly decisionRows = new Map<string, SelectedAuthorizationDecision>();
  grants: Record<string, unknown>[] = [
    buildGrant(),
    snapshotReadGrant(CONTEXT_SNAPSHOT_OBJECT_TYPE),
    resolveGrant(),
    sliceGrant(),
  ];
  draftRow: Record<string, unknown> | undefined = {
    snapshot_id: DRAFT_SNAPSHOT,
    work_order_id: WO,
    enterprise_id: ENT,
    project_id: PRJ,
    payload_hash: DRAFT_HASH,
    canonical_payload: DRAFT_PAYLOAD,
  };
  rootRow: Record<string, unknown> | undefined = {
    work_order_id: WO,
    enterprise_id: ENT,
    project_id: PRJ,
    work_order_object_type: 'zhiju.execution.work_order',
    task_id: TASK,
    task_object_type: 'zhiju.execution.task',
    status: 'DRAFT',
    aggregate_version: '1',
    current_draft_snapshot_id: DRAFT_SNAPSHOT,
    current_draft_snapshot_hash: DRAFT_HASH,
    draft_schema_version: '1.1',
    expires_at: null,
  };
  /** The committed Snapshot row the read path returns, once captured. */
  snapshotRow: Record<string, unknown> | undefined;
  principalStatus: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';

  readonly taskExecutionDb = recordingDb<TaskExecutionDb>(this.teQueries, (sql, parameters) =>
    this.answerTaskExecution(sql, parameters),
  );
  readonly enterpriseProjectDb = recordingDb<EnterpriseProjectDb>(
    this.epQueries,
    (sql, parameters) => this.answerEnterpriseProject(sql, parameters),
  );
  readonly identityDb = recordingDb<IdentityPolicyDb>(this.identityQueries, (sql, parameters) =>
    this.answerIdentity(sql, parameters),
  );
  readonly repo = this.repository();

  private answerTaskExecution(sql: string, parameters: readonly unknown[]): unknown[] {
    if (sql.startsWith('SET LOCAL ROLE')) return [];
    if (sql.includes('establish_transaction_context')) return [];
    if (sql.includes('context_principal_id()')) return [{ principal_id: PRINCIPAL }];
    if (sql.includes('context_enterprise_id()')) return [{ enterprise_id: ENT }];
    if (sql.includes('context_allows_enterprise')) return [{ allows: true }];
    if (sql.includes('context_allows_project')) return [{ allows: true }];
    if (sql.startsWith('insert into "task_execution"."command_receipt"')) {
      return [{ command_id: COMMAND_ID }];
    }
    if (sql.startsWith('select') && sql.includes('"task_execution"."command_receipt"')) return [];
    if (sql.includes('"task_execution"."work_order_draft_snapshot"')) {
      return this.draftRow === undefined ? [] : [this.draftRow];
    }
    if (sql.includes('"task_execution"."work_order"')) {
      return this.rootRow === undefined ? [] : [this.rootRow];
    }
    // The build table name shares the Snapshot table prefix; dispatch it first.
    if (sql.startsWith('insert into "task_execution"."context_snapshot_build"')) return [];
    if (sql.startsWith('insert into "task_execution"."context_snapshot"')) {
      return [{ snapshot_id: parameters[0] }];
    }
    if (sql.startsWith('select') && sql.includes('"task_execution"."context_snapshot"')) {
      return this.snapshotRow === undefined ? [] : [this.snapshotRow];
    }
    return [];
  }

  private answerEnterpriseProject(sql: string, parameters: readonly unknown[]): unknown[] {
    if (sql.startsWith('SET LOCAL ROLE')) return [];
    if (sql.includes('establish_transaction_context')) return [];
    if (sql.includes('"enterprise_project"."context_source_slice"')) {
      if (parameters[0] === SLICE_A) return [SLICE_A_ROW];
      if (parameters[0] === SLICE_B) return [SLICE_B_ROW];
      return [];
    }
    return [];
  }

  private answerIdentity(sql: string, parameters: readonly unknown[]): unknown[] {
    if (sql.startsWith('SET LOCAL ROLE')) return [];
    if (sql.includes('establish_transaction_context')) return [];
    if (sql.startsWith('select') && sql.includes('"identity_policy"."authorization_decision"')) {
      // The post-insert hash re-read of the Decision the Port just wrote.
      const row = this.decisionRows.get(parameters[0] as string);
      return row === undefined
        ? []
        : [
            {
              authorization_decision_id: row.authorization_decision_id,
              payload_hash: row.payload_hash,
            },
          ];
    }
    return [];
  }

  private repository(): IdentityPolicyRepository {
    const actorRow = {
      actor_snapshot_id: ACTOR_SNAPSHOT,
      principal_id: PRINCIPAL,
      principal_kind: 'SERVICE',
      scope_kind: 'PROJECT',
      authentication_context_hash: SESSION_HASH,
      enterprise_id: ENT,
      project_id: PRJ,
      payload_hash: ACTOR_HASH,
    };
    const policySnapshot = policySnapshotRow();
    return {
      getActorSnapshotByIdAndHash: (_trx: unknown, id: string, expectedHash: Buffer) =>
        Promise.resolve(
          id === ACTOR_SNAPSHOT
            ? { row: actorRow, hashMatched: ACTOR_HASH.equals(expectedHash) }
            : undefined,
        ),
      getPrincipalById: () =>
        Promise.resolve({ principal_kind: 'SERVICE', status: this.principalStatus }),
      listActiveCapabilityGrants: (_trx: unknown, principalId: string, enterpriseId: string) =>
        Promise.resolve(
          this.grants.filter(
            (grant) => grant.principal_id === principalId && grant.enterprise_id === enterpriseId,
          ),
        ),
      getPolicySnapshotById: (_trx: unknown, id: string) =>
        Promise.resolve(id === POLICY_SNAPSHOT ? policySnapshot : undefined),
      getPolicySnapshotByIdAndHash: (_trx: unknown, id: string, expectedHash: Buffer) =>
        Promise.resolve(
          id === POLICY_SNAPSHOT
            ? {
                row: policySnapshot,
                hashMatched: (policySnapshot.payload_hash as Buffer).equals(expectedHash),
              }
            : undefined,
        ),
      getAuthorizationDecisionByIdAndHash: (_trx: unknown, id: string, expectedHash: Buffer) => {
        const row = this.decisionRows.get(id);
        return Promise.resolve(
          row === undefined
            ? undefined
            : { row, hashMatched: row.payload_hash.equals(expectedHash) },
        );
      },
      insertAuthorizationDecision: (_trx: unknown, insert: AuthorizationDecisionInsert) => {
        this.decisionInserts.push(insert);
        this.decisionRows.set(insert.authorizationDecisionId, decisionRow(insert));
        return Promise.resolve();
      },
      getPolicyVersionByKey: (_trx: unknown, key: { readonly policyObjectId: string }) =>
        Promise.resolve(
          key.policyObjectId === POLICY_OBJECT
            ? BUILDER_POLICY_ROW
            : key.policyObjectId === CAPTURE_POLICY_OBJECT
              ? CAPTURE_POLICY_ROW
              : undefined,
        ),
      getPolicyVersionSuccessor: () => Promise.resolve(undefined),
    } as unknown as IdentityPolicyRepository;
  }

  /** The trusted bootstrap context the signing Port runs under. */
  private signingDeps(): IdentityCommandDeps {
    const context: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: PRINCIPAL,
      actorSnapshotId: ACTOR_SNAPSHOT,
      authorizationDecisionId: BOOTSTRAP_DECISION,
      authorizationDecisionHash: Buffer.alloc(32, 0),
      authorizationDecisionExpiresAt: new Date(this.now.getTime() + 60_000),
      enterpriseId: ENT,
      allowedProjectIds: [PRJ],
      correlationId: CORRELATION,
    };
    return { db: this.identityDb, repo: this.repo, crypto: testCrypto(), context };
  }

  /**
   * Signs one Decision through the real IdentityPolicy Context Snapshot Port,
   * so the presented Decision of a test is exactly what production would mint.
   */
  async sign(input: {
    readonly commandType: string;
    readonly commandVersion: string;
    readonly targetRef: Common.ObjectRef;
    readonly payload: CanonicalJsonObject;
  }): Promise<Common.ContentAddressedRef> {
    const port = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: { contextSnapshotBuildV11: CAP_BUILD, contextSnapshotRead: CAP_READ },
      now: () => this.now,
    });
    const view = await port.authorizeContextSnapshot(this.signingDeps(), {
      actorSnapshotRef: actorSnapshotRef() as unknown as Common.SnapshotRef,
      commandType: input.commandType,
      commandVersion: input.commandVersion,
      targetRef: input.targetRef,
      commandPayloadHash: digestCanonicalPayload(input.payload).hash,
      authenticationContextHash: SESSION_HASH,
    });
    const reference = view.authorizationDecisionRef;
    if (view.outcome !== 'ALLOW' || reference === undefined) {
      throw new Error('the harness signing was denied; check the covering Grant');
    }
    return reference;
  }

  entry(now: () => Date = () => this.now): InitialContextEntry {
    return createInitialContextEntry({
      taskExecutionDb: this.taskExecutionDb,
      enterpriseProjectDb: this.enterpriseProjectDb,
      identity: { db: this.identityDb, repo: this.repo, crypto: testCrypto() },
      capabilityCodes: { contextSnapshotBuildV11: CAP_BUILD, contextSnapshotRead: CAP_READ },
      capabilities: { resolvePolicy: CAP_RESOLVE, readContextSourceSlice: CAP_SLICE },
      now,
    });
  }

  session(): InitialContextSession {
    return {
      authenticationContextHash: SESSION_HASH,
      resolutionActorSnapshotRef: actorSnapshotRef() as unknown as Common.SnapshotRef,
    };
  }

  /** The registered `...@1.1` build payload naming the canned draft and Slices. */
  buildPayload(): CanonicalJsonObject {
    return {
      request: {
        draftSnapshotRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
          objectId: DRAFT_SNAPSHOT,
          scope: { enterpriseId: ENT, projectId: PRJ },
          contentHash: contentHashOf(DRAFT_HASH),
        },
        projectionType: 'DOCUMENT_WRITER',
        purpose: PURPOSE,
        audience: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
        sourceSlices: [sliceRef(SLICE_A, SLICE_A_HASH), sliceRef(SLICE_B, SLICE_B_HASH)],
        builderPolicyRef: builderPolicyRef(),
      },
    } as unknown as CanonicalJsonObject;
  }

  buildTargetRef(): Record<string, unknown> {
    return {
      kind: 'OBJECT',
      objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
      objectId: TARGET,
      scope: { enterpriseId: ENT, projectId: PRJ },
    };
  }

  buildEnvelope(
    payload: CanonicalJsonObject,
    decisionRef: unknown,
    patch?: Record<string, unknown>,
  ): Record<string, unknown> {
    const digest = digestCanonicalPayload(payload);
    return {
      commandId: COMMAND_ID,
      commandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
      commandVersion: '1.1',
      scopeRef: { enterpriseId: ENT, projectId: PRJ },
      targetRef: this.buildTargetRef(),
      actor: actorSnapshotRef(),
      authorizationDecisionRef: decisionRef,
      idempotencyKey: 'idem-initial-context-1',
      correlationId: CORRELATION,
      requestedAt: this.now.toISOString(),
      payload,
      integrity: { canonicalizationVersion: '1', payloadHash: contentHashOf(digest.hash) },
      ...patch,
    };
  }

  readEnvelope(
    payload: CanonicalJsonObject,
    decisionRef: unknown,
    patch?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      queryId: QUERY_ID,
      queryType: GET_CONTEXT_SNAPSHOT_QUERY,
      queryVersion: '1.0',
      scopeRef: { enterpriseId: ENT, projectId: PRJ },
      requester: {
        kind: 'OBJECT',
        objectType: 'zhiju.identity.principal',
        objectId: PRINCIPAL,
        scope: { enterpriseId: ENT, projectId: PRJ },
      },
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.authentication_context',
        objectId: AUTH_CONTEXT_ID,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: contentHashOf(SESSION_HASH),
      },
      authorizationDecisionRef: decisionRef,
      consistencyRequirement: 'AUTHORITATIVE',
      correlationId: CORRELATION,
      requestedAt: this.now.toISOString(),
      payload,
      ...patch,
    };
  }

  /** Signs the default build request and returns the presentable pair. */
  async signedBuild(): Promise<{
    readonly payload: CanonicalJsonObject;
    readonly decisionRef: Common.ContentAddressedRef;
  }> {
    const payload = this.buildPayload();
    const decisionRef = await this.sign({
      commandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
      commandVersion: '1.1',
      targetRef: this.buildTargetRef() as unknown as Common.ObjectRef,
      payload,
    });
    return { payload, decisionRef };
  }

  /**
   * Reconstructs the committed Snapshot row from the recorded insert, so the
   * read path returns exactly what the owning build wrote.
   */
  captureSnapshotRow(): void {
    const insert = this.teQueries.find((query) =>
      query.sql.startsWith('insert into "task_execution"."context_snapshot"'),
    );
    const columns =
      insert === undefined
        ? undefined
        : /^insert into "task_execution"\."context_snapshot" \(([^)]+)\)/u.exec(insert.sql)?.[1];
    if (insert === undefined || columns === undefined) {
      throw new Error('no context_snapshot insert was recorded');
    }
    const row: Record<string, unknown> = {};
    columns.split(', ').forEach((name, index) => {
      row[name.replaceAll('"', '')] = insert.parameters[index];
    });
    // The insert stringifies the payload for the jsonb column; the pg driver
    // returns jsonb parsed, so the served row must be parsed back.
    if (typeof row.canonical_payload === 'string') {
      row.canonical_payload = JSON.parse(row.canonical_payload);
    }
    this.snapshotRow = row;
  }
}

async function expectBoundaryError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CompositionBoundaryError);
    expect((error as CompositionBoundaryError).code).toBe(code);
    return;
  }
  throw new Error(`expected CompositionBoundaryError(${code})`);
}

async function expectCommandError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandExecutionError);
    expect((error as CommandExecutionError).code).toBe(code);
    return;
  }
  throw new Error(`expected CommandExecutionError(${code})`);
}

function expectRejected(result: CommandResult, errorCode: string): void {
  if (result.status !== 'REJECTED') {
    throw new Error(`expected REJECTED(${errorCode}), got ${result.status}`);
  }
  expect(result.errorCode).toBe(errorCode);
}

describe('initial context entry: build (§19)', () => {
  it('commits the Snapshot with fresh per-call dependency Decisions for the Policy resolution and each Slice read', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    const result = await harness
      .entry()
      .build(harness.buildEnvelope(payload, decisionRef), harness.session());
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${result.status}`);
    }
    const snapshotRef = rec(rec(result.resultPayload.data).contextSnapshotRef);
    expect(snapshotRef.objectType).toBe(CONTEXT_SNAPSHOT_OBJECT_TYPE);
    expect(snapshotRef.objectId).toBe(TARGET);

    const inserts = (table: string): RecordedQuery[] =>
      harness.teQueries.filter(
        (query) =>
          query.sql.startsWith('insert into') && query.sql.includes(`"task_execution"."${table}"`),
      );
    expect(inserts('context_snapshot')).toHaveLength(1);
    expect(inserts('context_snapshot_build')).toHaveLength(1);
    expect(inserts('command_receipt')).toHaveLength(1);
    const outbox = inserts('outbox_event');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.parameters[1]).toBe('execution.ContextSnapshotBuilt');

    // Each owning read carried its own freshly minted Decision: one builder
    // Policy resolution, two Slice dereferences and one capture-Policy
    // resolution per Slice read; none of them is the presented build Decision.
    const presentedId = rec(decisionRef).objectId;
    const resolveDecisions = harness.decisionInserts.filter(
      (decision) => decision.commandType === RESOLVE_POLICY_COMMAND,
    );
    const sliceDecisions = harness.decisionInserts.filter(
      (decision) => decision.commandType === GET_CONTEXT_SOURCE_SLICE_QUERY,
    );
    expect(resolveDecisions).toHaveLength(3);
    expect(sliceDecisions).toHaveLength(2);
    expect(
      resolveDecisions.every(
        (decision) =>
          decision.purpose === RESOLVE_POLICY_PURPOSE &&
          decision.requestedCapability === CAP_RESOLVE,
      ),
    ).toBe(true);
    expect(
      sliceDecisions.every(
        (decision) =>
          decision.purpose === GET_CONTEXT_SOURCE_SLICE_PURPOSE &&
          decision.requestedCapability === CAP_SLICE,
      ),
    ).toBe(true);
    expect(
      [...resolveDecisions, ...sliceDecisions].every(
        (decision) => decision.authorizationDecisionId !== presentedId,
      ),
    ).toBe(true);
  });

  it('refuses the registered-but-unroutable @1.0 build before any Receipt, fact or Decision read', async () => {
    const harness = new CompositionHarness();
    const envelope = harness.buildEnvelope(
      harness.buildPayload(),
      {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'identity.authorization_decision',
        objectId: BOOTSTRAP_DECISION,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: contentHashOf(Buffer.alloc(32, 1)),
      },
      { commandVersion: '1.0' },
    );
    await expectBoundaryError(
      harness.entry().build(envelope, harness.session()),
      API_CONTRACT_TYPE_UNKNOWN,
    );
    expect(harness.teQueries).toHaveLength(0);
    expect(harness.epQueries).toHaveLength(0);
    expect(harness.identityQueries).toHaveLength(0);
  });

  it('refuses an expired presented Decision as AUTHORIZATION_EXPIRED', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    const later = (): Date => new Date(harness.now.getTime() + 301_000);
    await expectBoundaryError(
      harness.entry(later).build(harness.buildEnvelope(payload, decisionRef), harness.session()),
      AUTHORIZATION_EXPIRED,
    );
  });

  it('refuses a revoked covering Grant as AUTHORIZATION_REVOKED', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    harness.grants = [resolveGrant(), sliceGrant()];
    await expectBoundaryError(
      harness.entry().build(harness.buildEnvelope(payload, decisionRef), harness.session()),
      AUTHORIZATION_REVOKED,
    );
  });

  it('refuses a Decision signed for the read entry as AUTHORIZATION_DECISION_INVALID', async () => {
    const harness = new CompositionHarness();
    const payload = harness.buildPayload();
    const readDecision = await harness.sign({
      commandType: GET_CONTEXT_SNAPSHOT_QUERY,
      commandVersion: '1.0',
      targetRef: harness.buildTargetRef() as unknown as Common.ObjectRef,
      payload,
    });
    await expectBoundaryError(
      harness.entry().build(harness.buildEnvelope(payload, readDecision), harness.session()),
      AUTHORIZATION_DECISION_INVALID,
    );
  });

  it('refuses a tampered Decision reference hash as AUTHORIZATION_DECISION_INVALID', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    const tampered = {
      ...(decisionRef as unknown as Record<string, unknown>),
      contentHash: contentHashOf(Buffer.alloc(32, 0xff)),
    };
    await expectBoundaryError(
      harness.entry().build(harness.buildEnvelope(payload, tampered), harness.session()),
      AUTHORIZATION_DECISION_INVALID,
    );
  });

  it('fails closed as DEPENDENCY_UNAVAILABLE when the Policy resolution entry is not authorized', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    harness.grants = [buildGrant(), snapshotReadGrant(CONTEXT_SNAPSHOT_OBJECT_TYPE), sliceGrant()];
    await expectCommandError(
      harness.entry().build(harness.buildEnvelope(payload, decisionRef), harness.session()),
      DEPENDENCY_UNAVAILABLE,
    );
  });

  it('fails closed as DEPENDENCY_UNAVAILABLE when the Slice read entry is not authorized', async () => {
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    harness.grants = [
      buildGrant(),
      snapshotReadGrant(CONTEXT_SNAPSHOT_OBJECT_TYPE),
      resolveGrant(),
    ];
    await expectCommandError(
      harness.entry().build(harness.buildEnvelope(payload, decisionRef), harness.session()),
      DEPENDENCY_UNAVAILABLE,
    );
  });

  it('passes the owning handler draft-dependency rejection through as REFERENCE_INVALID', async () => {
    // The exact DRAFT dependency read lives inside the owning TaskExecution
    // transaction (the composition layer cannot name the WorkOrder target of
    // workOrderDraftReadV11 from the snapshot id the payload carries), so a
    // draft miss is the owning handler's business rejection, not a boundary
    // failure — and it happens before any dependency Decision is minted.
    const harness = new CompositionHarness();
    const { payload, decisionRef } = await harness.signedBuild();
    harness.draftRow = undefined;
    expectRejected(
      await harness.entry().build(harness.buildEnvelope(payload, decisionRef), harness.session()),
      REFERENCE_INVALID,
    );
    expect(harness.decisionInserts).toHaveLength(1);
  });
});

describe('initial context entry: read (§19.2)', () => {
  /** Builds one Snapshot for real and returns its committed reference. */
  async function committedSnapshot(harness: CompositionHarness): Promise<Record<string, unknown>> {
    const { payload, decisionRef } = await harness.signedBuild();
    const built = await harness
      .entry()
      .build(harness.buildEnvelope(payload, decisionRef), harness.session());
    if (built.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${built.status}`);
    }
    harness.captureSnapshotRow();
    return rec(rec(built.resultPayload.data).contextSnapshotRef);
  }

  async function signedRead(
    harness: CompositionHarness,
    snapshotRef: Record<string, unknown>,
  ): Promise<{
    readonly payload: CanonicalJsonObject;
    readonly decisionRef: Common.ContentAddressedRef;
  }> {
    const payload = { contextSnapshotRef: snapshotRef } as unknown as CanonicalJsonObject;
    const decisionRef = await harness.sign({
      commandType: GET_CONTEXT_SNAPSHOT_QUERY,
      commandVersion: '1.0',
      targetRef: {
        kind: 'OBJECT',
        objectType: snapshotRef.objectType as string,
        objectId: snapshotRef.objectId as string,
        scope: { enterpriseId: ENT, projectId: PRJ },
      },
      payload,
    });
    return { payload, decisionRef };
  }

  it('returns the committed Snapshot for the canonical spelling', async () => {
    const harness = new CompositionHarness();
    const snapshotRef = await committedSnapshot(harness);
    const { payload, decisionRef } = await signedRead(harness, snapshotRef);
    const result = await harness
      .entry()
      .read(harness.readEnvelope(payload, decisionRef), harness.session());
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${JSON.stringify(result)}`);
    }
    expect(rec(result.resultPayload).contextSnapshotRef).toEqual(snapshotRef);
    expect(rec(rec(result.resultPayload).contractRef).objectType).toBe(
      'zhiju.contract.project_context',
    );
    expect(result.resultPayloadHash.toString('hex')).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects the Core v1.0 historical spelling as REFERENCE_INVALID after authorizing it', async () => {
    // The two spellings are not aliases: the IdentityPolicy binding accepts
    // the legacy identity (the Decision signs and revalidates for it), and the
    // owning handler refuses it, because this store holds only canonical rows.
    const harness = new CompositionHarness();
    harness.grants = [buildGrant(), snapshotReadGrant(LEGACY_SNAPSHOT_OBJECT_TYPE)];
    const legacyRef = {
      kind: 'SNAPSHOT',
      objectType: LEGACY_SNAPSHOT_OBJECT_TYPE,
      objectId: TARGET,
      snapshotId: SNAPSHOT_ID,
      scope: { enterpriseId: ENT, projectId: PRJ },
      contentHash: contentHashOf(Buffer.alloc(32, 0xc1)),
    };
    const { payload, decisionRef } = await signedRead(harness, legacyRef);
    expectRejected(
      await harness.entry().read(harness.readEnvelope(payload, decisionRef), harness.session()),
      REFERENCE_INVALID,
    );
  });

  it('refuses a revoked read Grant as AUTHORIZATION_REVOKED', async () => {
    const harness = new CompositionHarness();
    const snapshotRef = await committedSnapshot(harness);
    const { payload, decisionRef } = await signedRead(harness, snapshotRef);
    harness.grants = [buildGrant(), resolveGrant(), sliceGrant()];
    await expectBoundaryError(
      harness.entry().read(harness.readEnvelope(payload, decisionRef), harness.session()),
      AUTHORIZATION_REVOKED,
    );
  });

  it('refuses an expired read Decision as AUTHORIZATION_EXPIRED', async () => {
    const harness = new CompositionHarness();
    const snapshotRef = await committedSnapshot(harness);
    const { payload, decisionRef } = await signedRead(harness, snapshotRef);
    const later = (): Date => new Date(harness.now.getTime() + 301_000);
    await expectBoundaryError(
      harness.entry(later).read(harness.readEnvelope(payload, decisionRef), harness.session()),
      AUTHORIZATION_EXPIRED,
    );
  });

  it('refuses a Decision signed for the build entry as AUTHORIZATION_DECISION_INVALID', async () => {
    const harness = new CompositionHarness();
    const snapshotRef = await committedSnapshot(harness);
    const payload = { contextSnapshotRef: snapshotRef } as unknown as CanonicalJsonObject;
    const buildDecision = await harness.sign({
      commandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
      commandVersion: '1.1',
      targetRef: {
        kind: 'OBJECT',
        objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
        objectId: TARGET,
        scope: { enterpriseId: ENT, projectId: PRJ },
      },
      payload,
    });
    await expectBoundaryError(
      harness.entry().read(harness.readEnvelope(payload, buildDecision), harness.session()),
      AUTHORIZATION_DECISION_INVALID,
    );
  });

  it('refuses the unregistered @1.1 read before any Decision read', async () => {
    const harness = new CompositionHarness();
    const envelope = harness.readEnvelope(
      {
        contextSnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
          objectId: TARGET,
          snapshotId: SNAPSHOT_ID,
          scope: { enterpriseId: ENT, projectId: PRJ },
          contentHash: contentHashOf(Buffer.alloc(32, 0xc2)),
        },
      } as unknown as CanonicalJsonObject,
      {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'identity.authorization_decision',
        objectId: BOOTSTRAP_DECISION,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: contentHashOf(Buffer.alloc(32, 1)),
      },
      { queryVersion: '1.1' },
    );
    await expectBoundaryError(
      harness.entry().read(envelope, harness.session()),
      API_CONTRACT_TYPE_UNKNOWN,
    );
    expect(harness.teQueries).toHaveLength(0);
    expect(harness.epQueries).toHaveLength(0);
    expect(harness.identityQueries).toHaveLength(0);
  });
});
