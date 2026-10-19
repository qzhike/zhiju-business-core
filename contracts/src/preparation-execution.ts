import { runnerAnalysisReportSchema } from './runner-analysis-schema.ts';
import type { Common } from './generated/types/common.js';
import type { JsonSchema } from './schema-types.js';
import {
  preparationOwningReferenceSchema,
  preparationTemplateVersionRefSchema,
} from './preparation-project.ts';

export const PREPARATION_EXECUTION_PROFILE = 'te.preparation_analysis@1' as const;
export const PREPARATION_CONTEXT_SCHEMA =
  'https://schemas.zhiju.local/core/preparation-context/1.1';
export const PREPARATION_WORK_ORDER_SCHEMA = 'https://schemas.zhiju.local/core/work-order/1.1';
export interface PreparationExecutionBinding {
  projectRef: Common.ObjectRef;
  preparationSourceRef: Common.SnapshotRef;
  analysisProfileRef: Common.VersionedRef;
}
export interface PreparationAnalysisTaskPayload extends PreparationExecutionBinding {
  definition: {
    kind: 'PREPARATION_ANALYSIS';
    objective: string;
    inputRefs: Common.TypedReference[];
    expectedReportProfileRef: Common.VersionedRef;
  };
}
export interface PreparationAnalysisRequestPayload {
  taskRef: Common.ObjectRef;
  taskDefinitionSnapshotRef: Common.ContentAddressedRef;
  expectedTaskAggregateVersion: number;
  preparationSourceRef: Common.SnapshotRef;
  analysisProfileRef: Common.VersionedRef;
}
export type PreparationExecutionState =
  | 'PENDING'
  | 'PREPARING'
  | 'RUNNING'
  | 'VALIDATING'
  | 'ACCEPTED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'EXPIRED';
export interface PreparationExecutionProgress {
  analysisRequestRef: Common.ObjectRef;
  preparationSourceRef: Common.SnapshotRef;
  taskRef: Common.ObjectRef;
  state: PreparationExecutionState;
  reasonCodes: string[];
  runRef?: Common.ObjectRef;
  agentResultRef?: Common.ContentAddressedRef;
  acceptanceRef?: Common.ContentAddressedRef;
  updatedAt: string;
}
export const PREPARATION_EXECUTION_OPERATIONS = [
  [
    'execution.create_preparation_analysis_task',
    'execution.preparation.task.create',
    'zhiju.execution.task',
    'COMMAND',
  ],
  [
    'execution.build_preparation_context',
    'execution.preparation.context.build',
    'zhiju.execution.preparation_context',
    'COMMAND',
  ],
  [
    'execution.request_preparation_analysis',
    'execution.preparation.analysis.request',
    'zhiju.execution.preparation_analysis_request',
    'COMMAND',
  ],
  [
    'execution.get_preparation_analysis_result',
    'execution.preparation.result.read',
    'execution.agent_result',
    'QUERY',
  ],
  [
    'project.accept_preparation_report',
    'project.preparation.report.accept',
    'zhiju.project.preparation_report',
    'COMMAND',
  ],
  [
    'project.get_preparation_analysis_report',
    'project.preparation.report.read',
    'zhiju.project.project',
    'QUERY',
  ],
] as const;
export function preparationOperationContracts(owner: 'task-execution' | 'enterprise-project') {
  const prefix = owner === 'task-execution' ? 'execution.' : 'project.';
  return Object.fromEntries(
    PREPARATION_EXECUTION_OPERATIONS.filter(([type]) => type.startsWith(prefix)).map(([type]) => [
      type,
      {
        payloadSchemaRef: `https://schemas.zhiju.local/modules/${owner}/1.0#/$defs/${type.replaceAll('.', '_')}_payload`,
        resultSchemaRef: `https://schemas.zhiju.local/modules/${owner}/1.0#/$defs/${type.replaceAll('.', '_')}_result`,
      },
    ]),
  );
}
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const c = (n: string): JsonSchema => ({ $ref: common + n });
const object = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((name) => !optional.includes(name)),
});
const list = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const exact = (name: string, kind = 'objectRef'): JsonSchema => ({
  allOf: [c(kind), { type: 'object', properties: { objectType: { const: name } } }],
});
const project = exact('zhiju.project.project');
const source = exact('zhiju.project.preparation_source', 'snapshotRef');
const task = exact('zhiju.execution.task');
const workOrder = exact('zhiju.execution.work_order');
const context = exact('zhiju.execution.preparation_context', 'snapshotRef');
const request = exact('zhiju.execution.preparation_analysis_request');
const receipt = exact('execution.command_receipt');
const result = exact('execution.agent_result', 'contentAddressedRef');
const acceptance = exact('execution.agent_result_acceptance', 'contentAddressedRef');
const profile = exact('zhiju.task.analysis_profile', 'versionedRef');
const hash = c('contentHash');
const time = c('utcInstant');
const text = c('nonEmptyString');

const optionalProgress = ['runRef', 'agentResultRef', 'acceptanceRef'];
export const preparationExecutionProgressSchema = object(
  {
    analysisRequestRef: request,
    preparationSourceRef: source,
    taskRef: task,
    state: {
      enum: [
        'PENDING',
        'PREPARING',
        'RUNNING',
        'VALIDATING',
        'ACCEPTED',
        'FAILED',
        'UNKNOWN',
        'EXPIRED',
      ],
    },
    reasonCodes: list(c('reasonCode')),
    runRef: exact('execution.run'),
    agentResultRef: result,
    acceptanceRef: acceptance,
    updatedAt: time,
  },
  optionalProgress,
);
const output = object({
  jsonBytes: text,
  markdownBytes: text,
  jsonSha256: hash,
  markdownSha256: hash,
  manifestSha256: hash,
  extractionSha256: hash,
  validationContextSha256: hash,
  observationRef: exact(
    'zhiju.integration.preparation_analysis_observation',
    'contentAddressedRef',
  ),
});
export const preparationExecutionDefinitions: Record<string, JsonSchema> = {
  execution_create_preparation_analysis_task_payload: object({
    projectRef: project,
    preparationSourceRef: source,
    analysisProfileRef: profile,
    definition: object({
      kind: { const: 'PREPARATION_ANALYSIS' },
      objective: text,
      inputRefs: { ...list(preparationOwningReferenceSchema), minItems: 1 },
      expectedReportProfileRef: c('versionedRef'),
    }),
  }),
  execution_create_preparation_analysis_task_result: object({
    taskRef: task,
    definitionSnapshotRef: exact('zhiju.execution.task_definition_snapshot', 'contentAddressedRef'),
    aggregateVersion: { const: 1 },
    receiptRef: receipt,
  }),
  execution_request_preparation_analysis_payload: object({
    taskRef: task,
    taskDefinitionSnapshotRef: exact(
      'zhiju.execution.task_definition_snapshot',
      'contentAddressedRef',
    ),
    expectedTaskAggregateVersion: { const: 1 },
    preparationSourceRef: source,
    analysisProfileRef: profile,
  }),
  execution_request_preparation_analysis_result: object({
    analysisRequestRef: request,
    receiptRef: receipt,
  }),
  execution_build_preparation_context_payload: object({
    taskRef: task,
    workOrderRef: workOrder,
    preparationSourceRef: source,
    builderPolicyRef: c('versionedRef'),
    purpose: { const: 'preparation.analysis' },
    audience: exact('identity.principal'),
  }),
  execution_build_preparation_context_result: object({
    contextRef: context,
    receiptRef: receipt,
    validUntil: time,
  }),
  execution_get_preparation_analysis_result_payload: object({
    agentResultRef: result,
    acceptanceRef: acceptance,
    preparationSourceRef: source,
  }),
  execution_get_preparation_analysis_result_result: object({
    agentResultRef: result,
    acceptanceRef: acceptance,
    preparationSourceRef: source,
    runRef: exact('execution.run'),
    contractRef: exact('zhiju.contract.work_order', 'contentAddressedRef'),
    contextRef: context,
    profileRef: profile,
    output,
    currentUsability: { enum: ['USABLE', 'EXPIRED', 'STALE', 'UNKNOWN'] },
    reasons: list(c('reasonCode')),
  }),
};
const reportRef = exact('zhiju.project.preparation_report', 'snapshotRef');
const candidateSetRef = exact('zhiju.project.preparation_candidate_set', 'snapshotRef');
const planRef = exact('zhiju.project.preparation_plan', 'snapshotRef');
const bytesHash: JsonSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
// Derive module-owned type aliases from the pinned upstream schema; do not maintain
// a second hand-written report grammar. The standalone validator remains registered.
function reportModuleSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reportModuleSchema);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$id' && key !== '$schema' && key !== '$defs')
        .map(([key, child]) => [
          key,
          key === '$ref' && typeof child === 'string' && child.startsWith('#/$defs/')
            ? 'https://schemas.zhiju.local/modules/enterprise-project/1.0#/$defs/runner_analysis_' +
              child.slice(8)
            : reportModuleSchema(child),
        ]),
    );
  return value;
}
const reportDefs = runnerAnalysisReportSchema.$defs as Record<string, JsonSchema>;
export const preparationReportDefinitions: Record<string, JsonSchema> = {
  runner_analysis_report: reportModuleSchema(runnerAnalysisReportSchema) as JsonSchema,
  ...Object.fromEntries(
    Object.entries(reportDefs).map(([name, schema]) => [
      'runner_analysis_' + name,
      reportModuleSchema(schema) as JsonSchema,
    ]),
  ),
  project_accept_preparation_report_payload: object(
    {
      projectRef: project,
      preparationSourceRef: source,
      analysisResultRef: result,
      analysisResultAcceptanceRef: acceptance,
      expectedPreparationVersion: { type: 'integer', minimum: 1 },
      outputProfileRef: exact('zhiju.project.report_profile', 'versionedRef'),
      expectedPreviousReportRef: reportRef,
    },
    ['expectedPreviousReportRef'],
  ),
  project_accept_preparation_report_result: object({
    reportRef,
    candidateSetRef,
    planRef,
    becameCurrent: { type: 'boolean' },
    receiptRef: preparationOwningReferenceSchema,
  }),
  project_get_preparation_analysis_report_payload: object({ projectRef: project, reportRef }, [
    'reportRef',
  ]),
  project_get_preparation_analysis_report_result: object({
    binding: object({
      projectRef: project,
      reportRef,
      candidateSetRef,
      planRef,
      preparationSourceRef: source,
      analysisBasisRef: exact('zhiju.project.preparation_analysis_basis', 'versionedRef'),
      analysisBasisHash: hash,
      analysisBasisPublicationRef: exact(
        'zhiju.project.preparation_analysis_basis_publication',
        'contentAddressedRef',
      ),
      analysisResultRef: result,
      analysisResultAcceptanceRef: acceptance,
      inputManifestBytesSha256: bytesHash,
      reportJsonBytesSha256: bytesHash,
      reportMarkdownBytesSha256: bytesHash,
    }),
    content: object({
      report: {
        $ref: 'https://schemas.zhiju.local/modules/enterprise-project/1.0#/$defs/runner_analysis_report',
      },
      narrativeMarkdown: text,
    }),
    currentUsability: object({
      usable: { type: 'boolean' },
      reasonCodes: list(c('reasonCode')),
      checkedAt: time,
    }),
    allowedActions: { type: 'array', items: false, maxItems: 0 },
    sourceWatermarks: list(c('sourceWatermark')),
  }),
};
// Context source records are exact owning observations; absence of startup facts is intentional.
export const preparationContextSchema: JsonSchema = {
  $id: PREPARATION_CONTEXT_SCHEMA,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({
    profile: { const: PREPARATION_EXECUTION_PROFILE },
    projectRef: project,
    taskRef: task,
    workOrderRef: workOrder,
    preparationSourceRef: source,
    purpose: { const: 'preparation.analysis' },
    audience: exact('identity.principal'),
    analysisBasisRef: exact('zhiju.project.preparation_analysis_basis', 'versionedRef'),
    analysisBasisHash: hash,
    analysisBasisPublicationRef: exact(
      'zhiju.project.preparation_analysis_basis_publication',
      'contentAddressedRef',
    ),
    inputRefs: { ...list(preparationOwningReferenceSchema), minItems: 1 },
    templateRefs: { ...list(preparationTemplateVersionRefSchema), minItems: 1 },
    instructions: {
      ...list(
        object({
          sourceId: text,
          bytesSha256: bytesHash,
          byteLength: { type: 'integer', minimum: 0 },
        }),
      ),
      minItems: 1,
    },
    runtimeProfileHash: hash,
    vocabularyHash: hash,
    requirementBindingsHash: hash,
    initialActorSnapshotRef: c('snapshotRef'),
    initialAuthorizationDecisionRef: c('contentAddressedRef'),
    policySnapshotId: c('uuidV7'),
    createdAt: time,
    validUntil: time,
  }),
};
export const preparationWorkOrderSchema: JsonSchema = {
  $id: PREPARATION_WORK_ORDER_SCHEMA,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...object({
    profile: { const: PREPARATION_EXECUTION_PROFILE },
    workOrderRef: workOrder,
    taskRef: task,
    projectRef: project,
    contextSnapshotRef: context,
    preparationSourceRef: source,
    objective: { const: 'COMPARE_CUSTOMER_WITH_TEMPLATES' },
    allowedCapabilities: { const: ['preparation.analysis'] },
    deniedCapabilities: {
      const: ['document.write', 'project.start', 'artifact.approve', 'release.publish'],
    },
    expectedOutputs: {
      const: ['analysis-report.json', 'analysis-report.md', 'extraction-index.json'],
    },
    completionCriteria: { const: 'REPORT_ACCEPTANCE_ONLY' },
    runtimeProfileHash: hash,
    validationRefs: { ...list(c('snapshotRef')), minItems: 5, maxItems: 5, uniqueItems: true },
    readinessRef: c('snapshotRef'),
    budget: object({
      maxAttempts: { const: 1 },
      wallClockLimitSeconds: { type: 'integer', minimum: 1, maximum: 3600 },
      maxOutputBytes: { const: 33554432 },
    }),
    issuedAt: time,
    expiresAt: time,
    specificationHash: hash,
  }),
};

export interface PreparationTaskCreated {
  taskRef: Common.ObjectRef;
  definitionSnapshotRef: Common.ContentAddressedRef;
  aggregateVersion: 1;
  receiptRef: Common.ObjectRef;
}
export interface PreparationAnalysisRequested {
  analysisRequestRef: Common.ObjectRef;
  receiptRef: Common.ObjectRef;
}
export interface PreparationResultQuery {
  agentResultRef: Common.ContentAddressedRef;
  acceptanceRef: Common.ContentAddressedRef;
  preparationSourceRef: Common.SnapshotRef;
}
export interface PreparationResultContent extends PreparationResultQuery {
  runRef: Common.ObjectRef;
  contractRef: Common.ContentAddressedRef;
  contextRef: Common.SnapshotRef;
  profileRef: Common.VersionedRef;
  output: {
    jsonBytes: string;
    markdownBytes: string;
    jsonSha256: Common.ContentHash;
    markdownSha256: Common.ContentHash;
    manifestSha256: Common.ContentHash;
    extractionSha256: Common.ContentHash;
    validationContextSha256: Common.ContentHash;
    observationRef: Common.ContentAddressedRef;
  };
  currentUsability: 'USABLE' | 'EXPIRED' | 'STALE' | 'UNKNOWN';
  reasons: string[];
}
export interface PreparationReportAcceptancePayload {
  projectRef: Common.ObjectRef;
  preparationSourceRef: Common.SnapshotRef;
  analysisResultRef: Common.ContentAddressedRef;
  analysisResultAcceptanceRef: Common.ContentAddressedRef;
  expectedPreparationVersion: number;
  outputProfileRef: Common.VersionedRef;
  expectedPreviousReportRef?: Common.SnapshotRef;
}
