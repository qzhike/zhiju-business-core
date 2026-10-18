import type { EnvironmentBConfig } from './config.mjs';
export declare const OWNER_LABEL: string;
export declare function assertOwned(
  config: EnvironmentBConfig,
  value: unknown,
  kind: string,
): unknown;
export declare function assertPortAvailable(port: number): Promise<void>;
