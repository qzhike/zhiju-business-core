import { test, expect } from '@playwright/test';

const project = '/projects/DEMO-PROJECT-01';
const startup = `${project}/startup/DEMO-STARTUP-REPORT-01`;

test('scope filtering, exact plan opinion, and isolated pending file', async ({ page }) => {
  await page.goto(startup);
  await expect(page.getByRole('heading', { name: '核对信息，选择本轮文件' })).toBeVisible();
  await page.getByRole('combobox', { name: '处理状态' }).selectOption('暂不能处理');
  await expect(page.locator('.file-plan')).toHaveCount(2);
  await page.getByRole('combobox', { name: '处理状态' }).selectOption('全部状态');
  await page
    .locator('.file-plan')
    .filter({ hasText: '纠正措施程序' })
    .getByRole('button', { name: '对这项计划提意见' })
    .click();
  await expect(page).toHaveURL(`${project}/analysis/DEMO-STARTUP-REPORT-01?opinion=1&file=F-CORR`);
  await expect(page.getByRole('region', { name: '上下文意见与补充' })).toContainText(
    '文件计划意见 · 纠正措施程序',
  );
  await page.getByRole('textbox', { name: '说明与意见' }).fill('请复核纠正措施计划');
  await page.getByRole('button', { name: '提交意见并复核' }).click();
  await expect(page.locator('.analysis-receipt')).toContainText('已接收意见');
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择预防措施程序' })).toBeEnabled();
  await expect(page.locator('#scope-reason-DEMO-CORR')).toContainText('等待关联修订计划');
});
