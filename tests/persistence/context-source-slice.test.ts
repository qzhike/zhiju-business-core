// IM-06 (#188): real PostgreSQL acceptance for ContextSourceSlice capture,
// capture Policy resolution, authorized reads, CREATE identity, replay, RLS,
// immutability and fail-closed handling.
//
// Positive paths enter through the composition entry in `@zhiju/api/composition`
// — the same boundary a transport uses: the complete registered Envelope is
// validated against the public Contract Registry, the presented
// AuthorizationDecision is proven through the owning IdentityPolicy ports
// (operation, payload hash, actor, Scope, session, expiry and the current
// covering capability grant), and the capture Policy is resolved through
// `identity.resolve_policy@1.0` with its own Decision. The Project/START
// sources are built by the owning EnterpriseProject handlers and the Policy
// version facts by `identity.record_policy_version@1.0`; no authorization,
// existence or resolution path under test is stubbed.

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  createContextSourceSliceEntry,
  type ContextSourceSliceEntry,
  type ContextSourceSliceSession,
} from '@zhiju/api/composition';
import {
  AUTHORIZATION_DECISION_INVALID,
  CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
  CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
  createEnterpriseProjectDatabase,
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
  type CapturePolicyObservation,
  PROJECT_CAPTURE_POLICY_NOT_USABLE,
  PROJECT_CAPTURE_POLICY_UNSUPPORTED,
  PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
  PROJECT_CAPTURE_RESULT_INVALID,
  PROJECT_CAPTURE_SLICE_ALREADY_EXISTS,
  PROJECT_CAPTURE_VALIDITY_INVALID,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
  type CapturePolicyResolutionPort,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_REVOKED,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  DEPENDENCY_UNAVAILABLE,
  digestCanonicalPayload as digestIdentityPayload,
  grantCapability,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  recordPolicyVersion,
  resolvePolicy,
  revokeCapability,
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
const SERVICE_ACTOR_PROJECT_OTHER = 'e2e2e2e2-e2e2-72e2-82e2-e2e2e2e2e203';
const SEED_DECISION = 'e8e8e8e8-e8e8-78e8-88e8-e8e8e8e8e801';
const DECISION_HASH = Buffer.alloc(32, 0x62);
const CORRELATION = 'e7e7e7e7-e7e7-77e7-87e7-e7e7e7e7e701';
const AUTH_HASH = Buffer.alloc(32, 0x61);
const AUTH_CONTEXT_ID = 'e7e7e7e7-e7e7-77e7-87e7-e7e7e7e7e702';
const OTHER_SESSION_HASH = Buffer.alloc(32, 0x63);

const CAPTURE_CAPABILITY = 'project.context_source.capture';
const READ_CAPABILITY = 'project.context_source.read';
const RECORD_CAPABILITY = 'identity.policy.record_version';
const RESOLVE_CAPABILITY = 'identity.policy.resolve_version';
const REVOCABLE_CAPTURE_CAPABILITY = 'wi188.revocable.capture';
const REVOCABLE_READ_CAPABILITY = 'wi188.revocable.read';

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
const GRANT_CAPTURE_PROJECT = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e601';
const GRANT_READ_PROJECT = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e602';
const GRANT_RECORD_ENTERPRISE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e603';
const GRANT_RESOLVE_ENTERPRISE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e604';
const GRANT_REVOCABLE_CAPTURE = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e605';
const GRANT_REVOCABLE_READ = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e606';

const CAPTURE_PROFILE = 'ep.context_source_slice_capture.policy@1.0';
const BUILDER_PROFILE = 'execution.context_builder.policy@1.0';
const PAST = new Date('2026-01-01T00:00:00.000Z');
const SOURCE_PURPOSE = 'context.snapshot.read';
const FORM_PURPOSE = 'record.form.read';
const DENIED_PURPOSE = 'document.write';
// Registered canonical Source Slice kinds, as the approved capture fixture uses.
const SLICE_KINDS = ['project', 'enterprise_profile', 'qms_configuration', 'product_scope'];
// The owning assembly's own kind identifiers, for the owning-entry fixtures.
const OWNING_KINDS: Readonly<Record<string, string>> = {
  project: 'PROJECT',
  enterprise_profile: 'ENTERPRISE_PROFILE',
  qms_configuration: 'QMS_CONFIGURATION',
  product_scope: 'PRODUCT_SCOPE',
  active_baselines: 'ACTIVE_BASELINES',
  enterprise_facts: 'ENTERPRISE_FACTS',
};

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

function contentHashValue(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

/** Identity-only comparison: captured refs use canonical object spellings. */
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
  let fixture: SliceFixture;
  let grantPolicyHash: Buffer;
  let enterpriseActorRef: Common.SnapshotRef;
  let projectActorRef: Common.SnapshotRef;
  let otherProjectActorRef: Common.SnapshotRef;
  let entry: ContextSourceSliceEntry;
  let session: ContextSourceSliceSession;

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
    epPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    ipPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
    db = createEnterpriseProjectDatabase(epPool);
    identityDb = createIdentityPolicyDatabase(ipPool);
    identityRepo = new IdentityPolicyRepository(crypto);
    fixture = await seedEnterpriseProject();
    await registerIdentityFacts();
    entry = createContextSourceSliceEntry({
      enterpriseProjectDb: db,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: READ_CAPABILITY,
        resolve: RESOLVE_CAPABILITY,
      },
    });
    session = {
      authenticationContextHash: AUTH_HASH,
      policyResolutionActorSnapshotRef: enterpriseActorRef,
    };
  });

  afterAll(async () => {
    await epPool.end();
    await ipPool.end();
    await admin.end();
  });

  // ---------------------------------------------------------------------
  // Owning fixtures
  // ---------------------------------------------------------------------

  function seedContext(
    enterpriseId: string,
    allowedProjectIds: readonly string[],
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: SERVICE_PRINCIPAL,
      principalKind: 'HUMAN',
      actorSnapshotId: SERVICE_ACTOR,
      authorizationDecisionId: SEED_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId,
      allowedProjectIds,
      correlationId: CORRELATION,
    };
  }

  function seedEnvelope<TPayload>(
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
      idempotencyScope: 'enterprise_project:seed',
      idempotencyKey,
      requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
      enterpriseId: context.enterpriseId,
      targetType: 'Unknown',
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

  async function seedEnterpriseProject(): Promise<SliceFixture> {
    const enterpriseId = newUuidV7();
    const context = seedContext(enterpriseId, []);
    const enterprise = await handleCreateEnterprise(db, context, {
      ...seedEnvelope(context, 'project.create_enterprise', 'wi188-enterprise', {
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
        seedEnvelope(context, 'enterprise_product.create', 'wi188-product', {
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
        seedEnvelope(context, 'enterprise_product.create_scope_snapshot', 'wi188-scope', {
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
        seedEnvelope(context, 'enterprise_qms.create_revision', 'wi188-qms', {
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
      seedEnvelope(
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
        seedEnvelope(context, 'enterprise_profile.create_snapshot', 'wi188-profile', {
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
        seedEnvelope(context, 'project.create_project', 'wi188-project', {
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

  function grantPolicySnapshotReference(): Common.SnapshotRef {
    return {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: POLICY_SNAPSHOT_ID,
      snapshotId: POLICY_SNAPSHOT_ID,
      scope: {},
      contentHash: contentHashValue(grantPolicyHash.toString('hex')),
    };
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
      {
        id: GRANT_CAPTURE_PROJECT,
        capabilityCode: CAPTURE_CAPABILITY,
        projectId: fixture.projectId,
      },
      { id: GRANT_READ_PROJECT, capabilityCode: READ_CAPABILITY, projectId: fixture.projectId },
      {
        id: GRANT_REVOCABLE_CAPTURE,
        capabilityCode: REVOCABLE_CAPTURE_CAPABILITY,
        projectId: fixture.projectId,
      },
      {
        id: GRANT_REVOCABLE_READ,
        capabilityCode: REVOCABLE_READ_CAPABILITY,
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
    enterpriseActorRef = await createActorSnapshot(identityDeps(identityContext()), {
      actorSnapshotId: SERVICE_ACTOR,
      principalId: SERVICE_PRINCIPAL,
      declaredPrincipalKind: 'SERVICE',
      authenticationContextHash: AUTH_HASH,
      scopeKind: 'ENTERPRISE',
      enterpriseId: fixture.enterpriseId,
    });
    projectActorRef = await createActorSnapshot(
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
    otherProjectActorRef = await createActorSnapshot(
      identityDeps(identityContext([fixture.projectId])),
      {
        actorSnapshotId: SERVICE_ACTOR_PROJECT_OTHER,
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

  /**
   * Registers one Policy version fact through the owning
   * `identity.record_policy_version@1.0` entry with its own Decision: the Slice
   * boundary never writes IdentityPolicy tables directly.
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
      actorSnapshotRef: enterpriseActorRef,
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
      policySnapshotRef: grantPolicySnapshotReference(),
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

  // ---------------------------------------------------------------------
  // Composition entry drivers
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

  /** Mints the capture Decision for the actual operation, payload and actor. */
  async function captureDecision(input: {
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    actorSnapshotRef?: Common.SnapshotRef;
    commandType?: string;
    capability?: string;
    payloadHash?: Buffer;
  }): Promise<Common.ContentAddressedRef> {
    const decision = await authorizeCommand(identityDeps(identityContext([fixture.projectId])), {
      actorSnapshotRef: input.actorSnapshotRef ?? projectActorRef,
      intent: {
        commandType: input.commandType ?? 'project.capture_context_source_slice',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'project.context_source.capture',
        requestedCapability: input.capability ?? CAPTURE_CAPABILITY,
        commandPayloadHash:
          input.payloadHash ??
          digestIdentityPayload(input.payload as unknown as CanonicalJsonObject).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(decision.outcome).toBe('ALLOW');
    return decision.authorizationDecisionRef;
  }

  function captureEnvelope(input: {
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    decisionRef: Common.ContentAddressedRef;
    sliceId: string;
    idempotencyKey: string;
    actorRef?: Common.SnapshotRef;
    expectedAggregateVersion?: number;
    targetObjectType?: string;
  }): CanonicalJsonObject {
    const scope = { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId };
    return {
      commandId: newUuidV7(),
      commandType: 'project.capture_context_source_slice',
      commandVersion: '1.0',
      scopeRef: scope,
      targetRef: {
        kind: 'OBJECT',
        objectType: input.targetObjectType ?? CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
        objectId: input.sliceId,
        scope,
      },
      actor: input.actorRef ?? projectActorRef,
      authorizationDecisionRef: input.decisionRef,
      idempotencyKey: input.idempotencyKey,
      correlationId: CORRELATION,
      requestedAt: new Date().toISOString(),
      ...(input.expectedAggregateVersion === undefined
        ? {}
        : { expectedAggregateVersion: input.expectedAggregateVersion }),
      payload: input.payload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: contentHashValue(
          digestIdentityPayload(input.payload as unknown as CanonicalJsonObject).hash.toString(
            'hex',
          ),
        ) as unknown as CanonicalJsonObject,
      },
    } as unknown as CanonicalJsonObject;
  }

  /** Mints the read Decision for this exact Slice reference. */
  async function readDecisionRef(
    ref: Common.ContentAddressedRef,
  ): Promise<Common.ContentAddressedRef> {
    const payload = { sourceSliceRef: ref };
    const decision = await authorizeCommand(identityDeps(identityContext([fixture.projectId])), {
      actorSnapshotRef: projectActorRef,
      intent: {
        commandType: 'project.get_context_source_slice',
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
        purpose: 'project.context_source.read',
        requestedCapability: READ_CAPABILITY,
        commandPayloadHash: digestIdentityPayload(payload as unknown as CanonicalJsonObject).hash,
        requestedAt: new Date(),
        highRiskAction: false,
      },
      authenticationContextHash: AUTH_HASH,
      policySnapshotRef: grantPolicySnapshotReference(),
      ttlSeconds: 900,
    });
    expect(decision.outcome).toBe('ALLOW');
    return decision.authorizationDecisionRef;
  }

  function readEnvelope(input: {
    ref: Common.ContentAddressedRef;
    decisionRef: Common.ContentAddressedRef;
    actorRef?: Common.SnapshotRef;
    authenticationContextHash?: Buffer;
  }): CanonicalJsonObject {
    const scope = { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId };
    return {
      queryId: newUuidV7(),
      queryType: 'project.get_context_source_slice',
      queryVersion: '1.0',
      scopeRef: scope,
      requester: input.actorRef ?? projectActorRef,
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.authentication_context',
        objectId: AUTH_CONTEXT_ID,
        scope,
        contentHash: contentHashValue(
          (input.authenticationContextHash ?? AUTH_HASH).toString('hex'),
        ),
      },
      authorizationDecisionRef: input.decisionRef,
      consistencyRequirement: 'AUTHORITATIVE',
      correlationId: CORRELATION,
      requestedAt: new Date().toISOString(),
      payload: { sourceSliceRef: input.ref },
    } as unknown as CanonicalJsonObject;
  }

  async function captureThroughEntry(input: {
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    sliceId?: string;
    idempotencyKey: string;
    decisionRef?: Common.ContentAddressedRef;
    session?: ContextSourceSliceSession;
    expectedAggregateVersion?: number;
    targetObjectType?: string;
    entryInstance?: ReturnType<typeof createContextSourceSliceEntry>;
  }): Promise<CommandResult> {
    const decisionRef = input.decisionRef ?? (await captureDecision({ payload: input.payload }));
    const envelope = captureEnvelope({
      payload: input.payload,
      decisionRef,
      sliceId: input.sliceId ?? newUuidV7(),
      idempotencyKey: input.idempotencyKey,
      ...(input.expectedAggregateVersion === undefined
        ? {}
        : { expectedAggregateVersion: input.expectedAggregateVersion }),
      ...(input.targetObjectType === undefined ? {} : { targetObjectType: input.targetObjectType }),
    });
    return (input.entryInstance ?? entry).capture(envelope, input.session ?? session);
  }

  async function readThroughEntry(
    ref: Common.ContentAddressedRef,
    options: {
      session?: ContextSourceSliceSession;
      entryInstance?: ReturnType<typeof createContextSourceSliceEntry>;
    } = {},
  ): Promise<EnterpriseProject.ProjectGetContextSourceSliceResult> {
    const decisionRef = await readDecisionRef(ref);
    return (options.entryInstance ?? entry).read(
      readEnvelope({ ref, decisionRef }),
      options.session ?? session,
    );
  }

  function sliceRefOf(result: CommandResult): Common.ContentAddressedRef {
    const payload = result.status === 'DUPLICATE' ? result.resultPayload : committedPayload(result);
    if (payload === null) throw new Error('expected a stored result payload');
    return payload.sourceSliceRef as unknown as Common.ContentAddressedRef;
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
      slice_payload: EnterpriseProject.ContextSourceSlice;
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

  // ---------------------------------------------------------------------
  // EP-176-001: capture through the composition boundary
  // ---------------------------------------------------------------------

  it('captures through the composition entry with the pre-allocated CREATE identity', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const decisionRef = await captureDecision({ payload });
    const sliceId = newUuidV7();
    const envelope = captureEnvelope({
      payload,
      decisionRef,
      sliceId,
      idempotencyKey: 'wi188:capture:main',
    });
    const contract = registry.validateOperation(
      'project.capture_context_source_slice',
      '1.0',
      envelope,
    );
    expect(contract.errors).toEqual([]);
    expect(contract.valid).toBe(true);

    const result = await entry.capture(envelope, session);
    const ref = sliceRefOf(result);
    expect(ref).toMatchObject({
      kind: 'CONTENT_ADDRESSED',
      objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
    });
    // Request target identity = committed Slice identity = returned Ref.
    expect(ref.objectId).toBe(sliceId);
    const rows = await sliceRows();
    const row = rows.find((candidate) => candidate.slice_id === sliceId);
    expect(row).toBeDefined();
    expect(row?.slice_payload.sliceId).toBe(sliceId);
    expect(ref.contentHash.digest).toMatch(/^[0-9a-f]{64}$/u);

    const capturedAt = row?.captured_at.getTime() ?? 0;
    const decisionExpiresAt = new Date(
      (
        await admin.query<{ expires_at: Date }>(
          `SELECT expires_at FROM identity_policy.authorization_decision
            WHERE authorization_decision_id = $1`,
          [decisionRef.objectId],
        )
      ).rows[0]?.expires_at ?? new Date(0),
    );
    expect(row?.valid_until.getTime()).toBeLessThanOrEqual(decisionExpiresAt.getTime());
    expect(decisionExpiresAt.getTime() - (row?.valid_until.getTime() ?? 0)).toBeLessThan(2000);
    expect(row?.valid_until.getTime()).toBeLessThan(capturedAt + 3_600_000);

    const observation = (
      await admin.query<{
        policy_version_ref: { objectId: string; snapshotId: string; scope: Common.ScopeRef };
        policy_content_hash: Buffer;
        policy_checked_at: Date;
      }>(
        `SELECT policy_version_ref, policy_content_hash, policy_checked_at
           FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
        [sliceId],
      )
    ).rows[0];
    expect(observation?.policy_version_ref.objectId).toBe(
      observation?.policy_version_ref.snapshotId,
    );
    expect(observation?.policy_checked_at.getTime()).toBeLessThanOrEqual(capturedAt);
    const policyFact = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash FROM identity_policy.policy_version WHERE policy_version_fact_id = $1`,
      [observation?.policy_version_ref.objectId],
    );
    expect(
      policyFact.rows[0]?.payload_hash.equals(observation?.policy_content_hash ?? Buffer.alloc(0)),
    ).toBe(true);

    const facts = await admin.query<{ receipts: number; audits: number; edges: number }>(
      `SELECT
         (SELECT count(*)::integer FROM enterprise_project.command_receipt
           WHERE target_id = $1 AND outcome = 'COMMITTED') AS receipts,
         (SELECT count(*)::integer FROM enterprise_project.audit_record
           WHERE target_id = $1 AND outcome = 'COMMITTED') AS audits,
         (SELECT count(*)::integer FROM enterprise_project.reference_edge
           WHERE owner_object_id = $1) AS edges`,
      [sliceId],
    );
    expect(facts.rows[0]).toEqual({ receipts: 1, audits: 1, edges: 2 });

    const read = await readThroughEntry(ref);
    expect(read.useStatus).toBe('USABLE');
    expect(read.slice).toEqual(row?.slice_payload);
  });

  it('derives validUntil from the Policy TTL and reports EXPIRED afterwards', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_TTL,
        POLICY_VERSION_TTL,
        fixture.enterpriseId,
      ),
    });
    const result = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:ttl',
    });
    const ref = sliceRefOf(result);
    const row = (await sliceRows()).find((candidate) => candidate.slice_id === ref.objectId);
    expect(row?.valid_until.getTime()).toBe((row?.captured_at.getTime() ?? 0) + 120_000);

    const usable = await readThroughEntry(ref);
    expect(usable.useStatus).toBe('USABLE');

    // The trusted clock is injected through the same boundary the transport uses.
    const expiredEntry = createContextSourceSliceEntry({
      enterpriseProjectDb: db,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: READ_CAPABILITY,
        resolve: RESOLVE_CAPABILITY,
      },
      now: () => new Date((row?.valid_until.getTime() ?? 0) + 1000),
    });
    const expired = await readThroughEntry(ref, { entryInstance: expiredEntry });
    expect(expired.useStatus).toBe('EXPIRED');
    expect(expired.slice).toEqual(usable.slice);
  });

  // ---------------------------------------------------------------------
  // R1: authorization is proven against the real Decision and grants
  // ---------------------------------------------------------------------

  it('refuses a Decision issued for another operation, payload or actor, and another session', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const before = await sliceRows().then((rows) => rows.length);

    // Another operation, same purpose and payload.
    await expect(
      captureThroughEntry({
        payload,
        idempotencyKey: 'wi188:capture:wrong-operation',
        decisionRef: await captureDecision({ payload, commandType: 'project.create_project' }),
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // Same operation, decision bound to another payload.
    await expect(
      captureThroughEntry({
        payload,
        idempotencyKey: 'wi188:capture:wrong-payload',
        decisionRef: await captureDecision({
          payload,
          payloadHash: digestIdentityPayload({
            different: 'payload',
          }).hash,
        }),
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // Another ActorSnapshot than the Decision actor.
    const decisionRef = await captureDecision({ payload });
    await expect(
      entry.capture(
        captureEnvelope({
          payload,
          decisionRef,
          sliceId: newUuidV7(),
          idempotencyKey: 'wi188:capture:wrong-actor',
          actorRef: otherProjectActorRef,
        }),
        session,
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // Another session's authentication context.
    await expect(
      entry.capture(
        captureEnvelope({
          payload,
          decisionRef,
          sliceId: newUuidV7(),
          idempotencyKey: 'wi188:capture:wrong-session',
        }),
        { ...session, authenticationContextHash: OTHER_SESSION_HASH },
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    expect((await sliceRows()).length).toBe(before);
  });

  it('refuses the registered Envelope with a mismatched CREATE target or expected version', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const decisionRef = await captureDecision({ payload });
    await expect(
      entry.capture(
        captureEnvelope({
          payload,
          decisionRef,
          sliceId: newUuidV7(),
          idempotencyKey: 'wi188:capture:wrong-target-type',
          targetObjectType: 'zhiju.project.project',
        }),
        session,
      ),
    ).rejects.toMatchObject({ code: API_VALUE_INVALID });
    await expect(
      captureThroughEntry({
        payload,
        idempotencyKey: 'wi188:capture:expected-version',
        decisionRef: await captureDecision({ payload }),
        expectedAggregateVersion: 1,
      }),
    ).rejects.toMatchObject({ code: API_VALUE_INVALID });
  });

  it('refuses a capture and a read whose current capability grant was revoked', async () => {
    const revocableEntry = createContextSourceSliceEntry({
      enterpriseProjectDb: db,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: REVOCABLE_CAPTURE_CAPABILITY,
        read: REVOCABLE_READ_CAPABILITY,
        resolve: RESOLVE_CAPABILITY,
      },
    });
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const captureDecisionRef = await captureDecision({
      payload,
      capability: REVOCABLE_CAPTURE_CAPABILITY,
    });
    const sliceId = newUuidV7();
    const captured = await revocableEntry.capture(
      captureEnvelope({
        payload,
        decisionRef: captureDecisionRef,
        sliceId,
        idempotencyKey: 'wi188:capture:revocable',
      }),
      session,
    );
    const ref = sliceRefOf(captured);
    expect(ref.objectId).toBe(sliceId);

    // A read Decision minted while the grant is still active.
    const readPayload = { sourceSliceRef: ref };
    const readDecision = await authorizeCommand(
      identityDeps(identityContext([fixture.projectId])),
      {
        actorSnapshotRef: projectActorRef,
        intent: {
          commandType: 'project.get_context_source_slice',
          commandVersion: '1.0',
          scopeKind: 'PROJECT',
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          purpose: 'project.context_source.read',
          requestedCapability: REVOCABLE_READ_CAPABILITY,
          commandPayloadHash: digestIdentityPayload(readPayload as unknown as CanonicalJsonObject)
            .hash,
          requestedAt: new Date(),
          highRiskAction: false,
        },
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: grantPolicySnapshotReference(),
        ttlSeconds: 900,
      },
    );
    expect(readDecision.outcome).toBe('ALLOW');
    const readEnvelopeWithRevocableDecision = readEnvelope({
      ref,
      decisionRef: readDecision.authorizationDecisionRef,
    });
    expect((await revocableEntry.read(readEnvelopeWithRevocableDecision, session)).useStatus).toBe(
      'USABLE',
    );

    // Revoke the covering grants through the owning entry. The presented
    // Decisions stay ALLOW; the current-grant revalidation must refuse both
    // the new capture and the read of the already committed Slice.
    for (const grantId of [GRANT_REVOCABLE_CAPTURE, GRANT_REVOCABLE_READ]) {
      const revoked = await revokeCapability(identityDeps(identityContext([fixture.projectId])), {
        targetId: grantId,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
        },
        reasonCode: 'WI188_REVOKED',
        effectiveAt: new Date(),
        idempotencyKey: `wi188:revoke:${grantId}`,
      });
      expect(revoked).toMatchObject({ status: 'COMMITTED' });
    }

    await expect(
      revocableEntry.read(readEnvelopeWithRevocableDecision, session),
    ).rejects.toMatchObject({ code: AUTHORIZATION_REVOKED });
    await expect(
      revocableEntry.capture(
        captureEnvelope({
          payload,
          decisionRef: captureDecisionRef,
          sliceId: newUuidV7(),
          idempotencyKey: 'wi188:capture:after-revocation',
        }),
        session,
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_REVOKED });

    // The revoked read grant does not affect the main entry's own capability.
    expect((await readThroughEntry(ref)).useStatus).toBe('USABLE');
  });

  // ---------------------------------------------------------------------
  // EP-TD-001: CREATE identity, replay and exact reads
  // ---------------------------------------------------------------------

  it('replays the original result, refuses a second capture of the same identity and keeps unknown refs closed', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const decisionRef = await captureDecision({ payload });
    const sliceId = newUuidV7();
    const first = await entry.capture(
      captureEnvelope({ payload, decisionRef, sliceId, idempotencyKey: 'wi188:capture:replay' }),
      session,
    );
    const before = await sliceRows();
    const replay = await entry.capture(
      captureEnvelope({ payload, decisionRef, sliceId, idempotencyKey: 'wi188:capture:replay' }),
      session,
    );
    expect(replay.status).toBe('DUPLICATE');
    expect(sliceRefOf(replay).objectId).toBe(sliceId);
    expect(sliceRefOf(replay).contentHash.digest).toBe(sliceRefOf(first).contentHash.digest);
    expect(await sliceRows()).toEqual(before);

    await expect(
      entry.capture(
        captureEnvelope({
          payload: {
            ...payload,
            purpose: FORM_PURPOSE,
          },
          decisionRef: await captureDecision({
            payload: {
              ...payload,
              purpose: FORM_PURPOSE,
            },
          }),
          sliceId,
          idempotencyKey: 'wi188:capture:replay',
        }),
        session,
      ),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });

    // The same CREATE identity under another key never creates a second Slice.
    const other = await entry.capture(
      captureEnvelope({
        payload,
        decisionRef,
        sliceId,
        idempotencyKey: 'wi188:capture:same-identity-other-key',
      }),
      session,
    );
    expect(other).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_SLICE_ALREADY_EXISTS,
    });
    expect((await sliceRows()).length).toBe(before.length);

    const ref = sliceRefOf(first);
    await expect(
      readThroughEntry({ ...ref, contentHash: contentHashValue('b'.repeat(64)) }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });
    await expect(readThroughEntry({ ...ref, objectId: newUuidV7() })).rejects.toMatchObject({
      code: PROJECT_QUERY_NOT_FOUND,
    });
    await expect(
      readThroughEntry({
        ...ref,
        scope: { enterpriseId: newUuidV7(), projectId: fixture.projectId },
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('keeps exactly one committed Slice when two captures race for the same CREATE identity', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const sliceId = newUuidV7();
    const [left, right] = await Promise.all([
      entry.capture(
        captureEnvelope({
          payload,
          decisionRef: await captureDecision({ payload }),
          sliceId,
          idempotencyKey: 'wi188:capture:race-left',
        }),
        session,
      ),
      entry.capture(
        captureEnvelope({
          payload,
          decisionRef: await captureDecision({ payload }),
          sliceId,
          idempotencyKey: 'wi188:capture:race-right',
        }),
        session,
      ),
    ]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual(['COMMITTED', 'REJECTED']);
    const rejected = [left, right].find((result) => result.status === 'REJECTED');
    expect(rejected).toMatchObject({ errorCode: PROJECT_CAPTURE_SLICE_ALREADY_EXISTS });
    const rows = (await sliceRows()).filter((row) => row.slice_id === sliceId);
    expect(rows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // EP-176-002: Policy boundaries and trimming
  // ---------------------------------------------------------------------

  function captureEnvelopeForHandler(
    context: EnterpriseProjectTransactionContext,
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload,
    idempotencyKey: string,
    targetId: string = newUuidV7(),
  ): CommandEnvelope & { payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload } {
    return {
      commandId: newUuidV7(),
      commandType: 'project.capture_context_source_slice',
      commandVersion: '1.0',
      idempotencyScope: CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestPayload: { payload } as unknown as CanonicalJsonObject,
      enterpriseId: fixture.enterpriseId,
      projectId: fixture.projectId,
      targetType: 'ContextSourceSlice',
      targetId,
      correlationId: CORRELATION,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
      payload,
    };
  }

  /** The same payload with the owning assembly's kind identifiers. */
  function owningKindsPayload(
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload,
  ): EnterpriseProject.ProjectCaptureContextSourceSlicePayload {
    return {
      ...payload,
      requestedKinds: payload.requestedKinds.map((kind) => OWNING_KINDS[kind] ?? kind),
    };
  }

  /**
   * The trusted context the composition entry would produce, used only for the
   * owning-entry negatives that must not depend on a valid Decision.
   */
  function owningContext(
    overrides: Partial<EnterpriseProjectTransactionContext> = {},
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: SERVICE_PRINCIPAL,
      principalKind: 'SERVICE',
      actorSnapshotId: SERVICE_ACTOR_PROJECT,
      authorizationDecisionId: SEED_DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      policySnapshotId: POLICY_SNAPSHOT_ID,
      enterpriseId: fixture.enterpriseId,
      allowedProjectIds: [fixture.projectId],
      correlationId: CORRELATION,
      authorizationPurposes: ['project.context_source.capture', 'project.context_source.read'],
      ...overrides,
    };
  }

  /**
   * Owning-entry driver for the negatives that must not depend on a valid
   * Decision. The Policy Port is only reached by tests that install the real
   * IdentityPolicy resolution.
   */
  async function captureThroughOwningEntry(input: {
    payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
    idempotencyKey: string;
    context?: EnterpriseProjectTransactionContext;
    now?: () => Date;
    policyResolution?: CapturePolicyResolutionPort;
    targetId?: string;
  }): Promise<CommandResult> {
    const context = input.context ?? owningContext();
    return handleCaptureContextSourceSlice(
      db,
      context,
      captureEnvelopeForHandler(
        context,
        owningKindsPayload(input.payload),
        input.idempotencyKey,
        input.targetId ?? newUuidV7(),
      ),
      {
        policyResolution: input.policyResolution ?? unreachablePolicyResolution,
        ...(input.now === undefined ? {} : { now: input.now }),
      },
    );
  }

  const unreachablePolicyResolution: CapturePolicyResolutionPort = {
    resolveCapturePolicy() {
      throw new Error('policy resolution must not be reached by this fixture');
    },
  };

  /**
   * The production resolution Port for the owning-entry fixtures: one
   * `identity.resolve_policy@1.0` call with its own Decision, optionally
   * tampered to observe how the owning entry treats an unverifiable
   * observation.
   */
  function identityPolicyResolution(
    tamper?: (observation: CapturePolicyObservation) => CapturePolicyObservation,
  ): CapturePolicyResolutionPort {
    return {
      async resolveCapturePolicy(request) {
        const payload = { policyRef: request.policyRef };
        const decision = await authorizeCommand(identityDeps(identityContext()), {
          actorSnapshotRef: enterpriseActorRef,
          intent: {
            commandType: 'identity.resolve_policy',
            commandVersion: '1.0',
            scopeKind: 'ENTERPRISE',
            enterpriseId: fixture.enterpriseId,
            purpose: 'identity.policy.resolve_policy',
            requestedCapability: RESOLVE_CAPABILITY,
            commandPayloadHash: digestIdentityPayload(payload as unknown as CanonicalJsonObject)
              .hash,
            requestedAt: request.asOf,
            highRiskAction: false,
          },
          authenticationContextHash: AUTH_HASH,
          policySnapshotRef: grantPolicySnapshotReference(),
          ttlSeconds: 1800,
        });
        if (decision.outcome !== 'ALLOW') return { kind: 'UNRESOLVED' };
        const scopeValue = request.policyRef.scope as unknown as CanonicalJsonObject;
        const envelope = {
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
            contentHash: contentHashValue(AUTH_HASH.toString('hex')),
          },
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: decision.authorizationDecisionRef.objectId,
            scope: scopeValue,
            contentHash: decision.authorizationDecisionRef.contentHash,
          },
          consistencyRequirement: 'AUTHORITATIVE',
          correlationId: CORRELATION,
          requestedAt: request.asOf.toISOString(),
          payload,
        } as unknown as CanonicalJsonObject;
        try {
          const view = await resolvePolicy(
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
            { envelope, asOf: request.asOf },
          );
          const observation = view as CapturePolicyObservation;
          return {
            kind: 'RESOLVED',
            observation: tamper === undefined ? observation : tamper(observation),
          };
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) {
            return error.code === DEPENDENCY_UNAVAILABLE
              ? { kind: 'UNAVAILABLE' }
              : { kind: 'UNRESOLVED' };
          }
          throw error;
        }
      },
    };
  }

  it('refuses cross-Scope Project references, foreign audiences and non-closed purposes', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const before = await sliceRows().then((rows) => rows.length);
    await expect(
      captureThroughOwningEntry({
        idempotencyKey: 'wi188:capture:foreign-audience',
        payload: capturePayload({
          purpose: SOURCE_PURPOSE,
          capturePolicyRef: policyRef,
          audience: { principalKind: 'SERVICE', principalId: newUuidV7() },
        }),
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_AUDIENCE_INVALID });
    await expect(
      captureThroughOwningEntry({
        idempotencyKey: 'wi188:capture:not-allowed-project',
        payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
        context: owningContext({ allowedProjectIds: [] }),
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
    await expect(
      captureThroughOwningEntry({
        idempotencyKey: 'wi188:capture:unknown-purpose',
        payload: capturePayload({
          purpose: 'context.unknown.read',
          capturePolicyRef: policyRef,
        }),
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_PURPOSE_FORBIDDEN });
    await expect(
      captureThroughOwningEntry({
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
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });
    await expect(
      captureThroughOwningEntry({
        idempotencyKey: 'wi188:capture:foreign-policy-scope',
        payload: capturePayload({
          purpose: SOURCE_PURPOSE,
          capturePolicyRef: scopedPolicyKey(POLICY_OBJECT_MAIN, POLICY_VERSION_MAIN, newUuidV7()),
        }),
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
    await expect(
      captureThroughOwningEntry({
        idempotencyKey: 'wi188:capture:no-purpose-binding',
        payload: capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef }),
        context: owningContext({ authorizationPurposes: [] }),
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
    expect((await sliceRows()).length).toBe(before);
  });

  it('reuses the owning Source Query trimming for the captured source', async () => {
    for (const request of [
      { purpose: SOURCE_PURPOSE, kinds: SLICE_KINDS },
      { purpose: FORM_PURPOSE, kinds: [...SLICE_KINDS, 'enterprise_facts', 'active_baselines'] },
    ]) {
      const payload = capturePayload({
        purpose: request.purpose,
        capturePolicyRef: scopedPolicyKey(
          POLICY_OBJECT_MAIN,
          POLICY_VERSION_MAIN,
          fixture.enterpriseId,
        ),
        requestedKinds: request.kinds,
      });
      const result = await captureThroughEntry({
        payload,
        idempotencyKey: `wi188:capture:trim:${request.purpose}`,
      });
      const ref = sliceRefOf(result);
      const stored = await admin.query<{ slice_payload: EnterpriseProject.ContextSourceSlice }>(
        `SELECT slice_payload FROM enterprise_project.context_source_slice WHERE slice_id = $1`,
        [ref.objectId],
      );
      const storedSource = stored.rows[0]?.slice_payload.source;
      if (request.purpose === FORM_PURPOSE) {
        expect(storedSource?.factItems).toEqual([]);
        expect(storedSource?.omissions).toEqual(
          expect.arrayContaining([{ kind: 'ENTERPRISE_FACTS', reasonCode: 'PURPOSE_FORBIDDEN' }]),
        );
      }

      const owning = await handleGetProjectContextSource(db, owningContext(), {
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
        // The frozen dynamic View keeps the owning module's kind vocabulary.
        requestedKinds: request.kinds.map((kind) => OWNING_KINDS[kind] ?? kind),
      });
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

  it('refuses unresolved, unsupported, not-yet-effective and purpose-narrower capture policies', async () => {
    const captureDecisionFor = async (
      payload: EnterpriseProject.ProjectCaptureContextSourceSlicePayload,
    ) => captureDecision({ payload });
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
    const before = await sliceRows().then((rows) => rows.length);
    for (const item of cases) {
      const payload = capturePayload({
        purpose: item.purpose ?? SOURCE_PURPOSE,
        capturePolicyRef: item.policyRef,
      });
      const result = await captureThroughEntry({
        payload,
        idempotencyKey: item.idempotencyKey,
        decisionRef: await captureDecisionFor(payload),
      });
      expect(result).toMatchObject({ status: 'REJECTED', errorCode: item.errorCode });
    }
    expect((await sliceRows()).length).toBe(before);
  });

  it('keeps a captured Slice unchanged when the Project source changes and needs a new capture for new content', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: policyRef,
      requestedKinds: [...SLICE_KINDS, 'enterprise_facts'],
    });
    const captured = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:source-change-before',
    });
    const ref = sliceRefOf(captured);
    const before = await readThroughEntry(ref);

    const factContext = owningContext({ allowedProjectIds: [] });
    const proposed = await handleProposeEnterpriseFact(
      db,
      factContext,
      seedEnvelope(factContext, 'project.propose_enterprise_fact', 'wi188:fact:source-change', {
        enterpriseRef: objectRef('Enterprise', fixture.enterpriseId, fixture.enterpriseId),
        proposal: {
          factType: 'wi188.fact',
          value: { presence: 'PRESENT', value: { key: 'wi188' }, evidenceRefs: [] },
          sourceRefs: [objectRef('SourceMaterial', newUuidV7(), fixture.enterpriseId)],
          riskLevel: 'LOW',
          proposalReason: {
            reasonCode: 'WI188_FIXTURE',
            summary: 'WI188 source change fixture',
            evidenceRefs: [],
          },
        },
      }),
    );
    expect(proposed.status).toBe('COMMITTED');

    const after = await readThroughEntry(ref);
    expect(after.slice).toEqual(before.slice);

    // New content needs a new Slice under a new identity.
    const recaptured = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:source-change-after',
    });
    const nextRef = sliceRefOf(recaptured);
    expect(nextRef.objectId).not.toBe(ref.objectId);
    const next = await readThroughEntry(nextRef);
    const added = next.slice.source.factItems.filter(
      (item) => (item as { factType?: string }).factType === 'wi188.fact',
    );
    expect(added.length).toBe(before.slice.source.factItems.length + 1);
    expect(next.slice.source.redactions).toEqual(
      expect.arrayContaining([
        { path: '/factItems/0/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
      ]),
    );
  }, 120_000);

  // ---------------------------------------------------------------------
  // R2: the captured Slice must satisfy the registered read Result budget
  // ---------------------------------------------------------------------

  it('refuses a capture whose assembled Slice exceeds the registered read Result budget', async () => {
    const factContext = owningContext({ allowedProjectIds: [] });
    const proposeFacts = async (count: number, tag: string): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        const result = await handleProposeEnterpriseFact(
          db,
          factContext,
          seedEnvelope(
            factContext,
            'project.propose_enterprise_fact',
            `wi188:fact:${tag}:${index}`,
            {
              enterpriseRef: objectRef('Enterprise', fixture.enterpriseId, fixture.enterpriseId),
              proposal: {
                factType: 'wi188.fact',
                value: { presence: 'PRESENT', value: { index }, evidenceRefs: [] },
                sourceRefs: [objectRef('SourceMaterial', newUuidV7(), fixture.enterpriseId)],
                riskLevel: 'LOW',
                proposalReason: {
                  reasonCode: 'WI188_FIXTURE',
                  summary: 'WI188 result budget fixture',
                  evidenceRefs: [],
                },
              },
            },
          ),
        );
        if (result.status !== 'COMMITTED') {
          throw new Error(`fact fixture proposed as ${result.status}`);
        }
      }
    };
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: policyRef,
      requestedKinds: [...SLICE_KINDS, 'enterprise_facts'],
    });
    // 511 Facts produce exactly 1024 redactions: the registered boundary.
    const boundaryFacts = 511;
    const existing = await admin.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM enterprise_project.enterprise_fact
        WHERE enterprise_id = $1 AND current_version_id IS NOT NULL`,
      [fixture.enterpriseId],
    );
    await proposeFacts(boundaryFacts - (existing.rows[0]?.count ?? 0), 'boundary');
    const boundary = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:result-budget-boundary',
    });
    expect(boundary.status).toBe('COMMITTED');

    // One more Fact crosses the budget: the capture must refuse to publish a
    // Slice that the registered read Result could never return.
    await proposeFacts(1, 'over-budget');
    const before = await sliceRows().then((rows) => rows.length);
    const rejected = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:result-budget-exceeded',
    });
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_RESULT_INVALID,
    });
    expect((await sliceRows()).length).toBe(before);
    const committedReceipts = await admin.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM enterprise_project.command_receipt
        WHERE idempotency_key = 'wi188:capture:result-budget-exceeded' AND outcome = 'COMMITTED'`,
    );
    expect(committedReceipts.rows[0]?.count).toBe(0);

    // The committed boundary Slice is still exactly dereferenceable.
    const read = await readThroughEntry(sliceRefOf(boundary));
    expect(read.useStatus).toBe('USABLE');
    expect(read.slice.source.factItems).toHaveLength(boundaryFacts);
  }, 300_000);

  // ---------------------------------------------------------------------
  // EP-176-003: read-time lifecycle, audience and source immutability
  // ---------------------------------------------------------------------

  it('reports REVOKED after the capture Policy is superseded and never rewrites the old Slice', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_REVOKED,
      POLICY_VERSION_REVOKED_FIRST,
      fixture.enterpriseId,
    );
    const payload = capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef });
    const captured = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:revoked-policy',
    });
    const ref = sliceRefOf(captured);
    const beforeRevocation = await readThroughEntry(ref);
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

    const afterRevocation = await readThroughEntry(ref);
    expect(afterRevocation.useStatus).toBe('REVOKED');
    expect(afterRevocation.slice).toEqual(beforeRevocation.slice);

    // The historical Receipt replays the original result but does not restore
    // consumption eligibility.
    const replay = await entry.capture(
      captureEnvelope({
        payload,
        decisionRef: await captureDecision({ payload }),
        sliceId: ref.objectId,
        idempotencyKey: 'wi188:capture:revoked-policy',
      }),
      session,
    );
    expect(replay.status).toBe('DUPLICATE');
    expect(sliceRefOf(replay).objectId).toBe(ref.objectId);
    expect((await readThroughEntry(ref)).useStatus).toBe('REVOKED');
  });

  it('binds a read to the trusted session authentication context', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const captured = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:read-session',
    });
    const ref = sliceRefOf(captured);
    const decisionRef = await readDecisionRef(ref);

    // The unchanged session (Envelope hash = trusted session hash = Decision
    // authentication context) reads the Slice.
    expect((await entry.read(readEnvelope({ ref, decisionRef }), session)).useStatus).toBe(
      'USABLE',
    );

    // Another session cannot replay this Decision, even with the same Principal.
    await expect(
      entry.read(readEnvelope({ ref, decisionRef }), {
        ...session,
        authenticationContextHash: OTHER_SESSION_HASH,
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // The Envelope authentication reference must be this session's hash.
    await expect(
      entry.read(
        readEnvelope({ ref, decisionRef, authenticationContextHash: OTHER_SESSION_HASH }),
        session,
      ),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

    // A malformed trusted session hash is refused before any Decision check.
    await expect(
      entry.read(readEnvelope({ ref, decisionRef }), {
        ...session,
        authenticationContextHash: Buffer.alloc(16, 0x11),
      }),
    ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
  });

  it('refuses readers outside the Slice audience and hides the Slice from other Projects', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const captured = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:audience',
    });
    const ref = sliceRefOf(captured);

    // Another Principal is not the Slice audience.
    await expect(
      handleGetContextSourceSlice(
        db,
        owningContext({ principalId: newUuidV7() }),
        { sourceSliceRef: ref } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
        { policyResolution: identityPolicyResolution() },
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_AUDIENCE_INVALID });

    // Another Project cannot see this Slice at all (FORCE RLS hides the row).
    const otherProject = newUuidV7();
    await expect(
      handleGetContextSourceSlice(
        db,
        owningContext({ allowedProjectIds: [otherProject] }),
        {
          sourceSliceRef: {
            ...ref,
            scope: { enterpriseId: fixture.enterpriseId, projectId: otherProject },
          },
        } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
        { policyResolution: identityPolicyResolution() },
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });
  });

  // ---------------------------------------------------------------------
  // EP-176-004: fail closed without half-products
  // ---------------------------------------------------------------------

  it('refuses a capture whose validity window closes before commit without writing a Slice', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_TTL,
        POLICY_VERSION_TTL,
        fixture.enterpriseId,
      ),
    });
    const base = Date.now();
    let calls = 0;
    // Evaluation of the entry consumes the first instants; the capture then
    // resolves and assembles while the 120s Policy window is still open, and
    // the pre-commit re-check has already crossed it.
    const clockEntry = createContextSourceSliceEntry({
      enterpriseProjectDb: db,
      identity: { db: identityDb, repo: identityRepo, crypto },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: READ_CAPABILITY,
        resolve: RESOLVE_CAPABILITY,
      },
      now: () => {
        calls += 1;
        // Evaluation and Policy resolution observe the base instant; each
        // later observation advances past the 120s window.
        return new Date(calls <= 3 ? base : base + (calls - 3) * 121_000);
      },
    });
    const before = await sliceRows().then((rows) => rows.length);
    const result = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:clock-crossing',
      entryInstance: clockEntry,
    });
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_VALIDITY_INVALID,
    });
    expect((await sliceRows()).length).toBe(before);
  });

  it('refuses a resolution observation whose content hash is not this request', async () => {
    const policyRef = scopedPolicyKey(
      POLICY_OBJECT_MAIN,
      POLICY_VERSION_MAIN,
      fixture.enterpriseId,
    );
    const payload = capturePayload({ purpose: SOURCE_PURPOSE, capturePolicyRef: policyRef });
    const before = await sliceRows().then((rows) => rows.length);
    const tampered = identityPolicyResolution((observation) => ({
      ...observation,
      contentHash: contentHashValue('c'.repeat(64)),
    }));
    const rejected = await captureThroughOwningEntry({
      payload,
      idempotencyKey: 'wi188:capture:tampered-observation',
      policyResolution: tampered,
    });
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
    });
    expect((await sliceRows()).length).toBe(before);

    const captured = await captureThroughOwningEntry({
      payload,
      idempotencyKey: 'wi188:capture:drift',
      policyResolution: identityPolicyResolution(),
    });
    const ref = sliceRefOf(captured);
    const drifted = await handleGetContextSourceSlice(
      db,
      owningContext(),
      { sourceSliceRef: ref } as unknown as EnterpriseProject.ProjectGetContextSourceSlicePayload,
      { policyResolution: tampered },
    );
    expect(drifted.useStatus).toBe('REVOKED');
  });

  it('fails closed when the Policy resolution dependency is unavailable', async () => {
    const payload = capturePayload({
      purpose: SOURCE_PURPOSE,
      capturePolicyRef: scopedPolicyKey(
        POLICY_OBJECT_MAIN,
        POLICY_VERSION_MAIN,
        fixture.enterpriseId,
      ),
    });
    const deadPool = new pg.Pool({ connectionString: 'postgres://127.0.0.1:1/zhiju_core' });
    await deadPool.end();
    const brokenEntry = createContextSourceSliceEntry({
      enterpriseProjectDb: db,
      identity: {
        db: createIdentityPolicyDatabase(deadPool),
        repo: identityRepo,
        crypto,
      },
      capabilities: {
        capture: CAPTURE_CAPABILITY,
        read: READ_CAPABILITY,
        resolve: RESOLVE_CAPABILITY,
      },
    });
    const before = await sliceRows().then((rows) => rows.length);
    await expect(
      captureThroughEntry({
        payload,
        idempotencyKey: 'wi188:capture:resolution-down',
        entryInstance: brokenEntry,
      }),
    ).rejects.toMatchObject({ code: DEPENDENCY_UNAVAILABLE });

    const receipts = await admin.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM enterprise_project.command_receipt
        WHERE idempotency_key = 'wi188:capture:resolution-down'`,
    );
    expect(receipts.rows[0]?.count).toBe(0);
    expect((await sliceRows()).length).toBe(before);

    // The same key still captures once the dependency is reachable again.
    const retried = await captureThroughEntry({
      payload,
      idempotencyKey: 'wi188:capture:resolution-down',
    });
    expect(retried.status).toBe('COMMITTED');
  });

  // ---------------------------------------------------------------------
  // Persistence boundary: RLS, immutability and the promoted mirror
  // ---------------------------------------------------------------------

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
            SERVICE_ACTOR_PROJECT,
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
