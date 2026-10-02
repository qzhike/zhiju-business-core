import type { RunScenario } from './initial-context-scenario.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerLegacy(suite: InitialContextSuite, runScenario: RunScenario): void {
  suite.itIntegration(
    'upgrades historical Run/Claim/ack facts without fabricating identities and expires the legacy Run',
    () => runScenario('LEGACY_UPGRADE'),
    360_000,
  );
}
