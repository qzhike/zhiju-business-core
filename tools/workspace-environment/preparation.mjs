import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  samePreparationValue,
  RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
} from '@zhiju/contracts';
import {
  IdentityPolicyRepository,
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  recordPolicySnapshot,
  createActorSnapshot,
  grantCapability,
  authorizeCommand,
  createPreparationIdentityDatabase,
  createPreparationIdentityPort,
  PREPARATION_ANALYSIS_CREATOR_BINDINGS,
  PREPARATION_SERVICE_BINDINGS,
  PREPARATION_ANALYSIS_SERVICE_BINDINGS,
  PREPARATION_SERVICE_V2_BINDINGS,
  PREPARATION_SERVICE_AUTHORITY_OPERATIONS,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  withEnterpriseProjectPlatformTransaction,
  handlePlatformTemplateImportVersion,
  handlePlatformTemplatePublishVersion,
  createPreparationAnalysisBasisService,
  createPreparationProjectService,
} from '@zhiju/enterprise-project';
import {
  createPreparationCompanyFileStore,
  createCustomerZipPolicyRegistry,
  ZIP_LIMITS,
} from '@zhiju/integration-gateway';
import { identityCrypto } from './bootstrap.mjs';
import { readCompanyMaterials, bytesHash } from './company-materials.mjs';
import { writePrivateJson } from './config.mjs';
import { databaseUrl } from './deployment.mjs';
import { initializeRunnerProfile } from './runner-profile.mjs';
import { initializePreparationObjectStore } from './object-store.mjs';

const PLATFORM = '00000000-0000-7000-8000-000000000000';
const object = (objectType, objectId) => ({ kind: 'OBJECT', objectType, objectId, scope: {} });
const version = (objectType) => ({
  ...object(objectType, newUuidV7()),
  kind: 'VERSIONED',
  versionId: newUuidV7(),
});
const hash = (digest) => ({ algorithm: 'SHA-256', digest, canonicalizationVersion: '1' });
function committed(result) {
  if (
    result.status !== 'COMMITTED' &&
    !(result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED')
  )
    throw new Error('ENV_B_PREPARATION_INITIALIZATION_REJECTED');
}
async function json(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

/** Operator installation uses owner APIs; no project/customer facts are seeded. */
export async function initializePreparation(config, secrets, identities) {
  const localOmp = await initializeRunnerProfile(config);
  const materials = await readCompanyMaterials(config.runner.projectRoot);
  const filename = join(config.dataDir, 'preparation-installation.json');
  const materialFingerprint = preparationHash({
    instructionHash: materials.instructionHash,
    templates: materials.templates.map((t) => ({
      code: t.code,
      hash: t.bytesSha256,
      locators: t.locators,
    })),
    vocabulary: materials.vocabulary,
    requirementBindings: materials.requirementBindings,
    reportSchemaSha256: RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
  });
  let installation;
  try {
    installation = await json(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    installation = {
      version: 1,
      instanceId: config.instanceId,
      materialFingerprint,
      installedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      policyId: newUuidV7(),
      platformGrantId: newUuidV7(),
      membership: version('identity.policy'),
      preset: version('zhiju.project.preparation_preset'),
      basis: version('zhiju.project.preparation_analysis_basis'),
      analysisProfile: version('zhiju.task.analysis_profile'),
      reportProfile: version('zhiju.project.report_profile'),
      zipPolicy: version('zhiju.integration.customer_zip_policy'),
      extractor: version('zhiju.integration.customer_zip_extractor'),
      enrollmentId: newUuidV7(),
      grantIds: {},
      templates: materials.templates.map((t) => ({
        code: t.code,
        id: newUuidV7(),
        versionId: newUuidV7(),
        documentId: newUuidV7(),
        importId: newUuidV7(),
        publishId: newUuidV7(),
      })),
    };
    await writePrivateJson(filename, installation, true);
  }
  if (
    installation.version !== 1 ||
    installation.instanceId !== config.instanceId ||
    !samePreparationValue(installation.materialFingerprint, materialFingerprint)
  )
    throw new Error('ENV_B_PREPARATION_MATERIAL_CHANGED');
  if (Date.parse(installation.expiresAt) <= Date.now())
    throw new Error('ENV_B_PREPARATION_GRANTS_EXPIRED');
  if (!installation.analysisExtension) {
    installation.analysisExtension = {
      membershipVersionId: newUuidV7(),
      presetVersionId: newUuidV7(),
      enrollmentId: newUuidV7(),
    };
    await writePrivateJson(filename, installation);
  }
  const localFiles = await initializePreparationObjectStore(config);
  const store = createPreparationCompanyFileStore(localFiles);
  const companySources = materials.templates.map((t) => ({
    sha256: t.bytesSha256,
    objectKey: 'company-source/' + t.bytesSha256,
    locators: t.locators,
  }));
  companySources.push({
    sha256: materials.instructionHash,
    objectKey: 'company-source/' + materials.instructionHash,
    locators: [],
  });
  for (const t of materials.templates) await store.put('company-source/' + t.bytesSha256, t.bytes);
  await store.put('company-source/' + materials.instructionHash, materials.instructions);
  const pool = new pg.Pool({
    connectionString: databaseUrl(config, secrets.operatorDatabasePassword, 'env_b_operator'),
    max: 12,
  });
  const ipDb = createIdentityPolicyDatabase(pool),
    epDb = createEnterpriseProjectDatabase(pool),
    crypto = identityCrypto(secrets);
  const session = {
    principalId: identities.humanId,
    authenticationContextHash: preparationHash({
      instanceId: config.instanceId,
      operator: 'LOCAL_DEPLOYMENT',
      nonce: randomBytes(32).toString('hex'),
    }),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
  const service = {
    principalId: identities.boardServiceId,
    authenticationContextHash: preparationHash({
      instanceId: config.instanceId,
      service: 'PREPARATION_INSTALLATION',
      nonce: randomBytes(32).toString('hex'),
    }),
    expiresAt: session.expiresAt,
  };
  const context = {
    kind: 'REQUEST',
    principalId: session.principalId,
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.from(session.authenticationContextHash.digest, 'hex'),
    authorizationDecisionExpiresAt: new Date(session.expiresAt),
    enterpriseId: PLATFORM,
    allowedProjectIds: [],
    correlationId: newUuidV7(),
  };
  const repo = new IdentityPolicyRepository(crypto),
    deps = { db: ipDb, repo, crypto, context };
  const effectivePeriod = { from: installation.installedAt, to: installation.expiresAt };
  const capabilityCodes = Object.fromEntries(
    [
      ...PREPARATION_ANALYSIS_CREATOR_BINDINGS,
      ...PREPARATION_SERVICE_BINDINGS,
      ...PREPARATION_ANALYSIS_SERVICE_BINDINGS,
    ].map(([op]) => [op, 'workspace.preparation.' + op.replaceAll('.', '_')]),
  );
  for (const [op] of PREPARATION_SERVICE_V2_BINDINGS)
    capabilityCodes[op + '@2.0'] = 'workspace.preparation.' + op.replaceAll('.', '_') + '_v2';
  try {
    committed(
      await recordPolicySnapshot(deps, {
        policySnapshotId: installation.policyId,
        policySetVersion: 'workspace-preparation:' + installation.policyId,
        policySchemaRefs: ['identity.CapabilityPolicy@1.0'],
        effectiveFrom: new Date(installation.installedAt),
        policyDocument: {
          deployment: 'MACOS_MANUAL_TEST',
          instanceId: config.instanceId,
          purpose: 'template.preparation.analysis',
          materialFingerprint,
        },
        idempotencyKey: installation.policyId,
      }),
    );
    const policy = await withIdentityTransaction(ipDb, context, (trx) =>
      repo.getPolicySnapshotById(trx, installation.policyId),
    );
    if (!policy) throw new Error('ENV_B_PREPARATION_POLICY_MISSING');
    const policyRef = {
      ...object('identity.policy_snapshot', installation.policyId),
      kind: 'SNAPSHOT',
      snapshotId: installation.policyId,
      contentHash: hash(policy.payload_hash.toString('hex')),
    };
    committed(
      await grantCapability(deps, {
        grantId: installation.platformGrantId,
        principalId: session.principalId,
        capabilityCode: 'workspace.company_templates.publish',
        scope: { scopeKind: 'ENTERPRISE', enterpriseId: PLATFORM },
        resourceSelectors: [],
        actions: ['IMPORT', 'PUBLISH'],
        validFrom: new Date(installation.installedAt),
        validTo: new Date(installation.expiresAt),
        grantPolicySnapshotId: installation.policyId,
        grantPolicySnapshotHash: policy.payload_hash,
        justification: 'Operator installation of the approved company template analysis basis',
        idempotencyKey: installation.platformGrantId,
      }),
    );
    const actor = await createActorSnapshot(deps, {
      actorSnapshotId: context.actorSnapshotId,
      principalId: session.principalId,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: Buffer.from(session.authenticationContextHash.digest, 'hex'),
      scopeKind: 'ENTERPRISE',
      enterpriseId: PLATFORM,
    });
    async function templateCommand(operation, id, commandId, payload, publish = false) {
      const decision = await authorizeCommand(deps, {
        actorSnapshotRef: actor,
        authenticationContextHash: Buffer.from(session.authenticationContextHash.digest, 'hex'),
        policySnapshotRef: policyRef,
        intent: {
          commandType: operation,
          commandVersion: '1.0',
          scopeKind: 'ENTERPRISE',
          enterpriseId: PLATFORM,
          purpose: operation,
          requestedCapability: 'workspace.company_templates.publish',
          commandPayloadHash: Buffer.from(preparationHash(payload).digest, 'hex'),
          requestedAt: new Date(),
          highRiskAction: true,
        },
      });
      if (decision.outcome !== 'ALLOW') throw new Error('ENV_B_PREPARATION_AUTHORIZATION_DENIED');
      const ctx = {
        ...context,
        principalKind: 'HUMAN',
        actorSnapshotId: actor.snapshotId,
        authorizationDecisionId: decision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          decision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(decision.expiresAt),
        policySnapshotId: installation.policyId,
        platformReferenceCapabilities: ['PLATFORM_REFERENCE_ADMIN', 'PLATFORM_REFERENCE_PUBLISHER'],
      };
      return {
        ctx,
        envelope: {
          commandId,
          commandType: operation,
          commandVersion: '1.0',
          idempotencyScope: 'workspace.environment_b.company',
          idempotencyKey: commandId,
          requestPayload: { operation, payload },
          platform: true,
          enterpriseId: PLATFORM,
          targetType: 'ReferenceTemplate',
          targetId: id,
          correlationId: context.correlationId,
          principalId: session.principalId,
          principalKind: 'HUMAN',
          actorSnapshotId: actor.snapshotId,
          authorizationDecisionId: ctx.authorizationDecisionId,
          policySnapshotId: installation.policyId,
          ...(publish ? { expectedAggregateVersion: '1' } : {}),
        },
        decisionRef: decision.authorizationDecisionRef,
      };
    }
    const templateBindings = [];
    for (const t of materials.templates) {
      const ids = installation.templates.find((item) => item.code === t.code);
      if (!ids) throw new Error('ENV_B_PREPARATION_INSTALLATION_INVALID');
      const contentHash = hash(t.bytesSha256);
      const payload = {
        referenceTemplateId: ids.id,
        referenceCode: t.code,
        templateType: t.code === 'S1' ? 'QUALITY_MANUAL' : 'CONTROL_PROCEDURE',
        versionId: ids.versionId,
        versionLabel: t.versionLabel,
        contentRef: {
          ...object('TemplateDocument', ids.documentId),
          kind: 'CONTENT_ADDRESSED',
          contentHash,
        },
        contentHash,
        sourceRef: { sourceBytesSha256: t.bytesSha256, relativePath: t.path },
        applicability: {
          basis: 'COMPANY_TEMPLATE',
          supportedRange: 'CN_ACTIVE_DEVICE_QMS_UPGRADE',
        },
      };
      const imported = await templateCommand(
        'enterprise_project.platform_template_import_version',
        ids.id,
        ids.importId,
        payload,
      );
      committed(
        await handlePlatformTemplateImportVersion(epDb, imported.ctx, {
          ...imported.envelope,
          payload,
        }),
      );
      const existing = await withEnterpriseProjectPlatformTransaction(epDb, imported.ctx, (trx) =>
        trx
          .selectFrom('enterprise_project.reference_template_version')
          .selectAll()
          .where('reference_template_version_id', '=', ids.versionId)
          .executeTakeFirst(),
      );
      if (!existing || existing.content_hash.toString('hex') !== t.bytesSha256)
        throw new Error('ENV_B_PREPARATION_TEMPLATE_MISMATCH');
      if (existing.lifecycle !== 'PUBLISHED') {
        const pub = {
          referenceTemplateId: ids.id,
          versionId: ids.versionId,
          publishReason: { purpose: 'Install approved company template analysis basis' },
        };
        const published = await templateCommand(
          'enterprise_project.platform_template_publish_version',
          ids.id,
          ids.publishId,
          pub,
          true,
        );
        committed(
          await handlePlatformTemplatePublishVersion(epDb, published.ctx, {
            ...published.envelope,
            payload: { ...pub, releaseDecisionRef: published.decisionRef },
          }),
        );
      }
      templateBindings.push({
        templateCode: t.code,
        templateRef: {
          ...object('TemplateVersion', ids.id),
          kind: 'CONTENT_ADDRESSED',
          immutableVersionId: ids.versionId,
          contentHash,
        },
        sourceBytesSha256: t.bytesSha256,
      });
    }
    const identity = createPreparationIdentityPort({
      db: createPreparationIdentityDatabase(pool),
      grantAdministrators: [session.principalId],
      administratorPolicySnapshotRef: policyRef,
      servicePrincipalIds: [service.principalId],
      enterpriseCapabilities: {
        select: 'workspace.preparation.enterprise_select',
        create: 'workspace.preparation.enterprise_create',
      },
      verifySession: async (current) => {
        if (
          ![session, service].some((s) => samePreparationValue(s, current)) ||
          Date.parse(current.expiresAt) <= Date.now()
        )
          throw new Error('ENV_B_OPERATOR_SESSION_EXPIRED');
      },
    });
    const authorize = (s, op, target, input) => identity.authorizeOperation(s, op, target, input);
    const check = (p, op, target, input) => identity.checkOperation(p, op, target, input);
    const sources = {
      readTemplate: async (ref) => store.read('company-source/' + ref.contentHash.digest),
      readInstruction: async (sha) => store.read('company-source/' + sha),
      locate: async (bytes, locator) => {
        const t = materials.templates.find((item) => item.bytesSha256 === bytesHash(bytes));
        const loc = t?.locators.find((item) => item.locator === locator);
        return loc ? [bytes.subarray(loc.offset, loc.offset + loc.byteLength)] : [];
      },
    };
    const basis = createPreparationAnalysisBasisService({
      db: epDb,
      authorize,
      check,
      sources,
      validateDefinition: (payload) => {
        if (
          !samePreparationValue(payload.vocabulary, materials.vocabulary) ||
          !samePreparationValue(payload.requirementBindings, materials.requirementBindings) ||
          payload.reportSchemaSha256 !== RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256
        )
          throw new Error('ENV_B_ANALYSIS_DEFINITION_MISMATCH');
      },
    });
    const basisPayload = {
      profile: 'ep.preparation_analysis_basis@1.0',
      basisCode: 'zhiju.analysis.cn_active_device_qms_upgrade',
      basisVersion: '1.0.0',
      purpose: 'preparation.analysis',
      supportedRange:
        '中国大陆有源、非无菌、非植入医疗器械硬件体系的模板比对分析；范围由客户材料确认，未知或超出范围必须列明。',
      templateBindings: templateBindings.sort((a, b) =>
        a.templateCode.localeCompare(b.templateCode, 'en'),
      ),
      instructionBindings: [
        {
          sourceId: 'company-instructions',
          bytesSha256: materials.instructionHash,
          byteLength: materials.instructions.length,
        },
      ],
      vocabulary: materials.vocabulary,
      requirementBindings: materials.requirementBindings,
      reportProfile: 'd14.analysis@1',
      reportSchemaSha256: RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
    };
    const publishedBasis = await basis.publish(session, {
      basisId: installation.basis.objectId,
      versionId: installation.basis.versionId,
      payload: basisPayload,
      effectiveFrom: installation.installedAt,
    });
    const analysisBasis = {
      basisRef: publishedBasis.basisRef,
      basisHash: publishedBasis.basisHash,
      publicationRef: publishedBasis.publicationRef,
    };
    async function authority(operation, target) {
      const key = operation + ':' + target.objectId;
      if (!installation.grantIds[key]) {
        installation.grantIds[key] = newUuidV7();
        await writePrivateJson(filename, installation);
      }
      await identity.grantAuthority(session, {
        grantId: installation.grantIds[key],
        principalRef: object('identity.principal', service.principalId),
        operation,
        target,
        policySnapshotRef: policyRef,
        effectivePeriod,
      });
    }
    await authority(
      'project.preparation.analysis_basis.read',
      object('zhiju.project.preparation_analysis_basis', installation.basis.objectId),
    );
    const membership = await identity.publishMembershipTemplate(session, {
      templateId: installation.membership.objectId,
      versionId: installation.analysisExtension.membershipVersionId,
      effectiveFrom: installation.installedAt,
      payload: {
        profile: 'ip.preparation_membership_template@1.1',
        templateCode: 'WORKSPACE_TEMPLATE_ANALYSIS',
        templateVersion: '1.1.0',
        creatorBindings: PREPARATION_ANALYSIS_CREATOR_BINDINGS.map(
          ([operation, purpose, action, targetObjectType]) => ({
            operation,
            version: '1.0',
            purpose,
            action,
            targetObjectType,
            capabilityCode: capabilityCodes[operation],
          }),
        ).sort((a, b) => a.operation.localeCompare(b.operation)),
        grantPolicySnapshotRef: policyRef,
        maxGrantLifetimeSeconds: 365 * 86400,
      },
    });
    await authority(
      'identity.preparation.membership_template.read',
      object('identity.policy', installation.membership.objectId),
    );
    const policyPayload = {
      profile: 'zip-intake-limits@1',
      limits: ZIP_LIMITS,
      allowedFormats: ['DOCX', 'UTF8_MARKDOWN'],
      rejectRules: [
        'MULTI_DISK',
        'ENCRYPTED',
        'UNSAFE_PATH',
        'LINK_OR_DEVICE',
        'PATH_COLLISION',
        'CRC_MISMATCH',
        'ZIP_BOMB',
      ],
      retainOriginalBytes: true,
      noteIsUntrustedMaterial: true,
      extractorProfileRef: installation.extractor,
    };
    const policies = [
      {
        policyRef: installation.zipPolicy,
        payloadHash: preparationHash(policyPayload),
        payload: policyPayload,
      },
    ];
    const policyRegistry = createCustomerZipPolicyRegistry(policies);
    const project = createPreparationProjectService({
      db: epDb,
      identity,
      verifySession: async (s) => {
        if (![session, service].some((x) => samePreparationValue(x, s)))
          throw new Error('ENV_B_OPERATOR_SESSION_EXPIRED');
      },
      authorize,
      check,
      selection: {},
      cursorKey: Buffer.from(secrets.cursorKey, 'hex'),
      validateDependencies: async (_s, preset) => {
        if (preset.profile !== 'ep.preparation_entry@1.1')
          throw new Error('ENV_B_ANALYSIS_PROFILE_INVALID');
        const member = await identity.readMembershipTemplate(service, {
          templateRef: preset.memberPolicyTemplate.ref,
          templateHash: preset.memberPolicyTemplate.payloadHash,
        });
        if (member.useStatus !== 'USABLE') throw new Error('ENV_B_MEMBERSHIP_TEMPLATE_UNUSABLE');
        await policyRegistry.resolve(preset.intakePolicy.ref, preset.intakePolicy.payloadHash);
        const resolved = await basis.resolve(service, preset.analysisBasis);
        if (resolved.useStatus !== 'USABLE') throw new Error('ENV_B_ANALYSIS_BASIS_UNUSABLE');
        return {
          templateRefs: resolved.payload.templateBindings.map((b) => b.templateRef),
          requirementRefs: [],
          sourceWatermarks: resolved.sourceWatermarks,
        };
      },
    });
    const presetPayload = {
      profile: 'ep.preparation_entry@1.1',
      presetCode: 'zhiju.preparation.template_analysis',
      presetVersion: '1.1.0',
      creation: {
        mode: 'PREPARATION',
        status: 'PREPARING',
        enterpriseInitialStatus: 'ACTIVE',
        objective: '先阅读客户资料，保持企业既有安排，再比对公司模板提出缺失资料与修订意见。',
        enterpriseCodePrefix: 'ZJENT',
        projectCodePrefix: 'ZJPRJ',
      },
      memberPolicyTemplate: { ref: membership.templateRef, payloadHash: membership.templateHash },
      intakePolicy: { ref: installation.zipPolicy, payloadHash: preparationHash(policyPayload) },
      analysisBasis,
      analysisHandoff: {
        intent: 'ANALYZE',
        analysisProfileRef: installation.analysisProfile,
        expectedReportProfileRef: installation.reportProfile,
      },
    };
    const publicationInput = {
      presetId: installation.preset.objectId,
      versionId: installation.analysisExtension.presetVersionId,
      payload: presetPayload,
      effectiveFrom: installation.installedAt,
    };
    const published =
      (await project.readTemplatePresetPublication(session, publicationInput)) ??
      (await project.publishPreset(session, publicationInput));
    const selection = {
      preparationPresetRef: published.preparationPresetRef,
      preparationPresetHash: published.preparationPresetHash,
      publicationRef: published.publicationRef,
    };
    for (const operation of [
      ...PREPARATION_SERVICE_AUTHORITY_OPERATIONS,
      'project.preparation.source_v2.capture',
      'project.preparation.source_v2.read',
    ]) {
      if (operation === 'identity.preparation.membership_template.read') continue;
      await authority(
        operation,
        object('zhiju.project.preparation_preset', installation.preset.objectId),
      );
    }
    const usablePreset = await project.resolvePreset(service, selection);
    if (usablePreset.useStatus !== 'USABLE' || usablePreset.dependencyState !== 'USABLE')
      throw new Error('ENV_B_PREPARATION_PRESET_UNUSABLE');
    await identity.grantEnrollment(session, {
      grantId: installation.analysisExtension.enrollmentId,
      principalRef: object('identity.principal', session.principalId),
      allowedModes: ['NEW', 'EXISTING'],
      preparationPresetRef: selection.preparationPresetRef,
      preparationPresetHash: selection.preparationPresetHash,
      membershipTemplateRef: membership.templateRef,
      membershipTemplateHash: membership.templateHash,
      policySnapshotRef: policyRef,
      effectivePeriod,
      maxUses: 1000,
    });
    const deployment = {
      grantAdministrators: [session.principalId],
      companyRuleGrantAdministrators: [],
      administratorPolicySnapshotRef: policyRef,
      servicePrincipalId: service.principalId,
      enterpriseCapabilities: {
        select: 'workspace.preparation.enterprise_select',
        create: 'workspace.preparation.enterprise_create',
      },
      capabilityCodes,
      selection,
      policies,
      ticket: { activeKeyId: 'environment-b' },
      localFiles,
      localOmp,
      companySources,
    };
    await writePrivateJson(join(config.dataDir, 'preparation-deployment.json'), deployment);
    return deployment;
  } finally {
    await pool.end();
  }
}

export async function readPreparationDeployment(config) {
  const deployment = await json(join(config.dataDir, 'preparation-deployment.json'));
  const installation = await json(join(config.dataDir, 'preparation-installation.json'));
  if (
    installation.instanceId !== config.instanceId ||
    deployment.selection.preparationPresetRef.objectId !== installation.preset.objectId
  )
    throw new Error('ENV_B_PREPARATION_INSTALLATION_INVALID');
  return deployment;
}
