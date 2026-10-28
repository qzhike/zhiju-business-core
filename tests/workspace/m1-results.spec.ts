import { test, expect, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

const base = '/projects/MVP-U1-PROJECT';
const reportOne = `${base}/analysis/U1-REPORT-01`;
const plan = `${base}/startup/U1-REPORT-02`;
const manual = `${base}/stages/manual`;
const results = `${base}/results`;
const manualV1 = 'MANUAL-V1@U1-PLAN-01-v1';
const manualV2 = 'MANUAL-V2@U1-PLAN-01-v1';

async function openAnalysisControls(page: Page) {
  const details = page.locator('details.fixture-options', { hasText: 'U1 分析演示控制' });
  await details.waitFor({ state: 'attached' });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

async function reachManual(page: Page, scene: 'matched' | 'failed' | 'unknown' = 'matched') {
  await page.goto(reportOne);
  await openAnalysisControls(page);
  await page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click();
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await expect(page).toHaveURL(manual);
  if (scene !== 'matched') await page.getByLabel('生成回执场景').selectOption(scene);
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
}

async function advanceManualToV2(page: Page) {
  await page.locator('#markdown-note').fill('结果页第一轮意见：保留客户质量目标');
  await page.getByRole('button', { name: '提交并修改' }).click();
  await page.getByRole('button', { name: '模拟下一轮候选到达' }).click();
  await page.getByRole('button', { name: '显式切换并核对引用' }).click();
  await expect(page.locator('.stage-set')).toContainText('第 2 版候选');
}

async function rehearsalLink(page: Page, name: string) {
  const details = page.locator('details.journey-rehearsal');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await details.getByRole('link', { name, exact: true }).click();
}

test('results overview keeps complete inventory and file feedback across detail navigation', async ({
  page,
}) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page).toHaveURL(/\/results(?:\?|$)/u);
  await expect(page.getByRole('heading', { name: '处理结果' })).toBeVisible();
  await expect(page.locator('.results-inventory-head p')).toContainText('项目上传文件 12');
  await expect(page.locator('.results-inventory-head p')).toContainText('容器 1');
  await expect(page.locator('.results-inventory-head p')).toContainText('预期/计划 4');
  await expect(page.locator('.results-inventory-head p')).toContainText('计划新增 2');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(19);
  await expect(page.locator('.results-table th', { hasText: '人工定稿' })).toBeVisible();
  await expect(page.locator('.results-table')).toContainText('未定稿');
  await expect(page.locator('.results-table')).toContainText('历史记录/变更历史（嵌套 RAR）');
  await expect(page.locator('.results-table')).toContainText('损坏');
  await expect(
    page.locator('.results-table tr[data-kind="NEW"]', { hasText: '外来文件管理规定' }),
  ).toContainText('外来文件管理规定');
  await page.getByRole('button', { name: '待处理', exact: true }).click();
  await expect(page.locator('.results-filters button[aria-pressed="true"]')).toHaveText('待处理');
  await expect(page.locator('.results-table tr[data-pending="true"]').first()).toBeVisible();
  await page.getByRole('button', { name: '本阶段' }).click();
  await expect(page.locator('.results-filters button[aria-pressed="true"]')).toHaveText('本阶段');
  await expect(
    page.locator('.journey-nav').getByRole('link', { name: '项目概览', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.journey-nav').getByRole('link', { name: '资料', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.journey-nav').getByRole('link', { name: '处理结果', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.journey-nav').getByRole('link', { name: '交付', exact: true }),
  ).toBeVisible();

  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await page.setViewportSize({ width: 360, height: 500 });
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await manualRow.getByRole('link', { name: '查看' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(
    page.getByRole('heading', { level: 1, name: '质量手册', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('比较方式')).toHaveValue('CUMULATIVE');
  await expect(page.getByText('精确版本：初始底稿 → V1')).toBeVisible();
  await expect(page.locator('.markdown-reader')).toBeVisible();
  await expect(page.locator('.markdown-opinion')).toBeHidden();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('.markdown-opinion')).toBeVisible();
  await page.locator('#markdown-note').fill('文件详情意见：保留客户质量目标与职责。');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await expect(page.getByText('模拟文件意见已保存')).toBeVisible();
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await expect(page).toHaveURL(/\/results(?:\?|$)/u);
  await expect(page.getByLabel('结果类型', { exact: true })).toHaveValue('MANUAL');
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(page.locator('.results-filters button[aria-pressed="true"]')).toHaveText('本阶段');
  await expect(page.getByText('已保存 1 条文件意见')).toBeVisible();
  await expect(page.locator('.results-history')).toContainText('保留客户质量目标与职责');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '提交本轮意见并生成下一稿（模拟）' }).click();
  await expect(page.getByText(/已登记模拟修改请求 U2-REV-/u)).toBeVisible();
});

async function expectCandidateLessRequest(page: Page, scene: 'failed' | 'unknown') {
  await reachManual(page, scene);
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page.getByLabel('结果类型', { exact: true })).toHaveValue('MANUAL');
  await expect(page.getByLabel('轮次', { exact: true }).locator('option')).toHaveCount(1);
  await expect(page.locator('.results-summary')).toContainText(
    scene === 'failed' ? '生成失败' : '生成结果待核验',
  );
  await expect(page.locator('.results-table tr[data-kind="EXPECTED"]').first()).toContainText(
    scene === 'failed' ? '本轮失败' : '本轮结果待核验',
  );
  await expect(
    page.getByRole('link', {
      name: scene === 'failed' ? '回到阶段审阅处理失败' : '核对原生成请求',
    }),
  ).toBeVisible();
  await page
    .locator('.results-table tr[data-kind="EXPECTED"]')
    .first()
    .getByRole('link', { name: '查看' })
    .click();
  await expect(page.locator('.results-unavailable')).toContainText(
    scene === 'failed' ? '本轮候选生成失败' : '原生成请求结果未知',
  );
  await expect(page.locator('.markdown-review')).toHaveCount(0);
}

test('failed first-generation requests remain inspectable in results', async ({ page }) => {
  await expectCandidateLessRequest(page, 'failed');
});

test('unknown first-generation requests remain inspectable in results', async ({ page }) => {
  await expectCandidateLessRequest(page, 'unknown');
});

test('failed generation attempts remain selectable after retry and success', async ({ page }) => {
  await reachManual(page, 'failed');
  await page.getByRole('link', { name: '处理结果' }).click();
  const roundSelect = page.getByLabel('轮次', { exact: true });
  await expect(roundSelect.locator('option')).toHaveCount(1);
  const firstAttempt = await roundSelect.locator('option').first().getAttribute('value');
  expect(firstAttempt).toMatch(/MANUAL-REQ-U2-GEN-/u);
  if (!firstAttempt) throw new Error('First generation attempt has no route identity');
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await expect(page.locator('.results-unavailable')).toContainText('本轮候选生成失败');
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await page.getByRole('link', { name: '回到阶段审阅处理失败' }).click();
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(roundSelect.locator('option')).toHaveCount(2);
  await expect(roundSelect).toHaveValue(firstAttempt);
  const secondAttempt = await roundSelect.locator('option').nth(1).getAttribute('value');
  expect(secondAttempt).toMatch(/MANUAL-REQ-U2-GEN-/u);
  expect(secondAttempt).not.toBe(firstAttempt);
  if (!secondAttempt) throw new Error('Second generation attempt has no route identity');
  await page.getByRole('link', { name: '回到阶段审阅处理失败' }).click();
  await page.getByLabel('生成回执场景').selectOption('matched');
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(roundSelect.locator('option')).toHaveCount(3);
  await expect(roundSelect).toHaveValue(firstAttempt);
  const attemptValues = await roundSelect
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(attemptValues).toContain(firstAttempt);
  expect(attemptValues).toContain(secondAttempt);
  await manualRow.getByRole('link', { name: '查看' }).click();
  await expect(page.locator('.results-unavailable')).toContainText('本轮候选生成失败');
  await expect(page.getByText('无法打开此页面')).toHaveCount(0);
});

test('scope expansion keeps plan-scoped rounds and opinions separate', async ({ page }) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('R7 计划一专属意见');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await page.locator('.results-actions').getByRole('link', { name: '确认本阶段版本' }).click();
  await expect(page).toHaveURL(manual);
  await rehearsalLink(page, '修改范围');
  await expect(page).toHaveURL(plan);
  await page.getByRole('button', { name: '扩大范围：新增变更通知单（演示）' }).click();
  await expect(page.locator('.plan-file-list > li')).toHaveCount(7);
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await expect(page).toHaveURL(manual);
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await page.getByRole('link', { name: '处理结果' }).click();
  const planTwoRound = 'MANUAL-V1@U1-PLAN-02-v2';
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(page.getByLabel('轮次', { exact: true }).locator('option')).toHaveCount(2);
  await expect(page.getByText(/有新轮次可查看：质量手册 · 第 1 版候选/u)).toBeVisible();
  await page.getByLabel('轮次', { exact: true }).selectOption(planTwoRound);
  await expect(page.locator('.results-history')).not.toContainText('R7 计划一专属意见');
  await expect(page.getByText('尚未保存文件意见。')).toBeVisible();
  const newManualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await newManualRow.getByRole('link', { name: '查看' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await expect(page.locator('#markdown-note')).toHaveValue('');
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await page.getByLabel('轮次', { exact: true }).selectOption(manualV1);
  await expect(page.locator('.results-history')).toContainText('R7 计划一专属意见');
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
});

test('historical analysis rounds keep their original plan membership', async ({ page }) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  await page.getByLabel('结果类型', { exact: true }).selectOption('ANALYSIS');
  await page.getByLabel('轮次', { exact: true }).selectOption('ANALYSIS-1');
  const inventory = page.locator('.results-table tbody tr');
  const originalCount = await inventory.count();
  const originalCounts = await page.locator('.results-inventory-head p').innerText();
  await expect(page.locator('.results-table')).not.toContainText('变更通知单');
  await page.getByRole('link', { name: '项目概览' }).click();
  await rehearsalLink(page, '修改范围');
  await page.getByRole('button', { name: '扩大范围：新增变更通知单（演示）' }).click();
  await expect(page.locator('.plan-file-list > li')).toHaveCount(7);
  await page.getByRole('link', { name: '处理结果' }).click();
  await page.getByLabel('结果类型', { exact: true }).selectOption('ANALYSIS');
  await page.getByLabel('轮次', { exact: true }).selectOption('ANALYSIS-1');
  await expect(inventory).toHaveCount(originalCount);
  await expect(page.locator('.results-inventory-head p')).toHaveText(originalCounts);
  await expect(page.locator('.results-table')).not.toContainText('变更通知单');
});

test('superseded plans reject next-draft submission from a historical round', async ({ page }) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('R11 历史计划意见');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await page.locator('.results-actions').getByRole('link', { name: '确认本阶段版本' }).click();
  await rehearsalLink(page, '修改范围');
  await page.getByRole('button', { name: '扩大范围：新增变更通知单（演示）' }).click();
  await expect(page.locator('.plan-file-list > li')).toHaveCount(7);
  await page.getByRole('link', { name: '处理结果', exact: true }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(
    page.getByRole('button', { name: '提交本轮意见并生成下一稿（模拟）' }),
  ).toBeDisabled();
  await expect(page.getByText(/已被 U1-PLAN-02 替代/u)).toBeVisible();
});

test('desktop detail compares the baseline and revision side by side', async ({ page }) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = page.locator('.markdown-before');
  const after = page.locator('.markdown-after');
  await expect(before).toBeVisible();
  await expect(after).toBeVisible();
  const desktopBefore = await before.boundingBox();
  const desktopAfter = await after.boundingBox();
  expect(desktopBefore && desktopAfter).toBeTruthy();
  if (desktopBefore && desktopAfter) {
    expect(Math.abs(desktopBefore.y - desktopAfter.y)).toBeLessThan(20);
    expect(desktopBefore.x).toBeLessThan(desktopAfter.x);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  const narrowBefore = await before.boundingBox();
  const narrowAfter = await after.boundingBox();
  expect(narrowBefore && narrowAfter).toBeTruthy();
  if (narrowBefore && narrowAfter) expect(narrowAfter.y).toBeGreaterThan(narrowBefore.y);
});

test('recovery attempts do not rewrite a historical round outcome or provenance', async ({
  page,
}) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await expect(manualRow).toContainText('已生成候选');
  await rehearsalLink(page, '执行与恢复');
  await expect(page.getByRole('heading', { name: '执行与恢复' })).toBeVisible();
  await page.getByLabel('重试回执场景').selectOption('pending');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  await page.getByRole('button', { name: '模拟原重试回执到达' }).click();
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(page.locator('.u3-attempt')).toHaveCount(2);
  await page.getByRole('link', { name: '处理结果' }).click();
  const unchanged = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await expect(unchanged).toContainText('已生成候选');
  await unchanged.getByRole('link', { name: '查看' }).click();
  await expect(page.locator('.markdown-review')).toBeVisible();
  await expect(page.locator('.results-page')).not.toContainText('既有已定稿依据');
  await expect(page.locator('.results-page')).not.toContainText('本轮失败');
});

test('detail requires an actual candidate in the selected round', async ({ page }) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const externalRule = page.locator('.results-table tr', { hasText: '外来文件管理规定' }).first();
  await expect(externalRule).toContainText('本阶段未处理');
  await externalRule.getByRole('link', { name: '查看' }).click();
  await expect(page.locator('.results-unavailable')).toContainText('该文件不属于所选阶段');
  await expect(page.locator('.markdown-review')).toHaveCount(0);
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await expect(page.locator('.markdown-review')).toBeVisible();
});

test('results submission updates shared stage state and enables the next candidate', async ({
  page,
}) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('R5 共享阶段修订意见');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await page.getByRole('button', { name: '提交本轮意见并生成下一稿（模拟）' }).click();
  await expect(page.getByText(/已登记模拟修改请求 U2-REV-/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '本轮意见已提交' })).toBeDisabled();
  await page.locator('.results-actions').getByRole('link', { name: '确认本阶段版本' }).click();
  await expect(page.locator('.markdown-history')).toContainText('R5 共享阶段修订意见');
  const nextCandidate = page.getByRole('button', { name: '模拟下一轮候选到达' });
  await expect(nextCandidate).toBeEnabled();
  await nextCandidate.click();
  await expect(page.getByText(/新候选已到达（模拟）/u)).toBeVisible();
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(page.getByText(/有新轮次可查看：质量手册 · 第 2 版候选/u)).toBeVisible();
  await page.getByRole('button', { name: /查看 质量手册 · 第 2 版候选/u }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV2);
});

test('results comparison modes bind exact versions across two feedback rounds', async ({
  page,
}) => {
  await reachManual(page);
  await advanceManualToV2(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV2);
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V2%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await expect(page.getByText('精确版本：初始底稿 → V2')).toBeVisible();
  await page.getByLabel('比较方式').selectOption('ROUND');
  await expect(page.getByText('精确版本：V1 → V2')).toBeVisible();
  await expect(page.locator('.markdown-review')).toBeVisible();
  await page.getByLabel('比较方式').selectOption('CUMULATIVE');
  await expect(page.getByText('精确版本：初始底稿 → V2')).toBeVisible();
});

test('newer manual result is labeled as a separate round without replacing the selected V1', async ({
  page,
}) => {
  await reachManual(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(page.locator('.results-actions')).toContainText('确认本阶段版本');
  const manualRow = page
    .locator('.results-table tr[data-kind="EXPECTED"]', { hasText: '质量手册' })
    .first();
  await manualRow.getByRole('link', { name: '查看' }).click();
  await page.getByRole('link', { name: '← 返回结果总览' }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await page.locator('.results-actions').getByRole('link').first().click();
  await expect(page).toHaveURL(manual);
  await advanceManualToV2(page);
  await page.getByRole('link', { name: '处理结果' }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV1);
  await expect(page.getByText(/有新轮次可查看：质量手册 · 第 2 版候选/u)).toBeVisible();
  await page.getByRole('button', { name: /查看 质量手册 · 第 2 版候选/u }).click();
  await expect(page.getByLabel('轮次', { exact: true })).toHaveValue(manualV2);
  await page.getByLabel('轮次', { exact: true }).selectOption(manualV1);
  await expect(page.locator('.results-page')).toContainText(/当前查看 质量手册 · 第 1 版候选/u);
  await expect(page.getByText('本轮尚未成为阶段定稿。')).toBeVisible();
});

test('production build excludes the results adapter and results rehearsal content', async ({
  page,
}) => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'DEVELOPMENT_RESULTS_ADAPTER_ONLY',
      'results-inventory',
      '有新的轮次可查看',
      'U2-SAVE-LOCAL',
    ])
      expect(source.includes(marker), `Production bundle must exclude ${marker}`).toBe(false);
  }
  await page.goto(results);
  await expect(page.getByRole('heading', { name: '处理结果' })).toHaveCount(0);
});
