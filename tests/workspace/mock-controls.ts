import { expect, type Page } from '@playwright/test';

/** Explicitly configure a synthetic scenario, then return to the product UI. */
export async function withMockControls<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await expect(page.locator('.mock-panel')).toHaveAttribute(
    'data-page',
    new URL(page.url()).pathname,
  );
  const trigger = page.getByRole('button', { name: 'Mock 控制', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const result = await action();
  if (!page.isClosed()) {
    await expect(page.locator('.mock-panel')).toHaveAttribute(
      'data-page',
      new URL(page.url()).pathname,
    );
    if ((await trigger.getAttribute('aria-expanded')) === 'true')
      await page.getByRole('button', { name: '收起 Mock 控制面板' }).click();
  }
  return result;
}
