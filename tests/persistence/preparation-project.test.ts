import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  ContractRegistry,
  type Common,
  type PreparationIdentityPort,
  type PreparationAdmissionResult,
  type PreparationAuthorizationProof,
  type PreparationSession,
  type WorkspaceCommandInput,
  type PreparationPresetPayload,
} from '@zhiju/contracts';
import {
  createEnterpriseProjectDatabase,
  createPreparationProjectService,
  type PreparationProjectConfig,
} from '@zhiju/enterprise-project';

// Owning EP PostgreSQL isolation tests. IP is an explicit controlled test port;
// these assertions do not claim cross-owner authentication acceptance.
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const object = (type: string, id: string, scope: Common.ScopeRef = {}): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType: type,
  objectId: id,
  scope,
});
const versioned = (type: string): Common.VersionedRef => ({
  kind: 'VERSIONED',
  objectType: type,
  objectId: newUuidV7(),
  versionId: newUuidV7(),
  scope: {},
});
const snapshot = (type: string): Common.SnapshotRef => ({
  kind: 'SNAPSHOT',
  objectType: type,
  objectId: newUuidV7(),
  snapshotId: newUuidV7(),
  scope: {},
  contentHash: preparationHash({ controlledTest: type }),
});
const content = (type: string): Common.ContentAddressedRef => ({
  kind: 'CONTENT_ADDRESSED',
  objectType: type,
  objectId: newUuidV7(),
  scope: {},
  contentHash: preparationHash({ controlledTest: type }),
});
describe.skipIf(!databaseUrl)('EP preparation owning persistence', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createEnterpriseProjectDatabase>;
  const role = 'ep291_' + newUuidV7().replaceAll('-', '');
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD 'controlled-ep291-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher,enterprise_project_app TO ${role}`);
    const url = new URL(databaseUrl ?? 'postgresql://unused');
    url.username = role;
    url.password = 'controlled-ep291-test-only';
    pool = new pg.Pool({ connectionString: url.toString(), max: 12 });
    db = createEnterpriseProjectDatabase(pool);
  });
  afterAll(async () => {
    await db.destroy();
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });
  async function fixture() {
    const human: PreparationSession = {
      principalId: newUuidV7(),
      authenticationContextHash: preparationHash({ controlledTest: 'EP291' }),
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const policySnapshotId = newUuidV7();
    let provisioningFails = false;
    const admissions = new Map<string, PreparationAdmissionResult>();
    const proof = (session: PreparationSession): PreparationAuthorizationProof => ({
      session,
      actorSnapshotRef: snapshot('identity.actor_snapshot'),
      authorizationDecisionRef: content('identity.authorization_decision'),
      context: {
        principalKind: 'HUMAN',
        policySnapshotId,
        authorizationDecisionExpiresAt: session.expiresAt,
      },
    });
    const identity = {
      lookupAdmission(
        _s: PreparationSession,
        input: { requestRef: Common.ObjectRef; originalKey: string },
      ) {
        const a = admissions.get(input.requestRef.objectId);
        if (a?.payload.originalKey !== input.originalKey) {
          const e = new Error('not visible') as Error & { code: string };
          e.code = 'PREPARATION_NOT_VISIBLE';
          throw e;
        }
        return a;
      },
      reserve(s: PreparationSession, input: PreparationAdmissionResult['payload']) {
        const old = admissions.get(input.requestRef.objectId);
        if (old) return old;
        const payload = {
          ...input,
          creatorRef: object('identity.principal', s.principalId),
          membershipTemplateRef: versioned('identity.policy'),
          membershipTemplateHash: preparationHash({ membership: 'controlled' }),
          enrollmentGrantRef: content('identity.preparation_enrollment'),
          enterprisePermissionRefs: [],
          actorSnapshotRef: snapshot('identity.actor_snapshot'),
          authorizationDecisionRef: content('identity.authorization_decision'),
          createdAt: new Date().toISOString(),
          validUntil: s.expiresAt,
        };
        const a = {
          admissionRef: content('zhiju.identity.preparation_admission'),
          receiptRef: content('zhiju.identity.preparation_receipt'),
          grantRefs: [],
          payload,
          currentUseStatus: 'USABLE',
          checkedAt: new Date().toISOString(),
          validUntil: s.expiresAt,
        } as PreparationAdmissionResult;
        admissions.set(input.requestRef.objectId, a);
        return a;
      },
      revalidate(_s: PreparationSession, ref: Common.ContentAddressedRef) {
        const found = [...admissions.values()].find(
          (a) => a.admissionRef.objectId === ref.objectId,
        );
        if (!found) throw new Error('missing controlled admission');
        return found;
      },
      authorizeBootstrap(s: PreparationSession) {
        return proof(s);
      },
      checkBootstrap() {
        return undefined;
      },
      materializeMemberPolicy(
        _s: PreparationSession,
        input: { memberPolicyId: string; versionId: string },
      ) {
        return {
          memberPolicyRef: {
            kind: 'VERSIONED',
            objectType: 'identity.policy',
            objectId: input.memberPolicyId,
            versionId: input.versionId,
            scope: {},
          },
          memberPolicyHash: preparationHash({ memberPolicy: 'controlled' }),
          payload: {},
          receiptRef: content('identity.preparation_receipt'),
        };
      },
      readMemberPolicy() {
        return undefined;
      },
      provisionCreatorAccess() {
        if (provisioningFails) throw new Error('controlled provisioning outage');
        return {
          access: 'COMPLETE',
          provisioningReceiptRef: content('identity.preparation_provisioning'),
          grantRefs: [],
          steps: [],
          checkedAt: new Date().toISOString(),
        };
      },
      currentCreatorAccess() {
        return {
          access: provisioningFails ? 'INCOMPLETE' : 'COMPLETE',
          provisioningReceiptRef: content('identity.preparation_provisioning'),
          grantRefs: [],
          steps: [],
          checkedAt: new Date().toISOString(),
        };
      },
    } as unknown as PreparationIdentityPort;
    const payload: PreparationPresetPayload = {
      profile: 'ep.preparation_entry@1.0',
      presetCode: 'zhiju.test.ep_' + newUuidV7().replaceAll('-', ''),
      presetVersion: '1.0.0',
      creation: {
        mode: 'PREPARATION',
        status: 'PREPARING',
        enterpriseInitialStatus: 'ACTIVE',
        objective: 'Controlled company objective',
        enterpriseCodePrefix: 'CE',
        projectCodePrefix: 'CP',
      },
      memberPolicyTemplate: {
        ref: versioned('identity.policy'),
        payloadHash: preparationHash({ membership: 'controlled' }),
      },
      intakePolicy: {
        ref: versioned('zhiju.integration.customer_zip_policy'),
        payloadHash: preparationHash({ zip: 'controlled' }),
      },
      companyRules: {
        ruleBundleRef: snapshot('identity.policy_snapshot'),
        startupRulesRef: snapshot('identity.policy_snapshot'),
        vocabularyRef: snapshot('identity.policy_snapshot'),
        publicationRef: content('zhiju.identity.company_rule_publication'),
      },
      analysisHandoff: {
        intent: 'ANALYZE',
        analysisProfileRef: versioned('zhiju.task.analysis_profile'),
        expectedReportProfileRef: versioned('zhiju.project.report_profile'),
      },
    };
    const config = {
      db,
      identity,
      serviceSession: human,
      verifySession: (s: PreparationSession) => {
        if (s.principalId !== human.principalId) throw new Error('not original Human');
      },
      authorize: (s: PreparationSession) => proof(s),
      check: () => undefined,
      selection: undefined,
      cursorKey: Buffer.alloc(32, 2),
      validateDependencies: () => ({
        templateRefs: [content('TemplateVersion')],
        requirementRefs: [content('zhiju.project.company_startup_requirement')],
        sourceWatermarks: [],
      }),
      clock: () => new Date('2026-10-15T00:00:00.000Z'),
    } as unknown as PreparationProjectConfig;
    const service = createPreparationProjectService(config);
    const published = await service.publishPreset(human, {
      presetId: newUuidV7(),
      versionId: newUuidV7(),
      payload,
      effectiveFrom: '2026-10-01T00:00:00.000Z',
    });
    config.selection = {
      preparationPresetRef: published.preparationPresetRef,
      preparationPresetHash: published.preparationPresetHash,
      publicationRef: published.publicationRef,
    };
    const scopeRef = { enterpriseId: newUuidV7(), projectId: newUuidV7() },
      requestId = newUuidV7();
    const requestPayload = {
      customer: { mode: 'NEW', displayName: '原始客户' },
      projectTitle: '准备项目',
      preparationPresetRef: published.preparationPresetRef,
      preparationPresetHash: published.preparationPresetHash,
    };
    const command: WorkspaceCommandInput = {
      commandId: newUuidV7(),
      type: 'project.request_project_preparation',
      version: '1.0',
      scopeRef,
      targetRef: object('zhiju.project.preparation_request', requestId, scopeRef),
      idempotencyKey: `project.request_project_preparation:1.0:${requestId}`,
      correlationId: newUuidV7(),
      requestedAt: '2026-10-15T00:00:00.000Z',
      payload: requestPayload,
      integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(requestPayload) },
    };
    return {
      human,
      service,
      command,
      config,
      published,
      failProvisioning() {
        provisioningFails = true;
      },
      recoverProvisioning() {
        provisioningFails = false;
      },
    };
  }
  it('creates the exact NEW roots once, atomic claim and receipt, and pure query', async () => {
    const f = await fixture();
    const first = await f.service.request(f.human, f.command);
    expect(first.disposition).toBe('ACCEPTED');
    const validation = new ContractRegistry().validateOperationResult(
      'project.request_project_preparation',
      '1.0',
      first,
    );
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(validation.valid).toBe(true);
    const repeated = await f.service.request(f.human, f.command);
    expect(repeated.steps.PROJECT).toEqual(first.steps.PROJECT);
    const before = await admin.query('SELECT count(*) FROM enterprise_project.preparation_fact');
    const recovered = await f.service.getRequest(
      { ...f.human, authenticationContextHash: preparationHash({ relogin: true }) },
      { requestRef: f.command.targetRef, originalKey: f.command.idempotencyKey },
    );
    expect(recovered.originalCommand).toEqual(f.command);
    const after = await admin.query('SELECT count(*) FROM enterprise_project.preparation_fact');
    expect(after.rows).toEqual(before.rows);
    const project = await admin.query(
      'SELECT status,creation_mode FROM enterprise_project.project WHERE project_id=$1',
      [f.command.scopeRef.projectId],
    );
    expect(project.rows).toEqual([{ status: 'PREPARING', creation_mode: 'PREPARATION' }]);
    const claim = await admin.query(
      'SELECT count(*) FROM enterprise_project.project_scope_claim WHERE project_id=$1',
      [f.command.scopeRef.projectId],
    );
    expect(claim.rows[0].count).toBe('1');
    const start = await admin.query(
      'SELECT count(*) FROM enterprise_project.project_snapshot_binding WHERE project_id=$1',
      [f.command.scopeRef.projectId],
    );
    expect(start.rows[0].count).toBe('0');
  });
  it('retains a committed Project when provisioning fails and resumes the same command', async () => {
    const f = await fixture();
    f.failProvisioning();
    await expect(f.service.request(f.human, f.command)).rejects.toThrow(
      'controlled provisioning outage',
    );
    const partial = await f.service.getRequest(f.human, {
      requestRef: f.command.targetRef,
      originalKey: f.command.idempotencyKey,
    });
    expect(partial.disposition).toBe('PARTIAL');
    expect(partial.steps.PROJECT.status).toBe('COMMITTED');
    expect(partial.permittedActions).toEqual(['CONTINUE_ORIGINAL']);
    f.recoverProvisioning();
    const final = await f.service.request(f.human, f.command);
    expect(final.disposition).toBe('ACCEPTED');
    expect(final.steps.PROJECT).toEqual(partial.steps.PROJECT);
  });
  it('rejects a same-hash Unicode spelling change to the immutable original command', async () => {
    const f = await fixture();
    const payload = { ...f.command.payload, projectTitle: 'é' };
    const first = {
      ...f.command,
      payload,
      integrity: { canonicalizationVersion: '1' as const, payloadHash: preparationHash(payload) },
    };
    await f.service.request(f.human, first);
    const changed = { ...first, payload: { ...payload, projectTitle: 'e\u0301' } };
    expect(preparationHash(changed.payload)).toEqual(first.integrity.payloadHash);
    await expect(f.service.request(f.human, changed)).rejects.toThrow(
      'IDEMPOTENCY_PAYLOAD_CONFLICT',
    );
  });
  it('rejects another Human recovery and leaves the intent untouched', async () => {
    const f = await fixture();
    await f.service.request(f.human, f.command);
    await expect(
      f.service.getRequest(
        { ...f.human, principalId: newUuidV7() },
        { requestRef: f.command.targetRef, originalKey: f.command.idempotencyKey },
      ),
    ).rejects.toThrow();
  });
  it('keeps original exact policy tuple after the installed entry selection changes', async () => {
    const f = await fixture();
    const original = await f.service.request(f.human, f.command);
    f.config.selection = {
      preparationPresetRef: versioned('zhiju.project.preparation_preset'),
      preparationPresetHash: preparationHash({ unrelated: 'new-selection' }),
      publicationRef: content('zhiju.project.preparation_preset_publication'),
    };
    const query = await f.service.getRequest(f.human, {
      requestRef: f.command.targetRef,
      originalKey: f.command.idempotencyKey,
    });
    expect(query.intakePolicyRef).toEqual(original.intakePolicyRef);
    expect(query.preparationPresetRef).toEqual(original.preparationPresetRef);
    expect(query.originalCommand).toEqual(f.command);
  });
  it('preserves committed refs and original payload when current dependencies become stale or unavailable', async () => {
    const f = await fixture();
    const original = await f.service.request(f.human, f.command);
    f.config.validateDependencies = () => {
      const error = new Error('controlled withdrawn dependency') as Error & { code: string };
      error.code = 'PREPARATION_PRESET_UNUSABLE';
      return Promise.reject(error);
    };
    const stale = await f.service.getRequest(f.human, {
      requestRef: f.command.targetRef,
      originalKey: f.command.idempotencyKey,
    });
    expect(stale.disposition).toBe('STALE');
    expect(stale.steps).toEqual(original.steps);
    expect(stale.originalCommand).toEqual(f.command);
    expect(stale.permittedActions).toEqual([]);
    f.config.validateDependencies = () => Promise.reject(new Error('controlled dependency outage'));
    const unknown = await f.service.getRequest(f.human, {
      requestRef: f.command.targetRef,
      originalKey: f.command.idempotencyKey,
    });
    expect(unknown.disposition).toBe('UNKNOWN');
    expect(unknown.steps).toEqual(original.steps);
    expect(unknown.intakePolicyHash).toEqual(original.intakePolicyHash);
    expect(unknown.permittedActions).toEqual([]);
  });
  it('reads the original immutable preset after its publication is withdrawn', async () => {
    const f = await fixture();
    const original = await f.service.request(f.human, f.command);
    await f.service.withdrawPreset(f.human, {
      publicationRef: f.published.publicationRef,
      effectiveFrom: '2026-10-14T00:00:00.000Z',
      reasonCode: 'WITHDRAWN',
    });
    const stale = await f.service.getRequest(f.human, {
      requestRef: f.command.targetRef,
      originalKey: f.command.idempotencyKey,
    });
    expect(stale.disposition).toBe('STALE');
    expect(stale.steps).toEqual(original.steps);
    expect(stale.intakePolicyRef).toEqual(original.intakePolicyRef);
    expect(stale.permittedActions).toEqual([]);
  });
});
