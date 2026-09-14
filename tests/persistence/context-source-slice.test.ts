// IM-06 (#188): real PostgreSQL acceptance for ContextSourceSlice capture,
// capture Policy resolution binding, authorized reads, replay, RLS,
// immutability and fail-closed dependency handling.
//
// The positive path builds its Project/PROJECT_START sources through the
// owning EnterpriseProject handlers and its Policy version facts through the
// owning IdentityPolicy `identity.record_policy_version@1.0` entry, then
// resolves them through `identity.resolve_policy@1.0` — the same call the
// production resolution Port adapter makes. No authorization, existence or
// resolution path under test is stubbed and no Policy body is invented outside
// the published snapshot; only the trust boundary above them (the
// composition-layer Decision pinning and the trusted clock) is supplied by the
// test.

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  AUTHORIZATION_DECISION_INVALID,
  CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
  CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
  createEnterpriseProjectDatabase,
  DEPENDENCY_UNAVAILABLE,
  handleCaptureContextSourceSlice,
  handleCreateEnterprise,
  handleCreateProject,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseQmsCreateRevision,
  handleGetContextSourceSlice,
  handleGetProjectContextSource,
  handleProposeEnterpriseFact,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PROJECT_CAPTURE_POLICY_NOT_USABLE,
  PROJECT_CAPTURE_POLICY_UNSUPPORTED,
  PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
  PROJECT_CAPTURE_VALIDITY_INVALID,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
  type CapturePolicyResolution,
  type CapturePolicyResolutionPort,
  type CommandEnvelope,
  type CommandResult,
  type ContextSourceSliceHandlerDeps,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  DEPENDENCY_UNAVAILABLE as IDENTITY_DEPENDENCY_UNAVAILABLE,
  digestCanonicalPayload as digestIdentityPayload,
  grantCapability,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  recordPolicyVersion,
  resolvePolicy,
  SnapshotBoundaryError,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import {
  ContractRegistry,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
  type EnterpriseProject,
} from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi188_probe';
const PROBE_PASSWORD = 'im06-wi188-probe';

const SERVICE_PRINCIPAL = 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e101';
const SERVICE_ACTOR = 'e2e2e2e2-e2e2-72e2-82e2-e2e2e2e2e201';
const SERVICE_ACTOR_PROJECT = 'e2e2e2e2-e2e2-72e2-82e2-e2e2e2e2e202';
// The owning Project/PROJECT_START fixture is Human-operated (QMS activation
// and Project creation are Human-only); the capture/read entries under test
// run as the authorized ContextBuilder Service instead.
const SEED_PRINCIPAL = 'e9e9e9e9-e9e9-79e9-89e9-e9e9e9e9e901';
const SEED_ACTOR = 'e9e9e9e9-e9e9-79e9-89e9-e9e9e9e9e902';
const SEED_DECISION = 'e8e8e8e8-e8e8-78e8-88e8-e8e8e8e8e801';
const DECISION_HASH = Buffer.alloc(32, 0x62);
const CORRELATION = 'e7e7e7e7-e7e7-77e7-87e7-e7e7e7e7e701';
const AUTH_HASH = Buffer.alloc(32, 0x61);
const AUTH_CONTEXT_ID = 'e7e7e7e7-e7e7-77e7-87e7-e7e7e7e7e702';

const CAPTURE_CAPABILITY = 'project.context_source.capture';
const RECORD_CAPABILITY = 'identity.policy.record_version';
const RESOLVE_CAPABILITY = 'identity.policy.resolve_version';

const POLICY_OBJECT_MAIN = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e301';
const POLICY_OBJECT_TTL = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e302';
const POLICY_OBJECT_REVOKED = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e303';
const POLICY_OBJECT_FUTURE = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e304';
const POLICY_OBJECT_BUILDER_PROFILE = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e305';
const POLICY_OBJECT_CLOSED_FIELDS = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e306';
const POLICY_OBJECT_UNKNOWN_KEY = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e3ff';
const POLICY_VERSION_MAIN = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e401';
const POLICY_VERSION_TTL = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e402';
const POLICY_VERSION_REVOKED_FIRST = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e403';
const POLICY_VERSION_REVOKED_SUCCESSOR = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e404';
const POLICY_VERSION_FUTURE = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e405';
const POLICY_VERSION_BUILDER_PROFILE = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e406';
const POLICY_VERSION_CLOSED_FIELDS = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e407';
const POLICY_VERSION_UNKNOWN = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e4ff';
const POLICY_SNAPSHOT_ID = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e501';
const POLICY_SNAPSHOT_SET_VERSION = 'wi188-grant-policy-set';
const GRANT_CAPTURE_ENTERPRISE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e601';
const GRANT_CAPTURE_PROJECT = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e604';
const GRANT_RECORD_ENTERPRISE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e602';
const GRANT_RESOLVE_ENTERPRISE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e603';

const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';
const BUILDER_PROFILE = 'execution.context_builder.policy@1.0';
const PAST = new Date('2026-01-01T00:00:00.000Z');
const SOURCE_PURPOSE = 'context.snapshot.read';
const FORM_PURPOSE = 'record.form.read';
const DENIED_PURPOSE = 'document.write';
const SLICE_KINDS = ['PROJECT', 'ENTERPRISE_PROFILE', 'QMS_CONFIGURATION', 'PRODUCT_SCOPE'];

interface PinnedDecision {
  readonly id: string;
  readonly hash: Buffer;
  readonly expiresAt: Date;
}

interface SliceFixture {
  readonly enterpriseId: string;
  readonly projectId: string;
}

function profileReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

function scopedPolicyKey(objectId: string, versionId: string, enterpriseId: string) {
  return {
    kind: 'VERSIONED',
    objectType: 'zhiju.identity.policy',
    objectId,
    versionId,
    scope: { enterpriseId },
  } as unknown as Common.VersionedRef;
}

function objectRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  enterpriseId: string,
  projectId?: string,
) {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  } as Common.ObjectRef & { objectType: TObjectType };
}

function versionedRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  versionId: string,
  enterpriseId: string,
) {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId },
  } as Common.VersionedRef & { objectType: TObjectType };
}

function snapshotRef<TObjectType extends string>(
  objectType: TObjectType,
  snapshotId: string,
  digest: string,
  enterpriseId: string,
) {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  } as Common.SnapshotRef & { objectType: TObjectType };
}

/** Identity-only comparison: the Slice publishes canonical object spellings. */
function withoutObjectTypes<T>(value: T): T {
  const parsed: unknown = JSON.parse(
    JSON.stringify(value, (key: string, entry: unknown) =>
      key === 'objectType' ? undefined : entry,
    ),
  );
  return parsed as T;
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x6c)).update(input, 'utf8').digest(),
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

describe.skipIf(!gateEnabled)('ContextSourceSlice capture and read (real PostgreSQL)', () => {
  const crypto = testCrypto();
  const registry = new ContractRegistry();
  let admin: pg.Client;
  let epPool: pg.Pool;
  let ipPool: pg.Pool;
  let db: Kysely<EnterpriseProjectDb>;
  let identityDb: Kysely<IdentityPolicyDb>;
  let identityRepo: IdentityPolicyRepository;
  let identityActorRef: Common.SnapshotRef;
  let identityProjectActorRef: Common.SnapshotRef;
  let fixture: SliceFixture;
  let grantPolicyHash: Buffer;
  const decisions = new Map<string, PinnedDecision>();

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
      `GRANT platform_context_establisher, enterprise_project_app, identity_policy_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    const probeUrl = url.toString();
    epPool = new pg.Pool({ connectionString: probeUrl, max: 4 });
    ipPool = new pg.Pool({ connectionString: probeUrl, max: 4 });
    db = createEnterpriseProjectDatabase(epPool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    fixture = await seedEnterpriseProject();
    await registerIdentityFacts();
  });

  afterAll(async () => {
    await epPool.end();
    await ipPool.end();
    await admin.end();
  });

  // ---------------------------------------------------------------------
  // Trusted boundaries supplied by the composition layer
  // ---------------------------------------------------------------------

  function serviceContext(
    allowedProjectIds: readonly string[],
    decision: PinnedDecision,
    overrides: Partial<EnterpriseProjectTransactionContext> = {},
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: SERVICE_PRINCIPAL,
      principalKind: 'SERVICE',
      actorSnapshotId: SERVICE_ACTOR,
      authorizationDecisionId: decision.id,
      authorizationDecisionHash: decision.hash,
      authorizationDecisionExpiresAt: decision.expiresAt,
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
      authorizationPurposes: ['project.context_source.capture', 'project.context_source.read'],
      ...overrides,
    };
  }

  function seedContext(
    enterpriseId: string,
    allowedProjectIds: readonly string[],
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: SEED_PRINCIPAL,
      principalKind: 'HUMAN',
      actorSnapshotId: SEED_ACTOR,
      authorizationDecisionId: SEED_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
    };
  }

  async function captureDecision(
    purpose: string,
    ttlSeconds: number,
    projectId: string,
  ): Promise<PinnedDecision> {
    const cacheKey = `${purpose}:${ttlSeconds}:${projectId}`;
    const cached = decisions.get(cacheKey);
    if (cached !== undefined) return cached;
    const decision = await authorizeCommand(identityDeps(identityContext([projectId])), {
      actorSnapshotRef: identityProjectActorRef,
      intent: {
        commandType: 'project.capture_context_source_slice',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId,
        purpose,
        requestedCapability: CAPTURE_CAPABILITY,
        commandPayloadHash: digestIdentityPayload({ projectRef: projectId }).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: policySnapshotReference(grantPolicyHash, 'f'.repeat(64)),
      ttlSeconds,
    });
    expect(decision.outcome).toBe('ALLOW');
    const pinned: PinnedDecision = {
      id: decision.authorizationDecisionRef.objectId,
      hash: Buffer.from(decision.authorizationDecisionRef.contentHash.digest, 'hex'),
      expiresAt: new Date(decision.expiresAt),
    };
    decisions.set(cacheKey, pinned);
    return pinned;
  }

  // ---------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------

  function commandEnvelope<TPayload>(
    context: EnterpriseProjectTransactionContext,
    commandType: string,
    idempotencyKey: string,
    payload: TPayload,
    overrides: Partial<CommandEnvelope> = {},
  ): CommandEnvelope & { payload: TPayload } {
    return {
      commandId: newUuidV7(),
      commandType,
      commandVersion: '1.0',
      idempotencyScope: CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
      enterpriseId: context.enterpriseId,
      targetType: 'ContextSourceSlice',
      targetId: newUuidV7(),
      correlationId: context.correlationId,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
      ...overrides,
      payload,
    };
  }

  function committedPayload(result: CommandResult): CanonicalJsonObject {
    if (result.status !== 'COMMITTED') {
      throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
    }
    return result.resultPayload;
  }

  function sliceRefOf(result: CommandResult): Common.ContentAddressedRef {
    const payload = result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    if (payload === null) throw new Error('expected a stored result payload');
    return payload.sourceSliceRef as unknown as Common.ContentAddressedRef;
  }

  async function seedEnterpriseProject(): Promise<SliceFixture> {
    const enterpriseId = newUuidV7();
    const context = seedContext(enterpriseId, []);
    const enterprise = await handleCreateEnterprise(db, context, {
      ...commandEnvelope(context, 'project.create_enterprise', 'wi188-enterprise', {
        displayCode: 'WI188',
        displayName: 'WI-188 slice fixture',
        initialStatus: 'ACTIVE' as const,
      }),
      enterpriseId,
      targetType: 'Enterprise',
      targetId: enterpriseId,
    });
    expect(enterprise.status).toBe('COMMITTED');

    const product = committedPayload(
      await handleEnterpriseProductCreate(
        db,
        context,
        commandEnvelope(context, 'enterprise_product.create', 'wi188-product', {
          enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI188-PRODUCT',
          initialVersion: {
            productType: 'manufactured.widget',
            displayName: 'WI188 Widget',
            intendedUse: 'ContextSourceSlice fixture',
            productScope: { family: 'widget', markets: ['CN'] },
            sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
          },
        }),
      ),
    ) as {
      productRef: { objectId: string };
      productVersionRef: { versionId: string };
    };
    const productScope = committedPayload(
      await handleEnterpriseProductCreateScopeSnapshot(
        db,
        context,
        commandEnvelope(context, 'enterprise_product.create_scope_snapshot', 'wi188-scope', {
          productRef: { objectType: 'Product' as const, objectId: product.productRef.objectId },
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          purpose: 'WI188 product scope fixture',
        }),
      ),
    ) as { productScopeSnapshotRef: { objectId: string }; payloadHash: string };

    const qms = committedPayload(
      await handleEnterpriseQmsCreateRevision(
        db,
        context,
        commandEnvelope(context, 'enterprise_qms.create_revision', 'wi188-qms', {
          qmsConfigurationRef: objectRef('QMSConfiguration', newUuidV7(), enterpriseId),
          applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
          managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
          professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
          sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
        }),
      ),
    ) as { qmsConfigurationRevisionRef: { objectId: string; versionId: string } };
    await handleEnterpriseQmsActivateRevision(
      db,
      context,
      commandEnvelope(
        context,
        'enterprise_qms.activate_revision',
        'wi188-qms-activate',
        {
          qmsConfigurationRef: objectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: versionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          activationMode: 'ACTIVATE' as const,
          expectedAggregateVersion: '1',
          humanDecisionRef: objectRef('BusinessDecision', newUuidV7(), enterpriseId),
        },
        { expectedAggregateVersion: '1' },
      ),
    );

    const profile = committedPayload(
      await handleEnterpriseProfileCreateSnapshot(
        db,
        context,
        commandEnvelope(context, 'enterprise_profile.create_snapshot', 'wi188-profile', {
          enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
          enterpriseFactVersionRefs: [],
          productVersionRefs: [
            {
              objectType: 'ProductVersion',
              objectId: product.productRef.objectId,
              versionId: product.productVersionRef.versionId,
            },
          ],
          qmsConfigurationRef: objectRef(
            'QMSConfiguration',
            qms.qmsConfigurationRevisionRef.objectId,
            enterpriseId,
          ),
          qmsConfigurationRevisionRef: versionedRef(
            'QMSConfigurationRevision',
            qms.qmsConfigurationRevisionRef.objectId,
            qms.qmsConfigurationRevisionRef.versionId,
            enterpriseId,
          ),
          purpose: 'WI188 profile fixture',
        }),
      ),
    ) as { enterpriseProfileSnapshotRef: { objectId: string }; payloadHash: string };

    const project = committedPayload(
      await handleCreateProject(
        db,
        context,
        commandEnvelope(context, 'project.create_project', 'wi188-project', {
          enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
          displayCode: 'WI188-PROJECT',
          title: 'WI188 project',
          objective: 'ContextSourceSlice persistence acceptance fixture',
          startSnapshot: {
            enterpriseProfileSnapshotRef: snapshotRef(
              'EnterpriseProfileSnapshot',
              profile.enterpriseProfileSnapshotRef.objectId,
              profile.payloadHash,
              enterpriseId,
            ),
            qmsConfigurationRef: versionedRef(
              'QMSConfiguration',
              qms.qmsConfigurationRevisionRef.objectId,
              qms.qmsConfigurationRevisionRef.versionId,
              enterpriseId,
            ),
            productScopeSnapshotRef: snapshotRef(
              'ProductScopeSnapshot',
              productScope.productScopeSnapshotRef.objectId,
              productScope.payloadHash,
              enterpriseId,
            ),
          },
          memberPolicyRef: versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
        }),
      ),
    ) as { projectRef: { objectId: string } };
    return { enterpriseId, projectId: project.projectRef.objectId };
  }

  function identityContext(
    allowedProjectIds: readonly string[] = [],
    overrides: Partial<IdentityTransactionContext> = {},
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: SERVICE_PRINCIPAL,
      actorSnapshotId: SERVICE_ACTOR,
      authorizationDecisionId: SEED_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
      ...overrides,
    };
  }

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return { db: identityDb, repo: identityRepo, crypto, context };
  }

  function policySnapshotReference(snapshotHash: Buffer, digest: string): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: POLICY_SNAPSHOT_ID,
      snapshotId: POLICY_SNAPSHOT_ID,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: snapshotHash.length === 0 ? digest : snapshotHash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
  }

  /**
   * Registers one Policy version fact through the owning
   * `identity.record_policy_version@1.0` entry with its own Decision: the
   * capture side never writes IdentityPolicy tables directly.
   */
  async function registerPolicyVersionAs(input: {
    key: Common.VersionedRef;
    factId: string;
    idempotencyKey: string;
    effectiveFrom: Date;
    policySchemaRefs?: readonly Common.TypedReference[];
    policyDocument?: CanonicalJsonObject;
    supersedesRef?: Common.VersionedRef;
  }): Promise<void> {
    const scopeValue = input.key.scope as unknown as CanonicalJsonObject;
    const payload: CanonicalJsonObject = {
      policyRef: input.key as unknown as CanonicalJsonObject,
      policySetVersion: 'wi188-set-1',
      policySchemaRefs: (input.policySchemaRefs ?? [
        profileReference(CAPTURE_PROFILE),
      ]) as unknown as CanonicalJsonObject,
      policyDocument: input.policyDocument ?? {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SOURCE_PURPOSE, FORM_PURPOSE],
      },
      effectiveFrom: input.effectiveFrom.toISOString(),
      ...(input.supersedesRef === undefined
        ? {}
        : { supersedesRef: input.supersedesRef as unknown as CanonicalJsonObject }),
    };
    const decision = await authorizeCommand(identityDeps(identityContext()), {
      actorSnapshotRef: identityActorRef,
      intent: {
        commandType: 'identity.record_policy_version',
        commandVersion: '1.0',
        scopeKind: 'ENTERPRISE',
        enterpriseId: fixture.enterpriseId,
        purpose: 'identity.policy.record_policy_version',
        requestedCapability: RECORD_CAPABILITY,
        commandPayloadHash: digestIdentityPayload(payload).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: policySnapshotReference(grantPolicyHash, 'f'.repeat(64)),
      ttlSeconds: 1800,
    });
    expect(decision.outcome).toBe('ALLOW');
    const result = await recordPolicyVersion(
      identityDeps(
        identityContext([], {
          authorizationDecisionId: decision.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            decision.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(decision.expiresAt),
        }),
      ),
      {
        envelope: {
          commandId: newUuidV7(),
          commandType: 'identity.record_policy_version',
          commandVersion: '1.0',
          scopeRef: scopeValue,
          targetRef: {
            kind: 'OBJECT',
            objectType: 'zhiju.identity.policy_version',
            objectId: input.factId,
            scope: scopeValue,
          },
          actor: {
            kind: 'OBJECT',
            objectType: 'zhiju.identity.principal',
            objectId: SERVICE_PRINCIPAL,
            scope: scopeValue,
          },
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: decision.authorizationDecisionRef.objectId,
            scope: scopeValue,
            contentHash: decision.authorizationDecisionRef
              .contentHash as unknown as CanonicalJsonObject,
          },
          idempotencyKey: input.idempotencyKey,
          correlationId: CORRELATION,
          requestedAt: new Date().toISOString(),
          payload,
          integrity: {
            canonicalizationVersion: '1',
            payloadHash: {
              algorithm: 'SHA-256',
              digest: digestIdentityPayload(payload).hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
        },
      },
    );
    expect(result).toMatchObject({ status: 'COMMITTED' });
  }

  async function registerIdentityFacts(): Promise<void> {
    await withIdentityTransaction(identityDb, identityContext(), (trx) =>
      identityRepo.insertPrincipal(trx, {
        id: SERVICE_PRINCIPAL,
        principalKind: 'SERVICE',
        displayName: 'WI188 context builder service fixture',
        createdByPrincipalId: SERVICE_PRINCIPAL,
        createdByActorSnapshotId: SERVICE_ACTOR,
      }),
    );
    const platformPolicy = await recordPolicySnapshot(identityDeps(identityContext()), {
      policySnapshotId: POLICY_SNAPSHOT_ID,
      policySetVersion: POLICY_SNAPSHOT_SET_VERSION,
      policySchemaRefs: ['identity.PolicySnapshot@1.0'],
      effectiveFrom: PAST,
      policyDocument: { rules: ['wi188-grant-policy'], version: 1 },
      idempotencyKey: 'wi188:policy-snapshot',
    });
    expect(platformPolicy).toMatchObject({ status: 'COMMITTED' });
    grantPolicyHash = await readGrantPolicyHash();
    expect(grantPolicyHash).toHaveLength(32);
    for (const grant of [
      { id: GRANT_CAPTURE_ENTERPRISE, capabilityCode: CAPTURE_CAPABILITY, projectId: undefined },
      {
        id: GRANT_CAPTURE_PROJECT,
        capabilityCode: CAPTURE_CAPABILITY,
        projectId: fixture.projectId,
      },
      { id: GRANT_RECORD_ENTERPRISE, capabilityCode: RECORD_CAPABILITY, projectId: undefined },
      { id: GRANT_RESOLVE_ENTERPRISE, capabilityCode: RESOLVE_CAPABILITY, projectId: undefined },
    ]) {
      const result = await grantCapability(
        identityDeps(identityContext(grant.projectId === undefined ? [] : [grant.projectId])),
        {
          grantId: grant.id,
          principalId: SERVICE_PRINCIPAL,
          capabilityCode: grant.capabilityCode,
          scope: {
            scopeKind:
              grant.projectId === undefined ? ('ENTERPRISE' as const) : ('PROJECT' as const),
            enterpriseId: fixture.enterpriseId,
            ...(grant.projectId === undefined ? {} : { projectId: grant.projectId }),
          },
          resourceSelectors: [],
          actions: [grant.capabilityCode],
          validFrom: PAST,
          grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
          grantPolicySnapshotHash: grantPolicyHash,
          justification: 'wi188 fixture',
          idempotencyKey: `wi188:grant:${grant.id}`,
        },
      );
      expect(result).toMatchObject({ status: 'COMMITTED' });
    }
    identityActorRef = await createActorSnapshot(identityDeps(identityContext()), {
      actorSnapshotId: SERVICE_ACTOR,
      principalId: SERVICE_PRINCIPAL,
      declaredPrincipalKind: 'SERVICE',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'ENTERPRISE',
      enterpriseId: fixture.enterpriseId,
    });
    identityProjectActorRef = await createActorSnapshot(
      identityDeps(identityContext([fixture.projectId])),
      {
        actorSnapshotId: SERVICE_ACTOR_PROJECT,
        principalId: SERVICE_PRINCIPAL,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      },
    );

    await registerPolicyVersionAs({
      key: scopedPolicyKey(POLICY_OBJECT_MAIN, POLICY_VERSION_MAIN, fixture.enterpriseId),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-main',
      effectiveFrom: PAST,
    });
    await registerPolicyVersionAs({
      key: scopedPolicyKey(POLICY_OBJECT_TTL, POLICY_VERSION_TTL, fixture.enterpriseId),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-ttl',
      effectiveFrom: PAST,
      policyDocument: {
        maxSliceValiditySeconds: 120,
        allowedPurposeCodes: [SOURCE_PURPOSE],
      },
    });
    await registerPolicyVersionAs({
      key: scopedPolicyKey(
        POLICY_OBJECT_REVOKED,
        POLICY_VERSION_REVOKED_FIRST,
        fixture.enterpriseId,
      ),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-revoked',
      effectiveFrom: PAST,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SOURCE_PURPOSE],
      },
    });
    await registerPolicyVersionAs({
      key: scopedPolicyKey(POLICY_OBJECT_FUTURE, POLICY_VERSION_FUTURE, fixture.enterpriseId),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-future',
      effectiveFrom: new Date(Date.now() + 15 * 60 * 1000),
    });
    await registerPolicyVersionAs({
      key: scopedPolicyKey(
        POLICY_OBJECT_BUILDER_PROFILE,
        POLICY_VERSION_BUILDER_PROFILE,
        fixture.enterpriseId,
      ),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-builder-profile',
      effectiveFrom: PAST,
      policySchemaRefs: [profileReference(BUILDER_PROFILE)],
    });
    await registerPolicyVersionAs({
      key: scopedPolicyKey(
        POLICY_OBJECT_CLOSED_FIELDS,
        POLICY_VERSION_CLOSED_FIELDS,
        fixture.enterpriseId,
      ),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-closed-fields',
      effectiveFrom: PAST,
      policyDocument: { maxSliceValiditySeconds: 3600 },
    });
  }

  async function readGrantPolicyHash(): Promise<Buffer> {
    const snapshot = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
      [POLICY_SNAPSHOT_ID],
    );
    return snapshot.rows[0]?.payload_hash ?? Buffer.alloc(0);
  }

  // ---------------------------------------------------------------------
  // Production resolution Port adapter
  // ---------------------------------------------------------------------

  /**
   * One IdentityPolicy `identity.resolve_policy@1.0` call per request with its
   * own `identity.policy.resolve_policy` Decision. Authorization failures and
   * the authoritative "no committed version for this key/Scope" answer both
   * resolve to `UNRESOLVED`; only a dependency failure maps to `UNAVAILABLE`.
   */
  const policyResolutionPort: CapturePolicyResolutionPort = {
    async resolveCapturePolicy(request): Promise<CapturePolicyResolution> {
      const scope = request.policyRef.scope;
      const cacheKey = `resolve:${request.policyRef.objectId}:${request.policyRef.versionId}`;
      let decision = decisions.get(cacheKey);
      if (decision === undefined) {
        const payload: CanonicalJsonObject = {
          policyRef: request.policyRef as unknown as CanonicalJsonObject,
        };
        const authorized = await authorizeCommand(identityDeps(identityContext()), {
          actorSnapshotRef: identityActorRef,
          intent: {
            commandType: 'identity.resolve_policy',
            commandVersion: '1.0',
            scopeKind: 'ENTERPRISE',
            enterpriseId: fixture.enterpriseId,
            purpose: 'identity.policy.resolve_policy',
            requestedCapability: RESOLVE_CAPABILITY,
            commandPayloadHash: digestIdentityPayload(payload).hash,
            requestedAt: new Date(),
            highRiskAction: false,
          },
          authenticationContextHash: AUTH_HASH,
          policySnapshotRef: policySnapshotReference(grantPolicyHash, 'f'.repeat(64)),
          ttlSeconds: 1800,
        });
        expect(authorized.outcome).toBe('ALLOW');
        decision = {
          id: authorized.authorizationDecisionRef.objectId,
          hash: Buffer.from(authorized.authorizationDecisionRef.contentHash.digest, 'hex'),
          expiresAt: new Date(authorized.expiresAt),
        };
        decisions.set(cacheKey, decision);
      }
      const scopeValue = scope as unknown as CanonicalJsonObject;
      const envelope: CanonicalJsonObject = {
        queryId: newUuidV7(),
        queryType: 'identity.resolve_policy',
        queryVersion: '1.0',
        scopeRef: scopeValue,
        requester: {
          kind: 'OBJECT',
          objectType: 'zhiju.identity.principal',
          objectId: SERVICE_PRINCIPAL,
          scope: scopeValue,
        },
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: AUTH_CONTEXT_ID,
          scope: scopeValue,
          contentHash: {
            algorithm: 'SHA-256',
            digest: AUTH_HASH.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        authorizationDecisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'identity.authorization_decision',
          objectId: decision.id,
          scope: scopeValue,
          contentHash: {
            algorithm: 'SHA-256',
            digest: decision.hash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        consistencyRequirement: 'AUTHORITATIVE',
        correlationId: CORRELATION,
        requestedAt: request.asOf.toISOString(),
        payload: { policyRef: request.policyRef as unknown as CanonicalJsonObject },
      };
      const contract = registry.validateOperation('identity.resolve_policy', '1.0', envelope);
      expect(contract.valid).toBe(true);
      try {
        const view = await resolvePolicy(
          identityDeps(
            identityContext(scope.projectId === undefined ? [] : [scope.projectId], {
              authorizationDecisionId: decision.id,
              authorizationDecisionHash: decision.hash,
              authorizationDecisionExpiresAt: decision.expiresAt,
            }),
          ),
          { envelope, asOf: request.asOf },
        );
        return { kind: 'RESOLVED', observation: view };
      } catch (error) {
        if (error instanceof SnapshotBoundaryError) {
          return error.code === IDENTITY_DEPENDENCY_UNAVAILABLE
            ? { kind: 'UNAVAILABLE' }
            : { kind: 'UNRESOLVED' };
        }
        throw error;
      }
    },
  };

  function handlerDeps(now?: () => Date): ContextSourceSliceHandlerDeps {
    return { policyResolution: policyResolutionPort, ...(now === undefined ? {} : { now }) };
  }

  // ---------------------------------------------------------------------
  // Capture / read drivers
  // ---------------------------------------------------------------------

  function capturePayload(input: {
    purpose: string;
    capturePolicyRef: Common.VersionedRef;
    requestedKinds?: readonly string[];
    audience?: Common.PrincipalRef;
  }): EnterpriseProject.ProjectCaptureContextSourceSlicePayload {
    return {
      projectRef: objectRef(
        'zhiju.project.project',
        fixture.projectId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
      purpose: input.purpose,
      audience: input.audience ?? { principalKind: 'SERVICE', principalId: SERVICE_PRINCIPAL },
      requestedKinds: [...(input.requestedKinds ?? SLICE_KINDS)],
      capturePolicyRef: input.capturePolicyRef,
    } as unknown as EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
  }

  async function capture(input: {
    idempotencyKey: string;
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    decision?: PinnedDecision;
    overrides?: Partial<EnterpriseProjectTransactionContext>;
    now?: () => Date;
  }): Promise<CommandResult> {
    const decision =
      input.decision ??
      (await captureDecision('project.context_source.capture', 900, fixture.projectId));
    const context = serviceContext([fixture.projectId], decision, input.overrides ?? {});
    return handleCaptureContextSourceSlice(
      db,
      context,
      commandEnvelope(context, 'project.capture_context_source_slice', input.idempotencyKey, {
        ...input.payload,
      }),
      handlerDeps(input.now),
    );
  }

  async function read(
    ref: Common.ContentAddressedRef,
    overrides: Partial<EnterpriseProjectTransactionContext> = {},
    now?: () => Date,
  ): Promise<EnterpriseProject.ProjectGetContextSourceSliceResult> {
    const decision = await captureDecision('project.context_source.read', 900, fixture.projectId);
    const context = serviceContext([fixture.projectId], decision, overrides);
    return handleGetContextSourceSlice(
      db,
      context,
      { sourceSliceRef: ref } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
      handlerDeps(now),
    );
  }

  async function sliceRows(projectId = fixture.projectId) {
    const rows = await admin.query<{
      slice_id: string;
      purpose: string;
      captured_at: Date;
      valid_until: Date;
      policy_set_version: string;
      policy_effective_from: Date;
      policy_superseded_at: Date | null;
      slice_payload: CanonicalJsonObject;
    }>(
      `SELECT slice_id, purpose, captured_at, valid_until, policy_set_version,
              policy_effective_from, policy_superseded_at, slice_payload
         FROM enterprise_project.context_source_slice
        WHERE project_id = $1
        ORDER BY created_at, slice_id`,
      [projectId],
    );
    return rows.rows;
  }

  // ---------------------------------------------------------------------
  // EP-176-001: capture, validUntil derivation and same-transaction facts
  // ---------------------------------------------------------------------

  it('captures the owning source slice bounded by the pinned Decision and commits the Policy observation with it', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const result = await capture({
      idempotencyKey: 'wi188:capture:main',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: scopedPolicyKey(
          POLICY_OBJECT_MAIN,
          POLICY_VERSION_MAIN,
          fixture.enterpriseId,
        ),
      }),
      decision,
    });
    const ref = sliceRefOf(result);
    expect(ref).toMatchObject({
      kind: 'CONTENT_ADDRESSED',
      objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
    });
    expect(ref.contentHash.digest).toMatch(/^[0-9a-f]{64}$/u);

    const rows = await sliceRows();
    const row = rows.find((candidate) => candidate.slice_id === ref.objectId);
    expect(row).toBeDefined();
    // `validUntil = min(capturedAt + maxSliceValiditySeconds, decision.expiresAt)`:
    // the pinned Decision is the earlier bound, so the window ends at its expiry.
    const capturedAt = row?.captured_at.getTime() ?? 0;
    expect(row?.valid_until.getTime()).toBeLessThanOrEqual(decision.expiresAt.getTime());
    expect(decision.expiresAt.getTime() - (row?.valid_until.getTime() ?? 0)).toBeLessThan(2000);
    expect(row?.valid_until.getTime()).toBeLessThan(capturedAt + 900_000);
    expect(row?.purpose).toBe(SOURCE_PURPOSE);
    expect(row?.policy_set_version).toBe('wi188-set-1');
    expect(row?.policy_effective_from.getTime()).toBe(PAST.getTime());
    expect(row?.policy_superseded_at).toBeNull();

    const storedObservation = await admin.query<{
      policy_version_ref: { objectId: string; snapshotId: string; scope: Common.ScopeRef };
      policy_content_hash: Buffer;
      policy_checked_at: Date;
    }>(
      `SELECT policy_version_ref, policy_content_hash, policy_checked_at
         FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
      [ref.objectId],
    );
    const observation = storedObservation.rows[0];
    expect(observation?.policy_version_ref.objectId).toBe(
      observation?.policy_version_ref.snapshotId,
    );
    expect(observation?.policy_version_ref.scope).toEqual({ enterpriseId: fixture.enterpriseId });
    expect(observation?.policy_checked_at.getTime()).toBeLessThanOrEqual(capturedAt);
    // The stored observation binds the real committed IdentityPolicy version
    // fact and its canonical payload hash.
    const policyFact = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.policy_version WHERE policy_version_fact_id = $1`,
      [observation?.policy_version_ref.objectId],
    );
    expect(
      policyFact.rows[0]?.payload_hash.equals(observation?.policy_content_hash ?? Buffer.alloc(0)),
    ).toBe(true);

    // A new key with the same request is a second Slice identity, not a rewrite.
    const second = await capture({
      idempotencyKey: 'wi188:capture:main-second',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: scopedPolicyKey(
          POLICY_OBJECT_MAIN,
          POLICY_VERSION_MAIN,
          fixture.enterpriseId,
        ),
      }),
      decision,
    });
    expect(sliceRefOf(second).objectId).not.toBe(ref.objectId);
    expect((await sliceRows()).length).toBe(2);

    const facts = await admin.query<{ receipts: number; audits: number; edges: number }>(
      `SELECT
         (SELECT count(*)::integer FROM enterprise_project.command_receipt
           WHERE target_id = $1 AND outcome = 'COMMITTED') AS receipts,
         (SELECT count(*)::integer FROM enterprise_project.audit_record
           WHERE target_id = $1 AND outcome = 'COMMITTED') AS audits,
         (SELECT count(*)::integer FROM enterprise_project.reference_edge
           WHERE owner_object_id = $1) AS edges`,
      [ref.objectId],
    );
    expect(facts.rows[0]).toEqual({ receipts: 1, audits: 1, edges: 2 });
  });

  it('keeps the WI-11 Project scope isolation: another Project cannot read the Slice', async () => {
    const rows = await sliceRows();
    const sliceId = rows[0]?.slice_id;
    expect(sliceId).toBeDefined();
    const decision = await captureDecision('project.context_source.read', 900, fixture.projectId);
    const otherProject = newUuidV7();
    await expect(
      handleGetContextSourceSlice(
        db,
        serviceContext([otherProject], decision),
        {
          sourceSliceRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
            objectId: sliceId ?? '',
            scope: { enterpriseId: fixture.enterpriseId, projectId: otherProject },
            contentHash: {
              algorithm: 'SHA-256',
              digest: 'a'.repeat(64),
              canonicalizationVersion: '1',
            },
          },
        } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
        handlerDeps(),
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });
  });

  it('reuses the owning Source Query trimming for the captured source', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const purposes = [
      { purpose: SOURCE_PURPOSE, kinds: SLICE_KINDS },
      { purpose: FORM_PURPOSE, kinds: [...SLICE_KINDS, 'ENTERPRISE_FACTS', 'ACTIVE_BASELINES'] },
    ];
    for (const request of purposes) {
      const result = await capture({
        idempotencyKey: `wi188:capture:trim:${request.purpose}`,
        payload: capturePayload({
          purpose: request.purpose,
          capturePolicyRef: scopedPolicyKey(
            POLICY_OBJECT_MAIN,
            POLICY_VERSION_MAIN,
            fixture.enterpriseId,
          ),
          requestedKinds: request.kinds,
        }),
        decision,
      });
      if (request.purpose === FORM_PURPOSE) {
        const ref = sliceRefOf(result);
        const stored = await admin.query<{ slice_payload: EnterpriseProject.ContextSourceSlice }>(
          `SELECT slice_payload FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
          [ref.objectId],
        );
        const slice = stored.rows[0]?.slice_payload;
        expect(slice?.source.factItems).toEqual([]);
        expect(slice?.source.omissions).toEqual(
          expect.arrayContaining([{ kind: 'ENTERPRISE_FACTS', reasonCode: 'PURPOSE_FORBIDDEN' }]),
        );
      }
      const owning = await handleGetProjectContextSource(
        db,
        serviceContext([fixture.projectId], decision),
        {
          projectRef: objectRef(
            'Project',
            fixture.projectId,
            fixture.enterpriseId,
            fixture.projectId,
          ),
          purpose: request.purpose,
          audience: objectRef(
            'Principal',
            SERVICE_PRINCIPAL,
            fixture.enterpriseId,
            fixture.projectId,
          ),
          requestedKinds: [...request.kinds],
        },
      );
      const ref = sliceRefOf(result);
      const stored = await admin.query<{ slice_payload: EnterpriseProject.ContextSourceSlice }>(
        `SELECT slice_payload FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
        [ref.objectId],
      );
      const storedSource = stored.rows[0]?.slice_payload.source;
      expect(withoutObjectTypes(storedSource)).toEqual(withoutObjectTypes(owning));
      expect(storedSource?.projectRef.objectType).toBe('zhiju.project.project');
      expect(storedSource?.enterpriseProfileSnapshotRef.objectType).toBe(
        'zhiju.project.enterprise_profile',
      );
      expect(storedSource?.qmsConfigurationRef.objectType).toBe('zhiju.project.qms_configuration');
      expect(storedSource?.productScopeSnapshotRef.objectType).toBe('zhiju.project.product_scope');
      const registered = registry.validateOperationResult(
        'project.get_context_source_slice',
        '1.0',
        {
          slice: stored.rows[0]?.slice_payload,
          useStatus: 'USABLE',
          checkedAt: new Date().toISOString(),
        },
      );
      expect(registered.errors).toEqual([]);
      expect(registered.valid).toBe(true);
    }
  });

  it('derives validUntil from the Policy TTL when it is the earlier bound and reports EXPIRED afterwards', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      3600,
      fixture.projectId,
    );
    const result = await capture({
      idempotencyKey: 'wi188:capture:ttl',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: scopedPolicyKey(
          POLICY_OBJECT_TTL,
          POLICY_VERSION_TTL,
          fixture.enterpriseId,
        ),
      }),
      decision,
    });
    const ref = sliceRefOf(result);
    const rows = await sliceRows();
    const row = rows.find((candidate) => candidate.slice_id === ref.objectId);
    expect(row?.valid_until.getTime()).toBe((row?.captured_at.getTime() ?? 0) + 120_000);

    const usable = await read(ref);
    expect(usable.useStatus).toBe('USABLE');
    expect(usable.slice.sliceId).toBe(ref.objectId);
    expect(usable.slice.source.projectRef.objectId).toBe(fixture.projectId);
    expect(usable.checkedAt).toBe(new Date(usable.checkedAt).toISOString());

    const expired = await read(ref, {}, () => new Date((row?.valid_until.getTime() ?? 0) + 1000));
    expect(expired.useStatus).toBe('EXPIRED');
    expect(expired.slice).toEqual(usable.slice);
  });

  // ---------------------------------------------------------------------
  // EP-TD-001: replay, exact read and unknown references
  // ---------------------------------------------------------------------

  it('replays the original result without extending validity and rejects the same key with different input', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const first = await capture({
      idempotencyKey: 'wi188:capture:replay',
      payload,
      decision,
    });
    const before = await sliceRows();
    const replay = await capture({
      idempotencyKey: 'wi188:capture:replay',
      payload,
      decision,
    });
    expect(replay.status).toBe('DUPLICATE');
    expect(sliceRefOf(replay)).toEqual(sliceRefOf(first));
    expect(await sliceRows()).toEqual(before);

    await expect(
      capture({
        idempotencyKey: 'wi188:capture:replay',
        payload: capturePayload({
          purpose: FORM_PURPOSE,
          capturePolicyRef: scopedPolicyKey(
            POLICY_OBJECT_MAIN,
            POLICY_VERSION_MAIN,
            fixture.enterpriseId,
          ),
        }),
        decision,
      }),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
    expect(await sliceRows()).toEqual(before);
  });

  it('refuses unknown, mis-hashed and out-of-scope Slice references', async () => {
    const rows = await sliceRows();
    const known = rows[0];
    expect(known).toBeDefined();
    const stored = await admin.query<{ slice_payload_hash: Buffer }>(
      `SELECT slice_payload_hash FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
      [known?.slice_id],
    );
    const digest = stored.rows[0]?.slice_payload_hash.toString('hex') ?? '';

    await expect(
      read({
        kind: 'CONTENT_ADDRESSED',
        objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        objectId: known?.slice_id ?? '',
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: 'b'.repeat(64),
          canonicalizationVersion: '1',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });

    await expect(
      read({
        kind: 'CONTENT_ADDRESSED',
        objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        objectId: newUuidV7(),
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest,
          canonicalizationVersion: '1',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });

    await expect(
      read({
        kind: 'CONTENT_ADDRESSED',
        objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        objectId: known?.slice_id ?? '',
        scope: { enterpriseId: newUuidV7(), projectId: fixture.projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest,
          canonicalizationVersion: '1',
        },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
  });

  // ---------------------------------------------------------------------
  // EP-TD-002 / EP-176-002: authorization, Scope and Policy boundaries
  // ---------------------------------------------------------------------

  it('never authorizes a Service caller by principal kind alone', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const before = await sliceRows();
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:no-purpose',
        payload,
        decision,
        overrides: { authorizationPurposes: [] },
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:wrong-purpose',
        payload,
        decision,
        overrides: { authorizationPurposes: ['project.context_source.read'] },
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
    await expect(
      read(
        sliceRefOf(
          await capture({
            idempotencyKey: 'wi188:capture:purpose-baseline',
            payload,
            decision,
          }),
        ),
        { authorizationPurposes: ['project.context_source.capture'] },
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
    expect((await sliceRows()).length).toBe(before.length + 1);
  });

  it('refuses unresolved, unsupported, not-yet-effective and purpose-narrower capture policies', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const before = await sliceRows().then((rows) => rows.length);
    const cases: readonly {
      readonly idempotencyKey: string;
      readonly policyRef: Common.VersionedRef;
      readonly purpose?: string;
      readonly errorCode: string;
    }[] = [
      {
        idempotencyKey: 'wi188:capture:unknown-policy',
        policyRef: scopedPolicyKey(
          POLICY_OBJECT_UNKNOWN_KEY,
          POLICY_VERSION_UNKNOWN,
          fixture.enterpriseId,
        ),
        errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
      },
      {
        idempotencyKey: 'wi188:capture:builder-profile',
        policyRef: scopedPolicyKey(
          POLICY_OBJECT_BUILDER_PROFILE,
          POLICY_VERSION_BUILDER_PROFILE,
          fixture.enterpriseId,
        ),
        errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
      },
      {
        idempotencyKey: 'wi188:capture:closed-fields',
        policyRef: scopedPolicyKey(
          POLICY_OBJECT_CLOSED_FIELDS,
          POLICY_VERSION_CLOSED_FIELDS,
          fixture.enterpriseId,
        ),
        errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
      },
      {
        idempotencyKey: 'wi188:capture:future-policy',
        policyRef: scopedPolicyKey(
          POLICY_OBJECT_FUTURE,
          POLICY_VERSION_FUTURE,
          fixture.enterpriseId,
        ),
        errorCode: PROJECT_CAPTURE_POLICY_NOT_USABLE,
      },
      {
        idempotencyKey: 'wi188:capture:purpose-not-allowed',
        policyRef: scopedPolicyKey(POLICY_OBJECT_MAIN, POLICY_VERSION_MAIN, fixture.enterpriseId),
        purpose: DENIED_PURPOSE,
        errorCode: PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
      },
    ];
    for (const entry of cases) {
      const result = await capture({
        idempotencyKey: entry.idempotencyKey,
        payload: capturePayload({
          purpose: entry.purpose ?? SOURCE_PURPOSE,
          capturePolicyRef: entry.policyRef,
        }),
        decision,
      });
      expect(result).toMatchObject({ status: 'REJECTED', errorCode: entry.errorCode });
    }
    expect((await sliceRows()).length).toBe(before);
  });

  it('refuses cross-Scope Project references, foreign audiences and non-closed purposes', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const before = await sliceRows().then((rows) => rows.length);
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:foreign-audience',
        payload: capturePayload({
          purpose: SOURCE_PURPOSE,
          capturePolicyRef: policyRef,
          audience: { principalKind: 'SERVICE', principalId: newUuidV7() },
        }),
        decision,
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_AUDIENCE_INVALID });
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:not-allowed-project',
        payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
        decision,
        overrides: { allowedProjectIds: [] },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:unknown-purpose',
        payload: capturePayload({
          purpose: 'context.unknown.read',
          capturePolicyRef: policyRef,
        }),
        decision,
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_PURPOSE_FORBIDDEN });
    // The registered capture Envelope fixes the canonical Project object name:
    // a legacy/arbitrary spelling is refused instead of being rewritten.
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:legacy-project-name',
        payload: {
          ...capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
          projectRef: objectRef(
            'Project',
            fixture.projectId,
            fixture.enterpriseId,
            fixture.projectId,
          ),
        } as unknown as EnterpriseProject.ProjectCaptureContextSourceSlicePayload,
        decision,
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });
    await expect(
      capture({
        idempotencyKey: 'wi188:capture:foreign-policy-scope',
        payload: capturePayload({
          purpose: SOURCE_PURPOSE,
          capturePolicyRef: scopedPolicyKey(POLICY_OBJECT_MAIN, POLICY_VERSION_MAIN, newUuidV7()),
        }),
        decision,
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
    expect((await sliceRows()).length).toBe(before);
  });

  // ---------------------------------------------------------------------
  // EP-176-003: read-time lifecycle, audience and source immutability
  // ---------------------------------------------------------------------

  it('reports REVOKED after the capture Policy is superseded and never rewrites the old Slice', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_REVOKED,
      POLICY_VERSION_REVOKED_FIRST,
      fixture.enterpriseId,
    );
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const captured = await capture({
      idempotencyKey: 'wi188:capture:revoked',
      payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
      decision,
    });
    const ref = sliceRefOf(captured);
    const beforeRevocation = await read(ref);
    expect(beforeRevocation.useStatus).toBe('USABLE');

    await registerPolicyVersionAs({
      key: scopedPolicyKey(
        POLICY_OBJECT_REVOKED,
        POLICY_VERSION_REVOKED_SUCCESSOR,
        fixture.enterpriseId,
      ),
      factId: newUuidV7(),
      idempotencyKey: 'wi188:policy-revoked-successor',
      effectiveFrom: new Date(),
      supersedesRef: policyRef,
      policyDocument: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: [SOURCE_PURPOSE],
      },
    });

    const afterRevocation = await read(ref);
    expect(afterRevocation.useStatus).toBe('REVOKED');
    expect(afterRevocation.slice).toEqual(beforeRevocation.slice);
    expect(afterRevocation.slice.validUntil).toBe(beforeRevocation.slice.validUntil);

    // The historical Receipt replays the original result but does not restore
    // consumption eligibility.
    const replay = await capture({
      idempotencyKey: 'wi188:capture:revoked',
      payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
      decision,
    });
    expect(replay.status).toBe('DUPLICATE');
    expect(sliceRefOf(replay).objectId).toBe(ref.objectId);
    expect((await read(ref)).useStatus).toBe('REVOKED');
  });

  it('keeps a captured Slice unchanged when the Project source changes and needs a new capture for new content', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const captured = await capture({
      idempotencyKey: 'wi188:capture:source-change-before',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: policyRef,
        requestedKinds: [...SLICE_KINDS, 'ENTERPRISE_FACTS'],
      }),
      decision,
    });
    const ref = sliceRefOf(captured);
    const before = await read(ref);

    const factId = newUuidV7();
    const factContext = serviceContext([fixture.projectId], decision);
    const proposed = await handleProposeEnterpriseFact(db, factContext, {
      ...commandEnvelope(factContext, 'project.propose_enterprise_fact', 'wi188:capture:fact', {
        enterpriseRef: objectRef('Enterprise', fixture.enterpriseId, fixture.enterpriseId),
        proposal: {
          factType: 'wi188.fact',
          value: {
            presence: 'PRESENT',
            value: { key: 'wi188' },
            evidenceRefs: [],
          },
          sourceRefs: [objectRef('SourceMaterial', factId, fixture.enterpriseId)],
          riskLevel: 'LOW',
          proposalReason: {
            reasonCode: 'WI188_FIXTURE',
            summary: 'WI188 source change fixture',
            evidenceRefs: [],
          },
        },
      }),
      targetType: 'EnterpriseFact',
      targetId: factId,
    });
    expect(proposed.status).toBe('COMMITTED');

    const after = await read(ref);
    expect(after.slice).toEqual(before.slice);
    expect(after.slice.source.factItems).toEqual([]);

    const recaptured = await capture({
      idempotencyKey: 'wi188:capture:source-change-after',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: policyRef,
        requestedKinds: [...SLICE_KINDS, 'ENTERPRISE_FACTS'],
      }),
      decision,
    });
    const nextRef = sliceRefOf(recaptured);
    expect(nextRef.objectId).not.toBe(ref.objectId);
    const next = await read(nextRef);
    expect(next.slice.source.factItems).toHaveLength(1);
    expect(next.slice.source.factItems[0]).toMatchObject({
      factType: 'wi188.fact',
      value: { presence: 'REDACTED' },
    });
    expect(next.slice.source.redactions).toEqual(
      expect.arrayContaining([
        { path: '/factItems/0/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
      ]),
    );
  });

  it('refuses readers outside the Slice audience', async () => {
    const rows = await sliceRows();
    const known = rows.at(-1);
    expect(known).toBeDefined();
    const stored = await admin.query<{ slice_payload_hash: Buffer }>(
      `SELECT slice_payload_hash FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
      [known?.slice_id],
    );
    await expect(
      read(
        {
          kind: 'CONTENT_ADDRESSED',
          objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
          objectId: known?.slice_id ?? '',
          scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
          contentHash: {
            algorithm: 'SHA-256',
            digest: stored.rows[0]?.slice_payload_hash.toString('hex') ?? '',
            canonicalizationVersion: '1',
          },
        },
        { principalId: newUuidV7() },
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_AUDIENCE_INVALID });
  });

  // ---------------------------------------------------------------------
  // EP-176-004: fail closed, tampered observations and no half-products
  // ---------------------------------------------------------------------

  it('fails closed when Policy resolution is unavailable and leaves no partial Slice or Receipt', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const context = serviceContext([fixture.projectId], decision);
    const failing: ContextSourceSliceHandlerDeps = {
      policyResolution: {
        resolveCapturePolicy() {
          throw new Error('identity policy storage is unreachable');
        },
      },
    };
    await expect(
      handleCaptureContextSourceSlice(
        db,
        context,
        commandEnvelope(context, 'project.capture_context_source_slice', 'wi188:capture:down', {
          ...payload,
        }),
        failing,
      ),
    ).rejects.toMatchObject({ code: DEPENDENCY_UNAVAILABLE });

    const receipts = await admin.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM enterprise_project.command_receipt
        WHERE idempotency_key = 'wi188:capture:down'`,
    );
    expect(receipts.rows[0]?.count).toBe(0);

    // The same key can still be used once the dependency is healthy again.
    const retried = await capture({
      idempotencyKey: 'wi188:capture:down',
      payload,
      decision,
    });
    expect(retried.status).toBe('COMMITTED');
  });

  it('refuses a capture whose validity window closes before commit without writing a Slice', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const before = await sliceRows().then((rows) => rows.length);
    const base = Date.now();
    let calls = 0;
    const clock = (): Date => {
      calls += 1;
      // Resolution instant and capturedAt agree; the pre-commit re-check has
      // already crossed the 120s Policy window.
      return new Date(calls <= 2 ? base : base + 121_000);
    };
    const result = await capture({
      idempotencyKey: 'wi188:capture:clock-crossing',
      payload: capturePayload({
        purpose: SOURCE_PURPOSE,
        capturePolicyRef: scopedPolicyKey(
          POLICY_OBJECT_TTL,
          POLICY_VERSION_TTL,
          fixture.enterpriseId,
        ),
      }),
      decision,
      now: clock,
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_VALIDITY_INVALID,
    });
    expect((await sliceRows()).length).toBe(before);
  });

  it('refuses a resolution observation whose content hash or instant is not this request', async () => {
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const before = await sliceRows().then((rows) => rows.length);
    const context = serviceContext([fixture.projectId], decision);
    const tampered: ContextSourceSliceHandlerDeps = {
      policyResolution: {
        async resolveCapturePolicy(request) {
          const resolution = await policyResolutionPort.resolveCapturePolicy(request);
          if (resolution.kind !== 'RESOLVED') return resolution;
          return {
            kind: 'RESOLVED',
            observation: {
              ...resolution.observation,
              contentHash: {
                algorithm: 'SHA-256',
                digest: 'c'.repeat(64),
                canonicalizationVersion: '1',
              },
            },
          };
        },
      },
    };
    const result = await handleCaptureContextSourceSlice(
      db,
      context,
      commandEnvelope(context, 'project.capture_context_source_slice', 'wi188:capture:tampered', {
        ...payload,
      }),
      tampered,
    );
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
    });
    expect((await sliceRows()).length).toBe(before);
  });

  it('reports REVOKED when the stored Policy observation can no longer be verified', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const decision = await captureDecision(
      'project.context_source.capture',
      900,
      fixture.projectId,
    );
    const captured = await capture({
      idempotencyKey: 'wi188:capture:observation-drift',
      payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
      decision,
    });
    const ref = sliceRefOf(captured);
    const tamperedPort: CapturePolicyResolutionPort = {
      async resolveCapturePolicy(request) {
        const resolution = await policyResolutionPort.resolveCapturePolicy(request);
        if (resolution.kind !== 'RESOLVED') return resolution;
        return {
          kind: 'RESOLVED',
          observation: {
            ...resolution.observation,
            contentHash: {
              algorithm: 'SHA-256',
              digest: 'd'.repeat(64),
              canonicalizationVersion: '1',
            },
          },
        };
      },
    };
    const readDecision = await captureDecision(
      'project.context_source.read',
      900,
      fixture.projectId,
    );
    const result = await handleGetContextSourceSlice(
      db,
      serviceContext([fixture.projectId], readDecision),
      { sourceSliceRef: ref } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
      { policyResolution: tamperedPort },
    );
    expect(result.useStatus).toBe('REVOKED');
  });

  // ---------------------------------------------------------------------
  // Persistence boundary: RLS, immutability and the promoted mirror
  // ---------------------------------------------------------------------

  /**
   * One application-role statement per transaction: a failed statement aborts
   * its transaction, so each denial probe needs its own.
   */
  async function inAppRole<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await epPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE platform_context_establisher`);
      await client.query(
        `SELECT platform_security.establish_transaction_context(
           'REQUEST', $1, $2, $3, $4, $5, $6, $7::uuid[], $8, NULL)`,
        [
          SERVICE_PRINCIPAL,
          SERVICE_ACTOR,
          SEED_DECISION,
          DECISION_HASH,
          new Date(Date.now() + 60 * 60 * 1000),
          fixture.enterpriseId,
          [fixture.projectId],
          CORRELATION,
        ],
      );
      await client.query(`SET LOCAL ROLE enterprise_project_app`);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  it('keeps the Slice table INSERT-only, Project-isolated and mirror-guarded in SQL', async () => {
    const rows = await sliceRows();
    expect(rows.length).toBeGreaterThan(0);
    const counted = await inAppRole((client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM enterprise_project.context_source_slice`,
      ),
    );
    expect(counted.rows[0]?.count).toBe(String(rows.length));
    await expect(
      inAppRole((client) =>
        client.query(`UPDATE enterprise_project.context_source_slice SET purpose = 'x'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inAppRole((client) => client.query(`DELETE FROM enterprise_project.context_source_slice`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      inAppRole((client) =>
        client.query(
          `INSERT INTO enterprise_project.context_source_slice
             (slice_id, enterprise_id, project_id, purpose, audience_ref, capture_policy_ref,
              captured_at, valid_until, slice_payload, slice_payload_hash, policy_version_ref,
              policy_set_version, policy_content_hash, policy_effective_from, policy_checked_at,
              created_by_principal_id, created_by_actor_snapshot_id, authorization_decision_id,
              source_command_id)
           VALUES ($1, $2, $3, 'context.snapshot.read', '{"principalKind":"SERVICE","principalId":"${SERVICE_PRINCIPAL}"}'::jsonb,
                   '{}'::jsonb, now(), now() + interval '1 hour',
                   '{"sliceId":"${newUuidV7()}"}'::jsonb, $4, '{}'::jsonb, 'set', $5, now(), now(),
                   $6, $7, $8, $9)`,
          [
            newUuidV7(),
            fixture.enterpriseId,
            fixture.projectId,
            Buffer.alloc(32, 0x11),
            Buffer.alloc(32, 0x12),
            SERVICE_PRINCIPAL,
            SERVICE_ACTOR,
            SEED_DECISION,
            newUuidV7(),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: '22023' });
    // A Slice row can never be published under another Enterprise/Project
    // scope: the RLS policy rejects the row even though the mirror shape is
    // constructed consistently.
    const foreignEnterprise = newUuidV7();
    const foreignProject = newUuidV7();
    await expect(
      inAppRole((client) =>
        client.query(
          `INSERT INTO enterprise_project.context_source_slice
             (slice_id, enterprise_id, project_id, purpose, audience_ref, capture_policy_ref,
              captured_at, valid_until, slice_payload, slice_payload_hash, policy_version_ref,
              policy_set_version, policy_content_hash, policy_effective_from, policy_checked_at,
              created_by_principal_id, created_by_actor_snapshot_id, authorization_decision_id,
              source_command_id)
           SELECT $1, $2, $3, purpose, audience_ref, capture_policy_ref,
                  captured_at, valid_until,
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(slice_payload, '{sliceId}', to_jsonb($1::uuid)),
                      '{scopeRef}',
                      jsonb_build_object('enterpriseId', $2::uuid, 'projectId', $3::uuid)),
                    '{projectRef}',
                    jsonb_build_object(
                      'kind', 'OBJECT',
                      'objectType', 'zhiju.project.project',
                      'objectId', $3::uuid,
                      'scope', jsonb_build_object('enterpriseId', $2::uuid, 'projectId', $3::uuid))),
                  $4, policy_version_ref, policy_set_version, policy_content_hash,
                  policy_effective_from, policy_checked_at,
                  created_by_principal_id, created_by_actor_snapshot_id, authorization_decision_id,
                  $5
             FROM enterprise_project.context_source_slice WHERE slice_id = $6`,
          [
            newUuidV7(),
            foreignEnterprise,
            foreignProject,
            Buffer.alloc(32, 0x13),
            newUuidV7(),
            rows[0]?.slice_id,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const withoutContext = await epPool.connect();
    try {
      await withoutContext.query('BEGIN');
      await withoutContext.query(`SET LOCAL ROLE enterprise_project_app`);
      const invisible = await withoutContext.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM enterprise_project.context_source_slice`,
      );
      expect(invisible.rows[0]?.count).toBe('0');
      await withoutContext.query('ROLLBACK');
    } finally {
      withoutContext.release();
    }
  });
});
