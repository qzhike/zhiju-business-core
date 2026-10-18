import type { EnvironmentBConfig } from './config.mjs';
export declare function supervisorRequest(
  config: EnvironmentBConfig,
  secrets: Record<string, string>,
  action?: 'status' | 'stop',
): Promise<Record<string, unknown> | null>;
