import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  eventPullRequest,
  githubRead,
  independentPushPullRequest,
  isBatchBranch,
  record,
  type PullRequestBoundary,
} from './delivery-context.mts';

export type VerificationTarget = 'docs' | 'code' | 'full';

export interface VerificationContext {
  eventName: string;
  isDraftPullRequest: boolean;
  batchDeliveryEnabled?: boolean;
  pullRequest?: PullRequestBoundary;
  independentDocumentationPush?: boolean;
}

export interface VerificationSelection {
  target: VerificationTarget;
  reason: string;
}

export function isDocumentationOnlyPath(path: string): boolean {
  return path === 'README.md' || (path.startsWith('.vibe/') && path.endsWith('.md'));
}

export function isBatchBusinessPath(path: string): boolean {
  if (
    !/^[A-Za-z0-9_.\/-]+$/u.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  )
    return false;
  if (engineeringTestPaths.has(path)) return false;
  const basename = path.split('/').at(-1) ?? '';
  if (
    /^(?:package(?:-lock)?\.json|pnpm-.*|tsconfig.*|.*\.config\.[^.]+|AGENTS\.md)$/u.test(basename)
  )
    return false;
  return (
    /^(?:(?:apps|modules|packages)\/[^/]+\/(?:src|tests?)\/|contracts\/src\/|tests\/(?:business|workspace|persistence)\/)[A-Za-z0-9_.\/-]+\.(?:ts|tsx|mts|js|mjs|css|json|html|md|sql)$/u.test(
      path,
    ) ||
    /^tests\/fixtures\/[A-Za-z0-9_.\/-]+\.(?:json|md|txt|sql)$/u.test(path) ||
    /^migrations\/[A-Za-z0-9_.\/-]+\.sql$/u.test(path)
  );
}

// Verification infrastructure tests retain the engineering gate even under tests/business.
const engineeringTestPaths = new Set([
  'tests/business/pinned-baseline.test.ts',
  'tests/business/migration-isolation.test.ts',
  'tests/business/persistence-case-inventory.test.ts',
  'tests/business/workspace-boundaries.test.ts',
]);

// Audited presentation/fixture boundaries, not a blanket frontend exemption.
// Production integration or new responsibilities must update this allowlist.
const lowRiskUiPaths = new Set([
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
  'apps/workspace-web/src/analysis/analysis.css',
  'apps/workspace-web/src/analysis/Page.tsx',
  'apps/workspace-web/src/analysis/Page.test.tsx',
  'apps/workspace-web/src/analysis/model.ts',
  'apps/workspace-web/src/analysis/model.test.ts',
  'apps/workspace-web/src/startup/Page.tsx',
  'apps/workspace-web/src/startup/Page.test.tsx',
  'apps/workspace-web/src/intake/intake.css',
  'apps/workspace-web/src/workbench/workbench.css',
  'apps/workspace-web/src/fixtures/adapter.ts',
  'apps/workspace-web/src/fixtures/analysis.tsx',
  'apps/workspace-web/src/fixtures/analysis-report.json',
  'apps/workspace-web/src/fixtures/analysis-report.md',
  'apps/workspace-web/src/fixtures/analysis-report.followup.json',
  'apps/workspace-web/src/fixtures/analysis-report.followup.md',
  'apps/workspace-web/src/fixtures/intake.tsx',
  'apps/workspace-web/src/fixtures/startup-review.json',
  'apps/workspace-web/src/fixtures/workbench.tsx',
  'tests/workspace/analysis.spec.ts',
  'tests/workspace/intake.spec.ts',
  'tests/workspace/startup.spec.ts',
  'tests/workspace/shell.spec.ts',
  'tests/workspace/workbench.spec.ts',
]);

export function selectVerificationTarget(
  changedPaths: readonly string[],
  context: VerificationContext,
): VerificationSelection {
  // Git's NUL-delimited paths preserve filename characters; match them exactly.
  const paths = [...new Set(changedPaths)];

  if (paths.length === 0) {
    return { target: 'full', reason: 'no-changed-paths' };
  }

  if (context.batchDeliveryEnabled) {
    const pr = context.pullRequest;
    if (context.eventName === 'push') {
      return context.independentDocumentationPush && paths.every(isDocumentationOnlyPath)
        ? { target: 'docs', reason: 'independent-documentation-main-push' }
        : { target: 'full', reason: 'phase-one-main-full' };
    }
    if (context.eventName !== 'pull_request' || !pr)
      return { target: 'full', reason: 'unknown-delivery-context' };
    if (
      pr.baseRef === 'main' &&
      isBatchBranch(pr.headRef) &&
      pr.headRepository === pr.baseRepository
    )
      return { target: 'full', reason: 'batch-final-candidate' };
    if (isBatchBranch(pr.baseRef) && pr.headRepository === pr.baseRepository) {
      if (paths.every(isDocumentationOnlyPath))
        return { target: 'docs', reason: 'batch-documentation-child' };
      return paths.every((p) => isDocumentationOnlyPath(p) || isBatchBusinessPath(p))
        ? { target: 'code', reason: 'batch-business-child' }
        : { target: 'full', reason: 'batch-engineering-or-unknown-change' };
    }
    if (
      pr.baseRef === 'main' &&
      !pr.headRef.startsWith('batch/') &&
      paths.every(isDocumentationOnlyPath)
    )
      return { target: 'docs', reason: 'independent-documentation-pr' };
    return { target: 'full', reason: 'outside-batch-delivery' };
  }

  if (paths.every(isDocumentationOnlyPath)) {
    return { target: 'docs', reason: 'strict-documentation-only' };
  }

  if (
    context.eventName === 'pull_request' &&
    paths.every((path) => isDocumentationOnlyPath(path) || lowRiskUiPaths.has(path))
  ) {
    return { target: 'code', reason: 'low-risk-pull-request' };
  }

  return {
    target: 'full',
    reason:
      context.eventName === 'pull_request'
        ? 'high-risk-or-unknown-change'
        : 'non-pull-request-non-document-change',
  };
}

export function readChangedPaths(baseSha: string, headSha: string, cwd = process.cwd()): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', `${baseSha}...${headSha}`],
    { encoding: 'utf8', cwd },
  );

  return output.split('\0').filter(Boolean);
}

function emitSelection(selection: VerificationSelection, changedPathCount: number): void {
  const output = [
    `target=${selection.target}`,
    `reason=${selection.reason}`,
    `changed_path_count=${changedPathCount}`,
    `attempt=${process.env.GITHUB_RUN_ATTEMPT ?? ''}`,
  ].join('\n');

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8');
  }

  process.stdout.write(`[verification] ${output.replaceAll('\n', ' ')}\n`);
}

async function main(): Promise<void> {
  const [baseSha, headSha, eventName = '', draftValue = 'false'] = process.argv.slice(2);

  if (!baseSha || !headSha) {
    emitSelection({ target: 'full', reason: 'missing-revision-boundary' }, 0);
    return;
  }

  try {
    const changedPaths = readChangedPaths(baseSha, headSha);
    const flag = process.env.BATCH_DELIVERY_ENABLED ?? '';
    if (!['', 'false', 'true'].includes(flag)) {
      emitSelection({ target: 'full', reason: 'invalid-activation-setting' }, changedPaths.length);
      return;
    }
    const enabled = flag === 'true';
    const repository = process.env.GITHUB_REPOSITORY ?? '';
    const event: unknown = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : undefined;
    const pr = eventPullRequest(event, repository);
    let independentDocumentationPush = false;
    if (
      enabled &&
      eventName === 'push' &&
      changedPaths.every(isDocumentationOnlyPath) &&
      record(record(event)?.repository)?.full_name === repository &&
      record(event)?.ref === 'refs/heads/main' &&
      record(event)?.before === baseSha &&
      record(event)?.after === headSha
    ) {
      try {
        const associated = await githubRead(
          `/repos/${repository}/commits/${headSha}/pulls?per_page=100`,
        );
        const merged = independentPushPullRequest(associated, repository, headSha);
        // Check the associated PR's complete diff too, not just the final push.
        // The API base SHA can advance after merge; use the actual push baseline
        // against the original PR head to inspect the full proposed change.
        const mergedPaths = merged ? readChangedPaths(baseSha, merged.headSha) : [];
        independentDocumentationPush =
          mergedPaths.length > 0 && mergedPaths.every(isDocumentationOnlyPath);
      } catch {
        /* Missing proof keeps full. */
      }
    }
    emitSelection(
      selectVerificationTarget(changedPaths, {
        eventName,
        isDraftPullRequest: draftValue === 'true',
        batchDeliveryEnabled: enabled,
        ...(pr ? { pullRequest: pr } : {}),
        independentDocumentationPush,
      }),
      changedPaths.length,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[verification] diff unavailable; falling back to full: ${message}\n`);
    emitSelection({ target: 'full', reason: 'diff-unavailable' }, 0);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  void main();
}
