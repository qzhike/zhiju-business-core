import { test, expect, type Page } from '@playwright/test';

const base = '/projects/MVP-U1-PROJECT';
const work = `${base}/work`;

async function startProject(page: Page) {
  await page.goto(work);
  await expect(page.getByRole('heading', { level: 1, name: '当前工作' })).toBeVisible();
  await page.getByRole('button', { name: '开始分析资料' }).click();
  await page
    .getByLabel('资料问题答复')
    .fill('同意四层结构与编号迁移；C04/C05/C07 继续作为内部表单保留。');
  await page.getByRole('button', { name: '提交答复并继续分析' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('确认修改范围');
}

async function confirmScope(page: Page) {
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

async function completeToDelivery(page: Page, rulesRounds: 1 | 2 = 2) {
  await startProject(page);
  await confirmScope(page);

  // First round is submitted from the shared file detail, without a separate save.
  await page
    .locator('.task-stage')
    .getByRole('link', { name: '查看', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/results\/MANUAL-V1%40U1-PLAN-01-v1\/F-MANUAL$/u);
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('质量手册第一轮意见：保留客户质量目标与职责。');
  await expect(page.locator('.markdown-draft-state')).toContainText('已保留在本次会话内存');
  await page.getByRole('button', { name: '核对并提交本轮意见并生成下一稿' }).click();
  await expect(page.getByText(/已提交本轮意见并登记模拟修改请求 U2-REV-/u)).toBeVisible();
  await page.getByRole('link', { name: '返回当前工作核对定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册有新稿可查看');
  await viewNew(page, '第 2 版候选');

  await submitRound(
    page,
    '质量手册',
    '质量手册第二轮意见：补充记录编号映射。',
    '质量手册有新稿可查看',
  );
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
    '第三阶段第一轮意见：核对更新跟踪。',
    '管理制度及记录表单有新稿可查看',
  );
  await viewNew(page, '第 2 版候选');
  if (rulesRounds === 2) {
    await submitRound(
      page,
      '变更申请单',
      '第三阶段第二轮意见：补充风险触发判断。',
      '管理制度及记录表单有新稿可查看',
    );
    await viewNew(page, '第 3 版候选');
  }
  await finalizeStage(page, '核对最终交付清单');
}

test('task workspace completes the approved journey and preserves exact versions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/workbench?enterprise=U1-ENTERPRISE&project=MVP-U1-PROJECT');
  const card = page.getByRole('article', { name: 'M1 连续演练 · 当前任务', exact: true });
  await expect(card).toContainText('待开始分析');
  await expect(card).toContainText('资料 1 批');
  await card.getByRole('link', { name: '进入当前工作' }).click();
  await expect(page).toHaveURL(/\/projects\/MVP-U1-PROJECT\/work$/u);
  const projectNav = page.getByRole('navigation', { name: '项目导航' });
  await expect(projectNav.getByRole('link', { name: '当前工作', exact: true })).toBeVisible();
  await expect(projectNav.getByRole('link', { name: '全部文件', exact: true })).toBeVisible();
  await expect(projectNav.getByRole('link', { name: '历史记录', exact: true })).toBeVisible();
  await expect(projectNav.getByRole('link', { name: '项目概览', exact: true })).toHaveCount(0);
  await expect(projectNav.getByRole('link', { name: '资料', exact: true })).toHaveCount(0);
  await expect(projectNav.getByRole('link', { name: '处理结果', exact: true })).toHaveCount(0);
  await expect(projectNav.getByRole('link', { name: '交付', exact: true })).toHaveCount(0);

  await completeToDelivery(page);

  await expect(page.locator('.task-delivery tbody tr')).toHaveCount(6);
  await expect(page.locator('.task-delivery tbody')).toContainText('第 3 版候选 · V3');
  await expect(page.locator('.task-delivery tbody')).toContainText('第 2 版候选 · V2');
  const downloadPromise = page.waitForEvent('download');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  await expect(page.locator('.task-package')).toContainText('包可用（模拟）');
  await page.getByRole('button', { name: '下载 Markdown ZIP（合成）' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/SYNTHETIC\.zip$/u);

  await projectNav.getByRole('link', { name: '全部文件', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '全部文件' })).toBeVisible();
  await expect(page.locator('.task-inventory-head p')).toContainText('上传成员 12');
  await expect(page.locator('.task-inventory-head p')).toContainText('容器 1');
  await expect(page.locator('.task-inventory-head p')).toContainText('预期/计划 4');
  await expect(page.locator('.task-inventory-head p')).toContainText('计划新增 2');
  await expect(page.locator('.task-inventory-head p')).toContainText('保留 3');
  await expect(page.locator('.task-inventory')).toContainText('嵌套 RAR');
  await expect(page.locator('.task-inventory')).toContainText('损坏');
  await expect(page.locator('.task-inventory')).toContainText('外来文件管理规定');
  await page.getByRole('button', { name: '待处理', exact: true }).click();
  await expect(page.locator('.task-filters button[aria-pressed="true"]')).toHaveText('待处理');

  await projectNav.getByRole('link', { name: '历史记录', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '历史记录' })).toBeVisible();
  await expect(page.getByText(/正在查看历史记录/u)).toBeVisible();
  await expect(page.getByRole('link', { name: /质量手册 · 第 3 版候选/u })).toBeVisible();
  await expect(page.locator('main')).toContainText('U3-PKG-01');
  await expect(page.getByRole('link', { name: '返回当前工作' }).first()).toBeVisible();
  await page.getByRole('link', { name: '返回当前工作' }).first().click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  expect(errors).toEqual([]);
});

test('analysis without clarification goes straight to scope confirmation', async ({ page }) => {
  await page.goto(work);
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('分析澄清场景').selectOption('NONE');
  await page.getByRole('button', { name: '开始分析资料' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('确认修改范围');
  await expect(page.getByLabel('资料问题答复')).toHaveCount(0);
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮质量手册');
});

test('unknown scope confirmation recovers the original intent in current work', async ({
  page,
}) => {
  await page.goto(work);
  await page.getByRole('button', { name: '开始分析资料' }).click();
  await page.getByLabel('资料问题答复').fill('同意四层结构与编号迁移。');
  await page.getByRole('button', { name: '提交答复并继续分析' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('确认修改范围');
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('范围确认场景').selectOption('unknown');
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原范围确认请求');
  await page.getByRole('button', { name: '核对原确认请求' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮质量手册');
  await expect(page.getByRole('button', { name: '确认范围并生成质量手册初稿' })).toHaveCount(0);
  await expect(page.locator('.task-stage')).toContainText('第 1 版候选');
});

test('generation failure keeps the confirmed scope and retries only execution', async ({
  page,
}) => {
  await page.goto(work);
  await page.getByRole('button', { name: '开始分析资料' }).click();
  await page.getByLabel('资料问题答复').fill('同意四层结构与编号迁移。');
  await page.getByRole('button', { name: '提交答复并继续分析' }).click();
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('当前阶段生成场景').selectOption('failed');
  await page.getByRole('button', { name: '确认范围并生成质量手册初稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('质量手册生成失败，需重试');
  await expect(page.getByRole('button', { name: '确认范围并生成质量手册初稿' })).toHaveCount(0);
  await page.getByLabel('当前阶段生成场景').selectOption('matched');
  await page.getByRole('button', { name: '核对或重试本阶段生成' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('审阅本轮质量手册');
  await expect(page.locator('.task-stage')).toContainText('第 1 版候选');
});

test('upstream re-finalization marks downstream stages for review in current work', async ({
  page,
}) => {
  await completeToDelivery(page);
  await page.locator('details.task-dev summary').click();
  await page.getByRole('button', { name: '模拟质量手册重新定稿（上游依据变化）' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('控制程序依据已变化，需复核');
  await page.getByRole('button', { name: '核对并重新定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('管理制度及记录表单依据已变化，需复核');
  await page.getByRole('button', { name: '核对并重新定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
  await expect(page.locator('.task-delivery')).not.toContainText('最终交付当前不可确认');
});

test('current work keeps partial execution recovery across navigation', async ({ page }) => {
  await completeToDelivery(page);
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('显示执行恢复区（合成失败批次）').check();
  await expect(page.locator('.task-recovery')).toContainText('变更申请单');
  await expect(page.locator('.task-recovery')).toContainText('变更评审记录');
  await expect(page.locator('.task-recovery')).toContainText('已知失败');
  await expect(page.locator('.task-next h2')).toHaveText('重试已知失败文件');
  await page.getByRole('button', { name: '仅重试已知失败文件' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原重试请求');

  const projectNav = page.getByRole('navigation', { name: '项目导航' });
  await projectNav.getByRole('link', { name: '历史记录', exact: true }).click();
  await projectNav.getByRole('link', { name: '当前工作', exact: true }).click();
  await expect(page.locator('.task-recovery')).toBeVisible();
  await expect(page.locator('.task-next h2')).toHaveText('核对原重试请求');

  await page.getByRole('button', { name: '核对或重试恢复请求' }).click();
  await expect(page.locator('.task-recovery')).toContainText('原重试回执已核验');
  await expect(page.locator('.task-recovery')).toContainText('成功文件保持不变');
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
});

test('mismatched confirmation stays blocked after the scene changes', async ({ page }) => {
  await completeToDelivery(page);
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('确认回执').selectOption('mismatch');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');
  await page.locator('.task-delivery').getByRole('button', { name: '核对原最终确认请求' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');

  await page.getByLabel('确认回执').selectOption('matched');
  await page.locator('.task-delivery').getByRole('button', { name: '核对原最终确认请求' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');
  await expect(page.getByRole('button', { name: '下载 Markdown ZIP（合成）' })).toHaveCount(0);

  await page.getByRole('button', { name: '结束原确认请求并重新核对' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
  await page.getByLabel('确认回执').selectOption('matched');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
});

test('basis change during unknown confirmation keeps the original intent blocked', async ({
  page,
}) => {
  await completeToDelivery(page);
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('确认回执').selectOption('unknown');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');

  await page
    .getByRole('button', { name: '模拟质量手册重新定稿（上游依据变化）' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('控制程序依据已变化，需复核');
  await page.getByRole('button', { name: '核对并重新定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText(
    '管理制度及记录表单依据已变化，需复核',
  );
  await page.getByRole('button', { name: '核对并重新定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');

  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '核对原最终确认请求' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');
  await expect(page.getByRole('button', { name: '下载 Markdown ZIP（合成）' })).toHaveCount(0);

  await page.getByRole('button', { name: '结束原确认请求并重新核对' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
  await page.getByLabel('确认回执').selectOption('matched');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
});

test('later finalization requires a new delivery confirmation and keeps the old package', async ({
  page,
}) => {
  await completeToDelivery(page, 1);
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  await expect(page.locator('.task-delivery')).toContainText('U3-PKG-01');

  const projectNav = page.getByRole('navigation', { name: '项目导航' });
  await projectNav.getByRole('link', { name: '历史记录', exact: true }).click();
  await page.getByRole('link', { name: /管理制度及记录表单 · 第 2 版候选/u }).click();
  await page
    .locator('.results-table tr[data-kind="NEW"]', { hasText: '外来文件管理规定' })
    .getByRole('link', { name: '查看' })
    .click();
  await page.getByRole('button', { name: '打开意见与处理' }).click();
  await page.locator('#markdown-note').fill('第三阶段后续意见：核对更新跟踪。');
  await page.getByRole('button', { name: '核对并提交本轮意见并生成下一稿' }).click();
  await expect(page.getByText(/已提交本轮意见并登记模拟修改请求/u)).toBeVisible();
  await page.getByRole('link', { name: '返回当前工作核对定稿' }).click();

  await expect(page.locator('.task-next h2')).toHaveText('管理制度及记录表单有新稿可查看');
  await page.getByRole('button', { name: '查看新稿', exact: true }).click();
  await expect(page.locator('.task-next h2')).toHaveText(
    '管理制度及记录表单有后续改稿，需重新核对定稿',
  );
  await page.getByRole('button', { name: '核对并重新定稿' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('核对最终交付清单');
  await expect(page.getByRole('button', { name: '下载 Markdown ZIP（合成）' })).toHaveCount(0);

  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  await expect(page.locator('.task-delivery')).toContainText('U3-PKG-02');
  await expect(page.locator('.task-delivery')).toContainText('U3-PKG-01');
});

test('delivery unknown stops packaging and failure retries the same frozen list', async ({
  page,
}) => {
  await completeToDelivery(page);
  await page.locator('details.task-dev summary').click();
  await page.getByLabel('确认回执').selectOption('unknown');
  await page
    .locator('.task-delivery')
    .getByRole('button', { name: '确认交付清单并生成文档包' })
    .click();
  await expect(page.locator('.task-next h2')).toHaveText('核对原最终确认请求');
  await expect(page.getByRole('button', { name: '下载 Markdown ZIP（合成）' })).toHaveCount(0);
  await page.locator('.task-delivery').getByRole('button', { name: '核对原最终确认请求' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('打包已冻结清单');

  await page.getByLabel('打包结果').selectOption('FAILED');
  await page.locator('.task-delivery').getByRole('button', { name: '打包已冻结清单' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('打包失败，需重试同一清单');
  await expect(page.getByRole('button', { name: '确认交付清单并生成文档包' })).toHaveCount(0);

  await page.getByLabel('打包结果').selectOption('AVAILABLE');
  await page.getByRole('button', { name: '核对或重试打包' }).click();
  await expect(page.locator('.task-next h2')).toHaveText('文档包已生成（模拟）');
  await expect(page.locator('.task-delivery')).toContainText('U3-PKG-01');
});
