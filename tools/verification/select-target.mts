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

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, '').replaceAll('\\', '/');
}

export function isDocumentationOnlyPath(path: string): boolean {
  return path === 'README.md' || (path.startsWith('.vibe/') && path.endsWith('.md'));
}

function requiresFullVerification(path: string): boolean {
  if (
    path === '.vibe/project.yaml' ||
    path === 'AGENTS.md' ||
    path === 'package.json' ||
    path === 'pnpm-lock.yaml' ||
    path === 'pnpm-workspace.yaml' ||
    path === 'vitest.config.ts' ||
    path === 'vitest.persistence.config.ts'
  ) {
    return true;
  }

  return (
    path.startsWith('.github/') ||
    path.startsWith('migrations/') ||
    path.startsWith('tests/persistence/') ||
    path.startsWith('tools/persistence/') ||
    path.startsWith('tools/verification/') ||
    /^modules\/[^/]+\/src\/persistence\//u.test(path) ||
    path.endsWith('.sql')
  );
}

export function selectVerificationTarget(
  changedPaths: readonly string[],
  context: VerificationContext,
): VerificationSelection {
  const paths = [...new Set(changedPaths.map(normalizePath).filter(Boolean))];

  if (paths.length === 0) {
    return { target: 'full', reason: 'no-changed-paths' };
  }

  if (paths.every(isDocumentationOnlyPath)) {
    return { target: 'docs', reason: 'strict-documentation-only' };
  }

  if (paths.some(requiresFullVerification)) {
    return { target: 'full', reason: 'persistence-or-verification-sensitive' };
  }

  if (context.eventName === 'pull_request' && context.isDraftPullRequest) {
    return { target: 'code', reason: 'draft-non-persistence-change' };
  }

  return { target: 'full', reason: 'ready-or-main-non-document-change' };
}

function readChangedPaths(baseSha: string, headSha: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMRD', `${baseSha}...${headSha}`],
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
