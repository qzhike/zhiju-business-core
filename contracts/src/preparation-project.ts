import type { Common } from './generated/types/common.js';
export interface PreparationPresetPayload {
  profile: 'ep.preparation_entry@1.0';
  presetCode: string;
  presetVersion: string;
  creation: {
    mode: 'PREPARATION';
    status: 'PREPARING';
    enterpriseInitialStatus: 'ACTIVE';
    objective: string;
    enterpriseCodePrefix: string;
    projectCodePrefix: string;
  };
  memberPolicyTemplate: { ref: Common.VersionedRef; payloadHash: Common.ContentHash };
  intakePolicy: { ref: Common.VersionedRef; payloadHash: Common.ContentHash };
  companyRules: {
    ruleBundleRef: Common.SnapshotRef;
    startupRulesRef: Common.SnapshotRef;
    vocabularyRef: Common.SnapshotRef;
    publicationRef: Common.ContentAddressedRef;
  };
  analysisHandoff: {
    intent: 'ANALYZE';
    analysisProfileRef: Common.VersionedRef;
    expectedReportProfileRef: Common.VersionedRef;
  };
}
export interface PreparationEntrySelection {
  preparationPresetRef: Common.VersionedRef;
  preparationPresetHash: Common.ContentHash;
  publicationRef: Common.ContentAddressedRef;
}
export interface PreparationRequestPayload {
  customer:
    { mode: 'NEW'; displayName: string } | { mode: 'EXISTING'; enterpriseRef: Common.ObjectRef };
  projectTitle: string;
  preparationPresetRef: Common.VersionedRef;
  preparationPresetHash: Common.ContentHash;
}
export type PreparationStepStatus =
  'NOT_STARTED' | 'PENDING' | 'OBSERVED' | 'COMMITTED' | 'FAILED' | 'UNKNOWN';
export interface PreparationStep {
  status: PreparationStepStatus;
  refs: Common.TypedReference[];
  receiptRefs: Common.TypedReference[];
  reasonCodes: string[];
}
export type PreparationRequestSteps = Record<
  'ADMISSION' | 'ENTERPRISE' | 'MEMBER_POLICY' | 'PROJECT' | 'CREATOR_ACCESS',
  PreparationStep
>;
import type { JsonSchema } from './schema-types.js';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const local = 'https://schemas.zhiju.local/modules/enterprise-project/1.0#/$defs/';
const ref = (name: string): JsonSchema => ({ $ref: common + name });
const obj = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
});
const list = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const nativeReference = (type: string, kind: string): JsonSchema =>
  obj({
    kind: { const: kind === 'contentAddressedRef' ? 'CONTENT_ADDRESSED' : 'OBJECT' },
    objectType: { const: type },
    objectId: ref('uuidV7'),
    scope: ref('scopeRef'),
    ...(kind === 'contentAddressedRef' ? { contentHash: ref('contentHash') } : {}),
  });
const exact = (type: string, kind = 'objectRef'): JsonSchema =>
  /^[A-Z]/.test(type)
    ? nativeReference(type, kind)
    : { allOf: [ref(kind), { type: 'object', properties: { objectType: { const: type } } }] };
export const preparationOwningReferenceSchema: JsonSchema = {
  anyOf: [
    ref('typedReference'),
    nativeReference('CommandReceipt', 'objectRef'),
    nativeReference('ProjectScopeClaim', 'objectRef'),
    nativeReference('SourceMaterial', 'contentAddressedRef'),
    nativeReference('ValidationResult', 'contentAddressedRef'),
  ],
};
const sensitiveText: JsonSchema = { type: 'string', minLength: 1, maxLength: 512, pattern: '\\S' };
const originalCommand = obj(
  {
    commandId: ref('uuidV7'),
    type: { const: 'project.request_project_preparation' },
    version: { const: '1.0' },
    scopeRef: ref('scopeRef'),
    targetRef: exact('zhiju.project.preparation_request'),
    expectedAggregateVersion: { type: 'integer', minimum: 1 },
    idempotencyKey: ref('nonEmptyString'),
    correlationId: ref('uuidV7'),
    causationId: ref('uuidV7'),
    requestedAt: ref('utcInstant'),
    deadline: ref('utcInstant'),
    payload: { $ref: local + 'preparationRequestPayload' },
    integrity: obj({ canonicalizationVersion: { const: '1' }, payloadHash: ref('contentHash') }),
  },
  ['expectedAggregateVersion', 'causationId', 'deadline'],
);
const stepSchema = obj({
  status: { enum: ['NOT_STARTED', 'PENDING', 'OBSERVED', 'COMMITTED', 'FAILED', 'UNKNOWN'] },
  refs: list(preparationOwningReferenceSchema),
  receiptRefs: list(preparationOwningReferenceSchema),
  reasonCodes: list(ref('reasonCode')),
});
const entryFields = {
  preparationPresetRef: exact('zhiju.project.preparation_preset', 'versionedRef'),
  preparationPresetHash: ref('contentHash'),
  publicationRef: exact('zhiju.project.preparation_preset_publication', 'contentAddressedRef'),
  intakePolicyRef: exact('zhiju.integration.customer_zip_policy', 'versionedRef'),
  intakePolicyHash: ref('contentHash'),
};
/** Merge into the owning EP module $defs; these are never a parallel schema namespace. */
export const preparationProjectSchemaDefinitions: Record<string, JsonSchema> = {
  preparationRequestPayload: obj({
    customer: {
      oneOf: [
        obj({ mode: { const: 'NEW' }, displayName: sensitiveText }),
        obj({ mode: { const: 'EXISTING' }, enterpriseRef: exact('zhiju.project.enterprise') }),
      ],
    },
    projectTitle: sensitiveText,
    preparationPresetRef: entryFields.preparationPresetRef,
    preparationPresetHash: ref('contentHash'),
  }),
  preparationRequestQuery: obj({
    requestRef: exact('zhiju.project.preparation_request'),
    originalKey: ref('nonEmptyString'),
  }),
  preparationEnterpriseSearchPayload: obj({
    searchText: { type: 'string', maxLength: 512 },
    page: obj(
      { limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: ref('opaqueCursor') },
      ['cursor'],
    ),
  }),
  preparationEnterprisePage: obj(
    {
      items: list(
        obj({
          enterpriseRef: exact('zhiju.project.enterprise'),
          displayName: ref('nonEmptyString'),
          displayCode: ref('nonEmptyString'),
        }),
      ),
      nextCursor: ref('opaqueCursor'),
      snapshotAt: ref('utcInstant'),
      sourceWatermarks: list({ $ref: local + 'sourceWatermark' }),
      entryBinding: obj(entryFields),
      newCustomerAllowed: { type: 'boolean' },
    },
    ['nextCursor'],
  ),
  preparationRequestResult: obj({
    requestRef: exact('zhiju.project.preparation_request'),
    originalCommand,
    originalCommandId: ref('uuidV7'),
    originalKey: ref('nonEmptyString'),
    payloadHash: ref('contentHash'),
    scopeRef: ref('scopeRef'),
    preparationPresetRef: entryFields.preparationPresetRef,
    preparationPresetHash: ref('contentHash'),
    intakePolicyRef: entryFields.intakePolicyRef,
    intakePolicyHash: ref('contentHash'),
    disposition: { enum: ['ACCEPTED', 'PARTIAL', 'UNKNOWN', 'STALE'] },
    steps: obj(
      Object.fromEntries(
        ['ADMISSION', 'ENTERPRISE', 'MEMBER_POLICY', 'PROJECT', 'CREATOR_ACCESS'].map((k) => [
          k,
          stepSchema,
        ]),
      ),
    ),
    access: obj(
      {
        status: { enum: ['PENDING', 'USABLE', 'INCOMPLETE', 'REVOKED'] },
        provisioningReceiptRef: ref('contentAddressedRef'),
        checkedAt: ref('utcInstant'),
      },
      ['provisioningReceiptRef'],
    ),
    permittedActions: list({ enum: ['SUBMIT_ZIP', 'CONTINUE_ORIGINAL', 'RETRY_ORIGINAL'] }),
    sourceWatermarks: list({ $ref: local + 'sourceWatermark' }),
  }),
};
export const preparationProjectExecutableContracts = {
  'project.find_preparation_enterprises': {
    payloadSchemaRef: local + 'preparationEnterpriseSearchPayload',
    resultSchemaRef: local + 'preparationEnterprisePage',
  },
  'project.request_project_preparation': {
    payloadSchemaRef: local + 'preparationRequestPayload',
    resultSchemaRef: local + 'preparationRequestResult',
  },
  'project.get_project_preparation_request': {
    payloadSchemaRef: local + 'preparationRequestQuery',
    resultSchemaRef: local + 'preparationRequestResult',
  },
} as const;

Object.assign(preparationProjectSchemaDefinitions, {
  createPreparingProjectPayload: obj({
    enterpriseRef: exact('zhiju.project.enterprise'),
    displayCode: ref('nonEmptyString'),
    title: sensitiveText,
    objective: ref('nonEmptyString'),
    memberPolicyRef: exact('identity.policy', 'versionedRef'),
    memberPolicyHash: ref('contentHash'),
    preparationPresetRef: entryFields.preparationPresetRef,
    preparationPresetHash: ref('contentHash'),
    preparationRequestRef: exact('zhiju.project.preparation_request'),
  }),
  createPreparingProjectResult: obj({
    projectRef: exact('zhiju.project.project'),
    projectScopeClaimRef: exact('ProjectScopeClaim'),
    aggregateVersion: { const: 1 },
    creationMode: { const: 'PREPARATION' },
    status: { const: 'PREPARING' },
    receiptRef: exact('CommandReceipt'),
  }),
  capturePreparationSourcePayload: obj(
    {
      projectRef: exact('zhiju.project.project'),
      intakeManifestRef: exact('zhiju.integration.customer_input_manifest', 'snapshotRef'),
      templateRefs: { ...list(ref('contentAddressedRef')), minItems: 1, uniqueItems: true },
      ruleBundleRef: ref('snapshotRef'),
      companyRulePublicationRef: exact(
        'zhiju.identity.company_rule_publication',
        'contentAddressedRef',
      ),
      previousReportRef: exact('zhiju.project.preparation_report', 'snapshotRef'),
      trustedDecisionRefs: list(preparationOwningReferenceSchema),
      purpose: { const: 'preparation.analysis' },
      audience: exact('identity.principal'),
    },
    ['previousReportRef'],
  ),
  capturePreparationSourceResult: obj({
    preparationSourceRef: exact('zhiju.project.preparation_source', 'snapshotRef'),
    inputRefs: list(preparationOwningReferenceSchema),
    receiptRef: exact('CommandReceipt'),
    validUntil: ref('utcInstant'),
  }),
  getPreparationSourcePayload: obj({
    preparationSourceRef: exact('zhiju.project.preparation_source', 'snapshotRef'),
    purpose: { const: 'preparation.analysis' },
    audience: exact('identity.principal'),
  }),
  preparingProjectCreatedEvent: obj({
    projectRef: exact('zhiju.project.project'),
    enterpriseRef: exact('zhiju.project.enterprise'),
    creationMode: { const: 'PREPARATION' },
    createdAt: ref('utcInstant'),
  }),
});
export const preparationProjectInternalContracts = {
  'project.create_preparing_project': {
    payloadSchemaRef: local + 'createPreparingProjectPayload',
    resultSchemaRef: local + 'createPreparingProjectResult',
  },
  'project.capture_preparation_source': {
    payloadSchemaRef: local + 'capturePreparationSourcePayload',
    resultSchemaRef: local + 'capturePreparationSourceResult',
  },
  'project.get_preparation_source': {
    payloadSchemaRef: local + 'getPreparationSourcePayload',
    resultSchemaRef: local + 'getPreparationSourceResult',
  },
  'project.PreparingProjectCreated': { payloadSchemaRef: local + 'preparingProjectCreatedEvent' },
} as const;

Object.assign(preparationProjectSchemaDefinitions, {
  preparationSourcePayload: obj({
    projectRef: exact('zhiju.project.project'),
    intakeManifestRef: exact('zhiju.integration.customer_input_manifest', 'snapshotRef'),
    templateRefs: list(ref('contentAddressedRef')),
    ruleBundleRef: ref('snapshotRef'),
    companyRulePublicationRef: exact(
      'zhiju.identity.company_rule_publication',
      'contentAddressedRef',
    ),
    purpose: { const: 'preparation.analysis' },
    audience: exact('identity.principal'),
    sources: list(
      obj(
        {
          sourceRef: exact('SourceMaterial', 'contentAddressedRef'),
          bytesSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          byteLength: { type: 'integer', minimum: 0 },
          objectRef: ref('nonEmptyString'),
          classification: { const: 'CUSTOMER_MATERIAL' },
          role: { const: 'CUSTOMER_NOTE' },
        },
        ['role'],
      ),
    ),
    trustedDecisionRefs: { type: 'array', maxItems: 0, items: false },
    coverage: obj({ acceptedSources: { type: 'integer', minimum: 1 } }),
    omissions: { type: 'array', maxItems: 0, items: false },
    redactions: { type: 'array', maxItems: 0, items: false },
    validUntil: ref('utcInstant'),
  }),
  getPreparationSourceResult: obj({
    payload: { $ref: local + 'preparationSourcePayload' },
    currentUsability: { enum: ['USABLE', 'EXPIRED', 'STALE', 'UNKNOWN'] },
    reasons: list(ref('reasonCode')),
    validUntil: ref('utcInstant'),
  }),
});
