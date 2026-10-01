// IM-06 (#208): real PostgreSQL acceptance for Task Readiness production and the
// `DRAFT` → `READY` transition (`TE-P206-001`–`TE-P206-018`, Module-Test-003).
//
// Every case enters through the composition entry in `@zhiju/api/composition` —
// the same boundary a transport uses: the complete registered Envelope is
// validated for its exact version, the presented AuthorizationDecision is
// revalidated through the IdentityPolicy-owned readiness Port *before* any
// TaskExecution idempotency claim, the owning TaskExecution handler runs in one
// owning transaction, and the Policy resolution and the Slice dereference each
// run through their own owning entry with their own Decision.
//
// The committed DRAFT Task is produced by the owning `execution.create_task`
// entry and the PolicyVersion facts by the owning
// `identity.record_policy_version` entry, so no business chain under test is
// stubbed. The `context_source_slice` row is seeded directly, exactly as
// `tests/persistence/task-draft-creation.test.ts` seeds its `delivery_item`
// prerequisite: the slice capture chain is not part of this slice, while the read
// under test is the real owning `project.get_context_source_slice@1.0`.
//
// Boundary: the COMPLETED-dependency usability branch of `TE-P206-005` and the
// blocking InformationRequest branch of `TE-P206-010` stay `NOT RUN`. No
// committed fact can currently produce them — `execution.evaluate_task_completion@1.0`
// and the `information_request` producer are not delivered — so their absence is
// recorded as a boundary rather than as a pass.
//
// Every other row of the table is implemented. Five closures land one layer
// earlier than the row's named code, and each is asserted at the layer where it
// actually happens rather than being restated as prose:
//
// 1. A bare local name, a case variant, a `projectId`-only Scope and the shapes
//    of `TE-P206-004` (a 63-character digest, a `SHA-512` algorithm, a
//    `canonicalizationVersion` of `2`) are not expressible in a registered
//    Envelope, so the registered Schema refuses them with `API_VALUE_INVALID`
//    before either Handler runs. The owning-Handler branches behind them are
//    unreachable through the composition entry by construction.
// 2. The creation major of a Task definition is immutable in the database: the
//    V3001 immutability trigger refuses every `UPDATE` of the snapshot and the
//    creation-identity guard refuses a relabelled `INSERT`, so `TE-P206-004`'s
//    "rewrite `schema_version` and rebuild" has no legal fact at all. Both
//    refusals are asserted.
// 3. The stored dependency Reference set is closed by `execution.create_task`,
//    its only writer, and the Snapshot is immutable, so the readiness plan's own
//    `EXECUTION_DEFINITION_REF_INVALID` branches for a self reference
//    (`TE-P206-006`) and for a cross-Scope, other-major or non-Task stored
//    dependency (`TE-P206-007`) have no reachable input. The closures are
//    asserted where they do fire, at creation.
// 4. A definition pointer move must advance the aggregate version (V3001) and a
//    pointer to a non-existent Snapshot is refused by the composite foreign key,
//    so the pointer term of the consumer's comparison can never be the *first*
//    mismatch: a moved pointer is always the version term, asserted through
//    `TE-P206-015` and `TE-P206-016`. The database's refusal of a CAS-free
//    pointer move is asserted directly.
// 5. `execution_judgment`'s RLS `INSERT` check is shadowed by the
//    creation-identity guard, whose own Receipt read is RLS-scoped; RLS is
//    therefore asserted through its visibility boundaries (a foreign-Project
//    Context sees zero rows) and the ACL through the `42501` every app-role
//    write path answers (`TE-P206-017`).

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  createCreateTaskEntry,
  createTaskReadinessEntry,
  type CreateTaskEntry,
  type TaskReadinessEntry,
} from '@zhiju/api/composition';
import {
  ContractRegistry,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredEvaluatorProfileReference,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  IDENTITY_POLICY_VERSION_UNKNOWN,
  IdentityPolicyRepository,
  authorizeCommand,
  createActorSnapshot,
  TASK_EXECUTION_CREATION_BINDINGS,
  createIdentityPolicyDatabase,
  createTaskExecutionCreationAuthorizationPort,
  createTaskExecutionReadinessAuthorizationPort,
  grantCapability,
  recordPolicySnapshot,
  recordPolicyVersion,
  revokeCapability,
  withIdentityTransaction,
  type ActorSnapshotRef,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
  type TaskExecutionCreationCapabilityCodes,
  type TaskExecutionReadinessCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
import {
  CONCURRENCY_CONFLICT,
  DEPENDENCY_UNAVAILABLE,
  EXECUTION_CRITERION_UNSUPPORTED,
  EXECUTION_DEFINITION_REF_INVALID,
  EXECUTION_JUDGMENT_INVALID,
  EXECUTION_JUDGMENT_STALE,
  EXECUTION_TASK_DEPENDENCY_CYCLE,
  EXECUTION_TASK_NOT_EXECUTABLE,
  EXECUTION_TASK_READINESS_UNSATISFIED,
  EXECUTION_TASK_REF_INVALID,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  NOT_FOUND,
  TASK_READY_EVENT,
  createTaskExecutionDatabase,
  digestCanonicalPayload,
  type CommandResult,
  type TaskExecutionDb,
} from '@zhiju/task-execution';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi208_probe';
const PROBE_PASSWORD = 'im06-wi208-probe';

const ENTERPRISE = 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d001';
const PROJECT = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d101';
const OTHER_PROJECT = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d102';
const OPERATOR = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d201';
const OTHER_PRINCIPAL = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d202';
const OPERATOR_ACTOR = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d301';
const GRANT_DECISION = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d401';
const CORRELATION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d501';

const AUTH_HASH = Buffer.alloc(32, 0x91);
const DECISION_HASH = Buffer.alloc(32, 0x93);

const TASK_OBJECT_V1 = 'execution.task';
const TASK_OBJECT_V2 = 'zhiju.execution.task';
const READINESS_OBJECT = 'zhiju.execution.task_readiness';
const DEFINITION_OBJECT = 'zhiju.execution.task_definition_snapshot';
const POLICY_OBJECT = 'zhiju.identity.policy';
const POLICY_VERSION_OBJECT = 'zhiju.identity.policy_version';
const POLICY_SNAPSHOT_OBJECT = 'identity.policy_snapshot';
const DECISION_OBJECT = 'identity.authorization_decision';
const ACTOR_OBJECT = 'identity.actor_snapshot';
const SLICE_OBJECT = 'zhiju.project.context_source_slice';
const READINESS_PROFILE = 'execution.task_readiness.policy@1.0';
const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';
const READINESS_EVALUATOR_KEY = 'te.task_readiness.evaluator@1.0';
const SLICE_PURPOSE = 'context.snapshot.read';

const CAP_TASK_V1 = 'wi208.cap.task.v1';
const CAP_TASK_V2 = 'wi208.cap.task.v2';
const CAP_BUILD = 'wi208.cap.readiness.build';
const CAP_READY = 'wi208.cap.task.ready';
const CAP_RESOLVE = 'wi208.cap.policy.resolve';
const CAP_SLICE_READ = 'wi208.cap.slice.read';
const CAP_RECORD = 'wi208.cap.policy.record';
/** Second READY capability code: the active-Grant key is (principal, code, scope). */
const CAP_READY_V2 = 'wi208.cap.task.ready.v2';
/** READY code whose Grant carries the *producer* selector type. */
const CAP_READY_WRONG_SELECTOR = 'wi208.cap.task.ready.wrong.selector';
/** Producer code whose Grant carries the *consumer* selector type. */
const CAP_BUILD_WRONG_SELECTOR = 'wi208.cap.readiness.build.wrong.selector';
/** READY code used by the revoked-Grant replay of `TE-P206-013`. */
const CAP_READY_REVOKED = 'wi208.cap.task.ready.revoked';

const ACTION_TASK_CREATE = 'execution.task.create.v1';
const ACTION_BUILD = 'execution.task.readiness.build';
const ACTION_READY = 'execution.task.mark_ready';

const OTHER_ENTERPRISE = 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d009';
const WORK_ORDER_OBJECT = 'zhiju.execution.work_order';
const ARTIFACT_REVISION_OBJECT = 'zhiju.artifact.artifact_revision';
const UNKNOWN_OBJECT = 'zhiju.unknown.namespace';
const PROJECT_OBJECT = 'zhiju.project.project';
const WORK_ORDER_VALIDATION_PROFILE = 'execution.work_order_validation.policy@1.0';
const WORK_ORDER_VALIDATION_EVALUATOR_KEY = 'te.work_order_validation.evaluator@1.0';

const V1_FIXTURE = new URL(
  '../fixtures/contracts/execution-create-task-command-valid.json',
  import.meta.url,
);
const V2_FIXTURE = new URL(
  '../fixtures/contracts/task-v2/create-task-v2-command-valid.json',
  import.meta.url,
);
const SLICE_SOURCE_FIXTURE = new URL(
  '../fixtures/contracts/context-source-slice/result.json',
  import.meta.url,
);
const PUBLIC_API_CATALOG = new URL('../../contracts/registry/public-api.v1.json', import.meta.url);

interface SeededSlice {
  readonly sliceId: string;
  readonly payload: CanonicalJsonObject;
  readonly payloadHash: Buffer;
  readonly validUntil: Date;
  /** The exact declared input the readiness plan must carry for this Slice. */
  readonly ref: CanonicalJsonObject;
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x7e)).update(input, 'utf8').digest(),
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

function contentHashOf(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

/**
 * Rewrites every `scope` inside a published fixture payload onto this suite's
 * Enterprise/Project, keeping every accepted Scope form (Platform `{}`,
 * Enterprise and Project) exactly as published.
 */
function rewriteFixtureScopes(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rewriteFixtureScopes(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'scope' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
      node[key] =
        'projectId' in (child as Record<string, unknown>)
          ? { enterpriseId: ENTERPRISE, projectId: PROJECT }
          : { enterpriseId: ENTERPRISE };
      continue;
    }
    rewriteFixtureScopes(child);
  }
}

function payloadOf(url: URL): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as { payload: Record<string, unknown> };
  return structuredClone(fixture.payload);
}

function profileRef(registryKey: string): Common.VersionedRef {
  const ref = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (ref === undefined) throw new Error(`the ${registryKey} profile is not registered`);
  return ref;
}

function evaluatorRef(): Common.VersionedRef {
  const ref = registeredEvaluatorProfileReference(
    'im06-evaluator-static-v1',
    READINESS_EVALUATOR_KEY,
  );
  if (ref === undefined) throw new Error('the readiness evaluator profile is not registered');
  return ref;
}

describe.skipIf(!gateEnabled)('Task Readiness production and READY transition', () => {
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
  let creationEntry: CreateTaskEntry;
  let readinessEntry: TaskReadinessEntry;
  let readinessEntryV2: TaskReadinessEntry;
  let operatorActorRef: ActorSnapshotRef;
  let otherProjectActorRef: ActorSnapshotRef;
  let grantPolicySnapshotId: string;
  let grantPolicySnapshotHash: Buffer;
  let readinessPolicyKey: Common.VersionedRef;
  let capturePolicyKey: Common.VersionedRef;
  let revokedCapturePolicyKey: Common.VersionedRef;
  let slice: SeededSlice;
  let clock: number;
  /** Committed Slice fixtures of `TE-P206-008`/`012`. */
  let expiredSlice: SeededSlice;
  let revokedSlice: SeededSlice;
  let shortLivedSlice: SeededSlice;
  /** Committed Policy fixtures of `TE-P206-011`/`012`/`016`. */
  let shortTtlPolicyKey: Common.VersionedRef;
  let longTtlPolicyKey: Common.VersionedRef;
  let unknownFieldPolicyKey: Common.VersionedRef;
  let wrongProfilePolicyKey: Common.VersionedRef;
  let notYetEffectivePolicyKey: Common.VersionedRef;
  let supersededPolicyKey: Common.VersionedRef;
  let driftPolicyKey: Common.VersionedRef;
  /** A Task committed in another Project: the invisibility evidence of `TE-P206-005`. */
  let otherProjectTaskId: string;

  const creationCapabilities: TaskExecutionCreationCapabilityCodes = {
    taskV1: CAP_TASK_V1,
    taskV2: CAP_TASK_V2,
    workOrderV1: 'wi208.cap.work_order.v1',
    workOrderV11: 'wi208.cap.work_order.v1_1',
  };
  const readinessCapabilities: TaskExecutionReadinessCapabilityCodes = {
    taskReadinessBuildV1: CAP_BUILD,
    taskReadyV1: CAP_READY,
  };
  /** The v2 Tasks' READY entry: one trusted capability code per published Task spelling. */
  const readinessCapabilitiesV2: TaskExecutionReadinessCapabilityCodes = {
    taskReadinessBuildV1: CAP_BUILD,
    taskReadyV1: CAP_READY_V2,
  };

  function identityContext(
    allowedProjectIds: readonly string[],
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: GRANT_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(clock + 60 * 60 * 1000),
      enterpriseId: ENTERPRISE,
      allowedProjectIds,
      correlationId: CORRELATION,
      ...overrides,
    };
  }

  function identityDeps(
    allowedProjectIds: readonly string[],
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityCommandDeps {
    return {
      db: identityDb,
      repo: identityRepo,
      crypto,
      context: identityContext(allowedProjectIds, overrides),
    };
  }

  function grantPolicySnapshotRef(): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: POLICY_SNAPSHOT_OBJECT,
      objectId: grantPolicySnapshotId,
      snapshotId: grantPolicySnapshotId,
      scope: {},
      contentHash: contentHashOf(grantPolicySnapshotHash.toString('hex')),
    };
  }

  function readinessEntryFor(
    overrides: {
      buildCapability?: string;
      readyCapability?: string;
      now?: () => Date;
      resolvePolicyCapability?: string;
      readContextSourceSliceCapability?: string;
      identityDb?: Kysely<IdentityPolicyDb>;
      taskExecutionDb?: Kysely<TaskExecutionDb>;
    } = {},
  ): TaskReadinessEntry {
    const codes: TaskExecutionReadinessCapabilityCodes = {
      taskReadinessBuildV1: overrides.buildCapability ?? readinessCapabilities.taskReadinessBuildV1,
      taskReadyV1: overrides.readyCapability ?? readinessCapabilities.taskReadyV1,
    };
    return createTaskReadinessEntry({
      taskExecutionDb: overrides.taskExecutionDb ?? teDb,
      enterpriseProjectDb: epDb,
      identity: {
        db: overrides.identityDb ?? identityDb,
        repo: identityRepo,
        crypto,
      },
      capabilityCodes: codes,
      capabilities: {
        resolvePolicy: overrides.resolvePolicyCapability ?? CAP_RESOLVE,
        readContextSourceSlice: overrides.readContextSourceSliceCapability ?? CAP_SLICE_READ,
      },
      now: overrides.now ?? ((): Date => new Date(clock)),
    });
  }

  async function seedPolicyVersionFact(input: {
    key: Common.VersionedRef;
    profileKey: string;
    policyDocument: CanonicalJsonObject;
    effectiveFrom?: Date;
    supersedesRef?: Common.VersionedRef;
    schemaRefs?: readonly Common.VersionedRef[];
    expected?: 'COMMITTED' | 'REJECTED';
  }): Promise<{
    readonly factId: string;
    readonly contentHash: Buffer;
    readonly result: CommandResult;
  }> {
    const factId = newUuidV7();
    const payload = {
      policyRef: input.key as unknown as CanonicalJsonObject,
      policySetVersion: `wi208-set-${input.profileKey}`,
      policySchemaRefs: [
        ...(input.schemaRefs ?? [profileRef(input.profileKey)]),
      ] as unknown as CanonicalJsonObject[],
      policyDocument: input.policyDocument,
      effectiveFrom: (input.effectiveFrom ?? new Date(clock - 60 * 60 * 1000)).toISOString(),
      ...(input.supersedesRef === undefined
        ? {}
        : { supersedesRef: input.supersedesRef as unknown as CanonicalJsonObject }),
    } as unknown as CanonicalJsonObject;
    const decision = await authorizeCommand(identityDeps([PROJECT]), {
      actorSnapshotRef: operatorActorRef,
      intent: {
        commandType: 'identity.record_policy_version',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
        purpose: 'identity.policy.record_policy_version',
        requestedCapability: CAP_RECORD,
        commandPayloadHash: digestCanonicalPayload(payload).hash,
        requestedAt: new Date(clock),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotRef(),
    });
    expect(decision.outcome).toBe('ALLOW');
    const result = await recordPolicyVersion(
      identityDeps([PROJECT], {
        authorizationDecisionId: decision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          decision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(decision.expiresAt),
      }),
      {
        envelope: {
          commandId: newUuidV7(),
          commandType: 'identity.record_policy_version',
          commandVersion: '1.0',
          scopeRef: input.key.scope,
          targetRef: objectRef(POLICY_VERSION_OBJECT, factId, {
            enterpriseId: ENTERPRISE,
            projectId: PROJECT,
          }),
          actor: objectRef('zhiju.identity.principal', OPERATOR, {
            enterpriseId: ENTERPRISE,
            projectId: PROJECT,
          }),
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: DECISION_OBJECT,
            objectId: decision.authorizationDecisionRef.objectId,
            scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
            contentHash: decision.authorizationDecisionRef
              .contentHash as unknown as CanonicalJsonObject,
          },
          idempotencyKey: `wi208:policy:${factId}`,
          correlationId: CORRELATION,
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHashOf(digestCanonicalPayload(payload).hash.toString('hex')),
          },
        },
      },
    );
    if (input.expected === 'REJECTED') {
      return { factId, contentHash: Buffer.alloc(0), result };
    }
    if (result.status !== 'COMMITTED') {
      const audit = await admin.query(
        `SELECT error_code, safe_summary FROM identity_policy.audit_record LIMIT 5`,
      );
      throw new Error(
        `recordPolicyVersion rejected: ${JSON.stringify(result)} audit=${JSON.stringify(audit.rows)}`,
      );
    }
    return { factId, contentHash: await policyContentHash(input.key), result };
  }

  /**
   * The owning resolution's `contentHash` of one committed Policy version key:
   * the fact payload hash `identity.resolve_policy@1.0` returns field by field.
   */
  async function policyContentHash(key: Common.VersionedRef): Promise<Buffer> {
    const row = (
      await admin.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM identity_policy.policy_version
          WHERE policy_object_id = $1 AND policy_key_version_id = $2
            AND enterprise_id = $3 AND project_id = $4`,
        [key.objectId, key.versionId, ENTERPRISE, PROJECT],
      )
    ).rows[0];
    if (row === undefined) throw new Error('the Policy version key has no committed fact');
    return row.payload_hash;
  }

  function versionedPolicyKey(): Common.VersionedRef {
    return {
      kind: 'VERSIONED',
      objectType: POLICY_OBJECT,
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    };
  }

  async function grant(input: {
    capabilityCode: string;
    actions: readonly string[];
    selectors?: readonly Record<string, unknown>[];
    projectId?: string;
    principalId?: string;
  }): Promise<string> {
    const grantId = newUuidV7();
    const projectId = input.projectId ?? PROJECT;
    const principalId = input.principalId ?? OPERATOR;
    const result = await grantCapability(identityDeps([projectId], { principalId }), {
      grantId,
      principalId,
      capabilityCode: input.capabilityCode,
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId },
      resourceSelectors: [...(input.selectors ?? [])],
      actions: [...input.actions],
      validFrom: new Date(clock - 60 * 60 * 1000),
      grantPolicySnapshotId,
      grantPolicySnapshotHash,
      justification: 'IM-06 #208 readiness fixture',
      idempotencyKey: `wi208:grant:${grantId}`,
    } as never);
    expect(result.status).toBe('COMMITTED');
    return grantId;
  }

  async function seedProject(seed: pg.Client, projectId: string, code: string): Promise<void> {
    await seed.query(
      `INSERT INTO enterprise_project.project
         (project_id, enterprise_id, display_code, title, objective, status,
          member_policy_ref, member_policy_version_id, member_policy_payload_hash,
          created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        projectId,
        ENTERPRISE,
        code,
        `WI-208 ${code}`,
        'Task readiness fixture.',
        JSON.stringify({
          kind: 'VERSIONED',
          objectType: 'Policy',
          objectId: newUuidV7(),
          versionId: newUuidV7(),
        }),
        newUuidV7(),
        Buffer.alloc(32, 0xc7),
        OPERATOR,
        OPERATOR_ACTOR,
        newUuidV7(),
      ],
    );
  }

  /** Seeds one committed Slice through direct SQL; the read path stays the real one. */
  async function seedSlice(input: {
    validUntil: Date;
    capturedAt?: Date;
    policyKey?: Common.VersionedRef;
    policyContentHash?: Buffer;
  }): Promise<SeededSlice> {
    const policyKey = input.policyKey ?? capturePolicyKey;
    const policyHash = input.policyContentHash ?? (await policyContentHash(policyKey));
    const fixtureResult = JSON.parse(readFileSync(SLICE_SOURCE_FIXTURE, 'utf8')) as {
      slice: Record<string, unknown>;
    };
    const sliceId = newUuidV7();
    // `valid_until > captured_at` is a database invariant, so an already
    // expired Slice is captured before its own bound rather than after it.
    const capturedAt = input.capturedAt ?? new Date(clock - 60 * 1000);
    const validUntil = input.validUntil;
    const payload = {
      ...fixtureResult.slice,
      sliceId,
      scopeRef: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      projectRef: objectRef(PROJECT_OBJECT, PROJECT, {
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
      }),
      purpose: SLICE_PURPOSE,
      audience: { principalKind: 'HUMAN', principalId: OPERATOR },
      capturePolicyRef: policyKey,
      capturedAt: capturedAt.toISOString(),
      validUntil: validUntil.toISOString(),
    } as unknown as CanonicalJsonObject;
    const payloadHash = digestCanonicalPayload(payload).hash;
    await admin.query(
      `INSERT INTO enterprise_project.context_source_slice
         (slice_id, enterprise_id, project_id, purpose, audience_ref, capture_policy_ref,
          captured_at, valid_until, slice_payload, slice_payload_hash, policy_version_ref,
          policy_set_version, policy_content_hash, policy_effective_from, policy_superseded_at,
          policy_checked_at, created_by_principal_id, created_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, $10, $11::jsonb,
               $12, $13, $14, NULL, $15, $16, $17, $18, $19)`,
      [
        sliceId,
        ENTERPRISE,
        PROJECT,
        SLICE_PURPOSE,
        JSON.stringify({ principalKind: 'HUMAN', principalId: OPERATOR }),
        JSON.stringify(policyKey),
        capturedAt,
        validUntil,
        JSON.stringify(payload),
        payloadHash,
        JSON.stringify({
          kind: 'SNAPSHOT',
          objectType: POLICY_VERSION_OBJECT,
          objectId: newUuidV7(),
          snapshotId: newUuidV7(),
          scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
          contentHash: contentHashOf(policyHash.toString('hex')),
        }),
        'wi208-set',
        policyHash,
        new Date(clock - 120 * 1000),
        capturedAt,
        OPERATOR,
        OPERATOR_ACTOR,
        GRANT_DECISION,
        newUuidV7(),
      ],
    );
    return {
      sliceId,
      payload,
      payloadHash,
      validUntil,
      ref: {
        kind: 'CONTENT_ADDRESSED',
        objectType: SLICE_OBJECT,
        objectId: sliceId,
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
        contentHash: contentHashOf(payloadHash.toString('hex')),
      } as unknown as CanonicalJsonObject,
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

    await seedProject(admin, PROJECT, 'WI208-MAIN');
    await seedProject(admin, OTHER_PROJECT, 'WI208-OTHER');
    for (const [principalId, displayName] of [
      [OPERATOR, 'WI-208 operator'],
      [OTHER_PRINCIPAL, 'WI-208 second human'],
    ] as const) {
      await withIdentityTransaction(identityDb, identityContext([PROJECT]), (trx) =>
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
      policySetVersion: `wi208-grant-policy-set-${newUuidV7()}`,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: new Date(clock - 60 * 60 * 1000),
      policyDocument: { rules: ['readiness-authorization'], version: 1 },
      idempotencyKey: `wi208:policy-snapshot:${newUuidV7()}`,
    };
    const snapshotResult = await recordPolicySnapshot(
      identityDeps([PROJECT]),
      policySnapshotRequest,
    );
    expect(snapshotResult.status).toBe('COMMITTED');
    grantPolicySnapshotId = policySnapshotRequest.policySnapshotId;
    const snapshotRow = (
      await admin.query<{ payload_hash: Buffer }>(
        'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
        [grantPolicySnapshotId],
      )
    ).rows[0];
    if (snapshotRow === undefined) throw new Error('the Grant Policy Snapshot row is missing');
    grantPolicySnapshotHash = snapshotRow.payload_hash;

    operatorActorRef = await createActorSnapshot(identityDeps([PROJECT]), {
      actorSnapshotId: OPERATOR_ACTOR,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT,
    });

    await grant({
      capabilityCode: CAP_TASK_V1,
      actions: ['execution.task.create.v1'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
    });
    await grant({
      capabilityCode: CAP_TASK_V2,
      actions: ['execution.task.create.v2'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: TASK_OBJECT_V2 }],
    });
    await grant({
      capabilityCode: CAP_BUILD,
      actions: ['execution.task.readiness.build'],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: READINESS_OBJECT }],
    });
    await grant({
      capabilityCode: CAP_READY,
      actions: [ACTION_READY],
      selectors: [{ selectorType: 'TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
    });
    // A second READY entry, because the active-Grant key is
    // `(principal, capabilityCode, scope)`: the v2 Task spelling needs its own
    // trusted code and its own Grant with the `TARGET_TYPE` selector of that
    // spelling (never a relaxed v1 Grant).
    await grant({
      capabilityCode: CAP_READY_V2,
      actions: [ACTION_READY],
      selectors: [{ selectorType: 'TARGET_TYPE', objectType: TASK_OBJECT_V2 }],
    });
    // The two mismatched selector configurations of `TE-P206-013`: the Grant
    // covers the capability code and the action, but with the *other* entry's
    // selector type, so neither entry can borrow the other's Grant.
    await grant({
      capabilityCode: CAP_READY_WRONG_SELECTOR,
      actions: [ACTION_READY],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
    });
    await grant({
      capabilityCode: CAP_BUILD_WRONG_SELECTOR,
      actions: [ACTION_BUILD],
      selectors: [{ selectorType: 'TARGET_TYPE', objectType: READINESS_OBJECT }],
    });
    await grant({
      capabilityCode: CAP_READY_REVOKED,
      actions: [ACTION_READY],
      selectors: [{ selectorType: 'TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
    });
    await grant({ capabilityCode: CAP_RESOLVE, actions: [CAP_RESOLVE] });
    await grant({ capabilityCode: CAP_SLICE_READ, actions: [CAP_SLICE_READ] });
    await grant({ capabilityCode: CAP_RECORD, actions: [CAP_RECORD] });

    // The other Project's own Grants and ActorSnapshot: a cross-Scope case is
    // built by declaring the other Scope, never by relaxing a check.
    otherProjectActorRef = await createActorSnapshot(identityDeps([OTHER_PROJECT]), {
      actorSnapshotId: newUuidV7(),
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE,
      projectId: OTHER_PROJECT,
    });
    await grant({
      capabilityCode: CAP_TASK_V1,
      actions: [ACTION_TASK_CREATE],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
      projectId: OTHER_PROJECT,
    });
    await grant({
      capabilityCode: CAP_READY,
      actions: [ACTION_READY],
      selectors: [{ selectorType: 'TARGET_TYPE', objectType: TASK_OBJECT_V1 }],
      projectId: OTHER_PROJECT,
    });
    await grant({
      capabilityCode: CAP_BUILD,
      actions: [ACTION_BUILD],
      selectors: [{ selectorType: 'CREATE_TARGET_TYPE', objectType: READINESS_OBJECT }],
      projectId: OTHER_PROJECT,
    });
    await grant({ capabilityCode: CAP_RESOLVE, actions: [CAP_RESOLVE], projectId: OTHER_PROJECT });
    await grant({
      capabilityCode: CAP_SLICE_READ,
      actions: [CAP_SLICE_READ],
      projectId: OTHER_PROJECT,
    });

    readinessPolicyKey = versionedPolicyKey();
    capturePolicyKey = versionedPolicyKey();
    shortTtlPolicyKey = versionedPolicyKey();
    longTtlPolicyKey = versionedPolicyKey();
    unknownFieldPolicyKey = versionedPolicyKey();
    wrongProfilePolicyKey = versionedPolicyKey();
    notYetEffectivePolicyKey = versionedPolicyKey();
    supersededPolicyKey = versionedPolicyKey();
    driftPolicyKey = versionedPolicyKey();
    await seedPolicyVersionFact({
      key: readinessPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
    });
    await seedPolicyVersionFact({
      key: capturePolicyKey,
      profileKey: CAPTURE_PROFILE,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SLICE_PURPOSE],
      },
    });
    await seedPolicyVersionFact({
      key: shortTtlPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 60 },
    });
    await seedPolicyVersionFact({
      key: longTtlPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 3600 },
    });
    await seedPolicyVersionFact({
      key: unknownFieldPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: {
        maxReadinessValiditySeconds: 900,
        unregisteredRule: 'ignored',
      },
    });
    await seedPolicyVersionFact({
      key: wrongProfilePolicyKey,
      profileKey: WORK_ORDER_VALIDATION_PROFILE,
      policyDocument: { maxValidationValiditySeconds: 900 },
    });
    await seedPolicyVersionFact({
      key: notYetEffectivePolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
      effectiveFrom: new Date(clock + 60 * 60 * 1000),
    });
    await seedPolicyVersionFact({
      key: supersededPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
    });
    const supersedingKey = {
      ...(supersededPolicyKey as unknown as Record<string, unknown>),
      versionId: newUuidV7(),
    } as unknown as Common.VersionedRef;
    await seedPolicyVersionFact({
      key: supersedingKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
      effectiveFrom: new Date(clock - 30 * 60 * 1000),
      supersedesRef: supersededPolicyKey,
    });
    await seedPolicyVersionFact({
      key: driftPolicyKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
    });

    slice = await seedSlice({ validUntil: new Date(clock + 30 * 60 * 1000) });
    expiredSlice = await seedSlice({
      validUntil: new Date(clock - 60 * 1000),
      capturedAt: new Date(clock - 60 * 60 * 1000),
    });
    revokedCapturePolicyKey = versionedPolicyKey();
    await seedPolicyVersionFact({
      key: revokedCapturePolicyKey,
      profileKey: CAPTURE_PROFILE,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SLICE_PURPOSE],
      },
    });
    revokedSlice = await seedSlice({
      validUntil: new Date(clock + 30 * 60 * 1000),
      policyKey: revokedCapturePolicyKey,
    });
    shortLivedSlice = await seedSlice({ validUntil: new Date(clock + 120 * 1000) });

    creationEntry = createCreateTaskEntry({
      taskExecutionDb: teDb,
      enterpriseProjectDb: epDb,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilityCodes: creationCapabilities,
      now: (): Date => new Date(clock),
    });
    readinessEntry = readinessEntryFor();
    readinessEntryV2 = readinessEntryFor({ readyCapability: CAP_READY_V2 });

    // One committed Task in the other Project: the visibility evidence of
    // `TE-P206-005` (a Task that exists, just not in the requested Project).
    otherProjectTaskId = (
      await createDraft('1.0', () => undefined, {
        projectId: OTHER_PROJECT,
        actorRef: otherProjectActorRef,
        principalId: OPERATOR,
      })
    ).taskId;
  });

  afterAll(async () => {
    await tePool.end();
    await epPool.end();
    await ipPool.end();
    await admin.end();
  });

  // -------------------------------------------------------------------------
  // Drivers
  // -------------------------------------------------------------------------

  async function createDraft(
    commandVersion: string,
    mutate: (payload: Record<string, unknown>) => void = () => undefined,
    options: {
      taskId?: string;
      projectId?: string;
      actorRef?: ActorSnapshotRef;
      principalId?: string;
      capabilityCodes?: TaskExecutionCreationCapabilityCodes;
      idempotencyKey?: string;
      /** Awaited after the payload is mutated, before it is hashed and sent. */
      deferred?: Promise<void>;
    } = {},
  ): Promise<{ taskId: string; snapshotId: string; definitionHash: Buffer }> {
    const projectId = options.projectId ?? PROJECT;
    const actorRef = options.actorRef ?? operatorActorRef;
    const principalId = options.principalId ?? OPERATOR;
    const capabilityCodes = options.capabilityCodes ?? creationCapabilities;
    const payload = payloadOf(commandVersion === '1.0' ? V1_FIXTURE : V2_FIXTURE);
    rewriteFixtureScopes(payload);
    const definition = record(payload.definition);
    definition.deliveryItemRef = undefined;
    delete definition.deliveryItemRef;
    definition.parentTaskRef = undefined;
    delete definition.parentTaskRef;
    definition.dependencyTaskRefs = [];
    definition.inputRefs = [];
    (payload.projectRef as Record<string, unknown>).scope = {
      enterpriseId: ENTERPRISE,
      projectId,
    };
    (payload.projectRef as Record<string, unknown>).objectId = projectId;
    mutate(payload);
    if (options.deferred !== undefined) await options.deferred;
    const taskId = options.taskId ?? newUuidV7();
    const objectType = commandVersion === '1.0' ? TASK_OBJECT_V1 : TASK_OBJECT_V2;
    const scope = { enterpriseId: ENTERPRISE, projectId };
    const hash = digestCanonicalPayload(payload as CanonicalJsonObject).hash;
    const creationPort = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes,
      now: (): Date => new Date(clock),
    });
    const creationBinding = TASK_EXECUTION_CREATION_BINDINGS.find(
      (candidate) => candidate.commandVersion === commandVersion,
    );
    if (creationBinding === undefined) throw new Error('unknown creation version');
    const view = await creationPort.authorizeCreation(
      identityDeps([projectId], {
        principalId,
        actorSnapshotId: actorRef.snapshotId,
      }),
      {
        actorSnapshotRef: actorRef,
        commandType: 'execution.create_task',
        commandVersion,
        targetRef: objectRef(objectType, taskId, scope) as unknown as Common.ObjectRef,
        commandPayloadHash: hash,
        authenticationContextHash: AUTH_HASH,
      },
    );
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    const creationDecisionRef = view.authorizationDecisionRef;
    if (creationDecisionRef === undefined) throw new Error('the creation Decision was not issued');
    const result = await creationEntry.create(
      {
        commandId: newUuidV7(),
        commandType: 'execution.create_task',
        commandVersion,
        scopeRef: scope,
        targetRef: objectRef(objectType, taskId, scope),
        actor: {
          kind: 'SNAPSHOT',
          objectType: ACTOR_OBJECT,
          objectId: actorRef.snapshotId,
          snapshotId: actorRef.snapshotId,
          scope,
          contentHash: actorRef.contentHash,
        },
        authorizationDecisionRef: creationDecisionRef,
        idempotencyKey: options.idempotencyKey ?? `wi208-draft-${taskId}`,
        correlationId: CORRELATION,
        requestedAt: new Date(clock).toISOString(),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHashOf(hash.toString('hex')),
        },
      },
      { authenticationContextHash: AUTH_HASH },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    const root = (
      await admin.query<{
        current_definition_snapshot_id: string;
        current_definition_hash: Buffer;
      }>(
        `SELECT current_definition_snapshot_id, current_definition_hash
           FROM task_execution.task WHERE task_id = $1`,
        [taskId],
      )
    ).rows[0];
    if (root === undefined) throw new Error('the DRAFT Task was not committed');
    return {
      taskId,
      snapshotId: root.current_definition_snapshot_id,
      definitionHash: root.current_definition_hash,
    };
  }

  /** The outcome of one `execution.create_task` attempt, refusal included. */
  async function attemptCreateDraft(
    commandVersion: string,
    mutate: (payload: Record<string, unknown>) => void,
    options: { taskId?: string } = {},
  ): Promise<Attempt> {
    const payload = payloadOf(commandVersion === '1.0' ? V1_FIXTURE : V2_FIXTURE);
    rewriteFixtureScopes(payload);
    const definition = record(payload.definition);
    definition.deliveryItemRef = undefined;
    delete definition.deliveryItemRef;
    definition.parentTaskRef = undefined;
    delete definition.parentTaskRef;
    definition.dependencyTaskRefs = [];
    definition.inputRefs = [];
    (payload.projectRef as Record<string, unknown>).scope = {
      enterpriseId: ENTERPRISE,
      projectId: PROJECT,
    };
    (payload.projectRef as Record<string, unknown>).objectId = PROJECT;
    mutate(payload);
    const taskId = options.taskId ?? newUuidV7();
    const objectType = commandVersion === '1.0' ? TASK_OBJECT_V1 : TASK_OBJECT_V2;
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };
    const hash = digestCanonicalPayload(payload as CanonicalJsonObject).hash;
    const creationPort = createTaskExecutionCreationAuthorizationPort({
      capabilityCodes: creationCapabilities,
      now: (): Date => new Date(clock),
    });
    const view = await creationPort.authorizeCreation(identityDeps([PROJECT]), {
      actorSnapshotRef: operatorActorRef,
      commandType: 'execution.create_task',
      commandVersion,
      targetRef: objectRef(objectType, taskId, scope) as unknown as Common.ObjectRef,
      commandPayloadHash: hash,
      authenticationContextHash: AUTH_HASH,
    });
    const creationDecision = view.authorizationDecisionRef;
    if (view.outcome !== 'ALLOW' || creationDecision === undefined) {
      return {
        code: 'NO_DECISION',
        message: 'the readiness Port issued no Decision',
        result: undefined,
        thrown: true,
      };
    }
    return attempt(() =>
      creationEntry.create(
        {
          commandId: newUuidV7(),
          commandType: 'execution.create_task',
          commandVersion,
          scopeRef: scope,
          targetRef: objectRef(objectType, taskId, scope),
          actor: {
            kind: 'SNAPSHOT',
            objectType: ACTOR_OBJECT,
            objectId: OPERATOR_ACTOR,
            snapshotId: OPERATOR_ACTOR,
            scope,
            contentHash: operatorActorRef.contentHash,
          },
          authorizationDecisionRef: creationDecision,
          idempotencyKey: `wi208-attempt-draft-${taskId}`,
          correlationId: CORRELATION,
          requestedAt: new Date(clock).toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: contentHashOf(hash.toString('hex')),
          },
        },
        { authenticationContextHash: AUTH_HASH },
      ),
    );
  }

  function definitionRef(snapshotId: string, definitionHash: Buffer): CanonicalJsonObject {
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: DEFINITION_OBJECT,
      objectId: snapshotId,
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      contentHash: contentHashOf(definitionHash.toString('hex')),
    } as unknown as CanonicalJsonObject;
  }

  /** One readiness Decision, or the DENY view when no Grant covers the entry. */
  async function readinessDecisionView(input: {
    commandType: string;
    commandVersion: string;
    targetRef: Common.ObjectRef;
    payloadHash: Buffer;
    capabilityCodes?: TaskExecutionReadinessCapabilityCodes;
    allowedProjectIds?: readonly string[];
    actorRef?: ActorSnapshotRef;
    principalId?: string;
    now?: Date;
  }): Promise<{
    readonly outcome: 'ALLOW' | 'DENY';
    readonly decisionRef?: Common.ContentAddressedRef;
    readonly expiresAt?: string;
    readonly reasons: readonly string[];
  }> {
    const allowedProjectIds = input.allowedProjectIds ?? [PROJECT];
    const port = createTaskExecutionReadinessAuthorizationPort({
      capabilityCodes: input.capabilityCodes ?? readinessCapabilities,
      now: (): Date => input.now ?? new Date(clock),
    });
    const view = await port.authorizeReadiness(
      identityDeps(allowedProjectIds, {
        principalId: input.principalId ?? OPERATOR,
        actorSnapshotId: (input.actorRef ?? operatorActorRef).snapshotId,
      }),
      {
        actorSnapshotRef: input.actorRef ?? operatorActorRef,
        commandType: input.commandType,
        commandVersion: input.commandVersion,
        targetRef: input.targetRef,
        commandPayloadHash: input.payloadHash,
        authenticationContextHash: AUTH_HASH,
      },
    );
    return {
      outcome: view.outcome,
      reasons: view.reasons,
      ...(view.authorizationDecisionRef === undefined
        ? {}
        : { decisionRef: view.authorizationDecisionRef }),
      ...(view.expiresAt === undefined ? {} : { expiresAt: view.expiresAt }),
    };
  }

  async function readinessDecision(input: {
    commandType: string;
    commandVersion: string;
    targetRef: Common.ObjectRef;
    payloadHash: Buffer;
    capabilityCodes?: TaskExecutionReadinessCapabilityCodes;
    allowedProjectIds?: readonly string[];
    actorRef?: ActorSnapshotRef;
    principalId?: string;
    now?: Date;
  }): Promise<Common.ContentAddressedRef> {
    const view = await readinessDecisionView(input);
    expect(view.outcome, JSON.stringify(view)).toBe('ALLOW');
    if (view.decisionRef === undefined) throw new Error('the readiness Decision was not issued');
    return view.decisionRef;
  }

  function actorRefJson(
    actorRef: ActorSnapshotRef = operatorActorRef,
    scope: Record<string, string> = { enterpriseId: ENTERPRISE, projectId: PROJECT },
  ): CanonicalJsonObject {
    return {
      kind: 'SNAPSHOT',
      objectType: ACTOR_OBJECT,
      objectId: actorRef.snapshotId,
      snapshotId: actorRef.snapshotId,
      scope,
      contentHash: actorRef.contentHash,
    } as unknown as CanonicalJsonObject;
  }

  async function buildReadiness(input: {
    taskId: string;
    commandVersion: string;
    snapshotId: string;
    definitionHash: Buffer;
    evaluatorRefValue?: CanonicalJsonObject;
    policyRefValue?: CanonicalJsonObject;
    taskObjectType?: string;
    /** Overrides of the `payload.taskRef` identity of `TE-P206-003`. */
    taskRefObjectId?: string;
    taskRefScope?: Record<string, string>;
    /** A verbatim `payload.taskDefinitionRef` override of `TE-P206-004`. */
    definitionRefValue?: CanonicalJsonObject;
    judgmentId?: string;
    idempotencyKey?: string;
    entry?: TaskReadinessEntry;
    requestedAt?: string;
    commandId?: string;
    /** Project scope of the Envelope (and therefore of the Decision). */
    projectId?: string;
    actorRef?: ActorSnapshotRef;
    principalId?: string;
    capabilityCodes?: TaskExecutionReadinessCapabilityCodes;
    /** A presented Decision that must not cover this request (`TE-P206-013`). */
    presentedDecisionRef?: Common.ContentAddressedRef;
    /** A substitute payload hash the Decision is signed for (`TE-P206-013`). */
    decisionPayloadHash?: Buffer;
    decisionTargetRef?: Common.ObjectRef;
    /**
     * Mint the Decision for the *unmutated* Task target while the submitted
     * Envelope carries a mutated one: the target closure of the readiness Port
     * is what must answer, not the Decision lookup.
     */
    decisionForDefaultTarget?: boolean;
    /** An extra payload member a caller might hope the Handler would honour. */
    payloadExtra?: Record<string, unknown>;
  }): Promise<CommandResult> {
    const judgmentId = input.judgmentId ?? newUuidV7();
    const projectId = input.projectId ?? PROJECT;
    const actorRef = input.actorRef ?? operatorActorRef;
    const scope = { enterpriseId: ENTERPRISE, projectId };
    const payload = {
      taskRef: objectRef(
        input.taskObjectType ?? TASK_OBJECT_V1,
        input.taskRefObjectId ?? input.taskId,
        input.taskRefScope ?? scope,
      ),
      taskDefinitionRef:
        input.definitionRefValue ?? definitionRef(input.snapshotId, input.definitionHash),
      policyRef: (input.policyRefValue ?? readinessPolicyKey) as unknown as Record<string, unknown>,
      evaluatorRef: (input.evaluatorRefValue ?? evaluatorRef()) as Record<string, unknown>,
      ...(input.payloadExtra ?? {}),
    } as unknown as CanonicalJsonObject;
    const payloadHash = digestCanonicalPayload(payload).hash;
    const targetRef = objectRef(READINESS_OBJECT, judgmentId, scope) as unknown as Common.ObjectRef;
    const decisionRef =
      input.presentedDecisionRef ??
      (await readinessDecision({
        commandType: 'execution.build_task_readiness',
        commandVersion: '1.0',
        targetRef: input.decisionTargetRef ?? targetRef,
        payloadHash: input.decisionPayloadHash ?? payloadHash,
        ...(input.capabilityCodes === undefined ? {} : { capabilityCodes: input.capabilityCodes }),
        allowedProjectIds: [projectId],
        actorRef,
        principalId: input.principalId ?? OPERATOR,
      }));
    return (input.entry ?? readinessEntry).build(
      {
        commandId: input.commandId ?? newUuidV7(),
        commandType: 'execution.build_task_readiness',
        commandVersion: '1.0',
        scopeRef: scope,
        targetRef,
        actor: actorRefJson(actorRef, scope),
        authorizationDecisionRef: decisionRef,
        idempotencyKey: input.idempotencyKey ?? `wi208-build-${judgmentId}`,
        correlationId: CORRELATION,
        requestedAt: input.requestedAt ?? new Date(clock).toISOString(),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHashOf(payloadHash.toString('hex')),
        },
      },
      {
        authenticationContextHash: AUTH_HASH,
        resolutionActorSnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: ACTOR_OBJECT,
          objectId: actorRef.snapshotId,
          snapshotId: actorRef.snapshotId,
          scope,
          contentHash: actorRef.contentHash,
        },
      },
    );
  }

  /**
   * `execution.mark_task_ready@1.0` through the composition entry: the consumer
   * Decision is the one covering *this* entry of Spec 001 §15.5, the exact Task
   * spelling of the creation major and the post-judgment aggregate version.
   */
  async function markReady(input: {
    taskId: string;
    judgmentId: string;
    judgmentPayloadHash: Buffer;
    aggregateVersion: number | string;
    taskObjectType?: string;
    /** Overrides of the Envelope `targetRef` of `TE-P206-003`. */
    targetObjectId?: string;
    targetScope?: Record<string, string>;
    judgmentScope?: Record<string, string>;
    requestedAt?: string;
    idempotencyKey?: string;
    commandId?: string;
    entry?: TaskReadinessEntry;
    projectId?: string;
    actorRef?: ActorSnapshotRef;
    principalId?: string;
    capabilityCodes?: TaskExecutionReadinessCapabilityCodes;
    presentedDecisionRef?: Common.ContentAddressedRef;
    decisionPayloadHash?: Buffer;
    decisionTargetRef?: Common.ObjectRef;
    /** Present a `<spelling-or-shape>` as the Envelope `targetRef.objectType`. */
    envelopeTargetType?: string;
    /**
     * Mint the Decision for the *unmutated* Task target while the submitted
     * Envelope carries a mutated one: the target closure of the readiness Port
     * is what must answer, not the Decision lookup.
     */
    decisionForDefaultTarget?: boolean;
    /** Receives the Decision this call presented, so a replay can reuse it. */
    decisionSink?: { ref?: Common.ContentAddressedRef };
    beforePayloadMutation?: (payload: Record<string, unknown>) => void;
  }): Promise<CommandResult> {
    const projectId = input.projectId ?? PROJECT;
    const actorRef = input.actorRef ?? operatorActorRef;
    const scope = { enterpriseId: ENTERPRISE, projectId };
    const targetRef = {
      kind: 'OBJECT',
      objectType: input.envelopeTargetType ?? input.taskObjectType ?? TASK_OBJECT_V1,
      objectId: input.targetObjectId ?? input.taskId,
      scope: input.targetScope ?? scope,
    };
    const payload = {
      readinessSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: READINESS_OBJECT,
        objectId: input.judgmentId,
        snapshotId: input.judgmentId,
        scope: input.judgmentScope ?? scope,
        contentHash: contentHashOf(input.judgmentPayloadHash.toString('hex')),
      },
      requestedAt: input.requestedAt ?? new Date(clock).toISOString(),
    } as unknown as Record<string, unknown>;
    input.beforePayloadMutation?.(payload);
    const payloadHash = digestCanonicalPayload(payload as CanonicalJsonObject).hash;
    const decisionRef =
      input.presentedDecisionRef ??
      (await readinessDecision({
        commandType: 'execution.mark_task_ready',
        commandVersion: '1.0',
        targetRef: (input.decisionTargetRef ??
          (input.decisionForDefaultTarget === true
            ? objectRef(input.taskObjectType ?? TASK_OBJECT_V1, input.taskId, scope)
            : targetRef)) as unknown as Common.ObjectRef,
        payloadHash: input.decisionPayloadHash ?? payloadHash,
        ...(input.capabilityCodes === undefined ? {} : { capabilityCodes: input.capabilityCodes }),
        allowedProjectIds: [projectId],
        actorRef,
        principalId: input.principalId ?? OPERATOR,
      }));
    if (input.decisionSink !== undefined) input.decisionSink.ref = decisionRef;
    return (input.entry ?? readinessEntry).markReady(
      {
        commandId: input.commandId ?? newUuidV7(),
        commandType: 'execution.mark_task_ready',
        commandVersion: '1.0',
        scopeRef: scope,
        targetRef,
        actor: actorRefJson(actorRef, scope),
        authorizationDecisionRef: decisionRef,
        expectedAggregateVersion: input.aggregateVersion,
        idempotencyKey: input.idempotencyKey ?? `wi208-ready-${input.taskId}`,
        correlationId: CORRELATION,
        requestedAt: input.requestedAt ?? new Date(clock).toISOString(),
        payload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHashOf(payloadHash.toString('hex')),
        },
      },
      {
        authenticationContextHash: AUTH_HASH,
        resolutionActorSnapshotRef: {
          kind: 'SNAPSHOT',
          objectType: ACTOR_OBJECT,
          objectId: actorRef.snapshotId,
          snapshotId: actorRef.snapshotId,
          scope,
          contentHash: actorRef.contentHash,
        },
      },
    );
  }

  async function judgmentRow(judgmentId: string) {
    return (
      await admin.query<{
        judgment_id: string;
        judgment_kind: string;
        task_id: string;
        task_definition_snapshot_id: string;
        task_definition_hash: Buffer;
        policy_content_hash: Buffer;
        policy_effective_from: Date;
        policy_superseded_at: Date | null;
        input_hash: Buffer;
        evaluated_at: Date;
        valid_until: Date;
        ready: boolean;
        canonical_payload: Record<string, unknown>;
        payload_hash: Buffer;
        request_payload_hash: Buffer;
        source_command_id: string;
      }>(
        `SELECT judgment_id, judgment_kind, task_id, task_definition_snapshot_id,
                task_definition_hash, policy_content_hash, policy_effective_from,
                policy_superseded_at, input_hash, evaluated_at, valid_until, ready,
                canonical_payload, payload_hash, request_payload_hash, source_command_id
           FROM task_execution.execution_judgment WHERE judgment_id = $1`,
        [judgmentId],
      )
    ).rows[0];
  }

  async function taskStatus(taskId: string) {
    return (
      await admin.query<{ status: string; aggregate_version: string }>(
        'SELECT status, aggregate_version::text FROM task_execution.task WHERE task_id = $1',
        [taskId],
      )
    ).rows[0];
  }

  async function countRows(table: string): Promise<number> {
    return (
      (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n ?? -1
    );
  }

  // -------------------------------------------------------------------------
  // Observation, attempt and probe helpers
  // -------------------------------------------------------------------------

  interface Attempt {
    /** The stable code: a business error code, or the thrown boundary code. */
    readonly code: string;
    /** The driver message; the stable code alone hides *where* a throw came from. */
    readonly message: string;
    readonly result: CommandResult | undefined;
    readonly thrown: boolean;
  }

  interface TaskState {
    readonly status: string | undefined;
    readonly aggregateVersion: string | undefined;
    readonly outbox: readonly {
      event_type: string;
      event_version: string;
      aggregate_version: string;
      payload: Record<string, unknown>;
      payload_hash: Buffer;
      occurred_at: Date;
    }[];
    readonly edges: readonly { owner_object_type: string; reference_path: string }[];
    readonly judgmentIds: readonly string[];
  }

  interface StatementFailure {
    readonly code: string;
    readonly message: string;
  }

  /** A driver error reduced to its SQLSTATE/boundary code and message. */
  function statementFailure(error: unknown): StatementFailure {
    if (error !== null && typeof error === 'object') {
      const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
      const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
      return { code: code ?? 'UNCLASSIFIED_THROW', message };
    }
    return { code: 'UNCLASSIFIED_THROW', message: '' };
  }

  function resultCode(result: CommandResult): string {
    if (result.status === 'REJECTED') return result.errorCode;
    if (result.status === 'DUPLICATE') return result.errorCode ?? 'DUPLICATE';
    return 'COMMITTED';
  }

  /**
   * One command attempt reduced to its stable code. A refusal is a business
   * `REJECTED` result for handler decisions and a thrown boundary error for the
   * composition/idempotency layer; both are the same observation for a caller.
   */
  async function attempt(run: () => Promise<CommandResult>): Promise<Attempt> {
    try {
      const result = await run();
      return { code: resultCode(result), message: '', result, thrown: false };
    } catch (error) {
      const failure = statementFailure(error);
      return {
        code: failure.code,
        message: failure.message,
        result: undefined,
        thrown: true,
      };
    }
  }

  /** Every row one Task owns in a state table of the readiness flow. */
  async function taskState(taskId: string): Promise<TaskState> {
    const outbox = (
      await admin.query<{
        event_type: string;
        event_version: string;
        aggregate_version: string;
        payload: Record<string, unknown>;
        payload_hash: Buffer;
        occurred_at: Date;
      }>(
        `SELECT event_type, event_version, aggregate_version::text, payload, payload_hash, occurred_at
           FROM task_execution.outbox_event
          WHERE aggregate_id = $1 ORDER BY occurred_at, event_type`,
        [taskId],
      )
    ).rows;
    const edges = (
      await admin.query<{ owner_object_type: string; reference_path: string }>(
        `SELECT owner_object_type, reference_path
           FROM task_execution.reference_edge
          WHERE owner_object_id = $1 OR target_object_id = $1
          ORDER BY owner_object_id, reference_path`,
        [taskId],
      )
    ).rows;
    const judgments = (
      await admin.query<{ judgment_id: string }>(
        `SELECT judgment_id FROM task_execution.execution_judgment
          WHERE task_id = $1 ORDER BY created_at, judgment_id`,
        [taskId],
      )
    ).rows;
    const status = await taskStatus(taskId);
    return {
      status: status?.status,
      aggregateVersion: status?.aggregate_version,
      outbox,
      edges,
      judgmentIds: judgments.map((row) => row.judgment_id),
    };
  }

  async function judgmentCountForTask(taskId: string): Promise<number> {
    return (
      (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM task_execution.execution_judgment WHERE task_id = $1',
          [taskId],
        )
      ).rows[0]?.n ?? -1
    );
  }

  async function receiptRows(idempotencyKey: string) {
    return (
      await admin.query<{
        outcome: string;
        command_type: string;
        command_version: string;
        target_type: string;
        target_id: string;
        result_payload: unknown;
      }>(
        `SELECT outcome, command_type, command_version, target_type, target_id, result_payload
           FROM task_execution.command_receipt WHERE idempotency_key = $1`,
        [idempotencyKey],
      )
    ).rows;
  }

  async function auditRows(input: {
    commandType?: string;
    targetId?: string;
    outcome?: string;
  }): Promise<{ outcome: string; error_code: string | null; command_type: string }[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (input.commandType !== undefined) {
      values.push(input.commandType);
      conditions.push(`command_type = $${values.length}`);
    }
    if (input.targetId !== undefined) {
      values.push(input.targetId);
      conditions.push(`target_id = $${values.length}`);
    }
    if (input.outcome !== undefined) {
      values.push(input.outcome);
      conditions.push(`outcome = $${values.length}`);
    }
    return (
      await admin.query<{ outcome: string; error_code: string | null; command_type: string }>(
        `SELECT outcome, error_code, command_type FROM task_execution.audit_record
          ${conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`}
          ORDER BY recorded_at`,
        values,
      )
    ).rows;
  }

  /** A DRAFT Task whose frozen definition declares the given references. */
  async function createDraftWith(
    definition: {
      dependencyTaskRefs?: readonly unknown[];
      inputRefs?: readonly unknown[];
    },
    options: { commandVersion?: string; taskId?: string } = {},
  ): Promise<{ taskId: string; snapshotId: string; definitionHash: Buffer }> {
    return createDraft(
      options.commandVersion ?? '1.0',
      (payload) => {
        const frozen = record(payload.definition);
        if (definition.dependencyTaskRefs !== undefined) {
          frozen.dependencyTaskRefs = [...definition.dependencyTaskRefs];
        }
        if (definition.inputRefs !== undefined) {
          frozen.inputRefs = [...definition.inputRefs];
        }
      },
      options.taskId === undefined ? {} : { taskId: options.taskId },
    );
  }

  interface CommittedJudgment {
    readonly judgmentId: string;
    readonly payloadHash: Buffer;
    readonly payload: Record<string, unknown>;
    readonly taskAggregateVersion: string;
  }

  /** The judgment a committed build produced, read back from its own row. */
  async function committedJudgment(result: CommandResult): Promise<CommittedJudgment> {
    if (result.status !== 'COMMITTED') {
      throw new Error(`the readiness build did not commit: ${JSON.stringify(result)}`);
    }
    const ref = record(record(result.resultPayload).data).readinessSnapshotRef;
    const judgmentId = record(ref).objectId;
    if (typeof judgmentId !== 'string') throw new Error('the result carries no judgment identity');
    const row = await judgmentRow(judgmentId);
    if (row === undefined) throw new Error('the committed judgment is not readable');
    return {
      judgmentId,
      payloadHash: row.payload_hash,
      payload: row.canonical_payload,
      taskAggregateVersion: String(record(row.canonical_payload).taskAggregateVersion),
    };
  }

  /** The committed judgment of one freshly built Task, with its build result. */
  async function buildTaskJudgment(
    draft: { taskId: string; snapshotId: string; definitionHash: Buffer },
    overrides: {
      policyRefValue?: CanonicalJsonObject;
      evaluatorRefValue?: CanonicalJsonObject;
      taskObjectType?: string;
      entry?: TaskReadinessEntry;
      idempotencyKey?: string;
    } = {},
  ): Promise<{ readonly result: CommandResult; readonly judgment: CommittedJudgment }> {
    const judgmentId = newUuidV7();
    const result = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId,
      idempotencyKey: overrides.idempotencyKey ?? `wi208-build-${judgmentId}`,
      ...overrides,
    });
    return { result, judgment: await committedJudgment(result) };
  }

  /** One check row of a committed judgment payload, by its own check code. */
  function checkRow(payload: Record<string, unknown>, code: string): Record<string, unknown> {
    const checks = Array.isArray(payload.checks) ? (payload.checks as unknown[]) : [];
    const row = checks.map(record).find((candidate) => candidate.checkCode === code);
    if (row === undefined) throw new Error(`the judgment carries no ${code} row`);
    return row;
  }

  /**
   * A statement that must be refused by the database, reduced to its SQLSTATE
   * and message. Autocommit on purpose: a refused statement never leaves the
   * admin client in a failed transaction.
   */
  async function pgFailure(run: () => Promise<unknown>): Promise<StatementFailure> {
    try {
      await run();
    } catch (error) {
      return statementFailure(error);
    }
    throw new Error('expected the statement to be refused by the database');
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
        GRANT_DECISION,
        DECISION_HASH,
        new Date(clock + 60 * 60 * 1000),
        ENTERPRISE,
        [...allowedProjectIds],
        CORRELATION,
      ],
    );
  }

  /** The same probe, reduced to the SQLSTATE of the refused statement. */
  async function asAppRoleFailure(
    role: string,
    allowedProjectIds: readonly string[],
    sql: string,
    values: readonly unknown[],
    withContext = true,
  ): Promise<StatementFailure> {
    const client = await tePool.connect();
    try {
      await client.query('BEGIN');
      if (withContext) {
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await appRoleContext(client, allowedProjectIds);
      }
      await client.query(`SET LOCAL ROLE ${role}`);
      try {
        await client.query(sql, [...values]);
      } catch (error) {
        return statementFailure(error);
      }
      return { code: 'NO_FAILURE', message: 'the statement was accepted' };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** The rows the application role can read (RLS decides, context or not). */
  async function asAppRoleCount(
    role: string,
    allowedProjectIds: readonly string[],
    sql: string,
    values: readonly unknown[] = [],
    withContext = true,
  ): Promise<number> {
    const client = await tePool.connect();
    try {
      await client.query('BEGIN');
      if (withContext) {
        await client.query('SET LOCAL ROLE platform_context_establisher');
        await appRoleContext(client, allowedProjectIds);
      }
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await client.query<{ n: number }>(sql, [...values]);
      return result.rows[0]?.n ?? -1;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** The exact state a case must not change: status, version, edges, Outbox. */
  async function expectUntouched(taskId: string, before: TaskState): Promise<void> {
    const after = await taskState(taskId);
    expect(after.status).toBe(before.status);
    expect(after.aggregateVersion).toBe(before.aggregateVersion);
    expect(after.edges).toEqual(before.edges);
    expect(after.outbox).toEqual(before.outbox);
    expect(after.judgmentIds).toEqual(before.judgmentIds);
  }

  // -------------------------------------------------------------------------
  // TE-P206-001 / 002 — the two positive producer paths
  // -------------------------------------------------------------------------

  async function setHistoricalTaskStatus(taskId: string, status: string) {
    // Seed an historical dependency state; no cancellation or Completion action is claimed.
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL session_replication_role=replica');
      const result = await admin.query(
        'UPDATE task_execution.task SET status=$2 WHERE task_id=$1',
        [taskId, status],
      );
      await admin.query('COMMIT');
      return result;
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    }
  }

  it('TE-P206-001 produces a ready judgment for a v1 DRAFT Task', async () => {
    const draft = await createDraft('1.0');
    const outboxBefore = await countRows('task_execution.outbox_event');
    const judgmentId = newUuidV7();
    const result = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    if (result.status !== 'COMMITTED') throw new Error('the readiness build did not commit');
    const readinessSnapshotRef = record(record(result.resultPayload).data).readinessSnapshotRef;
    expect(readinessSnapshotRef).toMatchObject({
      kind: 'SNAPSHOT',
      objectType: READINESS_OBJECT,
      objectId: judgmentId,
      snapshotId: judgmentId,
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    });

    const row = await judgmentRow(judgmentId);
    expect(row?.judgment_kind).toBe('TASK_READINESS');
    expect(row?.task_id).toBe(draft.taskId);
    expect(row?.task_definition_snapshot_id).toBe(draft.snapshotId);
    expect(row?.task_definition_hash.equals(draft.definitionHash)).toBe(true);
    expect(row?.ready).toBe(true);
    const payload = row?.canonical_payload ?? {};
    expect(payload.taskAggregateVersion).toBe('1');
    expect(record(payload.taskRef).objectType).toBe(TASK_OBJECT_V1);
    expect(record(record(payload.taskDefinitionRef).contentHash).digest).toBe(
      draft.definitionHash.toString('hex'),
    );
    const checks = payload.checks as Record<string, unknown>[];
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      checkCode: 'NO_BLOCKING_INFORMATION_REQUEST',
      outcome: 'SATISFIED',
    });
    expect(payload.dependencies).toEqual([]);
    expect(payload.inputs).toEqual([]);
    expect(payload.blockers).toEqual([]);
    const recomputed = digestCanonicalPayload(row?.canonical_payload as CanonicalJsonObject);
    expect(recomputed.hash.equals(row?.payload_hash ?? Buffer.alloc(0))).toBe(true);
    expect(
      recomputed.hash.equals(
        Buffer.from(String(record(record(readinessSnapshotRef).contentHash).digest), 'hex'),
      ),
    ).toBe(true);

    // Receipt, Audit and Edges commit with the judgment; the producer writes no
    // Outbox row because no readiness Event is registered.
    const receipt = (
      await admin.query<{ outcome: string; command_version: string; target_type: string }>(
        `SELECT outcome, command_version, target_type FROM task_execution.command_receipt
          WHERE target_id = $1`,
        [judgmentId],
      )
    ).rows;
    expect(receipt).toEqual([
      { outcome: 'COMMITTED', command_version: '1.0', target_type: READINESS_OBJECT },
    ]);
    const edges = (
      await admin.query<{ reference_path: string; target_object_type: string }>(
        `SELECT reference_path, target_object_type FROM task_execution.reference_edge
          WHERE owner_object_id = $1 ORDER BY reference_path`,
        [judgmentId],
      )
    ).rows;
    expect(edges.map((edge) => edge.reference_path)).toEqual([
      '/evaluatorRef',
      '/policyVersionRef',
      '/taskDefinitionRef',
      '/taskRef',
    ]);
    expect(edges.find((edge) => edge.reference_path === '/taskRef')?.target_object_type).toBe(
      TASK_OBJECT_V1,
    );
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });

  it('TE-P206-002 produces a ready judgment for a v2 DRAFT Task', async () => {
    const draft = await createDraft('2.0');
    const judgmentId = newUuidV7();
    const result = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '2.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      taskObjectType: TASK_OBJECT_V2,
      judgmentId,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
    const row = await judgmentRow(judgmentId);
    expect(row?.ready).toBe(true);
    expect(record(record(row?.canonical_payload).taskRef)).toMatchObject({
      objectType: TASK_OBJECT_V2,
      objectId: draft.taskId,
    });
  });

  // -------------------------------------------------------------------------
  // TE-P206-018 — registered surface and historical facts
  // -------------------------------------------------------------------------

  it('TE-P206-018 keeps the registered surface and the historical facts unchanged', () => {
    const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
      operations: { type: string; version: string; kind: string; owner: string }[];
    };
    expect(catalog.operations).toHaveLength(237);
    const executionEvents = catalog.operations.filter(
      (operation) => operation.kind === 'EVENT' && operation.type.startsWith('execution.'),
    );
    expect(executionEvents).toHaveLength(12);
    expect(
      catalog.operations.some((operation) => operation.type === 'execution.TaskReadinessBuilt'),
    ).toBe(false);
    expect(
      catalog.operations.filter((operation) => operation.owner === 'task-execution'),
    ).toHaveLength(62);
    expect(
      registry.validateOperation('execution.mark_task_ready', '1.0', {
        commandId: newUuidV7(),
        commandType: 'execution.mark_task_ready',
        commandVersion: '1.0',
        scopeRef: { enterpriseId: ENTERPRISE, projectId: PROJECT },
        targetRef: objectRef(TASK_OBJECT_V1, newUuidV7(), {
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
        }),
        actor: objectRef(ACTOR_OBJECT, OPERATOR_ACTOR, { enterpriseId: ENTERPRISE }),
        authorizationDecisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: DECISION_OBJECT,
          objectId: newUuidV7(),
          scope: { enterpriseId: ENTERPRISE },
          contentHash: contentHashOf(DECISION_HASH.toString('hex')),
        },
        expectedAggregateVersion: 1,
        idempotencyKey: 'wi208-mark-ready-registered-shape',
        correlationId: CORRELATION,
        requestedAt: new Date(clock).toISOString(),
        payload: {
          readinessSnapshotRef: {
            kind: 'SNAPSHOT',
            objectType: READINESS_OBJECT,
            objectId: newUuidV7(),
            snapshotId: newUuidV7(),
            scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
            contentHash: contentHashOf(DECISION_HASH.toString('hex')),
          },
          requestedAt: new Date(clock).toISOString(),
        },
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: contentHashOf(DECISION_HASH.toString('hex')),
        },
      }),
    ).toMatchObject({ valid: true });
  });

  // -------------------------------------------------------------------------
  // TE-P206-003 — R-206-1 on both sides
  // -------------------------------------------------------------------------

  it('TE-P206-003 closes Task reference identity on both sides', async () => {
    const v1 = await createDraft('1.0');
    const v2 = await createDraft('2.0');
    const beforeV1 = await taskState(v1.taskId);
    const beforeV2 = await taskState(v2.taskId);
    const judgmentBefore = await countRows('task_execution.execution_judgment');
    const outboxBefore = await countRows('task_execution.outbox_event');

    const buildFor = (draft: { taskId: string; snapshotId: string; definitionHash: Buffer }) => ({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
    });

    // The producer closes R-206-1 in the owning Handler. Where the registered
    // Schema can already express a form, the Handler's own code is what a
    // caller sees; a bare local name, a case variant and a `projectId`-only
    // Scope are not namespace/scope shapes the registered Envelope can carry at
    // all, so those stop one layer earlier with `API_VALUE_INVALID` — the same
    // refusal, closed at the registered boundary instead of in the Handler.
    const producerCases: readonly {
      readonly label: string;
      readonly expected: string;
      readonly run: () => Promise<CommandResult>;
    }[] = [
      {
        label: 'a v1 Task addressed with the other major spelling',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskObjectType: TASK_OBJECT_V2 }),
      },
      {
        label: 'a v2 Task addressed with the v1 spelling',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          buildReadiness({
            taskId: v2.taskId,
            commandVersion: '2.0',
            snapshotId: v2.snapshotId,
            definitionHash: v2.definitionHash,
            taskObjectType: TASK_OBJECT_V1,
          }),
      },
      {
        label: 'the bare local name Task',
        expected: API_VALUE_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskObjectType: 'Task' }),
      },
      {
        label: 'a case variant of the published spelling',
        expected: API_VALUE_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskObjectType: 'Execution.Task' }),
      },
      {
        label: 'an objectId that is not the Task under judgement',
        expected: NOT_FOUND,
        run: () => buildReadiness({ ...buildFor(v1), taskRefObjectId: newUuidV7() }),
      },
      {
        label: 'the Platform Scope form {}',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskRefScope: {} }),
      },
      {
        label: 'an Enterprise-only Scope',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskRefScope: { enterpriseId: ENTERPRISE } }),
      },
      {
        label: 'a projectId-only Scope',
        expected: API_VALUE_INVALID,
        run: () => buildReadiness({ ...buildFor(v1), taskRefScope: { projectId: PROJECT } }),
      },
      {
        label: 'another Project of this Enterprise',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          buildReadiness({
            ...buildFor(v1),
            taskRefScope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
          }),
      },
      {
        label: 'the identity of a Task that only exists in another Project',
        expected: NOT_FOUND,
        run: () => buildReadiness({ ...buildFor(v1), taskRefObjectId: otherProjectTaskId }),
      },
    ];
    for (const producerCase of producerCases) {
      const outcome = await attempt(producerCase.run);
      expect(outcome.code, producerCase.label).toBe(producerCase.expected);
    }

    // The exterior never distinguishes "the other spelling" from "another
    // Project Scope": both are the one R-206-1 refusal.
    const wrongSpelling = await attempt(() =>
      buildReadiness({ ...buildFor(v1), taskObjectType: TASK_OBJECT_V2 }),
    );
    const otherProjectScope = await attempt(() =>
      buildReadiness({
        ...buildFor(v1),
        idempotencyKey: `wi208-003-other-project-${newUuidV7()}`,
        taskRefScope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
      }),
    );
    expect(otherProjectScope.code).toBe(wrongSpelling.code);

    // … and a Task that really exists in another Project is indistinguishable
    // from one that exists nowhere: the receipts agree field by field.
    const existingElsewhere = await attempt(() =>
      buildReadiness({
        ...buildFor(v1),
        idempotencyKey: 'wi208-003-invisible-existing',
        taskRefObjectId: otherProjectTaskId,
      }),
    );
    const nowhere = await attempt(() =>
      buildReadiness({
        ...buildFor(v1),
        idempotencyKey: 'wi208-003-invisible-absent',
        taskRefObjectId: newUuidV7(),
      }),
    );
    expect(existingElsewhere.code).toBe(NOT_FOUND);
    expect(nowhere.code).toBe(NOT_FOUND);
    const existingReceipt = (await receiptRows('wi208-003-invisible-existing')).at(0);
    const absentReceipt = (await receiptRows('wi208-003-invisible-absent')).at(0);
    expect(existingReceipt?.outcome).toBe('REJECTED');
    expect(existingReceipt?.result_payload).toEqual(absentReceipt?.result_payload);

    // No judgment, no Root write and no Outbox row for any refusal above.
    expect(await countRows('task_execution.execution_judgment')).toBe(judgmentBefore);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
    await expectUntouched(v1.taskId, beforeV1);
    await expectUntouched(v2.taskId, beforeV2);

    // The consumer side. A judgment of the v1 Task is the subject of every
    // attempt; only the presented Envelope `targetRef` changes.
    const judgment = await buildReadiness({
      ...buildFor(v1),
      idempotencyKey: 'wi208-003-consumer-judgment',
    });
    expect(judgment, JSON.stringify(judgment)).toMatchObject({ status: 'COMMITTED' });
    const consumerJudgmentId = (
      await admin.query<{ judgment_id: string }>(
        `SELECT judgment_id FROM task_execution.execution_judgment
          WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [v1.taskId],
      )
    ).rows[0]?.judgment_id;
    if (consumerJudgmentId === undefined) throw new Error('no readiness judgment was committed');
    const consumerJudgment = await judgmentRow(consumerJudgmentId);
    if (consumerJudgment === undefined) throw new Error('the judgment row is not readable');
    const readyBefore = await taskState(v1.taskId);

    // R-206-1 fixes one exterior for every Task-reference closure failure: the
    // spelling dimension is closed by the owning Handler and the target
    // identity/Scope dimension by the readiness Port, and the composition entry
    // maps both to `EXECUTION_TASK_REF_INVALID`. The row's point is that the
    // caller cannot tell spelling, Scope and invisibility apart, and every one
    // of these cases leaves the Task and the Outbox untouched.
    const readyCases: readonly {
      readonly label: string;
      readonly expected: string;
      readonly run: () => Promise<CommandResult>;
    }[] = [
      {
        label: 'the other major spelling of the Task',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-the-other-major-spelling-of-the-task',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            envelopeTargetType: TASK_OBJECT_V2,
            entry: readinessEntryV2,
            capabilityCodes: readinessCapabilitiesV2,
          }),
      },
      {
        label: 'the bare local name Task',
        expected: API_VALUE_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-the-bare-local-name-task',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            envelopeTargetType: 'Task',
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'a case variant of the published spelling',
        expected: API_VALUE_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-a-case-variant-of-the-published-spelling',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            envelopeTargetType: 'Execution.Task',
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'the Platform Scope form {}',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-the-platform-scope-form',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetScope: {},
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'an Enterprise-only Scope',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-an-enterprise-only-scope',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetScope: { enterpriseId: ENTERPRISE },
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'a projectId-only Scope',
        expected: API_VALUE_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-a-projectid-only-scope',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetScope: { projectId: PROJECT },
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'another Project of this Enterprise',
        expected: EXECUTION_TASK_REF_INVALID,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-another-project-of-this-enterprise',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetScope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
            decisionForDefaultTarget: true,
          }),
      },
      {
        label: 'an objectId that is not the Task under conversion',
        expected: NOT_FOUND,
        run: () =>
          markReady({
            idempotencyKey: 'wi208-003-ready-an-objectid-that-is-not-the-task-under-conversion',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetObjectId: newUuidV7(),
          }),
      },
      {
        label: 'the identity of a Task that only exists in another Project',
        expected: NOT_FOUND,
        run: () =>
          markReady({
            idempotencyKey:
              'wi208-003-ready-the-identity-of-a-task-that-only-exists-in-another-project',
            taskId: v1.taskId,
            judgmentId: consumerJudgmentId,
            judgmentPayloadHash: consumerJudgment.payload_hash,
            aggregateVersion: 1,
            targetObjectId: otherProjectTaskId,
          }),
      },
    ];
    for (const readyCase of readyCases) {
      const outcome = await attempt(readyCase.run);
      expect(outcome.code, readyCase.label).toBe(readyCase.expected);
    }
    await expectUntouched(v1.taskId, readyBefore);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
  });

  // -------------------------------------------------------------------------
  // TE-P206-004 — the definition binding and the immutable creation major
  // -------------------------------------------------------------------------

  it('TE-P206-004 closes the definition binding and the V3001 creation major', async () => {
    const draft = await createDraft('1.0');
    const before = await taskState(draft.taskId);
    const judgmentBefore = await countRows('task_execution.execution_judgment');

    const definitionCases: readonly {
      readonly label: string;
      readonly expected: string;
      readonly definitionRef: CanonicalJsonObject;
    }[] = [
      {
        label: 'a snapshot id that is not the Root pointer',
        expected: EXECUTION_JUDGMENT_INVALID,
        definitionRef: definitionRef(newUuidV7(), draft.definitionHash),
      },
      {
        label: 'a content hash that is not the Root pointer',
        expected: EXECUTION_JUDGMENT_INVALID,
        definitionRef: definitionRef(draft.snapshotId, Buffer.alloc(32, 0x5a)),
      },
      {
        label: 'a 63-character contentHash digest',
        expected: API_VALUE_INVALID,
        definitionRef: {
          ...definitionRef(draft.snapshotId, draft.definitionHash),
          contentHash: {
            algorithm: 'SHA-256',
            digest: 'a'.repeat(63),
            canonicalizationVersion: '1',
          },
        },
      },
      {
        label: 'a SHA-512 contentHash algorithm',
        expected: API_VALUE_INVALID,
        definitionRef: {
          ...definitionRef(draft.snapshotId, draft.definitionHash),
          contentHash: {
            algorithm: 'SHA-512',
            digest: draft.definitionHash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
      },
      {
        label: 'a canonicalizationVersion of 2',
        expected: API_VALUE_INVALID,
        definitionRef: {
          ...definitionRef(draft.snapshotId, draft.definitionHash),
          contentHash: {
            algorithm: 'SHA-256',
            digest: draft.definitionHash.toString('hex'),
            canonicalizationVersion: '2',
          },
        },
      },
    ];
    for (const definitionCase of definitionCases) {
      const outcome = await attempt(() =>
        buildReadiness({
          taskId: draft.taskId,
          commandVersion: '1.0',
          snapshotId: draft.snapshotId,
          definitionHash: draft.definitionHash,
          definitionRefValue: definitionCase.definitionRef,
          idempotencyKey: `wi208-004-${definitionCase.label.replaceAll(/[^a-z0-9]+/gi, '-')}`,
        }),
      );
      expect(outcome.code, definitionCase.label).toBe(definitionCase.expected);
    }
    expect(await countRows('task_execution.execution_judgment')).toBe(judgmentBefore);
    await expectUntouched(draft.taskId, before);

    // Relabelling the creation major is refused by the V3001 guards, so no
    // stored definition can ever disagree with the major its own creation
    // command committed: the snapshot is immutable history …
    const rewrite = await pgFailure(() =>
      admin.query(
        `UPDATE task_execution.task_definition_snapshot SET schema_version = '2.0'
          WHERE snapshot_id = $1`,
        [draft.snapshotId],
      ),
    );
    expect(rewrite.code).toBe('23514');
    expect(rewrite.message).toContain('immutable');

    // … and a relabelled copy cannot be inserted, because its own creation
    // Receipt (already finalised) does not agree with the label.
    const relabel = await pgFailure(() =>
      admin.query(
        `INSERT INTO task_execution.task_definition_snapshot
           (snapshot_id, task_id, schema_version, enterprise_id, project_id,
            delivery_item_id, delivery_item_version_id, canonical_payload, payload_hash,
            created_by_principal_id, source_command_id)
         SELECT $1, task_id, '2.0', enterprise_id, project_id, delivery_item_id,
                delivery_item_version_id, canonical_payload, payload_hash,
                created_by_principal_id, source_command_id
           FROM task_execution.task_definition_snapshot WHERE snapshot_id = $2`,
        [newUuidV7(), draft.snapshotId],
      ),
    );
    expect(relabel.code).toBe('22023');
    expect(relabel.message).toContain('creation identity');

    // The owning Handler's own creation-major branch stays reachable only for a
    // definition the Root pointer cannot resolve, which the composite foreign
    // key makes unwritable; the stored-reference half of the same code is
    // proven where a stored reference can still violate the accepted set — by
    // `execution.create_task` itself, whose closure the readiness plan re-runs
    // in `TE-P206-007`.
  });

  // -------------------------------------------------------------------------
  // TE-P206-005 — dependency availability
  // -------------------------------------------------------------------------

  it('TE-P206-005 records dependency availability and refuses an unsatisfied READY', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };

    /** One Task whose only dependency is `depRef`, judged and then consumed. */
    async function observeDependency(depRef: CanonicalJsonObject): Promise<{
      readonly taskId: string;
      readonly judgment: CommittedJudgment;
      readonly consumer: Attempt;
      readonly observation: Record<string, unknown>;
      readonly check: Record<string, unknown>;
    }> {
      const draft = await createDraftWith({ dependencyTaskRefs: [depRef] });
      const { judgment } = await buildTaskJudgment(draft);
      const consumer = await attempt(() =>
        markReady({
          taskId: draft.taskId,
          judgmentId: judgment.judgmentId,
          judgmentPayloadHash: judgment.payloadHash,
          aggregateVersion: Number(judgment.taskAggregateVersion),
          idempotencyKey: `wi208-005-ready-${judgment.judgmentId}`,
        }),
      );
      const dependencies = judgment.payload.dependencies as unknown[];
      return {
        taskId: draft.taskId,
        judgment,
        consumer,
        observation: record(dependencies[0]),
        check: checkRow(judgment.payload, 'DEPENDENCY_SATISFIED'),
      };
    }

    // A dependency that was never created.
    const missing = await observeDependency(objectRef(TASK_OBJECT_V1, newUuidV7(), scope));
    expect(missing.judgment.payload.ready).toBe(false);
    expect(missing.observation).toMatchObject({
      aggregateVersion: null,
      completionEvaluationRef: null,
      completionUseStatus: 'MISSING',
    });
    expect(missing.check).toMatchObject({
      outcome: 'UNSATISFIED',
      reasonCodes: ['DEPENDENCY_TASK_MISSING'],
    });
    expect(missing.consumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // A dependency that exists, but only in another Project: RLS makes it
    // indistinguishable from the one above, on every recorded field.
    const invisible = await observeDependency(objectRef(TASK_OBJECT_V1, otherProjectTaskId, scope));
    expect(invisible.judgment.payload.ready).toBe(false);
    // Every recorded field but the (necessarily different) dependency identity
    // agrees with the never-created case: the exterior does not distinguish a
    // Task of another Project from one that does not exist.
    const { taskRef: missingTaskRef, ...missingObservation } = missing.observation;
    const { taskRef: invisibleTaskRef, ...invisibleObservation } = invisible.observation;
    expect(missingTaskRef).not.toEqual(invisibleTaskRef);
    expect(invisibleObservation).toEqual(missingObservation);
    expect(invisible.check.outcome).toBe(missing.check.outcome);
    expect(invisible.check.reasonCodes).toEqual(missing.check.reasonCodes);
    expect(invisible.consumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // A dependency that was cancelled.
    const cancelledDependency = await createDraft('1.0');
    const cancelledUpdate = await setHistoricalTaskStatus(cancelledDependency.taskId, 'CANCELLED');
    expect(cancelledUpdate.rowCount).toBe(1);
    const cancelled = await observeDependency(
      objectRef(TASK_OBJECT_V1, cancelledDependency.taskId, scope),
    );
    expect(cancelled.judgment.payload.ready).toBe(false);
    expect(cancelled.observation).toMatchObject({
      completionUseStatus: 'CANCELLED',
      aggregateVersion: '1',
    });
    expect(cancelled.check).toMatchObject({
      outcome: 'UNSATISFIED',
      reasonCodes: ['DEPENDENCY_TASK_CANCELLED'],
    });
    expect(cancelled.consumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // A dependency that exists and is simply not completed yet.
    const pendingDependency = await createDraft('1.0');
    const pending = await observeDependency(
      objectRef(TASK_OBJECT_V1, pendingDependency.taskId, scope),
    );
    expect(pending.judgment.payload.ready).toBe(false);
    expect(pending.observation).toMatchObject({
      completionUseStatus: 'NOT_COMPLETED',
      aggregateVersion: '1',
    });
    expect(pending.check).toMatchObject({
      outcome: 'UNSATISFIED',
      reasonCodes: ['DEPENDENCY_NOT_COMPLETED'],
    });
    expect(pending.consumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // Each refusal left its Task exactly as it was: no conversion, no event.
    for (const observed of [missing, invisible, cancelled, pending]) {
      const state = await taskState(observed.taskId);
      expect(state.status).toBe('DRAFT');
      expect(state.aggregateVersion).toBe('1');
      expect(state.outbox).toEqual([]);
    }

    // NOT RUN — the COMPLETED-dependency usability branch. No committed fact
    // can make a COMPLETED dependency usable while
    // `execution.evaluate_task_completion@1.0` is undelivered
    // (`completionEvaluationRef` stays null, so a COMPLETED dependency is
    // recorded as `STALE`/`DEPENDENCY_COMPLETION_STALE`, which is not the
    // branch this row's control asks for).
  });

  // -------------------------------------------------------------------------
  // TE-P206-008 — the supported input set of the first version
  // -------------------------------------------------------------------------

  it('TE-P206-008 resolves only the supported Slice input', async () => {
    // USABLE: the owning read answers, the check is satisfied and the Task can
    // be converted.
    const usable = await createDraftWith({ inputRefs: [slice.ref] });
    const usableJudgment = await buildTaskJudgment(usable);
    expect(usableJudgment.result, JSON.stringify(usableJudgment.result)).toMatchObject({
      status: 'COMMITTED',
    });
    expect(usableJudgment.judgment.payload.ready).toBe(true);
    expect(usableJudgment.judgment.payload.inputs).toEqual([
      {
        inputRef: slice.ref,
        resolution: 'USABLE',
        validUntil: slice.validUntil.toISOString(),
      },
    ]);
    expect(checkRow(usableJudgment.judgment.payload, 'INPUT_REF_RESOLVED')).toMatchObject({
      outcome: 'SATISFIED',
      factRefs: [slice.ref],
      reasonCodes: [],
    });
    const convertedCommandId = newUuidV7();
    const converted = await attempt(() =>
      markReady({
        taskId: usable.taskId,
        judgmentId: usableJudgment.judgment.judgmentId,
        judgmentPayloadHash: usableJudgment.judgment.payloadHash,
        aggregateVersion: Number(usableJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-008-ready-${usableJudgment.judgment.judgmentId}`,
        commandId: convertedCommandId,
      }),
    );
    expect(converted.code, JSON.stringify(converted)).toBe('COMMITTED');
    const convertedState = await taskState(usable.taskId);
    expect(convertedState.status).toBe('READY');
    expect(convertedState.aggregateVersion).toBe('2');
    expect(convertedState.outbox).toHaveLength(1);
    expect(convertedState.outbox[0]).toMatchObject({
      event_type: TASK_READY_EVENT,
      event_version: '1.0',
      aggregate_version: '2',
    });
    const eventPayload = record(convertedState.outbox[0]?.payload);
    expect(record(eventPayload.taskRef)).toMatchObject({
      objectType: TASK_OBJECT_V1,
      objectId: usable.taskId,
    });
    expect(record(eventPayload.readinessSnapshotRef)).toMatchObject({
      objectId: usableJudgment.judgment.judgmentId,
      snapshotId: usableJudgment.judgment.judgmentId,
    });
    // §17.8 step 8: `readyAt` is the trusted conversion instant, which is the
    // Receipt's own `completed_at`; the Outbox row records the same instant.
    // Three independent clocks would let a reader observe a `readyAt` that is
    // not the time the command actually committed.
    const convertedReceipt = (
      await admin.query<{ outcome: string; completed_at: Date }>(
        `SELECT outcome, completed_at FROM task_execution.command_receipt
          WHERE command_id = $1`,
        [convertedCommandId],
      )
    ).rows[0];
    if (convertedReceipt === undefined) throw new Error('the transition Receipt is missing');
    expect(convertedReceipt.outcome).toBe('COMMITTED');
    expect(record(eventPayload).readyAt).toBe(convertedReceipt.completed_at.toISOString());
    expect(convertedState.outbox[0]?.occurred_at.toISOString()).toBe(
      convertedReceipt.completed_at.toISOString(),
    );
    // Exactly one registered TaskReady row exists for this conversion.
    expect(
      await countRows(
        `task_execution.outbox_event WHERE event_type = '${TASK_READY_EVENT}' AND aggregate_id = '${usable.taskId}'`,
      ),
    ).toBe(1);

    // EXPIRED: the owning read reports the finite bound as passed.
    const expired = await createDraftWith({ inputRefs: [expiredSlice.ref] });
    const expiredJudgment = await buildTaskJudgment(expired);
    expect(expiredJudgment.judgment.payload.ready).toBe(false);
    expect(expiredJudgment.judgment.payload.inputs).toEqual([
      { inputRef: expiredSlice.ref, resolution: 'EXPIRED', validUntil: null },
    ]);
    expect(checkRow(expiredJudgment.judgment.payload, 'INPUT_REF_RESOLVED')).toMatchObject({
      outcome: 'STALE',
      reasonCodes: ['INPUT_REF_EXPIRED'],
    });
    const expiredConsumer = await attempt(() =>
      markReady({
        taskId: expired.taskId,
        judgmentId: expiredJudgment.judgment.judgmentId,
        judgmentPayloadHash: expiredJudgment.judgment.payloadHash,
        aggregateVersion: Number(expiredJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-008-expired-${expiredJudgment.judgment.judgmentId}`,
      }),
    );
    expect(expiredConsumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // REVOKED: the capture Policy the Slice observed is superseded, so its own
    // owning read no longer calls the Slice usable.
    const supersedingCaptureKey = {
      ...(revokedCapturePolicyKey as unknown as Record<string, unknown>),
      versionId: newUuidV7(),
    } as unknown as Common.VersionedRef;
    const superseded = await seedPolicyVersionFact({
      key: supersedingCaptureKey,
      profileKey: CAPTURE_PROFILE,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SLICE_PURPOSE],
      },
      effectiveFrom: new Date(clock - 30 * 60 * 1000),
      supersedesRef: revokedCapturePolicyKey,
    });
    expect(superseded.result.status).toBe('COMMITTED');
    const revoked = await createDraftWith({ inputRefs: [revokedSlice.ref] });
    const revokedJudgment = await buildTaskJudgment(revoked);
    expect(revokedJudgment.judgment.payload.ready).toBe(false);
    expect(revokedJudgment.judgment.payload.inputs).toEqual([
      { inputRef: revokedSlice.ref, resolution: 'REVOKED', validUntil: null },
    ]);
    expect(checkRow(revokedJudgment.judgment.payload, 'INPUT_REF_RESOLVED')).toMatchObject({
      outcome: 'STALE',
      reasonCodes: ['INPUT_REF_REVOKED'],
    });
    const revokedConsumer = await attempt(() =>
      markReady({
        taskId: revoked.taskId,
        judgmentId: revokedJudgment.judgment.judgmentId,
        judgmentPayloadHash: revokedJudgment.judgment.payloadHash,
        aggregateVersion: Number(revokedJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-008-revoked-${revokedJudgment.judgment.judgmentId}`,
      }),
    );
    expect(revokedConsumer.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);

    // An empty `inputRefs` produces no row at all — not "unresolved", not
    // "satisfied": the check set stays the dependency/blocker set only.
    const noInputs = await createDraftWith({ inputRefs: [] });
    const noInputsJudgment = await buildTaskJudgment(noInputs);
    expect(noInputsJudgment.judgment.payload.inputs).toEqual([]);
    const checks = noInputsJudgment.judgment.payload.checks as unknown[];
    expect(checks.map((check) => record(check).checkCode)).toEqual([
      'NO_BLOCKING_INFORMATION_REQUEST',
    ]);
  });

  // -------------------------------------------------------------------------
  // TE-P206-006 — the dependency graph invariant
  // -------------------------------------------------------------------------

  it('TE-P206-006 refuses dependency cycles on both sides', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };

    // Two Tasks whose definitions reference each other. Both creations are
    // legal — the graph invariant is a readiness judgement, not a creation one.
    const firstId = newUuidV7();
    const secondId = newUuidV7();
    const first = await createDraftWith(
      { dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, secondId, scope)] },
      { taskId: firstId },
    );
    const second = await createDraftWith(
      { dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, firstId, scope)] },
      { taskId: secondId },
    );
    const judgmentBefore = await countRows('task_execution.execution_judgment');
    const outboxBefore = await countRows('task_execution.outbox_event');
    const beforeFirst = await taskState(first.taskId);
    const beforeSecond = await taskState(second.taskId);

    for (const [label, draft] of [
      ['the first Task of the cycle', first],
      ['the second Task of the cycle', second],
    ] as const) {
      const outcome = await attempt(() =>
        buildReadiness({
          taskId: draft.taskId,
          commandVersion: '1.0',
          snapshotId: draft.snapshotId,
          definitionHash: draft.definitionHash,
          idempotencyKey: `wi208-006-${label.replaceAll(' ', '-')}`,
        }),
      );
      expect(outcome.code, label).toBe(EXECUTION_TASK_DEPENDENCY_CYCLE);
    }
    // No explanatory "successful" judgement and no conversion.
    expect(await countRows('task_execution.execution_judgment')).toBe(judgmentBefore);
    expect(await countRows('task_execution.outbox_event')).toBe(outboxBefore);
    await expectUntouched(first.taskId, beforeFirst);
    await expectUntouched(second.taskId, beforeSecond);

    // The consumer refuses the same cycle at its own commit point: the
    // judgement was built while the graph was acyclic, and a third Task that
    // closes the loop is created afterwards.
    const headId = newUuidV7();
    const middleId = newUuidV7();
    const tailId = newUuidV7();
    const head = await createDraftWith(
      { dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, middleId, scope)] },
      { taskId: headId },
    );
    const middle = await createDraftWith(
      { dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, tailId, scope)] },
      { taskId: middleId },
    );
    expect(middle.taskId).toBe(middleId);
    const headJudgment = await buildTaskJudgment(head);
    expect(headJudgment.result, JSON.stringify(headJudgment.result)).toMatchObject({
      status: 'COMMITTED',
    });
    const tail = await createDraftWith(
      { dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, head.taskId, scope)] },
      { taskId: tailId },
    );
    expect(tail.taskId).toBe(tailId);
    const beforeHead = await taskState(head.taskId);
    const cycledConsumer = await attempt(() =>
      markReady({
        taskId: head.taskId,
        judgmentId: headJudgment.judgment.judgmentId,
        judgmentPayloadHash: headJudgment.judgment.payloadHash,
        aggregateVersion: Number(headJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-006-consumer-${head.taskId}`,
      }),
    );
    expect(cycledConsumer.code).toBe(EXECUTION_TASK_DEPENDENCY_CYCLE);
    expect(await judgmentCountForTask(head.taskId)).toBe(1);
    await expectUntouched(head.taskId, beforeHead);

    // A self-referencing dependency cannot even be stored: `execution.create_task`
    // closes the same accepted set, and the immutable Snapshot cannot be
    // rewritten into one afterwards — so the readiness plan's own self-reference
    // branch has no legal fact to observe.
    const selfTargetId = newUuidV7();
    const selfAttempt = await attemptCreateDraft(
      '1.0',
      (payload) => {
        record(payload.definition).dependencyTaskRefs = [
          objectRef(TASK_OBJECT_V1, selfTargetId, scope),
        ];
      },
      { taskId: selfTargetId },
    );
    expect(selfAttempt.code).toBe(EXECUTION_DEFINITION_REF_INVALID);
    const rewrite = await pgFailure(() =>
      admin.query(
        `UPDATE task_execution.task_definition_snapshot
            SET canonical_payload = jsonb_set(
                  canonical_payload, '{definition,dependencyTaskRefs}', '[]'::jsonb)
          WHERE snapshot_id = $1`,
        [first.snapshotId],
      ),
    );
    expect(rewrite.code).toBe('23514');
    expect(rewrite.message).toContain('immutable');
  });

  // -------------------------------------------------------------------------
  // TE-P206-007 — the stored dependency Reference Scope
  // -------------------------------------------------------------------------

  it('TE-P206-007 closes the stored dependency Reference set at its only writer', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };
    const storedRefCases: readonly {
      readonly label: string;
      readonly expected: string;
      readonly ref: CanonicalJsonObject;
    }[] = [
      {
        label: 'a cross-Project Reference',
        expected: EXECUTION_DEFINITION_REF_INVALID,
        ref: objectRef(TASK_OBJECT_V1, newUuidV7(), {
          enterpriseId: ENTERPRISE,
          projectId: OTHER_PROJECT,
        }),
      },
      {
        label: 'a cross-Enterprise Reference',
        expected: EXECUTION_DEFINITION_REF_INVALID,
        ref: objectRef(TASK_OBJECT_V1, newUuidV7(), {
          enterpriseId: OTHER_ENTERPRISE,
          projectId: PROJECT,
        }),
      },
      {
        label: 'the other major spelling',
        expected: EXECUTION_DEFINITION_REF_INVALID,
        ref: objectRef(TASK_OBJECT_V2, newUuidV7(), scope),
      },
      {
        label: 'a non-Task objectType',
        expected: EXECUTION_DEFINITION_REF_INVALID,
        ref: objectRef(WORK_ORDER_OBJECT, newUuidV7(), scope),
      },
      {
        label: 'a case variant of the published spelling',
        expected: API_VALUE_INVALID,
        ref: objectRef('zhiju.Execution.Task', newUuidV7(), scope),
      },
    ];
    for (const storedRefCase of storedRefCases) {
      const outcome = await attemptCreateDraft(
        '1.0',
        (payload) => {
          record(payload.definition).dependencyTaskRefs = [storedRefCase.ref];
        },
        {},
      );
      expect(outcome.code, storedRefCase.label).toBe(storedRefCase.expected);
    }

    // The control of the same row: a same-Scope dependency that exists and is
    // not completed takes the `TE-P206-005` UNSATISFIED path rather than a
    // definition-integrity refusal.
    const dependency = await createDraft('1.0');
    const controlDraft = await createDraftWith({
      dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, dependency.taskId, scope)],
    });
    const control = await buildTaskJudgment(controlDraft);
    expect(control.result, JSON.stringify(control.result)).toMatchObject({ status: 'COMMITTED' });
    expect(control.judgment.payload.ready).toBe(false);
    expect(checkRow(control.judgment.payload, 'DEPENDENCY_SATISFIED')).toMatchObject({
      outcome: 'UNSATISFIED',
      reasonCodes: ['DEPENDENCY_NOT_COMPLETED'],
    });

    // Boundary: the readiness plan re-runs exactly this accepted set over the
    // *stored* definition, but `execution.create_task` is the only writer of
    // that set and already closes it (asserted above), the Snapshot is
    // immutable (`TE-P206-004`/`006`) and an inserted Snapshot must agree with
    // its own `PENDING` creation Receipt (`TE-P206-004`). No legal fact can
    // therefore carry a violating stored Reference into a readiness command,
    // so the plan's own `EXECUTION_DEFINITION_REF_INVALID` branch has no
    // reachable input.
  });

  // -------------------------------------------------------------------------
  // TE-P206-009 — the unsupported input set
  // -------------------------------------------------------------------------

  it('TE-P206-009 records every unsupported declared input as UNSUPPORTED', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };
    const boundTenant = objectRef(PROJECT_OBJECT, PROJECT, scope) as Record<string, unknown>;
    const declared: readonly { readonly input: CanonicalJsonObject; readonly reason: string }[] = [
      {
        input: {
          kind: 'CONTENT_ADDRESSED',
          objectType: ARTIFACT_REVISION_OBJECT,
          objectId: newUuidV7(),
          scope,
          contentHash: contentHashOf(Buffer.alloc(32, 0x21).toString('hex')),
        } as unknown as CanonicalJsonObject,
        reason: 'INPUT_REF_UNSUPPORTED_KIND',
      },
      {
        input: {
          kind: 'VERSIONED',
          objectType: PROJECT_OBJECT,
          objectId: newUuidV7(),
          versionId: newUuidV7(),
          scope,
        },
        reason: 'INPUT_REF_UNSUPPORTED_KIND',
      },
      {
        input: objectRef(PROJECT_OBJECT, newUuidV7(), scope),
        reason: 'INPUT_REF_UNSUPPORTED_KIND',
      },
      {
        input: {
          kind: 'CONTENT_ADDRESSED',
          objectType: UNKNOWN_OBJECT,
          objectId: newUuidV7(),
          scope,
          contentHash: contentHashOf(Buffer.alloc(32, 0x22).toString('hex')),
        } as unknown as CanonicalJsonObject,
        reason: 'INPUT_REF_UNSUPPORTED_KIND',
      },
      {
        input: {
          system: 'wi208.external.system',
          resourceType: 'wi208.external.resource',
          externalId: 'wi208-bound',
          observedAt: new Date(clock).toISOString(),
          tenantOrAccountRef: boundTenant,
        } as unknown as CanonicalJsonObject,
        reason: 'INPUT_REF_UNSUPPORTED_KIND',
      },
      {
        input: {
          system: 'wi208.external.system',
          resourceType: 'wi208.external.resource',
          externalId: 'wi208-unbound',
          observedAt: new Date(clock).toISOString(),
        },
        reason: 'INPUT_REF_EXTERNAL_UNBOUND',
      },
    ];
    const draft = await createDraftWith({ inputRefs: declared.map((entry) => entry.input) });
    const built = await buildTaskJudgment(draft);
    expect(built.result, JSON.stringify(built.result)).toMatchObject({ status: 'COMMITTED' });
    expect(built.judgment.payload.ready).toBe(false);
    const inputs = built.judgment.payload.inputs as unknown[];
    expect(inputs).toHaveLength(declared.length);
    for (const entry of declared) {
      // Compared by canonical content: the stored payload has been through
      // `jsonb`, which orders object members by its own rules.
      const observation = inputs
        .map(record)
        .find((candidate) =>
          digestCanonicalPayload(record(candidate.inputRef) as CanonicalJsonObject).hash.equals(
            digestCanonicalPayload(entry.input).hash,
          ),
        );
      expect(observation, JSON.stringify(entry.input)).toBeDefined();
      expect(observation).toMatchObject({ resolution: 'UNSUPPORTED', validUntil: null });
    }
    const inputChecks = (built.judgment.payload.checks as unknown[])
      .map(record)
      .filter((check) => check.checkCode === 'INPUT_REF_RESOLVED');
    expect(inputChecks).toHaveLength(declared.length);
    for (const check of inputChecks) {
      expect(check.outcome).toBe('UNSUPPORTED');
      const reasons = check.reasonCodes as unknown[];
      expect(reasons).toHaveLength(1);
      expect(declared.map((entry) => entry.reason)).toContain(reasons[0]);
    }
    // Not skipped, not "no input", never satisfied — and the consumer refuses
    // the whole judgement as unsupported rather than unsatisfied.
    const consumer = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: built.judgment.judgmentId,
        judgmentPayloadHash: built.judgment.payloadHash,
        aggregateVersion: Number(built.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-009-${draft.taskId}`,
      }),
    );
    expect(consumer.code).toBe(EXECUTION_CRITERION_UNSUPPORTED);
    const state = await taskState(draft.taskId);
    expect(state.status).toBe('DRAFT');
    expect(state.outbox).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // TE-P206-010 — the blocker set
  // -------------------------------------------------------------------------

  it('TE-P206-010 keeps the blocking InformationRequest branch NOT RUN and closes the payload', async () => {
    // NOT RUN — the blocking-InformationRequest half of this row. The
    // `information_request` producer is not delivered, so no committed fact can
    // be a blocker: `collectBlockers()` observes an empty set and the check row
    // is always satisfied. The branch cannot be produced by any legal fact and
    // is recorded as a boundary, never as a pass.

    // What *is* testable is that a caller cannot empty — or fill — the blocker
    // set through the payload: neither operation declares a blocker member.
    const draft = await createDraft('1.0');
    const judgment = await buildTaskJudgment(draft);
    expect(checkRow(judgment.judgment.payload, 'NO_BLOCKING_INFORMATION_REQUEST')).toMatchObject({
      outcome: 'SATISFIED',
      reasonCodes: [],
    });
    const before = await taskState(draft.taskId);
    const extraBlockerField = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-010-blockers',
        beforePayloadMutation: (payload) => {
          payload.blockers = [];
        },
      }),
    );
    expect(extraBlockerField.code).toBe(API_VALUE_INVALID);
    const extraVerdictField = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-010-ready',
        beforePayloadMutation: (payload) => {
          payload.ready = true;
        },
      }),
    );
    expect(extraVerdictField.code).toBe(API_VALUE_INVALID);
    const producerExtraField = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: draft.definitionHash,
        idempotencyKey: 'wi208-010-producer-blockers',
        payloadExtra: { blockers: [] },
      }),
    );
    expect(producerExtraField.code).toBe(API_VALUE_INVALID);
    await expectUntouched(draft.taskId, before);
  });

  // -------------------------------------------------------------------------
  // TE-P206-011 — Policy and Evaluator support
  // -------------------------------------------------------------------------

  it('TE-P206-011 refuses unsupported Policies and Evaluators without a judgment', async () => {
    const draft = await createDraft('1.0');
    const judgmentBefore = await countRows('task_execution.execution_judgment');
    const before = await taskState(draft.taskId);

    const workOrderEvaluator = registeredEvaluatorProfileReference(
      'im06-evaluator-static-v1',
      WORK_ORDER_VALIDATION_EVALUATOR_KEY,
    );
    const readinessEvaluator = evaluatorRef();
    const profileCases: readonly {
      readonly label: string;
      readonly expected: string;
      readonly overrides: {
        readonly policyRefValue?: CanonicalJsonObject;
        readonly evaluatorRefValue?: CanonicalJsonObject;
      };
    }[] = [
      {
        label: 'a Policy document with an unregistered rule field',
        expected: EXECUTION_CRITERION_UNSUPPORTED,
        overrides: { policyRefValue: unknownFieldPolicyKey as unknown as CanonicalJsonObject },
      },
      {
        label: 'a Policy that does not declare the readiness profile',
        expected: EXECUTION_CRITERION_UNSUPPORTED,
        overrides: { policyRefValue: wrongProfilePolicyKey as unknown as CanonicalJsonObject },
      },
      {
        label: 'another consumer Evaluator selector',
        expected: EXECUTION_CRITERION_UNSUPPORTED,
        overrides: {
          evaluatorRefValue: workOrderEvaluator as unknown as CanonicalJsonObject,
        },
      },
      {
        label: 'the registered Evaluator selector with a non-Platform Scope',
        expected: EXECUTION_CRITERION_UNSUPPORTED,
        overrides: {
          evaluatorRefValue: {
            ...(readinessEvaluator as unknown as Record<string, unknown>),
            scope: { enterpriseId: ENTERPRISE },
          },
        },
      },
      {
        label: 'a Policy version that is not yet effective',
        expected: EXECUTION_JUDGMENT_STALE,
        overrides: {
          policyRefValue: notYetEffectivePolicyKey as unknown as CanonicalJsonObject,
        },
      },
      {
        label: 'a superseded Policy version',
        expected: EXECUTION_JUDGMENT_STALE,
        overrides: { policyRefValue: supersededPolicyKey as unknown as CanonicalJsonObject },
      },
    ];
    for (const profileCase of profileCases) {
      const outcome = await attempt(() =>
        buildReadiness({
          taskId: draft.taskId,
          commandVersion: '1.0',
          snapshotId: draft.snapshotId,
          definitionHash: draft.definitionHash,
          idempotencyKey: `wi208-011-${profileCase.label.replaceAll(/[^a-z0-9]+/gi, '-')}`,
          ...profileCase.overrides,
        }),
      );
      expect(outcome.code, profileCase.label).toBe(profileCase.expected);
    }

    // An unavailable IdentityPolicy is a dependency failure, never a default
    // Policy and never an empty observation.
    const deadUrl = new URL(databaseUrl ?? '');
    deadUrl.username = PROBE_ROLE;
    deadUrl.password = PROBE_PASSWORD;
    const deadPool = new pg.Pool({ connectionString: deadUrl.toString(), max: 1 });
    await deadPool.end();
    const unavailableIdentity = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: draft.definitionHash,
        idempotencyKey: 'wi208-011-unavailable-identity',
        entry: readinessEntryFor({
          identityDb: createIdentityPolicyDatabase(deadPool),
        }),
      }),
    );
    expect(unavailableIdentity.code).toBe(DEPENDENCY_UNAVAILABLE);

    // A trusted configuration drift is a dependency failure of the *owning
    // read*: the Policy resolution cannot be authorized at all.
    const driftedCapability = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: draft.definitionHash,
        idempotencyKey: 'wi208-011-drifted-capability',
        entry: readinessEntryFor({ resolvePolicyCapability: 'wi208.cap.absent' }),
      }),
    );
    expect(driftedCapability.code).toBe(DEPENDENCY_UNAVAILABLE);

    // No fallback, no partially applied refusal: nothing was written at all.
    expect(await countRows('task_execution.execution_judgment')).toBe(judgmentBefore);
    await expectUntouched(draft.taskId, before);

    // Boundary: a Policy version whose *profile reference* is not registered
    // cannot be committed in the first place, so the readiness Handler can
    // never observe an unknown profile version — the owning entry refuses the
    // write. Only the other registered profile and the unregistered rule field
    // (asserted above) reach the Handler.
    const unregisteredProfile = await seedPolicyVersionFact({
      key: versionedPolicyKey(),
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
      schemaRefs: [
        {
          ...(profileRef(READINESS_PROFILE) as unknown as Record<string, unknown>),
          versionId: newUuidV7(),
        } as unknown as Common.VersionedRef,
      ],
      expected: 'REJECTED',
    });
    expect(unregisteredProfile.result).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
    });
  });

  // -------------------------------------------------------------------------
  // TE-P206-012 — the validity bound
  // -------------------------------------------------------------------------

  it('TE-P206-012 takes the minimum validity bound and fails closed at it', async () => {
    /** The Decision expiry the producing command was authorized by. */
    async function decisionExpiryOf(judgmentId: string): Promise<Date> {
      const row = (
        await admin.query<{ expires_at: Date }>(
          `SELECT d.expires_at
             FROM task_execution.execution_judgment j
             JOIN task_execution.command_receipt r ON r.command_id = j.source_command_id
             JOIN identity_policy.authorization_decision d
               ON d.authorization_decision_id = r.authorization_decision_id
            WHERE j.judgment_id = $1`,
          [judgmentId],
        )
      ).rows[0];
      if (row === undefined) throw new Error('the producing Decision is not readable');
      return row.expires_at;
    }

    // The Policy TTL bounds the judgement when it is the smallest term.
    const shortTtlDraft = await createDraft('1.0');
    const shortTtl = await buildTaskJudgment(shortTtlDraft, {
      policyRefValue: shortTtlPolicyKey as unknown as CanonicalJsonObject,
    });
    const shortTtlRow = await judgmentRow(shortTtl.judgment.judgmentId);
    if (shortTtlRow === undefined) throw new Error('the judgment row is not readable');
    const shortTtlExpiry = await decisionExpiryOf(shortTtl.judgment.judgmentId);
    expect(shortTtlRow.valid_until.getTime()).toBe(shortTtlRow.evaluated_at.getTime() + 60_000);
    expect(shortTtlRow.valid_until.getTime()).toBeLessThan(shortTtlExpiry.getTime());

    // The producing Decision's own expiry bounds it when *that* is smallest.
    const decisionBoundDraft = await createDraft('1.0');
    const decisionBound = await buildTaskJudgment(decisionBoundDraft);
    const decisionBoundRow = await judgmentRow(decisionBound.judgment.judgmentId);
    if (decisionBoundRow === undefined) throw new Error('the judgment row is not readable');
    const decisionBoundTtl = decisionBoundRow.evaluated_at.getTime() + 900_000;
    expect(decisionBoundRow.valid_until.getTime()).toBe(
      (await decisionExpiryOf(decisionBound.judgment.judgmentId)).getTime(),
    );
    expect(decisionBoundRow.valid_until.getTime()).toBeLessThan(decisionBoundTtl);

    // A finite Slice bound bounds it when it is the smallest term, and it is
    // recorded verbatim as the input observation's own bound.
    const sliceBoundDraft = await createDraftWith({ inputRefs: [shortLivedSlice.ref] });
    const sliceBound = await buildTaskJudgment(sliceBoundDraft, {
      policyRefValue: longTtlPolicyKey as unknown as CanonicalJsonObject,
    });
    const sliceBoundRow = await judgmentRow(sliceBound.judgment.judgmentId);
    if (sliceBoundRow === undefined) throw new Error('the judgment row is not readable');
    expect(sliceBoundRow.valid_until.getTime()).toBe(shortLivedSlice.validUntil.getTime());
    expect((sliceBound.judgment.payload.inputs as unknown[]).map(record)[0]).toMatchObject({
      resolution: 'USABLE',
      validUntil: shortLivedSlice.validUntil.toISOString(),
    });

    // `now` exactly at the bound, and later than it, both fail closed before
    // anything is observed again.
    for (const [label, at] of [
      ['exactly at validUntil', new Date(shortTtlRow.valid_until.getTime())],
      ['one millisecond after validUntil', new Date(shortTtlRow.valid_until.getTime() + 1)],
      // Still inside the producing Decision's own window (300 s), so the
      // judgement's own bound is what refuses it.
      ['one minute after validUntil', new Date(shortTtlRow.valid_until.getTime() + 60_000)],
    ] as const) {
      const outcome = await attempt(() =>
        markReady({
          taskId: shortTtlDraft.taskId,
          judgmentId: shortTtl.judgment.judgmentId,
          judgmentPayloadHash: shortTtl.judgment.payloadHash,
          aggregateVersion: Number(shortTtl.judgment.taskAggregateVersion),
          idempotencyKey: `wi208-012-${label.replaceAll(' ', '-')}`,
          entry: readinessEntryFor({ now: () => at }),
        }),
      );
      expect(outcome.code, label).toBe(EXECUTION_JUDGMENT_STALE);
    }

    // A trusted clock past the producing Decision's own expiry is refused one
    // gate earlier — the Decision no longer covers the request at all — which
    // is the same fail-closed answer for an expired judgement.
    const beyondTheDecision = await attempt(() =>
      markReady({
        taskId: shortTtlDraft.taskId,
        judgmentId: shortTtl.judgment.judgmentId,
        judgmentPayloadHash: shortTtl.judgment.payloadHash,
        aggregateVersion: Number(shortTtl.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-012-beyond-the-decision',
        entry: readinessEntryFor({
          now: () => new Date(shortTtlRow.valid_until.getTime() + 3600_000),
        }),
      }),
    );
    expect(beyondTheDecision.code).toBe(AUTHORIZATION_EXPIRED);

    // The caller-declared `requestedAt` is recorded, never authority: a value
    // far in the past and far in the future neither rescues an expired
    // judgement nor moves the CAS.
    const farPast = new Date(clock - 10 * 365 * 24 * 3600 * 1000).toISOString();
    const farFuture = new Date(clock + 10 * 365 * 24 * 3600 * 1000).toISOString();
    for (const [label, requestedAt] of [
      ['far in the past', farPast],
      ['far in the future', farFuture],
    ] as const) {
      const expiredOutcome = await attempt(() =>
        markReady({
          taskId: shortTtlDraft.taskId,
          judgmentId: shortTtl.judgment.judgmentId,
          judgmentPayloadHash: shortTtl.judgment.payloadHash,
          aggregateVersion: Number(shortTtl.judgment.taskAggregateVersion),
          requestedAt,
          idempotencyKey: `wi208-012-expired-${label.replaceAll(' ', '-')}`,
          entry: readinessEntryFor({ now: () => new Date(shortTtlRow.valid_until.getTime()) }),
        }),
      );
      expect(expiredOutcome.code, label).toBe(EXECUTION_JUDGMENT_STALE);
    }

    // … and the CAS is decided by the Task's version alone: the same moved
    // Task answers the same conflict for every declared `requestedAt`.
    const movedDraft = await createDraft('1.0');
    const moved = await buildTaskJudgment(movedDraft);
    await admin.query(
      `UPDATE task_execution.task SET aggregate_version = aggregate_version + 1
        WHERE task_id = $1`,
      [movedDraft.taskId],
    );
    const conflictCodes: string[] = [];
    for (const [label, requestedAt] of [
      ['the trusted clock', new Date(clock).toISOString()],
      ['far in the past', farPast],
      ['far in the future', farFuture],
    ] as const) {
      const outcome = await attempt(() =>
        markReady({
          taskId: movedDraft.taskId,
          judgmentId: moved.judgment.judgmentId,
          judgmentPayloadHash: moved.judgment.payloadHash,
          aggregateVersion: Number(moved.judgment.taskAggregateVersion),
          requestedAt,
          idempotencyKey: `wi208-012-cas-${label.replaceAll(' ', '-')}`,
        }),
      );
      conflictCodes.push(`${label}:${outcome.code}`);
    }
    expect(conflictCodes).toEqual([
      `the trusted clock:${CONCURRENCY_CONFLICT}`,
      `far in the past:${CONCURRENCY_CONFLICT}`,
      `far in the future:${CONCURRENCY_CONFLICT}`,
    ]);

    // A conversion that observes the bound as the winner commits, and the same
    // conversion observed one millisecond past the bound does not — a long
    // transaction must not pass on a timestamp read before its owning reads.
    //
    // The positive control captures the clock read immediately before the
    // actual Task CAS. Authorization is also revalidated after the body, so
    // its later clock reads must not be mistaken for the transition boundary.
    const controlDraft = await createDraft('1.0');
    const controlJudgment = await buildTaskJudgment(controlDraft, {
      policyRefValue: shortTtlPolicyKey as unknown as CanonicalJsonObject,
    });
    const controlRow = await judgmentRow(controlJudgment.judgment.judgmentId);
    if (controlRow === undefined) throw new Error('the judgment row is not readable');
    const controlEarly = new Date(controlRow.evaluated_at.getTime() + 1000);
    let controlCalls = 0;
    let commitClockCalls = 0;
    const controlState = await attempt(() =>
      markReady({
        taskId: controlDraft.taskId,
        judgmentId: controlJudgment.judgment.judgmentId,
        judgmentPayloadHash: controlJudgment.judgment.payloadHash,
        aggregateVersion: Number(controlJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-012-control-${controlJudgment.judgment.judgmentId}`,
        entry: readinessEntryFor({
          taskExecutionDb: teDb.withPlugin({
            transformQuery(args) {
              if (
                args.node.kind === 'UpdateQueryNode' &&
                JSON.stringify(args.node).includes('"name":"task"')
              )
                commitClockCalls = controlCalls;
              return args.node;
            },
            transformResult: (args) => Promise.resolve(args.result),
          }),
          now: () => {
            controlCalls += 1;
            return controlEarly;
          },
        }),
      }),
    );
    expect(controlState.code, JSON.stringify(controlState)).toBe('COMMITTED');
    expect(commitClockCalls).toBeGreaterThan(1);
    expect(controlCalls).toBeGreaterThanOrEqual(commitClockCalls);
    const convertedControl = await taskState(controlDraft.taskId);
    expect(convertedControl.status).toBe('READY');
    expect(convertedControl.outbox).toHaveLength(1);

    const boundaryDraft = await createDraft('1.0');
    const boundaryJudgment = await buildTaskJudgment(boundaryDraft, {
      policyRefValue: shortTtlPolicyKey as unknown as CanonicalJsonObject,
    });
    const boundaryRow = await judgmentRow(boundaryJudgment.judgment.judgmentId);
    if (boundaryRow === undefined) throw new Error('the judgment row is not readable');
    const boundaryEarly = new Date(boundaryRow.evaluated_at.getTime() + 1000);
    const boundaryLate = new Date(boundaryRow.valid_until.getTime() + 1);
    let boundaryCalls = 0;
    const beforeBoundary = await taskState(boundaryDraft.taskId);
    const boundaryOutcome = await attempt(() =>
      markReady({
        taskId: boundaryDraft.taskId,
        judgmentId: boundaryJudgment.judgment.judgmentId,
        judgmentPayloadHash: boundaryJudgment.judgment.payloadHash,
        aggregateVersion: Number(boundaryJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-012-boundary-${boundaryJudgment.judgment.judgmentId}`,
        entry: readinessEntryFor({
          now: () => {
            boundaryCalls += 1;
            return boundaryCalls >= commitClockCalls ? boundaryLate : boundaryEarly;
          },
        }),
      }),
    );
    expect(boundaryOutcome.code, JSON.stringify(boundaryOutcome)).toBe(EXECUTION_JUDGMENT_STALE);
    expect(boundaryCalls).toBeGreaterThanOrEqual(commitClockCalls);
    // No side effect at all: the Task keeps its status and version, and no
    // TaskReady row was published. The Receipt records the refusal, not a
    // success result.
    const afterBoundary = await taskState(boundaryDraft.taskId);
    expect(afterBoundary.status).toBe(beforeBoundary.status);
    expect(afterBoundary.aggregateVersion).toBe(beforeBoundary.aggregateVersion);
    expect(afterBoundary.outbox).toEqual([]);
    expect(afterBoundary.edges).toEqual(beforeBoundary.edges);
    const boundaryReceipt = (
      await admin.query<{ outcome: string; result_payload: Record<string, unknown> | null }>(
        `SELECT outcome, result_payload FROM task_execution.command_receipt
          WHERE idempotency_key = $1`,
        [`wi208-012-boundary-${boundaryJudgment.judgment.judgmentId}`],
      )
    ).rows[0];
    expect(boundaryReceipt?.outcome).toBe('REJECTED');
    expect(record(boundaryReceipt?.result_payload).errorCode).toBe(EXECUTION_JUDGMENT_STALE);
    // TE-P206-012 is a composite scenario (several owning commands and DRAFTs
    // against real PostgreSQL); its runtime sits right at the 5 s default on
    // slower CI runners, so it carries its own budget.
  }, 30_000);

  // -------------------------------------------------------------------------
  // TE-P206-013 — authorization separation
  // -------------------------------------------------------------------------

  it('TE-P206-013 keeps the two readiness authorization entries independent', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };
    const draft = await createDraft('1.0');
    const judgment = await buildTaskJudgment(draft);
    const judgmentRowValue = await judgmentRow(judgment.judgment.judgmentId);
    if (judgmentRowValue === undefined) throw new Error('the judgment row is not readable');
    const readinessTarget = objectRef(READINESS_OBJECT, newUuidV7(), scope) as Common.ObjectRef;
    const taskTarget = objectRef(TASK_OBJECT_V1, draft.taskId, scope) as Common.ObjectRef;

    // A consumer Decision presented to the producer: the two entries never
    // stand in for each other, on the operation *or* on the target.
    const consumerDecision = await readinessDecision({
      commandType: 'execution.mark_task_ready',
      commandVersion: '1.0',
      targetRef: taskTarget,
      payloadHash: Buffer.alloc(32, 0x31),
    });
    const consumerForProducer = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: draft.definitionHash,
        idempotencyKey: 'wi208-013-consumer-for-producer',
        presentedDecisionRef: consumerDecision,
      }),
    );
    expect(consumerForProducer.code).toBe(AUTHORIZATION_DECISION_INVALID);

    // … and the reverse.
    const producerDecision = await readinessDecision({
      commandType: 'execution.build_task_readiness',
      commandVersion: '1.0',
      targetRef: readinessTarget,
      payloadHash: Buffer.alloc(32, 0x32),
    });
    const producerForConsumer = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-013-producer-for-consumer',
        presentedDecisionRef: producerDecision,
      }),
    );
    expect(producerForConsumer.code).toBe(AUTHORIZATION_DECISION_INVALID);

    // The Grant selector types are not interchangeable either: a Grant that
    // covers the code and the action with the *other* entry's selector type
    // issues no Decision at all.
    const consumerSelectorDenial = await readinessDecisionView({
      commandType: 'execution.mark_task_ready',
      commandVersion: '1.0',
      targetRef: taskTarget,
      payloadHash: Buffer.alloc(32, 0x33),
      capabilityCodes: {
        taskReadinessBuildV1: CAP_BUILD,
        taskReadyV1: CAP_READY_WRONG_SELECTOR,
      },
    });
    expect(consumerSelectorDenial.outcome).toBe('DENY');
    expect(consumerSelectorDenial.decisionRef).toBeUndefined();
    const producerSelectorDenial = await readinessDecisionView({
      commandType: 'execution.build_task_readiness',
      commandVersion: '1.0',
      targetRef: readinessTarget,
      payloadHash: Buffer.alloc(32, 0x34),
      capabilityCodes: {
        taskReadinessBuildV1: CAP_BUILD_WRONG_SELECTOR,
        taskReadyV1: CAP_READY,
      },
    });
    expect(producerSelectorDenial.outcome).toBe('DENY');
    expect(producerSelectorDenial.decisionRef).toBeUndefined();

    // A trusted configuration drift on one entry refuses the other entry's
    // Decision: the code that signed it is no longer the code of this entry.
    const driftedConsumerEntry = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-013-drifted-consumer',
        entry: readinessEntryFor({ readyCapability: CAP_BUILD }),
      }),
    );
    expect(driftedConsumerEntry.code).toBe(AUTHORIZATION_REVOKED);
    const driftedProducerEntry = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: draft.definitionHash,
        idempotencyKey: 'wi208-013-drifted-producer',
        entry: readinessEntryFor({ buildCapability: CAP_READY }),
      }),
    );
    expect(driftedProducerEntry.code).toBe(AUTHORIZATION_REVOKED);

    // A substituted payload hash, a substituted target and an expired
    // Decision are all refused at the same boundary.
    const substitutedPayload = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-013-substituted-payload',
        decisionPayloadHash: Buffer.alloc(32, 0x35),
      }),
    );
    expect(substitutedPayload.code).toBe(AUTHORIZATION_DECISION_INVALID);
    const substitutedTarget = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-013-substituted-target',
        decisionTargetRef: objectRef(TASK_OBJECT_V1, newUuidV7(), scope) as Common.ObjectRef,
      }),
    );
    expect(substitutedTarget.code).toBe(AUTHORIZATION_DECISION_INVALID);
    const expiredDecision = await attempt(() =>
      markReady({
        taskId: draft.taskId,
        judgmentId: judgment.judgment.judgmentId,
        judgmentPayloadHash: judgment.judgment.payloadHash,
        aggregateVersion: Number(judgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-013-expired-decision',
        entry: readinessEntryFor({ now: () => new Date(clock + 3600_000) }),
      }),
    );
    expect(expiredDecision.code).toBe(AUTHORIZATION_EXPIRED);

    // Revalidation strictly precedes the idempotency claim and the historical
    // Receipt: the first attempt is refused *business*-wise (it claims a
    // Receipt), the replay of the same key returns that Receipt, and after the
    // covering Grant is revoked the very same replay is refused instead.
    const revocableEntry = readinessEntryFor({ readyCapability: CAP_READY_REVOKED });
    const revocableCapabilities: TaskExecutionReadinessCapabilityCodes = {
      taskReadinessBuildV1: CAP_BUILD,
      taskReadyV1: CAP_READY_REVOKED,
    };
    const unsatisfiedDraft = await createDraftWith({
      dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, newUuidV7(), scope)],
    });
    const unsatisfied = await buildTaskJudgment(unsatisfiedDraft);
    const replayKey = 'wi208-013-revoked-replay';
    const replaySink: { ref?: Common.ContentAddressedRef } = {};
    const firstAttempt = await attempt(() =>
      markReady({
        taskId: unsatisfiedDraft.taskId,
        judgmentId: unsatisfied.judgment.judgmentId,
        judgmentPayloadHash: unsatisfied.judgment.payloadHash,
        aggregateVersion: Number(unsatisfied.judgment.taskAggregateVersion),
        idempotencyKey: replayKey,
        entry: revocableEntry,
        capabilityCodes: revocableCapabilities,
        decisionSink: replaySink,
      }),
    );
    expect(firstAttempt.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);
    const replayDecisionRef = replaySink.ref;
    if (replayDecisionRef === undefined) {
      throw new Error('no Decision was presented to the first attempt');
    }
    const beforeRevocation = await attempt(() =>
      markReady({
        taskId: unsatisfiedDraft.taskId,
        judgmentId: unsatisfied.judgment.judgmentId,
        judgmentPayloadHash: unsatisfied.judgment.payloadHash,
        aggregateVersion: Number(unsatisfied.judgment.taskAggregateVersion),
        idempotencyKey: replayKey,
        entry: revocableEntry,
        presentedDecisionRef: replayDecisionRef,
      }),
    );
    expect(beforeRevocation.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);
    expect(beforeRevocation.result?.status).toBe('DUPLICATE');

    const revocableGrantId = (
      await admin.query<{ id: string; aggregate_version: string }>(
        `SELECT id, aggregate_version::text FROM identity_policy.capability_grant
          WHERE capability_code = $1 AND principal_id = $2 AND project_id = $3
            AND status = 'ACTIVE'`,
        [CAP_READY_REVOKED, OPERATOR, PROJECT],
      )
    ).rows[0];
    if (revocableGrantId === undefined) throw new Error('the revocable Grant is not readable');
    const revoked = await revokeCapability(identityDeps([PROJECT]), {
      targetId: revocableGrantId.id,
      expectedAggregateVersion: revocableGrantId.aggregate_version,
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE, projectId: PROJECT },
      reasonCode: 'wi208.013.revoke',
      effectiveAt: new Date(clock),
      idempotencyKey: 'wi208:revoke-capability:013',
    });
    expect(revoked).toMatchObject({ status: 'COMMITTED' });
    const afterRevocation = await attempt(() =>
      markReady({
        taskId: unsatisfiedDraft.taskId,
        judgmentId: unsatisfied.judgment.judgmentId,
        judgmentPayloadHash: unsatisfied.judgment.payloadHash,
        aggregateVersion: Number(unsatisfied.judgment.taskAggregateVersion),
        idempotencyKey: replayKey,
        entry: revocableEntry,
        presentedDecisionRef: replayDecisionRef,
      }),
    );
    expect(afterRevocation.code, JSON.stringify(afterRevocation)).toBe(AUTHORIZATION_REVOKED);
    const historicalReceipt = (await receiptRows(replayKey)).at(0);
    expect(historicalReceipt?.outcome).toBe('REJECTED');
    expect(historicalReceipt?.result_payload).toMatchObject({
      errorCode: EXECUTION_TASK_READINESS_UNSATISFIED,
    });

    // No business side effect from any of the refusals above.
    expect(await judgmentCountForTask(draft.taskId)).toBe(1);
    const draftState = await taskState(draft.taskId);
    expect(draftState.status).toBe('DRAFT');
    expect(draftState.aggregateVersion).toBe('1');
    expect(draftState.outbox).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // TE-P206-014 — idempotency and concurrency
  // -------------------------------------------------------------------------

  it('TE-P206-014 keeps the producer idempotent and concurrent builders legal', async () => {
    const scope = { enterpriseId: ENTERPRISE, projectId: PROJECT };
    const draft = await createDraft('1.0');
    const key = 'wi208-014-replay';
    const judgmentId = newUuidV7();
    const first = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId,
      idempotencyKey: key,
    });
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'COMMITTED' });
    const judgmentsAfterFirst = await judgmentCountForTask(draft.taskId);
    const stateAfterFirst = await taskState(draft.taskId);

    // Same key, same input: the original Receipt, and no new fact at all.
    const replay = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId,
      idempotencyKey: key,
    });
    expect(replay.status).toBe('DUPLICATE');
    if (replay.status !== 'DUPLICATE') throw new Error('the replay was not a duplicate');
    expect(replay.originalOutcome).toBe('COMMITTED');
    expect(replay.resultPayload).toEqual(
      (first as { resultPayload: CanonicalJsonObject }).resultPayload,
    );
    expect(await judgmentCountForTask(draft.taskId)).toBe(judgmentsAfterFirst);
    await expectUntouched(draft.taskId, stateAfterFirst);

    // Same key, different input: a payload conflict, audited as DENIED.
    const conflict = await attempt(() =>
      buildReadiness({
        taskId: draft.taskId,
        commandVersion: '1.0',
        snapshotId: draft.snapshotId,
        definitionHash: Buffer.alloc(32, 0x6b),
        judgmentId,
        idempotencyKey: key,
      }),
    );
    expect(conflict.code).toBe(IDEMPOTENCY_PAYLOAD_CONFLICT);
    const denied = (await auditRows({ commandType: 'execution.build_task_readiness' })).filter(
      (row) => row.outcome === 'DENIED',
    );
    expect(denied.map((row) => row.error_code)).toContain(IDEMPOTENCY_PAYLOAD_CONFLICT);
    expect(await judgmentCountForTask(draft.taskId)).toBe(judgmentsAfterFirst);

    // The same CREATE identity twice, under two keys: the second command loses
    // the identity race and records its own stable rejection — never another
    // command's result.
    const secondJudgmentId = newUuidV7();
    const firstIdentity = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId: secondJudgmentId,
      idempotencyKey: 'wi208-014-identity-a',
    });
    expect(firstIdentity, JSON.stringify(firstIdentity)).toMatchObject({ status: 'COMMITTED' });
    const duplicateIdentity = await buildReadiness({
      taskId: draft.taskId,
      commandVersion: '1.0',
      snapshotId: draft.snapshotId,
      definitionHash: draft.definitionHash,
      judgmentId: secondJudgmentId,
      idempotencyKey: 'wi208-014-identity-b',
    });
    expect(duplicateIdentity.status).toBe('REJECTED');
    if (duplicateIdentity.status !== 'REJECTED') throw new Error('the loser committed');
    expect(duplicateIdentity.errorCode).toBe(CONCURRENCY_CONFLICT);
    expect(await judgmentCountForTask(draft.taskId)).toBe(judgmentsAfterFirst + 1);

    // Several judgement identities for one Task are legal: two builders that
    // race the same Task both commit, each with its own immutable fact.
    const judgmentIds = [newUuidV7(), newUuidV7()];
    const raced = await Promise.all(
      judgmentIds.map((id, index) =>
        buildReadiness({
          taskId: draft.taskId,
          commandVersion: '1.0',
          snapshotId: draft.snapshotId,
          definitionHash: draft.definitionHash,
          judgmentId: id,
          idempotencyKey: `wi208-014-concurrent-${index}`,
        }),
      ),
    );
    for (const [index, outcome] of raced.entries()) {
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 'COMMITTED' });
      expect(await judgmentRow(judgmentIds[index] as string)).toBeDefined();
    }
    expect(await judgmentCountForTask(draft.taskId)).toBe(judgmentsAfterFirst + 3);
    // The producer still wrote no Outbox row for any of them.
    expect((await taskState(draft.taskId)).outbox).toEqual([]);

    // The consumer half: a rejected command's Receipt is replayed as a
    // duplicate and never re-executed.
    const unsatisfiedDraft = await createDraftWith({
      dependencyTaskRefs: [objectRef(TASK_OBJECT_V1, newUuidV7(), scope)],
    });
    const unsatisfied = await buildTaskJudgment(unsatisfiedDraft);
    const consumerKey = 'wi208-014-consumer-replay';
    const consumerAttempt = () =>
      markReady({
        taskId: unsatisfiedDraft.taskId,
        judgmentId: unsatisfied.judgment.judgmentId,
        judgmentPayloadHash: unsatisfied.judgment.payloadHash,
        aggregateVersion: Number(unsatisfied.judgment.taskAggregateVersion),
        idempotencyKey: consumerKey,
      });
    const consumerFirst = await attempt(consumerAttempt);
    expect(consumerFirst.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);
    const consumerState = await taskState(unsatisfiedDraft.taskId);
    const consumerReplay = await attempt(consumerAttempt);
    expect(consumerReplay.result?.status).toBe('DUPLICATE');
    expect(consumerReplay.code).toBe(EXECUTION_TASK_READINESS_UNSATISFIED);
    await expectUntouched(unsatisfiedDraft.taskId, consumerState);
    expect(await judgmentCountForTask(unsatisfiedDraft.taskId)).toBe(1);

    // Two consumers with different keys race one Task: the DRAFT-only CAS makes
    // exactly one transition, the loser is refused, and the winner's key replays
    // its own Receipt without a second transition or a second event.
    const readyDraft = await createDraft('1.0');
    const readyJudgment = await buildTaskJudgment(readyDraft);
    const raceKeys = ['wi208-014-race-a', 'wi208-014-race-b'];
    const racing = await Promise.all(
      raceKeys.map((key) =>
        attempt(() =>
          markReady({
            taskId: readyDraft.taskId,
            judgmentId: readyJudgment.judgment.judgmentId,
            judgmentPayloadHash: readyJudgment.judgment.payloadHash,
            aggregateVersion: Number(readyJudgment.judgment.taskAggregateVersion),
            idempotencyKey: key,
          }),
        ),
      ),
    );
    const racedState = await taskState(readyDraft.taskId);
    const winner = racing.findIndex((outcome) => outcome.code === 'COMMITTED');
    expect(
      racing.filter((outcome) => outcome.code === 'COMMITTED'),
      JSON.stringify(racing),
    ).toHaveLength(1);
    expect(racedState.status).toBe('READY');
    expect(racedState.aggregateVersion).toBe('2');
    expect(racedState.outbox).toHaveLength(1);
    if (winner < 0) throw new Error('no READY transition won the race');
    // The losing key is either refused by the DRAFT-only CAS or reported as
    // still in flight; either way no partial fact is left behind.
    const losingKey = raceKeys[winner === 0 ? 1 : 0];
    const winningKey = raceKeys[winner];
    if (losingKey === undefined || winningKey === undefined) {
      throw new Error('the race keys are missing');
    }
    const loserReplay = await attempt(() =>
      markReady({
        taskId: readyDraft.taskId,
        judgmentId: readyJudgment.judgment.judgmentId,
        judgmentPayloadHash: readyJudgment.judgment.payloadHash,
        aggregateVersion: Number(readyJudgment.judgment.taskAggregateVersion),
        idempotencyKey: losingKey,
      }),
    );
    expect(loserReplay.code).toBe(EXECUTION_TASK_NOT_EXECUTABLE);
    const winnerReplay = await attempt(() =>
      markReady({
        taskId: readyDraft.taskId,
        judgmentId: readyJudgment.judgment.judgmentId,
        judgmentPayloadHash: readyJudgment.judgment.payloadHash,
        aggregateVersion: Number(readyJudgment.judgment.taskAggregateVersion),
        idempotencyKey: winningKey,
      }),
    );
    expect(winnerReplay.result?.status).toBe('DUPLICATE');
    if (winnerReplay.result?.status !== 'DUPLICATE') {
      throw new Error('the winner key did not replay its own Receipt');
    }
    const winnerResult = racing[winner]?.result;
    expect(winnerReplay.result.resultPayload).toEqual(
      winnerResult?.status === 'COMMITTED' ? winnerResult.resultPayload : null,
    );
    const afterReplay = await taskState(readyDraft.taskId);
    expect(afterReplay.aggregateVersion).toBe('2');
    expect(afterReplay.outbox).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // TE-P206-015 — the DRAFT-only CAS
  // -------------------------------------------------------------------------

  it('TE-P206-015 answers every CAS race with its own stable code', async () => {
    // A Task whose version moved before the transition.
    const movedDraft = await createDraft('1.0');
    const moved = await buildTaskJudgment(movedDraft);
    await admin.query(
      `UPDATE task_execution.task SET aggregate_version = aggregate_version + 1
        WHERE task_id = $1`,
      [movedDraft.taskId],
    );
    const beforeMoved = await taskState(movedDraft.taskId);
    const movedOutcome = await attempt(() =>
      markReady({
        taskId: movedDraft.taskId,
        judgmentId: moved.judgment.judgmentId,
        judgmentPayloadHash: moved.judgment.payloadHash,
        aggregateVersion: Number(moved.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-015-moved-${movedDraft.taskId}`,
      }),
    );
    expect(movedOutcome.code).toBe(CONCURRENCY_CONFLICT);
    await expectUntouched(movedDraft.taskId, beforeMoved);

    // A Task that is already READY.
    const readyDraft = await createDraft('1.0');
    const readyJudgment = await buildTaskJudgment(readyDraft);
    await admin.query(`UPDATE task_execution.task SET status = 'READY' WHERE task_id = $1`, [
      readyDraft.taskId,
    ]);
    const beforeReady = await taskState(readyDraft.taskId);
    const readyOutcome = await attempt(() =>
      markReady({
        taskId: readyDraft.taskId,
        judgmentId: readyJudgment.judgment.judgmentId,
        judgmentPayloadHash: readyJudgment.judgment.payloadHash,
        aggregateVersion: Number(readyJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-015-ready-${readyDraft.taskId}`,
      }),
    );
    expect(readyOutcome.code).toBe(EXECUTION_TASK_NOT_EXECUTABLE);
    await expectUntouched(readyDraft.taskId, beforeReady);

    // A Task that was cancelled.
    const cancelledDraft = await createDraft('1.0');
    const cancelledJudgment = await buildTaskJudgment(cancelledDraft);
    await setHistoricalTaskStatus(cancelledDraft.taskId, 'CANCELLED');
    const beforeCancelled = await taskState(cancelledDraft.taskId);
    const cancelledOutcome = await attempt(() =>
      markReady({
        taskId: cancelledDraft.taskId,
        judgmentId: cancelledJudgment.judgment.judgmentId,
        judgmentPayloadHash: cancelledJudgment.judgment.payloadHash,
        aggregateVersion: Number(cancelledJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-015-cancelled-${cancelledDraft.taskId}`,
      }),
    );
    expect(cancelledOutcome.code).toBe(EXECUTION_TASK_NOT_EXECUTABLE);
    await expectUntouched(cancelledDraft.taskId, beforeCancelled);

    // A definition pointer that moved after the judgement: the Root guard makes
    // a CAS-free pointer change impossible, and a pointer move that advances the
    // version is the version variable above — so the pointer term of the
    // consumer's comparison can never be the *first* mismatch. Both halves of
    // that claim are proven against the database.
    const pointerDraft = await createDraft('1.0');
    const pointerJudgment = await buildTaskJudgment(pointerDraft);
    const casFreePointerMove = await pgFailure(() =>
      admin.query(
        `UPDATE task_execution.task SET current_definition_hash = $2 WHERE task_id = $1`,
        [pointerDraft.taskId, Buffer.alloc(32, 0x77)],
      ),
    );
    expect(casFreePointerMove.code).toBe('23514');
    expect(casFreePointerMove.message).toContain('must advance the aggregate version');
    const pointerToNowhere = await pgFailure(() =>
      admin.query(
        `UPDATE task_execution.task
            SET current_definition_snapshot_id = $2, current_definition_hash = $3,
                aggregate_version = aggregate_version + 1
          WHERE task_id = $1`,
        [pointerDraft.taskId, newUuidV7(), Buffer.alloc(32, 0x78)],
      ),
    );
    expect(pointerToNowhere.code).toBe('23503');
    const beforePointer = await taskState(pointerDraft.taskId);
    expect(beforePointer.status).toBe('DRAFT');
    const pointerOutcome = await attempt(() =>
      markReady({
        taskId: pointerDraft.taskId,
        judgmentId: pointerJudgment.judgment.judgmentId,
        judgmentPayloadHash: pointerJudgment.judgment.payloadHash,
        aggregateVersion: Number(pointerJudgment.judgment.taskAggregateVersion),
        idempotencyKey: `wi208-015-pointer-${pointerDraft.taskId}`,
      }),
    );
    // The control conversion of this row (no race at all).
    expect(pointerOutcome.code, JSON.stringify(pointerOutcome)).toBe('COMMITTED');
    const pointerConverted = await taskState(pointerDraft.taskId);
    expect(pointerConverted.status).toBe('READY');
    expect(pointerConverted.aggregateVersion).toBe('2');
    expect(pointerConverted.outbox).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // TE-P206-016 — upstream drift after a successful build
  // -------------------------------------------------------------------------

  it('TE-P206-016 refuses a judgement whose observations moved, keeping history', async () => {
    /** The consumer's answer for one Task, with its own key. */
    async function consume(
      label: string,
      input: {
        taskId: string;
        judgment: CommittedJudgment;
        aggregateVersion: number;
      },
    ): Promise<Attempt> {
      return attempt(() =>
        markReady({
          taskId: input.taskId,
          judgmentId: input.judgment.judgmentId,
          judgmentPayloadHash: input.judgment.payloadHash,
          aggregateVersion: input.aggregateVersion,
          idempotencyKey: `wi208-016-${label}`,
        }),
      );
    }

    // The observed Task version moved after the build.
    const movedDraft = await createDraft('1.0');
    const moved = await buildTaskJudgment(movedDraft);
    const movedReceipt = (await receiptRows(`wi208-build-${moved.judgment.judgmentId}`)).at(0);
    const movedRow = await judgmentRow(moved.judgment.judgmentId);
    await admin.query(
      `UPDATE task_execution.task SET aggregate_version = aggregate_version + 1
        WHERE task_id = $1`,
      [movedDraft.taskId],
    );
    const movedOutcome = await consume('moved', {
      taskId: movedDraft.taskId,
      judgment: moved.judgment,
      aggregateVersion: Number(moved.judgment.taskAggregateVersion) + 1,
    });
    expect(movedOutcome.code).toBe(EXECUTION_JUDGMENT_STALE);

    // The dependency's observed aggregate version moved after the build.
    const dependency = await createDraft('1.0');
    const dependentDraft = await createDraftWith({
      dependencyTaskRefs: [
        objectRef(TASK_OBJECT_V1, dependency.taskId, {
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
        }),
      ],
    });
    const dependent = await buildTaskJudgment(dependentDraft);
    await admin.query(
      `UPDATE task_execution.task SET aggregate_version = aggregate_version + 1
        WHERE task_id = $1`,
      [dependency.taskId],
    );
    const dependentOutcome = await consume('dependency', {
      taskId: dependentDraft.taskId,
      judgment: dependent.judgment,
      aggregateVersion: Number(dependent.judgment.taskAggregateVersion),
    });
    expect(dependentOutcome.code).toBe(EXECUTION_JUDGMENT_STALE);

    // A Slice that turned REVOKED under its owning read. The Slice row itself
    // is immutable history (its UPDATE trigger refuses any rewrite), so the
    // lifecycle is driven where it belongs: the capture Policy the Slice
    // observed gains a successor that becomes effective *after* the build and
    // *inside* the judgement's own validity window. Only the re-observation can
    // see that, and the judgement's validity window is still open at the clock
    // the consumer runs.
    const driftCapturePolicyKey = versionedPolicyKey();
    const driftCapture = await seedPolicyVersionFact({
      key: driftCapturePolicyKey,
      profileKey: CAPTURE_PROFILE,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SLICE_PURPOSE],
      },
    });
    expect(driftCapture.result.status).toBe('COMMITTED');
    const driftSlice = await seedSlice({
      validUntil: new Date(clock + 60 * 60 * 1000),
      policyKey: driftCapturePolicyKey,
    });
    const sliceDriftClock = new Date(clock + 200_000);
    const sliceDraftTask = await createDraftWith({ inputRefs: [driftSlice.ref] });
    const sliceJudgment = await buildTaskJudgment(sliceDraftTask);
    expect(sliceJudgment.judgment.payload.ready).toBe(true);
    const sliceJudgmentRow = await judgmentRow(sliceJudgment.judgment.judgmentId);
    expect(sliceJudgmentRow?.valid_until.getTime() ?? 0).toBeGreaterThan(sliceDriftClock.getTime());
    const driftSuccessor = {
      ...(driftCapturePolicyKey as unknown as Record<string, unknown>),
      versionId: newUuidV7(),
    } as unknown as Common.VersionedRef;
    const supersededCapture = await seedPolicyVersionFact({
      key: driftSuccessor,
      profileKey: CAPTURE_PROFILE,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SLICE_PURPOSE],
      },
      effectiveFrom: new Date(clock + 120_000),
      supersedesRef: driftCapturePolicyKey,
    });
    expect(supersededCapture.result.status).toBe('COMMITTED');
    const beforeSliceDrift = await taskState(sliceDraftTask.taskId);
    const sliceOutcome = await attempt(() =>
      markReady({
        taskId: sliceDraftTask.taskId,
        judgmentId: sliceJudgment.judgment.judgmentId,
        judgmentPayloadHash: sliceJudgment.judgment.payloadHash,
        aggregateVersion: Number(sliceJudgment.judgment.taskAggregateVersion),
        idempotencyKey: 'wi208-016-slice-revoked',
        entry: readinessEntryFor({ now: () => sliceDriftClock }),
      }),
    );
    expect(sliceOutcome.code, JSON.stringify(sliceOutcome)).toBe(EXECUTION_JUDGMENT_STALE);
    await expectUntouched(sliceDraftTask.taskId, beforeSliceDrift);

    // The readiness Policy was superseded after the build.
    const policyDraft = await createDraft('1.0');
    const policyJudgment = await buildTaskJudgment(policyDraft, {
      policyRefValue: driftPolicyKey as unknown as CanonicalJsonObject,
    });
    const successorKey = {
      ...(driftPolicyKey as unknown as Record<string, unknown>),
      versionId: newUuidV7(),
    } as unknown as Common.VersionedRef;
    const supersededDrift = await seedPolicyVersionFact({
      key: successorKey,
      profileKey: READINESS_PROFILE,
      policyDocument: { maxReadinessValiditySeconds: 900 },
      effectiveFrom: new Date(clock - 30 * 60 * 1000),
      supersedesRef: driftPolicyKey,
    });
    expect(supersededDrift.result.status).toBe('COMMITTED');
    const policyOutcome = await consume('policy-superseded', {
      taskId: policyDraft.taskId,
      judgment: policyJudgment.judgment,
      aggregateVersion: Number(policyJudgment.judgment.taskAggregateVersion),
    });
    expect(policyOutcome.code).toBe(EXECUTION_JUDGMENT_STALE);

    // The definition pointer half of this row is the pointer-move boundary
    // proven in `TE-P206-015`: a pointer move must advance the aggregate version,
    // so it is always the version term that answers first — and the version case
    // is asserted in full above.

    // History is immutable: the refused judgement, its Receipt and its
    // content address are byte-identical afterwards …
    const movedRowAfter = await judgmentRow(moved.judgment.judgmentId);
    expect(movedRowAfter?.canonical_payload).toEqual(movedRow?.canonical_payload);
    expect(movedRowAfter?.payload_hash.equals(movedRow?.payload_hash ?? Buffer.alloc(0))).toBe(
      true,
    );
    expect(movedRowAfter?.ready).toBe(true);
    expect((await receiptRows(`wi208-build-${moved.judgment.judgmentId}`)).at(0)).toEqual(
      movedReceipt,
    );
    const movedState = await taskState(movedDraft.taskId);
    expect(movedState.status).toBe('DRAFT');
    expect(movedState.outbox).toEqual([]);
    expect(movedState.judgmentIds).toEqual([moved.judgment.judgmentId]);

    // … and a re-build of the drifted Task is a *new* immutable fact with a new
    // identity, never an in-place repair of the old one.
    const rebuilt = await buildTaskJudgment(movedDraft);
    expect(rebuilt.judgment.judgmentId).not.toBe(moved.judgment.judgmentId);
    expect(rebuilt.judgment.payload.taskAggregateVersion).toBe('2');
    expect(await judgmentCountForTask(movedDraft.taskId)).toBe(2);
  });

  // -------------------------------------------------------------------------
  // TE-P206-017 — direct SQL, guards, ACL/RLS and injected faults
  // -------------------------------------------------------------------------

  it('TE-P206-017 rejects direct manipulation and rolls back an injected fault', async () => {
    const draft = await createDraft('1.0');
    const committed = await buildTaskJudgment(draft);
    const sourceRow = await judgmentRow(committed.judgment.judgmentId);
    if (sourceRow === undefined) throw new Error('the judgment row is not readable');
    const sourcePayload = sourceRow.canonical_payload;
    const sourceReady = sourceRow.ready;
    const sourceRequestPayloadHash = sourceRow.request_payload_hash;

    /** One forged `PENDING` build Receipt for the row a probe wants to insert. */
    async function forgePendingBuildReceipt(input: {
      judgmentId: string;
      requestPayloadHash: Buffer;
      enterpriseId?: string;
      projectId?: string;
    }): Promise<string> {
      const commandId = newUuidV7();
      await admin.query(
        `INSERT INTO task_execution.command_receipt
           (command_id, command_type, command_version, idempotency_scope, idempotency_key,
            request_payload_hash, enterprise_id, project_id, target_type, target_id, outcome,
            correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
         VALUES ($1, 'execution.build_task_readiness', '1.0', 'wi208-tamper', $2, $3, $4, $5,
                 'zhiju.execution.task_readiness', $6, 'PENDING', $7, $8, $9, $10)`,
        [
          commandId,
          newUuidV7(),
          input.requestPayloadHash,
          input.enterpriseId ?? ENTERPRISE,
          input.projectId ?? PROJECT,
          input.judgmentId,
          CORRELATION,
          OPERATOR,
          OPERATOR_ACTOR,
          GRANT_DECISION,
        ],
      );
      return commandId;
    }

    /**
     * A judgment insert with the source row's own mirrors, the payload hash
     * recomputed inside the database, and one deliberate inconsistency. Returns
     * the refusal, or `undefined` when the database accepted the row.
     */
    async function insertJudgmentRow(input: {
      judgmentId: string;
      sourceCommandId: string;
      canonicalPayload: CanonicalJsonObject;
      ready?: boolean;
      enterpriseId?: string;
      projectId?: string;
    }): Promise<StatementFailure | undefined> {
      try {
        await admin.query(
          `INSERT INTO task_execution.execution_judgment
             (judgment_id, judgment_kind, enterprise_id, project_id, task_id,
              task_definition_snapshot_id, task_definition_hash, policy_version_ref,
              policy_content_hash, policy_effective_from, policy_superseded_at, evaluator_ref,
              input_hash, evaluated_at, valid_until, ready, canonical_payload, payload_hash,
              request_payload_hash, source_command_id, created_by_principal_id)
           SELECT $1, judgment_kind, $2, $3, task_id, task_definition_snapshot_id,
                  task_definition_hash, policy_version_ref, policy_content_hash,
                  policy_effective_from, policy_superseded_at, evaluator_ref, input_hash,
                  evaluated_at, valid_until, $4, $5::jsonb,
                  sha256(convert_to(task_execution.canonical_jsonb_text($5::jsonb), 'UTF8')),
                  request_payload_hash, $6, created_by_principal_id
             FROM task_execution.execution_judgment WHERE judgment_id = $7`,
          [
            input.judgmentId,
            input.enterpriseId ?? ENTERPRISE,
            input.projectId ?? PROJECT,
            input.ready ?? sourceReady,
            JSON.stringify(input.canonicalPayload),
            input.sourceCommandId,
            committed.judgment.judgmentId,
          ],
        );
        return undefined;
      } catch (error) {
        return statementFailure(error);
      }
    }

    // The application role has no UPDATE/DELETE path on an immutable fact, and
    // cannot call the owner-only canonicalizer.
    const appUpdate = await asAppRoleFailure(
      'task_execution_app',
      [PROJECT],
      `UPDATE task_execution.execution_judgment SET ready = true WHERE judgment_id = $1`,
      [committed.judgment.judgmentId],
    );
    expect(appUpdate.code).toBe('42501');
    const appDelete = await asAppRoleFailure(
      'task_execution_app',
      [PROJECT],
      `DELETE FROM task_execution.execution_judgment WHERE judgment_id = $1`,
      [committed.judgment.judgmentId],
    );
    expect(appDelete.code).toBe('42501');
    const appCanonicalize = await asAppRoleFailure(
      'task_execution_app',
      [PROJECT],
      `SELECT task_execution.canonical_jsonb_text('{}'::jsonb)`,
      [],
    );
    expect(appCanonicalize.code).toBe('42501');

    // Even the owner cannot rewrite the row: the immutability trigger precedes
    // every other guard on UPDATE.
    const ownerRewrite = await pgFailure(() =>
      admin.query(
        `UPDATE task_execution.execution_judgment SET canonical_payload = $2::jsonb
          WHERE judgment_id = $1`,
        [committed.judgment.judgmentId, JSON.stringify({ ...sourcePayload, ready: false })],
      ),
    );
    expect(ownerRewrite.code).toBe('23514');
    expect(ownerRewrite.message).toContain('immutable');

    // The mirror guard recomputes every promoted column and the content address
    // from the stored payload, so a tampered mirror or Scope cannot be
    // published even by a write that carries a matching `PENDING` Receipt.
    const mirrorJudgmentId = newUuidV7();
    const mirrorReceipt = await forgePendingBuildReceipt({
      judgmentId: mirrorJudgmentId,
      requestPayloadHash: sourceRequestPayloadHash,
    });
    const mirrorRefusal = await insertJudgmentRow({
      judgmentId: mirrorJudgmentId,
      sourceCommandId: mirrorReceipt,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: mirrorJudgmentId,
      },
      ready: !sourceRow.ready,
    });
    expect(mirrorRefusal?.code).toBe('22023');
    expect(mirrorRefusal?.message).toContain('promoted mirror mismatch');

    const scopeJudgmentId = newUuidV7();
    const scopeReceipt = await forgePendingBuildReceipt({
      judgmentId: scopeJudgmentId,
      requestPayloadHash: sourceRequestPayloadHash,
      enterpriseId: OTHER_ENTERPRISE,
    });
    const scopeRefusal = await insertJudgmentRow({
      judgmentId: scopeJudgmentId,
      sourceCommandId: scopeReceipt,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: scopeJudgmentId,
      },
      enterpriseId: OTHER_ENTERPRISE,
    });
    expect(scopeRefusal?.code).toBe('22023');
    expect(scopeRefusal?.message).toContain('promoted mirror mismatch');

    // A payload whose members are not even of the right JSON kind is refused by
    // the closed shape constraint of the table itself.
    const shapeJudgmentId = newUuidV7();
    const shapeReceipt = await forgePendingBuildReceipt({
      judgmentId: shapeJudgmentId,
      requestPayloadHash: sourceRequestPayloadHash,
    });
    const shapeRefusal = await insertJudgmentRow({
      judgmentId: shapeJudgmentId,
      sourceCommandId: shapeReceipt,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: shapeJudgmentId,
        checks: {},
      },
    });
    expect(shapeRefusal?.code).toBe('23514');
    expect(shapeRefusal?.message).toContain('execution_judgment_payload_shape');

    // The creation-identity guard binds the row to the very command that
    // claimed it: another command's Receipt, an already-finalized Receipt and a
    // Receipt of another Scope all fail closed.
    const foreignReceipt = (
      await admin.query<{ command_id: string }>(
        `SELECT r.command_id FROM task_execution.command_receipt r
          WHERE r.command_type = 'execution.create_task' AND r.outcome = 'COMMITTED'
          LIMIT 1`,
      )
    ).rows[0]?.command_id;
    if (foreignReceipt === undefined) throw new Error('no creation Receipt is readable');
    const forgedCommandRefusal = await insertJudgmentRow({
      judgmentId: newUuidV7(),
      sourceCommandId: foreignReceipt,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: newUuidV7(),
      },
    });
    expect(forgedCommandRefusal?.code).toBe('22023');
    expect(forgedCommandRefusal?.message).toContain('creation identity mismatch');

    const finalizedReceiptId = (
      await admin.query<{ command_id: string }>(
        `SELECT command_id FROM task_execution.command_receipt
          WHERE target_id = $1 AND outcome = 'COMMITTED'`,
        [committed.judgment.judgmentId],
      )
    ).rows[0]?.command_id;
    if (finalizedReceiptId === undefined) throw new Error('no finalized Receipt is readable');
    const finalizedRefusal = await insertJudgmentRow({
      judgmentId: newUuidV7(),
      sourceCommandId: finalizedReceiptId,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: newUuidV7(),
      },
    });
    expect(finalizedRefusal?.code).toBe('22023');
    expect(finalizedRefusal?.message).toContain('creation identity mismatch');

    const crossScopeJudgmentId = newUuidV7();
    const crossScopeReceipt = await forgePendingBuildReceipt({
      judgmentId: crossScopeJudgmentId,
      requestPayloadHash: sourceRequestPayloadHash,
    });
    const crossScopeRefusal = await insertJudgmentRow({
      judgmentId: crossScopeJudgmentId,
      sourceCommandId: crossScopeReceipt,
      canonicalPayload: {
        ...sourcePayload,
        judgmentId: crossScopeJudgmentId,
      },
      projectId: OTHER_PROJECT,
    });
    expect(crossScopeRefusal?.code).toBe('22023');
    expect(crossScopeRefusal?.message).toContain('creation identity mismatch');

    // RLS: without a trusted Context the fact is invisible, and a row outside
    // the Context's Project is refused even when every guard above accepts it.
    const judgmentCountSql = 'SELECT count(*)::int AS n FROM task_execution.execution_judgment';
    expect(await asAppRoleCount('task_execution_app', [PROJECT], judgmentCountSql, [], false)).toBe(
      0,
    );
    // … and the same statement under the trusted Context is served, so the
    // difference is the Context and not the role.
    expect(
      await asAppRoleCount('task_execution_app', [PROJECT], judgmentCountSql, [], true),
    ).toBeGreaterThan(0);
    // … while a Context of another Project sees this Project's fact not at all.
    expect(
      await asAppRoleCount(
        'task_execution_app',
        [PROJECT],
        `SELECT count(*)::int AS n FROM task_execution.execution_judgment
          WHERE project_id = $1`,
        [OTHER_PROJECT],
        true,
      ),
    ).toBe(0);

    const otherProjectJudgmentId = newUuidV7();
    const otherProjectReceipt = await forgePendingBuildReceipt({
      judgmentId: otherProjectJudgmentId,
      requestPayloadHash: sourceRequestPayloadHash,
      projectId: OTHER_PROJECT,
    });
    const otherProjectPayload = {
      ...sourcePayload,
      judgmentId: otherProjectJudgmentId,
      scope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
    } as unknown as CanonicalJsonObject;
    const rlsInsert = await asAppRoleFailure(
      'task_execution_app',
      [PROJECT],
      `INSERT INTO task_execution.execution_judgment
         (judgment_id, judgment_kind, enterprise_id, project_id, task_id,
          task_definition_snapshot_id, task_definition_hash, policy_version_ref,
          policy_content_hash, policy_effective_from, policy_superseded_at, evaluator_ref,
          input_hash, evaluated_at, valid_until, ready, canonical_payload, payload_hash,
          request_payload_hash, source_command_id, created_by_principal_id)
       SELECT $1, judgment_kind, $2, $3, task_id, task_definition_snapshot_id,
              task_definition_hash, policy_version_ref, policy_content_hash,
              policy_effective_from, policy_superseded_at, evaluator_ref, input_hash,
              evaluated_at, valid_until, ready, $4::jsonb, $5, request_payload_hash, $6,
              created_by_principal_id
         FROM task_execution.execution_judgment WHERE judgment_id = $7`,
      [
        otherProjectJudgmentId,
        ENTERPRISE,
        OTHER_PROJECT,
        JSON.stringify(otherProjectPayload),
        (
          await admin.query<{ hash: Buffer }>(
            `SELECT sha256(convert_to(task_execution.canonical_jsonb_text($1::jsonb), 'UTF8'))
                      AS hash`,
            [JSON.stringify(otherProjectPayload)],
          )
        ).rows[0]?.hash,
        otherProjectReceipt,
        committed.judgment.judgmentId,
      ],
    );
    // The WITH CHECK boundary of this table is shadowed for INSERT by the
    // creation-identity guard, whose own Receipt read is RLS-scoped: a Receipt
    // of the other Project is invisible to this writer, so the guard fails
    // closed one statement earlier. RLS itself is proven by the visibility
    // probes below and the ACL answers `42501` for every write path a role
    // holds a policy for.
    expect(rlsInsert.code).toBe('22023');
    expect(rlsInsert.message).toContain('creation identity mismatch');
    // … and the identical row is legal for the owner: nothing but the writer's
    // Scope stands between the two outcomes.
    const ownerInsert = await insertJudgmentRow({
      judgmentId: otherProjectJudgmentId,
      sourceCommandId: otherProjectReceipt,
      canonicalPayload: otherProjectPayload,
      projectId: OTHER_PROJECT,
    });
    expect(ownerInsert).toBeUndefined();

    // The pooled connection is still healthy after every refusal above.
    const afterProbes = await buildTaskJudgment(await createDraft('1.0'), {
      idempotencyKey: 'wi208-017-pool-reuse',
    });
    expect(afterProbes.result, JSON.stringify(afterProbes.result)).toMatchObject({
      status: 'COMMITTED',
    });

    // A fault injected after the judgement insert rolls the whole command back:
    // no `PENDING` claim, no judgement and no Edge survive, and the same key
    // commits on the first retry afterwards.
    const faultDraft = await createDraft('1.0');
    const faultKey = 'wi208-017-fault';
    const faultJudgmentId = newUuidV7();
    const edgesBefore = await countRows('task_execution.reference_edge');
    await admin.query(
      `CREATE OR REPLACE FUNCTION task_execution.wi208_fail_after_judgment() RETURNS trigger
       LANGUAGE plpgsql AS $fault$
       BEGIN
         RAISE EXCEPTION 'wi208 injected fault after the judgment insert';
       END
       $fault$`,
    );
    await admin.query(
      `CREATE TRIGGER wi208_fail_after_judgment_trigger
         AFTER INSERT ON task_execution.execution_judgment
         FOR EACH ROW EXECUTE FUNCTION task_execution.wi208_fail_after_judgment()`,
    );
    try {
      const faulted = await attempt(() =>
        buildReadiness({
          taskId: faultDraft.taskId,
          commandVersion: '1.0',
          snapshotId: faultDraft.snapshotId,
          definitionHash: faultDraft.definitionHash,
          judgmentId: faultJudgmentId,
          idempotencyKey: faultKey,
        }),
      );
      expect(faulted.thrown).toBe(true);
      expect(faulted.message).toContain('wi208 injected fault');
    } finally {
      await admin.query(
        'DROP TRIGGER wi208_fail_after_judgment_trigger ON task_execution.execution_judgment',
      );
    }
    expect(await judgmentRow(faultJudgmentId)).toBeUndefined();
    expect(await receiptRows(faultKey)).toEqual([]);
    expect(
      await countRows(
        `(SELECT 1 FROM task_execution.reference_edge WHERE owner_object_id = '${faultJudgmentId}') AS probe`,
      ),
    ).toBe(0);
    expect(await countRows('task_execution.reference_edge')).toBe(edgesBefore);

    const retried = await attempt(() =>
      buildReadiness({
        taskId: faultDraft.taskId,
        commandVersion: '1.0',
        snapshotId: faultDraft.snapshotId,
        definitionHash: faultDraft.definitionHash,
        judgmentId: faultJudgmentId,
        idempotencyKey: faultKey,
      }),
    );
    expect(retried.code, JSON.stringify(retried.result)).toBe('COMMITTED');
    expect(await judgmentRow(faultJudgmentId)).toBeDefined();
    await admin.query('DROP FUNCTION task_execution.wi208_fail_after_judgment()');
  });
});
