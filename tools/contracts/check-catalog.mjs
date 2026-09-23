import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalogPath = join(
  root,
  '.vibe',
  'high-level-docs',
  '06-typed-references-contract-catalog-v0.1.md',
);
const registryPath = join(root, 'contracts', 'registry', 'public-api.v1.json');
const catalogText = readFileSync(catalogPath, 'utf8');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const catalogNames = [
  ...catalogText.matchAll(/^([a-z][a-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)@(1\.0|1\.1|2\.0)\s*$/gmu),
].map((match) => `${match[1]}@${match[2]}`);
const registryNames = registry.operations.map(
  (operation) => `${operation.type}@${operation.version}`,
);

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

const catalogSet = new Set(catalogNames);
const registrySet = new Set(registryNames);
const missing = catalogNames.filter((name) => !registrySet.has(name));
const extra = registryNames.filter((name) => !catalogSet.has(name));
const invalid = registry.operations.filter(
  (operation) =>
    !['1.0', '1.1', '2.0'].includes(operation.version) ||
    !['COMMAND', 'QUERY', 'EVENT'].includes(operation.kind) ||
    typeof operation.owner !== 'string' ||
    !['ENVELOPE_ONLY', 'FULL'].includes(operation.schemaStatus),
);

const implementedOwners = new Set([
  'identity-policy',
  'enterprise-project',
  'task-execution',
  'artifact',
  'quality-governance',
  'release-publication',
  'integration-gateway',
]);
const invalidFullOperations = registry.operations.filter(
  (operation) => operation.schemaStatus === 'FULL' && !implementedOwners.has(operation.owner),
);
const incompleteImplementedOperations = registry.operations.filter(
  (operation) => implementedOwners.has(operation.owner) && operation.schemaStatus !== 'FULL',
);

const issues = [
  ...duplicates(catalogNames).map((name) => `duplicate catalog operation: ${name}`),
  ...duplicates(registryNames).map((name) => `duplicate registry operation: ${name}`),
  ...missing.map((name) => `missing registry operation: ${name}`),
  ...extra.map((name) => `unexpected registry operation: ${name}`),
  ...invalid.map((operation) => `invalid registry metadata: ${operation.type}`),
  ...invalidFullOperations.map(
    (operation) => `operation marked FULL without an implemented module schema: ${operation.type}`,
  ),
  ...incompleteImplementedOperations.map(
    (operation) => `implemented module operation is missing its FULL schema: ${operation.type}`,
  ),
];

if (catalogNames.length !== 221)
  issues.push(`catalog count must be 221, got ${catalogNames.length}`);
if (registryNames.length !== 221)
  issues.push(`registry count must be 221, got ${registryNames.length}`);

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  const statusCounts = Object.groupBy(registry.operations, (operation) => operation.schemaStatus);
  console.log(
    `catalog_registry=PASS catalog=${catalogNames.length} registry=${registryNames.length} schema_status=${JSON.stringify(Object.fromEntries(Object.entries(statusCounts).map(([key, values]) => [key, values.length])))}`,
  );
}
