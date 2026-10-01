import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import pg from 'pg';
import { sql } from 'kysely';
import {
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  createTaskExecutionCreationAuthorizationPort,
  createControlledFirstRunAuthorizationPort,
  CONTROLLED_FIRST_RUN_BINDINGS,
  type ControlledFirstRunCapabilityCodes,
  digestCanonicalPayload,
  grantCapability,
  IdentityPolicyRepository,
  IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
  recordPolicySnapshot,
  revokeCapability,
  TASK_EXECUTION_CREATION_BINDINGS,
  withIdentityTransaction,
  type ActorSnapshotRef,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
  type TaskExecutionCreationAuthorizationConfig,
  type TaskExecutionCreationAuthorizationPort,
  type TaskExecutionCreationCapabilityCodes,
} from '@zhiju/identity-policy';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  DATABASE_NAME,
  DATABASE_USERNAME,
  postgresImageReference,
} from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';

// IM-06 (#200) IP-TAUTH-001–008: the IdentityPolicy-owned version-bound
// Task/WorkOrder creation authorization on real PostgreSQL. The matrix is
// defined by Module-Test-001 (IM06-AUTH-01) and the approved `IM06-AUTH-01`
// design (Spec 001 §15, decisions §14). Only the persistence gate provisions
// the pinned PostgreSQL container; a bare `pnpm test` skips this suite instead
// of reporting a false pass.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const containerId = process.env.ZJU_PERSISTENCE_CONTAINER_ID;
const gateEnabled = Boolean(databaseUrl && containerId);

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d001';
const PROJECT_A = '018f22e2-7c15-7b2e-8d86-2de956a9d011';
const PROJECT_B = '018f22e2-7c15-7b2e-8d86-2de956a9d012';
const OPERATOR = '018f22e2-7c15-7b2e-8d86-2de956a9d021';
const OPERATOR_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d031';
const AGENT = '018f22e2-7c15-7b2e-8d86-2de956a9d022';
const AGENT_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d032';
const SECOND_HUMAN = '018f22e2-7c15-7b2e-8d86-2de956a9d023';
const SECOND_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d033';
const AGENT_ACTING_FOR_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d034';
const REQUEST_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d041';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d051';

const AUTH_HASH_OPERATOR = Buffer.alloc(32, 0x51);
const AUTH_HASH_AGENT = Buffer.alloc(32, 0x52);
const AUTH_HASH_SECOND = Buffer.alloc(32, 0x53);
const AUTH_HASH_ACTING_FOR = Buffer.alloc(32, 0x54);
const COMMAND_HASH = Buffer.alloc(32, 0x61);

const UPGRADE_PROBE_PASSWORD = 'wi200-upgrade-probe';

const DEFAULT_CAPABILITIES: TaskExecutionCreationCapabilityCodes = {
  taskV1: 'wi200.cap.task.v1',
  taskV2: 'wi200.cap.task.v2',
  workOrderV1: 'wi200.cap.work_order.v1',
  workOrderV11: 'wi200.cap.work_order.v1_1',
};

const crypto: IdentityCryptoPorts = {
  lookupHash: {
    computeKeyedLookupHash(input: string) {
      return {
        hash: createHmac('sha256', Buffer.alloc(32, 0x9c)).update(input, 'utf8').digest(),
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

function contentHash(value: Buffer) {
  return {
    algorithm: 'SHA-256' as const,
    digest: value.toString('hex'),
    canonicalizationVersion: '1' as const,
  };
}

function targetRef(objectType: string, projectId = PROJECT_A) {
  return {
    kind: 'OBJECT' as const,
    objectType,
    objectId: newUuidV7(),
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

interface DecisionRowView {
  outcome: string;
  command_version: string;
  requested_capability: string;
  purpose: string;
  target_object_type: string | null;
  target_object_id: string | null;
  payload_hash: Buffer;
  canonical_payload: { targetRef?: { objectType?: string; objectId?: string; scope?: unknown } };
}

describe.skipIf(!gateEnabled)('version-bound creation authorization (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;
  let context: IdentityTransactionContext;
  let deps: IdentityCommandDeps;
  let clock: Date;
  let currentPolicy: { id: string; hash: Buffer };
  let operatorActorRef: ActorSnapshotRef;
  let agentActorRef: ActorSnapshotRef;
  let secondActorRef: ActorSnapshotRef;
  let agentActingForRef: ActorSnapshotRef;

  /**
   * The trusted transaction context of one actor: the Port binds issuance and
   * revalidation to exactly this principal and actor snapshot.
   */
  function depsFor(principalId: string, actorSnapshotId: string): IdentityCommandDeps {
    return {
      db,
      repo,
      crypto,
      context: {
        ...context,
        principalId,
        actorSnapshotId,
        authorizationDecisionId: newUuidV7(),
        authorizationDecisionHash: Buffer.alloc(32, 0x72),
      },
    };
  }

  function portFor(
    capabilityCodes: Partial<TaskExecutionCreationCapabilityCodes> = {},
    now?: () => Date,
  ): TaskExecutionCreationAuthorizationPort {
    const config: TaskExecutionCreationAuthorizationConfig = {
      capabilityCodes: { ...DEFAULT_CAPABILITIES, ...capabilityCodes },
      now: now ?? (() => new Date(clock.getTime())),
    };
    return createTaskExecutionCreationAuthorizationPort(config);
  }

  async function phase<T>(
    work: (trx: Parameters<Parameters<typeof withIdentityTransaction<T>>[2]>[0]) => Promise<T>,
  ): Promise<T> {
    return withIdentityTransaction(db, context, work);
  }

  async function createPrincipal(id: string, kind: 'HUMAN' | 'AGENT'): Promise<void> {
    await phase(async (trx) => {
      await repo.insertPrincipal(trx, {
        id,
        principalKind: kind,
        displayName: `IM-06 #200 ${kind} fixture`,
        createdByPrincipalId: OPERATOR,
        createdByActorSnapshotId: OPERATOR_ACTOR,
      });
    });
  }

  async function createPolicySnapshot(effectiveFrom: Date): Promise<{ id: string; hash: Buffer }> {
    const id = newUuidV7();
    const result = await recordPolicySnapshot(deps, {
      policySnapshotId: id,
      policySetVersion: `wi200-policy-set-${id}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom,
      policyDocument: { rules: ['creation-authorization'], version: 1 },
      idempotencyKey: `wi200:policy:${id}`,
    });
    expect(result.status).toBe('COMMITTED');
    const row = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [id],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error('policy snapshot fixture missing');
    return { id, hash: row.payload_hash };
  }

  async function grantCreation(input: {
    principalId: string;
    capabilityCode: string;
    actions: string[];
    selectors: { selectorType: string; objectType: string }[];
    snapshot?: { id: string; hash: Buffer };
    scope?: { enterpriseId: string; projectId: string };
    validFrom?: Date;
    validTo?: Date;
    maxUses?: number;
  }): Promise<string> {
    const grantId = newUuidV7();
    const snapshot = input.snapshot ?? currentPolicy;
    const scope = input.scope ?? { enterpriseId: ENTERPRISE, projectId: PROJECT_A };
    const result = await grantCapability(deps, {
      grantId,
      principalId: input.principalId,
      capabilityCode: input.capabilityCode,
      scope: { scopeKind: 'PROJECT', ...scope },
      resourceSelectors: input.selectors,
      actions: input.actions,
      validFrom: input.validFrom ?? new Date(clock.getTime() - 60 * 60 * 1000),
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
      ...(input.maxUses === undefined ? {} : { maxUses: input.maxUses }),
      grantPolicySnapshotId: snapshot.id,
      grantPolicySnapshotHash: snapshot.hash,
      justification: 'IM-06 #200 creation authorization fixture',
      idempotencyKey: `wi200:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  async function decisionRow(id: string): Promise<DecisionRowView | undefined> {
    return (
      await admin.query<DecisionRowView>(
        `SELECT outcome, command_version, requested_capability, purpose,
                target_object_type, target_object_id, payload_hash, canonical_payload
           FROM identity_policy.authorization_decision
          WHERE authorization_decision_id = $1`,
        [id],
      )
    ).rows.at(0);
  }

  async function decisionCount(): Promise<number> {
    const row = (
      await admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM identity_policy.authorization_decision',
      )
    ).rows.at(0);
    return row?.n ?? -1;
  }

  /**
   * Rewrites one canonical dimension of a committed Decision and syncs the
   * stored payload hash, size and algorithm with the rewritten bytes, exactly
   * like an owner SQL statement that keeps the row self-consistent.
   */
  async function rewriteDecisionPayload(
    decisionId: string,
    mutate: (payload: Record<string, unknown>) => void,
  ): Promise<Buffer> {
    const row = (
      await admin.query<{ canonical_payload: Record<string, unknown> }>(
        'SELECT canonical_payload FROM identity_policy.authorization_decision WHERE authorization_decision_id = $1',
        [decisionId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error('decision fixture missing');
    const payload = structuredClone(row.canonical_payload);
    mutate(payload);
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    await admin.query(
      `UPDATE identity_policy.authorization_decision
          SET canonical_payload = $2::jsonb, payload_hash = $3, payload_size_bytes = $4
        WHERE authorization_decision_id = $1`,
      [decisionId, digest.canonicalJson, digest.hash, digest.sizeBytes],
    );
    return digest.hash;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi200_probe_ip LOGIN PASSWORD 'wi200-probe-ip' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher TO wi200_probe_ip WITH INHERIT FALSE, SET TRUE`,
    );
    await admin.query(`GRANT identity_policy_app TO wi200_probe_ip WITH INHERIT FALSE, SET TRUE`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'wi200_probe_ip';
    url.password = 'wi200-probe-ip';
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
    db = createIdentityPolicyDatabase(pool);
    repo = new IdentityPolicyRepository(crypto);
    context = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: Buffer.alloc(32, 0x71),
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: ENTERPRISE,
      allowedProjectIds: [PROJECT_A, PROJECT_B],
      correlationId: CORRELATION,
    };
    deps = { db, repo, crypto, context };
    clock = new Date();

    await createPrincipal(OPERATOR, 'HUMAN');
    await createPrincipal(AGENT, 'AGENT');
    await createPrincipal(SECOND_HUMAN, 'HUMAN');
    currentPolicy = await createPolicySnapshot(new Date(clock.getTime() - 60 * 60 * 1000));

    operatorActorRef = await createActorSnapshot(deps, {
      actorSnapshotId: OPERATOR_ACTOR,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH_OPERATOR,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
    });
    agentActorRef = await createActorSnapshot(deps, {
      actorSnapshotId: AGENT_ACTOR,
      principalId: AGENT,
      declaredPrincipalKind: 'AGENT',
      authenticationContextHash: AUTH_HASH_AGENT,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
    });
    secondActorRef = await createActorSnapshot(deps, {
      actorSnapshotId: SECOND_ACTOR,
      principalId: SECOND_HUMAN,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH_SECOND,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
    });
    // actingFor is metadata only: the stored snapshot kind stays AGENT.
    agentActingForRef = await createActorSnapshot(deps, {
      actorSnapshotId: AGENT_ACTING_FOR_ACTOR,
      principalId: AGENT,
      declaredPrincipalKind: 'AGENT',
      actingForPrincipalId: OPERATOR,
      actingForKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH_ACTING_FOR,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  async function batchFixture() {
    const binding = CONTROLLED_FIRST_RUN_BINDINGS.find(
      (entry) => entry.boundary === 'queueContractReadV1',
    );
    if (binding === undefined) throw new Error('missing batch binding');
    const objectType = binding.targetObjectTypes[0];
    if (objectType === undefined) throw new Error('missing batch target type');
    const namespace = `ci.batch.c${newUuidV7().replaceAll('-', '')}`;
    const codes = Object.fromEntries(
      CONTROLLED_FIRST_RUN_BINDINGS.map((entry, index) => [
        entry.boundary,
        `${namespace}.c${index}`,
      ]),
    ) as ControlledFirstRunCapabilityCodes;
    const grantId = await grantCreation({
      principalId: OPERATOR,
      capabilityCode: codes[binding.boundary],
      actions: [binding.requiredGrantAction],
      selectors: [{ selectorType: binding.selectorType, objectType: objectType }],
    });
    const port = createControlledFirstRunAuthorizationPort({
      capabilityCodes: codes,
      now: () => new Date(clock.getTime()),
    });
    const entries: Parameters<typeof port.revalidateBatch>[1][number][] = [];
    for (let index = 0; index < 2; index += 1) {
      const target = targetRef(objectType);
      const signed = await port.authorize(deps, binding.boundary, {
        actorSnapshotRef: operatorActorRef,
        commandType: binding.commandType,
        commandVersion: binding.commandVersion,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
        targetRef: target,
      });
      expect(signed.outcome).toBe('ALLOW');
      if (signed.outcome !== 'ALLOW') throw new Error('batch fixture authorization denied');
      entries.push({
        key: binding.boundary,
        input: {
          decisionRef: signed.authorizationDecisionRef,
          expectedCommandType: binding.commandType,
          expectedCommandVersion: binding.commandVersion,
          expectedCommandPayloadHash: COMMAND_HASH,
          expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
          expectedTargetRef: target,
        },
      });
    }
    return { port, entries, grantId };
  }

  it('IP-BATCH observes concurrent revocation between distinct Decisions and stops before the next read', async () => {
    const { port, entries, grantId } = await batchFixture();
    const firstEntry = entries[0];
    if (firstEntry === undefined) throw new Error('missing batch entry');
    const reads: { id: string; isolation: string; transaction_id: string }[] = [];
    let revoked = false;
    class RevokingRepository extends IdentityPolicyRepository {
      override async getAuthorizationDecisionByIdAndHash(
        ...args: Parameters<IdentityPolicyRepository['getAuthorizationDecisionByIdAndHash']>
      ) {
        const metadata = await sql<{
          isolation: string;
          transaction_id: string;
        }>`SELECT current_setting('transaction_isolation') AS isolation, pg_current_xact_id()::text AS transaction_id`.execute(
          args[0],
        );
        const row = metadata.rows[0];
        if (row === undefined) throw new Error('missing transaction metadata');
        reads.push({ id: args[1], ...row });
        return super.getAuthorizationDecisionByIdAndHash(...args);
      }
      override async getPolicySnapshotById(
        ...args: Parameters<IdentityPolicyRepository['getPolicySnapshotById']>
      ) {
        const row = await super.getPolicySnapshotById(...args);
        if (!revoked) {
          revoked = true;
          // A separate pooled connection commits while the batch transaction remains open.
          const result = await revokeCapability(deps, {
            targetId: grantId,
            expectedAggregateVersion: '1',
            scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId: PROJECT_A },
            reasonCode: 'CI_BATCH_CONCURRENT_REVOCATION',
            effectiveAt: new Date(clock.getTime()),
            idempotencyKey: `ci:batch:revoke:${grantId}`,
          });
          expect(result.status).toBe('COMMITTED');
        }
        return row;
      }
    }
    expect(
      await port.revalidateBatch({ ...deps, repo: new RevokingRepository(crypto) }, [
        ...entries,
        firstEntry,
      ]),
    ).toEqual({ valid: false, reason: 'GRANT_NOT_CURRENT', failedIndex: 1 });
    expect(reads.map((read) => read.id)).toEqual(
      entries.map((entry) => entry.input.decisionRef.objectId),
    );
    expect(reads.map((read) => read.isolation)).toEqual(['read committed', 'read committed']);
    expect(new Set(reads.map((read) => read.transaction_id)).size).toBe(1);
    expect(await port.revalidateBatch(deps, entries)).toEqual({
      valid: false,
      reason: 'GRANT_NOT_CURRENT',
      failedIndex: 0,
    });
  });

  it('IP-BATCH starts a fresh transaction at each checkpoint and preserves identity and project isolation', async () => {
    const { port, entries } = await batchFixture();
    const firstEntry = entries[0];
    if (firstEntry === undefined) throw new Error('missing batch entry');
    const transactionIds: string[] = [];
    class ObservingRepository extends IdentityPolicyRepository {
      override async getAuthorizationDecisionByIdAndHash(
        ...args: Parameters<IdentityPolicyRepository['getAuthorizationDecisionByIdAndHash']>
      ) {
        const metadata = await sql<{ id: string }>`SELECT pg_current_xact_id()::text AS id`.execute(
          args[0],
        );
        const row = metadata.rows[0];
        if (row === undefined) throw new Error('missing transaction metadata');
        transactionIds.push(row.id);
        return super.getAuthorizationDecisionByIdAndHash(...args);
      }
    }
    const observed = { ...deps, repo: new ObservingRepository(crypto) };
    expect(await port.revalidateBatch(observed, entries)).toEqual({ valid: true });
    expect(await port.revalidateBatch(observed, [firstEntry])).toEqual({ valid: true });
    expect(transactionIds[0]).toBe(transactionIds[1]);
    expect(transactionIds[2]).not.toBe(transactionIds[0]);
    expect(await port.revalidateBatch(depsFor(SECOND_HUMAN, SECOND_ACTOR), entries)).toMatchObject({
      valid: false,
      failedIndex: 0,
    });
    await expect(
      port.revalidateBatch(
        { ...deps, context: { ...context, allowedProjectIds: [PROJECT_B] } },
        entries,
      ),
    ).rejects.toThrow();
  });

  it('IP-BATCH rolls back database errors and clears the local role before connection reuse', async () => {
    const { port, entries } = await batchFixture();
    class FailingRepository extends IdentityPolicyRepository {
      override async getPolicySnapshotById(
        ...args: Parameters<IdentityPolicyRepository['getPolicySnapshotById']>
      ) {
        await sql`SELECT 1 / 0`.execute(args[0]);
        return super.getPolicySnapshotById(...args);
      }
    }
    await expect(
      port.revalidateBatch({ ...deps, repo: new FailingRepository(crypto) }, entries),
    ).rejects.toMatchObject({ code: '22012' });
    expect(await port.revalidateBatch(deps, entries)).toEqual({ valid: true });
    expect(pool.waitingCount).toBe(0);
    expect(
      (await pool.query<{ current_user: string }>('SELECT current_user')).rows[0]?.current_user,
    ).toBe('wi200_probe_ip');
  });

  it('IP-TAUTH-001 signs one exact ALLOW per approved creation version and keeps the target bound', async () => {
    const port = portFor();
    for (const binding of TASK_EXECUTION_CREATION_BINDINGS) {
      const capabilityCode = DEFAULT_CAPABILITIES[binding.capabilityConfigKey];
      await grantCreation({
        principalId: OPERATOR,
        capabilityCode,
        actions: [binding.requiredGrantAction],
        selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: binding.targetObjectType }],
      });
      const target = targetRef(binding.targetObjectType);
      const view = await port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: binding.commandType,
        commandVersion: binding.commandVersion,
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });
      expect(view, `${binding.commandType}@${binding.commandVersion}`).toMatchObject({
        outcome: 'ALLOW',
        reasons: ['ALLOWED_BY_GRANT'],
      });
      const decisionId = view.authorizationDecisionRef?.objectId;
      expect(decisionId).toBeDefined();
      const row = await decisionRow(decisionId ?? '');
      expect(row).toMatchObject({
        outcome: 'ALLOW',
        command_version: binding.commandVersion,
        requested_capability: capabilityCode,
        purpose: binding.authorizationPurpose,
        target_object_type: binding.targetObjectType,
        target_object_id: target.objectId,
      });
      // The target mirrors and the integrity-hashed payload are one fact.
      expect(row?.canonical_payload.targetRef).toEqual({
        kind: 'OBJECT',
        objectType: binding.targetObjectType,
        objectId: target.objectId,
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      });
      expect(view.policySnapshotRef?.snapshotId).toBe(currentPolicy.id);
    }
  });

  it('IP-TAUTH-001 fails closed on aliases, case variants, unknown versions and unusable configuration', async () => {
    const port = portFor();
    const request = {
      actorSnapshotRef: operatorActorRef,
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash: AUTH_HASH_OPERATOR,
      targetRef: targetRef('zhiju.execution.task'),
    };
    for (const version of ['2', '2.0.0', '2.0 ', ' 2.0', 'latest', '*', '', '3.0']) {
      await expect(
        port.authorizeCreation(deps, {
          ...request,
          commandType: 'execution.create_task',
          commandVersion: version,
        }),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
    }
    for (const type of [
      'execution.task.create',
      'execution.work_order.create',
      'Execution.create_task',
      'execution.create_task ',
    ]) {
      await expect(
        port.authorizeCreation(deps, { ...request, commandType: type, commandVersion: '2.0' }),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
    }
    // Version isolation: the WorkOrder pair shares one Purpose but never one
    // version key, and each version owns its own configured capability code.
    await expect(
      port.authorizeCreation(deps, {
        ...request,
        commandType: 'execution.create_work_order',
        commandVersion: '1',
        targetRef: targetRef('execution.work_order'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED });
    for (const [commandType, commandVersion, capabilityCodes] of [
      ['execution.create_task', '1.0', { taskV1: undefined }],
      ['execution.create_task', '2.0', { taskV2: '' }],
      ['execution.create_task', '2.0', { taskV2: '   ' }],
      ['execution.create_task', '2.0', { taskV2: 'Task.V2' }],
      ['execution.create_task', '2.0', { taskV2: 'wi200 cap' }],
      ['execution.create_work_order', '1.0', { workOrderV1: 'wi200.cap.' }],
      ['execution.create_work_order', '1.1', { workOrderV11: 'wi200.cap.work_order.v1_1.' }],
    ] as const) {
      await expect(
        portFor(capabilityCodes as Partial<TaskExecutionCreationCapabilityCodes>).authorizeCreation(
          deps,
          { ...request, commandType, commandVersion },
        ),
      ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
    }
    await expect(
      createTaskExecutionCreationAuthorizationPort({
        capabilityCodes: {} as TaskExecutionCreationCapabilityCodes,
      }).authorizeCreation(deps, {
        ...request,
        commandType: 'execution.create_work_order',
        commandVersion: '1.1',
        targetRef: targetRef('zhiju.execution.work_order'),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID });
  });

  it('IP-TAUTH-002 covers only the versions whose exact action the single Grant lists', async () => {
    const capabilityCode = 'wi200.sel.shared.action';
    const port = portFor({ workOrderV1: capabilityCode, workOrderV11: capabilityCode });
    const v1Target = targetRef('execution.work_order');
    const v11Target = targetRef('zhiju.execution.work_order');
    const issue = (version: string, target: ReturnType<typeof targetRef>) =>
      port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_work_order',
        commandVersion: version,
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });

    const firstGrantId = await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.work_order.create.v1'],
      selectors: [
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.work_order' },
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
      ],
    });
    expect(await issue('1.0', v1Target)).toMatchObject({ outcome: 'ALLOW' });
    expect(await issue('1.1', v11Target)).toMatchObject({
      outcome: 'DENY',
      reasons: ['NO_ACTIVE_GRANT'],
    });

    const revoked = await revokeCapability(deps, {
      targetId: firstGrantId,
      expectedAggregateVersion: '1',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      reasonCode: 'WI200_FIXTURE_ROTATION',
      effectiveAt: new Date(clock.getTime()),
      idempotencyKey: `wi200:revoke:${firstGrantId}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.work_order.create.v1', 'execution.work_order.create.v1_1'],
      selectors: [
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.work_order' },
        { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.work_order' },
      ],
    });
    const both = await issue('1.0', v1Target);
    expect(both).toMatchObject({ outcome: 'ALLOW' });
    expect(await issue('1.1', v11Target)).toMatchObject({ outcome: 'ALLOW' });
    // Same Purpose, two versions, two decisions: neither inherits the other.
    const v1Row = await decisionRow(both.authorizationDecisionRef?.objectId ?? '');
    expect(v1Row?.purpose).toBe('task.execution.create_work_order');
    expect(v1Row?.command_version).toBe('1.0');
  });

  it('IP-TAUTH-003 rejects every selector shape outside the closed CREATE_TARGET_TYPE set', async () => {
    const objectType = 'zhiju.execution.task';
    const action = 'execution.task.create.v2';
    const attempt = async (
      name: string,
      selectors: { selectorType: string; objectType: string }[],
    ) => {
      const capabilityCode = `wi200.sel.${name.replaceAll('-', '_')}`;
      await grantCreation({
        principalId: OPERATOR,
        capabilityCode,
        actions: [action],
        selectors,
      });
      const view = await portFor({ taskV2: capabilityCode }).authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: targetRef(objectType),
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });
      return view;
    };

    expect(
      await attempt('exact', [{ selectorType: 'CREATE_TARGET_TYPE', objectType }]),
    ).toMatchObject({ outcome: 'ALLOW' });
    const negatives = {
      'unknown-field': [{ selectorType: 'CREATE_TARGET_TYPE', objectType, extra: true }],
      wildcard: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: '*' }],
      prefix: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution' }],
      suffix: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task.v2' }],
      alias: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'Task' }],
      'case-variant': [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'ZHIJU.EXECUTION.TASK' }],
      'legacy-namespace': [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'execution.task' }],
      'wrong-selector-type': [{ selectorType: 'OBJECT_TYPE', objectType }],
      'missing-selector-type': [{ objectType }],
      'non-string': [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 7 }],
    } as unknown as Record<string, { selectorType: string; objectType: string }[]>;
    for (const [name, selectors] of Object.entries(negatives)) {
      expect(await attempt(name, selectors), name).toMatchObject({
        outcome: 'DENY',
        reasons: ['NO_ACTIVE_GRANT'],
      });
    }
  });

  it('IP-TAUTH-003 rejects Grants with uninterpreted constraints or maxUses instead of ignoring them', async () => {
    const objectType = 'zhiju.execution.task';
    const capabilityCode = 'wi200.sel.unimplemented';
    const grantId = await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType }],
      maxUses: 5,
    });
    const port = portFor({ taskV2: capabilityCode });
    expect(
      await port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: targetRef(objectType),
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      }),
    ).toMatchObject({ outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] });

    await admin.query(
      `UPDATE identity_policy.capability_grant SET max_uses = NULL, constraints = '{"notImplemented":true}'::jsonb WHERE id = $1`,
      [grantId],
    );
    expect(
      await port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: targetRef(objectType),
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      }),
    ).toMatchObject({ outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] });

    await admin.query(
      `UPDATE identity_policy.capability_grant SET constraints = '{}'::jsonb WHERE id = $1`,
      [grantId],
    );
    expect(
      await port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: targetRef(objectType),
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      }),
    ).toMatchObject({ outcome: 'ALLOW' });

    const audit = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity_policy.audit_record
        WHERE command_type = 'execution.create_task' AND outcome = 'DENIED'
          AND error_code = 'NO_ACTIVE_GRANT'`,
    );
    expect(audit.rows.at(0)?.n).toBeGreaterThanOrEqual(2);
  });

  it('IP-TAUTH-004 rejects target and version substitution while the original request stays valid', async () => {
    const capabilityCode = 'wi200.target.binding';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const port = portFor({ taskV2: capabilityCode });
    const actor = operatorActorRef;
    const target = targetRef('zhiju.execution.task');
    const issued = await port.authorizeCreation(deps, {
      actorSnapshotRef: actor,
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      targetRef: target,
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash: AUTH_HASH_OPERATOR,
    });
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');

    const revalidate = (expectedTargetRef: ReturnType<typeof targetRef>, decision = decisionRef) =>
      port.revalidateCreation(deps, {
        decisionRef: decision,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef,
      });

    expect(await revalidate(target)).toMatchObject({ valid: true });
    expect(await revalidate(targetRef('zhiju.execution.task'))).toMatchObject({
      valid: false,
      reason: 'TARGET_MISMATCH',
    });
    expect(
      await revalidate({ ...target, scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_B } }),
    ).toMatchObject({ valid: false, reason: 'SCOPE_MISMATCH' });
    expect(await revalidate({ ...target, objectId: newUuidV7() })).toMatchObject({
      valid: false,
      reason: 'TARGET_MISMATCH',
    });
    // Cross-version replay: the same payload hash on the Task v1 key is never
    // covered by a v2 decision.
    const v1Port = portFor({ taskV1: capabilityCode });
    expect(
      await v1Port.revalidateCreation(deps, {
        decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '1.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef: { ...target, objectType: 'execution.task' },
      }),
    ).toMatchObject({ valid: false });
  });

  it('IP-TAUTH-005 requires the exact current Policy Snapshot of the covering Grant', async () => {
    const notYetEffective = await createPolicySnapshot(new Date(clock.getTime() + 60 * 60 * 1000));
    const superseded = await createPolicySnapshot(new Date(clock.getTime() - 2 * 60 * 60 * 1000));
    await admin.query(
      `UPDATE identity_policy.policy_snapshot SET superseded_at = $2 WHERE policy_snapshot_id = $1`,
      [superseded.id, new Date(clock.getTime() - 60 * 60 * 1000)],
    );

    for (const [name, snapshot] of [
      ['wi200.policy.not_yet_effective', notYetEffective],
      ['wi200.policy.superseded', superseded],
    ] as const) {
      const capabilityCode = name;
      await grantCreation({
        principalId: OPERATOR,
        capabilityCode,
        actions: ['execution.task.create.v2'],
        selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
        snapshot,
      });
      expect(
        await portFor({ taskV2: capabilityCode }).authorizeCreation(deps, {
          actorSnapshotRef: operatorActorRef,
          commandType: 'execution.create_task',
          commandVersion: '2.0',
          targetRef: targetRef('zhiju.execution.task'),
          commandPayloadHash: COMMAND_HASH,
          authenticationContextHash: AUTH_HASH_OPERATOR,
        }),
        name,
      ).toMatchObject({ outcome: 'DENY', reasons: ['GRANT_POLICY_SNAPSHOT_NOT_CURRENT'] });
    }

    // A replaced Grant bound to another Policy Snapshot no longer covers a
    // Decision issued under the former one.
    const capabilityCode = 'wi200.policy.replacement';
    const originalGrant = await grantCreation({
      principalId: SECOND_HUMAN,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const port = portFor({ taskV2: capabilityCode });
    const secondDeps = depsFor(SECOND_HUMAN, SECOND_ACTOR);
    const target = targetRef('zhiju.execution.task');
    const issued = await port.authorizeCreation(secondDeps, {
      actorSnapshotRef: secondActorRef,
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      targetRef: target,
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash: AUTH_HASH_SECOND,
    });
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');
    expect(
      await port.revalidateCreation(secondDeps, {
        decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_SECOND,
        expectedTargetRef: target,
      }),
    ).toMatchObject({ valid: true });
    const rotated = await revokeCapability(deps, {
      targetId: originalGrant,
      expectedAggregateVersion: '1',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      reasonCode: 'WI200_FIXTURE_ROTATION',
      effectiveAt: new Date(clock.getTime()),
      idempotencyKey: `wi200:revoke:${originalGrant}`,
    });
    expect(rotated.status).toBe('COMMITTED');
    await grantCreation({
      principalId: SECOND_HUMAN,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
      snapshot: notYetEffective,
    });
    expect(
      await port.revalidateCreation(secondDeps, {
        decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_SECOND,
        expectedTargetRef: target,
      }),
    ).toMatchObject({ valid: false, reason: 'POLICY_NOT_CURRENT' });
  });

  it('IP-TAUTH-006 denies revoked, expired and reconfigured eligibility without rewriting history', async () => {
    const capabilityCode = 'wi200.replay.revocation';
    const grantId = await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
      validTo: new Date(clock.getTime() + 100 * 1000),
    });
    const port = portFor({ taskV2: capabilityCode });
    const actor = operatorActorRef;
    const target = targetRef('zhiju.execution.task');
    const issue = () =>
      port.authorizeCreation(deps, {
        actorSnapshotRef: actor,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });
    const issued = await issue();
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');
    const before = await decisionRow(decisionRef.objectId);
    const decisionsBefore = await decisionCount();

    const revalidate = (from: TaskExecutionCreationAuthorizationPort = port) =>
      from.revalidateCreation(deps, {
        decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef: target,
      });
    expect(await revalidate()).toMatchObject({ valid: true });

    // Grant expiry: the Decision is still inside its own TTL, yet the Grant
    // window no longer contains the trusted current time.
    clock = new Date(clock.getTime() + 150 * 1000);
    expect(await revalidate()).toMatchObject({ valid: false, reason: 'GRANT_NOT_CURRENT' });
    expect(await issue()).toMatchObject({ outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] });

    // Decision expiry is evaluated before any current qualification.
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    expect(await revalidate()).toMatchObject({ valid: false, reason: 'EXPIRED' });

    // Revocation wins over a previously issued ALLOW: the historical Decision
    // stays readable, no new Decision is created, and the replay is refused.
    clock = new Date(clock.getTime());
    const revoked = await revokeCapability(deps, {
      targetId: grantId,
      expectedAggregateVersion: '1',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      reasonCode: 'WI200_FIXTURE_REVOKE',
      effectiveAt: new Date(clock.getTime()),
      idempotencyKey: `wi200:revoke:${grantId}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    const after = await decisionRow(decisionRef.objectId);
    expect(after?.payload_hash.equals(before?.payload_hash ?? Buffer.alloc(0))).toBe(true);
    expect(after?.target_object_id).toBe(before?.target_object_id);
    expect(await decisionCount()).toBe(decisionsBefore);
    expect(await revalidate()).toMatchObject({ valid: false, reason: 'EXPIRED' });

    // A trusted configuration change is not silently tolerated either.
    const reconfigured = portFor({ taskV2: 'wi200.replay.other_capability' });
    expect(await revalidate(reconfigured)).toMatchObject({ valid: false });
  });

  it('IP-TAUTH-006 fails closed when the IdentityPolicy dependency is unavailable', async () => {
    const brokenPool = new pg.Pool({
      connectionString: 'postgres://nobody:nobody@127.0.0.1:1/unreachable',
      connectionTimeoutMillis: 500,
      max: 1,
    });
    const brokenDeps: IdentityCommandDeps = {
      db: createIdentityPolicyDatabase(brokenPool),
      repo,
      crypto,
      context,
    };
    const port = portFor({ taskV2: 'wi200.replay.unavailable' });
    const target = targetRef('zhiju.execution.task');
    await expect(
      port.authorizeCreation(brokenDeps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      }),
    ).rejects.toThrow();
    await expect(
      port.revalidateCreation(brokenDeps, {
        decisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'identity.authorization_decision',
          objectId: newUuidV7(),
          scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
          contentHash: contentHash(Buffer.alloc(32, 0x0a)),
        },
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef: target,
      }),
    ).rejects.toThrow();
    await brokenPool.end();
  });

  it('IP-TAUTH-007 keeps the real PrincipalKind and the Human-only registry authoritative', async () => {
    const agentCapability = 'wi200.kind.agent';
    await grantCreation({
      principalId: AGENT,
      capabilityCode: agentCapability,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const target = targetRef('zhiju.execution.task');
    const agentDeps = depsFor(AGENT, AGENT_ACTOR);
    const actingForDeps = depsFor(AGENT, AGENT_ACTING_FOR_ACTOR);
    // A full covering Grant authorizes an AGENT for a non Human-only capability
    // inside the agent's own trusted transaction context.
    expect(
      await portFor({ taskV2: agentCapability }).authorizeCreation(agentDeps, {
        actorSnapshotRef: agentActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_AGENT,
      }),
    ).toMatchObject({ outcome: 'ALLOW' });
    // Without its own Grant there is no coverage, and actingFor never upgrades.
    expect(
      await portFor({ taskV2: 'wi200.kind.no_grant' }).authorizeCreation(agentDeps, {
        actorSnapshotRef: agentActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_AGENT,
      }),
    ).toMatchObject({ outcome: 'DENY', reasons: ['NO_ACTIVE_GRANT'] });
    expect(
      await portFor({ taskV2: agentCapability }).authorizeCreation(actingForDeps, {
        actorSnapshotRef: agentActingForRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_ACTING_FOR,
      }),
      'actingFor must not upgrade the agent principal to HUMAN',
    ).toMatchObject({ outcome: 'ALLOW' });
    // A Human-only capability stays Human-only even if a legacy row granted it
    // to an Agent: the owning grant handler refuses this shape, so the fixture
    // is inserted directly to prove the Port does not trust the row alone.
    const humanOnlyCapability = 'identity.human_only.probe';
    await admin.query(
      `INSERT INTO identity_policy.capability_grant (
         id, principal_id, capability_code, scope_kind, enterprise_id, project_id,
         resource_selectors, actions, justification, grant_policy_snapshot_id,
         grant_policy_snapshot_hash, valid_from, created_by_principal_id,
         created_by_actor_snapshot_id)
       VALUES ($1, $2, $3, 'PROJECT', $4, $5, $6::jsonb, ARRAY['execution.task.create.v2'],
         'IM-06 #200 legacy Human-only grant fixture', $7, $8, $9, $2, $10)`,
      [
        newUuidV7(),
        AGENT,
        humanOnlyCapability,
        ENTERPRISE,
        PROJECT_A,
        JSON.stringify([
          { selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' },
        ]),
        currentPolicy.id,
        currentPolicy.hash,
        new Date(clock.getTime() - 60 * 60 * 1000),
        AGENT_ACTOR,
      ],
    );
    expect(
      await portFor({ taskV2: humanOnlyCapability }).authorizeCreation(actingForDeps, {
        actorSnapshotRef: agentActingForRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_ACTING_FOR,
      }),
    ).toMatchObject({ outcome: 'DENY', reasons: ['CAPABILITY_HUMAN_ONLY'] });
  });

  it('IP-TAUTH-007 refuses the actor snapshot of another principal in the trusted context', async () => {
    const capabilityCode = 'wi200.actor.binding';
    const port = portFor({ taskV2: capabilityCode });
    for (const principal of [SECOND_HUMAN, AGENT]) {
      await grantCreation({
        principalId: principal,
        capabilityCode,
        actions: ['execution.task.create.v2'],
        selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
      });
    }
    const target = targetRef('zhiju.execution.task');
    const request = (
      actor: ActorSnapshotRef,
      authenticationContextHash: Buffer,
    ): Parameters<typeof port.authorizeCreation>[1] => ({
      actorSnapshotRef: actor,
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      targetRef: target,
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash,
    });
    // The operator context may not issue for another Human, for an Agent, or
    // for an Agent actingFor Human: the snapshot must be the trusted actor.
    await expect(
      port.authorizeCreation(deps, request(secondActorRef, AUTH_HASH_SECOND)),
    ).rejects.toThrow(/trusted transaction actor|trusted transaction principal/);
    await expect(
      port.authorizeCreation(deps, request(agentActorRef, AUTH_HASH_AGENT)),
    ).rejects.toThrow(/trusted transaction actor|trusted transaction principal/);
    await expect(
      port.authorizeCreation(deps, request(agentActingForRef, AUTH_HASH_ACTING_FOR)),
    ).rejects.toThrow(/trusted transaction actor|trusted transaction principal/);
    // A same-Project principal cannot replay the other principal's context:
    // the decision of one actor is never valid in another actor's context.
    const secondDeps = depsFor(SECOND_HUMAN, SECOND_ACTOR);
    const issued = await port.authorizeCreation(
      secondDeps,
      request(secondActorRef, AUTH_HASH_SECOND),
    );
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');
    const revalidation = {
      decisionRef,
      expectedCommandType: 'execution.create_task',
      expectedCommandVersion: '2.0',
      expectedCommandPayloadHash: COMMAND_HASH,
      expectedAuthenticationContextHash: AUTH_HASH_SECOND,
      expectedTargetRef: target,
    };
    expect(await port.revalidateCreation(secondDeps, revalidation)).toMatchObject({ valid: true });
    expect(await port.revalidateCreation(deps, revalidation)).toMatchObject({
      valid: false,
      reason: 'ACTOR_MISMATCH',
    });
  });

  it('IP-TAUTH-008 refuses a decision whose target was moved together with its payload', async () => {
    const capabilityCode = 'wi200.integrity.decision';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const port = portFor({ taskV2: capabilityCode });
    const target = targetRef('zhiju.execution.task');
    const issued = await port.authorizeCreation(deps, {
      actorSnapshotRef: operatorActorRef,
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      targetRef: target,
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash: AUTH_HASH_OPERATOR,
    });
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');
    const revalidate = (expectedTargetRef: ReturnType<typeof targetRef>) =>
      port.revalidateCreation(deps, {
        decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef,
      });
    // Untampered control: the decision covers exactly the target it bound.
    expect(await revalidate(target)).toMatchObject({ valid: true });

    // Owner-level coordinated tamper: the promoted target column *and* the
    // canonical payload move to a new object id while the stored hash, size and
    // algorithm stay untouched, so the guard and the ref hash still match.
    const movedTargetId = newUuidV7();
    await admin.query(
      `UPDATE identity_policy.authorization_decision
          SET target_object_id = $2::text::uuid,
              canonical_payload = jsonb_set(canonical_payload, '{targetRef,objectId}', to_jsonb($2::text))
        WHERE authorization_decision_id = $1`,
      [decisionRef.objectId, movedTargetId],
    );
    const tampered = await decisionRow(decisionRef.objectId);
    expect(tampered?.target_object_id).toBe(movedTargetId);
    expect(tampered?.payload_hash.equals(Buffer.from(decisionRef.contentHash.digest, 'hex'))).toBe(
      true,
    );
    // The old decision ref cannot be repointed: the canonical bytes no longer
    // hash to the stored hash, for the new target and for the old one.
    expect(await revalidate({ ...target, objectId: movedTargetId })).toMatchObject({
      valid: false,
      reason: 'DECISION_INTEGRITY_MISMATCH',
    });
    expect(await revalidate(target)).toMatchObject({
      valid: false,
      reason: 'DECISION_INTEGRITY_MISMATCH',
    });
  });

  it('IP-TAUTH-008 refuses a Grant whose Policy Snapshot document was rewritten', async () => {
    const snapshot = await createPolicySnapshot(new Date(clock.getTime() - 60 * 60 * 1000));
    const capabilityCode = 'wi200.integrity.policy';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
      snapshot,
    });
    const port = portFor({ taskV2: capabilityCode });
    const target = targetRef('zhiju.execution.task');
    const issue = () =>
      port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });
    const issued = await issue();
    expect(issued.outcome).toBe('ALLOW');
    const decisionRef = issued.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('expected an issued decision');
    const revalidation = {
      decisionRef,
      expectedCommandType: 'execution.create_task',
      expectedCommandVersion: '2.0',
      expectedCommandPayloadHash: COMMAND_HASH,
      expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
      expectedTargetRef: target,
    };
    expect(await port.revalidateCreation(deps, revalidation)).toMatchObject({ valid: true });

    // The Snapshot mirror guard does not cover `policyDocument`: rewriting the
    // document while keeping the stored hash must not authorize anything.
    await admin.query(
      `UPDATE identity_policy.policy_snapshot
          SET canonical_payload = jsonb_set(canonical_payload, '{policyDocument}',
                '{"rules":["tampered"],"version":2}'::jsonb)
        WHERE policy_snapshot_id = $1`,
      [snapshot.id],
    );
    expect(await issue()).toMatchObject({
      outcome: 'DENY',
      reasons: ['GRANT_POLICY_SNAPSHOT_INVALID'],
    });
    expect(await port.revalidateCreation(deps, revalidation)).toMatchObject({
      valid: false,
      reason: 'POLICY_INTEGRITY_MISMATCH',
    });
  });

  it('IP-TAUTH-008 refuses a decision whose canonical identity diverges from its row', async () => {
    const capabilityCode = 'wi200.integrity.identity';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const port = portFor({ taskV2: capabilityCode });
    const issue = async (): Promise<{
      decisionRef: Common.ContentAddressedRef;
      targetRef: ReturnType<typeof targetRef>;
    }> => {
      const target = targetRef('zhiju.execution.task');
      const view = await port.authorizeCreation(deps, {
        actorSnapshotRef: operatorActorRef,
        commandType: 'execution.create_task',
        commandVersion: '2.0',
        targetRef: target,
        commandPayloadHash: COMMAND_HASH,
        authenticationContextHash: AUTH_HASH_OPERATOR,
      });
      const decisionRef = view.authorizationDecisionRef;
      if (decisionRef === undefined) throw new Error('expected an issued decision');
      return { decisionRef, targetRef: target };
    };
    const revalidate = (issued: {
      decisionRef: Common.ContentAddressedRef;
      targetRef: Common.ObjectRef;
    }) =>
      port.revalidateCreation(deps, {
        decisionRef: issued.decisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef: issued.targetRef,
      });

    // Untampered control.
    expect(await revalidate(await issue())).toMatchObject({ valid: true });

    // Owner-level rewrite of one canonical dimension with the stored hash, size
    // and algorithm recomputed and synced: the row is self-consistent, so only
    // the promoted-mirror comparison can catch it.
    const identity = await issue();
    const identityHash = await rewriteDecisionPayload(identity.decisionRef.objectId, (payload) => {
      payload.authorizationDecisionId = newUuidV7();
    });
    expect(
      await revalidate({
        decisionRef: { ...identity.decisionRef, contentHash: contentHash(identityHash) },
        targetRef: identity.targetRef,
      }),
    ).toMatchObject({ valid: false, reason: 'DECISION_INTEGRITY_MISMATCH' });

    const reasons = await issue();
    const reasonsHash = await rewriteDecisionPayload(reasons.decisionRef.objectId, (payload) => {
      payload.reasonCodes = ['TAMPERED'];
    });
    expect(
      await revalidate({
        decisionRef: { ...reasons.decisionRef, contentHash: contentHash(reasonsHash) },
        targetRef: reasons.targetRef,
      }),
    ).toMatchObject({ valid: false, reason: 'DECISION_INTEGRITY_MISMATCH' });

    const kind = await issue();
    const kindHash = await rewriteDecisionPayload(kind.decisionRef.objectId, (payload) => {
      (payload.targetRef as { kind: string }).kind = 'SNAPSHOT';
    });
    expect(
      await revalidate({
        decisionRef: { ...kind.decisionRef, contentHash: contentHash(kindHash) },
        targetRef: kind.targetRef,
      }),
    ).toMatchObject({ valid: false, reason: 'DECISION_INTEGRITY_MISMATCH' });

    // The rewritten rows really carry their own canonical hash, which is why
    // the stored metadata cannot be the integrity proof.
    const stored = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.authorization_decision WHERE authorization_decision_id = $1',
        [identity.decisionRef.objectId],
      )
    ).rows.at(0);
    expect(stored?.payload_hash.equals(identityHash)).toBe(true);
  });

  it('IP-TAUTH-008 keeps historical decisions readable but unusable for the four versions', async () => {
    const capabilityCode = 'wi200.history.read';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['wi200.history.action'],
      selectors: [],
    });
    const generic = await authorizeCommand(deps, {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: 'identity.record_policy_snapshot',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT_A,
        purpose: 'identity.policy.record_policy_snapshot',
        requestedCapability: capabilityCode,
        commandPayloadHash: COMMAND_HASH,
        requestedAt: new Date(clock.getTime()),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH_OPERATOR,
      policySnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'identity.policy_snapshot',
        objectId: currentPolicy.id,
        snapshotId: currentPolicy.id,
        scope: {},
        contentHash: contentHash(currentPolicy.hash),
      },
    });
    expect(generic.outcome).toBe('ALLOW');
    const historical = await decisionRow(generic.authorizationDecisionRef.objectId);
    expect(historical?.target_object_type).toBeNull();
    expect(historical?.target_object_id).toBeNull();

    const found = await phase((trx) =>
      repo.getAuthorizationDecisionByIdAndHash(
        trx,
        generic.authorizationDecisionRef.objectId,
        generic.authorizationDecisionRef.contentHash.digest
          ? Buffer.from(generic.authorizationDecisionRef.contentHash.digest, 'hex')
          : Buffer.alloc(0),
      ),
    );
    expect(found?.hashMatched).toBe(true);
    expect(
      await portFor().revalidateCreation(deps, {
        decisionRef: generic.authorizationDecisionRef,
        expectedCommandType: 'execution.create_task',
        expectedCommandVersion: '2.0',
        expectedCommandPayloadHash: COMMAND_HASH,
        expectedAuthenticationContextHash: AUTH_HASH_OPERATOR,
        expectedTargetRef: targetRef('zhiju.execution.task'),
      }),
    ).toMatchObject({ valid: false, reason: 'TARGET_UNBOUND' });
  });

  it('IP-TAUTH-008 enforces the target/payload/Scope mirrors against direct SQL', async () => {
    const capabilityCode = 'wi200.tamper.binding';
    await grantCreation({
      principalId: OPERATOR,
      capabilityCode,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: 'zhiju.execution.task' }],
    });
    const issued = await portFor({ taskV2: capabilityCode }).authorizeCreation(deps, {
      actorSnapshotRef: operatorActorRef,
      commandType: 'execution.create_task',
      commandVersion: '2.0',
      targetRef: targetRef('zhiju.execution.task'),
      commandPayloadHash: COMMAND_HASH,
      authenticationContextHash: AUTH_HASH_OPERATOR,
    });
    const decisionId = issued.authorizationDecisionRef?.objectId;
    if (decisionId === undefined) throw new Error('expected an issued decision');

    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision SET target_object_id = $2 WHERE authorization_decision_id = $1`,
        [decisionId, newUuidV7()],
      ),
    ).rejects.toThrow(/targetRef/);
    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision SET target_object_type = 'zhiju.execution.work_order' WHERE authorization_decision_id = $1`,
        [decisionId],
      ),
    ).rejects.toThrow(/targetRef/);
    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision
            SET canonical_payload = jsonb_set(canonical_payload, '{targetRef,objectId}', to_jsonb($2::text))
          WHERE authorization_decision_id = $1`,
        [decisionId, newUuidV7()],
      ),
    ).rejects.toThrow(/targetRef/);
    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision
            SET canonical_payload = jsonb_set(canonical_payload, '{targetRef,scope,projectId}', to_jsonb($2::text))
          WHERE authorization_decision_id = $1`,
        [decisionId, PROJECT_B],
      ),
    ).rejects.toThrow(/targetRef/);
    await expect(
      admin.query(
        `UPDATE identity_policy.authorization_decision SET target_object_id = NULL WHERE authorization_decision_id = $1`,
        [decisionId],
      ),
    ).rejects.toThrow(/targetRef/);

    const row = await decisionRow(decisionId);
    expect(row?.target_object_id).not.toBeNull();
  });

  it('IP-TAUTH-008 applies the additive migration and rolls its DDL back atomically', async () => {
    const applied = await admin.query<{ version: string; success: boolean }>(
      `SELECT version, success FROM public.flyway_schema_history WHERE version = '1006'`,
    );
    expect(applied.rows).toEqual([{ version: '1006', success: true }]);
    const shape = await admin.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'identity_policy' AND table_name = 'authorization_decision'
          AND column_name IN ('target_object_type', 'target_object_id')
        ORDER BY column_name`,
    );
    expect(shape.rows).toEqual([
      { column_name: 'target_object_id', is_nullable: 'YES' },
      { column_name: 'target_object_type', is_nullable: 'YES' },
    ]);
    const constraint = await admin.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'identity_policy.authorization_decision'::regclass
          AND conname = 'authorization_decision_target_pair'`,
    );
    expect(constraint.rows).toHaveLength(1);

    await admin.query('BEGIN');
    try {
      await admin.query(
        `ALTER TABLE identity_policy.authorization_decision
           DROP COLUMN target_object_type, DROP COLUMN target_object_id`,
      );
      const dropped = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = 'identity_policy' AND table_name = 'authorization_decision'
            AND column_name IN ('target_object_type', 'target_object_id')`,
      );
      expect(dropped.rows.at(0)?.n).toBe(0);
    } finally {
      await admin.query('ROLLBACK');
    }
    const restored = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'identity_policy' AND table_name = 'authorization_decision'
          AND column_name IN ('target_object_type', 'target_object_id')`,
    );
    expect(restored.rows.at(0)?.n).toBe(2);
  });

  it(
    'IP-TAUTH-008 upgrades an empty database that already holds historical decision rows',
    { timeout: 300_000 },
    async () => {
      const upgrade = await startUpgradeContainer();
      const upgradeAdmin = new pg.Client({ connectionString: upgrade.connectionString });
      let upgradePool: pg.Pool | undefined;
      try {
        await upgradeAdmin.connect();
        const migrate = (target?: string) =>
          runFlyway(upgrade.containerId, {
            command: 'migrate',
            database: DATABASE_NAME,
            username: DATABASE_USERNAME,
            password: upgrade.password,
            ...(target === undefined ? {} : { target }),
          });
        await migrate('1005');
        await upgradeAdmin.query(
          `CREATE ROLE wi200_upgrade_probe LOGIN PASSWORD '${UPGRADE_PROBE_PASSWORD}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
        await upgradeAdmin.query(
          `GRANT platform_context_establisher TO wi200_upgrade_probe WITH INHERIT FALSE, SET TRUE`,
        );
        await upgradeAdmin.query(
          `GRANT identity_policy_app TO wi200_upgrade_probe WITH INHERIT FALSE, SET TRUE`,
        );
        upgradePool = new pg.Pool({ connectionString: upgrade.probeConnectionString, max: 2 });
        const principalId = newUuidV7();
        const actorId = newUuidV7();
        const actorHash = Buffer.alloc(32, 0x81);
        // The upgraded database holds the trusted context of its own fixture
        // actor: the Port binds issuance and revalidation to it.
        const upgradeContext: IdentityTransactionContext = {
          ...context,
          principalId,
          actorSnapshotId: actorId,
          authorizationDecisionId: newUuidV7(),
          authorizationDecisionHash: Buffer.alloc(32, 0x73),
        };
        const upgradeDeps: IdentityCommandDeps = {
          db: createIdentityPolicyDatabase(upgradePool),
          repo,
          crypto,
          context: upgradeContext,
        };
        await withIdentityTransaction(upgradeDeps.db, upgradeContext, async (trx) => {
          await repo.insertPrincipal(trx, {
            id: principalId,
            principalKind: 'HUMAN',
            displayName: 'IM-06 #200 upgrade fixture',
            createdByPrincipalId: principalId,
            createdByActorSnapshotId: actorId,
          });
        });
        const snapshot = await createUpgradePolicySnapshot(upgradeDeps, upgradeAdmin);
        await createActorSnapshot(upgradeDeps, {
          actorSnapshotId: actorId,
          principalId,
          declaredPrincipalKind: 'HUMAN',
          authenticationContextHash: actorHash,
          scopeKind: 'PROJECT',
          enterpriseId: ENTERPRISE,
          projectId: PROJECT_A,
        });
        const historical = await insertHistoricalDecision(upgradeAdmin, {
          actorId,
          principalId,
          actorAuthenticationContextHash: actorHash,
          policySnapshot: snapshot,
        });

        await migrate();
        const upgraded = await upgradeAdmin.query<{
          target_object_type: string | null;
          target_object_id: string | null;
          payload_hash: Buffer;
        }>(
          `SELECT target_object_type, target_object_id, payload_hash
           FROM identity_policy.authorization_decision WHERE authorization_decision_id = $1`,
          [historical.decisionId],
        );
        expect(upgraded.rows.at(0)?.target_object_type).toBeNull();
        expect(upgraded.rows.at(0)?.target_object_id).toBeNull();
        expect(upgraded.rows.at(0)?.payload_hash.equals(historical.payloadHash)).toBe(true);
        const readBack = await withIdentityTransaction(upgradeDeps.db, upgradeContext, (trx) =>
          repo.getAuthorizationDecisionByIdAndHash(
            trx,
            historical.decisionId,
            historical.payloadHash,
          ),
        );
        expect(readBack?.hashMatched).toBe(true);
        expect(
          await createTaskExecutionCreationAuthorizationPort({
            capabilityCodes: DEFAULT_CAPABILITIES,
            now: () => new Date(),
          }).revalidateCreation(upgradeDeps, {
            decisionRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'identity.authorization_decision',
              objectId: historical.decisionId,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
              contentHash: contentHash(historical.payloadHash),
            },
            expectedCommandType: 'execution.create_task',
            expectedCommandVersion: '2.0',
            expectedCommandPayloadHash: historical.commandPayloadHash,
            expectedAuthenticationContextHash: actorHash,
            expectedTargetRef: targetRef('zhiju.execution.task'),
          }),
        ).toMatchObject({ valid: false, reason: 'TARGET_UNBOUND' });
      } finally {
        if (upgradePool !== undefined) await upgradePool.end();
        await upgradeAdmin.end();
        await upgrade.container.stop({ remove: true, timeout: 10_000 });
      }
    },
  );
});

/**
 * A dedicated pinned container for the migration-upgrade scenario. The gate
 * helper is not reused because it re-resolves the image tag against the
 * registry, and this scenario stays offline: the gate already pulled and
 * verified this exact pinned reference. The bootstrap migration creates
 * cluster-wide roles, so a second database inside the gate cluster cannot be
 * migrated up independently.
 */
async function startUpgradeContainer(): Promise<{
  container: StartedPostgreSqlContainer;
  containerId: string;
  connectionString: string;
  probeConnectionString: string;
  password: string;
}> {
  const container = await new PostgreSqlContainer(postgresImageReference())
    .withDatabase(DATABASE_NAME)
    .withUsername(DATABASE_USERNAME)
    .withPassword('zhiju-gate-test')
    .withStartupTimeout(120_000)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return {
    container,
    containerId: container.getId(),
    connectionString: `postgres://${DATABASE_USERNAME}:zhiju-gate-test@${host}:${port}/${DATABASE_NAME}`,
    probeConnectionString: `postgres://wi200_upgrade_probe:${UPGRADE_PROBE_PASSWORD}@${host}:${port}/${DATABASE_NAME}`,
    password: 'zhiju-gate-test',
  };
}

/** Policy snapshot fixture created against the pre-migration database. */
async function createUpgradePolicySnapshot(
  deps: IdentityCommandDeps,
  adminClient: pg.Client,
): Promise<{ id: string; hash: Buffer }> {
  const id = newUuidV7();
  const result = await recordPolicySnapshot(deps, {
    policySnapshotId: id,
    policySetVersion: `wi200-upgrade-policy-set-${id}`,
    policySchemaRefs: ['identity.PolicySnapshot@1.0'],
    effectiveFrom: new Date(Date.now() - 60 * 60 * 1000),
    policyDocument: { rules: ['creation-authorization'], version: 1 },
    idempotencyKey: `wi200:upgrade:policy:${id}`,
  });
  if (result.status !== 'COMMITTED') throw new Error('upgrade policy fixture failed');
  const row = (
    await adminClient.query<{ payload_hash: Buffer }>(
      'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
      [id],
    )
  ).rows.at(0);
  if (row === undefined) throw new Error('upgrade policy fixture missing');
  return { id, hash: row.payload_hash };
}

/**
 * One AuthorizationDecision row in the historical shape: the pre-#200 columns
 * only, and a canonical payload without a target binding. The row is built
 * exactly like the generic Decision Port built it before the migration.
 */
async function insertHistoricalDecision(
  adminClient: pg.Client,
  input: {
    actorId: string;
    principalId: string;
    actorAuthenticationContextHash: Buffer;
    policySnapshot: { id: string; hash: Buffer };
  },
): Promise<{ decisionId: string; payloadHash: Buffer; commandPayloadHash: Buffer }> {
  const actorRow = (
    await adminClient.query<{ payload_hash: Buffer }>(
      'SELECT payload_hash FROM identity_policy.actor_snapshot WHERE actor_snapshot_id = $1',
      [input.actorId],
    )
  ).rows.at(0);
  if (actorRow === undefined) throw new Error('actor snapshot fixture missing');
  const decisionId = newUuidV7();
  const commandPayloadHash = Buffer.alloc(32, 0x82);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const payload = {
    authorizationDecisionId: decisionId,
    actorSnapshotId: input.actorId,
    actorSnapshotPayloadHash: actorRow.payload_hash.toString('hex'),
    principalId: input.principalId,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: 'execution.create_task',
    commandVersion: '2.0',
    scopeKind: 'PROJECT',
    enterpriseId: ENTERPRISE,
    projectId: PROJECT_A,
    purpose: 'execution.task.create',
    requestedCapability: 'wi200.upgrade.capability',
    commandPayloadHash: commandPayloadHash.toString('hex'),
    policySnapshotId: input.policySnapshot.id,
    policySnapshotPayloadHash: input.policySnapshot.hash.toString('hex'),
    authenticationContextHash: input.actorAuthenticationContextHash.toString('hex'),
    expiresAt: expiresAt.toISOString(),
  };
  const digest = digestCanonicalPayload(payload);
  await adminClient.query(
    `INSERT INTO identity_policy.authorization_decision (
       authorization_decision_id, actor_snapshot_id, actor_snapshot_payload_hash,
       principal_id, principal_kind, outcome, reason_codes, command_type, command_version,
       scope_kind, enterprise_id, project_id, purpose, requested_capability,
       command_payload_hash, policy_snapshot_id, policy_snapshot_payload_hash,
       authentication_context_hash, expires_at, contract_type, contract_version,
       canonicalization_version, payload_hash_algorithm, payload_hash, payload_size_bytes,
       canonical_payload, created_by_principal_id, source_command_id, retention_class)
     VALUES ($1, $2, $3, $4, 'HUMAN', 'ALLOW', ARRAY['ALLOWED_BY_GRANT'],
       'execution.create_task', '2.0', 'PROJECT', $5, $6, 'execution.task.create',
       'wi200.upgrade.capability', $7, $8, $9, $10, $11, 'identity.AuthorizationDecision',
       '1.0', $12, $13, $14, $15, $16, $4, $17, 'REGULATED_AUDIT')`,
    [
      decisionId,
      input.actorId,
      actorRow.payload_hash,
      input.principalId,
      ENTERPRISE,
      PROJECT_A,
      commandPayloadHash,
      input.policySnapshot.id,
      input.policySnapshot.hash,
      input.actorAuthenticationContextHash,
      expiresAt,
      digest.canonicalizationVersion,
      digest.hashAlgorithm,
      digest.hash,
      digest.sizeBytes,
      digest.canonicalJson,
      newUuidV7(),
    ],
  );
  return { decisionId, payloadHash: digest.hash, commandPayloadHash };
}
