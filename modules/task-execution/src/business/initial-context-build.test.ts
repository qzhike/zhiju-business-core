// IM-06 (#216): `execution.build_initial_context_snapshot@1.1` handler tests.
// A recording in-memory connection stands in for PostgreSQL: every statement
// the command runner, the repositories and the RLS preamble issue is captured
// and answered with canned rows, so the suite exercises the real handler, the
// real assembly and the real runner wiring without a database. Source Slice
// fixtures replicate the EnterpriseProject-published slice shape
// (type-matched; no cross-module imports).

import { describe, expect, it } from 'vitest';
import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  Kysely,
  type CompiledQuery,
  type Driver,
} from 'kysely';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
} from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import {
  CommandExecutionError,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import { CONTEXT_SNAPSHOT_OBJECT_TYPE } from '../persistence/context-snapshot-repository.js';
import {
  BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
  BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
  buildInitialContextIdempotencyScope,
  EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
  EXECUTION_DRAFT_SNAPSHOT_STALE,
  handleBuildInitialContext,
  POLICY_EXPIRED,
  POLICY_NOT_EFFECTIVE,
  type ContextBuilderPolicyPort,
  type ContextSourceSliceReadPort,
} from './initial-context-build.js';
import { EXECUTION_CONTEXT_SOURCE_INVALID } from './initial-context-assembly.js';
import { API_VALUE_INVALID, DEPENDENCY_UNAVAILABLE } from './work-order-draft-creation.js';
import {
  AGGREGATE_STATE_NOT_ALLOWED,
  REFERENCE_INVALID,
  WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
} from './work-order-draft-read.js';
import { CONTEXT_BUILDER_POLICY_PROFILE_KEY } from './policy-profiles.js';

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
const TARGET_ID = '019945f7-1017-7000-8000-000000000017';
const PRINCIPAL = '019945f7-1018-7000-8000-000000000018';
const ACTOR_SNAPSHOT = '019945f7-1019-7000-8000-000000000019';
const AUTH_DECISION = '019945f7-101a-7000-8000-00000000001a';
const AUTH_POLICY_SNAPSHOT = '019945f7-101b-7000-8000-00000000001b';
const CORRELATION = '019945f7-101c-7000-8000-00000000001c';
const OTHER_PROJECT = '019945f7-101d-7000-8000-00000000001d';

const PURPOSE = 'document.write';
const COMMIT_AT = new Date('2026-09-19T08:15:30.123Z');

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

function builderPolicyRef(): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.identity.policy',
    objectId: POLICY_OBJECT,
    versionId: POLICY_VERSION,
    scope: { enterpriseId: ENT, projectId: PRJ },
  };
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
      scope: { enterpriseId: ENT },
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
        contentHash: contentHash('1'),
      },
      qmsConfigurationRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.project.qms_configuration',
        objectId: QMS_OBJECT,
        versionId: QMS_VERSION,
        scope: { enterpriseId: ENT },
      },
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

function sliceA(): Record<string, unknown> {
  return slicePayload(
    SLICE_A,
    '2026-09-18T10:00:00Z',
    '2027-01-01T00:00:00Z',
    [factItem(FACT_A_OBJECT, FACT_A_VERSION, 'CONFIRMED')],
    [{ kind: 'PRODUCT_SCOPE', reasonCode: 'PURPOSE_FORBIDDEN' }],
    41,
  );
}

function sliceB(): Record<string, unknown> {
  return slicePayload(
    SLICE_B,
    '2026-09-18T11:00:00Z',
    '2026-12-01T00:00:00Z',
    [factItem(FACT_B_OBJECT, FACT_B_VERSION, 'DISPUTED')],
    [],
    42,
  );
}

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
          ref: sliceRef(SLICE_A, 'a'),
          required: true,
          permittedUse: PURPOSE,
          contentAccessMode: 'REFERENCE_ONLY',
          integrityRequired: true,
        },
        {
          inputRole: 'source.secondary',
          ref: sliceRef(SLICE_B, 'b'),
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
    capturedAt: '2026-09-18T09:00:00Z',
    createdBy: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
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

function asCanonical(value: unknown): CanonicalJsonObject {
  return value as CanonicalJsonObject;
}

function rec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

interface RecordingConnection {
  executeQuery(compiledQuery: CompiledQuery): Promise<{ readonly rows: unknown[] }>;
  streamQuery(): AsyncIterableIterator<unknown>;
}

class BuildHarness {
  readonly executed: RecordedQuery[] = [];
  /** `false` simulates a lost idempotency-claim race. */
  claimSucceeds = true;
  /** The historical Receipt the replay read returns, when set. */
  replayRow: Record<string, unknown> | undefined;
  /** Canned owning rows; `undefined` means the read finds nothing. */
  draftRow: Record<string, unknown> | undefined;
  rootRow: Record<string, unknown> | undefined;
  snapshotInsertSucceeds = true;
  sliceUseStatus = 'USABLE';
  sliceMissing = false;
  sliceThrows = false;
  policyStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'REVOKED' = 'USABLE';
  policyThrows = false;
  readonly draftHash: Buffer;
  readonly draftPayload: Record<string, unknown>;

  constructor() {
    this.draftPayload = draftPayload();
    this.draftHash = digestCanonicalPayload(asCanonical(this.draftPayload)).hash;
    this.draftRow = {
      snapshot_id: DRAFT_SNAPSHOT,
      work_order_id: WO,
      enterprise_id: ENT,
      project_id: PRJ,
      payload_hash: this.draftHash,
      canonical_payload: this.draftPayload,
    };
    this.rootRow = {
      work_order_id: WO,
      enterprise_id: ENT,
      project_id: PRJ,
      work_order_object_type: 'zhiju.execution.work_order',
      task_id: TASK,
      task_object_type: 'zhiju.execution.task',
      status: 'DRAFT',
      aggregate_version: '1',
      current_draft_snapshot_id: DRAFT_SNAPSHOT,
      current_draft_snapshot_hash: this.draftHash,
      draft_schema_version: '1.1',
      expires_at: null,
    };
  }

  /** The request payload whose draftSnapshotRef names the canned draft row. */
  requestPayload(): CanonicalJsonObject {
    return asCanonical({
      request: {
        draftSnapshotRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
          objectId: DRAFT_SNAPSHOT,
          scope: { enterpriseId: ENT, projectId: PRJ },
          contentHash: {
            algorithm: 'SHA-256',
            digest: this.draftHash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        projectionType: 'DOCUMENT_WRITER',
        purpose: PURPOSE,
        audience: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
        sourceSlices: [sliceRef(SLICE_A, 'a'), sliceRef(SLICE_B, 'b')],
        builderPolicyRef: builderPolicyRef(),
      },
    });
  }

  envelope(requestPayload: CanonicalJsonObject): CommandEnvelope {
    return {
      commandId: COMMAND_ID,
      commandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
      commandVersion: BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
      idempotencyScope: buildInitialContextIdempotencyScope(
        BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
        BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
        ENT,
        PRJ,
      ),
      idempotencyKey: 'idem-build-1',
      requestPayload,
      enterpriseId: ENT,
      projectId: PRJ,
      targetType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
      targetId: TARGET_ID,
      correlationId: CORRELATION,
      principalId: PRINCIPAL,
      principalKind: 'SERVICE',
      actorSnapshotId: ACTOR_SNAPSHOT,
      authorizationDecisionId: AUTH_DECISION,
      policySnapshotId: AUTH_POLICY_SNAPSHOT,
    };
  }

  context(): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: PRINCIPAL,
      principalKind: 'SERVICE',
      actorSnapshotId: ACTOR_SNAPSHOT,
      authorizationDecisionId: AUTH_DECISION,
      authorizationDecisionHash: Buffer.alloc(32, 7),
      authorizationDecisionExpiresAt: new Date('2027-01-01T00:00:00Z'),
      policySnapshotId: AUTH_POLICY_SNAPSHOT,
      enterpriseId: ENT,
      allowedProjectIds: [PRJ],
      correlationId: CORRELATION,
    };
  }

  slicesPort(): ContextSourceSliceReadPort {
    return {
      getContextSourceSlice: (request) => {
        if (this.sliceThrows) return Promise.reject(new Error('boundary down'));
        if (this.sliceMissing) return Promise.resolve(undefined);
        const objectId = rec(request.sourceSliceRef).objectId;
        const slice = objectId === SLICE_A ? sliceA() : objectId === SLICE_B ? sliceB() : undefined;
        return Promise.resolve(
          slice === undefined
            ? undefined
            : {
                slice: asCanonical(slice),
                useStatus: this.sliceUseStatus,
                checkedAt: '2026-09-19T08:15:30.000Z',
              },
        );
      },
    };
  }

  policyPort(): ContextBuilderPolicyPort {
    return {
      resolvePolicy: () => {
        if (this.policyThrows) return Promise.reject(new Error('boundary down'));
        if (this.policyStatus !== 'USABLE') return Promise.resolve({ status: this.policyStatus });
        return Promise.resolve({
          status: 'USABLE' as const,
          policyRef: asCanonical(builderPolicyRef()),
          contentHash: digestText('e'),
          effectiveFrom: '2026-01-01T00:00:00Z',
          policySchemaRefs: [profileSchemaRef()],
          policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
        });
      },
    };
  }

  inserts(table: string): RecordedQuery[] {
    return this.executed.filter(
      (query) =>
        query.sql.startsWith('insert into') && query.sql.includes(`"task_execution"."${table}"`),
    );
  }

  private answer(sql: string, parameters: readonly unknown[]): unknown[] {
    if (sql.startsWith('SET LOCAL ROLE')) return [];
    if (sql.includes('establish_transaction_context')) return [];
    if (sql.includes('context_principal_id()')) return [{ principal_id: PRINCIPAL }];
    if (sql.includes('context_enterprise_id()')) return [{ enterprise_id: ENT }];
    if (sql.includes('context_allows_enterprise')) return [{ allows: true }];
    if (sql.includes('context_allows_project')) return [{ allows: true }];
    if (sql.startsWith('insert into "task_execution"."command_receipt"')) {
      return this.claimSucceeds ? [{ command_id: COMMAND_ID }] : [];
    }
    if (sql.startsWith('select') && sql.includes('"task_execution"."command_receipt"')) {
      return this.replayRow === undefined ? [] : [this.replayRow];
    }
    if (sql.includes('"task_execution"."work_order_draft_snapshot"')) {
      return this.draftRow === undefined ? [] : [this.draftRow];
    }
    if (sql.includes('"task_execution"."work_order"')) {
      return this.rootRow === undefined ? [] : [this.rootRow];
    }
    if (sql.startsWith('insert into "task_execution"."context_snapshot_build"')) return [];
    if (sql.startsWith('insert into "task_execution"."context_snapshot"')) {
      return this.snapshotInsertSucceeds ? [{ snapshot_id: parameters[0] }] : [];
    }
    return [];
  }

  private connection(): RecordingConnection {
    return {
      executeQuery: (compiledQuery: CompiledQuery) => {
        this.executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        return Promise.resolve({ rows: this.answer(compiledQuery.sql, compiledQuery.parameters) });
      },
      streamQuery: () => {
        throw new Error('this suite never streams');
      },
    };
  }

  db(): Kysely<TaskExecutionDb> {
    const connection = this.connection();
    return new Kysely<TaskExecutionDb>({
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

  run(
    requestPayload: CanonicalJsonObject = this.requestPayload(),
    envelopePatch?: (envelope: CommandEnvelope) => CommandEnvelope,
  ): Promise<CommandResult> {
    const base = this.envelope(requestPayload);
    const envelope = envelopePatch === undefined ? base : envelopePatch(base);
    return handleBuildInitialContext(this.db(), this.context(), envelope, {
      slices: this.slicesPort(),
      policy: this.policyPort(),
      now: () => COMMIT_AT,
    });
  }
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

describe('handleBuildInitialContext (§19)', () => {
  it('commits the Snapshot, its INITIAL build metadata, edges, audit and exactly one Outbox event', async () => {
    const harness = new BuildHarness();
    const result = await harness.run();
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${result.status}`);
    }

    const ref = rec(rec(result.resultPayload.data).contextSnapshotRef);
    expect(ref.kind).toBe('SNAPSHOT');
    expect(ref.objectType).toBe(CONTEXT_SNAPSHOT_OBJECT_TYPE);
    expect(ref.objectId).toBe(TARGET_ID);
    expect(ref.snapshotId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(rec(ref.scope)).toEqual({ enterpriseId: ENT, projectId: PRJ });
    expect(rec(ref.contentHash).digest).toMatch(/^[0-9a-f]{64}$/u);
    const targetRef = rec(result.resultPayload.targetRef);
    expect(targetRef.objectType).toBe(CONTEXT_SNAPSHOT_OBJECT_TYPE);
    expect(targetRef.objectId).toBe(TARGET_ID);

    const snapshotInserts = harness.inserts('context_snapshot');
    expect(snapshotInserts).toHaveLength(1);
    const snapshotParameters = snapshotInserts[0]?.parameters ?? [];
    expect(snapshotParameters[0]).toBe(ref.snapshotId);
    expect(snapshotParameters[1]).toBe(TARGET_ID);
    expect(snapshotParameters[2]).toBe(PURPOSE);
    expect(snapshotParameters[6]).toBe('1.1');
    expect(snapshotParameters[7]).toBe(POLICY_VERSION);
    expect(snapshotParameters[12]).toBe('PARTIAL');
    expect(snapshotParameters[18]).toBe(COMMAND_ID);
    expect(snapshotParameters[19]).toBe(PRINCIPAL);

    expect(harness.inserts('context_snapshot_build')).toHaveLength(1);

    const edges = harness.inserts('reference_edge');
    expect(edges).toHaveLength(4);
    expect(edges.map((edge) => edge.parameters[4])).toEqual([
      '/draftSnapshotRef',
      '/projection/builderPolicyRef',
      '/sourceSlices/0',
      '/sourceSlices/1',
    ]);
    expect(edges.map((edge) => edge.parameters[5])).toEqual([
      'TaskExecution',
      'IdentityPolicy',
      'EnterpriseProject',
      'EnterpriseProject',
    ]);

    const outbox = harness.inserts('outbox_event');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.parameters[1]).toBe('execution.ContextSnapshotBuilt');
    expect(outbox[0]?.parameters[2]).toBe('1.0');

    const audit = harness.inserts('audit_record');
    expect(audit).toHaveLength(1);
    expect(
      harness.executed.filter((query) =>
        query.sql.startsWith('update "task_execution"."command_receipt"'),
      ),
    ).toHaveLength(1);
  });

  it('returns DUPLICATE for a replayed idempotency key with the same request hash', async () => {
    const harness = new BuildHarness();
    const requestPayload = harness.requestPayload();
    harness.claimSucceeds = false;
    harness.replayRow = {
      command_type: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
      command_version: BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
      target_type: CONTEXT_SNAPSHOT_OBJECT_TYPE,
      target_id: TARGET_ID,
      request_payload_hash: digestCanonicalPayload(requestPayload).hash,
      outcome: 'COMMITTED',
      result_payload: { data: { echoed: true } },
      result_payload_hash: Buffer.alloc(32, 9),
      expected_aggregate_version: null,
    };
    const result = await harness.run(requestPayload);
    if (result.status !== 'DUPLICATE') throw new Error(`expected DUPLICATE, got ${result.status}`);
    expect(result.originalOutcome).toBe('COMMITTED');
    expect(result.resultPayload).toEqual({ data: { echoed: true } });
    expect(harness.inserts('context_snapshot')).toHaveLength(0);
  });

  it('throws COMMAND_TARGET_MISMATCH for the unsatisfiable @1.0 version', async () => {
    const harness = new BuildHarness();
    await expectCommandError(
      harness.run(undefined, (envelope) => ({ ...envelope, commandVersion: '1.0' })),
      COMMAND_TARGET_MISMATCH,
    );
  });

  it('throws COMMAND_TARGET_MISMATCH for a foreign target type', async () => {
    const harness = new BuildHarness();
    await expectCommandError(
      harness.run(undefined, (envelope) => ({ ...envelope, targetType: 'zhiju.execution.task' })),
      COMMAND_TARGET_MISMATCH,
    );
  });

  it('throws COMMAND_TARGET_MISMATCH when an expected aggregate version is declared', async () => {
    const harness = new BuildHarness();
    await expectCommandError(
      harness.run(undefined, (envelope) => ({ ...envelope, expectedAggregateVersion: '3' })),
      COMMAND_TARGET_MISMATCH,
    );
  });

  it('rejects a payload with members outside the registered closure', async () => {
    const harness = new BuildHarness();
    const payload = { ...harness.requestPayload(), unexpected: true } as CanonicalJsonObject;
    expectRejected(await harness.run(payload), API_VALUE_INVALID);
  });

  it('rejects a draftSnapshotRef of another Project scope', async () => {
    const harness = new BuildHarness();
    const request = rec(harness.requestPayload().request);
    request.draftSnapshotRef = {
      ...rec(request.draftSnapshotRef),
      scope: { enterpriseId: ENT, projectId: OTHER_PROJECT },
    };
    expectRejected(await harness.run(asCanonical({ request })), REFERENCE_INVALID);
  });

  it('rejects when the draft snapshot does not close against a committed row', async () => {
    const harness = new BuildHarness();
    harness.draftRow = undefined;
    expectRejected(await harness.run(), REFERENCE_INVALID);
  });

  it('rejects a non-DRAFT WorkOrder as EXECUTION_DRAFT_SNAPSHOT_STALE', async () => {
    const harness = new BuildHarness();
    harness.rootRow = { ...rec(harness.rootRow), status: 'FROZEN' };
    expectRejected(await harness.run(), EXECUTION_DRAFT_SNAPSHOT_STALE);
  });

  it('rejects a stale draft pointer as EXECUTION_DRAFT_SNAPSHOT_STALE', async () => {
    const harness = new BuildHarness();
    harness.rootRow = {
      ...rec(harness.rootRow),
      current_draft_snapshot_id: TARGET_ID,
    };
    expectRejected(await harness.run(), EXECUTION_DRAFT_SNAPSHOT_STALE);
  });

  it('rejects a @1.0-created draft as EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH', async () => {
    const harness = new BuildHarness();
    harness.rootRow = { ...rec(harness.rootRow), draft_schema_version: '1.0' };
    expectRejected(await harness.run(), EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH);
  });

  it('rejects the @1.0 pin set (projectContextContractRef present) as EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH', async () => {
    const harness = new BuildHarness();
    const payload = draftPayload();
    const draft = rec(payload.draft);
    draft.versionPins = {
      ...rec(draft.versionPins),
      projectContextContractRef: {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.project.context_snapshot',
        objectId: TARGET_ID,
        snapshotId: TARGET_ID,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: contentHash('2'),
      },
    };
    harness.draftRow = {
      ...rec(harness.draftRow),
      payload_hash: digestCanonicalPayload(asCanonical(payload)).hash,
      canonical_payload: payload,
    };
    harness.rootRow = {
      ...rec(harness.rootRow),
      current_draft_snapshot_hash: digestCanonicalPayload(asCanonical(payload)).hash,
    };
    const request = rec(harness.requestPayload().request);
    request.draftSnapshotRef = {
      ...rec(request.draftSnapshotRef),
      contentHash: {
        algorithm: 'SHA-256',
        digest: digestCanonicalPayload(asCanonical(payload)).hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
    expectRejected(
      await harness.run(asCanonical({ request })),
      EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
    );
  });

  it('rejects when a Source Slice is missing at the owning boundary', async () => {
    const harness = new BuildHarness();
    harness.sliceMissing = true;
    expectRejected(await harness.run(), EXECUTION_CONTEXT_SOURCE_INVALID);
  });

  it('rejects a Source Slice whose use status is EXPIRED', async () => {
    const harness = new BuildHarness();
    harness.sliceUseStatus = 'EXPIRED';
    expectRejected(await harness.run(), EXECUTION_CONTEXT_SOURCE_INVALID);
  });

  it('throws DEPENDENCY_UNAVAILABLE when the Source Slice boundary throws', async () => {
    const harness = new BuildHarness();
    harness.sliceThrows = true;
    await expectCommandError(harness.run(), DEPENDENCY_UNAVAILABLE);
  });

  it('maps a NOT_YET_EFFECTIVE Builder Policy onto POLICY_NOT_EFFECTIVE', async () => {
    const harness = new BuildHarness();
    harness.policyStatus = 'NOT_YET_EFFECTIVE';
    expectRejected(await harness.run(), POLICY_NOT_EFFECTIVE);
  });

  it('maps a SUPERSEDED Builder Policy onto POLICY_EXPIRED', async () => {
    const harness = new BuildHarness();
    harness.policyStatus = 'SUPERSEDED';
    expectRejected(await harness.run(), POLICY_EXPIRED);
  });

  it('throws DEPENDENCY_UNAVAILABLE when the Policy resolution boundary throws', async () => {
    const harness = new BuildHarness();
    harness.policyThrows = true;
    await expectCommandError(harness.run(), DEPENDENCY_UNAVAILABLE);
  });

  it('rejects a JSON-null request expiry as INVALID_EXPIRY_INPUT', async () => {
    const harness = new BuildHarness();
    const request = rec(harness.requestPayload().request);
    request.expiresAt = null;
    expectRejected(await harness.run(asCanonical({ request })), 'INVALID_EXPIRY_INPUT');
  });

  it('rejects an expired WorkOrder creation expiry as AGGREGATE_STATE_NOT_ALLOWED', async () => {
    const harness = new BuildHarness();
    harness.rootRow = { ...rec(harness.rootRow), expires_at: new Date('2026-01-01T00:00:00Z') };
    expectRejected(await harness.run(), AGGREGATE_STATE_NOT_ALLOWED);
  });

  it('maps a lost Snapshot CREATE race onto CONCURRENCY_CONFLICT', async () => {
    const harness = new BuildHarness();
    harness.snapshotInsertSucceeds = false;
    expectRejected(await harness.run(), CONCURRENCY_CONFLICT);
  });
});
