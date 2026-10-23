import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentBoundaryFailures,
  eventPullRequest,
  githubRead,
  independentPushPullRequest,
  isBatchBranch,
  type PullRequestBoundary,
} from './delivery-context.mts';
import { deliveryAdmissionFailures } from './check-delivery.mts';
import { readChangedPaths, selectVerificationTarget } from './select-target.mts';

const repository = 'qzhike/zhiju-business-core';
const base = 'a'.repeat(40),
  head = 'b'.repeat(40),
  merge = 'c'.repeat(40);
const boundary: PullRequestBoundary = {
  number: 42,
  baseRef: 'batch/document-intake',
  baseSha: base,
  baseRepository: repository,
  headRef: 'feat/upload',
  headSha: head,
  headRepository: repository,
};
function payload(b = boundary) {
  return {
    number: b.number,
    state: 'open',
    merge_commit_sha: merge,
    base: { ref: b.baseRef, sha: b.baseSha, repo: { full_name: b.baseRepository } },
    head: { ref: b.headRef, sha: b.headSha, repo: { full_name: b.headRepository } },
  };
}
function context(b = boundary, enabled = true) {
  return {
    eventName: 'pull_request',
    isDraftPullRequest: false,
    batchDeliveryEnabled: enabled,
    pullRequest: b,
  };
}
const business = ['modules/identity-policy/src/authorization.ts'];
const final = { ...boundary, baseRef: 'main', headRef: 'batch/document-intake' };
const direct = { ...boundary, baseRef: 'main' };

describe('phase-one delivery boundaries', () => {
  it('keeps the original full route before explicit activation', () => {
    expect(selectVerificationTarget(business, context(boundary, false)).target).toBe('full');
    expect(selectVerificationTarget(business, context()).target).toBe('code');
  });
  it.each([
    'modules/identity-policy/src/authorization.ts',
    'modules/task-execution/src/persistence/task-repository.ts',
    'apps/workspace-web/src/TrustedApp.tsx',
    'contracts/src/registry.ts',
    'migrations/task_execution/V3004__context_snapshot.sql',
    'tests/persistence/scope.test.ts',
    'tests/business/source-material-validation.test.ts',
    'tests/fixtures/contracts/scope/negative-cases.json',
  ])('allows declared batch business work at %s to defer full', (path) => {
    expect(selectVerificationTarget([path], context()).target).toBe('code');
  });
  it.each([
    '.github/workflows/ci.yml',
    'tools/verification/select-target.mts',
    'tools/persistence/gate.mjs',
    'AGENTS.md',
    '.vibe/project.yaml',
    'pnpm-lock.yaml',
    'apps/workspace-web/package.json',
    'apps/workspace-web/src/tsconfig.json',
    'tests/workspace/playwright.config.ts',
    'tests/persistence/vitest.config.ts',
    'tests/business/persistence-case-inventory.test.ts',
    'tests/business/pinned-baseline.test.ts',
    'tests/business/migration-isolation.test.ts',
    'tests/business/workspace-boundaries.test.ts',
    'unclassified.txt',
    ' modules/identity-policy/src/auth.ts',
    String.raw`modules\identity-policy\src\auth.ts`,
    'modules/x/src/../config.ts',
  ])('retains full for engineering or unknown path %s', (path) => {
    expect(selectVerificationTarget([...business, path], context()).target).toBe('full');
  });
  it('always runs full for the cumulative batch final, including docs and UI', () => {
    for (const paths of [['README.md'], ['apps/workspace-web/src/style.css'], business])
      expect(selectVerificationTarget(paths, context(final)).target).toBe('full');
  });
  it('rejects direct business main delivery even after full, for both new and legacy UI', () => {
    for (const paths of [business, ['apps/workspace-web/src/style.css']]) {
      expect(deliveryAdmissionFailures(paths, context(direct), 'full', 'success', true)).toContain(
        'business delivery to main must originate from a same-repository batch',
      );
    }
  });
  it('permits only the strict independent documentation exception', () => {
    expect(
      deliveryAdmissionFailures(['README.md'], context(direct), 'docs', 'success', true),
    ).toEqual([]);
    expect(
      deliveryAdmissionFailures(['README.md'], context(final), 'docs', 'success', true),
    ).not.toEqual([]);
    expect(
      deliveryAdmissionFailures(
        ['README.md', ...business],
        context(direct),
        'full',
        'success',
        true,
      ),
    ).not.toEqual([]);
  });
  it.each(['batch/', 'batch/../main', 'batch/UPPER', 'batch/a/b', ' batch/a', 'batch/a '])(
    'does not infer batch qualification from %j',
    (ref) => {
      expect(isBatchBranch(ref)).toBe(false);
      const b = { ...boundary, baseRef: ref };
      expect(selectVerificationTarget(business, context(b)).target).toBe('full');
      expect(deliveryAdmissionFailures(business, context(b), 'full', 'success', false)).not.toEqual(
        [],
      );
    },
  );
  it('denies fork integration and fork batch-to-main delivery', () => {
    for (const b of [boundary, final]) {
      const c = context({ ...b, headRepository: 'other/fork' });
      expect(selectVerificationTarget(business, c).target).toBe('full');
      expect(
        deliveryAdmissionFailures(business, c, 'full', 'success', b.baseRef === 'main'),
      ).not.toEqual([]);
    }
  });
  it('cannot promote a child code success by retargeting its unchanged head', () => {
    expect(deliveryAdmissionFailures(business, context(), 'code', 'success', false)).toEqual([]);
    expect(
      deliveryAdmissionFailures(business, context(direct), 'code', 'success', true),
    ).not.toEqual([]);
  });
  it.each(['failure', 'cancelled', 'skipped', 'neutral', '', 'pending'])(
    'rejects required verification result %j',
    (result) => {
      expect(deliveryAdmissionFailures(business, context(final), 'full', result, true)).not.toEqual(
        [],
      );
    },
  );
  it('falls back to full for unknown events and unavailable stage context', () => {
    for (const eventName of ['workflow_dispatch', 'merge_group', ''])
      expect(selectVerificationTarget(['README.md'], { ...context(), eventName }).target).toBe(
        'full',
      );
    expect(
      selectVerificationTarget(business, {
        eventName: 'pull_request',
        isDraftPullRequest: false,
        batchDeliveryEnabled: true,
      }).target,
    ).toBe('full');
  });
  it('retains main full for a batch regardless of identical content or docs-only changes', () => {
    const push = { eventName: 'push', isDraftPullRequest: false, batchDeliveryEnabled: true };
    expect(selectVerificationTarget(['README.md'], push).target).toBe('full');
    expect(
      selectVerificationTarget(business, { ...push, independentDocumentationPush: true }).target,
    ).toBe('full');
    expect(
      selectVerificationTarget(['README.md'], { ...push, independentDocumentationPush: true })
        .target,
    ).toBe('docs');
  });
});

describe('authoritative candidate metadata', () => {
  it('validates repository, PR number and exact revision identities', () => {
    const event = { repository: { full_name: repository }, number: 42, pull_request: payload() };
    expect(eventPullRequest(event, repository)).toEqual(boundary);
    expect(eventPullRequest({ ...event, number: 43 }, repository)).toBeUndefined();
    expect(eventPullRequest(event, 'other/repo')).toBeUndefined();
    expect(
      eventPullRequest(
        { ...event, pull_request: payload({ ...boundary, headSha: 'HEAD' }) },
        repository,
      ),
    ).toBeUndefined();
  });
  it.each(['baseRef', 'baseSha', 'headRef', 'headSha', 'headRepository', 'number'] as const)(
    'invalidates evidence after %s changes',
    (key) => {
      const current = { ...boundary };
      if (key === 'number') current.number++;
      else current[key] = key.endsWith('Sha') ? 'd'.repeat(40) : `${current[key]}-changed`;
      expect(currentBoundaryFailures(boundary, payload(current), merge)).not.toEqual([]);
    },
  );
  it('requires the current open PR and exact checkout merge SHA', () => {
    expect(currentBoundaryFailures(boundary, payload(), merge)).toEqual([]);
    expect(currentBoundaryFailures(boundary, { ...payload(), state: 'closed' }, merge)).not.toEqual(
      [],
    );
    expect(currentBoundaryFailures(boundary, payload(), head)).not.toEqual([]);
    expect(currentBoundaryFailures(boundary, {}, merge)).not.toEqual([]);
  });
  it('accepts only one exact merged independent PR as main docs provenance', () => {
    const merged = { ...payload(direct), state: 'closed', merged_at: '2026-10-22T00:00:00Z' };
    expect(independentPushPullRequest([merged], repository, merge)).toEqual(direct);
    for (const values of [
      [],
      [merged, merged],
      Array.from({ length: 100 }, () => merged),
      [payload(direct)],
      [{ ...merged, merge_commit_sha: head }],
      [{ ...merged, head: payload(final).head }],
    ])
      expect(independentPushPullRequest(values, repository, merge)).toBeUndefined();
  });
});

describe('read-only metadata failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('does not issue a request without credentials', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(githubRead('/repos/example/repo/pulls/1')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects API errors and redirects without exposing tokens', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-only-token');
    vi.stubEnv('GITHUB_API_URL', 'https://api.github.com');
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    await expect(githubRead('/repos/example/repo/pulls/1')).rejects.toThrow('503');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });
});

describe('main-only workflow isolation', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const main = readFileSync(
    new URL('../../.github/workflows/main-admission.yml', import.meta.url),
    'utf8',
  );
  it('partitions PR triggers while main pushes retain the complete verifier', () => {
    expect(ci).toContain('branches-ignore: [main]');
    expect(main).toContain('branches: [main]');
    expect(ci).toContain('push:\n    branches: [main]');
    expect(ci).toContain('workflow_call:');
    expect(main).toContain('uses: ./.github/workflows/ci.yml');
    expect(ci).not.toMatch(/^ {2}main-admission:/mu);
    expect(main).toContain('needs: verification\n    if: ${{ always() }}');
    expect(main).toContain('VERIFICATION_RESULT: ${{ needs.verification.result }}');
    expect(main).toContain('VERIFICATION_ATTEMPT: ${{ needs.verification.outputs.attempt }}');
    expect(ci + main).not.toMatch(
      /workflow_run:|workflow_dispatch:|pull_request_target:|skip-full/u,
    );
  });
  it('reroutes retargeted PRs and checks the live candidate after all stage checks', () => {
    expect(ci).toContain('ready_for_review, edited]');
    expect(main).toContain('ready_for_review, edited]');
    const verify = ci.split('\n  verify:\n')[1] ?? '';
    expect(verify).toContain('fetch-depth: 0');
    expect(verify.indexOf('check-delivery.mts')).toBeGreaterThan(
      verify.indexOf('check-ci-results.mts'),
    );
    expect(verify).toContain("success() && github.event_name == 'pull_request'");
  });
});

describe('cumulative Git changes', () => {
  it('retains earlier engineering changes after a later business or docs commit', () => {
    const repo = mkdtempSync(join(tmpdir(), 'batch-delivery-git-'));
    try {
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
          {
            cwd: repo,
            encoding: 'utf8',
            env: {
              ...process.env,
              GIT_CONFIG_GLOBAL: '/dev/null',
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_AUTHOR_NAME: 'Fixture',
              GIT_COMMITTER_NAME: 'Fixture',
              GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
              GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
            },
          },
        ).trim();
      const commit = () => {
        git('add', '.');
        git('commit', '--quiet', '-m', 'Fixture');
        return git('rev-parse', 'HEAD');
      };
      git('init', '--quiet', '--initial-branch=main');
      writeFileSync(join(repo, 'README.md'), '# Fixture\n');
      const initial = commit();
      mkdirSync(join(repo, 'tools/verification'), { recursive: true });
      writeFileSync(join(repo, 'tools/verification/runner.mts'), '// fixture\n');
      commit();
      writeFileSync(join(repo, 'README.md'), '# Updated\n');
      const last = commit();
      expect(
        selectVerificationTarget(readChangedPaths(initial, last, repo), context()).target,
      ).toBe('full');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
