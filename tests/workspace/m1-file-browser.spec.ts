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

async function expandOriginalDirectory(page: Page, label: string) {
  const batch = catalog(page).getByRole('button', { name: '首轮资料', exact: true });
  if ((await batch.getAttribute('aria-expanded')) !== 'true') await batch.click();
  const directory = catalog(page).getByRole('button', { name: label, exact: true });
  if ((await directory.getAttribute('aria-expanded')) !== 'true') await directory.click();
}

function directoryRows(page: Page, label: string) {
  return page
    .locator('.browser-row', {
      has: page.locator('> .browser-folder-line > .browser-folder', { hasText: label }),
    })
    .locator('.browser-document .browser-name');
}

async function namesIn(page: Page, label: string) {
  return directoryRows(page, label).allTextContents();
}

test('current work splits 50:50 with independent scrolling and a stacked narrow catalog', async ({
  page,
}) => {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(work);
    await expect(page.locator('.project-workspace')).toHaveClass(/is-current-work/u);
    const widths = await page.evaluate(() => {
      const catalogElement = document.querySelector('.project-catalog');
      const mainElement = document.querySelector('.project-workspace-main');
      if (!catalogElement || !mainElement) return undefined;
      return {
        catalog: catalogElement.getBoundingClientRect().width,
        main: mainElement.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(widths).toBeTruthy();
    if (widths) {
      expect(Math.abs(widths.catalog - widths.main)).toBeLessThanOrEqual(1);
      expect(widths.overflow).toBe(true);
    }
    await expect(catalog(page).getByLabel('排序')).toBeVisible();
    await expect(catalog(page).getByText('时间 UTC+08:00（模拟）')).toBeVisible();
    await expect(page.locator('.task-workspace')).toBeVisible();

    await expandOriginalDirectory(page, '记录表单');
    const head = await catalog(page).locator('.project-catalog-head').boundingBox();
    const list = catalog(page).locator('.project-catalog-list');
    expect(await list.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    await list.evaluate((element) => {
      element.scrollTop = 120;
    });
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const after = await catalog(page).locator('.project-catalog-head').boundingBox();
    expect(after?.y).toBe(head?.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  for (const width of [360, 320] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(work);
    await expandOriginalDirectory(page, '记录表单');
    const layout = await page.evaluate(() => {
      const catalogElement = document.querySelector('.project-catalog');
      const mainElement = document.querySelector('.project-workspace-main');
      if (!catalogElement || !mainElement) return undefined;
      return {
        above:
          catalogElement.getBoundingClientRect().top <= mainElement.getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    expect(layout?.above).toBe(true);
    expect(layout?.overflow).toBe(true);
    const row = page.locator('.browser-document').first();
    await expect(row.locator('.browser-name')).toBeVisible();
    await expect(row.locator('.browser-time')).toHaveText(/2026-10-\d{2} \d{2}:\d{2}/u);
    await expect(row.locator('.browser-author')).not.toBeEmpty();
    await expect(row.locator('.browser-subline')).toContainText('原件');
    await row.locator('.browser-info').click();
    await expect(page.locator('.project-file-info')).toBeVisible();
    await expect(page.locator('.project-file-info')).toContainText('完整路径');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test('hierarchy, sibling sorting, filename activation and info selection stay independent', async ({
  page,
}) => {
  await page.goto(work);
  await expandOriginalDirectory(page, '记录表单');
  const nameAsc = [...(await namesIn(page, '记录表单'))].sort((left, right) =>
    left.localeCompare(right, 'zh-Hans-CN'),
  );
  await expect(namesIn(page, '记录表单')).resolves.toEqual(nameAsc);

  await catalog(page).getByRole('button', { name: '升序 ↑' }).click();
  await expect(namesIn(page, '记录表单')).resolves.toEqual([...nameAsc].reverse());

  await catalog(page).getByLabel('排序').selectOption('MODIFIED');
  await expect(namesIn(page, '记录表单')).resolves.toEqual([
    '变更申请单 DOCX',
    '变更编号说明.md',
    '变更关闭记录 DOCX',
    '变更评审记录 DOCX',
    '变更实施方案确认记录 DOCX',
    '变更影响评估表 DOCX',
  ]);
  await catalog(page).getByRole('button', { name: '降序 ↓' }).click();
  await expect(namesIn(page, '记录表单')).resolves.toEqual([
    '变更影响评估表 DOCX',
    '变更实施方案确认记录 DOCX',
    '变更评审记录 DOCX',
    '变更关闭记录 DOCX',
    '变更编号说明.md',
    '变更申请单 DOCX',
  ]);

  // Unknown times stay after comparable timestamps in both directions.
  await expandOriginalDirectory(page, '历史记录');
  const history = await namesIn(page, '历史记录');
  expect(history[0]).toContain('变更历史（嵌套 RAR）');
  expect(history.at(-1)).toMatch(/变更记录 2024|变更台账 2024/u);

  await catalog(page).getByRole('button', { name: '升序 ↑' }).click();
  const historyDesc = await namesIn(page, '历史记录');
  expect(historyDesc[0]).toContain('变更历史（嵌套 RAR）');
  expect(historyDesc.at(-1)).toMatch(/变更记录 2024|变更台账 2024/u);

  const infoRow = page.locator('.browser-document', { hasText: '变更申请单 DOCX' });
  await infoRow.locator('.browser-info').click();
  await expect(page).toHaveURL(work);
  await expect(page.locator('.project-file-info')).toContainText('记录表单/变更申请单 DOCX');
  await expect(page.locator('.project-file-info')).toContainText('33.3 KB');

  await expandOriginalDirectory(page, '质量手册');
  await page
    .locator('.browser-document', { hasText: '质量手册 DOCX' })
    .locator('.browser-name')
    .click();
  await expect(page).toHaveURL(`${base}/results/ANALYSIS-1/C01`);
  await expect(page.locator('.results-detail-head')).toContainText('质量手册/质量手册 DOCX');

  await page.goBack();
  await expect(page).toHaveURL(work);
  await expect(catalog(page).getByLabel('排序')).toHaveValue('MODIFIED');
  await expect(catalog(page).getByRole('button', { name: '降序 ↓' })).toBeVisible();
  await expect(
    catalog(page).getByRole('button', { name: '记录表单', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(catalog(page).getByLabel('搜索名称或编号')).toHaveValue('');
  await expect(page.locator('.task-next h2')).toHaveText('开始分析资料');
});

test('original metadata separates file records, containers, failures and sizes', async ({
  page,
}) => {
  await page.goto(work);
  await expandOriginalDirectory(page, '质量手册');
  const manual = page.locator('.browser-document', { hasText: '质量手册 DOCX' });
  await expect(manual.locator('.browser-time')).toHaveText('2026-10-18 14:05');
  await expect(manual.locator('.browser-author')).toHaveText('文件记录 · 匿名客户（模拟）');
  await expect(manual.locator('.browser-subline')).toContainText('DOCX · 170.4 KB');
  await manual.locator('.browser-info').click();
  await expect(page.locator('.project-file-info')).toContainText('批次提交 2026-10-20 09:10');
  await expect(page.locator('.project-file-info')).toContainText('显示时区 UTC+08:00');
  await expect(page.locator('.project-file-info')).toContainText('初始作者/上传人不替代最后修改者');

  await expandOriginalDirectory(page, '历史记录');
  const container = page.locator('.browser-document', { hasText: '变更历史（嵌套 RAR）' });
  await expect(container.locator('.browser-time')).toHaveText('2026-10-16 08:50');
  for (const name of ['变更记录 2024（RAR 内 DOCX）', '变更台账 2024（RAR 内 DOCX）']) {
    const member = page.locator('.browser-document', { hasText: name });
    await expect(member.locator('.browser-time')).toHaveText('未提供');
    await expect(member.locator('.browser-author')).toHaveText('未提供');
  }

  await expandOriginalDirectory(page, '外来文件');
  const damaged = page.locator('.browser-document', { hasText: '外来标准清单（损坏）.docx' });
  await expect(damaged.locator('.browser-time')).toHaveText('读取失败');
  await expect(damaged.locator('.browser-author')).toHaveText('读取失败');
  await expect(page.locator('.browser-folder-line').first()).toContainText('不适用');
});

test('revision metadata binds exact versions while opinions and finalization stay separate', async ({
  page,
}) => {
  await page.goto(work);
  await startToManualReview(page);
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  const document = page.locator('.browser-document', { hasText: '质量手册' }).first();
  await expect(document.locator('.browser-time')).toHaveText('2026-10-29 09:20');
  await expect(document.locator('.browser-author')).toHaveText('AI 生成（模拟）');
  await expect(document.locator('.browser-subline')).toContainText('第 1 版候选 · 当前候选');
  await expect(document.locator('.browser-subline')).toContainText(/· \d+\.\d KB/u);

  await page.getByLabel('质量手册 本轮意见').fill('质量手册意见：保留客户质量目标。');
  await page.getByRole('button', { name: /提交 \d+ 条意见并生成下一稿/u }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册有新稿可查看');
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-stage')).toContainText('第 2 版候选');

  const latest = page.locator('.browser-document', { hasText: '质量手册' }).first();
  await expect(latest.locator('.browser-time')).toHaveText('2026-10-29 11:20');
  await expect(latest.locator('.browser-author')).toHaveText('AI 生成（模拟）');
  await expect(latest.locator('.browser-subline')).toContainText('第 2 版候选 · 当前候选');

  const v1 = page.locator('.browser-document', { hasText: '第 1 版候选' }).first();
  await v1.locator('.browser-info').click();
  await expect(page.locator('.project-file-info')).toContainText('意见发起：示例顾问（模拟）');
  await expect(page.locator('.project-file-info')).toContainText('U2-REV-');
  await expect(page.locator('.project-file-info')).toContainText('2026-10-29 09:20');
  await expect(page.locator('.project-file-info')).not.toContainText('定稿记录');

  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('生成控制程序初稿');
  await expect(latest.locator('.browser-subline')).toContainText('已定稿');
  await expect(latest.locator('.browser-time')).toHaveText('2026-10-29 11:20');
  await expect(latest.locator('.browser-author')).toHaveText('AI 生成（模拟）');
  await latest.locator('.browser-info').click();
  await expect(page.locator('.project-file-info')).toContainText('定稿记录');

  await catalog(page)
    .getByRole('button', { name: /^质量手册 修订/u })
    .click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V2%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.locator('.results-detail-head')).toContainText('第 2 版候选');
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('保留的阅读草稿');
  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await expect(page.locator('#markdown-note')).toHaveValue('保留的阅读草稿');
  await expect(page).toHaveURL(/\/results\/MANUAL-V2%40U1-PLAN-01-v1\/F-MANUAL$/u);
});

test('counts, retained originals, planned exclusion and project isolation stay truthful', async ({
  page,
}) => {
  await page.goto(work);
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '原始文档 11 项 · 容器 1 · 只读',
  );
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(catalog(page).getByText('尚未生成修订文档。')).toBeVisible();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText('修订文档 0 份');

  await startToManualReview(page);
  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '原始文档 12 项 · 容器 1',
  );
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(catalog(page).locator('.project-catalog-counts')).toContainText(
    '修订文档 1 份 · 版本 1',
  );
  await expect(catalog(page).locator('.browser-document')).toHaveCount(2);

  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await expandOriginalDirectory(page, '记录表单');
  for (const name of ['变更影响评估表 DOCX', '变更实施方案确认记录 DOCX', '变更关闭记录 DOCX']) {
    await expect(page.locator('.browser-document', { hasText: name })).toContainText('沿用原件');
  }

  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await page.locator('.browser-document .browser-info').first().click();
  await expect(page.locator('.project-file-info')).toContainText('F-MANUAL');
  await expect(page.locator('.project-file-info')).toContainText('查看对应原件');

  await page.goto('/workbench');
  await expect(page.locator('.project-catalog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mock 控制', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.goto('/projects/OTHER/work');
  await expect(page.locator('.project-catalog')).toHaveCount(0);
});

test('archive members appear only under their container and disappear on collapse', async ({
  page,
}) => {
  await page.goto(work);
  await expandOriginalDirectory(page, '历史记录');
  await expect(page.locator('.browser-document')).toHaveCount(12);
  const directory = page.locator('.browser-row', {
    has: page.locator('> .browser-folder-line > .browser-folder', { hasText: '历史记录' }),
  });
  await expect(directory.locator('.browser-document')).toHaveCount(3);
  const container = directory.locator('.browser-document', { hasText: '变更历史（嵌套 RAR）' });
  await expect(container).toBeVisible();
  await container.locator('.browser-expander').click();
  await expect(directory.locator('.browser-document', { hasText: '变更记录 2024' })).toHaveCount(0);
  await expect(directory.locator('.browser-document', { hasText: '变更台账 2024' })).toHaveCount(0);
  await expect(container).toBeVisible();
});

test('version info selection keeps the chosen historical row pressed and parent unselected', async ({
  page,
}) => {
  await page.goto(work);
  await startToManualReview(page);
  await page.getByLabel('质量手册 本轮意见').fill('质量手册意见：保留客户质量目标。');
  await page.getByRole('button', { name: /提交 \d+ 条意见并生成下一稿/u }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册有新稿可查看');
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-stage')).toContainText('第 2 版候选');
  await page.getByLabel('质量手册 本轮意见').fill('质量手册意见：补充记录编号映射。');
  await page.getByRole('button', { name: /提交 \d+ 条意见并生成下一稿/u }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册有新稿可查看');
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-stage')).toContainText('第 3 版候选');

  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  const v1 = page.locator('.browser-document', { hasText: '第 1 版候选' }).first();
  await v1.locator('.browser-info').click();
  await expect(v1.locator('.browser-info')).toHaveAttribute('aria-pressed', 'true');
  const parent = page.locator('.browser-document', { hasText: '质量手册' }).first();
  await expect(parent.locator('.browser-info')).toHaveAttribute('aria-pressed', 'false');
  await expect(parent).not.toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.project-file-info')).toContainText('第 1 版候选 · 历史版本');
  await expect(page.locator('.project-file-info')).toContainText('2026-10-29 09:20');

  await catalog(page).getByLabel('排序').selectOption('MODIFIED');
  await expect(v1.locator('.browser-info')).toHaveAttribute('aria-pressed', 'true');
  await catalog(page).getByRole('button', { name: '客户原始文档', exact: true }).click();
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  await expect(v1.locator('.browser-info')).toHaveAttribute('aria-pressed', 'true');
  await expect(parent.locator('.browser-info')).toHaveAttribute('aria-pressed', 'false');
});

test('revision size uses exact Markdown bytes instead of flattened unit text', async ({ page }) => {
  await page.goto(work);
  await startToManualReview(page);
  await catalog(page).getByRole('button', { name: '修订文档', exact: true }).click();
  const v1 = page.locator('.browser-document', { hasText: '质量手册' }).first();
  await expect(v1.locator('.browser-subline')).toContainText('1.0 KB');

  await page.getByLabel('质量手册 本轮意见').fill('质量手册意见：保留客户质量目标。');
  await page.getByRole('button', { name: /提交 \d+ 条意见并生成下一稿/u }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册有新稿可查看');
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-stage')).toContainText('第 2 版候选');
  const v2 = page.locator('.browser-document', { hasText: '质量手册' }).first();
  await expect(v2.locator('.browser-subline')).toContainText('1.3 KB');
});
