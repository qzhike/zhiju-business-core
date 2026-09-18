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
  createWorkOrderDraftReadAuthorizationPort,
  IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED,
  IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID,
  WORK_ORDER_DRAFT_READ_BINDINGS,
  WORK_ORDER_DRAFT_READ_PURPOSE,
  type WorkOrderDraftReadAuthorizationConfig,
  type WorkOrderDraftReadAuthorizationInput,
  type WorkOrderDraftReadAuthorizationPort,
  type WorkOrderDraftReadBinding,
  type WorkOrderDraftReadCapabilityKey,
  type WorkOrderDraftReadRevalidationInput,
} from './work-order-draft-read-authorization.js';

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

/** The approved Spec 001 §15.6 rows, transcribed here instead of imported. */
interface ApprovedRow {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'OBJECT';
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: WorkOrderDraftReadBinding['selectorType'];
  readonly capabilityConfigKey: WorkOrderDraftReadCapabilityKey;
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
const canonicalWorkOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d021';
const legacyWorkOrderId = '018f22e2-7c15-7b2e-8d86-2de956a9d022';
const policySnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d031';
const commandPayloadHash = Buffer.alloc(32, 3);
const authenticationContextHash = Buffer.alloc(32, 4);
const clock = new Date('2026-09-16T00:00:00.000Z');
const decisionTtlMs = 300 * 1000;

/** The canonical-spelling read of a WorkOrder its `@1.1` creation produced. */
const v11Approved: ApprovedRow = {
  commandType: 'execution.get_work_order_draft',
  commandVersion: '1.1',
  authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.draft.read.v1_1',
  targetKind: 'OBJECT',
  // A closed set of exactly the one spelling this Major produces (Spec 003 §18.2).
  targetObjectTypes: ['zhiju.execution.work_order'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderDraftReadV11',
  targetObjectType: 'zhiju.execution.work_order',
  targetObjectId: canonicalWorkOrderId,
};

/** The legacy-spelling read of a WorkOrder its `@1.0` creation produced. */
const v2Approved: ApprovedRow = {
  commandType: 'execution.get_work_order_draft',
  commandVersion: '2.0',
  authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.draft.read.v2',
  targetKind: 'OBJECT',
  // The other published spelling, and again exactly one value.
  targetObjectTypes: ['execution.work_order'],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'workOrderDraftReadV2',
  targetObjectType: 'execution.work_order',
  targetObjectId: legacyWorkOrderId,
};

const approved: readonly ApprovedRow[] = [v11Approved, v2Approved];

/** The exact Project Scope one draft-read request runs in. */
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
const capabilityCodes: Readonly<Record<WorkOrderDraftReadCapabilityKey, string>> = {
  workOrderDraftReadV11: 'execution.work_order.draft.read.v11',
  workOrderDraftReadV2: 'execution.work_order.draft.read.v2',
};

/** The Port under test with the pure trusted configuration. */
function port(codes: unknown = capabilityCodes): WorkOrderDraftReadAuthorizationPort {
  return createWorkOrderDraftReadAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as WorkOrderDraftReadAuthorizationConfig);
}

/** The Port under test driven by the harness clock. */
function harnessPort(
  harness: DraftReadHarness,
  codes: unknown = capabilityCodes,
): WorkOrderDraftReadAuthorizationPort {
  return createWorkOrderDraftReadAuthorizationPort({
    capabilityCodes: codes,
    now: () => harness.now,
  } as unknown as WorkOrderDraftReadAuthorizationConfig);
}

/** A trusted configuration in which only one approved entry is usable. */
function portWithOnlyUsable(key: WorkOrderDraftReadCapabilityKey) {
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
    throw new Error(`unapproved draft-read version ${commandType}@${commandVersion}`);
  }
  return found;
}

function targetRef(
  objectType: string,
  objectId: string = canonicalWorkOrderId,
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
function validInput(row: ApprovedRow): WorkOrderDraftReadAuthorizationInput {
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
function draftReadInput(
  commandType: string,
  commandVersion: string,
  overrides: Readonly<Record<string, unknown>> = {},
): WorkOrderDraftReadAuthorizationInput {
  return {
    ...validInput(approvedRow(commandType, commandVersion)),
    ...overrides,
  };
}

function projection(rows: readonly WorkOrderDraftReadBinding[]): string[] {
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
    capability_code: overrides.capabilityCode ?? capabilityCodes.workOrderDraftReadV11,
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

/** The Grant that covers the `@1.1` read of the canonical WorkOrder spelling. */
function v11Grant(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return grantRow({
    capabilityCode: capabilityCodes.workOrderDraftReadV11,
    actions: [v11Approved.requiredGrantAction],
    selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
    ...overrides,
  });
}

/** The Grant that covers the `@2.0` read of the legacy WorkOrder spelling. */
function v2Grant(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return grantRow({
    capabilityCode: capabilityCodes.workOrderDraftReadV2,
    actions: [v2Approved.requiredGrantAction],
    selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'execution.work_order' }],
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
class DraftReadHarness {
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
async function signedV11Read(): Promise<DraftReadHarness> {
  const harness = new DraftReadHarness();
  harness.grants = [v11Grant()];
  const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
    harness.deps,
    draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
  );
  expect(view.outcome).toBe('ALLOW');
  return harness;
}

/** The revalidation request that matches the Decision a harness signed. */
function revalidationInputFor(
  insert: AuthorizationDecisionInsert,
  decisionPayloadHash: Buffer = decisionRow(insert).payload_hash,
): WorkOrderDraftReadRevalidationInput {
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

describe('approved draft-read authorization bindings', () => {
  it('publishes exactly the two satisfiable read rows and nothing else', () => {
    expect(WORK_ORDER_DRAFT_READ_BINDINGS).toHaveLength(approved.length);
    expect(projection(WORK_ORDER_DRAFT_READ_BINDINGS)).toEqual(specProjection(approved));
  });

  it('publishes the one registered Purpose the two entries share', () => {
    expect(WORK_ORDER_DRAFT_READ_PURPOSE).toBe('execution.work_order.draft.read');
    const purposes = new Set(WORK_ORDER_DRAFT_READ_BINDINGS.map((row) => row.authorizationPurpose));
    expect([...purposes]).toEqual([WORK_ORDER_DRAFT_READ_PURPOSE]);
  });

  it('keeps the two entries independent although they share the Purpose', () => {
    // The shared Purpose is the *only* dimension the two entries have in
    // common: Grant action, trusted configuration key and the closed target
    // objectType set stay per version, so a Decision, Grant or trusted
    // configuration result of one version never satisfies the other.
    const [first, second] = WORK_ORDER_DRAFT_READ_BINDINGS;
    if (first === undefined || second === undefined) throw new Error('missing approved rows');
    expect(first.authorizationPurpose).toBe(second.authorizationPurpose);
    expect(first.requiredGrantAction).not.toBe(second.requiredGrantAction);
    expect(first.capabilityConfigKey).not.toBe(second.capabilityConfigKey);
    // Each closed set holds exactly the one spelling its creating Major
    // produces (Spec 003 §18.2), and the two sets never overlap.
    expect(first.targetObjectTypes).toEqual(['zhiju.execution.work_order']);
    expect(second.targetObjectTypes).toEqual(['execution.work_order']);
    for (const objectType of first.targetObjectTypes) {
      expect(second.targetObjectTypes).not.toContain(objectType);
    }
  });
});

describe('draft-read authorization: exact operation version', () => {
  it('refuses an unknown operation, an alias and a case variant', async () => {
    for (const commandType of [
      'execution.get_work_order_drafts',
      'execution.get_work_order_draft_v1_1',
      'execution.get_work_order_draft_v2',
      'execution.get_draft',
      'execution.work_order.draft.read',
      'execution.draft.read',
      'execution.get_work_order',
      'execution.get_draft_work_order',
      'Execution.get_work_order_draft',
      'execution.Get_Work_Order_Draft',
      'EXECUTION.GET_WORK_ORDER_DRAFT',
      ' execution.get_work_order_draft',
      'execution.get_work_order_draft ',
      '\texecution.get_work_order_draft',
      'execution.get_work_order_draft@1.1',
      'execution.get_work_order_draft?version=1.1',
      '',
      '*',
      'execution.*',
      'latest',
    ]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput('execution.get_work_order_draft', '1.1', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED });
    }
  });

  it('refuses a non-string operation or version', async () => {
    for (const commandType of [undefined, null, 1, true, {}, ['execution.get_work_order_draft']]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput('execution.get_work_order_draft', '1.1', { commandType }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED });
    }
    for (const commandVersion of [undefined, null, 1, true, {}, ['1.1']]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput('execution.get_work_order_draft', '1.1', { commandVersion }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED });
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
      '2.1',
      'v1.1',
      'V2.0',
      '1.1 ',
      ' 1.1',
      '2.0\n',
      '',
      '*',
      '1.x',
      '^2.0',
      'latest',
      'LATEST',
      'stable',
    ]) {
      for (const row of approved) {
        await expect(
          port().authorizeWorkOrderDraftRead(
            pureDeps,
            draftReadInput(row.commandType, row.commandVersion, { commandVersion }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED });
      }
    }
  });

  it('keeps the unchanged execution.get_work_order_draft@1.0 out of the table', async () => {
    // Spec 001 §15.6 rule 5 keeps the registered @1.0 read — and its canonical
    // spelling plus `WorkOrderDraft` acceptance set — on its existing generic
    // path. It is not a row of this Port's table, so this Port can neither sign
    // nor revalidate it, and the @1.0 acceptance set is not widened here.
    for (const commandVersion of ['1.0', '1.0.0', '0.1']) {
      expect(WORK_ORDER_DRAFT_READ_BINDINGS.map((row) => row.commandVersion)).not.toContain(
        commandVersion,
      );
      for (const row of approved) {
        await expect(
          port().authorizeWorkOrderDraftRead(
            pureDeps,
            draftReadInput(row.commandType, row.commandVersion, { commandVersion }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED });
      }
    }
  });
});

describe('draft-read authorization: trusted capability configuration', () => {
  it('refuses a missing, blank or non-NamespaceCode capability code of either entry', async () => {
    const unusable: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Execution.Work_Order.Draft.Read',
      'work order draft read',
      'work\torder',
      '1work',
      'work..order',
      'work-order',
      '.work',
      'work.',
      '_work',
      'work.order.',
      'WORK.ORDER.DRAFT.READ',
      'work/order',
      'work.order@2',
      42,
      ['work.order'],
      { code: 'work.order' },
    ];
    for (const row of approved) {
      for (const value of unusable) {
        const codes: Record<string, unknown> = { ...capabilityCodes };
        codes[row.capabilityConfigKey] = value;
        await expect(
          port(codes).authorizeWorkOrderDraftRead(pureDeps, validInput(row)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID });
      }
      // The same trusted configuration without that key at all.
      const withoutKey: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(capabilityCodes)) {
        if (key !== row.capabilityConfigKey) withoutKey[key] = value;
      }
      await expect(
        port(withoutKey).authorizeWorkOrderDraftRead(pureDeps, validInput(row)),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses a configuration object that carries no capability codes instead of crashing', async () => {
    for (const codes of [
      {},
      { capabilityCodes: undefined },
      { capabilityCodes: null },
      { capabilityCodes: 'execution.work_order.draft.read.v11' },
      { capabilityCodes: [] },
      { now: (): Date => clock },
    ]) {
      for (const row of approved) {
        await expect(
          port(codes).authorizeWorkOrderDraftRead(pureDeps, validInput(row)),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID });
      }
    }
  });

  it('binds each entry to its own trusted configuration key', async () => {
    for (const row of approved) {
      // Its own trusted key carries the request past the configuration gate to
      // the request-hash gate, which is the gate directly behind it.
      await expect(
        portWithOnlyUsable(row.capabilityConfigKey).authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(row.commandType, row.commandVersion, {
            commandPayloadHash: Buffer.alloc(31, 9),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });

      // A configuration that holds a code only for the other entry authorizes
      // nothing here: the resolved entry never reads a neighbouring key, so the
      // same Purpose never lets one version's trusted configuration result
      // stand in for the other.
      for (const other of approved) {
        if (other.capabilityConfigKey === row.capabilityConfigKey) continue;
        await expect(
          portWithOnlyUsable(other.capabilityConfigKey).authorizeWorkOrderDraftRead(
            pureDeps,
            validInput(row),
          ),
        ).rejects.toMatchObject({
          code: IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID,
        });
      }
    }
  });
});

describe('draft-read authorization: target reference', () => {
  it('accepts only the single canonical WorkOrder spelling of the @1.1 read', async () => {
    for (const objectType of [
      'execution.work_order',
      'zhiju.execution.work_orders',
      'zhiju.execution.work_order.snapshot',
      'zhiju.execution.work_order_draft',
      'Zhiju.execution.work_order',
      'ZHIJU.EXECUTION.WORK_ORDER',
      'zhiju.execution',
      'execution.work_order ',
      'WorkOrder',
      '*',
      'latest',
      '',
    ]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            targetRef: targetRef(objectType, canonicalWorkOrderId),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
    }
    // The approved spelling itself passes this gate and reaches the request
    // hash gate behind it.
    await expect(
      port().authorizeWorkOrderDraftRead(
        pureDeps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
  });

  it('accepts only the single legacy WorkOrder spelling of the @2.0 read', async () => {
    for (const objectType of [
      'zhiju.execution.work_order',
      'execution.work_orders',
      'execution.work_order.snapshot',
      'execution.work_order_draft',
      'Execution.work_order',
      'EXECUTION.WORK_ORDER',
      'execution',
      'execution.work_order ',
      'WorkOrder',
      '*',
      'latest',
      '',
    ]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v2Approved.commandType, v2Approved.commandVersion, {
            targetRef: targetRef(objectType, legacyWorkOrderId),
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
    }
    await expect(
      port().authorizeWorkOrderDraftRead(
        pureDeps,
        draftReadInput(v2Approved.commandType, v2Approved.commandVersion, {
          commandPayloadHash: Buffer.alloc(31, 9),
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
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
          port().authorizeWorkOrderDraftRead(
            pureDeps,
            draftReadInput(row.commandType, row.commandVersion, {
              targetRef: targetRef(row.targetObjectType, objectId),
            }),
          ),
        ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
      }
    }
  });

  it('refuses a reference that is not an exact OBJECT reference', async () => {
    for (const kind of ['CONTENT_ADDRESSED', 'VERSIONED', 'SNAPSHOT', 'object', '', undefined]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            targetRef: { ...targetRef('zhiju.execution.work_order'), kind },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
    }
    for (const target of [undefined, null, 'zhiju.execution.work_order', 42]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            targetRef: target,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
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
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            targetRef: { ...targetRef('zhiju.execution.work_order'), scope },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
    }
  });
});

describe('draft-read authorization: actor snapshot and request facts', () => {
  it('refuses an actor snapshot outside the exact request Project', async () => {
    for (const scope of [
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      {},
    ]) {
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
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
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            actorSnapshotRef: actorSnapshot,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses an actor snapshot that is not the trusted transaction actor', async () => {
    await expect(
      port().authorizeWorkOrderDraftRead(
        pureDeps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
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
      port().authorizeWorkOrderDraftRead(
        pureDeps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
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
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            commandPayloadHash: hash,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      await expect(
        port().authorizeWorkOrderDraftRead(
          pureDeps,
          draftReadInput(v11Approved.commandType, v11Approved.commandVersion, {
            authenticationContextHash: hash,
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });
});

describe('draft-read authorization: single covering Grant', () => {
  it('signs the exact target-bound Decision of the @1.1 read', async () => {
    const harness = await signedV11Read();
    expect(harness.decisions).toHaveLength(1);
    expect(harness.decisions[0]).toMatchObject({
      outcome: 'ALLOW',
      commandType: 'execution.get_work_order_draft',
      commandVersion: '1.1',
      purpose: WORK_ORDER_DRAFT_READ_PURPOSE,
      requestedCapability: capabilityCodes.workOrderDraftReadV11,
      scopeKind: 'PROJECT',
      enterpriseId,
      projectId,
      targetRef: { objectType: 'zhiju.execution.work_order', objectId: canonicalWorkOrderId },
    });
    // A denial path writes an audit; an ALLOW does not.
    expect(harness.auditInserts()).toEqual([]);
  });

  it('signs the @2.0 read Decision under the legacy spelling', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [v2Grant()];
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v2Approved.commandType, v2Approved.commandVersion),
    );
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions[0]).toMatchObject({
      commandType: 'execution.get_work_order_draft',
      commandVersion: '2.0',
      purpose: WORK_ORDER_DRAFT_READ_PURPOSE,
      requestedCapability: capabilityCodes.workOrderDraftReadV2,
      targetRef: { objectType: 'execution.work_order', objectId: legacyWorkOrderId },
    });
    expect(harness.auditInserts()).toEqual([]);
  });

  it('denies a Grant whose selector type belongs to the creation paths', async () => {
    // `CREATE_TARGET_TYPE` is the creation selector of §15.2 and is never
    // accepted here: both approved entries declare `TARGET_TYPE` only.
    const harness = new DraftReadHarness();
    harness.grants = [
      v11Grant({
        selectors: [
          { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
        ],
      }),
    ];
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);
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
      // the other published spelling
      [{ selectorType: 'TARGET_TYPE', objectType: 'execution.work_order' }],
      // unknown or missing field
      [
        {
          selectorType: 'TARGET_TYPE',
          objectType: 'zhiju.execution.work_order',
          extra: 'x',
        },
      ],
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
        {
          selectorType: 'TARGET_TYPE',
          objectType: 'zhiju.execution.work_order',
          extra: 'x',
        },
        { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
      ],
    ];
    for (const selectors of rejected) {
      const harness = new DraftReadHarness();
      harness.grants = [v11Grant({ selectors })];
      const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
        harness.deps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
      );
      expect({ selectors, view }).toEqual({
        selectors,
        view: {
          outcome: 'DENY',
          targetRef: targetRef('zhiju.execution.work_order', canonicalWorkOrderId),
          reasons: ['NO_ACTIVE_GRANT'],
        },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('accepts a Grant that selects the exact object type besides other selectors', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [
      v11Grant({
        selectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'execution.work_order' },
          { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
        ],
      }),
    ];
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
    );
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions).toHaveLength(1);
  });

  it('denies a @2.0 Grant that selects the other published spelling', async () => {
    // Each entry's closed target set holds one spelling, but the covering Grant
    // must select the exact spelling the request declares. Here the `@2.0` read
    // declares the legacy spelling while the Grant selects the canonical one,
    // which is the `@1.1` entry's spelling: sharing a Purpose does not let one
    // version's Grant cover the other.
    const harness = new DraftReadHarness();
    harness.grants = [
      v2Grant({
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
      }),
    ];
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v2Approved.commandType, v2Approved.commandVersion),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);

    // A Grant that selects the declared legacy spelling covers the same request.
    harness.grants = [
      v2Grant({
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
      }),
      v2Grant(),
    ];
    const covered = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v2Approved.commandType, v2Approved.commandVersion),
    );
    expect(covered.outcome).toBe('ALLOW');
  });

  it('never assembles coverage from several partial Grants', async () => {
    // Every condition must hold on one Grant: the action, the exact target
    // spelling and the configured capability code may not be split across two
    // rows, and a Grant of the other entry never contributes coverage.
    const harness = new DraftReadHarness();
    harness.grants = [
      v11Grant({ selectors: [] }),
      v11Grant({ actions: [] }),
      v2Grant({
        capabilityCode: capabilityCodes.workOrderDraftReadV11,
        actions: [v11Approved.requiredGrantAction],
      }),
    ];
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);
  });

  it('denies a Grant of another principal, scope, action or capability code', async () => {
    const rejected: readonly GrantOverrides[] = [
      { principalId: otherUuid },
      // The `@2.0` trusted capability code is not the `@1.1` entry's code.
      { capabilityCode: capabilityCodes.workOrderDraftReadV2 },
      { capabilityCode: 'execution.work_order.draft.read.v1' },
      // The other version's Grant action.
      { actions: ['execution.work_order.draft.read.v2'] },
      // The creation action of the same capability family.
      { actions: ['execution.work_order.create'] },
      { actions: [] },
      { scopeKind: 'ENTERPRISE', projectId: null },
      { projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId },
      { constraints: { reason: 'required' } },
      { maxUses: 1 },
    ];
    for (const overrides of rejected) {
      const harness = new DraftReadHarness();
      harness.grants = [v11Grant(overrides)];
      const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
        harness.deps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
      );
      expect({ overrides, view }).toEqual({
        overrides,
        view: {
          outcome: 'DENY',
          targetRef: targetRef('zhiju.execution.work_order', canonicalWorkOrderId),
          reasons: ['NO_ACTIVE_GRANT'],
        },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies a Grant whose Policy Snapshot is absent, rewritten, not yet effective or superseded', async () => {
    const absent = new DraftReadHarness();
    absent.policySnapshots = {};

    const rewritten = new DraftReadHarness();
    rewritten.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ payloadHash: Buffer.alloc(32, 8) }),
    };

    const notYetEffective = new DraftReadHarness();
    notYetEffective.now = new Date(policyEffectiveFrom.getTime() - 1000);

    const superseded = new DraftReadHarness();
    superseded.policySnapshots = {
      [policySnapshotId]: policySnapshotRow({ supersededAt: new Date(clock.getTime() - 1000) }),
    };

    const cases: readonly (readonly [DraftReadHarness, string, GrantOverrides])[] = [
      [absent, 'GRANT_POLICY_SNAPSHOT_INVALID', {}],
      [rewritten, 'GRANT_POLICY_SNAPSHOT_INVALID', { policySnapshotHash: Buffer.alloc(32, 8) }],
      [notYetEffective, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
      [superseded, 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT', {}],
    ];
    for (const [harness, reason, overrides] of cases) {
      harness.grants = [v11Grant(overrides)];
      const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
        harness.deps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
      );
      expect({ reason, view }).toEqual({
        reason,
        view: {
          outcome: 'DENY',
          targetRef: targetRef('zhiju.execution.work_order', canonicalWorkOrderId),
          reasons: [reason],
        },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies an inactive principal and a Human-only capability of another kind', async () => {
    const inactive = new DraftReadHarness();
    inactive.grants = [v11Grant()];
    inactive.principalStatus = 'SUSPENDED';
    const inactiveView = await harnessPort(inactive).authorizeWorkOrderDraftRead(
      inactive.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
    );
    expect(inactiveView.outcome).toBe('DENY');
    expect(inactiveView.reasons).toEqual(['PRINCIPAL_NOT_ACTIVE']);
    expect(inactive.decisions).toEqual([]);

    // `release.authorize` is Human-only; an Agent actor never receives it, even
    // when a Grant of that capability is configured for it.
    const humanOnly = new DraftReadHarness();
    humanOnly.grants = [
      v11Grant({
        capabilityCode: 'release.authorize',
        actions: [v11Approved.requiredGrantAction],
      }),
    ];
    humanOnly.principalKind = 'AGENT';
    const humanOnlyView = await harnessPort(humanOnly, {
      workOrderDraftReadV11: 'release.authorize',
      workOrderDraftReadV2: capabilityCodes.workOrderDraftReadV2,
    }).authorizeWorkOrderDraftRead(
      humanOnly.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
    );
    expect(humanOnlyView.outcome).toBe('DENY');
    expect(humanOnlyView.reasons).toEqual(['CAPABILITY_HUMAN_ONLY']);
    expect(humanOnly.decisions).toEqual([]);
  });

  it('fails closed when the owning actor snapshot read cannot match the request', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [v11Grant()];
    harness.actorHashMatched = false;
    await expect(
      harnessPort(harness).authorizeWorkOrderDraftRead(
        harness.deps,
        draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    expect(harness.decisions).toEqual([]);
  });

  it('writes only a masked in-scope DENIED audit when it denies', async () => {
    const harness = new DraftReadHarness();
    const view = await harnessPort(harness).authorizeWorkOrderDraftRead(
      harness.deps,
      draftReadInput(v11Approved.commandType, v11Approved.commandVersion),
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
      'zhiju.execution.work_order',
      canonicalWorkOrderId,
      'draft-read authorization denied: NO_ACTIVE_GRANT',
    ]) {
      expect(parameters).toContain(expected);
    }
    // The request payload itself is never part of the denial record: only its
    // hash is.
    expect(parameters).toContain(commandPayloadHash);
  });
});

describe('draft-read revalidation', () => {
  it('refuses an unsupported expected version before reading any decision', async () => {
    const unsupported: readonly (readonly [unknown, unknown])[] = [
      ['execution.get_work_order_draft', '1.0'],
      ['execution.get_work_order_draft', '1'],
      ['execution.get_work_order_draft', '2.1'],
      ['execution.get_work_order_draft', 'latest'],
      ['execution.create_work_order', '1.1'],
      ['Execution.get_work_order_draft', '1.1'],
      [' execution.get_work_order_draft', '1.1'],
      [undefined, '1.1'],
      ['execution.get_work_order_draft', undefined],
      [2, 1],
    ];
    for (const [expectedCommandType, expectedCommandVersion] of unsupported) {
      const input = {
        ...revalidationInputFor(signedV11ReadInsert()),
        expectedCommandType,
        expectedCommandVersion,
      } as unknown as WorkOrderDraftReadRevalidationInput;
      await expect(port().revalidateWorkOrderDraftRead(pureDeps, input)).rejects.toMatchObject({
        code: IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED,
      });
    }
  });

  it('refuses an unusable trusted configuration before reading any decision', async () => {
    for (const codes of [
      {},
      { capabilityCodes: { workOrderDraftReadV11: 'Execution.Work_Order.Draft.Read' } },
      { capabilityCodes: undefined },
    ]) {
      for (const row of approved) {
        await expect(
          port(codes).revalidateWorkOrderDraftRead(pureDeps, {
            ...revalidationInputFor(signedV11ReadInsert()),
            expectedCommandType: row.commandType,
            expectedCommandVersion: row.commandVersion,
            expectedTargetRef: targetRef(row.targetObjectType, row.targetObjectId),
          }),
        ).rejects.toMatchObject({
          code: IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID,
        });
      }
    }
  });

  it('refuses a revalidation target outside the exact accepted reference', async () => {
    // The `@1.1` entry accepts the canonical spelling only, so the legacy
    // spelling and a malformed id fail in front of the database.
    await expect(
      port().revalidateWorkOrderDraftRead(pureDeps, {
        ...revalidationInputFor(signedV11ReadInsert()),
        expectedTargetRef: targetRef('execution.work_order', canonicalWorkOrderId),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
    await expect(
      port().revalidateWorkOrderDraftRead(pureDeps, {
        ...revalidationInputFor(signedV11ReadInsert()),
        expectedTargetRef: targetRef('zhiju.execution.work_order', 'abc'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID });
  });

  it('accepts the Decision this Port signed', async () => {
    const harness = await signedV11Read();
    const signed = harness.lastSigned();
    const input = revalidationInputFor(signed);
    const result = await harnessPort(harness).revalidateWorkOrderDraftRead(harness.deps, input);
    expect(result).toMatchObject({
      valid: true,
      targetRef: { objectType: 'zhiju.execution.work_order', objectId: canonicalWorkOrderId },
      expiresAt: new Date(clock.getTime() + decisionTtlMs).toISOString(),
    });
  });

  it('refuses a historical Decision that carries no target binding', async () => {
    const harness = await signedV11Read();
    const unbound = decisionRow(harness.lastSigned(), { dropTargetRef: true });
    harness.decisionOverride = unbound;
    const result = await harnessPort(harness).revalidateWorkOrderDraftRead(
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
        harness: DraftReadHarness,
        signed: AuthorizationDecisionInsert,
      ) => WorkOrderDraftReadRevalidationInput | undefined;
    }
    const defaultInput = (
      harness: DraftReadHarness,
      signed: AuthorizationDecisionInsert,
    ): WorkOrderDraftReadRevalidationInput => revalidationInputFor(signed);
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
          expectedTargetRef: targetRef('zhiju.execution.work_order', otherUuid),
        }),
      },
      {
        name: 'a Decision bound to the other version spelling',
        reason: 'TARGET_MISMATCH',
        apply: (harness, signed) => {
          // The Decision is bound to the legacy spelling while the presented
          // request is the `@1.1` canonical read: the other version's spelling
          // never authorizes this read. The row stays internally consistent, so
          // it is refused by the exact target comparison and not by integrity.
          const payload: CanonicalJsonObject = {
            ...signed.decisionPayload,
            targetRef: {
              kind: 'OBJECT',
              objectType: 'execution.work_order',
              objectId: canonicalWorkOrderId,
              scope: { enterpriseId, projectId },
            },
          };
          harness.decisionOverride = decisionRow({
            ...signed,
            targetRef: { objectType: 'execution.work_order', objectId: canonicalWorkOrderId },
            decisionPayload: payload,
          });
          return undefined;
        },
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
        name: 'a Decision of the other read version',
        reason: 'COMMAND_MISMATCH',
        apply: (harness, signed) => {
          // Same shared Purpose, same target spelling, different version: the
          // shared Purpose never lets one version's Decision stand in for the
          // other.
          harness.decisionOverride = decisionRow({ ...signed, commandVersion: '2.0' });
          return undefined;
        },
      },
      {
        name: 'a Decision of another Purpose',
        reason: 'COMMAND_MISMATCH',
        apply: (harness, signed) => {
          harness.decisionOverride = decisionRow({
            ...signed,
            purpose: 'execution.work_order.create',
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
            requestedCapability: capabilityCodes.workOrderDraftReadV2,
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
        name: 'a Grant of the other read version only',
        reason: 'GRANT_NOT_CURRENT',
        apply: (harness) => {
          harness.grants = [v2Grant()];
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
      const harness = await signedV11Read();
      const signed = harness.lastSigned();
      const input = substitution.apply(harness, signed);
      // A substitution that replaces the stored row changes its payload hash,
      // so the Decision reference must name the row that is actually stored.
      const result = await harnessPort(harness).revalidateWorkOrderDraftRead(
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
 * A structurally complete Decision insert of the `@1.1` entry, used by the
 * pre-transaction revalidation gates that never reach the repository.
 */
function signedV11ReadInsert(): AuthorizationDecisionInsert {
  const decisionId = newUuidV7();
  return {
    authorizationDecisionId: decisionId,
    actorSnapshotId,
    actorSnapshotPayloadHash: Buffer.alloc(32, 5),
    principalId,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: v11Approved.commandType,
    commandVersion: v11Approved.commandVersion,
    scopeKind: 'PROJECT',
    enterpriseId,
    projectId,
    purpose: v11Approved.authorizationPurpose,
    requestedCapability: capabilityCodes.workOrderDraftReadV11,
    commandPayloadHash,
    policySnapshotId,
    policySnapshotPayloadHash: policySnapshotHash,
    authenticationContextHash,
    expiresAt: new Date(clock.getTime() + decisionTtlMs),
    contractVersion: '1.0',
    targetRef: { objectType: 'zhiju.execution.work_order', objectId: canonicalWorkOrderId },
    decisionPayload: {},
    createdByPrincipalId: principalId,
    sourceCommandId: newUuidV7(),
  };
}
