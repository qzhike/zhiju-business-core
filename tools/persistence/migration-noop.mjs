// Check the complete history, including timestamps, type and installed script.
export const migrationHistorySql =
  "SELECT COALESCE(jsonb_agg(to_jsonb(history) ORDER BY installed_rank), '[]'::jsonb)::text FROM public.flyway_schema_history AS history;";

export async function verifyMigrationNoop(readHistory, migrate) {
  const before = await readHistory();
  if (typeof before !== 'string' || !before.trim() || before.trim() === '[]')
    throw new Error('missing migration history before no-op check');
  const output = await migrate();
  const noPendingLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /up to date|no pending migrations|No migration necessary/i.test(line));
  if (!noPendingLine) throw new Error(`second flyway migrate was not a no-op:\n${output}`);
  const after = await readHistory();
  if (after !== before) throw new Error('migration history changed during no-op check');
  return noPendingLine;
}
