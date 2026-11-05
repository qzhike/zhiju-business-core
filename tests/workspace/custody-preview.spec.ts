import { expect, test, type Page, type Route } from '@playwright/test';

const projectId = '0199a000-0000-7000-8000-000000000001';
const batchId = '0199a000-0000-7000-8000-000000000002';
const manifestId = '0199a000-0000-7000-8000-000000000003';
const docxId = '0199a000-0000-7000-8000-000000000004';
const markdownId = '0199a000-0000-7000-8000-000000000005';
const createdAt = '2026-11-04T00:00:00.000Z';
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sourceRef = (sourceId: string) => ({
  projectId,
  batchId,
  sourceId,
  kind: 'ACCEPTED_ENTRY',
  sha256: 'a'.repeat(64),
  byteLength: 200,
  mediaType: sourceId === docxId ? docxType : 'text/markdown',
});
const manifest = {
  manifestId,
  manifestHash: 'b'.repeat(64),
  batchId,
  totalEntries: 2,
  acceptedEntries: 2,
  limitedEntries: 0,
  createdAt,
  originalZip: {
    ...sourceRef(docxId),
    sourceId: '0199a000-0000-7000-8000-000000000006',
    kind: 'ORIGINAL_ZIP',
    mediaType: 'application/zip',
  },
};
const batch = {
  projectId,
  batchId,
  batchNo: 1,
  originalName: 'source.zip',
  declaredBytes: 400,
  zipSha256: 'b'.repeat(64),
  status: 'RECEIVED',
  kind: 'INITIAL',
  version: 4,
  reasonCodes: [],
  manifestId,
  createdAt,
};
const fileName = '质量手册及多部门过程的原始文档'.repeat(3) + '.docx';
const entries = [docxId, markdownId].map((sourceId, index) => ({
  entryId: sourceId,
  ordinal: index + 1,
  originalName: index === 0 ? fileName : 'notes.md',
  normalizedPath: index === 0 ? fileName : 'notes.md',
  status: 'ACCEPTED',
  reasonCodes: [],
  mediaType: sourceRef(sourceId).mediaType,
  byteLength: 200,
  sha256: 'a'.repeat(64),
  sourceRef: sourceRef(sourceId),
}));
const preview = (sourceId: string) => ({
  sourceRef: sourceRef(sourceId),
  manifestId,
  fileName: sourceId === docxId ? fileName : 'notes.md',
  profileId: 'mvp.source-preview@1',
  status: sourceId === docxId ? 'LIMITED' : 'AVAILABLE',
  limitations:
    sourceId === docxId
      ? ['EXTRACTED_VIEW_ONLY', 'TEXT_REVISIONS_ONLY', 'EXTERNAL_TEMPLATE_NOT_LOADED']
      : [],
  sections:
    sourceId === docxId
      ? {
          format: 'DOCX',
          paragraphs: [{ position: 1, text: '保留客户制度与质量目标' }],
          tables: [
            {
              position: 1,
              rows: [
                {
                  cells: [
                    { text: '合并单元格', column: 1, colSpan: 2, rowSpan: 2 },
                    ...Array.from({ length: 10 }, (_, index) => ({
                      text: `列 ${index + 3}`,
                      column: index + 3,
                      colSpan: 1,
                      rowSpan: 1,
                    })),
                  ],
                },
                {
                  cells: Array.from({ length: 10 }, (_, index) => ({
                    text: '审核内容',
                    column: index + 3,
                    colSpan: 1,
                    rowSpan: 1,
                  })),
                },
              ],
            },
          ],
          comments: [{ id: '1', text: '<script>untrusted</script>', paragraphs: [1] }],
          revisions: [{ kind: 'del', id: '2', text: '旧条款' }],
          headersFooters: [{ part: 'word/header1.xml', text: '质量体系' }],
          fields: [],
        }
      : {
          format: 'MARKDOWN',
          source:
            '# 安全的原始记录\r\n\r\n<script>window.previewInjected=true</script>\r\n![x](https://external.invalid/image.png)\r\n\r\n| 项目 | 内容 |\r\n| --- | --- |\r\n| A | 原始值 |',
        },
});
const projectPath = `/custody/projects/${projectId}`;

async function setup(page: Page, intercept?: (route: Route, id: string) => Promise<boolean>) {
  const project = {
    projectId,
    customerName: '合成客户',
    title: '原件核对',
    version: 2,
    lastBatchNo: 1,
    createdAt,
  };
  await page.route('**/bff/session', (route) =>
    route.fulfill({
      json: {
        accessState: 'ALLOWED',
        sessionGeneration: 'preview',
        csrfToken: 'preview',
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
    if (url.pathname.endsWith('/preview')) {
      const id = url.pathname.split('/').at(-2) ?? '';
      if (await intercept?.(route, id)) return;
      await route.fulfill({ json: { ok: true, data: preview(id) } });
      return;
    }
    const results: Record<string, unknown> = {
      '/bff/mvp/v1/session': {
        ownerId: projectId,
        displayName: '核对员工',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      },
      [`/bff/mvp/v1/projects/${projectId}`]: { project },
      [`/bff/mvp/v1/projects/${projectId}/batches`]: { items: [batch] },
      [`/bff/mvp/v1/projects/${projectId}/batches/${batchId}`]: {
        batch,
        attempts: [],
        permittedActions: [],
        manifest,
      },
      [`/bff/mvp/v1/projects/${projectId}/batches/${batchId}/entries`]: {
        manifest,
        entries,
      },
    };
    expect(Object.hasOwn(results, url.pathname)).toBe(true);
    await route.fulfill({ json: { ok: true, data: results[url.pathname] } });
  });
  await page.goto(projectPath);
  await expect(page.getByRole('combobox', { name: '资料批次' })).toHaveValue(batchId);
  await expect(page.getByText('notes.md', { exact: true })).toBeVisible();
}

for (const width of [1440, 320])
  test(`production source preview preserves content and layout at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page
      .getByRole('row')
      .filter({ has: page.getByText(fileName, { exact: true }) })
      .getByRole('button', { name: '查看内容' })
      .click();
    await expect(page.getByRole('heading', { name: fileName, exact: true })).toBeVisible();
    await expect(page.getByLabel('读取限制')).toContainText('外部模板未读取');
    await expect(page.getByRole('cell', { name: '合并单元格' })).toHaveAttribute('colspan', '2');
    await expect(page.getByRole('cell', { name: '合并单元格' })).toHaveAttribute('rowspan', '2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('source-preview.png'), fullPage: true });
    await page.getByRole('button', { name: '← 返回文件列表' }).click();
    await expect(page.getByText('notes.md', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await page
      .getByRole('row', { name: /notes\.md/ })
      .getByRole('button', { name: '查看内容' })
      .click();
    await expect(page.getByRole('heading', { name: '安全的原始记录', exact: true })).toBeVisible();
    await expect(page.locator('.source-preview img, .source-preview script')).toHaveCount(0);
    expect(await page.evaluate(() => 'previewInjected' in window)).toBe(false);
    await page.getByRole('button', { name: '原始 Markdown', exact: true }).click();
    await expect(page.getByLabel('原始 Markdown 正文')).toContainText(
      'window.previewInjected=true',
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: '安全的原始记录', exact: true })).toBeVisible();
    const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    expect(storage).not.toContain('安全的原始记录');
  });

test('production source preview cancels old reads and rejects mismatched source output', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await setup(page, async (route, id) => {
    if (id !== docxId) return false;
    started = true;
    await held;
    await route.fulfill({ json: { ok: true, data: preview(docxId) } }).catch(() => undefined);
    return true;
  });
  await page.getByRole('button', { name: '查看内容' }).first().click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: '取消读取' }).click();
  await expect(page.getByText(/已取消本次读取/)).toBeVisible();
  await page.getByRole('button', { name: '← 返回文件列表' }).click();
  await page
    .getByRole('row', { name: /notes\.md/ })
    .getByRole('button', { name: '查看内容' })
    .click();
  release?.();
  await expect(page.getByRole('heading', { name: '安全的原始记录', exact: true })).toBeVisible();
  await expect(page.getByText('保留客户制度与质量目标')).toHaveCount(0);
  await page.route('**/sources/*/preview?*', (route) =>
    route.fulfill({ json: { ok: true, data: preview(docxId) } }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('无法读取这份资料');
  await expect(page.getByText('保留客户制度与质量目标')).toHaveCount(0);
});
