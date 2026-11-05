export const previewReasonText = {
  EXTERNAL_TEMPLATE_NOT_LOADED: '外部模板未读取，仅包含文档包内的内容。',
  EXTRACTED_VIEW_ONLY: '这是分类提取内容，不是 Word 原版排版或全文已读证明。',
  TABLE_TEXT_REPEATED: '表格内文字也会出现在段落提取中；表格另列，不代表原件重复。',
  NUMBERING_NOT_RENDERED: '原文自动编号和段落、表格的版面关系未完整还原。',
  TEXT_REVISIONS_ONLY:
    '仅提取插入、删除、移出、移入的文本修订，按类型分组；不含完整原位和格式修订。0 条不代表原件没有修订。',
  MEDIA_NOT_INTERPRETED: '图片已清点，但图像内容尚未解释，请下载原件核对。',
  INCOMPLETE_EXTRACTION: '部分内容或定位未完整提取，请结合原件核对。',
  FORMAT_NOT_SUPPORTED: '此格式暂未提供提取视图，可下载原件核对。',
  NESTED_TABLE_NOT_SUPPORTED: '文档含嵌套表格，首版暂不提供该文件的提取视图，可下载原件核对。',
  EMPTY_CONTENT: '未提取到可显示的内容，不能据此判断原件为空。',
  UNSAFE_CONTENT: '文档未通过本次安全读取检查，原接收结果保持不变。',
  RESOURCE_LIMIT: '本次预览超出安全读取限额，可下载原件核对。',
  TIMEOUT: '本次读取超时，已停止处理，可以重试。',
  BUSY: '正在读取另一份文件，请稍后重试。',
  DEPENDENCY_UNAVAILABLE: '内容读取服务暂不可用，原件仍可下载。',
  INVALID_READER_OUTPUT: '本次提取结果未通过校验，未展示不可靠内容。',
  CANCELLED: '本次读取已取消。',
} as const;
export type PreviewReason = keyof typeof previewReasonText;
export interface PreviewIdentity {
  readonly projectId: string;
  readonly batchId: string;
  readonly sourceId: string;
  readonly manifestId: string;
}
export interface PreviewCell {
  readonly text: string;
  readonly column: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}
export type PreviewSections =
  | { readonly format: 'MARKDOWN'; readonly source: string }
  | {
      readonly format: 'DOCX';
      readonly paragraphs: readonly {
        readonly position: number;
        readonly text: string;
        readonly style?: string;
      }[];
      readonly tables: readonly {
        readonly position: number;
        readonly rows: readonly { readonly cells: readonly PreviewCell[] }[];
      }[];
      readonly headersFooters: readonly { readonly part: string; readonly text: string }[];
      readonly comments: readonly {
        readonly id: string;
        readonly text: string;
        readonly paragraphs: readonly number[];
      }[];
      readonly revisions: readonly {
        readonly kind: 'ins' | 'del' | 'moveFrom' | 'moveTo';
        readonly id: string;
        readonly text: string;
      }[];
      readonly fields: readonly { readonly part: string; readonly text: string }[];
    };
export interface SourcePreview {
  readonly sourceRef: {
    readonly projectId: string;
    readonly batchId: string;
    readonly sourceId: string;
    readonly kind: 'ACCEPTED_ENTRY';
    readonly sha256: string;
    readonly byteLength: number;
    readonly mediaType: string;
  };
  readonly manifestId: string;
  readonly fileName: string;
  readonly profileId: 'mvp.source-preview@1';
  readonly status: 'AVAILABLE' | 'LIMITED' | 'UNSUPPORTED' | 'UNAVAILABLE';
  readonly limitations: readonly PreviewReason[];
  readonly sections?: PreviewSections;
}
export function previewId(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
  );
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('invalid preview');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 200000) throw new Error('invalid preview');
  return value as unknown[];
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid preview');
  return value;
}
function number(value: unknown, minimum = 1, maximum = 200000): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error('invalid preview');
  return value;
}
function sections(value: unknown): PreviewSections {
  const base = object(value, [
    'format',
    'source',
    'paragraphs',
    'tables',
    'headersFooters',
    'comments',
    'revisions',
    'fields',
  ]);
  if (base.format === 'MARKDOWN') {
    object(value, ['format', 'source']);
    return { format: 'MARKDOWN', source: string(base.source) };
  }
  if (base.format !== 'DOCX' || 'source' in base) throw new Error('invalid preview');
  const located = (value: unknown) => {
    const item = object(value, ['part', 'text']);
    return { part: string(item.part), text: string(item.text) };
  };
  const paragraphs = array(base.paragraphs).map((value) => {
    const row = object(value, ['position', 'text', 'style']);
    return {
      position: number(row.position),
      text: string(row.text),
      ...(row.style === undefined ? {} : { style: string(row.style) }),
    };
  });
  return {
    format: 'DOCX',
    paragraphs,
    tables: array(base.tables).map((value) => {
      const table = object(value, ['position', 'rows']);
      const rawRows = array(table.rows);
      const rows = rawRows.map((value, rowIndex) => ({
        cells: array(object(value, ['cells']).cells).map((value) => {
          const cell = object(value, ['text', 'column', 'colSpan', 'rowSpan']);
          const column = number(cell.column, 1, 512);
          return {
            text: string(cell.text),
            column,
            colSpan: number(cell.colSpan, 1, 513 - column),
            rowSpan: number(cell.rowSpan, 1, rawRows.length - rowIndex),
          };
        }),
      }));
      return { position: number(table.position), rows };
    }),
    headersFooters: array(base.headersFooters).map(located),
    fields: array(base.fields).map(located),
    comments: array(base.comments).map((value) => {
      const item = object(value, ['id', 'text', 'paragraphs']);
      return {
        id: string(item.id),
        text: string(item.text),
        paragraphs: array(item.paragraphs).map((value) => number(value, 1, paragraphs.length)),
      };
    }),
    revisions: array(base.revisions).map((value) => {
      const item = object(value, ['kind', 'id', 'text']);
      if (
        item.kind !== 'ins' &&
        item.kind !== 'del' &&
        item.kind !== 'moveFrom' &&
        item.kind !== 'moveTo'
      )
        throw new Error('invalid preview');
      return { kind: item.kind, id: string(item.id), text: string(item.text) } as const;
    }),
  };
}
export function parseSourcePreview(
  value: unknown,
  identity: PreviewIdentity,
): SourcePreview | null {
  try {
    const item = object(value, [
      'sourceRef',
      'manifestId',
      'fileName',
      'profileId',
      'status',
      'limitations',
      'sections',
    ]);
    const source = object(item.sourceRef, [
      'projectId',
      'batchId',
      'sourceId',
      'kind',
      'sha256',
      'byteLength',
      'mediaType',
    ]);
    if (
      source.projectId !== identity.projectId ||
      source.batchId !== identity.batchId ||
      source.sourceId !== identity.sourceId ||
      item.manifestId !== identity.manifestId ||
      source.kind !== 'ACCEPTED_ENTRY' ||
      item.profileId !== 'mvp.source-preview@1'
    )
      return null;
    if (
      item.status !== 'AVAILABLE' &&
      item.status !== 'LIMITED' &&
      item.status !== 'UNSUPPORTED' &&
      item.status !== 'UNAVAILABLE'
    )
      return null;
    if (!/^[0-9a-f]{64}$/u.test(string(source.sha256))) return null;
    const limitations = array(item.limitations).map((reason) => {
      if (typeof reason !== 'string' || !Object.hasOwn(previewReasonText, reason))
        throw new Error('invalid preview');
      return reason as PreviewReason;
    });
    const content = item.sections === undefined ? undefined : sections(item.sections);
    if (
      (item.status === 'AVAILABLE' || item.status === 'LIMITED') !== (content !== undefined) ||
      (item.status === 'AVAILABLE' && limitations.length !== 0) ||
      (content?.format === 'DOCX' && item.status !== 'LIMITED')
    )
      return null;
    return {
      sourceRef: {
        projectId: identity.projectId,
        batchId: identity.batchId,
        sourceId: identity.sourceId,
        kind: 'ACCEPTED_ENTRY',
        sha256: string(source.sha256),
        byteLength: number(source.byteLength, 0, 50 * 1024 * 1024),
        mediaType: string(source.mediaType),
      },
      manifestId: identity.manifestId,
      fileName: string(item.fileName),
      profileId: 'mvp.source-preview@1',
      status: item.status,
      limitations,
      ...(content === undefined ? {} : { sections: content }),
    };
  } catch {
    return null;
  }
}
