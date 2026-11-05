import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { MEDIA_TYPES } from '../domain/policy.js';
import { ZipSafetyError } from '../custody/zip.js';
import { preflightPreview } from './preflight.js';
import { hash, readFileBounded, directoryBytes } from './files.js';
import { normalizeExtraction, record, list, text } from './normalize.js';
import { PREVIEW_LIMITS as limits, READER_FILES, PreviewFailure, previewLimit } from './profile.js';
import type { PreviewSource } from './types.js';

export interface WorkerInput {
  readonly source: PreviewSource;
  readonly bytes: Uint8Array;
  readonly directory: string;
  readonly runnerRoot: string;
  readonly python: string;
}

import { PYTHON_WRAPPER } from './python.js';

let pythonProcess: ChildProcess | undefined;
let finished = false;
process.on('disconnect', () => {
  pythonProcess?.kill('SIGKILL');
  process.exit(finished ? 0 : 1);
});

async function run(input: WorkerInput) {
  const bytes = Buffer.from(input.bytes);
  if (
    hash(bytes) !== input.source.sourceRef.sha256 ||
    bytes.length !== input.source.sourceRef.byteLength
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  preflightPreview(bytes, input.source.sourceRef.mediaType);
  const code = join(input.directory, 'code', 'runner_evidence');
  await mkdir(code, { recursive: true, mode: 0o700 });
  for (const [name, expected] of Object.entries(READER_FILES)) {
    let data: Buffer;
    try {
      data = await readFileBounded(join(input.runnerRoot, 'runner_evidence', name), 1024 * 1024);
    } catch {
      throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
    }
    if (hash(data) !== expected) throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
    await writeFile(join(code, name), data, { mode: 0o400, flag: 'wx' });
  }
  const sourceName =
    input.source.sourceRef.mediaType === MEDIA_TYPES.markdown ? 'input.md' : 'input.docx';
  await writeFile(join(input.directory, sourceName), bytes, { mode: 0o400, flag: 'wx' });
  const manifest = Buffer.from(
    JSON.stringify({
      sources: [
        {
          sourceId: input.source.sourceRef.sourceId,
          role: 'CUSTOMER_MATERIAL',
          materializedRelativePath: sourceName,
          sha256: hash(bytes),
        },
      ],
    }),
  );
  await writeFile(join(input.directory, 'manifest.json'), manifest, { mode: 0o400, flag: 'wx' });
  await writeFile(join(input.directory, 'read.py'), PYTHON_WRAPPER, { mode: 0o400, flag: 'wx' });
  const child = spawn(input.python, ['-I', '-S', '-B', 'read.py'], {
    cwd: input.directory,
    env: { LANG: 'C.UTF-8', TZ: 'UTC' },
    stdio: ['pipe', 'pipe', 'pipe', 4],
  });
  pythonProcess = child;
  const stdin = child.stdin;
  if (stdin === null || child.stdout === null || child.stderr === null) {
    child.kill('SIGKILL');
    throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
  }
  let output = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const streamState: { overflow: boolean } = { overflow: false };
  const exceeded = () => {
    streamState.overflow = true;
    child.kill('SIGKILL');
  };
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > limits.pipeBytes) exceeded();
    else output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > limits.pipeBytes) exceeded();
  });
  const completion = once(child, 'close').catch(() => [-1, null]);
  await once(child, 'spawn').catch(() => {
    throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
  });
  process.once('message', () => {
    stdin.end('go\n');
  });
  process.send?.({ kind: 'python', pid: child.pid });
  const [exitCode, signal] = await completion;
  if (streamState.overflow || signal === 'SIGXFSZ' || signal === 'SIGXCPU')
    throw new PreviewFailure('RESOURCE_LIMIT');
  if (exitCode !== 0) throw new PreviewFailure('INVALID_READER_OUTPUT');
  const version = record(JSON.parse(output) as unknown, ['pythonVersion']);
  if (!/^3\.(?:1[0-9]|[2-9][0-9])\.[0-9]+$/u.test(text(version.pythonVersion)))
    throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
  previewLimit(await directoryBytes(input.directory), limits.temporaryBytes);
  // Recheck the only materialized input after the fixed code finishes.
  if (
    hash(await readFileBounded(join(input.directory, sourceName), limits.sourceBytes)) !==
    hash(bytes)
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const outputRoot = join(input.directory, 'output');
  const stem = hash(input.source.sourceRef.sourceId);
  const names = await readdir(outputRoot);
  if (
    names.length !== 3 ||
    names.some((name) => !['extraction-index.json', `${stem}.json`, `${stem}.md`].includes(name))
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const index = record(
    JSON.parse(
      (
        await readFileBounded(join(outputRoot, 'extraction-index.json'), limits.indexBytes)
      ).toString('utf8'),
    ) as unknown,
    ['formatVersion', 'inputManifestSha256', 'sources'],
  );
  if (index.formatVersion !== '0.1.0' || index.inputManifestSha256 !== hash(manifest))
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const rows = list(index.sources);
  if (rows.length !== 1) throw new PreviewFailure('INVALID_READER_OUTPUT');
  const row = record(rows[0], [
    'sourceId',
    'role',
    'materializedRelativePath',
    'sourceSha256',
    'extraction',
    'readable',
    'technicalReadCeiling',
    'limitations',
    'counts',
  ]);
  if (
    row.sourceId !== input.source.sourceRef.sourceId ||
    row.role !== 'CUSTOMER_MATERIAL' ||
    row.materializedRelativePath !== sourceName ||
    row.sourceSha256 !== hash(bytes)
  )
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const extraction = record(row.extraction, ['relativePath', 'sha256']);
  const readable = record(row.readable, ['relativePath', 'sha256']);
  if (extraction.relativePath !== `${stem}.json` || readable.relativePath !== `${stem}.md`)
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const data = await readFileBounded(join(outputRoot, `${stem}.json`), limits.outputBytes);
  const rendered = await readFileBounded(join(outputRoot, `${stem}.md`), limits.outputBytes);
  if (extraction.sha256 !== hash(data) || readable.sha256 !== hash(rendered))
    throw new PreviewFailure('INVALID_READER_OUTPUT');
  const result = normalizeExtraction(
    JSON.parse(data.toString('utf8')) as unknown,
    sourceName === 'input.md'
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      : undefined,
  );
  previewLimit(Buffer.byteLength(JSON.stringify(result)) + 4096, limits.outputBytes);
  return result;
}

process.once('message', (input: WorkerInput) => {
  void run(input)
    .then((value) => {
      finished = true;
      process.send?.({ kind: 'result', value }, () => {
        process.disconnect();
      });
    })
    .catch((error: unknown) => {
      const reason =
        error instanceof PreviewFailure
          ? error.reason
          : error instanceof ZipSafetyError
            ? error.code === 'ZIP_LIMIT_EXCEEDED'
              ? 'RESOURCE_LIMIT'
              : 'UNSAFE_CONTENT'
            : 'INVALID_READER_OUTPUT';
      pythonProcess?.kill('SIGKILL');
      finished = true;
      process.send?.({ kind: 'failure', reason }, () => {
        process.disconnect();
      });
    });
});
