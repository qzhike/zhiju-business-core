import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Only this explicit development build may contain the anonymous fixture adapter.
for (const args of [
  ['exec', 'tsc', '-b'],
  ['exec', 'vite', 'build', '--mode', 'fixture'],
]) {
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(
  'dist/fixture-build.json',
  JSON.stringify({ classification: 'DEVELOPMENT_FIXTURE_ONLY' }),
);
