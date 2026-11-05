import { test, expect, type Page } from '@playwright/test';

const projectId = '0199a000-0000-7000-8000-000000000011';
const batchId = '0199a000-0000-7000-8000-000000000012';
const manifestId = '0199a000-0000-7000-8000-000000000013';
const createdAt = '2026-11-04T00:00:00.000Z';
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const project = {
  projectId,
  title: '接收说明核对',
  customerName: '合成客户',
  version: 3,
  lastBatchNo: 1,
  createdAt,
};
const batch = {
  batchId,
  projectId,
  batchNo: 1,
  kind: 'INITIAL',
  originalName: 'materials.zip',
  declaredBytes: 100,
  zipSha256: 'a'.repeat(64),
  status: 'PARTIAL',
  policyVersion: 'mvp.zip-input@4',
  version: 5,
  manifestId,
  createdAt,
  reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
};
const sourceRef = {
  sourceId: '0199a000-0000-7000-8000-000000000014',
  projectId,
  batchId,
  kind: 'ACCEPTED_ENTRY',
  sha256: 'c'.repeat(64),
  byteLength: 20,
  mediaType: docxType,
};
const manifest = {
  manifestId,
  batchId,
  manifestHash: 'b'.repeat(64),
  totalEntries: 6,
  acceptedEntries: 2,
  limitedEntries: 4,
  createdAt,
  originalZip: {
    sourceId: 'original',
    sha256: 'a'.repeat(64),
    byteLength: 100,
    mediaType: 'application/zip',
  },
};
const entries = [
  {
    name: 'normal.md',
    status: 'ACCEPTED',
    reasonCodes: [],
    sourceRef: { ...sourceRef, sourceId: 'normal-source' },
  },
  {
    name: '<img onerror=alert(1)>.docx',
    status: 'ACCEPTED',
    reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'],
    sourceRef,
  },
  {
    name: '__MACOSX/._manual.docx',
    status: 'UNSUPPORTED',
    reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
  },
  { name: 'broken.docx', status: 'CORRUPT', reasonCodes: ['INVALID_DOCX'] },
  {
    name: 'external.docx',
    status: 'READ_LIMITED',
    reasonCodes: ['EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
  },
  { name: 'embedded.docx', status: 'UNSUPPORTED', reasonCodes: ['ACTIVE_CONTENT_NOT_SUPPORTED'] },
].map((entry, ordinal) => ({
  ...entry,
  entryId: `entry-${ordinal}`,
  ordinal,
  originalName: entry.name,
  normalizedPath: entry.name,
  sha256: 'c'.repeat(64),
  byteLength: 20,
  mediaType: docxType,
}));

async function setup(page: Page, mode: 'normal' | 'malformed' | 'legacy' = 'normal') {
  await page.route('**/bff/session', (route) =>
    route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'intake',
        csrfToken: 'intake-only',
        principal: { principalId: projectId, principalKind: 'HUMAN', displayName: '核对员工' },
      },
    }),
  );
  await page.route('**/bff/mvp/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/read-checks')) {
      await route.fulfill({ json: { ok: true, data: { items: [] } } });
      return;
    }
    const shownBatch =
      mode === 'legacy'
        ? {
            ...batch,
            policyVersion: 'mvp.zip-input@3',
            status: 'FAILED',
            manifestId: undefined,
            reasonCodes: ['RECOVERY_REQUIRED'],
          }
        : batch;
    const shownEntries =
      mode === 'malformed'
        ? entries.map((entry, index) =>
            index === 1 ? { ...entry, status: 'READ_LIMITED' } : entry,
          )
        : entries;
    const results: Record<string, unknown> = {
      '/bff/mvp/v1/session': {
        ownerId: projectId,
        displayName: '核对员工',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      },
      [`/bff/mvp/v1/projects/${projectId}`]: { project },
      [`/bff/mvp/v1/projects/${projectId}/batches`]: { items: [shownBatch] },
      [`/bff/mvp/v1/projects/${projectId}/batches/${batchId}`]: {
        batch: shownBatch,
        attempts: [],
        permittedActions: mode === 'legacy' ? ['RECONCILE'] : [],
        ...(mode === 'legacy' ? {} : { manifest }),
      },
      [`/bff/mvp/v1/projects/${projectId}/batches/${batchId}/entries`]: {
        manifest,
        entries: shownEntries,
      },
    };
    expect(route.request().method()).toBe('GET');
    expect(Object.hasOwn(results, url.pathname)).toBe(true);
    await route.fulfill({ json: { ok: true, data: results[url.pathname] } });
  });
}

async function openBatch(page: Page) {
  await page.goto(`/custody/projects/${projectId}`);
  await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
}

for (const width of [1440, 320]) {
  test(`production custody explains static intake and keeps complete pagination at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await openBatch(page);
    const table = page.getByRole('table', { name: '资料条目清单' });
    await expect(page.getByText(/共 6 项，已接收来源 2 项/)).toBeVisible();
    await expect(page.getByText(/条目数包含系统附属文件/)).toBeVisible();
    const template = table.getByRole('row').filter({ hasText: '<img onerror=alert(1)>.docx' });
    await expect(template).toContainText('已接收');
    await expect(template).toContainText('外部模板未读取。');
    await expect(template).toContainText('EXTERNAL_TEMPLATE_NOT_LOADED');
    await expect(template.getByRole('button', { name: '下载', exact: true })).toBeEnabled();
    await expect(table.locator('img')).toHaveCount(0);
    const metadata = table.getByRole('row').filter({ hasText: '__MACOSX/._manual.docx' });
    await expect(metadata).toContainText('系统附属文件，不参与业务文档处理');
    await expect(metadata).not.toContainText('文件损坏');
    await expect(metadata.getByRole('button')).toHaveCount(0);
    const next = page.getByRole('button', { name: '下一页', exact: true });
    await expect(next).toBeDisabled();
    await expect(table.getByRole('row')).toHaveCount(7);
    await expect(table.getByRole('row').filter({ hasText: 'embedded.docx' })).toContainText(
      '请人工核对后另存为静态文档',
    );
    await expect(table.getByRole('row').filter({ hasText: 'external.docx' })).toContainText(
      '读取受限',
    );
    await expect(table.getByRole('row').filter({ hasText: 'broken.docx' })).toContainText(
      '文件损坏',
    );
    await expect(template).toContainText('EXTERNAL_TEMPLATE_NOT_LOADED');
    await expect(next).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByText('分析未接入', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`intake-${width}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
    await expect(template).toContainText('EXTERNAL_TEMPLATE_NOT_LOADED');
    await expect(page.getByText(/共 6 项，已接收来源 2 项/)).toBeVisible();
  });
}

test('production custody rejects mismatched accepted explanations and preserves @3 recovery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page, 'malformed');
  await openBatch(page);
  await expect(page.getByText('操作未完成（UI_CLIENT_STATE_INVALID）。')).toBeVisible();
  await expect(page.getByRole('table', { name: '资料条目清单' })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await setup(page, 'legacy');
  await openBatch(page);
  await expect(page.getByText(/此批次使用旧版资料检查规则，不能继续上传或提取/)).toBeVisible();
  expect(errors).toEqual([]);
});
