import type { AnySchemaObject, ErrorObject, Options, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';

import { commonSchema } from './common.schema.js';
import {
  policyProfileDocumentSchemaRef,
  policyProfileRegistry,
  policyProfileRegistrySchema,
} from './policy-profiles.js';

// =============================================================================
// Closed `policyDocument` validation for the IM-06 profile registry.
//
// Kept apart from `policy-profiles.ts` so the registry mapping itself stays a
// data-only module the build checks can import without the Ajv runtime.
// =============================================================================

/** Structural alias so owning modules need no direct Ajv dependency. */
export type PolicyProfileValidationError = ErrorObject;

export interface PolicyProfileDocumentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PolicyProfileValidationError[];
}

export interface PolicyProfileDocumentValidator {
  /**
   * Apply the closed `policyDocument` schema registered under `registryKey`.
   * An unregistered key or a registry version other than the build-time one
   * fails closed instead of falling back to an open document.
   */
  validate(
    registryVersion: string,
    registryKey: string,
    input: unknown,
  ): PolicyProfileDocumentValidationResult;
}

interface AjvRuntime {
  addSchema(schema: AnySchemaObject): AjvRuntime;
  getSchema(key: string): ValidateFunction | undefined;
}

const Ajv2020 = Ajv2020Import as unknown as new (options?: Options) => AjvRuntime;

/**
 * Standalone validator for the closed profile documents. Both the shared
 * `ContractRegistry` and the owning modules use this single implementation, so
 * "the document matches the registered closed schema" has exactly one meaning.
 */
export function createPolicyProfileDocumentValidator(): PolicyProfileDocumentValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(commonSchema);
  ajv.addSchema(policyProfileRegistrySchema(policyProfileRegistry));
  return {
    validate(registryVersion, registryKey, input): PolicyProfileDocumentValidationResult {
      const schemaRef = policyProfileDocumentSchemaRef(
        policyProfileRegistry,
        registryVersion,
        registryKey,
      );
      if (schemaRef === undefined) {
        return {
          valid: false,
          errors: [
            {
              instancePath: '',
              schemaPath: '',
              keyword: 'policyProfileRegistry',
              params: { registryKey },
              message: 'unknown policy profile registry key',
            },
          ],
        };
      }
      const validate = ajv.getSchema(schemaRef);
      if (validate === undefined) throw new Error('registered schema is unavailable');
      const valid = validate(input);
      return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
    },
  };
}
