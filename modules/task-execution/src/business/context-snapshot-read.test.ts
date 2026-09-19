// IM-06 (#216): `execution.get_context_snapshot@1.0` authoritative read tests
// (Spec 003 §19.2). The same recording in-memory connection stands in for
// PostgreSQL; the stored Snapshot is the real `assembleInitialContext` output,
// so the round-trip exercises the real content-address closure and the real
// Core schema revalidation. The read writes nothing: the suite asserts no
// mutating statement is ever issued.

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
import { CONTEXT_SNAPSHOT_OBJECT_TYPE } from '../persistence/context-snapshot-repository.js';
import { assembleInitialContext } from './initial-context-assembly.js';
import {
  GET_CONTEXT_SNAPSHOT_VERSION,
  handleGetContextSnapshot,
  type GetContextSnapshotResult,
} from './context-snapshot-read.js';
import { API_VALUE_INVALID } from './work-order-draft-creation.js';
import { REFERENCE_INVALID } from './work-order-draft-read.js';
import { CONTEXT_BUILDER_POLICY_PROFILE_KEY } from './policy-profiles.js';

const ENT = '019945f7-2001-7000-8000-000000000001';
const PRJ = '019945f7-2002-7000-8000-000000000002';
const WO = '019945f7-2003-7000-8000-000000000003';
const TASK = '019945f7-2004-7000-8000-000000000004';
const DRAFT_SNAPSHOT = '019945f7-2005-7000-8000-000000000005';
const SLICE_A = '019945f7-2006-7000-8000-000000000006';
const POLICY_OBJECT = '019945f7-2007-7000-8000-000000000007';
const POLICY_VERSION = '019945f7-2008-7000-8000-000000000008';
const CAPTURE_POLICY_OBJECT = '019945f7-2009-7000-8000-000000000009';
const CAPTURE_POLICY_VERSION = '019945f7-200a-7000-8000-00000000000a';
const PROFILE_OBJECT = '019945f7-200b-7000-8000-00000000000b';
const PROFILE_SNAPSHOT = '019945f7-200c-7000-8000-00000000000c';
const QMS_OBJECT = '019945f7-200d-7000-8000-00000000000d';
const QMS_VERSION = '019945f7-200e-7000-8000-00000000000e';
const WO_SCHEMA_OBJECT = '019945f7-200f-7000-8000-00000000000f';
const WO_SCHEMA_VERSION = '019945f7-2010-7000-8000-000000000010';
const FACT_OBJECT = '019945f7-2011-7000-8000-000000000011';
const FACT_VERSION = '019945f7-2012-7000-8000-000000000012';
const SNAPSHOT_ID = '019945f7-2013-7000-8000-000000000013';
const TARGET_ID = '019945f7-2014-7000-8000-000000000014';
const PRINCIPAL = '019945f7-2015-7000-8000-000000000015';
const CORRELATION = '019945f7-2016-7000-8000-000000000016';
const OTHER_ID = '019945f7-2017-7000-8000-000000000017';

const PURPOSE = 'document.write';
const AS_OF = '2026-09-19T08:15:30.123Z';

function asCanonical(value: unknown): CanonicalJsonObject {
  return value as CanonicalJsonObject;
}

function rec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

function sliceRef(): Record<string, unknown> {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.project.context_source_slice',
    objectId: SLICE_A,
    scope: { enterpriseId: ENT, projectId: PRJ },
    contentHash: { algorithm: 'SHA-256', digest: 'a'.repeat(64), canonicalizationVersion: '1' },
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

function storedPayload(): CanonicalJsonObject {
  const projectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: PRJ,
    scope: { enterpriseId: ENT, projectId: PRJ },
  };
  const profileSchemaRef = registeredPolicyProfileReference(
    POLICY_PROFILE_REGISTRY_VERSION,
    CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  );
  if (profileSchemaRef === undefined)
    throw new Error('the context builder profile is not registered');
  const outcome = assembleInitialContext({
    request: {
      draftSnapshotRef: asCanonical({
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
        objectId: DRAFT_SNAPSHOT,
        scope: { enterpriseId: ENT, projectId: PRJ },
        contentHash: { algorithm: 'SHA-256', digest: 'd'.repeat(64), canonicalizationVersion: '1' },
      }),
      projectionType: 'DOCUMENT_WRITER',
      purpose: PURPOSE,
      audience: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
      builderPolicyRef: asCanonical(builderPolicyRef()),
    },
    draft: {
      workOrderRef: asCanonical({
        kind: 'OBJECT',
        objectType: 'zhiju.execution.work_order',
        objectId: WO,
        scope: { enterpriseId: ENT, projectId: PRJ },
      }),
      taskRef: asCanonical({
        kind: 'OBJECT',
        objectType: 'zhiju.execution.task',
        objectId: TASK,
        scope: { enterpriseId: ENT, projectId: PRJ },
      }),
      scopeRef: { enterpriseId: ENT, projectId: PRJ },
      draft: {
        inputRefs: [
          {
            inputRole: 'source.primary',
            ref: sliceRef(),
            required: true,
            permittedUse: PURPOSE,
            contentAccessMode: 'REFERENCE_ONLY',
            integrityRequired: true,
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
    },
    slices: [
      {
        ref: asCanonical(sliceRef()),
        slice: asCanonical({
          sliceId: SLICE_A,
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
          capturedAt: '2026-09-18T10:00:00Z',
          validUntil: '2027-01-01T00:00:00Z',
          source: {
            projectRef,
            enterpriseProfileSnapshotRef: {
              kind: 'SNAPSHOT',
              objectType: 'zhiju.project.enterprise_profile',
              objectId: PROFILE_OBJECT,
              snapshotId: PROFILE_SNAPSHOT,
              scope: { enterpriseId: ENT },
              contentHash: {
                algorithm: 'SHA-256',
                digest: '1'.repeat(64),
                canonicalizationVersion: '1',
              },
            },
            qmsConfigurationRef: {
              kind: 'VERSIONED',
              objectType: 'zhiju.project.qms_configuration',
              objectId: QMS_OBJECT,
              versionId: QMS_VERSION,
              scope: { enterpriseId: ENT },
            },
            factItems: [
              {
                factRef: {
                  kind: 'VERSIONED',
                  objectType: 'EnterpriseFact',
                  objectId: FACT_OBJECT,
                  versionId: FACT_VERSION,
                  scope: { enterpriseId: ENT },
                },
                factType: 'REGULATORY_OBLIGATION',
                riskLevel: 'LOW',
                status: 'CONFIRMED',
                value: {
                  presence: 'REDACTED',
                  reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED',
                  evidenceRefs: [],
                },
              },
            ],
            omissions: [],
            redactions: [],
            sourceWatermark: {
              sourceModule: 'enterprise_project',
              partition: PRJ,
              sequence: 41,
              observedAt: '2026-09-18T10:00:00Z',
            },
          },
        }),
      },
    ],
    policy: {
      resolvedRef: asCanonical(builderPolicyRef()),
      contentHashDigest: 'e'.repeat(64),
      effectiveFrom: '2026-01-01T00:00:00Z',
      policySchemaRefs: [profileSchemaRef],
      policyDocument: { allowedProjectionTypes: ['DOCUMENT_WRITER'] },
    },
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
    correlationId: CORRELATION,
    issuedBy: { principalId: PRINCIPAL, principalKind: 'SERVICE' },
  });
  if (outcome.outcome !== 'ASSEMBLED') {
    throw new Error(`fixture assembly failed: ${outcome.errorCode}`);
  }
  return outcome.payload;
}

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

class ReadHarness {
  readonly executed: RecordedQuery[] = [];
  readonly payload: CanonicalJsonObject;
  readonly payloadHash: Buffer;
  /** The canned Snapshot row; `undefined` simulates an uncommitted identity. */
  row: Record<string, unknown> | undefined;

  constructor() {
    this.payload = storedPayload();
    this.payloadHash = digestCanonicalPayload(this.payload).hash;
    this.row = {
      snapshot_id: SNAPSHOT_ID,
      object_id: TARGET_ID,
      enterprise_id: ENT,
      project_id: PRJ,
      payload_hash: this.payloadHash,
      canonical_payload: this.payload,
    };
  }

  /** The exact six-field SnapshotRef that names the canned row. */
  snapshotRef(): Record<string, unknown> {
    return {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
      objectId: TARGET_ID,
      snapshotId: SNAPSHOT_ID,
      scope: { enterpriseId: ENT, projectId: PRJ },
      contentHash: {
        algorithm: 'SHA-256',
        digest: this.payloadHash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
  }

  context(): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: PRINCIPAL,
      principalKind: 'SERVICE',
      actorSnapshotId: '019945f7-2018-7000-8000-000000000018',
      authorizationDecisionId: '019945f7-2019-7000-8000-000000000019',
      authorizationDecisionHash: Buffer.alloc(32, 7),
      authorizationDecisionExpiresAt: new Date('2027-01-01T00:00:00Z'),
      policySnapshotId: '019945f7-201a-7000-8000-00000000001a',
      enterpriseId: ENT,
      allowedProjectIds: [PRJ],
      correlationId: CORRELATION,
    };
  }

  snapshotSelects(): RecordedQuery[] {
    return this.executed.filter(
      (query) =>
        query.sql.startsWith('select') && query.sql.includes('"task_execution"."context_snapshot"'),
    );
  }

  mutatingStatements(): RecordedQuery[] {
    return this.executed.filter(
      (query) =>
        query.sql.startsWith('insert into') ||
        query.sql.startsWith('update') ||
        query.sql.startsWith('delete from'),
    );
  }

  private connection(): {
    executeQuery(compiledQuery: CompiledQuery): Promise<{ readonly rows: unknown[] }>;
    streamQuery(): AsyncIterableIterator<unknown>;
  } {
    return {
      executeQuery: (compiledQuery: CompiledQuery) => {
        this.executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        const sql = compiledQuery.sql;
        if (sql.startsWith('select') && sql.includes('"task_execution"."context_snapshot"')) {
          const row = this.row;
          if (row === undefined) return Promise.resolve({ rows: [] });
          // The repository puts the full identity, content Hash included, into
          // the WHERE clause; the canned row answers only to an exact match.
          const [objectId, snapshotId, payloadHash] = compiledQuery.parameters;
          const matches =
            row.object_id === objectId &&
            row.snapshot_id === snapshotId &&
            Buffer.isBuffer(payloadHash) &&
            (row.payload_hash as Buffer).equals(payloadHash);
          return Promise.resolve({ rows: matches ? [row] : [] });
        }
        return Promise.resolve({ rows: [] });
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

  run(payload: unknown): Promise<GetContextSnapshotResult> {
    return handleGetContextSnapshot(this.db(), this.context(), {
      commandVersion: GET_CONTEXT_SNAPSHOT_VERSION,
      payload,
    });
  }

  runWithVersion(commandVersion: string, payload: unknown): Promise<GetContextSnapshotResult> {
    return handleGetContextSnapshot(this.db(), this.context(), { commandVersion, payload });
  }
}

function expectRejected(result: GetContextSnapshotResult, errorCode: string): void {
  if (result.status !== 'REJECTED') {
    throw new Error(`expected REJECTED(${errorCode}), got ${result.status}`);
  }
  expect(result.errorCode).toBe(errorCode);
}

describe('handleGetContextSnapshot (§19.2)', () => {
  it('returns the committed Snapshot verbatim, echoing the requested ref field-for-field', async () => {
    const harness = new ReadHarness();
    const requestRef = harness.snapshotRef();
    const result = await harness.run({ contextSnapshotRef: requestRef });
    if (result.status !== 'FOUND') {
      throw new Error(`expected FOUND, got ${result.status}`);
    }
    expect(result.resultPayload.contextSnapshotRef).toEqual(requestRef);
    expect(result.resultPayload.projectContextContract).toEqual(harness.payload);
    expect(result.resultPayload.contractRef).toEqual({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.contract.project_context',
      objectId: SNAPSHOT_ID,
      scope: { enterpriseId: ENT, projectId: PRJ },
      contentHash: {
        algorithm: 'SHA-256',
        digest: harness.payloadHash.toString('hex'),
        canonicalizationVersion: '1',
      },
    });
    expect(harness.snapshotSelects()).toHaveLength(1);
    expect(harness.mutatingStatements()).toHaveLength(0);
  });

  it('rejects a read version that has no handler', async () => {
    const harness = new ReadHarness();
    expectRejected(
      await harness.runWithVersion('1.1', { contextSnapshotRef: harness.snapshotRef() }),
      REFERENCE_INVALID,
    );
    expect(harness.snapshotSelects()).toHaveLength(0);
  });

  it('rejects a payload with members outside the registered closure', async () => {
    const harness = new ReadHarness();
    expectRejected(
      await harness.run({ contextSnapshotRef: harness.snapshotRef(), unexpected: true }),
      API_VALUE_INVALID,
    );
  });

  it('rejects a contextSnapshotRef that is not a SnapshotRef', async () => {
    const harness = new ReadHarness();
    expectRejected(await harness.run({ contextSnapshotRef: 'not-a-ref' }), REFERENCE_INVALID);
  });

  it('rejects the legacy objectType without any lookup', async () => {
    const harness = new ReadHarness();
    const ref = { ...harness.snapshotRef(), objectType: 'zhiju.project.context_snapshot' };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
    expect(harness.snapshotSelects()).toHaveLength(0);
  });

  it('rejects a foreign objectType', async () => {
    const harness = new ReadHarness();
    const ref = { ...harness.snapshotRef(), objectType: 'zhiju.execution.other' };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects a ref without snapshotId', async () => {
    const harness = new ReadHarness();
    const ref = harness.snapshotRef();
    delete ref.snapshotId;
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects a non-UuidV7 objectId', async () => {
    const harness = new ReadHarness();
    const ref = { ...harness.snapshotRef(), objectId: 'not-a-uuid' };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects an enterprise-only scope', async () => {
    const harness = new ReadHarness();
    const ref = { ...harness.snapshotRef(), scope: { enterpriseId: ENT } };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects an uncommitted identity (the Hash is part of the lookup)', async () => {
    const harness = new ReadHarness();
    harness.row = undefined;
    expectRejected(
      await harness.run({ contextSnapshotRef: harness.snapshotRef() }),
      REFERENCE_INVALID,
    );
  });

  it('rejects a foreign content Hash replay', async () => {
    const harness = new ReadHarness();
    const ref = harness.snapshotRef();
    ref.contentHash = {
      algorithm: 'SHA-256',
      digest: 'f'.repeat(64),
      canonicalizationVersion: '1',
    };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects a row whose scope differs from the requested scope', async () => {
    const harness = new ReadHarness();
    harness.row = { ...rec(harness.row), enterprise_id: OTHER_ID };
    expectRejected(
      await harness.run({ contextSnapshotRef: harness.snapshotRef() }),
      REFERENCE_INVALID,
    );
  });

  it('rejects a stored payload whose bytes no longer match its content address', async () => {
    const harness = new ReadHarness();
    const tampered = { ...rec(harness.payload), purpose: 'tampered' };
    harness.row = { ...rec(harness.row), canonical_payload: tampered };
    expectRejected(
      await harness.run({ contextSnapshotRef: harness.snapshotRef() }),
      REFERENCE_INVALID,
    );
  });

  it('rejects a stored payload that fails the registered Core schema', async () => {
    const harness = new ReadHarness();
    const broken = rec(JSON.parse(JSON.stringify(harness.payload)));
    delete broken.coverage;
    const brokenHash = digestCanonicalPayload(asCanonical(broken)).hash;
    harness.row = { ...rec(harness.row), canonical_payload: broken, payload_hash: brokenHash };
    const ref = harness.snapshotRef();
    ref.contentHash = {
      algorithm: 'SHA-256',
      digest: brokenHash.toString('hex'),
      canonicalizationVersion: '1',
    };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });

  it('rejects a stored payload whose header identity disagrees with the row', async () => {
    const harness = new ReadHarness();
    const shifted = rec(JSON.parse(JSON.stringify(harness.payload)));
    rec(shifted.header).contractId = OTHER_ID;
    const shiftedHash = digestCanonicalPayload(asCanonical(shifted)).hash;
    harness.row = { ...rec(harness.row), canonical_payload: shifted, payload_hash: shiftedHash };
    const ref = harness.snapshotRef();
    ref.contentHash = {
      algorithm: 'SHA-256',
      digest: shiftedHash.toString('hex'),
      canonicalizationVersion: '1',
    };
    expectRejected(await harness.run({ contextSnapshotRef: ref }), REFERENCE_INVALID);
  });
});
