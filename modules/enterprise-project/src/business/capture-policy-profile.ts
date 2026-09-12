import {
  createPolicyProfileDocumentValidator,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileKey,
  registeredPolicyProfileReference,
  type Common,
  type PolicyProfileValidationError,
} from '@zhiju/contracts';

// =============================================================================
// IM-06 (#179) EnterpriseProject owning validation of the first-version
// capture policy profile.
// =============================================================================
//
// EnterpriseProject owns the rule semantics of
// `ep.context_source_slice_capture.policy@1.0`; the build-time registry only
// owns the canonical entry and the closed field schema (design decision §12.4,
// Spec 001 §13.5). This module therefore:
//
// 1. requires its own profile key to be declared by `policySchemaRefs` — a
//    historical `im02-static-v1` entry never stands in for it;
// 2. applies the registered closed schema to the policy document and returns
//    the validated rules.
//
// It performs no I/O, resolves no Policy version and derives no `validUntil`:
// existence, authorization, lifecycle and the Slice capture chain stay
// `NOT RUN` until their own implementation Issue.
// =============================================================================

/** Registry key of the profile the capture consumer requires. */
export const CAPTURE_POLICY_PROFILE_KEY = 'ep.context_source_slice_capture.policy@1.0';

/** Closed rule fields of the capture profile, as approved in §12.4. */
export interface CapturePolicyRules {
  readonly maxSliceValiditySeconds: Common.PositiveInteger;
  readonly allowedPurposeCodes: readonly Common.NamespaceCode[];
}

export type CapturePolicyValidationResult =
  | { readonly valid: true; readonly rules: CapturePolicyRules }
  | { readonly valid: false; readonly errors: readonly PolicyProfileValidationError[] };

const documents = createPolicyProfileDocumentValidator();

function profileNotDeclared(): CapturePolicyValidationResult {
  return {
    valid: false,
    errors: [
      {
        instancePath: '/policySchemaRefs',
        schemaPath: '',
        keyword: 'policyProfileRegistry',
        params: { registryKey: CAPTURE_POLICY_PROFILE_KEY },
        message: 'capture policy profile is not declared by an exact registered reference',
      },
    ],
  };
}

/**
 * Validate the capture policy inputs owned by this module: the exact canonical
 * profile reference present in `policySchemaRefs` and the closed rule fields of
 * the policy document. Unknown fields, a missing required field and a value
 * outside the approved type are rejected instead of being ignored.
 */
export function validateCapturePolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): CapturePolicyValidationResult {
  const canonical = registeredPolicyProfileReference(
    POLICY_PROFILE_REGISTRY_VERSION,
    CAPTURE_POLICY_PROFILE_KEY,
  );
  const declared = input.policySchemaRefs.some(
    (reference) =>
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, reference) ===
      CAPTURE_POLICY_PROFILE_KEY,
  );
  if (canonical === undefined || !declared) return profileNotDeclared();

  const document = documents.validate(
    POLICY_PROFILE_REGISTRY_VERSION,
    CAPTURE_POLICY_PROFILE_KEY,
    input.policyDocument,
  );
  if (!document.valid) return { valid: false, errors: document.errors };

  const rules = input.policyDocument as CapturePolicyRules;
  return {
    valid: true,
    rules: {
      maxSliceValiditySeconds: rules.maxSliceValiditySeconds,
      allowedPurposeCodes: [...rules.allowedPurposeCodes],
    },
  };
}
