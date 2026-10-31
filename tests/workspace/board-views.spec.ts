import { withMockControls } from './mock-controls.js';
import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const firstProject = 'project:WB-ENTERPRISE-01/DEMO-PROJECT-01';
const longName = '远山科技 · 华东与华南多基地质量体系建设及年度审核资料准备项目';

async function openBoard(page: Page) {
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: '我的工作台' })).toBeVisible();
  await expect(page.locator('.wb-project-card')).toHaveCount(3);
}

function switchView(page: Page, name: '卡片' | '列表') {
  return page.getByRole('group', { name: '项目视图' }).getByRole('button', { name, exact: true });
}

test('cards are the default and an explicit list choice survives the page session', async ({
  page,
}) => {
  await openBoard(page);
  await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'true');
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.wb-project-card')).toHaveCount(3);
  await expect(page.locator('.wb-project-row')).toHaveCount(0);

  await switchView(page, '列表').click();
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'true');
  await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.wb-project-row')).toHaveCount(3);
  await expect(page.locator('.wb-project-card')).toHaveCount(0);
  await expect(switchView(page, '列表')).toBeFocused();

  await page.getByLabel('筛选项目').selectOption(firstProject);
  await expect(page).toHaveURL(/enterprise=WB-ENTERPRISE-01&project=DEMO-PROJECT-01$/u);
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.wb-project-row')).toHaveCount(1);

  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await expect(page).toHaveURL('/workbench');
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'true');

  await page.goBack();
  await expect(page).toHaveURL(/project=DEMO-PROJECT-01$/u);
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/view=|mode=|layout=/u);

  await page.reload();
  await expect(page.locator('.wb-project-card')).toHaveCount(1);
  await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'true');
});

test('switching layout preserves project facts, actions, references, filters and focus', async ({
  page,
}) => {
  await openBoard(page);
  await switchView(page, '列表').click();
  await page.getByLabel('筛选项目').selectOption(firstProject);
  await page.locator('.wb-project-row .wb-project-ref summary').first().click();
  await expect(page.locator('details.wb-project-ref[open]')).toHaveCount(1);
  await page.getByLabel('查找工作').fill('文件');
  const url = page.url();
  const selectedValue = await page.getByLabel('筛选项目').inputValue();
  const listNames = await page.locator('.wb-project-row h3').allTextContents();
  const listRefs = await page.locator('.wb-project-row .wb-project-ref').allTextContents();

  await switchView(page, '卡片').click();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel('筛选项目')).toHaveValue(selectedValue);
  await expect(page.getByLabel('查找工作')).toHaveValue('文件');
  await expect(page.locator('.wb-project-card h3')).toHaveText(listNames);
  await expect(page.locator('.wb-project-card .wb-project-ref')).toHaveCount(listRefs.length);
  await expect(page.locator('details.wb-project-ref[open]')).toHaveCount(1);
  await expect(page.locator('details.wb-project-ref[open]')).toContainText(
    'DEMO-PROJECT-01 · 聚合版本 3',
  );
  await expect(switchView(page, '卡片')).toBeFocused();
  await expect(page.getByRole('button', { name: '收起看板' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('link', { name: '准备项目交付' })).toHaveCount(1);

  await switchView(page, '列表').click();
  await expect(page.getByLabel('筛选项目')).toHaveValue(selectedValue);
  await expect(page.locator('.wb-project-row h3')).toHaveText(listNames);
  await expect(page.locator('details.wb-project-ref[open]')).toHaveCount(1);
  await expect(switchView(page, '列表')).toBeFocused();
  await expect(page).toHaveURL(url);

  // Without a selected project, keep the previously first visible project in view.
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/workbench');
  await expect(page.locator('.wb-project-card')).toHaveCount(3);
  const region = page.locator('.wb-project-scroll');
  await region.evaluate((element) => {
    element.scrollTop = 120;
  });
  const anchor = await region.evaluate((element) => {
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-project-key]'));
    return rows.find((row) => row.offsetTop + row.offsetHeight > element.scrollTop)?.dataset
      .projectKey;
  });
  expect(anchor).toBeTruthy();
  await switchView(page, '列表').click();
  await expect(switchView(page, '列表')).toBeFocused();
  const visible = await region.evaluate((element, key) => {
    const row = element.querySelector<HTMLElement>(`[data-project-key="${key}"]`);
    if (!row) return false;
    const regionBox = element.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return rowBox.top < regionBox.bottom && rowBox.bottom > regionBox.top;
  }, anchor ?? '');
  expect(visible).toBe(true);
});

test('read, empty and failure states stay truthful in both layouts', async ({ page }) => {
  await page.goto('/workbench');
  await withMockControls(page, async () => page.getByText('演示控制', { exact: true }).click());

  await withMockControls(page, async () => page.getByLabel('页面状态').selectOption('loading'));
  await expect(page.getByRole('heading', { name: '正在读取授权项目目录' })).toBeVisible();
  await switchView(page, '列表').click();
  await expect(switchView(page, '列表')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '正在读取授权项目目录' })).toBeVisible();
  await expect(page.locator('.wb-project-row, .wb-project-card')).toHaveCount(0);

  for (const [mode, text] of [
    ['error', '读取失败'],
    ['denied', '拒绝读取'],
    ['expired', '会话过期'],
  ] as const) {
    await withMockControls(page, async () => page.getByLabel('页面状态').selectOption(mode));
    await expect(page.getByRole('alert')).toContainText(text);
    await switchView(page, '卡片').click();
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.locator('.wb-project-row, .wb-project-card')).toHaveCount(0);
    await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'true');
  }

  await withMockControls(page, async () => page.getByLabel('页面状态').selectOption('empty'));
  await expect(page.getByRole('heading', { name: '暂无待处理工作' })).toBeVisible();
  await expect(page.locator('.wb-project-scroll')).toContainText('当前授权范围内没有项目。');
  await switchView(page, '列表').click();
  await expect(page.locator('.wb-project-scroll')).toContainText('当前授权范围内没有项目。');

  await withMockControls(page, async () => page.getByLabel('页面状态').selectOption('stale'));
  await expect(page.locator('.wb-warning')).toContainText('STALE');
  await switchView(page, '卡片').click();
  await expect(page.locator('.wb-warning')).toContainText('STALE');
  await expect(page.locator('.wb-project-card')).toHaveCount(3);
  await expect(page.locator('.wb-projects')).not.toContainText('%');
});

test('both project layouts stay usable at desktop and 360/320 widths', async ({ page }) => {
  test.setTimeout(60_000);
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await openBoard(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const columns = await page
      .locator('.wb-project-card')
      .evaluateAll(
        (cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size,
      );
    expect(columns).toBeGreaterThanOrEqual(2);
    const bounded = await page.locator('.wb-project-scroll').evaluate((element) => ({
      scrolls: element.scrollHeight > element.clientHeight,
      bounded: element.getBoundingClientRect().height <= window.innerHeight * 0.5,
    }));
    expect(bounded.bounded).toBe(true);
    await expect(page.locator('.wb-board')).toBeVisible();
    expect((await new AxeBuilder({ page }).include('.wb-projects').analyze()).violations).toEqual(
      [],
    );
  }

  for (const width of [360, 320] as const) {
    await page.setViewportSize({ width, height: 800 });
    await openBoard(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const cardColumns = await page
      .locator('.wb-project-card')
      .evaluateAll(
        (cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size,
      );
    expect(cardColumns).toBe(1);
    await expect(page.getByRole('heading', { name: longName })).toBeVisible();
    const longTitle = page
      .locator('.wb-project-card', { hasText: '远山科技' })
      .getByRole('heading', { level: 3 });
    expect(
      await longTitle.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);

    await switchView(page, '列表').click();
    await expect(page.locator('.wb-project-row')).toHaveCount(3);
    const list = await page.locator('.wb-project-row').evaluateAll((rows) => ({
      stacked: new Set(rows.map((row) => Math.round(row.getBoundingClientRect().y))).size,
      actions: rows.every(
        (row) =>
          (row.querySelector('.wb-project-actions')?.getBoundingClientRect().height ?? 0) > 0,
      ),
    }));
    expect(list.stacked).toBe(3);
    expect(list.actions).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await switchView(page, '卡片').focus();
    await page.keyboard.press('Enter');
    await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'true');
    expect((await new AxeBuilder({ page }).include('.wb-projects').analyze()).violations).toEqual(
      [],
    );
  }
});

test('production identity invalidation resets the project view preference to cards', async ({
  page,
}) => {
  const enterpriseId = '018f2b9c-1111-7000-8000-000000000001';
  const projectId = '018f2b9c-2222-7000-8000-000000000002';
  let sessionGeneration = 'board-views-1';
  let expired = false;
  const reads: string[] = [];
  await page.route('**/bff/session', async (route) => {
    await route.fulfill({
      json: expired
        ? { accessState: 'SESSION_EXPIRED' }
        : {
            accessState: 'ALLOWED',
            sessionGeneration,
            csrfToken: 'test-only',
            principal: { principalId: projectId, principalKind: 'HUMAN', displayName: '合成顾问' },
          },
    });
  });
  await page.route('**/bff/queries/**', async (route) => {
    const body = route.request().postDataJSON() as { type: string };
    reads.push(body.type);
    if (body.type !== 'project.find_workspace_projects') {
      await route.fulfill({ status: 503, json: { code: 'DEPENDENCY_UNAVAILABLE' } });
      return;
    }
    await route.fulfill({
      json: {
        status: 'OK',
        data: {
          items: [
            {
              enterpriseRef: {
                kind: 'OBJECT',
                objectType: 'enterprise',
                objectId: enterpriseId,
                scope: {},
              },
              projectRef: {
                kind: 'OBJECT',
                objectType: 'project',
                objectId: projectId,
                scope: { enterpriseId, projectId },
              },
              enterpriseDisplayName: '受权客户',
              displayCode: 'P-1',
              title: '精确项目',
              status: 'ACTIVE',
              aggregateVersion: 3,
            },
          ],
        },
      },
    });
  });
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: '受权客户 · 精确项目' })).toBeVisible();
  const readsBeforeSwitch = reads.length;
  await switchView(page, '列表').click();
  await expect(page.locator('.wb-project-row')).toHaveCount(1);
  await switchView(page, '卡片').click();
  await expect(page.locator('.wb-project-card')).toHaveCount(1);
  expect(reads.length).toBe(readsBeforeSwitch);
  await switchView(page, '列表').click();

  expired = true;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('heading', { name: '需要重新登录' })).toBeVisible();

  expired = false;
  sessionGeneration = 'board-views-2';
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('heading', { name: '受权客户 · 精确项目' })).toBeVisible();
  await expect(page.locator('.wb-project-card')).toHaveCount(1);
  await expect(switchView(page, '卡片')).toHaveAttribute('aria-pressed', 'true');
});
