import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';

const registry = new ContractRegistry();
const directory = new URL('../../tests/fixtures/contracts/expire-run/', import.meta.url);

const runRef = {
  kind: 'OBJECT',
  objectType: 'execution.run',
  objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d511',
  scope: {
    enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
    projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
  },
};

describe('CANCEL-D-001 closed standalone expire_run@2.0 fixtures', () => {
  for (const name of readdirSync(directory)) {
    it(name, () => {
      const value: unknown = JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
      const valid = name.endsWith('-valid.json');
      const result = name.includes('-result-')
        ? registry.validateOperationResult('execution.expire_run', '2.0', value)
        : registry.validateOperation('execution.expire_run', '2.0', value);
      expect(result.valid, JSON.stringify(result.errors)).toBe(valid);
    });
  }

  it('keeps the frozen @1.0 result closed to TIMED_OUT', () => {
    expect(
      registry.validateOperationResult('execution.expire_run', '1.0', {
        runRef,
        status: 'TIMED_OUT',
        endedAt: '2026-08-17T01:30:00Z',
      }),
    ).toEqual({ valid: true, errors: [] });
    const abandoned = registry.validateOperationResult('execution.expire_run', '1.0', {
      runRef,
      status: 'ABANDONED',
      endedAt: '2026-08-17T01:30:00Z',
    });
    expect(abandoned.valid).toBe(false);
    expect(abandoned.errors.some((error) => error.instancePath === '/status')).toBe(true);
  });
});
