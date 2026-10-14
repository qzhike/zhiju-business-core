import { test, expect } from '@playwright/test';

const project = '/projects/DEMO-PROJECT-01';
const startup = `${project}/startup/DEMO-STARTUP-REPORT-01`;

test('scope filtering, exact plan opinion, and isolated pending file', async ({ page }) => {
  await page.goto(startup);
  await expect(page.getByRole('heading', { name: '核对信息，选择本轮文件' })).toBeVisible();
  await page.getByRole('combobox', { name: '处理状态' }).selectOption('暂不能处理');
  await expect(page.locator('.file-plan')).toHaveCount(2);
  await page.getByRole('combobox', { name: '处理状态' }).selectOption('全部状态');
  await page.getByRole('checkbox', { name: '选择纠正措施程序' }).check();
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
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择预防措施程序' })).toBeEnabled();
  await expect(page.locator('#scope-reason-DEMO-CORR')).toContainText('等待关联修订计划');
  await page.getByRole('checkbox', { name: '选择预防措施程序' }).check();
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeDisabled();
  await page.getByRole('button', { name: '从本轮选择中移除纠正措施程序' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).not.toBeChecked();
  await page.getByRole('button', { name: '确认信息与范围并开始' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('所选 1 份完整计划');
  await page.getByRole('button', { name: '确认并查看演示进度' }).click();
  await expect(page.getByRole('heading', { name: '本轮执行进度' })).toBeVisible();
  await expect(page.locator('.progress-list')).toContainText('预防措施程序');
  await expect(page.locator('.progress-list')).not.toContainText('纠正措施程序');
});

test('UNKNOWN scope intent stays locked across route navigation and queries the original request', async ({
  page,
}) => {
  await page.goto(startup);
  await page.getByRole('checkbox', { name: '选择纠正措施程序' }).check();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem.bind(sessionStorage);
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'zhiju-workspace-development-fixture-v1' && !failed) {
        failed = true;
        throw new Error('INJECTED_FIXTURE_WRITE_FAILURE');
      }
      original(key, value);
    };
  });
  await page.getByRole('button', { name: '确认信息与范围并开始' }).click();
  await page.getByRole('button', { name: '确认并查看演示进度' }).click();
  await page.getByRole('button', { name: '返回核对' }).click();
  await expect(page.getByRole('button', { name: '重新查询原请求' })).toBeVisible();
  await page.getByRole('link', { name: '返回分析总览' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeChecked();
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeDisabled();
  await page.getByRole('button', { name: '重新查询原请求' }).click();
  await expect(page.getByRole('alert')).toContainText('未再次提交');
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeDisabled();
  expect(
    await page.evaluate(() => {
      const raw = sessionStorage.getItem('zhiju-workspace-development-fixture-v1');
      return raw ? (JSON.parse(raw) as { executions: unknown[] }).executions.length : -1;
    }),
  ).toBe(0);
});
