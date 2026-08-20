// Pure JSON Schema structural compatibility helpers for IM-01 v1.0 baselines.
//
// Used by:
//   - tools/contracts/generate-baseline.mts (stable stringify)
//   - tools/contracts/check-compatibility.mts (current vs frozen baseline)
//   - tools/contracts/lib/schema-compatibility.test.ts (rule matrix)
//
// No I/O. Given the same inputs, outputs are deterministic.

export type CompatibilitySeverity =
  'BREAKING' | 'MANUAL_REVIEW_REQUIRED' | 'COMPATIBLE_MINOR' | 'INFO';

export interface CompatibilityFinding {
  readonly severity: CompatibilitySeverity;
  readonly target: string;
  readonly path: string;
  readonly keyword: string;
  readonly detail: string;
}

export interface OperationCompatibilityRecord {
  readonly type: string;
  readonly version: string;
  readonly kind: string;
  readonly owner: string;
  readonly schemaStatus: string;
  readonly payloadSchemaRef: string | null;
  readonly resultSchemaRef: string | null;
  readonly manualReviewFingerprint: string | null;
}

export interface CompatibilityApproval {
  readonly kind: string;
  readonly target: string;
  readonly status: 'APPROVED' | 'REQUIRED' | string;
}

export type SchemaObject = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/** Recursively sort object keys by UTF-8 byte order for stable baseline JSON. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([left], [right]) => compareUtf8(left, right));
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    result[key] = sortKeysDeep(item);
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export function deepEqualStable(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortKeysDeep(left)) === JSON.stringify(sortKeysDeep(right));
}

function finding(
  severity: CompatibilitySeverity,
  target: string,
  path: string,
  keyword: string,
  detail: string,
): CompatibilityFinding {
  return { severity, target, path, keyword, detail };
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === 'string')) return undefined;
  return value;
}

function normalizeTypes(typeValue: unknown): readonly string[] | undefined {
  if (typeof typeValue === 'string') return [typeValue];
  return asStringArray(typeValue);
}

function setEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function isSubset(subset: ReadonlySet<string>, of: ReadonlySet<string>): boolean {
  for (const value of subset) {
    if (!of.has(value)) return false;
  }
  return true;
}

function constraintNumber(schema: SchemaObject, key: string): number | undefined {
  const value = schema[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Metadata-only keys that never change the acceptance set by themselves. */
const IGNORABLE_SCHEMA_KEYS = new Set([
  '$comment',
  '$id',
  '$schema',
  'default',
  'deprecated',
  'description',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);

/**
 * Keywords that compareSchemaNodes already inspects explicitly. Any other key
 * that differs is treated as an unknown assertion and fails closed.
 */
const HANDLED_SCHEMA_KEYS = new Set([
  '$defs',
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contains',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'if',
  'items',
  'maxContains',
  'maximum',
  'maxItems',
  'maxLength',
  'maxProperties',
  'minContains',
  'minimum',
  'minItems',
  'minLength',
  'minProperties',
  'multipleOf',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'required',
  'then',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
]);

function compareBooleanConstraint(
  baseline: SchemaObject,
  current: SchemaObject,
  key: 'uniqueItems',
  target: string,
  path: string,
): CompatibilityFinding[] {
  const baselineValue = baseline[key];
  const currentValue = current[key];
  if (baselineValue === currentValue) return [];
  if (baselineValue !== true && currentValue === true) {
    return [
      finding(
        'BREAKING',
        target,
        path,
        `${key}-added`,
        `${key} tightened from ${String(baselineValue)} to true`,
      ),
    ];
  }
  if (baselineValue === true && currentValue !== true) {
    return [
      finding(
        'COMPATIBLE_MINOR',
        target,
        path,
        `${key}-removed`,
        `${key} relaxed from true to ${String(currentValue)}`,
      ),
    ];
  }
  return [
    finding(
      'BREAKING',
      target,
      path,
      `${key}-changed`,
      `${key} changed from ${String(baselineValue)} to ${String(currentValue)}`,
    ),
  ];
}

/**
 * Assertion keywords whose removal is safely widening on its own (they only
 * subtract from the acceptance set while present).
 */
function compareRemovableWideningAssertion(
  baseline: SchemaObject,
  current: SchemaObject,
  key: string,
  target: string,
  path: string,
): CompatibilityFinding[] {
  const baselineValue = baseline[key];
  const currentValue = current[key];
  if (deepEqualStable(baselineValue, currentValue)) return [];
  if (baselineValue === undefined && currentValue !== undefined) {
    return [
      finding('BREAKING', target, `${path}/${key}`, `${key}-added`, `${key} assertion added`),
    ];
  }
  if (baselineValue !== undefined && currentValue === undefined) {
    return [
      finding(
        'COMPATIBLE_MINOR',
        target,
        `${path}/${key}`,
        `${key}-removed`,
        `${key} assertion removed`,
      ),
    ];
  }
  return [
    finding('BREAKING', target, `${path}/${key}`, `${key}-changed`, `${key} assertion changed`),
  ];
}

/**
 * Keywords whose add/remove/change interacts with siblings (e.g. additionalProperties)
 * so acceptance-set impact cannot be inferred from presence alone. Fail closed.
 */
function compareContextSensitiveAssertion(
  baseline: SchemaObject,
  current: SchemaObject,
  key: string,
  target: string,
  path: string,
): CompatibilityFinding[] {
  const baselineValue = baseline[key];
  const currentValue = current[key];
  if (deepEqualStable(baselineValue, currentValue)) return [];
  return [
    finding(
      'BREAKING',
      target,
      `${path}/${key}`,
      `${key}-changed`,
      `${key} changed; acceptance-set impact is context-sensitive and treated as breaking`,
    ),
  ];
}

function compareMultipleOf(
  baseline: SchemaObject,
  current: SchemaObject,
  target: string,
  path: string,
): CompatibilityFinding[] {
  const baselineValue = constraintNumber(baseline, 'multipleOf');
  const currentValue = constraintNumber(current, 'multipleOf');
  if (baselineValue === currentValue) return [];
  if (baselineValue === undefined && currentValue !== undefined) {
    return [
      finding(
        'BREAKING',
        target,
        path,
        'multipleOf-added',
        `multipleOf constraint added with value ${currentValue}`,
      ),
    ];
  }
  if (baselineValue !== undefined && currentValue === undefined) {
    return [
      finding(
        'COMPATIBLE_MINOR',
        target,
        path,
        'multipleOf-removed',
        'multipleOf constraint removed',
      ),
    ];
  }
  // Divisor changes are not ordered by numeric magnitude (2 → 1.5 rejects 2).
  return [
    finding(
      'BREAKING',
      target,
      path,
      'multipleOf-changed',
      `multipleOf changed from ${String(baselineValue)} to ${String(currentValue)}`,
    ),
  ];
}

/**
 * Compare two JSON Schema nodes. `baseline` is the frozen consumer contract;
 * `current` must remain backward-compatible with it for Minor changes.
 */
export function compareSchemaNodes(
  baseline: unknown,
  current: unknown,
  target: string,
  path: string,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];

  if (baseline === undefined && current === undefined) return findings;
  if (baseline === undefined) {
    findings.push(
      finding(
        'COMPATIBLE_MINOR',
        target,
        path,
        'schema-added',
        'schema node added relative to baseline',
      ),
    );
    return findings;
  }
  if (current === undefined) {
    findings.push(finding('BREAKING', target, path, 'schema-removed', 'schema node removed'));
    return findings;
  }

  // Boolean schemas (true/false) — any change is breaking.
  if (typeof baseline === 'boolean' || typeof current === 'boolean') {
    if (baseline !== current) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'boolean-schema-changed',
          `boolean schema changed from ${String(baseline)} to ${String(current)}`,
        ),
      );
    }
    return findings;
  }

  if (!isObject(baseline) || !isObject(current)) {
    if (!deepEqualStable(baseline, current)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'schema-shape-changed',
          'non-object schema shape changed',
        ),
      );
    }
    return findings;
  }

  const baselineRef = baseline.$ref;
  const currentRef = current.$ref;
  if (typeof baselineRef === 'string' || typeof currentRef === 'string') {
    if (baselineRef !== currentRef) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'ref-changed',
          `$ref changed from ${String(baselineRef)} to ${String(currentRef)}`,
        ),
      );
    }
    // When both sides are pure $ref nodes, stop; otherwise continue comparing siblings.
    const baselineKeys = Object.keys(baseline).filter((key) => key !== '$ref');
    const currentKeys = Object.keys(current).filter((key) => key !== '$ref');
    if (baselineKeys.length === 0 && currentKeys.length === 0) return findings;
  }

  if (baseline.const !== current.const) {
    findings.push(
      finding(
        'BREAKING',
        target,
        path,
        'const-changed',
        `const changed from ${JSON.stringify(baseline.const)} to ${JSON.stringify(current.const)}`,
      ),
    );
  }

  const baselineEnum =
    asStringArray(baseline.enum) ??
    (Array.isArray(baseline.enum) ? baseline.enum.map(String) : undefined);
  const currentEnum =
    asStringArray(current.enum) ??
    (Array.isArray(current.enum) ? current.enum.map(String) : undefined);
  if (baselineEnum !== undefined || currentEnum !== undefined) {
    const baselineSet = new Set(baselineEnum ?? []);
    const currentSet = new Set(currentEnum ?? []);
    if (!setEqual(baselineSet, currentSet)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'enum-changed',
          `closed enum changed baseline=[${[...baselineSet].join(',')}] current=[${[...currentSet].join(',')}]`,
        ),
      );
    }
  }

  const baselineTypes = normalizeTypes(baseline.type);
  const currentTypes = normalizeTypes(current.type);
  if (baselineTypes !== undefined || currentTypes !== undefined) {
    const baselineSet = new Set(baselineTypes ?? []);
    const currentSet = new Set(currentTypes ?? []);
    if (!setEqual(baselineSet, currentSet)) {
      if (
        currentTypes !== undefined &&
        baselineTypes !== undefined &&
        isSubset(currentSet, baselineSet)
      ) {
        findings.push(
          finding(
            'BREAKING',
            target,
            path,
            'type-narrowed',
            `type narrowed from [${baselineTypes.join(',')}] to [${currentTypes.join(',')}]`,
          ),
        );
      } else if (
        currentTypes !== undefined &&
        baselineTypes !== undefined &&
        isSubset(baselineSet, currentSet)
      ) {
        findings.push(
          finding(
            'COMPATIBLE_MINOR',
            target,
            path,
            'type-widened',
            `type widened from [${baselineTypes.join(',')}] to [${currentTypes.join(',')}]`,
          ),
        );
      } else {
        findings.push(
          finding(
            'BREAKING',
            target,
            path,
            'type-changed',
            `type changed from ${JSON.stringify(baseline.type)} to ${JSON.stringify(current.type)}`,
          ),
        );
      }
    }
  }

  if (baseline.pattern !== current.pattern) {
    if (typeof baseline.pattern === 'string' && current.pattern === undefined) {
      findings.push(
        finding('COMPATIBLE_MINOR', target, path, 'pattern-removed', 'pattern constraint removed'),
      );
    } else {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'pattern-changed',
          `pattern changed from ${String(baseline.pattern)} to ${String(current.pattern)}`,
        ),
      );
    }
  }

  findings.push(...compareBooleanConstraint(baseline, current, 'uniqueItems', target, path));

  if (baseline.format !== current.format) {
    findings.push(
      finding(
        'BREAKING',
        target,
        path,
        'format-changed',
        `format changed from ${String(baseline.format)} to ${String(current.format)}`,
      ),
    );
  }

  for (const key of ['not', 'propertyNames'] as const) {
    findings.push(...compareRemovableWideningAssertion(baseline, current, key, target, path));
  }

  for (const key of [
    'contains',
    'prefixItems',
    'patternProperties',
    'dependentSchemas',
    'unevaluatedItems',
  ] as const) {
    findings.push(...compareContextSensitiveAssertion(baseline, current, key, target, path));
  }

  findings.push(...compareMultipleOf(baseline, current, target, path));

  for (const [key, direction] of [
    ['minimum', 'min'],
    ['minLength', 'min'],
    ['minItems', 'min'],
    ['minProperties', 'min'],
    ['minContains', 'min'],
    ['exclusiveMinimum', 'min'],
    ['maximum', 'max'],
    ['maxLength', 'max'],
    ['maxItems', 'max'],
    ['maxProperties', 'max'],
    ['maxContains', 'max'],
    ['exclusiveMaximum', 'max'],
  ] as const) {
    const baselineValue = constraintNumber(baseline, key);
    const currentValue = constraintNumber(current, key);
    if (baselineValue === currentValue) continue;
    if (baselineValue === undefined && currentValue !== undefined) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          `${key}-added`,
          `${key} constraint added with value ${currentValue}`,
        ),
      );
      continue;
    }
    if (baselineValue !== undefined && currentValue === undefined) {
      findings.push(
        finding('COMPATIBLE_MINOR', target, path, `${key}-removed`, `${key} constraint removed`),
      );
      continue;
    }
    if (baselineValue === undefined || currentValue === undefined) continue;
    const narrowed =
      direction === 'min' ? currentValue > baselineValue : currentValue < baselineValue;
    findings.push(
      finding(
        narrowed ? 'BREAKING' : 'COMPATIBLE_MINOR',
        target,
        path,
        narrowed ? `${key}-narrowed` : `${key}-widened`,
        `${key} changed from ${baselineValue} to ${currentValue}`,
      ),
    );
  }

  if (baseline.additionalProperties !== current.additionalProperties) {
    const baselineAp = baseline.additionalProperties;
    const currentAp = current.additionalProperties;
    // Treat open↔closed flips and schema-shaped additionalProperties changes as breaking.
    if (baselineAp === false && currentAp !== false) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'additionalProperties-opened',
          'additionalProperties changed from false to open/schema',
        ),
      );
    } else if (baselineAp !== false && currentAp === false) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'additionalProperties-closed',
          'additionalProperties changed from open/schema to false',
        ),
      );
    } else if (!deepEqualStable(baselineAp, currentAp)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          path,
          'additionalProperties-changed',
          'additionalProperties schema changed',
        ),
      );
    }
  }

  const baselineRequired = new Set(asStringArray(baseline.required) ?? []);
  const currentRequired = new Set(asStringArray(current.required) ?? []);
  for (const key of currentRequired) {
    if (!baselineRequired.has(key)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/required`,
          'required-added',
          `required field added: ${key}`,
        ),
      );
    }
  }
  for (const key of baselineRequired) {
    if (!currentRequired.has(key)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/required`,
          'required-removed',
          `required field removed: ${key}`,
        ),
      );
    }
  }

  const baselineProperties = isObject(baseline.properties) ? baseline.properties : {};
  const currentProperties = isObject(current.properties) ? current.properties : {};
  const propertyNames = new Set([
    ...Object.keys(baselineProperties),
    ...Object.keys(currentProperties),
  ]);
  for (const name of propertyNames) {
    const baselineProp = baselineProperties[name];
    const currentProp = currentProperties[name];
    if (baselineProp === undefined && currentProp !== undefined) {
      if (currentRequired.has(name)) {
        findings.push(
          finding(
            'BREAKING',
            target,
            `${path}/properties/${name}`,
            'required-property-added',
            `new required property ${name}`,
          ),
        );
      } else {
        findings.push(
          finding(
            'COMPATIBLE_MINOR',
            target,
            `${path}/properties/${name}`,
            'optional-property-added',
            `new optional property ${name}`,
          ),
        );
      }
      continue;
    }
    if (baselineProp !== undefined && currentProp === undefined) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/properties/${name}`,
          'property-removed',
          `property removed: ${name}`,
        ),
      );
      continue;
    }
    findings.push(
      ...compareSchemaNodes(baselineProp, currentProp, target, `${path}/properties/${name}`),
    );
  }

  if ('items' in baseline || 'items' in current) {
    findings.push(...compareSchemaNodes(baseline.items, current.items, target, `${path}/items`));
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const baselineVariants = baseline[keyword];
    const currentVariants = current[keyword];
    if (baselineVariants === undefined && currentVariants === undefined) continue;
    if (!Array.isArray(baselineVariants) || !Array.isArray(currentVariants)) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/${keyword}`,
          `${keyword}-shape-changed`,
          `${keyword} presence or shape changed`,
        ),
      );
      continue;
    }
    if (baselineVariants.length !== currentVariants.length) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/${keyword}`,
          `${keyword}-count-changed`,
          `${keyword} variant count changed from ${baselineVariants.length} to ${currentVariants.length}`,
        ),
      );
      continue;
    }
    for (let index = 0; index < baselineVariants.length; index += 1) {
      findings.push(
        ...compareSchemaNodes(
          baselineVariants[index],
          currentVariants[index],
          target,
          `${path}/${keyword}/${index}`,
        ),
      );
    }
  }

  for (const keyword of [
    'if',
    'then',
    'else',
    'dependentRequired',
    'unevaluatedProperties',
  ] as const) {
    if (!(keyword in baseline) && !(keyword in current)) continue;
    if (!deepEqualStable(baseline[keyword], current[keyword])) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/${keyword}`,
          `${keyword}-changed`,
          `${keyword} changed (conditional/advanced keyword treated as breaking)`,
        ),
      );
    }
  }

  const baselineDefs = isObject(baseline.$defs) ? baseline.$defs : undefined;
  const currentDefs = isObject(current.$defs) ? current.$defs : undefined;
  if (baselineDefs !== undefined || currentDefs !== undefined) {
    const names = new Set([...Object.keys(baselineDefs ?? {}), ...Object.keys(currentDefs ?? {})]);
    for (const name of names) {
      findings.push(
        ...compareSchemaNodes(
          baselineDefs?.[name],
          currentDefs?.[name],
          target,
          `${path}/$defs/${name}`,
        ),
      );
    }
  }

  // Fail closed on any assertion keyword this function does not model yet.
  const undeclaredKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const key of undeclaredKeys) {
    if (HANDLED_SCHEMA_KEYS.has(key) || IGNORABLE_SCHEMA_KEYS.has(key)) continue;
    if (!deepEqualStable(baseline[key], current[key])) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `${path}/${key}`,
          'unknown-keyword-changed',
          `unmodeled schema keyword "${key}" changed; treated as breaking`,
        ),
      );
    }
  }

  return findings;
}

export function compareSchemaDocuments(
  baseline: unknown,
  current: unknown,
  target: string,
): CompatibilityFinding[] {
  return compareSchemaNodes(baseline, current, target, '');
}

export function compareOperationRecords(
  baseline: OperationCompatibilityRecord,
  current: OperationCompatibilityRecord | undefined,
): CompatibilityFinding[] {
  const target = `operation=${baseline.type}@${baseline.version}`;
  if (current === undefined) {
    return [
      finding(
        'BREAKING',
        target,
        '',
        'operation-removed',
        'operation missing from current registry',
      ),
    ];
  }

  const findings: CompatibilityFinding[] = [];
  for (const field of ['type', 'version', 'kind', 'owner', 'schemaStatus'] as const) {
    if (baseline[field] !== current[field]) {
      findings.push(
        finding(
          'BREAKING',
          target,
          `/${field}`,
          'operation-metadata-changed',
          `${field} changed from ${baseline[field]} to ${current[field]}`,
        ),
      );
    }
  }
  if (baseline.payloadSchemaRef !== current.payloadSchemaRef) {
    findings.push(
      finding(
        'BREAKING',
        target,
        '/payloadSchemaRef',
        'payload-schema-ref-changed',
        `payloadSchemaRef changed from ${baseline.payloadSchemaRef} to ${current.payloadSchemaRef}`,
      ),
    );
  }
  if (baseline.resultSchemaRef !== current.resultSchemaRef) {
    findings.push(
      finding(
        'BREAKING',
        target,
        '/resultSchemaRef',
        'result-schema-ref-changed',
        `resultSchemaRef changed from ${baseline.resultSchemaRef} to ${current.resultSchemaRef}`,
      ),
    );
  }
  if (baseline.manualReviewFingerprint !== current.manualReviewFingerprint) {
    findings.push(
      finding(
        'MANUAL_REVIEW_REQUIRED',
        target,
        '/manualReviewFingerprint',
        'AUTHORIZATION_METADATA_CHANGE',
        `manualReviewFingerprint changed from ${baseline.manualReviewFingerprint} to ${current.manualReviewFingerprint}`,
      ),
    );
  }
  return findings;
}

export function applyApprovals(
  findings: readonly CompatibilityFinding[],
  approvals: readonly CompatibilityApproval[],
): CompatibilityFinding[] {
  const approved = new Set(
    approvals
      .filter((approval) => approval.status === 'APPROVED')
      .map((approval) => `${approval.kind}::${approval.target}`),
  );

  return findings.filter((item) => {
    if (item.severity !== 'MANUAL_REVIEW_REQUIRED') return true;
    return !approved.has(`${item.keyword}::${item.target}`);
  });
}

export function failingFindings(
  findings: readonly CompatibilityFinding[],
): readonly CompatibilityFinding[] {
  return findings.filter(
    (item) => item.severity === 'BREAKING' || item.severity === 'MANUAL_REVIEW_REQUIRED',
  );
}

export function formatFindings(findings: readonly CompatibilityFinding[]): string {
  return findings
    .map(
      (item) =>
        `${item.severity} ${item.target} path=${item.path || '/'} keyword=${item.keyword} detail=${item.detail}`,
    )
    .join('\n');
}
