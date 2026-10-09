import { rmSync } from 'node:fs';

for (const path of [
  'apps/workspace-web/dist',
  'apps/workspace-web/dist-types',
  'apps/workspace-bff/dist',
]) {
  rmSync(path, { recursive: true, force: true });
}
