// Pure JSON Schema → TypeScript type emitter used by
// `tools/contracts/generate-typescript-types.mts` and the dependentRequired
// generator tests in `tests/types/generator-dependent-required.test.ts`.
//
// This module deliberately contains no I/O and no schema imports so that the
// vitest fixture can exercise the exact same code path the generator takes
// when running `pnpm contracts:generate`. Pulling the emitters out of the
// executable `.mts` script avoids both a second copy of the algorithm and the
// risk of subtle drift between the test fixture and the production generator.
//
// Functions exported here are pure: given the same JSON Schema input and the
// same emitter context, they always return the same TypeScript expression.

export type SchemaObject = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function schemaType(schema: unknown): string | readonly string[] {
  if (!isObject(schema)) return 'never';
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t as readonly string[];
  // Inferred type: a `properties` map without explicit `type` => object.
  if ('properties' in schema || 'additionalProperties' in schema || 'required' in schema) {
    return 'object';
  }
  return 'never';
}

// Fields whose schema deliberately uses open JSON because the high-level spec
// declares the value generic. We MUST NOT collapse them to `any` or
// `Record<string, unknown>`; instead they expand to the controlled recursive
// CanonicalJson shape so that exhaustive switch coverage still applies.
export function isOpenJsonDescription(schema: SchemaObject): boolean {
  return Object.keys(schema).length === 1 && typeof schema.description === 'string';
}

export function canonicalJsonTypeAlias(): string {
  // Modules reference the alias declared at the top of `common.ts`. The
  // common schema is rendered first so that the alias exists before any
  // other file imports from it.
  return 'CanonicalJson';
}

export function literalExpression(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  return JSON.stringify(value);
}

// Emitted verbatim at the top of `common.ts`; referenced from every other
// generated file by the alias `CanonicalJson`.
export const canonicalJsonTypeExpression = `string | number | boolean | null | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson }`;

export interface EmitContext {
  readonly commonRefs: ReadonlyMap<string, string>;
  readonly coreRefs: ReadonlyMap<string, string>;
  readonly coreFullRefs: ReadonlyMap<string, string>;
  readonly localRefs: ReadonlyMap<string, string>;
  readonly inSchemaRefs: ReadonlyMap<string, string>;
}

// Lookup helper that mirrors how the executable generator wires `Core.*`,
// `Common.*` and module namespace names. Tests can construct a context that
// only contains the subset they need.
export function buildCommonRefs(keys?: ReadonlyArray<string>): ReadonlyMap<string, string> {
  if (keys === undefined) return new Map<string, string>();
  const refs = new Map<string, string>();
  for (const name of keys) {
    refs.set(name, `Common.${pascalFromSnake(name)}`);
  }
  return refs;
}

export function buildCoreRefs(schemas: ReadonlyArray<unknown>): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const schema of schemas) {
    if (!isObject(schema)) continue;
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    for (const name of Object.keys(defs)) {
      refs.set(name, `Core.${pascalFromSnake(name)}`);
    }
  }
  return refs;
}

export function buildCoreFullRefs(
  coreContractMeta: ReadonlyArray<{ readonly id: string; readonly typeName: string }>,
): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const meta of coreContractMeta) {
    refs.set(meta.id, `Core.${meta.typeName}`);
  }
  return refs;
}

export function resolveRef(ref: string, context: EmitContext): string {
  // In-schema refs (`#/$defs/<name>`) come from a relative lookup that the
  // generator pre-populates; tests typically leave this empty.
  if (ref.startsWith('#/$defs/')) {
    const name = ref.slice('#/$defs/'.length);
    const tsName = context.inSchemaRefs.get(name);
    if (tsName === undefined) throw new Error(`unresolved in-schema ref: ${ref}`);
    return tsName;
  }
  if (ref.startsWith('https://schemas.zhiju.local/common/1.0#/$defs/')) {
    const name = ref.slice('https://schemas.zhiju.local/common/1.0#/$defs/'.length);
    const tsName = context.commonRefs.get(name);
    if (tsName === undefined) throw new Error(`unresolved common ref: ${ref}`);
    return tsName;
  }
  if (ref.startsWith('https://schemas.zhiju.local/core/')) {
    // Forms used by the codebase:
    //   https://schemas.zhiju.local/core/work-order/1.0#/$defs/workOrderContract  (named def)
    //   https://schemas.zhiju.local/core/work-order/1.0                            (whole schema)
    const tail = ref.slice('https://schemas.zhiju.local/core/'.length);
    const splitIdx = tail.indexOf('#/$defs/');
    if (splitIdx === -1) {
      const fullTsName = context.coreFullRefs.get(tail);
      if (fullTsName === undefined) {
        throw new Error(`unresolved core contract ref: ${ref}`);
      }
      return fullTsName;
    }
    const contractId = tail.slice(0, splitIdx);
    const rest = tail.slice(splitIdx + '#/$defs/'.length);
    // `contractId` carries the schema id (e.g. `work-order/1.0`) and is only
    // needed for whole-schema refs handled by the branch above; suppress the
    // unused-locals lint by binding it to a void sink.
    void contractId;
    const tsName = context.coreRefs.get(rest);
    if (tsName === undefined) throw new Error(`unresolved core def ref: ${ref}`);
    return tsName;
  }
  // Module refs:
  //   https://schemas.zhiju.local/modules/<owner>/1.0#/$defs/<name>
  const moduleMatch = ref.match(
    /^https:\/\/schemas\.zhiju\.local\/modules\/([^/]+)\/1\.0#\/\$defs\/(.+)$/,
  );
  if (moduleMatch !== null) {
    const owner = moduleMatch[1] ?? '';
    const name = moduleMatch[2] ?? '';
    // The owning module publishes its types under `Owner.Name`; we only know
    // the owning module's id (not its public TypeScript namespace) at the
    // call site. Callers pass `localRefs` with the fully qualified name.
    const qualified = `${owner}.${name}`;
    const tsName = context.localRefs.get(qualified) ?? context.localRefs.get(name);
    if (tsName === undefined) throw new Error(`unresolved module ref: ${ref}`);
    return tsName;
  }
  if (ref.startsWith('#/$defs/')) {
    const name = ref.slice('#/$defs/'.length);
    const tsName = context.inSchemaRefs.get(name);
    if (tsName === undefined) throw new Error(`unresolved in-schema ref: ${ref}`);
    return tsName;
  }
  throw new Error(`unsupported ref: ${ref}`);
}

export interface RenderObjectOptions {
  readonly commonRefs?: ReadonlyMap<string, string>;
  readonly coreRefs?: ReadonlyMap<string, string>;
  readonly coreFullRefs?: ReadonlyMap<string, string>;
  readonly localRefs?: ReadonlyMap<string, string>;
  readonly inSchemaRefs?: ReadonlyMap<string, string>;
}

export function renderArray(schema: SchemaObject, context: EmitContext): string {
  const items = schema.items;
  const itemExpr = items === undefined ? 'unknown' : schemaExpression(items, context);
  // `uniqueItems: true` arrays model Set semantics, but `ReadonlyArray<T>`
  // triggers the workspace `array-type` lint rule (the codebase standardises
  // on `readonly T[]`). The two notations are structurally identical; the Set
  // semantic is preserved by the runtime Ajv validation.
  //
  // Union item expressions (e.g. closed-enum literals joined with `|`) need
  // to be parenthesised before the `[]`; otherwise TypeScript parses
  // `readonly "FOO" | "BAR"[]` as `readonly "FOO"` followed by `| "BAR"[]`,
  // which yields `TS1354: 'readonly' type modifier is only permitted on array
  // and tuple literal types`.
  const needsParens = /[|&]/.test(itemExpr.trimStart());
  const wrapped = needsParens ? `(${itemExpr})` : itemExpr;
  return `readonly ${wrapped}[]`;
}

function renderVariantBody(
  props: SchemaObject,
  requiredSet: ReadonlySet<string>,
  forbiddenKeys: ReadonlySet<string>,
  context: EmitContext,
): string {
  const lines: string[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    if (!isObject(propSchema)) continue;
    const expr = schemaExpression(propSchema, context);
    if (forbiddenKeys.has(name)) {
      lines.push(`  readonly ${name}?: undefined;`);
      continue;
    }
    const optional = !requiredSet.has(name);
    const optionalMark = optional ? '?' : '';
    lines.push(`  readonly ${name}${optionalMark}: ${expr};`);
  }
  return `{${lines.length === 0 ? '' : '\n'}${lines.join('\n')}\n}`;
}

export function renderObject(schema: SchemaObject, context: EmitContext): string {
  const props = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((v): v is string => typeof v === 'string')
    : [];
  const requiredSet = new Set(required);
  const dependentRequired = isObject(schema.dependentRequired)
    ? (schema.dependentRequired as Readonly<Record<string, unknown>>)
    : undefined;

  // `dependentRequired: { X: [Y, Z] }` says "when X is present, Y and Z must
  // also be present". A flat interface cannot express this without giving
  // up the helpful optional-vs-required distinction, so when the rule
  // applies we emit a discriminated union:
  //   - required triggers (those also listed in schema `required`) are
  //     present on every variant, together with their transitive deps;
  //   - optional triggers are enumerated as a power set, including the
  //     empty set only when no trigger is top-level required (the true
  //     "all triggers absent" base).
  if (dependentRequired !== undefined) {
    const keys = Object.keys(dependentRequired);
    if (keys.length > 0) {
      return renderDependentRequiredUnion(props, requiredSet, dependentRequired, context);
    }
  }

  const lines: string[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    if (!isObject(propSchema)) continue;
    const optional = !requiredSet.has(name);
    const optionalMark = optional ? '?' : '';
    const expr = schemaExpression(propSchema, context);
    lines.push(`  readonly ${name}${optionalMark}: ${expr};`);
  }
  return `{${lines.length === 0 ? '' : '\n'}${lines.join('\n')}\n}`;
}

// Compute the *full* transitive closure for each dependentRequired trigger
// key. The earlier implementation only copied the direct deps and skipped
// re-entering them, which produced wrong types for `{ A: [B], B: [C] }`
// (the `A` variant never required `C`) and for independent rules. The
// implementation walks the dependency graph depth-first, recording the
// in-flight path to break cycles.
export function expandDependentRequired(
  dependentRequired: Readonly<Record<string, unknown>>,
  knownProperties: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const raw = new Map<string, Set<string>>();
  for (const [key, deps] of Object.entries(dependentRequired)) {
    if (!knownProperties.has(key)) continue;
    const depList = Array.isArray(deps)
      ? deps.filter((d): d is string => typeof d === 'string' && knownProperties.has(d))
      : [];
    raw.set(key, new Set(depList));
  }

  const closure = new Map<string, Set<string>>();
  const visit = (key: string, acc: Set<string>, inFlight: ReadonlySet<string>): void => {
    const direct = raw.get(key);
    if (direct === undefined) return;
    for (const dep of direct) {
      if (acc.has(dep)) continue;
      acc.add(dep);
      if (inFlight.has(dep)) continue;
      visit(dep, acc, new Set([...inFlight, key]));
    }
  };
  for (const key of raw.keys()) {
    const acc = new Set<string>();
    visit(key, acc, new Set<string>());
    closure.set(key, acc);
  }
  return closure;
}

// Enumerate every subset of `keys`, including the empty set. For N optional
// triggers this yields 2^N subsets. The cost is bounded by the number of
// trigger keys, not the number of property names. In practice
// dependentRequired rules carry at most a handful of triggers (the live
// schema uses 1), so the union stays compact.
function* powerSet<T>(keys: readonly T[]): Generator<T[]> {
  const n = keys.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset: T[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) subset.push(keys[i] as T);
    }
    yield subset;
  }
}

export function renderDependentRequiredUnion(
  props: SchemaObject,
  requiredSet: ReadonlySet<string>,
  dependentRequired: Readonly<Record<string, unknown>>,
  context: EmitContext,
): string {
  const knownProperties = new Set(Object.keys(props));
  const closure = expandDependentRequired(dependentRequired, knownProperties);
  const triggerKeys = [...closure.keys()];
  // Triggers listed in schema `required` are present on every legal object,
  // so they (and their closures) must be active on every variant. Forbidding
  // them on a "base" branch would accept `{}` for `{required:['A'], A:[B]}`,
  // which Ajv rejects.
  const requiredTriggers = triggerKeys.filter((key) => requiredSet.has(key));
  const optionalTriggers = triggerKeys.filter((key) => !requiredSet.has(key));
  const variants: string[] = [];

  for (const optionalSubset of powerSet(optionalTriggers)) {
    const present = [...requiredTriggers, ...optionalSubset];
    const variantRequired = new Set<string>(requiredSet);
    for (const trigger of present) {
      variantRequired.add(trigger);
      const deps = closure.get(trigger);
      if (deps !== undefined) {
        for (const dep of deps) variantRequired.add(dep);
      }
    }
    const forbiddenKeys = new Set<string>();
    for (const trigger of triggerKeys) {
      if (present.includes(trigger)) continue;
      if (variantRequired.has(trigger)) continue;
      forbiddenKeys.add(trigger);
    }
    variants.push(renderVariantBody(props, variantRequired, forbiddenKeys, context));
  }

  return `(${variants.join(' | ')})`;
}

export function renderOneOf(branches: readonly unknown[], context: EmitContext): string {
  const branchObjects = branches.filter(isObject);
  const tagFields = new Set<string>();
  for (const branch of branchObjects) {
    if (!('properties' in branch) || !isObject(branch.properties)) {
      tagFields.clear();
      break;
    }
    for (const prop of Object.keys(branch.properties)) tagFields.add(prop);
  }
  let discriminator: string | undefined;
  for (const candidate of tagFields) {
    const values = new Set<unknown>();
    let allConst = true;
    for (const branch of branchObjects) {
      if (!isObject(branch) || !isObject(branch.properties)) continue;
      const prop = branch.properties[candidate];
      if (!isObject(prop)) {
        allConst = false;
        break;
      }
      if ('const' in prop) {
        values.add(prop.const);
      } else {
        allConst = false;
        break;
      }
    }
    if (allConst && values.size === branchObjects.length && branchObjects.length > 0) {
      discriminator = candidate;
      break;
    }
  }

  const members = branches.map((branch) => schemaExpression(branch, context));
  if (discriminator !== undefined) {
    return members.join(' | ');
  }
  return `(${members.join(' | ')})`;
}

export function schemaExpression(schema: unknown, context: EmitContext): string {
  if (!isObject(schema)) {
    return 'never';
  }
  if (typeof schema.$ref === 'string') {
    return resolveRef(schema.$ref, context);
  }
  if ('const' in schema) {
    return literalExpression(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(literalExpression).join(' | ');
  }
  if (Array.isArray(schema.oneOf)) {
    return renderOneOf(schema.oneOf, context);
  }
  if (Array.isArray(schema.anyOf)) {
    const members = schema.anyOf.map((m) => schemaExpression(m, context));
    return `(${members.join(' | ')})`;
  }
  if (Array.isArray(schema.allOf)) {
    if (schema.properties !== undefined || schema.required !== undefined) {
      return renderObject(schema, context);
    }
    const members = schema.allOf.map((m) => schemaExpression(m, context));
    return members.join(' & ');
  }
  const type = schemaType(schema);
  if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
    return 'string';
  }
  if (type === 'integer' || type === 'number') {
    return 'number';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (type === 'null') {
    return 'null';
  }
  if (type === 'array') {
    return renderArray(schema, context);
  }
  if (isOpenJsonDescription(schema)) {
    return canonicalJsonTypeAlias();
  }
  if (Object.keys(schema).length === 0) {
    // Bare `{}` is the codebase convention for CanonicalJson placeholders.
    return canonicalJsonTypeAlias();
  }
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    return renderObject(schema, context);
  }
  if (Array.isArray(type)) {
    return type.map((t) => schemaExpression({ ...schema, type: t }, context)).join(' | ');
  }
  return 'unknown';
}

// Convenience constructor for tests that only need a single in-schema scope.
export function makeContext(
  commonRefs: ReadonlyMap<string, string>,
  options: {
    readonly coreRefs?: ReadonlyMap<string, string>;
    readonly coreFullRefs?: ReadonlyMap<string, string>;
    readonly localRefs?: ReadonlyMap<string, string>;
    readonly inSchemaRefs?: ReadonlyMap<string, string>;
  } = {},
): EmitContext {
  return {
    commonRefs,
    coreRefs: options.coreRefs ?? new Map<string, string>(),
    coreFullRefs: options.coreFullRefs ?? new Map<string, string>(),
    localRefs: options.localRefs ?? new Map<string, string>(),
    inSchemaRefs: options.inSchemaRefs ?? new Map<string, string>(),
  };
}

// Decide whether an expression is an interface body (a single `{...}` literal
// with no embedded `|`) or a type alias (anything else). Discriminated
// unions produced by `oneOf` arrive as `{...} | {...}`; those must be aliases,
// never interfaces, because interfaces can only have one body. The fixture
// uses the same helper so the type-test file stays in lock-step with the
// generator's notion of "alias vs interface".
export function renderTypeToLines(
  lines: string[],
  name: string,
  expr: string,
  indent: string,
): void {
  const trimmed = expr.trimStart();
  const isInterfaceBody =
    trimmed.startsWith('{') && !trimmed.includes(' | ') && !trimmed.includes('& ');
  if (isInterfaceBody) {
    lines.push(`${indent}export interface ${name} ${expr}`);
  } else {
    lines.push(`${indent}export type ${name} = ${expr};`);
  }
}

// Map a JSON Schema property name to the canonical `T`-shape alias used by
// the generator's `common.ts`. Tests build the `inSchemaRefs` map from this
// helper so the generated TypeScript matches what the real emitter would
// produce.
export function pascalFromSnake(name: string): string {
  return name
    .split(/[._]/)
    .filter((s) => s.length > 0)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('');
}
