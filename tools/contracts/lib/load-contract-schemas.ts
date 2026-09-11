// Shared schema loading helpers for baseline generation and compatibility checks.
// Imports the same TypeScript schema sources as generate-typescript-types.mts.

import Ajv2020Import from '../../../contracts/node_modules/ajv/dist/2020.js';
import guardPolicyData from '../../../contracts/src/generated/payload-guard-policies.json' with { type: 'json' };
import {
  loadPayloadGuardPolicies,
  payloadGuardKeyword,
} from '../../../contracts/src/payload-guard.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { commonSchema } from '../../../contracts/src/common.schema.ts';
import { coreContractSchemas } from '../../../contracts/src/core.schema.ts';
import { publicApiOperations } from '../../../contracts/src/generated/public-api.ts';
import { artifactSchema } from '../../../contracts/src/operations/artifact.schema.ts';
import { enterpriseProjectSchema } from '../../../contracts/src/operations/enterprise-project.schema.ts';
import { identityPolicySchema } from '../../../contracts/src/operations/identity-policy.schema.ts';
import { integrationGatewaySchema } from '../../../contracts/src/operations/integration-gateway.schema.ts';
import { qualityGovernanceSchema } from '../../../contracts/src/operations/quality-governance.schema.ts';
import { releasePublicationSchema } from '../../../contracts/src/operations/release-publication.schema.ts';
import { taskExecutionSchema } from '../../../contracts/src/operations/task-execution.schema.ts';
import {
  operationEnvelopeSchemaId,
  operationPayloadSchemaRef,
  operationResultSchemaRef,
  type PublicOperationDefinition,
} from '../../../contracts/src/schema-types.ts';

import { operationEnvelopeSchema } from '../../../contracts/src/envelopes.schema.ts';
import {
  isObject,
  stableStringify,
  type OperationCompatibilityRecord,
} from './schema-compatibility.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manualReviewMetadataPath = join(
  repositoryRoot,
  'contracts',
  'registry',
  'operation-compatibility-metadata.v1.json',
);

export interface OperationManualReviewMetadata {
  readonly type: string;
  readonly version: string;
  readonly authorizationPurpose: string;
  readonly dataClassification: string;
  readonly semanticDeclaration: string;
}

interface ManualReviewMetadataFile {
  readonly operations: readonly OperationManualReviewMetadata[];
}

export interface NamedSchemaDocument {
  readonly key: string;
  readonly relativePath: string;
  readonly schemaId: string;
  readonly schema: unknown;
}

export const CORE_CONTRACT_FILES: ReadonlyArray<{
  readonly schemaId: string;
  readonly fileBase: string;
  readonly name: string;
}> = [
  {
    schemaId: 'https://schemas.zhiju.local/core/project-context/1.0',
    fileBase: 'project-context',
    name: 'ProjectContextContract',
  },
  {
    schemaId: 'https://schemas.zhiju.local/core/work-order/1.0',
    fileBase: 'work-order',
    name: 'WorkOrderContract',
  },
  {
    schemaId: 'https://schemas.zhiju.local/core/agent-result/1.0',
    fileBase: 'agent-result',
    name: 'AgentResultContract',
  },
  {
    schemaId: 'https://schemas.zhiju.local/core/revision-acceptance/1.0',
    fileBase: 'revision-acceptance',
    name: 'RevisionAcceptanceSnapshot',
  },
  {
    schemaId: 'https://schemas.zhiju.local/core/approval-bundle/1.0',
    fileBase: 'approval-bundle',
    name: 'ApprovalBundleSnapshot',
  },
  {
    schemaId: 'https://schemas.zhiju.local/core/release-readiness/1.0',
    fileBase: 'release-readiness',
    name: 'ReleaseReadinessSnapshot',
  },
];

export const MODULE_SCHEMA_FILES: ReadonlyArray<{
  readonly owner: string;
  readonly fileBase: string;
  readonly schema: unknown;
}> = [
  { owner: 'identity-policy', fileBase: 'identity-policy', schema: identityPolicySchema },
  {
    owner: 'enterprise-project',
    fileBase: 'enterprise-project',
    schema: enterpriseProjectSchema,
  },
  { owner: 'task-execution', fileBase: 'task-execution', schema: taskExecutionSchema },
  { owner: 'artifact', fileBase: 'artifact', schema: artifactSchema },
  {
    owner: 'quality-governance',
    fileBase: 'quality-governance',
    schema: qualityGovernanceSchema,
  },
  {
    owner: 'release-publication',
    fileBase: 'release-publication',
    schema: releasePublicationSchema,
  },
  {
    owner: 'integration-gateway',
    fileBase: 'integration-gateway',
    schema: integrationGatewaySchema,
  },
];

export function loadCurrentSchemaDocuments(): readonly NamedSchemaDocument[] {
  const documents: NamedSchemaDocument[] = [
    {
      key: 'common',
      relativePath: 'schemas/common.schema.json',
      schemaId: String(isObject(commonSchema) ? commonSchema.$id : 'common'),
      schema: commonSchema,
    },
  ];

  for (const core of CORE_CONTRACT_FILES) {
    const schema = coreContractSchemas.find((item) => isObject(item) && item.$id === core.schemaId);
    if (schema === undefined) {
      throw new Error(`missing core schema ${core.schemaId}`);
    }
    documents.push({
      key: `core:${core.fileBase}`,
      relativePath: `schemas/core/${core.fileBase}.schema.json`,
      schemaId: core.schemaId,
      schema,
    });
  }

  for (const module of MODULE_SCHEMA_FILES) {
    if (!isObject(module.schema) || typeof module.schema.$id !== 'string') {
      throw new Error(`module schema ${module.owner} is missing $id`);
    }
    documents.push({
      key: `module:${module.owner}`,
      relativePath: `schemas/modules/${module.fileBase}.schema.json`,
      schemaId: module.schema.$id,
      schema: module.schema,
    });
  }

  return documents;
}

export function computeManualReviewFingerprint(
  metadata: Pick<
    OperationManualReviewMetadata,
    'authorizationPurpose' | 'dataClassification' | 'semanticDeclaration'
  >,
): string {
  const payload = {
    authorizationPurpose: metadata.authorizationPurpose,
    dataClassification: metadata.dataClassification,
    semanticDeclaration: metadata.semanticDeclaration,
  };
  return createHash('sha256').update(stableStringify(payload).trimEnd(), 'utf8').digest('hex');
}

export function loadManualReviewMetadata(): ReadonlyMap<string, OperationManualReviewMetadata> {
  const file = JSON.parse(
    readFileSync(manualReviewMetadataPath, 'utf8'),
  ) as ManualReviewMetadataFile;
  const map = new Map<string, OperationManualReviewMetadata>();
  for (const entry of file.operations) {
    const key = `${entry.type}@${entry.version}`;
    if (map.has(key)) throw new Error(`duplicate manual-review metadata for ${key}`);
    map.set(key, entry);
  }
  return map;
}

export function loadCurrentOperationRecords(): readonly OperationCompatibilityRecord[] {
  const metadataByKey = loadManualReviewMetadata();
  return (publicApiOperations as readonly PublicOperationDefinition[]).map((operation) => {
    const key = `${operation.type}@${operation.version}`;
    const metadata = metadataByKey.get(key);
    if (metadata === undefined) {
      throw new Error(`missing manual-review metadata for ${key}`);
    }
    return {
      type: operation.type,
      version: operation.version,
      kind: operation.kind,
      owner: operation.owner,
      schemaStatus: operation.schemaStatus,
      payloadSchemaRef: operationPayloadSchemaRef(operation) ?? null,
      resultSchemaRef: operationResultSchemaRef(operation) ?? null,
      manualReviewFingerprint: computeManualReviewFingerprint(metadata),
    };
  });
}

export function loadCoreContractManifestEntries(): ReadonlyArray<{
  readonly name: string;
  readonly schemaId: string;
  readonly snapshot: string;
}> {
  return CORE_CONTRACT_FILES.map((core) => ({
    name: core.name,
    schemaId: core.schemaId,
    snapshot: `schemas/core/${core.fileBase}.schema.json`,
  }));
}

export function envelopeSchemaRelativePath(type: string, version = '1.0'): string {
  const suffix = version === '1.0' ? '' : `@${version}`;
  return `schemas/envelopes/${type}${suffix}.schema.json`;
}

export function loadCurrentEnvelopeDocuments(): readonly NamedSchemaDocument[] {
  return (publicApiOperations as readonly PublicOperationDefinition[]).map((operation) => ({
    key: `envelope:${operation.type}@${operation.version}`,
    relativePath: envelopeSchemaRelativePath(operation.type, operation.version),
    schemaId: operationEnvelopeSchemaId(operation),
    schema: operationEnvelopeSchema(operation),
  }));
}

/** Compile the live graph with the same mandatory resource assertion as ContractRegistry. */
export function assertCurrentSchemasCompile(): void {
  const Ajv2020 = Ajv2020Import as unknown as new (options: object) => {
    addKeyword(keyword: unknown): void;
    addSchema(schema: unknown): void;
    getSchema(id: string): unknown;
  };
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addKeyword(payloadGuardKeyword(loadPayloadGuardPolicies(guardPolicyData)));
  for (const document of [...loadCurrentSchemaDocuments(), ...loadCurrentEnvelopeDocuments()])
    ajv.addSchema(document.schema);
  for (const operation of publicApiOperations as readonly PublicOperationDefinition[]) {
    const refs = [
      operationEnvelopeSchemaId(operation),
      operationPayloadSchemaRef(operation),
      operationResultSchemaRef(operation),
    ];
    for (const ref of refs)
      if (ref !== undefined && ajv.getSchema(ref) === undefined)
        throw new Error(`missing executable schema: ${ref}`);
  }
}
