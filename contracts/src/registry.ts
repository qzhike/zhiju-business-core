import type { AnySchemaObject, ErrorObject, Options, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';

import { commonSchema } from './common.schema.js';
import { coreContractSchemas } from './core.schema.js';
import { operationEnvelopeSchema } from './envelopes.schema.js';
import { publicApiOperations } from './generated/public-api.js';
import type { PublicOperationDefinition } from './schema-types.js';

export interface ContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

interface AjvRuntime {
  addSchema(schema: AnySchemaObject): AjvRuntime;
  getSchema(key: string): ValidateFunction | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: Options) => AjvRuntime;

export class ContractRegistry {
  readonly #ajv: AjvRuntime;
  readonly #operations: ReadonlyMap<string, PublicOperationDefinition>;

  constructor() {
    this.#ajv = new Ajv2020({ allErrors: true, strict: true });
    this.#ajv.addSchema(commonSchema);
    for (const schema of coreContractSchemas) this.#ajv.addSchema(schema);

    const operations = new Map<string, PublicOperationDefinition>();
    for (const operation of publicApiOperations) {
      const key = ContractRegistry.operationKey(operation.type, operation.version);
      if (operations.has(key)) throw new Error(`duplicate public operation ${key}`);
      operations.set(key, operation);
      this.#ajv.addSchema(operationEnvelopeSchema(operation));
    }
    this.#operations = operations;
  }

  static operationKey(type: string, version: string): string {
    return `${type}@${version}`;
  }

  get operationCount(): number {
    return this.#operations.size;
  }

  getOperation(type: string, version: string): PublicOperationDefinition | undefined {
    return this.#operations.get(ContractRegistry.operationKey(type, version));
  }

  validateOperation(type: string, version: string, input: unknown): ContractValidationResult {
    const operation = this.getOperation(type, version);
    if (operation === undefined) {
      return {
        valid: false,
        errors: [
          {
            instancePath: '',
            schemaPath: '',
            keyword: 'operationRegistry',
            params: { type, version },
            message: 'unknown operation type or major version',
          },
        ],
      };
    }
    const schemaId = `https://schemas.zhiju.local/api/1.0/${operation.type}`;
    return this.#run(this.#ajv.getSchema(schemaId), input);
  }

  validateCoreContract(schemaId: string, input: unknown): ContractValidationResult {
    return this.#run(this.#ajv.getSchema(schemaId), input);
  }

  #run(validate: ValidateFunction | undefined, input: unknown): ContractValidationResult {
    if (validate === undefined) throw new Error('registered schema is unavailable');
    const valid = validate(input);
    return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
  }
}
