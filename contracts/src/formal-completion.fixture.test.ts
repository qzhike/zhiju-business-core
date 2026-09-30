import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractRegistry } from './registry.js';

const registry = new ContractRegistry();
const directory = new URL('../../tests/fixtures/contracts/formal-completion/', import.meta.url);
const operations = [
  ['evaluate-work-order', 'execution.evaluate_work_order_completion', '2.0'],
  ['evaluate-task', 'execution.evaluate_task_completion', '2.0'],
  ['output-binding', 'execution.get_output_creation_binding', '1.0'],
  ['work-order-state', 'execution.get_work_order_state', '1.0'],
  ['judgment', 'execution.get_execution_judgment', '1.0'],
  ['create-revision', 'artifact.create_execution_revision', '1.0'],
  ['output-fact', 'artifact.get_execution_output_fact', '1.0'],
] as const;
describe('TE-COMP-D-001 / ART-COMP-D-001 closed standalone formal completion fixtures', () => {
  for (const [prefix, type, version] of operations) {
    for (const filename of readdirSync(directory).filter((f) => f.startsWith(prefix + '-'))) {
      it(filename, () => {
        const fixture: unknown = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'));
        const validation = filename.includes('-result-')
          ? registry.validateOperationResult(type, version, fixture)
          : registry.validateOperation(type, version, fixture);
        expect(validation.valid, JSON.stringify(validation.errors)).toBe(
          filename.includes('-valid.json'),
        );
      });
    }
  }
});
