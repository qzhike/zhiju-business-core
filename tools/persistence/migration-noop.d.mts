export const migrationHistorySql: string;
export function verifyMigrationNoop(
  readHistory: () => Promise<string>,
  migrate: () => Promise<string>,
): Promise<string>;
