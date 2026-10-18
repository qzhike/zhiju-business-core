import type { EnvironmentBConfig } from './config.mjs';

export declare function invalidateInitialization(config: EnvironmentBConfig): Promise<void>;
export declare function recordInitialization(config: EnvironmentBConfig): Promise<void>;
export declare function initializationComplete(config: EnvironmentBConfig): Promise<boolean>;
