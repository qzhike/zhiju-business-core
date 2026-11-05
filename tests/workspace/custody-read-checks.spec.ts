import { expect, test, type Page } from '@playwright/test';

const id = (number: number) => `0199a000-0000-7000-8000-${String(number).padStart(12, '0')}`;
const projectId = id(1),
  batchId = id(2),
  manifestId = id(3),
  checkId = id(4);
const at = '2026-11-04T00:00:00.000Z';
const projectPath = `/custody/projects/${projectId}`;
const ref = (number: number) => ({
  projectId,
  batchId,
  sourceId: id(100 + number),
  kind: 'ACCEPTED_ENTRY',
  sha256: 'a'.repeat(64),
  byteLength: 100,
  mediaType: 'text/markdown',
});
const rows = Array.from({ length: 45 }, (_, ordinal) => ({
  entry: {
    entryId: id(200 + ordinal),
    ordinal,
    originalName: `资料-${ordinal + 1}.md`,
    normalizedPath: `资料-${ordinal + 1}.md`,
    status: 'ACCEPTED',
    reasonCodes: [],
    sha256: 'a'.repeat(64),
    byteLength: 100,
    mediaType: 'text/markdown',
    sourceRef: ref(ordinal),
  },
  result: {
    entryId: id(200 + ordinal),
    ordinal,
    profileId: 'mvp.batch-read-check@1',
    checkedAt: at,
    status: 'AVAILABLE',
    limitations: [],
    resultHash: 'b'.repeat(64),
    counts: {
      paragraphs: 0,
      tables: 0,
      comments: 0,
      revisions: 0,
      headersFooters: 0,
      characters: 100,
    },
  },
}));
interface Control {
  version: number;
  running?: boolean;
  losePost?: boolean;
  keys: string[];
  polls: number;
  entries: number;
}
async function setup(
  page: Page,
  control: Control,
  start = `${projectPath}?batch=${batchId}&check=${checkId}`,
) {
  const check = () => ({
    checkId,
    projectId,
    batchId,
    manifestId,
    manifestHash: 'b'.repeat(64),
    profileId: 'mvp.batch-read-check@1',
    profileHash: 'c'.repeat(64),
    status: control.running ? 'RUNNING' : 'COMPLETED',
    resultVersion: control.version,
    totalEntries: 45,
    counts: { available: 45, limited: 0, unsupported: 0, failed: 0, notEligible: 0, pending: 0 },
    createdAt: at,
    startedAt: at,
    ...(control.running ? {} : { endedAt: at }),
    reasonCodes: [],
  });
  const batch = {
    projectId,
    batchId,
    batchNo: 1,
    originalName: 'synthetic.zip',
    declaredBytes: 100,
    zipSha256: 'a'.repeat(64),
    status: 'RECEIVED',
    kind: 'INITIAL',
    version: 4,
    reasonCodes: [],
    createdAt: at,
    manifestId,
  };
  const manifest = {
    manifestId,
    batchId,
    manifestHash: 'b'.repeat(64),
    totalEntries: 45,
    acceptedEntries: 45,
    limitedEntries: 0,
    createdAt: at,
    originalZip: {
      ...ref(0),
      sourceId: id(500),
      kind: 'ORIGINAL_ZIP',
      mediaType: 'application/zip',
    },
  };
  await page.route('**/bff/session', (route) =>
    route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'read-check',
        csrfToken: 'csrf',
        principal: { principalId: projectId, principalKind: 'HUMAN', displayName: 'Synthetic' },
      },
    }),
  );
  await page.route('**/bff/mvp/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let data: unknown;
    if (path.endsWith('/read-checks') && route.request().method() === 'POST') {
      control.keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (control.losePost) {
        control.losePost = false;
        await route.abort();
        return;
      }
      data = { check: check() };
    } else if (path.endsWith('/read-checks')) data = { items: [] };
    else if (path.endsWith(`/read-checks/${checkId}`)) {
      control.polls++;
      data = { check: check() };
    } else if (path.endsWith(`/read-checks/${checkId}/entries`)) {
      control.entries++;
      const version = url.searchParams.get('resultVersion');
      if (version !== null && version !== String(control.version)) {
        await route.fulfill({
          status: 409,
          json: {
            ok: false,
            error: { code: 'READ_CHECK_RESULTS_CHANGED', message: 'changed', retryable: false },
          },
        });
        return;
      }
      const filter = url.searchParams.get('filter') ?? 'ALL',
        limit = Number(url.searchParams.get('limit') ?? 20),
        offset = Number(url.searchParams.get('cursor') ?? 0);
      const filtered = ['ALL', 'AVAILABLE'].includes(filter) ? rows : [];
      data = {
        check: check(),
        filter,
        total: filtered.length,
        entries: filtered.slice(offset, offset + limit),
        ...(offset + limit < filtered.length ? { nextCursor: String(offset + limit) } : {}),
      };
    } else if (path.endsWith('/preview')) {
      const sourceId = path.split('/').at(-2);
      const ordinal = rows.findIndex((row) => row.entry.sourceRef.sourceId === sourceId);
      data = {
        sourceRef: ref(ordinal),
        manifestId,
        fileName: `资料-${ordinal + 1}.md`,
        profileId: 'mvp.source-preview@1',
        status: 'AVAILABLE',
        limitations: [],
        sections: { format: 'MARKDOWN', source: '# Synthetic current content' },
      };
    } else if (path.endsWith('/session'))
      data = {
        ownerId: projectId,
        displayName: 'Synthetic',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      };
    else if (path.endsWith(`/projects/${projectId}`))
      data = {
        project: {
          projectId,
          customerName: 'Synthetic',
          title: '检查项目',
          version: 2,
          lastBatchNo: 1,
          createdAt: at,
        },
      };
    else if (path.endsWith('/batches')) data = { items: [batch] };
    else if (path.endsWith(`/batches/${batchId}`))
      data = { batch, manifest, attempts: [], permittedActions: [] };
    else if (path.endsWith('/entries'))
      data = { manifest, entries: rows.slice(0, 20).map((row) => row.entry), nextCursor: '20' };
    else throw new Error(`Unexpected controlled route: ${path}`);
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto(start);
}

for (const width of [1440, 320])
  test(`production read-check report pagination, preview return and refresh at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const control = { version: 47, keys: [], polls: 0, entries: 0 };
    await setup(page, control);
    await expect(
      page.getByRole('heading', { name: '整批资料读取检查', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('资料-1.md', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByText('资料-21.md', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看当前提取内容' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Synthetic current content', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '← 返回文件列表' }).click();
    await expect(page.getByText('第 2 / 3 页')).toBeVisible();
    await page.reload();
    await expect(page.getByText('资料-21.md', { exact: true })).toBeVisible();
    await page.getByLabel('结果筛选').selectOption('AVAILABLE');
    await expect(page.getByText('第 1 / 3 页')).toBeVisible();
    await page.getByLabel('每页条数').selectOption('50');
    await expect(page.getByText('资料-45.md', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('read-check-report.png'), fullPage: true });
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
      'Synthetic current content',
    );
  });

test('production changed report version resets explicitly without mixing pages and hidden views stop polling', async ({
  page,
}) => {
  const control = { version: 47, running: true, keys: [], polls: 0, entries: 0 };
  await setup(page, control);
  await expect(page.getByText('资料-1.md', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('资料-21.md', { exact: true })).toBeVisible();
  control.version++;
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('检查结果已更新，已回到第一页。')).toBeVisible();
  await expect(page.getByText('资料-1.md', { exact: true })).toBeVisible();
  await expect(page.getByText('资料-41.md', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const polls = control.polls;
  await page.waitForTimeout(2300);
  expect(control.polls).toBe(polls);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => control.polls).toBeGreaterThan(polls);
});

test('production uncertain submission reuses the same request after refresh', async ({ page }) => {
  const control: Control = { version: 47, losePost: true, keys: [], polls: 0, entries: 0 };
  await setup(page, control, `${projectPath}?batch=${batchId}`);
  await page.getByRole('button', { name: '检查整批资料', exact: true }).click();
  await expect(page.getByText(/未能确认提交结果/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '检查整批资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '整批资料读取检查', exact: true })).toBeVisible();
  expect(control.keys).toHaveLength(2);
  expect(control.keys[0]).toBe(control.keys[1]);
});
