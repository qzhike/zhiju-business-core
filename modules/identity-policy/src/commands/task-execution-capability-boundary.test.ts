import { describe, expect, it } from 'vitest';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type Driver,
} from 'kysely';

import type { IdentityPolicyDb, IdentityTransactionContext } from '../persistence/identity-db.js';
import { HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION } from './static-registry.js';
import {
  createTaskExecutionCreationCapabilityBoundaryPort,
  IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
  IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
  IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID,
  IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
  type TaskExecutionCreationCapabilityBoundaryConfig,
  type TaskExecutionCreationCapabilityBoundaryPort,
  type TaskExecutionCreationCapabilityBoundaryRequest,
} from './task-execution-capability-boundary.js';

// The Port is a read-only classification boundary: it reads its own principal
// row for the authoritative principal kind, classifies the declared capability
// codes against its own static set, and records the classification in its own
// audit trail. It never reads a Grant, a Policy Snapshot or another module's
// table, so the whole suite runs against a recording Kysely driver that answers
// every statement in memory: the Port's real SQL is compiled and executed while
// the row it asked for and the audit row it wrote are observed directly.

/** The members of the owning set, as of registry `im02-static-v1`. */
const humanOnlyCapabilityCodes = [
  'quality.approval.decide',
  'release.authorize',
  'identity.human_only.probe',
] as const;

/** Codes outside the owning set, including one the registry never heard of. */
const nonHumanOnlyCapabilityCodes = [
  'execution.work_order.create',
  'execution.task.create',
  'integration.gateway.emit',
  'some.unknown.capability',
] as const;

const enterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d001';
const foreignEnterpriseId = '018f22e2-7c15-7b2e-8d86-2de956a9d002';
const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d011';
const foreignProjectId = '018f22e2-7c15-7b2e-8d86-2de956a9d012';
const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d003';
const actorSnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d004';
const authorizationDecisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d005';
const commandId = '018f22e2-7c15-7b2e-8d86-2de956a9d006';
const correlationId = '018f22e2-7c15-7b2e-8d86-2de956a9d007';
const otherUuid = '018f22e2-7c15-7b2e-8d86-2de956a9d008';
const actionAt = '2026-09-17T00:00:00.000Z';

/** The trusted context of one call; each harness owns its own copy. */
function trustedContext(): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId,
    actorSnapshotId,
    authorizationDecisionId,
    authorizationDecisionHash: Buffer.alloc(32, 1),
    authorizationDecisionExpiresAt: new Date('2026-09-16T00:00:00.000Z'),
    enterpriseId,
    allowedProjectIds: [projectId],
    correlationId,
  };
}

interface RecordedQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

interface RecordingConnection {
  executeQuery(compiledQuery: CompiledQuery): Promise<{ readonly rows: unknown[] }>;
  streamQuery(): AsyncIterableIterator<{ readonly rows: unknown[] }>;
}

/**
 * One in-memory owning state behind the Port: the trusted transaction context,
 * the single principal row the Port may read, and every statement it executed.
 * Nothing here talks to a database.
 */
class CapabilityBoundaryHarness {
  readonly context: IdentityTransactionContext = trustedContext();
  readonly executed: RecordedQuery[] = [];
  /** The authoritative kind of the owning principal row. */
  principalKind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY' = 'HUMAN';
  /** `false` makes the owning principal read find no row at all. */
  principalRowPresent = true;
  readonly port: TaskExecutionCreationCapabilityBoundaryPort;

  constructor() {
    const config: TaskExecutionCreationCapabilityBoundaryConfig = {
      db: this.database(),
      context: this.context,
      commandId,
    };
    this.port = createTaskExecutionCreationCapabilityBoundaryPort(config);
  }

  /** The masked Audit rows the Port wrote, as compiled statements. */
  auditInserts(): RecordedQuery[] {
    return this.executed.filter((entry) => entry.sql.includes('"identity_policy"."audit_record"'));
  }

  /** Every statement the Port executed, as SQL text. */
  statements(): string[] {
    return this.executed.map((entry) => entry.sql);
  }

  /** The owning principal read, as compiled statements. */
  principalReads(): RecordedQuery[] {
    return this.executed.filter((entry) => entry.sql.includes('"identity_policy"."principal"'));
  }

  private connection(): RecordingConnection {
    return {
      executeQuery: (compiledQuery: CompiledQuery) => {
        this.executed.push({ sql: compiledQuery.sql, parameters: compiledQuery.parameters });
        // The only owning read the Port performs itself is the authoritative
        // principal row of the trusted transaction principal.
        const readsPrincipal = compiledQuery.sql.includes('"identity_policy"."principal"');
        return Promise.resolve({
          rows: readsPrincipal ? this.principalRows() : [],
        });
      },
      streamQuery: () => {
        throw new Error('this suite never streams');
      },
    };
  }

  private principalRows(): unknown[] {
    if (!this.principalRowPresent) return [];
    return [{ id: principalId, principal_kind: this.principalKind }];
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
}

/** A structurally complete request of the supported `@1.1` creation version. */
function boundaryRequest(
  overrides: Readonly<Record<string, unknown>> = {},
): TaskExecutionCreationCapabilityBoundaryRequest {
  return {
    commandType: 'execution.create_work_order',
    commandVersion: '1.1',
    principalRef: { principalId, principalKind: 'HUMAN' },
    declaredCapabilityTypes: [],
    scopeRef: { enterpriseId, projectId },
    actionAt,
    ...overrides,
  };
}

/** The same request carrying the harness principal's exact kind. */
function classify(
  harness: CapabilityBoundaryHarness,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return harness.port.classifyDeclaredCapabilities(
    boundaryRequest({
      principalRef: { principalId, principalKind: harness.principalKind },
      ...overrides,
    }),
  );
}

describe('declared capability classification', () => {
  it('classifies the two published creation versions and nothing else', async () => {
    for (const commandVersion of ['1.0', '1.1']) {
      for (const principalKind of ['HUMAN', 'AGENT'] as const) {
        const harness = new CapabilityBoundaryHarness();
        harness.principalKind = principalKind;
        await expect(classify(harness, { commandVersion })).resolves.toEqual({
          outcome: 'VALID',
          classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
        });
      }
    }
    // A version this boundary has no entry for — including any operation other
    // than the two published WorkOrder creation versions — fails closed.
    for (const [commandType, commandVersion] of [
      ['execution.create_work_order', '2.0'],
      ['execution.create_work_order', '1'],
      ['execution.create_work_order', '1.1.0'],
      ['execution.create_work_order', 'latest'],
      ['execution.create_work_order_v11', '1.1'],
      ['execution.create_work_order@1.1', '1.1'],
      ['execution.get_work_order_draft', '1.1'],
      ['execution.create_task', '1.0'],
      ['Execution.create_work_order', '1.1'],
      [' execution.create_work_order', '1.1'],
      ['execution.create_work_order ', '1.1'],
      ['', ''],
      ['*', '*'],
    ]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { commandType, commandVersion })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
      });
      // An unsupported key fails closed in front of the owning tables.
      expect(harness.statements()).toEqual([]);
    }
  });

  it('refuses a non-string operation or version', async () => {
    for (const commandType of [undefined, null, 1, true, {}, ['execution.create_work_order']]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { commandType })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
      });
    }
    for (const commandVersion of [undefined, null, 1, true, {}, ['1.1']]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { commandVersion })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
      });
    }
  });

  it('answers VALID for a HUMAN principal whatever the declaration contains', async () => {
    for (const declaredCapabilityTypes of [
      [],
      [...humanOnlyCapabilityCodes],
      ['release.authorize', 'execution.task.create'],
      [...nonHumanOnlyCapabilityCodes],
    ]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { declaredCapabilityTypes })).resolves.toEqual({
        outcome: 'VALID',
        classificationRegistryVersion: 'im02-static-v1',
      });
    }
    // The owning set decides nothing for a HUMAN principal, and no other owning
    // fact is consulted for the answer.
    const harness = new CapabilityBoundaryHarness();
    await classify(harness, { declaredCapabilityTypes: [...humanOnlyCapabilityCodes] });
    expect(harness.principalReads()).toHaveLength(1);
  });

  it('answers INVALID for a non-HUMAN principal declaring any Human-only code', async () => {
    for (const principalKind of ['AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'] as const) {
      for (const code of humanOnlyCapabilityCodes) {
        const harness = new CapabilityBoundaryHarness();
        harness.principalKind = principalKind;
        const result = await classify(harness, { declaredCapabilityTypes: [code] });
        expect({ principalKind, code, result }).toEqual({
          principalKind,
          code,
          result: {
            outcome: 'INVALID',
            classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
          },
        });
      }
    }
    // One Human-only code next to otherwise acceptable declarations is enough.
    const harness = new CapabilityBoundaryHarness();
    harness.principalKind = 'AGENT';
    await expect(
      classify(harness, {
        declaredCapabilityTypes: [...nonHumanOnlyCapabilityCodes, 'release.authorize'],
      }),
    ).resolves.toMatchObject({ outcome: 'INVALID' });
  });

  it('answers VALID for a non-HUMAN principal outside the owning set', async () => {
    for (const principalKind of ['AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'] as const) {
      const harness = new CapabilityBoundaryHarness();
      harness.principalKind = principalKind;
      await expect(
        classify(harness, { declaredCapabilityTypes: [...nonHumanOnlyCapabilityCodes] }),
      ).resolves.toEqual({
        outcome: 'VALID',
        classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
      });
    }
    // An empty declaration, a code the registry never heard of and a code with
    // no relation to the owning set are all outside it: unknown is not unsafe.
    const harness = new CapabilityBoundaryHarness();
    harness.principalKind = 'AGENT';
    await expect(classify(harness, { declaredCapabilityTypes: [] })).resolves.toMatchObject({
      outcome: 'VALID',
    });
    await expect(
      classify(harness, {
        declaredCapabilityTypes: ['execution.work_order.draft.read', 'unknown'],
      }),
    ).resolves.toMatchObject({ outcome: 'VALID' });
  });

  it('classifies the de-duplicated declared set independently of order and repetition', async () => {
    const invalid = [
      ['release.authorize', 'execution.task.create'],
      ['execution.task.create', 'release.authorize'],
      ['release.authorize', 'execution.task.create', 'release.authorize'],
      ['execution.task.create', 'release.authorize', 'execution.task.create'],
    ];
    const valid = [
      ['execution.task.create', 'execution.work_order.create'],
      ['execution.work_order.create', 'execution.task.create'],
      ['execution.task.create', 'execution.work_order.create', 'execution.task.create'],
    ];
    for (const declaredCapabilityTypes of invalid) {
      const harness = new CapabilityBoundaryHarness();
      harness.principalKind = 'AGENT';
      await expect(classify(harness, { declaredCapabilityTypes })).resolves.toEqual({
        outcome: 'INVALID',
        classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
      });
    }
    for (const declaredCapabilityTypes of valid) {
      const harness = new CapabilityBoundaryHarness();
      harness.principalKind = 'AGENT';
      await expect(classify(harness, { declaredCapabilityTypes })).resolves.toEqual({
        outcome: 'VALID',
        classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
      });
    }
  });

  it('refuses a declaration that is not a list of exact capability codes', async () => {
    for (const declaredCapabilityTypes of [
      undefined,
      null,
      'release.authorize',
      {},
      42,
      ['release.authorize', undefined],
      ['release.authorize', null],
      ['release.authorize', 42],
      ['release.authorize', ''],
      ['release.authorize', 'Release.Authorize'],
      ['release.authorize', ' release.authorize'],
      ['release.authorize', 'release/authorize'],
      ['release.authorize', 'release..authorize'],
      ['release.authorize', ['release.authorize']],
    ]) {
      const harness = new CapabilityBoundaryHarness();
      harness.principalKind = 'AGENT';
      await expect(classify(harness, { declaredCapabilityTypes })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
      });
      expect(harness.statements()).toEqual([]);
    }
  });

  it('refuses a malformed trusted action instant', async () => {
    for (const value of [
      undefined,
      null,
      '',
      42,
      new Date(actionAt),
      '2026-09-17',
      '2026-09-17T00:00:00',
      '2026-09-17T00:00:00+00:00',
      '2026-09-17T00:00:00.000',
      ' 2026-09-17T00:00:00.000Z',
      '2026-09-17T00:00:00.000Z ',
      'latest',
    ]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { actionAt: value })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
      });
      expect(harness.statements()).toEqual([]);
    }
  });
});

describe('the trusted principal and Project Scope', () => {
  it('refuses a declared principal that is not an exact PrincipalRef of the actor', async () => {
    // Every one of these is refused by the shape and identity of the reference
    // alone, in front of the owning tables.
    for (const principalRef of [
      undefined,
      null,
      {},
      { principalId },
      { principalKind: 'HUMAN' },
      { principalId: otherUuid, principalKind: 'HUMAN' },
      { principalId: 'abc', principalKind: 'HUMAN' },
      { principalId, principalKind: 'human' },
      { principalId, principalKind: 'AGENT ', principalKindExtra: 'x' },
      { principalId, principalKind: 'HUMAN', actingForRef: { principalId: otherUuid } },
    ]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { principalRef })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
      });
      expect(harness.statements()).toEqual([]);
    }
    // A `principalRef` that claims another kind passes the shape gates but is
    // refused against the owning principal row, and is never reported as a
    // classification result.
    const kindMismatch = new CapabilityBoundaryHarness();
    await expect(
      classify(kindMismatch, { principalRef: { principalId, principalKind: 'AGENT' } }),
    ).rejects.toMatchObject({ code: IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID });
    expect(kindMismatch.principalReads()).toHaveLength(1);
    expect(kindMismatch.auditInserts()).toEqual([]);
  });

  it('refuses a declared kind that disagrees with the owning principal row', async () => {
    // The owning row decides the kind this boundary classifies against, so a
    // caller can neither claim to be HUMAN nor downgrade itself to AGENT.
    const claimedHuman = new CapabilityBoundaryHarness();
    claimedHuman.principalKind = 'AGENT';
    await expect(
      claimedHuman.port.classifyDeclaredCapabilities(
        boundaryRequest({
          principalRef: { principalId, principalKind: 'HUMAN' },
          declaredCapabilityTypes: ['release.authorize'],
        }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID });

    const claimedAgent = new CapabilityBoundaryHarness();
    claimedAgent.principalKind = 'HUMAN';
    await expect(
      claimedAgent.port.classifyDeclaredCapabilities(
        boundaryRequest({ principalRef: { principalId, principalKind: 'AGENT' } }),
      ),
    ).rejects.toMatchObject({ code: IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID });

    // A disagreement is never reported as a classification result.
    expect(claimedHuman.auditInserts()).toEqual([]);
    expect(claimedAgent.auditInserts()).toEqual([]);
  });

  it('fails closed when the authenticated principal does not resolve', async () => {
    const harness = new CapabilityBoundaryHarness();
    harness.principalRowPresent = false;
    await expect(classify(harness)).rejects.toMatchObject({
      code: IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
    });
    expect(harness.auditInserts()).toEqual([]);
  });

  it('refuses a declared Scope that is not the trusted Project Scope', async () => {
    for (const scopeRef of [
      undefined,
      null,
      {},
      { enterpriseId },
      { projectId },
      { enterpriseId: foreignEnterpriseId, projectId },
      { enterpriseId, projectId: foreignProjectId },
      { enterpriseId, projectId, scopeKind: 'PROJECT' },
      { enterpriseId, projectId, extra: undefined },
      { enterpriseId: foreignEnterpriseId, projectId: foreignProjectId },
    ]) {
      const harness = new CapabilityBoundaryHarness();
      await expect(classify(harness, { scopeRef })).rejects.toMatchObject({
        code: IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID,
      });
      expect(harness.statements()).toEqual([]);
    }
    // A trusted context that does not carry exactly one Project has no Project
    // Scope this boundary could classify in, even for its own first Project.
    const multiProject = new CapabilityBoundaryHarness();
    (
      multiProject.context as unknown as { allowedProjectIds: readonly string[] }
    ).allowedProjectIds = [projectId, foreignProjectId];
    await expect(
      classify(multiProject, { scopeRef: { enterpriseId, projectId } }),
    ).rejects.toMatchObject({ code: IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID });
    expect(multiProject.statements()).toEqual([]);
  });
});

describe('the classification audit', () => {
  it('records the returned registry version and outcome for an accepted classification', async () => {
    const harness = new CapabilityBoundaryHarness();
    harness.principalKind = 'AGENT';
    const result = await classify(harness, {
      declaredCapabilityTypes: [...nonHumanOnlyCapabilityCodes],
    });
    const audits = harness.auditInserts();
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    if (audit === undefined) throw new Error('no audit row was written');
    const parameters = [...audit.parameters];
    for (const expected of [
      'ALLOWED',
      'REGULATED_AUDIT',
      'execution.create_work_order',
      commandId,
      correlationId,
      enterpriseId,
      projectId,
      principalId,
      `declared capability classification valid at ${actionAt} (registry ${result.classificationRegistryVersion})`,
    ]) {
      expect(parameters).toContain(expected);
    }
    // Nothing was refused, so the internal classification stays empty.
    expect(parameters).not.toContain('CAPABILITY_HUMAN_ONLY');
  });

  it('records the internal classification of a refusal without returning it', async () => {
    const harness = new CapabilityBoundaryHarness();
    harness.principalKind = 'AGENT';
    const result = await classify(harness, { declaredCapabilityTypes: ['release.authorize'] });
    // The result carries the closed outcome and the registry version only: the
    // internal classification and the owning set never leak through it.
    expect(Object.keys(result).sort()).toEqual(['classificationRegistryVersion', 'outcome']);
    expect(result).toEqual({
      outcome: 'INVALID',
      classificationRegistryVersion: 'im02-static-v1',
    });
    const audits = harness.auditInserts();
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    if (audit === undefined) throw new Error('no audit row was written');
    const parameters = [...audit.parameters];
    for (const expected of [
      'DENIED',
      'CAPABILITY_HUMAN_ONLY',
      'REGULATED_AUDIT',
      'execution.create_work_order',
      `declared capability classification invalid at ${actionAt} (registry ${HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION})`,
    ]) {
      expect(parameters).toContain(expected);
    }
    // The declared payload code itself is not part of the record.
    expect(parameters).not.toContain('release.authorize');
  });

  it('reads the owning principal row and no other owning fact', async () => {
    const harness = new CapabilityBoundaryHarness();
    harness.principalKind = 'AGENT';
    await classify(harness, { declaredCapabilityTypes: ['release.authorize'] });
    // Exactly one owning read and one audit write, and every statement the call
    // executed is one of those, a Decision-free classification boundary never
    // judges Grant coverage, signs a capability or evaluates action-level
    // availability, and it never reads the owning set through a public query.
    expect(harness.principalReads()).toHaveLength(1);
    expect(harness.auditInserts()).toHaveLength(1);
    for (const forbidden of [
      '"identity_policy"."capability_grant"',
      '"identity_policy"."capability_revocation"',
      '"identity_policy"."role_assignment"',
      '"identity_policy"."policy_snapshot"',
      '"identity_policy"."authorization_decision"',
      '"identity_policy"."actor_snapshot"',
      '"identity_policy"."command_receipt"',
      '"identity_policy"."outbox_event"',
      '"enterprise_project".',
      '"task_execution".',
    ]) {
      expect(harness.statements().every((sql) => !sql.includes(forbidden))).toBe(true);
    }
    for (const sql of harness.statements()) {
      expect(
        sql.includes('"identity_policy"."principal"') ||
          sql.includes('"identity_policy"."audit_record"') ||
          sql.includes('SET LOCAL ROLE') ||
          sql.includes('establish_transaction_context'),
      ).toBe(true);
    }
    // The three RLS context statements of the owning transaction, the one
    // owning read and the one audit write — nothing else.
    expect(harness.statements()).toHaveLength(5);
  });
});
