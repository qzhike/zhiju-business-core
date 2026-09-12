import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  validateInitialContextExpiryBinding,
  type ContextExpiryBindingValidationInput,
} from './context-expiry-binding.js';
import type { TaskExecution } from './generated/types/index.js';
import { ContractRegistry } from './registry.js';

type JsonObject = Record<string, unknown>;

const registry = new ContractRegistry();

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(`../../tests/fixtures/contracts/context-build/${name}`, import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

function metadata(name: string): TaskExecution.InitialContextExpiryBinding {
  // Both members are optional, so a fixture object is already assignable.
  return fixture(name);
}

function bindingInput(name = 'expiry-binding-valid.json'): ContextExpiryBindingValidationInput {
  const recorded = metadata(name);
  return {
    request: { expiresAt: '2026-09-20T00:00:00Z' },
    workOrder: { expiresAt: '2026-10-01T00:00:00Z' },
    sourceSlices: [{ validUntil: '2026-11-01T00:00:00Z' }, { validUntil: '2026-12-01T00:00:00Z' }],
    builderPolicy: { supersededAt: '2027-01-01T00:00:00Z' },
    projectContext:
      recorded.effectiveExpiresAt === undefined ? {} : { expiresAt: recorded.effectiveExpiresAt },
    contextBuildMetadata: structuredClone(recorded),
    now: '2026-09-12T00:00:00Z',
  };
}

function mutate(
  input: ContextExpiryBindingValidationInput,
  path: string,
  value: unknown,
): ContextExpiryBindingValidationInput {
  const clone = structuredClone(input) as unknown as JsonObject;
  const segments = path.split('.');
  let current: JsonObject = clone;
  const last = segments.pop();
  if (last === undefined) throw new Error('mutation path is empty');
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || typeof next !== 'object') {
      throw new Error(`mutation path is not an object: ${segment}`);
    }
    current = next as JsonObject;
  }
  current[last] = value;
  return clone as unknown as ContextExpiryBindingValidationInput;
}

function codes(input: ContextExpiryBindingValidationInput): readonly string[] {
  return validateInitialContextExpiryBinding(input).errors.map((error) => error.code);
}

describe('WI-02 Initial Context expiry binding', () => {
  it('validates the metadata schema and accepts one explicit request expiry fixture', () => {
    expect(
      registry.validateInitialContextExpiryBindingMetadata(fixture('expiry-binding-valid.json')),
    ).toEqual({ valid: true, errors: [] });
    expect(registry.validateInitialContextExpiryBinding(bindingInput())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ['workOrder.expiresAt', '/workOrder/expiresAt'],
    ['sourceSlices.0.validUntil', '/sourceSlices/0/validUntil'],
    ['sourceSlices.1.validUntil', '/sourceSlices/1/validUntil'],
    ['builderPolicy.supersededAt', '/builderPolicy/supersededAt'],
  ] as const)(
    'rejects a request expiry later than the finite bound at %s instead of truncating it',
    (path, boundPath) => {
      const result = validateInitialContextExpiryBinding(
        mutate(bindingInput(), path, '2026-09-01T00:00:00Z'),
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors
          .filter((error) => error.code === 'EXPIRY_UPPER_BOUND_EXCEEDED')
          .map((error) => error.path),
      ).toEqual([boundPath]);
    },
  );

  it('accepts a request expiry that exactly equals the earliest finite bound', () => {
    const input = mutate(bindingInput(), 'request.expiresAt', '2026-10-01T00:00:00Z');
    expect(
      validateInitialContextExpiryBinding({
        ...input,
        contextBuildMetadata: {
          requestExpiresAt: '2026-10-01T00:00:00Z',
          effectiveExpiresAt: '2026-10-01T00:00:00Z',
        },
        projectContext: { expiresAt: '2026-10-01T00:00:00Z' },
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it('preserves sub-second precision when comparing a request expiry with a bound', () => {
    const justAfter = mutate(
      mutate(bindingInput(), 'workOrder.expiresAt', '2026-10-01T00:00:00Z'),
      'request.expiresAt',
      '2026-10-01T00:00:00.000900Z',
    );
    expect(codes(justAfter)).toContain('EXPIRY_UPPER_BOUND_EXCEEDED');

    const justBefore = mutate(
      mutate(bindingInput(), 'workOrder.expiresAt', '2026-10-01T00:00:00.000900Z'),
      'request.expiresAt',
      '2026-10-01T00:00:00.000100Z',
    );
    expect(
      validateInitialContextExpiryBinding({
        ...justBefore,
        contextBuildMetadata: {
          requestExpiresAt: '2026-10-01T00:00:00.000100Z',
          effectiveExpiresAt: '2026-10-01T00:00:00.000100Z',
        },
        projectContext: { expiresAt: '2026-10-01T00:00:00.000100Z' },
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it('resolves an absent request expiry to the earliest finite bound', () => {
    const openEnded = metadata('expiry-binding-open-ended.json');
    expect(registry.validateInitialContextExpiryBindingMetadata(openEnded)).toEqual({
      valid: true,
      errors: [],
    });
    if (openEnded.effectiveExpiresAt === undefined) throw new Error('fixture is not finite');
    expect(
      validateInitialContextExpiryBinding({
        ...bindingInput(),
        request: {},
        contextBuildMetadata: structuredClone(openEnded),
        projectContext: { expiresAt: openEnded.effectiveExpiresAt },
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects a silently truncated effective expiry instead of accepting the minimum', () => {
    const truncated = mutate(
      mutate(bindingInput(), 'request.expiresAt', '2026-11-15T00:00:00Z'),
      'contextBuildMetadata.effectiveExpiresAt',
      '2026-10-01T00:00:00Z',
    );
    expect(codes(truncated)).toContain('EXPIRY_UPPER_BOUND_EXCEEDED');
    expect(codes(truncated)).toContain('EXPIRY_EFFECTIVE_MISMATCH');

    const dropped = mutate(bindingInput(), 'contextBuildMetadata.effectiveExpiresAt', undefined);
    expect(codes(dropped)).toEqual(['EXPIRY_EFFECTIVE_MISMATCH']);
  });

  it.each([
    ['contextBuildMetadata.requestExpiresAt', undefined],
    ['contextBuildMetadata.requestExpiresAt', '2026-09-25T00:00:00Z'],
  ] as const)('requires the metadata to record %s verbatim', (path, value) => {
    const result = validateInitialContextExpiryBinding(mutate(bindingInput(), path, value));
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(['EXPIRY_OBSERVATION_MISMATCH']);
    expect(result.errors[0]?.path).toBe('/contextBuildMetadata/requestExpiresAt');
  });

  it('keeps the effective expiry in the ProjectContext Snapshot payload', () => {
    const rewritten = validateInitialContextExpiryBinding(
      mutate(bindingInput(), 'projectContext.expiresAt', '2026-09-25T00:00:00Z'),
    );
    expect(rewritten.valid).toBe(false);
    expect(rewritten.errors.map((error) => error.code)).toEqual(['CONTEXT_EXPIRY_MISMATCH']);

    const dropped = validateInitialContextExpiryBinding(
      mutate(bindingInput(), 'projectContext.expiresAt', undefined),
    );
    expect(dropped.valid).toBe(false);
    expect(dropped.errors.map((error) => error.code)).toEqual(['CONTEXT_EXPIRY_MISMATCH']);
  });

  it.each(['2026-09-20T00:00:00Z', '2026-09-20T00:00:00.000900Z'] as const)(
    'rejects consumption at %s using trusted server time',
    (now) => {
      expect(codes({ ...bindingInput(), now })).toContain('CONTEXT_EXPIRED');
    },
  );

  it('keeps the Context usable strictly before its effective expiry', () => {
    expect(
      validateInitialContextExpiryBinding({
        ...bindingInput(),
        now: '2026-09-19T23:59:59.999999Z',
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects an invalid consumption time rather than treating it as unexpired', () => {
    expect(codes({ ...bindingInput(), now: 'not-an-instant' })).toContain(
      'INVALID_CONSUMPTION_TIME',
    );
  });

  it.each([
    ['workOrder.expiresAt', '/workOrder/expiresAt'],
    ['sourceSlices.0.validUntil', '/sourceSlices/0/validUntil'],
    ['builderPolicy.supersededAt', '/builderPolicy/supersededAt'],
  ] as const)(
    'rejects a calendar-invalid bound at %s instead of normalizing it',
    (path, errorPath) => {
      const result = validateInitialContextExpiryBinding(
        mutate(bindingInput(), path, '2026-02-30T00:00:00Z'),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.path)).toEqual([errorPath]);
      expect(result.errors.map((error) => error.code)).toEqual(['INVALID_EXPIRY_INPUT']);
    },
  );

  it('rejects the reported non-existent request expiry across every position', () => {
    const nonExistent = '2026-02-30T00:00:00Z';
    const input = mutate(bindingInput(), 'request.expiresAt', nonExistent);
    const result = registry.validateInitialContextExpiryBinding({
      ...input,
      contextBuildMetadata: {
        requestExpiresAt: nonExistent,
        effectiveExpiresAt: nonExistent,
      },
      projectContext: { expiresAt: nonExistent },
      now: '2026-02-01T00:00:00Z',
    });
    expect(result.valid).toBe(false);
    const paths = result.errors.map((error) => error.path);
    expect(paths).toContain('/request/expiresAt');
    expect(paths).toContain('/contextBuildMetadata/requestExpiresAt');
    expect(paths).toContain('/projectContext/expiresAt');
  });

  it('accepts a real leap day and rejects a non-leap February 29', () => {
    const leapDay = '2024-02-29T00:00:00Z';
    const leapInput = {
      ...mutate(bindingInput(), 'request.expiresAt', leapDay),
      contextBuildMetadata: { requestExpiresAt: leapDay, effectiveExpiresAt: leapDay },
      projectContext: { expiresAt: leapDay },
      now: '2024-02-01T00:00:00Z',
    };
    expect(validateInitialContextExpiryBinding(leapInput)).toEqual({ valid: true, errors: [] });

    expect(codes(mutate(bindingInput(), 'request.expiresAt', '2026-02-29T00:00:00Z'))).toContain(
      'INVALID_EXPIRY_INPUT',
    );
  });

  it.each([
    ['contextBuildMetadata', undefined, 'MISSING_EXPIRY_BINDING'],
    ['contextBuildMetadata', null, 'INVALID_EXPIRY_BINDING'],
    ['contextBuildMetadata.requestExpiresAt', null, 'INVALID_EXPIRY_BINDING'],
    ['request.expiresAt', null, 'INVALID_EXPIRY_INPUT'],
    ['workOrder.expiresAt', 'tomorrow', 'INVALID_EXPIRY_INPUT'],
    ['builderPolicy.supersededAt', 0, 'INVALID_EXPIRY_INPUT'],
    ['projectContext.expiresAt', null, 'INVALID_EXPIRY_INPUT'],
    ['sourceSlices.0.validUntil', null, 'INVALID_EXPIRY_INPUT'],
    ['sourceSlices', [], 'INVALID_EXPIRY_INPUT'],
  ] as const)('fails closed for invalid %s', (path, value, code) => {
    expect(codes(mutate(bindingInput(), path, value))).toContain(code);
  });

  it('leaves the effective expiry absent when no finite upper bound was observed', () => {
    const withoutBounds: ContextExpiryBindingValidationInput = {
      request: {},
      workOrder: {},
      sourceSlices: [{}, {}],
      builderPolicy: {},
      projectContext: {},
      contextBuildMetadata: {},
      now: '2026-09-12T00:00:00Z',
    };
    expect(registry.validateInitialContextExpiryBindingMetadata({})).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateInitialContextExpiryBinding(withoutBounds)).toEqual({ valid: true, errors: [] });
    expect(
      codes({ ...withoutBounds, projectContext: { expiresAt: '2026-12-01T00:00:00Z' } }),
    ).toEqual(['CONTEXT_EXPIRY_MISMATCH']);
  });

  it('is reusable at candidate assembly, Validator, and Freeze checkpoints', () => {
    for (const checkpoint of ['candidate assembly', 'Validator', 'Freeze']) {
      expect(validateInitialContextExpiryBinding(bindingInput()), checkpoint).toEqual({
        valid: true,
        errors: [],
      });
    }
  });
});
