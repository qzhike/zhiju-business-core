import { expect, type Page } from '@playwright/test';

export async function closeOpinionDrawer(page: Page) {
  const drawer = page.locator('.review-opinion-drawer');
  if (await drawer.isVisible()) {
    await drawer.getByRole('button', { name: '收起本文件意见', exact: true }).click();
    await expect(drawer).toHaveCount(0);
  }
}

export async function submitDetailRound(page: Page) {
  await page.getByRole('button', { name: '核对本轮意见', exact: true }).click();
  const review = page.getByRole('dialog', { name: '核对本轮意见', exact: true });
  await expect(review.getByRole('heading', { name: /本轮文件与版本/u })).toBeVisible();
  await review.getByRole('button', { name: '核对并提交本轮意见并生成下一稿' }).click();
  await expect(review).toHaveCount(0);
  await expect(page.locator('.results-round-status')).toBeFocused();
}
