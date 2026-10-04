import {
  createPolicyProfileDocumentValidator,
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileKey,
  registeredPolicyProfileReference,
  type Common,
  type Core,
  type PolicyProfileValidationError,
} from '@zhiju/contracts';
import { TASK_BOARD_POLICY_PROFILE_KEY, type TaskBoardPolicyRules } from './task-board-types.js';

// =============================================================================
// IM-06 (#179) TaskExecution owning validation of the first-version consumer
// policy profiles.
// =============================================================================
//
// TaskExecution owns the rule semantics of `execution.context_builder.policy@1.0`,
// `execution.task_readiness.policy@1.0` and `execution.work_order_validation.policy@1.0`;
// the build-time registry only owns the canonical entries and the closed field
// schemas (design decision §12.4, Spec 003 §11.9). Each consumer here:
//
// 1. requires its own profile key to be declared by `policySchemaRefs` — a
//    historical `im02-static-v1` entry never stands in for a profile;
// 2. applies the registered closed schema and returns the validated rules.
//
// It performs no I/O, resolves no Policy version, evaluates no criterion and
// derives no `validUntil`: existence, authorization, lifecycle, Evaluator
// execution and the business chains stay `NOT RUN` until their own
// implementation Issue.
// =============================================================================

/** Registry keys of the profiles the TaskExecution consumers require. */
export const CONTEXT_BUILDER_POLICY_PROFILE_KEY = 'execution.context_builder.policy@1.0';
export const TASK_READINESS_POLICY_PROFILE_KEY = 'execution.task_readiness.policy@1.0';
export const WORK_ORDER_VALIDATION_POLICY_PROFILE_KEY =
  'execution.work_order_validation.policy@1.0';

/** Closed rule fields of the Initial Context Builder profile. */
export interface ContextBuilderPolicyRules {
  readonly allowedProjectionTypes: readonly Common.ProjectionType[];
}

/** Closed rule fields of the TaskReadinessBuilder profile. */
export interface TaskReadinessPolicyRules {
  readonly maxReadinessValiditySeconds: Common.PositiveInteger;
}

/** Closed rule fields of the WorkOrderValidator profile. */
export interface WorkOrderValidationPolicyRules {
  readonly maxValidationValiditySeconds: Common.PositiveInteger;
  /**
   * Optional; absent and empty both mean "no mandatory criterion type". Values
   * are limited to the seven registered Core v1.0 Criterion Types.
   */
  readonly mandatoryCriterionTypes?: readonly Core.CompletionCriterion['criterionType'][];
}

export type PolicyProfileValidationResult<TRules> =
  | { readonly valid: true; readonly rules: TRules }
  | { readonly valid: false; readonly errors: readonly PolicyProfileValidationError[] };

const documents = createPolicyProfileDocumentValidator();

function profileNotDeclared(registryKey: string): {
  readonly errors: readonly PolicyProfileValidationError[];
} {
  return {
    errors: [
      {
        instancePath: '/policySchemaRefs',
        schemaPath: '',
        keyword: 'policyProfileRegistry',
        params: { registryKey },
        message: 'policy profile is not declared by an exact registered reference',
      },
    ],
  };
}

function validateProfile<TRules>(
  registryKey: string,
  input: {
    readonly policySchemaRefs: readonly unknown[];
    readonly policyDocument: unknown;
  },
  project: (document: Record<string, unknown>) => TRules,
): PolicyProfileValidationResult<TRules> {
  const canonical = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  const declared = input.policySchemaRefs.some(
    (reference) =>
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, reference) === registryKey,
  );
  if (canonical === undefined || !declared) {
    return { valid: false, ...profileNotDeclared(registryKey) };
  }

  const document = documents.validate(
    POLICY_PROFILE_REGISTRY_VERSION,
    registryKey,
    input.policyDocument,
  );
  if (!document.valid) return { valid: false, errors: document.errors };

  return { valid: true, rules: project(input.policyDocument as Record<string, unknown>) };
}

/**
 * Validate the Initial Context Builder profile: the canonical reference must be
 * declared and the document must expose only the approved projection types.
 */
export function validateContextBuilderPolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): PolicyProfileValidationResult<ContextBuilderPolicyRules> {
  return validateProfile(CONTEXT_BUILDER_POLICY_PROFILE_KEY, input, (document) => ({
    allowedProjectionTypes: [...(document.allowedProjectionTypes as Common.ProjectionType[])],
  }));
}

/**
 * Validate the TaskReadinessBuilder profile: the canonical reference must be
 * declared and the document must carry the approved validity bound.
 */
export function validateTaskReadinessPolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): PolicyProfileValidationResult<TaskReadinessPolicyRules> {
  return validateProfile(TASK_READINESS_POLICY_PROFILE_KEY, input, (document) => ({
    maxReadinessValiditySeconds: document.maxReadinessValiditySeconds as number,
  }));
}

/**
 * Validate the WorkOrderValidator profile. `mandatoryCriterionTypes` may be
 * omitted or empty; any value outside the seven registered Core v1.0 Criterion
 * Types is rejected by the closed schema.
 */
export function validateWorkOrderValidationPolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): PolicyProfileValidationResult<WorkOrderValidationPolicyRules> {
  return validateProfile(WORK_ORDER_VALIDATION_POLICY_PROFILE_KEY, input, (document) => ({
    maxValidationValiditySeconds: document.maxValidationValiditySeconds as number,
    ...(document.mandatoryCriterionTypes === undefined
      ? {}
      : {
          mandatoryCriterionTypes: [
            ...(document.mandatoryCriterionTypes as readonly Core.CompletionCriterion['criterionType'][]),
          ],
        }),
  }));
}

/**
 * Validate the finite Task Board profile. Every bound is a positive safe
 * integer and the closed schema already rejects missing/unknown fields and the
 * approved upper bounds; the cross-field `maxPageSize <= maxSnapshotRows` rule
 * stays an owning rule applied here.
 */
export function validateTaskBoardPolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): PolicyProfileValidationResult<TaskBoardPolicyRules> {
  const validated = validateProfile(TASK_BOARD_POLICY_PROFILE_KEY, input, (document) => ({
    maxPageSize: document.maxPageSize as number,
    maxSnapshotRows: document.maxSnapshotRows as number,
    maxSnapshotBytes: document.maxSnapshotBytes as number,
    freshnessMaxAgeSeconds: document.freshnessMaxAgeSeconds as number,
    cursorTtlSeconds: document.cursorTtlSeconds as number,
    refreshIntervalSeconds: document.refreshIntervalSeconds as number,
    workerLeaseSeconds: document.workerLeaseSeconds as number,
  }));
  if (!validated.valid) return validated;
  if (validated.rules.maxPageSize <= validated.rules.maxSnapshotRows) return validated;
  return {
    valid: false,
    errors: [
      {
        keyword: 'maxPageSize',
        instancePath: '/maxPageSize',
        schemaPath: '#/properties/maxPageSize',
        params: {},
        message: 'maxPageSize must not exceed maxSnapshotRows',
      },
    ],
  };
}

export const WORK_ORDER_CONTROLS_POLICY_PROFILE_KEY = 'execution.work_order_controls.policy@1.0';
export type WorkOrderControls = Pick<
  Core.WorkOrderContract,
  | 'targetScope'
  | 'allowedCapabilities'
  | 'deniedCapabilities'
  | 'expectedOutputs'
  | 'riskAndQuality'
  | 'executionPolicy'
  | 'budget'
  | 'harnessPolicy'
  | 'modelPolicy'
>;

export const RECOVERY_CONTROLS_POLICY_PROFILE_KEY = 'execution.work_order_controls.policy@1.1';
export interface RecoveryControls {
  readonly answerSpecProfile: 'execution.answer.customer_material.v1';
  readonly requestType: 'execution.input.customer_material_confirmation';
  readonly responderRole: 'project.customer_material.confirmer';
  readonly maxBlockingRequests: 1;
  readonly maxRecoveryRuns: 1;
  readonly retryReason: 'BLOCKED_INPUT_RESOLVED';
  readonly run2Outcome: 'COMPLETED';
  readonly materialUse: 'REFERENCE_ONLY';
}

export function validateWorkOrderControlsPolicy(input: {
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}): PolicyProfileValidationResult<{
  readonly controls: WorkOrderControls;
  readonly recovery?: RecoveryControls;
  readonly completionPolicyRef?: Common.VersionedRef;
}> {
  const declared = input.policySchemaRefs.map((ref) =>
    registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, ref),
  );
  const formal = declared.includes('execution.work_order_controls.policy@2.0');
  const recovery = declared.includes(RECOVERY_CONTROLS_POLICY_PROFILE_KEY);
  if (formal && (recovery || declared.includes(WORK_ORDER_CONTROLS_POLICY_PROFILE_KEY)))
    return { valid: false, ...profileNotDeclared('ambiguous controls version') };
  if (recovery && declared.includes(WORK_ORDER_CONTROLS_POLICY_PROFILE_KEY))
    return { valid: false, ...profileNotDeclared('ambiguous controls version') };
  return validateProfile(
    formal
      ? 'execution.work_order_controls.policy@2.0'
      : recovery
        ? RECOVERY_CONTROLS_POLICY_PROFILE_KEY
        : WORK_ORDER_CONTROLS_POLICY_PROFILE_KEY,
    input,
    (document) => ({
      controls: structuredClone(document.controls) as WorkOrderControls,
      ...(recovery || (formal && document.recovery !== undefined)
        ? { recovery: structuredClone(document.recovery) as RecoveryControls }
        : {}),
      ...(formal
        ? {
            completionPolicyRef: structuredClone(
              document.completionPolicyRef,
            ) as Common.VersionedRef,
          }
        : {}),
    }),
  );
}

export function validateCompletionPolicy(input: {
  policySchemaRefs: readonly unknown[];
  policyDocument: unknown;
}) {
  return validateProfile('execution.completion.policy@1.0', input, (document) => ({
    maxCompletionValiditySeconds: document.maxCompletionValiditySeconds as number,
  }));
}
