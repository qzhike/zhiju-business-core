import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CustomerZipObjectReceipt, CustomerZipObjectStore } from './intake-service.js';

export interface CustomerZipFileConfiguration {
  readonly mode: 'MACOS_MANUAL_TEST';
  readonly root: string;
  readonly identity: { readonly storeId: string; readonly device: string; readonly inode: string };
}
const LIMIT = 104857600;
const HEADER_LIMIT = 4096;
const MAGIC = Buffer.from('ZHIJUOBJ1\n');
const CUSTOMER_KEY = /^customer-zip\/[0-9a-f-]+\/(?:[12]\/original|sources\/[0-9a-f-]+)$/;
const COMPANY_KEY = /^company-source\/[a-f0-9]{64}$/;
function hash(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}
function unavailable(): never {
  throw new Error('DEPENDENCY_UNAVAILABLE');
}
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}
function location(config: Pick<CustomerZipFileConfiguration, 'mode' | 'root'>) {
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Revalidate the deployment document at runtime.
    config.mode !== 'MACOS_MANUAL_TEST' ||
    !isAbsolute(config.root) ||
    resolve(config.root) !== config.root
  )
    unavailable();
}
function configuration(config: CustomerZipFileConfiguration) {
  location(config);
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Revalidate the deployment document at runtime.
    !config.identity ||
    !/^[0-9a-f-]{36}$/.test(config.identity.storeId) ||
    !/^\d+$/.test(config.identity.device) ||
    !/^\d+$/.test(config.identity.inode)
  )
    unavailable();
}
function identityBytes(config: CustomerZipFileConfiguration) {
  return Buffer.from(JSON.stringify({ version: 1, ...config.identity }));
}
async function privateRoot(config: CustomerZipFileConfiguration): Promise<void> {
  const parent = dirname(config.root),
    owner = process.getuid?.();
  if ((await realpath(parent)) !== parent) unavailable();
  const stat = await lstat(config.root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== owner ||
    String(stat.dev) !== config.identity.device ||
    String(stat.ino) !== config.identity.inode ||
    (await realpath(config.root)) !== config.root
  )
    unavailable();
  const identity = await open(
    join(config.root, '.store.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await identity.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.uid !== owner ||
      metadata.size !== identityBytes(config).length
    )
      unavailable();
    const bytes = Buffer.alloc(metadata.size);
    const read = await identity.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== bytes.length || !bytes.equals(identityBytes(config))) unavailable();
  } finally {
    await identity.close();
  }
}
/** Operator initialization; an explicit prior store ID permits exact identity recovery only. */
export async function initializeCustomerZipFileStore(
  input: Pick<CustomerZipFileConfiguration, 'mode' | 'root'> & { readonly storeId?: string },
): Promise<CustomerZipFileConfiguration> {
  location(input);
  if ((await realpath(dirname(input.root))) !== dirname(input.root)) unavailable();
  if (input.storeId !== undefined && !/^[0-9a-f-]{36}$/.test(input.storeId)) unavailable();
  let existing = false;
  try {
    await mkdir(input.root, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST' || input.storeId === undefined) throw error;
    existing = true;
  }
  const stat = await lstat(input.root);
  const config: CustomerZipFileConfiguration = {
    mode: input.mode,
    root: input.root,
    identity: {
      storeId: input.storeId ?? randomUUID(),
      device: String(stat.dev),
      inode: String(stat.ino),
    },
  };
  if (existing) {
    // The caller must already hold this identity in its private initialization intent.
    // Missing/foreign markers and replaced directories are never adopted or repaired.
    await privateRoot(config);
    return config;
  }
  const handle = await open(
    join(input.root, '.store.json'),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(identityBytes(config));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(input.root);
  await syncDirectory(dirname(input.root));
  await privateRoot(config);
  return config;
}
async function syncDirectory(root: string) {
  const handle = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function createStore(
  config: CustomerZipFileConfiguration,
  allowed: (key: string) => boolean,
): CustomerZipObjectStore {
  configuration(config);
  function path(key: string) {
    if (!allowed(key)) unavailable();
    return join(config.root, hash(key) + '.object');
  }
  async function readObject(
    key: string,
  ): Promise<{ bytes: Buffer; receipt: CustomerZipObjectReceipt }> {
    const target = path(key);
    await privateRoot(config);
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.size > LIMIT + HEADER_LIMIT + MAGIC.length + 4 ||
        stat.size < MAGIC.length + 4
      )
        unavailable();
      const data = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const result = await handle.read(data, offset, data.length - offset, offset);
        if (!result.bytesRead) unavailable();
        offset += result.bytesRead;
      }
      if ((await handle.stat()).size !== stat.size || !data.subarray(0, MAGIC.length).equals(MAGIC))
        unavailable();
      const length = data.readUInt32BE(MAGIC.length);
      if (!length || length > HEADER_LIMIT || MAGIC.length + 4 + length > data.length)
        unavailable();
      const header = data.subarray(MAGIC.length + 4, MAGIC.length + 4 + length);
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header));
      if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
      const fields = value as Record<string, unknown>;
      const bytes = data.subarray(MAGIC.length + 4 + length);
      const receipt = { key, sha256: hash(bytes), byteLength: bytes.length };
      if (
        Object.keys(fields).sort().join(',') !== 'byteLength,key,sha256' ||
        fields.key !== key ||
        fields.sha256 !== receipt.sha256 ||
        fields.byteLength !== receipt.byteLength ||
        bytes.length > LIMIT ||
        !header.equals(Buffer.from(JSON.stringify(receipt)))
      )
        unavailable();
      return { bytes, receipt };
    } finally {
      await handle.close();
    }
  }
  return {
    async put(key, input) {
      const target = path(key);
      if (
        input.byteLength > LIMIT ||
        (COMPANY_KEY.test(key) && key !== 'company-source/' + hash(input))
      )
        unavailable();
      // Snapshot caller bytes before the first asynchronous operation.
      const bytes = Buffer.from(input),
        receipt = { key, sha256: hash(bytes), byteLength: bytes.byteLength };
      await privateRoot(config);
      const temporary = join(config.root, '.pending-' + randomUUID());
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const header = Buffer.from(JSON.stringify(receipt));
        const prefix = Buffer.alloc(MAGIC.length + 4);
        MAGIC.copy(prefix);
        prefix.writeUInt32BE(header.length, MAGIC.length);
        await handle.writeFile(Buffer.concat([prefix, header, bytes]));
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(temporary);
        throw error;
      }
      await handle.close();
      try {
        // link() is atomic and refuses an existing destination on both macOS and Linux.
        try {
          await link(temporary, target);
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
        }
      } finally {
        await unlink(temporary);
      }
      await syncDirectory(config.root);
      const stored = await readObject(key);
      if (
        stored.receipt.sha256 !== receipt.sha256 ||
        stored.receipt.byteLength !== receipt.byteLength
      )
        throw new Error('INTEGRATION_OBJECT_IDENTITY_CONFLICT');
      return stored.receipt;
    },
    async read(key) {
      return (await readObject(key)).bytes;
    },
    async inspect(key) {
      try {
        return { state: 'COMPLETE', receipt: (await readObject(key)).receipt };
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          // A missing or replaced root is not proof that this key was never published.
          try {
            await privateRoot(config);
            return { state: 'ABSENT' };
          } catch {
            /* Unknown infrastructure state. */
          }
        }
        return { state: 'UNKNOWN' };
      }
    },
  };
}

/** Local test custody only; this adapter does not claim production S3 conformance. */
export function createCustomerZipFileObjectStore(
  config: CustomerZipFileConfiguration,
): CustomerZipObjectStore {
  return createStore(config, (key) => CUSTOMER_KEY.test(key));
}

/** Operator-only publication of immutable source bytes; business publication remains with its owner. */
export function createPreparationCompanyFileStore(
  config: CustomerZipFileConfiguration,
): CustomerZipObjectStore {
  return createStore(config, (key) => COMPANY_KEY.test(key));
}

export function createPreparationCompanyFileReader(
  config: CustomerZipFileConfiguration,
  keys: readonly string[],
): Pick<CustomerZipObjectStore, 'read'> {
  if (keys.some((key) => !COMPANY_KEY.test(key))) unavailable();
  const allowed = new Set(keys),
    store = createPreparationCompanyFileStore(config);
  return {
    read: (key) =>
      allowed.has(key) ? store.read(key) : Promise.reject(new Error('DEPENDENCY_UNAVAILABLE')),
  };
}
