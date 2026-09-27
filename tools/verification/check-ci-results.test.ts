import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ciVerificationFailures } from './check-ci-results.mts';
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
  it('rejects workflow cancellation even if all dependencies report success', () => {
    expect(ciVerificationFailures(completed(), true)).not.toEqual([]);
  });
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
