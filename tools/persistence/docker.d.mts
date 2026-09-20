export interface DockerRuntimeResolution {
  host: string | null;
  source: 'environment' | 'docker-context' | 'docker-default';
  configured: boolean;
}

export interface DockerRuntimeOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  inspectContext?: () => Promise<string>;
  socketExists?: (path: string) => boolean;
}

export function docker(args: string[], options?: Record<string, unknown>): Promise<string>;
export function configureDockerHostFromCurrentContext(
  options?: DockerRuntimeOptions,
): Promise<DockerRuntimeResolution>;
export function dockerInspectImage(reference: string): Promise<unknown>;
export function isTransientDockerRegistryError(error: unknown): boolean;
export function resolveTagDigest(
  repository: string,
  tag: string,
  options?: Record<string, unknown> & {
    attempts?: number;
    retryDelayMs?: number;
    inspectTag?: (args: string[], options?: Record<string, unknown>) => Promise<string>;
    wait?: (delay?: number) => Promise<unknown>;
  },
): Promise<string>;
