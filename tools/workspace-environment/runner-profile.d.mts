import type { LocalOmpProfile } from '@zhiju/integration-gateway';
import type { EnvironmentBConfig } from './config.mjs';
export function initializeRunnerProfile(config: EnvironmentBConfig): Promise<LocalOmpProfile>;
