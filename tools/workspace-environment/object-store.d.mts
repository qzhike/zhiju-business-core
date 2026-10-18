import type { CustomerZipFileConfiguration } from '@zhiju/integration-gateway';
import type { EnvironmentBConfig } from './config.mjs';
export declare function initializePreparationObjectStore(
  config: EnvironmentBConfig,
): Promise<CustomerZipFileConfiguration>;
