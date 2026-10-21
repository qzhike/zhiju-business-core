export const fixedPartitions: Record<'1' | '2', string[]>;
export interface PersistenceRun {
  kind: 'full' | 'partition' | 'focused';
  files: string[];
  partition?: string;
  pattern?: string;
}
export function discoverPersistenceFiles(root: string): string[];
export function partitionFiles(
  files: string[],
  id: string,
  fixed?: Record<string, string[]>,
): string[];
export function selectPersistenceRun(args: string[], root: string): PersistenceRun;
export function persistenceRunEnvironment(run: PersistenceRun): Record<string, string>;
export function assertPersistenceFileExecution(
  root: string,
  modules: { moduleId: string }[],
  expected: string[],
): void;
