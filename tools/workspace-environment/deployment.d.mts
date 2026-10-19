import type { EnvironmentBConfig } from './config.mjs';

export declare function trustDocument(
  config: EnvironmentBConfig,
  identities: { boardServiceId: string },
  preparation?: unknown,
): Record<string, unknown> & { capabilityCodes: Record<string, string> };

export declare function applicationEnvironments(
  config: EnvironmentBConfig,
  secrets: Record<string, string>,
  identities: { boardServiceId: string },
  preparation?: unknown,
): {
  core: Record<string, string> & { ZHIJU_WORKSPACE_TRUST_CONFIG: string };
  bff: Record<string, string> & { ZHIJU_WORKSPACE_TRUST_CONFIG: string };
  web: Record<string, string>;
};
