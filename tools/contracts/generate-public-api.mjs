import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = join(root, 'contracts', 'registry', 'public-api.v1.json');
const outputPath = join(root, 'contracts', 'src', 'generated', 'public-api.ts');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

function quote(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function renderOperation(operation) {
  return [
    '  {',
    `    type: ${quote(operation.type)},`,
    `    version: ${quote(operation.version)},`,
    `    kind: ${quote(operation.kind)},`,
    `    owner: ${quote(operation.owner)},`,
    `    schemaStatus: ${quote(operation.schemaStatus)},`,
    '  },',
  ].join('\n');
}

const generated = [
  "import type { PublicOperationDefinition } from '../schema-types.js';",
  '',
  'export const publicApiOperations = [',
  registry.operations.map(renderOperation).join('\n'),
  '] as const satisfies readonly PublicOperationDefinition[];',
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n');
  if (current !== generated) {
    console.error('generated public API registry is stale; run pnpm contracts:generate');
    process.exitCode = 1;
  } else {
    console.log(`public_api_generation=PASS operations=${registry.operations.length}`);
  }
} else {
  writeFileSync(outputPath, generated, 'utf8');
  console.log(`public_api_generation=UPDATED operations=${registry.operations.length}`);
}
