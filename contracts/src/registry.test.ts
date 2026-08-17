import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
import { artifactOperationContracts } from './operations/artifact.schema.js';
import { enterpriseProjectOperationContracts } from './operations/enterprise-project.schema.js';
import { identityPolicyOperationContracts } from './operations/identity-policy.schema.js';
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
    const artifact = full.filter((operation) => operation.owner === 'artifact');

    expect(full).toHaveLength(78);
    expect(identity).toHaveLength(20);
    expect(project).toHaveLength(32);
    expect(artifact).toHaveLength(26);
    expect(Object.keys(identityPolicyOperationContracts).sort()).toEqual(
      identity.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(enterpriseProjectOperationContracts).sort()).toEqual(
      project.map((operation) => operation.type).sort(),
    );
    expect(Object.keys(artifactOperationContracts).sort()).toEqual(
      artifact.map((operation) => operation.type).sort(),
    );
  });

  it('exposes the approved Artifact operation kind distribution', () => {
    const artifact = publicApiOperations.filter((operation) => operation.owner === 'artifact');
    const kinds = artifact.map((operation) => operation.kind);

    expect(kinds.filter((kind) => kind === 'COMMAND')).toHaveLength(12);
    expect(kinds.filter((kind) => kind === 'QUERY')).toHaveLength(7);
    expect(kinds.filter((kind) => kind === 'EVENT')).toHaveLength(7);
    expect(
      artifact
        .filter((operation) => operation.kind === 'QUERY')
        .every(
          (operation) => artifactOperationContracts[operation.type]?.resultSchemaRef !== undefined,
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

  it('does not claim executable result schemas for unfinished modules', () => {
    const result = registry.validateOperationResult('execution.get_run_state', '1.0', {});
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
});
