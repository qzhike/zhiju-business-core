import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { withMockControls } from './mock-controls.js';

async function createProject(page: Page, title: string) {
  await page.getByRole('link', { name: '新建项目', exact: true }).first().click();
  await page.getByRole('button', { name: '新建客户', exact: true }).click();
  await page.getByLabel('客户企业名称').fill(`客户 ${title}`);
  await page.getByLabel('项目名称', { exact: true }).fill(title);
  await page.getByRole('button', { name: '创建项目并继续' }).dblclick();
  await expect(page).toHaveURL(/\/projects\/DEMO-CREATED-[^/]+\/intake$/u);
  return new URL(page.url()).pathname.replace(/\/intake$/u, '');
}

async function prepare(page: Page) {
  const intakeUrl = page.url();
  await page.getByRole('button', { name: '使用示例资料', exact: true }).click();
  await page.getByLabel('补充说明（选填）').fill('保留质量目标与现有职责。');
  await page.getByRole('button', { name: '提交资料', exact: true }).dblclick();
  await expect(page.locator('.intake-receipt')).toContainText('等待安排');
  await expect(page.locator('.intake-continuation')).toContainText('没有读取本地 ZIP');
  await expect(page).toHaveURL(intakeUrl);
  await expect(page.getByRole('button', { name: '开始分析资料' })).toHaveCount(0);
  await page.getByRole('link', { name: '使用示例资料进入当前工作' }).click();
}

async function analyze(page: Page) {
  await page.getByRole('button', { name: '开始分析资料', exact: true }).click();
  await page.getByLabel('资料问题答复').fill('保留质量目标，确认四层编号迁移与现有内部表单。');
  await page.getByRole('button', { name: '提交答复并继续分析' }).click();
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮质量手册');
}

test('new project keeps identity through intake, analysis, review and isolated project returns', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/workbench');
  const first = await createProject(page, '独立项目甲');
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page.locator(`.wb-board-panel a[href="${first}/work"]`).click();
  await expect(page).toHaveURL(`${first}/intake`);
  await expect(page.locator('.project-catalog')).toHaveCount(0);
  await expect(page.locator('.intake-receipt')).toHaveCount(0);
  await prepare(page);
  await expect(page).toHaveURL(`${first}/work`);
  await expect(page.locator('.task-workspace h1')).toHaveText('独立项目甲');
  await expect(page.locator('.task-workspace')).toContainText('客户 独立项目甲');
  await analyze(page);
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  expect(new URL(page.url()).pathname.startsWith(`${first}/results/`)).toBe(true);
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('只属于项目甲的精确版本意见');
  await page.getByRole('button', { name: '收起本文件意见' }).click();
  const second = await createProject(page, '独立项目乙');
  expect(second).not.toBe(first);
  await prepare(page);
  await expect(page.locator('.task-next h2')).toContainText('开始分析');
  await analyze(page);
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('#markdown-note')).toHaveValue('');
  await page.getByRole('button', { name: '收起本文件意见' }).click();
  await page.locator(`.journey-nav a[href="${second}/work"]`).click();
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）' }).click();
  await page.getByRole('button', { name: '生成控制程序初稿', exact: true }).click();
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）' }).click();
  await page.getByRole('button', { name: '生成管理制度及记录表单初稿', exact: true }).click();
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
  await page
    .locator('.task-next')
    .getByRole('button', { name: '确认交付清单并生成文档包', exact: true })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await expect(page.locator(`[data-project-key$="/${second.split('/').at(-1)}"]`)).toContainText(
    '阶段定稿 3/3',
  );
  await expect(page.locator(`[data-project-key$="/${second.split('/').at(-1)}"]`)).toContainText(
    '交付包已生成（模拟）',
  );
  await expect(page.locator(`[data-project-key$="/${first.split('/').at(-1)}"]`)).toContainText(
    '独立项目甲',
  );
  await page.locator(`.wb-board-panel a[href="${first}/work"]`).click();
  await expect(page.locator('.task-workspace h1')).toHaveText('独立项目甲');
  await expect(page.locator('.task-next h2')).toHaveText('本轮意见待提交');
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('#markdown-note')).toHaveValue('只属于项目甲的精确版本意见');
  await page.getByRole('button', { name: '收起本文件意见' }).click();
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page.locator('.wb-board-panel a[href="/projects/MVP-U1-PROJECT/work"]').click();
  await expect(page.locator('.task-next h2')).toContainText('开始分析');
  expect(errors).toEqual([]);
});

test('local ZIP is preserved without claiming its contents; failed and unknown preparation cannot advance', async ({
  page,
}) => {
  await page.goto('/workbench');
  const local = await createProject(page, '本地包项目');
  await page.getByLabel('选择 ZIP 文件', { exact: true }).setInputFiles({
    name: '我的资料.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not parsed'),
  });
  await page.getByLabel('补充说明（选填）').fill('原文说明');
  await withMockControls(page, async () => {
    await page.getByText('演示选项', { exact: true }).click();
    await page.getByLabel('分析场景').selectOption('preparation-failure');
  });
  await page.getByRole('button', { name: '提交资料', exact: true }).click();
  await expect(page.locator('.intake-receipt')).toContainText('资料准备失败');
  await expect(page.getByRole('link', { name: '使用示例资料进入当前工作' })).toHaveCount(0);
  await expect(page.locator('.file-brief')).toContainText('我的资料.zip');
  await withMockControls(page, async () => page.getByLabel('分析场景').selectOption('ready'));
  await page.getByRole('button', { name: '提交资料', exact: true }).click();
  await expect(page.locator('.intake-receipt')).toContainText('等待安排');
  await expect(page.getByLabel('补充说明（选填）')).toHaveValue('原文说明');
  await expect(page.getByLabel('选择 ZIP 文件', { exact: true })).toBeDisabled();
  await expect(page.locator('.intake-batches')).toContainText(
    '合成示例资料（非本地 ZIP 解析结果）',
  );
  await expect(page.locator('.intake-batches')).not.toContainText('我的资料.zip');
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page.locator(`a[href="${local}/delivery"]`).click();
  await expect(page).toHaveURL(`${local}/intake`);
  await expect(page.locator('.intake-continuation')).toContainText('没有读取本地 ZIP');
  await expect(page.getByRole('button', { name: '开始分析资料' })).toHaveCount(0);
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page.locator(`.wb-board-panel a[href="${local}/work"]`).click();
  await expect(page).toHaveURL(`${local}/intake`);
  await expect(page.getByRole('link', { name: '使用示例资料进入当前工作' })).toBeVisible();
  await createProject(page, '结果未知项目');
  await withMockControls(page, async () => {
    await page.getByText('演示选项', { exact: true }).click();
    await page.getByLabel('分析场景').selectOption('unknown');
  });
  await page.getByRole('button', { name: '使用示例资料' }).click();
  await page.getByRole('button', { name: '提交资料', exact: true }).dblclick();
  await expect(page.locator('.intake-receipt')).toContainText('UNKNOWN');
  await expect(page.getByRole('button', { name: '提交资料', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '使用示例资料进入当前工作' })).toHaveCount(0);
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page
    .locator('.wb-board-panel article')
    .filter({ hasText: '结果未知项目 · 当前任务' })
    .getByRole('link', { name: '进入当前工作' })
    .click();
  await expect(page.locator('.intake-receipt')).toContainText('UNKNOWN');
  await expect(page.getByRole('button', { name: '开始分析资料' })).toHaveCount(0);
});

for (const width of [1440, 320]) {
  test(`keyboard submission reaches the next action without stealing moved focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/workbench');
    await createProject(page, '键盘连续操作');
    await page.getByRole('button', { name: '使用示例资料', exact: true }).click();
    await page.getByLabel('补充说明（选填）').fill('以键盘提交');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '提交资料', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.intake-receipt [role="status"]')).toHaveText('已接收，等待安排');
    await expect(page.locator('.intake-receipt [role="status"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '使用示例资料进入当前工作' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '开始分析资料' })).toBeVisible();

    await createProject(page, '保留用户焦点');
    await page.getByRole('button', { name: '使用示例资料', exact: true }).click();
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.getByRole('button', { name: '提交资料', exact: true }).click();
    await page.getByText('项目归属信息', { exact: true }).click();
    await expect(page.getByText('项目归属信息', { exact: true })).toBeFocused();
    await page.clock.runFor(800);
    await expect(page.locator('.intake-receipt [role="status"]')).toHaveText('已接收，等待安排');
    await expect(page.getByText('项目归属信息', { exact: true })).toBeFocused();
  });
}

for (const [width, height] of [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [360, 800],
  [320, 640],
] as const) {
  test(`creation and intake reflow with natural height at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/workbench');
    await page.getByRole('link', { name: '新建项目', exact: true }).first().click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: '新建客户', exact: true }).click();
    await page.getByLabel('客户企业名称').fill('跨地区多基地客户');
    await page
      .getByLabel('项目名称', { exact: true })
      .fill('跨地区多基地质量体系建设及年度审核资料准备项目');
    await page.getByRole('button', { name: '创建项目并继续' }).click();
    await page.getByRole('button', { name: '使用示例资料' }).click();
    await page.getByRole('button', { name: '提交资料', exact: true }).click();
    await expect(page.locator('.intake-batches')).toBeVisible();
    expect(
      await page.locator('.intake-page').evaluate((element) => ({
        maxHeight: getComputedStyle(element).maxHeight,
        overflowY: getComputedStyle(element).overflowY,
      })),
    ).toEqual({ maxHeight: 'none', overflowY: 'visible' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('link', { name: '使用示例资料进入当前工作' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '开始分析资料' })).toBeVisible();
  });
}
