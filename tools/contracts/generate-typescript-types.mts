#!/usr/bin/env node --experimental-strip-types
//
// generate-typescript-types.mts
// --------------------------
// Deterministic JSON Schema → TypeScript type generator for the IM-01 executable
// contract family. Consumes the Ajv 2020 strict schemas registered under
// `contracts/src/**/*.schema.ts` and emits hand-readable `.ts` files into
// `contracts/src/generated/types/` so that business code, fixtures and runtime
// validators share a single source of truth.
//
// The generator is deliberately hand-written (no third-party dependency) and
// is idempotent: two consecutive runs against the same inputs produce
// byte-identical output, which is what `pnpm contracts:check` verifies.
//
// Generation rules and known limits are documented inline and mirrored in
// `.vibe/im-01-executable-schema-typescript/Verification-Report.md`.
//

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commonSchema } from '../../contracts/src/common.schema.ts';
import { coreContractSchemas } from '../../contracts/src/core.schema.ts';
import { artifactSchema } from '../../contracts/src/operations/artifact.schema.ts';
import { enterpriseProjectSchema } from '../../contracts/src/operations/enterprise-project.schema.ts';
import { identityPolicySchema } from '../../contracts/src/operations/identity-policy.schema.ts';
import { integrationGatewaySchema } from '../../contracts/src/operations/integration-gateway.schema.ts';
import { qualityGovernanceSchema } from '../../contracts/src/operations/quality-governance.schema.ts';
import { releasePublicationSchema } from '../../contracts/src/operations/release-publication.schema.ts';
import { taskExecutionSchema } from '../../contracts/src/operations/task-execution.schema.ts';
import { publicApiOperations } from '../../contracts/src/generated/public-api.ts';

// -----------------------------------------------------------------------------
// Resolution & paths
// -----------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const typesRoot = join(root, 'contracts', 'src', 'generated', 'types');
const operationsByOwner: Readonly<Record<string, ReadonlyArray<{ type: string; kind: string }>>> =
  {};
for (const op of publicApiOperations) {
  const list = operationsByOwner[op.owner] ?? [];
  list.push({ type: op.type, kind: op.kind });
  operationsByOwner[op.owner] = list;
}

const moduleSchemas: ReadonlyArray<{
  readonly id: string;
  readonly fileBase: string;
  readonly owner: string;
  readonly schema: unknown;
}> = [
  {
    id: 'identity-policy/1.0',
    fileBase: 'identity-policy',
    owner: 'identity-policy',
    schema: identityPolicySchema,
  },
  {
    id: 'enterprise-project/1.0',
    fileBase: 'enterprise-project',
    owner: 'enterprise-project',
    schema: enterpriseProjectSchema,
  },
  {
    id: 'task-execution/1.0',
    fileBase: 'task-execution',
    owner: 'task-execution',
    schema: taskExecutionSchema,
  },
  { id: 'artifact/1.0', fileBase: 'artifact', owner: 'artifact', schema: artifactSchema },
  {
    id: 'quality-governance/1.0',
    fileBase: 'quality-governance',
    owner: 'quality-governance',
    schema: qualityGovernanceSchema,
  },
  {
    id: 'release-publication/1.0',
    fileBase: 'release-publication',
    owner: 'release-publication',
    schema: releasePublicationSchema,
  },
  {
    id: 'integration-gateway/1.0',
    fileBase: 'integration-gateway',
    owner: 'integration-gateway',
    schema: integrationGatewaySchema,
  },
];

const coreContractMeta: ReadonlyArray<{ readonly id: string; readonly typeName: string }> = [
  { id: 'project-context/1.0', typeName: 'ProjectContextContract' },
  { id: 'work-order/1.0', typeName: 'WorkOrderContract' },
  { id: 'agent-result/1.0', typeName: 'AgentResultContract' },
  { id: 'revision-acceptance/1.0', typeName: 'RevisionAcceptanceSnapshot' },
  { id: 'approval-bundle/1.0', typeName: 'ApprovalBundleSnapshot' },
  { id: 'release-readiness/1.0', typeName: 'ReleaseReadinessSnapshot' },
];

// -----------------------------------------------------------------------------
// JSON Schema AST helpers
// -----------------------------------------------------------------------------

type SchemaObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaType(schema: unknown): string | readonly string[] {
  if (!isObject(schema)) return 'never';
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t as readonly string[];
  // Inferred type: a `properties` map without explicit `type` => object.
  if ('properties' in schema || 'additionalProperties' in schema || 'required' in schema)
    return 'object';
  return 'never';
}

function getDef(schema: SchemaObject, name: string): SchemaObject | undefined {
  const defs = schema.$defs;
  if (!isObject(defs)) return undefined;
  const value = defs[name];
  return isObject(value) ? value : undefined;
}

// -----------------------------------------------------------------------------
// TypeScript emitter
// -----------------------------------------------------------------------------

class TypeScriptEmitter {
  readonly #refs = new Map<string, string>();
  readonly #aliases: Record<string, string> = {};

  registerRef(schemaId: string, tsName: string): void {
    this.#refs.set(schemaId, tsName);
  }

  aliasFor(tsName: string, typeExpression: string): void {
    this.#aliases[tsName] = typeExpression;
  }

  refFor(schemaId: string): string {
    const value = this.#refs.get(schemaId);
    if (value === undefined) throw new Error(`unregistered schema ref: ${schemaId}`);
    return value;
  }

  render(): string {
    const out: string[] = [];
    out.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
    out.push('// Run `pnpm contracts:generate` to refresh after schema changes.');
    out.push('');
    for (const [name, expr] of Object.entries(this.#aliases)) {
      out.push(`export type ${name} = ${expr};`);
    }
    return out.join('\n');
  }
}

// -----------------------------------------------------------------------------
// Shared canonical JSON type
// -----------------------------------------------------------------------------

// Emitted verbatim at the top of `common.ts`; referenced from every other
// generated file by the alias `CanonicalJson`.
export const canonicalJsonTypeExpression = `string | number | boolean | null | readonly CanonicalJson[] | { readonly [key: string]: CanonicalJson }`;

// Fields whose schema deliberately uses open JSON because the high-level spec
// declares the value generic. We MUST NOT collapse them to `any` or
// `Record<string, unknown>`; instead they expand to the controlled recursive
// CanonicalJson shape so that exhaustive switch coverage still applies.
function isOpenJsonDescription(schema: SchemaObject): boolean {
  return Object.keys(schema).length === 1 && typeof schema.description === 'string';
}

function canonicalJsonType(): string {
  // Modules reference the alias declared at the top of `common.ts`. The
  // common schema is rendered first so that the alias exists before any
  // other file imports from it.
  return 'CanonicalJson';
}

// -----------------------------------------------------------------------------
// Schema → TypeScript conversion
// -----------------------------------------------------------------------------

interface EmitContext {
  readonly owner: string;
  readonly moduleName: string;
  readonly emitter: TypeScriptEmitter;
  // Map `${schemaId}#/$defs/${name}` -> generated interface name
  readonly localRefs: ReadonlyMap<string, string>;
  readonly commonRefs: ReadonlyMap<string, string>;
  readonly coreRefs: ReadonlyMap<string, string>;
  // Map relative `#/$defs/<name>` -> generated interface name for the schema
  // currently being rendered. Populated only by renderCommonFile / renderCoreFile
  // / renderModuleFile; module emission passes an empty map because cross-module
  // refs always use the full URL.
  readonly inSchemaRefs: ReadonlyMap<string, string>;
}

function schemaExpression(
  schema: unknown,
  context: EmitContext,
  options: { readonly asDiscriminatedTag?: string } = {},
): string {
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
    return renderOneOf(schema.oneOf, context, options);
  }
  if (Array.isArray(schema.anyOf)) {
    const members = schema.anyOf.map((m) => schemaExpression(m, context));
    return `(${members.join(' | ')})`;
  }
  if (Array.isArray(schema.allOf)) {
    // Schema constraints in `allOf` are validated by Ajv at runtime (e.g.
    // `ValueEnvelope`'s presence/value rule). They don't contribute to the
    // TypeScript shape, so we render the sibling `properties`/`required`
    // instead and ignore the conditionals.
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
    return canonicalJsonType();
  }
  // Some module schemas use a bare `{} as const` (e.g. `canonicalJson = {} as const`)
  // as the CanonicalJson placeholder. Anything with no schema keys is also
  // open JSON per the authoring convention.
  if (Object.keys(schema).length === 0) {
    return canonicalJsonType();
  }
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    return renderObject(schema, context);
  }
  // Mixed `type: ['string', 'null']` etc.
  if (Array.isArray(type)) {
    return type.map((t) => schemaExpression({ ...schema, type: t }, context)).join(' | ');
  }
  return 'unknown';
}

function literalExpression(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return `${value}n`;
  return JSON.stringify(value);
}

function resolveRef(ref: string, context: EmitContext): string {
  // Common refs look like: https://schemas.zhiju.local/common/1.0#/$defs/uuidV7
  // Local refs look like:   https://schemas.zhiju.local/modules/<owner>/1.0#/$defs/<name>
  // Core refs look like:    https://schemas.zhiju.local/core/<contract>/1.0#/$defs/<name>
  // In-schema refs look like: #/$defs/<name> (relative to the schema currently
  // being rendered; we use `inSchemaRefs` to resolve them).
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
  if (ref.startsWith(`https://schemas.zhiju.local/modules/${context.owner}/1.0#/$defs/`)) {
    const name = ref.slice(
      `https://schemas.zhiju.local/modules/${context.owner}/1.0#/$defs/`.length,
    );
    const tsName = context.localRefs.get(name);
    if (tsName === undefined) throw new Error(`unresolved module ref: ${ref}`);
    return tsName;
  }
  if (ref.startsWith('https://schemas.zhiju.local/core/')) {
    // Forms used by the codebase:
    //   https://schemas.zhiju.local/core/work-order/1.0#/$defs/workOrderContract
    //   https://schemas.zhiju.local/core/contract-header  (whole schema $id ref)
    const tail = ref.slice('https://schemas.zhiju.local/core/'.length);
    const [contractPart, rest] = tail.split('#/$defs/');
    if (rest === undefined) {
      // Whole-schema reference such as the contractHeader $id. Modules embed
      // the header as `common.contractHeader`, so collapse to that name.
      return context.commonRefs.get('contractHeader') ?? 'Common.ContractHeader';
    }
    void contractPart;
    const tsName = context.coreRefs.get(rest);
    if (tsName === undefined) throw new Error(`unresolved core ref: ${ref}`);
    return tsName;
  }
  throw new Error(`unsupported ref: ${ref}`);
}

function renderArray(schema: SchemaObject, context: EmitContext): string {
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

function renderObject(schema: SchemaObject, context: EmitContext): string {
  const props = isObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((v): v is string => typeof v === 'string')
    : [];
  const requiredSet = new Set(required);

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

function renderOneOf(
  branches: readonly unknown[],
  context: EmitContext,
  options: { readonly asDiscriminatedTag?: string },
): string {
  // Detect discriminator: every branch is an object with a const on the same
  // field. That field becomes a discriminated union and we re-emit each branch
  // with the tag written explicitly.
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

  if (discriminator !== undefined) {
    const tag = options.asDiscriminatedTag ?? discriminator;
    const parts: string[] = [];
    for (const branch of branches) {
      parts.push(schemaExpression(branch, context, { asDiscriminatedTag: tag }));
    }
    return parts.join(' | ');
  }

  const members = branches.map((branch) => schemaExpression(branch, context));
  return `(${members.join(' | ')})`;
}

// -----------------------------------------------------------------------------
// Build common refs and core refs
// -----------------------------------------------------------------------------

function buildCommonRefs(): ReadonlyMap<string, string> {
  const defs = isObject(commonSchema.$defs) ? commonSchema.$defs : {};
  const refs = new Map<string, string>();
  for (const name of Object.keys(defs)) {
    refs.set(name, `Common.${pascalFromSnake(name)}`);
  }
  return refs;
}

function buildCoreRefs(): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  for (const schema of coreContractSchemas) {
    if (!isObject(schema)) continue;
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    for (const name of Object.keys(defs)) {
      refs.set(name, `Core.${pascalFromSnake(name)}`);
    }
  }
  return refs;
}

function snakeFromName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// Convert a snake_case or camelCase identifier to PascalCase. Used only for
// operation payload/result type names whose source name is already a valid TS
// identifier (e.g. `registerPrincipal` → `RegisterPrincipal`,
// `register_principal` → `RegisterPrincipal`, `valueEnvelope` → `ValueEnvelope`).
function pascalFromSnake(name: string): string {
  return name
    .split(/[._]/)
    .filter((s) => s.length > 0)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join('');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : `${s[0]!.toUpperCase()}${s.slice(1)}`;
}

function moduleNsFor(owner: string): string {
  return owner
    .split('-')
    .map((part) => capitalize(part))
    .join('');
}

// -----------------------------------------------------------------------------
// Per-definition emitter
// -----------------------------------------------------------------------------

interface DefShape {
  readonly name: string;
  readonly typeName: string;
  readonly expression: string;
}

function emitDef(context: EmitContext, defName: string, defSchema: unknown): DefShape {
  if (!isObject(defSchema)) {
    throw new Error(`def ${defName} is not an object`);
  }
  const typeName = pascalFromSnake(defName);
  const expression = schemaExpression(defSchema, context);
  return { name: defName, typeName, expression };
}

// -----------------------------------------------------------------------------
// Per-module emission
// -----------------------------------------------------------------------------

interface ModuleRender {
  readonly owner: string;
  readonly shared: readonly DefShape[];
  readonly operations: ReadonlyArray<{
    readonly type: string;
    readonly kind: string;
    readonly payload: DefShape;
    readonly result?: DefShape;
  }>;
}

function renderModule(
  owner: string,
  schema: unknown,
  operationList: ReadonlyArray<{ readonly type: string; readonly kind: string }>,
): ModuleRender {
  if (!isObject(schema)) throw new Error(`schema for ${owner} is not an object`);
  const defs = isObject(schema.$defs) ? schema.$defs : {};

  // Map local $defs to generated type names
  const localRefs = new Map<string, string>();
  for (const name of Object.keys(defs)) {
    localRefs.set(name, `${moduleNsFor(owner)}.${pascalFromSnake(name)}`);
  }

  const context: EmitContext = {
    owner,
    moduleName: owner.replaceAll('-', '_'),
    emitter: new TypeScriptEmitter(),
    localRefs,
    commonRefs: buildCommonRefs(),
    coreRefs: buildCoreRefs(),
    inSchemaRefs: new Map<string, string>(),
  };

  // Shared module-level types (everything in $defs that isn't an operation
  // payload/result, by naming convention).
  const shared: DefShape[] = [];
  for (const [name, defSchema] of Object.entries(defs)) {
    if (name.endsWith('_payload') || name.endsWith('_result')) continue;
    shared.push(emitDef(context, name, defSchema));
  }

  const operations: ModuleRender['operations'] = [];
  for (const op of operationList) {
    const baseName = op.type.replaceAll('.', '_');
    const payloadName = `${baseName}_payload`;
    const resultName = `${baseName}_result`;
    const payloadDef = defs[payloadName];
    if (!isObject(payloadDef)) {
      throw new Error(`missing payload def for ${op.type} in ${owner}`);
    }
    const payload = emitDef(context, payloadName, payloadDef);
    let result: DefShape | undefined;
    if (op.kind === 'QUERY') {
      const resultDef = defs[resultName];
      if (!isObject(resultDef)) {
        throw new Error(`missing result def for QUERY ${op.type} in ${owner}`);
      }
      result = emitDef(context, resultName, resultDef);
    }
    operations.push({ type: op.type, kind: op.kind, payload, result });
  }

  return { owner, shared, operations };
}

// -----------------------------------------------------------------------------
// Render common.ts
// -----------------------------------------------------------------------------

function renderCommonFile(commonRefs: ReadonlyMap<string, string>): string {
  const defs = isObject(commonSchema.$defs) ? commonSchema.$defs : {};
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push('// Source of truth: contracts/src/common.schema.ts.');
  lines.push('');
  lines.push('// Controlled recursive JSON value type used for `ValueEnvelope<T>`,');
  lines.push('// `Page<T>` items and any field that the spec declares as CanonicalJson.');
  lines.push(`export type CanonicalJson = ${canonicalJsonTypeExpression};`);
  lines.push('');
  lines.push('// Closed enums and shared value objects are exposed through a single');
  lines.push('// `Common` namespace so that consumers can disambiguate when multiple');
  lines.push('// modules redefine similar scalar aliases (e.g. IdentityPolicy defines');
  lines.push('// its own `principalKind` enum with the same closed set).');
  lines.push('export namespace Common {');
  for (const [name, schema] of Object.entries(defs)) {
    const tsName = commonRefs.get(name);
    if (tsName === undefined) continue;
    const stripped = tsName.replace(/^Common\./, '');
    // Recreate a temporary context so we can reuse schemaExpression with only
    // common refs available. No module-specific refs are reachable from the
    // common schema because all cross-cutting references use the full URL.
    const inSchemaRefs = new Map<string, string>();
    for (const [name] of Object.entries(defs)) {
      const tsNameInner = commonRefs.get(name);
      if (tsNameInner !== undefined) {
        inSchemaRefs.set(name, tsNameInner.replace(/^Common\./, ''));
      }
    }
    const context: EmitContext = {
      owner: '__common__',
      moduleName: 'common',
      emitter: new TypeScriptEmitter(),
      localRefs: new Map<string, string>(),
      commonRefs,
      coreRefs: new Map<string, string>(),
      inSchemaRefs,
    };
    const expr = schemaExpression(schema, context);
    renderType(lines, stripped, expr, '  ');
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Render core.ts
// -----------------------------------------------------------------------------

function renderCoreFile(coreRefs: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push('// Source of truth: contracts/src/core.schema.ts (six Core Contract families).');
  lines.push('');
  lines.push(`import type { CanonicalJson, Common } from './common.js';`);
  lines.push('');
  lines.push('export namespace Core {');
  for (const schema of coreContractSchemas) {
    if (!isObject(schema)) continue;
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    const inSchemaRefs = new Map<string, string>();
    for (const [name] of Object.entries(defs)) {
      const tsNameInner = coreRefs.get(name);
      if (tsNameInner !== undefined) {
        inSchemaRefs.set(name, tsNameInner.replace(/^Core\./, ''));
      }
    }
    const context: EmitContext = {
      owner: '__core__',
      moduleName: 'core',
      emitter: new TypeScriptEmitter(),
      localRefs: new Map<string, string>(),
      commonRefs: buildCommonRefs(),
      coreRefs,
      inSchemaRefs,
    };
    // Emit the six top-level Core Contract types from each schema's own
    // properties. Each Core Contract schema declares the full object at its
    // root rather than as a `$defs` entry.
    const contractExpr = schemaExpression(
      {
        type: 'object',
        additionalProperties: false,
        required: schema.required,
        properties: schema.properties,
      },
      context,
    );
    if (typeof schema.$id === 'string') {
      const tail = schema.$id.slice('https://schemas.zhiju.local/core/'.length);
      const contractName = tail.split('/')[0]!;
      const meta = coreContractMeta.find((entry) => entry.id === tail);
      const typeName =
        meta?.typeName ?? pascalFromSnake(contractName.replaceAll('-', '_')) + 'Contract';
      lines.push(
        `  /** Top-level ${contractName} Core Contract (see 03-core-contracts.md §${tail}). */`,
      );
      renderType(lines, typeName, contractExpr, '  ');
    }
    for (const [name, defSchema] of Object.entries(defs)) {
      const tsName = coreRefs.get(name);
      if (tsName === undefined) continue;
      const stripped = tsName.replace(/^Core\./, '');
      const expr = schemaExpression(defSchema, context);
      renderType(lines, stripped, expr, '  ');
    }
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Render a per-module file
// -----------------------------------------------------------------------------

function renderModuleFile(
  moduleRender: ModuleRender,
  commonRefs: ReadonlyMap<string, string>,
  coreRefs: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push(`// Source of truth: contracts/src/operations/${moduleRender.owner}.schema.ts.`);
  lines.push('');
  lines.push(`import type { CanonicalJson, Common } from './common.js';`);
  lines.push(`import type { Core } from './core.js';`);
  lines.push('');
  const moduleNs = moduleNsFor(moduleRender.owner);
  lines.push(`export namespace ${moduleNs} {`);
  // Shared module types (everything in $defs that isn't payload/result).
  for (const def of moduleRender.shared) {
    renderType(lines, def.typeName, def.expression, '  ');
  }
  // Operation payload + result types.
  for (const op of moduleRender.operations) {
    const baseName = op.type.replaceAll('.', '_');
    const payloadName = `${baseName}_payload`;
    const resultName = `${baseName}_result`;
    const payloadTypeName = pascalFromSnake(payloadName);
    const resultTypeName = pascalFromSnake(resultName);
    lines.push(`  /** Payload of \`${op.type}\` (${op.kind}). */`);
    renderType(lines, payloadTypeName, op.payload.expression, '  ');
    if (op.result !== undefined) {
      lines.push(`  /** Result of \`${op.type}\` (${op.kind}). */`);
      renderType(lines, resultTypeName, op.result.expression, '  ');
    }
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// Decide whether an expression is an interface body (a single `{...}` literal
// with no embedded `|`) or a type alias (anything else). Discriminated
// unions produced by `oneOf` arrive as `{...} | {...}`; those must be aliases,
// never interfaces, because interfaces can only have one body.
function renderType(lines: string[], name: string, expr: string, indent: string): void {
  const trimmed = expr.trimStart();
  const isInterfaceBody =
    trimmed.startsWith('{') && !trimmed.includes(' | ') && !trimmed.includes('& ');
  if (isInterfaceBody) {
    lines.push(`${indent}export interface ${name} ${expr}`);
  } else {
    lines.push(`${indent}export type ${name} = ${expr};`);
  }
}

// -----------------------------------------------------------------------------
// Render index.ts
// -----------------------------------------------------------------------------

function renderIndexFile(): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push('');
  lines.push("export * as Common from './common.js';");
  lines.push("export * as Core from './core.js';");
  for (const owner of Object.keys(operationsByOwner).sort()) {
    const moduleNs = moduleNsFor(owner);
    lines.push(`export * as ${moduleNs} from './${owner}.js';`);
  }
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const commonRefs = buildCommonRefs();
  const coreRefs = buildCoreRefs();

  const commonContent = renderCommonFile(commonRefs);
  const coreContent = renderCoreFile(coreRefs);

  const fileWrites: Array<{ readonly path: string; readonly content: string }> = [];
  fileWrites.push({ path: join(typesRoot, 'common.ts'), content: commonContent });
  fileWrites.push({ path: join(typesRoot, 'core.ts'), content: coreContent });
  for (const { owner, schema } of moduleSchemas) {
    const operationList = operationsByOwner[owner] ?? [];
    const rendered = renderModule(owner, schema, operationList);
    fileWrites.push({
      path: join(typesRoot, `${owner}.ts`),
      content: renderModuleFile(rendered, commonRefs, coreRefs),
    });
  }
  fileWrites.push({ path: join(typesRoot, 'index.ts'), content: renderIndexFile() });

  let totalPayloads = 0;
  let totalResults = 0;
  for (const { owner, schema } of moduleSchemas) {
    const operationList = operationsByOwner[owner] ?? [];
    const rendered = renderModule(owner, schema, operationList);
    totalPayloads += rendered.operations.length;
    totalResults += rendered.operations.filter((op) => op.result !== undefined).length;
  }

  if (process.argv.includes('--check')) {
    let stale = 0;
    for (const { path, content } of fileWrites) {
      const current = safeRead(path);
      if (current !== content) {
        console.error(`stale: ${path}`);
        stale += 1;
      }
    }
    if (stale > 0) {
      console.error(`generated TS types are stale (${stale}); run pnpm contracts:generate`);
      process.exit(1);
    }
    console.log(
      `typescript_types=PASS payloads=${totalPayloads} query_results=${totalResults} core_contracts=${coreContractSchemas.length}`,
    );
    return;
  }

  for (const { path, content } of fileWrites) {
    writeFileSync(path, content, 'utf8');
  }
  console.log(
    `typescript_types=UPDATED payloads=${totalPayloads} query_results=${totalResults} core_contracts=${coreContractSchemas.length}`,
  );
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return '';
  }
}

main();
