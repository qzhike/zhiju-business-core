import type { OperationReferenceDeclaration, PublicOperationDefinition } from './schema-types.js';

/** Public object names for the new slice boundary; legacy internal aliases are not redefined. */
export const contextSliceObjectTypes = {
  'zhiju.project.context_source_slice': {
    owner: 'enterprise-project',
    kinds: ['OBJECT', 'CONTENT_ADDRESSED'],
  },
  'zhiju.project.project': { owner: 'enterprise-project', kinds: ['OBJECT'] },
  'zhiju.identity.policy': { owner: 'identity-policy', kinds: ['VERSIONED'] },
  'zhiju.identity.principal': { owner: 'identity-policy', kinds: ['PRINCIPAL'] },
} as const;

/** Public object names for the approved WorkOrder Draft / initial Context boundary. */
export const taskExecutionObjectTypes = {
  'zhiju.execution.context_snapshot': {
    owner: 'task-execution',
    kinds: ['OBJECT', 'SNAPSHOT'],
  },
  'zhiju.execution.work_order': { owner: 'task-execution', kinds: ['OBJECT'] },
  'zhiju.execution.task': { owner: 'task-execution', kinds: ['OBJECT'] },
  'zhiju.project.project': { owner: 'enterprise-project', kinds: ['OBJECT'] },
  'zhiju.execution.work_order_draft_snapshot': {
    owner: 'task-execution',
    kinds: ['CONTENT_ADDRESSED'],
  },
  'zhiju.project.context_source_slice': {
    owner: 'enterprise-project',
    kinds: ['CONTENT_ADDRESSED'],
  },
  'zhiju.identity.policy': { owner: 'identity-policy', kinds: ['VERSIONED'] },
  'zhiju.identity.principal': { owner: 'identity-policy', kinds: ['PRINCIPAL'] },
} as const;

/** Public object names for the approved PolicyVersion version-key/fact boundary. */
export const policyVersionObjectTypes = {
  'zhiju.identity.policy': { owner: 'identity-policy', kinds: ['VERSIONED'] },
  'zhiju.identity.policy_version': {
    owner: 'identity-policy',
    kinds: ['OBJECT', 'SNAPSHOT'],
  },
} as const;

const sliceOperations = [
  'project.capture_context_source_slice',
  'project.get_context_source_slice',
];

export function assertSliceOperationRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const type of sliceOperations) {
    const matching = operations.filter(
      (operation) => operation.type === type && operation.version === '1.0',
    );
    if (matching.length !== 1) throw new Error(`missing or duplicate slice operation: ${type}`);
    const op = matching[0];
    if (op === undefined) throw new Error('missing slice operation');
    const capture = type === sliceOperations[0];
    if (
      op.owner !== 'enterprise-project' ||
      op.schemaStatus !== 'FULL' ||
      op.kind !== (capture ? 'COMMAND' : 'QUERY') ||
      op.authorizationPurpose !==
        (capture ? 'project.context_source.capture' : 'project.context_source.read') ||
      op.dataClassification !== 'CUSTOMER_CONFIDENTIAL' ||
      op.payloadGuardPolicyRef?.type !== 'ep.context_source_slice' ||
      op.payloadGuardPolicyRef.version !== '1.0' ||
      (capture
        ? op.targetObjectType !== 'zhiju.project.context_source_slice' ||
          op.concurrencyMode !== 'CREATE' ||
          op.allowedConsistency !== undefined
        : op.targetObjectType !== undefined ||
          op.concurrencyMode !== undefined ||
          op.allowedConsistency?.length !== 1 ||
          op.allowedConsistency[0] !== 'AUTHORITATIVE')
    ) {
      throw new Error(`invalid slice registration: ${type}`);
    }
    const expected = capture
      ? [
          ['/targetRef', 'OBJECT', 'zhiju.project.context_source_slice'],
          ['/payload/projectRef', 'OBJECT', 'zhiju.project.project'],
          ['/payload/audience', 'PRINCIPAL', 'zhiju.identity.principal'],
          ['/payload/capturePolicyRef', 'VERSIONED', 'zhiju.identity.policy'],
        ]
      : [['/payload/sourceSliceRef', 'CONTENT_ADDRESSED', 'zhiju.project.context_source_slice']];
    const resultExpected = capture
      ? []
      : [
          ['/slice/projectRef', 'OBJECT', 'zhiju.project.project'],
          ['/slice/audience', 'PRINCIPAL', 'zhiju.identity.principal'],
          ['/slice/capturePolicyRef', 'VERSIONED', 'zhiju.identity.policy'],
        ];
    for (const [declared, required] of [
      [op.references, expected],
      [op.resultReferences ?? [], resultExpected],
    ] as const) {
      if (
        declared?.length !== required.length ||
        required.some(
          ([path, kind, objectType]) =>
            declared.filter(
              (ref) => ref.path === path && ref.kind === kind && ref.objectType === objectType,
            ).length !== 1,
        )
      ) {
        throw new Error(`invalid slice reference declarations: ${type}`);
      }
      for (const ref of declared) {
        const object = (
          contextSliceObjectTypes as Readonly<
            Record<string, { readonly owner: string; readonly kinds: readonly string[] }>
          >
        )[ref.objectType];
        if (!object?.kinds.includes(ref.kind))
          throw new Error('unregistered slice reference object type');
      }
    }
  }
}

export function assertSliceCompatibilityMetadata(
  operations: readonly PublicOperationDefinition[],
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
    readonly dataClassification: string;
  }[],
): void {
  for (const op of operations) {
    if (op.payloadGuardPolicyRef === undefined) continue;
    const entries = metadata.filter(
      (entry) => entry.type === op.type && entry.version === op.version,
    );
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry?.authorizationPurpose !== op.authorizationPurpose ||
      entry?.dataClassification !== op.dataClassification
    ) {
      throw new Error(`inconsistent operation compatibility metadata: ${op.type}`);
    }
  }
}

interface TaskExecutionRegistration {
  readonly type: string;
  readonly version?: '1.0' | '1.1' | '2.0';
  readonly kind: 'COMMAND' | 'QUERY';
  readonly owner: string;
  readonly schemaStatus: 'FULL';
  readonly targetObjectType?: string;
  readonly concurrencyMode?: 'CREATE';
  readonly allowedConsistency?: readonly 'AUTHORITATIVE'[];
  readonly authorizationPurpose: string;
  readonly dataClassification: string;
  readonly references: readonly OperationReferenceDeclaration[];
  readonly resultReferences: readonly OperationReferenceDeclaration[];
  readonly resultSchemaRef?: string;
}

/**
 * Executable result schema registered for the Initial Context Command. The
 * `$defs` names follow `operationSchemaDefinitionName(type, version, 'result')`
 * and are declared by the owning TaskExecution schema; the contract test
 * asserts this declaration still matches that derivation.
 */
const initialContextResultSchemaRef = {
  '1.0':
    'https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/execution_build_initial_context_snapshot_result',
  '1.1':
    'https://schemas.zhiju.local/modules/task-execution/1.0#/$defs/execution_build_initial_context_snapshot_v1_1_result',
} as const;

const taskExecutionRegistrations: readonly TaskExecutionRegistration[] = [
  {
    type: 'execution.get_work_order_draft',
    kind: 'QUERY',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    allowedConsistency: ['AUTHORITATIVE'],
    authorizationPurpose: 'execution.work_order.draft.read',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/payload/workOrderRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.work_order',
      },
    ],
    resultReferences: [
      {
        path: '/draftSnapshotRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
      },
    ],
  },
  {
    type: 'execution.build_initial_context_snapshot',
    kind: 'COMMAND',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    targetObjectType: 'zhiju.execution.context_snapshot',
    concurrencyMode: 'CREATE',
    authorizationPurpose: 'execution.context.build.initial',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.context_snapshot',
      },
      {
        path: '/payload/request/draftSnapshotRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
      },
      {
        path: '/payload/request/audience',
        kind: 'PRINCIPAL',
        objectType: 'zhiju.identity.principal',
      },
      {
        path: '/payload/request/sourceSlices',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.context_source_slice',
      },
      {
        path: '/payload/request/builderPolicyRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
    ],
    resultReferences: [
      {
        path: '/contextSnapshotRef',
        kind: 'SNAPSHOT',
        objectType: 'zhiju.execution.context_snapshot',
      },
    ],
    resultSchemaRef: initialContextResultSchemaRef['1.0'],
  },
  {
    type: 'execution.create_task',
    version: '2.0',
    kind: 'COMMAND',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    targetObjectType: 'zhiju.execution.task',
    concurrencyMode: 'CREATE',
    authorizationPurpose: 'execution.task.create',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.task',
      },
      {
        path: '/payload/projectRef',
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
      },
    ],
    resultReferences: [],
  },
  {
    type: 'execution.create_work_order',
    version: '1.1',
    kind: 'COMMAND',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    targetObjectType: 'zhiju.execution.work_order',
    concurrencyMode: 'CREATE',
    authorizationPurpose: 'task.execution.create_work_order',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.work_order',
      },
    ],
    resultReferences: [],
  },
  {
    type: 'execution.get_work_order_draft',
    version: '1.1',
    kind: 'QUERY',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    allowedConsistency: ['AUTHORITATIVE'],
    authorizationPurpose: 'execution.work_order.draft.read',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/payload/workOrderRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.work_order',
      },
    ],
    resultReferences: [
      {
        path: '/draftSnapshotRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
      },
    ],
  },
  {
    type: 'execution.build_initial_context_snapshot',
    version: '1.1',
    kind: 'COMMAND',
    owner: 'task-execution',
    schemaStatus: 'FULL',
    targetObjectType: 'zhiju.execution.context_snapshot',
    concurrencyMode: 'CREATE',
    authorizationPurpose: 'execution.context.build.initial',
    dataClassification: 'INTERNAL',
    references: [
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.execution.context_snapshot',
      },
      {
        path: '/payload/request/draftSnapshotRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.execution.work_order_draft_snapshot',
      },
      {
        path: '/payload/request/audience',
        kind: 'PRINCIPAL',
        objectType: 'zhiju.identity.principal',
      },
      {
        path: '/payload/request/sourceSlices',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.context_source_slice',
      },
      {
        path: '/payload/request/builderPolicyRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
    ],
    resultReferences: [
      {
        path: '/contextSnapshotRef',
        kind: 'SNAPSHOT',
        objectType: 'zhiju.execution.context_snapshot',
      },
    ],
    resultSchemaRef: initialContextResultSchemaRef['1.1'],
  },
] as const;

interface PolicyVersionRegistration {
  readonly type: string;
  readonly kind: 'COMMAND' | 'QUERY';
  readonly targetObjectType?: string;
  readonly concurrencyMode?: 'CREATE';
  readonly allowedConsistency?: readonly 'AUTHORITATIVE'[];
  readonly authorizationPurpose: string;
  readonly references: readonly OperationReferenceDeclaration[];
  readonly resultReferences: readonly OperationReferenceDeclaration[];
  readonly resultSchemaRef?: string;
}

/**
 * Approved #176/#181 registration for the two PolicyVersion entries. The
 * `resultSchemaRef` names the `$defs` entry derived by
 * `operationSchemaDefinitionName(type, version, 'result')`; the contract test
 * asserts this declaration still matches that derivation.
 */
const policyVersionRegistrations: readonly PolicyVersionRegistration[] = [
  {
    type: 'identity.record_policy_version',
    kind: 'COMMAND',
    targetObjectType: 'zhiju.identity.policy_version',
    concurrencyMode: 'CREATE',
    authorizationPurpose: 'identity.policy.record_policy_version',
    references: [
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.identity.policy_version',
      },
      {
        path: '/payload/policyRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
      {
        path: '/payload/supersedesRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
    ],
    resultReferences: [
      {
        path: '/policyVersionRef',
        kind: 'SNAPSHOT',
        objectType: 'zhiju.identity.policy_version',
      },
    ],
    resultSchemaRef:
      'https://schemas.zhiju.local/modules/identity-policy/1.0#/$defs/identity_record_policy_version_result',
  },
  {
    type: 'identity.resolve_policy',
    kind: 'QUERY',
    allowedConsistency: ['AUTHORITATIVE'],
    authorizationPurpose: 'identity.policy.resolve_policy',
    references: [
      {
        path: '/payload/policyRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
    ],
    resultReferences: [
      {
        path: '/policyRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.identity.policy',
      },
      {
        path: '/policyVersionRef',
        kind: 'SNAPSHOT',
        objectType: 'zhiju.identity.policy_version',
      },
    ],
  },
] as const;

/** Both operations share the one approved `identity.policy_version@1.0` entry. */
const policyVersionGuardPolicyRef = { type: 'identity.policy_version', version: '1.0' } as const;

function sameRegistrationValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertPolicyVersionOperationRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const expected of policyVersionRegistrations) {
    const matching = operations.filter(
      (operation) => operation.type === expected.type && operation.version === '1.0',
    );
    if (matching.length !== 1)
      throw new Error(`missing or duplicate policy version operation: ${expected.type}`);
    const operation = matching[0];
    if (operation === undefined) throw new Error('missing policy version operation');
    if (
      operation.kind !== expected.kind ||
      operation.owner !== 'identity-policy' ||
      operation.schemaStatus !== 'FULL' ||
      operation.targetObjectType !== expected.targetObjectType ||
      operation.concurrencyMode !== expected.concurrencyMode ||
      !sameRegistrationValue(operation.allowedConsistency, expected.allowedConsistency) ||
      operation.authorizationPurpose !== expected.authorizationPurpose ||
      operation.dataClassification !== 'INTERNAL' ||
      !sameRegistrationValue(operation.payloadGuardPolicyRef, policyVersionGuardPolicyRef) ||
      operation.resultSchemaRef !== expected.resultSchemaRef ||
      !sameRegistrationValue(operation.references ?? [], expected.references) ||
      !sameRegistrationValue(operation.resultReferences ?? [], expected.resultReferences)
    ) {
      throw new Error(`invalid policy version registration: ${expected.type}`);
    }
    for (const ref of [...expected.references, ...expected.resultReferences]) {
      const object = (
        policyVersionObjectTypes as Readonly<
          Record<string, { readonly owner: string; readonly kinds: readonly string[] }>
        >
      )[ref.objectType];
      if (!object?.kinds.includes(ref.kind) || object.owner !== 'identity-policy')
        throw new Error(`unregistered policy version reference object type: ${ref.objectType}`);
    }
  }
}

export function assertPolicyVersionCompatibilityMetadata(
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
    readonly dataClassification: string;
  }[],
): void {
  for (const expected of policyVersionRegistrations) {
    const entries = metadata.filter(
      (entry) => entry.type === expected.type && entry.version === '1.0',
    );
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry?.authorizationPurpose !== expected.authorizationPurpose ||
      entry.dataClassification !== 'INTERNAL'
    ) {
      throw new Error(`inconsistent policy version compatibility metadata: ${expected.type}`);
    }
  }
}

export function assertTaskExecutionOperationRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const expected of taskExecutionRegistrations) {
    const matching = operations.filter(
      (operation) =>
        operation.type === expected.type && operation.version === (expected.version ?? '1.0'),
    );
    if (matching.length !== 1)
      throw new Error(`missing or duplicate task execution operation: ${expected.type}`);
    const operation = matching[0];
    if (operation === undefined) throw new Error('missing task execution operation');
    if (
      operation.kind !== expected.kind ||
      operation.owner !== expected.owner ||
      operation.schemaStatus !== expected.schemaStatus ||
      operation.targetObjectType !== expected.targetObjectType ||
      operation.concurrencyMode !== expected.concurrencyMode ||
      !sameRegistrationValue(operation.allowedConsistency, expected.allowedConsistency) ||
      operation.authorizationPurpose !== expected.authorizationPurpose ||
      operation.dataClassification !== expected.dataClassification ||
      operation.payloadGuardPolicyRef !== undefined ||
      operation.resultSchemaRef !== expected.resultSchemaRef ||
      !sameRegistrationValue(operation.references ?? [], expected.references) ||
      !sameRegistrationValue(operation.resultReferences ?? [], expected.resultReferences)
    ) {
      throw new Error(`invalid task execution registration: ${expected.type}`);
    }
    for (const ref of [...expected.references, ...expected.resultReferences]) {
      const object = (
        taskExecutionObjectTypes as Readonly<
          Record<string, { readonly owner: string; readonly kinds: readonly string[] }>
        >
      )[ref.objectType];
      if (!object?.kinds.includes(ref.kind))
        throw new Error(`unregistered task execution reference object type: ${ref.objectType}`);
    }
  }
}

export function assertTaskExecutionCompatibilityMetadata(
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
    readonly dataClassification: string;
  }[],
): void {
  for (const expected of taskExecutionRegistrations) {
    const entries = metadata.filter(
      (entry) => entry.type === expected.type && entry.version === (expected.version ?? '1.0'),
    );
    const entry = entries[0];
    if (entries.length !== 1 || entry === undefined) {
      throw new Error(`inconsistent task execution compatibility metadata: ${expected.type}`);
    }
    if (
      entry.authorizationPurpose !== expected.authorizationPurpose ||
      entry.dataClassification !== expected.dataClassification
    ) {
      throw new Error(`inconsistent task execution compatibility metadata: ${expected.type}`);
    }
  }
}

/**
 * The approved per-version creation Purpose mapping of Spec 003 §15.1
 * (design decision §13, P-190-1 option A): the exact `(type, version)` keys of
 * the four published creation operations and the one Purpose each of them
 * accepts.
 *
 * Executable sources stay the two published registries:
 * `operation-compatibility-metadata.v1.json` carries all four approved values
 * (including the two `@1.0` ones), `public-api.v1.json` carries owner/kind.
 * The two `@1.0` public API entries legitimately omit `authorizationPurpose`;
 * that historical shape stays accepted and is never read as "no Purpose".
 * `contracts/src/generated/task-execution-creation-purposes.json` is the
 * derived projection consumed at run time, and this table is the approved
 * expectation it is checked against. No registry entry is rewritten, no alias
 * (`execution.work_order.create`) and no cross-version fallback is accepted.
 */
export interface TaskExecutionCreationPurposeRegistration {
  readonly type: string;
  readonly version: string;
  readonly kind: string;
  readonly owner: string;
  readonly authorizationPurpose: string;
}

export const taskExecutionCreationPurposes: readonly TaskExecutionCreationPurposeRegistration[] = [
  {
    type: 'execution.create_task',
    version: '1.0',
    kind: 'COMMAND',
    owner: 'task-execution',
    authorizationPurpose: 'task.execution.create_task',
  },
  {
    type: 'execution.create_task',
    version: '2.0',
    kind: 'COMMAND',
    owner: 'task-execution',
    authorizationPurpose: 'execution.task.create',
  },
  {
    type: 'execution.create_work_order',
    version: '1.0',
    kind: 'COMMAND',
    owner: 'task-execution',
    authorizationPurpose: 'task.execution.create_work_order',
  },
  {
    type: 'execution.create_work_order',
    version: '1.1',
    kind: 'COMMAND',
    owner: 'task-execution',
    authorizationPurpose: 'task.execution.create_work_order',
  },
] as const;

/**
 * Every approved creation version is registered exactly once with its approved
 * owner/kind, and a declared `authorizationPurpose` — where the historical
 * `@1.0` entries declare none — is the approved value.
 */
export function assertTaskExecutionCreationPurposeRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const expected of taskExecutionCreationPurposes) {
    const key = `${expected.type}@${expected.version}`;
    const matching = operations.filter(
      (operation) => operation.type === expected.type && operation.version === expected.version,
    );
    if (matching.length !== 1) throw new Error(`missing or duplicate creation operation: ${key}`);
    const operation = matching[0];
    if (operation === undefined) throw new Error(`missing creation operation: ${key}`);
    if (operation.kind !== expected.kind || operation.owner !== expected.owner) {
      throw new Error(`invalid creation operation registration: ${key}`);
    }
    if (
      operation.authorizationPurpose !== undefined &&
      operation.authorizationPurpose !== expected.authorizationPurpose
    ) {
      throw new Error(`invalid creation operation Purpose: ${key}`);
    }
  }
}

/**
 * The compatibility metadata carries the approved Purpose of all four creation
 * versions, including the two whose public API entry omits the field. A
 * missing, duplicated, aliased or rewritten value fails here.
 */
export function assertTaskExecutionCreationPurposeMetadata(
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
  }[],
): void {
  for (const expected of taskExecutionCreationPurposes) {
    const entries = metadata.filter(
      (entry) => entry.type === expected.type && entry.version === expected.version,
    );
    const entry = entries[0];
    if (entries.length !== 1 || entry?.authorizationPurpose !== expected.authorizationPurpose) {
      throw new Error(
        `inconsistent creation Purpose metadata: ${expected.type}@${expected.version}`,
      );
    }
  }
}

/**
 * Public object names for the approved IM-06 (#191) resolution receipt
 * boundary. `CommandReceipt` is the EnterpriseProject-owned command receipt
 * that carries the confirmation; the ActorSnapshot and the
 * AuthorizationDecision are referenced by their exact IdentityPolicy identity,
 * because their payload hashes are not part of the EnterpriseProject trusted
 * transaction facts and are therefore never asserted by this module.
 */
export const resolutionReceiptObjectTypes = {
  'zhiju.project.command_receipt': {
    owner: 'enterprise-project',
    kinds: ['CONTENT_ADDRESSED'],
  },
  'zhiju.project.customer_material': {
    owner: 'enterprise-project',
    kinds: ['OBJECT', 'VERSIONED'],
  },
  'zhiju.project.source_material': {
    owner: 'enterprise-project',
    kinds: ['CONTENT_ADDRESSED'],
  },
  'zhiju.project.business_decision': {
    owner: 'enterprise-project',
    kinds: ['CONTENT_ADDRESSED'],
  },
  'zhiju.identity.actor_snapshot': { owner: 'identity-policy', kinds: ['OBJECT'] },
  'zhiju.identity.authorization_decision': { owner: 'identity-policy', kinds: ['OBJECT'] },
  'zhiju.identity.principal': { owner: 'identity-policy', kinds: ['PRINCIPAL'] },
} as const;

interface ResolutionReceiptRegistration {
  readonly type: string;
  readonly kind: 'QUERY';
  readonly owner: string;
  readonly schemaStatus: 'FULL';
  readonly allowedConsistency: readonly 'AUTHORITATIVE'[];
  readonly authorizationPurpose: string;
  readonly dataClassification: string;
  readonly references: readonly OperationReferenceDeclaration[];
  readonly resultReferences: readonly OperationReferenceDeclaration[];
}

const resolutionReceiptRegistrations: readonly ResolutionReceiptRegistration[] = [
  {
    type: 'project.get_resolution_receipt',
    kind: 'QUERY',
    owner: 'enterprise-project',
    schemaStatus: 'FULL',
    allowedConsistency: ['AUTHORITATIVE'],
    authorizationPurpose: 'project.resolution_receipt.read',
    dataClassification: 'CUSTOMER_CONFIDENTIAL',
    references: [
      {
        path: '/payload/commandReceiptRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.command_receipt',
      },
    ],
    resultReferences: [
      {
        path: '/commandReceiptRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.command_receipt',
      },
      {
        path: '/targetRef',
        kind: 'OBJECT',
        objectType: 'zhiju.project.customer_material',
      },
      {
        path: '/candidateVersionRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.project.customer_material',
      },
      {
        path: '/confirmedVersionRef',
        kind: 'VERSIONED',
        objectType: 'zhiju.project.customer_material',
      },
      {
        path: '/sourceMaterialRefs',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.source_material',
      },
      {
        path: '/decisionRef',
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.project.business_decision',
      },
      {
        path: '/actorRef',
        kind: 'PRINCIPAL',
        objectType: 'zhiju.identity.principal',
      },
      {
        path: '/actorSnapshotRef',
        kind: 'OBJECT',
        objectType: 'zhiju.identity.actor_snapshot',
      },
      {
        path: '/authorizationDecisionRef',
        kind: 'OBJECT',
        objectType: 'zhiju.identity.authorization_decision',
      },
    ],
  },
] as const;

export function assertResolutionReceiptOperationRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const expected of resolutionReceiptRegistrations) {
    const matching = operations.filter(
      (operation) => operation.type === expected.type && operation.version === '1.0',
    );
    if (matching.length !== 1)
      throw new Error(`missing or duplicate resolution receipt operation: ${expected.type}`);
    const operation = matching[0];
    if (operation === undefined) throw new Error('missing resolution receipt operation');
    if (
      operation.kind !== expected.kind ||
      operation.owner !== expected.owner ||
      operation.schemaStatus !== expected.schemaStatus ||
      operation.targetObjectType !== undefined ||
      operation.concurrencyMode !== undefined ||
      !sameRegistrationValue(operation.allowedConsistency, expected.allowedConsistency) ||
      operation.authorizationPurpose !== expected.authorizationPurpose ||
      operation.dataClassification !== expected.dataClassification ||
      operation.payloadGuardPolicyRef !== undefined ||
      !sameRegistrationValue(operation.references ?? [], expected.references) ||
      !sameRegistrationValue(operation.resultReferences ?? [], expected.resultReferences)
    ) {
      throw new Error(`invalid resolution receipt registration: ${expected.type}`);
    }
    for (const ref of [...expected.references, ...expected.resultReferences]) {
      const object = (
        resolutionReceiptObjectTypes as Readonly<
          Record<string, { readonly owner: string; readonly kinds: readonly string[] }>
        >
      )[ref.objectType];
      if (!object?.kinds.includes(ref.kind))
        throw new Error(`unregistered resolution receipt reference object type: ${ref.objectType}`);
    }
  }
}

export function assertResolutionReceiptCompatibilityMetadata(
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
    readonly dataClassification: string;
  }[],
): void {
  for (const expected of resolutionReceiptRegistrations) {
    const entries = metadata.filter(
      (entry) => entry.type === expected.type && entry.version === '1.0',
    );
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry?.authorizationPurpose !== expected.authorizationPurpose ||
      entry.dataClassification !== expected.dataClassification
    ) {
      throw new Error(`inconsistent resolution receipt compatibility metadata: ${expected.type}`);
    }
  }
}

/**
 * Build-time registration record for the approved IM-06 (#192) Revision
 * execution eligibility Query. The operation is a read-only AUTHORITATIVE
 * Query over QualityGovernance-owned snapshots: it introduces no new object
 * type and declares no reference surface, so an added `references`,
 * `resultReferences`, target, guard policy or explicit result schema is a
 * registration regression rather than an accepted extension.
 */
interface RevisionEligibilityRegistration {
  readonly type: string;
  readonly kind: 'QUERY';
  readonly owner: string;
  readonly schemaStatus: 'FULL';
  readonly allowedConsistency: readonly 'AUTHORITATIVE'[];
  readonly authorizationPurpose: string;
  readonly dataClassification: string;
}

const revisionEligibilityRegistrations: readonly RevisionEligibilityRegistration[] = [
  {
    type: 'quality.get_revision_execution_eligibility',
    kind: 'QUERY',
    owner: 'quality-governance',
    schemaStatus: 'FULL',
    allowedConsistency: ['AUTHORITATIVE'],
    authorizationPurpose: 'quality.revision.execution_eligibility.read',
    dataClassification: 'INTERNAL',
  },
] as const;

export function assertRevisionEligibilityOperationRegistrations(
  operations: readonly (Omit<PublicOperationDefinition, 'version'> & {
    readonly version: string;
  })[],
): void {
  for (const expected of revisionEligibilityRegistrations) {
    const matching = operations.filter(
      (operation) => operation.type === expected.type && operation.version === '1.0',
    );
    if (matching.length !== 1)
      throw new Error(`missing or duplicate revision eligibility operation: ${expected.type}`);
    const operation = matching[0];
    if (operation === undefined) throw new Error('missing revision eligibility operation');
    if (
      operation.kind !== expected.kind ||
      operation.owner !== expected.owner ||
      operation.schemaStatus !== expected.schemaStatus ||
      operation.targetObjectType !== undefined ||
      operation.concurrencyMode !== undefined ||
      !sameRegistrationValue(operation.allowedConsistency, expected.allowedConsistency) ||
      operation.authorizationPurpose !== expected.authorizationPurpose ||
      operation.dataClassification !== expected.dataClassification ||
      operation.payloadGuardPolicyRef !== undefined ||
      operation.references !== undefined ||
      operation.resultReferences !== undefined ||
      operation.resultSchemaRef !== undefined
    ) {
      throw new Error(`invalid revision eligibility registration: ${expected.type}`);
    }
  }
}

export function assertRevisionEligibilityCompatibilityMetadata(
  metadata: readonly {
    readonly type: string;
    readonly version: string;
    readonly authorizationPurpose: string;
    readonly dataClassification: string;
  }[],
): void {
  for (const expected of revisionEligibilityRegistrations) {
    const entries = metadata.filter(
      (entry) => entry.type === expected.type && entry.version === '1.0',
    );
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry?.authorizationPurpose !== expected.authorizationPurpose ||
      entry.dataClassification !== expected.dataClassification
    ) {
      throw new Error(`inconsistent revision eligibility compatibility metadata: ${expected.type}`);
    }
  }
}
