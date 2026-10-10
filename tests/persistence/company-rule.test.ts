import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
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
  getPolicySnapshot,
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

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const TEST_PROVENANCE = 'ISSUE_267_CONTROLLED_TEST_ONLY';
const asJson = (value: unknown): CanonicalJsonObject => value as CanonicalJsonObject;
const bytesHash = (bytes: Buffer): Common.ContentHash => ({
  algorithm: 'SHA-256',
  digest: createHash('sha256').update(bytes).digest('hex'),
  canonicalizationVersion: '1',
});
const crypto: IdentityCryptoPorts = {
  lookupHash: {
    computeKeyedLookupHash() {
      throw new Error('unused test crypto');
    },
  },
  fieldEncryption: {
    encryptField() {
      throw new Error('unused test crypto');
    },
    decryptField() {
      throw new Error('unused test crypto');
    },
  },
};
interface BundleFixture {
  bundle: CompanyRuleSnapshotView;
  rules: CompanyRuleSnapshotView;
  vocabulary: CompanyRuleSnapshotView;
}

describe.skipIf(!databaseUrl)(
  'company startup publication and exact resolution #267 (real PostgreSQL)',
  () => {
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
    let clockDate: Date, base: BundleFixture, basePublication: CompanyRulePublicationView;
    let rejectResult = false;
    let ambiguousLocator = false;
    let sourceReads = 0,
      sourceHook: (() => Promise<void>) | undefined;
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
          await handlePlatformRegulatoryImportVersion(
            createEnterpriseProjectDatabase(epPool),
            ctx,
            { ...envelope, payload },
          )
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
                    authorizationDecisionHash:
                      command.ctx.authorizationDecisionHash.toString('hex'),
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
    beforeAll(async () => {
      clockDate = new Date();
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        "CREATE ROLE company267_probe LOGIN PASSWORD 'company267-test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
      );
      await admin.query(
        'GRANT platform_context_establisher,identity_policy_app,enterprise_project_app,enterprise_project_platform_reference_writer,identity_policy_company_rule_writer,enterprise_project_company_rule_writer TO company267_probe',
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'company267_probe';
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
            await handlePlatformTemplateImportVersion(
              createEnterpriseProjectDatabase(epPool),
              ctx,
              { ...envelope, payload },
            )
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
            read: async (ref) => {
              sourceReads++;
              await sourceHook?.();
              const bytes = content.get(ref.objectId);
              if (!bytes) throw new CompanyStartupError('DEPENDENCY_UNAVAILABLE');
              return bytes;
            },
            locate: (bytes, locator) => {
              if (ambiguousLocator) return Promise.resolve([Buffer.from('<!-- locator:')]);
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
        validateIdentityResult: () => {
          if (rejectResult) throw new CompanyStartupError('COMPANY_RULE_RESULT_INVALID');
        },
      };
      composition = createCompanyRuleComposition(compositionConfig);
      for (const r of COMPANY_STARTUP_DEFINITION.requirements) {
        const id = newUuidV7(),
          payload: CompanyRequirementDefinition = {
            requirementCode: r.code,
            definitionVersion: '1.0.0',
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
      base = await bundle();
    }, 120_000);
    afterAll(async () => {
      await ipPool.end();
      await epPool.end();
      await admin.end();
    });

    it('IP-257-001/006: owning chain records exact three immutable profiles; saving alone never publishes', async () => {
      const request = {
        ruleBundleRef: base.bundle.policySnapshotRef,
        startupRulesRef: base.rules.policySnapshotRef,
        vocabularyRef: base.vocabulary.policySnapshotRef,
        publicationRef: {
          kind: 'CONTENT_ADDRESSED' as const,
          objectType: 'zhiju.identity.company_rule_publication',
          objectId: newUuidV7(),
          scope: {},
          contentHash: companyHash({ unpublished: true }),
        },
      };
      const p = await proof(
        root,
        'identity.company_rule.read',
        companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          request.publicationRef.objectId,
        ),
        request,
      );
      await expect(composition.identity.resolve(p, request)).rejects.toMatchObject({
        code: 'COMPANY_RULE_NOT_FOUND',
      });
      basePublication = await publish(base, undefined, true);
      const result = await resolve(base, basePublication);
      expect(result.currentUseStatus).toBe('USABLE');
      expect(result.snapshots).toEqual(base);
      expect(
        result.sourceWatermarks.filter((watermark) => watermark.owner === 'enterprise-project'),
      ).toHaveLength(24);
      expect(
        result.sourceWatermarks.every((watermark) =>
          Number.isFinite(Date.parse(watermark.checkedAt)),
        ),
      ).toBe(true);
      expect(basePublication.payload.approvedDefinitionHash).toEqual(
        companyHash(base.rules.payload.policyDocument),
      );
      expect(basePublication.payload.semanticValidation.validatedPayloadHash).toEqual(
        base.bundle.policySnapshotRef.contentHash,
      );
      expect(basePublication.payload.actorSnapshotRef).not.toEqual(
        result.publication.publicationRef,
      );
      expect(basePublication.publicationRef.contentHash).toEqual(
        companyHash(basePublication.payload),
      );
    }, 120_000);
    it('PR268 R1: requirement sources use code/locator order independent of template creation order', async () => {
      const definition = COMPANY_STARTUP_DEFINITION.requirements.find(
        (r) => r.code === 'zhiju.requirement.qms.design_development',
      );
      if (!definition) throw new Error('requirement definition missing');
      const codeOrdered = (COMPANY_REQUIREMENT_LOCATORS[definition.code] ?? []).map(
        ([code, locator]) => sourceBinding(code, locator),
      );
      expect(codeOrdered.map((binding) => binding.locator)).toEqual(['7.3', '1-2']);
      const [first, second] = codeOrdered;
      if (!first || !second) throw new Error('requirement source pair missing');
      expect(second.templateRef.objectId < first.templateRef.objectId).toBe(true);
      const requirementId = newUuidV7();
      const payload: CompanyRequirementDefinition = {
        requirementCode: definition.code,
        definitionVersion: '1.0.101',
        text: definition.text,
        applicabilityConditions: definition.conditions,
        templateSourceBindings: codeOrdered,
        normativeReferenceRefs: normativeRefs,
      };
      const request = { requirementId, payload };
      const original = structuredClone(request);
      const requestHash = companyHash(request);
      const target = companyObjectTarget(
        'zhiju.project.company_startup_requirement',
        requirementId,
      );
      const imported = await composition.enterprise.importRequirement(
        await proof(root, 'project.company_startup.requirement.import', target, request),
        requirementId,
        request,
      );
      expect(request).toEqual(original);
      expect(imported.payload).toEqual(payload);
      expect(imported.requirementRef.contentHash).toEqual(companyHash(payload));
      const receipt = await admin.query<{ request_hash: Buffer }>(
        'SELECT request_hash FROM enterprise_project.company_startup_receipt WHERE operation=$1 AND idempotency_key=$2',
        ['project.company_startup.requirement.import', requirementId],
      );
      expect(receipt.rows[0]?.request_hash.toString('hex')).toBe(requestHash.digest);
      const publishRequest = { requirementId, requirementRef: imported.requirementRef };
      expect(
        await composition.enterprise.publishRequirement(
          await proof(root, 'project.company_startup.requirement.publish', target, publishRequest),
          requirementId,
          publishRequest,
        ),
      ).toEqual(imported);
      const readRequest = { requirementRef: imported.requirementRef };
      expect(
        await composition.enterprise.readRequirement(
          await proof(root, 'project.company_startup.requirement.read', target, readRequest),
          readRequest,
        ),
      ).toEqual(imported);

      const rejectedId = newUuidV7();
      const wrongOrder = {
        requirementId: rejectedId,
        payload: {
          ...payload,
          definitionVersion: '1.0.102',
          templateSourceBindings: [...codeOrdered].reverse(),
        },
      };
      const rejectedHash = companyHash(wrongOrder);
      await expect(
        composition.enterprise.importRequirement(
          await proof(
            root,
            'project.company_startup.requirement.import',
            companyObjectTarget('zhiju.project.company_startup_requirement', rejectedId),
            wrongOrder,
          ),
          rejectedId,
          wrongOrder,
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_RULE_DEFINITION_INVALID' });
      expect(companyHash(wrongOrder)).toEqual(rejectedHash);
      expect(
        (
          await admin.query(
            'SELECT id FROM enterprise_project.company_startup_requirement WHERE id=$1',
            [rejectedId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await admin.query(
            'SELECT id FROM enterprise_project.company_startup_receipt WHERE idempotency_key=$1',
            [rejectedId],
          )
        ).rowCount,
      ).toBe(0);
    });
    it('PR268 R2: exact resolution normalizes dependency-session failures and preserves owning errors', async () => {
      const b = await bundle('1.0.103');
      const published = await publish(b);
      const request = {
        ruleBundleRef: b.bundle.policySnapshotRef,
        startupRulesRef: b.rules.policySnapshotRef,
        vocabularyRef: b.vocabulary.policySnapshotRef,
        publicationRef: published.publicationRef,
      };
      const p = await proof(
        service,
        'identity.company_rule.read',
        companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          request.publicationRef.objectId,
        ),
        request,
      );
      const control = await composition.identity.resolve(p, request);
      expect(control.currentUseStatus).toBe('USABLE');
      expect(control.snapshots).toEqual(b);
      // Calls 1-3 authorize exact snapshot reads; call 4 authorizes EP validation.
      for (const failAt of [1, 4]) {
        for (const error of [
          new Error('PRIVATE_COMPANY_DEPENDENCY_SESSION_DETAIL'),
          new CompanyStartupError('AUTHORIZATION_DECISION_INVALID'),
        ]) {
          let calls = 0;
          const failed = createCompanyRuleComposition({
            ...compositionConfig,
            dependencySession: () => {
              calls++;
              return calls === failAt ? Promise.reject(error) : Promise.resolve(service);
            },
          });
          sourceReads = 0;
          const failure = await failed.identity.resolve(p, request).then(
            () => null,
            (reason: unknown) => reason,
          );
          expect(calls).toBe(failAt);
          if (error instanceof CompanyStartupError) expect(failure).toBe(error);
          else {
            expect(failure).toBeInstanceOf(CompanyStartupError);
            expect(failure).toMatchObject({
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'DEPENDENCY_UNAVAILABLE',
            });
            expect(failure).not.toHaveProperty('cause');
          }
          expect(sourceReads).toBe(0);
        }
      }
      expect(await composition.identity.resolve(p, request)).toEqual(control);
    }, 120_000);
    it('IP-257-002: AGENT/RUNTIME/actingFor/ordinary scoped rights fail before protected company reads', async () => {
      sourceReads = 0;
      const request = publicationRequest(base),
        target = companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          request.publicationId,
        );
      for (const s of [agent, runtime, outsider])
        await expect(
          composition.authorization.authorize(s, 'identity.company_rule.publish', target, request),
        ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      await expect(
        composition.authorization.authorize(
          { ...root, actingFor: outsider.principalId } as CompanyRuleSession,
          'identity.company_rule.publish',
          target,
          request,
        ),
      ).rejects.toThrow();
      await expect(
        composition.authorization.authorize(
          service,
          'identity.company_rule.publish',
          target,
          request,
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      expect(sourceReads).toBe(0);
    });
    it('IP-257-003/EP-257-010: selector/Hash/children/approval binding and fabricated semantic material reject', async () => {
      const read = companySnapshotReadRequest(
          base.rules.policySnapshotRef,
          COMPANY_STARTUP_PROFILES.rules,
        ),
        target = companyObjectTarget(
          'identity.policy_snapshot',
          base.rules.policySnapshotRef.objectId,
        );
      const p = await proof(root, 'identity.company_rule.snapshot.read', target, read);
      await expect(
        composition.identity.read(p, { ...read, profileKey: COMPANY_STARTUP_PROFILES.bundle }),
      ).rejects.toThrow();
      const wrong = {
        ...read,
        policySnapshotRef: { ...read.policySnapshotRef, contentHash: companyHash({ wrong: true }) },
      };
      await expect(
        composition.identity.read(
          await proof(root, 'identity.company_rule.snapshot.read', target, wrong),
          wrong,
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_RULE_NOT_FOUND' });
      const req = {
          ...publicationRequest(base),
          approvedDefinitionHash: companyHash({ wrong: true }),
        },
        pubTarget = companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          req.publicationId,
        );
      await expect(
        composition.identity.publish(
          await proof(root, 'identity.company_rule.publish', pubTarget, req),
          req.publicationId,
          req,
        ),
      ).rejects.toThrow();
      expect(
        (
          await admin.query('SELECT id FROM identity_policy.company_rule_publication WHERE id=$1', [
            req.publicationId,
          ])
        ).rowCount,
      ).toBe(0);
      await expect(
        composition.identity.record(p, newUuidV7(), {
          snapshotId: newUuidV7(),
          payload: base.rules.payload,
          semanticValidation: 'fabricated',
        } as { snapshotId: string; payload: CompanyStartupPayload }),
      ).rejects.toThrow();
    });
    it('EP-257-001/005/006: incomplete, duplicate and mismatched exact company inputs fail semantic validation', async () => {
      const duplicateRequirements = [...requirements];
      const firstRequirement = duplicateRequirements[0],
        secondRequirement = duplicateRequirements[1];
      if (!firstRequirement || !secondRequirement) throw new Error('requirements missing');
      duplicateRequirements[1] = {
        ...secondRequirement,
        requirementCode: firstRequirement.requirementCode,
      };
      for (const patch of [
        { templateBindings: templates.slice(1) },
        { requirementBindings: requirements.slice(1) },
        { requirementBindings: duplicateRequirements },
        { bundleCode: 'zhiju.startup.unapproved' },
        {
          compatibility: {
            ...(base.bundle.payload.policyDocument.compatibility as CanonicalJsonObject),
            reportProfile: 'unapproved@1',
          },
        },
        {
          templateBindings: templates.map((t, i) =>
            i === 0 ? { ...t, sourceBytesSha256: companyHash({ wrong: true }).digest } : t,
          ),
        },
      ]) {
        const snapshotId = newUuidV7();
        const document = asJson({ ...base.bundle.payload.policyDocument, ...patch });
        const payload = {
          ...base.bundle.payload,
          policyDocument: document,
          policySetVersion: companyPolicySetVersion(COMPANY_STARTUP_PROFILES.bundle, document),
        };
        const request = { snapshotId, payload };
        const target = companyObjectTarget('identity.policy_snapshot', snapshotId);
        await expect(
          composition.enterprise.validate(
            await proof(root, 'project.company_startup.definition.validate', target, request),
            request,
          ),
        ).rejects.toThrow();
      }
      const existing = (
        await admin.query<{ payload: CompanyRequirementDefinition }>(
          'SELECT payload FROM enterprise_project.company_startup_requirement WHERE id=$1',
          [firstRequirement.requirementRef.objectId],
        )
      ).rows[0]?.payload;
      if (!existing) throw new Error('requirement missing');
      for (const patch of [
        { normativeReferenceRefs: [] },
        {
          templateSourceBindings: existing.templateSourceBindings.map((binding) => ({
            ...binding,
            locator: 'unapproved-locator',
          })),
        },
        {
          normativeReferenceRefs: existing.normativeReferenceRefs.map((ref) => ({
            ...ref,
            contentHash: companyHash({ wrong: true }),
          })),
        },
      ]) {
        const requirementId = newUuidV7();
        const request = {
          requirementId,
          payload: { ...existing, definitionVersion: '1.0.1', ...patch },
        };
        const target = companyObjectTarget(
          'zhiju.project.company_startup_requirement',
          requirementId,
        );
        await expect(
          composition.enterprise.importRequirement(
            await proof(root, 'project.company_startup.requirement.import', target, request),
            requirementId,
            request,
          ),
        ).rejects.toThrow();
        expect(
          (
            await admin.query(
              'SELECT id FROM enterprise_project.company_startup_requirement WHERE id=$1',
              [requirementId],
            )
          ).rowCount,
        ).toBe(0);
      }
      const requirementId = newUuidV7();
      const request = { requirementId, payload: { ...existing, definitionVersion: '1.0.1' } };
      const target = companyObjectTarget(
        'zhiju.project.company_startup_requirement',
        requirementId,
      );
      const saved = await composition.enterprise.importRequirement(
        await proof(root, 'project.company_startup.requirement.import', target, request),
        requirementId,
        request,
      );
      const read = { requirementRef: saved.requirementRef };
      await expect(
        composition.enterprise.readRequirement(
          await proof(root, 'project.company_startup.requirement.read', target, read),
          read,
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PLATFORM_REFERENCE_UNPUBLISHED' });
    }, 120_000);
    it('expired or unpublished formal normative versions cannot yield company publication material', async () => {
      const expired = await regulatoryFixture('GB/T 42061-2022', {
        authorityCode: `${TEST_PROVENANCE}_EXPIRED`,
        validTo: new Date(clockDate.getTime() - 1).toISOString(),
      });
      const unpublished = await regulatoryFixture('GB/T 42061-2022', {
        authorityCode: `${TEST_PROVENANCE}_UNPUBLISHED`,
        publish: false,
      });
      const standard = normativeRefs[1];
      if (!standard) throw new Error('standard missing');
      for (const [ref, code] of [
        [expired, 'PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED'],
        [unpublished, 'PROJECT_PLATFORM_REFERENCE_UNPUBLISHED'],
      ] as const) {
        const snapshotId = newUuidV7();
        const payload = {
          ...base.bundle.payload,
          policyDocument: asJson({
            ...base.bundle.payload.policyDocument,
            supportedRange: {
              ...(base.bundle.payload.policyDocument.supportedRange as CanonicalJsonObject),
              standardTargets: [ref, standard],
            },
          }),
        };
        const request = { snapshotId, payload };
        const target = companyObjectTarget('identity.policy_snapshot', snapshotId);
        await grant(service, 'project.company_startup.definition.validate', target);
        await expect(
          composition.identity.record(
            await proof(root, 'identity.company_rule.snapshot.record', target, request),
            snapshotId,
            request,
          ),
        ).rejects.toMatchObject({ code });
        expect(
          (
            await admin.query('SELECT id FROM identity_policy.company_rule_snapshot WHERE id=$1', [
              snapshotId,
            ])
          ).rowCount,
        ).toBe(0);
      }
    });
    it('EP-257-005/006: weakened mandatory sets, vocabulary drift, unavailable/ambiguous source and unsupported expansion cannot record', async () => {
      for (const patch of [
        { mandatoryFactTypes: [] },
        { mandatoryRequirementCodes: COMPANY_STARTUP_MANDATORY.mandatoryRequirementCodes.slice(1) },
        { minimumProductVersions: 0 },
        { supportSet: ['STRUCTURED_FACT'] },
        { protectionEvidenceRequirements: ['quality_objectives'] },
      ]) {
        const id = newUuidV7(),
          payload = {
            ...base.rules.payload,
            policyDocument: { ...base.rules.payload.policyDocument, ...patch },
          },
          request = { snapshotId: id, payload },
          target = companyObjectTarget('identity.policy_snapshot', id);
        await grant(service, 'project.company_startup.definition.validate', target);
        const p = await proof(root, 'identity.company_rule.snapshot.record', target, request);
        await expect(composition.identity.record(p, id, request)).rejects.toThrow();
        expect(
          (
            await admin.query('SELECT id FROM identity_policy.company_rule_snapshot WHERE id=$1', [
              id,
            ])
          ).rowCount,
        ).toBe(0);
      }
      const source = templates[0];
      if (!source) throw new Error('template missing');
      const contentId = (
        await admin.query<{ content_ref: { objectId: string } }>(
          'SELECT content_ref FROM enterprise_project.reference_template_version WHERE reference_template_version_id=$1',
          [source.templateRef.immutableVersionId],
        )
      ).rows[0]?.content_ref.objectId;
      if (!contentId) throw new Error('source missing');
      const saved = content.get(contentId);
      content.delete(contentId);
      try {
        await expect(resolve(base, basePublication)).rejects.toMatchObject({
          code: 'DEPENDENCY_UNAVAILABLE',
        });
      } finally {
        if (saved) content.set(contentId, saved);
      }
      ambiguousLocator = true;
      try {
        await expect(resolve(base, basePublication)).rejects.toMatchObject({
          code: 'COMPANY_RULE_SOURCE_LOCATOR_INVALID',
        });
      } finally {
        ambiguousLocator = false;
      }
      const original = composition.enterprise;
      const id = newUuidV7(),
        payload = {
          ...base.vocabulary.payload,
          policyDocument: { ...base.vocabulary.payload.policyDocument, entries: [] },
        },
        req = { snapshotId: id, payload },
        target = companyObjectTarget('identity.policy_snapshot', id);
      await expect(
        original.validate(
          await proof(root, 'project.company_startup.definition.validate', target, req),
          req,
        ),
      ).rejects.toThrow();
    });
    it('dependency exceptions have safe errors and failed owning writes leave no successful facts', async () => {
      const snapshotId = newUuidV7();
      const request = { snapshotId, payload: base.bundle.payload };
      const target = companyObjectTarget('identity.policy_snapshot', snapshotId);
      await grant(service, 'project.company_startup.definition.validate', target);
      const recordProof = await proof(
        root,
        'identity.company_rule.snapshot.record',
        target,
        request,
      );
      const unavailable = { code: 'DEPENDENCY_UNAVAILABLE', message: 'DEPENDENCY_UNAVAILABLE' };
      sourceHook = () => Promise.reject(new Error('PRIVATE_SOURCE_STORAGE_DETAIL'));
      try {
        await expect(
          composition.identity.record(recordProof, snapshotId, request),
        ).rejects.toMatchObject(unavailable);
      } finally {
        sourceHook = undefined;
      }
      expect(
        (
          await admin.query('SELECT id FROM identity_policy.company_rule_snapshot WHERE id=$1', [
            snapshotId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await admin.query(
            'SELECT id FROM identity_policy.company_rule_receipt WHERE idempotency_key=$1',
            [snapshotId],
          )
        ).rowCount,
      ).toBe(0);

      const readRequest = companySnapshotReadRequest(
        base.bundle.policySnapshotRef,
        COMPANY_STARTUP_PROFILES.bundle,
      );
      const readTarget = companyObjectTarget(
        'identity.policy_snapshot',
        base.bundle.policySnapshotRef.objectId,
      );
      const readProof = await proof(
        root,
        'identity.company_rule.snapshot.read',
        readTarget,
        readRequest,
      );
      const validationRequest = {
        snapshotId: base.bundle.policySnapshotRef.objectId,
        payload: base.bundle.payload,
      };
      const validationProof = await proof(
        service,
        'project.company_startup.definition.validate',
        readTarget,
        validationRequest,
      );
      const closedIpPool = new pg.Pool({ connectionString: databaseUrl });
      const closedEpPool = new pg.Pool({ connectionString: databaseUrl });
      const unavailableIdentity = createCompanyRuleDatabase(closedIpPool);
      const unavailableEnterprise = createCompanyStartupDatabase(closedEpPool);
      await Promise.all([closedIpPool.end(), closedEpPool.end()]);
      const failedIdentity = createCompanyRuleComposition({
        ...compositionConfig,
        identity: { ...compositionConfig.identity, db: unavailableIdentity },
      });
      const failedEnterprise = createCompanyRuleComposition({
        ...compositionConfig,
        enterprise: { ...compositionConfig.enterprise, db: unavailableEnterprise },
      });
      const failedAuthentication = createCompanyRuleComposition({
        ...compositionConfig,
        identity: {
          ...compositionConfig.identity,
          verifySession: () => Promise.reject(new Error('PRIVATE_AUTHENTICATION_DETAIL')),
        },
      });
      sourceReads = 0;
      await expect(failedIdentity.identity.read(readProof, readRequest)).rejects.toMatchObject(
        unavailable,
      );
      await expect(
        failedEnterprise.enterprise.validate(validationProof, validationRequest),
      ).rejects.toMatchObject(unavailable);
      await expect(
        failedAuthentication.identity.read(readProof, readRequest),
      ).rejects.toMatchObject(unavailable);
      expect(sourceReads).toBe(0);

      const existing = requirements[0];
      if (!existing) throw new Error('requirement missing');
      const payload = (
        await admin.query<{ payload: CompanyRequirementDefinition }>(
          'SELECT payload FROM enterprise_project.company_startup_requirement WHERE id=$1',
          [existing.requirementRef.objectId],
        )
      ).rows[0]?.payload;
      if (!payload) throw new Error('requirement payload missing');
      const requirementId = newUuidV7();
      const duplicate = { requirementId, payload };
      const duplicateTarget = companyObjectTarget(
        'zhiju.project.company_startup_requirement',
        requirementId,
      );
      await expect(
        composition.enterprise.importRequirement(
          await proof(
            root,
            'project.company_startup.requirement.import',
            duplicateTarget,
            duplicate,
          ),
          requirementId,
          duplicate,
        ),
      ).rejects.toMatchObject({
        code: 'COMPANY_RULE_IDENTITY_CONFLICT',
        message: 'COMPANY_RULE_IDENTITY_CONFLICT',
      });
      expect(
        (
          await admin.query(
            'SELECT id FROM enterprise_project.company_startup_requirement WHERE id=$1',
            [requirementId],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await admin.query(
            'SELECT id FROM enterprise_project.company_startup_receipt WHERE idempotency_key=$1',
            [requirementId],
          )
        ).rowCount,
      ).toBe(0);
      expect((await resolve(base, basePublication)).currentUseStatus).toBe('USABLE');
    });
    it('IP-257-005: identity conflict/replay after revoked Grant cannot mutate or expose historical content', async () => {
      const read = companySnapshotReadRequest(
          base.bundle.policySnapshotRef,
          COMPANY_STARTUP_PROFILES.bundle,
        ),
        target = companyObjectTarget('identity.policy_snapshot', read.policySnapshotRef.objectId);
      const p = await proof(outsider, 'identity.company_rule.snapshot.read', target, read),
        g = await grant(outsider, 'identity.company_rule.snapshot.read', target);
      await composition.authorization.revoke(root, g);
      sourceReads = 0;
      await expect(composition.identity.read(p, read)).rejects.toMatchObject({
        code: 'AUTHORIZATION_DECISION_INVALID',
      });
      expect(sourceReads).toBe(0);
      const request = {
        snapshotId: base.rules.policySnapshotRef.objectId,
        payload: base.rules.payload,
      };
      const auth = await proof(
        root,
        'identity.company_rule.snapshot.record',
        companyObjectTarget('identity.policy_snapshot', request.snapshotId),
        request,
      );
      await expect(
        composition.identity.record(auth, 'new-key-same-identity', request),
      ).rejects.toMatchObject({ code: 'COMPANY_RULE_IDENTITY_CONFLICT' });
      expect((await resolve(base, basePublication)).snapshots).toEqual(base);
    });
    it('IP-257-004: coexistence, future successor, actual supersession, and multiple successors have independent current status', async () => {
      const coexist = await bundle('1.0.1', base.bundle.payload.effectiveFrom),
        coPub = await publish(coexist);
      expect((await resolve(base, basePublication)).currentUseStatus).toBe('USABLE');
      expect((await resolve(coexist, coPub)).currentUseStatus).toBe('USABLE');
      const current = clockDate,
        future = new Date(clockDate.getTime() + 90_000).toISOString();
      const next = await bundle('1.0.2', future, base.bundle.policySnapshotRef);
      const selfEdge = {
        ...publicationRequest(next, basePublication.publicationRef),
        publicationId: basePublication.publicationRef.objectId,
      };
      const selfTarget = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        selfEdge.publicationId,
      );
      await expect(
        composition.identity.publish(
          await proof(root, 'identity.company_rule.publish', selfTarget, selfEdge),
          newUuidV7(),
          selfEdge,
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_RULE_SUPERSESSION_INVALID' });
      await expect(publish(next, coPub.publicationRef)).rejects.toMatchObject({
        code: 'COMPANY_RULE_SUPERSESSION_INVALID',
      });
      const nextPub = await publish(next, basePublication.publicationRef);
      expect((await resolve(next, nextPub)).currentUseStatus).toBe('NOT_YET_EFFECTIVE');
      expect((await resolve(base, basePublication)).currentUseStatus).toBe('USABLE');
      clockDate = new Date(clockDate.getTime() + 120_000);
      expect((await resolve(base, basePublication)).currentUseStatus).toBe('SUPERSEDED');
      expect((await resolve(next, nextPub)).currentUseStatus).toBe('USABLE');
      const other = await bundle(
        '1.0.3',
        new Date(clockDate.getTime() + 60_000).toISOString(),
        base.bundle.policySnapshotRef,
      );
      await expect(publish(other, basePublication.publicationRef)).rejects.toMatchObject({
        code: 'COMPANY_RULE_SUPERSESSION_INVALID',
      });
      clockDate = current;
      expect((await resolve(base, basePublication)).snapshots).toEqual(base);
    }, 120_000);
    it('IP-257-007: legacy writers reject new profiles, old readers never route new storage and old payload/Hash stay unchanged', async () => {
      const old = await getPolicySnapshot(deps, policyRef);
      for (const profile of Object.values(COMPANY_STARTUP_PROFILES))
        expect(
          (
            await recordPolicySnapshot(deps, {
              policySnapshotId: newUuidV7(),
              policySetVersion: newUuidV7(),
              policySchemaRefs: [profile],
              effectiveFrom: clock(),
              policyDocument: { testProvenance: TEST_PROVENANCE },
              idempotencyKey: newUuidV7(),
            })
          ).status,
        ).toBe('REJECTED');
      await expect(getPolicySnapshot(deps, base.rules.policySnapshotRef)).rejects.toMatchObject({
        code: 'IDENTITY_POLICY_SNAPSHOT_NOT_FOUND',
      });
      expect(await getPolicySnapshot(deps, policyRef)).toEqual(old);
      await expect(
        composition.identity.read(
          await proof(
            root,
            'identity.company_rule.snapshot.read',
            companyObjectTarget('identity.policy_snapshot', policyRef.objectId),
            companySnapshotReadRequest(policyRef, COMPANY_STARTUP_PROFILES.rules),
          ),
          companySnapshotReadRequest(policyRef, COMPANY_STARTUP_PROFILES.rules),
        ),
      ).rejects.toMatchObject({ code: 'COMPANY_RULE_NOT_FOUND' });
    });
    it('IP-257-005: publisher revocation prevents new/replayed writes without erasing a lawful publication; withdrawal is explicit', async () => {
      const request = publicationRequest(base),
        target = companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          request.publicationId,
        ),
        p = await proof(root, 'identity.company_rule.publish', target, request);
      await composition.authorization.revoke(
        root,
        await grant(root, 'identity.company_rule.publish', target),
      );
      sourceReads = 0;
      await expect(
        composition.identity.publish(p, request.publicationId, request),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      expect(sourceReads).toBe(0);
      const originalRequest = {
        ...publicationRequest(base),
        publicationId: basePublication.publicationRef.objectId,
      };
      const originalTarget = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        originalRequest.publicationId,
      );
      const originalHuman: CompanyRuleAuthorizationProof = {
        session: root,
        actorSnapshotRef: basePublication.payload.actorSnapshotRef,
        authorizationDecisionRef: basePublication.payload.authorizationDecisionRef,
      };
      const replay = await proof(
        service,
        'identity.company_rule.publish',
        originalTarget,
        originalRequest,
        originalHuman,
      );
      await composition.authorization.revoke(
        root,
        await grant(root, 'identity.company_rule.publish', originalTarget),
      );
      await expect(
        composition.identity.publish(replay, originalRequest.publicationId, originalRequest),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      expect(sourceReads).toBe(0);
      expect((await resolve(base, basePublication)).currentUseStatus).toBe('USABLE');
      const withdrawal = {
          withdrawalId: newUuidV7(),
          publicationRef: basePublication.publicationRef,
          reason: 'Explicit controlled test-only withdrawal',
          effectiveFrom: clockDate.toISOString(),
        },
        wTarget = companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          basePublication.publicationRef.objectId,
        ),
        wp = await proof(root, 'identity.company_rule.withdraw', wTarget, withdrawal);
      const result = await composition.identity.withdraw(wp, withdrawal.withdrawalId, withdrawal);
      expect(await composition.identity.withdraw(wp, withdrawal.withdrawalId, withdrawal)).toEqual(
        result,
      );
      const resolved = await resolve(base, basePublication);
      expect(resolved.currentUseStatus).toBe('WITHDRAWN');
      expect(resolved.snapshots).toEqual(base);
    });
    it('current authorization is rechecked after protected reads; revocation aborts the entire publication', async () => {
      const next = await bundle('1.0.4'),
        request = publicationRequest(next),
        target = companyObjectTarget(
          'zhiju.identity.company_rule_publication',
          request.publicationId,
        ),
        p = await proof(root, 'identity.company_rule.publish', target, request),
        g = await grant(root, 'identity.company_rule.publish', target);
      sourceHook = async () => {
        sourceHook = undefined;
        await composition.authorization.revoke(root, g);
      };
      await expect(
        composition.identity.publish(p, request.publicationId, request),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      expect(
        (
          await admin.query('SELECT id FROM identity_policy.company_rule_publication WHERE id=$1', [
            request.publicationId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await admin.query(
            'SELECT id FROM identity_policy.company_rule_receipt WHERE idempotency_key=$1',
            [request.publicationId],
          )
        ).rowCount,
      ).toBe(0);
    }, 120_000);
    it('result-contract failure rolls publication, Receipt and Audit back; same-key retry and concurrent replay return one fact', async () => {
      const next = await bundle('1.0.5');
      const request = publicationRequest(next);
      const target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationId,
      );
      const p = await proof(root, 'identity.company_rule.publish', target, request);
      rejectResult = true;
      try {
        await expect(
          composition.identity.publish(p, request.publicationId, request),
        ).rejects.toMatchObject({ code: 'COMPANY_RULE_RESULT_INVALID' });
      } finally {
        rejectResult = false;
      }
      for (const [table, column] of [
        ['company_rule_publication', 'id'],
        ['company_rule_receipt', 'idempotency_key'],
        ['company_rule_audit', 'target_id'],
      ] as const) {
        expect(
          (
            await admin.query(`SELECT id FROM identity_policy.${table} WHERE ${column}=$1`, [
              request.publicationId,
            ])
          ).rowCount,
        ).toBe(0);
      }
      const [published, replayed] = await Promise.all([
        composition.identity.publish(p, request.publicationId, request),
        composition.identity.publish(p, request.publicationId, request),
      ]);
      expect(replayed).toEqual(published);
      expect((await resolve(next, published)).currentUseStatus).toBe('USABLE');
      expect(
        (
          await admin.query(
            'SELECT id FROM identity_policy.company_rule_receipt WHERE idempotency_key=$1',
            [request.publicationId],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await admin.query(
            'SELECT id FROM identity_policy.company_rule_audit WHERE target_id=$1',
            [request.publicationId],
          )
        ).rowCount,
      ).toBe(1);
      const changed = { ...request, approvedDefinitionHash: companyHash({ different: true }) };
      await expect(
        composition.identity.publish(
          await proof(root, 'identity.company_rule.publish', target, changed),
          request.publicationId,
          changed,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });
    }, 120_000);
    it('expired Decision/session and mismatched authentication context deny before protected snapshot reads', async () => {
      const read = companySnapshotReadRequest(
        base.rules.policySnapshotRef,
        COMPANY_STARTUP_PROFILES.rules,
      );
      const target = companyObjectTarget(
        'identity.policy_snapshot',
        read.policySnapshotRef.objectId,
      );
      const p = await proof(root, 'identity.company_rule.snapshot.read', target, read);
      sourceReads = 0;
      await expect(
        composition.identity.read(
          {
            ...p,
            session: { ...root, authenticationContextHash: companyHash({ otherSession: true }) },
          },
          read,
        ),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DECISION_INVALID' });
      const previous = clockDate;
      try {
        clockDate = new Date(clockDate.getTime() + 300_001);
        await expect(composition.identity.read(p, read)).rejects.toMatchObject({
          code: 'AUTHORIZATION_DECISION_INVALID',
        });
        clockDate = new Date(root.expiresAt);
        await expect(composition.identity.read(p, read)).rejects.toMatchObject({
          code: 'AUTHORIZATION_DECISION_INVALID',
        });
      } finally {
        clockDate = previous;
      }
      expect(sourceReads).toBe(0);
    });
    it('dedicated ACL/RLS and SQL immutability prevent ordinary app access and historical rewrites', async () => {
      for (const role of [
        'identity_policy_app',
        'identity_policy_dispatcher',
        'enterprise_project_app',
        'projection_app',
      ]) {
        const acl = await admin.query<{ ok: boolean }>(
          'SELECT has_table_privilege($1,$2,$3) AS ok',
          [role, 'identity_policy.company_rule_snapshot', 'SELECT'],
        );
        expect(acl.rows[0]?.ok).toBe(false);
      }
      const role = await admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        "SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='identity_policy_company_rule_writer'",
      );
      expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
      expect(
        (
          await admin.query<{ ok: boolean }>(
            "SELECT has_table_privilege('enterprise_project_company_rule_writer','enterprise_project.reference_template_version','UPDATE') AS ok",
          )
        ).rows[0]?.ok,
      ).toBe(false);
      await expect(
        admin.query(
          'UPDATE identity_policy.company_rule_snapshot SET payload=payload WHERE id=$1',
          [base.rules.policySnapshotRef.objectId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        admin.query('DELETE FROM identity_policy.company_rule_publication WHERE id=$1', [
          basePublication.publicationRef.objectId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  },
);
function sameSession(a: CompanyRuleSession, b: CompanyRuleSession | undefined): boolean {
  return b !== undefined && sameCompanyValue(a, b);
}
