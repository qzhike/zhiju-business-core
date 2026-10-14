import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

interface GitHubContext {
  workflow: string;
  event_name: string;
  event: { pull_request?: { number: number } };
  run_id: number;
  sha: string;
}

function concurrencyValue(key: string): string {
  const block = /^concurrency:\n((?:[ \t].*\n|\n)*)/mu.exec(workflow)?.[1];
  const value = new RegExp(`^  ${key}: (.+)$`, 'mu').exec(block ?? '')?.[1];
  if (!value) throw new Error(`Missing workflow concurrency setting: ${key}`);
  return value;
}

// Evaluate only the expressions used by this concurrency contract.
// Unsupported syntax fails instead of guessing GitHub service behavior.
function expression(source: string, github: GitHubContext): unknown {
  const text = source.trim();
  if (text.includes('||')) {
    const [left, right, ...extra] = text.split('||');
    if (left === undefined || right === undefined || extra.length) throw new Error(text);
    const value = expression(left, github);
    if (value) return value;
    return expression(right, github);
  }
  if (text.includes('==')) {
    const [left, right, ...extra] = text.split('==');
    if (left === undefined || right === undefined || extra.length) throw new Error(text);
    return expression(left, github) === expression(right, github);
  }
  if (/^'[^']*'$/u.test(text)) return text.slice(1, -1);
  if (!/^github(?:\.[a-z_]+)+$/u.test(text)) throw new Error(text);
  return text
    .split('.')
    .slice(1)
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      github,
    );
}

function settings(github: GitHubContext) {
  const group = concurrencyValue('group').replace(/\$\{\{(.*?)\}\}/gu, (_, source: string) =>
    String(expression(source, github)),
  );
  const cancellation = /^\$\{\{(.*?)\}\}$/u.exec(concurrencyValue('cancel-in-progress'))?.[1];
  if (!cancellation) throw new Error('Cancellation must be an explicit event condition');
  return { group, cancel: expression(cancellation, github) };
}

function pr(number: number, runId: number, sha: string): GitHubContext {
  return {
    workflow: 'ci',
    event_name: 'pull_request',
    event: { pull_request: { number } },
    run_id: runId,
    sha,
  };
}

describe('CI workflow concurrency', () => {
  it('cancels superseded runs for the same PR despite a new commit and run id', () => {
    const old = settings(pr(294, 101, 'old-commit'));
    const current = settings(pr(294, 102, 'new-commit'));
    expect(old.group).toBe(current.group);
    expect(old.cancel).toBe(true);
    expect(current.cancel).toBe(true);
  });

  it('does not cancel another PR or another workflow', () => {
    const current = settings(pr(294, 101, 'commit'));
    expect(current.group).not.toBe(settings(pr(295, 102, 'commit')).group);
    expect(current.group).not.toBe(
      settings({ ...pr(294, 103, 'commit'), workflow: 'other' }).group,
    );
  });

  it.each(['push', 'workflow_dispatch'])(
    'keeps every %s run independent and disables cancellation',
    (eventName) => {
      const context = { ...pr(294, 101, 'commit'), event_name: eventName, event: {} };
      const first = settings(context);
      const second = settings({ ...context, run_id: 102 });
      expect(first.group).not.toBe(second.group);
      expect(first.group).not.toBe(settings(pr(101, 101, 'commit')).group);
      expect(first.cancel).toBe(false);
      expect(second.cancel).toBe(false);
    },
  );
});
