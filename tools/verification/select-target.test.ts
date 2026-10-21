import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { selectVerificationTarget } from './select-target.mts';

const draftPullRequest = { eventName: 'pull_request', isDraftPullRequest: true };
const readyPullRequest = { eventName: 'pull_request', isDraftPullRequest: false };
const mainPush = { eventName: 'push', isDraftPullRequest: false };
const misleadingPaths = [
  ' apps/workspace-web/src/style.css',
  'apps/workspace-web/src/style.css ',
  String.raw`apps\workspace-web\src\style.css`,
  ' README.md',
  'README.md ',
  String.raw`.vibe\module-tests\unexpected.md`,
];
const lowRiskPaths = [
  'apps/workspace-web/src/execution/execution.css',
  'apps/workspace-web/src/delivery/delivery.css',
  'apps/workspace-web/src/fixtures/review.tsx',
  'apps/workspace-web/src/fixtures/review-data.ts',
  'apps/workspace-web/src/fixtures/execution.tsx',
  'apps/workspace-web/src/fixtures/delivery.tsx',
  'apps/workspace-web/src/MarkdownReviewPage.test.tsx',
  'apps/workspace-web/src/execution/Page.test.tsx',
  'apps/workspace-web/src/execution/model.test.ts',
  'apps/workspace-web/src/delivery/model.test.ts',
  'tests/workspace/review.spec.ts',
  'tests/workspace/execution.spec.ts',
  'tests/workspace/delivery.spec.ts',

  'apps/workspace-web/src/style.css',
  'apps/workspace-web/src/shell.tsx',
  'apps/workspace-web/src/analysis/Page.tsx',
  'apps/workspace-web/src/analysis/model.ts',
  'apps/workspace-web/src/analysis/Page.test.tsx',
  'apps/workspace-web/src/startup/Page.tsx',
  'apps/workspace-web/src/startup/Page.test.tsx',
  'apps/workspace-web/src/fixtures/analysis.tsx',
  'apps/workspace-web/src/fixtures/startup-review.json',
  'apps/workspace-web/src/fixtures/analysis-report.md',
  'tests/workspace/startup.spec.ts',
];
const fullPaths = [
  'apps/workspace-web/src/execution/Page.tsx',
  'apps/workspace-web/src/execution/model.ts',
  'apps/workspace-web/src/delivery/Page.tsx',
  'apps/workspace-web/src/delivery/model.ts',
  'apps/workspace-web/src/workbench/navigation.ts',
  '.github/workflows/persistence.yml',
  'modules/task-execution/src/context-builder.ts',
  'modules/identity-policy/src/authorization.ts',
  'modules/task-execution/src/persistence/task-execution-repository.ts',
  'packages/shared-kernel/src/index.ts',
  'contracts/src/registry.ts',
  'contracts/src/registry.test.ts',
  'apps/api/src/main.ts',
  'apps/workspace-bff/src/app.ts',
  'apps/workspace-web/src/App.tsx',
  'apps/workspace-web/src/TrustedApp.tsx',
  'apps/workspace-web/src/trusted/session.ts',
  'apps/workspace-web/src/trusted/guard.test.ts',
  'apps/workspace-web/src/intake/Pages.tsx',
  'apps/workspace-web/src/intake/TrustedIntake.tsx',
  'apps/workspace-web/src/MarkdownReview.tsx',
  'apps/workspace-web/src/MarkdownReviewPage.tsx',
  'apps/workspace-web/src/workbench/Workbench.tsx',
  'apps/workspace-web/src/workbench/model.ts',
  'apps/workspace-web/src/workbench/trusted-adapter.ts',
  'apps/workspace-web/src/model.ts',
  'apps/workspace-web/src/new-page/Page.tsx',
  'apps/workspace-web/src/new-page/style.css',
  'apps/workspace-web/vite.config.ts',
  'apps/workspace-web/package.json',
  'apps/workspace-web/src/fixtures/package.json',
  'apps/workspace-web/src/fixtures/tsconfig.json',
  'apps/workspace-web/src/fixtures/new-page.tsx',
  'tests/workspace/playwright.config.ts',
  'migrations/task_execution/V3004__context_snapshot.sql',
  'tests/persistence/context-snapshot.test.ts',
  'tools/persistence/gate.mjs',
  'tools/verification/select-target.mts',
  '.vibe/project.yaml',
  '.github/workflows/ci.yml',
  'AGENTS.md',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'vitest.config.ts',
  'vitest.persistence.config.ts',
  'unclassified.txt',
];

describe('verification target selection', () => {
  it.each([draftPullRequest, readyPullRequest, mainPush])(
    'preserves strict documentation-only routing for %j',
    (context) => {
      expect(
        selectVerificationTarget(
          [
            'README.md',
            '.vibe/module-specs/Module-Spec-003-TaskExecution.md',
            '.vibe/reviews/pr-215/Review.md',
          ],
          context,
        ),
      ).toEqual({ target: 'docs', reason: 'strict-documentation-only' });
    },
  );

  describe.each([draftPullRequest, readyPullRequest])('Pull Request context %j', (context) => {
    it.each(lowRiskPaths)('routes audited low-risk path %s to code', (path) => {
      expect(selectVerificationTarget([path], context)).toEqual({
        target: 'code',
        reason: 'low-risk-pull-request',
      });
    });

    it('allows a low-risk UI change with its documentation and browser test', () => {
      expect(
        selectVerificationTarget(
          ['.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md', ...lowRiskPaths],
          context,
        ).target,
      ).toBe('code');
    });

    it.each(fullPaths)('never downgrades high-risk or unknown path %s', (path) => {
      expect(selectVerificationTarget([path], context).target).toBe('full');
      expect(selectVerificationTarget(['README.md', ...lowRiskPaths, path], context).target).toBe(
        'full',
      );
    });
  });

  it.each(lowRiskPaths)('still requires full for %s on main', (path) => {
    expect(selectVerificationTarget([path], mainPush).target).toBe('full');
  });

  it.each(['workflow_dispatch', 'merge_group', 'unknown', ''])(
    'does not apply the PR exemption to event %s',
    (eventName) => {
      expect(
        selectVerificationTarget(lowRiskPaths, { eventName, isDraftPullRequest: true }).target,
      ).toBe('full');
    },
  );

  describe.each([draftPullRequest, readyPullRequest, mainPush])(
    'raw path identity for %j',
    (context) => {
      it.each([...misleadingPaths, './apps/workspace-web/src/style.css', './README.md', ' ', ''])(
        'does not reinterpret an unknown path %j as an allowed path',
        (path) => {
          expect(selectVerificationTarget([path], context).target).toBe('full');
          expect(
            selectVerificationTarget(
              ['README.md', 'apps/workspace-web/src/style.css', path],
              context,
            ).target,
          ).toBe('full');
        },
      );
    },
  );

  it('fails closed for an empty change set', () => {
    expect(selectVerificationTarget([], draftPullRequest)).toEqual({
      target: 'full',
      reason: 'no-changed-paths',
    });
  });
});

describe('verification CLI revision boundaries', () => {
  let repo: string;
  let base: string;
  const corePath = 'modules/task-execution/src/context-builder.ts';
  const selector = fileURLToPath(new URL('./select-target.mts', import.meta.url));

  function git(...args: string[]) {
    return execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'Verification fixture',
          GIT_AUTHOR_EMAIL: 'verification@example.invalid',
          GIT_COMMITTER_NAME: 'Verification fixture',
          GIT_COMMITTER_EMAIL: 'verification@example.invalid',
        },
      },
    ).trim();
  }

  function write(path: string, text: string) {
    const absolute = join(repo, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }

  // Commits exist only in this disposable test repository, never the working checkout.
  function commit() {
    git('add', '.');
    git('commit', '--quiet', '-m', 'Verification fixture');
    return git('rev-parse', 'HEAD');
  }

  function select(baseSha = base, head = 'HEAD', event = 'pull_request', draft = 'false') {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', selector, baseSha, head, event, draft],
      {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: '' },
        timeout: 10_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'zhiju-verification-routing-'));
    git('init', '--quiet', '--initial-branch=main');
    write(corePath, 'export const fixture = 1;\n');
    write('README.md', '# Fixture\n');
    base = commit();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('routes the actual same UI diff to code on PRs and full on main', () => {
    write('apps/workspace-web/src/style.css', 'body { color: black; }\n');
    commit();
    expect(select()).toContain('target=code reason=low-risk-pull-request');
    expect(select(base, 'HEAD', 'pull_request', 'true')).toContain('target=code');
    expect(select(base, 'HEAD', 'push')).toContain('target=full');
  });

  it.each(misleadingPaths)('preserves the actual Git filename %j in a mixed PR diff', (path) => {
    write(path, 'Unknown file\n');
    write('apps/workspace-web/src/style.css', 'body { color: black; }\n');
    commit();
    expect(select()).toContain('target=full reason=high-risk-or-unknown-change');
    expect(select(base, 'HEAD', 'pull_request', 'true')).toContain('target=full');
  });

  it('keeps an earlier Core change in scope after a documentation-only last commit', () => {
    write(corePath, 'export const fixture = 2;\n');
    commit();
    write('README.md', '# Updated fixture\n');
    commit();
    expect(select()).toContain('target=full reason=high-risk-or-unknown-change');
  });

  it.each(['apps/workspace-web/src/fixtures/adapter.ts', '.vibe/archive/moved.md'])(
    'retains the high-risk source when a file is renamed to %s',
    (destination) => {
      mkdirSync(dirname(join(repo, destination)), { recursive: true });
      renameSync(join(repo, corePath), join(repo, destination));
      commit();
      expect(select()).toContain('target=full');
    },
  );

  it('does not lose a high-risk deletion mixed with a low-risk change', () => {
    rmSync(join(repo, corePath));
    write('apps/workspace-web/src/style.css', 'body { color: black; }\n');
    commit();
    expect(select()).toContain('target=full');
  });

  it('does not omit a file type change from a mixed PR diff', () => {
    rmSync(join(repo, corePath));
    symlinkSync('../../../README.md', join(repo, corePath));
    write('apps/workspace-web/src/style.css', 'body { color: black; }\n');
    commit();
    expect(select()).toContain('target=full');
  });

  it('fails closed when the requested revisions cannot be compared', () => {
    expect(select('missing-revision')).toContain('target=full reason=diff-unavailable');
  });

  it('fails closed when a revision boundary is missing', () => {
    expect(select('')).toContain('target=full reason=missing-revision-boundary');
  });
});
