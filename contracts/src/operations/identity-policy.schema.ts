import guardPolicies from '../generated/payload-guard-policies.json' with { type: 'json' };

import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/identity-policy/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableOperationContract {
  readonly payloadSchemaRef: string;
  readonly resultSchemaRef?: string;
}

function object(required: readonly string[], properties: SchemaProperties): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function array(
  items: unknown,
  options: { readonly nonEmpty?: boolean; readonly unique?: boolean } = {},
) {
  return {
    type: 'array',
    items,
    ...(options.nonEmpty === true ? { minItems: 1 } : {}),
    ...(options.unique === true ? { uniqueItems: true } : {}),
  } as const;
}

function localRef(name: string) {
  return { $ref: `${schemaId}#/$defs/${name}` } as const;
}

const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const reasonCode = { $ref: `${common}reasonCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const scope = { $ref: `${common}scopeRef` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const payloadHash = { $ref: `${common}contentHash` } as const;
const canonicalJson = {} as const;

// ---------------------------------------------------------------------------
// #176/#183 Policy 版本身份。`policyRef` 是 canonical VERSIONED Policy 版本键，
// `policyVersionRef` 是已提交版本事实的 canonical SNAPSHOT。两者的 objectType
// 都以 `const` 编码：引用因此按形状有界，而不是只靠 maxStringCodePoints 兜底，
// 这正是 #181 读回推导（结果预算 = 请求预算 + 4096，结果侧增量上界 820）的前提。
// ---------------------------------------------------------------------------

const policyObjectType = 'zhiju.identity.policy';
const policyVersionObjectType = 'zhiju.identity.policy_version';

/** Closed Scope shape：`enterpriseId` 必填、`projectId` 可选，不引入其他成员。 */
const enterpriseScope = {
  allOf: [
    { $ref: `${common}scopeRef` },
    {
      type: 'object',
      required: ['enterpriseId'],
      properties: { enterpriseId: uuid, projectId: uuid },
    },
  ],
} as const;

/** 版本键：`VersionedRef<Policy>`（kind=VERSIONED、固定 objectType、企业/项目 Scope）。 */
const policyVersionKey = {
  allOf: [
    { $ref: `${common}versionedRef` },
    {
      type: 'object',
      required: ['objectType', 'scope'],
      properties: { objectType: { const: policyObjectType }, scope: enterpriseScope },
    },
  ],
} as const;

/** 版本事实：`SnapshotRef<PolicyVersion>`；`objectId == snapshotId` 由绑定校验执行。 */
const policyVersionSnapshotReference = {
  allOf: [
    { $ref: `${common}snapshotRef` },
    {
      type: 'object',
      required: ['objectType', 'scope'],
      properties: { objectType: { const: policyVersionObjectType }, scope: enterpriseScope },
    },
  ],
} as const;

/**
 * SD-181-1：两个 PolicyVersion 操作的 payload 与结果中每个 `UtcInstant`
 * 至多毫秒精度（≤ 24 code point）。共享 `UtcInstant` 与其余操作保持不变；
 * `$ref` 同级 `maxLength` 在 draft 2020-12 下与 allOf 等价，并使生成类型保持
 * 单一标量别名（`type` 与 `$ref` 一致，满足 Ajv strict）。
 */
const policyInstant = { $ref: `${common}utcInstant`, type: 'string', maxLength: 24 } as const;

const policyVersionGuard = guardPolicies.policies.find(
  (policy) => policy.type === 'identity.policy_version' && policy.version === '1.0',
);
if (policyVersionGuard === undefined) throw new Error('missing PolicyVersion payload guard');
const policyVersionGuardRef = {
  type: policyVersionGuard.type,
  version: policyVersionGuard.version,
};

const namedDefinitions = {
  principalKind: { enum: ['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'] },
  principalStatus: { enum: ['ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED'] },
  authorizationOutcome: { enum: ['ALLOW', 'DENY'] },
  externalIdentityKey: object(['providerCode', 'accountExternalId', 'subjectExternalId'], {
    providerCode: namespace,
    accountExternalId: text,
    subjectExternalId: text,
  }),
  effectivePeriod: object([], {
    validFrom: instant,
    validTo: instant,
  }),
  evidenceRef: object(['evidence', 'relation'], {
    evidence: contentAddressedReference,
    evidenceLinkRef: objectReference,
    relation: { enum: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'] },
    targetClaimRef: typedReference,
    applicabilityScopeRef: scope,
  }),
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: text,
    evidenceRefs: array(localRef('evidenceRef')),
    policyRef: typedReference,
  }),
  scopedRole: object(['roleCode', 'scopeRef', 'effectivePeriod', 'constraints'], {
    roleCode: namespace,
    scopeRef: scope,
    objectRef: objectReference,
    effectivePeriod: localRef('effectivePeriod'),
    constraints: canonicalJson,
  }),
  scopedCapability: object(
    [
      'capabilityCode',
      'scopeRef',
      'resourceSelectors',
      'actions',
      'constraints',
      'effectivePeriod',
      'grantPolicyRef',
    ],
    {
      capabilityCode: namespace,
      scopeRef: scope,
      resourceSelectors: array(canonicalJson),
      actions: array(namespace, { nonEmpty: true, unique: true }),
      constraints: canonicalJson,
      effectivePeriod: localRef('effectivePeriod'),
      maxUses: { type: 'integer', minimum: 1 },
      grantPolicyRef: typedReference,
    },
  ),
  commandIntent: object(
    [
      'commandType',
      'commandVersion',
      'scopeRef',
      'targetRef',
      'requestedCapability',
      'payloadHash',
      'requestedAt',
      'highRiskAction',
    ],
    {
      commandType: namespace,
      commandVersion: { const: '1.0' },
      scopeRef: scope,
      targetRef: objectReference,
      requestedCapability: namespace,
      payloadHash,
      requestedAt: instant,
      highRiskAction: { type: 'boolean' },
    },
  ),
  authorizationDecisionView: object(
    [
      'authorizationDecisionRef',
      'outcome',
      'reasons',
      'policySnapshotRef',
      'effectiveScopeRef',
      'expiresAt',
    ],
    {
      authorizationDecisionRef: contentAddressedReference,
      outcome: localRef('authorizationOutcome'),
      reasons: array(reasonCode),
      policySnapshotRef: snapshotReference,
      effectiveScopeRef: scope,
      expiresAt: instant,
    },
  ),
  principalLookup: {
    oneOf: [
      object(['kind', 'principalRef'], {
        kind: { const: 'PRINCIPAL_REF' },
        principalRef: objectReference,
      }),
      object(['kind', 'identityKey'], {
        kind: { const: 'EXTERNAL_IDENTITY' },
        identityKey: localRef('externalIdentityKey'),
      }),
    ],
  },
  valueEnvelopeString: {
    oneOf: [
      object(['presence', 'value', 'evidenceRefs'], {
        presence: { const: 'PRESENT' },
        value: text,
        reasonCode,
        evidenceRefs: array(localRef('evidenceRef')),
        lastVerifiedAt: instant,
      }),
      object(['presence', 'evidenceRefs'], {
        presence: { enum: ['UNKNOWN', 'REDACTED', 'NOT_APPLICABLE', 'UNAVAILABLE'] },
        reasonCode,
        evidenceRefs: array(localRef('evidenceRef')),
        lastVerifiedAt: instant,
      }),
    ],
  },
  principalResolutionView: object(['principalRef', 'principalKind', 'status', 'displayName'], {
    principalRef: objectReference,
    principalKind: localRef('principalKind'),
    status: localRef('principalStatus'),
    displayName: localRef('valueEnvelopeString'),
    resolvedByLinkRef: objectReference,
  }),
  accessCheck: object(['principalRef', 'scopeRef', 'action', 'purpose', 'asOf'], {
    principalRef: objectReference,
    scopeRef: scope,
    action: namespace,
    resourceRef: objectReference,
    purpose: namespace,
    asOf: instant,
  }),
  enterpriseAccessCheck: object(['principalRef', 'scopeRef', 'action', 'purpose', 'asOf'], {
    principalRef: objectReference,
    scopeRef: object(['enterpriseId'], { enterpriseId: uuid }),
    action: namespace,
    resourceRef: objectReference,
    purpose: namespace,
    asOf: instant,
  }),
  projectAccessCheck: object(['principalRef', 'scopeRef', 'action', 'purpose', 'asOf'], {
    principalRef: objectReference,
    scopeRef: object(['enterpriseId', 'projectId'], {
      enterpriseId: uuid,
      projectId: uuid,
    }),
    action: namespace,
    resourceRef: objectReference,
    purpose: namespace,
    asOf: instant,
  }),
  accessDecision: object(
    [
      'outcome',
      'authorizationDecisionRef',
      'reasons',
      'effectiveRoles',
      'effectiveCapabilities',
      'expiresAt',
    ],
    {
      outcome: localRef('authorizationOutcome'),
      authorizationDecisionRef: contentAddressedReference,
      reasons: array(reasonCode),
      effectiveRoles: array(objectReference),
      effectiveCapabilities: array(objectReference),
      expiresAt: instant,
    },
  ),
  policySnapshotView: object(
    ['policySnapshotRef', 'policySetVersion', 'policySchemaRefs', 'effectiveFrom', 'payload'],
    {
      policySnapshotRef: snapshotReference,
      policySetVersion: text,
      policySchemaRefs: array(typedReference),
      effectiveFrom: instant,
      supersededAt: instant,
      payload: canonicalJson,
    },
  ),
} as const satisfies Readonly<Record<string, JsonSchema>>;

const operationSchemas = {
  'identity.register_principal': {
    payload: object(['principalKind', 'displayName', 'initialStatus'], {
      principalKind: localRef('principalKind'),
      displayName: text,
      initialStatus: { const: 'ACTIVE' },
    }),
  },
  'identity.link_external_identity': {
    payload: object(
      ['principalRef', 'identityKey', 'verifiedAt', 'verificationMethod', 'evidenceRefs'],
      {
        principalRef: objectReference,
        identityKey: localRef('externalIdentityKey'),
        verifiedAt: instant,
        verificationMethod: namespace,
        evidenceRefs: array(localRef('evidenceRef')),
        displayHint: text,
      },
    ),
  },
  'identity.assign_role': {
    payload: object(['principalRef', 'role', 'justification'], {
      principalRef: objectReference,
      role: localRef('scopedRole'),
      justification: localRef('justification'),
    }),
  },
  'identity.revoke_role': {
    payload: object(['effectiveAt', 'justification'], {
      effectiveAt: instant,
      justification: localRef('justification'),
    }),
  },
  'identity.grant_capability': {
    payload: object(['principalRef', 'capability', 'justification'], {
      principalRef: objectReference,
      capability: localRef('scopedCapability'),
      justification: localRef('justification'),
    }),
  },
  'identity.revoke_capability': {
    payload: object(['effectiveAt', 'justification'], {
      effectiveAt: instant,
      justification: localRef('justification'),
    }),
  },
  'identity.record_policy_snapshot': {
    payload: object(
      ['policySetVersion', 'policySchemaRefs', 'policyDocument', 'effectiveFrom', 'sourceRefs'],
      {
        policySetVersion: text,
        policySchemaRefs: array(typedReference, { nonEmpty: true, unique: true }),
        policyDocument: canonicalJson,
        effectiveFrom: instant,
        sourceRefs: array(typedReference),
      },
    ),
  },
  'identity.record_policy_version': {
    payload: object(
      ['policyRef', 'policySetVersion', 'policySchemaRefs', 'policyDocument', 'effectiveFrom'],
      {
        policyRef: policyVersionKey,
        policySetVersion: text,
        // 写入侧是 NonEmptySet：非空且无重复项。
        policySchemaRefs: array(typedReference, { nonEmpty: true, unique: true }),
        policyDocument: canonicalJson,
        effectiveFrom: policyInstant,
        supersedesRef: policyVersionKey,
      },
    ),
    result: {
      ...object(['policyVersionRef'], { policyVersionRef: policyVersionSnapshotReference }),
      payloadGuard: policyVersionGuardRef,
    },
  },
  'identity.resolve_principal': {
    payload: object(['lookup', 'purpose'], {
      lookup: localRef('principalLookup'),
      requiredScopeRef: scope,
      purpose: namespace,
    }),
    result: localRef('principalResolutionView'),
  },
  'identity.resolve_policy': {
    payload: object(['policyRef'], { policyRef: policyVersionKey }),
    result: {
      ...object(
        [
          'policyRef',
          'policyVersionRef',
          'policySetVersion',
          'policySchemaRefs',
          'policyDocument',
          'contentHash',
          'scopeRef',
          'effectiveFrom',
          'useStatus',
          'checkedAt',
        ],
        {
          policyRef: policyVersionKey,
          policyVersionRef: policyVersionSnapshotReference,
          policySetVersion: text,
          // 结果侧是一般 TypedReference[]；NonEmptySet 只是写入侧契约。
          policySchemaRefs: array(typedReference),
          policyDocument: canonicalJson,
          contentHash: payloadHash,
          scopeRef: enterpriseScope,
          effectiveFrom: policyInstant,
          supersededAt: policyInstant,
          useStatus: { enum: ['USABLE', 'NOT_YET_EFFECTIVE', 'SUPERSEDED', 'REVOKED'] },
          checkedAt: policyInstant,
        },
      ),
      payloadGuard: policyVersionGuardRef,
    },
  },
  'identity.authorize_command': {
    payload: object(['actorSnapshotRef', 'intent', 'authenticationContextRef'], {
      actorSnapshotRef: snapshotReference,
      intent: localRef('commandIntent'),
      authenticationContextRef: contentAddressedReference,
    }),
    result: localRef('authorizationDecisionView'),
  },
  'identity.check_enterprise_access': {
    payload: object(['check'], { check: localRef('enterpriseAccessCheck') }),
    result: localRef('accessDecision'),
  },
  'identity.check_project_access': {
    payload: object(['check'], { check: localRef('projectAccessCheck') }),
    result: localRef('accessDecision'),
  },
  'identity.check_human_only_capability': {
    payload: object(['principalRef', 'capabilityCode', 'scopeRef', 'actionAt'], {
      principalRef: objectReference,
      capabilityCode: namespace,
      scopeRef: scope,
      actionAt: instant,
    }),
    result: localRef('accessDecision'),
  },
  'identity.get_policy_snapshot': {
    payload: object(['policySnapshotRef'], { policySnapshotRef: snapshotReference }),
    result: localRef('policySnapshotView'),
  },
  'identity.PrincipalRegistered': {
    payload: object(['principalRef', 'principalKind', 'status'], {
      principalRef: objectReference,
      principalKind: localRef('principalKind'),
      status: localRef('principalStatus'),
    }),
  },
  'identity.ExternalIdentityLinked': {
    payload: object(
      ['externalIdentityLinkRef', 'principalRef', 'providerCode', 'externalIdentityLookupHashRef'],
      {
        externalIdentityLinkRef: objectReference,
        principalRef: objectReference,
        providerCode: namespace,
        externalIdentityLookupHashRef: contentAddressedReference,
      },
    ),
  },
  'identity.RoleAssigned': {
    payload: object(
      ['roleAssignmentRef', 'principalRef', 'roleCode', 'assignedScopeRef', 'effectivePeriod'],
      {
        roleAssignmentRef: objectReference,
        principalRef: objectReference,
        roleCode: namespace,
        assignedScopeRef: scope,
        effectivePeriod: localRef('effectivePeriod'),
      },
    ),
  },
  'identity.RoleRevoked': {
    payload: object(['roleAssignmentRef', 'principalRef', 'revokedAt', 'reasonCode'], {
      roleAssignmentRef: objectReference,
      principalRef: objectReference,
      revokedAt: instant,
      reasonCode,
    }),
  },
  'identity.CapabilityGranted': {
    payload: object(
      [
        'capabilityGrantRef',
        'principalRef',
        'capabilityCode',
        'grantedScopeRef',
        'effectivePeriod',
      ],
      {
        capabilityGrantRef: objectReference,
        principalRef: objectReference,
        capabilityCode: namespace,
        grantedScopeRef: scope,
        effectivePeriod: localRef('effectivePeriod'),
      },
    ),
  },
  'identity.CapabilityRevoked': {
    payload: object(['capabilityGrantRef', 'principalRef', 'revokedAt', 'reasonCode'], {
      capabilityGrantRef: objectReference,
      principalRef: objectReference,
      revokedAt: instant,
      reasonCode,
    }),
  },
  'identity.PolicySnapshotRecorded': {
    payload: object(['policySnapshotRef', 'policySetVersion', 'effectiveFrom'], {
      policySnapshotRef: snapshotReference,
      policySetVersion: text,
      effectiveFrom: instant,
    }),
  },
} as const satisfies Readonly<Record<string, OperationContractSchema>>;

function operationDefinitionName(type: string, suffix: 'payload' | 'result'): string {
  return `${type.replaceAll('.', '_')}_${suffix}`;
}

const operationDefinitions = Object.fromEntries(
  Object.entries(operationSchemas).flatMap(([type, contract]) => [
    [operationDefinitionName(type, 'payload'), contract.payload],
    ...('result' in contract
      ? [[operationDefinitionName(type, 'result'), contract.result] as const]
      : []),
  ]),
) as Readonly<Record<string, JsonSchema>>;

export const identityPolicyOperationContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(operationSchemas).map(([type, contract]) => [
      type,
      {
        payloadSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'payload')}`,
        ...('result' in contract
          ? { resultSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'result')}` }
          : {}),
      },
    ]),
  ) as Readonly<Record<string, ExecutableOperationContract>>,
);

export const identityPolicySchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...namedDefinitions,
    ...operationDefinitions,
  },
} as const satisfies JsonSchema;
