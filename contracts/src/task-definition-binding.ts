type UnknownRecord = Record<string, unknown>;

export type TaskDefinitionBindingCode =
  | 'INVALID_TASK_DEFINITION'
  | 'DUPLICATE_OUTPUT_SLOT'
  | 'DUPLICATE_CRITERION_ID'
  | 'CRITERION_BINDING_BRANCH_MISMATCH'
  | 'UNKNOWN_OUTPUT_SLOT';

export interface TaskDefinitionBindingError {
  readonly path: string;
  readonly code: TaskDefinitionBindingCode;
  readonly message: string;
}

export interface TaskDefinitionBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly TaskDefinitionBindingError[];
}

/** §11.6 binding branch selected by each criterion type. */
const branchByCriterionType = {
  EXPECTED_OUTPUTS_SATISFIED: 'OUTPUT_SLOTS',
  NO_BLOCKING_INFORMATION_REQUEST: 'TASK_AND_CHILD_WORK_ORDERS',
  REQUIRED_WORK_ORDERS_COMPLETED: 'ALL_CHILD_WORK_ORDERS',
  REVISION_ACCEPTANCE_READY: 'OUTPUT_SLOTS',
  REVISION_FULLY_APPROVED: 'OUTPUT_SLOTS',
} as const;

type BindingBranch = (typeof branchByCriterionType)[keyof typeof branchByCriterionType];

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: TaskDefinitionBindingError[],
  path: string,
  code: TaskDefinitionBindingCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

/**
 * Reads the declared `expectedOutputSpec.outputs` slot identities. Duplicate
 * slots are rejected because a criterion binds a slot, not a position: two
 * outputs sharing one slot would make every list binding ambiguous.
 */
function readOutputSlots(
  value: unknown,
  errors: TaskDefinitionBindingError[],
): Set<string> | undefined {
  if (!isRecord(value) || !Array.isArray(value.outputs)) {
    pushError(
      errors,
      '/expectedOutputSpec',
      'INVALID_TASK_DEFINITION',
      'TaskDefinitionV2 must declare an expectedOutputSpec carrying an outputs array',
    );
    return undefined;
  }

  const slots = new Set<string>();
  for (const [index, output] of value.outputs.entries()) {
    if (!isRecord(output) || typeof output.outputSlot !== 'string') {
      pushError(
        errors,
        `/expectedOutputSpec/outputs/${index}`,
        'INVALID_TASK_DEFINITION',
        'Expected output is missing its outputSlot identity',
      );
      return undefined;
    }
    if (slots.has(output.outputSlot)) {
      pushError(
        errors,
        `/expectedOutputSpec/outputs/${index}/outputSlot`,
        'DUPLICATE_OUTPUT_SLOT',
        'Expected outputs must declare distinct output slots',
      );
      continue;
    }
    slots.add(output.outputSlot);
  }
  return slots;
}

function observedBranch(bindings: UnknownRecord): BindingBranch | undefined {
  if (Array.isArray(bindings.outputSlots)) return 'OUTPUT_SLOTS';
  if (bindings.scope === 'ALL_CHILD_WORK_ORDERS') return 'ALL_CHILD_WORK_ORDERS';
  if (bindings.scope === 'TASK_AND_CHILD_WORK_ORDERS') return 'TASK_AND_CHILD_WORK_ORDERS';
  return undefined;
}

/**
 * Rejects a criterion whose `bindings` branch does not belong to its
 * `criterionType`, and every `outputSlots` entry that no declared
 * `expectedOutputSpec.outputs` slot provides.
 *
 * Structural closure (unknown fields, unknown types, enums, the branch shape
 * itself) is already enforced by the TaskCriterionV1 Schema. This check covers
 * the two rules a JSON Schema cannot express: the type-to-branch correspondence
 * and the reference from a binding into another member of the same definition.
 * It says nothing about whether any evaluator, output or fact actually exists —
 * those are owning-Handler facts and remain outside the Schema boundary.
 */
function readCriteria(
  value: unknown,
  outputSlots: Set<string> | undefined,
  errors: TaskDefinitionBindingError[],
): void {
  if (!isRecord(value) || !Array.isArray(value.criteria)) {
    pushError(
      errors,
      '/completionCriteria',
      'INVALID_TASK_DEFINITION',
      'TaskDefinitionV2 must declare completionCriteria carrying a criteria array',
    );
    return;
  }

  const seenCriterionIds = new Set<string>();
  for (const [index, criterion] of value.criteria.entries()) {
    const path = `/completionCriteria/criteria/${index}`;
    if (!isRecord(criterion)) {
      pushError(errors, path, 'INVALID_TASK_DEFINITION', 'Criterion is not an object');
      return;
    }

    if (typeof criterion.criterionId === 'string') {
      if (seenCriterionIds.has(criterion.criterionId)) {
        pushError(
          errors,
          `${path}/criterionId`,
          'DUPLICATE_CRITERION_ID',
          'Criteria must declare distinct criterionId values',
        );
      } else {
        seenCriterionIds.add(criterion.criterionId);
      }
    }

    const criterionType =
      typeof criterion.criterionType === 'string' ? criterion.criterionType : undefined;
    const expected =
      criterionType === undefined
        ? undefined
        : (branchByCriterionType as Readonly<Record<string, BindingBranch | undefined>>)[
            criterionType
          ];
    const bindings = isRecord(criterion.bindings) ? criterion.bindings : undefined;
    if (criterionType !== undefined && expected !== undefined && bindings !== undefined) {
      const observed = observedBranch(bindings);
      if (observed !== expected) {
        pushError(
          errors,
          `${path}/bindings`,
          'CRITERION_BINDING_BRANCH_MISMATCH',
          `Criterion ${criterionType} must use the ${expected} bindings branch`,
        );
      }
    }

    if (outputSlots === undefined || bindings === undefined) continue;
    const bound = bindings.outputSlots;
    if (!Array.isArray(bound)) continue;
    for (const [slotIndex, slot] of bound.entries()) {
      if (typeof slot !== 'string') continue;
      if (!outputSlots.has(slot)) {
        pushError(
          errors,
          `${path}/bindings/outputSlots/${slotIndex}`,
          'UNKNOWN_OUTPUT_SLOT',
          'Criterion binds an output slot that expectedOutputSpec does not declare',
        );
      }
    }
  }
}

/**
 * Pure contract validation of an approved `TaskDefinitionV2`. It is the
 * companion of the registered `taskDefinitionV2` Schema; callers that only need
 * the structural boundary keep using the Schema, and callers that must not
 * accept an unsatisfiable criterion run both.
 */
export function validateTaskDefinitionBinding(
  input: unknown,
): TaskDefinitionBindingValidationResult {
  const errors: TaskDefinitionBindingError[] = [];
  if (!isRecord(input)) {
    pushError(errors, '', 'INVALID_TASK_DEFINITION', 'TaskDefinitionV2 must be an object');
    return { valid: false, errors };
  }

  const outputSlots = readOutputSlots(input.expectedOutputSpec, errors);
  readCriteria(input.completionCriteria, outputSlots, errors);
  return { valid: errors.length === 0, errors };
}
