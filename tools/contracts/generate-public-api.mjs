import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import {
  loadPayloadGuardPolicies,
  resolvePayloadGuardPolicy,
} from '../../contracts/src/payload-guard.ts';
import { workOrderSchema } from '../../contracts/src/core.schema.ts';
import { loadWorkOrderReadyProfileRegistry } from '../../contracts/src/work-order-ready-profiles.ts';
import { loadArtifactExecutionSchema } from '../../contracts/src/formal-output-profile.ts';
import { loadArtifactMarkdownSchema } from '../../contracts/src/markdown-document-profile.ts';
import { loadEvaluatorProfileRegistry } from '../../contracts/src/evaluator-profiles.ts';
import { loadPolicyProfileRegistry } from '../../contracts/src/policy-profiles.ts';
import { loadCompanyStartupRegistry } from '../../contracts/src/company-startup.ts';
import {
  assertPolicyVersionCompatibilityMetadata,
  assertPolicyVersionOperationRegistrations,
  assertResolutionReceiptCompatibilityMetadata,
  assertResolutionReceiptOperationRegistrations,
  assertRevisionEligibilityCompatibilityMetadata,
  assertRevisionEligibilityOperationRegistrations,
  assertInitialContextEnterpriseFactRegistration,
  assertSliceOperationRegistrations,
  assertSliceCompatibilityMetadata,
  assertTaskExecutionCompatibilityMetadata,
  assertTaskExecutionCreationPurposeMetadata,
  assertTaskExecutionCreationPurposeRegistrations,
  assertTaskExecutionOperationRegistrations,
  assertTaskReadinessCompatibilityMetadata,
  assertTaskReadinessOperationRegistrations,
  assertWorkOrderValidationCompatibilityMetadata,
  assertWorkOrderValidationOperationRegistrations,
  taskExecutionCreationPurposes,
} from '../../contracts/src/operation-registration.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaRegistrySource = readFileSync(
  join(root, 'contracts/registry/artifact-execution-schemas.v1.json'),
  'utf8',
);
const schemaRegistryOutputPath = join(
  root,
  'contracts/src/generated/artifact-execution-schemas.json',
);
// #270: the Markdown document profile uses its own closed registry and mirror.
const markdownRegistrySource = readFileSync(
  join(root, 'contracts/registry/artifact-markdown-schemas.v1.json'),
  'utf8',
);
const markdownRegistryOutputPath = join(
  root,
  'contracts/src/generated/artifact-markdown-schemas.json',
);
const registryPath = join(root, 'contracts', 'registry', 'public-api.v1.json');
const outputPath = join(root, 'contracts', 'src', 'generated', 'public-api.ts');
const creationPurposeOutputPath = join(
  root,
  'contracts',
  'src',
  'generated',
  'task-execution-creation-purposes.json',
);
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const guardSource = readFileSync(
  join(root, 'contracts/registry/payload-guard-policies.v1.json'),
  'utf8',
);
const guardPolicies = loadPayloadGuardPolicies(JSON.parse(guardSource));
const guardOutputPath = join(root, 'contracts/src/generated/payload-guard-policies.json');

// Company profiles use an independent closed registry and byte-identical mirror.
const companyRegistrySource = readFileSync(
  join(root, 'contracts/registry/company-startup-profiles.v1.json'),
  'utf8',
);
loadCompanyStartupRegistry(JSON.parse(companyRegistrySource));
const companyRegistryOutputPath = join(
  root,
  'contracts/src/generated/company-startup-profiles.json',
);

// The IM-06 profile registry is a build artifact too: the generated copy is a
// byte-for-byte mirror of the registry source, and loading it here rejects a
// duplicated key/identity or a missing mapping before anything consumes it.
const profileRegistrySource = readFileSync(
  join(root, 'contracts/registry/policy-profiles.v1.json'),
  'utf8',
);
const profileRegistry = loadPolicyProfileRegistry(JSON.parse(profileRegistrySource));
const profileRegistryOutputPath = join(root, 'contracts/src/generated/policy-profiles.json');

// The IM-06 Evaluator profile registry is a build artifact of the same shape:
// the generated copy is a byte-for-byte mirror of the registry source, and
// loading it rejects a duplicated key/identity, a missing entry or a wrong
// owner before anything consumes it.
const evaluatorRegistrySource = readFileSync(
  join(root, 'contracts/registry/evaluator-profiles.v1.json'),
  'utf8',
);
const evaluatorRegistry = loadEvaluatorProfileRegistry(JSON.parse(evaluatorRegistrySource));
const evaluatorRegistryOutputPath = join(root, 'contracts/src/generated/evaluator-profiles.json');
const readyRegistrySource = readFileSync(
  join(root, 'contracts/registry/work-order-ready-profiles.v1.json'),
  'utf8',
);
const readyRegistry = loadWorkOrderReadyProfileRegistry(JSON.parse(readyRegistrySource));
if (readyRegistry.profiles[0].descriptor.schemaId !== workOrderSchema.$id)
  throw new Error('READY WorkOrder schema is not registered');
const readyRegistryOutputPath = join(
  root,
  'contracts/src/generated/work-order-ready-profiles.json',
);
loadArtifactExecutionSchema(JSON.parse(schemaRegistrySource));
loadArtifactMarkdownSchema(JSON.parse(markdownRegistrySource));
assertSliceOperationRegistrations(registry.operations);
assertTaskExecutionOperationRegistrations(registry.operations);
assertInitialContextEnterpriseFactRegistration();
assertTaskReadinessOperationRegistrations(registry.operations);
assertWorkOrderValidationOperationRegistrations(registry.operations);
assertTaskExecutionCreationPurposeRegistrations(registry.operations);
assertPolicyVersionOperationRegistrations(registry.operations);
assertResolutionReceiptOperationRegistrations(registry.operations);
assertRevisionEligibilityOperationRegistrations(registry.operations);
const metadata = JSON.parse(
  readFileSync(join(root, 'contracts/registry/operation-compatibility-metadata.v1.json'), 'utf8'),
);
for (const op of registry.operations) {
  if (op.payloadGuardPolicyRef === undefined) continue;
  resolvePayloadGuardPolicy(guardPolicies, op.payloadGuardPolicyRef);
}

assertSliceCompatibilityMetadata(registry.operations, metadata.operations);
assertTaskExecutionCompatibilityMetadata(metadata.operations);
assertTaskReadinessCompatibilityMetadata(metadata.operations);
assertWorkOrderValidationCompatibilityMetadata(metadata.operations);
assertTaskExecutionCreationPurposeMetadata(metadata.operations);
assertPolicyVersionCompatibilityMetadata(metadata.operations);
assertResolutionReceiptCompatibilityMetadata(metadata.operations);
assertRevisionEligibilityCompatibilityMetadata(metadata.operations);

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
      'resultSchemaRef',
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

// The run-time consumable creation Purpose mapping is a projection of the two
// published registries, not a third registry: the four approved
// `(type, version)` keys come from the check table, owner/kind from
// `public-api.v1.json` and the Purpose from
// `operation-compatibility-metadata.v1.json` (the only source that carries the
// two `@1.0` values). Both assertions above already rejected a missing,
// duplicated, mis-owned, mis-kinded or rewritten entry.
const creationPurposeMappings = taskExecutionCreationPurposes.map(
  ({ type: commandType, version: commandVersion }) => {
    const operation = registry.operations.find(
      (candidate) => candidate.type === commandType && candidate.version === commandVersion,
    );
    const entry = metadata.operations.find(
      (candidate) => candidate.type === commandType && candidate.version === commandVersion,
    );
    if (operation === undefined || entry === undefined) {
      throw new Error(`missing creation operation: ${commandType}@${commandVersion}`);
    }
    return {
      commandType: operation.type,
      commandVersion: operation.version,
      authorizationPurpose: entry.authorizationPurpose,
    };
  },
);

const generatedCreationPurposes = `${JSON.stringify(
  {
    generatedFrom: [
      'contracts/registry/public-api.v1.json',
      'contracts/registry/operation-compatibility-metadata.v1.json',
    ],
    mappings: creationPurposeMappings,
  },
  null,
  2,
)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n');
  if (
    current !== generated ||
    readFileSync(companyRegistryOutputPath, 'utf8') !== companyRegistrySource ||
    readFileSync(schemaRegistryOutputPath, 'utf8') !== schemaRegistrySource ||
    readFileSync(markdownRegistryOutputPath, 'utf8') !== markdownRegistrySource ||
    readFileSync(readyRegistryOutputPath, 'utf8') !== readyRegistrySource ||
    readFileSync(guardOutputPath, 'utf8') !== guardSource ||
    readFileSync(profileRegistryOutputPath, 'utf8') !== profileRegistrySource ||
    readFileSync(evaluatorRegistryOutputPath, 'utf8') !== evaluatorRegistrySource ||
    readFileSync(creationPurposeOutputPath, 'utf8') !== generatedCreationPurposes
  ) {
    console.error('generated public API registry is stale; run pnpm contracts:generate');
    process.exitCode = 1;
  } else {
    console.log(
      `public_api_generation=PASS operations=${registry.operations.length} policy_profiles=${profileRegistry.profiles.length} evaluator_profiles=${evaluatorRegistry.profiles.length} creation_purposes=${creationPurposeMappings.length}`,
    );
  }
} else {
  writeFileSync(companyRegistryOutputPath, companyRegistrySource, 'utf8');
  writeFileSync(schemaRegistryOutputPath, schemaRegistrySource, 'utf8');
  writeFileSync(markdownRegistryOutputPath, markdownRegistrySource, 'utf8');
  writeFileSync(outputPath, generated, 'utf8');
  writeFileSync(readyRegistryOutputPath, readyRegistrySource, 'utf8');
  writeFileSync(guardOutputPath, guardSource, 'utf8');
  writeFileSync(profileRegistryOutputPath, profileRegistrySource, 'utf8');
  writeFileSync(evaluatorRegistryOutputPath, evaluatorRegistrySource, 'utf8');
  writeFileSync(creationPurposeOutputPath, generatedCreationPurposes, 'utf8');
  console.log(
    `public_api_generation=UPDATED operations=${registry.operations.length} policy_profiles=${profileRegistry.profiles.length} evaluator_profiles=${evaluatorRegistry.profiles.length} creation_purposes=${creationPurposeMappings.length}`,
  );
}
