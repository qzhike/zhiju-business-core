import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, mkdir, readFile, readdir, unlink, link } from 'node:fs/promises';
import { join } from 'node:path';

import { errorCodeOf, fail } from '../domain/errors.js';
import { MVP_INPUT_LIMITS } from '../domain/policy.js';

/**
 * The dedicated B1 local custody store. Every object is immutable and its
 * identity is bound to the installation: the root marker records instance,
 * store id, device and inode, and a copied/replaced root is rejected instead
 * of being initialized as an empty store.
 */
export interface StoreIdentity {
  readonly instanceId: string;
  readonly storeId: string;
  readonly storeIdentity: string;
}

export interface StoredObject {
  readonly sha256: string;
  readonly byteLength: number;
}

export interface MvpFileStore {
  readonly root: string;
  readonly identity: StoreIdentity;
  putImmutable(key: string, bytes: Buffer, mediaType: string): Promise<StoredObject>;
  writeStaged(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
    maximumBytes: number,
  ): Promise<StoredObject>;
  publishStaged(stagedKey: string, finalKey: string): Promise<void>;
  readVerified(key: string, expected: StoredObject): Promise<Buffer>;
  inspect(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
}

const KEY =
  /^(?:original\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}|entries\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]{1,6})$/u;
const STAGED_KEY = /^staging\/[0-9a-f-]{36}$/u;
const MARKER = 'store.json';
const MARKER_VERSION = 1;

export class StoreIntegrityError extends Error {
  constructor() {
    super('STORAGE_INTEGRITY_ERROR');
    this.name = 'StoreIntegrityError';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function identityFor(instanceId: string, storeId: string, device: bigint, inode: bigint): string {
  return createHash('sha256')
    .update(`mvp.store@1\n${instanceId}\n${storeId}\n${device}\n${inode}`, 'utf8')
    .digest('hex');
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = errorCodeOf(error);
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EBADF') throw error;
  } finally {
    await handle?.close();
  }
}

function safeKey(key: string, staged: boolean): void {
  if (staged ? !STAGED_KEY.test(key) : !KEY.test(key)) throw new TypeError('object key rejected');
}

function objectPath(root: string, key: string): string {
  return join(root, ...key.split('/'));
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function readObject(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MVP_INPUT_LIMITS.zipBytes) throw new StoreIntegrityError();
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < info.size) {
      const { bytesRead } = await handle.read(buffer, offset, info.size - offset, offset);
      if (bytesRead === 0) throw new StoreIntegrityError();
      offset += bytesRead;
    }
    return buffer;
  } catch (error) {
    if (error instanceof StoreIntegrityError) throw error;
    if (errorCodeOf(error) === 'ENOENT') throw error;
    throw new StoreIntegrityError();
  } finally {
    await handle.close();
  }
}

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function receiptOf(bytes: Buffer): StoredObject {
  return { sha256: sha256(bytes), byteLength: bytes.length };
}

/** Create a new store root with a closed identity marker, or verify one. */
export async function initializeMvpFileStore(input: {
  readonly root: string;
  readonly instanceId: string;
  readonly storeId: string;
}): Promise<StoreIdentity> {
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(input.root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new StoreIntegrityError();
  const markerPath = join(input.root, MARKER);
  const expected = identityFor(
    input.instanceId,
    input.storeId,
    BigInt(rootInfo.dev),
    BigInt(rootInfo.ino),
  );
  try {
    const raw = await readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw) as Record<string, unknown>;
    if (
      marker.version !== MARKER_VERSION ||
      marker.instanceId !== input.instanceId ||
      marker.storeId !== input.storeId ||
      marker.storeIdentity !== expected
    )
      throw new StoreIntegrityError();
    return { instanceId: input.instanceId, storeId: input.storeId, storeIdentity: expected };
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') throw error;
  }
  const entries = await readdir(input.root);
  if (entries.length > 0) throw new StoreIntegrityError();
  const marker = {
    version: MARKER_VERSION,
    instanceId: input.instanceId,
    storeId: input.storeId,
    storeIdentity: expected,
    createdAt: new Date().toISOString(),
  };
  await writeExclusive(markerPath, Buffer.from(JSON.stringify(marker), 'utf8'));
  await syncDirectory(input.root);
  return { instanceId: input.instanceId, storeId: input.storeId, storeIdentity: expected };
}

/** Open an existing store and reject a moved, copied or replaced root. */
export async function openMvpFileStore(input: {
  readonly root: string;
  readonly expected: StoreIdentity;
}): Promise<MvpFileStore> {
  let info;
  try {
    info = await lstat(input.root);
  } catch {
    fail('DEPENDENCY_UNAVAILABLE');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('STORAGE_INTEGRITY_ERROR');
  let marker: Record<string, unknown>;
  try {
    marker = JSON.parse(await readFile(join(input.root, MARKER), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    fail('STORAGE_INTEGRITY_ERROR');
  }
  const expectedIdentity = identityFor(
    input.expected.instanceId,
    input.expected.storeId,
    BigInt(info.dev),
    BigInt(info.ino),
  );
  if (
    marker.version !== MARKER_VERSION ||
    marker.instanceId !== input.expected.instanceId ||
    marker.storeId !== input.expected.storeId ||
    marker.storeIdentity !== expectedIdentity ||
    input.expected.storeIdentity !== expectedIdentity
  )
    fail('STORAGE_INTEGRITY_ERROR');

  const identity: StoreIdentity = { ...input.expected, storeIdentity: expectedIdentity };
  const root = input.root;

  async function putImmutable(key: string, bytes: Buffer): Promise<StoredObject> {
    safeKey(key, false);
    const path = objectPath(root, key);
    const receipt = receiptOf(bytes);
    const parent = join(path, '..');
    await ensureParent(parent);
    const temporary = join(parent, `.${randomBytes(12).toString('hex')}.tmp`);
    await writeExclusive(temporary, bytes);
    try {
      await link(temporary, path);
      await syncDirectory(parent);
      return receipt;
    } catch (error) {
      if (errorCodeOf(error) !== 'EEXIST') throw error;
      const existing = await readObject(path);
      const existingReceipt = receiptOf(existing);
      if (
        existingReceipt.sha256 !== receipt.sha256 ||
        existingReceipt.byteLength !== receipt.byteLength
      )
        throw new StoreIntegrityError();
      return existingReceipt;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  return {
    root,
    identity,
    putImmutable: async (key, bytes) => putImmutable(key, bytes),
    async writeStaged(key, chunks, maximumBytes) {
      safeKey(key, true);
      const path = objectPath(root, key);
      const parent = join(path, '..');
      await ensureParent(parent);
      const handle = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      let length = 0;
      try {
        for await (const chunk of chunks) {
          const position = length;
          length += chunk.length;
          if (length > maximumBytes) throw new StoreIntegrityError();
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(
              chunk,
              offset,
              chunk.length - offset,
              position + offset,
            );
            offset += bytesWritten;
          }
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(parent);
      return { sha256: hash.digest('hex'), byteLength: length };
    },
    async publishStaged(stagedKey, finalKey) {
      safeKey(stagedKey, true);
      safeKey(finalKey, false);
      const source = objectPath(root, stagedKey);
      const target = objectPath(root, finalKey);
      await ensureParent(join(target, '..'));
      try {
        await link(source, target);
      } catch (error) {
        if (errorCodeOf(error) !== 'EEXIST') throw error;
        const [left, right] = await Promise.all([readObject(source), readObject(target)]);
        if (!left.equals(right)) throw new StoreIntegrityError();
      }
      await unlink(source).catch(() => undefined);
      await syncDirectory(join(target, '..'));
    },
    async readVerified(key, expected) {
      safeKey(key, false);
      let bytes: Buffer;
      try {
        bytes = await readObject(objectPath(root, key));
      } catch (error) {
        if (errorCodeOf(error) === 'ENOENT') fail('STORAGE_INTEGRITY_ERROR');
        throw error;
      }
      if (bytes.length !== expected.byteLength || sha256(bytes) !== expected.sha256)
        throw new StoreIntegrityError();
      return bytes;
    },
    async inspect(key) {
      safeKey(key, false);
      try {
        const bytes = await readObject(objectPath(root, key));
        return receiptOf(bytes);
      } catch (error) {
        if (errorCodeOf(error) === 'ENOENT') return null;
        if (error instanceof StoreIntegrityError) throw error;
        throw error;
      }
    },
    async remove(key) {
      safeKey(key, true);
      await unlink(objectPath(root, key)).catch((error: unknown) => {
        if (errorCodeOf(error) !== 'ENOENT') throw error;
      });
    },
  };
}
