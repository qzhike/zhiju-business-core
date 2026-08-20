#!/usr/bin/env node --experimental-strip-types
//
// Freeze the IM-01 v1.0 schema compatibility baseline under
// `contracts/baselines/v1.0/`. Refuses to overwrite an existing baseline
// unless FORCE_BASELINE_REWRITE=1 is set — silent rewrites are forbidden.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCoreContractManifestEntries,
  loadCurrentOperationRecords,
  loadCurrentSchemaDocuments,
} from './lib/load-contract-schemas.ts';
import { stableStringify } from './lib/schema-compatibility.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselineRoot = join(root, 'contracts', 'baselines', 'v1.0');
const force = process.env.FORCE_BASELINE_REWRITE === '1';

function writeJson(relativePath: string, value: unknown): void {
  const absolute = join(baselineRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, stableStringify(value));
}

if (existsSync(join(baselineRoot, 'manifest.json')) && !force) {
  console.error(
    'baseline already exists at contracts/baselines/v1.0/; refusing to overwrite without FORCE_BASELINE_REWRITE=1',
  );
  process.exitCode = 1;
} else {
  const documents = loadCurrentSchemaDocuments();
  const operations = loadCurrentOperationRecords();
  const coreContracts = loadCoreContractManifestEntries();

  if (operations.length !== 200) {
    throw new Error(`expected 200 operations, got ${operations.length}`);
  }
  if (coreContracts.length !== 6) {
    throw new Error(`expected 6 core contracts, got ${coreContracts.length}`);
  }

  for (const document of documents) {
    writeJson(document.relativePath, document.schema);
  }

  writeJson('operations.index.json', {
    baselineId: 'v1.0',
    operationCount: operations.length,
    operations,
  });

  // fixtures.index.json is generated empty here and filled by the fixture
  // freeze step / check harness once historical fixtures are copied.
  const fixturesIndexPath = join(baselineRoot, 'fixtures.index.json');
  if (!existsSync(fixturesIndexPath) || force) {
    writeJson('fixtures.index.json', {
      baselineId: 'v1.0',
      fixtures: [],
    });
  }

  writeJson('manifest.json', {
    baselineId: 'v1.0',
    canonicalizationVersion: '1',
    registryVersion: '1.0',
    operationCount: operations.length,
    coreContractCount: coreContracts.length,
    schemaDocuments: documents.map((document) => document.relativePath),
    operations,
    coreContracts,
    manualReviewPolicy: {
      requireApprovalFor: [
        'AUTHORIZATION_METADATA_CHANGE',
        'DATA_CLASSIFICATION_CHANGE',
        'SEMANTIC_CHANGE_DECLARATION',
      ],
      defaultOnAmbiguous: 'FAIL',
    },
    approvals: [],
  });

  console.log(
    `baseline_generate=PASS baseline=v1.0 operations=${operations.length} core=${coreContracts.length} schemas=${documents.length}`,
  );
}
