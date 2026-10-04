import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
import type { PublicOperationDefinition } from './schema-types.js';
import { artifactOperationContracts } from './operations/artifact.schema.js';
import { enterpriseProjectOperationContracts } from './operations/enterprise-project.schema.js';
import { identityPolicyOperationContracts } from './operations/identity-policy.schema.js';
import { integrationGatewayOperationContracts } from './operations/integration-gateway.schema.js';
import { qualityGovernanceOperationContracts } from './operations/quality-governance.schema.js';
import { releasePublicationOperationContracts } from './operations/release-publication.schema.js';
import { taskExecutionOperationContracts } from './operations/task-execution.schema.js';
import { ContractRegistry, getContractRegistry } from './registry.js';

const uuid = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const digest = '0'.repeat(64);
const scope = { enterpriseId: uuid };
const reference = { kind: 'OBJECT', objectType: 'identity.principal', objectId: uuid, scope };

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../tests/fixtures/contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

function validCommand(): Record<string, unknown> {
  return {
    commandId: uuid,
    commandType: 'identity.register_principal',
    commandVersion: '1.0',
    scopeRef: scope,
    targetRef: reference,
    actor: reference,
    authorizationDecisionRef: reference,
    idempotencyKey: 'fixture-001',
    correlationId: uuid,
    requestedAt: '2026-08-17T00:00:00Z',
    payload: { principalKind: 'HUMAN', displayName: 'Fixture Human', initialStatus: 'ACTIVE' },
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
    },
  };
}

function validTaskExecutionWorkOrderDraft(): {
  readonly command: Record<string, unknown>;
  readonly runCommand: Record<string, unknown>;
  readonly draft: Record<string, unknown>;
  readonly workOrderContract: Record<string, unknown>;
} {
  const command = fixture('execution-create-task-command-valid.json');
  const runCommand = fixture('execution-create-run-command-valid.json');
  const workOrderContract = fixture('core/work-order-valid.json');
  const draft = { ...workOrderContract };
  delete draft.header;
  delete draft.workOrderRef;
  delete draft.projectRef;
  delete draft.contextSnapshotRef;
  delete draft.issuedAt;
  delete draft.expiresAt;
  delete draft.specificationHash;
  return { command, runCommand, draft, workOrderContract };
}

describe('contract registry', () => {
  const registry = new ContractRegistry();

  it('shares static validators without retaining another caller validation errors', () => {
    const first = getContractRegistry();
    const second = getContractRegistry();
    expect(second).toBe(first);
    expect(first).not.toBe(registry);
    const invalid = first.validateOperation('identity.register_principal', '1.0', {});
    expect(invalid.valid).toBe(false);
    const savedErrors = structuredClone(invalid.errors);
    expect(second.validateOperation('identity.register_principal', '1.0', validCommand())).toEqual({
      valid: true,
      errors: [],
    });
    second.validateOperation('identity.register_principal', '1.0', { payload: null });
    expect(invalid.errors).toEqual(savedErrors);
    expect(first.operationCount).toBe(registry.operationCount);
  });

  it('registers exactly the current 239 public operations', () => {
    expect(registry.operationCount).toBe(239);
  });

  it('exposes implemented module operations as matching FULL schemas', () => {
    const operations = publicApiOperations as readonly PublicOperationDefinition[];
    const full = operations.filter((operation) => operation.schemaStatus === 'FULL');
    const identity = full.filter((operation) => operation.owner === 'identity-policy');
    const project = full.filter((operation) => operation.owner === 'enterprise-project');
    const execution = full.filter((operation) => operation.owner === 'task-execution');
    const artifact = full.filter((operation) => operation.owner === 'artifact');
    const quality = full.filter((operation) => operation.owner === 'quality-governance');
    const release = full.filter((operation) => operation.owner === 'release-publication');
    const integration = full.filter((operation) => operation.owner === 'integration-gateway');

    expect(full).toHaveLength(239);
    expect(identity).toHaveLength(23);
    expect(project).toHaveLength(36);
    expect(execution).toHaveLength(63);
    expect(artifact).toHaveLength(28);
    expect(quality).toHaveLength(38);
    expect(release).toHaveLength(25);
    expect(integration).toHaveLength(26);
    expect(Object.keys(identityPolicyOperationContracts).sort()).toEqual(
      identity.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(enterpriseProjectOperationContracts).sort()).toEqual(
      [...new Set(project.map((operation) => operation.type))].sort(),
    );
    expect(Object.keys(taskExecutionOperationContracts).sort()).toEqual(
      execution
        .map((operation) =>
          operation.version === '1.0' ? operation.type : `${operation.type}@${operation.version}`,
        )
        .sort(),
    );
    expect(Object.keys(artifactOperationContracts).sort()).toEqual(
      artifact.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(qualityGovernanceOperationContracts).sort()).toEqual(
      quality.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(releasePublicationOperationContracts).sort()).toEqual(
      release.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(integrationGatewayOperationContracts).sort()).toEqual(
      integration.map((operation) => operation.type).sort(),
    );
  });

  it('exposes the approved QualityGovernance operation kind distribution', () => {
    const quality = publicApiOperations.filter(
      (operation) => operation.owner === 'quality-governance',
    );
    const kinds = quality.map((operation) => operation.kind);

    expect(kinds.filter((kind) => kind === 'COMMAND')).toHaveLength(18);
    expect(kinds.filter((kind) => kind === 'QUERY')).toHaveLength(9);
    expect(kinds.filter((kind) => kind === 'EVENT')).toHaveLength(11);
    expect(
      quality
        .filter((operation) => operation.kind === 'QUERY')
        .every(
          (operation) =>
            qualityGovernanceOperationContracts[operation.type]?.resultSchemaRef !== undefined,
        ),
    ).toBe(true);
  });

  it('validates a registered command envelope', () => {
    expect(
      registry.validateOperation('identity.register_principal', '1.0', validCommand()),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects unknown envelope fields', () => {
    const input = { ...validCommand(), unexpected: true };
    const result = registry.validateOperation('identity.register_principal', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects unknown IdentityPolicy payload fields', () => {
    const input = validCommand();
    input.payload = { ...(input.payload as Record<string, unknown>), unexpected: true };
    const result = registry.validateOperation('identity.register_principal', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload')).toBe(true);
  });

  it('validates a field-level IdentityPolicy query and its result data', () => {
    const query = fixture('identity-resolve-principal-query-valid.json');
    const resultData = fixture('identity-principal-resolution-result-valid.json');

    expect(registry.validateOperation('identity.resolve_principal', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('identity.resolve_principal', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown fields in IdentityPolicy query result data', () => {
    const resultData = {
      ...fixture('identity-principal-resolution-result-valid.json'),
      rawExternalIdentity: 'must-not-leak',
    };
    const result = registry.validateOperationResult(
      'identity.resolve_principal',
      '1.0',
      resultData,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects sensitive external identity values in public events', () => {
    const event = fixture('identity-external-linked-event-sensitive-field.json');
    const result = registry.validateOperation('identity.ExternalIdentityLinked', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload')).toBe(true);
  });

  it('validates a field-level EnterpriseProject board query and result page', () => {
    const query = fixture('project-board-query-valid.json');
    const resultData = fixture('project-board-result-valid.json');

    expect(registry.validateOperation('project.get_project_board_slice', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('project.get_project_board_slice', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown nested fields in EnterpriseProject result items', () => {
    const resultData = fixture('project-board-result-valid.json');
    const items = resultData.items as Record<string, unknown>[];
    items[0] = { ...items[0], customerDocumentText: 'must-not-leak' };

    const result = registry.validateOperationResult(
      'project.get_project_board_slice',
      '1.0',
      resultData,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/items/0')).toBe(true);
  });

  it('rejects customer document content in EnterpriseProject public events', () => {
    const event = fixture('project-customer-material-event-sensitive-field.json');
    const result = registry.validateOperation('project.CustomerMaterialConfirmed', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload')).toBe(true);
  });

  it('exposes CustomerBaseline status and reference shapes for runtime semantic validation', () => {
    const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
    const versioned = (objectId: string, versionId: string) => ({
      kind: 'VERSIONED',
      objectType: 'customer.material',
      objectId,
      versionId,
      scope: { enterpriseId: uuid, projectId },
    });
    const decision = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'business.decision',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d306',
      scope: { enterpriseId: uuid, projectId },
      contentHash: {
        algorithm: 'SHA-256',
        digest: '1'.repeat(64),
        canonicalizationVersion: '1',
      },
    };
    const justification = {
      reasonCode: 'BASELINE_REVIEW',
      summary: 'The exact CustomerBaseline state was reviewed.',
      evidenceRefs: [],
    };
    const baseExpectation = {
      expectationId: '018f22e2-7c15-7b2e-8d86-2de956a9d307',
      expectedMaterialKey: 'training.procedure',
      materialType: 'quality.procedure',
      expectedTitleOrRole: 'Training procedure',
      reason: justification,
    };
    const command = (expectation: Record<string, unknown>) => ({
      ...validCommand(),
      commandType: 'project.create_customer_baseline_draft',
      payload: {
        projectRef: {
          kind: 'OBJECT',
          objectType: 'project',
          objectId: projectId,
          scope: { enterpriseId: uuid, projectId },
        },
        expectations: [expectation],
        baselinePolicyRef: {
          kind: 'VERSIONED',
          objectType: 'policy',
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d308',
          versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d309',
          scope: { enterpriseId: uuid, projectId },
        },
      },
    });

    for (const expectation of [
      {
        ...baseExpectation,
        status: 'PRESENT',
        customerMaterialRefs: [
          versioned('018f22e2-7c15-7b2e-8d86-2de956a9d310', '018f22e2-7c15-7b2e-8d86-2de956a9d311'),
        ],
      },
      { ...baseExpectation, status: 'UNKNOWN', customerMaterialRefs: [] },
      { ...baseExpectation, status: 'NOT_PROVIDED', customerMaterialRefs: [] },
      {
        ...baseExpectation,
        status: 'MISSING_CONFIRMED',
        customerMaterialRefs: [],
        decisionRef: decision,
      },
    ]) {
      expect(
        registry.validateOperation(
          'project.create_customer_baseline_draft',
          '1.0',
          command(expectation),
        ),
      ).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it('accepts the minimal CustomerBaseline activation event and rejects customer text', () => {
    const event = fixture('project-customer-material-event-sensitive-field.json');
    const projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
    const baselineRef = {
      kind: 'VERSIONED',
      objectType: 'customer.baseline',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d312',
      versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d316',
      scope: { enterpriseId: uuid, projectId },
    };
    const activation = {
      ...event,
      eventType: 'project.CustomerBaselineVersionActivated',
      aggregateType: 'project.customer_baseline',
      payload: {
        customerBaselineRef: baselineRef,
        previousActiveRef: {
          ...baselineRef,
          versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d317',
        },
        projectRef: {
          kind: 'OBJECT',
          objectType: 'project',
          objectId: projectId,
          scope: { enterpriseId: uuid, projectId },
        },
        impactPolicyRef: {
          kind: 'VERSIONED',
          objectType: 'policy',
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d318',
          versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d319',
          scope: { enterpriseId: uuid, projectId },
        },
      },
    };
    expect(
      registry.validateOperation('project.CustomerBaselineVersionActivated', '1.0', activation),
    ).toEqual({
      valid: true,
      errors: [],
    });

    const leaked = structuredClone(activation) as Record<string, unknown>;
    (leaked.payload as Record<string, unknown>).customerDocumentText = 'must-not-appear';
    expect(
      registry.validateOperation('project.CustomerBaselineVersionActivated', '1.0', leaked).valid,
    ).toBe(false);
  });

  it('rejects unknown EnterpriseProject command payload fields', () => {
    const input = {
      ...validCommand(),
      commandType: 'project.create_enterprise',
      payload: {
        displayCode: 'ENT-001',
        displayName: 'Fixture Enterprise',
        initialStatus: 'ACTIVE',
        unknownLifecycleShortcut: true,
      },
    };
    const result = registry.validateOperation('project.create_enterprise', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload')).toBe(true);
  });

  it('validates a field-level Artifact revision seal command', () => {
    const input = fixture('artifact-seal-revision-command-valid.json');
    expect(registry.validateOperation('artifact.create_and_seal_revision', '1.0', input)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects parent counts that do not match the Artifact revision command', () => {
    const ordinary = fixture('artifact-seal-revision-command-valid.json');
    const ordinaryRevision = (ordinary.payload as Record<string, unknown>).revision as {
      parentRevisionRefs: Record<string, unknown>[];
    };
    const secondParent = structuredClone(ordinaryRevision.parentRevisionRefs[0] ?? {});
    secondParent.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d414';
    ordinaryRevision.parentRevisionRefs.push(secondParent);

    const ordinaryResult = registry.validateOperation(
      'artifact.create_and_seal_revision',
      '1.0',
      ordinary,
    );
    expect(ordinaryResult.valid).toBe(false);
    expect(ordinaryResult.errors.some((error) => error.keyword === 'maxItems')).toBe(true);

    const merge = fixture('artifact-seal-revision-command-valid.json');
    const mergeRevision = (merge.payload as Record<string, unknown>).revision;
    merge.commandType = 'artifact.create_merge_revision';
    merge.payload = {
      merge: {
        revision: mergeRevision,
        mergeStrategy: 'manual',
        conflictSet: [],
        conflictResolutionRefs: [],
        resolvedBy: merge.actor,
      },
    };

    const mergeResult = registry.validateOperation('artifact.create_merge_revision', '1.0', merge);
    expect(mergeResult.valid).toBe(false);
    expect(mergeResult.errors.some((error) => error.keyword === 'minItems')).toBe(true);
  });

  it('rejects unresolved Artifact merge conflicts', () => {
    const input = fixture('artifact-seal-revision-command-valid.json');
    const revision = (input.payload as Record<string, unknown>).revision as {
      parentRevisionRefs: Record<string, unknown>[];
    };
    const secondParent = structuredClone(revision.parentRevisionRefs[0] ?? {});
    secondParent.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d414';
    revision.parentRevisionRefs.push(secondParent);
    input.commandType = 'artifact.create_merge_revision';
    input.payload = {
      merge: {
        revision,
        mergeStrategy: 'manual',
        conflictSet: [{ locator: 'section.4.2' }],
        conflictResolutionRefs: [],
        resolvedBy: input.actor,
      },
    };

    const result = registry.validateOperation('artifact.create_merge_revision', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'minItems')).toBe(true);
  });

  it('rejects file bytes and temporary render paths in Artifact commands', () => {
    const input = fixture('artifact-seal-revision-command-content-leak.json');
    const result = registry.validateOperation('artifact.create_and_seal_revision', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
    expect(
      result.errors.some((error) => error.instancePath === '/payload/revision/contentRef'),
    ).toBe(true);
  });

  it('validates an exact Artifact revision query and its snapshot result', () => {
    const query = fixture('artifact-revision-snapshot-query-valid.json');
    const resultData = fixture('artifact-revision-snapshot-result-valid.json');

    expect(registry.validateOperation('artifact.get_revision_snapshot', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('artifact.get_revision_snapshot', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects latest-style references instead of exact Artifact revision references', () => {
    const query = fixture('artifact-revision-snapshot-query-weak-ref.json');
    const result = registry.validateOperation('artifact.get_revision_snapshot', '1.0', query);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.instancePath.startsWith('/payload/revisionRef')),
    ).toBe(true);
  });

  it('rejects malformed Artifact content hashes', () => {
    const query = fixture('artifact-revision-snapshot-query-valid.json');
    const payload = query.payload as { revisionRef: Record<string, unknown> };
    payload.revisionRef = {
      ...payload.revisionRef,
      contentHash: { ...(payload.revisionRef.contentHash as object), digest: 'latest' },
    };

    const result = registry.validateOperation('artifact.get_revision_snapshot', '1.0', query);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'pattern')).toBe(true);
  });

  it('validates a registered Artifact representation event', () => {
    const event = fixture('artifact-representation-registered-event-valid.json');
    expect(registry.validateOperation('artifact.RepresentationRegistered', '1.0', event)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects public download URLs in Artifact representation events', () => {
    const event = fixture('artifact-representation-registered-event-public-url.json');
    const result = registry.validateOperation('artifact.RepresentationRegistered', '1.0', event);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.instancePath === '/payload/representationRef/objectStorageRef',
      ),
    ).toBe(true);
  });

  it('validates an Artifact effective binding query and its as-of view', () => {
    const query = fixture('artifact-effective-binding-query-valid.json');
    const resultData = fixture('artifact-effective-binding-result-valid.json');

    expect(registry.validateOperation('artifact.get_effective_binding', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('artifact.get_effective_binding', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown fields in Artifact effective binding result data', () => {
    const resultData = {
      ...fixture('artifact-effective-binding-result-valid.json'),
      approvedDocumentBody: 'must-not-leak',
    };
    const result = registry.validateOperationResult(
      'artifact.get_effective_binding',
      '1.0',
      resultData,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects operation result validation for unknown operation types', () => {
    const result = registry.validateOperationResult('integration.not_a_real_query', '1.0', {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('operationRegistry');
  });

  it('rejects an unknown major version', () => {
    const result = registry.validateOperation('identity.register_principal', '2.0', validCommand());
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('operationRegistry');
  });

  it('rejects a type that does not match the selected schema', () => {
    const input = { ...validCommand(), commandType: 'identity.assign_role' };
    const result = registry.validateOperation('identity.register_principal', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'const')).toBe(true);
  });

  it('validates a field-level TaskExecution create_task command', () => {
    const command = fixture('execution-create-task-command-valid.json');
    expect(registry.validateOperation('execution.create_task', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates a field-level TaskExecution create_run command with lease/fencing fields', () => {
    const command = fixture('execution-create-run-command-valid.json');
    expect(registry.validateOperation('execution.create_run', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects unknown TaskExecution command payload fields', () => {
    const input = fixture('execution-create-task-command-unknown-field.json');
    const result = registry.validateOperation('execution.create_task', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload/definition')).toBe(true);
  });

  it('rejects negative fencing tokens in start_run command', () => {
    const input = fixture('execution-start-run-command-illegal-lease.json');
    const result = registry.validateOperation('execution.start_run', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload/fencingToken')).toBe(
      true,
    );
  });

  it('rejects weak reference strength in accept_agent_result command', () => {
    const input = fixture('execution-accept-agent-result-command-wrong-ref-strength.json');
    const result = registry.validateOperation('execution.accept_agent_result', '1.0', input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload/agentResultRef')).toBe(
      true,
    );
  });

  it('validates a field-level TaskExecution get_run_state query and result', () => {
    const query = fixture('execution-get-run-state-query-valid.json');
    const resultData = fixture('execution-get-run-state-result-valid.json');

    expect(registry.validateOperation('execution.get_run_state', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateOperationResult('execution.get_run_state', '1.0', resultData)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('accepts an UNKNOWN usage envelope in the usage and provenance result', () => {
    const resultData = fixture('execution-get-usage-and-provenance-result-valid.json');
    expect(
      registry.validateOperationResult('execution.get_usage_and_provenance', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown nested fields in TaskExecution result data', () => {
    const resultData = fixture('execution-get-run-state-result-unknown-nested-field.json');
    const result = registry.validateOperationResult('execution.get_run_state', '1.0', resultData);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/runtimeBinding')).toBe(true);
  });

  it('validates a field-level TaskExecution RunTerminated event', () => {
    const event = fixture('execution-run-terminated-event-valid.json');
    expect(registry.validateOperation('execution.RunTerminated', '1.0', event)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects illegal run status values in TaskExecution events', () => {
    const event = fixture('execution-run-terminated-event-illegal-status.json');
    const result = registry.validateOperation('execution.RunTerminated', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload/terminalStatus')).toBe(
      true,
    );
  });

  it('rejects lease/session/secret runtime fields in public TaskExecution events', () => {
    const event = fixture('execution-run-started-event-sensitive-runtime-field.json');
    const result = registry.validateOperation('execution.RunStarted', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/payload')).toBe(true);
  });

  it('still rejects the legacy ENVELOPE_ONLY module behavior for runtime additive operations', () => {
    const full = publicApiOperations.filter((operation) => operation.owner === 'task-execution');
    const additive = ['execution.record_runtime_input_required', 'execution.request_run_cancel'];
    for (const type of additive) {
      const operation = full.find((entry) => entry.type === type);
      expect(operation?.schemaStatus).toBe('FULL');
    }
    expect(full).toHaveLength(63);
  });

  it('validates embedded TaskExecution Core Contracts through their registered schemas', () => {
    const { command, runCommand, workOrderContract } = validTaskExecutionWorkOrderDraft();
    const contextSnapshotRef = (
      (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
    ).contextSnapshotRef;
    const hash = (command.integrity as Record<string, unknown>).payloadHash;
    const freezeCommand = {
      ...command,
      commandType: 'execution.freeze_work_order',
      payload: {
        workOrderContract,
        validationSnapshotRef: contextSnapshotRef,
        specificationHash: hash,
      },
    };

    expect(registry.validateOperation('execution.freeze_work_order', '1.0', freezeCommand)).toEqual(
      {
        valid: true,
        errors: [],
      },
    );

    const invalidFreeze = {
      ...freezeCommand,
      payload: { ...freezeCommand.payload, workOrderContract: 'not-a-contract' },
    };
    expect(
      registry.validateOperation('execution.freeze_work_order', '1.0', invalidFreeze).valid,
    ).toBe(false);

    const invalidSubmit = {
      ...command,
      commandType: 'execution.submit_agent_result',
      payload: {
        agentResultContract: {},
        runFencingToken: 0,
        runtimeSubmissionRef: {
          system: 'runtime.test',
          resourceType: 'runtime.submission',
          externalId: 'submission-1',
          observedAt: '2026-08-17T00:00:00Z',
        },
      },
    };
    expect(
      registry.validateOperation('execution.submit_agent_result', '1.0', invalidSubmit).valid,
    ).toBe(false);
    expect(
      registry.validateOperationResult('execution.get_work_order_contract', '1.0', {
        workOrderRef: command.targetRef,
        workOrderContract: {},
        contractRef: (
          (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
        ).workOrderContractRef,
      }).valid,
    ).toBe(false);
    expect(
      registry.validateOperationResult('execution.get_context_snapshot', '1.0', {
        contextSnapshotRef,
        projectContextContract: {},
        contractRef: (
          (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
        ).workOrderContractRef,
      }).valid,
    ).toBe(false);
    expect(
      registry.validateOperationResult('execution.get_agent_result', '1.0', {
        agentResultRef: (
          (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
        ).workOrderContractRef,
        agentResultContract: {},
        acceptanceRecordRef: (
          (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
        ).workOrderContractRef,
      }).valid,
    ).toBe(false);
  });

  it('uses the authoritative WorkOrder field names in create_work_order', () => {
    const { command, draft } = validTaskExecutionWorkOrderDraft();
    const createWorkOrder = {
      ...command,
      commandType: 'execution.create_work_order',
      payload: { draft },
    };

    expect(
      registry.validateOperation('execution.create_work_order', '1.0', createWorkOrder),
    ).toEqual({
      valid: true,
      errors: [],
    });

    const obsoleteObjective = {
      ...createWorkOrder,
      payload: { draft: { ...draft, objective: { summary: 'obsolete shorthand' } } },
    };
    expect(
      registry.validateOperation('execution.create_work_order', '1.0', obsoleteObjective).valid,
    ).toBe(false);
  });

  it('validates CompletionEvaluationInput source watermarks instead of references', () => {
    const command = fixture('execution-create-task-command-valid.json');
    const runCommand = fixture('execution-create-run-command-valid.json');
    const creation = (runCommand.payload as Record<string, unknown>).creation as Record<
      string,
      unknown
    >;
    const completionCommand = {
      ...command,
      commandType: 'execution.evaluate_task_completion',
      payload: {
        input: {
          criteriaHash: (command.integrity as Record<string, unknown>).payloadHash,
          factRefs: [command.targetRef],
          blockingRefs: [],
          sourceWatermarks: [
            {
              sourceModule: 'enterprise_project',
              partition: 'project-1',
              sequence: 3,
              observedAt: '2026-08-17T00:00:00Z',
            },
          ],
          evaluatorRef: creation.leasePolicyRef,
          evaluatedAt: '2026-08-17T00:00:00Z',
        },
      },
    };

    expect(
      registry.validateOperation('execution.evaluate_task_completion', '1.0', completionCommand),
    ).toEqual({ valid: true, errors: [] });

    const referenceWatermark = structuredClone(completionCommand) as Record<string, unknown>;
    (((referenceWatermark.payload as Record<string, unknown>).input as Record<string, unknown>)
      .sourceWatermarks as unknown[]) = [command.targetRef];
    expect(
      registry.validateOperation('execution.evaluate_task_completion', '1.0', referenceWatermark)
        .valid,
    ).toBe(false);
  });

  it('requires Task Board result snapshot and source watermark metadata', () => {
    const completePage = {
      items: [],
      snapshotAt: '2026-08-17T00:00:00Z',
      sourceWatermarks: [
        { sourceModule: 'task_execution', sequence: 1, observedAt: '2026-08-17T00:00:00Z' },
      ],
    };

    expect(
      registry.validateOperationResult('execution.get_task_board_slice', '1.0', completePage),
    ).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult('execution.get_task_board_slice', '1.0', { items: [] })
        .valid,
    ).toBe(false);
  });

  it('enforces ValueEnvelope presence and value invariants for usage', () => {
    const unknownUsage = fixture('execution-get-usage-and-provenance-result-valid.json');
    expect(
      registry.validateOperationResult('execution.get_usage_and_provenance', '1.0', unknownUsage),
    ).toEqual({ valid: true, errors: [] });

    const unknownWithValue = structuredClone(unknownUsage);
    (unknownWithValue.agentDeclaredUsage as Record<string, unknown>).value = { inputTokens: 1 };
    expect(
      registry.validateOperationResult(
        'execution.get_usage_and_provenance',
        '1.0',
        unknownWithValue,
      ).valid,
    ).toBe(false);

    const presentWithoutValue = structuredClone(unknownUsage);
    (presentWithoutValue.agentDeclaredUsage as Record<string, unknown>).presence = 'PRESENT';
    expect(
      registry.validateOperationResult(
        'execution.get_usage_and_provenance',
        '1.0',
        presentWithoutValue,
      ).valid,
    ).toBe(false);

    const presentWithValue = structuredClone(presentWithoutValue);
    (presentWithValue.agentDeclaredUsage as Record<string, unknown>).value = { inputTokens: 1 };
    expect(
      registry.validateOperationResult(
        'execution.get_usage_and_provenance',
        '1.0',
        presentWithValue,
      ),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects sensitive fields nested in RunStarted runtime binding summaries', () => {
    const event = fixture('execution-run-started-event-sensitive-runtime-field.json');
    const payload = event.payload as Record<string, unknown>;
    delete payload.leaseId;
    delete payload.sessionToken;
    const runCommand = fixture('execution-create-run-command-valid.json');
    payload.runtimeBindingSummary = (
      (runCommand.payload as Record<string, unknown>).creation as Record<string, unknown>
    ).runtimeBinding;

    expect(registry.validateOperation('execution.RunStarted', '1.0', event)).toEqual({
      valid: true,
      errors: [],
    });

    const sensitiveEvent = structuredClone(event);
    (
      (sensitiveEvent.payload as Record<string, unknown>).runtimeBindingSummary as Record<
        string,
        unknown
      >
    ).sessionToken = 'must-not-leak';
    expect(registry.validateOperation('execution.RunStarted', '1.0', sensitiveEvent).valid).toBe(
      false,
    );
  });

  it('rejects non-terminal states in RunTerminated events', () => {
    const event = fixture('execution-run-terminated-event-valid.json');
    const runningEvent = structuredClone(event);
    (runningEvent.payload as Record<string, unknown>).terminalStatus = 'RUNNING';

    expect(registry.validateOperation('execution.RunTerminated', '1.0', event)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateOperation('execution.RunTerminated', '1.0', runningEvent).valid).toBe(
      false,
    );
  });

  it('accepts create_task without the optional delivery item reference', () => {
    const command = fixture('execution-create-task-command-valid.json');
    delete ((command.payload as Record<string, unknown>).definition as Record<string, unknown>)
      .deliveryItemRef;

    expect(registry.validateOperation('execution.create_task', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });
});
