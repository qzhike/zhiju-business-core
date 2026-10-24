import type { MvpConfig } from './config.mjs';
export declare function assertOwned(config: MvpConfig, value: unknown, kind: string): unknown;
export declare function assertPortAvailable(port: number): Promise<void>;
