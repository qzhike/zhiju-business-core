import { describe, expect, it } from 'vitest';
import { matchesCreation, type CreationIntent, type CreationReceipt } from './model.js';
describe('project creation identity', () => {
  const customer = { id: 'customer-a', name: 'Equal name', code: 'A' };
  const intent: CreationIntent = {
    id: 'intent-a',
    title: 'Title',
    customer: { kind: 'EXISTING', customer },
  };
  const receipt: CreationReceipt = {
    intent,
    project: { id: 'project-a', title: 'Title', customer },
  };
  it('requires original intent, title and independent customer ID', () => {
    expect(matchesCreation(intent, receipt)).toBe(true);
    expect(matchesCreation(intent, { ...receipt, intent: { ...intent, id: 'other' } })).toBe(false);
    expect(
      matchesCreation(intent, {
        ...receipt,
        project: { ...receipt.project, customer: { ...customer, id: 'same-name-other-id' } },
      }),
    ).toBe(false);
    expect(
      matchesCreation(intent, {
        ...receipt,
        project: { ...receipt.project, title: 'Other title' },
      }),
    ).toBe(false);
  });
});
