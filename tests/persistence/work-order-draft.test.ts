// IM-06 (#212): real PostgreSQL acceptance for the WorkOrder DRAFT creation
// boundary and the exact DRAFT read (`TE-P210-001`–`TE-P210-023`,
// Module-Test-003-003, Spec 003 §18.2–§18.13, approved #210 design).
//
// Every positive and negative path enters through the composition entry in
// `@zhiju/api/composition` (`createWorkOrderDraftEntry`) — the same boundary a
// transport uses: the complete registered Envelope is validated for its exact
// version, the presented AuthorizationDecision is revalidated through the
// owning IdentityPolicy Port *before* the TaskExecution idempotency claim and
// before any read fact is returned, the owning TaskExecution handler runs in
// one owning transaction and consumes the IdentityPolicy-owned
// Human-only-classification Port after the claim and before its first business
// write, and the database closes the same facts again through the V3003 guards.
// Decisions, ActorSnapshots, capability grants and Policy snapshots come from
// the owning IdentityPolicy commands; DRAFT Tasks come from the owning
// `execution.create_task` entry; nothing under test is stubbed.
//
// Row → test map, with the layer where each rejection is actually observed:
//
//   TE-P210-001  'creates the legacy DRAFT on a v1 Task'      (owning handler + V3003)
//   TE-P210-002  'creates the canonical DRAFT on a v2 Task'   (owning handler + V3003)
//   TE-P210-003  'accepts both cross-major combinations'      (owning handler)
//   TE-P210-004  'closes the creation target spelling'        (@1.1: registered Envelope;
//                                                             @1.0: IdentityPolicy Port)
//   TE-P210-005  'closes the bound Task identity'             (owning handler; RLS for
//                                                             the invisible row)
//   TE-P210-006  'records the creation-fact closures'         (V3001, one layer earlier — NOT RUN)
//   TE-P210-007  'applies the closed Task status set'         (owning handler)
//   TE-P210-008  'serializes the Task transition race'        (owning handler read lock)
//   TE-P210-009  'refuses requester substitution'             (owning handler + IdentityPolicy Port)
//   TE-P210-010  'classifies declared capabilities'           (IdentityPolicy-owned boundary port)
//   TE-P210-011  'carries the optional expiry'                (registered Envelope + owning handler)
//   TE-P210-012  'keeps cross-tenant references out'          (owning handler; RLS probe)
//   TE-P210-013  'fails closed on revoked authorization'      (IdentityPolicy Port, before the claim)
//   TE-P210-014  'scopes idempotency to one command'          (command runner)
//   TE-P210-015  'resolves concurrent creation'               (owning handler)
//   TE-P210-016  'rolls back faults and dependencies'         (owning handler + runner)
//   TE-P210-017  'rejects direct forgery at the database'     (V3003 guards, ACL, RLS)
//   TE-P210-017b 'admits a non-creator owning transition'     (PR #213 review finding 1:
//                                                             V3003 Scope-only UPDATE policy
//                                                             and immutable trigger, at the
//                                                             SQL layer — NOT RUN)
//   TE-P210-018  'records the migration facts'                (V0004/V3003 applied objects)
//   TE-P210-019  'returns the exact committed draft'          (owning query handler)
//   TE-P210-020  'refuses every read counter-example'         (owning query handler)
//   TE-P210-021  'authorizes each read version separately'    (IdentityPolicy read Port)
//   TE-P210-022  'closes the transaction context'             (platform context helpers)
//   TE-P210-023  'keeps the published surface unchanged'      (Registry/Catalog)
//
// NOT RUN inventory (branches that no legal fact can produce):
//   * TE-P210-006 — the bound Task's creation definition can never be
//     inconsistent with its creation Receipt nor unreadable: `V3001`'s
//     creation-identity guard forces `schema_version = command_version` at
//     insert, the definition snapshot is immutable afterwards, and the Task's
//     composite pointer FK only resolves to a snapshot of that very Task. The
//     test asserts those closures instead of a substitute Handler outcome.
//   * TE-P210-020 item 6 (Root↔snapshot / pointer↔payload inconsistency) — the
//     same closures make a second snapshot for one WorkOrder impossible and a
//     pointer change without a resolving `(snapshot_id, payload_hash)` pair
//     impossible, so the read can never observe an inconsistent pointer. The
//     test asserts the pointer/payload closures instead.
//   * TE-P210-017's "app-role insert with a foreign creator column" is reported
//     with the SQLSTATE the database actually raises (`42501` when the RLS
//     `WITH CHECK` wins, `22023` when the creation-identity guard does); the
//     asserted code is the observed one, never a substitute.
//   * TE-P210-017b — the owning WorkOrder lifecycle transition is not delivered
//     in this slice (V3003: the draft-pointer CAS transition "is not
//     implemented in this slice"), so PR #213's review finding 1 is exercised
//     as a database-level move that `guard_work_order_root_update()` accepts
//     (`status` plus `aggregate_version`; the draft pointer is not touched),
//     never as a delivered operation.
//   * Status values without an owning producer that this slice can reach
//     (`BACKLOG`, `READY`, `COMPLETED`, `CANCELLED`, `IN_PROGRESS`,
//     `WAITING_INPUT`, `BLOCKED`, `IN_REVIEW`, `CHANGES_REQUIRED`,
//     `COMPLETION_PENDING`) are constructed by the owner's direct SQL — the same
//     convention `tests/persistence/task-readiness.test.ts` uses for its own
//     non-`DRAFT` inputs in `TE-P206-015`. `execution.create_task` produces only
//     `DRAFT`; the only delivered transition (`execution.mark_task_ready`) needs
//     the #208 readiness-judgment chain, whose profile/evaluator Policy facts
//     belong to that slice and are not rebuilt here. The status itself is a
//     closed-set column the Root guard deliberately leaves movable, so the
//     WorkOrder handler's allowed/denied set is what each branch observes.

import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  createCreateTaskEntry,
  createWorkOrderDraftEntry,
  type CreateTaskEntry,
  type WorkOrderDraftEntry,
} from '@zhiju/api/composition';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  createTaskExecutionCreationAuthorizationPort,
  createWorkOrderDraftReadAuthorizationPort,
  grantCapability,
  HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
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
  type WorkOrderDraftReadCapabilityCodes,
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
  executeTaskExecutionCommand,
  EXECUTION_TASK_NOT_EXECUTABLE,
  EXECUTION_WORK_ORDER_ALREADY_EXISTS,
  EXECUTION_WORK_ORDER_REF_INVALID,
  GET_WORK_ORDER_DRAFT_QUERY,
  handleCreateWorkOrder,
  HUMAN_ONLY_CAPABILITY,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  TASK_DRAFT_CREATION_BINDINGS,
  WORK_ORDER_DRAFT_CREATION_BINDINGS,
  digestCanonicalPayload,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  type WorkOrderCapabilityBoundaryPort,
} from '@zhiju/task-execution';
import { ContractRegistry, type Common } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi212_probe';
const PROBE_PASSWORD = 'im06-wi212-probe';

const OPERATOR = 'bb01bb01-bb01-7b01-8b01-bb01bb01bb01';
const OPERATOR_ACTOR = 'bb02bb02-bb02-7b02-8b02-bb02bb02bb02';
const AGENT_PRINCIPAL = 'bb03bb03-bb03-7b03-8b03-bb03bb03bb03';
const AGENT_ACTOR = 'bb04bb04-bb04-7b04-8b04-bb04bb04bb04';
const SERVICE_PRINCIPAL = 'bb05bb05-bb05-7b05-8b05-bb05bb05bb05';
const SERVICE_ACTOR = 'bb06bb06-bb06-7b06-8b06-bb06bb06bb06';
const OTHER_PRINCIPAL = 'bb07bb07-bb07-7b07-8b07-bb07bb07bb07';
const OTHER_ACTOR = 'bb08bb08-bb08-7b08-8b08-bb08bb08bb08';
const REQUEST_DECISION = 'bb09bb09-bb09-7b09-8b09-bb09bb09bb09';
const CORRELATION = 'bb0abb0a-bb0a-7b0a-8b0a-bb0abb0abb0a';
const AUTH_CONTEXT_ID = 'bb0bbb0b-bb0b-7b0b-8b0b-bb0bbb0bbb0b';

const AUTH_HASH = Buffer.alloc(32, 0x61);
const AGENT_AUTH_HASH = Buffer.alloc(32, 0x62);
const SERVICE_AUTH_HASH = Buffer.alloc(32, 0x63);
const OTHER_AUTH_HASH = Buffer.alloc(32, 0x64);
const DECISION_HASH = Buffer.alloc(32, 0x65);

/**
 * Trusted composition capability codes. The values are per approved version and
 * are never equal to a Human-only code, so the classification boundary
 * classifies the *declared* codes rather than the trusted configuration.
 */
const capabilityCodes: TaskExecutionCreationCapabilityCodes = {
  taskV1: 'wi212.cap.task.v1',
  taskV2: 'wi212.cap.task.v2',
  workOrderV1: 'wi212.cap.workorder.v1',
  workOrderV11: 'wi212.cap.workorder.v1_1',
};

const readCapabilityCodes: WorkOrderDraftReadCapabilityCodes = {
  workOrderDraftReadV11: 'wi212.cap.draftread.v1_1',
  workOrderDraftReadV2: 'wi212.cap.draftread.v2',
};

const ACTIONS = {
  taskV1: 'execution.task.create.v1',
  taskV2: 'execution.task.create.v2',
  workOrderV1: 'execution.work_order.create.v1',
  workOrderV11: 'execution.work_order.create.v1_1',
  draftReadV11: 'execution.work_order.draft.read.v1_1',
  draftReadV2: 'execution.work_order.draft.read.v2',
} as const;

const TASK_V1 = 'execution.task';
const TASK_V2 = 'zhiju.execution.task';
const WORK_ORDER_V1 = 'execution.work_order';
const WORK_ORDER_V11 = 'zhiju.execution.work_order';
const ACTOR_SNAPSHOT_OBJECT = 'identity.actor_snapshot';
const ACTOR_PRINCIPAL_OBJECT = 'zhiju.identity.principal';
const AUTHENTICATION_CONTEXT_OBJECT = 'zhiju.identity.authentication_context';
const DRAFT_SNAPSHOT_OBJECT = 'zhiju.execution.work_order_draft_snapshot';

/** Owning Human-only codes (Spec 001 §15.7); declared, never trusted here. */
const HUMAN_ONLY_CODES: readonly [string, string, string] = [
  'quality.approval.decide',
  'release.authorize',
  'identity.human_only.probe',
];
const NON_HUMAN_ONLY_CODES: readonly [string, string, string] = [
  'artifact.revision.create',
  'artifact.revision.delete',
  'execution.run.start',
];

const V1_FIXTURE = new URL(
  '../fixtures/contracts/execution-create-task-command-valid.json',
  import.meta.url,
);
const V2_FIXTURE = new URL(
  '../fixtures/contracts/task-v2/create-task-v2-command-valid.json',
  import.meta.url,
);
const WORK_ORDER_CONTRACT_FIXTURE = new URL(
  '../fixtures/contracts/core/work-order-valid.json',
  import.meta.url,
);
const WORK_ORDER_BASELINE_FIXTURE = new URL(
  '../fixtures/contracts/compatibility/v1.0/positive/core/work-order.json',
  import.meta.url,
);
const PUBLIC_API_CATALOG = new URL('../../contracts/registry/public-api.v1.json', import.meta.url);
const COMPATIBILITY_BASELINE = new URL(
  '../../contracts/baselines/v1.0/operations.index.json',
  import.meta.url,
);
const V1_FROZEN_DRAFT_FIXTURE = new URL(
  '../fixtures/contracts/work-order-draft/get-work-order-draft-v2-query-valid.json',
  import.meta.url,
);

interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly otherEnterpriseId: string;
}

interface WorkOrderCreationEnvelope {
  commandId: string;
  commandType: string;
  commandVersion: string;
  scopeRef: { enterpriseId: string; projectId: string };
  targetRef: Record<string, unknown>;
  actor: Record<string, unknown>;
  authorizationDecisionRef: Common.ContentAddressedRef;
  idempotencyKey: string;
  correlationId: string;
  requestedAt: string;
  payload: Record<string, unknown>;
  integrity: { canonicalizationVersion: string; payloadHash: Common.ContentHash };
}

interface WorkOrderDraftReadEnvelope {
  queryId: string;
  queryType: string;
  queryVersion: string;
  scopeRef: { enterpriseId: string; projectId: string };
  requester: Record<string, unknown>;
  authenticationContextRef: Record<string, unknown>;
  authorizationDecisionRef: Common.ContentAddressedRef;
  consistencyRequirement: string;
  correlationId: string;
  requestedAt: string;
  payload: Record<string, unknown>;
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7a)).update(input, 'utf8').digest(),
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectRef(objectType: string, objectId: string, scope: Record<string, string>) {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

function contentHash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

function payloadOf(url: URL): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { payload: Record<string, unknown> };
  return structuredClone(fixture.payload);
}

/**
 * Rewrites every `scope` inside a published fixture onto the fixture Project.
 * The accepted Scope shapes (Platform `{}`, Enterprise and Project forms) stay
 * exactly as published; only the ids move to this suite.
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

/** One `CapabilityGrant` declaration of the WorkOrder draft shape. */
function capabilityGrant(
  capabilityType: string,
  actions: readonly string[],
  resourceSelectors: readonly string[],
  scope: Record<string, string>,
): Record<string, unknown> {
  return {
    capabilityType,
    actions: [...actions],
    resourceSelectors: [...resourceSelectors],
    constraints: [],
    expiresAt: '2026-09-01T00:00:00Z',
    grantPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.identity.policy_snapshot',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope,
    },
  };
}

function failureOf(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown };
  return {
    code: typeof value.code === 'string' ? value.code : '',
    message: typeof value.message === 'string' ? value.message : String(error),
  };
}

function resultCode(result: CommandResult): string {
  if (result.status === 'REJECTED') return result.errorCode;
  if (result.status === 'DUPLICATE') return result.errorCode ?? 'DUPLICATE';
  return 'COMMITTED';
}

describe.skipIf(!gateEnabled)('WorkOrder DRAFT creation and exact draft read', () => {
  const crypto = testCrypto();
  const registry = new ContractRegistry();
  let admin: pg.Client;
  let tePool: pg.Pool;
  let ipPool: pg.Pool;
  let epPool: pg.Pool;
  let teDb: Kysely<TaskExecutionDb>;
  let identityDb: Kysely<IdentityPolicyDb>;
  let enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  let identityRepo: IdentityPolicyRepository;
  let fixture: Fixture;
  let workOrderEntry: WorkOrderDraftEntry;
  let taskEntry: CreateTaskEntry;
  let operatorActorRef: ActorSnapshotRef;
  let agentActorRef: ActorSnapshotRef;
  let serviceActorRef: ActorSnapshotRef;
  let otherActorRef: ActorSnapshotRef;
  let otherProjectOperatorActorRef: ActorSnapshotRef;
  let policySnapshotId: string;
  let policySnapshotHash: Buffer;
  let grantWorkOrderV1: string;
  let grantDraftReadV2: string;
  let clock: number;

  /** Uniform principal description used by every helper of this suite. */
  interface Principal {
    readonly principalId: string;
    readonly principalKind: 'HUMAN' | 'AGENT' | 'SERVICE';
    readonly actorRef: ActorSnapshotRef;
    readonly authHash: Buffer;
  }

  function operator(): Principal {
    return {
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorRef: operatorActorRef,
      authHash: AUTH_HASH,
    };
  }

  function agent(): Principal {
    return {
      principalId: AGENT_PRINCIPAL,
      principalKind: 'AGENT',
      actorRef: agentActorRef,
      authHash: AGENT_AUTH_HASH,
    };
  }

  /** The same Human principal inside the second Project's actor snapshot. */
  function otherProjectOperator(): Principal {
    return {
      principalId: OPERATOR,
      principalKind: 'HUMAN',
      actorRef: otherProjectOperatorActorRef,
      authHash: AUTH_HASH,
    };
  }

  function service(): Principal {
    return {
      principalId: SERVICE_PRINCIPAL,
      principalKind: 'SERVICE',
      actorRef: serviceActorRef,
      authHash: SERVICE_AUTH_HASH,
    };
  }

  function identityContext(
    allowedProjectIds: readonly string[],
    principal: Principal = operator(),
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      actorSnapshotId: principal.actorRef.snapshotId,
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
    principal: Principal = operator(),
  ): IdentityCommandDeps {
    return {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: identityContext(allowedProjectIds, principal),
    };
  }

  function runnerContext(
    principal: Principal = operator(),
    enterpriseId: string = fixture.enterpriseId,
    projectIds: readonly string[] = [fixture.projectId],
  ): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: principal.principalId,
      principalKind: principal.principalKind,
      actorSnapshotId: principal.actorRef.snapshotId,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      policySnapshotId,
      enterpriseId,
      allowedProjectIds: projectIds,
      correlationId: CORRELATION,
    };
  }

  function entryFor(
    overrides: {
      now?: () => Date;
      createCodes?: TaskExecutionCreationCapabilityCodes;
      readCodes?: WorkOrderDraftReadCapabilityCodes;
    } = {},
  ): WorkOrderDraftEntry {
    return createWorkOrderDraftEntry({
      taskExecutionDb: teDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: overrides.createCodes ?? capabilityCodes,
      readCapabilityCodes: overrides.readCodes ?? readCapabilityCodes,
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  function taskEntryFor(overrides: { now?: () => Date } = {}): CreateTaskEntry {
    return createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes,
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  /** One real capability grant through the owning IdentityPolicy command. */
  async function grant(input: {
    principal?: Principal;
    capabilityCode: string;
    action: string;
    selectorType: 'CREATE_TARGET_TYPE' | 'TARGET_TYPE';
    targetObjectType: string;
    projectId?: string;
    enterpriseId?: string;
  }): Promise<string> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const enterpriseId = input.enterpriseId ?? fixture.enterpriseId;
    const grantId = newUuidV7();
    const result = await grantCapability(identityDeps([projectId], principal), {
      grantId,
      principalId: principal.principalId,
      capabilityCode: input.capabilityCode,
      scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
      resourceSelectors: [{ selectorType: input.selectorType, objectType: input.targetObjectType }],
      actions: [input.action],
      validFrom: new Date(clock - 60 * 60 * 1000),
      grantPolicySnapshotId: policySnapshotId,
      grantPolicySnapshotHash: policySnapshotHash,
      justification: 'IM-06 #212 creation fixture',
      idempotencyKey: `wi212:grant:${grantId}`,
    });
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  /**
   * Issues one real WorkOrder creation Decision through the owning
   * IdentityPolicy Port — the single legitimate baseline every single-variable
   * negative case starts from.
   */
  async function issueCreationDecision(input: {
    commandVersion: string;
    targetRef: Record<string, unknown>;
    payloadHash: Buffer;
    principal?: Principal;
    projectId?: string;
    now?: Date;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await port.authorizeCreation(identityDeps([projectId], principal), {
      actorSnapshotRef: principal.actorRef,
      commandType: 'execution.create_work_order',
      commandVersion: input.commandVersion,
      targetRef: input.targetRef as unknown as Common.ObjectRef,
      commandPayloadHash: input.payloadHash,
      authenticationContextHash: principal.authHash,
    });
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the creation Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  /** Issues one real DRAFT-read Decision through the owning read Port. */
  async function issueReadDecision(input: {
    queryVersion: string;
    workOrderRef: Record<string, unknown>;
    payloadHash: Buffer;
    principal?: Principal;
    projectId?: string;
    now?: Date;
    capabilityCodes?: WorkOrderDraftReadCapabilityCodes;
  }): Promise<Common.ContentAddressedRef> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const port = createWorkOrderDraftReadAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? readCapabilityCodes,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await port.authorizeWorkOrderDraftRead(identityDeps([projectId], principal), {
      actorSnapshotRef: principal.actorRef,
      commandType: GET_WORK_ORDER_DRAFT_QUERY,
      commandVersion: input.queryVersion,
      targetRef: input.workOrderRef as unknown as Common.ObjectRef,
      commandPayloadHash: input.payloadHash,
      authenticationContextHash: principal.authHash,
    });
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the read Decision was not issued');
    }
    return view.authorizationDecisionRef;
  }

  /**
   * The Core `WorkOrderDraft` / `InitialWorkOrderDraft` baseline: the published
   * Core WorkOrder contract without its contract header, with this suite's
   * Scope, this suite's bound Task and the authenticated principal as
   * `requestedBy`.
   *
   * `allowedCapabilities`/`deniedCapabilities` use non-Human-only codes so the
   * positive baselines are legal for every principal kind; the Human-only cases
   * declare the owning codes explicitly.
   */
  function workOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
    principal?: Principal;
    projectId?: string;
  }): Record<string, unknown> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const contract = JSON.parse(readFileSync(WORK_ORDER_CONTRACT_FIXTURE, 'utf8')) as Record<
      string,
      unknown
    >;
    // The contract fixture's own identity, pins and instants are rebuilt below
    // for this WorkOrder, so they are dropped before the draft is assembled.
    const omitted = [
      'header',
      'workOrderRef',
      'taskRef',
      'projectRef',
      'contextSnapshotRef',
      'issuedAt',
      'expiresAt',
      'specificationHash',
    ];
    const draft = Object.fromEntries(
      Object.entries(structuredClone(contract)).filter(([key]) => !omitted.includes(key)),
    );
    // Every reference the contract fixture declares is re-scoped to the Project
    // this draft is built for, exactly as the Task fixtures of this suite do:
    // §18.6 requires each declared reference to stay inside the Envelope Project
    // scope, so a draft assembled for another Project must not keep the main
    // fixture's Scope in its target scope, input refs, version pins, output
    // policies, evaluators or risk profile.
    rewriteFixtureScopes(draft, { ...fixture, projectId });
    const scope = { enterpriseId: fixture.enterpriseId, projectId };
    draft.taskRef = objectRef(input.taskMajor === '2.0' ? TASK_V2 : TASK_V1, input.taskId, scope);
    draft.requestedBy = {
      principalId: principal.principalId,
      principalKind: principal.principalKind,
    };
    draft.allowedCapabilities = [
      capabilityGrant(
        NON_HUMAN_ONLY_CODES[0],
        ['read', 'create'],
        ['zhiju.artifact.artifact_revision'],
        scope,
      ),
    ];
    draft.deniedCapabilities = [
      capabilityGrant(NON_HUMAN_ONLY_CODES[1], ['delete'], ['zhiju.artifact.*'], scope),
    ];
    return draft;
  }

  /** The v1.1 `InitialWorkOrderDraft`, which has no Context Contract pin. */
  function initialWorkOrderDraft(input: {
    taskId: string;
    taskMajor: '1.0' | '2.0';
    principal?: Principal;
    projectId?: string;
  }): Record<string, unknown> {
    const draft = workOrderDraft(input);
    const versionPins = { ...(draft.versionPins as Record<string, unknown>) };
    delete versionPins.projectContextContractRef;
    versionPins.contextBuilderPolicyRef = {
      ...(versionPins.contextBuilderPolicyRef as Record<string, unknown>),
      objectType: 'zhiju.identity.policy',
    };
    draft.versionPins = versionPins;
    return draft;
  }

  function draftFor(input: {
    commandVersion: string;
    taskId: string;
    taskMajor: '1.0' | '2.0';
    principal?: Principal;
    projectId?: string;
  }): Record<string, unknown> {
    return input.commandVersion === '1.1' ? initialWorkOrderDraft(input) : workOrderDraft(input);
  }

  function creationEnvelope(input: {
    commandVersion: string;
    payload: Record<string, unknown>;
    targetId: string;
    idempotencyKey: string;
    decisionRef: Common.ContentAddressedRef;
    principal?: Principal;
    projectId?: string;
    targetObjectType?: string;
    targetScope?: Record<string, string>;
  }): WorkOrderCreationEnvelope {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const scope = { enterpriseId: fixture.enterpriseId, projectId };
    const digest = digestCanonicalPayload(input.payload as CanonicalJsonObject);
    return {
      commandId: newUuidV7(),
      commandType: 'execution.create_work_order',
      commandVersion: input.commandVersion,
      scopeRef: scope,
      targetRef: objectRef(
        input.targetObjectType ?? (input.commandVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1),
        input.targetId,
        input.targetScope ?? scope,
      ),
      actor: {
        kind: 'SNAPSHOT',
        objectType: ACTOR_SNAPSHOT_OBJECT,
        objectId: principal.actorRef.snapshotId,
        snapshotId: principal.actorRef.snapshotId,
        scope,
        contentHash: principal.actorRef.contentHash,
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

  /** The single legitimate creation baseline every negative case starts from. */
  async function preparedCreation(input: {
    commandVersion: string;
    taskId: string;
    taskMajor: '1.0' | '2.0';
    idempotencyKey: string;
    principal?: Principal;
    projectId?: string;
    targetId?: string;
    expiresAt?: string | undefined;
    draft?: Record<string, unknown>;
    targetObjectType?: string;
    targetScope?: Record<string, string>;
    targetObjectId?: string;
    skipDecision?: boolean;
    payloadOverride?: Record<string, unknown>;
  }): Promise<WorkOrderCreationEnvelope> {
    const principal = input.principal ?? operator();
    const targetId = input.targetId ?? newUuidV7();
    const projectId = input.projectId ?? fixture.projectId;
    const draft =
      input.draft ??
      draftFor({
        commandVersion: input.commandVersion,
        taskId: input.taskId,
        taskMajor: input.taskMajor,
        principal,
        projectId,
      });
    // An explicit `expiresAt` is the declared instant of the command; every
    // other caller gets one future instant, so the member is always present
    // unless the caller supplies a whole payload of its own.
    const expiresAt = input.expiresAt ?? new Date(clock + 24 * 60 * 60 * 1000).toISOString();
    const payload: Record<string, unknown> = input.payloadOverride ?? { draft, expiresAt };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const decisionRef = await issueCreationDecision({
      commandVersion: input.commandVersion,
      targetRef: objectRef(
        input.targetObjectType ?? (input.commandVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1),
        input.targetObjectId ?? targetId,
        input.targetScope ?? { enterpriseId: fixture.enterpriseId, projectId },
      ),
      payloadHash: digest.hash,
      principal,
      projectId,
    });
    return creationEnvelope({
      commandVersion: input.commandVersion,
      payload,
      targetId,
      idempotencyKey: input.idempotencyKey,
      decisionRef,
      principal,
      projectId,
      ...(input.targetObjectType === undefined ? {} : { targetObjectType: input.targetObjectType }),
      ...(input.targetScope === undefined ? {} : { targetScope: input.targetScope }),
    });
  }

  /**
   * Rewrites one part of an already-authorized Envelope and keeps the integrity
   * hash truthful for the mutated payload, so the rejection under test comes
   * from the layer named by the row rather than from the integrity check.
   */
  function mutateEnvelope(
    envelope: WorkOrderCreationEnvelope,
    mutate: (envelope: WorkOrderCreationEnvelope) => void,
  ): WorkOrderCreationEnvelope {
    const next = structuredClone(envelope);
    mutate(next);
    const digest = digestCanonicalPayload(next.payload as CanonicalJsonObject);
    next.integrity = {
      canonicalizationVersion: '1',
      payloadHash: contentHash(digest.hash.toString('hex')),
    };
    return next;
  }

  function createThroughEntry(
    envelope: unknown,
    target: WorkOrderDraftEntry = workOrderEntry,
    principal: Principal = operator(),
  ): Promise<CommandResult> {
    return target.create(envelope, { authenticationContextHash: principal.authHash });
  }

  /** Drives the owning handler directly, for the branches the Schema closes. */
  function createThroughHandler(input: {
    commandVersion: string;
    targetId: string;
    payload: Record<string, unknown>;
    principal?: Principal;
    idempotencyKey?: string;
    commandId?: string;
    ports?: { capabilityBoundary: WorkOrderCapabilityBoundaryPort; now?: () => Date };
    projectId?: string;
  }): Promise<CommandResult> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const binding = WORK_ORDER_DRAFT_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === input.commandVersion,
    );
    if (binding === undefined) throw new Error('unsupported creation version');
    return handleCreateWorkOrder(
      teDb,
      runnerContext(principal),
      {
        commandId: input.commandId ?? newUuidV7(),
        commandType: 'execution.create_work_order',
        commandVersion: input.commandVersion,
        idempotencyScope: `wi212:handler:${input.commandVersion}`,
        idempotencyKey: input.idempotencyKey ?? `wi212-handler-${newUuidV7()}`,
        requestPayload: input.payload as CanonicalJsonObject,
        enterpriseId: fixture.enterpriseId,
        projectId,
        targetType: binding.workOrderObjectType,
        targetId: input.targetId,
        correlationId: CORRELATION,
        principalId: principal.principalId,
        principalKind: principal.principalKind,
        actorSnapshotId: principal.actorRef.snapshotId,
        authorizationDecisionId: REQUEST_DECISION,
        policySnapshotId,
      } satisfies CommandEnvelope,
      input.ports ?? {
        capabilityBoundary: {
          classifyDeclaredCapabilities: () =>
            Promise.resolve({
              outcome: 'VALID' as const,
              classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
            }),
        },
      },
    );
  }

  function readEnvelope(input: {
    queryVersion: string;
    workOrderRef: Record<string, unknown>;
    decisionRef: Common.ContentAddressedRef;
    principal?: Principal;
    projectId?: string;
    payloadOverride?: Record<string, unknown>;
    consistencyRequirement?: string;
  }): WorkOrderDraftReadEnvelope {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const scope = { enterpriseId: fixture.enterpriseId, projectId };
    return {
      queryId: newUuidV7(),
      queryType: GET_WORK_ORDER_DRAFT_QUERY,
      queryVersion: input.queryVersion,
      scopeRef: scope,
      requester: {
        kind: 'OBJECT',
        objectType: ACTOR_PRINCIPAL_OBJECT,
        objectId: principal.principalId,
        scope,
      },
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: AUTHENTICATION_CONTEXT_OBJECT,
        objectId: AUTH_CONTEXT_ID,
        scope,
        contentHash: contentHash(principal.authHash.toString('hex')),
      },
      authorizationDecisionRef: input.decisionRef,
      consistencyRequirement: input.consistencyRequirement ?? 'AUTHORITATIVE',
      correlationId: newUuidV7(),
      requestedAt: new Date(clock).toISOString(),
      payload: input.payloadOverride ?? { workOrderRef: input.workOrderRef },
    };
  }

  /** The single legitimate read baseline for one satisfiable read version. */
  async function preparedRead(input: {
    queryVersion: string;
    workOrderId: string;
    spelling: string;
    principal?: Principal;
    projectId?: string;
    now?: Date;
    capabilityCodes?: WorkOrderDraftReadCapabilityCodes;
    workOrderRefOverride?: Record<string, unknown>;
  }): Promise<WorkOrderDraftReadEnvelope> {
    const principal = input.principal ?? operator();
    const projectId = input.projectId ?? fixture.projectId;
    const workOrderRef =
      input.workOrderRefOverride ??
      objectRef(input.spelling, input.workOrderId, {
        enterpriseId: fixture.enterpriseId,
        projectId,
      });
    const payload = { workOrderRef };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const decisionRef = await issueReadDecision({
      queryVersion: input.queryVersion,
      workOrderRef,
      payloadHash: digest.hash,
      principal,
      projectId,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.capabilityCodes === undefined ? {} : { capabilityCodes: input.capabilityCodes }),
    });
    return readEnvelope({
      queryVersion: input.queryVersion,
      workOrderRef,
      decisionRef,
      principal,
      projectId,
    });
  }

  function readThroughEntry(
    envelope: unknown,
    target: WorkOrderDraftEntry = workOrderEntry,
    principal: Principal = operator(),
  ): Promise<CommandResult> {
    return target.read(envelope, { authenticationContextHash: principal.authHash });
  }

  // -------------------------------------------------------------------------
  // Committed-fact readers (the owning role has no business reader for these).
  // -------------------------------------------------------------------------

  async function workOrderRoot(workOrderId: string) {
    return (
      await admin.query<{
        work_order_id: string;
        enterprise_id: string;
        project_id: string;
        work_order_object_type: string;
        task_id: string;
        task_object_type: string;
        status: string;
        aggregate_version: string;
        current_draft_snapshot_id: string;
        current_draft_snapshot_hash: Buffer;
        draft_schema_version: string;
        expires_at: Date | null;
        created_by_principal_id: string;
        requested_by_principal_id: string;
      }>(
        `SELECT work_order_id, enterprise_id, project_id, work_order_object_type,
                task_id, task_object_type, status, aggregate_version::text,
                current_draft_snapshot_id, current_draft_snapshot_hash,
                draft_schema_version, expires_at, created_by_principal_id,
                requested_by_principal_id
           FROM task_execution.work_order WHERE work_order_id = $1`,
        [workOrderId],
      )
    ).rows.at(0);
  }

  async function workOrderSnapshots(workOrderId: string) {
    return (
      await admin.query<{
        snapshot_id: string;
        draft_schema_version: string;
        work_order_object_type: string;
        task_object_type: string;
        canonical_payload: Record<string, unknown>;
        payload_hash: Buffer;
        request_payload_hash: Buffer;
        source_command_id: string;
        created_by_principal_id: string;
        expires_at: Date | null;
        canonicalization_version: string;
      }>(
        `SELECT snapshot_id, draft_schema_version, work_order_object_type,
                task_object_type, canonical_payload, payload_hash,
                request_payload_hash, source_command_id, created_by_principal_id,
                expires_at, canonicalization_version
           FROM task_execution.work_order_draft_snapshot
          WHERE work_order_id = $1 ORDER BY created_at`,
        [workOrderId],
      )
    ).rows;
  }

  async function receiptRows(idempotencyKey: string) {
    return (
      await admin.query<{
        command_id: string;
        command_type: string;
        command_version: string;
        outcome: string;
        target_type: string | null;
        target_id: string | null;
        result_payload: Record<string, unknown> | null;
      }>(
        `SELECT command_id, command_type, command_version, outcome, target_type,
                target_id, result_payload
           FROM task_execution.command_receipt WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
    ).rows;
  }

  async function auditRows(commandId: string) {
    return (
      await admin.query<{
        outcome: string;
        error_code: string | null;
        safe_summary: string | null;
      }>(
        `SELECT outcome, error_code, safe_summary FROM task_execution.audit_record
          WHERE command_id = $1 ORDER BY recorded_at`,
        [commandId],
      )
    ).rows;
  }

  async function taskRow(taskId: string) {
    return (
      await admin.query<{ status: string; aggregate_version: string }>(
        `SELECT status, aggregate_version::text FROM task_execution.task WHERE task_id = $1`,
        [taskId],
      )
    ).rows.at(0);
  }

  async function setTaskStatus(taskId: string, status: string): Promise<void> {
    await admin.query('UPDATE task_execution.task SET status = $2 WHERE task_id = $1', [
      taskId,
      status,
    ]);
  }

  async function countRows(table: string): Promise<number> {
    const row = (
      await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    ).rows.at(0);
    return row?.n ?? -1;
  }

  async function edgeRows(ownerId: string) {
    return (
      await admin.query<{
        reference_path: string;
        target_object_type: string;
        target_module: string;
        owner_version_id: string;
      }>(
        `SELECT reference_path, target_object_type, target_module, owner_version_id
           FROM task_execution.reference_edge
          WHERE owner_object_id = $1 ORDER BY reference_path`,
        [ownerId],
      )
    ).rows;
  }

  // -------------------------------------------------------------------------
  // Direct-SQL probes: the app role under a trusted 11-argument context, and
  // the legacy 10-argument context V0004 keeps for backwards compatibility.
  // -------------------------------------------------------------------------

  interface AppRoleContext {
    readonly principalId?: string;
    readonly principalKind?: string;
    readonly actorSnapshotId?: string;
    readonly allowedProjectIds: readonly string[];
    readonly enterpriseId?: string;
    readonly legacy?: boolean;
  }

  async function establish(client: pg.PoolClient, context: AppRoleContext): Promise<void> {
    const parameters = [
      context.principalId ?? OPERATOR,
      context.actorSnapshotId ?? OPERATOR_ACTOR,
      REQUEST_DECISION,
      DECISION_HASH,
      new Date(clock + 60 * 60 * 1000),
      context.enterpriseId ?? fixture.enterpriseId,
      [...context.allowedProjectIds],
      CORRELATION,
    ];
    if (context.legacy === true) {
      await client.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
        parameters,
      );
      return;
    }
    await client.query(
      `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
      [
        parameters[0],
        context.principalKind ?? 'HUMAN',
        parameters[1],
        parameters[2],
        parameters[3],
        parameters[4],
        parameters[5],
        parameters[6],
        parameters[7],
      ],
    );
  }

  async function asAppRole<T>(
    pool: pg.Pool,
    role: string,
    context: AppRoleContext,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await establish(client, context);
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async function asAppRoleFailure(
    pool: pg.Pool,
    role: string,
    context: AppRoleContext,
    statement: string,
    parameters: readonly unknown[],
  ): Promise<{ code: string; message: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE platform_context_establisher');
      await establish(client, context);
      await client.query(`SET LOCAL ROLE ${role}`);
      try {
        await client.query(statement, [...parameters]);
      } catch (error) {
        const failure = failureOf(error);
        await client.query('ROLLBACK').catch(() => undefined);
        return failure;
      }
      await client.query('ROLLBACK');
      throw new Error('the statement was expected to fail but succeeded');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** One bare probe statement under the trusted 11-argument context. */
  async function appStatement(
    statement: string,
    parameters: readonly unknown[],
    context: Partial<AppRoleContext> = {},
  ): Promise<{ code: string; message: string } | null> {
    try {
      await asAppRole(
        tePool,
        'task_execution_app',
        {
          allowedProjectIds: [fixture.projectId],
          ...context,
        },
        (client) => client.query(statement, [...parameters]),
      );
      return null;
    } catch (error) {
      return failureOf(error);
    }
  }

  /**
   * The owning `execution.create_task` entry produces every Task under test.
   * The frozen v1 payload keeps its `initialAssignee`; its optional
   * `deliveryItemRef` is dropped so this suite depends on the Project fact the
   * owning EnterpriseProject Port really proves instead of on a delivery-plan
   * chain that is not part of this slice.
   *
   * `execution.create_task` commits `DRAFT`, which the §18.4 closed set refuses,
   * so the Task is then moved into the executable set. The only delivered
   * transition (`execution.mark_task_ready`) needs the #208 readiness-judgment
   * chain, whose profile/evaluator Policy facts belong to that slice; the closed
   * status column itself is therefore set through the owner, exactly as
   * `tests/persistence/task-readiness.test.ts` builds its own non-`DRAFT`
   * inputs.
   */
  async function createExecutableTask(
    commandVersion: '1.0' | '2.0',
    projectId: string = fixture.projectId,
  ): Promise<string> {
    const payload = payloadOf(commandVersion === '1.0' ? V1_FIXTURE : V2_FIXTURE);
    const projectFixture: Fixture = { ...fixture, projectId };
    rewriteFixtureScopes(payload, projectFixture);
    (payload.projectRef as Record<string, unknown>).objectId = projectId;
    delete definitionOf(payload).deliveryItemRef;
    const binding = TASK_DRAFT_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === commandVersion,
    );
    if (binding === undefined) throw new Error('unsupported Task creation version');
    const targetId = newUuidV7();
    const scope = { enterpriseId: fixture.enterpriseId, projectId };
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    const actor = projectId === fixture.projectId ? operator() : otherProjectOperator();
    const actorRef = actor.actorRef;
    const port = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes,
      now: (): Date => new Date(clock),
    });
    const view = await port.authorizeCreation(identityDeps([projectId], actor), {
      actorSnapshotRef: actorRef,
      commandType: 'execution.create_task',
      commandVersion,
      targetRef: objectRef(binding.taskObjectType, targetId, scope) as unknown as Common.ObjectRef,
      commandPayloadHash: digest.hash,
      authenticationContextHash: AUTH_HASH,
    });
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.authorizationDecisionRef === undefined) {
      throw new Error('the Task creation Decision was not issued');
    }
    const result = await taskEntry.create(
      {
        commandId: newUuidV7(),
        commandType: 'execution.create_task',
        commandVersion,
        scopeRef: scope,
        targetRef: objectRef(binding.taskObjectType, targetId, scope),
        actor: {
          kind: 'SNAPSHOT',
          objectType: ACTOR_SNAPSHOT_OBJECT,
          objectId: actorRef.snapshotId,
          snapshotId: actorRef.snapshotId,
          scope,
          contentHash: actorRef.contentHash,
        },
        authorizationDecisionRef: view.authorizationDecisionRef,
        idempotencyKey: `wi212-task-${commandVersion}-${targetId}`,
        correlationId: newUuidV7(),
        requestedAt: new Date(clock).toISOString(),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHash(digest.hash.toString('hex')),
        },
      },
      { authenticationContextHash: AUTH_HASH },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    await setTaskStatus(targetId, 'READY');
    return targetId;
  }

  /**
   * One Project row, seeded with the same convention
   * `tests/persistence/task-draft-creation.test.ts` uses for the deep
   * EnterpriseProject prerequisite of `execution.create_task`: the owning
   * Project-creation chain is not part of this slice, but the Project fact the
   * owning scope Port proves is committed by the owning role.
   */
  async function seedProjectFixture(seed: pg.Client): Promise<Fixture> {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const otherProjectId = newUuidV7();
    const otherEnterpriseId = newUuidV7();
    const hash = Buffer.alloc(32, 0x71);
    for (const [id, code, title] of [
      [projectId, 'WI212-MAIN', 'WI-212 main project'],
      [otherProjectId, 'WI212-OTHER', 'WI-212 second project'],
    ] as const) {
      const memberPolicyVersionId = newUuidV7();
      await seed.query(
        `INSERT INTO enterprise_project.project
           (project_id, enterprise_id, display_code, title, objective, status,
            member_policy_ref, member_policy_version_id, member_policy_payload_hash,
            created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
         VALUES ($1, $2, $3, $4, 'WorkOrder DRAFT acceptance fixture.', 'ACTIVE',
                 $5::jsonb, $6, $7, $8, $9, $10)`,
        [
          id,
          enterpriseId,
          code,
          title,
          JSON.stringify({
            kind: 'VERSIONED',
            objectType: 'Policy',
            objectId: newUuidV7(),
            versionId: memberPolicyVersionId,
          }),
          memberPolicyVersionId,
          hash,
          OPERATOR,
          OPERATOR_ACTOR,
          newUuidV7(),
        ],
      );
    }
    return { enterpriseId, projectId, otherProjectId, otherEnterpriseId };
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
    ipPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    epPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    teDb = createTaskExecutionDatabase(tePool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    enterpriseProjectDb = createEnterpriseProjectDatabase(epPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    clock = Date.now();
    fixture = await seedProjectFixture(admin);
    // The seed context exists before any ActorSnapshot does: the principals and
    // the grant Policy Snapshot are facts the actor snapshots later refer to.
    const seedContext: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
    };
    const seedDeps: IdentityCommandDeps = {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: seedContext,
    };

    for (const [id, principalKind, displayName] of [
      [OPERATOR, 'HUMAN', 'WI-212 operator'],
      [AGENT_PRINCIPAL, 'AGENT', 'WI-212 coordinator agent'],
      [SERVICE_PRINCIPAL, 'SERVICE', 'WI-212 process manager'],
      [OTHER_PRINCIPAL, 'HUMAN', 'WI-212 second human'],
    ] as const) {
      await withIdentityTransaction(identityDb, seedContext, (trx) =>
        identityRepo.insertPrincipal(trx, {
          id,
          principalKind,
          displayName,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        }),
      );
    }

    const policySnapshotRequest = {
      policySnapshotId: newUuidV7(),
      policySetVersion: `wi212-grant-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: new Date(clock - 60 * 60 * 1000),
      policyDocument: { rules: ['work-order-draft-authorization'], version: 1 },
      idempotencyKey: `wi212:policy:${newUuidV7()}`,
    };
    const policySnapshot = await recordPolicySnapshot(seedDeps, policySnapshotRequest);
    expect(policySnapshot.status).toBe('COMMITTED');
    policySnapshotId = policySnapshotRequest.policySnapshotId;
    const policyRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [policySnapshotId],
      )
    ).rows.at(0);
    if (policyRow === undefined) throw new Error('grant Policy Snapshot row missing');
    policySnapshotHash = policyRow.payload_hash;

    const actorSnapshot = (
      principalId: string,
      actorSnapshotId: string,
      declaredPrincipalKind: 'HUMAN' | 'AGENT' | 'SERVICE',
      authenticationContextHash: Buffer,
    ) =>
      createActorSnapshot(seedDeps, {
        actorSnapshotId,
        principalId,
        declaredPrincipalKind,
        authenticationContextHash,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      });
    operatorActorRef = await actorSnapshot(OPERATOR, OPERATOR_ACTOR, 'HUMAN', AUTH_HASH);
    agentActorRef = await actorSnapshot(AGENT_PRINCIPAL, AGENT_ACTOR, 'AGENT', AGENT_AUTH_HASH);
    serviceActorRef = await actorSnapshot(
      SERVICE_PRINCIPAL,
      SERVICE_ACTOR,
      'SERVICE',
      SERVICE_AUTH_HASH,
    );
    otherActorRef = await actorSnapshot(OTHER_PRINCIPAL, OTHER_ACTOR, 'HUMAN', OTHER_AUTH_HASH);
    otherProjectOperatorActorRef = await createActorSnapshot(
      {
        db: identityDb,
        repo: identityRepo,
        crypto,
        context: { ...seedContext, allowedProjectIds: [fixture.otherProjectId] },
      },
      {
        actorSnapshotId: newUuidV7(),
        principalId: OPERATOR,
        declaredPrincipalKind: 'HUMAN',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.otherProjectId,
      },
    );

    await grant({
      capabilityCode: capabilityCodes.taskV1,
      action: ACTIONS.taskV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V1,
    });
    await grant({
      capabilityCode: capabilityCodes.taskV2,
      action: ACTIONS.taskV2,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V2,
    });
    await grant({
      capabilityCode: capabilityCodes.taskV1,
      action: ACTIONS.taskV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: TASK_V1,
      projectId: fixture.otherProjectId,
    });
    grantWorkOrderV1 = await grant({
      capabilityCode: capabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    await grant({
      capabilityCode: capabilityCodes.workOrderV11,
      action: ACTIONS.workOrderV11,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V11,
    });
    await grant({
      capabilityCode: readCapabilityCodes.workOrderDraftReadV11,
      action: ACTIONS.draftReadV11,
      selectorType: 'TARGET_TYPE',
      targetObjectType: WORK_ORDER_V11,
    });
    grantDraftReadV2 = await grant({
      capabilityCode: readCapabilityCodes.workOrderDraftReadV2,
      action: ACTIONS.draftReadV2,
      selectorType: 'TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    // The two non-Human principals hold their own legal creation coverage; no
    // Human-only capability is ever granted to them.
    await grant({
      principal: agent(),
      capabilityCode: capabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    await grant({
      principal: service(),
      capabilityCode: capabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    await grant({
      principal: operator(),
      capabilityCode: capabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
      projectId: fixture.otherProjectId,
    });

    workOrderEntry = entryFor();
    taskEntry = taskEntryFor();
  });

  afterAll(async () => {
    await tePool.end();
    await ipPool.end();
    await epPool.end();
    await admin.end();
  });

  /**
   * One creation attempt reduced to its stable exterior, whether the trusted
   * boundary threw or the owning handler returned a rejection.
   */
  async function attemptCreation(
    envelope: unknown,
    target: WorkOrderDraftEntry = workOrderEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await createThroughEntry(envelope, target, principal);
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  /** One read attempt reduced to the same kind of stable exterior. */
  async function attemptRead(
    envelope: unknown,
    target: WorkOrderDraftEntry = workOrderEntry,
    principal: Principal = operator(),
  ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> {
    try {
      const result = await readThroughEntry(envelope, target, principal);
      return { code: resultCode(result), thrown: false, result };
    } catch (error) {
      return { code: failureOf(error).code, thrown: true };
    }
  }

  /**
   * No Root and no Snapshot, and no *successful* command fact: a Receipt may
   * exist only as the runner's own `REJECTED` record of the refusal, never as a
   * `COMMITTED` result or a `PENDING` claim. Cases whose failure happens before
   * the idempotency claim pass `'ABSENT'`.
   */
  async function expectNoWorkOrder(
    targetId: string,
    idempotencyKey?: string,
    receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
  ): Promise<void> {
    expect(await workOrderRoot(targetId)).toBeUndefined();
    expect(await workOrderSnapshots(targetId)).toEqual([]);
    if (idempotencyKey === undefined) return;
    const receipts = await receiptRows(idempotencyKey);
    if (receipt === 'ABSENT') {
      expect(receipts).toEqual([]);
      return;
    }
    expect(receipts.every((row) => row.outcome === 'REJECTED')).toBe(true);
  }

  const draftScope = (): Record<string, string> => ({
    enterpriseId: fixture.enterpriseId,
    projectId: fixture.projectId,
  });

  const workOrderRefOf = (spelling: string, objectId: string, projectId?: string) =>
    objectRef(spelling, objectId, {
      enterpriseId: fixture.enterpriseId,
      projectId: projectId ?? fixture.projectId,
    });

  it('TE-P210-001 creates the legacy WorkOrder DRAFT on a v1 Task', async () => {
    const taskId = await createExecutableTask('1.0');
    const envelope = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-001',
    });
    const targetId = envelope.targetRef.objectId as string;
    const outboxBefore = await countRows('task_execution.outbox_event');

    const result = await createThroughEntry(envelope);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (result.status !== 'COMMITTED') throw new Error('the creation did not commit');
    expect(result.resultPayload).toEqual({
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, targetId),
      status: 'DRAFT',
      aggregateVersion: '1',
    });

    const root = await workOrderRoot(targetId);
    expect(root).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '1',
      work_order_object_type: WORK_ORDER_V1,
      task_object_type: TASK_V1,
      draft_schema_version: '1.0',
      task_id: taskId,
      enterprise_id: fixture.enterpriseId,
      project_id: fixture.projectId,
      created_by_principal_id: OPERATOR,
      requested_by_principal_id: OPERATOR,
    });
    const snapshots = await workOrderSnapshots(targetId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    if (snapshot === undefined || root === undefined) throw new Error('snapshot fixture missing');
    expect(snapshot.snapshot_id).toBe(root.current_draft_snapshot_id);
    expect(snapshot.draft_schema_version).toBe('1.0');
    expect(snapshot.work_order_object_type).toBe(WORK_ORDER_V1);
    expect(snapshot.task_object_type).toBe(TASK_V1);
    expect(snapshot.created_by_principal_id).toBe(OPERATOR);
    expect(snapshot.source_command_id).toBe(envelope.commandId);
    expect(snapshot.canonicalization_version).toBe('1');
    expect(snapshot.canonical_payload).toEqual({
      snapshotId: snapshot.snapshot_id,
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, targetId),
      taskRef: workOrderRefOf(TASK_V1, taskId),
      scopeRef: draftScope(),
      draft: envelope.payload.draft,
      expiresAt: envelope.payload.expiresAt,
      capturedAt: expect.any(String),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    });
    expect(
      snapshot.payload_hash.equals(
        digestCanonicalPayload(snapshot.canonical_payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);
    expect(snapshot.payload_hash.equals(root.current_draft_snapshot_hash)).toBe(true);
    expect(
      snapshot.request_payload_hash.equals(
        digestCanonicalPayload(envelope.payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);

    expect(await edgeRows(targetId)).toEqual([
      {
        reference_path: '/draft/taskRef',
        target_object_type: TASK_V1,
        target_module: 'TaskExecution',
        owner_version_id: snapshot.snapshot_id,
      },
    ]);

    const receipts = await receiptRows('wi212-001');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      command_type: 'execution.create_work_order',
      command_version: '1.0',
      outcome: 'COMMITTED',
      target_type: WORK_ORDER_V1,
      target_id: targetId,
    });
    const audits = await auditRows(envelope.commandId);
    expect(audits.map((row) => row.outcome).sort()).toEqual(['COMMITTED', 'INFO']);
    const classification = audits.find((row) => row.outcome === 'INFO');
    expect(JSON.parse(classification?.safe_summary ?? '{}')).toEqual({
      outcome: 'VALID',
      classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
    });
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
    const aggregateOutbox = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM task_execution.outbox_event WHERE aggregate_id = $1',
      [targetId],
    );
    expect(aggregateOutbox.rows[0]?.n).toBe(0);
  });

  it('TE-P210-002 creates the canonical WorkOrder DRAFT on a v2 Task', async () => {
    const taskId = await createExecutableTask('2.0');
    const envelope = await preparedCreation({
      commandVersion: '1.1',
      taskId,
      taskMajor: '2.0',
      idempotencyKey: 'wi212-002',
    });
    const targetId = envelope.targetRef.objectId as string;
    const outboxBefore = await countRows('task_execution.outbox_event');

    const result = await createThroughEntry(envelope);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (result.status !== 'COMMITTED') throw new Error('the creation did not commit');
    expect(result.resultPayload).toMatchObject({
      workOrderRef: workOrderRefOf(WORK_ORDER_V11, targetId),
      status: 'DRAFT',
      aggregateVersion: '1',
    });

    const root = await workOrderRoot(targetId);
    expect(root).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '1',
      work_order_object_type: WORK_ORDER_V11,
      task_object_type: TASK_V2,
      draft_schema_version: '1.1',
      task_id: taskId,
    });
    const snapshots = await workOrderSnapshots(targetId);
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    if (snapshot === undefined) throw new Error('snapshot fixture missing');
    expect(snapshot.canonical_payload).toEqual({
      snapshotId: snapshot.snapshot_id,
      workOrderRef: workOrderRefOf(WORK_ORDER_V11, targetId),
      taskRef: workOrderRefOf(TASK_V2, taskId),
      scopeRef: draftScope(),
      draft: envelope.payload.draft,
      expiresAt: envelope.payload.expiresAt,
      capturedAt: expect.any(String),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    });
    const draft = record(record(snapshot.canonical_payload).draft);
    const versionPins = record(draft.versionPins);
    expect(Object.hasOwn(versionPins, 'projectContextContractRef')).toBe(false);
    expect(versionPins.contextBuilderPolicyRef).toMatchObject({
      objectType: 'zhiju.identity.policy',
    });
    expect(await edgeRows(targetId)).toEqual([
      {
        reference_path: '/draft/taskRef',
        target_object_type: TASK_V2,
        target_module: 'TaskExecution',
        owner_version_id: snapshot.snapshot_id,
      },
    ]);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });

  it('TE-P210-003 accepts both cross-major combinations', async () => {
    const v2Task = await createExecutableTask('2.0');
    const legacyOnV2 = await preparedCreation({
      commandVersion: '1.0',
      taskId: v2Task,
      taskMajor: '2.0',
      idempotencyKey: 'wi212-003-legacy-on-v2',
    });
    expect(await createThroughEntry(legacyOnV2)).toMatchObject({ status: 'COMMITTED' });
    const legacyRoot = await workOrderRoot(legacyOnV2.targetRef.objectId as string);
    expect(legacyRoot).toMatchObject({
      work_order_object_type: WORK_ORDER_V1,
      task_object_type: TASK_V2,
      task_id: v2Task,
      draft_schema_version: '1.0',
    });

    const v1Task = await createExecutableTask('1.0');
    const canonicalOnV1 = await preparedCreation({
      commandVersion: '1.1',
      taskId: v1Task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-003-canonical-on-v1',
    });
    expect(await createThroughEntry(canonicalOnV1)).toMatchObject({ status: 'COMMITTED' });
    const canonicalRoot = await workOrderRoot(canonicalOnV1.targetRef.objectId as string);
    expect(canonicalRoot).toMatchObject({
      work_order_object_type: WORK_ORDER_V11,
      task_object_type: TASK_V1,
      task_id: v1Task,
      draft_schema_version: '1.1',
    });
  });

  it('TE-P210-004 closes the creation target spelling and kind', async () => {
    const taskId = await createExecutableTask('1.0');
    // @1.1 fixes its target with the registered Envelope, so every published
    // mismatch is refused as a payload defect before any Decision is read.
    const canonical = await preparedCreation({
      commandVersion: '1.1',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-004-canonical',
    });
    for (const [label, spelling] of [
      ['legacy spelling', WORK_ORDER_V1],
      ['bare local name', 'WorkOrder'],
      ['case variant', 'zhiju.execution.WorkOrder'],
      ['prefix-stripped name', 'work_order'],
    ] as const) {
      const mutated = mutateEnvelope(canonical, (envelope) => {
        envelope.targetRef.objectType = spelling;
      });
      const attempt = await attemptCreation(mutated);
      expect(attempt.code, label).toBe(API_VALUE_INVALID);
      expect(attempt.thrown, label).toBe(true);
      await expectNoWorkOrder(mutated.targetRef.objectId as string);
    }
    const wrongKind = mutateEnvelope(canonical, (envelope) => {
      envelope.targetRef.kind = 'VERSIONED';
    });
    expect((await attemptCreation(wrongKind)).code).toBe(API_VALUE_INVALID);

    // @1.0 is a Baseline entry without `targetObjectType`, so its target is
    // closed by the IdentityPolicy creation Port instead — before the
    // idempotency claim and before any historical Receipt is returned. The
    // variants that are not even a legal `objectRef.objectType` (a bare local
    // name, an upper-case variant, a wrong `kind`) are refused one layer
    // earlier, by the registered Envelope, and that layer is named here.
    const legacy = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-004-legacy',
    });
    for (const [label, targetObjectType] of [
      ['canonical spelling', WORK_ORDER_V11],
      ['another published noun', 'execution.workorder'],
    ] as const) {
      const mutated = mutateEnvelope(legacy, (envelope) => {
        envelope.targetRef.objectType = targetObjectType;
      });
      const attempt = await attemptCreation(mutated);
      expect(attempt.code, label).toBe('IDENTITY_CREATION_TARGET_INVALID');
      expect(attempt.thrown, label).toBe(true);
      await expectNoWorkOrder(
        mutated.targetRef.objectId as string,
        mutated.idempotencyKey,
        'ABSENT',
      );
    }
    for (const [label, mutate] of [
      [
        'bare local name',
        (envelope: WorkOrderCreationEnvelope) => {
          envelope.targetRef.objectType = 'WorkOrder';
        },
      ],
      [
        'case variant',
        (envelope: WorkOrderCreationEnvelope) => {
          envelope.targetRef.objectType = 'Execution.Work_Order';
        },
      ],
      [
        'wrong kind',
        (envelope: WorkOrderCreationEnvelope) => {
          envelope.targetRef.kind = 'VERSIONED';
        },
      ],
    ] as const) {
      const mutated = mutateEnvelope(legacy, mutate);
      const attempt = await attemptCreation(mutated);
      expect(attempt.code, label).toBe(API_VALUE_INVALID);
      expect(attempt.thrown, label).toBe(true);
      await expectNoWorkOrder(
        mutated.targetRef.objectId as string,
        mutated.idempotencyKey,
        'ABSENT',
      );
    }

    // A target outside the trusted Project Scope is the same Port rejection,
    // and the creation path never reports the read path's reference code.
    const foreignScope = mutateEnvelope(legacy, (envelope) => {
      envelope.targetRef.scope = {
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.otherProjectId,
      };
    });
    const foreignAttempt = await attemptCreation(foreignScope);
    expect(foreignAttempt.code).toBe('IDENTITY_CREATION_TARGET_INVALID');
    expect(foreignAttempt.code).not.toBe(EXECUTION_WORK_ORDER_REF_INVALID);
    await expectNoWorkOrder(
      foreignScope.targetRef.objectId as string,
      foreignScope.idempotencyKey,
      'ABSENT',
    );
  });

  it('TE-P210-005 closes the bound Task identity', async () => {
    const v1Task = await createExecutableTask('1.0');

    const wrongSpelling = await preparedCreation({
      commandVersion: '1.0',
      taskId: v1Task,
      taskMajor: '2.0',
      idempotencyKey: 'wi212-005-spelling',
    });
    expect((await attemptCreation(wrongSpelling)).code).toBe('EXECUTION_TASK_REF_INVALID');
    await expectNoWorkOrder(wrongSpelling.targetRef.objectId as string, 'wi212-005-spelling');

    for (const [label, scope] of [
      ['enterprise-only Scope', { enterpriseId: fixture.enterpriseId }],
      [
        'foreign Project Scope',
        { enterpriseId: fixture.enterpriseId, projectId: fixture.otherProjectId },
      ],
      ['Platform Scope', {}],
    ] as const) {
      const draft = workOrderDraft({ taskId: v1Task, taskMajor: '1.0' });
      (draft.taskRef as Record<string, unknown>).scope = scope;
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId: v1Task,
        taskMajor: '1.0',
        idempotencyKey: `wi212-005-scope-${label}`,
        draft,
      });
      expect((await attemptCreation(envelope)).code, label).toBe('EXECUTION_TASK_REF_INVALID');
    }

    // A wrong reference kind is closed by the owning handler's own rule.
    const wrongKindDraft = workOrderDraft({ taskId: v1Task, taskMajor: '1.0' });
    (wrongKindDraft.taskRef as Record<string, unknown>).kind = 'CONTENT_ADDRESSED';
    const wrongKindResult = await createThroughHandler({
      commandVersion: '1.0',
      targetId: newUuidV7(),
      payload: {
        draft: wrongKindDraft,
        expiresAt: new Date(clock + 24 * 60 * 60 * 1000).toISOString(),
      },
      idempotencyKey: 'wi212-005-kind',
    });
    expect(resultCode(wrongKindResult)).toBe('EXECUTION_TASK_REF_INVALID');

    // A Scope-closed but invisible Task is a miss, and a never-created Task id
    // is indistinguishable from it: same code, same safe summary, no leak.
    const otherProjectTask = await createExecutableTask('1.0', fixture.otherProjectId);
    const invisible = await preparedCreation({
      commandVersion: '1.0',
      taskId: otherProjectTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-005-invisible',
    });
    const missing = await preparedCreation({
      commandVersion: '1.0',
      taskId: newUuidV7(),
      taskMajor: '1.0',
      idempotencyKey: 'wi212-005-missing',
    });
    const invisibleAttempt = await attemptCreation(invisible);
    expect(invisibleAttempt.code).toBe('NOT_FOUND');
    expect((await attemptCreation(missing)).code).toBe('NOT_FOUND');
    const summaries = await Promise.all([
      auditRows(invisible.commandId),
      auditRows(missing.commandId),
    ]);
    const rejectedSummaries = summaries.map(
      (rows) => rows.find((row) => row.outcome === 'REJECTED')?.safe_summary,
    );
    expect(rejectedSummaries[0]).toBe(rejectedSummaries[1]);
    await expectNoWorkOrder(invisible.targetRef.objectId as string, 'wi212-005-invisible');
    await expectNoWorkOrder(missing.targetRef.objectId as string, 'wi212-005-missing');
  });

  it('TE-P210-006 records the creation-fact closures instead of a substitute', async () => {
    // NOT RUN: the owning handler's `EXECUTION_DEFINITION_REF_INVALID` branch
    // (creation definition inconsistent with the creation Receipt, or
    // unreadable) has no legal fact producer. Both closures are asserted here.
    const taskId = await createExecutableTask('1.0');
    const snapshot = (
      await admin.query<{ snapshot_id: string; payload_hash: Buffer }>(
        `SELECT snapshot_id, payload_hash FROM task_execution.task_definition_snapshot
          WHERE task_id = $1`,
        [taskId],
      )
    ).rows.at(0);
    if (snapshot === undefined) throw new Error('Task definition snapshot missing');

    const relabel = await (async () => {
      try {
        await admin.query(
          `UPDATE task_execution.task_definition_snapshot SET schema_version = '2.0'
            WHERE snapshot_id = $1`,
          [snapshot.snapshot_id],
        );
        return null;
      } catch (error) {
        return failureOf(error);
      }
    })();
    expect(relabel?.code).toBe('23514');
    expect(relabel?.message).toContain('immutable');

    // The Task's composite pointer can only resolve to a snapshot of that very
    // Task, so an unreadable creation definition cannot be committed either.
    const dangling = await appStatement(
      `INSERT INTO task_execution.task
         (task_id, enterprise_id, project_id, status, aggregate_version,
          current_definition_snapshot_id, current_definition_hash, created_by_principal_id)
       VALUES ($1, $2, $3, 'DRAFT', 1, $4, $5, $6)`,
      [
        newUuidV7(),
        fixture.enterpriseId,
        fixture.projectId,
        snapshot.snapshot_id,
        snapshot.payload_hash,
        OPERATOR,
      ],
    );
    expect(dangling?.code).toBe('23503');
  });

  it('TE-P210-007 applies the closed Task status set', async () => {
    const taskId = await createExecutableTask('1.0');
    for (const status of ['DRAFT', 'BACKLOG', 'COMPLETED', 'CANCELLED'] as const) {
      await setTaskStatus(taskId, status);
      const before = await taskRow(taskId);
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-007-denied-${status}`,
      });
      const attempt = await attemptCreation(envelope);
      expect(attempt.code, status).toBe(EXECUTION_TASK_NOT_EXECUTABLE);
      await expectNoWorkOrder(envelope.targetRef.objectId as string, envelope.idempotencyKey);
      expect(await taskRow(taskId), status).toEqual(before);
    }

    const allowed = [
      'READY',
      'IN_PROGRESS',
      'WAITING_INPUT',
      'BLOCKED',
      'IN_REVIEW',
      'CHANGES_REQUIRED',
      'COMPLETION_PENDING',
    ] as const;
    for (const status of allowed) {
      await setTaskStatus(taskId, status);
      const before = await taskRow(taskId);
      const grantsBefore = await countRows('identity_policy.capability_grant');
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-007-allowed-${status}`,
      });
      const result = await createThroughEntry(envelope);
      expect(result, status).toMatchObject({ status: 'COMMITTED' });
      const root = await workOrderRoot(envelope.targetRef.objectId as string);
      expect(root?.status, status).toBe('DRAFT');
      expect(root?.aggregate_version, status).toBe('1');
      // Creation never moves the Task and never signs a capability.
      expect(await taskRow(taskId), status).toEqual(before);
      expect(await countRows('identity_policy.capability_grant'), status).toBe(grantsBefore);
    }
  });

  it('TE-P210-008 serializes the Task transition race on the dependency lock', async () => {
    /**
     * The one genuine delay of this suite. The creation's `FOR SHARE` wait is a
     * database lock state, not a promise this process exposes, so it can only
     * be observed by sampling `pg_locks` on the owning connection; the loop is
     * bounded and fails loudly instead of hanging. The 20 ms poll is a real
     * timer on purpose: deterministic time control cannot drive a lock the
     * database server owns, and awaiting an in-process signal would observe the
     * promise instead of the blocked transaction.
     */
    async function waitForBlockedCreation(): Promise<void> {
      const deadline = Date.now() + 4_000;
      for (;;) {
        const waiting = (
          await admin.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted',
          )
        ).rows.at(0);
        if ((waiting?.n ?? 0) > 0) return;
        if (Date.now() > deadline) throw new Error('the creation never blocked');
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });
      }
    }

    // The Task transition commits first and leaves the allowed set, so the
    // creation observes the committed status through its `FOR SHARE` lock.
    const racingTask = await createExecutableTask('1.0');
    await setTaskStatus(racingTask, 'READY');
    const racingEnvelope = await preparedCreation({
      commandVersion: '1.0',
      taskId: racingTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-008-transition-first',
    });
    const racer = new pg.Client({ connectionString: databaseUrl });
    await racer.connect();
    try {
      await racer.query('BEGIN');
      await racer.query(`UPDATE task_execution.task SET status = 'COMPLETED' WHERE task_id = $1`, [
        racingTask,
      ]);
      const creation = attemptCreation(racingEnvelope);
      await waitForBlockedCreation();
      await racer.query('COMMIT');
      const outcome = await creation;
      expect(outcome.code).toBe(EXECUTION_TASK_NOT_EXECUTABLE);
      expect(outcome.thrown).toBe(false);
    } finally {
      await racer.end();
    }
    await expectNoWorkOrder(
      racingEnvelope.targetRef.objectId as string,
      'wi212-008-transition-first',
    );

    // The creation commits first: the later Task transition proceeds and the
    // committed DRAFT is not rewritten by it.
    const stableTask = await createExecutableTask('1.0');
    await setTaskStatus(stableTask, 'READY');
    const stableEnvelope = await preparedCreation({
      commandVersion: '1.0',
      taskId: stableTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-008-creation-first',
    });
    expect(await createThroughEntry(stableEnvelope)).toMatchObject({ status: 'COMMITTED' });
    const workOrderId = stableEnvelope.targetRef.objectId as string;
    const committedRoot = await workOrderRoot(workOrderId);
    const committedSnapshots = await workOrderSnapshots(workOrderId);
    await admin.query(
      `UPDATE task_execution.task
          SET status = 'COMPLETED', aggregate_version = aggregate_version + 1
        WHERE task_id = $1`,
      [stableTask],
    );
    expect(await taskRow(stableTask)).toMatchObject({ status: 'COMPLETED' });
    expect(await workOrderRoot(workOrderId)).toEqual(committedRoot);
    expect(await workOrderSnapshots(workOrderId)).toEqual(committedSnapshots);

    // A transaction that crosses `expiresAt` while it holds the dependency lock
    // commits no fact at all: the trusted clock is re-sampled at the writes.
    const expiringTask = await createExecutableTask('1.0');
    await setTaskStatus(expiringTask, 'READY');
    const expiringTarget = newUuidV7();
    let samples = 0;
    const stepping = (): Date => {
      samples += 1;
      return new Date(samples === 1 ? clock : clock + 6 * 60 * 60 * 1000);
    };
    const expiringDraft = workOrderDraft({ taskId: expiringTask, taskMajor: '1.0' });
    const expiringResult = await createThroughHandler({
      commandVersion: '1.0',
      targetId: expiringTarget,
      payload: {
        draft: expiringDraft,
        expiresAt: new Date(clock + 30 * 60 * 1000).toISOString(),
      },
      idempotencyKey: 'wi212-008-expiry-crossed',
      ports: {
        capabilityBoundary: {
          classifyDeclaredCapabilities: () =>
            Promise.resolve({
              outcome: 'VALID' as const,
              classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
            }),
        },
        now: stepping,
      },
    });
    expect(expiringResult).toMatchObject({ status: 'REJECTED', errorCode: API_VALUE_INVALID });
    await expectNoWorkOrder(expiringTarget, 'wi212-008-expiry-crossed');
  });

  it('TE-P210-009 refuses requester and actor substitution without persona escalation', async () => {
    // The three constrained roles each create a DRAFT under their own identity,
    // and `requestedBy` is the authenticated principal of each of them.
    for (const principal of [operator(), agent(), service()]) {
      const taskId = await createExecutableTask('1.0');
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-009-${principal.principalKind}`,
        principal,
      });
      const result = await createThroughEntry(envelope, workOrderEntry, principal);
      expect(result, principal.principalKind).toMatchObject({ status: 'COMMITTED' });
      const targetId = envelope.targetRef.objectId as string;
      expect(await workOrderRoot(targetId)).toMatchObject({
        created_by_principal_id: principal.principalId,
        requested_by_principal_id: principal.principalId,
      });
      const snapshot = (await workOrderSnapshots(targetId))[0];
      expect(record(record(snapshot?.canonical_payload).draft).requestedBy).toEqual({
        principalId: principal.principalId,
        principalKind: principal.principalKind,
      });
    }

    // A payload that names another principal (or another kind) is refused even
    // though its Decision covers exactly that payload.
    const taskId = await createExecutableTask('1.0');
    for (const [label, requestedBy] of [
      ['another principal', { principalId: AGENT_PRINCIPAL, principalKind: 'AGENT' }],
      ['another kind', { principalId: OPERATOR, principalKind: 'AGENT' }],
    ] as const) {
      const draft = workOrderDraft({ taskId, taskMajor: '1.0' });
      draft.requestedBy = requestedBy;
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-009-substituted-${label}`,
        draft,
      });
      const attempt = await attemptCreation(envelope);
      expect(attempt.code, label).toBe(AUTHORIZATION_DECISION_INVALID);
      await expectNoWorkOrder(envelope.targetRef.objectId as string, envelope.idempotencyKey);
    }

    // The Agent cannot borrow the Human's Decision or the Human's session.
    const humanEnvelope = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-009-borrowed',
    });
    const borrowed = await attemptCreation(humanEnvelope, workOrderEntry, agent());
    expect(borrowed.code).toBe(AUTHORIZATION_DECISION_INVALID);
    await expectNoWorkOrder(
      humanEnvelope.targetRef.objectId as string,
      'wi212-009-borrowed',
      'ABSENT',
    );

    // `actingFor` and `initialAssignee` are not part of the closed WorkOrder
    // draft, so no caller can declare them at all.
    for (const [label, member] of [
      ['actingFor', { principalId: OPERATOR, principalKind: 'HUMAN' }],
      ['initialAssignee', { principalKind: 'HUMAN', roleCode: 'owner' }],
    ] as const) {
      const draft = workOrderDraft({ taskId, taskMajor: '1.0' });
      draft[label] = member;
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-009-${label}`,
        draft,
      });
      const attempt = await attemptCreation(envelope);
      expect(attempt.code, label).toBe(API_VALUE_INVALID);
      expect(attempt.thrown, label).toBe(true);
      await expectNoWorkOrder(
        envelope.targetRef.objectId as string,
        envelope.idempotencyKey,
        'ABSENT',
      );
    }
  });

  it('TE-P210-010 classifies declared capabilities by type only', async () => {
    const taskId = await createExecutableTask('1.0');
    const humanOnlyDraft = (codes: readonly string[], principal: Principal) => {
      const draft = workOrderDraft({ taskId, taskMajor: '1.0', principal });
      draft.allowedCapabilities = codes.map((code, index) =>
        capabilityGrant(
          code,
          ['read', 'create'],
          [`zhiju.artifact.artifact_revision.${index}`],
          draftScope(),
        ),
      );
      draft.deniedCapabilities = [];
      return draft;
    };

    // One Human-only capabilityType on each non-Human kind is enough.
    for (const principal of [agent(), service()]) {
      const draft = humanOnlyDraft([HUMAN_ONLY_CODES[2]], principal);
      const envelope = await preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-010-one-${principal.principalKind}`,
        draft,
        principal,
      });
      const grantsBefore = await countRows('identity_policy.capability_grant');
      const attempt = await attemptCreation(envelope, workOrderEntry, principal);
      expect(attempt.code, principal.principalKind).toBe(HUMAN_ONLY_CAPABILITY);
      await expectNoWorkOrder(envelope.targetRef.objectId as string, envelope.idempotencyKey);
      expect(await countRows('identity_policy.capability_grant')).toBe(grantsBefore);
    }

    // All Human-only types, with a repeated capabilityType whose actions and
    // resourceSelectors differ: the classification is by exact type, so the
    // structure of the element cannot change the answer.
    const allHumanOnly = [...HUMAN_ONLY_CODES, HUMAN_ONLY_CODES[0]];
    const allDraftAgent = humanOnlyDraft(allHumanOnly, agent());
    const allDraftHuman = humanOnlyDraft(allHumanOnly, operator());
    const agentAll = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-010-all-agent',
      draft: allDraftAgent,
      principal: agent(),
    });
    expect((await attemptCreation(agentAll, workOrderEntry, agent())).code).toBe(
      HUMAN_ONLY_CAPABILITY,
    );
    await expectNoWorkOrder(agentAll.targetRef.objectId as string, 'wi212-010-all-agent');

    // The same declaration from a HUMAN principal is only structurally retained.
    const humanAll = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-010-all-human',
      draft: allDraftHuman,
    });
    const humanResult = await createThroughEntry(humanAll);
    expect(humanResult, JSON.stringify(humanResult)).toMatchObject({ status: 'COMMITTED' });
    const storedDraft = record(
      record(
        (await workOrderSnapshots(humanAll.targetRef.objectId as string))[0]?.canonical_payload,
      ).draft,
    );
    expect(storedDraft.allowedCapabilities).toEqual(allDraftHuman.allowedCapabilities);

    // A self-contradicting plan is a payload defect, not an authorization
    // judgement.
    const overlapping = workOrderDraft({ taskId, taskMajor: '1.0' });
    const shared = capabilityGrant(NON_HUMAN_ONLY_CODES[2], ['start'], ['*'], draftScope());
    overlapping.allowedCapabilities = [shared];
    overlapping.deniedCapabilities = [
      capabilityGrant(NON_HUMAN_ONLY_CODES[2], ['stop'], ['*'], draftScope()),
    ];
    const overlappingEnvelope = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-010-overlap',
      draft: overlapping,
    });
    const overlapAttempt = await attemptCreation(overlappingEnvelope);
    expect(overlapAttempt.code).toBe(API_VALUE_INVALID);
    expect(overlapAttempt.thrown).toBe(false);
    await expectNoWorkOrder(overlappingEnvelope.targetRef.objectId as string, 'wi212-010-overlap');

    // An unavailable classification boundary is never an empty or accepting
    // answer.
    const unavailableTask = await createExecutableTask('1.0');
    const unavailableDraft = workOrderDraft({ taskId: unavailableTask, taskMajor: '1.0' });
    const unavailableTarget = newUuidV7();
    await expect(
      createThroughHandler({
        commandVersion: '1.0',
        targetId: unavailableTarget,
        payload: { draft: unavailableDraft },
        idempotencyKey: 'wi212-010-unavailable',
        ports: {
          capabilityBoundary: {
            classifyDeclaredCapabilities: () =>
              Promise.reject(new Error('classification boundary unavailable')),
          },
        },
      }),
    ).rejects.toMatchObject({ code: DEPENDENCY_UNAVAILABLE });
    await expectNoWorkOrder(unavailableTarget, 'wi212-010-unavailable');

    // Version attribution: the owning Port returns
    // `{outcome, classificationRegistryVersion}` and the command records that
    // pair verbatim — proven with a controlled version that is deliberately
    // *not* the owning module's constant.
    const controlledVersion = 'wi212-controlled-registry-v9';
    for (const [label, outcome] of [
      ['VALID', 'VALID'],
      ['INVALID', 'INVALID'],
    ] as const) {
      const attributionTask = await createExecutableTask('1.0');
      const attributionDraft = workOrderDraft({ taskId: attributionTask, taskMajor: '1.0' });
      const commandId = newUuidV7();
      const attributionEnvelope = {
        commandId,
        commandVersion: '1.0',
        targetId: newUuidV7(),
        payload: { draft: attributionDraft },
        principal: operator(),
        idempotencyKey: `wi212-010-attribution-${label}`,
      };
      const result = await createThroughHandler({
        ...attributionEnvelope,
        ports: {
          capabilityBoundary: {
            classifyDeclaredCapabilities: () =>
              Promise.resolve({
                outcome: outcome,
                classificationRegistryVersion: controlledVersion,
              }),
          },
        },
      });
      if (outcome === 'VALID') {
        expect(resultCode(result), label).toBe('COMMITTED');
      } else {
        expect(resultCode(result), label).toBe(HUMAN_ONLY_CAPABILITY);
      }
      const classificationAudit = (await auditRows(commandId)).find(
        (row) => row.outcome === 'INFO',
      );
      expect(JSON.parse(classificationAudit?.safe_summary ?? '{}'), label).toEqual({
        outcome,
        classificationRegistryVersion: controlledVersion,
      });
    }
  });

  it('TE-P210-011 carries the optional expiry through hash and read', async () => {
    const taskId = await createExecutableTask('1.0');

    // No `expiresAt` member at all.
    const absentDraft = workOrderDraft({ taskId, taskMajor: '1.0' });
    const absent = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-011-absent',
      payloadOverride: { draft: absentDraft },
    });
    expect(await createThroughEntry(absent)).toMatchObject({ status: 'COMMITTED' });
    const absentRoot = await workOrderRoot(absent.targetRef.objectId as string);
    expect(absentRoot?.expires_at).toBeNull();
    const absentSnapshot = (await workOrderSnapshots(absent.targetRef.objectId as string))[0];
    expect(Object.hasOwn(record(absentSnapshot?.canonical_payload), 'expiresAt')).toBe(false);
    expect(
      absentSnapshot?.request_payload_hash.equals(
        digestCanonicalPayload({ draft: absentDraft } as CanonicalJsonObject).hash,
      ),
    ).toBe(true);

    // A future instant is stored, hashed and read back verbatim.
    const expiry = new Date(clock + 3 * 60 * 60 * 1000).toISOString();
    const withExpiry = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-011-future',
      expiresAt: expiry,
    });
    expect(await createThroughEntry(withExpiry)).toMatchObject({ status: 'COMMITTED' });
    const expiryRoot = await workOrderRoot(withExpiry.targetRef.objectId as string);
    expect(expiryRoot?.expires_at?.toISOString()).toBe(expiry);
    const expirySnapshot = (await workOrderSnapshots(withExpiry.targetRef.objectId as string))[0];
    expect(record(expirySnapshot?.canonical_payload).expiresAt).toBe(expiry);
    expect(
      expirySnapshot?.request_payload_hash.equals(
        digestCanonicalPayload(withExpiry.payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);
    expect(
      expirySnapshot?.request_payload_hash.equals(
        absentSnapshot?.request_payload_hash ?? Buffer.alloc(0),
      ),
    ).toBe(false);
    const readBack = await preparedRead({
      queryVersion: '2.0',
      workOrderId: withExpiry.targetRef.objectId as string,
      spelling: WORK_ORDER_V1,
    });
    const readResult = await readThroughEntry(readBack);
    expect(readResult).toMatchObject({ status: 'COMMITTED' });
    if (readResult.status !== 'COMMITTED') throw new Error('the read did not commit');
    expect(readResult.resultPayload).toMatchObject({ expiresAt: expiry, status: 'DRAFT' });

    // The declared instant may carry more fractional digits than a JavaScript
    // `Date` can hold. The command writes the declared text into both columns,
    // so the instant survives at the precision PostgreSQL keeps instead of being
    // truncated to milliseconds, and the Root column, the Snapshot column, the
    // immutable payload member and the exact-read result agree on it.
    const microExpiry = `${new Date(clock + 5 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '')}.123456Z`;
    const micro = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-011-sub-millisecond',
      expiresAt: microExpiry,
    });
    const microResult = await createThroughEntry(micro);
    expect(microResult, JSON.stringify(microResult)).toMatchObject({ status: 'COMMITTED' });
    const microWorkOrderId = micro.targetRef.objectId as string;
    const microColumns = await admin.query<{ root: string; snapshot: string }>(
      `SELECT w.expires_at::text AS root, s.expires_at::text AS snapshot
         FROM task_execution.work_order w
         JOIN task_execution.work_order_draft_snapshot s
           ON s.work_order_id = w.work_order_id
        WHERE w.work_order_id = $1`,
      [microWorkOrderId],
    );
    const renderedDeclared = await admin.query<{ instant: string }>(
      'SELECT $1::timestamptz::text AS instant',
      [microExpiry],
    );
    expect(microColumns.rows).toHaveLength(1);
    const microRootExpiresAt = microColumns.rows[0]?.root;
    const microSnapshotExpiresAt = microColumns.rows[0]?.snapshot;
    // Both columns hold the exact declared instant: a column written from a
    // `Date`, or truncated to milliseconds, would compare unequal here.
    expect(microRootExpiresAt).toBe(renderedDeclared.rows[0]?.instant);
    expect(microRootExpiresAt).toContain('.123456');
    expect(microSnapshotExpiresAt).toBe(microRootExpiresAt);
    const microSnapshot = (await workOrderSnapshots(microWorkOrderId))[0];
    expect(record(microSnapshot?.canonical_payload).expiresAt).toBe(microExpiry);
    expect(
      microSnapshot?.request_payload_hash.equals(
        digestCanonicalPayload(micro.payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);
    const microRead = await preparedRead({
      queryVersion: '2.0',
      workOrderId: microWorkOrderId,
      spelling: WORK_ORDER_V1,
    });
    const microReadResult = await readThroughEntry(microRead);
    expect(microReadResult, JSON.stringify(microReadResult)).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { expiresAt: microExpiry, status: 'DRAFT' },
    });

    // JSON null is not the same as an absent member.
    const nullBase = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-011-null',
    });
    const nullExpiry = mutateEnvelope(nullBase, (envelope) => {
      const payload = envelope.payload;
      payload.expiresAt = null;
    });
    const nullAttempt = await attemptCreation(nullExpiry);
    expect(nullAttempt.code).toBe(API_VALUE_INVALID);
    expect(nullAttempt.thrown).toBe(true);
    await expectNoWorkOrder(nullExpiry.targetRef.objectId as string, 'wi212-011-null', 'ABSENT');

    // An instant that has already passed is a payload defect.
    const past = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-011-past',
      expiresAt: new Date(clock - 1000).toISOString(),
    });
    const pastAttempt = await attemptCreation(past);
    expect(pastAttempt.code).toBe(API_VALUE_INVALID);
    await expectNoWorkOrder(past.targetRef.objectId as string, 'wi212-011-past');

    // The boundary is exact: `now < expiresAt` must hold at the commit instant.
    const boundaryTask = await createExecutableTask('1.0');
    const boundaryDraft = workOrderDraft({ taskId: boundaryTask, taskMajor: '1.0' });
    const atNow = await createThroughHandler({
      commandVersion: '1.0',
      targetId: newUuidV7(),
      payload: { draft: boundaryDraft, expiresAt: new Date(clock).toISOString() },
      idempotencyKey: 'wi212-011-boundary-at-now',
      ports: {
        capabilityBoundary: {
          classifyDeclaredCapabilities: () =>
            Promise.resolve({
              outcome: 'VALID' as const,
              classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
            }),
        },
        now: (): Date => new Date(clock),
      },
    });
    expect(resultCode(atNow)).toBe(API_VALUE_INVALID);
    const justAfter = await createThroughHandler({
      commandVersion: '1.0',
      targetId: newUuidV7(),
      payload: { draft: boundaryDraft, expiresAt: new Date(clock + 1).toISOString() },
      idempotencyKey: 'wi212-011-boundary-just-after',
      ports: {
        capabilityBoundary: {
          classifyDeclaredCapabilities: () =>
            Promise.resolve({
              outcome: 'VALID' as const,
              classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
            }),
        },
        now: (): Date => new Date(clock),
      },
    });
    expect(resultCode(justAfter)).toBe('COMMITTED');
  });

  it('TE-P210-012 refuses cross-tenant references and stays Project-isolated', async () => {
    const taskId = await createExecutableTask('1.0');
    const crossEnterprise = {
      enterpriseId: fixture.otherEnterpriseId,
      projectId: fixture.projectId,
    };
    const crossProject = {
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.otherProjectId,
    };

    const exts = (label: string, mutate: (draft: Record<string, unknown>) => void) => {
      const draft = workOrderDraft({ taskId, taskMajor: '1.0' });
      mutate(draft);
      return preparedCreation({
        commandVersion: '1.0',
        taskId,
        taskMajor: '1.0',
        idempotencyKey: `wi212-012-${label}`,
        draft,
      });
    };

    const cases: readonly [string, (draft: Record<string, unknown>) => void][] = [
      [
        'target-scope-cross-enterprise',
        (draft) => {
          const targetScope = record(draft.targetScope);
          record((targetScope.targetObjectRefs as unknown[])[0]).scope = crossEnterprise;
        },
      ],
      [
        'target-scope-cross-project',
        (draft) => {
          const targetScope = record(draft.targetScope);
          record((targetScope.targetObjectRefs as unknown[])[0]).scope = crossProject;
        },
      ],
      [
        'input-ref-cross-project',
        (draft) => {
          const inputRefs = draft.inputRefs as Record<string, unknown>[];
          record(inputRefs[0]?.ref).scope = crossProject;
        },
      ],
      [
        'external-ref-cross-tenant',
        (draft) => {
          const inputRefs = draft.inputRefs as Record<string, unknown>[];
          if (inputRefs[0] !== undefined) {
            inputRefs[0].ref = {
              system: 'feishu',
              resourceType: 'document',
              externalId: 'wi212-external-1',
              observedAt: new Date(clock).toISOString(),
              tenantOrAccountRef: objectRef(
                'zhiju.integration.tenant',
                newUuidV7(),
                crossEnterprise,
              ),
            };
          }
        },
      ],
      [
        'version-pin-cross-enterprise',
        (draft) => {
          record(record(draft.versionPins).contextBuilderPolicyRef).scope = crossEnterprise;
        },
      ],
      [
        'acceptance-policy-cross-project',
        (draft) => {
          const outputs = draft.expectedOutputs as Record<string, unknown>[];
          record(outputs[0]?.acceptancePolicyRef).scope = crossProject;
        },
      ],
      [
        'evaluator-cross-enterprise',
        (draft) => {
          const criteria = draft.completionCriteria as Record<string, unknown>[];
          record(criteria[0]?.evaluatorRef).scope = crossEnterprise;
        },
      ],
      [
        'risk-profile-cross-project',
        (draft) => {
          record(record(draft.riskAndQuality).riskProfileRef).scope = crossProject;
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      const envelope = await exts(label, mutate);
      const attempt = await attemptCreation(envelope);
      expect(attempt.code, label).toBe('EXECUTION_WORK_ORDER_SCOPE_INVALID');
      await expectNoWorkOrder(envelope.targetRef.objectId as string, envelope.idempotencyKey);
    }

    // A same-Project external reference is accepted, so the rule above is a
    // containment rule rather than a blanket rejection of `ExternalRef`.
    const control = await exts('external-ref-in-scope', (draft) => {
      const inputRefs = draft.inputRefs as Record<string, unknown>[];
      if (inputRefs[0] !== undefined) {
        inputRefs[0].ref = {
          system: 'feishu',
          resourceType: 'document',
          externalId: 'wi212-external-2',
          observedAt: new Date(clock).toISOString(),
          tenantOrAccountRef: objectRef('zhiju.integration.tenant', newUuidV7(), draftScope()),
        };
      }
    });
    expect(await createThroughEntry(control), JSON.stringify(control)).toMatchObject({
      status: 'COMMITTED',
    });

    // RLS: another Project's Context reads none of the committed facts.
    const workOrderId = control.targetRef.objectId as string;
    const otherScope = await asAppRole(
      tePool,
      'task_execution_app',
      { allowedProjectIds: [fixture.otherProjectId] },
      async (client) => ({
        roots: (
          await client.query(
            'SELECT work_order_id FROM task_execution.work_order WHERE work_order_id = $1',
            [workOrderId],
          )
        ).rowCount,
        snapshots: (
          await client.query(
            'SELECT snapshot_id FROM task_execution.work_order_draft_snapshot WHERE work_order_id = $1',
            [workOrderId],
          )
        ).rowCount,
      }),
    );
    expect(otherScope).toEqual({ roots: 0, snapshots: 0 });
  });

  it('TE-P210-013 fails closed on revoked, drifted and replayed authorization', async () => {
    const taskId = await createExecutableTask('1.0');
    const envelope = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-013',
    });
    // Two further baselines are prepared while the Grant still covers them, so
    // the revocation below is the only variable.
    const freshKey = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-013-fresh',
    });
    const workOrderId = envelope.targetRef.objectId as string;
    expect(await createThroughEntry(envelope)).toMatchObject({ status: 'COMMITTED' });
    const snapshotsBefore = await workOrderSnapshots(workOrderId);

    const revoked = await revokeCapability(identityDeps([fixture.projectId]), {
      targetId: grantWorkOrderV1,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI212_FIXTURE_REVOKE',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi212:revoke:${grantWorkOrderV1}`,
    });
    expect(revoked.status).toBe('COMMITTED');

    // The historical Receipt is not returned while authorization fails, and a
    // fresh key writes no Receipt at all: revalidation runs before the claim.
    expect((await attemptCreation(envelope)).code).toBe(AUTHORIZATION_REVOKED);
    expect((await attemptCreation(freshKey)).code).toBe(AUTHORIZATION_REVOKED);
    await expectNoWorkOrder(freshKey.targetRef.objectId as string, 'wi212-013-fresh', 'ABSENT');

    grantWorkOrderV1 = await grant({
      capabilityCode: capabilityCodes.workOrderV1,
      action: ACTIONS.workOrderV1,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    const replayed = await createThroughEntry(envelope);
    expect(replayed).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    if (replayed.status !== 'DUPLICATE') throw new Error('expected the original Receipt');
    expect(replayed.resultPayload).toMatchObject({ status: 'DRAFT', aggregateVersion: '1' });
    expect(await workOrderSnapshots(workOrderId)).toEqual(snapshotsBefore);

    // Expired Decision, drifted trusted configuration, substituted target and
    // substituted payload each fail on their own.
    const expiredEntry = entryFor({ now: (): Date => new Date(clock + 25 * 60 * 60 * 1000) });
    expect((await attemptCreation(envelope, expiredEntry)).code).toBe(AUTHORIZATION_EXPIRED);
    const driftedEntry = entryFor({
      createCodes: { ...capabilityCodes, workOrderV1: 'wi212.cap.workorder.v1.drifted' },
    });
    expect((await attemptCreation(envelope, driftedEntry)).code).toBe(AUTHORIZATION_REVOKED);

    const substitutedTarget = mutateEnvelope(envelope, (mutated) => {
      mutated.targetRef.objectType = WORK_ORDER_V11;
    });
    expect((await attemptCreation(substitutedTarget)).code).toBe(
      'IDENTITY_CREATION_TARGET_INVALID',
    );
    const substitutedId = mutateEnvelope(envelope, (mutated) => {
      mutated.targetRef.objectId = newUuidV7();
      mutated.idempotencyKey = 'wi212-013-substituted-id';
    });
    expect((await attemptCreation(substitutedId)).code).toBe(AUTHORIZATION_DECISION_INVALID);
    await expectNoWorkOrder(
      substitutedId.targetRef.objectId as string,
      'wi212-013-substituted-id',
      'ABSENT',
    );
    const substitutedPayload = mutateEnvelope(envelope, (mutated) => {
      const draft = record(mutated.payload.draft);
      draft.objective = record(draft.objective);
      (draft.objective as Record<string, unknown>).successIntent =
        'Substituted after authorization';
      mutated.idempotencyKey = 'wi212-013-substituted-payload';
    });
    expect((await attemptCreation(substitutedPayload)).code).toBe(AUTHORIZATION_DECISION_INVALID);

    // A Decision of the other creation version never covers this envelope.
    const v11Task = await createExecutableTask('2.0');
    const v11Draft = initialWorkOrderDraft({ taskId: v11Task, taskMajor: '2.0' });
    const v11Payload = {
      draft: v11Draft,
      expiresAt: new Date(clock + 24 * 60 * 60 * 1000).toISOString(),
    };
    const v11Decision = await issueCreationDecision({
      commandVersion: '1.1',
      targetRef: workOrderRefOf(WORK_ORDER_V11, newUuidV7()),
      payloadHash: digestCanonicalPayload(v11Payload as CanonicalJsonObject).hash,
    });
    const crossVersionBase = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-013-cross-version',
    });
    const crossVersion = mutateEnvelope(crossVersionBase, (mutated) => {
      mutated.authorizationDecisionRef = v11Decision;
    });
    expect((await attemptCreation(crossVersion)).code).toBe(AUTHORIZATION_DECISION_INVALID);
    await expectNoWorkOrder(
      crossVersion.targetRef.objectId as string,
      'wi212-013-cross-version',
      'ABSENT',
    );

    // The same target again is the stable business rejection, not a second
    // creation and not a generic concurrency conflict.
    const duplicateTarget = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-013-duplicate-target',
      targetId: workOrderId,
    });
    const duplicateAttempt = await attemptCreation(duplicateTarget);
    expect(duplicateAttempt.code).toBe(EXECUTION_WORK_ORDER_ALREADY_EXISTS);
    expect(duplicateAttempt.code).not.toBe('CONCURRENCY_CONFLICT');
    expect(await workOrderSnapshots(workOrderId)).toEqual(snapshotsBefore);
  });

  it('TE-P210-014 scopes idempotency to one command identity', async () => {
    const taskId = await createExecutableTask('1.0');
    const envelope = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-014-replay',
    });
    expect(await createThroughEntry(envelope)).toMatchObject({ status: 'COMMITTED' });
    const workOrderId = envelope.targetRef.objectId as string;
    const snapshotsBefore = await workOrderSnapshots(workOrderId);
    const edgesBefore = await countRows('task_execution.reference_edge');

    const replay = await createThroughEntry(envelope);
    expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    expect(await workOrderSnapshots(workOrderId)).toEqual(snapshotsBefore);
    expect(await countRows('task_execution.reference_edge')).toBe(edgesBefore);

    // Same key, different payload: a stable conflict with a DENIED audit. The
    // changed payload carries its own legitimate Decision, so the conflict is
    // the Receipt's.
    const changedDraft = workOrderDraft({ taskId, taskMajor: '1.0' });
    const changed = await preparedCreation({
      commandVersion: '1.0',
      taskId,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-014-replay',
      targetId: workOrderId,
      draft: changedDraft,
    });
    const conflict = await attemptCreation(changed);
    expect(conflict.code).toBe(IDEMPOTENCY_PAYLOAD_CONFLICT);
    expect(await workOrderSnapshots(workOrderId)).toEqual(snapshotsBefore);
    const denied = await admin.query<{ outcome: string; error_code: string }>(
      `SELECT outcome, error_code FROM task_execution.audit_record
        WHERE error_code = $1 AND target_id = $2 ORDER BY recorded_at`,
      [IDEMPOTENCY_PAYLOAD_CONFLICT, workOrderId],
    );
    expect(denied.rows).toContainEqual({
      outcome: 'DENIED',
      error_code: IDEMPOTENCY_PAYLOAD_CONFLICT,
    });

    // Cross-version: the entry composes a per-version idempotency scope, so the
    // only way two majors can share one claim is the runner itself. With one
    // scope, one key and byte-identical payloads the persisted command identity
    // decides, and the other version's Receipt is never returned.
    const sharedKey = 'wi212-014-cross-version';
    const sharedScope = 'wi212:shared-scope';
    const sharedPayload = { draft: { taskRef: objectRef(TASK_V1, taskId, draftScope()) } };
    const runnerEnvelope = (
      commandVersion: string,
      targetObjectType: string,
      targetId: string,
    ): CommandEnvelope => ({
      commandId: newUuidV7(),
      commandType: 'execution.create_work_order',
      commandVersion,
      idempotencyScope: sharedScope,
      idempotencyKey: sharedKey,
      requestPayload: sharedPayload,
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
    const firstTarget = newUuidV7();
    const first = await executeTaskExecutionCommand(
      teDb,
      runnerContext(),
      runnerEnvelope('1.0', WORK_ORDER_V1, firstTarget),
      (): Promise<CommandBodyResult> =>
        Promise.resolve({ kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } }),
    );
    expect(first).toMatchObject({ status: 'COMMITTED' });
    const secondTarget = newUuidV7();
    const second = await executeTaskExecutionCommand(
      teDb,
      runnerContext(),
      runnerEnvelope('1.1', WORK_ORDER_V11, secondTarget),
      (): Promise<CommandBodyResult> =>
        Promise.resolve({ kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } }),
    ).catch((error: unknown) => failureOf(error));
    expect(second).toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
    expect(await workOrderRoot(secondTarget)).toBeUndefined();
    const crossVersionAudit = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM task_execution.audit_record
        WHERE error_code = $1 AND target_id = $2`,
      [IDEMPOTENCY_PAYLOAD_CONFLICT, secondTarget],
    );
    expect(crossVersionAudit.rows).toEqual([{ outcome: 'DENIED' }]);
  });

  it('TE-P210-015 resolves concurrent creation on one target', async () => {
    const sameKeyTask = await createExecutableTask('1.0');
    const sameKeyEnvelope = await preparedCreation({
      commandVersion: '1.0',
      taskId: sameKeyTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-015-same-key',
    });
    const sameKeyAttempts = await Promise.allSettled([
      createThroughEntry(sameKeyEnvelope),
      createThroughEntry(sameKeyEnvelope),
    ]);
    const committed = sameKeyAttempts.filter(
      (attempt) => attempt.status === 'fulfilled' && attempt.value.status === 'COMMITTED',
    );
    expect(committed).toHaveLength(1);
    for (const attempt of sameKeyAttempts) {
      if (attempt.status === 'rejected') {
        expect(failureOf(attempt.reason).code).toBe(COMMAND_IN_PROGRESS);
      } else if (attempt.value.status === 'DUPLICATE') {
        expect(attempt.value.originalOutcome).toBe('COMMITTED');
      }
    }
    const sameKeyTarget = sameKeyEnvelope.targetRef.objectId as string;
    expect(await workOrderSnapshots(sameKeyTarget)).toHaveLength(1);
    expect(await receiptRows('wi212-015-same-key')).toHaveLength(1);

    // Same target, different keys: exactly one winner, and the loser reports the
    // single stable code of an occupied CREATE identity.
    const contestedTarget = newUuidV7();
    const contestedTask = await createExecutableTask('1.0');
    const contenders = await Promise.all([
      preparedCreation({
        commandVersion: '1.0',
        taskId: contestedTask,
        taskMajor: '1.0',
        idempotencyKey: 'wi212-015-target-first',
        targetId: contestedTarget,
      }),
      preparedCreation({
        commandVersion: '1.0',
        taskId: contestedTask,
        taskMajor: '1.0',
        idempotencyKey: 'wi212-015-target-second',
        targetId: contestedTarget,
      }),
    ]);
    const outcomes = await Promise.all(contenders.map((item) => createThroughEntry(item)));
    expect(outcomes.filter((outcome) => outcome.status === 'COMMITTED')).toHaveLength(1);
    const losers = outcomes.filter(
      (outcome) =>
        outcome.status === 'REJECTED' && outcome.errorCode === EXECUTION_WORK_ORDER_ALREADY_EXISTS,
    );
    expect(losers).toHaveLength(1);
    expect(outcomes.some((outcome) => resultCode(outcome) === 'CONCURRENCY_CONFLICT')).toBe(false);
    expect(await workOrderSnapshots(contestedTarget)).toHaveLength(1);
    expect(await workOrderRoot(contestedTarget)).toBeDefined();

    // Several WorkOrders for one Task are legal: the Task side has no unique
    // constraint.
    const sharedTask = await createExecutableTask('1.0');
    const firstForTask = await preparedCreation({
      commandVersion: '1.0',
      taskId: sharedTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-015-shared-task-first',
    });
    const secondForTask = await preparedCreation({
      commandVersion: '1.0',
      taskId: sharedTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-015-shared-task-second',
    });
    expect(await createThroughEntry(firstForTask)).toMatchObject({ status: 'COMMITTED' });
    expect(await createThroughEntry(secondForTask)).toMatchObject({ status: 'COMMITTED' });
    expect(await workOrderSnapshots(firstForTask.targetRef.objectId as string)).toHaveLength(1);
    expect(await workOrderSnapshots(secondForTask.targetRef.objectId as string)).toHaveLength(1);
  });

  it('TE-P210-016 rolls back injected faults and unavailable dependencies', async () => {
    // An unavailable IdentityPolicy dependency is never an empty or accepting
    // answer, and it leaves no claimed Receipt behind.
    const deadUrl = new URL(databaseUrl ?? '');
    deadUrl.username = PROBE_ROLE;
    deadUrl.password = PROBE_PASSWORD;
    const deadPool = new pg.Pool({ connectionString: deadUrl.toString(), max: 1 });
    await deadPool.end();
    const unavailableEntry = createWorkOrderDraftEntry({
      taskExecutionDb: teDb,
      identity: {
        db: createIdentityPolicyDatabase(deadPool),
        repo: identityRepo,
        crypto,
      },
      capabilityCodes,
      readCapabilityCodes,
      now: (): Date => new Date(clock),
    });
    const unavailableKey = 'wi212-016-unavailable';
    const unavailableTask = await createExecutableTask('1.0');
    const unavailableDraft = workOrderDraft({ taskId: unavailableTask, taskMajor: '1.0' });
    const unavailablePayload = {
      draft: unavailableDraft,
      expiresAt: new Date(clock + 60 * 60 * 1000).toISOString(),
    };
    const unavailableDigest = digestCanonicalPayload(unavailablePayload as CanonicalJsonObject);
    const unavailableTarget = newUuidV7();
    const unavailableDecision = await issueCreationDecision({
      commandVersion: '1.0',
      targetRef: workOrderRefOf(WORK_ORDER_V1, unavailableTarget),
      payloadHash: unavailableDigest.hash,
    });
    const unavailableEnvelope = creationEnvelope({
      commandVersion: '1.0',
      payload: unavailablePayload,
      targetId: unavailableTarget,
      idempotencyKey: unavailableKey,
      decisionRef: unavailableDecision,
    });
    const unavailableAttempt = await attemptCreation(unavailableEnvelope, unavailableEntry);
    expect(unavailableAttempt.code).toBe(DEPENDENCY_UNAVAILABLE);
    await expectNoWorkOrder(unavailableTarget, unavailableKey, 'ABSENT');

    // The same key still commits normally: rejection left no PENDING Receipt.
    const recovered = await preparedCreation({
      commandVersion: '1.0',
      taskId: unavailableTask,
      taskMajor: '1.0',
      idempotencyKey: unavailableKey,
      targetId: unavailableTarget,
    });
    const recoveredResult = await createThroughEntry(recovered);
    expect(resultCode(recoveredResult), JSON.stringify(recoveredResult)).toBe('COMMITTED');

    // A fault raised after the Root and Snapshot writes leaves nothing behind.
    const faultTask = await createExecutableTask('1.0');
    const faultTarget = newUuidV7();
    const faultKey = 'wi212-016-fault';
    const faultCommandId = newUuidV7();
    const faultDraft = workOrderDraft({ taskId: faultTask, taskMajor: '1.0' });
    const faultPayload = {
      draft: faultDraft,
      expiresAt: new Date(clock + 60 * 60 * 1000).toISOString(),
    };
    const faultSnapshotId = newUuidV7();
    const faultCanonical = {
      snapshotId: faultSnapshotId,
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, faultTarget),
      taskRef: workOrderRefOf(TASK_V1, faultTask),
      scopeRef: draftScope(),
      draft: faultDraft,
      expiresAt: faultPayload.expiresAt,
      capturedAt: new Date(clock).toISOString(),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
    const faultDigest = digestCanonicalPayload(faultCanonical as CanonicalJsonObject);
    await expect(
      executeTaskExecutionCommand(
        teDb,
        runnerContext(),
        {
          commandId: faultCommandId,
          commandType: 'execution.create_work_order',
          commandVersion: '1.0',
          idempotencyScope: 'wi212:fault',
          idempotencyKey: faultKey,
          requestPayload: faultPayload as unknown as CanonicalJsonObject,
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          targetType: WORK_ORDER_V1,
          targetId: faultTarget,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId,
        } satisfies CommandEnvelope,
        async (execution) => {
          await execution.insertWorkOrderDraftRoot({
            workOrderId: faultTarget,
            workOrderObjectType: WORK_ORDER_V1,
            taskId: faultTask,
            taskObjectType: TASK_V1,
            draftSchemaVersion: '1.0',
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            currentDraftSnapshotId: faultSnapshotId,
            currentDraftSnapshotHash: faultDigest.hash,
            expiresAt: faultPayload.expiresAt,
            createdByPrincipalId: OPERATOR,
            requestedByPrincipalId: OPERATOR,
          });
          await execution.insertWorkOrderDraftSnapshot({
            snapshotId: faultSnapshotId,
            workOrderId: faultTarget,
            draftSchemaVersion: '1.0',
            workOrderObjectType: WORK_ORDER_V1,
            taskObjectType: TASK_V1,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            expiresAt: faultPayload.expiresAt,
            canonicalPayload: faultCanonical as CanonicalJsonObject,
            payloadHash: faultDigest.hash,
            requestPayloadHash: digestCanonicalPayload(faultPayload as CanonicalJsonObject).hash,
            createdByPrincipalId: OPERATOR,
            sourceCommandId: faultCommandId,
          });
          throw new Error('injected fault after the snapshot write');
        },
      ),
    ).rejects.toThrow(/injected fault after the snapshot write/);
    await expectNoWorkOrder(faultTarget, faultKey);

    const faultRecovered = await preparedCreation({
      commandVersion: '1.0',
      taskId: faultTask,
      taskMajor: '1.0',
      idempotencyKey: faultKey,
      targetId: faultTarget,
    });
    expect(await createThroughEntry(faultRecovered)).toMatchObject({ status: 'COMMITTED' });
    expect(await workOrderRoot(faultTarget)).toBeDefined();
  });

  it('TE-P210-017 rejects direct forgery at the mirror, identity, ACL and RLS guards', async () => {
    /** Writes one Root and one Snapshot inside a real claimed command. */
    interface ForgeryInput {
      readonly commandVersion: '1.0' | '1.1';
      readonly taskId: string;
      readonly taskObjectType: string;
      readonly targetId: string;
      readonly requestPayload: Record<string, unknown>;
      readonly storedPayload?: Record<string, unknown>;
      readonly principal?: Principal;
      readonly envelopeTargetType?: string;
      readonly columns?: {
        workOrderObjectType?: string;
        taskObjectType?: string;
        draftSchemaVersion?: string;
        snapshotId?: string;
        payloadHash?: Buffer;
        requestPayloadHash?: Buffer;
        expiresAt?: string | null;
        expiresAtProvided?: boolean;
        createdByPrincipalId?: string;
        requestedByPrincipalId?: string;
        currentDraftSnapshotId?: string;
        currentDraftSnapshotHash?: Buffer;
      };
      readonly sourceCommandId?: string;
    }

    async function insertForgedSnapshot(
      input: ForgeryInput,
    ): Promise<{ code: string; message: string } | null> {
      const principal = input.principal ?? operator();
      const columns = input.columns ?? {};
      const spelling = input.commandVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1;
      const requestPayload = input.requestPayload;
      const draft = record(requestPayload.draft);
      const snapshotId = columns.snapshotId ?? newUuidV7();
      const stored =
        input.storedPayload ??
        ({
          snapshotId,
          workOrderRef: workOrderRefOf(spelling, input.targetId),
          taskRef: workOrderRefOf(input.taskObjectType, input.taskId),
          scopeRef: draftScope(),
          draft,
          ...(Object.hasOwn(requestPayload, 'expiresAt')
            ? { expiresAt: requestPayload.expiresAt }
            : {}),
          capturedAt: new Date(clock).toISOString(),
          createdBy: { principalId: principal.principalId, principalKind: principal.principalKind },
        } satisfies Record<string, unknown>);
      const payloadHash =
        columns.payloadHash ?? digestCanonicalPayload(stored as CanonicalJsonObject).hash;
      const workOrderObjectType = columns.workOrderObjectType ?? spelling;
      // The faithful derivation of the Root and Snapshot expiry columns: the
      // exact declared text of the member the stored payload carries - the same
      // text production writes - unless the caller forges that dimension. A
      // fixture that left the column NULL while the payload declared an instant
      // would make every forged row fail on the expiry mirror and would hide the
      // dimension the case actually exercises.
      const storedExpiry = Object.hasOwn(stored, 'expiresAt')
        ? String(record(stored).expiresAt)
        : null;
      const forgedExpiry =
        columns.expiresAtProvided === true ? (columns.expiresAt ?? null) : storedExpiry;
      const commandId = newUuidV7();
      try {
        await executeTaskExecutionCommand(
          teDb,
          runnerContext(principal),
          {
            commandId,
            commandType: 'execution.create_work_order',
            commandVersion: input.commandVersion,
            idempotencyScope: 'wi212:forgery',
            idempotencyKey: `wi212-forgery-${commandId}`,
            requestPayload: requestPayload as unknown as CanonicalJsonObject,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            targetType: input.envelopeTargetType ?? workOrderObjectType,
            targetId: input.targetId,
            correlationId: CORRELATION,
            principalId: principal.principalId,
            principalKind: principal.principalKind,
            actorSnapshotId: principal.actorRef.snapshotId,
            authorizationDecisionId: REQUEST_DECISION,
            policySnapshotId,
          } satisfies CommandEnvelope,
          async (execution) => {
            const inserted = await execution.insertWorkOrderDraftRoot({
              workOrderId: input.targetId,
              workOrderObjectType,
              taskId: input.taskId,
              taskObjectType: columns.taskObjectType ?? input.taskObjectType,
              draftSchemaVersion: columns.draftSchemaVersion ?? input.commandVersion,
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
              currentDraftSnapshotId: columns.currentDraftSnapshotId ?? snapshotId,
              currentDraftSnapshotHash: columns.currentDraftSnapshotHash ?? payloadHash,
              expiresAt: forgedExpiry ?? undefined,
              createdByPrincipalId: columns.createdByPrincipalId ?? principal.principalId,
              requestedByPrincipalId: columns.requestedByPrincipalId ?? principal.principalId,
            });
            if (!inserted) throw new Error('the forged target already exists');
            await execution.insertWorkOrderDraftSnapshot({
              snapshotId,
              workOrderId: input.targetId,
              draftSchemaVersion: columns.draftSchemaVersion ?? input.commandVersion,
              workOrderObjectType,
              taskObjectType: columns.taskObjectType ?? input.taskObjectType,
              enterpriseId: fixture.enterpriseId,
              projectId: fixture.projectId,
              expiresAt: forgedExpiry ?? undefined,
              canonicalPayload: stored as CanonicalJsonObject,
              payloadHash,
              requestPayloadHash:
                columns.requestPayloadHash ??
                digestCanonicalPayload(requestPayload as CanonicalJsonObject).hash,
              createdByPrincipalId: columns.createdByPrincipalId ?? principal.principalId,
              sourceCommandId: input.sourceCommandId ?? commandId,
            });
            return { kind: 'COMMITTED', resultPayload: { status: 'DRAFT' } };
          },
        );
        return null;
      } catch (error) {
        return failureOf(error);
      }
    }

    const taskA = await createExecutableTask('1.0');
    const taskB = await createExecutableTask('1.0');
    const expiry = new Date(clock + 60 * 60 * 1000).toISOString();
    const requestPayload = (taskId: string) => ({
      draft: workOrderDraft({ taskId, taskMajor: '1.0' }),
      expiresAt: expiry,
    });
    const mirrorMismatch = 'work order draft snapshot promoted mirror mismatch';
    const identityMismatch = 'work order draft snapshot creation identity mismatch';
    /**
     * Both §18.7 guards can describe one forged dimension: the creation-identity
     * guard fires first (PostgreSQL runs BEFORE INSERT triggers in name order),
     * and the mirror guard owns the dimensions the identity guard leaves to it,
     * so a case that forges a shared dimension asserts the rejection under
     * either name.
     */
    const reportsGuard = (failure: { message: string } | null, ...names: string[]): boolean =>
      failure !== null && names.some((name) => failure.message.includes(name));

    // 1. The promoted WorkOrder spelling disagrees with the creation fact. Both
    // guards describe this dimension, and the creation-identity guard fires
    // first (PostgreSQL runs BEFORE INSERT triggers in name order), so that is
    // the observable layer; the mirror-specific dimensions follow below.
    const spellingForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: { workOrderObjectType: WORK_ORDER_V11 },
      envelopeTargetType: WORK_ORDER_V11,
    });
    expect(spellingForgery?.code).toBe('22023');
    expect(spellingForgery?.message).toContain(identityMismatch);

    // 2. A legacy Receipt may not carry a canonical draft schema version.
    const versionForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: {
        draftSchemaVersion: '1.1',
        workOrderObjectType: WORK_ORDER_V11,
      },
      envelopeTargetType: WORK_ORDER_V11,
    });
    expect(versionForgery?.code).toBe('22023');
    expect(reportsGuard(versionForgery, mirrorMismatch, identityMismatch)).toBe(true);

    // 3. A Scope mirror that its own payload does not carry.
    const scopeForgeryPayload = structuredClone(requestPayload(taskA));
    record(scopeForgeryPayload.draft).taskRef = workOrderRefOf(TASK_V1, taskA);
    const scopeForgeryRequest = requestPayload(taskA);
    const scopeForgeryTarget = newUuidV7();
    const scopeForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: scopeForgeryTarget,
      requestPayload: scopeForgeryRequest,
      storedPayload: {
        snapshotId: newUuidV7(),
        workOrderRef: workOrderRefOf(WORK_ORDER_V1, scopeForgeryTarget),
        taskRef: workOrderRefOf(TASK_V1, taskA),
        scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.otherProjectId },
        draft: record(scopeForgeryRequest.draft),
        expiresAt: expiry,
        capturedAt: new Date(clock).toISOString(),
        createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
      },
    });
    expect(scopeForgery?.code).toBe('22023');
    expect(reportsGuard(scopeForgery, mirrorMismatch, identityMismatch)).toBe(true);

    // 4. `expiresAt`: rewritten, added where the Root column is NULL, and
    // removed while the claimed request still carried it. The expiry member is
    // compared by both guards, so the row asserts the rejection rather than one
    // of the two names.
    const rewrittenExpiry = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: {
        expiresAtProvided: true,
        expiresAt: new Date(clock + 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(rewrittenExpiry?.code).toBe('22023');
    expect(reportsGuard(rewrittenExpiry, mirrorMismatch, identityMismatch)).toBe(true);
    const addedExpiry = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: { expiresAtProvided: true, expiresAt: null },
    });
    expect(addedExpiry?.code).toBe('22023');
    expect(reportsGuard(addedExpiry, mirrorMismatch, identityMismatch)).toBe(true);
    const removedExpiry = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      storedPayload: {
        snapshotId: newUuidV7(),
        workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
        taskRef: workOrderRefOf(TASK_V1, taskA),
        scopeRef: draftScope(),
        draft: record(requestPayload(taskA).draft),
        capturedAt: new Date(clock).toISOString(),
        createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
      },
      columns: { expiresAtProvided: true, expiresAt: null },
    });
    expect(removedExpiry?.code).toBe('22023');
    expect(reportsGuard(removedExpiry, identityMismatch, mirrorMismatch)).toBe(true);

    // 5. A content address its own bytes cannot reproduce.
    const hashForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: { payloadHash: Buffer.alloc(32, 0x45) },
    });
    expect(hashForgery?.code).toBe('22023');
    expect(reportsGuard(hashForgery, mirrorMismatch, identityMismatch)).toBe(true);

    // 6. Another internally self-consistent draft under the same in-flight
    // Receipt: every mirror passes and the creation-request projection fails.
    const otherRequest = requestPayload(taskA);
    const otherStored = {
      snapshotId: newUuidV7(),
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
      taskRef: workOrderRefOf(TASK_V1, taskA),
      scopeRef: draftScope(),
      draft: workOrderDraft({ taskId: taskA, taskMajor: '1.0' }),
      expiresAt: expiry,
      capturedAt: new Date(clock).toISOString(),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
    const projectionForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: otherRequest,
      storedPayload: otherStored,
      columns: {
        currentDraftSnapshotHash: digestCanonicalPayload(otherStored as CanonicalJsonObject).hash,
        requestPayloadHash: digestCanonicalPayload(otherStored as CanonicalJsonObject).hash,
      },
    });
    expect(projectionForgery?.code).toBe('22023');
    expect(projectionForgery?.message).toContain(identityMismatch);

    // 7. Task identity re-pointing in both directions and across majors.
    const viaTopLevel = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskB,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      storedPayload: {
        snapshotId: newUuidV7(),
        workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
        taskRef: workOrderRefOf(TASK_V1, taskB),
        scopeRef: draftScope(),
        draft: record(requestPayload(taskA).draft),
        expiresAt: expiry,
        capturedAt: new Date(clock).toISOString(),
        createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
      },
    });
    expect(viaTopLevel?.code).toBe('22023');
    expect(viaTopLevel?.message).toContain(identityMismatch);
    const viaDraft = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      storedPayload: {
        snapshotId: newUuidV7(),
        workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
        taskRef: workOrderRefOf(TASK_V1, taskA),
        scopeRef: draftScope(),
        draft: (() => {
          const draft = workOrderDraft({ taskId: taskB, taskMajor: '1.0' });
          return draft;
        })(),
        expiresAt: expiry,
        capturedAt: new Date(clock).toISOString(),
        createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
      },
    });
    expect(viaDraft?.code).toBe('22023');
    const otherMajor = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      storedPayload: (() => {
        const draft = record(requestPayload(taskA).draft);
        draft.taskRef = workOrderRefOf(TASK_V2, taskA);
        return {
          snapshotId: newUuidV7(),
          workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
          taskRef: workOrderRefOf(TASK_V1, taskA),
          scopeRef: draftScope(),
          draft,
          expiresAt: expiry,
          capturedAt: new Date(clock).toISOString(),
          createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
        };
      })(),
    });
    expect(otherMajor?.code).toBe('22023');
    expect(otherMajor?.message).toContain(identityMismatch);

    // 8. Source Receipt identity: a missing one, and a finalized one.
    const missingReceipt = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      sourceCommandId: newUuidV7(),
    });
    expect(missingReceipt?.code).toBe('22023');
    expect(missingReceipt?.message).toContain(identityMismatch);
    const committedCreation = await preparedCreation({
      commandVersion: '1.0',
      taskId: taskA,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-017-finalized-receipt',
    });
    expect(await createThroughEntry(committedCreation)).toMatchObject({ status: 'COMMITTED' });
    const finalizedReceipt = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      sourceCommandId: committedCreation.commandId,
    });
    expect(finalizedReceipt?.code).toBe('22023');
    expect(finalizedReceipt?.message).toContain(identityMismatch);

    // 9. Ownership closure: the Receipt's creator column is not the anchor, so
    // another principal's in-flight Receipt cannot be reused. The trusted
    // context carries that principal's own ActorSnapshot, and the forged
    // Receipt still names this module's creation principal and actor.
    const forgedReceiptId = newUuidV7();
    const forgedTarget = newUuidV7();
    const forgedRequestPayload = requestPayload(taskA);
    await asAppRole(
      tePool,
      'task_execution_app',
      {
        allowedProjectIds: [fixture.projectId],
        principalId: OTHER_PRINCIPAL,
        actorSnapshotId: otherActorRef.snapshotId,
      },
      (client) =>
        client.query(
          `INSERT INTO task_execution.command_receipt
             (command_id, command_type, command_version, idempotency_scope, idempotency_key,
              request_payload_hash, enterprise_id, project_id, target_type, target_id,
              outcome, correlation_id, created_by_principal_id, actor_snapshot_id,
              authorization_decision_id)
           VALUES ($1, 'execution.create_work_order', '1.0', 'wi212:forgery:p1', $2,
                   $3, $4, $5, 'execution.work_order', $6, 'PENDING', $7, $8, $9, $10)`,
          [
            forgedReceiptId,
            `wi212-forgery-p1-${forgedReceiptId}`,
            digestCanonicalPayload(forgedRequestPayload as CanonicalJsonObject).hash,
            fixture.enterpriseId,
            fixture.projectId,
            forgedTarget,
            CORRELATION,
            OPERATOR,
            OPERATOR_ACTOR,
            REQUEST_DECISION,
          ],
        ),
    );
    const foreignReceipt = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: forgedTarget,
      requestPayload: forgedRequestPayload,
      principal: agent(),
      sourceCommandId: forgedReceiptId,
    });
    expect(foreignReceipt?.code).toBe('22023');
    expect(foreignReceipt?.message).toContain(identityMismatch);

    // The payload's own `PrincipalRef`s must equal the trusted context, and a
    // forged kind is refused even when both copies agree with each other.
    for (const [label, createdBy, requestedBy] of [
      [
        'createdBy',
        { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' },
        { principalId: OPERATOR, principalKind: 'HUMAN' },
      ],
      [
        'requestedBy',
        { principalId: OPERATOR, principalKind: 'HUMAN' },
        { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' },
      ],
      [
        'forged kind',
        { principalId: OPERATOR, principalKind: 'RUNTIME' },
        { principalId: OPERATOR, principalKind: 'RUNTIME' },
      ],
    ] as const) {
      const payload = requestPayload(taskA);
      const stored = {
        snapshotId: newUuidV7(),
        workOrderRef: workOrderRefOf(WORK_ORDER_V1, newUuidV7()),
        taskRef: workOrderRefOf(TASK_V1, taskA),
        scopeRef: draftScope(),
        draft: record(payload.draft),
        expiresAt: expiry,
        capturedAt: new Date(clock).toISOString(),
        createdBy,
      };
      if (label === 'requestedBy' || label === 'forged kind') {
        record(stored.draft).requestedBy = requestedBy;
      }
      const forgery = await insertForgedSnapshot({
        commandVersion: '1.0',
        taskId: taskA,
        taskObjectType: TASK_V1,
        targetId: newUuidV7(),
        requestPayload: payload,
        storedPayload: stored,
      });
      expect(forgery?.code, label).toBe('22023');
      expect(forgery?.message, label).toContain(identityMismatch);
    }

    // A Root pointer that does not name the snapshot this command writes.
    const pointerForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: newUuidV7(),
      requestPayload: requestPayload(taskA),
      columns: {
        currentDraftSnapshotId: newUuidV7(),
        currentDraftSnapshotHash: Buffer.alloc(32, 0x46),
      },
    });
    expect(pointerForgery?.code).toBe('22023');
    expect(pointerForgery?.message).toContain(identityMismatch);

    // 10. Direct SQL: immutability, ACL, RLS and the owner-only canonicalizer.
    const committedSnapshot = (
      await workOrderSnapshots(committedCreation.targetRef.objectId as string)
    )[0];
    if (committedSnapshot === undefined) throw new Error('committed snapshot missing');
    const snapshotUpdate = await appStatement(
      'UPDATE task_execution.work_order_draft_snapshot SET payload_hash = $2 WHERE snapshot_id = $1',
      [committedSnapshot.snapshot_id, Buffer.alloc(32, 0x47)],
    );
    expect(snapshotUpdate?.code).toBe('42501');
    const snapshotDelete = await appStatement(
      'DELETE FROM task_execution.work_order_draft_snapshot WHERE snapshot_id = $1',
      [committedSnapshot.snapshot_id],
    );
    expect(snapshotDelete?.code).toBe('42501');
    const rootDelete = await appStatement(
      'DELETE FROM task_execution.work_order WHERE work_order_id = $1',
      [committedCreation.targetRef.objectId],
    );
    expect(rootDelete?.code).toBe('42501');
    const rootIdentityUpdate = await appStatement(
      'UPDATE task_execution.work_order SET enterprise_id = $2 WHERE work_order_id = $1',
      [committedCreation.targetRef.objectId, newUuidV7()],
    );
    expect(rootIdentityUpdate?.code).toBe('23514');
    expect(rootIdentityUpdate?.message).toContain('immutable');
    const pointerUpdate = await appStatement(
      `UPDATE task_execution.work_order SET current_draft_snapshot_id = $2 WHERE work_order_id = $1`,
      [committedCreation.targetRef.objectId, newUuidV7()],
    );
    expect(pointerUpdate?.code).toBe('23514');
    expect(pointerUpdate?.message).toContain('must advance the aggregate version');
    const ownerUpdate = await (async () => {
      try {
        await admin.query(
          'UPDATE task_execution.work_order_draft_snapshot SET canonical_payload = canonical_payload WHERE snapshot_id = $1',
          [committedSnapshot.snapshot_id],
        );
        return null;
      } catch (error) {
        return failureOf(error);
      }
    })();
    expect(ownerUpdate?.code).toBe('23514');
    expect(ownerUpdate?.message).toContain('immutable');

    // A Root for another Project is invisible to this Context.
    const crossProjectInsert = await appStatement(
      `INSERT INTO task_execution.work_order
         (work_order_id, enterprise_id, project_id, work_order_object_type, task_id,
          task_object_type, status, aggregate_version, current_draft_snapshot_id,
          current_draft_snapshot_hash, draft_schema_version, created_by_principal_id,
          requested_by_principal_id)
       VALUES ($1, $2, $3, 'execution.work_order', $4, 'execution.task', 'DRAFT', 1, $5, $6,
               '1.0', $7, $7)`,
      [
        newUuidV7(),
        fixture.enterpriseId,
        fixture.otherProjectId,
        taskA,
        committedSnapshot.snapshot_id,
        committedSnapshot.payload_hash,
        OPERATOR,
      ],
    );
    expect(crossProjectInsert?.code).toBe('42501');

    // The application role cannot call the owner-only canonicalizer, and it
    // can execute the request-projection helper (which reads no table).
    const canonicalizerCall = await appStatement(
      'SELECT task_execution.canonical_jsonb_text($1::jsonb)',
      ['{"a":1}'],
    );
    expect(canonicalizerCall?.code).toBe('42501');
    const projectionHelperCall = await appStatement(
      'SELECT task_execution.work_order_draft_request_hash($1::jsonb)',
      ['{"draft":{}}'],
    );
    expect(projectionHelperCall).toBeNull();

    // A payload whose property names collide after NFC normalization cannot
    // define a content address. The request path is closed client-side: the
    // Runner canonicalizes the request before its first statement, so a
    // colliding request payload never reaches a table (asserted here). The
    // database closure is therefore reached the way every other forged row of
    // this row is reached - a stored payload that forged its content address -
    // and the observable layer is the owner-only canonicalizer inside V3003's
    // creation-identity guard, which recomputes the creation-request projection
    // from the stored bytes and raises the canonicalization SQLSTATE itself.
    const collidingDraft = workOrderDraft({ taskId: taskA, taskMajor: '1.0' });
    record(collidingDraft.targetScope)['é'] = 'nfc';
    record(collidingDraft.targetScope)['e\u0301'] = 'nfd';
    const collisionPayload = { draft: collidingDraft, expiresAt: expiry };
    expect(() => digestCanonicalPayload(collisionPayload as CanonicalJsonObject)).toThrow(
      /collide after NFC normalization/,
    );
    const collisionTarget = newUuidV7();
    const collisionStored = {
      snapshotId: newUuidV7(),
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, collisionTarget),
      taskRef: workOrderRefOf(TASK_V1, taskA),
      scopeRef: draftScope(),
      draft: collidingDraft,
      expiresAt: expiry,
      capturedAt: new Date(clock).toISOString(),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
    const collisionForgery = await insertForgedSnapshot({
      commandVersion: '1.0',
      taskId: taskA,
      taskObjectType: TASK_V1,
      targetId: collisionTarget,
      // The request is canonicalizable, so the claim the guard compares against
      // is the true projection of it; the only false dimension of this row is
      // the stored payload the canonicalizer cannot render.
      requestPayload: requestPayload(taskA),
      storedPayload: collisionStored,
      columns: { payloadHash: Buffer.alloc(32, 0x48) },
    });
    expect(collisionForgery?.code).toBe('22023');
    expect(collisionForgery?.message).toContain('collide after NFC normalization');

    // A 10-argument legacy Context can never write a WorkOrder: the trusted
    // kind is NULL, so the creation-identity guard rejects the snapshot.
    const legacyTarget = newUuidV7();
    const legacyTask = await createExecutableTask('1.0');
    const legacyDraft = workOrderDraft({ taskId: legacyTask, taskMajor: '1.0' });
    const legacyRequest = { draft: legacyDraft, expiresAt: expiry };
    const legacySnapshotId = newUuidV7();
    const legacyStored = {
      snapshotId: legacySnapshotId,
      workOrderRef: workOrderRefOf(WORK_ORDER_V1, legacyTarget),
      taskRef: workOrderRefOf(TASK_V1, legacyTask),
      scopeRef: draftScope(),
      draft: legacyDraft,
      expiresAt: expiry,
      capturedAt: new Date(clock).toISOString(),
      createdBy: { principalId: OPERATOR, principalKind: 'HUMAN' },
    };
    const legacyDigest = digestCanonicalPayload(legacyStored as CanonicalJsonObject).hash;
    const legacyReceiptId = newUuidV7();
    const legacyFailure = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await establish(client, { allowedProjectIds: [fixture.projectId], legacy: true });
        await client.query('SET LOCAL ROLE task_execution_app');
        try {
          await client.query(
            `INSERT INTO task_execution.command_receipt
               (command_id, command_type, command_version, idempotency_scope, idempotency_key,
                request_payload_hash, enterprise_id, project_id, target_type, target_id,
                outcome, correlation_id, created_by_principal_id, actor_snapshot_id,
                authorization_decision_id)
             VALUES ($1, 'execution.create_work_order', '1.0', 'wi212:forgery:legacy', $2, $3,
                     $4, $5, 'execution.work_order', $6, 'PENDING', $7, $8, $9, $10)`,
            [
              legacyReceiptId,
              `wi212-forgery-legacy-${legacyReceiptId}`,
              digestCanonicalPayload(legacyRequest as CanonicalJsonObject).hash,
              fixture.enterpriseId,
              fixture.projectId,
              legacyTarget,
              CORRELATION,
              OPERATOR,
              OPERATOR_ACTOR,
              REQUEST_DECISION,
            ],
          );
          await client.query(
            `INSERT INTO task_execution.work_order
               (work_order_id, enterprise_id, project_id, work_order_object_type, task_id,
                task_object_type, status, aggregate_version, current_draft_snapshot_id,
                current_draft_snapshot_hash, draft_schema_version, expires_at,
                created_by_principal_id, requested_by_principal_id)
             VALUES ($1, $2, $3, 'execution.work_order', $4, 'execution.task', 'DRAFT', 1, $5, $6,
                     '1.0', $7, $8, $8)`,
            [
              legacyTarget,
              fixture.enterpriseId,
              fixture.projectId,
              legacyTask,
              legacySnapshotId,
              legacyDigest,
              new Date(expiry),
              OPERATOR,
            ],
          );
          await client.query(
            `INSERT INTO task_execution.work_order_draft_snapshot
               (snapshot_id, work_order_id, draft_schema_version, work_order_object_type,
                task_object_type, enterprise_id, project_id, expires_at, canonical_payload,
                payload_hash, request_payload_hash, source_command_id, created_by_principal_id)
             VALUES ($1, $2, '1.0', 'execution.work_order', 'execution.task', $3, $4, $5,
                     $6::jsonb, $7, $8, $9, $10)`,
            [
              legacySnapshotId,
              legacyTarget,
              fixture.enterpriseId,
              fixture.projectId,
              new Date(expiry),
              JSON.stringify(legacyStored),
              legacyDigest,
              digestCanonicalPayload(legacyRequest as CanonicalJsonObject).hash,
              legacyReceiptId,
              OPERATOR,
            ],
          );
          await client.query('ROLLBACK');
          return null;
        } catch (error) {
          const failure = failureOf(error);
          await client.query('ROLLBACK').catch(() => undefined);
          return failure;
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(legacyFailure?.code).toBe('22023');
    expect(legacyFailure?.message).toContain(identityMismatch);
    await expectNoWorkOrder(legacyTarget);
  });

  it('TE-P210-017b admits a non-creator owning transition while attribution stays unwritable', async () => {
    // PR #213 independent review, round 1, finding 1: `work_order_update` in
    // V3003 must stay Scope-only. Creation attribution is not object ownership,
    // so a later principal other than the creator must be able to move the Root
    // under its own Project Scope, and the immutable
    // `guard_work_order_root_update()` trigger — not RLS — is what keeps
    // `created_by_principal_id`/`requested_by_principal_id` from changing.
    //
    // V3005 requires a real frozen Contract for READY. Advance only the
    // version here to prove the original Scope-only UPDATE policy still
    // admits a non-creator. The owning Freeze transition is covered by
    // TE-VAL-S-008; this remains an RLS/attribution test.
    // Every assertion of this row is observed at that SQL layer.
    const secondHuman: Principal = {
      principalId: OTHER_PRINCIPAL,
      principalKind: 'HUMAN',
      actorRef: otherActorRef,
      authHash: OTHER_AUTH_HASH,
    };
    const secondHumanContext = {
      principalId: secondHuman.principalId,
      principalKind: secondHuman.principalKind,
      actorSnapshotId: secondHuman.actorRef.snapshotId,
      allowedProjectIds: [fixture.projectId],
    };
    const creation = await preparedCreation({
      commandVersion: '1.0',
      taskId: await createExecutableTask('1.0'),
      taskMajor: '1.0',
      idempotencyKey: 'wi212-017b-non-creator-transition',
    });
    const workOrderId = creation.targetRef.objectId as string;

    // 1. Principal A (the operator) creates the DRAFT through the composition
    // entry, so A owns this Root's creation attribution.
    expect(await createThroughEntry(creation)).toMatchObject({ status: 'COMMITTED' });
    expect(await workOrderRoot(workOrderId)).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '1',
      created_by_principal_id: OPERATOR,
      requested_by_principal_id: OPERATOR,
    });

    // 2. Principal B (a different Human) moves the Root under B's own legal
    // Project Context. `rowCount = 1` is the whole point: the UPDATE policy
    // admitted the row to a principal that did not create it. A `rowCount` of 0
    // would be the review's finding — RLS filtering on creation attribution —
    // still present; the read-back below distinguishes that from "silently
    // filtered" by observing the stored transition itself.
    const transition = await asAppRole(
      tePool,
      'task_execution_app',
      secondHumanContext,
      async (client) => {
        const context = await client.query<{
          principal_id: string | null;
          principal_kind: string | null;
        }>(
          `SELECT platform_security.context_principal_id()::text AS principal_id,
                  platform_security.context_principal_kind() AS principal_kind`,
        );
        const updated = await client.query(
          `UPDATE task_execution.work_order
              SET aggregate_version = aggregate_version + 1
            WHERE work_order_id = $1`,
          [workOrderId],
        );
        return { context: context.rows.at(0), rowCount: updated.rowCount };
      },
    );
    expect(transition.context?.principal_id).toBe(OTHER_PRINCIPAL);
    expect(transition.context?.principal_kind).toBe('HUMAN');
    expect(transition.rowCount).toBe(1);
    // The stored row carries B's transition with A's creation attribution: B's
    // principal is written into neither attribution column.
    expect(await workOrderRoot(workOrderId)).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '2',
      created_by_principal_id: OPERATOR,
      requested_by_principal_id: OPERATOR,
    });

    // The same movable statement under a Context that may not see this Project
    // is still filtered, so the admitted row above is the Project Scope
    // admitting a non-creator rather than an UPDATE policy that stopped
    // filtering at all.
    const foreignProjectTransition = await asAppRole(
      tePool,
      'task_execution_app',
      {
        principalId: OPERATOR,
        actorSnapshotId: otherProjectOperatorActorRef.snapshotId,
        allowedProjectIds: [fixture.otherProjectId],
      },
      (client) =>
        client.query(
          `UPDATE task_execution.work_order
              SET status = 'DRAFT', aggregate_version = aggregate_version + 1
            WHERE work_order_id = $1`,
          [workOrderId],
        ),
    );
    expect(foreignProjectTransition.rowCount).toBe(0);
    expect(await workOrderRoot(workOrderId)).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '2',
    });

    // 3. Creation attribution stays unwritable. Both rewrites run under B's own
    // Context — the principal that just moved the Root — and pass the
    // Scope-only UPDATE policy, so the layer left to reject them is the
    // immutable root-update trigger alone.
    for (const column of ['created_by_principal_id', 'requested_by_principal_id'] as const) {
      const rewrite = await asAppRoleFailure(
        tePool,
        'task_execution_app',
        secondHumanContext,
        `UPDATE task_execution.work_order SET ${column} = $2 WHERE work_order_id = $1`,
        [workOrderId, OTHER_PRINCIPAL],
      );
      expect(rewrite.code, column).toBe('23514');
      expect(rewrite.message, column).toContain('immutable');
    }
    expect(await workOrderRoot(workOrderId)).toMatchObject({
      status: 'DRAFT',
      aggregate_version: '2',
      created_by_principal_id: OPERATOR,
      requested_by_principal_id: OPERATOR,
    });
  });

  it('TE-P210-018 records the migration facts of the principal-kind increment', async () => {
    const triggers = await admin.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid IN ('task_execution.work_order'::regclass,
                          'task_execution.work_order_draft_snapshot'::regclass)
          AND NOT tgisinternal
        ORDER BY tgname`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'first_run_work_order_transition_guard',
      'work_order_draft_snapshot_creation_identity_guard',
      'work_order_draft_snapshot_immutable_guard',
      'work_order_draft_snapshot_mirror_guard',
      'work_order_root_update_guard',
    ]);
    const policies = await admin.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid IN ('task_execution.work_order'::regclass,
                           'task_execution.work_order_draft_snapshot'::regclass)
        ORDER BY polname`,
    );
    expect(policies.rows.map((row) => row.polname)).toEqual([
      'work_order_draft_snapshot_insert',
      'work_order_draft_snapshot_select',
      'work_order_insert',
      'work_order_select',
      'work_order_update',
    ]);
    const rls = await admin.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname IN ('work_order', 'work_order_draft_snapshot')
        ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: 'work_order', enabled: true, forced: true },
      { relname: 'work_order_draft_snapshot', enabled: true, forced: true },
    ]);

    // Every on-disk migration was applied exactly once and none failed, so the
    // second `flyway migrate` of the gate has nothing left to do and a failed
    // migration left no partial history.
    const history = await admin.query<{ version: string; success: boolean; checksum: number }>(
      'SELECT version, success, checksum FROM public.flyway_schema_history ORDER BY installed_rank',
    );
    expect(history.rows.length).toBeGreaterThan(0);
    expect(history.rows.every((row) => row.success)).toBe(true);
    const onDisk = readdirSync(new URL('../../migrations', import.meta.url).pathname, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(new URL(`../../migrations/${entry.name}`, import.meta.url).pathname)
          .filter((file) => /^V\d+__.*\.sql$/u.test(file))
          .map((file) => file.slice(1, file.indexOf('__'))),
      );
    expect([...history.rows.map((row) => row.version)].sort()).toEqual([...new Set(onDisk)].sort());
    for (const version of ['0003', '3000', '3001', '3002']) {
      expect(
        history.rows.find((row) => row.version === version),
        version,
      ).toMatchObject({ success: true });
    }

    // V0004: the legacy entry point keeps working and writes a NULL kind; the
    // trusted entry point writes the exact kind; a missing or unknown kind and
    // a mixed pair of entries are platform failures.
    async function contextProbe(): Promise<{ code: string | null; kind: string | null }> {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await establish(client, { allowedProjectIds: [fixture.projectId] });
        // The kind helper is granted to the module roles, not to the
        // establisher; the probe role is NOINHERIT, so it must switch roles.
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return { code: null, kind: row.rows.at(0)?.kind ?? null };
      } catch (error) {
        return { code: failureOf(error).code, kind: null };
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    const withoutContext = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return row.rows.at(0)?.kind;
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(withoutContext).toBeNull();

    const trustedKind = await contextProbe();
    expect(trustedKind).toEqual({ code: null, kind: 'HUMAN' });

    async function establishProbe(
      statements: readonly (readonly unknown[])[],
    ): Promise<{ code: string | null; kind: string | null }> {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        for (const parameters of statements) {
          await client.query(
            `SELECT platform_security.establish_transaction_context(
               'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
            [...parameters],
          );
        }
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return { code: null, kind: row.rows.at(0)?.kind ?? null };
      } catch (error) {
        return { code: failureOf(error).code, kind: null };
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    const trustedParameters = [
      OPERATOR,
      'HUMAN',
      OPERATOR_ACTOR,
      REQUEST_DECISION,
      DECISION_HASH,
      new Date(clock + 60 * 60 * 1000),
      fixture.enterpriseId,
      [fixture.projectId],
      CORRELATION,
    ] as const;
    const agentParameters = [
      AGENT_PRINCIPAL,
      'AGENT',
      AGENT_ACTOR,
      REQUEST_DECISION,
      DECISION_HASH,
      new Date(clock + 60 * 60 * 1000),
      fixture.enterpriseId,
      [fixture.projectId],
      CORRELATION,
    ] as const;
    // The same trusted context inside one transaction is an idempotent replay.
    expect(await establishProbe([trustedParameters, trustedParameters])).toEqual({
      code: null,
      kind: 'HUMAN',
    });
    // A different kind in the same transaction is a platform conflict.
    expect((await establishProbe([trustedParameters, agentParameters])).code).toBe('40001');
    // A missing or unknown kind never reaches the context row.
    const missingKind = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await client.query(
          `SELECT platform_security.establish_transaction_context(
             'REQUEST', $1, NULL, $2, $3, $4, $5, $6, $7, $8, NULL)`,
          [
            OPERATOR,
            OPERATOR_ACTOR,
            REQUEST_DECISION,
            DECISION_HASH,
            new Date(clock + 60 * 60 * 1000),
            fixture.enterpriseId,
            [fixture.projectId],
            CORRELATION,
          ],
        );
        return null;
      } catch (error) {
        return failureOf(error);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(missingKind?.code).toBe('22023');
    expect((await establishProbe([[OPERATOR, 'ROBOT', ...trustedParameters.slice(2)]])).code).toBe(
      '22023',
    );

    // The legacy 10-argument entry still works, keeps its signature and yields a
    // NULL kind, and mixing the two entries is always a conflict.
    async function legacyProbe(
      statements: readonly ('legacy' | 'trusted')[],
    ): Promise<{ code: string | null; kind: string | null }> {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        for (const statement of statements) {
          if (statement === 'legacy') {
            await establish(client, { allowedProjectIds: [fixture.projectId], legacy: true });
            continue;
          }
          await establish(client, { allowedProjectIds: [fixture.projectId] });
        }
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return { code: null, kind: row.rows.at(0)?.kind ?? null };
      } catch (error) {
        return { code: failureOf(error).code, kind: null };
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    expect(await legacyProbe(['legacy'])).toEqual({ code: null, kind: null });
    expect(await legacyProbe(['legacy', 'legacy'])).toEqual({ code: null, kind: null });
    expect((await legacyProbe(['legacy', 'trusted'])).code).toBe('40001');
    expect((await legacyProbe(['trusted', 'legacy'])).code).toBe('40001');

    // Committed context rows never survive into the next transaction, and the
    // application role may only read the helper, never establish a context.
    const reused = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await establish(client, { allowedProjectIds: [fixture.projectId] });
        await client.query('COMMIT');
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return row.rows.at(0)?.kind;
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(reused).toBeNull();
    const appEstablish = await asAppRoleFailure(
      tePool,
      'task_execution_app',
      { allowedProjectIds: [fixture.projectId] },
      `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, 'HUMAN', $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        OPERATOR,
        OPERATOR_ACTOR,
        REQUEST_DECISION,
        DECISION_HASH,
        new Date(clock + 60 * 60 * 1000),
        fixture.enterpriseId,
        [fixture.projectId],
        CORRELATION,
      ],
    );
    expect(appEstablish.code).toBe('42501');
  });

  it('TE-P210-019 returns the exact committed draft to both read versions', async () => {
    const legacyTask = await createExecutableTask('1.0');
    const legacyCreation = await preparedCreation({
      commandVersion: '1.0',
      taskId: legacyTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-019-legacy',
    });
    expect(await createThroughEntry(legacyCreation)).toMatchObject({ status: 'COMMITTED' });
    const legacyId = legacyCreation.targetRef.objectId as string;

    const canonicalTask = await createExecutableTask('2.0');
    const canonicalCreation = await preparedCreation({
      commandVersion: '1.1',
      taskId: canonicalTask,
      taskMajor: '2.0',
      idempotencyKey: 'wi212-019-canonical',
    });
    expect(await createThroughEntry(canonicalCreation)).toMatchObject({ status: 'COMMITTED' });
    const canonicalId = canonicalCreation.targetRef.objectId as string;

    const receiptsBefore = await countRows('task_execution.command_receipt');
    const auditsBefore = await countRows('task_execution.audit_record');
    const outboxBefore = await countRows('task_execution.outbox_event');

    for (const [label, queryVersion, workOrderId, spelling] of [
      ['@2.0 on the legacy creation', '2.0', legacyId, WORK_ORDER_V1],
      ['@1.1 on the canonical creation', '1.1', canonicalId, WORK_ORDER_V11],
    ] as const) {
      const read = await preparedRead({
        queryVersion,
        workOrderId,
        spelling,
      });
      const result = await readThroughEntry(read);
      expect(result, label).toMatchObject({ status: 'COMMITTED' });
      if (result.status !== 'COMMITTED') throw new Error('the read did not commit');
      const root = await workOrderRoot(workOrderId);
      const snapshot = (await workOrderSnapshots(workOrderId))[0];
      if (root === undefined || snapshot === undefined) throw new Error('fixture missing');
      expect(result.resultPayload, label).toEqual({
        draftSnapshotRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: DRAFT_SNAPSHOT_OBJECT,
          objectId: snapshot.snapshot_id,
          scope: draftScope(),
          contentHash: {
            algorithm: 'SHA-256',
            digest: snapshot.payload_hash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        draft: record(snapshot.canonical_payload).draft,
        expiresAt: record(snapshot.canonical_payload).expiresAt,
        rootAggregateVersion: Number(root.aggregate_version),
        status: 'DRAFT',
      });
      expect(record(snapshot.canonical_payload).workOrderRef, label).toEqual(
        workOrderRefOf(root.work_order_object_type, workOrderId),
      );
      expect(root.work_order_object_type, label).toBe(
        queryVersion === '1.1' ? WORK_ORDER_V11 : WORK_ORDER_V1,
      );
    }

    // The read path writes nothing at all.
    expect(await countRows('task_execution.command_receipt')).toBe(receiptsBefore);
    expect(await countRows('task_execution.audit_record')).toBe(auditsBefore);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });

  it('TE-P210-020 refuses every read counter-example with one exterior', async () => {
    const legacyTask = await createExecutableTask('1.0');
    const legacyCreation = await preparedCreation({
      commandVersion: '1.0',
      taskId: legacyTask,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-020-legacy',
    });
    expect(await createThroughEntry(legacyCreation)).toMatchObject({ status: 'COMMITTED' });
    const legacyId = legacyCreation.targetRef.objectId as string;

    const canonicalTask = await createExecutableTask('2.0');
    const canonicalCreation = await preparedCreation({
      commandVersion: '1.1',
      taskId: canonicalTask,
      taskMajor: '2.0',
      idempotencyKey: 'wi212-020-canonical',
    });
    expect(await createThroughEntry(canonicalCreation)).toMatchObject({ status: 'COMMITTED' });
    const canonicalId = canonicalCreation.targetRef.objectId as string;

    // The other read version of the same WorkOrder: each entry accepts only the
    // spelling its own creating major produced.
    const canonicalReadOfLegacy = await preparedRead({
      queryVersion: '1.1',
      workOrderId: legacyId,
      spelling: WORK_ORDER_V11,
    });
    expect((await attemptRead(canonicalReadOfLegacy)).code).toBe(EXECUTION_WORK_ORDER_REF_INVALID);
    const legacyReadOfCanonical = await preparedRead({
      queryVersion: '2.0',
      workOrderId: canonicalId,
      spelling: WORK_ORDER_V1,
    });
    expect((await attemptRead(legacyReadOfCanonical)).code).toBe(EXECUTION_WORK_ORDER_REF_INVALID);

    // An id that no WorkOrder of this Project carries, and a Scope-closed but
    // invisible one, are the same exterior.
    const missing = await preparedRead({
      queryVersion: '2.0',
      workOrderId: newUuidV7(),
      spelling: WORK_ORDER_V1,
    });
    expect((await attemptRead(missing)).code).toBe(EXECUTION_WORK_ORDER_REF_INVALID);
    const invisibleId = await (async () => {
      const task = await createExecutableTask('1.0', fixture.otherProjectId);
      const creation = await preparedCreation({
        commandVersion: '1.0',
        taskId: task,
        taskMajor: '1.0',
        idempotencyKey: 'wi212-020-other-project',
        projectId: fixture.otherProjectId,
        principal: otherProjectOperator(),
      });
      const otherProjectCreation = await createThroughEntry(
        creation,
        workOrderEntry,
        otherProjectOperator(),
      );
      expect(otherProjectCreation, JSON.stringify(otherProjectCreation)).toMatchObject({
        status: 'COMMITTED',
      });
      return creation.targetRef.objectId as string;
    })();
    // The row is a committed fact of its own Project Scope, so the refusal below
    // is the requested Scope's invisibility and not a missing id.
    expect(await workOrderRoot(invisibleId)).toMatchObject({
      project_id: fixture.otherProjectId,
      status: 'DRAFT',
    });
    const invisible = await preparedRead({
      queryVersion: '2.0',
      workOrderId: invisibleId,
      spelling: WORK_ORDER_V1,
    });
    expect((await attemptRead(invisible)).code).toBe(EXECUTION_WORK_ORDER_REF_INVALID);

    // A non-Project Scope in the request is refused before any Decision is read.
    const valid = await preparedRead({
      queryVersion: '2.0',
      workOrderId: legacyId,
      spelling: WORK_ORDER_V1,
    });
    for (const [label, scope] of [
      ['enterprise-only', { enterpriseId: fixture.enterpriseId }],
      ['platform', {}],
      [
        'foreign project',
        { enterpriseId: fixture.enterpriseId, projectId: fixture.otherProjectId },
      ],
    ] as const) {
      const mutated = structuredClone(valid);
      record(record(mutated.payload).workOrderRef).scope = scope;
      expect((await attemptRead(mutated)).code, label).toBe(EXECUTION_WORK_ORDER_REF_INVALID);
    }

    // `get_work_order_draft@1.0` has no handler and no satisfiable input: the
    // composition entry refuses both majors before it reads any Decision, so the
    // synthetic reference below is never resolved.
    const syntheticDecision: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: newUuidV7(),
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      contentHash: contentHash(DECISION_HASH.toString('hex')),
    };
    for (const [label, workOrderId, spelling] of [
      ['legacy creation', legacyId, WORK_ORDER_V1],
      ['canonical creation', canonicalId, WORK_ORDER_V11],
    ] as const) {
      const readVersion10 = readEnvelope({
        queryVersion: '1.0',
        workOrderRef: workOrderRefOf(spelling, workOrderId),
        decisionRef: syntheticDecision,
      });
      const attempt = await attemptRead(readVersion10);
      expect(attempt.code, label).toBe('API_CONTRACT_TYPE_UNKNOWN');
      expect(attempt.thrown, label).toBe(true);
    }

    // V3005 closes the old owner-SQL shortcut: a legacy Root cannot enter
    // READY without a frozen Contract. Canonical non-DRAFT reads are covered
    // after the real owning Freeze in TE-VAL-S-008.
    await expect(
      admin.query(
        `UPDATE task_execution.work_order SET status = 'READY' WHERE work_order_id = $1`,
        [legacyId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'work_order_frozen_pointer_state' });

    // NOT RUN: the Root↔snapshot / pointer↔payload inconsistency branch. The
    // pointer can only move to a `(snapshot_id, payload_hash)` pair that exists
    // for this very WorkOrder with an aggregate-version advance, and a second
    // snapshot of one WorkOrder cannot be inserted at all, so the read can never
    // observe an inconsistent pointer. Both closures are asserted here.
    const snapshotBefore = (await workOrderSnapshots(legacyId))[0];
    if (snapshotBefore === undefined) throw new Error('snapshot fixture missing');
    const casFreePointer = await appStatement(
      'UPDATE task_execution.work_order SET current_draft_snapshot_hash = $2 WHERE work_order_id = $1',
      [legacyId, Buffer.alloc(32, 0x51)],
    );
    expect(casFreePointer?.code).toBe('23514');
    const pointerToUnknown = await appStatement(
      `UPDATE task_execution.work_order
          SET current_draft_snapshot_id = $2, aggregate_version = aggregate_version + 1
        WHERE work_order_id = $1`,
      [legacyId, newUuidV7()],
    );
    expect(pointerToUnknown?.code).toBe('23514');
    expect(pointerToUnknown?.message).toContain('must reference a snapshot of this work order');
    const payloadRewrite = await appStatement(
      'UPDATE task_execution.work_order_draft_snapshot SET canonical_payload = $2 WHERE snapshot_id = $1',
      [snapshotBefore.snapshot_id, JSON.stringify({ forged: true })],
    );
    expect(payloadRewrite?.code).toBe('42501');
  });

  it('TE-P210-021 authorizes each read version from its own entry', async () => {
    const task = await createExecutableTask('1.0');
    const legacyCreation = await preparedCreation({
      commandVersion: '1.0',
      taskId: task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-021-legacy',
    });
    expect(await createThroughEntry(legacyCreation)).toMatchObject({ status: 'COMMITTED' });
    const legacyId = legacyCreation.targetRef.objectId as string;

    const legacyRead = await preparedRead({
      queryVersion: '2.0',
      workOrderId: legacyId,
      spelling: WORK_ORDER_V1,
    });
    const canonicalReadDecision = await issueReadDecision({
      queryVersion: '1.1',
      workOrderRef: workOrderRefOf(WORK_ORDER_V11, newUuidV7()),
      payloadHash: digestCanonicalPayload(legacyRead.payload as CanonicalJsonObject).hash,
    });
    const substitutedVersion = structuredClone(legacyRead);
    substitutedVersion.authorizationDecisionRef = canonicalReadDecision;
    expect((await attemptRead(substitutedVersion)).code).toBe(AUTHORIZATION_DECISION_INVALID);

    // Revoking the entry's own read Grant fails the replayed read closed, and
    // restoring coverage makes the same request readable again.
    expect(await readThroughEntry(legacyRead)).toMatchObject({ status: 'COMMITTED' });
    const revoked = await revokeCapability(identityDeps([fixture.projectId]), {
      targetId: grantDraftReadV2,
      expectedAggregateVersion: '1',
      scope: {
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
      reasonCode: 'WI212_FIXTURE_READ_REVOKE',
      effectiveAt: new Date(clock),
      idempotencyKey: `wi212:revoke-read:${grantDraftReadV2}`,
    });
    expect(revoked.status).toBe('COMMITTED');
    expect((await attemptRead(legacyRead)).code).toBe(AUTHORIZATION_REVOKED);

    grantDraftReadV2 = await grant({
      capabilityCode: readCapabilityCodes.workOrderDraftReadV2,
      action: ACTIONS.draftReadV2,
      selectorType: 'TARGET_TYPE',
      targetObjectType: WORK_ORDER_V1,
    });
    expect(await readThroughEntry(legacyRead)).toMatchObject({ status: 'COMMITTED' });

    // An expired Decision and a drifted trusted configuration fail closed too.
    const expiredEntry = entryFor({ now: (): Date => new Date(clock + 25 * 60 * 60 * 1000) });
    expect((await attemptRead(legacyRead, expiredEntry)).code).toBe(AUTHORIZATION_EXPIRED);
    const driftedEntry = entryFor({
      readCodes: {
        ...readCapabilityCodes,
        workOrderDraftReadV2: 'wi212.cap.draftread.v2.drifted',
      },
    });
    expect((await attemptRead(legacyRead, driftedEntry)).code).toBe(AUTHORIZATION_REVOKED);

    // An expired but still DRAFT Root keeps returning its historical draft, and
    // that read grants no eligibility: no state, version or fact changes.
    const expiringCreation = await preparedCreation({
      commandVersion: '1.0',
      taskId: task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-021-expired',
      expiresAt: new Date(clock + 10 * 60 * 1000).toISOString(),
    });
    expect(await createThroughEntry(expiringCreation)).toMatchObject({ status: 'COMMITTED' });
    const expiringId = expiringCreation.targetRef.objectId as string;
    const later = new Date(clock + 2 * 60 * 60 * 1000);
    const laterEntry = entryFor({ now: (): Date => later });
    const laterRead = await preparedRead({
      queryVersion: '2.0',
      workOrderId: expiringId,
      spelling: WORK_ORDER_V1,
      now: later,
    });
    const beforeRoot = await workOrderRoot(expiringId);
    const beforeSnapshots = await workOrderSnapshots(expiringId);
    const laterResult = await readThroughEntry(laterRead, laterEntry);
    expect(laterResult, JSON.stringify(laterResult)).toMatchObject({ status: 'COMMITTED' });
    if (laterResult.status !== 'COMMITTED') throw new Error('the historical read failed');
    expect(laterResult.resultPayload).toMatchObject({
      status: 'DRAFT',
      expiresAt: new Date(clock + 10 * 60 * 1000).toISOString(),
      rootAggregateVersion: 1,
    });
    expect(laterResult.resultPayload).not.toHaveProperty('eligibility');
    expect(await workOrderRoot(expiringId)).toEqual(beforeRoot);
    expect(await workOrderSnapshots(expiringId)).toEqual(beforeSnapshots);
  });

  it('TE-P210-022 closes the WorkOrder write path to untrusted contexts', async () => {
    const task = await createExecutableTask('1.0');
    const workOrderId = newUuidV7();
    const rootInsert = (projectId: string) => ({
      statement: `INSERT INTO task_execution.work_order
         (work_order_id, enterprise_id, project_id, work_order_object_type, task_id,
          task_object_type, status, aggregate_version, current_draft_snapshot_id,
          current_draft_snapshot_hash, draft_schema_version, created_by_principal_id,
          requested_by_principal_id)
       VALUES ($1, $2, $3, 'execution.work_order', $4, 'execution.task', 'DRAFT', 1, $5, $6,
               '1.0', $7, $7)`,
      parameters: [
        workOrderId,
        fixture.enterpriseId,
        projectId,
        task,
        newUuidV7(),
        Buffer.alloc(32, 0x52),
        OPERATOR,
      ],
    });

    // Without any trusted context the INSERT policy denies the row.
    const noContext = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE task_execution_app');
        try {
          const statement = rootInsert(fixture.projectId);
          await client.query(statement.statement, statement.parameters);
          return null;
        } catch (error) {
          return failureOf(error);
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(noContext?.code).toBe('42501');

    // A context whose Decision expires mid-transaction stops authorizing later
    // statements, and a committed context never survives into the next one.
    const expiringClient = await tePool.connect();
    try {
      await expiringClient.query('BEGIN');
      await expiringClient.query('SET LOCAL ROLE platform_context_establisher');
      await expiringClient.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, 'HUMAN', $2, $3, $4, $5, $6, $7, $8, NULL)`,
        [
          OPERATOR,
          OPERATOR_ACTOR,
          REQUEST_DECISION,
          DECISION_HASH,
          new Date(Date.now() + 250),
          fixture.enterpriseId,
          [fixture.projectId],
          CORRELATION,
        ],
      );
      await expiringClient.query('SET LOCAL ROLE task_execution_app');
      const beforeExpiry = await expiringClient.query<{ kind: string | null }>(
        'SELECT platform_security.context_principal_kind() AS kind',
      );
      expect(beforeExpiry.rows.at(0)?.kind).toBe('HUMAN');
      // The only real wait of this suite: the context's expiry is a platform
      // clock fact, so crossing it needs wall-clock time (the same technique
      // `tests/persistence/rls-context.test.ts` uses for the platform check).
      await expiringClient.query('SELECT pg_sleep(0.4)');
      const afterExpiry = await expiringClient.query<{ kind: string | null }>(
        'SELECT platform_security.context_principal_kind() AS kind',
      );
      expect(afterExpiry.rows.at(0)?.kind).toBeNull();
      const expiredWrite = await (async () => {
        const statement = rootInsert(fixture.projectId);
        try {
          await expiringClient.query(statement.statement, statement.parameters);
          return null;
        } catch (error) {
          return failureOf(error);
        }
      })();
      expect(expiredWrite?.code).toBe('42501');
      await expiringClient.query('ROLLBACK');

      // Pool reuse: the committed context of the previous transaction is gone.
      await expiringClient.query('BEGIN');
      await expiringClient.query('SET LOCAL ROLE platform_context_establisher');
      await establish(expiringClient, { allowedProjectIds: [fixture.projectId] });
      await expiringClient.query('COMMIT');
      await expiringClient.query('BEGIN');
      await expiringClient.query('SET LOCAL ROLE task_execution_app');
      const reused = await expiringClient.query<{ kind: string | null }>(
        'SELECT platform_security.context_principal_kind() AS kind',
      );
      expect(reused.rows.at(0)?.kind).toBeNull();
      const reusedWrite = await (async () => {
        const statement = rootInsert(fixture.projectId);
        try {
          await expiringClient.query(statement.statement, statement.parameters);
          return null;
        } catch (error) {
          return failureOf(error);
        }
      })();
      expect(reusedWrite?.code).toBe('42501');
      await expiringClient.query('ROLLBACK');
    } finally {
      await expiringClient.query('ROLLBACK').catch(() => undefined);
      expiringClient.release();
    }

    // Concurrent connections keep their own context: the Agent connection never
    // sees the Human's principal, and a Project-scoped context cannot write the
    // other Project's row.
    const humanClient = await tePool.connect();
    const agentClient = await tePool.connect();
    try {
      for (const [client, principal] of [
        [humanClient, operator()],
        [agentClient, agent()],
      ] as const) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await establish(client, {
          allowedProjectIds: [fixture.projectId],
          principalId: principal.principalId,
          principalKind: principal.principalKind,
          actorSnapshotId: principal.actorRef.snapshotId,
        });
        await client.query('SET LOCAL ROLE task_execution_app');
      }
      const kinds = await Promise.all([
        humanClient.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        ),
        agentClient.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        ),
      ]);
      expect(kinds.map((result) => result.rows.at(0)?.kind)).toEqual(['HUMAN', 'AGENT']);
      const crossProject = await (async () => {
        const statement = rootInsert(fixture.otherProjectId);
        try {
          await humanClient.query(statement.statement, statement.parameters);
          return null;
        } catch (error) {
          return failureOf(error);
        }
      })();
      expect(crossProject?.code).toBe('42501');
    } finally {
      await humanClient.query('ROLLBACK').catch(() => undefined);
      await agentClient.query('ROLLBACK').catch(() => undefined);
      humanClient.release();
      agentClient.release();
    }

    // The application role may read the kind helper and the projection helper,
    // but it may neither establish nor clear a context.
    const helperCall = await appStatement(
      'SELECT platform_security.context_principal_kind() AS kind',
      [],
    );
    expect(helperCall).toBeNull();
    const clearCall = await appStatement(
      'SELECT platform_security.clear_transaction_context()',
      [],
    );
    expect(clearCall?.code).toBe('42501');

    // The 10-argument legacy context can never create a WorkOrder: its kind
    // helper is NULL, which the V3003 ownership closure refuses (proven with a
    // full three-statement write in TE-P210-017).
    const legacyKind = await (async () => {
      const client = await tePool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await establish(client, { allowedProjectIds: [fixture.projectId], legacy: true });
        await client.query('SET LOCAL ROLE task_execution_app');
        const row = await client.query<{ kind: string | null }>(
          'SELECT platform_security.context_principal_kind() AS kind',
        );
        await client.query('ROLLBACK');
        return row.rows.at(0)?.kind;
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    })();
    expect(legacyKind).toBeNull();
  });

  it('TE-P210-023 keeps the published surface and the historical facts unchanged', async () => {
    const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
      operations: { type: string; version: string; kind: string; owner: string }[];
    };
    expect(catalog.operations).toHaveLength(221);
    expect(
      catalog.operations.filter((operation) => operation.owner === 'task-execution'),
    ).toHaveLength(49);
    const executionEvents = catalog.operations.filter(
      (operation) => operation.kind === 'EVENT' && operation.type.startsWith('execution.'),
    );
    expect(executionEvents).toHaveLength(12);
    expect(
      catalog.operations.some((operation) => operation.type === 'execution.WorkOrderDrafted'),
    ).toBe(false);

    // An unregistered event has no registered operation, so no publisher can
    // reach it through the Contract Registry.
    const unregisteredEvent = registry.validateOperation('execution.WorkOrderDrafted', '1.0', {});
    expect(unregisteredEvent.valid).toBe(false);
    expect(unregisteredEvent.errors.some((error) => error.keyword === 'operationRegistry')).toBe(
      true,
    );
    expect(registry.getOperation('execution.WorkOrderDrafted', '1.0')).toBeUndefined();

    // The four WorkOrder draft operations keep their published metadata.
    const createLegacy = registry.getOperation('execution.create_work_order', '1.0') as {
      targetObjectType?: string;
      concurrencyMode?: string;
    };
    expect(createLegacy.targetObjectType).toBeUndefined();
    expect(registry.getOperation('execution.create_work_order', '1.1')).toMatchObject({
      targetObjectType: WORK_ORDER_V11,
      concurrencyMode: 'CREATE',
      authorizationPurpose: 'task.execution.create_work_order',
    });
    expect(registry.getOperation('execution.get_work_order_draft', '1.0')).toMatchObject({
      kind: 'QUERY',
      authorizationPurpose: 'execution.work_order.draft.read',
    });
    expect(registry.getOperation('execution.get_work_order_draft', '1.1')).toMatchObject({
      authorizationPurpose: 'execution.work_order.draft.read',
    });
    const readV2 = registry.getOperation('execution.get_work_order_draft', '2.0') as {
      references?: readonly { path: string }[];
    };
    expect(registry.getOperation('execution.get_work_order_draft', '2.0')).toMatchObject({
      kind: 'QUERY',
      authorizationPurpose: 'execution.work_order.draft.read',
      dataClassification: 'INTERNAL',
    });
    // §18.2: `/payload/workOrderRef` is deliberately not declared for @2.0.
    expect(
      readV2.references?.some((reference) => reference.path === '/payload/workOrderRef') ?? false,
    ).toBe(false);

    // The historical 200-entry Baseline is untouched and carries no draft read.
    const baseline = JSON.parse(readFileSync(COMPATIBILITY_BASELINE, 'utf8')) as
      { type: string }[] | { operations: { type: string }[] };
    const baselineOperations = Array.isArray(baseline) ? baseline : baseline.operations;
    expect(baselineOperations).toHaveLength(200);
    expect(
      baselineOperations.some((operation) => operation.type === 'execution.create_work_order'),
    ).toBe(true);
    expect(
      baselineOperations.some((operation) => operation.type === 'execution.get_work_order_draft'),
    ).toBe(false);

    // The v1 frozen fixture bytes are unchanged, and the registered acceptance
    // sets still accept every legal creation and read request.
    expect(readFileSync(WORK_ORDER_CONTRACT_FIXTURE, 'utf8')).toBe(
      readFileSync(WORK_ORDER_BASELINE_FIXTURE, 'utf8'),
    );
    const frozenQuery = JSON.parse(readFileSync(V1_FROZEN_DRAFT_FIXTURE, 'utf8')) as unknown;
    expect(
      registry.validateOperation('execution.get_work_order_draft', '2.0', frozenQuery),
    ).toEqual({
      valid: true,
      errors: [],
    });
    const task = await createExecutableTask('1.0');
    const legalLegacy = await preparedCreation({
      commandVersion: '1.0',
      taskId: task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-023-legacy',
    });
    expect(registry.validateOperation('execution.create_work_order', '1.0', legalLegacy)).toEqual({
      valid: true,
      errors: [],
    });
    const legalCanonical = await preparedCreation({
      commandVersion: '1.1',
      taskId: task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-023-canonical',
    });
    expect(
      registry.validateOperation('execution.create_work_order', '1.1', legalCanonical),
    ).toEqual({
      valid: true,
      errors: [],
    });
    const legalRead = await preparedRead({
      queryVersion: '1.1',
      workOrderId: newUuidV7(),
      spelling: WORK_ORDER_V11,
    });
    expect(registry.validateOperation('execution.get_work_order_draft', '1.1', legalRead)).toEqual({
      valid: true,
      errors: [],
    });

    // `project.validate_object_scope@1.0` keeps its accept set, and no @2.0
    // exists.
    const enterpriseProjectContext: EnterpriseProjectTransactionContext = {
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
    const scopePayload = (objectType: string) => ({
      objectRef: {
        kind: 'OBJECT' as const,
        objectType,
        objectId: fixture.projectId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      },
      expectedScopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      purpose: 'wi212.compatibility',
    });
    expect(registry.getOperation('project.validate_object_scope', '2.0')).toBeUndefined();
    for (const objectType of [
      'zhiju.project.project',
      'zhiju.project.delivery_item',
      'DeliveryItem',
    ]) {
      await expect(
        handleValidateObjectScope(
          enterpriseProjectDb,
          enterpriseProjectContext,
          scopePayload(objectType),
        ),
        objectType,
      ).rejects.toMatchObject({ code: PROJECT_OBJECT_SCOPE_MISMATCH });
    }
    expect(
      await handleValidateObjectScope(
        enterpriseProjectDb,
        enterpriseProjectContext,
        scopePayload('Project'),
      ),
    ).toMatchObject({ valid: true, lifecycle: 'ACTIVE' });

    // Success and failure both write zero Outbox rows.
    const outboxBefore = await countRows('task_execution.outbox_event');
    const successful = await preparedCreation({
      commandVersion: '1.0',
      taskId: task,
      taskMajor: '1.0',
      idempotencyKey: 'wi212-023-outbox-success',
    });
    expect(await createThroughEntry(successful)).toMatchObject({ status: 'COMMITTED' });
    expect(
      (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM task_execution.outbox_event WHERE aggregate_id = $1',
          [successful.targetRef.objectId],
        )
      ).rows[0]?.n,
    ).toBe(0);
    const rejected = await preparedCreation({
      commandVersion: '1.0',
      taskId: newUuidV7(),
      taskMajor: '1.0',
      idempotencyKey: 'wi212-023-outbox-failure',
    });
    expect((await attemptCreation(rejected)).code).toBe('NOT_FOUND');
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });
});
