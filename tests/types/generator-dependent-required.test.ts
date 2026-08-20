// Tests that the JSON-Schema-to-TypeScript emitter used by
// `tools/contracts/generate-typescript-types.mts` produces a union of
// variants that accepts exactly the same inputs as Ajv would for the
// corresponding `dependentRequired` rule.
//
// This file runs under Vitest so it can execute the real emitter, Ajv, and
// the TypeScript compiler API together. For every sample value we assert:
//   emitterAccepts(value) === ajvAccepts(value)
// Both must agree for IM-01-EXE-010 to stay PASS.
//
// Ajv 2020 ships its `.d.ts` files in a path the workspace's lint and tsc
// projects do not resolve. We import through the contracts package's bundled
// copy so vitest runs the same Ajv version the runtime registry uses, and
// cast the import to the minimal surface (`compile`) this test exercises.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';

import Ajv2020Import from '../../contracts/node_modules/ajv/dist/2020.js';
const Ajv2020 = Ajv2020Import as unknown as new (opts?: Record<string, unknown>) => {
  compile(schema: unknown): (input: unknown) => boolean;
};

import {
  makeContext,
  renderDependentRequiredUnion,
  renderObject,
  type EmitContext,
  type SchemaObject,
} from '../../tools/contracts/lib/json-schema-emitter.ts';

import { commonSchema } from '../../contracts/src/common.schema.ts';

import { describe, expect, it } from 'vitest';

interface Case {
  readonly label: string;
  readonly dependentRequired: Readonly<Record<string, readonly string[]>>;
  readonly properties: readonly string[];
  /** Top-level `required` of the synthetic schema. Defaults to none. */
  readonly required?: readonly string[];
  readonly cases: readonly {
    readonly value: Record<string, unknown>;
    readonly expectValid: boolean;
    readonly note: string;
  }[];
}

const CASES: readonly Case[] = [
  {
    label: 'chain: { A: [B], B: [C] } over { A, B, C }',
    dependentRequired: { A: ['B'], B: ['C'] },
    properties: ['A', 'B', 'C'],
    cases: [
      { value: {}, expectValid: true, note: 'no triggers set' },
      { value: { A: 'x', B: 'x', C: 'x' }, expectValid: true, note: 'full chain' },
      { value: { B: 'x', C: 'x' }, expectValid: true, note: 'tail of chain only' },
      { value: { A: 'x' }, expectValid: false, note: 'A requires B' },
      { value: { A: 'x', B: 'x' }, expectValid: false, note: 'B requires C' },
      { value: { A: 'x', C: 'x' }, expectValid: false, note: 'A still requires B' },
      { value: { C: 'x' }, expectValid: true, note: 'C is not a trigger' },
      { value: { B: 'x' }, expectValid: false, note: 'B requires C' },
    ],
  },
  {
    label: 'independent: { A: [B], C: [D] } over { A, B, C, D }',
    dependentRequired: { A: ['B'], C: ['D'] },
    properties: ['A', 'B', 'C', 'D'],
    cases: [
      { value: {}, expectValid: true, note: 'no triggers set' },
      { value: { A: 'x', B: 'x' }, expectValid: true, note: 'A branch only' },
      { value: { C: 'x', D: 'x' }, expectValid: true, note: 'C branch only' },
      { value: { A: 'x', B: 'x', C: 'x', D: 'x' }, expectValid: true, note: 'both branches' },
      { value: { A: 'x', B: 'x', D: 'x' }, expectValid: true, note: 'A branch with non-trigger D' },
      {
        value: { A: 'x', B: 'x', C: 'x' },
        expectValid: false,
        note: 'C present without D must not pass the single-A branch',
      },
      { value: { A: 'x' }, expectValid: false, note: 'A requires B' },
      { value: { C: 'x' }, expectValid: false, note: 'C requires D' },
      { value: { A: 'x', D: 'x' }, expectValid: false, note: 'A requires B even with D' },
      { value: { C: 'x', B: 'x' }, expectValid: false, note: 'C requires D even with B' },
      { value: { B: 'x' }, expectValid: true, note: 'B alone is fine' },
      { value: { D: 'x' }, expectValid: true, note: 'D alone is fine' },
      { value: { B: 'x', D: 'x' }, expectValid: true, note: 'B+D is fine (no triggers)' },
    ],
  },
  {
    label: 'required trigger: required:[A] + { A: [B] } over { A, B }',
    dependentRequired: { A: ['B'] },
    properties: ['A', 'B'],
    required: ['A'],
    cases: [
      { value: {}, expectValid: false, note: 'top-level required A forbids empty object' },
      { value: { A: 'x' }, expectValid: false, note: 'A requires B' },
      { value: { B: 'x' }, expectValid: false, note: 'A is still required' },
      { value: { A: 'x', B: 'x' }, expectValid: true, note: 'required A with its dependency' },
    ],
  },
  {
    label: 'required independent: required:[A] + { A: [B], C: [D] } over { A, B, C, D }',
    dependentRequired: { A: ['B'], C: ['D'] },
    properties: ['A', 'B', 'C', 'D'],
    required: ['A'],
    cases: [
      { value: {}, expectValid: false, note: 'required A forbids empty object' },
      { value: { A: 'x', B: 'x' }, expectValid: true, note: 'required A branch only' },
      { value: { A: 'x' }, expectValid: false, note: 'A requires B' },
      { value: { C: 'x', D: 'x' }, expectValid: false, note: 'A remains required' },
      {
        value: { A: 'x', C: 'x', D: 'x' },
        expectValid: false,
        note: 'required A still needs B even when C is selected',
      },
      {
        value: { A: 'x', B: 'x', C: 'x' },
        expectValid: false,
        note: 'C present without D',
      },
      { value: { A: 'x', B: 'x', C: 'x', D: 'x' }, expectValid: true, note: 'both branches' },
      { value: { A: 'x', B: 'x', D: 'x' }, expectValid: true, note: 'A branch with non-trigger D' },
    ],
  },
];

function buildSchema(
  dependentRequired: Readonly<Record<string, readonly string[]>>,
  properties: readonly string[],
  required: readonly string[] = [],
) {
  const props: Record<string, unknown> = {};
  for (const name of properties) {
    props[name] = { type: 'string' };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: props,
    ...(required.length > 0 ? { required: [...required] } : {}),
    dependentRequired,
  };
}

function makeContextForShape(properties: readonly string[]): EmitContext {
  const inSchemaRefs = new Map<string, string>();
  for (const name of properties) {
    inSchemaRefs.set(name, name.charAt(0).toUpperCase() + name.slice(1));
  }
  return makeContext(new Map([['uuidV7', 'Common.UuidV7']]), { inSchemaRefs });
}

function emitDependentRequiredUnion(
  dependentRequired: Readonly<Record<string, readonly string[]>>,
  properties: readonly string[],
  required: readonly string[] = [],
): string {
  // requiredSet must mirror the schema's top-level `required`, not the set of
  // dependentRequired triggers. Fixtures that omit `required` pass an empty
  // set so the base variant can still accept `{}`; fixtures that set
  // `required` must pass the same keys to both Ajv and the emitter.
  const requiredSet = new Set(required);
  const props: Record<string, unknown> = {};
  for (const name of properties) {
    props[name] = { type: 'string' };
  }
  const context = makeContextForShape(properties);
  return renderDependentRequiredUnion(props, requiredSet, dependentRequired, context);
}

/**
 * Ask the TypeScript compiler whether `value` is assignable to the emitted
 * union type under the same strict + exactOptionalPropertyTypes settings the
 * contracts package uses. Fresh object literals keep excess-property checks.
 */
function emitterAcceptsValue(emittedType: string, value: Record<string, unknown>): boolean {
  const fileName = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '__dependent_required_check.ts',
  );
  const sourceText = [
    `type Subject = ${emittedType};`,
    `const check: Subject = ${JSON.stringify(value)};`,
  ].join('\n');

  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2024.d.ts'],
  };

  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.fileExists = (name) => name === fileName || originalFileExists(name);
  host.readFile = (name) => (name === fileName ? sourceText : originalReadFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (name === fileName) {
      return ts.createSourceFile(name, sourceText, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  return diagnostics.length === 0;
}

describe('dependentRequired emitter matches Ajv', () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      const required = testCase.required ?? [];
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      const validate = ajv.compile(
        buildSchema(testCase.dependentRequired, testCase.properties, required),
      );
      const emitted = emitDependentRequiredUnion(
        testCase.dependentRequired,
        testCase.properties,
        required,
      );

      it('emits a non-empty discriminated union', () => {
        expect(emitted.startsWith('(')).toBe(true);
        expect(emitted.endsWith(')')).toBe(true);
        const readonlyShape = /\{\s*\n\s*readonly /.exec(emitted);
        expect(readonlyShape).not.toBeNull();
      });

      for (const sample of testCase.cases) {
        it(`Ajv and emitter agree on \`${JSON.stringify(sample.value)}\` (${sample.note})`, () => {
          const ajvOk = validate(sample.value);
          expect(ajvOk).toBe(sample.expectValid);

          const emitterOk = emitterAcceptsValue(emitted, sample.value);
          expect(emitterOk).toBe(sample.expectValid);
          expect(emitterOk).toBe(ajvOk);
        });
      }
    });
  }
});

// Smoke test: load the live `common.scopeRef` schema and assert that the
// emitter path used by the generator returns byte-identical TypeScript on
// consecutive calls. This catches accidental non-determinism in variant
// ordering or property emission.
describe('live common.scopeRef emission is deterministic', () => {
  it('produces the same string on every call', () => {
    const defs = commonSchema.$defs as SchemaObject | undefined;
    expect(defs).toBeDefined();
    const scopeRef = defs?.scopeRef;
    expect(scopeRef).toBeDefined();
    expect(typeof scopeRef).toBe('object');

    const context = makeContext(
      new Map([
        ['uuidV7', 'UuidV7'],
        ['scopeRef', 'ScopeRef'],
      ]),
      {
        inSchemaRefs: new Map([
          ['uuidV7', 'UuidV7'],
          ['scopeRef', 'ScopeRef'],
        ]),
      },
    );

    const first = renderObject(scopeRef as SchemaObject, context);
    const second = renderObject(scopeRef as SchemaObject, context);
    expect(first).toBe(second);
    expect(first.includes('projectId')).toBe(true);
    expect(first.includes('enterpriseId')).toBe(true);
  });
});
