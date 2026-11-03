import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  readRunnerPackage,
  type LocalPackageFile,
} from '../../apps/workspace-web/src/fixtures/runner-package.js';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type ObjectJson = Record<string, Json>;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value');
  return value;
}
const obj = (value: Json | undefined) => value as ObjectJson;
const list = (value: Json | undefined) => value as Json[];
const root = fileURLToPath(new URL('../fixtures/runner-display/handoff/', import.meta.url));
const contextPath = 'snapshot/host/context.json';
const reportPath = 'snapshot/output/round-2/revision-round.json';
const candidatePath = 'snapshot/output/round-2/manual.md';
function fixture() {
  const result = new Map<string, Buffer>();
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else result.set(relative(root, file), readFileSync(file));
    }
  }
  visit(root);
  return result;
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function json(rows: Map<string, Buffer>, name: string): ObjectJson {
  return JSON.parse(rows.get(name)?.toString() ?? '{}') as ObjectJson;
}
function put(rows: Map<string, Buffer>, name: string, value: ObjectJson) {
  rows.set(name, Buffer.from(JSON.stringify(value)));
}
function edit(rows: Map<string, Buffer>, name: string, change: (value: ObjectJson) => void) {
  const value = json(rows, name);
  change(value);
  put(rows, name, value);
}
function seal(rows: Map<string, Buffer>) {
  const refs = (value: Json): void => {
    if (Array.isArray(value)) {
      value.forEach(refs);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.relativePath === 'string' && typeof value.sha256 === 'string') {
      const bytes = rows.get(value.relativePath) ?? rows.get(`snapshot/${value.relativePath}`);
      if (bytes) value.sha256 = sha(bytes);
    }
    Object.values(value).forEach(refs);
  };
  const context = json(rows, contextPath);
  refs(context);
  put(rows, contextPath, context);
  const report = json(rows, reportPath);
  report.context = context;
  report.contextSha256 = sha(required(rows.get(contextPath)));
  refs(report);
  put(rows, reportPath, report);
  const annotations = json(rows, 'annotations.json');
  annotations.reportSha256 = sha(required(rows.get(reportPath)));
  put(rows, 'annotations.json', annotations);
  const review = json(rows, 'review-data.json');
  refs(review);
  put(rows, 'review-data.json', review);
  const manifest = json(rows, 'handoff.json');
  refs(manifest);
  manifest.entries = [...rows]
    .filter(([name]) => name !== 'handoff.json')
    .map(([name, bytes]) => ({ relativePath: name, sha256: sha(bytes), bytes: bytes.byteLength }));
  put(rows, 'handoff.json', manifest);
}
function files(rows: Map<string, Buffer>): LocalPackageFile[] {
  return [...rows].map(([name, bytes]) => ({
    path: `handoff/${name}`,
    size: bytes.byteLength,
    arrayBuffer: () => Promise.resolve(Uint8Array.from(bytes).buffer),
  }));
}

describe('local Runner reading boundary', () => {
  it('preserves report limitations plus the export tool reading notices, and rejects removed report limits', async () => {
    const rows = fixture();
    edit(rows, reportPath, (data) => {
      data.limitations = ['Original report limit'];
    });
    edit(rows, 'review-data.json', (data) => {
      data.limitations = ['Original report limit', 'Additional reading limit'];
    });
    seal(rows);
    expect((await readRunnerPackage(files(rows))).limitations).toEqual([
      'Original report limit',
      'Additional reading limit',
    ]);
    edit(rows, 'review-data.json', (data) => {
      data.limitations = ['Additional reading limit'];
    });
    seal(rows);
    await expect(readRunnerPackage(files(rows))).rejects.toThrow('不一致');
  });
  it('reads distinct original/previous/candidate bytes and the supplied corrected request', async () => {
    const result = await readRunnerPackage(files(fixture()));
    expect(result.identity.roundNumber).toBe(2);
    expect(result.files[0]?.initial?.text).toContain('Original procedure.\r\n');
    expect(result.files[0]?.before?.text).toContain('Procedure revision one.');
    expect(result.files[0]?.candidate?.text).toContain('Procedure revision two.');
    expect(result.files[0]?.candidate?.text.endsWith('End without newline.')).toBe(true);
    expect(result.issues[0]?.request).toBe('仅确认当前责任人。');
    expect(result.issues[0]?.original).toContain('重新提供完整材料');
  });
  it('keeps candidate=null distinct from an after reference to the unchanged baseline', async () => {
    const rows = fixture();
    edit(rows, reportPath, (data) => {
      data.status = 'WAITING_INPUT';
      data.changes = [];
      const file = obj(list(data.files)[0]);
      file.candidate = null;
      file.state = 'BLOCKED';
      file.contentCompleteness = 'PARTIAL';
    });
    edit(rows, 'review-data.json', (data) => {
      data.status = 'WAITING_INPUT';
      data.changes = [];
      const file = obj(list(data.files)[0]);
      file.after = required(file.before);
      file.state = 'BLOCKED';
      file.contentCompleteness = 'PARTIAL';
    });
    seal(rows);
    const result = await readRunnerPackage(files(rows));
    expect(result.files[0]?.candidate).toBeNull();
    expect(result.files[0]?.before?.text).toContain('Procedure revision one.');
    expect(result.status).toBe('WAITING_INPUT');
  });
  it('retains an existing candidate even when its bytes equal the previous draft', async () => {
    const rows = fixture();
    rows.set(candidatePath, required(rows.get('snapshot/output/round-1/manual.md')));
    seal(rows);
    const result = await readRunnerPackage(files(rows));
    expect(result.files[0]?.candidate).not.toBeNull();
    expect(result.files[0]?.candidate?.text).toBe(result.files[0]?.before?.text);
  });
  it.each(['missing', 'extra', 'digest', 'duplicate', 'traversal', 'absolute'])(
    'rejects %s package input',
    async (kind) => {
      const rows = fixture();
      let input = files(rows);
      if (kind === 'missing')
        input = input.filter((file) => file.path !== `handoff/${candidatePath}`);
      if (kind === 'extra')
        input.push({
          path: 'handoff/extra.md',
          size: 0,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      if (kind === 'digest')
        input = input.map((file) =>
          file.path === `handoff/${candidatePath}`
            ? { ...file, arrayBuffer: () => Promise.resolve(new Uint8Array(file.size).buffer) }
            : file,
        );
      if (kind === 'duplicate') input.push(required(input[0]));
      if (kind === 'traversal') input[0] = { ...required(input[0]), path: 'handoff/../escape' };
      if (kind === 'absolute') input[0] = { ...required(input[0]), path: '/handoff/escape' };
      await expect(readRunnerPackage(input)).rejects.toThrow();
    },
  );
  it('rejects invalid UTF-8 despite valid manifest hashes', async () => {
    const rows = fixture();
    rows.set(candidatePath, Buffer.from([0xc3, 0x28]));
    seal(rows);
    await expect(readRunnerPackage(files(rows))).rejects.toThrow('UTF-8');
  });
  it('rejects source text over the physical-line budget instead of rendering a partial diff', async () => {
    const rows = fixture();
    rows.set(candidatePath, Buffer.from('\n'.repeat(10_001)));
    seal(rows);
    await expect(readRunnerPackage(files(rows))).rejects.toThrow('10000 物理行');
  });
  it('preserves a source BOM instead of silently dropping it', async () => {
    const rows = fixture();
    rows.set(candidatePath, Buffer.from('\uFEFF# Source\r\n'));
    seal(rows);
    const result = await readRunnerPackage(files(rows));
    expect(result.files[0]?.candidate?.text).toBe('\uFEFF# Source\r\n');
  });
  it.each(['identity', 'candidate', 'baseline', 'state', 'context', 'title'])(
    'rejects a rehashed %s mismatch',
    async (kind) => {
      const rows = fixture();
      edit(rows, 'review-data.json', (data) => {
        const file = obj(list(data.files)[0]);
        if (kind === 'identity') obj(data.identity).roundNumber = 99;
        if (kind === 'candidate') file.after = required(file.before);
        if (kind === 'baseline') file.initial = required(file.before);
        if (kind === 'state') file.state = 'FAILED';
        if (kind === 'title') file.title = 'Another document';
      });
      if (kind === 'context')
        edit(rows, contextPath, (data) => {
          data.roundId = 'WRONG-ROUND';
        });
      seal(rows);
      await expect(readRunnerPackage(files(rows))).rejects.toThrow(/不一致/u);
    },
  );
  it.each([
    'status',
    'blocking',
    'request',
    'reason',
    'title',
    'effectiveRequest',
    'correction',
    'duplicate',
    'missing',
    'unknown',
  ])('rejects a rehashed issue %s mismatch', async (kind) => {
    const rows = fixture();
    edit(rows, 'review-data.json', (data) => {
      const issue = obj(list(data.issues)[0]);
      if (kind === 'status') issue.status = 'RESOLVED';
      if (kind === 'blocking') issue.blocking = 'EDIT';
      if (['request', 'reason', 'title', 'effectiveRequest'].includes(kind))
        issue[kind] = 'No confirmation needed';
      if (kind === 'correction') obj(issue.requestCorrection).reason = 'Invented correction';
      if (kind === 'duplicate') list(data.issues).push(issue);
      if (kind === 'missing') data.issues = [];
      if (kind === 'unknown') issue.id = 'OTHER';
    });
    seal(rows);
    await expect(readRunnerPackage(files(rows))).rejects.toThrow('不一致');
  });
  it('keeps the original request current when no correction was exported', async () => {
    const rows = fixture();
    edit(rows, 'annotations.json', (data) => {
      data.issues = [];
    });
    edit(rows, 'review-data.json', (data) => {
      const issue = obj(list(data.issues)[0]);
      issue.requestCorrection = null;
      issue.effectiveRequest = issue.request ?? '';
    });
    seal(rows);
    const loaded = await readRunnerPackage(files(rows));
    expect(loaded.issues[0]?.request).toBe(loaded.issues[0]?.original);
    expect(loaded.issues[0]?.correction).toBeNull();
  });
  it('checks the budget before reading and observes cancellation', async () => {
    const read = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    await expect(
      readRunnerPackage([
        { path: 'handoff/handoff.json', size: 65 * 1024 * 1024, arrayBuffer: read },
      ]),
    ).rejects.toThrow('预算');
    expect(read).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(readRunnerPackage(files(fixture()), controller.signal)).rejects.toThrow();
  });
});
