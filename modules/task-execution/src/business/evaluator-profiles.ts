import {
  EVALUATOR_PROFILE_REGISTRY_VERSION,
  registeredEvaluatorProfileKey,
  registeredEvaluatorProfileReference,
  type Common,
  type EvaluatorProfileRegistryKey,
} from '@zhiju/contracts';

// =============================================================================
// IM-06 (#189) TaskExecution owning support boundary for the first-version
// Evaluator profile selectors.
// =============================================================================
//
// TaskExecution owns the support boundary of `te.task_readiness.evaluator@1.0`
// and `te.work_order_validation.evaluator@1.0`; the build-time registry only
// owns their canonical entries (design decision §12.4, Spec 003 §11.9). Each
// resolver below therefore requires the exact registered selector of its own
// consumer and returns nothing for every other input.
//
// It performs no I/O, runs no Evaluator, derives no `validUntil` and produces
// no judgment: the deterministic Evaluator implementation, the resolution call
// sites, `EXECUTION_CRITERION_UNSUPPORTED` and the Readiness/Validation chains
// stay `NOT IMPLEMENTED / NOT RUN` until their own implementation Issue.
// =============================================================================

/** The Evaluator profile selector the TaskReadinessBuilder is registered for. */
export const TASK_READINESS_EVALUATOR_PROFILE_KEY =
  'te.task_readiness.evaluator@1.0' satisfies EvaluatorProfileRegistryKey;

/** The Evaluator profile selector the WorkOrderValidator is registered for. */
export const WORK_ORDER_VALIDATION_EVALUATOR_PROFILE_KEY =
  'te.work_order_validation.evaluator@1.0' satisfies EvaluatorProfileRegistryKey;

/**
 * Exact resolution of a criterion `evaluatorRef` against the selector of one
 * consumer. A registered key the build did not register, an unknown
 * objectType/objectId/versionId, a non-Platform Scope, a non-`VERSIONED` kind,
 * an extra field, another consumer's selector and any caller-crafted look-alike
 * all resolve to `undefined`, which the owning Handler maps to
 * `EXECUTION_CRITERION_UNSUPPORTED`. There is no latest lookup and no fallback.
 *
 * The returned reference is the registry entry, not the caller's value: a
 * consumer never acts on caller-supplied identity bytes.
 */
function resolveSupportedEvaluatorProfile(
  reference: unknown,
  requiredKey: EvaluatorProfileRegistryKey,
): Common.VersionedRef | undefined {
  if (
    registeredEvaluatorProfileKey(EVALUATOR_PROFILE_REGISTRY_VERSION, reference) !== requiredKey
  ) {
    return undefined;
  }
  return registeredEvaluatorProfileReference(EVALUATOR_PROFILE_REGISTRY_VERSION, requiredKey);
}

export function resolveTaskReadinessEvaluatorProfile(
  reference: unknown,
): Common.VersionedRef | undefined {
  return resolveSupportedEvaluatorProfile(reference, TASK_READINESS_EVALUATOR_PROFILE_KEY);
}

export function resolveWorkOrderValidationEvaluatorProfile(
  reference: unknown,
): Common.VersionedRef | undefined {
  return resolveSupportedEvaluatorProfile(reference, WORK_ORDER_VALIDATION_EVALUATOR_PROFILE_KEY);
}
