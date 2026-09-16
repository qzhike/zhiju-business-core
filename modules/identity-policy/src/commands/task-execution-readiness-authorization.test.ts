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
import {
  createTaskExecutionReadinessAuthorizationPort,
  IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID,
  IDENTITY_READINESS_TARGET_INVALID,
  TASK_EXECUTION_READINESS_BINDINGS,
  TASK_READINESS_BUILD_PURPOSE,
  TASK_READY_PURPOSE,
  type TaskExecutionReadinessAuthorizationConfig,
  type TaskExecutionReadinessAuthorizationInput,
  type TaskExecutionReadinessAuthorizationPort,
  type TaskExecutionReadinessBinding,
  type TaskExecutionReadinessCapabilityKey,
  type TaskExecutionReadinessRevalidationInput,
} from './task-execution-readiness-authorization.js';

// Every refusal in the first half of this suite happens before the trusted
// transaction is opened: an unknown operation version, an unusable trusted
// configuration, a target outside the entry's closed objectType set, a foreign
// actor snapshot and an invalid request hash all fail closed in front of the
// database. Those tests therefore stub `deps` with the trusted transaction
// context alone — a request that slipped past those gates would fail loudly on
// the missing `db`/`repo` instead of silently authorizing. The accepted
// continuation of each approved entry is asserted through the exact gate it
// reaches, which is what a pure suite can observe.
//
// The second half drives the Grant, Policy and Decision logic inside the
// transaction. It uses no database: a recording Kysely driver answers every
// statement in memory, so the Port's real SQL is compiled and executed while
// the rows, the Audit writes and the Decision inserts are observed directly.

/** The approved Spec 001 §15.5 rows, transcribed here instead of imported. */
interface ApprovedRow {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'OBJECT';
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: TaskExecutionReadinessBinding['selectorType'];
  readonly capabilityConfigKey: TaskExecutionReadinessCapabilityKey;
  /** The target the default request of this entry submits. */
  readonly targetObjectType: string;
  readonly targetObjectId: string;
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
const readinessObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d021';
const taskObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d022';
const policySnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d031';
const commandPayloadHash = Buffer.alloc(32, 3);
const authenticationContextHash = Buffer.alloc(32, 4);
const clock = new Date('2026-09-16T00:00:00.000Z');
const decisionTtlMs = 300 * 1000;

const buildApproved: ApprovedRow = {
  commandType: 'execution.build_task_readiness',
  commandVersion: '1.0',
  authorizationPurpose: TASK_READINESS_BUILD_PURPOSE,
  requiredGrantAction: 'execution.task.readiness.build',
  targetKind: 'OBJECT',
  targetObjectTypes: ['zhiju.execution.task_readiness'],
  selectorType: 'CREATE_TARGET_TYPE',
  capabilityConfigKey: 'taskReadinessBuildV1',
  targetObjectType: 'zhiju.execution.task_readiness',
  targetObjectId: readinessObjectId,
};

const readyApproved: ApprovedRow = {
  commandType: 'execution.mark_task_ready',
  commandVersion: '1.0',
  authorizationPurpose: TASK_READY_PURPOSE,
  requiredGrantAction: 'execution.task.mark_ready',
  targetKind: 'OBJECT',
  // The two published Task identities of Spec 003 §16.1, as a closed set.
  targetObjectTypes: ['execution.task', 'zhiju.execution.task'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'taskReadyV1',
  targetObjectType: 'execution.task',
  targetObjectId: taskObjectId,
};

const approved: readonly ApprovedRow[] = [buildApproved, readyApproved];

/** The exact Project Scope one readiness request runs in. */
const projectScope: Common.ScopeRef = { enterpriseId, projectId };

const context: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId,
  actorSnapshotId,
  authorizationDecisionId,
  authorizationDecisionHash: Buffer.alloc(32, 1),
  authorizationDecisionExpiresAt: new Date('2026-09-15T00:00:00.000Z'),
  enterpriseId,
  allowedProjectIds: [projectId],
  correlationId,
};

const pureDeps = { context } as unknown as IdentityCommandDeps;

/** One capability code per approved entry, all distinct and all valid. */
const capabilityCodes: Readonly<Record<TaskExecutionReadinessCapabilityKey, string>> = {
  taskReadinessBuildV1: 'execution.task.readiness.build',
  taskReadyV1: 'execution.task.mark_ready',
};

/** The Port under test with the pure trusted configuration. */
function port(codes: unknown = capabilityCodes): TaskExecutionReadinessAuthorizationPort {
  return createTaskExecutionReadinessAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as TaskExecutionReadinessAuthorizationConfig);
}

/** The Port under test driven by the harness clock. */
function harnessPort(
  harness: ReadinessHarness,
  codes: unknown = capabilityCodes,
): TaskExecutionReadinessAuthorizationPort {
  return createTaskExecutionReadinessAuthorizationPort({
    capabilityCodes: codes,
    now: () => harness.now,
  } as unknown as TaskExecutionReadinessAuthorizationConfig);
}

/** A trusted configuration in which only one approved entry is usable. */
function portWithOnlyUsable(key: TaskExecutionReadinessCapabilityKey) {
  const codes: Record<string, unknown> = {};
  for (const candidate of Object.keys(capabilityCodes)) codes[candidate] = '';
  codes[key] = capabilityCodes[key];
  return port(codes);
}

function contentHash(seed: number | Buffer): Common.ContentHash {
  const digest = Buffer.isBuffer(seed) ? seed : Buffer.alloc(32, seed);
  return { algorithm: 'SHA-256', digest: digest.toString('hex'), canonicalizationVersion: '1' };
}

function approvedRow(commandType: string, commandVersion: string): ApprovedRow {
  const found = approved.find(
    (candidate) =>
      candidate.commandType === commandType && candidate.commandVersion === commandVersion,
  );
  if (found === undefined) {
    throw new Error(`unapproved readiness version ${commandType}@${commandVersion}`);
  }
  return found;
}

function targetRef(
  objectType: string,
  objectId: string = readinessObjectId,
  scope: Common.ScopeRef = projectScope,
): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope };
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
function validInput(row: ApprovedRow): TaskExecutionReadinessAuthorizationInput {
  return {
    actorSnapshotRef: actorSnapshotRef(),
    commandType: row.commandType,
    commandVersion: row.commandVersion,
    targetRef: targetRef(row.targetObjectType, row.targetObjectId),
    commandPayloadHash,
    authenticationContextHash,
  };
}

/** The same request with one substituted member, which the type cannot express. */
function readinessInput(
  commandType: string,
  commandVersion: string,
  overrides: Readonly<Record<string, unknown>> = {},
): TaskExecutionReadinessAuthorizationInput {
  return {
    ...validInput(approvedRow(commandType, commandVersion)),
    ...overrides,
  };
}

function projection(rows: readonly TaskExecutionReadinessBinding[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.capabilityConfigKey}`,
    )
    .sort();
}

function specProjection(rows: readonly ApprovedRow[]): string[] {
  return rows
    .map(
      (row) =>
        `${row.commandType}@${row.commandVersion}|${row.authorizationPurpose}|${row.requiredGrantAction}|${row.targetKind}|${[...row.targetObjectTypes].sort().join(',')}|${row.selectorType}|${row.capabilityConfigKey}`,
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
    capability_code: overrides.capabilityCode ?? capabilityCodes.taskReadinessBuildV1,
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

/** The Grant that covers the producer entry of the default target. */
function buildGrant(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return grantRow({
    capabilityCode: capabilityCodes.taskReadinessBuildV1,
    actions: [buildApproved.requiredGrantAction],
    selectors: [
      { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' },
    ],
    ...overrides,
  });
}

/** The Grant that covers the consumer entry of the `execution.task` spelling. */
function readyGrant(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return grantRow({
    capabilityCode: capabilityCodes.taskReadyV1,
    actions: [readyApproved.requiredGrantAction],
    selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'execution.task' }],
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
class ReadinessHarness {
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
      listActiveCapabilityGrants: (_trx: unknown, principalId: string, enterpriseId: string) =>
        Promise.resolve(
          this.grants.filter(
            (grant) =>
              (grant as SelectedCapabilityGrant).principal_id === principalId &&
              (grant as SelectedCapabilityGrant).enterprise_id === enterpriseId,
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

/** A harness holding the Grant that covers the producer entry of the default target. */
async function signedBuild(): Promise<ReadinessHarness> {
  const harness = new ReadinessHarness();
  harness.grants = [buildGrant()];
  const view = await harnessPort(harness).authorizeReadiness(
    harness.deps,
    readinessInput(buildApproved.commandType, buildApproved.commandVersion),
  );
  expect(view.outcome).toBe('ALLOW');
  return harness;
}

/** The revalidation request that matches the Decision a harness signed. */
function revalidationInputFor(
  insert: AuthorizationDecisionInsert,
  decisionPayloadHash: Buffer = decisionRow(insert).payload_hash,
): TaskExecutionReadinessRevalidationInput {
  const target = insert.targetRef;
  if (target === undefined) throw new Error('the signed Decision carries no target binding');
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
    expectedTargetRef: targetRef(target.objectType, target.objectId),
  };
}

describe('approved readiness authorization bindings', () => {
  it('publishes exactly the two approved rows and nothing else', () => {
    expect(TASK_EXECUTION_READINESS_BINDINGS).toHaveLength(approved.length);
    expect(projection(TASK_EXECUTION_READINESS_BINDINGS)).toEqual(specProjection(approved));
  });

  it('publishes the Purpose of each approved key instead of resolving it elsewhere', () => {
    expect(TASK_READINESS_BUILD_PURPOSE).toBe('execution.task.readiness.build');
    expect(TASK_READY_PURPOSE).toBe('task.execution.mark_task_ready');
    const purposes = new Map(
      TASK_EXECUTION_READINESS_BINDINGS.map((row) => [
        row.capabilityConfigKey,
        row.authorizationPurpose,
      ]),
    );
    expect(purposes.get('taskReadinessBuildV1')).toBe(TASK_READINESS_BUILD_PURPOSE);
    expect(purposes.get('taskReadyV1')).toBe(TASK_READY_PURPOSE);
  });

  it('keeps the two entries mutually independent', () => {
    // Two entries, and every dimension that could carry coverage from one to
    // the other is disjoint: Purpose, Grant action, selector type, trusted
    // configuration key and target object type set.
    const [first, second] = TASK_EXECUTION_READINESS_BINDINGS;
    expect(TASK_EXECUTION_READINESS_BINDINGS).toHaveLength(2);
    if (first === undefined || second === undefined) throw new Error('missing approved rows');
    expect(first.authorizationPurpose).not.toBe(second.authorizationPurpose);
    expect(first.requiredGrantAction).not.toBe(second.requiredGrantAction);
    expect(first.selectorType).not.toBe(second.selectorType);
    expect(first.capabilityConfigKey).not.toBe(second.capabilityConfigKey);
    for (const objectType of first.targetObjectTypes) {
      expect(second.targetObjectTypes).not.toContain(objectType);
    }
  });
});

describe('readiness authorization: exact operation version', () => {
  it('refuses an unknown operation, an alias and a case variant', async () => {
    for (const commandType of [
      'execution.build_task_readiness_v1',
      'execution.build_task_readinesses',
      'execution.build_readiness',
      'execution.task_readiness.build',
      'execution.mark_task_readys',
      'execution.mark_ready',
      'execution.mark_task_ready_v1',
      'execution.create_task',
      'execution',
      'executions.mark_task_ready',
      'Execution.mark_task_ready',
      'execution.Mark_Task_Ready',
      'EXECUTION.MARK_TASK_READY',
      ' execution.mark_task_ready',
      'execution.mark_task_ready ',
      '\texecution.mark_task_ready',
      'execution.mark_task_ready@1.0',
      'execution.mark_task_ready?version=1.0',
      '',
      '*',
      'execution.*',
      'latest',
    ]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput('execution.mark_task_ready', '1.0', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses a non-string operation or version', async () => {
    for (const commandType of [undefined, null, 1, true, {}, ['execution.mark_task_ready']]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput('execution.mark_task_ready', '1.0', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED });
    }
    for (const commandVersion of [undefined, null, 1, true, {}, ['1.0']]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput('execution.mark_task_ready', '1.0', { commandVersion }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses an unknown, missing or non-exact version without a fallback', async () => {
    for (const commandVersion of [
      '1',
      '2',
      '3.0',
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
      for (const row of approved) {
        await expect(
          port().authorizeReadiness(
            pureDeps,
            readinessInput(row.commandType, row.commandVersion, { commandVersion }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED });
      }
    }
  });
});

describe('readiness authorization: trusted capability configuration', () => {
  it('refuses a missing, blank or non-NamespaceCode capability code of either entry', async () => {
    const unusable: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Task.Readiness.Build',
      'task readiness build',
      'task\treadiness',
      '1task',
      'task..readiness',
      'task-readiness',
      '.task',
      'task.',
      '_task',
      'task.readiness.',
      'TASK.READINESS',
      'task/readiness',
      'task.readiness@2',
      42,
      ['task.readiness'],
      { code: 'task.readiness' },
    ];
    for (const row of approved) {
      for (const value of unusable) {
        const codes: Record<string, unknown> = { ...capabilityCodes };
        codes[row.capabilityConfigKey] = value;
        await expect(
          port(codes).authorizeReadiness(pureDeps, validInput(row)),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID });
      }
      // The same trusted configuration without that key at all.
      const withoutKey: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(capabilityCodes)) {
        if (key !== row.capabilityConfigKey) withoutKey[key] = value;
      }
      await expect(
        port(withoutKey).authorizeReadiness(pureDeps, validInput(row)),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses a configuration object that carries no capability codes instead of crashing', async () => {
    for (const codes of [
      {},
      { capabilityCodes: undefined },
      { capabilityCodes: null },
      { capabilityCodes: 'execution.task.readiness.build' },
      { capabilityCodes: [] },
      { now: (): Date => clock },
    ]) {
      for (const row of approved) {
        await expect(
          port(codes).authorizeReadiness(pureDeps, validInput(row)),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('binds each entry to its own trusted configuration key', async () => {
    for (const row of approved) {
      // Its own trusted key carries the request past the configuration gate to
      // the request-hash gate, which is the gate directly behind it.
      await expect(
        portWithOnlyUsable(row.capabilityConfigKey).authorizeReadiness(
          pureDeps,
          readinessInput(row.commandType, row.commandVersion, {
            commandPayloadHash: Buffer.alloc(31, 9),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });

      // A configuration that holds a code only for the other entry authorizes
      // nothing here: the resolved entry never reads a neighbouring key.
      for (const other of approved) {
        if (other.capabilityConfigKey === row.capabilityConfigKey) continue;
        await expect(
          portWithOnlyUsable(other.capabilityConfigKey).authorizeReadiness(
            pureDeps,
            validInput(row),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID });
      }
    }
  });
});

describe('readiness authorization: target reference', () => {
  it('accepts only the single approved readiness object type of the producer entry', async () => {
    // The producer target must be the exact registered targetObjectType; every
    // other object type, including the two Task spellings, is refused.
    for (const objectType of [
      'execution.task',
      'zhiju.execution.task',
      'zhiju.execution.task_readinesses',
      'zhiju.execution.task_readiness.snapshot',
      'Zhiju.execution.task_readiness',
      'ZHiju.execution.task_readiness',
      'zhiju.execution',
      'execution.task_readiness',
      '*',
      'latest',
      '',
    ]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            targetRef: targetRef(objectType, readinessObjectId),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
    }
    // The approved spelling itself passes this gate and reaches the request
    // hash gate behind it.
    await expect(
      port().authorizeReadiness(
        pureDeps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
  });

  it('accepts both published Task spellings of the consumer entry', async () => {
    // The consumer entry declares a closed set of two accepted Task identities
    // because the two published creation paths each spell the Task their own
    // way (Spec 003 §16.1). Which spelling is *business-correct* for a given
    // Task is decided by the owning TaskExecution handler from that Task's
    // immutable creation facts (R-206-1) — this Port only proves that the
    // declared spelling is one of the two published ones and that the covering
    // Grant selects exactly that spelling. Both spellings therefore pass the
    // target gate and reach the request hash gate behind it.
    for (const objectType of readyApproved.targetObjectTypes) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(readyApproved.commandType, readyApproved.commandVersion, {
            targetRef: targetRef(objectType, taskObjectId),
            commandPayloadHash: Buffer.alloc(31, 9),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
    // A third spelling is not an alias of either published identity.
    for (const objectType of [
      'execution.tasks',
      'zhiju.execution.tasks',
      'execution.task.v1',
      'zhiju.execution.task.snapshot',
      'Execution.task',
      'execution.Task',
      'zhiju.execution',
      'execution',
      '*',
      '',
    ]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(readyApproved.commandType, readyApproved.commandVersion, {
            targetRef: targetRef(objectType, taskObjectId),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
    }
  });

  it('refuses a target id that is not a UuidV7', async () => {
    for (const objectId of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d021',
      '018f22e2-7c15-7b2e-cd86-2de956a9d021',
      '018f22e2-7c15-7b2e-8d86-2de956a9d02',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D021',
      '018f22e2-7c15-7b2e-8d86-2de956a9d021 ',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0210',
    ]) {
      for (const row of approved) {
        await expect(
          port().authorizeReadiness(
            pureDeps,
            readinessInput(row.commandType, row.commandVersion, {
              targetRef: targetRef(row.targetObjectType, objectId),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
      }
    }
  });

  it('refuses a reference that is not an exact OBJECT reference', async () => {
    for (const kind of ['CONTENT_ADDRESSED', 'VERSIONED', 'SNAPSHOT', 'object', '', undefined]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            targetRef: { ...targetRef('zhiju.execution.task_readiness'), kind },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
    }
    for (const target of [undefined, null, 'zhiju.execution.task_readiness', 42]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            targetRef: target,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
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
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            targetRef: { ...targetRef('zhiju.execution.task_readiness'), scope },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
    }
  });
});

describe('readiness authorization: actor snapshot and request facts', () => {
  it('refuses an actor snapshot outside the exact request Project', async () => {
    for (const scope of [
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      {},
    ]) {
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            actorSnapshotRef: { ...actorSnapshotRef(), scope },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
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
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            actorSnapshotRef: actorSnapshot,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses an actor snapshot that is not the trusted transaction actor', async () => {
    await expect(
      port().authorizeReadiness(
        pureDeps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
          actorSnapshotRef: {
            ...actorSnapshotRef(),
            objectId: otherUuid,
            snapshotId: otherUuid,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    // The trusted actor itself still passes this gate and reaches the hash
    // checks of the same request.
    await expect(
      port().authorizeReadiness(
        pureDeps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
          commandPayloadHash: Buffer.alloc(31, 3),
        }),
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
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            commandPayloadHash: hash,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      await expect(
        port().authorizeReadiness(
          pureDeps,
          readinessInput(buildApproved.commandType, buildApproved.commandVersion, {
            authenticationContextHash: hash,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });
});

describe('readiness authorization: single covering Grant', () => {
  it('signs the exact target-bound build Decision of the producer entry', async () => {
    const harness = await signedBuild();
    expect(harness.decisions).toHaveLength(1);
    expect(harness.decisions[0]).toMatchObject({
      outcome: 'ALLOW',
      commandType: 'execution.build_task_readiness',
      commandVersion: '1.0',
      purpose: TASK_READINESS_BUILD_PURPOSE,
      requestedCapability: capabilityCodes.taskReadinessBuildV1,
      scopeKind: 'PROJECT',
      enterpriseId,
      projectId,
      targetRef: { objectType: 'zhiju.execution.task_readiness', objectId: readinessObjectId },
    });
    // A denial path writes an audit; an ALLOW does not.
    expect(harness.auditInserts()).toEqual([]);
  });

  it('signs the consumer Decision under the Task spelling the request declares', async () => {
    for (const objectType of readyApproved.targetObjectTypes) {
      const harness = new ReadinessHarness();
      harness.grants = [readyGrant({ selectors: [{ selectorType: 'TARGET_TYPE', objectType }] })];
      const view = await harnessPort(harness).authorizeReadiness(
        harness.deps,
        readinessInput(readyApproved.commandType, readyApproved.commandVersion, {
          targetRef: targetRef(objectType, taskObjectId),
        }),
      );
      expect(view.outcome).toBe('ALLOW');
      expect(harness.decisions[0]).toMatchObject({
        commandType: 'execution.mark_task_ready',
        commandVersion: '1.0',
        purpose: TASK_READY_PURPOSE,
        requestedCapability: capabilityCodes.taskReadyV1,
        targetRef: { objectType, objectId: taskObjectId },
      });
      expect(harness.auditInserts()).toEqual([]);
    }
  });

  it('denies a Grant whose selector type belongs to the other entry', async () => {
    // The producer's selector type never covers the consumer action and the
    // consumer's never covers build: the two types are not interchangeable.
    const consumerHarness = new ReadinessHarness();
    consumerHarness.grants = [
      readyGrant({
        selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.task' }],
      }),
    ];
    const consumerView = await harnessPort(consumerHarness).authorizeReadiness(
      consumerHarness.deps,
      readinessInput(readyApproved.commandType, readyApproved.commandVersion),
    );
    expect(consumerView.outcome).toBe('DENY');
    expect(consumerView.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(consumerHarness.decisions).toEqual([]);

    const producerHarness = new ReadinessHarness();
    producerHarness.grants = [
      buildGrant({
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' }],
      }),
    ];
    const producerView = await harnessPort(producerHarness).authorizeReadiness(
      producerHarness.deps,
      readinessInput(buildApproved.commandType, buildApproved.commandVersion),
    );
    expect(producerView.outcome).toBe('DENY');
    expect(producerView.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(producerHarness.decisions).toEqual([]);
  });

  it('denies every non-exact selector shape', async () => {
    const rejected: readonly unknown[] = [
      // not an array, or empty
      undefined,
      null,
      {},
      'zhiju.execution.task_readiness',
      [],
      // wildcard
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: '*' }],
      [{ selectorType: '*', objectType: 'zhiju.execution.task_readiness' }],
      // case variant
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'Zhiju.execution.task_readiness' }],
      [{ selectorType: 'create_target_type', objectType: 'zhiju.execution.task_readiness' }],
      // prefix / suffix / alias
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution' }],
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness.v1' }],
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'readiness' }],
      // unknown or missing field
      [
        {
          selectorType: 'CREATE_TARGET_TYPE',
          objectType: 'zhiju.execution.task_readiness',
          extra: 'x',
        },
      ],
      [{ selectorType: 'CREATE_TARGET_TYPE' }],
      [{ objectType: 'zhiju.execution.task_readiness' }],
      [{ selector_type: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' }],
      // non-NamespaceCode or non-string object type
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task readiness' }],
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 42 }],
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: null }],
      // an element that is not an object
      ['zhiju.execution.task_readiness'],
      [null],
      [
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' },
        { selectorType: 'CREATE_TARGET_TYPE' },
      ],
      // the matching element is not the one that is well formed
      [
        {
          selectorType: 'CREATE_TARGET_TYPE',
          objectType: 'zhiju.execution.task_readiness',
          extra: 'x',
        },
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' },
      ],
      // another object type only
      [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.task' }],
    ];
    for (const selectors of rejected) {
      const harness = new ReadinessHarness();
      harness.grants = [buildGrant({ selectors })];
      const view = await harnessPort(harness).authorizeReadiness(
        harness.deps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion),
      );
      expect(view.outcome).toBe('DENY');
      expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('accepts a Grant that selects the exact object type besides other selectors', async () => {
    const harness = new ReadinessHarness();
    harness.grants = [
      buildGrant({
        selectors: [
          { selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.work_order' },
          { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task_readiness' },
        ],
      }),
    ];
    const view = await harnessPort(harness).authorizeReadiness(
      harness.deps,
      readinessInput(buildApproved.commandType, buildApproved.commandVersion),
    );
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions).toHaveLength(1);
  });

  it('denies a consumer Grant that selects the other published Task spelling', async () => {
    // The consumer entry accepts both spellings, but the covering Grant must
    // select the exact spelling the request declares: the set is closed for the
    // operation, never for the Grant.
    const harness = new ReadinessHarness();
    harness.grants = [readyGrant()];
    const view = await harnessPort(harness).authorizeReadiness(
      harness.deps,
      readinessInput(readyApproved.commandType, readyApproved.commandVersion, {
        targetRef: targetRef('zhiju.execution.task', taskObjectId),
      }),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);

    // A second Grant that selects the declared spelling covers the same request.
    harness.grants = [
      readyGrant(),
      readyGrant({
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.task' }],
      }),
    ];
    const covered = await harnessPort(harness).authorizeReadiness(
      harness.deps,
      readinessInput(readyApproved.commandType, readyApproved.commandVersion, {
        targetRef: targetRef('zhiju.execution.task', taskObjectId),
      }),
    );
    expect(covered.outcome).toBe('ALLOW');
  });

  it('never assembles coverage from several partial Grants', async () => {
    // Every condition must hold on one Grant: neither entry's action, target
    // and scope may be split across two rows, and a Grant of the other entry
    // never contributes coverage.
    const harness = new ReadinessHarness();
    harness.grants = [
      buildGrant({ selectors: [] }),
      buildGrant({ actions: [] }),
      readyGrant({
        capabilityCode: capabilityCodes.taskReadinessBuildV1,
        actions: [buildApproved.requiredGrantAction],
      }),
    ];
    const view = await harnessPort(harness).authorizeReadiness(
      harness.deps,
      readinessInput(buildApproved.commandType, buildApproved.commandVersion),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);
  });

  it('denies a Grant of another principal, scope, action, constraint or maxUses', async () => {
    const rejected: readonly GrantOverrides[] = [
      { principalId: otherUuid },
      { capabilityCode: 'execution.task.create' },
      { actions: ['execution.task.readiness.build.v2'] },
      { actions: [] },
      { scopeKind: 'ENTERPRISE', projectId: null },
      { projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId },
      { constraints: { reason: 'required' } },
      { maxUses: 1 },
    ];
    for (const overrides of rejected) {
      const harness = new ReadinessHarness();
      harness.grants = [buildGrant(overrides)];
      const view = await harnessPort(harness).authorizeReadiness(
        harness.deps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion),
      );
      expect(view.outcome).toBe('DENY');
      expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies a Grant whose Policy Snapshot is absent, rewritten, not yet effective or superseded', async () => {
    const absent = new ReadinessHarness();
    absent.policySnapshots = {};

    const rewritten = new ReadinessHarness();
    rewritten.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ payloadHash: Buffer.alloc(32, 8) }),
    };

    const notYetEffective = new ReadinessHarness();
    notYetEffective.now = new Date(policyEffectiveFrom.getTime() - 1000);

    const superseded = new ReadinessHarness();
    superseded.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ supersededAt: new Date(clock.getTime() - 1000) }),
    };

    const cases: readonly (readonly [ReadinessHarness, string, GrantOverrides])[] = [
      [absent, 'GRANT_POLICY_SNAPSHOT_INVALID', {}],
      [rewritten, 'GRANT_POLICY_SNAPSHOT_INVALID', { policySnapshotHash: Buffer.alloc(32, 8) }],
      [notYetEffective, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
      [superseded, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
    ];
    for (const [harness, reason, overrides] of cases) {
      harness.grants = [buildGrant(overrides)];
      const view = await harnessPort(harness).authorizeReadiness(
        harness.deps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion),
      );
      expect({ reason, view }).toEqual({
        reason,
        view: {
          outcome: 'DENY',
          targetRef: targetRef('zhiju.execution.task_readiness', readinessObjectId),
          reasons: [reason],
        },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies an inactive principal and a Human-only capability of another kind', async () => {
    const inactive = new ReadinessHarness();
    inactive.grants = [buildGrant()];
    inactive.principalStatus = 'SUSPENDED';
    const inactiveView = await harnessPort(inactive).authorizeReadiness(
      inactive.deps,
      readinessInput(buildApproved.commandType, buildApproved.commandVersion),
    );
    expect(inactiveView.outcome).toBe('DENY');
    expect(inactiveView.reasons).toEqual(['PRINCIPAL_NOT_ACTIVE']);
    expect(inactive.decisions).toEqual([]);

    // `release.authorize` is Human-only; an Agent actor never receives it, even
    // when a Grant of that capability is configured for it.
    const humanOnly = new ReadinessHarness();
    humanOnly.grants = [
      readyGrant({
        capabilityCode: 'release.authorize',
        actions: [readyApproved.requiredGrantAction],
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'execution.task' }],
      }),
    ];
    humanOnly.principalKind = 'AGENT';
    const humanOnlyView = await harnessPort(humanOnly, {
      taskReadinessBuildV1: capabilityCodes.taskReadinessBuildV1,
      taskReadyV1: 'release.authorize',
    }).authorizeReadiness(
      humanOnly.deps,
      readinessInput(readyApproved.commandType, readyApproved.commandVersion),
    );
    expect(humanOnlyView.outcome).toBe('DENY');
    expect(humanOnlyView.reasons).toEqual(['CAPABILITY_HUMAN_ONLY']);
    expect(humanOnly.decisions).toEqual([]);
  });

  it('fails closed when the owning actor snapshot read cannot match the request', async () => {
    const harness = new ReadinessHarness();
    harness.grants = [buildGrant()];
    harness.actorHashMatched = false;
    await expect(
      harnessPort(harness).authorizeReadiness(
        harness.deps,
        readinessInput(buildApproved.commandType, buildApproved.commandVersion),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    expect(harness.decisions).toEqual([]);
  });

  it('writes only a masked in-scope DENIED audit when it denies', async () => {
    const harness = new ReadinessHarness();
    const view = await harnessPort(harness).authorizeReadiness(
      harness.deps,
      readinessInput(buildApproved.commandType, buildApproved.commandVersion),
    );
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
      'zhiju.execution.task_readiness',
      readinessObjectId,
      'readiness authorization denied: NO_ACTIVE_GRANT',
    ]) {
      expect(parameters).toContain(expected);
    }
    // The request payload itself is never part of the denial record: only its
    // hash is.
    expect(parameters).toContain(commandPayloadHash);
  });
});

describe('readiness revalidation', () => {
  it('refuses an unsupported expected version before reading any decision', async () => {
    const unsupported: readonly (readonly [unknown, unknown])[] = [
      ['execution.build_task_readiness', '2.0'],
      ['execution.build_task_readiness', '1'],
      ['execution.mark_task_ready', '1.1'],
      ['execution.mark_task_ready', 'latest'],
      ['execution.create_task', '1.0'],
      ['Execution.mark_task_ready', '1.0'],
      [' execution.build_task_readiness', '1.0'],
      [undefined, '1.0'],
      ['execution.build_task_readiness', undefined],
      [2, 1],
    ];
    for (const [expectedCommandType, expectedCommandVersion] of unsupported) {
      const input = {
        ...revalidationInputFor(signedBuildInsert()),
        expectedCommandType,
        expectedCommandVersion,
      } as unknown as TaskExecutionReadinessRevalidationInput;
      await expect(port().revalidateReadiness(pureDeps, input)).rejects.toMatchObject({
        code: IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
      });
    }
  });

  it('refuses an unusable trusted configuration before reading any decision', async () => {
    for (const codes of [
      {},
      { capabilityCodes: { taskReadinessBuildV1: 'Task.Readiness.Build' } },
      { capabilityCodes: undefined },
    ]) {
      for (const row of approved) {
        await expect(
          port(codes).revalidateReadiness(pureDeps, {
            ...revalidationInputFor(signedBuildInsert()),
            expectedCommandType: row.commandType,
            expectedCommandVersion: row.commandVersion,
            expectedTargetRef: targetRef(row.targetObjectType, row.targetObjectId),
          }),
        ).rejects.toMatchObject({ code: IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('refuses a revalidation target outside the exact accepted reference', async () => {
    await expect(
      port().revalidateReadiness(pureDeps, {
        ...revalidationInputFor(signedBuildInsert()),
        expectedTargetRef: targetRef('execution.task', readinessObjectId),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
    await expect(
      port().revalidateReadiness(pureDeps, {
        ...revalidationInputFor(signedBuildInsert()),
        expectedTargetRef: targetRef('zhiju.execution.task_readiness', 'abc'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_READINESS_TARGET_INVALID });
  });

  it('accepts the Decision this Port signed', async () => {
    const harness = await signedBuild();
    const signed = harness.lastSigned();
    const input = revalidationInputFor(signed);
    const result = await harnessPort(harness).revalidateReadiness(harness.deps, input);
    expect(result).toMatchObject({
      valid: true,
      targetRef: { objectType: 'zhiju.execution.task_readiness', objectId: readinessObjectId },
      expiresAt: new Date(clock.getTime() + decisionTtlMs).toISOString(),
    });
  });

  it('refuses a historical Decision that carries no target binding', async () => {
    const harness = await signedBuild();
    const unbound = decisionRow(harness.lastSigned(), { dropTargetRef: true });
    harness.decisionOverride = unbound;
    const result = await harnessPort(harness).revalidateReadiness(
      harness.deps,
      revalidationInputFor(harness.lastSigned(), unbound.payload_hash),
    );
    expect(result).toEqual({ valid: false, reason: 'TARGET_UNBOUND' });
  });

  it('refuses every substituted dimension with its own reason', async () => {
    interface Substitution {
      readonly name: string;
      readonly reason: string;
      readonly apply: (
        harness: ReadinessHarness,
        signed: AuthorizationDecisionInsert,
      ) => TaskExecutionReadinessRevalidationInput | undefined;
    }
    const defaultInput = (
      harness: ReadinessHarness,
      signed: AuthorizationDecisionInsert,
    ): TaskExecutionReadinessRevalidationInput => revalidationInputFor(signed);
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
        apply: (harness, signed) => ({
          ...defaultInput(harness, signed),
          decisionRef: { ...revalidationInputFor(signed).decisionRef, contentHash: contentHash(9) },
        }),
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
          expectedTargetRef: targetRef('zhiju.execution.task_readiness', otherUuid),
        }),
      },
      {
        name: 'a Decision reference without the Project Scope',
        reason: 'SCOPE_MISMATCH',
        apply: (harness, signed) => ({
          ...defaultInput(harness, signed),
          decisionRef: { ...revalidationInputFor(signed).decisionRef, scope: {} },
        }),
      },
      {
        name: 'a Decision of another Purpose',
        reason: 'COMMAND_MISMATCH',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({
            ...signed,
            purpose: 'task.execution.create_task',
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
            requestedCapability: 'execution.task.create',
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
      const harness = await signedBuild();
      const signed = harness.lastSigned();
      const input = substitution.apply(harness, signed);
      // A substitution that replaces the stored row changes its payload hash,
      // so the Decision reference must name the row that is actually stored.
      const result = await harnessPort(harness).revalidateReadiness(
        harness.deps,
        input ?? revalidationInputFor(signed, harness.storedDecisionHash()),
      );
      expect({ name: substitution.name, result }).toEqual({
        name: substitution.name,
        result: { valid: false, reason: substitution.reason },
      });
    }
  });
});

/**
 * A structurally complete Decision insert of the producer entry, used by the
 * pre-transaction revalidation gates that never reach the repository.
 */
function signedBuildInsert(): AuthorizationDecisionInsert {
  const decisionId = newUuidV7();
  return {
    authorizationDecisionId: decisionId,
    actorSnapshotId,
    actorSnapshotPayloadHash: Buffer.alloc(32, 5),
    principalId,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: buildApproved.commandType,
    commandVersion: buildApproved.commandVersion,
    scopeKind: 'PROJECT',
    enterpriseId,
    projectId,
    purpose: buildApproved.authorizationPurpose,
    requestedCapability: capabilityCodes.taskReadinessBuildV1,
    commandPayloadHash,
    policySnapshotId,
    policySnapshotPayloadHash: policySnapshotHash,
    authenticationContextHash,
    expiresAt: new Date(clock.getTime() + decisionTtlMs),
    contractVersion: '1.0',
    targetRef: { objectType: 'zhiju.execution.task_readiness', objectId: readinessObjectId },
    decisionPayload: {},
    createdByPrincipalId: principalId,
    sourceCommandId: newUuidV7(),
  };
}
