import { createPreparationServiceSessions } from '../../apps/api/src/workspace/preparation-service-session.js';
import { readFileSync } from 'node:fs';
/* eslint-disable @typescript-eslint/require-await -- Controlled S3 transport returns asynchronous protocol responses without network IO. */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
  type Common,
  type PreparationSession,
  type PreparationEntrySelection,
  type PreparationPresetPayload,
  type TemplatePreparationPresetPayload,
  type PreparationAnalysisBasisPayload,
  type PreparationAnalysisRuntimePort,
  type WorkspaceCommandInput,
  type PreparationRequestPayload,
} from '@zhiju/contracts';
import {
  PREPARATION_CREATOR_BINDINGS,
  PREPARATION_ANALYSIS_CREATOR_BINDINGS,
  PREPARATION_ANALYSIS_SERVICE_BINDINGS,
  PREPARATION_SERVICE_V2_BINDINGS,
  PREPARATION_SERVICE_BINDINGS,
  PREPARATION_SERVICE_AUTHORITY_OPERATIONS,
  linkExternalIdentity,
  resolveVerifiedHuman,
  grantCapability,
  type VerifiedOidcContextInput,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type VerifiedHumanResolution,
} from '@zhiju/identity-policy';
import type { PreparationProjectConfig } from '@zhiju/enterprise-project';
import { createPreparationComposition } from '../../apps/api/src/composition/preparation-composition.js';
import {
  createCustomerZipS3ObjectStore,
  ZIP_LIMITS,
  type CustomerZipObjectStore,
} from '@zhiju/integration-gateway';
import { createPreparationCompanyFixture } from './preparation-company-fixture.js';
import {
  createFixtureCrypto,
  PROVIDER_CODE,
  CLIENT_ID,
  API_AUDIENCE,
  AZP,
} from './trusted-http-fixtures.js';
import type { WorkspaceVerifiedAccess } from '../../apps/api/src/workspace/controller.js';
export interface PreparationJourneyFixture {
  composition: ReturnType<typeof createPreparationComposition>;
  runtimeOptions: { preparation: ReturnType<typeof createPreparationComposition> };
  principalId: string;
  serviceSession: PreparationSession;
  analysisAudience: Common.ObjectRef;
  existingEnterpriseRef: Common.ObjectRef;
  existingEnterpriseName: string;
  presetSelection: PreparationEntrySelection;
  access: WorkspaceVerifiedAccess;
  human: VerifiedHumanResolution;
  run<T>(fn: (session: PreparationSession) => Promise<T>): Promise<T>;
  preparationCommand(
    customer: PreparationRequestPayload['customer'],
  ): Promise<WorkspaceCommandInput<PreparationRequestPayload>>;
  grantServiceProject(scope: { enterpriseId: string; projectId: string }): Promise<void>;
  relogin(): Promise<{ access: WorkspaceVerifiedAccess; human: VerifiedHumanResolution }>;
  crypto: IdentityCryptoPorts;
  objects: Map<string, { bytes: Buffer; hash: string }>;
  sourceEvents(projectId: string): Promise<unknown[]>;
  close(): Promise<void>;
}
function object(type: string, id: string, scope: Common.ScopeRef = {}): Common.ObjectRef {
  return { kind: 'OBJECT', objectType: type, objectId: id, scope };
}
export async function createPreparationJourneyFixture(
  databaseUrl: string,
  options: {
    issuer?: string;
    subject?: string;
    lookupKey?: Buffer;
    fieldKey?: Buffer;
    objectStore?: CustomerZipObjectStore;
    taskPort?: PreparationProjectConfig['taskPort'];
    analysisRuntime?: PreparationAnalysisRuntimePort;
    executionError?: (error: unknown) => void;
    clock?: () => Date;
    shortServiceSessions?: boolean;
  } = {},
): Promise<PreparationJourneyFixture> {
  // Full persistence runs share a database: each default fixture needs its own
  // external subject, while browser fixtures explicitly bind their OIDC subject.
  const subject = options.subject ?? `preparation-human-${newUuidV7()}`,
    issuer = options.issuer ?? 'https://preparation.example.test/realms/zhiju',
    crypto = createFixtureCrypto(
      options.lookupKey ?? Buffer.alloc(32, 0x11),
      options.fieldKey ?? Buffer.alloc(32, 0x22),
    );
  const company = await createPreparationCompanyFixture(databaseUrl, crypto);
  const ipPool = company.ipPool,
    epPool = company.epPool,
    integrationPool = new pg.Pool({
      connectionString: (ipPool.options as { connectionString: string }).connectionString,
      max: 12,
    });
  const humanId = company.root.principalId,
    serviceSession = company.service;
  await linkExternalIdentity(company.deps, {
    principalId: humanId,
    providerCode: PROVIDER_CODE,
    accountExternalId: issuer,
    subjectExternalId: subject,
    verifiedAt: new Date(),
    verificationMethod: 'CONTROLLED_REAL_OIDC_FIXTURE',
    evidenceRefs: { testProvenance: 'ISSUE291_REAL_OWNER_JOURNEY' },
    idempotencyKey: newUuidV7(),
  });
  const binding = randomBytes(32),
    issuedAt = new Date(),
    expiresAt = new Date(issuedAt.getTime() + 3600000);
  const context: VerifiedOidcContextInput = {
    trustConfigHash: 'a'.repeat(64),
    issuerConfigHash: 'b'.repeat(64),
    providerCode: PROVIDER_CODE,
    issuer,
    accountExternalId: issuer,
    subjectExternalId: subject,
    clientId: CLIENT_ID,
    apiAudience: API_AUDIENCE,
    azp: AZP,
    tokenSha256: createHash('sha256').update(randomBytes(32)).digest(),
    issuedAt,
    expiresAt,
    validatedAt: issuedAt,
    sessionBindingHash: createHash('sha256').update(binding).digest(),
  };
  const access = { context, sessionBinding: binding };
  const resolutionDeps = (access: { context: VerifiedOidcContextInput }): IdentityCommandDeps => ({
    ...company.deps,
    context: {
      ...company.deps.context,
      authorizationDecisionExpiresAt: new Date(access.context.expiresAt),
    },
  });
  const human = await resolveVerifiedHuman(resolutionDeps(access), context);
  expect(human.principalRef.objectId).toBe(humanId);
  const policyPayload = {
    profile: 'zip-intake-limits@1' as const,
    limits: ZIP_LIMITS,
    allowedFormats: ['DOCX', 'UTF8_MARKDOWN'] as const,
    rejectRules: [
      'MULTI_DISK',
      'ENCRYPTED',
      'UNSAFE_PATH',
      'LINK_OR_DEVICE',
      'PATH_COLLISION',
      'CRC_MISMATCH',
      'ZIP_BOMB',
    ] as const,
    retainOriginalBytes: true as const,
    noteIsUntrustedMaterial: true as const,
    extractorProfileRef: {
      ...object('zhiju.integration.customer_zip_extractor', newUuidV7()),
      kind: 'VERSIONED',
      versionId: newUuidV7(),
    },
  };
  const policyRef = {
      ...object('zhiju.integration.customer_zip_policy', newUuidV7()),
      kind: 'VERSIONED' as const,
      versionId: newUuidV7(),
    },
    policyHash = preparationHash(policyPayload);
  const selection = {} as PreparationEntrySelection;
  const creatorBindings = options.analysisRuntime
    ? PREPARATION_ANALYSIS_CREATOR_BINDINGS
    : PREPARATION_CREATOR_BINDINGS;
  const capabilityCodes = Object.fromEntries(
    [
      ...creatorBindings,
      ...PREPARATION_SERVICE_BINDINGS,
      ...(options.analysisRuntime ? PREPARATION_ANALYSIS_SERVICE_BINDINGS : []),
    ].map(([operation]) => [operation, 'preparation291.' + operation.replaceAll('.', '_')]),
  );
  if (options.analysisRuntime)
    for (const [operation] of PREPARATION_SERVICE_V2_BINDINGS)
      capabilityCodes[operation + '@2.0'] =
        'preparation291.' + operation.replaceAll('.', '_') + '_v2';
  const instructions = Buffer.from(
    'Controlled company instructions for preparation pipeline tests.',
  );
  const instructionHash = createHash('sha256').update(instructions).digest('hex');
  const objects = new Map<string, { bytes: Buffer; hash: string }>();
  const objectStore =
    options.objectStore ??
    createCustomerZipS3ObjectStore({
      endpoint: 'https://controlled-s3.example.test',
      bucket: 'preparation-customer-materials',
      region: 'controlled-1',
      accessKeyId: 'CONTROLLED_TEST_ONLY',
      secretAccessKey: 'controlled-test-only',
      fetch: async (url, init) => {
        if (!(url instanceof URL)) throw new Error('Expected fixed S3 URL');
        const key = url.pathname;
        const headers = new Headers(init?.headers);
        if (init?.method === 'PUT') {
          if (headers.get('if-none-match') !== '*' || !Buffer.isBuffer(init.body))
            return new Response(null, { status: 400 });
          if (objects.has(key)) return new Response(null, { status: 412 });
          const bytes = Buffer.from(init.body);
          objects.set(key, { bytes, hash: createHash('sha256').update(bytes).digest('hex') });
          return new Response(null, { status: 200 });
        }
        const object = objects.get(key);
        if (!object) return new Response(null, { status: 404 });
        return new Response(init?.method === 'HEAD' ? null : object.bytes, {
          headers: {
            'content-length': String(object.bytes.length),
            'x-amz-meta-sha256': object.hash,
          },
        });
      },
    });
  const shortSessions = options.shortServiceSessions
    ? createPreparationServiceSessions(serviceSession.principalId, options.clock)
    : undefined;
  const composition = createPreparationComposition({
    identityPool: ipPool,
    enterprisePool: epPool,
    integrationPool,
    crypto,
    grantAdministrators: [humanId],
    administratorPolicySnapshotRef: company.policyRef,
    serviceSession: () => Promise.resolve(shortSessions?.current() ?? serviceSession),
    ...(shortSessions
      ? {
          verifyServiceSession: async (session: PreparationSession) => {
            shortSessions.verify(session);
          },
        }
      : {}),
    servicePrincipalIds: [serviceSession.principalId],
    enterpriseCapabilities: {
      select: 'preparation291.enterprise.select',
      create: 'preparation291.enterprise.create',
    },
    capabilityCodes,
    ...(options.clock ? { clock: options.clock } : {}),
    selection,
    cursorKey: Buffer.alloc(32, 0x31),
    ticket: {
      activeKeyId: 'controlled-journey',
      keys: new Map([['controlled-journey', Buffer.alloc(32, 0x41)]]),
    },
    policies: [{ policyRef, payloadHash: policyHash, payload: policyPayload }],
    companyRules: company.companyRules,
    identityResolutionDeps: resolutionDeps,
    objectStore,
    analysisAudience: object('identity.principal', serviceSession.principalId),
    ...(options.taskPort ? { taskPort: options.taskPort } : {}),
    ...(options.analysisRuntime
      ? {
          analysisRuntime: options.analysisRuntime,
          executionError: options.executionError,
          analysisBasis: {
            sources: {
              readTemplate: (ref) => company.analysisTemplateSources.read(ref),
              locate: (bytes, locator) => company.analysisTemplateSources.locate(bytes, locator),
              readInstruction: async (hash: string) => {
                if (hash !== instructionHash) throw new Error('SOURCE_MISSING');
                return instructions;
              },
            },
            validateDefinition: () => undefined,
          },
        }
      : {}),
  });
  const run = <T>(fn: (session: PreparationSession) => Promise<T>) =>
    composition.run(access, human, fn);
  const presetId = newUuidV7(),
    presetVersionId = newUuidV7();
  const template = await run((session) =>
    composition.identity.publishMembershipTemplate(session, {
      templateId: newUuidV7(),
      versionId: newUuidV7(),
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
      payload: {
        profile: options.analysisRuntime
          ? 'ip.preparation_membership_template@1.1'
          : 'ip.preparation_membership_template@1.0',
        templateCode: 'CONTROLLED_PREPARATION_' + newUuidV7().replaceAll('-', ''),
        templateVersion: '1.0.0',
        creatorBindings: creatorBindings
          .map(([operation, purpose, action, targetObjectType]) => ({
            operation,
            version: '1.0' as const,
            purpose,
            action,
            targetObjectType,
            capabilityCode: capabilityCodes[operation] ?? 'missing',
          }))
          .sort((a, b) => a.operation.localeCompare(b.operation)),
        grantPolicySnapshotRef: company.policyRef,
        maxGrantLifetimeSeconds: 3600,
      },
    }),
  );
  await run((session) =>
    composition.identity.grantAuthority(session, {
      grantId: newUuidV7(),
      principalRef: object('identity.principal', serviceSession.principalId),
      operation: 'identity.preparation.membership_template.read',
      target: object('identity.policy', template.templateRef.objectId),
      policySnapshotRef: company.policyRef,
      effectivePeriod: {
        from: new Date(Date.now() - 1000).toISOString(),
        to: expiresAt.toISOString(),
      },
    }),
  );
  let presetPayload: PreparationPresetPayload | TemplatePreparationPresetPayload = {
    profile: 'ep.preparation_entry@1.0',
    presetCode: 'zhiju.preparation.controlled.' + presetId.replaceAll('-', ''),
    presetVersion: '1.0.0',
    creation: {
      mode: 'PREPARATION',
      status: 'PREPARING',
      enterpriseInitialStatus: 'ACTIVE',
      objective: 'Evaluate customer preparation materials',
      enterpriseCodePrefix: 'PREPENT',
      projectCodePrefix: 'PREPPRJ',
    },
    memberPolicyTemplate: { ref: template.templateRef, payloadHash: template.templateHash },
    intakePolicy: { ref: policyRef, payloadHash: policyHash },
    companyRules: company.companyRuleRefs,
    analysisHandoff: {
      intent: 'ANALYZE',
      analysisProfileRef: {
        ...object('zhiju.task.analysis_profile', newUuidV7()),
        kind: 'VERSIONED',
        versionId: newUuidV7(),
      },
      expectedReportProfileRef: {
        ...object('zhiju.project.report_profile', newUuidV7()),
        kind: 'VERSIONED',
        versionId: newUuidV7(),
      },
    },
  };
  if (options.analysisRuntime) {
    const payload = JSON.parse(
      readFileSync(
        new URL('../fixtures/contracts/template-preparation/basis.payload.json', import.meta.url),
        'utf8',
      ),
    ) as PreparationAnalysisBasisPayload;
    const template = company.analysisTemplates.find((t) => t.templateCode === 'S1');
    if (!template) throw new Error('Template fixture missing');
    payload.reportSchemaSha256 = RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256;
    payload.basisCode = 'analysis.test.' + newUuidV7().replaceAll('-', '');
    payload.templateBindings = [template];
    payload.instructionBindings = [
      { sourceId: 'instructions', bytesSha256: instructionHash, byteLength: instructions.length },
    ];
    payload.requirementBindings = [
      { requirementCode: 'zhiju.requirement.scope', templateCode: 'S1', locator: '1.2/4.3.3' },
    ];
    const basisId = newUuidV7();
    const analysisBasis = composition.analysisBasis;
    if (!analysisBasis) throw new Error('Analysis basis missing');
    const basis = await run((session) =>
      analysisBasis.publish(session, {
        basisId,
        versionId: newUuidV7(),
        payload,
        effectiveFrom: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    await run((session) =>
      composition.identity.grantAuthority(session, {
        grantId: newUuidV7(),
        principalRef: object('identity.principal', serviceSession.principalId),
        operation: 'project.preparation.analysis_basis.read',
        target: object('zhiju.project.preparation_analysis_basis', basisId),
        policySnapshotRef: company.policyRef,
        effectivePeriod: {
          from: new Date(Date.now() - 1000).toISOString(),
          to: expiresAt.toISOString(),
        },
      }),
    );
    const base = {
      presetCode: presetPayload.presetCode,
      presetVersion: presetPayload.presetVersion,
      creation: presetPayload.creation,
      memberPolicyTemplate: presetPayload.memberPolicyTemplate,
      intakePolicy: presetPayload.intakePolicy,
      analysisHandoff: presetPayload.analysisHandoff,
    };
    presetPayload = {
      ...base,
      profile: 'ep.preparation_entry@1.1',
      analysisBasis: {
        basisRef: basis.basisRef,
        basisHash: basis.basisHash,
        publicationRef: basis.publicationRef,
      },
    };
  }
  const published = await run((session) =>
    composition.project.publishPreset(session, {
      presetId,
      versionId: presetVersionId,
      payload: presetPayload,
      effectiveFrom: new Date(Date.now() - 1000).toISOString(),
    }),
  );
  Object.assign(selection, {
    preparationPresetRef: published.preparationPresetRef,
    preparationPresetHash: published.preparationPresetHash,
    publicationRef: published.publicationRef,
  });
  for (const principal of [serviceSession.principalId])
    await run((session) =>
      composition.identity.grantAuthority(session, {
        grantId: newUuidV7(),
        principalRef: object('identity.principal', principal),
        operation: 'project.preparation.preset.read',
        target: object('zhiju.project.preparation_preset', presetId),
        policySnapshotRef: company.policyRef,
        effectivePeriod: {
          from: new Date(Date.now() - 1000).toISOString(),
          to: expiresAt.toISOString(),
        },
      }),
    );
  for (const operation of [
    ...PREPARATION_SERVICE_AUTHORITY_OPERATIONS,
    ...(options.analysisRuntime
      ? (['project.preparation.source_v2.capture', 'project.preparation.source_v2.read'] as const)
      : []),
  ]) {
    if (
      operation === 'identity.preparation.membership_template.read' ||
      operation === 'project.preparation.preset.read'
    )
      continue;
    await run((session) =>
      composition.identity.grantAuthority(session, {
        grantId: newUuidV7(),
        principalRef: object('identity.principal', serviceSession.principalId),
        operation,
        target: object('zhiju.project.preparation_preset', presetId),
        policySnapshotRef: company.policyRef,
        effectivePeriod: {
          from: new Date(Date.now() - 1000).toISOString(),
          to: expiresAt.toISOString(),
        },
      }),
    );
  }
  await run((session) =>
    composition.identity.grantEnrollment(session, {
      grantId: newUuidV7(),
      principalRef: object('identity.principal', humanId),
      allowedModes: ['NEW', 'EXISTING'],
      preparationPresetRef: published.preparationPresetRef,
      preparationPresetHash: published.preparationPresetHash,
      membershipTemplateRef: template.templateRef,
      membershipTemplateHash: template.templateHash,
      policySnapshotRef: company.policyRef,
      effectivePeriod: {
        from: new Date(Date.now() - 1000).toISOString(),
        to: expiresAt.toISOString(),
      },
      maxUses: 30,
    }),
  );
  async function grantServiceProject(scope: { enterpriseId: string; projectId: string }) {
    for (const [operation, , action, type] of [
      ...PREPARATION_SERVICE_BINDINGS,
      ...(options.analysisRuntime
        ? [...PREPARATION_ANALYSIS_SERVICE_BINDINGS, ...PREPARATION_SERVICE_V2_BINDINGS]
        : []),
    ]) {
      const d: IdentityCommandDeps = {
        ...company.deps,
        context: {
          ...company.deps.context,
          enterpriseId: scope.enterpriseId,
          allowedProjectIds: [scope.projectId],
        },
      };
      const granted = await grantCapability(d, {
        grantId: newUuidV7(),
        principalId: serviceSession.principalId,
        capabilityCode:
          capabilityCodes[action.endsWith('.v2') ? operation + '@2.0' : operation] ?? 'missing',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: scope.enterpriseId,
          projectId: scope.projectId,
        },
        resourceSelectors: [
          {
            selectorType: ['project.register_source_material'].includes(operation)
              ? 'CREATE_TARGET_TYPE'
              : 'TARGET_TYPE',
            objectType: type,
          },
        ],
        actions: [action],
        validFrom: new Date(Date.now() - 1000),
        validTo: expiresAt,
        grantPolicySnapshotId: company.policyRef.snapshotId,
        grantPolicySnapshotHash: Buffer.from(company.policyRef.contentHash.digest, 'hex'),
        justification: 'ISSUE291 explicit controlled service deployment',
        idempotencyKey: newUuidV7(),
      });
      expect(granted.status).toBe('COMMITTED');
    }
  }
  async function preparationCommand(customer: PreparationRequestPayload['customer']) {
    const enterpriseId = customer.mode === 'NEW' ? newUuidV7() : customer.enterpriseRef.objectId,
      projectId = newUuidV7(),
      scope = { enterpriseId, projectId },
      requestRef = object('zhiju.project.preparation_request', newUuidV7(), scope),
      payload: PreparationRequestPayload = {
        customer,
        projectTitle: 'Customer preparation project',
        preparationPresetRef: selection.preparationPresetRef,
        preparationPresetHash: selection.preparationPresetHash,
      };

    const command: WorkspaceCommandInput<PreparationRequestPayload> = {
      commandId: newUuidV7(),
      type: 'project.request_project_preparation',
      version: '1.0',
      scopeRef: scope,
      targetRef: requestRef,
      idempotencyKey: `project.request_project_preparation:1.0:${requestRef.objectId}`,
      correlationId: newUuidV7(),
      requestedAt: new Date().toISOString(),
      payload,
      integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
    };
    return command;
  }
  const seedCommand = await preparationCommand({
      mode: 'NEW',
      displayName: 'Existing preparation customer',
    }),
    seed = await run((session) => composition.project.request(session, seedCommand));
  if (seed.disposition !== 'ACCEPTED') throw new Error('Preparation seed provisioning incomplete');
  const existingEnterpriseRef = object(
    'zhiju.project.enterprise',
    seedCommand.scopeRef.enterpriseId,
    { enterpriseId: seedCommand.scopeRef.enterpriseId },
  );
  for (const [code, action] of [
    ['preparation291.enterprise.select', 'project.find_preparation_enterprises.v1'],
    ['preparation291.enterprise.create', 'project.create_project.v1'],
  ] as const) {
    const d = {
      ...company.deps,
      context: {
        ...company.deps.context,
        enterpriseId: existingEnterpriseRef.objectId,
        allowedProjectIds: [],
      },
    };
    const granted = await grantCapability(d, {
      grantId: newUuidV7(),
      principalId: humanId,
      capabilityCode: code,
      scope: { scopeKind: 'ENTERPRISE', enterpriseId: existingEnterpriseRef.objectId },
      resourceSelectors: [{ selectorType: 'TARGET_TYPE', objectType: 'zhiju.project.enterprise' }],
      actions: [action],
      validFrom: new Date(Date.now() - 1000),
      validTo: expiresAt,
      grantPolicySnapshotId: company.policyRef.snapshotId,
      grantPolicySnapshotHash: Buffer.from(company.policyRef.contentHash.digest, 'hex'),
      justification: 'ISSUE291 explicit existing-customer admission',
      idempotencyKey: newUuidV7(),
    });
    expect(granted.status).toBe('COMMITTED');
  }
  async function relogin() {
    const binding = randomBytes(32),
      time = new Date(),
      nextContext = {
        ...context,
        tokenSha256: createHash('sha256').update(randomBytes(32)).digest(),
        issuedAt: time,
        validatedAt: time,
        expiresAt: new Date(time.getTime() + 3600000),
        sessionBindingHash: createHash('sha256').update(binding).digest(),
      };
    const access = { context: nextContext, sessionBinding: binding };
    return { access, human: await resolveVerifiedHuman(resolutionDeps(access), nextContext) };
  }
  return {
    composition,
    relogin,
    runtimeOptions: { preparation: composition },
    principalId: humanId,
    serviceSession,
    analysisAudience: object('identity.principal', serviceSession.principalId),
    existingEnterpriseRef,
    existingEnterpriseName: 'Existing preparation customer',
    presetSelection: selection,
    access,
    human,
    run,
    preparationCommand,
    grantServiceProject,
    crypto,
    objects,
    sourceEvents: async (projectId: string) =>
      (
        await company.admin.query<{ payload: unknown }>(
          "SELECT payload FROM enterprise_project.outbox_event WHERE project_id=$1 AND event_type='project.SourceMaterialAccepted' ORDER BY recorded_at",
          [projectId],
        )
      ).rows.map((row) => row.payload),
    close: async () => {
      await composition.close();
      await integrationPool.end();
      await company.close();
    },
  };
}
