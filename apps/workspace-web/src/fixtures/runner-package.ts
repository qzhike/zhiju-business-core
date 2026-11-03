export interface LocalPackageFile {
  path: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}
interface FileRef {
  relativePath: string;
  sha256: string;
}
export interface RunnerReadingFile {
  id: string;
  level: 1 | 2 | 3 | 4 | null;
  title: string;
  state: string;
  completeness: string;
  gaps: string[];
  limitations: string[];
  initial: { ref: FileRef; text: string } | null;
  before: { ref: FileRef; text: string } | null;
  candidate: { ref: FileRef; text: string } | null;
}
export interface RunnerReadingPackage {
  manifestSha256: string;
  identity: { taskId: string; stageId: string; step: string; roundId: string; roundNumber: number };
  status: string;
  summary: string;
  limitations: string[];
  issues: {
    id: string;
    fileIds: string[];
    title: string;
    status: string;
    blocking: string;
    request: string;
    original: string;
    reason: string;
    correction: { reason: string; request: string; evidenceIds: string[] } | null;
  }[];
  files: RunnerReadingFile[];
  packageFileCount: number;
  changeCount: number;
  proposalCount: number;
}
const MAX_FILES = 5000;
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): RecordValue {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    '交接数据对象无效。',
  );
  return value as RecordValue;
}
function text(value: unknown): string {
  requireValue(typeof value === 'string', '交接数据文字字段无效。');
  return value;
}
function array(value: unknown): unknown[] {
  requireValue(Array.isArray(value), '交接数据列表无效。');
  return value;
}
function strings(value: unknown): string[] {
  return array(value).map(text);
}
function path(value: unknown): string {
  const name = text(value);
  requireValue(
    name.length > 0 &&
      !/^[a-z]:/iu.test(name) &&
      !name.includes('\\') &&
      Array.from(name).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ) &&
      name.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    '交接包含有不安全或空文件路径。',
  );
  return name;
}
function ref(value: unknown): FileRef {
  const data = record(value);
  const sha256 = text(data.sha256);
  requireValue(/^[a-f0-9]{64}$/u.test(sha256), '文件摘要格式无效。');
  return { relativePath: path(data.relativePath), sha256 };
}
function sameRef(left: FileRef | null, right: FileRef | null) {
  return left === null
    ? right === null
    : right !== null && left.relativePath === right.relativePath && left.sha256 === right.sha256;
}
function snapshotRef(value: unknown): FileRef | null {
  if (value === null) return null;
  const item = ref(value);
  return { ...item, relativePath: `snapshot/${item.relativePath}` };
}
function identity(value: unknown): RunnerReadingPackage['identity'] {
  const item = record(value);
  requireValue(
    Number.isSafeInteger(item.roundNumber) && Number(item.roundNumber) > 0,
    '轮次编号无效。',
  );
  const result = {
    taskId: text(item.taskId),
    stageId: text(item.stageId),
    step: text(item.step),
    roundId: text(item.roundId),
    roundNumber: Number(item.roundNumber),
  };
  requireValue(
    result.taskId &&
      result.stageId &&
      result.roundId &&
      ['QUALITY_MANUAL', 'CONTROL_PROCEDURES', 'MANAGEMENT_RECORDS'].includes(result.step),
    '任务、阶段或轮次身份无效。',
  );
  return result;
}
function equalIdentity(left: unknown, right: unknown) {
  return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const item = record(value);
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(item[key])}`)
      .join(',')}}`;
  }
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}
async function digest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
function decode(bytes: ArrayBuffer): string {
  requireValue(bytes.byteLength <= MAX_TEXT_BYTES, '单份阅读文本超过 4 MiB，未截断显示。');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('文件不是有效 UTF-8，未用替换字符显示原文。');
  }
}

/** Local consistency checks only. This is never a Runner semantic acceptance or authorization. */
export async function readRunnerPackage(
  input: readonly LocalPackageFile[],
  signal?: AbortSignal,
): Promise<RunnerReadingPackage> {
  signal?.throwIfAborted();
  requireValue(
    input.length > 0 && input.length <= MAX_FILES,
    '请选择一个 handoff 目录（最多 5000 个文件）。',
  );
  requireValue(
    input.every(
      (file) => Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_FILE_BYTES,
    ) && input.reduce((sum, file) => sum + file.size, 0) <= MAX_BYTES,
    '交接包超过本地阅读预算（单文件 64 MiB、总量 512 MiB）。',
  );
  const root = path(input[0]?.path).split('/')[0];
  const files = new Map<string, LocalPackageFile>();
  for (const file of input) {
    const parts = path(file.path).split('/');
    requireValue(parts.length > 1 && parts[0] === root, '请选择一个完整的 handoff 目录。');
    const relative = parts.slice(1).join('/');
    requireValue(!files.has(relative), '交接包中存在重复文件路径。');
    files.set(relative, file);
  }
  const manifestFile = files.get('handoff.json');
  requireValue(
    manifestFile && manifestFile.size <= MAX_TEXT_BYTES,
    '所选目录缺少有效 handoff.json；请直接选择一个 handoff 目录。',
  );
  const manifestBytes = await manifestFile.arrayBuffer();
  requireValue(manifestBytes.byteLength === manifestFile.size, '交接包清单长度不一致。');
  const manifest = record(JSON.parse(decode(manifestBytes)) as unknown);
  requireValue(
    manifest.formatVersion === '1.0.0' && manifest.workspaceRoot === 'snapshot',
    '当前仅支持 1.0.0 交接包。',
  );
  const entries = new Map<string, FileRef & { bytes: number }>();
  requireValue(array(manifest.entries).length <= MAX_FILES - 1, '交接包清单超过本地文件预算。');
  for (const value of array(manifest.entries)) {
    const item = record(value);
    const fileRef = ref(value);
    requireValue(
      Number.isSafeInteger(item.bytes) &&
        Number(item.bytes) >= 0 &&
        Number(item.bytes) <= MAX_FILE_BYTES &&
        fileRef.relativePath !== 'handoff.json' &&
        !entries.has(fileRef.relativePath),
      '交接包清单有重复路径或无效长度。',
    );
    entries.set(fileRef.relativePath, { ...fileRef, bytes: Number(item.bytes) });
  }
  requireValue(
    entries.size === files.size - 1 &&
      [...files.keys()].every((name) => name === 'handoff.json' || entries.has(name)),
    '交接包文件集合与清单不一致。',
  );
  const read = async (fileRef: FileRef): Promise<ArrayBuffer> => {
    signal?.throwIfAborted();
    const entry = entries.get(fileRef.relativePath);
    const file = files.get(fileRef.relativePath);
    requireValue(
      entry && file && entry.sha256 === fileRef.sha256 && file.size === entry.bytes,
      '文件引用、长度或清单不一致。',
    );
    const bytes = await file.arrayBuffer();
    signal?.throwIfAborted();
    requireValue(
      bytes.byteLength === entry.bytes && (await digest(bytes)) === entry.sha256,
      '文件摘要不匹配，已停止读取。',
    );
    signal?.throwIfAborted();
    return bytes;
  };
  for (const entry of entries.values()) await read(entry);
  const json = async (value: unknown) =>
    record(JSON.parse(decode(await read(ref(value)))) as unknown);
  const review = await json(manifest.review);
  const report = await json(manifest.report);
  const context = await json(manifest.context);
  const annotations = await json(manifest.annotations);
  requireValue(
    review.formatVersion === '1.0.0' &&
      report.protocolVersion === '1.0.0' &&
      context.protocolVersion === '1.0.0' &&
      annotations.formatVersion === '1.0.0',
    '交接报告协议版本不一致。',
  );
  requireValue(
    equalIdentity(manifest.identity, review.identity) &&
      equalIdentity(manifest.identity, report.context) &&
      equalIdentity(manifest.identity, context),
    '交接包任务、阶段或轮次绑定不一致。',
  );
  requireValue(
    sameRef(ref(review.report), ref(manifest.report)) &&
      report.contextSha256 === ref(manifest.context).sha256 &&
      annotations.reportSha256 === ref(manifest.report).sha256,
    '原报告或上下文绑定不一致。',
  );
  requireValue(
    stable(report.context) === stable(context) &&
      review.summary === report.summary &&
      stable(array(review.limitations).slice(0, array(report.limitations).length)) ===
        stable(report.limitations),
    '报告正文或上下文与原始记录不一致。',
  );
  const status = text(report.status);
  requireValue(
    status === review.status &&
      ['REVISING', 'WAITING_INPUT', 'WAITING_REVIEW', 'COMPLETED', 'TERMINATED', 'FAILED'].includes(
        status,
      ),
    '报告状态不一致或未知。',
  );
  const originalFiles = array(report.files).map(record);
  const contextFiles = array(context.files).map(record);
  const reviewedFiles = array(review.files).map(record);
  const ids = reviewedFiles.map((item) => text(item.fileId));
  requireValue(
    new Set(ids).size === ids.length &&
      ids.length > 0 &&
      originalFiles.length === ids.length &&
      contextFiles.length === ids.length &&
      new Set(originalFiles.map((item) => text(item.id))).size === ids.length &&
      new Set(contextFiles.map((item) => text(item.id))).size === ids.length,
    '报告文件范围不一致或重复。',
  );
  const loadText = async (value: FileRef | null) => {
    if (value === null) return null;
    const source = decode(await read(value));
    let lines = source.length === 0 || source.endsWith('\n') ? 0 : 1;
    for (const character of source) if (character === '\n') lines++;
    requireValue(lines <= 10_000, '单份 Markdown 超过 10000 物理行，未截断显示。');
    return { ref: value, text: source };
  };
  const readingFiles: RunnerReadingFile[] = [];
  for (const item of reviewedFiles) {
    const id = text(item.fileId);
    const original = originalFiles.find((file) => file.id === id);
    const base = contextFiles.find((file) => file.id === id);
    requireValue(
      original &&
        base &&
        base.title === item.title &&
        original.state === item.state &&
        original.contentCompleteness === item.contentCompleteness,
      '文件状态或身份与原报告不一致。',
    );
    const initial = item.initial === null ? null : ref(item.initial);
    const before = item.before === null ? null : ref(item.before);
    const candidate = snapshotRef(original.candidate);
    const after = item.after === null ? null : ref(item.after);
    requireValue(
      sameRef(initial, snapshotRef(base.initial)) &&
        sameRef(before, snapshotRef(base.current)) &&
        sameRef(after, candidate ?? before),
      '底稿、前稿或候选引用与原报告不一致。',
    );
    const state = text(item.state);
    const completeness = text(item.contentCompleteness);
    requireValue(
      ['DRAFT', 'UNCHANGED', 'BLOCKED', 'FAILED', 'NOT_EXECUTED'].includes(state) &&
        ['COMPLETE', 'PARTIAL', 'NOT_ASSESSED'].includes(completeness),
      '未知文件状态或完整性。',
    );
    requireValue(
      candidate !== null || ['BLOCKED', 'FAILED', 'NOT_EXECUTED'].includes(state),
      '文件声明为审核稿，但原报告未提供候选。',
    );
    requireValue(
      stable(item.gaps) === stable(original.gaps) &&
        stable(item.readLimitations) === stable(base.readLimitations),
      '文件缺口或读取限制与原始记录不一致。',
    );
    readingFiles.push({
      id,
      level:
        typeof base.level === 'number' && [1, 2, 3, 4].includes(base.level)
          ? (base.level as 1 | 2 | 3 | 4)
          : null,
      title: text(item.title),
      state,
      completeness,
      gaps: strings(item.gaps),
      limitations: strings(item.readLimitations),
      initial: await loadText(initial),
      before: await loadText(before),
      candidate: await loadText(candidate),
    });
  }
  const originalIssues = array(report.issues).map(record);
  const reviewedIssues = array(review.issues).map(record);
  const issueNotes = array(annotations.issues).map(record);
  const issueIds = new Set(originalIssues.map((item) => text(item.id)));
  const reviewById = new Map(reviewedIssues.map((item) => [text(item.id), item]));
  const notesById = new Map(issueNotes.map((item) => [text(item.issueId), item]));
  requireValue(
    issueIds.size === originalIssues.length &&
      !issueIds.has('') &&
      reviewById.size === reviewedIssues.length &&
      reviewById.size === issueIds.size &&
      [...reviewById.keys()].every((id) => issueIds.has(id)) &&
      notesById.size === issueNotes.length &&
      [...notesById.keys()].every((id) => issueIds.has(id)),
    '问题集合与原报告或补充说明不一致。',
  );
  const issues = originalIssues.map((original) => {
    const id = text(original.id);
    const item = reviewById.get(id);
    requireValue(item, '问题集合与原报告不一致。');
    requireValue(
      Object.entries(original).every(([key, value]) => stable(value) === stable(item[key])),
      '问题状态或原始字段与原报告不一致。',
    );
    const correction = notesById.get(id)?.requestCorrection ?? null;
    requireValue(
      stable(item.requestCorrection) === stable(correction),
      '请求更正与补充说明不一致。',
    );
    const request = correction === null ? text(original.request) : text(record(correction).request);
    requireValue(item.effectiveRequest === request, '当前请求与原请求或结构化更正不一致。');
    return {
      id,
      fileIds: strings(original.fileIds),
      title: text(original.title),
      status: text(original.status),
      blocking: text(original.blocking),
      request,
      original: text(original.request),
      reason: text(original.reason),
      correction:
        correction === null
          ? null
          : {
              reason: text(record(correction).reason),
              request,
              evidenceIds: strings(record(correction).evidenceIds),
            },
    };
  });
  signal?.throwIfAborted();
  return {
    manifestSha256: await digest(manifestBytes),
    identity: identity(manifest.identity),
    status,
    summary: text(review.summary),
    limitations: strings(review.limitations),
    files: readingFiles,
    packageFileCount: files.size,
    changeCount: array(report.changes).length,
    proposalCount: array(review.proposals).length,
    issues,
  };
}
