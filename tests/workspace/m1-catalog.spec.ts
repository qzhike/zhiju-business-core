import { withMockControls } from './mock-controls.js';
import { test, expect, type Page } from '@playwright/test';

const base = '/projects/MVP-U1-PROJECT';
const work = `${base}/work`;

function catalog(page: Page) {
  return page.getByRole('navigation', { name: '项目文档' });
}

async function startToManualReview(page: Page) {
  await page.getByRole('button', { name: '开始分析资料' }).click();
  await page
    .getByLabel('资料问题答复')
    .fill('同意四层结构与编号迁移；C04/C05/C07 继续作为内部表单保留。');
  await page.getByRole('button', { name: '提交答复并继续分析' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('确认修改范围');
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮质量手册');
}

async function submitRound(page: Page, label: string, text: string, expectedNext: string) {
  await page.getByLabel(`${label} 本轮意见`).fill(text);
  await page.getByRole('button', { name: /提交 \d+ 条意见并生成下一稿/u }).click();
  await expect(page.locator('.task-next h2')).toHaveText(expectedNext);
}

async function viewNew(page: Page, version: string) {
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-stage')).toContainText(version);
}

async function finalizeStage(page: Page, nextTitle: string) {
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）' }).click();
  await expect(page.locator('.task-next h2')).toHaveText(nextTitle);
}

async function completeToDelivery(page: Page) {
  await startToManualReview(page);
  await submitRound(page, '质量手册', '质量手册意见：保留客户质量目标。', '质量手册有新稿可查看');
  await viewNew(page, '第 2 版候选');
  await submitRound(page, '质量手册', '质量手册意见：补充记录编号映射。', '质量手册有新稿可查看');
  await viewNew(page, '第 3 版候选');
  await finalizeStage(page, '生成控制程序初稿');

  await page.getByRole('button', { name: '生成控制程序初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮控制程序');
  await submitRound(
    page,
    '变更控制程序',
    '控制程序意见：保留客户既有审批职责。',
    '控制程序有新稿可查看',
  );
  await viewNew(page, '第 2 版候选');
  await finalizeStage(page, '生成管理制度及记录表单初稿');

  await page.getByRole('button', { name: '生成管理制度及记录表单初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮管理制度及记录表单');
  await submitRound(
    page,
    '外来文件管理规定',
    '第三阶段意见：核对更新跟踪。',
    '管理制度及记录表单有新稿可查看',
  );
  await viewNew(page, '第 2 版候选');
  await submitRound(
    page,
    '变更申请单',
    '第三阶段第二轮意见：补充风险触发判断。',
    '管理制度及记录表单有新稿可查看',
  );
  await viewNew(page, '第 3 版候选');
  await finalizeStage(page, '核对最终交付清单');
}

test('project catalog stays visible across the page matrix and filters independently', async ({
  page,
}) => {
  const matrix = [
    { path: work, heading: '当前工作' },
    { path: `${base}/overview`, heading: '变更控制体系文件升级' },
    { path: `${base}/intake`, heading: '准备首轮客户资料' },
    { path: `${base}/analysis/U1-REPORT-01`, heading: '分析总览' },
    { path: `${base}/startup/U1-REPORT-02`, heading: '先核对第 2 版分析' },
    { path: `${base}/stages/manual`, heading: '质量手册审阅' },
    { path: `${base}/results`, heading: '处理结果' },
    { path: `${base}/delivery`, heading: '最终交付确认' },
    { path: `${base}/rework`, heading: '返工与复核' },
    { path: `${base}/recovery`, heading: '执行与恢复' },
    { path: `${base}/files`, heading: '全部文件' },
    { path: `${base}/history`, heading: '历史记录' },
  ];
  for (const entry of matrix) {
    await page.goto(entry.path);
    await expect(page.locator('#main h1')).toHaveText(entry.heading);
    await expect(catalog(page)).toBeVisible();
    await expect(
      catalog(page).getByRole('button', { name: '客户原始文档', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
      /原始文档 \d+ 项/u,
    );
  }

  await page.goto(work);
  const list = catalog(page).locator('.project-catalog-list');
  const sizes = await list.evaluate((element) => ({
    scroll: element.scrollHeight,
    client: element.clientHeight,
  }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const catalogBox = await catalog(page).boundingBox();
  const mainBox = await page.locator('.project-workspace-main').boundingBox();
  expect(catalogBox && mainBox).toBeTruthy();
  if (catalogBox && mainBox) {
    expect(catalogBox.x).toBeLessThan(mainBox.x);
    expect(Math.abs(catalogBox.y - mainBox.y)).toBeLessThan(80);
  }

  await catalog(page).getByLabel('搜索名称或编号').fill('损坏');
  await expect(catalog(page).getByRole('button', { name: /^外来标准清单/u })).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: /^质量手册 DOCX/u })).toHaveCount(0);
  await catalog(page).getByRole('button', { name: '清除筛选' }).click();
  await expect(catalog(page).getByRole('button', { name: /^质量手册 DOCX/u })).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: '清除筛选' })).toHaveCount(0);

  await catalog(page).getByRole('link', { name: '清单明细' }).click();
  await expect(page).toHaveURL(`${base}/files`);
  await expect(page.getByRole('heading', { level: 1, name: '全部文件' })).toBeVisible();
  await expect(catalog(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('type switching changes only the list while the reader and task stay intact', async ({
  page,
}) => {
  await page.goto(work);
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(catalog(page).getByText('尚未生成修订文档。')).toBeVisible();
  await expect(
    catalog(page).getByRole('button', { name: '查看客户原始文档', exact: true }),
  ).toBeVisible();
  await catalog(page).getByRole('button', { name: '查看客户原始文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '原始文档 11 项 · 容器 1',
  );

  await startToManualReview(page);
  await expect(
    catalog(page).getByRole('button', { name: '客户原始文档', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '修订文档 1 份 · 版本 1',
  );
  await expect(
    catalog(page).getByRole('button', { name: /质量手册 修订 · 第 1 版候选/u }),
  ).toBeVisible();
  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '原始文档 12 项 · 容器 1',
  );
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(
    catalog(page).getByRole('button', { name: /质量手册 修订 · 第 1 版候选/u }),
  ).toBeVisible();

  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  const readerHeading = await page.locator('.results-detail-head h1').textContent();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('切换文档类型时保留的意见草稿');
  await expect(page.locator('.markdown-draft-state')).toContainText('已保留在本次会话内存');

  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.locator('.results-detail-head h1')).toHaveText(readerHeading ?? '');
  await expect(page.locator('#markdown-note')).toHaveValue('切换文档类型时保留的意见草稿');

  await catalog(page)
    .getByRole('button', { name: /^质量手册 DOCX/u })
    .click();
  await expect(page).toHaveURL(`${base}/results/ANALYSIS-2/C01`);
  await expect(catalog(page).getByRole('button', { name: '查看关联修订文档' })).toBeVisible();
  await catalog(page).getByRole('button', { name: '查看关联修订文档' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);

  await expect(catalog(page).getByRole('button', { name: '查看对应原件' })).toBeVisible();
  await catalog(page).getByRole('button', { name: '查看对应原件' }).click();
  await expect(page).toHaveURL(`${base}/results/ANALYSIS-2/C01`);

  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await catalog(page)
    .getByRole('button', { name: /质量手册 修订 · 第 1 版候选/u })
    .click();
  await catalog(page).getByText('版本与来源（1）').click();
  await catalog(page).getByRole('button', { name: '第 1 版候选 · 当前候选' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);

  await page
    .getByRole('navigation', { name: '项目导航' })
    .getByRole('link', {
      name: '当前工作',
      exact: true,
    })
    .click();
  // The recorded opinion, not the document-type switch, drives the task state.
  await expect(page.locator('.task-next h2')).toHaveText('本轮意见待提交');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('same-stage exact version selection opens the chosen version', async ({ page }) => {
  await page.goto(work);
  await startToManualReview(page);
  await submitRound(page, '质量手册', '质量手册意见：保留客户质量目标。', '质量手册有新稿可查看');
  await viewNew(page, '第 2 版候选');
  await submitRound(page, '质量手册', '质量手册意见：补充记录编号映射。', '质量手册有新稿可查看');
  await viewNew(page, '第 3 版候选');

  await withMockControls(page, async () => {
    await page.locator('.mock-panel details.journey-rehearsal summary').click();
    await page
      .locator('.mock-panel')
      .getByRole('link', { name: '质量手册审阅', exact: true })
      .click();
  });
  await expect(page).toHaveURL(`${base}/stages/manual`);
  await expect(
    catalog(page).getByRole('button', { name: '修订文档', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.stage-set')).toContainText('第 3 版候选');

  // An explicit history-version action opens that exact version, even on the
  // stage page that currently reads V3.
  await catalog(page).getByText('版本与来源（3）').click();
  await catalog(page).getByRole('button', { name: '第 1 版候选 · 历史版本' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.locator('.results-detail-head')).toContainText('第 1 版候选');

  // Ordinary same-stage file selection still keeps the review page in place.
  await page.goBack();
  await expect(page).toHaveURL(`${base}/stages/manual`);
  await catalog(page)
    .getByRole('button', { name: /^质量手册 修订/u })
    .click();
  await expect(page).toHaveURL(`${base}/stages/manual`);
  await expect(page.locator('.stage-set')).toContainText('第 3 版候选');
});

test('completed journey exposes new-file provenance and exact version history', async ({
  page,
}) => {
  await page.goto(work);
  await completeToDelivery(page);

  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText('修订文档 6 份');
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(/已定稿 [1-9]/u);

  await catalog(page)
    .getByRole('button', { name: /^外来文件管理规定/u })
    .click();
  await expect(catalog(page).getByText('无客户原件（新增文件）。')).toBeVisible();

  await catalog(page)
    .getByRole('button', { name: /^质量手册 修订/u })
    .click();
  await catalog(page).getByText('版本与来源（3）').click();
  await expect(catalog(page).getByRole('button', { name: '第 3 版候选 · 已定稿' })).toBeVisible();
  await catalog(page).getByRole('button', { name: '第 1 版候选 · 历史版本' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.locator('.results-detail-head')).toContainText('第 1 版候选');
  await expect(catalog(page).getByRole('button', { name: /^质量手册 修订/u })).toBeVisible();

  await catalog(page)
    .getByRole('button', { name: /^变更控制程序/u })
    .click();
  await expect(page).toHaveURL(/\/results\/PROCEDURES-V2%40U1-PLAN-01-v1\/F-PROCEDURE$/u);
  await expect(page.locator('.results-detail-head')).toContainText('第 2 版候选');

  await withMockControls(page, async () => {
    await page.locator('.mock-panel details.journey-rehearsal summary').click();
    await page
      .locator('.mock-panel')
      .getByRole('link', { name: '质量手册审阅', exact: true })
      .click();
  });
  await expect(page).toHaveURL(`${base}/stages/manual`);
  await catalog(page)
    .getByRole('button', { name: /^变更控制程序/u })
    .click();
  await expect(page).toHaveURL(/\/results\/PROCEDURES-V2%40U1-PLAN-01-v1\/F-PROCEDURE$/u);

  await page
    .getByRole('navigation', { name: '项目导航' })
    .getByRole('link', {
      name: '当前工作',
      exact: true,
    })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
});

test('narrow layouts keep the catalog above the content without page overflow', async ({
  page,
}) => {
  await page.goto(work);
  await startToManualReview(page);
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.locator('.markdown-review-layout')).toBeVisible();
  // Keep the long original list so independent scrolling is measurable, and
  // prove the explicit view choice survives the narrow layouts.
  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(catalog(page)).toBeVisible();
    const catalogBox = await catalog(page).boundingBox();
    const readerBox = await page.locator('.markdown-review-layout').boundingBox();
    expect(catalogBox && readerBox).toBeTruthy();
    if (catalogBox) expect(catalogBox.height).toBeGreaterThan(0);
    const stacked = await page.evaluate(() => {
      const catalogElement = document.querySelector('.project-catalog');
      const readerElement = document.querySelector('.markdown-review-layout');
      if (!catalogElement || !readerElement) return undefined;
      const list = document.querySelector('.project-catalog-list');
      return {
        catalogBeforeReader: Boolean(
          catalogElement.compareDocumentPosition(readerElement) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        catalogPosition: getComputedStyle(catalogElement).position,
        listScrolls: list instanceof HTMLElement && list.scrollHeight > list.clientHeight,
      };
    });
    expect(stacked).toBeTruthy();
    if (stacked) {
      expect(stacked.catalogBeforeReader).toBe(true);
      expect(stacked.catalogPosition).toBe('static');
      expect(stacked.listScrolls).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
    await expect(
      catalog(page).getByRole('button', { name: '客户原始文档', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    catalog(page).getByRole('button', { name: '修订文档', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the catalog only exists inside a selected project', async ({ page }) => {
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { level: 1, name: '我的工作台' })).toBeVisible();
  await expect(catalog(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();

  await page.goto('/projects/OTHER/work');
  await expect(page.getByRole('heading', { level: 1, name: '无法打开此页面' })).toBeVisible();
  await expect(catalog(page)).toHaveCount(0);

  await page.goto('/review-workspace');
  await expect(page.getByRole('heading', { name: /文件检查/u }).first()).toBeVisible();
  await expect(catalog(page)).toHaveCount(0);

  await page.goto(work);
  await expect(catalog(page)).toBeVisible();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText('原始文档 11 项');
  await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();
});
