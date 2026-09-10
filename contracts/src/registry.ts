import type {
  AnySchemaObject,
  ErrorObject,
  KeywordDefinition,
  Options,
  ValidateFunction,
} from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';

import {
  assertSliceOperationRegistrations,
  assertTaskExecutionOperationRegistrations,
} from './operation-registration.js';
import guardPolicyData from './generated/payload-guard-policies.json' with { type: 'json' };
import {
  loadPayloadGuardPolicies,
  payloadGuardErrors,
  payloadGuardKeyword,
  resolvePayloadGuardPolicy,
} from './payload-guard.js';

import { commonSchema } from './common.schema.js';
import { coreContractSchemas } from './core.schema.js';
import { operationEnvelopeSchema } from './envelopes.schema.js';
import { publicApiOperations } from './generated/public-api.js';
import {
  artifactCanonicalContentManifestSchemaRef,
  artifactCanonicalContentPayloadSchemaRef,
} from './operations/artifact.schema.js';
import { executableOperationSchemas } from './operations/index.js';
import { canonicalContentInvariantErrors } from './canonical-content.validation.js';
import {
  operationPayloadSchemaRef,
  operationResultSchemaRef,
  type PublicOperationDefinition,
} from './schema-types.js';

export interface ContractValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ErrorObject[];
}

interface AjvRuntime {
  addKeyword(keyword: KeywordDefinition): AjvRuntime;
  addSchema(schema: AnySchemaObject): AjvRuntime;
  getSchema(key: string): ValidateFunction | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: Options) => AjvRuntime;

export class ContractRegistry {
  readonly #ajv: AjvRuntime;
  readonly #guardPolicies = loadPayloadGuardPolicies(guardPolicyData);
  readonly #operations: ReadonlyMap<string, PublicOperationDefinition>;

  constructor() {
    assertSliceOperationRegistrations(publicApiOperations);
    assertTaskExecutionOperationRegistrations(publicApiOperations);
    this.#ajv = new Ajv2020({ allErrors: true, strict: true });
    this.#ajv.addKeyword(payloadGuardKeyword(this.#guardPolicies));
    this.#ajv.addSchema(commonSchema);
    for (const schema of coreContractSchemas) this.#ajv.addSchema(schema);
    for (const schema of executableOperationSchemas) this.#ajv.addSchema(schema);

    const operations = new Map<string, PublicOperationDefinition>();
    for (const operation of publicApiOperations) {
      const key = ContractRegistry.operationKey(operation.type, operation.version);
      if (operations.has(key)) throw new Error(`duplicate public operation ${key}`);
      this.#assertExecutableSchemas(operation);
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
    const guard = this.#guard(operation, input, 'envelope');
    if (guard !== undefined) return guard;
    const schemaId = `https://schemas.zhiju.local/api/1.0/${operation.type}`;
    return this.#run(this.#ajv.getSchema(schemaId), input);
  }

  validateCoreContract(schemaId: string, input: unknown): ContractValidationResult {
    return this.#run(this.#ajv.getSchema(schemaId), input);
  }

  validateCanonicalContentPayload(input: unknown): ContractValidationResult {
    const structural = this.#run(
      this.#ajv.getSchema(artifactCanonicalContentPayloadSchemaRef),
      input,
    );
    if (!structural.valid) return structural;
    const errors = canonicalContentInvariantErrors(input);
    return errors.length === 0 ? structural : { valid: false, errors };
  }

  validateCanonicalContent(input: unknown): ContractValidationResult {
    return this.validateCanonicalContentPayload(input);
  }

  validateCanonicalContentManifest(input: unknown): ContractValidationResult {
    return this.#run(this.#ajv.getSchema(artifactCanonicalContentManifestSchemaRef), input);
  }

  validateOperationResult(type: string, version: string, input: unknown): ContractValidationResult {
    const operation = this.getOperation(type, version);
    if (operation === undefined) return this.#unknownOperation(type, version);

    const guard = this.#guard(operation, input, 'result');
    if (guard !== undefined) return guard;
    const resultSchemaRef = operationResultSchemaRef(operation);
    if (resultSchemaRef === undefined) {
      return {
        valid: false,
        errors: [
          {
            instancePath: '',
            schemaPath: '',
            keyword: 'operationResultRegistry',
            params: { type, version },
            message: 'operation has no executable result schema',
          },
        ],
      };
    }
    return this.#run(this.#ajv.getSchema(resultSchemaRef), input);
  }

  #guard(
    operation: PublicOperationDefinition,
    input: unknown,
    mode: 'envelope' | 'result',
  ): ContractValidationResult | undefined {
    if (operation.payloadGuardPolicyRef === undefined) return undefined;
    const policy = resolvePayloadGuardPolicy(this.#guardPolicies, operation.payloadGuardPolicyRef);
    const errors = payloadGuardErrors(input, policy, mode);
    return errors.length === 0 ? undefined : { valid: false, errors };
  }

  #assertExecutableSchemas(operation: PublicOperationDefinition): void {
    const payloadRef = operationPayloadSchemaRef(operation);
    if (
      operation.schemaStatus === 'FULL' &&
      (payloadRef === undefined || this.#ajv.getSchema(payloadRef) === undefined)
    ) {
      throw new Error(
        `missing executable payload schema for ${operation.type}@${operation.version}`,
      );
    }

    const resultRef = operationResultSchemaRef(operation);
    if (
      operation.schemaStatus === 'FULL' &&
      operation.kind === 'QUERY' &&
      (resultRef === undefined || this.#ajv.getSchema(resultRef) === undefined)
    ) {
      throw new Error(
        `missing executable result schema for ${operation.type}@${operation.version}`,
      );
    }
  }

  #unknownOperation(type: string, version: string): ContractValidationResult {
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

  #run(validate: ValidateFunction | undefined, input: unknown): ContractValidationResult {
    if (validate === undefined) throw new Error('registered schema is unavailable');
    const valid = validate(input);
    return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
  }
}
