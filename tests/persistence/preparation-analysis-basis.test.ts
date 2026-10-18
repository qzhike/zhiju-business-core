import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  samePreparationValue,
  type PreparationAnalysisBasisPayload,
  type PreparationSession,
  type TemplatePreparationPresetPayload,
  type PreparationEntrySelection,
  type Common,
} from '@zhiju/contracts';
import {
  createPreparationIdentityDatabase,
  createPreparationIdentityPort,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  createPreparationAnalysisBasisService,
  createPreparationProjectService,
} from '@zhiju/enterprise-project';
import { createPreparationCompanyFixture } from './preparation-company-fixture.js';
import { createFixtureCrypto } from './trusted-http-fixtures.js';
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const object = (type: string, id: string): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType: type,
  objectId: id,
  scope: {},
});
describe.skipIf(!databaseUrl)('template analysis basis ownership (real PostgreSQL)', () => {
  let fixture: Awaited<ReturnType<typeof createPreparationCompanyFixture>>;
  let identity: ReturnType<typeof createPreparationIdentityPort>;
  let basis: ReturnType<typeof createPreparationAnalysisBasisService>;
  let payload: PreparationAnalysisBasisPayload;
  let inputsChanged = false,
    deny = false;
  let clock: Date | undefined;
  let onReadInstruction: (() => Promise<void>) | undefined;
  let onObservation: (() => void) | undefined;
  const instruction = Buffer.from(
    'Synthetic company instructions; compare supplied customer materials only.',
  );
  const instructionHash = createHash('sha256').update(instruction).digest('hex');
  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Persistence database is required');
    fixture = await createPreparationCompanyFixture(
      databaseUrl,
      createFixtureCrypto(Buffer.alloc(32, 17), Buffer.alloc(32, 34)),
    );
    const verifySession = (session: PreparationSession) => {
      if (deny || ![fixture.root, fixture.service].some((s) => samePreparationValue(s, session)))
        throw new Error('AUTHORIZATION_DENIED');
      return Promise.resolve();
    };
    identity = createPreparationIdentityPort({
      db: createPreparationIdentityDatabase(fixture.ipPool),
      grantAdministrators: [fixture.root.principalId],
      administratorPolicySnapshotRef: fixture.policyRef,
      servicePrincipalIds: [fixture.service.principalId],
      enterpriseCapabilities: { select: 'template.test.select', create: 'template.test.create' },
      verifySession,
      verifyProjectCreation: () =>
        Promise.reject(new Error('Project creation is outside this fixture')),
      authorizeService: () =>
        Promise.reject(new Error('Project bootstrap is outside this fixture')),
      authorizeCurrentOperation: () =>
        Promise.reject(new Error('Project operations are outside this fixture')),
    });
    payload = JSON.parse(
      readFileSync(
        new URL('../fixtures/contracts/template-preparation/basis.payload.json', import.meta.url),
        'utf8',
      ),
    ) as PreparationAnalysisBasisPayload;
    payload.basisCode = 'zhiju.analysis.test.' + newUuidV7().replaceAll('-', '');
    const template = fixture.analysisTemplates.find((t) => t.templateCode === 'S1');
    if (!template) throw new Error('Required fixture template is missing');
    payload.templateBindings = [template];
    payload.instructionBindings = [
      {
        sourceId: 'fixed-company-instructions',
        bytesSha256: instructionHash,
        byteLength: instruction.length,
      },
    ];
    payload.requirementBindings = [
      { requirementCode: 'zhiju.requirement.scope', templateCode: 'S1', locator: '1.2/4.3.3' },
    ];
    basis = createPreparationAnalysisBasisService({
      db: createEnterpriseProjectDatabase(fixture.epPool),
      clock: () => {
        onObservation?.();
        return clock ?? new Date();
      },
      authorize: (s, op, target, input) => identity.authorizeOperation(s, op, target, input),
      check: (proof, op, target, input) => identity.checkOperation(proof, op, target, input),
      validateDefinition: (p) => {
        if (p.reportSchemaSha256 !== payload.reportSchemaSha256)
          throw new Error('SCHEMA_UNSUPPORTED');
      },
      sources: {
        readTemplate: (ref) => fixture.analysisTemplateSources.read(ref),
        locate: (bytes, locator) => fixture.analysisTemplateSources.locate(bytes, locator),
        readInstruction: async (hash) => {
          if (hash !== instructionHash) throw new Error('SOURCE_MISSING');
          await onReadInstruction?.();
          return inputsChanged ? Buffer.from('changed') : instruction;
        },
      },
    });
  }, 120_000);
  afterAll(async () => {
    await fixture.close();
  });
  const input = () => ({
    basisId: newUuidV7(),
    versionId: newUuidV7(),
    payload: structuredClone(payload),
    effectiveFrom: new Date(Date.now() - 1000).toISOString(),
  });
  async function grant(id: string) {
    await identity.grantAuthority(fixture.root, {
      grantId: newUuidV7(),
      principalRef: object('identity.principal', fixture.service.principalId),
      operation: 'project.preparation.analysis_basis.read',
      target: object('zhiju.project.preparation_analysis_basis', id),
      policySnapshotRef: fixture.policyRef,
      effectivePeriod: {
        from: new Date(Date.now() - 1000).toISOString(),
        to: fixture.service.expiresAt,
      },
    });
  }
  it('publishes actual template bytes and immutable provenance, replays without another publication', async () => {
    const request = input();
    const first = await basis.publish(fixture.root, request);
    const replay = await basis.publish(fixture.root, request);
    expect(replay).toEqual(first);
    expect(first.basisHash).toEqual(preparationHash(request.payload));
    const selection = {
      basisRef: first.basisRef,
      basisHash: first.basisHash,
      publicationRef: first.publicationRef,
    };
    await grant(request.basisId);
    const resolved = await basis.resolve(fixture.service, selection);
    expect(resolved.useStatus).toBe('USABLE');
    expect(resolved.payload).toEqual(payload);
    expect(JSON.stringify(resolved)).not.toContain('company_rule_publication');
    const wrong = { ...selection, basisHash: { ...selection.basisHash, digest: 'f'.repeat(64) } };
    await expect(basis.resolve(fixture.service, wrong)).rejects.toThrow(
      'PREPARATION_ANALYSIS_BASIS_HASH_MISMATCH',
    );
    inputsChanged = true;
    await expect(basis.resolve(fixture.service, selection)).rejects.toThrow(
      'PREPARATION_ANALYSIS_SOURCE_HASH_MISMATCH',
    );
    inputsChanged = false;
    await expect(
      basis.publish(fixture.service, {
        ...input(),
        payload: { ...payload, basisVersion: '1.0.1' },
      }),
    ).rejects.toThrow();
  });
  it('keeps parallel versions usable until an explicit successor or withdrawal takes effect', async () => {
    const one = input();
    one.payload.basisVersion = '2.0.0';
    const a = await basis.publish(fixture.root, one);
    await grant(one.basisId);
    const two = input();
    two.payload.basisVersion = '2.1.0';
    const b = await basis.publish(fixture.root, two);
    await grant(two.basisId);
    const select = (r: typeof a) => ({
      basisRef: r.basisRef,
      basisHash: r.basisHash,
      publicationRef: r.publicationRef,
    });
    expect((await basis.resolve(fixture.service, select(a))).useStatus).toBe('USABLE');
    const three = input();
    three.payload.basisVersion = '2.2.0';
    await basis.publish(fixture.root, { ...three, supersedesPublicationRef: a.publicationRef });
    expect((await basis.resolve(fixture.service, select(a))).useStatus).toBe('SUPERSEDED');
    expect((await basis.resolve(fixture.service, select(b))).useStatus).toBe('USABLE');
    const withdrawal = {
      publicationRef: b.publicationRef,
      effectiveFrom: new Date().toISOString(),
      reasonCode: 'WITHDRAWN_BY_COMPANY',
    };
    const w = await basis.withdraw(fixture.root, withdrawal);
    expect(await basis.withdraw(fixture.root, withdrawal)).toEqual(w);
    expect((await basis.resolve(fixture.service, select(b))).useStatus).toBe('WITHDRAWN');
    await expect(
      basis.withdraw(fixture.root, { ...withdrawal, reasonCode: 'DIFFERENT' }),
    ).rejects.toThrow('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });
  it.each(['WITHDRAWN', 'SUPERSEDED'] as const)(
    'computes %s at the final observation when its scheduled time crosses source I/O',
    async (expected) => {
      const request = input();
      request.payload.basisCode += '.' + newUuidV7().replaceAll('-', '');
      const published = await basis.publish(fixture.root, request);
      await grant(request.basisId);
      const selection = {
        basisRef: published.basisRef,
        basisHash: published.basisHash,
        publicationRef: published.publicationRef,
      };
      const start = Date.now();
      const effectiveFrom = new Date(start + 1000).toISOString();
      if (expected === 'WITHDRAWN') {
        await basis.withdraw(fixture.root, {
          publicationRef: published.publicationRef,
          effectiveFrom,
          reasonCode: 'SCHEDULED_WITHDRAWAL',
        });
      } else {
        await basis.publish(fixture.root, {
          ...input(),
          payload: { ...request.payload, basisVersion: '2.0.0' },
          effectiveFrom,
          supersedesPublicationRef: published.publicationRef,
        });
      }
      clock = new Date(start);
      try {
        expect((await basis.resolve(fixture.service, selection)).useStatus).toBe('USABLE');
        onReadInstruction = () => {
          clock = new Date(start + 2000);
          return Promise.resolve();
        };
        const resolved = await basis.resolve(fixture.service, selection);
        expect(resolved.useStatus).toBe(expected);
        expect(resolved.checkedAt).toBe(new Date(start + 2000).toISOString());
      } finally {
        clock = undefined;
        onReadInstruction = undefined;
      }
    },
  );
  it('observes a withdrawal committed during source I/O rather than returning the earlier eligibility', async () => {
    const request = input();
    request.payload.basisCode += '.' + newUuidV7().replaceAll('-', '');
    const published = await basis.publish(fixture.root, request);
    await grant(request.basisId);
    const selection = {
      basisRef: published.basisRef,
      basisHash: published.basisHash,
      publicationRef: published.publicationRef,
    };
    onReadInstruction = async () => {
      onReadInstruction = undefined;
      await basis.withdraw(fixture.root, {
        publicationRef: published.publicationRef,
        effectiveFrom: new Date().toISOString(),
        reasonCode: 'WITHDRAWN_DURING_SOURCE_READ',
      });
    };
    try {
      const resolved = await basis.resolve(fixture.service, selection);
      expect(resolved.useStatus).toBe('WITHDRAWN');
    } finally {
      onReadInstruction = undefined;
    }
  });
  it('rejects when current authorization is lost after source observation and before return', async () => {
    const request = input();
    request.payload.basisCode += '.' + newUuidV7().replaceAll('-', '');
    const published = await basis.publish(fixture.root, request);
    await grant(request.basisId);
    const selection = {
      basisRef: published.basisRef,
      basisHash: published.basisHash,
      publicationRef: published.publicationRef,
    };
    let sourceRead = false;
    onReadInstruction = () => {
      sourceRead = true;
      return Promise.resolve();
    };
    onObservation = () => {
      expect(sourceRead).toBe(true);
      deny = true;
    };
    try {
      await expect(basis.resolve(fixture.service, selection)).rejects.toThrow(
        'AUTHORIZATION_DENIED',
      );
      expect(sourceRead).toBe(true);
    } finally {
      deny = false;
      onReadInstruction = undefined;
      onObservation = undefined;
    }
  });
  it('recovers a template preset publication from its actual original receipt without publishing again', async () => {
    const b = input();
    b.payload.basisVersion = '4.0.0';
    const publishedBasis = await basis.publish(fixture.root, b);
    const basisSelection = {
      basisRef: publishedBasis.basisRef,
      basisHash: publishedBasis.basisHash,
      publicationRef: publishedBasis.publicationRef,
    };
    const version = (objectType: string): Common.VersionedRef => ({
      kind: 'VERSIONED',
      objectType,
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: {},
    });
    const preset: TemplatePreparationPresetPayload = {
      profile: 'ep.preparation_entry@1.1',
      presetCode: 'zhiju.preparation.test.' + newUuidV7().replaceAll('-', ''),
      presetVersion: '1.0.0',
      creation: {
        mode: 'PREPARATION',
        status: 'PREPARING',
        enterpriseInitialStatus: 'ACTIVE',
        objective: 'Synthetic receipt recovery test',
        enterpriseCodePrefix: 'TESTENT',
        projectCodePrefix: 'TESTPRJ',
      },
      memberPolicyTemplate: {
        ref: version('identity.policy'),
        payloadHash: preparationHash({ fixture: 'membership' }),
      },
      intakePolicy: {
        ref: version('zhiju.integration.customer_zip_policy'),
        payloadHash: preparationHash({ fixture: 'intake' }),
      },
      analysisBasis: basisSelection,
      analysisHandoff: {
        intent: 'ANALYZE',
        analysisProfileRef: version('zhiju.task.analysis_profile'),
        expectedReportProfileRef: version('zhiju.project.report_profile'),
      },
    };
    const project = createPreparationProjectService({
      db: createEnterpriseProjectDatabase(fixture.epPool),
      identity,
      verifySession: (s) => {
        if (!samePreparationValue(s, fixture.root)) throw new Error('AUTHORIZATION_DENIED');
        return Promise.resolve();
      },
      authorize: (s, op, target, body) => identity.authorizeOperation(s, op, target, body),
      check: (proof, op, target, body) => identity.checkOperation(proof, op, target, body),
      selection: {} as PreparationEntrySelection,
      cursorKey: Buffer.alloc(32, 7),
      // This test exercises original publication recovery; other dependency owners have separate fixtures.
      validateDependencies: async () => {
        const resolved = await basis.resolve(fixture.root, basisSelection);
        return {
          templateRefs: resolved.payload.templateBindings.map((t) => t.templateRef),
          requirementRefs: [],
          sourceWatermarks: resolved.sourceWatermarks,
        };
      },
    });
    const request = {
      presetId: newUuidV7(),
      versionId: newUuidV7(),
      payload: preset,
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
    };
    expect(await project.readTemplatePresetPublication(fixture.root, request)).toBeNull();
    const first = await project.publishPreset(fixture.root, request);
    expect(await project.readTemplatePresetPublication(fixture.root, request)).toEqual(first);
    await expect(
      project.readTemplatePresetPublication(fixture.root, {
        ...request,
        effectiveFrom: new Date(Date.now() - 2000).toISOString(),
      }),
    ).rejects.toThrow('IDEMPOTENCY_PAYLOAD_CONFLICT');
    await expect(
      project.readTemplatePresetPublication(fixture.root, { ...request, presetId: newUuidV7() }),
    ).rejects.toThrow('IDEMPOTENCY_PAYLOAD_CONFLICT');
    const count = await fixture.admin.query(
      "SELECT count(*)::int AS n FROM enterprise_project.preparation_fact WHERE kind='PUBLICATION' AND payload->'preparationPresetRef'->>'versionId'=$1",
      [request.versionId],
    );
    expect(count.rows[0].n).toBe(1);
    deny = true;
    await expect(project.readTemplatePresetPublication(fixture.root, request)).rejects.toThrow(
      'AUTHORIZATION_DENIED',
    );
    deny = false;
  });
  it('does not publish corrupted bytes or bypass current authorization', async () => {
    const request = input();
    request.payload.basisVersion = '3.0.0';
    inputsChanged = true;
    await expect(basis.publish(fixture.root, request)).rejects.toThrow(
      'PREPARATION_ANALYSIS_SOURCE_HASH_MISMATCH',
    );
    inputsChanged = false;
    const rows = await fixture.admin.query(
      "SELECT count(*)::int AS n FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_BASIS' AND id=$1",
      [request.versionId],
    );
    expect(rows.rows[0].n).toBe(0);
    deny = true;
    await expect(basis.publish(fixture.root, request)).rejects.toThrow();
    deny = false;
  });
});
