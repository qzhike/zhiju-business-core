import { expect, test, type Page } from '@playwright/test';

const projectId = '0199a000-0000-7000-8000-000000000001';
const id = (number: number) => `0199a000-0000-7000-8000-${String(number).padStart(12, '0')}`;
const createdAt = '2026-11-04T00:00:00.000Z';
const batches = [1, 2, 3, 4, 5, 6].map((number) => ({
  projectId,
  batchId: id(number + 10),
  batchNo: number,
  originalName: `质量体系第${number}次资料及补充说明.zip`,
  declaredBytes: 1000,
  zipSha256: 'a'.repeat(64),
  status: 'RECEIVED',
  kind: 'INITIAL',
  version: 4,
  reasonCodes: [],
  manifestId: id(number + 20),
  createdAt,
}));
const projectPath = `/custody/projects/${projectId}`;
const source = (number: number, extra = false) => ({
  projectId,
  batchId: id(number + 10),
  sourceId: id(number + (extra ? 40 : 30)),
  kind: 'ACCEPTED_ENTRY',
  sha256: 'b'.repeat(64),
  byteLength: 200,
  mediaType: 'text/markdown',
});
const manifest = (number: number, total = 21) => ({
  manifestId: id(number + 20),
  batchId: id(number + 10),
  manifestHash: 'c'.repeat(64),
  totalEntries: total,
  acceptedEntries: total,
  limitedEntries: 0,
  createdAt,
  originalZip: {
    ...source(number),
    sourceId: id(number + 50),
    kind: 'ORIGINAL_ZIP',
    mediaType: 'application/zip',
  },
});
const entry = (number: number, extra = false) => ({
  entryId: id(number + (extra ? 70 : 60)),
  ordinal: extra ? 2 : 1,
  originalName: `${extra ? '补充' : '手册'}-${number}.md`,
  normalizedPath: `${extra ? '补充' : '手册'}-${number}.md`,
  status: 'ACCEPTED',
  reasonCodes: [],
  byteLength: 200,
  mediaType: 'text/markdown',
  sha256: 'b'.repeat(64),
  sourceRef: source(number, extra),
});
interface Control {
  total?: number;
  empty?: boolean;
  failDetail?: number;
  failPage?: number;
  hold?: { number: number; page: boolean; promise: Promise<void>; started: boolean };
}
async function setup(page: Page, control: Control = {}, path = projectPath) {
  await page.route('**/bff/session', (route) =>
    route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'navigation',
        csrfToken: 'navigation',
        principal: { principalId: projectId, principalKind: 'HUMAN', displayName: '核对员工' },
      },
    }),
  );
  await page.route('**/bff/mvp/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/read-checks')) {
      await route.fulfill({ json: { ok: true, data: { items: [] } } });
      return;
    }
    const path = url.pathname;
    expect(route.request().method()).toBe('GET');
    let data: unknown;
    if (path.endsWith('/session'))
      data = {
        ownerId: projectId,
        displayName: '核对员工',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      };
    else if (path === `/bff/mvp/v1/projects/${projectId}`)
      data = {
        project: {
          projectId,
          title: '质量体系资料',
          customerName: '合成验收客户',
          version: 6,
          lastBatchNo: control.empty ? 0 : 6,
          createdAt,
        },
      };
    else if (path.endsWith('/batches')) data = { items: control.empty ? [] : batches };
    else {
      const batch = batches.find((value) => path.includes(`/batches/${value.batchId}`));
      if (!batch) throw new Error('Unexpected request');
      const number = batch.batchNo;
      const secondPage = url.searchParams.has('cursor');
      const detail = path.endsWith(batch.batchId);
      if (
        (control.failDetail === number && detail) ||
        (control.failPage === number && secondPage)
      ) {
        await route.fulfill({ status: 503, json: { ok: false, code: 'UI_SERVICE_UNAVAILABLE' } });
        return;
      }
      if (control.hold?.number === number && (control.hold.page ? secondPage : detail)) {
        control.hold.started = true;
        await control.hold.promise;
      }
      if (path.endsWith('/entries')) {
        const total = control.total ?? 21;
        const start = Number(url.searchParams.get('cursor')?.replace('offset-', '') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 50);
        data = {
          manifest: manifest(number, total),
          entries: Array.from({ length: Math.min(limit, total - start) }, (_, offset) => {
            const index = start + offset;
            const value = entry(number, index >= 20);
            return {
              ...value,
              entryId: id(number * 1000 + index),
              ordinal: index + 1,
              ...(index === 0 || index === 20
                ? {}
                : {
                    originalName: `附件-${number}-${index + 1}.md`,
                    normalizedPath: `附件-${number}-${index + 1}.md`,
                    sourceRef: { ...value.sourceRef, sourceId: id(number * 10000 + index) },
                  }),
            };
          }),
          ...(start + limit >= total ? {} : { nextCursor: `offset-${start + limit}` }),
        };
      } else if (path.endsWith('/preview'))
        data = {
          sourceRef: source(number, path.includes(`/sources/${id(number + 40)}/`)),
          manifestId: id(number + 20),
          fileName: `手册-${number}.md`,
          profileId: 'mvp.source-preview@1',
          status: 'AVAILABLE',
          limitations: [],
          sections: { format: 'MARKDOWN', source: `# 第 ${number} 批正文` },
        };
      else
        data = {
          batch,
          manifest: manifest(number, control.total ?? 21),
          attempts: [],
          permittedActions: [],
        };
    }
    await route.fulfill({ json: { ok: true, data } }).catch(() => undefined);
  });
  await page.goto(path);
}
const picker = (page: Page) => page.getByRole('combobox', { name: '资料批次' });
const table = (page: Page) => page.getByRole('table', { name: '资料条目清单' });

for (const width of [1440, 320])
  test(`production custody navigation puts files first at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await expect(picker(page)).toHaveValue(id(16));
    await expect(table(page)).toContainText('手册-6.md');
    await expect(page.getByRole('region', { name: '新增资料批次' })).toBeHidden();
    await expect(page.getByText('原请求', { exact: true })).toBeHidden();
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath(`custody-${width}.png`),
    });
    await expect(table(page).getByRole('button', { name: '查看内容' }).first()).toBeInViewport();
    await expect(picker(page).getByRole('option').first()).toHaveText(/第 6 批/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '上传新批次' }).click();
    await expect(page.getByLabel('选择 ZIP')).toBeVisible();
    await page.getByLabel('说明（可选）').fill('保留未提交的说明');
    await page.getByRole('button', { name: '收起上传' }).click();
    await page.getByRole('button', { name: '上传新批次' }).click();
    await expect(page.getByLabel('说明（可选）')).toHaveValue('保留未提交的说明');
    await page.getByRole('button', { name: '收起上传' }).click();
    await picker(page).focus();
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '上传新批次' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('选择 ZIP')).toBeVisible();
    await page.getByRole('button', { name: '收起上传' }).click();
    await picker(page).selectOption(id(15));
    await expect(picker(page)).toHaveValue(id(15));
    await expect(table(page)).toContainText('手册-5.md');
    await page.reload();
    await expect(picker(page)).toHaveValue(id(15));
    await expect(table(page)).toContainText('手册-5.md');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(table(page)).toContainText('补充-5.md');
    await table(page).getByRole('button', { name: '查看内容' }).first().click();
    await expect(page.getByRole('heading', { name: '第 5 批正文' })).toBeVisible();
    await page.getByRole('button', { name: '← 返回文件列表' }).click();
    await expect(picker(page)).toHaveValue(id(15));
    await expect(table(page)).toContainText('补充-5.md');
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '第 2 页', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const details = page.locator('summary').filter({ hasText: '批次技术详情' });
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('原请求', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '尝试历史' })).toBeVisible();
  });

test('production custody ignores old batch and pagination responses and retries failures', async ({
  page,
}) => {
  const control: Control = {};
  await setup(page, control, `${projectPath}?batch=${id(12)}`);
  await expect(table(page)).toContainText('手册-2.md');
  for (const paginated of [false, true]) {
    let release!: () => void;
    control.hold = {
      number: 5,
      page: paginated,
      started: false,
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    await picker(page).selectOption(id(15));
    if (paginated) {
      await expect(table(page)).toContainText('手册-5.md');
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
      await expect(page.getByText('正在加载分页…', { exact: true })).toBeVisible();
    }
    await expect.poll(() => control.hold?.started).toBe(true);
    await picker(page).selectOption(id(14));
    await expect(table(page)).toContainText('手册-4.md');
    const finished = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith(`/batches/${id(15)}/entries`) &&
        url.searchParams.has('cursor') === paginated
      );
    });
    release();
    await (await finished).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              resolve();
            }),
          ),
        ),
    );
    await expect(table(page)).not.toContainText('手册-5.md');
    await expect(table(page)).not.toContainText('补充-5.md');
    delete control.hold;
  }
  control.failDetail = 3;
  await picker(page).selectOption(id(13));
  await expect(page.getByRole('button', { name: '重新加载批次' })).toBeVisible();
  await expect(table(page)).toHaveCount(0);
  delete control.failDetail;
  await page.getByRole('button', { name: '重新加载批次' }).click();
  await expect(table(page)).toContainText('手册-3.md');
  control.failPage = 3;
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(table(page).getByRole('row')).toHaveCount(21);
  delete control.failPage;
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(table(page).getByRole('row')).toHaveCount(2);
  await expect(table(page)).not.toContainText('手册-3.md');
  await expect(table(page)).toContainText('补充-3.md');
});

test('production custody empty project opens upload without fabricating a batch', async ({
  page,
}) => {
  await setup(page, { empty: true });
  await expect(page.getByLabel('选择 ZIP')).toBeVisible();
  await expect(picker(page)).toBeDisabled();
  await expect(picker(page)).toHaveText('尚无批次');
  await expect(table(page)).toHaveCount(0);
});

test('production custody classic pagination switches pages and sizes without growing the list', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/entries')) requests.push(request.url());
  });
  await setup(page, { total: 65 });
  const pagination = page.getByRole('navigation', { name: '条目清单分页' });
  await expect(table(page).getByRole('row')).toHaveCount(21);
  await expect(page.getByText('第 1–20 项，共 65 项', { exact: true })).toBeVisible();
  await expect(pagination.getByRole('button', { name: '上一页' })).toBeDisabled();
  await pagination.getByRole('button', { name: '第 4 页', exact: true }).click();
  await expect(table(page).getByRole('row')).toHaveCount(6);
  await expect(table(page)).not.toContainText('手册-6.md');
  await expect(page.getByText('第 61–65 项，共 65 项', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '条目清单', exact: true })).toBeInViewport();
  await expect(page.getByRole('heading', { name: '条目清单', exact: true })).toBeFocused();
  await expect(pagination.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('pagination-1440.png'),
  });
  expect(requests).toHaveLength(4);
  await pagination.getByRole('button', { name: '上一页' }).click();
  await expect(table(page).getByRole('row')).toHaveCount(21);
  await expect(page.getByText('第 41–60 项，共 65 项', { exact: true })).toBeVisible();
  await pagination.getByRole('button', { name: '第 1 页', exact: true }).click();
  await expect(table(page)).toContainText('手册-6.md');
  expect(requests).toHaveLength(4);
  for (const size of [50, 100]) {
    await page.getByRole('combobox', { name: '每页条数' }).selectOption(String(size));
    await expect(table(page).getByRole('row')).toHaveCount(Math.min(size, 65) + 1);
    await expect(pagination.getByRole('button', { name: '第 1 页', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(new URL(requests.at(-1) ?? '').searchParams.get('limit')).toBe(String(size));
    expect(new URL(requests.at(-1) ?? '').searchParams.has('cursor')).toBe(false);
  }
});

for (const total of [0, 201])
  test(`production custody pagination handles ${total} entries at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await setup(page, { total });
    const pagination = page.getByRole('navigation', { name: '条目清单分页' });
    await expect(pagination).toBeVisible();
    await expect(table(page).getByRole('row')).toHaveCount(Math.min(total, 20) + 1);
    await pagination.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (total === 0) {
      await expect(page.getByText('第 0–0 项，共 0 项', { exact: true })).toBeVisible();
      await expect(pagination.getByRole('button', { name: '下一页' })).toBeDisabled();
    } else {
      await expect(pagination.getByRole('button', { name: '第 11 页', exact: true })).toBeVisible();
      await expect(pagination).toContainText('…');
    }
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath(`pagination-${total}-320.png`),
    });
  });

test('production custody opening a preview cancels the pending page change', async ({ page }) => {
  let release!: () => void;
  const control: Control = {
    hold: {
      number: 5,
      page: true,
      started: false,
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    },
  };
  await setup(page, control, `${projectPath}?batch=${id(15)}`);
  await expect(table(page)).toContainText('手册-5.md');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => control.hold?.started).toBe(true);
  await table(page).getByRole('button', { name: '查看内容' }).first().click();
  await expect(page.getByRole('heading', { name: '第 5 批正文' })).toBeVisible();
  const finished = page.waitForResponse(
    (response) =>
      response.url().includes('/entries?') && new URL(response.url()).searchParams.has('cursor'),
  );
  release();
  await (await finished).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  delete control.hold;
  await page.getByRole('button', { name: '← 返回文件列表' }).click();
  await expect(page.getByRole('button', { name: '第 1 页', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(table(page)).toContainText('手册-5.md');
  await expect(table(page)).not.toContainText('补充-5.md');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '第 2 页', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(table(page)).toContainText('补充-5.md');
});
