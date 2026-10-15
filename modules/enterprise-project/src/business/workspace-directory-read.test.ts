// IM-UI-01 (#258/#266): unit tests of the EnterpriseProject owning read behind
// one workspace directory candidate card.
//
// A recording in-memory connection stands in for PostgreSQL: every statement
// the real `withEnterpriseProjectTransaction` RLS preamble and the read issue
// is captured and answered with a canned joined row, so the suite exercises the
// real transaction wrapper and the real select without a database. The suite
// also asserts the read is a single, closed two-table select and never mutates.

import { describe, expect, it } from 'vitest';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type Driver,
} from 'kysely';
import type {
  EnterpriseProjectDb,
  EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';
import { DEPENDENCY_UNAVAILABLE } from './context-source-slice-policy.js';
import {
  readWorkspaceProjectSummary,
  type WorkspaceProjectSummaryRequest,
} from './workspace-directory-read.js';

const ENT = '019945f7-3001-7000-8000-000000000001';
const OTHER_ENT = '019945f7-3002-7000-8000-000000000002';
const PRJ = '019945f7-3003-7000-8000-000000000003';
const OTHER_PRJ = '019945f7-3004-7000-8000-000000000004';
const PRINCIPAL = '019945f7-3005-7000-8000-000000000005';
const ACTOR = '019945f7-3006-7000-8000-000000000006';
const DECISION = '019945f7-3007-7000-8000-000000000007';
const POLICY = '019945f7-3008-7000-8000-000000000008';
const CORRELATION = '019945f7-3009-7000-8000-000000000009';

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

/** The canned joined `project x enterprise` row, keyed exactly as the read selects. */
interface CannedRow {
  readonly project_id: string;
  readonly enterprise_id: string;
  readonly display_code: string;
  readonly project_title: string;
  readonly project_status: string;
  readonly project_aggregate_version: string;
  readonly enterprise_display_name: string;
  readonly enterprise_status: string;
}

function happyRow(overrides: Partial<CannedRow> = {}): CannedRow {
  return {
    project_id: PRJ,
    enterprise_id: ENT,
    display_code: 'PRJ-001',
    project_title: 'Starter Project',
    project_status: 'ACTIVE',
    project_aggregate_version: '7',
    enterprise_display_name: 'Acme Industries',
    enterprise_status: 'ACTIVE',
    ...overrides,
  };
}

function context(
  overrides: Partial<EnterpriseProjectTransactionContext> = {},
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 1),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60_000),
    policySnapshotId: POLICY,
    enterpriseId: ENT,
    allowedProjectIds: [PRJ],
    correlationId: CORRELATION,
    ...overrides,
  };
}

function request(
  overrides: Partial<WorkspaceProjectSummaryRequest> = {},
): WorkspaceProjectSummaryRequest {
  return { enterpriseId: ENT, projectId: PRJ, ...overrides };
}

class ReadHarness {
  readonly executed: RecordedQuery[] = [];
  constructor(private readonly row: CannedRow | undefined) {}

  /** The captured statement that reads the owning Project (never the RLS preamble). */
  projectStatement(): RecordedQuery {
    const statement = this.executed.find((query) =>
      query.sql.includes('from "enterprise_project"."project"'),
    );
    if (statement === undefined) throw new Error('no Project read statement was issued');
    return statement;
  }

  run(
    overrides: {
      readonly context?: EnterpriseProjectTransactionContext;
      readonly request?: WorkspaceProjectSummaryRequest;
    } = {},
  ) {
    return readWorkspaceProjectSummary(
      this.db(),
      overrides.context ?? context(),
      overrides.request ?? request(),
    );
  }

  private connection(): {
    executeQuery(compiledQuery: CompiledQuery): Promise<{ readonly rows: unknown[] }>;
    streamQuery(): AsyncIterableIterator<unknown>;
  } {
    return {
      executeQuery: (compiledQuery: CompiledQuery) => {
        const parameters = compiledQuery.parameters;
        this.executed.push({ sql: compiledQuery.sql, parameters });
        if (
          compiledQuery.sql.startsWith('select') &&
          compiledQuery.sql.includes('"enterprise_project"."project"')
        ) {
          if (this.row === undefined) return Promise.resolve({ rows: [] });
          const [enterpriseId, projectId] = parameters as readonly [string, string];
          const matches =
            this.row.enterprise_id === enterpriseId && this.row.project_id === projectId;
          return Promise.resolve({ rows: matches ? [this.row] : [] });
        }
        return Promise.resolve({ rows: [] });
      },
      streamQuery: () => {
        throw new Error('this suite never streams');
      },
    };
  }

  private db(): Kysely<EnterpriseProjectDb> {
    const connection = this.connection();
    return new Kysely<EnterpriseProjectDb>({
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
}

async function rejectCode(promise: Promise<unknown>): Promise<{ code: string; name: string }> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof EnterpriseBusinessError)) throw error;
    return { code: error.code, name: error.name };
  }
  throw new Error('expected the read to reject');
}

describe('readWorkspaceProjectSummary', () => {
  it('maps the closed summary and converts the int8 aggregate version to a number', async () => {
    const harness = new ReadHarness(happyRow());
    await expect(harness.run()).resolves.toEqual({
      enterpriseId: ENT,
      projectId: PRJ,
      enterpriseDisplayName: 'Acme Industries',
      displayCode: 'PRJ-001',
      title: 'Starter Project',
      status: 'ACTIVE',
      aggregateVersion: 7,
    });
  });

  it('returns undefined when no committed Project row is visible', async () => {
    const harness = new ReadHarness(undefined);
    await expect(harness.run()).resolves.toBeUndefined();
  });

  it('passes the owning Project status through without synthesising it', async () => {
    for (const status of ['PREPARING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const) {
      const harness = new ReadHarness(happyRow({ project_status: status }));
      const summary = await harness.run();
      expect(summary?.status).toBe(status);
    }
  });

  it('rejects when the request Enterprise disagrees with the trusted context', async () => {
    const harness = new ReadHarness(happyRow());
    const rejection = await rejectCode(
      harness.run({ context: context({ enterpriseId: OTHER_ENT }) }),
    );
    expect(rejection.code).toBe(PROJECT_QUERY_SCOPE_MISMATCH);
    expect(harness.executed).toHaveLength(0);
  });

  it('rejects unless the trusted context carries exactly the requested Project', async () => {
    for (const allowedProjectIds of [[], [OTHER_PRJ], [PRJ, OTHER_PRJ]] as const) {
      const harness = new ReadHarness(happyRow());
      const rejection = await rejectCode(harness.run({ context: context({ allowedProjectIds }) }));
      expect(rejection.code).toBe(PROJECT_QUERY_SCOPE_MISMATCH);
      expect(harness.executed).toHaveLength(0);
    }
  });

  it('rejects a non-safe-integer aggregate version as a dependency failure', async () => {
    for (const raw of ['abc', '', '9007199254740993', '1.5', '0', '-1']) {
      const harness = new ReadHarness(happyRow({ project_aggregate_version: raw }));
      const rejection = await rejectCode(harness.run());
      expect(rejection.code).toBe(DEPENDENCY_UNAVAILABLE);
    }
  });

  it('rejects an unregistered stored Project status', async () => {
    const harness = new ReadHarness(happyRow({ project_status: 'UNREGISTERED_STATUS' }));
    const rejection = await rejectCode(harness.run());
    expect(rejection.code).toBe(DEPENDENCY_UNAVAILABLE);
  });

  it('selects only the declared Project and Enterprise display columns', async () => {
    const harness = new ReadHarness(happyRow());
    await harness.run();
    const statement = harness.projectStatement();
    const clause = statement.sql.slice(
      statement.sql.indexOf('select') + 'select'.length,
      statement.sql.indexOf(' from '),
    );
    const expected = [
      '"enterprise_project"."project"."project_id"',
      '"enterprise_project"."project"."enterprise_id"',
      '"enterprise_project"."project"."display_code"',
      '"enterprise_project"."project"."title" as "project_title"',
      '"enterprise_project"."project"."status" as "project_status"',
      '"enterprise_project"."project"."aggregate_version" as "project_aggregate_version"',
      '"enterprise_project"."enterprise"."display_name" as "enterprise_display_name"',
      '"enterprise_project"."enterprise"."status" as "enterprise_status"',
    ];
    for (const column of expected) expect(clause).toContain(column);
    // Exactly eight selected expressions: no extra column may leak a card field.
    expect(clause.split('", "').length).toBe(8);
    for (const forbidden of [
      'objective',
      'member_policy_ref',
      'member_policy_version_id',
      'member_policy_payload_hash',
      'retention_class',
      'created_at',
      'created_by_principal_id',
      'updated_at',
      'last_command_id',
      'current_fact_snapshot_id',
      'current_product_id',
      'current_qms_configuration_id',
    ]) {
      expect(statement.sql).not.toContain(forbidden);
    }
    // The only tables touched are the owning Project and its Enterprise.
    for (const foreign of [
      'identity_policy',
      'enterprise_project"."enterprise_fact',
      'enterprise_project"."product',
      'enterprise_project"."delivery_item',
      'projection."',
    ]) {
      expect(statement.sql).not.toContain(foreign);
    }
  });

  it('issues only reads and never mutates', async () => {
    const harness = new ReadHarness(happyRow());
    await harness.run();
    const mutating = harness.executed.filter((query) =>
      /^(insert|update|delete)\b/i.test(query.sql.trim()),
    );
    expect(mutating).toHaveLength(0);
  });
});
