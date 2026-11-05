import type { EntryStatus } from './model.js';

const labels: Record<EntryStatus, string> = {
  ACCEPTED: '已接收',
  UNSUPPORTED: '不支持',
  CORRUPT: '文件损坏',
  READ_LIMITED: '读取受限',
};

export function entryStatusLabel(status: EntryStatus): string {
  return labels[status];
}

export function entryReasonText(code: string): string {
  switch (code) {
    case 'SYSTEM_METADATA_NOT_DOCUMENT':
      return '系统附属文件，不参与业务文档处理；已保留在清单中，无需作为文档修复。';
    case 'EXTERNAL_TEMPLATE_NOT_LOADED':
      return '外部模板未读取。仅保存文档包内内容，不包含外部模板的内容与效果。';
    case 'ACTIVE_CONTENT_NOT_SUPPORTED':
      return '含宏、嵌入对象或其他不支持的活动内容。请人工核对后另存为静态文档，通过新批次上传。';
    case 'EXTERNAL_REFERENCE_REQUIRES_REVIEW':
      return '存在尚未读取的外部引用。请核对依赖内容并整理为独立文档，通过新批次上传。';
    case 'INVALID_UTF8':
      return '文本编码不符合 UTF-8。请检查并另存为 UTF-8 文档后重新上传。';
    case 'INVALID_DOCX':
    case 'INVALID_XLSX':
      return '文档未通过格式或完整性检查。请检查文件，修复后通过新批次上传。';
    case 'UNSUPPORTED_MEDIA_TYPE':
      return '暂不支持此文件格式。请整理为 DOCX、Markdown 或 XLSX 后重新上传。';
    case 'EXTRACTION_FAILED':
      return '文件提取未完成。请核对文件和批次记录后再处理。';
    default:
      return '请根据接收说明核对该条目。';
  }
}
