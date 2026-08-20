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

  it('keeps historical Event validation on frozen envelopes when a mutated envelope rejects the payload', () => {
    const type = 'execution.RunTerminated';
    const version = '1.0';
    const payload = loadFixture(
      'tests/fixtures/contracts/compatibility/v1.0/positive/execution-run-terminated-event.json',
    );

    const historical = historicalRegistry.validateOperation(type, version, payload);
    expect(historical.valid).toBe(true);
    expect(historical.schemaSource).toBe('baseline-v1.0');

    const mutatedEnvelope = historicalRegistry.validateWithMutatedFrozenEnvelope({
      type,
      version,
      input: payload,
      mutate: (envelopeSchema) => {
        const required = Array.isArray(envelopeSchema.required) ? [...envelopeSchema.required] : [];
        required.push('compatibilityProbeEnvelopeField');
        envelopeSchema.required = required;
        const properties =
          envelopeSchema.properties !== null &&
          typeof envelopeSchema.properties === 'object' &&
          !Array.isArray(envelopeSchema.properties)
            ? { ...(envelopeSchema.properties as Record<string, unknown>) }
            : {};
        properties.compatibilityProbeEnvelopeField = { type: 'string' };
        envelopeSchema.properties = properties;
      },
    });
    expect(mutatedEnvelope.valid).toBe(false);

    const historicalAgain = historicalRegistry.validateOperation(type, version, payload);
    expect(historicalAgain.valid).toBe(true);
  });

  it('keeps historical Event validation on frozen module payloads when a mutated payload def rejects', () => {
    const type = 'execution.RunTerminated';
    const version = '1.0';
    const payload = loadFixture(
      'tests/fixtures/contracts/compatibility/v1.0/positive/execution-run-terminated-event.json',
    );

    const mutatedPayload = historicalRegistry.validateWithMutatedPayloadSchema({
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
    expect(mutatedPayload.valid).toBe(false);

    const historical = historicalRegistry.validateOperation(type, version, payload);
    expect(historical.valid).toBe(true);
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

  it('does not import any live envelope builder; only frozen envelope JSON', () => {
    const source = readFileSync(
      join(repositoryRoot, 'tools/contracts/lib/historical-baseline.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"].*envelopes\.schema/);
    expect(source).not.toMatch(/from ['"].*live-envelopes/);
    expect(source).not.toMatch(/import\s*\{[^}]*operationEnvelopeSchema/);
  });
});
