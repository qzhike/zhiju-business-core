import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import {
  loadPayloadGuardPolicies,
  resolvePayloadGuardPolicy,
} from '../../contracts/src/payload-guard.ts';
import {
  assertSliceOperationRegistrations,
  assertSliceCompatibilityMetadata,
  assertTaskExecutionCompatibilityMetadata,
  assertTaskExecutionOperationRegistrations,
} from '../../contracts/src/operation-registration.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = join(root, 'contracts', 'registry', 'public-api.v1.json');
const outputPath = join(root, 'contracts', 'src', 'generated', 'public-api.ts');
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const guardSource = readFileSync(
  join(root, 'contracts/registry/payload-guard-policies.v1.json'),
  'utf8',
);
const guardPolicies = loadPayloadGuardPolicies(JSON.parse(guardSource));
const guardOutputPath = join(root, 'contracts/src/generated/payload-guard-policies.json');
assertSliceOperationRegistrations(registry.operations);
assertTaskExecutionOperationRegistrations(registry.operations);
const metadata = JSON.parse(
  readFileSync(join(root, 'contracts/registry/operation-compatibility-metadata.v1.json'), 'utf8'),
);
for (const op of registry.operations) {
  if (op.payloadGuardPolicyRef === undefined) continue;
  resolvePayloadGuardPolicy(guardPolicies, op.payloadGuardPolicyRef);
}

assertSliceCompatibilityMetadata(registry.operations, metadata.operations);
assertTaskExecutionCompatibilityMetadata(metadata.operations);

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
    ...[
      'targetObjectType',
      'concurrencyMode',
      'allowedConsistency',
      'authorizationPurpose',
      'dataClassification',
      'payloadGuardPolicyRef',
      'references',
      'resultReferences',
    ]
      .filter((key) => key in operation)
      .map((key) => `    ${key}: ${JSON.stringify(operation[key])},`),
    '  },',
  ].join('\n');
}

const generated = await format(
  [
    "import type { PublicOperationDefinition } from '../schema-types.js';",
    '',
    'export const publicApiOperations = [',
    registry.operations.map(renderOperation).join('\n'),
    '] as const satisfies readonly PublicOperationDefinition[];',
    '',
  ].join('\n'),
  { parser: 'typescript', singleQuote: true, printWidth: 100, trailingComma: 'all' },
);

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n');
  if (current !== generated || readFileSync(guardOutputPath, 'utf8') !== guardSource) {
    console.error('generated public API registry is stale; run pnpm contracts:generate');
    process.exitCode = 1;
  } else {
    console.log(`public_api_generation=PASS operations=${registry.operations.length}`);
  }
} else {
  writeFileSync(outputPath, generated, 'utf8');
  writeFileSync(guardOutputPath, guardSource, 'utf8');
  console.log(`public_api_generation=UPDATED operations=${registry.operations.length}`);
}
