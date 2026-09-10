import type { PublicOperationDefinition } from './schema-types.js';

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
