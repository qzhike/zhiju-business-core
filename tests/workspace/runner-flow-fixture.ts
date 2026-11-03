import { createHash } from 'node:crypto';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Obj = Record<string, Json>;
const object = (value: Json | undefined) => value as Obj;
const first = (value: Json | undefined) => object((value as Json[])[0]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const contextPath = 'snapshot/host/context.json';
const reportPath = 'snapshot/output/round-2/revision-round.json';
const candidatePath = 'snapshot/output/round-2/manual.md';

/** Create internally consistent public test packages without touching raw source fixtures. */
export async function runnerFlowFixture(
  directory: string,
  options: {
    round?: number;
    task?: string;
    blocked?: boolean;
    long?: boolean;
    conflict?: boolean;
    issues?: number;
    summary?: string;
  } = {},
) {
  await cp(resolve('tests/fixtures/runner-display/handoff'), directory, { recursive: true });
  const rows = new Map<string, Buffer>();
  const visit = async (relative: string) => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else rows.set(name, await readFile(join(directory, name)));
    }
  };
  await visit('');
  const bytes = (name: string) => {
    const value = rows.get(name);
    if (!value) throw new Error(`Missing test input: ${name}`);
    return value;
  };
  const json = (name: string) => JSON.parse(bytes(name).toString()) as Obj;
  const put = (name: string, value: Obj) => rows.set(name, Buffer.from(JSON.stringify(value)));
  const refs = (value: Json): void => {
    if (Array.isArray(value)) {
      value.forEach(refs);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.relativePath === 'string' && typeof value.sha256 === 'string') {
      const raw = rows.get(value.relativePath) ?? rows.get(`snapshot/${value.relativePath}`);
      if (raw) value.sha256 = sha(raw);
    }
    Object.values(value).forEach(refs);
  };
  const context = json(contextPath);
  const identity = {
    taskId: options.task ?? 'SYNTHETIC-TASK',
    stageId: 'SYNTHETIC-STAGE',
    step: 'QUALITY_MANUAL',
    roundId: `ROUND-${options.round ?? 2}`,
    roundNumber: options.round ?? 2,
  };
  Object.assign(context, identity);
  first(context.files).level = 1;
  refs(context);
  put(contextPath, context);
  const report = json(reportPath);
  const review = json('review-data.json');
  if (options.summary !== undefined) report.summary = review.summary = options.summary;
  if (options.issues) {
    const original = first(report.issues);
    const originalReview = first(review.issues);
    for (let index = 1; index < options.issues; index++) {
      const request = `## 核对事项 ${index + 1}\n\n${'请核对具体依据，保留完整说明及原件中的业务信息。'.repeat(50)}`;
      const issue = {
        ...original,
        id: `QUESTION-${index + 1}`,
        title: `待核对事项 ${index + 1}`,
        status: index < 8 ? 'OPEN' : 'RESOLVED',
        blocking: index < 8 ? 'EDIT' : 'NONE',
        request,
      };
      (report.issues as Json[]).push(issue);
      (review.issues as Json[]).push({
        ...originalReview,
        ...issue,
        effectiveRequest: request,
        requestCorrection: null,
      });
    }
  }
  if (options.long)
    rows.set(
      candidatePath,
      Buffer.from(
        Array.from(
          { length: 150 },
          (_, index) =>
            `Paragraph ${index}. ${'Reading content flows with the document width. '.repeat(12)}`,
        ).join('\n\n'),
      ),
    );
  if (options.conflict) report.summary = review.summary = 'Conflicting round';
  if (options.blocked) {
    report.status = review.status = 'WAITING_INPUT';
    report.changes = review.changes = [];
    first(report.files).candidate = null;
    first(report.files).state = first(review.files).state = 'BLOCKED';
    first(report.files).contentCompleteness = first(review.files).contentCompleteness = 'PARTIAL';
    first(review.files).after = first(review.files).before ?? null;
  }
  report.context = context;
  report.contextSha256 = sha(bytes(contextPath));
  refs(report);
  put(reportPath, report);
  const annotations = json('annotations.json');
  annotations.reportSha256 = sha(bytes(reportPath));
  put('annotations.json', annotations);
  review.identity = identity;
  refs(review);
  put('review-data.json', review);
  const manifest = json('handoff.json');
  manifest.identity = identity;
  refs(manifest);
  manifest.entries = [...rows]
    .filter(([name]) => name !== 'handoff.json')
    .map(([name, raw]) => ({ relativePath: name, bytes: raw.byteLength, sha256: sha(raw) }));
  put('handoff.json', manifest);
  for (const [name, raw] of rows) await writeFile(join(directory, name), raw);
  return directory;
}
