import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repository = 'example/project';
const script = fileURLToPath(new URL('./check-delivery.mts', import.meta.url));
const selector = fileURLToPath(new URL('./select-target.mts', import.meta.url));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
let repo: string, base: string, head: string, merge: string;
function git(...args: string[]) {
  return execFileSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      cwd: repo,
      encoding: 'utf8',
      env,
    },
  ).trim();
}
function pr(baseRef = 'batch/intake', headRef = 'feat/upload') {
  return {
    number: 7,
    state: 'open',
    merge_commit_sha: merge,
    base: { ref: baseRef, sha: base, repo: { full_name: repository } },
    head: { ref: headRef, sha: head, repo: { full_name: repository } },
  };
}
function run(
  options: {
    main?: boolean;
    final?: boolean;
    target?: string;
    result?: string;
    flag?: string;
    checkout?: string;
    event?: unknown;
    current?: unknown;
    apiFailure?: boolean;
    verificationAttempt?: string;
  } = {},
) {
  const original = options.final ? pr('main', 'batch/intake') : pr();
  writeFileSync(
    join(repo, 'event.json'),
    JSON.stringify(
      options.event ?? {
        number: 7,
        repository: { full_name: repository },
        pull_request: original,
      },
    ),
  );
  writeFileSync(join(repo, 'current.json'), JSON.stringify(options.current ?? original));
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      join(repo, 'mock-api.mjs'),
      script,
      ...(options.main ? ['--main'] : []),
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...env,
        GITHUB_OUTPUT: '',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: join(repo, 'event.json'),
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: options.checkout ?? merge,
        GITHUB_TOKEN: 'fixture-only',
        GITHUB_API_URL: 'https://api.github.com',
        BATCH_DELIVERY_ENABLED: options.flag ?? 'true',
        SELECTED_TARGET: options.target ?? (options.final ? 'full' : 'code'),
        VERIFICATION_RESULT: options.result ?? 'success',
        GITHUB_RUN_ATTEMPT: '2',
        VERIFICATION_ATTEMPT: options.verificationAttempt ?? '2',
        API_FAILURE: options.apiFailure ? 'yes' : '',
      },
    },
  );
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'batch-admission-cli-'));
  git('init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Initial fixture');
  base = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '-b', 'feat/upload');
  mkdirSync(join(repo, 'modules/intake/src'), { recursive: true });
  writeFileSync(join(repo, 'modules/intake/src/upload.ts'), '// fixture\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Business fixture');
  head = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', 'main');
  git('merge', '--quiet', '--no-ff', 'feat/upload', '-m', 'Test merge fixture');
  merge = git('rev-parse', 'HEAD');
  writeFileSync(
    join(repo, 'mock-api.mjs'),
    `import { readFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  if ((!url.endsWith('/pulls/7') && !url.endsWith('/pulls?per_page=100')) || !url.startsWith('https://api.github.com/repos/example/project/') || options.method || options.redirect !== 'error') throw new Error('Unexpected API request');
  return { ok: !process.env.API_FAILURE, status: 503, json: async () => JSON.parse(readFileSync('current.json', 'utf8')) };
};\n`,
  );
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('actual admission CLI with a Git merge candidate and read-only API fixture', () => {
  it('accepts a current child and a full final candidate with their actual tree', () => {
    for (const options of [{}, { final: true, main: true }]) {
      const result = run(options);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'PASS',
        checkoutSha: merge,
        tree: git('rev-parse', 'HEAD^{tree}'),
      });
    }
  });
  it('keeps bootstrap full before activation', () => {
    expect(run({ flag: '', target: 'full' }).status).toBe(0);
  });
  it.each([
    { main: true },
    { final: true, main: true, verificationAttempt: '1' },
    { final: true, main: true, verificationAttempt: '' },
    { final: true, main: true, target: 'code' },
    { result: 'cancelled' },
    { result: 'skipped' },
    { checkout: '0'.repeat(40) },
    { flag: 'TRUE' },
    { apiFailure: true },
    { event: {} },
  ])('rejects an invalid or incomplete candidate %j', (options) => {
    expect(run(options).status).toBe(1);
  });
  it('rejects changed live base/head and a closed or different test merge', () => {
    const current = pr();
    for (const changed of [
      { ...current, base: { ...current.base, ref: 'main' } },
      { ...current, head: { ...current.head, sha: base } },
      { ...current, merge_commit_sha: head },
      { ...current, state: 'closed' },
    ])
      expect(run({ current: changed }).status).toBe(1);
  });
  it('rejects a declared parent that is not part of the actual merge', () => {
    const changed = { ...pr(), base: { ...pr().base, sha: head } };
    expect(
      run({ event: { number: 7, repository: { full_name: repository }, pull_request: changed } })
        .status,
    ).toBe(1);
  });
  it('runs the real selector conservatively when activation is malformed', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', selector, base, merge, 'push'],
      {
        cwd: repo,
        encoding: 'utf8',
        env: { ...env, GITHUB_OUTPUT: '', BATCH_DELIVERY_ENABLED: 'TRUE', GITHUB_EVENT_PATH: '' },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('target=full reason=invalid-activation-setting');
  });

  it('preserves independent docs on main even when the PR API base has advanced after merge', () => {
    git('checkout', '--quiet', '-b', 'docs/update');
    writeFileSync(join(repo, 'README.md'), '# Updated fixture\n');
    git('add', 'README.md');
    git('commit', '--quiet', '-m', 'Documentation fixture');
    const docsHead = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', 'main');
    git('merge', '--quiet', '--no-ff', 'docs/update', '-m', 'Documentation merge fixture');
    const docsMerge = git('rev-parse', 'HEAD');
    try {
      writeFileSync(
        join(repo, 'event.json'),
        JSON.stringify({
          repository: { full_name: repository },
          ref: 'refs/heads/main',
          before: merge,
          after: docsMerge,
        }),
      );
      for (const [headRef, expected] of [
        ['docs/update', 'docs'],
        ['batch/docs-update', 'full'],
      ]) {
        writeFileSync(
          join(repo, 'current.json'),
          JSON.stringify([
            {
              ...pr('main', headRef),
              state: 'closed',
              merged_at: '2026-10-22T00:00:00Z',
              merge_commit_sha: docsMerge,
              base: { ...pr().base, ref: 'main', sha: docsMerge },
              head: { ...pr().head, ref: headRef, sha: docsHead },
            },
          ]),
        );
        const result = spawnSync(
          process.execPath,
          [
            '--experimental-strip-types',
            '--import',
            join(repo, 'mock-api.mjs'),
            selector,
            merge,
            docsMerge,
            'push',
          ],
          {
            cwd: repo,
            encoding: 'utf8',
            env: {
              ...env,
              GITHUB_OUTPUT: '',
              BATCH_DELIVERY_ENABLED: 'true',
              GITHUB_EVENT_PATH: join(repo, 'event.json'),
              GITHUB_REPOSITORY: repository,
              GITHUB_TOKEN: 'fixture-only',
              GITHUB_API_URL: 'https://api.github.com',
              API_FAILURE: '',
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`target=${expected} `);
      }
    } finally {
      git('checkout', '--quiet', '--detach', merge);
    }
  });
});
