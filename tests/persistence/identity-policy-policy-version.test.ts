import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContractRegistry } from '../../contracts/src/registry.js';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import pg from 'pg';
import {
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  DEPENDENCY_UNAVAILABLE,
  digestCanonicalPayload,
  grantCapability,
  IDENTITY_POLICY_SNAPSHOT_INVALID,
  IDENTITY_POLICY_SUPERSEDE_INVALID,
  IDENTITY_POLICY_VERSION_ALREADY_BOUND,
  IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
  IDENTITY_POLICY_VERSION_UNKNOWN,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  recordPolicyVersion,
  RECORD_POLICY_VERSION_COMMAND,
  RECORD_POLICY_VERSION_PURPOSE,
  resolvePolicy,
  RESOLVE_POLICY_COMMAND,
  RESOLVE_POLICY_PURPOSE,
  revokeCapability,
  withIdentityTransaction,
  type CommittedCommandResult,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

// IM-06 (#186): the scoped PolicyVersion handlers on real PostgreSQL —
// version-key binding, supersede cardinality under sequential and concurrent
// competition, lifecycle derivation, authorization revalidation at each
// entry, Scope isolation, direct-SQL integrity and the write/read-back
// invariant (Spec 001 §13, decisions §12.2–12.9).

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c0a1';
const ENTERPRISE_B = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c0b2';
const PROJECT_A1 = 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101';
const PROJECT_A2 = 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c102';
const OPERATOR = 'c2c2c2c2-c2c2-72c2-82c2-c2c2c2c2c201';
const SERVICE = 'c2c2c2c2-c2c2-72c2-82c2-c2c2c2c2c202';
const FIXTURE_DECISION = 'c3c3c3c3-c3c3-73c3-83c3-c3c3c3c3c301';
const FIXTURE_DECISION_HASH = Buffer.alloc(32, 0x31);
const CORRELATION = 'c4c4c4c4-c4c4-74c4-84c4-c4c4c4c4c401';
const AUTH_HASH = Buffer.alloc(32, 0x44);
const POLICY_SNAPSHOT_ID = 'c5c5c5c5-c5c5-75c5-85c5-c5c5c5c5c501';
const POLICY_SNAPSHOT_SET_VERSION = 'wi186-policy-set-1';

const OPERATOR_ACTOR_ENTERPRISE = 'c6c6c6c6-c6c6-76c6-86c6-c6c6c6c6c601';
const OPERATOR_ACTOR_PROJECT = 'c6c6c6c6-c6c6-76c6-86c6-c6c6c6c6c602';
const SERVICE_ACTOR_ENTERPRISE = 'c6c6c6c6-c6c6-76c6-86c6-c6c6c6c6c603';

const RECORD_GRANT_ENTERPRISE = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c701';
const RESOLVE_GRANT_ENTERPRISE = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c702';
const RECORD_GRANT_PROJECT = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c703';
const RESOLVE_GRANT_PROJECT = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c704';
const SERVICE_RECORD_GRANT = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c705';
const REVOCABLE_GRANT_PROJECT = 'c7c7c7c7-c7c7-77c7-87c7-c7c7c7c7c706';

const RECORD_CAPABILITY = 'identity.policy.record_version';
const RESOLVE_CAPABILITY = 'identity.policy.resolve_version';
const REVOCABLE_CAPABILITY = 'wi186.revocable_version';

const POLICY_ONE = 'c8c8c8c8-c8c8-78c8-88c8-c8c8c8c8c801';
const POLICY_TWO = 'c8c8c8c8-c8c8-78c8-88c8-c8c8c8c8c802';
const POLICY_THREE = 'c8c8c8c8-c8c8-78c8-88c8-c8c8c8c8c803';
const UNKNOWN_POLICY = 'c8c8c8c8-c8c8-78c8-88c8-c8c8c8c8c8ff';

const V1 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c901';
const V2 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c902';
const V3 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c903';
const V4 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c904';
const V5 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c905';
const V6 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c906';
const V7 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c907';
const V8 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c908';
const V9 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c909';
const V10 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c90a';
const V11 = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c90b';
const UNKNOWN_VERSION = 'c9c9c9c9-c9c9-79c9-89c9-c9c9c9c9c9ff';

const FACT_ONE = 'cacacaca-caca-7aca-8aca-cacacacaca01';
const FACT_TWO = 'cacacaca-caca-7aca-8aca-cacacacaca02';
const FACT_THREE = 'cacacaca-caca-7aca-8aca-cacacacaca03';
const FACT_FOUR = 'cacacaca-caca-7aca-8aca-cacacacaca04';
const FACT_FIVE = 'cacacaca-caca-7aca-8aca-cacacacaca05';
const FACT_SIX = 'cacacaca-caca-7aca-8aca-cacacacaca06';
const FACT_SEVEN = 'cacacaca-caca-7aca-8aca-cacacacaca07';
const FACT_EIGHT = 'cacacaca-caca-7aca-8aca-cacacacaca08';
const FACT_NINE = 'cacacaca-caca-7aca-8aca-cacacacaca09';
const FACT_TEN = 'cacacaca-caca-7aca-8aca-cacacacaca0a';
const FACT_ELEVEN = 'cacacaca-caca-7aca-8aca-cacacacaca0b';
const FACT_TWELVE = 'cacacaca-caca-7aca-8aca-cacacacaca0c';

const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';
const CONTEXT_BUILDER_PROFILE = 'execution.context_builder.policy@1.0';

const PAST = new Date('2026-01-01T00:00:00.000Z');
const EARLIER = new Date('2026-02-01T00:00:00.000Z');
const MIDDLE = new Date('2026-03-01T00:00:00.000Z');
// A future effectiveFrom that is still inside the Decision TTL window, so
// the lifecycle observation can be taken at (and beyond) that instant.
const FUTURE = new Date(Date.now() + 30_000);

function testCrypto(): IdentityCryptoPorts {
  return {
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
}

const crypto = testCrypto();
const registry = new ContractRegistry();

function profileReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

function scopedKey(
  objectId: string,
  versionId: string,
  scope: { enterpriseId: string; projectId?: string },
): Common.VersionedRef {
  return { kind: 'VERSIONED', objectType: 'zhiju.identity.policy', objectId, versionId, scope };
}

function recordPayload(input: {
  key: Common.VersionedRef;
  effectiveFrom: string;
  policySetVersion?: string;
  policySchemaRefs?: Common.TypedReference[];
  policyDocument?: CanonicalJsonObject;
  supersedesRef?: Common.VersionedRef;
}): CanonicalJsonObject {
  return {
    policyRef: input.key as unknown as CanonicalJsonObject,
    policySetVersion: input.policySetVersion ?? 'wi186-set-1',
    policySchemaRefs: (input.policySchemaRefs ?? [
      profileReference(CAPTURE_PROFILE),
    ]) as unknown as CanonicalJsonObject,
    policyDocument: input.policyDocument ?? { rules: ['wi186'], version: 1 },
    effectiveFrom: input.effectiveFrom,
    ...(input.supersedesRef === undefined
      ? {}
      : { supersedesRef: input.supersedesRef as unknown as CanonicalJsonObject }),
  };
}

type PolicyVersionRecordInput = Parameters<typeof recordPolicyVersion>[1];

function recordInput(
  payload: CanonicalJsonObject,
  input: { policyVersionFactId: string; idempotencyKey: string },
): PolicyVersionRecordInput {
  return {
    policyVersionFactId: input.policyVersionFactId,
    policyRef: payload.policyRef,
    policySetVersion: payload.policySetVersion,
    policySchemaRefs: payload.policySchemaRefs,
    policyDocument: payload.policyDocument,
    effectiveFrom: payload.effectiveFrom,
    ...(payload.supersedesRef === undefined ? {} : { supersedesRef: payload.supersedesRef }),
    idempotencyKey: input.idempotencyKey,
  };
}

describe.skipIf(!gateEnabled)('policy version handlers (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let probeUrl: string;
  let db: Kysely<IdentityPolicyDb>;
  let repo: IdentityPolicyRepository;
  let fixtureContext: IdentityTransactionContext;
  let grantPolicyHash: Buffer;
  let enterpriseActor: Common.SnapshotRef;
  let projectActor: Common.SnapshotRef;
  let serviceActor: Common.SnapshotRef;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi186_probe_ip LOGIN PASSWORD 'wi186-probe-ip' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher TO wi186_probe_ip WITH INHERIT FALSE, SET TRUE`,
    );
    await admin.query(`GRANT identity_policy_app TO wi186_probe_ip WITH INHERIT FALSE, SET TRUE`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'wi186_probe_ip';
    url.password = 'wi186-probe-ip';
    probeUrl = url.toString();
    pool = new pg.Pool({ connectionString: probeUrl, max: 4 });
    db = createIdentityPolicyDatabase(pool);
    repo = new IdentityPolicyRepository(crypto);
    fixtureContext = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR_ENTERPRISE,
      authorizationDecisionId: FIXTURE_DECISION,
      authorizationDecisionHash: FIXTURE_DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: ENTERPRISE_A,
      allowedProjectIds: [PROJECT_A1, PROJECT_A2],
      correlationId: CORRELATION,
    };
    const fixtureDeps = { db, repo, crypto, context: fixtureContext };

    for (const [id, kind] of [
      [OPERATOR, 'HUMAN'],
      [SERVICE, 'SERVICE'],
    ] as const) {
      await withIdentityTransaction(db, fixtureContext, async (trx) => {
        await repo.insertPrincipal(trx, {
          id,
          principalKind: kind,
          displayName: `WI-186 ${kind} fixture`,
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR_ENTERPRISE,
        });
      });
    }

    const platformPolicy = await recordPolicySnapshot(fixtureDeps, {
      policySnapshotId: POLICY_SNAPSHOT_ID,
      policySetVersion: POLICY_SNAPSHOT_SET_VERSION,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: PAST,
      policyDocument: { rules: ['wi186-grant-policy'], version: 1 },
      idempotencyKey: 'wi186:policy:1',
    });
    expect(platformPolicy).toMatchObject({ status: 'COMMITTED' });
    const snapshotRow = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
      [POLICY_SNAPSHOT_ID],
    );
    grantPolicyHash = snapshotRow.rows[0]?.payload_hash ?? Buffer.alloc(0);
    expect(grantPolicyHash).toHaveLength(32);

    const grants: readonly {
      id: string;
      principalId: string;
      capabilityCode: string;
      scopeKind: 'ENTERPRISE' | 'PROJECT';
      projectId?: string;
    }[] = [
      {
        id: RECORD_GRANT_ENTERPRISE,
        principalId: OPERATOR,
        capabilityCode: RECORD_CAPABILITY,
        scopeKind: 'ENTERPRISE',
      },
      {
        id: RESOLVE_GRANT_ENTERPRISE,
        principalId: OPERATOR,
        capabilityCode: RESOLVE_CAPABILITY,
        scopeKind: 'ENTERPRISE',
      },
      {
        id: RECORD_GRANT_PROJECT,
        principalId: OPERATOR,
        capabilityCode: RECORD_CAPABILITY,
        scopeKind: 'PROJECT',
        projectId: PROJECT_A1,
      },
      {
        id: RESOLVE_GRANT_PROJECT,
        principalId: OPERATOR,
        capabilityCode: RESOLVE_CAPABILITY,
        scopeKind: 'PROJECT',
        projectId: PROJECT_A1,
      },
      {
        id: SERVICE_RECORD_GRANT,
        principalId: SERVICE,
        capabilityCode: RECORD_CAPABILITY,
        scopeKind: 'ENTERPRISE',
      },
      {
        id: REVOCABLE_GRANT_PROJECT,
        principalId: OPERATOR,
        capabilityCode: REVOCABLE_CAPABILITY,
        scopeKind: 'PROJECT',
        projectId: PROJECT_A1,
      },
    ];
    for (const grant of grants) {
      const result = await grantCapability(fixtureDeps, {
        grantId: grant.id,
        principalId: grant.principalId,
        capabilityCode: grant.capabilityCode,
        scope: {
          scopeKind: grant.scopeKind,
          enterpriseId: ENTERPRISE_A,
          ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
        },
        resourceSelectors: [],
        actions: [grant.capabilityCode],
        validFrom: PAST,
        grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
        grantPolicySnapshotHash: grantPolicyHash,
        justification: 'wi186 fixture',
        idempotencyKey: `wi186:grant:${grant.id}`,
      });
      expect(result).toMatchObject({ status: 'COMMITTED' });
    }

    enterpriseActor = await createActorSnapshot(fixtureDeps, {
      actorSnapshotId: OPERATOR_ACTOR_ENTERPRISE,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'ENTERPRISE',
      enterpriseId: ENTERPRISE_A,
    });
    projectActor = await createActorSnapshot(fixtureDeps, {
      actorSnapshotId: OPERATOR_ACTOR_PROJECT,
      principalId: OPERATOR,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'PROJECT',
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    serviceActor = await createActorSnapshot(fixtureDeps, {
      actorSnapshotId: SERVICE_ACTOR_ENTERPRISE,
      principalId: SERVICE,
      declaredPrincipalKind: 'SERVICE',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'ENTERPRISE',
      enterpriseId: ENTERPRISE_A,
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  function contextFor(input: {
    principalId?: string;
    actorSnapshotId?: string;
    enterpriseId?: string;
    allowedProjectIds?: string[];
    decisionId?: string;
    decisionHash?: Buffer;
    decisionExpiresAt?: Date;
  }): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: input.principalId ?? OPERATOR,
      actorSnapshotId: input.actorSnapshotId ?? OPERATOR_ACTOR_ENTERPRISE,
      authorizationDecisionId: input.decisionId ?? FIXTURE_DECISION,
      authorizationDecisionHash: input.decisionHash ?? FIXTURE_DECISION_HASH,
      authorizationDecisionExpiresAt:
        input.decisionExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: input.enterpriseId ?? ENTERPRISE_A,
      allowedProjectIds: input.allowedProjectIds ?? [PROJECT_A1, PROJECT_A2],
      correlationId: CORRELATION,
    };
  }

  function depsFor(context: IdentityTransactionContext): IdentityCommandDeps {
    return { db, repo, crypto, context };
  }

  /**
   * Runs the real Decision Port for one operation payload and binds the
   * resulting immutable decision into the transaction context, exactly like a
   * caller that authorizes before invoking the owning handler.
   */
  async function authorizedDeps(input: {
    commandType: string;
    purpose: string;
    capability: string;
    payload: CanonicalJsonObject;
    projectId?: string;
    principalId?: string;
    actorSnapshotRef?: Common.SnapshotRef;
    ttlSeconds?: number;
  }): Promise<IdentityCommandDeps> {
    const principalId = input.principalId ?? OPERATOR;
    const actorSnapshotRef = input.actorSnapshotRef ?? enterpriseActor;
    const authorizationContext = contextFor({
      principalId,
      actorSnapshotId: actorSnapshotRef.snapshotId,
      allowedProjectIds: input.projectId === undefined ? [] : [input.projectId],
    });
    const decision = await authorizeCommand(depsFor(authorizationContext), {
      actorSnapshotRef,
      intent: {
        commandType: input.commandType,
        commandVersion: '1.0',
        scopeKind: input.projectId === undefined ? 'ENTERPRISE' : 'PROJECT',
        enterpriseId: ENTERPRISE_A,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        purpose: input.purpose,
        requestedCapability: input.capability,
        commandPayloadHash: digestCanonicalPayload(input.payload).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'identity.policy_snapshot',
        objectId: POLICY_SNAPSHOT_ID,
        snapshotId: POLICY_SNAPSHOT_ID,
        scope: {},
        contentHash: {
          algorithm: 'SHA-256',
          digest: grantPolicyHash.toString('hex'),
          canonicalizationVersion: '1',
        },
      },
      ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
    });
    expect(decision.outcome).toBe('ALLOW');
    const context = contextFor({
      principalId,
      actorSnapshotId: actorSnapshotRef.snapshotId,
      allowedProjectIds:
        input.projectId === undefined ? [PROJECT_A1, PROJECT_A2] : [input.projectId],
      decisionId: decision.authorizationDecisionRef.objectId,
      decisionHash: Buffer.from(decision.authorizationDecisionRef.contentHash.digest, 'hex'),
      decisionExpiresAt: new Date(decision.expiresAt),
    });
    return depsFor(context);
  }

  async function recordAs(input: {
    key: Common.VersionedRef;
    factId: string;
    idempotencyKey: string;
    effectiveFrom: string;
    supersedesRef?: Common.VersionedRef;
    policyDocument?: CanonicalJsonObject;
    capability?: string;
    principalId?: string;
    actorSnapshotRef?: Common.SnapshotRef;
  }) {
    const projectId = input.key.scope.projectId;
    const payload = recordPayload({
      key: input.key,
      effectiveFrom: input.effectiveFrom,
      ...(input.supersedesRef === undefined ? {} : { supersedesRef: input.supersedesRef }),
      ...(input.policyDocument === undefined ? {} : { policyDocument: input.policyDocument }),
    });
    const actorSnapshotRef =
      input.actorSnapshotRef ?? (projectId === undefined ? undefined : projectActor);
    const deps = await authorizedDeps({
      commandType: RECORD_POLICY_VERSION_COMMAND,
      purpose: RECORD_POLICY_VERSION_PURPOSE,
      capability: input.capability ?? RECORD_CAPABILITY,
      payload,
      ...(projectId === undefined ? {} : { projectId }),
      ...(input.principalId === undefined ? {} : { principalId: input.principalId }),
      ...(actorSnapshotRef === undefined ? {} : { actorSnapshotRef }),
    });
    return recordPolicyVersion(
      deps,
      recordInput(payload, {
        policyVersionFactId: input.factId,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }

  async function resolveAs(key: Common.VersionedRef, asOf: Date = new Date()) {
    const deps = await authorizedDeps({
      commandType: RESOLVE_POLICY_COMMAND,
      purpose: RESOLVE_POLICY_PURPOSE,
      capability: RESOLVE_CAPABILITY,
      payload: { policyRef: key as unknown as CanonicalJsonObject },
      ...(key.scope.projectId === undefined
        ? {}
        : { projectId: key.scope.projectId, actorSnapshotRef: projectActor }),
    });
    return resolvePolicy(deps, { policyRef: key, asOf });
  }

  async function factRow(objectId: string, versionId: string, projectId: string | null) {
    const rows = await admin.query<{
      policy_version_fact_id: string;
      payload_hash: Buffer;
      effective_from: Date;
      supersedes_object_id: string | null;
      supersedes_version_id: string | null;
    }>(
      `SELECT policy_version_fact_id, payload_hash, effective_from,
              supersedes_object_id, supersedes_version_id
         FROM identity_policy.policy_version
        WHERE policy_object_id = $1 AND policy_key_version_id = $2
          AND project_id IS NOT DISTINCT FROM $3`,
      [objectId, versionId, projectId],
    );
    return rows.rows[0];
  }

  async function versionBindingCount(objectId: string, versionId: string): Promise<number> {
    const rows = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.policy_version
        WHERE policy_object_id = $1 AND policy_key_version_id = $2`,
      [objectId, versionId],
    );
    return Number(rows.rows[0]?.count ?? '0');
  }

  function factRefOf(result: CommittedCommandResult): Common.SnapshotRef {
    return result.resultPayload.policyVersionRef as unknown as Common.SnapshotRef;
  }

  it('binds one immutable fact per version key for Project and Enterprise scope', async () => {
    const projectKey = scopedKey(POLICY_ONE, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const first = await recordAs({
      key: projectKey,
      factId: FACT_ONE,
      idempotencyKey: 'wi186:record:p1',
      effectiveFrom: '2026-01-01T00:00:00Z',
    });
    expect(first).toMatchObject({ status: 'COMMITTED' });
    const factRef = factRefOf(first as CommittedCommandResult);
    expect(factRef).toMatchObject({
      kind: 'SNAPSHOT',
      objectType: 'zhiju.identity.policy_version',
      objectId: FACT_ONE,
      snapshotId: FACT_ONE,
      scope: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
    });
    const stored = await factRow(POLICY_ONE, V1, PROJECT_A1);
    if (stored === undefined) throw new Error('committed fact is missing');
    expect(factRef.contentHash.digest).toBe(stored.payload_hash.toString('hex'));
    expect(
      registry.validateOperationResult(
        RECORD_POLICY_VERSION_COMMAND,
        '1.0',
        (first as CommittedCommandResult).resultPayload,
      ),
    ).toMatchObject({ valid: true });

    // Rebinding the same version key with another document is rejected; the
    // first fact, its hash and the committed binding stay untouched.
    const rebind = await recordAs({
      key: projectKey,
      factId: FACT_TWO,
      idempotencyKey: 'wi186:record:p1-rebind',
      effectiveFrom: '2026-01-01T00:00:00Z',
      policyDocument: { rules: ['wi186', 'rebind'], version: 2 },
    });
    expect(rebind).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_VERSION_ALREADY_BOUND,
    });
    const unchanged = await factRow(POLICY_ONE, V1, PROJECT_A1);
    expect(unchanged?.policy_version_fact_id).toBe(FACT_ONE);
    expect(unchanged?.payload_hash.equals(stored.payload_hash)).toBe(true);
    expect(await versionBindingCount(POLICY_ONE, V1)).toBe(1);

    // Enterprise scope (project_id IS NULL) is bound by the same version key
    // and stays a distinct fact from the Project row.
    const enterpriseKey = scopedKey(POLICY_ONE, V1, { enterpriseId: ENTERPRISE_A });
    const enterpriseFirst = await recordAs({
      key: enterpriseKey,
      factId: FACT_THREE,
      idempotencyKey: 'wi186:record:e1',
      effectiveFrom: '2026-01-02T00:00:00Z',
    });
    expect(enterpriseFirst).toMatchObject({ status: 'COMMITTED' });
    const enterpriseRebind = await recordAs({
      key: enterpriseKey,
      factId: FACT_FOUR,
      idempotencyKey: 'wi186:record:e1-rebind',
      effectiveFrom: '2026-01-02T00:00:00Z',
      policyDocument: { rules: ['wi186', 'enterprise-rebind'], version: 2 },
    });
    expect(enterpriseRebind).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_VERSION_ALREADY_BOUND,
    });
    expect((await factRow(POLICY_ONE, V1, null))?.policy_version_fact_id).toBe(FACT_THREE);

    // Different Policies' first versions and non-superseding versions of the
    // same identity coexist in one Scope: the successor index predicate is
    // false for rows without a real supersede edge.
    const secondPolicyKey = scopedKey(POLICY_TWO, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    expect(
      await recordAs({
        key: secondPolicyKey,
        factId: FACT_FIVE,
        idempotencyKey: 'wi186:record:p2-first',
        effectiveFrom: '2026-01-03T00:00:00Z',
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    const siblingKey = scopedKey(POLICY_ONE, V2, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    expect(
      await recordAs({
        key: siblingKey,
        factId: FACT_SIX,
        idempotencyKey: 'wi186:record:p1-sibling',
        effectiveFrom: '2026-01-04T00:00:00Z',
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(await versionBindingCount(POLICY_ONE, V1)).toBe(2);
  });

  it('keeps the supersede edge unique and derives supersededAt from the successor', async () => {
    const predecessorKey = scopedKey(POLICY_ONE, V3, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const successorKey = scopedKey(POLICY_ONE, V4, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    expect(
      await recordAs({
        key: predecessorKey,
        factId: FACT_SEVEN,
        idempotencyKey: 'wi186:record:p1-v3',
        effectiveFrom: EARLIER.toISOString(),
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await recordAs({
        key: successorKey,
        factId: FACT_EIGHT,
        idempotencyKey: 'wi186:record:p1-v4',
        effectiveFrom: MIDDLE.toISOString(),
        supersedesRef: predecessorKey,
      }),
    ).toMatchObject({ status: 'COMMITTED' });

    const predecessor = await resolveAs(predecessorKey);
    expect(predecessor).toMatchObject({
      useStatus: 'SUPERSEDED',
      supersededAt: MIDDLE.toISOString(),
      effectiveFrom: EARLIER.toISOString(),
      policyRef: { objectId: POLICY_ONE, versionId: V3 },
    });
    expect((await resolveAs(predecessorKey, MIDDLE)).useStatus).toBe('SUPERSEDED');
    expect((await resolveAs(predecessorKey, EARLIER)).useStatus).toBe('USABLE');
    const successor = await resolveAs(successorKey);
    expect(successor.useStatus).toBe('USABLE');
    expect(successor.supersededAt).toBeUndefined();

    // A second successor of the same predecessor is rejected and cannot
    // rewrite the derived supersededAt of the first edge.
    const rivalKey = scopedKey(POLICY_ONE, V5, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const rival = await recordAs({
      key: rivalKey,
      factId: FACT_NINE,
      idempotencyKey: 'wi186:record:p1-v5',
      effectiveFrom: FUTURE.toISOString(),
      supersedesRef: predecessorKey,
    });
    expect(rival).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
    });
    const edgeRows = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.policy_version
        WHERE supersedes_object_id = $1 AND supersedes_version_id = $2`,
      [POLICY_ONE, V3],
    );
    expect(edgeRows.rows[0]?.count).toBe('1');
    expect((await resolveAs(predecessorKey)).supersededAt).toBe(MIDDLE.toISOString());

    // A successor that only becomes effective in the future leaves the
    // predecessor usable until its own effectiveFrom.
    const futurePredecessorKey = scopedKey(POLICY_ONE, V6, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const futureSuccessorKey = scopedKey(POLICY_ONE, V7, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    expect(
      await recordAs({
        key: futurePredecessorKey,
        factId: FACT_TEN,
        idempotencyKey: 'wi186:record:p1-v6',
        effectiveFrom: EARLIER.toISOString(),
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(
      await recordAs({
        key: futureSuccessorKey,
        factId: FACT_ELEVEN,
        idempotencyKey: 'wi186:record:p1-v7',
        effectiveFrom: FUTURE.toISOString(),
        supersedesRef: futurePredecessorKey,
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    expect(await resolveAs(futurePredecessorKey)).toMatchObject({
      useStatus: 'USABLE',
      supersededAt: FUTURE.toISOString(),
    });
    expect((await resolveAs(futurePredecessorKey, FUTURE)).useStatus).toBe('SUPERSEDED');

    // Invalid edges never create a supersede edge or a version fact.
    const invalidEdges: readonly { label: string; supersedesRef: Common.VersionedRef }[] = [
      { label: 'self', supersedesRef: predecessorKey },
      {
        label: 'unknown',
        supersedesRef: scopedKey(POLICY_ONE, UNKNOWN_VERSION, {
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A1,
        }),
      },
      {
        label: 'cross-identity',
        supersedesRef: scopedKey(POLICY_TWO, V1, {
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A1,
        }),
      },
      {
        label: 'cross-scope',
        supersedesRef: scopedKey(POLICY_ONE, V3, {
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A2,
        }),
      },
      {
        label: 'not-earlier',
        supersedesRef: scopedKey(POLICY_ONE, V4, {
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A1,
        }),
      },
      { label: 'reversed', supersedesRef: futureSuccessorKey },
    ];
    let invalidFactSeed = 0;
    for (const edge of invalidEdges) {
      invalidFactSeed += 1;
      const key = scopedKey(POLICY_ONE, V8, {
        enterpriseId: ENTERPRISE_A,
        projectId: PROJECT_A1,
      });
      const factId = `cacacaca-caca-7aca-8aca-cacacacaca${(0x20 + invalidFactSeed).toString(16)}`;
      const result = await recordAs({
        key,
        factId,
        idempotencyKey: `wi186:record:invalid-${edge.label}`,
        effectiveFrom: EARLIER.toISOString(),
        supersedesRef: edge.supersedesRef,
      });
      expect(result).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_SUPERSEDE_INVALID,
      });
    }
    expect(await versionBindingCount(POLICY_ONE, V8)).toBe(0);
  });

  it('adjudicates concurrent rebinding and rival successors without leaking 23505', async () => {
    const racedKey = scopedKey(POLICY_TWO, V2, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const raceResults = await Promise.all([
      recordAs({
        key: racedKey,
        factId: FACT_TWELVE,
        idempotencyKey: 'wi186:record:race-a',
        effectiveFrom: EARLIER.toISOString(),
      }),
      recordAs({
        key: racedKey,
        factId: 'cacacaca-caca-7aca-8aca-cacacacaca0d',
        idempotencyKey: 'wi186:record:race-b',
        effectiveFrom: EARLIER.toISOString(),
        policyDocument: { rules: ['wi186', 'race'], version: 3 },
      }),
    ]);
    expect(raceResults.map((result) => result.status).sort()).toEqual(['COMMITTED', 'REJECTED']);
    const losingRebind = raceResults.find((result) => result.status === 'REJECTED');
    expect(losingRebind).toMatchObject({ errorCode: IDENTITY_POLICY_VERSION_ALREADY_BOUND });
    expect(await versionBindingCount(POLICY_TWO, V2)).toBe(1);

    // Two connections race to succeed the same predecessor: exactly one edge.
    const predecessorKey = scopedKey(POLICY_TWO, V3, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    expect(
      await recordAs({
        key: predecessorKey,
        factId: 'cacacaca-caca-7aca-8aca-cacacacaca0e',
        idempotencyKey: 'wi186:record:race-predecessor',
        effectiveFrom: EARLIER.toISOString(),
      }),
    ).toMatchObject({ status: 'COMMITTED' });
    const rivalA = scopedKey(POLICY_TWO, V4, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const rivalB = scopedKey(POLICY_TWO, V5, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const successorRace = await Promise.all([
      recordAs({
        key: rivalA,
        factId: 'cacacaca-caca-7aca-8aca-cacacacaca0f',
        idempotencyKey: 'wi186:record:race-successor-a',
        effectiveFrom: MIDDLE.toISOString(),
        supersedesRef: predecessorKey,
      }),
      recordAs({
        key: rivalB,
        factId: 'cacacaca-caca-7aca-8aca-cacacacaca10',
        idempotencyKey: 'wi186:record:race-successor-b',
        effectiveFrom: FUTURE.toISOString(),
        supersedesRef: predecessorKey,
      }),
    ]);
    expect(successorRace.map((result) => result.status).sort()).toEqual(['COMMITTED', 'REJECTED']);
    const losingSuccessor = successorRace.find((result) => result.status === 'REJECTED');
    expect(losingSuccessor).toMatchObject({
      errorCode: IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
    });
    const edge = await admin.query<{ effective_from: Date }>(
      `SELECT effective_from FROM identity_policy.policy_version
        WHERE supersedes_object_id = $1 AND supersedes_version_id = $2`,
      [POLICY_TWO, V3],
    );
    expect(edge.rows).toHaveLength(1);
    const winnerEffectiveFrom = edge.rows[0]?.effective_from.toISOString();
    expect([MIDDLE.toISOString(), FUTURE.toISOString()]).toContain(winnerEffectiveFrom);
    const predecessor = await resolveAs(predecessorKey);
    expect(predecessor.supersededAt).toBe(winnerEffectiveFrom);
    expect(predecessor.useStatus).toBe(
      winnerEffectiveFrom === FUTURE.toISOString() ? 'USABLE' : 'SUPERSEDED',
    );
  });

  it('resolves the exact observation and never falls back to another version', async () => {
    const boundKey = scopedKey(POLICY_ONE, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const stored = await factRow(POLICY_ONE, V1, PROJECT_A1);
    if (stored === undefined) throw new Error('committed fact is missing');
    const asOf = new Date();
    const view = await resolveAs(boundKey, asOf);
    expect(view.policyRef).toEqual(boundKey);
    expect(view.policyVersionRef).toMatchObject({
      kind: 'SNAPSHOT',
      objectType: 'zhiju.identity.policy_version',
      objectId: FACT_ONE,
      snapshotId: FACT_ONE,
      scope: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
      contentHash: { digest: stored.payload_hash.toString('hex') },
    });
    expect(view.contentHash).toEqual(view.policyVersionRef.contentHash);
    expect(view.policyDocument).toEqual({ rules: ['wi186'], version: 1 });
    expect(view.policySetVersion).toBe('wi186-set-1');
    expect(view.policySchemaRefs).toEqual([profileReference(CAPTURE_PROFILE)]);
    expect(view.effectiveFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(view.checkedAt).toBe(asOf.toISOString());
    expect(view.useStatus).toBe('USABLE');
    expect(registry.validateOperationResult(RESOLVE_POLICY_COMMAND, '1.0', view)).toMatchObject({
      valid: true,
    });

    // A sibling version of the same identity does not leak into the read.
    const siblingKey = scopedKey(POLICY_ONE, V2, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const sibling = await resolveAs(siblingKey);
    expect(sibling.policyVersionRef.objectId).toBe(FACT_SIX);
    expect(sibling.policyDocument).toEqual({ rules: ['wi186'], version: 1 });

    const unknownVersionKey = scopedKey(POLICY_THREE, UNKNOWN_VERSION, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const unknownIdentityKey = scopedKey(UNKNOWN_POLICY, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    for (const key of [unknownIdentityKey, unknownVersionKey]) {
      await expect(resolveAs(key)).rejects.toMatchObject({
        code: IDENTITY_POLICY_VERSION_UNKNOWN,
      });
    }
    const audit = await admin.query<{ error_code: string; safe_summary: string }>(
      `SELECT error_code, safe_summary FROM identity_policy.audit_record
        WHERE command_type = $1 AND error_code = $2 AND target_id IS NULL
        ORDER BY recorded_at DESC LIMIT 1`,
      [RESOLVE_POLICY_COMMAND, IDENTITY_POLICY_VERSION_UNKNOWN],
    );
    expect(audit.rows[0]).toMatchObject({
      error_code: IDENTITY_POLICY_VERSION_UNKNOWN,
      safe_summary: 'unknown-or-unbound-version',
    });

    // Same Enterprise but a Project outside the caller's authorization set:
    // invisible, unified unavailable, audited without a Project scope.
    await expect(
      resolvePolicy(depsFor(contextFor({ allowedProjectIds: [PROJECT_A2] })), {
        policyRef: boundKey,
        asOf: new Date(),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_POLICY_VERSION_UNKNOWN });
    const scopeAudit = await admin.query<{ project_id: string | null; safe_summary: string }>(
      `SELECT project_id, safe_summary FROM identity_policy.audit_record
        WHERE command_type = $1 AND error_code = $2
        ORDER BY recorded_at DESC LIMIT 1`,
      [RESOLVE_POLICY_COMMAND, IDENTITY_POLICY_VERSION_UNKNOWN],
    );
    expect(scopeAudit.rows[0]).toMatchObject({
      project_id: null,
      safe_summary: 'scope-mismatch',
    });

    // Another Enterprise's Context cannot resolve the version key either.
    await expect(
      resolvePolicy(depsFor(contextFor({ enterpriseId: ENTERPRISE_B, allowedProjectIds: [] })), {
        policyRef: boundKey,
        asOf: new Date(),
      }),
    ).rejects.toMatchObject({ code: IDENTITY_POLICY_VERSION_UNKNOWN });
  });

  it('revalidates the pinned decision, its purpose, its grants and its expiry', async () => {
    const key = scopedKey(POLICY_THREE, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const payload = recordPayload({ key, effectiveFrom: EARLIER.toISOString() });

    // A Decision issued for the resolution purpose cannot record a version.
    const recordWithResolveDecision = await recordPolicyVersion(
      await authorizedDeps({
        commandType: RESOLVE_POLICY_COMMAND,
        purpose: RESOLVE_POLICY_PURPOSE,
        capability: RESOLVE_CAPABILITY,
        payload,
        projectId: PROJECT_A1,
        actorSnapshotRef: projectActor,
      }),
      recordInput(payload, {
        policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca11',
        idempotencyKey: 'wi186:auth:1',
      }),
    );
    expect(recordWithResolveDecision).toMatchObject({
      status: 'REJECTED',
      errorCode: AUTHORIZATION_DECISION_INVALID,
    });
    expect(await versionBindingCount(POLICY_THREE, V1)).toBe(0);

    // Registration permission does not grant resolution permission.
    await expect(
      resolvePolicy(
        await authorizedDeps({
          commandType: RECORD_POLICY_VERSION_COMMAND,
          purpose: RECORD_POLICY_VERSION_PURPOSE,
          capability: RECORD_CAPABILITY,
          payload: { policyRef: key as unknown as CanonicalJsonObject },
          projectId: PROJECT_A1,
          actorSnapshotRef: projectActor,
        }),
        { policyRef: key, asOf: new Date() },
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // A constrained Service with its own exact-scope Decision is authorized:
    // no identity wildcard, no blanket rejection either.
    const serviceKey = scopedKey(POLICY_THREE, V1, { enterpriseId: ENTERPRISE_A });
    const servicePayload = recordPayload({
      key: serviceKey,
      effectiveFrom: EARLIER.toISOString(),
    });
    const serviceRecord = await recordPolicyVersion(
      await authorizedDeps({
        commandType: RECORD_POLICY_VERSION_COMMAND,
        purpose: RECORD_POLICY_VERSION_PURPOSE,
        capability: RECORD_CAPABILITY,
        payload: servicePayload,
        principalId: SERVICE,
        actorSnapshotRef: serviceActor,
      }),
      recordInput(servicePayload, {
        policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca12',
        idempotencyKey: 'wi186:auth:2',
      }),
    );
    expect(serviceRecord).toMatchObject({ status: 'COMMITTED' });
    expect(await versionBindingCount(POLICY_THREE, V1)).toBe(1);

    // Revoking the covering grant closes the already-issued Decision.
    const revocableKey = scopedKey(POLICY_THREE, V2, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const revocablePayload = recordPayload({
      key: revocableKey,
      effectiveFrom: EARLIER.toISOString(),
    });
    const revocableDeps = await authorizedDeps({
      commandType: RECORD_POLICY_VERSION_COMMAND,
      purpose: RECORD_POLICY_VERSION_PURPOSE,
      capability: REVOCABLE_CAPABILITY,
      payload: revocablePayload,
      projectId: PROJECT_A1,
      actorSnapshotRef: projectActor,
    });
    const revoked = await revokeCapability(depsFor(fixtureContext), {
      targetId: REVOCABLE_GRANT_PROJECT,
      expectedAggregateVersion: '1',
      scope: { scopeKind: 'PROJECT', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
      reasonCode: 'wi186.revoke',
      effectiveAt: new Date(),
      idempotencyKey: 'wi186:revoke:1',
    });
    expect(revoked).toMatchObject({ status: 'COMMITTED' });
    expect(
      await recordPolicyVersion(
        revocableDeps,
        recordInput(revocablePayload, {
          policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca13',
          idempotencyKey: 'wi186:auth:3',
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', errorCode: AUTHORIZATION_REVOKED });
    expect(await versionBindingCount(POLICY_THREE, V2)).toBe(0);

    // An expired Decision is rejected at the owning entry. The Decision row's
    // expiry is a real timestamp compared against server time, so this one
    // case has to let the actual TTL elapse; the Context's own expiry stays
    // live, which is the only state in which an expired decision can even
    // reach the owning handler.
    const expiringKey = scopedKey(POLICY_THREE, V3, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const expiringPayload = recordPayload({
      key: expiringKey,
      effectiveFrom: EARLIER.toISOString(),
    });
    const expiringRecordDeps = await authorizedDeps({
      commandType: RECORD_POLICY_VERSION_COMMAND,
      purpose: RECORD_POLICY_VERSION_PURPOSE,
      capability: RECORD_CAPABILITY,
      payload: expiringPayload,
      projectId: PROJECT_A1,
      actorSnapshotRef: projectActor,
      ttlSeconds: 1,
    });
    const expiringResolveDeps = await authorizedDeps({
      commandType: RESOLVE_POLICY_COMMAND,
      purpose: RESOLVE_POLICY_PURPOSE,
      capability: RESOLVE_CAPABILITY,
      payload: { policyRef: expiringKey as unknown as CanonicalJsonObject },
      projectId: PROJECT_A1,
      actorSnapshotRef: projectActor,
      ttlSeconds: 1,
    });
    const expiryElapsed = Promise.withResolvers<undefined>();
    setTimeout(() => {
      expiryElapsed.resolve(undefined);
    }, 1_100);
    await expiryElapsed.promise;
    const live = (deps: IdentityCommandDeps) =>
      depsFor({
        ...deps.context,
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    expect(
      await recordPolicyVersion(
        live(expiringRecordDeps),
        recordInput(expiringPayload, {
          policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca14',
          idempotencyKey: 'wi186:auth:4',
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', errorCode: AUTHORIZATION_EXPIRED });
    await expect(
      resolvePolicy(live(expiringResolveDeps), { policyRef: expiringKey, asOf: new Date() }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_EXPIRED });
    expect(await versionBindingCount(POLICY_THREE, V3)).toBe(0);

    // A request Scope outside the caller's authorization collapses to the
    // unified unavailable code and is audited with the Context Scope only.
    const foreignProjectKey = scopedKey(POLICY_THREE, V4, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A2,
    });
    const foreignPayload = recordPayload({
      key: foreignProjectKey,
      effectiveFrom: EARLIER.toISOString(),
    });
    const outOfScope = await recordPolicyVersion(
      await authorizedDeps({
        commandType: RECORD_POLICY_VERSION_COMMAND,
        purpose: RECORD_POLICY_VERSION_PURPOSE,
        capability: RECORD_CAPABILITY,
        payload: foreignPayload,
        projectId: PROJECT_A1,
        actorSnapshotRef: projectActor,
      }),
      recordInput(foreignPayload, {
        policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca15',
        idempotencyKey: 'wi186:auth:5',
      }),
    );
    expect(outOfScope).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
    });
    const outOfScopeAudit = await admin.query<{
      project_id: string | null;
      error_code: string;
    }>(
      `SELECT project_id, error_code FROM identity_policy.audit_record
        WHERE command_type = $1 AND error_code = $2
        ORDER BY recorded_at DESC LIMIT 1`,
      [RECORD_POLICY_VERSION_COMMAND, IDENTITY_POLICY_VERSION_UNKNOWN],
    );
    expect(outOfScopeAudit.rows[0]).toMatchObject({
      project_id: null,
      error_code: IDENTITY_POLICY_VERSION_UNKNOWN,
    });
    expect(await versionBindingCount(POLICY_THREE, V4)).toBe(0);

    // Unregistered or non-canonical policy schema references are rejected.
    const unregisteredKey = scopedKey(POLICY_THREE, V5, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const unregisteredPayload = recordPayload({
      key: unregisteredKey,
      effectiveFrom: EARLIER.toISOString(),
      policySchemaRefs: [
        {
          kind: 'VERSIONED',
          objectType: 'identity.contract_schema',
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d4ff',
          versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
          scope: {},
        },
      ],
    });
    const nonCanonicalPayload = recordPayload({
      key: unregisteredKey,
      effectiveFrom: EARLIER.toISOString(),
      policySchemaRefs: [
        {
          ...profileReference(CONTEXT_BUILDER_PROFILE),
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
        },
      ],
    });
    for (const [label, candidate] of [
      ['unregistered', unregisteredPayload],
      ['non-canonical', nonCanonicalPayload],
    ] as const) {
      const result = await recordPolicyVersion(
        await authorizedDeps({
          commandType: RECORD_POLICY_VERSION_COMMAND,
          purpose: RECORD_POLICY_VERSION_PURPOSE,
          capability: RECORD_CAPABILITY,
          payload: candidate,
          projectId: PROJECT_A1,
          actorSnapshotRef: projectActor,
        }),
        recordInput(candidate, {
          policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca16',
          idempotencyKey: `wi186:auth:ref-${label}`,
        }),
      );
      expect(result).toMatchObject({
        status: 'REJECTED',
        errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
      });
    }
    expect(await versionBindingCount(POLICY_THREE, V5)).toBe(0);

    // Sub-millisecond instants are rejected at the write boundary (SD-181-1).
    const longInstantKey = scopedKey(POLICY_THREE, V6, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const longInstantPayload = recordPayload({
      key: longInstantKey,
      effectiveFrom: `2026-09-13T00:00:00.${'0'.repeat(4)}Z`,
    });
    expect(
      await recordPolicyVersion(
        await authorizedDeps({
          commandType: RECORD_POLICY_VERSION_COMMAND,
          purpose: RECORD_POLICY_VERSION_PURPOSE,
          capability: RECORD_CAPABILITY,
          payload: longInstantPayload,
          projectId: PROJECT_A1,
          actorSnapshotRef: projectActor,
        }),
        recordInput(longInstantPayload, {
          policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca17',
          idempotencyKey: 'wi186:auth:instant',
        }),
      ),
    ).toMatchObject({ status: 'REJECTED', errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID });
    expect(await versionBindingCount(POLICY_THREE, V6)).toBe(0);
  });

  it('commits fact and receipt atomically and replays the committed result', async () => {
    const key = scopedKey(POLICY_THREE, V7, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const committed = await recordAs({
      key,
      factId: 'cacacaca-caca-7aca-8aca-cacacacaca18',
      idempotencyKey: 'wi186:replay:1',
      effectiveFrom: EARLIER.toISOString(),
    });
    expect(committed).toMatchObject({ status: 'COMMITTED' });
    const committedResult = committed as CommittedCommandResult;
    const committedResultHash = committedResult.resultPayloadHash.toString('hex');
    const committedFactHash = factRefOf(committedResult).contentHash.digest;

    // Response loss: the original key and payload return the committed result.
    const replayed = await recordAs({
      key,
      factId: 'cacacaca-caca-7aca-8aca-cacacacaca18',
      idempotencyKey: 'wi186:replay:1',
      effectiveFrom: EARLIER.toISOString(),
    });
    expect(replayed).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
    if (replayed.status !== 'DUPLICATE') throw new Error('expected a duplicate replay');
    expect(replayed.resultPayloadHash?.toString('hex')).toBe(committedResultHash);

    // A pre-commit conflict leaves no new version fact behind and records the
    // rejection as the only technical fact of that attempt.
    const conflictKey = scopedKey(POLICY_THREE, V8, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const conflicting = await recordAs({
      key: conflictKey,
      factId: 'cacacaca-caca-7aca-8aca-cacacacaca18',
      idempotencyKey: 'wi186:replay:2',
      effectiveFrom: EARLIER.toISOString(),
    });
    expect(conflicting).toMatchObject({
      status: 'REJECTED',
      errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID,
    });
    expect(await versionBindingCount(POLICY_THREE, V8)).toBe(0);
    const receipts = await admin.query<{ outcome: string; count: string }>(
      `SELECT outcome, count(*) AS count FROM identity_policy.command_receipt
        WHERE idempotency_key = $1 GROUP BY outcome`,
      ['wi186:replay:2'],
    );
    expect(receipts.rows).toEqual([{ outcome: 'REJECTED', count: '1' }]);
    const original = await factRow(POLICY_THREE, V7, PROJECT_A1);
    expect(original?.payload_hash.toString('hex')).toBe(committedFactHash);

    // Same idempotency key, different payload: shared idempotency conflict.
    await expect(
      recordAs({
        key: conflictKey,
        factId: 'cacacaca-caca-7aca-8aca-cacacacaca19',
        idempotencyKey: 'wi186:replay:1',
        effectiveFrom: MIDDLE.toISOString(),
      }),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
  });

  it('isolates the scoped facts under RLS and rejects direct SQL tampering', async () => {
    const key = scopedKey(POLICY_THREE, V9, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const committed = await recordAs({
      key,
      factId: 'cacacaca-caca-7aca-8aca-cacacacaca1a',
      idempotencyKey: 'wi186:isolation:1',
      effectiveFrom: EARLIER.toISOString(),
    });
    expect(committed).toMatchObject({ status: 'COMMITTED' });

    // The runtime role cannot update or delete committed version facts.
    await admin.query(`SET ROLE identity_policy_app`);
    await expect(
      admin.query(`UPDATE identity_policy.policy_version SET policy_set_version = 'x'`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query(`DELETE FROM identity_policy.policy_version`)).rejects.toMatchObject({
      code: '42501',
    });
    const withoutContext = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.policy_version`,
    );
    expect(withoutContext.rows[0]?.count).toBe('0');
    const directPayload: CanonicalJsonObject = {
      policyRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
        objectId: POLICY_THREE,
        versionId: V10,
        scope: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1 },
      },
      policySetVersion: 'wi186-direct',
      policySchemaRefs: [profileReference(CAPTURE_PROFILE)] as unknown as CanonicalJsonObject,
      policyDocument: { rules: ['direct'], version: 1 },
      effectiveFrom: EARLIER.toISOString(),
    };
    const directDigest = digestCanonicalPayload(directPayload);
    await expect(
      admin.query(
        `INSERT INTO identity_policy.policy_version (
           policy_version_fact_id, policy_object_id, policy_key_version_id, scope_kind,
           enterprise_id, project_id, policy_set_version, policy_schema_refs, effective_from,
           contract_type, contract_version, schema_registry_version, canonicalization_version,
           payload_hash_algorithm, payload_hash, payload_size_bytes, canonical_payload,
           created_by_principal_id, actor_snapshot_id, source_command_id, data_classification,
           retention_class)
         VALUES ($1, $2, $3, 'PROJECT', $4, $5, 'wi186-direct', $6::jsonb, $7,
           'identity.PolicyVersion', '1.0', $8, '1', 'SHA-256', $9, $10, $11::jsonb,
           $12, $13, $14, 'INTERNAL', 'CUSTOMER_RECORD')`,
        [
          'cacacaca-caca-7aca-8aca-cacacacaca1b',
          POLICY_THREE,
          V10,
          ENTERPRISE_A,
          PROJECT_A1,
          JSON.stringify(directPayload.policySchemaRefs),
          EARLIER,
          POLICY_PROFILE_REGISTRY_VERSION,
          directDigest.hash,
          directDigest.sizeBytes,
          directDigest.canonicalJson,
          OPERATOR,
          OPERATOR_ACTOR_ENTERPRISE,
          CORRELATION,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await admin.query(`RESET ROLE`);
    expect(await versionBindingCount(POLICY_THREE, V10)).toBe(0);

    // Another Enterprise or an unauthorized Project Context sees zero rows.
    const hiddenFromOtherEnterprise = await withIdentityTransaction(
      db,
      contextFor({ enterpriseId: ENTERPRISE_B, allowedProjectIds: [] }),
      async (trx) =>
        trx.selectFrom('identity_policy.policy_version').select('policy_version_fact_id').execute(),
    );
    expect(hiddenFromOtherEnterprise).toEqual([]);
    const projectRowQuery = (context: IdentityTransactionContext) =>
      withIdentityTransaction(db, context, async (trx) =>
        trx
          .selectFrom('identity_policy.policy_version')
          .select('policy_version_fact_id')
          .where('policy_object_id', '=', POLICY_ONE)
          .where('policy_key_version_id', '=', V1)
          .where('scope_kind', '=', 'PROJECT')
          .execute(),
      );
    expect(await projectRowQuery(contextFor({ allowedProjectIds: [PROJECT_A1] }))).toHaveLength(1);
    expect(await projectRowQuery(contextFor({ allowedProjectIds: [PROJECT_A2] }))).toEqual([]);

    // A privileged direct-SQL rewrite (a superuser bypasses RLS but not the
    // guard trigger) is rejected for promoted columns ...
    await expect(
      admin.query(
        `UPDATE identity_policy.policy_version SET effective_from = $1
          WHERE policy_object_id = $2 AND policy_key_version_id = $3`,
        [FUTURE, POLICY_THREE, V9],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    // ... and a rewrite that keeps every mirror consistent is caught by the
    // read-side integrity boundary instead.
    await admin.query(
      `UPDATE identity_policy.policy_version
          SET canonical_payload = jsonb_set(canonical_payload, '{policyDocument}', '{"tampered":true}'::jsonb)
        WHERE policy_object_id = $1 AND policy_key_version_id = $2`,
      [POLICY_THREE, V9],
    );
    await expect(resolveAs(key)).rejects.toMatchObject({
      code: IDENTITY_POLICY_SNAPSHOT_INVALID,
    });
    const integrityAudit = await admin.query<{ error_code: string }>(
      `SELECT error_code FROM identity_policy.audit_record
        WHERE command_type = $1 AND error_code = $2
        ORDER BY recorded_at DESC LIMIT 1`,
      [RESOLVE_POLICY_COMMAND, IDENTITY_POLICY_SNAPSHOT_INVALID],
    );
    expect(integrityAudit.rows[0]?.error_code).toBe(IDENTITY_POLICY_SNAPSHOT_INVALID);

    // Pool reuse never inherits the previous transaction's Context: the same
    // single connection that just resolved inside a Context reads zero rows.
    const isolatedPool = new pg.Pool({ connectionString: probeUrl, max: 1 });
    const isolatedDb = createIdentityPolicyDatabase(isolatedPool);
    const visibleInside = await withIdentityTransaction(isolatedDb, contextFor({}), async (trx) =>
      trx
        .selectFrom('identity_policy.policy_version')
        .select('policy_version_fact_id')
        .where('policy_object_id', '=', POLICY_ONE)
        .execute(),
    );
    expect(visibleInside.length).toBeGreaterThan(0);
    // ... the pooled connection returns to its login role (no schema access)
    // and, once switched to the app role without a new Context, sees zero rows.
    await expect(
      isolatedPool.query(`SELECT count(*) FROM identity_policy.policy_version`),
    ).rejects.toMatchObject({ code: '42501' });
    const reused = await isolatedPool.connect();
    try {
      await reused.query('SET ROLE identity_policy_app');
      const afterCommit = await reused.query<{ count: string }>(
        `SELECT count(*) AS count FROM identity_policy.policy_version`,
      );
      expect(afterCommit.rows[0]?.count).toBe('0');
    } finally {
      reused.release();
    }
    await isolatedPool.end();
  });

  it('round-trips a near-limit legal version through the owning handler', async () => {
    const entries = Array.from({ length: 16 }, (_, index) => ({
      index,
      text: 'a'.repeat(16_000),
    }));
    const document = { entries } as unknown as CanonicalJsonObject;
    const key = scopedKey(POLICY_THREE, V11, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    const payload = recordPayload({
      key,
      effectiveFrom: EARLIER.toISOString(),
      policyDocument: document,
    });
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(payloadBytes).toBeGreaterThan(250_000);
    expect(payloadBytes).toBeLessThanOrEqual(262_144);

    const committed = await recordPolicyVersion(
      await authorizedDeps({
        commandType: RECORD_POLICY_VERSION_COMMAND,
        purpose: RECORD_POLICY_VERSION_PURPOSE,
        capability: RECORD_CAPABILITY,
        payload,
        projectId: PROJECT_A1,
        actorSnapshotRef: projectActor,
      }),
      recordInput(payload, {
        policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca1c',
        idempotencyKey: 'wi186:limited:1',
      }),
    );
    expect(committed).toMatchObject({ status: 'COMMITTED' });
    const view = await resolveAs(key);
    expect(view.policyDocument).toEqual(document);
    expect(view.contentHash).toEqual(factRefOf(committed as CommittedCommandResult).contentHash);
    expect(view.policySchemaRefs).toEqual([profileReference(CAPTURE_PROFILE)]);
    expect(registry.validateOperationResult(RESOLVE_POLICY_COMMAND, '1.0', view)).toMatchObject({
      valid: true,
    });
  });

  it('maps unavailable storage to DEPENDENCY_UNAVAILABLE instead of an empty policy', async () => {
    const unreachable = new URL(databaseUrl ?? '');
    unreachable.port = '1';
    const brokenPool = new pg.Pool({
      connectionString: unreachable.toString(),
      connectionTimeoutMillis: 500,
      max: 1,
    });
    const brokenDb = createIdentityPolicyDatabase(brokenPool);
    const key = scopedKey(POLICY_ONE, V1, {
      enterpriseId: ENTERPRISE_A,
      projectId: PROJECT_A1,
    });
    try {
      await expect(
        resolvePolicy(
          { db: brokenDb, repo, crypto, context: fixtureContext },
          {
            policyRef: key,
            asOf: new Date(),
          },
        ),
      ).rejects.toMatchObject({ code: DEPENDENCY_UNAVAILABLE });
      const payload = recordPayload({ key, effectiveFrom: EARLIER.toISOString() });
      await expect(
        recordPolicyVersion(
          { db: brokenDb, repo, crypto, context: fixtureContext },
          recordInput(payload, {
            policyVersionFactId: 'cacacaca-caca-7aca-8aca-cacacacaca1d',
            idempotencyKey: 'wi186:dependency:1',
          }),
        ),
      ).rejects.toMatchObject({ code: DEPENDENCY_UNAVAILABLE });
    } finally {
      await brokenPool.end();
    }
  });
});
