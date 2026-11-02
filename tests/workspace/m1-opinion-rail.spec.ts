import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { closeOpinionDrawer, submitDetailRound } from './review-helpers.js';

async function openManual(page: Page) {
  await page.goto('/projects/MVP-U1-PROJECT/work');
  await page.getByRole('button', { name: '开始分析资料', exact: true }).click();
  await page.getByLabel('资料问题答复').fill('保留客户质量目标与内部表单。');
  await page.getByRole('button', { name: '提交答复并继续分析', exact: true }).click();
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿', exact: true }).click();
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
}

for (const [width, height, mode] of [
  [1920, 1080, 'wide'],
  [1440, 900, 'medium'],
  [1366, 768, 'medium'],
  [1280, 720, 'medium'],
  // A 1366x768 browser at 125% exposes approximately this CSS viewport.
  [1093, 614, 'drawer'],
  [360, 800, 'drawer'],
  [320, 640, 'drawer'],
] as const) {
  test(`opinion rail supports reading and explicit round review at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await openManual(page);
    await expect(page.locator('.project-catalog')).toBeHidden();
    await expect(page.locator('.markdown-opinion')).toBeHidden();
    await page.getByRole('button', { name: '下一处变化' }).click();
    await page.getByRole('button', { name: '对此处提意见', exact: true }).click();
    await expect(page.locator('#markdown-note')).toBeFocused();
    await expect(page.locator('#markdown-note')).toHaveValue(/精确版本/u);
    await expect(page.locator('.markdown-review')).toHaveAttribute('data-opinion-layout', mode);
    if (mode === 'drawer') {
      await expect(page.getByRole('dialog', { name: '本文件意见', exact: true })).toBeVisible();
      const drawerBox = await page.locator('.review-opinion-drawer').boundingBox();
      expect(drawerBox?.x).toBeGreaterThanOrEqual(0);
      expect(drawerBox?.y).toBe(0);
      expect((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0)).toBeLessThanOrEqual(width);
      await expect(page.locator('.review-opinion-excerpt')).toContainText('文件层级');
    } else {
      await expect(page.locator('.document-diff')).toHaveAttribute(
        'data-layout',
        mode === 'wide' ? 'split' : 'unified',
      );
      const boxes = await page.evaluate(() => {
        const reader = document.querySelector('.markdown-reader')?.getBoundingClientRect();
        const rail = document.querySelector('.markdown-opinion')?.getBoundingClientRect();
        return {
          readerRight: reader?.right ?? 0,
          railLeft: rail?.left ?? 0,
          readerWidth: reader?.width ?? 0,
        };
      });
      expect(boxes.readerRight).toBeLessThan(boxes.railLeft);
      expect(boxes.readerWidth).toBeGreaterThan(600);
    }
    await page.locator('#markdown-note').fill('保留客户质量目标，补充记录编号映射。');
    await page.getByRole('button', { name: '核对本轮意见', exact: true }).click();
    const review = page.getByRole('dialog', { name: '核对本轮意见', exact: true });
    await expect(review).toContainText('质量手册 · V1');
    await expect(review).toContainText('保留客户质量目标，补充记录编号映射。');
    await page.getByRole('button', { name: '返回编辑', exact: true }).click();
    await expect(page.locator('.results-detail-new-version')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '核对本轮意见', exact: true })).toBeFocused();
    await expect(page.locator('#markdown-note')).toHaveValue(
      '保留客户质量目标，补充记录编号映射。',
    );
    const axe = await new AxeBuilder({ page })
      .include(mode === 'drawer' ? '.review-opinion-drawer' : '.results-detail-page')
      .analyze();
    expect(axe.violations).toEqual([]);
    await submitDetailRound(page);
    await expect(page.locator('#markdown-note')).toHaveValue(
      '保留客户质量目标，补充记录编号映射。',
    );
    await expect(page.getByRole('button', { name: '本轮意见已提交', exact: true })).toBeDisabled();
    await closeOpinionDrawer(page);
    await expect(page.locator('.results-detail-new-version')).toContainText('V2');
    await page.getByRole('link', { name: '查看新稿', exact: true }).click();
    await page.getByRole('button', { name: '打开意见与处理' }).click();
    await expect(page.locator('#markdown-note')).toHaveValue('');
    await closeOpinionDrawer(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('rail toggles and resizing preserve reading location, draft and chosen diff layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openManual(page);
  await page.getByRole('button', { name: '统一视图', exact: true }).click();
  await page.getByRole('button', { name: '下一处变化' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('缩放和收起时保留的意见');
  await page.getByRole('button', { name: '收起本文件意见', exact: true }).click();
  await expect(page.locator('.document-diff')).toHaveAttribute('data-layout', 'unified');
  await page.getByRole('button', { name: '并排对照', exact: true }).click();
  await page.getByRole('button', { name: '下一处变化' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('.document-diff')).toHaveAttribute('data-layout', 'unified');
  await page.setViewportSize({ width: 1093, height: 614 });
  await expect(page.getByRole('dialog', { name: '本文件意见', exact: true })).toBeVisible();
  await expect(page.locator('#markdown-note')).toHaveValue('缩放和收起时保留的意见');
  const drawerReadingY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Escape');
  await expect(page.locator('.review-opinion-drawer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开意见与处理' })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - drawerReadingY))
    .toBeLessThan(2);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('.document-diff')).toHaveAttribute('data-layout', 'split');
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('#markdown-note')).toHaveValue('缩放和收起时保留的意见');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.document-diff')).toHaveAttribute('data-layout', 'split');
  await expect(page.locator('#markdown-note')).toHaveValue('缩放和收起时保留的意见');
  await expect(page.locator('.markdown-change-current')).toContainText('当前 3 / 12');
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('round review includes other files and opinions without narrowing submission to the open file', async ({
  page,
}) => {
  await openManual(page);
  await page
    .getByRole('navigation', { name: '项目导航' })
    .getByRole('link', { name: '当前工作', exact: true })
    .click();
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）', exact: true }).click();
  await page.getByRole('button', { name: '生成控制程序初稿', exact: true }).click();
  await page.getByRole('button', { name: '确认本阶段完整集合（模拟）', exact: true }).click();
  await page.getByRole('button', { name: '生成管理制度及记录表单初稿', exact: true }).click();
  const fileLinks = page.locator('.task-stage').getByRole('link', { name: '查看', exact: true });
  expect(await fileLinks.count()).toBeGreaterThan(1);
  await fileLinks.first().click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('第一个文件保留客户职责。');
  await page.getByRole('link', { name: '返回当前工作核对定稿' }).click();
  await fileLinks.nth(1).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('第二个文件补充记录编号。');
  await page.getByRole('button', { name: '核对本轮意见', exact: true }).click();
  const review = page.getByRole('dialog', { name: '核对本轮意见', exact: true });
  await expect(review).toContainText('第一个文件保留客户职责。');
  await expect(review).toContainText('第二个文件补充记录编号。');
  const fileItems = review.locator('ul').first().locator('li');
  expect(await fileItems.count()).toBeGreaterThan(1);
  for (const text of await fileItems.allTextContents()) expect(text).toContain('V1');
  await review.getByRole('button', { name: '核对并提交本轮意见并生成下一稿' }).click();
  await expect(page.locator('.results-round-status')).toBeFocused();
  await expect(page.locator('.results-detail-new-version')).toContainText('V2');
  await page.getByRole('link', { name: '返回当前工作核对定稿' }).click();
  await expect(page.locator('.task-next h2')).toContainText('有新稿可查看');
});
