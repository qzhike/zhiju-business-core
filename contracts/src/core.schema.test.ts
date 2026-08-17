import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { coreContractSchemas } from './core.schema.js';
import { ContractRegistry } from './registry.js';

// =============================================================================
// Shared fixture primitives
// =============================================================================
//
// UUIDv7 strings are typed from the `common.uuidV7` regex; we reuse a small set
// of well-known constants so positive/negative fixtures stay readable. Each
// positive fixture writes its canonical JSON to
// `tests/fixtures/contracts/core/<contract>-valid.json` for golden review.
//
// Reference rule of thumb: every typed reference uses a distinct UUIDv7 across
// fixture instances so that `uniqueItems` set checks fail loudly if a fixture
// is mutated by accident.
//
// All builders return `unknown` payloads; JSON Schema is intentionally
// untyped and the test helpers below stay free of `any`/non-null assertions
// by going through small, focused mutator helpers.
// =============================================================================

const U_ENT = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const U_PRJ = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const U_TSK = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const U_WO = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const U_RUN = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const U_AR = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const U_CTX = '018f22e2-7c15-7b12-8d86-2de956a9d207';
const U_SNAP = '018f22e2-7c15-7b22-8d86-2de956a9d208';
const U_ART = '018f22e2-7c15-7b32-8d86-2de956a9d209';
const U_REV = '018f22e2-7c15-7b42-8d86-2de956a9d20a';
const U_QP = '018f22e2-7c15-7b52-8d86-2de956a9d20b';
const U_RP = '018f22e2-7c15-7b62-8d86-2de956a9d20c';
const U_RAS = '018f22e2-7c15-7b72-8d86-2de956a9d20d';
const U_ABS = '018f22e2-7c15-7b82-8d86-2de956a9d20e';
const U_RRS = '018f22e2-7c15-7b92-8d86-2de956a9d20f';
const U_REL = '018f22e2-7c15-7ba2-8d86-2de956a9d210';
const U_PKG = '018f22e2-7c15-7bb2-8d86-2de956a9d211';
const U_RCP = '018f22e2-7c15-7bc2-8d86-2de956a9d212';
const U_EV = '018f22e2-7c15-7be2-8d86-2de956a9d214';
const U_GATE = '018f22e2-7c15-7c02-8d86-2de956a9d216';
const U_GRES = '018f22e2-7c15-7c12-8d86-2de956a9d217';
const U_QPV = '018f22e2-7c15-7c22-8d86-2de956a9d218';
const U_APR = '018f22e2-7c15-7c32-8d86-2de956a9d219';
const U_CITM = '018f22e2-7c15-7c42-8d86-2de956a9d21a';
const U_FND = '018f22e2-7c15-7c62-8d86-2de956a9d21c';
const U_KP = '018f22e2-7c15-7c72-8d86-2de956a9d21d';
const U_IRP = '018f22e2-7c15-7c82-8d86-2de956a9d21e';
const U_FUP = '018f22e2-7c15-7c92-8d86-2de956a9d21f';
const U_CP = '018f22e2-7c15-7ca2-8d86-2de956a9d220';
const U_SK = '018f22e2-7c15-7cb2-8d86-2de956a9d221';
const U_TPL = '018f22e2-7c15-7cc2-8d86-2de956a9d222';
const U_EVAL = '018f22e2-7c15-7ce2-8d86-2de956a9d224';
const U_AUT = '018f22e2-7c15-7d02-8d86-2de956a9d226';
const U_RCAP = '018f22e2-7c15-7d12-8d86-2de956a9d227';
const U_REP = '018f22e2-7c15-7d22-8d86-2de956a9d228';
const U_DI = '018f22e2-7c15-7d32-8d86-2de956a9d229';
const U_CC = '018f22e2-7c15-7d42-8d86-2de956a9d22a';
const U_HUM = '018f22e2-7c15-7d52-8d86-2de956a9d22b';
const U_QI = '018f22e2-7c15-7d62-8d86-2de956a9d22c';
const U_RR = '018f22e2-7c15-7d72-8d86-2de956a9d22d';

const DIGEST_ZERO = '0'.repeat(64);
const CONTENT_HASH = {
  algorithm: 'SHA-256' as const,
  digest: DIGEST_ZERO,
  canonicalizationVersion: '1' as const,
};
const SCOPE = { enterpriseId: U_ENT };
const CONTRACT_SCOPE = { enterpriseId: U_ENT, projectId: U_PRJ };

function schemaRef(contractType: string): Record<string, unknown> {
  return {
    kind: 'VERSIONED',
    objectType: `zhiju.contract.${contractType}`,
    objectId: U_CTX,
    versionId: U_CC,
    scope: SCOPE,
  };
}

function baseHeader(contractType: string): Record<string, unknown> {
  return {
    contractId: U_CTX,
    contractType,
    contractVersion: '1.0',
    schemaRef: schemaRef('schema'),
    scopeRef: SCOPE,
    issuedAt: '2026-08-17T00:00:00Z',
    issuedBy: { principalKind: 'SERVICE', principalId: U_HUM },
    correlationId: U_RUN,
    dataClassification: 'INTERNAL',
    canonicalizationVersion: '1',
    payloadHash: CONTENT_HASH,
  };
}

function objectRef(
  objectType: string,
  id: string,
  scope: { enterpriseId: string; projectId: string } = CONTRACT_SCOPE,
): Record<string, unknown> {
  return { kind: 'OBJECT', objectType, objectId: id, scope };
}

function versionedRef(
  objectType: string,
  id: string,
  versionId: string,
  scope: { enterpriseId: string; projectId: string } = CONTRACT_SCOPE,
): Record<string, unknown> {
  return { kind: 'VERSIONED', objectType, objectId: id, versionId, scope };
}

function contentRef(
  objectType: string,
  id: string,
  scope: { enterpriseId: string; projectId: string } = CONTRACT_SCOPE,
): Record<string, unknown> {
  return { kind: 'CONTENT_ADDRESSED', objectType, objectId: id, scope, contentHash: CONTENT_HASH };
}

function snapshotRef(
  objectType: string,
  id: string,
  snapId: string,
  scope: { enterpriseId: string; projectId: string } = CONTRACT_SCOPE,
): Record<string, unknown> {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: id,
    snapshotId: snapId,
    scope,
    contentHash: CONTENT_HASH,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sets `path` (dotted) on a deep-cloned copy of `value`. */
function setPath(value: unknown, dottedPath: string, newValue: unknown): unknown {
  const next = deepClone(value) as Record<string, unknown>;
  const parts = dottedPath.split('.');
  const lastIndex = parts.length - 1;
  if (lastIndex < 0) return next;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < lastIndex; i += 1) {
    const key = parts[i];
    if (key === undefined) return next;
    cursor = cursor[key] as Record<string, unknown>;
  }
  const finalKey = parts[lastIndex];
  if (finalKey === undefined) return next;
  cursor[finalKey] = newValue;
  return next;
}

/** Returns a deep-cloned copy with `path` omitted. Implemented recursively so
 *  that no dynamic property delete happens on a JSON-cloned object. */
function deletePath(value: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split('.');
  return omitDeep(value as Record<string, unknown>, parts);
}

function omitDeep(node: Record<string, unknown>, parts: readonly string[]): unknown {
  if (parts.length === 0) return node;
  const [head, ...tail] = parts;
  if (head === undefined) return node;
  if (tail.length === 0) {
    if (Array.isArray(node)) {
      const index = Number.parseInt(head, 10);
      if (Number.isNaN(index) || index < 0 || index >= node.length) return node;
      return [...node.slice(0, index), ...node.slice(index + 1)];
    }
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key !== head) next[key] = node[key];
    }
    return next;
  }
  const child = node[head];
  if (child === null || typeof child !== 'object') return node;
  const replaced = omitDeep(child as Record<string, unknown>, tail);
  if (Array.isArray(node)) {
    const index = Number.parseInt(head, 10);
    if (Number.isNaN(index) || index < 0 || index >= node.length) return node;
    const next = [...node];
    next[index] = replaced;
    return next;
  }
  return { ...node, [head]: replaced };
}

/** Replaces the leading element of the array located at `path` (dotted)
 *  with `newElement`. */
function setArrayElement(value: unknown, dottedPath: string, newElement: unknown): unknown {
  const parts = dottedPath.split('.');
  if (parts.length === 0) return value;
  const cloned = deepClone(value) as Record<string, unknown>;
  const [head, ...tail] = parts;
  if (head === undefined) return cloned;
  return replaceArrayElementDeep(cloned, head, tail, newElement);
}

function replaceArrayElementDeep(
  node: Record<string, unknown>,
  head: string,
  tail: readonly string[],
  newElement: unknown,
): Record<string, unknown> {
  if (tail.length === 0) {
    const target = node[head];
    if (!Array.isArray(target) || target.length === 0) {
      throw new Error(`setArrayElement: target ${head} is not a non-empty array`);
    }
    return { ...node, [head]: [newElement, ...target.slice(1)] };
  }
  const [nextHead, ...rest] = tail;
  if (nextHead === undefined) return node;
  const child = node[head];
  if (child === null || typeof child !== 'object') return node;
  const replaced = replaceArrayElementDeep(
    child as Record<string, unknown>,
    nextHead,
    rest,
    newElement,
  );
  return { ...node, [head]: replaced };
}

// =============================================================================
// Builders
// =============================================================================

export function projectContextPositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.project_context'),
    contextSnapshotId: U_CTX,
    projectRef: objectRef('zhiju.project.project', U_PRJ),
    enterpriseRef: objectRef('zhiju.project.enterprise', U_ENT),
    projection: {
      projectionType: 'DOCUMENT_WRITER',
      purpose: '采购控制程序正文撰写',
      audience: 'DOCUMENT_REVIEWER',
      builderPolicyRef: versionedRef('zhiju.context.policy', U_CP, U_CP),
    },
    asOf: '2026-08-17T00:00:00Z',
    sourceManifest: {
      enterpriseProfileSnapshotRef: snapshotRef('zhiju.project.enterprise_profile', U_ENT, U_SNAP),
      qmsConfigurationRef: versionedRef('zhiju.project.qms_configuration', U_ENT, U_QPV),
      customerBaselineRef: versionedRef('zhiju.project.customer_baseline', U_ENT, U_QPV),
      templateBaselineRef: versionedRef('zhiju.project.template_baseline', U_ENT, U_QPV),
      regulatoryProfileRef: versionedRef('zhiju.project.regulatory_profile', U_ENT, U_RP),
      gapAnalysisRef: versionedRef('zhiju.project.gap_analysis', U_ENT, U_QPV),
      deliveryPlanRef: versionedRef('zhiju.project.delivery_plan', U_ENT, U_QPV),
      policyRefs: [versionedRef('zhiju.context.policy', U_CP, U_CP)],
      schemaRefs: [versionedRef('zhiju.contract.work_order_schema', U_CP, U_CP)],
      externalAuthoritySnapshotRefs: [],
    },
    contextItems: [
      {
        contextItemId: U_CITM,
        kind: 'REQUIREMENT',
        subjectRef: versionedRef('zhiju.artifact.artifact', U_ART, U_REV),
        epistemicState: 'CONFIRMED',
        value: { presence: 'PRESENT', value: '供应商评价年度复审' },
        evidenceRefs: [
          {
            evidence: contentRef('zhiju.quality.evidence', U_EV),
            relation: 'SUPPORTS',
          },
        ],
        provenanceRefs: [versionedRef('zhiju.project.customer_baseline', U_ENT, U_QPV)],
        recordedTime: '2026-08-01T00:00:00Z',
        permittedUses: ['context.snapshot.read'],
        sensitivity: 'INTERNAL',
      },
    ],
    artifactContext: [
      {
        artifactRef: objectRef('zhiju.artifact.artifact', U_ART),
        baseRevisionRef: contentRef('zhiju.artifact.artifact_revision', U_REV),
        allowedSectionRefs: [versionedRef('zhiju.artifact.artifact_section', U_ART, U_REV)],
        relevantEvidenceRefs: [
          {
            evidence: contentRef('zhiju.quality.evidence', U_EV),
            relation: 'CONTEXT_ONLY',
          },
        ],
        openReviewIssueRefs: [],
        representationRefs: [
          {
            representationId: U_REP,
            revision: contentRef('zhiju.artifact.artifact_revision', U_REV),
            format: 'docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            objectStorageRef: 's3://bucket/key',
            checksum: CONTENT_HASH,
            renderer: {
              rendererId: 'zhiju.artifact.renderer.docx',
              rendererVersion: '1.4.0',
            },
            createdAt: '2026-08-17T00:00:00Z',
          },
        ],
      },
    ],
    workContext: {
      deliveryItemRefs: [objectRef('zhiju.project.delivery_item', U_DI)],
      taskRef: objectRef('zhiju.execution.task', U_TSK),
      workOrderRef: objectRef('zhiju.execution.work_order', U_WO),
      informationRequestRefs: [],
      blockers: [],
      relatedCompletionCriteriaRefs: [
        versionedRef('zhiju.execution.completion_criterion', U_WO, U_CC),
      ],
    },
    unresolvedItems: [],
    omissions: [
      {
        category: 'customer-confidential-financial',
        reasonCode: 'POLICY_REDACTION_APPLIES',
        sourceRef: versionedRef('zhiju.project.customer_baseline', U_ENT, U_QPV),
        effectOnTask: '不影响正文撰写，但下游审计需要原始财务数据',
      },
    ],
    redactions: [
      {
        fieldPath: '/financials/revenue',
        policyRef: versionedRef('zhiju.context.policy', U_CP, U_CP),
        reasonCode: 'CUSTOMER_CONFIDENTIAL',
        substituteSummary: '略去精确金额，仅保留量级',
      },
    ],
    coverage: {
      requestedScopes: ['procurement.procedure'],
      includedScopes: ['procurement.procedure'],
      excludedScopes: ['customer.financials'],
      completeness: 'COMPLETE_FOR_PURPOSE',
    },
    sourceWatermarks: [
      {
        sourceModule: 'zhiju.enterprise_project',
        sequence: 42,
        observedAt: '2026-08-17T00:00:00Z',
      },
    ],
    expiresAt: '2026-09-17T00:00:00Z',
  };
}

export function workOrderPositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.work_order'),
    workOrderRef: objectRef('zhiju.execution.work_order', U_WO),
    taskRef: objectRef('zhiju.execution.task', U_TSK),
    projectRef: objectRef('zhiju.project.project', U_PRJ),
    requestedBy: { principalKind: 'HUMAN', principalId: U_HUM },
    objective: {
      objectiveType: 'artifact.revision.create',
      humanReadableStatement: '撰写并封存采购控制程序第二版',
      successIntent: 'frozen revision available for Review',
      relatedIssueRefs: [objectRef('zhiju.quality.review_issue', U_QI)],
      deliveryItemRefs: [objectRef('zhiju.project.delivery_item', U_DI)],
      outOfScopeStatement: '不调整财务控制程序',
    },
    targetScope: {
      targetObjectRefs: [objectRef('zhiju.artifact.artifact', U_ART)],
      baseContentRefs: [contentRef('zhiju.artifact.artifact_revision', U_REV)],
      allowedUnitRefs: ['section.supplier-evaluation', 'section.review-cadence'],
      forbiddenUnitRefs: ['section.financial-controls'],
      allowedCreateTypes: ['zhiju.artifact.artifact_revision'],
      crossObjectReferencesAllowed: ['section.regulatory-mapping'],
      scopePolicyRef: versionedRef('zhiju.context.policy', U_CP, U_CP),
    },
    inputRefs: [
      {
        inputRole: 'baseline',
        ref: versionedRef('zhiju.project.customer_baseline', U_ENT, U_QPV),
        required: true,
        permittedUse: 'read only',
        contentAccessMode: 'REFERENCE_ONLY',
        integrityRequired: true,
      },
    ],
    contextSnapshotRef: snapshotRef('zhiju.project.context_snapshot', U_CTX, U_SNAP),
    constraints: [{ language: 'zh', coverage: 'procurement' }],
    allowedCapabilities: [
      {
        capabilityType: 'artifact.revision.create',
        actions: ['read', 'create'],
        resourceSelectors: ['artifact.zhiju.artifact.artifact_revision'],
        constraints: [],
        expiresAt: '2026-09-01T00:00:00Z',
        grantPolicyRef: versionedRef('zhiju.identity.policy_snapshot', U_CP, U_CP),
      },
    ],
    deniedCapabilities: [
      {
        capabilityType: 'quality.approval.decide',
        actions: ['approve'],
        resourceSelectors: ['artifact.*'],
        constraints: [],
        expiresAt: '2026-09-01T00:00:00Z',
        grantPolicyRef: versionedRef('zhiju.identity.policy_snapshot', U_CP, U_CP),
      },
    ],
    expectedOutputs: [
      {
        outputSlot: 'revisedProcedure',
        allowedObjectTypes: ['zhiju.artifact.artifact_revision'],
        cardinality: 'EXACTLY_ONE',
        requiredReferenceStrength: 'CONTENT_ADDRESSED',
        creationRequired: true,
        acceptancePolicyRef: versionedRef('zhiju.quality.policy', U_CP, U_CP),
      },
    ],
    completionCriteria: [
      {
        criterionId: U_CC,
        criterionType: 'EXPECTED_OUTPUT_PRESENT',
        evaluatorRef: versionedRef('zhiju.quality.evaluator', U_EVAL, U_EVAL),
        required: true,
        inputBindings: ['expectedOutput.revisedProcedure'],
        expectedCondition: 'one ContentAddressedRef points to a frozen revision',
        failureDisposition: 'block_until_satisfied',
      },
    ],
    riskAndQuality: {
      riskProfileRef: versionedRef('zhiju.quality.risk_profile', U_RP, U_RP),
      qualityProfileRef: versionedRef('zhiju.quality.quality_profile', U_QP, U_QP),
      dataHandlingPolicyRef: versionedRef('zhiju.identity.policy_snapshot', U_CP, U_CP),
      humanReviewRequired: true,
      escalationPolicyRef: versionedRef('zhiju.quality.escalation_policy', U_RP, U_RP),
    },
    executionPolicy: {
      maxAttempts: 3,
      retryableOutcomes: ['PARTIAL', 'BLOCKED_INPUT'],
      resumePolicy: 'rehydrate from last accepted snapshot',
      fallbackPolicy: 'escalate to human on retry exhaustion',
      leasePolicyRef: versionedRef('zhiju.execution.lease_policy', U_CP, U_CP),
      cancellationPolicyRef: versionedRef('zhiju.execution.cancellation_policy', U_CP, U_CP),
    },
    budget: {
      tokenLimit: 200000,
      monetaryLimit: { amountDecimal: '5.00', currency: 'USD' },
      wallClockLimit: 'PT4H',
      toolCallLimit: 500,
      budgetPolicyRef: versionedRef('zhiju.execution.budget_policy', U_CP, U_CP),
    },
    harnessPolicy: {
      requiredHarness: 'zhiju.runtime.adapters.claude',
      preferredHarnesses: ['zhiju.runtime.adapters.claude'],
      fallbackAllowed: false,
      fallbackRequiresHuman: true,
      selectionPolicyRef: versionedRef('zhiju.execution.harness_policy', U_CP, U_CP),
    },
    modelPolicy: {
      allowedProviders: ['anthropic'],
      allowedModels: ['claude-fable-5'],
      prohibitedDataClasses: ['RESTRICTED_PERSONAL'],
      minimumCapabilities: ['long_context'],
      selectionPolicyRef: versionedRef('zhiju.execution.model_policy', U_CP, U_CP),
    },
    versionPins: {
      projectContextContractRef: snapshotRef('zhiju.project.context_snapshot', U_CTX, U_SNAP),
      contextBuilderPolicyRef: versionedRef('zhiju.context.policy', U_CP, U_CP),
      workOrderSchemaRef: versionedRef('zhiju.contract.work_order_schema', U_CP, U_CP),
      skillRefs: [versionedRef('zhiju.skill.skill', U_SK, U_SK)],
      templateRefs: [versionedRef('zhiju.template.template', U_TPL, U_TPL)],
      regulatoryProfileRef: versionedRef('zhiju.project.regulatory_profile', U_ENT, U_RP),
      qualityProfileRef: versionedRef('zhiju.quality.quality_profile', U_QP, U_QP),
      capabilityPolicyRef: versionedRef('zhiju.identity.policy_snapshot', U_CP, U_CP),
      runtimeAdapterContractRef: versionedRef('zhiju.runtime.adapter_contract', U_CP, U_CP),
    },
    issuedAt: '2026-08-17T00:00:00Z',
    expiresAt: '2026-09-01T00:00:00Z',
    specificationHash: CONTENT_HASH,
  };
}

export function agentResultPositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.agent_result'),
    agentResultId: U_AR,
    runRef: objectRef('zhiju.execution.run', U_RUN),
    workOrderRef: objectRef('zhiju.execution.work_order', U_WO),
    taskRef: objectRef('zhiju.execution.task', U_TSK),
    projectRef: objectRef('zhiju.project.project', U_PRJ),
    submissionKind: 'FINAL',
    executionOutcome: 'COMPLETED',
    businessOutputs: [
      {
        outputSlot: 'revisedProcedure',
        ref: contentRef('zhiju.artifact.artifact_revision', U_REV),
        objectType: 'zhiju.artifact.artifact_revision',
        createdByRunRef: objectRef('zhiju.execution.run', U_RUN),
        relationToTarget: 'updates ART-2026-014',
        declaredPurpose: 'frozen revision ready for Review',
      },
    ],
    workspaceOutputs: [
      {
        outputType: 'diagnostic.markdown',
        externalRef: {
          system: 'feishu',
          resourceType: 'message',
          externalId: 'om_workspace_diag',
          observedAt: '2026-08-17T00:05:00Z',
        },
        retentionClass: 'OPERATIONS_30D',
        diagnosticOnly: true,
      },
    ],
    findings: [
      {
        findingId: U_FND,
        type: 'policy.gap',
        severity: 'HIGH',
        statement: '采购控制程序未明确年度复审节奏',
        targetRefs: [objectRef('zhiju.artifact.artifact', U_ART)],
        evidenceRefs: [
          {
            evidence: contentRef('zhiju.quality.evidence', U_EV),
            relation: 'SUPPORTS',
          },
        ],
        suggestedDisposition: 'INVESTIGATE',
      },
    ],
    knowledgeProposals: [
      {
        proposalId: U_KP,
        proposalType: 'memory.commit',
        statement: '...',
        targetRefs: [],
        suggestedAction: 'queue for memory.commit command',
      },
    ],
    inputRequestProposals: [
      {
        proposalId: U_IRP,
        requestType: 'clarify',
        question: '复审周期如何与第三方审核对接？',
        reason: '...',
        targetRefs: [],
        expectedAnswerSpec: { kind: 'freeform' },
        blocking: false,
      },
    ],
    followUpProposals: [
      {
        proposalId: U_FUP,
        followUpType: 'draft.task',
        summary: '为复审节奏创建草稿任务',
        targetRefs: [],
      },
    ],
    provenance: {
      contextSnapshotRef: snapshotRef('zhiju.project.context_snapshot', U_CTX, U_SNAP),
      workOrderContractRef: contentRef('zhiju.contract.work_order', U_WO),
      capabilityGrantRef: contentRef('zhiju.identity.capability_grant', U_RCAP),
      runtimeAdapterRef: versionedRef('zhiju.runtime.adapter_contract', U_CP, U_CP),
      harness: {
        harnessId: 'zhiju.runtime.adapters.claude',
        harnessVersion: '24.19.0',
      },
      provider: 'anthropic',
      model: { modelId: 'claude-fable-5', modelConfigHash: CONTENT_HASH },
      skillRefs: [versionedRef('zhiju.skill.skill', U_SK, U_SK)],
      policyRefs: [versionedRef('zhiju.context.policy', U_CP, U_CP)],
      templateRefs: [versionedRef('zhiju.template.template', U_TPL, U_TPL)],
    },
    humanSummary: '已完成采购控制程序第二版修订并请求评审。',
    submittedAt: '2026-08-17T00:10:00Z',
    submittedByRuntime: objectRef('zhiju.runtime.runtime', U_RUN),
  };
}

export function revisionAcceptancePositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.revision_acceptance'),
    snapshotId: U_RAS,
    artifactRef: objectRef('zhiju.artifact.artifact', U_ART),
    revisionRef: contentRef('zhiju.artifact.artifact_revision', U_REV),
    qualityProfileRef: versionedRef('zhiju.quality.quality_profile', U_QP, U_QP),
    riskProfileRef: versionedRef('zhiju.quality.risk_profile', U_RP, U_RP),
    evaluationStage: 'REVISION_ACCEPTANCE',
    requiredGateSpecs: [
      {
        objectType: 'zhiju.quality.gate_spec',
        gateSpecId: U_GATE,
        gateVersion: '1',
        qualityProfileVersionId: U_QPV,
        evaluationStage: 'REVISION_ACCEPTANCE',
      },
    ],
    gateResultRefs: [contentRef('zhiju.quality.gate_result', U_GRES)],
    evidenceStatusSnapshotRef: snapshotRef('zhiju.quality.evidence_status_snapshot', U_EV, U_SNAP),
    reviewIssueSnapshot: {
      openBlockingIssueRefs: [],
      openNonBlockingIssueRefs: [],
      closedIssueRefs: [objectRef('zhiju.quality.review_issue', U_QI)],
      dismissedIssueRefs: [],
    },
    evaluatorVersions: [
      {
        evaluatorId: 'zhiju.quality.evaluator.revision_readiness',
        evaluatorVersion: '1.0.0',
      },
    ],
    readiness: { status: 'READY', reasons: ['all_mandatory_gates_passed'] },
    evaluatedAt: '2026-08-17T00:00:00Z',
  };
}

export function approvalBundlePositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.approval_bundle'),
    snapshotId: U_ABS,
    artifactRef: objectRef('zhiju.artifact.artifact', U_ART),
    revisionRef: contentRef('zhiju.artifact.artifact_revision', U_REV),
    revisionAcceptanceSnapshotRef: snapshotRef(
      'zhiju.quality.revision_acceptance_snapshot',
      U_ART,
      U_RAS,
    ),
    qualityProfileRef: versionedRef('zhiju.quality.quality_profile', U_QP, U_QP),
    approvalRequirements: [
      {
        requirementId: U_APR,
        requiredRole: 'quality.reviewer',
        requiredCount: 2,
        ordering: 'any',
        authorizationAssurance: 'workflow.approved',
        separationRules: 'must_not_contain_author_of_revision',
        effectivePeriod: {
          validFrom: '2026-08-01T00:00:00Z',
          validTo: '2026-09-01T00:00:00Z',
        },
      },
    ],
    approvalRefs: [contentRef('zhiju.quality.approval', U_APR)],
    separationOfDutiesResult: {
      outcome: 'SATISFIED',
      checkedAt: '2026-08-17T00:00:00Z',
    },
    authorizationSnapshotRefs: [snapshotRef('zhiju.identity.policy_snapshot', U_AUT, U_SNAP)],
    completeness: { status: 'FULLY_APPROVED', reasons: [] },
    evaluatedAt: '2026-08-17T00:00:00Z',
  };
}

export function releaseReadinessPositive(): Record<string, unknown> {
  return {
    header: baseHeader('zhiju.contract.release_readiness'),
    snapshotId: U_RRS,
    releaseRef: objectRef('zhiju.release.release', U_REL),
    artifactRef: objectRef('zhiju.artifact.artifact', U_ART),
    revisionRef: contentRef('zhiju.artifact.artifact_revision', U_REV),
    approvalBundleSnapshotRef: snapshotRef('zhiju.quality.approval_bundle_snapshot', U_ART, U_ABS),
    releasePackageRef: {
      releaseRef: objectRef('zhiju.release.release', U_REL),
      packageSnapshotRef: snapshotRef('zhiju.release.release_package', U_PKG, U_SNAP),
      packageHash: CONTENT_HASH,
    },
    purpose: 'CUSTOMER_DELIVERY',
    recipientScopeSnapshotRef: snapshotRef('zhiju.release.recipient_scope_snapshot', U_RCP, U_SNAP),
    destinationRefs: [
      {
        system: 'feishu',
        resourceType: 'chat',
        externalId: 'oc_release_destination',
        observedAt: '2026-08-17T00:00:00Z',
      },
    ],
    releaseRequirements: [
      {
        requirementId: U_RR,
        requirementType: 'profile_compliance',
        profileRef: versionedRef('zhiju.quality.quality_profile', U_QP, U_QP),
        satisfied: true,
      },
    ],
    requiredReleaseGateSpecs: [
      {
        objectType: 'zhiju.quality.gate_spec',
        gateSpecId: U_GATE,
        gateVersion: '1',
        qualityProfileVersionId: U_QPV,
        evaluationStage: 'RELEASE_READINESS',
      },
    ],
    releaseGateResultRefs: [contentRef('zhiju.quality.gate_result', U_GRES)],
    readiness: { status: 'READY_FOR_AUTHORIZATION', reasons: [] },
    evaluatedAt: '2026-08-17T00:00:00Z',
  };
}

// =============================================================================
// Positive fixtures are committed JSON review artifacts. Every builder is
// compared with its golden file so schema tests cannot pass while the files
// consumed by downstream implementers drift.
// =============================================================================

const POSITIVES: readonly [string, () => Record<string, unknown>][] = [
  ['project-context-valid', projectContextPositive],
  ['work-order-valid', workOrderPositive],
  ['agent-result-valid', agentResultPositive],
  ['revision-acceptance-valid', revisionAcceptancePositive],
  ['approval-bundle-valid', approvalBundlePositive],
  ['release-readiness-valid', releaseReadinessPositive],
];

const CONTRACT_TYPE_TO_SCHEMA_ID: Readonly<Record<string, string>> = {
  'zhiju.contract.project_context': 'https://schemas.zhiju.local/core/project-context/1.0',
  'zhiju.contract.work_order': 'https://schemas.zhiju.local/core/work-order/1.0',
  'zhiju.contract.agent_result': 'https://schemas.zhiju.local/core/agent-result/1.0',
  'zhiju.contract.revision_acceptance': 'https://schemas.zhiju.local/core/revision-acceptance/1.0',
  'zhiju.contract.approval_bundle': 'https://schemas.zhiju.local/core/approval-bundle/1.0',
  'zhiju.contract.release_readiness': 'https://schemas.zhiju.local/core/release-readiness/1.0',
};

function schemaIdFor(payload: Record<string, unknown>): string {
  const contractType = (payload.header as { contractType: string }).contractType;
  const id = CONTRACT_TYPE_TO_SCHEMA_ID[contractType];
  if (id === undefined) throw new Error(`unknown contract type ${contractType}`);
  return id;
}

function loadGoldenFixture(name: string): Record<string, unknown> {
  const fixtureUrl = new URL(`../../tests/fixtures/contracts/core/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Record<string, unknown>;
}

// =============================================================================
// Tests
// =============================================================================

describe('core contract schemas', () => {
  const registry = new ContractRegistry();

  it('registers all six Core Contracts', () => {
    expect(coreContractSchemas).toHaveLength(6);
    const ids = coreContractSchemas.map((s) => s.$id).sort();
    expect(ids).toEqual(
      [
        'https://schemas.zhiju.local/core/agent-result/1.0',
        'https://schemas.zhiju.local/core/approval-bundle/1.0',
        'https://schemas.zhiju.local/core/project-context/1.0',
        'https://schemas.zhiju.local/core/release-readiness/1.0',
        'https://schemas.zhiju.local/core/revision-acceptance/1.0',
        'https://schemas.zhiju.local/core/work-order/1.0',
      ].sort(),
    );
  });

  describe.each(POSITIVES)('%s', (_name, build) => {
    const positive = build();

    it('declares the fixture under a known contract type', () => {
      expect((positive.header as { contractType: string }).contractType).toMatch(
        /^zhiju\.contract\./,
      );
    });

    it('accepts the positive fixture', () => {
      const result = registry.validateCoreContract(schemaIdFor(positive), positive);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('matches the committed golden fixture', () => {
      expect(loadGoldenFixture(_name)).toEqual(positive);
    });

    it('rejects unknown top-level fields', () => {
      const mutated = { ...deepClone(positive), unknownTopLevel: 'must-not-be-allowed' };
      const result = registry.validateCoreContract(schemaIdFor(mutated), mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' &&
            e.params.additionalProperty === 'unknownTopLevel',
        ),
      ).toBe(true);
    });

    it('rejects missing required fields', () => {
      const mutated = deletePath(positive, 'header.correlationId');
      const result = registry.validateCoreContract(
        schemaIdFor(mutated as Record<string, unknown>),
        mutated,
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('projectContext nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/project-context/1.0';
    const positive = projectContextPositive();

    it('rejects an unknown nested field inside sourceManifest', () => {
      const mutated = setPath(positive, 'sourceManifest.unknownField', 'x');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' && e.params.additionalProperty === 'unknownField',
        ),
      ).toBe(true);
    });

    it('rejects an invalid projectionType enum', () => {
      const mutated = setPath(positive, 'projection.projectionType', 'NOT_A_PROJECTION');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects an invalid epistemicState enum inside a contextItem', () => {
      const mutated = setPath(positive, 'contextItems.0.epistemicState', 'GUESSED');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects a contextItem missing the REQUIRED `kind` field', () => {
      const mutated = deletePath(positive, 'contextItems.0.kind');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects a sourceManifest missing externalAuthoritySnapshotRefs', () => {
      const mutated = deletePath(positive, 'sourceManifest.externalAuthoritySnapshotRefs');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects a contextItem missing value', () => {
      const mutated = deletePath(positive, 'contextItems.0.value');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects PRESENT without value and non-PRESENT with value', () => {
      const missingPresentValue = deletePath(positive, 'contextItems.0.value.value');
      const leakedUnknownValue = setPath(positive, 'contextItems.0.value.presence', 'UNKNOWN');
      expect(registry.validateCoreContract(schemaId, missingPresentValue).valid).toBe(false);
      expect(registry.validateCoreContract(schemaId, leakedUnknownValue).valid).toBe(false);
    });
  });

  describe('workOrder nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/work-order/1.0';
    const positive = workOrderPositive();

    it('rejects an OBJECT reference inside baseContentRefs (must be content-addressed)', () => {
      const mutated = setArrayElement(
        positive,
        'targetScope.baseContentRefs',
        objectRef('zhiju.artifact.artifact_revision', U_REV),
      );
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });

    it('rejects an invalid referenceStrength enum in expectedOutputs', () => {
      const mutated = setPath(positive, 'expectedOutputs.0.requiredReferenceStrength', 'OBJECTISH');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects an unknown field inside allowedCapabilities[0]', () => {
      const mutated = setPath(
        positive,
        'allowedCapabilities.0.extraCapabilityField',
        'not allowed',
      );
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' &&
            e.params.additionalProperty === 'extraCapabilityField',
        ),
      ).toBe(true);
    });

    it('rejects a cardinality enum outside the closed set', () => {
      const mutated = setPath(positive, 'expectedOutputs.0.cardinality', 'WHATEVER');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects an objective missing either required reference set', () => {
      const missingIssues = deletePath(positive, 'objective.relatedIssueRefs');
      const missingDeliveries = deletePath(positive, 'objective.deliveryItemRefs');
      expect(registry.validateCoreContract(schemaId, missingIssues).valid).toBe(false);
      expect(registry.validateCoreContract(schemaId, missingDeliveries).valid).toBe(false);
    });

    it('rejects an empty NonEmptySet', () => {
      const mutated = setPath(positive, 'expectedOutputs', []);
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'minItems')).toBe(true);
    });
  });

  describe('agentResult nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/agent-result/1.0';
    const positive = agentResultPositive();

    it('rejects submissionKind other than FINAL', () => {
      const mutated = setPath(positive, 'submissionKind', 'STREAMING');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });

    it('rejects an unknown finding field', () => {
      const mutated = setPath(positive, 'findings.0.phantomField', true);
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' && e.params.additionalProperty === 'phantomField',
        ),
      ).toBe(true);
    });

    it('rejects an invalid executionOutcome', () => {
      const mutated = setPath(positive, 'executionOutcome', 'SUCCEEDED_WHATEVER');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });
  });

  describe('revisionAcceptance nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/revision-acceptance/1.0';
    const positive = revisionAcceptancePositive();

    it('rejects an evaluationStage other than REVISION_ACCEPTANCE', () => {
      const mutated = setPath(positive, 'evaluationStage', 'RELEASE_READINESS');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });

    it('rejects an unknown nested field inside reviewIssueSnapshot', () => {
      const mutated = setPath(positive, 'reviewIssueSnapshot.phantomField', 'nope');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' && e.params.additionalProperty === 'phantomField',
        ),
      ).toBe(true);
    });

    it('rejects an invalid readiness status', () => {
      const mutated = setPath(positive, 'readiness.status', 'MAYBE');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects an OBJECT GateResult reference', () => {
      const mutated = setArrayElement(
        positive,
        'gateResultRefs',
        objectRef('zhiju.quality.gate_result', U_GRES),
      );
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });

    it('rejects a ContentAddressed GateResult missing contentHash', () => {
      const mutated = deletePath(positive, 'gateResultRefs.0.contentHash');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });
  });

  describe('approvalBundle nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/approval-bundle/1.0';
    const positive = approvalBundlePositive();

    it('rejects an unknown field inside approvalRequirements[0]', () => {
      const mutated = setPath(positive, 'approvalRequirements.0.phantomField', 'no');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' && e.params.additionalProperty === 'phantomField',
        ),
      ).toBe(true);
    });

    it('rejects an OBJECT reference inside approvalRefs (must be content-addressed)', () => {
      const mutated = setArrayElement(
        positive,
        'approvalRefs',
        objectRef('zhiju.quality.approval', U_APR),
      );
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });

    it('rejects an invalid separationOfDuties outcome', () => {
      const mutated = setPath(positive, 'separationOfDutiesResult.outcome', 'PARTIAL');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });
  });

  describe('releaseReadiness nested rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/release-readiness/1.0';
    const positive = releaseReadinessPositive();

    it('rejects an unknown releasePackageRef shape (object instead of typed ref)', () => {
      const mutated = setPath(positive, 'releasePackageRef', { random: 'value' });
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects an unknown nested field in releaseRequirements', () => {
      const mutated = setPath(positive, 'releaseRequirements.0.phantomField', 'no');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.keyword === 'additionalProperties' && e.params.additionalProperty === 'phantomField',
        ),
      ).toBe(true);
    });

    it('rejects an invalid release readiness status', () => {
      const mutated = setPath(positive, 'readiness.status', 'GOGOGO');
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'enum')).toBe(true);
    });

    it('rejects an empty destination NonEmptySet', () => {
      const mutated = setPath(positive, 'destinationRefs', []);
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'minItems')).toBe(true);
    });

    it('rejects an OBJECT release GateResult reference', () => {
      const mutated = setArrayElement(
        positive,
        'releaseGateResultRefs',
        objectRef('zhiju.quality.gate_result', U_GRES),
      );
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'const')).toBe(true);
    });
  });

  describe('shared ContractHeader rejections', () => {
    const schemaId = 'https://schemas.zhiju.local/core/project-context/1.0';
    const positive = projectContextPositive();

    it('accepts a required extension with an arbitrary CanonicalJson payload', () => {
      const mutated = setPath(positive, 'header.extensions', [
        {
          extensionType: 'zhiju.contract.trace',
          extensionVersion: '1.0',
          required: true,
          payload: { traceFlags: ['review', 11], nested: { enabled: true } },
        },
      ]);
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('requires extension payload even though its CanonicalJson value is open', () => {
      const mutated = setPath(positive, 'header.extensions', [
        {
          extensionType: 'zhiju.contract.trace',
          extensionVersion: '1.0',
          required: false,
        },
      ]);
      const result = registry.validateCoreContract(schemaId, mutated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects ObjectRef for schemaRef and issuedBy', () => {
      const objectSchemaRef = setPath(
        positive,
        'header.schemaRef',
        objectRef('zhiju.contract.schema', U_CTX),
      );
      const objectIssuer = setPath(
        positive,
        'header.issuedBy',
        objectRef('zhiju.identity.principal', U_HUM),
      );
      expect(registry.validateCoreContract(schemaId, objectSchemaRef).valid).toBe(false);
      expect(registry.validateCoreContract(schemaId, objectIssuer).valid).toBe(false);
    });
  });
});
