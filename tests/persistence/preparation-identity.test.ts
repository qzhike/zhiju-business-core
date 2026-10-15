import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash as hash,
  type Common,
  type PreparationSession,
  type PreparationAdmissionInput,
  type PreparationIdentityPort,
} from '@zhiju/contracts';
import {
  createPreparationIdentityDatabase,
  createPreparationIdentityPort,
  PREPARATION_CREATOR_BINDINGS,
  createBootstrapClaim,
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  registerPrincipal,
  recordPolicySnapshot,
  withIdentityTransaction,
  type IdentityCryptoPorts,
} from '@zhiju/identity-policy';
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
describe.skipIf(!databaseUrl)('IP #277 preparation owning authority (PostgreSQL)', () => {
  let admin: pg.Client,
    pool: pg.Pool,
    port: PreparationIdentityPort,
    operator: PreparationSession,
    human: PreparationSession,
    other: PreparationSession,
    policyRef: Common.SnapshotRef;
  let templateRef: Common.VersionedRef, templateHash: Common.ContentHash;
  const sessions = new Map<string, PreparationSession>();
  const preset: Common.VersionedRef = {
    kind: 'VERSIONED',
    objectType: 'zhiju.project.preparation_preset',
    objectId: newUuidV7(),
    versionId: newUuidV7(),
    scope: {},
  };
  const presetHash = hash({ provenance: 'IP291_CONTROLLED_PRESET_BINDING' });
  const crypto: IdentityCryptoPorts = {
    lookupHash: {
      computeKeyedLookupHash() {
        throw new Error('unused');
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('unused');
      },
      decryptField() {
        throw new Error('unused');
      },
    },
  };
  const makeSession = (): PreparationSession => ({
    principalId: newUuidV7(),
    authenticationContextHash: hash({ id: newUuidV7() }),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  function request(key = newUuidV7()): PreparationAdmissionInput {
    const e = newUuidV7(),
      p = newUuidV7(),
      r = newUuidV7(),
      scope = { enterpriseId: e, projectId: p };
    return {
      requestRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.preparation_request',
        objectId: r,
        scope,
      },
      enterpriseRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.enterprise',
        objectId: e,
        scope: { enterpriseId: e },
      },
      projectRef: { kind: 'OBJECT', objectType: 'zhiju.project.project', objectId: p, scope },
      originalCommandId: newUuidV7(),
      originalKey: key,
      payloadHash: hash({ e, p, r }),
      customerMode: 'NEW',
      preparationPresetRef: preset,
      preparationPresetHash: presetHash,
    };
  }
  async function enroll(maxUses: number) {
    return port.grantEnrollment(operator, {
      grantId: newUuidV7(),
      principalRef: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: human.principalId,
        scope: {},
      },
      allowedModes: ['NEW'],
      preparationPresetRef: preset,
      preparationPresetHash: presetHash,
      membershipTemplateRef: templateRef,
      membershipTemplateHash: templateHash,
      policySnapshotRef: policyRef,
      effectivePeriod: {
        from: new Date(Date.now() - 60000).toISOString(),
        to: new Date(Date.now() + 1800000).toISOString(),
      },
      maxUses,
    });
  }
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      "CREATE ROLE preparation291_probe LOGIN PASSWORD 'preparation291-controlled' NOSUPERUSER NOBYPASSRLS",
    );
    await admin.query(
      'GRANT platform_context_establisher,identity_policy_app,identity_policy_preparation_writer,identity_preparation_self_reader TO preparation291_probe',
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'preparation291_probe';
    url.password = 'preparation291-controlled';
    pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    operator = makeSession();
    human = makeSession();
    other = makeSession();
    for (const s of [operator, human, other]) sessions.set(s.principalId, s);
    const db = createIdentityPolicyDatabase(pool),
      repo = new IdentityPolicyRepository(crypto),
      context = {
        kind: 'REQUEST' as const,
        principalId: operator.principalId,
        actorSnapshotId: newUuidV7(),
        authorizationDecisionId: newUuidV7(),
        authorizationDecisionHash: Buffer.from(operator.authenticationContextHash.digest, 'hex'),
        authorizationDecisionExpiresAt: new Date(operator.expiresAt),
        enterpriseId: '00000000-0000-7000-8000-000000000000',
        allowedProjectIds: [],
        correlationId: newUuidV7(),
      };
    const deps = { db, repo, context, crypto };
    const first =
      (
        await admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM identity_policy.principal',
        )
      ).rows[0]?.count === '0';
    const bootstrap = first
      ? await createBootstrapClaim(deps, {
          purpose: 'FIRST_PRINCIPAL',
          operatorDescription: 'IP291 controlled bootstrap',
          operatorActorSnapshotId: context.actorSnapshotId,
          operatorAuthorizationDecisionId: context.authorizationDecisionId,
          reason: 'Controlled owning-entry test',
          evidenceRefs: { testProvenance: 'IP291_CONTROLLED' },
          expiresAt: new Date(operator.expiresAt),
        })
      : undefined;
    for (const s of [operator, human, other])
      expect(
        (
          await registerPrincipal(deps, {
            principalId: s.principalId,
            principalKind: 'HUMAN',
            displayName: 'IP291 controlled Human',
            initialStatus: 'ACTIVE',
            idempotencyKey: s.principalId,
            ...(s === operator && bootstrap ? { bootstrapClaimId: bootstrap.claimId } : {}),
          })
        ).status,
      ).toBe('COMMITTED');
    const id = newUuidV7();
    expect(
      (
        await recordPolicySnapshot(deps, {
          policySnapshotId: id,
          policySetVersion: 'IP291:' + id,
          policySchemaRefs: ['identity.CapabilityPolicy@1.0'],
          effectiveFrom: new Date(Date.now() - 60000),
          policyDocument: { provenance: 'IP291_CONTROLLED' },
          idempotencyKey: id,
        })
      ).status,
    ).toBe('COMMITTED');
    const row = await withIdentityTransaction(db, context, (t) =>
      repo.getPolicySnapshotById(t, id),
    );
    if (!row) throw new Error('owning Policy absent');
    policyRef = {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: id,
      snapshotId: id,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: row.payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
    port = createPreparationIdentityPort({
      db: createPreparationIdentityDatabase(pool),
      grantAdministrators: [operator.principalId],
      administratorPolicySnapshotRef: policyRef,
      servicePrincipalIds: [],
      enterpriseCapabilities: {
        select: 'ip291.enterprise.select',
        create: 'ip291.enterprise.create',
      },
      verifySession(s) {
        if (JSON.stringify(s) !== JSON.stringify(sessions.get(s.principalId)))
          throw new Error('unverified session');
        return Promise.resolve();
      },
      verifyProjectCreation() {
        throw new Error('no EP project in IP admission test');
      },
      authorizeService() {
        throw new Error('no SERVICE grant');
      },
      authorizeCurrentOperation() {
        throw new Error('no scoped grant');
      },
    });
    const published = await port.publishMembershipTemplate(operator, {
      templateId: newUuidV7(),
      versionId: newUuidV7(),
      effectiveFrom: new Date(Date.now() - 10000).toISOString(),
      payload: {
        profile: 'ip.preparation_membership_template@1.0',
        templateCode: 'ip291.controlled.membership',
        templateVersion: '1.0.0',
        creatorBindings: PREPARATION_CREATOR_BINDINGS.map((b, i) => ({
          operation: b[0],
          version: '1.0' as const,
          purpose: b[1],
          action: b[2],
          targetObjectType: b[3],
          capabilityCode: 'ip291.creator.slot' + String(i),
        })).sort((a, b) => a.operation.localeCompare(b.operation)),
        grantPolicySnapshotRef: policyRef,
        maxGrantLifetimeSeconds: 1200,
      },
    });
    templateRef = published.templateRef;
    templateHash = published.templateHash;
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });
  it('rejects login-only admission and other Human; reserves once and emits exact immutable owning proofs', async () => {
    const input = request();
    await expect(port.reserve(human, input)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    const grant = await enroll(1);
    const result = await port.reserve(human, input);
    expect(result.payload.enrollmentGrantRef).toEqual(grant.grantRef);
    expect(result.grantRefs).toHaveLength(4);
    expect((await port.reserve(human, input)).admissionRef).toEqual(result.admissionRef);
    await expect(
      port.reserve(human, { ...input, payloadHash: hash({ changed: true }) }),
    ).rejects.toMatchObject({ code: 'PREPARATION_IDENTITY_CONFLICT' });
    await expect(port.revalidate(other, result.admissionRef)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    const proofInput = {
      admissionRef: result.admissionRef,
      operation: 'project.create_preparing_project',
      target: input.projectRef,
      payloadHash: input.payloadHash,
    };
    const proof = await port.authorizeBootstrap(human, proofInput);
    await expect(port.checkBootstrap(proof, proofInput)).resolves.toBeUndefined();
    await expect(
      port.checkBootstrap(proof, { ...proofInput, target: request().projectRef }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    await port.revokeEnrollment(operator, {
      grantRef: grant.grantRef,
      reasonCode: 'CONTROLLED_REVOKE',
    });
    await expect(port.checkBootstrap(proof, proofInput)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
  });
  it('atomically reserves last maxUses slot and denies revoked original receipt', async () => {
    const grant = await enroll(1);
    const results = await Promise.allSettled([
      port.reserve(human, request()),
      port.reserve(human, request()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    await port.revokeEnrollment(operator, {
      grantRef: grant.grantRef,
      reasonCode: 'CONTROLLED_REVOKE',
    });
  });
  it('withdraws the exact template and prevents new admissions without replacing the version', async () => {
    const grant = await enroll(1);
    await port.withdrawMembershipTemplate(operator, {
      templateRef,
      templateHash,
      reasonCode: 'CONTROLLED_WITHDRAW',
      effectiveFrom: new Date().toISOString(),
    });
    expect(
      (await port.readMembershipTemplate(operator, { templateRef, templateHash })).useStatus,
    ).toBe('WITHDRAWN');
    await expect(port.reserve(human, request())).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    await expect(
      port.grantEnrollment(other, {
        grantId: newUuidV7(),
        principalRef: {
          kind: 'OBJECT',
          objectType: 'identity.principal',
          objectId: human.principalId,
          scope: {},
        },
        allowedModes: ['NEW'],
        preparationPresetRef: preset,
        preparationPresetHash: presetHash,
        membershipTemplateRef: templateRef,
        membershipTemplateHash: templateHash,
        policySnapshotRef: policyRef,
        effectivePeriod: {
          from: new Date().toISOString(),
          to: new Date(Date.now() + 60000).toISOString(),
        },
        maxUses: 1,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
    expect(grant.grantRef.kind).toBe('CONTENT_ADDRESSED');
  });
});
