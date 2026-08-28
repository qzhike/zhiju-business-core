#!/usr/bin/env node --experimental-strip-types
//
// Compare the current executable schemas against the frozen v1.0 baseline.
// Read-only: never rewrites contracts/baselines/v1.0/**.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCurrentEnvelopeDocuments,
  loadCurrentOperationRecords,
  loadCurrentSchemaDocuments,
} from './lib/load-contract-schemas.ts';
import {
  applyApprovals,
  compareOperationRecords,
  compareSchemaDocuments,
  failingFindings,
  formatFindings,
  type CompatibilityApproval,
  type CompatibilityFinding,
  type OperationCompatibilityRecord,
} from './lib/schema-compatibility.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselineRoot = join(root, 'contracts', 'baselines', 'v1.0');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(baselineRoot, relativePath), 'utf8')) as T;
}

interface BaselineManifest {
  readonly baselineId: string;
  readonly operationCount: number;
  readonly coreContractCount: number;
  readonly schemaDocuments: readonly string[];
  readonly envelopeDocuments?: readonly string[];
  readonly operations: readonly OperationCompatibilityRecord[];
  readonly coreContracts: ReadonlyArray<{
    readonly name: string;
    readonly schemaId: string;
    readonly snapshot: string;
  }>;
  readonly approvals: readonly CompatibilityApproval[];
}

const manifest = readJson<BaselineManifest>('manifest.json');
const baselineOperations = readJson<{
  readonly operations: readonly OperationCompatibilityRecord[];
}>('operations.index.json').operations;

const findings: CompatibilityFinding[] = [];

if (manifest.operationCount !== 200) {
  findings.push({
    severity: 'BREAKING',
    target: 'baseline=v1.0',
    path: '/operationCount',
    keyword: 'baseline-count',
    detail: `baseline operationCount must be 200, got ${manifest.operationCount}`,
  });
}
if (manifest.coreContractCount !== 6) {
  findings.push({
    severity: 'BREAKING',
    target: 'baseline=v1.0',
    path: '/coreContractCount',
    keyword: 'baseline-count',
    detail: `baseline coreContractCount must be 6, got ${manifest.coreContractCount}`,
  });
}

const envelopeDocuments = manifest.envelopeDocuments ?? [];
if (envelopeDocuments.length !== 200) {
  findings.push({
    severity: 'BREAKING',
    target: 'baseline=v1.0',
    path: '/envelopeDocuments',
    keyword: 'baseline-count',
    detail: `baseline envelopeDocuments must be 200, got ${envelopeDocuments.length}`,
  });
}

const currentDocuments = new Map(
  loadCurrentSchemaDocuments().map((document) => [document.relativePath, document] as const),
);

for (const relativePath of manifest.schemaDocuments) {
  const baselineSchema = readJson<unknown>(relativePath);
  const current = currentDocuments.get(relativePath);
  if (current === undefined) {
    findings.push({
      severity: 'BREAKING',
      target: `schema=${relativePath}`,
      path: '',
      keyword: 'schema-document-missing',
      detail: 'schema document missing from current sources',
    });
    continue;
  }
  findings.push(
    ...compareSchemaDocuments(baselineSchema, current.schema, `schema=${relativePath}`),
  );
}

const currentEnvelopes = new Map(
  loadCurrentEnvelopeDocuments().map((document) => [document.relativePath, document] as const),
);

for (const relativePath of envelopeDocuments) {
  const baselineSchema = readJson<unknown>(relativePath);
  const current = currentEnvelopes.get(relativePath);
  if (current === undefined) {
    findings.push({
      severity: 'BREAKING',
      target: `envelope=${relativePath}`,
      path: '',
      keyword: 'envelope-document-missing',
      detail: 'envelope schema missing from current sources',
    });
    continue;
  }
  findings.push(
    ...compareSchemaDocuments(baselineSchema, current.schema, `envelope=${relativePath}`),
  );
}

const currentOperations = new Map(
  loadCurrentOperationRecords().map(
    (operation) => [`${operation.type}@${operation.version}`, operation] as const,
  ),
);

for (const baseline of baselineOperations) {
  const key = `${baseline.type}@${baseline.version}`;
  findings.push(...compareOperationRecords(baseline, currentOperations.get(key)));
}

for (const [key] of currentOperations) {
  if (!baselineOperations.some((operation) => `${operation.type}@${operation.version}` === key)) {
    findings.push({
      severity: 'COMPATIBLE_MINOR',
      target: `operation=${key}`,
      path: '',
      keyword: 'operation-added-as-minor',
      detail: 'new independent operation is additive under the frozen v1.0 baseline',
    });
  }
}

const unresolved = failingFindings(applyApprovals(findings, manifest.approvals ?? []));
const minorCount = findings.filter((item) => item.severity === 'COMPATIBLE_MINOR').length;

if (unresolved.length > 0) {
  console.error(`compatibility=FAIL count=${unresolved.length}`);
  console.error(formatFindings(unresolved));
  process.exitCode = 1;
} else {
  console.log(
    `compatibility=PASS baseline=v1.0 operations=${baselineOperations.length} schemas=${manifest.schemaDocuments.length} envelopes=${envelopeDocuments.length} minor=${minorCount} findings=${findings.length}`,
  );
}
