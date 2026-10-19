import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ContractRegistry } from './registry.js';
import { operationPayloadSchemaRef } from './schema-types.js';
import { PREPARATION_EXECUTION_OPERATIONS } from './preparation-execution.js';
const directory = new URL('../../tests/fixtures/contracts/preparation-execution/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
  provenance: string;
  fixtures: { file: string; operation?: string; mode?: string; schema?: string; valid: boolean }[];
};
const registry = new ContractRegistry();
describe('preparation execution standalone contracts', () => {
  it('covers all new operations and keeps synthetic fixtures discoverable', () => {
    expect(manifest.provenance).toBe('SYNTHETIC_CONTRACT_FIXTURES_ONLY');
    expect(manifest.fixtures.map((f) => f.file).sort()).toEqual(
      readdirSync(directory)
        .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
        .sort(),
    );
    for (const [name] of PREPARATION_EXECUTION_OPERATIONS)
      for (const mode of ['payload', 'result'])
        expect(
          manifest.fixtures.some((f) => f.operation === name && f.mode === mode && f.valid),
          name + mode,
        ).toBe(true);
  });
  for (const f of manifest.fixtures)
    it(`${f.valid ? 'accepts' : 'rejects'} ${f.file}`, () => {
      const value = JSON.parse(readFileSync(new URL(f.file, directory), 'utf8')) as unknown;
      const operation = f.operation ? registry.getOperation(f.operation, '1.0') : undefined;
      if (!f.schema && (!f.operation || !operation)) throw new Error('Missing operation fixture');
      const payloadRef = operation ? operationPayloadSchemaRef(operation) : undefined;
      const outcome = f.schema
        ? registry.validateCoreContract(f.schema, value)
        : f.mode === 'result'
          ? registry.validateOperationResult(f.operation ?? '', '1.0', value)
          : registry.validateCoreContract(payloadRef ?? '', value);
      expect(outcome.valid, JSON.stringify(outcome.errors)).toBe(f.valid);
    });
});
