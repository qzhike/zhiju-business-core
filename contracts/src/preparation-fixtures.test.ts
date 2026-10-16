import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractRegistry } from './registry.js';
import { operationPayloadSchemaRef, operationResultSchemaRef } from './schema-types.js';
import { assertPreparationCommand } from './preparation-transport.js';

interface FixtureEntry {
  file: string;
  operation: string;
  version: '1.0';
  mode: 'payload' | 'result' | 'command';
  valid: boolean;
}
interface FixtureManifest {
  provenance: 'SYNTHETIC_CONTRACT_FIXTURES_ONLY';
  fixtures: FixtureEntry[];
}
const directory = new URL('../../tests/fixtures/contracts/preparation/', import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('manifest.json', directory), 'utf8'),
) as FixtureManifest;
const registry = new ContractRegistry();
const registered = [
  'project.find_preparation_enterprises',
  'project.request_project_preparation',
  'project.get_project_preparation_request',
  'integration.request_customer_zip_intake',
  'integration.get_customer_zip_intake',
  'integration.restart_customer_zip_upload',
  'integration.CustomerZipManifestCommitted',
  'project.create_preparing_project',
  'project.capture_preparation_source',
  'project.get_preparation_source',
  'project.PreparingProjectCreated',
];
const browserOperations = registered.slice(0, 6);
function load(entry: FixtureEntry): unknown {
  return JSON.parse(readFileSync(new URL(entry.file, directory), 'utf8')) as unknown;
}

describe('#291 preparation standalone contract fixtures', () => {
  it('keeps every standalone fixture discoverable and labels all values synthetic', () => {
    expect(manifest.provenance).toBe('SYNTHETIC_CONTRACT_FIXTURES_ONLY');
    const present = readdirSync(directory)
      .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
      .sort();
    expect(manifest.fixtures.map((entry) => entry.file).sort()).toEqual(present);
    expect(new Set(manifest.fixtures.map((entry) => entry.file)).size).toBe(
      manifest.fixtures.length,
    );
  });
  it('covers all eleven registered owning operations and all six browser result contracts', () => {
    expect(
      manifest.fixtures
        .filter((entry) => entry.valid && entry.mode === 'payload')
        .map((entry) => entry.operation)
        .sort(),
    ).toEqual([...registered].sort());
    for (const operation of browserOperations) {
      expect(
        manifest.fixtures.some(
          (entry) => entry.operation === operation && entry.mode === 'result' && entry.valid,
        ),
        operation,
      ).toBe(true);
    }
    for (const operation of registered) {
      const metadata = registry.getOperation(operation, '1.0');
      expect(metadata?.schemaStatus, operation).toBe('FULL');
      if (!metadata) throw new Error('fixture operation is not registered');
      expect(operationPayloadSchemaRef(metadata)).toContain(
        `/modules/${metadata.owner}/1.0#/$defs/`,
      );
      if (metadata.kind !== 'EVENT')
        expect(operationResultSchemaRef(metadata), operation).toBeTypeOf('string');
    }
  });
  for (const entry of manifest.fixtures) {
    it(`${entry.valid ? 'accepts' : 'rejects'} ${entry.file}`, () => {
      const data = load(entry);
      if (entry.mode === 'command') {
        const validate = () => {
          assertPreparationCommand(
            data,
            entry.operation,
            'zhiju.project.preparation_request',
            'CREATE',
          );
        };
        if (entry.valid) expect(validate).not.toThrow();
        else expect(validate).toThrow();
        return;
      }
      const metadata = registry.getOperation(entry.operation, entry.version);
      if (!metadata) throw new Error('fixture operation is not registered');
      if (entry.mode === 'payload') {
        const schemaRef = operationPayloadSchemaRef(metadata);
        if (!schemaRef) throw new Error('fixture operation has no owning payload schema');
        const result = registry.validateCoreContract(schemaRef, data);
        expect(
          result.valid,
          JSON.stringify({ file: entry.file, schemaRef, errors: result.errors }),
        ).toBe(entry.valid);
      } else {
        const result = registry.validateOperationResult(entry.operation, entry.version, data);
        expect(result.valid, JSON.stringify({ file: entry.file, errors: result.errors })).toBe(
          entry.valid,
        );
      }
    });
  }
  it('validates the complete original public command restored by both request result operations', () => {
    for (const operation of [
      'project.request_project_preparation',
      'project.get_project_preparation_request',
    ]) {
      const entry = manifest.fixtures.find(
        (entry) => entry.operation === operation && entry.mode === 'result' && entry.valid,
      );
      if (!entry) throw new Error('missing original request fixture');
      const result = load(entry) as {
        originalCommand: unknown;
        originalKey: string;
        originalCommandId: string;
        payloadHash: unknown;
        scopeRef: unknown;
      };
      assertPreparationCommand(
        result.originalCommand,
        'project.request_project_preparation',
        'zhiju.project.preparation_request',
        'CREATE',
      );
      expect(result.originalKey).toBe(result.originalCommand.idempotencyKey);
      expect(result.originalCommandId).toBe(result.originalCommand.commandId);
      expect(result.payloadHash).toEqual(result.originalCommand.integrity.payloadHash);
      expect(result.scopeRef).toEqual(result.originalCommand.scopeRef);
    }
  });
});
