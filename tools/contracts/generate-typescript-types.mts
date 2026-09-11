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
// The actual conversion algorithm lives in
// `tools/contracts/lib/json-schema-emitter.ts` so the type fixtures in
// `tests/types/generator-dependent-required.test-d.ts` can exercise the
// EXACT same code path the generator uses instead of hand-copying the
// expected TypeScript output. This file is only responsible for loading
// the registered schemas, mapping `$defs` to public names, and writing
// the generated text to disk.
//
// Generation rules and known limits are documented inline and mirrored in
// `.vibe/archive/im-01-executable-schema-typescript/Verification-Report.md`.
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
import { operationSchemaDefinitionName } from '../../contracts/src/schema-types.ts';

import {
  buildCommonRefs,
  buildCoreFullRefs,
  buildCoreRefs,
  canonicalJsonTypeExpression,
  isObject,
  pascalFromSnake,
  renderDependentRequiredUnion,
  renderObject,
  renderTypeToLines,
  schemaExpression,
  type EmitContext,
  type SchemaObject,
} from './lib/json-schema-emitter.ts';

// -----------------------------------------------------------------------------
// Re-exports
// -----------------------------------------------------------------------------
//
// Anything the executable `.mts` script needs is sourced from the pure
// emitter library so the type-test fixtures in `tests/types/` can import the
// same algorithm under the same name.

export {
  buildCommonRefs,
  buildCoreFullRefs,
  buildCoreRefs,
  canonicalJsonTypeExpression,
  isObject,
  pascalFromSnake,
  renderDependentRequiredUnion,
  renderObject,
  schemaExpression,
} from './lib/json-schema-emitter.ts';
export type { EmitContext, SchemaObject } from './lib/json-schema-emitter.ts';

// -----------------------------------------------------------------------------
// Resolution & paths
// -----------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const typesRoot = join(root, 'contracts', 'src', 'generated', 'types');
const operationsByOwner: Readonly<
  Record<string, ReadonlyArray<{ type: string; version: '1.0' | '1.1'; kind: string }>>
> = {};
for (const op of publicApiOperations) {
  const list = operationsByOwner[op.owner] ?? [];
  list.push({ type: op.type, version: op.version, kind: op.kind });
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

// Names of every shared value object published in `common.schema.ts` so that
// every emitter context can resolve `#/$defs/<name>` in-schema refs the same
// way the runtime registry does.
const COMMON_DEF_NAMES: ReadonlyArray<string> = Object.keys(
  isObject(commonSchema.$defs) ? commonSchema.$defs : {},
);

// -----------------------------------------------------------------------------
// Module-level renderer glue
// -----------------------------------------------------------------------------

function moduleNsFor(owner: string): string {
  return owner
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

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
  operationList: ReadonlyArray<{
    readonly type: string;
    readonly version: '1.0' | '1.1';
    readonly kind: string;
  }>,
): ModuleRender {
  if (!isObject(schema)) throw new Error(`schema for ${owner} is not an object`);
  const defs = isObject(schema.$defs) ? schema.$defs : {};

  // Map local $defs to generated type names. We index by both the bare
  // def-name (used by code that knows the owner) and the qualified
  // `<owner>.<name>` key (used by the emitter's `resolveRef` when it sees a
  // cross-module `$ref`).
  const localRefs = new Map<string, string>();
  for (const name of Object.keys(defs)) {
    const tsName = `${moduleNsFor(owner)}.${pascalFromSnake(name)}`;
    localRefs.set(name, tsName);
    localRefs.set(`${owner}.${name}`, tsName);
  }

  const context: EmitContext = {
    owner,
    moduleName: owner.replaceAll('-', '_'),
    emitter: undefined as never,
    localRefs,
    commonRefs: buildCommonRefs(COMMON_DEF_NAMES),
    coreRefs: buildCoreRefs(coreContractSchemas),
    coreFullRefs: buildCoreFullRefs(coreContractMeta),
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
    const payloadName = operationSchemaDefinitionName(op.type, op.version, 'payload');
    const resultName = operationSchemaDefinitionName(op.type, op.version, 'result');
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
  const inSchemaRefs = new Map<string, string>();
  for (const k of Object.keys(defs)) {
    const inner = commonRefs.get(k);
    if (inner !== undefined) inSchemaRefs.set(k, inner.replace(/^Common\./, ''));
  }
  for (const [name, schema] of Object.entries(defs)) {
    const tsName = commonRefs.get(name);
    if (tsName === undefined) continue;
    const stripped = tsName.replace(/^Common\./, '');
    const context: EmitContext = {
      owner: '__common__',
      moduleName: 'common',
      emitter: undefined as never,
      localRefs: new Map<string, string>(),
      commonRefs,
      coreRefs: new Map<string, string>(),
      coreFullRefs: buildCoreFullRefs(coreContractMeta),
      inSchemaRefs,
    };
    const expr = schemaExpression(schema, context);
    renderTypeToLines(lines, stripped, expr, '  ');
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function renderCoreFile(coreRefs: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push('// Source of truth: contracts/src/core.schema.ts (six Core Contract families).');
  lines.push('');
  lines.push("import type { CanonicalJson, Common } from './common.js';");
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
      emitter: undefined as never,
      localRefs: new Map<string, string>(),
      commonRefs: buildCommonRefs(COMMON_DEF_NAMES),
      coreRefs,
      coreFullRefs: buildCoreFullRefs(coreContractMeta),
      inSchemaRefs,
    };
    if (typeof schema.$id === 'string') {
      const tail = schema.$id.slice('https://schemas.zhiju.local/core/'.length);
      const contractName = tail.split('/')[0]!;
      const meta = coreContractMeta.find((entry) => entry.id === tail);
      const typeName =
        meta?.typeName ?? pascalFromSnake(contractName.replaceAll('-', '_')) + 'Contract';
      const contractExpr = schemaExpression(
        {
          type: 'object',
          additionalProperties: false,
          required: schema.required,
          properties: schema.properties,
        },
        context,
      );
      lines.push(
        `  /** Top-level ${contractName} Core Contract (see 03-core-contracts.md §${tail}). */`,
      );
      renderTypeToLines(lines, typeName, contractExpr, '  ');
    }
    for (const [name, defSchema] of Object.entries(defs)) {
      const tsName = coreRefs.get(name);
      if (tsName === undefined) continue;
      const stripped = tsName.replace(/^Core\./, '');
      const expr = schemaExpression(defSchema, context);
      renderTypeToLines(lines, stripped, expr, '  ');
    }
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

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
  for (const def of moduleRender.shared) {
    renderTypeToLines(lines, def.typeName, def.expression, '  ');
  }
  for (const op of moduleRender.operations) {
    const payloadTypeName = op.payload.typeName;
    const resultTypeName = op.result?.typeName;
    lines.push(`  /** Payload of \`${op.type}\` (${op.kind}). */`);
    renderTypeToLines(lines, payloadTypeName, op.payload.expression, '  ');
    if (op.result !== undefined) {
      lines.push(`  /** Result of \`${op.type}\` (${op.kind}). */`);
      renderTypeToLines(lines, resultTypeName!, op.result.expression, '  ');
    }
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function renderIndexFile(): string {
  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by tools/contracts/generate-typescript-types.mts — DO NOT EDIT.');
  lines.push('');
  lines.push('// Re-export each contract namespace directly so consumers reach the full');
  lines.push('// namespace through the contracts package entry without an extra');
  lines.push('// `Common.Common.ScopeRef`-style prefix. Each module file below declares');
  lines.push('// `export namespace X { ... }`; the namespace itself is the named');
  lines.push('// export we forward. `export type` is required by `verbatimModuleSyntax`');
  lines.push('// because TypeScript namespaces do not carry a runtime value.');
  lines.push("export type { Common } from './common.js';");
  lines.push("export type { Core } from './core.js';");
  for (const owner of Object.keys(operationsByOwner).sort()) {
    const moduleNs = moduleNsFor(owner);
    lines.push(`export type { ${moduleNs} } from './${owner}.js';`);
  }
  lines.push('');
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  const commonRefs = buildCommonRefs(COMMON_DEF_NAMES);
  const coreRefs = buildCoreRefs(coreContractSchemas);

  const fileWrites: Array<{ readonly path: string; readonly content: string }> = [];
  fileWrites.push({ path: join(typesRoot, 'common.ts'), content: renderCommonFile(commonRefs) });
  fileWrites.push({ path: join(typesRoot, 'core.ts'), content: renderCoreFile(coreRefs) });
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
