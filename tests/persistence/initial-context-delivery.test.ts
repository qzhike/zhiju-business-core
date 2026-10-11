import { describe } from 'vitest';
import { deliveryCases } from './initial-context-delivery-cases.js';
import { definedValue, gateEnabled } from './initial-context-fixtures.js';
import { registerIsolatedInitialContextGroups } from './initial-context-isolated-cases.js';

describe.skipIf(!gateEnabled)('initial Context delivery (isolated PostgreSQL)', () => {
  const cases = deliveryCases();
  registerIsolatedInitialContextGroups(
    [
      {
        label: 'delivery late-commit and normal',
        cases: [definedValue(cases[0]), definedValue(cases[1])],
      },
      { label: 'delivery recovered', cases: [definedValue(cases[2])] },
    ],
    { databasePerCase: true, deliveryOnly: true },
  );
});
