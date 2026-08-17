import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
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

  it('exposes exactly the 20 IdentityPolicy operations as FULL schemas', () => {
    const full = publicApiOperations.filter((operation) => operation.schemaStatus === 'FULL');
    expect(full).toHaveLength(20);
    expect(new Set(full.map((operation) => operation.owner))).toEqual(new Set(['identity-policy']));
    expect(Object.keys(identityPolicyOperationContracts).sort()).toEqual(
      full.map((operation) => operation.type).sort(),
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

  it('does not claim executable result schemas for unfinished modules', () => {
    const result = registry.validateOperationResult(
      'project.get_enterprise_profile_snapshot',
      '1.0',
      {},
    );
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
