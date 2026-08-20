// Load frozen contracts/baselines/v1.0 schemas (including frozen operation
// envelopes) and validate payloads against that historical graph only.
// Deliberately does NOT import the live operationEnvelopeSchema builder.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Import from '../../../contracts/node_modules/ajv/dist/2020.js';

import type { OperationCompatibilityRecord } from './schema-compatibility.ts';

function envelopeSchemaRelativePath(type: string): string {
  return `schemas/envelopes/${type}.schema.json`;
}

export interface HistoricalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly Record<string, unknown>[];
  readonly schemaSource: 'baseline-v1.0';
  readonly schemaId: string;
}

interface AjvRuntime {
  addSchema(schema: object): AjvRuntime;
  getSchema(
    key: string,
  ): (((input: unknown) => boolean) & { errors?: unknown[] | null }) | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: Record<string, unknown>) => AjvRuntime;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const defaultBaselineRoot = join(repositoryRoot, 'contracts', 'baselines', 'v1.0');

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
}

interface BaselineManifest {
  readonly schemaDocuments: readonly string[];
  readonly envelopeDocuments?: readonly string[];
}

export class HistoricalBaselineRegistry {
  readonly #ajv: AjvRuntime;
  readonly #operations: ReadonlyMap<string, OperationCompatibilityRecord>;
  readonly #baselineRoot: string;
  readonly #schemaDocuments: readonly string[];
  readonly #envelopeDocuments: readonly string[];

  constructor(baselineRoot: string = defaultBaselineRoot) {
    this.#baselineRoot = baselineRoot;
    this.#ajv = new Ajv2020({ allErrors: true, strict: true });

    const manifest = readJson<BaselineManifest>(join(baselineRoot, 'manifest.json'));
    this.#schemaDocuments = manifest.schemaDocuments;
    this.#envelopeDocuments = manifest.envelopeDocuments ?? [];
    if (this.#envelopeDocuments.length === 0) {
      throw new Error('frozen baseline is missing envelopeDocuments');
    }

    for (const relativePath of [...this.#schemaDocuments, ...this.#envelopeDocuments]) {
      this.#ajv.addSchema(readJson<object>(join(baselineRoot, relativePath)));
    }

    const operationsIndex = readJson<{
      readonly operations: readonly OperationCompatibilityRecord[];
    }>(join(baselineRoot, 'operations.index.json'));

    const operations = new Map<string, OperationCompatibilityRecord>();
    for (const operation of operationsIndex.operations) {
      operations.set(`${operation.type}@${operation.version}`, operation);
    }
    this.#operations = operations;
  }

  get baselineRoot(): string {
    return this.#baselineRoot;
  }

  getOperation(type: string, version: string): OperationCompatibilityRecord | undefined {
    return this.#operations.get(`${type}@${version}`);
  }

  envelopePathFor(type: string): string {
    return envelopeSchemaRelativePath(type);
  }

  validateOperation(type: string, version: string, input: unknown): HistoricalValidationResult {
    const operation = this.getOperation(type, version);
    const schemaId = `https://schemas.zhiju.local/api/1.0/${type}`;
    if (operation === undefined) {
      return {
        valid: false,
        errors: [
          {
            instancePath: '',
            schemaPath: '',
            keyword: 'operationRegistry',
            params: { type, version },
            message: 'unknown operation type or major version in frozen baseline',
          },
        ],
        schemaSource: 'baseline-v1.0',
        schemaId,
      };
    }

    const validate = this.#ajv.getSchema(schemaId);
    if (validate === undefined) {
      throw new Error(`frozen envelope schema unavailable for ${schemaId}`);
    }
    const valid = validate(input);
    return {
      valid: Boolean(valid),
      errors: valid ? [] : ((validate.errors ?? []) as HistoricalValidationResult['errors']),
      schemaSource: 'baseline-v1.0',
      schemaId,
    };
  }

  /**
   * Throwaway Ajv graph using frozen common/module docs + a mutated copy of the
   * frozen envelope. Proves historical validation does not depend on the live
   * envelope builder or on a mutated envelope graph.
   */
  validateWithMutatedFrozenEnvelope(options: {
    readonly type: string;
    readonly version: string;
    readonly input: unknown;
    readonly mutate: (envelopeSchema: Record<string, unknown>) => void;
  }): HistoricalValidationResult {
    const operation = this.getOperation(options.type, options.version);
    if (operation === undefined) {
      throw new Error(`operation ${options.type}@${options.version} missing from frozen index`);
    }

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const relativePath of this.#schemaDocuments) {
      ajv.addSchema(
        structuredClone(readJson<Record<string, unknown>>(join(this.#baselineRoot, relativePath))),
      );
    }

    const envelopePath = this.envelopePathFor(options.type);
    const envelope = structuredClone(
      readJson<Record<string, unknown>>(join(this.#baselineRoot, envelopePath)),
    );
    options.mutate(envelope);
    ajv.addSchema(envelope);

    const schemaId = `https://schemas.zhiju.local/api/1.0/${options.type}`;
    const validate = ajv.getSchema(schemaId);
    if (validate === undefined) throw new Error(`mutated envelope unavailable for ${schemaId}`);
    const valid = validate(options.input);
    return {
      valid: Boolean(valid),
      errors: valid ? [] : ((validate.errors ?? []) as HistoricalValidationResult['errors']),
      schemaSource: 'baseline-v1.0',
      schemaId,
    };
  }

  /**
   * Throwaway Ajv graph using frozen envelopes + a mutated module payload $def.
   */
  validateWithMutatedPayloadSchema(options: {
    readonly type: string;
    readonly version: string;
    readonly input: unknown;
    readonly mutate: (payloadSchema: Record<string, unknown>) => void;
  }): HistoricalValidationResult {
    const operation = this.getOperation(options.type, options.version);
    if (operation === undefined || operation.payloadSchemaRef === null) {
      throw new Error(`operation ${options.type}@${options.version} missing payload schema ref`);
    }

    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const relativePath of this.#schemaDocuments) {
      const schema = structuredClone(
        readJson<Record<string, unknown>>(join(this.#baselineRoot, relativePath)),
      );
      if (relativePath.startsWith('schemas/modules/')) {
        const defs = schema.$defs;
        if (defs !== null && typeof defs === 'object' && !Array.isArray(defs)) {
          const defName = operation.payloadSchemaRef.split('/').at(-1);
          if (defName !== undefined && defName in (defs as Record<string, unknown>)) {
            const payloadSchema = (defs as Record<string, unknown>)[defName];
            if (
              payloadSchema !== null &&
              typeof payloadSchema === 'object' &&
              !Array.isArray(payloadSchema)
            ) {
              options.mutate(payloadSchema as Record<string, unknown>);
            }
          }
        }
      }
      ajv.addSchema(schema);
    }

    for (const relativePath of this.#envelopeDocuments) {
      ajv.addSchema(readJson<object>(join(this.#baselineRoot, relativePath)));
    }

    const schemaId = `https://schemas.zhiju.local/api/1.0/${options.type}`;
    const validate = ajv.getSchema(schemaId);
    if (validate === undefined) throw new Error(`mutated schema unavailable for ${schemaId}`);
    const valid = validate(options.input);
    return {
      valid: Boolean(valid),
      errors: valid ? [] : ((validate.errors ?? []) as HistoricalValidationResult['errors']),
      schemaSource: 'baseline-v1.0',
      schemaId,
    };
  }
}
