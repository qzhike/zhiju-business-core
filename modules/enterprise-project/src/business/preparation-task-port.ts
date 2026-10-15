import {
  ContractRegistry,
  operationResultSchemaRef,
  operationPayloadSchemaRef,
  PreparationError,
  assertPreparationClosed,
  assertPreparationCommand,
  assertPreparationHash,
  samePreparationValue,
  type Common,
  type PreparationSession,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import { isUuidV7 } from '@zhiju/shared-kernel';
export interface PreparationTaskPayload {
  projectRef: Common.ObjectRef;
  preparationSourceRef: Common.SnapshotRef;
  analysisProfileRef: Common.VersionedRef;
  definition: {
    kind: 'PREPARATION_ANALYSIS';
    objective: string;
    inputRefs: Common.TypedReference[];
    expectedReportProfileRef: Common.VersionedRef;
  };
}
export interface PreparationAnalysisPayload {
  taskRef: Common.ObjectRef;
  taskDefinitionSnapshotRef: Common.ContentAddressedRef;
  expectedTaskAggregateVersion: number;
  preparationSourceRef: Common.SnapshotRef;
  analysisProfileRef: Common.VersionedRef;
}
export type PreparationTaskCommand = WorkspaceCommandInput<PreparationTaskPayload>;
export type PreparationAnalysisCommand = WorkspaceCommandInput<PreparationAnalysisPayload>;
export interface PreparationTaskResult {
  taskRef: Common.ObjectRef;
  definitionSnapshotRef: Common.ContentAddressedRef;
  aggregateVersion: number;
  receiptRef: Common.TypedReference;
}
export interface PreparationAnalysisResult {
  analysisRequestRef: Common.ObjectRef;
  receiptRef: Common.TypedReference;
}
export interface PreparationTaskPort {
  read?(
    session: PreparationSession,
    input: {
      operation: 'TASK' | 'ANALYSIS_REQUEST';
      originalCommand: PreparationTaskCommand | PreparationAnalysisCommand;
    },
  ): Promise<{ status: 'COMMITTED' | 'NOT_COMMITTED' | 'UNKNOWN'; result?: unknown }>;
  create(
    session: PreparationSession,
    input: PreparationTaskCommand,
  ): Promise<PreparationTaskResult>;
  request(
    session: PreparationSession,
    input: PreparationAnalysisCommand,
  ): Promise<PreparationAnalysisResult>;
}
const selectors = [
  ['execution.create_preparation_analysis_task', 'zhiju.execution.task'],
  ['execution.request_preparation_analysis', 'zhiju.execution.preparation_analysis_request'],
] as const;
let installedRegistry: ContractRegistry | undefined;
function registry() {
  return (installedRegistry ??= new ContractRegistry());
}
/** A callback alone cannot install a registered execution capability. */
export function preparationTaskOperationsRegistered(): boolean {
  return selectors.every(([operation, target]) => {
    const metadata = registry().getOperation(operation, '1.0');
    return (
      metadata?.schemaStatus === 'FULL' &&
      metadata.owner === 'task-execution' &&
      metadata.kind === 'COMMAND' &&
      metadata.concurrencyMode === 'CREATE' &&
      metadata.targetObjectType === target &&
      operationResultSchemaRef(metadata) !== undefined
    );
  });
}
function invalid(): never {
  throw new PreparationError('PREPARATION_HANDOFF_RECEIPT_INVALID');
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
}
function reference(
  value: unknown,
  scope: Common.ScopeRef,
  kind: 'OBJECT' | 'CONTENT_ADDRESSED',
  objectType?: string,
) {
  object(value);
  assertPreparationClosed(
    value,
    [
      'kind',
      'objectType',
      'objectId',
      'scope',
      ...(kind === 'CONTENT_ADDRESSED' ? ['contentHash'] : []),
    ],
    kind === 'CONTENT_ADDRESSED' ? ['immutableVersionId'] : [],
  );
  if (
    value.kind !== kind ||
    typeof value.objectType !== 'string' ||
    !value.objectType.trim() ||
    (objectType !== undefined && value.objectType !== objectType) ||
    typeof value.objectId !== 'string' ||
    !isUuidV7(value.objectId) ||
    !samePreparationValue(value.scope, scope)
  )
    invalid();
  if (kind === 'CONTENT_ADDRESSED') {
    assertPreparationHash(value.contentHash);
    if (
      value.immutableVersionId !== undefined &&
      (typeof value.immutableVersionId !== 'string' || !isUuidV7(value.immutableVersionId))
    )
      invalid();
  }
}
function receipt(value: unknown, scope: Common.ScopeRef) {
  object(value);
  if (value.kind !== 'OBJECT' && value.kind !== 'CONTENT_ADDRESSED') invalid();
  reference(value, scope, value.kind);
}
/** Structural mapping checks only; persisted TE truth additionally requires registered owning readback. */
export function assertPreparationTaskResult(
  operation: 'TASK' | 'ANALYSIS_REQUEST',
  command: PreparationTaskCommand | PreparationAnalysisCommand,
  result: unknown,
): void {
  try {
    const selector = operation === 'TASK' ? selectors[0] : selectors[1];
    assertPreparationCommand(command, selector[0], selector[1], 'CREATE');
    object(result);
    if (operation === 'TASK') {
      assertPreparationClosed(result, [
        'taskRef',
        'definitionSnapshotRef',
        'aggregateVersion',
        'receiptRef',
      ]);
      reference(result.taskRef, command.scopeRef, 'OBJECT', selector[1]);
      if (
        !samePreparationValue(result.taskRef, command.targetRef) ||
        !Number.isSafeInteger(result.aggregateVersion) ||
        (result.aggregateVersion as number) < 1
      )
        invalid();
      reference(
        result.definitionSnapshotRef,
        command.scopeRef,
        'CONTENT_ADDRESSED',
        'zhiju.execution.task_definition_snapshot',
      );
    } else {
      assertPreparationClosed(result, ['analysisRequestRef', 'receiptRef']);
      reference(result.analysisRequestRef, command.scopeRef, 'OBJECT', selector[1]);
      if (!samePreparationValue(result.analysisRequestRef, command.targetRef)) invalid();
    }
    receipt(result.receiptRef, command.scopeRef);
  } catch {
    invalid();
  }
}
/** The same registered owning payload must be valid before any dispatch or replay read. */
export function assertRegisteredPreparationTaskCommand(
  operation: 'TASK' | 'ANALYSIS_REQUEST',
  command: PreparationTaskCommand | PreparationAnalysisCommand,
): void {
  if (!preparationTaskOperationsRegistered())
    throw new PreparationError('PREPARATION_ANALYSIS_CAPABILITY_UNAVAILABLE');
  const selector = operation === 'TASK' ? selectors[0] : selectors[1];
  assertPreparationCommand(command, selector[0], selector[1], 'CREATE');
  const metadata = registry().getOperation(selector[0], '1.0');
  if (!metadata) invalid();
  const schema = operationPayloadSchemaRef(metadata);
  if (!schema || !registry().validateCoreContract(schema, command.payload).valid) invalid();
}
/** Validate raw owning result fields before accepting either a response or an original-command replay. */
export function assertRegisteredPreparationTaskResult(
  operation: 'TASK' | 'ANALYSIS_REQUEST',
  command: PreparationTaskCommand | PreparationAnalysisCommand,
  result: unknown,
): void {
  if (!preparationTaskOperationsRegistered())
    throw new PreparationError('PREPARATION_ANALYSIS_CAPABILITY_UNAVAILABLE');
  assertRegisteredPreparationTaskCommand(operation, command);
  if (!registry().validateOperationResult(command.type, command.version, result).valid) invalid();
  assertPreparationTaskResult(operation, command, result);
}

/** Exact original-command readback must preserve every returned ref and hash. */
export function assertPreparationTaskReadback(
  operation: 'TASK' | 'ANALYSIS_REQUEST',
  command: PreparationTaskCommand | PreparationAnalysisCommand,
  result: unknown,
  readback: unknown,
): void {
  assertPreparationTaskResult(operation, command, result);
  assertPreparationTaskResult(operation, command, readback);
  if (!samePreparationValue(result, readback)) invalid();
}
