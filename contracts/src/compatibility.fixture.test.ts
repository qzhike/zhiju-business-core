import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canonicalize, hashContractPayload } from '@zhiju/shared-kernel';
import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';

interface CompatibilityFixtureEntry {
  readonly id: string;
  readonly path: string;
  readonly source: string;
  readonly sha256: string;
  readonly polarity: 'positive' | 'negative';
  readonly validation: 'operation' | 'operationResult' | 'core' | 'unknownMajor';
  readonly owner: string;
  readonly type?: string;
  readonly version?: string;
  readonly schemaId?: string;
  readonly expect: 'valid' | 'invalid';
}

interface CanonicalHashExpectation {
  readonly path: string;
  readonly algorithm: string;
  readonly canonicalizationVersion: string;
  readonly digest: string;
  readonly mode: 'hashContractPayload' | 'sha256CanonicalJson';
}

interface FixturesIndex {
  readonly baselineId: string;
  readonly fixtures: readonly CompatibilityFixtureEntry[];
  readonly canonicalHashes: readonly CanonicalHashExpectation[];
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const fixturesIndex = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'contracts/baselines/v1.0/fixtures.index.json'), 'utf8'),
) as FixturesIndex;

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8')) as unknown;
}

function sha256File(relativePath: string): string {
  const bytes = readFileSync(resolve(repositoryRoot, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

function requireField(value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`fixture missing ${label}`);
  }
  return value;
}

function validateFixture(registry: ContractRegistry, fixture: CompatibilityFixtureEntry): boolean {
  const payload = loadJson(fixture.path);
  switch (fixture.validation) {
    case 'operation':
      return registry.validateOperation(
        requireField(fixture.type, 'type'),
        requireField(fixture.version, 'version'),
        payload,
      ).valid;
    case 'operationResult':
      return registry.validateOperationResult(
        requireField(fixture.type, 'type'),
        requireField(fixture.version, 'version'),
        payload,
      ).valid;
    case 'core':
      return registry.validateCoreContract(requireField(fixture.schemaId, 'schemaId'), payload)
        .valid;
    case 'unknownMajor':
      return registry.validateOperation(
        requireField(fixture.type, 'type'),
        requireField(fixture.version, 'version'),
        payload,
      ).valid;
  }
}

describe('v1.0 compatibility historical fixtures', () => {
  const registry = new ContractRegistry();

  it('indexes at least one positive and one negative fixture per owner module plus six core contracts', () => {
    const owners = new Set(
      fixturesIndex.fixtures
        .filter((fixture) => fixture.owner !== 'registry' && fixture.owner !== 'core')
        .map((fixture) => fixture.owner),
    );
    expect(owners.size).toBe(7);
    for (const owner of owners) {
      expect(
        fixturesIndex.fixtures.some(
          (fixture) => fixture.owner === owner && fixture.polarity === 'positive',
        ),
      ).toBe(true);
      expect(
        fixturesIndex.fixtures.some(
          (fixture) => fixture.owner === owner && fixture.polarity === 'negative',
        ),
      ).toBe(true);
    }
    const corePositives = fixturesIndex.fixtures.filter(
      (fixture) => fixture.validation === 'core' && fixture.polarity === 'positive',
    );
    expect(corePositives).toHaveLength(6);
  });

  it('keeps frozen fixture bytes stable against recorded sha256', () => {
    for (const fixture of fixturesIndex.fixtures) {
      expect(sha256File(fixture.path)).toBe(fixture.sha256);
      expect(sha256File(fixture.source)).toBe(fixture.sha256);
    }
  });

  it('validates every indexed historical fixture with the expected polarity', () => {
    for (const fixture of fixturesIndex.fixtures) {
      expect({ id: fixture.id, valid: validateFixture(registry, fixture) }).toEqual({
        id: fixture.id,
        valid: fixture.expect === 'valid',
      });
    }
  });

  it('rejects unknown Major versions via the registry', () => {
    const fixture = fixturesIndex.fixtures.find((entry) => entry.validation === 'unknownMajor');
    expect(fixture).toBeDefined();
    if (fixture === undefined) return;

    const result = registry.validateOperation(
      requireField(fixture.type, 'type'),
      requireField(fixture.version, 'version'),
      loadJson(fixture.path),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('operationRegistry');
  });

  it('keeps Canonical JSON / Hash digests stable for frozen historical payloads', () => {
    expect(fixturesIndex.canonicalHashes.length).toBeGreaterThan(0);
    for (const expected of fixturesIndex.canonicalHashes) {
      const payload = loadJson(expected.path);
      const digest =
        expected.mode === 'hashContractPayload'
          ? hashContractPayload(payload as never)
          : createHash('sha256')
              .update(canonicalize(payload as never), 'utf8')
              .digest('hex');
      expect({ path: expected.path, digest }).toEqual({
        path: expected.path,
        digest: expected.digest,
      });
      expect(expected.algorithm).toBe('SHA-256');
      expect(expected.canonicalizationVersion).toBe('1');
    }
  });

  it('still accepts historical positive payloads under the current Schema', () => {
    // Structural optional additive Minor is covered by schema-compatibility unit tests.
    // Here we prove the frozen historical WorkOrder payload remains valid under current Schema.
    const workOrder = fixturesIndex.fixtures.find((fixture) =>
      fixture.path.endsWith('positive/core/work-order.json'),
    );
    expect(workOrder).toBeDefined();
    if (workOrder === undefined) return;

    const result = registry.validateCoreContract(
      requireField(workOrder.schemaId, 'schemaId'),
      loadJson(workOrder.path),
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
