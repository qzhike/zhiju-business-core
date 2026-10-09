import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  COMPANY_STARTUP_PROFILES,
  CompanyStartupError,
  assertCompanyClosed,
  assertCompanyPayload,
  assertCompanyReference,
  assertCompanyRequirement,
  assertCompanySnapshotView,
  companyHash,
  companyObjectTarget,
  sameCompanyValue,
  type Common,
  type CompanyRuleAuthorizationPort,
  type CompanyRuleAuthorizationProof,
  type CompanyRuleSemanticValidation,
  type CompanyRuleSnapshotView,
  type CompanyStartupPayload,
} from '@zhiju/contracts';
import {
  withCompanyStartupTransaction,
  type CompanyStartupDb,
} from '../persistence/company-startup-db.js';
import {
  COMPANY_REQUIREMENT_LOCATORS,
  COMPANY_STARTUP_DEFINITION,
  COMPANY_STARTUP_MANDATORY,
  COMPANY_STARTUP_VOCABULARY,
} from './company-startup-definition.js';

export interface CompanyTemplateSourceBinding {
  templateRef: Common.ContentAddressedRef;
  locator: string;
  sourceBytesSha256: string;
}
export interface CompanyRequirementDefinition {
  requirementCode: string;
  definitionVersion: string;
  text: string;
  applicabilityConditions: string;
  templateSourceBindings: CompanyTemplateSourceBinding[];
  normativeReferenceRefs: Common.ContentAddressedRef[];
}
export interface CompanyRequirementView {
  requirementRef: Common.ContentAddressedRef;
  payload: CompanyRequirementDefinition;
}
interface BundleDocument {
  bundleCode: string;
  bundleVersion: string;
  supportedRange: {
    rangeCode: string;
    productTypeCodes: string[];
    marketCodes: string[];
    standardTargets: Common.ContentAddressedRef[];
    upgradeTargetRef: Common.ContentAddressedRef;
    targetImplementationDate: string;
  };
  startupRulesRef: Common.SnapshotRef;
  vocabularyRef: Common.SnapshotRef;
  templateBindings: {
    templateCode: string;
    templateRef: Common.ContentAddressedRef;
    sourceBytesSha256: string;
  }[];
  requirementBindings: { requirementCode: string; requirementRef: Common.ContentAddressedRef }[];
  compatibility: {
    reportProfile: string;
    ruleProfile: string;
    vocabularyProfile: string;
    requiredFactValueTypes: string[];
  };
}
interface VocabularyDocument {
  entries: {
    domain: string;
    code: string;
    label: string;
    meaning: string;
    sourceBindings: CompanyTemplateSourceBinding[];
    ownerMapping: { owner: string; field: string; value: string };
  }[];
}
export interface CompanyStartupConfig {
  db: Kysely<CompanyStartupDb>;
  authorization: CompanyRuleAuthorizationPort;
  readSnapshot(
    ref: Common.SnapshotRef,
    profile: typeof COMPANY_STARTUP_PROFILES.rules | typeof COMPANY_STARTUP_PROFILES.vocabulary,
  ): Promise<CompanyRuleSnapshotView>;
  /** Owning content access, with actual bytes and exact, unique source slices. */
  sources: {
    read(contentRef: Common.ContentAddressedRef): Promise<Buffer>;
    locate(bytes: Buffer, locator: string): Promise<readonly Buffer[]>;
  };
  sourcePolicy:
    | { provenance: 'PRODUCTION' }
    | {
        provenance: 'CONTROLLED_TEST';
        testProvenance: string;
        pins: { code: string; versionLabel: string; bytesSha256: string }[];
      };
  clock?: () => Date;
  validateResult?(result: unknown): void;
}
function invalid(code = 'COMPANY_RULE_DEFINITION_INVALID'): never {
  throw new CompanyStartupError(code);
}
const sorted = <T>(items: T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
export function createCompanyStartupCapabilities(config: CompanyStartupConfig) {
  const { db, authorization: auth } = config;
  const now = config.clock ?? (() => new Date());
  const pins =
    config.sourcePolicy.provenance === 'PRODUCTION'
      ? COMPANY_STARTUP_DEFINITION.templates
      : config.sourcePolicy.pins;
  if (
    config.sourcePolicy.provenance === 'CONTROLLED_TEST' &&
    !config.sourcePolicy.testProvenance.trim()
  )
    invalid();
  if (
    !sameCompanyValue(pins.map((p) => p.code).sort(), [
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
      'S9',
    ]) ||
    pins.some((p) => !/^[0-9a-f]{64}$/.test(p.bytesSha256) || !p.versionLabel.trim())
  )
    invalid();
  async function template(
    trx: Transaction<CompanyStartupDb>,
    ref: Common.ContentAddressedRef,
    expectedCode: string | undefined,
    hash: string | undefined,
    guard: () => Promise<void>,
  ) {
    await guard();
    assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'TemplateVersion', true);
    const row = await trx
      .selectFrom('enterprise_project.reference_template_version')
      .innerJoin(
        'enterprise_project.reference_template',
        'enterprise_project.reference_template.reference_template_id',
        'enterprise_project.reference_template_version.reference_template_id',
      )
      .selectAll('enterprise_project.reference_template_version')
      .select([
        'enterprise_project.reference_template.reference_code',
        'enterprise_project.reference_template.status',
      ])
      .where('reference_template_version_id', '=', ref.immutableVersionId ?? '')
      .executeTakeFirst();
    if (
      row?.reference_template_id !== ref.objectId ||
      row.lifecycle !== 'PUBLISHED' ||
      row.status !== 'ACTIVE' ||
      row.content_hash.toString('hex') !== ref.contentHash.digest
    )
      invalid('PROJECT_PLATFORM_REFERENCE_UNPUBLISHED');
    const pin = pins.find((p) => p.code === row.reference_code);
    if (
      !pin ||
      (expectedCode && expectedCode !== pin.code) ||
      row.version_label !== pin.versionLabel ||
      (hash && hash !== pin.bytesSha256)
    )
      invalid();
    await guard();
    const bytes = await config.sources.read(row.content_ref as Common.ContentAddressedRef);
    const bytesHash = createHash('sha256').update(bytes).digest('hex');
    const source = row.source_ref as { sourceBytesSha256?: string; testProvenance?: string };
    if (
      bytesHash !== pin.bytesSha256 ||
      bytesHash !== ref.contentHash.digest ||
      source.sourceBytesSha256 !== bytesHash ||
      (config.sourcePolicy.provenance === 'CONTROLLED_TEST' &&
        source.testProvenance !== config.sourcePolicy.testProvenance) ||
      (config.sourcePolicy.provenance === 'PRODUCTION' && source.testProvenance !== undefined)
    )
      invalid();
    return { ref, code: pin.code, bytes, hash: bytesHash };
  }
  async function sourceBinding(
    trx: Transaction<CompanyStartupDb>,
    binding: CompanyTemplateSourceBinding,
    guard: () => Promise<void>,
  ) {
    const t = await template(trx, binding.templateRef, undefined, binding.sourceBytesSha256, guard);
    await guard();
    const slices = await config.sources.locate(t.bytes, binding.locator);
    if (
      !slices.length ||
      slices.some(
        (slice) =>
          slice.length === 0 ||
          t.bytes.indexOf(slice) < 0 ||
          t.bytes.indexOf(slice) !== t.bytes.lastIndexOf(slice),
      )
    )
      invalid('COMPANY_RULE_SOURCE_LOCATOR_INVALID');
    return { key: `${t.code}:${binding.locator}`, templateCode: t.code };
  }
  async function normative(
    trx: Transaction<CompanyStartupDb>,
    ref: Common.ContentAddressedRef,
    upgrade: boolean,
    guard: () => Promise<void>,
  ): Promise<string> {
    await guard();
    assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'RegulatoryReferenceVersion', true);
    const row = await trx
      .selectFrom('enterprise_project.regulatory_reference_version')
      .innerJoin(
        'enterprise_project.regulatory_reference',
        'enterprise_project.regulatory_reference.regulatory_reference_id',
        'enterprise_project.regulatory_reference_version.regulatory_reference_id',
      )
      .selectAll('enterprise_project.regulatory_reference_version')
      .select([
        'enterprise_project.regulatory_reference.reference_code',
        'enterprise_project.regulatory_reference.authority_code',
        'enterprise_project.regulatory_reference.jurisdiction',
        'enterprise_project.regulatory_reference.status',
      ])
      .where('regulatory_reference_version_id', '=', ref.immutableVersionId ?? '')
      .executeTakeFirst();
    if (
      row?.regulatory_reference_id !== ref.objectId ||
      row.lifecycle !== 'PUBLISHED' ||
      row.status !== 'ACTIVE' ||
      row.content_hash.toString('hex') !== ref.contentHash.digest ||
      !row.authority_code.trim() ||
      row.jurisdiction !== 'CN'
    )
      invalid('PROJECT_PLATFORM_REFERENCE_UNPUBLISHED');
    const refs = row.verification_refs as unknown[];
    const period = row.effective_period as { validFrom?: string; validTo?: string };
    if (
      !Array.isArray(refs) ||
      !refs.length ||
      !period.validFrom ||
      !Number.isFinite(new Date(period.validFrom).getTime()) ||
      (period.validTo !== undefined &&
        (!Number.isFinite(new Date(period.validTo).getTime()) ||
          new Date(period.validTo) <= now())) ||
      (!upgrade && new Date(period.validFrom) > now())
    )
      invalid('PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED');
    await guard();
    const bytes = await config.sources.read(row.content_ref as Common.ContentAddressedRef);
    if (createHash('sha256').update(bytes).digest('hex') !== ref.contentHash.digest) invalid();
    const source = row.source_ref as { testProvenance?: string; sourceBytesSha256?: string };
    if (
      (source.sourceBytesSha256 !== undefined &&
        source.sourceBytesSha256 !== ref.contentHash.digest) ||
      (config.sourcePolicy.provenance === 'CONTROLLED_TEST' &&
        source.testProvenance !== config.sourcePolicy.testProvenance) ||
      (config.sourcePolicy.provenance === 'PRODUCTION' && source.testProvenance !== undefined)
    )
      invalid();
    if (upgrade && !new Date(period.validFrom).toISOString().startsWith('2026-11-01')) invalid();
    return row.reference_code;
  }
  async function validateRequirement(
    trx: Transaction<CompanyStartupDb>,
    p: CompanyRequirementDefinition,
    guard: () => Promise<void>,
  ) {
    await guard();
    assertCompanyRequirement(p);
    const expected = COMPANY_STARTUP_DEFINITION.requirements.find(
      (r) => r.code === p.requirementCode,
    );
    if (expected === undefined) invalid();
    if (
      p.text !== expected.text ||
      p.applicabilityConditions !== expected.conditions ||
      !p.normativeReferenceRefs.length
    )
      invalid();
    if (
      !sameCompanyValue(
        p.templateSourceBindings,
        sorted(p.templateSourceBindings, (s) => `${s.templateRef.objectId}:${s.locator}`),
      )
    )
      invalid();
    const bindings = [];
    for (const b of p.templateSourceBindings)
      bindings.push((await sourceBinding(trx, b, guard)).key);
    const expectedKeys = (COMPANY_REQUIREMENT_LOCATORS[p.requirementCode] ?? [])
      .map(([code, loc]) => `${code}:${loc}`)
      .sort();
    if (!sameCompanyValue(bindings.sort(), expectedKeys)) invalid();
    const codes = [];
    for (const ref of p.normativeReferenceRefs) {
      await guard();
      const root = await trx
        .selectFrom('enterprise_project.regulatory_reference')
        .select('reference_code')
        .where('regulatory_reference_id', '=', ref.objectId)
        .executeTakeFirst();
      codes.push(await normative(trx, ref, root?.reference_code === 'NMPA-2025-107', guard));
    }
    if (
      new Set(codes).size !== codes.length ||
      codes.some((c) => !['GB/T 42061-2022', 'ISO 13485:2016', 'NMPA-2025-107'].includes(c))
    )
      invalid();
  }
  function requirementView(
    id: string,
    payload: CompanyRequirementDefinition,
  ): CompanyRequirementView {
    return {
      requirementRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.company_startup_requirement',
        objectId: id,
        scope: {},
        contentHash: companyHash(payload),
      },
      payload,
    };
  }
  function assertRequirementView(value: CompanyRequirementView): void {
    assertCompanyClosed(value, ['requirementRef', 'payload']);
    assertCompanyReference(
      value.requirementRef,
      'CONTENT_ADDRESSED',
      'zhiju.project.company_startup_requirement',
    );
    assertCompanyRequirement(value.payload);
    if (!sameCompanyValue(value.requirementRef.contentHash, companyHash(value.payload))) invalid();
  }
  async function readPublishedRequirement(
    trx: Transaction<CompanyStartupDb>,
    ref: Common.ContentAddressedRef,
    guard: () => Promise<void>,
  ): Promise<CompanyRequirementView> {
    await guard();
    assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'zhiju.project.company_startup_requirement');
    const row = await trx
      .selectFrom('enterprise_project.company_startup_requirement')
      .selectAll()
      .where('id', '=', ref.objectId)
      .executeTakeFirst();
    await guard();
    const published = await trx
      .selectFrom('enterprise_project.company_startup_requirement_publication')
      .selectAll()
      .where('requirement_id', '=', ref.objectId)
      .executeTakeFirst();
    if (
      !row ||
      !published ||
      row.payload_hash.toString('hex') !== ref.contentHash.digest ||
      companyHash(published.payload).digest !== published.payload_hash.toString('hex')
    )
      invalid('PROJECT_PLATFORM_REFERENCE_UNPUBLISHED');
    const view = { requirementRef: ref, payload: row.payload as CompanyRequirementDefinition };
    assertRequirementView(view);
    const publication = published.payload as { requirementRef: Common.ContentAddressedRef };
    if (
      row.code !== view.payload.requirementCode ||
      row.version !== view.payload.definitionVersion ||
      !sameCompanyValue(publication.requirementRef, ref)
    )
      invalid();
    await validateRequirement(trx, view.payload, guard);
    return view;
  }
  async function write<T>(
    proof: CompanyRuleAuthorizationProof,
    operation:
      'project.company_startup.requirement.import' | 'project.company_startup.requirement.publish',
    key: string,
    request: { requirementId: string },
    body: (
      trx: Transaction<CompanyStartupDb>,
      commandId: string,
      guard: () => Promise<void>,
    ) => Promise<T>,
    validator: (value: T) => void,
  ): Promise<T> {
    if (!key.trim()) invalid();
    const target = companyObjectTarget(
      'zhiju.project.company_startup_requirement',
      request.requirementId,
    );
    await auth.check(proof, operation, target, request);
    const value = await withCompanyStartupTransaction(db, proof, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(267002::bigint)`.execute(trx);
      await auth.check(proof, operation, target, request);
      const receipt = await trx
        .selectFrom('enterprise_project.company_startup_receipt')
        .selectAll()
        .where('operation', '=', operation)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (receipt) {
        if (receipt.request_hash.toString('hex') !== companyHash(request).digest)
          invalid('IDEMPOTENCY_PAYLOAD_CONFLICT');
        if (receipt.result_hash.toString('hex') !== companyHash(receipt.result).digest) invalid();
        const result = receipt.result as T;
        validator(result);
        config.validateResult?.(result);
        await auth.check(proof, operation, target, request);
        return result;
      }
      const commandId = newUuidV7();
      const result = await body(trx, commandId, () =>
        auth.check(proof, operation, target, request),
      );
      validator(result);
      config.validateResult?.(result);
      await auth.check(proof, operation, target, request);
      await trx
        .insertInto('enterprise_project.company_startup_receipt')
        .values({
          id: commandId,
          operation,
          idempotency_key: key,
          request_hash: Buffer.from(companyHash(request).digest, 'hex'),
          result: JSON.stringify(result),
          result_hash: Buffer.from(companyHash(result).digest, 'hex'),
          actor_ref: JSON.stringify(proof.actorSnapshotRef),
          decision_ref: JSON.stringify(proof.authorizationDecisionRef),
        })
        .execute();
      await auth.check(proof, operation, target, request);
      return result;
    });
    await auth.check(proof, operation, target, request);
    return value;
  }
  return {
    async importRequirement(
      proof: CompanyRuleAuthorizationProof,
      key: string,
      request: { requirementId: string; payload: CompanyRequirementDefinition },
    ): Promise<CompanyRequirementView> {
      assertCompanyClosed(request, ['requirementId', 'payload']);
      assertCompanyRequirement(request.payload);
      return write(
        proof,
        'project.company_startup.requirement.import',
        key,
        request,
        async (trx, commandId, guard) => {
          await validateRequirement(trx, request.payload, guard);
          await trx
            .insertInto('enterprise_project.company_startup_requirement')
            .values({
              id: request.requirementId,
              code: request.payload.requirementCode,
              version: request.payload.definitionVersion,
              payload: JSON.stringify(request.payload),
              payload_hash: Buffer.from(companyHash(request.payload).digest, 'hex'),
              actor_ref: JSON.stringify(proof.actorSnapshotRef),
              decision_ref: JSON.stringify(proof.authorizationDecisionRef),
              source_command_id: commandId,
            })
            .execute();
          return requirementView(request.requirementId, request.payload);
        },
        assertRequirementView,
      );
    },
    async publishRequirement(
      proof: CompanyRuleAuthorizationProof,
      key: string,
      request: { requirementId: string; requirementRef: Common.ContentAddressedRef },
    ): Promise<CompanyRequirementView> {
      assertCompanyClosed(request, ['requirementId', 'requirementRef']);
      if (request.requirementId !== request.requirementRef.objectId) invalid();
      return write(
        proof,
        'project.company_startup.requirement.publish',
        key,
        request,
        async (trx, commandId, guard) => {
          const human = await auth.humanApproval(
            proof,
            'project.company_startup.requirement.publish',
            companyObjectTarget('zhiju.project.company_startup_requirement', request.requirementId),
            request,
          );
          const row = await trx
            .selectFrom('enterprise_project.company_startup_requirement')
            .selectAll()
            .where('id', '=', request.requirementId)
            .executeTakeFirst();
          if (row?.payload_hash.toString('hex') !== request.requirementRef.contentHash.digest)
            invalid();
          const payload = row.payload as CompanyRequirementDefinition;
          await validateRequirement(trx, payload, guard);
          const publication = {
            requirementRef: request.requirementRef,
            actorSnapshotRef: human.actorSnapshotRef,
            authorizationDecisionRef: human.authorizationDecisionRef,
            recordedAt: now().toISOString(),
          };
          await trx
            .insertInto('enterprise_project.company_startup_requirement_publication')
            .values({
              id: newUuidV7(),
              requirement_id: request.requirementId,
              payload: JSON.stringify(publication),
              payload_hash: Buffer.from(companyHash(publication).digest, 'hex'),
              actor_ref: JSON.stringify(proof.actorSnapshotRef),
              decision_ref: JSON.stringify(proof.authorizationDecisionRef),
              source_command_id: commandId,
            })
            .execute();
          return requirementView(request.requirementId, payload);
        },
        assertRequirementView,
      );
    },
    async readRequirement(
      proof: CompanyRuleAuthorizationProof,
      request: { requirementRef: Common.ContentAddressedRef },
    ): Promise<CompanyRequirementView> {
      assertCompanyClosed(request, ['requirementRef']);
      const target = companyObjectTarget(
        'zhiju.project.company_startup_requirement',
        request.requirementRef.objectId,
      );
      const guard = () =>
        auth.check(proof, 'project.company_startup.requirement.read', target, request);
      await guard();
      const result = await withCompanyStartupTransaction(db, proof, (trx) =>
        readPublishedRequirement(trx, request.requirementRef, guard),
      );
      await auth.check(proof, 'project.company_startup.requirement.read', target, request);
      return result;
    },
    async validate(
      proof: CompanyRuleAuthorizationProof,
      request: { snapshotId: string; payload: CompanyStartupPayload },
    ): Promise<CompanyRuleSemanticValidation> {
      assertCompanyClosed(request, ['snapshotId', 'payload']);
      assertCompanyPayload(request.payload);
      const target = companyObjectTarget('identity.policy_snapshot', request.snapshotId);
      const guard = () =>
        auth.check(proof, 'project.company_startup.definition.validate', target, request);
      await guard();
      const p = request.payload;
      const childRefs: Common.SnapshotRef[] = [];
      await withCompanyStartupTransaction(db, proof, async (trx) => {
        if (p.profileKey === COMPANY_STARTUP_PROFILES.rules) {
          const { rulesCode, rulesVersion, ...rules } = p.policyDocument;
          if (
            rulesCode !== `${COMPANY_STARTUP_DEFINITION.bundleCode}.rules` ||
            typeof rulesVersion !== 'string' ||
            !sameCompanyValue(rules, COMPANY_STARTUP_MANDATORY)
          )
            invalid();
        } else if (p.profileKey === COMPANY_STARTUP_PROFILES.vocabulary) {
          const v = p.policyDocument as unknown as VocabularyDocument;
          if (
            p.policyDocument.vocabularyCode !==
              `${COMPANY_STARTUP_DEFINITION.bundleCode}.vocabulary` ||
            v.entries.length !== COMPANY_STARTUP_VOCABULARY.length
          )
            invalid();
          for (let i = 0; i < v.entries.length; i++) {
            const entry = v.entries[i],
              expected = COMPANY_STARTUP_VOCABULARY[i];
            if (entry === undefined || expected === undefined) invalid();
            if (
              entry.domain !== expected.domain ||
              entry.code !== expected.code ||
              entry.label !== expected.label ||
              entry.meaning !== expected.meaning ||
              !sameCompanyValue(entry.ownerMapping, {
                owner: 'enterprise-project',
                field: expected.field,
                value: expected.code,
              })
            )
              invalid();
            const keys = [];
            for (const b of entry.sourceBindings) {
              await auth.check(
                proof,
                'project.company_startup.definition.validate',
                target,
                request,
              );
              keys.push((await sourceBinding(trx, b, guard)).key);
            }
            if (
              !sameCompanyValue(
                keys.sort(),
                expected.sources.map(([code, loc]) => `${code}:${loc}`).sort(),
              )
            )
              invalid();
          }
        } else {
          const b = p.policyDocument as unknown as BundleDocument;
          if (
            b.bundleCode !== COMPANY_STARTUP_DEFINITION.bundleCode ||
            b.supportedRange.rangeCode !== b.bundleCode ||
            !sameCompanyValue(b.supportedRange.productTypeCodes, ['zhiju.product.active_device']) ||
            !sameCompanyValue(b.supportedRange.marketCodes, ['zhiju.market.cn_mainland']) ||
            b.supportedRange.targetImplementationDate !== '2026-11-01' ||
            !sameCompanyValue(b.compatibility, {
              reportProfile: 'd14.analysis@1',
              ruleProfile: COMPANY_STARTUP_PROFILES.rules,
              vocabularyProfile: COMPANY_STARTUP_PROFILES.vocabulary,
              requiredFactValueTypes: ['TEXT'],
            })
          )
            invalid();
          if (
            !sameCompanyValue(
              b.templateBindings.map((t) => t.templateCode),
              pins.map((t) => t.code).sort(),
            ) ||
            new Set(b.templateBindings.map((t) => t.templateRef.objectId)).size !== 9
          )
            invalid();
          for (const t of b.templateBindings) {
            await auth.check(proof, 'project.company_startup.definition.validate', target, request);
            await template(trx, t.templateRef, t.templateCode, t.sourceBytesSha256, guard);
          }
          const standardCodes = [];
          for (const ref of b.supportedRange.standardTargets)
            standardCodes.push(await normative(trx, ref, false, guard));
          if (
            !sameCompanyValue(standardCodes.sort(), ['GB/T 42061-2022', 'ISO 13485:2016']) ||
            (await normative(trx, b.supportedRange.upgradeTargetRef, true, guard)) !==
              'NMPA-2025-107'
          )
            invalid();
          if (
            !sameCompanyValue(
              b.requirementBindings.map((r) => r.requirementCode),
              COMPANY_STARTUP_MANDATORY.mandatoryRequirementCodes,
            ) ||
            new Set(b.requirementBindings.map((r) => r.requirementRef.objectId)).size !== 12
          )
            invalid();
          const locatorMapping = new Set<string>();
          for (const r of b.requirementBindings) {
            await auth.check(proof, 'project.company_startup.definition.validate', target, request);
            const view = await readPublishedRequirement(trx, r.requirementRef, guard);
            if (view.payload.requirementCode !== r.requirementCode) invalid();
            for (const src of view.payload.templateSourceBindings) {
              const t = b.templateBindings.find((t) =>
                sameCompanyValue(t.templateRef, src.templateRef),
              );
              if (t?.sourceBytesSha256 !== src.sourceBytesSha256) invalid();
              const key = `${src.templateRef.objectId}:${src.locator}`;
              if (locatorMapping.has(key)) invalid('COMPANY_RULE_SOURCE_LOCATOR_INVALID');
              locatorMapping.add(key);
            }
            for (const ref of view.payload.normativeReferenceRefs)
              if (
                ![...b.supportedRange.standardTargets, b.supportedRange.upgradeTargetRef].some(
                  (r) => sameCompanyValue(r, ref),
                )
              )
                invalid();
          }
          await auth.check(proof, 'project.company_startup.definition.validate', target, request);
          for (const [ref, key] of [
            [b.startupRulesRef, COMPANY_STARTUP_PROFILES.rules],
            [b.vocabularyRef, COMPANY_STARTUP_PROFILES.vocabulary],
          ] as const) {
            const child = await config.readSnapshot(ref, key);
            assertCompanySnapshotView(child);
            if (
              !sameCompanyValue(child.policySnapshotRef, ref) ||
              child.payload.profileKey !== key ||
              child.payload.effectiveFrom !== p.effectiveFrom
            )
              invalid();
            // Revalidate the immutable child against current sources and the same authority entry.
            await this.validate(
              await dependencyValidationProof(ref.snapshotId, child.payload, proof),
              { snapshotId: ref.snapshotId, payload: child.payload },
            );
            childRefs.push(ref);
          }
        }
      });
      await auth.check(proof, 'project.company_startup.definition.validate', target, request);
      const result = {
        validatorProfileRef: p.policySchemaRefs[0],
        validatedPayloadHash: companyHash(p),
        validatedChildRefs: childRefs,
        validatedAt: now().toISOString(),
      };
      config.validateResult?.(result);
      return result;
    },
  };
  async function dependencyValidationProof(
    snapshotId: string,
    payload: CompanyStartupPayload,
    proof: CompanyRuleAuthorizationProof,
  ) {
    return auth.authorize(
      proof.session,
      'project.company_startup.definition.validate',
      companyObjectTarget('identity.policy_snapshot', snapshotId),
      { snapshotId, payload },
    );
  }
}
