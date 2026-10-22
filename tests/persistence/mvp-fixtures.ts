import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  initializeMvpFileStore,
  openMvpFileStore,
  type MvpFileStore,
} from '../../modules/document-delivery/src/index.js';

export const MVP_TEST_DATABASE = 'zhiju_mvp_test';
export const MVP_TEST_LOGIN = 'mvp_test_login';
export const MVP_TEST_PASSWORD = 'mvp-test-password';

const utf8 = new TextEncoder();

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[n] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFixtureEntry {
  readonly name: string;
  readonly bytes: Buffer;
  readonly directory?: boolean;
}

/** Minimal deterministic ZIP writer used only by tests. */
export function zipBytes(entries: readonly ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const bytes = entry.directory === true ? Buffer.alloc(0) : entry.bytes;
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function contentTypes(overrides: readonly { part: string; type: string }[]): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CONTENT_TYPES}">${overrides
      .map(({ part, type }) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join('')}</Types>`,
    'utf8',
  );
}

function relationships(items: readonly { id: string; type: string; target: string }[]): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELATIONSHIPS}">${items
      .map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
      .join('')}</Relationships>`,
    'utf8',
  );
}

export function docxBytes(): Buffer {
  return zipBytes([
    {
      name: '[Content_Types].xml',
      bytes: contentTypes([
        {
          part: '/word/document.xml',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        },
      ]),
    },
    {
      name: '_rels/.rels',
      bytes: relationships([
        { id: 'rId1', type: `${REL}/officeDocument`, target: 'word/document.xml' },
      ]),
    },
    {
      name: 'word/document.xml',
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
        'utf8',
      ),
    },
  ]);
}

export function macroDocxBytes(): Buffer {
  return zipBytes([
    {
      name: '[Content_Types].xml',
      bytes: contentTypes([
        {
          part: '/word/document.xml',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        },
        {
          part: '/word/vbaProject.bin',
          type: 'application/vnd.ms-office.vbaProject',
        },
      ]),
    },
    {
      name: '_rels/.rels',
      bytes: relationships([
        { id: 'rId1', type: `${REL}/officeDocument`, target: 'word/document.xml' },
      ]),
    },
    {
      name: 'word/document.xml',
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD}"/>`,
        'utf8',
      ),
    },
    { name: 'word/vbaProject.bin', bytes: Buffer.from('macro') },
  ]);
}

export function xlsxBytes(): Buffer {
  return zipBytes([
    {
      name: '[Content_Types].xml',
      bytes: contentTypes([
        {
          part: '/xl/workbook.xml',
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        },
      ]),
    },
    {
      name: '_rels/.rels',
      bytes: relationships([
        { id: 'rId1', type: `${REL}/officeDocument`, target: 'xl/workbook.xml' },
      ]),
    },
    {
      name: 'xl/workbook.xml',
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${SHEET}" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      bytes: relationships([
        { id: 'rId1', type: `${REL}/worksheet`, target: 'worksheets/sheet1.xml' },
      ]),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      bytes: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SHEET}"><sheetData><row r="1"><c r="A1"><v>0</v></c></row></sheetData></worksheet>`,
        'utf8',
      ),
    },
  ]);
}

export function markdownBytes(text = '# 资料\n\n正文'): Buffer {
  return Buffer.from(text, 'utf8');
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.username = MVP_TEST_LOGIN;
  url.password = MVP_TEST_PASSWORD;
  return url.toString();
}

export async function createMvpDatabase(adminUrl: string): Promise<Client> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${MVP_TEST_DATABASE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${MVP_TEST_DATABASE}`);
  const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [MVP_TEST_LOGIN]);
  if (role.rowCount === 0)
    await admin.query(
      `CREATE ROLE ${MVP_TEST_LOGIN} LOGIN PASSWORD '${MVP_TEST_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
  return admin;
}

export async function applyMvpMigration(adminUrl: string): Promise<void> {
  const url = new URL(adminUrl);
  url.pathname = `/${MVP_TEST_DATABASE}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const sql = await readFile(
      join(
        import.meta.dirname,
        '../../modules/document-delivery/migrations/V0001__document_delivery_schema.sql',
      ),
      'utf8',
    );
    await client.query(sql);
    await client.query(`GRANT mvp_runtime TO ${MVP_TEST_LOGIN} WITH INHERIT FALSE, SET TRUE`);
  } finally {
    await client.end();
  }
}

export interface MvpFixture {
  readonly adminUrl: string;
  readonly databaseUrl: string;
  readonly store: MvpFileStore;
  readonly storeRoot: string;
  readonly instanceId: string;
  readonly storeId: string;
  readonly ownerId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly owner2: string;
}

export async function provisionMvp(
  adminUrl: string,
  options: { readonly owner2?: boolean; readonly issuer?: string; readonly subject?: string } = {},
): Promise<MvpFixture> {
  const instanceId = '0123456789abcdef';
  const storeId = newUuidV7();
  const storeRoot = await mkdtemp(join(tmpdir(), 'mvp-store-'));
  const storeIdentity = await initializeMvpFileStore({ root: storeRoot, instanceId, storeId });
  const store = await openMvpFileStore({ root: storeRoot, expected: storeIdentity });
  const ownerId = newUuidV7();
  const owner2 = newUuidV7();
  const issuer = options.issuer ?? 'http://127.0.0.1:3380/realms/zhiju-mvp';
  const subject = options.subject ?? newUuidV7();
  const url = new URL(adminUrl);
  url.pathname = `/${MVP_TEST_DATABASE}`;
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query('SET ROLE mvp_owner');
    await admin.query(
      `INSERT INTO document_delivery.installation
         (instance_id, schema_version, store_id, store_identity, created_at)
       VALUES ($1, 'mvp.document_delivery@1', $2, $3, now())`,
      [instanceId, storeId, storeIdentity.storeIdentity],
    );
    await admin.query(
      `INSERT INTO document_delivery.operator_binding
         (owner_id, issuer, subject, display_name, enabled, auth_epoch, created_at, updated_at)
       VALUES ($1, $2, $3, 'MVP 操作者', true, 1, now(), now())`,
      [ownerId, issuer, subject],
    );
    if (options.owner2 === true) {
      await admin.query(
        `INSERT INTO document_delivery.operator_binding
           (owner_id, issuer, subject, display_name, enabled, auth_epoch, created_at, updated_at)
         VALUES ($1, $2, $3, '第二操作者', true, 1, now(), now())`,
        [owner2, issuer, newUuidV7()],
      );
    }
  } finally {
    await admin.end();
  }
  return {
    adminUrl,
    databaseUrl: databaseUrl(adminUrl, MVP_TEST_DATABASE),
    store,
    storeRoot,
    instanceId,
    storeId,
    ownerId,
    issuer,
    subject,
    owner2,
  };
}

export async function readStoredFile(root: string, key: string): Promise<Buffer> {
  return readFile(join(root, ...key.split('/')));
}

export async function corruptStoredFile(root: string, key: string): Promise<void> {
  const path = join(root, ...key.split('/'));
  const bytes = await readFile(path);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  await writeFile(path, bytes);
}

// eslint-disable-next-line @typescript-eslint/require-await -- the upload port is async iterable by contract.
export async function* singleChunk(bytes: Buffer): AsyncIterable<Uint8Array> {
  yield bytes;
}

export function payloadBytes(bytes: Buffer): { declaredBytes: number; sha256: string } {
  return { declaredBytes: bytes.length, sha256: sha256(bytes) };
}

export function textBytes(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

export const fixtures = { utf8 };
