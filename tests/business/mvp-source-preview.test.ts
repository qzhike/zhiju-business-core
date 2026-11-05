import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, readFile, cp, writeFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { SourcePreviewReader } from '../../modules/document-delivery/src/preview/reader.js';
import { preflightPreview } from '../../modules/document-delivery/src/preview/preflight.js';
import { hash } from '../../modules/document-delivery/src/preview/files.js';
import { READER_FILES } from '../../modules/document-delivery/src/preview/profile.js';
import { normalizeExtraction } from '../../modules/document-delivery/src/preview/normalize.js';
import { PYTHON_WRAPPER } from '../../modules/document-delivery/src/preview/python.js';
import { MEDIA_TYPES } from '../../modules/document-delivery/src/domain/policy.js';
import type { PreviewSource } from '../../modules/document-delivery/src/preview/types.js';
import { docxBytes, zipBytes } from '../persistence/mvp-fixtures.js';

const runnerRoot = resolve('tests/fixtures/document-preview');
const python = execFileSync('python3', ['-I', '-S', '-c', 'import sys; print(sys.executable)'], {
  encoding: 'utf8',
}).trim();
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const directories: string[] = [];
const activeReaders: SourcePreviewReader[] = [];
function trackedReader(options: ConstructorParameters<typeof SourcePreviewReader>[0]) {
  const instance = new SourcePreviewReader(options);
  activeReaders.push(instance);
  return instance;
}
function source(
  bytes: Buffer,
  mediaType: string = MEDIA_TYPES.markdown,
  reasonCodes: readonly string[] = [],
): PreviewSource {
  return {
    sourceRef: {
      projectId: newUuidV7(),
      batchId: newUuidV7(),
      sourceId: newUuidV7(),
      kind: 'ACCEPTED_ENTRY',
      sha256: hash(bytes),
      byteLength: bytes.length,
      mediaType,
    },
    manifestId: newUuidV7(),
    fileName: '<unsafe-name>.docx',
    reasonCodes,
  };
}
async function reader(root = runnerRoot) {
  const directory = await mkdtemp(join(tmpdir(), 'preview-test-'));
  directories.push(directory);
  const instance = trackedReader({
    python,
    runnerRoot: root,
    temporaryRoot: join(directory, 'jobs'),
  });
  await instance.initialize();
  return { instance, directory };
}
function document(body: string, extra: readonly { name: string; bytes: Buffer }[] = []) {
  return zipBytes([
    {
      name: 'word/document.xml',
      bytes: Buffer.from(`<w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>`),
    },
    ...extra,
  ]);
}
const paragraph = '<w:p><w:r><w:t>Original text &amp; content</w:t></w:r></w:p>';

afterEach(async () => {
  await Promise.all(activeReaders.splice(0).map((instance) => instance.close()));
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('MVP source preview', () => {
  it('pins only the exact synthetic-test reader snapshot', async () => {
    for (const [name, expected] of Object.entries(READER_FILES))
      expect(hash(await readFile(join(runnerRoot, 'runner_evidence', name)))).toBe(expected);
  });
  it('keeps original CRLF/CR/LF and untrusted Markdown as data through the real collector', async () => {
    const bytes = Buffer.from(
      '# heading\r\nA\rB\n<script>alert(1)</script>\n![x](https://invalid.example/image)',
    );
    const identity = source(bytes);
    const { instance, directory } = await reader();
    const result = await instance.read(identity, () => Promise.resolve(bytes));
    expect(result.status).toBe('AVAILABLE');
    expect(result.sourceRef).toEqual(identity.sourceRef);
    expect(result.sections).toEqual({ format: 'MARKDOWN', source: bytes.toString() });
    expect(await readdir(join(directory, 'jobs'))).toEqual([]);
  });
  it('extracts merged tables, auxiliary parts, comments and text revisions without claiming READ', async () => {
    const bytes = document(
      `${paragraph}<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl><w:p><w:commentReference w:id="1"/><w:ins w:id="2"><w:r><w:t>Added</w:t></w:r></w:ins><w:del w:id="3"><w:r><w:delText>Removed</w:delText></w:r></w:del><w:moveFrom w:id="4"><w:r><w:delText>Moved out</w:delText></w:r></w:moveFrom><w:moveTo w:id="5"><w:r><w:t>Moved in</w:t></w:r></w:moveTo></w:p>`,
      [
        {
          name: 'word/header1.xml',
          bytes: Buffer.from(`<w:hdr xmlns:w="${WORD}">${paragraph}</w:hdr>`),
        },
        {
          name: 'word/comments.xml',
          bytes: Buffer.from(
            `<w:comments xmlns:w="${WORD}"><w:comment w:id="1">${paragraph}</w:comment></w:comments>`,
          ),
        },
      ],
    );
    const { instance } = await reader();
    const result = await instance.read(
      source(bytes, MEDIA_TYPES.docx, ['EXTERNAL_TEMPLATE_NOT_LOADED']),
      () => Promise.resolve(bytes),
    );
    expect({ status: result.status, limitations: result.limitations }).toMatchObject({
      status: 'LIMITED',
    });
    expect(result.limitations).toContain('EXTERNAL_TEMPLATE_NOT_LOADED');
    expect(result.limitations).toContain('TEXT_REVISIONS_ONLY');
    expect(result.sections).toMatchObject({
      format: 'DOCX',
      tables: [{ rows: [{ cells: [{ text: 'Merged', colSpan: 2, rowSpan: 2 }] }, { cells: [] }] }],
      comments: [{ id: '1', text: 'Original text & content' }],
      headersFooters: [{ part: 'word/header1.xml', text: 'Original text & content' }],
      revisions: [
        { kind: 'ins', text: 'Added' },
        { kind: 'del', text: 'Removed' },
        { kind: 'moveFrom', text: 'Moved out' },
        { kind: 'moveTo', text: 'Moved in' },
      ],
    });
  });
  it('does not equate zero extracted text revisions with no format revisions', async () => {
    const bytes = document(
      '<w:p><w:pPr><w:pPrChange w:id="1"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>Text</w:t></w:r></w:p>',
    );
    const { instance } = await reader();
    const result = await instance.read(source(bytes, MEDIA_TYPES.docx), () =>
      Promise.resolve(bytes),
    );
    expect(result).toMatchObject({ status: 'LIMITED', sections: { revisions: [] } });
    expect(result.limitations).toContain('TEXT_REVISIONS_ONLY');
  });
  it.each(['word/styles.xml', 'word/numbering.xml', 'word/headerUnused.xml', 'word/comments.xml'])(
    'rejects entities in even unreferenced auxiliary XML: %s',
    (name) => {
      const root = name.includes('styles')
        ? 'styles'
        : name.includes('numbering')
          ? 'numbering'
          : name.includes('header')
            ? 'hdr'
            : 'comments';
      const bytes = document(paragraph, [
        {
          name,
          bytes: Buffer.from(
            `<!DOCTYPE w:${root} [<!ENTITY leak SYSTEM "file:///not-accessed">]><w:${root} xmlns:w="${WORD}">&leak;</w:${root}>`,
          ),
        },
      ]);
      expect(() => {
        preflightPreview(bytes, MEDIA_TYPES.docx);
      }).toThrow();
    },
  );
  it('rejects nested tables, deep XML and repeated-numbering amplification before collector execution', () => {
    expect(() => {
      preflightPreview(
        document(`<w:tbl><w:tr><w:tc><w:tbl/></w:tc></w:tr></w:tbl>`),
        MEDIA_TYPES.docx,
      );
    }).toThrow('NESTED_TABLE_NOT_SUPPORTED');
    expect(() => {
      preflightPreview(
        document('<w:sdt>'.repeat(130) + paragraph + '</w:sdt>'.repeat(130)),
        MEDIA_TYPES.docx,
      );
    }).toThrow('RESOURCE_LIMIT');
    const numbering = `<w:numbering xmlns:w="${WORD}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:lvlText w:val="${'x'.repeat(4000)}"/></w:lvl></w:abstractNum></w:numbering>`;
    expect(() => {
      preflightPreview(
        document(paragraph.repeat(300), [
          { name: 'word/numbering.xml', bytes: Buffer.from(numbering) },
        ]),
        MEDIA_TYPES.docx,
      );
    }).toThrow('RESOURCE_LIMIT');
  });
  it('distinguishes unsupported formats, strict namespaces, empty text and runtime drift', async () => {
    const { instance, directory } = await reader();
    const xlsx = Buffer.from('not interpreted');
    expect(
      (await instance.read(source(xlsx, MEDIA_TYPES.xlsx), () => Promise.resolve(xlsx)))
        .limitations,
    ).toContain('FORMAT_NOT_SUPPORTED');
    // Build the namespace in the actual main part, not only in the body.
    const strictDocx = zipBytes([
      {
        name: 'word/document.xml',
        bytes: Buffer.from(
          `<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body>${paragraph}</w:body></w:document>`,
        ),
      },
    ]);
    expect(
      (await instance.read(source(strictDocx, MEDIA_TYPES.docx), () => Promise.resolve(strictDocx)))
        .status,
    ).toBe('UNSUPPORTED');
    const empty = Buffer.from(' \r\n');
    expect(
      (await instance.read(source(empty), () => Promise.resolve(empty))).limitations,
    ).toContain('EMPTY_CONTENT');
    const driftRoot = join(directory, 'drift');
    await cp(runnerRoot, driftRoot, { recursive: true });
    await writeFile(join(driftRoot, 'runner_evidence/reader.py'), '# wrong version');
    const drift = await reader(driftRoot);
    const bytes = Buffer.from('real text');
    expect(
      (await drift.instance.read(source(bytes), () => Promise.resolve(bytes))).limitations,
    ).toContain('DEPENDENCY_UNAVAILABLE');
  });
  it('rejects cross-reference amplification before starting Python and permits bounded comments', async () => {
    const body = '<w:p><w:r><w:t>Text</w:t></w:r><w:commentReference w:id="repeat"/></w:p>'.repeat(
      1500,
    );
    const comment = `<w:comment w:id="repeat">${paragraph}</w:comment>`;
    const comments = (copies: number) =>
      document(body, [
        {
          name: 'word/comments.xml',
          bytes: Buffer.from(
            `<w:comments xmlns:w="${WORD}">${comment.repeat(copies)}</w:comments>`,
          ),
        },
      ]);
    const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const link = `<w:hyperlink xmlns:r="${relationship}" r:id="long"><w:r><w:t>Link</w:t></w:r></w:hyperlink>`;
    const links = (copies: number) =>
      document(`<w:p>${link.repeat(copies)}</w:p>`, [
        {
          name: 'word/_rels/document.xml.rels',
          bytes: Buffer.from(
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="long" Target="${'x'.repeat(8000)}" Type="hyperlink"/></Relationships>`,
          ),
        },
      ]);
    const { instance, directory } = await reader();
    const control = comments(1);
    const result = await instance.read(source(control, MEDIA_TYPES.docx), () =>
      Promise.resolve(control),
    );
    expect(result.status).toBe('LIMITED');
    expect(
      result.sections?.format === 'DOCX' && result.sections.comments[0]?.paragraphs.length,
    ).toBe(1500);
    expect(() => {
      preflightPreview(links(1), MEDIA_TYPES.docx);
    }).not.toThrow();
    const marker = join(directory, 'must-not-start');
    const executable = join(directory, 'marker-interpreter');
    await writeFile(
      executable,
      `#!${python}\nimport pathlib\npathlib.Path(${JSON.stringify(marker)}).write_text('started')\n`,
      { mode: 0o700 },
    );
    const guarded = trackedReader({
      python: executable,
      runnerRoot,
      temporaryRoot: join(directory, 'guarded-jobs'),
    });
    await guarded.initialize();
    const nestedControls = document(paragraph, [
      {
        name: 'word/comments.xml',
        bytes: Buffer.from(
          `<w:comments xmlns:w="${WORD}">${'<w:comment>'.repeat(64)}${'<w:p>'.repeat(60)}<w:r><w:t>x</w:t>${'<w:br/>'.repeat(1500)}<w:t>x</w:t></w:r>${'</w:p>'.repeat(60)}${'</w:comment>'.repeat(64)}</w:comments>`,
        ),
      },
    ]);
    const repeatedPartNames = document(paragraph, [
      {
        name: `word/header${'x'.repeat(225)}.xml`,
        bytes: Buffer.from(
          `<w:hdr xmlns:w="${WORD}">${'<w:instrText>x</w:instrText>'.repeat(29000)}</w:hdr>`,
        ),
      },
    ]);
    for (const bytes of [comments(1500), links(1500), nestedControls, repeatedPartNames]) {
      expect(() => {
        preflightPreview(bytes, MEDIA_TYPES.docx);
      }).toThrow('RESOURCE_LIMIT');
      const result = await guarded.read(source(bytes, MEDIA_TYPES.docx), () =>
        Promise.resolve(bytes),
      );
      expect(result.limitations).toContain('RESOURCE_LIMIT');
      expect(await readFile(marker, 'utf8').catch(() => '')).toBe('');
      expect(await readdir(join(directory, 'guarded-jobs'))).toEqual([]);
    }
  });
  it('bounds concurrent work, cancels without publishing content, and recovers the same source', async () => {
    const { instance, directory } = await reader();
    const bytes = Buffer.from('stable source');
    const identity = source(bytes);
    const abort = new AbortController();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = instance.read(
      identity,
      async () => {
        await blocked;
        return bytes;
      },
      abort.signal,
    );
    expect((await instance.read(identity, () => Promise.resolve(bytes))).limitations).toContain(
      'BUSY',
    );
    abort.abort();
    release?.();
    expect((await first).limitations).toContain('CANCELLED');
    expect((await instance.read(identity, () => Promise.resolve(bytes))).status).toBe('AVAILABLE');
    expect(await readdir(join(directory, 'jobs'))).toEqual([]);
  });
  it('rejects a mismatched byte identity and excessive display spans', async () => {
    const { instance } = await reader();
    const bytes = Buffer.from('original');
    expect(
      (await instance.read(source(bytes), () => Promise.resolve(Buffer.from('other')))).limitations,
    ).toContain('INVALID_READER_OUTPUT');
    const bytesDocx = document(
      '<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="999999999"/></w:tcPr></w:tc></w:tr></w:tbl>',
    );
    expect(() => {
      preflightPreview(bytesDocx, MEDIA_TYPES.docx);
    }).toThrow('UNSAFE_CONTENT');
    expect(() =>
      normalizeExtraction({
        format: 'DOCX',
        technicalReadCeiling: 'READ',
        limitations: [],
        injected: true,
      }),
    ).toThrow();
  });
  it('enforces the raw artifact file limit in the actual isolated Python wrapper', async () => {
    const { directory } = await reader();
    await mkdir(join(directory, 'code'));
    await cp(join(runnerRoot, 'runner_evidence'), join(directory, 'code/runner_evidence'), {
      recursive: true,
    });
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1, 'a');
    await writeFile(join(directory, 'input.md'), bytes);
    await writeFile(join(directory, 'read.py'), PYTHON_WRAPPER);
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        sources: [
          {
            sourceId: newUuidV7(),
            role: 'CUSTOMER_MATERIAL',
            materializedRelativePath: 'input.md',
            sha256: hash(bytes),
          },
        ],
      }),
    );
    // Intentionally bypass admission to exercise the second, execution-time guard.
    const child = spawn(python, ['-I', '-S', '-B', 'read.py'], {
      cwd: directory,
      env: { LANG: 'C.UTF-8' },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const closed = once(child, 'close');
    child.stdin.end('go\n');
    const [code, signal] = await closed;
    expect(code).not.toBe(0);
    expect(signal).toBe('SIGXFSZ');
  });

  it('terminates a live interpreter on cancellation and execution-time memory excess', async () => {
    const { directory } = await reader();
    const executable = join(directory, 'controlled-interpreter');
    const marker = join(directory, 'started');
    await writeFile(
      executable,
      `#!${python}\nimport pathlib,time\npathlib.Path(${JSON.stringify(marker)}).write_text('started')\ntime.sleep(60)\n`,
      { mode: 0o700 },
    );
    const instance = trackedReader({
      python: executable,
      runnerRoot,
      temporaryRoot: join(directory, 'controlled-jobs'),
    });
    await instance.initialize();
    const bytes = Buffer.from('bounded source');
    const abort = new AbortController();
    const pending = instance.read(source(bytes), () => Promise.resolve(bytes), abort.signal);
    await expect.poll(async () => readFile(marker, 'utf8').catch(() => '')).toBe('started');
    abort.abort();
    expect((await pending).limitations).toContain('CANCELLED');
    expect(await readdir(join(directory, 'controlled-jobs'))).toEqual([]);
    // Random pages force a real RSS excess even under macOS memory compression.
    await writeFile(
      executable,
      `#!${python}\nimport os,time\ndata=bytearray()\nfor _ in range(600): data.extend(os.urandom(1024*1024))\ntime.sleep(60)\n`,
      { mode: 0o700 },
    );
    const excessive = await instance.read(source(bytes), () => Promise.resolve(bytes));
    expect(excessive.limitations).toContain('RESOURCE_LIMIT');
    expect(await readdir(join(directory, 'controlled-jobs'))).toEqual([]);
  }, 15000);

  it.each(['stdout', 'stderr', 'temporary'] as const)(
    'terminates a live interpreter on %s resource overflow',
    async (mode) => {
      const { directory } = await reader();
      const executable = join(directory, 'overflow-interpreter');
      const body =
        mode === 'temporary'
          ? "with open('overflow', 'wb') as output: output.truncate(81*1024*1024)"
          : `sys.${mode}.write('x' * (65*1024)); sys.${mode}.flush()`;
      await writeFile(executable, `#!${python}\nimport sys,time\n${body}\ntime.sleep(60)\n`, {
        mode: 0o700,
      });
      const instance = trackedReader({
        python: executable,
        runnerRoot,
        temporaryRoot: join(directory, 'overflow-jobs'),
      });
      await instance.initialize();
      const bytes = Buffer.from('bounded source');
      const result = await instance.read(source(bytes), () => Promise.resolve(bytes));
      expect(result.limitations).toContain('RESOURCE_LIMIT');
      expect(await readdir(join(directory, 'overflow-jobs'))).toEqual([]);
    },
  );

  it('enforces the total deadline and clears only abandoned read directories on restart', async () => {
    const { directory } = await reader();
    const executable = join(directory, 'blocked-interpreter');
    await writeFile(executable, `#!${python}\nimport time\ntime.sleep(60)\n`, { mode: 0o700 });
    const temporaryRoot = join(directory, 'deadline-jobs');
    await mkdir(join(temporaryRoot, 'read-Abandoned'), { recursive: true, mode: 0o700 });
    await writeFile(join(temporaryRoot, 'read-Abandoned', 'private-copy'), 'abandoned content');
    await writeFile(join(temporaryRoot, 'keep'), 'unrelated');
    const instance = trackedReader({ python: executable, runnerRoot, temporaryRoot });
    await instance.initialize();
    expect(await readdir(temporaryRoot)).toEqual(['keep']);
    const bytes = Buffer.from('bounded source');
    const started = Date.now();
    const result = await instance.read(source(bytes), () => Promise.resolve(bytes));
    expect(result.limitations).toContain('TIMEOUT');
    expect(Date.now() - started).toBeLessThan(35000);
    expect(await readdir(temporaryRoot)).toEqual(['keep']);
    expect(await readFile(join(temporaryRoot, 'keep'), 'utf8')).toBe('unrelated');
    await instance.close();
  }, 40000);

  it('supports the ordinary already-admitted DOCX fixture', async () => {
    const bytes = docxBytes();
    const { instance } = await reader();
    expect(
      (await instance.read(source(bytes, MEDIA_TYPES.docx), () => Promise.resolve(bytes))).status,
    ).toBe('LIMITED');
  });
});

it('retains the real reader flock through orphan worker and Python descriptors', async () => {
  const { instance, directory } = await reader();
  const input = Buffer.from('# Orphan lock fixture');
  const identity = source(input);
  const script = join(directory, 'parent.mjs');
  const worker = resolve('modules/document-delivery/dist/preview/worker.js');
  const locks = pathToFileURL(resolve('modules/document-delivery/dist/custody/locks.js')).href;
  await writeFile(
    script,
    `
    import { fork } from 'node:child_process';
    import { acquireExclusiveLock, lockPathFor } from ${JSON.stringify(locks)};
    const lock = await acquireExclusiveLock(lockPathFor(${JSON.stringify(`read-slot:${join(directory, 'jobs')}`)}));
    const child = fork(${JSON.stringify(worker)}, [], { serialization:'advanced', stdio:['ignore','ignore','ignore','ipc',lock.descriptor] });
    child.on('message', message => {
      if(message.kind === 'python') process.send({worker:child.pid,python:message.pid});
    });
    child.send(${JSON.stringify({ source: identity, bytes: Array.from(input), directory: join(directory, 'work'), runnerRoot, python })});
  `,
  );
  const parent = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let workerPid: number | undefined, pythonPid: number | undefined;
  const kill = (pid: number | undefined, signal: NodeJS.Signals) => {
    if (pid !== undefined) {
      try {
        process.kill(pid, signal);
      } catch {
        /* Already exited. */
      }
    }
  };
  try {
    const event = await Promise.race([
      once(parent, 'message'),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('reader child handshake timeout'));
        }, 10000);
        timer.unref();
      }),
    ]);
    const message = event[0] as { worker: number; python: number };
    workerPid = message.worker;
    pythonPid = message.python;
    kill(workerPid, 'SIGSTOP');
    kill(pythonPid, 'SIGSTOP');
    const exited = once(parent, 'exit');
    parent.kill('SIGKILL');
    await exited;
    expect(await instance.acquireIdleLock()).toBeNull();
    kill(workerPid, 'SIGKILL');
    // Even after the Node worker dies, the stopped Python child still owns its inherited descriptor.
    expect(await instance.acquireIdleLock()).toBeNull();
    kill(pythonPid, 'SIGKILL');
    await expect
      .poll(async () => {
        const acquired = await instance.acquireIdleLock();
        if (acquired === null) return false;
        await acquired.release();
        return true;
      })
      .toBe(true);
  } finally {
    parent.kill('SIGKILL');
    kill(workerPid, 'SIGKILL');
    kill(pythonPid, 'SIGKILL');
  }
}, 20000);
