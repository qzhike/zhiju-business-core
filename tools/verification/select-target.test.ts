import { describe, expect, it } from 'vitest';

import { selectVerificationTarget } from './select-target.mts';

const draftPullRequest = { eventName: 'pull_request', isDraftPullRequest: true };
const readyPullRequest = { eventName: 'pull_request', isDraftPullRequest: false };

describe('verification target selection', () => {
  it('routes strict durable-document and review-record changes to docs', () => {
    expect(
      selectVerificationTarget(
        ['.vibe/module-specs/Module-Spec-003-TaskExecution.md', '.vibe/reviews/pr-215/Review.md'],
        readyPullRequest,
      ),
    ).toEqual({ target: 'docs', reason: 'strict-documentation-only' });
  });

  it('routes the repository README to docs', () => {
    expect(selectVerificationTarget(['README.md'], readyPullRequest).target).toBe('docs');
  });

  it('routes non-persistence code on a Draft Pull Request to code', () => {
    expect(
      selectVerificationTarget(['modules/task-execution/src/context-builder.ts'], draftPullRequest),
    ).toEqual({ target: 'code', reason: 'draft-non-persistence-change' });
  });

  it('routes the same non-document code to full when the Pull Request is ready', () => {
    expect(
      selectVerificationTarget(['modules/task-execution/src/context-builder.ts'], readyPullRequest),
    ).toEqual({ target: 'full', reason: 'ready-or-main-non-document-change' });
  });

  it('routes a non-document main push to full', () => {
    expect(
      selectVerificationTarget(['contracts/src/registry.test.ts'], {
        eventName: 'push',
        isDraftPullRequest: false,
      }).target,
    ).toBe('full');
  });

  it.each([
    'migrations/task_execution/V3004__context_snapshot.sql',
    'tests/persistence/context-snapshot.test.ts',
    'tools/persistence/gate.mjs',
    'modules/task-execution/src/persistence/task-execution-repository.ts',
  ])('routes persistence-sensitive path %s to full even on a Draft Pull Request', (path) => {
    expect(selectVerificationTarget([path], draftPullRequest).target).toBe('full');
  });

  it.each([
    '.vibe/project.yaml',
    '.github/workflows/ci.yml',
    'AGENTS.md',
    'package.json',
    'tools/verification/select-target.mts',
    'vitest.persistence.config.ts',
  ])('routes verification-policy path %s to full', (path) => {
    expect(selectVerificationTarget([path], draftPullRequest).target).toBe('full');
  });

  it('routes a mixed documentation and non-persistence Draft change to code', () => {
    expect(
      selectVerificationTarget(
        ['.vibe/module-specs/Module-Spec-003-TaskExecution.md', 'apps/api/src/main.ts'],
        draftPullRequest,
      ).target,
    ).toBe('code');
  });

  it('fails closed when no changed paths can be established', () => {
    expect(selectVerificationTarget([], draftPullRequest)).toEqual({
      target: 'full',
      reason: 'no-changed-paths',
    });
  });
});
