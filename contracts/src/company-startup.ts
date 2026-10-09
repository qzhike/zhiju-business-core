import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020Import from 'ajv/dist/2020.js';
import type { ValidateFunction, Options } from 'ajv';
import {
  canonicalize,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import registryData from './generated/company-startup-profiles.json' with { type: 'json' };
import type { Common } from './generated/types/common.js';
import type { JsonSchema } from './schema-types.js';

export const COMPANY_STARTUP_REGISTRY_VERSION = 'im-ui-company-startup-v1';
export const COMPANY_STARTUP_PROFILES = Object.freeze({
  bundle: 'ep.company_startup_bundle@1.0',
  rules: 'ep.company_startup_rules@1.0',
  vocabulary: 'ep.company_startup_vocabulary@1.0',
} as const);
export type CompanyStartupProfile =
  (typeof COMPANY_STARTUP_PROFILES)[keyof typeof COMPANY_STARTUP_PROFILES];

export const COMPANY_RULE_OPERATIONS = Object.freeze([
  'identity.company_rule.snapshot.record',
  'identity.company_rule.snapshot.read',
  'identity.company_rule.publish',
  'identity.company_rule.withdraw',
  'identity.company_rule.read',
  'project.company_startup.requirement.import',
  'project.company_startup.requirement.publish',
  'project.company_startup.requirement.read',
  'project.company_startup.definition.validate',
] as const);
export type CompanyRuleOperation = (typeof COMPANY_RULE_OPERATIONS)[number];

export interface CompanyStartupProfileEntry {
  registryKey: CompanyStartupProfile;
  owner: 'enterprise-project';
  reference: Common.VersionedRef;
  documentSchema: JsonSchema;
}
export interface CompanyStartupProfileRegistry {
  registryVersion: typeof COMPANY_STARTUP_REGISTRY_VERSION;
  profiles: CompanyStartupProfileEntry[];
}
const schemaId = 'https://schemas.zhiju.local/internal/company-startup/1.0';
export const companyHash = (value: unknown): Common.ContentHash => ({
  algorithm: 'SHA-256',
  digest: createHash('sha256')
    .update(canonicalize(value as CanonicalJsonValue))
    .digest('hex'),
  canonicalizationVersion: '1',
});
export const sameCompanyValue = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b);

const uuid = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
};
const text = { type: 'string', minLength: 1, pattern: '\\S' };
const instant = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
};
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const version = { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' };
const code = { type: 'string', pattern: '^zhiju\\.[a-z0-9_]+(?:\\.[a-z0-9_]+)+$' };
const set = (items: JsonSchema, minItems = 1): JsonSchema => ({
  type: 'array',
  minItems,
  uniqueItems: true,
  items,
});
const closed = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const hashSchema = closed({
  algorithm: { const: 'SHA-256' },
  digest,
  canonicalizationVersion: { const: '1' },
});
export function companyReferenceSchema(
  kind: 'OBJECT' | 'SNAPSHOT' | 'CONTENT_ADDRESSED' | 'VERSIONED',
  objectType: string,
  versionedContent = false,
): JsonSchema {
  return closed({
    kind: { const: kind },
    objectType: { const: objectType },
    objectId: uuid,
    scope: closed({}),
    ...(kind === 'SNAPSHOT' ? { snapshotId: uuid } : {}),
    ...(kind === 'VERSIONED' ? { versionId: uuid } : {}),
    ...(versionedContent ? { immutableVersionId: uuid } : {}),
    ...(kind === 'SNAPSHOT' || kind === 'CONTENT_ADDRESSED' ? { contentHash: hashSchema } : {}),
  });
}
const snapshot = companyReferenceSchema('SNAPSHOT', 'identity.policy_snapshot');
const template = companyReferenceSchema('CONTENT_ADDRESSED', 'TemplateVersion', true);
const normative = companyReferenceSchema('CONTENT_ADDRESSED', 'RegulatoryReferenceVersion', true);
const requirementRef = companyReferenceSchema(
  'CONTENT_ADDRESSED',
  'zhiju.project.company_startup_requirement',
);
const publicationRef = companyReferenceSchema(
  'CONTENT_ADDRESSED',
  'zhiju.identity.company_rule_publication',
);
const sourceBinding = closed({ templateRef: template, locator: text, sourceBytesSha256: digest });
const bundle = closed(
  {
    bundleCode: code,
    bundleVersion: version,
    supportedRange: closed({
      rangeCode: code,
      productTypeCodes: set(code),
      marketCodes: set(code),
      standardTargets: set(normative),
      upgradeTargetRef: normative,
      targetImplementationDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    }),
    startupRulesRef: snapshot,
    vocabularyRef: snapshot,
    templateBindings: set(
      closed({ templateCode: text, templateRef: template, sourceBytesSha256: digest }),
    ),
    requirementBindings: set(closed({ requirementCode: code, requirementRef })),
    compatibility: closed({
      reportProfile: text,
      ruleProfile: { const: COMPANY_STARTUP_PROFILES.rules },
      vocabularyProfile: { const: COMPANY_STARTUP_PROFILES.vocabulary },
      requiredFactValueTypes: set({ const: 'TEXT' }),
    }),
    supersedesBundleRef: snapshot,
  },
  ['supersedesBundleRef'],
);
const rules = closed({
  rulesCode: code,
  rulesVersion: version,
  mandatoryFactTypes: set(code),
  requiredProductFields: set(text),
  minimumProductVersions: { type: 'integer', minimum: 1 },
  protectionEvidenceRequirements: set(text),
  mandatoryRequirementCodes: set(code),
  mandatoryChoiceKeys: set(code),
  mandatoryDecisionTypes: set(code),
  allowedStartupOutcomes: closed({
    'zhiju.decision.qms.supported_scope': set(code),
    'zhiju.decision.qms.protection_evidence': set(code),
    'zhiju.decision.qms.startup_conflicts': set(code),
  }),
  supportSet: set({ enum: ['TEXT', 'PRODUCT', 'QMS'] }),
});
const vocabulary = closed({
  vocabularyCode: code,
  vocabularyVersion: version,
  entries: set(
    closed({
      domain: {
        enum: [
          'fact_type',
          'product_type',
          'market',
          'risk_level',
          'requirement',
          'choice',
          'choice_option',
          'decision',
          'decision_outcome',
        ],
      },
      code,
      label: text,
      meaning: text,
      sourceBindings: set(sourceBinding),
      ownerMapping: closed({ owner: { const: 'enterprise-project' }, field: text, value: code }),
    }),
  ),
});
export const companyRequirementSchema = closed({
  requirementCode: code,
  definitionVersion: version,
  text,
  applicabilityConditions: text,
  templateSourceBindings: set(sourceBinding),
  normativeReferenceRefs: set(normative, 0),
});
export interface CompanyStartupPayload {
  registryVersion: typeof COMPANY_STARTUP_REGISTRY_VERSION;
  profileKey: CompanyStartupProfile;
  policySetVersion: string;
  policySchemaRefs: [Common.VersionedRef];
  effectiveFrom: string;
  policyDocument: CanonicalJsonObject;
}
export interface CompanyRuleSnapshotView {
  policySnapshotRef: Common.SnapshotRef;
  payload: CompanyStartupPayload;
}
export interface CompanyRuleSnapshotReadRequest {
  policySnapshotRef: Common.SnapshotRef;
  registryVersion: typeof COMPANY_STARTUP_REGISTRY_VERSION;
  profileKey: CompanyStartupProfile;
  policySchemaRef: Common.VersionedRef;
}
export interface CompanyRuleReferences {
  ruleBundleRef: Common.SnapshotRef;
  startupRulesRef: Common.SnapshotRef;
  vocabularyRef: Common.SnapshotRef;
}
export interface CompanyRuleSemanticValidation {
  validatorProfileRef: Common.VersionedRef;
  validatedPayloadHash: Common.ContentHash;
  validatedChildRefs: Common.SnapshotRef[];
  validatedAt: string;
}
export interface CompanyRuleSession {
  principalId: string;
  authenticationContextHash: Common.ContentHash;
  expiresAt: string;
}
export interface CompanyRuleAuthorizationProof {
  session: CompanyRuleSession;
  actorSnapshotRef: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
}
export interface CompanyRuleAuthorizationPort {
  authorize(
    session: CompanyRuleSession,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
    humanIntent?: CompanyRuleAuthorizationProof,
  ): Promise<CompanyRuleAuthorizationProof>;
  check(
    proof: CompanyRuleAuthorizationProof,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
  ): Promise<void>;
  humanApproval(
    proof: CompanyRuleAuthorizationProof,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
  ): Promise<CompanyRuleAuthorizationProof>;
}
export interface CompanyStartupDefinitionValidationPort {
  validate(
    proof: CompanyRuleAuthorizationProof,
    request: { snapshotId: string; payload: CompanyStartupPayload },
  ): Promise<CompanyRuleSemanticValidation>;
}
export interface CompanyRuleSnapshotResolver {
  read(
    proof: CompanyRuleAuthorizationProof,
    request: CompanyRuleSnapshotReadRequest,
  ): Promise<CompanyRuleSnapshotView>;
}
export function companyObjectTarget(objectType: string, objectId: string): Common.ObjectRef {
  const target: Common.ObjectRef = { kind: 'OBJECT', objectType, objectId, scope: {} };
  assertCompanyReference(target, 'OBJECT', objectType);
  return target;
}

const approvedEntries = Object.values(COMPANY_STARTUP_PROFILES).map(
  (key, index): CompanyStartupProfileEntry => ({
    registryKey: key,
    owner: 'enterprise-project',
    reference: {
      kind: 'VERSIONED',
      objectType: 'identity.contract_schema',
      objectId: `01a11df5-a400-7000-8000-00000025700${index + 1}`,
      versionId: `01a11df5-a400-7000-8000-00000025701${index + 1}`,
      scope: {},
    },
    documentSchema: { $ref: `${schemaId}#/$defs/${['bundle', 'rules', 'vocabulary'][index]}` },
  }),
);
export function loadCompanyStartupRegistry(value: unknown): CompanyStartupProfileRegistry {
  if (
    !sameCompanyValue(value, {
      registryVersion: COMPANY_STARTUP_REGISTRY_VERSION,
      profiles: approvedEntries,
    })
  )
    throw new Error('company startup registry is missing, unknown, duplicated or drifting');
  return structuredClone(value) as CompanyStartupProfileRegistry;
}
export const companyStartupRegistry = loadCompanyStartupRegistry(registryData);
for (const entry of companyStartupRegistry.profiles) {
  Object.freeze(entry.reference.scope);
  Object.freeze(entry.reference);
  Object.freeze(entry.documentSchema);
  Object.freeze(entry);
}
Object.freeze(companyStartupRegistry.profiles);
Object.freeze(companyStartupRegistry);
export function companyStartupProfile(key: string): CompanyStartupProfileEntry {
  const entry = companyStartupRegistry.profiles.find((p) => p.registryKey === key);
  if (!entry) throw new Error('company startup profile is unavailable');
  return structuredClone(entry);
}
export function companySnapshotReadRequest(
  ref: Common.SnapshotRef,
  profileKey: CompanyStartupProfile,
): CompanyRuleSnapshotReadRequest {
  return {
    policySnapshotRef: ref,
    registryVersion: COMPANY_STARTUP_REGISTRY_VERSION,
    profileKey,
    policySchemaRef: companyStartupProfile(profileKey).reference,
  };
}
export function companyPolicySetVersion(
  profile: CompanyStartupProfile,
  document: CanonicalJsonObject,
): string {
  const role =
    profile === COMPANY_STARTUP_PROFILES.bundle
      ? 'bundle'
      : profile === COMPANY_STARTUP_PROFILES.rules
        ? 'rules'
        : 'vocabulary';
  return `${profile}:${companyString(document[`${role}Code`])}@${companyString(document[`${role}Version`])}`;
}

interface AjvRuntime {
  compile(schema: JsonSchema): ValidateFunction;
  addSchema(schema: JsonSchema): AjvRuntime;
}
const Ajv2020 = Ajv2020Import as unknown as new (options?: Options) => AjvRuntime;
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema({ $id: schemaId, $defs: { bundle, rules, vocabulary } });
const validators = new Map<string, ValidateFunction>();
function validate(name: string, schema: JsonSchema, input: unknown): void {
  let fn = validators.get(name);
  if (!fn) {
    fn = ajv.compile(schema);
    validators.set(name, fn);
  }
  if (!fn(input)) throw new CompanyStartupError('COMPANY_RULE_INVALID');
}
export class CompanyStartupError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'CompanyStartupError';
  }
}
export function assertCompanyRequirement(input: unknown): asserts input is CanonicalJsonObject {
  validate('requirement', companyRequirementSchema, input);
}
export function assertCompanyPayload(input: unknown): asserts input is CompanyStartupPayload {
  const entry = companyStartupProfile((input as CompanyStartupPayload | null)?.profileKey ?? '');
  validate(
    `payload:${entry.registryKey}`,
    closed({
      registryVersion: { const: COMPANY_STARTUP_REGISTRY_VERSION },
      profileKey: { const: entry.registryKey },
      policySetVersion: text,
      policySchemaRefs: {
        type: 'array',
        minItems: 1,
        maxItems: 1,
        items: { const: entry.reference },
      },
      effectiveFrom: instant,
      policyDocument: entry.documentSchema,
    }),
    input,
  );
  const payload = input as CompanyStartupPayload;
  if (
    companyPolicySetVersion(payload.profileKey, payload.policyDocument) !==
      payload.policySetVersion ||
    !canonicalCompanyInstant(payload.effectiveFrom)
  )
    throw new CompanyStartupError('COMPANY_RULE_INVALID');
}
export function canonicalCompanyInstant(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
export function assertCompanySnapshotRead(
  input: unknown,
): asserts input is CompanyRuleSnapshotReadRequest {
  const entry = companyStartupProfile(
    (input as CompanyRuleSnapshotReadRequest | null)?.profileKey ?? '',
  );
  validate(
    `read:${entry.registryKey}`,
    closed({
      policySnapshotRef: snapshot,
      registryVersion: { const: COMPANY_STARTUP_REGISTRY_VERSION },
      profileKey: { const: entry.registryKey },
      policySchemaRef: { const: entry.reference },
    }),
    input,
  );
  const ref = (input as CompanyRuleSnapshotReadRequest).policySnapshotRef;
  if (ref.objectId !== ref.snapshotId) throw new CompanyStartupError('COMPANY_RULE_INVALID');
}
export function assertCompanySnapshotRecord(
  input: unknown,
): asserts input is { snapshotId: string; payload: CompanyStartupPayload } {
  validate('record', closed({ snapshotId: uuid, payload: { type: 'object' } }), input);
  assertCompanyPayload((input as { payload: unknown }).payload);
}
export function assertCompanySnapshotView(
  input: unknown,
): asserts input is CompanyRuleSnapshotView {
  validate(
    'snapshotView',
    closed({ policySnapshotRef: snapshot, payload: { type: 'object' } }),
    input,
  );
  const view = input as CompanyRuleSnapshotView;
  assertCompanyPayload(view.payload);
  if (
    view.policySnapshotRef.objectId !== view.policySnapshotRef.snapshotId ||
    !sameCompanyValue(view.policySnapshotRef.contentHash, companyHash(view.payload))
  )
    throw new CompanyStartupError('COMPANY_RULE_INVALID');
}
export function assertCompanyReference(
  input: unknown,
  kind: 'OBJECT' | 'SNAPSHOT' | 'CONTENT_ADDRESSED' | 'VERSIONED',
  objectType: string,
  versionedContent = false,
): void {
  validate(
    `ref:${kind}:${objectType}:${String(versionedContent)}`,
    companyReferenceSchema(kind, objectType, versionedContent),
    input,
  );
}
export function assertCompanyClosed(
  input: unknown,
  required: string[],
  optional: string[] = [],
): asserts input is Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    required.some((key) => !Object.hasOwn(input, key)) ||
    Object.keys(input).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new CompanyStartupError('COMPANY_RULE_INVALID');
}
export const companyPublicationReferenceSchema = publicationRef;

export function companyString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new CompanyStartupError('COMPANY_RULE_INVALID');
  return value;
}
export function assertCompanyHash(value: unknown): void {
  validate('hash', hashSchema, value);
}
