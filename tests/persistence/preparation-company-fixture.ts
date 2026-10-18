import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import pg from 'pg';
import { createCompanyRuleComposition } from '@zhiju/api/composition';
import {
  createCompanyRuleDatabase,
  createIdentityPolicyDatabase,
  createActorSnapshot,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  registerPrincipal,
  createBootstrapClaim,
  grantCapability,
  authorizeCommand,
  withIdentityTransaction,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
  type CompanyRulePublicationView,
} from '@zhiju/identity-policy';
import {
  createCompanyStartupDatabase,
  createEnterpriseProjectDatabase,
  PLATFORM_CONTROL_SCOPE_ID,
  handlePlatformTemplateImportVersion,
  handlePlatformTemplatePublishVersion,
  handlePlatformRegulatoryImportVersion,
  handlePlatformRegulatoryPublishVersion,
  COMPANY_STARTUP_DEFINITION,
  COMPANY_STARTUP_MANDATORY,
  COMPANY_STARTUP_VOCABULARY,
  COMPANY_REQUIREMENT_LOCATORS,
  type CompanyRequirementDefinition,
  type CommandEnvelope,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  COMPANY_STARTUP_PROFILES,
  COMPANY_STARTUP_REGISTRY_VERSION,
  CompanyStartupError,
  companyHash,
  sameCompanyValue,
  companyObjectTarget,
  companyPolicySetVersion,
  companySnapshotReadRequest,
  companyStartupProfile,
  type Common,
  type CompanyRuleOperation,
  type CompanyRuleSession,
  type CompanyRuleAuthorizationProof,
  type CompanyStartupPayload,
  type CompanyRuleSnapshotView,
} from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// Reuse the existing immutable controlled source corpus across persistence suites.
const TEST_PROVENANCE = 'ISSUE_267_CONTROLLED_TEST_ONLY';
const asJson = (value: unknown): CanonicalJsonObject => value as CanonicalJsonObject;
const bytesHash = (bytes: Buffer): Common.ContentHash => ({
  algorithm: 'SHA-256',
  digest: createHash('sha256').update(bytes).digest('hex'),
  canonicalizationVersion: '1',
});
interface BundleFixture {
  bundle: CompanyRuleSnapshotView;
  rules: CompanyRuleSnapshotView;
  vocabulary: CompanyRuleSnapshotView;
}

export async function createPreparationCompanyFixture(
  databaseUrl: string,
  crypto: IdentityCryptoPorts,
) {
  const role = 'preparation_company_' + newUuidV7().replaceAll('-', '');
  const fixtureVersion = `291.${Date.now()}.${Number.parseInt(newUuidV7().slice(-6), 16)}`;
  let admin: pg.Client, ipPool: pg.Pool, epPool: pg.Pool;
  let db: ReturnType<typeof createCompanyRuleDatabase>,
    epDb: ReturnType<typeof createCompanyStartupDatabase>;
  let composition: ReturnType<typeof createCompanyRuleComposition>;
  let compositionConfig: Parameters<typeof createCompanyRuleComposition>[0];
  let deps: {
    db: ReturnType<typeof createIdentityPolicyDatabase>;
    repo: IdentityPolicyRepository;
    crypto: IdentityCryptoPorts;
    context: IdentityTransactionContext;
  };
  let legacyActor: Common.SnapshotRef,
    policyRef: Common.SnapshotRef,
    root: CompanyRuleSession,
    service: CompanyRuleSession,
    outsider: CompanyRuleSession,
    agent: CompanyRuleSession,
    runtime: CompanyRuleSession;
  let clockDate: Date, base: BundleFixture;
  const content = new Map<string, Buffer>(),
    grants = new Map<string, Common.ContentAddressedRef>();
  const sessions = new Map<string, CompanyRuleSession>();
  const templates: {
    templateCode: string;
    templateRef: Common.ContentAddressedRef;
    sourceBytesSha256: string;
  }[] = [];
  const normativeRefs: Common.ContentAddressedRef[] = [],
    requirements: { requirementCode: string; requirementRef: Common.ContentAddressedRef }[] = [];
  const pins: { code: string; versionLabel: string; bytesSha256: string }[] = [];
  const clock = () => new Date(clockDate);
  async function grant(
    session: CompanyRuleSession,
    op: CompanyRuleOperation,
    target: Common.ObjectRef,
  ) {
    const key = `${session.principalId}:${op}:${target.objectId}`;
    const existing = grants.get(key);
    if (existing) return existing;
    const ref = await composition.authorization.grant(root, {
      principalId: session.principalId,
      operation: op,
      target,
      policySnapshotRef: policyRef,
      validFrom: new Date(clockDate.getTime() - 60_000).toISOString(),
      validUntil: new Date(clockDate.getTime() + 3_600_000).toISOString(),
    });
    grants.set(key, ref);
    return ref;
  }
  async function proof(
    session: CompanyRuleSession,
    op: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
    humanIntent?: CompanyRuleAuthorizationProof,
  ) {
    await grant(session, op, target);
    return composition.authorization.authorize(session, op, target, request, humanIntent);
  }
  function sourceBinding(code: string, locator: string) {
    const t = templates.find((t) => t.templateCode === code);
    if (!t) throw new Error('missing fixture template');
    return { templateRef: t.templateRef, locator, sourceBytesSha256: t.sourceBytesSha256 };
  }
  async function legacyContext(
    operation: string,
    request: unknown,
  ): Promise<EnterpriseProjectTransactionContext> {
    const decision = await authorizeCommand(deps, {
      actorSnapshotRef: legacyActor,
      authenticationContextHash: Buffer.from(root.authenticationContextHash.digest, 'hex'),
      policySnapshotRef: policyRef,
      intent: {
        commandType: operation,
        commandVersion: '1.0',
        scopeKind: 'ENTERPRISE',
        enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
        purpose: operation,
        requestedCapability: 'company.fixture.platform_references',
        commandPayloadHash: Buffer.from(companyHash(request).digest, 'hex'),
        requestedAt: clock(),
        highRiskAction: true,
      },
    });
    expect(decision.outcome).toBe('ALLOW');
    return {
      kind: 'REQUEST',
      principalId: root.principalId,
      principalKind: 'HUMAN',
      actorSnapshotId: legacyActor.objectId,
      authorizationDecisionId: decision.authorizationDecisionRef.objectId,
      authorizationDecisionHash: Buffer.from(
        decision.authorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(decision.expiresAt),
      policySnapshotId: policyRef.snapshotId,
      enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
      allowedProjectIds: [],
      correlationId: newUuidV7(),
      platformReferenceCapabilities: ['PLATFORM_REFERENCE_ADMIN', 'PLATFORM_REFERENCE_PUBLISHER'],
    };
  }
  async function sourceCommand(
    operation: string,
    targetType: string,
    targetId: string,
    payload: object,
    publish = false,
  ) {
    const ctx = await legacyContext(operation, payload);
    const envelope: CommandEnvelope = {
      commandId: newUuidV7(),
      commandType: operation,
      commandVersion: '1.0',
      idempotencyScope: TEST_PROVENANCE,
      idempotencyKey: newUuidV7(),
      requestPayload: asJson({ operation, payload }),
      platform: true,
      enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
      targetType,
      targetId,
      correlationId: ctx.correlationId,
      principalId: ctx.principalId,
      principalKind: 'HUMAN',
      actorSnapshotId: ctx.actorSnapshotId,
      authorizationDecisionId: ctx.authorizationDecisionId,
      policySnapshotId: ctx.policySnapshotId,
      ...(publish ? { expectedAggregateVersion: '1' } : {}),
    };
    return { ctx, envelope };
  }
  async function snapshot(
    profile: (typeof COMPANY_STARTUP_PROFILES)[keyof typeof COMPANY_STARTUP_PROFILES],
    doc: CanonicalJsonObject,
    effectiveFrom: string,
  ): Promise<CompanyRuleSnapshotView> {
    const snapshotId = newUuidV7();
    const payload: CompanyStartupPayload = {
      registryVersion: COMPANY_STARTUP_REGISTRY_VERSION,
      profileKey: profile,
      policySetVersion: companyPolicySetVersion(profile, doc),
      policySchemaRefs: [companyStartupProfile(profile).reference],
      effectiveFrom,
      policyDocument: doc,
    };
    const request = { snapshotId, payload },
      target = companyObjectTarget('identity.policy_snapshot', snapshotId);
    await grant(service, 'project.company_startup.definition.validate', target);
    await grant(service, 'identity.company_rule.snapshot.read', target);
    const p = await proof(root, 'identity.company_rule.snapshot.record', target, request);
    const result = await composition.identity.record(p, snapshotId, request);
    expect(await composition.identity.record(p, snapshotId, request)).toEqual(result);
    const read = companySnapshotReadRequest(result.policySnapshotRef, profile);
    const readProof = await proof(root, 'identity.company_rule.snapshot.read', target, read);
    expect(await composition.identity.read(readProof, read)).toEqual(result);
    return result;
  }
  async function bundle(
    version = '1.0.0',
    effectiveFrom = new Date(clockDate.getTime() - 30_000).toISOString(),
    supersedesBundleRef?: Common.SnapshotRef,
  ): Promise<BundleFixture> {
    const rules = await snapshot(
      COMPANY_STARTUP_PROFILES.rules,
      asJson({
        rulesCode: `${COMPANY_STARTUP_DEFINITION.bundleCode}.rules`,
        rulesVersion: version,
        ...COMPANY_STARTUP_MANDATORY,
      }),
      effectiveFrom,
    );
    const entries = COMPANY_STARTUP_VOCABULARY.map((v) => ({
      domain: v.domain,
      code: v.code,
      label: v.label,
      meaning: v.meaning,
      sourceBindings: v.sources.map(([code, loc]) => sourceBinding(code, loc)),
      ownerMapping: { owner: 'enterprise-project', field: v.field, value: v.code },
    }));
    const vocabulary = await snapshot(
      COMPANY_STARTUP_PROFILES.vocabulary,
      asJson({
        vocabularyCode: `${COMPANY_STARTUP_DEFINITION.bundleCode}.vocabulary`,
        vocabularyVersion: version,
        entries,
      }),
      effectiveFrom,
    );
    const b = await snapshot(
      COMPANY_STARTUP_PROFILES.bundle,
      asJson({
        bundleCode: COMPANY_STARTUP_DEFINITION.bundleCode,
        bundleVersion: version,
        supportedRange: {
          rangeCode: COMPANY_STARTUP_DEFINITION.bundleCode,
          productTypeCodes: ['zhiju.product.active_device'],
          marketCodes: ['zhiju.market.cn_mainland'],
          standardTargets: normativeRefs.slice(0, 2),
          upgradeTargetRef: normativeRefs[2],
          targetImplementationDate: '2026-11-01',
        },
        startupRulesRef: rules.policySnapshotRef,
        vocabularyRef: vocabulary.policySnapshotRef,
        templateBindings: templates,
        requirementBindings: requirements,
        compatibility: {
          reportProfile: 'd14.analysis@1',
          ruleProfile: COMPANY_STARTUP_PROFILES.rules,
          vocabularyProfile: COMPANY_STARTUP_PROFILES.vocabulary,
          requiredFactValueTypes: ['TEXT'],
        },
        ...(supersedesBundleRef ? { supersedesBundleRef } : {}),
      }),
      effectiveFrom,
    );
    return { bundle: b, rules, vocabulary };
  }
  function publicationRequest(
    b: BundleFixture,
    supersedesPublicationRef?: Common.ContentAddressedRef,
  ) {
    return {
      publicationId: newUuidV7(),
      ruleBundleRef: b.bundle.policySnapshotRef,
      startupRulesRef: b.rules.policySnapshotRef,
      vocabularyRef: b.vocabulary.policySnapshotRef,
      approvedDefinitionHash: companyHash(b.rules.payload.policyDocument),
      approvedRangeHash: companyHash(b.bundle.payload.policyDocument.supportedRange),
      effectiveFrom: b.bundle.payload.effectiveFrom,
      ...(supersedesPublicationRef ? { supersedesPublicationRef } : {}),
    };
  }
  async function publish(
    b: BundleFixture,
    supersedesPublicationRef?: Common.ContentAddressedRef,
    throughService = false,
  ) {
    const request = publicationRequest(b, supersedesPublicationRef),
      target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationId,
      );
    const human = await proof(root, 'identity.company_rule.publish', target, request);
    const p = throughService
      ? await proof(service, 'identity.company_rule.publish', target, request, human)
      : human;
    const result = await composition.identity.publish(p, request.publicationId, request);
    expect(await composition.identity.publish(p, request.publicationId, request)).toEqual(result);
    return result;
  }
  async function resolve(b: BundleFixture, p: CompanyRulePublicationView) {
    const request = {
      ruleBundleRef: b.bundle.policySnapshotRef,
      startupRulesRef: b.rules.policySnapshotRef,
      vocabularyRef: b.vocabulary.policySnapshotRef,
      publicationRef: p.publicationRef,
    };
    const auth = await proof(
      service,
      'identity.company_rule.read',
      companyObjectTarget('zhiju.identity.company_rule_publication', p.publicationRef.objectId),
      request,
    );
    return composition.identity.resolve(auth, request);
  }
  async function regulatoryFixture(
    code: string,
    options: { authorityCode?: string; validTo?: string; publish?: boolean } = {},
  ): Promise<Common.ContentAddressedRef> {
    const existing = (
      await admin.query<{
        id: string;
        version_id: string;
        content_ref: Common.ContentAddressedRef;
        content_hash: Buffer;
        version_label: string;
        source_ref: { sourceBytesSha256: string; testProvenance: string };
      }>(
        "SELECT r.regulatory_reference_id AS id,v.regulatory_reference_version_id AS version_id,v.content_ref,v.content_hash,v.version_label,v.source_ref FROM enterprise_project.regulatory_reference r JOIN enterprise_project.regulatory_reference_version v USING(regulatory_reference_id) WHERE r.authority_code=$1 AND r.jurisdiction='CN' AND r.reference_code=$2 AND v.lifecycle='PUBLISHED' ORDER BY v.version_no DESC LIMIT 1",
        [options.authorityCode ?? (code.startsWith('ISO') ? 'ISO' : 'CN-NMPA'), code],
      )
    ).rows[0];
    if (existing) {
      const bytes = readFileSync(
        new URL('../fixtures/company-startup/normative.txt', import.meta.url),
      );
      if (
        bytesHash(bytes).digest !== existing.content_hash.toString('hex') ||
        existing.version_label !== 'test-v1' ||
        existing.source_ref.sourceBytesSha256 !== bytesHash(bytes).digest ||
        existing.source_ref.testProvenance !== TEST_PROVENANCE
      )
        throw new Error('Existing regulatory fixture bytes differ');
      content.set(existing.content_ref.objectId, bytes);
      return {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'RegulatoryReferenceVersion',
        objectId: existing.id,
        immutableVersionId: existing.version_id,
        scope: {},
        contentHash: bytesHash(bytes),
      };
    }
    const bytes = readFileSync(
        new URL('../fixtures/company-startup/normative.txt', import.meta.url),
      ),
      hash = bytesHash(bytes),
      id = newUuidV7(),
      versionId = newUuidV7(),
      contentRef = {
        kind: 'CONTENT_ADDRESSED' as const,
        objectType: 'RegulatoryDocument',
        objectId: newUuidV7(),
        scope: {},
        contentHash: hash,
      };
    content.set(contentRef.objectId, bytes);
    const payload = {
      regulatoryReferenceId: id,
      authorityCode: options.authorityCode ?? (code.startsWith('ISO') ? 'ISO' : 'CN-NMPA'),
      jurisdiction: 'CN',
      referenceCode: code,
      versionId,
      versionLabel: 'test-v1',
      citation: TEST_PROVENANCE,
      effectivePeriod: {
        validFrom:
          code === 'NMPA-2025-107' ? '2026-11-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
        ...(options.validTo ? { validTo: options.validTo } : {}),
      },
      sourceRef: { testProvenance: TEST_PROVENANCE, sourceBytesSha256: hash.digest },
      contentRef,
      contentHash: hash,
      verificationRefs: [{ testProvenance: TEST_PROVENANCE, actorSnapshotRef: legacyActor }],
    };
    const { ctx, envelope } = await sourceCommand(
      'enterprise_project.platform_regulatory_import_version',
      'RegulatoryReference',
      id,
      payload,
    );
    expect(
      (
        await handlePlatformRegulatoryImportVersion(createEnterpriseProjectDatabase(epPool), ctx, {
          ...envelope,
          payload,
        })
      ).status,
    ).toBe('COMMITTED');
    if (options.publish !== false) {
      const pub = {
        regulatoryReferenceId: id,
        versionId,
        publishReason: { testProvenance: TEST_PROVENANCE },
      };
      const command = await sourceCommand(
        'enterprise_project.platform_regulatory_publish_version',
        'RegulatoryReference',
        id,
        pub,
        true,
      );
      expect(
        (
          await handlePlatformRegulatoryPublishVersion(
            createEnterpriseProjectDatabase(epPool),
            command.ctx,
            {
              ...command.envelope,
              payload: {
                ...pub,
                releaseDecisionRef: {
                  authorizationDecisionId: command.ctx.authorizationDecisionId,
                  authorizationDecisionHash: command.ctx.authorizationDecisionHash.toString('hex'),
                  testProvenance: TEST_PROVENANCE,
                },
              },
            },
          )
        ).status,
      ).toBe('COMMITTED');
    }
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'RegulatoryReferenceVersion',
      objectId: id,
      immutableVersionId: versionId,
      scope: {},
      contentHash: hash,
    };
  }
  {
    clockDate = new Date();
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD 'company267-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher,identity_policy_app,enterprise_project_app,enterprise_project_platform_reference_writer,identity_policy_company_rule_writer,enterprise_project_company_rule_writer,identity_policy_preparation_writer,identity_preparation_self_reader,integration_gateway_app TO ${role}`,
    );
    const url = new URL(databaseUrl);
    url.username = role;
    url.password = 'company267-test-only';
    ipPool = new pg.Pool({ connectionString: url.toString(), max: 12 });
    epPool = new pg.Pool({ connectionString: url.toString(), max: 12 });
    db = createCompanyRuleDatabase(ipPool);
    epDb = createCompanyStartupDatabase(epPool);
    const session = (kind: string): CompanyRuleSession => ({
      principalId: newUuidV7(),
      authenticationContextHash: companyHash({ testProvenance: TEST_PROVENANCE, kind }),
      expiresAt: new Date(clockDate.getTime() + 3_600_000).toISOString(),
    });
    root = session('HUMAN');
    service = session('SERVICE');
    outsider = session('HUMAN_NO_PLATFORM_GRANT');
    agent = session('AGENT');
    runtime = session('RUNTIME');
    for (const s of [root, service, outsider, agent, runtime]) sessions.set(s.principalId, s);
    deps = {
      db: createIdentityPolicyDatabase(ipPool),
      repo: new IdentityPolicyRepository(crypto),
      crypto,
      context: {
        kind: 'REQUEST',
        principalId: root.principalId,
        actorSnapshotId: newUuidV7(),
        authorizationDecisionId: newUuidV7(),
        authorizationDecisionHash: Buffer.from(root.authenticationContextHash.digest, 'hex'),
        authorizationDecisionExpiresAt: new Date(root.expiresAt),
        enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
        allowedProjectIds: [],
        correlationId: newUuidV7(),
      },
    };
    const first =
      (
        await admin.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM identity_policy.principal',
        )
      ).rows[0]?.count === '0';
    const claim = first
      ? await createBootstrapClaim(deps, {
          purpose: 'FIRST_PRINCIPAL',
          operatorDescription: TEST_PROVENANCE,
          operatorActorSnapshotId: deps.context.actorSnapshotId,
          operatorAuthorizationDecisionId: deps.context.authorizationDecisionId,
          reason: 'Controlled test-only owning-entry bootstrap',
          evidenceRefs: { testProvenance: TEST_PROVENANCE },
          expiresAt: new Date(root.expiresAt),
        })
      : undefined;
    for (const [s, kind] of [
      [root, 'HUMAN'],
      [service, 'SERVICE'],
      [outsider, 'HUMAN'],
      [agent, 'AGENT'],
      [runtime, 'RUNTIME'],
    ] as const)
      expect(
        (
          await registerPrincipal(deps, {
            principalId: s.principalId,
            principalKind: kind,
            displayName: `${TEST_PROVENANCE}-${kind}`,
            initialStatus: 'ACTIVE',
            idempotencyKey: s.principalId,
            ...(s === root && claim ? { bootstrapClaimId: claim.claimId } : {}),
          })
        ).status,
      ).toBe('COMMITTED');
    const policyId = newUuidV7();
    expect(
      (
        await recordPolicySnapshot(deps, {
          policySnapshotId: policyId,
          policySetVersion: `${TEST_PROVENANCE}:${policyId}`,
          policySchemaRefs: ['identity.CapabilityPolicy@1.0'],
          effectiveFrom: new Date(clockDate.getTime() - 60_000),
          policyDocument: { testProvenance: TEST_PROVENANCE },
          idempotencyKey: policyId,
        })
      ).status,
    ).toBe('COMMITTED');
    const row = await withIdentityTransaction(deps.db, deps.context, (trx) =>
      deps.repo.getPolicySnapshotById(trx, policyId),
    );
    if (!row) throw new Error('owning policy fixture missing');
    policyRef = {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: policyId,
      snapshotId: policyId,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: row.payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
    legacyActor = await createActorSnapshot(deps, {
      actorSnapshotId: newUuidV7(),
      principalId: root.principalId,
      declaredPrincipalKind: 'HUMAN',
      authenticationContextHash: Buffer.from(root.authenticationContextHash.digest, 'hex'),
      scopeKind: 'ENTERPRISE',
      enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
    });
    expect(
      (
        await grantCapability(deps, {
          grantId: newUuidV7(),
          principalId: root.principalId,
          capabilityCode: 'company.fixture.platform_references',
          scope: { scopeKind: 'ENTERPRISE', enterpriseId: PLATFORM_CONTROL_SCOPE_ID },
          resourceSelectors: [],
          actions: ['IMPORT', 'PUBLISH'],
          validFrom: new Date(clockDate.getTime() - 60_000),
          validTo: new Date(root.expiresAt),
          grantPolicySnapshotId: policyRef.snapshotId,
          grantPolicySnapshotHash: row.payload_hash,
          justification: TEST_PROVENANCE,
          idempotencyKey: newUuidV7(),
        })
      ).status,
    ).toBe('COMMITTED');
    // Creation order intentionally differs from canonical template-code order.
    for (const t of [...COMPANY_STARTUP_DEFINITION.templates].reverse()) {
      const published = (
        await admin.query<{
          id: string;
          version_id: string;
          content_ref: Common.ContentAddressedRef;
          content_hash: Buffer;
          version_label: string;
          source_ref: { sourceBytesSha256: string; testProvenance: string };
        }>(
          "SELECT r.reference_template_id AS id,v.reference_template_version_id AS version_id,v.content_ref,v.content_hash,v.version_label,v.source_ref FROM enterprise_project.reference_template r JOIN enterprise_project.reference_template_version v USING(reference_template_id) WHERE r.reference_code=$1 AND v.lifecycle='PUBLISHED' ORDER BY v.version_no DESC LIMIT 1",
          [t.code],
        )
      ).rows[0];
      if (published) {
        const bytes = readFileSync(
            new URL(`../fixtures/company-startup/${t.code}.md`, import.meta.url),
          ),
          hash = bytesHash(bytes);
        if (
          hash.digest !== published.content_hash.toString('hex') ||
          published.version_label !== t.versionLabel ||
          published.source_ref.sourceBytesSha256 !== hash.digest ||
          published.source_ref.testProvenance !== TEST_PROVENANCE
        )
          throw new Error('Existing template fixture bytes differ');
        content.set(published.content_ref.objectId, bytes);
        pins.push({ code: t.code, versionLabel: t.versionLabel, bytesSha256: hash.digest });
        templates.push({
          templateCode: t.code,
          templateRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'TemplateVersion',
            objectId: published.id,
            immutableVersionId: published.version_id,
            scope: {},
            contentHash: hash,
          },
          sourceBytesSha256: hash.digest,
        });
        continue;
      }
      const bytes = readFileSync(
          new URL(`../fixtures/company-startup/${t.code}.md`, import.meta.url),
        ),
        hash = bytesHash(bytes),
        id = newUuidV7(),
        versionId = newUuidV7(),
        contentRef = {
          kind: 'CONTENT_ADDRESSED' as const,
          objectType: 'TemplateDocument',
          objectId: newUuidV7(),
          scope: {},
          contentHash: hash,
        };
      content.set(contentRef.objectId, bytes);
      pins.push({ code: t.code, versionLabel: t.versionLabel, bytesSha256: hash.digest });
      const payload = {
        referenceTemplateId: id,
        referenceCode: t.code,
        templateType: 'CONTROL_PROCEDURE',
        versionId,
        versionLabel: t.versionLabel,
        contentRef,
        contentHash: hash,
        sourceRef: { sourceBytesSha256: hash.digest, testProvenance: TEST_PROVENANCE },
        applicability: { testProvenance: TEST_PROVENANCE },
      };
      const { ctx, envelope } = await sourceCommand(
        'enterprise_project.platform_template_import_version',
        'ReferenceTemplate',
        id,
        payload,
      );
      expect(
        (
          await handlePlatformTemplateImportVersion(createEnterpriseProjectDatabase(epPool), ctx, {
            ...envelope,
            payload,
          })
        ).status,
      ).toBe('COMMITTED');
      const pub = {
        referenceTemplateId: id,
        versionId,
        publishReason: { testProvenance: TEST_PROVENANCE },
      };
      const command = await sourceCommand(
        'enterprise_project.platform_template_publish_version',
        'ReferenceTemplate',
        id,
        pub,
        true,
      );
      const result = await handlePlatformTemplatePublishVersion(
        createEnterpriseProjectDatabase(epPool),
        command.ctx,
        {
          ...command.envelope,
          payload: {
            ...pub,
            releaseDecisionRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'identity.authorization_decision',
              objectId: command.ctx.authorizationDecisionId,
              scope: { enterpriseId: PLATFORM_CONTROL_SCOPE_ID },
              contentHash: {
                algorithm: 'SHA-256',
                digest: command.ctx.authorizationDecisionHash.toString('hex'),
                canonicalizationVersion: '1',
              },
            },
          },
        },
      );
      expect(result.status).toBe('COMMITTED');
      templates.push({
        templateCode: t.code,
        templateRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'TemplateVersion',
          objectId: id,
          immutableVersionId: versionId,
          scope: {},
          contentHash: hash,
        },
        sourceBytesSha256: hash.digest,
      });
    }
    templates.sort((a, b) => a.templateCode.localeCompare(b.templateCode, 'en'));
    for (const code of ['GB/T 42061-2022', 'ISO 13485:2016', 'NMPA-2025-107']) {
      normativeRefs.push(await regulatoryFixture(code));
    }
    compositionConfig = {
      identity: {
        db,
        grantAdministrators: [root.principalId],
        clock,
        verifySession: (s) => {
          if (!sameSession(s, sessions.get(s.principalId)))
            return Promise.reject(new CompanyStartupError('AUTHORIZATION_DECISION_INVALID'));
          return Promise.resolve();
        },
      },
      enterprise: {
        db: epDb,
        clock,
        sourcePolicy: { provenance: 'CONTROLLED_TEST', testProvenance: TEST_PROVENANCE, pins },
        sources: {
          read: (ref) => {
            const bytes = content.get(ref.objectId);
            if (!bytes) throw new CompanyStartupError('DEPENDENCY_UNAVAILABLE');
            return Promise.resolve(bytes);
          },
          locate: (bytes, locator) => {
            const marker = `<!-- locator:${locator} -->\n`;
            const text = bytes.toString();
            if (!text.includes(marker) || text.indexOf(marker) !== text.lastIndexOf(marker))
              return Promise.resolve([]);
            const start = text.indexOf(marker) + marker.length;
            const slice = text
              .slice(start)
              .split('\n')
              .find((line) => line.trim().length > 0);
            return Promise.resolve([Buffer.from(slice ?? '')]);
          },
        },
      },
      dependencySession: () => Promise.resolve(service),
    };
    composition = createCompanyRuleComposition(compositionConfig);
    for (const r of COMPANY_STARTUP_DEFINITION.requirements) {
      const id = newUuidV7(),
        payload: CompanyRequirementDefinition = {
          requirementCode: r.code,
          definitionVersion: fixtureVersion,
          text: r.text,
          applicabilityConditions: r.conditions,
          templateSourceBindings: [...(COMPANY_REQUIREMENT_LOCATORS[r.code] ?? [])]
            .sort(([code, loc], [otherCode, otherLoc]) =>
              `${code}:${loc}`.localeCompare(`${otherCode}:${otherLoc}`, 'en'),
            )
            .map(([code, loc]) => sourceBinding(code, loc)),
          normativeReferenceRefs: normativeRefs,
        };
      const request = { requirementId: id, payload },
        target = companyObjectTarget('zhiju.project.company_startup_requirement', id);
      const imported = await composition.enterprise.importRequirement(
        await proof(root, 'project.company_startup.requirement.import', target, request),
        id,
        request,
      );
      const pub = { requirementId: id, requirementRef: imported.requirementRef };
      const published = await composition.enterprise.publishRequirement(
        await proof(root, 'project.company_startup.requirement.publish', target, pub),
        id,
        pub,
      );
      expect(published).toEqual(imported);
      requirements.push({ requirementCode: r.code, requirementRef: published.requirementRef });
    }
    requirements.sort((a, b) => a.requirementCode.localeCompare(b.requirementCode, 'en'));
    base = await bundle(fixtureVersion);
  }

  const publication = await publish(base, undefined, true);
  await resolve(base, publication);
  return {
    companyRules: composition,
    analysisTemplates: templates,
    analysisTemplateSources: compositionConfig.enterprise.sources,
    companyRuleRefs: {
      ruleBundleRef: base.bundle.policySnapshotRef,
      startupRulesRef: base.rules.policySnapshotRef,
      vocabularyRef: base.vocabulary.policySnapshotRef,
      publicationRef: publication.publicationRef,
    },
    policyRef,
    root,
    service,
    deps,
    ipPool,
    epPool,
    admin,
    grant,
    proof,
    clock,
    close: async () => {
      await ipPool.end();
      await epPool.end();
      await admin.query(`DROP ROLE ${role}`);
      await admin.end();
    },
  };
}
function sameSession(a: CompanyRuleSession, b: CompanyRuleSession | undefined): boolean {
  return b !== undefined && sameCompanyValue(a, b);
}
