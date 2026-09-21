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
  IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
  TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS,
} from './context-snapshot-authorization.js';
import {
  WORK_ORDER_DRAFT_READ_BINDINGS,
  WORK_ORDER_DRAFT_READ_PURPOSE,
} from './work-order-draft-read-authorization.js';
import {
  CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS,
  createContextSnapshotDraftReadAuthorizationPort,
  type ContextSnapshotDraftReadAuthorizationConfig,
  type ContextSnapshotDraftReadAuthorizationInput,
  type ContextSnapshotDraftReadAuthorizationPort,
  type ContextSnapshotDraftReadBinding,
  type ContextSnapshotDraftReadCapabilityKey,
  type ContextSnapshotDraftReadRevalidationInput,
} from './context-snapshot-draft-read-authorization.js';

// Every refusal in the first half of this suite happens before the trusted
// transaction is opened: an unknown consumer version, an unusable trusted
// configuration, a target outside the entry's closed objectType set, a
// malformed complete target reference, a foreign actor snapshot and an invalid
// request hash all fail closed in front of the database. Those tests therefore
// stub `deps` with the trusted transaction context alone — a request that
// slipped past those gates would fail loudly on the missing `db`/`repo`
// instead of silently authorizing. The accepted continuation of the approved
// entry is asserted through the exact gate it reaches, which is what a pure
// suite can observe.
//
// The second half drives the Grant, Policy and Decision logic inside the
// transaction. It uses no database: a recording Kysely driver answers every
// statement in memory, so the Port's real SQL is compiled and executed while
// the rows, the Audit writes and the Decision inserts are observed directly.

/** The approved Spec 001 §15.9 row, transcribed here instead of imported. */
interface ApprovedRow {
  readonly commandType: string;
  readonly commandVersion: string;
  readonly authorizationPurpose: string;
  readonly requiredGrantAction: string;
  readonly targetKind: 'CONTENT_ADDRESSED';
  readonly targetObjectTypes: readonly string[];
  readonly selectorType: ContextSnapshotDraftReadBinding['selectorType'];
  readonly capabilityConfigKey: ContextSnapshotDraftReadCapabilityKey;
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
const draftSnapshotObjectType = 'zhiju.execution.work_order_draft_snapshot';
const draftSnapshotObjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d041';
const immutableVersionId = '018f22e2-7c15-7b2e-8d86-2de956a9d042';
const policySnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d031';
const commandPayloadHash = Buffer.alloc(32, 3);
const authenticationContextHash = Buffer.alloc(32, 4);
const clock = new Date('2026-09-16T00:00:00.000Z');
const decisionTtlMs = 300 * 1000;

const draftReadApproved: ApprovedRow = {
  commandType: 'execution.build_initial_context_snapshot',
  commandVersion: '1.1',
  authorizationPurpose: WORK_ORDER_DRAFT_READ_PURPOSE,
  requiredGrantAction: 'execution.work_order.draft_snapshot.read.for_context_build.v1_1',
  targetKind: 'CONTENT_ADDRESSED',
  targetObjectTypes: [draftSnapshotObjectType],
  selectorType: 'TARGET_TYPE',
  capabilityConfigKey: 'contextSnapshotDraftReadV11',
};

/** The exact Project Scope one initial Context build request runs in. */
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

/** The one capability code of the approved entry, as a valid NamespaceCode. */
const capabilityCodes: Readonly<Record<ContextSnapshotDraftReadCapabilityKey, string>> = {
  contextSnapshotDraftReadV11: 'execution.work_order.draft_snapshot.read',
};

/** The Port under test with the pure trusted configuration. */
function port(codes: unknown = capabilityCodes): ContextSnapshotDraftReadAuthorizationPort {
  return createContextSnapshotDraftReadAuthorizationPort({
    capabilityCodes: codes,
  } as unknown as ContextSnapshotDraftReadAuthorizationConfig);
}

/** The Port under test driven by the harness clock. */
function harnessPort(
  harness: DraftReadHarness,
  codes: unknown = capabilityCodes,
): ContextSnapshotDraftReadAuthorizationPort {
  return createContextSnapshotDraftReadAuthorizationPort({
    capabilityCodes: codes,
    now: () => harness.now,
  } as unknown as ContextSnapshotDraftReadAuthorizationConfig);
}

function contentHash(seed: number | Buffer): Common.ContentHash {
  const digest = Buffer.isBuffer(seed) ? seed : Buffer.alloc(32, seed);
  return { algorithm: 'SHA-256', digest: digest.toString('hex'), canonicalizationVersion: '1' };
}

/** A structurally complete DRAFT snapshot reference of the approved object type. */
function draftSnapshotRef(
  overrides: {
    readonly objectType?: string;
    readonly objectId?: string;
    readonly immutableVersionId?: string;
    readonly scope?: Common.ScopeRef;
    readonly contentHash?: Common.ContentHash;
  } = {},
): Common.ContentAddressedRef {
  const ref: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: overrides.objectType ?? draftSnapshotObjectType,
    objectId: overrides.objectId ?? draftSnapshotObjectId,
    scope: overrides.scope ?? projectScope,
    contentHash: overrides.contentHash ?? contentHash(6),
  };
  if (overrides.immutableVersionId !== undefined) {
    return { ...ref, immutableVersionId: overrides.immutableVersionId };
  }
  return ref;
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

/** A structurally complete request of the approved entry. */
function validInput(): ContextSnapshotDraftReadAuthorizationInput {
  return {
    actorSnapshotRef: actorSnapshotRef(),
    commandType: draftReadApproved.commandType,
    commandVersion: draftReadApproved.commandVersion,
    draftSnapshotRef: draftSnapshotRef(),
    commandPayloadHash,
    authenticationContextHash,
  };
}

/** The same request with one substituted member, which the type cannot express. */
function draftReadInput(
  overrides: Readonly<Record<string, unknown>> = {},
): ContextSnapshotDraftReadAuthorizationInput {
  return { ...validInput(), ...overrides };
}

function projection(rows: readonly ContextSnapshotDraftReadBinding[]): string[] {
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
    capability_code: overrides.capabilityCode ?? capabilityCodes.contextSnapshotDraftReadV11,
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

/** The Grant that covers the DRAFT dependency read of the default target. */
function draftReadGrant(overrides: GrantOverrides = {}): SelectedCapabilityGrant {
  return grantRow({
    capabilityCode: capabilityCodes.contextSnapshotDraftReadV11,
    actions: [draftReadApproved.requiredGrantAction],
    selectors: [{ selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType }],
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

/** A harness holding the Grant that covers the DRAFT read of the given ref. */
async function signedDraftRead(
  ref: Common.ContentAddressedRef = draftSnapshotRef(),
): Promise<DraftReadHarness> {
  const harness = new DraftReadHarness();
  harness.grants = [draftReadGrant()];
  const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
    harness.deps,
    draftReadInput({ draftSnapshotRef: ref }),
  );
  expect(view.outcome).toBe('ALLOW');
  return harness;
}

/** The revalidation request that matches the Decision a harness signed. */
function revalidationInputFor(
  insert: AuthorizationDecisionInsert,
  decisionPayloadHash: Buffer = decisionRow(insert).payload_hash,
): ContextSnapshotDraftReadRevalidationInput {
  const stored = insert.decisionPayload.draftSnapshotRef as Common.ContentAddressedRef | undefined;
  if (stored === undefined) throw new Error('the signed Decision carries no draft snapshot ref');
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
    expectedDraftSnapshotRef: stored,
  };
}

/**
 * A structurally complete Decision insert of the DRAFT dependency read, used
 * by the pre-transaction revalidation gates that never reach the repository.
 */
function signedDraftReadInsert(): AuthorizationDecisionInsert {
  const decisionId = newUuidV7();
  return {
    authorizationDecisionId: decisionId,
    actorSnapshotId,
    actorSnapshotPayloadHash: Buffer.alloc(32, 5),
    principalId,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: draftReadApproved.commandType,
    commandVersion: draftReadApproved.commandVersion,
    scopeKind: 'PROJECT',
    enterpriseId,
    projectId,
    purpose: draftReadApproved.authorizationPurpose,
    requestedCapability: capabilityCodes.contextSnapshotDraftReadV11,
    commandPayloadHash,
    policySnapshotId,
    policySnapshotPayloadHash: policySnapshotHash,
    authenticationContextHash,
    expiresAt: new Date(clock.getTime() + decisionTtlMs),
    contractVersion: '1.0',
    targetRef: {
      objectType: draftSnapshotObjectType,
      objectId: draftSnapshotObjectId,
    },
    decisionPayload: {
      targetRef: {
        kind: 'OBJECT',
        objectType: draftSnapshotObjectType,
        objectId: draftSnapshotObjectId,
        scope: { enterpriseId, projectId },
      },
      draftSnapshotRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: draftSnapshotObjectType,
        objectId: draftSnapshotObjectId,
        scope: { enterpriseId, projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: Buffer.alloc(32, 6).toString('hex'),
          canonicalizationVersion: '1',
        },
      },
    },
    createdByPrincipalId: principalId,
    sourceCommandId: newUuidV7(),
  };
}

describe('approved Context Snapshot DRAFT-read authorization binding', () => {
  it('publishes exactly the one approved row and nothing else', () => {
    expect(CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS).toHaveLength(1);
    expect(projection(CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS)).toEqual(
      specProjection([draftReadApproved]),
    );
  });

  it('publishes the §15.9 Purpose and binds it to the trusted configuration key', () => {
    expect(WORK_ORDER_DRAFT_READ_PURPOSE).toBe('execution.work_order.draft.read');
    const purposes = new Map(
      CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS.map((row) => [
        row.capabilityConfigKey,
        row.authorizationPurpose,
      ]),
    );
    expect(purposes.get('contextSnapshotDraftReadV11')).toBe(WORK_ORDER_DRAFT_READ_PURPOSE);
  });

  it('stays independent from the §15.8 and §15.6 entries', () => {
    // Capability isolation (Spec 001 §15.9 rule 4): neither the build/read
    // entries of §15.8 nor the public DRAFT-read entries of §15.6 share a
    // trusted configuration key or a Grant action with this entry, so no
    // Decision, Grant or trusted configuration of those entries can ever
    // satisfy this dependency read.
    const others = [...TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS, ...WORK_ORDER_DRAFT_READ_BINDINGS];
    expect(others.length).toBeGreaterThan(0);
    for (const row of CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS) {
      for (const other of others) {
        expect(row.capabilityConfigKey).not.toBe(other.capabilityConfigKey);
        expect(row.requiredGrantAction).not.toBe(other.requiredGrantAction);
      }
    }
    const [row] = CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS;
    if (row === undefined) throw new Error('missing approved row');
    expect(row.selectorType).toBe('TARGET_TYPE');
    expect(row.targetObjectTypes).toEqual([draftSnapshotObjectType]);
  });
});

describe('Context Snapshot DRAFT-read authorization: exact consumer version', () => {
  it('refuses an unknown consumer operation, an alias and a case variant', async () => {
    for (const commandType of [
      'execution.build_initial_context_snapshots',
      'execution.build_context_snapshot',
      'execution.get_context_snapshot',
      'execution.get_work_order_draft',
      'execution.work_order.draft_snapshot.read.for_context_build.v1_1',
      'execution.context.build.initial',
      'execution.create_task',
      'execution',
      'executions.build_initial_context_snapshot',
      'Execution.build_initial_context_snapshot',
      'execution.Build_Initial_Context_Snapshot',
      'EXECUTION.BUILD_INITIAL_CONTEXT_SNAPSHOT',
      ' execution.build_initial_context_snapshot',
      'execution.build_initial_context_snapshot ',
      '\texecution.build_initial_context_snapshot',
      'execution.build_initial_context_snapshot@1.1',
      'execution.build_initial_context_snapshot?version=1.1',
      '',
      '*',
      'execution.*',
      'latest',
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(pureDeps, draftReadInput({ commandType })),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses a non-string operation or version', async () => {
    for (const commandType of [
      undefined,
      null,
      1,
      true,
      {},
      ['execution.build_initial_context_snapshot'],
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(pureDeps, draftReadInput({ commandType })),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED });
    }
    for (const commandVersion of [undefined, null, 1, true, {}, ['1.1']]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(pureDeps, draftReadInput({ commandVersion })),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED });
    }
  });

  it('refuses an unknown, missing or non-exact version without a fallback', async () => {
    for (const commandVersion of [
      '1',
      '1.0',
      '2.0',
      '1.1.0',
      '01.1',
      '1.10',
      'v1.1',
      'V1.1',
      '1.1 ',
      ' 1.1',
      '1.1\n',
      '',
      '*',
      '1.x',
      '^1.1',
      'latest',
      'LATEST',
      'stable',
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(pureDeps, draftReadInput({ commandVersion })),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED });
    }
  });
});

describe('Context Snapshot DRAFT-read authorization: trusted capability configuration', () => {
  it('refuses a missing, blank or non-NamespaceCode capability code', async () => {
    const unusable: readonly unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'Execution.WorkOrder.Draft',
      'execution workorder draft',
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
    for (const value of unusable) {
      await expect(
        port({ contextSnapshotDraftReadV11: value }).authorizeContextSnapshotDraftRead(
          pureDeps,
          validInput(),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
    }
    // A deployment that never configures this key fails closed (Spec 001 §15.9
    // rule 5): there is no fallback to the build capability or to a
    // historical Decision.
    await expect(
      port({}).authorizeContextSnapshotDraftRead(pureDeps, validInput()),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
    await expect(
      port({
        contextSnapshotBuildV11: 'execution.context.build',
      }).authorizeContextSnapshotDraftRead(pureDeps, validInput()),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
    await expect(
      port({
        workOrderDraftReadV11: 'execution.work_order.draft',
      }).authorizeContextSnapshotDraftRead(pureDeps, validInput()),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
  });

  it('refuses a configuration object that carries no capability codes instead of crashing', async () => {
    for (const codes of [
      {},
      { capabilityCodes: undefined },
      { capabilityCodes: null },
      { capabilityCodes: 'execution.work_order.draft_snapshot.read' },
      { capabilityCodes: [] },
      { now: (): Date => clock },
    ]) {
      await expect(
        port(codes).authorizeContextSnapshotDraftRead(pureDeps, validInput()),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
    }
  });
});

describe('Context Snapshot DRAFT-read authorization: draft snapshot target reference', () => {
  it('accepts only the single approved DRAFT snapshot object type', async () => {
    for (const objectType of [
      'zhiju.execution.work_order',
      'execution.work_order',
      'zhiju.execution.context_snapshot',
      'zhiju.execution.work_order_draft_snapshots',
      'zhiju.execution.work_order_draft_snapshot.v1',
      'Zhiju.execution.work_order_draft_snapshot',
      'zhiju.execution',
      'execution.work_order_draft_snapshot',
      '*',
      'latest',
      '',
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: draftSnapshotRef({ objectType }) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
    // The approved spelling itself passes this gate and reaches the request
    // hash gate behind it.
    await expect(
      port().authorizeContextSnapshotDraftRead(
        pureDeps,
        draftReadInput({ commandPayloadHash: Buffer.alloc(31, 9) }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
  });

  it('refuses a target id that is not a UuidV7', async () => {
    for (const objectId of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d041',
      '018f22e2-7c15-7b2e-cd86-2de956a9d041',
      '018f22e2-7c15-7b2e-8d86-2de956a9d04',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D041',
      '018f22e2-7c15-7b2e-8d86-2de956a9d041 ',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0410',
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: draftSnapshotRef({ objectId }) }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
  });

  it('refuses a reference that is not an exact ContentAddressedRef', async () => {
    for (const kind of ['OBJECT', 'VERSIONED', 'SNAPSHOT', 'content_addressed', '', undefined]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: { ...draftSnapshotRef(), kind } }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
    for (const target of [undefined, null, draftSnapshotObjectType, 42]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: target }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
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
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: { ...draftSnapshotRef(), scope } }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
  });

  it('refuses a malformed immutableVersionId and accepts an absent or exact one', async () => {
    for (const value of [
      'abc',
      '',
      '018f22e2-7c15-4b2e-8d86-2de956a9d042',
      '018f22e2-7c15-7b2e-cd86-2de956a9d042',
      '018F22E2-7C15-7B2E-8D86-2DE956A9D042',
      '018f22e2-7c15-7b2e-8d86-2de956a9d042 ',
      null,
      42,
      {},
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({
            draftSnapshotRef: { ...draftSnapshotRef(), immutableVersionId: value },
          }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
    // An absent and an exact version id both pass the target gate and reach
    // the request hash gate behind it.
    for (const ref of [draftSnapshotRef(), draftSnapshotRef({ immutableVersionId })]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: ref, commandPayloadHash: Buffer.alloc(31, 9) }),
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
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ draftSnapshotRef: { ...draftSnapshotRef(), contentHash: hash } }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    }
  });
});

describe('Context Snapshot DRAFT-read authorization: actor snapshot and request facts', () => {
  it('refuses an actor snapshot outside the exact request Project', async () => {
    for (const scope of [
      { enterpriseId },
      { projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      {},
    ]) {
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ actorSnapshotRef: { ...actorSnapshotRef(), scope } }),
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
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ actorSnapshotRef: actorSnapshot }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    }
  });

  it('refuses an actor snapshot that is not the trusted transaction actor', async () => {
    await expect(
      port().authorizeContextSnapshotDraftRead(
        pureDeps,
        draftReadInput({
          actorSnapshotRef: { ...actorSnapshotRef(), objectId: otherUuid, snapshotId: otherUuid },
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    // The trusted actor itself still passes this gate and reaches the hash
    // checks of the same request.
    await expect(
      port().authorizeContextSnapshotDraftRead(
        pureDeps,
        draftReadInput({ commandPayloadHash: Buffer.alloc(31, 3) }),
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
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ commandPayloadHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
      await expect(
        port().authorizeContextSnapshotDraftRead(
          pureDeps,
          draftReadInput({ authenticationContextHash: hash }),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_DECISION_INPUT_INVALID });
    }
  });
});

describe('Context Snapshot DRAFT-read authorization: single covering Grant', () => {
  it('signs the exact target-bound Decision of the DRAFT dependency read', async () => {
    const harness = await signedDraftRead();
    expect(harness.decisions).toHaveLength(1);
    const insert = harness.decisions[0];
    expect(insert).toMatchObject({
      outcome: 'ALLOW',
      commandType: 'execution.build_initial_context_snapshot',
      commandVersion: '1.1',
      purpose: WORK_ORDER_DRAFT_READ_PURPOSE,
      requestedCapability: capabilityCodes.contextSnapshotDraftReadV11,
      scopeKind: 'PROJECT',
      enterpriseId,
      projectId,
      targetRef: {
        objectType: draftSnapshotObjectType,
        objectId: draftSnapshotObjectId,
      },
    });
    // The canonical payload carries the complete target reference next to the
    // V1006 OBJECT mirror of the promoted columns (Spec 001 §15.9 rule 2).
    expect(insert?.decisionPayload).toMatchObject({
      targetRef: {
        kind: 'OBJECT',
        objectType: draftSnapshotObjectType,
        objectId: draftSnapshotObjectId,
        scope: { enterpriseId, projectId },
      },
      draftSnapshotRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: draftSnapshotObjectType,
        objectId: draftSnapshotObjectId,
        scope: { enterpriseId, projectId },
        contentHash: contentHash(6),
      },
    });
    // An absent immutableVersionId is bound as absence, never serialized as null.
    expect(insert?.decisionPayload.draftSnapshotRef).not.toHaveProperty('immutableVersionId');
    // A denial path writes an audit; an ALLOW does not.
    expect(harness.auditInserts()).toEqual([]);
  });

  it('binds the existence and value of immutableVersionId in the signed Decision', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [draftReadGrant()];
    const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
      harness.deps,
      draftReadInput({ draftSnapshotRef: draftSnapshotRef({ immutableVersionId }) }),
    );
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions[0]?.decisionPayload.draftSnapshotRef).toMatchObject({
      kind: 'CONTENT_ADDRESSED',
      objectType: draftSnapshotObjectType,
      objectId: draftSnapshotObjectId,
      immutableVersionId,
      scope: { enterpriseId, projectId },
      contentHash: contentHash(6),
    });
    expect(harness.auditInserts()).toEqual([]);
  });

  it('denies a Grant shaped for the §15.8 build entry or the §15.6 public DRAFT read', async () => {
    const rejected: readonly GrantOverrides[] = [
      // The §15.8 build entry: another capability, action and selector type.
      {
        capabilityCode: 'execution.context.build',
        actions: ['execution.context.build.initial.v1_1'],
        selectors: [
          { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.context_snapshot' },
        ],
      },
      // The §15.6 public DRAFT read: another capability, action and target.
      {
        capabilityCode: 'execution.work_order.draft.read',
        actions: ['execution.work_order.draft.read.v1_1'],
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
      },
      // Same trusted capability but the public read action.
      { actions: ['execution.work_order.draft.read.v1_1'] },
      // Same trusted capability but the build selector type.
      {
        selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: draftSnapshotObjectType }],
      },
      // Same trusted capability but the public read target object type.
      {
        selectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
      },
    ];
    for (const overrides of rejected) {
      const harness = new DraftReadHarness();
      harness.grants = [draftReadGrant(overrides)];
      const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
        harness.deps,
        validInput(),
      );
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
      draftSnapshotObjectType,
      [],
      // wildcard
      [{ selectorType: 'TARGET_TYPE', objectType: '*' }],
      [{ selectorType: '*', objectType: draftSnapshotObjectType }],
      // case variant
      [{ selectorType: 'TARGET_TYPE', objectType: 'Zhiju.execution.work_order_draft_snapshot' }],
      [{ selectorType: 'target_type', objectType: draftSnapshotObjectType }],
      // prefix / suffix / alias
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution' }],
      [{ selectorType: 'TARGET_TYPE', objectType: `${draftSnapshotObjectType}.v1` }],
      [{ selectorType: 'TARGET_TYPE', objectType: 'work_order_draft_snapshot' }],
      // unknown or missing field
      [{ selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType, extra: 'x' }],
      [{ selectorType: 'TARGET_TYPE' }],
      [{ objectType: draftSnapshotObjectType }],
      [{ selector_type: 'TARGET_TYPE', objectType: draftSnapshotObjectType }],
      // non-NamespaceCode or non-string object type
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work order draft snapshot' }],
      [{ selectorType: 'TARGET_TYPE', objectType: 42 }],
      [{ selectorType: 'TARGET_TYPE', objectType: null }],
      // an element that is not an object
      [draftSnapshotObjectType],
      [null],
      [
        { selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType },
        { selectorType: 'TARGET_TYPE' },
      ],
      // the matching element is not the one that is well formed
      [
        { selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType, extra: 'x' },
        { selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType },
      ],
      // another object type only
      [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' }],
    ];
    for (const selectors of rejected) {
      const harness = new DraftReadHarness();
      harness.grants = [draftReadGrant({ selectors })];
      const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
        harness.deps,
        validInput(),
      );
      expect(view.outcome).toBe('DENY');
      expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('accepts a Grant that selects the exact object type besides other selectors', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [
      draftReadGrant({
        selectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
          { selectorType: 'TARGET_TYPE', objectType: draftSnapshotObjectType },
        ],
      }),
    ];
    const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
      harness.deps,
      validInput(),
    );
    expect(view.outcome).toBe('ALLOW');
    expect(harness.decisions).toHaveLength(1);
  });

  it('never assembles coverage from several partial Grants', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [
      draftReadGrant({ selectors: [] }),
      draftReadGrant({ actions: [] }),
      draftReadGrant({
        capabilityCode: 'execution.context.build',
        actions: [draftReadApproved.requiredGrantAction],
      }),
    ];
    const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
      harness.deps,
      validInput(),
    );
    expect(view.outcome).toBe('DENY');
    expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
    expect(harness.decisions).toEqual([]);
  });

  it('denies a Grant of another principal, scope, action, constraint or maxUses', async () => {
    const rejected: readonly GrantOverrides[] = [
      { principalId: otherUuid },
      { capabilityCode: 'execution.task.create' },
      { actions: ['execution.work_order.draft_snapshot.read.for_context_build.v1_2'] },
      { actions: [] },
      { scopeKind: 'ENTERPRISE', projectId: null },
      { projectId: foreignProjectId },
      { enterpriseId: foreignEnterpriseId },
      { constraints: { reason: 'required' } },
      { maxUses: 1 },
    ];
    for (const overrides of rejected) {
      const harness = new DraftReadHarness();
      harness.grants = [draftReadGrant(overrides)];
      const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
        harness.deps,
        validInput(),
      );
      expect(view.outcome).toBe('DENY');
      expect(view.reasons).toEqual(['NO_ACTIVE_GRANT']);
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
      harness.grants = [draftReadGrant(overrides)];
      const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
        harness.deps,
        validInput(),
      );
      expect({ reason, view }).toEqual({
        reason,
        view: {
          outcome: 'DENY',
          draftSnapshotRef: draftSnapshotRef(),
          reasons: [reason],
        },
      });
      expect(harness.decisions).toEqual([]);
      expect(harness.auditInserts()).toHaveLength(1);
    }
  });

  it('denies an inactive principal and a Human-only capability of another kind', async () => {
    const inactive = new DraftReadHarness();
    inactive.grants = [draftReadGrant()];
    inactive.principalStatus = 'SUSPENDED';
    const inactiveView = await harnessPort(inactive).authorizeContextSnapshotDraftRead(
      inactive.deps,
      validInput(),
    );
    expect(inactiveView.outcome).toBe('DENY');
    expect(inactiveView.reasons).toEqual(['PRINCIPAL_NOT_ACTIVE']);
    expect(inactive.decisions).toEqual([]);

    // `release.authorize` is Human-only; an Agent actor never receives it, even
    // when a Grant of that capability is configured for it.
    const humanOnly = new DraftReadHarness();
    humanOnly.grants = [
      draftReadGrant({
        capabilityCode: 'release.authorize',
        actions: [draftReadApproved.requiredGrantAction],
      }),
    ];
    humanOnly.principalKind = 'AGENT';
    const humanOnlyView = await harnessPort(humanOnly, {
      contextSnapshotDraftReadV11: 'release.authorize',
    }).authorizeContextSnapshotDraftRead(humanOnly.deps, validInput());
    expect(humanOnlyView.outcome).toBe('DENY');
    expect(humanOnlyView.reasons).toEqual(['CAPABILITY_HUMAN_ONLY']);
    expect(humanOnly.decisions).toEqual([]);
  });

  it('fails closed when the owning actor snapshot read cannot match the request', async () => {
    const harness = new DraftReadHarness();
    harness.grants = [draftReadGrant()];
    harness.actorHashMatched = false;
    await expect(
      harnessPort(harness).authorizeContextSnapshotDraftRead(harness.deps, validInput()),
    ).rejects.toMatchObject({ code: IDENTITY_ACTOR_SNAPSHOT_INVALID });
    expect(harness.decisions).toEqual([]);
  });

  it('writes only a masked in-scope DENIED audit when it denies', async () => {
    const harness = new DraftReadHarness();
    const view = await harnessPort(harness).authorizeContextSnapshotDraftRead(
      harness.deps,
      validInput(),
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
      draftSnapshotObjectType,
      draftSnapshotObjectId,
      'context snapshot draft-read authorization denied: NO_ACTIVE_GRANT',
    ]) {
      expect(parameters).toContain(expected);
    }
    // The request payload itself is never part of the denial record: only its
    // hash is.
    expect(parameters).toContain(commandPayloadHash);
  });
});

describe('Context Snapshot DRAFT-read revalidation', () => {
  it('refuses an unsupported expected version before reading any decision', async () => {
    const unsupported: readonly (readonly [unknown, unknown])[] = [
      ['execution.build_initial_context_snapshot', '1.0'],
      ['execution.build_initial_context_snapshot', '2.0'],
      ['execution.build_initial_context_snapshot', '1'],
      ['execution.get_context_snapshot', '1.0'],
      ['execution.get_work_order_draft', '1.1'],
      ['execution.build_initial_context_snapshot', 'latest'],
      ['execution.create_task', '1.0'],
      ['Execution.build_initial_context_snapshot', '1.1'],
      [' execution.build_initial_context_snapshot', '1.1'],
      [undefined, '1.1'],
      ['execution.build_initial_context_snapshot', undefined],
      [2, 1],
    ];
    for (const [expectedCommandType, expectedCommandVersion] of unsupported) {
      const input = {
        ...revalidationInputFor(signedDraftReadInsert()),
        expectedCommandType,
        expectedCommandVersion,
      } as unknown as ContextSnapshotDraftReadRevalidationInput;
      await expect(
        port().revalidateContextSnapshotDraftRead(pureDeps, input),
      ).rejects.toMatchObject({
        code: IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
      });
    }
  });

  it('refuses an unusable trusted configuration before reading any decision', async () => {
    for (const codes of [
      {},
      { capabilityCodes: { contextSnapshotDraftReadV11: 'Execution.WorkOrder.Draft' } },
      { capabilityCodes: undefined },
    ]) {
      await expect(
        port(codes).revalidateContextSnapshotDraftRead(
          pureDeps,
          revalidationInputFor(signedDraftReadInsert()),
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID });
    }
  });

  it('refuses a revalidation target outside the exact accepted reference', async () => {
    // The public WorkOrder spelling is not a DRAFT snapshot target.
    await expect(
      port().revalidateContextSnapshotDraftRead(pureDeps, {
        ...revalidationInputFor(signedDraftReadInsert()),
        expectedDraftSnapshotRef: draftSnapshotRef({ objectType: 'zhiju.execution.work_order' }),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    await expect(
      port().revalidateContextSnapshotDraftRead(pureDeps, {
        ...revalidationInputFor(signedDraftReadInsert()),
        expectedDraftSnapshotRef: draftSnapshotRef({ objectId: 'abc' }),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
    await expect(
      port().revalidateContextSnapshotDraftRead(pureDeps, {
        ...revalidationInputFor(signedDraftReadInsert()),
        expectedDraftSnapshotRef: {
          ...draftSnapshotRef(),
          contentHash: {
            algorithm: 'SHA-512',
            digest: 'a'.repeat(64),
            canonicalizationVersion: '1',
          } as unknown as Common.ContentHash,
        },
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID });
  });

  it('accepts the Decision this Port signed', async () => {
    const harness = await signedDraftRead();
    const signed = harness.lastSigned();
    const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(
      harness.deps,
      revalidationInputFor(signed),
    );
    expect(result).toMatchObject({
      valid: true,
      draftSnapshotRef: draftSnapshotRef(),
      expiresAt: new Date(clock.getTime() + decisionTtlMs).toISOString(),
    });
  });

  it('accepts the Decision this Port signed with an immutableVersionId', async () => {
    const harness = await signedDraftRead(draftSnapshotRef({ immutableVersionId }));
    const signed = harness.lastSigned();
    const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(
      harness.deps,
      revalidationInputFor(signed),
    );
    expect(result).toMatchObject({
      valid: true,
      draftSnapshotRef: draftSnapshotRef({ immutableVersionId }),
      expiresAt: new Date(clock.getTime() + decisionTtlMs).toISOString(),
    });
  });

  it('refuses a historical Decision that carries no target binding', async () => {
    const harness = await signedDraftRead();
    const unbound = decisionRow(harness.lastSigned(), { dropTargetRef: true });
    harness.decisionOverride = unbound;
    const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(
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
      ) => ContextSnapshotDraftReadRevalidationInput | undefined;
    }
    const defaultInput = (
      harness: DraftReadHarness,
      signed: AuthorizationDecisionInsert,
    ): ContextSnapshotDraftReadRevalidationInput => revalidationInputFor(signed);
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
          expectedDraftSnapshotRef: draftSnapshotRef({ objectId: otherUuid }),
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
            purpose: 'execution.context.build.initial',
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
            requestedCapability: 'execution.work_order.draft.read',
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
      const harness = await signedDraftRead();
      const signed = harness.lastSigned();
      const input = substitution.apply(harness, signed);
      // A substitution that replaces the stored row changes its payload hash,
      // so the Decision reference must name the row that is actually stored.
      const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(
        harness.deps,
        input ?? revalidationInputFor(signed, harness.storedDecisionHash()),
      );
      expect({ name: substitution.name, result }).toEqual({
        name: substitution.name,
        result: { valid: false, reason: substitution.reason },
      });
    }
  });

  it('refuses a hash or version-id substitution behind the same promoted id', async () => {
    // The promoted columns only mirror the object id: every substitution that
    // keeps the id must still fail the complete-reference comparison (Spec 001
    // §15.9 rule 2).
    {
      // content hash substitution
      const harness = await signedDraftRead();
      const signed = harness.lastSigned();
      const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(harness.deps, {
        ...revalidationInputFor(signed),
        expectedDraftSnapshotRef: draftSnapshotRef({ contentHash: contentHash(9) }),
      });
      expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
    }
    {
      // version id added to a Decision that bound its absence
      const harness = await signedDraftRead();
      const signed = harness.lastSigned();
      const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(harness.deps, {
        ...revalidationInputFor(signed),
        expectedDraftSnapshotRef: draftSnapshotRef({ immutableVersionId }),
      });
      expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
    }
    {
      // version id removed from, or replaced behind, the same promoted id
      const harness = await signedDraftRead(draftSnapshotRef({ immutableVersionId }));
      const signed = harness.lastSigned();
      const removed = await harnessPort(harness).revalidateContextSnapshotDraftRead(harness.deps, {
        ...revalidationInputFor(signed),
        expectedDraftSnapshotRef: draftSnapshotRef(),
      });
      expect(removed).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
      const replaced = await harnessPort(harness).revalidateContextSnapshotDraftRead(harness.deps, {
        ...revalidationInputFor(signed),
        expectedDraftSnapshotRef: draftSnapshotRef({ immutableVersionId: otherUuid }),
      });
      expect(replaced).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
    }
  });

  it('never lets the Decision of one DRAFT snapshot authorize another snapshot', async () => {
    // Snapshot B has its own id and its own hash; the lawful Decision of
    // snapshot A covers neither (Spec 001 §15.9 acceptance).
    const harness = await signedDraftRead();
    const signed = harness.lastSigned();
    const snapshotB = draftSnapshotRef({ objectId: otherUuid, contentHash: contentHash(9) });
    const result = await harnessPort(harness).revalidateContextSnapshotDraftRead(harness.deps, {
      ...revalidationInputFor(signed),
      expectedDraftSnapshotRef: snapshotB,
    });
    expect(result).toEqual({ valid: false, reason: 'TARGET_MISMATCH' });
  });
});
