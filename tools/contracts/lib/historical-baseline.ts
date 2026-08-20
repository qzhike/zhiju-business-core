// Load frozen contracts/baselines/v1.0 schemas and validate payloads against
// historical operation envelopes. Used by compatibility fixture tests so that
// historical Events are checked with the frozen Schema graph, not only the
// live ContractRegistry.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020Import from '../../../contracts/node_modules/ajv/dist/2020.js';

import { operationEnvelopeSchema } from '../../../contracts/src/envelopes.schema.ts';
import type { PublicOperationDefinition } from '../../../contracts/src/schema-types.ts';

import type { OperationCompatibilityRecord } from './schema-compatibility.ts';

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

function toPublicOperation(record: OperationCompatibilityRecord): PublicOperationDefinition {
  return {
    type: record.type,
    version: record.version as '1.0',
    kind: record.kind as PublicOperationDefinition['kind'],
    owner: record.owner,
    schemaStatus: record.schemaStatus as PublicOperationDefinition['schemaStatus'],
  };
}

export class HistoricalBaselineRegistry {
  readonly #ajv: AjvRuntime;
  readonly #operations: ReadonlyMap<string, OperationCompatibilityRecord>;
  readonly #baselineRoot: string;

  constructor(baselineRoot: string = defaultBaselineRoot) {
    this.#baselineRoot = baselineRoot;
    this.#ajv = new Ajv2020({ allErrors: true, strict: true });

    const manifest = readJson<{ readonly schemaDocuments: readonly string[] }>(
      join(baselineRoot, 'manifest.json'),
    );
    for (const relativePath of manifest.schemaDocuments) {
      const schema = readJson<object>(join(baselineRoot, relativePath));
      this.#ajv.addSchema(schema);
    }

    const operationsIndex = readJson<{
      readonly operations: readonly OperationCompatibilityRecord[];
    }>(join(baselineRoot, 'operations.index.json'));

    const operations = new Map<string, OperationCompatibilityRecord>();
    for (const operation of operationsIndex.operations) {
      const key = `${operation.type}@${operation.version}`;
      operations.set(key, operation);
      this.#ajv.addSchema(operationEnvelopeSchema(toPublicOperation(operation)));
    }
    this.#operations = operations;
  }

  get baselineRoot(): string {
    return this.#baselineRoot;
  }

  getOperation(type: string, version: string): OperationCompatibilityRecord | undefined {
    return this.#operations.get(`${type}@${version}`);
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
   * Build a throwaway Ajv graph from the same frozen documents, but with one
   * module $defs payload schema mutated. Used to prove historical validation
   * does not depend on an alternate/current schema graph.
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
    const manifest = readJson<{ readonly schemaDocuments: readonly string[] }>(
      join(this.#baselineRoot, 'manifest.json'),
    );

    for (const relativePath of manifest.schemaDocuments) {
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

    ajv.addSchema(operationEnvelopeSchema(toPublicOperation(operation)));
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
