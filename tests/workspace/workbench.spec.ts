import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';

test('workbench built fixture: exact links, recent access and return context', async ({ page }) => {
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: '我的工作台' })).toBeVisible();
  const completed = page.locator('.wb-completed');
  await expect(completed).not.toHaveAttribute('open', '');
  await page.getByLabel('筛选项目').selectOption('project:WB-ENTERPRISE-01/DEMO-PROJECT-01');
  await page.getByLabel('查找工作').fill('文件');
  await completed.locator('summary').click();
  const card = page.getByRole('article', { name: '体系文件升级 · 文件进度', exact: true });
  await card.getByRole('link', { name: '检查文件' }).click();
  await expect(page).toHaveURL(/\/files\/WB-FILE-01\/revisions\/WB-REVISION-03$/u);
  await expect(page.getByRole('status')).toContainText('WB-REVISION-03');
  await expect(page.getByRole('status')).toContainText('不可用');
  await page.goBack();
  await expect(page.getByLabel('筛选项目')).toHaveValue('project:WB-ENTERPRISE-01/DEMO-PROJECT-01');
  await expect(page.getByLabel('查找工作')).toHaveValue('文件');
  await expect(completed).toHaveAttribute('open', '');
  await expect(card.getByRole('link', { name: '检查文件' })).toBeFocused();
  await expect(page.locator('.wb-recent')).toContainText('检查文件');
  await expect(page.locator('.wb-recent')).not.toContainText('继续工作');
  await page.getByLabel('查找工作').clear();
  await page.getByRole('link', { name: '提交客户资料' }).click();
  await expect(page).toHaveURL(/\/projects\/DEMO-PROJECT-01\/intake$/u);
});

test('workbench candidate and report updates preserve focus, input, original cards and another page', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/workbench');
  await page.getByText('演示控制', { exact: true }).click();
  const card = page.getByRole('article', { name: '体系文件升级 · 文件进度', exact: true });
  await expect(card).toContainText('待检查 3 份');
  await page.getByRole('button', { name: '延迟返回一份候选' }).click();
  const search = page.getByLabel('查找工作');
  await search.fill('体系');
  await page.clock.fastForward(1600);
  await expect(card).toContainText('待检查 4 份');
  await expect(card).toContainText('处理中 6 份');
  await expect(search).toHaveValue('体系');
  await expect(search).toBeFocused();
  await expect(card).toHaveCount(1);
  await expect(page).toHaveURL('/workbench');
  await page.getByRole('button', { name: '延迟返回新报告' }).click();
  await page
    .getByRole('article', { name: '体系文件升级 · 分析报告', exact: true })
    .getByRole('link', { name: '查看分析报告' })
    .click();
  const reportUrl = page.url();
  await page.getByRole('link', { name: '核对信息与文件范围' }).click();
  const fileSearch = page.getByRole('searchbox', { name: '查找文件' });
  await fileSearch.fill('纠正');
  const scopeUrl = page.url();
  await page.clock.fastForward(1600);
  await expect(page).toHaveURL(scopeUrl);
  await expect(fileSearch).toHaveValue('纠正');
  await expect(fileSearch).toBeFocused();
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await expect(
    page.getByRole('article', { name: '体系文件升级 · 分析报告', exact: true }),
  ).toContainText('第 2 版报告已到达');
  await expect(
    page.getByRole('article', { name: '体系文件升级 · 分析报告', exact: true }),
  ).toHaveCount(1);
  await page
    .getByRole('article', { name: '体系文件升级 · 分析报告', exact: true })
    .getByRole('link', { name: '查看分析报告' })
    .click();
  await expect(page).toHaveURL(reportUrl);
});

test('workbench restores the bounded reading position after opening a precise work entry', async ({
  page,
}) => {
  await page.goto('/workbench');
  const list = page.getByRole('region', { name: '需要你工作列表', exact: true });
  await expect(list).toBeVisible();
  await list.evaluate((element) => {
    element.scrollTop = 100;
  });
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(100);
  const link = page
    .getByRole('article', { name: '体系文件升级 · 文件进度', exact: true })
    .getByRole('link', { name: '检查文件' });
  await link.focus();
  const position = await list.evaluate((element) => element.scrollTop);
  await link.press('Enter');
  await expect(page.getByRole('heading', { name: '检查文件' })).toBeVisible();
  await page.goBack();
  await expect(link).toBeFocused();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(position);
});

test('workbench built viewport matrix, keyboard navigation and negative states', async ({
  page,
  browser,
}) => {
  console.log(`Workbench controlled Chromium ${browser.version()}; synthetic page evidence only`);
  await page.goto('/workbench');
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width: width, height: height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByLabel('筛选项目')).toBeVisible();
    if (width > 700) expect(await page.locator('.wb-board > section:visible').count()).toBe(3);
    else {
      const waiting = page.getByRole('button', { name: '待开始 ·' });
      await waiting.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('region', { name: '待开始', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: '需要你', exact: true })).not.toBeVisible();
    }
    await page.screenshot({
      path: `test-results/workbench-${width}x${height}.png`,
      fullPage: true,
    });
  }
  await page.getByText('演示控制', { exact: true }).click();
  await page.getByLabel('页面状态').selectOption('loading');
  await expect(page.getByRole('heading', { name: '正在读取授权项目目录' })).toBeVisible();
  await expect(page.locator('.wb-card')).toHaveCount(0);
  for (const [mode, text] of [
    ['error', '读取失败'],
    ['denied', '拒绝读取'],
    ['expired', '会话过期'],
  ] as const) {
    await page.getByLabel('页面状态').selectOption(mode);
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.locator('.wb-card')).toHaveCount(0);
  }
  await page.getByLabel('页面状态').selectOption('empty');
  await expect(page.getByRole('heading', { name: '暂无待处理工作' })).toBeVisible();
  await page.getByLabel('页面状态').selectOption('stale');
  await expect(page.locator('.wb-warning')).toContainText('STALE');
  await page.getByLabel('页面状态').selectOption('mixed');
  await page.getByLabel('查找工作').fill('不存在的工作');
  await expect(page.locator('.wb-column:visible')).toContainText('没有匹配的工作');
  await page.getByRole('button', { name: '清除搜索' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('production workbench excludes its development adapter and registers exact page boundaries', async ({
  page,
}) => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'WB-ENTERPRISE-01',
      'DEVELOPMENT_WORKBENCH_ADAPTER_MISSING',
      'M1 连续演练',
      '延迟返回一份候选',
    ])
      expect(source.includes(marker), `Production bundle must exclude ${marker}`).toBe(false);
  }
  for (const path of [
    '/projects/p/delivery',
    '/projects/p/tasks/t?version=3',
    '/projects/p/files/f/revisions/r',
  ]) {
    expect((await page.request.get(path, { headers: { Accept: 'text/html' } })).status()).toBe(200);
  }
  expect(
    (
      await page.request.get('/projects/p/files/f/revisions/r/anything', {
        headers: { Accept: 'text/html' },
      })
    ).status(),
  ).toBe(404);
});

test('production workbench uses authorized project reads with independent failure, freshness and session cleanup', async ({
  page,
}) => {
  // Controlled transport responses exercise the production artifact, not real OIDC/Core acceptance.
  const enterpriseId = '018f2b9c-1111-7000-8000-000000000001';
  const projectId = '018f2b9c-2222-7000-8000-000000000002';
  const taskId = '018f2b9c-3333-7000-8000-000000000003';
  let expired = false;
  let denied = false;
  const reads: string[] = [];
  await page.route('**/bff/session', async (route) => {
    await route.fulfill({
      json: expired
        ? { accessState: 'SESSION_EXPIRED' }
        : {
            accessState: 'ALLOWED',
            sessionGeneration: 'workbench-test',
            csrfToken: 'test-only',
            principal: { principalId: taskId, principalKind: 'HUMAN', displayName: '合成顾问' },
          },
    });
  });
  await page.route('**/bff/queries/**', async (route) => {
    const body = route.request().postDataJSON() as { type: string; scopeRef: unknown };
    reads.push(body.type);
    if (body.type === 'project.find_workspace_projects') {
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
      return;
    }
    expect(body.scopeRef).toEqual({ enterpriseId, projectId });
    if (body.type === 'execution.get_task_board_slice') {
      if (denied) await route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } });
      else
        await route.fulfill({
          json: {
            status: 'STALE',
            stalenessStatus: 'STALE',
            data: {
              items: [
                {
                  taskRef: {
                    kind: 'OBJECT',
                    objectType: 'task',
                    objectId: taskId,
                    scope: { enterpriseId, projectId },
                  },
                  title: '等待客户输入',
                  status: 'WAITING_INPUT',
                  aggregateVersion: 7,
                  blockerRefs: [],
                },
              ],
              snapshotAt: '2026-10-13T01:00:00Z',
              sourceWatermarks: [{ sourceModule: 'task-execution', sequence: 41 }],
            },
          },
        });
    } else await route.fulfill({ status: 503, json: { code: 'DEPENDENCY_UNAVAILABLE' } });
  });
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: '受权客户 · 精确项目' })).toBeVisible();
  expect(reads.every((operation) => operation === 'project.find_workspace_projects')).toBe(true);
  await page.getByRole('button', { name: '查看该项目看板' }).click();
  await expect(page.getByRole('article', { name: '等待客户输入', exact: true })).toContainText(
    '等待输入',
  );
  await expect(page.locator('.wb-sources')).toContainText('滞后');
  await expect(page.locator('.wb-sources')).toContainText('DEPENDENCY_UNAVAILABLE');
  await expect(page.locator('.wb-sources')).toContainText('task-execution#41');
  await page.getByRole('link', { name: '查看任务入口' }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?version=7$`, 'u'));
  await expect(page.getByRole('status')).toContainText('任务引用不等于执行请求');
  await page.goBack();
  await expect(page.getByRole('article', { name: '等待客户输入', exact: true })).toBeVisible();
  denied = true;
  await page.reload();
  await expect(page.locator('.wb-sources')).toContainText('ACCESS_DENIED');
  await expect(page.locator('.wb-card')).toHaveCount(0);
  expired = true;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('heading', { name: '需要重新登录' })).toBeVisible();
  await expect(page.locator('.wb-recent')).toHaveCount(0);
  await expect(page.getByText('受权客户', { exact: false })).toHaveCount(0);
});

test('production project switching discards a late board response from the previous scope', async ({
  page,
}) => {
  const enterpriseId = '018f2b9c-1111-7000-8000-000000000001';
  const first = '018f2b9c-2222-7000-8000-000000000002';
  const second = '018f2b9c-2222-7000-8000-000000000003';
  const task = '018f2b9c-3333-7000-8000-000000000004';
  let firstStarted = false;
  let release = () => {
    /* Replaced by the deferred response below. */
  };
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/bff/session', async (route) => {
    await route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'switch-test',
        csrfToken: 'test-only',
        principal: { principalId: task, principalKind: 'HUMAN' },
      },
    });
  });
  await page.route('**/bff/queries/**', async (route) => {
    const body = route.request().postDataJSON() as {
      type: string;
      scopeRef: { projectId?: string };
    };
    if (body.type === 'project.find_workspace_projects') {
      await route.fulfill({
        json: {
          status: 'OK',
          data: {
            items: [first, second].map((projectId, index) => ({
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
              enterpriseDisplayName: '合成客户',
              displayCode: `P-${index}`,
              title: `项目 ${index}`,
              status: 'ACTIVE',
              aggregateVersion: 1,
            })),
          },
        },
      });
      return;
    }
    if (body.type === 'project.get_project_board_slice') {
      await route.fulfill({ json: { status: 'OK', data: { items: [] } } });
      return;
    }
    if (body.scopeRef.projectId === first) {
      firstStarted = true;
      await pending;
    }
    await route.fulfill({
      json: {
        status: 'OK',
        data: {
          items: [
            {
              taskRef: {
                kind: 'OBJECT',
                objectType: 'task',
                objectId: task,
                scope: { enterpriseId, projectId: body.scopeRef.projectId },
              },
              title: body.scopeRef.projectId === first ? '旧项目迟到任务' : '当前项目任务',
              status: 'IN_PROGRESS',
              aggregateVersion: 2,
              blockerRefs: [],
            },
          ],
        },
      },
    });
  });
  await page.goto('/workbench');
  await page.getByLabel('筛选项目').selectOption(`project:${enterpriseId}/${first}`);
  await expect.poll(() => firstStarted).toBe(true);
  await page.getByLabel('筛选项目').selectOption(`project:${enterpriseId}/${second}`);
  await expect(page.getByRole('article', { name: '当前项目任务', exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().includes('execution.get_task_board_slice') &&
      response.request().postData()?.includes(first) === true,
  );
  release();
  await lateResponse;
  await expect(page.getByRole('article', { name: '旧项目迟到任务', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('筛选项目')).toBeFocused();
  await expect(page.getByLabel('筛选项目')).toHaveValue(`project:${enterpriseId}/${second}`);
});
