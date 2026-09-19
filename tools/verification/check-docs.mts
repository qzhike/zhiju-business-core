import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isDocumentationOnlyPath } from './select-target.mts';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function splitNullTerminated(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

export function validateMarkdown(path: string, contents: string): string[] {
  const findings: string[] = [];
  let fence: { marker: '`' | '~'; length: number; line: number } | undefined;

  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1;

    if (/^(?:<{7}|>{7})(?:\s|$)/u.test(line)) {
      findings.push(`${path}:${lineNumber}: unresolved conflict marker`);
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    const fenceToken = fenceMatch?.[1];
    if (!fenceToken) {
      continue;
    }

    const marker = fenceToken.startsWith('`') ? '`' : '~';
    const length = fenceToken.length;
    if (!fence) {
      fence = { marker, length, line: lineNumber };
    } else if (fence.marker === marker && length >= fence.length) {
      fence = undefined;
    }
  }

  if (fence) {
    findings.push(`${path}:${fence.line}: unclosed Markdown fence`);
  }

  return findings;
}

interface ChangedDocuments {
  paths: string[];
  diffChecks: string[][];
}

function changedDocuments(): ChangedDocuments {
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.GITHUB_SHA;

  if (baseSha && headSha) {
    return {
      paths: splitNullTerminated(
        git(['diff', '--name-only', '-z', '--diff-filter=ACMRD', `${baseSha}...${headSha}`]),
      ),
      diffChecks: [['diff', '--check', `${baseSha}...${headSha}`]],
    };
  }

  const worktreePaths = [
    ...splitNullTerminated(git(['diff', '--name-only', '-z', '--diff-filter=ACMRD', 'HEAD'])),
    ...splitNullTerminated(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ];
  const diffChecks: string[][] = [];
  if (worktreePaths.length > 0) {
    diffChecks.push(['diff', '--check', 'HEAD']);
  }

  let branchPaths: string[] = [];
  try {
    const mergeBase = git(['merge-base', 'HEAD', 'origin/main']).trim();
    branchPaths = splitNullTerminated(
      git(['diff', '--name-only', '-z', '--diff-filter=ACMRD', `${mergeBase}...HEAD`]),
    );
    if (branchPaths.length > 0) {
      diffChecks.push(['diff', '--check', `${mergeBase}...HEAD`]);
    }
  } catch {
    if (worktreePaths.length === 0) {
      throw new Error('cannot establish changed documents without origin/main');
    }
  }

  return {
    paths: [...new Set([...branchPaths, ...worktreePaths])],
    diffChecks,
  };
}

function main(): void {
  const changed = changedDocuments();
  if (changed.paths.length === 0) {
    throw new Error('docs verification requires at least one changed path');
  }

  const unsupportedPaths = changed.paths.filter((path) => !isDocumentationOnlyPath(path));
  if (unsupportedPaths.length > 0) {
    throw new Error(
      `docs verification cannot cover non-document paths: ${unsupportedPaths.join(', ')}`,
    );
  }

  for (const diffCheck of changed.diffChecks) {
    git(diffCheck);
  }

  const findings = changed.paths.flatMap((path) =>
    existsSync(path) ? validateMarkdown(path, readFileSync(path, 'utf8')) : [],
  );
  if (findings.length > 0) {
    throw new Error(`documentation integrity checks failed:\n${findings.join('\n')}`);
  }

  process.stdout.write(`[docs-verification] PASS files=${changed.paths.length}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[docs-verification] FAIL ${message}\n`);
    process.exitCode = 1;
  }
}
