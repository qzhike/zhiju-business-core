import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractRegistry } from '@zhiju/contracts';
import {
  assertPreparationTaskResult,
  assertPreparationTaskReadback,
  assertRegisteredPreparationTaskResult,
  preparationTaskOperationsRegistered,
  type PreparationTaskCommand,
  type PreparationAnalysisCommand,
} from './preparation-task-port.js';
interface Fixture {
  operation: 'TASK' | 'ANALYSIS_REQUEST';
  originalCommand: PreparationTaskCommand | PreparationAnalysisCommand;
  result: unknown;
  readback?: unknown;
  valid: boolean;
}
const directory = new URL(
  '../../../../tests/fixtures/contracts/preparation-task-port/',
  import.meta.url,
);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
  provenance: string;
  fixtures: string[];
};
describe('Preparation TE mapping, without native TE execution', () => {
  it('enumerates all standalone synthetic fixture files', () => {
    expect(manifest.provenance).toBe('SYNTHETIC_MAPPING_ONLY_NO_NATIVE_TE_EXECUTION');
    expect(manifest.fixtures.slice().sort()).toEqual(
      readdirSync(directory)
        .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
        .sort(),
    );
  });
  for (const filename of manifest.fixtures) {
    it(filename, () => {
      const fixture = JSON.parse(readFileSync(new URL(filename, directory), 'utf8')) as Fixture;
      const check = () => {
        if (fixture.readback !== undefined)
          assertPreparationTaskReadback(
            fixture.operation,
            fixture.originalCommand,
            fixture.result,
            fixture.readback,
          );
        else
          assertPreparationTaskResult(fixture.operation, fixture.originalCommand, fixture.result);
      };
      if (fixture.valid) expect(check).not.toThrow();
      else expect(check).toThrow('PREPARATION_HANDOFF_RECEIPT_INVALID');
    });
  }
  it('registers the exact preparation profile but rejects historical mapping-only fake receipts', () => {
    const registry = new ContractRegistry();
    expect(
      registry.getOperation('execution.create_preparation_analysis_task', '1.0'),
    ).toMatchObject({ schemaStatus: 'FULL' });
    expect(registry.getOperation('execution.request_preparation_analysis', '1.0')).toMatchObject({
      schemaStatus: 'FULL',
    });
    expect(preparationTaskOperationsRegistered()).toBe(true);
    const fixture = JSON.parse(
      readFileSync(new URL('task-result-valid.json', directory), 'utf8'),
    ) as Fixture;
    expect(() => {
      assertRegisteredPreparationTaskResult(
        fixture.operation,
        fixture.originalCommand,
        fixture.result,
      );
    }).toThrow('PREPARATION_HANDOFF_RECEIPT_INVALID');
  });
});
