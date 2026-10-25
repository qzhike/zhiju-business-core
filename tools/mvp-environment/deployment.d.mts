import type { MvpConfig, MvpSecrets } from './config.mjs';
export declare function applicationEnvironments(
  config: MvpConfig,
  secrets: MvpSecrets,
  installation: { storeRoot: string; storeId: string; storeIdentity: string },
): { core: Record<string, string>; bff: Record<string, string>; web: Record<string, string> };
