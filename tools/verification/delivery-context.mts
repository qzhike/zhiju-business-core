export interface PullRequestBoundary {
  number: number;
  baseRef: string;
  baseSha: string;
  baseRepository: string;
  headRef: string;
  headSha: string;
  headRepository: string;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}

export function isRepository(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value);
}

export function isBatchBranch(ref: string): boolean {
  return /^batch\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ref);
}

export function pullRequestBoundary(value: unknown): PullRequestBoundary | undefined {
  const pr = record(value),
    base = record(pr?.base),
    head = record(pr?.head);
  const baseRepository = record(base?.repo)?.full_name;
  const headRepository = record(head?.repo)?.full_name;
  if (
    !pr ||
    !base ||
    !head ||
    !Number.isSafeInteger(pr.number) ||
    (pr.number as number) <= 0 ||
    typeof base?.ref !== 'string' ||
    !base.ref ||
    !isSha(base.sha) ||
    typeof head?.ref !== 'string' ||
    !head.ref ||
    !isSha(head.sha) ||
    !isRepository(baseRepository) ||
    !isRepository(headRepository)
  )
    return undefined;
  return {
    number: pr.number as number,
    baseRef: base.ref,
    baseSha: base.sha,
    baseRepository,
    headRef: head.ref,
    headSha: head.sha,
    headRepository,
  };
}

export function eventPullRequest(
  event: unknown,
  repository: string,
): PullRequestBoundary | undefined {
  const payload = record(event);
  const boundary = pullRequestBoundary(payload?.pull_request);
  if (
    !boundary ||
    !isRepository(repository) ||
    record(payload?.repository)?.full_name !== repository ||
    boundary.baseRepository !== repository ||
    payload?.number !== boundary.number
  )
    return undefined;
  return boundary;
}

export function currentBoundaryFailures(
  expected: PullRequestBoundary,
  current: unknown,
  checkoutSha: string,
): string[] {
  const actual = pullRequestBoundary(current);
  if (!actual) return ['current pull request boundary is unavailable'];
  const failures: string[] = [];
  for (const key of Object.keys(expected) as (keyof PullRequestBoundary)[])
    if (expected[key] !== actual[key]) failures.push(`pull request ${key} changed`);
  const pr = record(current);
  if (pr?.state !== 'open') failures.push('pull request is not open');
  if (pr?.merge_commit_sha !== checkoutSha || !isSha(checkoutSha))
    failures.push('checkout is not the current test merge candidate');
  return failures;
}

export async function githubRead(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  if (!token || !/^https:\/\/[^/]+(?:\/api\/v3)?$/u.test(api))
    throw new Error('read-only GitHub API access is unavailable');
  const response = await fetch(`${api}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub metadata read failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

// Only an exact, merged, independent documentation PR may preserve docs on main.
// An absent/ambiguous association falls back to full; no full evidence is reused.
export function independentPushPullRequest(
  associated: unknown,
  repository: string,
  sha: string,
): PullRequestBoundary | undefined {
  if (!Array.isArray(associated) || associated.length >= 100 || !isSha(sha)) return undefined;
  const matches = associated.filter((value) => {
    const pr = record(value),
      b = pullRequestBoundary(value);
    return (
      b?.baseRepository === repository &&
      b.baseRef === 'main' &&
      pr?.state === 'closed' &&
      typeof pr.merged_at === 'string' &&
      pr.merge_commit_sha === sha
    );
  });
  if (matches.length !== 1) return undefined;
  const boundary = pullRequestBoundary(matches[0]);
  return boundary && !boundary.headRef.startsWith('batch/') ? boundary : undefined;
}
