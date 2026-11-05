import { constants } from 'node:fs';
import { open, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PreviewFailure, previewLimit } from './profile.js';

export function hash(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export async function readFileBounded(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new PreviewFailure('INVALID_READER_OUTPUT');
    previewLimit(stat.size, limit);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new PreviewFailure('INVALID_READER_OUTPUT');
      offset += result.bytesRead;
    }
    const extra = await file.read(Buffer.alloc(1), 0, 1, offset);
    if (extra.bytesRead !== 0) throw new PreviewFailure('RESOURCE_LIMIT');
    return bytes;
  } finally {
    await file.close();
  }
}
export async function directoryBytes(root: string): Promise<number> {
  let total = 0;
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 4) throw new PreviewFailure('INVALID_READER_OUTPUT');
    const stat = await lstat(path).catch((error: unknown) => {
      // collect atomically renames its private output directory while monitored.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) throw new PreviewFailure('INVALID_READER_OUTPUT');
    if (stat.isFile()) {
      total += stat.size;
      return;
    }
    if (!stat.isDirectory()) throw new PreviewFailure('INVALID_READER_OUTPUT');
    const names = await readdir(path).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return [];
      throw error;
    });
    if (names.length > 16) throw new PreviewFailure('INVALID_READER_OUTPUT');
    for (const name of names) await visit(join(path, name), depth + 1);
  };
  await visit(root, 0);
  return total;
}
