import { describe } from 'vitest';
import { registerContextBuild } from './initial-context-context-build.js';
import { registerContextRead } from './initial-context-context-read.js';
import { registerContextSecurity } from './initial-context-context-security.js';
import { registerExecution } from './initial-context-execution.js';
import { gateEnabled } from './initial-context-fixtures.js';
import { registerSourceSlices } from './initial-context-source-slices.js';
import { createInitialContextSuite } from './initial-context-suite.js';
// One registration entry preserves serial execution, fixture lifetime and case order.
describe.skipIf(!gateEnabled)('initial Context Snapshot build and read (real PostgreSQL)', () => {
  const suite = createInitialContextSuite();
  registerContextBuild(suite);
  registerContextSecurity(suite);
  registerContextRead(suite);
  registerSourceSlices(suite);
  registerExecution(suite);
});
