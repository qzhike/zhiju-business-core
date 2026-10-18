export interface EnvironmentBConfig {
  version: 1;
  instanceId: string;
  dataDir: string;
  ports: {
    web: number;
    bff: number;
    core: number;
    identity: number;
    database: number;
    control: number;
  };
  runner: { projectRoot: string; profileFile: string | null };
}
export declare const DEFAULT_PORTS: EnvironmentBConfig['ports'];
export declare const CONFIG_FILENAME: string;
export declare function within(child: string, parent: string): boolean;
export declare function validateConfig(value: unknown): EnvironmentBConfig;
export declare function readConfig(
  filename: string,
  options?: { checkRunner?: boolean },
): Promise<EnvironmentBConfig>;
export declare function deploymentFingerprint(config: EnvironmentBConfig): string;
export declare function assertPrivateDataDirectory(config: EnvironmentBConfig): Promise<void>;
export declare function writePrivateJson(
  filename: string,
  value: unknown,
  exclusive?: boolean,
): Promise<void>;
export declare function initializeConfig(
  root: string,
  filename: string,
  runnerProjectRoot?: string,
): Promise<EnvironmentBConfig>;
export declare function readOrCreateSecrets(
  config: EnvironmentBConfig,
): Promise<Record<string, string>>;
export declare function readSecrets(config: EnvironmentBConfig): Promise<Record<string, string>>;
export declare function publicStatus(
  config: EnvironmentBConfig,
  services?: Record<string, string>,
): Record<string, unknown>;
