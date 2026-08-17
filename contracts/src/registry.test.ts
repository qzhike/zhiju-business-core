import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';

const uuid = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const digest = '0'.repeat(64);
const scope = { enterpriseId: uuid };
const reference = { kind: 'OBJECT', objectType: 'identity.principal', objectId: uuid, scope };

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
