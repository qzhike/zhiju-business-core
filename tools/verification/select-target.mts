import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type VerificationTarget = 'docs' | 'code' | 'full';

export interface VerificationContext {
  eventName: string;
  isDraftPullRequest: boolean;
}

export interface VerificationSelection {
  target: VerificationTarget;
  reason: string;
}

export function isDocumentationOnlyPath(path: string): boolean {
  return path === 'README.md' || (path.startsWith('.vibe/') && path.endsWith('.md'));
}

// Audited presentation/fixture boundaries, not a blanket frontend exemption.
// Production integration or new responsibilities must update this allowlist.
const lowRiskUiPaths = new Set([
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

function readChangedPaths(baseSha: string, headSha: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', `${baseSha}...${headSha}`],
    { encoding: 'utf8' },
  );

  return output.split('\0').filter(Boolean);
}

function emitSelection(selection: VerificationSelection, changedPathCount: number): void {
  const output = [
    `target=${selection.target}`,
    `reason=${selection.reason}`,
    `changed_path_count=${changedPathCount}`,
  ].join('\n');

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`, 'utf8');
  }

  process.stdout.write(`[verification] ${output.replaceAll('\n', ' ')}\n`);
}

function main(): void {
  const [baseSha, headSha, eventName = '', draftValue = 'false'] = process.argv.slice(2);

  if (!baseSha || !headSha) {
    emitSelection({ target: 'full', reason: 'missing-revision-boundary' }, 0);
    return;
  }

  try {
    const changedPaths = readChangedPaths(baseSha, headSha);
    emitSelection(
      selectVerificationTarget(changedPaths, {
        eventName,
        isDraftPullRequest: draftValue === 'true',
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
  main();
}
