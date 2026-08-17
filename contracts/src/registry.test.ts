import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
import { enterpriseProjectOperationContracts } from './operations/enterprise-project.schema.js';
import { identityPolicyOperationContracts } from './operations/identity-policy.schema.js';
import { taskExecutionOperationContracts } from './operations/task-execution.schema.js';
import { ContractRegistry } from './registry.js';

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

describe('contract registry', () => {
  const registry = new ContractRegistry();

  it('registers exactly the approved 200 public operations', () => {
    expect(registry.operationCount).toBe(200);
  });

  it('exposes implemented module operations as matching FULL schemas', () => {
    const full = publicApiOperations.filter((operation) => operation.schemaStatus === 'FULL');
    const identity = full.filter((operation) => operation.owner === 'identity-policy');
    const project = full.filter((operation) => operation.owner === 'enterprise-project');
    const execution = full.filter((operation) => operation.owner === 'task-execution');

    expect(full).toHaveLength(89);
    expect(identity).toHaveLength(20);
    expect(project).toHaveLength(32);
    expect(execution).toHaveLength(37);
    expect(Object.keys(identityPolicyOperationContracts).sort()).toEqual(
      identity.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(enterpriseProjectOperationContracts).sort()).toEqual(
      project.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(taskExecutionOperationContracts).sort()).toEqual(
      execution.map((operation) => operation.type).sort(),
    );
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

  it('does not claim executable result schemas for unfinished modules', () => {
    const result = registry.validateOperationResult('artifact.get_artifact', '1.0', {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('operationResultRegistry');
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
    expect(full).toHaveLength(37);
  });
});
