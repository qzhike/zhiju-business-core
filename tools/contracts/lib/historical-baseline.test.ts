import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HistoricalBaselineRegistry } from './historical-baseline.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function loadFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8')) as unknown;
}

describe('historical baseline event schema validation', () => {
  const historicalRegistry = new HistoricalBaselineRegistry();

  it('validates historical Event fixtures against frozen v1.0 baseline schemas', () => {
    const events = [
      {
        type: 'execution.RunTerminated',
        version: '1.0',
        path: 'tests/fixtures/contracts/compatibility/v1.0/positive/execution-run-terminated-event.json',
      },
      {
        type: 'quality.EvidenceVerified',
        version: '1.0',
        path: 'tests/fixtures/contracts/compatibility/v1.0/positive/quality-evidence-verified-event.json',
      },
    ] as const;

    for (const event of events) {
      const result = historicalRegistry.validateOperation(
        event.type,
        event.version,
        loadFixture(event.path),
      );
      expect({
        type: event.type,
        valid: result.valid,
        schemaSource: result.schemaSource,
      }).toEqual({
        type: event.type,
        valid: true,
        schemaSource: 'baseline-v1.0',
      });
    }
  });

  it('selects frozen historical Event schemas independently of a mutated schema graph', () => {
    const type = 'execution.RunTerminated';
    const version = '1.0';
    const payload = loadFixture(
      'tests/fixtures/contracts/compatibility/v1.0/positive/execution-run-terminated-event.json',
    );

    const historical = historicalRegistry.validateOperation(type, version, payload);
    expect(historical.valid).toBe(true);
    expect(historical.schemaSource).toBe('baseline-v1.0');

    const mutated = historicalRegistry.validateWithMutatedPayloadSchema({
      type,
      version,
      input: payload,
      mutate: (payloadSchema) => {
        const required = Array.isArray(payloadSchema.required) ? [...payloadSchema.required] : [];
        required.push('compatibilityProbeRequiredField');
        payloadSchema.required = required;
        const properties =
          payloadSchema.properties !== null &&
          typeof payloadSchema.properties === 'object' &&
          !Array.isArray(payloadSchema.properties)
            ? { ...(payloadSchema.properties as Record<string, unknown>) }
            : {};
        properties.compatibilityProbeRequiredField = { type: 'string' };
        payloadSchema.properties = properties;
      },
    });
    expect(mutated.valid).toBe(false);

    const historicalAgain = historicalRegistry.validateOperation(type, version, payload);
    expect(historicalAgain.valid).toBe(true);
  });

  it('rejects unknown majors against the frozen operation index', () => {
    const payload = loadFixture(
      'tests/fixtures/contracts/compatibility/v1.0/negative/command-unknown-major.json',
    );
    const result = historicalRegistry.validateOperation(
      'identity.register_principal',
      '2.0',
      payload,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.keyword).toBe('operationRegistry');
  });
});
