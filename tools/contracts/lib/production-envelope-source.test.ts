import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { operationEnvelopeSchema } from '../../../contracts/src/envelopes.schema.ts';
import { publicApiOperations } from '../../../contracts/src/generated/public-api.ts';
import { operationPayloadSchemaRef } from '../../../contracts/src/schema-types.ts';

import {
  envelopeSchemaRelativePath,
  loadCurrentEnvelopeDocuments,
} from './load-contract-schemas.ts';
import { compareSchemaDocuments, failingFindings } from './schema-compatibility.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baselineRoot = join(repositoryRoot, 'contracts', 'baselines', 'v1.0');

describe('production envelope builder is the Gate source of truth', () => {
  it('loads current envelopes from contracts/src/envelopes.schema.ts, not a hand copy', () => {
    const source = readFileSync(
      join(repositoryRoot, 'tools/contracts/lib/load-contract-schemas.ts'),
      'utf8',
    );
    expect(source).toMatch(/from ['"].*contracts\/src\/envelopes\.schema\.ts['"]/);
    expect(source).not.toMatch(/live-envelopes/);
  });

  it('keeps envelope payload $ref parity with schema-types for all 266 operations', () => {
    for (const operation of publicApiOperations) {
      const envelope = operationEnvelopeSchema(operation) as {
        readonly properties?: {
          readonly payload?: { readonly $ref?: string; readonly type?: string };
        };
      };
      const expected = operationPayloadSchemaRef(operation);
      if (expected === undefined) {
        expect(envelope.properties?.payload).toEqual({ type: 'object' });
      } else {
        expect(envelope.properties?.payload).toEqual({ $ref: expected });
      }
    }
  });

  it('makes loadCurrentEnvelopeDocuments identical to production operationEnvelopeSchema', () => {
    const documents = loadCurrentEnvelopeDocuments();
    expect(documents).toHaveLength(266);

    for (const operation of publicApiOperations) {
      const relativePath = envelopeSchemaRelativePath(operation.type, operation.version);
      const document = documents.find((entry) => entry.relativePath === relativePath);
      expect(document).toBeDefined();
      expect(document?.schema).toEqual(operationEnvelopeSchema(operation));
    }
  });

  it('fails compatibility when the production envelope builder output narrows versus the frozen baseline', () => {
    const type = 'execution.RunTerminated';
    const operation = publicApiOperations.find((entry) => entry.type === type);
    expect(operation).toBeDefined();
    if (operation === undefined) return;

    const baselineEnvelope = JSON.parse(
      readFileSync(join(baselineRoot, envelopeSchemaRelativePath(type)), 'utf8'),
    ) as Record<string, unknown>;

    const productionEnvelope = structuredClone(
      operationEnvelopeSchema(operation) as Record<string, unknown>,
    );

    // Equal before mutation — Gate source matches frozen baseline for this event.
    expect(
      failingFindings(compareSchemaDocuments(baselineEnvelope, productionEnvelope, 't')),
    ).toEqual([]);

    // Simulate a production-only envelope narrowing (as if envelopes.schema.ts changed).
    const required = Array.isArray(productionEnvelope.required)
      ? [...productionEnvelope.required]
      : [];
    required.push('compatibilityProbeEnvelopeField');
    productionEnvelope.required = required;
    const properties =
      productionEnvelope.properties !== null &&
      typeof productionEnvelope.properties === 'object' &&
      !Array.isArray(productionEnvelope.properties)
        ? { ...(productionEnvelope.properties as Record<string, unknown>) }
        : {};
    properties.compatibilityProbeEnvelopeField = { type: 'string' };
    productionEnvelope.properties = properties;

    const findings = failingFindings(
      compareSchemaDocuments(
        baselineEnvelope,
        productionEnvelope,
        `envelope=${envelopeSchemaRelativePath(type)}`,
      ),
    );
    expect(findings.some((finding) => finding.keyword === 'required-added')).toBe(true);
  });
});
