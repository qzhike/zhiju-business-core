export interface MvpConfig {
  version: 1;
  instanceId: string;
  dataDir: string;
  ports: { web: number; bff: number; core: number; identity: number; database: number };
  operatorDisplayName: string;
}
export interface MvpSecrets {
  instanceId: string;
  createdAt: string;
  postgresPassword: string;
  runtimePassword: string;
  keycloakDbPassword: string;
  keycloakAdminPassword: string;
  clientSecret: string;
  operatorPassword: string;
  cursorKey: string;
  username: string;
  subjectId: string;
  boardServiceId: string;
  storeId: string;
}
export declare function initializeConfig(root: string, filename: string): Promise<MvpConfig>;
export declare function readConfig(filename: string): Promise<MvpConfig>;
export declare function readOrCreateSecrets(config: MvpConfig): Promise<MvpSecrets>;
export declare function validateConfig(value: unknown): MvpConfig;
export declare function deploymentFingerprint(config: MvpConfig): string;
export declare function writePrivateJson(
  filename: string,
  value: unknown,
  exclusive?: boolean,
): Promise<void>;
