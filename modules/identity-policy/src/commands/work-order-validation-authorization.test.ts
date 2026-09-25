import { describe, expect, it } from 'vitest';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type Driver,
} from 'kysely';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';

import {
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  type IdentityCommandDeps,
} from './actor-snapshot.js';
import {
  digestCanonicalPayload,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
  type SelectedAuthorizationDecision,
  type SelectedCapabilityGrant,
  type SelectedPolicySnapshot,
} from '../persistence/identity-db.js';
import type {
  AuthorizationDecisionInsert,
  IdentityPolicyRepository,
} from '../persistence/identity-policy-repository.js';
import { TASK_EXECUTION_READINESS_BINDINGS } from './task-execution-readiness-authorization.js';
import {
  WORK_ORDER_DRAFT_READ_BINDINGS,
  WORK_ORDER_DRAFT_READ_PURPOSE,
} from './work-order-draft-read-authorization.js';
import { TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS } from './context-snapshot-authorization.js';
import { CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS } from './context-snapshot-draft-read-authorization.js';
import {
  CONTROLLED_FIRST_RUN_BINDINGS,
  createWorkOrderValidationAuthorizationPort,
  IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
  WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
  WORK_ORDER_CONTRACT_READ_PURPOSE,
  WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
  WORK_ORDER_FREEZE_PURPOSE,
  WORK_ORDER_VALIDATION_BINDINGS,
  type WorkOrderValidationAuthorizationConfig,
  type WorkOrderValidationAuthorizationPort,
  type WorkOrderValidationBinding,
  type WorkOrderValidationBoundary,
  type WorkOrderValidationCapabilityKey,
} from './work-order-validation-authorization.js';

it('keeps finalization dependency actions aligned with Spec 001 §15.13', () => {
  const dependencyBoundaries = new Set([
    'runFinalizeBindingReadV1',
    'runFinalizeFinalReadV1',
    'runFinalizeBundleReadV1',
    'runFinalizePolicyReadV1',
  ]);
  expect(
    Object.fromEntries(
      CONTROLLED_FIRST_RUN_BINDINGS.filter((binding) =>
        dependencyBoundaries.has(binding.boundary),
      ).map((binding) => [binding.boundary, binding.requiredGrantAction]),
    ),
  ).toEqual({
    runFinalizeBindingReadV1: 'integration.runtime.binding.read.for_run_finalize.v1',
    runFinalizeFinalReadV1: 'integration.runtime.final.read.for_run_finalize.v1',
    runFinalizeBundleReadV1: 'identity.execution_bundle.read.for_run_finalize.v1',
    runFinalizePolicyReadV1: 'identity.policy.resolve.for_run_finalize.v1',
  });
});

// Every refusal in the first half of this suite happens before the trusted
// transaction is opened: an unknown consumer version, an unusable trusted
// configuration, a target outside the entry's closed objectType set, a
// malformed complete target reference, a foreign actor snapshot and an invalid
// request hash all fail closed in front of the database. Those tests therefore
// stub `deps` with the trusted transaction context alone — a request that
// slipped past those gates would fail loudly on the missing `db`/`repo`
// instead of silently authorizing. The accepted continuation of each approved
// entry is asserted through the exact gate it reaches, which is what a pure
// suite can observe.
//
// The second half drives the Grant, Policy and Decision logic inside the
// transaction. It uses no database: a recording Kysely driver answers every
// statement in memory, so the Port's real SQL is compiled and executed while
// the rows, the Audit writes and the Decision inserts are observed directly.

/** The approved Spec 001 §15.10 rows, transcribed here instead of imported. */
interface EntryCase {
  readonly boundary: WorkOrderValidationBoundary;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: WorkOrderValidationBinding['targetKind'];
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: WorkOrderValidationBinding['selectorType'];
  readonly capabilityConfigKey: WorkOrderValidationCapabilityKey;
  readonly authorizeMethod: string;
  readonly revalidateMethod: string;
  /** The request member that carries the target reference of this entry. */
  readonly refField: 'targetRef' | 'draftSnapshotRef' | 'contextSnapshotRef';
  /** The reference the default request of this entry submits. */
  readonly makeRef: () => Common.ObjectRef | Common.ContentAddressedRef | Common.SnapshotRef;
}

const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d001';
const foreignEnterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d002';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d011';
const foreignProjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d012';
const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d003';
const actorSnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d004';
const authorizationDecisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d005';
const correlationId = '018f22e2-7c15-7b2e-8d86-2de956a9d006';
const otherUuid = '018f22e2-7c15-7b2e-8d86-2de956a9d007';
const validationObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d051';
const workOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d052';
const contractWorkOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d053';
const draftSnapshotObjectIdA = '018f22e2-7c15-7b2e-8d86-2de956a9d054';
const draftSnapshotObjectIdB = '018f22e2-7c15-7b2e-8d86-2de956a9d055';
const immutableVersionId = '018f22e2-7c15-7b2e-8d86-2de956a9d056';
const contextSnapshotIdA = '018f22e2-7c15-7b2e-8d86-2de956a9d057';
const contextSnapshotIdB = '018f22e2-7c15-7b2e-8d86-2de956a9d058';
const policySnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d031';
const commandPayloadHash = Buffer.alloc(32, 3);
const authenticationContextHash = Buffer.alloc(32, 4);
const clock = new Date('2026-09-21T00:00:00.000Z');
const decisionTtlMs = 300 * 1000;

/** The exact Project Scope one request of this slice runs in. */
const projectScope: Common.ScopeRef = { enterpriseId, projectId };

const context: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId,
  actorSnapshotId,
  authorizationDecisionId,
  authorizationDecisionHash: Buffer.alloc(32, 1),
  authorizationDecisionExpiresAt: new Date('2026-09-20T00:00:00.000Z'),
  enterpriseId,
  allowedProjectIds: [projectId],
  correlationId,
};

const pureDeps = { context } as unknown as IdentityCommandDeps;

/** One capability code per approved entry, all distinct and all valid. */
const capabilityCodes: Readonly<Record<WorkOrderValidationCapabilityKey, string>> = {
  workOrderValidationBuildV1: 'execution.work_order.validation.build',
  workOrderFreezeV1: 'execution.work_order.freeze',
  workOrderContractReadV1: 'execution.work_order.contract.read',
  workOrderValidationDraftReadV1: 'execution.work_order.validation.draft_snapshot.read',
  workOrderFreezeDraftReadV1: 'execution.work_order.freeze.draft_snapshot.read',
  workOrderValidationContextReadV1: 'execution.work_order.validation.context_snapshot.read',
  workOrderFreezeContextReadV1: 'execution.work_order.freeze.context_snapshot.read',
};

function contentHash(seed: number | Buffer): Common.ContentHash {
  const digest = Buffer.isBuffer(seed) ? seed : Buffer.alloc(32, seed);
  return { algorithm: 'SHA-256', digest: digest.toString('hex'), canonicalizationVersion: '1' };
}

/** An OBJECT target reference of the given object type and id. */
function targetRef(
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef = projectScope,
): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

/** A structurally complete DRAFT snapshot reference of the approved object type. */
function draftSnapshotRef(
  objectId: string,
  overrides: {
    readonly objectType?: string;
    readonly immutableVersionId?: string;
    readonly scope?: Common.ScopeRef;
    readonly contentHash?: Common.ContentHash;
  } = {},
): Common.ContentAddressedRef {
  const ref: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: overrides.objectType ?? 'zhiju.execution.work_order_draft_snapshot',
    objectId,
    scope: overrides.scope ?? projectScope,
    contentHash: overrides.contentHash ?? contentHash(6),
  };
  if (overrides.immutableVersionId !== undefined) {
    return { ...ref, immutableVersionId: overrides.immutableVersionId };
  }
  return ref;
}

/** A structurally complete Context snapshot reference (objectId == snapshotId). */
function contextSnapshotRef(
  objectId: string,
  overrides: {
    readonly objectType?: string;
    readonly scope?: Common.ScopeRef;
    readonly contentHash?: Common.ContentHash;
  } = {},
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: overrides.objectType ?? 'zhiju.execution.context_snapshot',
    objectId,
    snapshotId: objectId,
    scope: overrides.scope ?? projectScope,
    contentHash: overrides.contentHash ?? contentHash(7),
  };
}

/** The own CREATE Decision of `execution.validate_work_order_draft@1.0`. */
const validationBuild: EntryCase = {
  boundary: 'validationBuild',
  commandType: 'execution.validate_work_order_draft',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
  requiredGrantAction: 'execution.work_order.validation.create.v1',
  targetKind: 'OBJECT',
  targetObjectTypes: ['zhiju.execution.work_order_validation'],
  selectorType: 'CREATE_TARGET_TYPE',
  capabilityConfigKey: 'workOrderValidationBuildV1',
  authorizeMethod: 'authorizeWorkOrderValidation',
  revalidateMethod: 'revalidateWorkOrderValidation',
  refField: 'targetRef',
  makeRef: () => targetRef('zhiju.execution.work_order_validation', validationObjectId),
};

/** The own MUTATE Decision of `execution.freeze_work_order@1.0`. */
const freeze: EntryCase = {
  boundary: 'freeze',
  commandType: 'execution.freeze_work_order',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_FREEZE_PURPOSE,
  requiredGrantAction: 'execution.work_order.freeze.v1',
  targetKind: 'OBJECT',
  targetObjectTypes: ['zhiju.execution.work_order'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderFreezeV1',
  authorizeMethod: 'authorizeWorkOrderFreeze',
  revalidateMethod: 'revalidateWorkOrderFreeze',
  refField: 'targetRef',
  makeRef: () => targetRef('zhiju.execution.work_order', workOrderId),
};

/** The authoritative-read Decision of `execution.get_work_order_contract@1.0`. */
const contractRead: EntryCase = {
  boundary: 'contractRead',
  commandType: 'execution.get_work_order_contract',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_CONTRACT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.contract.read.v1',
  targetKind: 'OBJECT',
  targetObjectTypes: ['zhiju.execution.work_order'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderContractReadV1',
  authorizeMethod: 'authorizeWorkOrderContractRead',
  revalidateMethod: 'revalidateWorkOrderContractRead',
  refField: 'targetRef',
  makeRef: () => targetRef('zhiju.execution.work_order', contractWorkOrderId),
};

/** The DRAFT dependency read of validation. */
const validationDraftRead: EntryCase = {
  boundary: 'validationDraftRead',
  commandType: 'execution.validate_work_order_draft',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_validation.v1',
  targetKind: 'CONTENT_ADDRESSED',
  targetObjectTypes: ['zhiju.execution.work_order_draft_snapshot'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderValidationDraftReadV1',
  authorizeMethod: 'authorizeValidationDraftRead',
  revalidateMethod: 'revalidateValidationDraftRead',
  refField: 'draftSnapshotRef',
  makeRef: () => draftSnapshotRef(draftSnapshotObjectIdA),
};

/** The DRAFT dependency read of freeze. */
const freezeDraftRead: EntryCase = {
  boundary: 'freezeDraftRead',
  commandType: 'execution.freeze_work_order',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_freeze.v1',
  targetKind: 'CONTENT_ADDRESSED',
  targetObjectTypes: ['zhiju.execution.work_order_draft_snapshot'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderFreezeDraftReadV1',
  authorizeMethod: 'authorizeFreezeDraftRead',
  revalidateMethod: 'revalidateFreezeDraftRead',
  refField: 'draftSnapshotRef',
  makeRef: () => draftSnapshotRef(draftSnapshotObjectIdB),
};

/** The Context dependency read of validation. */
const validationContextRead: EntryCase = {
  boundary: 'validationContextRead',
  commandType: 'execution.validate_work_order_draft',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
  requiredGrantAction: 'execution.context.snapshot.read.for_validation.v1',
  targetKind: 'SNAPSHOT',
  targetObjectTypes: ['zhiju.execution.context_snapshot'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderValidationContextReadV1',
  authorizeMethod: 'authorizeValidationContextRead',
  revalidateMethod: 'revalidateValidationContextRead',
  refField: 'contextSnapshotRef',
  makeRef: () => contextSnapshotRef(contextSnapshotIdA),
};

/** The Context dependency read of freeze. */
const freezeContextRead: EntryCase = {
  boundary: 'freezeContextRead',
  commandType: 'execution.freeze_work_order',
  commandVersion: '1.0',
  authorizationPurpose: WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
  requiredGrantAction: 'execution.context.snapshot.read.for_freeze.v1',
  targetKind: 'SNAPSHOT',
  targetObjectTypes: ['zhiju.execution.context_snapshot'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderFreezeContextReadV1',
  authorizeMethod: 'authorizeFreezeContextRead',
  revalidateMethod: 'revalidateFreezeContextRead',
  refField: 'contextSnapshotRef',
  makeRef: () => contextSnapshotRef(contextSnapshotIdB),
};

const entries: readonly EntryCase[] = [
  validationBuild,
  freeze,
  contractRead,
  validationDraftRead,
  freezeDraftRead,
  validationContextRead,
  freezeContextRead,
];

/** The Port under test with the pure trusted configuration. */
function port(codes: unknown = capabilityCodes): WorkOrderValidationAuthorizationPort {
  return createWorkOrderValidationAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as WorkOrderValidationAuthorizationConfig);
}

/** The Port under test driven by the harness clock. */
function harnessPort(
  harness: ValidationHarness,
  codes: unknown = capabilityCodes,
): WorkOrderValidationAuthorizationPort {
  return createWorkOrderValidationAuthorizationPort({
    capabilityCodes: codes,
    now: () => harness.now,
  } as unknown as WorkOrderValidationAuthorizationConfig);
}

/** A trusted configuration in which only one approved entry is usable. */
function portWithOnlyUsable(key: WorkOrderValidationCapabilityKey) {
  const codes: Record<string, unknown> = {};
  for (const candidate of Object.keys(capabilityCodes)) codes[candidate] = '';
  codes[key] = capabilityCodes[key];
  return port(codes);
}

type AnyEntryMethod = (deps: IdentityCommandDeps, input: never) => Promise<unknown>;

function entryMethod(port_: WorkOrderValidationAuthorizationPort, name: string): AnyEntryMethod {
  const method = (port_ as unknown as Record<string, AnyEntryMethod | undefined>)[name];
  if (method === undefined) throw new Error(`the port has no method ${name}`);
  return method;
}

function authorizeEntry(
  port_: WorkOrderValidationAuthorizationPort,
  entry: EntryCase,
  deps: IdentityCommandDeps,
  input: unknown,
): Promise<unknown> {
  return entryMethod(port_, entry.authorizeMethod)(deps, input as never);
}

function revalidateEntry(
  port_: WorkOrderValidationAuthorizationPort,
  entry: EntryCase,
  deps: IdentityCommandDeps,
  input: unknown,
): Promise<unknown> {
  return entryMethod(port_, entry.revalidateMethod)(deps, input as never);
}

function actorSnapshotRef(scope: Common.ScopeRef = projectScope): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: actorSnapshotId,
    snapshotId: actorSnapshotId,
    scope,
    contentHash: contentHash(2),
  };
}

/** A structurally complete request of one approved entry. */
function authorizeInputFor(
  entry: EntryCase,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    actorSnapshotRef: actorSnapshotRef(),
    commandType: entry.commandType,
    commandVersion: entry.commandVersion,
    [entry.refField]: entry.makeRef(),
    commandPayloadHash,
    authenticationContextHash,
    ...overrides,
  };
}

function projection(rows: readonly WorkOrderValidationBinding[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.boundary}|${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.capabilityConfigKey}`,
    )
    .sort();
}

function specProjection(rows: readonly EntryCase[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.boundary}|${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.capabilityConfigKey}`,
    )
    .sort();
}

// ---------------------------------------------------------------------------
// In-memory owning state: Grant rows, Policy Snapshot rows and a recording
// Kysely driver. Nothing here talks to a database.
// ---------------------------------------------------------------------------

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

const policyEffectiveFrom = new Date('2026-01-01T00:00:00.000Z');
const policySetVersion = 'im06-static-v1';
const policyPayload: CanonicalJsonObject = {
  policySetVersion,
  effectiveFrom: policyEffectiveFrom.toISOString(),
  policySchemaRefs: [],
};
const policyPayloadDigest = digestCanonicalPayload(policyPayload);
const policySnapshotHash = policyPayloadDigest.hash;

interface PolicySnapshotOverrides {
  readonly payloadHash?: Buffer;
  readonly supersededAt?: Date | null;
  /** A promoted mirror that no longer matches the canonical payload. */
  readonly policySetVersion?: string;
}

/** The Policy Snapshot row the owning read returns for the covering Grant. */
function policySnapshotRow(overrides: PolicySnapshotOverrides = {}): SelectedPolicySnapshot {
  return {
    policy_snapshot_id: policySnapshotId,
    policy_set_version: overrides.policySetVersion ?? policySetVersion,
    policy_schema_refs: [],
    effective_from: policyEffectiveFrom,
    superseded_at: overrides.supersededAt === undefined ? null : overrides.supersededAt,
    payload_hash: overrides.payloadHash ?? policySnapshotHash,
    payload_hash_algorithm: policyPayloadDigest.hashAlgorithm,
    canonicalization_version: policyPayloadDigest.canonicalizationVersion,
    payload_size_bytes: String(policyPayloadDigest.sizeBytes),
    canonical_payload: policyPayload,
  } as unknown as SelectedPolicySnapshot;
}

interface GrantOverrides {
  readonly principalId?: string;
  readonly capabilityCode?: string;
  readonly actions?: readonly string[];
  readonly selectors?: unknown;
  readonly constraints?: unknown;
  readonly maxUses?: number | null;
  readonly scopeKind?: 'ENTERPRISE' | 'PROJECT';
  readonly enterpriseId?: string;
  readonly projectId?: string | null;
  readonly policySnapshotId?: string;
  readonly policySnapshotHash?: Buffer;
}

/** One committed capability Grant row, as the owning read returns it. */
function grantRow(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return {
    id: otherUuid,
    principal_id: overrides.principalId ?? principalId,
    capability_code: overrides.capabilityCode ?? capabilityCodes.workOrderValidationBuildV1,
    scope_kind: overrides.scopeKind ?? 'PROJECT',
    enterprise_id: overrides.enterpriseId ?? enterpriseId,
    project_id: overrides.projectId === undefined ? projectId : overrides.projectId,
    resource_selectors: overrides.selectors ?? [],
    actions: overrides.actions ?? [],
    constraints: overrides.constraints ?? {},
    valid_from: policyEffectiveFrom,
    valid_to: null,
    max_uses: overrides.maxUses === undefined ? null : overrides.maxUses,
    grant_policy_snapshot_id: overrides.policySnapshotId ?? policySnapshotId,
    grant_policy_snapshot_hash: overrides.policySnapshotHash ?? policySnapshotHash,
    status: 'ACTIVE',
  } as unknown as SelectedCapabilityGrant;
}

/** The Grant that covers one entry's default target. */
function grantFor(entry: EntryCase, overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  const objectType = entry.targetObjectTypes[0];
  if (objectType === undefined) throw new Error('an approved entry has a closed target set');
  return grantRow({
    capabilityCode: capabilityCodes[entry.capabilityConfigKey],
    actions: [entry.requiredGrantAction],
    selectors: [{ selectorType: entry.selectorType, objectType }],
    ...overrides,
  });
}

/**
 * The exact row the owning repository would have stored for one Decision: the
 * promoted columns plus the canonical payload the Port asked it to write. Only
 * the read-back boundary of the Port (`authorizationDecisionIntegrityHolds`)
 * ever sees this shape.
 */
function decisionRow(
  insert: AuthorizationDecisionInsert,
  options: { readonly dropTargetRef?: boolean } = {},
): SelectedAuthorizationDecision {
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
  const base: CanonicalJsonObject = { ...insert.decisionPayload };
  if (options.dropTargetRef === true) {
    // A Decision of the generic port: no target mirrors and no payload targetRef.
    Reflect.deleteProperty(base, 'targetRef');
  }
  const payload: CanonicalJsonObject = { ...base, ...mirrors };
  const digest = digestCanonicalPayload(payload);
  const target = options.dropTargetRef === true ? undefined : insert.targetRef;
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
    target_object_type: target?.objectType ?? null,
    target_object_id: target?.objectId ?? null,
    contract_type: 'identity.AuthorizationDecision',
    contract_version: insert.contractVersion,
    canonicalization_version: digest.canonicalizationVersion,
    payload_hash_algorithm: digest.hashAlgorithm,
    payload_hash: digest.hash,
    payload_size_bytes: String(digest.sizeBytes),
    canonical_payload: payload,
    created_at: clock,
    created_by_principal_id: insert.createdByPrincipalId,
    source_command_id: insert.sourceCommandId,
    retention_class: 'REGULATED_AUDIT',
  };
}

/**
 * The connection this suite hands to Kysely: every statement is answered in
 * memory, and the two RLS preamble statements the owning transaction helper
 * issues are accepted without a database. `kysely` does not publish its
 * `DatabaseConnection` interface at the package root, so the driver asserts
 * this shape instead of importing that internal name.
 */
interface RecordingConnection {
  executeQuery(compiledQuery: CompiledQuery): Promise<{ readonly rows: unknown[] }>;
  streamQuery(): AsyncIterableIterator<{ readonly rows: unknown[] }>;
}

/**
 * One in-memory owning state behind the Port: the trusted transaction context,
 * the rows every owning read returns, and every statement the Port executed.
 */
class ValidationHarness {
  readonly context: IdentityTransactionContext = context;
  readonly deps: IdentityCommandDeps;
  /** Every compiled statement the Port executed, in order. */
  readonly executed: RecordedQuery[] = [];
  /** Every Decision the Port asked the owning repository to insert. */
  readonly decisions: AuthorizationDecisionInsert[] = [];
  /** The active Grants the owning read returns. */
  grants: unknown[] = [];
  /** Policy Snapshot rows by id, as the owning read returns them. */
  policySnapshots: Record<string, unknown> = { [policySnapshotId]: policySnapshotRow() };
  principalStatus: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';
  principalKind: 'HUMAN' | 'AGENT' = 'HUMAN';
  actorHashMatched = true;
  /** `undefined` derives the stored Decision from the last signed one. */
  decisionOverride: unknown = undefined;
  now: Date = clock;

  constructor() {
    this.deps = {
      db: this.database(),
      repo: this.repository(),
      context: this.context,
    } as unknown as IdentityCommandDeps;
  }

  /** The masked Audit rows the Port wrote, as compiled statements. */
  auditInserts(): RecordedQuery[] {
    return this.executed.filter((entry) => entry.sql.includes('"identity_policy"."audit_record"'));
  }

  /** The stored Decision row of the last signed Decision. */
  lastSigned(): AuthorizationDecisionInsert {
    const insert = this.decisions.at(-1);
    if (insert === undefined) throw new Error('no Decision was signed');
    return insert;
  }

  /** The payload hash a Decision reference must carry to name the stored row. */
  storedDecisionHash(): Buffer {
    return this.storedDecisionRow()?.payload_hash ?? Buffer.alloc(32, 0);
  }

  private storedDecisionRow(): SelectedAuthorizationDecision | undefined {
    // `null` is the harness way of saying "the repository has no such row".
    if (this.decisionOverride === null) return undefined;
    if (this.decisionOverride !== undefined) {
      return this.decisionOverride as SelectedAuthorizationDecision;
    }
    if (this.decisions.length === 0) return undefined;
    return decisionRow(this.lastSigned());
  }

  private connection(): RecordingConnection {
    return {
      executeQuery: (compiledQuery: CompiledQuery) => {
        this.executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        // The only read the Port executes itself is the post-insert hash
        // re-read of the Decision row it just asked the repository to write.
        const readsDecisionHash =
          compiledQuery.sql.includes('"identity_policy"."authorization_decision"') &&
          compiledQuery.sql.includes('"payload_hash"');
        return Promise.resolve({
          rows: readsDecisionHash ? this.decisionRowSelectRows() : [],
        });
      },
      streamQuery: () => {
        throw new Error('this suite never streams');
      },
    };
  }

  private decisionRowSelectRows(): unknown[] {
    const row = this.storedDecisionRow();
    if (row === undefined) return [];
    return [
      {
        authorization_decision_id: row.authorization_decision_id,
        payload_hash: row.payload_hash,
      },
    ];
  }

  private driver(connection: RecordingConnection): Driver {
    return {
      init: () => Promise.resolve(),
      acquireConnection: () => Promise.resolve(connection),
      beginTransaction: () => Promise.resolve(),
      commitTransaction: () => Promise.resolve(),
      rollbackTransaction: () => Promise.resolve(),
      releaseConnection: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
    } as unknown as Driver;
  }

  private database(): Kysely<IdentityPolicyDb> {
    const connection = this.connection();
    return new Kysely<IdentityPolicyDb>({
      dialect: {
        createDriver: () => this.driver(connection),
        createAdapter: () => new PostgresAdapter(),
        createQueryCompiler: () => new PostgresQueryCompiler(),
        createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      },
    });
  }

  private repository(): IdentityPolicyRepository {
    return {
      getActorSnapshotByIdAndHash: () =>
        Promise.resolve({
          hashMatched: this.actorHashMatched,
          row: {
            actor_snapshot_id: actorSnapshotId,
            principal_id: principalId,
            principal_kind: this.principalKind,
            scope_kind: 'PROJECT',
            authentication_context_hash: authenticationContextHash,
            enterprise_id: enterpriseId,
            project_id: projectId,
            payload_hash: Buffer.alloc(32, 5),
          },
        }),
      getPrincipalById: () =>
        Promise.resolve({
          principal_kind: this.principalKind,
          status: this.principalStatus,
        }),
      // The owning read filters by principal and Enterprise; the Port trusts
      // that filter and never re-derives the caller's identity from a row.
      listActiveCapabilityGrants: (_trx: unknown, principalId_: string, enterpriseId_: string) =>
        Promise.resolve(
          this.grants.filter(
            (grant) =>
              (grant as SelectedCapabilityGrant).principal_id === principalId_ &&
              (grant as SelectedCapabilityGrant).enterprise_id === enterpriseId_,
          ),
        ),
      getPolicySnapshotById: (_trx: unknown, id: string) =>
        Promise.resolve(this.policySnapshots[id]),
      getAuthorizationDecisionByIdAndHash: (_trx: unknown, id: string, expectedHash: Buffer) => {
        const row = this.storedDecisionRow();
        if (row?.authorization_decision_id !== id) return Promise.resolve(undefined);
        return Promise.resolve({ row, hashMatched: row.payload_hash.equals(expectedHash) });
      },
      insertAuthorizationDecision: (_trx: unknown, insert: AuthorizationDecisionInsert) => {
        this.decisions.push(insert);
        return Promise.resolve();
      },
    } as unknown as IdentityPolicyRepository;
  }
}

/** A harness holding the Grant that covers the given entry's default target. */
async function signedEntry(entry: EntryCase): Promise<ValidationHarness> {
  const harness = new ValidationHarness();
  harness.grants = [grantFor(entry)];
  const view = (await authorizeEntry(
    harnessPort(harness),
    entry,
    harness.deps,
    authorizeInputFor(entry),
  )) as { readonly outcome: string };
  expect(view.outcome).toBe('ALLOW');
  return harness;
}

/**
 * The complete target reference a signed Decision of this entry carries: the
 * OBJECT target for an own boundary, the canonical-payload full-ref member for
 * a dependency boundary.
 */
function signedRef(entry: EntryCase, insert: AuthorizationDecisionInsert): unknown {
  if (entry.refField === 'targetRef') {
    // The complete OBJECT reference lives in the canonical payload; the
    // promoted `targetRef` insert member is the type/id mirror alone.
    const stored = (insert.decisionPayload as Record<string, unknown>).targetRef;
    if (stored === undefined) throw new Error('the signed Decision carries no targetRef member');
    return stored;
  }
  const stored = (insert.decisionPayload as Record<string, unknown>)[entry.refField];
  if (stored === undefined) {
    throw new Error(`the signed Decision carries no ${entry.refField} member`);
  }
  return stored;
}

/** The revalidation request that matches the Decision a harness signed. */
function revalidationInputFor(
  entry: EntryCase,
  insert: AuthorizationDecisionInsert,
  decisionPayloadHash: Buffer = decisionRow(insert).payload_hash,
): Record<string, unknown> {
  const expectedField =
    entry.refField === 'targetRef'
      ? 'expectedTargetRef'
      : entry.refField === 'draftSnapshotRef'
        ? 'expectedDraftSnapshotRef'
        : 'expectedContextSnapshotRef';
  return {
    decisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: insert.authorizationDecisionId,
      scope: projectScope,
      contentHash: contentHash(decisionPayloadHash),
    },
    expectedCommandType: insert.commandType,
    expectedCommandVersion: insert.commandVersion,
    expectedCommandPayloadHash: insert.commandPayloadHash,
    expectedAuthenticationContextHash: insert.authenticationContextHash,
    [expectedField]: signedRef(entry, insert),
  };
}

/**
 * A structurally complete Decision insert of one entry, used by the
 * pre-transaction revalidation gates that never reach the repository.
 */
function signedEntryInsert(entry: EntryCase): AuthorizationDecisionInsert {
  const decisionId = newUuidV7();
  const ref = entry.makeRef();
  const objectType = entry.targetObjectTypes[0];
  if (objectType === undefined) throw new Error('an approved entry has a closed target set');
  const decisionPayload: CanonicalJsonObject = {
    targetRef: {
      kind: 'OBJECT',
      objectType,
      objectId: ref.objectId,
      scope: { enterpriseId, projectId },
    },
    ...(entry.refField === 'targetRef'
      ? {}
      : { [entry.refField]: ref as unknown as CanonicalJsonObject }),
  };
  return {
    authorizationDecisionId: decisionId,
    actorSnapshotId,
    actorSnapshotPayloadHash: Buffer.alloc(32, 5),
    principalId,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: entry.commandType,
    commandVersion: entry.commandVersion,
    scopeKind: 'PROJECT',
    enterpriseId,
    projectId,
    purpose: entry.authorizationPurpose,
    requestedCapability: capabilityCodes[entry.capabilityConfigKey],
    commandPayloadHash,
    policySnapshotId,
    policySnapshotPayloadHash: policySnapshotHash,
    authenticationContextHash,
    expiresAt: new Date(clock.getTime() + decisionTtlMs),
    contractVersion: '1.0',
    targetRef: { objectType, objectId: ref.objectId },
    decisionPayload,
    createdByPrincipalId: principalId,
    sourceCommandId: newUuidV7(),
  };
}

describe('approved WorkOrder Validation/Freeze authorization bindings', () => {
  it('publishes exactly the seven approved rows and nothing else', () => {
    expect(WORK_ORDER_VALIDATION_BINDINGS).toHaveLength(entries.length);
    expect(projection(WORK_ORDER_VALIDATION_BINDINGS)).toEqual(specProjection(entries));
  });

  it('publishes the four Purposes of the slice verbatim', () => {
    expect(WORK_ORDER_DRAFT_VALIDATE_PURPOSE).toBe('execution.work_order.draft.validate');
    expect(WORK_ORDER_FREEZE_PURPOSE).toBe('task.execution.freeze_work_order');
    expect(WORK_ORDER_CONTRACT_READ_PURPOSE).toBe('task.execution.get_work_order_contract');
    // The Context dependency reads carry the internal Purpose, which is not the
    // published `task.execution.get_context_snapshot` Query Purpose of §15.8.
    expect(WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE).toBe('execution.context.snapshot.read');
    expect(WORK_ORDER_DRAFT_READ_PURPOSE).toBe('execution.work_order.draft.read');
  });

  it('keeps the seven entries mutually non-substitutable', () => {
    // Grant action and trusted configuration key are unique per entry; a shared
    // Purpose (the two DRAFT dependency reads, the two Context dependency
    // reads) never merges entries (Spec 001 §15.10).
    const actions = new Set(WORK_ORDER_VALIDATION_BINDINGS.map((row) => row.requiredGrantAction));
    expect(actions.size).toBe(WORK_ORDER_VALIDATION_BINDINGS.length);
    const keys = new Set(WORK_ORDER_VALIDATION_BINDINGS.map((row) => row.capabilityConfigKey));
    expect(keys.size).toBe(WORK_ORDER_VALIDATION_BINDINGS.length);
    const draftReads = WORK_ORDER_VALIDATION_BINDINGS.filter(
      (row) => row.authorizationPurpose === WORK_ORDER_DRAFT_READ_PURPOSE,
    );
    expect(draftReads.map((row) => row.boundary).sort()).toEqual([
      'freezeDraftRead',
      'validationDraftRead',
    ]);
    const contextReads = WORK_ORDER_VALIDATION_BINDINGS.filter(
      (row) => row.authorizationPurpose === WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
    );
    expect(contextReads.map((row) => row.boundary).sort()).toEqual([
      'freezeContextRead',
      'validationContextRead',
    ]);
  });

  it('stays independent from every earlier authorization slice', () => {
    // Neither a §15.5 readiness entry, a §15.6 public DRAFT read, a §15.8
    // Context build/read entry nor the §15.9 build-specific DRAFT dependency
    // read ever shares a trusted configuration key or a Grant action with one
    // of the seven entries (Spec 001 §15.10 capability isolation).
    const others = [
      ...TASK_EXECUTION_READINESS_BINDINGS,
      ...WORK_ORDER_DRAFT_READ_BINDINGS,
      ...TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS,
      ...CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS,
    ];
    expect(others.length).toBeGreaterThan(0);
    for (const row of WORK_ORDER_VALIDATION_BINDINGS) {
      for (const other of others) {
        expect(row.capabilityConfigKey).not.toBe(other.capabilityConfigKey);
        expect(row.requiredGrantAction).not.toBe(other.requiredGrantAction);
      }
    }
  });

  it('admits canonical WorkOrder/Context spellings only, never the legacy ones', () => {
    // First version only: canonical `@1.1` WorkOrder and INITIAL Context
    // targets; the legacy spellings enter no closed target set.
    const allTargets = WORK_ORDER_VALIDATION_BINDINGS.flatMap((row) => row.targetObjectTypes);
    expect(allTargets).not.toContain('execution.work_order');
    expect(allTargets).not.toContain('zhiju.project.context_snapshot');
    expect(allTargets).not.toContain('execution.work_order_draft_snapshot');
    expect(allTargets).not.toContain('execution.work_order_validation');
    for (const row of WORK_ORDER_VALIDATION_BINDINGS) {
      expect(row.targetObjectTypes).toHaveLength(1);
    }
  });
});

describe('WorkOrder Validation/Freeze authorization: exact consumer operation version', () => {
  it('refuses an unknown consumer operation, an alias and a case variant', async () => {
    for (const commandType of [
      'execution.validate_work_order_drafts',
      'execution.freeze_work_orders',
      'execution.get_work_order_contracts',
      'execution.validate_work_order',
      'execution.work_order.draft.validate',
      'execution.work_order.validation.create.v1',
      'Execution.validate_work_order_draft',
      'EXECUTION.FREEZE_WORK_ORDER',
      ' execution.freeze_work_order',
      'execution.get_work_order_contract ',
      'execution.validate_work_order_draft@1.0',
      'execution.freeze_work_order?version=1.0',
      '',
      '*',
      'execution.*',
      'latest',
    ]) {
      for (const entry of entries) {
        await expect(
          authorizeEntry(port(), entry, pureDeps, authorizeInputFor(entry, { commandType })),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      }
    }
  });

  it('refuses a non-string operation or version', async () => {
    for (const commandType of [undefined, null, 1, true, {}, ['execution.freeze_work_order']]) {
      await expect(
        authorizeEntry(port(), freeze, pureDeps, authorizeInputFor(freeze, { commandType })),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    }
    for (const commandVersion of [undefined, null, 1, true, {}, ['1.0']]) {
      await expect(
        authorizeEntry(port(), freeze, pureDeps, authorizeInputFor(freeze, { commandVersion })),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses an unknown, missing or non-exact version without a fallback', async () => {
    for (const commandVersion of [
      '1',
      '2',
      '1.1',
      '2.0',
      '1.0.0',
      '01.0',
      '1.00',
      'v1.0',
      'V1.0',
      '1.0 ',
      ' 1.0',
      '1.0\n',
      '',
      '*',
      '1.x',
      '^1.0',
      'latest',
      'LATEST',
      'stable',
    ]) {
      for (const entry of entries) {
        await expect(
          authorizeEntry(port(), entry, pureDeps, authorizeInputFor(entry, { commandVersion })),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
      }
    }
  });

  it('refuses the consumer pair of another boundary of the same operation', async () => {
    // `(commandType, commandVersion)` does not identify an entry: the DRAFT and
    // Context dependency reads share the consumer pair of their own boundary,
    // and an own boundary never accepts a dependency consumer's pair either.
    await expect(
      authorizeEntry(
        port(),
        validationBuild,
        pureDeps,
        authorizeInputFor(validationBuild, { commandType: 'execution.freeze_work_order' }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    await expect(
      authorizeEntry(
        port(),
        freeze,
        pureDeps,
        authorizeInputFor(freeze, { commandType: 'execution.validate_work_order_draft' }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    await expect(
      authorizeEntry(
        port(),
        validationDraftRead,
        pureDeps,
        authorizeInputFor(validationDraftRead, { commandType: 'execution.freeze_work_order' }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
    await expect(
      authorizeEntry(
        port(),
        freezeContextRead,
        pureDeps,
        authorizeInputFor(freezeContextRead, {
          commandType: 'execution.validate_work_order_draft',
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED });
  });
});

describe('WorkOrder Validation/Freeze authorization: trusted capability configuration', () => {
  it('refuses a missing, blank or non-NamespaceCode capability code of every entry', async () => {
    const unusable: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Execution.Work_Order.Freeze',
      'execution workorder freeze',
      'execution\tworkorder',
      '1execution',
      'execution..workorder',
      'execution-workorder',
      '.execution',
      'execution.',
      '_execution',
      'execution.workorder.',
      'EXECUTION.WORKORDER',
      'execution/workorder',
      'execution.workorder@2',
      42,
      ['execution.workorder'],
      { code: 'execution.workorder' },
    ];
    for (const entry of entries) {
      for (const value of unusable) {
        const codes: Record<string, unknown> = { ...capabilityCodes };
        codes[entry.capabilityConfigKey] = value;
        await expect(
          authorizeEntry(port(codes), entry, pureDeps, authorizeInputFor(entry)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID });
      }
      // A deployment that never configures this entry's key fails closed:
      // there is no fallback to another entry's capability (Spec 001 §15.10).
      const withoutKey: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(capabilityCodes)) {
        if (key !== entry.capabilityConfigKey) withoutKey[key] = value;
      }
      await expect(
        authorizeEntry(port(withoutKey), entry, pureDeps, authorizeInputFor(entry)),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses a configuration object that carries no capability codes instead of crashing', async () => {
    for (const codes of [
      {},
      { capabilityCodes: undefined },
      { capabilityCodes: null },
      { capabilityCodes: 'execution.work_order.freeze' },
      { capabilityCodes: [] },
      { now: (): Date => clock },
    ]) {
      for (const entry of entries) {
        await expect(
          authorizeEntry(port(codes), entry, pureDeps, authorizeInputFor(entry)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('binds each entry to its own trusted configuration key', async () => {
    for (const entry of entries) {
      // Its own trusted key carries the request past the configuration gate to
      // the request-hash gate, which is the gate directly behind it.
      await expect(
        authorizeEntry(
          portWithOnlyUsable(entry.capabilityConfigKey),
          entry,
          pureDeps,
          authorizeInputFor(entry, { commandPayloadHash: Buffer.alloc(31, 9) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });

      // A configuration that holds a code only for another entry authorizes
      // nothing here: the resolved entry never reads a neighbouring key, so a
      // shared Purpose never lets one entry's trusted configuration result
      // stand in for another.
      for (const other of entries) {
        if (other.capabilityConfigKey === entry.capabilityConfigKey) continue;
        await expect(
          authorizeEntry(
            portWithOnlyUsable(other.capabilityConfigKey),
            entry,
            pureDeps,
            authorizeInputFor(entry),
          ),
        ).rejects.toMatchObject({
          code: IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID,
        });
      }
    }
  });
});

describe('WorkOrder Validation/Freeze authorization: target reference', () => {
  it('accepts only the single canonical target spelling of each own boundary', async () => {
    for (const entry of [validationBuild, freeze, contractRead]) {
      const objectType = entry.targetObjectTypes[0];
      if (objectType === undefined) throw new Error('an approved entry has a closed target set');
      const objectId = (entry.makeRef() as Common.ObjectRef).objectId;
      for (const substituted of [
        // the legacy WorkOrder spelling and every other approved type
        'execution.work_order',
        'zhiju.project.context_snapshot',
        'zhiju.execution.work_order_validation',
        'zhiju.execution.work_order',
        'zhiju.execution.work_order_draft_snapshot',
        'zhiju.execution.context_snapshot',
        'Zhiju.execution.work_order',
        'zhiju.execution',
        `${objectType} `,
        `${objectType}.v1`,
        '*',
        'latest',
        '',
      ].filter((candidate) => candidate !== objectType)) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { targetRef: targetRef(substituted, objectId) }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
      // The approved spelling itself passes this gate and reaches the request
      // hash gate behind it.
      await expect(
        authorizeEntry(
          port(),
          entry,
          pureDeps,
          authorizeInputFor(entry, { commandPayloadHash: Buffer.alloc(31, 9) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });

  it('refuses a target id that is not a UuidV7', async () => {
    for (const objectId of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d051',
      '018f22e2-7c15-7b2e-cd86-2de956a9d051',
      '018f22e2-7c15-7b2e-8d86-2de956a9d05',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D051',
      '018f22e2-7c15-7b2e-8d86-2de956a9d051 ',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0510',
    ]) {
      for (const entry of entries) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, {
              [entry.refField]:
                entry.targetKind === 'OBJECT'
                  ? targetRef(entry.targetObjectTypes[0] ?? '', objectId)
                  : entry.targetKind === 'CONTENT_ADDRESSED'
                    ? draftSnapshotRef(objectId)
                    : contextSnapshotRef(objectId),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });

  it('refuses a reference whose kind is not the entry target kind', async () => {
    for (const entry of entries) {
      const ref = entry.makeRef() as unknown as Record<string, unknown>;
      for (const kind of [
        'OBJECT',
        'CONTENT_ADDRESSED',
        'SNAPSHOT',
        'VERSIONED',
        'object',
        '',
        undefined,
      ].filter((kind) => kind !== entry.targetKind)) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { [entry.refField]: { ...ref, kind } }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
      for (const target of [undefined, null, 'zhiju.execution.work_order', 42]) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { [entry.refField]: target }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });

  it('refuses a scope that is not the exact Project Scope of the request', async () => {
    for (const scope of [
      undefined,
      null,
      {},
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId, scopeKind: 'PROJECT' },
      { enterpriseId, projectId, extra: undefined },
      { enterpriseId: foreignEnterpriseId, projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId: foreignProjectId },
    ]) {
      for (const entry of entries) {
        const ref = entry.makeRef() as unknown as Record<string, unknown>;
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { [entry.refField]: { ...ref, scope } }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });

  it('refuses a DRAFT dependency ref whose object type is not the closed snapshot type', async () => {
    for (const objectType of [
      // the public WorkOrder spellings and every legacy draft spelling
      'zhiju.execution.work_order',
      'execution.work_order',
      'execution.work_order_draft_snapshot',
      'zhiju.execution.work_order_draft_snapshots',
      'zhiju.execution.context_snapshot',
      'Zhiju.execution.work_order_draft_snapshot',
      'zhiju.execution',
      '*',
      'latest',
      '',
    ]) {
      for (const entry of [validationDraftRead, freezeDraftRead]) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, {
              draftSnapshotRef: draftSnapshotRef(
                (entry.makeRef() as Common.ContentAddressedRef).objectId,
                { objectType },
              ),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });

  it('refuses a malformed immutableVersionId and accepts an absent or exact one', async () => {
    for (const value of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d056',
      '018f22e2-7c15-7b2e-cd86-2de956a9d056',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D056',
      '018f22e2-7c15-7b2e-8d86-2de956a9d056 ',
      null,
      42,
      {},
    ]) {
      for (const entry of [validationDraftRead, freezeDraftRead]) {
        const ref = entry.makeRef() as unknown as Record<string, unknown>;
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { draftSnapshotRef: { ...ref, immutableVersionId: value } }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
    // An absent and an exact version id both pass the target gate and reach
    // the request hash gate behind it.
    for (const entry of [validationDraftRead, freezeDraftRead]) {
      const objectId = (entry.makeRef() as Common.ContentAddressedRef).objectId;
      for (const ref of [
        draftSnapshotRef(objectId),
        draftSnapshotRef(objectId, { immutableVersionId }),
      ]) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, {
              draftSnapshotRef: ref,
              commandPayloadHash: Buffer.alloc(31, 9),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      }
    }
  });

  it('refuses a Context dependency ref outside the exact SNAPSHOT shape', async () => {
    for (const entry of [validationContextRead, freezeContextRead]) {
      const ref = entry.makeRef() as unknown as Record<string, unknown>;
      const rejected: readonly unknown[] = [
        // the legacy Context spelling and every other approved type
        { ...ref, objectType: 'zhiju.project.context_snapshot' },
        { ...ref, objectType: 'zhiju.execution.work_order' },
        { ...ref, objectType: 'zhiju.execution.work_order_draft_snapshot' },
        { ...ref, objectType: 'Zhiju.execution.context_snapshot' },
        { ...ref, objectType: '*' },
        { ...ref, objectType: '' },
        // a missing or malformed snapshotId
        { ...ref, snapshotId: undefined },
        { ...ref, snapshotId: 'abc' },
        { ...ref, snapshotId: null },
        // an immutableVersionId member is never part of this ref shape
        { ...ref, immutableVersionId },
        { ...ref, immutableVersionId: null },
      ];
      for (const candidate of rejected) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { contextSnapshotRef: candidate }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
      // The approved shape passes this gate and reaches the request hash gate.
      await expect(
        authorizeEntry(
          port(),
          entry,
          pureDeps,
          authorizeInputFor(entry, { commandPayloadHash: Buffer.alloc(31, 9) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });

  it('refuses a content hash that is not a SHA-256 / canonicalization-v1 digest', async () => {
    for (const hash of [
      undefined,
      null,
      'a'.repeat(64),
      42,
      [],
      { algorithm: 'SHA-512', digest: 'a'.repeat(64), canonicalizationVersion: '1' },
      { algorithm: 'SHA-256', digest: 'A'.repeat(64), canonicalizationVersion: '1' },
      { algorithm: 'SHA-256', digest: 'a'.repeat(63), canonicalizationVersion: '1' },
      { algorithm: 'SHA-256', digest: 'a'.repeat(65), canonicalizationVersion: '1' },
      { algorithm: 'SHA-256', digest: 'g'.repeat(64), canonicalizationVersion: '1' },
      { algorithm: 'SHA-256', digest: 'a'.repeat(64), canonicalizationVersion: '2' },
      { algorithm: 'SHA-256', digest: 'a'.repeat(64) },
      { algorithm: 'SHA-256', canonicalizationVersion: '1' },
      {
        algorithm: 'SHA-256',
        digest: 'a'.repeat(64),
        canonicalizationVersion: '1',
        extra: 'x',
      },
    ]) {
      for (const entry of [validationDraftRead, validationContextRead]) {
        const ref = entry.makeRef() as unknown as Record<string, unknown>;
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { [entry.refField]: { ...ref, contentHash: hash } }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });
});

describe('WorkOrder Validation/Freeze authorization: actor snapshot and request facts', () => {
  it('refuses an actor snapshot outside the exact request Project', async () => {
    for (const scope of [
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      {},
    ]) {
      for (const entry of entries) {
        await expect(
          authorizeEntry(
            port(),
            entry,
            pureDeps,
            authorizeInputFor(entry, { actorSnapshotRef: { ...actorSnapshotRef(), scope } }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
      }
    }
  });

  it('refuses an actor snapshot that is not an exact snapshot reference', async () => {
    for (const actorSnapshot of [
      undefined,
      null,
      { ...actorSnapshotRef(), kind: 'OBJECT' },
      { ...actorSnapshotRef(), objectType: 'identity.authorization_decision' },
      { ...actorSnapshotRef(), objectId: 'abc' },
      { ...actorSnapshotRef(), snapshotId: otherUuid },
    ]) {
      await expect(
        authorizeEntry(
          port(),
          validationBuild,
          pureDeps,
          authorizeInputFor(validationBuild, { actorSnapshotRef: actorSnapshot }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses an actor snapshot that is not the trusted transaction actor', async () => {
    await expect(
      authorizeEntry(
        port(),
        validationBuild,
        pureDeps,
        authorizeInputFor(validationBuild, {
          actorSnapshotRef: { ...actorSnapshotRef(), objectId: otherUuid, snapshotId: otherUuid },
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    // The trusted actor itself still passes this gate and reaches the hash
    // checks of the same request.
    await expect(
      authorizeEntry(
        port(),
        validationBuild,
        pureDeps,
        authorizeInputFor(validationBuild, { commandPayloadHash: Buffer.alloc(31, 3) }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
  });

  it('refuses a request hash that is not a SHA-256 digest', async () => {
    for (const hash of [
      Buffer.alloc(31, 3),
      Buffer.alloc(33, 3),
      Buffer.alloc(0),
      Buffer.alloc(64, 3),
      Buffer.from('03'.repeat(32), 'hex').toString('hex'),
      'a'.repeat(64),
      undefined,
      null,
    ]) {
      await expect(
        authorizeEntry(
          port(),
          validationBuild,
          pureDeps,
          authorizeInputFor(validationBuild, { commandPayloadHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      await expect(
        authorizeEntry(
          port(),
          validationBuild,
          pureDeps,
          authorizeInputFor(validationBuild, { authenticationContextHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });
});

describe('WorkOrder Validation/Freeze authorization: single covering Grant', () => {
  it('signs the exact target-bound Decision of each of the seven entries', async () => {
    for (const entry of entries) {
      const harness = await signedEntry(entry);
      expect(harness.decisions).toHaveLength(1);
      const insert = harness.decisions[0];
      const objectType = entry.targetObjectTypes[0];
      if (objectType === undefined || insert === undefined) throw new Error('missing entry');
      expect(insert).toMatchObject({
        outcome: 'ALLOW',
        commandType: entry.commandType,
        commandVersion: entry.commandVersion,
        purpose: entry.authorizationPurpose,
        requestedCapability: capabilityCodes[entry.capabilityConfigKey],
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
        targetRef: { objectType, objectId: entry.makeRef().objectId },
      });
      // The payload `targetRef` keeps the V1006 OBJECT mirror shape; a
      // dependency entry binds the complete reference next to it, and never
      // stuffs a SNAPSHOT/CONTENT_ADDRESSED ref into the OBJECT mirror.
      expect(insert.decisionPayload.targetRef).toEqual({
        kind: 'OBJECT',
        objectType,
        objectId: entry.makeRef().objectId,
        scope: { enterpriseId, projectId },
      });
      // A denial path writes an audit; an ALLOW does not.
      expect(harness.auditInserts()).toEqual([]);
    }
  });

  it('binds the complete dependency reference in the canonical payload', async () => {
    const draftHarness = await signedEntry(validationDraftRead);
    expect(draftHarness.decisions[0]?.decisionPayload).toMatchObject({
      draftSnapshotRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
        objectId: draftSnapshotObjectIdA,
        scope: { enterpriseId, projectId },
        contentHash: contentHash(6),
      },
    });
    // An absent immutableVersionId is bound as absence, never serialized as null.
    expect(draftHarness.decisions[0]?.decisionPayload.draftSnapshotRef).not.toHaveProperty(
      'immutableVersionId',
    );

    const contextHarness = await signedEntry(freezeContextRead);
    expect(contextHarness.decisions[0]?.decisionPayload).toMatchObject({
      contextSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.execution.context_snapshot',
        objectId: contextSnapshotIdB,
        snapshotId: contextSnapshotIdB,
        scope: { enterpriseId, projectId },
        contentHash: contentHash(7),
      },
    });
    expect(contextHarness.decisions[0]?.decisionPayload.contextSnapshotRef).not.toHaveProperty(
      'immutableVersionId',
    );
  });

  it('binds the existence and value of immutableVersionId in the signed DRAFT Decision', async () => {
    const harness = new ValidationHarness();
    harness.grants = [grantFor(validationDraftRead)];
    const view = (await authorizeEntry(
      harnessPort(harness),
      validationDraftRead,
      harness.deps,
      authorizeInputFor(validationDraftRead, {
        draftSnapshotRef: draftSnapshotRef(draftSnapshotObjectIdA, { immutableVersionId }),
      }),
    )) as { readonly outcome: string };
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions[0]?.decisionPayload.draftSnapshotRef).toMatchObject({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.execution.work_order_draft_snapshot',
      objectId: draftSnapshotObjectIdA,
      immutableVersionId,
      scope: { enterpriseId, projectId },
      contentHash: contentHash(6),
    });
    expect(harness.auditInserts()).toEqual([]);
  });

  it('never accepts the other selector type of the slice', async () => {
    // `CREATE_TARGET_TYPE` belongs to the validation CREATE alone; `TARGET_TYPE`
    // belongs to the MUTATE/read entries. The two are never interchangeable.
    const swapped = new ValidationHarness();
    swapped.grants = [
      grantFor(validationBuild, {
        selectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order_validation' },
        ],
      }),
    ];
    const swappedView = (await authorizeEntry(
      harnessPort(swapped),
      validationBuild,
      swapped.deps,
      authorizeInputFor(validationBuild),
    )) as { readonly outcome: string; readonly reasons: readonly string[] };
    expect(swappedView.outcome).toBe('DENY');
    expect(swappedView.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(swapped.decisions).toEqual([]);

    for (const entry of [freeze, contractRead, validationDraftRead, freezeContextRead]) {
      const objectType = entry.targetObjectTypes[0];
      if (objectType === undefined) throw new Error('missing entry');
      const harness = new ValidationHarness();
      harness.grants = [
        grantFor(entry, {
          selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType }],
        }),
      ];
      const view = (await authorizeEntry(
        harnessPort(harness),
        entry,
        harness.deps,
        authorizeInputFor(entry),
      )) as { readonly outcome: string; readonly reasons: readonly string[] };
      expect(view.outcome).toBe('DENY');
      expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies every non-exact selector shape', async () => {
    const rejected: readonly unknown[] = [
      // not an array, or empty
      undefined,
      null,
      {},
      'zhiju.execution.work_order',
      [],
      // wildcard
      [{ selectorType: 'TARGET_TYPE', objectType: '*' }],
      [{ selectorType: '*', objectType: 'zhiju.execution.work_order' }],
      // case variant
      [{ selectorType: 'TARGET_TYPE', objectType: 'Zhiju.execution.work_order' }],
      [{ selectorType: 'target_type', objectType: 'zhiju.execution.work_order' }],
      // prefix / suffix / alias
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order.v1' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'work_order' }],
      // the legacy WorkOrder spelling is not this entry's target
      [{ selectorType: 'TARGET_TYPE', objectType: 'execution.work_order' }],
      // unknown or missing field
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order', extra: 'x' }],
      [{ selectorType: 'TARGET_TYPE' }],
      [{ objectType: 'zhiju.execution.work_order' }],
      [{ selector_type: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
      // non-NamespaceCode or non-string object type
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work order' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 42 }],
      [{ selectorType: 'TARGET_TYPE', objectType: null }],
      // an element that is not an object
      ['zhiju.execution.work_order'],
      [null],
      [
        { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
        { selectorType: 'TARGET_TYPE' },
      ],
      // the matching element is not the one that is well formed
      [
        { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order', extra: 'x' },
        { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
      ],
    ];
    for (const selectors of rejected) {
      const harness = new ValidationHarness();
      harness.grants = [grantFor(freeze, { selectors })];
      const view = (await authorizeEntry(
        harnessPort(harness),
        freeze,
        harness.deps,
        authorizeInputFor(freeze),
      )) as { readonly outcome: string; readonly reasons: readonly string[] };
      expect({ selectors, view: { outcome: view.outcome, reasons: view.reasons } }).toEqual({
        selectors,
        view: { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('accepts a Grant that selects the exact object type besides other selectors', async () => {
    const harness = new ValidationHarness();
    harness.grants = [
      grantFor(freeze, {
        selectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.context_snapshot' },
          { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
        ],
      }),
    ];
    const view = (await authorizeEntry(
      harnessPort(harness),
      freeze,
      harness.deps,
      authorizeInputFor(freeze),
    )) as { readonly outcome: string };
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions).toHaveLength(1);
  });

  it('never lets the Grant of another entry of the slice cover this entry', async () => {
    // Every entry demands its own covering Grant: another entry's Grant —
    // another capability code, action, selector and target — never substitutes,
    // not even within one consumer operation (Spec 001 §15.10).
    for (const entry of entries) {
      for (const other of entries) {
        if (other.boundary === entry.boundary) continue;
        const harness = new ValidationHarness();
        harness.grants = [grantFor(other)];
        const view = (await authorizeEntry(
          harnessPort(harness),
          entry,
          harness.deps,
          authorizeInputFor(entry),
        )) as { readonly outcome: string; readonly reasons: readonly string[] };
        expect({
          entry: entry.boundary,
          other: other.boundary,
          view: { outcome: view.outcome, reasons: view.reasons },
        }).toEqual({
          entry: entry.boundary,
          other: other.boundary,
          view: { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] },
        });
        expect(harness.decisions).toEqual([]);
      }
    }
  });

  it('never assembles coverage from several partial Grants', async () => {
    const harness = new ValidationHarness();
    harness.grants = [
      grantFor(freeze, { selectors: [] }),
      grantFor(freeze, { actions: [] }),
      grantFor(validationBuild, {
        capabilityCode: capabilityCodes.workOrderFreezeV1,
        actions: [freeze.requiredGrantAction],
      }),
    ];
    const view = (await authorizeEntry(
      harnessPort(harness),
      freeze,
      harness.deps,
      authorizeInputFor(freeze),
    )) as { readonly outcome: string; readonly reasons: readonly string[] };
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);
  });

  it('denies a Grant of another principal, scope, action or capability code', async () => {
    const rejected: readonly GrantOverrides[] = [
      { principalId: otherUuid },
      // Another entry's trusted capability code is not this entry's code.
      { capabilityCode: capabilityCodes.workOrderFreezeV1 },
      { capabilityCode: 'execution.work_order.validation.create.v1' },
      // Another entry's Grant action.
      { actions: ['execution.work_order.freeze.v1'] },
      { actions: [] },
      { scopeKind: 'ENTERPRISE', projectId: null },
      { projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId },
      { constraints: { reason: 'required' } },
      { maxUses: 1 },
    ];
    for (const overrides of rejected) {
      const harness = new ValidationHarness();
      harness.grants = [grantFor(validationBuild, overrides)];
      const view = (await authorizeEntry(
        harnessPort(harness),
        validationBuild,
        harness.deps,
        authorizeInputFor(validationBuild),
      )) as { readonly outcome: string; readonly reasons: readonly string[] };
      expect({ overrides, view: { outcome: view.outcome, reasons: view.reasons } }).toEqual({
        overrides,
        view: { outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies a Grant whose Policy Snapshot is absent, rewritten, not yet effective or superseded', async () => {
    const absent = new ValidationHarness();
    absent.policySnapshots = {};

    const rewritten = new ValidationHarness();
    rewritten.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ payloadHash: Buffer.alloc(32, 8) }),
    };

    const notYetEffective = new ValidationHarness();
    notYetEffective.now = new Date(policyEffectiveFrom.getTime() - 1000);

    const superseded = new ValidationHarness();
    superseded.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ supersededAt: new Date(clock.getTime() - 1000) }),
    };

    const cases: readonly (readonly [ValidationHarness, string, GrantOverrides])[] = [
      [absent, 'GRANT_POLICY_SNAPSHOT_INVALID', {}],
      [rewritten, 'GRANT_POLICY_SNAPSHOT_INVALID', { policySnapshotHash: Buffer.alloc(32, 8) }],
      [notYetEffective, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
      [superseded, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
    ];
    for (const [harness, reason, overrides] of cases) {
      harness.grants = [grantFor(validationContextRead, overrides)];
      const view = (await authorizeEntry(
        harnessPort(harness),
        validationContextRead,
        harness.deps,
        authorizeInputFor(validationContextRead),
      )) as { readonly outcome: string; readonly reasons: readonly string[] };
      expect({ reason, view: { outcome: view.outcome, reasons: view.reasons } }).toEqual({
        reason,
        view: { outcome: 'DENY', reasons: [reason] },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies an inactive principal and a Human-only capability of another kind', async () => {
    const inactive = new ValidationHarness();
    inactive.grants = [grantFor(contractRead)];
    inactive.principalStatus = 'SUSPENDED';
    const inactiveView = (await authorizeEntry(
      harnessPort(inactive),
      contractRead,
      inactive.deps,
      authorizeInputFor(contractRead),
    )) as { readonly outcome: string; readonly reasons: readonly string[] };
    expect(inactiveView.outcome).toBe('DENY');
    expect(inactiveView.reasons).toEqual(['PRINCIPAL_NOT_ACTIVE']);
    expect(inactive.decisions).toEqual([]);

    // `release.authorize` is Human-only; an Agent actor never receives it, even
    // when a Grant of that capability is configured for it.
    const humanOnly = new ValidationHarness();
    humanOnly.grants = [
      grantFor(contractRead, {
        capabilityCode: 'release.authorize',
        actions: [contractRead.requiredGrantAction],
      }),
    ];
    humanOnly.principalKind = 'AGENT';
    const humanOnlyView = (await authorizeEntry(
      harnessPort(humanOnly, {
        ...capabilityCodes,
        workOrderContractReadV1: 'release.authorize',
      }),
      contractRead,
      humanOnly.deps,
      authorizeInputFor(contractRead),
    )) as { readonly outcome: string; readonly reasons: readonly string[] };
    expect(humanOnlyView.outcome).toBe('DENY');
    expect(humanOnlyView.reasons).toEqual(['CAPABILITY_HUMAN_ONLY']);
    expect(humanOnly.decisions).toEqual([]);
  });

  it('fails closed when the owning actor snapshot read cannot match the request', async () => {
    const harness = new ValidationHarness();
    harness.grants = [grantFor(freezeDraftRead)];
    harness.actorHashMatched = false;
    await expect(
      authorizeEntry(
        harnessPort(harness),
        freezeDraftRead,
        harness.deps,
        authorizeInputFor(freezeDraftRead),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    expect(harness.decisions).toEqual([]);
  });

  it('writes only a masked in-scope DENIED audit when it denies', async () => {
    for (const entry of [freeze, freezeDraftRead]) {
      const harness = new ValidationHarness();
      const view = (await authorizeEntry(
        harnessPort(harness),
        entry,
        harness.deps,
        authorizeInputFor(entry),
      )) as { readonly outcome: string };
      expect(view.outcome).toBe('DENY');
      expect(harness.decisions).toEqual([]);
      const audits = harness.auditInserts();
      expect(audits).toHaveLength(1);
      const audit = audits[0];
      if (audit === undefined) throw new Error('no audit row was written');
      expect(audit.sql).toContain('"identity_policy"."audit_record"');
      const parameters = [...audit.parameters];
      for (const expected of [
        'DENIED',
        'NO_ACTIVE_GRANT',
        'REGULATED_AUDIT',
        correlationId,
        entry.targetObjectTypes[0] ?? '',
        entry.makeRef().objectId,
        'work-order validation authorization denied: NO_ACTIVE_GRANT',
      ]) {
        expect(parameters).toContain(expected);
      }
      // The request payload itself is never part of the denial record: only
      // its hash is.
      expect(parameters).toContain(commandPayloadHash);
    }
  });
});

describe('WorkOrder Validation/Freeze revalidation', () => {
  it('refuses an unsupported expected version before reading any decision', async () => {
    const unsupported: readonly (readonly [unknown, unknown])[] = [
      ['execution.validate_work_order_draft', '1.1'],
      ['execution.validate_work_order_draft', '2.0'],
      ['execution.freeze_work_order', '1.1'],
      ['execution.get_work_order_contract', '2.0'],
      ['execution.validate_work_order_draft', '1'],
      ['execution.freeze_work_order', 'latest'],
      ['execution.build_task_readiness', '1.0'],
      ['execution.get_work_order_draft', '1.1'],
      ['Execution.freeze_work_order', '1.0'],
      [' execution.freeze_work_order', '1.0'],
      [undefined, '1.0'],
      ['execution.freeze_work_order', undefined],
      [2, 1],
    ];
    for (const [expectedCommandType, expectedCommandVersion] of unsupported) {
      const input = {
        ...revalidationInputFor(freeze, signedEntryInsert(freeze)),
        expectedCommandType,
        expectedCommandVersion,
      };
      await expect(revalidateEntry(port(), freeze, pureDeps, input)).rejects.toMatchObject({
        code: IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
      });
    }
  });

  it('refuses an unusable trusted configuration before reading any decision', async () => {
    for (const codes of [
      {},
      { capabilityCodes: { workOrderFreezeV1: 'Execution.Work_Order.Freeze' } },
      { capabilityCodes: undefined },
    ]) {
      for (const entry of entries) {
        await expect(
          revalidateEntry(
            port(codes),
            entry,
            pureDeps,
            revalidationInputFor(entry, signedEntryInsert(entry)),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('refuses a revalidation target outside the exact accepted reference', async () => {
    // The legacy WorkOrder spelling is not the freeze target, and a malformed
    // id or a wrong dependency-ref shape fails in front of the database.
    await expect(
      revalidateEntry(port(), freeze, pureDeps, {
        ...revalidationInputFor(freeze, signedEntryInsert(freeze)),
        expectedTargetRef: targetRef('execution.work_order', workOrderId),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
    await expect(
      revalidateEntry(port(), freeze, pureDeps, {
        ...revalidationInputFor(freeze, signedEntryInsert(freeze)),
        expectedTargetRef: targetRef('zhiju.execution.work_order', 'abc'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
    await expect(
      revalidateEntry(port(), validationContextRead, pureDeps, {
        ...revalidationInputFor(validationContextRead, signedEntryInsert(validationContextRead)),
        expectedContextSnapshotRef: contextSnapshotRef(contextSnapshotIdA, {
          objectType: 'zhiju.project.context_snapshot',
        }),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
    await expect(
      revalidateEntry(port(), freezeDraftRead, pureDeps, {
        ...revalidationInputFor(freezeDraftRead, signedEntryInsert(freezeDraftRead)),
        expectedDraftSnapshotRef: {
          ...draftSnapshotRef(draftSnapshotObjectIdB),
          contentHash: {
            algorithm: 'SHA-512',
            digest: 'a'.repeat(64),
            canonicalizationVersion: '1',
          },
        },
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
  });

  it('accepts the Decision this Port signed, for each of the seven entries', async () => {
    for (const entry of entries) {
      const harness = await signedEntry(entry);
      const signed = harness.lastSigned();
      const result = (await revalidateEntry(
        harnessPort(harness),
        entry,
        harness.deps,
        revalidationInputFor(entry, signed),
      )) as { readonly valid: boolean; readonly expiresAt?: string };
      expect({ boundary: entry.boundary, result }).toEqual({
        boundary: entry.boundary,
        result: expect.objectContaining({
          valid: true,
          expiresAt: new Date(clock.getTime() + decisionTtlMs).toISOString(),
        }),
      });
    }
  });

  it('accepts the signed DRAFT dependency Decision with an immutableVersionId', async () => {
    const harness = new ValidationHarness();
    harness.grants = [grantFor(validationDraftRead)];
    const view = (await authorizeEntry(
      harnessPort(harness),
      validationDraftRead,
      harness.deps,
      authorizeInputFor(validationDraftRead, {
        draftSnapshotRef: draftSnapshotRef(draftSnapshotObjectIdA, { immutableVersionId }),
      }),
    )) as { readonly outcome: string };
    expect(view.outcome).toBe('ALLOW');
    const result = (await revalidateEntry(
      harnessPort(harness),
      validationDraftRead,
      harness.deps,
      revalidationInputFor(validationDraftRead, harness.lastSigned()),
    )) as { readonly valid: boolean };
    expect(result.valid).toBe(true);
  });

  it('refuses a historical Decision that carries no target binding', async () => {
    const harness = await signedEntry(freeze);
    const unbound = decisionRow(harness.lastSigned(), { dropTargetRef: true });
    harness.decisionOverride = unbound;
    const result = await revalidateEntry(
      harnessPort(harness),
      freeze,
      harness.deps,
      revalidationInputFor(freeze, harness.lastSigned(), unbound.payload_hash),
    );
    expect(result).toEqual({ valid: false, reason: 'TARGET_UNBOUND' });
  });

  it('refuses every substituted dimension with its own reason', async () => {
    interface Substitution {
      readonly name: string;
      readonly reason: string;
      readonly apply: (
        harness: ValidationHarness,
        signed: AuthorizationDecisionInsert,
      ) => Record<string, unknown> | undefined;
    }
    const defaultInput = (
      harness: ValidationHarness,
      signed: AuthorizationDecisionInsert,
    ): Record<string, unknown> => revalidationInputFor(freeze, signed);
    const substitutions: readonly Substitution[] = [
      {
        name: 'a Decision that is not stored',
        reason: 'NOT_FOUND',
        apply: (harness) => {
          harness.decisionOverride = null;
          return undefined;
        },
      },
      {
        name: 'a substituted Decision hash',
        reason: 'HASH_MISMATCH',
        apply: (harness, signed) => {
          const input = defaultInput(harness, signed);
          const ref = input.decisionRef as Common.ContentAddressedRef;
          return { ...input, decisionRef: { ...ref, contentHash: contentHash(9) } };
        },
      },
      {
        name: 'a rewritten Decision row',
        reason: 'DECISION_INTEGRITY_MISMATCH',
        apply: (harness, signed) => {
          harness.decisionOverride = {
            ...decisionRow(signed),
            target_object_id: otherUuid,
          };
          return undefined;
        },
      },
      {
        name: 'a Decision of another actor snapshot',
        reason: 'ACTOR_MISMATCH',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({ ...signed, actorSnapshotId: otherUuid });
          return undefined;
        },
      },
      {
        name: 'a Decision that is not an ALLOW',
        reason: 'NOT_ALLOW',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({ ...signed, outcome: 'DENY' });
          return undefined;
        },
      },
      {
        name: 'a Decision bound to another target id',
        reason: 'TARGET_MISMATCH',
        apply: (harness, signed) => ({
          ...defaultInput(harness, signed),
          expectedTargetRef: targetRef('zhiju.execution.work_order', otherUuid),
        }),
      },
      {
        name: 'a Decision bound to the legacy WorkOrder spelling',
        reason: 'TARGET_MISMATCH',
        apply: (harness, signed) => {
          // The Decision is bound to the legacy spelling while the presented
          // request is the canonical freeze: the legacy spelling never
          // authorizes this slice. The row stays internally consistent, so it
          // is refused by the exact target comparison and not by integrity.
          const payload: CanonicalJsonObject = {
            ...signed.decisionPayload,
            targetRef: {
              kind: 'OBJECT',
              objectType: 'execution.work_order',
              objectId: workOrderId,
              scope: { enterpriseId, projectId },
            },
          };
          harness.decisionOverride = decisionRow({
            ...signed,
            targetRef: { objectType: 'execution.work_order', objectId: workOrderId },
            decisionPayload: payload,
          });
          return undefined;
        },
      },
      {
        name: 'a Decision reference without the Project Scope',
        reason: 'SCOPE_MISMATCH',
        apply: (harness, signed) => {
          const input = defaultInput(harness, signed);
          const ref = input.decisionRef as Common.ContentAddressedRef;
          return { ...input, decisionRef: { ...ref, scope: {} } };
        },
      },
      {
        name: 'a Decision of another consumer operation',
        reason: 'COMMAND_MISMATCH',
        apply: (harness, signed) => {
          // The validation-build Decision of the same target family never
          // authorizes the freeze boundary.
          harness.decisionOverride = decisionRow({
            ...signed,
            commandType: 'execution.validate_work_order_draft',
          });
          return undefined;
        },
      },
      {
        name: 'a Decision of another Purpose',
        reason: 'COMMAND_MISMATCH',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({
            ...signed,
            purpose: WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
          });
          return undefined;
        },
      },
      {
        name: 'a Decision of a drifted capability configuration',
        reason: 'CONFIGURATION_CHANGED',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({
            ...signed,
            requestedCapability: capabilityCodes.workOrderContractReadV1,
          });
          return undefined;
        },
      },
      {
        name: 'a different command payload hash',
        reason: 'PAYLOAD_HASH_MISMATCH',
        apply: (harness, signed) => ({
          ...defaultInput(harness, signed),
          expectedCommandPayloadHash: Buffer.alloc(32, 11),
        }),
      },
      {
        name: 'a different authentication context',
        reason: 'AUTH_CONTEXT_MISMATCH',
        apply: (harness, signed) => ({
          ...defaultInput(harness, signed),
          expectedAuthenticationContextHash: Buffer.alloc(32, 12),
        }),
      },
      {
        name: 'an expired Decision',
        reason: 'EXPIRED',
        apply: (harness) => {
          harness.now = new Date(clock.getTime() + decisionTtlMs);
          return undefined;
        },
      },
      {
        name: 'an inactive principal',
        reason: 'PRINCIPAL_NOT_ACTIVE',
        apply: (harness) => {
          harness.principalStatus = 'SUSPENDED';
          return undefined;
        },
      },
      {
        name: 'a revoked Grant',
        reason: 'GRANT_NOT_CURRENT',
        apply: (harness) => {
          harness.grants = [];
          return undefined;
        },
      },
      {
        name: "only another entry's Grant",
        reason: 'GRANT_NOT_CURRENT',
        apply: (harness) => {
          harness.grants = [grantFor(freezeDraftRead)];
          return undefined;
        },
      },
      {
        name: 'a superseded Policy Snapshot',
        reason: 'POLICY_NOT_CURRENT',
        apply: (harness) => {
          harness.policySnapshots[policySnapshotId] = policySnapshotRow({
            supersededAt: new Date(clock.getTime() - 1000),
          });
          return undefined;
        },
      },
      {
        name: 'a rewritten Policy Snapshot',
        reason: 'POLICY_INTEGRITY_MISMATCH',
        apply: (harness) => {
          // The Grant and the Decision still name the same Snapshot hash, but
          // the stored row no longer hashes to it: it must be refused before
          // any of its fields is interpreted.
          harness.policySnapshots[policySnapshotId] = policySnapshotRow({
            policySetVersion: `${policySetVersion}-rewritten`,
          });
          return undefined;
        },
      },
    ];

    for (const substitution of substitutions) {
      const harness = await signedEntry(freeze);
      const signed = harness.lastSigned();
      const input = substitution.apply(harness, signed);
      // A substitution that replaces the stored row changes its payload hash,
      // so the Decision reference must name the row that is actually stored.
      const result = await revalidateEntry(
        harnessPort(harness),
        freeze,
        harness.deps,
        input ?? revalidationInputFor(freeze, signed, harness.storedDecisionHash()),
      );
      expect({ name: substitution.name, result }).toEqual({
        name: substitution.name,
        result: { valid: false, reason: substitution.reason },
      });
    }
  });

  it('refuses a hash or version-id substitution behind the same promoted id (DRAFT reads)', async () => {
    for (const entry of [validationDraftRead, freezeDraftRead]) {
      const objectId = (entry.makeRef() as Common.ContentAddressedRef).objectId;
      {
        // content hash substitution
        const harness = await signedEntry(entry);
        const signed = harness.lastSigned();
        const result = await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: draftSnapshotRef(objectId, { contentHash: contentHash(9) }),
        });
        expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
      }
      {
        // version id added to a Decision that bound its absence
        const harness = await signedEntry(entry);
        const signed = harness.lastSigned();
        const result = await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: draftSnapshotRef(objectId, { immutableVersionId }),
        });
        expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
      }
      {
        // version id removed from, or replaced behind, the same promoted id
        const harness = new ValidationHarness();
        harness.grants = [grantFor(entry)];
        const view = (await authorizeEntry(
          harnessPort(harness),
          entry,
          harness.deps,
          authorizeInputFor(entry, {
            draftSnapshotRef: draftSnapshotRef(objectId, { immutableVersionId }),
          }),
        )) as { readonly outcome: string };
        expect(view.outcome).toBe('ALLOW');
        const signed = harness.lastSigned();
        const removed = await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: draftSnapshotRef(objectId),
        });
        expect(removed).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
        const replaced = await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: draftSnapshotRef(objectId, {
            immutableVersionId: otherUuid,
          }),
        });
        expect(replaced).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
      }
    }
  });

  it('binds an independent Context snapshot identity and refuses its substitution', async () => {
    for (const entry of [validationContextRead, freezeContextRead]) {
      const harness = new ValidationHarness();
      harness.grants = [grantFor(entry)];
      const ref = { ...entry.makeRef(), snapshotId: otherUuid };
      const view = await authorizeEntry(
        harnessPort(harness),
        entry,
        harness.deps,
        authorizeInputFor(entry, { contextSnapshotRef: ref }),
      );
      expect(view).toMatchObject({ outcome: 'ALLOW' });
      const signed = harness.lastSigned();
      expect(
        await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: ref,
        }),
      ).toMatchObject({ valid: true });
      expect(
        await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: entry.makeRef(),
        }),
      ).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
    }
  });

  it('refuses a hash or scope substitution behind the same promoted id (Context reads)', async () => {
    for (const entry of [validationContextRead, freezeContextRead]) {
      const objectId = (entry.makeRef() as Common.SnapshotRef).objectId;
      {
        // content hash substitution
        const harness = await signedEntry(entry);
        const signed = harness.lastSigned();
        const result = await revalidateEntry(harnessPort(harness), entry, harness.deps, {
          ...revalidationInputFor(entry, signed),
          [expectedFieldOf(entry)]: contextSnapshotRef(objectId, { contentHash: contentHash(9) }),
        });
        expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
      }
      {
        // scope substitution fails at the target gate, before any read
        const harness = await signedEntry(entry);
        const signed = harness.lastSigned();
        await expect(
          revalidateEntry(harnessPort(harness), entry, harness.deps, {
            ...revalidationInputFor(entry, signed),
            [expectedFieldOf(entry)]: contextSnapshotRef(objectId, {
              scope: { enterpriseId, projectId: foreignProjectId },
            }),
          }),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID });
      }
    }
  });

  it('never lets the Decision of one entry authorize another entry', async () => {
    // The validation DRAFT dependency Decision of the same consumer operation
    // never authorizes the freeze DRAFT dependency read.
    const draftHarness = await signedEntry(validationDraftRead);
    const draftSigned = draftHarness.lastSigned();
    const crossDraft = await revalidateEntry(
      harnessPort(draftHarness),
      freezeDraftRead,
      draftHarness.deps,
      {
        // The Decision carries the consumer pair of the validation operation;
        // the freeze entry demands its own pair before it compares anything.
        ...revalidationInputFor(freezeDraftRead, draftSigned),
        expectedCommandType: 'execution.freeze_work_order',
        expectedCommandVersion: '1.0',
        expectedDraftSnapshotRef: draftSnapshotRef(draftSnapshotObjectIdA),
      },
    );
    expect(crossDraft).toEqual({ valid: false, reason: 'COMMAND_MISMATCH' });

    // The validation Context dependency Decision never authorizes the
    // validation DRAFT dependency read of the same consumer operation.
    const contextHarness = await signedEntry(validationContextRead);
    const contextSigned = contextHarness.lastSigned();
    const crossKind = await revalidateEntry(
      harnessPort(contextHarness),
      validationDraftRead,
      contextHarness.deps,
      {
        // The Context Decision carries no draftSnapshotRef member, so the
        // request is assembled by hand: the stored row of the Context entry,
        // the shared consumer pair, and the DRAFT target it must refuse.
        decisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'identity.authorization_decision',
          objectId: contextSigned.authorizationDecisionId,
          scope: projectScope,
          contentHash: contentHash(decisionRow(contextSigned).payload_hash),
        },
        expectedCommandType: contextSigned.commandType,
        expectedCommandVersion: contextSigned.commandVersion,
        expectedCommandPayloadHash: contextSigned.commandPayloadHash,
        expectedAuthenticationContextHash: contextSigned.authenticationContextHash,
        expectedDraftSnapshotRef: draftSnapshotRef(draftSnapshotObjectIdA),
      },
    );
    expect(crossKind).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });

    // The own freeze Decision never authorizes the contract read of the same
    // WorkOrder spelling.
    const freezeHarness = await signedEntry(freeze);
    const freezeSigned = freezeHarness.lastSigned();
    const crossRead = await revalidateEntry(
      harnessPort(freezeHarness),
      contractRead,
      freezeHarness.deps,
      {
        // The freeze Decision carries the freeze consumer pair; the contract
        // read demands its own pair before it compares anything.
        ...revalidationInputFor(contractRead, freezeSigned),
        expectedCommandType: 'execution.get_work_order_contract',
        expectedCommandVersion: '1.0',
      },
    );
    expect(crossRead).toEqual({ valid: false, reason: 'COMMAND_MISMATCH' });
  });

  it('never lets the Decision of one snapshot authorize another snapshot', async () => {
    // Snapshot B has its own id and its own hash; the lawful Decision of
    // snapshot A covers neither (Spec 001 §15.10).
    const harness = await signedEntry(freezeContextRead);
    const signed = harness.lastSigned();
    const snapshotB = contextSnapshotRef(otherUuid, { contentHash: contentHash(9) });
    const result = await revalidateEntry(harnessPort(harness), freezeContextRead, harness.deps, {
      ...revalidationInputFor(freezeContextRead, signed),
      expectedContextSnapshotRef: snapshotB,
    });
    expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
  });
});

/** The revalidation request member that carries the target of this entry. */
function expectedFieldOf(entry: EntryCase): string {
  return entry.refField === 'targetRef'
    ? 'expectedTargetRef'
    : entry.refField === 'draftSnapshotRef'
      ? 'expectedDraftSnapshotRef'
      : 'expectedContextSnapshotRef';
}
