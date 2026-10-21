import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ciVerificationFailures, persistenceVerificationFailures } from './check-ci-results.mts';
import type { VerificationTarget } from './select-target.mts';

function completed(target: VerificationTarget = 'full') {
  return {
    select: { result: 'success', outputs: { target } },
    checks: { result: 'success', outputs: {} },
    persistence: { result: target === 'full' ? 'success' : 'skipped', outputs: {} },
  };
}

describe('required CI verification aggregation', () => {
  it.each(['docs', 'code', 'full'] as const)('accepts exactly the required %s jobs', (target) => {
    expect(ciVerificationFailures(completed(target), false)).toEqual([]);
  });
  for (const job of ['select', 'checks', 'persistence'] as const) {
    it.each(['failure', 'cancelled', 'skipped'])(
      'rejects full when ' + job + ' is %s',
      (result) => {
        const needs = completed();
        needs[job].result = result;
        expect(ciVerificationFailures(needs, false)).not.toEqual([]);
      },
    );
    it('rejects a missing ' + job + ' dependency', () => {
      const needs = Object.fromEntries(
        Object.entries(completed()).filter(([name]) => name !== job),
      );
      expect(ciVerificationFailures(needs, false)).not.toEqual([]);
    });
  }
  for (const target of ['docs', 'code'] as const) {
    it.each(['success', 'failure', 'cancelled'])(
      'rejects unexpected persistence %s for ' + target,
      (result) => {
        const needs = completed(target);
        needs.persistence.result = result;
        expect(ciVerificationFailures(needs, false)).not.toEqual([]);
      },
    );
    it.each(['failure', 'cancelled', 'skipped'])(
      'requires checks for ' + target + ' even when they are %s',
      (result) => {
        const needs = completed(target);
        needs.checks.result = result;
        expect(ciVerificationFailures(needs, false)).not.toEqual([]);
      },
    );
  }
  it.each([undefined, '', 'unknown'])('rejects target %s', (target) => {
    expect(
      ciVerificationFailures(
        { ...completed(), select: { result: 'success', outputs: { target } } },
        false,
      ),
    ).not.toEqual([]);
  });
  it.each([null, [], 'success', {}])('rejects malformed dependency data %j', (needs) => {
    expect(ciVerificationFailures(needs, false)).not.toEqual([]);
  });
  it.each(['docs', 'code', 'full'] as const)(
    'rejects a superseded %s workflow even if all selected jobs succeeded',
    (target) => {
      expect(ciVerificationFailures(completed(target), true)).not.toEqual([]);
    },
  );
  it('requires newly added dependencies to be explicitly included in aggregation', () => {
    expect(
      ciVerificationFailures({ ...completed(), extra: { result: 'failure' } }, false),
    ).not.toEqual([]);
  });
  it('rejects an unknown job result', () => {
    expect(
      ciVerificationFailures({ ...completed(), checks: { result: 'pending' } }, false),
    ).not.toEqual([]);
  });
  it.each([
    [JSON.stringify(completed()), 'false', 0],
    [JSON.stringify({ ...completed(), persistence: { result: 'skipped' } }), 'false', 1],
    ['invalid JSON', 'false', 1],
    [JSON.stringify(completed()), 'true', 1],
    [JSON.stringify(completed()), '', 1],
  ])(
    'enforces CLI exit status for dependency data and cancellation (case %#)',
    (needs, cancellation, expected) => {
      const result = spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          fileURLToPath(new URL('./check-ci-results.mts', import.meta.url)),
        ],
        {
          env: { ...process.env, NEEDS_JSON: needs, WORKFLOW_CANCELLED: cancellation },
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(expected);
    },
  );
});

describe('three independent persistence results', () => {
  const success = {
    select: { result: 'success', outputs: { target: 'full' } },
    'persistence-1': { result: 'success' },
    'persistence-2': { result: 'success' },
    'persistence-3': { result: 'success' },
  };
  it('requires all three named partitions and full selection', () => {
    expect(persistenceVerificationFailures(success, false)).toEqual([]);
    expect(persistenceVerificationFailures(success, true)).not.toEqual([]);
    expect(
      persistenceVerificationFailures({ ...success, extra: { result: 'success' } }, false),
    ).not.toEqual([]);
  });
  for (const name of Object.keys(success)) {
    it.each(['failure', 'cancelled', 'skipped', 'pending', '', undefined])(
      `rejects ${name} result %j`,
      (result) => {
        expect(
          persistenceVerificationFailures({ ...success, [name]: { result } }, false),
        ).not.toEqual([]);
      },
    );
    it(`rejects missing ${name}`, () => {
      expect(
        persistenceVerificationFailures(
          Object.fromEntries(Object.entries(success).filter(([key]) => key !== name)),
          false,
        ),
      ).not.toEqual([]);
    });
  }
  it.each(['docs', 'code', '', undefined])('rejects target %j', (target) => {
    expect(
      persistenceVerificationFailures(
        { ...success, select: { result: 'success', outputs: { target } } },
        false,
      ),
    ).not.toEqual([]);
  });
  it.each([null, [], 'success', {}])('rejects malformed dependencies %j', (needs) => {
    expect(persistenceVerificationFailures(needs, false)).not.toEqual([]);
  });
  it.each([
    [success, 'partitions', 'false', 0],
    [{ ...success, 'persistence-2': { result: 'skipped' } }, 'partitions', 'false', 1],
    [success, 'partitions', 'true', 1],
    [success, 'partitions', '', 1],
    [success, 'invalid', 'false', 1],
  ])('runs the partition aggregator CLI (case %#)', (needs, scope, cancelled, expected) => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        fileURLToPath(new URL('./check-ci-results.mts', import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          NEEDS_JSON: JSON.stringify(needs),
          WORKFLOW_CANCELLED: cancelled,
          VERIFICATION_SCOPE: scope,
        },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(expected);
  });
});
