import { test, expect, type Page } from '@playwright/test';

const projectId = '0199a000-0000-7000-8000-000000000001';
const batchId = '0199a000-0000-7000-8000-000000000002';
const title = '质量管理体系文件升级与多部门资料整理核对项目'.repeat(2);
const batchName = `quality-management-materials-${'revision-'.repeat(12)}.zip`;
const createdAt = '2026-11-04T00:00:00.000Z';
const project = {
  projectId,
  title,
  customerName: '生产布局回归客户',
  createdAt,
  version: 3,
  lastBatchNo: 1,
};
const batch = {
  batchId,
  projectId,
  batchNo: 1,
  kind: 'INITIAL',
  originalName: batchName,
  declaredBytes: 1024,
  zipSha256: 'a'.repeat(64),
  status: 'REJECTED',
  policyVersion: 'mvp.zip-input@2',
  version: 5,
  createdAt,
  reasonCodes: ['NESTED_ARCHIVE_NOT_ALLOWED'],
};

async function controlledCustody(
  page: Page,
  failure?: { policyVersion: string; violation?: unknown },
) {
  const shownBatch =
    failure === undefined
      ? batch
      : { ...batch, policyVersion: failure.policyVersion, reasonCodes: ['ZIP_LIMIT_EXCEEDED'] };
  // Exercise the production artifact with controlled transport data, without a database.
  await page.route('**/bff/session', (route) =>
    route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'custody-layout',
        csrfToken: 'layout-only',
        principal: { principalId: projectId, principalKind: 'HUMAN', displayName: '布局检查员工' },
      },
    }),
  );
  await page.route('**/bff/mvp/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/read-checks')) {
      await route.fulfill({ json: { ok: true, data: { items: [] } } });
      return;
    }
    const results: Record<string, unknown> = {
      '/bff/mvp/v1/session': {
        ownerId: projectId,
        displayName: '布局检查员工',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      },
      '/bff/mvp/v1/projects': { items: [project] },
      [`/bff/mvp/v1/projects/${projectId}`]: { project },
      [`/bff/mvp/v1/projects/${projectId}/batches`]: { items: [shownBatch] },
      [`/bff/mvp/v1/projects/${projectId}/batches/${batchId}`]: {
        batch: shownBatch,
        attempts: [],
        permittedActions: [],
        ...(failure === undefined
          ? { rejectedArchivePaths: ['资料/inner.rar'] }
          : failure.violation === undefined
            ? {}
            : { limitViolation: failure.violation }),
      },
    };
    expect(route.request().method()).toBe('GET');
    expect(Object.hasOwn(results, path)).toBe(true);
    await route.fulfill({ json: { ok: true, data: results[path] } });
  });
}

async function expectUnobscuredLayout(page: Page) {
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      return element.getBoundingClientRect();
    };
    const app = rect('.app-header');
    const nav = rect('nav[aria-label="主要导航"]');
    const head = rect('.custody-head');
    const grid = rect('.custody-toolbar, .custody-grid');
    const headingChildren = [...document.querySelectorAll('.custody-head > *')].map((element) =>
      element.getBoundingClientRect(),
    );
    const links = [...document.querySelectorAll('nav[aria-label="主要导航"] a')].map((element) =>
      element.getBoundingClientRect(),
    );
    const overlaps = links.some((a, index) =>
      links
        .slice(index + 1)
        .some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
    );
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      navInsideHeader: nav.top >= app.top && nav.bottom <= app.bottom,
      linksDoNotOverlap: !overlaps,
      headerContainsChildren: headingChildren.every(
        (child) => child.top >= head.top && child.bottom <= head.bottom + 1,
      ),
      contentBelowHeading: grid.top >= head.bottom + 16,
    };
  });
  expect(geometry).toEqual({
    pageFits: true,
    navInsideHeader: true,
    linksDoNotOverlap: true,
    headerContainsChildren: true,
    contentBelowHeading: true,
  });
}

for (const view of ['projects', 'project'] as const) {
  test(`production custody ${view} layout keeps navigation and content headers separate`, async ({
    page,
  }) => {
    await controlledCustody(page);
    await page.goto(view === 'project' ? `/custody/projects/${projectId}` : '/custody');
    await expect(
      page.getByRole('heading', {
        name: view === 'project' ? title : '项目与资料托管',
        exact: true,
      }),
    ).toBeVisible();
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav.getByRole('link', { name: '项目与资料' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const width of [1440, 1024, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectUnobscuredLayout(page);
      if (view === 'project') {
        const selectBatch = page.getByRole('combobox', { name: '资料批次' });
        await selectBatch.focus();
        await expect(selectBatch).toBeFocused();
        await selectBatch.selectOption(batchId);
        await expect(page.getByRole('list', { name: '需要移除的压缩文件' })).toContainText(
          '资料/inner.rar',
        );
        await expectUnobscuredLayout(page);
        expect(
          await selectBatch.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
    }
  });
}

for (const width of [1440, 320]) {
  test(`production custody budget details stay truthful and safe at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const cases = [
      [
        { metric: 'ZIP_BYTES', actual: 104857601, limit: 104857600 },
        '压缩文件大小：104,857,601 字节',
      ],
      [{ metric: 'OUTER_ENTRIES', actual: 1001, limit: 1000 }, 'ZIP 目录声明条目数：1,001 条'],
      [
        {
          metric: 'OFFICE_DOCUMENT_ENTRIES',
          actual: 1001,
          limit: 1000,
          documentPath: '资料/<b>file</b>.docx',
        },
        '此文档目录声明的内部部件数：1,001 条',
      ],
      [
        { metric: 'OFFICE_ENTRIES', actual: 20001, limit: 20000 },
        'Office 目录声明的累计内部部件数：20,001 条',
      ],
      [{ metric: 'ENTRY_BYTES', actual: 52428801, limit: 52428800 }, '目录声明的单条目展开大小'],
      [{ metric: 'EXPANDED_BYTES', actual: 524288001, limit: 524288000 }, '目录声明的累计展开大小'],
      [{ metric: 'MEMORY_BYTES', actual: 536870913, limit: 536870912 }, '预计工作内存'],
      [
        { metric: 'PROCESSING_TIME_MS', actual: 120001, limit: 120000 },
        '已用扫描时间：120,001 毫秒',
      ],
      [
        { metric: 'EXPANSION_RATIO', expandedBytes: 101, compressedBytes: 1, limit: 100 },
        '目录声明的展开倍率超限：压缩大小 1 字节，展开大小 101 字节',
      ],
      [
        { metric: 'EXPANSION_RATIO', expandedBytes: 1, compressedBytes: 0, limit: 100 },
        '目录声明的展开倍率超限：压缩大小 0 字节',
      ],
    ] as const;
    for (const [violation, text] of cases) {
      await page.unrouteAll({ behavior: 'wait' });
      await controlledCustody(page, { policyVersion: 'mvp.zip-input@3', violation });
      await page.goto(`/custody/projects/${projectId}`);
      await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
      const alert = page.getByRole('region', { name: '资料包扫描限制' });
      await expect(alert).toContainText(text);
      await expect(alert).toContainText('允许上限');
      await expect(alert.locator('b')).toHaveCount(0);
      if ('documentPath' in violation) await expect(alert).toContainText(violation.documentPath);
      await expectUnobscuredLayout(page);
    }
  });
}

test('production custody keeps legacy refusal details absent and rejects invalid new details', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  for (const policyVersion of ['mvp.zip-input@1', 'mvp.zip-input@2']) {
    await page.unrouteAll({ behavior: 'wait' });
    await controlledCustody(page, { policyVersion });
    await page.goto(`/custody/projects/${projectId}`);
    await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
    await expect(page.getByRole('region', { name: '资料包扫描限制' })).toContainText(
      '此历史批次未记录具体超限项',
    );
  }
  for (const violation of [undefined, { metric: 'OUTER_ENTRIES', actual: 1001, limit: 2000 }]) {
    await page.unrouteAll({ behavior: 'wait' });
    await controlledCustody(page, { policyVersion: 'mvp.zip-input@3', violation });
    await page.goto(`/custody/projects/${projectId}`);
    await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
    await expect(page.getByText('操作未完成（UI_CLIENT_STATE_INVALID）。')).toBeVisible();
    await expect(page.getByRole('region', { name: '资料包扫描限制' })).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});
