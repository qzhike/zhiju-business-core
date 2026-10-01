import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractRegistry } from './registry.js';
import { exactCompletionCriteria } from './delivery-completion-profile.js';
import type { Common } from './generated/types/common.js';

const registry = new ContractRegistry();
const directory = new URL('../../tests/fixtures/contracts/delivery-completion/', import.meta.url);
const scope = {
  enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
  projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
} satisfies Common.ScopeRef;
describe('TE-DEL-D-009 closed standalone delivery completion fixtures', () => {
  for (const name of readdirSync(directory)) {
    it(name, () => {
      const value: unknown = JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
      const valid = name.endsWith('-valid.json');
      if (name.startsWith('criteria-')) {
        if (valid) expect(exactCompletionCriteria(value, scope).taskRef).toBeDefined();
        else
          expect(() => exactCompletionCriteria(value, scope)).toThrow(
            'PROJECT_DELIVERY_ITEM_CRITERIA_UNSATISFIED',
          );
      } else {
        const result = name.includes('-result-')
          ? registry.validateOperationResult(
              'project.evaluate_delivery_item_completion',
              '2.0',
              value,
            )
          : registry.validateOperation(
              'project.evaluate_delivery_item_completion',
              name.startsWith('legacy-') ? '1.0' : '2.0',
              value,
            );
        expect(result.valid, JSON.stringify(result.errors)).toBe(valid);
      }
    });
  }
});
