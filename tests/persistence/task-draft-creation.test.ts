// IM-06 (#204): real PostgreSQL acceptance for version-bound Task DRAFT
// creation (`TE-P202-001`–`TE-P202-015`, Module-Test-003).
//
// Positive and negative paths enter through the composition entry in
// `@zhiju/api/composition` — the same boundary a transport uses: the complete
// registered Envelope is validated for its exact version, the presented
// AuthorizationDecision is revalidated through the IdentityPolicy-owned
// creation Port *before* any TaskExecution idempotency claim, the owning
// TaskExecution handler runs the creation in one owning transaction, and the
// EnterpriseProject-owned Project scope Port proves the Project/DeliveryItem
// facts after the claim and before the first business write. Decisions,
// ActorSnapshots, capability grants and Policy snapshots come from the owning
// IdentityPolicy commands; nothing under test is stubbed.
//
// The `delivery_item` row is a committed EnterpriseProject fact seeded with the
// same convention `tests/persistence/delivery-plan.test.ts` uses for its deep
// DeliveryPlan prerequisites, because the owning delivery-plan chain is not
// part of this slice. Every Task fact under test is produced by the owning
// `execution.create_task` entry.
//
// Boundary: the approved predicate `commitment_status NOT IN
// ('CANCELLED','REPLACED')` cannot be exercised here. The current
// EnterpriseProject schema pins `commitment_status = 'PROPOSED'` at insert and
// rejects every later UPDATE of the row, so no committed fact can be
// CANCELLED/REPLACED yet; that branch stays `NOT RUN` in Module-Test-003.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import { createCreateTaskEntry, type CreateTaskEntry } from '@zhiju/api/composition';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  createTaskExecutionCreationAuthorizationPort,
  grantCapability,
  IDENTITY_CREATION_TARGET_INVALID,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  revokeCapability,
  withIdentityTransaction,
  type ActorSnapshotRef,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
  type TaskExecutionCreationCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  handleValidateObjectScope,
  PROJECT_OBJECT_SCOPE_MISMATCH,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  COMMAND_IN_PROGRESS,
  createTaskExecutionDatabase,
  DEPENDENCY_UNAVAILABLE,
  EXECUTION_DEFINITION_REF_INVALID,
  EXECUTION_DELIVERY_ITEM_REF_INVALID,
  EXECUTION_PARENT_TASK_REF_INVALID,
  EXECUTION_PROJECT_REF_INVALID,
  EXECUTION_TASK_ALREADY_EXISTS,
  executeTaskExecutionCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  TASK_DRAFT_CREATION_BINDINGS,
  digestCanonicalPayload,
  handleCreateTask,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi204_probe';
const PROBE_PASSWORD = 'im06-wi204-probe';

const OPERATOR = 'aa01aa01-aa01-7a01-8a01-aa01aa01aa01';
const OPERATOR_ACTOR = 'aa02aa02-aa02-7a02-8a02-aa02aa02aa02';
const OTHER_PRINCIPAL = 'aa03aa03-aa03-7a03-8a03-aa03aa03aa03';
const OTHER_ACTOR = 'aa04aa04-aa04-7a04-8a04-aa04aa04aa04';
const REQUEST_DECISION = 'aa05aa05-aa05-7a05-8a05-aa05aa05aa05';
const CORRELATION = 'aa06aa06-aa06-7a06-8a06-aa06aa06aa06';

const AUTH_HASH = Buffer.alloc(32, 0x81);
const OTHER_AUTH_HASH = Buffer.alloc(32, 0x82);
const DECISION_HASH = Buffer.alloc(32, 0x83);

const CAPABILITY_V1 = 'wi204.cap.task.v1';
const CAPABILITY_V2 = 'wi204.cap.task.v2';
const ACTION_V1 = 'execution.task.create.v1';
const ACTION_V2 = 'execution.task.create.v2';
const TASK_OBJECT_V1 = 'execution.task';
const TASK_OBJECT_V2 = 'zhiju.execution.task';

const V1_FIXTURE = new URL(
  '../fixtures/contracts/execution-create-task-command-valid.json',
  import.meta.url,
);
const V2_FIXTURE = new URL(
  '../fixtures/contracts/task-v2/create-task-v2-command-valid.json',
  import.meta.url,
);
const V1_BASELINE_FIXTURE = new URL(
  '../fixtures/contracts/compatibility/v1.0/positive/execution-create-task-command.json',
  import.meta.url,
);
const PUBLIC_API_CATALOG = new URL('../../contracts/registry/public-api.v1.json', import.meta.url);

const capabilityCodes: TaskExecutionCreationCapabilityCodes = {
  taskV1: CAPABILITY_V1,
  taskV2: CAPABILITY_V2,
  workOrderV1: 'wi204.cap.work_order.v1',
  workOrderV11: 'wi204.cap.work_order.v1_1',
};

interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly ghostProjectId: string;
  readonly planVersionId: string;
  readonly itemAId: string;
  readonly itemBId: string;
}

interface CreationEnvelope {
  commandId: string;
  commandType: string;
  commandVersion: string;
  scopeRef: { enterpriseId: string; projectId: string };
  targetRef: {
    kind: string;
    objectType: string;
    objectId: string;
    scope: { enterpriseId: string; projectId: string };
  };
  actor: Record<string, unknown>;
  authorizationDecisionRef: Common.ContentAddressedRef;
  idempotencyKey: string;
  correlationId: string;
  requestedAt: string;
  payload: Record<string, unknown>;
  integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7d)).update(input, 'utf8').digest(),
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

function payloadOf(url: URL): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { payload: Record<string, unknown> };
  return structuredClone(fixture.payload);
}

/**
 * Rewrites every `scope` inside a published fixture payload onto the fixture
 * Project. The fixtures carry one Project/Enterprise pair everywhere, so this
 * keeps every accepted shape (Platform `{}`, Enterprise and Project forms)
 * exactly as published while moving the fixture to this suite's ids.
 */
function rewriteFixtureScopes(value: unknown, fixture: Fixture): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteFixtureScopes(item, fixture);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'scope' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      node[key] =
        'projectId' in (child as Record<string, unknown>)
          ? { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId }
          : { enterpriseId: fixture.enterpriseId };
      continue;
    }
    rewriteFixtureScopes(child, fixture);
  }
}

function definitionOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.definition as Record<string, unknown>;
}

function objectRef(objectType: string, objectId: string, scope: Record<string, string>) {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

describe.skipIf(!gateEnabled)('Task DRAFT creation (real PostgreSQL)', () => {
  const crypto = testCrypto();
  const registry = new ContractRegistry();
  let admin: pg.Client;
  let tePool: pg.Pool;
  let epPool: pg.Pool;
  let ipPool: pg.Pool;
  let teDb: Kysely<TaskExecutionDb>;
  let epDb: Kysely<EnterpriseProjectDb>;
  let identityDb: Kysely<IdentityPolicyDb>;
  let identityRepo: IdentityPolicyRepository;
  let fixture: Fixture;
  let entry: CreateTaskEntry;
  let operatorActorRef: ActorSnapshotRef;
  let otherActorRef: ActorSnapshotRef;
  let ghostActorRef: ActorSnapshotRef;
  let otherProjectActorRef: ActorSnapshotRef;
  let grantV1: string;
  let policySnapshotId: string;
  let policySnapshotHash: Buffer;
  let clock: number;

  function identityContext(
    allowedProjectIds: readonly string[],
    principalId = OPERATOR,
    actorSnapshotId = OPERATOR_ACTOR,
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId,
      actorSnapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
    };
  }

  function identityDeps(
    allowedProjectIds: readonly string[],
    principalId = OPERATOR,
    actorSnapshotId = OPERATOR_ACTOR,
  ): IdentityCommandDeps {
    return {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: identityContext(allowedProjectIds, principalId, actorSnapshotId),
    };
  }

  function entryFor(overrides: { code?: string; now?: () => Date } = {}): CreateTaskEntry {
    return createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb: epDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes:
        overrides.code === undefined
          ? capabilityCodes
          : { ...capabilityCodes, taskV1: overrides.code },
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  async function grantCreation(input: {
    principalId?: string;
    capabilityCode: string;
    action: string;
    targetObjectType: string;
    projectId: string;
  }): Promise<string> {
    const grantId = newUuidV7();
    const result = await grantCapability(identityDeps([input.projectId], input.principalId), {
      grantId,
      principalId: input.principalId ?? OPERATOR,
      capabilityCode: input.capabilityCode,
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: input.projectId,
      },
      resourceSelectors: [
        { selectorType: 'CREATE_TARGET_TYPE', objectType: input.targetObjectType },
      ],
      actions: [input.action],
      validFrom: new Date(clock - 60 * 60 * 1000),
      grantPolicySnapshotId: policySnapshotId,
      grantPolicySnapshotHash: policySnapshotHash,
      justification: 'IM-06 #204 creation fixture',
      idempotencyKey: `wi204:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  /** Issues one real creation Decision through the owning IdentityPolicy Port. */
  async function issueCreationDecision(input: {
    commandVersion: string;
    targetId: string;
    payloadHash: Buffer;
    actorSnapshotRef: ActorSnapshotRef;
    authHash: Buffer;
    projectId: string;
    principalId?: string | undefined;
    actorSnapshotId?: string | undefined;
  }): Promise<Common.ContentAddressedRef> {
    const binding = TASK_DRAFT_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === input.commandVersion,
    );
    if (binding === undefined) throw new Error(`unsupported version ${input.commandVersion}`);
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await port.authorizeCreation(
      identityDeps(
        [input.projectId],
        input.principalId ?? OPERATOR,
        input.actorSnapshotId ?? input.actorSnapshotRef.snapshotId,
      ),
      {
        actorSnapshotRef: input.actorSnapshotRef,
        commandType: 'execution.create_task',
        commandVersion: input.commandVersion,
        targetRef: objectRef(binding.taskObjectType, input.targetId, {
          enterpriseId: fixture.enterpriseId,
          projectId: input.projectId,
        }) as unknown as Common.ObjectRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: input.authHash,
      },
    );
    expect(view.outcome, `creation authorization for ${input.commandVersion}`).toBe('ALLOW');
    const decisionRef = view.authorizationDecisionRef;
    if (decisionRef === undefined) throw new Error('creation Decision was not issued');
    return decisionRef;
  }

  function fixturePayload(commandVersion: string, fixtureSource: Fixture): Record<string, unknown> {
    const payload = payloadOf(commandVersion === '1.0' ? V1_FIXTURE : V2_FIXTURE);
    rewriteFixtureScopes(payload, fixtureSource);
    // The Project ref identity is data, not a scope: it must equal its own
    // scope and the trusted Project, exactly as the owning Port proves it.
    (payload.projectRef as Record<string, unknown>).objectId = fixtureSource.projectId;
    const deliveryItemRef = definitionOf(payload).deliveryItemRef;
    if (deliveryItemRef !== undefined) {
      const ref = deliveryItemRef as Record<string, unknown>;
      ref.objectId = fixtureSource.itemAId;
      ref.versionId = fixtureSource.planVersionId;
    }
    return payload;
  }

  function creationEnvelope(input: {
    readonly commandVersion: string;
    readonly payload: Record<string, unknown>;
    readonly targetId: string;
    readonly idempotencyKey: string;
    readonly decisionRef: Common.ContentAddressedRef;
    readonly projectId?: string | undefined;
    readonly actorRef?: ActorSnapshotRef | undefined;
  }): CreationEnvelope {
    const objectType = input.commandVersion === '1.0' ? TASK_OBJECT_V1 : TASK_OBJECT_V2;
    const scope = {
      enterpriseId: fixture.enterpriseId,
      projectId: input.projectId ?? fixture.projectId,
    };
    const digest = digestCanonicalPayload(input.payload as CanonicalJsonObject);
    return {
      commandId: newUuidV7(),
      commandType: 'execution.create_task',
      commandVersion: input.commandVersion,
      scopeRef: scope,
      targetRef: { kind: 'OBJECT', objectType, objectId: input.targetId, scope },
      actor: {
        kind: 'SNAPSHOT',
        objectType: 'identity.actor_snapshot',
        objectId: (input.actorRef ?? operatorActorRef).snapshotId,
        snapshotId: (input.actorRef ?? operatorActorRef).snapshotId,
        scope,
        contentHash: (input.actorRef ?? operatorActorRef).contentHash,
      },
      authorizationDecisionRef: input.decisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload: input.payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHash(digest.hash.toString('hex')),
      },
    };
  }

  /**
   * Issues the Decision for this exact payload and returns the ready Envelope:
   * the single legitimate baseline every single-variable negative case starts
   * from.
   */
  async function preparedEnvelope(input: {
    commandVersion: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    targetId?: string;
    projectId?: string;
    actorSnapshotRef?: ActorSnapshotRef;
    authHash?: Buffer;
    principalId?: string;
    actorSnapshotId?: string;
  }): Promise<CreationEnvelope> {
    const targetId = input.targetId ?? newUuidV7();
    const projectId = input.projectId ?? fixture.projectId;
    const digest = digestCanonicalPayload(input.payload as CanonicalJsonObject);
    const decisionRef = await issueCreationDecision({
      commandVersion: input.commandVersion,
      targetId,
      payloadHash: digest.hash,
      actorSnapshotRef: input.actorSnapshotRef ?? operatorActorRef,
      authHash: input.authHash ?? AUTH_HASH,
      projectId,
      principalId: input.principalId,
      actorSnapshotId: input.actorSnapshotId,
    });
    return creationEnvelope({
      commandVersion: input.commandVersion,
      payload: input.payload,
      targetId,
      idempotencyKey: input.idempotencyKey,
      decisionRef,
      projectId,
      actorRef: input.actorSnapshotRef,
    });
  }

  function createThroughEntry(
    envelope: unknown,
    targetEntry: CreateTaskEntry = entry,
    authHash: Buffer = AUTH_HASH,
  ): Promise<CommandResult> {
    return targetEntry.create(envelope, { authenticationContextHash: authHash });
  }

  /** The trusted TaskExecution transaction context of the fixture operator. */
  function runnerContext(): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      policySnapshotId,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
  }

  /**
   * Drives the owning TaskExecution handler directly: this is the module-level
   * acceptance set that the registered Schema cannot express. The Project scope
   * Port is deliberately unreachable, so a case that must be refused by the
   * handler's own ref rules cannot silently depend on EnterpriseProject.
   */
  function createThroughHandler(
    commandVersion: string,
    payload: Record<string, unknown>,
  ): Promise<CommandResult> {
    return handleCreateTask(
      teDb,
      runnerContext(),
      {
        commandId: newUuidV7(),
        commandType: 'execution.create_task',
        commandVersion,
        idempotencyScope: `wi204:handler:${commandVersion}`,
        idempotencyKey: `wi204-handler-${newUuidV7()}`,
        requestPayload: payload as CanonicalJsonObject,
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        targetType: commandVersion === '1.0' ? TASK_OBJECT_V1 : TASK_OBJECT_V2,
        targetId: newUuidV7(),
        correlationId: CORRELATION,
        principalId: OPERATOR,
        principalKind: 'HUMAN',
        actorSnapshotId: OPERATOR_ACTOR,
        authorizationDecisionId: REQUEST_DECISION,
        policySnapshotId,
      } satisfies CommandEnvelope,
      {
        projectScope: {
          proveCreationScope: (): Promise<'VALID'> => Promise.resolve('VALID'),
        },
      },
    );
  }

  async function taskRow(taskId: string) {
    return (
      await admin.query<{
        status: string;
        aggregate_version: string;
        enterprise_id: string;
        project_id: string;
        current_definition_snapshot_id: string;
        current_definition_hash: Buffer;
        delivery_item_id: string | null;
        delivery_item_version_id: string | null;
      }>(
        `SELECT status, aggregate_version::text, enterprise_id, project_id,
                current_definition_snapshot_id, current_definition_hash,
                delivery_item_id, delivery_item_version_id
           FROM task_execution.task WHERE task_id = $1`,
        [taskId],
      )
    ).rows.at(0);
  }

  async function snapshotRows(taskId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        schema_version: string;
        canonical_payload: Record<string, unknown>;
        payload_hash: Buffer;
        delivery_item_id: string | null;
        delivery_item_version_id: string | null;
        source_command_id: string;
      }>(
        `SELECT snapshot_id, schema_version, canonical_payload, payload_hash,
                delivery_item_id, delivery_item_version_id, source_command_id
           FROM task_execution.task_definition_snapshot
          WHERE task_id = $1 ORDER BY created_at`,
        [taskId],
      )
    ).rows;
  }

  async function receiptRows(idempotencyKey: string) {
    return (
      await admin.query<{
        command_type: string;
        command_version: string;
        outcome: string;
        result_payload: Record<string, unknown> | null;
      }>(
        `SELECT command_type, command_version, outcome, result_payload
           FROM task_execution.command_receipt WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
    ).rows;
  }

  /** The first committed Task of this suite, used as a parent/dependency fact. */
  async function firstCommittedTaskId(): Promise<string> {
    const row = (
      await admin.query<{ task_id: string }>(
        `SELECT task_id FROM task_execution.task
          WHERE project_id = $1
          ORDER BY created_at, task_id LIMIT 1`,
        [fixture.projectId],
      )
    ).rows.at(0);
    if (row === undefined) throw new Error('no committed Task fixture exists');
    return row.task_id;
  }

  async function edgePaths(ownerId: string): Promise<string[]> {
    return (
      await admin.query<{ reference_path: string }>(
        `SELECT reference_path FROM task_execution.reference_edge
          WHERE owner_object_id = $1 ORDER BY reference_path`,
        [ownerId],
      )
    ).rows.map((row) => row.reference_path);
  }

  async function countRows(table: string): Promise<number> {
    const row = (
      await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    ).rows.at(0);
    return row?.n ?? -1;
  }

  function appRoleContext(
    client: pg.PoolClient,
    allowedProjectIds: readonly string[],
  ): Promise<pg.QueryResult> {
    return client.query(
      `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        OPERATOR,
        OPERATOR_ACTOR,
        REQUEST_DECISION,
        DECISION_HASH,
        new Date(clock + 60 * 60 * 1000),
        fixture.enterpriseId,
        [...allowedProjectIds],
        CORRELATION,
      ],
    );
  }

  /** Runs one statement as the owning application role under a trusted context. */
  async function asAppRole<T>(
    pool: pg.Pool,
    role: string,
    allowedProjectIds: readonly string[],
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await appRoleContext(client, allowedProjectIds);
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async function seedProjectFixture(seed: pg.Client): Promise<Fixture> {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const otherProjectId = newUuidV7();
    const ghostProjectId = newUuidV7();
    const gapAnalysisId = newUuidV7();
    const gapVersionId = newUuidV7();
    const gapInputSnapshotId = newUuidV7();
    const deliveryPlanId = newUuidV7();
    const planVersionId = newUuidV7();
    const itemAId = newUuidV7();
    const itemBId = newUuidV7();
    const hash = Buffer.alloc(32, 0xc9);
    const memberPolicyVersionId = newUuidV7();
    const projectPolicyRef = {
      kind: 'VERSIONED',
      objectType: 'Policy',
      objectId: newUuidV7(),
      versionId: memberPolicyVersionId,
    };
    const snapshotRef = (objectType: string, objectId: string) =>
      JSON.stringify({
        kind: 'SNAPSHOT',
        objectType,
        objectId,
        snapshotId: objectId,
        scope: { enterpriseId },
      });
    const versionedRef = (objectType: string, objectId: string, versionId: string) =>
      JSON.stringify({
        kind: 'VERSIONED',
        objectType,
        objectId,
        versionId,
        scope: { enterpriseId, projectId },
      });

    await seed.query('BEGIN');
    try {
      for (const [id, code] of [
        [projectId, 'WI204-MAIN'],
        [otherProjectId, 'WI204-OTHER'],
      ] as const) {
        await seed.query(
          `INSERT INTO enterprise_project.project
             (project_id, enterprise_id, display_code, title, objective, status,
              member_policy_ref, member_policy_version_id, member_policy_payload_hash,
              created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            id,
            enterpriseId,
            code,
            `WI-204 ${code}`,
            'Version-bound Task DRAFT creation fixture.',
            JSON.stringify(projectPolicyRef),
            memberPolicyVersionId,
            hash,
            OPERATOR,
            OPERATOR_ACTOR,
            newUuidV7(),
          ],
        );
      }
      await seed.query(
        `INSERT INTO enterprise_project.gap_analysis
           (gap_analysis_id, enterprise_id, project_id, current_version_id,
            accepted_version_id, status, created_by_principal_id,
            created_by_actor_snapshot_id, last_command_id)
         VALUES ($1, $2, $3, $4, $4, 'ACCEPTED', $5, $6, $7)`,
        [
          gapAnalysisId,
          enterpriseId,
          projectId,
          gapVersionId,
          OPERATOR,
          OPERATOR_ACTOR,
          newUuidV7(),
        ],
      );
      await seed.query(
        `INSERT INTO enterprise_project.gap_analysis_input_snapshot
           (input_snapshot_id, gap_analysis_id, version_id, enterprise_id, project_id,
            customer_baseline_ref, customer_baseline_id, customer_baseline_version_id,
            template_baseline_ref, template_baseline_id, template_baseline_version_id,
            regulatory_profile_ref, regulatory_profile_id, regulatory_profile_version_id,
            enterprise_profile_snapshot_ref, enterprise_profile_snapshot_id,
            enterprise_profile_payload_hash, qms_configuration_ref,
            qms_configuration_id, qms_configuration_revision_id,
            qms_configuration_revision_hash, product_scope_snapshot_ref,
            product_scope_snapshot_id, product_scope_payload_hash, analysis_policy_ref,
            analysis_policy_id, analysis_policy_version_id, payload, payload_hash,
            recorded_by_principal_id, recorded_by_actor_snapshot_id,
            authorization_decision_id, source_command_id)
         VALUES ($1, $2, $3, $4, $5,
            $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14,
            $15::jsonb, $16, $17, $18::jsonb, $19, $20, $21,
            $22::jsonb, $23, $24, $25::jsonb, $26, $27,
            '{"fixture":"wi204"}'::jsonb, $28, $29, $30, $31, $32)`,
        [
          gapInputSnapshotId,
          gapAnalysisId,
          gapVersionId,
          enterpriseId,
          projectId,
          versionedRef('CustomerBaseline', newUuidV7(), newUuidV7()),
          newUuidV7(),
          newUuidV7(),
          versionedRef('TemplateBaseline', newUuidV7(), newUuidV7()),
          newUuidV7(),
          newUuidV7(),
          versionedRef('RegulatoryProfile', newUuidV7(), newUuidV7()),
          newUuidV7(),
          newUuidV7(),
          snapshotRef('EnterpriseProfileSnapshot', newUuidV7()),
          newUuidV7(),
          hash,
          JSON.stringify({
            kind: 'VERSIONED',
            objectType: 'QMSConfiguration',
            objectId: newUuidV7(),
            versionId: newUuidV7(),
            scope: { enterpriseId },
          }),
          newUuidV7(),
          newUuidV7(),
          hash,
          snapshotRef('ProductScopeSnapshot', newUuidV7()),
          newUuidV7(),
          hash,
          versionedRef('Policy', newUuidV7(), newUuidV7()),
          newUuidV7(),
          newUuidV7(),
          hash,
          OPERATOR,
          OPERATOR_ACTOR,
          REQUEST_DECISION,
          newUuidV7(),
        ],
      );
      await seed.query(
        `INSERT INTO enterprise_project.gap_analysis_version
           (version_id, gap_analysis_id, enterprise_id, project_id, version_no,
            version_status, mode, input_snapshot_id, requested_scope,
            findings_summary, payload, payload_hash, created_by_principal_id,
            created_by_actor_snapshot_id, authorization_decision_id, source_command_id)
         VALUES ($1, $2, $3, $4, 1, 'ACCEPTED', 'FORMAL', $5,
            '{"fixture":"wi204"}'::jsonb, '{"findingCount":1}'::jsonb,
            '{"fixture":"wi204"}'::jsonb, $6, $7, $8, $9, $10)`,
        [
          gapVersionId,
          gapAnalysisId,
          enterpriseId,
          projectId,
          gapInputSnapshotId,
          hash,
          OPERATOR,
          OPERATOR_ACTOR,
          REQUEST_DECISION,
          newUuidV7(),
        ],
      );
      await seed.query(
        `INSERT INTO enterprise_project.delivery_plan
           (delivery_plan_id, enterprise_id, project_id, current_version_id,
            approved_version_id, active_version_id, status, created_by_principal_id,
            created_by_actor_snapshot_id, last_command_id)
         VALUES ($1, $2, $3, $4, NULL, NULL, 'DRAFT', $5, $6, $7)`,
        [
          deliveryPlanId,
          enterpriseId,
          projectId,
          planVersionId,
          OPERATOR,
          OPERATOR_ACTOR,
          newUuidV7(),
        ],
      );
      await seed.query(
        `INSERT INTO enterprise_project.delivery_plan_version
           (version_id, delivery_plan_id, enterprise_id, project_id, version_no,
            version_status, accepted_gap_analysis_ref, accepted_gap_analysis_id,
            accepted_gap_analysis_version_id, baseline_refs, assumptions, exclusions,
            plan_quality_policy_ref, plan_quality_policy_id, plan_quality_policy_version_id,
            payload, payload_hash, created_by_principal_id, created_by_actor_snapshot_id,
            authorization_decision_id, source_command_id)
         VALUES ($1, $2, $3, $4, 1, 'DRAFT', $5::jsonb, $6, $7, '[]'::jsonb,
            '["fixture"]'::jsonb, '["fixture"]'::jsonb, $8::jsonb, $9, $10,
            $11::jsonb, $12, $13, $14, $15, $16)`,
        [
          planVersionId,
          deliveryPlanId,
          enterpriseId,
          projectId,
          versionedRef('GapAnalysis', gapAnalysisId, gapVersionId),
          gapAnalysisId,
          gapVersionId,
          versionedRef('Policy', newUuidV7(), newUuidV7()),
          newUuidV7(),
          newUuidV7(),
          JSON.stringify({ enterpriseId, projectId, fixture: 'wi204' }),
          hash,
          OPERATOR,
          OPERATOR_ACTOR,
          REQUEST_DECISION,
          newUuidV7(),
        ],
      );
      for (const [itemId, itemKey] of [
        [itemAId, 'item-a'],
        [itemBId, 'item-b'],
      ] as const) {
        await seed.query(
          `INSERT INTO enterprise_project.delivery_item
             (delivery_item_id, delivery_plan_id, version_id, enterprise_id, project_id,
              item_key, item_type, title, objective, source_gap_item_refs,
              dependency_item_ids, target_artifact_types, quality_profile_ref,
              quality_profile_id, quality_profile_version_id, completion_criteria,
              due_constraint, commitment_status, execution_status, criteria_hash,
              payload, payload_hash, recorded_by_principal_id,
              recorded_by_actor_snapshot_id, authorization_decision_id, source_command_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'control.implementation', $7, $8,
              $9::jsonb, '[]'::jsonb, '["delivery.document"]'::jsonb, $10::jsonb,
              $11, $12, '{"required":true}'::jsonb, NULL, 'PROPOSED', 'NOT_READY',
              $13, $14::jsonb, $13, $15, $16, $17, $18)`,
          [
            itemId,
            deliveryPlanId,
            planVersionId,
            enterpriseId,
            projectId,
            itemKey,
            `WI-204 delivery item ${itemKey}`,
            `Deliver ${itemKey} for the WI-204 fixture.`,
            JSON.stringify([versionedRef('GapItem', newUuidV7(), gapVersionId)]),
            versionedRef('QualityProfile', newUuidV7(), newUuidV7()),
            newUuidV7(),
            newUuidV7(),
            hash,
            JSON.stringify({ enterpriseId, projectId, itemKey }),
            OPERATOR,
            OPERATOR_ACTOR,
            REQUEST_DECISION,
            newUuidV7(),
          ],
        );
      }
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    }
    return {
      enterpriseId,
      projectId,
      otherProjectId,
      ghostProjectId,
      planVersionId,
      itemAId,
      itemBId,
    };
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
           CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
             NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, task_execution_app, enterprise_project_app, identity_policy_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    const probeUrl = url.toString();
    tePool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    epPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    ipPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    teDb = createTaskExecutionDatabase(tePool);
    epDb = createEnterpriseProjectDatabase(epPool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    clock = Date.now();
    fixture = await seedProjectFixture(admin);

    const seedDeps = identityDeps([fixture.projectId]);
    for (const [principalId, displayName] of [
      [OPERATOR, 'WI-204 operator'],
      [OTHER_PRINCIPAL, 'WI-204 second human'],
    ] as const) {
      await withIdentityTransaction(identityDb, seedDeps.context, (trx) =>
        identityRepo.insertPrincipal(trx, {
          id: principalId,
          principalKind: 'HUMAN',
          displayName,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
    }
    const policySnapshotRequest = {
      policySnapshotId: newUuidV7(),
      policySetVersion: `wi204-grant-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: new Date(clock - 60 * 60 * 1000),
      policyDocument: { rules: ['creation-authorization'], version: 1 },
      idempotencyKey: `wi204:policy:${newUuidV7()}`,
    };
    const policySnapshot = await recordPolicySnapshot(seedDeps, policySnapshotRequest);
    expect(policySnapshot.status).toBe('COMMITTED');
    policySnapshotId = policySnapshotRequest.policySnapshotId;
    const policySnapshotRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [policySnapshotId],
      )
    ).rows.at(0);
    if (policySnapshotRow === undefined) throw new Error('grant Policy Snapshot row missing');
    policySnapshotHash = policySnapshotRow.payload_hash;

    operatorActorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
      actorSnapshotId: OPERATOR_ACTOR,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    otherActorRef = await createActorSnapshot(identityDeps([fixture.projectId]), {
      actorSnapshotId: OTHER_ACTOR,
      principalId: OTHER_PRINCIPAL,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: OTHER_AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
    });
    ghostActorRef = await createActorSnapshot(identityDeps([fixture.ghostProjectId]), {
      actorSnapshotId: newUuidV7(),
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.ghostProjectId,
    });
    otherProjectActorRef = await createActorSnapshot(identityDeps([fixture.otherProjectId]), {
      actorSnapshotId: newUuidV7(),
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.otherProjectId,
    });
    grantV1 = await grantCreation({
      capabilityCode: CAPABILITY_V1,
      action: ACTION_V1,
      targetObjectType: TASK_OBJECT_V1,
      projectId: fixture.projectId,
    });
    await grantCreation({
      capabilityCode: CAPABILITY_V2,
      action: ACTION_V2,
      targetObjectType: TASK_OBJECT_V2,
      projectId: fixture.projectId,
    });
    await grantCreation({
      capabilityCode: CAPABILITY_V1,
      action: ACTION_V1,
      targetObjectType: TASK_OBJECT_V1,
      projectId: fixture.ghostProjectId,
    });
    await grantCreation({
      capabilityCode: CAPABILITY_V1,
      action: ACTION_V1,
      targetObjectType: TASK_OBJECT_V1,
      projectId: fixture.otherProjectId,
    });
    entry = entryFor();
  });

  afterAll(async () => {
    await tePool.end();
    await epPool.end();
    await ipPool.end();
    await admin.end();
  });

  it('TE-P202-001 creates one v1 DRAFT from the frozen fixture payload', async () => {
    const targetId = newUuidV7();
    const payload = fixturePayload('1.0', fixture);
    const envelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload,
      idempotencyKey: 'wi204-001',
      targetId,
    });
    const outboxBefore = await countRows('task_execution.outbox_event');
    const result = await createThroughEntry(envelope);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (result.status !== 'COMMITTED') throw new Error('creation did not commit');
    expect(result.resultPayload).toMatchObject({
      taskRef: {
        kind: 'OBJECT',
        objectType: TASK_OBJECT_V1,
        objectId: targetId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      },
      status: 'DRAFT',
      aggregateVersion: '1',
    });

    const root = await taskRow(targetId);
    expect(root).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '1',
      enterprise_id: fixture.enterpriseId,
      project_id: fixture.projectId,
      delivery_item_id: fixture.itemAId,
      delivery_item_version_id: fixture.planVersionId,
    });
    const snapshots = await snapshotRows(targetId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot?.schema_version).toBe('1.0');
    expect(snapshot?.snapshot_id).toBe(root?.current_definition_snapshot_id);
    expect(snapshot?.canonical_payload).toEqual(envelope.payload);
    expect(snapshot?.delivery_item_id).toBe(fixture.itemAId);
    expect(snapshot?.delivery_item_version_id).toBe(fixture.planVersionId);
    expect(
      snapshot?.payload_hash.equals(digestCanonicalPayload(payload as CanonicalJsonObject).hash),
    ).toBe(true);
    expect(snapshot?.payload_hash.equals(root?.current_definition_hash ?? Buffer.alloc(0))).toBe(
      true,
    );

    const receipts = await receiptRows('wi204-001');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      command_type: 'execution.create_task',
      command_version: '1.0',
      outcome: 'COMMITTED',
    });
    const audit = await admin.query<{ outcome: string; error_code: string | null }>(
      'SELECT outcome, error_code FROM task_execution.audit_record WHERE command_id = $1',
      [envelope.commandId],
    );
    expect(audit.rows).toEqual([{ outcome: 'COMMITTED', error_code: null }]);
    expect(await edgePaths(targetId)).toEqual(['/definition/deliveryItemRef', '/projectRef']);
    const edgeTypes = await admin.query<{ target_object_type: string }>(
      `SELECT target_object_type FROM task_execution.reference_edge
        WHERE owner_object_id = $1 ORDER BY reference_path`,
      [targetId],
    );
    expect(edgeTypes.rows.map((row) => row.target_object_type)).toEqual([
      'project.delivery_item',
      'project.project',
    ]);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });

  it('TE-P202-002 creates v2 DRAFTs with and without the optional references', async () => {
    const withoutDeliveryItem = fixturePayload('2.0', fixture);
    delete definitionOf(withoutDeliveryItem).deliveryItemRef;
    const plain = await preparedEnvelope({
      commandVersion: '2.0',
      payload: withoutDeliveryItem,
      idempotencyKey: 'wi204-002-plain',
    });
    expect(await createThroughEntry(plain)).toMatchObject({ status: 'COMMITTED' });
    const plainRoot = await taskRow(plain.targetRef.objectId);
    expect(plainRoot?.delivery_item_id).toBeNull();
    const plainSnapshot = (await snapshotRows(plain.targetRef.objectId))[0];
    expect(plainSnapshot?.schema_version).toBe('2.0');
    expect(plainSnapshot?.canonical_payload).toEqual(withoutDeliveryItem);

    const withDeliveryItem = fixturePayload('2.0', fixture);
    const withItem = await preparedEnvelope({
      commandVersion: '2.0',
      payload: withDeliveryItem,
      idempotencyKey: 'wi204-002-item',
    });
    expect(await createThroughEntry(withItem)).toMatchObject({ status: 'COMMITTED' });
    expect(await taskRow(withItem.targetRef.objectId)).toMatchObject({
      delivery_item_id: fixture.itemAId,
      delivery_item_version_id: fixture.planVersionId,
    });
    // The closed v2 shapes enter the immutable Snapshot unchanged, including
    // the Platform/Enterprise-scoped evaluator and Project-scoped policy refs.
    expect((await snapshotRows(withItem.targetRef.objectId))[0]?.canonical_payload).toEqual(
      withDeliveryItem,
    );

    const withParent = fixturePayload('2.0', fixture);
    definitionOf(withParent).parentTaskRef = objectRef(
      TASK_OBJECT_V2,
      withItem.targetRef.objectId,
      {
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
    );
    const parented = await preparedEnvelope({
      commandVersion: '2.0',
      payload: withParent,
      idempotencyKey: 'wi204-002-parent',
    });
    expect(await createThroughEntry(parented)).toMatchObject({ status: 'COMMITTED' });
    expect(await edgePaths(parented.targetRef.objectId)).toEqual([
      '/definition/deliveryItemRef',
      '/definition/parentTaskRef',
      '/projectRef',
    ]);
  });

  it('TE-P202-003 refuses every Project identity variant and alias', async () => {
    // `owning` = the owning handler must refuse it with its own stable code;
    // `schema` = the registered v2 Schema pins that spelling with `const`
    // (Spec 003 §16.1), so the registry refuses it before the handler. Both
    // are refusals; no variant reaches a business write.
    const variants: readonly [
      string,
      string,
      'owning' | 'schema',
      (ref: Record<string, unknown>) => void,
    ][] = [
      [
        'v1 canonical spelling',
        '1.0',
        'owning',
        (ref) => {
          ref.objectType = 'zhiju.project.project';
        },
      ],
      [
        'v1 DeliveryItem spelling',
        '1.0',
        'owning',
        (ref) => {
          ref.objectType = 'project.delivery_item';
        },
      ],
      [
        'v2 legacy spelling',
        '2.0',
        'schema',
        (ref) => {
          ref.objectType = 'project.project';
        },
      ],
      [
        'v2 DeliveryItem spelling',
        '2.0',
        'schema',
        (ref) => {
          ref.objectType = 'zhiju.project.delivery_item';
        },
      ],
      [
        'bare local name',
        '1.0',
        'schema',
        (ref) => {
          ref.objectType = 'Project';
        },
      ],
      [
        'case variant',
        '1.0',
        'schema',
        (ref) => {
          ref.objectType = 'project.Project';
        },
      ],
      [
        'wrong kind',
        '1.0',
        'schema',
        (ref) => {
          ref.kind = 'VERSIONED';
        },
      ],
      [
        'object id differing from its own scope',
        '1.0',
        'owning',
        (ref) => {
          ref.objectId = newUuidV7();
        },
      ],
      [
        'object id differing from its own scope (v2)',
        '2.0',
        'owning',
        (ref) => {
          ref.objectId = newUuidV7();
        },
      ],
      [
        'scope enterprise differing from the Envelope',
        '1.0',
        'owning',
        (ref) => {
          (ref.scope as Record<string, unknown>).enterpriseId = newUuidV7();
        },
      ],
      [
        'scope project differing from the Envelope',
        '1.0',
        'owning',
        (ref) => {
          (ref.scope as Record<string, unknown>).projectId = fixture.otherProjectId;
        },
      ],
    ];
    for (const [label, commandVersion, gate, mutate] of variants) {
      const payload = fixturePayload(commandVersion, fixture);
      mutate(payload.projectRef as Record<string, unknown>);
      const envelope = await preparedEnvelope({
        commandVersion,
        payload,
        idempotencyKey: `wi204-003-${label}`,
      });
      if (gate === 'owning') {
        expect(await createThroughEntry(envelope), label).toMatchObject({
          status: 'REJECTED',
          errorCode: EXECUTION_PROJECT_REF_INVALID,
        });
      } else {
        await expect(createThroughEntry(envelope), label).rejects.toMatchObject({
          code: API_VALUE_INVALID,
        });
      }
      expect(await taskRow(envelope.targetRef.objectId), label).toBeUndefined();
      expect(await snapshotRows(envelope.targetRef.objectId), label).toEqual([]);
    }

    // The owning handler closes the same acceptance set for the spellings the
    // registered Schema pins: driving it directly with a Schema-invalid
    // spelling still refuses with the module's own stable code, before any
    // EnterpriseProject dependency is consulted.
    for (const commandVersion of ['1.0', '2.0']) {
      const payload = fixturePayload(commandVersion, fixture);
      (payload.projectRef as Record<string, unknown>).objectType = 'Project';
      const result = await createThroughHandler(commandVersion, payload);
      expect(result, commandVersion).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_PROJECT_REF_INVALID,
      });
    }
  });

  it('TE-P202-004 refuses unprovable Project and DeliveryItem facts with one exterior', async () => {
    const ghostPayload = fixturePayload('1.0', {
      ...fixture,
      projectId: fixture.ghostProjectId,
    });
    const ghostEnvelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: ghostPayload,
      idempotencyKey: 'wi204-004-missing-project',
      projectId: fixture.ghostProjectId,
      actorSnapshotRef: ghostActorRef,
    });
    expect(await createThroughEntry(ghostEnvelope)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_PROJECT_REF_INVALID,
    });
    expect(await taskRow(ghostEnvelope.targetRef.objectId)).toBeUndefined();
    const ghostAudit = await admin.query<{ error_code: string }>(
      'SELECT error_code FROM enterprise_project.audit_record WHERE command_id = $1',
      [ghostEnvelope.commandId],
    );
    expect(ghostAudit.rows.map((row) => row.error_code)).toEqual([
      'TASK_CREATION_SCOPE_NOT_VISIBLE',
    ]);

    const itemVariants: readonly [
      string,
      'owning' | 'schema',
      (ref: Record<string, unknown>) => void,
    ][] = [
      [
        'unknown item id',
        'owning',
        (ref) => {
          ref.objectId = newUuidV7();
        },
      ],
      [
        'unknown version id',
        'owning',
        (ref) => {
          ref.versionId = newUuidV7();
        },
      ],
      [
        'exact item with a wrong version identity',
        'owning',
        (ref) => {
          // Both fixture items share the Plan version, so a correct object id
          // with a version that belongs to no row proves the version column is
          // part of the identity comparison instead of an "any row of this
          // Project" lookup.
          ref.versionId = fixture.itemBId;
        },
      ],
      [
        'another Project scope',
        'owning',
        (ref) => {
          (ref.scope as Record<string, unknown>).projectId = fixture.otherProjectId;
        },
      ],
      [
        'another Enterprise scope',
        'owning',
        (ref) => {
          (ref.scope as Record<string, unknown>).enterpriseId = newUuidV7();
        },
      ],
      [
        'wrong kind',
        'schema',
        (ref) => {
          ref.kind = 'OBJECT';
        },
      ],
    ];
    for (const [label, gate, mutate] of itemVariants) {
      const payload = fixturePayload('1.0', fixture);
      mutate(definitionOf(payload).deliveryItemRef as Record<string, unknown>);
      const envelope = await preparedEnvelope({
        commandVersion: '1.0',
        payload,
        idempotencyKey: `wi204-004-${label}`,
      });
      if (gate === 'owning') {
        expect(await createThroughEntry(envelope), label).toMatchObject({
          status: 'REJECTED',
          errorCode: EXECUTION_DELIVERY_ITEM_REF_INVALID,
        });
      } else {
        await expect(createThroughEntry(envelope), label).rejects.toMatchObject({
          code: API_VALUE_INVALID,
        });
      }
      expect(await taskRow(envelope.targetRef.objectId), label).toBeUndefined();
    }

    // The owning handler closes the same set for the DeliveryItem kind the
    // registered Schema pins, before any EnterpriseProject dependency.
    const wrongKindPayload = fixturePayload('1.0', fixture);
    (definitionOf(wrongKindPayload).deliveryItemRef as Record<string, unknown>).kind = 'OBJECT';
    expect(await createThroughHandler('1.0', wrongKindPayload)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_DELIVERY_ITEM_REF_INVALID,
    });

    // The Project lifecycle is an EnterpriseProject fact: a suspended Project
    // is refused exactly like a missing one and leaks no other Project's facts.
    await admin.query('UPDATE enterprise_project.project SET status = $2 WHERE project_id = $1', [
      fixture.otherProjectId,
      'SUSPENDED',
    ]);
    const suspendedEnvelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', { ...fixture, projectId: fixture.otherProjectId }),
      idempotencyKey: 'wi204-004-suspended-project',
      projectId: fixture.otherProjectId,
      actorSnapshotRef: otherProjectActorRef,
    });
    expect(await createThroughEntry(suspendedEnvelope)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_PROJECT_REF_INVALID,
    });
    expect(await taskRow(suspendedEnvelope.targetRef.objectId)).toBeUndefined();
    const suspendedAudit = await admin.query<{ error_code: string }>(
      'SELECT error_code FROM enterprise_project.audit_record WHERE command_id = $1',
      [suspendedEnvelope.commandId],
    );
    expect(suspendedAudit.rows.map((row) => row.error_code)).toEqual([
      'TASK_CREATION_SCOPE_LIFECYCLE_INVALID',
    ]);
    await admin.query('UPDATE enterprise_project.project SET status = $2 WHERE project_id = $1', [
      fixture.otherProjectId,
      'ACTIVE',
    ]);

    // A legal control on the same version still commits.
    const control = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-004-control',
    });
    expect(await createThroughEntry(control)).toMatchObject({ status: 'COMMITTED' });
  });

  it('TE-P202-005 closes Task reference identity and defers dependency existence', async () => {
    const existingTaskId = await firstCommittedTaskId();
    const projectScope = { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId };

    const parentVariants: readonly [string, unknown][] = [
      ['wrong module type', objectRef('zhiju.execution.work_order', existingTaskId, projectScope)],
      ['other version spelling', objectRef(TASK_OBJECT_V1, existingTaskId, projectScope)],
      ['unknown task', objectRef(TASK_OBJECT_V2, newUuidV7(), projectScope)],
      [
        'cross Project scope',
        objectRef(TASK_OBJECT_V2, existingTaskId, {
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.otherProjectId,
        }),
      ],
    ];
    for (const [label, parentRef] of parentVariants) {
      const payload = fixturePayload('2.0', fixture);
      definitionOf(payload).parentTaskRef = parentRef;
      const envelope = await preparedEnvelope({
        commandVersion: '2.0',
        payload,
        idempotencyKey: `wi204-005-parent-${label}`,
      });
      expect(await createThroughEntry(envelope), label).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_PARENT_TASK_REF_INVALID,
      });
    }

    // A case variant is not a registered namespace code at all, so the
    // registered Schema refuses it; the owning handler closes the same set.
    const caseVariantPayload = fixturePayload('2.0', fixture);
    definitionOf(caseVariantPayload).parentTaskRef = objectRef(
      'zhiju.Execution.Task',
      existingTaskId,
      projectScope,
    );
    expect(await createThroughHandler('2.0', caseVariantPayload)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_PARENT_TASK_REF_INVALID,
    });
    const caseVariantDependency = fixturePayload('2.0', fixture);
    definitionOf(caseVariantDependency).dependencyTaskRefs = [
      objectRef('zhiju.Execution.Task', newUuidV7(), projectScope),
    ];
    expect(await createThroughHandler('2.0', caseVariantDependency)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_DEFINITION_REF_INVALID,
    });

    const selfPayload = fixturePayload('2.0', fixture);
    const selfTargetId = newUuidV7();
    definitionOf(selfPayload).parentTaskRef = objectRef(TASK_OBJECT_V2, selfTargetId, projectScope);
    const selfEnvelope = await preparedEnvelope({
      commandVersion: '2.0',
      payload: selfPayload,
      idempotencyKey: 'wi204-005-parent-self',
      targetId: selfTargetId,
    });
    expect(await createThroughEntry(selfEnvelope)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_PARENT_TASK_REF_INVALID,
    });

    const dependencyVariants: readonly [string, unknown[]][] = [
      ['wrong module type', [objectRef('zhiju.execution.work_order', newUuidV7(), projectScope)]],
      ['other version spelling', [objectRef(TASK_OBJECT_V1, newUuidV7(), projectScope)]],
      [
        'cross Project',
        [
          objectRef(TASK_OBJECT_V2, newUuidV7(), {
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.otherProjectId,
          }),
        ],
      ],
    ];
    for (const [label, refs] of dependencyVariants) {
      const payload = fixturePayload('2.0', fixture);
      definitionOf(payload).dependencyTaskRefs = refs;
      const envelope = await preparedEnvelope({
        commandVersion: '2.0',
        payload,
        idempotencyKey: `wi204-005-dependency-${label}`,
      });
      expect(await createThroughEntry(envelope), label).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_DEFINITION_REF_INVALID,
      });
    }

    // A self-referencing dependency is refused like any other self reference.
    const selfDependencyPayload = fixturePayload('2.0', fixture);
    const selfDependencyTarget = newUuidV7();
    definitionOf(selfDependencyPayload).dependencyTaskRefs = [
      objectRef(TASK_OBJECT_V2, selfDependencyTarget, projectScope),
    ];
    const selfDependencyEnvelope = await preparedEnvelope({
      commandVersion: '2.0',
      payload: selfDependencyPayload,
      idempotencyKey: 'wi204-005-dependency-self',
      targetId: selfDependencyTarget,
    });
    expect(await createThroughEntry(selfDependencyEnvelope)).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_DEFINITION_REF_INVALID,
    });

    // A dependency Task that does not exist yet is a legal DRAFT input: it
    // enters the immutable Snapshot unchanged and writes no Edge, because only
    // references this transaction proved exist become Edges.
    const pendingDependency = newUuidV7();
    const pendingPayload = fixturePayload('2.0', fixture);
    definitionOf(pendingPayload).dependencyTaskRefs = [
      objectRef(TASK_OBJECT_V2, pendingDependency, projectScope),
    ];
    const pendingEnvelope = await preparedEnvelope({
      commandVersion: '2.0',
      payload: pendingPayload,
      idempotencyKey: 'wi204-005-dependency-pending',
    });
    expect(await createThroughEntry(pendingEnvelope)).toMatchObject({ status: 'COMMITTED' });
    expect((await snapshotRows(pendingEnvelope.targetRef.objectId))[0]?.canonical_payload).toEqual(
      pendingPayload,
    );
    expect(await edgePaths(pendingEnvelope.targetRef.objectId)).toEqual([
      '/definition/deliveryItemRef',
      '/projectRef',
    ]);
  });

  it('TE-P202-006 closes input and v2 policy/evaluator Scope containment', async () => {
    const enterpriseScope = { enterpriseId: fixture.enterpriseId };
    const projectScope = { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId };
    const crossEnterprise = { enterpriseId: newUuidV7(), projectId: fixture.projectId };
    const crossProject = { enterpriseId: fixture.enterpriseId, projectId: fixture.otherProjectId };
    const externalRef = (externalId: string, tenantScope?: Record<string, string>) => ({
      system: 'feishu',
      resourceType: 'message',
      externalId,
      observedAt: new Date(clock).toISOString(),
      ...(tenantScope === undefined
        ? {}
        : {
            tenantOrAccountRef: objectRef(
              'zhiju.identity.tenant_account',
              newUuidV7(),
              tenantScope,
            ),
          }),
    });

    const accepted: readonly [string, unknown[]][] = [
      ['project scope', [objectRef('zhiju.artifact.artifact_revision', newUuidV7(), projectScope)]],
      [
        'same enterprise scope',
        [objectRef('zhiju.artifact.artifact_revision', newUuidV7(), enterpriseScope)],
      ],
      ['platform scope', [objectRef('zhiju.platform.reference', newUuidV7(), {})]],
      ['external ref without tenant', [externalRef('om-1')]],
      ['external ref with the same enterprise tenant', [externalRef('om-2', enterpriseScope)]],
    ];
    for (const [label, inputRefs] of accepted) {
      const payload = fixturePayload('2.0', fixture);
      definitionOf(payload).inputRefs = inputRefs;
      const envelope = await preparedEnvelope({
        commandVersion: '2.0',
        payload,
        idempotencyKey: `wi204-006-accept-${label}`,
      });
      expect(await createThroughEntry(envelope), label).toMatchObject({ status: 'COMMITTED' });
    }

    const refused: readonly [string, unknown[]][] = [
      [
        'cross enterprise input',
        [objectRef('zhiju.artifact.artifact_revision', newUuidV7(), crossEnterprise)],
      ],
      [
        'cross project input',
        [objectRef('zhiju.artifact.artifact_revision', newUuidV7(), crossProject)],
      ],
      ['cross enterprise tenant', [externalRef('om-3', crossEnterprise)]],
      ['cross project tenant', [externalRef('om-4', crossProject)]],
    ];
    for (const [label, inputRefs] of refused) {
      const payload = fixturePayload('2.0', fixture);
      definitionOf(payload).inputRefs = inputRefs;
      const envelope = await preparedEnvelope({
        commandVersion: '2.0',
        payload,
        idempotencyKey: `wi204-006-refuse-${label}`,
      });
      expect(await createThroughEntry(envelope), label).toMatchObject({
        status: 'REJECTED',
        errorCode: EXECUTION_DEFINITION_REF_INVALID,
      });
      expect(await taskRow(envelope.targetRef.objectId), label).toBeUndefined();
    }

    // v2 policy/evaluator references: the Platform evaluator selector and
    // same-Enterprise references are legal in DRAFT; a tenant-crossing
    // reference is refused before it could enter the immutable Snapshot.
    const policyVariants: readonly [string, boolean, string, Record<string, string>][] = [
      ['platform evaluator selector', true, 'evaluator', {}],
      ['same enterprise evaluator', true, 'evaluator', enterpriseScope],
      ['cross enterprise evaluator', false, 'evaluator', crossEnterprise],
      ['cross project evaluator', false, 'evaluator', crossProject],
      ['cross enterprise policy', false, 'policy', crossEnterprise],
      ['cross project policy', false, 'policy', crossProject],
    ];
    for (const [label, acceptedCase, member, scope] of policyVariants) {
      const payload = fixturePayload('2.0', fixture);
      const definition = definitionOf(payload);
      if (member === 'policy') {
        const outputs = (definition.expectedOutputSpec as { outputs: Record<string, unknown>[] })
          .outputs;
        for (const output of outputs) {
          (output.acceptancePolicyRef as Record<string, unknown>).scope = scope;
        }
      } else {
        const criteria = (definition.completionCriteria as { criteria: Record<string, unknown>[] })
          .criteria;
        for (const criterion of criteria) {
          (criterion.evaluatorRef as Record<string, unknown>).scope = scope;
        }
      }
      const envelope = await preparedEnvelope({
        commandVersion: '2.0',
        payload,
        idempotencyKey: `wi204-006-${label}`,
      });
      const result = await createThroughEntry(envelope);
      if (acceptedCase) {
        expect(result, label).toMatchObject({ status: 'COMMITTED' });
      } else {
        expect(result, label).toMatchObject({
          status: 'REJECTED',
          errorCode: EXECUTION_DEFINITION_REF_INVALID,
        });
      }
    }
  });

  it('TE-P202-007 keeps the Project Scope isolated under RLS', async () => {
    const taskId = await firstCommittedTaskId();

    const otherScope = await asAppRole(
      tePool,
      'task_execution_app',
      [fixture.otherProjectId],
      async (client) => ({
        tasks: (
          await client.query('SELECT task_id FROM task_execution.task WHERE task_id = $1', [taskId])
        ).rowCount,
        snapshots: (
          await client.query(
            'SELECT snapshot_id FROM task_execution.task_definition_snapshot WHERE task_id = $1',
            [taskId],
          )
        ).rowCount,
      }),
    );
    expect(otherScope).toEqual({ tasks: 0, snapshots: 0 });

    // The Project/DeliveryItem proof sees nothing through another context.
    const visible = await asAppRole(
      epPool,
      'enterprise_project_app',
      [fixture.otherProjectId],
      async (client) => ({
        items: (
          await client.query(
            'SELECT delivery_item_id FROM enterprise_project.delivery_item WHERE delivery_item_id = $1',
            [fixture.itemAId],
          )
        ).rowCount,
      }),
    );
    expect(visible).toEqual({ items: 0 });
  });

  it('TE-P202-008 fails closed on revoked, expired, drifted and replayed authorization', async () => {
    const payload = fixturePayload('1.0', fixture);
    const envelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload,
      idempotencyKey: 'wi204-008',
    });
    expect(await createThroughEntry(envelope)).toMatchObject({ status: 'COMMITTED' });
    const taskId = envelope.targetRef.objectId;
    const snapshotsBefore = await snapshotRows(taskId);

    // Revocation is proven before the idempotency claim: a fresh key with a
    // Decision whose covering Grant is gone writes no Receipt at all.
    const revoked = await revokeCapability(identityDeps([fixture.projectId]), {
      targetId: grantV1,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI204_FIXTURE_REVOKE',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi204:revoke:${grantV1}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    const revokedEnvelope = { ...envelope, idempotencyKey: 'wi204-008-revoked' };
    await expect(createThroughEntry(revokedEnvelope)).rejects.toMatchObject({
      code: AUTHORIZATION_REVOKED,
    });
    expect(await receiptRows('wi204-008-revoked')).toHaveLength(0);

    // A historical Receipt is not readable while authorization fails, and it
    // grants no new eligibility once it is readable again.
    await expect(createThroughEntry(envelope)).rejects.toMatchObject({
      code: AUTHORIZATION_REVOKED,
    });

    grantV1 = await grantCreation({
      capabilityCode: CAPABILITY_V1,
      action: ACTION_V1,
      targetObjectType: TASK_OBJECT_V1,
      projectId: fixture.projectId,
    });
    const replayed = await createThroughEntry(envelope);
    expect(replayed).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    if (replayed.status !== 'DUPLICATE') throw new Error('expected a replayed Receipt');
    expect(replayed.resultPayload).toMatchObject({ status: 'DRAFT', aggregateVersion: '1' });
    expect(await snapshotRows(taskId)).toEqual(snapshotsBefore);

    // Expiry, trusted capability-configuration drift, target substitution and
    // payload substitution each fail on their own.
    const expiredEntry = entryFor({ now: (): Date => new Date(clock + 25 * 60 * 60 * 1000) });
    await expect(createThroughEntry(envelope, expiredEntry)).rejects.toMatchObject({
      code: AUTHORIZATION_EXPIRED,
    });
    const driftedEntry = entryFor({ code: 'wi204.cap.task.v1.drifted' });
    await expect(createThroughEntry(envelope, driftedEntry)).rejects.toMatchObject({
      code: AUTHORIZATION_REVOKED,
    });
    const substitutedTarget = {
      ...envelope,
      targetRef: { ...envelope.targetRef, objectType: TASK_OBJECT_V2 },
    };
    await expect(createThroughEntry(substitutedTarget)).rejects.toMatchObject({
      code: IDENTITY_CREATION_TARGET_INVALID,
    });
    const otherTargetEnvelope = {
      ...envelope,
      targetRef: { ...envelope.targetRef, objectId: newUuidV7() },
    };
    await expect(createThroughEntry(otherTargetEnvelope)).rejects.toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
    });
    const otherPayload = fixturePayload('1.0', fixture);
    definitionOf(otherPayload).title = 'Substituted after authorization';
    await expect(
      createThroughEntry({
        ...envelope,
        payload: otherPayload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(
            digestCanonicalPayload(otherPayload as CanonicalJsonObject).hash.toString('hex'),
          ),
        },
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // The same Decision presented by another actor, in its own session, is
    // refused and leaves no Receipt behind.
    const otherActorEnvelope: CreationEnvelope = {
      ...envelope,
      idempotencyKey: 'wi204-008-other-actor',
      targetRef: { ...envelope.targetRef, objectId: newUuidV7() },
      actor: {
        kind: 'SNAPSHOT',
        objectType: 'identity.actor_snapshot',
        objectId: otherActorRef.snapshotId,
        snapshotId: otherActorRef.snapshotId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        contentHash: otherActorRef.contentHash,
      },
    };
    await expect(
      createThroughEntry(otherActorEnvelope, entry, OTHER_AUTH_HASH),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
    expect(await receiptRows('wi204-008-other-actor')).toHaveLength(0);
  });

  it('TE-P202-009 rejects mirror, hash, version and pointer tampering at the database', async () => {
    // Dedicated, deterministic baselines: one v1 and one v2 DRAFT created
    // through the owning entry, so every single-variable tampering below starts
    // from the same committed row and the same producing command identity.
    const baselineV1 = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-009-baseline-v1',
    });
    expect(await createThroughEntry(baselineV1)).toMatchObject({ status: 'COMMITTED' });
    const snapshot = (await snapshotRows(baselineV1.targetRef.objectId))[0];
    if (snapshot === undefined) throw new Error('v1 snapshot fixture missing');
    const baselineV2 = await preparedEnvelope({
      commandVersion: '2.0',
      payload: fixturePayload('2.0', fixture),
      idempotencyKey: 'wi204-009-baseline-v2',
    });
    expect(await createThroughEntry(baselineV2)).toMatchObject({ status: 'COMMITTED' });
    const versionTwoSnapshot = (await snapshotRows(baselineV2.targetRef.objectId))[0];
    if (versionTwoSnapshot === undefined) throw new Error('v2 snapshot fixture missing');
    const targetId = baselineV1.targetRef.objectId;
    const versionTwoTaskId = baselineV2.targetRef.objectId;

    /**
     * Writes one TaskDefinitionSnapshot from inside a real claimed command
     * transaction: the Receipt is the runner's own (`PENDING`, request hash of
     * this envelope), so the only difference from the owning path is the single
     * tampered dimension named by the caller.
     */
    const insertThroughCommand = (input: {
      commandVersion: string;
      requestPayload: Record<string, unknown>;
      targetId: string;
      schemaVersion?: string;
      payload?: Record<string, unknown>;
      payloadHash?: Buffer;
      deliveryItemId?: string;
      deliveryItemVersionId?: string;
      taskId?: string;
      sourceCommandId?: string;
    }) => {
      const commandId = newUuidV7();
      const objectType = input.commandVersion === '1.0' ? TASK_OBJECT_V1 : TASK_OBJECT_V2;
      const payload = input.payload ?? input.requestPayload;
      const deliveryItemRef = definitionOf(payload).deliveryItemRef as
        Record<string, unknown> | undefined;
      const mirror =
        deliveryItemRef === undefined
          ? {}
          : {
              deliveryItemId: deliveryItemRef.objectId as string,
              deliveryItemVersionId: deliveryItemRef.versionId as string,
            };
      return executeTaskExecutionCommand(
        teDb,
        runnerContext(),
        {
          commandId,
          commandType: 'execution.create_task',
          commandVersion: input.commandVersion,
          idempotencyScope: `wi204:integrity:${input.commandVersion}`,
          idempotencyKey: `wi204-integrity-${newUuidV7()}`,
          requestPayload: input.requestPayload as CanonicalJsonObject,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType: objectType,
          targetId: input.targetId,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId,
        } satisfies CommandEnvelope,
        async (execution) => {
          await execution.insertTaskDraftDefinition({
            snapshotId: newUuidV7(),
            taskId: input.taskId ?? input.targetId,
            schemaVersion: input.schemaVersion ?? input.commandVersion,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            ...mirror,
            ...(input.deliveryItemId === undefined ? {} : { deliveryItemId: input.deliveryItemId }),
            ...(input.deliveryItemVersionId === undefined
              ? {}
              : { deliveryItemVersionId: input.deliveryItemVersionId }),
            canonicalPayload: payload as CanonicalJsonObject,
            payloadHash:
              input.payloadHash ?? digestCanonicalPayload(payload as CanonicalJsonObject).hash,
            createdByPrincipalId: OPERATOR,
            sourceCommandId: input.sourceCommandId ?? commandId,
          });
          return { kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } };
        },
      );
    };

    // A promoted column that disagrees with the canonical payload is refused
    // before the row can be committed, in a real pending command transaction.
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        deliveryItemId: fixture.itemBId,
        deliveryItemVersionId: fixture.planVersionId,
      }),
      'delivery item id mirror',
    ).rejects.toThrow(/promoted mirror mismatch/);
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        ...(snapshot.delivery_item_id === null
          ? {}
          : { deliveryItemId: snapshot.delivery_item_id }),
        deliveryItemVersionId: newUuidV7(),
      }),
      'delivery item version mirror',
    ).rejects.toThrow(/promoted mirror mismatch/);
    // A hash that its own command never requested is refused by the creation
    // identity guard, and a stored payload that disagrees with the hash the
    // command did request is refused by the mirror guard: checking only the
    // length, or only the command identity, is not enough.
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        payloadHash: Buffer.alloc(32, 0x55),
      }),
      'payload hash its Receipt never requested',
    ).rejects.toThrow(/creation identity mismatch/);
    const unrequestedDefinition = structuredClone(snapshot.canonical_payload);
    definitionOf(unrequestedDefinition).title = 'A definition this command never requested';
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: unrequestedDefinition,
        targetId,
        payload: snapshot.canonical_payload,
        // The declared hash is the one the command really requested, so only
        // the stored bytes disagree with it.
        payloadHash: digestCanonicalPayload(unrequestedDefinition as CanonicalJsonObject).hash,
      }),
      'stored payload that disagrees with its declared hash',
    ).rejects.toThrow(/promoted mirror mismatch/);
    const driftedPayload = structuredClone(snapshot.canonical_payload);
    (driftedPayload.projectRef as { scope: Record<string, unknown> }).scope = {
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.otherProjectId,
    };
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: driftedPayload,
        targetId,
      }),
      'Scope mirror',
    ).rejects.toThrow(/mirror mismatch/);

    // The promoted `schema_version` records the CREATE major that produced the
    // payload, and its truth comes from that command's own Receipt: a v2
    // payload relabelled `1.0` has no v1 receipt to agree with. The payload
    // shape alone cannot close this direction, because v1 leaves
    // `expectedOutputSpec`/`completionCriteria` open by contract.
    await expect(
      insertThroughCommand({
        commandVersion: '2.0',
        requestPayload: versionTwoSnapshot.canonical_payload,
        targetId: versionTwoTaskId,
        schemaVersion: '1.0',
      }),
      'v2 payload relabelled 1.0',
    ).rejects.toThrow(/creation identity mismatch/);
    // The other direction stays closed by the payload-shape CHECK: a v2 label
    // may not carry the open v1 members.
    await expect(
      insertThroughCommand({
        commandVersion: '2.0',
        requestPayload: snapshot.canonical_payload,
        targetId: versionTwoTaskId,
        schemaVersion: '2.0',
      }),
      'v1 payload relabelled 2.0',
    ).rejects.toThrow(/task_definition_snapshot_v2_shape/);
    // A Snapshot whose Receipt does not exist, is already finalized, or belongs
    // to another command identity is refused before the fact can exist.
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        sourceCommandId: newUuidV7(),
      }),
      'Receipt that does not exist',
    ).rejects.toThrow(/creation identity mismatch/);
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        sourceCommandId: versionTwoSnapshot.source_command_id,
      }),
      'finalized Receipt of another command',
    ).rejects.toThrow(/creation identity mismatch/);
    // The Receipt already commits the canonical hash of its own request: the
    // same pending command cannot store a different definition, so a Snapshot
    // always carries the payload its `source_command_id` was claimed for.
    const otherDefinition = structuredClone(snapshot.canonical_payload);
    definitionOf(otherDefinition).title = 'A definition this command never requested';
    await expect(
      insertThroughCommand({
        commandVersion: '1.0',
        requestPayload: snapshot.canonical_payload,
        targetId,
        payload: otherDefinition,
      }),
      'another payload under the same Receipt',
    ).rejects.toThrow(/creation identity mismatch/);

    // A Root pointer is a composite reference and a definition change is a CAS
    // transition: reusing the Snapshot id with another definition hash, or
    // re-pointing without advancing the aggregate version, is refused.
    await expect(
      asAppRole(tePool, 'task_execution_app', [fixture.projectId], (client) =>
        client.query(
          `INSERT INTO task_execution.task
             (task_id, enterprise_id, project_id, status, aggregate_version,
              current_definition_snapshot_id, current_definition_hash,
              created_by_principal_id)
           VALUES ($1, $2, $3, 'DRAFT', 1, $4, $5, $6)`,
          [
            newUuidV7(),
            fixture.enterpriseId,
            fixture.projectId,
            snapshot.snapshot_id,
            Buffer.alloc(32, 0x56),
            OPERATOR,
          ],
        ),
      ),
    ).rejects.toThrow(/task_definition_pointer_fk|violates foreign key/i);
    const appStatement = (statement: string, parameters: readonly unknown[]) =>
      asAppRole(tePool, 'task_execution_app', [fixture.projectId], (client) =>
        client.query(statement, [...parameters]),
      );
    await expect(
      appStatement(
        'UPDATE task_execution.task SET current_definition_hash = $2 WHERE task_id = $1',
        [targetId, Buffer.alloc(32, 0x58)],
      ),
      'pointer hash without a CAS advance',
    ).rejects.toThrow(/must advance the aggregate version/);
    await expect(
      appStatement(
        'UPDATE task_execution.task SET current_definition_snapshot_id = $2 WHERE task_id = $1',
        [targetId, versionTwoSnapshot.snapshot_id],
      ),
      'foreign pointer without a CAS advance',
    ).rejects.toThrow(/must advance the aggregate version/);
    // The same pointer move with a CAS advance is the only accepted shape, and
    // the composite pointer then still has to resolve to this Task's Snapshot.
    await expect(
      appStatement(
        `UPDATE task_execution.task
            SET current_definition_snapshot_id = $2, current_definition_hash = $3,
                aggregate_version = aggregate_version + 1
          WHERE task_id = $1`,
        [targetId, versionTwoSnapshot.snapshot_id, versionTwoSnapshot.payload_hash],
      ),
      'pointer to another Task definition with a CAS advance',
    ).rejects.toThrow(/task_definition_pointer_fk|violates foreign key/i);
    expect((await taskRow(targetId))?.aggregate_version).toBe('1');

    // The database canonicalizer must be byte-equivalent to the shared-kernel
    // canonicalization v1: every creation below commits only when the SQL
    // recomputation of `sha256(canonical_jsonb_text(canonical_payload))` equals
    // the address the application computed.
    const canonicalCases: readonly [string, Record<string, unknown>][] = [
      [
        'byte-order keys and NFC-normalized key',
        { z: 1, A: 2, _: 3, '0': 4, 'e\u0301': 'normalized key' },
      ],
      [
        'NFC-normalized values and escapes',
        { value: 'e\u0301', escaped: 'line\nbreak\ttab"quote\\slash/\u0001del\u007f' },
      ],
      ['safe integers and -0', { max: 9007199254740991, zero: 0, negative: -1, minusZero: -0 }],
      [
        'empty containers and scalars',
        { empty: {}, list: [], yes: true, no: false, nothing: null },
      ],
      ['nested structures', { list: [{ b: 1, a: [{ deep: 'é' }] }], text: '😀' }],
    ];
    for (const [label, tricky] of canonicalCases) {
      const payload = fixturePayload('1.0', fixture);
      definitionOf(payload).expectedOutputSpec = tricky;
      payload.initialAssignee = { ...tricky, label };
      const envelope = await preparedEnvelope({
        commandVersion: '1.0',
        payload,
        idempotencyKey: `wi204-009-canonical-${label}`,
      });
      expect(await createThroughEntry(envelope), label).toMatchObject({ status: 'COMMITTED' });
      const stored = (await snapshotRows(envelope.targetRef.objectId))[0];
      // The stored payload is the JSON serialization of the request payload:
      // JSONB keeps values (including `-0`), not JavaScript identity.
      expect(stored?.canonical_payload, label).toEqual(JSON.parse(JSON.stringify(payload)));
      expect(
        stored?.payload_hash.equals(digestCanonicalPayload(payload as CanonicalJsonObject).hash),
        label,
      ).toBe(true);
    }

    // A v1 payload may legally carry the closed v2 members, because the v1
    // `TaskDefinition` keeps those two fields open: the label records the
    // creating major, and this row keeps its v1 command identity.
    const openV1Payload = fixturePayload('1.0', fixture);
    definitionOf(openV1Payload).expectedOutputSpec = {
      schemaVersion: '1.0',
      outputs: [{ outputSlot: 'procedure.draft', cardinality: 'EXACTLY_ONE' }],
    };
    definitionOf(openV1Payload).completionCriteria = { schemaVersion: '1.0', criteria: [] };
    const openV1Envelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: openV1Payload,
      idempotencyKey: 'wi204-009-open-v1-members',
    });
    expect(await createThroughEntry(openV1Envelope)).toMatchObject({ status: 'COMMITTED' });
    expect((await snapshotRows(openV1Envelope.targetRef.objectId))[0]?.schema_version).toBe('1.0');
    expect((await snapshotRows(openV1Envelope.targetRef.objectId))[0]?.canonical_payload).toEqual(
      JSON.parse(JSON.stringify(openV1Payload)),
    );

    // Property names that collide after NFC normalization are refused by the
    // shared kernel and by the database recomputation, so a direct write cannot
    // publish an address no application can reproduce. The application cannot
    // even hash that payload, so the SQL side is exercised with a synthetic
    // pending Receipt whose declared request hash is the same self-consistent
    // value: the collision rule, not the identity rule, is what must fire.
    const collidingPayload = structuredClone(snapshot.canonical_payload);
    const collidingScope = (collidingPayload.projectRef as { scope: Record<string, unknown> })
      .scope;
    collidingScope['e\u0301'] = 'nfd';
    collidingScope['é'] = 'nfc';
    expect(() => digestCanonicalPayload(collidingPayload as CanonicalJsonObject)).toThrow(
      /collide after NFC normalization/,
    );
    const syntheticCommandId = newUuidV7();
    const syntheticHash = Buffer.alloc(32, 0x5a);
    await admin.query(
      `INSERT INTO task_execution.command_receipt
         (command_id, command_type, command_version, idempotency_scope, idempotency_key,
          request_payload_hash, enterprise_id, project_id, target_type, target_id,
          outcome, correlation_id, created_by_principal_id, actor_snapshot_id,
          authorization_decision_id)
       VALUES ($1, 'execution.create_task', '1.0', 'wi204:integrity:collision', $2,
               $3, $4, $5, 'execution.task', $6, 'PENDING', $7, $8, $9, $10)`,
      [
        syntheticCommandId,
        `wi204-integrity-collision-${syntheticCommandId}`,
        syntheticHash,
        fixture.enterpriseId,
        fixture.projectId,
        targetId,
        CORRELATION,
        OPERATOR,
        OPERATOR_ACTOR,
        REQUEST_DECISION,
      ],
    );
    await expect(
      asAppRole(tePool, 'task_execution_app', [fixture.projectId], (client) =>
        client.query(
          `INSERT INTO task_execution.task_definition_snapshot
             (snapshot_id, task_id, schema_version, enterprise_id, project_id,
              delivery_item_id, delivery_item_version_id, canonical_payload,
              payload_hash, created_by_principal_id, source_command_id)
           VALUES ($1, $2, '1.0', $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
          [
            newUuidV7(),
            targetId,
            fixture.enterpriseId,
            fixture.projectId,
            snapshot.delivery_item_id,
            snapshot.delivery_item_version_id,
            JSON.stringify(collidingPayload),
            syntheticHash,
            OPERATOR,
            syntheticCommandId,
          ],
        ),
      ),
      'NFC key collision',
    ).rejects.toThrow(/collide after NFC normalization/);
  });

  it('TE-P202-010 keeps idempotency scoped to one command identity', async () => {
    const payload = fixturePayload('1.0', fixture);
    const envelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload,
      idempotencyKey: 'wi204-010-replay',
    });
    expect(await createThroughEntry(envelope)).toMatchObject({ status: 'COMMITTED' });
    const targetId = envelope.targetRef.objectId;
    const snapshotsBefore = await snapshotRows(targetId);
    const edgesBefore = await countRows('task_execution.reference_edge');

    const replay = await createThroughEntry(envelope);
    expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    expect(await snapshotRows(targetId)).toEqual(snapshotsBefore);
    expect(await countRows('task_execution.reference_edge')).toBe(edgesBefore);

    // Same key, different payload: a stable conflict with a DENIED audit, not
    // a silent replay. The changed payload carries its own legitimate Decision
    // (revalidation runs first by design), so the conflict is the Receipt's.
    const changed = fixturePayload('1.0', fixture);
    definitionOf(changed).title = 'A different request';
    const conflicting = await preparedEnvelope({
      commandVersion: '1.0',
      payload: changed,
      idempotencyKey: 'wi204-010-replay',
      targetId: targetId,
    });
    await expect(createThroughEntry(conflicting)).rejects.toMatchObject({
      code: IDEMPOTENCY_PAYLOAD_CONFLICT,
    });
    expect(await snapshotRows(targetId)).toEqual(snapshotsBefore);
    const deniedAudit = await admin.query<{ outcome: string; error_code: string }>(
      `SELECT outcome, error_code FROM task_execution.audit_record
        WHERE error_code = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [IDEMPOTENCY_PAYLOAD_CONFLICT],
    );
    expect(deniedAudit.rows[0]).toEqual({
      outcome: 'DENIED',
      error_code: IDEMPOTENCY_PAYLOAD_CONFLICT,
    });

    // Cross-version: the two majors compose different idempotency scopes, so a
    // shared key is re-run rather than answered with the other version's
    // Receipt. The runner is driven directly, because the composition layer
    // owns the server-side scope it must never take from a caller: with one
    // scope, one key and byte-identical payloads, the persisted command
    // identity decides.
    const sharedKey = 'wi204-010-cross-version';
    const sharedScope = 'wi204:shared-scope';
    const sharedPayload = { projectRef: payload.projectRef, definition: { taskType: 'x.y' } };
    const runnerContext: TaskExecutionTransactionContext = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      policySnapshotId,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
    const runnerEnvelope = (
      commandVersion: string,
      targetObjectType: string,
      targetId: string,
    ): CommandEnvelope => ({
      commandId: newUuidV7(),
      commandType: 'execution.create_task',
      commandVersion,
      idempotencyScope: sharedScope,
      idempotencyKey: sharedKey,
      requestPayload: sharedPayload as CanonicalJsonObject,
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
      targetType: targetObjectType,
      targetId,
      correlationId: CORRELATION,
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      policySnapshotId,
    });
    const v1RunnerTarget = newUuidV7();
    const first = await executeTaskExecutionCommand(
      teDb,
      runnerContext,
      runnerEnvelope('1.0', TASK_OBJECT_V1, v1RunnerTarget),
      (): Promise<CommandBodyResult> =>
        Promise.resolve({ kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } }),
    );
    expect(first).toMatchObject({ status: 'COMMITTED' });
    const v2RunnerTarget = newUuidV7();
    await expect(
      executeTaskExecutionCommand(
        teDb,
        runnerContext,
        runnerEnvelope('2.0', TASK_OBJECT_V2, v2RunnerTarget),
        (): Promise<CommandBodyResult> =>
          Promise.resolve({ kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } }),
      ),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
    expect(await taskRow(v2RunnerTarget)).toBeUndefined();
    const crossVersionAudit = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM task_execution.audit_record
        WHERE error_code = $1 AND target_id = $2`,
      [IDEMPOTENCY_PAYLOAD_CONFLICT, v2RunnerTarget],
    );
    expect(crossVersionAudit.rows).toEqual([{ outcome: 'DENIED' }]);
  });

  it('TE-P202-011 resolves concurrent same-key and same-target creation', async () => {
    const sameKeyEnvelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-011-same-key',
    });
    const sameKeyAttempts = await Promise.allSettled([
      createThroughEntry(sameKeyEnvelope),
      createThroughEntry(sameKeyEnvelope),
    ]);
    expect(
      sameKeyAttempts.filter(
        (attempt) => attempt.status === 'fulfilled' && attempt.value.status === 'COMMITTED',
      ),
    ).toHaveLength(1);
    for (const attempt of sameKeyAttempts) {
      if (attempt.status === 'rejected') {
        expect(attempt.reason).toMatchObject({ code: COMMAND_IN_PROGRESS });
      } else if (attempt.value.status === 'DUPLICATE') {
        expect(attempt.value.originalOutcome).toBe('COMMITTED');
      }
    }
    // Exactly one creation effect, whatever the losing attempt observed.
    expect(await snapshotRows(sameKeyEnvelope.targetRef.objectId)).toHaveLength(1);
    const sameKeyReceipts = await receiptRows('wi204-011-same-key');
    expect(sameKeyReceipts).toHaveLength(1);
    expect(sameKeyReceipts[0]?.outcome).toBe('COMMITTED');

    const sameTargetId = newUuidV7();
    const contenders = await Promise.all([
      preparedEnvelope({
        commandVersion: '1.0',
        payload: fixturePayload('1.0', fixture),
        idempotencyKey: 'wi204-011-target-first',
        targetId: sameTargetId,
      }),
      preparedEnvelope({
        commandVersion: '1.0',
        payload: fixturePayload('1.0', fixture),
        idempotencyKey: 'wi204-011-target-second',
        targetId: sameTargetId,
      }),
    ]);
    const outcomes = await Promise.all(contenders.map((envelope) => createThroughEntry(envelope)));
    expect(outcomes.filter((outcome) => outcome.status === 'COMMITTED')).toHaveLength(1);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === 'REJECTED' && outcome.errorCode === EXECUTION_TASK_ALREADY_EXISTS,
      ),
    ).toHaveLength(1);
    expect(await snapshotRows(sameTargetId)).toHaveLength(1);
    expect(await taskRow(sameTargetId)).toBeDefined();
  });

  it('TE-P202-012 rolls back injected faults and unavailable dependencies', async () => {
    // An unavailable EnterpriseProject dependency is never read as VALID: the
    // owning Port fails closed, no Receipt is claimed and nothing is written.
    const deadUrl = new URL(databaseUrl ?? '');
    deadUrl.username = PROBE_ROLE;
    deadUrl.password = PROBE_PASSWORD;
    const deadPool = new pg.Pool({ connectionString: deadUrl.toString(), max: 1 });
    await deadPool.end();
    const unavailableEntry = createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb: createEnterpriseProjectDatabase(deadPool),
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes,
      now: (): Date => new Date(clock),
    });
    const unavailableEnvelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-012-unavailable',
    });
    await expect(createThroughEntry(unavailableEnvelope, unavailableEntry)).rejects.toMatchObject({
      code: DEPENDENCY_UNAVAILABLE,
    });
    expect(await taskRow(unavailableEnvelope.targetRef.objectId)).toBeUndefined();
    expect(await snapshotRows(unavailableEnvelope.targetRef.objectId)).toEqual([]);
    expect(await receiptRows('wi204-012-unavailable')).toHaveLength(0);

    // A fault raised after the Root and Snapshot writes must leave nothing
    // behind, not even a PENDING claim.
    const faultKey = 'wi204-012-fault';
    const faultTargetId = newUuidV7();
    const faultCommandId = newUuidV7();
    const faultPayload = fixturePayload('1.0', fixture);
    const faultDigest = digestCanonicalPayload(faultPayload as CanonicalJsonObject);
    await expect(
      executeTaskExecutionCommand(
        teDb,
        {
          kind: 'REQUEST',
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          authorizationDecisionHash: DECISION_HASH,
          authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
          policySnapshotId,
          enterpriseId: fixture.enterpriseId,
          allowedProjectIds: [fixture.projectId],
          correlationId: CORRELATION,
        },
        {
          commandId: faultCommandId,
          commandType: 'execution.create_task',
          commandVersion: '1.0',
          idempotencyScope: 'wi204:fault',
          idempotencyKey: faultKey,
          requestPayload: faultPayload as CanonicalJsonObject,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType: TASK_OBJECT_V1,
          targetId: faultTargetId,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId,
        } satisfies CommandEnvelope,
        async (execution) => {
          const snapshotId = newUuidV7();
          const faultItemRef = definitionOf(faultPayload).deliveryItemRef as
            Record<string, unknown> | undefined;
          const faultMirror =
            faultItemRef === undefined
              ? {}
              : {
                  deliveryItemId: faultItemRef.objectId as string,
                  deliveryItemVersionId: faultItemRef.versionId as string,
                };
          await execution.insertTaskDraftRoot({
            taskId: faultTargetId,
            targetObjectType: TASK_OBJECT_V1,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            currentDefinitionSnapshotId: snapshotId,
            currentDefinitionHash: faultDigest.hash,
            ...faultMirror,
            createdByPrincipalId: OPERATOR,
          });
          await execution.insertTaskDraftDefinition({
            snapshotId,
            taskId: faultTargetId,
            schemaVersion: '1.0',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            ...faultMirror,
            canonicalPayload: faultPayload as CanonicalJsonObject,
            payloadHash: faultDigest.hash,
            createdByPrincipalId: OPERATOR,
            sourceCommandId: faultCommandId,
          });
          throw new Error('injected fault after the definition write');
        },
      ),
    ).rejects.toThrow(/injected fault/);
    expect(await taskRow(faultTargetId)).toBeUndefined();
    expect(await snapshotRows(faultTargetId)).toEqual([]);
    expect(await receiptRows(faultKey)).toHaveLength(0);

    // The same key commits normally afterwards: the rolled-back attempt left no
    // PENDING Receipt behind.
    const recoveredTargetId = newUuidV7();
    const recoveredEnvelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: faultKey,
      targetId: recoveredTargetId,
    });
    expect(await createThroughEntry(recoveredEnvelope)).toMatchObject({ status: 'COMMITTED' });
    expect(await taskRow(recoveredTargetId)).toBeDefined();
    expect(await receiptRows(faultKey)).toHaveLength(1);
  });

  it('TE-P202-013 refuses direct owner SQL on immutable facts', async () => {
    const targetId = await firstCommittedTaskId();
    const snapshot = (await snapshotRows(targetId))[0];
    if (snapshot === undefined) throw new Error('snapshot fixture missing');

    const appStatement = (statement: string, parameters: readonly unknown[]) =>
      asAppRole(tePool, 'task_execution_app', [fixture.projectId], (client) =>
        client.query(statement, [...parameters]),
      );

    await expect(
      appStatement(
        'UPDATE task_execution.task_definition_snapshot SET payload_hash = payload_hash WHERE snapshot_id = $1',
        [snapshot.snapshot_id],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      appStatement('DELETE FROM task_execution.task_definition_snapshot WHERE snapshot_id = $1', [
        snapshot.snapshot_id,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      appStatement('DELETE FROM task_execution.task WHERE task_id = $1', [targetId]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      appStatement('UPDATE task_execution.task SET enterprise_id = $2 WHERE task_id = $1', [
        targetId,
        newUuidV7(),
      ]),
    ).rejects.toThrow(/task scope is immutable/);
    await expect(
      appStatement('UPDATE task_execution.task SET project_id = $2 WHERE task_id = $1', [
        targetId,
        fixture.otherProjectId,
      ]),
    ).rejects.toThrow(/task scope is immutable/);

    // A Root for another Project is not visible to the current context at all.
    await expect(
      appStatement(
        `INSERT INTO task_execution.task
           (task_id, enterprise_id, project_id, status, aggregate_version,
            current_definition_snapshot_id, current_definition_hash, created_by_principal_id)
         VALUES ($1, $2, $3, 'DRAFT', 1, $4, $5, $6)`,
        [
          newUuidV7(),
          fixture.enterpriseId,
          fixture.otherProjectId,
          snapshot.snapshot_id,
          snapshot.payload_hash,
          OPERATOR,
        ],
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    // The owner path cannot rewrite a committed Snapshot either: the immutable
    // guard refuses the UPDATE where the role has no grant at all.
    await expect(
      admin.query(
        'UPDATE task_execution.task_definition_snapshot SET canonical_payload = canonical_payload WHERE snapshot_id = $1',
        [snapshot.snapshot_id],
      ),
    ).rejects.toThrow(/immutable/);

    expect((await snapshotRows(targetId))[0]?.payload_hash).toEqual(snapshot.payload_hash);
  });

  it('TE-P202-014 keeps published compatibility surfaces unchanged', async () => {
    expect(readFileSync(V1_FIXTURE, 'utf8')).toBe(readFileSync(V1_BASELINE_FIXTURE, 'utf8'));
    expect(
      registry.validateOperation(
        'execution.create_task',
        '1.0',
        JSON.parse(readFileSync(V1_FIXTURE, 'utf8')) as unknown,
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(registry.getOperation('project.validate_object_scope', '2.0')).toBeUndefined();

    const projectScopeContext: EnterpriseProjectTransactionContext = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      policySnapshotId,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
    const scopePayload = (
      objectType: string,
    ): EnterpriseProject.ProjectValidateObjectScopePayload => ({
      objectRef: {
        kind: 'OBJECT',
        objectType,
        objectId: fixture.projectId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      },
      expectedScopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      purpose: 'wi204.compatibility',
    });
    for (const objectType of [
      'zhiju.project.project',
      'zhiju.project.delivery_item',
      'DeliveryItem',
    ]) {
      await expect(
        handleValidateObjectScope(epDb, projectScopeContext, scopePayload(objectType)),
      ).rejects.toMatchObject({ code: PROJECT_OBJECT_SCOPE_MISMATCH });
    }
    expect(
      await handleValidateObjectScope(epDb, projectScopeContext, scopePayload('Project')),
    ).toMatchObject({ valid: true, lifecycle: 'ACTIVE' });

    // No TaskDefinitionSnapshot objectType is registered, and the creation
    // Result carries no Snapshot reference.
    expect(registry.getOperation('execution.get_task_definition_snapshot', '1.0')).toBeUndefined();
    const created = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-014',
    });
    const result = await createThroughEntry(created);
    expect(result).toMatchObject({ status: 'COMMITTED' });
    if (result.status !== 'COMMITTED') throw new Error('creation did not commit');
    expect(Object.keys(result.resultPayload)).toEqual(['taskRef', 'status', 'aggregateVersion']);
  });

  it('TE-P202-015 writes no Outbox event for a DRAFT creation', async () => {
    const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
      operations: { type: string; kind: string; owner: string }[];
    };
    expect(catalog.operations).toHaveLength(221);
    const taskEvents = catalog.operations.filter(
      (operation) => operation.owner === 'task-execution' && operation.kind === 'EVENT',
    );
    expect(taskEvents).toHaveLength(12);
    expect(taskEvents.some((event) => event.type === 'execution.TaskCreated')).toBe(false);

    const envelope = await preparedEnvelope({
      commandVersion: '1.0',
      payload: fixturePayload('1.0', fixture),
      idempotencyKey: 'wi204-015',
    });
    const outboxBefore = await countRows('task_execution.outbox_event');
    expect(await createThroughEntry(envelope)).toMatchObject({ status: 'COMMITTED' });
    const aggregateOutbox = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM task_execution.outbox_event WHERE aggregate_id = $1',
      [envelope.targetRef.objectId],
    );
    expect(aggregateOutbox.rows[0]?.n).toBe(0);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });
});
