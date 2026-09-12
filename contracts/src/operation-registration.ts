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
  readonly version?: '1.0' | '1.1';
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

function sameRegistrationValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
